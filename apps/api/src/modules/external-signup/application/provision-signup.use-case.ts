import { ConflictException, Injectable } from '@nestjs/common';
import { COMPANY_BUSINESS_CATEGORIES, type CompanyBusinessCategory } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { CreateCompanyOnboardingUseCase } from '../../system-onboarding/application/use-cases/create-company-onboarding.use-case';
import { CompanySignupCoreService } from './company-signup-core.service';
import { suggestedUsernameFromEmail } from '../domain/account-claim.logic';
import { SIGNUP_SOURCE_LINE_OA } from '../domain/company-signup.logic';

export type ProvisionSignupCommand = {
  requestId: string;
  /** Chosen at the claim page. Absent on an admin retry, where the email local part is the default. */
  username?: string;
  correlationRequestId: string;
  webBaseUrl: string;
  apiBaseUrl: string;
};

export type ProvisionSignupResult = {
  companyId: string;
  companyName: string;
  attachedToExistingUser: boolean;
};

/**
 * Turns a claimed signup into a real company through the one onboarding service that owns company
 * creation (spec §2 rule 5). It never writes a Company, User or Membership itself — it only decides
 * which of the two owner shapes applies and hands that to `CreateCompanyOnboardingUseCase`.
 */
@Injectable()
export class ProvisionSignupUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CompanySignupCoreService,
    private readonly onboarding: CreateCompanyOnboardingUseCase,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: ProvisionSignupCommand): Promise<ProvisionSignupResult> {
    // The P10-0 fence decides the single winner. A second caller for the same request gets
    // claimed=false and simply reads back what the winner already created.
    const claim = await this.core.claimProvisioning(cmd.requestId, cmd.correlationRequestId);
    const request = claim.request;

    if (!claim.claimed) {
      if (!request.companyId) throw new ConflictException('signup_provisioning_in_progress');
      return {
        companyId: request.companyId,
        companyName: request.companyName,
        attachedToExistingUser: request.attachUserId !== null,
      };
    }

    const attachUserId = request.attachUserId;
    const existingOwner = attachUserId
      ? await this.prisma.client.user.findUnique({ where: { id: attachUserId }, select: { email: true } })
      : null;
    // Spec §4B: an attached account that already carries a different address keeps it. Recorded as
    // a boolean so an admin can see the decision happened without the addresses entering evidence.
    const emailKeptExisting = Boolean(existingOwner?.email && existingOwner.email !== request.contactEmail);
    // P10-L §6: which owner shape applies is decided by the row's source, once, here.
    const lineOa = request.source === SIGNUP_SOURCE_LINE_OA;

    try {
      const result = await this.onboarding.execute({
        companyName: request.companyName,
        businessCategory: mapBusinessCategory(request.businessType),
        ...(request.taxId ? { taxId: request.taxId } : {}),
        ownerDisplayName: request.ownerDisplayName,
        ...(lineOa ? this.lineOwnerShape(request) : this.emailOwnerShape(request, cmd.username)),
        // Spec §4C: two shops may legitimately share a name; only the admin console keeps the guard.
        allowDuplicateCompanyName: true,
        // Owner decision (UAT round 1): a self-signed-up trial shop starts on the "เริ่มต้น" menu
        // preset; the admin can widen it later from the partner console.
        modulePackage: 'starter',
        // Trial clock starts at provision, not approval (spec §4D ⑤): 30 days either way. The LINE
        // shop gets the 15-slip free trial (Owner 2026-09-04), the web form its PRO trial.
        // Review B-01: named HERE rather than upserted afterwards — onboarding creates the term
        // row, and a second `applyPlanTermPreset` against an existing row is a no-op.
        planTier: lineOa ? 'FREE_TRIAL_15' : 'PRO_999',
        planDays: 30,
        // The approving admin is the actor of record for everything this provisioning creates.
        // AUTO_FREE leaves no admin, so the application itself is the actor of record.
        requestingAdminUserId: request.approvedByUserId ?? request.id,
        requestId: cmd.correlationRequestId,
        webBaseUrl: cmd.webBaseUrl,
        apiBaseUrl: cmd.apiBaseUrl,
      });

      if (lineOa) await this.applyLineTrialGuards(result.companyId, request);

      // Spec §3: the form's VAT answer is stored as company state only. No `VatFact` is written,
      // because the form never asked for an effectiveFrom and the fact would be a guess.
      if (request.vatRegistered !== null) {
        await this.prisma.client.company.update({
          where: { id: result.companyId },
          data: { vatRegistered: request.vatRegistered },
        });
      }

      await this.core.completeProvisioning({
        requestId: request.id,
        attemptId: claim.attemptId!,
        companyId: result.companyId,
        ownerUserId: result.ownerId,
      correlationRequestId: cmd.correlationRequestId,
      });

      await this.prisma.client.$transaction([
        // The hash has moved into UserCredential; the copy on the request is now a liability (§4B).
        this.prisma.client.companySignupRequest.update({
          where: { id: request.id },
          data: { pendingPasswordHash: null },
        }),
        this.prisma.client.auditLog.create({
          data: {
            actorUserId: request.approvedByUserId ?? undefined,
            companyId: result.companyId,
            action: 'signup.request.provisioned',
            targetType: 'company_signup_request',
            targetId: request.id,
            requestId: cmd.correlationRequestId,
            result: 'SUCCESS',
            riskLevel: 'HIGH',
            // Booleans and ids only — no email, company name or tax id in evidence.
            metadataJson: {
              companyId: result.companyId,
              ownerUserId: result.ownerId,
              attachedToExistingUser: result.attachedExistingOwner,
              emailKeptExisting,
            },
          },
        }),
      ]);

      // Spec §4F: the LINE step lives on the success page and may be skipped, so the web-form
      // request parks at LINE_LINK_PENDING. A LINE application has nothing left to link — the
      // identity was created inside the company transaction — so it finishes (§5).
      await this.core.advance(request.id, lineOa ? 'COMPLETED' : 'LINE_LINK_PENDING', cmd.correlationRequestId);

      return {
        companyId: result.companyId,
        companyName: request.companyName,
        attachedToExistingUser: result.attachedExistingOwner,
      };
    } catch (error) {
      // Release the fence so an admin retry can claim it again, then surface the original failure.
      await this.core.failProvisioning({
        requestId: request.id,
        attemptId: claim.attemptId!,
        failureCode: failureCodeOf(error),
        correlationRequestId: cmd.correlationRequestId,
      });
      throw error;
    }
  }

  /**
   * Flow B. Review B-03: `contactEmail` is nullable now that a source without a mailbox exists, and
   * everything in this shape reads the address, so it is asserted once rather than defended per
   * field. An addressless row reaching here is a mis-routed source, not a customer problem.
   */
  private emailOwnerShape(request: SignupRow, username: string | undefined) {
    const contactEmail = request.contactEmail;
    if (!contactEmail) throw new ConflictException('signup_contact_email_missing');
    const attachUserId = request.attachUserId;
    return {
      ownerUsername: username ?? suggestedUsernameFromEmail(contactEmail) ?? contactEmail,
      claimedOwner: {
        email: contactEmail,
        ...(request.phoneNumber ? { phoneNumber: request.phoneNumber } : {}),
        ...(attachUserId ? { attachUserId } : {}),
        ...(!attachUserId && request.pendingPasswordHash ? { passwordHash: request.pendingPasswordHash } : {}),
      },
    };
  }

  /**
   * P10-L §6: no username, no email, no credential. The verified LINE identity is the whole
   * account, and the clickwrap the owner already gave on LIFF travels into the same transaction.
   */
  private lineOwnerShape(request: SignupRow) {
    if (!request.lineProviderUserId || !request.lineChannelId || !request.legalAcceptedAt) {
      // Submit writes identity and evidence together, so a row missing either is corrupt, not a
      // customer with a partial application — fail the fence rather than create half an account.
      throw new ConflictException('line_signup_evidence_missing');
    }
    const attachUserId = request.attachUserId;
    return {
      ownerAuth: {
        kind: 'line' as const,
        providerUserId: request.lineProviderUserId,
        channelId: request.lineChannelId,
        ...(request.lineDisplayName ? { displayName: request.lineDisplayName } : {}),
      },
      // Spec §5: this LINE account already owns a shop, so the new one joins that account.
      ...(attachUserId
        ? { claimedOwner: { ...(request.phoneNumber ? { phoneNumber: request.phoneNumber } : {}), attachUserId } }
        : {}),
      legalAcceptance: {
        documentVersion: request.legalDocumentVersion ?? '',
        statementSha256: request.legalStatementSha256 ?? '',
        releaseFingerprintSha256: request.legalReleaseFingerprintSha256 ?? '',
        displayChallenge: request.legalDisplayChallenge ?? '',
        locale: request.legalLocale ?? 'th',
        userAgent: request.legalUserAgent,
        legalAcceptedAt: request.legalAcceptedAt,
      },
    };
  }

  /**
   * The three things a free LINE trial needs that an ordinary company does not (spec §6, §9;
   * review G-06, B-06). All idempotent, so a provisioning retry re-applies the same values.
   */
  private async applyLineTrialGuards(companyId: string, request: SignupRow): Promise<void> {
    const now = new Date();
    await this.prisma.client.companyPlanTerm.update({
      where: { companyId },
      data: {
        // Anti-abuse: a brand-new free shop may read fewer slips in its first week than its tier
        // allows, until the window passes or an admin marks it checked.
        warmupUntil: new Date(now.getTime() + WARMUP_DAYS * 24 * 60 * 60 * 1000),
        warmupSlipLimit: this.config.lineSignupWarmupSlips,
      },
    });
    // Review G-06: without this a free trial shop spends the PLATFORM default AI budget. Same
    // upsert shape `set-partner-ai-model` uses, so there is one way this row comes into being.
    await this.prisma.client.companyAiConfiguration.upsert({
      where: { companyId },
      create: { companyId, monthlyBudgetSatang: this.config.lineFreeAiBudgetSatang },
      update: { monthlyBudgetSatang: this.config.lineFreeAiBudgetSatang },
    });
    // Review B-06: an owner with a second shop otherwise meets a company picker instead of the shop
    // they just opened. Same upsert the LINE link use-case does when it resolves a company.
    if (request.lineProviderUserId) {
      await this.prisma.client.lineCompanyContext.upsert({
        where: { lineUserId: request.lineProviderUserId },
        create: { lineUserId: request.lineProviderUserId, companyId, selectedAt: now },
        update: { companyId, selectedAt: now },
      });
    }
  }
}

