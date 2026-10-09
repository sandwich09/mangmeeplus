import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import type { BillingBenefitChoice, BillingPromotionOfferView, BillingPromotionUnavailableReason, BillingPromotionUse, BillingRenewalSetupState } from '@watchdog-bms/contracts';
import { EVENT_DISCOUNT_ONE_PER_PAYMENT, eventDiscountHelpText } from './billing-event-discount';
import { PROMOTION_NOT_PICKED, PROMOTION_ONCE, PROMOTION_ONE_PER_PURCHASE, promotionCard, promotionCardBenefit, promotionChoiceCopy, promotionChoiceLabel, promotionHeadline,
  promotionLostNotice, promotionOffered, promotionPageBenefit, promotionPick, promotionQuoteBenefit, promotionQuoteFields, promotionReasonText, promotionReview, promotionRow,
  promotionStatus, promotionSwitchLabel, promotionUpgradeNote } from './billing-promotion';

const CAMPAIGN = 'camp_9f3';
const row = (over: Partial<BillingPromotionOfferView> = {}): BillingPromotionOfferView => ({ campaignId: CAMPAIGN, displayName: 'ซื้อ 1 แถม 1', offerKey: 'STARTER_249', interval: 'month',
  bonusMonths: 1, bonusReceiptUnits: 30, totalMonths: 2, totalReceiptUnits: 60, endsAt: '2026-10-31T16:59:59.000Z', available: true, reason: null, ...over });
const yearRow = (over: Partial<BillingPromotionOfferView> = {}) => row({ interval: 'year', totalMonths: 13, totalReceiptUnits: 390, ...over });
const STARTER_MONTH = { offerKey: 'STARTER_249', interval: 'month' }, BASIC_MONTH = { offerKey: 'BASIC_499', interval: 'month' };
const money = (satang: number) => `${satang / 100} บาท`;
/** A screen never shows a campaign id, an enum key, a code, or a JavaScript word. */
const MACHINE = new RegExp(`[A-Z]{3,}_[A-Z]|${CAMPAIGN}|undefined|\\bnull\\b|NaN|\\[object`);

// Every value of the unions, as a Record: a new reason or renewal state in the contract fails the typecheck here until it is covered.
const REASONS: Record<BillingPromotionUnavailableReason, true> = { NOT_STARTED: true, ENDED: true, PAUSED: true, CAP_FULL: true, ALREADY_USED: true, IN_PROGRESS: true,
  CATALOG_STALE: true, OFFER_NOT_COVERED: true, PURCHASE_KIND_UNSUPPORTED: true, CHANGED: true };
const RENEWAL_STATES: Record<BillingRenewalSetupState, true> = { NOT_REQUIRED: true, PENDING: true, READY: true, REVIEW: true, CANCELLED: true };

test('the row for a card is its own package and cadence; an available row wins; other packages show nothing', () => {
  assert.equal(promotionRow([row()], STARTER_MONTH)?.campaignId, CAMPAIGN);
  assert.equal(promotionRow([row()], BASIC_MONTH), undefined);
  assert.equal(promotionRow([row()], { offerKey: 'STARTER_249', interval: 'year' }), undefined);
  assert.equal(promotionRow(undefined, STARTER_MONTH), undefined);
  assert.equal(promotionRow([], STARTER_MONTH), undefined);
  const used = row({ campaignId: 'old', available: false, reason: 'ALREADY_USED' });
  assert.equal(promotionRow([used, row()], STARTER_MONTH)?.campaignId, CAMPAIGN, 'the open campaign speaks, whatever the order');
  assert.equal(promotionRow([row(), used], STARTER_MONTH)?.campaignId, CAMPAIGN);
  assert.equal(promotionRow([used], STARTER_MONTH)?.reason, 'ALREADY_USED', 'with nothing open, the reason why not');
});

test('the card text comes from the card price and the row, for a month and a year and for any figures', () => {
  assert.equal(promotionHeadline(row(), { priceSatang: 24900 }), '249 บาท ได้ 2 เดือน');
  assert.equal(promotionHeadline(yearRow(), { priceSatang: 249000 }), '2,490 บาท ได้ 13 เดือน');
  assert.deepEqual(promotionCard(row(), { priceSatang: 24900 }), { name: 'ซื้อ 1 แถม 1', headline: '249 บาท ได้ 2 เดือน', lines: [
    'ชำระ 1 เดือน แถมฟรี 1 เดือน', 'ใบเสร็จ 60 ใบ (รวมแถม 30 ใบ)', 'ใช้ได้ครั้งเดียวต่อร้าน', 'โปรโมชั่นสิ้นสุด 31 ตุลาคม 2569 เวลา 23:59 น.'] });
  assert.deepEqual(promotionCard(yearRow(), { priceSatang: 249000 }).lines.slice(0, 2), ['ชำระ 12 เดือน แถมฟรี 1 เดือน', 'ใบเสร็จ 390 ใบ (รวมแถม 30 ใบ)']);
  // Any other figures: nothing is remembered from the first campaign.
  const other = promotionCard(row({ displayName: 'ฉลองเปิดร้าน', totalMonths: 5, bonusMonths: 2, totalReceiptUnits: 125, bonusReceiptUnits: 25 }), { priceSatang: 19950 });
  assert.equal(other.headline, '199.50 บาท ได้ 5 เดือน');
  assert.deepEqual(other.lines.slice(0, 2), ['ชำระ 3 เดือน แถมฟรี 2 เดือน', 'ใบเสร็จ 125 ใบ (รวมแถม 25 ใบ)']);
  assert.equal(other.name, 'ฉลองเปิดร้าน');
  assert.doesNotMatch(JSON.stringify(other), /\b(?:249|60|390)\b/);
  assert.equal(PROMOTION_ONCE, 'ใช้ได้ครั้งเดียวต่อร้าน');
});

