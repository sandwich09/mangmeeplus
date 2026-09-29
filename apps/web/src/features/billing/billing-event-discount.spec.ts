import { it } from 'node:test';
import assert from 'node:assert/strict';
import type { BillingStatus } from '@watchdog-bms/contracts';
import { EVENT_DISCOUNT_ONE_PER_PAYMENT, eventDiscountBaht, eventDiscountBlockedText, eventDiscountCard, eventDiscountCardText, eventDiscountChoiceLabel, eventDiscountChoices, eventDiscountFirstBillOnly,
  eventDiscountHeldNotice, eventDiscountHelpText, eventDiscountMode, eventDiscountNextRoundText, eventDiscountSerial, eventDiscountUsable } from './billing-event-discount';
import type { BillingEventDiscountTicket } from '@watchdog-bms/contracts';

const view = (over: Partial<NonNullable<BillingStatus['eventDiscount']>> = {}): NonNullable<BillingStatus['eventDiscount']> => ({
  ticketSerial: 'ABCD2345', eventName: 'งานแฟร์ SME', discountSatang: 10000, expiresAt: '2026-11-01T00:00:00.000Z', reason: null,
  offers: [{ offerKey: 'BASIC_499', interval: 'month', eventName: 'งานแฟร์ SME', shownDiscountSatang: 10000 },
    { offerKey: 'PRO_999', interval: 'month', eventName: 'งานแฟร์ SME', shownDiscountSatang: 10699 }], ...over });

it('offers the choice for one-time payments, and for a renewing mode only on a package the shop starts now (SD-O13); only on cards it lowers', () => {
  assert.equal(eventDiscountMode('CARD_ONCE'), true); assert.equal(eventDiscountMode('PROMPTPAY_ONCE'), true);
  assert.equal(eventDiscountMode('CARD_AUTO'), false); assert.equal(eventDiscountMode('PROMPTPAY_RENEW'), false);
  for (const source of ['NO_TERM', 'TRIAL', 'ADMIN_MANUAL', 'PAID_EXPIRED_CURRENT_MODE'] as const)
    for (const mode of ['CARD_AUTO', 'PROMPTPAY_RENEW'] as const) assert.equal(eventDiscountMode(mode, source), true, `${mode} ${source}`);
  // A one-time shop mid-package converting to automatic renewal: today's wording and "เลือกจ่ายครั้งเดียว" stay.
  assert.equal(eventDiscountMode('CARD_AUTO', 'PAID_CURRENT_MODE'), false); assert.equal(eventDiscountMode('CARD_ONCE', 'PAID_CURRENT_MODE'), true);
  assert.equal(eventDiscountFirstBillOnly('CARD_AUTO'), true); assert.equal(eventDiscountFirstBillOnly('PROMPTPAY_RENEW'), true);
  assert.equal(eventDiscountFirstBillOnly('CARD_ONCE'), false);
  assert.equal(eventDiscountCard(view(), { offerKey: 'BASIC_499', interval: 'month' })?.shownDiscountSatang, 10000);
  assert.equal(eventDiscountCard(view(), { offerKey: 'BASIC_499', interval: 'year' }), null);
  assert.equal(eventDiscountCard(view({ reason: 'DEAL_ACTIVE', offers: [] }), { offerKey: 'BASIC_499', interval: 'month' }), null);
  assert.equal(eventDiscountUsable(undefined), false); assert.equal(eventDiscountUsable(view({ offers: [] })), false);
});

it('speaks plain Thai: whole baht without satang, this payment only, one per event per shop, no machine words', () => {
  assert.equal(eventDiscountBaht(10000), '100'); assert.equal(eventDiscountBaht(10699), '106.99');
  assert.equal(eventDiscountCardText('งานแฟร์ SME', 10000), 'ส่วนลดจากงาน งานแฟร์ SME −100 บาท');
  assert.equal(eventDiscountHelpText(), 'ลดเฉพาะการจ่ายครั้งนี้ งานเดียวกันใช้ได้ร้านละครั้ง');
  assert.equal(eventDiscountHelpText(true), 'ลดเฉพาะบิลแรก รอบถัดไปคิดราคาเต็ม งานเดียวกันใช้ได้ร้านละครั้ง');
  assert.equal(eventDiscountNextRoundText('CARD_AUTO', '฿499.00', '2026-10-29T03:00:00.000Z'), 'รอบถัดไป ฿499.00 ตัดบัตรอัตโนมัติวันที่ 29 ตุลาคม 2569');
  assert.equal(eventDiscountNextRoundText('PROMPTPAY_RENEW', '฿499.00', '2026-10-29T03:00:00.000Z'), 'รอบถัดไป ฿499.00 วันที่ 29 ตุลาคม 2569');
  assert.deepEqual(eventDiscountBlockedText(view({ reason: 'EVENT_ALREADY_USED', offers: [] })), ['ร้านนี้ใช้ส่วนลดจากงาน งานแฟร์ SME ไปแล้ว (งานเดียวกันใช้ได้ร้านละครั้ง)']);
  assert.equal(eventDiscountBlockedText(view({ reason: 'DEAL_ACTIVE', offers: [] }))[0], 'ร้านนี้มีดีลพิเศษอยู่แล้ว จึงใช้ส่วนลดจากงานกับราคาดีลไม่ได้');
  assert.deepEqual(eventDiscountBlockedText(view()), []);
  for (const text of [eventDiscountHelpText(), eventDiscountHelpText(true), EVENT_DISCOUNT_ONE_PER_PAYMENT, ...eventDiscountChoices(view()).map(eventDiscountChoiceLabel),
    eventDiscountNextRoundText('CARD_AUTO', '฿499.00', '2026-10-29T03:00:00.000Z'), ...eventDiscountBlockedText(view({ reason: 'DEAL_ACTIVE' })),
    ...eventDiscountBlockedText(view({ reason: 'EVENT_ALREADY_USED' }))])
    assert.doesNotMatch(text, /ตั๋ว|ก่อน VAT|[A-Z]{3,}_[A-Z]/);
});

