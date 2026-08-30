import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AdminSignupDecisionBody,
  AdminSignupDecisionDto,
  AdminSignupQueueDto,
  AdminSignupQueueItemDto,
  AdminSignupReissueDto,
} from '@watchdog-bms/contracts';
import type { CompanySignupRequest } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { CompanySignupCoreService } from './company-signup-core.service';
import { AccountClaimTokenService } from './account-claim-token.service';
import { SignupClaimEmailService } from './signup-claim-email.service';
import { daysSinceApproval } from '../domain/account-claim.logic';
import type { CompanySignupState } from '../domain/company-signup.logic';

/** Everything an admin still has a decision or an action to take on (spec §4C, §4D). */
const QUEUE_STATES: readonly CompanySignupState[] = ['PENDING_REVIEW', 'EMAIL_PENDING', 'EMAIL_FAILED', 'EXPIRED'];

/** Spec §4D ④: an approved request never dead-ends, so reissue has no age limit. */
const REISSUABLE_STATES: readonly CompanySignupState[] = ['EMAIL_PENDING', 'EMAIL_FAILED', 'EXPIRED'];

@Injectable()
export class SignupAdminQueueUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CompanySignupCoreService,
    private readonly tokens: AccountClaimTokenService,
    private readonly claimEmail: SignupClaimEmailService,
  ) {}

  async list(now = new Date()): Promise<AdminSignupQueueDto> {
    const requests = await this.prisma.client.companySignupRequest.findMany({
      where: { state: { in: QUEUE_STATES as CompanySignupState[] } },
      orderBy: [{ state: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    if (requests.length === 0) return { items: [] };

    // Two batched lookups rather than per-row queries: the hints are the whole point of the queue,
    // and an admin opening it should not pay N round-trips for N applications.
    const emails = [...new Set(requests.map((r) => r.contactEmail))];
    const taxIds = [...new Set(requests.map((r) => r.taxId).filter((id): id is string => !!id))];
    const [users, companies] = await Promise.all([
      this.prisma.client.user.findMany({ where: { email: { in: emails } }, select: { email: true } }),
      taxIds.length
        ? this.prisma.client.company.findMany({ where: { taxId: { in: taxIds } }, select: { taxId: true, name: true } })
        : Promise.resolve([]),
    ]);
    const knownEmails = new Set(users.map((u) => u.email));
    const companyByTaxId = new Map(companies.map((c) => [c.taxId, c.name]));

    return { items: requests.map((request) => toQueueItem(request, knownEmails, companyByTaxId, now)) };
  }

  /**
   * Approve or reject. Idempotent by contract: repeating the same decision returns the current
   * state and queues no second email, because the approve path's outbox key is the request id.
   */
  async decide(
    requestId: string,
    body: AdminSignupDecisionBody,
    adminUserId: string,
    correlationRequestId: string,
  ): Promise<AdminSignupDecisionDto> {
    const request = await this.findOrThrow(requestId);

    if (body.action === 'APPROVE') {
      if (request.state !== 'PENDING_REVIEW') {
        // Already approved is a no-op; anything else is a real conflict the admin should see.
        if (request.state === 'EMAIL_PENDING') return { requestId, state: request.state };
        throw new ConflictException(`invalid_signup_decision:${request.state}`);
      }
      const approvedAt = new Date();
      await this.core.advance(requestId, 'EMAIL_PENDING', correlationRequestId);
      await this.prisma.client.companySignupRequest.update({
        where: { id: requestId },
        data: { approvedAt, approvedByUserId: adminUserId },
      });
      await this.claimEmail.enqueue(requestId, 'approve', approvedAt);
      await this.audit(requestId, adminUserId, correlationRequestId, 'signup.request.approved', {
        hadTaxId: request.taxId !== null,
        mxValid: request.mxValid ?? false,
      });
      return { requestId, state: 'EMAIL_PENDING' };
    }

    if (request.state === 'REJECTED') return { requestId, state: request.state };
    if (request.state !== 'PENDING_REVIEW') throw new ConflictException(`invalid_signup_decision:${request.state}`);

    await this.core.advance(requestId, 'REJECTED', correlationRequestId);
    // No orphaned credential material may survive a rejection (spec §4B).
    await this.prisma.client.companySignupRequest.update({
      where: { id: requestId },
      data: { pendingPasswordHash: null },
    });
    await this.tokens.revokeAll(requestId);
    // Spec §4D: silent by default — the address is unverified, so an unsolicited notice would make
    // the platform a spam cannon aimed at whoever the applicant typed.
    if (body.notifyApplicant) await this.claimEmail.enqueueRejectionNotice(requestId);
    await this.audit(requestId, adminUserId, correlationRequestId, 'signup.request.rejected', {
      notifyApplicant: body.notifyApplicant === true,
    });
    return { requestId, state: 'REJECTED' };
  }

  /**
   * Spec §4D ④: "he already applied, and one day may already have paid" — an admin can always put a
   * fresh link in front of an approved applicant, at any age, without a second application.
   */
  async reissue(
    requestId: string,
    adminUserId: string,
    correlationRequestId: string,
  ): Promise<AdminSignupReissueDto> {
    const request = await this.findOrThrow(requestId);
    if (!REISSUABLE_STATES.includes(request.state as CompanySignupState)) {
      throw new ConflictException(`invalid_signup_reissue:${request.state}`);
    }

    const revoked = await this.tokens.revokeAll(requestId);
    // From EMAIL_PENDING this is a no-op replay in the core; from EMAIL_FAILED/EXPIRED it is the
    // documented way back. Either way the state after this call is EMAIL_PENDING.
    await this.core.advance(requestId, 'EMAIL_PENDING', correlationRequestId);
    // A reissue restarts the reminder clock: the applicant gets one reminder per live link.
    await this.prisma.client.companySignupRequest.update({
      where: { id: requestId },
      data: { claimReminderSentAt: null },
    });
    await this.claimEmail.enqueue(requestId, 'reissue');
    await this.audit(requestId, adminUserId, correlationRequestId, 'signup.request.claim_reissued', {
      fromState: request.state,
      revokedTokenCount: revoked,
    });
    return { requestId, state: 'EMAIL_PENDING', claimEmailQueued: true };
  }

  private async findOrThrow(requestId: string): Promise<CompanySignupRequest> {
    const request = await this.prisma.client.companySignupRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('company_signup_request_not_found');
    return request;
  }

  /** Every admin action on an application is HIGH, with booleans, ids and states only. */
  private async audit(
    requestId: string,
    adminUserId: string,
    correlationRequestId: string,
    action: string,
    // Scalars only, by type: an object here would be a place for PII to hide.
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action,
        targetType: 'company_signup_request',
        targetId: requestId,
        requestId: correlationRequestId,
        result: 'SUCCESS',
        riskLevel: 'HIGH',
        metadataJson: metadata,
      },
    });
  }
}

