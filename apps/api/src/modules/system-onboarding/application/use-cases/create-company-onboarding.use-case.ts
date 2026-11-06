import type { Prisma } from '../../../../generated/prisma/client';
import { emailSecurityBinding } from '../../../auth/domain/logic/email-otp.logic';
import { emailUserInclude } from '../../../auth/application/account-email-state';
import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  ALL_FEATURE_ENTITLEMENT_KEYS,
  civilDateToUtcDate,
  FEATURE_PACKAGE_PRESETS,
  isCivilDate,
  parentFeatureKey,
  type CivilDate,
  type EmployeeLineLinkPackage,
  type PlanTierKey,
  type VatFactStatus,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { uniqueConstraintFields } from '../../../../common/database/prisma-error';
import { lineIdentityLockKey } from '../../../../common/database/line-identity-lock';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { normalizeTaxId } from '../../../data-model-core/domain/logic/company-legal-identity.logic';
import { requireLineContactEmail } from '../../../external-signup/domain/line-signup.logic';
import { hashPassword } from '../../../auth/domain/logic/password-credential.logic';
import {
  LegalAcceptanceService,
  type LegalSignupEvidence,
} from '../../../auth/application/legal-acceptance.service';
import { encryptCredential } from '../../../system-partner-management/domain/logic/credential-cipher.logic';
import { DEFAULT_ENABLED_FEATURE_KEYS } from '../../../system-partner-management/domain/feature-registry';
import { applyPlanTermPreset } from '../../../system-partner-management/application/use-cases/company-plan-term.use-cases';
import { DEFAULT_TERM_DAYS, ONBOARDING_DEFAULT_TIER } from '../../../system-partner-management/domain/logic/plan-term.logic';
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
import {
  bootstrapCompanyExpenseCategories,
  type ExpenseCategoryBootstrapSummary,
} from '../../../expenses/application/services/expense-category-bootstrap.service.js';
import { bootstrapCompanyRevenueCategories } from '../../../accounting-documents/application/services/revenue-category-bootstrap.service.js';

