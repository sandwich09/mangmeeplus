import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  paymentReferenceRequired, validatePaymentForm, validateRequestForm, sumLineAmounts, summariseQueue,
  matchesSearch, formatMoney, parseHubTab, visibleHubTabs, errorMessage, errorText,
  isStaleApprovalError, diffApprovalFields,
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
  it('hides ตั้งค่านโยบาย from a custom role while preserving its other permitted tabs', () => {
    assert.deepEqual(
      visibleHubTabs(
        ['reimbursement.read_own', 'reimbursement.finance_review', 'reimbursement.policy.manage'],
        ['FINANCE'],
      ),
      ['mine', 'finance'],
    );
  });
  it('hides ตั้งค่านโยบาย when roles are empty or omitted', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.policy.manage'], []), []);
    assert.deepEqual(visibleHubTabs(['reimbursement.policy.manage']), []);
  });
  it('still requires policy.manage from an owner', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.read_own'], ['OWNER']), ['mine']);
  });
  it('hides ตั้งค่านโยบาย from a manager who only approves', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.read_own', 'reimbursement.approve']), ['mine', 'approvals']);
  });
  it('requires policy.manage for ตั้งค่านโยบาย — read alone is not enough', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.policy.manage'], ['OWNER']), ['policy']);
    // FINANCE holds policy.read but not .manage: the settings tab is OWNER/ADMIN only.
    assert.deepEqual(
      visibleHubTabs(['reimbursement.read_own', 'reimbursement.finance_review', 'reimbursement.policy.read'], ['FINANCE']),
      ['mine', 'finance'],
    );
  });
  it('shows nothing without a reimbursement permission (read-only viewers included)', () => {
    assert.deepEqual(visibleHubTabs([]), []);
    assert.deepEqual(visibleHubTabs(['reimbursement.read', 'expense.read']), []);
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
  it('falls back to the raw text for unknown codes and free-form messages', () => {
    assert.equal(errorMessage('brand_new_server_code'), 'brand_new_server_code');
    assert.equal(errorMessage('เกิดข้อผิดพลาด'), 'เกิดข้อผิดพลาด');
    assert.equal(errorMessage('Request failed (500)'), 'Request failed (500)');
    assert.equal(errorMessage(''), '');
  });
});

describe('errorText', () => {
  it('answers from the object code when the message is the synthetic API error text', () => {
    const denied = Object.assign(new Error('API error 403'), { status: 403, code: 'feature_not_enabled' });
    assert.equal(errorText(denied), 'ยังไม่ได้เปิดฟีเจอร์นี้');
    const domain = Object.assign(new Error('API error 400'), { status: 400, code: 'missing_receipt' });
    assert.match(errorText(domain), /ใบเสร็จ/);
  });
  it('falls back to message translation and the generic non-Error copy', () => {
    assert.match(errorText(new Error('lines_required')), /1 รายการ/);
    assert.equal(errorText(undefined), 'เกิดข้อผิดพลาด');
  });
});

describe('formatMoney', () => {
  it('formats to 2 decimals', () => {
    assert.equal(formatMoney('500'), '500.00');
  });
});
