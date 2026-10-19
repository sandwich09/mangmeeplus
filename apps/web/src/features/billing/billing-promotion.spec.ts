import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import type { BillingBenefitChoice, BillingPromotionOfferView, BillingPromotionUnavailableReason, BillingPromotionUse, BillingRenewalSetupState } from '@watchdog-bms/contracts';
import { eventDiscountHelpText } from './billing-event-discount';
import { PROMOTION_NOT_PICKED, PROMOTION_ONCE, PROMOTION_ONE_PER_PURCHASE, promotionCard, promotionCardBenefit, promotionCardShowsPlainFacts, promotionChoiceCopy, promotionChoiceLabel,
  promotionHeadline, promotionInvoiceLine, promotionLostNotice, promotionOffered, promotionPageBenefit, promotionPick, promotionQuoteBenefit, promotionQuoteFields, promotionReasonText,
  promotionReceipts, promotionReview, promotionRow, promotionStatus, promotionSwitchLabel, promotionUpgradeNote, purchaseBlockQuiet, statusDeadlines } from './billing-promotion';
import { errorText } from './billing-error-text';

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
    'จ่าย 1 เดือน แถมฟรี 1 เดือน', 'ใบเสร็จ 60 ใบ (รวมแถม 30 ใบ) ได้ทันทีเมื่อจ่ายสำเร็จ', 'ใช้ได้ครั้งเดียวต่อร้าน', 'โปรโมชั่นสิ้นสุด 31 ต.ค. 2569 เวลา 23:59 น.'] });
  assert.deepEqual(promotionCard(yearRow(), { priceSatang: 249000 }).lines.slice(0, 2), ['จ่าย 12 เดือน แถมฟรี 1 เดือน', 'ใบเสร็จ 390 ใบ (รวมแถม 30 ใบ) ได้ทันทีเมื่อจ่ายสำเร็จ']);
  // Any other figures: nothing is remembered from the first campaign.
  const other = promotionCard(row({ displayName: 'ฉลองเปิดร้าน', totalMonths: 5, bonusMonths: 2, totalReceiptUnits: 125, bonusReceiptUnits: 25 }), { priceSatang: 19950 });
  assert.equal(other.headline, '199.50 บาท ได้ 5 เดือน');
  assert.deepEqual(other.lines.slice(0, 2), ['จ่าย 3 เดือน แถมฟรี 2 เดือน', 'ใบเสร็จ 125 ใบ (รวมแถม 25 ใบ) ได้ทันทีเมื่อจ่ายสำเร็จ']);
  assert.equal(other.name, 'ฉลองเปิดร้าน');
  assert.doesNotMatch(JSON.stringify(other), /\b(?:249|60|390)\b/);
  assert.equal(PROMOTION_ONCE, 'ใช้ได้ครั้งเดียวต่อร้าน');
});

test('the campaign end is told in Thai time with its clock, also across midnight', () => {
  const end = (endsAt: string) => promotionCard(row({ endsAt }), { priceSatang: 24900 }).lines[3];
  assert.equal(end('2026-10-31T16:59:59.000Z'), 'โปรโมชั่นสิ้นสุด 31 ต.ค. 2569 เวลา 23:59 น.');
  assert.equal(end('2026-10-31T17:00:00.000Z'), 'โปรโมชั่นสิ้นสุด 1 พ.ย. 2569 เวลา 00:00 น.', 'midnight in Bangkok is the next day, not 17:00');
  assert.equal(end('2026-11-01T01:05:00.000Z'), 'โปรโมชั่นสิ้นสุด 1 พ.ย. 2569 เวลา 08:05 น.');
});

test('every reason has its own plain Thai sentence, and the four owner-approved ones read exactly so', () => {
  const texts = (Object.keys(REASONS) as BillingPromotionUnavailableReason[]).map(reason => promotionReasonText(reason));
  for (const text of texts) { assert.ok(text.length > 5); assert.doesNotMatch(text, MACHINE); assert.doesNotMatch(text, /\n/); assert.match(text, /[ก-๛]/u); }
  assert.equal(new Set(texts).size, texts.length, 'no two reasons share a sentence');
  for (const reason of Object.keys(REASONS) as BillingPromotionUnavailableReason[]) assert.notEqual(promotionReasonText(reason), promotionReasonText(null), `${reason} has a sentence of its own, not the fallback`);
  assert.equal(promotionReasonText('ALREADY_USED'), 'ร้านนี้ใช้สิทธิ์โปรโมชั่นนี้แล้ว');
  assert.equal(promotionReasonText('CAP_FULL'), 'สิทธิ์โปรโมชั่นครบจำนวนแล้ว');
  assert.equal(promotionReasonText('IN_PROGRESS'), 'มีรายการจ่ายที่ใช้สิทธิ์นี้ค้างอยู่ เปิดรายการเดิมเพื่อจ่ายต่อ');
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
    notes: ['ใช้ได้ครั้งละ 1 ส่วนลด ลดเฉพาะการจ่ายครั้งนี้ งานเดียวกันใช้ได้ร้านละครั้ง ส่วนลดอื่นเก็บไว้ใช้ครั้งถัดไปได้'] });
  assert.deepEqual(promotionChoiceCopy({ promotion: false, ticket: true, firstBillOnly: true }).notes,
    ['ใช้ได้ครั้งละ 1 ส่วนลด ลดเฉพาะบิลแรก รอบถัดไปคิดราคาเต็ม งานเดียวกันใช้ได้ร้านละครั้ง ส่วนลดอื่นเก็บไว้ใช้ครั้งถัดไปได้']);
  assert.deepEqual(promotionChoiceCopy({ promotion: true, ticket: false, firstBillOnly: false }),
    { section: 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้', legend: 'เลือกสิ่งที่จะใช้ในการซื้อครั้งนี้', normal: 'ซื้อแบบปกติ', notes: [PROMOTION_ONE_PER_PURCHASE] });
  assert.deepEqual(promotionChoiceCopy({ promotion: true, ticket: true, firstBillOnly: true }).notes, [PROMOTION_ONE_PER_PURCHASE, eventDiscountHelpText(true)]);
  const offers = [{ ...STARTER_MONTH, label: 'สตาร์ทเตอร์', priceSatang: 24900 }, { offerKey: 'STARTER_249', interval: 'year', label: 'สตาร์ทเตอร์', priceSatang: 249000 }] as Parameters<typeof promotionChoiceLabel>[1];
  assert.deepEqual(promotionChoiceLabel([row()], offers, 'month'), { title: 'ใช้โปรโมชั่น ซื้อ 1 แถม 1', lines: ['สตาร์ทเตอร์ รายเดือน 249 บาท ได้ 2 เดือน'] });
  assert.deepEqual(promotionChoiceLabel([yearRow()], offers, 'year'), { title: 'ใช้โปรโมชั่น ซื้อ 1 แถม 1', lines: ['สตาร์ทเตอร์ รายปี 2,490 บาท ได้ 13 เดือน'] });
  assert.equal(promotionChoiceLabel([yearRow()], offers, 'month'), null, 'nothing on offer for this cadence');
  assert.equal(promotionChoiceLabel([row({ available: false, reason: 'CAP_FULL' })], offers, 'month'), null, 'a promotion that cannot be used is not a choice');
  assert.equal(PROMOTION_ONE_PER_PURCHASE, 'ใช้ได้ครั้งละ 1 อย่างต่อการซื้อ โปรโมชั่นใช้ได้เฉพาะแพ็กเกจที่แสดงโปรโมชั่น แพ็กเกจอื่นซื้อตามที่แสดงไว้ที่แพ็กเกจนั้น');
  assert.equal(PROMOTION_NOT_PICKED, 'ครั้งนี้ไม่ได้เลือกใช้โปรโมชั่นนี้');
});

