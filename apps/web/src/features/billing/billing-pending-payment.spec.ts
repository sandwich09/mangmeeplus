import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { errorText } from './billing-error-text';
import { PAYMENT_OVER_CODES, PENDING_TEXT, paymentIsOver, pendingPayment, type PendingPayment, type PendingPaymentInput } from './billing-pending-payment';

type State = PendingPaymentInput['paymentState'];
// What the page derives from the open Checkout and the payment state (BillingPage.tsx: canResumePayment, oneTapCancel). The table builds its inputs the same way.
const RESUMABLE: readonly State[] = ['PENDING', 'FAILED', 'UNKNOWN', 'ACTION_REQUIRED'];
const input = (over: Partial<PendingPaymentInput> = {}): PendingPaymentInput => {
  const base: PendingPaymentInput = { paymentState: 'NONE', hasAttempt: false, awaiting: false, unconfirmed: false, canEnd: false, canResume: false, oneTap: false, canCheck: false,
    moneyReceived: false, renewalSetup: false, failed: false, hasPackage: false, reservedPromotion: null, ...over };
  return { ...base, canResume: over.canResume ?? (base.canEnd && RESUMABLE.includes(base.paymentState)), oneTap: over.oneTap ?? (base.canEnd && base.paymentState === 'PENDING') };
};
/** A block as a person reads it, one line per fact; the order of the choices is the order of the array. */
const shown = (block: PendingPayment | null) => block && ({ kind: block.kind, title: block.title, intro: block.intro, hide: [block.hideChoosePackage, block.hidePurchaseHint], pointer: block.pointer,
  steps: block.steps.map(step => [step.key, step.emphasis, step.label, ...step.caption]) });

const PROMO = 'โปรแถมเดือน Starter';
const RESERVED = `จองสิทธิ์โปรโมชั่น ${PROMO} ไว้ให้รายการนี้แล้ว สิทธิ์เริ่มใช้เมื่อชำระเงินสำเร็จ`;
const RIGHT_BACK = 'สิทธิ์โปรโมชั่นที่จองไว้จะถูกคืน เลือกใช้ใหม่ได้ถ้าโปรโมชั่นยังเปิดอยู่';
const UNPAID_PAGE = 'เปิดหน้าชำระเงินไว้แล้ว แต่ระบบยังไม่ได้รับผลการชำระเงิน';
const POINTER_OPEN = 'มีรายการชำระเงินที่ยังไม่เสร็จ ดูตัวเลือกด้านล่าง';
const CONTINUE = ['continue', 'primary', 'ชำระเงินต่อ'];
const CANCEL_NEW = ['cancel', 'quiet', 'ยกเลิกรายการนี้ แล้วเลือกแพ็กเกจใหม่', 'รายการเดิมจะถูกยุติ'];
const KEPT = 'แพ็กเกจที่ใช้อยู่ไม่เปลี่ยน';
const CHECK_CAUTION = 'ระบบยังยืนยันผลจากผู้ให้บริการรับชำระเงินไม่ได้ กดตรวจก่อนชำระใหม่ เพื่อไม่ให้ชำระซ้ำ';
const CONTINUE_CAUTION = 'ใช้เมื่อแน่ใจว่ายังไม่ได้ชำระ เปิดหน้าชำระเงินเดิมเพื่อจ่ายให้เสร็จ';
const CANCEL_TWO_STEP = ['cancel', 'quiet', 'ยกเลิกรายการนี้', 'ระบบจะตรวจผลกับผู้ให้บริการรับชำระเงินก่อน จึงเลือกแพ็กเกจใหม่ได้'];
const HIDE_ALL = [true, true];

