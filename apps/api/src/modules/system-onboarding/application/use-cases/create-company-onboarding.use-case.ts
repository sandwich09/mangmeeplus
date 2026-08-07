import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  ALL_FEATURE_ENTITLEMENT_KEYS,
  civilDateToUtcDate,
  isCivilDate,
  isHealthAdjacentBusinessCategory,
  parentFeatureKey,
  type CivilDate,
  type CompanyBusinessCategory,
  type EmployeeLineLinkPackage,
  type VatFactStatus,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../../common/logger/security-event';
import { hashPassword } from '../../../auth/domain/logic/password-credential.logic';
import { encryptCredential } from '../../../system-partner-management/domain/logic/credential-cipher.logic';
import { DEFAULT_ENABLED_FEATURE_KEYS } from '../../../system-partner-management/domain/feature-registry';
import { PrismaWorkflowRepository } from '../../../workflow/infrastructure/prisma-workflow.repository';
import { autoEnableWorkflowTemplatesForCompany } from '../../../workflow/application/use-cases/workflow-template.use-case';
import {
  buildLineLinkPackage,
  generateLineLinkToken,
  OWNER_LINE_LINK_TOKEN_TTL_MS,
} from '../../../employee-access/domain/logic/employee-access.logic';
import {
  EXPLICIT_COHORT,
  NORMALIZER_VERSION,
} from '../../../employee-access/application/normalize-entitlements';
import {
  bootstrapCompanyChartOfAccounts,
  type ChartTemplateBootstrapSummary,
} from '../../../ledger/application/services/chart-template-bootstrap.service.js';
import {
  bootstrapCompanyTaxConfiguration,
  type TaxConfigBootstrapSummary,
} from '../../../tax/application/services/tax-config-bootstrap.service.js';

export type CreateCompanyOnboardingCommand = {
  companyName: string;
  /**
   * The company's VAT registration, answered by the admin at registration. OPTIONAL: an admin who
   * does not know leaves it out, the company stays UNKNOWN, and every reader behaves exactly as it
   * does today. Never guessed from anything else.
   */
  vatRegistration?: { status: VatFactStatus; effectiveFrom: CivilDate };
  businessCategory: CompanyBusinessCategory; // required: the PDPA tripwire's only input
  ownerDisplayName: string;
  ownerUsername: string;
  attachExistingOwner?: boolean; // true = ownerUsername must be an existing ACTIVE user; no new user/password
  modulePackage?: string;
  lineOaAddUrl?: string;
  lineLinkUrl?: string;
  requestingAdminUserId: string;
  requestId: string;
  webBaseUrl: string;
  apiBaseUrl: string;
};

export type CreateCompanyOnboardingResult = {
  onboardingRunId: string;
  companyId: string;
  ownerId: string;
  username: string;
  attachedExistingOwner: boolean;
  temporaryPassword?: string; // shown once; never logged; absent in attach mode (owner keeps existing password)
  handoffUrl: string;
  lineAddUrl?: string;
  lineLinkUrl?: string;
  ownerLineLink?: EmployeeLineLinkPackage; // single-use QR bound to the owner user only; absent when owner LINE is already linked
  chartOfAccounts: ChartTemplateBootstrapSummary;
  taxConfiguration: TaxConfigBootstrapSummary;
};

// ponytail: 9 bytes → 12 base64 chars, safe chars only
function generateTempPassword(): string {
  return randomBytes(9).toString('base64').replace(/[+/=]/g, 'x');
}

const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

