/**
 * Apply a deal WITHOUT a Stripe invoice (Q9 bank-transfer fallback, spec §19.5).
 *
 * The Stripe path (`reconcileOneTime`) applies a deal from a paid invoice: it has a
 * `BillingAccount`, a policy revision and provider evidence, and it writes receipt grants and
 * `paidThrough` against that account. A verified slip has none of those, so this is NOT the same
 * block with nulls threaded through it — it is the subset that holds without a billing account:
 * the plan term, the deal's menus, the AI credit, the re-enable and the deal row itself.
 *
 * Consequence to know about: `CompanyPlanTerm.billingReceiptAccountId` is left exactly as it was,
 * so a slip-paid shop keeps the legacy monthly quota derived from `monthlySlipLimit` rather than a
 * Stripe receipt grant. That is the same treatment an admin-granted term already gets.
 */
import type { SalesDealSnapshot } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { exclusiveEntitlementLock } from '../../feature-launch/application/execution-attempt.service';
import { appendPackageInterval } from '../domain/billing-package';
import { applyBillingFeaturePlan, billingFeaturePlan } from './billing-feature-entitlements';
import { writeSalesAttribution } from '../../sales-console/application/sales-attribution.write';

export type ApplyDealEntitlementInput = {
  companyId: string;
  dealId: string;
  salesUserId: string;
  snapshot: SalesDealSnapshot;
  /** When the money actually arrived — the slip's transfer instant as the Owner verified it. */
  paidAt: Date;
  verifiedByUserId: string;
  /** Skipped for a renewal: §17.2 counts first activations only. */
  renewal: boolean;
};

export type ApplyDealEntitlementResult = { termStartAt: Date; termEndsAt: Date; disabledFeatures: string[] };

/**
 * Caller holds no lock; this takes the same two it needs in the same order as `reconcileOneTime`
 * (entitlements, then the plan term) so the two writers can never deadlock against each other.
 */
export async function applyDealEntitlement(
  tx: Prisma.TransactionClient, input: ApplyDealEntitlementInput,
): Promise<ApplyDealEntitlementResult> {
  await tx.$executeRaw(exclusiveEntitlementLock(input.companyId));
  await lockPlanTermCompany(tx, input.companyId);
  const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId }, include: { planTerm: true } });
  const now = new Date();
  // §19.3: a term the shop has already paid for is honoured — the deal appends behind it.
  const running = company.planTerm && !company.planTerm.termDisabledAt && company.planTerm.termEndsAt > input.paidAt;
  const termStartAt = running ? company.planTerm!.termEndsAt : input.paidAt;
  const termEndsAt = appendPackageInterval(termStartAt, 'month',
    running ? company.planTerm!.termEndsAt.getUTCDate() : undefined, input.snapshot.months);

  const plan = await billingFeaturePlan(tx, input.companyId, input.snapshot.featureKeys);
  const disabledFeatures = await applyBillingFeaturePlan(tx, input.companyId, input.dealId, input.verifiedByUserId, plan.plan);

  await tx.companyPlanTerm.upsert({
    where: { companyId: input.companyId },
    create: { companyId: input.companyId, tierKey: input.snapshot.base, branchLimit: input.snapshot.branchLimit,
      employeeLimit: input.snapshot.employeeLimit, monthlySlipLimit: input.snapshot.monthlySlipLimit,
      termStartAt, termEndsAt, lastRenewedAt: now },
    update: { tierKey: input.snapshot.base, branchLimit: input.snapshot.branchLimit,
      employeeLimit: input.snapshot.employeeLimit, monthlySlipLimit: input.snapshot.monthlySlipLimit,
      ...(running ? {} : { termStartAt }), termEndsAt,
      termDisabledAt: null, warmupUntil: null, warmupSlipLimit: null,
      warn7SentAt: null, warn3SentAt: null, warn1SentAt: null, expiredNotifiedAt: null,
      lastRenewedAt: now, renewCount: { increment: 1 } },
  });

  // D-P3-2: null leaves the platform default; zero is refused when the deal is written.
  if (input.snapshot.aiMonthlyBudgetSatang !== null) await tx.companyAiConfiguration.upsert({
    where: { companyId: input.companyId },
    create: { companyId: input.companyId, monthlyBudgetSatang: input.snapshot.aiMonthlyBudgetSatang },
    update: { monthlyBudgetSatang: input.snapshot.aiMonthlyBudgetSatang } });

  if (!input.renewal) await writeSalesAttribution(tx, { companyId: input.companyId, salesUserId: input.salesUserId,
    source: 'DEAL', amountSatang: input.snapshot.priceSatang, months: input.snapshot.months, interval: 'month',
    paidAt: input.paidAt, sourceInvoiceId: null, sourceKind: 'SLIP', dealRequestId: input.dealId });

  return { termStartAt, termEndsAt, disabledFeatures };
}
