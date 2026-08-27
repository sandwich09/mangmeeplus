import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVAL_STEP_STATUS_LABELS,
  canVoidRecordedPayment,
  canUploadSignedCopy,
  reimbursementOwnActions,
  reimbursementSubmitReadiness,
  DUPLICATE_STATUS_LABELS,
  eligibleSignatureRoles,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  RECEIPT_REQUIREMENT_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_TONES,
} from './reimbursements.model';

// Lane F: the drawer offers "ลงนาม" only where the session user really is the
// actor of that step. The server re-checks; this keeps the UI from lying.

const detail = (overrides: Record<string, unknown> = {}) => ({
  requestNo: 'RB-202607-00001',
  requesterUserId: 'staff-1',
  financeReviewStatus: 'APPROVED_FOR_PAYMENT',
  financeReviewedByUserId: 'acct-1',
  approvalSteps: [{ status: 'APPROVED', decisionByUserId: 'mgr-1', decidedAt: '2026-07-21T00:00:00.000Z' }],
  payments: [
    { status: 'VOIDED', paidByUserId: 'ghost-1', paidAt: '2026-07-24T00:00:00.000Z' },
    { status: 'RECORDED', paidByUserId: 'fin-1', paidAt: '2026-07-23T00:00:00.000Z' },
  ],
  ...overrides,
});

describe('eligibleSignatureRoles', () => {
  it('offers each role to the actor that performed that step', () => {
    assert.deepEqual(eligibleSignatureRoles(detail(), 'staff-1'), ['REQUESTER']);
    assert.deepEqual(eligibleSignatureRoles(detail(), 'mgr-1'), ['APPROVER']);
    assert.deepEqual(eligibleSignatureRoles(detail(), 'acct-1'), ['FINANCE_REVIEW']);
    assert.deepEqual(eligibleSignatureRoles(detail(), 'fin-1'), ['PAYER']);
    assert.deepEqual(eligibleSignatureRoles(detail(), 'ghost-1'), [], 'a voided payment is not a payment');
    assert.deepEqual(eligibleSignatureRoles(detail(), 'stranger'), []);
  });

  it('offers nothing on a draft or without a session user', () => {
    assert.deepEqual(eligibleSignatureRoles(detail({ requestNo: undefined }), 'staff-1'), []);
    assert.deepEqual(eligibleSignatureRoles(detail({ status: 'DRAFT' }), 'staff-1'), [], 'a corrected draft may keep its number but is still editable');
    assert.deepEqual(eligibleSignatureRoles(detail(), ''), []);
    assert.deepEqual(eligibleSignatureRoles(null, 'staff-1'), []);
  });

  it('uses the latest approved decision after a corrected request is resubmitted', () => {
    const corrected = detail({
      approvalSteps: [
        { status: 'APPROVED', decisionByUserId: 'old-manager', decidedAt: '2026-07-21T00:00:00.000Z' },
        { status: 'APPROVED', decisionByUserId: 'new-manager', decidedAt: '2026-07-25T00:00:00.000Z' },
      ],
    });
    assert.deepEqual(eligibleSignatureRoles(corrected, 'old-manager'), []);
    assert.deepEqual(eligibleSignatureRoles(corrected, 'new-manager'), ['APPROVER']);
  });

  it('offers nothing for steps that have not happened', () => {
    const pending = detail({
      approvalSteps: [{ status: 'PENDING' }],
      financeReviewStatus: 'PENDING', financeReviewedByUserId: undefined,
      payments: [],
    });
    assert.deepEqual(eligibleSignatureRoles(pending, 'mgr-1'), []);
    assert.deepEqual(eligibleSignatureRoles(pending, 'acct-1'), []);
    assert.deepEqual(eligibleSignatureRoles(pending, 'staff-1'), ['REQUESTER']);
  });

  it('treats a rejection and a blocked review as unsigned', () => {
    const blocked = detail({
      approvalSteps: [{ status: 'REJECTED', decisionByUserId: 'mgr-1', decidedAt: '2026-07-21T00:00:00.000Z' }],
      financeReviewStatus: 'BLOCKED',
    });
    assert.deepEqual(eligibleSignatureRoles(blocked, 'mgr-1'), []);
    assert.deepEqual(eligibleSignatureRoles(blocked, 'acct-1'), []);
  });
});

