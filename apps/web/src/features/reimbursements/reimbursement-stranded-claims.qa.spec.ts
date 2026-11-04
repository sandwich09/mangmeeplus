import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
require.extensions['.css'] = module => { module.exports = { menu: 'menu', panel: 'panel' }; };
// Modal portals into document.body, which a server render has none of: render the dialog in place.
Reflect.set(require('react-dom'), 'createPortal', (node: React.ReactNode) => node);
const { ReimbursementJourneyPage } = require('./ReimbursementJourneyPage') as typeof import('./ReimbursementJourneyPage');
const {
  activeJourneyStep, buildClaimTimeline, buildJourneySteps, errorText, opensPaymentFormOnArrival, queueRowOffersFinanceReview, queueRowOffersPayment, quickPayBlockedNote,
} = require('./reimbursements.logic') as typeof import('./reimbursements.logic');
const { claimIsBeingCancelled, claimStatusBadge, currentDeskText, reimbursementOwnActions } = require('./reimbursements.model') as typeof import('./reimbursements.model');
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
  ...html.replace(/<span class="text-red-600"(?: aria-hidden="true")?> \*<\/span>/gu, ' *').replace(/<[^>]*>/gu, '\n').split('\n')]
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
  const start = html.lastIndexOf('<section', html.indexOf('aria-labelledby="journey-step-title"'));
  let depth = 0, end = start;
  for (const tag of html.slice(start).matchAll(/<section\b[^>]*>|<\/section>/g)) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (!depth) { end = start + tag.index! + tag[0].length; break; }
  }
  const section = html.slice(start, end);
  // The account has moved inside this step; its separately tested reveal/send-back controls are not step decisions.
  const decisions = section.replace(/<section class="space-y-3 border-b[\s\S]*?<\/section>/g, '');
  return {
    note: visible(section.slice(section.indexOf('</h2>'), section.includes('class="mangmee-actions') ? section.indexOf('class="mangmee-actions') : undefined))[0] ?? '',
    buttons: [...decisions.matchAll(/<(?:button|a)\b[^>]*>([^<]+)<\/(?:button|a)>/gu)].map((match) => match[1]!).filter(label => label !== 'พิมพ์ใบเบิก'),
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

/**
 * Presses a button of the claim page and returns what the page then asks of the API. The page's own handler
 * runs: it is taken from the button the page renders, and the page's calls go to a fetch that answers with the claim.
 */
async function press(detail: object, viewer: { userId: string; permissions: readonly string[] }, label: string): Promise<Array<{ url: string; method: string; body: unknown }>> {
  const realCreateElement = reactRuntime.createElement;
  let onClick: (() => void) | undefined;
  Reflect.set(reactRuntime, 'createElement', (type: unknown, props: { onClick?: () => void } | null, ...children: unknown[]) => {
    if (type === 'button' && children[0] === label && typeof props?.onClick === 'function') onClick = props.onClick;
    return (realCreateElement as (...args: unknown[]) => unknown)(type, props, ...children);
  });
  try { claimPage(detail, viewer); } finally { Reflect.set(reactRuntime, 'createElement', realCreateElement); }
  assert.ok(onClick, `the page shows no pressable "${label}"`);
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const realFetch = globalThis.fetch;
  const realWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.assign(globalThis, { window: {} });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(detail);
  }) as typeof fetch;
  try {
    onClick();
    for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  } finally {
    globalThis.fetch = realFetch;
    if (realWindow) Object.defineProperty(globalThis, 'window', realWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
  return calls;
}

/** The button with this label inside a rendered page: whether it is there, and whether it can be pressed. */
function button(html: string, label: string): { shown: boolean; disabled: boolean } {
  const match = [...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/gu)].find(([, , text]) => text === label);
  return { shown: !!match, disabled: !!match && /\bdisabled=""/u.test(match[1]!) };
}

describe('cancelling a claim asks for a reason the system can finish the cancellation with (audit B3)', () => {
  const owner = { userId: 'owner', permissions: OWNER };
  const dialog = (typed: string) => withDialog(claim(), owner, 'cancel', 'ยกเลิกใบเบิก RB-202610-00007', typed);

  // Before: any non-empty reason was sent, and one or two characters left the claim half cancelled for good.
  it('keeps ยกเลิกใบเบิก off until the reason is as long as the expense void takes, and says how long', () => {
    assert.equal(EXPENSE_VOID_REASON_MIN_LENGTH, 3);
    for (const typed of ['', 'ก', 'ab', '  ab  ']) {
      assert.deepEqual(button(dialog(typed), 'ยกเลิกใบเบิก'), { shown: true, disabled: true }, JSON.stringify(typed));
    }
    for (const typed of ['abc', 'ซื้อซ้ำกับใบก่อน']) {
      assert.deepEqual(button(dialog(typed), 'ยกเลิกใบเบิก'), { shown: true, disabled: false }, typed);
    }
    assert.ok(visible(dialog('')).includes('อย่างน้อย 3 ตัวอักษร'));
    // The title says what is cancelled (the number and the amount), the body what it means in one sentence, and the button
    // that backs out is named for what it leaves undone: never a second "ยกเลิก" beside the one that cancels.
    const shown = visible(dialog('abc'));
    assert.ok(shown.some((text) => /^ยกเลิกใบเบิก RB-202610-00007 [\d,]+\.\d{2} บาท$/u.test(text)), shown.filter((text) => text.includes('RB-')).join(' | '));
    for (const text of ['ยกเลิกแล้วนำกลับมาใช้ไม่ได้', 'เหตุผล', 'ไม่ยกเลิก']) assert.ok(shown.includes(text), text);
    assert.deepEqual([button(dialog('abc'), 'ยกเลิก').shown, button(dialog('abc'), 'กลับ').shown], [false, false]);
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
    // The server answers no decision for a claim being cancelled; the page asks for none either way.
    approvalActions: { canApprove: false, canReject: false } }, cancellation);

  it('shows who started it, when and why, hides every decision the API refuses, and offers ทำต่อเพื่อยกเลิก and ถอนการยกเลิก to whoever may cancel', () => {
    const html = claimPage(cancelling(), owner);
    const card = stepCard(html);
    assert.deepEqual(card.buttons, ['ถอนการยกเลิก', 'ทำต่อเพื่อยกเลิก'], 'back-out first, the acting button last; printing sits with the document');
    assert.equal(card.note, 'กำลังยกเลิกใบเบิก รอระบบปรับสถานะ · พิม ใจดี เริ่มยกเลิกใบเบิกนี้ เมื่อ 1 ต.ค. 2569 09:00 น.'
      + ' · ระบบจะทำต่อให้เองภายในไม่กี่นาที หรือกดทำต่อเพื่อยกเลิกได้เลย · ถ้าไม่ต้องการยกเลิกแล้ว กดถอนการยกเลิก ใบจะกลับไปเดินต่อตามเดิม'
      + ' · ระหว่างนี้ยังอนุมัติ ส่งกลับให้แก้ แก้ไข หรือบันทึกจ่ายใบนี้ไม่ได้');
    // The owner holds every right, and still gets no บันทึกจ่าย, no second ยกเลิกใบเบิก, no decision and no payment form anywhere on the page.
    const pressable = [...html.matchAll(/<button\b[^>]*>([^<]*)<\/button>/gu)].map((match) => match[1]!);
    for (const refused of ['บันทึกจ่าย', 'ยกเลิกใบเบิก', 'อนุมัติ', 'ส่งกลับให้แก้', 'อนุมัติจ่าย']) assert.equal(pressable.includes(refused), false, refused);
    assert.equal(visible(html).includes('วิธีจ่าย *'), false);

    // At the approval step: the approver the step was sent to reads why they cannot decide, and gets no button.
    const waiting = stepCard(claimPage(atApproval({ canResume: false, canWithdraw: false }), approver));
    assert.deepEqual(waiting.buttons, []);
    assert.match(waiting.note, /^กำลังยกเลิกใบเบิก รอระบบปรับสถานะ · พิม ใจดี เริ่มยกเลิกใบเบิกนี้/u);
    assert.match(waiting.note, /ผู้ที่ทำต่อได้คือผู้เบิกหรือผู้มีสิทธิ์ตรวจการเงิน · ระหว่างนี้ยังอนุมัติ ส่งกลับให้แก้ แก้ไข หรือบันทึกจ่ายใบนี้ไม่ได้$/u);
    // The requester of the same claim: continue or take it back, and no "แก้ไข (เปิดกลับเป็นร่าง)" the API would refuse.
    assert.deepEqual(stepCard(claimPage(atApproval(), requester)).buttons, ['ถอนการยกเลิก', 'ทำต่อเพื่อยกเลิก']);
    // A draft being cancelled takes no edit and no submit either.
    const draft = cancelling({ status: 'DRAFT', requestNo: undefined, submittedAt: undefined, approvedAt: undefined, approvalSteps: [] });
    assert.deepEqual(stepCard(claimPage(draft, requester)).buttons, ['ถอนการยกเลิก', 'ทำต่อเพื่อยกเลิก']);
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
    assert.match(note({ code: 'reason_too_short' }), / · เหตุผลที่ระบุไว้สั้นเกินไป ระบบจึงยกเลิกรายการค่าใช้จ่ายของใบนี้ไม่ได้ · กดทำต่อเพื่อยกเลิก แล้วระบุเหตุผลใหม่อย่างน้อย 3 ตัวอักษร/u);
    assert.match(note({ code: 'accounting_period_locked', periodKey: '2026-09' }),
      / · ยกเลิกใบเบิกไม่ได้ \(รายจ่ายเดือน ก\.ย\. 2569\) ให้ผู้ทำบัญชีตรวจรายการนี้ต่อ · เมื่อแก้ไขแล้ว กดทำต่อเพื่อยกเลิก/u);
    assert.match(note({ code: 'tax_period_locked', periodKey: '2026-09', formType: 'PP30' }), / · ยกเลิกใบเบิกไม่ได้ \(ภ.พ.30\) \(รายจ่ายเดือน ก\.ย\. 2569\) ให้ผู้ทำบัญชีตรวจรายการนี้ต่อ/u);
    assert.match(note({ code: 'tax_period_locked', periodKey: '2026-09', formType: 'PND3' }), /ภ.ง.ด.3.*ก.ย. 2569.*ให้ผู้ทำบัญชีตรวจรายการนี้ต่อ/u);
    assert.doesNotMatch(note({ code: 'tax_period_locked', periodKey: '2026-09', formType: 'UNKNOWN' }), /UNKNOWN|ภ.พ.30|ภ.ง.ด.3/u);
    assert.match(note({ code: 'posting_unresolved' }), /ยกเลิกใบเบิกไม่ได้ ให้ผู้ทำบัญชีตรวจรายการนี้ต่อ · เมื่อแก้ไขแล้ว กดทำต่อเพื่อยกเลิก/u);
    assert.match(note({ code: 'expense_not_voidable' }), /อยู่ในสถานะที่ระบบยกเลิกให้ไม่ได้ ติดต่อผู้ดูแลระบบ/u);
    // A cancel refused up front for the same reason reads the same, period named in Thai.
    assert.equal(errorText(new Error('reimbursement_cancellation_accounting_period_locked:2026-09')),
      'ยกเลิกใบเบิกไม่ได้ (รายจ่ายเดือน ก.ย. 2569) ให้ผู้ทำบัญชีตรวจรายการนี้ต่อ');
    assert.equal(errorText(new Error('cancellation_reason_too_short')), 'เหตุผลที่ยกเลิกใบเบิกต้องยาวอย่างน้อย 3 ตัวอักษร');
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
    const dialog = (typed?: string) => withDialog(stranded, owner, 'resume-cancel', 'ยกเลิกใบเบิกต่อ RB-202610-00007', typed, 'ก');
    // It opens on the reason on record, which is still too short to confirm.
    const opened = dialog();
    assert.match(opened, /<textarea\b[^>]*>ก<\/textarea>/u);
    assert.deepEqual(button(opened, 'ยกเลิกใบเบิก'), { shown: true, disabled: true });
    assert.ok(visible(opened).some((text) => text.startsWith('เหตุผลเดิมสั้นเกินไป')));
    assert.deepEqual(button(dialog('ab'), 'ยกเลิกใบเบิก'), { shown: true, disabled: true });
    assert.deepEqual(button(dialog('ซื้อซ้ำกับใบก่อน'), 'ยกเลิกใบเบิก'), { shown: true, disabled: false });
  });

  it('names the system on the อยู่ที่ line, in the step note and in the timeline, as the LINE backlog does', () => {
    for (const detail of [cancelling(), atApproval(), cancelling({ status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING', financeReviewRequired: true })]) {
      const html = claimPage(detail, owner);
      assert.deepEqual(deskLine(html), [`อยู่ที่ ${REIMBURSEMENT_DESK_LABELS.SYSTEM}`], String(detail.status));
      assert.equal(currentDeskText(detail.currentDesk as any), 'ระบบ');
      assert.ok(stepCard(html).note.startsWith(`กำลังยกเลิกใบเบิก ${REIMBURSEMENT_SYSTEM_WAIT_LABEL}`), String(detail.status));
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
      ['done:ยื่นใบ', 'done:เริ่มยกเลิกใบเบิก โดย พิม ใจดี', 'current:กำลังรอระบบปรับสถานะ']);
    assert.deepEqual(buildClaimTimeline(cancelling()).map((row) => `${row.state}:${row.label}`),
      ['done:ยื่นใบ', 'done:อนุมัติโดย สมศรี', 'done:เริ่มยกเลิกใบเบิก โดย พิม ใจดี', 'current:กำลังรอระบบปรับสถานะ']);
  });
});

// The hub's rows. A list or queue row carried nothing about a pending cancellation, so the finance queue
// offered บันทึกจ่าย and อนุมัติจ่าย, and a draft row ส่งอนุมัติ, on a claim the API refuses them for. And the
// quick-pay dialog showed its form for whatever claim it read, however stale the row it was opened from.
describe('the hub offers nothing the API refuses on a claim that is being cancelled or cannot be paid yet', () => {
  const hub = readFileSync(new URL('./ReimbursementsPages.tsx', import.meta.url), 'utf8');
  const payer = ['reimbursement.read', 'reimbursement.finance_review', 'reimbursement.payment.record'];
  const row = (overrides: Record<string, unknown> = {}): Record<string, any> => ({ id: 'claim-1', status: 'READY_FOR_PAYMENT', branchId: 'branch-1', requesterUserId: 'staff', ...overrides });

  it('offers no บันทึกจ่าย and no อนุมัติจ่าย on the finance-queue row of a claim being cancelled, on the table and on the cards alike', () => {
    assert.equal(queueRowOffersPayment(row(), payer), true);
    assert.equal(queueRowOffersPayment(row({ cancellationPending: true }), payer), false);
    assert.equal(queueRowOffersFinanceReview(row({ status: 'FINANCE_REVIEW' })), true);
    assert.equal(queueRowOffersFinanceReview(row({ status: 'FINANCE_REVIEW', cancellationPending: true })), false);
    for (const status of ['READY_FOR_PAYMENT', 'PARTIALLY_PAID', 'APPROVED', 'PENDING_APPROVAL']) assert.equal(queueRowOffersFinanceReview(row({ status })), false, status);
    // A claim nobody had to approve that still waits for the system is APPROVED: it is not paid from a row either.
    assert.equal(queueRowOffersPayment(row({ status: 'APPROVED' }), payer), false);
    // Both layouts ask the two rules, and nothing in the queue decides it from the status alone any more.
    // One builder makes the row's one button for both layouts.
    assert.match(hub, /const rowButton = \(r: any, layout: 'cards' \| 'table'\) => \{[\s\S]*?if \(queueRowOffersFinanceReview\(r\)\) \{[\s\S]*?return queueRowOffersPayment\(r, permissions\) && \(\s*<button/);
    assert.equal(hub.match(/queueRowOffersFinanceReview\(r\)\) \{/g)?.length, 1);
    assert.equal(hub.match(/queueRowOffersPayment\(r, permissions\) && \(/g)?.length, 1);
    assert.match(hub, /queue="finance"[^\n]*action=\{rowButton\}/);
    assert.deepEqual([hub.match(/action\?\.\(row, 'table'\)/g)?.length, hub.match(/action\?\.\(row, 'cards'\)/g)?.length], [1, 1]);
    assert.equal(hub.includes("r.status === 'FINANCE_REVIEW' && <button"), false);
  });

  it('offers no ส่งอนุมัติ, แก้ไข or ยกเลิก on the list row of a claim being cancelled, as on its page', () => {
    const everything = [...OWNER];
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'READY_FOR_PAYMENT', 'REJECTED']) {
      const open = reimbursementOwnActions(row({ status }), 'staff', everything);
      assert.ok(Object.values(open).some(Boolean), `${status}: something is offered while it is not being cancelled`);
      // A row says it with cancellationPending, the detail also with pendingCancellation: one answer for both.
      for (const claim of [row({ status, cancellationPending: true }), row({ status, pendingCancellation: { startedAt: '2026-10-01T02:00:00.000Z' } })]) {
        assert.equal(claimIsBeingCancelled(claim), true);
        assert.deepEqual(reimbursementOwnActions(claim, 'staff', everything), { canEditDraft: false, canSubmit: false, canCancel: false, canReopen: false }, status);
      }
    }
    assert.equal(claimIsBeingCancelled(row()), false);
  });

  it('shows no payment form in the quick-pay dialog for a claim its own page would not take a payment on, and says what that page says', () => {
    const owner = { userId: 'owner', permissions: OWNER };
    assert.equal(quickPayBlockedNote(claim(), owner.permissions, owner.userId), null, 'a claim waiting for payment');
    const cancelling = claim({ currentDesk: { kind: 'SYSTEM' }, cancellationPending: true,
      pendingCancellation: { startedAt: '2026-10-01T02:00:00.000Z', startedByName: 'พิม ใจดี', reason: 'ซื้อซ้ำกับใบก่อน', canResume: true, canWithdraw: true } });
    assert.match(quickPayBlockedNote(cancelling, owner.permissions, owner.userId)!, /^บันทึกจ่ายใบนี้ไม่ได้ · กำลังยกเลิกใบเบิก รอระบบปรับสถานะ/u);
    const waiting = claim({ status: 'APPROVED', approvalSteps: [], awaitingSystem: { kind: 'NO_APPROVAL_NEEDED', canResume: true } });
    assert.match(quickPayBlockedNote(waiting, owner.permissions, owner.userId)!, /^บันทึกจ่ายใบนี้ไม่ได้ · ใบนี้ไม่ต้องอนุมัติตามนโยบาย · ระบบยังเตรียมรายการสำหรับจ่ายเงินของใบนี้ไม่เสร็จ/u);
    // Paid by someone else meanwhile, cancelled meanwhile, or a viewer the payment is not taken from: no form
    // either, and no word of a payment "not yet" for a claim that will never take one.
    const paid = claim({ status: 'PAID', paymentStatus: 'PAID', currentDesk: undefined, payments: [{ id: 'p1', status: 'RECORDED', paidAt: '2026-10-01T05:00:00.000Z' }] });
    assert.match(quickPayBlockedNote(paid, owner.permissions, owner.userId)!, /^บันทึกจ่ายใบนี้ไม่ได้ · รอผู้เบิกเซ็น.*รอผู้อนุมัติเซ็น/u);
    const cancelled = claim({ status: 'CANCELLED', currentDesk: undefined });
    assert.equal(quickPayBlockedNote(cancelled, owner.permissions, owner.userId), 'บันทึกจ่ายใบนี้ไม่ได้ · ยกเลิกใบเบิกแล้ว');
    assert.ok(quickPayBlockedNote(claim(), ['reimbursement.read'], 'reader'));
    for (const stale of [cancelling, waiting, paid, cancelled]) {
      const note = quickPayBlockedNote(stale, owner.permissions, owner.userId)!;
      assertPlainThai([note], 'quick pay');
      assert.doesNotMatch(note, /ยังบันทึกจ่ายไม่ได้ในตอนนี้/u);
      assert.equal(new Set(note.split(' · ')).size, note.split(' · ').length, `nothing is said twice: ${note}`);
    }
    // The dialog asks that rule before it mounts the form, with the viewer's own rights, and shows its words as they are.
    assert.match(hub, /const blocked = claim \? quickPayBlockedNote\(claim, permissions, userId\) : null;/);
    assert.match(hub, /\{claim \? \(\s+blocked \? \(\s+<div[^>]*>\s+<ErrorBanner message=\{blocked\} \/>/);
    assert.match(hub, /\) : \(\s+<div className="space-y-3">[\s\S]{0,400}?<PaymentForm /, 'the form sits in the branch that is not blocked');
    assert.match(hub, /<PaymentModal\s+companyId=\{companyId\}\s+userId=\{userId\}\s+permissions=\{permissions\}/);
  });
});

// Audit B4: a claim whose decision is on record and was not carried out. Before: an approved claim sat at
// "รออนุมัติ" with no button for anyone, and a claim nobody had to approve offered a บันทึกจ่าย the API refused.
describe('a claim that was decided and has not moved on says so in the approval step and offers ทำต่อ to whoever the API takes it from', () => {
  const requester = { userId: 'staff', permissions: STAFF };
  const owner = { userId: 'owner', permissions: OWNER };
  const approver = { userId: 'boss', permissions: APPROVER };
  const transfer = { payoutMethod: 'BANK_TRANSFER', payout: { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย',
    accountName: 'พิม ใจดี', accountLast4: '6789', version: 1, source: 'DEFAULT_ACCOUNT' } };
  /** Approved by สมศรี, paid by transfer; the system has not carried the approval out. As the API answers it. */
  const approved = (canResume: boolean, overrides: Record<string, unknown> = {}) => claim({
    status: 'PENDING_APPROVAL', approvedAt: undefined, paymentStatus: 'NOT_PAYABLE', currentDesk: { kind: 'SYSTEM' },
    approvalActions: { canApprove: false, canReject: false }, awaitingSystem: { kind: 'APPROVAL', canResume }, ...transfer, ...overrides,
  });
  /** Sent under a policy that asked for no approval; its expense records are not confirmed, so it cannot be paid. */
  const noApprovalNeeded = (canResume: boolean, overrides: Record<string, unknown> = {}) => claim({
    status: 'APPROVED', approvalSteps: [], currentDesk: { kind: 'PAYMENT' }, paymentDesk: { names: ['วราภรณ์', 'สมศรี'], moreCount: 0 },
    awaitingSystem: { kind: 'NO_APPROVAL_NEEDED', canResume }, ...overrides,
  });
  const pressable = (html: string) => [...html.matchAll(/<button\b[^>]*>([^<]*)<\/button>/gu)].map((match) => match[1]!);
  const NOT_READY = 'ระบบยังเตรียมรายการสำหรับจ่ายเงินของใบนี้ไม่เสร็จ จึงยังบันทึกจ่ายไม่ได้';

  it('an approved claim: its approver reads that the system has it and gets ทำต่อ, with no second approval and no attestation asked', () => {
    const html = claimPage(approved(true), approver);
    const card = stepCard(html);
    assert.deepEqual(card.buttons, ['ทำต่อ']);
    // Printing is offered once, with the document, and not among the step's buttons.
    assert.equal(pressable(html).filter((label) => label === 'พิมพ์ใบเบิก').length, 1);
    assert.equal(card.note, `สมศรี อนุมัติแล้ว รอระบบปรับสถานะ · ${NOT_READY} · ระบบจะทำต่อให้เองภายในไม่กี่นาที หรือกดทำต่อได้เลย ไม่ต้องอนุมัติซ้ำ`);
    assert.equal(activeJourneyStep(buildJourneySteps(approved(true), approver.permissions, approver.userId))!.key, 'approval');
    // The decision is made. Nothing asks for it again: no อนุมัติ, no ปฏิเสธ, no "ตรวจบัญชีแล้ว" for the transfer, and no payment yet.
    for (const refused of ['อนุมัติ', 'ส่งกลับให้แก้', 'บันทึกจ่าย']) assert.equal(pressable(html).includes(refused), false, refused);
    assert.equal(visible(html).includes('ฉันตรวจแล้วว่าบัญชีนี้เป็นบัญชีรับเงินของผู้เบิก'), false);
    assert.equal(html.includes('type="checkbox"'), false);

    // Whoever the server does not take it from reads the same state and who can press, and gets no button for it.
    const other = stepCard(claimPage(approved(false), requester));
    assert.deepEqual(other.buttons, ['ยกเลิกใบเบิกนี้'], 'no ทำต่อ, and no "แก้ไขใบเบิก" for a claim that was decided');
    // Cancelling is a shared danger button of the step.
    assert.equal(pressable(claimPage(approved(false), requester)).filter((label) => label === 'ยกเลิกใบเบิกนี้').length, 1);
    assert.equal(other.note, `สมศรี อนุมัติแล้ว รอระบบปรับสถานะ · ${NOT_READY} · ระบบจะทำต่อให้เองภายในไม่กี่นาที ไม่ต้องอนุมัติซ้ำ ถ้ายังค้างอยู่ ผู้อนุมัติใบนี้กดทำต่อได้`);
  });

  it('a claim nobody had to approve stands at the approval step while it cannot be paid: no บันทึกจ่าย, and ทำต่อ for whoever may record the payment', () => {
    const html = claimPage(noApprovalNeeded(true), owner);
    const card = stepCard(html);
    assert.deepEqual(card.buttons, ['ยกเลิกใบเบิกนี้', 'ทำต่อ']);
    assert.equal(card.note, `ใบนี้ไม่ต้องอนุมัติตามนโยบาย · ${NOT_READY} · ระบบจะทำต่อให้เองภายในไม่กี่นาที หรือกดทำต่อได้เลย`);
    // The owner holds the pay right, and the API would refuse the payment: the page offers none, and no payment form.
    assert.equal(pressable(html).includes('บันทึกจ่าย'), false);
    assert.equal(visible(html).includes('วิธีจ่าย *'), false);
    const steps = buildJourneySteps(noApprovalNeeded(true), owner.permissions, owner.userId);
    assert.deepEqual(steps.map((step) => `${step.key}:${step.state}`), ['items:done', 'approval:current', 'payment:upcoming', 'document:upcoming']);

    const other = stepCard(claimPage(noApprovalNeeded(false), requester));
    assert.deepEqual(other.buttons, ['ยกเลิกใบเบิกนี้']);
    assert.equal(other.note, `ใบนี้ไม่ต้องอนุมัติตามนโยบาย · ${NOT_READY} · ระบบจะทำต่อให้เองภายในไม่กี่นาที ถ้ายังค้างอยู่ วราภรณ์ หรือ สมศรี กดทำต่อได้`);

    // Once the server no longer reports it, the same claim stands at the payment step and takes the payment.
    const payable = stepCard(claimPage(noApprovalNeeded(true, { awaitingSystem: undefined }), owner));
    assert.deepEqual(payable.buttons, ['ยกเลิกใบเบิกนี้', 'จ่ายเงิน']);
  });

  it('follows the server for ทำต่อ in both directions, whatever the viewer holds', () => {
    for (const [kind, build] of [['approved', approved], ['nobody had to approve', noApprovalNeeded]] as const) {
      for (const [who, viewer] of [['every right', owner], ['the approver', approver], ['the requester', requester], ['no right at all', { userId: 'guest', permissions: [] }]] as const) {
        for (const canResume of [true, false]) {
          const actions = activeJourneyStep(buildJourneySteps(build(canResume), viewer.permissions, viewer.userId))!.actions;
          assert.equal(actions.includes('resume'), canResume, `${kind}, ${who}, server says ${canResume}`);
          assert.equal(button(claimPage(build(canResume), viewer), 'ทำต่อ').shown, canResume, `${kind}, ${who}, server says ${canResume}`);
          // And never the decisions or the payment the API refuses in this state.
          for (const refused of ['approve', 'reject', 'pay', 'reopen'] as const) assert.equal(actions.includes(refused), false, `${kind}, ${who}: ${refused}`);
        }
      }
    }
  });

  it('names one party on the อยู่ที่ line, in the step note and in the timeline for each state, as the LINE backlog does', () => {
    // Approved: the claim is with the system, everywhere.
    const decided = approved(false);
    const decidedHtml = claimPage(decided, requester);
    assert.deepEqual(deskLine(decidedHtml), [`อยู่ที่ ${REIMBURSEMENT_DESK_LABELS.SYSTEM}`]);
    assert.ok(stepCard(decidedHtml).note.startsWith(`สมศรี อนุมัติแล้ว ${REIMBURSEMENT_SYSTEM_WAIT_LABEL}`));
    assert.deepEqual(buildClaimTimeline(decided).map((row) => `${row.state}:${row.label}`),
      ['done:ยื่นใบ', 'done:อนุมัติโดย สมศรี', `current:กำลัง${REIMBURSEMENT_SYSTEM_WAIT_LABEL}`, 'future:รอบันทึกจ่าย']);
    assert.ok(visible(decidedHtml).includes(`กำลัง${REIMBURSEMENT_SYSTEM_WAIT_LABEL}`), 'the timeline row is on the page');
    // Nobody is said to be waited on for an approval or a payment.
    for (const text of [...deskLine(decidedHtml), ...buildClaimTimeline(decided).filter((row) => row.state === 'current').map((row) => row.label)]) {
      assert.doesNotMatch(text, /สมศรี|วราภรณ์|ผู้มีสิทธิ์อนุมัติ|ผู้มีสิทธิ์บันทึกจ่าย|ฝ่ายการเงิน/u, text);
    }

    // Nobody had to approve it: it is with whoever may record its payment, everywhere, by name where the detail names them.
    const waiting = noApprovalNeeded(false);
    const waitingHtml = claimPage(waiting, requester);
    assert.deepEqual(deskLine(waitingHtml), ['อยู่ที่ วราภรณ์ หรือ สมศรี']);
    assert.match(stepCard(waitingHtml).note, /ถ้ายังค้างอยู่ วราภรณ์ หรือ สมศรี กดทำต่อได้$/u);
    assert.deepEqual(buildClaimTimeline(waiting).map((row) => `${row.state}:${row.label}`),
      ['done:ยื่นใบ', 'current:กำลังรอ วราภรณ์ หรือ สมศรี ทำต่อ', 'future:รอบันทึกจ่าย']);
    // With nobody named, all three print the pool, in the words the LINE backlog uses for the same claim.
    const pool = noApprovalNeeded(false, { paymentDesk: undefined });
    const poolHtml = claimPage(pool, requester);
    assert.deepEqual(deskLine(poolHtml), [`อยู่ที่ ${REIMBURSEMENT_DESK_LABELS.PAYMENT}`]);
    assert.ok(stepCard(poolHtml).note.endsWith(`ถ้ายังค้างอยู่ ${REIMBURSEMENT_DESK_LABELS.PAYMENT} กดทำต่อได้`));
    assert.deepEqual(buildClaimTimeline(pool).filter((row) => row.state === 'current').map((row) => row.label), [`กำลังรอ ${REIMBURSEMENT_DESK_LABELS.PAYMENT} ทำต่อ`]);

    // Each of them reads in plain Thai.
    for (const [detail, viewer] of [[approved(true), approver], [approved(false), requester], [noApprovalNeeded(true), owner], [noApprovalNeeded(false), requester], [pool, requester]] as const) {
      const html = claimPage(detail, viewer);
      assertPlainThai([stepCard(html).note, ...deskLine(html), ...buildClaimTimeline(detail).map((row) => row.label)], `${detail.status} for ${viewer.userId}`);
    }
  });

  it('sends the resume call when ทำต่อ is pressed, and nothing that decides: no approval, no attestation', async () => {
    for (const [detail, viewer] of [[approved(true), approver], [noApprovalNeeded(true), owner]] as const) {
      const calls = await press(detail, viewer, 'ทำต่อ');
      assert.deepEqual(calls[0], { url: '/api/v1/companies/company-1/reimbursements/claim-1/resume', method: 'POST', body: {} }, String(detail.status));
      // Then the page reads the claim again, as after every action. No other write.
      assert.deepEqual(calls.slice(1).map((call) => [call.method, call.url]), [['GET', '/api/v1/companies/company-1/reimbursements/claim-1']], String(detail.status));
    }
  });

  it('says in plain Thai why a press was not taken', () => {
    assert.equal(errorText(new Error('reimbursement_resume_in_progress')), 'ระบบกำลังทำรายการของใบนี้อยู่ เปิดหน้านี้ใหม่อีกครั้ง');
    assert.equal(errorText(new Error('reimbursement_resume_not_allowed')), 'ผู้ที่กดทำต่อได้คือผู้อนุมัติใบนี้ หรือผู้มีสิทธิ์บันทึกจ่ายสำหรับใบที่ไม่ต้องอนุมัติ');
    assert.equal(errorText(new Error('stale_approval_snapshot')), 'ใบเบิกถูกแก้ไขหลังส่งอนุมัติ เปิดดูรายละเอียดใหม่ก่อนตัดสินใจ');
    for (const code of ['reimbursement_resume_in_progress', 'reimbursement_resume_not_allowed', 'reimbursement_resume_unavailable']) {
      assertPlainThai([errorText(new Error(code))], code);
    }
  });
});

// The status badge. A claim the system holds has not left its status yet, and the badge printed that status:
// "รออนุมัติ" on a claim already approved, "พร้อมจ่าย" on one being cancelled, beside an "อยู่ที่ ระบบ" line and
// a step note that said otherwise.
describe('the status badge of a claim the system holds reads รอระบบปรับสถานะ, like its อยู่ที่ line, its step note and LINE', () => {
  const hub = readFileSync(new URL('./ReimbursementsPages.tsx', import.meta.url), 'utf8');
  const approver = { userId: 'boss', permissions: APPROVER };
  const requester = { userId: 'staff', permissions: STAFF };
  const approvedWaiting = claim({ status: 'PENDING_APPROVAL', approvedAt: undefined, paymentStatus: 'NOT_PAYABLE', currentDesk: { kind: 'SYSTEM' },
    approvalActions: { canApprove: false, canReject: false }, awaitingSystem: { kind: 'APPROVAL', canResume: true } });
  const pending = { startedAt: '2026-10-01T02:00:00.000Z', startedByUserId: 'staff', startedByName: 'พิม ใจดี', reason: 'ซื้อซ้ำกับใบก่อน', canResume: true, canWithdraw: true };
  const cancellingAtPayment = claim({ currentDesk: { kind: 'SYSTEM' }, cancellationPending: true, pendingCancellation: pending });
  /** Every text on the page that is exactly this label: the badges, never a sentence that merely contains the words. */
  const exactly = (html: string, label: string) => visible(html).filter((text) => text === label).length;

  it('on the claim page: the header badge says what the อยู่ที่ line, the step note and the timeline say', () => {
    for (const viewer of [approver, requester]) {
      const html = claimPage(approvedWaiting, viewer);
      assert.equal(exactly(html, 'รออนุมัติ'), 0, 'approved already: nothing on the page says it waits for approval');
      assert.equal(exactly(html, REIMBURSEMENT_SYSTEM_WAIT_LABEL), 1, 'the header badge: the status is said once');
      // One state, in the shared words, in all four places.
      assert.deepEqual(deskLine(html), [`อยู่ที่ ${REIMBURSEMENT_DESK_LABELS.SYSTEM}`]);
      assert.ok(stepCard(html).note.includes(REIMBURSEMENT_SYSTEM_WAIT_LABEL));
      assert.equal(exactly(html, `กำลัง${REIMBURSEMENT_SYSTEM_WAIT_LABEL}`), 1, 'the timeline row');
    }
    const cancelling = claimPage(cancellingAtPayment, requester);
    assert.deepEqual([exactly(cancelling, 'พร้อมจ่าย'), exactly(cancelling, REIMBURSEMENT_SYSTEM_WAIT_LABEL)], [0, 1]);
    assert.ok(stepCard(cancelling).note.startsWith(`กำลังยกเลิกใบเบิก ${REIMBURSEMENT_SYSTEM_WAIT_LABEL}`));
  });

  it('keeps the status words of every claim that is with a person', () => {
    const waiting = claim({ status: 'PENDING_APPROVAL', approvedAt: undefined, currentDesk: { kind: 'APPROVER', names: ['สมศรี'] },
      approvalSteps: [{ id: 'step-1', sequenceNo: 1, status: 'PENDING', approverName: 'สมศรี' }] });
    assert.deepEqual([exactly(claimPage(waiting, requester), 'รออนุมัติ'), exactly(claimPage(waiting, requester), REIMBURSEMENT_SYSTEM_WAIT_LABEL)], [1, 0]);
    assert.equal(exactly(claimPage(claim(), requester), 'พร้อมจ่าย'), 1);
    // Nobody had to approve it and it cannot be paid yet: it is with whoever may record its payment, and keeps its status.
    const noApproval = claim({ status: 'APPROVED', approvalSteps: [], currentDesk: { kind: 'PAYMENT' }, awaitingSystem: { kind: 'NO_APPROVAL_NEEDED', canResume: false } });
    assert.deepEqual([exactly(claimPage(noApproval, requester), 'อนุมัติแล้ว'), exactly(claimPage(noApproval, requester), REIMBURSEMENT_SYSTEM_WAIT_LABEL)], [1, 0]);
    for (const [status, label] of [['DRAFT', 'ร่าง'], ['PENDING_APPROVAL', 'รออนุมัติ'], ['FINANCE_REVIEW', 'รอตรวจสอบการเงิน'], ['READY_FOR_PAYMENT', 'พร้อมจ่าย'], ['PAID', 'จ่ายแล้ว'], ['CANCELLED', 'ยกเลิกแล้ว']] as const) {
      assert.equal(claimStatusBadge({ status }).label, label);
      assert.equal(claimStatusBadge({ status, currentDesk: { kind: 'PAYMENT' } }).label, label);
    }
  });

  it('on every list and queue row: the badge reads the row\'s own desk, and the finance queue searches by the words it shows', () => {
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT']) {
      assert.deepEqual(claimStatusBadge({ status, currentDesk: { kind: 'SYSTEM' } }), { label: REIMBURSEMENT_SYSTEM_WAIT_LABEL, tone: 'amber' }, status);
    }
    // Each hands the badge the whole row: after the desk it reads the row's place in a payout round, with what the claim
    // holds and what was answered, which no single field of a row says.
    assert.equal(hub.match(/const status = claimListBadge\(row\)/g)?.length, 1, 'one badge builder for every queue');
    assert.equal(hub.match(/<ClaimQueueRows rows=\{pagedData\}/g)?.length, 3, 'all queues share it');
    assert.equal(hub.match(/badge\(row\)/g)?.length, 2, 'wide and phone rows');
    // By the words its row shows: the badge's, and the finance review's where the row says one.
    assert.match(hub, /claimStatusBadge\(r\)\.label,\s+financeLine\(r\)/);
  });
});

// A possible duplicate is one fact on every surface: the server's `duplicateBlocksPayment` on the claim and
// `hasDuplicateBlocker` on its pay-queue row are the payment's own test. The claim page read the status word for its
// finance approval instead, which after approval held the result of the claim's expense records.
describe('the claim page clears a duplicate block at the finance approval exactly when the server says the payment is blocked', () => {
  const underReview = (overrides: Record<string, unknown> = {}) => claim({
    status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING', financeReviewRequired: true, currentDesk: { kind: 'FINANCE' },
    duplicateStatus: 'POSSIBLE_DUPLICATE', duplicateCandidates: [{ id: 'd1', candidateType: 'AMOUNT_DATE_VENDOR', status: 'OPEN', score: 80 }], ...overrides,
  });
  const reviewer = { userId: 'accountant', permissions: ['reimbursement.read', 'reimbursement.finance_review'] };
  const resolver = { userId: 'finance', permissions: [...reviewer.permissions, 'reimbursement.duplicate.resolve'] };
  const sent = async (detail: object, viewer: typeof reviewer) => (await press(detail, viewer, 'อนุมัติจ่าย'))[0]?.body;

  it('a confirmed receipt gives cancellation guidance and never sends a finance duplicate override', async () => {
    const detail = underReview({ duplicateBlocksPayment: true, duplicateReasons: ['EXPENSE_CONFIRMED_DUPLICATE'] });
    for (const viewer of [reviewer, resolver]) {
      assert.deepEqual(await sent(detail, viewer), { decision: 'APPROVED_FOR_PAYMENT', resolveDuplicate: false });
      const text = visible(claimPage(detail, viewer)).join(' ');
      assert.match(text, /ใบเสร็จของใบเบิกนี้ได้รับการยืนยันว่าซ้ำ/);
      assert.match(text, /ผู้เบิกส่งใบเบิกใหม่โดยไม่ใส่รายการซ้ำ/);
      assert.doesNotMatch(text, /กดปลดรายการซ้ำ|ตรวจว่าไม่ซ้ำแล้ว/);
    }
  });

  // The status word is not the test: an answer that says the payment is blocked is followed whatever the word reads.
  it('sends the override with the approval for a blocked claim, and keeps the button off for a reviewer who may not clear it', async () => {
    for (const duplicateStatus of ['POSSIBLE_DUPLICATE', 'NO_MATCH']) {
      const blocked = underReview({ duplicateBlocksPayment: true, duplicateStatus });
      assert.deepEqual(await sent(blocked, resolver), { decision: 'APPROVED_FOR_PAYMENT', resolveDuplicate: true, duplicateResolutionReason: 'ตรวจสอบแล้วไม่ซ้ำ' }, duplicateStatus);
      assert.deepEqual(button(claimPage(blocked, reviewer), 'อนุมัติจ่าย'), { shown: true, disabled: true }, duplicateStatus);
      assert.ok(visible(claimPage(blocked, reviewer)).includes('รายการนี้อาจซ้ำ ต้องให้ผู้มีสิทธิ์แก้รายการซ้ำตรวจสอบ'), duplicateStatus);
    }
  });

  // A company whose policy only warns: the claim still reads as a possible duplicate, and nothing is blocked or cleared.
  it('sends no override, and holds nobody back, for a claim that reads as a possible duplicate and is not blocked', async () => {
    const warned = underReview({ duplicateBlocksPayment: false });
    for (const viewer of [reviewer, resolver]) {
      assert.deepEqual(await sent(warned, viewer), { decision: 'APPROVED_FOR_PAYMENT', resolveDuplicate: false });
      assert.deepEqual(button(claimPage(warned, viewer), 'อนุมัติจ่าย'), { shown: true, disabled: false });
    }
    assert.ok(visible(claimPage(warned, reviewer)).includes('อาจเป็นรายการซ้ำ ต้องตรวจสอบ'), 'the claim still says it may be a duplicate');
  });
});

// The signed form picked as the slip (upgrade test 2026-10-02). Nothing moves a file back out of a payment's slips, and
// the API refuses a declared copy unless the call carries the payer's confirmation. On the claim page that confirmation
// is the yes to a dialog that says so; a no sends nothing.
describe('moving a file of ใบเบิกที่เซ็นแล้ว to be the slip of a recorded payment', () => {
  const payer = { userId: 'owner', permissions: OWNER };
  const paidInCash = claim({
    status: 'PAID', paymentStatus: 'PAID', outstandingAmount: '0.0000', currentDesk: undefined,
    payments: [{ id: 'pay-1', paymentNo: 'RBPAY-202610-00003', status: 'RECORDED', paymentMethod: 'CASH', paidAmount: '500.0000', currency: 'THB',
      paidAt: '2026-10-01T05:00:00.000Z', paidByUserId: 'owner', paidByName: 'สมศรี', slipCount: 0, slips: [], viewerCanOpenSlips: true }],
    signedCopies: [{ attachmentId: 'att-copy', fileName: 'สลิปโอนเงิน.jpg', uploadedAt: '2026-10-01T06:00:00.000Z', acknowledgedAt: '2026-10-01T06:00:00.000Z', acknowledgedByName: 'พิม' }],
  });

  /** Presses the row's button and answers the page's confirm dialog: what the dialog asked, and what the page then sent. */
  async function pressAndAnswer(answer: boolean) {
    const realUseState = reactRuntime.useState;
    const asked: Array<{ title?: unknown; message?: unknown; confirmLabel?: unknown }> = [];
    Reflect.set(reactRuntime, 'useState', (initial: unknown) => {
      const [value, set] = (realUseState as (initial: unknown) => [unknown, (next: unknown) => void])(initial);
      return [value, (next: any) => { if (typeof next?.resolve === 'function') { asked.push(next); next.resolve(answer); } else set(next); }];
    });
    try { return { calls: await press(paidInCash, payer, 'ใช้ไฟล์นี้เป็นหลักฐานการจ่าย'), asked }; } finally { Reflect.set(reactRuntime, 'useState', realUseState); }
  }

  it('says before the yes that the file cannot be moved back and its declaration is withdrawn, and sends that yes with the call', async () => {
    const { calls, asked } = await pressAndAnswer(true);
    assert.deepEqual(asked.map((dialog) => [dialog.title, dialog.confirmLabel]), [['ใช้ไฟล์นี้เป็นหลักฐานการจ่าย', 'ย้ายเป็นหลักฐานการจ่าย']]);
    const message = String(asked[0]!.message);
    for (const part of ['ไฟล์ สลิปโอนเงิน.jpg จะย้ายจากรายการใบเบิกที่เซ็นแล้ว ไปเป็นหลักฐานการจ่าย RBPAY-202610-00003', 'ย้ายกลับไม่ได้', 'ระบบจะถอนการยืนยันนั้น']) {
      assert.ok(message.includes(part), `${part} in ${message}`);
    }
    assert.deepEqual(calls.filter((call) => call.method === 'POST'), [
      { url: '/api/v1/companies/company-1/reimbursements/claim-1/payments/pay-1/slips', method: 'POST', body: { attachmentId: 'att-copy', confirmSignedCopyWithdrawal: true } },
    ]);
    // A no sends nothing: the confirmation is never sent for the person.
    const refused = await pressAndAnswer(false);
    assert.deepEqual([refused.asked.length, refused.calls.filter((call) => call.method !== 'GET')], [1, []]);
  });
});

it('the duplicate-clear dialog covers source-document duplicates and confirmation retries', () => {
  const blocked = claim({ duplicateBlocksPayment: true, duplicateReasons: ['EXPENSE_DOCUMENT'] });
  const dialog = withDialog(blocked, { userId: 'owner', permissions: OWNER }, 'resolve-duplicate', 'ปลดรายการซ้ำ RB-202610-00007', 'คนละการซื้อ');
  const text = visible(dialog).join(' ');
  assert.match(text, /ระบบบันทึกชื่อคุณและเหตุผลนี้/);
  assert.doesNotMatch(text, /กดปลดรายการซ้ำอีกครั้ง/);
  assert.doesNotMatch(text, /ใบนี้ไม่ได้เบิกซ้ำกับใบเบิกอื่น/);
});

it('a confirmed duplicate shows cancellation throughout the page and offers no payout send-back', () => {
  const detail = claim({ payoutMethod: 'CASH', payout: { payoutKind: 'CASH', payoutMethod: 'CASH', version: 1 }, payoutCorrectionActions: { canRequest: true },
    duplicateBlocksPayment: true, duplicateReasons: ['EXPENSE_CONFIRMED_DUPLICATE'], paymentDesk: { names: ['สมศรี'] } });
  const viewer = { userId: 'owner', permissions: OWNER };
  const text = visible(claimPage(detail, viewer)).join(' ');
  assert.match(text, /รอยกเลิก/);
  assert.match(text, /อยู่ที่.*ผู้เบิกที่มีสิทธิ์ยกเลิกหรือผู้ตรวจการเงินที่ดูแลสาขา/);
  assert.match(text, /รอยกเลิกคำขอ เพราะใบเสร็จยืนยันว่าซ้ำ/);
  assert.doesNotMatch(text, /พร้อมจ่าย|กำลังรอ สมศรี บันทึกจ่าย|ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง/);
  const steps = buildJourneySteps(detail, OWNER, 'owner');
  assert.equal(steps.some(step => step.actions.includes('send-back')), false);
});


it('CLAIM-VOIDED-PROJ replaces an impossible payment with the explanation and existing cancel dialog', () => {
  const detail = claim({ hasVoidedProjections: true, payout: { payoutMethod: 'CASH', payoutKind: 'CASH', version: 1 }, payoutCorrectionActions: { canRequest: true } });
  const viewer = { userId: 'owner', permissions: OWNER };
  const html = claimPage(detail, viewer);
  const card = stepCard(html);
  const sentence = 'รายการค่าใช้จ่ายของใบเบิกนี้ถูกยกเลิกไปแล้ว จ่ายใบนี้ไม่ได้ ยกเลิกใบเบิกนี้แล้วทำใบใหม่';
  assert.equal(errorText(new Error('reimbursement_projection_voided')), sentence);
  assert.ok(visible(html).includes(sentence));
  const step = activeJourneyStep(buildJourneySteps(detail, OWNER, 'owner'))!;
  assert.equal(opensPaymentFormOnArrival(true, step), false, 'a queue pay link cannot open the form either');
  assert.ok(step.actions.includes('cancel'));
  assert.ok(!step.actions.includes('pay'));
  assert.ok(!step.actions.includes('send-back'));
  assert.ok(card.buttons.some(label => label.includes('ยกเลิกใบเบิก')));
  assert.ok(!card.buttons.some(label => label.startsWith('บันทึกจ่าย')));
  assert.doesNotMatch(visible(html).join(' '), /โอนตามบัญชี|จ่ายเงินสดให้ผู้เบิก/);
  const dialog = withDialog(detail, viewer, 'cancel', 'ยกเลิกใบเบิก RB-202610-00007', 'ทำใบเบิกใหม่แทนใบเดิม');
  assert.deepEqual(button(dialog, 'ยกเลิกใบเบิก'), { shown: true, disabled: false });
  assert.ok(visible(dialog).includes('ไม่ยกเลิก'));
});