export type CreateCompanyOnboardingCommand = {
  companyName: string;
  /** Unverified shop contact, separate from claimedOwner.email and every login identity. */
  companyContactEmail?: string;
  /** LINE-proven owner login identifier only; never evidence of mailbox ownership. */
  unverifiedOwnerEmail?: string;
  /**
   * The company's VAT registration, answered by the admin at registration. OPTIONAL: an admin who
   * does not know leaves it out, the company stays UNKNOWN, and every reader behaves exactly as it
   * does today. Never guessed from anything else.
   */
  vatRegistration?: { status: VatFactStatus; effectiveFrom: CivilDate };
  /**
   * The company's 13-digit tax id, if the admin has it at handover. OPTIONAL for the same reason
   * vatRegistration is: an admin who does not know leaves it out and the owner captures it later
   * through the identity screen. Stored as the INITIAL_CAPTURE revision, never as a bare column.
   */
  taxId?: string;
  ownerDisplayName: string;
  /** Required for every owner shape except `ownerAuth: { kind: 'line' }`, which has no username. */
  ownerUsername?: string;
  attachExistingOwner?: boolean; // true = ownerUsername must be an existing ACTIVE user; no new user/password
  /**
   * P10-L §6. How the owner will get back in. `password` (the default, and what every existing
   * caller means by saying nothing) is unchanged in every byte. `line` is the LINE-first shop:
   * no username or UserCredential; an unverified email may be adopted separately. No password leaks
   * (LINE-ONBOARD-01) — the LINE identity created in this same transaction IS the credential.
   *
   * `line-link-later` (review A-04) is the admin console's version of the same idea: the operator
   * knows the customer lives on LINE but has no ID token to bind — so the account is created with
   * no username and no credential, and the owner LINE-link QR this use-case already issues is the
   * ONLY way in. It is the temporary password that never existed rather than one nobody used.
   */
  ownerAuth?:
    | { kind: 'password' }
    | { kind: 'line'; providerUserId: string; channelId: string; displayName?: string }
    | { kind: 'line-link-later' }
    | { kind: 'demo' }
    | { kind: 'email'; verifiedAt: Date };
  /**
   * Clickwrap evidence collected before this account existed (on LIFF), replayed into
   * `LegalDocumentActionRecord` inside this transaction so the owner is not stopped by the
   * acceptance gate on their very first receipt.
   */
  legalAcceptance?: LegalSignupEvidence;
  /**
   * P10 Flow B (spec §4B): the owner proved the mailbox by opening the claim link, so this path
   * carries a verified email and a self-chosen password instead of the admin handover's temporary
   * one. Present only from the claim endpoint — the admin console never sets it.
   */
  claimedOwner?: {
    /**
     * Verified at the claim link; written with `emailVerifiedAt` in the same transaction. Absent
     * on the LINE-first attach path, where the proof is a LINE identity and there is no address.
     */
    email?: string;
    phoneNumber?: string;
    /** Self-chosen password, already hashed. Absent when attaching to an existing account. */
    passwordHash?: string;
    /** Attach by id rather than username — a claim-time account may have no username at all. */
    attachUserId?: string;
  };
  /**
   * Spec §4C: shop names legitimately repeat, and the DB has no unique on `Company.name`. Only the
   * public signup path sets this; the admin console keeps the guard that catches its own typos.
   */
  allowDuplicateCompanyName?: boolean;
  /**
   * Omitted or 'starter' seeds the 7-menu starter preset, independently of the purchased tier.
   * Explicit other package requests retain their existing seeding; existing companies are untouched.
   */
  modulePackage?: string;
  /**
   * Review B-01: the plan term is written ONCE, here, because `applyPlanTermPreset` upserts with an
   * empty `update` — a caller that wrote its own tier after this use-case returned was silently
   * overruled by the row this one had already created. Absent = the admin-console default.
   */
  planTier?: PlanTierKey;
  planDays?: number;
  planExpiresAt?: Date;
  entitledFeatureKeys?: readonly string[];
  reportClassification?: 'DEMO';
  /**
   * P10-0: stamp `CompanySignupRequest.companyId` INSIDE this transaction. Without it there is a
   * window between "the company committed" and "the fence recorded which company" — and a
   * provisioning that dies in that window leaves a retry with no way to find what it already
   * built, so it builds it again and hits the ExternalIdentity unique constraint forever.
   */
  linkSignupRequestId?: string;
  /**
   * Who/what decided this shop should exist, copied into the onboarding audit row. An operator id
   * alone cannot say "a machine approved this and the directory named me" (review MEDIUM-B).
   */
  provisioningContext?: { source: string; autoApproved: boolean; operatorResolvedFromDirectory: boolean; newShopWelcomeVersion?: 1 };
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
  /** null for a LINE-first owner: there is no username to hand over, by design. */
  username: string | null;
  attachedExistingOwner: boolean;
  temporaryPassword?: string; // shown once; never logged; absent in attach mode (owner keeps existing password)
  handoffUrl: string;
  lineAddUrl?: string;
  lineLinkUrl?: string;
  ownerLineLink?: EmployeeLineLinkPackage; // single-use QR bound to the owner user only; absent when owner LINE is already linked
  chartOfAccounts: ChartTemplateBootstrapSummary;
  taxConfiguration: TaxConfigBootstrapSummary;
  expenseCategories: ExpenseCategoryBootstrapSummary;
};

// ponytail: 9 bytes → 12 base64 chars, safe chars only
function generateTempPassword(): string {
  return randomBytes(9).toString('base64').replace(/[+/=]/g, 'x');
}

const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

