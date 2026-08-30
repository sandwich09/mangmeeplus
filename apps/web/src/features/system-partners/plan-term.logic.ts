// Pure rules behind the "แพ็กเกจและอายุการใช้งาน" section (P29 spec §4A–§5).
// The renewal date is computed here as well as on the server: the dialog has to show the admin
// the exact end date they are about to commit to before the request goes out.

import type { CompanyPlanTermDto } from '@watchdog-bms/contracts';

export type PlanTermChipTone = 'neutral' | 'warning' | 'danger' | 'success';
export type PlanTermChip = { label: string; tone: PlanTermChipTone };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Green while healthy, yellow inside the warning window, red once the term has run out. */
export function planTermStatusChip(term: CompanyPlanTermDto): PlanTermChip {
  if (term.derivedState === 'EXPIRED') return { label: 'หมดอายุแล้ว', tone: 'danger' };
  return {
    label: `เหลือ ${term.daysLeft} วัน`,
    tone: term.derivedState === 'WARNING' ? 'warning' : 'success',
  };
}

/**
 * Only set when the expiry sweep disabled the company. An admin-disabled company has no
 * `termDisabledAt`, and renewing it must not read as if it will come back on its own (§4C).
 */
export function planTermDisabledChip(term: CompanyPlanTermDto): PlanTermChip | null {
  return term.termDisabledAt ? { label: 'พักการใช้งานแล้ว', tone: 'danger' } : null;
}

export function planTermLimitsText(term: {
  branchLimit: number;
  employeeLimit: number;
  monthlySlipLimit: number;
}): string {
  return `สาขา ${term.branchLimit} · พนักงาน ${term.employeeLimit} · สลิป ${term.monthlySlipLimit} ใบ/เดือน`;
}

/**
 * New end date after a renewal: still inside the term extends the existing end, an expired term
 * counts from now, so nobody loses days and nobody gets free backdated ones (§4C).
 */
export function renewedEndsAt(currentEndsAt: string, days: number, now: Date = new Date()): Date {
  const current = new Date(currentEndsAt);
  const base = Number.isNaN(current.getTime()) || current.getTime() < now.getTime() ? now : current;
  return new Date(base.getTime() + days * DAY_MS);
}

/** Whole positive days only — the field feeds a term length, not an arithmetic expression. */
export function parseDaysInput(raw: string): number | null {
  const value = Number(raw.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Limits may legitimately be 0 (a tier that grants none), so only negatives are rejected. */
export function parseLimitInput(raw: string): number | null {
  const value = Number(raw.trim());
  return raw.trim() !== '' && Number.isInteger(value) && value >= 0 ? value : null;
}
