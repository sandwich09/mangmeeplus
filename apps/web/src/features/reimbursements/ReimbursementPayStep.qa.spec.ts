import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { REIMBURSEMENT_PAYMENT_METHOD_LABELS, reimbursementPaidNotice, reimbursementPaymentHowText, reimbursementPaymentRule } from '@watchdog-bms/contracts';
import { ToastContext } from '@/common/components/toast/use-toast';
import { translateApiError } from '@/common/api/api-error-message';
import { REASON_MAX_LENGTH } from '@/common/forms/sanitize';

/*
 * The payment step of a claim that carries a receiving account (payout spec §12.1 to §12.4, §15, §17.2;
 * Phase 1 part B). What this guards:
 *  - the payer is shown where to transfer: the claim's own account, or, on a claim sent before claims
 *    carried one, the requester's current default under its own label;
 *  - the form asks for exactly what the API asks for, by the one shared rule, and sends exactly what
 *    the payer was shown and said (invariant I3);
 *  - a tick is given for one account and is no tick for another;
 *  - a payment says the same facts on its row and in the claim's history (invariant I4), last 4 digits only;
 *  - plain Thai and a 390 px phone.
 */
(globalThis as typeof globalThis & { React: typeof React }).React = React;
// The screens reach the icon set through ExpensesUi; this runner has no SVG loader.
require.extensions['.svg'] = (module) => { module.exports = () => null; };
// Modal portals into document.body, which a server render has none of: render the dialog in place.
Reflect.set(require('react-dom'), 'createPortal', (node: React.ReactNode) => node);
const sections = require('./ReimbursementDetailSections') as typeof import('./ReimbursementDetailSections');
const payoutUi = require('./ReimbursementPayout') as typeof import('./ReimbursementPayout');
const payout = require('./reimbursement-payout.logic') as typeof import('./reimbursement-payout.logic');
const logic = require('./reimbursements.logic') as typeof import('./reimbursements.logic');
const { ReimbursementJourneyPage } = require('./ReimbursementJourneyPage') as typeof import('./ReimbursementJourneyPage');
const { PAYMENT_METHOD_LABELS } = require('./reimbursements.model') as typeof import('./reimbursements.model');
const reactRuntime = require('react') as typeof React;

const h = React.createElement;
const noop = () => undefined;
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, bfcacheId: 'test' };
const toast = { success: noop, warning: noop, error: noop };
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

