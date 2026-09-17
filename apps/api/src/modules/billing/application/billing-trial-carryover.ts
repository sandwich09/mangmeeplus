import type { Prisma } from '../../../generated/prisma/client';
import { bangkokMonthKey } from '../../line-ai/application/company-ai-usage-meter';
import { countReceiptOcrAdmissions } from '../../line-ai/application/company-ocr-governance';
import { effectiveMonthlySlipLimit } from '../../system-partner-management/domain/logic/receipt-quota.logic';
import { hashBilling } from '../domain/billing-policy';

export type TrialCarryoverSource = { units: number; trialEndsAt: string };

/** Ordinary trial allowance only; purchased balances and independent gifts never pass this cap. */
export async function trialReceiptCarryover(db: Prisma.TransactionClient, companyId: string, at = new Date()): Promise<TrialCarryoverSource | undefined> {
  const term = await db.companyPlanTerm.findUnique({ where: { companyId } });
  if (!term || term.tierKey !== 'FREE_TRIAL_15' || term.billingReceiptAccountId || term.termDisabledAt
    || term.termStartAt > at || term.termEndsAt <= at) return;
  const previous = await db.billingReceiptGrant.findFirst({ where: { companyId,
    kind: { in: ['INITIAL', 'RENEWAL', 'REPEAT', 'UPGRADE', 'TRIAL_CARRYOVER'] } }, select: { id: true } });
  if (previous) return;
  const used = await countReceiptOcrAdmissions(db, companyId, bangkokMonthKey(at), true);
  const units = Math.max(0, Math.min(15, effectiveMonthlySlipLimit(term, at) ?? 0) - used);
  return units > 0 ? { units, trialEndsAt: term.termEndsAt.toISOString() } : undefined;
}

/** Caller holds OCR/company locks after paid evidence/capacity checks, before replacing the trial term. */
export async function grantTrialReceiptCarryover(db: Prisma.TransactionClient, input: {
  companyId: string; billingAccountId: string; invoiceId: string; policyRevisionId: string;
  source?: TrialCarryoverSource; paidAt?: Date; periodEnd: Date;
}) {
  if (!input.source || !input.paidAt || input.paidAt >= new Date(input.source.trialEndsAt)) return 0;
  const remaining = await trialReceiptCarryover(db, input.companyId, input.paidAt);
  if (!remaining || remaining.trialEndsAt !== input.source.trialEndsAt) return 0;
  // Re-read the current month too if delayed application crosses a monthly reset.
  const current = bangkokMonthKey(input.paidAt) === bangkokMonthKey() ? remaining
    : await trialReceiptCarryover(db, input.companyId);
  const units = Math.min(input.source.units, remaining.units, current?.units ?? 0);
  if (!Number.isInteger(units) || units < 1 || units > 15) return 0;
  await db.billingReceiptGrant.create({ data: { companyId: input.companyId, billingAccountId: input.billingAccountId,
    sourceKey: `trial:${input.invoiceId}`, sourceHash: hashBilling([input.invoiceId, input.source, units, input.paidAt, input.periodEnd]),
    kind: 'TRIAL_CARRYOVER', units, serviceStart: input.paidAt, availableAt: input.paidAt,
    serviceEnd: input.periodEnd, expiresAt: input.periodEnd, policyRevisionId: input.policyRevisionId } });
  return units;
}