test('the campaign end is told in Thai time with its clock, also across midnight', () => {
  const end = (endsAt: string) => promotionCard(row({ endsAt }), { priceSatang: 24900 }).lines[3];
  assert.equal(end('2026-10-31T16:59:59.000Z'), 'โปรโมชั่นสิ้นสุด 31 ตุลาคม 2569 เวลา 23:59 น.');
  assert.equal(end('2026-10-31T17:00:00.000Z'), 'โปรโมชั่นสิ้นสุด 1 พฤศจิกายน 2569 เวลา 00:00 น.', 'midnight in Bangkok is the next day, not 17:00');
  assert.equal(end('2026-11-01T01:05:00.000Z'), 'โปรโมชั่นสิ้นสุด 1 พฤศจิกายน 2569 เวลา 08:05 น.');
});

test('every reason has its own plain Thai sentence, and the four owner-approved ones read exactly so', () => {
  const texts = (Object.keys(REASONS) as BillingPromotionUnavailableReason[]).map(reason => promotionReasonText(reason));
  for (const text of texts) { assert.ok(text.length > 5); assert.doesNotMatch(text, MACHINE); assert.doesNotMatch(text, /\n/); assert.match(text, /[ก-๛]/u); }
  assert.equal(new Set(texts).size, texts.length, 'no two reasons share a sentence');
  for (const reason of Object.keys(REASONS) as BillingPromotionUnavailableReason[]) assert.notEqual(promotionReasonText(reason), promotionReasonText(null), `${reason} has a sentence of its own, not the fallback`);
  assert.equal(promotionReasonText('ALREADY_USED'), 'ร้านนี้ใช้สิทธิ์โปรโมชั่นนี้แล้ว');
  assert.equal(promotionReasonText('CAP_FULL'), 'สิทธิ์โปรโมชั่นครบจำนวนแล้ว');
  assert.equal(promotionReasonText('IN_PROGRESS'), 'มีรายการชำระที่ใช้สิทธิ์นี้ค้างอยู่ เปิดรายการเดิมเพื่อชำระต่อ');
  assert.equal(promotionReasonText('PURCHASE_KIND_UNSUPPORTED'), 'โปรโมชั่นนี้ยังใช้กับการซื้อแบบนี้ไม่ได้');
  // A reason a newer API sends, or none at all, still reads as a sentence.
  assert.equal(promotionReasonText(null), 'โปรโมชั่นนี้ใช้ไม่ได้ในตอนนี้');
  assert.equal(promotionReasonText('SOMETHING_NEW' as BillingPromotionUnavailableReason), 'โปรโมชั่นนี้ใช้ไม่ได้ในตอนนี้');
});

test('Q4: what can be picked — promotion only, discount only, both, neither — and which one is on by default', () => {
  const rows = [row(), yearRow({ available: false, reason: 'CAP_FULL' })];
  assert.deepEqual(promotionOffered(rows, 'month', false), { PROMOTION: true, EVENT_DISCOUNT: false });
  assert.deepEqual(promotionOffered(rows, 'month', true), { PROMOTION: true, EVENT_DISCOUNT: true });
  assert.deepEqual(promotionOffered(rows, 'year', false), { PROMOTION: false, EVENT_DISCOUNT: false }, 'a row that says why not offers nothing');
  assert.deepEqual(promotionOffered(rows, 'year', true), { PROMOTION: false, EVENT_DISCOUNT: true });
  assert.deepEqual(promotionOffered(undefined, 'month', false), { PROMOTION: false, EVENT_DISCOUNT: false });
  // The default: the promotion, else the held discount (as before promotions), else normal.
  assert.equal(promotionPageBenefit(null, { PROMOTION: true, EVENT_DISCOUNT: false }), 'PROMOTION');
  assert.equal(promotionPageBenefit(null, { PROMOTION: true, EVENT_DISCOUNT: true }), 'PROMOTION');
  assert.equal(promotionPageBenefit(null, { PROMOTION: false, EVENT_DISCOUNT: true }), 'EVENT_DISCOUNT');
  assert.equal(promotionPageBenefit(null, { PROMOTION: false, EVENT_DISCOUNT: false }), 'NORMAL');
  // A pick holds while it is on offer; one that is gone falls back to the default; normal is always possible.
  const both = { PROMOTION: true, EVENT_DISCOUNT: true }, none = { PROMOTION: false, EVENT_DISCOUNT: false };
  for (const pick of ['PROMOTION', 'EVENT_DISCOUNT', 'NORMAL'] as BillingBenefitChoice[]) assert.equal(promotionPageBenefit(pick, both), pick);
  assert.equal(promotionPick('PROMOTION', { PROMOTION: false, EVENT_DISCOUNT: true }), null);
  assert.equal(promotionPageBenefit('PROMOTION', { PROMOTION: false, EVENT_DISCOUNT: true }), 'EVENT_DISCOUNT');
  assert.equal(promotionPageBenefit('EVENT_DISCOUNT', none), 'NORMAL');
  assert.equal(promotionPageBenefit('NORMAL', none), 'NORMAL');
});

