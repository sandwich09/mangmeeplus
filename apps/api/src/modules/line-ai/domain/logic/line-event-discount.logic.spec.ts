import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BillingEventDiscountTicket } from '@watchdog-bms/contracts';
import { buildEventDiscountCard, EVENT_DISCOUNT_MEMBER_REPLY, isMangmeeDiscountQuestion, lineEventDiscountAnswer, type LineEventDiscountFacts } from './line-event-discount.logic';

const ticket = (over: Partial<BillingEventDiscountTicket> = {}): BillingEventDiscountTicket => ({
  serial: 'MHFVR743', eventName: 'event1', discountSatang: 10_000, chatCreditUnits: 0, receiptImageUnits: 0,
  // 30 Oct 2026 23:59 Bangkok.
  expiresAt: '2026-10-30T16:59:59.000Z', state: 'AVAILABLE', batchSuspended: false, ...over });
const facts = (over: Partial<LineEventDiscountFacts> = {}): LineEventDiscountFacts => ({ path: 'DISCOUNT', block: null, tickets: [ticket()], ...over });
const LINE = '• ส่วนลดจากงาน event1 · ลด 100 บาท · ใช้ได้ถึง 30 ต.ค. 2569';
const MACHINE = /MHFVR743|[A-Z]{3,}_[A-Z]|AVAILABLE|DISCOUNT|CREDIT|https?:|ครับ|\bSD-/u;

describe('LINE: ถามส่วนลด routing (sales-event spec §8.1)', () => {
  it('answers the owner’s questions about a มั่งมี discount, including a bare "ส่วนลด" right after a receipt draft', () => {
    for (const text of ['ส่วนลด', 'ฉันมีส่วนลดไหม', 'ฉันมีส่วนลดไหมคะ', 'ก็ส่วนลดค่ามั่งมีไง', 'ส่วนลดค่ามั่งมี', 'ส่วนลดแพ็กเกจ', 'ส่วนลดแพ็คเกจ',
      'โค้ดส่วนลด', 'คูปอง', 'ตั๋วส่วนลด', 'ส่วนลดจากงาน', 'ส่วนลดจากงาน event1', 'มีส่วนลดมั้ย', 'มีคูปองไหมครับ', 'ร้านนี้มีส่วนลดอะไรบ้าง',
      'ส่วนลดของฉันอยู่ไหน', 'เช็คส่วนลด', 'ส่วนลด มั่งมี?']) assert.equal(isMangmeeDiscountQuestion(text), true, text);
  });

  it('leaves a discount the user places on the receipt or bill with the receipt flow', () => {
    for (const text of ['ส่วนลดในบิลนี้', 'ใบเสร็จมีส่วนลด', 'ส่วนลดในใบเสร็จ', 'บิลนี้มีส่วนลดไหม', 'มีส่วนลด', 'ส่วนลด 50 บาท', 'แก้ส่วนลดเป็น 20',
      'ยอดนี้มีส่วนลดไหม', 'ขอดูยอดขายเดือนนี้', '']) assert.equal(isMangmeeDiscountQuestion(text), false, text);
  });
});