// Every state the page's own flags can put the package page in, and exactly what the buyer is shown there.
const TABLE: { name: string; input: PendingPaymentInput; expect: ReturnType<typeof shown> }[] = [
  { name: 'nothing in progress: today\'s page, today\'s one button', input: input(), expect: null },
  { name: 'a purchase that is not started and no payment to check', input: input({ paymentState: 'NONE', hasPackage: true }), expect: null },

  { name: 'open unpaid page, no package, no promotion (the owner\'s screenshot, without the reserved box)', input: input({ paymentState: 'PENDING', hasAttempt: true, canEnd: true, canCheck: true }),
    expect: { kind: 'OPEN', title: 'มีรายการชำระเงินที่ยังไม่เสร็จ', intro: [UNPAID_PAGE], hide: HIDE_ALL, pointer: POINTER_OPEN, steps: [
      [...CONTINUE, 'เปิดหน้าชำระเงินเดิมเพื่อจ่ายให้เสร็จ'],
      ['check', 'secondary', 'ชำระแล้ว ตรวจผลการชำระเงิน', 'กดเมื่อจ่ายเงินแล้วแต่หน้านี้ยังไม่เปลี่ยน'],
      CANCEL_NEW] } },
  { name: 'open unpaid page with a promotion right reserved: said in the block, and given back on cancel', input: input({ paymentState: 'PENDING', hasAttempt: true, canEnd: true, canCheck: true, reservedPromotion: PROMO }),
    expect: { kind: 'OPEN', title: 'มีรายการชำระเงินที่ยังไม่เสร็จ', intro: [UNPAID_PAGE, RESERVED], hide: HIDE_ALL, pointer: POINTER_OPEN, steps: [
      [...CONTINUE, 'เปิดหน้าชำระเงินเดิมเพื่อจ่ายให้เสร็จ'],
      ['check', 'secondary', 'ชำระแล้ว ตรวจผลการชำระเงิน', 'กดเมื่อจ่ายเงินแล้วแต่หน้านี้ยังไม่เปลี่ยน'],
      [...CANCEL_NEW, RIGHT_BACK]] } },
  { name: 'open unpaid page of a shop with a running package: it is told its package does not change', input: input({ paymentState: 'PENDING', hasAttempt: true, canEnd: true, canCheck: true, hasPackage: true }),
    expect: { kind: 'OPEN', title: 'มีรายการชำระเงินที่ยังไม่เสร็จ', intro: [UNPAID_PAGE], hide: HIDE_ALL, pointer: POINTER_OPEN, steps: [
      [...CONTINUE, 'เปิดหน้าชำระเงินเดิมเพื่อจ่ายให้เสร็จ'],
      ['check', 'secondary', 'ชำระแล้ว ตรวจผลการชำระเงิน', 'กดเมื่อจ่ายเงินแล้วแต่หน้านี้ยังไม่เปลี่ยน'],
      [...CANCEL_NEW, KEPT]] } },
  { name: 'open unpaid page, running package and a reserved right', input: input({ paymentState: 'PENDING', hasAttempt: true, canEnd: true, canCheck: true, hasPackage: true, reservedPromotion: PROMO }),
    expect: { kind: 'OPEN', title: 'มีรายการชำระเงินที่ยังไม่เสร็จ', intro: [UNPAID_PAGE, RESERVED], hide: HIDE_ALL, pointer: POINTER_OPEN, steps: [
      [...CONTINUE, 'เปิดหน้าชำระเงินเดิมเพื่อจ่ายให้เสร็จ'],
      ['check', 'secondary', 'ชำระแล้ว ตรวจผลการชำระเงิน', 'กดเมื่อจ่ายเงินแล้วแต่หน้านี้ยังไม่เปลี่ยน'],
      [...CANCEL_NEW, RIGHT_BACK, KEPT]] } },

  { name: 'outcome UNKNOWN: check the result first, paying again only when sure; ending keeps its confirmation', input: input({ paymentState: 'UNKNOWN', hasAttempt: true, canEnd: true, canCheck: true }),
    expect: { kind: 'OPEN', title: 'มีรายการชำระเงินที่ยังไม่เสร็จ', intro: ['ระบบยังยืนยันผลการชำระเงินรายการนี้ไม่ได้'], hide: HIDE_ALL, pointer: POINTER_OPEN, steps: [
      ['check', 'primary', 'ตรวจผลการชำระเงิน', CHECK_CAUTION],
      ['continue', 'secondary', 'ชำระเงินต่อ', CONTINUE_CAUTION],
      CANCEL_TWO_STEP] } },
  { name: 'outcome UNKNOWN with a reserved right: it is returned only if nothing was paid', input: input({ paymentState: 'UNKNOWN', hasAttempt: true, canEnd: true, canCheck: true, reservedPromotion: PROMO, hasPackage: true }),
    expect: { kind: 'OPEN', title: 'มีรายการชำระเงินที่ยังไม่เสร็จ', intro: ['ระบบยังยืนยันผลการชำระเงินรายการนี้ไม่ได้', RESERVED], hide: HIDE_ALL, pointer: POINTER_OPEN, steps: [
      ['check', 'primary', 'ตรวจผลการชำระเงิน', CHECK_CAUTION],
      ['continue', 'secondary', 'ชำระเงินต่อ', CONTINUE_CAUTION],
      [...CANCEL_TWO_STEP, `ถ้ายังไม่ได้ชำระ ${RIGHT_BACK}`, KEPT]] } },
  { name: 'ACTION_REQUIRED: continue at the payment page first', input: input({ paymentState: 'ACTION_REQUIRED', hasAttempt: true, canEnd: true, canCheck: true }),
    expect: { kind: 'OPEN', title: 'มีรายการชำระเงินที่ยังไม่เสร็จ', intro: ['การชำระเงินรายการนี้ยังต้องทำขั้นตอนเพิ่มที่หน้าชำระเงิน'], hide: HIDE_ALL, pointer: POINTER_OPEN, steps: [
      [...CONTINUE, 'เปิดหน้าชำระเงินเดิมเพื่อทำขั้นตอนที่เหลือให้เสร็จ'],
      ['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเมื่อทำขั้นตอนที่หน้าชำระเงินเสร็จแล้วแต่หน้านี้ยังไม่เปลี่ยน'],
      CANCEL_TWO_STEP] } },
  { name: 'FAILED with the page still open (a charge failed): try again at the payment page first', input: input({ paymentState: 'FAILED', hasAttempt: true, canEnd: true, canCheck: true }),
    expect: { kind: 'OPEN', title: 'มีรายการชำระเงินที่ยังไม่เสร็จ', intro: ['ระบบแจ้งว่าการเก็บเงินครั้งล่าสุดไม่สำเร็จ และหน้าชำระเงินนี้ยังเปิดค้างอยู่'], hide: HIDE_ALL, pointer: POINTER_OPEN, steps: [
      [...CONTINUE, 'เปิดหน้าชำระเงินเดิมเพื่อลองชำระอีกครั้ง'],
      ['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเมื่อจ่ายเงินแล้วแต่หน้านี้ยังไม่เปลี่ยน'],
      CANCEL_TWO_STEP] } },
  { name: 'back from the payment page after finishing there, no answer (the wait gave up): check first, the buyer may well have paid', input: input({ paymentState: 'PENDING', hasAttempt: true, canEnd: true, canCheck: true, unconfirmed: true }),
    expect: { kind: 'OPEN', title: 'มีรายการชำระเงินที่ยังไม่เสร็จ', intro: ['กลับจากหน้าชำระเงินแล้ว แต่ระบบยังยืนยันผลการชำระเงินไม่ได้'], hide: HIDE_ALL, pointer: POINTER_OPEN, steps: [
      ['check', 'primary', 'ตรวจผลการชำระเงิน', CHECK_CAUTION],
      ['continue', 'secondary', 'ชำระเงินต่อ', CONTINUE_CAUTION],
      CANCEL_NEW] } },
  { name: 'an open page the buyer can only end (no result to check, nothing to resume)', input: input({ paymentState: 'NONE', hasAttempt: true, canEnd: true }),
    expect: { kind: 'OPEN', title: 'มีรายการชำระเงินที่ยังไม่เสร็จ', intro: ['มีหน้าชำระเงินที่เปิดค้างอยู่'], hide: HIDE_ALL, pointer: POINTER_OPEN, steps: [CANCEL_TWO_STEP] } },

  { name: 'waiting for the first answer after the payment page, no package: the card already says it, only the one check is left', input: input({ paymentState: 'PENDING', hasAttempt: true, awaiting: true, canCheck: true }),
    expect: { kind: 'WAITING', title: null, intro: [], hide: HIDE_ALL, pointer: null, steps: [['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเมื่ออยากให้ตรวจผลทันที']] } },
  { name: 'waiting, with a running package: the card has no waiting line, so the block says it', input: input({ paymentState: 'PENDING', hasAttempt: true, awaiting: true, canCheck: true, hasPackage: true }),
    expect: { kind: 'WAITING', title: null, intro: ['กำลังรอผลการชำระเงินจากผู้ให้บริการรับชำระเงิน ระบบตรวจผลให้อัตโนมัติ ไม่ต้องชำระซ้ำ'], hide: HIDE_ALL, pointer: null, steps: [['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเมื่ออยากให้ตรวจผลทันที']] } },
  { name: 'waiting with a reserved right', input: input({ paymentState: 'PENDING', hasAttempt: true, awaiting: true, canCheck: true, reservedPromotion: PROMO }),
    expect: { kind: 'WAITING', title: null, intro: [RESERVED], hide: HIDE_ALL, pointer: null, steps: [['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเมื่ออยากให้ตรวจผลทันที']] } },

  { name: 'paid and being applied: the check alone, and never a way to pay again', input: input({ paymentState: 'PAID', hasAttempt: true, moneyReceived: true, canCheck: true }),
    expect: { kind: 'RECEIVED', title: 'ระบบได้รับเงินแล้ว ไม่ต้องชำระซ้ำ', intro: [], hide: HIDE_ALL, pointer: 'ระบบได้รับเงินแล้ว ไม่ต้องชำระซ้ำ', steps: [['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเมื่ออยากตรวจผลล่าสุด']] } },
  { name: 'a renewal still being set up after the payment (a running package)', input: input({ paymentState: 'PAID', renewalSetup: true, canCheck: true, hasPackage: true }),
    expect: { kind: 'RECEIVED', title: 'ระบบได้รับเงินแล้ว ไม่ต้องชำระซ้ำ', intro: [], hide: HIDE_ALL, pointer: 'ระบบได้รับเงินแล้ว ไม่ต้องชำระซ้ำ', steps: [['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเมื่ออยากตรวจผลล่าสุด']] } },

  { name: 'a past-due or unpaid subscription (the last charge failed, no payment page open): the check alone; a new purchase stays reachable', input: input({ paymentState: 'FAILED', canCheck: true, hasPackage: true }),
    expect: { kind: 'FAILED', title: 'ผลการชำระเงินล่าสุด', intro: ['ผู้ให้บริการรับชำระเงินแจ้งว่าการเก็บเงินครั้งล่าสุดไม่สำเร็จ'], hide: [false, false], pointer: null,
      steps: [['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเมื่อจ่ายเงินแล้ว เพื่อตรวจผลล่าสุดอีกครั้ง']] } },
  { name: 'the return page of an attempt that failed (the attempt is over, the status names none): the check alone, and the way to a new purchase stays', input: input({ paymentState: 'NONE', failed: true, canCheck: true }),
    expect: { kind: 'FAILED', title: 'ผลการชำระเงินล่าสุด', intro: ['ผู้ให้บริการรับชำระเงินแจ้งว่าการเก็บเงินครั้งล่าสุดไม่สำเร็จ'], hide: [false, false], pointer: null,
      steps: [['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเมื่อจ่ายเงินแล้ว เพื่อตรวจผลล่าสุดอีกครั้ง']] } },
  { name: 'the same page while a newer attempt of the shop is in flight (another tab): the payment in flight decides, nothing new is started', input: input({ paymentState: 'PENDING', hasAttempt: true, failed: true, canCheck: true }),
    expect: { kind: 'CHECKING', title: 'กำลังตรวจรายการชำระเงิน', intro: ['ระบบกำลังตรวจรายการชำระเงินนี้กับผู้ให้บริการรับชำระเงิน ยังไม่ต้องเริ่มรายการใหม่'], hide: HIDE_ALL,
      pointer: 'กำลังตรวจรายการชำระเงิน ยังไม่ต้องเริ่มรายการใหม่', steps: [['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเพื่อให้ระบบตรวจผลล่าสุดกับผู้ให้บริการรับชำระเงิน']] } },
  { name: 'an attempt being checked, no page to resume or end: wait, do not start another', input: input({ paymentState: 'PENDING', hasAttempt: true, canCheck: true }),
    expect: { kind: 'CHECKING', title: 'กำลังตรวจรายการชำระเงิน', intro: ['ระบบกำลังตรวจรายการชำระเงินนี้กับผู้ให้บริการรับชำระเงิน ยังไม่ต้องเริ่มรายการใหม่'], hide: HIDE_ALL,
      pointer: 'กำลังตรวจรายการชำระเงิน ยังไม่ต้องเริ่มรายการใหม่', steps: [['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเพื่อให้ระบบตรวจผลล่าสุดกับผู้ให้บริการรับชำระเงิน']] } },
  { name: 'an attempt whose outcome is unknown and has no page: the check leads', input: input({ paymentState: 'UNKNOWN', hasAttempt: true, canCheck: true, reservedPromotion: PROMO }),
    expect: { kind: 'CHECKING', title: 'กำลังตรวจรายการชำระเงิน', intro: ['ระบบกำลังตรวจรายการชำระเงินนี้กับผู้ให้บริการรับชำระเงิน ยังไม่ต้องเริ่มรายการใหม่', RESERVED], hide: HIDE_ALL,
      pointer: 'กำลังตรวจรายการชำระเงิน ยังไม่ต้องเริ่มรายการใหม่', steps: [['check', 'primary', 'ตรวจผลการชำระเงิน', 'ระบบยังยืนยันผลไม่ได้ กดตรวจก่อนชำระใหม่ เพื่อไม่ให้ชำระซ้ำ']] } },
  { name: 'an old paid record on a shop whose package ran out: the check stays, with a sentence true whatever happened before', input: input({ paymentState: 'PAID', canCheck: true }),
    expect: { kind: 'RECHECK', title: 'ผลการชำระเงินล่าสุด', intro: [], hide: [false, false], pointer: null, steps: [['check', 'secondary', 'ตรวจผลการชำระเงิน', 'ให้ระบบถามผู้ให้บริการรับชำระเงินอีกครั้งว่ามีผลล่าสุดหรือไม่']] } },
];

