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
import { CompanySignupCoreService, signupStateGuard } from './company-signup-core.service';
import { AccountClaimTokenService } from './account-claim-token.service';
import { SignupClaimEmailService } from './signup-claim-email.service';
import { ProvisionSignupUseCase } from './provision-signup.use-case';
import { LineSignupNotifyService } from './line-signup-notify.service';
import { daysSinceApproval } from '../domain/account-claim.logic';
import { SIGNUP_SOURCE_LINE_OA, isStaleProvisioning, type CompanySignupState } from '../domain/company-signup.logic';

/** Everything an admin still has a decision or an action to take on (spec §4C, §4D). */
const QUEUE_STATES: readonly CompanySignupState[] = ['PENDING_REVIEW', 'EMAIL_PENDING', 'EMAIL_FAILED', 'EXPIRED'];

/**
 * Review MEDIUM-D: shown for the LINE source ONLY. There the fence releases precisely so an admin
 * can retry, and an unseen row also leaves the customer's LINE account fenced by the
 * open-application index with no way out. A web-form row in either state has no retry an admin
 * could reach — approve, reject and reissue all 409 — so listing it would be an invitation to
 * three dead ends. Flow B retry semantics are L-C.
 */
const LINE_ONLY_QUEUE_STATES: readonly CompanySignupState[] = ['PROVISIONING_FAILED', 'READY', 'PROVISIONING'];

/** Spec §4D ④: an approved request never dead-ends, so reissue has no age limit. */
const REISSUABLE_STATES: readonly CompanySignupState[] = ['EMAIL_PENDING', 'EMAIL_FAILED', 'EXPIRED'];

/**
 * A LINE approval provisions inline, so a repeated tap lands on one of these, not on a conflict.
 * READY is deliberately NOT here: it looks settled and is not — the shop exists but the
 * application has not closed, and treating it as done left the customer's LINE account fenced by
 * the open-application index with no way for an admin to finish it.
 */
const SETTLED_STATES: readonly CompanySignupState[] = ['PROVISIONING', 'COMPLETED'];

/** States a LINE application can be approved out of: the first decision, and the two recoveries. */
const LINE_APPROVABLE_STATES: readonly CompanySignupState[] = ['PENDING_REVIEW', 'PROVISIONING_FAILED', 'READY'];