const quote = (over: Record<string, unknown> = {}, promotion: Record<string, unknown> = {}) => ({ offer: { interval: 'month' }, purchaseMode: 'CARD_AUTO', totalSatang: 24900,
  promotion: { campaignId: CAMPAIGN, displayName: 'ซื้อ 1 แถม 1', bonusMonths: 1, bonusReceiptUnits: 30, totalReceiptUnits: 60, paidStart: '2026-10-05T03:00:00.000Z',
    paidEnd: '2026-11-05T03:00:00.000Z', benefitEnd: '2026-12-05T03:00:00.000Z', expectedNextChargeAt: '2026-12-05T03:00:00.000Z', ...promotion }, ...over }) as unknown as Parameters<typeof promotionReview>[0];

test('the quote review: paid period, free time, end, receipts, next round — from the quote, as estimates', () => {
  const review = promotionReview(quote(), money)!;
  assert.equal(review.title, 'โปรโมชั่น ซื้อ 1 แถม 1');
  assert.deepEqual(review.rows, [
    { label: 'ช่วงที่จ่าย', value: '5 ต.ค. 2569 – 5 พ.ย. 2569' },
    { label: 'ช่วงแถมฟรี', value: '5 พ.ย. 2569 – 5 ธ.ค. 2569' },
    { label: 'ใช้ได้ถึง', value: '5 ธ.ค. 2569' },
    { label: 'อ่านใบเสร็จได้', value: '30 + แถม 30 = 60 ใบ' }]);
  assert.equal(review.next, 'รอบถัดไปเรียกเก็บวันที่ 5 ธ.ค. 2569 ราคาปกติ 249 บาท (ตัดบัตรอัตโนมัติ)');
  assert.equal(review.estimate, 'วันที่ทั้งหมดเป็นการประมาณ ระบบจะยืนยันวันจริงเมื่อจ่ายสำเร็จ');
  assert.equal(review.summary, 'เมื่อจ่ายสำเร็จ ใช้งานได้ 2 เดือน (จ่าย 1 เดือน แถมฟรี 1 เดือน)');
  assert.equal(review.benefitEnd, '2026-12-05T03:00:00.000Z');
  assert.equal(review.totalReceiptUnits, 60);
  // A renewing mode by bill; a one-time mode has no next round to tell.
  assert.match(promotionReview(quote({ purchaseMode: 'PROMPTPAY_RENEW' }), money)!.next!, /5 ธ.ค. 2569 ราคาปกติ 249 บาท \(ออกบิล QR ให้สแกน\)$/);
  assert.equal(promotionReview(quote({ purchaseMode: 'CARD_ONCE' }, { expectedNextChargeAt: null }), money)!.next, null);
  assert.equal(promotionReview(quote({ purchaseMode: 'PROMPTPAY_ONCE' }, { expectedNextChargeAt: null }), money)!.next, null);
  // A year, and other figures: the receipts add up from the quote's own numbers.
  const year = promotionReview(quote({ offer: { interval: 'year' }, totalSatang: 249000 }, { bonusReceiptUnits: 45, totalReceiptUnits: 405 }), money)!;
  assert.equal(year.rows[3]!.value, '360 + แถม 45 = 405 ใบ');
  assert.equal(year.summary, 'เมื่อจ่ายสำเร็จ ใช้งานได้ 13 เดือน (จ่าย 12 เดือน แถมฟรี 1 เดือน)');
  assert.match(year.next!, /ราคาปกติ 2490 บาท/);
  // The dates are Thai dates: 01:30 in Bangkok is still the previous day in UTC.
  assert.equal(promotionReview(quote({}, { paidStart: '2026-10-04T18:30:00.000Z' }), money)!.rows[0]!.value, '5 ต.ค. 2569 – 5 พ.ย. 2569');
  assert.equal(promotionReview(quote({ promotion: undefined }), money), null);
  assert.equal(promotionReview(null, money), null);
  assert.doesNotMatch(JSON.stringify(review), MACHINE);
});

