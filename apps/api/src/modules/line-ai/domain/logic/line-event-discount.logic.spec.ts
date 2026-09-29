import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BillingEventDiscountTicket } from '@watchdog-bms/contracts';
import { buildEventDiscountCard, EVENT_DISCOUNT_MEMBER_REPLY, isMangmeeDiscountQuestion, lineEventDiscountAnswer, type LineEventDiscountFacts } from './line-event-discount.logic';

const ticket = (over: Partial<BillingEventDiscountTicket> = {}): BillingEventDiscountTicket => ({
  serial: 'MHFVR743', eventName: 'event1', discountSatang: 10_000, chatCreditUnits: 0, receiptImageUnits: 0,
  // 30 Oct 2026 23:59 Bangkok.
  expiresAt: '2026-10-30T16:59:59.000Z', state: 'AVAILABLE', batchSuspended: false, ...over });
const facts = (over: Partial<LineEventDiscountFacts> = {}): LineEventDiscountFacts => ({ path: 'DISCOUNT', block: null, tickets: [ticket()], ...over });
const LINE = '• ส่วนลดจากงาน event1 · ลดบิลแรก 100 บาท · ใช้ได้ถึง 30 ต.ค. 2569';
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
  it('a usable ticket and a starting shop: each ticket with its computed baht and Thai date, how it applies, and the package button', () => {
    const answer = lineEventDiscountAnswer(facts());
    assert.equal(answer.canUse, true);
    assert.equal(answer.text, ['คุณมีส่วนลดจากงานค่ะ', LINE,
      'ใช้ได้ตอนซื้อแพ็กเกจแบบจ่ายครั้งเดียวด้วยบัตรหรือ PromptPay ระบบจะลดให้ในบิลแรกของร้านค่ะ'].join('\n'));
    const card = buildEventDiscountCard(facts(), 'https://app.example.test/l/tok') as any;
    assert.deepEqual(card.contents.footer.contents[0].action, { type: 'uri', label: 'เลือกแพ็กเกจ', uri: 'https://app.example.test/l/tok' });
    assert.equal(card.canonicalText, answer.text);
    assert.equal(lineEventDiscountAnswer(facts({ tickets: [ticket({ discountSatang: 10_699 })] })).text.includes('ลดบิลแรก 106.99 บาท'), true);
  });

  it('a usable ticket but the shop already has a package: says so, first bill is for a new shop, the reward opens soon with no date', () => {
    for (const path of ['CREDIT', null] as const) {
      const answer = lineEventDiscountAnswer(facts({ path }));
      assert.equal(answer.canUse, false);
      assert.equal(answer.text, ['คุณมีส่วนลดจากงานค่ะ', LINE, 'ร้านนี้มีแพ็กเกจอยู่แล้ว จึงใช้ส่วนลดบิลแรกกับร้านนี้ไม่ได้ค่ะ',
        'ส่วนลดบิลแรกใช้กับร้านที่เริ่มแพ็กเกจใหม่ เช่น เปิดร้านใหม่ค่ะ', 'สิทธิ์สำหรับร้านที่มีแพ็กเกจอยู่แล้วจะเปิดให้ใช้เร็วๆ นี้ค่ะ'].join('\n'));
      assert.equal((buildEventDiscountCard(facts({ path }), 'https://app.example.test/l/tok') as any).contents.footer, undefined);
    }
    assert.match(lineEventDiscountAnswer(facts({ block: 'COMPANY_ALREADY_USED' })).text, /ร้านนี้ใช้ส่วนลดบิลแรกจากงานไปแล้ว \(ใช้ได้ร้านละครั้ง\) ค่ะ/);
    assert.match(lineEventDiscountAnswer(facts({ block: 'DEAL_ACTIVE' })).text, /ร้านนี้มีดีลพิเศษอยู่แล้ว/);
    assert.equal(lineEventDiscountAnswer(facts({ block: 'DEAL_ACTIVE' })).canUse, false);
  });

  it('a used, expired, paying or suspended ticket says which, and how to get another', () => {
    const answer = lineEventDiscountAnswer(facts({ tickets: [ticket({ state: 'USED' }), ticket({ eventName: 'งานสอง', state: 'EXPIRED' }),
      ticket({ eventName: 'งานสาม', state: 'IN_PAYMENT' }), ticket({ eventName: 'งานสี่', batchSuspended: true })] }));
    assert.equal(answer.canUse, false);
    assert.equal(answer.text, ['ตอนนี้ไม่มีส่วนลดจากงานที่ใช้ได้ค่ะ',
      '• ส่วนลดจากงาน event1 · ลดบิลแรก 100 บาท · ใช้ไปแล้ว',
      '• ส่วนลดจากงาน งานสอง · ลดบิลแรก 100 บาท · หมดอายุแล้ว (ใช้ได้ถึง 30 ต.ค. 2569)',
      '• ส่วนลดจากงาน งานสาม · ลดบิลแรก 100 บาท · อยู่ระหว่างชำระเงิน',
      '• ส่วนลดจากงาน งานสี่ · ลดบิลแรก 100 บาท · งดใช้ชั่วคราว',
      'รับส่วนลดได้โดยสแกน QR จากพนักงานขายของมั่งมีในงานอีเวนต์ค่ะ'].join('\n'));
  });

  it('no tickets (or only a credit reward, not built yet): none yet, and how to get one', () => {
    const none = ['ตอนนี้ยังไม่มีส่วนลดจากงานค่ะ', 'รับส่วนลดได้โดยสแกน QR จากพนักงานขายของมั่งมีในงานอีเวนต์ค่ะ'].join('\n');
    assert.deepEqual(lineEventDiscountAnswer(facts({ tickets: [] })), { text: none, canUse: false });
    assert.equal(lineEventDiscountAnswer(facts({ tickets: [ticket({ discountSatang: 0, chatCreditUnits: 5_000 })] })).text, none);
  });

  it('speaks as น้องมั่งมี with no machine tokens in any answer', () => {
    const all = [facts(), facts({ path: 'CREDIT' }), facts({ block: 'COMPANY_ALREADY_USED' }), facts({ tickets: [] }),
      facts({ tickets: [ticket({ state: 'REVOKED' })] })].map((item) => lineEventDiscountAnswer(item).text);
    for (const text of [...all, EVENT_DISCOUNT_MEMBER_REPLY]) { assert.doesNotMatch(text, MACHINE); assert.match(text, /ค่ะ$/u); }
  });
});
