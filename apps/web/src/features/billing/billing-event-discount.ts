import type { BillingEventDiscountView, BillingOffer, BillingPurchaseMode, BillingPurchaseSource, BillingStatus } from '@watchdog-bms/contracts';

/** Sales-event discount on the package page (sales-event spec §3.4 ก, §8, SD-O12, SD-O13). Plain Thai; never "ตั๋ว". */
export type EventDiscountChoice = 'USE' | 'DECLINE';
type View = NonNullable<BillingStatus['eventDiscount']>;
type Ticket = NonNullable<View['tickets']>[number];
const ONE_TIME: readonly BillingPurchaseMode[] = ['CARD_ONCE', 'PROMPTPAY_ONCE'];
/** SD-O13: an automatic-renewal mode takes it on the first bill of a package this shop starts now (first purchase or after expiry). */
const STARTING: readonly BillingPurchaseSource[] = ['NO_TERM', 'TRIAL', 'ADMIN_MANUAL', 'PAID_EXPIRED_CURRENT_MODE'];

/** Whether this mode's payment can take the discount: one-time always; a renewing mode only on a package the shop starts now. */
export const eventDiscountMode = (mode: BillingPurchaseMode, source?: BillingPurchaseSource | null) =>
  ONE_TIME.includes(mode) || (!!source && STARTING.includes(source));
/** SD-O13: in a renewing mode the discount comes off the first bill only; the renewals are full price. */
export const eventDiscountFirstBillOnly = (mode: BillingPurchaseMode | undefined) => !!mode && !ONE_TIME.includes(mode);
/** A discount this shop can use now: a ticket, no reason against it, and at least one card it lowers. */
export const eventDiscountUsable = (view: View | undefined): view is View => !!view && !view.reason && view.offers.length > 0;
/** Owner 2026-09-29: every discount usable here, best first, so the buyer picks which one this payment uses (an older API sends one). */
export const eventDiscountChoices = (view: View): Ticket[] => view.tickets ??
  [{ ticketSerial: view.ticketSerial, eventName: view.eventName, discountSatang: view.discountSatang, expiresAt: view.expiresAt, offers: view.offers }];
/** The chosen ticket while it is still on offer; null = the default, the best ticket for each card. */
export const eventDiscountSerial = (view: View | undefined, serial: string | null) =>
  serial && eventDiscountUsable(view) && eventDiscountChoices(view).some(ticket => ticket.ticketSerial === serial) ? serial : null;
/** The line on a card: the chosen ticket's amount there, or the default best one. Null = this card gets no discount. */
export function eventDiscountCard(view: View | undefined, offer: Pick<BillingOffer, 'offerKey' | 'interval'>, serial: string | null = null) {
  if (!eventDiscountUsable(view)) return null;
  const match = (item: { offerKey: string; interval: string }) => item.offerKey === offer.offerKey && item.interval === offer.interval;
  const ticket = serial ? eventDiscountChoices(view).find(item => item.ticketSerial === serial) : undefined;
  if (!ticket) return view.offers.find(match) ?? null;
  const card = ticket.offers.find(match);
  return card ? { eventName: ticket.eventName, shownDiscountSatang: card.shownDiscountSatang } : null;
}
/** Baht with satang only when there are any: "100" or "106.99". */
export const eventDiscountBaht = (satang: number) =>
  (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: satang % 100 ? 2 : 0, maximumFractionDigits: 2 });
const day = (value: string) => new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' });

export const eventDiscountCardText = (eventName: string, shownDiscountSatang: number) =>
  `ส่วนลดจากงาน ${eventName} −${eventDiscountBaht(shownDiscountSatang)} บาท`;
/** One radio row per held discount: its biggest amount on a card, and until when it can be used. */
export const eventDiscountChoiceLabel = (ticket: Ticket) =>
  `${eventDiscountCardText(ticket.eventName, Math.max(...ticket.offers.map(item => item.shownDiscountSatang)))} · ใช้ได้ถึง ${day(ticket.expiresAt)}`;
export const EVENT_DISCOUNT_ONE_PER_PAYMENT = 'ใช้ได้ครั้งละ 1 ส่วนลดต่อการจ่าย ส่วนลดที่ไม่ได้เลือกยังเก็บไว้ใช้ครั้งถัดไปได้';
export const eventDiscountHelpText = (firstBillOnly = false) =>
  `${firstBillOnly ? 'ลดเฉพาะบิลแรก รอบถัดไปคิดราคาเต็ม' : 'ลดเฉพาะการจ่ายครั้งนี้'} งานเดียวกันใช้ได้ร้านละครั้ง`;
/** A renewing mode on a shop that is not starting a package (it cannot take the discount): where the discount does apply. */
export const eventDiscountOneTimeOnlyText = (view: View) => `มีส่วนลดจากงาน ${view.eventName} ใช้ได้เมื่อจ่ายครั้งเดียวด้วยบัตรหรือพร้อมเพย์`;
/** SD-O13, the confirm step of a discounted renewing first bill: what the next round costs and when. */
export const eventDiscountNextRoundText = (mode: BillingPurchaseMode | undefined, fullPrice: string, at: string) =>
  `รอบถัดไป ${fullPrice} ${mode === 'CARD_AUTO' ? 'ตัดบัตรอัตโนมัติ' : ''}วันที่ ${day(at)}`;
/** Spec §4.2/§8: why this shop cannot use the holder's discount. */
export function eventDiscountBlockedText(view: View | undefined): string[] {
  if (view?.reason === 'DEAL_ACTIVE') return ['ร้านนี้มีดีลพิเศษอยู่แล้ว จึงใช้ส่วนลดจากงานกับราคาดีลไม่ได้', `ส่วนลดยังเป็นของคุณจนถึง ${day(view.expiresAt)}`];
  if (view?.reason === 'EVENT_ALREADY_USED') return [`ร้านนี้ใช้ส่วนลดจากงาน ${view.eventName} ไปแล้ว (งานเดียวกันใช้ได้ร้านละครั้ง)`];
  return [];
}
/**
 * Sales-event spec §8.1 (Owner UAT 2026-09-29, SD-O12): the holder has a usable ticket but this shop cannot pay for a
 * package now (a running automatic renewal, or payment records under review), so the discount box never shows. One plain
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
