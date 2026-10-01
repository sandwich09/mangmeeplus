import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {
  REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH, REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS, isReimbursementPayoutCorrectionReason,
} from '@watchdog-bms/contracts';
import { translateApiError } from '@/common/api/api-error-message';
import { ToastContext } from '@/common/components/toast/use-toast';
import {
  PAYOUT_CORRECTION_REASONS, emptyPayoutCorrectionForm, payoutCorrectionAccountText, payoutCorrectionCardNote, payoutCorrectionFormError,
  payoutCorrectionInput, payoutCorrectionReasonText, payoutCorrectionRequestError, payoutCorrectionRequestInput, payoutCorrectionSendBackNotes,
  payoutCorrectionSentBackText, payoutCorrectionSubmittedText, type PayoutCorrectionForm,
} from './reimbursement-payout.logic';

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
type StateChange = { initial: unknown; value: unknown };

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
    return [shown, (next: unknown) => { changes.push({ initial: start, value: typeof next === 'function' ? (next as (current: unknown) => unknown)(shown) : next }); set(next); }];
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

describe('sending a claim back for its payout account: what the form asks and sends', () => {
  it('lists the six fixed reasons in the API\'s own words and order, and prints no code for a reason it does not know', () => {
    assert.deepEqual(PAYOUT_CORRECTION_REASONS.map(([, label]) => label),
      ['เลขบัญชีไม่ถูกต้อง', 'ชื่อบัญชีไม่ตรงกับผู้เบิก', 'ธนาคารไม่ถูกต้อง', 'บัญชีปิดหรือโอนไม่ได้', 'ผู้เบิกขอเปลี่ยนบัญชี', 'อื่น ๆ']);
    assert.deepEqual(PAYOUT_CORRECTION_REASONS.map(([code]) => code), Object.keys(REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS));
    for (const [code, label] of PAYOUT_CORRECTION_REASONS) {
      assert.equal(isReimbursementPayoutCorrectionReason(code), true);
      assert.equal(payoutCorrectionReasonText(code), label);
    }
    for (const unknown of ['A_REASON_ADDED_LATER', '', undefined, null, 7]) assert.equal(payoutCorrectionReasonText(unknown), '');
  });

  it('refuses, before asking the API and in the API\'s own sentences, no reason, a note over 500 characters and a note with an account number', () => {
    assert.equal(payoutCorrectionRequestError('', ''), 'กรุณาเลือกเหตุผลที่ส่งกลับให้แก้บัญชีรับเงิน');
    assert.equal(payoutCorrectionRequestError('A_REASON_ADDED_LATER', ''), translateApiError('payout_correction_reason_required'));
    assert.equal(REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH, 500);
    assert.equal(payoutCorrectionRequestError('OTHER', 'ก'.repeat(501)), 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร');
    assert.equal(payoutCorrectionRequestError('OTHER', `  ${'ก'.repeat(500)}  `), null, 'the note is trimmed, as the API trims it');
    for (const note of ['โอนเข้า 004-5-67123-4 ไม่ได้', 'เลข 0045671234', 'เบอร์ 081 234 5678']) {
      assert.equal(payoutCorrectionRequestError('ACCOUNT_NUMBER_WRONG', note), translateApiError('note_contains_account_number'), note);
    }
    // The note is optional for every reason, อื่น ๆ included, and a document number or an amount in it is no account number.
    for (const [code] of PAYOUT_CORRECTION_REASONS) assert.equal(payoutCorrectionRequestError(code, ''), null, code);
    assert.equal(payoutCorrectionRequestError('ACCOUNT_UNUSABLE', 'ธนาคารแจ้งว่าไม่พบบัญชีนี้ ใบ RB-202610-00007 ยอด 1614 บาท'), null);
    // Each of the three is a sentence: a label that went missing would let the form send what the API refuses.
    for (const code of ['payout_correction_reason_required', 'payout_correction_note_too_long', 'note_contains_account_number']) assert.ok(translateApiError(code), code);
  });

  it('sends the reason with the trimmed note, and no note at all when none was typed', () => {
    assert.deepEqual(payoutCorrectionRequestInput('ACCOUNT_NUMBER_WRONG', '  ธนาคารแจ้งว่าไม่พบบัญชีนี้ '), { reasonCode: 'ACCOUNT_NUMBER_WRONG', note: 'ธนาคารแจ้งว่าไม่พบบัญชีนี้' });
    assert.deepEqual(payoutCorrectionRequestInput('REQUESTER_ASKED', '   '), { reasonCode: 'REQUESTER_ASKED' });
  });

  it('says who sent it back and why in one sentence, without a name or a reason it does not have', () => {
    assert.equal(payoutCorrectionSentBackText({ byName: 'วราภรณ์ การเงิน', reasonCode: 'ACCOUNT_NUMBER_WRONG' }), 'ส่งกลับให้แก้บัญชีรับเงินโดย วราภรณ์ การเงิน : เลขบัญชีไม่ถูกต้อง');
    assert.equal(payoutCorrectionSentBackText({ reasonCode: 'BANK_WRONG' }), 'ส่งกลับให้แก้บัญชีรับเงิน : ธนาคารไม่ถูกต้อง');
    assert.equal(payoutCorrectionSentBackText({ byName: 'สมศรี ผู้จัดการ', reasonCode: 'A_REASON_ADDED_LATER' }), 'ส่งกลับให้แก้บัญชีรับเงินโดย สมศรี ผู้จัดการ');
    assert.equal(payoutCorrectionSentBackText(undefined), 'ส่งกลับให้แก้บัญชีรับเงิน');
  });

  it('says the requester gave the account, and names whoever gave it on their behalf', () => {
    assert.equal(payoutCorrectionSubmittedText({ byUserId: 'staff', byName: 'สมชาย พนักงาน' }, 'staff'), 'ผู้เบิกแก้บัญชีรับเงิน');
    assert.equal(payoutCorrectionSubmittedText({ byUserId: 'finance', byName: 'วราภรณ์ การเงิน' }, 'staff'), 'วราภรณ์ การเงิน แก้บัญชีรับเงินแทนผู้เบิก');
    // Someone else whose name can no longer be resolved is still not said to be the requester.
    assert.equal(payoutCorrectionSubmittedText({ byUserId: 'gone' }, 'staff'), 'ผู้จัดทำ แก้บัญชีรับเงินแทนผู้เบิก');
    assert.equal(payoutCorrectionSubmittedText(undefined, 'staff'), 'ผู้เบิกแก้บัญชีรับเงิน');
  });
});

describe('what whoever sends a claim back is told before they confirm (spec §14.1, §14.4)', () => {
  const ready = { payout: KBANK, signatures: [], signedCopies: [] };

  it('says what changes and what does not, and how the claim comes back to the pay step', () => {
    assert.deepEqual(payoutCorrectionSendBackNotes(ready), [
      'ใบนี้จะกลับไปให้ผู้เบิกแก้บัญชีรับเงิน ระหว่างนี้ยังบันทึกจ่ายไม่ได้ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน',
      'เมื่อผู้เบิกแก้แล้ว ผู้อนุมัติชุดเดิมอนุมัติบัญชีใหม่ก่อนจึงจ่ายได้ ใบที่ไม่ต้องอนุมัติตามนโยบายจะกลับมารอจ่ายทันที',
    ]);
  });

  // Plan 3.13 and the task's item 7: what is signed is signed on the account in question, and the server removes it at the send-back.
  it('says plainly that signatures in the system are removed and a paper-signed copy stops counting, only where the claim has them', () => {
    const signed = payoutCorrectionSendBackNotes({ ...ready, signatures: [{ role: 'REQUESTER' }, { role: 'APPROVER' }] });
    assert.ok(signed.includes('ลายเซ็นในระบบที่ลงไว้ในใบนี้จะถูกลบ ต้องลงนามใหม่หลังบัญชีใหม่ได้รับอนุมัติ'));
    assert.equal(signed.some((note) => note.includes('สำเนา')), false, 'no declared copy on this claim');
    const paper = payoutCorrectionSendBackNotes({ ...ready, signedCopies: [{ acknowledgedAt: '2026-10-01T05:00:00.000Z' }, {}] });
    assert.ok(paper.includes('สำเนาใบเบิกที่ลงนามบนกระดาษยังเปิดดูได้ แต่จะไม่นับว่าลงนามแล้ว ต้องแนบสำเนาใหม่หลังบัญชีใหม่ได้รับอนุมัติ'));
    assert.equal(paper.some((note) => note.includes('ลายเซ็นในระบบ')), false);
    // A file attached without the declaration signed nothing, so nothing is said to be lost.
    assert.equal(payoutCorrectionSendBackNotes({ ...ready, signedCopies: [{}] }).length, 2);
  });

  it('tells a claim sent before claims carried an account that it will get one, and still what happens to its signatures', () => {
    const legacy = payoutCorrectionSendBackNotes({ payout: undefined, signatures: [{ role: 'REQUESTER' }], signedCopies: [] });
    assert.ok(legacy.includes('ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน จึงไม่มีบัญชีที่ผ่านการอนุมัติในใบ หลังส่งกลับ ผู้เบิกจะระบุบัญชีรับเงินของใบนี้ได้'));
    assert.ok(legacy.includes('ลายเซ็นในระบบที่ลงไว้ในใบนี้จะถูกลบ ต้องลงนามใหม่หลังบัญชีใหม่ได้รับอนุมัติ'));
    assert.equal(payoutCorrectionSendBackNotes(ready).some((note) => note.includes('ส่งก่อนมีช่องบัญชีรับเงิน')), false);
  });

  it('says, from the round\'s waiting step, that the claim goes back once more and is not rejected', () => {
    assert.deepEqual(payoutCorrectionSendBackNotes({ ...ready, payoutCorrectionPhase: 'AWAITING_APPROVAL', payout: SCB }),
      ['ใบนี้จะกลับไปให้ผู้เบิกแก้บัญชีรับเงินอีกครั้ง ใบไม่ถูกปฏิเสธ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน']);
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

  it('tells the reader of the card "การรับเงินคืน" which account they are looking at while the claim is in a round', () => {
    assert.equal(payoutCorrectionCardNote({ payoutCorrectionPhase: 'AWAITING_REQUESTER', payout: KBANK }),
      'ใบนี้ถูกส่งกลับให้แก้บัญชีรับเงิน ด้านล่างคือวิธีรับเงินเดิมของใบ ระหว่างนี้ยังบันทึกจ่ายไม่ได้');
    assert.equal(payoutCorrectionCardNote({ payoutCorrectionPhase: 'AWAITING_REQUESTER' }), 'ใบนี้ถูกส่งกลับให้ระบุบัญชีรับเงิน ระหว่างนี้ยังบันทึกจ่ายไม่ได้');
    assert.equal(payoutCorrectionCardNote({ payoutCorrectionPhase: 'AWAITING_APPROVAL', payout: SCB }), 'ด้านล่างคือวิธีรับเงินใหม่ที่ผู้เบิกส่งมา รอผู้อนุมัติอนุมัติก่อนจึงจ่ายได้');
    assert.equal(payoutCorrectionCardNote({ payout: SCB }), null);
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
const SENT_BACK = { kind: 'SENT_BACK', at: AT.sentBack, byUserId: 'finance', byName: NAMES.payer, reasonCode: 'ACCOUNT_NUMBER_WRONG', note: 'ธนาคารแจ้งว่าไม่พบบัญชีนี้' };
const GIVEN = { kind: 'ACCOUNT_SUBMITTED', at: AT.given, byUserId: 'staff', byName: NAMES.requester, payoutMethod: 'BANK_TRANSFER', payoutVersion: 2 };
const REAPPROVED = { kind: 'REAPPROVED', at: AT.reapproved, byUserId: 'boss', byName: NAMES.approver, approvalStepId: 'step-2' };
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
/** Phase B: the requester gave the SCB account, and a new step waits for the approver the claim had. */
const phaseB = (overrides: Record<string, unknown> = {}) => phaseA({
  payoutCorrectionPhase: 'AWAITING_APPROVAL', currentDesk: { kind: 'APPROVER', names: [NAMES.approver] }, approvalSnapshotHash: 'hash-of-version-2',
  payout: { ...SCB, source: 'REQUESTER' }, payoutHistory: [version1, version2],
  payoutCorrection: { phase: 'AWAITING_APPROVAL', ...round, submittedAt: AT.given }, approvalSteps: [setAside, step2], payoutCorrectionHistory: [SENT_BACK, GIVEN], ...overrides,
});
/** After the round: approved again, back at the pay step with the new account and its new attester. */
const reapproved = (overrides: Record<string, unknown> = {}) => ready({
  approvedAt: AT.reapproved, payout: { ...SCB, source: 'REQUESTER', ...attested, verifiedAt: AT.reapproved },
  payoutHistory: [version1, { ...version2, ...attested, verifiedAt: AT.reapproved, approvalStepId: 'step-2' }],
  approvalSteps: [setAside, { ...step2, status: 'APPROVED', decisionByUserId: 'boss', decidedByName: NAMES.approver, decidedAt: AT.reapproved }],
  payoutCorrectionHistory: [SENT_BACK, GIVEN, REAPPROVED], ...overrides,
});

describe('the send-back form (spec §14.3): inside the step card, a fixed reason, an optional note', () => {
  /** The form's own states, in the order it declares them: the reason, the note, then the banner. */
  const form = (detail: object, state: { reasonCode?: string; note?: string; error?: string } = {}, onDone: (claim: unknown) => void = noop) => {
    let blanks = 0;
    return render(h(correctionUi.PayoutCorrectionRequestForm, { companyId: 'company-1', detail, onCancel: noop, onDone }), (start) => {
      if (start === '') { blanks += 1; return blanks === 1 ? state.reasonCode : state.note; }
      return start === null ? state.error : undefined;
    }, grabForm('reimbursement-payout-correction-request'));
  };

  it('lists the six reasons as choices of 44 px, takes a note of at most 500 characters, and is no dialog', () => {
    const { html, texts } = form(ready());
    assert.deepEqual(texts.filter((text) => PAYOUT_CORRECTION_REASONS.some(([, label]) => label === text)), PAYOUT_CORRECTION_REASONS.map(([, label]) => label));
    assert.equal(html.match(/<input type="radio"/g)?.length, 6);
    assert.equal(html.match(/<label class="flex min-h-11 cursor-pointer/g)?.length, 6, 'each reason is a tap target of 44 px');
    assert.doesNotMatch(html, /<input type="radio"[^>]*checked=""/, 'no reason is chosen for the person');
    assert.match(html, /<textarea id="reimbursement-payout-correction-note"[^>]*maxLength="500"/);
    for (const text of ['ส่งกลับให้แก้บัญชีรับเงิน', 'เหตุผลที่ส่งกลับ *', 'หมายเหตุ (ไม่บังคับ)', 'ผู้เบิกและทุกคนที่เปิดใบนี้เห็นหมายเหตุนี้ อย่าพิมพ์เลขบัญชี', '0/500', 'ยกเลิก', 'ยืนยันส่งกลับ']) {
      assert.ok(texts.includes(text), text);
    }
    assert.doesNotMatch(html, /role="dialog"/);
    // Both buttons span the card on a phone and sit side by side from sm.
    assert.equal(html.match(/class="mangmee-btn [^"]*w-full sm:w-auto"/g)?.length, 2);
    assertPlainThai(texts, 'the send-back form');
  });

  it('says what will happen before the person confirms, signatures included, and from the round\'s step that the claim is not rejected', () => {
    const signed = form(ready({ signatures: [{ role: 'REQUESTER' }], signedCopies: [{ attachmentId: 'a', fileName: 'ใบเบิก.pdf', acknowledgedAt: AT.approved }] })).texts;
    for (const note of payoutCorrectionSendBackNotes({ payout: KBANK, signatures: [{}], signedCopies: [{ acknowledgedAt: AT.approved }] })) assert.ok(signed.includes(note), note);
    assert.ok(signed.some((text) => text.startsWith('ลายเซ็นในระบบที่ลงไว้ในใบนี้จะถูกลบ')));
    const again = form(phaseB()).texts;
    assert.equal(heading(form(phaseB()).html), 'ส่งกลับให้แก้อีกครั้ง');
    assert.equal(heading(form(ready()).html), 'ส่งกลับให้แก้บัญชีรับเงิน');
    assert.ok(again.includes('ใบนี้จะกลับไปให้ผู้เบิกแก้บัญชีรับเงินอีกครั้ง ใบไม่ถูกปฏิเสธ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน'));
    assert.equal(again.includes('ปฏิเสธ'), false);
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
      [{ note: 'โอนไม่เข้า' }, 'กรุณาเลือกเหตุผลที่ส่งกลับให้แก้บัญชีรับเงิน'],
      [{ reasonCode: 'OTHER', note: 'เลขที่ถูกคือ 004-5-67123-4' }, translateApiError('note_contains_account_number')!],
    ] as const) {
      const done: unknown[] = [];
      const { handlers, changes } = form(ready(), state, (claim) => done.push(claim));
      const calls = await withApi(() => ({ status: 200, body: {} }), () => handlers.form.onSubmit(submitEvent));
      assert.deepEqual([calls, done], [[], []]);
      assert.deepEqual(changes, [{ initial: null, value: sentence }]);
    }
  });

  // A lost race (someone paid, cancelled or sent the claim back first) or a refusal: the sentence, and nothing typed is lost.
  it('shows the server\'s sentence for a lost race or a refusal and keeps the reason and the note as typed', async () => {
    for (const [status, code, sentence] of [
      [409, 'reimbursement_changed', 'คำขอถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง'],
      [409, 'payout_correction_not_allowed', 'ใบนี้ส่งกลับแก้บัญชีไม่ได้ในสถานะปัจจุบัน'],
      [409, 'payout_correction_in_progress', 'ใบนี้อยู่ระหว่างแก้บัญชีรับเงิน'],
      [403, 'payout_correction_denied', 'คุณไม่มีสิทธิ์ทำรายการแก้บัญชีรับเงินของใบนี้'],
    ] as const) {
      const done: unknown[] = [];
      const { handlers, changes } = form(ready(), { reasonCode: 'BANK_WRONG', note: 'ผู้เบิกแจ้งว่าเปลี่ยนธนาคารแล้ว' }, (claim) => done.push(claim));
      const calls = await withApi(() => ({ status, body: { statusCode: status, message: code } }), () => handlers.form.onSubmit(submitEvent));
      assert.equal(calls.length, 1, code);
      assert.deepEqual(done, [], `${code}: the page is not told the claim moved`);
      // Busy on, banner cleared, the sentence, busy off: the reason ('') and the note ('') states are never set.
      assert.deepEqual(changes, [{ initial: false, value: true }, { initial: null, value: null }, { initial: null, value: sentence }, { initial: false, value: false }], code);
    }
    // What the person then sees: their reason still chosen, their note still in the box, and the sentence.
    const { html, texts } = form(ready(), { reasonCode: 'BANK_WRONG', note: 'ผู้เบิกแจ้งว่าเปลี่ยนธนาคารแล้ว', error: 'ใบนี้อยู่ระหว่างแก้บัญชีรับเงิน' });
    assert.match(html, /<input type="radio"[^>]*checked=""[^>]*\/><span class="min-w-0">ธนาคารไม่ถูกต้อง<\/span>/);
    assert.match(html, /<textarea[^>]*>ผู้เบิกแจ้งว่าเปลี่ยนธนาคารแล้ว<\/textarea>/);
    assert.ok(texts.includes('⚠ ใบนี้อยู่ระหว่างแก้บัญชีรับเงิน'));
    assert.match(html, /role="alert"/);
  });
});

describe('the account form of a claim in a round (spec §14.5): the default, a typed account, or cash', () => {
  const DEFAULT = { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกรุงเทพ', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' };
  const withDefault = (detail: Record<string, any>, requesterDefault: object = DEFAULT) => ({ ...detail, payoutCorrectionActions: { canRequest: false, canSubmit: true, requesterDefault } });
  const typed = { payoutKind: 'BANK_ACCOUNT' as const, bankChoice: 'ธนาคารไทยพาณิชย์', bankOther: '', accountName: 'นาย สมชาย ใจดี', accountNumber: '111-2-33444-1112' };
  /** The form's own states: what was picked and typed, whether the server lets this viewer save a default, then the banner. */
  const form = (detail: object, state: { picked?: Partial<PayoutCorrectionForm>; canSaveAsDefault?: boolean; error?: string; userId?: string } = {}, onDone: (claim: unknown) => void = noop) => {
    let falses = 0;
    return render(h(correctionUi.PayoutCorrectionAccountForm, { companyId: 'company-1', detail, userId: state.userId ?? 'staff', canEditEmployees: false, onCancel: noop, onDone }), (start) => {
      if (start && typeof start === 'object' && 'saveAsDefault' in start) return { ...start, ...state.picked };
      if (start === false) { falses += 1; return falses === 1 ? state.canSaveAsDefault : undefined; }
      return start === null ? state.error : undefined;
    }, grabForm('reimbursement-payout-correction-account'));
  };
  const choices = (texts: string[]) => texts.filter((text) => ['ใช้บัญชีรับเงินคืนประจำของฉัน', 'ใช้บัญชีรับเงินคืนประจำของผู้เบิก', 'รับเป็นเงินสด', 'ระบุบัญชีสำหรับใบนี้'].includes(text));

  it('offers the requester\'s default account as the server shows it now, masked, beside cash and a typed account, and chooses none', () => {
    const { html, texts } = form(withDefault(phaseA()));
    assert.deepEqual(choices(texts), ['ใช้บัญชีรับเงินคืนประจำของฉัน', 'รับเป็นเงินสด', 'ระบุบัญชีสำหรับใบนี้']);
    assert.ok(texts.includes('ธนาคารกรุงเทพ เลขบัญชีลงท้าย 6789 · ชื่อบัญชี นาย สมชาย ใจดี'));
    assert.doesNotMatch(html, /<input type="radio"[^>]*checked=""/);
    assert.equal(html.includes(DEFAULT.token), false, 'the token is sent, never shown');
    assert.equal(html.match(/\d{5,}/g), null, 'the last 4 digits only');
    for (const text of ['แก้บัญชีรับเงิน', 'เลือกวิธีรับเงินคืนของใบนี้ใหม่ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน', 'ยกเลิก', 'บันทึกบัญชีรับเงิน']) assert.ok(texts.includes(text), text);
    assert.doesNotMatch(html, /role="dialog"/);
    assert.equal(html.match(/<label class="flex min-h-11 cursor-pointer/g)?.length, 3);
    assertPlainThai(texts, 'the account form');
  });

  it('offers no default the requester has not set, and none that is cash: cash is its own choice', () => {
    assert.deepEqual(choices(form(phaseA({ payoutCorrectionActions: { canRequest: false, canSubmit: true } })).texts), ['รับเป็นเงินสด', 'ระบุบัญชีสำหรับใบนี้']);
    assert.deepEqual(choices(form(withDefault(phaseA(), { payoutMethod: 'CASH', token: DEFAULT.token })).texts), ['รับเป็นเงินสด', 'ระบุบัญชีสำหรับใบนี้']);
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
    assert.deepEqual(choices(texts), ['ใช้บัญชีรับเงินคืนประจำของผู้เบิก', 'รับเป็นเงินสด', 'ระบุบัญชีสำหรับใบนี้']);
    assert.ok(texts.includes('กรอกบัญชีของผู้เบิก หลังบันทึกคุณจะเห็นเฉพาะ 4 ตัวท้าย และผู้เบิกจะได้รับแจ้งเตือน'));
    assert.ok(texts.includes('บันทึกเป็นบัญชีประจำของผู้เบิก'));
  });

  it('says what happens after the save: the same approvers approve the new account, or a claim nobody approves is ready for payment', () => {
    assert.ok(form(withDefault(phaseA())).texts.includes('เมื่อบันทึกแล้ว ใบจะส่งให้ผู้อนุมัติชุดเดิมอนุมัติบัญชีใหม่ก่อนจ่าย ถ้าใบนี้ไม่ต้องอนุมัติตามนโยบาย ใบจะกลับไปรอจ่ายทันที'));
    assert.ok(form(withDefault(phaseB())).texts.includes('เมื่อบันทึกแล้ว บัญชีที่ส่งไปก่อนหน้าจะถูกแทนที่ และผู้อนุมัติจะตรวจบัญชีใหม่นี้แทน'));
  });

  it('sends each choice to the account endpoint as the API takes it, the default by the token of the account shown', async () => {
    const answer = asAnswered(phaseB());
    for (const [picked, canSaveAsDefault, body] of [
      [{ mode: 'DEFAULT' }, false, { mode: 'DEFAULT', defaultToken: DEFAULT.token }],
      [{ mode: 'CASH' }, false, { mode: 'CASH' }],
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
      [409, 'payout_correction_not_requested', 'ใบนี้ไม่ได้ถูกส่งกลับให้แก้บัญชีรับเงิน กรุณาเปิดใบใหม่เพื่อดูสถานะล่าสุด'],
      [409, 'reimbursement_changed', 'คำขอถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง'],
      [403, 'payout_correction_denied', 'คุณไม่มีสิทธิ์ทำรายการแก้บัญชีรับเงินของใบนี้'],
    ] as const) {
      const done: unknown[] = [];
      const { handlers, changes } = form(withDefault(phaseA()), { picked: { mode: 'SPECIFIED', account: typed } }, (claim) => done.push(claim));
      const calls = await withApi(() => ({ status, body: { statusCode: status, message: code } }), () => handlers.form.onSubmit(submitEvent));
      assert.deepEqual([calls.length, done], [1, []], code);
      assert.ok(changes.some((change) => change.value === sentence), `${code}: ${JSON.stringify(changes)}`);
      // The form's own state (what was picked and typed) is never set again by a refusal.
      assert.equal(changes.some((change) => !!change.initial && typeof change.initial === 'object' && 'saveAsDefault' in change.initial), false, code);
    }
    const { html, texts } = form(withDefault(phaseA()), { picked: { mode: 'SPECIFIED', account: typed }, error: 'ใบนี้อยู่ระหว่างแก้บัญชีรับเงิน' });
    assert.match(html, /<input[^>]*aria-label="ชื่อบัญชี"[^>]*value="นาย สมชาย ใจดี"/);
    assert.match(html, /<input[^>]*aria-label="เลขบัญชี"[^>]*value="111-2-33444-1112"/);
    assert.ok(texts.includes('⚠ ใบนี้อยู่ระหว่างแก้บัญชีรับเงิน'));
  });
});

describe('the card a round\'s approvers compare (spec §14.6)', () => {
  const card = (detail: object) => render(h(correctionUi.PayoutCorrectionComparison, { detail }));

  it('sets the account the claim was approved with beside the new one, last 4 digits only, and says nothing else changed', () => {
    const { html, texts } = card(phaseB());
    assert.deepEqual(texts, [
      'สิ่งที่เปลี่ยน: บัญชีรับเงินคืน',
      'บัญชีเดิม', 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 5678 · ชื่อบัญชี นาย สมชาย ใจดี',
      'บัญชีใหม่', 'ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 1112 · ชื่อบัญชี นาย สมชาย ใจดี',
      'รายการและยอดเงิน 1,614.50 บาท เท่ากับที่อนุมัติไว้เมื่อ 1 ต.ค. 2569 10:00 น. การอนุมัติครั้งนี้ตรวจเฉพาะบัญชีรับเงินคืน',
      'ส่งกลับให้แก้บัญชีรับเงินโดย วราภรณ์ การเงิน : เลขบัญชีไม่ถูกต้อง', 'หมายเหตุ: ธนาคารแจ้งว่าไม่พบบัญชีนี้',
      'ผู้เบิกแก้บัญชีรับเงิน เมื่อ 1 ต.ค. 2569 12:00 น.',
    ]);
    assert.equal(html.match(/\d{5,}/g), null);
    assertPlainThai(texts, 'the comparison card');
  });

  it('reads a change to or from cash, an account given on the requester\'s behalf, and a claim that had no account', () => {
    const toCash = logic.payoutCorrectionComparison(phaseB({ payout: { payoutMethod: 'CASH' }, payoutCorrectionHistory: [SENT_BACK, { ...GIVEN, payoutMethod: 'CASH', payoutVersion: undefined }] }))!;
    assert.deepEqual([toCash.previous, toCash.current], ['ธนาคารกสิกรไทย เลขบัญชีลงท้าย 5678 · ชื่อบัญชี นาย สมชาย ใจดี', 'รับเป็นเงินสด']);
    const fromCash = logic.payoutCorrectionComparison(phaseB({ payoutCorrection: { phase: 'AWAITING_APPROVAL', ...round, previous: { payoutMethod: 'CASH' }, submittedAt: AT.given } }))!;
    assert.equal(fromCash.previous, 'รับเป็นเงินสด');
    const onBehalf = logic.payoutCorrectionComparison(phaseB({ payoutCorrectionHistory: [SENT_BACK, { ...GIVEN, byUserId: 'finance', byName: NAMES.payer }] }))!;
    assert.equal(onBehalf.submitted, 'วราภรณ์ การเงิน แก้บัญชีรับเงินแทนผู้เบิก เมื่อ 1 ต.ค. 2569 12:00 น.');
    // A claim sent before claims carried an account had none to be approved with.
    const legacy = logic.payoutCorrectionComparison(phaseB({ payoutCorrection: { phase: 'AWAITING_APPROVAL', ...round, previous: undefined, submittedAt: AT.given } }))!;
    assert.equal(legacy.previous, 'ไม่มี ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน');
    // An action's answer carries no history: the card still says when the account was given.
    assert.equal(logic.payoutCorrectionComparison(phaseB({ payoutCorrectionHistory: undefined }))!.submitted, 'ผู้เบิกแก้บัญชีรับเงิน เมื่อ 1 ต.ค. 2569 12:00 น.');
  });

  it('is shown for a claim whose new account waits for approval, and for no other claim', () => {
    for (const detail of [ready(), phaseA(), reapproved(), { status: 'PENDING_APPROVAL' }]) {
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
    ['the requester', requester, { payoutCorrectionActions: SEND }, ['ส่งกลับให้แก้บัญชีรับเงิน', 'ยกเลิกคำขอ', 'พิมพ์ใบเบิก']],
    ['the approver the claim stands on', approver, { payoutCorrectionActions: SEND }, ['ส่งกลับให้แก้บัญชีรับเงิน', 'พิมพ์ใบเบิก']],
    ['a payer', payer, { payoutCorrectionActions: SEND }, ['บันทึกจ่าย', 'ส่งกลับให้แก้บัญชีรับเงิน', 'พิมพ์ใบเบิก']],
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
        const { html } = claimPage(detail, viewer);
        assert.deepEqual(stepCard(html).buttons, buttons, `${point}, ${name}`);
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

  it('tells whoever may send the claim back that a wrong account is sent back before it is paid', () => {
    assert.equal(stepCard(claimPage(ready({ payoutCorrectionActions: SEND }), payer).html).note,
      'บันทึกจ่ายเต็มจำนวน ระบุวิธีจ่าย วันที่ และเลขอ้างอิง · ถ้าวิธีรับเงินหรือบัญชีรับเงินไม่ถูกต้อง กดส่งกลับให้แก้บัญชีรับเงินก่อนมีการจ่าย');
    assert.equal(stepCard(claimPage(ready({ payoutCorrectionActions: SEND }), requester).html).note,
      'รอ วราภรณ์ การเงิน บันทึกจ่าย · ถ้าวิธีรับเงินหรือบัญชีรับเงินไม่ถูกต้อง กดส่งกลับให้แก้บัญชีรับเงินก่อนมีการจ่าย');
    // A viewer the server does not let send it back reads the note as before.
    assert.equal(stepCard(claimPage(ready(), auditor).html).note, 'รอ วราภรณ์ การเงิน บันทึกจ่าย');
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
    assert.equal(stepCard(claimPage(phaseA({ payoutCorrectionActions: GIVE }), requester).html).note.split(' · ').at(-1), 'รอคุณแก้บัญชีรับเงิน กดแก้บัญชีรับเงินแล้วเลือกวิธีรับเงินที่ถูกต้อง');
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
    assert.match(blocked.note!, /^รอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงินใหม่ · ใบนี้เป็นของคุณเอง และบริษัทยังไม่เปิด "ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้" คุณจึงอนุมัติบัญชีใหม่เองไม่ได้ · /u);
    assert.doesNotMatch(blocked.note!, /เปิดคำขอกลับเป็นร่าง/u);
    assert.deepEqual(blocked.actions, ['correct-payout', 'cancel', 'print']);
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
    assert.deepEqual(card.buttons, ['ยกเลิกคำขอ', 'พิมพ์ใบเบิก', 'ยกเลิก', 'บันทึกบัญชีรับเงิน']);
    assert.equal(heading(card.html), 'แก้บัญชีรับเงิน');
    assert.equal(heading(stepCard(withForm(phaseA({ payoutCorrectionActions: GIVE }), financeReviewer, 'correct-payout')!.html).html), 'แก้บัญชีรับเงินแทนผู้เบิก');
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

  it('keeps the page and the form as they are when the send-back is refused: no reload, no toast, the sentence in the form', async () => {
    const page = filled(ready({ payoutCorrectionActions: SEND }), payer, 'send-back', { blanks: ['ACCOUNT_UNUSABLE', 'ธนาคารแจ้งว่าบัญชีปิดแล้ว'] });
    toasts.length = 0;
    const calls = await withApi(() => ({ status: 409, body: { statusCode: 409, message: 'reimbursement_changed' } }), () => page.handlers.form.onSubmit(submitEvent));
    assert.equal(calls.length, 1, 'the claim is not read again, so the form and what was typed stay on the screen');
    assert.deepEqual(toasts, []);
    assert.ok(page.changes.some((change) => change.value === 'คำขอถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง'));
    assert.equal(page.changes.some((change) => (change.value as { status?: string } | null)?.status !== undefined), false, 'the claim on the page is not replaced');
  });

  it('gives the account from the page and says where the claim went: to its approvers, or straight back to the pay step', async () => {
    for (const [answer, said] of [
      [asAnswered(phaseB()), 'บันทึกบัญชีรับเงินแล้ว รอผู้อนุมัติอนุมัติบัญชีใหม่'],
      // Plan 3.12: a claim nobody has to approve is ready for payment in the same call.
      [asAnswered(ready({ approvalSteps: [], payout: { payoutMethod: 'CASH' } })), 'บันทึกบัญชีรับเงินแล้ว ใบกลับไปรอจ่ายเงินคืน'],
    ] as const) {
      const page = filled(phaseA({ payoutCorrectionActions: GIVE }), requester, 'correct-payout', { picked: { mode: 'CASH' } });
      toasts.length = 0;
      const calls = await withApi(() => ({ status: 200, body: answer }), () => page.handlers.form.onSubmit(submitEvent));
      assert.deepEqual(calls.map((call) => `${call.method} ${call.url.split('/claim-1')[1]}`), ['PUT /payout-destination', 'GET ']);
      assert.deepEqual(calls[0]!.body, { mode: 'CASH' });
      assert.deepEqual(toasts, [said]);
    }
  });
});

describe('the approval of a round: the comparison, the attestation of the NEW account, and no refusal (spec §14.6, AC31)', () => {
  const asApprover = (overrides: Record<string, unknown> = {}) => phaseB({ approvalActions: DECIDE, payoutCorrectionActions: SEND, ...overrides });

  it('shows the comparison card in the approval step card, above the attestation tick and the two buttons', () => {
    const { html } = claimPage(asApprover(), approver);
    const card = stepCard(html);
    const order = ['สิ่งที่เปลี่ยน: บัญชีรับเงินคืน</h3>', 'ฉันตรวจแล้วว่าบัญชีนี้เป็นบัญชีรับเงินของผู้เบิก</span>', 'อนุมัติ</button>', 'ส่งกลับให้แก้อีกครั้ง</button>']
      .map((text) => card.html.indexOf(`>${text}`));
    assert.ok(order.every((at) => at >= 0) && order.join() === [...order].sort((a, b) => a - b).join(), order.join());
    assert.ok(visible(card.html).includes('รายการและยอดเงิน 1,614.50 บาท เท่ากับที่อนุมัติไว้เมื่อ 1 ต.ค. 2569 10:00 น. การอนุมัติครั้งนี้ตรวจเฉพาะบัญชีรับเงินคืน'));
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

  it('needs no tick for a claim changed to cash, and still shows what changed', () => {
    const toCash = asApprover({ payoutMethod: 'CASH', payout: { payoutMethod: 'CASH' } });
    const card = stepCard(claimPage(toCash, approver).html);
    assert.equal(visible(card.html).includes('ฉันตรวจแล้วว่าบัญชีนี้เป็นบัญชีรับเงินของผู้เบิก'), false);
    assert.doesNotMatch(/<button\b([^>]*)>อนุมัติ<\/button>/u.exec(card.html)![1]!, /disabled=""/);
    assert.ok(visible(card.html).includes('รับเป็นเงินสด'));
  });
});

describe('after the approval the claim is back at its pay step with the new account (AC31)', () => {
  it('shows the new account in the box "โอนเข้าบัญชีนี้" with who attested it, and offers the payment and a new send-back', () => {
    const { html, texts } = claimPage(reapproved({ payoutCorrectionActions: SEND }), payer);
    assert.deepEqual(stepCard(html).buttons, ['บันทึกจ่าย', 'ส่งกลับให้แก้บัญชีรับเงิน', 'พิมพ์ใบเบิก']);
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
    assert.ok(a.includes('ใบนี้ถูกส่งกลับให้แก้บัญชีรับเงิน ด้านล่างคือวิธีรับเงินเดิมของใบ ระหว่างนี้ยังบันทึกจ่ายไม่ได้'));
    assert.ok(a.includes('ธนาคารกสิกรไทย เลขบัญชีลงท้าย 5678'));
    const b = claimPage(phaseB(), auditor).texts;
    assert.ok(b.includes('ด้านล่างคือวิธีรับเงินใหม่ที่ผู้เบิกส่งมา รอผู้อนุมัติอนุมัติก่อนจึงจ่ายได้'));
    assert.ok(b.includes('ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 1112') && b.includes('ยังไม่มีผู้ตรวจบัญชีนี้'));
    // Never "โอนเข้าบัญชีนี้" in a round: nobody is offered the payment.
    for (const texts of [a, b]) assert.equal(texts.includes('โอนเข้าบัญชีนี้'), false);
  });

  // Plan 3.13: a claim sent before claims carried an account gets one through the same path.
  it('a claim sent before claims carried an account: says it is to be given one, then shows the account it was given', () => {
    const legacy = { payoutMethod: undefined, payout: undefined, payoutHistory: undefined };
    const a = claimPage(phaseA({ ...legacy, payoutCorrection: { phase: 'AWAITING_REQUESTER', ...round, previous: undefined } }), auditor).texts;
    assert.ok(a.includes('ใบนี้ถูกส่งกลับให้ระบุบัญชีรับเงิน ระหว่างนี้ยังบันทึกจ่ายไม่ได้'));
    assert.ok(a.includes('ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน จึงไม่มีบัญชีที่ผ่านการอนุมัติในใบ'));
    const given = phaseB({ payoutHistory: [{ ...version2, version: 1 }], payout: { ...SCB, version: 1, source: 'REQUESTER' },
      payoutCorrection: { phase: 'AWAITING_APPROVAL', ...round, previous: undefined, submittedAt: AT.given } });
    const b = stepCard(claimPage(given, auditor).html);
    assert.ok(visible(b.html).includes('ไม่มี ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน'));
    assert.ok(visible(b.html).includes('ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 1112 · ชื่อบัญชี นาย สมชาย ใจดี'));
  });

  it('tells a requester whose default account changed how to take it onto the claim, where the server lets them', () => {
    const changed = (overrides: Record<string, unknown>) => ({ payout: { ...KBANK, source: 'DEFAULT_ACCOUNT', defaultAccountChanged: true as const }, ...overrides });
    const hint = (detail: object) => claimPage(detail, requester).texts.find((text) => text.startsWith('บัญชีรับเงินคืนประจำของคุณเปลี่ยนแล้ว'))!;
    assert.match(hint(ready(changed({ payoutCorrectionActions: SEND }))), /ถ้าต้องการให้ใบนี้ใช้บัญชีใหม่ กดส่งกลับให้แก้บัญชีรับเงินในขั้นจ่ายเงินคืน ก่อนมีการโอน$/u);
    assert.match(hint(phaseA(changed({ payoutCorrectionActions: GIVE }))), /ถ้าต้องการให้ใบนี้ใช้บัญชีใหม่ กดแก้บัญชีรับเงินในขั้นอนุมัติ แล้วเลือกใช้บัญชีประจำ$/u);
    // No flag from the server: the hint says what it said before.
    assert.match(hint(ready(changed({}))), /แจ้งผู้อนุมัติหรือผู้จ่ายเงินก่อนมีการโอน$/u);
  });
});

describe('the claim\'s journey tells a correction round (spec §17.2)', () => {
  const rows = (detail: object) => logic.buildClaimTimeline(detail).map((row) => `${row.state}:${row.label}`);
  const FIRST = 'done:อนุมัติและตรวจบัญชีรับเงินโดย สมศรี ผู้จัดการ';
  const SENT = 'done:ส่งกลับให้แก้บัญชีรับเงินโดย วราภรณ์ การเงิน : เลขบัญชีไม่ถูกต้อง · ธนาคารแจ้งว่าไม่พบบัญชีนี้';

  it('keeps the first approval as history, then the send-back, the account given and the new approval, in the spec\'s words', () => {
    assert.deepEqual(rows(ready()), ['done:ยื่นใบ', FIRST, 'current:กำลังรอ วราภรณ์ การเงิน บันทึกจ่าย']);
    assert.deepEqual(rows(phaseA()), ['done:ยื่นใบ', FIRST, SENT, 'current:กำลังรอผู้เบิกแก้บัญชีรับเงิน', 'future:รอบันทึกจ่าย']);
    assert.deepEqual(rows(phaseB()), ['done:ยื่นใบ', FIRST, SENT, 'done:ผู้เบิกแก้บัญชีรับเงิน',
      'current:กำลังรอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงินใหม่', 'future:รอบันทึกจ่าย']);
    // The approval of the new account is told once, as the round's own row, never a second time as an approval of the claim.
    assert.deepEqual(rows(reapproved()), ['done:ยื่นใบ', FIRST, SENT, 'done:ผู้เบิกแก้บัญชีรับเงิน',
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

  it('ends with the payment into the new account once it is paid', () => {
    const paid = reapproved({ status: 'PAID', paymentStatus: 'PAID', outstandingAmount: '0.0000', currentDesk: undefined, paymentDesk: undefined,
      payments: [{ id: 'p1', status: 'RECORDED', paymentMethod: 'BANK_TRANSFER', paidAt: '2026-10-01T07:00:00.000Z', paidByName: NAMES.payer, slipCount: 1,
        payoutDestination: { version: 2, payoutKind: 'BANK_ACCOUNT', bankName: SCB.bankName, accountName: SCB.accountName, accountLast4: '1112' } }] });
    assert.equal(rows(paid).at(-1), 'done:จ่ายแล้ว โดย วราภรณ์ การเงิน · โอนเข้าบัญชีลงท้าย 1112 · มีสลิป');
    assert.equal(rows(paid).length, 6);
  });

  it('names whoever gave the account on the requester\'s behalf, and prints no code for a reason it has no words for', () => {
    const onBehalf = phaseB({ payoutCorrectionHistory: [SENT_BACK, { ...GIVEN, byUserId: 'accountant', byName: 'สุภาวดี นักบัญชี' }] });
    assert.equal(rows(onBehalf)[3], 'done:สุภาวดี นักบัญชี แก้บัญชีรับเงินแทนผู้เบิก');
    const later = phaseA({ payoutCorrectionHistory: [{ kind: 'SENT_BACK', at: AT.sentBack, byUserId: 'gone', reasonCode: 'A_REASON_ADDED_LATER' }, { kind: 'A_KIND_ADDED_LATER', at: AT.given, byUserId: 'x' }] });
    assert.deepEqual(rows(later), ['done:ยื่นใบ', FIRST, 'done:ส่งกลับให้แก้บัญชีรับเงิน', 'current:กำลังรอผู้เบิกแก้บัญชีรับเงิน', 'future:รอบันทึกจ่าย']);
    for (const detail of [phaseA(), phaseB(), reapproved(), onBehalf, later]) assertPlainThai(logic.buildClaimTimeline(detail).map((row) => row.label), 'the journey');
  });

  it('tells a new account sent back again, and a second round after the first, as they happened', () => {
    const again = { kind: 'SENT_BACK', at: '2026-10-01T05:30:00.000Z', byUserId: 'boss', byName: NAMES.approver, reasonCode: 'ACCOUNT_NAME_MISMATCH' };
    // The round's own step was refused: it is set aside, and the claim is with its requester once more.
    const sentBackAgain = phaseA({ approvalSteps: [setAside, { ...step2, status: 'CANCELLED', invalidatedAt: again.at, invalidatedReason: 'payout_account_correction' }],
      payoutCorrectionHistory: [SENT_BACK, GIVEN, again] });
    assert.deepEqual(rows(sentBackAgain), ['done:ยื่นใบ', FIRST, SENT, 'done:ผู้เบิกแก้บัญชีรับเงิน',
      'done:ส่งกลับให้แก้บัญชีรับเงินโดย สมศรี ผู้จัดการ : ชื่อบัญชีไม่ตรงกับผู้เบิก', 'current:กำลังรอผู้เบิกแก้บัญชีรับเงิน', 'future:รอบันทึกจ่าย']);
    // A second round on a claim already corrected once: its first new approval is history told by the first round's row.
    const second = { kind: 'SENT_BACK', at: '2026-10-01T08:00:00.000Z', byUserId: 'staff', byName: NAMES.requester, reasonCode: 'REQUESTER_ASKED' };
    const secondRound = phaseA({ payout: { ...SCB, source: 'REQUESTER' },
      approvalSteps: [setAside, { ...step2, status: 'APPROVED', decisionByUserId: 'boss', decidedByName: NAMES.approver, decidedAt: AT.reapproved, invalidatedAt: second.at, invalidatedReason: 'payout_account_correction' }],
      payoutCorrectionHistory: [SENT_BACK, GIVEN, REAPPROVED, second] });
    assert.deepEqual(rows(secondRound), ['done:ยื่นใบ', FIRST, SENT, 'done:ผู้เบิกแก้บัญชีรับเงิน', 'done:อนุมัติบัญชีรับเงินใหม่โดย สมศรี ผู้จัดการ',
      'done:ส่งกลับให้แก้บัญชีรับเงินโดย สมชาย พนักงาน : ผู้เบิกขอเปลี่ยนบัญชี', 'current:กำลังรอผู้เบิกแก้บัญชีรับเงิน', 'future:รอบันทึกจ่าย']);
  });

  // Plan 3.11 and 3.12 in the journey.
  it('keeps the finance review before the round for a claim that passed it, and has no new approval for a claim nobody approves', () => {
    const reviewed = { financeReviewRequired: true, financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByName: NAMES.payer, financeReviewedAt: '2026-10-01T03:30:00.000Z' };
    assert.deepEqual(rows(phaseB(reviewed)), ['done:ยื่นใบ', FIRST, 'done:ฝ่ายการเงินตรวจแล้ว โดย วราภรณ์ การเงิน', SENT, 'done:ผู้เบิกแก้บัญชีรับเงิน',
      'current:กำลังรอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงินใหม่', 'future:รอบันทึกจ่าย']);
    const noApproval = ready({ approvalSteps: [], approvedAt: AT.given, payout: { ...SCB, source: 'REQUESTER' }, payoutHistory: [version2], payoutCorrectionHistory: [SENT_BACK, GIVEN] });
    assert.deepEqual(rows(noApproval), ['done:ยื่นใบ', SENT, 'done:ผู้เบิกแก้บัญชีรับเงิน', 'current:กำลังรอ วราภรณ์ การเงิน บันทึกจ่าย']);
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
      ['done:ยื่นใบ', FIRST, SENT, 'done:ผู้เบิกแก้บัญชีรับเงิน', 'done:อนุมัติบัญชีรับเงินใหม่โดย สมศรี ผู้จัดการ', PAID, VOID, 'current:กำลังรอ วราภรณ์ การเงิน บันทึกจ่าย']);
  });

  it('keeps the round on a claim cancelled, or being cancelled, in it', () => {
    // Cancelling sets the step that waited aside, as it does for any claim.
    const cancelled = phaseB({ status: 'CANCELLED', currentDesk: undefined, payoutCorrectionPhase: undefined, payoutCorrection: undefined,
      approvalSteps: [setAside, { ...step2, status: 'CANCELLED', invalidatedAt: '2026-10-01T05:30:00.000Z', invalidatedReason: 'reimbursement_cancelled' }] });
    assert.deepEqual(rows(cancelled), ['done:ยื่นใบ', FIRST, SENT, 'done:ผู้เบิกแก้บัญชีรับเงิน', 'done:ยกเลิกคำขอ']);
    const cancelling = phaseA({ currentDesk: { kind: 'SYSTEM' }, pendingCancellation: { startedAt: AT.given, startedByName: NAMES.requester, reason: 'ซื้อซ้ำกับใบก่อน', canResume: false, canWithdraw: false } });
    assert.deepEqual(rows(cancelling), ['done:ยื่นใบ', FIRST, SENT, 'done:เริ่มยกเลิกคำขอ โดย สมชาย พนักงาน', 'current:กำลังรอระบบปรับสถานะ']);
  });

  it('reads as before for a claim that was never in a round, an approval set aside for another reason included', () => {
    const resubmitted = ready({ approvalSteps: [{ ...step1, id: 'old', invalidatedAt: AT.approved, invalidatedReason: 'superseded_by_atomic_resubmit' }, step1] });
    assert.deepEqual(rows(resubmitted), ['done:ยื่นใบ', FIRST, 'current:กำลังรอ วราภรณ์ การเงิน บันทึกจ่าย']);
    // An action's answer carries the round and not its history: the journey still says whom the claim waits for.
    assert.deepEqual(rows(phaseB({ payoutCorrectionHistory: undefined })), ['done:ยื่นใบ', FIRST, 'current:กำลังรอ สมศรี ผู้จัดการ อนุมัติบัญชีรับเงินใหม่', 'future:รอบันทึกจ่าย']);
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
  const WAITS = 'ใบนี้อยู่ระหว่างแก้บัญชีรับเงิน ยังลงนามหรือยืนยันสำเนาที่ลงนามครบไม่ได้ ทำได้อีกครั้งหลังบัญชีใหม่ได้รับอนุมัติ';

  it('offers no ลงนาม to anyone while a round is open, says why, and offers it again once the new account is approved', () => {
    for (const at of [phaseA, phaseB]) {
      for (const viewer of [requester, approver, payer]) {
        const { texts } = detailSections(at(), viewer);
        assert.deepEqual(signButton(texts), []);
        assert.ok(texts.includes(WAITS));
        assert.equal(texts.filter((text) => text === 'ยังไม่ลงนาม').length, 2, 'both blocks are empty: the signatures went with the send-back');
      }
    }
    // Before the round and after it: the requester, and the approver the claim now stands on.
    for (const detail of [ready(), reapproved()]) {
      assert.deepEqual(signButton(detailSections(detail, requester).texts), ['ลงนาม']);
      assert.deepEqual(signButton(detailSections(detail, approver).texts), ['ลงนาม']);
      assert.equal(detailSections(detail, requester).texts.includes(WAITS), false);
    }
    assert.deepEqual(signButton(detailSections(reapproved(), payer).texts), []);
  });

  it('labels a scan declared before the round "สำเนาก่อนแก้บัญชีรับเงิน", keeps it openable, and does not count it as signed', () => {
    const before = { ...COPY, beforePayoutCorrection: true as const };
    const newer = { attachmentId: 'copy-2', fileName: 'ใบเบิกเซ็นใหม่.pdf', uploadedAt: '2026-10-01T06:30:00.000Z', acknowledgedAt: '2026-10-01T06:30:00.000Z', acknowledgedByName: NAMES.requester };
    const { html, texts } = detailSections(reapproved({ signedCopies: [before] }), requester);
    assert.ok(texts.includes('สำเนาก่อนแก้บัญชีรับเงิน · ไม่นับว่าลงนามแล้ว · แนบเมื่อ 1 ต.ค. 2569'), texts.filter((text) => text.includes('สำเนา')).join(' | '));
    assert.match(html, /<button[^>]*>📄 ใบเบิกเซ็นแล้ว\.pdf<\/button>/);
    assert.equal(texts.includes('ลงนามบนกระดาษ'), false, 'no block reads as signed on paper');
    assert.equal(texts.some((text) => text.startsWith('ลงนามบนกระดาษ · แนบเมื่อ')), false);
    // A scan declared after the round is the one that counts; the older one keeps its label beside it.
    const both = detailSections(reapproved({ documentSignedVia: 'PAPER', signedCopies: [newer, before] }), requester).texts;
    assert.ok(both.includes('ลงนามบนกระดาษ · แนบเมื่อ 1 ต.ค. 2569 โดย สมชาย พนักงาน') && both.includes('สำเนาก่อนแก้บัญชีรับเงิน · ไม่นับว่าลงนามแล้ว · แนบเมื่อ 1 ต.ค. 2569'));
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
