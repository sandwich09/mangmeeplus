import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  requiresApproval,
  validateRequestFields,
  validateLines,
  computeClaimTotal,
  normalizeReimbursementAmount,
  deriveHeaderFromLines,
  computeSnapshotHash,
  computeLegacySnapshotHashV1,
  isExactLegacyV1FallbackSnapshot,
  isSelfApproval,
  canTransition,
  computeReceiptRequirement,
  validateRejectionReason,
  validatePaymentRecording,
  validatePaymentReference,
  isSamePaymentRequest,
  computeOutstanding,
  computePaymentStatus,
  scoreDuplicate,
  buildPaymentSourceRef,
  ageHours,
  isSlaRisk,
  redactPayload,
  frozenApprovalAuthority,
  currentDesk,
  type CurrentDeskStepFields,
} from './reimbursement.logic';
import { parseReimbursementPolicySnapshot } from '../reimbursement.constants';
import { reimbursementPaymentSlipRequired } from '@watchdog-bms/contracts';

/** A minimal valid line; overrides shape each case. */
function line(overrides: Partial<Parameters<typeof computeClaimTotal>[0][number]> & Record<string, unknown> = {}): any {
  return {
    lineNo: 1, incurredDate: '2026-01-01T00:00:00.000Z', description: 'Taxi',
    categoryKey: 'travel', amount: '100.00', ...overrides,
  };
}

describe('reimbursement threshold', () => {
  it('requires approval at exactly 1.00 by default', () => {
    assert.equal(requiresApproval('1.00', '1.00'), true);
    assert.equal(requiresApproval('1', '1.00'), true);
  });
  it('does not require approval below threshold', () => {
    assert.equal(requiresApproval('0.99', '1.00'), false);
  });
  it('is decimal-safe (0.1 + 0.2 boundary)', () => {
    assert.equal(requiresApproval('0.30', '0.30'), true);
    assert.equal(requiresApproval('0.29', '0.30'), false);
  });
});

describe('reimbursement incurred-date validation', () => {
  it('validates every ordered line and names malformed/future rows without mutating dates', () => {
    const lines = [line({ incurredDate: '2026-08-27' }), line({ lineNo: 2, incurredDate: new Date('2026-08-28T00:00:00Z') })];
    assert.deepEqual(validateLines(lines, '2026-08-27'), ['line_incurred_date_in_future:2']);
    assert.equal(lines[1].incurredDate.toISOString(), '2026-08-28T00:00:00.000Z');
    assert.deepEqual(validateLines([line({ incurredDate: '2026-02-30' })], '2026-08-27'), ['line_incurred_date_invalid:1']);
    assert.deepEqual(validateLines([line({ incurredDate: '2026-08-26' }), line({ lineNo: 2, incurredDate: '2026-08-27' })], '2026-08-27'), []);
  });
});

describe('frozen approval assignment', () => {
  it('keeps an active submitted assignee authoritative after their role changes', () => {
    assert.equal(frozenApprovalAuthority(['u-1', 'u-2'], new Set(['u-1', 'u-2']), 'u-1'), 'ASSIGNED');
    assert.equal(frozenApprovalAuthority(['u-1', 'u-2'], new Set(['u-1', 'u-2']), 'u-3'), 'DENIED');
  });

  it('uses role/OWNER recovery only when all frozen assignees are inactive or the step is legacy', () => {
    assert.equal(frozenApprovalAuthority(['u-1'], new Set(), 'owner-1'), 'FALLBACK');
    assert.equal(frozenApprovalAuthority(undefined, new Set(), 'owner-1'), 'FALLBACK');
  });
});

