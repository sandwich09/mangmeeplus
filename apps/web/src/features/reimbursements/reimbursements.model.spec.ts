import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVAL_STEP_STATUS_LABELS,
  CURRENT_DESK_LABELS,
  currentDeskText,
  canVoidRecordedPayment,
  canUploadSignedCopy,
  claimSelfApproved,
  claimSignAction,
  claimSignatureSlots,
  reimbursementOwnActions,
  reimbursementSubmitReadiness,
  DUPLICATE_STATUS_LABELS,
  eligibleSignatureRoles,
  paymentDeskText,
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
  it('offers only ผู้เบิก and ผู้อนุมัติ on the two-signer form, or when the layout is not stated (D3)', () => {
    for (const claim of [detail(), detail({ claimFormLayout: 'TWO_SIGNERS' })]) {
      assert.deepEqual(eligibleSignatureRoles(claim, 'staff-1'), ['REQUESTER']);
      assert.deepEqual(eligibleSignatureRoles(claim, 'mgr-1'), ['APPROVER']);
      // They did their steps, but the form has no accounting or payer block — the API refuses those roles.
      assert.deepEqual(eligibleSignatureRoles(claim, 'acct-1'), []);
      assert.deepEqual(eligibleSignatureRoles(claim, 'fin-1'), []);
      assert.deepEqual(claimSignatureSlots(claim), ['REQUESTER', 'APPROVER']);
    }
  });

  it('offers each role to the actor that performed that step on a legacy four-block claim', () => {
    const legacy = detail({ claimFormLayout: 'LEGACY_FOUR_SIGNERS' });
    assert.deepEqual(eligibleSignatureRoles(legacy, 'staff-1'), ['REQUESTER']);
    assert.deepEqual(eligibleSignatureRoles(legacy, 'mgr-1'), ['APPROVER']);
    assert.deepEqual(eligibleSignatureRoles(legacy, 'acct-1'), ['FINANCE_REVIEW']);
    assert.deepEqual(eligibleSignatureRoles(legacy, 'fin-1'), ['PAYER']);
    assert.deepEqual(eligibleSignatureRoles(legacy, 'ghost-1'), [], 'a voided payment is not a payment');
    assert.deepEqual(eligibleSignatureRoles(legacy, 'stranger'), []);
    assert.deepEqual(claimSignatureSlots(legacy), ['REQUESTER', 'APPROVER', 'FINANCE_REVIEW', 'PAYER']);
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

describe('claimSignAction (one ลงนาม button)', () => {
  const solo = detail({
    requesterUserId: 'owner-1', financeReviewedByUserId: 'owner-1',
    approvalSteps: [{ status: 'APPROVED', decisionByUserId: 'owner-1', decidedAt: '2026-07-21T00:00:00.000Z' }],
    payments: [{ status: 'RECORDED', paidByUserId: 'owner-1', paidAt: '2026-07-23T00:00:00.000Z' }],
  });

  it('signs both blocks from one tap when the requester approved their own claim (AC06)', () => {
    assert.deepEqual(claimSignAction(solo, 'owner-1'), { roles: ['REQUESTER', 'APPROVER'], label: 'ลงนาม' });
    assert.equal(claimSelfApproved(solo), true);
    assert.equal(claimSelfApproved(detail()), false);
    // A legacy claim keeps every block that person really signed for.
    assert.deepEqual(claimSignAction({ ...solo, claimFormLayout: 'LEGACY_FOUR_SIGNERS' }, 'owner-1')?.roles, ['REQUESTER', 'APPROVER', 'FINANCE_REVIEW', 'PAYER']);
  });

  it('offers ลงนามใหม่ to a requester who signed before approving, now filling the approver block too (§15)', () => {
    const signedEarly = { ...solo, signatures: [{ role: 'REQUESTER', signedByUserId: 'owner-1' }] };
    assert.deepEqual(claimSignAction(signedEarly, 'owner-1'), { roles: ['REQUESTER', 'APPROVER'], label: 'ลงนามใหม่' });
    // Before the approval existed, only the requester block was open to them.
    assert.deepEqual(claimSignAction({ ...signedEarly, approvalSteps: [{ status: 'PENDING' }] }, 'owner-1'), { roles: ['REQUESTER'], label: 'ลงนามใหม่' });
  });

  it('offers no button to someone who signs no block', () => {
    assert.equal(claimSignAction(detail(), 'fin-1'), null);
    assert.equal(claimSignAction(detail({ status: 'DRAFT' }), 'staff-1'), null);
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

  it('labels every desk kind the server can answer with', () => {
    // SYSTEM: a claim whose decision is made and that the system has not finished moving on (audit B3, B4).
    assert.deepEqual(Object.keys(CURRENT_DESK_LABELS).sort(), ['REQUESTER', 'APPROVER', 'FINANCE', 'PAYMENT', 'SYSTEM'].sort());
  });
});

describe('currentDeskText', () => {
  it('names the assigned approvers, joined with หรือ', () => {
    assert.equal(currentDeskText({ kind: 'APPROVER', names: ['คุณยุนกิ'] }), 'คุณยุนกิ');
    assert.equal(currentDeskText({ kind: 'APPROVER', names: ['คุณยุนกิ', 'คุณสมชาย'] }), 'คุณยุนกิ หรือ คุณสมชาย');
  });

  it('falls back to the pool label, and stays silent on a terminal claim', () => {
    assert.equal(currentDeskText({ kind: 'APPROVER' }), 'ผู้มีสิทธิ์อนุมัติ');
    assert.equal(currentDeskText({ kind: 'REQUESTER' }), 'ผู้ยื่น');
    assert.equal(currentDeskText({ kind: 'FINANCE' }), 'ฝ่ายการเงิน');
    // Before: "ฝ่ายการเงิน (รอบันทึกจ่าย)", also for a shop with no finance desk (spec §18.3).
    assert.equal(currentDeskText({ kind: 'PAYMENT' }), 'ผู้มีสิทธิ์บันทึกจ่าย');
    assert.equal(currentDeskText(undefined), null);
    assert.equal(currentDeskText({ kind: 'SOMETHING_NEW' }), null);
  });

  it('names who can record the payment when the claim detail lists them', () => {
    const payment = { kind: 'PAYMENT' };
    assert.equal(currentDeskText(payment, { names: ['สมศรี'], moreCount: 0 }), 'สมศรี');
    assert.equal(currentDeskText(payment, { names: ['สมศรี', 'วิชัย'], moreCount: 2 }), 'สมศรี หรือ วิชัย และอีก 2 คน');
    assert.equal(paymentDeskText({ names: ['สมศรี', 'วิชัย'], moreCount: 0 }), 'สมศรี หรือ วิชัย');
    // Nobody listed, or a list row that carries no names: the pool.
    assert.equal(currentDeskText(payment, { names: [], moreCount: 0 }), 'ผู้มีสิทธิ์บันทึกจ่าย');
    assert.equal(paymentDeskText({ names: [], moreCount: 0 }), null);
    assert.equal(paymentDeskText(undefined), null);
    // The payers belong to the payment desk only.
    assert.equal(currentDeskText({ kind: 'APPROVER', names: ['คุณยุนกิ'] }, { names: ['สมศรี'], moreCount: 0 }), 'คุณยุนกิ');
    assert.equal(currentDeskText({ kind: 'FINANCE' }, { names: ['สมศรี'], moreCount: 0 }), 'ฝ่ายการเงิน');
  });
});