@Injectable()
export class SignupAdminQueueUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CompanySignupCoreService,
    private readonly tokens: AccountClaimTokenService,
    private readonly claimEmail: SignupClaimEmailService,
    private readonly provision: ProvisionSignupUseCase,
    private readonly lineNotify: LineSignupNotifyService,
  ) {}

  async list(now = new Date()): Promise<AdminSignupQueueDto> {
    const requests = await this.prisma.client.companySignupRequest.findMany({
      where: {
        OR: [
          { state: { in: QUEUE_STATES as CompanySignupState[] } },
          { state: { in: LINE_ONLY_QUEUE_STATES as CompanySignupState[] }, source: SIGNUP_SOURCE_LINE_OA },
        ],
      },
      orderBy: [{ state: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    if (requests.length === 0) return { items: [] };

    // Two batched lookups rather than per-row queries: the hints are the whole point of the queue,
    // and an admin opening it should not pay N round-trips for N applications.
    // P10-L: a `line-oa` row has no address, and `in: [null]` is not a query Prisma will accept.
    const emails = [...new Set(requests.map((r) => r.contactEmail).filter((email): email is string => !!email))];
    const taxIds = [...new Set(requests.map((r) => r.taxId).filter((id): id is string => !!id))];
    const phones = [...new Set(requests.map((r) => r.phoneNumber).filter((phone): phone is string => !!phone))];
    const [users, companies, phoneMatches] = await Promise.all([
      this.prisma.client.user.findMany({ where: { email: { in: emails } }, select: { email: true } }),
      taxIds.length
        ? this.prisma.client.company.findMany({ where: { taxId: { in: taxIds } }, select: { taxId: true, name: true } })
        : Promise.resolve([]),
      this.companiesReachableByPhone(phones),
    ]);
    const knownEmails = new Set(users.map((u) => u.email));
    const companyByTaxId = new Map(companies.map((c) => [c.taxId, c.name]));
    const priorCompanies = await this.shopsTheseApplicantsAlreadyHad(requests);

    return {
      items: requests.map((request) =>
        toQueueItem(request, knownEmails, companyByTaxId, phoneMatches, priorCompanies, now)),
    };
  }

  /**
   * Owner 2026-09-05: a repeat trial has to be visible before the approve button is pressed. The
   * applicant is found through the identity that owns their LINE slot IN ANY STATUS — an owner who
   * unlinked, or whose shop was closed, is exactly the case this hint exists for and the one an
   * ACTIVE-only read cannot see. Batched like the other hints: one identity read and one membership
   * read for the whole page, never per row.
   */
  private async shopsTheseApplicantsAlreadyHad(
    requests: CompanySignupRequest[],
  ): Promise<Map<string, PriorCompany>> {
    const lineRows = requests.filter((r) => r.lineProviderUserId && r.lineChannelId);
    const providerUserIds = [...new Set(lineRows.map((r) => r.lineProviderUserId!))];
    const identities = providerUserIds.length
      ? await this.prisma.client.externalIdentity.findMany({
          where: { provider: 'LINE', providerUserId: { in: providerUserIds } },
          select: { providerUserId: true, providerChannelId: true, userId: true },
        })
      : [];
    const userIdByIdentity = new Map(identities.map((i) => [identityKey(i.providerChannelId, i.providerUserId), i.userId]));
    const applicantUserIds = [...new Set([
      ...identities.map((i) => i.userId),
      ...requests.map((r) => r.attachUserId).filter((id): id is string => !!id),
    ])];
    if (applicantUserIds.length === 0) return new Map();

    const memberships = await this.prisma.client.companyMembership.findMany({
      where: { userId: { in: applicantUserIds } },
      orderBy: { createdAt: 'asc' },
      select: {
        userId: true,
        company: { select: { name: true, status: true, planTerm: { select: { termDisabledAt: true } } } },
      },
    });
    // Oldest membership wins: it is the shop this person is coming back FROM.
    const byUserId = new Map<string, PriorCompany>();
    for (const row of memberships) {
      if (byUserId.has(row.userId)) continue;
      byUserId.set(row.userId, {
        name: row.company.name,
        // Same pair the LINE assistant uses to tell an expiry from an admin-ordered close, so the
        // queue and the chat cannot describe one shop two different ways.
        state: row.company.status === 'ACTIVE'
          ? 'ACTIVE'
          : row.company.planTerm?.termDisabledAt ? 'EXPIRED' : 'CLOSED',
      });
    }

    // Keyed by REQUEST id, so `toQueueItem` stays a pure mapping with nothing left to look up.
    const byRequest = new Map<string, PriorCompany>();
    for (const request of requests) {
      const userId = request.attachUserId
        ?? (request.lineProviderUserId && request.lineChannelId
          ? userIdByIdentity.get(identityKey(request.lineChannelId, request.lineProviderUserId))
          : undefined);
      const prior = userId ? byUserId.get(userId) : undefined;
      if (prior) byRequest.set(request.id, prior);
    }
    return byRequest;
  }

  /**
   * Review A-01: the number on the form already reaches a shop we opened. The commonest shape is a
   * customer an admin set up by hand who then applies from LINE as if they were new — approving
   * that opens a SECOND shop for one person, and nobody notices until they call.
   *
   * Two rails, because a phone lives in two places: on the company profile, and on the member's own
   * user record. A hint only: the operator calls the number, the system decides nothing.
   */
  private async companiesReachableByPhone(phones: string[]): Promise<Map<string, string>> {
    if (phones.length === 0) return new Map();
    const [byCompany, byMember] = await Promise.all([
      this.prisma.client.company.findMany({
        where: { phone: { in: phones } },
        select: { phone: true, name: true },
      }),
      this.prisma.client.companyMembership.findMany({
        where: { status: 'ACTIVE', user: { phoneNumber: { in: phones } } },
        select: { user: { select: { phoneNumber: true } }, company: { select: { name: true } } },
      }),
    ]);
    const matches = new Map<string, string>();
    // Company profile first: it names the shop directly, and a member row only implies it.
    for (const row of byMember) {
      if (row.user.phoneNumber) matches.set(row.user.phoneNumber, row.company.name);
    }
    for (const row of byCompany) {
      if (row.phone) matches.set(row.phone, row.name);
    }
    return matches;
  }

  /**
   * P10-L §8 / review B-09: an auto-approved application never enters the queue, so an admin needs
   * a way to look at what the machine let through. Read-only and time-boxed.
   */
  async listAutoApproved(days = 14, now = new Date()): Promise<AdminSignupQueueDto> {
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const requests = await this.prisma.client.companySignupRequest.findMany({
      where: { autoApproved: true, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    // These rows are all COMPLETED, so none of the queue's dedupe hints apply to them.
    return {
      items: requests.map((request) =>
        toQueueItem(request, new Set<string | null>(), new Map(), new Map(), new Map(), now)),
    };
  }

  /**
   * Approve, reject or suspend. Idempotent by contract: repeating the same decision returns the
   * current state and queues no second email, because the approve path's outbox key is the request
   * id. What "approve" MEANS depends on the source: a web application still has a mailbox to prove,
   * a LINE application proved its human at submit and goes straight to provisioning (spec §5).
   */
  async decide(
    requestId: string,
    body: AdminSignupDecisionBody,
    adminUserId: string,
    correlationRequestId: string,
    urls?: { webBaseUrl: string; apiBaseUrl: string },
    now = new Date(),
  ): Promise<AdminSignupDecisionDto> {
    const request = await this.findOrThrow(requestId);
    const lineOa = request.source === SIGNUP_SOURCE_LINE_OA;

    if (body.action === 'SUSPEND') return this.suspend(request, adminUserId, correlationRequestId, now);

    if (body.action === 'APPROVE') {
      // A LINE application may also be approved out of PROVISIONING_FAILED or READY: those ARE the
      // retry and the finish, and the P10-0 fence makes both idempotent — a second attempt either
      // completes the shop the first one started or fails again, never creating a second one.
      // An abandoned PROVISIONING row is approvable too: the fence will re-claim it, and the queue
      // has to agree with the fence about what abandoned means or it offers a recovery the fence
      // refuses (or, as first shipped, refuses one the fence would have allowed).
      const approvable = lineOa
        ? LINE_APPROVABLE_STATES.includes(request.state as CompanySignupState)
          || isStaleProvisioning(request, now)
        : request.state === 'PENDING_REVIEW';
      if (!approvable) {
        // Already approved is a no-op; anything else is a real conflict the admin should see.
        if (request.state === 'EMAIL_PENDING') return { requestId, state: request.state };
        if (lineOa && SETTLED_STATES.includes(request.state as CompanySignupState)) {
          return { requestId, state: request.state };
        }
        throw new ConflictException(`invalid_signup_decision:${request.state}`);
      }
      const approvedAt = new Date();
      if (lineOa) {
        // No claim email exists for this source, so approval IS provisioning.
        // Review LOW-3: the approval stamp records WHEN this application was decided, so only a
        // first decision writes it. Closing a row that is already past the decision — a retry or a
        // stranded one — must not rewrite that history; the audit says what this call actually did.
        const firstDecision = request.state === 'PENDING_REVIEW';
        if (firstDecision) {
          await this.prisma.client.companySignupRequest.update({
            where: { id: requestId },
            data: { approvedAt, approvedByUserId: adminUserId },
          });
        }
        await this.audit(requestId, adminUserId, correlationRequestId, 'signup.request.approved', {
          source: request.source,
          hadPhoneNumber: request.phoneNumber !== null,
          fromState: request.state,
          retryOfFailedProvisioning: request.state === 'PROVISIONING_FAILED',
          finishedStrandedRow: !firstDecision && request.state !== 'PROVISIONING_FAILED',
        });
        if (!urls) throw new ConflictException('signup_provisioning_urls_required');
        await this.provision.execute({
          requestId,
          actorUserId: adminUserId,
          operatorFromDirectory: false,
          correlationRequestId,
          ...urls,
        });
        return { requestId, state: 'COMPLETED' };
      }
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
    // the platform a spam cannon aimed at whoever the applicant typed. A LINE application has no
    // address at all: its rejection travels as a LINE push (spec §7), which L-B sends.
    if (body.notifyApplicant) {
      // P10-L §7: a LINE application has no address, so its rejection travels as the one push §7
      // specifies. Same toggle, same default, one branch for which rail carries it.
      if (lineOa) await this.lineNotify.enqueue(requestId, 'rejected');
      else if (request.contactEmail) await this.claimEmail.enqueueRejectionNotice(requestId, body.rejectionReason);
    }
    await this.audit(requestId, adminUserId, correlationRequestId, 'signup.request.rejected', {
      notifyApplicant: body.notifyApplicant === true,
      // The paragraph itself stays out of evidence — it is copy for one inbox, not an audit fact.
      hadRejectionReason: Boolean(body.rejectionReason?.trim()),
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

  /**
   * P10-L §3.7: stopping an application an admin does not want to keep — most often one AUTO_FREE
   * let through. Reachable from more states than approve or reject, because the reason to stop can
   * arrive at any point, including after the shop exists.
   *
   * Scope note: this settles the APPLICATION. Disabling the company itself stays with the partner
   * lifecycle control an admin already has; the free-trial AI budget is what bounds spend meanwhile.
   */
  private async suspend(
    request: CompanySignupRequest,
    adminUserId: string,
    correlationRequestId: string,
    now: Date,
  ): Promise<AdminSignupDecisionDto> {
    if (request.state === 'SUSPENDED') return { requestId: request.id, state: request.state };
    // Never mid-provisioning while anything could still exist behind it. SUSPENDED is terminal, so
    // suspending a row whose company may already exist but whose trial guards have not run leaves
    // an UNLIMITED shop with its application shut behind it — and against a live attempt it races
    // work still in flight.
    //
    // The one safe exception (plan note, L-A review rounds 5–6): an ABANDONED attempt that never
    // stamped a `companyId`. The stamp happens inside the company transaction, so no company id
    // means no company — there is nothing to strand, and the row is otherwise a dead end an
    // operator can only clear by opening a shop they have already decided not to want.
    //
    // The predicate goes to the CORE rather than being decided here, because `request` above was
    // read outside the lock: a run that finished, or one that started, between that read and the
    // write would otherwise be suspended anyway — the transition table permits the edge and cannot
    // know that this particular row has since acquired a company. Re-checked under the lock, the
    // race collapses into a 409 the operator can act on.
    // READY is in the refused set for the same reason PROVISIONING is: the shop EXISTS and the
    // application has not closed, so suspending strands an ACTIVE company whose trial guards may
    // never have run — and frees the LINE account to apply again, because SUSPENDED leaves the
    // open-application index. The action a READY row wants is the close-out, not the stop.
    const inFlight = signupStateGuard(
      'suspend_not_allowed_in_flight',
      (current) => (current.state !== 'PROVISIONING' && current.state !== 'READY')
        || (current.state === 'PROVISIONING'
          && isStaleProvisioning(current, now)
          && current.companyId === null),
    );
    if (!inFlight(request)) throw new ConflictException(inFlight.rejectionCode);
    await this.core.advance(request.id, 'SUSPENDED', correlationRequestId, 'admin_suspended', inFlight);
    await this.tokens.revokeAll(request.id);
    await this.prisma.client.companySignupRequest.update({
      where: { id: request.id },
      data: { pendingPasswordHash: null },
    });
    await this.audit(request.id, adminUserId, correlationRequestId, 'signup.line.suspended', {
      source: request.source,
      fromState: request.state,
      wasAutoApproved: request.autoApproved,
    });
    return { requestId: request.id, state: 'SUSPENDED' };
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

/** The one shop a repeat applicant already had, and how it stands today. */
type PriorCompany = { name: string; state: 'ACTIVE' | 'EXPIRED' | 'CLOSED' };

const identityKey = (channelId: string, providerUserId: string) => `${channelId}:${providerUserId}`;

function toQueueItem(
  request: CompanySignupRequest,
  knownEmails: Set<string | null>,
  companyByTaxId: Map<string | null, string>,
  companyByPhone: Map<string, string>,
  priorCompanies: Map<string, PriorCompany>,
  now: Date,
): AdminSignupQueueItemDto {
  const priorCompany = priorCompanies.get(request.id);
  const taxIdMatch = request.taxId ? companyByTaxId.get(request.taxId) : undefined;
  const phoneMatch = request.phoneNumber ? companyByPhone.get(request.phoneNumber) : undefined;
  const approvalAge = daysSinceApproval(request.approvedAt, now);
  return {
    requestId: request.id,
    state: request.state,
    companyName: request.companyName,
    ownerDisplayName: request.ownerDisplayName,
    // Omitted rather than blanked when the application came from LINE: the queue shows "—" and no
    // reader can mistake an empty string for a real address (review B-03).
    ...(request.contactEmail ? { contactEmail: request.contactEmail } : {}),
    ...(request.phoneNumber ? { phoneNumber: request.phoneNumber } : {}),
    ...(request.businessType ? { businessType: request.businessType } : {}),
    ...(request.vatRegistered !== null ? { vatRegistered: request.vatRegistered } : {}),
    ...(request.taxId ? { taxId: request.taxId } : {}),
    ...(request.requestedOfferKey ? { requestedOfferKey: request.requestedOfferKey } : {}),
    ...(request.mxValid !== null ? { mxValid: request.mxValid } : {}),
    // P10-L §8: the operator has to be able to tell the two sources apart at a glance, and a LINE
    // row shows a LINE name and an acceptance time where a web row shows an address and MX.
    source: request.source,
    ...(request.lineDisplayName ? { lineDisplayName: request.lineDisplayName } : {}),
    ...(request.autoApproved ? { autoApproved: true } : {}),
    // Decided at submit from the verified ID token, so by the time an operator reads it this is a
    // fact about what approving WILL do, not something they are being asked to choose (spec §5).
    ...(request.attachUserId ? { attachesToExistingAccount: true } : {}),
    // Whether a PROVISIONING row is still being worked on or was abandoned. The server owns this
    // judgement because it owns the clock the fence uses; the page must not guess it.
    ...(isStaleProvisioning(request, now) ? { staleProvisioning: true } : {}),
    // Whether this application built a shop yet. The page needs it to know that a targeted suspend
    // strands nothing, and the operator needs it to know which link to open.
    ...(request.companyId ? { companyId: request.companyId } : {}),
    ...(request.legalAcceptedAt ? { legalAcceptedAt: request.legalAcceptedAt.toISOString() } : {}),
    createdAt: request.createdAt.toISOString(),
    ...(request.approvedAt ? { approvedAt: request.approvedAt.toISOString() } : {}),
    ...(request.claimEmailLastSentAt ? { claimEmailLastSentAt: request.claimEmailLastSentAt.toISOString() } : {}),
    // Hint only. Spec §4C is explicit that the attach decision is made by the applicant at the
    // claim page, never by the admin from this flag.
    emailMatchesExistingUser: knownEmails.has(request.contactEmail),
    ...(taxIdMatch ? { taxIdMatchesCompanyName: taxIdMatch } : {}),
    ...(phoneMatch ? { phoneMatchesCompanyName: phoneMatch } : {}),
    ...(approvalAge !== undefined ? { daysSinceApproval: approvalAge } : {}),
    emailDeliveryFailed: request.state === 'EMAIL_FAILED',
    // Owner 2026-09-05: the repeat-trial hint. Nothing is blocked — the operator is simply told
    // which shop this LINE account had before, and whether it is closed, expired or still running.
    ...(priorCompany ? { priorCompanyName: priorCompany.name, priorCompanyState: priorCompany.state } : {}),
    // Why the last provisioning stopped, so "เปิดร้านไม่สำเร็จ" can name a cause an admin can act on.
    ...(request.failureCode ? { failureCode: request.failureCode } : {}),
  };
}