describe('reimbursement policy snapshot parser', () => {
  const valid = {
    schemaVersion: 1, policyId: 'policy-1', policyVersion: '2026-08-22T00:00:00.000Z',
    approvalRequiredFromAmount: '100.0000', requiresApproval: true,
    route: { mode: 'MANAGER_ROLE', roleKey: 'MANAGER', effectiveTaskRole: 'MANAGER', ownerFallbackUsedAtSubmission: false },
    allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: false,
    duplicatePolicy: 'BLOCK_PAYMENT', financeReviewRequired: true,
  } as const;

  it('accepts the exact V1 shape and treats null alone as legacy', () => {
    assert.equal(parseReimbursementPolicySnapshot(null), null);
    assert.equal(parseReimbursementPolicySnapshot(valid)?.policyId, 'policy-1');
  });

  it('fails closed on unknown fields, malformed money, or a route contradicting the threshold result', () => {
    assert.throws(() => parseReimbursementPolicySnapshot({ ...valid, internal: true }), /invalid_reimbursement_policy_snapshot/);
    assert.throws(() => parseReimbursementPolicySnapshot({ ...valid, approvalRequiredFromAmount: 'NaN' }), /invalid_reimbursement_policy_snapshot/);
    assert.throws(() => parseReimbursementPolicySnapshot({ ...valid, requiresApproval: false }), /invalid_reimbursement_policy_snapshot/);
  });
});

describe('request field validation', () => {
  it('flags a claim with no reason and no lines', () => {
    const errors = validateRequestFields({ reason: '', lines: [] });
    assert.deepEqual(errors.sort(), ['lines_required', 'reason_required']);
  });
  it('rejects a non-positive line amount', () => {
    const errors = validateRequestFields({ reason: 'r', lines: [line({ amount: '0' })] });
    assert.deepEqual(errors, ['line_amount_must_be_positive', 'amount_must_be_positive']);
  });
  it('passes a valid single-line claim', () => {
    assert.deepEqual(validateRequestFields({ reason: 'Taxi', lines: [line({ amount: '250.00' })] }), []);
  });
});

describe('line validation', () => {
  it('requires at least one line', () => {
    assert.deepEqual(validateLines([]), ['lines_required']);
    assert.deepEqual(validateLines(undefined), ['lines_required']);
  });
  it('caps a claim at 50 lines', () => {
    const fifty = Array.from({ length: 50 }, (_v, i) => line({ lineNo: i + 1 }));
    assert.deepEqual(validateLines(fifty), []);
    assert.ok(validateLines([...fifty, line({ lineNo: 51 })]).includes('too_many_lines'));
  });
  it('requires dense lineNo 1..N', () => {
    assert.ok(validateLines([line({ lineNo: 1 }), line({ lineNo: 3 })]).includes('line_no_not_dense'));
    assert.deepEqual(validateLines([line({ lineNo: 2 }), line({ lineNo: 1 })]), []); // order does not matter
  });
  it('requires a description and a positive amount on every line', () => {
    const errors = validateLines([line(), line({ lineNo: 2, description: '   ', amount: '-5' })]);
    assert.ok(errors.includes('line_description_required'));
    assert.ok(errors.includes('line_amount_must_be_positive'));
  });
});

describe('claim rollup', () => {
  it('sums line amounts decimal-safely', () => {
    assert.equal(computeClaimTotal([{ amount: '0.1' }, { amount: '0.2' }]), '0.3000');
    assert.equal(computeClaimTotal([{ amount: '100' }, { amount: '250.50' }, { amount: '0.25' }]), '350.7500');
  });
  it('normalizes each recorded line to satang without Number precision loss', () => {
    assert.equal(normalizeReimbursementAmount('0.0050'), '0.0100');
    assert.equal(normalizeReimbursementAmount('99999999999999.9900'), '99999999999999.9900');
    assert.equal(computeClaimTotal([{ amount: '0.0050' }, { amount: '0.0149' }]), '0.0200');
    assert.ok(validateLines([line({ amount: '0.0049' })]).includes('line_amount_must_be_positive'));
    assert.ok(validateLines([line({ amount: '99999999999999.9999' })]).includes('amount_exceeds_limit'));
  });
  it('derives the header from a single-category claim', () => {
    const header = deriveHeaderFromLines([
      line({ lineNo: 1, amount: '100', categoryKey: 'travel', categoryLabel: 'เดินทาง', incurredDate: '2026-02-05T00:00:00.000Z' }),
      line({ lineNo: 2, amount: '50', categoryKey: 'travel', categoryLabel: 'เดินทาง', incurredDate: '2026-02-01T00:00:00.000Z' }),
    ]);
    assert.equal(header.amount, '150.0000');
    assert.equal(header.categoryKey, 'travel');
    assert.equal(header.categoryLabelSnapshot, 'เดินทาง');
    // Earliest line date, not line 1's date.
    assert.equal(header.incurredDate.toISOString(), '2026-02-01T00:00:00.000Z');
  });
  it('labels a mixed-category claim with line 1 key and a หลายหมวด label', () => {
    const header = deriveHeaderFromLines([
      line({ lineNo: 1, amount: '100', categoryKey: 'travel', categoryLabel: 'เดินทาง' }),
      line({ lineNo: 2, amount: '40', categoryKey: 'meals', categoryLabel: 'อาหาร' }),
      line({ lineNo: 3, amount: '10', categoryKey: 'supplies' }),
    ]);
    assert.equal(header.categoryKey, 'travel');
    assert.equal(header.categoryLabelSnapshot, 'หลายหมวด (3 รายการ)');
    assert.equal(header.amount, '150.0000');
  });
});

