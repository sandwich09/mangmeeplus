import type { BillingEventDiscountView, BillingOffer, BillingPurchaseMode, BillingStatus } from '@watchdog-bms/contracts';

/** Sales-event discount on the package page (sales-event spec §3.4 ก, §8, SD-O12). Plain Thai; never "ตั๋ว". */
export type EventDiscountChoice = 'USE' | 'DECLINE';
type View = NonNullable<BillingStatus['eventDiscount']>;
// ponytail: one-time payments only today; automatic renewals wait for an Owner decision (SD-O12).
const ONE_TIME: readonly BillingPurchaseMode[] = ['CARD_ONCE', 'PROMPTPAY_ONCE'];

export const eventDiscountMode = (mode: BillingPurchaseMode) => ONE_TIME.includes(mode);
/** A discount this shop can use now: a ticket, no reason against it, and at least one card it lowers. */
export const eventDiscountUsable = (view: View | undefined): view is View => !!view && !view.reason && view.offers.length > 0;
export const eventDiscountCard = (view: View | undefined, offer: Pick<BillingOffer, 'offerKey' | 'interval'>) =>
  eventDiscountUsable(view) ? view.offers.find(item => item.offerKey === offer.offerKey && item.interval === offer.interval) ?? null : null;
/** Baht with satang only when there are any: "100" or "106.99". */
export const eventDiscountBaht = (satang: number) =>
  (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: satang % 100 ? 2 : 0, maximumFractionDigits: 2 });
const day = (value: string) => new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' });

export const eventDiscountCardText = (eventName: string, shownDiscountSatang: number) =>
  `ส่วนลดจากงาน ${eventName} −${eventDiscountBaht(shownDiscountSatang)} บาท`;
export const eventDiscountUseLabel = (view: View) => `ใช้ส่วนลด −${eventDiscountBaht(Math.max(...view.offers.map(item => item.shownDiscountSatang)))} บาทกับการจ่ายครั้งนี้`;
export const eventDiscountHelpText = (view: View) => `ลดเฉพาะการจ่ายครั้งนี้ งานเดียวกันใช้ได้ร้านละครั้ง · ถ้าไม่ใช้ ส่วนลดยังอยู่ถึง ${day(view.expiresAt)}`;
/** Recurring modes: no choice today, just where the discount does apply. */
export const eventDiscountOneTimeOnlyText = (view: View) => `มีส่วนลดจากงาน ${view.eventName} ใช้ได้เมื่อจ่ายครั้งเดียวด้วยบัตรหรือ PromptPay`;
/** Spec §4.2/§8: why this shop cannot use the holder's discount. */
export function eventDiscountBlockedText(view: View | undefined): string[] {
  if (view?.reason === 'DEAL_ACTIVE') return ['ร้านนี้มีดีลพิเศษอยู่แล้ว จึงใช้ส่วนลดจากงานกับราคาดีลไม่ได้', `ส่วนลดยังเป็นของคุณจนถึง ${day(view.expiresAt)}`];
  if (view?.reason === 'EVENT_ALREADY_USED') return [`ร้านนี้ใช้ส่วนลดจากงาน ${view.eventName} ไปแล้ว (งานเดียวกันใช้ได้ร้านละครั้ง)`];
  return [];
}
/**
 * Sales-event spec §8.1 (Owner UAT 2026-09-29, SD-O12): the holder has a usable ticket but this shop cannot pay for a
 * package in one go (automatic renewal, or payment records under review), so the discount box never shows. One plain
 * line says the discount exists and why it does not apply here; never a date for when it will.
 */
export function eventDiscountHeldNotice(view: BillingEventDiscountView | null | undefined): string | null {
  if (!view || view.path === 'DISCOUNT') return null;
  const best = view.tickets.filter(ticket => ticket.state === 'AVAILABLE' && !ticket.batchSuspended && ticket.discountSatang > 0)
    .sort((a, b) => b.discountSatang - a.discountSatang || Date.parse(a.expiresAt) - Date.parse(b.expiresAt))[0];
  if (!best) return null;
  const held = `คุณมีส่วนลดจากงาน ${best.eventName} ลด ${eventDiscountBaht(best.discountSatang)} บาท ตอนจ่ายค่าแพ็กเกจ (ใช้ได้ถึง ${day(best.expiresAt)})`;
  return view.path === 'CREDIT' ? `${held} · ร้านนี้ต่ออายุแบบตัดเงินอัตโนมัติ ส่วนลดจากงานยังใช้กับรอบตัดเงินอัตโนมัติไม่ได้` : held;
}
