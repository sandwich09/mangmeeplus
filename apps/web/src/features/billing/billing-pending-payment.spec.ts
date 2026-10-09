import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { errorText } from './billing-error-text';
import { PAYMENT_OVER_CODES, PENDING_TEXT, paymentIsOver, pendingPayment, type PendingKind, type PendingPayment, type PendingPaymentInput } from './billing-pending-payment';

type State = PendingPaymentInput['paymentState'];
// What the page derives from the open Checkout and the payment state (BillingPage.tsx: canResumePayment, oneTapCancel). The table builds its inputs the same way.
const RESUMABLE: readonly State[] = ['PENDING', 'FAILED', 'UNKNOWN', 'ACTION_REQUIRED'];
const input = (over: Partial<PendingPaymentInput> = {}): PendingPaymentInput => {
  const base: PendingPaymentInput = { paymentState: 'NONE', hasAttempt: false, awaiting: false, unconfirmed: false, canEnd: false, canResume: false, oneTap: false, canCheck: false,
    moneyReceived: false, renewalSetup: false, failed: false, hasPackage: false, reservedPromotion: null, ...over };
  return { ...base, canResume: over.canResume ?? (base.canEnd && RESUMABLE.includes(base.paymentState)), oneTap: over.oneTap ?? (base.canEnd && base.paymentState === 'PENDING') };
};
/** A block as a person reads it, one line per fact; the order of the choices is the order of the array. */
const shown = (block: PendingPayment | null) => block && ({ kind: block.kind, heading: block.heading, title: block.title, intro: block.intro, inFlight: block.inFlight,
  steps: block.steps.map(step => [step.key, step.emphasis, step.label, ...step.caption]) });

const PROMO = 'โปรแถมเดือน Starter';
const RESERVED = `จองสิทธิ์โปรโมชั่น ${PROMO} ไว้ให้รายการนี้แล้ว สิทธิ์เริ่มใช้เมื่อชำระเงินสำเร็จ`;
const RIGHT_BACK = 'สิทธิ์โปรโมชั่นที่จองไว้จะถูกคืน เลือกใช้ใหม่ได้ถ้าโปรโมชั่นยังเปิดอยู่';
const UNPAID_PAGE = 'เปิดหน้าชำระเงินไว้แล้ว แต่ระบบยังไม่ได้รับผลการชำระเงิน';
const OPEN = 'มีรายการชำระเงินที่ยังไม่เสร็จ', WAITING = 'กำลังรอผลการชำระเงินจากผู้ให้บริการรับชำระเงิน', CHECKING = 'กำลังตรวจสอบรายการชำระเงิน', RECEIVED_TITLE = 'ระบบได้รับเงินแล้ว ไม่ต้องชำระซ้ำ', LAST = 'ผลการชำระเงินล่าสุด';
const AUTO = 'ระบบตรวจผลให้อัตโนมัติ ไม่ต้องชำระซ้ำ', CONTACT = 'ถ้าตรวจแล้วยังไม่ชัดเจน ให้ติดต่อทีมงานพร้อมเลขอ้างอิง';
const ASKING = 'ระบบถามผู้ให้บริการรับชำระเงินอยู่ ยังไม่ต้องเริ่มรายการใหม่';
const CONTINUE = ['continue', 'primary', 'ชำระเงินต่อ'];
const CANCEL_NEW = ['cancel', 'quiet', 'ยกเลิกรายการนี้ แล้วเลือกแพ็กเกจใหม่', 'รายการเดิมจะถูกยกเลิก'];
const KEPT = 'แพ็กเกจที่ใช้อยู่ไม่เปลี่ยน';
const CHECK_CAUTION = 'ระบบยังยืนยันผลจากผู้ให้บริการรับชำระเงินไม่ได้ กดตรวจก่อนชำระใหม่ เพื่อไม่ให้ชำระซ้ำ';
const CONTINUE_CAUTION = 'ใช้เมื่อแน่ใจว่ายังไม่ได้ชำระ เปิดหน้าชำระเงินเดิมเพื่อจ่ายให้เสร็จ';
const CANCEL_TWO_STEP = ['cancel', 'quiet', 'ยกเลิกรายการนี้', 'ระบบจะตรวจผลกับผู้ให้บริการรับชำระเงินก่อน จึงเลือกแพ็กเกจใหม่ได้'];
const CHECK_NOW = ['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเมื่ออยากให้ตรวจผลทันที'];
const CHECK_LATEST = ['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเมื่ออยากตรวจผลล่าสุด'];
const CHECK_AGAIN = ['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเมื่อจ่ายเงินแล้ว เพื่อตรวจผลล่าสุดอีกครั้ง'];

