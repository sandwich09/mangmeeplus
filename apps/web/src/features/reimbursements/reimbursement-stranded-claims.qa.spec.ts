import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { EXPENSE_VOID_REASON_MIN_LENGTH, REIMBURSEMENT_DESK_LABELS, REIMBURSEMENT_SYSTEM_WAIT_LABEL } from '@watchdog-bms/contracts';
import { ToastContext } from '@/common/components/toast/use-toast';

/*
 * Audit B3 and B4 (2026-10-01): the two ways a claim got stuck with a screen that showed nothing unusual.
 * The claim page is rendered here as each viewer sees it, with the claim already loaded (the same harness as
 * ReimbursementPages.plain-thai.qa.spec.ts).
 */
(globalThis as typeof globalThis & { React: typeof React }).React = React;
require.extensions['.svg'] = (module) => { module.exports = () => null; };
// Modal portals into document.body, which a server render has none of: render the dialog in place.
Reflect.set(require('react-dom'), 'createPortal', (node: React.ReactNode) => node);
const { ReimbursementJourneyPage } = require('./ReimbursementJourneyPage') as typeof import('./ReimbursementJourneyPage');
const { activeJourneyStep, buildClaimTimeline, buildJourneySteps, errorText } = require('./reimbursements.logic') as typeof import('./reimbursements.logic');
const { currentDeskText } = require('./reimbursements.model') as typeof import('./reimbursements.model');
const reactRuntime = require('react') as typeof React;

const h = React.createElement;
const noop = () => undefined;
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, bfcacheId: 'test' };
const toast = { success: noop, warning: noop, error: noop };

/** Renders with some useState starting values swapped in, picked by the page's own initial value. */
function renderWithState(element: React.ReactElement, pick: (initial: any) => unknown): string {
  const realUseState = reactRuntime.useState;
  Reflect.set(reactRuntime, 'useState', (initial: unknown) => {
    const [value, set] = (realUseState as (initial: unknown) => [unknown, unknown])(initial);
    const picked = pick(typeof initial === 'function' ? (initial as () => unknown)() : initial);
    return [picked === undefined ? value : picked, set];
  });
  Object.assign(globalThis, { document: { body: {} } }); // Modal's portal target; never touched by a server render
  try { return renderToStaticMarkup(element); } finally {
    Reflect.set(reactRuntime, 'useState', realUseState);
    Reflect.deleteProperty(globalThis, 'document');
  }
}

