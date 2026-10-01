import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  pendingProjectionIntent,
  claimSignatureAckHash,
  claimSnapshotFields,
  type CurrentDeskStepFields,
} from './reimbursement.logic';
import { parseReimbursementPolicySnapshot } from '../reimbursement.constants';
import {
  invalidPayoutDestinationField, isReimbursementClaimApprover, looksLikeAccountNumber, maskedPayoutAccount, maskedPayoutAccountNumber,
  normalizePayoutAccountNumber, reimbursementPaymentRule, reimbursementPaymentSlipRequired,
  REIMBURSEMENT_PAYMENT_METHOD_LABELS, reimbursementPaidNotice, reimbursementPaymentHowText,
} from '@watchdog-bms/contracts';
import {
  CASH_PAYOUT_FINGERPRINT,
  draftFollowsDefaultAfterReopen,
  hasPayoutSnapshot,
  isBlankPayoutDestination,
  legacyPayoutConfirmToken,
  openPayoutAccountNumber,
  planPaymentPayout,
  payoutAttestationError,
  payoutFingerprint,
  payoutRevealGroup,
  planSubmitPayout,
  payoutSubmitToken,
  sealPayoutDestination,
  submitPayoutColumns,
} from './payout-destination.logic';
// Whose turn it is at the pay step (its own import, apart from the block above).
import { claimApproverUserId, paymentTurnUserIds } from './reimbursement.logic';

const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

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
    assert.equal(isSamePaymentRequest({ ...cash, payoutDestinationVersion: null, payoutDefaultToken: null }, { paidAmount: '500', currency: 'THB', paymentMethod: 'CASH', paidAt }), true);
  });

  it('is the same payment only for the same account: the version confirmed, or the default a legacy payer confirmed', () => {
    const intoVersion2 = { ...recorded, payoutDestinationVersion: 2 };
    assert.equal(isSamePaymentRequest(intoVersion2, { ...request, payoutDestinationVersion: 2 }), true);
    assert.equal(isSamePaymentRequest(intoVersion2, { ...request, payoutDestinationVersion: 3 }), false, 'another account version');
    assert.equal(isSamePaymentRequest(intoVersion2, request), false, 'the confirmation dropped');
    assert.equal(isSamePaymentRequest(recorded, { ...request, payoutDestinationVersion: 2 }), false, 'a confirmation the payment never had');

    const intoDefault = { ...recorded, payoutDefaultToken: 'a'.repeat(32) };
    assert.equal(isSamePaymentRequest(intoDefault, { ...request, payoutDefaultToken: 'a'.repeat(32) }), true);
    assert.equal(isSamePaymentRequest(intoDefault, { ...request, payoutDefaultToken: 'b'.repeat(32) }), false, 'another default account');
    assert.equal(isSamePaymentRequest(intoDefault, request), false);
    assert.equal(isSamePaymentRequest(intoDefault, { ...request, payoutDestinationVersion: 1 }), false, 'a version is not a default');
  });
});

// ---- The payment step (payout spec §12.3, §12.4, §12.6) ----

describe('payout: the one table of what a payment asks for (spec §12.4)', () => {
  const transferClaim = { payoutMethod: 'BANK_TRANSFER' as const, hasAccount: true };
  const cashClaim = { payoutMethod: 'CASH' as const, hasAccount: false };
  const rule = (slipRequired: boolean, payoutConfirmation: string, mismatchReasonRequired: boolean) => ({ slipRequired, payoutConfirmation, mismatchReasonRequired });

  it('is the table, row for row', () => {
    const table: [string, typeof transferClaim | typeof cashClaim | null, string, ReturnType<typeof rule>][] = [
      ['โอน / โอน', transferClaim, 'BANK_TRANSFER', rule(true, 'required', false)],
      ['โอน / เงินสด', transferClaim, 'CASH', rule(false, 'none', true)],
      ['โอน / เช็ค', transferClaim, 'CHEQUE', rule(false, 'none', true)],
      ['โอน / อื่น ๆ', transferClaim, 'OTHER', rule(false, 'none', true)],
      ['เงินสด / เงินสด', cashClaim, 'CASH', rule(false, 'none', false)],
      // The claim has no account, so there is nothing to confirm; the slip rule still holds.
      ['เงินสด / โอน', cashClaim, 'BANK_TRANSFER', rule(true, 'none', true)],
      ['เงินสด / เช็ค', cashClaim, 'CHEQUE', rule(false, 'none', true)],
      ['เงินสด / อื่น ๆ', cashClaim, 'OTHER', rule(false, 'none', true)],
      // A legacy claim asked for nothing: no method can differ from it, and the confirmation is the payer's to give.
      ['ใบเก่า / โอน', null, 'BANK_TRANSFER', rule(true, 'optional', false)],
      ['ใบเก่า / เงินสด', null, 'CASH', rule(false, 'none', false)],
      ['ใบเก่า / เช็ค', null, 'CHEQUE', rule(false, 'none', false)],
      ['ใบเก่า / อื่น ๆ', null, 'OTHER', rule(false, 'none', false)],
    ];
    for (const [name, requested, paymentMethod, expected] of table) assert.deepEqual(reimbursementPaymentRule(requested, paymentMethod), expected, name);
  });

  it('asks the slip by the same rule the slip check uses', () => {
    for (const method of ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER', '']) {
      for (const requested of [transferClaim, cashClaim, null]) assert.equal(reimbursementPaymentRule(requested, method).slipRequired, reimbursementPaymentSlipRequired(method));
    }
  });
});

