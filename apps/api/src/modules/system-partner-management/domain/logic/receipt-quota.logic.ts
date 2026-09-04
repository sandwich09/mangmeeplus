/**
 * P10-L §15.1 (review G-01) — the effective monthly slip ceiling and the copy that announces it.
 *
 * Shaped like `plan-term-limit.ts`: a company with NO `CompanyPlanTerm` row is legacy/grandfathered
 * and stays unlimited (P29 spec §2 rule 7). Enforcing the ceiling is the first limit every EXISTING
 * shop would ever meet, so "no row" must never become "no receipts".
 */
import { PLAN_TIER_PRESETS } from '@watchdog-bms/contracts';
import { isPlanTierKey } from './plan-term.logic';

/** Only the four columns the ceiling depends on, so callers select nothing they do not use. */
export type ReceiptQuotaTerm = {
  tierKey: string;
  monthlySlipLimit: number;
  warmupUntil: Date | null;
  warmupSlipLimit: number | null;
};

/** The tier whose reply carries the trial counter line (§15.1). No other tier's copy changes. */
export const TRIAL_COUNTER_TIER_KEY = 'FREE_TRIAL_15';

/**
 * `min(monthlySlipLimit, warmupSlipLimit)` inside the warm-up window, `monthlySlipLimit` after it,
 * `null` (unlimited) with no term row.
 *
 * The window is half-open — `now < warmupUntil` — so the instant the warm-up ends the tier's own
 * ceiling applies, and a term whose warm-up columns are unset is simply the tier's ceiling.
 */
export function effectiveMonthlySlipLimit(term: ReceiptQuotaTerm | null, now: Date): number | null {
  if (!term) return null;
  const warmupActive = term.warmupUntil !== null
    && term.warmupSlipLimit !== null
    && now.getTime() < term.warmupUntil.getTime();
  return warmupActive ? Math.min(term.monthlySlipLimit, term.warmupSlipLimit!) : term.monthlySlipLimit;
}

/**
 * Spec §7 row "ชนโควตา 15 ใบ", worded as AI IMAGE READS rather than receipts.
 *
 * The ceiling is enforced by `admitCompanyOcr`, which admits every image the assistant reads —
 * a receipt, but also a signature photo or a picture sent with a question. Promising "15 receipts"
 * while charging for all of them is a promise the system does not keep, so the copy counts what is
 * actually counted and says what a receipt costs. The number comes from the term, never the
 * sentence: a warm-up shop meets this at 10 and a STARTER shop at 30.
 */
export function receiptQuotaExceededTextTh(limit: number | null, tierKey?: string | null): string {
  const trial = tierKey === TRIAL_COUNTER_TIER_KEY;
  const tail = '(ใบเสร็จ 1 ใบ = 1 ครั้ง) ดูแพ็กเกจที่ใหญ่ขึ้นได้เลย';
  if (limit === null) {
    return trial
      ? `ช่วงทดลองให้ AI อ่านรูปครบตามจำนวนที่กำหนดแล้วค่ะ ${tail}`
      : `แพ็กเกจของคุณให้ AI อ่านรูปครบตามจำนวนของเดือนนี้แล้วค่ะ ${tail}`;
  }
  return trial
    ? `ช่วงทดลองให้ AI อ่านรูปได้ ${limit} ครั้ง ตอนนี้ครบแล้วค่ะ ${tail}`
    : `แพ็กเกจของคุณให้ AI อ่านรูปได้ ${limit} ครั้งต่อเดือน ตอนนี้ครบแล้วค่ะ ${tail}`;
}

/**
 * The follow-up images in the same month: the card went out once, so these get one line.
 *
 * "ช่วงทดลอง" is the free trial's word and nobody else's — a STARTER_249 shop that meets its own
 * 30 is a paying customer, and telling it the trial ran out is both wrong and a reason to churn.
 */
export function receiptQuotaExceededShortTextTh(limit: number | null, tierKey?: string | null): string {
  const scope = tierKey === TRIAL_COUNTER_TIER_KEY ? 'ในช่วงทดลอง' : 'ของแพ็กเกจเดือนนี้';
  const amount = limit === null ? 'ครบจำนวน' : `ครบ ${limit} ครั้ง`;
  return `ให้ AI อ่านรูป${amount}${scope}แล้วค่ะ พิมพ์ "ขอเปลี่ยนแพ็กเกจ" ได้เลยนะคะ`;
}

/**
 * The ceiling to PRINT, which is not always the ceiling that was enforced.
 *
 * `planLimit` is the truth. If the term row disappeared between the admission and the reply (an
 * admin retiring a tier mid-turn), the tier's own preset is the next best fact; only when both are
 * gone does the copy drop the number entirely. Never zero: "อ่านรูปได้ 0 ครั้ง" reads as a broken
 * product to the one customer least willing to forgive it.
 */
export function displayReceiptQuotaLimit(planLimit: number | null, tierKey?: string | null): number | null {
  if (planLimit !== null && planLimit > 0) return planLimit;
  return isPlanTierKey(tierKey) ? PLAN_TIER_PRESETS[tierKey].monthlySlipLimit : null;
}

/** §15.1: one extra line on the success reply, for the free-trial tier only. */
export function trialReceiptCounterLineTh(count: number, limit: number): string {
  return `อ่านครั้งที่ ${count} จาก ${limit} ในช่วงทดลอง`;
}
