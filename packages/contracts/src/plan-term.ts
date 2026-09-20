// P29 — admin-managed company plan limits & usage term.
// Spec: docs/specs/mangmee-company-plan-term-spec-th.md.

export type PlanTierKey = 'FREE_TRIAL_15' | 'STARTER_249' | 'BASIC_499' | 'PRO_999' | 'ENTERPRISE_1999';

/** Derived, never stored: ACTIVE (green) / WARNING (yellow) / EXPIRED (red). */
export type PlanTermDerivedState = 'ACTIVE' | 'WARNING' | 'EXPIRED';

/**
 * Sales/locked-signup spec R2. WHY a locked shop is locked, so the web and LINE can say the right
 * sentence: `no_package` never had one (Owner 2026-09-20 closed the free trial for new signups),
 * `trial_ended` ran a real term to its end. Derived from the term row, never stored.
 */
export type PlanTermLockReason = 'trial_ended' | 'no_package';

export type CompanyPlanCapacity = { tierKey: PlanTierKey; branchLimit: number; employeeLimit: number;
  temporary?: { operationId: string; effectiveAt: string; expiresAt: string } };

export type CompanyPlanTermDto = {
  companyId: string;
  tierKey: PlanTierKey;
  branchLimit: number;
  employeeLimit: number;
  monthlySlipLimit: number;
  termStartAt: string;
  termEndsAt: string;
  warningDays: number;
  renewCount: number;
  lastRenewedAt?: string;
  /** Set when the sweep auto-disabled the company for term expiry (admin-disable never sets this). */
  termDisabledAt?: string;
  /** Optional legacy/non-trial warmup. FREE_TRIAL_15 always uses monthlySlipLimit immediately. */
  warmupUntil?: string;
  warmupSlipLimit?: number;
  derivedState: PlanTermDerivedState;
  daysLeft: number;
  /** Purchased fields above remain the financial baseline. Temporary capacity is separate. */
  effectiveCapacity?: CompanyPlanCapacity;
  paidPlan?: boolean;
};

/** null = company has no term row (legacy/grandfathered — unlimited until admin sets one). */
export type CompanyPlanTermViewDto = { term: CompanyPlanTermDto | null; sourceVersion?: string; replayed?: boolean;
  activeBranches?: number; activeMembers?: number };

export type PlanTermAdjustmentBody = { commandId: string; expectedVersion: string; reason: string };
export type PartnerPlanAdjustmentField = 'tierKey' | 'branchLimit' | 'employeeLimit' | 'monthlySlipLimit' | 'warningDays' | 'termStartAt' | 'termEndsAt';
export type PartnerPlanAdjustmentHistory = { items: Array<{ id: string; recordedAt: string; actorId: string | null;
  actorName: string | null; kind: 'SET' | 'RENEW'; source: 'SYSTEM_PARTNER_ADMIN' | 'LINE_PACKAGE_REQUEST' | 'LEGACY_ADMIN';
  reason: string | null; requestId: string | null;
  changes: Array<{ field: PartnerPlanAdjustmentField; before: string | number | null; after: string | number | null }> }>;
  nextCursor: string | null };

export type SetCompanyPlanTermBody = PlanTermAdjustmentBody & {
  tierKey: PlanTierKey;
  branchLimit: number;
  employeeLimit: number;
  monthlySlipLimit: number;
  /** Only honored when creating the first term row; existing rows keep their start. */
  termStartAt?: string;
  termDays?: number;
  warningDays?: number;
};

export type RenewCompanyPlanTermBody = PlanTermAdjustmentBody & {
  /** Default 30. Extends from max(now, current termEndsAt). */
  days?: number;
};

/** Per-tier defaults for the admin preset dropdown — single source: Billing §8 catalog 2026-08-30. */
export const PLAN_TIER_PRESETS: Record<PlanTierKey, { labelTh: string; branchLimit: number; employeeLimit: number; monthlySlipLimit: number }> = {
  // P10-L: the LINE-first trial (Owner 2026-09-04 — 15 slips, 30 days). Not sellable on the public
  // web form, which pins its own allowed keys; an admin can still hand it out from the partner page.
  FREE_TRIAL_15: { labelTh: 'ทดลองใช้ฟรี', branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 15 },
  STARTER_249: { labelTh: 'เริ่มต้น (STARTER)', branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 30 },
  BASIC_499: { labelTh: 'เติบโต (BASIC)', branchLimit: 2, employeeLimit: 5, monthlySlipLimit: 50 },
  PRO_999: { labelTh: 'มืออาชีพ (PRO)', branchLimit: 5, employeeLimit: 10, monthlySlipLimit: 100 },
  ENTERPRISE_1999: { labelTh: 'ธุรกิจ (ENTERPRISE)', branchLimit: 10, employeeLimit: 30, monthlySlipLimit: 2000 },
};

/**
 * Owner 2026-09-05 (review R02/F1): the one tier every self-service signup provisions, whichever
 * form it came in through. Named here rather than in provisioning so the page that advertises the
 * trial and the code that grants it cannot drift — the form used to promise PRO limits while
 * provisioning wrote this.
 */
export const SIGNUP_TRIAL_TIER_KEY: PlanTierKey = 'FREE_TRIAL_15';

/** New provisioning default, matching the trial allowance from day one. Legacy name retained for compatibility. */
export const SIGNUP_TRIAL_WARMUP_SLIPS = PLAN_TIER_PRESETS[SIGNUP_TRIAL_TIER_KEY].monthlySlipLimit;

/** Catalog order, cheapest first — the order a shop moves through, not an alphabetical accident. */
const PLAN_TIER_LADDER: readonly PlanTierKey[] = [
  'FREE_TRIAL_15', 'STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999',
];

/**
 * P10-L §3.7. A package-change request opened from a LINE button carries no chosen tier — the
 * customer tapped "ask", not "buy". This names the next step up as the STARTING POINT the admin
 * calls about; the tier itself still only changes through the partner page. A shop already at the
 * top, or with no term row at all, starts at the tier that is the honest first paid step.
 */
export function nextPlanTierKey(current: string | null | undefined): PlanTierKey {
  const index = PLAN_TIER_LADDER.indexOf(current as PlanTierKey);
  if (index < 0) return 'STARTER_249';
  return PLAN_TIER_LADDER[Math.min(index + 1, PLAN_TIER_LADDER.length - 1)]!;
}