describe('snapshot hash', () => {
  const base = { amount: '100.00', currency: 'THB', categoryKey: 'travel', incurredDate: '2026-01-01', reason: 'Taxi' };
  it('is stable for identical fields', () => {
    assert.equal(computeSnapshotHash(base), computeSnapshotHash({ ...base }));
  });
  it('changes when amount changes', () => {
    assert.notEqual(computeSnapshotHash(base), computeSnapshotHash({ ...base, amount: '100.01' }));
  });
  it('changes when category/reason/attachment changes', () => {
    assert.notEqual(computeSnapshotHash(base), computeSnapshotHash({ ...base, categoryKey: 'meals' }));
    assert.notEqual(computeSnapshotHash(base), computeSnapshotHash({ ...base, reason: 'Bus' }));
    assert.notEqual(computeSnapshotHash(base), computeSnapshotHash({ ...base, primaryAttachmentId: 'att-1' }));
  });
  it('treats 100 and 100.0000 as equal', () => {
    assert.equal(computeSnapshotHash({ ...base, amount: '100' }), computeSnapshotHash({ ...base, amount: '100.0000' }));
  });

  const withLines = {
    ...base,
    lines: [line({ lineNo: 1, amount: '60' }), line({ lineNo: 2, amount: '40', description: 'Hotel' })],
  };
  it('changes when any line field changes (a line edit invalidates a pending approval)', () => {
    const stable = computeSnapshotHash(withLines);
    for (const patch of [
      { amount: '61' }, { categoryKey: 'meals' }, { incurredDate: '2026-03-03T00:00:00.000Z' },
      { description: 'Bus' }, { purpose: 'client visit' }, { attachmentId: 'att-9' }, { linkedExpenseId: 'exp-9' },
    ]) {
      const edited = { ...withLines, lines: [{ ...withLines.lines[0], ...patch }, withLines.lines[1]] };
      assert.notEqual(computeSnapshotHash(edited), stable, `edit ${JSON.stringify(patch)} must change the hash`);
    }
  });
  it('is order-independent (folds lines in lineNo order)', () => {
    const reversed = { ...withLines, lines: [withLines.lines[1], withLines.lines[0]] };
    assert.equal(computeSnapshotHash(reversed), computeSnapshotHash(withLines));
  });
  it('changes when a line is added or removed', () => {
    assert.notEqual(computeSnapshotHash({ ...withLines, lines: [withLines.lines[0]] }), computeSnapshotHash(withLines));
  });

  it('recognizes only the exact deterministic fallback for a production v1 hash', () => {
    const request = {
      requestId: 'rb-legacy', companyId: 'co-1', title: '  Taxi receipt  ',
      amount: '100.00', currency: 'THB', categoryKey: 'travel', categoryLabelSnapshot: 'เดินทาง',
      incurredDate: '2026-01-01T00:00:00.000Z', reason: 'Fallback reason',
      primaryAttachmentId: 'att-1', linkedExpenseId: null,
      lines: [{
        id: 'rbl_rb-legacy', companyId: 'co-1', reimbursementRequestId: 'rb-legacy', lineNo: 1,
        incurredDate: '2026-01-01T00:00:00.000Z', description: 'Taxi receipt', purpose: null,
        categoryKey: 'travel', categoryLabelSnapshot: 'เดินทาง', amount: '100.0000',
        attachmentId: 'att-1', linkedExpenseId: null,
      }],
    };
    const legacyHash = computeLegacySnapshotHashV1(request);
    assert.equal(isExactLegacyV1FallbackSnapshot(request, legacyHash), true);
    assert.notEqual(computeSnapshotHash(request), legacyHash);

    for (const changed of [
      { ...request, lines: [{ ...request.lines[0], id: 'rbl_other' }] },
      { ...request, lines: [{ ...request.lines[0], description: 'Bus receipt' }] },
      { ...request, lines: [{ ...request.lines[0], purpose: 'edited' }] },
      { ...request, lines: [{ ...request.lines[0], amount: '100.01' }] },
      { ...request, lines: [{ ...request.lines[0], companyId: 'co-other' }] },
      { ...request, lines: [{ ...request.lines[0], reimbursementRequestId: 'rb-other' }] },
      { ...request, lines: [{ ...request.lines[0], incurredDate: '2026-01-02T00:00:00.000Z' }] },
      { ...request, lines: [{ ...request.lines[0], categoryKey: 'meal' }] },
      { ...request, lines: [{ ...request.lines[0], categoryLabelSnapshot: 'อาหาร' }] },
      { ...request, lines: [{ ...request.lines[0], attachmentId: 'att-2' }] },
      { ...request, primaryAttachmentId: null, lines: [{ ...request.lines[0], attachmentId: '' }] },
      { ...request, lines: [{ ...request.lines[0], linkedExpenseId: 'exp-1' }] },
      { ...request, lines: [...request.lines, { ...request.lines[0], lineNo: 2 }] },
    ]) {
      assert.equal(isExactLegacyV1FallbackSnapshot(changed, legacyHash), false);
    }
    assert.equal(isExactLegacyV1FallbackSnapshot(request, '0'.repeat(32)), false);
  });

  it('matches PostgreSQL btrim ASCII-space semantics for untouched legacy text', () => {
    for (const title of ['\tTaxi\t', '\u00a0Taxi\u00a0']) {
      const requestId = `rb-${title.charCodeAt(0)}`;
      const request = {
        requestId, companyId: 'co-1', title,
        amount: '100.00', currency: 'THB', categoryKey: 'travel', categoryLabelSnapshot: null,
        incurredDate: '2026-01-01T00:00:00.000Z', reason: 'Fallback reason',
        primaryAttachmentId: null, linkedExpenseId: null,
        lines: [{
          id: `rbl_${requestId}`, companyId: 'co-1', reimbursementRequestId: requestId,
          lineNo: 1, incurredDate: '2026-01-01T00:00:00.000Z', description: title, purpose: null,
          categoryKey: 'travel', categoryLabelSnapshot: null, amount: '100.0000',
          attachmentId: null, linkedExpenseId: null,
        }],
      };
      assert.equal(isExactLegacyV1FallbackSnapshot(request, computeLegacySnapshotHashV1(request)), true);
    }
  });
});

