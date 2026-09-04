import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { LineSignupSubmitAcceptedDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { canonicalFingerprint } from '../../../common/security/canonical-fingerprint';
import { AuthRateLimitService } from '../../auth/application/auth-rate-limit.service';
import { LineIdTokenService } from '../../auth/application/line-id-token.service';
import {
  legalEvidenceMatchesCurrentRelease,
  type LegalSignupEvidence,
} from '../../auth/application/legal-acceptance.service';
import { bangkokDayStart, isBusinessHours } from '../domain/business-hours.logic';
import { SIGNUP_SOURCE_LINE_OA } from '../domain/company-signup.logic';
import {
  lineExternalSignupId,
  normalizeLineCompanyName,
  normalizeReferralCode,
  normalizeThaiMobile,
} from '../domain/line-signup.logic';
import { CompanySignupCoreService } from './company-signup-core.service';
import { ProvisionSignupUseCase } from './provision-signup.use-case';
import { SignupAdminNotifyService } from './signup-admin-notify.service';

export type SubmitLineSignupCommand = {
  /** LIFF ID token — the only identity input. */
  idToken: string;
  companyName: string;
  phoneNumber?: string;
  referralCode?: string;
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

/** Postgres unique violation — here, only the partial "one open application per LINE" index. */
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
  ) {}

  async execute(cmd: SubmitLineSignupCommand, now = new Date()): Promise<LineSignupSubmitAcceptedDto> {
    // Identity first: nothing below may run on a claim the token did not prove (SEC-01).
    const verified = await this.lineIdToken.verify(cmd.idToken);
    // Charged only now, because only now do we know whose quota this is (spec §9).
    await this.rateLimit.assertLineSignupUserAllowed(verified.providerUserId);

    // LEGAL-LIFF-01: the acceptance time is the server's, never the client's (spec §3.2).
    const evidence: LegalSignupEvidence = { ...cmd.legal, userAgent: cmd.userAgent ?? null, legalAcceptedAt: now };
    if (!legalEvidenceMatchesCurrentRelease(evidence)) {
      // The page was open while a new release landed. Reloading is the only honest fix — accepting
      // it anyway would record consent to text this person never saw.
      throw new ConflictException('legal_release_changed');
    }

    let companyName: string;
    let phoneNumber: string | null;
    let referralCode: string | null;
    try {
      companyName = normalizeLineCompanyName(cmd.companyName);
      phoneNumber = normalizeThaiMobile(cmd.phoneNumber);
      referralCode = normalizeReferralCode(cmd.referralCode);
    } catch (error) {
      throw new UnprocessableEntityException((error as Error).message);
    }

    // Spec §5: a LINE account that already belongs to an active user opens a SECOND shop for that
    // account rather than a second account. Decided here, from proof, not by an admin from a hint.
    const attachUserId = await this.existingOwnerUserId(verified.providerUserId, verified.channelId);

    const externalSignupId = lineExternalSignupId(verified.channelId, verified.providerUserId, randomUUID());
    const request = await this.create({
      externalSignupId,
      companyName,
      phoneNumber,
      referralCode,
      attachUserId,
      verified,
      evidence,
      correlationRequestId: cmd.correlationRequestId,
    });

    await this.core.advance(request.id, 'VALIDATED', cmd.correlationRequestId);
    await this.audit(request.id, 'signup.line.submitted', cmd.correlationRequestId, {
      source: SIGNUP_SOURCE_LINE_OA,
      existingAccount: attachUserId !== null,
      hasPhoneNumber: phoneNumber !== null,
      hasReferralCode: referralCode !== null,
    });

    const businessHours = isBusinessHours(now, {
      days: this.config.lineSignupBusinessDays,
      hours: this.config.lineSignupBusinessHours,
    });
    const state = await this.decideAndRun(request.id, cmd, now);
    return { requestId: request.id, state, existingAccount: attachUserId !== null, businessHours };
  }

  /**
   * MANUAL sends every application to the admin queue. AUTO_FREE skips it and provisions inline —
   * the same shape the web claim page uses — but only under the daily cap: past it an application
   * falls back to MANUAL rather than opening the spend tap wider (spec §9 item 3).
   */
  private async decideAndRun(requestId: string, cmd: SubmitLineSignupCommand, now: Date): Promise<string> {
    if (this.config.lineSignupApprovalMode === 'AUTO_FREE') {
      const approvedToday = await this.prisma.client.companySignupRequest.count({
        where: { source: SIGNUP_SOURCE_LINE_OA, autoApproved: true, createdAt: { gte: bangkokDayStart(now) } },
      });
      if (approvedToday < this.config.lineSignupAutoDailyCap) {
        await this.prisma.client.companySignupRequest.update({
          where: { id: requestId },
          data: { autoApproved: true, approvedAt: now },
        });
        await this.audit(requestId, 'signup.line.auto_approved', cmd.correlationRequestId, {
          approvedToday, dailyCap: this.config.lineSignupAutoDailyCap,
        });
        // VALIDATED → PROVISIONING → READY → COMPLETED, all inside this call.
        await this.provision.execute({
          requestId,
          correlationRequestId: cmd.correlationRequestId,
          webBaseUrl: cmd.webBaseUrl,
          apiBaseUrl: cmd.apiBaseUrl,
        });
        return 'COMPLETED';
      }
      await this.audit(requestId, 'signup.line.auto_approve_capped', cmd.correlationRequestId, {
        approvedToday, dailyCap: this.config.lineSignupAutoDailyCap,
      });
    }

    await this.core.advance(requestId, 'PENDING_REVIEW', cmd.correlationRequestId);
    await this.adminNotify.enqueue(requestId);
    return 'PENDING_REVIEW';
  }

  private async create(input: {
    externalSignupId: string;
    companyName: string;
    phoneNumber: string | null;
    referralCode: string | null;
    attachUserId: string | null;
    verified: { providerUserId: string; channelId: string; displayName?: string };
    evidence: LegalSignupEvidence;
    correlationRequestId: string;
  }) {
    const { verified, evidence } = input;
    try {
      return await this.core.receiveNormalized({
        source: SIGNUP_SOURCE_LINE_OA,
        externalSignupId: input.externalSignupId,
        // Same canonical hashing Flow B uses; it is evidence of what was submitted, not a key.
        payloadHash: canonicalFingerprint({
          companyName: input.companyName,
          phoneNumber: input.phoneNumber,
          referralCode: input.referralCode,
          lineProviderUserId: verified.providerUserId,
          lineChannelId: verified.channelId,
        }),
        companyName: input.companyName,
        // The LINE profile name is the only name this form ever learns. A token without one is
        // legal, so the owner gets a neutral label rather than an empty string.
        ownerDisplayName: verified.displayName ?? 'เจ้าของร้าน',
        // `contactEmail` stays null: this flow never asks for an address (spec §5).
        // The clickwrap IS the consent record for this source, so it names the version it accepted.
        consentVersion: evidence.documentVersion,
        ...(input.phoneNumber ? { phoneNumber: input.phoneNumber } : {}),
        ...(input.referralCode ? { referralCode: input.referralCode } : {}),
        ...(input.attachUserId ? { attachUserId: input.attachUserId } : {}),
        lineProviderUserId: verified.providerUserId,
        lineChannelId: verified.channelId,
        ...(verified.displayName ? { lineDisplayName: verified.displayName } : {}),
        legalDocumentVersion: evidence.documentVersion,
        legalStatementSha256: evidence.statementSha256,
        legalReleaseFingerprintSha256: evidence.releaseFingerprintSha256,
        legalDisplayChallenge: evidence.displayChallenge,
        legalLocale: evidence.locale,
        legalUserAgent: evidence.userAgent?.slice(0, 512) ?? null,
        legalAcceptedAt: evidence.legalAcceptedAt,
      }, input.correlationRequestId);
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        // Review B-05: the partial unique index, not a use-case read, is what makes two fast taps
        // one application. The second tap is told the truth rather than given a duplicate.
        throw new ConflictException('line_signup_already_pending');
      }
      throw error;
    }
  }

  /** ACTIVE identity on OUR channel belonging to an ACTIVE user — anything else is not an owner. */
  private async existingOwnerUserId(providerUserId: string, channelId: string): Promise<string | null> {
    const identity = await this.prisma.client.externalIdentity.findFirst({
      where: {
        provider: 'LINE',
        providerUserId,
        providerChannelId: channelId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
      },
      select: { userId: true },
    });
    return identity?.userId ?? null;
  }

  /** Ids, booleans and counts only: no shop name, phone number or LINE user id in evidence. */
  private async audit(
    requestId: string,
    action: string,
    correlationRequestId: string,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        actorType: 'SERVICE',
        // Spec §5: an auto-approved application has no admin actor, so the machine that approved it
        // is named instead of leaving the actor blank.
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
