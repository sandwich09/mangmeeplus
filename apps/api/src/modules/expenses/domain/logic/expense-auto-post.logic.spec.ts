import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expenseAutoPostBlockers, nextExpensePostingSource } from './expense-auto-post.logic';

describe('expense Auto-post rules', () => {
  it('accepts clean and supporting-only evidence', () => {
    assert.deepEqual(expenseAutoPostBlockers({
      activeEvidenceCount: 1,
      taxEvidenceStatus: 'SUPPORTING_ONLY',
      vendorNameSnapshot: 'ร้านป้าแดง',
    }), []);
  });

  it('returns every evidence warning without blocking on informational evidence', () => {
    assert.deepEqual(expenseAutoPostBlockers({
      activeEvidenceCount: 0,
      taxEvidenceStatus: 'NEEDS_REVIEW',
      vendorNameSnapshot: ' ',
    }), ['NO_ACTIVE_EVIDENCE', 'TAX_EVIDENCE_NEEDS_REVIEW', 'VENDOR_NAME_MISSING']);
    assert.deepEqual(expenseAutoPostBlockers({
      activeEvidenceCount: 1,
      taxEvidenceStatus: 'NOT_TAX_EVIDENCE',
      vendorNameSnapshot: 'vendor',
    }), ['NOT_TAX_EVIDENCE']);
  });

  it('resolves accrual before a later plain-expense payment leg', () => {
    assert.equal(nextExpensePostingSource({
      paymentStatus: 'PAID',
      sourceReimbursementRequestId: null,
      generatedSourceTypes: new Set(),
    }), 'expense.record');
    assert.equal(nextExpensePostingSource({
      paymentStatus: 'PAID',
      sourceReimbursementRequestId: null,
      generatedSourceTypes: new Set(['expense.record']),
    }), 'expense.payment');
  });

  it('does not create an expense payment leg for claim expenses or completed sources', () => {
    assert.equal(nextExpensePostingSource({
      paymentStatus: 'PAID',
      sourceReimbursementRequestId: 'claim-1',
      generatedSourceTypes: new Set(['expense.record']),
    }), null);
    assert.equal(nextExpensePostingSource({
      paymentStatus: 'PAID',
      sourceReimbursementRequestId: null,
      generatedSourceTypes: new Set(['expense.record', 'expense.payment']),
    }), null);
    assert.equal(nextExpensePostingSource({
      paymentStatus: 'PARTIALLY_PAID',
      sourceReimbursementRequestId: null,
      generatedSourceTypes: new Set(['expense.record']),
    }), null);
  });
});
