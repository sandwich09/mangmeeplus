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
  it('a usable ticket and a shop that can pay for a package: each ticket with its computed baht and Thai date, how it applies, and the package button', () => {
    const answer = lineEventDiscountAnswer(facts());
    assert.equal(answer.canUse, true);
    // SD-O13 (Owner 2026-09-29): choosing automatic card renewal discounts only the first bill.
    assert.equal(answer.text, ['คุณมีส่วนลดจากงานค่ะ', LINE,
      'ลดตอนจ่ายค่าแพ็กเกจด้วยบัตรหรือ PromptPay เลือกใช้หรือไม่ใช้ได้ตอนจ่าย งานเดียวกันใช้ได้ร้านละครั้ง',
      'ถ้าเลือกตัดบัตรอัตโนมัติหรือสแกนบิล QR ทุกงวด ลดเฉพาะบิลแรก รอบต่อไปคิดราคาเต็มค่ะ'].join('\n'));
    // Owner 2026-09-29: several held discounts — the buyer picks one per payment.
    const several = lineEventDiscountAnswer(facts({ tickets: [ticket(), ticket({ eventName: 'event3', serial: 'Y', discountSatang: 12_000 })] }));
    assert.match(several.text, /เลือกได้ตอนจ่ายว่าจะใช้ส่วนลดไหน \(ครั้งละ 1 ส่วนลด\) หรือไม่ใช้ งานเดียวกันใช้ได้ร้านละครั้ง\n/u);
    assert.match(several.text, /• ส่วนลดจากงาน event3 · ลด 120 บาท/u);
    const card = buildEventDiscountCard(facts(), 'https://app.example.test/l/tok') as any;
    assert.deepEqual(card.contents.footer.contents[0].action, { type: 'uri', label: 'เลือกแพ็กเกจ', uri: 'https://app.example.test/l/tok' });
    assert.equal(card.canonicalText, answer.text);
    assert.equal(lineEventDiscountAnswer(facts({ tickets: [ticket({ discountSatang: 10_699 })] })).text.includes('ลด 106.99 บาท'), true);
  });

  it('a usable ticket the shop cannot take now: auto-renewal, a payment record under review, an event already used here, a deal — no date promised', () => {
    const auto = lineEventDiscountAnswer(facts({ path: 'CREDIT', renewalMode: 'CARD_AUTO', renewalState: 'RUNNING' }));
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

  // UAT 2026-10-10: a shop that is sent a QR bill each period was told its card is charged by itself, and one that had switched its renewal off was told it renews. The reason follows what is
  // known of the renewal (sales-event spec §8.1, table of 2026-10-10), in the web's words plus the polite particle.
  it('a paid package still running is told what is known of its renewal: by the way it renews while it runs, as switched off or unpaid, and the one fact that holds for all when nothing is settled', () => {
    const CARD = 'ร้านนี้ต่ออายุแบบตัดเงินอัตโนมัติ ส่วนลดจากงานยังใช้กับรอบตัดเงินอัตโนมัติไม่ได้ค่ะ';
    const QR = 'ร้านนี้ต่ออายุด้วยบิล QR ทุกงวด ส่วนลดจากงานยังใช้กับบิล QR รอบต่ออายุไม่ได้ค่ะ';
    const STOPPED = 'การต่ออายุของร้านนี้ปิดอยู่ แต่แพ็กเกจรอบปัจจุบันยังไม่หมด ตอนนี้จึงยังใช้ส่วนลดจากงานไม่ได้ค่ะ';
    const UNPAID = 'ร้านนี้มีค่าต่ออายุที่ยังชำระไม่สำเร็จ ส่วนลดจากงานใช้กับยอดต่ออายุนี้ไม่ได้ค่ะ';
    const ANY = 'ตอนนี้ร้านนี้ยังใช้ส่วนลดจากงานไม่ได้ค่ะ';
    const answer = (why: string) => ({ canUse: false, text: ['คุณมีส่วนลดจากงานค่ะ', LINE, why].join('\n') });
    const modes = ['CARD_AUTO', 'PROMPTPAY_RENEW', 'NONE', 'CARD_ONCE', 'PROMPTPAY_ONCE', undefined] as const;
    // running: CREDIT x every mode (NONE = no renewal on file, none = no account read; a one-time mode never reaches CREDIT from the API but must read true if it did)
    for (const [mode, why] of [['CARD_AUTO', CARD], ['PROMPTPAY_RENEW', QR], ['NONE', ANY], ['CARD_ONCE', ANY], ['PROMPTPAY_ONCE', ANY], [undefined, ANY]] as const)
      assert.deepEqual(lineEventDiscountAnswer(facts({ path: 'CREDIT', renewalMode: mode, renewalState: 'RUNNING' })), answer(why), `RUNNING ${mode}`);
    // switched off or unpaid: as such, whatever the mode. Unsettled, or a state an older API does not send: never the card or QR sentence.
    for (const mode of modes) {
      assert.deepEqual(lineEventDiscountAnswer(facts({ path: 'CREDIT', renewalMode: mode, renewalState: 'STOPPED' })), answer(STOPPED), `STOPPED ${mode}`);
      assert.deepEqual(lineEventDiscountAnswer(facts({ path: 'CREDIT', renewalMode: mode, renewalState: 'UNPAID' })), answer(UNPAID), `UNPAID ${mode}`);
      assert.deepEqual(lineEventDiscountAnswer(facts({ path: 'CREDIT', renewalMode: mode })), answer(ANY), `unsettled ${mode}`);
    }
    // Each is told only its own, with no date and no promise of when: the QR shop is never told its card is charged by itself, the card shop never about a bill.
    assert.doesNotMatch(QR, /ตัดเงินอัตโนมัติ|ตัดบัตร/u);
    assert.doesNotMatch(CARD, /QR|บิล/u);
    for (const text of [STOPPED, UNPAID, ANY]) assert.doesNotMatch(text, /QR|บิล|ตัดเงิน|ตัดบัตร/u);
    assert.doesNotMatch(ANY, /ต่ออายุ/u);
    for (const text of [CARD, QR, STOPPED, UNPAID, ANY]) assert.doesNotMatch(text, /\d|เมื่อไหร่|เร็วๆ นี้|undefined|null/u);
    // The renewal facts speak on the credit path, and on the discount path only as "unpaid": every other answer (payment record under review, deal, event used, nothing usable) is the same whatever they are.
    const others: Partial<LineEventDiscountFacts>[] = [{ path: null }, { block: 'DEAL_ACTIVE' }, { block: 'EVENT_ALREADY_USED' }, { tickets: [] },
      { tickets: [ticket({ state: 'USED' })] }, { path: 'CREDIT', tickets: [] }, { path: 'CREDIT', tickets: [ticket({ state: 'EXPIRED' })] }];
    for (const over of others) for (const renewalMode of modes) for (const renewalState of ['RUNNING', 'STOPPED', 'UNPAID', undefined] as const) {
      const withFacts = lineEventDiscountAnswer(facts({ ...over, renewalMode, renewalState }));
      assert.deepEqual(withFacts, lineEventDiscountAnswer(facts(over)), `${JSON.stringify(over)} ${renewalMode} ${renewalState}`);
    }
    // A shop that can pay for a package is told it can use the discount, whatever the mode and any renewal state but unpaid (a switched-off renewal whose grace ran out may restart).
    for (const renewalMode of modes) for (const renewalState of ['RUNNING', 'STOPPED', undefined] as const)
      assert.deepEqual(lineEventDiscountAnswer(facts({ renewalMode, renewalState })), lineEventDiscountAnswer(facts()), `DISCOUNT ${renewalMode} ${renewalState}`);
    assert.equal(lineEventDiscountAnswer(facts()).canUse, true);
    // An unpaid renewal opens no purchase on the package page (billing.service.ts status(): no `new_sales`), so on either path it gets the ticket lines, the unpaid sentence and no package button.
    for (const renewalMode of modes) for (const path of ['DISCOUNT', 'CREDIT'] as const) {
      const unpaid = facts({ path, renewalMode, renewalState: 'UNPAID' });
      assert.deepEqual(lineEventDiscountAnswer(unpaid), answer(UNPAID), `UNPAID ${path} ${renewalMode}`);
      assert.equal((buildEventDiscountCard(unpaid, 'https://app.example.test/l/tok') as any).contents.footer, undefined, `no button, UNPAID ${path} ${renewalMode}`);
    }
    assert.deepEqual(lineEventDiscountAnswer(facts({ renewalState: 'UNPAID', tickets: [ticket(), ticket({ eventName: 'งานสอง', serial: 'Y', discountSatang: 12_000 })] })).text.split('\n'),
      ['คุณมีส่วนลดจากงานค่ะ', LINE, '• ส่วนลดจากงาน งานสอง · ลด 120 บาท · ใช้ได้ถึง 30 ต.ค. 2569', UNPAID]);
    // A ticket reason still comes first, and an unreadable payment record still says the team must check (its data is what cannot be trusted).
    assert.match(lineEventDiscountAnswer(facts({ block: 'DEAL_ACTIVE', renewalState: 'UNPAID' })).text, /ร้านนี้มีดีลพิเศษอยู่แล้ว/);
    assert.match(lineEventDiscountAnswer(facts({ path: null, renewalState: 'UNPAID' })).text, /ต้องให้ทีมงานตรวจก่อน/);
    // Still the same card, with no package button (the shop cannot pay now): only the sentence changed.
    for (const [state, why] of [['STOPPED', STOPPED], ['UNPAID', UNPAID]] as const) {
      const card = buildEventDiscountCard(facts({ path: 'CREDIT', renewalMode: 'PROMPTPAY_RENEW', renewalState: state }), 'https://app.example.test/l/tok') as any, text = ['คุณมีส่วนลดจากงานค่ะ', LINE, why].join('\n');
      assert.deepEqual([card.type, card.contents.footer, card.contents.body.contents[1].text, card.canonicalText], ['flex', undefined, text, text], state);
    }
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
    const all = [facts(), facts({ path: 'CREDIT' }), facts({ path: 'CREDIT', renewalMode: 'CARD_AUTO', renewalState: 'RUNNING' }), facts({ path: 'CREDIT', renewalMode: 'PROMPTPAY_RENEW', renewalState: 'RUNNING' }),
      facts({ path: 'CREDIT', renewalState: 'STOPPED' }), facts({ path: 'CREDIT', renewalState: 'UNPAID' }), facts({ renewalState: 'UNPAID' }),
      facts({ path: null }), facts({ block: 'EVENT_ALREADY_USED' }), facts({ tickets: [] }),
      facts({ tickets: [ticket({ state: 'REVOKED' })] })].map((item) => lineEventDiscountAnswer(item).text);
    for (const text of [...all, EVENT_DISCOUNT_MEMBER_REPLY]) { assert.doesNotMatch(text, MACHINE); assert.match(text, /ค่ะ$/u); }
  });
});
