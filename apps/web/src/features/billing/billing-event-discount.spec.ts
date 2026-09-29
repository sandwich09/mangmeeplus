import { it } from 'node:test';
import assert from 'node:assert/strict';
import type { BillingStatus } from '@watchdog-bms/contracts';
import { eventDiscountBaht, eventDiscountBlockedText, eventDiscountCard, eventDiscountCardText, eventDiscountHeldNotice, eventDiscountHelpText, eventDiscountMode, eventDiscountUsable, eventDiscountUseLabel } from './billing-event-discount';
import type { BillingEventDiscountTicket } from '@watchdog-bms/contracts';

const view = (over: Partial<NonNullable<BillingStatus['eventDiscount']>> = {}): NonNullable<BillingStatus['eventDiscount']> => ({
  ticketSerial: 'ABCD2345', eventName: 'งานแฟร์ SME', discountSatang: 10000, expiresAt: '2026-11-01T00:00:00.000Z', reason: null,
  offers: [{ offerKey: 'BASIC_499', interval: 'month', eventName: 'งานแฟร์ SME', shownDiscountSatang: 10000 },
    { offerKey: 'PRO_999', interval: 'month', eventName: 'งานแฟร์ SME', shownDiscountSatang: 10699 }], ...over });

it('offers the choice only for one-time purchases and only on the cards the discount lowers', () => {
  assert.equal(eventDiscountMode('CARD_ONCE'), true); assert.equal(eventDiscountMode('PROMPTPAY_ONCE'), true);
  assert.equal(eventDiscountMode('CARD_AUTO'), false); assert.equal(eventDiscountMode('PROMPTPAY_RENEW'), false);
  assert.equal(eventDiscountCard(view(), { offerKey: 'BASIC_499', interval: 'month' })?.shownDiscountSatang, 10000);
  assert.equal(eventDiscountCard(view(), { offerKey: 'BASIC_499', interval: 'year' }), null);
  assert.equal(eventDiscountCard(view({ reason: 'DEAL_ACTIVE', offers: [] }), { offerKey: 'BASIC_499', interval: 'month' }), null);
  assert.equal(eventDiscountUsable(undefined), false); assert.equal(eventDiscountUsable(view({ offers: [] })), false);
});

it('speaks plain Thai: whole baht without satang, this payment only, one per event per shop, no machine words', () => {
  assert.equal(eventDiscountBaht(10000), '100'); assert.equal(eventDiscountBaht(10699), '106.99');
  assert.equal(eventDiscountCardText('งานแฟร์ SME', 10000), 'ส่วนลดจากงาน งานแฟร์ SME −100 บาท');
  assert.equal(eventDiscountUseLabel(view()), 'ใช้ส่วนลด −106.99 บาทกับการจ่ายครั้งนี้');
  assert.match(eventDiscountHelpText(view()), /^ลดเฉพาะการจ่ายครั้งนี้ งานเดียวกันใช้ได้ร้านละครั้ง · ถ้าไม่ใช้ ส่วนลดยังอยู่ถึง /);
  assert.deepEqual(eventDiscountBlockedText(view({ reason: 'EVENT_ALREADY_USED', offers: [] })), ['ร้านนี้ใช้ส่วนลดจากงาน งานแฟร์ SME ไปแล้ว (งานเดียวกันใช้ได้ร้านละครั้ง)']);
  assert.equal(eventDiscountBlockedText(view({ reason: 'DEAL_ACTIVE', offers: [] }))[0], 'ร้านนี้มีดีลพิเศษอยู่แล้ว จึงใช้ส่วนลดจากงานกับราคาดีลไม่ได้');
  assert.deepEqual(eventDiscountBlockedText(view()), []);
  for (const text of [eventDiscountUseLabel(view()), eventDiscountHelpText(view()), ...eventDiscountBlockedText(view({ reason: 'DEAL_ACTIVE' })),
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