it('spec §8.1 / SD-O12: a holder whose shop cannot pay in one go reads one plain line; a shop that can gets the box instead', () => {
  const ticket = (over: Partial<BillingEventDiscountTicket> = {}): BillingEventDiscountTicket => ({ serial: 'MHFVR743', eventName: 'event1', discountSatang: 10000,
    chatCreditUnits: 0, receiptImageUnits: 0, expiresAt: '2026-10-30T16:59:59.000Z', state: 'AVAILABLE', batchSuspended: false, ...over });
  const held = 'คุณมีส่วนลดจากงาน event1 ลด 100 บาท ตอนจ่ายค่าแพ็กเกจ (ใช้ได้ถึง 30 ตุลาคม 2569)';
  const text = `${held} · ร้านนี้ต่ออายุแบบตัดเงินอัตโนมัติ ส่วนลดจากงานยังใช้กับรอบตัดเงินอัตโนมัติไม่ได้`;
  assert.equal(eventDiscountHeldNotice({ path: 'CREDIT', tickets: [ticket()] }), text, 'an auto-renewing shop: why, with no date');
  assert.equal(eventDiscountHeldNotice({ path: null, tickets: [ticket({ state: 'USED', eventName: 'งานเก่า' }), ticket()] }), held);
  // The biggest discount first, then the one that ends soonest.
  assert.match(eventDiscountHeldNotice({ path: 'CREDIT', tickets: [ticket(), ticket({ eventName: 'งานใหญ่', discountSatang: 20000 })] }) ?? '', /^คุณมีส่วนลดจากงาน งานใหญ่ ลด 200 บาท/);
  assert.equal(eventDiscountHeldNotice({ path: 'DISCOUNT', tickets: [ticket()] }), null);
  for (const over of [{ state: 'EXPIRED' as const }, { state: 'USED' as const }, { batchSuspended: true }, { discountSatang: 0 }])
    assert.equal(eventDiscountHeldNotice({ path: 'CREDIT', tickets: [ticket(over)] }), null);
  assert.equal(eventDiscountHeldNotice(null), null);
  assert.doesNotMatch(text, /MHFVR743|ตั๋ว|[A-Z]{3,}_[A-Z]/);
});

it('Owner 2026-09-29: one row per held discount, best first and the default; the card lines follow the ticket picked', () => {
  const card = (offerKey: string, shownDiscountSatang: number) => ({ offerKey, interval: 'month' as const, shownDiscountSatang });
  const held = view({ ticketSerial: 'EVT3BBBB', eventName: 'event3', discountSatang: 12000,
    offers: [{ ...card('BASIC_499', 12000), eventName: 'event3' }, { ...card('PRO_999', 12000), eventName: 'event3' }],
    tickets: [{ ticketSerial: 'EVT3BBBB', eventName: 'event3', discountSatang: 12000, expiresAt: '2026-11-01T00:00:00.000Z', offers: [card('BASIC_499', 12000), card('PRO_999', 12000)] },
      { ticketSerial: 'EVT2AAAA', eventName: 'event2', discountSatang: 1000, expiresAt: '2026-10-20T00:00:00.000Z', offers: [card('BASIC_499', 1000)] }] });
  assert.deepEqual(eventDiscountChoices(held).map(eventDiscountChoiceLabel),
    ['ส่วนลดจากงาน event3 −120 บาท · ใช้ได้ถึง 1 พฤศจิกายน 2569', 'ส่วนลดจากงาน event2 −10 บาท · ใช้ได้ถึง 20 ตุลาคม 2569']);
  assert.equal(EVENT_DISCOUNT_ONE_PER_PAYMENT, 'ใช้ได้ครั้งละ 1 ส่วนลดต่อการจ่าย ส่วนลดที่ไม่ได้เลือกยังเก็บไว้ใช้ครั้งถัดไปได้');
  // The default (no pick) is the best one per card; a pick moves each card to that ticket, and off the cards it does not lower.
  assert.deepEqual(eventDiscountCard(held, { offerKey: 'BASIC_499', interval: 'month' }), { ...card('BASIC_499', 12000), eventName: 'event3' });
  assert.deepEqual(eventDiscountCard(held, { offerKey: 'BASIC_499', interval: 'month' }, 'EVT2AAAA'), { eventName: 'event2', shownDiscountSatang: 1000 });
  assert.equal(eventDiscountCard(held, { offerKey: 'PRO_999', interval: 'month' }, 'EVT2AAAA'), null);
  // A pick survives only while it is still offered; one used or gone since falls back to the default.
  assert.equal(eventDiscountSerial(held, 'EVT2AAAA'), 'EVT2AAAA');
  assert.equal(eventDiscountSerial(held, 'GONE0000'), null); assert.equal(eventDiscountSerial(held, null), null);
  assert.equal(eventDiscountSerial(view({ reason: 'DEAL_ACTIVE', offers: [] }), 'EVT2AAAA'), null);
  // An older API sends one ticket: it is the only row.
  assert.deepEqual(eventDiscountChoices(view()).map(ticket => ticket.ticketSerial), ['ABCD2345']);
});
