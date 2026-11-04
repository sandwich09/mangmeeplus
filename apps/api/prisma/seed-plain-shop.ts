import { createHash } from 'node:crypto';
import { ALL_FEATURE_ENTITLEMENT_KEYS, FEATURE_PACKAGE_PRESETS } from '@watchdog-bms/contracts';
import type { PrismaClient } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/common/database/prisma.service';
import type { AppLogger } from '../src/common/logger/logger.service';
import { AuditService } from '../src/modules/audit/application/audit.service';
import { PrismaAuditRepository } from '../src/modules/audit/infrastructure/prisma-audit.repository';
import { CompanyVatRegistrationUseCase } from '../src/modules/data-model-core/application/use-cases/company-vat-registration.use-case';
import { bootstrapCompanyChartOfAccounts } from '../src/modules/ledger/application/services/chart-template-bootstrap.service';
import { bootstrapCompanyExpenseCategories } from '../src/modules/expenses/application/services/expense-category-bootstrap.service';
import { bootstrapCompanyTaxConfiguration } from '../src/modules/tax/application/services/tax-config-bootstrap.service';
import { EXPLICIT_COHORT, NORMALIZER_VERSION } from '../src/modules/employee-access/application/normalize-entitlements';

export const PLAIN_SHOP = {
  id: 'seed-local-plain-shop', name: 'ร้านทั่วไป (ไม่จด VAT)', branchId: 'seed-plain-branch-ho',
  roleKeys: ['OWNER', 'MANAGER', 'FINANCE', 'STAFF'],
  vatCommandId: 'seed-plain-shop-not-registered-v1',
} as const;
export const UNANSWERED_PLAIN_SHOP = { ...PLAIN_SHOP, id: 'seed-local-plain-shop-unanswered',
  name: 'ร้านทั่วไป (ยังไม่ตอบเรื่อง VAT)', branchId: 'seed-plain-unanswered-branch-ho', vatCommandId: null };
export const INPUT_VAT_SHOP = { ...PLAIN_SHOP, id: 'seed-local-input-vat-shop',
  name: 'ร้านทดลองภาษีซื้อ', branchId: 'seed-input-vat-branch-ho', vatCommandId: null };
/** A 999 shop with nothing recorded: the package journey moves it to 1999 and issues a 50 ทวิ on an earlier expense. */
export const PACKAGE_SHOP = { ...PLAIN_SHOP, id: 'seed-local-package-shop', name: 'ร้านทดลองเปลี่ยนแพ็กเกจ',
  branchId: 'seed-package-branch-ho', roleKeys: ['OWNER'], vatCommandId: 'seed-package-shop-not-registered-v1' };
/** A never-paid shop whose trial has ended: the free source-drafts journeys run in it, its owner only. */
export const FREE_DRAFT_SHOP = { ...PLAIN_SHOP, id: 'seed-local-free-draft-shop', name: 'ร้านทดลองใช้ฟรี',
  branchId: 'seed-free-draft-branch-ho', roleKeys: ['OWNER'], vatCommandId: null };
export const plainShopEntitlements = (companyId: string = PLAIN_SHOP.id) => ALL_FEATURE_ENTITLEMENT_KEYS.map(featureKey => ({
  companyId, featureKey,
  enabled: (FEATURE_PACKAGE_PRESETS.starter.featureKeys as readonly string[]).includes(featureKey),
}));