test('Q4: a card takes the pick where it fits and otherwise a normal purchase; with no pick, what it has', () => {
  const both = { PROMOTION: true, EVENT_DISCOUNT: true };
  const starter = { PROMOTION: true, EVENT_DISCOUNT: true }, basic = { PROMOTION: false, EVENT_DISCOUNT: true }, bare = { PROMOTION: false, EVENT_DISCOUNT: false };
  // No pick: the card the buyer came for takes its promotion, another card keeps today's held discount.
  assert.equal(promotionCardBenefit(null, both, starter), 'PROMOTION');
  assert.equal(promotionCardBenefit(null, both, basic), 'EVENT_DISCOUNT');
  assert.equal(promotionCardBenefit(null, both, bare), 'NORMAL');
  // A pick is never turned into another benefit the buyer did not choose.
  assert.equal(promotionCardBenefit('PROMOTION', both, starter), 'PROMOTION');
  assert.equal(promotionCardBenefit('PROMOTION', both, basic), 'NORMAL');
  assert.equal(promotionCardBenefit('EVENT_DISCOUNT', both, starter), 'EVENT_DISCOUNT');
  assert.equal(promotionCardBenefit('EVENT_DISCOUNT', both, bare), 'NORMAL');
  assert.equal(promotionCardBenefit('NORMAL', both, starter), 'NORMAL');
  // A pick that is no longer offered anywhere is the default again.
  assert.equal(promotionCardBenefit('PROMOTION', { PROMOTION: false, EVENT_DISCOUNT: true }, basic), 'EVENT_DISCOUNT');
});

test('Q4: the exact request fields of each choice; a shop with neither sends today\'s request', () => {
  const card = STARTER_MONTH, promotions = [row()];
  const fields = (over: Partial<Parameters<typeof promotionQuoteFields>[0]> = {}) => promotionQuoteFields({ pick: null, promotions, card, ticket: false, ticketOnCard: false, ...over });
  // Neither a promotion nor a held discount: no new field at all — also when the only row says why not.
  assert.deepEqual(fields({ promotions: undefined }), {});
  assert.deepEqual(fields({ promotions: [] }), {});
  assert.deepEqual(fields({ promotions: [row({ available: false, reason: 'ALREADY_USED' })] }), {});
  assert.deepEqual(fields({ promotions: [row()], card: BASIC_MONTH }), {}, 'another package has nothing to choose');
  // The promotion (the default on its card): its campaign, and the discount declined so the API never defaults to spending it.
  const promoFields = { benefitChoice: 'PROMOTION', promotionCampaignId: CAMPAIGN, eventDiscountChoice: 'DECLINE' };
  assert.deepEqual(fields(), promoFields);
  assert.deepEqual(fields({ ticket: true, ticketOnCard: true }), promoFields, 'promotion and a held discount: the promotion, the discount is not used');
  assert.deepEqual(fields({ pick: 'PROMOTION', ticket: true, ticketOnCard: true }), promoFields);
  // A held discount: today's fields plus the benefit.
  assert.deepEqual(fields({ pick: 'EVENT_DISCOUNT', ticket: true, ticketOnCard: true }), { benefitChoice: 'EVENT_DISCOUNT', eventDiscountChoice: 'USE' });
  assert.deepEqual(fields({ pick: 'EVENT_DISCOUNT', ticket: true, ticketOnCard: true, serial: 'EVT2AAAA' }), { benefitChoice: 'EVENT_DISCOUNT', eventDiscountChoice: 'USE', eventDiscountTicketSerial: 'EVT2AAAA' });
  assert.deepEqual(fields({ promotions: undefined, ticket: true, ticketOnCard: true }), { eventDiscountChoice: 'USE' }, 'a discount-only shop sends main\'s request: no new field');
  // Normal: no benefit; DECLINE only when there is a discount to decline.
  assert.deepEqual(fields({ pick: 'NORMAL' }), { benefitChoice: 'NORMAL' });
  assert.deepEqual(fields({ pick: 'NORMAL', ticket: true, ticketOnCard: true }), { benefitChoice: 'NORMAL', eventDiscountChoice: 'DECLINE' });
  assert.deepEqual(fields({ promotions: undefined, pick: 'NORMAL', ticket: true, ticketOnCard: true }), { eventDiscountChoice: 'DECLINE' }, 'declined by the buyer: main\'s own word');
  assert.deepEqual(fields({ promotions: undefined, ticket: true, ticketOnCard: false }), { eventDiscountChoice: 'USE' }, 'a discount that does not lower this card is not declined for the buyer: main asked for it and got an ordinary quote');
  // A pick for the promotion on another package: this card has no promotion, so the request is main's; the buyer chose against the discount, so it stays unspent.
  assert.deepEqual(fields({ card: BASIC_MONTH, pick: 'PROMOTION', ticket: true, ticketOnCard: true }), { eventDiscountChoice: 'DECLINE' });
  assert.deepEqual(fields({ card: BASIC_MONTH, ticket: true, ticketOnCard: true }), { eventDiscountChoice: 'USE' }, 'with no pick, the discount that lowers it, as before');
  // A promotion that is gone from the screen is not asked for.
  assert.deepEqual(fields({ promotions: [], pick: 'PROMOTION', ticket: true, ticketOnCard: true }), { eventDiscountChoice: 'USE' });
});