// Every state the page's own flags can put the package page in, and exactly what the buyer is shown there. `heading` is the card's own heading while the payment leads the card (null = the
// page's heading about the package stands), `title` the block's own title where the heading is about something else; the payment's words are said once, in one of the two.
const TABLE: { name: string; input: PendingPaymentInput; expect: ReturnType<typeof shown> }[] = [
  { name: 'nothing in progress: today\'s page, today\'s one button', input: input(), expect: null },
  { name: 'a purchase that is not started and no payment to check', input: input({ paymentState: 'NONE', hasPackage: true }), expect: null },

  { name: 'open unpaid page, no package, no promotion (the owner\'s screenshot, without the reserved box)', input: input({ paymentState: 'PENDING', hasAttempt: true, canEnd: true, canCheck: true }),
    expect: { kind: 'OPEN', heading: OPEN, title: null, intro: [UNPAID_PAGE], inFlight: true, steps: [
      [...CONTINUE, 'เปิดหน้าชำระเงินเดิมเพื่อจ่ายให้เสร็จ'],
      ['check', 'secondary', 'ชำระแล้ว ตรวจผลการชำระเงิน', 'กดเมื่อจ่ายเงินแล้วแต่หน้านี้ยังไม่เปลี่ยน'],
      CANCEL_NEW] } },
  { name: 'open unpaid page with a promotion right reserved: said in the block, and given back on cancel', input: input({ paymentState: 'PENDING', hasAttempt: true, canEnd: true, canCheck: true, reservedPromotion: PROMO }),
    expect: { kind: 'OPEN', heading: OPEN, title: null, intro: [UNPAID_PAGE, RESERVED], inFlight: true, steps: [
      [...CONTINUE, 'เปิดหน้าชำระเงินเดิมเพื่อจ่ายให้เสร็จ'],
      ['check', 'secondary', 'ชำระแล้ว ตรวจผลการชำระเงิน', 'กดเมื่อจ่ายเงินแล้วแต่หน้านี้ยังไม่เปลี่ยน'],
      [...CANCEL_NEW, RIGHT_BACK]] } },
  { name: 'open unpaid page of a shop with a running package: it is told its package does not change', input: input({ paymentState: 'PENDING', hasAttempt: true, canEnd: true, canCheck: true, hasPackage: true }),
    expect: { kind: 'OPEN', heading: OPEN, title: null, intro: [UNPAID_PAGE], inFlight: true, steps: [
      [...CONTINUE, 'เปิดหน้าชำระเงินเดิมเพื่อจ่ายให้เสร็จ'],
      ['check', 'secondary', 'ชำระแล้ว ตรวจผลการชำระเงิน', 'กดเมื่อจ่ายเงินแล้วแต่หน้านี้ยังไม่เปลี่ยน'],
      [...CANCEL_NEW, KEPT]] } },
  { name: 'open unpaid page, running package and a reserved right', input: input({ paymentState: 'PENDING', hasAttempt: true, canEnd: true, canCheck: true, hasPackage: true, reservedPromotion: PROMO }),
    expect: { kind: 'OPEN', heading: OPEN, title: null, intro: [UNPAID_PAGE, RESERVED], inFlight: true, steps: [
      [...CONTINUE, 'เปิดหน้าชำระเงินเดิมเพื่อจ่ายให้เสร็จ'],
      ['check', 'secondary', 'ชำระแล้ว ตรวจผลการชำระเงิน', 'กดเมื่อจ่ายเงินแล้วแต่หน้านี้ยังไม่เปลี่ยน'],
      [...CANCEL_NEW, RIGHT_BACK, KEPT]] } },

  { name: 'outcome UNKNOWN: check the result first, paying again only when sure; ending keeps its confirmation', input: input({ paymentState: 'UNKNOWN', hasAttempt: true, canEnd: true, canCheck: true }),
    expect: { kind: 'OPEN', heading: OPEN, title: null, intro: ['ระบบยังยืนยันผลการชำระเงินรายการนี้ไม่ได้'], inFlight: true, steps: [
      ['check', 'primary', 'ตรวจผลการชำระเงิน', CHECK_CAUTION],
      ['continue', 'secondary', 'ชำระเงินต่อ', CONTINUE_CAUTION],
      CANCEL_TWO_STEP] } },
  { name: 'outcome UNKNOWN with a reserved right: it is returned only if nothing was paid', input: input({ paymentState: 'UNKNOWN', hasAttempt: true, canEnd: true, canCheck: true, reservedPromotion: PROMO, hasPackage: true }),
    expect: { kind: 'OPEN', heading: OPEN, title: null, intro: ['ระบบยังยืนยันผลการชำระเงินรายการนี้ไม่ได้', RESERVED], inFlight: true, steps: [
      ['check', 'primary', 'ตรวจผลการชำระเงิน', CHECK_CAUTION],
      ['continue', 'secondary', 'ชำระเงินต่อ', CONTINUE_CAUTION],
      [...CANCEL_TWO_STEP, `ถ้ายังไม่ได้ชำระ ${RIGHT_BACK}`, KEPT]] } },
  { name: 'ACTION_REQUIRED: continue at the payment page first', input: input({ paymentState: 'ACTION_REQUIRED', hasAttempt: true, canEnd: true, canCheck: true }),
    expect: { kind: 'OPEN', heading: OPEN, title: null, intro: ['การชำระเงินรายการนี้ยังต้องทำขั้นตอนเพิ่มที่หน้าชำระเงิน'], inFlight: true, steps: [
      [...CONTINUE, 'เปิดหน้าชำระเงินเดิมเพื่อทำขั้นตอนที่เหลือให้เสร็จ'],
      ['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเมื่อทำขั้นตอนที่หน้าชำระเงินเสร็จแล้วแต่หน้านี้ยังไม่เปลี่ยน'],
      CANCEL_TWO_STEP] } },
  { name: 'FAILED with the page still open (a charge failed): try again at the payment page first', input: input({ paymentState: 'FAILED', hasAttempt: true, canEnd: true, canCheck: true }),
    expect: { kind: 'OPEN', heading: OPEN, title: null, intro: ['ระบบแจ้งว่าการเก็บเงินครั้งล่าสุดไม่สำเร็จ และหน้าชำระเงินนี้ยังเปิดค้างอยู่'], inFlight: true, steps: [
      [...CONTINUE, 'เปิดหน้าชำระเงินเดิมเพื่อลองชำระอีกครั้ง'],
      ['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเมื่อจ่ายเงินแล้วแต่หน้านี้ยังไม่เปลี่ยน'],
      CANCEL_TWO_STEP] } },
  { name: 'back from the payment page after finishing there, no answer (the wait gave up): check first, the buyer may well have paid, and the team is the way out when checking does not settle it',
    input: input({ paymentState: 'PENDING', hasAttempt: true, canEnd: true, canCheck: true, unconfirmed: true }),
    expect: { kind: 'OPEN', heading: OPEN, title: null, intro: [`กลับจากหน้าชำระเงินแล้ว แต่ระบบยังยืนยันผลการชำระเงินไม่ได้ ${CONTACT}`], inFlight: true, steps: [
      ['check', 'primary', 'ตรวจผลการชำระเงิน', CHECK_CAUTION],
      ['continue', 'secondary', 'ชำระเงินต่อ', CONTINUE_CAUTION],
      CANCEL_NEW] } },
  { name: 'an open page the buyer can only end (no result to check, nothing to resume)', input: input({ paymentState: 'NONE', hasAttempt: true, canEnd: true }),
    expect: { kind: 'OPEN', heading: OPEN, title: null, intro: ['มีหน้าชำระเงินที่เปิดค้างอยู่'], inFlight: true, steps: [CANCEL_TWO_STEP] } },

  { name: 'waiting for the first answer after the payment page, no package: the heading says it, the block adds that the page checks by itself', input: input({ paymentState: 'PENDING', hasAttempt: true, awaiting: true, canCheck: true }),
    expect: { kind: 'WAITING', heading: WAITING, title: null, intro: [AUTO], inFlight: true, steps: [CHECK_NOW] } },
  { name: 'waiting, with a running package: the same words, there is no second version for it', input: input({ paymentState: 'PENDING', hasAttempt: true, awaiting: true, canCheck: true, hasPackage: true }),
    expect: { kind: 'WAITING', heading: WAITING, title: null, intro: [AUTO], inFlight: true, steps: [CHECK_NOW] } },
  { name: 'waiting with a reserved right', input: input({ paymentState: 'PENDING', hasAttempt: true, awaiting: true, canCheck: true, reservedPromotion: PROMO }),
    expect: { kind: 'WAITING', heading: WAITING, title: null, intro: [AUTO, RESERVED], inFlight: true, steps: [CHECK_NOW] } },
  { name: 'waiting and nothing to press (the check is not offered): the heading and the sentence still say what is happening', input: input({ paymentState: 'PENDING', hasAttempt: true, awaiting: true }),
    expect: { kind: 'WAITING', heading: WAITING, title: null, intro: [AUTO], inFlight: true, steps: [] } },

  { name: 'paid and being applied: the check alone, and never a way to pay again', input: input({ paymentState: 'PAID', hasAttempt: true, moneyReceived: true, canCheck: true }),
    expect: { kind: 'RECEIVED', heading: null, title: RECEIVED_TITLE, intro: [], inFlight: true, steps: [CHECK_LATEST] } },
  { name: 'a renewal still being set up after the payment (a running package): the promotion\'s own box already says "ชำระแล้ว … ไม่ต้องชำระซ้ำ", so the block has no title', input: input({ paymentState: 'PAID', renewalSetup: true, canCheck: true, hasPackage: true }),
    expect: { kind: 'RECEIVED', heading: null, title: null, intro: [], inFlight: true, steps: [CHECK_LATEST] } },
  { name: 'received money AND a renewal being set up: the money decides, so the title stays', input: input({ paymentState: 'PAID', hasAttempt: true, moneyReceived: true, renewalSetup: true, canCheck: true, hasPackage: true }),
    expect: { kind: 'RECEIVED', heading: null, title: RECEIVED_TITLE, intro: [], inFlight: true, steps: [CHECK_LATEST] } },

  { name: 'a past-due or unpaid subscription (the last charge failed, no payment page open): the heading says it, the check alone; a new purchase stays reachable', input: input({ paymentState: 'FAILED', canCheck: true, hasPackage: true }),
    expect: { kind: 'FAILED', heading: null, title: LAST, intro: [], inFlight: false, steps: [CHECK_AGAIN] } },
  { name: 'the return page of an attempt that failed (the attempt is over, the status names none): the check alone, and the way to a new purchase stays', input: input({ paymentState: 'NONE', failed: true, canCheck: true }),
    expect: { kind: 'FAILED', heading: null, title: LAST, intro: [], inFlight: false, steps: [CHECK_AGAIN] } },
  { name: 'the same page while a newer attempt of the shop is in flight (another tab): the payment in flight decides, nothing new is started', input: input({ paymentState: 'PENDING', hasAttempt: true, failed: true, canCheck: true }),
    expect: { kind: 'CHECKING', heading: CHECKING, title: null, intro: [ASKING], inFlight: true, steps: [['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเพื่อให้ระบบตรวจผลล่าสุดกับผู้ให้บริการรับชำระเงิน']] } },
  { name: 'an attempt being checked, no page to resume or end: wait, do not start another', input: input({ paymentState: 'PENDING', hasAttempt: true, canCheck: true }),
    expect: { kind: 'CHECKING', heading: CHECKING, title: null, intro: [ASKING], inFlight: true, steps: [['check', 'secondary', 'ตรวจผลการชำระเงิน', 'กดเพื่อให้ระบบตรวจผลล่าสุดกับผู้ให้บริการรับชำระเงิน']] } },
  { name: 'an attempt whose outcome is unknown and has no page: the check leads', input: input({ paymentState: 'UNKNOWN', hasAttempt: true, canCheck: true, reservedPromotion: PROMO }),
    expect: { kind: 'CHECKING', heading: CHECKING, title: null, intro: [ASKING, RESERVED], inFlight: true, steps: [['check', 'primary', 'ตรวจผลการชำระเงิน', 'ระบบยังยืนยันผลไม่ได้ กดตรวจก่อนชำระใหม่ เพื่อไม่ให้ชำระซ้ำ']] } },
  { name: 'back from the payment page, an attempt with no page to resume, the answer never came: the way out is the team, said once, in the block', input: input({ paymentState: 'PENDING', hasAttempt: true, canCheck: true, unconfirmed: true }),
    expect: { kind: 'CHECKING', heading: CHECKING, title: null, intro: [`${ASKING} ${CONTACT}`], inFlight: true, steps: [['check', 'primary', 'ตรวจผลการชำระเงิน', 'ระบบยังยืนยันผลไม่ได้ กดตรวจก่อนชำระใหม่ เพื่อไม่ให้ชำระซ้ำ']] } },
  { name: 'an old paid record on a shop whose package ran out: the check stays, with a sentence true whatever happened before', input: input({ paymentState: 'PAID', canCheck: true }),
    expect: { kind: 'RECHECK', heading: null, title: LAST, intro: [], inFlight: false, steps: [['check', 'secondary', 'ตรวจผลการชำระเงิน', 'ให้ระบบถามผู้ให้บริการรับชำระเงินอีกครั้งว่ามีผลล่าสุดหรือไม่']] } },
];

