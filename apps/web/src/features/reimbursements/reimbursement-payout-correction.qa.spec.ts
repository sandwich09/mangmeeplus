import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {
  REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH, REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS, isReimbursementPayoutCorrectionReason,
  reimbursementPayoutCorrectionReasons,
} from '@watchdog-bms/contracts';
import { translateApiError } from '@/common/api/api-error-message';
import { ToastContext } from '@/common/components/toast/use-toast';
import {
  PAYOUT_CORRECTION_REREAD_NOTE, PAYOUT_CORRECTION_SAVE_LABEL, PAYOUT_CORRECTION_STALE_PRESS, PAYOUT_CORRECTION_SUPERSEDED, PAYOUT_CORRECTION_TYPING_REFUSED,
  emptyPayoutCorrectionForm, isClaimChangedRefusal, isClaimStateConflict, isRequesterNotActiveRefusal,
  payoutCorrectionAccountText, payoutCorrectionAnsweredText, payoutCorrectionAnswerWords, payoutCorrectionCardNote, payoutCorrectionFormError,
  payoutCorrectionInput, payoutCorrectionOffers, payoutCorrectionPreviousAccount, payoutCorrectionReasonText, payoutCorrectionReasons, payoutCorrectionRequestError, payoutCorrectionRequestInput, payoutCorrectionSendBackNotes,
  claimCashNote, payoutCorrectionSentBackText, payoutRoundAnswer, type PayoutCorrectionForm,
} from './reimbursement-payout.logic';
// The account a claim held at a send-back, for the words of its reason (its own import, apart from the block above).
import { payoutKindHeldAt } from './reimbursement-payout.logic';

/*
 * Payout spec §14 on the web (plan task 3.10, and the web side of 3.11 to 3.13): a claim that waits for payment
 * with a wrong payout account is sent back, its requester gives the account again, and its approvers approve
 * that account alone, on the same claim and number. Who may do which is the server's answer; these tests hold
 * the page to it, and to plain Thai.
 */

(globalThis as typeof globalThis & { React: typeof React }).React = React;
// The screens reach the icon set through ExpensesUi; this runner has no SVG loader.
require.extensions['.svg'] = (module) => { module.exports = () => null; };
// Modal portals into document.body, which a server render has none of: render a dialog in place.
Reflect.set(require('react-dom'), 'createPortal', (node: React.ReactNode) => node);
const correctionUi = require('./ReimbursementPayoutCorrection') as typeof import('./ReimbursementPayoutCorrection');
const payoutUi = require('./ReimbursementPayout') as typeof import('./ReimbursementPayout');
const sections = require('./ReimbursementDetailSections') as typeof import('./ReimbursementDetailSections');
const logic = require('./reimbursements.logic') as typeof import('./reimbursements.logic');
const model = require('./reimbursements.model') as typeof import('./reimbursements.model');
const { ReimbursementJourneyPage } = require('./ReimbursementJourneyPage') as typeof import('./ReimbursementJourneyPage');
const reactRuntime = require('react') as typeof React;

const h = React.createElement;
const noop = () => undefined;
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, bfcacheId: 'test' };
/** What the page said had been done: the success toasts, in order. Emptied by whoever reads them. */
const toasts: string[] = [];
const toast = { success: (message: string) => { toasts.push(message); }, warning: noop, error: noop };

