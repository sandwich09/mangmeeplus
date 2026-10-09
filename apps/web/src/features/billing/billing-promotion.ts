import { BILLING_PAID_TIERS, type BillingBenefitChoice, type BillingOffer, type BillingPromotionOfferView, type BillingPromotionUnavailableReason, type BillingPromotionUse,
  type BillingQuote, type BillingStatus } from '@watchdog-bms/contracts';
import { apiErrorCode } from '@/common/api/api-error-message';
import { EVENT_DISCOUNT_ONE_PER_PAYMENT, eventDiscountBaht, eventDiscountHelpText } from './billing-event-discount';

/**
 * Bonus-month promotion on the package page (promotion spec §3 and §7, plan §2 and §4). Plain Thai; no campaign id, enum key or
 * code ever reaches the screen. Every decision the page makes about a promotion lives here and the page only draws it. No number
 * in this file belongs to one campaign: months, receipts, dates and the price come from the row, the quote or the card.
 */
type Row = BillingPromotionOfferView;
type Reason = BillingPromotionUnavailableReason;
type Card = { offerKey: string; interval: string };
type Priced = Pick<BillingOffer, 'priceSatang'>;

const day = (value: string) => new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' });
/** Thailand has no daylight saving, so its clock is the instant plus seven hours; this keeps the text the same on every machine. */
const clock = (value: string) => {
  const at = new Date(Date.parse(value) + 7 * 3_600_000);
  return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
};

/** §3: one sentence per reason, each true on its own. A missing key fails the typecheck; the spec lists every key too. */
const REASON_TEXT: Record<Reason, string> = {
  NOT_STARTED: 'โปรโมชั่นนี้ยังไม่เริ่ม',
  ENDED: 'โปรโมชั่นนี้สิ้นสุดแล้ว',
  PAUSED: 'โปรโมชั่นนี้หยุดรับสิทธิ์ชั่วคราว',
  CAP_FULL: 'สิทธิ์โปรโมชั่นครบจำนวนแล้ว',
  ALREADY_USED: 'ร้านนี้ใช้สิทธิ์โปรโมชั่นนี้แล้ว',
  IN_PROGRESS: 'มีรายการชำระที่ใช้สิทธิ์นี้ค้างอยู่ เปิดรายการเดิมเพื่อชำระต่อ',
  CATALOG_STALE: 'ราคาหรือเงื่อนไขแพ็กเกจเปลี่ยน โปรโมชั่นนี้จึงใช้ไม่ได้ในตอนนี้',
  OFFER_NOT_COVERED: 'แพ็กเกจนี้ไม่ร่วมโปรโมชั่น',
  PURCHASE_KIND_UNSUPPORTED: 'โปรโมชั่นนี้ยังใช้กับการซื้อแบบนี้ไม่ได้',
  CHANGED: 'เงื่อนไขโปรโมชั่นเปลี่ยนแล้ว',
};
export const promotionReasonText = (reason: Reason | null): string =>
  reason && Object.hasOwn(REASON_TEXT, reason) ? REASON_TEXT[reason] : 'โปรโมชั่นนี้ใช้ไม่ได้ในตอนนี้';

/* ---- the card ---- */

/** The row that speaks for one card: same package and cadence. An available row wins over one that only says why not. */
export function promotionRow(rows: readonly Row[] | undefined, card: Card): Row | undefined {
  const same = (rows ?? []).filter(row => row.offerKey === card.offerKey && row.interval === card.interval);
  return same.find(row => row.available) ?? same[0];
}
/** "249 บาท ได้ 2 เดือน": the card's own price, the row's own months. */
export const promotionHeadline = (row: Pick<Row, 'totalMonths'>, offer: Priced) => `${eventDiscountBaht(offer.priceSatang)} บาท ได้ ${row.totalMonths} เดือน`;
export const PROMOTION_ONCE = 'ใช้ได้ครั้งเดียวต่อร้าน';
/** The card still shows the promotion when the buyer picked another benefit, and says so. */
export const PROMOTION_NOT_PICKED = 'ครั้งนี้ไม่ได้เลือกใช้โปรโมชั่นนี้';
export function promotionCard(row: Row, offer: Priced) {
  return { name: row.displayName, headline: promotionHeadline(row, offer), lines: [
    `ชำระ ${row.totalMonths - row.bonusMonths} เดือน แถมฟรี ${row.bonusMonths} เดือน`,
    `ใบเสร็จ ${row.totalReceiptUnits} ใบ (รวมแถม ${row.bonusReceiptUnits} ใบ)`,
    PROMOTION_ONCE,
    `โปรโมชั่นสิ้นสุด ${day(row.endsAt)} เวลา ${clock(row.endsAt)} น.`] };
}

