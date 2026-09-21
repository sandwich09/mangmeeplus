import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  paymentReferenceRequired, validatePaymentForm, validateRequestForm, sumLineAmounts, summariseQueue,
  matchesSearch, formatMoney, parseHubTab, visibleHubTabs, reimbursementListScope, errorMessage, errorText,
  isStaleApprovalError, diffApprovalFields, collectReceiptUploadResults, mergeDraftLineEvidence, withAssignedApprovalTab,
  buildClaimTimeline, buildJourneySteps, activeJourneyStep, policyDecisionPreview, isMissingSavedSignatureError,
} from './reimbursements.logic';

const line = (overrides: Record<string, unknown> = {}) => ({
  incurredDate: '2026-01-01', description: 'แท็กซี่', categoryKey: 'travel', amount: '100', hasReceipt: true, ...overrides,
});

describe('paymentReferenceRequired', () => {
  it('requires reference for bank transfer and cheque', () => {
    assert.equal(paymentReferenceRequired('BANK_TRANSFER'), true);
    assert.equal(paymentReferenceRequired('CHEQUE'), true);
    assert.equal(paymentReferenceRequired('CASH'), false);
  });
});

describe('isStaleApprovalError', () => {
  it('detects the raw stale code in API error messages', () => {
    assert.equal(isStaleApprovalError(new Error('stale_approval_snapshot')), true);
    assert.equal(isStaleApprovalError(new Error('other_code,stale_approval_snapshot')), true);
  });

  it('rejects unrelated errors and non-Error values without throwing', () => {
    assert.equal(isStaleApprovalError(new Error('other_code')), false);
    assert.equal(isStaleApprovalError('stale_approval_snapshot'), false);
    assert.equal(isStaleApprovalError(null), false);
    assert.equal(isStaleApprovalError(undefined), false);
  });
});

describe('diffApprovalFields', () => {
  const same = { reason: 'เดินทาง', amount: '123.00', currency: 'THB', categoryLabel: 'เดินทาง', lineCount: 1 };

  it('marks identical inputs as unchanged', () => {
    assert.equal(diffApprovalFields(same, same).every(row => !row.changed), true);
  });

  it('marks only a changed amount with the right before and after values', () => {
    const diff = diffApprovalFields(same, { ...same, amount: '456.00' });
    assert.deepEqual(diff.filter(row => row.changed), [{
      key: 'amount', label: 'จำนวนเงิน', before: '123.00', after: '456.00', changed: true,
    }]);
  });

  it('normalises null, undefined, and empty values to an unchanged dash', () => {
    const diff = diffApprovalFields(
      { reason: null, amount: undefined, currency: '' },
      { reason: undefined, amount: '', currency: null },
    );
    for (const key of ['reason', 'amount', 'currency']) {
      assert.deepEqual(diff.find(row => row.key === key), {
        key,
        label: key === 'reason' ? 'เหตุผล' : key === 'amount' ? 'จำนวนเงิน' : 'สกุลเงิน',
        before: '—',
        after: '—',
        changed: false,
      });
    }
  });

  it('marks a value appearing only after the edit as changed', () => {
    assert.deepEqual(
      diffApprovalFields({}, { categoryLabel: 'อาหาร' }).find(row => row.key === 'categoryLabel'),
      { key: 'categoryLabel', label: 'หมวด', before: '—', after: 'อาหาร', changed: true },
    );
  });
});