@Injectable()
export class CreateCompanyOnboardingUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: CreateCompanyOnboardingCommand): Promise<CreateCompanyOnboardingResult> {
    const attach = cmd.attachExistingOwner === true;
    // Pre-transaction uniqueness checks (best-effort; conflict catch inside tx covers races)
    const [existingUser, existingCompany] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { username: cmd.ownerUsername }, select: { id: true, status: true } }),
      this.prisma.client.company.findFirst({ where: { name: cmd.companyName }, select: { id: true } }),
    ]);
    if (!attach && existingUser) throw new ConflictException(`Username "${cmd.ownerUsername}" is already taken.`);
    if (attach && (!existingUser || existingUser.status !== 'ACTIVE')) {
      throw new ConflictException(`Username "${cmd.ownerUsername}" does not match an active user to attach.`);
    }
    if (existingCompany) throw new ConflictException(`Company name "${cmd.companyName}" is already taken.`);
    // Same guard and message the VAT endpoint uses, so both answer paths reject the same strings.
    if (cmd.vatRegistration && !isCivilDate(cmd.vatRegistration.effectiveFrom)) {
      throw new UnprocessableEntityException('vatRegistration.effectiveFrom must be YYYY-MM-DD');
    }

    const ownerRole = await this.prisma.client.role.findUnique({
      where: { scopeKey_key: { scopeKey: 'system', key: 'OWNER' } },
    });
    if (!ownerRole) throw new NotFoundException('OWNER role not found. Run seed first.');

    // Attach mode: owner already chats with the OA; LINE company switching covers the new company, so no QR needed.
    const ownerHasLine = attach
      ? (await this.prisma.client.externalIdentity.findFirst({
          where: { userId: existingUser!.id, provider: 'LINE', status: 'ACTIVE' },
          select: { id: true },
        })) !== null
      : false;
    const issueLineLink = !ownerHasLine;

    const tempPassword = attach ? undefined : generateTempPassword();
    const passwordHash = tempPassword ? hashPassword(tempPassword) : undefined;
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_MS);
    // Owner QR travels with the credential handoff but is capped at 24h (H-09); regenerate-temporary-password reissues it.
    const lineLinkToken = issueLineLink ? generateLineLinkToken(OWNER_LINE_LINK_TOKEN_TTL_MS) : undefined;

    const result = await this.prisma.client.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name: cmd.companyName, businessCategory: cmd.businessCategory },
      });

      const owner = attach
        ? (await tx.user.findUniqueOrThrow({ where: { id: existingUser!.id } }))
        : await tx.user.create({
            data: { displayName: cmd.ownerDisplayName, username: cmd.ownerUsername, status: 'ACTIVE' },
          });

      if (passwordHash && tempPassword) {
        await tx.userCredential.create({
          data: {
            userId: owner.id,
            passwordHash,
            status: 'TEMPORARY',
            mustChangePassword: true,
            expiresAt,
            tempPasswordEncrypted: encryptCredential(tempPassword, this.config.credentialEncryptionKey),
          },
        });
      }

      const membership = await tx.companyMembership.create({
        data: { companyId: company.id, userId: owner.id, status: 'ACTIVE' },
      });

      await tx.membershipRole.create({
        data: { membershipId: membership.id, roleId: ownerRole.id },
      });

      if (lineLinkToken) {
        await tx.employeeLineLinkToken.create({
          data: {
            companyId: company.id,
            membershipId: membership.id,
            userId: owner.id,
            issuedByUserId: cmd.requestingAdminUserId,
            tokenHash: lineLinkToken.tokenHash,
            expiresAt: lineLinkToken.expiresAt,
          },
        });
      }

      await tx.branch.create({
        data: {
          companyId: company.id,
          code: 'HO',
          name: 'Head Office',
          type: 'HEAD_OFFICE',
          taxBranchCode: '00000',
          // Carries a taxBranchCode, so it is a ภ.พ.20 establishment by the §6.1 coupling —
          // the same rule the Release A backfill applied to existing branches.
          isVatEstablishment: true,
          status: 'ACTIVE',
          createdByUserId: owner.id,
        },
      });

      // Step 0 §5.4: the VAT registration state exists from the first moment the company does,
      // so the first compare-and-set has something to compare against. Created here rather than
      // lazily inside the command transaction, where two concurrent first answers would race.
      //
      // When the admin answered the question at registration, the first fact is written in the
      // same transaction and the state starts at version 1. Writing it directly rather than
      // through the CAS command path is safe only here: the company does not exist yet for anyone
      // else, so there is no concurrent answer to lose, and `planVatFactChange` on an empty
      // history reduces to exactly this single insert.
      await tx.companyVatRegistrationState.create({
        data: { companyId: company.id, version: cmd.vatRegistration ? 1 : 0 },
      });
      if (cmd.vatRegistration) {
        await tx.companyVatRegistrationFact.create({
          data: {
            companyId: company.id,
            status: cmd.vatRegistration.status,
            effectiveFrom: civilDateToUtcDate(cmd.vatRegistration.effectiveFrom),
            source: 'USER_ANSWER',
            actorId: cmd.requestingAdminUserId,
          },
        });
        // §5.2 mirror bit. It is a stored last-known value, never the authority — the accessor is.
        if (cmd.vatRegistration.status === 'REGISTERED') {
          await tx.company.update({ where: { id: company.id }, data: { vatRegistered: true } });
        }
      }

      const chartOfAccounts = await bootstrapCompanyChartOfAccounts(tx, {
        companyId: company.id,
        createdByUserId: owner.id,
      });

      // RA-16: the standard TH domestic-expense Tax Code profile, ACTIVE, with its account and
      // ภ.พ.30 mappings pointed at the chart bootstrapped one line above — otherwise the first
      // claimable input-VAT line a new company confirms fails with transaction_tax_needs_review.
      const taxConfiguration = await bootstrapCompanyTaxConfiguration(tx, {
        companyId: company.id,
        createdByUserId: owner.id,
      });

      // Seed the standard feature package: an explicit row for EVERY canonical entitlement key —
      // parents and submenus alike — so the new company is deny-by-default (the permission
      // resolver strips disabled features' permissions) and never reads as the legacy fail-open
      // sentinel. A submenu inherits its parent's package decision, which is what the runtime
      // evaluator would have computed for it anyway.
      const entitlementRows = ALL_FEATURE_ENTITLEMENT_KEYS.map((featureKey) => ({
        companyId: company.id,
        featureKey,
        enabled: DEFAULT_ENABLED_FEATURE_KEYS.includes(parentFeatureKey(featureKey)),
        updatedBySystemAdminUserId: cmd.requestingAdminUserId,
      }));
      await tx.companyFeatureEntitlement.createMany({ data: entitlementRows });

      // F1.5.1 item 1 — the CAS root and the normalization marker are written in the SAME
      // transaction as the rows they describe, so a new company can never be born in the
      // "normalization pending" state the partner entitlement command refuses. `grantOrigin`
      // stays null on every row: these are EXPLICIT new-company grants, not a LEGACY cohort
      // backfill (spec:235-236).
      await tx.companyEntitlementSet.create({ data: { companyId: company.id } });
      await tx.companyEntitlementNormalization.create({
        data: {
          companyId: company.id,
          status: 'COMPLETED',
          // The seeded set itself, so a later normalization pass can tell this snapshot apart
          // from one it produced. `runId` is the request that created the company.
          snapshotHash: createHash('sha256')
            .update(JSON.stringify(entitlementRows.map((row) => [row.featureKey, row.enabled])))
            .digest('hex'),
          runId: cmd.requestId,
          // UAT r7 — the cohort is RECORDED, not inferred. These rows are explicit new-company
          // decisions, so verify must never look for a grandfather provenance stamp on them. The
          // version is the running one: a new company is born current, not one generation behind
          // and immediately pending for a repair pass it has no reason to be in.
          cohortKind: EXPLICIT_COHORT,
          normalizerVersion: NORMALIZER_VERSION,
          completedAt: new Date(),
        },
      });

      // Same seam as prisma/sync-workflow-templates.ts: a fresh company gets the autoEnable
      // rules (reimbursement notifications) without waiting for the next release task.
      await autoEnableWorkflowTemplatesForCompany(new PrismaWorkflowRepository({ client: tx } as any), company.id);

      const handoffUrl = `${cmd.webBaseUrl}/companies/${company.id}/dashboard`;

      const run = await tx.companyOnboardingRun.create({
        data: {
          companyId: company.id,
          ownerUserId: owner.id,
          status: 'COMPLETED',
          modulePackage: cmd.modulePackage,
          handoffUrl,
          lineAddUrl: cmd.lineOaAddUrl,
          lineLinkUrl: cmd.lineLinkUrl,
          createdBySystemAdminUserId: cmd.requestingAdminUserId,
          completedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.company_onboarding.create',
          targetType: 'company_onboarding_run',
          targetId: run.id,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            companyId: company.id,
            ownerUserId: owner.id,
            modulePackage: cmd.modulePackage ?? null,
            attachExistingOwner: attach,
            businessCategory: cmd.businessCategory,
            chartTemplateKey: chartOfAccounts.templateKey,
            chartTemplateVersion: chartOfAccounts.templateVersion,
            chartTemplateChecksum: chartOfAccounts.templateChecksum,
            chartAccountCount: chartOfAccounts.accountCount,
            readyForManualLedger: chartOfAccounts.readyForManualLedger,
            readyForAutomaticPosting: chartOfAccounts.readyForAutomaticPosting,
            taxCodeProfileKey: taxConfiguration.profileKey,
            taxCodeProfileStatus: taxConfiguration.profileStatus,
            taxCodeCount: taxConfiguration.definitionCount,
            taxAccountRuleCount: taxConfiguration.accountRuleCount,
            taxReportRuleCount: taxConfiguration.reportRuleCount,
          },
        },
      });

      return { run, company, owner, handoffUrl, chartOfAccounts, taxConfiguration };
    }, { maxWait: 5_000, timeout: 15_000 });

    // M-05 register §6 tenant tripwire. The register defers the s.41 limb (b) "large scale"
    // and controller/processor questions on the assumption that tenants stay general
    // retail/trading/service; a health-adjacent tenant breaks that assumption on its own,
    // because CrmBooking.serviceName alone then becomes s.26 health data. Emitting at HIGH
    // reaches the dev team through the security alarm deploy.sh already installs — no new
    // topic, no new alarm, no infrastructure change. Fired after commit so a rolled-back
    // onboarding never pages anyone; emitSecurityEvent swallows logger failures, so this
    // can never turn a completed onboarding into a 500.
    if (isHealthAdjacentBusinessCategory(cmd.businessCategory)) {
      emitSecurityEvent(
        new Logger(CreateCompanyOnboardingUseCase.name),
        SECURITY_EVENT.pdpaHealthAdjacentTenantOnboarded,
        'HIGH',
        {
          // Deliberately no company or owner name: the alert says "go look", the audit row
          // carries the rest. Personal data does not belong on an alarm path.
          companyId: result.company.id,
          businessCategory: cmd.businessCategory,
          onboardingRunId: result.run.id,
          actorUserId: cmd.requestingAdminUserId,
          requestId: cmd.requestId,
        },
      );
    }

    return {
      onboardingRunId: result.run.id,
      companyId: result.company.id,
      ownerId: result.owner.id,
      username: cmd.ownerUsername,
      attachedExistingOwner: attach,
      ...(tempPassword && { temporaryPassword: tempPassword }),
      handoffUrl: result.handoffUrl,
      lineAddUrl: cmd.lineOaAddUrl,
      lineLinkUrl: cmd.lineLinkUrl,
      chartOfAccounts: result.chartOfAccounts,
      taxConfiguration: result.taxConfiguration,
      ...(lineLinkToken && {
        ownerLineLink: buildLineLinkPackage(cmd.apiBaseUrl, lineLinkToken.rawToken, lineLinkToken.expiresAt, this.config.lineLiffId),
      }),
    };
  }
}