/** Postgres unique violation — here, only the LINE identity slot. */
const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class CreateCompanyOnboardingUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly legal: LegalAcceptanceService,
  ) {}

  async execute(cmd: CreateCompanyOnboardingCommand, transaction?: Prisma.TransactionClient): Promise<CreateCompanyOnboardingResult> {
    const companyContactEmail = cmd.companyContactEmail === undefined ? undefined : requireLineContactEmail(cmd.companyContactEmail);
    const unverifiedOwnerEmail = cmd.unverifiedOwnerEmail === undefined ? undefined : requireLineContactEmail(cmd.unverifiedOwnerEmail);
    const attachUserId = cmd.claimedOwner?.attachUserId;
    const attach = cmd.attachExistingOwner === true || attachUserId !== undefined;
    const lineOwner = cmd.ownerAuth?.kind === 'line' ? cmd.ownerAuth : null;
    // A LINE-only owner the admin console opens: no identity to bind yet, so the only differences
    // from the default path are "no username" and "no temporary password". Everything else — the
    // owner LINE-link QR included — is the path that already exists.
    const demoOwner = cmd.ownerAuth?.kind === 'demo';
    if (demoOwner && (cmd.reportClassification !== 'DEMO' || !cmd.planExpiresAt || attach || cmd.ownerUsername || cmd.claimedOwner || companyContactEmail || unverifiedOwnerEmail)) {
      throw new UnprocessableEntityException('demo_owner_requires_isolated_company');
    }
    const lineLinkLater = cmd.ownerAuth?.kind === 'line-link-later' || demoOwner;
    const emailOwner = cmd.ownerAuth?.kind === 'email' ? cmd.ownerAuth : null;
    if (emailOwner && (!cmd.claimedOwner?.email || attach || !cmd.linkSignupRequestId)) {
      throw new UnprocessableEntityException('email_owner_requires_verified_signup');
    }
    // Every pre-existing caller reaches here: the console DTO validates the username at the HTTP
    // boundary and provisioning derives one, so this only catches a new caller that forgot.
    if (!lineOwner && !lineLinkLater && !emailOwner && !attach && !cmd.ownerUsername) {
      throw new UnprocessableEntityException('ownerUsername is required unless the owner signs in with LINE');
    }
    // Same normalisation and rule as CompanyIdentityUseCase.patch — one definition of what a valid
    // tax id is, so a number accepted here can never be one the identity screen would reject.
    const taxId = cmd.taxId === undefined ? undefined : normalizeTaxId(cmd.taxId);
    if (taxId !== undefined && !/^\d{13}$/.test(taxId)) {
      throw new UnprocessableEntityException('taxId must be 13 digits');
    }
    // Pre-transaction uniqueness checks (best-effort; conflict catch inside tx covers races)
    const [existingUser, existingCompany] = await Promise.all([
      attachUserId
        ? this.prisma.client.user.findUnique({ where: { id: attachUserId }, select: { id: true, status: true } })
        // A LINE-first owner has no username to collide with; the ExternalIdentity unique slot is
        // what stops a second account for the same LINE person, and it is checked in the transaction.
        : cmd.ownerUsername === undefined
          ? Promise.resolve(null)
          : this.prisma.client.user.findUnique({ where: { username: cmd.ownerUsername }, select: { id: true, status: true } }),
      cmd.allowDuplicateCompanyName
        ? Promise.resolve(null)
        : this.prisma.client.company.findFirst({ where: { name: cmd.companyName }, select: { id: true } }),
    ]);
    if (!attach && existingUser) throw new ConflictException(`Username "${cmd.ownerUsername}" is already taken.`);
    if (attach && (!existingUser || existingUser.status !== 'ACTIVE')) {
      throw new ConflictException(
        attachUserId
          ? 'The account to attach is not an active user.'
          : `Username "${cmd.ownerUsername}" does not match an active user to attach.`,
      );
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
    // A LINE-first owner is linked by this very transaction, so a QR to link them would be a QR to
    // link what is already linked. An admin can still reissue one later for account recovery (§9).
    const issueLineLink = !ownerHasLine && !lineOwner && !demoOwner;

    // A claim-verified owner sets their own password at the link, so no temporary one is ever
    // minted, encrypted or handed over for this path (spec §2 rule 4: no temp password, ever).
    // A LINE-first owner has no credential at all — LINE-ONBOARD-01.
    const tempPassword = attach || cmd.claimedOwner?.passwordHash || lineOwner || lineLinkLater || emailOwner
      ? undefined
      : generateTempPassword();
    const passwordHash = tempPassword ? hashPassword(tempPassword) : undefined;
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_MS);
    // Owner QR travels with the credential handoff and lives 72h like the temporary password; regenerate-temporary-password reissues it.
    const lineLinkToken = issueLineLink ? generateLineLinkToken(OWNER_LINE_LINK_TOKEN_TTL_MS) : undefined;

    const create = async (tx: Prisma.TransactionClient) => {
      // Audit H-31: the admin knows the company's tax id at handover, and until now there was
      // nowhere to put it — company.legal_identity.manage lives inside the company, so the number
      // could not be captured until the owner first logged in. Writing it here goes through the
      // SAME invariants CompanyIdentityUseCase.patch maintains, because a bare column write would
      // leave legalIdentityVersion at 0 with no revision behind it: the identity screen's
      // optimistic concurrency and its history would then both be describing a value nobody wrote.
      const company = await tx.company.create({
        data: {
          name: cmd.companyName,
          ...(companyContactEmail ? { email: companyContactEmail } : {}),
          ...(taxId ? { taxId, legalIdentityVersion: 1 } : {}),
          // Executive spec §12.2 (Q16): a shop from the normal signup is a customer from its first day; one the
          // admin creates by hand stays unclassified until the admin labels it. No user id: the system chose.
          ...(cmd.linkSignupRequestId ? { reportClassification: 'CUSTOMER', reportClassifiedAt: new Date() } : {}),
          ...(cmd.reportClassification ? { reportClassification: cmd.reportClassification, reportClassifiedAt: new Date() } : {}),
        },
      });
      if (taxId) {
        await tx.companyLegalIdentityRevision.create({
          data: {
            companyId: company.id,
            legalIdentityVersion: 1,
            snapshotJson: { taxId, registeredName: null, addressJson: null },
            changeKind: 'INITIAL_CAPTURE',
            note: 'Captured during system-admin onboarding',
            actorUserId: cmd.requestingAdminUserId,
          },
        });
        // The documented legacy mirror patch() also writes; skipping it would leave the tax
        // profile disagreeing with the company row from the very first day.
        await tx.companyTaxProfile.upsert({
          where: { companyId: company.id },
          create: { companyId: company.id, taxId, updatedByUserId: cmd.requestingAdminUserId },
          update: { taxId, updatedByUserId: cmd.requestingAdminUserId },
        });
      }

      // Written here, with the company, so "which company did this application create" is never a
      // question the database cannot answer (review HIGH-A). The fence still moves the STATE
      // afterwards; this only removes the possibility of an orphaned company.
      //
      // CONDITIONAL on purpose (review MEDIUM-1). The advisory lock only covers the claim, so two
      // provisioning runs for one application can overlap — and on the LINE attach path nothing
      // else stops a second Company (no ExternalIdentity is created, and duplicate names are
      // legal). Whichever run stamps first wins the row; the loser's `updateMany` matches nothing
      // and this throw rolls its ENTIRE transaction back, so it creates nothing at all. Its retry
      // then finds the winner's company and adopts it.
      if (cmd.linkSignupRequestId) {
        const linked = await tx.companySignupRequest.updateMany({
          where: { id: cmd.linkSignupRequestId, companyId: null, ...(emailOwner ? { source: 'email-otp', state: 'PROVISIONING' as const } : {}) },
          data: { companyId: company.id },
        });
        if (linked.count !== 1) throw new ConflictException('signup_already_provisioned');
      }

      const claimed = cmd.claimedOwner;
      if (emailOwner) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-otp-recipient:${claimed!.email!}`}, 0))`;
        const taken = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE lower(email) = ${claimed!.email!} OR lower(username) = ${claimed!.email!} LIMIT 1`;
        if (taken.length) throw new ConflictException('email_signup_account_changed');
      }
      const owner = attach
        ? (await tx.user.findUniqueOrThrow({ where: { id: existingUser!.id } }))
        : await tx.user.create({
            data: {
              displayName: cmd.ownerDisplayName,
              // LINE starts without a username/password; its optional unverified email is adopted below.
              username: cmd.ownerUsername ?? null,
              status: 'ACTIVE',
              // Written here, in the company transaction, so a unique-email clash can never leave a
              // company behind with no owner contact — the whole create fails together.
              ...(claimed?.email ? { email: claimed.email, emailVerifiedAt: emailOwner?.verifiedAt ?? new Date() } : {}),
              ...(emailOwner ? { emailLoginEnabledAt: new Date() } : {}),
              ...(claimed?.phoneNumber ? { phoneNumber: claimed.phoneNumber } : {}),
            },
          });

      if (lineOwner && unverifiedOwnerEmail) {
        // A concurrent registration can win the unique email index after our read. PostgreSQL
        // needs a savepoint: catching P2002 alone would leave the whole shop transaction aborted.
        await tx.$executeRaw`SAVEPOINT unverified_owner_email`;
        try {
          const taken = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" <> ${owner.id} AND (lower("email") = ${unverifiedOwnerEmail} OR lower("username") = ${unverifiedOwnerEmail}) LIMIT 1`;
          if (taken.length === 0) await tx.user.updateMany({
            where: { id: owner.id, email: null, emailVerifiedAt: null, status: 'ACTIVE' },
            data: { email: unverifiedOwnerEmail },
          });
        } catch (error) {
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT unverified_owner_email`;
          if (!uniqueConstraintFields(error)?.some((field) => field.includes('email'))) throw error;
        }
        await tx.$executeRaw`RELEASE SAVEPOINT unverified_owner_email`;
      }

      // Attach path: adopt the verified email only when the account has none. An account that
      // already carries a different address keeps it — this flow proves one mailbox, and it is not
      // evidence that the other one is wrong (spec §4B).
      if (attach && claimed?.email && !owner.email) {
        await tx.user.update({
          where: { id: owner.id },
          data: { email: claimed.email, emailVerifiedAt: new Date() },
        });
      }

      // Same rule for the phone, and for the same reason: a LINE account opening its SECOND shop
      // reaches this branch, and the number typed on that application was landing nowhere at all —
      // so the profile page and the day-7 nudge kept asking for a number the customer had given.
      // Never an overwrite: a number already on the account is the one they can be reached on.
      if (attach && claimed?.phoneNumber && !owner.phoneNumber) {
        await tx.user.update({ where: { id: owner.id }, data: { phoneNumber: claimed.phoneNumber } });
      }

      if (claimed?.passwordHash && !attach) {
        await tx.userCredential.create({
          data: {
            userId: owner.id,
            passwordHash: claimed.passwordHash,
            status: 'ACTIVE',
            mustChangePassword: false,
          },
        });
      }

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

      // Spec §6: the LINE identity is the credential, so it is bound HERE — in the same transaction
      // as the company and the membership. The unique `(provider, channel, providerUserId)` slot is
      // owned by whichever row exists, ACTIVE or not, so a bare `create` failed forever for an owner
      // who had ever unlinked (UAT cmto4xtrx002r4o5tf7o38dls): P2002 escaped as a generic 409 and
      // every admin retry repeated it. An UNLINKED row is re-pointed instead — the same
      // reactivation `LinkLineIdentityUseCase` performs — and the two states that really do belong
      // to somebody are refused BY NAME, so the queue chip and the toast can say which.
      if (lineOwner && !attach) {
        const identityKey = {
          provider: 'LINE' as const,
          providerUserId: lineOwner.providerUserId,
          providerChannelId: lineOwner.channelId,
        };
        // The lock covers exactly one thing: deciding and writing THIS identity slot. Everything
        // else in this transaction is protected by its own fences (the open-application index, the
        // provisioning claim, the `companyId` stamp), and none of them reach across modules.
        //
        // `link-line-identity.use-case.ts` re-points the very same row, from a different flow that
        // an owner can trigger at any moment. Both sides read then update, so row locks alone would
        // let the second UPDATE queue behind the first and overwrite it — taking the LINE
        // credential off the owner of the shop this transaction is building. Both take THIS key,
        // and both re-read inside it, which is what makes the read below the decision.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lineIdentityLockKey(lineOwner.channelId, lineOwner.providerUserId)}, 0))`;
        const existingIdentity = await tx.externalIdentity.findUnique({
          where: { provider_providerChannelId_providerUserId: identityKey },
          select: { id: true, userId: true, status: true },
        });
        if (!existingIdentity) {
          try {
            await tx.externalIdentity.create({
              data: { userId: owner.id, ...identityKey, status: 'ACTIVE', linkedAt: new Date() },
            });
          } catch (error) {
            // Two approvals for the same LINE account raced between the read above and this insert.
            if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
            throw new ConflictException('line_identity_already_linked');
          }
        } else if (existingIdentity.status === 'UNLINKED') {
          await tx.externalIdentity.update({
            where: { id: existingIdentity.id },
            data: { userId: owner.id, status: 'ACTIVE', linkedAt: new Date() },
          });
          // Support has to be able to see that this LINE account moved from one account to another;
          // ids only, so no LINE user id or shop name enters the trail (DATA-MIN-01).
          await tx.auditLog.create({
            data: {
              actorUserId: cmd.requestingAdminUserId,
              companyId: company.id,
              action: 'auth.identity.repointed',
              targetType: 'external_identity',
              targetId: existingIdentity.id,
              requestId: cmd.requestId,
              result: 'SUCCESS',
              riskLevel: 'HIGH',
              metadataJson: {
                previousUserId: existingIdentity.userId,
                previousStatus: existingIdentity.status,
                ownerUserId: owner.id,
              },
            },
          });
        } else {
          // ACTIVE or DISABLED: §5 refuses both at submit, so reaching here means the identity
          // changed under an application that was already in the queue.
          throw new ConflictException(
            existingIdentity.status === 'DISABLED' ? 'line_identity_disabled' : 'line_identity_already_linked',
          );
        }
      }

      // LEGAL-LIFF-01: the acceptance the owner already gave on LIFF, written where the in-app gate
      // reads it, so their first receipt is not blocked by a card they have already answered.
      if (cmd.legalAcceptance) {
        await this.legal.recordFromEvidence(tx, {
          userId: owner.id,
          companyId: company.id,
          membershipId: membership.id,
          evidence: cmd.legalAcceptance,
          requestId: cmd.requestId,
        });
      }

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

      // An empty category catalogue is not a blank slate, it is three broken journeys: ใบรับรอง
      // แทนใบเสร็จ refuses to issue, AI/OCR has nothing to classify into, and every confirmed
      // expense parks at postingStatus `pending` to fail the eventual backfill with
      // `expense_account_unmapped:no_category`. Seeded after the chart above because each category
      // binds to an account in it.
      const expenseCategories = await bootstrapCompanyExpenseCategories(tx, { companyId: company.id });

      // Ledger spec F-LED-2: income-side category master, six Owner-confirmed defaults. No chart
      // binding and no tax-code suggestion yet (accountant confirmation pending) — idempotent via
      // the NOT NULL companyId unique fence + skipDuplicates.
      await bootstrapCompanyRevenueCategories(tx, { companyId: company.id });

      // Seed the standard feature package: an explicit row for EVERY canonical entitlement key —
      // parents and submenus alike — so the new company is deny-by-default (the permission
      // resolver strips disabled features' permissions) and never reads as the legacy fail-open
      // sentinel. A submenu inherits its parent's package decision, which is what the runtime
      // evaluator would have computed for it anyway.
      // modulePackage 'starter' mirrors the admin console's "เริ่มต้น" preset button exactly:
      // enabled iff the key is in the preset (the preset lists submenus explicitly, so membership
      // is the whole decision — same rows applyPreset would submit).
      const starterKeys = cmd.entitledFeatureKeys ? new Set<string>(cmd.entitledFeatureKeys) : (cmd.modulePackage ?? 'starter') === 'starter'
        ? new Set<string>(FEATURE_PACKAGE_PRESETS.starter.featureKeys)
        : null;
      const entitlementRows = ALL_FEATURE_ENTITLEMENT_KEYS.map((featureKey) => ({
        companyId: company.id,
        featureKey,
        enabled: starterKeys
          ? starterKeys.has(featureKey)
          : DEFAULT_ENABLED_FEATURE_KEYS.includes(parentFeatureKey(featureKey)),
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
          modulePackage: cmd.modulePackage ?? 'starter',
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
            modulePackage: cmd.modulePackage ?? 'starter',
            attachExistingOwner: attach,
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
            expenseCategoryTemplateKey: expenseCategories.templateKey,
            expenseCategoryCount: expenseCategories.categoryCount,
            // Review MEDIUM-B: without these the company's own trail says a named human created an
            // auto-approved shop, with nothing pointing at the machine decision behind it.
            ...(cmd.provisioningContext ?? {}),
            ...(cmd.provisioningContext?.newShopWelcomeVersion === 1 && cmd.linkSignupRequestId
              ? { newShopWelcomeSignupRequestId: cmd.linkSignupRequestId } : {}),
          },
        },
      });

      if (emailOwner) {
        const currentOwner = await tx.user.findUniqueOrThrow({ where: { id: owner.id }, include: emailUserInclude });
        await tx.emailAccessChallenge.updateMany({ where: { signupRequestId: cmd.linkSignupRequestId!, email: claimed!.email!, status: 'VERIFIED', userId: null },
          data: { userId: owner.id, securityBindingHash: emailSecurityBinding(currentOwner) } });
      }
      // Demo expiry is mandatory and atomic with creation. An unbounded demo must never commit.
      if (cmd.planExpiresAt) {
        await applyPlanTermPreset({ client: tx }, company.id, cmd.planTier ?? ONBOARDING_DEFAULT_TIER, cmd.planDays ?? DEFAULT_TERM_DAYS, cmd.requestingAdminUserId);
        await tx.companyPlanTerm.update({ where: { companyId: company.id }, data: { termEndsAt: cmd.planExpiresAt } });
      }
      return { run, company, owner, handoffUrl, chartOfAccounts, taxConfiguration, expenseCategories };
    };
    const result = transaction ? await create(transaction)
      : await this.prisma.client.$transaction(create, { maxWait: 5_000, timeout: 15_000 });

    // P29 §4A: every admin-created company starts on STARTER for 30 days, and a provisioning caller
    // may name a different preset. Deliberately AFTER the commit and never inside it — a company
    // that exists with no term row is unlimited and fully usable, so a failed term write must not
    // roll back a completed onboarding. The upsert is idempotent, so a retry of this endpoint
    // cannot shorten an already-set term.
    const planTier = cmd.planTier ?? ONBOARDING_DEFAULT_TIER;
    const planDays = cmd.planDays ?? DEFAULT_TERM_DAYS;
    try {
      if (!cmd.planExpiresAt) await applyPlanTermPreset(
        this.prisma,
        result.company.id,
        planTier,
        planDays,
        cmd.requestingAdminUserId,
      );
    } catch (error) {
      // The audit is best-effort too: onboarding has already committed, and nothing after this
      // point may turn a completed handover into a 500.
      try {
        await this.prisma.client.auditLog.create({
          data: {
            companyId: result.company.id,
            actorUserId: cmd.requestingAdminUserId,
            action: 'system.company_plan_term.set',
            targetType: 'company_plan_term',
            targetId: result.company.id,
            requestId: cmd.requestId,
            result: 'FAILED',
            riskLevel: 'HIGH',
            metadataJson: {
              reason: 'onboarding_default_term_write_failed',
              tierKey: planTier,
              termDays: planDays,
              error: error instanceof Error ? error.message : String(error),
            },
          },
        });
      } catch {
        new Logger(CreateCompanyOnboardingUseCase.name).error(
          `Default plan term not written for company ${result.company.id}; company is unlimited until an admin sets one.`,
        );
      }
    }

    return {
      onboardingRunId: result.run.id,
      companyId: result.company.id,
      ownerId: result.owner.id,
      username: cmd.ownerUsername ?? null,
      attachedExistingOwner: attach,
      ...(tempPassword && { temporaryPassword: tempPassword }),
      handoffUrl: result.handoffUrl,
      lineAddUrl: cmd.lineOaAddUrl,
      lineLinkUrl: cmd.lineLinkUrl,
      chartOfAccounts: result.chartOfAccounts,
      taxConfiguration: result.taxConfiguration,
      expenseCategories: result.expenseCategories,
      ...(lineLinkToken && {
        ownerLineLink: buildLineLinkPackage(cmd.apiBaseUrl, lineLinkToken.rawToken, lineLinkToken.expiresAt, this.config.lineLiffId),
      }),
    };
  }
}