test('the state table: title, what is waiting, the choices in order with their purpose and emphasis, and what gives way', () => {
  for (const row of TABLE) assert.deepEqual(shown(pendingPayment(row.input)), row.expect, row.name);
  assert.ok(TABLE.length >= 20);
});

test('the names of the controls: the old four labels are gone and the new ones say what they do', () => {
  const labels = new Set<string>(TABLE.flatMap(row => (pendingPayment(row.input)?.steps ?? []).map(step => step.label)));
  assert.deepEqual([...labels].sort(), ['ชำระเงินต่อ', 'ชำระแล้ว ตรวจผลการชำระเงิน', 'ตรวจผลการชำระเงิน', 'ยกเลิกรายการนี้', 'ยกเลิกรายการนี้ แล้วเลือกแพ็กเกจใหม่'].sort());
  for (const old of ['เลือกแพ็กเกจใหม่', 'กลับไปยังรายการเดิม', 'ตรวจผลการชำระเงินอีกครั้ง', 'ยุติรายการที่ยังไม่ชำระ']) assert.ok(!labels.has(old), old);
  // The confirmation of the two-step end keeps the caution that the provider is asked first.
  assert.match(PENDING_TEXT.confirmEnd, /ระบบจะตรวจผลกับผู้ให้บริการรับชำระเงินก่อน/);
  assert.deepEqual([PENDING_TEXT.confirmYes, PENDING_TEXT.confirmNo], ['ยืนยันยกเลิกรายการนี้', 'ยังไม่ยกเลิก']);
});