// origin/main sent only `eventDiscountChoice` (BillingPage `discountChoice = ticket ? choice ?? eventChoice : undefined`) and the ticket serial
// with USE and a non-default pick. The API treats a present `benefitChoice` as authoritative: EVENT_DISCOUNT with no ticket that fits the quoted
// amount is SALES_EVENT_TICKET_UNAVAILABLE, where the request without it was an ordinary quote. So the new fields go out only when a promotion
// is available on the card being quoted, or the request asks for a promotion by name; every other request is main's, byte for byte.
type Fields = ReturnType<typeof promotionQuoteFields>;
const USE: Fields = { eventDiscountChoice: 'USE' }, DECLINE: Fields = { eventDiscountChoice: 'DECLINE' };
const PROMOTION_FIELDS: Fields = { benefitChoice: 'PROMOTION', promotionCampaignId: CAMPAIGN, eventDiscountChoice: 'DECLINE' };
const PICKS = [null, 'PROMOTION', 'EVENT_DISCOUNT', 'NORMAL'] as const;
/** Held discount: none, one that lowers the card, one that does not. */
const HELD = { none: { ticket: false, ticketOnCard: false }, onCard: { ticket: true, ticketOnCard: true }, offCard: { ticket: true, ticketOnCard: false } } as const;
type Held = keyof typeof HELD;
const LEGACY_ROWS: Record<string, { promotions: BillingPromotionOfferView[]; expected: Record<Held, Fields[]> }> = {
  // Expected in PICKS order: no pick, the promotion, the discount, normal. A pick of the promotion that is gone from this cadence is the default again.
  'no promotion row': { promotions: [], expected: { none: [{}, {}, {}, {}], onCard: [USE, USE, USE, DECLINE], offCard: [USE, USE, USE, DECLINE] } },
  'a row that only says why not': { promotions: [row({ available: false, reason: 'ALREADY_USED' })], expected: { none: [{}, {}, {}, {}], onCard: [USE, USE, USE, DECLINE], offCard: [USE, USE, USE, DECLINE] } },
  'an available row on the other cadence': { promotions: [yearRow()], expected: { none: [{}, {}, {}, {}], onCard: [USE, USE, USE, DECLINE], offCard: [USE, USE, USE, DECLINE] } },
  // The promotion is on offer on this cadence for ANOTHER package: a buyer who picked it chose against the discount, so it stays unspent (DECLINE, main's own word).
  'an available row on another package of this cadence': { promotions: [row({ offerKey: 'BASIC_499' })], expected: { none: [{}, {}, {}, {}], onCard: [USE, DECLINE, USE, DECLINE], offCard: [USE, DECLINE, USE, DECLINE] } },
};
const ROW_ON_CARD: { promotions: BillingPromotionOfferView[]; expected: Record<Held, Fields[]> } = { promotions: [row()], expected: {
  none: [PROMOTION_FIELDS, PROMOTION_FIELDS, PROMOTION_FIELDS, { benefitChoice: 'NORMAL' }],
  onCard: [PROMOTION_FIELDS, PROMOTION_FIELDS, { benefitChoice: 'EVENT_DISCOUNT', eventDiscountChoice: 'USE' }, { benefitChoice: 'NORMAL', eventDiscountChoice: 'DECLINE' }],
  offCard: [PROMOTION_FIELDS, PROMOTION_FIELDS, { benefitChoice: 'NORMAL', eventDiscountChoice: 'DECLINE' }, { benefitChoice: 'NORMAL', eventDiscountChoice: 'DECLINE' }],
} };

test('table: the request fields for {held discount} x {promotion row} x {pick}; a card with no available row sends main\'s request, byte for byte', () => {
  const cells: string[] = [], wrong: string[] = [];
  const ALL_ROWS: [string, typeof ROW_ON_CARD][] = [...Object.entries(LEGACY_ROWS), ['an available row on this card', ROW_ON_CARD]];
  for (const [name, { promotions, expected }] of ALL_ROWS) {
    for (const held of Object.keys(HELD) as Held[]) PICKS.forEach((pick, index) => {
      const fields = promotionQuoteFields({ pick, promotions, card: STARTER_MONTH, ...HELD[held] }), cell = `${name} / ${held} / ${pick}`;
      cells.push(cell);
      if (!isDeepStrictEqual(fields, expected[held][index])) wrong.push(`${cell}: got ${JSON.stringify(fields)}, want ${JSON.stringify(expected[held][index])}`);
      // Without an available row on the card, nothing new is named at all.
      if (name !== 'an available row on this card' && ('benefitChoice' in fields || 'promotionCampaignId' in fields)) wrong.push(`${cell}: names a new field`);
    });
  }
  assert.equal(cells.length, 5 * 3 * 4, 'every cell was checked');
  assert.deepEqual(wrong, [], 'cells that differ from the expectation');
  // The serial rides with USE only, as on main: a non-default pick of a held discount; DECLINE never carries it.
  const serial = 'EVT2AAAA';
  assert.deepEqual(promotionQuoteFields({ pick: null, promotions: [], card: STARTER_MONTH, ...HELD.onCard, serial }), { eventDiscountChoice: 'USE', eventDiscountTicketSerial: serial });
  assert.deepEqual(promotionQuoteFields({ pick: 'NORMAL', promotions: [], card: STARTER_MONTH, ...HELD.onCard, serial }), DECLINE);
  assert.deepEqual(promotionQuoteFields({ pick: null, promotions: [], card: STARTER_MONTH, ...HELD.none, serial }), {}, 'no held discount, no serial');
  assert.deepEqual(promotionQuoteFields({ pick: 'EVENT_DISCOUNT', promotions: [row()], card: STARTER_MONTH, ...HELD.onCard, serial }), { benefitChoice: 'EVENT_DISCOUNT', eventDiscountChoice: 'USE', eventDiscountTicketSerial: serial });
});

