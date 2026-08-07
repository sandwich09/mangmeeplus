import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateTaxCodeDefinition } from './logic/tax-configuration.logic.js';
import { TAX_CODE_PROFILE_TEMPLATES } from './tax-code-template.catalog.js';

describe('Tax Code profile template catalog', () => {
  it('ships the focused WatchDog preset and both SAP Thailand profiles as review-gated, semantically valid definitions', () => {
    assert.deepEqual(TAX_CODE_PROFILE_TEMPLATES.map((item) => item.key), [
      'WATCHDOG_TH_DOMESTIC_EXPENSE_V1',
      'SAP_ERP_TH_LEGACY',
      'SAP_S4_TH_CURRENT',
    ]);
    for (const template of TAX_CODE_PROFILE_TEMPLATES) {
      if (template.sourceSystem.startsWith('SAP_')) assert.ok(template.sourceUrl?.startsWith('https://help.sap.com/'));
      assert.ok(template.definitions.length > 0);
      assert.equal(new Set(template.definitions.map((item) => `${item.direction}:${item.externalCode}`)).size, template.definitions.length);
      for (const definition of template.definitions) {
        assert.deepEqual(validateTaxCodeDefinition({ ...definition, effectiveFrom: '2026-01-01', effectiveTo: null }), [], `${template.key}:${definition.externalCode}`);
      }
    }
  });

  it('keeps the ambiguous O1 meaning scoped to its profile', () => {
    const legacy = TAX_CODE_PROFILE_TEMPLATES.find((item) => item.key === 'SAP_ERP_TH_LEGACY')!.definitions.find((item) => item.externalCode === 'O1');
    const current = TAX_CODE_PROFILE_TEMPLATES.find((item) => item.key === 'SAP_S4_TH_CURRENT')!.definitions.find((item) => item.externalCode === 'O1');
    assert.equal(legacy?.rate, '10');
    assert.equal(current?.rate, '7');
  });

  it('keeps the WatchDog preset domestic and excludes no-VAT lines from Tax Codes', () => {
    const watchdog = TAX_CODE_PROFILE_TEMPLATES.find((item) => item.key === 'WATCHDOG_TH_DOMESTIC_EXPENSE_V1')!;
    assert.deepEqual(watchdog.definitions.map((item) => item.externalCode), ['V7', 'ND']);
    assert.ok(watchdog.definitions.every((item) => item.direction === 'INPUT'
      && item.transactionContexts.length === 1
      && item.transactionContexts[0] === 'DOMESTIC_PURCHASE'));
  });
});