/** What the person reads: text nodes plus aria labels, placeholders and tooltips; never other attributes such as links. */
const visible = (html: string) => [...[...html.matchAll(/(?:aria-label|placeholder|title)="([^"]*)"/gu)].map((match) => match[1]!),
  ...html.replace(/<[^>]*>/gu, '\n').split('\n')]
  .map((text) => text.replace(/&quot;/gu, '"').replace(/&#x27;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&').trim()).filter(Boolean);

/** One state a rendered screen was asked to change after it was rendered: the state's starting value, and what it was set to. */
type StateChange = { initial: unknown; shown: unknown; value: unknown };

/**
 * Renders with some useState starting values swapped in, picked by the component's own initial value, and
 * keeps what the screen does afterwards: every state it sets (`changes`) and the handlers of the elements
 * `grab` names. A handler taken from the render runs with the state that render had, so pressing it is the
 * press of a person who sees exactly that screen.
 */
function render(element: React.ReactElement, pick: (initial: any) => unknown = noop, grab?: (type: unknown, props: any, children: unknown[]) => string | undefined) {
  const changes: StateChange[] = [];
  const handlers: Record<string, any> = {};
  const realUseState = reactRuntime.useState;
  const realCreateElement = reactRuntime.createElement;
  Reflect.set(reactRuntime, 'useState', (initial: unknown) => {
    const [value, set] = (realUseState as (initial: unknown) => [unknown, (next: unknown) => void])(initial);
    const start = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    const picked = pick(start);
    const shown = picked === undefined ? value : picked;
    return [shown, (next: unknown) => { changes.push({ initial: start, shown, value: typeof next === 'function' ? (next as (current: unknown) => unknown)(shown) : next }); set(next); }];
  });
  Reflect.set(reactRuntime, 'createElement', (type: unknown, props: any, ...children: unknown[]) => {
    const name = grab?.(type, props, children);
    if (name) handlers[name] = props;
    return (realCreateElement as (...args: unknown[]) => unknown)(type, props, ...children);
  });
  Object.assign(globalThis, { document: { body: {} } }); // Modal's portal target; never touched by a server render
  try {
    const html = renderToStaticMarkup(h(AppRouterContext.Provider, { value: router as never }, h(ToastContext.Provider, { value: toast as never }, element)));
    return { html, texts: visible(html), changes, handlers };
  } finally {
    Reflect.set(reactRuntime, 'useState', realUseState);
    Reflect.set(reactRuntime, 'createElement', realCreateElement);
    Reflect.deleteProperty(globalThis, 'document');
  }
}

/** Runs `action` with the API answering `answer`, and returns what was asked of it. */
async function withApi(answer: (url: string, method: string) => { status: number; body: unknown }, action: () => unknown) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const realFetch = globalThis.fetch;
  const realWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.assign(globalThis, { window: {} });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(input), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const { status, body } = answer(String(input), method);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    await action();
    for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  } finally {
    globalThis.fetch = realFetch;
    if (realWindow) Object.defineProperty(globalThis, 'window', realWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
  return calls;
}
const submitEvent = { preventDefault: noop };
/** A claim as it arrives over HTTP: a key the API left out is not there at all. */
const asAnswered = <T,>(claim: T): T => JSON.parse(JSON.stringify(claim));
/** The heading of a form that opened inside the step card. */
const heading = (html: string) => /<h3[^>]*>([^<]*)<\/h3>/u.exec(html)?.[1];
/** The form with this test id: its `onSubmit`. */
const grabForm = (testId: string) => (type: unknown, props: any) => (type === 'form' && props?.['data-testid'] === testId ? 'form' : undefined);

/** Plain Thai (owner rule 2026-09-27/29): no id, code, key, ISO date or raw JSON in what a person reads. */
const MACHINE_TOKENS: Array<[string, RegExp]> = [
  ['id', /\b[a-z0-9]{20,}\b/iu], ['enum or code', /[A-Z_]{4,}/u], ['camelCase key', /\b[a-z]+[A-Z]\w*\b/u], ['snake_case code', /\b[a-z]+_[a-z_]+\b/u],
  ['ISO date', /\d{4}-\d{2}/u], ['currency code', /\bTHB\b/u], ['raw JSON', /[{}[\]"]/u],
];
function assertPlainThai(texts: string[], where: string) {
  for (const text of texts) {
    const shown = text.replaceAll('RB-202610-00007', '');
    for (const [name, pattern] of MACHINE_TOKENS) assert.doesNotMatch(shown, pattern, `${name} on ${where}: ${text}`);
  }
}

const KBANK = { payoutMethod: 'BANK_TRANSFER' as const, payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '5678', version: 1 };
const SCB = { payoutMethod: 'BANK_TRANSFER' as const, payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารไทยพาณิชย์', accountName: 'นาย สมชาย ใจดี', accountLast4: '1112', version: 2 };
/** What a claim's detail says of where it is paid back, as far as the words of a round read it: its method, and its account. A claim with nothing says neither. */
const ACCOUNT_CLAIM = { payoutMethod: 'BANK_TRANSFER' as const, payout: KBANK };
const CASH_CLAIM = { payoutMethod: 'CASH' as const, payout: { payoutMethod: 'CASH' as const } };

describe('sending a claim back for its payout account: what the form asks and sends', () => {
  // Upgrade test 2026-10-02: every reason presumed a wrong account. A claim sent before claims carried one has none, and
  // a claim that asked for cash has none either. The list is the claim's: what the API takes for what it holds, from the
  // one function both sides read.
  it('lists the reasons the API takes for what the claim holds, in its own words and order, and prints no code for a reason it does not know', () => {
    const labels = (detail: Parameters<typeof payoutCorrectionReasons>[0]) => payoutCorrectionReasons(detail).map(([, label]) => label);
    assert.deepEqual(labels(ACCOUNT_CLAIM), ['เลขบัญชีไม่ถูกต้อง', 'ชื่อบัญชีไม่ตรงกับผู้เบิก', 'ธนาคารไม่ถูกต้อง', 'บัญชีปิดหรือโอนไม่ได้', 'ผู้เบิกขอเปลี่ยนบัญชี', 'อื่น ๆ']);
    // A PromptPay number has no bank: the reason that names one is not offered for it (the API refuses it too). And it is
    // a phone number, which the entry form calls "เบอร์พร้อมเพย์": its first reason says so, under the same code.
    const PROMPTPAY_CLAIM = { payoutMethod: 'BANK_TRANSFER', payout: { ...KBANK, payoutKind: 'PROMPTPAY_PHONE' as const } };
    assert.deepEqual(labels(PROMPTPAY_CLAIM), ['เบอร์พร้อมเพย์ไม่ถูกต้อง', 'ชื่อบัญชีไม่ตรงกับผู้เบิก', 'บัญชีปิดหรือโอนไม่ได้', 'ผู้เบิกขอเปลี่ยนบัญชี', 'อื่น ๆ']);
    assert.deepEqual(payoutCorrectionReasons(PROMPTPAY_CLAIM).map(([code]) => code), reimbursementPayoutCorrectionReasons('ACCOUNT', 'PROMPTPAY_PHONE'));
    assert.equal(payoutCorrectionReasons(PROMPTPAY_CLAIM)[0]![0], 'ACCOUNT_NUMBER_WRONG');
    // The same reason in words, wherever it is printed afterwards: by the kind of the account it was said of.
    assert.deepEqual([payoutCorrectionReasonText('ACCOUNT_NUMBER_WRONG', 'PROMPTPAY_PHONE'), payoutCorrectionReasonText('ACCOUNT_NUMBER_WRONG', 'BANK_ACCOUNT'), payoutCorrectionReasonText('ACCOUNT_NUMBER_WRONG')],
      ['เบอร์พร้อมเพย์ไม่ถูกต้อง', 'เลขบัญชีไม่ถูกต้อง', 'เลขบัญชีไม่ถูกต้อง']);
    for (const kind of ['A_KIND_ADDED_LATER', '', null, 7]) assert.equal(payoutCorrectionReasonText('ACCOUNT_NUMBER_WRONG', kind), 'เลขบัญชีไม่ถูกต้อง', String(kind));
    assert.equal(payoutCorrectionReasonText('ACCOUNT_NAME_MISMATCH', 'PROMPTPAY_PHONE'), 'ชื่อบัญชีไม่ตรงกับผู้เบิก');
    // Cash has no account that could be wrong: its own two reasons, and "อื่น ๆ".
    assert.deepEqual(labels(CASH_CLAIM), ['จ่ายเป็นเงินสดไม่ได้', 'ผู้เบิกขอเปลี่ยนวิธีรับเงินคืน', 'อื่น ๆ']);
    // No account of its own: sent back for that one reason, and for no other ("อื่น ๆ" included).
    for (const legacy of [{}, { payoutMethod: undefined, payout: undefined }, { payout: null }, null, undefined]) assert.deepEqual(labels(legacy), ['ใบนี้ยังไม่มีบัญชีรับเงิน']);
    // Each list is the API's own for that claim, code for code.
    assert.deepEqual(payoutCorrectionReasons(ACCOUNT_CLAIM).map(([code]) => code), reimbursementPayoutCorrectionReasons('ACCOUNT', 'BANK_ACCOUNT'));
    assert.deepEqual(payoutCorrectionReasons(CASH_CLAIM).map(([code]) => code), reimbursementPayoutCorrectionReasons('CASH'));
    assert.deepEqual(payoutCorrectionReasons({}).map(([code]) => code), reimbursementPayoutCorrectionReasons('NOTHING'));
    // Between them the three lists are every reason there is, and no reason is offered for a thing the claim does not hold.
    const offered = [ACCOUNT_CLAIM, CASH_CLAIM, {}].flatMap((claim) => payoutCorrectionReasons(claim));
    assert.deepEqual(new Set(offered.map(([code]) => code)), new Set(Object.keys(REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS)));
    for (const [code, label] of offered) {
      assert.equal(isReimbursementPayoutCorrectionReason(code), true);
      assert.equal(payoutCorrectionReasonText(code), label);
    }
    for (const unknown of ['A_REASON_ADDED_LATER', '', undefined, null, 7]) assert.equal(payoutCorrectionReasonText(unknown), '');
  });

  it('refuses, before asking the API and in the API\'s own sentences, no reason, a note over 500 characters and a note with an account number', () => {
    assert.equal(payoutCorrectionRequestError('', ''), 'กรุณาเลือกเหตุผลที่ส่งกลับ');
    assert.equal(payoutCorrectionRequestError('A_REASON_ADDED_LATER', ''), translateApiError('payout_correction_reason_required'));
    assert.equal(REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH, 500);
    assert.equal(payoutCorrectionRequestError('OTHER', 'ก'.repeat(501)), 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร');
    assert.equal(payoutCorrectionRequestError('OTHER', `  ${'ก'.repeat(500)}  `), null, 'the note is trimmed, as the API trims it');
    for (const note of ['โอนเข้า 004-5-67123-4 ไม่ได้', 'เลข 0045671234', 'เบอร์ 081 234 5678']) {
      assert.equal(payoutCorrectionRequestError('ACCOUNT_NUMBER_WRONG', note), translateApiError('note_contains_account_number'), note);
    }
    // The note is optional for every reason, อื่น ๆ included, and a document number or an amount in it is no account number.
    for (const code of Object.keys(REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS)) assert.equal(payoutCorrectionRequestError(code, ''), null, code);
    assert.equal(payoutCorrectionRequestError('ACCOUNT_UNUSABLE', 'ธนาคารแจ้งว่าไม่พบบัญชีนี้ ใบ RB-202610-00007 ยอด 1614 บาท'), null);
    // Each of the three is a sentence: a label that went missing would let the form send what the API refuses.
    for (const code of ['payout_correction_reason_required', 'payout_correction_note_too_long', 'note_contains_account_number']) assert.ok(translateApiError(code), code);
  });

  it('sends the reason with the trimmed note, and no note at all when none was typed', () => {
    assert.deepEqual(payoutCorrectionRequestInput('ACCOUNT_NUMBER_WRONG', '  ธนาคารแจ้งว่าไม่พบบัญชีนี้ '), { reasonCode: 'ACCOUNT_NUMBER_WRONG', note: 'ธนาคารแจ้งว่าไม่พบบัญชีนี้' });
    assert.deepEqual(payoutCorrectionRequestInput('REQUESTER_ASKED', '   '), { reasonCode: 'REQUESTER_ASKED' });
  });

  it('says who sent it back and why in one sentence, without a name or a reason it does not have', () => {
    const held = 'ACCOUNT';
    assert.equal(payoutCorrectionSentBackText({ byName: 'วราภรณ์ การเงิน', reasonCode: 'ACCOUNT_NUMBER_WRONG', held }), 'ส่งกลับให้แก้บัญชีรับเงินโดย วราภรณ์ การเงิน : เลขบัญชีไม่ถูกต้อง');
    assert.equal(payoutCorrectionSentBackText({ reasonCode: 'BANK_WRONG', held }), 'ส่งกลับให้แก้บัญชีรับเงิน : ธนาคารไม่ถูกต้อง');
    assert.equal(payoutCorrectionSentBackText({ byName: 'สมศรี ผู้จัดการ', reasonCode: 'A_REASON_ADDED_LATER', held }), 'ส่งกลับให้แก้บัญชีรับเงินโดย สมศรี ผู้จัดการ');
    assert.equal(payoutCorrectionSentBackText({ held }), 'ส่งกลับให้แก้บัญชีรับเงิน');
    // The account sent back was a PromptPay number: the reason is said of a phone number, never of "เลขบัญชี".
    assert.equal(payoutCorrectionSentBackText({ byName: 'วราภรณ์ การเงิน', reasonCode: 'ACCOUNT_NUMBER_WRONG', held, payoutKind: 'PROMPTPAY_PHONE' }),
      'ส่งกลับให้แก้บัญชีรับเงินโดย วราภรณ์ การเงิน : เบอร์พร้อมเพย์ไม่ถูกต้อง');
    assert.equal(payoutCorrectionSentBackText({ reasonCode: 'ACCOUNT_NUMBER_WRONG', held, payoutKind: 'BANK_ACCOUNT' }), 'ส่งกลับให้แก้บัญชีรับเงิน : เลขบัญชีไม่ถูกต้อง');
  });

  // Before: the sentence said "แก้บัญชีรับเงิน" of every send-back but one, which it knew by its reason code. A claim that
  // asked for cash has no account to correct, whatever the reason.
  it('says the send-back by what the claim held: an account to correct, none yet to add, cash to choose again, and never by the reason', () => {
    const by = { byName: 'วราภรณ์ การเงิน' };
    assert.equal(payoutCorrectionSentBackText({ ...by, reasonCode: 'CASH_NOT_PAYABLE', held: 'CASH' }), 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้งโดย วราภรณ์ การเงิน : จ่ายเป็นเงินสดไม่ได้');
    assert.equal(payoutCorrectionSentBackText({ ...by, reasonCode: 'REQUESTER_ASKED_METHOD', held: 'CASH' }), 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้งโดย วราภรณ์ การเงิน : ผู้เบิกขอเปลี่ยนวิธีรับเงินคืน');
    assert.equal(payoutCorrectionSentBackText({ ...by, reasonCode: 'NO_ACCOUNT_ON_CLAIM', held: 'NOTHING' }), 'ส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงินโดย วราภรณ์ การเงิน : ใบนี้ยังไม่มีบัญชีรับเงิน');
    // The reason says why, not what the claim held: "อื่น ๆ" is taken for an account and for cash alike.
    assert.equal(payoutCorrectionSentBackText({ reasonCode: 'OTHER', held: 'CASH' }), 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง : อื่น ๆ');
    assert.equal(payoutCorrectionSentBackText({ reasonCode: 'OTHER', held: 'ACCOUNT' }), 'ส่งกลับให้แก้บัญชีรับเงิน : อื่น ๆ');
    assert.equal(payoutCorrectionSentBackText({ reasonCode: 'NO_ACCOUNT_ON_CLAIM', held: 'ACCOUNT' }), 'ส่งกลับให้แก้บัญชีรับเงิน : ใบนี้ยังไม่มีบัญชีรับเงิน');
    // No record of what was held (an event from an older server), or a value added later: words true of every claim sent back.
    for (const unknown of [undefined, null, 'A_THING_ADDED_LATER', 7]) {
      assert.equal(payoutCorrectionSentBackText({ ...by, reasonCode: 'NO_ACCOUNT_ON_CLAIM', held: unknown }), 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนโดย วราภรณ์ การเงิน : ใบนี้ยังไม่มีบัญชีรับเงิน');
    }
    assert.equal(payoutCorrectionSentBackText(undefined), 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืน');
  });

  it('says the requester gave the account, and names whoever gave it on their behalf', () => {
    assert.equal(payoutCorrectionAnsweredText('NEW_ACCOUNT', { byName: 'สมชาย พนักงาน' }), 'ผู้เบิกแก้บัญชีรับเงิน');
    assert.equal(payoutCorrectionAnsweredText('NEW_ACCOUNT', { byName: 'วราภรณ์ การเงิน', onBehalf: true }), 'วราภรณ์ การเงิน แก้บัญชีรับเงินแทนผู้เบิก');
    // Someone else whose name can no longer be resolved is still not said to be the requester.
    assert.equal(payoutCorrectionAnsweredText('NEW_ACCOUNT', { onBehalf: true }), 'ผู้จัดทำ แก้บัญชีรับเงินแทนผู้เบิก');
    for (const none of [undefined, null, {}]) assert.equal(payoutCorrectionAnsweredText('NEW_ACCOUNT', none), 'ผู้เบิกแก้บัญชีรับเงิน');
  });

  // Before: "ผู้เบิกแก้บัญชีรับเงิน" of every answer but one, told apart by the reason code of the send-back it answered. It was
  // said of an account that was kept, of cash, and of a first account sent back for any reason but "it has none".
  it('says what was answered by the answer itself, of whoever gave it: "แก้" only of another account, "ยืนยัน" of what did not change', () => {
    const DID: Record<Answer, string> = {
      NEW_ACCOUNT: 'แก้บัญชีรับเงิน', SAME_ACCOUNT: 'ยืนยันบัญชีเดิม', CASH_INSTEAD: 'เปลี่ยนวิธีรับเงินคืน', ACCOUNT_INSTEAD: 'เปลี่ยนวิธีรับเงินคืน',
      SAME_CASH: 'ยืนยันวิธีรับเงินคืนเดิม', FIRST_ACCOUNT: 'เพิ่มบัญชีรับเงิน', FIRST_CASH: 'เลือกวิธีรับเงินคืน',
    };
    for (const answer of ALL_ANSWERS) {
      assert.equal(payoutCorrectionAnsweredText(answer), `ผู้เบิก${DID[answer]}`, answer);
      // Someone answered for the requester: it is said of that person, never of the requester.
      assert.equal(payoutCorrectionAnsweredText(answer, ON_BEHALF), `สุภาวดี นักบัญชี ${DID[answer]}แทนผู้เบิก`, answer);
      assert.equal(payoutRoundAnswer(answer), answer);
    }
    // No record of what was answered (an event from an older server), or an answer added later: a method was chosen, which is true of every answer.
    for (const unknown of [undefined, null, 'AN_ANSWER_ADDED_LATER', 7]) {
      assert.equal(payoutRoundAnswer(unknown), undefined);
      assert.equal(payoutCorrectionAnsweredText(unknown), 'ผู้เบิกเลือกวิธีรับเงินคืน');
      assert.equal(payoutCorrectionAnsweredText(unknown, ON_BEHALF), 'สุภาวดี นักบัญชี เลือกวิธีรับเงินคืนแทนผู้เบิก');
    }
  });

  // Before: the button and the form's title read "แก้บัญชีรับเงิน" on every claim sent back, also on one with no account
  // and on one that asked for cash.
  it('names what whoever answers is asked to do by what the claim holds, on their button and as the title of their form', () => {
    const words = (payoutMethod: string | undefined, payoutCorrectionPhase: string, forSelf: boolean) => payoutCorrectionAnswerWords({ payoutMethod, payoutCorrectionPhase }, forSelf);
    for (const [payoutMethod, ask] of [['BANK_TRANSFER', 'แก้บัญชีรับเงิน'], [undefined, 'เพิ่มบัญชีรับเงิน'], ['CASH', 'เลือกวิธีรับเงินคืน']] as const) {
      assert.deepEqual(words(payoutMethod, 'AWAITING_REQUESTER', true), { title: ask, button: ask }, ask);
      // Whoever answers for the requester reads both as done on the requester's behalf.
      assert.deepEqual(words(payoutMethod, 'AWAITING_REQUESTER', false), { title: `${ask}แทนผู้เบิก`, button: `${ask}แทนผู้เบิก` }, ask);
    }
    // Once an answer waits for approval the claim holds it: the requester is offered to do it again, by what was given.
    assert.deepEqual(words('BANK_TRANSFER', 'AWAITING_APPROVAL', true), { title: 'แก้บัญชีรับเงิน', button: 'แก้บัญชีรับเงินอีกครั้ง' });
    assert.deepEqual(words('CASH', 'AWAITING_APPROVAL', true), { title: 'เลือกวิธีรับเงินคืน', button: 'เลือกวิธีรับเงินคืนอีกครั้ง' });
    assert.deepEqual(words('CASH', 'AWAITING_APPROVAL', false), { title: 'เลือกวิธีรับเงินคืนแทนผู้เบิก', button: 'เลือกวิธีรับเงินคืนแทนผู้เบิก' });
    assert.equal(PAYOUT_CORRECTION_SAVE_LABEL, 'บันทึกวิธีรับเงินคืน');
  });
});

describe('what whoever sends a claim back is told before they confirm (spec §14.1, §14.4)', () => {
  const ready = { payoutMethod: 'BANK_TRANSFER', signatures: [], signedCopies: [] };
  // What comes after is said in words true of any answer and of whoever gives it. Before: "เมื่อผู้เบิกแก้แล้ว …", "เมื่อผู้เบิกเพิ่มแล้ว …"
  // and "เมื่อผู้เบิกเลือกแล้ว …", though the answer to any of the three may be cash, or the account the claim had, and a finance
  // reviewer may give it for the requester.
  const AFTER = 'เมื่อเลือกวิธีรับเงินคืนแล้ว ผู้อนุมัติของใบนี้ต้องอนุมัติอีกครั้งก่อนจึงจ่ายได้ ใบที่ไม่ต้องอนุมัติตามนโยบายจะกลับมารอจ่ายทันที';
  const UNCHANGED = 'ระหว่างนี้ยังบันทึกจ่ายไม่ได้ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน';

  it('says what changes and what does not, and how the claim comes back to the pay step', () => {
    assert.deepEqual(payoutCorrectionSendBackNotes(ready), [`ใบนี้จะกลับไปให้ผู้เบิกแก้บัญชีรับเงิน ${UNCHANGED}`, AFTER]);
  });

  // Before: one pair of sentences for every claim. A claim that asked for cash was told its requester would "แก้บัญชีรับเงิน",
  // and every claim that its approvers would approve "บัญชีใหม่", which is one of the things a requester may answer.
  it('says it of what the claim holds: cash is chosen again and an account is added, and no sentence promises a new account or presumes the answer', () => {
    assert.deepEqual(payoutCorrectionSendBackNotes({ ...ready, payoutMethod: 'CASH' }), [`ใบนี้จะกลับไปให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง ${UNCHANGED}`, AFTER]);
    assert.deepEqual(payoutCorrectionSendBackNotes({ ...ready, payoutMethod: undefined }).slice(0, 2), [`ใบนี้จะกลับไปให้ผู้เบิกเพิ่มบัญชีรับเงิน ${UNCHANGED}`, AFTER]);
    // The second line names no kind of answer ("แก้", "เพิ่ม") and nobody as the one who answers, whatever the claim holds.
    for (const payoutMethod of ['BANK_TRANSFER', 'CASH', undefined]) assert.doesNotMatch(payoutCorrectionSendBackNotes({ ...ready, payoutMethod })[1]!, /ผู้เบิก|แก้|เพิ่ม|บัญชี/u, String(payoutMethod));
    for (const payoutMethod of ['BANK_TRANSFER', 'CASH', undefined]) {
      const notes = payoutCorrectionSendBackNotes({ payoutMethod, signatures: [{}], signedCopies: [{ acknowledgedAt: AT.approved }] });
      for (const note of notes) assert.doesNotMatch(note, /บัญชีใหม่|ชุดเดิม/u, `${payoutMethod}: ${note}`);
      assertPlainThai(notes, `the send-back notes of a claim holding ${payoutMethod}`);
    }
  });

  // Plan 3.13 and the task's item 7: what is signed is signed on the account in question, and the server removes it at the send-back.
  it('says plainly that signatures in the system are removed and a paper-signed copy stops counting, only where the claim has them', () => {
    const signed = payoutCorrectionSendBackNotes({ ...ready, signatures: [{ role: 'REQUESTER' }, { role: 'APPROVER' }] });
    assert.ok(signed.includes('ลายเซ็นในระบบที่ลงไว้ในใบนี้จะถูกลบ ต้องลงนามใหม่เมื่อใบกลับมารอจ่าย'));
    assert.equal(signed.some((note) => note.includes('สำเนา')), false, 'no declared copy on this claim');
    const paper = payoutCorrectionSendBackNotes({ ...ready, signedCopies: [{ acknowledgedAt: '2026-10-01T05:00:00.000Z' }, {}] });
    assert.ok(paper.includes('สำเนาใบเบิกที่ลงนามบนกระดาษยังเปิดดูได้ แต่จะไม่นับว่าลงนามแล้ว ต้องแนบสำเนาใหม่เมื่อใบกลับมารอจ่าย'));
    assert.equal(paper.some((note) => note.includes('ลายเซ็นในระบบ')), false);
    // A file attached without the declaration signed nothing, so nothing is said to be lost.
    assert.equal(payoutCorrectionSendBackNotes({ ...ready, signedCopies: [{}] }).length, 2);
  });

  it('tells a claim sent before claims carried an account that it will get one, and still what happens to its signatures', () => {
    const legacy = payoutCorrectionSendBackNotes({ payoutMethod: undefined, signatures: [{ role: 'REQUESTER' }], signedCopies: [] });
    assert.ok(legacy.includes('ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน จึงไม่มีบัญชีที่ผ่านการอนุมัติในใบ หลังส่งกลับ ผู้เบิกจะระบุบัญชีรับเงินของใบนี้ได้'));
    assert.ok(legacy.includes('ลายเซ็นในระบบที่ลงไว้ในใบนี้จะถูกลบ ต้องลงนามใหม่เมื่อใบกลับมารอจ่าย'));
    for (const holds of [ready, { ...ready, payoutMethod: 'CASH' }]) assert.equal(payoutCorrectionSendBackNotes(holds).some((note) => note.includes('ส่งก่อนมีช่องบัญชีรับเงิน')), false);
  });

  it('says, from the round\'s waiting step, that the claim goes back to its requester and is not rejected: for an account to correct, or cash to choose again', () => {
    assert.deepEqual(payoutCorrectionSendBackNotes({ ...ready, payoutCorrectionPhase: 'AWAITING_APPROVAL' }),
      ['ใบนี้จะกลับไปให้ผู้เบิกแก้บัญชีรับเงิน ใบไม่ถูกปฏิเสธ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน']);
    // Before: "แก้บัญชีรับเงินอีกครั้ง" of an answer that was cash.
    assert.deepEqual(payoutCorrectionSendBackNotes({ ...ready, payoutCorrectionPhase: 'AWAITING_APPROVAL', payoutMethod: 'CASH' }),
      ['ใบนี้จะกลับไปให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง ใบไม่ถูกปฏิเสธ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน']);
  });
});

describe('giving the account of a claim in a round: what the form asks and sends', () => {
  const form = (overrides: Partial<PayoutCorrectionForm> = {}): PayoutCorrectionForm => ({ ...emptyPayoutCorrectionForm(), ...overrides });
  const typed = { payoutKind: 'BANK_ACCOUNT' as const, bankChoice: 'ธนาคารไทยพาณิชย์', bankOther: '', accountName: 'นาย สมชาย ใจดี', accountNumber: '111-2-33444-1112' };

  it('starts with nothing chosen and asks for a choice: the account in question may be the requester\'s default', () => {
    assert.equal(emptyPayoutCorrectionForm().mode, '');
    assert.deepEqual(payoutCorrectionFormError(form()), { text: 'กรุณาเลือกวิธีรับเงินคืนของใบนี้' });
    assert.equal(payoutCorrectionInput(form(), 'token', true), null);
  });

  it('holds a typed account to the API\'s own format rule and names the field', () => {
    assert.deepEqual(payoutCorrectionFormError(form({ mode: 'SPECIFIED' })), { field: 'bankName', text: 'กรุณาเลือกธนาคาร' });
    assert.equal(payoutCorrectionFormError(form({ mode: 'SPECIFIED', account: { ...typed, accountNumber: '12345' } }))?.field, 'accountNumber');
    assert.equal(payoutCorrectionFormError(form({ mode: 'SPECIFIED', account: typed })), null);
    assert.equal(payoutCorrectionFormError(form({ mode: 'CASH' })), null);
    assert.equal(payoutCorrectionFormError(form({ mode: 'DEFAULT' })), null);
  });

  it('sends cash, the default the page showed by its token, or the typed account as it was typed', () => {
    assert.deepEqual(payoutCorrectionInput(form({ mode: 'CASH' }), undefined, false), { mode: 'CASH' });
    assert.deepEqual(payoutCorrectionInput(form({ mode: 'DEFAULT' }), 'a1b2c3', false), { mode: 'DEFAULT', defaultToken: 'a1b2c3' });
    // No default was shown: nothing is sent that would take an account nobody saw.
    assert.equal(payoutCorrectionInput(form({ mode: 'DEFAULT' }), undefined, true), null);
    assert.deepEqual(payoutCorrectionInput(form({ mode: 'SPECIFIED', account: typed }), 'a1b2c3', true),
      { mode: 'SPECIFIED', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารไทยพาณิชย์', accountName: 'นาย สมชาย ใจดี', accountNumber: '111-2-33444-1112' });
  });

  it('sends "save as the default account" only when it was ticked and the server allows it for this viewer', () => {
    const ticked = form({ mode: 'SPECIFIED', account: typed, saveAsDefault: true });
    assert.equal((payoutCorrectionInput(ticked, undefined, true) as { saveAsDefault?: boolean }).saveAsDefault, true);
    assert.equal('saveAsDefault' in payoutCorrectionInput(ticked, undefined, false)!, false);
    assert.equal('saveAsDefault' in payoutCorrectionInput({ ...ticked, saveAsDefault: false }, undefined, true)!, false);
    // A tick left over from a typed account is never sent with another choice.
    assert.deepEqual(payoutCorrectionInput({ ...ticked, mode: 'CASH' }, undefined, true), { mode: 'CASH' });
  });

  it('sends "the account the claim had" as that choice alone: nobody types or names an account', () => {
    assert.equal(payoutCorrectionFormError(form({ mode: 'PREVIOUS' })), null);
    assert.deepEqual(payoutCorrectionInput(form({ mode: 'PREVIOUS' }), undefined, false), { mode: 'PREVIOUS' });
    // Neither an account typed before the choice was changed, nor its tick, nor the default's token goes with it.
    assert.deepEqual(payoutCorrectionInput(form({ mode: 'PREVIOUS', account: typed, saveAsDefault: true }), 'a1b2c3', true), { mode: 'PREVIOUS' });
  });

  it('has an account to keep only for a claim that was approved with one: cash is the cash choice, and an old claim had none', () => {
    assert.deepEqual(payoutCorrectionPreviousAccount({ payoutCorrection: { previous: KBANK } }), KBANK);
    assert.equal(payoutCorrectionPreviousAccount({ payoutCorrection: { previous: { payoutMethod: 'CASH' } } }), undefined);
    for (const detail of [{}, { payoutCorrection: null }, { payoutCorrection: {} }, { payoutCorrection: { previous: null } }]) assert.equal(payoutCorrectionPreviousAccount(detail), undefined);
  });

  it('sends every choice with the claim the form was opened on, and without it only where the page has none to name', () => {
    const openedOn = '2026-10-01T04:00:00.000Z';
    assert.deepEqual(payoutCorrectionInput(form({ mode: 'CASH' }), undefined, false, openedOn), { mode: 'CASH', expectedUpdatedAt: openedOn });
    assert.deepEqual(payoutCorrectionInput(form({ mode: 'PREVIOUS' }), undefined, false, openedOn), { mode: 'PREVIOUS', expectedUpdatedAt: openedOn });
    assert.deepEqual(payoutCorrectionInput(form({ mode: 'DEFAULT' }), 'a1b2c3', false, openedOn), { mode: 'DEFAULT', defaultToken: 'a1b2c3', expectedUpdatedAt: openedOn });
    assert.equal((payoutCorrectionInput(form({ mode: 'SPECIFIED', account: typed }), undefined, false, openedOn) as { expectedUpdatedAt?: string }).expectedUpdatedAt, openedOn);
    for (const none of [undefined, null, '']) assert.deepEqual(payoutCorrectionInput(form({ mode: 'CASH' }), undefined, false, none), { mode: 'CASH' });
    // Still nothing to send without a choice, or without the default the page showed.
    assert.equal(payoutCorrectionInput(form(), 'a1b2c3', true, openedOn), null);
    assert.equal(payoutCorrectionInput(form({ mode: 'DEFAULT' }), undefined, true, openedOn), null);
  });

  it('knows the refusal of a press on a claim that changed after the form was opened, however the API carries its name', () => {
    assert.equal(isClaimChangedRefusal(Object.assign(new Error('Reimbursement changed. Reload and retry.'), { status: 409, code: 'reimbursement_changed' })), true);
    assert.equal(isClaimChangedRefusal(Object.assign(new Error('reimbursement_changed'), { status: 409 })), true);
    for (const other of [Object.assign(new Error('payout_destination_changed'), { status: 409 }), Object.assign(new Error('payout_account_member_not_active'), { status: 409 }), new Error('Failed to fetch'), null]) {
      assert.equal(isClaimChangedRefusal(other), false);
    }
  });

  it('knows the refusal of an account typed for a requester who is no longer active, however the API carries its name', () => {
    assert.equal(isRequesterNotActiveRefusal(Object.assign(new Error('payout_account_member_not_active'), { status: 409 })), true);
    assert.equal(isRequesterNotActiveRefusal(Object.assign(new Error('Conflict'), { status: 409, code: 'payout_account_member_not_active' })), true);
    for (const other of [Object.assign(new Error('reimbursement_changed'), { status: 409 }), new Error('Failed to fetch'), null, 'payout_account_member_not_active']) {
      assert.equal(isRequesterNotActiveRefusal(other), false);
    }
  });
});

describe('an account of a round in words, masked', () => {
  it('names the bank, the last 4 digits and the account name, cash as cash, and a claim that had no account as such', () => {
    assert.equal(payoutCorrectionAccountText(KBANK), 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 5678 · ชื่อบัญชี นาย สมชาย ใจดี');
    assert.equal(payoutCorrectionAccountText({ payoutMethod: 'BANK_TRANSFER', payoutKind: 'PROMPTPAY_PHONE', accountName: 'นาย สมชาย ใจดี', accountLast4: '5678' }),
      'พร้อมเพย์เบอร์ลงท้าย 5678 · ชื่อบัญชี นาย สมชาย ใจดี');
    assert.equal(payoutCorrectionAccountText({ payoutMethod: 'CASH' }), 'รับเป็นเงินสด');
    // The method alone, when the account behind it could not be read.
    assert.equal(payoutCorrectionAccountText({ payoutMethod: 'BANK_TRANSFER' }), 'โอนเข้าบัญชี');
    for (const none of [undefined, null, {}]) assert.equal(payoutCorrectionAccountText(none as never), 'ไม่มี ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน');
  });

  // Before: "ด้านล่างคือวิธีรับเงินเดิมของใบ" also above an answer that had just been sent back (it is not what the claim began
  // with), "แก้บัญชีรับเงิน" above cash, "ระบุ" for the one act the claim calls "เพิ่ม", and "วิธีรับเงินใหม่ที่ผู้เบิกส่งมา" above an account
  // that was kept and above an answer someone else gave.
  it('tells the reader of the card "การรับเงินคืน" what they are looking at while the claim is in a round', () => {
    const withRequester = (payoutMethod?: string) => payoutCorrectionCardNote({ payoutCorrectionPhase: 'AWAITING_REQUESTER', payoutMethod });
    assert.equal(withRequester('BANK_TRANSFER'), 'ใบนี้ถูกส่งกลับให้แก้บัญชีรับเงิน ด้านล่างคือบัญชีที่ถูกส่งกลับ ระหว่างนี้ยังบันทึกจ่ายไม่ได้');
    assert.equal(withRequester('CASH'), 'ใบนี้ถูกส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง ด้านล่างคือวิธีรับเงินคืนที่ถูกส่งกลับ ระหว่างนี้ยังบันทึกจ่ายไม่ได้');
    assert.equal(withRequester(undefined), 'ใบนี้ถูกส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน ระหว่างนี้ยังบันทึกจ่ายไม่ได้');
    // While an answer waits: what was sent, and by whom. Nothing is called new: the answer may have kept what the claim had.
    const waiting = (payoutCorrectionAnsweredBy?: object) => payoutCorrectionCardNote({ payoutCorrectionPhase: 'AWAITING_APPROVAL', payoutMethod: 'BANK_TRANSFER', payoutCorrectionAnsweredBy });
    assert.equal(waiting({ byUserId: 'staff', byName: 'สมชาย พนักงาน' }), 'ด้านล่างคือวิธีรับเงินคืนที่ผู้เบิกส่งมา รอผู้อนุมัติอนุมัติก่อนจึงจ่ายได้');
    assert.equal(waiting(undefined), 'ด้านล่างคือวิธีรับเงินคืนที่ผู้เบิกส่งมา รอผู้อนุมัติอนุมัติก่อนจึงจ่ายได้');
    assert.equal(waiting(ON_BEHALF), 'ด้านล่างคือวิธีรับเงินคืนที่ สุภาวดี นักบัญชี ส่งมาแทนผู้เบิก รอผู้อนุมัติอนุมัติก่อนจึงจ่ายได้');
    assert.equal(payoutCorrectionCardNote({ payoutMethod: 'BANK_TRANSFER' }), null);
  });
});

// ---- The claim, as the API answers it at each point of a round (the hand-off note's examples) ----

const NAMES = { requester: 'สมชาย พนักงาน', approver: 'สมศรี ผู้จัดการ', payer: 'วราภรณ์ การเงิน' };
const AT = { submitted: '2026-10-01T02:00:00.000Z', approved: '2026-10-01T03:00:00.000Z', sentBack: '2026-10-01T04:00:00.000Z', given: '2026-10-01T05:00:00.000Z', reapproved: '2026-10-01T06:00:00.000Z' };
const step1 = { id: 'step-1', sequenceNo: 1, status: 'APPROVED', approverUserId: 'boss', approverName: NAMES.approver, decisionByUserId: 'boss', decidedByName: NAMES.approver,
  assignedAt: AT.submitted, decidedAt: AT.approved };
const setAside = { ...step1, invalidatedAt: AT.sentBack, invalidatedReason: 'payout_account_correction' };
const step2 = { id: 'step-2', sequenceNo: 1, status: 'PENDING', approverUserId: 'boss', approverName: NAMES.approver, assignedAt: AT.given };
const attested = { verifiedByUserId: 'boss', verifiedByName: NAMES.approver };
const version1 = { version: 1, payoutKind: KBANK.payoutKind, bankName: KBANK.bankName, accountName: KBANK.accountName, accountLast4: KBANK.accountLast4,
  source: 'DEFAULT_ACCOUNT', frozenAt: AT.submitted, ...attested, verifiedAt: AT.approved, approvalStepId: 'step-1' };
const version2 = { version: 2, payoutKind: SCB.payoutKind, bankName: SCB.bankName, accountName: SCB.accountName, accountLast4: SCB.accountLast4, source: 'REQUESTER', frozenAt: AT.given };
// Each event of a round carries the fact its words are chosen from, as the API answers it: what the claim held when it
// was sent back, and what was answered against what the round began with. Here: an account, answered with another account.
const SENT_BACK = { kind: 'SENT_BACK', at: AT.sentBack, byUserId: 'finance', byName: NAMES.payer, reasonCode: 'ACCOUNT_NUMBER_WRONG', note: 'ธนาคารแจ้งว่าไม่พบบัญชีนี้', held: 'ACCOUNT' };
const GIVEN = { kind: 'ACCOUNT_SUBMITTED', at: AT.given, byUserId: 'staff', byName: NAMES.requester, payoutMethod: 'BANK_TRANSFER', payoutVersion: 2, answer: 'NEW_ACCOUNT' };
const REAPPROVED = { kind: 'REAPPROVED', at: AT.reapproved, byUserId: 'boss', byName: NAMES.approver, approvalStepId: 'step-2', answer: 'NEW_ACCOUNT' };
const round = { requestedAt: AT.sentBack, requestedByUserId: 'finance', requestedByName: NAMES.payer, reasonCode: 'ACCOUNT_NUMBER_WRONG', note: 'ธนาคารแจ้งว่าไม่พบบัญชีนี้',
  previous: KBANK, previouslyApprovedAt: AT.approved };

/** Approved with the KBANK account and waiting for its payment: where a round starts. */
const ready = (overrides: Record<string, unknown> = {}): Record<string, any> => ({
  id: 'claim-1', requestNo: 'RB-202610-00007', status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', financeReviewStatus: 'NOT_REQUIRED', financeReviewRequired: false,
  receiptRequirementStatus: 'ATTACHED', duplicateStatus: 'NO_MATCH', requesterUserId: 'staff', requesterDisplayNameSnapshot: NAMES.requester, branchId: 'branch-1',
  reason: 'ไปพบลูกค้า', amount: '1614.5000', outstandingAmount: '1614.5000', currency: 'THB', categoryLabelSnapshot: 'เดินทาง', claimFormLayout: 'TWO_SIGNERS', documentSignedVia: null,
  submittedAt: AT.submitted, approvedAt: AT.approved, currentDesk: { kind: 'PAYMENT' }, paymentDesk: { names: [NAMES.payer], moreCount: 0 },
  payoutMethod: 'BANK_TRANSFER', payout: { ...KBANK, source: 'DEFAULT_ACCOUNT', ...attested, verifiedAt: AT.approved }, payoutHistory: [version1],
  lines: [{ id: 'line-1', lineNo: 1, incurredDate: '2026-09-30T00:00:00.000Z', description: 'ค่าแท็กซี่', categoryLabelSnapshot: 'เดินทาง', amount: '1614.5000' }],
  approvalSteps: [step1], approvalActions: { canApprove: false, canReject: false },
  payments: [], signatures: [], signedCopies: [], duplicateCandidates: [], ...overrides,
});
/** Phase A: sent back, with its requester. No approval step is open, and the account it shows is the one in question. */
const phaseA = (overrides: Record<string, unknown> = {}) => ready({
  status: 'PENDING_APPROVAL', paymentStatus: 'NOT_PAYABLE', approvedAt: undefined, payoutCorrectionPhase: 'AWAITING_REQUESTER', currentDesk: { kind: 'REQUESTER' }, paymentDesk: undefined,
  payoutCorrection: { phase: 'AWAITING_REQUESTER', ...round }, approvalSteps: [setAside], payoutCorrectionHistory: [SENT_BACK], ...overrides,
});
/**
 * Phase B: the requester gave the SCB account, and a new step waits for the approver the claim had. The claim says what
 * was answered and by whom (`payoutCorrectionAnswer`, `payoutCorrectionAnsweredBy`), on its list row and on its detail.
 */
const phaseB = (overrides: Record<string, unknown> = {}) => phaseA({
  payoutCorrectionPhase: 'AWAITING_APPROVAL', currentDesk: { kind: 'APPROVER', names: [NAMES.approver] }, approvalSnapshotHash: 'hash-of-version-2',
  payout: { ...SCB, source: 'REQUESTER' }, payoutHistory: [version1, version2],
  payoutCorrectionAnswer: 'NEW_ACCOUNT', payoutCorrectionAnsweredBy: { byUserId: 'staff', byName: NAMES.requester },
  payoutCorrection: { phase: 'AWAITING_APPROVAL', ...round, submittedAt: AT.given, sameAsPrevious: false }, approvalSteps: [setAside, step2], payoutCorrectionHistory: [SENT_BACK, GIVEN], ...overrides,
});
/** After the round: approved again, back at the pay step with the new account and its new attester. */
const reapproved = (overrides: Record<string, unknown> = {}) => ready({
  approvedAt: AT.reapproved, payout: { ...SCB, source: 'REQUESTER', ...attested, verifiedAt: AT.reapproved },
  payoutHistory: [version1, { ...version2, ...attested, verifiedAt: AT.reapproved, approvalStepId: 'step-2' }],
  approvalSteps: [setAside, { ...step2, status: 'APPROVED', decisionByUserId: 'boss', decidedByName: NAMES.approver, decidedAt: AT.reapproved }],
  payoutCorrectionHistory: [SENT_BACK, GIVEN, REAPPROVED], ...overrides,
});

// ---- The same round from each of the three things a claim can hold, and with each of the seven answers ----
//
// The fixtures above are one case: a wrong account, answered with another account. A claim is also sent back holding
// cash, or holding nothing (it was sent before claims carried an account), and its answer is one of seven. Every word of
// a round follows those two facts, so every screen is read in each of them.

type Held = 'ACCOUNT' | 'CASH' | 'NOTHING';
type Answer = 'NEW_ACCOUNT' | 'SAME_ACCOUNT' | 'CASH_INSTEAD' | 'ACCOUNT_INSTEAD' | 'SAME_CASH' | 'FIRST_ACCOUNT' | 'FIRST_CASH';
const HELD: Held[] = ['ACCOUNT', 'CASH', 'NOTHING'];
const CASH_PAYOUT = { payoutMethod: 'CASH' as const };
/** What the claim's detail says of each: its method and account, the reason it is sent back with, and what the round then says it began with. */
const HOLDING: Record<Held, { claim: Record<string, unknown>; reasonCode: string; previous?: object }> = {
  ACCOUNT: { claim: {}, reasonCode: 'ACCOUNT_NUMBER_WRONG', previous: KBANK },
  CASH: { claim: { payoutMethod: 'CASH', payout: CASH_PAYOUT, payoutHistory: undefined }, reasonCode: 'CASH_NOT_PAYABLE', previous: CASH_PAYOUT },
  NOTHING: { claim: { payoutMethod: undefined, payout: undefined, payoutHistory: undefined }, reasonCode: 'NO_ACCOUNT_ON_CLAIM' },
};
/** Each answer: what the round began with, and whether an account or cash was given. */
const ANSWERS: Record<Answer, { start: Held; given: 'ACCOUNT' | 'CASH' }> = {
  NEW_ACCOUNT: { start: 'ACCOUNT', given: 'ACCOUNT' }, SAME_ACCOUNT: { start: 'ACCOUNT', given: 'ACCOUNT' }, CASH_INSTEAD: { start: 'ACCOUNT', given: 'CASH' },
  ACCOUNT_INSTEAD: { start: 'CASH', given: 'ACCOUNT' }, SAME_CASH: { start: 'CASH', given: 'CASH' },
  FIRST_ACCOUNT: { start: 'NOTHING', given: 'ACCOUNT' }, FIRST_CASH: { start: 'NOTHING', given: 'CASH' },
};
const ALL_ANSWERS = Object.keys(ANSWERS) as Answer[];
/** The round as the detail carries it, for a claim that held `held` when it was sent back. */
const roundOf = (held: Held) => ({ ...round, reasonCode: HOLDING[held].reasonCode, note: undefined, previous: HOLDING[held].previous });
const sentBackEvent = (held: Held) => ({ ...SENT_BACK, reasonCode: HOLDING[held].reasonCode, note: undefined, held });
/** At the pay step, holding `held`. */
const readyHolding = (held: Held, overrides: Record<string, unknown> = {}) => ready({ ...HOLDING[held].claim, ...overrides });
/** Sent back holding `held`: with its requester. */
const sentBackHolding = (held: Held, overrides: Record<string, unknown> = {}) => phaseA({
  ...HOLDING[held].claim, payoutCorrection: { phase: 'AWAITING_REQUESTER', ...roundOf(held) }, payoutCorrectionHistory: [sentBackEvent(held)], ...overrides,
});
/** Someone who answers for the requester: a finance reviewer may. The claim and the event then say so. */
const ON_BEHALF = { byUserId: 'accountant', byName: 'สุภาวดี นักบัญชี', onBehalf: true as const };
/**
 * Answered with `answer`: waiting for its approver. The claim holds what was given: the SCB account (the very KBANK
 * account again when it was kept), or cash. `by`: who answered, when it was not the requester.
 */
const answeredWith = (answer: Answer, overrides: Record<string, unknown> = {}, by?: typeof ON_BEHALF) => {
  const { start, given } = ANSWERS[answer];
  // An account given is the next version of the claim's account: the second where the claim had one, its first otherwise.
  const version = start === 'ACCOUNT' ? 2 : 1;
  const account = answer === 'SAME_ACCOUNT' ? { ...version1, version, frozenAt: AT.given, verifiedByUserId: undefined, verifiedByName: undefined, verifiedAt: undefined, approvalStepId: undefined }
    : { ...version2, version };
  const earlier = start === 'ACCOUNT' ? [version1] : [];
  return phaseB({
    ...(given === 'CASH' ? { payoutMethod: 'CASH', payout: CASH_PAYOUT, payoutHistory: earlier.length ? earlier : undefined }
      : { payoutMethod: 'BANK_TRANSFER', payout: { ...(answer === 'SAME_ACCOUNT' ? KBANK : SCB), version, source: account.source }, payoutHistory: [...earlier, account] }),
    payoutCorrectionAnswer: answer, payoutCorrectionAnsweredBy: by ?? { byUserId: 'staff', byName: NAMES.requester },
    payoutCorrection: { phase: 'AWAITING_APPROVAL', ...roundOf(start), submittedAt: AT.given, sameAsPrevious: answer === 'SAME_ACCOUNT' || answer === 'SAME_CASH' },
    payoutCorrectionHistory: [sentBackEvent(start), { ...GIVEN, ...by, payoutMethod: given === 'CASH' ? 'CASH' : 'BANK_TRANSFER', payoutVersion: given === 'CASH' ? undefined : version, answer }],
    ...overrides,
  });
};

describe('the send-back form (spec §14.3): inside the step card, a fixed reason, an optional note', () => {
  /** The form's own states, in the order it declares them: the reason, the note, then the banner. */
  const form = (detail: object, state: { reasonCode?: string; note?: string; error?: string } = {}, onDone: (claim: unknown) => void = noop,
    onConflict: () => Promise<boolean> = async () => false) => {
    let blanks = 0;
    return render(h(correctionUi.PayoutCorrectionRequestForm, { companyId: 'company-1', detail, onCancel: noop, onDone, onConflict }), (start) => {
      if (start === '') { blanks += 1; return blanks === 1 ? state.reasonCode : state.note; }
      return start === null ? state.error : undefined;
    }, grabForm('reimbursement-payout-correction-request'));
  };

  /** Every reason there is, as a label: what a rendered form shows of them. One reason reads differently of a PromptPay number. */
  const ALL_REASONS = [...Object.values(REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS), 'เบอร์พร้อมเพย์ไม่ถูกต้อง'] as string[];
  const offered = (shown: string[]) => shown.filter((text) => ALL_REASONS.includes(text));

  it('lists the six reasons as choices of 44 px, takes a note of at most 500 characters, and is no dialog', () => {
    const { html, texts } = form(ready());
    assert.deepEqual(offered(texts), payoutCorrectionReasons(ready()).map(([, label]) => label));
    assert.equal(offered(texts).includes('ใบนี้ยังไม่มีบัญชีรับเงิน'), false, 'a claim that carries an account is never offered "it has none"');
    assert.equal(html.match(/<input type="radio"/g)?.length, 6);
    assert.equal(html.match(/<label class="flex min-h-11 cursor-pointer/g)?.length, 6, 'each reason is a tap target of 44 px');
    assert.doesNotMatch(html, /<input type="radio"[^>]*checked=""/, 'no reason is chosen for the person');
    assert.match(html, /<textarea id="reimbursement-payout-correction-note"[^>]*maxLength="500"/);
    for (const text of ['ส่งกลับให้แก้บัญชีรับเงิน', 'เหตุผลที่ส่งกลับ *', 'หมายเหตุ (ไม่บังคับ)', 'ผู้เบิกและทุกคนที่เปิดใบนี้เห็นหมายเหตุนี้ อย่าพิมพ์เลขบัญชี', '0/500', 'ยกเลิก', 'ยืนยันส่งกลับ',
      'เช่น ธนาคารแจ้งว่าไม่พบบัญชีนี้',
      // What comes after presumes no answer: the requester may keep the account or take cash, and someone may answer for them.
      'เมื่อเลือกวิธีรับเงินคืนแล้ว ผู้อนุมัติของใบนี้ต้องอนุมัติอีกครั้งก่อนจึงจ่ายได้ ใบที่ไม่ต้องอนุมัติตามนโยบายจะกลับมารอจ่ายทันที']) {
      assert.ok(texts.includes(text), text);
    }
    assert.equal(texts.some((text) => text.startsWith('เมื่อผู้เบิก')), false);
    assert.doesNotMatch(html, /role="dialog"/);
    // Its heading can take focus when the form opens: the button that opened it is gone by then.
    assert.match(html, /<h3 tabindex="-1" class="[^"]*outline-none">ส่งกลับให้แก้บัญชีรับเงิน<\/h3>/);
    // Both buttons span the card on a phone and sit side by side from sm.
    assert.equal(html.match(/class="mangmee-btn [^"]*w-full sm:w-auto"/g)?.length, 2);
    assertPlainThai(texts, 'the send-back form');
  });

  // A claim sent before claims carried an account: the form is the one that asks its requester to add one. Before, it
  // offered seven reasons, six of which presumed an account that was wrong; the API now takes the one that is true.
  it('states the one reason of a claim with no account of its own, asks for none, and sends it', async () => {
    const legacy = readyHolding('NOTHING');
    const { html, texts, handlers } = form(legacy, { note: 'ขอเลขบัญชีจากผู้เบิกก่อนโอน' }, noop);
    assert.equal(heading(html), 'ส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน');
    assert.deepEqual(payoutCorrectionReasons(legacy), [['NO_ACCOUNT_ON_CLAIM', 'ใบนี้ยังไม่มีบัญชีรับเงิน']]);
    assert.ok(texts.includes('เหตุผล: ใบนี้ยังไม่มีบัญชีรับเงิน'), texts.join(' | '));
    // Nothing to choose: no list, no "เหตุผลที่ส่งกลับ *", and none of the reasons of an account that was wrong.
    assert.doesNotMatch(html, /<input type="radio"|role="radiogroup"/u);
    assert.deepEqual([texts.includes('เหตุผลที่ส่งกลับ *'), offered(texts)], [false, []]);
    // The note's hint names no bank: there is no account a bank could fail to find.
    assert.ok(texts.includes('รายละเอียดเพิ่มเติมถึงผู้เบิก') && !texts.includes('เช่น ธนาคารแจ้งว่าไม่พบบัญชีนี้'));
    // The stated reason is what goes to the API, with nothing chosen and whatever the form's own state holds.
    const calls = await withApi(() => ({ status: 200, body: asAnswered(sentBackHolding('NOTHING')) }), () => handlers.form.onSubmit(submitEvent));
    assert.deepEqual(calls.map((call) => call.body), [{ reasonCode: 'NO_ACCOUNT_ON_CLAIM', note: 'ขอเลขบัญชีจากผู้เบิกก่อนโอน' }]);
    assertPlainThai(texts, 'the send-back form of a claim with no account');
  });

  // Before: a claim that asked for cash got the title "ส่งกลับให้แก้บัญชีรับเงิน" and the six reasons of a wrong account.
  it('asks a claim that asked for cash its own three reasons, under its own title, and sends the one chosen', async () => {
    const cash = readyHolding('CASH');
    const { html, texts } = form(cash);
    assert.equal(heading(html), 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง');
    assert.deepEqual(offered(texts), ['จ่ายเป็นเงินสดไม่ได้', 'ผู้เบิกขอเปลี่ยนวิธีรับเงินคืน', 'อื่น ๆ']);
    assert.equal(html.match(/<input type="radio"/g)?.length, 3);
    assert.doesNotMatch(html, /<input type="radio"[^>]*checked=""/, 'no reason is chosen for the person');
    assert.ok(texts.includes('ใบนี้จะกลับไปให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง ระหว่างนี้ยังบันทึกจ่ายไม่ได้ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน'));
    assert.ok(texts.includes('เมื่อเลือกวิธีรับเงินคืนแล้ว ผู้อนุมัติของใบนี้ต้องอนุมัติอีกครั้งก่อนจึงจ่ายได้ ใบที่ไม่ต้องอนุมัติตามนโยบายจะกลับมารอจ่ายทันที'));
    assert.ok(texts.includes('รายละเอียดเพิ่มเติมถึงผู้เบิก'));
    // No sentence of the form names an account, which this claim has none of. The note's hint still says not to type a number.
    assert.deepEqual(texts.filter((text) => text.includes('บัญชี')), ['ผู้เบิกและทุกคนที่เปิดใบนี้เห็นหมายเหตุนี้ อย่าพิมพ์เลขบัญชี']);
    const picked = form(cash, { reasonCode: 'CASH_NOT_PAYABLE' });
    const calls = await withApi(() => ({ status: 200, body: asAnswered(sentBackHolding('CASH')) }), () => picked.handlers.form.onSubmit(submitEvent));
    assert.deepEqual(calls.map((call) => call.body), [{ reasonCode: 'CASH_NOT_PAYABLE' }]);
    assertPlainThai(texts, 'the send-back form of a cash claim');
  });

  // Decision D7: a PromptPay number has no bank, so no reason names one. And it is a phone number, which the entry form
  // calls "เบอร์พร้อมเพย์": before, its first reason read "เลขบัญชีไม่ถูกต้อง".
  it('does not offer "ธนาคารไม่ถูกต้อง" for a PromptPay number, calls its number "เบอร์พร้อมเพย์", and sends the same code', async () => {
    const promptPay = ready({ payout: { ...KBANK, payoutKind: 'PROMPTPAY_PHONE', bankName: undefined } });
    const { html, texts } = form(promptPay);
    assert.deepEqual(offered(texts), ['เบอร์พร้อมเพย์ไม่ถูกต้อง', 'ชื่อบัญชีไม่ตรงกับผู้เบิก', 'บัญชีปิดหรือโอนไม่ได้', 'ผู้เบิกขอเปลี่ยนบัญชี', 'อื่น ๆ']);
    assert.equal(html.match(/<input type="radio"/g)?.length, 5);
    assert.equal(heading(html), 'ส่งกลับให้แก้บัญชีรับเงิน');
    assert.ok(offered(form(ready()).texts).includes('ธนาคารไม่ถูกต้อง'), 'a bank account still has it');
    assert.equal(offered(form(ready()).texts)[0], 'เลขบัญชีไม่ถูกต้อง', 'and its number is still an account number');
    // The reason chosen is the one the API knows: only its words differ.
    const picked = form(promptPay, { reasonCode: 'ACCOUNT_NUMBER_WRONG' });
    assert.match(picked.html, /<input type="radio"[^>]*checked=""[^>]*\/><span class="min-w-0">เบอร์พร้อมเพย์ไม่ถูกต้อง<\/span>/);
    const calls = await withApi(() => ({ status: 200, body: asAnswered(phaseA()) }), () => picked.handlers.form.onSubmit(submitEvent));
    assert.deepEqual(calls.map((call) => call.body), [{ reasonCode: 'ACCOUNT_NUMBER_WRONG' }]);
    assertPlainThai(texts, 'the send-back form of a PromptPay claim');
  });

  it('says what will happen before the person confirms, signatures included, and from the round\'s step that the claim is not rejected', () => {
    const signed = form(ready({ signatures: [{ role: 'REQUESTER' }], signedCopies: [{ attachmentId: 'a', fileName: 'ใบเบิก.pdf', acknowledgedAt: AT.approved }] })).texts;
    for (const note of payoutCorrectionSendBackNotes({ payoutMethod: 'BANK_TRANSFER', signatures: [{}], signedCopies: [{ acknowledgedAt: AT.approved }] })) assert.ok(signed.includes(note), note);
    assert.ok(signed.some((text) => text.startsWith('ลายเซ็นในระบบที่ลงไว้ในใบนี้จะถูกลบ')));
    const again = form(phaseB()).texts;
    assert.equal(heading(form(phaseB()).html), 'ส่งกลับให้แก้อีกครั้ง');
    assert.equal(heading(form(ready()).html), 'ส่งกลับให้แก้บัญชีรับเงิน');
    assert.ok(again.includes('ใบนี้จะกลับไปให้ผู้เบิกแก้บัญชีรับเงิน ใบไม่ถูกปฏิเสธ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน'));
    assert.equal(again.includes('ปฏิเสธ'), false);
  });

  // Before: an answer that was cash was sent back under "ส่งกลับให้แก้อีกครั้ง", with the reasons of a wrong account.
  it('from the round\'s step, sends an answer of cash back to be chosen again, with the reasons of cash', () => {
    for (const answer of ['CASH_INSTEAD', 'SAME_CASH', 'FIRST_CASH'] as const) {
      const { html, texts } = form(answeredWith(answer));
      assert.equal(heading(html), 'ส่งกลับให้เลือกอีกครั้ง', answer);
      assert.deepEqual(offered(texts), ['จ่ายเป็นเงินสดไม่ได้', 'ผู้เบิกขอเปลี่ยนวิธีรับเงินคืน', 'อื่น ๆ'], answer);
      assert.ok(texts.includes('ใบนี้จะกลับไปให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง ใบไม่ถูกปฏิเสธ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน'), answer);
    }
    // An answer that is an account is sent back to be corrected, also where the claim had none before: it holds one now.
    for (const answer of ['NEW_ACCOUNT', 'SAME_ACCOUNT', 'ACCOUNT_INSTEAD', 'FIRST_ACCOUNT'] as const) {
      const { html, texts } = form(answeredWith(answer));
      assert.equal(heading(html), 'ส่งกลับให้แก้อีกครั้ง', answer);
      assert.equal(offered(texts).length, 6, answer);
      assert.equal(offered(texts).includes('ใบนี้ยังไม่มีบัญชีรับเงิน'), false, answer);
    }
  });

  it('sends the reason and the note to the send-back endpoint and hands the answer on', async () => {
    const done: unknown[] = [];
    const answer = asAnswered(phaseA());
    const { handlers, changes } = form(ready(), { reasonCode: 'ACCOUNT_NUMBER_WRONG', note: ' ธนาคารแจ้งว่าไม่พบบัญชีนี้ ' }, (claim) => done.push(claim));
    const calls = await withApi(() => ({ status: 200, body: answer }), () => handlers.form.onSubmit(submitEvent));
    assert.deepEqual(calls, [{ url: '/api/v1/companies/company-1/reimbursements/claim-1/payout-correction', method: 'POST',
      body: { reasonCode: 'ACCOUNT_NUMBER_WRONG', note: 'ธนาคารแจ้งว่าไม่พบบัญชีนี้' } }]);
    assert.deepEqual(done, [answer]);
    assert.equal(changes.some((change) => typeof change.value === 'string' && change.initial === null), false, 'no banner');
  });

  it('asks nothing of the API without a reason, or with an account number in the note, and says why', async () => {
    for (const [state, sentence] of [
      [{ note: 'โอนไม่เข้า' }, 'กรุณาเลือกเหตุผลที่ส่งกลับ'],
      [{ reasonCode: 'OTHER', note: 'เลขที่ถูกคือ 004-5-67123-4' }, translateApiError('note_contains_account_number')!],
    ] as const) {
      const done: unknown[] = [];
      const { handlers, changes } = form(ready(), state, (claim) => done.push(claim));
      const calls = await withApi(() => ({ status: 200, body: {} }), () => handlers.form.onSubmit(submitEvent));
      assert.deepEqual([calls, done], [[], []]);
      assert.deepEqual(changes.map(({ initial, value }) => ({ initial, value })), [{ initial: null, value: sentence }]);
    }
  });

  // A lost race (someone paid, cancelled or sent the claim back first) or a refusal: the sentence, and nothing typed is lost.
  it('shows the server\'s sentence for a lost race or a refusal and keeps the reason and the note as typed', async () => {
    for (const [status, code, sentence] of [
      [409, 'reimbursement_changed', 'คำขอถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง'],
      [409, 'payout_correction_not_allowed', 'ใบนี้ส่งกลับไม่ได้ในตอนนี้ ส่งกลับได้เฉพาะใบที่รอจ่ายและยังไม่ได้บันทึกจ่าย ถ้าบันทึกจ่ายแล้วต้องยกเลิกการจ่ายก่อน'],
      [409, 'payout_correction_in_progress', 'ใบนี้ถูกส่งกลับเรื่องวิธีรับเงินคืน และยังไม่กลับมารอจ่าย จึงยังทำรายการนี้ไม่ได้ เปิดใบใหม่เพื่อดูว่าตอนนี้ใบรอใคร'],
      [403, 'payout_correction_denied', 'คุณไม่มีสิทธิ์ส่งกลับหรือเลือกวิธีรับเงินคืนของใบนี้'],
    ] as const) {
      const done: unknown[] = [];
      let reread = 0;
      const { handlers, changes } = form(ready(), { reasonCode: 'BANK_WRONG', note: 'ผู้เบิกแจ้งว่าเปลี่ยนธนาคารแล้ว' }, (claim) => done.push(claim),
        async () => { reread += 1; return false; });
      const calls = await withApi(() => ({ status, body: { statusCode: status, message: code } }), () => handlers.form.onSubmit(submitEvent));
      assert.equal(calls.length, 1, code);
      assert.deepEqual(done, [], `${code}: the page is not told the send-back went through`);
      // The claim moved on (409): the page is asked to read it again, so what is under the form is true. A refusal of this viewer is none.
      assert.equal(reread, status === 409 ? 1 : 0, code);
      // Busy on, banner cleared, the sentence, busy off: the reason ('') and the note ('') states are never set.
      assert.deepEqual(changes.map(({ initial, value }) => ({ initial, value })),
        [{ initial: false, value: true }, { initial: null, value: null }, { initial: null, value: sentence }, { initial: false, value: false }], code);
      // Neither the reason nor the note was touched: both are still what the person chose and typed.
      assert.equal(changes.some((change) => change.shown === 'BANK_WRONG' || change.shown === 'ผู้เบิกแจ้งว่าเปลี่ยนธนาคารแล้ว'), false, code);
    }
    // What the person then sees: their reason still chosen, their note still in the box, and the sentence.
    const { html, texts } = form(ready(), { reasonCode: 'BANK_WRONG', note: 'ผู้เบิกแจ้งว่าเปลี่ยนธนาคารแล้ว', error: 'ใบนี้ถูกส่งกลับเรื่องวิธีรับเงินคืน และยังไม่กลับมารอจ่าย จึงยังทำรายการนี้ไม่ได้ เปิดใบใหม่เพื่อดูว่าตอนนี้ใบรอใคร' });
    assert.match(html, /<input type="radio"[^>]*checked=""[^>]*\/><span class="min-w-0">ธนาคารไม่ถูกต้อง<\/span>/);
    assert.match(html, /<textarea[^>]*>ผู้เบิกแจ้งว่าเปลี่ยนธนาคารแล้ว<\/textarea>/);
    assert.ok(texts.includes('⚠ ใบนี้ถูกส่งกลับเรื่องวิธีรับเงินคืน และยังไม่กลับมารอจ่าย จึงยังทำรายการนี้ไม่ได้ เปิดใบใหม่เพื่อดูว่าตอนนี้ใบรอใคร'));
    assert.match(html, /role="alert"/);
  });

  // Before: the page under the form stayed as it was until it was opened again, and the sentence named nothing to do.
  it('says the page now shows the claim as it is, in a form that is still offered after the page read the claim again', async () => {
    const { handlers, changes } = form(ready(), { reasonCode: 'BANK_WRONG' }, noop, async () => true);
    await withApi(() => ({ status: 409, body: { statusCode: 409, message: 'reimbursement_changed' } }), () => handlers.form.onSubmit(submitEvent));
    assert.ok(changes.some((change) => change.value === 'คำขอถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง · หน้านี้แสดงสถานะล่าสุดของใบแล้ว ตรวจแล้วกดอีกครั้งได้'), JSON.stringify(changes));
    // A form that is no longer offered is closed by the page, which says what was not done and where to read what can be done now.
    for (const text of Object.values(PAYOUT_CORRECTION_SUPERSEDED)) assert.match(text, /^ยังไม่ได้.+ เพราะมีผู้ทำรายการกับใบนี้ไปก่อนแล้ว หน้านี้แสดงสถานะล่าสุดของใบ ดูในขั้นตอนนี้ว่าใบรอใคร และทำต่อได้ตามปุ่มที่แสดง$/u);
    assert.deepEqual([isClaimStateConflict({ status: 409 }), isClaimStateConflict({ status: 403 }), isClaimStateConflict(new Error('x'))], [true, false, false]);
    // What the page does with either form after it read the claim again is held by the page's own tests below.
  });
});

describe('the account form of a claim in a round (spec §14.5): the default, a typed account, or cash', () => {
  const DEFAULT = { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกรุงเทพ', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' };
  const withDefault = (detail: Record<string, any>, requesterDefault: object = DEFAULT) => ({ ...detail, payoutCorrectionActions: { canRequest: false, canSubmit: true, requesterDefault } });
  const typed = { payoutKind: 'BANK_ACCOUNT' as const, bankChoice: 'ธนาคารไทยพาณิชย์', bankOther: '', accountName: 'นาย สมชาย ใจดี', accountNumber: '111-2-33444-1112' };
  /** The form's own states: what was picked and typed, whether the server lets this viewer save a default, then the banner. */
  const form = (detail: object, state: { picked?: Partial<PayoutCorrectionForm>; canSaveAsDefault?: boolean; error?: string; userId?: string; typing?: 'refused' } = {}, onDone: (claim: unknown) => void = noop,
    onConflict: (claimChanged: boolean) => Promise<boolean> = async () => false) => {
    let falses = 0;
    return render(h(correctionUi.PayoutCorrectionAccountForm, { companyId: 'company-1', detail, userId: state.userId ?? 'staff', canEditEmployees: false, onCancel: noop, onDone, onConflict }), (start) => {
      if (start && typeof start === 'object' && 'saveAsDefault' in start) return { ...start, ...state.picked };
      if (start === false) { falses += 1; return falses === 1 ? state.canSaveAsDefault : undefined; }
      if (start === 'offered') return state.typing;
      return start === null ? state.error : undefined;
    }, grabForm('reimbursement-payout-correction-account'));
  };
  const KEEP = 'ใช้บัญชีเดิมของใบนี้';
  const choices = (texts: string[]) => texts.filter((text) => ['ใช้บัญชีรับเงินคืนประจำของฉัน', 'ใช้บัญชีรับเงินคืนประจำของผู้เบิก', 'รับเป็นเงินสด', 'ระบุบัญชีสำหรับใบนี้', KEEP].includes(text));

  it('offers the requester\'s default account as the server shows it now, masked, beside cash and a typed account, and chooses none', () => {
    const { html, texts } = form(withDefault(phaseA()));
    assert.deepEqual(choices(texts), ['ใช้บัญชีรับเงินคืนประจำของฉัน', 'รับเป็นเงินสด', 'ระบุบัญชีสำหรับใบนี้', KEEP]);
    assert.ok(texts.includes('ธนาคารกรุงเทพ เลขบัญชีลงท้าย 6789 · ชื่อบัญชี นาย สมชาย ใจดี'));
    assert.doesNotMatch(html, /<input type="radio"[^>]*checked=""/);
    assert.equal(html.includes(DEFAULT.token), false, 'the token is sent, never shown');
    assert.equal(html.match(/\d{5,}/g), null, 'the last 4 digits only');
    for (const text of ['แก้บัญชีรับเงิน', 'เลือกวิธีรับเงินคืนของใบนี้ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน', 'ยกเลิก', 'บันทึกวิธีรับเงินคืน']) assert.ok(texts.includes(text), text);
    assert.doesNotMatch(html, /role="dialog"/);
    assert.equal(html.match(/<label class="flex min-h-11 cursor-pointer/g)?.length, 4);
    assertPlainThai(texts, 'the account form');
  });

  // Upgrade test 2026-10-02: the form offered a finance reviewer the choice to type an account for a requester who had
  // left, and said it could not be taken only after the save was refused. The server now lists what its endpoint takes
  // from this viewer (`submitModes`), and why typing is not on the list.
  it('offers exactly the choices the server lists for this viewer, and says before anyone types why typing is not one of them', () => {
    const listed = (submitModes: string[], more: object = {}) => ({ ...phaseA(), payoutCorrectionActions: { canRequest: false, canSubmit: true, requesterDefault: DEFAULT, submitModes, ...more } });
    assert.deepEqual(choices(form(listed(['DEFAULT', 'SPECIFIED', 'CASH', 'PREVIOUS']), { userId: 'finance' }).texts),
      ['ใช้บัญชีรับเงินคืนประจำของผู้เบิก', 'รับเป็นเงินสด', 'ระบุบัญชีสำหรับใบนี้', KEEP]);
    // The requester is no longer an active member: typing is not offered, and the sentence that says why is on the
    // form from the start, as what the form is and not as something that went wrong.
    const gone = form(listed(['DEFAULT', 'CASH', 'PREVIOUS'], { specifiedRefusal: 'REQUESTER_NOT_ACTIVE' }), { userId: 'finance' });
    assert.deepEqual(choices(gone.texts), ['ใช้บัญชีรับเงินคืนประจำของผู้เบิก', 'รับเป็นเงินสด', KEEP]);
    assert.ok(gone.texts.includes(PAYOUT_CORRECTION_TYPING_REFUSED));
    assert.equal(gone.texts.includes(`⚠ ${PAYOUT_CORRECTION_TYPING_REFUSED}`), false, 'known up front: a note, not an error banner');
    assert.match(gone.html, /data-testid="reimbursement-payout-correction-typing-note"/);
    // An account left in the form's state is never shown as fields under a choice that is not offered.
    const stale = form(listed(['CASH', 'PREVIOUS'], { specifiedRefusal: 'REQUESTER_NOT_ACTIVE' }), { userId: 'finance', picked: { mode: 'SPECIFIED', account: typed } });
    assert.deepEqual([choices(stale.texts), stale.texts.includes('เลขบัญชี *')], [['รับเป็นเงินสด', KEEP], false]);
    // Every choice is offered only when listed: a claim that had no account keeps none, a requester with no default has none to use.
    assert.deepEqual(choices(form(listed(['SPECIFIED', 'CASH'])).texts), ['รับเป็นเงินสด', 'ระบุบัญชีสำหรับใบนี้']);
    assert.deepEqual(choices(form(listed(['CASH'])).texts), ['รับเป็นเงินสด']);
    // No sentence where typing is offered, or where the server gave no reason for leaving it out.
    for (const detail of [listed(['DEFAULT', 'SPECIFIED', 'CASH', 'PREVIOUS']), listed(['CASH']), withDefault(phaseA())]) {
      assert.equal(form(detail, { userId: 'finance' }).texts.some((text) => text.includes(PAYOUT_CORRECTION_TYPING_REFUSED)), false);
    }
    // The rule: the list decides; an answer without one (from before the server gave it) offers every choice.
    for (const mode of ['DEFAULT', 'SPECIFIED', 'CASH', 'PREVIOUS'] as const) {
      assert.equal(payoutCorrectionOffers(listed(['CASH']), mode), mode === 'CASH', mode);
      assert.equal(payoutCorrectionOffers(withDefault(phaseA()), mode), true, mode);
    }
    assertPlainThai(gone.texts, 'the account form for a requester who left');
  });

  it('offers no default the requester has not set, and none that is cash: cash is its own choice', () => {
    assert.deepEqual(choices(form(phaseA({ payoutCorrectionActions: { canRequest: false, canSubmit: true } })).texts), ['รับเป็นเงินสด', 'ระบุบัญชีสำหรับใบนี้', KEEP]);
    assert.deepEqual(choices(form(withDefault(phaseA(), { payoutMethod: 'CASH', token: DEFAULT.token })).texts), ['รับเป็นเงินสด', 'ระบุบัญชีสำหรับใบนี้', KEEP]);
  });

  it('offers the account the claim was approved with as its own choice, by bank and last 4 digits, in both phases and to whoever fills the form', () => {
    for (const [name, detail, userId] of [
      ['its requester, sent back', withDefault(phaseA()), 'staff'], ['its requester, giving it again', withDefault(phaseB()), 'staff'], ['on the requester\'s behalf', withDefault(phaseA()), 'finance'],
    ] as const) {
      const { html, texts } = form(detail, { userId });
      assert.equal(choices(texts).at(-1), KEEP, name);
      // The account before the round (KBANK), never the one the claim shows now: in phase B that is the new one (SCB).
      assert.ok(texts.includes('ธนาคารกสิกรไทย เลขบัญชีลงท้าย 5678 · ชื่อบัญชี นาย สมชาย ใจดี · เลือกเมื่อตรวจแล้วว่าบัญชีนี้ถูกต้อง'), `${name}: ${JSON.stringify(texts)}`);
      assert.doesNotMatch(html, /<input type="radio"[^>]*checked=""/, name);
      assert.equal(html.match(/\d{5,}/g), null, `${name}: the last 4 digits only`);
      assertPlainThai(texts, name);
    }
  });

  it('offers no account to keep to a claim approved for cash, which the cash choice says, nor to a claim that had none', () => {
    const none = { ...round, previous: undefined };
    for (const payoutCorrection of [{ phase: 'AWAITING_REQUESTER', ...round, previous: { payoutMethod: 'CASH' } }, { phase: 'AWAITING_REQUESTER', ...none }]) {
      assert.deepEqual(choices(form(withDefault(phaseA({ payoutCorrection }))).texts), ['ใช้บัญชีรับเงินคืนประจำของฉัน', 'รับเป็นเงินสด', 'ระบุบัญชีสำหรับใบนี้']);
    }
  });

  it('shows the account fields for a typed account, and "บันทึกเป็นบัญชีประจำ" only where the server allows it', () => {
    const closed = form(withDefault(phaseA()), { canSaveAsDefault: true }).texts;
    assert.equal(closed.includes('เลขบัญชี *') || closed.includes('บันทึกเป็นบัญชีประจำของฉัน'), false, 'nothing to type until that choice is made');
    const open = form(withDefault(phaseA()), { picked: { mode: 'SPECIFIED' }, canSaveAsDefault: true }).texts;
    for (const text of ['ประเภทบัญชี *', 'ธนาคาร *', 'ชื่อบัญชี *', 'เลขบัญชี *', 'บันทึกเป็นบัญชีประจำของฉัน']) assert.ok(open.includes(text), text);
    assert.equal(form(withDefault(phaseA()), { picked: { mode: 'SPECIFIED' }, canSaveAsDefault: false }).texts.includes('บันทึกเป็นบัญชีประจำของฉัน'), false);
  });

  it('speaks to a finance reviewer who fills it on the requester\'s behalf, and tells them the requester is notified', () => {
    const { html, texts } = form(withDefault(phaseA()), { userId: 'finance', picked: { mode: 'SPECIFIED' }, canSaveAsDefault: true });
    assert.equal(heading(html), 'แก้บัญชีรับเงินแทนผู้เบิก');
    assert.equal(heading(form(withDefault(phaseA())).html), 'แก้บัญชีรับเงิน');
    assert.deepEqual(choices(texts), ['ใช้บัญชีรับเงินคืนประจำของผู้เบิก', 'รับเป็นเงินสด', 'ระบุบัญชีสำหรับใบนี้', KEEP]);
    assert.ok(texts.includes('กรอกบัญชีของผู้เบิก หลังบันทึกคุณจะเห็นเฉพาะ 4 ตัวท้าย และผู้เบิกจะได้รับแจ้งเตือน'));
    assert.ok(texts.includes('บันทึกเป็นบัญชีประจำของผู้เบิก'));
  });

  // Before: "ผู้อนุมัติชุดเดิมอนุมัติบัญชีใหม่" and "บัญชีที่ส่งไปก่อนหน้า … บัญชีใหม่นี้", whatever was about to be chosen: the same
  // account, a first one, or cash. And the step that approves keeps only those approvers who are still on the claim's route.
  it('says what happens after the save in words true of every choice: the claim\'s approvers approve the method chosen, or a claim nobody approves is ready for payment', () => {
    const AFTER = 'เมื่อบันทึกแล้ว ผู้อนุมัติของใบนี้ต้องอนุมัติวิธีรับเงินคืนนี้ก่อนจึงจ่ายได้ ถ้าใบนี้ไม่ต้องอนุมัติตามนโยบาย ใบจะกลับไปรอจ่ายทันที';
    const AGAIN = 'เมื่อบันทึกแล้ว วิธีรับเงินคืนที่ส่งไปก่อนหน้าจะถูกแทนที่ และผู้อนุมัติจะตรวจวิธีรับเงินคืนที่เลือกครั้งนี้แทน';
    for (const held of HELD) assert.ok(form(withDefault(sentBackHolding(held))).texts.includes(AFTER), held);
    for (const answer of ALL_ANSWERS) assert.ok(form(withDefault(answeredWith(answer))).texts.includes(AGAIN), answer);
    for (const sentence of [AFTER, AGAIN]) assert.doesNotMatch(sentence, /บัญชี|ชุดเดิม|ใหม่/u);
  });

  // Before: "แก้บัญชีรับเงิน" and "เลือกวิธีรับเงินคืนของใบนี้ใหม่" on a claim that never had an account, and "บันทึกบัญชีรับเงิน" over a
  // choice of cash.
  it('is titled for what is asked by what the claim holds, saves "the method" whatever is chosen, and asks a claim with no account for no "new" choice', () => {
    for (const [held, own, onBehalf] of [
      ['ACCOUNT', 'แก้บัญชีรับเงิน', 'แก้บัญชีรับเงินแทนผู้เบิก'], ['NOTHING', 'เพิ่มบัญชีรับเงิน', 'เพิ่มบัญชีรับเงินแทนผู้เบิก'], ['CASH', 'เลือกวิธีรับเงินคืน', 'เลือกวิธีรับเงินคืนแทนผู้เบิก'],
    ] as const) {
      const mine = form(withDefault(sentBackHolding(held)));
      assert.equal(heading(mine.html), own, held);
      assert.equal(heading(form(withDefault(sentBackHolding(held)), { userId: 'finance' }).html), onBehalf, held);
      for (const text of ['เลือกวิธีรับเงินคืนของใบนี้ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน', 'บันทึกวิธีรับเงินคืน']) assert.ok(mine.texts.includes(text), `${held}: ${text}`);
      assert.equal(mine.texts.some((text) => text === 'บันทึกบัญชีรับเงิน' || text.includes('ของใบนี้ใหม่')), false, held);
      assertPlainThai(mine.texts, `the answer form of a claim holding ${held}`);
    }
    // Opened again while an answer waits: titled for what the claim now holds, the answer already given.
    assert.equal(heading(form(withDefault(answeredWith('FIRST_ACCOUNT'))).html), 'แก้บัญชีรับเงิน');
    assert.equal(heading(form(withDefault(answeredWith('CASH_INSTEAD'))).html), 'เลือกวิธีรับเงินคืน');
    assert.equal(heading(form(withDefault(answeredWith('SAME_CASH')), { userId: 'finance' }).html), 'เลือกวิธีรับเงินคืนแทนผู้เบิก');
  });

  it('sends each choice to the account endpoint as the API takes it, the default by the token of the account shown', async () => {
    const answer = asAnswered(phaseB());
    for (const [picked, canSaveAsDefault, body] of [
      [{ mode: 'DEFAULT' }, false, { mode: 'DEFAULT', defaultToken: DEFAULT.token }],
      [{ mode: 'CASH' }, false, { mode: 'CASH' }],
      [{ mode: 'PREVIOUS' }, false, { mode: 'PREVIOUS' }],
      [{ mode: 'SPECIFIED', account: typed }, false, { mode: 'SPECIFIED', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารไทยพาณิชย์', accountName: 'นาย สมชาย ใจดี', accountNumber: '111-2-33444-1112' }],
      [{ mode: 'SPECIFIED', account: typed, saveAsDefault: true }, true,
        { mode: 'SPECIFIED', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารไทยพาณิชย์', accountName: 'นาย สมชาย ใจดี', accountNumber: '111-2-33444-1112', saveAsDefault: true }],
    ] as const) {
      const done: unknown[] = [];
      const { handlers } = form(withDefault(phaseA()), { picked: picked as Partial<PayoutCorrectionForm>, canSaveAsDefault }, (claim) => done.push(claim));
      const calls = await withApi(() => ({ status: 200, body: answer }), () => handlers.form.onSubmit(submitEvent));
      assert.deepEqual(calls, [{ url: '/api/v1/companies/company-1/reimbursements/claim-1/payout-destination', method: 'PUT', body }], JSON.stringify(picked));
      assert.deepEqual(done, [answer]);
    }
  });

  it('asks nothing of the API until a choice is made and a typed account is complete, and marks the field', async () => {
    for (const [picked, sentence] of [
      [{}, 'กรุณาเลือกวิธีรับเงินคืนของใบนี้'],
      [{ mode: 'SPECIFIED', account: { ...typed, accountNumber: '12345' } }, 'เลขบัญชีต้องเป็นตัวเลข 6 ถึง 20 หลัก'],
    ] as const) {
      const { handlers, changes } = form(withDefault(phaseA()), { picked: picked as Partial<PayoutCorrectionForm> });
      const calls = await withApi(() => ({ status: 200, body: {} }), () => handlers.form.onSubmit(submitEvent));
      assert.deepEqual(calls, []);
      assert.ok(changes.some((change) => change.value === sentence), sentence);
    }
  });

  it('shows the server\'s sentence for a refusal and keeps the account as typed', async () => {
    for (const [status, code, sentence] of [
      [409, 'payout_destination_changed', translateApiError('payout_destination_changed')!],
      [409, 'payout_correction_not_requested', 'ใบนี้ไม่ได้ถูกส่งกลับเรื่องวิธีรับเงินคืน กรุณาเปิดใบใหม่เพื่อดูสถานะล่าสุด'],
      [409, 'reimbursement_changed', 'คำขอถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง'],
      [403, 'payout_correction_denied', 'คุณไม่มีสิทธิ์ส่งกลับหรือเลือกวิธีรับเงินคืนของใบนี้'],
    ] as const) {
      const done: unknown[] = [];
      const { handlers, changes } = form(withDefault(phaseA()), { picked: { mode: 'SPECIFIED', account: typed } }, (claim) => done.push(claim));
      const calls = await withApi(() => ({ status, body: { statusCode: status, message: code } }), () => handlers.form.onSubmit(submitEvent));
      assert.deepEqual([calls.length, done], [1, []], code);
      assert.ok(changes.some((change) => change.value === sentence), `${code}: ${JSON.stringify(changes)}`);
      // The form's own state (what was picked and typed) is never set again by a refusal.
      assert.equal(changes.some((change) => !!change.initial && typeof change.initial === 'object' && 'saveAsDefault' in change.initial), false, code);
    }
    const { html, texts } = form(withDefault(phaseA()), { picked: { mode: 'SPECIFIED', account: typed }, error: 'ใบนี้ถูกส่งกลับเรื่องวิธีรับเงินคืน และยังไม่กลับมารอจ่าย จึงยังทำรายการนี้ไม่ได้ เปิดใบใหม่เพื่อดูว่าตอนนี้ใบรอใคร' });
    assert.match(html, /<input[^>]*aria-label="ชื่อบัญชี"[^>]*value="นาย สมชาย ใจดี"/);
    assert.match(html, /<input[^>]*aria-label="เลขบัญชี"[^>]*value="111-2-33444-1112"/);
    assert.ok(texts.includes('⚠ ใบนี้ถูกส่งกลับเรื่องวิธีรับเงินคืน และยังไม่กลับมารอจ่าย จึงยังทำรายการนี้ไม่ได้ เปิดใบใหม่เพื่อดูว่าตอนนี้ใบรอใคร'));
  });

  it('sends the claim it was opened on with the account, and tells the page when the refusal is that this claim has changed since', async () => {
    const openedOn = withDefault(phaseA({ updatedAt: AT.sentBack }));
    const taken = await withApi(() => ({ status: 200, body: asAnswered(phaseB()) }), () => form(openedOn, { picked: { mode: 'PREVIOUS' } }).handlers.form.onSubmit(submitEvent));
    assert.deepEqual(taken.map((call) => call.body), [{ mode: 'PREVIOUS', expectedUpdatedAt: AT.sentBack }]);
    for (const [body, claimChanged, said] of [
      // The server's own answer to a press on a claim that is no longer the one the form read.
      [{ statusCode: 409, code: 'reimbursement_changed', message: 'Reimbursement changed. Reload and retry.' }, true, 'คำขอถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง'],
      // Another conflict: the claim is the one the form read, the default account shown is not the default any more.
      [{ statusCode: 409, message: 'payout_destination_changed' }, false, `${translateApiError('payout_destination_changed')!} · ${PAYOUT_CORRECTION_REREAD_NOTE}`],
    ] as const) {
      const told: boolean[] = [];
      // The page answers that the form stays only where the claim is still the one it was opened on.
      const { handlers, changes } = form(openedOn, { picked: { mode: 'DEFAULT' } }, noop, async (changed) => { told.push(changed); return !changed; });
      const calls = await withApi(() => ({ status: 409, body }), () => handlers.form.onSubmit(submitEvent));
      assert.deepEqual([calls.length, told], [1, [claimChanged]], body.message);
      assert.ok(changes.some((change) => change.value === said), `${body.message}: ${JSON.stringify(changes)}`);
    }
  });

  it('stops offering a typed account once the server refuses one for a requester who is no longer active, says why, and keeps what is left', async () => {
    const reread: string[] = [];
    const done: unknown[] = [];
    const { handlers, changes } = form(withDefault(phaseA()), { userId: 'finance', picked: { mode: 'SPECIFIED', account: typed } }, (claim) => done.push(claim),
      async () => { reread.push('asked'); return true; });
    const calls = await withApi(() => ({ status: 409, body: { statusCode: 409, message: 'payout_account_member_not_active' } }), () => handlers.form.onSubmit(submitEvent));
    assert.deepEqual([calls.length, done, reread], [1, [], []], 'refused once; the claim did not move, so the page is not asked to read it again');
    assert.ok(changes.some((change) => change.initial === 'offered' && change.value === 'refused'), JSON.stringify(changes));
    // The refused choice is no longer the one picked: nothing is sent again by a press on the same form.
    assert.equal((changes.find((change) => !!change.initial && typeof change.initial === 'object' && 'saveAsDefault' in change.initial)?.value as PayoutCorrectionForm).mode, '');
    assert.equal(changes.some((change) => typeof change.value === 'string' && change.value.includes('กดอีกครั้ง')), false, 'no invitation to press again');

    const { texts } = form(withDefault(phaseA()), { userId: 'finance', typing: 'refused' });
    assert.deepEqual(choices(texts), ['ใช้บัญชีรับเงินคืนประจำของผู้เบิก', 'รับเป็นเงินสด', KEEP]);
    assert.ok(texts.includes(`⚠ ${PAYOUT_CORRECTION_TYPING_REFUSED}`));
    // No "บัญชีใหม่": the claim may have had no account, and what cannot be done is typing one.
    assert.equal(PAYOUT_CORRECTION_TYPING_REFUSED, 'ผู้เบิกของใบนี้ไม่ได้ใช้งานระบบแล้ว จึงพิมพ์บัญชีแทนผู้เบิกไม่ได้ เพราะระบบต้องแจ้งผู้เบิกทุกครั้งที่มีผู้พิมพ์บัญชีแทน เลือกวิธีรับเงินคืนจากตัวเลือกที่เหลือ');
    // A typed account left in the form is not shown as fields any more, and is never sent.
    assert.equal(form(withDefault(phaseA()), { userId: 'finance', typing: 'refused', picked: { mode: 'SPECIFIED', account: typed } }).texts.includes('เลขบัญชี *'), false);
    assertPlainThai(texts, 'the account form after the refusal');
  });
});

describe('the card a round\'s approvers compare (spec §14.6)', () => {
  const card = (detail: object) => render(h(correctionUi.PayoutCorrectionComparison, { detail }));
  const KBANK_LINE = 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 5678 · ชื่อบัญชี นาย สมชาย ใจดี';
  const SCB_LINE = 'ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 1112 · ชื่อบัญชี นาย สมชาย ใจดี';
  const NONE = 'ไม่มี ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน';
  const UNCHANGED = 'รายการและยอดเงิน 1,614.50 บาท เท่ากับที่อนุมัติไว้เมื่อ 1 ต.ค. 2569 10:00 น.';

  it('sets the account the claim was approved with beside the new one, last 4 digits only, and says nothing else changed', () => {
    const { html, texts } = card(phaseB());
    assert.deepEqual(texts, [
      'สิ่งที่รออนุมัติ: บัญชีรับเงินใหม่',
      'บัญชีเดิม', KBANK_LINE,
      'บัญชีใหม่', SCB_LINE,
      `${UNCHANGED} การอนุมัติครั้งนี้ตรวจเฉพาะบัญชีรับเงิน`,
      'ส่งกลับให้แก้บัญชีรับเงินโดย วราภรณ์ การเงิน : เลขบัญชีไม่ถูกต้อง', 'หมายเหตุ: ธนาคารแจ้งว่าไม่พบบัญชีนี้',
      'ผู้เบิกแก้บัญชีรับเงิน เมื่อ 1 ต.ค. 2569 12:00 น.',
    ]);
    assert.equal(html.match(/\d{5,}/g), null);
    assertPlainThai(texts, 'the comparison card');
  });

  // Before: one card for every answer. "สิ่งที่เปลี่ยน: บัญชีรับเงินคืน" over an account that was kept, "บัญชีเดิม: รับเป็นเงินสด",
  // "บัญชีใหม่: รับเป็นเงินสด", "บัญชีใหม่" of a claim's first account, and "ผู้เบิกแก้บัญชีรับเงิน" under all of them.
  it('is titled for what waits to be approved and names its rows by what was answered, for each of the seven answers', () => {
    const CARDS: Record<Answer, string[]> = {
      NEW_ACCOUNT: ['สิ่งที่รออนุมัติ: บัญชีรับเงินใหม่', 'บัญชีเดิม', KBANK_LINE, 'บัญชีใหม่', SCB_LINE, 'ตรวจเฉพาะบัญชีรับเงิน', 'ส่งกลับให้แก้บัญชีรับเงิน', 'ผู้เบิกแก้บัญชีรับเงิน'],
      SAME_ACCOUNT: ['สิ่งที่รออนุมัติ: บัญชีรับเงินเดิม', 'บัญชีเดิม ไม่ได้เปลี่ยน', KBANK_LINE, 'ตรวจเฉพาะบัญชีรับเงิน', 'ส่งกลับให้แก้บัญชีรับเงิน', 'ผู้เบิกยืนยันบัญชีเดิม'],
      CASH_INSTEAD: ['สิ่งที่รออนุมัติ: การรับเป็นเงินสด', 'วิธีรับเงินคืนเดิม', KBANK_LINE, 'วิธีรับเงินคืนใหม่', 'รับเป็นเงินสด', 'ตรวจเฉพาะวิธีรับเงินคืน', 'ส่งกลับให้แก้บัญชีรับเงิน', 'ผู้เบิกเปลี่ยนวิธีรับเงินคืน'],
      ACCOUNT_INSTEAD: ['สิ่งที่รออนุมัติ: บัญชีรับเงิน', 'วิธีรับเงินคืนเดิม', 'รับเป็นเงินสด', 'วิธีรับเงินคืนใหม่', SCB_LINE, 'ตรวจเฉพาะบัญชีรับเงิน', 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง', 'ผู้เบิกเปลี่ยนวิธีรับเงินคืน'],
      SAME_CASH: ['สิ่งที่รออนุมัติ: การรับเป็นเงินสด', 'วิธีรับเงินคืนเดิม ไม่ได้เปลี่ยน', 'รับเป็นเงินสด', 'ตรวจเฉพาะวิธีรับเงินคืน', 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง', 'ผู้เบิกยืนยันวิธีรับเงินคืนเดิม'],
      FIRST_ACCOUNT: ['สิ่งที่รออนุมัติ: บัญชีรับเงิน', 'เดิม', NONE, 'บัญชีที่เพิ่ม', SCB_LINE, 'ตรวจเฉพาะบัญชีรับเงิน', 'ส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน', 'ผู้เบิกเพิ่มบัญชีรับเงิน'],
      FIRST_CASH: ['สิ่งที่รออนุมัติ: การรับเป็นเงินสด', 'เดิม', NONE, 'วิธีรับเงินคืนที่เลือก', 'รับเป็นเงินสด', 'ตรวจเฉพาะวิธีรับเงินคืน', 'ส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน', 'ผู้เบิกเลือกวิธีรับเงินคืน'],
    };
    for (const answer of ALL_ANSWERS) {
      const { html, texts } = card(answeredWith(answer));
      const [checks, sendBack, did] = CARDS[answer].slice(-3);
      const reason = REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS[HOLDING[ANSWERS[answer].start].reasonCode as keyof typeof REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS];
      assert.deepEqual(texts, [
        ...CARDS[answer].slice(0, -3), `${UNCHANGED} การอนุมัติครั้งนี้${checks}`,
        `${sendBack}โดย วราภรณ์ การเงิน : ${reason}`, `${did} เมื่อ 1 ต.ค. 2569 12:00 น.`,
      ], answer);
      // The destination that was kept is shown once; every other answer sets two things side by side.
      assert.equal(/data-testid="reimbursement-payout-correction-same-account"/.test(html), answer === 'SAME_ACCOUNT' || answer === 'SAME_CASH', answer);
      // Cash is never called an account, and nothing is "new" but an account that replaced an account.
      if (ANSWERS[answer].given === 'CASH') assert.equal(texts.some((text) => /บัญชี(เดิม|ใหม่)|ตรวจเฉพาะบัญชี/u.test(text)), false, answer);
      if (answer !== 'NEW_ACCOUNT') assert.equal(texts.some((text) => text === 'บัญชีใหม่' || text.includes('บัญชีรับเงินใหม่') || text.startsWith('ผู้เบิกแก้')), false, answer);
      assert.equal(html.match(/\d{5,}/g), null, `${answer}: the last 4 digits only`);
      assertPlainThai(texts, `the card of ${answer}`);
    }
  });

  // No sentence says the requester did what someone else did for them: a finance reviewer may answer on their behalf.
  it('says who answered on its last line, by name, when it was not the requester', () => {
    for (const [answer, said] of [
      ['NEW_ACCOUNT', 'สุภาวดี นักบัญชี แก้บัญชีรับเงินแทนผู้เบิก'], ['SAME_ACCOUNT', 'สุภาวดี นักบัญชี ยืนยันบัญชีเดิมแทนผู้เบิก'],
      ['CASH_INSTEAD', 'สุภาวดี นักบัญชี เปลี่ยนวิธีรับเงินคืนแทนผู้เบิก'], ['FIRST_CASH', 'สุภาวดี นักบัญชี เลือกวิธีรับเงินคืนแทนผู้เบิก'],
    ] as const) {
      const { texts } = card(answeredWith(answer, {}, ON_BEHALF));
      assert.equal(texts.at(-1), `${said} เมื่อ 1 ต.ค. 2569 12:00 น.`, answer);
      assert.equal(texts.some((text) => text.startsWith('ผู้เบิก')), false, `${answer}: nothing is said to be done by the requester`);
    }
    // An action's answer carries no history: the card still says who answered and when, from the claim's own fact.
    assert.equal(logic.payoutCorrectionComparison(answeredWith('SAME_CASH', { payoutCorrectionHistory: undefined }, ON_BEHALF))!.submitted,
      'สุภาวดี นักบัญชี ยืนยันวิธีรับเงินคืนเดิมแทนผู้เบิก เมื่อ 1 ต.ค. 2569 12:00 น.');
    assert.equal(logic.payoutCorrectionComparison(phaseB({ payoutCorrectionHistory: undefined }))!.submitted, 'ผู้เบิกแก้บัญชีรับเงิน เมื่อ 1 ต.ค. 2569 12:00 น.');
  });

  // Upgrade test 2026-10-02: the requester chose "ใช้บัญชีเดิมของใบนี้", and the card set the account beside itself:
  // two lines that read alike and no word that they are one account. Whether they are one is the server's answer
  // (it compares what it stores, once, when it takes the answer); the last 4 digits on a page cannot tell, so the page never decides it.
  it('shows one account under "บัญชีเดิม ไม่ได้เปลี่ยน" exactly when the server says it is the same account, and never decides that itself', () => {
    const kept = (payoutCorrectionAnswer?: Answer) => answeredWith('SAME_ACCOUNT', { payoutCorrectionAnswer });
    const same = card(kept('SAME_ACCOUNT'));
    assert.deepEqual(same.texts.slice(0, 3), ['สิ่งที่รออนุมัติ: บัญชีรับเงินเดิม', 'บัญชีเดิม ไม่ได้เปลี่ยน', KBANK_LINE]);
    assert.equal(same.texts.filter((text) => text === KBANK_LINE).length, 1, 'the account is shown once');
    assert.deepEqual(logic.payoutCorrectionComparison(kept('SAME_ACCOUNT'))!.labels, ['บัญชีเดิม ไม่ได้เปลี่ยน']);
    // Two accounts that read alike are still two accounts unless the server says otherwise: the same last 4 digits
    // under the same name can be another number.
    const two = card(kept('NEW_ACCOUNT'));
    assert.deepEqual(two.texts.slice(0, 5), ['สิ่งที่รออนุมัติ: บัญชีรับเงินใหม่', 'บัญชีเดิม', KBANK_LINE, 'บัญชีใหม่', KBANK_LINE]);
    // No answer on the claim (a page fed by an older server): names true of every answer, and nothing called the same or new.
    const unknown = card(kept(undefined));
    assert.deepEqual(unknown.texts.slice(0, 5), ['สิ่งที่รออนุมัติ: วิธีรับเงินคืน', 'วิธีรับเงินคืนก่อนส่งกลับ', KBANK_LINE, 'วิธีรับเงินคืนที่ส่งมา', KBANK_LINE]);
    assert.equal(unknown.texts.at(-1), 'ผู้เบิกเลือกวิธีรับเงินคืน เมื่อ 1 ต.ค. 2569 12:00 น.');
    assert.doesNotMatch(unknown.html, /reimbursement-payout-correction-same-account/);
    assertPlainThai([...same.texts, ...two.texts, ...unknown.texts], 'the card of an account that was kept');
  });

  it('is shown for a claim whose answer waits for approval, and for no other claim', () => {
    for (const detail of [ready(), phaseA(), reapproved(), { status: 'PENDING_APPROVAL' }, ...HELD.map((held) => sentBackHolding(held))]) {
      assert.equal(logic.payoutCorrectionComparison(detail), null);
      assert.equal(card(detail).html, '');
    }
  });
});

// ---- The claim page, as each viewer sees it (the hand-off note's table "Who may do what") ----

type Viewer = { userId: string; permissions: readonly string[] };
const STAFF = ['reimbursement.read_own', 'reimbursement.create', 'reimbursement.submit', 'reimbursement.update_own_draft', 'reimbursement.cancel_own'];
const requester: Viewer = { userId: 'staff', permissions: STAFF };
/** The approver the claim stands on. Holds no pay right, so everything they are offered at the pay step comes from the server. */
const approver: Viewer = { userId: 'boss', permissions: ['reimbursement.read_related', 'reimbursement.approve', 'reimbursement.reject'] };
const payer: Viewer = { userId: 'finance', permissions: ['reimbursement.read', 'reimbursement.payment.record', 'reimbursement.payment.void'] };
const financeReviewer: Viewer = { userId: 'accountant', permissions: ['reimbursement.read', 'reimbursement.finance_review'] };
const auditor: Viewer = { userId: 'auditor', permissions: ['reimbursement.read'] };
/** Holds every right, so nothing here is withheld by a permission: what this viewer is offered is the server's flags. */
const EVERYTHING = [...STAFF, 'reimbursement.read', 'reimbursement.approve', 'reimbursement.reject', 'reimbursement.finance_review',
  'reimbursement.payment.record', 'reimbursement.payment.void', 'reimbursement.duplicate.resolve', 'access.employee.update'];

const SEND = { canRequest: true, canSubmit: false };
const GIVE = { canRequest: false, canSubmit: true };
const DECIDE = { canApprove: true, canReject: true };
/**
 * What the API answers each viewer at each point, by the hand-off note's table: `payoutCorrectionActions`
 * (absent means neither) and, for the round's approver while the new account waits, `approvalActions`.
 */
const AS_ANSWERED: Record<'ready' | 'phaseA' | 'phaseB', Array<[name: string, viewer: Viewer, flags: Record<string, unknown>, buttons: string[]]>> = {
  ready: [
    // The send-back the server offers these three is no button of the step card: it is the text action of the account box.
    ['the requester', requester, { payoutCorrectionActions: SEND }, ['ยกเลิกคำขอ', 'พิมพ์ใบเบิก']],
    ['the approver the claim stands on', approver, { payoutCorrectionActions: SEND }, ['พิมพ์ใบเบิก']],
    ['a payer', payer, { payoutCorrectionActions: SEND }, ['บันทึกจ่าย', 'พิมพ์ใบเบิก']],
    ['a finance reviewer', financeReviewer, {}, ['ยกเลิกคำขอ', 'พิมพ์ใบเบิก']],
    ['a read-only auditor', auditor, {}, ['พิมพ์ใบเบิก']],
  ],
  phaseA: [
    ['the requester', requester, { payoutCorrectionActions: GIVE }, ['แก้บัญชีรับเงิน', 'ยกเลิกคำขอ', 'พิมพ์ใบเบิก']],
    ['the approver of the approval set aside', approver, {}, ['พิมพ์ใบเบิก']],
    ['a payer', payer, {}, ['พิมพ์ใบเบิก']],
    ['a finance reviewer', financeReviewer, { payoutCorrectionActions: GIVE }, ['แก้บัญชีรับเงินแทนผู้เบิก', 'ยกเลิกคำขอ', 'พิมพ์ใบเบิก']],
    ['a read-only auditor', auditor, {}, ['พิมพ์ใบเบิก']],
  ],
  phaseB: [
    ['the requester', requester, { payoutCorrectionActions: GIVE }, ['แก้บัญชีรับเงินอีกครั้ง', 'ยกเลิกคำขอ', 'พิมพ์ใบเบิก']],
    ['the round\'s approver', approver, { approvalActions: DECIDE, payoutCorrectionActions: SEND }, ['อนุมัติ', 'ส่งกลับให้แก้อีกครั้ง', 'พิมพ์ใบเบิก']],
    ['a payer', payer, {}, ['พิมพ์ใบเบิก']],
    ['a finance reviewer', financeReviewer, { payoutCorrectionActions: GIVE }, ['แก้บัญชีรับเงินแทนผู้เบิก', 'ยกเลิกคำขอ', 'พิมพ์ใบเบิก']],
    ['a read-only auditor', auditor, {}, ['พิมพ์ใบเบิก']],
  ],
};
const CLAIM_AT = { ready, phaseA, phaseB };

/**
 * The claim page as `viewer` sees it with `detail` loaded: the claim is the page's second null state, after the
 * confirm dialog's. `open` puts a value into one later null state, which is how the page keeps what is open.
 */
function claimPage(detail: object, viewer: Viewer, open?: { nullState: number; value: unknown }, grab?: Parameters<typeof render>[2]) {
  let nulls = 0;
  return render(h(ReimbursementJourneyPage, { companyId: 'company-1', requestId: 'claim-1', userId: viewer.userId, permissions: viewer.permissions }), (start) => {
    if (start !== null) return undefined;
    nulls += 1;
    return nulls === 2 ? detail : open && nulls === open.nullState ? open.value : undefined;
  }, grab);
}
/** The page with one of the round's two forms open, found by the form itself and not by the position of the page's state hook. */
function withForm(detail: object, viewer: Viewer, which: 'send-back' | 'correct-payout', grab?: Parameters<typeof render>[2]) {
  const testId = which === 'send-back' ? 'reimbursement-payout-correction-request' : 'reimbursement-payout-correction-account';
  for (let nullState = 3; nullState < 30; nullState += 1) {
    const page = opened(detail, viewer, { nullState, value: which }, grab);
    if (page?.html.includes(`data-testid="${testId}"`)) return page;
  }
  return null;
}
/** The page with a value put into one of its null states, or null where that state cannot hold such a value (another dialog's claim, say). */
function opened(detail: object, viewer: Viewer, open: { nullState: number; value: unknown }, grab?: Parameters<typeof render>[2]) {
  try { return claimPage(detail, viewer, open, grab); } catch { return null; }
}
/** The step card of a rendered claim page: its note, and its buttons and links in order. */
function stepCard(html: string) {
  const card = html.slice(html.indexOf('aria-labelledby="journey-step-title"'));
  const section = card.slice(0, card.indexOf('</section>'));
  return {
    html: section,
    title: /<h2[^>]*>([^<]*)<\/h2>/u.exec(section)?.[1] ?? '',
    note: visible(section.slice(section.indexOf('</h2>')))[0] ?? '',
    buttons: [...section.matchAll(/<(?:button|a)\b[^>]*>([^<]+)<\/(?:button|a)>/gu)].map((match) => match[1]!),
  };
}
/** The send-back at the foot of the account box of a claim that waits for its payment: the line above it and the text action. Null: not offered there. */
function accountBoxSendBack(html: string) {
  const at = html.indexOf('data-testid="reimbursement-payout-send-back"');
  if (at < 0) return null;
  const foot = html.slice(at, html.indexOf('</div>', at));
  return { lead: /<p[^>]*>([^<]*)<\/p>/u.exec(foot)?.[1] ?? '', action: /<button\b[^>]*>([^<]*)<\/button>/u.exec(foot)?.[1] ?? '', button: /<button\b[^>]*>/u.exec(foot)?.[0] ?? '' };
}
const deskLine = (html: string) => visible(html).filter((text) => text.startsWith('อยู่ที่'));
/** How often one exact text is on the page. */
const exactly = (html: string, text: string) => visible(html).filter((shown) => shown === text).length;
/** The step strip: each step with its state, as the page draws it. */
const strip = (detail: object, viewer: Viewer = auditor) => logic.buildJourneySteps(detail, viewer.permissions, viewer.userId).map((step) => `${step.key}:${step.state}`);
const active = (detail: object, viewer: Viewer) => logic.activeJourneyStep(logic.buildJourneySteps(detail, viewer.permissions, viewer.userId))!;

describe('the buttons of a correction round are what the server says, for every viewer and at every point (AC29, AC31)', () => {
  for (const [point, rows] of Object.entries(AS_ANSWERED) as Array<[keyof typeof AS_ANSWERED, typeof AS_ANSWERED['ready']]>) {
    it(`${point}: each viewer is offered exactly what the API takes from them`, () => {
      for (const [name, viewer, flags, buttons] of rows) {
        const detail = CLAIM_AT[point](flags);
        const { html, texts } = claimPage(detail, viewer);
        assert.deepEqual(stepCard(html).buttons, buttons, `${point}, ${name}`);
        // At the pay step, whoever the server lets send the claim back finds that at the foot of the account box, and nobody else does.
        const sendsBackAtPayStep = point === 'ready' && (flags as { payoutCorrectionActions?: { canRequest?: boolean } }).payoutCorrectionActions?.canRequest === true;
        assert.equal(accountBoxSendBack(html)?.action ?? null, sendsBackAtPayStep ? 'ส่งกลับให้แก้บัญชีรับเงิน' : null, `${point}, ${name}: the account box`);
        // Plain Thai on the whole page, for every viewer: no id, code, key or raw date.
        assertPlainThai(texts, `${point}, ${name}`);
        // The whole page, not only the step card: nothing a round refuses is offered anywhere on it.
        const pressable = [...html.matchAll(/<button\b[^>]*>([^<]*)<\/button>/gu)].map((match) => match[1]!);
        if (point !== 'ready') {
          for (const refused of ['ปฏิเสธ', 'บันทึกจ่าย', 'แก้ไข (เปิดกลับเป็นร่าง)', 'แก้ไขและส่งใหม่', 'ลงนาม', 'ลงนามใหม่', 'ดำเนินการต่อ']) {
            assert.equal(pressable.includes(refused), false, `${point}, ${name}: ${refused}`);
          }
        }
      }
    });
  }

  it('offers the round\'s buttons from the server\'s flags alone, in both directions, whatever the viewer holds', () => {
    const everything: Viewer = { userId: 'someone', permissions: EVERYTHING };
    const nothing: Viewer = { userId: 'someone', permissions: [] };
    const offered = (detail: object, viewer: Viewer) => active(detail, viewer).actions.filter((action) => ['send-back', 'correct-payout', 'approve', 'reject', 'reopen'].includes(action));
    for (const [point, at] of Object.entries(CLAIM_AT)) {
      // Every right and no flag: nothing of the round. No right and the flags: the buttons.
      assert.deepEqual(offered(at(), everything), [], `${point}: no flag`);
      assert.deepEqual(offered(at({ payoutCorrectionActions: { canRequest: false, canSubmit: false } }), everything), [], `${point}: both false`);
      assert.deepEqual(offered(at({ payoutCorrectionActions: SEND }), nothing), ['send-back'], `${point}: canRequest`);
    }
    for (const at of [phaseA, phaseB]) {
      assert.deepEqual(offered(at({ payoutCorrectionActions: GIVE }), nothing), ['correct-payout']);
      // The requester themselves is offered no way back to a draft, which the API refuses in a round.
      assert.deepEqual(offered(at({ payoutCorrectionActions: GIVE }), { userId: 'staff', permissions: EVERYTHING }), ['correct-payout']);
    }
    // Giving the account is no action of a claim at its pay step: the server never says so there, and a flag that did would open no form.
    assert.deepEqual(offered(ready({ payoutCorrectionActions: { canRequest: false, canSubmit: true } }), everything), []);
    // The new account is approved by whoever the server says decides the waiting step, and by nobody while there is none.
    assert.deepEqual(offered(phaseB({ approvalActions: DECIDE, payoutCorrectionActions: SEND }), nothing), ['approve', 'send-back']);
    assert.deepEqual(offered(phaseB({ approvalActions: { canApprove: true, canReject: false } }), nothing), ['approve']);
    assert.deepEqual(offered(phaseA({ approvalActions: DECIDE }), everything), [], 'a claim with its requester has no step to decide');
    // A round never offers "ปฏิเสธ": refusing the new account is the send-back, from the server's own flag.
    assert.deepEqual(offered(phaseB({ approvalActions: { canApprove: false, canReject: true } }), everything), []);
    assert.deepEqual(offered(phaseB({ approvalActions: { canApprove: false, canReject: true }, payoutCorrectionActions: SEND }), everything), ['send-back']);
  });

  it('offers the send-back at the pay step beside บันทึกจ่าย, also on a claim a duplicate blocks, and never on a claim being cancelled', () => {
    assert.deepEqual(active(ready({ payoutCorrectionActions: SEND }), payer).actions, ['pay', 'send-back', 'print']);
    const blocked = ready({ payoutCorrectionActions: SEND, duplicateBlocksPayment: true, duplicateStatus: 'POSSIBLE_DUPLICATE',
      duplicateCandidates: [{ id: 'd1', candidateType: 'ATTACHMENT_CHECKSUM', status: 'OPEN', score: 80 }] });
    assert.deepEqual(active(blocked, payer).actions, ['resolve-duplicate', 'send-back', 'print']);
    // The server answers no flags for a claim being cancelled; the page offers only the cancellation's own two.
    const cancelling = ready({ currentDesk: { kind: 'SYSTEM' }, pendingCancellation: { startedAt: AT.sentBack, reason: 'ซื้อซ้ำกับใบก่อน', canResume: true, canWithdraw: true } });
    assert.deepEqual(active(cancelling, { userId: 'staff', permissions: EVERYTHING }).actions, ['resume-cancel', 'withdraw-cancel', 'print']);
    // Paid: no send-back (the payment is voided first), whatever a flag says.
    const paid = ready({ status: 'PAID', paymentStatus: 'PAID', currentDesk: undefined, payments: [{ id: 'p1', status: 'RECORDED', paidAt: AT.reapproved }] });
    assert.equal(active(paid, payer).actions.includes('send-back'), false);
  });

  // Upgrade test 2026-10-02: the send-back sat directly under "บันทึกจ่าย". One wrong tap on a claim that only needed paying
  // removed both of its signatures and put it back through approval.
  it('keeps the send-back away from บันทึกจ่าย: a line of text at the foot of the account box, never a button of the pay step', () => {
    const forPayer = claimPage(ready({ payoutCorrectionActions: SEND }), payer).html;
    const card = stepCard(forPayer);
    assert.deepEqual(card.buttons, ['บันทึกจ่าย', 'พิมพ์ใบเบิก']);
    // The step says what the step is for, and points to no button it no longer has.
    assert.equal(card.note, 'บันทึกจ่ายเต็มจำนวน ระบุวิธีจ่าย วันที่ และเลขอ้างอิง');
    assert.equal(stepCard(claimPage(ready({ payoutCorrectionActions: SEND }), requester).html).note, 'รอ วราภรณ์ การเงิน บันทึกจ่าย');
    assert.equal(stepCard(claimPage(ready(), auditor).html).note, 'รอ วราภรณ์ การเงิน บันทึกจ่าย');
    // Where the account is read: the reason to send it back, then the action as underlined text of 44 px, above the step card.
    const foot = accountBoxSendBack(forPayer)!;
    assert.deepEqual([foot.lead, foot.action], ['ถ้าวิธีรับเงินคืนหรือบัญชีนี้ไม่ถูกต้อง อย่าเพิ่งจ่าย ส่งกลับให้แก้ก่อน', 'ส่งกลับให้แก้บัญชีรับเงิน']);
    for (const cls of ['min-h-11', 'underline']) assert.ok(foot.button.includes(cls), `${cls}: ${foot.button}`);
    assert.doesNotMatch(foot.button, /mangmee-btn/u, 'no button look');
    assert.ok(forPayer.indexOf('data-testid="reimbursement-payout-send-back"') < forPayer.indexOf('aria-labelledby="journey-step-title"'), 'in the account box, above the step card');
    // A viewer who can only send it back has no main thing to press in the step card.
    assert.doesNotMatch(stepCard(claimPage(ready({ payoutCorrectionActions: SEND }), requester).html).html, /mangmee-btn-primary/u);
    assert.match(card.html, /<button[^>]*mangmee-btn-primary[^>]*>บันทึกจ่าย<\/button>/u);
  });

  // Before: the sentence above the send-back told every reader "อย่าเพิ่งจ่าย". The requester of the claim, and its approver
  // without the pay right, are offered the send-back too, and paying is not theirs to hold back.
  it('says "อย่าเพิ่งจ่าย" only to whoever is offered the payment, and tells everyone else they can send it back before it is paid', () => {
    const lead = (detail: object, viewer: Viewer) => accountBoxSendBack(claimPage(detail, viewer).html)!.lead;
    for (const [held, forPayer, forOthers] of [
      ['ACCOUNT', 'ถ้าวิธีรับเงินคืนหรือบัญชีนี้ไม่ถูกต้อง อย่าเพิ่งจ่าย ส่งกลับให้แก้ก่อน', 'ถ้าวิธีรับเงินคืนหรือบัญชีนี้ไม่ถูกต้อง ส่งกลับให้แก้ได้ก่อนมีการจ่าย'],
      ['CASH', 'ถ้าวิธีรับเงินคืนนี้ไม่ถูกต้อง อย่าเพิ่งจ่าย ส่งกลับให้ผู้เบิกเลือกก่อน', 'ถ้าวิธีรับเงินคืนนี้ไม่ถูกต้อง ส่งกลับให้ผู้เบิกเลือกได้ก่อนมีการจ่าย'],
    ] as const) {
      const detail = readyHolding(held, { payoutCorrectionActions: SEND });
      assert.equal(lead(detail, payer), forPayer, held);
      for (const viewer of [requester, approver]) {
        assert.equal(lead(detail, viewer), forOthers, held);
        assert.doesNotMatch(lead(detail, viewer), /อย่าเพิ่งจ่าย/u);
      }
    }
    // A payer whose payment a possible duplicate holds back is not offered the payment either.
    const blocked = ready({ payoutCorrectionActions: SEND, duplicateBlocksPayment: true, duplicateStatus: 'POSSIBLE_DUPLICATE', duplicateCandidates: [{ id: 'd1', candidateType: 'ATTACHMENT_CHECKSUM', status: 'OPEN' }] });
    assert.doesNotMatch(lead(blocked, payer), /อย่าเพิ่งจ่าย/u);
  });

  // Before: a claim that asked for cash read "ถ้าวิธีรับเงินหรือบัญชีนี้ไม่ถูกต้อง" above the link "ส่งกลับให้แก้บัญชีรับเงิน".
  it('names the send-back of a claim that asked for cash for what it does: no account is named on a claim that has none', () => {
    const cash = readyHolding('CASH', { payoutCorrectionActions: SEND });
    const { html, texts } = claimPage(cash, payer);
    const foot = accountBoxSendBack(html)!;
    assert.equal(foot.action, 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง');
    assert.doesNotMatch(`${foot.lead} ${foot.action}`, /บัญชี/u);
    assert.equal(texts.includes('ส่งกลับให้แก้บัญชีรับเงิน'), false);
    const form = withForm(cash, payer, 'send-back')!;
    assert.equal(heading(form.html.slice(form.html.indexOf('data-testid="reimbursement-payout-correction-request"'))), 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง');
    assertPlainThai(form.texts, 'the send-back form of a cash claim, on the page');
  });

  it('names the action for what it does on a claim that has no account of its own, and says such a claim is paid as it is', () => {
    const legacy = readyHolding('NOTHING', { payoutCorrectionActions: SEND, signatures: [{ id: 's1', role: 'REQUESTER' }], signedCopies: [{ id: 'c1', acknowledgedAt: AT.approved }] });
    const { html, texts } = claimPage(legacy, payer);
    assert.deepEqual(stepCard(html).buttons, ['บันทึกจ่าย', 'พิมพ์ใบเบิก']);
    const foot = accountBoxSendBack(html)!;
    // Its approver never checked an account, so nothing is checked "again": the account added is what they check.
    assert.equal(foot.action, 'เพิ่มบัญชีรับเงินให้ใบนี้ แล้วให้ผู้อนุมัติตรวจบัญชีนั้น');
    assert.equal(foot.lead, 'ใบนี้บันทึกจ่ายได้เลยโดยไม่ต้องมีบัญชีในใบ ข้อความด้านล่างใช้เมื่อต้องการให้ใบมีบัญชีที่ผู้อนุมัติตรวจแล้วเท่านั้น');
    // The same sentence for a reader who cannot pay: it speaks of the claim, not of what the reader should hold back.
    assert.equal(accountBoxSendBack(claimPage(legacy, requester).html)!.lead, foot.lead);
    assert.equal(texts.includes('ส่งกลับให้แก้บัญชีรับเงิน'), false, 'nothing to correct on a claim with no account');
    // The form it opens: named the same way, and still says what is lost before the confirm.
    const form = withForm(legacy, payer, 'send-back')!;
    assert.equal(heading(form.html), 'ส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน');
    for (const text of [
      'ใบนี้จะกลับไปให้ผู้เบิกเพิ่มบัญชีรับเงิน ระหว่างนี้ยังบันทึกจ่ายไม่ได้ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน',
      'เมื่อเลือกวิธีรับเงินคืนแล้ว ผู้อนุมัติของใบนี้ต้องอนุมัติอีกครั้งก่อนจึงจ่ายได้ ใบที่ไม่ต้องอนุมัติตามนโยบายจะกลับมารอจ่ายทันที',
      'ลายเซ็นในระบบที่ลงไว้ในใบนี้จะถูกลบ ต้องลงนามใหม่เมื่อใบกลับมารอจ่าย',
      'สำเนาใบเบิกที่ลงนามบนกระดาษยังเปิดดูได้ แต่จะไม่นับว่าลงนามแล้ว ต้องแนบสำเนาใหม่เมื่อใบกลับมารอจ่าย',
      'เหตุผล: ใบนี้ยังไม่มีบัญชีรับเงิน', 'ยืนยันส่งกลับ',
    ]) assert.ok(form.texts.includes(text), `${text}: ${JSON.stringify(form.texts.filter((shown) => shown.includes('ใบ')).slice(0, 12))}`);
    // The line of the account box gives way to its form while the form is open.
    assert.equal(accountBoxSendBack(form.html), null);
    assertPlainThai(form.texts, 'the send-back form of a claim with no account');
  });

  it('shows a reader from another branch no claim at all: the API refuses them the detail', () => {
    let nulls = 0;
    const { html, texts } = render(h(ReimbursementJourneyPage, { companyId: 'company-1', requestId: 'claim-1', userId: 'elsewhere', permissions: EVERYTHING }),
      (start) => (start === null && ++nulls === 3 ? Object.assign(new Error('Branch is out of scope'), { status: 403 }) : undefined));
    assert.ok(texts.some((text) => text.includes('ไม่มีสิทธิ์')), texts.join(' | '));
    assert.doesNotMatch(html, /journey-step-title|<form/);
  });
});

describe('the step strip and the status of a claim in a round (spec §14.2)', () => {
  it('goes back to อนุมัติ with the same number of steps: to put right while it waits for its requester, then current', () => {
    assert.deepEqual(strip(ready()), ['items:done', 'approval:done', 'payment:current', 'document:upcoming']);
    assert.deepEqual(strip(phaseA()), ['items:done', 'approval:needs-fix', 'payment:upcoming', 'document:upcoming']);
    assert.deepEqual(strip(phaseB()), ['items:done', 'approval:current', 'payment:upcoming', 'document:upcoming']);
    assert.deepEqual(strip(reapproved()), strip(ready()));
    for (const at of [phaseA, phaseB]) {
      const page = claimPage(at(), auditor);
      assert.ok(page.texts.includes('ขั้นตอน 2 จาก 4'));
      assert.deepEqual([stepCard(page.html).title, active(at(), auditor).key], ['อนุมัติ', 'approval']);
    }
    // A claim being cancelled in a round is the system's: its step is no step to put right.
    const cancelling = phaseA({ currentDesk: { kind: 'SYSTEM' }, pendingCancellation: { startedAt: AT.given, reason: 'ซื้อซ้ำกับใบก่อน', canResume: false, canWithdraw: false } });
    assert.deepEqual(strip(cancelling), ['items:done', 'approval:current', 'payment:upcoming', 'document:upcoming']);
  });

  // Plan 3.11: the finance result is kept and not asked again.
  it('still shows ตรวจการเงิน as passed for a claim that passed finance review, and five steps', () => {
    const reviewed = { financeReviewRequired: true, financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByName: NAMES.payer, financeReviewedAt: '2026-10-01T03:30:00.000Z' };
    assert.deepEqual(strip(ready(reviewed)), ['items:done', 'approval:done', 'finance:done', 'payment:current', 'document:upcoming']);
    for (const at of [phaseA, phaseB]) {
      const steps = logic.buildJourneySteps(at(reviewed), [], 'someone');
      assert.deepEqual(steps.map((step) => `${step.key}:${step.state}`),
        ['items:done', at === phaseA ? 'approval:needs-fix' : 'approval:current', 'finance:done', 'payment:upcoming', 'document:upcoming']);
      assert.equal(steps[2]!.note, 'ตรวจแล้ว ไม่ต้องตรวจซ้ำ');
      assert.deepEqual(steps[2]!.actions, []);
      // The step the card is about is still the approval, not the finance step behind it.
      assert.equal(logic.activeJourneyStep(steps)!.key, 'approval');
      const page = claimPage(at(reviewed), { userId: 'accountant', permissions: EVERYTHING });
      assert.ok(page.texts.includes('ขั้นตอน 2 จาก 5') && page.texts.includes('ตรวจแล้ว ไม่ต้องตรวจซ้ำ'));
      // No finance decision is offered again, to a holder of every right.
      for (const again of ['อนุมัติจ่าย', 'ส่งกลับให้แก้ไข', 'ระงับการจ่าย']) assert.equal(stepCard(page.html).buttons.includes(again), false, again);
    }
    assert.deepEqual(strip(reapproved(reviewed)), strip(ready(reviewed)));
  });

  it('reads the phase on the badge and in the status row, never รออนุมัติ', () => {
    for (const [at, label] of [[phaseA, 'รอผู้เบิกแก้บัญชีรับเงิน'], [phaseB, 'รออนุมัติบัญชีรับเงินใหม่']] as const) {
      const { html } = claimPage(at(), auditor);
      assert.deepEqual([exactly(html, label), exactly(html, 'รออนุมัติ')], [2, 0], label);
    }
    assert.equal(exactly(claimPage(reapproved(), auditor).html, 'พร้อมจ่าย'), 2);
  });

  // Before: those two labels for every claim. "แก้บัญชี" on a claim with no account or one that asked for cash, and
  // "บัญชีรับเงินใหม่" on an account that was kept, a claim's first account, and cash.
  it('says what the claim waits for by what it holds, then by what was answered, on the badge and in the status row', () => {
    const WITH_REQUESTER: Record<Held, string> = { ACCOUNT: 'รอผู้เบิกแก้บัญชีรับเงิน', NOTHING: 'รอผู้เบิกเพิ่มบัญชีรับเงิน', CASH: 'รอผู้เบิกเลือกวิธีรับเงินคืน' };
    const WITH_APPROVERS: Record<Answer, string> = {
      NEW_ACCOUNT: 'รออนุมัติบัญชีรับเงินใหม่', SAME_ACCOUNT: 'รออนุมัติบัญชีรับเงินเดิม', CASH_INSTEAD: 'รออนุมัติการรับเป็นเงินสด',
      ACCOUNT_INSTEAD: 'รออนุมัติบัญชีรับเงิน', SAME_CASH: 'รออนุมัติการรับเป็นเงินสด', FIRST_ACCOUNT: 'รออนุมัติบัญชีรับเงิน', FIRST_CASH: 'รออนุมัติการรับเป็นเงินสด',
    };
    const others = (label: string) => [...Object.values(WITH_REQUESTER), ...Object.values(WITH_APPROVERS), 'รออนุมัติ'].filter((other) => other !== label);
    for (const held of HELD) {
      const { html, texts } = claimPage(sentBackHolding(held), auditor);
      assert.equal(exactly(html, WITH_REQUESTER[held]), 2, held);
      for (const other of others(WITH_REQUESTER[held])) assert.equal(exactly(html, other), 0, `${held}: ${other}`);
      assert.equal(model.claimStatusBadge(sentBackHolding(held)).label, WITH_REQUESTER[held]);
      assertPlainThai(texts, `with its requester, holding ${held}`);
    }
    for (const answer of ALL_ANSWERS) {
      const { html, texts } = claimPage(answeredWith(answer), auditor);
      assert.equal(exactly(html, WITH_APPROVERS[answer]), 2, answer);
      for (const other of others(WITH_APPROVERS[answer])) assert.equal(exactly(html, other), 0, `${answer}: ${other}`);
      assertPlainThai(texts, `answered with ${answer}`);
    }
    // A claim sent back again from its waiting step holds the answer that was not taken: its words follow that.
    assert.equal(model.claimStatusBadge(sentBackHolding('CASH', { payoutCorrection: { phase: 'AWAITING_REQUESTER', ...roundOf('ACCOUNT') } })).label, 'รอผู้เบิกเลือกวิธีรับเงินคืน');
    // A detail with no answer on it (a page fed by an older server) says what is true of every answer.
    assert.equal(exactly(claimPage(phaseB({ payoutCorrectionAnswer: undefined }), auditor).html, 'รออนุมัติวิธีรับเงินคืน'), 2);
  });
});

describe('the header line, the step note, the timeline and the badge name the same party in each phase', () => {
  const waitingRow = (detail: object) => logic.buildClaimTimeline(detail).filter((row) => row.state === 'current').map((row) => row.label);

  it('while it waits for its requester: ผู้เบิก in all four, with who sent it back and why', () => {
    const detail = phaseA();
    const { html, texts } = claimPage(detail, auditor);
    assert.deepEqual(deskLine(html), ['อยู่ที่ ผู้เบิก']);
    assert.equal(stepCard(html).note, 'ส่งกลับให้แก้บัญชีรับเงินโดย วราภรณ์ การเงิน : เลขบัญชีไม่ถูกต้อง · หมายเหตุ: ธนาคารแจ้งว่าไม่พบบัญชีนี้ · รอผู้เบิกแก้บัญชีรับเงิน');
    assert.deepEqual(waitingRow(detail), ['กำลังรอผู้เบิกแก้บัญชีรับเงิน']);
    assert.ok(texts.includes('กำลังรอผู้เบิกแก้บัญชีรับเงิน'), 'the timeline row is on the page');
    assert.equal(model.claimStatusBadge(detail).label, 'รอผู้เบิกแก้บัญชีรับเงิน');
    // Nobody else is said to be waited for: not the approver whose approval was set aside, not a payer.
    for (const text of [...deskLine(html), stepCard(html).note.split(' · ').at(-1)!, ...waitingRow(detail)]) {
      assert.doesNotMatch(text, /สมศรี|ผู้มีสิทธิ์อนุมัติ|ผู้มีสิทธิ์บันทึกจ่าย|ผู้ยื่น|ฝ่ายการเงิน/u, text);
    }
    // The requester reads that it is theirs to do; a finance reviewer that they may do it for the requester.
    assert.equal(stepCard(claimPage(phaseA({ payoutCorrectionActions: GIVE }), requester).html).note.split(' · ').at(-1), 'รอคุณแก้บัญชีรับเงิน กดแก้บัญชีรับเงินแล้วเลือกวิธีรับเงินคืนที่ถูกต้อง');
    assert.equal(stepCard(claimPage(phaseA({ payoutCorrectionActions: GIVE }), financeReviewer).html).note.split(' · ').at(-1), 'รอผู้เบิกแก้บัญชีรับเงิน คุณแก้แทนผู้เบิกได้');
    // No note was added, or nobody can be named: the sentence is still whole.
    const bare = phaseA({ payoutCorrection: { phase: 'AWAITING_REQUESTER', requestedAt: AT.sentBack, reasonCode: 'REQUESTER_ASKED' } });
    assert.equal(active(bare, auditor).note, 'ส่งกลับให้แก้บัญชีรับเงิน : ผู้เบิกขอเปลี่ยนบัญชี · รอผู้เบิกแก้บัญชีรับเงิน');
  });

  it('while its new account waits for approval: the approvers by name in the header, the note and the timeline', () => {
    const detail = phaseB();
    const { html, texts } = claimPage(detail, auditor);
    assert.deepEqual(deskLine(html), ['อยู่ที่ สมศรี ผู้จัดการ']);
    assert.equal(stepCard(html).note, 'รอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงินใหม่');
    assert.deepEqual(waitingRow(detail), ['กำลังรอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงินใหม่']);
    assert.ok(texts.includes('กำลังรอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงินใหม่'), 'the timeline row is on the page');
    assert.equal(model.claimStatusBadge(detail).label, 'รออนุมัติบัญชีรับเงินใหม่');
    // Several approvers, or none the server could name.
    const two = phaseB({ currentDesk: { kind: 'APPROVER', names: ['สมศรี ผู้จัดการ', 'วิชัย'] } });
    assert.deepEqual([deskLine(claimPage(two, auditor).html)[0], active(two, auditor).note, waitingRow(two)[0]],
      ['อยู่ที่ สมศรี ผู้จัดการ หรือ วิชัย', 'รอ สมศรี ผู้จัดการ หรือ วิชัย อนุมัติบัญชีรับเงินใหม่', 'กำลังรอ สมศรี ผู้จัดการ หรือ วิชัย อนุมัติบัญชีรับเงินใหม่']);
    const pool = phaseB({ currentDesk: { kind: 'APPROVER' } });
    assert.deepEqual([active(pool, auditor).note, waitingRow(pool)[0]], ['รอ ผู้มีสิทธิ์อนุมัติ อนุมัติบัญชีรับเงินใหม่', 'กำลังรอ ผู้มีสิทธิ์อนุมัติ อนุมัติบัญชีรับเงินใหม่']);
    // Whoever is to act reads what to do; the header and the timeline still say who.
    assert.equal(active(phaseB({ approvalActions: DECIDE, payoutCorrectionActions: SEND }), approver).note,
      'รอคุณอนุมัติบัญชีรับเงินใหม่ ตรวจบัญชีเดิมกับบัญชีใหม่ด้านล่างก่อนอนุมัติ รายการและยอดเงินไม่เปลี่ยน');
    assert.equal(active(phaseB({ payoutCorrectionActions: GIVE }), requester).note, 'รอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงินใหม่ · ถ้าบัญชีที่ส่งไปยังไม่ถูกต้อง กดแก้บัญชีรับเงินอีกครั้งได้');
    assert.equal(active(phaseB({ payoutCorrectionActions: GIVE }), financeReviewer).note, 'รอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงินใหม่ · ถ้าบัญชีที่ส่งไปยังไม่ถูกต้อง คุณแก้แทนผู้เบิกได้');
    // The requester who would approve their own new account but for the company's switch is told so, with no way back to a draft.
    const blocked = active(phaseB({ payoutCorrectionActions: GIVE, approvalActions: { canApprove: false, canReject: false, selfApprovalBlocked: true } }), { userId: 'staff', permissions: EVERYTHING });
    assert.match(blocked.note!, /^รอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงินใหม่ · ใบนี้เป็นของคุณเอง และบริษัทยังไม่เปิด "ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้" คุณจึงอนุมัติบัญชีรับเงินใหม่เองไม่ได้ · /u);
    // Before: "อนุมัติบัญชีใหม่เองไม่ได้" of every answer. What they cannot approve is what was answered.
    const blockedCash = active(answeredWith('SAME_CASH', { payoutCorrectionActions: GIVE, approvalActions: { canApprove: false, canReject: false, selfApprovalBlocked: true } }), { userId: 'staff', permissions: EVERYTHING });
    assert.ok(blockedCash.note!.includes('คุณจึงอนุมัติการรับเป็นเงินสดเองไม่ได้ · ถ้าต้องการเปลี่ยนวิธีรับเงินคืน กดเลือกวิธีรับเงินคืนอีกครั้งได้'), blockedCash.note);
    assert.doesNotMatch(blocked.note!, /เปิดคำขอกลับเป็นร่าง/u);
    assert.deepEqual(blocked.actions, ['correct-payout', 'cancel', 'print']);
  });

  // Before: the reader's note and the timeline's waiting row said "รอผู้เบิกแก้บัญชีรับเงิน" of every claim sent back, and
  // "… อนุมัติบัญชีรับเงินใหม่" of every answer.
  it('names the same thing in the note, the timeline and the badge, for each thing a claim holds and for each answer', () => {
    for (const held of HELD) {
      const detail = sentBackHolding(held);
      const label = model.claimStatusBadge(detail).label;
      assert.equal(active(detail, auditor).note!.split(' · ').at(-1), label, held);
      assert.deepEqual(waitingRow(detail), [`กำลัง${label}`], held);
      assert.deepEqual(deskLine(claimPage(detail, auditor).html), ['อยู่ที่ ผู้เบิก'], held);
    }
    assert.deepEqual(HELD.map((held) => waitingRow(sentBackHolding(held))[0]),
      ['กำลังรอผู้เบิกแก้บัญชีรับเงิน', 'กำลังรอผู้เบิกเลือกวิธีรับเงินคืน', 'กำลังรอผู้เบิกเพิ่มบัญชีรับเงิน']);
    const THING: Record<Answer, string> = {
      NEW_ACCOUNT: 'บัญชีรับเงินใหม่', SAME_ACCOUNT: 'บัญชีรับเงินเดิม', CASH_INSTEAD: 'การรับเป็นเงินสด', ACCOUNT_INSTEAD: 'บัญชีรับเงิน',
      SAME_CASH: 'การรับเป็นเงินสด', FIRST_ACCOUNT: 'บัญชีรับเงิน', FIRST_CASH: 'การรับเป็นเงินสด',
    };
    for (const answer of ALL_ANSWERS) {
      const detail = answeredWith(answer);
      assert.equal(active(detail, auditor).note, `รอ สมศรี ผู้จัดการ อนุมัติ${THING[answer]}`, answer);
      assert.deepEqual(waitingRow(detail), [`กำลังรอ สมศรี ผู้จัดการ อนุมัติ${THING[answer]}`], answer);
      assert.equal(model.claimStatusBadge(detail).label, `รออนุมัติ${THING[answer]}`, answer);
      assert.deepEqual(deskLine(claimPage(detail, auditor).html), ['อยู่ที่ สมศรี ผู้จัดการ'], answer);
    }
    // No answer on the detail (a page fed by an older server): the method, which is true of every answer.
    const unknown = phaseB({ payoutCorrectionAnswer: undefined });
    assert.deepEqual([active(unknown, auditor).note, waitingRow(unknown)[0]], ['รอ สมศรี ผู้จัดการ อนุมัติวิธีรับเงินคืน', 'กำลังรอ สมศรี ผู้จัดการ อนุมัติวิธีรับเงินคืน']);
    // The quick-pay dialog of a row older than its claim says the same.
    assert.equal(logic.quickPayBlockedNote(answeredWith('SAME_CASH'), EVERYTHING, 'finance'), 'บันทึกจ่ายใบนี้ไม่ได้ · รอ สมศรี ผู้จัดการ อนุมัติการรับเป็นเงินสด');
  });

  // Before: "รอคุณแก้บัญชีรับเงิน กดแก้บัญชีรับเงิน…" and "รอผู้เบิกแก้บัญชีรับเงิน คุณแก้แทนผู้เบิกได้" on every claim sent back, and the
  // button "แก้บัญชีรับเงิน" under them, also where there was no account to correct.
  it('tells the requester what they are asked to do and the button that does it, and whoever may answer for them that they may, by what the claim holds', () => {
    const last = (detail: object, viewer: Viewer) => active(detail, viewer).note!.split(' · ').at(-1);
    for (const [held, mine, onBehalf, button] of [
      ['ACCOUNT', 'รอคุณแก้บัญชีรับเงิน กดแก้บัญชีรับเงินแล้วเลือกวิธีรับเงินคืนที่ถูกต้อง', 'รอผู้เบิกแก้บัญชีรับเงิน คุณแก้แทนผู้เบิกได้', 'แก้บัญชีรับเงิน'],
      ['NOTHING', 'รอคุณเพิ่มบัญชีรับเงิน กดเพิ่มบัญชีรับเงินแล้วเลือกวิธีรับเงินคืนของใบนี้', 'รอผู้เบิกเพิ่มบัญชีรับเงิน คุณเพิ่มแทนผู้เบิกได้', 'เพิ่มบัญชีรับเงิน'],
      ['CASH', 'รอคุณเลือกวิธีรับเงินคืนอีกครั้ง กดเลือกวิธีรับเงินคืนแล้วเลือกวิธีที่ต้องการ', 'รอผู้เบิกเลือกวิธีรับเงินคืน คุณเลือกแทนผู้เบิกได้', 'เลือกวิธีรับเงินคืน'],
    ] as const) {
      const detail = sentBackHolding(held, { payoutCorrectionActions: GIVE });
      assert.equal(last(detail, requester), mine, held);
      assert.equal(last(detail, financeReviewer), onBehalf, held);
      // The button each sentence names is the first button of the step card, and the title of the form it opens.
      assert.deepEqual(stepCard(claimPage(detail, requester).html).buttons, [button, 'ยกเลิกคำขอ', 'พิมพ์ใบเบิก'], held);
      assert.deepEqual(stepCard(claimPage(detail, financeReviewer).html).buttons, [`${button}แทนผู้เบิก`, 'ยกเลิกคำขอ', 'พิมพ์ใบเบิก'], held);
      assert.ok(mine.includes(`กด${button}แล้ว`), held);
      const formOf = (viewer: Viewer) => { const page = withForm(detail, viewer, 'correct-payout')!; return heading(page.html.slice(page.html.indexOf('data-testid="reimbursement-payout-correction-account"'))); };
      assert.deepEqual([formOf(requester), formOf(financeReviewer)], [button, `${button}แทนผู้เบิก`], held);
    }
    // While an answer waits for approval it may be given again: said, and offered, by what was given.
    const ACCOUNT_AGAIN = ['ถ้าบัญชีที่ส่งไปยังไม่ถูกต้อง กดแก้บัญชีรับเงินอีกครั้งได้', 'ถ้าบัญชีที่ส่งไปยังไม่ถูกต้อง คุณแก้แทนผู้เบิกได้', 'แก้บัญชีรับเงินอีกครั้ง', 'แก้บัญชีรับเงินแทนผู้เบิก'] as const;
    const CASH_AGAIN = ['ถ้าต้องการเปลี่ยนวิธีรับเงินคืน กดเลือกวิธีรับเงินคืนอีกครั้งได้', 'ถ้าต้องการเปลี่ยนวิธีรับเงินคืน คุณเลือกแทนผู้เบิกได้', 'เลือกวิธีรับเงินคืนอีกครั้ง', 'เลือกวิธีรับเงินคืนแทนผู้เบิก'] as const;
    for (const answer of ALL_ANSWERS) {
      const [mine, onBehalf, button, behalfButton] = ANSWERS[answer].given === 'CASH' ? CASH_AGAIN : ACCOUNT_AGAIN;
      const detail = answeredWith(answer, { payoutCorrectionActions: GIVE });
      assert.equal(last(detail, requester), mine, answer);
      assert.equal(last(detail, financeReviewer), onBehalf, answer);
      assert.deepEqual(stepCard(claimPage(detail, requester).html).buttons, [button, 'ยกเลิกคำขอ', 'พิมพ์ใบเบิก'], answer);
      assert.deepEqual(stepCard(claimPage(detail, financeReviewer).html).buttons, [behalfButton, 'ยกเลิกคำขอ', 'พิมพ์ใบเบิก'], answer);
      assert.ok(mine.includes(`กด${button}ได้`), answer);
    }
  });

  it('after the approval: whoever pays, as on any claim waiting for its payment', () => {
    const detail = reapproved();
    const { html } = claimPage(detail, auditor);
    assert.deepEqual([deskLine(html)[0], stepCard(html).note, waitingRow(detail)[0], model.claimStatusBadge(detail).label],
      ['อยู่ที่ วราภรณ์ การเงิน', 'รอ วราภรณ์ การเงิน บันทึกจ่าย', 'กำลังรอ วราภรณ์ การเงิน บันทึกจ่าย', 'พร้อมจ่าย']);
  });

  it('being cancelled in a round: the system, in all four', () => {
    const cancelling = phaseA({ currentDesk: { kind: 'SYSTEM' }, pendingCancellation: { startedAt: AT.given, startedByName: NAMES.requester, reason: 'ซื้อซ้ำกับใบก่อน', canResume: false, canWithdraw: false } });
    const { html } = claimPage(cancelling, auditor);
    assert.deepEqual(deskLine(html), ['อยู่ที่ ระบบ']);
    assert.ok(stepCard(html).note.startsWith('กำลังยกเลิกคำขอ รอระบบปรับสถานะ'));
    assert.deepEqual(waitingRow(cancelling), ['กำลังรอระบบปรับสถานะ']);
    assert.equal(model.claimStatusBadge(cancelling).label, 'รอระบบปรับสถานะ');
  });
});

describe('the round\'s forms open inside the step card, never in a dialog', () => {
  it('opens the send-back form in the pay step card for whoever is offered it, and replaces its button', () => {
    const page = withForm(ready({ payoutCorrectionActions: SEND }), payer, 'send-back');
    assert.ok(page, 'the form opened');
    const card = stepCard(page.html);
    assert.match(card.html, /data-testid="reimbursement-payout-correction-request"/);
    assert.doesNotMatch(page.html, /role="dialog"/);
    assert.deepEqual(card.buttons, ['บันทึกจ่าย', 'พิมพ์ใบเบิก', 'ยกเลิก', 'ยืนยันส่งกลับ']);
    // Never both forms at once: sending back closes a payment form left open.
    assert.equal(card.html.includes('วิธีจ่าย *'), false);
    // From the step a round waits on: the same form, in the approval step card, under its other name.
    const again = withForm(phaseB({ approvalActions: DECIDE, payoutCorrectionActions: SEND }), approver, 'send-back')!;
    assert.equal(heading(again.html.slice(again.html.indexOf('data-testid="reimbursement-payout-correction-request"'))), 'ส่งกลับให้แก้อีกครั้ง');
    assert.deepEqual(stepCard(again.html).buttons, ['อนุมัติ', 'พิมพ์ใบเบิก', 'ยกเลิก', 'ยืนยันส่งกลับ']);
  });

  it('opens the account form in the approval step card for whoever is offered it', () => {
    const page = withForm(phaseA({ payoutCorrectionActions: GIVE }), requester, 'correct-payout')!;
    const card = stepCard(page.html);
    assert.match(card.html, /data-testid="reimbursement-payout-correction-account"/);
    assert.doesNotMatch(page.html, /role="dialog"/);
    assert.deepEqual(card.buttons, ['ยกเลิกคำขอ', 'พิมพ์ใบเบิก', 'ยกเลิก', 'บันทึกวิธีรับเงินคืน']);
    assert.equal(heading(card.html), 'แก้บัญชีรับเงิน');
    assert.equal(heading(stepCard(withForm(phaseA({ payoutCorrectionActions: GIVE }), financeReviewer, 'correct-payout')!.html).html), 'แก้บัญชีรับเงินแทนผู้เบิก');
  });

  it('reads in plain Thai with either form open, on the whole page', () => {
    assertPlainThai(withForm(ready({ payoutCorrectionActions: SEND, signatures: [{ role: 'REQUESTER', signedByName: NAMES.requester, signedAt: AT.approved }] }), payer, 'send-back')!.texts, 'send-back form open');
    assertPlainThai(withForm(phaseB({ approvalActions: DECIDE, payoutCorrectionActions: SEND }), approver, 'send-back')!.texts, 'send back again');
    const withDefault = { ...GIVE, requesterDefault: { ...KBANK, accountLast4: '6789', token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' } };
    for (const viewer of [requester, financeReviewer]) assertPlainThai(withForm(phaseA({ payoutCorrectionActions: withDefault }), viewer, 'correct-payout')!.texts, 'account form open');
  });

  // Seen on the real page: with a form open, the first button left in the card took the primary look, and that was "ยกเลิกคำขอ".
  it('leaves no button beside an open form looking like the main thing to press: the form\'s own save is', () => {
    const primary = (html: string) => [...stepCard(html).html.matchAll(/<(?:button|a)\b[^>]*class="mangmee-btn mangmee-btn-primary[^"]*"[^>]*>([^<]+)</gu)].map((match) => match[1]!);
    assert.deepEqual(primary(claimPage(phaseA({ payoutCorrectionActions: GIVE }), requester).html), ['แก้บัญชีรับเงิน']);
    assert.deepEqual(primary(withForm(phaseA({ payoutCorrectionActions: GIVE }), requester, 'correct-payout')!.html), ['บันทึกวิธีรับเงินคืน']);
    assert.deepEqual(primary(claimPage(ready({ payoutCorrectionActions: SEND }), payer).html), ['บันทึกจ่าย']);
    // While the new account waits for its approvers, giving it again is allowed and is not the thing to do next.
    assert.deepEqual(primary(claimPage(phaseB({ payoutCorrectionActions: GIVE }), requester).html), []);
    assert.deepEqual(primary(claimPage(phaseB({ approvalActions: DECIDE, payoutCorrectionActions: SEND }), approver).html), ['อนุมัติ']);
    assert.deepEqual(primary(withForm(ready({ payoutCorrectionActions: SEND }), requester, 'send-back')!.html), ['ยืนยันส่งกลับ']);
    assert.deepEqual(primary(withForm(phaseB({ approvalActions: DECIDE, payoutCorrectionActions: SEND }), approver, 'send-back')!.html), ['ยืนยันส่งกลับ']);
  });

  it('opens neither form for a viewer the server does not offer it to, whatever the page was told to open', () => {
    assert.equal(withForm(ready(), { userId: 'someone', permissions: EVERYTHING }, 'send-back'), null);
    assert.equal(withForm(phaseA(), { userId: 'staff', permissions: EVERYTHING }, 'correct-payout'), null);
    assert.equal(withForm(phaseA({ payoutCorrectionActions: GIVE }), requester, 'send-back'), null, 'nobody sends a claim back while it is with its requester');
    assert.equal(withForm(ready({ payoutCorrectionActions: SEND }), payer, 'correct-payout'), null);
  });

  /**
   * The page with a round's form open and filled: the page's own states come first (its note box is the first ''),
   * then the form's, so `typed` fills the form's '' states in the order it declares them.
   */
  function filled(detail: object, viewer: Viewer, which: 'send-back' | 'correct-payout', typed: { blanks?: string[]; picked?: Partial<PayoutCorrectionForm> }) {
    const testId = which === 'send-back' ? 'reimbursement-payout-correction-request' : 'reimbursement-payout-correction-account';
    for (let nullState = 3; nullState < 30; nullState += 1) {
      let nulls = 0;
      let blanks = 0;
      try {
        const page = render(h(ReimbursementJourneyPage, { companyId: 'company-1', requestId: 'claim-1', userId: viewer.userId, permissions: viewer.permissions }), (start) => {
          if (start === null) { nulls += 1; return nulls === 2 ? detail : nulls === nullState ? which : undefined; }
          if (start === '') { blanks += 1; return blanks === 1 ? undefined : typed.blanks?.[blanks - 2]; }
          return start && typeof start === 'object' && 'saveAsDefault' in start ? { ...start, ...typed.picked } : undefined;
        }, grabForm(testId));
        if (page.handlers.form) return page;
      } catch { /* that state holds another dialog's claim */ }
    }
    throw new Error(`the page opened no ${which} form`);
  }

  it('sends the claim back from the page, says so, reads the claim again and closes the form', async () => {
    const sentBack = asAnswered(phaseA());
    const page = filled(ready({ payoutCorrectionActions: SEND }), payer, 'send-back', { blanks: ['ACCOUNT_UNUSABLE', 'ธนาคารแจ้งว่าบัญชีปิดแล้ว'] });
    toasts.length = 0;
    const calls = await withApi(() => ({ status: 200, body: sentBack }), () => page.handlers.form.onSubmit(submitEvent));
    assert.deepEqual(calls, [
      { url: '/api/v1/companies/company-1/reimbursements/claim-1/payout-correction', method: 'POST', body: { reasonCode: 'ACCOUNT_UNUSABLE', note: 'ธนาคารแจ้งว่าบัญชีปิดแล้ว' } },
      // The answer carries no flags of this viewer: the claim is read again.
      { url: '/api/v1/companies/company-1/reimbursements/claim-1', method: 'GET', body: undefined },
    ]);
    assert.deepEqual(toasts, ['ส่งกลับให้ผู้เบิกแก้บัญชีรับเงินแล้ว']);
    assert.ok(page.changes.some((change) => change.initial === null && (change.value as { status?: string } | null)?.status === 'PENDING_APPROVAL'), 'the page shows the claim as read again');
    assert.ok(page.changes.some((change) => change.initial === null && change.value === null), 'the form is closed');
  });

  // Before: "ส่งกลับให้ผู้เบิกแก้บัญชีรับเงินแล้ว" after every send-back, and "ส่งกลับให้แก้อีกครั้ง" on every waiting step.
  it('says, once the claim is sent back, what its requester is asked for by what the claim held, and names the approvers\' send-back for the answer', async () => {
    for (const [held, said] of [
      ['ACCOUNT', 'ส่งกลับให้ผู้เบิกแก้บัญชีรับเงินแล้ว'], ['CASH', 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้งแล้ว'], ['NOTHING', 'ส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงินแล้ว'],
    ] as const) {
      const page = filled(readyHolding(held, { payoutCorrectionActions: SEND }), payer, 'send-back', { blanks: [HOLDING[held].reasonCode, ''] });
      toasts.length = 0;
      const calls = await withApi(() => ({ status: 200, body: asAnswered(sentBackHolding(held)) }), () => page.handlers.form.onSubmit(submitEvent));
      assert.deepEqual(calls[0]!.body, { reasonCode: HOLDING[held].reasonCode }, held);
      assert.deepEqual(toasts, [said], held);
    }
    // From the step a round waits on: the approvers' button, the form it opens and what is said after, by what was answered.
    const waiting = (answer: Answer) => answeredWith(answer, { approvalActions: DECIDE, payoutCorrectionActions: SEND });
    for (const [answer, button, reason, said] of [
      ['NEW_ACCOUNT', 'ส่งกลับให้แก้อีกครั้ง', 'ACCOUNT_NAME_MISMATCH', 'ส่งกลับให้ผู้เบิกแก้บัญชีรับเงินแล้ว'],
      ['FIRST_ACCOUNT', 'ส่งกลับให้แก้อีกครั้ง', 'ACCOUNT_NUMBER_WRONG', 'ส่งกลับให้ผู้เบิกแก้บัญชีรับเงินแล้ว'],
      ['CASH_INSTEAD', 'ส่งกลับให้เลือกอีกครั้ง', 'CASH_NOT_PAYABLE', 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้งแล้ว'],
      ['FIRST_CASH', 'ส่งกลับให้เลือกอีกครั้ง', 'OTHER', 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้งแล้ว'],
    ] as const) {
      assert.deepEqual(stepCard(claimPage(waiting(answer), approver).html).buttons, ['อนุมัติ', button, 'พิมพ์ใบเบิก'], answer);
      const page = filled(waiting(answer), approver, 'send-back', { blanks: [reason, ''] });
      assert.equal(heading(page.html.slice(page.html.indexOf('data-testid="reimbursement-payout-correction-request"'))), button, answer);
      toasts.length = 0;
      await withApi(() => ({ status: 200, body: asAnswered(sentBackHolding(ANSWERS[answer].given)) }), () => page.handlers.form.onSubmit(submitEvent));
      assert.deepEqual(toasts, [said], answer);
    }
  });

  // Before: the claim was not read again, so the page under the form showed the claim as it had been until it was reopened.
  it('reads the claim again when the send-back lost its race, and keeps a form that is still offered with what was typed', async () => {
    const page = filled(ready({ payoutCorrectionActions: SEND }), payer, 'send-back', { blanks: ['ACCOUNT_UNUSABLE', 'ธนาคารแจ้งว่าบัญชีปิดแล้ว'] });
    toasts.length = 0;
    // Refused for a change that left the claim where it was: it still waits for payment, and this viewer may still send it back.
    const calls = await withApi((_url, method) => (method === 'POST' ? { status: 409, body: { statusCode: 409, message: 'reimbursement_changed' } }
      : { status: 200, body: asAnswered(ready({ payoutCorrectionActions: SEND })) }), () => page.handlers.form.onSubmit(submitEvent));
    assert.deepEqual(calls.map((call) => `${call.method} ${call.url.split('/claim-1')[1]}`), ['POST /payout-correction', 'GET ']);
    assert.deepEqual(toasts, []);
    assert.ok(page.changes.some((change) => (change.value as { status?: string } | null)?.status === 'READY_FOR_PAYMENT'), 'the page shows the claim as read again');
    assert.ok(page.changes.some((change) => change.value === 'คำขอถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง · หน้านี้แสดงสถานะล่าสุดของใบแล้ว ตรวจแล้วกดอีกครั้งได้'));
    // Still offered: the page closes no form and says nothing of its own.
    assert.equal(page.changes.some((change) => change.value === PAYOUT_CORRECTION_SUPERSEDED['send-back']), false);
  });

  it('closes a send-back form that is no longer offered after the re-read, and says what was not done and where to read what can be done', async () => {
    const page = filled(ready({ payoutCorrectionActions: SEND }), payer, 'send-back', { blanks: ['ACCOUNT_UNUSABLE', ''] });
    toasts.length = 0;
    // Someone else sent the claim back first: it is with its requester now, and nobody sends it back again.
    const calls = await withApi((_url, method) => (method === 'POST' ? { status: 409, body: { statusCode: 409, message: 'payout_correction_in_progress' } }
      : { status: 200, body: asAnswered(phaseA()) }), () => page.handlers.form.onSubmit(submitEvent));
    assert.equal(calls.length, 2);
    assert.deepEqual(toasts, []);
    assert.ok(page.changes.some((change) => (change.value as { payoutCorrectionPhase?: string } | null)?.payoutCorrectionPhase === 'AWAITING_REQUESTER'), 'the page shows the claim in its round');
    assert.ok(page.changes.some((change) => change.value === PAYOUT_CORRECTION_SUPERSEDED['send-back']), 'the page says why the form is gone');
    // A re-read that fails leaves the page as it is: the form keeps the server's sentence and what was typed.
    const offline = filled(ready({ payoutCorrectionActions: SEND }), payer, 'send-back', { blanks: ['ACCOUNT_UNUSABLE', ''] });
    await withApi(() => ({ status: 409, body: { statusCode: 409, message: 'reimbursement_changed' } }), () => offline.handlers.form.onSubmit(submitEvent));
    assert.ok(offline.changes.some((change) => change.value === 'คำขอถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง'));
    assert.equal(offline.changes.some((change) => (change.value as { status?: string } | null)?.status !== undefined), false, 'the claim on the page is not replaced');
  });

  it('gives the account from the page and says where the claim went: to its approvers, or straight back to the pay step', async () => {
    // Before: "บันทึกบัญชีรับเงินแล้ว รอผู้อนุมัติอนุมัติบัญชีใหม่" after every answer, cash and a kept account included.
    for (const [answer, said] of [
      [asAnswered(phaseB()), 'บันทึกวิธีรับเงินคืนแล้ว รอผู้อนุมัติอนุมัติบัญชีรับเงินใหม่'],
      [asAnswered(answeredWith('SAME_ACCOUNT')), 'บันทึกวิธีรับเงินคืนแล้ว รอผู้อนุมัติอนุมัติบัญชีรับเงินเดิม'],
      [asAnswered(answeredWith('CASH_INSTEAD')), 'บันทึกวิธีรับเงินคืนแล้ว รอผู้อนุมัติอนุมัติการรับเป็นเงินสด'],
      [asAnswered(answeredWith('FIRST_ACCOUNT')), 'บันทึกวิธีรับเงินคืนแล้ว รอผู้อนุมัติอนุมัติบัญชีรับเงิน'],
      // An answer from a server that does not say what was answered: the method, which is true of every answer.
      [asAnswered(phaseB({ payoutCorrectionAnswer: undefined })), 'บันทึกวิธีรับเงินคืนแล้ว รอผู้อนุมัติอนุมัติวิธีรับเงินคืน'],
      // Plan 3.12: a claim nobody has to approve is ready for payment in the same call.
      [asAnswered(ready({ approvalSteps: [], payoutMethod: 'CASH', payout: { payoutMethod: 'CASH' } })), 'บันทึกวิธีรับเงินคืนแล้ว ใบกลับไปรอจ่ายเงินคืน'],
    ] as const) {
      const page = filled(phaseA({ payoutCorrectionActions: GIVE }), requester, 'correct-payout', { picked: { mode: 'CASH' } });
      toasts.length = 0;
      const calls = await withApi(() => ({ status: 200, body: answer }), () => page.handlers.form.onSubmit(submitEvent));
      assert.deepEqual(calls.map((call) => `${call.method} ${call.url.split('/claim-1')[1]}`), ['PUT /payout-destination', 'GET ']);
      assert.deepEqual(calls[0]!.body, { mode: 'CASH' });
      assert.deepEqual(toasts, [said]);
    }
  });

  // A second press that arrives after the first was taken (another tab, or a press again after a lost answer).
  it('closes an account form whose claim changed after it was opened, even where the form is still offered, and says what to look at', async () => {
    const page = filled(phaseA({ payoutCorrectionActions: GIVE, updatedAt: AT.sentBack }), requester, 'correct-payout', { picked: { mode: 'CASH' } });
    toasts.length = 0;
    // The earlier press was taken: the claim waits for its approvers with that account, and its requester may still give another.
    const calls = await withApi((_url, method) => (method === 'PUT' ? { status: 409, body: { statusCode: 409, code: 'reimbursement_changed', message: 'Reimbursement changed. Reload and retry.' } }
      : { status: 200, body: asAnswered(phaseB({ payoutCorrectionActions: GIVE, updatedAt: AT.given })) }), () => page.handlers.form.onSubmit(submitEvent));
    assert.deepEqual(calls.map((call) => `${call.method} ${call.url.split('/claim-1')[1]}`), ['PUT /payout-destination', 'GET '], 'refused once, then the claim is read again; nothing is sent a second time');
    assert.deepEqual(calls[0]!.body, { mode: 'CASH', expectedUpdatedAt: AT.sentBack });
    assert.deepEqual(toasts, []);
    assert.ok(page.changes.some((change) => (change.value as { payoutCorrectionPhase?: string } | null)?.payoutCorrectionPhase === 'AWAITING_APPROVAL'), 'the page shows the claim as read again');
    assert.ok(page.changes.some((change) => change.value === PAYOUT_CORRECTION_STALE_PRESS), 'the page says what was not done and what to look at');
    assert.equal(page.changes.some((change) => typeof change.value === 'string' && change.value.includes(PAYOUT_CORRECTION_REREAD_NOTE)), false, 'nothing invites the same press again');
    // Before: "ยังไม่ได้บันทึกบัญชีรับเงินครั้งนี้ … กดปุ่มแก้บัญชีรับเงินเพื่อแก้ใหม่": what was chosen may be cash, and the button is
    // named by what the claim holds. The sentence now names no button: it says where the button is.
    assert.equal(PAYOUT_CORRECTION_STALE_PRESS,
      'ยังไม่ได้บันทึกวิธีรับเงินคืนครั้งนี้ เพราะใบนี้เปลี่ยนไปหลังจากเปิดฟอร์ม หน้านี้แสดงสถานะล่าสุดของใบแล้ว ดูที่หัวข้อการรับเงินคืนว่าตอนนี้ใบใช้วิธีรับเงินคืนใด ถ้ายังไม่ถูก กดปุ่มในขั้นตอนนี้เพื่อเลือกอีกครั้ง');
    assert.equal(PAYOUT_CORRECTION_SUPERSEDED['correct-payout'], 'ยังไม่ได้บันทึกวิธีรับเงินคืน เพราะมีผู้ทำรายการกับใบนี้ไปก่อนแล้ว หน้านี้แสดงสถานะล่าสุดของใบ ดูในขั้นตอนนี้ว่าใบรอใคร และทำต่อได้ตามปุ่มที่แสดง');
    assertPlainThai([PAYOUT_CORRECTION_STALE_PRESS, PAYOUT_CORRECTION_SUPERSEDED['correct-payout']], 'the sentences of a form the page closed');
    // The page it describes: the claim in its round shows the card "การรับเงินคืน" and offers, in its step, the button to choose again.
    for (const [answer, button] of [['NEW_ACCOUNT', 'แก้บัญชีรับเงินอีกครั้ง'], ['CASH_INSTEAD', 'เลือกวิธีรับเงินคืนอีกครั้ง']] as const) {
      const after = claimPage(answeredWith(answer, { payoutCorrectionActions: GIVE }), requester);
      assert.ok(after.texts.includes('การรับเงินคืน') && stepCard(after.html).buttons.includes(button), `${answer}: ${JSON.stringify(stepCard(after.html).buttons)}`);
    }
  });

  it('says the round is over when the claim that changed no longer offers the account form, and keeps a form whose claim did not change', async () => {
    // Approved meanwhile: the claim is back at its pay step and nobody gives its account.
    const over = filled(phaseB({ payoutCorrectionActions: GIVE, updatedAt: AT.given }), requester, 'correct-payout', { picked: { mode: 'CASH' } });
    await withApi((_url, method) => (method === 'PUT' ? { status: 409, body: { statusCode: 409, code: 'reimbursement_changed', message: 'Reimbursement changed. Reload and retry.' } }
      : { status: 200, body: asAnswered(reapproved({ updatedAt: AT.reapproved })) }), () => over.handlers.form.onSubmit(submitEvent));
    assert.ok(over.changes.some((change) => change.value === PAYOUT_CORRECTION_SUPERSEDED['correct-payout']));
    assert.equal(over.changes.some((change) => change.value === PAYOUT_CORRECTION_STALE_PRESS), false);
    // The default account shown is no longer the default: the claim is the one the form read, so the form stays with the fresh default under it.
    const same = filled(phaseA({ payoutCorrectionActions: GIVE, updatedAt: AT.sentBack }), requester, 'correct-payout', { picked: { mode: 'CASH' } });
    const calls = await withApi((_url, method) => (method === 'PUT' ? { status: 409, body: { statusCode: 409, message: 'payout_destination_changed' } }
      : { status: 200, body: asAnswered(phaseA({ payoutCorrectionActions: GIVE, updatedAt: AT.sentBack })) }), () => same.handlers.form.onSubmit(submitEvent));
    assert.equal(calls.length, 2);
    assert.ok(same.changes.some((change) => change.value === `${translateApiError('payout_destination_changed')!} · ${PAYOUT_CORRECTION_REREAD_NOTE}`));
    assert.equal(same.changes.some((change) => change.value === PAYOUT_CORRECTION_STALE_PRESS || change.value === PAYOUT_CORRECTION_SUPERSEDED['correct-payout']), false, 'the page closes nothing');
  });
});

describe('the approval of a round: the comparison, the attestation of the NEW account, and no refusal (spec §14.6, AC31)', () => {
  const asApprover = (overrides: Record<string, unknown> = {}) => phaseB({ approvalActions: DECIDE, payoutCorrectionActions: SEND, ...overrides });

  it('shows the comparison card in the approval step card, above the attestation tick and the two buttons', () => {
    const { html } = claimPage(asApprover(), approver);
    const card = stepCard(html);
    const order = ['สิ่งที่รออนุมัติ: บัญชีรับเงินใหม่</h3>', 'ฉันตรวจแล้วว่าบัญชีนี้เป็นบัญชีรับเงินของผู้เบิก</span>', 'อนุมัติ</button>', 'ส่งกลับให้แก้อีกครั้ง</button>']
      .map((text) => card.html.indexOf(`>${text}`));
    assert.ok(order.every((at) => at >= 0) && order.join() === [...order].sort((a, b) => a - b).join(), order.join());
    assert.ok(visible(card.html).includes('รายการและยอดเงิน 1,614.50 บาท เท่ากับที่อนุมัติไว้เมื่อ 1 ต.ค. 2569 10:00 น. การอนุมัติครั้งนี้ตรวจเฉพาะบัญชีรับเงิน'));
    // Every reader of the claim sees what changed; only whoever decides it gets the tick and the buttons.
    for (const viewer of [requester, payer, auditor]) {
      const other = stepCard(claimPage(phaseB(), viewer).html);
      assert.match(other.html, /data-testid="reimbursement-payout-correction-comparison"/);
      assert.equal(visible(other.html).includes('ฉันตรวจแล้วว่าบัญชีนี้เป็นบัญชีรับเงินของผู้เบิก'), false);
    }
    // No card while the claim waits for its requester, nor once the round is over.
    for (const detail of [phaseA(), reapproved(), ready()]) assert.doesNotMatch(claimPage(detail, approver).html, /reimbursement-payout-correction-comparison/);
  });

  const grabApprove = (type: unknown, _props: unknown, children: unknown[]) => (type === 'button' && children[0] === 'อนุมัติ' ? 'approve' : undefined);
  /** The approver's page with a tick already given for one account version (the page keeps it in a null state), or null when that is no tick. */
  const tickedFor = (version: number, detail: object = asApprover()) => {
    for (let nullState = 3; nullState < 30; nullState += 1) {
      const page = opened(detail, approver, { nullState, value: version }, grabApprove);
      if (page && /<input type="checkbox"[^>]*checked=""/u.test(stepCard(page.html).html)) return page;
    }
    return null;
  };

  it('keeps อนุมัติ off until the new account version is ticked, and a tick given for the old version is no tick', () => {
    const button = (html: string) => /<button\b([^>]*)>อนุมัติ<\/button>/u.exec(html)![1]!;
    const untouched = claimPage(asApprover(), approver).html;
    assert.match(button(untouched), /disabled=""/);
    assert.match(button(untouched), /title="ติ๊กยืนยันว่าตรวจบัญชีรับเงินแล้วก่อนอนุมัติ"/);
    const ticked = tickedFor(2);
    assert.ok(ticked, 'a tick for version 2 is a tick');
    assert.doesNotMatch(button(ticked.html), /disabled=""/);
    assert.equal(tickedFor(1), null, 'the tick the first approval was given with attests nothing of the new account');
  });

  it('approves with the hash and the account version the card showed, through the approval endpoint, and says the claim is back at its pay step', async () => {
    const backAtPayStep = asAnswered(reapproved());
    const page = tickedFor(2)!;
    toasts.length = 0;
    const calls = await withApi(() => ({ status: 200, body: backAtPayStep }), () => page.handlers.approve.onClick());
    assert.deepEqual(calls, [
      { url: '/api/v1/companies/company-1/reimbursements/claim-1/approve', method: 'POST', body: { approvalSnapshotHash: 'hash-of-version-2', payoutVerifiedVersion: 2 } },
      { url: '/api/v1/companies/company-1/reimbursements/claim-1', method: 'GET', body: undefined },
    ]);
    assert.deepEqual(toasts, ['อนุมัติบัญชีรับเงินใหม่แล้ว ใบกลับไปรอจ่ายเงินคืน']);
    // Without the tick the press asks nothing of the API and says why.
    const unticked = claimPage(asApprover(), approver, undefined, grabApprove);
    const refused = await withApi(() => ({ status: 200, body: backAtPayStep }), () => unticked.handlers.approve.onClick());
    assert.deepEqual(refused, []);
    assert.ok(unticked.changes.some((change) => change.value === 'ติ๊กยืนยันว่าตรวจบัญชีรับเงินแล้วก่อนอนุมัติ'));
  });

  // Seen in review: the approver opened "ส่งกลับให้แก้อีกครั้ง", then approved instead. The claim went to its pay step,
  // where the same viewer may send it back, and the form they had left open was open again there.
  it('closes a send-back form left open once the claim is approved, so it is not open again at the pay step', async () => {
    let found: ReturnType<typeof render> | null = null;
    for (let tick = 3; tick < 30 && !found; tick += 1) {
      for (let form = tick + 1; form < 31 && !found; form += 1) {
        let nulls = 0;
        try {
          const page = render(h(ReimbursementJourneyPage, { companyId: 'company-1', requestId: 'claim-1', userId: approver.userId, permissions: approver.permissions }), (start) => {
            if (start !== null) return undefined;
            nulls += 1;
            return nulls === 2 ? asApprover() : nulls === tick ? 2 : nulls === form ? 'send-back' : undefined;
          }, grabApprove);
          const card = stepCard(page.html).html;
          if (/<input type="checkbox"[^>]*checked=""/u.test(card) && card.includes('data-testid="reimbursement-payout-correction-request"')) found = page;
        } catch { /* that state holds another dialog's claim */ }
      }
    }
    assert.ok(found, 'the page with the tick given and the send-back form open');
    const calls = await withApi(() => ({ status: 200, body: asAnswered(reapproved({ payoutCorrectionActions: SEND })) }), () => found!.handlers.approve.onClick());
    assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET']);
    assert.ok(found.changes.some((change) => change.shown === 'send-back' && change.value === null), 'the form the approver left open is closed');
  });

  it('tells the approver to look again when the requester gave another account meanwhile, and approves nothing unseen', async () => {
    const page = tickedFor(2)!;
    const calls = await withApi((url, method) => (method === 'POST'
      ? { status: 409, body: { statusCode: 409, message: 'stale_approval_snapshot' } }
      : { status: 200, body: asAnswered(asApprover({ approvalSnapshotHash: 'hash-of-version-3', payout: { ...SCB, accountLast4: '9990', version: 3, source: 'REQUESTER' } })) }),
    () => page.handlers.approve.onClick());
    assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET'], 'refused, then the claim is read again');
    // The dialog that compares what was seen with what the claim is now opens; nothing was approved.
    assert.ok(page.changes.some((change) => change.initial === null && !!(change.value as { before?: unknown; detail?: unknown } | null)?.detail));
  });

  // A lost race: another approver sent the new account back, or the claim was cancelled, while this page was open.
  it('offers nothing to approve again when the claim moved on meanwhile: the page shows where it stands and says so', async () => {
    for (const movedTo of [phaseA(), ready({ status: 'CANCELLED', paymentStatus: 'NOT_PAYABLE', currentDesk: undefined })]) {
      const page = tickedFor(2)!;
      toasts.length = 0;
      const calls = await withApi((url, method) => (method === 'POST'
        ? { status: 409, body: { statusCode: 409, message: 'stale_approval_snapshot' } } : { status: 200, body: asAnswered(movedTo) }), () => page.handlers.approve.onClick());
      assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET']);
      assert.deepEqual(toasts, []);
      // No dialog offering "อนุมัติด้วยข้อมูลล่าสุด", which the API would refuse: the sentence, and the claim as read again.
      assert.equal(page.changes.some((change) => !!(change.value as { before?: unknown } | null)?.before), false, String(movedTo.status));
      assert.ok(page.changes.some((change) => change.value === 'ยังไม่ได้อนุมัติ เพราะมีผู้ทำรายการกับใบนี้ไปก่อนแล้ว หน้านี้แสดงสถานะล่าสุดของใบ'));
      assert.ok(page.changes.some((change) => (change.value as { status?: string } | null)?.status === movedTo.status));
    }
  });

  it('needs no tick for a claim changed to cash, and still shows what changed', () => {
    for (const answer of ['CASH_INSTEAD', 'SAME_CASH', 'FIRST_CASH'] as const) {
      const card = stepCard(claimPage(answeredWith(answer, { approvalActions: DECIDE, payoutCorrectionActions: SEND }), approver).html);
      assert.equal(visible(card.html).includes('ฉันตรวจแล้วว่าบัญชีนี้เป็นบัญชีรับเงินของผู้เบิก'), false, answer);
      assert.doesNotMatch(/<button\b([^>]*)>อนุมัติ<\/button>/u.exec(card.html)![1]!, /disabled=""/, answer);
      assert.ok(visible(card.html).includes('รับเป็นเงินสด'), answer);
      // The way not to take cash is to send it back to be chosen again: nothing is "corrected".
      assert.deepEqual(card.buttons, ['อนุมัติ', 'ส่งกลับให้เลือกอีกครั้ง', 'พิมพ์ใบเบิก'], answer);
    }
  });

  // Before: two notes. "รอคุณอนุมัติบัญชีรับเงินใหม่ ตรวจบัญชีเดิมกับบัญชีใหม่ด้านล่าง…" for every answer the server did not call
  // the same, cash and a first account included; and "…บัญชีที่ส่งมาคือบัญชีเดิมของใบนี้ … ตรวจบัญชีด้านล่าง" for cash kept as cash.
  it('tells whoever approves what waits for them, what was done and what to look at, for each of the seven answers', () => {
    const NOTES: Record<Answer, string> = {
      NEW_ACCOUNT: 'รอคุณอนุมัติบัญชีรับเงินใหม่ ตรวจบัญชีเดิมกับบัญชีใหม่ด้านล่างก่อนอนุมัติ รายการและยอดเงินไม่เปลี่ยน',
      SAME_ACCOUNT: 'รอคุณอนุมัติบัญชีรับเงินเดิม ผู้เบิกยืนยันบัญชีเดิมของใบนี้ ไม่ได้เปลี่ยน ตรวจบัญชีด้านล่างก่อนอนุมัติ รายการและยอดเงินไม่เปลี่ยน',
      CASH_INSTEAD: 'รอคุณอนุมัติการรับเป็นเงินสด ผู้เบิกเปลี่ยนจากโอนเข้าบัญชีเป็นรับเป็นเงินสด รายการและยอดเงินไม่เปลี่ยน',
      ACCOUNT_INSTEAD: 'รอคุณอนุมัติบัญชีรับเงิน ผู้เบิกเปลี่ยนจากรับเป็นเงินสดเป็นโอนเข้าบัญชี ตรวจบัญชีด้านล่างก่อนอนุมัติ รายการและยอดเงินไม่เปลี่ยน',
      SAME_CASH: 'รอคุณอนุมัติการรับเป็นเงินสด ผู้เบิกยืนยันรับเป็นเงินสดตามเดิม ไม่ได้เปลี่ยน รายการและยอดเงินไม่เปลี่ยน',
      FIRST_ACCOUNT: 'รอคุณอนุมัติบัญชีรับเงิน ใบนี้ไม่เคยมีบัญชีรับเงิน ตรวจบัญชีที่ผู้เบิกเพิ่มด้านล่างก่อนอนุมัติ รายการและยอดเงินไม่เปลี่ยน',
      FIRST_CASH: 'รอคุณอนุมัติการรับเป็นเงินสด ใบนี้ไม่เคยมีบัญชีรับเงิน ผู้เบิกเลือกรับเป็นเงินสด รายการและยอดเงินไม่เปลี่ยน',
    };
    const mine = (detail: Record<string, unknown>) => active({ ...detail, approvalActions: DECIDE, payoutCorrectionActions: SEND }, approver).note;
    for (const answer of ALL_ANSWERS) {
      assert.equal(mine(answeredWith(answer)), NOTES[answer], answer);
      // Cash has no account to check, so its note asks for none to be looked at.
      assert.equal(/ตรวจบัญชี/u.test(NOTES[answer]), ANSWERS[answer].given === 'ACCOUNT', answer);
      assertPlainThai([NOTES[answer]], `the approver's note of ${answer}`);
    }
    // Someone answered for the requester: the note says who, and never that the requester did it.
    assert.equal(mine(answeredWith('SAME_ACCOUNT', {}, ON_BEHALF)),
      'รอคุณอนุมัติบัญชีรับเงินเดิม สุภาวดี นักบัญชี ยืนยันบัญชีเดิมของใบนี้แทนผู้เบิก ไม่ได้เปลี่ยน ตรวจบัญชีด้านล่างก่อนอนุมัติ รายการและยอดเงินไม่เปลี่ยน');
    assert.equal(mine(answeredWith('FIRST_CASH', {}, ON_BEHALF)), 'รอคุณอนุมัติการรับเป็นเงินสด ใบนี้ไม่เคยมีบัญชีรับเงิน สุภาวดี นักบัญชี เลือกรับเป็นเงินสดแทนผู้เบิก รายการและยอดเงินไม่เปลี่ยน');
    assert.equal(mine(answeredWith('FIRST_ACCOUNT', {}, ON_BEHALF)), 'รอคุณอนุมัติบัญชีรับเงิน ใบนี้ไม่เคยมีบัญชีรับเงิน ตรวจบัญชีที่ สุภาวดี นักบัญชี เพิ่มแทนผู้เบิกด้านล่างก่อนอนุมัติ รายการและยอดเงินไม่เปลี่ยน');
    // No answer on the claim (a page fed by an older server): what is true of every answer, and nothing about what was done.
    assert.equal(mine(phaseB({ payoutCorrectionAnswer: undefined })), 'รอคุณอนุมัติวิธีรับเงินคืน รายการและยอดเงินไม่เปลี่ยน');
  });

  // Before: "อนุมัติบัญชีรับเงินใหม่แล้ว ใบกลับไปรอจ่ายเงินคืน" after every approval of a round.
  it('says what was approved once it is approved, by what was answered', async () => {
    for (const [answer, said] of [
      ['SAME_ACCOUNT', 'อนุมัติบัญชีรับเงินเดิมแล้ว ใบกลับไปรอจ่ายเงินคืน'], ['FIRST_ACCOUNT', 'อนุมัติบัญชีรับเงินแล้ว ใบกลับไปรอจ่ายเงินคืน'],
      ['CASH_INSTEAD', 'อนุมัติการรับเป็นเงินสดแล้ว ใบกลับไปรอจ่ายเงินคืน'], ['SAME_CASH', 'อนุมัติการรับเป็นเงินสดแล้ว ใบกลับไปรอจ่ายเงินคืน'],
    ] as const) {
      const detail = answeredWith(answer, { approvalActions: DECIDE, payoutCorrectionActions: SEND });
      // An account is approved with its tick; cash has none to give.
      const page = ANSWERS[answer].given === 'ACCOUNT' ? tickedFor((detail.payout as { version: number }).version, detail)! : claimPage(detail, approver, undefined, grabApprove);
      toasts.length = 0;
      const calls = await withApi(() => ({ status: 200, body: asAnswered(reapproved()) }), () => page.handlers.approve.onClick());
      assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET'], answer);
      assert.deepEqual(toasts, [said], answer);
    }
  });
});

describe('after the approval the claim is back at its pay step with the new account (AC31)', () => {
  it('shows the new account in the box "โอนเข้าบัญชีนี้" with who attested it, and offers the payment and a new send-back', () => {
    const { html, texts } = claimPage(reapproved({ payoutCorrectionActions: SEND }), payer);
    assert.deepEqual(stepCard(html).buttons, ['บันทึกจ่าย', 'พิมพ์ใบเบิก']);
    assert.equal(accountBoxSendBack(html)?.action, 'ส่งกลับให้แก้บัญชีรับเงิน');
    for (const text of ['โอนเข้าบัญชีนี้', 'ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 1112', 'ผู้เบิกระบุบัญชีนี้สำหรับใบนี้', 'ตรวจบัญชีแล้วโดย สมศรี ผู้จัดการ เมื่อ 1 ต.ค. 2569 13:00 น.']) {
      assert.ok(texts.includes(text), text);
    }
    // The account it had before stays in the card's history, and is not the one in use.
    const history = html.slice(html.indexOf('data-testid="reimbursement-payout-history"'));
    assert.ok(visible(history).includes('ธนาคารกสิกรไทย เลขบัญชีลงท้าย 5678 · ชื่อบัญชี นาย สมชาย ใจดี'));
    assert.equal(visible(history).filter((text) => text === 'ใช้อยู่ตอนนี้').length, 1);
    assert.doesNotMatch(html, /reimbursement-payout-correction-note/);
  });

  // Plan 3.12: nobody approves it, so whoever pays it is the one to check the account.
  it('a claim nobody has to approve: no approval of the round, and the payer is told they are the one to check the account', () => {
    const noApproval = ready({ approvalSteps: [], approvedAt: AT.given, payout: { ...SCB, source: 'REQUESTER' }, payoutHistory: [version2],
      payoutCorrectionHistory: [SENT_BACK, GIVEN], payoutCorrectionActions: SEND });
    assert.deepEqual(strip(noApproval), ['items:done', 'approval:done', 'payment:current', 'document:upcoming']);
    assert.equal(logic.buildJourneySteps(noApproval, [], 'someone')[1]!.note, 'ไม่ต้องอนุมัติตามนโยบาย');
    const { texts } = claimPage(noApproval, payer);
    assert.ok(texts.includes('ยังไม่มีผู้ตรวจบัญชีนี้'));
    // While it waited for its requester, nobody was offered an approval and no step waited.
    const waiting = phaseA({ approvalSteps: [], payoutCorrectionActions: GIVE });
    assert.deepEqual(stepCard(claimPage(waiting, requester).html).buttons, ['แก้บัญชีรับเงิน', 'ยกเลิกคำขอ', 'พิมพ์ใบเบิก']);
  });
});

describe('the card "การรับเงินคืน" in a round', () => {
  it('says which account it is showing: the one in question, then the new one nobody approved yet', () => {
    const a = claimPage(phaseA(), auditor).texts;
    assert.ok(a.includes('ใบนี้ถูกส่งกลับให้แก้บัญชีรับเงิน ด้านล่างคือบัญชีที่ถูกส่งกลับ ระหว่างนี้ยังบันทึกจ่ายไม่ได้'));
    assert.ok(a.includes('ธนาคารกสิกรไทย เลขบัญชีลงท้าย 5678'));
    const b = claimPage(phaseB(), auditor).texts;
    assert.ok(b.includes('ด้านล่างคือวิธีรับเงินคืนที่ผู้เบิกส่งมา รอผู้อนุมัติอนุมัติก่อนจึงจ่ายได้'));
    assert.ok(b.includes('ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 1112') && b.includes('ยังไม่มีผู้ตรวจบัญชีนี้'));
    // Never "โอนเข้าบัญชีนี้" in a round: nobody is offered the payment.
    for (const texts of [a, b]) assert.equal(texts.includes('โอนเข้าบัญชีนี้'), false);
  });

  const note = (detail: object) => { const html = claimPage(detail, auditor).html; return /data-testid="reimbursement-payout-correction-note">([^<]*)</u.exec(html)?.[1] ?? null; };

  // Before: "ใบนี้ถูกส่งกลับให้แก้บัญชีรับเงิน ด้านล่างคือวิธีรับเงินเดิมของใบ" above "ผู้เบิกขอรับเป็นเงินสด ไม่ต้องมีบัญชี", and the same
  // "เดิมของใบ" above an answer the approver had just sent back.
  it('says of a claim with its requester what was sent back, by what the claim holds, and nothing of an account where there is none', () => {
    assert.equal(note(sentBackHolding('ACCOUNT')), 'ใบนี้ถูกส่งกลับให้แก้บัญชีรับเงิน ด้านล่างคือบัญชีที่ถูกส่งกลับ ระหว่างนี้ยังบันทึกจ่ายไม่ได้');
    assert.equal(note(sentBackHolding('CASH')), 'ใบนี้ถูกส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง ด้านล่างคือวิธีรับเงินคืนที่ถูกส่งกลับ ระหว่างนี้ยังบันทึกจ่ายไม่ได้');
    assert.equal(note(sentBackHolding('NOTHING')), 'ใบนี้ถูกส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน ระหว่างนี้ยังบันทึกจ่ายไม่ได้');
    // Under it, what the claim states: nobody answered this round yet, and no fact says who chose cash on the draft.
    const cash = claimPage(sentBackHolding('CASH'), auditor).texts;
    assert.ok(cash.includes('ใบนี้ระบุรับเป็นเงินสด ไม่ต้องมีบัญชี'));
    // An answer sent back again from the waiting step is what the claim shows: "ที่ถูกส่งกลับ", never "เดิมของใบ".
    for (const held of HELD) assert.doesNotMatch(note(sentBackHolding(held))!, /เดิมของใบ/u);
    assert.equal(note(ready()), null);
  });

  // Before: "ด้านล่างคือวิธีรับเงินใหม่ที่ผู้เบิกส่งมา" above every answer: an account that was kept, cash that was kept, and an
  // answer a finance reviewer gave. And "ผู้เบิกขอรับเป็นเงินสด" under cash that someone else chose for the requester.
  it('says of an answer that waits who sent it, and of cash who chose it', () => {
    for (const answer of ALL_ANSWERS) {
      assert.equal(note(answeredWith(answer)), 'ด้านล่างคือวิธีรับเงินคืนที่ผู้เบิกส่งมา รอผู้อนุมัติอนุมัติก่อนจึงจ่ายได้', answer);
      assert.equal(note(answeredWith(answer, {}, ON_BEHALF)), 'ด้านล่างคือวิธีรับเงินคืนที่ สุภาวดี นักบัญชี ส่งมาแทนผู้เบิก รอผู้อนุมัติอนุมัติก่อนจึงจ่ายได้', answer);
    }
    const OWN = 'ผู้เบิกขอรับเป็นเงินสด ไม่ต้องมีบัญชี';
    const FOR_THEM = 'สุภาวดี นักบัญชี เลือกรับเป็นเงินสดแทนผู้เบิก ไม่ต้องมีบัญชี';
    for (const answer of ['CASH_INSTEAD', 'SAME_CASH', 'FIRST_CASH'] as const) {
      assert.ok(claimPage(answeredWith(answer), auditor).texts.includes(OWN), answer);
      const onBehalf = claimPage(answeredWith(answer, {}, ON_BEHALF), auditor).texts;
      assert.deepEqual([onBehalf.includes(FOR_THEM), onBehalf.includes(OWN)], [true, false], answer);
    }
    // After the round, and when that cash is sent back again: still whoever chose it, from the claim's history.
    const history = answeredWith('CASH_INSTEAD', {}, ON_BEHALF).payoutCorrectionHistory;
    const paidInCash = readyHolding('CASH', { payoutCorrectionHistory: [...history, { ...REAPPROVED, answer: 'CASH_INSTEAD' }] });
    assert.deepEqual([claimPage(paidInCash, auditor).texts.includes(FOR_THEM), claimPage(paidInCash, auditor).texts.includes(OWN)], [true, false]);
    assert.ok(claimPage(sentBackHolding('CASH', { payoutCorrectionHistory: history }), auditor).texts.includes(FOR_THEM));
    // A claim whose requester answered a round with cash still says so: that is the round's own fact.
    assert.ok(claimPage(readyHolding('CASH', { payoutCorrectionHistory: answeredWith('SAME_CASH').payoutCorrectionHistory }), auditor).texts.includes(OWN));
    // Outside a round no fact says who chose cash: whoever prepared the claim for the requester may have. Before, the card
    // said "ผู้เบิกขอรับเป็นเงินสด" of every such claim. It says what the claim states, and names nobody.
    const STATED = 'ใบนี้ระบุรับเป็นเงินสด ไม่ต้องมีบัญชี';
    const prepared = { createdByUserId: 'accountant', createdByName: 'สุภาวดี นักบัญชี' };
    for (const detail of [readyHolding('CASH'), readyHolding('CASH', prepared), sentBackHolding('CASH'), sentBackHolding('CASH', prepared)]) {
      for (const viewer of [auditor, requester, payer]) {
        const texts = claimPage(detail, viewer).texts;
        assert.deepEqual([texts.includes(STATED), texts.includes(OWN)], [true, false], viewer.userId);
      }
    }
    assert.deepEqual([claimCashNote({}), claimCashNote({ payoutCorrectionHistory: [sentBackEvent('CASH')] as never })], [STATED, STATED]);
  });

  // Decision D8. Before: the card said "ยังไม่มีผู้ตรวจบัญชีนี้" of the account the claim was approved with, right above a
  // history that listed that one account twice, each "เริ่มใช้กับใบนี้เมื่อ …", the second with the day it was kept.
  it('shows an account that was kept once, never as unchecked, and tells what happened to it in one row of the history', () => {
    /** The account history of the card, as it reads: its heading, then each row. Null: the card shows none. */
    const historyOf = (detail: object) => {
      const html = claimPage(detail, auditor).html;
      const at = html.indexOf('data-testid="reimbursement-payout-history"');
      return at < 0 ? null : visible(html.slice(html.indexOf('>', at) + 1, html.indexOf('</ol>', at)));
    };
    const KEPT = 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 5678 · ชื่อบัญชี นาย สมชาย ใจดี';
    const waiting = answeredWith('SAME_ACCOUNT');
    const texts = claimPage(waiting, auditor).texts;
    assert.deepEqual([texts.includes('ยังไม่มีผู้ตรวจบัญชีนี้'), texts.includes('รอผู้อนุมัติตรวจบัญชีนี้อีกครั้ง')], [false, true]);
    assert.deepEqual(historyOf(waiting), ['ประวัติบัญชีรับเงินของใบนี้', KEPT, 'ใช้อยู่ตอนนี้',
      'เริ่มใช้กับใบนี้เมื่อ 1 ต.ค. 2569 09:00 น.', 'ใช้บัญชีประจำของผู้เบิก', 'ตรวจบัญชีแล้วโดย สมศรี ผู้จัดการ เมื่อ 1 ต.ค. 2569 10:00 น.',
      'ผู้เบิกยืนยันบัญชีเดิม เมื่อ 1 ต.ค. 2569 12:00 น.']);
    // Someone kept it for the requester: the row says who.
    assert.equal(historyOf(answeredWith('SAME_ACCOUNT', {}, ON_BEHALF))!.at(-1), 'สุภาวดี นักบัญชี ยืนยันบัญชีเดิมแทนผู้เบิก เมื่อ 1 ต.ค. 2569 12:00 น.');
    // Approved again: the same one row, now with who checked it the second time, and the card says the same above it.
    const again = { ...waiting.payoutHistory[1], ...attested, verifiedAt: AT.reapproved, approvalStepId: 'step-2' };
    const approved = ready({ approvedAt: AT.reapproved, payout: { ...KBANK, version: 2, source: 'DEFAULT_ACCOUNT', ...attested, verifiedAt: AT.reapproved }, payoutHistory: [version1, again],
      payoutCorrectionHistory: [...waiting.payoutCorrectionHistory, { ...REAPPROVED, answer: 'SAME_ACCOUNT' }] });
    assert.deepEqual(historyOf(approved)!.slice(-2), ['ผู้เบิกยืนยันบัญชีเดิม เมื่อ 1 ต.ค. 2569 12:00 น.', 'ตรวจบัญชีแล้วโดย สมศรี ผู้จัดการ เมื่อ 1 ต.ค. 2569 13:00 น.']);
    assert.equal(historyOf(approved)!.filter((text) => text === KEPT).length, 1);
    // The account kept and then sent back by the approver: still not said to be unchecked, and nothing waits for its check.
    const refused = sentBackHolding('ACCOUNT', { payout: waiting.payout, payoutHistory: waiting.payoutHistory,
      payoutCorrectionHistory: [...waiting.payoutCorrectionHistory, { kind: 'SENT_BACK', at: '2026-10-01T05:30:00.000Z', byUserId: 'boss', byName: NAMES.approver, reasonCode: 'OTHER', held: 'ACCOUNT' }] });
    const afterRefusal = claimPage(refused, auditor).texts;
    assert.deepEqual([afterRefusal.includes('ยังไม่มีผู้ตรวจบัญชีนี้'), afterRefusal.includes('รอผู้อนุมัติตรวจบัญชีนี้อีกครั้ง')], [false, false]);
    // Another account is another row, and nobody has checked it yet: as before.
    assert.equal(historyOf(phaseB())!.filter((text) => text.startsWith('เริ่มใช้กับใบนี้เมื่อ')).length, 2);
    assert.ok(claimPage(phaseB(), auditor).texts.includes('ยังไม่มีผู้ตรวจบัญชีนี้'));
    // Two versions that read alike are folded only where the server said the later one kept the account: never from the digits shown.
    const alike = answeredWith('SAME_ACCOUNT', { payoutCorrectionAnswer: 'NEW_ACCOUNT', payoutCorrectionHistory: [sentBackEvent('ACCOUNT'), { ...GIVEN, answer: 'NEW_ACCOUNT' }] });
    assert.equal(historyOf(alike)!.filter((text) => text === KEPT).length, 2);
    assert.ok(claimPage(alike, auditor).texts.includes('ยังไม่มีผู้ตรวจบัญชีนี้'));
  });

  // Plan 3.13: a claim sent before claims carried an account gets one through the same path.
  it('a claim sent before claims carried an account: says it is to be given one, then shows the account it was given', () => {
    const a = claimPage(sentBackHolding('NOTHING'), auditor).texts;
    assert.ok(a.includes('ใบนี้ถูกส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน ระหว่างนี้ยังบันทึกจ่ายไม่ได้'));
    assert.ok(a.includes('ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน จึงไม่มีบัญชีที่ผ่านการอนุมัติในใบ'));
    const b = stepCard(claimPage(answeredWith('FIRST_ACCOUNT'), auditor).html);
    assert.ok(visible(b.html).includes('ไม่มี ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน'));
    assert.ok(visible(b.html).includes('ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 1112 · ชื่อบัญชี นาย สมชาย ใจดี'));
  });

  it('tells a requester whose default account changed how to take it onto the claim, where the server lets them', () => {
    const changed = (overrides: Record<string, unknown>) => ({ payout: { ...KBANK, source: 'DEFAULT_ACCOUNT', defaultAccountChanged: true as const }, ...overrides });
    const hint = (detail: object) => claimPage(detail, requester).texts.find((text) => text.startsWith('บัญชีรับเงินคืนประจำของคุณเปลี่ยนแล้ว'))!;
    assert.match(hint(ready(changed({ payoutCorrectionActions: SEND }))), /ถ้าต้องการให้ใบนี้ใช้บัญชีใหม่ กดส่งกลับให้แก้บัญชีรับเงินที่ท้ายกล่องนี้ ก่อนมีการโอน$/u);
    // "กล่องนี้" is the box that says it: the hint and the action it names are in the same card.
    const page = claimPage(ready(changed({ payoutCorrectionActions: SEND })), requester).html;
    const box = page.slice(page.lastIndexOf('<div', page.indexOf('บัญชีรับเงินคืนประจำของคุณเปลี่ยนแล้ว')), page.indexOf('aria-labelledby="journey-step-title"'));
    assert.match(box, /data-testid="reimbursement-payout-send-back"/);
    assert.match(hint(phaseA(changed({ payoutCorrectionActions: GIVE }))), /ถ้าต้องการให้ใบนี้ใช้บัญชีใหม่ กดแก้บัญชีรับเงินในขั้นอนุมัติ แล้วเลือกใช้บัญชีประจำ$/u);
    // No flag from the server: the hint says what it said before.
    assert.match(hint(ready(changed({}))), /แจ้งผู้อนุมัติหรือผู้จ่ายเงินก่อนมีการโอน$/u);
  });
});

describe('the claim\'s journey tells a correction round (spec §17.2)', () => {
  const rows = (detail: object) => logic.buildClaimTimeline(detail).map((row) => `${row.state}:${row.label}`);
  const FIRST = 'done:อนุมัติและตรวจบัญชีรับเงินโดย สมศรี ผู้จัดการ';
  const SENT = 'done:ส่งกลับให้แก้บัญชีรับเงินโดย วราภรณ์ การเงิน : เลขบัญชีไม่ถูกต้อง · ธนาคารแจ้งว่าไม่พบบัญชีนี้';
  /** The account-given row of the fixtures: the SCB account, version 2 of the claim's account history, masked. */
  const GAVE = `done:ผู้เบิกแก้บัญชีรับเงิน · ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย ${SCB.accountLast4}`;

  it('keeps the first approval as history, then the send-back, the account given and the new approval, in the spec\'s words', () => {
    assert.deepEqual(rows(ready()), ['done:ยื่นใบ', FIRST, 'current:กำลังรอ วราภรณ์ การเงิน บันทึกจ่าย']);
    assert.deepEqual(rows(phaseA()), ['done:ยื่นใบ', FIRST, SENT, 'current:กำลังรอผู้เบิกแก้บัญชีรับเงิน', 'future:รอบันทึกจ่าย']);
    assert.deepEqual(rows(phaseB()), ['done:ยื่นใบ', FIRST, SENT, GAVE,
      'current:กำลังรอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงินใหม่', 'future:รอบันทึกจ่าย']);
    // The approval of the new account is told once, as the round's own row, never a second time as an approval of the claim.
    assert.deepEqual(rows(reapproved()), ['done:ยื่นใบ', FIRST, SENT, GAVE,
      'done:อนุมัติบัญชีรับเงินใหม่โดย สมศรี ผู้จัดการ', 'current:กำลังรอ วราภรณ์ การเงิน บันทึกจ่าย']);
    // Each row of the round carries when it happened.
    const dated = logic.buildClaimTimeline(reapproved()).filter((row) => row.key.startsWith('correction-')).map((row) => row.date);
    assert.deepEqual(dated, [AT.sentBack, AT.given, AT.reapproved]);
    // On the page: the rows are in the journey card, in this order.
    const journey = claimPage(reapproved(), auditor).html;
    const card = journey.slice(journey.indexOf('>', journey.indexOf('data-testid="reimbursement-timeline"')) + 1);
    assert.deepEqual(visible(card.slice(0, card.indexOf('</ol>'))).filter((text) => !/^[✓●○]$|^\d/u.test(text)),
      rows(reapproved()).map((row) => row.slice(row.indexOf(':') + 1)));
  });

  // Seen in the real look: a requester who gave the account twice within one minute had two rows that read alike, time included.
  it('says what each account-given row gave, so a requester who gives the account twice has two rows that differ', () => {
    const version3 = { version: 3, payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกรุงเทพ', accountName: KBANK.accountName, accountLast4: '5667', source: 'REQUESTER', frozenAt: AT.given };
    const twice = phaseB({ payoutHistory: [version1, version2, version3], payoutCorrectionHistory: [SENT_BACK, GIVEN, { ...GIVEN, payoutVersion: 3 }] });
    assert.deepEqual(rows(twice).slice(3, 5), [GAVE, 'done:ผู้เบิกแก้บัญชีรับเงิน · ธนาคารกรุงเทพ เลขบัญชีลงท้าย 5667']);
    // Changed to cash: said as the receiving method, with no account to name.
    assert.equal(rows(phaseB({ payoutCorrectionHistory: [SENT_BACK, { ...GIVEN, payoutMethod: 'CASH', payoutVersion: undefined }] }))[3], 'done:ผู้เบิกแก้บัญชีรับเงิน · รับเป็นเงินสด');
    // A detail that carries no such account (an older answer) keeps the row as the spec words it, and never prints a version number.
    assert.equal(rows(phaseB({ payoutHistory: undefined }))[3], 'done:ผู้เบิกแก้บัญชีรับเงิน');
    assert.equal(rows(phaseB({ payoutHistory: [version1] }))[3], 'done:ผู้เบิกแก้บัญชีรับเงิน');
    for (const row of rows(twice)) assert.doesNotMatch(row, /\d{5,}/u, 'the last 4 digits only');
    // The same account given twice on one day is the one case left where two rows read alike: they are told apart by their time.
    const same = logic.buildClaimTimeline(phaseB({ payoutCorrectionHistory: [SENT_BACK, GIVEN, { ...GIVEN, at: '2026-10-01T05:20:00.000Z' }] })).filter((row) => row.label.startsWith('ผู้เบิกแก้บัญชีรับเงิน'));
    assert.equal(same.length, 2);
    const all = logic.buildClaimTimeline(phaseB({ payoutCorrectionHistory: [SENT_BACK, GIVEN, { ...GIVEN, at: '2026-10-01T05:20:00.000Z' }] }));
    assert.notEqual(logic.timelineDateText(all, same[0]!), logic.timelineDateText(all, same[1]!));
  });

  // Before: "ส่งกลับให้แก้บัญชีรับเงินโดย …" of a claim that asked for cash, in its step note and in its journey.
  it('tells the send-back by what the claim held, in the step note and in the journey alike', () => {
    for (const [held, said] of [
      ['ACCOUNT', 'ส่งกลับให้แก้บัญชีรับเงินโดย วราภรณ์ การเงิน : เลขบัญชีไม่ถูกต้อง'],
      ['CASH', 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้งโดย วราภรณ์ การเงิน : จ่ายเป็นเงินสดไม่ได้'],
      ['NOTHING', 'ส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงินโดย วราภรณ์ การเงิน : ใบนี้ยังไม่มีบัญชีรับเงิน'],
    ] as const) {
      const detail = sentBackHolding(held);
      assert.equal(active(detail, auditor).note!.split(' · ')[0], said, held);
      assert.equal(rows(detail)[2], `done:${said}`, held);
      // An action's answer carries the round and not its history: the step note still says it, from what the claim holds.
      assert.equal(active({ ...detail, payoutCorrectionHistory: undefined }, auditor).note!.split(' · ')[0], said, held);
      assert.equal(logic.quickPayBlockedNote(detail, EVERYTHING, 'finance')!.split(' · ')[1], said, held);
    }
    // Sent back again from its waiting step, the claim holds the answer that was not taken: cash here, on a claim that began with an account.
    const refused = sentBackHolding('CASH', { payoutCorrection: { phase: 'AWAITING_REQUESTER', ...roundOf('ACCOUNT'), requestedByName: NAMES.approver, reasonCode: 'CASH_NOT_PAYABLE' },
      payoutCorrectionHistory: [sentBackEvent('ACCOUNT'), { ...GIVEN, payoutMethod: 'CASH', payoutVersion: undefined, answer: 'CASH_INSTEAD' },
        { kind: 'SENT_BACK', at: '2026-10-01T05:30:00.000Z', byUserId: 'boss', byName: NAMES.approver, reasonCode: 'CASH_NOT_PAYABLE', held: 'CASH' }] });
    assert.equal(active(refused, auditor).note, 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้งโดย สมศรี ผู้จัดการ : จ่ายเป็นเงินสดไม่ได้ · รอผู้เบิกเลือกวิธีรับเงินคืน');
    assert.deepEqual([rows(refused)[2], rows(refused)[4]], ['done:ส่งกลับให้แก้บัญชีรับเงินโดย วราภรณ์ การเงิน : เลขบัญชีไม่ถูกต้อง',
      'done:ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้งโดย สมศรี ผู้จัดการ : จ่ายเป็นเงินสดไม่ได้']);
  });

  // Upgrade test 2026-10-02: a claim sent before claims carried an account, sent back to be given one. Its rows said
  // "ส่งกลับให้แก้บัญชีรับเงิน … : อื่น ๆ" and "ผู้เบิกแก้บัญชีรับเงิน" of an account that was never there.
  it('tells the round of a claim that had no account as an account asked for and added, also when its first answer is sent back', () => {
    const APPROVED = 'done:อนุมัติโดย สมศรี ผู้จัดการ';
    const ASKED = 'done:ส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงินโดย วราภรณ์ การเงิน : ใบนี้ยังไม่มีบัญชีรับเงิน';
    const ADDED = `done:ผู้เบิกเพิ่มบัญชีรับเงิน · ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย ${SCB.accountLast4}`;
    const waiting = sentBackHolding('NOTHING');
    assert.deepEqual(rows(waiting), ['done:ยื่นใบ', APPROVED, ASKED, 'current:กำลังรอผู้เบิกเพิ่มบัญชีรับเงิน', 'future:รอบันทึกจ่าย']);
    const given = answeredWith('FIRST_ACCOUNT');
    // Not "…อนุมัติบัญชีรับเงินใหม่": the claim's first account replaced none.
    assert.deepEqual(rows(given).slice(2), [ASKED, ADDED, 'current:กำลังรอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงิน', 'future:รอบันทึกจ่าย']);
    // The approver's card says the same two things: why it was sent back, and that the account was added.
    const card = logic.payoutCorrectionComparison(given)!;
    assert.deepEqual([card.sentBack, card.submitted], [ASKED.slice(5), 'ผู้เบิกเพิ่มบัญชีรับเงิน เมื่อ 1 ต.ค. 2569 12:00 น.']);
    // Sent back again from the waiting step, the claim holds an account, and that one is sent back to be corrected. What is
    // answered then is still the claim's first account: it was approved with none, which is what an answer is told against.
    const again = { kind: 'SENT_BACK', at: '2026-10-01T05:30:00.000Z', byUserId: 'boss', byName: NAMES.approver, reasonCode: 'ACCOUNT_NAME_MISMATCH', held: 'ACCOUNT' };
    const second = { version: 2, payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกรุงเทพ', accountName: KBANK.accountName, accountLast4: '5667', source: 'REQUESTER', frozenAt: AT.reapproved };
    const corrected = answeredWith('FIRST_ACCOUNT', { payoutHistory: [{ ...version2, version: 1 }, second],
      payoutCorrectionHistory: [sentBackEvent('NOTHING'), { ...GIVEN, payoutVersion: 1, answer: 'FIRST_ACCOUNT' }, again, { ...GIVEN, at: AT.reapproved, payoutVersion: 2, answer: 'FIRST_ACCOUNT' }] });
    assert.deepEqual(rows(corrected).slice(2, 6), [ASKED, ADDED,
      'done:ส่งกลับให้แก้บัญชีรับเงินโดย สมศรี ผู้จัดการ : ชื่อบัญชีไม่ตรงกับผู้เบิก', 'done:ผู้เบิกเพิ่มบัญชีรับเงิน · ธนาคารกรุงเทพ เลขบัญชีลงท้าย 5667']);
    // Its requester is asked to add an account, by the button the page shows; everyone else reads the claim's status.
    const requester = { userId: 'staff', permissions: ['reimbursement.read_own', 'reimbursement.create'] };
    const own = claimPage({ ...waiting, payoutCorrectionActions: { canRequest: false, canSubmit: true, requesterDefault: 'ABSENT' } }, requester).texts;
    assert.ok(own.some((text) => text === `${ASKED.slice(5)} · รอคุณเพิ่มบัญชีรับเงิน กดเพิ่มบัญชีรับเงินแล้วเลือกวิธีรับเงินคืนของใบนี้`), JSON.stringify(own.filter((text) => text.includes('ส่งกลับ'))));
    // Before: the sentence named a button "แก้บัญชีรับเงิน". The button it names is the one on the page.
    assert.ok(own.includes('เพิ่มบัญชีรับเงิน') && !own.includes('แก้บัญชีรับเงิน'), JSON.stringify(own.filter((text) => text.includes('บัญชีรับเงิน'))));
    assert.ok(claimPage(waiting, auditor).texts.some((text) => text === `${ASKED.slice(5)} · รอผู้เบิกเพิ่มบัญชีรับเงิน`));
    for (const detail of [waiting, given, corrected]) assertPlainThai(logic.buildClaimTimeline(detail).map((row) => row.label), 'the journey of a claim that had no account');
  });

  // Before: "ผู้เบิกแก้บัญชีรับเงิน · …" and "อนุมัติบัญชีรับเงินใหม่โดย …" of every answer: of the same account given again, of cash,
  // and of the first account of a claim that had none.
  it('tells each answer and its approval by what was answered, and names whoever answered for the requester', () => {
    const SCB_GIVEN = `ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย ${SCB.accountLast4}`;
    const TOLD: Record<Answer, [did: string, given: string, approved: string]> = {
      NEW_ACCOUNT: ['แก้บัญชีรับเงิน', SCB_GIVEN, 'อนุมัติบัญชีรับเงินใหม่โดย สมศรี ผู้จัดการ'],
      SAME_ACCOUNT: ['ยืนยันบัญชีเดิม', `ธนาคารกสิกรไทย เลขบัญชีลงท้าย ${KBANK.accountLast4}`, 'อนุมัติบัญชีรับเงินเดิมโดย สมศรี ผู้จัดการ'],
      CASH_INSTEAD: ['เปลี่ยนวิธีรับเงินคืน', 'รับเป็นเงินสด', 'อนุมัติการรับเป็นเงินสดโดย สมศรี ผู้จัดการ'],
      ACCOUNT_INSTEAD: ['เปลี่ยนวิธีรับเงินคืน', SCB_GIVEN, 'อนุมัติบัญชีรับเงินโดย สมศรี ผู้จัดการ'],
      SAME_CASH: ['ยืนยันวิธีรับเงินคืนเดิม', 'รับเป็นเงินสด', 'อนุมัติการรับเป็นเงินสดโดย สมศรี ผู้จัดการ'],
      FIRST_ACCOUNT: ['เพิ่มบัญชีรับเงิน', SCB_GIVEN, 'อนุมัติบัญชีรับเงินโดย สมศรี ผู้จัดการ'],
      FIRST_CASH: ['เลือกวิธีรับเงินคืน', 'รับเป็นเงินสด', 'อนุมัติการรับเป็นเงินสดโดย สมศรี ผู้จัดการ'],
    };
    /** The claim once that answer is approved: back at its pay step, the round over, its history one row longer. */
    const approvedAgain = (waiting: Record<string, any>, answer: Answer) => ({ ...waiting, status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', approvedAt: AT.reapproved,
      payoutCorrectionPhase: undefined, payoutCorrection: undefined, payoutCorrectionAnswer: undefined, payoutCorrectionAnsweredBy: undefined,
      currentDesk: { kind: 'PAYMENT' }, paymentDesk: { names: [NAMES.payer], moreCount: 0 },
      approvalSteps: [setAside, { ...step2, status: 'APPROVED', decisionByUserId: 'boss', decidedByName: NAMES.approver, decidedAt: AT.reapproved }],
      payoutCorrectionHistory: [...waiting.payoutCorrectionHistory, { ...REAPPROVED, answer }] });
    for (const answer of ALL_ANSWERS) {
      const [did, given, approved] = TOLD[answer];
      const waiting = answeredWith(answer);
      assert.equal(rows(waiting)[3], `done:ผู้เบิก${did} · ${given}`, answer);
      // Someone answered for the requester: the row says who, and that it was done on the requester's behalf.
      assert.equal(rows(answeredWith(answer, {}, ON_BEHALF))[3], `done:สุภาวดี นักบัญชี ${did}แทนผู้เบิก · ${given}`, answer);
      const done = rows(approvedAgain(waiting, answer));
      assert.deepEqual(done.slice(3), [`done:ผู้เบิก${did} · ${given}`, `done:${approved}`, 'current:กำลังรอ วราภรณ์ การเงิน บันทึกจ่าย'], answer);
      assertPlainThai(done, `the journey of ${answer}`);
    }
    // Events with no record of what was answered (from an older server): words true of every answer, never "แก้" or "ใหม่".
    const older = approvedAgain(phaseB({ payoutCorrectionHistory: [{ ...SENT_BACK, held: undefined }, { ...GIVEN, answer: undefined }] }), undefined as never);
    assert.deepEqual(rows(older).slice(2, 5), ['done:ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนโดย วราภรณ์ การเงิน : เลขบัญชีไม่ถูกต้อง · ธนาคารแจ้งว่าไม่พบบัญชีนี้',
      `done:ผู้เบิกเลือกวิธีรับเงินคืน · ${SCB_GIVEN}`, 'done:อนุมัติวิธีรับเงินคืนโดย สมศรี ผู้จัดการ']);
  });

  it('ends with the payment into the new account once it is paid', () => {
    const paid = reapproved({ status: 'PAID', paymentStatus: 'PAID', outstandingAmount: '0.0000', currentDesk: undefined, paymentDesk: undefined,
      payments: [{ id: 'p1', status: 'RECORDED', paymentMethod: 'BANK_TRANSFER', paidAt: '2026-10-01T07:00:00.000Z', paidByName: NAMES.payer, slipCount: 1,
        payoutDestination: { version: 2, payoutKind: 'BANK_ACCOUNT', bankName: SCB.bankName, accountName: SCB.accountName, accountLast4: '1112' } }] });
    assert.equal(rows(paid).at(-1), 'done:จ่ายแล้ว โดย วราภรณ์ การเงิน · โอนเข้าบัญชีลงท้าย 1112 · มีสลิป');
    assert.equal(rows(paid).length, 6);
  });

  it('names whoever gave the account on the requester\'s behalf, and prints no code for a reason it has no words for', () => {
    const onBehalf = phaseB({ payoutCorrectionHistory: [SENT_BACK, { ...GIVEN, ...ON_BEHALF }] });
    assert.equal(rows(onBehalf)[3], `done:สุภาวดี นักบัญชี แก้บัญชีรับเงินแทนผู้เบิก · ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย ${SCB.accountLast4}`);
    const later = phaseA({ payoutCorrectionHistory: [{ kind: 'SENT_BACK', at: AT.sentBack, byUserId: 'gone', reasonCode: 'A_REASON_ADDED_LATER', held: 'ACCOUNT' }, { kind: 'A_KIND_ADDED_LATER', at: AT.given, byUserId: 'x' }] });
    assert.deepEqual(rows(later), ['done:ยื่นใบ', FIRST, 'done:ส่งกลับให้แก้บัญชีรับเงิน', 'current:กำลังรอผู้เบิกแก้บัญชีรับเงิน', 'future:รอบันทึกจ่าย']);
    // A send-back with no record of what the claim held (an event from an older server): words true of every claim sent back.
    const older = phaseA({ payoutCorrectionHistory: [{ kind: 'SENT_BACK', at: AT.sentBack, byUserId: 'finance', byName: NAMES.payer, reasonCode: 'OTHER' }] });
    assert.equal(rows(older)[2], 'done:ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนโดย วราภรณ์ การเงิน : อื่น ๆ');
    for (const detail of [phaseA(), phaseB(), reapproved(), onBehalf, later, older]) assertPlainThai(logic.buildClaimTimeline(detail).map((row) => row.label), 'the journey');
  });

  it('tells a new account sent back again, and a second round after the first, as they happened', () => {
    const again = { kind: 'SENT_BACK', at: '2026-10-01T05:30:00.000Z', byUserId: 'boss', byName: NAMES.approver, reasonCode: 'ACCOUNT_NAME_MISMATCH', held: 'ACCOUNT' };
    // The round's own step was refused: it is set aside, and the claim is with its requester once more.
    const sentBackAgain = phaseA({ approvalSteps: [setAside, { ...step2, status: 'CANCELLED', invalidatedAt: again.at, invalidatedReason: 'payout_account_correction' }],
      payoutCorrectionHistory: [SENT_BACK, GIVEN, again] });
    assert.deepEqual(rows(sentBackAgain), ['done:ยื่นใบ', FIRST, SENT, 'done:ผู้เบิกแก้บัญชีรับเงิน',
      'done:ส่งกลับให้แก้บัญชีรับเงินโดย สมศรี ผู้จัดการ : ชื่อบัญชีไม่ตรงกับผู้เบิก', 'current:กำลังรอผู้เบิกแก้บัญชีรับเงิน', 'future:รอบันทึกจ่าย']);
    // A second round on a claim already corrected once: its first new approval is history told by the first round's row.
    const second = { kind: 'SENT_BACK', at: '2026-10-01T08:00:00.000Z', byUserId: 'staff', byName: NAMES.requester, reasonCode: 'REQUESTER_ASKED', held: 'ACCOUNT' };
    const secondRound = phaseA({ payout: { ...SCB, source: 'REQUESTER' },
      approvalSteps: [setAside, { ...step2, status: 'APPROVED', decisionByUserId: 'boss', decidedByName: NAMES.approver, decidedAt: AT.reapproved, invalidatedAt: second.at, invalidatedReason: 'payout_account_correction' }],
      payoutCorrectionHistory: [SENT_BACK, GIVEN, REAPPROVED, second] });
    assert.deepEqual(rows(secondRound), ['done:ยื่นใบ', FIRST, SENT, 'done:ผู้เบิกแก้บัญชีรับเงิน', 'done:อนุมัติบัญชีรับเงินใหม่โดย สมศรี ผู้จัดการ',
      'done:ส่งกลับให้แก้บัญชีรับเงินโดย สมชาย พนักงาน : ผู้เบิกขอเปลี่ยนบัญชี', 'current:กำลังรอผู้เบิกแก้บัญชีรับเงิน', 'future:รอบันทึกจ่าย']);
  });

  // Plan 3.11 and 3.12 in the journey.
  it('keeps the finance review before the round for a claim that passed it, and has no new approval for a claim nobody approves', () => {
    const reviewed = { financeReviewRequired: true, financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByName: NAMES.payer, financeReviewedAt: '2026-10-01T03:30:00.000Z' };
    assert.deepEqual(rows(phaseB(reviewed)), ['done:ยื่นใบ', FIRST, 'done:ตรวจการเงินแล้ว โดย วราภรณ์ การเงิน', SENT, GAVE,
      'current:กำลังรอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงินใหม่', 'future:รอบันทึกจ่าย']);
    const noApproval = ready({ approvalSteps: [], approvedAt: AT.given, payout: { ...SCB, source: 'REQUESTER' }, payoutHistory: [version2], payoutCorrectionHistory: [SENT_BACK, GIVEN] });
    assert.deepEqual(rows(noApproval), ['done:ยื่นใบ', SENT, GAVE, 'current:กำลังรอ วราภรณ์ การเงิน บันทึกจ่าย']);
    assert.deepEqual(rows(phaseA({ approvalSteps: [] })), ['done:ยื่นใบ', SENT, 'current:กำลังรอผู้เบิกแก้บัญชีรับเงิน', 'future:รอบันทึกจ่าย']);
  });

  // Spec §22: money sent to a wrong account is voided first, then the claim is sent back. And the other way round.
  it('orders a payment that was taken back and the round by when each happened', () => {
    const voided = (voidedAt: string) => ({ id: 'p0', status: 'VOIDED', paymentMethod: 'CASH', paidAt: '2026-10-01T00:00:00.000Z', paidByName: NAMES.payer, voidedAt, voidReason: 'โอนผิดบัญชี', slipCount: 0 });
    const PAID = 'done:จ่ายแล้ว โดย วราภรณ์ การเงิน · เงินสด';
    const VOID = 'done:ยกเลิกการจ่ายแล้ว: โอนผิดบัญชี';
    assert.deepEqual(rows(phaseA({ payments: [voided('2026-10-01T03:45:00.000Z')] })),
      ['done:ยื่นใบ', FIRST, PAID, VOID, SENT, 'current:กำลังรอผู้เบิกแก้บัญชีรับเงิน', 'future:รอบันทึกจ่าย']);
    assert.deepEqual(rows(reapproved({ payments: [voided('2026-10-01T07:30:00.000Z')] })),
      ['done:ยื่นใบ', FIRST, SENT, GAVE, 'done:อนุมัติบัญชีรับเงินใหม่โดย สมศรี ผู้จัดการ', PAID, VOID, 'current:กำลังรอ วราภรณ์ การเงิน บันทึกจ่าย']);
  });

  it('keeps the round on a claim cancelled, or being cancelled, in it', () => {
    // Cancelling sets the step that waited aside, as it does for any claim.
    const cancelled = phaseB({ status: 'CANCELLED', currentDesk: undefined, payoutCorrectionPhase: undefined, payoutCorrection: undefined,
      approvalSteps: [setAside, { ...step2, status: 'CANCELLED', invalidatedAt: '2026-10-01T05:30:00.000Z', invalidatedReason: 'reimbursement_cancelled' }] });
    assert.deepEqual(rows(cancelled), ['done:ยื่นใบ', FIRST, SENT, GAVE, 'done:ยกเลิกคำขอ']);
    const cancelling = phaseA({ currentDesk: { kind: 'SYSTEM' }, pendingCancellation: { startedAt: AT.given, startedByName: NAMES.requester, reason: 'ซื้อซ้ำกับใบก่อน', canResume: false, canWithdraw: false } });
    assert.deepEqual(rows(cancelling), ['done:ยื่นใบ', FIRST, SENT, 'done:เริ่มยกเลิกคำขอ โดย สมชาย พนักงาน', 'current:กำลังรอระบบปรับสถานะ']);
  });

  // The card "ขั้นตอนอนุมัติ" lists every step. Seen on the real page: the approval a round set aside read "อนุมัติแล้ว" in green, as if in force.
  it('marks the steps a round set aside as history in the approval steps card, and no other step', () => {
    // Before: "อนุมัติก่อนส่งกลับให้แก้บัญชีรับเงิน" and "บัญชีที่รออนุมัติในขั้นนี้ถูกส่งกลับหรือแก้ใหม่", of a claim with no
    // account, of one that asked for cash, and of an answer that was cash. The notes now hold for every round, and name
    // nobody as having answered again: that may have been someone on the requester's behalf.
    assert.equal(logic.approvalStepCorrectionNote(setAside), 'เก็บเป็นประวัติ: อนุมัติก่อนใบถูกส่งกลับ');
    assert.equal(logic.approvalStepCorrectionNote({ ...step2, status: 'CANCELLED', invalidatedAt: AT.given, invalidatedReason: 'payout_account_correction' }),
      'เก็บเป็นประวัติ: วิธีรับเงินคืนที่รออนุมัติในขั้นนี้ถูกส่งกลับ หรือมีการเลือกอีกครั้ง');
    for (const step of [step1, step2, { ...step1, invalidatedAt: AT.given, invalidatedReason: 'superseded_by_atomic_resubmit' }, undefined]) assert.equal(logic.approvalStepCorrectionNote(step), null);
    const { html, texts } = claimPage(reapproved(), auditor);
    const card = html.slice(html.indexOf('>ขั้นตอนอนุมัติ<'));
    assert.equal(texts.filter((text) => text === 'เก็บเป็นประวัติ: อนุมัติก่อนใบถูกส่งกลับ').length, 1);
    // The approval in force keeps its colour; the one set aside loses it.
    assert.deepEqual([...card.matchAll(/mangmee-badge-(\w+)">อนุมัติแล้ว</gu)].map((match) => match[1]), ['slate', 'brand']);
  });

  it('reads as before for a claim that was never in a round, an approval set aside for another reason included', () => {
    const resubmitted = ready({ approvalSteps: [{ ...step1, id: 'old', invalidatedAt: AT.approved, invalidatedReason: 'superseded_by_atomic_resubmit' }, step1] });
    assert.deepEqual(rows(resubmitted), ['done:ยื่นใบ', FIRST, 'current:กำลังรอ วราภรณ์ การเงิน บันทึกจ่าย']);
    // An action's answer carries the round and not its history: the journey still says whom the claim waits for.
    assert.deepEqual(rows(phaseB({ payoutCorrectionHistory: undefined })), ['done:ยื่นใบ', FIRST, 'current:กำลังรอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงินใหม่', 'future:รอบันทึกจ่าย']);
  });
});

// ---- A PromptPay destination is a phone number: nothing shown with one calls it "เลขบัญชี" ----
//
// The entry form calls it "เบอร์พร้อมเพย์" and the notices "พร้อมเพย์เบอร์ลงท้าย …". Before, the send-back reason of a PromptPay
// claim read "เลขบัญชีไม่ถูกต้อง" in its form, its step note, its journey and its approvers' card, its approver was told to look
// at "เลขบัญชี และธนาคาร", and a refused reveal spoke of "เลขบัญชีเต็ม".
describe('a claim paid into a PromptPay number: its number is "เบอร์พร้อมเพย์" on every screen of a round', () => {
  const PROMPTPAY = { payoutMethod: 'BANK_TRANSFER' as const, payoutKind: 'PROMPTPAY_PHONE' as const, accountName: 'นาย สมชาย ใจดี', accountLast4: '5678', version: 1 };
  const promptPayVersion = { ...version1, payoutKind: 'PROMPTPAY_PHONE' as const, bankName: undefined, source: 'REQUESTER' };
  /** The fixtures' round on a claim approved with a PromptPay number: sent back for its number, then answered with the SCB account. */
  const held = { payout: { ...PROMPTPAY, source: 'REQUESTER', ...attested, verifiedAt: AT.approved }, payoutHistory: [promptPayVersion] };
  const itsRound = { ...round, previous: PROMPTPAY };
  const withRequester = (overrides: Record<string, unknown> = {}) => phaseA({ ...held, payoutCorrection: { phase: 'AWAITING_REQUESTER', ...itsRound }, ...overrides });
  const answered = () => phaseB({ payoutHistory: [promptPayVersion, version2], payoutCorrection: { phase: 'AWAITING_APPROVAL', ...itsRound, submittedAt: AT.given, sameAsPrevious: false } });
  const approvedAgain = () => reapproved({ payoutHistory: [promptPayVersion, { ...version2, ...attested, verifiedAt: AT.reapproved, approvalStepId: 'step-2' }] });
  const SENT = 'ส่งกลับให้แก้บัญชีรับเงินโดย วราภรณ์ การเงิน : เบอร์พร้อมเพย์ไม่ถูกต้อง';
  const NOTE = 'ธนาคารแจ้งว่าไม่พบบัญชีนี้';
  const journey = (detail: object) => logic.buildClaimTimeline(detail).map((row) => row.label);

  it('says the reason of a phone number in the step note, in the journey and on the approvers\' card, while the round is open and after it', () => {
    // With its requester: the claim holds the number that was sent back.
    assert.equal(active(withRequester(), auditor).note, `${SENT} · หมายเหตุ: ${NOTE} · รอผู้เบิกแก้บัญชีรับเงิน`);
    assert.equal(journey(withRequester())[2], `${SENT} · ${NOTE}`);
    // An action's answer carries neither history: the step note still says it, from the account the claim holds.
    assert.equal(active(withRequester({ payoutHistory: undefined, payoutCorrectionHistory: undefined }), auditor).note!.split(' · ')[0], SENT);
    // Answered with a bank account: the claim holds that one now, and the send-back is still told of the number it was about.
    assert.equal(journey(answered())[2], `${SENT} · ${NOTE}`);
    assert.equal(logic.payoutCorrectionComparison(answered())!.sentBack, SENT);
    // Approved again and back at its pay step: the row stays as it was said.
    assert.equal(journey(approvedAgain())[2], `${SENT} · ${NOTE}`);
    // On the page itself at each of the three points: the reason of that number is nowhere said of "เลขบัญชี".
    for (const [name, detail] of [['with its requester', withRequester()], ['answered', answered()], ['approved again', approvedAgain()]] as const) {
      const { texts } = claimPage(detail, auditor);
      assert.ok(texts.some((text) => text.includes('เบอร์พร้อมเพย์ไม่ถูกต้อง')), name);
      assert.equal(texts.some((text) => text.includes('เลขบัญชีไม่ถูกต้อง')), false, name);
      assertPlainThai(texts.filter((text) => text.includes('ไม่ถูกต้อง')), `the send-back of a PromptPay claim, ${name}`);
    }
    // The hub's pay dialog says the same of a claim that is with its requester.
    assert.equal(logic.quickPayBlockedNote(withRequester(), EVERYTHING, 'finance')!.split(' · ')[1], SENT);
  });

  it('says each send-back by the account the claim held then: a bank account first, the PromptPay number given for it next', () => {
    const promptPayAnswer = { ...promptPayVersion, version: 2, frozenAt: AT.given, verifiedByUserId: undefined, verifiedByName: undefined, verifiedAt: undefined, approvalStepId: undefined };
    const again = { kind: 'SENT_BACK', at: '2026-10-01T05:30:00.000Z', byUserId: 'boss', byName: NAMES.approver, reasonCode: 'ACCOUNT_NUMBER_WRONG', held: 'ACCOUNT' };
    const againRound = { ...round, requestedAt: again.at, requestedByUserId: 'boss', requestedByName: NAMES.approver, note: undefined };
    const refused = phaseA({ payout: { ...PROMPTPAY, version: 2, source: 'REQUESTER' }, payoutHistory: [version1, promptPayAnswer],
      payoutCorrection: { phase: 'AWAITING_REQUESTER', ...againRound }, payoutCorrectionHistory: [SENT_BACK, GIVEN, again] });
    const AGAIN = 'ส่งกลับให้แก้บัญชีรับเงินโดย สมศรี ผู้จัดการ : เบอร์พร้อมเพย์ไม่ถูกต้อง';
    assert.deepEqual([journey(refused)[2], journey(refused)[4]], [`ส่งกลับให้แก้บัญชีรับเงินโดย วราภรณ์ การเงิน : เลขบัญชีไม่ถูกต้อง · ${NOTE}`, AGAIN]);
    assert.equal(active(refused, auditor).note, `${AGAIN} · รอผู้เบิกแก้บัญชีรับเงิน`);
    // Answered once more, with a bank account: the approvers' card tells the send-back it answers, the one of the PromptPay number.
    const answeredAgain = phaseB({ payout: { ...SCB, version: 3, source: 'REQUESTER' }, payoutHistory: [version1, promptPayAnswer, { ...version2, version: 3, frozenAt: AT.reapproved }],
      payoutCorrection: { phase: 'AWAITING_APPROVAL', ...againRound, submittedAt: AT.reapproved, sameAsPrevious: false },
      payoutCorrectionHistory: [SENT_BACK, GIVEN, again, { ...GIVEN, at: AT.reapproved, payoutVersion: 3 }] });
    assert.equal(logic.payoutCorrectionComparison(answeredAgain)!.sentBack, AGAIN);
    assert.equal(journey(answeredAgain)[4], AGAIN);
  });

  // The server says THAT a claim held an account at a send-back (`held`). Which account it was is in the claim's own account
  // history: a claim's account is always the last one it was sent with or given, and an answer is frozen when it is taken.
  it('finds the account a claim held at a send-back in its account history: the last one it had been sent with or given by then', () => {
    const history = [version1, { ...promptPayVersion, version: 2, frozenAt: AT.given }];
    assert.deepEqual([AT.sentBack, AT.given, '2026-10-01T05:30:00.000Z', AT.reapproved].map((at) => payoutKindHeldAt(history, at)),
      ['BANK_ACCOUNT', 'PROMPTPAY_PHONE', 'PROMPTPAY_PHONE', 'PROMPTPAY_PHONE']);
    // Before the claim had any account, with no history on the detail, or with no moment to ask about: no kind, and the
    // reason then reads in the list's own words.
    assert.equal(payoutKindHeldAt(history, '2026-10-01T01:00:00.000Z'), undefined);
    for (const none of [undefined, null, []]) assert.equal(payoutKindHeldAt(none, AT.sentBack), undefined);
    for (const at of [undefined, null, '', 'not a date']) assert.equal(payoutKindHeldAt(history, at), undefined, String(at));
    assert.equal(payoutCorrectionSentBackText({ reasonCode: 'ACCOUNT_NUMBER_WRONG', held: 'ACCOUNT', payoutKind: payoutKindHeldAt([], AT.sentBack) }), 'ส่งกลับให้แก้บัญชีรับเงิน : เลขบัญชีไม่ถูกต้อง');
  });

  it('tells the approver of a PromptPay number to look at its name and its number, on a page whose button shows a phone number', () => {
    const BANK = 'ดูชื่อบัญชี เลขบัญชี และธนาคารในการ์ดการรับเงินคืนด้านบน ระบบบันทึกชื่อคุณและเวลาที่ตรวจ';
    const PHONE = 'ดูชื่อบัญชีและเบอร์พร้อมเพย์ในการ์ดการรับเงินคืนด้านบน ระบบบันทึกชื่อคุณและเวลาที่ตรวจ';
    const waiting = (payout: object, payoutHistory: object[]) => claimPage(phaseB({ payout, payoutHistory, approvalActions: DECIDE, payoutCorrectionActions: SEND }), approver).texts;
    const promptPay = waiting({ ...PROMPTPAY, version: 2, source: 'REQUESTER', canRevealAccountNumber: true }, [version1, { ...promptPayVersion, version: 2, frozenAt: AT.given }]);
    assert.deepEqual([promptPay.includes(PHONE), promptPay.includes(BANK)], [true, false]);
    assert.deepEqual([promptPay.includes('แสดงเบอร์พร้อมเพย์'), promptPay.includes('แสดงเลขบัญชี')], [true, false]);
    // A bank account reads as it did.
    const bank = waiting({ ...SCB, source: 'REQUESTER', canRevealAccountNumber: true }, [version1, version2]);
    assert.deepEqual([bank.includes(BANK), bank.includes(PHONE), bank.includes('แสดงเลขบัญชี'), bank.includes('แสดงเบอร์พร้อมเพย์')], [true, false, true, false]);
  });

  // The API's refusal of a reveal has one sentence for its code, and that sentence names "เลขบัญชี".
  it('refuses a reveal, and says a number was copied, in the words of the number it is: a phone number or an account number', async () => {
    const promptPayClaim = ready({ payout: { ...held.payout, canRevealAccountNumber: true }, payoutHistory: held.payoutHistory });
    const bankClaim = ready({ payout: { ...ready().payout, canRevealAccountNumber: true } });
    /** The card with the press of one of its buttons, found by the first word on it; `revealed`: the number it already shows. */
    const press = async (detail: Record<string, any>, word: string, revealed?: object) => {
      let nulls = 0;
      const card = render(h(payoutUi.ClaimPayoutCard, { companyId: 'company-1', detail, userId: 'boss', payoutAccountHref: '/payout-account' }),
        (start) => (start === null && ++nulls === 1 ? revealed : undefined),
        (type, _props, children) => (type === 'button' && String(children[0]).startsWith(word) ? 'button' : undefined));
      await withApi(() => ({ status: 403, body: { statusCode: 403, message: 'payout_reveal_denied' } }), () => card.handlers.button.onClick());
      return card.changes.map((change) => change.value).filter((value): value is string => typeof value === 'string');
    };
    assert.deepEqual(await press(promptPayClaim, 'แสดง'), ['คุณไม่มีสิทธิ์ดูเบอร์พร้อมเพย์เต็มของใบนี้']);
    assert.deepEqual(await press(bankClaim, 'แสดง'), ['คุณไม่มีสิทธิ์ดูเลขบัญชีเต็มของใบนี้']);
    assert.equal(translateApiError('payout_reveal_denied'), 'คุณไม่มีสิทธิ์ดูเลขบัญชีเต็มของใบนี้', 'the sentence of the code stays the bank account\'s');
    // Copied: said of what was copied.
    const copied: string[] = [];
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async (text: string) => { copied.push(text); } }, configurable: true });
    try {
      toasts.length = 0;
      await press(promptPayClaim, 'คัดลอก', { revealKey: 'claim-1:1', accountNumber: '0812345678' });
      await press(bankClaim, 'คัดลอก', { revealKey: 'claim-1:1', accountNumber: '0045675678' });
    } finally { Reflect.deleteProperty(globalThis.navigator, 'clipboard'); }
    assert.deepEqual([copied, toasts.splice(0)], [['0812345678', '0045675678'], ['คัดลอกเบอร์พร้อมเพย์แล้ว', 'คัดลอกเลขบัญชีแล้ว']]);
  });
});

describe('signing and signed copies around a round (spec §14.4, AC32)', () => {
  const COPY = { attachmentId: 'copy-1', fileName: 'ใบเบิกเซ็นแล้ว.pdf', uploadedAt: '2026-10-01T03:30:00.000Z' };
  /** The claim's sections; `pendingCopy`: a file just picked in "ใบเบิกที่เซ็นแล้ว" (the sections' first null state), which opens the dialog. */
  const detailSections = (detail: object, viewer: Viewer, pendingCopy?: { name: string }) => {
    let nulls = 0;
    return render(h(sections.ClaimDetailSections, { detail, userId: viewer.userId, permissions: viewer.permissions, busy: false, onOpenAttachment: noop, onLineReceipt: noop,
      onSign: noop, onUploadSignedCopy: noop, onRequestVoidPayment: noop, onOpenPaymentSlip: noop, onAttachPaymentSlip: noop, onUseSignedCopyAsSlip: noop }),
    (start) => (start === null && ++nulls === 1 ? pendingCopy : undefined));
  };
  const signButton = (texts: string[]) => texts.filter((text) => text === 'ลงนาม' || text === 'ลงนามใหม่');
  /** Why nothing is signed meanwhile: what the claim waits for, in the words of its badge, and when signing comes back. */
  const waits = (status: string) => `ใบนี้${status} ยังลงนามหรือยืนยันสำเนาที่ลงนามครบไม่ได้ ทำได้อีกครั้งเมื่อใบกลับมารอจ่าย`;
  const WAITS = waits('รอผู้เบิกแก้บัญชีรับเงิน');

  it('offers no ลงนาม to anyone while a round is open, says why, and offers it again once the new account is approved', () => {
    for (const [at, said] of [[phaseA, WAITS], [phaseB, waits('รออนุมัติบัญชีรับเงินใหม่')]] as const) {
      for (const viewer of [requester, approver, payer]) {
        const { texts } = detailSections(at(), viewer);
        assert.deepEqual(signButton(texts), []);
        assert.ok(texts.includes(said), said);
        assert.equal(texts.filter((text) => text === 'ยังไม่ลงนาม').length, 2, 'both blocks are empty: the signatures went with the send-back');
      }
    }
    // Before the round and after it: the requester, and the approver the claim now stands on.
    for (const detail of [ready(), reapproved()]) {
      assert.deepEqual(signButton(detailSections(detail, requester).texts), ['ลงนาม']);
      assert.deepEqual(signButton(detailSections(detail, approver).texts), ['ลงนาม']);
      assert.equal(detailSections(detail, requester).texts.some((text) => text.includes('ยังลงนามหรือยืนยันสำเนาที่ลงนามครบไม่ได้')), false);
    }
    assert.deepEqual(signButton(detailSections(reapproved(), payer).texts), []);
  });

  // Before: "ใบนี้อยู่ระหว่างแก้บัญชีรับเงิน … ทำได้อีกครั้งหลังบัญชีใหม่ได้รับอนุมัติ" in every round: of a claim with no account, of one
  // that asked for cash, and whatever was answered.
  it('says why by what the claim waits for, and that signing comes back with the pay step, in every round', () => {
    const said = (detail: object) => detailSections(detail, requester).texts.filter((text) => text.includes('ยังลงนามหรือยืนยันสำเนาที่ลงนามครบไม่ได้'));
    assert.deepEqual(said(sentBackHolding('NOTHING')), [waits('รอผู้เบิกเพิ่มบัญชีรับเงิน')]);
    assert.deepEqual(said(sentBackHolding('CASH')), [waits('รอผู้เบิกเลือกวิธีรับเงินคืน')]);
    assert.deepEqual(said(answeredWith('SAME_ACCOUNT')), [waits('รออนุมัติบัญชีรับเงินเดิม')]);
    assert.deepEqual(said(answeredWith('FIRST_ACCOUNT')), [waits('รออนุมัติบัญชีรับเงิน')]);
    assert.deepEqual(said(answeredWith('SAME_CASH')), [waits('รออนุมัติการรับเป็นเงินสด')]);
    for (const detail of [...HELD.map((held) => sentBackHolding(held)), ...ALL_ANSWERS.map((answer) => answeredWith(answer))]) {
      for (const sentence of said(detail)) assert.doesNotMatch(sentence, /อยู่ระหว่างแก้|บัญชีใหม่ได้รับอนุมัติ/u);
      assertPlainThai(said(detail), 'the signing note of a round');
    }
    // The dialog of a file picked meanwhile says the same, and takes the file as an ordinary attachment.
    const dialog = detailSections(sentBackHolding('CASH'), requester, { name: 'ใบเบิกเซ็นแล้ว.pdf' }).texts;
    assert.ok(dialog.includes(`${waits('รอผู้เบิกเลือกวิธีรับเงินคืน')} ตอนนี้แนบเป็นไฟล์แนบทั่วไปได้ ระบบจะเก็บไว้ในประวัติ แต่ยังไม่นับว่าลงนามแล้ว`));
  });

  // Before: "สำเนาก่อนแก้บัญชีรับเงิน", for good, also on a claim that was sent back with no account or with cash.
  it('labels a scan declared before the round "สำเนาก่อนส่งกลับ", keeps it openable, and does not count it as signed', () => {
    const before = { ...COPY, beforePayoutCorrection: true as const };
    const newer = { attachmentId: 'copy-2', fileName: 'ใบเบิกเซ็นใหม่.pdf', uploadedAt: '2026-10-01T06:30:00.000Z', acknowledgedAt: '2026-10-01T06:30:00.000Z', acknowledgedByName: NAMES.requester };
    const { html, texts } = detailSections(reapproved({ signedCopies: [before] }), requester);
    assert.ok(texts.includes('ไฟล์ PDF · สำเนาก่อนส่งกลับ · ไม่นับว่าลงนามแล้ว · แนบเมื่อ 1 ต.ค. 2569'), texts.filter((text) => text.includes('สำเนา')).join(' | '));
    assert.match(html, /<button[^>]*>📄 ใบเบิกเซ็นแล้ว\.pdf<\/button>/);
    assert.equal(texts.includes('ลงนามบนกระดาษ'), false, 'no block reads as signed on paper');
    assert.equal(texts.some((text) => text.includes('ลงนามบนกระดาษ · แนบเมื่อ')), false);
    // A scan declared after the round is the one that counts; the older one keeps its label beside it.
    const both = detailSections(reapproved({ documentSignedVia: 'PAPER', signedCopies: [newer, before] }), requester).texts;
    assert.ok(both.includes('ไฟล์ PDF · ลงนามบนกระดาษ · แนบเมื่อ 1 ต.ค. 2569 โดย สมชาย พนักงาน') && both.includes('ไฟล์ PDF · สำเนาก่อนส่งกลับ · ไม่นับว่าลงนามแล้ว · แนบเมื่อ 1 ต.ค. 2569'),
      both.filter((text) => text.includes('แนบเมื่อ')).join(' | '));
    assert.equal(both.filter((text) => text === 'ลงนามบนกระดาษ').length, 2);
    // The step after payment waits for the signatures again: the copy from before the round finishes nothing.
    const paid = reapproved({ status: 'PAID', paymentStatus: 'PAID', currentDesk: undefined, signedCopies: [before], payments: [{ id: 'p1', status: 'RECORDED', paidAt: AT.reapproved, paidByName: NAMES.payer }] });
    assert.match(active(paid, requester).note!, /^จ่ายเงินคืนแล้ว ยังไม่ลงนาม: ผู้เบิก \(สมชาย พนักงาน\) และผู้อนุมัติ \(สมศรี ผู้จัดการ\)/u);
  });

  it('takes a file in a round but no declaration that it is the signed form, which the API refuses meanwhile', () => {
    const file = { name: 'ใบเบิกเซ็นแล้ว.pdf' };
    const inRound = detailSections(phaseA(), requester, file).texts;
    assert.ok(inRound.includes('แนบเป็นไฟล์แนบทั่วไป'));
    assert.equal(inRound.includes('แนบสำเนาที่ลงนามครบ'), false);
    assert.equal(inRound.some((text) => text.startsWith('สำเนานี้มีลายเซ็นผู้เบิกและผู้อนุมัติครบ')), false);
    assert.ok(inRound.includes(`${WAITS} ตอนนี้แนบเป็นไฟล์แนบทั่วไปได้ ระบบจะเก็บไว้ในประวัติ แต่ยังไม่นับว่าลงนามแล้ว`));
    // Outside a round the dialog is what it was.
    const usual = detailSections(reapproved(), requester, file).texts;
    assert.ok(usual.includes('แนบสำเนาที่ลงนามครบ') && usual.includes('แนบเป็นไฟล์แนบทั่วไป'));
    assert.ok(usual.some((text) => text.startsWith('สำเนานี้มีลายเซ็นผู้เบิกและผู้อนุมัติครบ')));
  });
});

describe('nothing pays a claim while its payout account is being corrected (AC30)', () => {
  const everything: Viewer = { userId: 'finance', permissions: EVERYTHING };

  it('offers no บันทึกจ่าย on a queue row or in the quick-pay dialog, and the dialog says what the claim page says', () => {
    for (const at of [phaseA, phaseB]) {
      assert.equal(logic.queueRowOffersPayment(at(), everything.permissions), false);
      assert.equal(logic.queueRowOffersFinanceReview(at()), false);
      assert.equal(active(at(), everything).actions.includes('pay'), false);
    }
    // A finance-queue row can be older than the claim: the dialog reads the claim and shows no form for one sent back meanwhile.
    assert.equal(logic.quickPayBlockedNote(phaseA(), everything.permissions, everything.userId),
      'บันทึกจ่ายใบนี้ไม่ได้ · ส่งกลับให้แก้บัญชีรับเงินโดย วราภรณ์ การเงิน : เลขบัญชีไม่ถูกต้อง · หมายเหตุ: ธนาคารแจ้งว่าไม่พบบัญชีนี้ · รอผู้เบิกแก้บัญชีรับเงิน');
    assert.equal(logic.quickPayBlockedNote(phaseB(), everything.permissions, everything.userId), 'บันทึกจ่ายใบนี้ไม่ได้ · รอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงินใหม่');
    assert.equal(logic.quickPayBlockedNote(reapproved(), everything.permissions, everything.userId), null, 'payable again after the approval');
    // The link that opens the payment form on arrival opens none on a claim in a round.
    assert.equal(logic.opensPaymentFormOnArrival(true, active(phaseA(), everything)), false);
  });

  // Before: every refusal of a round said "แก้บัญชีรับเงิน". A refusal is one sentence per code with nothing of the claim in it,
  // so it must be true of a claim sent back with an account, with cash and with nothing, whatever was answered.
  it('refuses in sentences that are true of every round: none names an account to correct, and each says what can be done', () => {
    const SENTENCES: Record<string, string> = {
      payout_correction_in_progress: 'ใบนี้ถูกส่งกลับเรื่องวิธีรับเงินคืน และยังไม่กลับมารอจ่าย จึงยังทำรายการนี้ไม่ได้ เปิดใบใหม่เพื่อดูว่าตอนนี้ใบรอใคร',
      payout_correction_not_allowed: 'ใบนี้ส่งกลับไม่ได้ในตอนนี้ ส่งกลับได้เฉพาะใบที่รอจ่ายและยังไม่ได้บันทึกจ่าย ถ้าบันทึกจ่ายแล้วต้องยกเลิกการจ่ายก่อน',
      payout_correction_denied: 'คุณไม่มีสิทธิ์ส่งกลับหรือเลือกวิธีรับเงินคืนของใบนี้',
      payout_correction_not_requested: 'ใบนี้ไม่ได้ถูกส่งกลับเรื่องวิธีรับเงินคืน กรุณาเปิดใบใหม่เพื่อดูสถานะล่าสุด',
      payout_correction_reason_required: 'กรุณาเลือกเหตุผลที่ส่งกลับ',
      payout_correction_note_too_long: 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร',
    };
    for (const [code, sentence] of Object.entries(SENTENCES)) {
      assert.equal(translateApiError(code), sentence, code);
      assert.doesNotMatch(sentence, /แก้บัญชี|บัญชีใหม่|อยู่ระหว่างแก้|บัญชีรับเงิน/u, code);
    }
    assertPlainThai(Object.values(SENTENCES), 'the refusals of a round');
    // The name of a claim's account outside a round too: "บัญชีรับเงิน". "บัญชีรับเงินคืน" names the member's standing account.
    assert.equal(translateApiError('payout_destination_required'), 'ยังไม่ได้ระบุบัญชีรับเงิน ระบุบัญชี หรือเลือกรับเป็นเงินสด');
  });

  // Spec §22: the payer had the form open when the claim was sent back. The save is refused, and the form says why.
  it('tells a payer whose form was open that the claim is having its payout account corrected, and to press nothing again', () => {
    const refused = Object.assign(new Error('payout_correction_in_progress'), { status: 409 });
    assert.equal(logic.paymentSaveErrorMessage('record', refused, true), 'ยังบันทึกจ่ายไม่สำเร็จ · ใบนี้ถูกส่งกลับเรื่องวิธีรับเงินคืน และยังไม่กลับมารอจ่าย จึงยังทำรายการนี้ไม่ได้ เปิดใบใหม่เพื่อดูว่าตอนนี้ใบรอใคร');
    // A payment that lost its race against the send-back itself is told to press save again; the next press is then refused as above.
    const lost = Object.assign(new Error('reimbursement_payment_state_changed'), { status: 409 });
    assert.match(logic.paymentSaveErrorMessage('record', lost, true), /^ยังบันทึกจ่ายไม่สำเร็จ เพราะมีการทำรายการกับใบนี้ในเวลาเดียวกัน/u);
  });
});

// ---- A decision on a claim that no longer waits for approval (any claim whose page is behind it, in a round or not) ----

describe('an approval or a rejection of a claim that no longer waits is answered in words, over the claim as it is now', () => {
  const pendingStep = { id: 'step-1', sequenceNo: 1, status: 'PENDING', approverUserId: 'boss', approverName: NAMES.approver, assignedAt: AT.submitted };
  /** A cash claim waiting for its approver: decided from its own page, with nothing to attest. */
  const waiting = (overrides: Record<string, unknown> = {}) => ready({
    status: 'PENDING_APPROVAL', paymentStatus: 'NOT_PAYABLE', approvedAt: undefined, currentDesk: { kind: 'APPROVER', names: [NAMES.approver] }, paymentDesk: undefined,
    payoutMethod: 'CASH', payout: { payoutMethod: 'CASH' }, payoutHistory: undefined, approvalSteps: [pendingStep], approvalActions: DECIDE, approvalSnapshotHash: 'hash-1', ...overrides,
  });
  /** The same claim, cancelled by its requester while the approver's page was open. */
  const cancelled = waiting({ status: 'CANCELLED', currentDesk: undefined, approvalActions: { canApprove: false, canReject: false }, approvalSteps: [{ ...pendingStep, status: 'CANCELLED' }] });
  // As the API answers it: 409, and the code as the message of a bare exception. It was 422 "Cannot approve from status CANCELLED".
  const NOT_WAITING = { status: 409, body: { statusCode: 409, message: 'reimbursement_not_awaiting_approval', error: 'Conflict' } };
  const SENTENCE = 'ใบนี้ไม่ได้รออนุมัติแล้ว จึงยังไม่ได้บันทึกการตัดสินของคุณ อาจมีผู้อนุมัติหรือปฏิเสธไปก่อน หรือคำขอถูกยกเลิกหรือเปิดกลับเป็นร่างไปแล้ว โหลดหน้านี้ใหม่เพื่อดูสถานะล่าสุด';
  const grabDecision = (type: unknown, _props: unknown, children: unknown[]) => (type === 'button' && children[0] === 'อนุมัติ' ? 'approve'
    : type === sections.RejectDialog ? 'reject' : undefined);
  /** The approver's page with the reject dialog open. Which of the page's `false` states holds it is found by the dialog it shows. */
  const withRejectDialog = (detail: object) => {
    for (let falseState = 1; falseState < 12; falseState += 1) {
      let nulls = 0;
      let falses = 0;
      try {
        const page = render(h(ReimbursementJourneyPage, { companyId: 'company-1', requestId: 'claim-1', userId: approver.userId, permissions: approver.permissions }), (start) => {
          if (start === null) { nulls += 1; return nulls === 2 ? detail : undefined; }
          if (start === false) { falses += 1; return falses === falseState ? true : undefined; }
          return undefined;
        }, grabDecision);
        if (page.handlers.reject && page.texts.includes('ปฏิเสธคำขอ RB-202610-00007')) return page;
      } catch { /* that state opens something this claim has not */ }
    }
    return null;
  };
  const dialogClosed = (page: ReturnType<typeof render>) => page.changes.some((change) => change.initial === false && change.shown === true && change.value === false);

  it('says the sentence the screens have for it, in plain Thai, and no status word', () => {
    assert.equal(translateApiError('reimbursement_not_awaiting_approval'), SENTENCE);
    assert.equal(logic.errorText(Object.assign(new Error('reimbursement_not_awaiting_approval'), { status: 409 })), SENTENCE);
    assertPlainThai([SENTENCE], 'the refusal');
  });

  it('approve: nothing is approved, the page reads the claim again and says what was not done, with no dialog and no toast', async () => {
    const page = claimPage(waiting(), approver, undefined, grabDecision);
    assert.deepEqual(stepCard(page.html).buttons, ['อนุมัติ', 'ปฏิเสธ', 'พิมพ์ใบเบิก']);
    toasts.length = 0;
    const calls = await withApi((_url, method) => (method === 'POST' ? NOT_WAITING : { status: 200, body: asAnswered(cancelled) }), () => page.handlers.approve.onClick());
    assert.deepEqual(calls.map((call) => [call.method, call.url.split('/').pop()]), [['POST', 'approve'], ['GET', 'claim-1']]);
    assert.ok(page.changes.some((change) => change.value === SENTENCE), 'the step card says it');
    assert.ok(page.changes.some((change) => (change.value as { status?: string } | null)?.status === 'CANCELLED'), 'over the claim as it is now');
    assert.equal(page.changes.some((change) => !!(change.value as { before?: unknown } | null)?.before), false, 'no dialog offering to approve it again');
    assert.deepEqual(toasts, []);
    // What that page then shows: a closed claim, with nothing left to decide.
    assert.deepEqual(stepCard(claimPage(cancelled, approver).html).buttons, ['พิมพ์ใบเบิก']);

    // The same refusal from the dialog of a claim edited after it was sent ("อนุมัติด้วยข้อมูลล่าสุด"): that dialog closes too.
    const grabStale = (type: unknown) => (type === sections.StaleApprovalDialog ? 'stale' : undefined);
    let review: ReturnType<typeof render> | null = null;
    for (let nullState = 3; nullState < 30 && !review; nullState += 1) {
      const candidate = opened(waiting(), approver, { nullState, value: { before: waiting(), detail: waiting({ reason: 'ไปพบลูกค้าที่เชียงใหม่', approvalSnapshotHash: 'hash-2' }) } }, grabStale);
      if (candidate?.handlers.stale) review = candidate;
    }
    assert.ok(review, 'the page with the dialog of an edited claim open');
    await withApi((_url, method) => (method === 'POST' ? NOT_WAITING : { status: 200, body: asAnswered(cancelled) }), () => review!.handlers.stale.onConfirm());
    assert.ok(review.changes.some((change) => change.value === SENTENCE));
    assert.ok(review.changes.some((change) => !!(change.shown as { before?: unknown } | null)?.before && change.value === null), 'the dialog closes');
  });

  it('reject: the dialog it can no longer finish closes, and the step card says what was not done', async () => {
    const page = withRejectDialog(waiting());
    assert.ok(page, 'the page with the reject dialog open');
    const calls = await withApi((_url, method) => (method === 'POST' ? NOT_WAITING : { status: 200, body: asAnswered(cancelled) }), () => page.handlers.reject.onConfirm('ยอดไม่ตรงกับใบเสร็จ'));
    assert.deepEqual(calls.map((call) => [call.method, call.url.split('/').pop(), call.body]),
      [['POST', 'reject', { reason: 'ยอดไม่ตรงกับใบเสร็จ' }], ['GET', 'claim-1', undefined]]);
    assert.ok(page.changes.some((change) => change.value === SENTENCE));
    assert.ok(dialogClosed(page), 'the dialog closes');

    // A refusal the approver can still put right, on a claim that still waits: the dialog stays, with what was typed.
    const still = withRejectDialog(waiting())!;
    await withApi((_url, method) => (method === 'POST' ? { status: 400, body: { statusCode: 400, message: 'note_contains_account_number' } } : { status: 200, body: asAnswered(waiting()) }),
      () => still.handlers.reject.onConfirm('โอนเข้าบัญชี 123-4-56789-0 ไม่ได้'));
    assert.ok(still.changes.some((change) => change.value === translateApiError('note_contains_account_number')));
    assert.equal(dialogClosed(still), false);
  });
});
