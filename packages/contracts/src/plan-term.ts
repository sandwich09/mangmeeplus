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
/** Additive server projection; an expired term can still allow only free source drafts. */
export type FreeExpenseDraftAccess = { freeExpenseDrafts?: boolean };

export type PlanTermNoticeDto = (FreeExpenseDraftAccess & {
  derivedState: PlanTermDerivedState;
  termEndsAt: string;
  daysLeft: number;
  isOwner: boolean;
  canManagePlan: boolean;
  lockReason?: PlanTermLockReason;
}) | null;

export type PlanTermLockReason = 'trial_ended' | 'no_package';

/** Row shape every reader can hand in: Prisma rows carry Date, DTOs carry ISO strings. */
export type PlanTermStateInput = {
  tierKey?: string | null;
  termStartAt: Date | string;
  termEndsAt: Date | string;
  renewCount: number;
  termDisabledAt?: Date | string | null;
};

/**
 * ADMIN_HOLD = a human (or SUSPENDED/ARCHIVED) disabled the company; NO_PACKAGE/EXPIRED = the
 * term locked it (`lockReason`); TRIAL/ACTIVE = a running term. Precedence in that order.
 */
export type PlanTermState = 'ADMIN_HOLD' | 'NO_PACKAGE' | 'EXPIRED' | 'TRIAL' | 'ACTIVE';

const timeOf = (value: Date | string): number => (value instanceof Date ? value : new Date(value)).getTime();

/** Moved from apps/api plan-term.logic.ts:74-80 unchanged in meaning (sales-deals spec R2). */
export function planTermLockReason(
  term: Pick<PlanTermStateInput, 'termStartAt' | 'termEndsAt' | 'renewCount'>,
): PlanTermLockReason {
  return timeOf(term.termEndsAt) <= timeOf(term.termStartAt) && term.renewCount === 0 ? 'no_package' : 'trial_ended';
}

/** No `companyStatus` = the sales-console reading (accessStateOf): admin holds are not visible. */
export function planTermState(term: PlanTermStateInput | null | undefined, now: Date): Exclude<PlanTermState, 'ADMIN_HOLD'>;
export function planTermState(term: PlanTermStateInput | null | undefined, now: Date, companyStatus: string | null | undefined): PlanTermState;
export function planTermState(term: PlanTermStateInput | null | undefined, now: Date, companyStatus?: string | null): PlanTermState {
  // Same rule as billing-state.ts:8 `held`: anything not ACTIVE that the term did not disable.
  if (companyStatus && companyStatus !== 'ACTIVE' && !(companyStatus === 'DISABLED' && term?.termDisabledAt)) return 'ADMIN_HOLD';
  if (!term) return 'ACTIVE'; // legacy/grandfathered — fail open like every limit gate
  if (planTermLockReason(term) === 'no_package') return 'NO_PACKAGE';
  if (timeOf(term.termEndsAt) <= now.getTime() || term.termDisabledAt) return 'EXPIRED';
  return term.tierKey === 'FREE_TRIAL_15' ? 'TRIAL' : 'ACTIVE';
}

export const PLAN_TERM_STATE_LABEL_TH: Record<PlanTermState, string> = {
  ADMIN_HOLD: 'พักการใช้งาน',
  NO_PACKAGE: 'ยังไม่มีแพ็กเกจ',
  EXPIRED: 'หมดอายุ',
  TRIAL: 'กำลังทดลองใช้',
  ACTIVE: 'ใช้งานได้',
};

export function planTermStateLabel(state: PlanTermState): string {
  return PLAN_TERM_STATE_LABEL_TH[state];
}

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
  /** R2: present only while `derivedState` is EXPIRED — why the shop is locked. Derived from the row. */
  lockReason?: PlanTermLockReason;
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
  ENTERPRISE_1999: { labelTh: 'ธุรกิจ (ENTERPRISE)', branchLimit: 10, employeeLimit: 30, monthlySlipLimit: 500 },
};

/** Shop-web display only; billing and LINE keep the shared preset labels. */
export function shopPlanTierLabel(tier: PlanTierKey): string {
  return PLAN_TIER_PRESETS[tier].labelTh.replace(/ \((STARTER|BASIC|PRO|ENTERPRISE)\)$/, '');
}

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