test('table: a request that names its benefit (asking again, or the review switch) asks for a promotion by name wherever it went, and says the others in main\'s words', () => {
  for (const [name, { promotions }] of Object.entries(LEGACY_ROWS)) for (const held of Object.keys(HELD) as Held[]) {
    const ask = (explicit: Parameters<typeof promotionQuoteFields>[0]['explicit']) => promotionQuoteFields({ pick: 'EVENT_DISCOUNT', explicit, promotions, card: STARTER_MONTH, ...HELD[held] });
    const ticket = HELD[held].ticket;
    assert.deepEqual(ask({ choice: 'PROMOTION', campaignId: CAMPAIGN }), PROMOTION_FIELDS, `${name} / ${held}: a promotion is asked for by name, never swapped`);
    assert.deepEqual(ask({ choice: 'EVENT_DISCOUNT' }), ticket ? USE : {}, `${name} / ${held}`);
    assert.deepEqual(ask({ choice: 'NORMAL' }), ticket ? DECLINE : {}, `${name} / ${held}`);
  }
});

test('asking again keeps the benefit of the quote, and a promotion that left the screen is still asked for by name, never swapped', () => {
  const explicit = promotionQuoteBenefit({ benefitChoice: 'PROMOTION', promotion: { campaignId: CAMPAIGN } as never });
  assert.deepEqual(explicit, { choice: 'PROMOTION', campaignId: CAMPAIGN });
  assert.deepEqual(promotionQuoteFields({ pick: 'NORMAL', explicit, promotions: [], card: STARTER_MONTH, ticket: false, ticketOnCard: false }),
    { benefitChoice: 'PROMOTION', promotionCampaignId: CAMPAIGN, eventDiscountChoice: 'DECLINE' }, 'the quote decides, not the page pick, not the rows now on screen');
  assert.deepEqual(promotionQuoteBenefit({ benefitChoice: 'EVENT_DISCOUNT' }), { choice: 'EVENT_DISCOUNT' });
  assert.deepEqual(promotionQuoteBenefit({ benefitChoice: 'NORMAL' }), { choice: 'NORMAL' });
  // A quote from before promotions says it through its event discount, as the page always did.
  assert.deepEqual(promotionQuoteBenefit({ eventDiscount: { choice: 'USE' } as never }), { choice: 'EVENT_DISCOUNT' });
  assert.deepEqual(promotionQuoteBenefit({ eventDiscount: { choice: 'DECLINE' } as never }), { choice: 'NORMAL' });
  assert.equal(promotionQuoteBenefit({}), undefined);
  // The switch beside a promotion says that the discount replaces it.
  assert.equal(promotionSwitchLabel({ eventDiscount: { applied: {} } as never }), 'ไม่ใช้ส่วนลดครั้งนี้');
  assert.equal(promotionSwitchLabel({ eventDiscount: {} as never }), 'ใช้ส่วนลด');
  assert.equal(promotionSwitchLabel({ benefitChoice: 'PROMOTION', eventDiscount: {} as never }), 'ใช้ส่วนลดแทนโปรโมชั่น');
});