describe('validatePaymentForm', () => {
  const ok = { paidAmount: '500', outstandingAmount: '500', paymentMethod: 'CASH' };
  it('accepts full payment', () => {
    assert.equal(validatePaymentForm(ok), null);
  });
  it('rejects partial payment', () => {
    assert.ok(validatePaymentForm({ ...ok, paidAmount: '250' }));
  });
  it('rejects overpayment', () => {
    assert.ok(validatePaymentForm({ ...ok, paidAmount: '600' }));
  });
  it('requires reference for bank transfer', () => {
    assert.ok(validatePaymentForm({ ...ok, paymentMethod: 'BANK_TRANSFER' }));
    assert.equal(validatePaymentForm({ ...ok, paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-1' }), null);
  });
});

describe('validateRequestForm (multi-line claim)', () => {
  it('accepts past/today but identifies a future or malformed row without changing its value', () => {
    const rows = [line({ incurredDate: '2026-08-26' }), line({ incurredDate: '2026-08-27' })];
    assert.equal(validateRequestForm({ reason: 'r', lines: rows }, '2026-08-27'), null);
    rows[1]!.incurredDate = '2026-08-28';
    assert.match(validateRequestForm({ reason: 'r', lines: rows }, '2026-08-27') ?? '', /รายการที่ 2: วันที่รายการเบิกต้องไม่เกินวันนี้/);
    assert.equal(rows[1]!.incurredDate, '2026-08-28');
    rows[1]!.incurredDate = '2026-02-30';
    assert.match(validateRequestForm({ reason: 'r', lines: rows }, '2026-08-27') ?? '', /รายการที่ 2: กรุณาระบุวันที่รายการเบิกให้ถูกต้อง/);
  });
  it('accepts a claim with several complete rows', () => {
    assert.equal(validateRequestForm({ reason: 'r', lines: [line(), line({ amount: '50', description: 'ที่พัก' })] }), null);
  });
  it('requires a reason and at least one row', () => {
    assert.ok(validateRequestForm({ reason: '', lines: [line()] }));
    assert.ok(validateRequestForm({ reason: 'r', lines: [] }));
  });
  it('names the offending row', () => {
    assert.match(validateRequestForm({ reason: 'r', lines: [line(), line({ amount: '0' })] }) ?? '', /รายการที่ 2/);
    assert.match(validateRequestForm({ reason: 'r', lines: [line({ description: '  ' })] }) ?? '', /รายการที่ 1/);
    assert.match(validateRequestForm({ reason: 'r', lines: [line({ incurredDate: '' })] }) ?? '', /รายการที่ 1/);
  });
  it('caps a claim at 50 rows', () => {
    const rows = Array.from({ length: 51 }, () => line());
    assert.match(validateRequestForm({ reason: 'r', lines: rows }) ?? '', /50/);
  });
  // Mirrors the server's `missing_receipt_reason_required`: a receipt-less row becomes an
  // expense at ตรวจสอบการเงิน that only this reason can carry.
  it('requires the missing-receipt reason when a row has no receipt', () => {
    const rows = [line(), line({ hasReceipt: false })];
    assert.match(validateRequestForm({ reason: 'r', lines: rows }) ?? '', /เหตุผลที่ไม่มีใบเสร็จ/);
    assert.equal(validateRequestForm({ reason: 'r', missingReceiptReason: 'ใบเสร็จหาย', lines: rows }), null);
    assert.match(validateRequestForm({ reason: 'r', missingReceiptReason: '   ', lines: rows }) ?? '', /ใบเสร็จ/);
  });
  it('asks for no reason when every row carries a receipt', () => {
    assert.equal(validateRequestForm({ reason: 'r', lines: [line(), line()] }), null);
  });
});

describe('sumLineAmounts', () => {
  it('adds the typed rows and tolerates blanks', () => {
    assert.equal(sumLineAmounts([{ amount: '100.50' }, { amount: '49.5' }]), 150);
    assert.equal(sumLineAmounts([{ amount: '' }, { amount: 'abc' }]), 0);
  });
});

describe('collectReceiptUploadResults', () => {
  it('keeps successful attachment ids and names failed line numbers', () => {
    const failure = new Error('bad image');
    assert.deepEqual(collectReceiptUploadResults([
      { status: 'fulfilled', value: 'att-1' },
      { status: 'rejected', reason: failure },
      { status: 'fulfilled', value: null },
      { status: 'fulfilled', value: 'att-4' },
    ]), {
      attachmentIds: ['att-1', null, null, 'att-4'],
      failedLineNumbers: [2],
      firstFailure: failure,
    });
  });

  it('reports every failed line while retaining the first failure for copy', () => {
    const first = new Error('first');
    const summary = collectReceiptUploadResults([
      { status: 'rejected', reason: first },
      { status: 'fulfilled', value: 'att-2' },
      { status: 'rejected', reason: new Error('third') },
    ]);
    assert.deepEqual(summary.attachmentIds, [null, 'att-2', null]);
    assert.deepEqual(summary.failedLineNumbers, [1, 3]);
    assert.equal(summary.firstFailure, first);
  });
});

describe('mergeDraftLineEvidence', () => {
  it('retains current evidence when no replacement was uploaded', () => {
    assert.deepEqual(mergeDraftLineEvidence({ attachmentId: 'att-old' }), { attachmentId: 'att-old', linkedExpenseId: null });
    assert.deepEqual(mergeDraftLineEvidence({ linkedExpenseId: 'exp-1' }, null), { attachmentId: null, linkedExpenseId: 'exp-1' });
  });

  it('replaces current receipt or linked expense with the new attachment', () => {
    assert.deepEqual(
      mergeDraftLineEvidence({ attachmentId: 'att-old', linkedExpenseId: 'exp-1' }, 'att-new'),
      { attachmentId: 'att-new', linkedExpenseId: null },
    );
  });
});

describe('summariseQueue', () => {
  it('returns an all-zero summary for an empty queue', () => {
    assert.deepEqual(summariseQueue([]), { count: 0, totalAmount: 0, outstandingAmount: 0, flagged: 0 });
  });

  it('sums queue amounts and counts each flagged row once', () => {
    assert.deepEqual(
      summariseQueue([
        { amount: '100.50', outstandingAmount: 50, slaRisk: true },
        { amount: 200, outstandingAmount: '125.25', hasDuplicateBlocker: true },
        { amount: '30', outstandingAmount: '10', slaRisk: true, hasDuplicateBlocker: true },
      ]),
      { count: 3, totalAmount: 330.5, outstandingAmount: 185.25, flagged: 3 },
    );
  });

  it('treats missing and non-numeric amounts as zero', () => {
    const summary = summariseQueue([{ amount: 'not-a-number' }, { outstandingAmount: undefined }, {}]);
    assert.deepEqual(summary, { count: 3, totalAmount: 0, outstandingAmount: 0, flagged: 0 });
    assert.equal(Number.isNaN(summary.totalAmount), false);
    assert.equal(Number.isNaN(summary.outstandingAmount), false);
  });
});

describe('matchesSearch', () => {
  it('matches empty queries and single terms case-insensitively', () => {
    assert.equal(matchesSearch(['RB-202607', 'อนุมัติ'], ''), true);
    assert.equal(matchesSearch(['RB-202607', 'อนุมัติ'], '   '), true);
    assert.equal(matchesSearch(['RB-202607', 'อนุมัติ'], 'rb-202607'), true);
  });

  it('requires every search term to match', () => {
    assert.equal(matchesSearch(['RB-202607', 'อนุมัติแล้ว'], 'RB-202607 อนุมัติ'), true);
    assert.equal(matchesSearch(['RB-202607', 'รอดำเนินการ'], 'RB-202607 อนุมัติ'), false);
  });

  it('skips empty parts and makes numeric parts searchable', () => {
    assert.equal(matchesSearch([null, 'abc'], 'null'), false);
    assert.equal(matchesSearch([undefined, '', 'abc'], 'undefined'), false);
    assert.equal(matchesSearch([123], '12'), true);
  });
});

describe('parseHubTab', () => {
  it('honours every real tab from a deep link', () => {
    assert.equal(parseHubTab('approvals'), 'approvals');
    assert.equal(parseHubTab('finance'), 'finance');
    assert.equal(parseHubTab('policy'), 'policy');
    assert.equal(parseHubTab('mine'), 'mine');
  });
  it('falls back to the default tab for absent or unknown values', () => {
    assert.equal(parseHubTab(null), 'mine');
    assert.equal(parseHubTab(undefined), 'mine');
    assert.equal(parseHubTab(''), 'mine');
    assert.equal(parseHubTab('Approvals'), 'mine');
    assert.equal(parseHubTab('__proto__'), 'mine');
  });
});

describe('visibleHubTabs', () => {
  it('shows every tab to an owner-grade permission set', () => {
    assert.deepEqual(
      visibleHubTabs(
        ['reimbursement.read_own', 'reimbursement.approve', 'reimbursement.finance_review', 'reimbursement.policy.manage'],
        ['OWNER'],
      ),
      ['mine', 'approvals', 'finance', 'policy'],
    );
  });
  it('shows ตั้งค่านโยบาย to an admin with policy.manage', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.policy.manage'], ['ADMIN']), ['policy']);
  });
  it('shows ตั้งค่านโยบาย to any role that holds policy.manage', () => {
    assert.deepEqual(
      visibleHubTabs(
        ['reimbursement.read_own', 'reimbursement.finance_review', 'reimbursement.policy.manage'],
        ['FINANCE'],
      ),
      ['mine', 'finance', 'policy'],
    );
  });
  it('does not require a hard-coded role name for policy.manage', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.policy.manage'], []), ['policy']);
    assert.deepEqual(visibleHubTabs(['reimbursement.policy.manage']), ['policy']);
  });
  it('still requires policy.manage from an owner', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.read_own'], ['OWNER']), ['mine']);
  });
  it('shows the related-record tab with the view-only relation permission', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.read_related']), ['mine']);
  });
  it('hides ตั้งค่านโยบาย from a manager who only approves', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.read_own', 'reimbursement.approve']), ['mine', 'approvals']);
  });
  it('shows the decision queue to a reject-only custom role', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.reject']), ['approvals']);
  });
  it('requires policy.manage for ตั้งค่านโยบาย — read alone is not enough', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.policy.manage'], ['OWNER']), ['policy']);
    // FINANCE holds policy.read but not .manage, so it still cannot edit policy.
    assert.deepEqual(
      visibleHubTabs(['reimbursement.read_own', 'reimbursement.finance_review', 'reimbursement.policy.read'], ['FINANCE']),
      ['mine', 'finance'],
    );
  });
  it('shows nothing without a hub permission and accepts company-wide read', () => {
    assert.deepEqual(visibleHubTabs([]), []);
    assert.deepEqual(visibleHubTabs(['reimbursement.read', 'expense.read']), ['mine']);
  });
});

