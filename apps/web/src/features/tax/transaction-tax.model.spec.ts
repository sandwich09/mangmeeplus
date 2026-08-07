import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TaxCodeDefinitionDto } from '@watchdog-bms/contracts';
import {
  availableTaxDefinitions,
  deriveTaxHeaderSummary,
  isReceiptTaxCodeAllowed,
  isTaxSourceLocked,
  pp30SalesSideRecorded,
  taxDefinitionRateForSource,
  transactionTaxCapabilities,
  transactionTaxErrorMessage,
} from './transaction-tax.model.js';

const definition = (overrides: Partial<TaxCodeDefinitionDto>): TaxCodeDefinitionDto => ({
  id: 'tax-1', companyId: 'company-1', profileId: 'profile-1', externalCode: 'O7',
  displayName: 'VAT 7%', taxRegime: 'VAT', direction: 'OUTPUT', treatment: 'STANDARD',
  transactionContexts: ['DOMESTIC_SALE'], rate: '7', calculationMethod: 'EXCLUSIVE',
  sapAccountKey: null, claimabilityDefault: 'NOT_APPLICABLE', evidenceRuleKey: null,
  status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null, version: 1,
  reviewedByUserId: null, reviewedAt: null, ...overrides,
});

describe('transaction tax web model', () => {
  it('filters line Tax Codes by active status, context, direction, and effective date', () => {
    const rows = [
      definition({ id: 'sale', externalCode: 'O7' }),
      definition({ id: 'purchase', externalCode: 'V1', direction: 'INPUT', transactionContexts: ['DOMESTIC_PURCHASE'] }),
      definition({ id: 'old', externalCode: 'O1', effectiveTo: '2025-12-31' }),
      definition({ id: 'draft', externalCode: 'OX', status: 'DRAFT' }),
    ];
    assert.deepEqual(
      availableTaxDefinitions(rows, { context: 'DOMESTIC_SALE', direction: 'OUTPUT', documentDate: '2026-07-14' }).map((row) => row.id),
      ['sale'],
    );
  });

  it('derives NONE, SINGLE, and MIXED from line-level ids', () => {
    assert.equal(deriveTaxHeaderSummary([]), 'NONE');
    assert.equal(deriveTaxHeaderSummary([{ taxCodeDefinitionId: 'a' }, { taxCodeDefinitionId: 'a' }]), 'SINGLE');
    assert.equal(deriveTaxHeaderSummary([{ taxCodeDefinitionId: 'a' }, { taxCodeDefinitionId: 'b' }]), 'MIXED');
  });

  it('keeps receipts no-code and finalized sources immutable', () => {
    assert.equal(isReceiptTaxCodeAllowed('RECEIPT'), false);
    assert.equal(isReceiptTaxCodeAllowed('QUOTATION'), false);
    assert.equal(isReceiptTaxCodeAllowed('BILLING_NOTE'), false);
    assert.equal(isReceiptTaxCodeAllowed('INVOICE'), false);
    assert.equal(isReceiptTaxCodeAllowed('TAX_INVOICE'), true);
    assert.equal(isTaxSourceLocked('ISSUED'), true);
    assert.equal(isTaxSourceLocked('DRAFT'), false);
  });

  it('requires both tax visibility and ledger manage permission for account mapping', () => {
    assert.equal(transactionTaxCapabilities(['ledger.posting-rule.manage']).canManageAccountRules, false);
    assert.equal(transactionTaxCapabilities(['tax.config.read', 'ledger.posting-rule.manage']).canManageAccountRules, false);
    assert.equal(transactionTaxCapabilities(['tax.config.manage', 'ledger.posting-rule.manage']).canManageAccountRules, true);
  });

  it('separates evidence preparation from accountant verification', () => {
    const finance = transactionTaxCapabilities(['tax.review_issue.resolve']);
    assert.equal(finance.canPrepareEvidence, true);
    assert.equal(finance.canVerifyEvidence, false);
    const accountant = transactionTaxCapabilities(['tax.config.manage']);
    assert.equal(accountant.canPrepareEvidence, true);
    assert.equal(accountant.canVerifyEvidence, true);
  });

  it('renders stable conflict and incomplete-profile messages', () => {
    assert.match(transactionTaxErrorMessage({ status: 409 }), /ซ้ำ/);
    assert.match(transactionTaxErrorMessage({ status: 422, code: 'tax_profile_incomplete' }), /โปรไฟล์/);
  });

  it('reports an entitlement 403 as feature-not-enabled, not as a permission denial', () => {
    assert.equal(transactionTaxErrorMessage({ status: 403, code: 'feature_not_enabled' }), 'ยังไม่ได้เปิดฟีเจอร์นี้');
    // A plain permission 403 (no code) keeps the permission copy.
    assert.equal(transactionTaxErrorMessage({ status: 403 }), 'คุณไม่มีสิทธิ์ดำเนินการนี้');
  });

  it('adapts VAT rate units only for legacy expense inputs', () => {
    assert.equal(taxDefinitionRateForSource('7', 'expense'), '0.07');
    assert.equal(taxDefinitionRateForSource('7', 'procurement'), '7');
    assert.equal(taxDefinitionRateForSource('7', 'accounting'), '7');
  });

  it('treats ภ.พ.30 box 8/9 as meaningless until any sales-side box has data', () => {
    const purchasesOnly = {
      box1TotalSales: '0.00', box2ZeroRatedSales: '0.00', box3ExemptSales: '0.00',
      box4TaxableSales: '0.00', box5OutputTax: '0.00',
    };
    assert.equal(pp30SalesSideRecorded(purchasesOnly), false);
    // Any sales-side box — including a zero-rated-only exporter with no output tax — counts.
    assert.equal(pp30SalesSideRecorded({ ...purchasesOnly, box2ZeroRatedSales: '100.00' }), true);
    assert.equal(pp30SalesSideRecorded({ ...purchasesOnly, box5OutputTax: '7.00' }), true);
  });
});