/** Only a new shop is bootstrapped. Re-seeding never erases facts entered by a journey. */
export async function seedPlainShop(prisma: PrismaClient, shop: { id: string; name: string; branchId: string; roleKeys: readonly string[]; vatCommandId: string | null } = PLAIN_SHOP) {
  const companyId = shop.id;
  const owner = await prisma.user.findUniqueOrThrow({ where: { username: 'qa.owner' } });
  await prisma.$transaction(async tx => {
    if (await tx.company.findUnique({ where: { id: companyId } })) return;
    await tx.company.create({ data: { id: companyId, name: shop.name } });
    await tx.branch.create({ data: { id: shop.branchId, companyId, code: 'HO', name: 'สำนักงานใหญ่',
      type: 'HEAD_OFFICE', isVatEstablishment: false, createdByUserId: owner.id } });
    for (const roleKey of shop.roleKeys) {
      const user = await tx.user.findUniqueOrThrow({ where: { username: `qa.${roleKey.toLowerCase()}` } });
      const role = await tx.role.findUniqueOrThrow({ where: { scopeKey_key: { scopeKey: 'system', key: roleKey } } });
      const membership = await tx.companyMembership.create({ data: { companyId, userId: user.id, status: 'ACTIVE',
        branchScopeMode: 'ALL_BRANCHES', defaultBranchId: shop.branchId } });
      await tx.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
      const profile = await tx.employeeAccessProfile.findUniqueOrThrow({ where: { id: `seed-qa-profile-${roleKey.toLowerCase()}` } });
      await tx.employeeAccessProfile.create({ data: { id: `${companyId === PLAIN_SHOP.id ? 'seed-plain' : companyId === UNANSWERED_PLAIN_SHOP.id ? 'seed-plain-unanswered' : companyId}-profile-${roleKey.toLowerCase()}`, companyId,
        userId: user.id, membershipId: membership.id, displayName: profile.displayName, legalName: profile.legalName,
        jobTitle: profile.jobTitle, firstName: profile.firstName, identityType: profile.identityType,
        identityLast4: profile.identityLast4, identityHash: profile.identityHash, identityEncryptedRef: profile.identityEncryptedRef,
        phoneNumber: profile.phoneNumber, status: 'ACTIVE', createdByUserId: owner.id } });
    }
    // Same production bootstrap functions used when a new company is opened. Categories need their accounts.
    await bootstrapCompanyChartOfAccounts(tx, { companyId, createdByUserId: owner.id });
    await bootstrapCompanyExpenseCategories(tx, { companyId });
    // The VAT journey needs the same selectable tax codes a newly onboarded shop receives.
    if (companyId === INPUT_VAT_SHOP.id) await bootstrapCompanyTaxConfiguration(tx, { companyId, createdByUserId: owner.id });
    // The explicit starter set and its CAS/normalization markers mirror company onboarding.
    const rows = plainShopEntitlements(companyId);
    await tx.companyFeatureEntitlement.createMany({ data: rows });
    await tx.companyEntitlementSet.create({ data: { companyId } });
    await tx.companyEntitlementNormalization.create({ data: { companyId, status: 'COMPLETED',
      snapshotHash: createHash('sha256').update(JSON.stringify(rows.map(row => [row.featureKey, row.enabled]))).digest('hex'),
      runId: companyId === PLAIN_SHOP.id ? 'seed-plain-shop-v1' : `${companyId}-v1`, cohortKind: EXPLICIT_COHORT, normalizerVersion: NORMALIZER_VERSION, completedAt: new Date() } });
    await tx.companyWebEntrySetting.create({ data: { companyId, manualExpenseEntryEnabled: true } });
    // An ended 15-day trial with no billing history is what makes isFreeExpenseDraftCompany true.
    if (companyId === FREE_DRAFT_SHOP.id) {
      const day = 24 * 60 * 60 * 1000;
      await tx.companyPlanTerm.create({ data: { companyId, tierKey: 'FREE_TRIAL_15', branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 15,
        termStartAt: new Date(Date.now() - 30 * day), termEndsAt: new Date(Date.now() - 15 * day), createdByUserId: owner.id } });
    }
    // No standing payout account: the first shop's seed does not give the QA staff one either.
  }, { timeout: 30_000 });
  if (!shop.vatCommandId) return; // No fact or legacy answer is written for the unanswered shop.
  const service = { client: prisma } as PrismaService;
  const audit = new AuditService(new PrismaAuditRepository(service), console as unknown as AppLogger);
  // The production command writes the fact, state, mirror and audit. Its fixed command id replays without writes.
  await new CompanyVatRegistrationUseCase(service, audit).put({ requestId: shop.vatCommandId,
    authSubject: owner.id, userId: owner.id, companyId, membershipId: '', roles: ['OWNER'],
    permissions: ['company.vat_registration.manage'], scopes: {}, authProvider: 'system' }, companyId,
  { commandId: shop.vatCommandId, expectedVersion: 0,
    command: { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: '2020-01-01' } });
}