describe('withAssignedApprovalTab', () => {
  it('adds the frozen-task queue in the canonical position after server confirmation', () => {
    assert.deepEqual(withAssignedApprovalTab(['mine', 'finance', 'policy'], true), ['mine', 'approvals', 'finance', 'policy']);
    assert.deepEqual(withAssignedApprovalTab([], true), ['approvals']);
  });

  it('does not expose an empty approval queue or duplicate an authorized one', () => {
    assert.deepEqual(withAssignedApprovalTab(['mine'], false), ['mine']);
    assert.deepEqual(withAssignedApprovalTab(['mine', 'approvals'], true), ['mine', 'approvals']);
  });
});

describe('reimbursementListScope', () => {
  it('uses company-wide scope for reimbursement.read', () => {
    assert.equal(reimbursementListScope(['reimbursement.read', 'reimbursement.read_related']), undefined);
  });
  it('uses related before own and falls back to own', () => {
    assert.equal(reimbursementListScope(['reimbursement.read_related', 'reimbursement.read_own']), 'related');
    assert.equal(reimbursementListScope(['reimbursement.read_own']), 'own');
  });
});

describe('parseHubTab against the visible set', () => {
  it('honours a deep link the session can actually open', () => {
    assert.equal(parseHubTab('approvals', ['mine', 'approvals']), 'approvals');
  });
  it('falls back to the first VISIBLE tab, not always mine', () => {
    // A finance-only member deep-linked at ?tab=approvals must land on their own queue.
    assert.equal(parseHubTab('approvals', ['finance']), 'finance');
    assert.equal(parseHubTab(null, ['approvals', 'finance']), 'approvals');
    assert.equal(parseHubTab('policy', ['mine']), 'mine');
  });
  it('degrades to mine when nothing is visible', () => {
    assert.equal(parseHubTab('finance', []), 'mine');
  });
});

