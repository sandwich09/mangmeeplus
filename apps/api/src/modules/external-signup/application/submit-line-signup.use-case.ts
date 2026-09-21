import {
  BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import type { LineSignupIntent, LineSignupSubmitAcceptedDto, SignupDiscoverySource } from '@watchdog-bms/contracts';
import type { CompanySignupRequest, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { canonicalFingerprint } from '../../../common/security/canonical-fingerprint';
import { AuthRateLimitService } from '../../auth/application/auth-rate-limit.service';
import { LineIdTokenService } from '../../auth/application/line-id-token.service';
import {
  legalEvidenceMatchesCurrentRelease,
  type LegalSignupEvidence,
} from '../../auth/application/legal-acceptance.service';
import { bangkokDayKey, bangkokDayStart } from '../domain/business-hours.logic';
import {
  LINE_OPEN_APPLICATION_STATES,
  OWNED_COMPANY_MEMBERSHIP,
  SIGNUP_SOURCE_LINE_OA,
  SIGNUP_SOURCE_EMAIL_OTP,
} from '../domain/company-signup.logic';
import {
  lineExternalSignupId,
  normalizeLineCompanyName,
  normalizeReferralCode,
  normalizeSignupDiscovery,
  requireThaiMobile,
  optionalLineContactEmail,
  LINE_OPTIONAL_EMAIL_POLICY,
  lineIntakeContactComplete,
  normalizeSignupSalesCode,
} from '../domain/line-signup.logic';
import { CompanySignupCoreService, signupStateGuard } from './company-signup-core.service';
import { lineSignupStatusForVerified, type VerifiedLineSignupIdentity } from './get-line-signup-status.use-case';
import { ProvisionSignupUseCase } from './provision-signup.use-case';
import { SignupAdminNotifyService } from './signup-admin-notify.service';
import { SignupOpsAlertService } from './signup-ops-alert.service';
import { SalesReferralService } from '../../sales-console/application/sales-referral.service';

export type SubmitLineSignupCommand = {
  /** LIFF ID token — the only identity input. */
  idToken: string;
  /** Stable client UUID. The server scopes it to the verified LINE identity. */
  submissionId: string;
  intent: LineSignupIntent;
  companyName: string;
  phoneNumber: string;
  /** Contact syntax is checked here; it is never proof of mailbox or account ownership. */
  contactEmail?: string | null;
  referralCode?: string;
  discoverySource?: SignupDiscoverySource | null;
  discoverySourceOther?: string | null;
  /** D6: the "รหัสเซลล์" field, only shown when discoverySource is 'SALES'. */
  referralSalesCode?: string | null;
  legal: {
    documentVersion: string;
    statementSha256: string;
    releaseFingerprintSha256: string;
    displayChallenge: string;
    locale: string;
  };
  userAgent?: string;
  correlationRequestId: string;
  webBaseUrl: string;
  apiBaseUrl: string;
};

type NormalizedLineSubmission = Readonly<{
  companyName: string;
  phoneNumber: string;
  contactEmail: string | null;
  referralCode: string | null;
  discoverySource: SignupDiscoverySource | null;
  discoverySourceOther: string | null;
  /** Upper-cased here; resolved to an agent by the use-case, which needs the database. */
  referralSalesCode: string | null;
  intent: LineSignupIntent;
  legal: SubmitLineSignupCommand['legal'];
}>;

type ResumeUrls = Readonly<{ webBaseUrl: string; apiBaseUrl: string }>;

export type CorrectLineSignupContactCommand = Readonly<{
  requestId: string;
  idToken: string;
  version: number;
  contactEmail?: string | null;
  correlationRequestId: string;
  webBaseUrl: string;
  apiBaseUrl: string;
}>;

export type RetryOwnedLineSignupCommand = Readonly<{
  requestId: string;
  idToken: string;
  version: number;
  correlationRequestId: string;
  webBaseUrl: string;
  apiBaseUrl: string;
}>;

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class SubmitLineSignupUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly core: CompanySignupCoreService,
    private readonly lineIdToken: LineIdTokenService,
    private readonly rateLimit: AuthRateLimitService,
    private readonly adminNotify: SignupAdminNotifyService,
    private readonly provision: ProvisionSignupUseCase,
    private readonly opsAlerts: SignupOpsAlertService,
    private readonly salesReferral: SalesReferralService,
  ) {}

  async execute(cmd: SubmitLineSignupCommand, now = new Date()): Promise<LineSignupSubmitAcceptedDto> {
    const verified = await this.lineIdToken.verify(cmd.idToken);
    await this.rateLimit.assertLineSignupAttemptAllowed(verified.providerUserId);
    const normalized = normalizeSubmission(cmd);
    const externalSignupId = lineExternalSignupId(verified.channelId, verified.providerUserId, cmd.submissionId);
    const payloadHash = lineSignupPayloadHash(normalized, verified);

    // Exact key first, including terminal rows: a lost COMPLETED response must never become a new
    // shop merely because COMPLETED no longer occupies the open-application partial index.
    const exact = await this.prisma.client.companySignupRequest.findUnique({ where: { externalSignupId } });
    if (exact) {
      if (!sameLineSubmission(exact, normalized, verified, payloadHash)) {
        throw new ConflictException('line_signup_submission_conflict');
      }
      await this.resumeIntake(exact.id, cmd.correlationRequestId, cmd, now);
      return lineSignupStatusForVerified(this.prisma, this.config, verified, now, exact.id);
    }

    // A refreshed legacy page may have lost its old server-minted UUID. Return and repair that
    // open request; a fresh client key is not permission to step around the identity fence.
    const open = await this.findOpenRequest(verified);
    if (open) {
      await this.resumeIntake(open.id, cmd.correlationRequestId, cmd, now);
      return lineSignupStatusForVerified(this.prisma, this.config, verified, now, open.id);
    }

    const current = await lineSignupStatusForVerified(this.prisma, this.config, verified, now);
    if (cmd.intent === 'FIRST_SHOP' && current.eligibleCompanies.some((company) => company.canEnter)) {
      return current;
    }

    // Current legal text is required only for a genuinely new request. A byte-identical replay
    // keeps the evidence accepted when it first committed; retry never fabricates fresh consent.
    const evidence: LegalSignupEvidence = { ...cmd.legal, userAgent: cmd.userAgent ?? null, legalAcceptedAt: now };
    if (!legalEvidenceMatchesCurrentRelease(evidence)) throw new ConflictException('legal_release_changed');

    const identity = await this.resolveLineIdentity(verified.providerUserId, verified.channelId);
    await this.rateLimit.assertLineSignupUserAllowed(verified.providerUserId);
    // D6: an unknown or suspended code is refused here, before a row exists, so a shop is never
    // created carrying attribution nobody can honour. Resolution needs the database, which is why
    // it lives here and not in the pure normaliser.
    const referral = await this.salesReferral.resolveCode(normalized.referralSalesCode);
    const received = await this.create({
      externalSignupId,
      payloadHash,
      ...normalized,
      referralSalesUserId: referral?.userId ?? null,
      attachUserId: identity.attachUserId,
      verified,
      evidence,
      correlationRequestId: cmd.correlationRequestId,
    });
    await this.resumeIntake(received.request.id, cmd.correlationRequestId, cmd, now);
    return lineSignupStatusForVerified(this.prisma, this.config, verified, now, received.request.id);
  }

  /** Admin RETRY_INTAKE uses persisted input and the same recovery path; it never approves. */
  async retryIntake(
    requestId: string,
    expectedVersion: number,
    correlationRequestId: string,
    urls: ResumeUrls,
    now = new Date(),
  ): Promise<CompanySignupRequest> {
    await this.resumeIntake(requestId, correlationRequestId, urls, now, expectedVersion);
    const request = await this.prisma.client.companySignupRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new ConflictException('company_signup_request_not_found');
    return request;
  }

  async correctContactEmail(
    cmd: CorrectLineSignupContactCommand,
    now = new Date(),
  ): Promise<LineSignupSubmitAcceptedDto> {
    const verified = await this.lineIdToken.verify(cmd.idToken);
    await this.rateLimit.assertLineSignupAttemptAllowed(verified.providerUserId);
    let contactEmail: string | null;
    try {
      contactEmail = optionalLineContactEmail(cmd.contactEmail);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const corrected = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cmd.requestId}, 0))`;
      const current = await tx.companySignupRequest.findFirst({
        where: {
          id: cmd.requestId,
          source: SIGNUP_SOURCE_LINE_OA,
          lineProviderUserId: verified.providerUserId,
          lineChannelId: verified.channelId,
        },
      });
      if (!current) throw new NotFoundException('company_signup_request_not_found');
      if (current.version !== cmd.version) throw new ConflictException('line_signup_version_conflict');
      if (!['RECEIVED', 'VALIDATED', 'PENDING_REVIEW'].includes(current.state)
        || current.companyId || current.resolvedExistingCompanyId || current.provisioningAttemptId
        || current.autoApproved || current.reviewResolution === 'NEW_SHOP') {
        throw new ConflictException('line_signup_contact_update_not_allowed');
      }
      if (!contactEmail && !current.intakePolicyVersion &&
          (!current.phoneNumber || !current.legalAcceptedAt || !current.legalStatementSha256 ||
            !current.legalReleaseFingerprintSha256 || !current.legalDocumentVersion || !current.legalDisplayChallenge)) {
        throw new ConflictException('line_signup_legacy_evidence_required');
      }
      const normalized: NormalizedLineSubmission = {
        companyName: current.companyName,
        phoneNumber: current.phoneNumber ?? '',
        contactEmail,
        referralCode: current.referralCode,
        ...normalizeSignupDiscovery(current.discoverySource, current.discoverySourceOther),
        referralSalesCode: current.referralSalesCode,
        intent: current.lineSignupIntent === 'ADD_SHOP' ? 'ADD_SHOP' : 'FIRST_SHOP',
        legal: {
          documentVersion: current.legalDocumentVersion ?? '',
          statementSha256: current.legalStatementSha256 ?? '',
          releaseFingerprintSha256: current.legalReleaseFingerprintSha256 ?? '',
          displayChallenge: current.legalDisplayChallenge ?? '',
          locale: current.legalLocale ?? 'th',
        },
      };
      const updated = await tx.companySignupRequest.update({
        where: { id: current.id },
        data: {
          contactEmail,
          intakePolicyVersion: LINE_OPTIONAL_EMAIL_POLICY,
          payloadHash: lineSignupPayloadHash(normalized, verified),
          state: 'RECEIVED',
          failureCode: null,
          contactEmailConflict: current.contactEmailConflict === true ? true : null,
          reviewResolution: null,
          resolutionNote: null,
          resolvedExistingCompanyId: null,
          resolvedAt: null,
          resolvedByUserId: null,
          repeatTrialGrantedAt: null,
          repeatTrialGrantedByUserId: null,
          repeatTrialGrantNote: null,
          sharedContactReviewedAt: null,
          sharedContactReviewedByUserId: null,
          sharedContactReviewNote: null,
          businessCategory: null,
          version: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'SERVICE',
          actorRefId: 'line-signup',
          action: 'signup.line.contact_email_corrected',
          targetType: 'company_signup_request',
          targetId: current.id,
          requestId: cmd.correlationRequestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { fromState: current.state, invalidatedPriorReview: true },
        },
      });
      return updated;
    });

    await this.resumeIntake(cmd.requestId, cmd.correlationRequestId, cmd, now, corrected.version);
    return lineSignupStatusForVerified(this.prisma, this.config, verified, now, cmd.requestId);
  }

  async retryOwnedIntake(
    cmd: RetryOwnedLineSignupCommand,
    now = new Date(),
  ): Promise<LineSignupSubmitAcceptedDto> {
    const verified = await this.lineIdToken.verify(cmd.idToken);
    await this.rateLimit.assertLineSignupAttemptAllowed(verified.providerUserId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cmd.requestId}, 0))`;
      const current = await tx.companySignupRequest.findFirst({
        where: {
          id: cmd.requestId,
          source: SIGNUP_SOURCE_LINE_OA,
          lineProviderUserId: verified.providerUserId,
          lineChannelId: verified.channelId,
        },
      });
      if (!current) throw new NotFoundException('company_signup_request_not_found');
      if (current.version !== cmd.version) throw new ConflictException('line_signup_version_conflict');
      if (!['RECEIVED', 'VALIDATED'].includes(current.state) || current.reviewResolution
        || current.companyId || current.resolvedExistingCompanyId || current.provisioningAttemptId) {
        throw new ConflictException('line_signup_retry_not_available');
      }
    });
    await this.resumeIntake(cmd.requestId, cmd.correlationRequestId, cmd, now, cmd.version);
    return lineSignupStatusForVerified(this.prisma, this.config, verified, now, cmd.requestId);
  }

  private async resumeIntake(
    requestId: string,
    correlationRequestId: string,
    urls: ResumeUrls,
    now: Date,
    expectedVersion?: number,
  ): Promise<void> {
    let request = await this.prisma.client.companySignupRequest.findUnique({ where: { id: requestId } });
    if (!request || request.source !== SIGNUP_SOURCE_LINE_OA) return;
    if (expectedVersion !== undefined && request.version !== expectedVersion) {
      throw new ConflictException('line_signup_version_conflict');
    }
    if (request.reviewResolution === 'REQUEST_INFO' || request.reviewResolution === 'PLAN_REVIEW') return;
    if (request.state === 'PENDING_REVIEW') {
      await this.adminNotify.enqueue(request.id);
      return;
    }
    if (request.state !== 'RECEIVED' && request.state !== 'VALIDATED') return;
    // A migrated partial row can exist in either intake state. Recovery must never turn the old
    // nullable shape into an implicit validation bypass; status exposes correction/support instead.
    if (!lineIntakeContactComplete(request)) return;

    const identity = await this.resolveLineIdentity(request.lineProviderUserId ?? '', request.lineChannelId ?? '');
    const repeatTrial = identity.userId !== null && await this.hasOwnedCompany(identity.userId);
    if (request.state === 'RECEIVED') {
      // Durable request id is the Redis idempotency key. A store failure leaves RECEIVED, so the
      // same request retries the same charge; once VALIDATED, this is never called again.
      if (request.lineSignupIntent !== null) {
        await this.rateLimit.recordLineSignupUser(request.lineProviderUserId ?? '', request.id);
      }
      const receivedVersion = request.version;
      request = (await this.core.advance(
        request.id,
        'VALIDATED',
        correlationRequestId,
        undefined,
        signupStateGuard(
          'line_signup_version_conflict',
          (current) => current.state === 'RECEIVED' && current.version === receivedVersion,
        ),
      )).request;
    }
    request = await this.recordContactReview(request.id, identity.attachUserId, repeatTrial, correlationRequestId);
    if (request.state !== 'VALIDATED') return;
    await this.decideAndRun(request, correlationRequestId, urls, now, repeatTrial);
  }

  private async recordContactReview(
    requestId: string,
    provenUserId: string | null,
    repeatTrial: boolean,
    correlationRequestId: string,
  ): Promise<CompanySignupRequest> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`;
      const current = await tx.companySignupRequest.findUnique({ where: { id: requestId } });
      if (!current || current.state !== 'VALIDATED' || current.contactEmailConflict !== null) return current!;
      const contactEmailConflict = current.contactEmail ? await lineSignupContactEmailConflict(
        tx,
        current.id,
        current.contactEmail,
        provenUserId,
      ) : false;
      const request = await tx.companySignupRequest.update({
        where: { id: current.id },
        data: { contactEmailConflict, version: { increment: 1 } },
      });
      await this.audit(request.id, 'signup.line.submitted', correlationRequestId, {
        source: SIGNUP_SOURCE_LINE_OA,
        existingAccount: identityAttachable(provenUserId),
        hasReferralCode: request.referralCode !== null,
        repeatTrial,
        emailPreviouslyUsed: contactEmailConflict,
        contactEmailPresent: Boolean(current.contactEmail),
        ...(contactEmailConflict ? { manualReviewReason: 'email_previously_used' } : {}),
      }, tx);
      return request;
    });
  }

  private async decideAndRun(
    request: CompanySignupRequest,
    correlationRequestId: string,
    urls: ResumeUrls,
    now: Date,
    repeatTrial: boolean,
  ): Promise<void> {
    const emailConflict = request.contactEmailConflict === true;
    if (request.autoApproved && request.reviewResolution === 'NEW_SHOP') {
      const actorUserId = (await this.adminNotify.activeSystemAdmins())[0]?.userId;
      if (!actorUserId) throw new ConflictException('signup_operator_unresolved');
      await this.provision.execute({
        requestId: request.id,
        actorUserId,
        operatorFromDirectory: true,
        correlationRequestId,
        ...urls,
      });
      return;
    }
    const priorRejection = await this.priorRejection(this.prisma.client, request);
    if (priorRejection) {
      await this.audit(request.id, 'signup.line.reapplication_review', correlationRequestId, {
        reason: 'prior_rejection_manual_review', priorRequestId: priorRejection.id,
      });
    }
    if (repeatTrial && this.config.lineSignupApprovalMode === 'AUTO_FREE') {
      await this.audit(request.id, 'signup.line.auto_approve_repeat_trial', correlationRequestId, {
        reason: 'repeat_trial_manual_review',
      });
    }
    if (this.config.lineSignupApprovalMode === 'AUTO_FREE' && !repeatTrial && !emailConflict && !priorRejection) {
      const actorUserId = (await this.adminNotify.activeSystemAdmins())[0]?.userId ?? null;
      const slot = actorUserId === null
        ? { claimed: false as const, approvedToday: 0 }
        : await this.claimAutoApproveSlot(request, now);
      if (slot.claimed) {
        await this.audit(request.id, 'signup.line.auto_approved', correlationRequestId, {
          approvedToday: slot.approvedToday, dailyCap: this.config.lineSignupAutoDailyCap,
        });
        await this.provision.execute({
          requestId: request.id,
          actorUserId: actorUserId!,
          operatorFromDirectory: true,
          correlationRequestId,
          ...urls,
        });
        return;
      }
      if ('priorRejectedRequestId' in slot && slot.priorRejectedRequestId) {
        await this.audit(request.id, 'signup.line.reapplication_review', correlationRequestId, {
          reason: 'prior_rejection_manual_review', priorRequestId: slot.priorRejectedRequestId,
        });
      } else {
        await this.audit(
          request.id,
          actorUserId === null ? 'signup.line.auto_approve_no_actor' : 'signup.line.auto_approve_capped',
          correlationRequestId,
          { approvedToday: slot.approvedToday, dailyCap: this.config.lineSignupAutoDailyCap },
        );
        if (actorUserId !== null) await this.opsAlerts.raise('auto_cap_reached', now);
      }
    }

    const expectedVersion = request.version;
    await this.core.advance(
      request.id,
      'PENDING_REVIEW',
      correlationRequestId,
      undefined,
      signupStateGuard(
        'line_signup_version_conflict',
        (current) => current.state === 'VALIDATED' && current.version === expectedVersion,
      ),
    );
    await this.adminNotify.enqueue(request.id);
  }

  private priorRejection(client: Pick<Prisma.TransactionClient, 'companySignupRequest'>, request: CompanySignupRequest) {
    return client.companySignupRequest.findFirst({
      where: {
        id: { not: request.id }, source: SIGNUP_SOURCE_LINE_OA, state: 'REJECTED',
        lineProviderUserId: request.lineProviderUserId, lineChannelId: request.lineChannelId,
      },
      orderBy: { createdAt: 'desc' }, select: { id: true },
    });
  }

  private async claimAutoApproveSlot(
    request: CompanySignupRequest,
    now: Date,
  ): Promise<{ claimed: boolean; approvedToday: number; priorRejectedRequestId?: string }> {
    const lockKey = `line-signup-auto-cap:${bangkokDayKey(now)}`;
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${request.id}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const current = await tx.companySignupRequest.findUnique({ where: { id: request.id } });
      if (!current || current.state !== 'VALIDATED' || current.version !== request.version) {
        throw new ConflictException('line_signup_version_conflict');
      }
      if (current.autoApproved && current.reviewResolution === 'NEW_SHOP') {
        const approvedToday = await tx.companySignupRequest.count({
          where: { source: { in: [SIGNUP_SOURCE_LINE_OA, SIGNUP_SOURCE_EMAIL_OTP] }, autoApproved: true, ...approvedOnOrCreatedToday(now) },
        });
        return { claimed: true, approvedToday };
      }
      // Recheck at the claim boundary: changing contact data never clears rejection history.
      const prior = await this.priorRejection(tx, current);
      if (prior) return { claimed: false, approvedToday: 0, priorRejectedRequestId: prior.id };
      const crossChannel = await tx.companySignupRequest.findFirst({ where: {
        source: SIGNUP_SOURCE_EMAIL_OTP, OR: [
          ...(current.contactEmail ? [{ contactEmail: current.contactEmail }] : []),
          ...(current.phoneNumber ? [{ phoneNumber: current.phoneNumber }] : []),
          { companyName: current.companyName },
        ],
      }, select: { id: true } });
      if (crossChannel) return { claimed: false, approvedToday: 0 };
      const approvedToday = await tx.companySignupRequest.count({
        where: { source: { in: [SIGNUP_SOURCE_LINE_OA, SIGNUP_SOURCE_EMAIL_OTP] }, autoApproved: true, ...approvedOnOrCreatedToday(now) },
      });
      if (approvedToday >= this.config.lineSignupAutoDailyCap) return { claimed: false, approvedToday };
      await tx.companySignupRequest.update({
        where: { id: request.id },
        data: {
          autoApproved: true,
          approvedAt: now,
          reviewResolution: 'NEW_SHOP',
          resolvedAt: now,
          version: { increment: 1 },
        },
      });
      return { claimed: true, approvedToday };
    });
  }

  private async create(input: NormalizedLineSubmission & {
    externalSignupId: string;
    payloadHash: string;
    referralSalesUserId: string | null;
    attachUserId: string | null;
    verified: { providerUserId: string; channelId: string; displayName?: string };
    evidence: LegalSignupEvidence;
    correlationRequestId: string;
  }): Promise<{ request: CompanySignupRequest; replayed: boolean }> {
    const { verified, evidence } = input;
    try {
      return await this.core.receiveNormalized({
        source: SIGNUP_SOURCE_LINE_OA,
        externalSignupId: input.externalSignupId,
        payloadHash: input.payloadHash,
        companyName: input.companyName,
        ownerDisplayName: verified.displayName ?? 'เจ้าของร้าน',
        contactEmail: input.contactEmail,
        intakePolicyVersion: LINE_OPTIONAL_EMAIL_POLICY,
        consentVersion: evidence.documentVersion,
        phoneNumber: input.phoneNumber,
        ...(input.referralCode ? { referralCode: input.referralCode } : {}),
        discoverySource: input.discoverySource,
        discoverySourceOther: input.discoverySourceOther,
        referralSalesCode: input.referralSalesCode,
        referralSalesUserId: input.referralSalesUserId,
        ...(input.attachUserId ? { attachUserId: input.attachUserId } : {}),
        lineProviderUserId: verified.providerUserId,
        lineChannelId: verified.channelId,
        ...(verified.displayName ? { lineDisplayName: verified.displayName } : {}),
        lineSignupIntent: input.intent,
        legalDocumentVersion: evidence.documentVersion,
        legalStatementSha256: evidence.statementSha256,
        legalReleaseFingerprintSha256: evidence.releaseFingerprintSha256,
        legalDisplayChallenge: evidence.displayChallenge,
        legalLocale: evidence.locale,
        legalUserAgent: evidence.userAgent?.slice(0, 512) ?? null,
        legalAcceptedAt: evidence.legalAcceptedAt,
      }, input.correlationRequestId);
    } catch (error) {
      if (isPayloadConflict(error)) throw new ConflictException('line_signup_submission_conflict');
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        const open = await this.findOpenRequest(verified);
        if (open) return { request: open, replayed: true };
        throw new ConflictException('line_signup_already_pending');
      }
      throw error;
    }
  }

  private findOpenRequest(verified: VerifiedLineSignupIdentity): Promise<CompanySignupRequest | null> {
    return this.prisma.client.companySignupRequest.findFirst({
      where: {
        source: SIGNUP_SOURCE_LINE_OA,
        lineProviderUserId: verified.providerUserId,
        lineChannelId: verified.channelId,
        state: { in: [...LINE_OPEN_APPLICATION_STATES] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async resolveLineIdentity(
    providerUserId: string,
    channelId: string,
  ): Promise<{ attachUserId: string | null; userId: string | null }> {
    const identity = await this.prisma.client.externalIdentity.findFirst({
      where: { provider: 'LINE', providerUserId, providerChannelId: channelId },
      select: { status: true, userId: true, user: { select: { status: true } } },
    });
    if (!identity) return { attachUserId: null, userId: null };
    if (identity.status === 'DISABLED') throw new ConflictException('line_signup_identity_disabled');
    if (identity.user.status !== 'ACTIVE') throw new ConflictException('line_signup_account_blocked');
    if (identity.status === 'UNLINKED') return { attachUserId: null, userId: identity.userId };
    if (identity.status !== 'ACTIVE') throw new ConflictException('line_signup_account_blocked');
    return { attachUserId: identity.userId, userId: identity.userId };
  }

  private async hasOwnedCompany(userId: string): Promise<boolean> {
    return (await this.prisma.client.companyMembership.count({
      where: { userId, ...OWNED_COMPANY_MEMBERSHIP },
    })) > 0;
  }

  private async audit(
    requestId: string,
    action: string,
    correlationRequestId: string,
    metadata: Record<string, string | number | boolean | null>,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await (tx ?? this.prisma.client).auditLog.create({
      data: {
        actorType: 'SERVICE',
        actorRefId: action === 'signup.line.auto_approved' ? 'line-signup-auto-approve' : 'line-signup',
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

function approvedOnOrCreatedToday(now: Date) {
  const start = bangkokDayStart(now);
  return {
    OR: [
      { approvedAt: { gte: start } },
      { approvedAt: null, createdAt: { gte: start } },
    ],
  };
}

function normalizeSubmission(cmd: SubmitLineSignupCommand): NormalizedLineSubmission {
  try {
    if (cmd.intent !== 'FIRST_SHOP' && cmd.intent !== 'ADD_SHOP') {
      throw new Error('line_signup_intent_invalid');
    }
    return {
      companyName: normalizeLineCompanyName(cmd.companyName),
      phoneNumber: requireThaiMobile(cmd.phoneNumber),
      contactEmail: optionalLineContactEmail(cmd.contactEmail),
      referralCode: normalizeReferralCode(cmd.referralCode),
      ...normalizeSignupDiscovery(cmd.discoverySource, cmd.discoverySourceOther),
      referralSalesCode: normalizeSignupSalesCode(cmd.discoverySource, cmd.referralSalesCode),
      intent: cmd.intent,
      legal: cmd.legal,
    };
  } catch (error) {
    const code = (error as Error).message;
    if (code.startsWith('line_signup_phone_') || code.startsWith('line_signup_email_') || code.startsWith('line_signup_discovery_')) {
      throw new BadRequestException(code);
    }
    throw new UnprocessableEntityException(code);
  }
}

export function lineSignupPayloadHash(
  input: NormalizedLineSubmission,
  verified: VerifiedLineSignupIdentity,
): string {
  return canonicalFingerprint({
    companyName: input.companyName,
    phoneNumber: input.phoneNumber,
    contactEmail: input.contactEmail,
    referralCode: input.referralCode,
    // Keep legacy fingerprints byte-equivalent when this optional question was omitted.
    ...(input.discoverySource ? { discoverySource: input.discoverySource, discoverySourceOther: input.discoverySourceOther } : {}),
    // Same rule for the sales code: a form that never showed the field hashes exactly as before.
    ...(input.referralSalesCode ? { referralSalesCode: input.referralSalesCode } : {}),
    intent: input.intent,
    legal: input.legal,
    lineProviderUserId: verified.providerUserId,
    lineChannelId: verified.channelId,
  });
}

function sameLineSubmission(
  request: CompanySignupRequest,
  input: NormalizedLineSubmission,
  verified: VerifiedLineSignupIdentity,
  payloadHash: string,
): boolean {
  if (request.source !== SIGNUP_SOURCE_LINE_OA
    || request.lineProviderUserId !== verified.providerUserId
    || request.lineChannelId !== verified.channelId) return false;
  if (request.payloadHash === payloadHash) return true;
  // Rows created before client-stable submission ids did not hash intent/legal. Compare their
  // immutable stored values once so an in-flight legacy customer can resume safely.
  return request.lineSignupIntent === null
    && input.intent === 'FIRST_SHOP'
    && request.companyName === input.companyName
    && request.phoneNumber === input.phoneNumber
    && request.contactEmail === input.contactEmail
    && request.referralCode === input.referralCode
    && (request.discoverySource ?? null) === input.discoverySource
    && (request.discoverySourceOther ?? null) === input.discoverySourceOther
    && (request.referralSalesCode ?? null) === input.referralSalesCode
    && request.legalDocumentVersion === input.legal.documentVersion
    && request.legalStatementSha256 === input.legal.statementSha256
    && request.legalReleaseFingerprintSha256 === input.legal.releaseFingerprintSha256
    && request.legalDisplayChallenge === input.legal.displayChallenge
    && request.legalLocale === input.legal.locale;
}

export async function lineSignupContactEmailConflict(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  requestId: string,
  email: string,
  provenUserId: string | null,
): Promise<boolean> {
  if (!email.trim()) return false;
  const matches = await db.$queryRaw<Array<{ id: string }>>`
    SELECT u."id" FROM "User" u
      WHERE (${provenUserId}::text IS NULL OR u."id" <> ${provenUserId})
        AND (lower(btrim(u."email")) = ${email} OR lower(btrim(u."username")) = ${email})
    UNION ALL
    SELECT c."id" FROM "Company" c
      WHERE lower(btrim(c."email")) = ${email}
        AND NOT EXISTS (
          SELECT 1 FROM "CompanyMembership" cm
          JOIN "MembershipRole" mr ON mr."membershipId" = cm."id"
          JOIN "Role" r ON r."id" = mr."roleId"
          WHERE cm."companyId" = c."id" AND cm."userId" = ${provenUserId}
            AND cm."status" = 'ACTIVE' AND r."status" = 'ACTIVE'
        )
    UNION ALL
    SELECT csr."id" FROM "CompanySignupRequest" csr
      WHERE csr."id" <> ${requestId} AND lower(btrim(csr."contactEmail")) = ${email}
        AND NOT (
          (
            csr."companyId" IS NULL AND csr."resolvedExistingCompanyId" IS NULL
            AND (
              (csr."state" = 'REJECTED' AND csr."failureCode" IS NULL)
              OR (csr."state" = 'EXPIRED' AND (csr."failureCode" IS NULL OR csr."failureCode" = 'claim_not_started'))
            )
          )
          OR (
            csr."state" = 'COMPLETED'
            AND EXISTS (
              SELECT 1 FROM "CompanyMembership" own_cm
              JOIN "MembershipRole" own_mr ON own_mr."membershipId" = own_cm."id"
              JOIN "Role" own_r ON own_r."id" = own_mr."roleId"
              JOIN "Company" own_c ON own_c."id" = own_cm."companyId"
              LEFT JOIN "CompanyPlanTerm" own_pt ON own_pt."companyId" = own_c."id"
              WHERE own_cm."companyId" = COALESCE(csr."companyId", csr."resolvedExistingCompanyId")
                AND own_cm."userId" = ${provenUserId}
                AND own_cm."status" = 'ACTIVE' AND own_r."status" = 'ACTIVE'
                AND (own_c."status" = 'ACTIVE'
                  OR (own_c."status" = 'DISABLED' AND own_pt."termDisabledAt" IS NOT NULL))
            )
          )
        )
    LIMIT 1
  `;
  return matches.length > 0;
}

function identityAttachable(provenUserId: string | null): boolean {
  return provenUserId !== null;
}

function isPayloadConflict(error: unknown): boolean {
  return error instanceof ConflictException
    && JSON.stringify(error.getResponse()).includes('external_signup_payload_conflict');
}
