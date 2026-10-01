import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { EXPENSE_VOID_REASON_MIN_LENGTH } from '@watchdog-bms/contracts';
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
function claimPage(detail: object, viewer: { userId: string; permissions: readonly string[] }, open?: { nullState: number; value: unknown; typed?: string }): string {
  let nulls = 0;
  return renderWithState(h(AppRouterContext.Provider, { value: router }, h(ToastContext.Provider, { value: toast },
    h(ReimbursementJourneyPage, { companyId: 'company-1', requestId: 'claim-1', userId: viewer.userId, permissions: viewer.permissions }))),
  (initial) => {
    if (initial === null) { nulls += 1; return nulls === 2 ? detail : open && nulls === open.nullState ? open.value : undefined; }
    return initial === '' && open?.typed !== undefined ? open.typed : undefined;
  });
}

/**
 * The page with one of its dialogs open, found by its title rather than by the position of its state hook: the
 * page keeps "which dialog is open" in a null state, and a hook added before it must not silently move this test.
 */
function withDialog(detail: object, viewer: { userId: string; permissions: readonly string[] }, value: unknown, title: string, typed = ''): string {
  for (let nullState = 3; nullState < 24; nullState += 1) {
    const html = claimPage(detail, viewer, { nullState, value, typed });
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
