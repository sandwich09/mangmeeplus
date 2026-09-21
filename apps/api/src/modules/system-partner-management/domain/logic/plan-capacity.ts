import { BILLING_PAID_TIERS, type CompanyPlanCapacity, type PaidTier, type PlanTierKey } from '@watchdog-bms/contracts';

export type TemporaryPlanCapacity = { operationId: string; accountId: string; tierKey: PaidTier;
  branchLimit: number; employeeLimit: number; effectiveAt: string; expiresAt: string };
type Source = { capacityOverride?: unknown; billingReceiptAccountId?: string|null; termEndsAt?: Date; termDisabledAt?: Date|null };
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= 2147483647;
const iso = (s: unknown): s is string => typeof s === 'string' && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;

/** No worker is needed to expire a gift; never restore a saved, potentially obsolete paid tier. */
export function currentCapacityOverride(row: Source, now = new Date()): TemporaryPlanCapacity|null {
  const raw = row.capacityOverride;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || row.termDisabledAt || !row.termEndsAt || row.termEndsAt <= now) return null;
  const p = raw as Record<string, unknown>;
  if (Object.keys(p).length !== 7 || !['operationId','accountId','tierKey','branchLimit','employeeLimit','effectiveAt','expiresAt'].every(k => k in p)) return null;
  if (typeof p.operationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p.operationId) || !row.billingReceiptAccountId || p.accountId !== row.billingReceiptAccountId ||
    !BILLING_PAID_TIERS.includes(p.tierKey as PaidTier) || !integer(p.branchLimit) || !integer(p.employeeLimit) ||
    !iso(p.effectiveAt) || !iso(p.expiresAt) || p.effectiveAt >= p.expiresAt || new Date(p.effectiveAt) > now || new Date(p.expiresAt) <= now) return null;
  return { operationId: p.operationId, accountId: p.accountId as string, tierKey: p.tierKey as TemporaryPlanCapacity['tierKey'],
    branchLimit: p.branchLimit, employeeLimit: p.employeeLimit, effectiveAt: p.effectiveAt, expiresAt: p.expiresAt };
}

export function effectivePlanCapacity(row: Source & {tierKey: string; branchLimit: number; employeeLimit: number}, now = new Date()): CompanyPlanCapacity {
  const p = currentCapacityOverride(row, now);
  return p ? {tierKey:p.tierKey,branchLimit:p.branchLimit,employeeLimit:p.employeeLimit,
    temporary:{operationId:p.operationId,effectiveAt:p.effectiveAt,expiresAt:p.expiresAt}} :
    {tierKey:row.tierKey as PlanTierKey,branchLimit:row.branchLimit,employeeLimit:row.employeeLimit};
}
