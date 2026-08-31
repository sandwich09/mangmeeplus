// P29 — pure term math and Thai copy. Spec: docs/specs/mangmee-company-plan-term-spec-th.md.
// No framework imports: the sweep, the admin API and the user notice all read state from here,
// so "expired" can never mean two different things in two places.

import {
  PLAN_TIER_PRESETS,
  type CompanyPlanTermDto,
  type PlanTermDerivedState,
  type PlanTierKey,
} from '@watchdog-bms/contracts';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Warning ladder (Owner 2026-08-30): OWNER-only, exactly-once per point per term. */
export const WARNING_LADDER_DAYS = [7, 3, 1] as const;
export type WarningLadderDay = (typeof WARNING_LADDER_DAYS)[number];

/** Column that records a ladder point as sent — the exactly-once fence. */
export const LADDER_SENT_COLUMN: Record<WarningLadderDay, 'warn7SentAt' | 'warn3SentAt' | 'warn1SentAt'> = {
  7: 'warn7SentAt',
  3: 'warn3SentAt',
  1: 'warn1SentAt',
};

export const PLAN_TERM_CONTACT_PHONE = '098-256-5628';
const PLAN_TERM_CONTACT_EMAIL = 'contact@mangmeeplus.com';
export const DEFAULT_TERM_DAYS = 30;
export const DEFAULT_WARNING_DAYS = 7;
/** Preset used for every company an admin creates through onboarding (spec §4A). */
export const ONBOARDING_DEFAULT_TIER: PlanTierKey = 'STARTER_249';

export function isPlanTierKey(value: unknown): value is PlanTierKey {
  return typeof value === 'string' && Object.hasOwn(PLAN_TIER_PRESETS, value);
}

/** Exact-hour arithmetic (spec §2 rule 4): N whole days of 24h, never a calendar month. */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * The single definition of green/yellow/red. EXPIRED the instant `now` reaches `termEndsAt`
 * — the on-access check and the sweep must agree on that boundary to the millisecond.
 */
export function derivePlanTermState(
  termEndsAt: Date,
  warningDays: number,
  now: Date,
): { derivedState: PlanTermDerivedState; daysLeft: number } {
  const msLeft = termEndsAt.getTime() - now.getTime();
  return {
    derivedState: msLeft <= 0 ? 'EXPIRED' : msLeft <= warningDays * DAY_MS ? 'WARNING' : 'ACTIVE',
    daysLeft: Math.max(0, Math.ceil(msLeft / DAY_MS)),
  };
}

export function isExpired(termEndsAt: Date, now: Date): boolean {
  return now.getTime() >= termEndsAt.getTime();
}

/**
 * Deepest ladder point the term has entered, or null when it is still outside the 7-day window.
 * Only the deepest point fires: a sweep that was down for four days announces "3 days left",
 * not a burst of every point it slept through.
 */
export function warningLadderPoint(termEndsAt: Date, now: Date): WarningLadderDay | null {
  const msLeft = termEndsAt.getTime() - now.getTime();
  if (msLeft <= 0) return null;
  for (const day of [...WARNING_LADDER_DAYS].sort((a, b) => a - b)) {
    if (msLeft <= day * DAY_MS) return day;
  }
  return null;
}

/** Row shape every reader needs — the Prisma model, structurally, so tests can hand-build one. */
export type PlanTermRow = {
  companyId: string;
  tierKey: string;
  branchLimit: number;
  employeeLimit: number;
  monthlySlipLimit: number;
  termStartAt: Date;
  termEndsAt: Date;
  warningDays: number;
  renewCount: number;
  lastRenewedAt: Date | null;
  termDisabledAt: Date | null;
};

export function toPlanTermDto(row: PlanTermRow, now: Date): CompanyPlanTermDto {
  const { derivedState, daysLeft } = derivePlanTermState(row.termEndsAt, row.warningDays, now);
  return {
    companyId: row.companyId,
    tierKey: row.tierKey as PlanTierKey,
    branchLimit: row.branchLimit,
    employeeLimit: row.employeeLimit,
    monthlySlipLimit: row.monthlySlipLimit,
    termStartAt: row.termStartAt.toISOString(),
    termEndsAt: row.termEndsAt.toISOString(),
    warningDays: row.warningDays,
    renewCount: row.renewCount,
    ...(row.lastRenewedAt ? { lastRenewedAt: row.lastRenewedAt.toISOString() } : {}),
    ...(row.termDisabledAt ? { termDisabledAt: row.termDisabledAt.toISOString() } : {}),
    derivedState,
    daysLeft,
  };
}

// ---- Thai copy ----

// Pinned to Asia/Bangkok for the same reason thai-date.logic.ts is: the deadline an owner reads
// must be the deadline in their own day, not the API host's.
const THAI_DATE = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok',
});
const THAI_TIME = new Intl.DateTimeFormat('th-TH', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
});

/** e.g. "29 ก.ย. 2569 เวลา 14:00 น." */
export function formatThaiDateTime(value: Date): string {
  return `${THAI_DATE.format(value)} เวลา ${THAI_TIME.format(value)} น.`;
}

export function warningMessageTh(companyName: string, termEndsAt: Date, daysLeft: number): string {
  return `ร้าน ${companyName} จะครบกำหนดใช้งานวันที่ ${formatThaiDateTime(termEndsAt)} (อีก ${daysLeft} วัน) — ติดต่อ ${PLAN_TERM_CONTACT_PHONE} หรืออีเมล ${PLAN_TERM_CONTACT_EMAIL}`;
}

export function expiredMessageTh(companyName: string): string {
  return `ร้าน ${companyName} ครบกำหนดใช้งานแล้ว ระบบพักการใช้งานชั่วคราว ข้อมูลทั้งหมดยังอยู่ครบ — ติดต่อ ${PLAN_TERM_CONTACT_PHONE} หรืออีเมล ${PLAN_TERM_CONTACT_EMAIL}`;
}

/**
 * The LINE answer for the OWNER of a term-expired company (spec §renew, Owner 2026-08-30: "ตอบสุภาพ
 * ชวนติดต่อ แจ้งเฉพาะ OWNER"). Staff never see this — they keep the generic unavailable reply and no
 * package detail. Says the three things an owner needs in one screen: it ended, the data is safe,
 * and the two ways back. Kept beside the other plan-term copy so the contact details have one home.
 */
export function expiredLineOwnerMessageTh(): string {
  return [
    '🔴 ร้านของคุณครบกำหนดใช้งานแล้ว ระบบพักการใช้งานชั่วคราวค่ะ',
    'ข้อมูลทั้งหมดยังอยู่ครบ ไม่ได้หายไปไหนนะคะ',
    'ต่ออายุได้เองที่เว็บแอป เข้าสู่ระบบแล้วจะเห็นหน้าต่ออายุทันที',
    `หรือติดต่อเรา โทร ${PLAN_TERM_CONTACT_PHONE} หรืออีเมล ${PLAN_TERM_CONTACT_EMAIL}`,
  ].join('\n');
}

export function branchLimitMessageTh(limit: number): string {
  return `แพ็กเกจปัจจุบันสร้างได้สูงสุด ${limit} สาขา — ติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ`;
}

export function employeeLimitMessageTh(limit: number): string {
  return `แพ็กเกจปัจจุบันเพิ่มพนักงานได้สูงสุด ${limit} คน — ติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ`;
}