test('the choice group reads as today without a promotion, and as three ways with one', () => {
  assert.deepEqual(promotionChoiceCopy({ promotion: false, ticket: true, firstBillOnly: false }), { section: 'ส่วนลดจากงาน', legend: 'ส่วนลดจากงาน', normal: 'ไม่ใช้ครั้งนี้',
    notes: [EVENT_DISCOUNT_ONE_PER_PAYMENT, eventDiscountHelpText(false)] });
  assert.deepEqual(promotionChoiceCopy({ promotion: false, ticket: true, firstBillOnly: true }).notes, [EVENT_DISCOUNT_ONE_PER_PAYMENT, eventDiscountHelpText(true)]);
  assert.deepEqual(promotionChoiceCopy({ promotion: true, ticket: false, firstBillOnly: false }),
    { section: 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้', legend: 'เลือกสิ่งที่จะใช้ในการซื้อครั้งนี้', normal: 'ซื้อแบบปกติ', notes: [PROMOTION_ONE_PER_PURCHASE] });
  assert.deepEqual(promotionChoiceCopy({ promotion: true, ticket: true, firstBillOnly: true }).notes, [PROMOTION_ONE_PER_PURCHASE, eventDiscountHelpText(true)]);
  const offers = [{ ...STARTER_MONTH, label: 'สตาร์ทเตอร์', priceSatang: 24900 }, { offerKey: 'STARTER_249', interval: 'year', label: 'สตาร์ทเตอร์', priceSatang: 249000 }] as Parameters<typeof promotionChoiceLabel>[1];
  assert.deepEqual(promotionChoiceLabel([row()], offers, 'month'), { title: 'ใช้โปรโมชั่น ซื้อ 1 แถม 1', lines: ['สตาร์ทเตอร์ รายเดือน 249 บาท ได้ 2 เดือน'] });
  assert.deepEqual(promotionChoiceLabel([yearRow()], offers, 'year'), { title: 'ใช้โปรโมชั่น ซื้อ 1 แถม 1', lines: ['สตาร์ทเตอร์ รายปี 2,490 บาท ได้ 13 เดือน'] });
  assert.equal(promotionChoiceLabel([yearRow()], offers, 'month'), null, 'nothing on offer for this cadence');
  assert.equal(promotionChoiceLabel([row({ available: false, reason: 'CAP_FULL' })], offers, 'month'), null, 'a promotion that cannot be used is not a choice');
  assert.equal(PROMOTION_ONE_PER_PURCHASE, 'ใช้ได้ครั้งละ 1 อย่างต่อการซื้อ สิ่งที่ไม่ได้เลือกจะไม่ถูกใช้');
  assert.equal(PROMOTION_NOT_PICKED, 'ครั้งนี้ไม่ได้เลือกใช้โปรโมชั่นนี้');
});

const quote = (over: Record<string, unknown> = {}, promotion: Record<string, unknown> = {}) => ({ offer: { interval: 'month' }, purchaseMode: 'CARD_AUTO', totalSatang: 24900,
  promotion: { campaignId: CAMPAIGN, displayName: 'ซื้อ 1 แถม 1', bonusMonths: 1, bonusReceiptUnits: 30, totalReceiptUnits: 60, paidStart: '2026-10-05T03:00:00.000Z',
    paidEnd: '2026-11-05T03:00:00.000Z', benefitEnd: '2026-12-05T03:00:00.000Z', expectedNextChargeAt: '2026-12-05T03:00:00.000Z', ...promotion }, ...over }) as unknown as Parameters<typeof promotionReview>[0];

test('the quote review: paid period, free time, end, receipts, next round — from the quote, as estimates', () => {
  const review = promotionReview(quote(), money)!;
  assert.equal(review.title, 'โปรโมชั่น ซื้อ 1 แถม 1');
  assert.deepEqual(review.rows, [
    { label: 'ช่วงที่ชำระ', value: '5 ตุลาคม 2569 – 5 พฤศจิกายน 2569' },
    { label: 'ช่วงแถมฟรี', value: '5 พฤศจิกายน 2569 – 5 ธันวาคม 2569' },
    { label: 'ใช้ได้ถึง', value: '5 ธันวาคม 2569' },
    { label: 'ใบเสร็จ', value: '30 + แถม 30 = 60 ใบ' }]);
  assert.equal(review.next, 'รอบถัดไปเรียกเก็บวันที่ 5 ธันวาคม 2569 ราคาปกติ 249 บาท (ตัดบัตรอัตโนมัติ)');
  assert.equal(review.estimate, 'วันที่ทั้งหมดเป็นการประมาณ ระบบจะยืนยันวันจริงเมื่อชำระสำเร็จ');
  assert.equal(review.summary, 'ชำระสำเร็จแล้ว ใช้งานได้ 2 เดือน (ชำระ 1 เดือน แถมฟรี 1 เดือน)');
  assert.equal(review.benefitEnd, '2026-12-05T03:00:00.000Z');
  assert.equal(review.totalReceiptUnits, 60);
  // A renewing mode by bill; a one-time mode has no next round to tell.
  assert.match(promotionReview(quote({ purchaseMode: 'PROMPTPAY_RENEW' }), money)!.next!, /5 ธันวาคม 2569 ราคาปกติ 249 บาท \(ออกบิล QR ให้สแกน\)$/);
  assert.equal(promotionReview(quote({ purchaseMode: 'CARD_ONCE' }, { expectedNextChargeAt: null }), money)!.next, null);
  assert.equal(promotionReview(quote({ purchaseMode: 'PROMPTPAY_ONCE' }, { expectedNextChargeAt: null }), money)!.next, null);
  // A year, and other figures: the receipts add up from the quote's own numbers.
  const year = promotionReview(quote({ offer: { interval: 'year' }, totalSatang: 249000 }, { bonusReceiptUnits: 45, totalReceiptUnits: 405 }), money)!;
  assert.equal(year.rows[3]!.value, '360 + แถม 45 = 405 ใบ');
  assert.equal(year.summary, 'ชำระสำเร็จแล้ว ใช้งานได้ 13 เดือน (ชำระ 12 เดือน แถมฟรี 1 เดือน)');
  assert.match(year.next!, /ราคาปกติ 2490 บาท/);
  // The dates are Thai dates: 01:30 in Bangkok is still the previous day in UTC.
  assert.equal(promotionReview(quote({}, { paidStart: '2026-10-04T18:30:00.000Z' }), money)!.rows[0]!.value, '5 ตุลาคม 2569 – 5 พฤศจิกายน 2569');
  assert.equal(promotionReview(quote({ promotion: undefined }), money), null);
  assert.equal(promotionReview(null, money), null);
  assert.doesNotMatch(JSON.stringify(review), MACHINE);
});

const use = (over: Partial<BillingPromotionUse> = {}): BillingPromotionUse => ({ campaignId: CAMPAIGN, displayName: 'ซื้อ 1 แถม 1', state: 'CONSUMED', paidEnd: '2026-11-05T03:00:00.000Z',
  benefitEnd: '2026-12-05T03:00:00.000Z', bonusMonths: 1, bonusReceiptUnits: 30, renewalSetupState: 'NOT_REQUIRED', expectedNextChargeAt: null, ...over });

test('after payment: one block per renewal-setup state, and never an invitation to pay again', () => {
  const NAME = 'โปรโมชั่น ซื้อ 1 แถม 1', UNTIL = 'ใช้ได้ถึง 5 ธันวาคม 2569', BONUS = 'แถมฟรี 1 เดือน · ใบเสร็จเพิ่ม 30 ใบ';
  const EXPECT: Record<BillingRenewalSetupState, { lines: string[]; checking: boolean }> = {
    NOT_REQUIRED: { lines: [NAME, UNTIL, BONUS], checking: false },
    PENDING: { lines: [NAME, 'ชำระแล้ว ใช้ได้ถึง 5 ธันวาคม 2569 กำลังตั้งค่ารอบถัดไป ไม่ต้องชำระซ้ำ', BONUS], checking: true },
    REVIEW: { lines: [NAME, UNTIL, 'ชำระแล้ว ทีมงานกำลังตรวจการตั้งรอบถัดไป ไม่ต้องชำระซ้ำ', BONUS], checking: false },
    READY: { lines: [NAME, UNTIL, 'ตั้งต่ออายุแล้ว รอบถัดไปเรียกเก็บวันที่ 5 ธันวาคม 2569', BONUS], checking: false },
    CANCELLED: { lines: [NAME, UNTIL, BONUS], checking: false },
  };
  for (const state of Object.keys(RENEWAL_STATES) as BillingRenewalSetupState[]) {
    const block = promotionStatus(use({ renewalSetupState: state, expectedNextChargeAt: state === 'READY' ? '2026-12-05T03:00:00.000Z' : null }))!;
    assert.equal(block.title, 'ใช้สิทธิ์โปรโมชั่นแล้ว', state);
    assert.deepEqual({ lines: block.lines, checking: block.checking }, EXPECT[state], state);
    assert.doesNotMatch(block.lines.join(' '), /ชำระ(?:ใหม่|อีก)|ซื้อ(?:ใหม่|อีก|เพิ่ม)/, `${state}: no invitation to pay again`);
    assert.doesNotMatch(JSON.stringify(block), MACHINE, state);
  }
  // Paid but not yet applied: no date yet, and the words still do not say anything untrue.
  assert.deepEqual(promotionStatus(use({ benefitEnd: null, renewalSetupState: 'PENDING' }))!.lines.slice(0, 2), [NAME, 'ชำระแล้ว กำลังตั้งค่ารอบถัดไป ไม่ต้องชำระซ้ำ']);
  assert.deepEqual(promotionStatus(use({ benefitEnd: null }))!.lines.slice(0, 2), [NAME, 'กำลังเปิดสิทธิ์ให้ ไม่ต้องชำระซ้ำ']);
  assert.deepEqual(promotionStatus(use({ renewalSetupState: 'READY', expectedNextChargeAt: null }))!.lines.at(-2), 'ตั้งต่ออายุแล้ว');
  // A right reserved for a Checkout still open is not used yet.
  const reserved = promotionStatus(use({ state: 'RESERVED', benefitEnd: null, paidEnd: null }))!;
  assert.equal(reserved.title, 'จองสิทธิ์โปรโมชั่นไว้ให้รายการชำระนี้แล้ว');
  assert.doesNotMatch(JSON.stringify(reserved), /ใช้สิทธิ์โปรโมชั่นแล้ว/);
  assert.equal(reserved.checking, false);
  // Fewer bonus facts, fewer words.
  assert.deepEqual(promotionStatus(use({ bonusMonths: 0, bonusReceiptUnits: 0 }))!.lines, [NAME, UNTIL]);
  assert.equal(promotionStatus(use({ bonusMonths: 2, bonusReceiptUnits: 0 }))!.lines.at(-1), 'แถมฟรี 2 เดือน');
  assert.equal(promotionStatus(undefined), null);
  assert.equal(promotionStatus(null), null);
});

const lost = (reason: unknown, over: Record<string, unknown> = {}) => Object.assign(new Error('สิทธิ์โปรโมชั่นนี้เต็มแล้ว'), { status: 409, code: 'PROMOTION_UNAVAILABLE',
  details: { code: 'PROMOTION_UNAVAILABLE', message: 'สิทธิ์โปรโมชั่นนี้เต็มแล้ว', ...(reason === undefined ? {} : { reason }) }, ...over });

test('a promotion lost at quote or pay time: its reason in our words, a way to ask again, and the open payment when there is one', () => {
  for (const reason of Object.keys(REASONS) as BillingPromotionUnavailableReason[]) {
    const notice = promotionLostNotice(lost(reason))!;
    assert.equal(notice.text, promotionReasonText(reason), 'our sentence, never the API message');
    assert.equal(notice.title, 'โปรโมชั่นที่เลือกไว้ใช้ไม่ได้แล้ว');
    assert.equal(notice.canRecheck, reason !== 'IN_PROGRESS', reason);
    assert.doesNotMatch([notice.title, notice.text, notice.hint].join(' '), MACHINE, reason);
    assert.doesNotMatch([notice.title, notice.text, notice.hint].join(' '), /สิทธิ์โปรโมชั่นนี้เต็มแล้ว/, 'the API sentence is not shown');
  }
  assert.equal(promotionLostNotice(lost('IN_PROGRESS'))!.hint, 'เปิดรายการเดิมที่ค้างอยู่ด้านล่างเพื่อชำระต่อ ไม่ต้องเริ่มรายการใหม่');
  assert.equal(promotionLostNotice(lost('CAP_FULL'))!.hint, 'ถ้าซื้อต่อ จะไม่ได้เวลาและใบเสร็จแถมจากโปรโมชั่น กรุณาตรวจสอบรายการใหม่ก่อนชำระ');
  assert.equal(promotionLostNotice(lost('CHANGED'))!.hint, 'กรุณาตรวจสอบรายการใหม่ แล้วอ่านเวลา ใบเสร็จ และราคาอีกครั้งก่อนชำระ');
  // The code may sit on the error or one level down; a reason we do not know, or none, still gives a notice.
  assert.equal(promotionLostNotice({ details: { code: 'PROMOTION_UNAVAILABLE', reason: 'CAP_FULL' } })!.text, 'สิทธิ์โปรโมชั่นครบจำนวนแล้ว');
  assert.equal(promotionLostNotice(lost('NOT_A_REASON'))!.text, 'โปรโมชั่นนี้ใช้ไม่ได้ในตอนนี้');
  assert.equal(promotionLostNotice(lost(undefined))!.text, 'โปรโมชั่นนี้ใช้ไม่ได้ในตอนนี้');
  assert.equal(promotionLostNotice(lost(undefined))!.canRecheck, true);
  // Every other error is the page's business, not this notice's.
  assert.equal(promotionLostNotice(Object.assign(new Error('x'), { status: 409, code: 'BILLING_QUOTE_STALE' })), null);
  assert.equal(promotionLostNotice(Object.assign(new Error('x'), { status: 409, code: 'PROMOTION_UPGRADE_DEFERRED' })), null);
  assert.equal(promotionLostNotice(null), null);
  assert.equal(promotionLostNotice(undefined), null);
  assert.equal(promotionLostNotice('PROMOTION_UNAVAILABLE'), null);
});

test('Q5: an upgrade card says when instead of offering the upgrade, only while the date lies ahead', () => {
  const now = Date.parse('2026-10-09T00:00:00.000Z');
  const status = (over: Record<string, unknown> = {}) => ({ upgradeDeferredUntil: '2026-12-05T03:00:00.000Z', accessState: 'ACTIVE', tierKey: 'STARTER_249', interval: 'month', ...over }) as Parameters<typeof promotionUpgradeNote>[0];
  const note = 'อัปเกรดได้หลังวันที่ 5 ธันวาคม 2569 เพราะแพ็กเกจปัจจุบันยังมีเวลาโปรโมชั่นที่ใช้ไม่หมด';
  assert.equal(promotionUpgradeNote(status(), BASIC_MONTH, now), note);
  assert.equal(promotionUpgradeNote(status(), { offerKey: 'ENTERPRISE_1999', interval: 'month' }, now), note, 'any higher package');
  assert.equal(promotionUpgradeNote(status({ tierKey: 'BASIC_499' }), { offerKey: 'PRO_999', interval: 'month' }, now), note);
  // Not an immediate upgrade: the same package, a lower one, another cadence.
  assert.equal(promotionUpgradeNote(status(), STARTER_MONTH, now), null);
  assert.equal(promotionUpgradeNote(status({ tierKey: 'PRO_999' }), BASIC_MONTH, now), null);
  assert.equal(promotionUpgradeNote(status(), { offerKey: 'BASIC_499', interval: 'year' }, now), null);
  // Nothing held back: no date, a date gone by, a shop that is not running a package.
  assert.equal(promotionUpgradeNote(status({ upgradeDeferredUntil: undefined }), BASIC_MONTH, now), null);
  assert.equal(promotionUpgradeNote(status({ upgradeDeferredUntil: '2026-10-08T23:59:59.000Z' }), BASIC_MONTH, now), null);
  assert.equal(promotionUpgradeNote(status({ upgradeDeferredUntil: '2026-10-09T00:00:00.000Z' }), BASIC_MONTH, now), null, 'the day itself is over');
  assert.equal(promotionUpgradeNote(status({ accessState: 'EXPIRED' }), BASIC_MONTH, now), null);
  assert.equal(promotionUpgradeNote(status({ tierKey: null }), BASIC_MONTH, now), null);
  assert.doesNotMatch(note, MACHINE);
});

// The page is a client component behind effects, so — like BillingPage.qa.spec.ts — its wiring is pinned from source.
const page = readFileSync(new URL('./BillingPage.tsx', import.meta.url), 'utf8');
const logic = readFileSync(new URL('./billing-promotion.ts', import.meta.url), 'utf8');

test('the annual card keeps its per-month average on the paid price and the paid 12 months, whatever a promotion adds', () => {
  assert.match(page, /\{interval === 'year' && <p className="text-sm text-gray-600">เฉลี่ยเดือนละ \{money\(Math\.round\(offer\.priceSatang \/ 12\)\)\}<\/p>\}/);
  assert.doesNotMatch(page, /priceSatang\s*\/\s*(?:13|[\w.?]*[Mm]onths)/, 'never divided by the months a promotion adds');
  assert.doesNotMatch(logic, /\/\s*(?:12|13)\b|เฉลี่ย/, 'the promotion text carries no average of its own');
  // The card's own price and the row's own months are what the promotion line is built from.
  assert.match(logic, /eventDiscountBaht\(offer\.priceSatang\)\} บาท ได้ \$\{row\.totalMonths\} เดือน/);
});

test('the page sends the benefit through promotionQuoteFields, routes PROMOTION_UNAVAILABLE to its own notice, and keeps the plain buy button', () => {
  assert.match(page, /api\.quote\(offerKey, selectedInterval, billingEmail, selection, mode, dealId, purchaseIntent, fields\.eventDiscountChoice, fields\.eventDiscountTicketSerial, fields\.benefitChoice, fields\.promotionCampaignId\)/);
  assert.match(page, /const fields: QuoteFields = dealId \? \{\} : promotionQuoteFields\(/, 'a deal never carries a benefit');
  assert.match(page, /promotions: paid\?\.promotions/, 'decided from the rows the buyer saw, not the ones read a moment ago');
  assert.match(page, /const lost = promotionLostNotice\(e\);\s*if \(lost\) \{ setPromotionLost\(lost\); setQuote\(null\); setAccepted\(false\);/);
  assert.match(page, /else \{ setError\(errorText\(e\)\); setErrorCode\(apiErrorCode\(e\)\); \}/);
  assert.match(page, /promotionQuoteBenefit\(quote\)\);/, 'asking again keeps the benefit of the quote');
  // An unavailable promotion never touches the card's buy button: its disabled list gains only the upgrade note.
  assert.match(page, /disabled=\{!!packageChangeUnavailable \|\| !!upgradeNote \|\| modeUnavailable \|\| busy \|\| catalogUnavailable \|\| Date\.parse\(data\.catalog\.validUntil\) <= Date\.now\(\) \|\| offer\.availability !== 'AVAILABLE'\}/);
  assert.doesNotMatch(page, /promo\??\.available[^;\n]{0,80}disabled|disabled=\{[^}]*promo/);
  // The renewal being set up reuses the page's own "check again" control.
  assert.match(page, /\|\| promotionBlock\?\.checking\) && \(status\.paymentState !== 'NONE'/);
});

test('no figure of one campaign is written into the promotion logic', () => {
  assert.doesNotMatch(logic.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /\b(?:249|390|60)\b/);
});