describe('payout: the payer statement held against the claim', () => {
  const transfer = { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 2, payoutFingerprint: 'f'.repeat(64) };
  const cash = { payoutMethod: 'CASH', payoutDestinationVersion: null, payoutFingerprint: CASH_PAYOUT_FINGERPRINT };
  const legacyClaims = [{}, { payoutMethod: null, payoutDestinationVersion: null, payoutFingerprint: null },
    // Left by a draft, or sent by an older build during a rollback: no fingerprint, so still legacy.
    { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: null }];
  const byTransfer = { paymentMethod: 'BANK_TRANSFER' };
  const token = 'a'.repeat(32);

  it('records a transfer into the claim account only with a confirmation of its current version', () => {
    assert.deepEqual(planPaymentPayout(transfer, { ...byTransfer, payoutDestinationVersion: 2, payoutConfirmed: true }), { payoutDestinationVersion: 2 });
    for (const statement of [{}, { payoutConfirmed: true }, { payoutDestinationVersion: 2 }, { payoutDestinationVersion: 2, payoutConfirmed: false },
      { payoutDestinationVersion: 2, payoutConfirmed: 'true' }, { payoutDestinationVersion: 2, payoutConfirmed: 1 }, { payoutDestinationVersion: null, payoutConfirmed: true }]) {
      assert.deepEqual(planPaymentPayout(transfer, { ...byTransfer, ...statement }), { error: 'payout_confirmation_required' }, JSON.stringify(statement));
    }
    for (const payoutDestinationVersion of [1, 3, '2', 2.5, true]) {
      assert.deepEqual(planPaymentPayout(transfer, { ...byTransfer, payoutDestinationVersion, payoutConfirmed: true }), { error: 'payout_destination_changed' }, String(payoutDestinationVersion));
    }
  });

  it('refuses whatever is named as shown and is not what the claim holds, before anything else', () => {
    // A stale version is said first, also when the confirmation or the reason is missing too.
    assert.deepEqual(planPaymentPayout(transfer, { ...byTransfer, payoutDestinationVersion: 1 }), { error: 'payout_destination_changed' });
    assert.deepEqual(planPaymentPayout(transfer, { paymentMethod: 'CASH', payoutDestinationVersion: 1 }), { error: 'payout_destination_changed' });
    // A cash claim and a legacy claim hold no version; a claim with its own account takes no default-account token.
    for (const claim of [cash, ...legacyClaims]) {
      assert.deepEqual(planPaymentPayout(claim, { paymentMethod: 'CASH', payoutDestinationVersion: 1 }), { error: 'payout_destination_changed' });
    }
    for (const claim of [transfer, cash]) {
      assert.deepEqual(planPaymentPayout(claim, { ...byTransfer, payoutDestinationVersion: claim.payoutDestinationVersion ?? undefined, payoutConfirmed: true, payoutDefaultToken: token, methodMismatchReason: 'เหตุผล' }), { error: 'payout_destination_changed' });
    }
  });

  it('asks a reason exactly when the method differs from the one asked for, and keeps none otherwise', () => {
    const reason = 'ผู้เบิกขอรับเป็นเงินสดแทน';
    for (const paymentMethod of ['CASH', 'CHEQUE', 'OTHER']) {
      assert.deepEqual(planPaymentPayout(transfer, { paymentMethod }), { error: 'payment_method_mismatch_reason_required' }, paymentMethod);
      assert.deepEqual(planPaymentPayout(transfer, { paymentMethod, methodMismatchReason: '  ' }), { error: 'payment_method_mismatch_reason_required' });
      assert.deepEqual(planPaymentPayout(transfer, { paymentMethod, methodMismatchReason: 42 }), { error: 'payment_method_mismatch_reason_required' });
      assert.deepEqual(planPaymentPayout(transfer, { paymentMethod, methodMismatchReason: ` ${reason} ` }), { methodMismatchReason: reason });
      // The page's version may come along: it is checked, and no account is recorded for a payment that used none.
      assert.deepEqual(planPaymentPayout(transfer, { paymentMethod, methodMismatchReason: reason, payoutDestinationVersion: 2, payoutConfirmed: true }), { methodMismatchReason: reason });
    }
    for (const paymentMethod of ['BANK_TRANSFER', 'CHEQUE', 'OTHER']) {
      assert.deepEqual(planPaymentPayout(cash, { paymentMethod }), { error: 'payment_method_mismatch_reason_required' }, paymentMethod);
      // A cash claim has no account: a transfer is recorded with its reason and nothing to confirm.
      assert.deepEqual(planPaymentPayout(cash, { paymentMethod, methodMismatchReason: reason, payoutConfirmed: true }), { methodMismatchReason: reason });
    }
    assert.deepEqual(planPaymentPayout(cash, { paymentMethod: 'CASH' }), {});
    assert.deepEqual(planPaymentPayout(cash, { paymentMethod: 'CASH', methodMismatchReason: reason }), {}, 'a reason nobody asked for is not kept');
    assert.deepEqual(planPaymentPayout(transfer, { ...byTransfer, payoutDestinationVersion: 2, payoutConfirmed: true, methodMismatchReason: reason }), { payoutDestinationVersion: 2 });
  });

  it('keeps an account number out of the reason, by the guard the notes use', () => {
    for (const methodMismatchReason of ['โอนเข้า 0123456789', 'บัญชี 123-4-56789-0', 'เบอร์ ๐๘๑ ๒๓๔ ๕๖๗๘']) {
      assert.equal(looksLikeAccountNumber(methodMismatchReason), true);
      assert.deepEqual(planPaymentPayout(transfer, { paymentMethod: 'CASH', methodMismatchReason }), { error: 'note_contains_account_number' }, methodMismatchReason);
    }
    assert.deepEqual(planPaymentPayout(transfer, { paymentMethod: 'CASH', methodMismatchReason: 'จ่ายเงินสด 1500 บาท ตามใบ RB-202609-0003' }),
      { methodMismatchReason: 'จ่ายเงินสด 1500 บาท ตามใบ RB-202609-0003' });
  });

  it('pays a legacy claim as before, and takes a confirmation of the requester default only with the token that names it', () => {
    for (const claim of legacyClaims) {
      for (const paymentMethod of ['BANK_TRANSFER', 'CASH', 'CHEQUE', 'OTHER']) {
        assert.deepEqual(planPaymentPayout(claim, { paymentMethod }), {}, `${JSON.stringify(claim)} ${paymentMethod}`);
        assert.deepEqual(planPaymentPayout(claim, { paymentMethod, methodMismatchReason: 'ไม่มีใครขอ' }), {});
      }
      assert.deepEqual(planPaymentPayout(claim, { ...byTransfer, payoutConfirmed: true, payoutDefaultToken: token }), { payoutDefaultToken: token });
      for (const payoutDefaultToken of [undefined, null, '', 7]) {
        assert.deepEqual(planPaymentPayout(claim, { ...byTransfer, payoutConfirmed: true, payoutDefaultToken }), { error: 'payout_confirmation_required' }, String(payoutDefaultToken));
      }
      // Not confirmed, or not a transfer: the token is ignored and no account is recorded.
      assert.deepEqual(planPaymentPayout(claim, { ...byTransfer, payoutDefaultToken: token }), {});
      assert.deepEqual(planPaymentPayout(claim, { paymentMethod: 'CASH', payoutConfirmed: true, payoutDefaultToken: token }), {});
    }
  });

  it('names a default account by a token that is the same for the same account and says nothing of it', () => {
    const fingerprint = payoutFingerprint({ payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '0123456789' }, Buffer.alloc(32, 3));
    const shown = legacyPayoutConfirmToken('claim-1', fingerprint);
    assert.match(shown, /^[0-9a-f]{32}$/);
    assert.equal(legacyPayoutConfirmToken('claim-1', fingerprint), shown);
    assert.notEqual(legacyPayoutConfirmToken('claim-2', fingerprint), shown, 'bound to the claim');
    assert.notEqual(legacyPayoutConfirmToken('claim-1', payoutFingerprint({ payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '0123456780' }, Buffer.alloc(32, 3))), shown);
    assert.equal(fingerprint.includes(shown) || shown.includes('6789'), false);
    // Not the token a draft's submit uses: one cannot be passed off as the other.
    assert.notEqual(payoutSubmitToken('claim-1', { payoutMethod: 'BANK_TRANSFER', followsDefault: true, version: 1, fingerprint, action: 'COPY_DEFAULT' }), shown);
  });
});