describe('canUploadSignedCopy', () => {
  it('allows the requester and finance/payment holders only', () => {
    assert.equal(canUploadSignedCopy(detail(), 'staff-1', []), true);
    assert.equal(canUploadSignedCopy(detail(), 'fin-1', ['reimbursement.finance_review']), true);
    assert.equal(canUploadSignedCopy(detail(), 'fin-1', ['reimbursement.payment.record']), true);
    assert.equal(canUploadSignedCopy(detail(), 'auditor-1', ['reimbursement.read']), false);
  });

  it('has nothing to attach before the claim has a document number', () => {
    assert.equal(canUploadSignedCopy(detail({ requestNo: undefined }), 'staff-1', ['reimbursement.finance_review']), false);
    assert.equal(canUploadSignedCopy(detail({ status: 'DRAFT' }), 'staff-1', ['reimbursement.finance_review']), false);
  });
});

describe('canVoidRecordedPayment', () => {
  it('requires both a recorded payment and the dedicated void permission', () => {
    assert.equal(canVoidRecordedPayment({ status: 'RECORDED' }, ['reimbursement.payment.void']), true);
    assert.equal(canVoidRecordedPayment({ status: 'RECORDED' }, ['reimbursement.payment.record']), false);
    assert.equal(canVoidRecordedPayment({ status: 'VOIDED' }, ['reimbursement.payment.void']), false);
  });
});

describe('reimbursementOwnActions', () => {
  it('never offers requester mutations to a related viewer', () => {
    assert.deepEqual(
      reimbursementOwnActions(
        detail({ status: 'DRAFT' }),
        'related-approver',
        ['reimbursement.read_related', 'reimbursement.update_own_draft', 'reimbursement.submit', 'reimbursement.cancel_own'],
      ),
      { canEditDraft: false, canSubmit: false, canCancel: false, canReopen: false },
    );
  });

  it('requires the requester, exact permission and current state for each action', () => {
    assert.deepEqual(
      reimbursementOwnActions(detail({ status: 'DRAFT' }), 'staff-1', [
        'reimbursement.update_own_draft', 'reimbursement.submit', 'reimbursement.cancel_own',
      ]),
      { canEditDraft: true, canSubmit: true, canCancel: true, canReopen: false },
    );
    assert.deepEqual(
      reimbursementOwnActions(detail({ status: 'PAID' }), 'staff-1', [
        'reimbursement.update_own_draft', 'reimbursement.submit', 'reimbursement.cancel_own',
      ]),
      { canEditDraft: false, canSubmit: false, canCancel: false, canReopen: false },
    );
  });

  it('offers reopen only to the requester of a rejected claim holding the draft-edit permission', () => {
    assert.deepEqual(
      reimbursementOwnActions(detail({ status: 'REJECTED' }), 'staff-1', ['reimbursement.update_own_draft']),
      { canEditDraft: false, canSubmit: false, canCancel: false, canReopen: true },
    );
    assert.equal(
      reimbursementOwnActions(detail({ status: 'REJECTED' }), 'related-approver', ['reimbursement.update_own_draft']).canReopen,
      false,
    );
    assert.equal(
      reimbursementOwnActions(detail({ status: 'REJECTED' }), 'staff-1', ['reimbursement.submit']).canReopen,
      false,
    );
  });

  it('lets finance cancel an in-scope workflow state without pretending to be the requester', () => {
    assert.equal(
      reimbursementOwnActions(detail({ status: 'READY_FOR_PAYMENT' }), 'finance-1', ['reimbursement.finance_review']).canCancel,
      true,
    );
    assert.equal(
      reimbursementOwnActions(detail({ status: 'PAID' }), 'finance-1', ['reimbursement.finance_review']).canCancel,
      false,
    );
  });
});

