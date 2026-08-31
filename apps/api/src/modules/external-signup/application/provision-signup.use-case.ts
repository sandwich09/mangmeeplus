import { ConflictException, Injectable } from '@nestjs/common';
import { COMPANY_BUSINESS_CATEGORIES, type CompanyBusinessCategory } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { CreateCompanyOnboardingUseCase } from '../../system-onboarding/application/use-cases/create-company-onboarding.use-case';
import { CompanySignupCoreService } from './company-signup-core.service';
import { applyPlanTermPreset } from '../../system-partner-management/application/use-cases/company-plan-term.use-cases';
import { suggestedUsernameFromEmail } from '../domain/account-claim.logic';

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

    try {
      const result = await this.onboarding.execute({
        companyName: request.companyName,
        businessCategory: mapBusinessCategory(request.businessType),
        ...(request.taxId ? { taxId: request.taxId } : {}),
        ownerDisplayName: request.ownerDisplayName,
        ownerUsername: cmd.username ?? suggestedUsernameFromEmail(request.contactEmail) ?? request.contactEmail,
        claimedOwner: {
          email: request.contactEmail,
          ...(request.phoneNumber ? { phoneNumber: request.phoneNumber } : {}),
          ...(attachUserId ? { attachUserId } : {}),
          ...(!attachUserId && request.pendingPasswordHash ? { passwordHash: request.pendingPasswordHash } : {}),
        },
        // Spec §4C: two shops may legitimately share a name; only the admin console keeps the guard.
        allowDuplicateCompanyName: true,
        // Owner decision (UAT round 1): a self-signed-up trial shop starts on the "เริ่มต้น" menu
        // preset; the admin can widen it later from the partner console.
        modulePackage: 'starter',
        // The approving admin is the actor of record for everything this provisioning creates.
        requestingAdminUserId: request.approvedByUserId ?? request.id,
        requestId: cmd.correlationRequestId,
        webBaseUrl: cmd.webBaseUrl,
        apiBaseUrl: cmd.apiBaseUrl,
      });

      // Spec §3: the form's VAT answer is stored as company state only. No `VatFact` is written,
      // because the form never asked for an effectiveFrom and the fact would be a guess.
      if (request.vatRegistered !== null) {
        await this.prisma.client.company.update({
          where: { id: result.companyId },
          data: { vatRegistered: request.vatRegistered },
        });
      }

      // Trial clock starts at provision, not approval (spec §4D ⑤): PRO preset, 30 days.
      // applyPlanTermPreset is idempotent — a provisioning retry can never shorten the term.
      await applyPlanTermPreset(this.prisma, result.companyId, 'PRO_999', 30, request.approvedByUserId ?? null);

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

      // Spec §4F: the LINE step lives on the success page and may be skipped, so the request
      // parks here rather than at COMPLETED.
      await this.core.advance(request.id, 'LINE_LINK_PENDING', cmd.correlationRequestId);

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
}

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