// Payout spec §17.3 and invariant I4: one payment is said in the same words wherever it is said. The
// claim page (its payment row and its timeline) and the requester's notice read the method and the
// account from these two functions, which live in contracts so the web and the API cannot drift.
describe('payment: the words every surface shares', () => {
  const account = { payoutKind: 'BANK_ACCOUNT', accountLast4: '1234' };
  const facts = (overrides: Record<string, unknown> = {}) => ({ paymentMethod: 'BANK_TRANSFER', paidAmount: '1614.5000', currency: 'THB', slipCount: 1, payoutDestination: account, ...overrides });

  it('says where a confirmed transfer went by its last 4 digits, and every other payment by its method', () => {
    assert.equal(reimbursementPaymentHowText(facts()), 'โอนเข้าบัญชีลงท้าย 1234');
    assert.equal(reimbursementPaymentHowText(facts({ payoutDestination: { payoutKind: 'PROMPTPAY_PHONE', accountLast4: '5678' } })), 'โอนเข้าพร้อมเพย์เบอร์ลงท้าย 5678');
    // The masked form is the shared one, never a second spelling of it.
    assert.equal(reimbursementPaymentHowText(facts()), `โอนเข้าบัญชี${maskedPayoutAccountNumber('1234')}`);
    for (const [method, word] of Object.entries(REIMBURSEMENT_PAYMENT_METHOD_LABELS)) {
      assert.equal(reimbursementPaymentHowText({ paymentMethod: method }), word, method);
    }
    assert.deepEqual(REIMBURSEMENT_PAYMENT_METHOD_LABELS, { CASH: 'เงินสด', BANK_TRANSFER: 'โอนเงิน', CHEQUE: 'เช็ค', OTHER: 'อื่น ๆ' });
    // A method added later, or a name every object carries, is never printed as it came.
    for (const method of ['A_METHOD_ADDED_LATER', 'constructor', 'toString', '']) assert.equal(reimbursementPaymentHowText({ paymentMethod: method }), '', method);
  });

  it('builds the requester\'s notice from the payment\'s own facts (spec §17.3)', () => {
    // The two sentences the spec gives, word for word.
    assert.equal(reimbursementPaidNotice(facts()), 'โอนเข้าบัญชีลงท้าย 1234 จำนวน 1,614.50 บาท มีสลิปแนบ แตะเพื่อดูสลิป');
    assert.equal(reimbursementPaidNotice(facts({ paymentMethod: 'CASH', payoutDestination: undefined, slipCount: 0 })), 'จ่ายเป็นเงินสด 1,614.50 บาท');
    const notice = (overrides: Record<string, unknown>) => reimbursementPaidNotice(facts({ payoutDestination: undefined, slipCount: 0, ...overrides }));
    assert.equal(reimbursementPaidNotice(facts({ payoutDestination: { payoutKind: 'PROMPTPAY_PHONE', accountLast4: '5678' } })), 'โอนเข้าพร้อมเพย์เบอร์ลงท้าย 5678 จำนวน 1,614.50 บาท มีสลิปแนบ แตะเพื่อดูสลิป');
    // A transfer with no account confirmed (a claim that asked for cash, a legacy claim paid elsewhere).
    assert.equal(notice({ slipCount: 1 }), 'โอนเงิน จำนวน 1,614.50 บาท มีสลิปแนบ แตะเพื่อดูสลิป');
    assert.equal(notice({ paymentMethod: 'CHEQUE' }), 'จ่ายเป็นเช็ค 1,614.50 บาท');
    assert.equal(notice({ paymentMethod: 'OTHER' }), 'จ่ายด้วยวิธีอื่น 1,614.50 บาท');
    // Evidence attached to a payment that needs none is said too: the row on the claim page shows it.
    assert.equal(notice({ paymentMethod: 'CASH', slipCount: 2 }), 'จ่ายเป็นเงินสด 1,614.50 บาท มีสลิปแนบ แตะเพื่อดูสลิป');
    assert.equal(notice({ paymentMethod: 'A_METHOD_ADDED_LATER' }), 'จ่ายแล้ว 1,614.50 บาท');
  });

  it('writes the amount as the claim page does: two decimals, grouped, in baht', () => {
    const amountOf = (paidAmount: string, currency = 'THB') => reimbursementPaidNotice({ paymentMethod: 'CASH', paidAmount, currency, slipCount: 0 });
    assert.equal(amountOf('500.0000'), 'จ่ายเป็นเงินสด 500.00 บาท');
    assert.equal(amountOf('1234567.8900'), 'จ่ายเป็นเงินสด 1,234,567.89 บาท');
    // A legacy four-decimal claim pays, prints and is announced at its satang figure (FIN-01).
    assert.equal(amountOf('580.0042'), 'จ่ายเป็นเงินสด 580.00 บาท');
    assert.equal(amountOf('0.5'), 'จ่ายเป็นเงินสด 0.50 บาท');
    // Another currency keeps its own code rather than being called baht.
    assert.equal(amountOf('99.5000', 'USD'), 'จ่ายเป็นเงินสด 99.50 USD');
    // No sentence in baht carries a Latin letter: no code word, no currency code.
    for (const method of ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER', 'LATER']) {
      for (const payoutDestination of [undefined, account, { payoutKind: 'PROMPTPAY_PHONE', accountLast4: '5678' }]) {
        for (const slipCount of [0, 1]) assert.doesNotMatch(reimbursementPaidNotice(facts({ paymentMethod: method, payoutDestination, slipCount })), /[A-Za-z_]/);
      }
    }
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

  // Audit B4. Before: a claim whose step was already APPROVED answered the approver desk, so the claim page
  // said "อยู่ที่ ผู้มีสิทธิ์อนุมัติ" under a timeline that said "อนุมัติโดย …", while LINE said รอระบบปรับสถานะ.
  it('answers the system desk once the loaded steps hold no pending one: the approval is decided', () => {
    assert.deepEqual(currentDesk({ status: 'PENDING_APPROVAL', steps: [pendingStep({ status: 'APPROVED', approverUserId: 'u-1' })], names }), { kind: 'SYSTEM' });
    assert.deepEqual(currentDesk({ status: 'PENDING_APPROVAL', steps: [] }), { kind: 'SYSTEM' });
    // A step withdrawn or superseded is not a decision, but it is not waiting either.
    assert.deepEqual(currentDesk({ status: 'PENDING_APPROVAL', steps: [pendingStep({ invalidatedAt: new Date('2026-08-01T00:00:00Z') })] }), { kind: 'SYSTEM' });
    // Steps the caller did not load say nothing: the pool, as before.
    assert.deepEqual(currentDesk({ status: 'PENDING_APPROVAL' }), { kind: 'APPROVER' });
  });

  // Audit B3. Before: a claim being cancelled kept the desk of its status, though approval and payment were refused.
  it('answers the system desk for a claim that is being cancelled, in every status that has a desk', () => {
    const steps = [pendingStep({ assignedApproverUserIds: ['u-1'] })];
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID'] as const) {
      assert.deepEqual(currentDesk({ status, financeReviewStatus: 'PENDING', steps, names, cancellationPending: true }), { kind: 'SYSTEM' }, status);
      assert.notEqual(currentDesk({ status, steps, names })?.kind, 'SYSTEM', `${status}, not being cancelled`);
    }
    // A cancelled claim keeps the intent it was cancelled with; like every finished claim it has no desk.
    for (const status of ['PAID', 'REJECTED', 'CANCELLED', 'VOIDED'] as const) {
      assert.equal(currentDesk({ status, cancellationPending: true }), undefined, status);
    }
  });
});

// Audit B4. One definition of "decided, not carried out yet" for the scheduled run, for ดำเนินการต่อ
// and for what the claim detail says, so the three never name different claims.
describe('pendingProjectionIntent', () => {
  const policy = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1, policyId: 'pol-1', policyVersion: 'v1', approvalRequiredFromAmount: '1000.00', requiresApproval: false, route: null,
    allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: false, duplicatePolicy: 'BLOCK_PAYMENT', financeReviewRequired: false,
    ...overrides,
  });
  const routed = { requiresApproval: true, route: { mode: 'MANAGER_ROLE', roleKey: 'MANAGER', effectiveTaskRole: 'MANAGER', ownerFallbackUsedAtSubmission: false } };
  const claim = (overrides: Record<string, unknown> = {}) => ({ status: 'PENDING_APPROVAL' as const, requesterUserId: 'staff-1', ...overrides }) as Parameters<typeof pendingProjectionIntent>[0];
  const approved = { id: 'step-2', status: 'APPROVED' as const, decisionByUserId: 'mgr-1' };

  it('names the decision of the step the claim stands on, and who made it', () => {
    assert.deepEqual(pendingProjectionIntent(claim({ currentApprovalStepId: 'step-2', approvalSteps: [{ id: 'step-1', status: 'CANCELLED' }, approved] })),
      { kind: 'MANAGER', actorUserId: 'mgr-1', approvalStepId: 'step-2' });
    assert.deepEqual(pendingProjectionIntent(claim({ status: 'FINANCE_REVIEW', financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: 'fin-1' })),
      { kind: 'FINANCE', actorUserId: 'fin-1' });
    // Nobody had to approve it: the decision is the policy's, on behalf of whoever sent the claim.
    assert.deepEqual(pendingProjectionIntent(claim({ status: 'APPROVED', approvalPolicySnapshotJson: policy(), submittedByUserId: 'fin-1' })), { kind: 'POLICY', actorUserId: 'fin-1' });
    assert.deepEqual(pendingProjectionIntent(claim({ status: 'APPROVED', approvalPolicySnapshotJson: policy() })), { kind: 'POLICY', actorUserId: 'staff-1' });
  });

  it('names nothing while a decision is still to be made, or once it was carried out', () => {
    for (const [why, request] of [
      ['waiting for its approver', claim({ currentApprovalStepId: 'step-1', approvalSteps: [{ id: 'step-1', status: 'PENDING' }] })],
      ['an earlier step was approved, the one it stands on was not', claim({ currentApprovalStepId: 'step-3', approvalSteps: [approved, { id: 'step-3', status: 'PENDING' }] })],
      ['its steps were not loaded', claim({ currentApprovalStepId: 'step-2' })],
      ['waiting for finance', claim({ status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' })],
      ['approved on its way to finance', claim({ status: 'APPROVED', approvalPolicySnapshotJson: policy({ financeReviewRequired: true }) })],
      ['approved by a person under a policy that asked for one', claim({ status: 'APPROVED', approvalPolicySnapshotJson: policy(routed) })],
      ['a claim from before policies were frozen', claim({ status: 'APPROVED' })],
      ['waiting for payment', claim({ status: 'READY_FOR_PAYMENT' })],
      ['paid', claim({ status: 'PAID' })],
    ] as const) assert.equal(pendingProjectionIntent(request), undefined, why);
  });

  it('names nothing for a claim that is being cancelled: the cancellation comes first', () => {
    const cancellationPendingAt = new Date('2026-10-01T02:00:00.000Z');
    assert.equal(pendingProjectionIntent(claim({ currentApprovalStepId: 'step-2', approvalSteps: [approved], cancellationPendingAt })), undefined);
    assert.equal(pendingProjectionIntent(claim({ status: 'FINANCE_REVIEW', financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: 'fin-1', cancellationPendingAt })), undefined);
    assert.equal(pendingProjectionIntent(claim({ status: 'APPROVED', approvalPolicySnapshotJson: policy(), cancellationPendingAt })), undefined);
  });
});

// Owner rule 2026-10-01: at the payment desk the person whose turn it is comes first. That is the order
// the ready-to-pay notice and the payment reminder ask in: the finance reviewer who passed the claim, then
// its approver. The claim page names the people who can pay in this order.
describe('whose turn it is to record a payment', () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 9, 1, hour));
  const approved = (decisionByUserId: string, decidedAt = at(4), overrides: Record<string, unknown> = {}) => ({ status: 'APPROVED', decisionByUserId, decidedAt, ...overrides });
  const claim = (overrides: Record<string, unknown> = {}) => ({ submittedAt: at(3), approvalSteps: [approved('u-approver')], ...overrides });

  it('is the claim\'s approver, by the one rule for who that is', () => {
    assert.deepEqual(paymentTurnUserIds(claim()), ['u-approver']);
    assert.equal(paymentTurnUserIds(claim())[0], claimApproverUserId(claim()));
    assert.equal(isReimbursementClaimApprover('u-approver', claim()), true);
    // Nobody approved: a claim below the threshold, a draft, an approval from an earlier round or one withdrawn.
    for (const nobody of [claim({ approvalSteps: [] }), claim({ submittedAt: null }), claim({ approvalSteps: [approved('u-approver', at(2))] }),
      claim({ approvalSteps: [approved('u-approver', at(4), { invalidatedAt: at(5) })] }), claim({ approvalSteps: [{ status: 'REJECTED', decisionByUserId: 'u-approver', decidedAt: at(4) }] })]) {
      assert.deepEqual(paymentTurnUserIds(nobody), []);
    }
    // Sent again and approved again: the approver of the round in force.
    assert.deepEqual(paymentTurnUserIds(claim({ approvalSteps: [approved('u-first', at(2)), approved('u-second', at(4))] })), ['u-second']);
  });

  it('puts the finance reviewer who passed the claim before its approver', () => {
    const reviewed = { financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: 'u-finance' };
    assert.deepEqual(paymentTurnUserIds(claim(reviewed)), ['u-finance', 'u-approver']);
    // One person who did both is named once.
    assert.deepEqual(paymentTurnUserIds(claim({ ...reviewed, financeReviewedByUserId: 'u-approver' })), ['u-approver']);
    // A review that did not pass the claim (pending, blocked, returned, or none) gives the reviewer no turn.
    for (const financeReviewStatus of ['NOT_REQUIRED', 'PENDING', 'NEEDS_INFO', 'BLOCKED', undefined]) {
      assert.deepEqual(paymentTurnUserIds(claim({ ...reviewed, financeReviewStatus })), ['u-approver'], String(financeReviewStatus));
    }
    assert.deepEqual(paymentTurnUserIds(claim({ financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: null })), ['u-approver']);
  });
});