describe('errorMessage', () => {
  it('translates the API error codes the banners actually surface', () => {
    assert.match(errorMessage('missing_receipt'), /ใบเสร็จ/);
    assert.match(errorMessage('self_approval_denied'), /ตนเอง/);
    // Audit H-18: the refusal has to say the rule is a setting, and name the toggle the way the
    // settings page labels it, or the reader cannot find what to change.
    assert.match(errorMessage('self_approval_denied'), /การตั้งค่า/);
    assert.match(errorMessage('self_approval_denied'), /"อนุญาตให้อนุมัติคำขอตนเอง"/);
    assert.match(errorMessage('claim_form_requires_submitted'), /เลขที่เอกสาร/);
    for (const code of ['stale_approval_snapshot', 'expense_already_claimed', 'attachment_already_claimed',
      'duplicate_unresolved', 'partial_payment_not_allowed', 'missing_receipt_reason_required',
      'finance_approval_already_decided']) {
      assert.notEqual(errorMessage(code), code, `${code} must not reach the user raw`);
    }
  });
  it('translates each code of a comma-joined list', () => {
    const message = errorMessage('lines_required,amount_must_be_positive');
    assert.match(message, /1 รายการ/);
    assert.match(message, /มากกว่า 0/);
    assert.doesNotMatch(message, /lines_required|amount_must_be_positive/);
  });
  it('hides unreviewed API diagnostics behind the shared safe fallback', () => {
    for (const raw of ['brand_new_server_code', 'เกิดข้อผิดพลาด', 'Request failed (500)', '']) {
      assert.equal(errorMessage(raw), 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
  });
});

describe('errorText', () => {
  it('answers from the object code when the message is the synthetic API error text', () => {
    const denied = Object.assign(new Error('API error 403'), { status: 403, code: 'feature_not_enabled' });
    assert.equal(errorText(denied), 'ยังไม่ได้เปิดฟีเจอร์นี้');
    const domain = Object.assign(new Error('API error 400'), { status: 400, code: 'missing_receipt' });
    assert.match(errorText(domain), /ใบเสร็จ/);
  });
  it('falls back to message translation and the generic API copy', () => {
    assert.match(errorText(new Error('lines_required')), /1 รายการ/);
    assert.equal(errorText(undefined), 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง');
  });
});

describe('formatMoney', () => {
  it('formats to 2 decimals', () => {
    assert.equal(formatMoney('500'), '500.00');
    assert.equal(formatMoney('500', 'THB'), '500.00 บาท');
    assert.equal(formatMoney('500', 'USD'), '500.00 USD');
  });
});

describe('buildClaimTimeline', () => {
  const labels = (detail: any) => buildClaimTimeline(detail).map(row => `${row.state}:${row.label}`);

  it('waits on the requester while the claim is still a draft', () => {
    assert.deepEqual(labels({ status: 'DRAFT', currentDesk: { kind: 'REQUESTER' } }), [
      'current:รอผู้ยื่นส่งคำขอ',
      'future:รอฝ่ายการเงินตรวจ',
      'future:รอบันทึกจ่าย',
    ]);
  });

  it('marks the submitted and approved rows done and highlights the waiting approver', () => {
    const rows = buildClaimTimeline({
      status: 'PENDING_APPROVAL',
      submittedAt: '2026-08-20T03:00:00.000Z',
      currentDesk: { kind: 'APPROVER', names: ['คุณยุนกิ', 'คุณสมชาย'] },
      approvalSteps: [
        { id: 's1', sequenceNo: 1, status: 'APPROVED', decidedByName: 'คุณสมชาย', decidedAt: '2026-08-21T03:00:00.000Z' },
        { id: 's2', sequenceNo: 2, status: 'PENDING' },
      ],
    });
    assert.deepEqual(rows.map(r => `${r.state}:${r.label}`), [
      'done:ยื่นใบ',
      'done:อนุมัติโดย คุณสมชาย',
      'current:กำลังรอ คุณยุนกิ หรือ คุณสมชาย อนุมัติ',
      'future:รอฝ่ายการเงินตรวจ',
      'future:รอบันทึกจ่าย',
    ]);
    assert.equal(rows[0]?.date, '2026-08-20T03:00:00.000Z');
    assert.equal(rows[1]?.date, '2026-08-21T03:00:00.000Z');
  });

  it('skips invalidated approval steps', () => {
    const rows = labels({
      status: 'PENDING_APPROVAL',
      submittedAt: '2026-08-20T03:00:00.000Z',
      currentDesk: { kind: 'APPROVER' },
      approvalSteps: [
        { id: 's1', sequenceNo: 1, status: 'PENDING', invalidatedAt: '2026-08-21T03:00:00.000Z' },
        { id: 's2', sequenceNo: 2, status: 'PENDING' },
      ],
    });
    assert.deepEqual(rows.filter(row => row.startsWith('current')), ['current:กำลังรอ ผู้มีสิทธิ์อนุมัติ อนุมัติ']);
  });

  it('ends the journey at a rejection — no finance or payment row follows', () => {
    assert.deepEqual(labels({
      status: 'REJECTED',
      submittedAt: '2026-08-20T03:00:00.000Z',
      approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'REJECTED', decidedByName: 'คุณสมชาย', decidedAt: '2026-08-21T03:00:00.000Z' }],
    }), ['done:ยื่นใบ', 'done:ปฏิเสธโดย คุณสมชาย']);
  });

  it('ends a cancelled claim on its own terminal row', () => {
    assert.deepEqual(labels({ status: 'CANCELLED', submittedAt: '2026-08-20T03:00:00.000Z' }), ['done:ยื่นใบ', 'done:ยกเลิกคำขอ']);
  });

  it('drops the finance row when the policy path went straight to payment', () => {
    assert.deepEqual(labels({
      status: 'READY_FOR_PAYMENT',
      submittedAt: '2026-08-20T03:00:00.000Z',
      financeReviewStatus: 'NOT_REQUIRED',
      approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'APPROVED', decidedByName: 'คุณสมชาย' }],
    }), ['done:ยื่นใบ', 'done:อนุมัติโดย คุณสมชาย', 'current:กำลังรอฝ่ายการเงินบันทึกจ่าย']);
  });

  it('closes both finance and payment rows on a paid claim', () => {
    assert.deepEqual(labels({
      status: 'PAID',
      submittedAt: '2026-08-20T03:00:00.000Z',
      financeReviewStatus: 'APPROVED_FOR_PAYMENT',
      financeReviewedAt: '2026-08-22T03:00:00.000Z',
      financeReviewedByName: 'คุณมานี',
      payments: [{ status: 'RECORDED', paidByName: 'คุณมานี', paidAt: '2026-08-23T03:00:00.000Z' }],
    }), ['done:ยื่นใบ', 'done:ฝ่ายการเงินตรวจแล้ว โดย คุณมานี', 'done:จ่ายแล้ว โดย คุณมานี']);
  });
});