/** What the person reads: text nodes plus aria labels, placeholders and tooltips. */
const visible = (html: string) => [...[...html.matchAll(/(?:aria-label|placeholder|title)="([^"]*)"/gu)].map(match => match[1]!),
  ...html.replace(/<[^>]*>/gu, '\n').split('\n')]
  .map(text => text.replace(/&quot;/gu, '"').replace(/&#x27;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&').trim()).filter(Boolean);

const OWNER = ['reimbursement.read', 'reimbursement.create', 'reimbursement.submit', 'reimbursement.update_own_draft', 'reimbursement.cancel_own',
  'reimbursement.approve', 'reimbursement.reject', 'reimbursement.finance_review', 'reimbursement.payment.record', 'reimbursement.payment.void'];
const STAFF = ['reimbursement.read_own', 'reimbursement.create', 'reimbursement.submit', 'reimbursement.update_own_draft', 'reimbursement.cancel_own'];
const APPROVER = ['reimbursement.read_related', 'reimbursement.approve', 'reimbursement.reject', 'reimbursement.payment.record'];

/** Plain Thai (owner rule 2026-09-27/29): no id, code, key, ISO date or raw JSON in what a person reads. */
const MACHINE_TOKENS: Array<[string, RegExp]> = [
  ['id', /\b[a-z0-9]{20,}\b/iu], ['enum or code', /[A-Z_]{4,}/u], ['camelCase key', /\b[a-z]+[A-Z]\w*\b/u], ['snake_case code', /\b[a-z]+_[a-z_]+\b/u],
  ['ISO date', /\d{4}-\d{2}/u], ['raw JSON', /[{}[\]"]/u],
];
function assertPlainThai(texts: string[], where: string) {
  for (const text of texts) {
    const shown = text.replaceAll('RB-202610-00007', '');
    for (const [name, pattern] of MACHINE_TOKENS) assert.doesNotMatch(shown, pattern, `${name} on ${where}: ${text}`);
  }
}
/** The step card of a rendered claim page: its note and the labels of its buttons and links. */
function stepCard(html: string) {
  const card = html.slice(html.indexOf('aria-labelledby="journey-step-title"'));
  const section = card.slice(0, card.indexOf('</section>'));
  return {
    note: visible(section.slice(section.indexOf('</h2>'), section.includes('<div class="flex flex-col gap-2') ? section.indexOf('<div class="flex flex-col gap-2') : undefined))[0] ?? '',
    buttons: [...section.matchAll(/<(?:button|a)\b[^>]*>([^<]+)<\/(?:button|a)>/gu)].map((match) => match[1]!),
  };
}
const deskLine = (html: string) => visible(html).filter((text) => text.startsWith('อยู่ที่'));

const claim = (overrides: Record<string, unknown> = {}) => ({
  id: 'claim-1', requestNo: 'RB-202610-00007', status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', financeReviewStatus: 'NOT_REQUIRED', financeReviewRequired: false,
  receiptRequirementStatus: 'ATTACHED', duplicateStatus: 'NO_MATCH', requesterUserId: 'staff', requesterDisplayNameSnapshot: 'พิม ใจดี', branchId: 'branch-1',
  reason: 'ไปพบลูกค้า', amount: '500.0000', outstandingAmount: '500.0000', currency: 'THB', categoryLabelSnapshot: 'เดินทาง',
  submittedAt: '2026-10-01T03:00:00.000Z', approvedAt: '2026-10-01T04:00:00.000Z', currentDesk: { kind: 'PAYMENT' },
  lines: [{ id: 'line-1', lineNo: 1, incurredDate: '2026-09-30T00:00:00.000Z', description: 'ค่าแท็กซี่', categoryLabelSnapshot: 'เดินทาง', amount: '500.0000' }],
  approvalSteps: [{ id: 'step-1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'boss', decidedByName: 'สมศรี', decidedAt: '2026-10-01T04:00:00.000Z' }],
  payments: [], signatures: [], signedCopies: [], duplicateCandidates: [], ...overrides,
});

/**
 * The claim page as `viewer` sees it, with `detail` loaded: the claim is the page's second null state, after
 * the confirm dialog's. `open` puts a value into one later null state, for a dialog the page opens from a tap.
 */
function claimPage(detail: object, viewer: { userId: string; permissions: readonly string[] },
  open?: { nullState: number; value: unknown; typed?: string; over?: string }): string {
  let nulls = 0;
  return renderWithState(h(AppRouterContext.Provider, { value: router }, h(ToastContext.Provider, { value: toast },
    h(ReimbursementJourneyPage, { companyId: 'company-1', requestId: 'claim-1', userId: viewer.userId, permissions: viewer.permissions }))),
  (initial) => {
    if (initial === null) { nulls += 1; return nulls === 2 ? detail : open && nulls === open.nullState ? open.value : undefined; }
    // What the person typed into the dialog: over its empty box, or over the reason it started with.
    return initial === (open?.over ?? '') && open?.typed !== undefined ? open.typed : undefined;
  });
}

/**
 * The page with one of its dialogs open, found by its title rather than by the position of its state hook: the
 * page keeps "which dialog is open" in a null state, and a hook added before it must not silently move this test.
 */
function withDialog(detail: object, viewer: { userId: string; permissions: readonly string[] }, value: unknown, title: string, typed?: string, over?: string): string {
  for (let nullState = 3; nullState < 24; nullState += 1) {
    const html = claimPage(detail, viewer, { nullState, value, typed, over });
    if (visible(html).some((text) => text.startsWith(title))) return html;
  }
  throw new Error(`the claim page opened no dialog titled "${title}"`);
}

/** The button with this label inside a rendered page: whether it is there, and whether it can be pressed. */
function button(html: string, label: string): { shown: boolean; disabled: boolean } {
  const match = [...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/gu)].find(([, , text]) => text === label);
  return { shown: !!match, disabled: !!match && /\bdisabled=""/u.test(match[1]!) };
}

describe('cancelling a claim asks for a reason the system can finish the cancellation with (audit B3)', () => {
  const owner = { userId: 'owner', permissions: OWNER };
  const dialog = (typed: string) => withDialog(claim(), owner, 'cancel', 'ยกเลิกคำขอ RB-202610-00007', typed);

  // Before: any non-empty reason was sent, and one or two characters left the claim half cancelled for good.
  it('keeps ยืนยันยกเลิกคำขอ off until the reason is as long as the expense void takes, and says how long', () => {
    assert.equal(EXPENSE_VOID_REASON_MIN_LENGTH, 3);
    for (const typed of ['', 'ก', 'ab', '  ab  ']) {
      assert.deepEqual(button(dialog(typed), 'ยืนยันยกเลิกคำขอ'), { shown: true, disabled: true }, JSON.stringify(typed));
    }
    for (const typed of ['abc', 'ซื้อซ้ำกับใบก่อน']) {
      assert.deepEqual(button(dialog(typed), 'ยืนยันยกเลิกคำขอ'), { shown: true, disabled: false }, typed);
    }
    assert.ok(visible(dialog('')).includes('อย่างน้อย 3 ตัวอักษร'));
    // The page's other reason dialogs take any reason, as their endpoints do, and show no length hint.
    const blocked = claim({ duplicateBlocksPayment: true, duplicateCandidates: [{ id: 'd1', candidateType: 'ATTACHMENT_CHECKSUM', status: 'OPEN', score: 80 }] });
    const other = withDialog(blocked, owner, 'resolve-duplicate', 'ปลดรายการซ้ำ RB-202610-00007', 'ก');
    assert.deepEqual(button(other, 'ยืนยันว่าไม่ซ้ำ'), { shown: true, disabled: false });
    assert.equal(visible(other).some((text) => text.startsWith('อย่างน้อย')), false);
  });
});

// Audit B3: a cancellation that was started and has not completed. Before: the page showed the claim as if
// nothing had happened, with อนุมัติ and บันทึกจ่าย buttons the API refused and a cancel that could not finish.
describe('a claim whose cancellation has not completed says so in the step card and offers only what the API takes', () => {
  const requester = { userId: 'staff', permissions: STAFF };
  const owner = { userId: 'owner', permissions: OWNER };
  const approver = { userId: 'boss', permissions: APPROVER };
  const pending = (overrides: Record<string, unknown> = {}) => ({
    startedAt: '2026-10-01T02:00:00.000Z', startedByUserId: 'staff', startedByName: 'พิม ใจดี', reason: 'ซื้อซ้ำกับใบก่อน', canResume: true, canWithdraw: true, ...overrides,
  });
  /** The same claim in each status it can be cancelled from, as the API answers it while the cancellation is pending. */
  const cancelling = (overrides: Record<string, unknown> = {}, cancellation: Record<string, unknown> = {}) =>
    claim({ currentDesk: { kind: 'SYSTEM' }, pendingCancellation: pending(cancellation), ...overrides });
  const atApproval = (cancellation: Record<string, unknown> = {}) => cancelling({ status: 'PENDING_APPROVAL', approvedAt: undefined,
    approvalSteps: [{ id: 'step-1', sequenceNo: 1, status: 'PENDING', approverName: 'สมศรี' }],
    // The assignee keeps the authority over the step; the approve endpoint refuses it while the cancellation is pending.
    approvalActions: { canApprove: true, canReject: true } }, cancellation);

  it('shows who started it, when and why, hides every decision the API refuses, and offers ดำเนินการยกเลิกต่อ and ถอนการยกเลิก to whoever may cancel', () => {
    const html = claimPage(cancelling(), owner);
    const card = stepCard(html);
    assert.deepEqual(card.buttons, ['ดำเนินการยกเลิกต่อ', 'ถอนการยกเลิก', 'พิมพ์ใบเบิก']);
    assert.equal(card.note, 'กำลังยกเลิกคำขอ รอระบบปรับสถานะ · พิม ใจดี เริ่มยกเลิกคำขอนี้ เมื่อ 1 ต.ค. 2569 09:00 น. แต่ยังยกเลิกไม่เสร็จ'
      + ' · ระบบจะดำเนินการต่อให้เองภายในไม่กี่นาที หรือกดดำเนินการยกเลิกต่อได้เลย · ถ้าไม่ต้องการยกเลิกแล้ว กดถอนการยกเลิก ใบจะกลับไปเดินต่อตามเดิม'
      + ' · ระหว่างนี้ยังอนุมัติ ปฏิเสธ แก้ไข หรือบันทึกจ่ายใบนี้ไม่ได้');
    // The owner holds every right, and still gets no บันทึกจ่าย, no second ยกเลิกคำขอ, no decision and no payment form anywhere on the page.
    const pressable = [...html.matchAll(/<button\b[^>]*>([^<]*)<\/button>/gu)].map((match) => match[1]!);
    for (const refused of ['บันทึกจ่าย', 'ยกเลิกคำขอ', 'อนุมัติ', 'ปฏิเสธ', 'อนุมัติจ่าย']) assert.equal(pressable.includes(refused), false, refused);
    assert.equal(visible(html).includes('วิธีจ่าย *'), false);

    // At the approval step: the approver the step was sent to reads why they cannot decide, and gets no button.
    const waiting = stepCard(claimPage(atApproval({ canResume: false, canWithdraw: false }), approver));
    assert.deepEqual(waiting.buttons, ['พิมพ์ใบเบิก']);
    assert.match(waiting.note, /^กำลังยกเลิกคำขอ รอระบบปรับสถานะ · พิม ใจดี เริ่มยกเลิกคำขอนี้/u);
    assert.match(waiting.note, /ผู้ที่ดำเนินการต่อได้คือผู้เบิกหรือผู้มีสิทธิ์ตรวจการเงิน · ระหว่างนี้ยังอนุมัติ ปฏิเสธ แก้ไข หรือบันทึกจ่ายใบนี้ไม่ได้$/u);
    // The requester of the same claim: continue or take it back, and no "แก้ไข (เปิดกลับเป็นร่าง)" the API would refuse.
    assert.deepEqual(stepCard(claimPage(atApproval(), requester)).buttons, ['ดำเนินการยกเลิกต่อ', 'ถอนการยกเลิก', 'พิมพ์ใบเบิก']);
    // A draft being cancelled takes no edit and no submit either.
    const draft = cancelling({ status: 'DRAFT', requestNo: undefined, submittedAt: undefined, approvedAt: undefined, approvalSteps: [] });
    assert.deepEqual(stepCard(claimPage(draft, requester)).buttons, ['ดำเนินการยกเลิกต่อ', 'ถอนการยกเลิก']);
  });

  it('follows the server for each button: no ถอนการยกเลิก once a record was voided, nothing for a viewer who may not cancel', () => {
    const actions = (cancellation: Record<string, unknown>, viewer = owner) =>
      activeJourneyStep(buildJourneySteps(cancelling({}, cancellation), viewer.permissions, viewer.userId))!.actions;
    assert.deepEqual(actions({}), ['resume-cancel', 'withdraw-cancel', 'print']);
    assert.deepEqual(actions({ canWithdraw: false }), ['resume-cancel', 'print']);
    // The flags are the server's verdict for this viewer; holding every permission changes nothing.
    assert.deepEqual(actions({ canResume: false, canWithdraw: false }), ['print']);
    assert.deepEqual(actions({ canResume: false, canWithdraw: false }, approver), ['print']);
    const partly = stepCard(claimPage(cancelling({}, { canWithdraw: false }), owner));
    assert.match(partly.note, /ระบบยกเลิกรายการค่าใช้จ่ายไปบางส่วนแล้ว จึงถอนการยกเลิกไม่ได้/u);
  });

  it('says what stands in the way in words a person can act on', () => {
    const note = (blocker: Record<string, unknown>) => stepCard(claimPage(cancelling({}, { blocker }), owner)).note;
    assert.match(note({ code: 'reason_too_short' }), /แต่ยังยกเลิกไม่เสร็จ เพราะเหตุผลที่ระบุไว้สั้นเกินไป ระบบจึงยกเลิกรายการค่าใช้จ่ายของใบนี้ไม่ได้ · กดดำเนินการยกเลิกต่อ แล้วระบุเหตุผลใหม่อย่างน้อย 3 ตัวอักษร/u);
    assert.match(note({ code: 'accounting_period_locked', periodKey: '2026-09' }),
      /เพราะงวดบัญชี ก\.ย\. 2569 ปิดแล้ว ระบบจึงยกเลิกรายการค่าใช้จ่ายของใบนี้ไม่ได้ ต้องให้ผู้มีสิทธิ์เปิดงวดบัญชีนั้นก่อน · เมื่อแก้ไขแล้ว กดดำเนินการยกเลิกต่อ/u);
    assert.match(note({ code: 'tax_period_locked', periodKey: '2026-09', formType: 'PP30' }), /เพราะงวดภาษี ก\.ย\. 2569 ยื่นแบบหรือปิดแล้ว/u);
    assert.match(note({ code: 'posting_unresolved' }), /ยังลงบัญชีไม่เรียบร้อย ต้องให้ผู้ดูแลบัญชีตรวจการลงบัญชีก่อน · เมื่อแก้ไขแล้ว กดดำเนินการยกเลิกต่อ/u);
    assert.match(note({ code: 'expense_not_voidable' }), /อยู่ในสถานะที่ระบบยกเลิกให้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ/u);
    // A cancel refused up front for the same reason reads the same, period named in Thai.
    assert.equal(errorText(new Error('reimbursement_cancellation_accounting_period_locked:2026-09')),
      'ยังยกเลิกคำขอนี้ไม่ได้ เพราะงวดบัญชี ก.ย. 2569 ปิดแล้ว ระบบจึงยกเลิกรายการค่าใช้จ่ายของใบนี้ไม่ได้ ต้องให้ผู้มีสิทธิ์เปิดงวดบัญชีนั้นก่อน');
    assert.equal(errorText(new Error('cancellation_reason_too_short')), 'เหตุผลที่ยกเลิกคำขอต้องยาวอย่างน้อย 3 ตัวอักษร');
    // Every state reads in plain Thai: no code, key or ISO period on the page.
    for (const blocker of [undefined, { code: 'reason_too_short' }, { code: 'accounting_period_locked', periodKey: '2026-09' },
      { code: 'tax_period_locked', periodKey: '2026-09', formType: 'PP30' }, { code: 'posting_unresolved' }, { code: 'expense_not_voidable' },
      { code: 'a_blocker_added_later', periodKey: 'not-a-period' }]) {
      const html = claimPage(cancelling({}, { blocker }), owner);
      assertPlainThai([stepCard(html).note, ...deskLine(html), ...buildClaimTimeline(cancelling({}, { blocker })).map((row) => row.label)], JSON.stringify(blocker));
    }
  });

  it('asks for a corrected reason only when the stored one is what blocks it, starting from the reason on record', () => {
    const stranded = cancelling({}, { reason: 'ก', blocker: { code: 'reason_too_short' } });
    const dialog = (typed?: string) => withDialog(stranded, owner, 'resume-cancel', 'ดำเนินการยกเลิกต่อ RB-202610-00007', typed, 'ก');
    // It opens on the reason on record, which is still too short to confirm.
    const opened = dialog();
    assert.match(opened, /<textarea\b[^>]*>ก<\/textarea>/u);
    assert.deepEqual(button(opened, 'ยืนยันยกเลิกคำขอ'), { shown: true, disabled: true });
    assert.ok(visible(opened).some((text) => text.startsWith('เหตุผลที่ระบุไว้เดิมสั้นเกินไป')));
    assert.deepEqual(button(dialog('ab'), 'ยืนยันยกเลิกคำขอ'), { shown: true, disabled: true });
    assert.deepEqual(button(dialog('ซื้อซ้ำกับใบก่อน'), 'ยืนยันยกเลิกคำขอ'), { shown: true, disabled: false });
  });

  it('names the system on the อยู่ที่ line, in the step note and in the timeline, as the LINE backlog does', () => {
    for (const detail of [cancelling(), atApproval(), cancelling({ status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING', financeReviewRequired: true })]) {
      const html = claimPage(detail, owner);
      assert.deepEqual(deskLine(html), [`อยู่ที่ ${REIMBURSEMENT_DESK_LABELS.SYSTEM}`], String(detail.status));
      assert.equal(currentDeskText(detail.currentDesk as any), 'ระบบ');
      assert.ok(stepCard(html).note.startsWith(`กำลังยกเลิกคำขอ ${REIMBURSEMENT_SYSTEM_WAIT_LABEL}`), String(detail.status));
      const timeline = buildClaimTimeline(detail);
      assert.deepEqual(timeline.filter((row) => row.state === 'current').map((row) => row.label), [`กำลัง${REIMBURSEMENT_SYSTEM_WAIT_LABEL}`], String(detail.status));
      // Nobody else is said to be waited for: no approver, payer or finance desk on any of the three.
      for (const text of [...deskLine(html), stepCard(html).note, ...timeline.filter((row) => row.state !== 'done').map((row) => row.label)]) {
        assert.doesNotMatch(text, /สมศรี|ผู้มีสิทธิ์อนุมัติ|ผู้มีสิทธิ์บันทึกจ่าย|ฝ่ายการเงิน/u, `${detail.status}: ${text}`);
      }
      assert.ok(visible(html).includes(`กำลัง${REIMBURSEMENT_SYSTEM_WAIT_LABEL}`), 'the timeline row is on the page');
    }
    // The timeline keeps what happened and ends at the cancellation: who started it, then the system.
    assert.deepEqual(buildClaimTimeline(atApproval()).map((row) => `${row.state}:${row.label}`),
      ['done:ยื่นใบ', 'done:เริ่มยกเลิกคำขอ โดย พิม ใจดี', 'current:กำลังรอระบบปรับสถานะ']);
    assert.deepEqual(buildClaimTimeline(cancelling()).map((row) => `${row.state}:${row.label}`),
      ['done:ยื่นใบ', 'done:อนุมัติโดย สมศรี', 'done:เริ่มยกเลิกคำขอ โดย พิม ใจดี', 'current:กำลังรอระบบปรับสถานะ']);
  });
});