// ---- invariants over every combination of the page's flags ----
const STATES: State[] = ['NONE', 'PENDING', 'UNKNOWN', 'PAID', 'FAILED', 'ACTION_REQUIRED'];
const BOOL = [false, true];
/**
 * Every combination of the page's flags that the page can build. The page and the API derive some flags from others, so the rest are not states it can be in:
 * an open payment that can be ended has an attempt, is not being awaited (`canEndCheckout = !awaitingStripe && canCancelCheckout && attemptId`) and is not paid (the API's
 * `canCancelCheckout` excludes an attempt whose invoice is paid, and `paymentState` is PAID with an attempt only then), and "back without an answer" is the opposite of
 * awaiting (`unconfirmed = returning && !checkoutCanceled && !awaitingStripe`).
 */
function everyCombination(): PendingPaymentInput[] {
  const all: PendingPaymentInput[] = [];
  for (const paymentState of STATES) for (const hasAttempt of BOOL) for (const awaiting of BOOL) for (const unconfirmed of BOOL) for (const canEnd of BOOL) for (const canCheck of BOOL)
    for (const moneyReceived of BOOL) for (const renewalSetup of BOOL) for (const failed of BOOL) for (const hasPackage of BOOL) for (const reservedPromotion of [null, PROMO]) {
      if (canEnd && (awaiting || !hasAttempt || paymentState === 'PAID')) continue;
      if (unconfirmed && awaiting) continue;
      all.push(input({ paymentState, hasAttempt, awaiting, unconfirmed, canEnd, canCheck, moneyReceived, renewalSetup, failed, hasPackage, reservedPromotion }));
    }
  return all;
}
/** A sentence that says money was received. "หน้าชำระเงินแล้ว" (… the payment page) is not one; "จ่ายเงินแล้ว" is the buyer's own claim and appears only as a condition. */
const CLAIMS_PAID = /ได้รับเงินแล้ว|(?<!หน้า)ชำระเงินแล้ว|(?<!หน้า)ชำระแล้ว|จ่ายเงินแล้ว/;
const words = (block: PendingPayment) => [...(block.title ? [block.title] : []), ...block.intro, ...(block.pointer ? [block.pointer] : []), ...block.steps.flatMap(step => step.caption)];
const label = (name: string, flags: PendingPaymentInput) => `${name} :: ${JSON.stringify(flags)}`;

