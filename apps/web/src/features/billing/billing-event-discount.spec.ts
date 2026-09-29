import { it } from 'node:test';
import assert from 'node:assert/strict';
import type { BillingStatus } from '@watchdog-bms/contracts';
import { eventDiscountBaht, eventDiscountBlockedText, eventDiscountCard, eventDiscountCardText, eventDiscountHelpText, eventDiscountMode, eventDiscountUsable, eventDiscountUseLabel } from './billing-event-discount';

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

it('speaks plain Thai: whole baht without satang, the first bill named, no machine words', () => {
  assert.equal(eventDiscountBaht(10000), '100'); assert.equal(eventDiscountBaht(10699), '106.99');
  assert.equal(eventDiscountCardText('งานแฟร์ SME', 10000), 'ส่วนลดจากงาน งานแฟร์ SME −100 บาท (บิลแรก)');
  assert.equal(eventDiscountUseLabel(view()), 'ใช้ส่วนลด −106.99 บาทกับการซื้อครั้งนี้');
  assert.match(eventDiscountHelpText(view()), /^ใช้กับบิลที่ซื้อตอนนี้เท่านั้น รอบต่ออายุชำระราคาเต็ม · ถ้าไม่ใช้ ส่วนลดยังอยู่ถึง /);
  assert.deepEqual(eventDiscountBlockedText(view({ reason: 'COMPANY_ALREADY_USED', offers: [] })), ['ร้านนี้ใช้ส่วนลดราคาจากงานไปแล้ว (ใช้ได้ร้านละครั้ง)']);
  assert.equal(eventDiscountBlockedText(view({ reason: 'DEAL_ACTIVE', offers: [] }))[0], 'ร้านนี้มีดีลพิเศษอยู่แล้ว จึงใช้ส่วนลดจากงานกับราคาดีลไม่ได้');
  assert.deepEqual(eventDiscountBlockedText(view()), []);
  for (const text of [eventDiscountUseLabel(view()), eventDiscountHelpText(view()), ...eventDiscountBlockedText(view({ reason: 'DEAL_ACTIVE' }))])
    assert.doesNotMatch(text, /ตั๋ว|ก่อน VAT|[A-Z]{3,}_[A-Z]/);
});
