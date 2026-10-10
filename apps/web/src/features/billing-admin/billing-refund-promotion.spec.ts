import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { REFUND_PROMOTION_RIGHT, refundPaymentMethodLines, refundPromotionLines, type RefundPromotionCase } from './billing-refund-promotion';

const promotion = { displayName: 'ซื้อ 1 แถม 1', bonusMonths: 1, bonusReceiptUnits: 30, benefitEnd: '2026-12-05T10:00:00.000Z' };
const at = (over: Partial<RefundPromotionCase>): RefundPromotionCase => ({ paidSatang: 24_900, refundedSatang: 0, amountSatang: 10_000, endPackage: false, ...over });

describe('refund of a promotion purchase (spec Q6, plan R14 / R17)', () => {
  it('an invoice without a promotion says nothing', () => {
    for (const none of [null, undefined]) assert.deepEqual(refundPromotionLines(none, at({ amountSatang: 24_900, endPackage: true })), []);
  });

  // [case, input, what the middle line must say, what it must not say]
  const table: [string, Partial<RefundPromotionCase>, RegExp, RegExp][] = [
    ['partial, keep', {}, /^คำขอนี้คืนไม่ครบยอดที่จ่าย: เวลาใช้งานและใบเสร็จของร้านคงเดิม รวมเดือนแถมและใบเสร็จแถม$/, /ยุติ/],
    ['partial after an earlier partial, keep', { refundedSatang: 10_000, amountSatang: 14_899 }, /^คำขอนี้คืนไม่ครบยอดที่จ่าย: เวลาใช้งาน/, /ยุติ/],
    ['partial, end asked: refused', { endPackage: true }, /ยุติแพ็กเกจไม่ได้เมื่อคืนไม่ครบยอดที่จ่าย ระบบจะไม่รับคำขอนี้/, /คงเดิม|ระบบจะยุติ/],
    ['full, keep asked: ended anyway, decided at Stripe success', { amountSatang: 24_900 }, /^คำขอนี้ทำให้คืนครบยอดที่จ่าย: เมื่อ Stripe คืนเงินสำเร็จ ระบบจะยุติสิทธิ์ที่ยังไม่ได้ใช้ของการซื้อนี้เอง แม้เลือกคงแพ็กเกจไว้ เดือนแถมและใบเสร็จแถมที่ยังเหลือจะใช้ต่อไม่ได้ · .*เปิดเรื่องให้เจ้าหน้าที่ตรวจ · ถ้าร้านยังเปิดต่ออายุอัตโนมัติหรือมีรายการค้างจ่าย ระบบอาจให้จัดการเรื่องนั้นก่อน$/, /คงเดิม/],
    ['full by cumulative total, end asked', { refundedSatang: 10_000, amountSatang: 14_900, endPackage: true }, /^คำขอนี้ทำให้คืนครบยอดที่จ่าย: เมื่อ Stripe คืนเงินสำเร็จ/, /คงเดิม/],
    ['full, saved request not decided yet', { amountSatang: 24_900, endPackage: true, packageEnded: null }, /^คำขอนี้ทำให้คืนครบยอดที่จ่าย: เมื่อ Stripe คืนเงินสำเร็จ/, /แล้ว:/],
    ['full, package ended', { amountSatang: 24_900, endPackage: true, packageEnded: true }, /^คืนครบยอดที่จ่ายแล้ว: ระบบยุติแพ็กเกจของการซื้อนี้แล้ว เดือนแถมและใบเสร็จแถมที่ยังเหลือใช้ต่อไม่ได้$/, /เมื่อ Stripe|เปิดเรื่อง/],
    ['full, the source was not the running package', { amountSatang: 24_900, endPackage: true, packageEnded: false }, /^คืนครบยอดที่จ่ายแล้ว: ระบบไม่ได้ยุติแพ็กเกจ เพราะการซื้อนี้ไม่ใช่แพ็กเกจที่ร้านใช้อยู่ตอนคืนเงินสำเร็จ .*เปิดเรื่องให้เจ้าหน้าที่ตรวจ ดูผลได้ในรายงานแคมเปญ$/, /เมื่อ Stripe/],
    ['nothing typed yet: both outcomes', { amountSatang: NaN }, /^ถ้าคืนไม่ครบยอดที่จ่าย: .*คงเดิม.* และยุติแพ็กเกจไม่ได้เมื่อคืนไม่ครบยอดที่จ่าย · ถ้าคืนครบยอดที่จ่าย: เมื่อ Stripe คืนเงินสำเร็จ/, /คำขอนี้/],
  ];
  for (const [name, input, says, never] of table) it(name, () => {
    const lines = refundPromotionLines(promotion, at(input));
    assert.equal(lines.length, 3);
    assert.equal(lines[0], 'ซื้อด้วยโปรโมชั่น ซื้อ 1 แถม 1 · แถมฟรี 1 เดือน · ใบเสร็จแถม 30 ใบ · ใช้ได้ถึง 5 ธ.ค. 2569 17:00 น. (รวมเดือนแถม)');
    assert.match(lines[1]!, says);
    assert.doesNotMatch(lines[1]!, never);
    assert.equal(lines[2], REFUND_PROMOTION_RIGHT, 'the right is never returned, in every case');
    assert.doesNotMatch(lines.join(' '), /[A-Z]{2,}_|undefined|null|NaN/, 'no codes on screen');
  });

  it('a right used but never applied has no end date to show', () => {
    assert.equal(refundPromotionLines({ ...promotion, displayName: '', benefitEnd: null }, at({}))[0], 'ซื้อด้วยโปรโมชั่น · แถมฟรี 1 เดือน · ใบเสร็จแถม 30 ใบ · ยังไม่ได้เปิดสิทธิ์ที่แถม');
  });
});

describe('refund note by payment method (UAT 2026-10-10: the provider e-mails the customer of a PromptPay payment for bank details)', () => {
  it('a card payment, or an invoice whose method is not known, says nothing', () => {
    for (const method of ['card', null, undefined] as const) assert.deepEqual(refundPaymentMethodLines(method), []);
  });
  it('a PromptPay payment says who is e-mailed, when the money goes back, and what to check first', () => {
    const lines = refundPaymentMethodLines('promptpay');
    assert.deepEqual(lines, [
      'รายการนี้จ่ายด้วยพร้อมเพย์ QR ผู้ให้บริการรับชำระเงินจะส่งอีเมลให้ลูกค้ากรอกบัญชีรับเงินคืน เงินจะคืนเมื่อลูกค้ากรอกเสร็จ ไม่ได้คืนทันทีเหมือนบัตร',
      'แจ้งลูกค้าให้รอรับอีเมลนั้นและกรอกบัญชีให้เสร็จ ระหว่างรอลูกค้า คำขอนี้จะอยู่ในสถานะรอผล',
    ]);
    assert.doesNotMatch(lines.join(' '), /[A-Z]{2,}_|undefined|null|promptpay/, 'no codes on screen');
  });
});