test('invariants over every combination: one green button at most, ending is never green, nothing says "paid" that was not, nothing invites paying twice, "เดิม" the package only when there is one', () => {
  const combos = everyCombination();
  assert.equal(combos.length, 2944, 'the number of states the page can build');
  let blocks = 0;
  for (const flags of combos) {
    const block = pendingPayment(flags);
    if (!block) {
      // Nothing is shown only when there is nothing open, nothing awaited, nothing received and nothing to check.
      assert.ok(!flags.awaiting && !flags.canEnd && !flags.moneyReceived && !flags.renewalSetup && !flags.canCheck, label('no block while something is in flight', flags));
      continue;
    }
    blocks++;
    const at = (name: string) => label(name, flags), keys = block.steps.map(step => step.key), primaries = block.steps.filter(step => step.emphasis === 'primary');
    // order and emphasis
    assert.ok(primaries.length <= 1, at('at most one primary'));
    if (primaries.length) assert.equal(block.steps[0]!.emphasis, 'primary', at('the primary is the first choice'));
    assert.equal(new Set(keys).size, keys.length, at('no choice twice'));
    for (const step of block.steps) {
      if (step.key === 'cancel') { assert.equal(step.emphasis, 'quiet', at('ending is quiet')); assert.equal(step, block.steps.at(-1), at('ending is last')); assert.ok(flags.canEnd, at('ending only when the payment can be ended')); }
      else assert.notEqual(step.emphasis, 'quiet', at('only ending is quiet'));
      assert.ok(step.label.length > 0 && step.caption.length > 0 && step.caption.every(line => line.length > 0), at('every choice says what it does'));
    }
    assert.ok(block.title === null ? block.kind === 'WAITING' : block.title.length > 0, at('a title unless the card already says it'));
    if (flags.canCheck) assert.ok(keys.includes('check'), at('the check control is never lost'));
    const received = flags.moneyReceived || flags.renewalSetup;
    if (flags.canEnd && !received) assert.ok(keys.includes('cancel'), at('the open payment can still be ended'));
    if (received) assert.ok(!keys.includes('cancel') && !keys.includes('continue'), at('a payment the provider has is neither paid again nor thrown away'));
    // a plain screen: no id, enum key, code or JavaScript word
    for (const text of [...words(block), ...block.steps.map(step => step.label)]) assert.doesNotMatch(text, /[A-Z]{3,}_[A-Z]|undefined|\bnull\b|NaN|\[object/, at(`machine token in ${text}`));
    // money: "paid" and "no need to pay again" are said only when money was received (the wait after the payment page may say the second)
    for (const text of [...(block.title ? [block.title] : []), ...block.intro, ...(block.pointer ? [block.pointer] : [])]) {
      if (CLAIMS_PAID.test(text)) assert.ok(received, at(`"paid" in ${text}`));
      if (/ไม่ต้องชำระซ้ำ/.test(text)) assert.ok(received || flags.awaiting, at(`"no need to pay again" in ${text}`));
    }
    for (const text of block.steps.flatMap(step => step.caption)) if (CLAIMS_PAID.test(text)) assert.match(text, /^(กดเมื่อ|ใช้เมื่อ|ถ้า)/, at(`a caption names payment only as a condition: ${text}`));
    // the buyer's own claim is a label, and only on the second choice of an unpaid page
    for (const step of block.steps) if (step.label === PENDING_TEXT.labelPaidCheck) { assert.equal(flags.paymentState, 'PENDING', at('claim label state')); assert.equal(step.emphasis, 'secondary', at('claim label emphasis')); assert.ok(!received, at('claim label without money')); }
    // paying: never offered when money was received, when the state says paid, or while the answer is awaited
    const noPaying = received || flags.paymentState === 'PAID' || flags.awaiting;
    if (noPaying) {
      assert.ok(!keys.includes('continue'), at('no way back to the payment page'));
      for (const text of [...words(block), ...block.steps.map(step => step.label)]) assert.doesNotMatch(text, /ชำระเงินต่อ|ชำระใหม่|ลองชำระ|เปิดหน้าชำระเงินเดิม/, at(`no invitation to pay in ${text}`));
    }
    if (keys.includes('continue')) assert.ok(flags.canResume, at('continue only when the page can be resumed'));
    // "เดิม" as the old package, and the package that stays, only for a shop that has one
    for (const text of words(block)) if (/แพ็กเกจที่ใช้อยู่|แพ็กเกจเดิม|สิทธิ์เดิม|แพ็กเกจปัจจุบัน/.test(text)) assert.ok(flags.hasPackage, at(`old package in ${text}`));
    if (flags.hasPackage && block.kind === 'OPEN' && keys.includes('cancel')) assert.ok(block.steps.at(-1)!.caption.includes(KEPT), at('the package that stays is said'));
    // the reserved right: said in the block only where the payment is not yet received, and only when there is one
    const said = words(block).some(text => text.includes(PROMO));
    assert.equal(said, block.showsReservedPromotion, at('the right is said exactly when the green box may stay quiet'));
    if (block.showsReservedPromotion) { assert.ok(flags.reservedPromotion, at('a right to say')); assert.ok(['OPEN', 'WAITING', 'CHECKING'].includes(block.kind), at('said only while unpaid')); }
    else assert.ok(!words(block).some(text => /จองสิทธิ์|สิทธิ์โปรโมชั่นที่จองไว้/.test(text)), at('no right said without one'));
    if (flags.reservedPromotion && ['OPEN', 'WAITING', 'CHECKING'].includes(block.kind)) assert.ok(block.showsReservedPromotion, at('a reserved right is always said where it is held'));
    // what gives way
    const inFlight = ['OPEN', 'WAITING', 'RECEIVED', 'CHECKING'].includes(block.kind);
    assert.equal(block.hideChoosePackage, inFlight, at('the generic button gives way while a payment is open or in flight'));
    assert.equal(block.hidePurchaseHint, block.hideChoosePackage, at('the invitation goes with the button'));
    assert.equal(block.pointer !== null, block.hidePurchaseHint && block.kind !== 'WAITING', at('a pointer stands where the invitation was'));
    if (received || flags.canEnd || flags.awaiting) assert.ok(block.hideChoosePackage, at('never an invitation to buy while paid or open'));
    assert.equal(block.tone, block.kind === 'OPEN' ? 'attention' : block.kind === 'RECEIVED' ? 'ok' : 'neutral', at('tone'));
  }
  assert.ok(blocks > 2000 && blocks < combos.length, `blocks ${blocks}`);
});

test('every kind is reachable and its first choice is what the state asks for', () => {
  const kinds = new Map<string, PendingPayment>();
  for (const flags of everyCombination()) { const block = pendingPayment(flags); if (block && !kinds.has(block.kind)) kinds.set(block.kind, block); }
  assert.deepEqual([...kinds.keys()].sort(), ['CHECKING', 'FAILED', 'OPEN', 'RECEIVED', 'RECHECK', 'WAITING']);
  // Of the open payments: unpaid and action-required lead with the payment page; unknown and "back without an answer" lead with the check.
  const lead = (over: Partial<PendingPaymentInput>) => pendingPayment(input({ hasAttempt: true, canEnd: true, canCheck: true, ...over }))!.steps[0]!.key;
  assert.equal(lead({ paymentState: 'PENDING' }), 'continue');
  assert.equal(lead({ paymentState: 'ACTION_REQUIRED' }), 'continue');
  assert.equal(lead({ paymentState: 'FAILED' }), 'continue');
  assert.equal(lead({ paymentState: 'UNKNOWN' }), 'check');
  assert.equal(lead({ paymentState: 'PENDING', unconfirmed: true }), 'check');
  assert.equal(lead({ paymentState: 'UNKNOWN', unconfirmed: true }), 'check');
  // Once money is received or the page cannot be paid, there is no way back to it, whatever else the flags say.
  assert.ok(!pendingPayment(input({ paymentState: 'PENDING', hasAttempt: true, canEnd: true, canCheck: true, moneyReceived: true }))!.steps.some(step => step.key === 'continue'));
  assert.ok(!pendingPayment(input({ paymentState: 'PAID', hasAttempt: true, canEnd: true, canResume: true, canCheck: true }))!.steps.some(step => step.key === 'continue'));
});

// ---- the page draws what the logic returns, and does what it always did ----
const page = readFileSync(new URL('./BillingPage.tsx', import.meta.url), 'utf8');
const display = readFileSync(new URL('./billing-display.ts', import.meta.url), 'utf8');
const pendingSection = page.slice(page.indexOf('const pendingSection = ('), page.indexOf('  return <BillingCustomerFrame'));
const at = (text: string) => { const index = page.indexOf(text); assert.ok(index > 0, text); return index; };
const count = (text: string, part: string) => text.split(part).length - 1;

test('the card: the block after the explaining notices, the generic button gives way to it, the reference is the last thing', () => {
  const timedOut = at('{returning && !confirmed && timedOut && !status.pendingDeal'), block = at('{pending && (pending.title || pending.intro.length > 0 || pending.steps.length > 0) && pendingSection(status, pending)}'),
    generic = at("{status.allowedActions.includes('new_sales') && !pending?.hideChoosePackage && <button"), reference = at('{supportReference && !confirmed && !applyHeld && <details'),
    cardEnd = at("<div hidden={section !== 'payment'}");
  assert.ok(timedOut < block && block < generic && generic < reference && reference < cardEnd, 'explanations, then the block, then the generic button, then the reference');
  assert.equal(count(page, 'เลขอ้างอิงสำหรับแจ้งทีมงาน</summary>'), 1, 'the collapsed reference exists once');
  // the invitation in the no-package box gives way to a pointer; the reserved right is said in the block, and the amber alert that says "wait" gives way for an open unpaid page
  assert.match(page, /const purchaseHint = pending\?\.hidePurchaseHint \? pending\.pointer : canBuy \|\| oneTapCancel \?/);
  assert.match(page, /\{promotionBlock && !pending\?\.showsReservedPromotion && <section role="status" aria-label="สถานะโปรโมชั่น"/);
  assert.match(page, /\{status\.purchaseBlockCode && !\(pending\?\.kind === 'OPEN' && status\.purchaseBlockCode === 'BILLING_CHECKOUT_PENDING'\) && <div role="alert"/);
  // the flags the logic is given are the page's own, unchanged
  assert.match(page, /pendingPayment\(\{ paymentState: status\.paymentState, hasAttempt: !!status\.attemptId, awaiting: awaitingStripe, unconfirmed: returning && !checkoutCanceled && !awaitingStripe,/);
  assert.match(page, /canEnd: canEndCheckout, canResume: canResumePayment, oneTap: oneTapCancel, canCheck: !!hasPaymentToCheck, moneyReceived: paidNotApplied, renewalSetup: !!promotionBlock\?\.checking,/);
  assert.match(page, /failed: returnFailed, hasPackage: !noPackage, reservedPromotion: promotionReservedName\(promotionUse\) \}\) : null;/);
  // the three derived flags keep their old definitions (the block decides wording only)
  assert.match(page, /const canEndCheckout = !awaitingStripe && Boolean\(status\?\.canCancelCheckout && status\.attemptId\);/);
  assert.match(page, /const canResumePayment = canEndCheckout && \['PENDING', 'FAILED', 'UNKNOWN', 'ACTION_REQUIRED'\]\.includes\(status!\.paymentState\);/);
  assert.match(page, /const oneTapCancel = canEndCheckout && status!\.paymentState === 'PENDING';/);
});

test('the markup: a named region, an ordered list, a control and its purpose tied together, 44px controls that fill a phone', () => {
  assert.match(pendingSection, /<section aria-label=\{block\.title \?\? PENDING_TEXT\.regionName\} className=\{`space-y-4 rounded-xl border p-4 \$\{PENDING_TONE\[block\.tone\]\}`\}>/);
  assert.match(pendingSection, /\{block\.title && <h3 className="text-lg font-bold text-gray-900">\{block\.title\}<\/h3>\}/);
  assert.match(pendingSection, /<ol className="space-y-4">/);
  assert.match(pendingSection, /<li key=\{step\.key\} className="space-y-2">/);
  assert.match(pendingSection, /<button type="button" className=\{STEP_CLASS\[step\.emphasis\]\} disabled=\{busy\} aria-busy=\{busy\} aria-describedby=\{ids\.join\(' '\)\} onClick=\{run\[step\.key\]\}>\{step\.label\}<\/button>/);
  assert.match(pendingSection, /\{step\.caption\.map\(\(line, index\) => <p key=\{line\} id=\{ids\[index\]\} className="break-words text-sm leading-6 text-gray-600">\{line\}<\/p>\)\}/);
  assert.match(pendingSection, /const ids = step\.caption\.map\(\(_, index\) => `\$\{pendingId\}-\$\{step\.key\}-\$\{index\}`\);/);
  // each control is at least 44px and full width until sm; only the first is green (the page's own primary class), and only giving up is quiet
  assert.match(page, /primary: `\$\{billingPrimaryControl\} w-full sm:w-auto`,\s*secondary: `\$\{billingControl\} w-full sm:w-auto`,\s*quiet: 'inline-flex min-h-11 w-full items-center justify-center rounded-xl /);
  assert.match(display, /export const billingControl = 'inline-flex min-h-11 /);
  assert.match(display, /export const billingPrimaryControl = `\$\{billingControl\} /);
  // brand classes only: no raw palette outside the page's existing ones, and nothing that would push past 390px
  const classes = [...pendingSection.matchAll(/className="([^"]+)"/g)].map(match => match[1]!).join(' ') + ' ' + page.slice(at('const STEP_CLASS'), at('const enterpriseMenuSummary'));
  assert.doesNotMatch(classes, /\bw-\[\d|\bmin-w-|\bwhitespace-nowrap|\boverflow-x-/, 'no fixed widths or non-wrapping text in the block');
  assert.doesNotMatch(classes, /\b(bg|text|border)-(?:blue|green|indigo|purple|pink|orange|yellow)-/, 'brand and the page\'s neutral and alert colours only');
  // the confirmation of the two-step end stays inside the choice it belongs to, with both its buttons
  assert.match(pendingSection, /const confirming = step\.key === 'cancel' && !oneTapCancel && confirmCheckoutCancel;/);
  assert.match(pendingSection, /<p>\{PENDING_TEXT\.confirmEnd\}<\/p>/);
  assert.match(pendingSection, /\}>\{PENDING_TEXT\.confirmYes\}<\/button><button className=\{STEP_CLASS\.secondary\} disabled=\{busy\} onClick=\{\(\) => setConfirmCheckoutCancel\(false\)\}>\{PENDING_TEXT\.confirmNo\}<\/button>/);
  // the follow-up of a check ("update the information") stays attached to the check choice, with the notice it belongs to
  assert.match(pendingSection, /\{step\.key === 'check' && refreshNotice && <div className="space-y-2">\s*<p role="status" className="text-sm leading-6 text-gray-700">\{refreshNotice\}<\/p>/);
  assert.match(pendingSection, /className="mangmee-btn mangmee-btn-secondary w-full sm:w-auto" disabled=\{busy\} onClick=\{\(\) => setReload\(value => value \+ 1\)\}>อัปเดตข้อมูล<\/button>/);
});

test('every handler does what the loose button of the same job did, and the four old labels are gone from the page', () => {
  // the three provider calls, each in the one place that serves its choice (the 30-second background refresh is a fifth, untouched)
  assert.equal(count(pendingSection, 'api.resume(status.attemptId!)'), 1);
  assert.equal(count(pendingSection, 'api.refresh()'), 1);
  assert.equal(count(pendingSection, 'api.cancelCheckout(status.attemptId!)'), 2, 'one-tap end and the confirmed end');
  assert.equal(count(page, 'api.resume('), 1);
  assert.equal(count(page, 'api.cancelCheckout('), 2);
  // the notices the handlers set are the ones the e2e specs and the buyers already know
  for (const notice of ['หน้าชำระเงินเดิมเปิดต่อไม่ได้แล้ว ระบบกำลังตรวจผลรายการเดิม กรุณารอสักครู่แล้วกดอัปเดตข้อมูล', 'ยุติหน้าชำระเงินเดิมแล้ว เลือกแพ็กเกจใหม่ได้เลย',
    'รายการเดิมชำระสำเร็จแล้ว ระบบกำลังเปิดสิทธิ์ให้ ไม่ต้องซื้อใหม่', 'กำลังตรวจผลรายการเดิมกับผู้ให้บริการรับชำระเงิน กรุณารอสักครู่แล้วกดอัปเดตข้อมูล', 'ยุติหน้าชำระเงินแล้ว เลือกแพ็กเกจใหม่ได้',
    'กำลังตรวจผลรายการเดิม กรุณากดอัปเดตข้อมูลก่อนเริ่มรายการใหม่', 'ส่งคำขอตรวจสอบแล้ว ยังไม่ใช่ผลยืนยันการชำระเงิน กดอัปเดตข้อมูลเพื่อดูผลภายหลัง', 'ยังไม่มีรายการที่ต้องตรวจสอบกับผู้ให้บริการ'])
    assert.equal(count(pendingSection, notice), 1, notice);
  // an unpaid page is ended in one tap and the chooser reopens; every other open payment asks first
  assert.match(pendingSection, /if \(result\.state === 'EXPIRED'\) \{ reopenChooser\.current = true; setCheckoutCancelNotice/);
  assert.match(pendingSection, /cancel: oneTapCancel \? \(\) => action\(async \(\) => \{/);
  assert.match(pendingSection, /\}\) : \(\) => setConfirmCheckoutCancel\(true\),/);
  // the old controls: gone as buttons, kept nowhere as a label
  for (const old of ['>เลือกแพ็กเกจใหม่</button>', '>กลับไปยังรายการเดิม</button>', '>ตรวจผลการชำระเงินอีกครั้ง</button>', '>ยุติรายการที่ยังไม่ชำระ</button>', '>ยืนยันยุติหน้าชำระเงิน</button>', '>ยังไม่ยุติ</button>', 'ยุติหน้าชำระเงินรายการนี้ใช่ไหม'])
    assert.equal(count(page, old), 0, old);
  assert.equal(count(page, '{canResumePayment && <button'), 0);
  assert.equal(count(page, '{oneTapCancel && <button'), 0);
  assert.equal(count(page, '{hasPaymentToCheck && <div'), 0);
});

// ---- D9: a payment that is over ----
const answer = (code: string | undefined, status: number | undefined) => Object.assign(new Error('x'), { ...(code ? { code } : {}), ...(status ? { status } : {}) });

test('D9 logic: answers that say the payment on screen is over make the page read the status again; "still being checked" answers do not', () => {
  assert.deepEqual([...PAYMENT_OVER_CODES], ['BILLING_CHECKOUT_NOT_STARTED', 'CONTROL_PREVIEW_STALE']);
  for (const code of PAYMENT_OVER_CODES) assert.equal(paymentIsOver(answer(code, 409)), true, code);
  assert.equal(paymentIsOver(answer(undefined, 404)), true, 'no such open payment any more');
  for (const code of ['BILLING_CHECKOUT_PENDING', 'BILLING_PURCHASE_PENDING', 'PROMOTION_UNAVAILABLE', 'BILLING_QUOTE_STALE', 'BILLING_CHECKOUT_INVOICE_MISMATCH', 'BILLING_EMAIL_UPDATE_PENDING']) assert.equal(paymentIsOver(answer(code, 409)), false, code);
  for (const status of [400, 401, 403, 429, 500, 503]) assert.equal(paymentIsOver(answer(undefined, status)), false, String(status));
  for (const nothing of [null, undefined, 'BILLING_CHECKOUT_NOT_STARTED', 404, {}]) assert.equal(paymentIsOver(nothing), false, String(nothing));
  // The banner the buyer is shown for it is plain Thai and not the generic sentence.
  assert.equal(errorText(answer('BILLING_CHECKOUT_NOT_STARTED', 409)), 'รายการชำระเงินนี้ยังไม่ได้เริ่ม ระบบยกเลิกให้แล้ว กรุณาเริ่มรายการใหม่');
  assert.match(errorText(answer('CONTROL_PREVIEW_STALE', 409)), /^[ก-๙ ]+$/u);
});

test('D9 wiring: the banner is set first, then the status is read in place; a bare reload would empty the banner just set', () => {
  assert.match(page, /import \{ PENDING_TEXT, paymentIsOver, pendingPayment, type PendingPayment, type PendingStepKey \} from '\.\/billing-pending-payment';/);
  const read = page.slice(at('async function readStatus() {'), at('async function action('));
  assert.match(read, /const read = \+\+statusRead\.current;/);
  assert.match(read, /const latest = await api\.status\(\); if \(read === statusRead\.current\) setData\(value => value && \{ \.\.\.value, status: latest \}\);/);
  assert.match(read, /catch \{ \/\* the message on screen stays; the next read says more \*\/ \}/);
  const catchBlock = page.slice(at('async function action('), at('async function requestQuote('));
  assert.match(catchBlock, /else \{\s*setError\(errorText\(e\)\); setErrorCode\(apiErrorCode\(e\)\);\s*\/\/[^\n]*\n\s*if \(paymentIsOver\(e\)\) await readStatus\(\);\s*\}/);
  assert.ok(catchBlock.indexOf('setError(errorText(e))') < catchBlock.indexOf('await readStatus()'), 'the banner first, then the read');
  assert.equal(count(catchBlock, 'setReload'), 1, 'only the lost-promotion branch reloads; the refused action keeps its banner');
  // why not setReload: the reload effect begins by emptying the banner
  assert.match(page, /useEffect\(\(\) => \{\s*let active = true, historyDenied = false;\s*let history: BillingHistory = \{ items: \[\], nextCursor: null \};\s*setError\(''\); setErrorCode\(null\);/);
  // the read is guarded like the quote request's, so an older answer cannot overwrite a newer one
  assert.match(page, /statusRead = useRef\(0\)/);
  // the Checkout the page was drawn from is the only thing that depends on that read: the block is derived from the status each render
  assert.match(page, /const pending = status \? pendingPayment\(/);
});

// ---- D10: the red banner is seen on a phone ----
test('D10 wiring: the banner takes a ref, focus and a header-aware scroll margin; it scrolls into view only when not already visible; the recipient codes keep their own destination', () => {
  assert.match(page, /const errorBanner = useRef<HTMLDivElement>\(null\), checkoutNotice = useRef<HTMLDivElement>\(null\);/);
  assert.match(page, /\{error && <div ref=\{errorBanner\} tabIndex=\{-1\} role="alert" className="scroll-mt-\[calc\(var\(--app-header-h,0px\)\+1\.5rem\)\] space-y-2 rounded-xl border border-red-200 bg-red-50 p-4">/);
  assert.match(page, /useEffect\(\(\) => \{ if \(error && !RECIPIENT_ERROR_CODES\.includes\(errorCode \?\? ''\)\) \{ errorBanner\.current\?\.scrollIntoView\(\{ block: 'nearest' \}\); errorBanner\.current\?\.focus\(\{ preventScroll: true \}\); \} \}, \[error, errorCode\]\);/);
  // the same for the notice after ending or resuming a payment (not stealing the scroll when it is already in view)
  assert.match(page, /\{checkoutCancelNotice && <div ref=\{checkoutNotice\} tabIndex=\{-1\} role="status" className="scroll-mt-\[calc\(var\(--app-header-h,0px\)\+1\.5rem\)\] /);
  assert.match(page, /useEffect\(\(\) => \{ if \(checkoutCancelNotice\) \{ checkoutNotice\.current\?\.scrollIntoView\(\{ block: 'nearest' \}\); checkoutNotice\.current\?\.focus\(\{ preventScroll: true \}\); \} \}, \[checkoutCancelNotice\]\);/);
  // the recipient errors still go to the email panel
  assert.match(page, /useEffect\(\(\) => \{ if \(error && RECIPIENT_ERROR_CODES\.includes\(errorCode \?\? ''\)\) \{ setSection\('payment'\); emailSettings\.current\?\.scrollIntoView\(\{ block: 'start' \}\); \} \}, \[error, errorCode\]\);/);
});

test('D10 effect order: chooser heading, then the lost-promotion notice, then the banner, then the cancel notice, so a visible message always has the last word', () => {
  const chooser = at('backNavigation.current?.scrollIntoView({ block: \'start\' })'), lost = at('lostNotice.current?.scrollIntoView({ block: \'start\' })'),
    banner = at('errorBanner.current?.scrollIntoView({ block: \'nearest\' })'), notice = at('checkoutNotice.current?.scrollIntoView({ block: \'nearest\' })'),
    recipient = at('emailSettings.current?.scrollIntoView({ block: \'start\' }); } }, [error, errorCode]);');
  assert.ok(chooser < lost && lost < banner && banner < notice && notice < recipient, 'declaration order is the run order within one commit; the later one wins');
  // the banner and the lost-promotion notice never come together: `action` sets exactly one of them
  const catchBlock = page.slice(at('async function action('), at('async function requestQuote('));
  assert.match(catchBlock, /if \(lost\) \{ setPromotionLost\(lost\);[^\n]*\}\s*else \{\s*setError\(errorText\(e\)\)/);
  // no other scroll helper takes the banner's place: the old error banner had no ref
  assert.equal(count(page, 'errorBanner.current'), 2);
  assert.equal(count(page, 'ref={errorBanner}'), 1);
});