describe('reimbursementSubmitReadiness', () => {
  it('blocks an existing future-dated draft until corrected but leaves historical non-drafts alone', () => {
    const lines = [
      { lineNo: 1, incurredDate: '2026-08-27T00:00:00.000Z' },
      { lineNo: 2, incurredDate: '2026-08-28T00:00:00.000Z' },
    ];
    const request = detail({ status: 'DRAFT', receiptRequirementStatus: 'ATTACHED', lines });
    const future = reimbursementSubmitReadiness(request, '2026-08-27');
    assert.equal(future.blocked, true);
    assert.match(future.message ?? '', /รายการที่ 2: วันที่รายการเบิกต้องไม่เกินวันนี้/);
    assert.deepEqual(reimbursementSubmitReadiness({ ...request, status: 'APPROVED' }, '2026-08-27'), { blocked: false });
    lines[1]!.incurredDate = '2026-08-27T00:00:00.000Z';
    assert.deepEqual(reimbursementSubmitReadiness(request, '2026-08-27'), { blocked: false });
  });
  it('blocks a draft that still requires a receipt with policy-specific guidance', () => {
    const strict = reimbursementSubmitReadiness(detail({
      status: 'DRAFT', receiptRequirementStatus: 'REQUIRED', allowMissingReceiptWithReason: false,
    }));
    assert.equal(strict.blocked, true);
    assert.match(strict.message ?? '', /ต้องแนบใบเสร็จ/);
    assert.match(strict.message ?? '', /ไม่สามารถใช้แทน/);

    const reasonAllowed = reimbursementSubmitReadiness(detail({
      status: 'DRAFT', receiptRequirementStatus: 'REQUIRED', allowMissingReceiptWithReason: true,
    }));
    assert.match(reasonAllowed.message ?? '', /ระบุเหตุผล/);
  });

  it('does not block an evidenced draft or a request that already left draft', () => {
    assert.deepEqual(reimbursementSubmitReadiness(detail({ status: 'DRAFT', receiptRequirementStatus: 'ATTACHED' })), { blocked: false });
    assert.deepEqual(reimbursementSubmitReadiness(detail({ status: 'PENDING_APPROVAL', receiptRequirementStatus: 'REQUIRED' })), { blocked: false });
  });
});

describe('reimbursement status display maps', () => {
  it('gives every request and payment status a Mangmee tone', () => {
    assert.deepEqual(Object.keys(REQUEST_STATUS_TONES).sort(), Object.keys(REQUEST_STATUS_LABELS).sort());
    assert.deepEqual(Object.keys(PAYMENT_STATUS_TONES).sort(), Object.keys(PAYMENT_STATUS_LABELS).sort());
  });

  it('labels every receipt-requirement status', () => {
    assert.deepEqual(
      Object.keys(RECEIPT_REQUIREMENT_LABELS).sort(),
      ['REQUIRED', 'ATTACHED', 'MISSING_WITH_REASON', 'WAIVED_BY_POLICY'].sort(),
    );
  });

  it('labels every duplicate status', () => {
    assert.deepEqual(
      Object.keys(DUPLICATE_STATUS_LABELS).sort(),
      ['NOT_CHECKED', 'NO_MATCH', 'POSSIBLE_DUPLICATE', 'CONFIRMED_DUPLICATE', 'OVERRIDDEN'].sort(),
    );
  });

  it('labels every approval-step status', () => {
    assert.deepEqual(
      Object.keys(APPROVAL_STEP_STATUS_LABELS).sort(),
      ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'SKIPPED', 'EXPIRED'].sort(),
    );
  });
});
