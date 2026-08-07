import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { suggestedLineTaxCode } from './transaction-tax.model';

const OFFERED = [{ externalCode: 'O7' }, { externalCode: 'OX' }];

describe('suggestedLineTaxCode (spec §7, §12)', () => {
  it('suggests the category default when the picker is already offering it', () => {
    assert.equal(suggestedLineTaxCode({
      categoryDefaultInputTaxCode: 'O7', lineHasTaxCode: false, available: OFFERED,
    }), 'O7');
  });

  // AC3. The reviewer's own choice is never replaced, cleared or overridden.
  it('leaves a line that already has a Tax Code alone', () => {
    assert.equal(suggestedLineTaxCode({
      categoryDefaultInputTaxCode: 'O7', lineHasTaxCode: true, available: OFFERED,
    }), null);
  });

  it('suggests nothing when the category has no default', () => {
    assert.equal(suggestedLineTaxCode({
      categoryDefaultInputTaxCode: null, lineHasTaxCode: false, available: OFFERED,
    }), null);
  });

  // E1/E2/E4 all reach this function the same way: the picker's filter already dropped the code,
  // so an unresolvable default is indistinguishable from an absent one — which is the point.
  // A stale suggestion must never become a wrong pre-fill.
  it('suggests nothing when the code is not among what the picker offers', () => {
    for (const available of [OFFERED, [] as Array<{ externalCode: string }>]) {
      assert.equal(suggestedLineTaxCode({
        categoryDefaultInputTaxCode: 'RETIRED_CODE', lineHasTaxCode: false, available,
      }), null);
    }
  });

  // E5: a company with no Tax Code profile offers nothing, so nothing is suggested.
  it('suggests nothing when the company offers no codes at all', () => {
    assert.equal(suggestedLineTaxCode({
      categoryDefaultInputTaxCode: 'O7', lineHasTaxCode: false, available: [],
    }), null);
  });

  it('matches on the exact code, not a prefix', () => {
    assert.equal(suggestedLineTaxCode({
      categoryDefaultInputTaxCode: 'O', lineHasTaxCode: false, available: OFFERED,
    }), null);
  });
});