function toQueueItem(
  request: CompanySignupRequest,
  knownEmails: Set<string | null>,
  companyByTaxId: Map<string | null, string>,
  now: Date,
): AdminSignupQueueItemDto {
  const taxIdMatch = request.taxId ? companyByTaxId.get(request.taxId) : undefined;
  const approvalAge = daysSinceApproval(request.approvedAt, now);
  return {
    requestId: request.id,
    state: request.state,
    companyName: request.companyName,
    ownerDisplayName: request.ownerDisplayName,
    contactEmail: request.contactEmail,
    ...(request.phoneNumber ? { phoneNumber: request.phoneNumber } : {}),
    ...(request.businessType ? { businessType: request.businessType } : {}),
    ...(request.vatRegistered !== null ? { vatRegistered: request.vatRegistered } : {}),
    ...(request.taxId ? { taxId: request.taxId } : {}),
    ...(request.requestedOfferKey ? { requestedOfferKey: request.requestedOfferKey } : {}),
    ...(request.mxValid !== null ? { mxValid: request.mxValid } : {}),
    createdAt: request.createdAt.toISOString(),
    ...(request.approvedAt ? { approvedAt: request.approvedAt.toISOString() } : {}),
    ...(request.claimEmailLastSentAt ? { claimEmailLastSentAt: request.claimEmailLastSentAt.toISOString() } : {}),
    // Hint only. Spec §4C is explicit that the attach decision is made by the applicant at the
    // claim page, never by the admin from this flag.
    emailMatchesExistingUser: knownEmails.has(request.contactEmail),
    ...(taxIdMatch ? { taxIdMatchesCompanyName: taxIdMatch } : {}),
    ...(approvalAge !== undefined ? { daysSinceApproval: approvalAge } : {}),
    emailDeliveryFailed: request.state === 'EMAIL_FAILED',
  };
}