/* ---- one benefit per purchase (Q4) ---- */

/** What can be picked: the promotion on this cadence, a held discount usable in this payment mode. "Normal" is always possible. */
export type BenefitOffered = Record<'PROMOTION' | 'EVENT_DISCOUNT', boolean>;
export const promotionOffered = (rows: readonly Row[] | undefined, interval: string, ticket: boolean): BenefitOffered =>
  ({ PROMOTION: (rows ?? []).some(row => row.available && row.interval === interval), EVENT_DISCOUNT: ticket });
/** The buyer's pick while it is still on offer; one that is gone (promotion ended, discount used) is null, the default. */
export const promotionPick = (pick: BillingBenefitChoice | null, offered: BenefitOffered): BillingBenefitChoice | null =>
  pick === 'NORMAL' || (pick && offered[pick]) ? pick : null;
/** The radio that is on: the pick, else the promotion, else the held discount (today's default), else normal. */
export const promotionPageBenefit = (pick: BillingBenefitChoice | null, offered: BenefitOffered): BillingBenefitChoice =>
  promotionPick(pick, offered) ?? (offered.PROMOTION ? 'PROMOTION' : offered.EVENT_DISCOUNT ? 'EVENT_DISCOUNT' : 'NORMAL');
/**
 * What one card takes. A pick applies where it fits the card and is otherwise a normal purchase, never another benefit the
 * buyer did not choose. With no pick, a card takes the promotion it has, else the held discount it is lowered by.
 */
export function promotionCardBenefit(pick: BillingBenefitChoice | null, offered: BenefitOffered, onCard: BenefitOffered): BillingBenefitChoice {
  const chosen = promotionPick(pick, offered);
  if (chosen) return chosen === 'NORMAL' || onCard[chosen] ? chosen : 'NORMAL';
  return onCard.PROMOTION ? 'PROMOTION' : onCard.EVENT_DISCOUNT ? 'EVENT_DISCOUNT' : 'NORMAL';
}
export const PROMOTION_ONE_PER_PURCHASE = 'ใช้ได้ครั้งละ 1 อย่างต่อการซื้อ สิ่งที่ไม่ได้เลือกจะไม่ถูกใช้';
/** Today's wording when only a discount is on offer; the three-way wording as soon as a promotion is. */
export function promotionChoiceCopy(on: { promotion: boolean; ticket: boolean; firstBillOnly: boolean }) {
  return on.promotion
    ? { section: 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้', legend: 'เลือกสิ่งที่จะใช้ในการซื้อครั้งนี้', normal: 'ซื้อแบบปกติ',
      notes: [PROMOTION_ONE_PER_PURCHASE, ...(on.ticket ? [eventDiscountHelpText(on.firstBillOnly)] : [])] }
    : { section: 'ส่วนลดจากงาน', legend: 'ส่วนลดจากงาน', normal: 'ไม่ใช้ครั้งนี้',
      notes: [EVENT_DISCOUNT_ONE_PER_PAYMENT, eventDiscountHelpText(on.firstBillOnly)] };
}
/** The promotion radio: its name, then one line per package it covers on this cadence. Null = nothing to pick. */
export function promotionChoiceLabel(rows: readonly Row[] | undefined, offers: readonly Pick<BillingOffer, 'offerKey' | 'interval' | 'label' | 'priceSatang'>[], interval: string) {
  const open = (rows ?? []).filter(row => row.available && row.interval === interval);
  if (!open.length) return null;
  return { title: `ใช้โปรโมชั่น ${[...new Set(open.map(row => row.displayName))].join(' · ')}`, lines: open.flatMap(row => {
    const offer = offers.find(item => item.offerKey === row.offerKey && item.interval === row.interval);
    return offer ? [`${offer.label} ${row.interval === 'year' ? 'รายปี' : 'รายเดือน'} ${promotionHeadline(row, offer)}`] : [];
  }) };
}

