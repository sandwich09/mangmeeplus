import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaxCodeDefinitionDto } from '@watchdog-bms/contracts';
import { missingConfiguration, validateAccountRuleSemantic, validateReportRuleSemantic, validateTaxCodeDefinition } from './tax-configuration.logic';

const definition: TaxCodeDefinitionDto = {
  id: 'o7', companyId: 'c1', profileId: 'p1', externalCode: 'O7', displayName: 'Output VAT 7%', taxRegime: 'VAT', direction: 'OUTPUT',
  treatment: 'STANDARD', transactionContexts: ['DOMESTIC_SALE'], rate: '7', calculationMethod: 'EXCLUSIVE', sapAccountKey: null,
  claimabilityDefault: 'NOT_APPLICABLE', evidenceRuleKey: null, status: 'REVIEW_REQUIRED', effectiveFrom: '2026-01-01', effectiveTo: null,
  version: 1, reviewedByUserId: null, reviewedAt: null,
};

describe('tax configuration semantics', () => {
  it('rejects wrong role and posting side', () => {
    assert.match(validateAccountRuleSemantic(definition, { accountRole: 'INPUT_VAT_CLAIMABLE', postingSide: 'DEBIT' }) ?? '', /not valid/);
    assert.equal(validateAccountRuleSemantic(definition, { accountRole: 'OUTPUT_VAT_PAYABLE', postingSide: 'CREDIT' }), null);
  });

  it('keeps zero-rated and exempt boxes distinct', () => {
    const zero = { ...definition, externalCode: 'O0', treatment: 'ZERO_RATED' as const, rate: '0' };
    assert.match(validateReportRuleSemantic(zero, { formType: 'PP30', boxKey: 'box_3_exempt_sales', amountSource: 'TAX_BASE' }) ?? '', /not valid/);
    assert.equal(validateReportRuleSemantic(zero, { formType: 'PP30', boxKey: 'box_2_zero_rated_sales', amountSource: 'TAX_BASE' }), null);
  });

  it('requires paired PP36 accounts and does not accept mixed PP30 output mapping', () => {
    const pp36 = { ...definition, direction: 'SELF_ASSESSED' as const, treatment: 'REVERSE_CHARGE' as const, transactionContexts: ['IMPORT_SERVICE' as const], claimabilityDefault: 'CLAIMABLE' as const };
    assert.match(validateReportRuleSemantic(pp36, { formType: 'PP30', boxKey: 'box_5_output_tax', amountSource: 'TAX_AMOUNT' }) ?? '', /not valid/);
    assert.deepEqual(missingConfiguration(pp36, [], []), [
      'account:PP36_OUTPUT_VAT_PAYABLE/CREDIT', 'account:INPUT_VAT_PENDING/DEBIT', 'account:PP36_INPUT_VAT_CLAIMABLE/DEBIT',
      'report:PP36/tax_due/TAX_AMOUNT', 'report:PP30/box_6_eligible_purchases/TAX_BASE', 'report:PP30/box_7_input_tax/TAX_AMOUNT',
    ]);
  });

  it('allows scoped import component roles and customs-support mappings', () => {
    const imported = { ...definition, taxRegime: 'IMPORT_VAT' as const, direction: 'INPUT' as const, treatment: 'CLAIMABLE' as const, transactionContexts: ['IMPORT_GOODS' as const], claimabilityDefault: 'CLAIMABLE' as const };
    assert.equal(validateAccountRuleSemantic(imported, {
      taxRegime: 'CUSTOMS_DUTY', direction: 'INPUT', treatment: 'NONDEDUCTIBLE_CAPITALIZED', transactionContext: 'IMPORT_GOODS',
      accountRole: 'CUSTOMS_DUTY_PAYABLE', postingSide: 'CREDIT',
    } as any), null);
    assert.equal(validateReportRuleSemantic(imported, { formType: 'CUSTOMS_SUPPORT', boxKey: 'customs_duty', amountSource: 'DUTY' }), null);
  });

  it('rejects invalid rate/method/context and unsupported partial deduction', () => {
    assert.ok(validateTaxCodeDefinition({ ...definition, rate: '7', calculationMethod: 'NONE', claimabilityDefault: 'PARTIAL' }).length >= 2);
    assert.ok(validateTaxCodeDefinition({ ...definition, direction: 'OUTPUT', transactionContexts: ['IMPORT_GOODS'] }).some((error) => error.includes('incompatible')));
  });
});