const use = (over: Partial<BillingPromotionUse> = {}): BillingPromotionUse => ({ campaignId: CAMPAIGN, displayName: 'ซื้อ 1 แถม 1', state: 'CONSUMED', paidEnd: '2026-11-05T03:00:00.000Z',
  benefitEnd: '2026-12-05T03:00:00.000Z', bonusMonths: 1, bonusReceiptUnits: 30, renewalSetupState: 'NOT_REQUIRED', expectedNextChargeAt: null, ...over });

test('after payment: one block per renewal-setup state, and never an invitation to pay again', () => {
  const NAME = 'โปรโมชั่น ซื้อ 1 แถม 1', UNTIL = 'ใช้ได้ถึง 5 ธ.ค. 2569', BONUS = 'แถมฟรี 1 เดือน · ใบเสร็จเพิ่ม 30 ใบ';
  const EXPECT: Record<BillingRenewalSetupState, { lines: string[]; checking: boolean }> = {
    NOT_REQUIRED: { lines: [NAME, UNTIL, BONUS], checking: false },
    PENDING: { lines: [NAME, 'จ่ายแล้ว ใช้ได้ถึง 5 ธ.ค. 2569 กำลังตั้งค่ารอบถัดไป ไม่ต้องจ่ายซ้ำ', BONUS], checking: true },
    REVIEW: { lines: [NAME, UNTIL, 'จ่ายแล้ว การตั้งรอบถัดไปยังไม่เสร็จ ไม่ต้องจ่ายซ้ำ', BONUS], checking: false },
    READY: { lines: [NAME, UNTIL, 'ตั้งต่ออายุแล้ว รอบถัดไปเรียกเก็บวันที่ 5 ธ.ค. 2569', BONUS], checking: false },
    CANCELLED: { lines: [NAME, UNTIL, BONUS], checking: false },
  };
  for (const state of Object.keys(RENEWAL_STATES) as BillingRenewalSetupState[]) {
    const block = promotionStatus(use({ renewalSetupState: state, expectedNextChargeAt: state === 'READY' ? '2026-12-05T03:00:00.000Z' : null }))!;
    assert.equal(block.title, 'ใช้สิทธิ์โปรโมชั่นแล้ว', state);
    assert.deepEqual({ lines: block.lines, checking: block.checking }, EXPECT[state], state);
    assert.doesNotMatch(block.lines.join(' '), /จ่าย(?:ใหม่|อีก)|ซื้อ(?:ใหม่|อีก|เพิ่ม)/, `${state}: no invitation to pay again`);
    assert.doesNotMatch(JSON.stringify(block), MACHINE, state);
  }
  // Paid but not yet applied: no date yet, and the words still do not say anything untrue.
  assert.deepEqual(promotionStatus(use({ benefitEnd: null, renewalSetupState: 'PENDING' }))!.lines.slice(0, 2), [NAME, 'จ่ายแล้ว กำลังตั้งค่ารอบถัดไป ไม่ต้องจ่ายซ้ำ']);
  assert.deepEqual(promotionStatus(use({ benefitEnd: null }))!.lines.slice(0, 2), [NAME, 'กำลังเปิดสิทธิ์ให้ ไม่ต้องจ่ายซ้ำ']);
  assert.deepEqual(promotionStatus(use({ renewalSetupState: 'READY', expectedNextChargeAt: null }))!.lines.at(-2), 'ตั้งต่ออายุแล้ว');
  // A right reserved for a Checkout still open is not used yet.
  const reserved = promotionStatus(use({ state: 'RESERVED', benefitEnd: null, paidEnd: null }))!;
  assert.equal(reserved.title, 'จองสิทธิ์โปรโมชั่นไว้ให้รายการจ่ายนี้แล้ว');
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
  assert.equal(promotionLostNotice(lost('IN_PROGRESS'))!.hint, 'เปิดรายการเดิมที่ค้างอยู่ด้านล่างเพื่อจ่ายต่อ ไม่ต้องเริ่มรายการใหม่');
  assert.equal(promotionLostNotice(lost('CAP_FULL'))!.hint, 'ถ้าซื้อต่อ จะไม่ได้เวลาและใบเสร็จแถมจากโปรโมชั่น กรุณาตรวจสอบรายการใหม่ก่อนจ่าย');
  assert.equal(promotionLostNotice(lost('CHANGED'))!.hint, 'กรุณาตรวจสอบรายการใหม่ แล้วอ่านเวลา ใบเสร็จ และราคาอีกครั้งก่อนจ่าย');
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
  const note = 'อัปเกรดได้หลังวันที่ 5 ธ.ค. 2569 เพราะแพ็กเกจปัจจุบันยังมีเวลาโปรโมชั่นที่ใช้ไม่หมด';
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

// UAT 2026-10-10: right after a successful purchase the package page showed an amber alert with a reference for the team ("เลขอ้างอิงสำหรับแจ้งทีมงาน") and a "ตรวจสถานะล่าสุด" button, because the API
// reports `purchaseBlockCode` for two plain facts of a running shop: a card shop whose promotion still has time (`BILLING_REPEAT_NOT_READY`, with `upgradeDeferredUntil`) and a QR-bill shop
// (`BILLING_PLAN_CHANGE_REQUIRED`). The table is the specification: surface = the package card (a quiet line) or the alert; state = what the status says.
test('Q5 status: a running, paid shop that cannot buy another package gets one quiet line, never the alert; every other state keeps the alert', () => {
  const now = Date.parse('2026-10-09T05:00:00.000Z'), UNTIL = '2026-12-05T03:00:00.000Z';
  const running = { accessState: 'ACTIVE', paymentState: 'PAID', applyState: 'APPLIED', attemptId: null, packageChangesEnabled: true, upgradeDeferredUntil: UNTIL } as const;
  const quiet = (over: Record<string, unknown>) => purchaseBlockQuiet({ ...running, ...over } as Parameters<typeof purchaseBlockQuiet>[0], now);
  const DATE_LINE = 'ซื้อหรือเปลี่ยนแพ็กเกจได้หลังวันที่ 5 ธ.ค. 2569 เพราะแพ็กเกจปัจจุบันยังมีเวลาโปรโมชั่นที่ใช้ไม่หมด';
  const REPEAT = errorText({ code: 'BILLING_REPEAT_NOT_READY' }), QR = errorText({ code: 'BILLING_PLAN_CHANGE_REQUIRED' }).replaceAll('แท็บการต่ออายุและจ่ายเงิน', 'การต่ออายุด้านล่าง');
  // the two codes, in the state of the live API after a successful promotion purchase
  assert.equal(quiet({ purchaseBlockCode: 'BILLING_REPEAT_NOT_READY' }), DATE_LINE, 'a card shop with promotion time left: the date, in Bangkok');
  assert.equal(quiet({ purchaseBlockCode: 'BILLING_PLAN_CHANGE_REQUIRED' }), QR, 'a QR-bill shop: the sentence it always had');
  assert.equal(quiet({ purchaseBlockCode: 'BILLING_PLAN_CHANGE_REQUIRED', upgradeDeferredUntil: undefined }), QR, 'a QR-bill shop with no promotion');
  assert.equal(quiet({ purchaseBlockCode: 'BILLING_PLAN_CHANGE_REQUIRED' }), QR, 'the QR sentence is not reworded by the promotion date');
  // the date is told only while it lies ahead and the platform gate is open; otherwise the code's own sentence, still quiet
  assert.equal(quiet({ purchaseBlockCode: 'BILLING_REPEAT_NOT_READY', upgradeDeferredUntil: undefined }), REPEAT, 'no date');
  assert.equal(quiet({ purchaseBlockCode: 'BILLING_REPEAT_NOT_READY', upgradeDeferredUntil: '2026-10-09T05:00:00.000Z' }), REPEAT, 'the instant itself: no date left to wait for');
  assert.equal(quiet({ purchaseBlockCode: 'BILLING_REPEAT_NOT_READY', upgradeDeferredUntil: '2026-10-01T00:00:00.000Z' }), REPEAT, 'a date gone by');
  assert.equal(quiet({ purchaseBlockCode: 'BILLING_REPEAT_NOT_READY', packageChangesEnabled: false }), REPEAT, 'the gate for package changes is closed: the date would promise what it does not');
  assert.equal(quiet({ purchaseBlockCode: 'BILLING_REPEAT_NOT_READY', packageChangesEnabled: undefined }), DATE_LINE, 'an older API that does not say: not closed');
  // Bangkok date, whatever the machine: 01:30 on the 6th in Bangkok is still the 5th in UTC
  assert.match(quiet({ purchaseBlockCode: 'BILLING_REPEAT_NOT_READY', upgradeDeferredUntil: '2026-12-05T18:30:00.000Z' })!, /หลังวันที่ 6 ธ.ค. 2569 /);
  // the same date as the card's own note says for an upgrade
  assert.match(promotionUpgradeNote({ upgradeDeferredUntil: UNTIL, accessState: 'ACTIVE', tierKey: 'STARTER_249', interval: 'month' }, BASIC_MONTH, now)!, /หลังวันที่ 5 ธ.ค. 2569 /);
  // every state that is not "active, paid, applied, no payment in flight" keeps the alert, for both codes
  const notQuiet: Record<string, Record<string, unknown>> = {
    'locked shop': { accessState: 'EXPIRED' }, 'held by an admin': { accessState: 'HELD' },
    'payment pending': { paymentState: 'PENDING' }, 'payment failed (a past-due charge)': { paymentState: 'FAILED' }, 'payment unknown': { paymentState: 'UNKNOWN' }, 'payment needs action': { paymentState: 'ACTION_REQUIRED' }, 'no payment': { paymentState: 'NONE' },
    'not applied yet': { applyState: 'PENDING' }, 'held for the team': { applyState: 'HELD' }, 'apply failed': { applyState: 'FAILED' }, 'nothing applied': { applyState: 'NONE' },
    'a payment in flight': { attemptId: '11111111-1111-4111-8111-111111111111' },
  };
  for (const code of ['BILLING_REPEAT_NOT_READY', 'BILLING_PLAN_CHANGE_REQUIRED']) for (const [name, over] of Object.entries(notQuiet)) assert.equal(quiet({ purchaseBlockCode: code, ...over }), null, `${code} / ${name}`);
  // every other code keeps the alert, whatever the state
  for (const code of ['BILLING_CHECKOUT_PENDING', 'BILLING_EMAIL_UPDATE_PENDING', 'BILLING_REFUND_PENDING', 'BILLING_COLLECTION_PENDING', 'BILLING_PLAN_CHANGE_PENDING', 'BILLING_SALES_CLOSED', 'BILLING_COMPANY_HELD',
    'BILLING_MODE_NOT_READY', 'BILLING_SOURCE_REVIEW_REQUIRED', 'BILLING_PACKAGE_STATE_INVALID', 'SOMETHING_NEW', null, undefined, ''])
    assert.equal(quiet({ purchaseBlockCode: code }), null, String(code));
  // the line is quiet: no reference for the team, no check button, no machine word; every sentence is Thai
  for (const line of [DATE_LINE, REPEAT, QR]) { assert.doesNotMatch(line, /เลขอ้างอิง|ตรวจสถานะล่าสุด|ลองใหม่|undefined|null|NaN/); assert.doesNotMatch(line, MACHINE); assert.match(line, /[ก-๛]/u); }
});

test('Q5 status wiring: the alert gives way to the line only through the pure decision, and the line sits in the package card, a note, with no support reference and no check button', () => {
  const alert = page.slice(page.indexOf('{purchaseBlockText && !quietBlock'), page.indexOf('{status.mode === \'TEST\''));
  assert.match(page, /const quietBlock = status \? purchaseBlockQuiet\(status\) : null;/);
  assert.match(page, /\{purchaseBlockText && !quietBlock && !applyReview && !heldShop && !\(pending\?\.kind === 'FAILED' && purchaseSalesClosed\) && !\(status\.purchaseBlockCode === 'BILLING_CHECKOUT_PENDING' && pendingShown && pending\?\.inFlight\) && <div role="alert"/);
  assert.match(alert, /เลขอ้างอิงสำหรับแจ้งทีมงาน/, 'the alert still carries its reference and its button for every other case');
  assert.match(alert, />ตรวจสถานะล่าสุด<\/button>/);
  const card = page.slice(page.indexOf('<section aria-label="สถานะแพ็กเกจ"'), page.indexOf("<div hidden={section !== 'payment'}"));
  const line = /\{!returnFocused && quietBlock && <div><p role="note" className="break-words text-sm leading-7 text-gray-600">\{quietBlock\}<\/p>\{quietBlock\.includes\('ติดต่อทีมงาน'\) && contactLinks\}<\/div>\}/.exec(card);
  assert.ok(line, 'the quiet line is a note inside the package card');
  assert.equal((page.match(/\{!returnFocused && quietBlock && </g) ?? []).length, 1, 'drawn once');
  assert.doesNotMatch(card.slice(line!.index, line!.index + 200), /เลขอ้างอิง|ตรวจสถานะล่าสุด|role="alert"/);
  // it comes after the buttons of the card and before the collapsed reference, which stays the very last thing
  assert.ok(card.indexOf("{!returnFocused && status.allowedActions.includes('new_sales') && !pending?.inFlight && !status.renewalInvoiceUrl && pending?.kind !== 'FAILED' && <ActionGroup") < line!.index && line!.index < card.indexOf('{supportReference && !confirmed && <details'));
});

// The page is a client component behind effects, so — like BillingPage.qa.spec.ts — its wiring is pinned from source.
const page = readFileSync(new URL('./BillingPage.tsx', import.meta.url), 'utf8');
const logic = readFileSync(new URL('./billing-promotion.ts', import.meta.url), 'utf8');

// UAT 2026-10-10: "สิ่งที่ไม่ได้เลือกจะไม่ถูกใช้" was false. With the promotion radio on by default, a package with no promotion still shows its held discount and is quoted with it (plan R19).
// The sentence now says only what holds in every cell of: pick x held discount x the card (with the promotion / without it). The table below runs the page's own decisions for each cell and
// checks the three claims against them: a promotion is used only on a card that shows it; any other card uses exactly what it shows (its discount line, or nothing); and the quote that goes out
// is the one the card shows — so no cell makes the sentence untrue, and the quote that is sent is the quote that was already sent (the request table above pins those fields).
test('the note under the choice is true in every cell: pick x held discount x card with / without the promotion', () => {
  const rows = [row()], offered = (ticket: boolean) => promotionOffered(rows, 'month', ticket);
  const cards = { 'a card with the promotion': STARTER_MONTH, 'a card without it': BASIC_MONTH } as const;
  const held = { none: HELD.none, 'lowers this card': HELD.onCard, 'does not lower this card': HELD.offCard } as const;
  let cells = 0;
  for (const [cardName, card] of Object.entries(cards)) for (const [heldName, heldCase] of Object.entries(held)) for (const pick of PICKS) {
    const where = `${cardName} / held discount ${heldName} / ${pick}`, hasPromotion = !!promotionRow(rows, card)?.available;
    const shown = promotionCardBenefit(pick, offered(heldCase.ticket), { PROMOTION: hasPromotion, EVENT_DISCOUNT: heldCase.ticket && heldCase.ticketOnCard });
    const sent = promotionQuoteFields({ pick, promotions: rows, card, ...heldCase });
    const promotionUsed = sent.benefitChoice === 'PROMOTION', discountUsed = (sent.eventDiscountChoice === 'USE') && heldCase.ticketOnCard;
    cells++;
    // a promotion is used only on the packages that show it
    if (promotionUsed) assert.equal(hasPromotion, true, where);
    if (shown === 'PROMOTION') assert.equal(hasPromotion, true, where);
    // any other package is bought as its own card shows: the discount line is on the card exactly when the discount is used, and nothing else is used
    assert.equal(promotionUsed, shown === 'PROMOTION', `${where}: the promotion is used exactly when the card shows it as the benefit`);
    assert.equal(discountUsed, shown === 'EVENT_DISCOUNT', `${where}: the discount is used exactly when the card shows its line`);
    if (!hasPromotion) assert.notEqual(shown, 'PROMOTION', where);
  }
  assert.equal(cells, 2 * 3 * 4, 'every cell was checked');
  // The three-way box keeps its promotion rule; discount-only instructions fit in one note.
  const withPromotion = [promotionChoiceCopy({ promotion: true, ticket: false, firstBillOnly: false }), promotionChoiceCopy({ promotion: true, ticket: true, firstBillOnly: true })];
  for (const copy of withPromotion) {
    assert.equal(copy.notes[0], PROMOTION_ONE_PER_PURCHASE);
    assert.doesNotMatch(copy.notes.join(' '), /ไม่ได้เลือกจะไม่ถูกใช้/);
  }
  for (const copy of [promotionChoiceCopy({ promotion: false, ticket: true, firstBillOnly: false }), promotionChoiceCopy({ promotion: false, ticket: true, firstBillOnly: true })]) {
    assert.doesNotMatch(copy.notes.join(' '), /แพ็กเกจที่แสดงโปรโมชั่น/);
    assert.equal(copy.notes.length, 1, 'the discount-only chooser explains the rules once');
    assert.match(copy.notes[0], /^ใช้ได้ครั้งละ 1 ส่วนลด .*งานเดียวกันใช้ได้ร้านละครั้ง ส่วนลดอื่นเก็บไว้ใช้ครั้งถัดไปได้$/);
  }
  assert.doesNotMatch(PROMOTION_ONE_PER_PURCHASE, MACHINE);
  // the box with a promotion is drawn only while one is on offer on this cadence, so "the packages that show it" is never an empty set
  assert.match(page, /\{\(promotionChoice \|\| ticketView\) && <section aria-label=\{choiceCopy\.section\}/);
  assert.equal(promotionChoiceLabel([row({ available: false, reason: 'CAP_FULL' })], [], 'month'), null);
  assert.equal(promotionOffered([row({ available: false, reason: 'ALREADY_USED' })], 'month', true).PROMOTION, false, 'a promotion that cannot be used falls back to the discount-only box');
});

test('PAY-1 annual cards show the actual annual price and promise two free months only for ten-month prices', () => {
  assert.match(page, /annualOffers\.every\(annual => data\?\.catalog\.offers\.some\(monthly => monthly\.offerKey === annual\.offerKey && monthly\.interval === 'month' && annual\.priceSatang === monthly\.priceSatang \* 10\)\)/);
  assert.doesNotMatch(page, /เฉลี่ยเดือนละ|ใช้งาน 12 เดือน/);
  assert.doesNotMatch(logic, /\/\s*(?:12|13)\b|เฉลี่ย/);
  assert.match(logic, /eventDiscountBaht\(offer\.priceSatang\)\} บาท ได้ \$\{row\.totalMonths\} เดือน/);
});

test('PAY-1 compact cards keep promotion terms once and monthly capacity distinct from the grant', () => {
  assert.equal(promotionCardShowsPlainFacts('PROMOTION'), false);
  for (const benefit of ['NORMAL', 'EVENT_DISCOUNT'] as const) assert.equal(promotionCardShowsPlainFacts(benefit), true, benefit);
  assert.match(page, /\$\{cardBenefit === 'PROMOTION' \? 'border-brand-300 bg-brand-50'/);
  assert.match(page, /promoCard\.lines\.map/);
  assert.match(page, /offer\.monthlySlipLimit\.toLocaleString\('th-TH'\)\} ใบต่อเดือน/);
  assert.doesNotMatch(page, /offer\.receiptAllowance\.toLocaleString\('th-TH'\)\} ใบ ได้ทันที/);
  const year = promotionCard(yearRow(), { priceSatang: 249000 });
  assert.deepEqual([year.headline, ...year.lines.slice(0, 2)], ['2,490 บาท ได้ 13 เดือน', 'จ่าย 12 เดือน แถมฟรี 1 เดือน', 'ใบเสร็จ 390 ใบ (รวมแถม 30 ใบ) ได้ทันทีเมื่อจ่ายสำเร็จ']);
});

test('the quote review counts the bonus once: the projected totals and the package row include it, and without a promotion nothing moves', () => {
  // API figures: allowance 30, 12 carried from the trial, 5 left from before. The API adds none of the bonus.
  const base = { offer: { receiptAllowance: 30 }, purchase: { projectedRemainingReceipts: 47, trialCarryover: { receiptUnits: 12 } } };
  assert.deepEqual(promotionReceipts({ ...base, promotion: { bonusReceiptUnits: 30 } } as never), { bonus: 30, packageUnits: 60, projected: 77 });
  assert.deepEqual(promotionReceipts(base as never), { bonus: 0, packageUnits: 30, projected: 47 });
  assert.deepEqual(promotionReceipts({ offer: { receiptAllowance: 30 }, promotion: { bonusReceiptUnits: 30 } } as never), { bonus: 30, packageUnits: 60, projected: 30 }, 'a quote without a purchase block');
  // The list on the screen adds up in both cases: package row + carryover + other quota (the API's own difference, never moved) = the total.
  for (const promotion of [undefined, { bonusReceiptUnits: 30 }]) {
    const quote = { ...base, promotion } as never, shown = promotionReceipts(quote), other = base.purchase.projectedRemainingReceipts - base.offer.receiptAllowance - base.purchase.trialCarryover.receiptUnits;
    assert.equal(shown.packageUnits + base.purchase.trialCarryover.receiptUnits + other, shown.projected, `promotion ${promotion ? 'on' : 'off'}`);
  }
  // The two sentences and the list read their figures from it; the raw projected figure is left where no promotion can exist (upgrades).
  assert.match(page, /หลังซื้อคงเหลือประมาณ \{promotionReceipts\(quote\)\.projected\.toLocaleString\('th-TH'\)\} ใบ รวมจำนวนใบเสร็จเดิมที่ยังไม่หมดอายุ/);
  assert.match(page, /อ่านใบเสร็จได้ประมาณ \{promotionReceipts\(quote\)\.projected\.toLocaleString\('th-TH'\)\} ใบ \(\{promotionReceipts\(quote\)\.packageUnits\.toLocaleString\('th-TH'\)\} ใบของแพ็กเกจ/);
  assert.match(page, /promoReview && ` รวมแถม \$\{promotionReceipts\(quote\)\.bonus\.toLocaleString\('th-TH'\)\} ใบ`/);
  assert.match(page, /ใบที่เหลือจากช่วงทดลอง\{quote\.purchase\.projectedRemainingReceipts > quote\.offer\.receiptAllowance \+ quote\.purchase\.trialCarryover\.receiptUnits/);
  assert.doesNotMatch(page, /หลังซื้อคงเหลือประมาณ \{quote\.purchase\.projectedRemainingReceipts/);
  assert.doesNotMatch(page, /<dt>จำนวนใบเสร็จแพ็กเกจ<\/dt>/);
  assert.doesNotMatch(page, /<dd>\{quote\.purchase\.projectedRemainingReceipts\.toLocaleString/);
});

test('a right already opened is not told as "in use" once the package has ended; a right still waiting is, whatever the access', () => {
  const NAME = 'โปรโมชั่น ซื้อ 1 แถม 1';
  assert.equal(promotionStatus(use(), false), null);
  assert.equal(promotionStatus(use({ renewalSetupState: 'READY', expectedNextChargeAt: '2026-12-05T03:00:00.000Z' }), false), null);
  assert.equal(promotionStatus(use({ benefitEnd: '2026-10-01T03:00:00.000Z' }), false), null, 'a package that lapsed');
  assert.equal(promotionStatus(use(), true)!.title, 'ใช้สิทธิ์โปรโมชั่นแล้ว');
  assert.equal(promotionStatus(use())!.title, 'ใช้สิทธิ์โปรโมชั่นแล้ว', 'running is the default');
  // Reserved for an open Checkout, or paid and being opened (no end date yet): the purchase in front of the buyer, told on a locked shop too.
  assert.equal(promotionStatus(use({ state: 'RESERVED', benefitEnd: null, paidEnd: null }), false)!.title, 'จองสิทธิ์โปรโมชั่นไว้ให้รายการจ่ายนี้แล้ว');
  assert.deepEqual(promotionStatus(use({ benefitEnd: null }), false)!.lines.slice(0, 2), [NAME, 'กำลังเปิดสิทธิ์ให้ ไม่ต้องจ่ายซ้ำ']);
  assert.equal(promotionStatus(use({ benefitEnd: null, renewalSetupState: 'PENDING' }), false)!.checking, true);
  // The page passes whether access runs — on the return page also once the attempt itself is applied — and nothing else.
  assert.match(page, /const promotionUse = \(returning \? returnAttempt\?\.promotion : undefined\) \?\? status\?\.promotion;\s*const promotionBlock = promotionStatus\(promotionUse, status\?\.accessState === 'ACTIVE' \|\| \(returning && returnComplete\)\);/);
});

test('the history row of a promotion purchase says the free time and the bonus receipts, and leaves the invoice\'s own period and amount as they are', () => {
  const promotion = { displayName: 'ซื้อ 1 แถม 1', paidEnd: '2026-11-05T03:00:00.000Z', benefitEnd: '2026-12-05T03:00:00.000Z', bonusReceiptUnits: 30 };
  assert.equal(promotionInvoiceLine(promotion), 'โปรโมชั่น ซื้อ 1 แถม 1 · แถมฟรี 5 พ.ย. 2569 – 5 ธ.ค. 2569 · ใบเสร็จเพิ่ม 30 ใบ');
  assert.equal(promotionInvoiceLine({ ...promotion, bonusReceiptUnits: 0 }), 'โปรโมชั่น ซื้อ 1 แถม 1 · แถมฟรี 5 พ.ย. 2569 – 5 ธ.ค. 2569');
  assert.equal(promotionInvoiceLine({ ...promotion, paidEnd: '2026-11-04T18:30:00.000Z' }).includes('แถมฟรี 5 พ.ย. 2569 –'), true, 'Thai dates');
  assert.doesNotMatch(promotionInvoiceLine(promotion), MACHINE);
  assert.equal((page.match(/promotionInvoiceLine\(invoice\.promotion\)/g) ?? []).length, 2, 'table and phone cards retain the same promotion facts');
  assert.match(page, /money\(invoice\.amountSatang\)/);
  assert.match(page, /date\(invoice\.paidAt \?\? invoice\.createdAt\)/);
  assert.doesNotMatch(page, /invoice\.amountSatang\s*[+*-]|invoice\.periodEnd\s*=/);
});

test('the page re-reads its status when a promotion on offer ends by the clock, as it does at a term deadline', () => {
  const now = Date.parse('2026-10-09T00:00:00.000Z'), at = (days: number) => new Date(now + days * 86_400_000).toISOString();
  const status = (over: Record<string, unknown> = {}) => ({ paidThrough: at(20), termEndsAt: at(20), graceEndsAt: null, promotions: [row({ endsAt: at(3) })], ...over }) as Parameters<typeof statusDeadlines>[0];
  assert.deepEqual(statusDeadlines(status(), now).sort(), [now + 3 * 86_400_000, now + 20 * 86_400_000, now + 20 * 86_400_000].sort());
  assert.equal(Math.min(...statusDeadlines(status(), now)), now + 3 * 86_400_000, 'the nearest is the promotion\'s end');
  // Several rows: each end is a deadline; one that ended, or that offers nothing now, is not.
  const rows = [row({ endsAt: at(5) }), yearRow({ endsAt: at(2) }), row({ campaignId: 'old', endsAt: at(-1) }), row({ campaignId: 'full', endsAt: at(1), available: false, reason: 'CAP_FULL' })];
  assert.equal(Math.min(...statusDeadlines(status({ promotions: rows }), now)), now + 2 * 86_400_000);
  assert.equal(statusDeadlines(status({ promotions: rows }), now).length, 2 + 2);
  // Nothing on offer, nothing from before promotions: exactly the three term instants that are ahead.
  assert.equal(statusDeadlines(status({ promotions: undefined }), now).length, 2);
  assert.deepEqual(statusDeadlines(status({ paidThrough: null, termEndsAt: null, promotions: [] }), now), []);
  assert.deepEqual(statusDeadlines(status({ paidThrough: at(-2), termEndsAt: at(-2), promotions: [row({ endsAt: at(-1) })] }), now), []);
  assert.match(page, /const deadlines = statusDeadlines\(status\);/);
  assert.doesNotMatch(page, /\[status\.paidThrough, status\.termEndsAt, status\.graceEndsAt\]\.filter/);
});

test('the page sends the benefit through promotionQuoteFields, routes PROMOTION_UNAVAILABLE to its own notice, and keeps the plain buy button', () => {
  assert.match(page, /api\.quote\(offerKey, selectedInterval, billingEmail, selection, mode, dealId, purchaseIntent, fields\.eventDiscountChoice, fields\.eventDiscountTicketSerial, fields\.benefitChoice, fields\.promotionCampaignId\)/);
  assert.match(page, /const fields: QuoteFields = dealId \? \{\} : promotionQuoteFields\(/, 'a deal never carries a benefit');
  assert.match(page, /promotions: paid\?\.promotions/, 'decided from the rows the buyer saw, not the ones read a moment ago');
  assert.match(page, /const lost = promotionLostNotice\(e\);\s*if \(lost\) \{ setPromotionLost\(lost\); setQuote\(null\); setBuyingStep\(0\); setAccepted\(false\);/);
  assert.match(page, /else \{\s*setError\(errorText\(e\)\); setErrorCode\(apiErrorCode\(e\)\);/);
  assert.match(page, /promotionQuoteBenefit\(quote\)\);/, 'asking again keeps the benefit of the quote');
  // An unavailable promotion never touches the card's buy button: its disabled list gains only the upgrade note.
  assert.match(page, /disabled=\{!!packageChangeUnavailable \|\| !!upgradeNote \|\| offer\.availability !== 'AVAILABLE' \|\| busy\}/);
  assert.doesNotMatch(page, /promo\??\.available[^;\n]{0,80}disabled|disabled=\{[^}]*promo/);
  // The renewal being set up reuses the page's own "check again" control.
  assert.match(page, /\|\| promotionBlock\?\.checking\) && \(status\.paymentState !== 'NONE'/);
});

test('FXE-D2: the lost-promotion notice is brought into view under the sticky header, after the chooser-heading scroll, and is announced and focusable like the cadence notice', () => {
  // The notice: a ref, focusable, an alert, and the page's own scroll margin for the sticky header.
  assert.match(page, /<div ref=\{lostNotice\} tabIndex=\{-1\} role="alert" className="scroll-mt-\[calc\(var\(--app-header-h,0px\)\+1\.5rem\)\] space-y-2 [^"]*">\s*<p className="font-semibold">\{promotionLost\.title\}<\/p>/);
  // The effect: on the notice only, to the top of the notice, focus without a second scroll.
  const effect = /useEffect\(\(\) => \{ if \(promotionLost\) \{ lostNotice\.current\?\.scrollIntoView\(\{ block: 'start' \}\); lostNotice\.current\?\.focus\(\{ preventScroll: true \}\); \} \}, \[promotionLost\]\);/;
  assert.match(page, effect);
  // A refused checkout drops the quote, which runs the effect that scrolls to the chooser heading below the notice; this one must come after it so the notice is the last scroll.
  const heading = page.indexOf("useEffect(() => { if (quote || choosing) {");
  assert.ok(heading > 0, 'the chooser-heading effect is still there');
  assert.ok(page.search(effect) > heading, 'the notice effect is declared after the chooser-heading effect');
  // The two causes that set the notice are the refused quote and the refused checkout; both go through `action`, which sets it together with dropping the quote.
  assert.match(page, /if \(lost\) \{ setPromotionLost\(lost\); setQuote\(null\); setBuyingStep\(0\); setAccepted\(false\);/);
  // Same pattern as the cadence notice, which this page already scrolls to and focuses.
  assert.match(page, /<div ref=\{cadenceNoticeRef\} tabIndex=\{-1\} role="status" className="scroll-mt-\[calc\(var\(--app-header-h,0px\)\+1\.5rem\)\]/);
});

test('FXE-D6: a promotion review leads with its benefit before the flat facts and total; the document box and the discount not used follow it, every other review keeps its order', () => {
  const at = (text: string) => { const index = page.indexOf(text); assert.ok(index > 0, text); return index; };
  // One definition of each block, rendered in one of two places.
  assert.equal((page.match(/aria-label="ข้อมูลออกเอกสาร"/g) ?? []).length, 1);
  assert.equal((page.match(/aria-label="ส่วนลดจากงาน" className="space-y-2/g) ?? []).length, 1);
  const before = at('{!promoReview && <>{documentBox(quote, status)}{discountBox(quote)}</>}'), tax = at('<p>ราคาก่อนภาษี'), promo = at('{promoReview && <section aria-label="โปรโมชั่นที่ใช้ในรายการนี้"'),
    after = at('{promoReview && <>{discountBox(quote)}{documentBox(quote, status)}</>}'), kind = at("{quote.purchase?.kind === 'UPGRADE' ? <div");
  assert.ok(before < tax, 'without a promotion the document box and the discount stay above the price, as before');
  assert.ok(promo < before && promo < tax && tax < after && after < kind, 'with a promotion: the benefit leads, then facts, then the discount not used and the document box');
  // The chosen benefit first: the promotion block is above the discount section it can be swapped for.
  assert.ok(promo < page.indexOf('{discountBox(quote)}{documentBox(quote, status)}'));
  // The blocks are the same JSX as before, now called with the quote: nothing but their position changed.
  assert.match(page, /const documentBox = \(quote: BillingQuote, status: BillingStatus\) => <div className="space-y-2" aria-label="ข้อมูลออกเอกสาร">/);
  assert.match(page, /const discountBox = \(quote: BillingQuote\) => quote\.eventDiscount && <section aria-label="ส่วนลดจากงาน"/);
  assert.match(page, /\}\}>\{promotionSwitchLabel\(quote\)\}<\/button>\s*<\/section>;/, 'the switch that says what replaces what is still in the discount section');
});

test('no figure of one campaign is written into the promotion logic', () => {
  assert.doesNotMatch(logic.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /\b(?:249|390|60)\b/);
});