describe('self-approval guard', () => {
  it('blocks requester approving own request', () => {
    assert.equal(isSelfApproval('u1', 'u1', false), true);
  });
  it('allows different approver', () => {
    assert.equal(isSelfApproval('u1', 'u2', false), false);
  });
  it('respects allowSelfApproval policy', () => {
    assert.equal(isSelfApproval('u1', 'u1', true), false);
  });
});

describe('status transitions', () => {
  it('allows draft -> pending', () => {
    assert.equal(canTransition('DRAFT', 'PENDING_APPROVAL'), true);
  });
  it('blocks paid -> draft', () => {
    assert.equal(canTransition('PAID', 'DRAFT'), false);
  });
  it('blocks rejected -> approved', () => {
    assert.equal(canTransition('REJECTED', 'APPROVED'), false);
  });
});

describe('receipt requirement (per line)', () => {
  const strict = { requireReceipt: true, allowMissingReceiptWithReason: false };
  it('attaches when every line carries evidence (attachment or linked expense)', () => {
    const lines = [line({ lineNo: 1, attachmentId: 'att-1' }), line({ lineNo: 2, linkedExpenseId: 'exp-1' })];
    assert.equal(computeReceiptRequirement({ ...strict, lines }).status, 'ATTACHED');
  });
  it('blocks when ONE line of many is missing evidence', () => {
    const lines = [line({ lineNo: 1, attachmentId: 'att-1' }), line({ lineNo: 2 })];
    const r = computeReceiptRequirement({ ...strict, lines });
    assert.equal(r.status, 'REQUIRED');
    assert.equal(r.error, 'missing_receipt');
  });
  it('lets one claim-level reason cover several gaps when policy permits', () => {
    const lines = [line({ lineNo: 1 }), line({ lineNo: 2 })];
    const r = computeReceiptRequirement({ requireReceipt: true, allowMissingReceiptWithReason: true, lines, missingReceiptReason: 'lost' });
    assert.equal(r.status, 'MISSING_WITH_REASON');
  });
  it('waives when receipt not required', () => {
    assert.equal(computeReceiptRequirement({ requireReceipt: false, allowMissingReceiptWithReason: false, lines: [line()] }).status, 'WAIVED_BY_POLICY');
  });
});