describe('buildClaimTimeline after a reopen', () => {
  it('keeps a refused round as history once the claim was fixed and resubmitted', () => {
    assert.deepEqual(buildClaimTimeline({
      status: 'READY_FOR_PAYMENT',
      submittedAt: '2026-08-25T03:00:00.000Z',
      financeReviewStatus: 'NOT_REQUIRED',
      approvalSteps: [
        { id: 's1', sequenceNo: 1, status: 'REJECTED', decidedByName: 'คุณสมชาย', decidedAt: '2026-08-21T03:00:00.000Z' },
        { id: 's2', sequenceNo: 1, status: 'APPROVED', decidedByName: 'คุณสมชาย', decidedAt: '2026-08-26T03:00:00.000Z' },
      ],
    }).map(row => `${row.state}:${row.label}`), [
      'done:ยื่นใบ', 'done:ปฏิเสธโดย คุณสมชาย', 'done:อนุมัติโดย คุณสมชาย', 'current:กำลังรอฝ่ายการเงินบันทึกจ่าย',
    ]);
  });
});

describe('isMissingSavedSignatureError', () => {
  it('recognises the saved-signature refusal by code or message only', () => {
    assert.equal(isMissingSavedSignatureError(Object.assign(new Error('API error 422'), { code: 'claim_saved_signature_required' })), true);
    assert.equal(isMissingSavedSignatureError(new Error('claim_saved_signature_required')), true);
    assert.equal(isMissingSavedSignatureError(new Error('stale_claim_snapshot')), false);
    assert.equal(isMissingSavedSignatureError(null), false);
  });
});

