import type { BillingOffer, BillingPurchaseMode, BillingStatus } from '@watchdog-bms/contracts';

/** Sales-event first-bill discount on the package page (sales-event spec §3.4 ก, §8). Plain Thai; never "ตั๋ว". */
export type EventDiscountChoice = 'USE' | 'DECLINE';
type View = NonNullable<BillingStatus['eventDiscount']>;
// ponytail: one-time purchases only today; renewing modes follow with their own first-bill binding (plan SD-C).
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
  `ส่วนลดจากงาน ${eventName} −${eventDiscountBaht(shownDiscountSatang)} บาท (บิลแรก)`;
export const eventDiscountUseLabel = (view: View) => `ใช้ส่วนลด −${eventDiscountBaht(Math.max(...view.offers.map(item => item.shownDiscountSatang)))} บาทกับการซื้อครั้งนี้`;
export const eventDiscountHelpText = (view: View) => `ใช้กับบิลที่ซื้อตอนนี้เท่านั้น รอบต่ออายุชำระราคาเต็ม · ถ้าไม่ใช้ ส่วนลดยังอยู่ถึง ${day(view.expiresAt)}`;
/** Recurring modes: no choice today, just where the discount does apply. */
export const eventDiscountOneTimeOnlyText = (view: View) => `มีส่วนลดจากงาน ${view.eventName} ใช้ได้เมื่อจ่ายครั้งเดียวด้วยบัตรหรือ PromptPay`;
/** Spec §4.2/§8: why this shop cannot use the holder's discount. */
export function eventDiscountBlockedText(view: View | undefined): string[] {
  if (view?.reason === 'DEAL_ACTIVE') return ['ร้านนี้มีดีลพิเศษอยู่แล้ว จึงใช้ส่วนลดจากงานกับราคาดีลไม่ได้', `ส่วนลดยังเป็นของคุณจนถึง ${day(view.expiresAt)}`];
  if (view?.reason === 'COMPANY_ALREADY_USED') return ['ร้านนี้ใช้ส่วนลดราคาจากงานไปแล้ว (ใช้ได้ร้านละครั้ง)'];
  return [];
}
