import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaxAccountDeterminationRuleDto, TaxCodeDefinitionDto, TaxReportMappingRuleDto, TransactionTaxLineInput } from '@watchdog-bms/contracts';
import { aggregatePp30Boxes, aggregateTaxRoundingPolicy, deriveTaxHeaderSummary, legacyOutputTaxCodeSnapshot, resolveTransactionTaxPreview } from './transaction-tax.logic';

const current = (id: string, externalCode: string, treatment: TaxCodeDefinitionDto['treatment'], rate: string, context: TaxCodeDefinitionDto['transactionContexts'][number], direction: TaxCodeDefinitionDto['direction'] = 'OUTPUT'): TaxCodeDefinitionDto => ({
  id, companyId: 'c1', profileId: id.startsWith('erp') ? 'erp' : 's4', externalCode, displayName: externalCode,
  taxRegime: 'VAT', direction, treatment, transactionContexts: [context], rate,
  calculationMethod: rate === '0' ? 'NONE' : 'EXCLUSIVE', sapAccountKey: null,
  claimabilityDefault: direction === 'OUTPUT' ? 'NOT_APPLICABLE' : 'CLAIMABLE', evidenceRuleKey: context.startsWith('EXPORT_') ? 'EXPORT' : null,
  status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null, version: 1, reviewedByUserId: 'u1', reviewedAt: '2026-01-01',
});

const accountRule = (definition: TaxCodeDefinitionDto): TaxAccountDeterminationRuleDto => ({
  id: `a-${definition.id}`, companyId: 'c1', taxCodeDefinitionId: definition.id, taxRegime: definition.taxRegime,
  direction: definition.direction, treatment: definition.treatment, transactionContext: definition.transactionContexts[0]!, sourceModule: null,
  accountRole: definition.direction === 'OUTPUT' ? 'OUTPUT_VAT_PAYABLE' : 'INPUT_VAT_CLAIMABLE', accountId: definition.direction === 'OUTPUT' ? 'output-vat' : 'input-vat',
  postingSide: definition.direction === 'OUTPUT' ? 'CREDIT' : 'DEBIT',
  priority: 100, status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null, version: 1,
});

const reportRules = (definition: TaxCodeDefinitionDto): TaxReportMappingRuleDto[] => {
  const base = { companyId: 'c1', taxCodeDefinitionId: definition.id, formType: 'PP30' as const, signRule: 'NORMAL' as const, status: 'ACTIVE' as const, effectiveFrom: '2026-01-01', effectiveTo: null, version: 1 };
  if (definition.treatment === 'ZERO_RATED') return [
    { ...base, id: `${definition.id}-1`, boxKey: 'box_1_total_sales', amountSource: 'TAX_BASE' },
    { ...base, id: `${definition.id}-2`, boxKey: 'box_2_zero_rated_sales', amountSource: 'TAX_BASE' },
  ];
  if (definition.treatment === 'EXEMPT') return [
    { ...base, id: `${definition.id}-1`, boxKey: 'box_1_total_sales', amountSource: 'TAX_BASE' },
    { ...base, id: `${definition.id}-3`, boxKey: 'box_3_exempt_sales', amountSource: 'TAX_BASE' },
  ];
  if (definition.direction === 'INPUT') return [
    { ...base, id: `${definition.id}-6`, boxKey: 'box_6_eligible_purchases', amountSource: 'TAX_BASE' },
    { ...base, id: `${definition.id}-7`, boxKey: 'box_7_input_tax', amountSource: 'TAX_AMOUNT' },
  ];
  return [
    { ...base, id: `${definition.id}-1`, boxKey: 'box_1_total_sales', amountSource: 'TAX_BASE' },
    { ...base, id: `${definition.id}-5`, boxKey: 'box_5_output_tax', amountSource: 'TAX_AMOUNT' },
  ];
};