// ---- Payout account (payout spec §8–§11) ----

describe('payout: a claim with no receiving method keeps its hashes (legacy claims)', () => {
  // A claim sent before the payout field existed. The three values below were computed by the code
  // on develop 219c2369, BEFORE the payout part was added to the hash, and are pinned as literals:
  // if any of them moves, every pending approval and every signature in production goes stale.
  const policy = {
    schemaVersion: 1 as const, policyId: 'pol-1', policyVersion: '2026-09-20T03:00:00.000Z',
    approvalRequiredFromAmount: '1.0000', requiresApproval: true,
    route: { mode: 'MANAGER_ROLE' as const, roleKey: 'MANAGER', effectiveTaskRole: 'MANAGER', ownerFallbackUsedAtSubmission: false },
    allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: true,
    duplicatePolicy: 'WARN' as const, financeReviewRequired: false,
  };
  const lines = [
    { lineNo: 1, incurredDate: new Date('2026-09-18T00:00:00.000Z'), description: 'ค่าแท็กซี่ไปพบลูกค้า', purpose: 'พบลูกค้า', categoryKey: 'travel', amount: '350.0000', attachmentId: 'att-1', linkedExpenseId: null },
    { lineNo: 2, incurredDate: new Date('2026-09-19T00:00:00.000Z'), description: 'ค่าอาหารกลางวัน', purpose: null, categoryKey: 'meals', amount: '230.5000', attachmentId: null, linkedExpenseId: 'exp-9' },
  ];
  const header = { amount: '580.5000', currency: 'THB', categoryKey: 'travel', incurredDate: new Date('2026-09-18T00:00:00.000Z'), reason: 'เบิกค่าเดินทางและอาหาร', primaryAttachmentId: null };
  const approvalFields = { ...header, incurredDate: header.incurredDate.toISOString(), lines, approvalPolicySnapshotJson: policy };

  it('approval hash, signature acknowledgement hash and the v1 header hash are byte for byte what they were', () => {
    assert.equal(computeSnapshotHash(approvalFields), 'e8a0a0d5832da0361ee0442a28534235');
    assert.equal(claimSignatureAckHash({ ...header, lines }), '0c87de6573bfb6150d6cd23c1f29fa01');
    assert.equal(computeLegacySnapshotHashV1({ ...header, incurredDate: header.incurredDate.toISOString() }), '9436b51c8a27d00fcc3bbd319e80a905');
  });

  it('reads the same whether the payout columns are absent, undefined or NULL', () => {
    for (const payout of [{}, { payoutMethod: undefined, payoutDestinationVersion: undefined, payoutFingerprint: undefined },
      { payoutMethod: null, payoutDestinationVersion: null, payoutFingerprint: null }]) {
      assert.equal(computeSnapshotHash({ ...approvalFields, ...payout }), 'e8a0a0d5832da0361ee0442a28534235');
      assert.equal(claimSignatureAckHash({ ...header, lines, ...payout }), '0c87de6573bfb6150d6cd23c1f29fa01');
    }
  });

  it('a claim sent with a payout snapshot hashes it: method, snapshot version and fingerprint each move the hash', () => {
    const transfer = { ...approvalFields, payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: 'f'.repeat(64) };
    const cash = submitPayoutColumns({ payoutMethod: 'CASH', followsDefault: false });
    assert.deepEqual(cash, { payoutMethod: 'CASH', payoutDestinationVersion: null, payoutFingerprint: CASH_PAYOUT_FINGERPRINT });
    const hashes = [
      computeSnapshotHash(approvalFields),
      computeSnapshotHash(transfer),
      computeSnapshotHash({ ...transfer, payoutDestinationVersion: 2 }),
      computeSnapshotHash({ ...transfer, payoutFingerprint: 'e'.repeat(64) }),
      // Cash is hashed too, so cash cannot quietly become a transfer after approval.
      computeSnapshotHash({ ...approvalFields, ...cash }),
    ];
    assert.equal(new Set(hashes).size, hashes.length);
    assert.equal(computeSnapshotHash(transfer), computeSnapshotHash({ ...transfer }));
    assert.notEqual(claimSignatureAckHash({ ...header, lines, ...cash }), '0c87de6573bfb6150d6cd23c1f29fa01');
  });

  // The rollback window: a draft chose its method under the new build, an older build sent it (it
  // knows nothing of the payout columns, so the method stays and no fingerprint is written), and the
  // new build comes back. Deciding "legacy" by the method would recompute a hash the claim was never
  // stored with and refuse its approval for ever.
  it('is decided by the fingerprint only the payout-aware submit writes, not by what a draft chose', () => {
    for (const leftByADraft of [{ payoutMethod: 'CASH' }, { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1 },
      { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: null }, { payoutMethod: 'CASH', payoutFingerprint: '' }]) {
      assert.equal(hasPayoutSnapshot(leftByADraft), false);
      assert.equal(computeSnapshotHash({ ...approvalFields, ...leftByADraft }), 'e8a0a0d5832da0361ee0442a28534235', JSON.stringify(leftByADraft));
      assert.equal(claimSignatureAckHash({ ...header, lines, ...leftByADraft }), '0c87de6573bfb6150d6cd23c1f29fa01', JSON.stringify(leftByADraft));
      assert.equal(payoutAttestationError(leftByADraft, undefined), null, 'nothing to attest');
    }
    assert.equal(hasPayoutSnapshot({ payoutFingerprint: CASH_PAYOUT_FINGERPRINT }), true);
    assert.equal(hasPayoutSnapshot({ payoutFingerprint: 'f'.repeat(64) }), true);
  });

  // Submit, the live approval check, the signature acknowledgement and the production gate all hash
  // through `claimSnapshotFields`. One record, three kinds of claim, one answer each.
  it('gives the same hash whichever call site builds it, for a legacy, a cash and a transfer claim', () => {
    const sources = [read('../../application/use-cases/reimbursement-request.use-case.ts'), read('../../infrastructure/prisma-reimbursement.repository.ts'),
      read('./reimbursement.logic.ts'), read('../../../../scripts/production-a5-evidence.pg.ts')].join('\n');
    // No call site folds the fields by hand any more: every computeSnapshotHash call goes through the builder.
    assert.deepEqual([...sources.matchAll(/computeSnapshotHash\((?!fields)[^)]{0,40}/g)].map((match) => match[0]).filter((call) => !call.startsWith('computeSnapshotHash(claimSnapshotFields(')), []);
    assert.equal([...sources.matchAll(/computeSnapshotHash\(claimSnapshotFields\(/g)].length, 4,
      'submit, the live approval check, the signature acknowledgement, the payout account correction');
    assert.match(sources, /\.\.\.claimSnapshotFields\(\{\s+amount: decimal\(header\.amount\)/, 'the production gate');

    const record = { ...header, lines };
    for (const [kind, payout, golden] of [
      ['legacy', {}, 'e8a0a0d5832da0361ee0442a28534235'],
      ['cash', submitPayoutColumns({ payoutMethod: 'CASH', followsDefault: true }), undefined],
      ['transfer', submitPayoutColumns({ payoutMethod: 'BANK_TRANSFER', followsDefault: true, version: 3, fingerprint: 'a'.repeat(64), action: 'COPY_DEFAULT' }), undefined],
    ] as const) {
      const claim = { ...record, ...payout };
      const atSubmit = computeSnapshotHash(claimSnapshotFields(claim, policy));
      const atApproval = computeSnapshotHash(claimSnapshotFields({ ...claim, incurredDate: claim.incurredDate.toISOString() }, policy));
      assert.equal(atSubmit, atApproval, kind);
      if (golden) assert.equal(atSubmit, golden);
      // The signature acknowledgement is the same claim without the approval policy.
      assert.equal(claimSignatureAckHash(claim), computeSnapshotHash(claimSnapshotFields(claim)), kind);
      assert.notEqual(claimSignatureAckHash(claim), atSubmit, kind);
    }
  });
});

describe('payout: account format (completeness and shape only; people verify the rest)', () => {
  const bank = (accountNumber: string, extra: Record<string, unknown> = {}) => ({ payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber, ...extra });

  it('keeps digits as text: leading zeros survive, dashes and spaces go, nothing becomes a number', () => {
    assert.equal(normalizePayoutAccountNumber('012-3-45678-9'), '0123456789');
    assert.equal(normalizePayoutAccountNumber(' 000 123 456 789 012 '), '000123456789012');
    assert.equal(normalizePayoutAccountNumber(123456 as unknown), '', 'a number is refused, never stringified');
    for (const accountNumber of ['0123456789', '000123456789012', '012-3-45678-9']) assert.equal(invalidPayoutDestinationField(bank(accountNumber)), null, accountNumber);
  });

  it('takes 6 to 20 digits for a bank account and never forces 10', () => {
    for (const ok of ['123456', '1234567', '123456789012', '12345678901234567890']) assert.equal(invalidPayoutDestinationField(bank(ok)), null, ok);
    for (const bad of ['12345', '123456789012345678901', '', '12345a', '๑๒๓๔๕๖', '1234.56']) assert.equal(invalidPayoutDestinationField(bank(bad)), 'accountNumber', bad);
  });

  it('takes a Thai mobile number for PromptPay and nothing else', () => {
    const promptPay = (accountNumber: string) => ({ payoutKind: 'PROMPTPAY_PHONE' as const, accountName: 'นาย สมชาย ใจดี', accountNumber });
    assert.equal(invalidPayoutDestinationField(promptPay('081-234-5678')), null);
    // A 13-digit national id is not a PromptPay phone, and neither is a number not starting with 0.
    for (const bad of ['1234567890123', '8123456789', '08123456', '081234567890']) assert.equal(invalidPayoutDestinationField(promptPay(bad)), 'accountNumber', bad);
  });

  it('needs a bank for a bank account, an account name that is a name, and a known kind', () => {
    assert.equal(invalidPayoutDestinationField(bank('0123456789', { bankName: ' ' })), 'bankName');
    assert.equal(invalidPayoutDestinationField(bank('0123456789', { bankName: 'ธ'.repeat(81) })), 'bankName');
    for (const accountName of ['', ' ก ', '1234567890', '12 34-56', 'ก'.repeat(141)]) assert.equal(invalidPayoutDestinationField(bank('0123456789', { accountName })), 'accountName', accountName);
    assert.equal(invalidPayoutDestinationField(bank('0123456789', { accountName: 'ก'.repeat(140) })), null);
    assert.equal(invalidPayoutDestinationField({ ...bank('0123456789'), payoutKind: 'NATIONAL_ID' as never }), 'payoutKind');
    assert.equal(invalidPayoutDestinationField(null), 'payoutKind');
    assert.equal(isBlankPayoutDestination({ payoutKind: 'BANK_ACCOUNT' }), true);
    assert.equal(isBlankPayoutDestination(bank('0123456789')), false);
  });

  // Security review S4: the bank name and the account name are shown unmasked on every screen and
  // copied into the account owner's notice. A full number typed into either would be read by everyone
  // who is only meant to see the last 4 digits.
  it('refuses an account number written into the bank name or the account name', () => {
    for (const accountName of [
      'นาย สมชาย ใจดี 0123456789', 'สมชาย 012-3-45678-9', 'สมชาย 081 234 5678', 'นาย สมชาย (เลขบัญชี 123456)',
      '0123456789 สมชาย',
    ]) assert.equal(invalidPayoutDestinationField(bank('0123456789', { accountName })), 'accountName', accountName);
    for (const bankName of ['ธนาคารกสิกรไทย 0123456789', 'กสิกร 012-3-45678-9', 'สหกรณ์ออมทรัพย์ 1234567']) {
      assert.equal(invalidPayoutDestinationField(bank('0123456789', { bankName })), 'bankName', bankName);
    }
    // Names that merely contain a few digits stay names.
    for (const accountName of ['บริษัท เอบีซี 1999 จำกัด', 'หจก. 168 การค้า', 'ร้านเซเว่น สาขา 12345', 'นาย สมชาย ใจดี']) {
      assert.equal(invalidPayoutDestinationField(bank('0123456789', { accountName })), null, accountName);
    }
    assert.equal(invalidPayoutDestinationField(bank('0123456789', { bankName: 'สหกรณ์ออมทรัพย์ครู 2 จำกัด' })), null);
    // Nothing of a refused name is stored: the account is not sealed at all.
    assert.equal(sealPayoutDestination(bank('0123456789', { accountName: 'สมชาย 012-3-45678-9' }), Buffer.alloc(32, 3)), null);
  });

  it('masks an account with one wording for every surface', () => {
    assert.equal(maskedPayoutAccountNumber('6789'), 'ลงท้าย 6789');
    assert.equal(maskedPayoutAccount({ payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountLast4: '6789' }), 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789');
    assert.equal(maskedPayoutAccount({ payoutKind: 'PROMPTPAY_PHONE', accountLast4: '5678' }), 'พร้อมเพย์เบอร์ลงท้าย 5678');
  });
});

describe('payout: sealing an account (one place on write)', () => {
  const key = Buffer.alloc(32, 3);
  const typed = { payoutKind: 'BANK_ACCOUNT' as const, bankName: ' ธนาคารกสิกรไทย ', accountName: ' นาย สมชาย ใจดี ', accountNumber: '012-3-45678-9' };

  it('stores a last 4 that is always the tail of what a reveal decrypts, leading zeros included', () => {
    for (const accountNumber of ['012-3-45678-9', '000123456789012', '0000001234', '100000', '0812345678']) {
      const sealed = sealPayoutDestination({ ...typed, accountNumber }, key)!;
      const opened = openPayoutAccountNumber(sealed.accountNumberEncrypted, key);
      assert.equal(opened, normalizePayoutAccountNumber(accountNumber));
      assert.equal(sealed.accountLast4, opened.slice(-4));
      assert.match(sealed.accountLast4, /^\d{4}$/);
      assert.ok(!sealed.accountNumberEncrypted.includes(opened), 'the stored column is ciphertext');
    }
  });

  it('trims the names, drops a bank from a PromptPay number and refuses a malformed account', () => {
    const sealed = sealPayoutDestination(typed, key)!;
    assert.deepEqual([sealed.payoutKind, sealed.bankName, sealed.accountName, sealed.accountLast4], ['BANK_ACCOUNT', 'ธนาคารกสิกรไทย', 'นาย สมชาย ใจดี', '6789']);
    assert.equal(sealPayoutDestination({ payoutKind: 'PROMPTPAY_PHONE', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย', accountNumber: '0812345678' }, key)!.bankName, null);
    assert.equal(sealPayoutDestination({ ...typed, accountNumber: '12345' }, key), null);
    assert.equal(sealPayoutDestination(undefined, key), null);
  });

  it('gives the same fingerprint for the same account on every write, and another for any change', () => {
    const first = sealPayoutDestination(typed, key)!;
    const again = sealPayoutDestination({ ...typed, accountNumber: '0123456789' }, key)!;
    assert.notEqual(first.accountNumberEncrypted, again.accountNumberEncrypted, 'the ciphertext is random per write');
    assert.equal(first.fingerprint, again.fingerprint);
    const base = { payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '0123456789' };
    assert.equal(payoutFingerprint(base, key), first.fingerprint);
    for (const change of [{ accountNumber: '0123456780' }, { accountName: 'นาย สมชาย ใจดีมาก' }, { bankName: 'ธนาคารกรุงเทพ' }, { payoutKind: 'PROMPTPAY_PHONE' }]) {
      assert.notEqual(payoutFingerprint({ ...base, ...change }, key), first.fingerprint, JSON.stringify(change));
    }
    assert.notEqual(payoutFingerprint(base, Buffer.alloc(32, 4)), first.fingerprint, 'keyed: useless without the key');
    assert.ok(!first.fingerprint.includes('0123456789'));
  });

  it('redaction drops a full number that strays into an outbound payload and keeps the last 4', () => {
    assert.deepEqual(redactPayload({ accountNumber: '0123456789', payoutAccountNumber: '0123456789', accountLast4: '6789', bankName: 'ธนาคารกสิกรไทย' }),
      { accountLast4: '6789', bankName: 'ธนาคารกสิกรไทย' });
  });

  // The evidence export and the event payloads nest objects; the old check looked at the top level only.
  it('strips an account number at any depth, and leaves every other nested value as it was', () => {
    const paidAt = new Date('2026-10-01T00:00:00.000Z');
    const nested = redactPayload({
      request: { id: 'rb-1', payout: { accountNumber: '0123456789', accountNumberEncrypted: 'v1:cipher', accountLast4: '6789', bankName: 'ธนาคารกสิกรไทย' } },
      payments: [{ paymentNo: 'RBPAY-1', destination: { payoutAccountNumber: '0123456789', accountLast4: '6789' }, paidAt }],
      lines: [{ lineNo: 1, sourceExpenseSnapshot: { seller: { name: 'ร้าน', documentNumber: 'INV-0042' }, accountHintKey: 'travel' } }],
    });
    assert.deepEqual(nested, {
      request: { id: 'rb-1', payout: { accountLast4: '6789', bankName: 'ธนาคารกสิกรไทย' } },
      payments: [{ paymentNo: 'RBPAY-1', destination: { accountLast4: '6789' }, paidAt }],
      lines: [{ lineNo: 1, sourceExpenseSnapshot: { seller: { name: 'ร้าน', documentNumber: 'INV-0042' }, accountHintKey: 'travel' } }],
    });
    assert.equal((nested.payments as any[])[0].paidAt, paidAt, 'a date is a value, not a bag of keys');
    assert.equal(JSON.stringify(nested).includes('0123456789'), false);
  });
});

// Security review S5: the guard refused the product's own document numbers and plain amounts, so a
// finance reviewer could not write "ดูใบ RB-202609-0003", and it missed a number written with dots,
// slashes, several spaces or Thai digits. One function, one table.
describe('payout: no account number in a note that goes into a notification', () => {
  const cases: Array<[text: unknown, refused: boolean, why: string]> = [
    // An account or a PromptPay number, the ways people write one.
    ['0812345678', true, 'ten digits in one piece'],
    ['เลขบัญชี 0123456789', true, 'an account number after its label'],
    ['บัญชีผิด ต้องเป็น 123-4-56789-0', true, 'groups joined by dashes'],
    ['โอนเข้า 123 4 56789 0 แทน', true, 'groups joined by spaces'],
    ['พร้อมเพย์ 081-000-1234', true, 'a phone number with dashes'],
    ['เบอร์ 081 234 5678 ครับ', true, 'a phone number with spaces'],
    ['กสิกร 012-3-45678-9 ชื่อสมชาย', true, 'between other words'],
    ['000-123-456-789-012', true, 'fifteen digits in groups of three'],
    ['เลขที่ 123456', true, 'six digits in a row'],
    ['โอนเข้า 123.4.56789.0', true, 'groups joined by dots'],
    ['โอนเข้า 123/4/56789/0', true, 'groups joined by slashes'],
    ['เบอร์ 081  234  5678', true, 'two spaces between the groups'],
    ['เบอร์ 081\t234\n5678', true, 'a tab and a line break between the groups'],
    ['012 3-45678.9', true, 'mixed separators'],
    ['พร้อมเพย์ ๐๘๑๒๓๔๕๖๗๘', true, 'Thai digits in one piece'],
    ['บัญชี ๑๒๓-๔-๕๖๗๘๙-๐', true, 'Thai digits in groups'],
    ['บัญชี 123-4-๕๖๗๘๙-0', true, 'Thai and Arabic digits mixed'],
    // What looks like an exception but is not one.
    ['SCB-0123456789', true, 'a bank short name is not a document prefix'],
    ['KBANK-012-3-45678-9', true, 'a bank short name before a grouped number'],
    ['RB-0123456789', true, 'a document prefix without the year and running number'],
    ['ดูใบ RB-202609-0003 แล้วโอนเข้า 0123456789', true, 'a document number beside an account number'],
    ['โอน 0123456789 บาท', true, 'an amount never starts with 0'],
    ['โอน 1234567890 บาท', true, 'ten digits is not an amount'],
    ['ยอด 1500000', true, 'seven digits with nothing saying they are an amount'],
    ['123 4 56789 5 บาท', true, 'a grouped number is not an amount because บาท follows it'],
    // The product's own document numbers.
    ['RB-202609-0003', false, 'a claim number'],
    ['EXP-2026-10-000123', false, 'an expense number with the month apart'],
    ['ดูใบ RB-202609-00003 และ RBPAY-202610-00001', false, 'two document numbers in a sentence'],
    ['หนังสือรับรอง WHT-2026-00012', false, 'a yearly document number'],
    ['ใบเบิก rb-256910-0007', false, 'typed in lower case, Buddhist year'],
    // Plain amounts.
    ['ยอดเกิน 1500000 บาท', false, 'a plain amount in baht'],
    ['ยอด 1500000.50 บาท', false, 'a plain amount with satang'],
    ['ยอด 1,250.00 บาท เกินวงเงิน 500 บาท', false, 'amounts with separators'],
    ['ยอด ๑๕๐๐๐๐๐ บาท', false, 'a plain amount in Thai digits'],
    // Ordinary notes: dates, short references, counts.
    ['ยอดไม่ตรงกับใบเสร็จ', false, 'no digits at all'],
    ['ใบเสร็จลงวันที่ 01-10-2569 ไม่ตรงกับวันที่เบิก', false, 'a date with dashes'],
    ['วันที่ 2026-10-01 ซ้ำกับใบก่อน', false, 'an ISO date'],
    ['ใบเสร็จวันที่ 01/10/2569 และ 05/10/2569', false, 'dates with slashes'],
    ['ช่วงวันที่ 01/10/2569 - 05/10/2569', false, 'a date range'],
    ['วันที่ 1.10.2569', false, 'a date with dots'],
    ['ใบเสร็จเลขที่ 12345 ไม่ชัด', false, 'five digits'],
    ['รายการที่ 3 - 4 ไม่มีใบเสร็จ', false, 'line numbers'],
    ['แนบสลิป 2 ใบ ของวันที่ 5 - 6 ต.ค.', false, 'counts and days'],
    ['', false, 'empty'], ['   ', false, 'blank'],
    [undefined, false, 'not text'], [null, false, 'not text'], [1234567890, false, 'a number is not text'], [{ text: '0123456789' }, false, 'an object is not text'],
  ];

  it('refuses what reads as an account number and lets document numbers, amounts and dates through', () => {
    for (const [text, refused, why] of cases) assert.equal(looksLikeAccountNumber(text), refused, `${why}: ${JSON.stringify(text)}`);
    assert.ok(cases.filter(([, refused]) => refused).length >= 20 && cases.filter(([, refused]) => !refused).length >= 20);
  });
});

describe('payout: who may see the full number (one decision for the endpoint and the button)', () => {
  const nobody = { hasClaimAccount: true, isDraft: false, isRequester: false, isClaimApprover: false, canRecordPayment: false };

  it('answers the requester, that claim approver and the payment recorder, and nobody else', () => {
    assert.equal(payoutRevealGroup({ ...nobody, isRequester: true }), 'REQUESTER');
    assert.equal(payoutRevealGroup({ ...nobody, isClaimApprover: true }), 'APPROVER');
    assert.equal(payoutRevealGroup({ ...nobody, canRecordPayment: true }), 'PAYER');
    assert.equal(payoutRevealGroup(nobody), null);
  });

  it('has nothing to reveal on a cash or legacy claim, and keeps a draft to its requester', () => {
    assert.equal(payoutRevealGroup({ ...nobody, hasClaimAccount: false, isRequester: true, isClaimApprover: true, canRecordPayment: true }), null);
    assert.equal(payoutRevealGroup({ ...nobody, isDraft: true, isClaimApprover: true, canRecordPayment: true }), null);
    assert.equal(payoutRevealGroup({ ...nobody, isDraft: true, isRequester: true }), 'REQUESTER');
  });

  // The approver answer is the contracts rule (`isReimbursementClaimApprover`), the one the payment
  // slip uses too. These are the cases the account number depends on, asked of that rule.
  it('counts an approval only in the round the claim was last sent in', () => {
    const submittedAt = new Date('2026-10-01T03:00:00.000Z');
    const step = (overrides: Record<string, unknown> = {}) => ({ status: 'APPROVED' as const, decisionByUserId: 'approver-1', decidedAt: new Date('2026-10-01T04:00:00.000Z'), ...overrides });
    assert.equal(isReimbursementClaimApprover('approver-1', { submittedAt, approvalSteps: [step()] }), true);
    assert.equal(isReimbursementClaimApprover('someone-else', { submittedAt, approvalSteps: [step()] }), false);
    // Approved, then sent back and submitted again: that approval was of an earlier snapshot.
    assert.equal(isReimbursementClaimApprover('approver-1', { submittedAt, approvalSteps: [step({ decidedAt: new Date('2026-10-01T02:00:00.000Z') })] }), false);
    assert.equal(isReimbursementClaimApprover('approver-1', { submittedAt, approvalSteps: [step({ invalidatedAt: new Date() })] }), false);
    assert.equal(isReimbursementClaimApprover('approver-1', { submittedAt, approvalSteps: [step({ status: 'REJECTED' })] }), false);
    assert.equal(isReimbursementClaimApprover('approver-1', { submittedAt: undefined, approvalSteps: [step()] }), false, 'a draft has no approver');
  });
});

describe('payout: attestation binds to one snapshot version', () => {
  const transfer = { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 2, payoutFingerprint: 'f'.repeat(64) };

  it('refuses a transfer claim without it, and with any version but the current one', () => {
    assert.equal(payoutAttestationError(transfer, undefined), 'payout_verification_required');
    assert.equal(payoutAttestationError(transfer, null), 'payout_verification_required');
    assert.equal(payoutAttestationError(transfer, 1), 'payout_destination_changed');
    assert.equal(payoutAttestationError(transfer, '2'), 'payout_destination_changed', 'a look-alike is not the version');
    assert.equal(payoutAttestationError(transfer, true), 'payout_destination_changed');
    assert.equal(payoutAttestationError(transfer, 2), null);
  });

  it('asks nothing of a cash claim or a legacy claim', () => {
    for (const claim of [{ payoutMethod: 'CASH', payoutFingerprint: CASH_PAYOUT_FINGERPRINT }, {}, { payoutMethod: null, payoutDestinationVersion: null }]) {
      assert.equal(payoutAttestationError(claim, undefined), null);
      assert.equal(payoutAttestationError(claim, 7), null);
    }
  });
});

describe('payout: the claim is sent with the account its page showed', () => {
  const copy = { payoutMethod: 'BANK_TRANSFER' as const, followsDefault: true, version: 1, fingerprint: 'a'.repeat(64), action: 'COPY_DEFAULT' as const };

  it('names what a submit would freeze as an opaque token, and nothing when nothing can be sent', () => {
    const token = payoutSubmitToken('claim-1', copy)!;
    assert.match(token, /^[0-9a-f]{32}$/);
    assert.equal(payoutSubmitToken('claim-1', { ...copy }), token);
    assert.equal(payoutSubmitToken('claim-1', { error: 'payout_method_required' }), undefined);
    assert.equal(payoutSubmitToken('claim-1', { error: 'payout_destination_required' }), undefined);
    // It says nothing about the account: it is not the fingerprint and does not contain it.
    assert.ok(!token.includes(copy.fingerprint.slice(0, 8)));
  });

  it('changes when the account, the method or its origin changes, and is never shared by two claims', () => {
    const tokens = [
      payoutSubmitToken('claim-1', copy),
      payoutSubmitToken('claim-1', { ...copy, fingerprint: 'b'.repeat(64) }),
      payoutSubmitToken('claim-1', { ...copy, followsDefault: false, action: 'FREEZE' }),
      payoutSubmitToken('claim-1', { payoutMethod: 'CASH', followsDefault: true }),
      payoutSubmitToken('claim-1', { payoutMethod: 'CASH', followsDefault: false }),
      // The same default account on another claim: a reader of both learns nothing from the tokens.
      payoutSubmitToken('claim-2', copy),
    ];
    assert.equal(new Set(tokens).size, tokens.length);
    // The version and the freeze action are bookkeeping, not what the page showed: the same account
    // sent again after a withdraw keeps its token.
    assert.equal(payoutSubmitToken('claim-1', { ...copy, version: 2, action: 'REUSE' }), tokens[0]);
  });
});

describe('payout: what a submit freezes', () => {
  const frozen = (version: number, fingerprint: string, source: 'DEFAULT_ACCOUNT' | 'REQUESTER' | 'PREPARER' = 'DEFAULT_ACCOUNT') => ({ version, fingerprint, source, frozenAt: new Date('2026-10-01T00:00:00.000Z') });
  const account = (fingerprint: string) => ({ payoutMethod: 'BANK_TRANSFER' as const, fingerprint });

  it('never picks a method for a requester who has not chosen one', () => {
    assert.deepEqual(planSubmitPayout({}, [], null), { error: 'payout_method_required' });
    assert.deepEqual(planSubmitPayout({ payoutMethod: null }, [frozen(1, 'fp-a')], undefined), { error: 'payout_method_required' });
  });

  it('follows the default as it is at submit: cash needs no account, a transfer gets its own frozen copy', () => {
    assert.deepEqual(planSubmitPayout({}, [], { payoutMethod: 'CASH' }), { payoutMethod: 'CASH', followsDefault: true });
    assert.deepEqual(planSubmitPayout({}, [], account('fp-a')),
      { payoutMethod: 'BANK_TRANSFER', followsDefault: true, version: 1, fingerprint: 'fp-a', action: 'COPY_DEFAULT' });
    assert.deepEqual(planSubmitPayout({}, [], { payoutMethod: 'BANK_TRANSFER', fingerprint: null }), { error: 'payout_destination_required' });
  });

  it('keeps the version when the account is unchanged and takes the next one when it changed', () => {
    assert.deepEqual(planSubmitPayout({}, [frozen(1, 'fp-a')], account('fp-a')),
      { payoutMethod: 'BANK_TRANSFER', followsDefault: true, version: 1, fingerprint: 'fp-a', action: 'REUSE' });
    assert.deepEqual(planSubmitPayout({}, [frozen(1, 'fp-a')], account('fp-b')),
      { payoutMethod: 'BANK_TRANSFER', followsDefault: true, version: 2, fingerprint: 'fp-b', action: 'COPY_DEFAULT' });
    // The latest frozen version was an account named for this claim: following the default is a change.
    assert.deepEqual(planSubmitPayout({}, [frozen(2, 'fp-a', 'REQUESTER'), frozen(1, 'fp-a')], account('fp-a')),
      { payoutMethod: 'BANK_TRANSFER', followsDefault: true, version: 3, fingerprint: 'fp-a', action: 'COPY_DEFAULT' });
  });

  it('freezes the claim own account, or reuses it when it was frozen before and left untouched', () => {
    const working = { version: 2, fingerprint: 'fp-own', source: 'REQUESTER' as const, frozenAt: null };
    assert.deepEqual(planSubmitPayout({ payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 2 }, [working, frozen(1, 'fp-a')], account('fp-zzz')),
      { payoutMethod: 'BANK_TRANSFER', followsDefault: false, version: 2, fingerprint: 'fp-own', action: 'FREEZE' });
    assert.deepEqual(planSubmitPayout({ payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1 }, [frozen(1, 'fp-own', 'PREPARER')], null),
      { payoutMethod: 'BANK_TRANSFER', followsDefault: false, version: 1, fingerprint: 'fp-own', action: 'REUSE' });
    assert.deepEqual(planSubmitPayout({ payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 5 }, [frozen(1, 'fp-a')], account('fp-a')), { error: 'payout_destination_required' });
    assert.deepEqual(planSubmitPayout({ payoutMethod: 'CASH' }, [frozen(1, 'fp-a')], account('fp-a')), { payoutMethod: 'CASH', followsDefault: false });
  });

  it('a claim back in draft follows the default again only when its account was a copy of the default', () => {
    const versions = [{ version: 1, source: 'DEFAULT_ACCOUNT' as const }, { version: 2, source: 'REQUESTER' as const }];
    assert.equal(draftFollowsDefaultAfterReopen({ payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1 }, versions), true);
    assert.equal(draftFollowsDefaultAfterReopen({ payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 2 }, versions), false);
    assert.equal(draftFollowsDefaultAfterReopen({ payoutMethod: 'CASH' }, versions), false);
    assert.equal(draftFollowsDefaultAfterReopen({}, versions), false);
  });
});
