import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SubstituteReceiptListItem } from '@watchdog-bms/contracts';
import { buildSubstituteReceiptHubModel, substituteReceiptHubStatus } from './substitute-receipt-hub.model';

function item(
  evidenceId: string,
  status: SubstituteReceiptListItem['status'],
  payerUserId: string,
  grandTotalAmount = '100',
  updatedAt = '2026-08-06T03:00:00.000Z',
): SubstituteReceiptListItem {
  return {
    evidenceId,
    expenseId: `expense-${evidenceId}`,
    documentNumber: `SRC-${evidenceId}`,
    version: 1,
    status,
    expenseNumber: null,
    expenseDate: '2026-08-01T00:00:00.000Z',
    paymentDate: null,
    payeeName: null,
    payeeAddress: null,
    payeeTaxId: null,
    currency: 'THB',
    grandTotalAmount,
    payerUserId,
    payerName: payerUserId,
    approverUserId: null,
    approverName: null,
    artifactAttachmentId: status === 'ISSUED' ? `artifact-${evidenceId}` : null,
    certifiedArtifactAttachmentId: null,
    updatedAt,
  };
}

const items = [
  item('sign-mine', 'PREPARED', 'me'),
  item('sign-other', 'PREPARED', 'other'),
  item('approve-mine', 'PAYER_CERTIFIED', 'me'),
  item('approve-other', 'PAYER_CERTIFIED', 'other'),
  item('issued-current', 'ISSUED', 'other', '1250.50'),
  item('issued-old', 'ISSUED', 'other', '999', '2026-07-31T23:59:59.000Z'),
  item('cancelled', 'SUPERSEDED', 'other'),
];

test('buckets work waiting on the current user in owner-self mode', () => {
  const model = buildSubstituteReceiptHubModel(items, {
    userId: 'me',
    canApprove: true,
    canSelfApprove: true,
    approvalMode: 'OWNER_SELF',
    currentYearMonth: '2026-08',
  });
  assert.deepEqual(model.waitingForSignature.map(({ evidenceId }) => evidenceId), ['sign-mine']);
  assert.deepEqual(model.waitingForApproval.map(({ evidenceId }) => evidenceId), ['approve-mine', 'approve-other']);
  assert.deepEqual({
    issued: model.issuedThisMonthCount,
    amount: model.issuedThisMonthAmount,
    signing: model.awaitingSignatureCount,
    approval: model.awaitingApprovalCount,
    cancelled: model.supersededCount,
  }, { issued: 1, amount: 1250.5, signing: 2, approval: 2, cancelled: 1 });
});

test('excludes self-approval outside owner-self mode and all approvals without permission', () => {
  const designated = buildSubstituteReceiptHubModel(items, {
    userId: 'me',
    canApprove: true,
    canSelfApprove: true,
    approvalMode: 'DESIGNATED_APPROVERS',
    currentYearMonth: '2026-08',
  });
  assert.deepEqual(designated.waitingForApproval.map(({ evidenceId }) => evidenceId), ['approve-other']);
  assert.equal(buildSubstituteReceiptHubModel(items, {
    userId: 'me',
    canApprove: false,
    canSelfApprove: true,
    approvalMode: 'OWNER_SELF',
    currentYearMonth: '2026-08',
  }).waitingForApproval.length, 0);
});

// The API restricts self-approval to OWNER/ADMIN/MANAGER roles. An unexempted payer with expense.confirm who saw
// their own certificate in "รอคุณอนุมัติ" would open it, sign, and be rejected at the last step.
test('never offers a non-owner their own certificate to approve, even in owner-self mode', () => {
  const nonOwner = buildSubstituteReceiptHubModel(items, {
    userId: 'me',
    canApprove: true,
    canSelfApprove: false,
    approvalMode: 'OWNER_SELF',
    currentYearMonth: '2026-08',
  });
  assert.deepEqual(nonOwner.waitingForApproval.map(({ evidenceId }) => evidenceId), ['approve-other']);
});

test('a row of the list has one status, and a paper certificate says which paper step it waits for', () => {
  const row = (status: SubstituteReceiptListItem['status'], extra: Partial<SubstituteReceiptListItem> = {}) =>
    substituteReceiptHubStatus({ ...item('row', status, 'someone'), ...extra });
  assert.equal(row('PREPARED'), 'waitingSignature');
  assert.equal(row('PREPARED', { signatureMode: 'PAPER', payerUserId: null }), 'waitingPaper');
  assert.equal(row('PREPARED', { signatureMode: 'PAPER', payerUserId: null, paperSubmission: {} as NonNullable<SubstituteReceiptListItem['paperSubmission']> }), 'waitingPaperReview');
  // A paper certificate whose signer is known is signed on screen like any other.
  assert.equal(row('PREPARED', { signatureMode: 'PAPER' }), 'waitingSignature');
  assert.equal(row('PAYER_CERTIFIED'), 'waitingApproval');
  assert.equal(row('ISSUED'), 'issued');
  assert.equal(row('SUPERSEDED'), 'cancelled');
});

import { SUBSTITUTE_RECEIPT_HUB_PAGE_SIZE, SUBSTITUTE_RECEIPT_HUB_TABS, substituteReceiptHubListState, substituteReceiptHubListQuery } from './substitute-receipt-hub.model';
test('hub tabs map to stored states and ten-row paging defaults safely', () => {
  assert.equal(SUBSTITUTE_RECEIPT_HUB_PAGE_SIZE, 10);
  assert.deepEqual(SUBSTITUTE_RECEIPT_HUB_TABS.map(tab => tab.key), ['', 'PREPARED', 'PAYER_CERTIFIED', 'ISSUED', 'SUPERSEDED']);
  assert.deepEqual(substituteReceiptHubListState(new URLSearchParams('page=-2&status=bad&yearMonth=2026-13&order=bad')), { page: 1, status: '', yearMonth: '', order: 'newest' });
});
test('hub URL restores status, month, date order and page without losing unrelated parameters', () => {
  const state = { page: 3, status: 'ISSUED' as const, yearMonth: '2026-10', order: 'oldest' as const };
  const query = new URLSearchParams(substituteReceiptHubListQuery(new URLSearchParams('keep=yes'), state));
  assert.deepEqual(substituteReceiptHubListState(query), state); assert.equal(query.get('keep'), 'yes');
  const cleared = new URLSearchParams(substituteReceiptHubListQuery(query, { ...state, status: '', yearMonth: '', page: 1 }));
  assert.equal(cleared.has('status'), false); assert.equal(cleared.has('yearMonth'), false);
});
