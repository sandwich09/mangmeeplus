import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canOpenManualWeb } from './manual-expense-entry.logic';

// manual-expense-web-entry-flag spec §6.1–6.2: the one predicate behind every web entrance to the
// manual expense page. The API decides what a company without a row reads as; the web only ever
// sees the boolean, and reads a MISSING boolean as shown.
describe('canOpenManualWeb', () => {
  const session = (over: Record<string, unknown> = {}) => ({
    companyId: 'co-1', permissions: ['expense.read_own', 'expense.create', 'expense.update'], ...over,
  });

  it('follows the value the API answered for the company', () => {
    assert.equal(canOpenManualWeb(session({ manualExpenseWebEntry: true }), 'co-1'), true);
    assert.equal(canOpenManualWeb(session({ manualExpenseWebEntry: false }), 'co-1'), false);
  });

  it('shows the entrance when the field is missing or unreadable (an older API, a glitch)', () => {
    assert.equal(canOpenManualWeb(session(), 'co-1'), true);
    for (const value of [undefined, null, 'false', 0, '']) {
      assert.equal(canOpenManualWeb(session({ manualExpenseWebEntry: value }) as never, 'co-1'), true, JSON.stringify(value));
    }
  });

  it('never opens for a session without expense.create, whatever the setting says', () => {
    for (const manualExpenseWebEntry of [true, false, undefined]) {
      const readOnly = session({ permissions: ['expense.read', 'expense.update', 'expense.receipt.upload'], manualExpenseWebEntry });
      assert.equal(canOpenManualWeb(readOnly, 'co-1'), false, JSON.stringify(manualExpenseWebEntry));
    }
  });

  it('never uses the value of another company, and has no answer without a session', () => {
    assert.equal(canOpenManualWeb(session({ manualExpenseWebEntry: true }), 'co-2'), false);
    assert.equal(canOpenManualWeb(session({ companyId: 'co-2', manualExpenseWebEntry: true }), 'co-1'), false);
    assert.equal(canOpenManualWeb(null, 'co-1'), false);
    assert.equal(canOpenManualWeb(undefined, 'co-1'), false);
  });
});