/** A benefit a request names itself (a re-quote of the same quote, or a switch on the review); a promotion also names its campaign. */
export type QuoteBenefit = { choice: BillingBenefitChoice; campaignId?: string };
export type QuoteFields = { eventDiscountChoice?: 'USE' | 'DECLINE'; eventDiscountTicketSerial?: string; benefitChoice?: BillingBenefitChoice; promotionCampaignId?: string };
/**
 * The benefit fields of one quote request, decided from what the buyer SAW (`promotions` as displayed). The new fields
 * (`benefitChoice`, `promotionCampaignId`) go out only when a promotion is available on THIS card, or the request asks for one by
 * name: the API treats a present `benefitChoice` as authoritative, so EVENT_DISCOUNT where no held discount fits the quoted
 * amount is an error where main's request was an ordinary quote. Every other request is exactly what main sent: nothing without a
 * held discount, else `eventDiscountChoice` USE (with the serial of a non-default pick) or DECLINE when the buyer chose something
 * else. The promotion and a normal purchase say DECLINE so the API's own default (USE) never spends a discount the buyer did not choose.
 */
export function promotionQuoteFields(input: { pick: BillingBenefitChoice | null; explicit?: QuoteBenefit; promotions: readonly Row[] | undefined; card: Card;
  ticket: boolean; ticketOnCard: boolean; serial?: string }): QuoteFields {
  const shown = promotionRow(input.promotions, input.card), row = shown?.available ? shown : undefined;
  const campaignId = input.explicit?.choice === 'PROMOTION' ? input.explicit.campaignId : row?.campaignId;
  const offered = promotionOffered(input.promotions, input.card.interval, input.ticket);
  if (!row && !campaignId) {
    if (!input.ticket) return {};
    const chosen = input.explicit?.choice ?? promotionPick(input.pick, offered);
    return chosen && chosen !== 'EVENT_DISCOUNT' ? { eventDiscountChoice: 'DECLINE' } : { eventDiscountChoice: 'USE', ...(input.serial ? { eventDiscountTicketSerial: input.serial } : {}) };
  }
  const choice = input.explicit?.choice ?? promotionCardBenefit(input.pick, offered, { PROMOTION: !!row, EVENT_DISCOUNT: input.ticket && input.ticketOnCard });
  if (choice === 'PROMOTION' && campaignId) return { benefitChoice: 'PROMOTION', promotionCampaignId: campaignId, eventDiscountChoice: 'DECLINE' };
  if (choice === 'EVENT_DISCOUNT') return { benefitChoice: 'EVENT_DISCOUNT', eventDiscountChoice: 'USE', ...(input.serial ? { eventDiscountTicketSerial: input.serial } : {}) };
  return { benefitChoice: 'NORMAL', ...(input.ticket ? { eventDiscountChoice: 'DECLINE' as const } : {}) };
}
/** What a quote was for, so asking again asks for the same. A quote from before promotions says it through its event discount. */
export function promotionQuoteBenefit(quote: Pick<BillingQuote, 'benefitChoice' | 'eventDiscount' | 'promotion'>): QuoteBenefit | undefined {
  const choice = quote.benefitChoice ?? (quote.eventDiscount ? (quote.eventDiscount.choice === 'USE' ? 'EVENT_DISCOUNT' : 'NORMAL') : undefined);
  return choice && { choice, ...(choice === 'PROMOTION' && quote.promotion ? { campaignId: quote.promotion.campaignId } : {}) };
}