const line = (taxCodeDefinitionId: string, context: TransactionTaxLineInput['transactionContext'], correctionSign?: 1 | -1): TransactionTaxLineInput => ({
  sourceType: 'accounting.document', sourceId: 'd1', sourceLineId: 'l1', transactionContext: context,
  documentDate: '2026-07-14', currency: 'THB', taxCodeDefinitionId, netAmount: '100', grossAmount: '107', evidenceRefs: ['ev1'], correctionSign,
});

describe('transaction tax resolver', () => {
  it('preserves trusted expense amounts only within configured tolerance and with the same VAT rate', () => {
    const definition = current('s4-i7', 'I7', 'STANDARD', '7', 'DOMESTIC_PURCHASE', 'INPUT');
    const args = { definitions: [definition], accountRules: [accountRule(definition)], reportRules: reportRules(definition),
      input: { ...line(definition.id, 'DOMESTIC_PURCHASE'), sourceType: 'expense.record', netAmount: '100', grossAmount: '107.01', enteredTaxAmount: '7.01' },
      sourceModule: 'expense', direction: 'INPUT' as const };
    const ordinary = resolveTransactionTaxPreview(args);
    assert.equal(ordinary.snapshot.taxAmount, '7.00');
    const accepted = resolveTransactionTaxPreview({ ...args, acceptedExpenseVatRate: '0.07' });
    assert.deepEqual(accepted.errors, []);
    assert.equal(accepted.snapshot.taxAmount, '7.01');
    assert.equal(accepted.components[0]!.snapshot.taxAmount, '7.01');
    assert.equal(aggregatePp30Boxes(accepted.reportContributions).box7InputTax, '7.01');
    const outside = resolveTransactionTaxPreview({ ...args, input: { ...args.input, enteredTaxAmount: '7.02', grossAmount: '107.02' }, acceptedExpenseVatRate: '0.07' });
    assert.ok(outside.errors.includes('entered_tax_amount_outside_tolerance'));
    const conflict = resolveTransactionTaxPreview({ ...args, acceptedExpenseVatRate: '0.08' });
    assert.ok(conflict.errors.includes('accepted_expense_vat_rate_conflict'));
    for (const input of [{ ...args.input, sourceType: 'accounting.document' }, { ...args.input, grossAmount: '108' }, { ...args.input, enteredTaxAmount: '-7' }]) {
      assert.ok(resolveTransactionTaxPreview({ ...args, input, acceptedExpenseVatRate: '0.07' }).errors.includes('accepted_expense_vat_amount_invalid'));
    }
    const spoof = resolveTransactionTaxPreview({ ...args, input: { ...args.input, acceptedExpenseVatRate: '0.07' } as any });
    assert.equal(spoof.snapshot.taxAmount, '7.00', 'public input cannot enable accepted-amount authority');
  });

  it('keeps legacy and current SAP O1 meanings isolated by profile', () => {
    const legacy = current('erp-o1', 'O1', 'STANDARD', '10', 'DOMESTIC_SALE');
    const s4 = current('s4-o1', 'O1', 'STANDARD', '7', 'DOMESTIC_SALE');
    const legacyResult = resolveTransactionTaxPreview({ definitions: [legacy, s4], accountRules: [accountRule(legacy)], reportRules: reportRules(legacy), input: { ...line('erp-o1', 'DOMESTIC_SALE'), externalTaxCode: 'O1' }, profileId: 'erp' });
    const s4Result = resolveTransactionTaxPreview({ definitions: [legacy, s4], accountRules: [accountRule(s4)], reportRules: reportRules(s4), input: { ...line('s4-o1', 'DOMESTIC_SALE'), externalTaxCode: 'O1' }, profileId: 's4' });
    assert.equal(legacyResult.snapshot.taxAmount, '10.00');
    assert.equal(s4Result.snapshot.taxAmount, '7.00');
    assert.deepEqual(legacyResult.errors, []);
    assert.deepEqual(s4Result.errors, []);
  });

  it('keeps standard, zero-rated and exempt groups distinct and produces PP30 boxes', () => {
    const standard = current('s4-o1', 'O1', 'STANDARD', '7', 'DOMESTIC_SALE');
    const zero = current('s4-o0', 'O0', 'ZERO_RATED', '0', 'EXPORT_GOODS');
    const exempt = current('s4-ox', 'OX', 'EXEMPT', '0', 'DOMESTIC_SALE');
    const previews = [
      resolveTransactionTaxPreview({ definitions: [standard], accountRules: [accountRule(standard)], reportRules: reportRules(standard), input: line(standard.id, 'DOMESTIC_SALE') }),
      resolveTransactionTaxPreview({ definitions: [zero], accountRules: [], reportRules: reportRules(zero), input: line(zero.id, 'EXPORT_GOODS') }),
      resolveTransactionTaxPreview({ definitions: [exempt], accountRules: [], reportRules: reportRules(exempt), input: line(exempt.id, 'DOMESTIC_SALE') }),
    ];
    assert.equal(deriveTaxHeaderSummary(previews.map((p) => p.snapshot)), 'MIXED');
    assert.deepEqual(aggregatePp30Boxes(previews.flatMap((p) => p.reportContributions)), {
      box1TotalSales: '300.00', box2ZeroRatedSales: '100.00', box3ExemptSales: '100.00', box4TaxableSales: '100.00',
      box5OutputTax: '7.00', box6EligiblePurchases: '0.00', box7InputTax: '0.00', box8TaxPayable: '7.00', box9TaxOverpaid: '0.00',
    });
  });

  it('aggregates PP30 with the immutable profile policy instead of a fixed two-decimal default', () => {
    const policy = aggregateTaxRoundingPolicy([
      { roundingMode: 'HALF_EVEN', roundingScale: 3, taxAmountTolerance: '0.005' },
      { roundingMode: 'HALF_EVEN', roundingScale: 2, taxAmountTolerance: '0.01' },
    ]);
    const boxes = aggregatePp30Boxes([
      { formType: 'PP30', boxKey: 'box_5_output_tax', amountSource: 'TAX_AMOUNT', amount: '1.005' },
      { formType: 'PP30', boxKey: 'box_7_input_tax', amountSource: 'TAX_AMOUNT', amount: '0.500' },
    ], policy);
    assert.deepEqual(policy, { roundingMode: 'HALF_EVEN', roundingScale: 3, taxAmountTolerance: '0.01' });
    assert.equal(boxes.box5OutputTax, '1.005');
    assert.equal(boxes.box8TaxPayable, '0.505');
  });

  it('fails closed for missing evidence, ambiguity and missing account rule', () => {
    const exportCode = current('s4-o0', 'O0', 'ZERO_RATED', '0', 'EXPORT_GOODS');
    const missingEvidence = resolveTransactionTaxPreview({ definitions: [exportCode], accountRules: [], reportRules: reportRules(exportCode), input: { ...line(exportCode.id, 'EXPORT_GOODS'), evidenceRefs: [] } });
    assert.ok(missingEvidence.errors.includes('tax_evidence_required'));
    const standard = current('s4-o1', 'O1', 'STANDARD', '7', 'DOMESTIC_SALE');
    const missingAccount = resolveTransactionTaxPreview({ definitions: [standard], accountRules: [], reportRules: reportRules(standard), input: line(standard.id, 'DOMESTIC_SALE') });
    assert.ok(missingAccount.errors.includes('tax_account_rule_missing'));
  });

  it('preserves correction sign and input claimable boxes', () => {
    const inputCode = current('s4-v1', 'V1', 'CLAIMABLE', '7', 'DOMESTIC_PURCHASE', 'INPUT');
    const credit = resolveTransactionTaxPreview({ definitions: [inputCode], accountRules: [accountRule(inputCode)], reportRules: reportRules(inputCode), input: line(inputCode.id, 'DOMESTIC_PURCHASE', -1), direction: 'INPUT' });
    assert.equal(credit.snapshot.taxBaseAmount, '-100.00');
    assert.equal(credit.snapshot.taxAmount, '-7.00');
    assert.equal(aggregatePp30Boxes(credit.reportContributions).box7InputTax, '-7.00');
  });

  it('keeps PP36 output and input as separate components', () => {
    const pp36 = { ...current('s4-v3', 'V3', 'REVERSE_CHARGE', '7', 'IMPORT_SERVICE', 'SELF_ASSESSED'), evidenceRuleKey: 'PP36_PAYMENT' };
    const output = { ...accountRule(pp36), id: 'pp36-output', direction: 'SELF_ASSESSED' as const, accountRole: 'PP36_OUTPUT_VAT_PAYABLE' as const, accountId: 'pp36-output', postingSide: 'CREDIT' as const };
    const input = { ...accountRule(pp36), id: 'pp36-input', direction: 'SELF_ASSESSED' as const, accountRole: 'PP36_INPUT_VAT_CLAIMABLE' as const, accountId: 'pp36-input', postingSide: 'DEBIT' as const };
    const pending = { ...input, id: 'pp36-pending', accountRole: 'INPUT_VAT_PENDING' as const, accountId: 'pp36-pending' };
    const mappings: TaxReportMappingRuleDto[] = [
      { ...reportRules(pp36)[0]!, id: 'pp36-form', formType: 'PP36', boxKey: 'tax_due', amountSource: 'TAX_AMOUNT' },
      { ...reportRules(pp36)[0]!, id: 'pp30-base', formType: 'PP30', boxKey: 'box_6_eligible_purchases', amountSource: 'TAX_BASE' },
      { ...reportRules(pp36)[0]!, id: 'pp30-input', formType: 'PP30', boxKey: 'box_7_input_tax', amountSource: 'TAX_AMOUNT' },
    ];
    const payment = resolveTransactionTaxPreview({ definitions: [pp36], accountRules: [output, pending, input], reportRules: mappings, input: { ...line(pp36.id, 'IMPORT_SERVICE'), enteredTaxAmount: '0' }, direction: 'SELF_ASSESSED' });
    assert.deepEqual(payment.components.map((component) => [component.componentKey, component.accountId]), [['PP36_OUTPUT', 'pp36-output'], ['PP36_INPUT', 'pp36-pending']]);
    assert.equal(payment.components[1]?.snapshot.claimability, 'PENDING_EVIDENCE');
    assert.deepEqual(payment.components[1]?.reportContributions, []);
    assert.deepEqual(payment.errors, []);
    const claim = resolveTransactionTaxPreview({ definitions: [pp36], accountRules: [output, pending, input], reportRules: mappings,
      input: { ...line(pp36.id, 'IMPORT_SERVICE'), enteredTaxAmount: '0', pp36InputClaimEvidenceVerified: true }, direction: 'SELF_ASSESSED' });
    assert.equal(claim.components[1]?.accountId, 'pp36-input');
    assert.equal(claim.components[1]?.snapshot.claimability, 'CLAIMABLE');
    assert.deepEqual(claim.components[1]?.reportContributions.map((entry) => entry.formType), ['PP30', 'PP30']);
    const foreignRemainder = resolveTransactionTaxPreview({ definitions: [pp36], accountRules: [output, pending, input], reportRules: mappings,
      input: { ...line(pp36.id, 'IMPORT_SERVICE'), currency: 'USD', taxCurrency: 'THB', exchangeRate: '35', exchangeRateSource: 'BANK_PAYMENT', exchangeRateDate: '2026-07-14',
        authoritativeSelfAssessedTaxBaseAmount: '1166.67', authoritativeSelfAssessedTaxAmount: '81.67' }, direction: 'SELF_ASSESSED' });
    assert.equal(foreignRemainder.snapshot.taxBaseAmount, '1166.67');
    assert.equal(foreignRemainder.snapshot.taxAmount, '81.67');
    assert.equal(foreignRemainder.snapshot.sourceCurrency, 'USD');
    assert.equal(foreignRemainder.snapshot.exchangeRate, '35');
  });

  it('captures authoritative import VAT, duty and excise as distinct components', () => {
    const importVat = { ...current('s4-i1', 'I1', 'CLAIMABLE', '7', 'IMPORT_GOODS', 'INPUT'), taxRegime: 'IMPORT_VAT' as const };
    const importVatAccount = { ...accountRule(importVat), taxRegime: 'IMPORT_VAT' as const, accountRole: 'IMPORT_VAT_CLAIMABLE' as const };
    const importSettlement = { ...accountRule(importVat), id: 'import-settlement', taxRegime: 'IMPORT_VAT' as const, accountRole: 'IMPORT_TAX_SETTLEMENT_PAYABLE' as const, accountId: 'customs-payable', postingSide: 'CREDIT' as const };
    const dutyAccount = { ...accountRule(importVat), id: 'duty-rule', taxCodeDefinitionId: null, taxRegime: 'CUSTOMS_DUTY' as const, treatment: 'NONDEDUCTIBLE_CAPITALIZED' as const, accountRole: 'CUSTOMS_DUTY_CAPITALIZED' as const, accountId: 'duty-cost', postingSide: 'DEBIT' as const };
    const dutyPayable = { ...dutyAccount, id: 'duty-payable-rule', accountRole: 'CUSTOMS_DUTY_PAYABLE' as const, accountId: 'customs-payable', postingSide: 'CREDIT' as const };
    const exciseAccount = { ...accountRule(importVat), id: 'excise-rule', taxCodeDefinitionId: null, taxRegime: 'EXCISE_TAX' as const, treatment: 'NONDEDUCTIBLE_CAPITALIZED' as const, accountRole: 'EXCISE_TAX_EXPENSE_OR_COST' as const, accountId: 'excise-cost', postingSide: 'DEBIT' as const };
    const excisePayable = { ...exciseAccount, id: 'excise-payable-rule', accountRole: 'EXCISE_TAX_PAYABLE' as const, accountId: 'customs-payable', postingSide: 'CREDIT' as const };
    const customsMappings: TaxReportMappingRuleDto[] = [
      { ...reportRules(importVat)[0]!, id: 'duty-report', formType: 'CUSTOMS_SUPPORT', boxKey: 'customs_duty', amountSource: 'DUTY' },
      { ...reportRules(importVat)[0]!, id: 'excise-report', formType: 'CUSTOMS_SUPPORT', boxKey: 'excise_tax', amountSource: 'OTHER' },
    ];
    const preview = resolveTransactionTaxPreview({
      definitions: [importVat], accountRules: [importVatAccount, importSettlement, dutyAccount, dutyPayable, exciseAccount, excisePayable], reportRules: [...reportRules(importVat), ...customsMappings], direction: 'INPUT',
      input: { ...line(importVat.id, 'IMPORT_GOODS'), accountHint: 'CAPITALIZED', authoritativeCustomsValue: '1000', authoritativeImportVatAmount: '77', authoritativeDutyAmount: '100', authoritativeExciseAmount: '20' },
    });
    assert.deepEqual(preview.components.map((component) => [component.componentKey, component.snapshot.taxAmount]), [['IMPORT_VAT', '77.00'], ['CUSTOMS_DUTY', '100.00'], ['EXCISE_TAX', '20.00']]);
    assert.deepEqual(preview.components.map((component) => component.accountAssignments.map((assignment) => [assignment.accountRole, assignment.postingSide])), [
      [['IMPORT_VAT_CLAIMABLE', 'DEBIT'], ['IMPORT_TAX_SETTLEMENT_PAYABLE', 'CREDIT']],
      [['CUSTOMS_DUTY_CAPITALIZED', 'DEBIT'], ['CUSTOMS_DUTY_PAYABLE', 'CREDIT']],
      [['EXCISE_TAX_EXPENSE_OR_COST', 'DEBIT'], ['EXCISE_TAX_PAYABLE', 'CREDIT']],
    ]);
    assert.deepEqual(preview.errors, []);
    assert.deepEqual(preview.components.slice(1).map((component) => component.reportContributions.map((entry) => [entry.boxKey, entry.amount])), [
      [['customs_duty', '100.00']], [['excise_tax', '20.00']],
    ]);
  });

  it('keeps pending and non-deductible input VAT out of claimable PP30 boxes', () => {
    for (const [claimability, treatment, role] of [
      ['PENDING_EVIDENCE', 'PENDING_EVIDENCE', 'INPUT_VAT_PENDING'],
      ['NONDEDUCTIBLE_EXPENSE', 'NONDEDUCTIBLE_EXPENSE', 'NONDEDUCTIBLE_VAT_EXPENSE'],
    ] as const) {
      const definition = { ...current(`s4-${claimability}`, 'V7', treatment, '7', 'DOMESTIC_PURCHASE', 'INPUT'), claimabilityDefault: claimability };
      const rule = { ...accountRule(definition), accountRole: role, accountId: role.toLowerCase() };
      const preview = resolveTransactionTaxPreview({ definitions: [definition], accountRules: [rule], reportRules: [], input: line(definition.id, 'DOMESTIC_PURCHASE'), direction: 'INPUT' });
      assert.deepEqual(preview.errors, []);
      assert.equal(preview.components[0]?.accountRole, role);
      assert.deepEqual(preview.reportContributions, []);
    }
  });

  it('does not classify bare legacy O0 and never creates a receipt tax snapshot', () => {
    const ambiguous = legacyOutputTaxCodeSnapshot('O0', '100', '0');
    assert.equal(ambiguous?.taxTreatment, 'NEEDS_REVIEW');
    assert.equal(ambiguous?.taxContext, null);
    assert.equal(ambiguous?.evidenceStatus, 'REVIEW_REQUIRED');
    assert.equal(legacyOutputTaxCodeSnapshot(null, '100', '0'), null);
    assert.equal(legacyOutputTaxCodeSnapshot('O0', '100', '0', { taxContext: 'EXPORT_GOODS', evidenceStatus: 'VERIFIED' })?.taxTreatment, 'ZERO_RATED');
  });

  it('applies the profile rounding mode, scale, and entered-tax tolerance to immutable snapshots', () => {
    const standard = current('s4-rounding', 'O7', 'STANDARD', '5', 'DOMESTIC_SALE');
    const input = { ...line(standard.id, 'DOMESTIC_SALE'), netAmount: '50', grossAmount: '52.50' };
    const halfUp = resolveTransactionTaxPreview({
      definitions: [standard], accountRules: [accountRule(standard)], reportRules: reportRules(standard), input,
      roundingPolicy: { roundingMode: 'HALF_UP', roundingScale: 0, taxAmountTolerance: '0.50' },
    });
    const halfEven = resolveTransactionTaxPreview({
      definitions: [standard], accountRules: [accountRule(standard)], reportRules: reportRules(standard),
      input: { ...input, enteredTaxAmount: '2.40' },
      roundingPolicy: { roundingMode: 'HALF_EVEN', roundingScale: 0, taxAmountTolerance: '0.50' },
    });
    assert.equal(halfUp.snapshot.taxAmount, '3');
    assert.equal(halfEven.snapshot.taxAmount, '2');
    assert.equal(halfEven.snapshot.roundingMode, 'HALF_EVEN');
    assert.equal(halfEven.snapshot.roundingScale, 0);
    assert.equal(halfEven.snapshot.taxAmountTolerance, '0.50');
    assert.ok(!halfEven.errors.includes('entered_tax_amount_outside_tolerance'));
    assert.notEqual(halfUp.configurationChecksum, halfEven.configurationChecksum);
    const strict = resolveTransactionTaxPreview({
      definitions: [standard], accountRules: [accountRule(standard)], reportRules: reportRules(standard),
      input: { ...input, enteredTaxAmount: '2.40' },
      roundingPolicy: { roundingMode: 'HALF_EVEN', roundingScale: 0, taxAmountTolerance: '0.10' },
    });
    assert.ok(strict.errors.includes('entered_tax_amount_outside_tolerance'));
  });
});