describe('rejection reason', () => {
  it('requires non-empty reason', () => {
    assert.equal(validateRejectionReason(''), false);
    assert.equal(validateRejectionReason('   '), false);
    assert.equal(validateRejectionReason('duplicate'), true);
  });
});

describe('payment recording (MVP full-payment)', () => {
  const base = {
    status: 'READY_FOR_PAYMENT' as const,
    financeReviewRequired: true,
    financeReviewApproved: true,
    duplicateBlocking: false,
    approvedAmount: '500.00',
    outstandingAmount: '500.00',
    paidAmount: '500.00',
    paymentMethod: 'CASH' as const,
    hasSlip: false,
  };
  it('accepts a full payment', () => {
    assert.equal(validatePaymentRecording(base), null);
  });
  it('rejects unapproved status', () => {
    assert.equal(validatePaymentRecording({ ...base, status: 'PENDING_APPROVAL' }), 'invalid_status_transition');
  });
  it('rejects when finance review not done', () => {
    assert.equal(validatePaymentRecording({ ...base, financeReviewApproved: false }), 'finance_review_required');
  });
  it('rejects duplicate blocker', () => {
    assert.equal(validatePaymentRecording({ ...base, duplicateBlocking: true }), 'duplicate_unresolved');
  });
  it('rejects overpayment', () => {
    assert.equal(validatePaymentRecording({ ...base, paidAmount: '500.01' }), 'payment_over_approved_amount');
  });
  it('rejects underpayment/partial', () => {
    assert.equal(validatePaymentRecording({ ...base, paidAmount: '250.00' }), 'partial_payment_not_allowed');
  });
  // FIN-01: a legacy 4dp claim can only be paid at the satang figure the UI prints.
  it('accepts the displayed satang amount of a legacy 4dp claim', () => {
    const legacy = { ...base, approvedAmount: '580.0042', outstandingAmount: '580.0042' };
    assert.equal(validatePaymentRecording({ ...legacy, paidAmount: '580.00' }), null);
    // …and the same claim when the residue rounds the printed figure up instead.
    const roundsUp = { ...base, approvedAmount: '580.0058', outstandingAmount: '580.0058' };
    assert.equal(validatePaymentRecording({ ...roundsUp, paidAmount: '580.01' }), null);
  });
  it('still rejects a real satang shortfall or overpayment on a 4dp claim', () => {
    const legacy = { ...base, approvedAmount: '580.0042', outstandingAmount: '580.0042' };
    assert.equal(validatePaymentRecording({ ...legacy, paidAmount: '579.99' }), 'partial_payment_not_allowed');
    assert.equal(validatePaymentRecording({ ...legacy, paidAmount: '580.01' }), 'payment_over_approved_amount');
  });
  it('requires reference for bank transfer', () => {
    assert.equal(validatePaymentRecording({ ...base, paymentMethod: 'BANK_TRANSFER' }), 'payment_reference_required');
    assert.equal(validatePaymentRecording({ ...base, paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-1', hasSlip: true }), null);
  });

  // Owner decision 2026-10-01 (D3): a transfer is recorded with its slip; every other method may carry one.
  it('requires a slip for a bank transfer and for no other method', () => {
    const transfer = { ...base, paymentMethod: 'BANK_TRANSFER' as const, paymentReference: 'TXN-1' };
    assert.equal(validatePaymentRecording(transfer), 'payment_slip_required');
    assert.equal(validatePaymentRecording({ ...transfer, hasSlip: true }), null);
    for (const [paymentMethod, paymentReference] of [['CASH', undefined], ['CHEQUE', 'CHQ-1'], ['OTHER', undefined]] as const) {
      assert.equal(validatePaymentRecording({ ...base, paymentMethod, paymentReference }), null, `${paymentMethod} without a slip`);
      assert.equal(validatePaymentRecording({ ...base, paymentMethod, paymentReference, hasSlip: true }), null, `${paymentMethod} with a slip`);
    }
    assert.equal(reimbursementPaymentSlipRequired('BANK_TRANSFER'), true);
    for (const method of ['CASH', 'CHEQUE', 'OTHER', '']) assert.equal(reimbursementPaymentSlipRequired(method), false, method);
  });

  it('keeps the earlier refusals ahead of the slip rule, so a claim that cannot be paid says why', () => {
    const transfer = { ...base, paymentMethod: 'BANK_TRANSFER' as const, paymentReference: 'TXN-1' };
    assert.equal(validatePaymentRecording({ ...transfer, status: 'PENDING_APPROVAL' }), 'invalid_status_transition');
    assert.equal(validatePaymentRecording({ ...transfer, paidAmount: '250.00' }), 'partial_payment_not_allowed');
  });
});

describe('payment replay (spec §12.7)', () => {
  const paidAt = new Date('2026-02-01T00:00:00.000Z');
  const recorded = {
    paidAmount: '500.0000', currency: 'THB', paymentMethod: 'BANK_TRANSFER', paidAt,
    paymentReference: 'TXN-1', bankAccountId: null, slipAttachmentId: 'att-slip-1',
  };
  const request = {
    paidAmount: '500.00', currency: 'THB', paymentMethod: 'BANK_TRANSFER', paidAt: new Date(paidAt),
    paymentReference: 'TXN-1', slipAttachmentId: 'att-slip-1',
  };

  it('is the same payment only when every fact matches, the slip included', () => {
    assert.equal(isSamePaymentRequest(recorded, request), true);
    assert.equal(isSamePaymentRequest(recorded, { ...request, slipAttachmentId: 'att-slip-2' }), false, 'a different slip');
    assert.equal(isSamePaymentRequest(recorded, { ...request, slipAttachmentId: undefined }), false, 'the slip dropped');
    assert.equal(isSamePaymentRequest({ ...recorded, slipAttachmentId: null }, request), false, 'a slip added');
    assert.equal(isSamePaymentRequest(recorded, { ...request, paymentReference: 'TXN-2' }), false);
    assert.equal(isSamePaymentRequest(recorded, { ...request, paymentMethod: 'CASH' }), false);
    assert.equal(isSamePaymentRequest(recorded, { ...request, paidAmount: '500.01' }), false);
    assert.equal(isSamePaymentRequest(recorded, { ...request, paidAt: new Date('2026-02-02T00:00:00.000Z') }), false);
  });

  it('reads a stored null and an omitted field as the same absence', () => {
    const cash = { paidAmount: '500.0000', currency: 'THB', paymentMethod: 'CASH', paidAt, paymentReference: null, bankAccountId: null, slipAttachmentId: null };
    assert.equal(isSamePaymentRequest(cash, { paidAmount: '500', currency: 'THB', paymentMethod: 'CASH', paidAt }), true);
  });
});

describe('payment reference', () => {
  it('requires reference for cheque and bank transfer only', () => {
    assert.equal(validatePaymentReference('CASH'), true);
    assert.equal(validatePaymentReference('OTHER'), true);
    assert.equal(validatePaymentReference('CHEQUE'), false);
    assert.equal(validatePaymentReference('CHEQUE', 'CHQ-1'), true);
  });
});

describe('payment totals', () => {
  it('computes outstanding', () => {
    assert.equal(computeOutstanding('500.00', '0'), '500.0000');
    assert.equal(computeOutstanding('500.00', '500.00'), '0.0000');
  });
  it('never goes negative', () => {
    assert.equal(computeOutstanding('500.00', '600.00'), '0.0000');
  });
  it('computes payment status', () => {
    assert.equal(computePaymentStatus('500', '0'), 'UNPAID');
    assert.equal(computePaymentStatus('500', '500'), 'PAID');
    assert.equal(computePaymentStatus('500', '250'), 'PARTIALLY_PAID');
  });
  // FIN-01: one satang policy across API/DB/UI — the stored outstanding is the printed one.
  it('settles a legacy 4dp claim paid at its displayed satang amount', () => {
    assert.equal(computeOutstanding('580.0042', '580.00'), '0.0000');
    assert.equal(computePaymentStatus('580.0042', '580.00'), 'PAID');
    assert.equal(computeOutstanding('580.0058', '580.01'), '0.0000');
    assert.equal(computePaymentStatus('580.0058', '580.01'), 'PAID');
  });
  it('keeps a real satang shortfall outstanding', () => {
    assert.equal(computeOutstanding('580.0042', '579.99'), '0.0100');
    assert.equal(computePaymentStatus('580.0042', '579.99'), 'PARTIALLY_PAID');
  });
});

describe('duplicate scoring (over lines)', () => {
  const a = { requesterUserId: 'u1', amount: '100.00', currency: 'THB', incurredDate: '2026-01-01', categoryKey: 'travel' };
  it('scores high and names the line when a receipt is shared', () => {
    const match = scoreDuplicate(
      { ...a, lines: [{ lineNo: 1 }, { lineNo: 2, attachmentId: 'att-1' }] },
      { ...a, lines: [{ lineNo: 1, attachmentId: 'att-1' }] },
    );
    assert.ok(match.score >= 60);
    assert.equal(match.sharedLineNo, 2);
    assert.equal(match.sharedType, 'ATTACHMENT');
    assert.equal(match.sharedAttachmentId, 'att-1');
  });
  it('scores high when a LINE-captured expense is shared on any line', () => {
    const match = scoreDuplicate(
      { ...a, lines: [{ lineNo: 1, linkedExpenseId: 'exp-1' }] },
      { ...a, lines: [{ lineNo: 3, linkedExpenseId: 'exp-1' }] },
    );
    assert.ok(match.score >= 60);
    assert.equal(match.sharedType, 'EXPENSE');
    assert.equal(match.sharedExpenseId, 'exp-1');
  });
  it('scores for same amount/date/requester without shared evidence', () => {
    const match = scoreDuplicate(a, a);
    assert.ok(match.score >= 40 && match.score < 60);
    assert.equal(match.sharedLineNo, undefined);
  });
  it('scores low for unrelated', () => {
    assert.ok(scoreDuplicate(a, { requesterUserId: 'u2', amount: '999.00', currency: 'THB', incurredDate: '2026-05-05', categoryKey: 'meals' }).score < 60);
  });
  it('does not match on empty evidence ids', () => {
    const match = scoreDuplicate(
      { ...a, lines: [{ lineNo: 1, attachmentId: null, linkedExpenseId: null }] },
      { ...a, lines: [{ lineNo: 1, attachmentId: null, linkedExpenseId: null }] },
    );
    assert.equal(match.sharedLineNo, undefined);
  });
});

describe('payment source ref', () => {
  it('maps to REIMBURSEMENT_PAYMENT/PAID', () => {
    const ref = buildPaymentSourceRef({
      id: 'pay-1', paidAmount: '500.0000', currency: 'THB',
      paidAt: new Date('2026-02-01T00:00:00.000Z'),
      requesterDisplayNameSnapshot: 'Somchai', reimbursementRequestId: 'req-1',
    });
    assert.equal(ref.sourceType, 'REIMBURSEMENT_PAYMENT');
    assert.equal(ref.direction, 'PAID');
    assert.equal(ref.sourceId, 'pay-1');
    assert.equal(ref.amount, '500.0000');
    assert.equal(ref.currency, 'THB');
    assert.equal(ref.paidAt, '2026-02-01T00:00:00.000Z');
    assert.equal(ref.requestId, 'req-1');
  });
});

describe('SLA / age', () => {
  it('computes age in hours', () => {
    assert.equal(ageHours(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T05:00:00Z')), 5);
  });
  it('flags SLA risk when age >= slaHours', () => {
    assert.equal(isSlaRisk(48, 24), true);
    assert.equal(isSlaRisk(12, 24), false);
    assert.equal(isSlaRisk(100, undefined), false);
  });
});

describe('redaction', () => {
  it('strips sensitive keys from outbox payloads', () => {
    const redacted = redactPayload({ requestId: 'r1', signedUrl: 'https://x', objectKey: 'k', accountNumber: '123', amount: '500' });
    assert.deepEqual(Object.keys(redacted).sort(), ['amount', 'requestId']);
  });
});

describe('currentDesk', () => {
  const pendingStep = (overrides: Partial<CurrentDeskStepFields> = {}): CurrentDeskStepFields => ({
    sequenceNo: 1, status: 'PENDING', ...overrides,
  });
  const names = { 'u-1': 'คุณยุนกิ', 'u-2': 'คุณสมชาย' };

  it('answers the pool desk for every non-approval stage', () => {
    assert.deepEqual(currentDesk({ status: 'DRAFT' }), { kind: 'REQUESTER' });
    assert.deepEqual(currentDesk({ status: 'FINANCE_REVIEW' }), { kind: 'FINANCE' });
    assert.deepEqual(currentDesk({ status: 'READY_FOR_PAYMENT' }), { kind: 'PAYMENT' });
    assert.deepEqual(currentDesk({ status: 'PARTIALLY_PAID' }), { kind: 'PAYMENT' });
  });

  it('routes the transient APPROVED state by whether finance review is pending', () => {
    assert.deepEqual(currentDesk({ status: 'APPROVED', financeReviewStatus: 'PENDING' }), { kind: 'FINANCE' });
    assert.deepEqual(currentDesk({ status: 'APPROVED', financeReviewStatus: 'NOT_REQUIRED' }), { kind: 'PAYMENT' });
  });

  it('has no desk once the claim is terminal', () => {
    for (const status of ['PAID', 'REJECTED', 'CANCELLED', 'VOIDED'] as const) {
      assert.equal(currentDesk({ status }), undefined);
    }
  });

  it('names the frozen assignees of the pending step', () => {
    const desk = currentDesk({
      status: 'PENDING_APPROVAL',
      steps: [pendingStep({ assignedApproverUserIds: ['u-1', 'u-2'] })],
      names,
    });
    assert.deepEqual(desk, { kind: 'APPROVER', names: ['คุณยุนกิ', 'คุณสมชาย'] });
  });

  it('folds the named approver in without repeating an assignee', () => {
    const desk = currentDesk({
      status: 'PENDING_APPROVAL',
      steps: [pendingStep({ approverUserId: 'u-1', assignedApproverUserIds: ['u-1'] })],
      names,
    });
    assert.deepEqual(desk, { kind: 'APPROVER', names: ['คุณยุนกิ'] });
  });

  it('takes the lowest live sequenceNo and skips invalidated steps', () => {
    const desk = currentDesk({
      status: 'PENDING_APPROVAL',
      steps: [
        pendingStep({ sequenceNo: 2, approverUserId: 'u-2' }),
        pendingStep({ sequenceNo: 1, approverUserId: 'u-1', invalidatedAt: new Date('2026-08-01T00:00:00Z') }),
      ],
      names,
    });
    assert.deepEqual(desk, { kind: 'APPROVER', names: ['คุณสมชาย'] });
  });

  it('omits names when nothing resolves, so the client prints the pool instead of a cuid', () => {
    // A user id with no name loaded, a role-routed step naming nobody, and no step at all.
    assert.deepEqual(currentDesk({ status: 'PENDING_APPROVAL', steps: [pendingStep({ approverUserId: 'u-9' })], names }), { kind: 'APPROVER' });
    assert.deepEqual(currentDesk({ status: 'PENDING_APPROVAL', steps: [pendingStep()], names }), { kind: 'APPROVER' });
    assert.deepEqual(currentDesk({ status: 'PENDING_APPROVAL' }), { kind: 'APPROVER' });
  });

  it('ignores steps that are no longer pending', () => {
    const desk = currentDesk({
      status: 'PENDING_APPROVAL',
      steps: [pendingStep({ status: 'APPROVED', approverUserId: 'u-1' })],
      names,
    });
    assert.deepEqual(desk, { kind: 'APPROVER' });
  });
});