describe('buildJourneySteps', () => {
  const OWNER = ['reimbursement.read', 'reimbursement.create', 'reimbursement.submit', 'reimbursement.update_own_draft',
    'reimbursement.cancel_own', 'reimbursement.approve', 'reimbursement.reject', 'reimbursement.finance_review',
    'reimbursement.payment.record', 'reimbursement.payment.void'];
  const APPROVER = ['reimbursement.read_related', 'reimbursement.approve', 'reimbursement.reject'];
  const STAFF = ['reimbursement.read_own', 'reimbursement.create', 'reimbursement.submit', 'reimbursement.update_own_draft', 'reimbursement.cancel_own'];
  const FINANCE = ['reimbursement.read', 'reimbursement.finance_review', 'reimbursement.payment.record'];
  const claim = (overrides: Record<string, unknown> = {}) => ({
    id: 'r1', requestNo: 'RB-1', requesterUserId: 'staff', status: 'DRAFT', financeReviewStatus: 'NOT_REQUIRED',
    approvalSteps: [], payments: [], signatures: [], ...overrides,
  });
  const submitted = { submittedAt: '2026-09-20T03:00:00.000Z' };
  const approved = { ...submitted, approvedAt: '2026-09-20T04:00:00.000Z',
    approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'boss', decidedAt: '2026-09-20T04:00:00.000Z' }] };
  const shape = (detail: any, permissions: string[] = [], userId = 'someone') =>
    buildJourneySteps(detail, permissions, userId).map(step => `${step.key}:${step.state}`);
  const active = (detail: any, permissions: string[] = [], userId = 'someone') =>
    activeJourneyStep(buildJourneySteps(detail, permissions, userId))!;

  it('counts 4 steps without finance review and 5 when the claim went through it', () => {
    assert.deepEqual(shape(claim()), ['items:current', 'approval:upcoming', 'payment:upcoming', 'document:upcoming']);
    assert.deepEqual(shape(claim({ ...approved, status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' })),
      ['items:done', 'approval:done', 'finance:current', 'payment:upcoming', 'document:upcoming']);
    // Decided per claim: a paid claim that finance approved keeps its 5 steps, one that skipped it has 4.
    assert.equal(buildJourneySteps(claim({ ...approved, status: 'PAID', financeReviewStatus: 'APPROVED_FOR_PAYMENT' }), [], 'x').length, 5);
    assert.equal(buildJourneySteps(claim({ ...approved, status: 'PAID' }), [], 'x').length, 4);
    // A finance correction sends the claim back to a draft that will pass finance again.
    assert.equal(buildJourneySteps(claim({ financeReviewStatus: 'NEEDS_INFO' }), [], 'x').length, 5);
  });

  it('counts the finance step from the claim\'s own policy before approval', () => {
    const pending = claim({ ...submitted, status: 'PENDING_APPROVAL' });
    assert.deepEqual(shape({ ...pending, financeReviewRequired: true }),
      ['items:done', 'approval:current', 'finance:upcoming', 'payment:upcoming', 'document:upcoming']);
    assert.equal(buildJourneySteps({ ...pending, financeReviewRequired: false }, [], 'x').length, 4);
    assert.equal(buildJourneySteps(claim({ financeReviewRequired: true }), [], 'x').length, 5, 'a draft follows the current policy');
    // Once approved, the finance state the claim shows decides.
    assert.equal(buildJourneySteps(claim({ ...approved, status: 'READY_FOR_PAYMENT', financeReviewRequired: true }), [], 'x').length, 4);
  });

  it('finishes the document step once the paid claim is signed in the system or on paper (A4, AC17)', () => {
    const paid = claim({ ...approved, requesterUserId: 'owner', status: 'PAID', approvalSteps: [{ ...approved.approvalSteps[0], decisionByUserId: 'owner' }],
      payments: [{ id: 'p1', status: 'RECORDED', paidByUserId: 'owner', paidAt: '2026-09-20T06:00:00.000Z' }] });
    // Paid, not signed: the document step is where the claim stands, with sign, print and attach.
    const unsigned = active(paid, OWNER, 'owner');
    assert.deepEqual([unsigned.key, unsigned.state, unsigned.actions], ['document', 'current', ['sign', 'print', 'attach-signed-copy', 'void-payment']]);

    const paper = { ...paid, documentSignedVia: 'PAPER', signedCopies: [
      { attachmentId: 'a2', fileName: 'scan.jpg', uploadedAt: '2026-09-21T05:00:00.000Z' },
      { attachmentId: 'a1', fileName: 'signed.pdf', uploadedAt: '2026-09-21T04:00:00.000Z', acknowledgedAt: '2026-09-21T04:00:00.000Z', acknowledgedByName: 'คุณสมชาย' },
    ] };
    assert.deepEqual(shape(paper, OWNER, 'owner'), ['items:done', 'approval:done', 'payment:done', 'document:done']);
    // Every step done: the card stays on the document for a reprint, a newer copy or a void.
    const done = active(paper, OWNER, 'owner');
    assert.deepEqual([done.key, done.state, done.actions], ['document', 'done', ['print', 'attach-signed-copy', 'void-payment']]);
    assert.equal(done.note, 'ลงนามบนกระดาษ · แนบเมื่อ 21 ก.ย. 2569 โดย คุณสมชาย');
    assert.equal(active({ ...paper, documentSignedVia: 'BOTH', signedCopies: [] }, OWNER, 'owner').note, 'ลงนามบนกระดาษ');
    assert.equal(active({ ...paid, documentSignedVia: 'DIGITAL' }, OWNER, 'owner').note, 'ลงนามในระบบครบแล้ว');
  });

  it('leaves a document signed before payment upcoming while the claim waits at payment (§15)', () => {
    const ready = claim({ ...approved, status: 'READY_FOR_PAYMENT', documentSignedVia: 'PAPER' });
    assert.deepEqual(shape(ready, OWNER, 'owner'), ['items:done', 'approval:done', 'payment:current', 'document:upcoming']);
    assert.equal(active(ready, OWNER, 'owner').key, 'payment');
  });

  it('puts the current step where the claim stands for every live status', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ status: 'DRAFT' }, 'items:current'],
      [{ ...submitted, status: 'PENDING_APPROVAL' }, 'approval:current'],
      [{ ...approved, status: 'APPROVED', financeReviewStatus: 'PENDING' }, 'finance:current'],
      [{ ...approved, status: 'APPROVED' }, 'payment:current'],
      [{ ...approved, status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' }, 'finance:current'],
      [{ ...approved, status: 'READY_FOR_PAYMENT' }, 'payment:current'],
      [{ ...approved, status: 'READY_FOR_PAYMENT', financeReviewStatus: 'APPROVED_FOR_PAYMENT' }, 'payment:current'],
      [{ ...approved, status: 'PARTIALLY_PAID' }, 'payment:current'],
      [{ ...approved, status: 'PAID' }, 'document:current'],
      [{ ...submitted, status: 'REJECTED' }, 'approval:needs-fix'],
    ];
    for (const [overrides, expected] of cases) {
      const step = active(claim(overrides));
      assert.equal(`${step.key}:${step.state}`, expected, JSON.stringify(overrides));
    }
    // Everything before the current step is done, everything after it upcoming.
    assert.deepEqual(shape(claim({ ...approved, status: 'READY_FOR_PAYMENT', financeReviewStatus: 'APPROVED_FOR_PAYMENT' })),
      ['items:done', 'approval:done', 'finance:done', 'payment:current', 'document:upcoming']);
  });

  it('marks a refusal as step 2 to fix, with the reason and the reopen for the requester', () => {
    const rejected = claim({ ...submitted, status: 'REJECTED', rejectionReason: 'ยอดไม่ตรงใบเสร็จ',
      approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'REJECTED', decidedAt: '2026-09-20T05:00:00.000Z' }] });
    assert.deepEqual(shape(rejected, STAFF, 'staff'), ['items:done', 'approval:needs-fix', 'payment:upcoming', 'document:upcoming']);
    const step = active(rejected, STAFF, 'staff');
    assert.equal(step.note, 'ปฏิเสธ: ยอดไม่ตรงใบเสร็จ');
    assert.deepEqual(step.actions, ['reopen', 'print']);
    // Someone else reads the reason but cannot reopen the claim.
    assert.deepEqual(active(rejected, APPROVER, 'boss').actions, ['print']);
  });

  it('ends a cancelled or voided claim at the step where it happened', () => {
    const cancelled = (overrides: Record<string, unknown>) => claim({ status: 'CANCELLED', rejectionReason: 'ซื้อซ้ำ', ...overrides });
    assert.deepEqual(shape(cancelled({ requestNo: undefined })), ['items:ended']);
    assert.deepEqual(shape(cancelled(submitted)), ['items:done', 'approval:ended']);
    assert.deepEqual(shape(cancelled({ ...approved, financeReviewStatus: 'PENDING' })), ['items:done', 'approval:done', 'finance:ended']);
    assert.deepEqual(shape(cancelled(approved)), ['items:done', 'approval:done', 'payment:ended']);
    const step = active(cancelled(submitted), OWNER, 'staff');
    assert.equal(step.note, 'ยกเลิกคำขอแล้ว: ซื้อซ้ำ');
    assert.deepEqual(step.actions, ['print'], 'read-only: only the document can still be printed');
    assert.deepEqual(active(cancelled({ requestNo: undefined }), OWNER, 'staff').actions, []);
    assert.deepEqual(shape(claim({ ...approved, status: 'VOIDED' })), ['items:done', 'approval:done', 'payment:ended']);
    assert.equal(active(claim({ ...approved, status: 'VOIDED' })).note, 'เพิกถอนรายการแล้ว');
  });

  it('shows an auto-approved claim with step 2 passed by policy', () => {
    const auto = claim({ ...submitted, approvedAt: submitted.submittedAt, status: 'READY_FOR_PAYMENT' });
    const approval = buildJourneySteps(auto, [], 'x').find(step => step.key === 'approval')!;
    assert.deepEqual([approval.state, approval.note], ['done', 'ไม่ต้องอนุมัติตามนโยบาย']);
    const human = buildJourneySteps(claim({ ...approved, status: 'READY_FOR_PAYMENT' }), [], 'x').find(step => step.key === 'approval')!;
    assert.equal(human.note, undefined);
    // An approval from before a finance correction does not count for the resubmitted round.
    const resubmittedAuto = claim({ submittedAt: '2026-09-21T03:00:00.000Z', approvedAt: '2026-09-21T03:00:00.000Z', status: 'READY_FOR_PAYMENT',
      approvalSteps: approved.approvalSteps });
    assert.equal(buildJourneySteps(resubmittedAuto, [], 'x').find(step => step.key === 'approval')!.note, 'ไม่ต้องอนุมัติตามนโยบาย');
  });

  it('offers the solo owner submit, approve, then pay on the same page', () => {
    assert.deepEqual(active(claim({ requesterUserId: 'owner', requestNo: undefined }), OWNER, 'owner').actions, ['submit', 'edit', 'cancel']);
    const pending = claim({ ...submitted, requesterUserId: 'owner', status: 'PENDING_APPROVAL',
      approvalActions: { canApprove: true, canReject: true }, currentDesk: { kind: 'APPROVER', names: ['เจ้าของ'] } });
    assert.deepEqual(active(pending, OWNER, 'owner').actions, ['approve', 'reject', 'cancel', 'print']);
    assert.deepEqual(active(claim({ ...approved, requesterUserId: 'owner', status: 'READY_FOR_PAYMENT' }), OWNER, 'owner').actions, ['pay', 'cancel', 'print']);
    // AC03 path when finance review is off: the claim can still be APPROVED while its projection runs.
    assert.deepEqual(active(claim({ ...approved, requesterUserId: 'owner', status: 'APPROVED' }), OWNER, 'owner').actions, ['pay', 'cancel', 'print']);
    const paid = claim({ ...approved, requesterUserId: 'owner', status: 'PAID', approvalSteps: [{ ...approved.approvalSteps[0], decisionByUserId: 'owner' }],
      payments: [{ id: 'p1', status: 'RECORDED', paidByUserId: 'owner', paidAt: '2026-09-20T06:00:00.000Z' }] });
    assert.deepEqual(active(paid, OWNER, 'owner').actions, ['sign', 'print', 'attach-signed-copy', 'void-payment']);
    // Every role already signed: no sign prompt, printing leads.
    assert.deepEqual(active({ ...paid, signatures: ['REQUESTER', 'APPROVER', 'PAYER'].map(role => ({ role })) }, OWNER, 'owner').actions,
      ['print', 'attach-signed-copy', 'void-payment']);
  });

  it('takes approval buttons from the server-resolved task, not from the permission list', () => {
    const pending = claim({ ...submitted, status: 'PENDING_APPROVAL', currentDesk: { kind: 'APPROVER', names: ['คุณสมชาย'] } });
    const bystander = active({ ...pending, approvalActions: { canApprove: false, canReject: false } }, APPROVER, 'boss');
    assert.deepEqual(bystander.actions, ['print']);
    assert.equal(bystander.note, 'รอ คุณสมชาย อนุมัติ');
    const assignee = active({ ...pending, approvalActions: { canApprove: true, canReject: true } }, [], 'boss');
    assert.deepEqual(assignee.actions, ['approve', 'reject', 'print']);
  });

  it('opens payment to an approver who holds payment.record and says who it waits for otherwise', () => {
    const ready = claim({ ...approved, status: 'READY_FOR_PAYMENT' });
    const withPay = active(ready, [...APPROVER, 'reimbursement.payment.record'], 'boss');
    assert.deepEqual(withPay.actions, ['pay', 'print']);
    const withoutPay = active(ready, APPROVER, 'boss');
    assert.deepEqual(withoutPay.actions, ['print']);
    assert.equal(withoutPay.note, 'รอผู้มีสิทธิ์บันทึกจ่าย');
    assert.match(active({ ...ready, duplicateStatus: 'POSSIBLE_DUPLICATE' }, APPROVER, 'boss').note ?? '', /อาจเป็นรายการซ้ำ/);
    // A legacy partial payment cannot be topped up through this endpoint.
    assert.deepEqual(active(claim({ ...approved, status: 'PARTIALLY_PAID' }), OWNER, 'owner').actions, ['print']);
  });

  it('gives a staff requester only requester actions at every step (AC12)', () => {
    const requesterOnly = new Set(['submit', 'edit', 'cancel', 'reopen', 'print', 'sign', 'attach-signed-copy']);
    const statuses: Array<Record<string, unknown>> = [
      { status: 'DRAFT', requestNo: undefined },
      { ...submitted, status: 'PENDING_APPROVAL', approvalActions: { canApprove: false, canReject: false } },
      { ...approved, status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' },
      { ...approved, status: 'READY_FOR_PAYMENT' },
      { ...approved, status: 'PAID', payments: [{ id: 'p1', status: 'RECORDED', paidByUserId: 'fin', paidAt: '2026-09-20T06:00:00.000Z' }] },
    ];
    for (const overrides of statuses) {
      const step = active(claim(overrides), STAFF, 'staff');
      assert.ok(step.actions.every(action => requesterOnly.has(action)), `${overrides.status}: ${step.actions.join(',')}`);
    }
    assert.deepEqual(active(claim({ ...submitted, status: 'PENDING_APPROVAL', currentDesk: { kind: 'APPROVER' } }), STAFF, 'staff').actions, ['cancel', 'print']);
    assert.equal(active(claim({ ...approved, status: 'READY_FOR_PAYMENT' }), STAFF, 'staff').note, 'รอผู้มีสิทธิ์บันทึกจ่าย');
    // Somebody else's claim: read only.
    assert.deepEqual(active(claim({ ...submitted, status: 'PENDING_APPROVAL' }), STAFF, 'other').actions, ['print']);
  });

  it('gives finance review its three decisions only while the claim is at that desk', () => {
    const review = claim({ ...approved, status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' });
    assert.deepEqual(active(review, FINANCE, 'fin').actions, ['finance-approve', 'finance-return', 'finance-block', 'cancel', 'print']);
    // อนุมัติจ่าย already durable: only "continue" is left.
    assert.deepEqual(active({ ...review, financeReviewStatus: 'APPROVED_FOR_PAYMENT' }, FINANCE, 'fin').actions, ['finance-approve', 'cancel', 'print']);
    const blocked = active({ ...review, financeReviewStatus: 'BLOCKED', financeReviewNote: 'รอใบกำกับฉบับจริง' }, FINANCE, 'fin');
    assert.deepEqual(blocked.actions, ['finance-approve', 'finance-return', 'cancel', 'print']);
    assert.equal(blocked.note, 'ฝ่ายการเงินระงับการจ่าย: รอใบกำกับฉบับจริง');
    // Approved and still being routed to finance: nothing to decide yet.
    assert.deepEqual(active(claim({ ...approved, status: 'APPROVED', financeReviewStatus: 'PENDING' }), FINANCE, 'fin').actions, ['cancel', 'print']);
    assert.deepEqual(active(review, APPROVER, 'boss').actions, ['print']);
  });

  it('leads a finance correction with the edit and carries finance\'s note', () => {
    const corrected = active(claim({ financeReviewStatus: 'NEEDS_INFO', financeReviewNote: 'แนบใบเสร็จตัวจริง' }), STAFF, 'staff');
    assert.deepEqual(corrected.actions, ['edit', 'submit', 'cancel']);
    assert.equal(corrected.note, 'ฝ่ายการเงินขอให้แก้ไข: แนบใบเสร็จตัวจริง');
  });
});

describe('policyDecisionPreview', () => {
  it('reads the approver line with the owner fallback and goes straight to payment when finance review is off', () => {
    assert.deepEqual(policyDecisionPreview({ approvalRequiredFromAmount: '1', approverLabel: 'ผู้จัดการ', ownerRoute: false, financeReviewRequired: false }), [
      { title: 'ยอดตั้งแต่ 1.00 บาท', path: 'ผู้จัดการ (ถ้าไม่มี เจ้าของกิจการ) → จ่ายเงินคืน' },
      { title: 'ยอดต่ำกว่า 1.00 บาท', path: 'ไม่ต้องรอผู้อนุมัติ → จ่ายเงินคืน' },
    ]);
  });

  it('adds finance review to both paths when the switch is on', () => {
    const [from, below] = policyDecisionPreview({ approvalRequiredFromAmount: '500', approverLabel: 'ผู้จัดการ', ownerRoute: false, financeReviewRequired: true });
    assert.equal(from?.path, 'ผู้จัดการ (ถ้าไม่มี เจ้าของกิจการ) → ฝ่ายการเงินตรวจ → จ่ายเงินคืน');
    assert.equal(below?.path, 'ไม่ต้องรอผู้อนุมัติ → ฝ่ายการเงินตรวจ → จ่ายเงินคืน');
  });

  it('drops the fallback on the owner route and names a missing role generically', () => {
    assert.equal(policyDecisionPreview({ approvalRequiredFromAmount: '1', approverLabel: 'เจ้าของกิจการ', ownerRoute: true, financeReviewRequired: false })[0]?.path,
      'เจ้าของกิจการ → จ่ายเงินคืน');
    assert.equal(policyDecisionPreview({ approvalRequiredFromAmount: '1', approverLabel: '', ownerRoute: false, financeReviewRequired: false })[0]?.path,
      'บทบาทที่เลือก (ถ้าไม่มี เจ้าของกิจการ) → จ่ายเงินคืน');
  });
});
