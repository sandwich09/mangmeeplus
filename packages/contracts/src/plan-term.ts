// P29 — admin-managed company plan limits & usage term.
// Spec: docs/specs/mangmee-company-plan-term-spec-th.md.

export type PlanTierKey = 'STARTER_249' | 'BASIC_499' | 'PRO_999' | 'ENTERPRISE_1999';

/** Derived, never stored: ACTIVE (green) / WARNING (yellow) / EXPIRED (red). */
export type PlanTermDerivedState = 'ACTIVE' | 'WARNING' | 'EXPIRED';

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
  derivedState: PlanTermDerivedState;
  daysLeft: number;
};

/** null = company has no term row (legacy/grandfathered — unlimited until admin sets one). */
export type CompanyPlanTermViewDto = { term: CompanyPlanTermDto | null };

export type SetCompanyPlanTermBody = {
  tierKey: PlanTierKey;
  branchLimit: number;
  employeeLimit: number;
  monthlySlipLimit: number;
  /** Only honored when creating the first term row; existing rows keep their start. */
  termStartAt?: string;
  termDays?: number;
  warningDays?: number;
};

export type RenewCompanyPlanTermBody = {
  /** Default 30. Extends from max(now, current termEndsAt). */
  days?: number;
};

/** Per-tier defaults for the admin preset dropdown — single source: Billing §8 catalog 2026-08-30. */
export const PLAN_TIER_PRESETS: Record<PlanTierKey, { labelTh: string; branchLimit: number; employeeLimit: number; monthlySlipLimit: number }> = {
  STARTER_249: { labelTh: 'เริ่มต้น (STARTER)', branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 30 },
  BASIC_499: { labelTh: 'เติบโต (BASIC)', branchLimit: 2, employeeLimit: 5, monthlySlipLimit: 50 },
  PRO_999: { labelTh: 'มืออาชีพ (PRO)', branchLimit: 5, employeeLimit: 10, monthlySlipLimit: 100 },
  ENTERPRISE_1999: { labelTh: 'ธุรกิจ (ENTERPRISE)', branchLimit: 10, employeeLimit: 30, monthlySlipLimit: 2000 },
};