/* ---- the quote review ---- */

/**
 * `quote.totalSatang` is the price of the paid period and of every renewal after it (a promotion adds time, never a discount),
 * so it is also "ราคาปกติ" of the next round; the free time has no price of its own.
 */
export function promotionReview(quote: Pick<BillingQuote, 'promotion' | 'offer' | 'purchaseMode' | 'totalSatang'> | null | undefined, money: (satang: number) => string) {
  const p = quote?.promotion;
  if (!quote || !p) return null;
  const paidMonths = quote.offer.interval === 'year' ? 12 : 1, base = p.totalReceiptUnits - p.bonusReceiptUnits;
  return {
    title: `โปรโมชั่น ${p.displayName}`,
    rows: [
      { label: 'ช่วงที่ชำระ', value: `${day(p.paidStart)} – ${day(p.paidEnd)}` },
      { label: 'ช่วงแถมฟรี', value: `${day(p.paidEnd)} – ${day(p.benefitEnd)}` },
      { label: 'ใช้ได้ถึง', value: day(p.benefitEnd) },
      { label: 'ใบเสร็จ', value: `${base} + แถม ${p.bonusReceiptUnits} = ${p.totalReceiptUnits} ใบ` },
    ],
    // A one-time mode has no next charge (`expectedNextChargeAt` null); the page already says "จ่ายครั้งเดียว".
    next: p.expectedNextChargeAt ? `รอบถัดไปเรียกเก็บวันที่ ${day(p.expectedNextChargeAt)} ราคาปกติ ${money(quote.totalSatang)}${
      quote.purchaseMode === 'PROMPTPAY_RENEW' ? ' (ออกบิล QR ให้สแกน)' : quote.purchaseMode === 'CARD_AUTO' ? ' (ตัดบัตรอัตโนมัติ)' : ''}` : null,
    estimate: 'วันที่ทั้งหมดเป็นการประมาณ ระบบจะยืนยันวันจริงเมื่อชำระสำเร็จ',
    /** The sentence that replaces "ใช้งานได้ 1 เดือน" for a promotion, so the page never says two different lengths. */
    summary: `ชำระสำเร็จแล้ว ใช้งานได้ ${paidMonths + p.bonusMonths} เดือน (ชำระ ${paidMonths} เดือน แถมฟรี ${p.bonusMonths} เดือน)`,
    totalReceiptUnits: p.totalReceiptUnits,
    benefitEnd: p.benefitEnd,
  };
}
/** The held-discount switch on the review. Beside a promotion it says that the discount replaces it. */
export const promotionSwitchLabel = (quote: Pick<BillingQuote, 'benefitChoice' | 'eventDiscount'>) =>
  quote.eventDiscount?.applied ? 'ไม่ใช้ส่วนลดครั้งนี้' : quote.benefitChoice === 'PROMOTION' ? 'ใช้ส่วนลดแทนโปรโมชั่น' : 'ใช้ส่วนลด';

/* ---- the promotion no longer available at pay time ---- */

/**
 * `PROMOTION_UNAVAILABLE` from a quote or a checkout. The page shows this, drops the old quote and asks the buyer to check again;
 * it never turns the promotion into a normal purchase by itself. The API sentence is not shown: only `reason` is read.
 */
