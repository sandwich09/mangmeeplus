import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateExpectation, matchesExpected, moneyMinorUnits } from './run-line-ai-controlled-image-replay.mjs';

describe('controlled image expectation comparison', () => {
  it('compares receipt money as exact minor units despite display separators', () => {
    assert.equal(moneyMinorUnits('2,890.00'), '289000');
    assert.equal(matchesExpected('fields.grandTotalAmount', '2,890.00', ['2890.00']), true);
    assert.equal(matchesExpected('fields.vatAmount', '189.07', ['189.07']), true);
    assert.equal(matchesExpected('fields.vatAmount', '189.08', ['189.07']), false);
  });

  it('does not coerce non-money expectations or malformed money', () => {
    assert.equal(matchesExpected('status', 'ok', ['OK']), false);
    assert.equal(matchesExpected('fields.grandTotalAmount', '2,890.009', ['2890.00']), false);
  });

  it('requires an ambiguous handwritten date to remain explicitly missing', () => {
    assert.deepEqual(
      evaluateExpectation({ fields: { missingFields: ['expenseDate', 'category'] } }, 'fields.missingFieldsIncludes', ['expenseDate']),
      { actual: 'category|expenseDate', passed: true },
    );
    assert.equal(
      evaluateExpectation({ fields: { missingFields: ['category'] } }, 'fields.missingFieldsIncludes', ['expenseDate']).passed,
      false,
    );
  });
});