/** What the customer reads: text nodes plus aria labels, placeholders and tooltips; never other attributes such as links. */
const visible = (html: string) => [...[...html.matchAll(/(?:aria-label|placeholder|title)="([^"]*)"/gu)].map((match) => match[1]!),
  ...html.replace(/<[^>]*>/gu, '\n').split('\n')]
  .map((text) => text.replace(/&quot;/gu, '"').replace(/&#x27;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&').trim()).filter(Boolean);

/** Renders with some useState starting values swapped in, picked by the component's own initial value. */
function renderWithState(element: React.ReactElement, pick: (initial: any) => unknown): string {
  const realUseState = reactRuntime.useState;
  Reflect.set(reactRuntime, 'useState', (initial: unknown) => {
    const [value, set] = (realUseState as (initial: unknown) => [unknown, unknown])(initial);
    const picked = pick(typeof initial === 'function' ? (initial as () => unknown)() : initial);
    return [picked === undefined ? value : picked, set];
  });
  try {
    return renderToStaticMarkup(h(AppRouterContext.Provider, { value: router as never }, h(ToastContext.Provider, { value: toast as never }, element)));
  } finally { Reflect.set(reactRuntime, 'useState', realUseState); }
}

// Ids shaped like the real ones (cuid), so a leak into visible text cannot hide.
const ids = {
  company: 'cmg7x2k9p0000companyq1w2e3', request: 'cmg7x2k9p0001requestq8w3e5', requester: 'cmg7x2k9p0002userr4t6y8a1', approver: 'cmg7x2k9p0003useru1i3o5p7',
  payer: 'cmg7x2k9p0004userp5a7s9d1', reader: 'cmg7x2k9p0005userd9f1g3h5', payment: 'cmg7x2k9p0007paymentk9l1z3', slip: 'cmg7x2k9p0010slipn1m3q5w7e9',
  step: 'cmg7x2k9p0009stepx3c5v7b9', branch: 'cmg7x2k9p0013branchu7i9o1',
};
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const DOCUMENT_NUMBERS = ['RB-202610-00007', 'RBPAY-202610-00001', 'RBPAY-202610-00002'];
const PAYER = ['reimbursement.read', 'reimbursement.payment.record', 'reimbursement.payment.void'];
const METHODS = Object.keys(PAYMENT_METHOD_LABELS);

const KBANK = { payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789' };
const KBANK_LINE = 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789';
const base = {
  id: ids.request, requestNo: 'RB-202610-00007', status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', financeReviewStatus: 'NOT_REQUIRED',
  receiptRequirementStatus: 'ATTACHED', duplicateStatus: 'NO_MATCH', requesterUserId: ids.requester, requesterDisplayNameSnapshot: 'สมชาย ใจดี',
  branchId: ids.branch, reason: 'ไปพบลูกค้า', amount: '1614.5000', outstandingAmount: '1614.5000', currency: 'THB', categoryLabelSnapshot: 'เดินทาง',
  submittedAt: '2026-10-01T02:00:00.000Z', approvedAt: '2026-10-01T03:00:00.000Z', claimFormLayout: 'TWO_SIGNERS', documentSignedVia: null as string | null,
  currentDesk: { kind: 'PAYMENT' }, paymentDesk: { names: ['สมศรี'], moreCount: 0 },
  lines: [] as unknown[], signatures: [] as unknown[], signedCopies: [] as any[], duplicateCandidates: [] as unknown[],
  approvalSteps: [{ id: ids.step, sequenceNo: 1, status: 'APPROVED', decisionByUserId: ids.approver, decidedByName: 'สมหญิง', approverName: 'สมหญิง',
    assignedAt: '2026-10-01T02:00:00.000Z', decidedAt: '2026-10-01T03:00:00.000Z' }],
  payments: [] as any[],
};
const checked = { verifiedByUserId: ids.approver, verifiedByName: 'สมหญิง', verifiedAt: '2026-10-01T03:00:00.000Z' };
const transferClaim = { ...base, payoutMethod: 'BANK_TRANSFER', payout: { payoutMethod: 'BANK_TRANSFER' as const, ...KBANK, version: 2, source: 'DEFAULT_ACCOUNT' as const, ...checked, canRevealAccountNumber: true } };
const promptPayClaim = { ...base, payoutMethod: 'BANK_TRANSFER', payout: { payoutMethod: 'BANK_TRANSFER' as const, payoutKind: 'PROMPTPAY_PHONE' as const,
  accountName: 'นาย สมชาย ใจดี', accountLast4: '5678', version: 1, source: 'REQUESTER' as const, canRevealAccountNumber: true } };
const cashClaim = { ...base, payoutMethod: 'CASH', payout: { payoutMethod: 'CASH' as const } };
/** Sent before claims carried a receiving method: no payout block at all. */
const legacyClaim = base;
/** The same, as the API answers a viewer who may pay it and whose requester has a default account now. */
const legacyWithDefault = { ...base, legacyPayoutDefault: { ...KBANK, confirmToken: TOKEN } };
const CLAIMS: Array<[string, any]> = [
  ['transfer claim', transferClaim], ['PromptPay claim', promptPayClaim], ['cash claim', cashClaim],
  ['legacy claim, the requester has a default account', legacyWithDefault], ['legacy claim, no default account', legacyClaim],
];

/**
 * The payment form with some of its state swapped in. Its own useState calls come first and in a fixed
 * order (fields, the payer's statement, slip, error, busy), so the first two `null` initial values are
 * the slip and the error. A method not given is the one the form itself starts from.
 */
function paymentForm(request: object, state: { method?: string; payer?: { confirmedFor?: string; mismatchReason?: string }; slip?: object; error?: string } = {}): string {
  let nulls = 0;
  return renderWithState(h(sections.PaymentForm, { companyId: ids.company, request, onCancel: noop, onDone: noop, onOpenFile: noop }), (start) => {
    if (start && typeof start === 'object' && 'paymentMethod' in start) return { ...start, ...(state.method !== undefined && { paymentMethod: state.method }) };
    if (start && typeof start === 'object' && 'confirmedFor' in start) return { ...start, ...state.payer };
    if (start === null) {
      nulls += 1;
      if (nulls === 1 && state.slip) return state.slip;
      if (nulls === 2 && state.error) return state.error;
    }
    return undefined;
  });
}

/** The payout card. `revealed`: the number the card holds after "แสดงเลขบัญชี" (the card's first null state). */
function card(detail: any, options: { userId?: string; payStep?: boolean; revealed?: { revealKey: string; accountNumber: string } } = {}): string {
  let nulls = 0;
  return renderWithState(h(payoutUi.ClaimPayoutCard, {
    companyId: ids.company, detail, userId: options.userId ?? ids.payer, payoutAccountHref: `/companies/${ids.company}/reimbursements/payout-account`,
    ...(options.payStep !== undefined && { payStep: options.payStep }),
  }), (start) => (start === null && ++nulls === 1 && options.revealed ? options.revealed : undefined));
}

/**
 * The claim's own page with `detail` loaded (the page's second null state, after the confirm dialog's)
 * and, when asked, with the payment form open (the page's first `false` state after the claim).
 */
function claimPage(detail: object, options: { userId?: string; permissions?: string[]; payOpen?: boolean } = {}): string {
  let nulls = 0;
  let falses = 0;
  return renderWithState(h(ReimbursementJourneyPage, {
    companyId: ids.company, requestId: ids.request, userId: options.userId ?? ids.payer, permissions: options.permissions ?? PAYER,
  }), (start) => {
    if (start === null && ++nulls === 2) return detail;
    if (start === false && nulls >= 2 && ++falses === 1 && options.payOpen) return true;
    return undefined;
  });
}

const detailSections = (detail: object, userId: string, permissions: string[]) => renderToStaticMarkup(
  h(sections.ClaimDetailSections, { detail, userId, permissions, busy: false, onOpenAttachment: noop, onLineReceipt: noop, onSign: noop,
    onUploadSignedCopy: noop, onRequestVoidPayment: noop, onOpenPaymentSlip: noop, onAttachPaymentSlip: noop, onUseSignedCopyAsSlip: noop }));

/** The visible texts of one payment row, by its payment number. */
function paymentRow(html: string, paymentNo: string): string[] {
  const row = html.split('data-testid="reimbursement-payment-row"').slice(1).find((part) => part.includes(paymentNo));
  assert.ok(row, `no payment row for ${paymentNo}`);
  return visible(`<li ${row.split('</li>')[0]!}`);
}

const hasConfirmation = (html: string) => html.includes('data-testid="reimbursement-payment-confirmation"');
const hasReason = (html: string) => html.includes('data-testid="reimbursement-payment-mismatch"');
const CONFIRMATION = 'โอนเข้าบัญชีนี้แล้ว และชื่อผู้รับที่ธนาคารแสดงตรงกับใบเบิก';

describe('pay step: what the payer is shown (spec §12.1, §15)', () => {
  it('a transfer claim: the box "โอนเข้าบัญชีนี้" with the two names side by side, the masked account, the reveal button and who checked it', () => {
    assert.deepEqual(visible(card(transferClaim, { payStep: true })), [
      'โอนเข้าบัญชีนี้', 'โอนเข้าบัญชี', 'ผู้เบิก', 'สมชาย ใจดี', 'ชื่อบัญชี', 'นาย สมชาย ใจดี', KBANK_LINE, 'แสดงเลขบัญชี',
      'ใช้บัญชีประจำของผู้เบิก', 'ตรวจบัญชีแล้วโดย สมหญิง เมื่อ 1 ต.ค. 2569 10:00 น.',
    ]);
    // The three things the line under the account can say.
    const lineOf = (overrides: object) => visible(card({ ...transferClaim, payout: { ...transferClaim.payout, verifiedByUserId: undefined, verifiedByName: undefined, verifiedAt: undefined, ...overrides } }, { payStep: true })).at(-1);
    assert.equal(lineOf({}), 'ยังไม่มีผู้ตรวจบัญชีนี้');
    assert.equal(lineOf({ verifiedByUserId: ids.requester, verifiedByName: 'สมชาย ใจดี', verifiedAt: '2026-10-01T03:00:00.000Z' }), 'ผู้เบิกยืนยันบัญชีของตนเอง เมื่อ 1 ต.ค. 2569 10:00 น.');
    assert.equal(lineOf(checked), 'ตรวจบัญชีแล้วโดย สมหญิง เมื่อ 1 ต.ค. 2569 10:00 น.');
    // Anyone else reading the same claim sees the same account under the card's usual name.
    assert.equal(visible(card(transferClaim, { userId: ids.reader }))[0], 'การรับเงินคืน');
    assert.deepEqual(visible(card(transferClaim, { userId: ids.reader })).slice(1), visible(card(transferClaim, { payStep: true })).slice(1));
  });

  it('shows the number, and only then the copy button', () => {
    const before = visible(card(transferClaim, { payStep: true }));
    assert.ok(before.includes('แสดงเลขบัญชี'));
    assert.ok(!before.includes('คัดลอกเลขบัญชี') && !before.includes('เลขบัญชีเต็ม'));
    const after = visible(card(transferClaim, { payStep: true, revealed: { revealKey: `${ids.request}:2`, accountNumber: '0045556789' } }));
    for (const text of ['เลขบัญชีเต็ม', '0045556789', 'คัดลอกเลขบัญชี', 'ซ่อนเลขบัญชี']) assert.ok(after.includes(text), text);
    assert.ok(!after.includes('แสดงเลขบัญชี'));
    // Only the digits are copied: what goes to the clipboard is the number itself.
    assert.match(read('./ReimbursementPayout.tsx'), /await navigator\.clipboard\.writeText\(shown \?\? ''\);/);
  });

  it('a PromptPay claim: the phone number masked the same way, with no bank, and a button that shows a phone number', () => {
    assert.deepEqual(visible(card(promptPayClaim, { payStep: true })), [
      'โอนเข้าบัญชีนี้', 'โอนเข้าบัญชี', 'ผู้เบิก', 'สมชาย ใจดี', 'ชื่อบัญชี', 'นาย สมชาย ใจดี', 'พร้อมเพย์เบอร์ลงท้าย 5678', 'แสดงเบอร์พร้อมเพย์',
      'ผู้เบิกระบุบัญชีนี้สำหรับใบนี้', 'ยังไม่มีผู้ตรวจบัญชีนี้',
    ]);
  });

  // A PromptPay destination is a phone number: the entry form calls it "เบอร์พร้อมเพย์". Before, the buttons on it read
  // "แสดงเลขบัญชี", "คัดลอกเลขบัญชี" and "ซ่อนเลขบัญชี", over the label "เลขบัญชีเต็ม".
  it('calls a PromptPay number "เบอร์พร้อมเพย์" where it is shown, copied and hidden, on every card that shows one', () => {
    const number = { accountNumber: '0812345678' };
    const before = visible(card(promptPayClaim, { payStep: true }));
    const after = visible(card(promptPayClaim, { payStep: true, revealed: { revealKey: `${ids.request}:1`, ...number } }));
    for (const text of ['เบอร์พร้อมเพย์เต็ม', '0812345678', 'คัดลอกเบอร์พร้อมเพย์', 'ซ่อนเบอร์พร้อมเพย์']) assert.ok(after.includes(text), text);
    assert.ok(before.includes('แสดงเบอร์พร้อมเพย์') && !after.includes('แสดงเบอร์พร้อมเพย์'));
    for (const texts of [before, after]) assert.deepEqual(texts.filter((text) => text.includes('เลขบัญชี')), []);
    // A legacy claim's payer is shown the requester's default account: a PromptPay default reads the same way.
    const legacy = { ...base, legacyPayoutDefault: { payoutKind: 'PROMPTPAY_PHONE' as const, accountName: 'นาย สมชาย ใจดี', accountLast4: '5678', confirmToken: TOKEN } };
    assert.ok(visible(card(legacy, { payStep: true })).includes('แสดงเบอร์พร้อมเพย์'));
    const shown = visible(card(legacy, { payStep: true, revealed: { revealKey: `${ids.request}:default:${TOKEN}`, ...number } }));
    assert.ok(shown.includes('คัดลอกเบอร์พร้อมเพย์') && shown.includes('ซ่อนเบอร์พร้อมเพย์') && !shown.some((text) => text.includes('เลขบัญชี')), shown.join(' | '));
    // The member's own standing account, on "บัญชีรับเงินคืนของฉัน": the card's second null state is the account (after the
    // confirm dialog's), and its second false state says the account was read.
    const mine = (payoutKind: 'PROMPTPAY_PHONE' | 'BANK_ACCOUNT') => {
      let nulls = 0;
      let falses = 0;
      return visible(renderWithState(h(payoutUi.MemberPayoutAccountCard, { companyId: ids.company, canEdit: true }), (start) => {
        if (start === null) return ++nulls === 2 ? { userId: ids.requester, payoutMethod: 'BANK_TRANSFER', payoutKind, accountName: 'นาย สมชาย ใจดี', accountLast4: '5678', updatedAt: '2026-10-01T03:00:00.000Z' } : undefined;
        return start === false && ++falses === 2 ? true : undefined;
      }));
    };
    assert.deepEqual([mine('PROMPTPAY_PHONE').includes('แสดงเบอร์พร้อมเพย์'), mine('PROMPTPAY_PHONE').includes('แสดงเลขบัญชี')], [true, false]);
    // A bank account keeps its words, on each of the three.
    assert.deepEqual([mine('BANK_ACCOUNT').includes('แสดงเลขบัญชี'), visible(card(transferClaim, { payStep: true })).includes('แสดงเลขบัญชี'),
      visible(card(legacyWithDefault, { payStep: true })).includes('แสดงเลขบัญชี')], [true, true, true]);
  });

  it('a cash claim: the requester asked for cash, and there is no account and nothing to show', () => {
    const html = card(cashClaim, { payStep: true });
    assert.deepEqual(visible(html), ['การรับเงินคืน', 'รับเป็นเงินสด', 'ผู้เบิกขอรับเป็นเงินสด ไม่ต้องมีบัญชี']);
    assert.doesNotMatch(html, /<button/);
  });

  it('a legacy claim whose requester has a default account: that account under its own label, with show and copy', () => {
    const html = card(legacyWithDefault, { payStep: true });
    assert.deepEqual(visible(html), [
      'การรับเงินคืน', 'ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน จึงไม่มีบัญชีที่ผ่านการอนุมัติในใบ',
      'บัญชีประจำปัจจุบันของผู้เบิก (ยังไม่ผ่านการอนุมัติในใบนี้)', 'ผู้เบิก', 'สมชาย ใจดี', 'ชื่อบัญชี', 'นาย สมชาย ใจดี', KBANK_LINE, 'แสดงเลขบัญชี',
    ]);
    // Never an instruction: only an account the claim itself froze is "โอนเข้าบัญชีนี้".
    assert.ok(!visible(html).includes('โอนเข้าบัญชีนี้'));
    // The number is kept under the default it was revealed for: another default, another key.
    const shown = (token: string) => visible(card({ ...legacyWithDefault, legacyPayoutDefault: { ...KBANK, confirmToken: token } },
      { payStep: true, revealed: { revealKey: `${ids.request}:default:${TOKEN}`, accountNumber: '0045556789' } }));
    assert.ok(shown(TOKEN).includes('0045556789') && shown(TOKEN).includes('คัดลอกเลขบัญชี'));
    assert.ok(!shown('f'.repeat(32)).includes('0045556789'));
    // It is the claim's own reveal call, which the server answers and records for this payer.
    assert.match(read('./ReimbursementPayout.tsx'), /revealKey=\{`\$\{detail\.id\}:default:\$\{legacyDefault\.confirmToken\}`\} canReveal\s+last4=\{legacyDefault\.accountLast4\} onReveal=\{reveal\}/);
  });

  it('a legacy claim whose requester has none: ask the requester', () => {
    const html = card(legacyClaim, { payStep: true });
    assert.deepEqual(visible(html), ['การรับเงินคืน', 'ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน จึงไม่มีบัญชีที่ผ่านการอนุมัติในใบ', 'สอบถามบัญชีจากผู้เบิกโดยตรง']);
    assert.doesNotMatch(html, /<button/);
    // That line is for whoever pays. Every other reader gets the one sentence, as before.
    assert.deepEqual(visible(card(legacyClaim, { userId: ids.reader })), ['การรับเงินคืน', 'ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน จึงไม่มีบัญชีที่ผ่านการอนุมัติในใบ']);
  });

  it('a viewer who may not see the number: the same masked account and no button, whatever the page thinks of them', () => {
    for (const canRevealAccountNumber of [false, undefined]) {
      for (const payStep of [false, true]) {
        const html = card({ ...transferClaim, payout: { ...transferClaim.payout, canRevealAccountNumber } }, { userId: ids.reader, payStep });
        assert.doesNotMatch(html, /แสดงเลขบัญชี|<button/, `${canRevealAccountNumber} ${payStep}`);
        assert.ok(visible(html).includes(KBANK_LINE));
      }
    }
    // A legacy claim's default is in the answer only for a viewer the server lets pay it: without it, nothing of it is shown.
    assert.doesNotMatch(card(legacyClaim, { userId: ids.reader }), /แสดงเลขบัญชี|<button|6789/);
    // Nothing on any of these cards is a full number: the markup carries the last 4 digits only.
    for (const [name, detail] of CLAIMS) {
      const html = card(detail, { payStep: true });
      assert.equal(html.replace(new RegExp([...Object.values(ids), TOKEN].join('|'), 'g'), '').match(/\d{5,}/g), null, name);
    }
  });

  it('is the claim page at its payment step, for whoever is offered to record the payment, and the hub dialog', () => {
    const page = read('./ReimbursementJourneyPage.tsx');
    assert.match(page, /payStep=\{step\?\.key === 'payment' && step\.actions\.includes\('pay'\)\}/);
    const payerPage = visible(claimPage(transferClaim));
    assert.ok(payerPage.includes('RB-202610-00007'), 'the claim rendered');
    for (const text of ['โอนเข้าบัญชีนี้', KBANK_LINE, 'แสดงเลขบัญชี', 'บันทึกจ่าย']) assert.ok(payerPage.includes(text), text);
    // A reader with no pay right, and a payer on a claim that is not waiting for its payment.
    const readerPage = visible(claimPage(transferClaim, { userId: ids.reader, permissions: ['reimbursement.read'] }));
    assert.ok(readerPage.includes('การรับเงินคืน') && !readerPage.includes('โอนเข้าบัญชีนี้') && !readerPage.includes('บันทึกจ่าย'));
    const paidPage = visible(claimPage({ ...transferClaim, status: 'PAID', paymentStatus: 'PAID', outstandingAmount: '0.0000', currentDesk: null }));
    assert.ok(paidPage.includes('การรับเงินคืน') && !paidPage.includes('โอนเข้าบัญชีนี้'));
    // A claim with no branch is one the payment endpoint refuses: no button, so no box that says to transfer.
    const noBranch = visible(claimPage({ ...transferClaim, branchId: null }));
    assert.ok(!noBranch.includes('บันทึกจ่าย') && !noBranch.includes('โอนเข้าบัญชีนี้'));
    assert.ok(noBranch.includes('ใบนี้ไม่ได้ระบุสาขา ระบบจึงยังบันทึกจ่ายไม่ได้ กรุณาติดต่อผู้ดูแลระบบ'));
    // The hub's quick-pay dialog shows the same box above the same form (reimbursements.payment-slip.spec.ts pins the wiring).
    assert.match(read('./ReimbursementsPages.tsx'), /<ClaimPayoutCard companyId=\{companyId\} detail=\{claim\} userId=\{userId\} payoutAccountHref=\{`\$\{claimPath\}\/payout-account`\} payStep \/>/);
  });

  it('opens the form inside the payment step card of the claim page, with the box on the same page', () => {
    const html = claimPage(transferClaim, { payOpen: true });
    const texts = visible(html);
    for (const text of ['โอนเข้าบัญชีนี้', 'วิธีจ่าย *', `${CONFIRMATION} *`, 'บันทึกจ่าย']) assert.ok(texts.includes(text), text);
    // Not a dialog: the form is in the page's own flow.
    assert.doesNotMatch(html, /role="dialog"/);
    // The phone route (`?pay=1`) arrives at this same state.
    assert.match(read('./ReimbursementJourneyPage.tsx'), /\{payOpen && step\.actions\.includes\('pay'\) && \(/);
  });
});

describe('pay step: the form asks exactly what the API asks (spec §12.4, invariant I3)', () => {
  // Spec §12.4, written out: [the payer's confirmation, the slip, the reason] for each claim and method.
  const TABLE: Record<string, Record<string, [confirmation: 'required' | 'offered' | 'none', slip: boolean, reason: boolean]>> = {
    'transfer claim': { BANK_TRANSFER: ['required', true, false], CASH: ['none', false, true], CHEQUE: ['none', false, true], OTHER: ['none', false, true] },
    'PromptPay claim': { BANK_TRANSFER: ['required', true, false], CASH: ['none', false, true], CHEQUE: ['none', false, true], OTHER: ['none', false, true] },
    'cash claim': { BANK_TRANSFER: ['none', true, true], CASH: ['none', false, false], CHEQUE: ['none', false, true], OTHER: ['none', false, true] },
    'legacy claim, the requester has a default account': { BANK_TRANSFER: ['offered', true, false], CASH: ['none', false, false], CHEQUE: ['none', false, false], OTHER: ['none', false, false] },
    'legacy claim, no default account': { BANK_TRANSFER: ['none', true, false], CASH: ['none', false, false], CHEQUE: ['none', false, false], OTHER: ['none', false, false] },
  };

  it('shows the confirmation, the reason and the slip mark exactly when the table of spec §12.4 says so', () => {
    assert.deepEqual(METHODS, ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']);
    for (const [name, claim] of CLAIMS) {
      for (const method of METHODS) {
        const [confirmation, slip, reason] = TABLE[name]![method]!;
        const html = paymentForm(claim, { method });
        const texts = visible(html);
        assert.equal(hasConfirmation(html), confirmation !== 'none', `${name}, ${method}: confirmation`);
        if (confirmation !== 'none') {
          assert.ok(texts.includes(confirmation === 'required' ? `${CONFIRMATION} *` : CONFIRMATION), `${name}, ${method}: the tick is marked required only when it is`);
          assert.match(html, new RegExp(`<input type="checkbox"[^>]*aria-required="${confirmation === 'required'}"`), `${name}, ${method}`);
        }
        assert.equal(hasReason(html), reason, `${name}, ${method}: reason`);
        assert.equal(texts.includes('สลิปหรือหลักฐานการจ่าย *'), slip, `${name}, ${method}: slip`);
      }
    }
  });

  it('takes every one of those answers from the one rule the API applies under the payment lock', () => {
    for (const [name, claim] of CLAIMS) {
      const requested = payout.requestedPayout(claim);
      for (const method of METHODS) {
        const rule = reimbursementPaymentRule(requested, method);
        const form = payout.paymentFormPayout(claim, method);
        assert.deepEqual(form.rule, rule, `${name}, ${method}`);
        const [confirmation, slip, reason] = TABLE[name]![method]!;
        // "offered" is the rule's optional confirmation with a default account to give it for.
        assert.equal(rule.payoutConfirmation, confirmation === 'required' ? 'required' : name.startsWith('legacy') && method === 'BANK_TRANSFER' ? 'optional' : 'none', `${name}, ${method}`);
        assert.deepEqual([rule.slipRequired, rule.mismatchReasonRequired], [slip, reason], `${name}, ${method}`);
        assert.equal(Boolean(form.confirmation), confirmation !== 'none', `${name}, ${method}`);
        assert.equal(form.confirmation?.required, confirmation === 'none' ? undefined : confirmation === 'required', `${name}, ${method}`);
      }
    }
    // What the claim asked for, as the rule takes it. A legacy claim asked for nothing.
    assert.deepEqual(payout.requestedPayout(transferClaim), { payoutMethod: 'BANK_TRANSFER', hasAccount: true });
    assert.deepEqual(payout.requestedPayout(cashClaim), { payoutMethod: 'CASH', hasAccount: false });
    for (const legacy of [legacyClaim, legacyWithDefault, { payout: null }, null, undefined]) assert.equal(payout.requestedPayout(legacy), null);
    const form = read('./ReimbursementDetailSections.tsx');
    assert.match(form, /const payout = paymentFormPayout\(request, form\.paymentMethod\);\s+const slipRequired = payout\.rule\.slipRequired;/);
    assert.match(form, /\{payout\.rule\.mismatchReasonRequired && \(/);
    assert.match(form, /\{payout\.confirmation && \(\s+<PayerConfirmationCheck confirmation=\{payout\.confirmation\} checked=\{payer\.confirmedFor === payout\.confirmation\.key\}/);
  });

  /** One press of "บันทึกจ่าย" with everything else filled in; what was sent, or what the form said. */
  async function press(claim: any, method: string, payer: { confirmedFor?: string; mismatchReason?: string } = {}) {
    const sent: Record<string, unknown>[] = [];
    const uploads: string[] = [];
    const transfer = method === 'BANK_TRANSFER';
    const result = await logic.savePaymentForm({
      form: { paidAmount: '1614.5', paymentMethod: method, paidAt: '2026-10-01', paymentReference: method === 'CASH' || method === 'OTHER' ? '' : 'TXN-9' },
      outstandingAmount: claim.outstandingAmount, slip: transfer ? { file: { name: 'slip.jpg' } as File } : null,
      session: { idempotencyKey: null, saving: false }, payout: payout.paymentFormPayout(claim, method),
      payer: { confirmedFor: '', mismatchReason: '', ...payer },
    }, {
      uploadSlip: async (file) => { uploads.push(file.name); return ids.slip; },
      recordPayment: async (body) => { sent.push(body); return {}; },
      onSlipUploaded: noop, newIdempotencyKey: () => 'key-1',
    });
    const [body] = sent;
    return {
      result, uploads,
      /** The four fields of the payer's statement, as sent; `null` when nothing was sent at all. */
      statement: body ? Object.fromEntries(['payoutDestinationVersion', 'payoutConfirmed', 'payoutDefaultToken', 'methodMismatchReason']
        .filter((key) => key in body).map((key) => [key, body[key]])) : null,
    };
  }

  it('sends the account version the page shows with every payment, the tick only for the account it was given for, and the reason only when asked', async () => {
    // A transfer into the claim's own account.
    assert.deepEqual((await press(transferClaim, 'BANK_TRANSFER', { confirmedFor: 'version:2' })).statement, { payoutDestinationVersion: 2, payoutConfirmed: true });
    assert.deepEqual((await press(promptPayClaim, 'BANK_TRANSFER', { confirmedFor: 'version:1' })).statement, { payoutDestinationVersion: 1, payoutConfirmed: true });
    // Another method than the one asked for: the version still goes (a page from before an account change is then refused), with the reason, trimmed.
    for (const method of ['CASH', 'CHEQUE', 'OTHER']) {
      assert.deepEqual((await press(transferClaim, method, { mismatchReason: '  ผู้เบิกมารับเงินสดเอง ' })).statement,
        { payoutDestinationVersion: 2, methodMismatchReason: 'ผู้เบิกมารับเงินสดเอง' }, method);
    }
    // A tick given for the account, then the method changed: the tick is not sent as a statement about a cash payment.
    assert.deepEqual((await press(transferClaim, 'CASH', { confirmedFor: 'version:2', mismatchReason: 'ผู้เบิกมารับเงินสดเอง' })).statement,
      { payoutDestinationVersion: 2, methodMismatchReason: 'ผู้เบิกมารับเงินสดเอง' });
    // A cash claim has no account: nothing about one is sent, whatever was typed before the method was changed back.
    assert.deepEqual((await press(cashClaim, 'CASH', { mismatchReason: 'พิมพ์ไว้ก่อนเปลี่ยนวิธีจ่ายกลับ' })).statement, {});
    assert.deepEqual((await press(cashClaim, 'BANK_TRANSFER', { mismatchReason: 'ผู้เบิกขอให้โอนแทน' })).statement, { methodMismatchReason: 'ผู้เบิกขอให้โอนแทน' });
    // A legacy claim: the tick names the default the page showed; without it the payment is recorded as before the feature.
    assert.deepEqual((await press(legacyWithDefault, 'BANK_TRANSFER', { confirmedFor: `default:${TOKEN}` })).statement, { payoutConfirmed: true, payoutDefaultToken: TOKEN });
    assert.deepEqual((await press(legacyWithDefault, 'BANK_TRANSFER')).statement, {});
    assert.deepEqual((await press(legacyClaim, 'BANK_TRANSFER', { confirmedFor: `default:${TOKEN}`, mismatchReason: 'ไม่ได้ถูกถาม' })).statement, {});
    for (const method of ['CASH', 'CHEQUE', 'OTHER']) assert.deepEqual((await press(legacyWithDefault, method, { confirmedFor: `default:${TOKEN}` })).statement, {}, method);
  });

  it('sends nothing, and uploads nothing, while what the API would refuse is missing: the tick, then the reason', async () => {
    const refusedAs = async (claim: any, method: string, payer: object, text: string) => {
      const { result, statement, uploads } = await press(claim, method, payer);
      assert.deepEqual(result, { status: 'refused', text }, `${method}: ${text}`);
      assert.equal(statement, null);
      assert.deepEqual(uploads, [], 'the slip is not uploaded for a payment that cannot be recorded');
    };
    const TICK = 'ติ๊กยืนยันว่าโอนเข้าบัญชีนี้แล้ว และชื่อผู้รับที่ธนาคารแสดงตรงกับใบเบิก ก่อนกดบันทึกจ่าย';
    await refusedAs(transferClaim, 'BANK_TRANSFER', {}, TICK);
    // A tick is for one account: given for an earlier version, or for a default account, it is none for this one.
    await refusedAs(transferClaim, 'BANK_TRANSFER', { confirmedFor: 'version:1' }, TICK);
    await refusedAs(transferClaim, 'BANK_TRANSFER', { confirmedFor: `default:${TOKEN}` }, TICK);
    for (const method of ['CASH', 'CHEQUE', 'OTHER']) {
      await refusedAs(transferClaim, method, {}, 'วิธีจ่ายต่างจากที่ผู้เบิกขอ กรุณาระบุเหตุผล');
      await refusedAs(transferClaim, method, { mismatchReason: '   ' }, 'วิธีจ่ายต่างจากที่ผู้เบิกขอ กรุณาระบุเหตุผล');
    }
    await refusedAs(cashClaim, 'BANK_TRANSFER', {}, 'วิธีจ่ายต่างจากที่ผู้เบิกขอ กรุณาระบุเหตุผล');
    // The reason is shown on the payment row to every reader of the claim: the API's own guard, before anything is sent.
    for (const mismatchReason of ['โอนเข้า 0045671234 แทน', 'บัญชี 004-5-67123-4 ปิดแล้ว', 'พร้อมเพย์ 081 234 5678']) {
      await refusedAs(transferClaim, 'CASH', { mismatchReason }, 'อย่าพิมพ์เลขบัญชีในช่องเหตุผล เพราะเหตุผลนี้แสดงในประวัติการจ่ายให้ทุกคนที่เปิดใบเบิกเห็น');
    }
    assert.deepEqual((await press(transferClaim, 'CASH', { mismatchReason: 'จ่ายเงินสดตามใบ RB-202610-00007 ยอด 1,614.50 บาท' })).result, { status: 'saved' });
    // The earlier questions keep their order: the method, the amount, the reference and the slip come first.
    assert.equal(logic.validatePaymentForm({ paidAmount: '1614.5', outstandingAmount: '1614.5', paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-9', hasSlip: false,
      payout: { rule: reimbursementPaymentRule({ payoutMethod: 'BANK_TRANSFER', hasAccount: true }, 'BANK_TRANSFER'), confirmed: false, mismatchReason: '' } }), 'จ่ายด้วยการโอนต้องแนบสลิป');
    // A form that is given no payout side asks nothing of it (the slip rule alone, as before).
    assert.equal(logic.validatePaymentForm({ paidAmount: '1', outstandingAmount: '1', paymentMethod: 'CASH' }), null);
  });
});

describe('pay step: the confirmation names one account, and says when the payer is the one checking it', () => {
  const ACCOUNT = `${KBANK_LINE} · ชื่อบัญชี นาย สมชาย ใจดี`;
  const VERIFIER_NOTE = 'ยังไม่มีผู้ตรวจบัญชีนี้ คุณเป็นผู้ตรวจ';

  it('names the account in words under the tick, with the version it is given for', () => {
    assert.deepEqual(payout.paymentFormPayout(transferClaim, 'BANK_TRANSFER').confirmation, { key: 'version:2', required: true, accountLine: ACCOUNT });
    assert.deepEqual(payout.paymentFormPayout(promptPayClaim, 'BANK_TRANSFER').confirmation,
      { key: 'version:1', required: true, accountLine: 'พร้อมเพย์เบอร์ลงท้าย 5678 · ชื่อบัญชี นาย สมชาย ใจดี', note: VERIFIER_NOTE });
    assert.equal(payout.paymentFormPayout(transferClaim, 'BANK_TRANSFER').version, 2);
    assert.equal(payout.paymentFormPayout(cashClaim, 'CASH').version, undefined);
    const texts = visible(paymentForm(transferClaim));
    assert.ok(texts.includes(`${CONFIRMATION} *`) && texts.includes(ACCOUNT));
    assert.ok(!texts.includes(VERIFIER_NOTE), 'an approver other than the requester checked it');
  });

  // Spec §10.2: no approval step, or the requester approved their own claim. The payer is then the check.
  it('tells the payer they are the one checking, when nobody but the requester has', () => {
    const unchecked = { ...transferClaim, payout: { ...transferClaim.payout, verifiedByUserId: undefined, verifiedByName: undefined, verifiedAt: undefined } };
    const selfChecked = { ...transferClaim, payout: { ...transferClaim.payout, verifiedByUserId: ids.requester, verifiedByName: 'สมชาย ใจดี' } };
    for (const claim of [unchecked, selfChecked]) {
      assert.equal(payout.paymentFormPayout(claim, 'BANK_TRANSFER').confirmation?.note, VERIFIER_NOTE);
      assert.ok(visible(paymentForm(claim)).includes(VERIFIER_NOTE));
    }
    assert.equal(payout.paymentFormPayout(transferClaim, 'BANK_TRANSFER').confirmation?.note, undefined);
  });

  it('offers the tick on a legacy claim for the default shown, and says what leaving it off records', () => {
    const offered = payout.paymentFormPayout(legacyWithDefault, 'BANK_TRANSFER').confirmation!;
    assert.deepEqual({ ...offered, note: undefined }, { key: `default:${TOKEN}`, required: false, accountLine: ACCOUNT, defaultToken: TOKEN, note: undefined });
    assert.equal(offered.note, 'บัญชีนี้ยังไม่ผ่านการอนุมัติในใบนี้ ติ๊กเมื่อโอนเข้าบัญชีนี้ ถ้าโอนเข้าบัญชีอื่นที่สอบถามจากผู้เบิก ไม่ต้องติ๊ก ระบบจะบันทึกว่าไม่มีบัญชีรับเงินในใบเบิก');
    assert.equal(payout.paymentFormPayout(legacyClaim, 'BANK_TRANSFER').confirmation, undefined);
    // A claim that carries its own account never takes a default's token, whatever else the answer carried.
    assert.equal(payout.paymentFormPayout({ ...transferClaim, legacyPayoutDefault: { ...KBANK, confirmToken: TOKEN } }, 'BANK_TRANSFER').confirmation?.defaultToken, undefined);
  });

  it('starts unticked, and is ticked only for the account it was given for', () => {
    const box = (html: string) => /<input type="checkbox"[^>]*>/.exec(html)![0];
    assert.doesNotMatch(box(paymentForm(transferClaim)), /checked/);
    assert.match(box(paymentForm(transferClaim, { payer: { confirmedFor: 'version:2' } })), /checked=""/);
    // The claim on the page is now another account version, or the legacy default changed: the old tick is gone.
    assert.doesNotMatch(box(paymentForm({ ...transferClaim, payout: { ...transferClaim.payout, version: 3 } }, { payer: { confirmedFor: 'version:2' } })), /checked/);
    assert.match(box(paymentForm(legacyWithDefault, { method: 'BANK_TRANSFER', payer: { confirmedFor: `default:${TOKEN}` } })), /checked=""/);
    assert.doesNotMatch(box(paymentForm({ ...legacyWithDefault, legacyPayoutDefault: { ...KBANK, confirmToken: 'f'.repeat(32) } },
      { method: 'BANK_TRANSFER', payer: { confirmedFor: `default:${TOKEN}` } })), /checked/);
    assert.match(read('./ReimbursementDetailSections.tsx'), /onChange=\{\(checked\) => setPayer\(p => \(\{ \.\.\.p, confirmedFor: checked \? payout\.confirmation!\.key : '' \}\)\)\}/);
  });

  it('asks why, in the requester\'s own words for what they asked, when the method is another one', () => {
    const cashForTransfer = visible(paymentForm(transferClaim, { method: 'CASH' }));
    assert.ok(cashForTransfer.includes('เหตุผลที่จ่ายต่างจากที่ผู้เบิกขอ *'));
    assert.ok(cashForTransfer.includes('ผู้เบิกขอโอนเข้าบัญชี ประวัติการจ่ายจะแสดงว่าจ่ายต่างจากที่ผู้เบิกขอ พร้อมเหตุผลนี้ อย่าพิมพ์เลขบัญชีในช่องนี้'));
    assert.ok(visible(paymentForm(cashClaim, { method: 'CHEQUE' })).includes('ผู้เบิกขอรับเป็นเงินสด ประวัติการจ่ายจะแสดงว่าจ่ายต่างจากที่ผู้เบิกขอ พร้อมเหตุผลนี้ อย่าพิมพ์เลขบัญชีในช่องนี้'));
    const typed = paymentForm(transferClaim, { method: 'CASH', payer: { mismatchReason: 'ผู้เบิกมารับเงินสดเอง' } });
    assert.match(typed, /<textarea id="reimbursement-payment-mismatch-reason"[^>]*aria-required="true"[^>]*maxLength="500"[^>]*>ผู้เบิกมารับเงินสดเอง<\/textarea>/i);
  });

  it('keeps everything typed, ticked and uploaded when saving fails, and says the payment is not recorded', () => {
    const message = 'ยังบันทึกจ่ายไม่สำเร็จ เพราะมีการทำรายการกับใบนี้ในเวลาเดียวกัน กดบันทึกจ่ายอีกครั้ง ไม่ต้องแนบสลิปหรือโอนเงินใหม่';
    const html = paymentForm(transferClaim, { payer: { confirmedFor: 'version:2' }, slip: { attachmentId: ids.slip, name: 'สลิป-กสิกร.jpg' }, error: message });
    const texts = visible(html);
    for (const text of ['โอนเงิน', 'สลิป-กสิกร.jpg', `⚠ ${message}`, 'บันทึกจ่าย']) assert.ok(texts.includes(text), text);
    assert.match(/<input type="checkbox"[^>]*>/.exec(html)![0], /checked=""/);
    // The failed save changes nothing but the banner: no field is reset by it.
    const form = read('./ReimbursementDetailSections.tsx');
    assert.match(form, /if \(result\.status === 'refused'\) setError\(result\.text\);/);
    const submit = form.slice(form.indexOf('const submit = async (e: React.FormEvent) => {'), form.indexOf('return (', form.indexOf('const submit = async (e: React.FormEvent) => {')));
    assert.doesNotMatch(submit, /setForm\(|setPayer\(|setSlip\(null\)/);
  });
});

describe('a payment reads the same on its row and in the claim history (spec §17.2, invariant I4)', () => {
  const confirmedAt = '2026-10-01T04:30:00.000Z';
  const transfer = { id: ids.payment, paymentNo: 'RBPAY-202610-00001', paidAmount: '1614.5000', currency: 'THB', paymentMethod: 'BANK_TRANSFER',
    paidAt: '2026-10-01T04:00:00.000Z', paymentReference: 'TXN-1002', status: 'RECORDED', paidByUserId: ids.payer, paidByName: 'สมศรี',
    slipCount: 1, slips: [{ attachmentId: ids.slip, attachedAt: confirmedAt }], viewerCanOpenSlips: true,
    payoutDestination: { version: 2, ...KBANK }, payoutConfirmedAt: confirmedAt };
  const paidWith = (payment: object) => ({ ...transferClaim, status: 'PAID', paymentStatus: 'PAID', outstandingAmount: '0.0000', currentDesk: null, payments: [payment] });
  const row = (payment: object, userId = ids.requester, permissions = ['reimbursement.read_own']) =>
    paymentRow(detailSections(paidWith(payment), userId, permissions), 'RBPAY-202610-00001');
  const history = (payment: object) => logic.buildClaimTimeline(paidWith(payment)).find((entry) => entry.key === 'payment')!.label;

  it('a transfer into the claim\'s account: method, the last 4 digits, when the payer confirmed, and the slip', () => {
    assert.equal(logic.paymentFactsText(transfer), 'โอนเข้าบัญชีลงท้าย 6789 · มีสลิป');
    assert.equal(history(transfer), 'จ่ายแล้ว โดย สมศรี · โอนเข้าบัญชีลงท้าย 6789 · มีสลิป');
    const texts = row(transfer);
    for (const text of ['RBPAY-202610-00001', '1,614.50 บาท', 'โอนเงิน · บันทึกแล้ว', 'วันที่จ่าย 1 ต.ค. 2569 · เลขอ้างอิง TXN-1002',
      `โอนเข้า ${KBANK_LINE} · ชื่อบัญชี นาย สมชาย ใจดี · ยืนยันเมื่อ 1 ต.ค. 2569 11:30 น.`, 'จ่ายโดย สมศรี', 'มีสลิปแนบ 1 ไฟล์']) {
      assert.ok(texts.includes(text), `${text} in ${JSON.stringify(texts)}`);
    }
    assert.ok(!texts.includes('จ่ายต่างจากที่ผู้เบิกขอ') && !texts.includes('ไม่มีบัญชีรับเงินในใบเบิก'));
    // PromptPay says so, with the same last 4 digits on both.
    const promptPay = { ...transfer, payoutDestination: { version: 1, payoutKind: 'PROMPTPAY_PHONE', accountName: 'นาย สมชาย ใจดี', accountLast4: '5678' } };
    assert.equal(history(promptPay), 'จ่ายแล้ว โดย สมศรี · โอนเข้าพร้อมเพย์เบอร์ลงท้าย 5678 · มีสลิป');
    assert.ok(row(promptPay).includes('โอนเข้า พร้อมเพย์เบอร์ลงท้าย 5678 · ชื่อบัญชี นาย สมชาย ใจดี · ยืนยันเมื่อ 1 ต.ค. 2569 11:30 น.'));
  });

  it('a payment by another method than the requester asked for: marked on both, with the reason on the row', () => {
    const cash = { ...transfer, paymentMethod: 'CASH', paymentReference: undefined, slipCount: 0, slips: [], payoutDestination: undefined, payoutConfirmedAt: undefined,
      methodMismatchReason: 'ผู้เบิกมารับเงินสดเอง' };
    assert.equal(history(cash), 'จ่ายแล้ว โดย สมศรี · เงินสด · จ่ายต่างจากที่ผู้เบิกขอ');
    const texts = row(cash);
    for (const text of ['เงินสด · บันทึกแล้ว', 'จ่ายต่างจากที่ผู้เบิกขอ', 'เหตุผล: ผู้เบิกมารับเงินสดเอง']) assert.ok(texts.includes(text), `${text} in ${JSON.stringify(texts)}`);
    assert.ok(!texts.some((text) => text.startsWith('โอนเข้า')) && !texts.includes('ไม่มีบัญชีรับเงินในใบเบิก'));
  });

  it('a transfer with no account confirmed says so on the row, and nothing about an account in the history', () => {
    // A legacy claim paid into an account the payer asked the requester for, or a payment from before the feature.
    const plain = { ...transfer, payoutDestination: undefined, payoutConfirmedAt: undefined };
    assert.equal(history(plain), 'จ่ายแล้ว โดย สมศรี · โอนเงิน · มีสลิป');
    const texts = row(plain);
    assert.ok(texts.includes('ไม่มีบัญชีรับเงินในใบเบิก'));
    assert.ok(!texts.some((text) => text.startsWith('โอนเข้า')));
    // A cash payment of a cash or a legacy claim reads exactly as it did before the feature.
    const cash = { ...plain, paymentMethod: 'CASH', paymentReference: undefined, slipCount: 0, slips: [] };
    assert.equal(history(cash), 'จ่ายแล้ว โดย สมศรี · เงินสด');
    assert.deepEqual(row(cash).filter((text) => /บัญชี|ต่างจาก|เหตุผล/.test(text)), []);
    // A method the API may add later is not printed as a code.
    assert.equal(logic.paymentFactsText({ paymentMethod: 'A_METHOD_ADDED_LATER' }), '');
    assert.equal(history({ ...cash, paymentMethod: 'A_METHOD_ADDED_LATER', paidByName: undefined }), 'จ่ายแล้ว');
  });

  it('shows every reader the same row, with the last 4 digits and never a full number', () => {
    // What a payer can do with the payment (open, add a slip, void) is theirs; what the payment says is everyone's.
    const controls = ['ดูสลิป', 'แนบสลิปเพิ่ม', 'ยังไม่ได้เลือกไฟล์', 'เลือกไฟล์', 'ยกเลิกการจ่าย'];
    const facts = (userId: string, permissions: readonly string[]) => row(transfer, userId, [...permissions]).filter((text) => !controls.includes(text));
    const forRequester = facts(ids.requester, ['reimbursement.read_own']);
    assert.equal(forRequester.length, 7);
    for (const [userId, permissions] of [[ids.payer, PAYER], [ids.approver, ['reimbursement.read_related', 'reimbursement.approve']], [ids.reader, ['reimbursement.read']]] as const) {
      assert.deepEqual(facts(userId, permissions), forRequester, userId);
    }
    const html = detailSections(paidWith(transfer), ids.payer, PAYER);
    assert.equal(html.replace(new RegExp([...Object.values(ids), ...DOCUMENT_NUMBERS].join('|'), 'g'), '').match(/\d{5,}/g), null);
    // One wording for the masked account: the row and the timeline build it from the shared functions. The
    // timeline's phrase is the one in contracts, which the API builds the requester's notice from.
    assert.doesNotMatch(read('./ReimbursementDetailSections.tsx'), /ลงท้าย/);
    assert.equal(read('./reimbursements.logic.ts').match(/ลงท้าย/g), null);
    assert.match(read('./reimbursements.logic.ts'), /reimbursementPaymentHowText\(\{ paymentMethod: payment\?\.paymentMethod, payoutDestination: payment\?\.payoutDestination \}\)/);
  });

  it('keeps a voided payment\'s account and reason on its own row', () => {
    const voided = { ...transfer, status: 'VOIDED', voidedAt: '2026-10-02T02:00:00.000Z', voidReason: 'บันทึกเลขอ้างอิงผิด', methodMismatchReason: undefined };
    const again = { ...transfer, id: 'cmg7x2k9p0008paymentb2n4m6', paymentNo: 'RBPAY-202610-00002', paymentReference: 'TXN-1003' };
    const html = detailSections(paidWith(voided) && { ...paidWith(voided), payments: [voided, again] }, ids.payer, PAYER);
    for (const paymentNo of ['RBPAY-202610-00001', 'RBPAY-202610-00002']) {
      assert.ok(paymentRow(html, paymentNo).includes(`โอนเข้า ${KBANK_LINE} · ชื่อบัญชี นาย สมชาย ใจดี · ยืนยันเมื่อ 1 ต.ค. 2569 11:30 น.`), paymentNo);
    }
    assert.ok(paymentRow(html, 'RBPAY-202610-00001').includes('เหตุผลที่ยกเลิก: บันทึกเลขอ้างอิงผิด'));
    // The history speaks of the payment that stands, after the one that was taken back.
    const timeline = logic.buildClaimTimeline({ ...paidWith(voided), payments: [voided, again] });
    assert.equal(timeline.find((entry) => entry.key === 'payment')!.label, 'จ่ายแล้ว โดย สมศรี · โอนเข้าบัญชีลงท้าย 6789 · มีสลิป');
    // Voided or not is one fact in one wording: the row's status and the history's row, with the same reason.
    assert.ok(paymentRow(html, 'RBPAY-202610-00001').includes('โอนเงิน · ยกเลิกการจ่ายแล้ว'));
    assert.ok(paymentRow(html, 'RBPAY-202610-00002').includes('โอนเงิน · บันทึกแล้ว'));
    assert.deepEqual(timeline.map((entry) => entry.label).filter((label) => label.includes('ยกเลิกการจ่าย')), ['ยกเลิกการจ่ายแล้ว: บันทึกเลขอ้างอิงผิด']);
    assert.equal(timeline.filter((entry) => entry.label.includes('ยกเลิกการจ่าย')).length, [voided, again].filter((payment) => payment.status === 'VOIDED').length);
    // The claim's own wording for a voided claim is another word, and no payment row borrows it.
    assert.doesNotMatch(html.split('data-testid="reimbursement-payment-row"').slice(1).join(''), /เพิกถอน/);
  });

  // The requester's notice is written on the server from the payment's own facts, by the function of contracts
  // that is called here on the very payment the page shows. So whatever the notice says, the row and the history say.
  it('reads the same in the requester\'s notice: the method actually used, the amount, the last 4 digits and the slip', () => {
    const cash = { ...transfer, paymentMethod: 'CASH', paymentReference: undefined, slipCount: 0, slips: [], payoutDestination: undefined, payoutConfirmedAt: undefined,
      methodMismatchReason: 'ผู้เบิกมารับเงินสดเอง' };
    const promptPay = { ...transfer, payoutDestination: { version: 1, payoutKind: 'PROMPTPAY_PHONE', accountName: 'นาย สมชาย ใจดี', accountLast4: '5678' } };
    const cases: Array<[any, string]> = [
      [transfer, 'โอนเข้าบัญชีลงท้าย 6789 จำนวน 1,614.50 บาท มีสลิปแนบ แตะเพื่อดูสลิป'],
      [promptPay, 'โอนเข้าพร้อมเพย์เบอร์ลงท้าย 5678 จำนวน 1,614.50 บาท มีสลิปแนบ แตะเพื่อดูสลิป'],
      // Paid in cash though the claim asked for a transfer: every surface says cash, none names the claim's account.
      [cash, 'จ่ายเป็นเงินสด 1,614.50 บาท'],
      [{ ...transfer, payoutDestination: undefined, payoutConfirmedAt: undefined }, 'โอนเงิน จำนวน 1,614.50 บาท มีสลิปแนบ แตะเพื่อดูสลิป'],
    ];
    for (const [payment, sentence] of cases) {
      const notice = reimbursementPaidNotice(payment);
      assert.equal(notice, sentence);
      const how = reimbursementPaymentHowText(payment);
      const texts = row(payment);
      // How it was paid: the history says the shared phrase, the notice is built on it, and the row names the same method.
      assert.ok(history(payment).split(' · ').includes(how), `${how} in ${history(payment)}`);
      assert.ok(notice.includes(how), `${how} in ${notice}`);
      assert.ok(texts.includes(`${REIMBURSEMENT_PAYMENT_METHOD_LABELS[payment.paymentMethod as 'CASH']} · บันทึกแล้ว`), sentence);
      // The amount, written the same way.
      assert.ok(texts.includes('1,614.50 บาท') && notice.includes('1,614.50 บาท'), sentence);
      // The last 4 digits: on all three, or on none of them.
      const last4 = payment.payoutDestination?.accountLast4;
      for (const [surface, text] of [['row', texts.join(' | ')], ['history', history(payment)], ['notice', notice]] as const) {
        assert.equal(/ลงท้าย \d{4}/.test(text), Boolean(last4), `${surface}: ${text}`);
        if (last4) assert.ok(text.includes(`ลงท้าย ${last4}`), `${surface}: ${text}`);
      }
      // A slip: said on all three, or on none.
      const hasSlip = payment.slipCount > 0;
      assert.deepEqual([texts.some((text) => text.startsWith('มีสลิปแนบ')), history(payment).includes('มีสลิป'), notice.includes('มีสลิปแนบ')], [hasSlip, hasSlip, hasSlip], sentence);
    }
    // The payer's reason is on the row for whoever may read the claim, and never in the notice.
    assert.ok(row(cash).includes('เหตุผล: ผู้เบิกมารับเงินสดเอง') && !reimbursementPaidNotice(cash as any).includes('ผู้เบิกมารับเงินสดเอง'));
    // One map of method words for the form, the row, the history and the notice.
    assert.equal(PAYMENT_METHOD_LABELS, REIMBURSEMENT_PAYMENT_METHOD_LABELS);
  });

  it('prints the day of a payment in Thai time, the same on its row and in the history', () => {
    // 18:30 on 1 October by UTC is 01:30 on 2 October in Thailand: the day the payer saw on their own screen.
    const late = { ...transfer, paidAt: '2026-10-01T18:30:00.000Z' };
    const html = detailSections(paidWith(late), ids.requester, ['reimbursement.read_own']);
    assert.ok(paymentRow(html, 'RBPAY-202610-00001').includes('วันที่จ่าย 2 ต.ค. 2569 · เลขอ้างอิง TXN-1002'));
    const journey = visible(`<ol ${html.split('data-testid="reimbursement-timeline"')[1]!.split('</ol>')[0]}`);
    const at = journey.indexOf('จ่ายแล้ว โดย สมศรี · โอนเข้าบัญชีลงท้าย 6789 · มีสลิป');
    assert.ok(at > 0, journey.join(' | '));
    assert.equal(journey[at + 1], '2 ต.ค. 2569');
    // A voided payment has two days of its own: when it was paid and when that was taken back.
    const voided = { ...late, status: 'VOIDED', voidedAt: '2026-10-02T17:30:00.000Z', voidReason: 'บันทึกเลขอ้างอิงผิด' };
    const afterVoid = visible(`<ol ${detailSections({ ...paidWith(voided), status: 'READY_FOR_PAYMENT' }, ids.requester, ['reimbursement.read_own']).split('data-testid="reimbursement-timeline"')[1]!.split('</ol>')[0]}`);
    assert.deepEqual(afterVoid.slice(afterVoid.indexOf('จ่ายแล้ว โดย สมศรี · โอนเข้าบัญชีลงท้าย 6789 · มีสลิป')).slice(0, 5),
      ['จ่ายแล้ว โดย สมศรี · โอนเข้าบัญชีลงท้าย 6789 · มีสลิป', '2 ต.ค. 2569', '✓', 'ยกเลิกการจ่ายแล้ว: บันทึกเลขอ้างอิงผิด', '3 ต.ค. 2569']);
  });
});

const MACHINE_TOKENS: Array<[string, RegExp]> = [ // ReimbursementPages.plain-thai.qa.spec.ts's set
  ['cuid/uuid/hash-like id', /\b[a-z0-9]{20,}\b|[0-9a-f]{8}-[0-9a-f]{4}-/iu], ['enum or code', /[A-Z_]{4,}/u],
  ['field path', /\w+\.\d+\.\w+|\b[a-zA-Z]\w*\.(?:\d|[a-z]\w*\b)/u], ['camelCase key', /\b[a-z]+[A-Z]\w*\b/u], ['snake_case code', /\b[a-z]+_[a-z_]+\b/u],
  ['ISO date', /\d{4}-\d{2}-\d{2}/u], ['3+ decimal amount', /\d\.\d{3,}/u], ['category key or currency code', /\b(?:travel|meals|supplies|accommodation|other|THB)\b/u],
  ['raw JSON', /[{}[\]"]/u],
];

describe('pay step: plain Thai on a 390 px phone (Owner rule 2026-09-27/29)', () => {
  const paid = { ...transferClaim, status: 'PAID', paymentStatus: 'PAID', outstandingAmount: '0.0000', currentDesk: null, payments: [
    { id: ids.payment, paymentNo: 'RBPAY-202610-00001', paidAmount: '1614.5000', currency: 'THB', paymentMethod: 'CASH', paidAt: '2026-10-01T04:00:00.000Z',
      status: 'VOIDED', voidReason: 'บันทึกวิธีจ่ายผิด', paidByName: 'สมศรี', methodMismatchReason: 'ผู้เบิกมารับเงินสดเอง' },
    { id: 'cmg7x2k9p0008paymentb2n4m6', paymentNo: 'RBPAY-202610-00002', paidAmount: '1614.5000', currency: 'THB', paymentMethod: 'BANK_TRANSFER',
      paidAt: '2026-10-01T05:00:00.000Z', paymentReference: 'TXN-1003', status: 'RECORDED', paidByName: 'สมศรี', slipCount: 1, slips: [], viewerCanOpenSlips: false,
      payoutDestination: { version: 2, ...KBANK }, payoutConfirmedAt: '2026-10-01T05:10:00.000Z' },
  ] };
  const screens: Array<[string, string]> = [
    ...CLAIMS.map(([name, claim]): [string, string] => [`box: ${name}`, card(claim, { payStep: true })]),
    ['box: number shown', card(transferClaim, { payStep: true, revealed: { revealKey: `${ids.request}:2`, accountNumber: '0045556789' } })],
    ...CLAIMS.flatMap(([name, claim]) => METHODS.map((method): [string, string] => [`form: ${name}, ${method}`, paymentForm(claim, { method })])),
    ['form: legacy claim as it opens', paymentForm(legacyWithDefault)],
    ['form: a method the API may add later', paymentForm(transferClaim, { method: 'A_METHOD_ADDED_LATER' })],
    ['form: a receiving method the API may add later', paymentForm({ ...base, payout: { payoutMethod: 'A_METHOD_ADDED_LATER' } }, { method: 'CASH' })],
    ['page: payer, form open', claimPage(transferClaim, { payOpen: true })],
    ['page: payer, legacy claim', claimPage(legacyWithDefault, { payOpen: true })],
    ['page: claim with no branch', claimPage({ ...transferClaim, branchId: null })],
    ['rows: paid after a void', detailSections(paid, ids.requester, ['reimbursement.read_own'])],
    ['page: paid', claimPage(paid, { userId: ids.requester, permissions: ['reimbursement.read_own'] })],
  ];
  const refused = (code: string, status: number) => Object.assign(new Error(code), { status });
  // Texts that never pass through a render here: what the form says when it stops a save, and the server's refusals.
  const messages = [
    payout.PAYER_CONFIRMATION_REQUIRED, payout.MISMATCH_REASON_REQUIRED, payout.MISMATCH_REASON_HAS_ACCOUNT_NUMBER, payout.PAYMENT_NO_CLAIM_ACCOUNT,
    payout.LEGACY_ASK_REQUESTER_NOTE, payout.LEGACY_DEFAULT_LABEL, payout.LEGACY_PAYOUT_NOTE, payout.PAYER_IS_VERIFIER_NOTE, payout.PAID_DIFFERENTLY_LABEL,
    ...['payout_confirmation_required', 'payment_method_mismatch_reason_required', 'payout_destination_changed', 'payment_slip_in_use_elsewhere', 'note_contains_account_number']
      .map((code) => translateApiError(code) ?? code),
    ...['reimbursement_payment_state_changed', 'payout_destination_changed', 'payout_confirmation_required', 'payment_method_mismatch_reason_required',
      'reimbursement_payment_already_recorded', 'reimbursement_payment_idempotency_conflict']
      .flatMap((code) => [true, false].map((slipKept) => logic.paymentSaveErrorMessage('record', refused(code, 409), slipKept))),
    logic.paymentSaveErrorMessage('record', refused('payment_slip_in_use_elsewhere', 422), true),
    logic.paymentSaveErrorMessage('record', refused('note_contains_account_number', 400), false),
    logic.paymentFactsText(paid.payments[0]), logic.paymentFactsText(paid.payments[1]),
  ];

  it('carries no machine token on any state of the box, the form, the rows or the messages', () => {
    let checked = 0;
    for (const [screen, html] of [...screens, ...messages.map((message): [string, string] => ['message', message])]) {
      for (const raw of visible(html)) {
        // Payment references are the payer's own text; document numbers print on the documents themselves.
        const shown = [...DOCUMENT_NUMBERS, 'TXN-1002', 'TXN-1003'].reduce((text, number) => text.replaceAll(number, ''), raw).replace(/\b(?:LINE|PDF|JPEG|HEIC|HEIF)\b/gu, '');
        for (const [name, pattern] of MACHINE_TOKENS) assert.doesNotMatch(shown, pattern, `${name} on ${screen}: ${raw}`);
        checked += 1;
      }
    }
    assert.ok(checked > 600, `only ${checked} texts checked`);
  });

  it('gives every new refusal its own sentence, which says what to do next', () => {
    const labels = ['payout_confirmation_required', 'payment_method_mismatch_reason_required', 'payment_slip_in_use_elsewhere'].map((code) => translateApiError(code));
    assert.deepEqual(labels, [
      'ต้องยืนยันว่าโอนเข้าบัญชีที่แสดงแล้ว ติ๊กช่องยืนยันก่อนกดบันทึกจ่าย ถ้าไม่เห็นช่องยืนยัน กรุณาโหลดหน้าใหม่',
      'วิธีจ่ายต่างจากที่ผู้เบิกขอ กรุณาระบุเหตุผลก่อนกดบันทึกจ่าย ถ้าไม่เห็นช่องเหตุผล กรุณาโหลดหน้าใหม่',
      'ไฟล์นี้ถูกใช้เป็นใบเสร็จหรือเอกสารของรายการอื่นด้วย จึงใช้เป็นสลิปไม่ได้ กรุณาแนบสลิปเป็นไฟล์ใหม่',
    ]);
    // Not the sentence for a file of the wrong type or size: this file is fine, it is in use elsewhere.
    assert.notEqual(translateApiError('payment_slip_in_use_elsewhere'), translateApiError('payment_slip_invalid'));
    assert.equal(new Set(labels).size, labels.length);
  });

  it('stacks on a phone: 44 px controls, long names wrap, nothing has a fixed width', () => {
    const longName = 'บริษัท ตัวอย่างชื่อบัญชีที่ยาวมากเป็นพิเศษเพื่อทดสอบการตัดบรรทัดบนหน้าจอโทรศัพท์ จำกัด (มหาชน) สาขาสำนักงานใหญ่';
    const long = { ...transferClaim, requesterDisplayNameSnapshot: longName, payout: { ...transferClaim.payout, accountName: longName, bankName: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร' } };
    const box = card(long, { payStep: true });
    assert.match(box, /class="[^"]*\[overflow-wrap:anywhere\][^"]*"/);
    assert.match(box, /<dl class="grid grid-cols-2 gap-3"><div class="min-w-0">[\s\S]*?break-words[\s\S]*?<div class="min-w-0">[\s\S]*?break-words/);
    for (const [control] of box.matchAll(/<button\b[^>]*>/g)) assert.match(control, /min-h-11 w-full sm:w-auto/, control);

    const form = paymentForm(long);
    const [label] = /<label class="[^"]*" data-testid="reimbursement-payment-confirmation">/.exec(form) ?? [];
    assert.ok(label, 'the confirmation is one label: the whole row is the touch target');
    for (const cls of ['min-h-11', 'items-start', '[overflow-wrap:anywhere]']) assert.ok(label.includes(cls), cls);
    assert.match(form, /<input type="checkbox" class="mt-0\.5 h-5 w-5 shrink-0"/);
    assert.match(form, /<span class="min-w-0">/);
    assert.ok(visible(form).includes(`ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร เลขบัญชีลงท้าย 6789 · ชื่อบัญชี ${longName}`));
    const reason = paymentForm(long, { method: 'CASH' });
    assert.match(reason, /<textarea id="reimbursement-payment-mismatch-reason" class="[^"]*min-h-20 resize-y[^"]*"/);
    // What this step adds to the form and the page: the box, the tick and the reason. (The fields
    // around them are the shared form controls, which have their own specs.)
    const added = (html: string) => [
      /<label class="[^"]*" data-testid="reimbursement-payment-confirmation">[\s\S]*?<\/label>/.exec(html)?.[0] ?? '',
      /<div data-testid="reimbursement-payment-mismatch">[\s\S]*?<\/textarea>[\s\S]*?<\/p><\/div>/.exec(html)?.[0] ?? '',
    ].join('');
    assert.ok(added(form).includes('reimbursement-payment-confirmation') && added(reason).includes('reimbursement-payment-mismatch-reason'));
    for (const [screen, html] of [...screens.map(([screen, html]): [string, string] => [screen, screen.startsWith('box:') ? html : added(html)]),
      ['long names: box', box], ['long names: form', added(form)], ['long names: reason', added(reason)]] as Array<[string, string]>) {
      assert.doesNotMatch(html, /\bw-\[\d+px\]|min-w-\[\d+px\]|whitespace-nowrap/, `${screen}: a fixed width or an unbreakable line`);
    }
    // The payment row's new lines wrap too: an account name is as long as the bank prints it.
    const rows = read('./ReimbursementDetailSections.tsx');
    assert.match(rows, /<div className="mt-1 break-words text-gray-500">\s+\{`โอนเข้า \$\{paymentDestinationText\(p\)\}/);
    assert.match(rows, /<div className="mt-1 break-words text-gray-600">\s+<MangmeeBadge tone="amber">\{PAID_DIFFERENTLY_LABEL\}<\/MangmeeBadge>/);
  });
});

// Spec §12.8: voiding a payment also undoes its match to a bank statement line, in the same transaction. The
// dialog said what happens to the journal and to the claim, and nothing of the bank match.
describe('the void dialog says everything a void undoes', () => {
  /** The dialog with a reason typed and the acknowledgement ticked or not, and what the page passes it after a refusal. */
  const dialog = (state: { reason?: string; acknowledged?: boolean; error?: string } = {}) => {
    Object.assign(globalThis, { document: { body: {} } }); // Modal's portal target; never touched by a server render
    try {
      return renderWithState(h(sections.VoidPaymentDialog, { payment: { id: ids.payment, paymentNo: 'RBPAY-202610-00001' }, error: state.error, onClose: noop, onConfirm: noop }),
        (initial) => (initial === '' ? state.reason : initial === false ? state.acknowledged : undefined));
    } finally { Reflect.deleteProperty(globalThis, 'document'); }
  };
  const confirm = (html: string) => /<button type="button" class="[^"]*"( disabled="")? aria-busy="false">ยืนยันยกเลิกการจ่าย<\/button>/.exec(html);

  it('names the journal, the claim going back to wait for payment, and the bank match', () => {
    const texts = visible(dialog());
    const warning = texts.find((text) => text.includes('ระบบจะกลับรายการจ่าย'));
    assert.ok(warning, texts.join(' | '));
    assert.ok(warning.endsWith('ระบบจะกลับรายการจ่ายและรายการบัญชีที่เกี่ยวข้อง ใบเบิกจะกลับไปสถานะรอจ่าย ถ้าการจ่ายนี้จับคู่กับรายการเดินบัญชีธนาคารไว้แล้ว ระบบจะยกเลิกการจับคู่นั้นให้ด้วย'), warning);
    // The words of the bank page's own control for the same act.
    assert.match(read('../banking/MatchingPanel.tsx'), /ยกเลิกการจับคู่/);
    for (const text of ['ยกเลิกการจ่าย RBPAY-202610-00001', 'เหตุผล *', 'ยืนยันว่าได้ตรวจสอบและจัดการรายการเงินจริงกับธนาคาร/ผู้รับเงินแล้ว', 'ยืนยันยกเลิกการจ่าย']) assert.ok(texts.includes(text), text);
  });

  it('is plain Thai, and still asks for a reason and the acknowledgement before it can be confirmed', () => {
    const html = dialog();
    for (const raw of visible(html)) {
      const shown = raw.replace('RBPAY-202610-00001', '');
      for (const [name, pattern] of MACHINE_TOKENS) assert.doesNotMatch(shown, pattern, `${name}: ${raw}`);
    }
    assert.match(html, /<button type="button" class="[^"]*" disabled="" aria-busy="false">ยืนยันยกเลิกการจ่าย<\/button>/);
    // A reason and the acknowledgement together turn it on; either alone does not.
    assert.equal(confirm(dialog({ reason: 'บันทึกเลขอ้างอิงผิด', acknowledged: true }))?.[1], undefined);
    assert.ok(confirm(dialog({ reason: 'บันทึกเลขอ้างอิงผิด' }))?.[1]);
    assert.ok(confirm(dialog({ acknowledged: true }))?.[1]);
  });

  // Final review: the API refuses a void reason that looks like an account number, and holds the body to 500 characters.
  it('says at the reason field, in the API\'s own sentence, that an account number is not typed there, and keeps the confirm off', () => {
    const sentence = translateApiError('note_contains_account_number')!;
    assert.equal(logic.NOTE_HAS_ACCOUNT_NUMBER, sentence, 'the sentence the page passes the dialog for that refusal');
    assert.equal(logic.errorText(Object.assign(new Error('note_contains_account_number'), { status: 400 })), sentence);
    const field = (html: string) => /<textarea id="reimbursement-void-reason"[^>]*>[\s\S]*?<\/textarea><div[^>]*>([\s\S]*?)<\/div><\/div>/.exec(html)?.[0] ?? '';

    const plain = dialog({ reason: 'โอนผิดบัญชี ลงท้าย 1234', acknowledged: true });
    assert.ok(visible(field(plain)).includes('ทุกคนที่เปิดใบนี้เห็นเหตุผลนี้ อย่าพิมพ์เลขบัญชี'), field(plain));
    assert.doesNotMatch(field(plain), /aria-invalid|role="alert"/);
    assert.equal(confirm(plain)?.[1], undefined, 'the last 4 digits are no account number');

    const typed = dialog({ reason: 'โอนเข้าบัญชี 111-2-33444-1112 ผิด', acknowledged: true });
    assert.match(field(typed), /<textarea id="reimbursement-void-reason"[^>]*aria-invalid="true"[^>]*aria-describedby="reimbursement-void-reason-note"/);
    assert.match(field(typed), new RegExp(`<span id="reimbursement-void-reason-note" role="alert"[^>]*>${sentence}</span>`));
    assert.ok(confirm(typed)?.[1], 'nothing is asked of the API with an account number in the reason');
    assert.equal(visible(typed).filter((text) => text.includes(sentence)).length, 1, 'said once, at the field');

    // The same refusal from the server, for a reason this build's rule let through: at the field, not in the banner above.
    const refused = dialog({ reason: 'ยกเลิกรายการโอนแล้ว', acknowledged: true, error: sentence });
    assert.match(field(refused), new RegExp(`role="alert"[^>]*>${sentence}</span>`));
    assert.equal(refused.includes(`⚠ ${sentence}`), false);
    assert.equal(confirm(refused)?.[1], undefined, 'the person changes the reason and presses again');
    // Any other refusal is about the payment, not the field: it stays in the banner.
    const other = dialog({ reason: 'ยกเลิกรายการโอนแล้ว', acknowledged: true, error: 'รายการจ่ายนี้ถูกยกเลิกไปแล้ว' });
    assert.ok(visible(other).includes('⚠ รายการจ่ายนี้ถูกยกเลิกไปแล้ว'));
    assert.doesNotMatch(field(other), /role="alert"/);
  });

  it('holds the void reason and the reject reason to the 500 characters the API takes, and counts them', () => {
    const html = dialog({ reason: 'ก'.repeat(120) });
    assert.match(html, /<textarea id="reimbursement-void-reason"[^>]*maxLength="500"/);
    assert.ok(visible(html).includes('120/500'));
    Object.assign(globalThis, { document: { body: {} } });
    try {
      const reject = renderWithState(h(sections.RejectDialog, { requestNo: 'RB-202610-00007', onClose: noop, onConfirm: noop }), (initial) => (initial === '' ? 'ข'.repeat(40) : undefined));
      assert.match(reject, /<textarea[^>]*maxLength="500"/);
      assert.ok(visible(reject).includes('40/500'));
    } finally { Reflect.deleteProperty(globalThis, 'document'); }
    // The bound the API validates the two bodies with.
    const dtos = read('../../../../api/src/modules/reimbursements/presentation/http/reimbursement.dtos.ts');
    assert.match(dtos, /class RejectReimbursementDto[^}]*@MaxLength\(500\) reason!: string;/);
    assert.match(dtos, /class VoidReimbursementPaymentDto[^}]*@MaxLength\(500\) reason!: string;/);
    assert.equal(REASON_MAX_LENGTH, 500);
  });
});