/** Spec §9: the warm-up window is a week; only the slip ceiling inside it is configurable. */
const WARMUP_DAYS = 7;

/** The subset of `CompanySignupRequest` provisioning reads. */
type SignupRow = {
  id: string;
  source: string;
  companyName: string;
  contactEmail: string | null;
  phoneNumber: string | null;
  attachUserId: string | null;
  pendingPasswordHash: string | null;
  lineProviderUserId: string | null;
  lineChannelId: string | null;
  lineDisplayName: string | null;
  legalDocumentVersion: string | null;
  legalStatementSha256: string | null;
  legalReleaseFingerprintSha256: string | null;
  legalDisplayChallenge: string | null;
  legalLocale: string | null;
  legalUserAgent: string | null;
  legalAcceptedAt: Date | null;
};

/**
 * `businessType` is free text from the public form; `CompanyBusinessCategory` is a closed enum whose
 * only job is the PDPA health tripwire. An exact match is honoured, anything else becomes OTHER —
 * never a guess, because guessing "คลินิก" into CLINIC from arbitrary text would be a tripwire we
 * cannot defend. An admin corrects the category in company settings.
 */
export function mapBusinessCategory(businessType: string | null): CompanyBusinessCategory {
  const candidate = businessType?.trim().toUpperCase().replace(/[\s-]+/g, '_') ?? '';
  return (COMPANY_BUSINESS_CATEGORIES as readonly string[]).includes(candidate)
    ? (candidate as CompanyBusinessCategory)
    : 'OTHER';
}

function failureCodeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_').slice(0, 64) || 'provisioning_failed';
}