describe('LINE: ถามส่วนลด answer', () => {
  it('a usable ticket and a shop that can pay in one go: each ticket with its computed baht and Thai date, how it applies, and the package button', () => {
    const answer = lineEventDiscountAnswer(facts());
    assert.equal(answer.canUse, true);
    assert.equal(answer.text, ['คุณมีส่วนลดจากงานค่ะ', LINE,
      'ลดตอนจ่ายค่าแพ็กเกจแบบจ่ายครั้งเดียวด้วยบัตรหรือ PromptPay เลือกใช้หรือไม่ใช้ได้ตอนจ่าย งานเดียวกันใช้ได้ร้านละครั้งค่ะ'].join('\n'));
    const card = buildEventDiscountCard(facts(), 'https://app.example.test/l/tok') as any;
    assert.deepEqual(card.contents.footer.contents[0].action, { type: 'uri', label: 'เลือกแพ็กเกจ', uri: 'https://app.example.test/l/tok' });
    assert.equal(card.canonicalText, answer.text);
    assert.equal(lineEventDiscountAnswer(facts({ tickets: [ticket({ discountSatang: 10_699 })] })).text.includes('ลด 106.99 บาท'), true);
  });

  it('a usable ticket the shop cannot take now: auto-renewal, a payment record under review, an event already used here, a deal — no date promised', () => {
    const auto = lineEventDiscountAnswer(facts({ path: 'CREDIT' }));
    assert.deepEqual(auto, { canUse: false, text: ['คุณมีส่วนลดจากงานค่ะ', LINE,
      'ร้านนี้ต่ออายุแบบตัดเงินอัตโนมัติ ส่วนลดจากงานยังใช้กับรอบตัดเงินอัตโนมัติไม่ได้ค่ะ'].join('\n') });
    assert.match(lineEventDiscountAnswer(facts({ path: null })).text, /ต้องให้ทีมงานตรวจก่อน จึงยังใช้ส่วนลดจากงานไม่ได้ค่ะ$/u);
    for (const path of ['CREDIT', null] as const)
      assert.equal((buildEventDiscountCard(facts({ path }), 'https://app.example.test/l/tok') as any).contents.footer, undefined);
    // SD-O12: one ticket per event per shop; the answer names the event(s) of the tickets still held.
    const used = lineEventDiscountAnswer(facts({ block: 'EVENT_ALREADY_USED', tickets: [ticket(), ticket({ eventName: 'event1', serial: 'X' }), ticket({ state: 'USED', eventName: 'งานเก่า' })] }));
    assert.equal(used.canUse, false);
    assert.match(used.text, /ร้านนี้ใช้ส่วนลดจากงาน event1 ไปแล้ว \(งานเดียวกันใช้ได้ร้านละครั้ง\) ค่ะ$/u);
    assert.match(lineEventDiscountAnswer(facts({ block: 'DEAL_ACTIVE' })).text, /ร้านนี้มีดีลพิเศษอยู่แล้ว/);
    assert.equal(lineEventDiscountAnswer(facts({ block: 'DEAL_ACTIVE' })).canUse, false);
  });

  it('a used, expired, paying or suspended ticket says which, and how to get another', () => {
    const answer = lineEventDiscountAnswer(facts({ tickets: [ticket({ state: 'USED' }), ticket({ eventName: 'งานสอง', state: 'EXPIRED' }),
      ticket({ eventName: 'งานสาม', state: 'IN_PAYMENT' }), ticket({ eventName: 'งานสี่', batchSuspended: true })] }));
    assert.equal(answer.canUse, false);
    assert.equal(answer.text, ['ตอนนี้ไม่มีส่วนลดจากงานที่ใช้ได้ค่ะ',
      '• ส่วนลดจากงาน event1 · ลด 100 บาท · ใช้ไปแล้ว',
      '• ส่วนลดจากงาน งานสอง · ลด 100 บาท · หมดอายุแล้ว (ใช้ได้ถึง 30 ต.ค. 2569)',
      '• ส่วนลดจากงาน งานสาม · ลด 100 บาท · อยู่ระหว่างชำระเงิน',
      '• ส่วนลดจากงาน งานสี่ · ลด 100 บาท · งดใช้ชั่วคราว',
      'รับส่วนลดได้โดยสแกน QR จากพนักงานขายของมั่งมีในงานอีเวนต์ค่ะ'].join('\n'));
  });

  it('no tickets (or only a credit reward, not built yet): none yet, and how to get one', () => {
    const none = ['ตอนนี้ยังไม่มีส่วนลดจากงานค่ะ', 'รับส่วนลดได้โดยสแกน QR จากพนักงานขายของมั่งมีในงานอีเวนต์ค่ะ'].join('\n');
    assert.deepEqual(lineEventDiscountAnswer(facts({ tickets: [] })), { text: none, canUse: false });
    assert.equal(lineEventDiscountAnswer(facts({ tickets: [ticket({ discountSatang: 0, chatCreditUnits: 5_000 })] })).text, none);
  });

  it('speaks as น้องมั่งมี with no machine tokens in any answer', () => {
    const all = [facts(), facts({ path: 'CREDIT' }), facts({ path: null }), facts({ block: 'EVENT_ALREADY_USED' }), facts({ tickets: [] }),
      facts({ tickets: [ticket({ state: 'REVOKED' })] })].map((item) => lineEventDiscountAnswer(item).text);
    for (const text of [...all, EVENT_DISCOUNT_MEMBER_REPLY]) { assert.doesNotMatch(text, MACHINE); assert.match(text, /ค่ะ$/u); }
  });
});
