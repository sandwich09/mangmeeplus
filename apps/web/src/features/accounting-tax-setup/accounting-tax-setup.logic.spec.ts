import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaxCodeDefinitionDto } from '@watchdog-bms/contracts';
import {
  accountingTaxSetupHref,
  earliestAccountingTaxSetupStep,
  guidedAccountRuleInput,
  guidedReportRuleInput,
  safeAccountingReturnTo,
} from './accounting-tax-setup.logic';

describe('accounting/tax setup routing', () => {
  // `mode` is gone: the guided wizard installs the standard Thai set and never offered a choice
  // the shop owner it is written for could evaluate. SAP profiles live on the Tax Code page.
  it('preserves only explicit workflow context in route links', () => {
    assert.equal(
      accountingTaxSetupHref('c1', 'mappings', { profileId: 'p1', returnTo: '/companies/c1/expenses?expenseId=e1' }),
      '/companies/c1/settings/accounting-tax-setup/mappings?profileId=p1&returnTo=%2Fcompanies%2Fc1%2Fexpenses%3FexpenseId%3De1',
    );
  });

  it('accepts only same-company workspace return targets', () => {
    assert.equal(safeAccountingReturnTo('c1', '/companies/c1/expenses?expenseId=e1'), '/companies/c1/expenses?expenseId=e1');
    assert.equal(safeAccountingReturnTo('c1', '/companies/c2/expenses?expenseId=e1'), null);
    assert.equal(safeAccountingReturnTo('c1', 'https://evil.example/companies/c1/expenses'), null);
    assert.equal(safeAccountingReturnTo('c1', '//evil.example/companies/c1/expenses'), null);
  });

  it('resumes at the earliest incomplete server-derived step', () => {
    assert.equal(earliestAccountingTaxSetupStep({ prerequisitesReady: false, chartReady: false }), 'prerequisites');
    assert.equal(earliestAccountingTaxSetupStep({ prerequisitesReady: true, chartReady: false }), 'chart');
    assert.equal(earliestAccountingTaxSetupStep({ prerequisitesReady: true, chartReady: true }), 'profile');
    assert.equal(earliestAccountingTaxSetupStep({ prerequisitesReady: true, chartReady: true, profileId: 'p1', profileReady: false }), 'mappings');
    assert.equal(earliestAccountingTaxSetupStep({ prerequisitesReady: true, chartReady: true, profileId: 'p1', profileReady: true }), 'review');
  });

  it('builds only server-requested reviewed mapping payloads', () => {
    const definition: TaxCodeDefinitionDto = {
      id: 'd1', companyId: 'c1', profileId: 'p1', externalCode: 'V7', displayName: 'VAT 7',
      taxRegime: 'VAT', direction: 'INPUT', treatment: 'CLAIMABLE',
      transactionContexts: ['DOMESTIC_PURCHASE'], rate: '7', calculationMethod: 'EXCLUSIVE',
      sapAccountKey: null, claimabilityDefault: 'CLAIMABLE', evidenceRuleKey: null,
      status: 'REVIEW_REQUIRED', effectiveFrom: '2026-01-01', effectiveTo: null,
      version: 1, reviewedByUserId: null, reviewedAt: null,
    };
    assert.deepEqual(
      guidedAccountRuleInput(definition, {
        code: 'missing_account_rule', kind: 'ACCOUNT_RULE', taxCodeDefinitionId: 'd1',
        accountRole: 'INPUT_VAT_CLAIMABLE', postingSide: 'DEBIT',
      }, 'a1'),
      {
        taxCodeDefinitionId: 'd1', taxRegime: 'VAT', direction: 'INPUT', treatment: 'CLAIMABLE',
        transactionContext: 'DOMESTIC_PURCHASE', sourceModule: null,
        accountRole: 'INPUT_VAT_CLAIMABLE', accountId: 'a1', postingSide: 'DEBIT', priority: 100,
        effectiveFrom: '2026-01-01', effectiveTo: null,
      },
    );
    assert.equal(
      guidedReportRuleInput(definition, {
        code: 'missing_report_rule', kind: 'REPORT_RULE', taxCodeDefinitionId: 'd1',
        formType: 'PP30', boxKey: 'box_7_input_tax', amountSource: 'TAX_AMOUNT',
      }).signRule,
      'NORMAL',
    );
    assert.throws(() => guidedAccountRuleInput(definition, { code: 'other', kind: 'ACCOUNT_RULE' }, 'a1'), /invalid_guided/);
  });
});