export function promotionLostNotice(error: unknown) {
  if (apiErrorCode(error) !== 'PROMOTION_UNAVAILABLE') return null;
  const details = (error as { details?: unknown } | null)?.details, raw = details && typeof details === 'object' ? (details as { reason?: unknown }).reason : undefined;
  const reason: Reason | null = typeof raw === 'string' && Object.hasOwn(REASON_TEXT, raw) ? raw as Reason : null;
  return { title: 'โปรโมชั่นที่เลือกไว้ใช้ไม่ได้แล้ว', text: promotionReasonText(reason),
    hint: reason === 'IN_PROGRESS' ? 'เปิดรายการเดิมที่ค้างอยู่ด้านล่างเพื่อชำระต่อ ไม่ต้องเริ่มรายการใหม่'
      : reason === 'CHANGED' ? 'กรุณาตรวจสอบรายการใหม่ แล้วอ่านเวลา ใบเสร็จ และราคาอีกครั้งก่อนชำระ'
      : 'ถ้าซื้อต่อ จะไม่ได้เวลาและใบเสร็จแถมจากโปรโมชั่น กรุณาตรวจสอบรายการใหม่ก่อนชำระ',
    /** With a payment already open there is nothing to quote: the open payment is the way on. */
    canRecheck: reason !== 'IN_PROGRESS' };
}
export type PromotionLostNotice = NonNullable<ReturnType<typeof promotionLostNotice>>;

/* ---- after the payment ---- */

/** The right this shop holds, on the status and on the return page. `checking` = offer the existing "check again" control. */
export function promotionStatus(use: BillingPromotionUse | null | undefined) {
  if (!use) return null;
  const name = `โปรโมชั่น ${use.displayName}`;
  // The right is held for a Checkout still open: not used yet, and the words must not say it was.
  if (use.state === 'RESERVED') return { title: 'จองสิทธิ์โปรโมชั่นไว้ให้รายการชำระนี้แล้ว', lines: [name, 'สิทธิ์จะเริ่มใช้เมื่อชำระเงินสำเร็จ'], checking: false };
  const until = use.benefitEnd ? day(use.benefitEnd) : null, pending = use.renewalSetupState === 'PENDING';
  const renewal: string | null = {
    PENDING: `ชำระแล้ว ${until ? `ใช้ได้ถึง ${until} ` : ''}กำลังตั้งค่ารอบถัดไป ไม่ต้องชำระซ้ำ`,
    REVIEW: 'ชำระแล้ว ทีมงานกำลังตรวจการตั้งรอบถัดไป ไม่ต้องชำระซ้ำ',
    READY: use.expectedNextChargeAt ? `ตั้งต่ออายุแล้ว รอบถัดไปเรียกเก็บวันที่ ${day(use.expectedNextChargeAt)}` : 'ตั้งต่ออายุแล้ว',
    NOT_REQUIRED: null,
    CANCELLED: null,
  }[use.renewalSetupState] ?? null;
  const bonus = [use.bonusMonths > 0 && `แถมฟรี ${use.bonusMonths} เดือน`, use.bonusReceiptUnits > 0 && `ใบเสร็จเพิ่ม ${use.bonusReceiptUnits} ใบ`].filter(Boolean).join(' · ');
  return { title: 'ใช้สิทธิ์โปรโมชั่นแล้ว', checking: pending,
    lines: [name, ...(pending ? [] : [until ? `ใช้ได้ถึง ${until}` : 'กำลังเปิดสิทธิ์ให้ ไม่ต้องชำระซ้ำ']), ...(renewal ? [renewal] : []), ...(bonus ? [bonus] : [])] };
}

/* ---- upgrade (Q5) ---- */

/**
 * The card of a higher package on the same cadence is an immediate upgrade; while `upgradeDeferredUntil` lies ahead the API
 * refuses it, so the page says when instead of offering it. Null = this card is not held back.
 */
export function promotionUpgradeNote(status: Pick<BillingStatus, 'upgradeDeferredUntil' | 'accessState' | 'tierKey' | 'interval'>, offer: Card, now: number = Date.now()): string | null {
  const until = status.upgradeDeferredUntil, rank = (tier: string | null) => BILLING_PAID_TIERS.findIndex(item => item === tier);
  if (!until || Date.parse(until) <= now || status.accessState !== 'ACTIVE' || status.interval !== offer.interval) return null;
  return rank(status.tierKey) >= 0 && rank(offer.offerKey) > rank(status.tierKey)
    ? `อัปเกรดได้หลังวันที่ ${day(until)} เพราะแพ็กเกจปัจจุบันยังมีเวลาโปรโมชั่นที่ใช้ไม่หมด` : null;
}
