import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expenseVatBlockedWayOut } from './expenses.model';

// The requirement in one file: a blocked receipt always names a next step. Before this, a confirmer
// looking at a document whose every line was read as exempt got the refusal and an empty panel —
// the override form is correctly withheld there (the difference cannot be hung on a ยกเว้น line),
// but withholding it silently is what turned a rule into a dead end.
describe('a blocked VAT reconciliation always offers a way out', () => {
  const cases = [
    { canConfirm: true, vatCarrierLineCount: 2 },
    { canConfirm: true, vatCarrierLineCount: 1 },
    { canConfirm: true, vatCarrierLineCount: 0 },
    { canConfirm: false, vatCarrierLineCount: 2 },
    { canConfirm: false, vatCarrierLineCount: 0 },
  ];

  it('never leaves the reviewer without a named next step', () => {
    for (const input of cases) {
      const wayOut = expenseVatBlockedWayOut(input);
      assert.ok(wayOut, `no way out for ${JSON.stringify(input)}`);
    }
  });

  it('offers the override only where the difference has a VAT-bearing line to land on', () => {
    assert.equal(expenseVatBlockedWayOut({ canConfirm: true, vatCarrierLineCount: 1 }), 'OVERRIDE_FORM');
    assert.equal(expenseVatBlockedWayOut({ canConfirm: true, vatCarrierLineCount: 0 }), 'SET_VAT_RATE_FIRST',
      'an all-exempt document is told to give the taxed rows a rate, not shown an unusable form');
  });

  it('tells someone who cannot confirm who has to finish it, rather than showing nothing', () => {
    assert.equal(expenseVatBlockedWayOut({ canConfirm: false, vatCarrierLineCount: 2 }), 'NEEDS_CONFIRMER');
  });
});
