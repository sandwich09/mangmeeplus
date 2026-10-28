/**
 * P10-L §15.1 (review G-01) — the effective monthly slip ceiling and the copy that announces it.
 *
 * Shaped like `plan-term-limit.ts`: a company with NO `CompanyPlanTerm` row is legacy/grandfathered
 * and stays unlimited (P29 spec §2 rule 7). Enforcing the ceiling is the first limit every EXISTING
 * shop would ever meet, so "no row" must never become "no receipts".
 */
import { PLAN_TIER_PRESETS } from '@watchdog-bms/contracts';
import { isPlanTierKey } from './plan-term.logic';
import { ASK_PLAN_MANAGER_TH } from '../../../access-control/domain/logic/plan-manager.logic';

/** Advisor spec §2.2: only a reader who may buy is pointed at buying; everyone else is told who can.
 *  Only LINE passes the reader's right; the web upload's refusal keeps the default buyer wording. */
const offerOrAsk = (canManagePlan: boolean, offer: string) => (canManagePlan ? offer : ASK_PLAN_MANAGER_TH);

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
 * Trial: monthlySlipLimit immediately. Other tiers: min(monthlySlipLimit, warmupSlipLimit) during warmup,
 * monthlySlipLimit afterwards; null (unlimited) with no term row.
 *
 * The window is half-open — `now < warmupUntil` — so the instant the warm-up ends the tier's own
 * ceiling applies, and a term whose warm-up columns are unset is simply the tier's ceiling.
 */
export function effectiveMonthlySlipLimit(term: ReceiptQuotaTerm | null, now: Date): number | null {
  if (!term) return null;
  // The trial grants its configured monthly allowance from day one, including legacy warmup-10 rows.
  if (term.tierKey === TRIAL_COUNTER_TIER_KEY) return term.monthlySlipLimit;
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
 * sentence: an admin-capped shop can meet this at 10 and a STARTER shop at 30.
 */
export function receiptQuotaExceededTextTh(limit: number | null, tierKey?: string | null, cadence?: 'PAID_GRANTS' | 'FREE_MONTHLY_3', hasMonthlyGift = false, canManagePlan = true): string {
  if (cadence === 'FREE_MONTHLY_3') return 'เดือนนี้ใช้สิทธิ์อ่านฟรีครบ 3 ใบแล้วค่ะ';
  if (hasMonthlyGift) return `ใช้ใบเสร็จรายเดือนและใบที่ผู้ดูแลเพิ่มให้ครบแล้วค่ะ ${offerOrAsk(canManagePlan, 'ดูสถานะและแพ็กเกจที่ซื้อเพิ่มได้เลย')}`;
  if (cadence === 'PAID_GRANTS') return `ใช้โควตาอ่านใบเสร็จ${limit !== null ? `ครบ ${limit} ใบ` : 'ครบจำนวน'}แล้วค่ะ ${offerOrAsk(canManagePlan, 'ดูสถานะและซื้อแพ็กเกจเพิ่มได้เลย')}`;
  const trial = tierKey === TRIAL_COUNTER_TIER_KEY;
  const tail = `(ใบเสร็จ 1 ใบ = 1 ครั้ง) ${offerOrAsk(canManagePlan, 'ดูแพ็กเกจที่ใหญ่ขึ้นได้เลย')}`;
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
export function receiptQuotaExceededShortTextTh(limit: number | null, tierKey?: string | null, cadence?: 'PAID_GRANTS' | 'FREE_MONTHLY_3', hasMonthlyGift = false, canManagePlan = true): string {
  if (cadence === 'FREE_MONTHLY_3') return 'เดือนนี้ใช้สิทธิ์อ่านฟรีครบ 3 ใบแล้วค่ะ';
  if (hasMonthlyGift) return `ใบเสร็จที่ใช้ได้หมดแล้วค่ะ ${offerOrAsk(canManagePlan, 'พิมพ์ "ขอเปลี่ยนแพ็กเกจ" เพื่อดูแพ็กเกจได้เลย')}`;
  if (cadence === 'PAID_GRANTS') return `โควตาอ่านใบเสร็จหมดแล้วค่ะ ${offerOrAsk(canManagePlan, 'พิมพ์ "ขอเปลี่ยนแพ็กเกจ" เพื่อดูแพ็กเกจที่ซื้อเพิ่มได้')}`;
  const scope = tierKey === TRIAL_COUNTER_TIER_KEY ? 'ในช่วงทดลอง' : 'ของแพ็กเกจเดือนนี้';
  const amount = limit === null ? 'ครบจำนวน' : `ครบ ${limit} ครั้ง`;
  return `ให้ AI อ่านรูป${amount}${scope}แล้วค่ะ ${offerOrAsk(canManagePlan, 'พิมพ์ "ขอเปลี่ยนแพ็กเกจ" ได้เลยนะคะ')}`;
}

/**
 * The ceiling to PRINT, which is not always the ceiling that was enforced.
 *
 * `planLimit` is the truth. If the term row disappeared between the admission and the reply (an
 * admin retiring a tier mid-turn), the tier's own preset is the next best fact; only when both are
 * gone does the copy drop the number entirely. Never zero: "อ่านรูปได้ 0 ครั้ง" reads as a broken
 * product to the one customer least willing to forgive it.
 */
export function displayReceiptQuotaLimit(planLimit: number | null, tierKey?: string | null, cadence?: 'PAID_GRANTS' | 'FREE_MONTHLY_3'): number | null {
  if (cadence === 'FREE_MONTHLY_3') return 3;
  if (cadence === 'PAID_GRANTS') return planLimit !== null && planLimit > 0 ? planLimit : null;
  if (planLimit !== null && planLimit > 0) return planLimit;
  return isPlanTierKey(tierKey) ? PLAN_TIER_PRESETS[tierKey].monthlySlipLimit : null;
}

/** §15.1: one extra line on the success reply, for the free-trial tier only. */
export function trialReceiptCounterLineTh(count: number, limit: number): string {
  return `อ่านครั้งที่ ${count} จาก ${limit} ในช่วงทดลอง`;
}

/** Free allowance wording is selected only from its own reason/source, with server reset time. */
export function freeExpenseQuotaNoticeTextTh(resetAt: string): string {
  const date = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(resetAt));
  return `เดือนนี้ใช้สิทธิ์อ่านฟรีครบ 3 ใบแล้วค่ะ เริ่มอ่านฟรีรอบใหม่ได้วันที่ ${date}`;
}
export const FREE_EXPENSE_IN_FLIGHT_TEXT_TH = 'กำลังอ่านเอกสารที่ส่งก่อนหน้าอยู่ค่ะ เมื่อทราบผลแล้วจึงตรวจสิทธิ์อ่านใบนี้ได้';
export const FREE_EXPENSE_MULTI_DOCUMENT_TEXT_TH = 'ไฟล์นี้มีหลายเอกสารค่ะ สำหรับสิทธิ์ใช้ฟรี กรุณาแยกส่งเอกสารละไฟล์';
