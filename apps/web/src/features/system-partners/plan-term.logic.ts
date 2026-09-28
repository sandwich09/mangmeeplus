// Pure rules behind the "แพ็กเกจและอายุการใช้งาน" section (P29 spec §4A–§5).
// The renewal date is computed here as well as on the server: the dialog has to show the admin
// the exact end date they are about to commit to before the request goes out.

import { planTermState, planTermStateLabel, type CompanyPlanTermDto } from '@watchdog-bms/contracts';

export type PlanTermChipTone = 'neutral' | 'warning' | 'danger' | 'success';
export type PlanTermChip = { label: string; tone: PlanTermChipTone };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Green while healthy, yellow inside the warning window, red once locked — for any of the three
 * reasons a shop can be locked (R-C7): a human hold, no package ever bought, or a term that ran
 * out. One chip instead of the old pair (status chip + a separate "พักการใช้งานแล้ว" chip), so a
 * `no_package` shop never shows three labels ("หมดอายุแล้ว" + "พักการใช้งานแล้ว" + "ทดลองใช้ฟรี") at once.
 */
export function planTermStatusChip(term: CompanyPlanTermDto, companyStatus: string, now = new Date()): PlanTermChip {
  const state = planTermState(term, now, companyStatus);
  if (state === 'ADMIN_HOLD' || state === 'NO_PACKAGE' || state === 'EXPIRED') return { label: planTermStateLabel(state), tone: 'danger' };
  return { label: `เหลือ ${term.daysLeft} วัน`, tone: term.derivedState === 'WARNING' ? 'warning' : 'success' };
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

/** Match the plan-term API: every configured limit and warning period is a positive integer. */
export function parseLimitInput(raw: string): number | null {
  const value = Number(raw.trim());
  return raw.trim() !== '' && Number.isInteger(value) && value > 0 ? value : null;
}
