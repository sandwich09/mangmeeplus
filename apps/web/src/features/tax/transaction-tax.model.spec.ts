import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TaxCodeDefinitionDto } from '@watchdog-bms/contracts';
import {
  availableTaxDefinitions,
  taxChoiceLabel,
  deriveTaxHeaderSummary,
  isReceiptTaxCodeAllowed,
  isTaxSourceLocked,
  pp30SalesSideRecorded,
  taxDefinitionRateForSource,
  taxCodeImportDiagnosticMessage,
  transactionTaxCapabilities,
  transactionTaxDiagnosticMessage,
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
    assert.match(transactionTaxErrorMessage({ status: 422, code: 'tax_profile_incomplete' }), /ชุดตั้งค่าภาษี/);
  });

  it('reports an entitlement 403 as feature-not-enabled, not as a permission denial', () => {
    assert.equal(transactionTaxErrorMessage({ status: 403, code: 'feature_not_enabled' }), 'ยังไม่ได้เปิดฟีเจอร์นี้');
    // A plain permission 403 (no code) keeps the permission copy.
    assert.equal(transactionTaxErrorMessage({ status: 403 }), 'คุณไม่มีสิทธิ์ทำรายการนี้ ขอสิทธิ์จากผู้ดูแลสิทธิ์');
  });

  it('renders success-payload tax diagnostics without exposing unknown server text', () => {
    assert.match(transactionTaxDiagnosticMessage('tax_account_rule_missing:INPUT_VAT_CLAIMABLE'), /ผูกบัญชี/);
    assert.match(transactionTaxDiagnosticMessage('tax_evidence_required'), /แนบหลักฐาน/);
    assert.equal(
      transactionTaxDiagnosticMessage('select * from hidden_table'),
      'ตรวจสอบภาษีรายการนี้ไม่สำเร็จ ติดต่อผู้ดูแลการตั้งค่าภาษี',
    );
  });

  it('renders import diagnostics as actionable Thai and fails closed for unknown text', () => {
    assert.equal(taxCodeImportDiagnosticMessage('externalCode is required'), 'ระบุรหัส Tax Code (externalCode)');
    assert.match(taxCodeImportDiagnosticMessage('STANDARD requires a positive rate and tax calculation method'), /อัตราภาษีมากกว่า 0/);
    assert.equal(
      taxCodeImportDiagnosticMessage('Prisma constraint secret'),
      'ข้อมูล Tax Code ในแถวนี้ไม่ถูกต้อง ตรวจสอบรูปแบบไฟล์',
    );
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


it('PWS-VAT-CHOICE changes only standard expense INPUT labels and preserves custom names and stored values', () => {
  for (const [externalCode, word, claimabilityDefault] of [['V7', 'ได้', 'CLAIMABLE'], ['ND', 'ไม่ได้', 'NONDEDUCTIBLE_EXPENSE']] as const) {
    const item = definition({ externalCode, displayName: `ภาษีซื้อขอคืน${word} 7%`, direction: 'INPUT', claimabilityDefault });
    const before = JSON.stringify(item);
    assert.equal(taxChoiceLabel(item, 'expense.record', 'INPUT'), `ใช้ VAT ตอนยื่นภาษี${word} 7%`);
    for (const source of ['procurement.vendor_bill', 'sales.invoice', 'tax.configuration']) assert.equal(taxChoiceLabel(item, source, 'INPUT'), item.displayName);
    assert.equal(taxChoiceLabel(item, 'expense.record', 'OUTPUT'), item.displayName);
    assert.equal(taxChoiceLabel({ ...item, displayName: 'รูปแบบพิเศษของร้าน 7%' }, 'expense.record', 'INPUT'), 'รูปแบบพิเศษของร้าน 7%');
    assert.equal(JSON.stringify(item), before);
  }
  for (const rate of ['0', '6.5', 'unknown']) {
    const item = definition({ displayName: 'รูปแบบของร้าน', rate });
    assert.equal(taxChoiceLabel(item, 'expense.record', 'INPUT'), rate === 'unknown' ? item.displayName : `${item.displayName} ${rate}%`);
  }
});

it('PWS-VAT-CHOICE expense diagnostics stay plain while other callers retain their words', () => {
  assert.equal(transactionTaxDiagnosticMessage('tax_code_not_active_or_not_applicable:V7', 'expense.record', 'INPUT'), 'รูปแบบ VAT นี้ใช้กับรายการหรือวันที่นี้ไม่ได้ เลือกรูปแบบอื่น');
  for (const code of ['tax_code_ambiguous', 'tax_account_rule_missing', 'tax_account_rule_ambiguous', 'tax_report_rule_missing']) {
    assert.equal(transactionTaxDiagnosticMessage(code, 'expense.record', 'INPUT'), 'ยังตรวจ VAT ของรายการนี้ไม่ได้ ให้ผู้ทำบัญชีตรวจการตั้งค่า');
  }
  assert.equal(transactionTaxDiagnosticMessage('tax_evidence_required', 'expense.record', 'INPUT'), 'แนบเอกสารประกอบรายการนี้ก่อนทำต่อ');
  assert.match(transactionTaxDiagnosticMessage('tax_account_rule_missing'), /ผูกบัญชี/);
});


import { workspaceDictionary } from '../../common/i18n/workspace-dictionary';
it('PWS-DICTIONARY-AUDIT capture copy distinguishes VAT and withholding amounts without changing stored tax words', () => {
  assert.equal(workspaceDictionary.en['expenses.wht_base'], 'Amount used to calculate withholding (THB)');
  assert.equal(workspaceDictionary.en['expenses.manual_tax_section'], 'VAT details');
  assert.equal(workspaceDictionary.en['expenses.manual_no_tax_code'], 'No VAT option selected');
  assert.equal(workspaceDictionary.th['expenses.buyer_match_undo'], 'ยกเลิกเครื่องหมาย');
});