test('the state table: heading or title, what is waiting, the choices in order with their purpose and emphasis, and what gives way', () => {
  for (const row of TABLE) assert.deepEqual(shown(pendingPayment(row.input)), row.expect, row.name);
  assert.ok(TABLE.length >= 25);
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
/** What the block says in its own words, the heading included; captions belong to a choice and are listed apart. */
const statements = (block: PendingPayment) => [...(block.heading ? [block.heading] : []), ...(block.title ? [block.title] : []), ...block.intro];
const words = (block: PendingPayment) => [...statements(block), ...block.steps.flatMap(step => step.caption)];
const label = (name: string, flags: PendingPaymentInput) => `${name} :: ${JSON.stringify(flags)}`;
const IN_FLIGHT: PendingKind[] = ['OPEN', 'WAITING', 'RECEIVED', 'CHECKING'], LEADS: PendingKind[] = ['OPEN', 'WAITING', 'CHECKING'];
/** The button names a sentence may tell the buyer to press ("กด…"), and the label that has to be on the screen for the sentence to be true. */
const PRESSES: [string, string][] = [['กดลองใหม่', 'ลองใหม่'], ['กดอัปเดตข้อมูล', 'อัปเดตข้อมูล'], ['กดตรวจสถานะล่าสุด', 'ตรวจสถานะล่าสุด'], ['กดตรวจผลการชำระเงิน', PENDING_TEXT.labelCheck], ['กดชำระเงินต่อ', PENDING_TEXT.labelContinue]];
/** What the block offers: its choices, and the "อัปเดตข้อมูล" that comes with the answer of the check. */
const offered = (block: PendingPayment) => [...block.steps.map(step => step.label), ...(block.steps.some(step => step.key === 'check') ? ['อัปเดตข้อมูล'] : [])];

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
    // the payment's words are said once: in the card's heading (while the payment leads) or in the block's title, never both, and the kinds say it the same way every time
    assert.ok(!(block.heading && block.title), at('a heading and a title are never both'));
    assert.equal(block.heading !== null, LEADS.includes(block.kind), at('the block leads the card exactly while the payment waits for the buyer or the provider'));
    if (block.title === null && block.heading === null) assert.equal(block.kind, 'RECEIVED', at('only a renewal being set up has no words of its own: the promotion box says them'));
    assert.equal(block.inFlight, IN_FLIGHT.includes(block.kind), at('the generic button, the invitation, the amber alert and an empty box give way exactly while a payment is open or in flight'));
    if (flags.canCheck) assert.ok(keys.includes('check'), at('the check control is never lost'));
    const received = flags.moneyReceived || flags.renewalSetup;
    if (flags.canEnd && !received) assert.ok(keys.includes('cancel'), at('the open payment can still be ended'));
    if (received) assert.ok(!keys.includes('cancel') && !keys.includes('continue'), at('a payment the provider has is neither paid again nor thrown away'));
    // a plain screen: no id, enum key, code or JavaScript word
    for (const text of [...words(block), ...block.steps.map(step => step.label)]) assert.doesNotMatch(text, /[A-Z]{3,}_[A-Z]|undefined|\bnull\b|NaN|\[object/, at(`machine token in ${text}`));
    // money: "paid" and "no need to pay again" are said only when money was received (the wait after the payment page may say the second)
    for (const text of statements(block)) {
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
    // the reserved right: said in the block only where the payment is not yet received, and only when there is one, and once
    const said = words(block).filter(text => text.includes(PROMO));
    assert.equal(said.length > 0, block.showsReservedPromotion, at('the right is said exactly when the green box may stay quiet'));
    assert.ok(statements(block).filter(text => text === RESERVED).length <= 1, at('the reservation is said once'));
    if (block.showsReservedPromotion) { assert.ok(flags.reservedPromotion, at('a right to say')); assert.ok(['OPEN', 'WAITING', 'CHECKING'].includes(block.kind), at('said only while unpaid')); }
    else assert.ok(!words(block).some(text => /จองสิทธิ์|สิทธิ์โปรโมชั่นที่จองไว้/.test(text)), at('no right said without one'));
    if (flags.reservedPromotion && ['OPEN', 'WAITING', 'CHECKING'].includes(block.kind)) assert.ok(block.showsReservedPromotion, at('a reserved right is always said where it is held'));
    // what gives way
    if (received || flags.canEnd || flags.awaiting) assert.ok(block.inFlight, at('never an invitation to buy while paid or open'));
    assert.equal(block.tone, block.kind === 'OPEN' ? 'attention' : block.kind === 'RECEIVED' ? 'ok' : 'neutral', at('tone'));
    // one statement per fact: no two of the block's own sentences are the same or hold one another, and no choice's line repeats one of them
    const own = statements(block);
    for (const [index, text] of own.entries()) for (const other of own.slice(index + 1)) assert.ok(text !== other && !text.includes(other) && !other.includes(text), at(`"${text}" and "${other}" are one fact`));
    for (const line of block.steps.flatMap(step => step.caption)) assert.ok(!own.includes(line), at(`a caption repeats the block's own sentence: ${line}`));
    // the way to the team is said once, and only where the answer never came
    assert.ok(own.filter(text => text.includes(CONTACT)).length <= (flags.unconfirmed && ['OPEN', 'CHECKING'].includes(block.kind) ? 1 : 0), at('the contact line'));
    if (flags.unconfirmed && ['OPEN', 'CHECKING'].includes(block.kind)) assert.equal(own.filter(text => text.includes(CONTACT)).length, 1, at('the contact line is there'));
    // no sentence names a button that is not offered
    for (const text of words(block)) for (const [phrase, needed] of PRESSES) if (text.includes(phrase)) assert.ok(offered(block).includes(needed), at(`"${text}" names "${needed}", which is not offered`));
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

// ---- round 4: what the card shows AROUND the block, kind by kind ----
// The page draws the card from these flags only (the page pins below tie each to its place in BillingPage.tsx). Top to bottom on a phone, for a shop with no package:
//   OPEN / WAITING / CHECKING  heading (the block's) · badge · block (leading) · [expired shop only: the date its package ended] · reference
//   RECEIVED                   heading (the page's: "ชำระแล้ว กำลังตรวจสอบการเปิดสิทธิ์" …) · badge · block (title + check) · reference
//   FAILED / RECHECK           heading (the page's) · badge · package box with its invitation · block · the generic button · reference
// and for a shop whose package runs: the same, with the package's facts and notes AFTER a leading block, and before any other block, as they always were.
const AROUND: Record<PendingKind, { headingFrom: 'block' | 'page'; blockLeads: boolean; gaveWay: string[] }> = {
  OPEN: { headingFrom: 'block', blockLeads: true, gaveWay: ['the generic button', 'the invitation', 'the amber alert', 'a box with only the badge\'s words'] },
  WAITING: { headingFrom: 'block', blockLeads: true, gaveWay: ['the generic button', 'the invitation', 'the amber alert', 'a box with only the badge\'s words'] },
  CHECKING: { headingFrom: 'block', blockLeads: true, gaveWay: ['the generic button', 'the invitation', 'the amber alert', 'a box with only the badge\'s words'] },
  RECEIVED: { headingFrom: 'page', blockLeads: false, gaveWay: ['the generic button', 'the invitation', 'the amber alert', 'a box with only the badge\'s words'] },
  FAILED: { headingFrom: 'page', blockLeads: false, gaveWay: [] },
  RECHECK: { headingFrom: 'page', blockLeads: false, gaveWay: [] },
};
const around = (block: PendingPayment) => ({ headingFrom: block.heading ? 'block' : 'page', blockLeads: block.heading !== null,
  gaveWay: block.inFlight ? ['the generic button', 'the invitation', 'the amber alert', 'a box with only the badge\'s words'] : [] });

test('what the card shows around the block, per kind: who owns the heading, where the block sits, what gave way', () => {
  const seen = new Set<string>();
  for (const flags of everyCombination()) { const block = pendingPayment(flags); if (!block) continue; seen.add(block.kind); assert.deepEqual(around(block), AROUND[block.kind], label(block.kind, flags)); }
  assert.deepEqual([...seen].sort(), Object.keys(AROUND).sort());
  // the heading the card gets while the payment leads is the one asserted by the browser: true for the state, and nothing else says it
  assert.deepEqual([OPEN, WAITING, CHECKING], [PENDING_TEXT.titleOpen, PENDING_TEXT.headingWaiting, PENDING_TEXT.headingChecking]);
  assert.equal(PENDING_TEXT.headingChecking, 'กำลังตรวจสอบรายการชำระเงิน', 'the words the card already used while a payment was being checked');
  assert.equal(PENDING_TEXT.headingWaiting, 'กำลังรอผลการชำระเงินจากผู้ให้บริการรับชำระเงิน', 'the line of the gray waiting box, now the heading');
  // an open unpaid page is no longer headed "checking": the system waits for the buyer, and the heading says so
  assert.doesNotMatch(PENDING_TEXT.titleOpen, /ตรวจ/);
});

test('the amber alert that is left (no block says it) names the button it really has, and the red banner keeps its own retry', () => {
  assert.equal(PENDING_TEXT.alertCheckoutPending, 'ระบบกำลังตรวจรายการชำระเงินเดิมกับผู้ให้บริการรับชำระเงิน กรุณารอสักครู่แล้วกดตรวจสถานะล่าสุด');
  assert.ok(PENDING_TEXT.alertCheckoutPending.includes('กดตรวจสถานะล่าสุด'));
  assert.ok(!PENDING_TEXT.alertCheckoutPending.includes('ลองใหม่'));
  // the shared text keeps saying "ลองใหม่": the red banner that carries it has that button
  assert.match(errorText({ code: 'BILLING_CHECKOUT_PENDING' }), /กดลองใหม่$/);
});

// ---- the page draws what the logic returns, and does what it always did ----
const page = readFileSync(new URL('./BillingPage.tsx', import.meta.url), 'utf8');
const display = readFileSync(new URL('./billing-display.ts', import.meta.url), 'utf8');
const pendingSection = page.slice(page.indexOf('const pendingSection = ('), page.indexOf('  return <BillingCustomerFrame'));
const at = (text: string) => { const index = page.indexOf(text); assert.ok(index > 0, text); return index; };
const count = (text: string, part: string) => text.split(part).length - 1;

test('the card: the block leads under its own heading, the package area follows, the other block comes after the notes, the generic button and the repeats give way, the reference is the last thing', () => {
  const heading = at('<h2 className="text-lg font-bold">{pending?.heading ?? (returnFailed'), lead = at('{pending && pendingLeads && pendingSection(status, pending)}'), box = at('{noPackage ? (pending?.inFlight && !(lockReason === \'trial_ended\' && status.termEndsAt) ? null : <dl'),
    later = at('{pending && pendingShown && !pendingLeads && pendingSection(status, pending)}'), generic = at("{status.allowedActions.includes('new_sales') && !pending?.inFlight && <button"),
    reference = at('{supportReference && !confirmed && !applyHeld && <details'), cardEnd = at("<div hidden={section !== 'payment'}");
  assert.ok(heading < lead && lead < box && box < later && later < generic && generic < reference && reference < cardEnd, 'heading, the leading block, the package area, the other block, the generic button, then the reference');
  assert.equal(count(page, 'เลขอ้างอิงสำหรับแจ้งทีมงาน</summary>'), 1, 'the collapsed reference exists once');
  // the heading chain is the page's own, untouched, behind the block's heading
  assert.match(page, /\{pending\?\.heading \?\? \(returnFailed \? 'รายการชำระเงินนี้ไม่สำเร็จ' : status\.pendingDeal \?/);
  assert.match(page, /: status\.attemptId \? 'กำลังตรวจสอบรายการชำระเงิน' : packageHeading\)\}<\/h2>/);
  // what is derived, once
  assert.match(page, /const pendingShown = !!pending && !!\(pending\.heading \|\| pending\.title \|\| pending\.intro\.length > 0 \|\| pending\.steps\.length > 0\);/);
  assert.match(page, /const pendingLeads = pendingShown && !!pending\?\.heading;/);
  // the invitation gives way (no pointer stands in its place: the block says it), the reserved right is said in the block, and the amber alert goes for every kind that is in flight
  assert.match(page, /const purchaseHint = pending\?\.inFlight \? null : canBuy \|\| oneTapCancel \?/);
  assert.match(page, /\{promotionBlock && !pending\?\.showsReservedPromotion && <section role="status" aria-label="สถานะโปรโมชั่น"/);
  assert.match(page, /\{status\.purchaseBlockCode && !\(status\.purchaseBlockCode === 'BILLING_CHECKOUT_PENDING' && pendingShown && pending\?\.inFlight\) && <div role="alert"/);
  assert.match(page, /<p>\{status\.purchaseBlockCode === 'BILLING_CHECKOUT_PENDING' \? PENDING_TEXT\.alertCheckoutPending : errorText\(\{ code: status\.purchaseBlockCode \}\)\}<\/p>/);
  assert.match(page, />ตรวจสถานะล่าสุด<\/button>/, 'the button the alert\'s sentence names');
  // what is gone: the gray waiting box, the pointer, the old paragraph, and every field of the block that existed only for them
  for (const gone of ['noPackage && awaitingStripe', 'ระบบตรวจผลให้อัตโนมัติ', 'กำลังรอผลการชำระเงินจากผู้ให้บริการรับชำระเงิน', 'ยังยืนยันผลไม่ได้ กรุณาตรวจสอบรายการเดิมก่อนชำระใหม่', 'pending.pointer', 'hidePurchaseHint', 'hideChoosePackage', 'timedOut && !status.pendingDeal'])
    assert.equal(count(page, gone), 0, gone);
  // the flags the logic is given are the page's own, unchanged
  assert.match(page, /pendingPayment\(\{ paymentState: status\.paymentState, hasAttempt: !!status\.attemptId, awaiting: awaitingStripe, unconfirmed: returning && !checkoutCanceled && !awaitingStripe,/);
  assert.match(page, /canEnd: canEndCheckout, canResume: canResumePayment, oneTap: oneTapCancel, canCheck: !!hasPaymentToCheck, moneyReceived: paidNotApplied, renewalSetup: !!promotionBlock\?\.checking,/);
  assert.match(page, /failed: returnFailed, hasPackage: !noPackage, reservedPromotion: promotionReservedName\(promotionUse\) \}\) : null;/);
  // the three derived flags keep their old definitions (the block decides wording only)
  assert.match(page, /const canEndCheckout = !awaitingStripe && Boolean\(status\?\.canCancelCheckout && status\.attemptId\);/);
  assert.match(page, /const canResumePayment = canEndCheckout && \['PENDING', 'FAILED', 'UNKNOWN', 'ACTION_REQUIRED'\]\.includes\(status!\.paymentState\);/);
  assert.match(page, /const oneTapCancel = canEndCheckout && status!\.paymentState === 'PENDING';/);
});

test('the markup: a region named by its heading, an ordered list, a control and its purpose tied together, 44px controls that fill a phone', () => {
  assert.match(pendingSection, /<section aria-label=\{block\.heading \?\? block\.title \?\? PENDING_TEXT\.regionName\} className=\{`space-y-4 rounded-xl border p-4 \$\{PENDING_TONE\[block\.tone\]\}`\}>/);
  assert.match(pendingSection, /\{block\.title && <h3 className="text-lg font-bold text-gray-900">\{block\.title\}<\/h3>\}/);
  assert.match(pendingSection, /<ol className="space-y-4">/);
  assert.match(pendingSection, /<li key=\{step\.key\} className="space-y-2">/);
  assert.match(pendingSection, /<button type="button" className=\{STEP_CLASS\[step\.emphasis\]\} disabled=\{busy\} aria-busy=\{busy\} aria-describedby=\{ids\.join\(' '\)\} onClick=\{run\[step\.key\]\}>\{step\.label\}<\/button>/);
  assert.match(pendingSection, /\{step\.caption\.map\(\(line, index\) => <p key=\{line\} id=\{ids\[index\]\} className="break-words text-sm leading-6 text-gray-600">\{line\}<\/p>\)\}/);
  assert.match(pendingSection, /const ids = step\.caption\.map\(\(_, index\) => `\$\{pendingId\}-\$\{step\.key\}-\$\{index\}`\);/);
  // each control is at least 44px and full width until sm; only the first is green (the page's own primary class), and only giving up is quiet
  assert.match(page, /primary: `\$\{billingPrimaryControl\} w-full sm:w-auto`,\s*secondary: `\$\{billingControl\} w-full sm:w-auto`,\s*quiet: 'inline-flex min-h-11 w-full items-center justify-start rounded-xl /);
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
  // the follow-up of a check ("update the information") stays attached to the check choice, inside the one status that is the answer
  assert.match(pendingSection, /\{step\.key === 'check' && refreshNotice && <div ref=\{refreshAnswer\} tabIndex=\{-1\} role="status" className="scroll-mt-\[calc\(var\(--app-header-h,0px\)\+1\.5rem\)\] space-y-2">\s*<p className="text-sm leading-6 text-gray-700">\{refreshNotice\}<\/p>/);
  assert.match(pendingSection, /className="mangmee-btn mangmee-btn-secondary w-full sm:w-auto" disabled=\{busy\} onClick=\{\(\) => setReload\(value => value \+ 1\)\}>อัปเดตข้อมูล<\/button>/);
  assert.equal(count(pendingSection, 'role="status"'), 1, 'one status, not two nested');
});

test('item 5: the quiet choice starts where its captions start and wraps balanced', () => {
  const quiet = /quiet: '([^']+)'/.exec(page)![1]!.split(/\s+/);
  for (const needed of ['min-h-11', 'w-full', 'sm:w-auto', 'justify-start', 'text-left', '[text-wrap:balance]', 'underline']) assert.ok(quiet.includes(needed), needed);
  // no inset from the side (it was `px-4`: 16px right of the captions from sm up), and not centered (it was centered at 390 while the captions are left-aligned)
  assert.ok(!quiet.some(name => /^(sm:)?px-/.test(name)), 'no horizontal padding');
  assert.ok(!quiet.includes('justify-center') && !quiet.includes('text-center'));
  // the captions under it are left-aligned text with no inset either
  assert.match(pendingSection, /className="break-words text-sm leading-6 text-gray-600"/);
});

test('every handler does what the loose button of the same job did, and the four old labels are gone from the page', () => {
  // the three provider calls, each in the one place that serves its choice (the 30-second background refresh is a fifth, untouched)
  assert.equal(count(pendingSection, 'api.resume(status.attemptId!)'), 1);
  assert.equal(count(pendingSection, 'api.refresh()'), 1);
  assert.equal(count(pendingSection, 'api.cancelCheckout(status.attemptId!)'), 2, 'one-tap end and the confirmed end');
  assert.equal(count(page, 'api.resume('), 1);
  assert.equal(count(page, 'api.cancelCheckout('), 2);
  // the notices the handlers set are the ones the e2e specs and the buyers already know
  for (const notice of ['หน้าชำระเงินเดิมเปิดต่อไม่ได้แล้ว ระบบกำลังตรวจผลรายการเดิม กรุณารอสักครู่แล้วกดอัปเดตข้อมูล', 'ยกเลิกรายการเดิมแล้ว เลือกแพ็กเกจใหม่ได้เลย',
    'รายการเดิมชำระสำเร็จแล้ว ระบบกำลังเปิดสิทธิ์ให้ ไม่ต้องซื้อใหม่', 'กำลังตรวจผลรายการเดิมกับผู้ให้บริการรับชำระเงิน กรุณารอสักครู่แล้วกดอัปเดตข้อมูล', 'ยกเลิกรายการแล้ว เลือกแพ็กเกจใหม่ได้',
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
  assert.match(page, /const errorBanner = useRef<HTMLDivElement>\(null\), checkoutNotice = useRef<HTMLDivElement>\(null\), refreshAnswer = useRef<HTMLDivElement>\(null\);/);
  assert.match(page, /\{error && <div ref=\{errorBanner\} tabIndex=\{-1\} role="alert" className="scroll-mt-\[calc\(var\(--app-header-h,0px\)\+1\.5rem\)\] space-y-2 rounded-xl border border-red-200 bg-red-50 p-4">/);
  assert.match(page, /useEffect\(\(\) => \{ if \(error && !RECIPIENT_ERROR_CODES\.includes\(errorCode \?\? ''\)\) \{ errorBanner\.current\?\.scrollIntoView\(\{ block: 'nearest' \}\); errorBanner\.current\?\.focus\(\{ preventScroll: true \}\); \} \}, \[error, errorCode\]\);/);
  // the same for the notice after ending or resuming a payment (not stealing the scroll when it is already in view)
  assert.match(page, /\{checkoutCancelNotice && <div ref=\{checkoutNotice\} tabIndex=\{-1\} role="status" className="scroll-mt-\[calc\(var\(--app-header-h,0px\)\+1\.5rem\)\] /);
  // the recipient errors still go to the email panel
  assert.match(page, /useEffect\(\(\) => \{ if \(error && RECIPIENT_ERROR_CODES\.includes\(errorCode \?\? ''\)\) \{ setSection\('payment'\); emailSettings\.current\?\.scrollIntoView\(\{ block: 'start' \}\); \} \}, \[error, errorCode\]\);/);
});

// ---- D12: the answer of the check is seen where the button was pressed ----
test('D12 wiring: the answer of "ตรวจผลการชำระเงิน" takes a ref, focus and the header scroll margin, and is brought into view only when it is not already visible', () => {
  assert.match(page, /useEffect\(\(\) => \{ if \(refreshNotice\) \{ refreshAnswer\.current\?\.scrollIntoView\(\{ block: 'nearest' \}\); refreshAnswer\.current\?\.focus\(\{ preventScroll: true \}\); \} \}, \[refreshNotice\]\);/);
  assert.equal(count(page, 'ref={refreshAnswer}'), 1);
  assert.equal(count(page, 'refreshAnswer.current'), 2);
  // the answer is still inside the choice that was pressed, so the browser lane's "right under the choice" holds
  assert.ok(pendingSection.indexOf('ref={refreshAnswer}') > pendingSection.indexOf("step.key === 'check' && refreshNotice"));
});

// ---- D13 and every other notice against every effect that scrolls ----
/** The scroll/focus effects of the page, in the order they are declared (the order React runs them in, within one commit): the name of the element they bring into view and the state they depend on. */
const scrollEffects = page.split('\n').flatMap(line => {
  const found = /^\s*useEffect\(\(\) => \{(.+)\}, \[([^\]]*)\]\);\s*$/.exec(line);
  if (!found || !found[1]!.includes('scrollIntoView')) return [];
  const target = /(\w+)\.current\?\.scrollIntoView/.exec(found[1]!)![1]!;
  return [{ target: found[1]!.includes('RECIPIENT_ERROR_CODES.includes') && !found[1]!.includes('!RECIPIENT_ERROR_CODES') ? 'recipient error' : target, deps: found[2]!.split(',').map(dep => dep.trim()).filter(Boolean) }];
});
/** What runs, in order, in a commit where these states changed. The recipient destination is left out: it scrolls for its own four codes only, which the banner effect refuses (pinned in D10). */
const ran = (...changed: string[]) => scrollEffects.filter(effect => effect.target !== 'recipient error' && effect.deps.some(dep => changed.includes(dep))).map(effect => effect.target);

test('D13: the effect order — cadence notice, chooser heading, lost-promotion notice, banner, cancel notice, the answer of the check, then the recipient destinations', () => {
  assert.deepEqual(scrollEffects.map(effect => effect.target), ['cadenceNoticeRef', 'backNavigation', 'lostNotice', 'errorBanner', 'checkoutNotice', 'refreshAnswer', 'recipient error', 'emailSettings']);
  assert.deepEqual(scrollEffects.map(effect => effect.deps), [['cadenceNotice'], ['quote', 'choosing'], ['promotionLost'], ['error', 'errorCode'], ['checkoutCancelNotice', 'noticeAgain'], ['refreshNotice'], ['error', 'errorCode'], ['recipientOpen']]);
});

test('D13: in every commit where a notice is set together with a chooser change, the notice is the last to scroll — and an old notice never pulls the page back', () => {
  // ending a payment in one tap: the notice is set at once, the chooser reopens a read later, and that commit bumps `noticeAgain` with `setChoosing(true)`
  assert.deepEqual(ran('choosing', 'noticeAgain'), ['backNavigation', 'checkoutNotice']);
  assert.equal(ran('choosing', 'noticeAgain').at(-1), 'checkoutNotice');
  // the buyer opens the chooser by hand with a finished notice still on screen: only the chooser's own scroll runs
  assert.deepEqual(ran('choosing'), ['backNavigation']);
  assert.deepEqual(ran('quote'), ['backNavigation']);
  // the notice itself: set alone, it scrolls to itself
  assert.deepEqual(ran('checkoutCancelNotice'), ['checkoutNotice']);
  // a refused checkout drops the quote and shows the red banner in one commit: the banner is last
  assert.deepEqual(ran('quote', 'error', 'errorCode'), ['backNavigation', 'errorBanner']);
  // a refused promotion: the lost-promotion notice, the quote dropped, maybe the chooser closed: the notice is the last
  assert.equal(ran('promotionLost', 'quote', 'choosing').at(-1), 'lostNotice');
  // a checkout the provider has not answered: the quote dropped, the chooser closed and the notice set in one commit: the notice is the last
  assert.equal(ran('quote', 'choosing', 'checkoutCancelNotice').at(-1), 'checkoutNotice');
  // the answer of the check and the cadence notice are set alone
  assert.deepEqual(ran('refreshNotice'), ['refreshAnswer']);
  assert.deepEqual(ran('cadenceNotice'), ['cadenceNoticeRef']);
  // the chooser opens in the same commit as the counter, in the same batch, and nowhere else bumps it
  assert.match(page, /if \(reopenChooser\.current && status\.allowedActions\.includes\('new_sales'\) && !status\.attemptId\) \{ reopenChooser\.current = false; setChoosing\(true\); setSection\('package'\); setNoticeAgain\(value => value \+ 1\); \}/);
  assert.equal(count(page, 'setNoticeAgain('), 1);
  assert.match(page, /const \[noticeAgain, setNoticeAgain\] = useState\(0\);/);
  // the banner's recipient guard: a recipient error has its own destination, the banner leaves it alone
  assert.match(page, /if \(error && !RECIPIENT_ERROR_CODES\.includes\(errorCode \?\? ''\)\) \{ errorBanner/);
});
