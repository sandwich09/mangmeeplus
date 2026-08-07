import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LedgerJournalLineInput, LedgerSourcePostingInput, TransactionTaxComponentPreview } from '@watchdog-bms/contracts';
import { buildDefaultPostingLines, buildTransactionTaxPostingLines } from './posting-engine.logic.js';

function component(
  componentKey: TransactionTaxComponentPreview['componentKey'],
  amount: string,
  assignments: TransactionTaxComponentPreview['accountAssignments'],
): TransactionTaxComponentPreview {
  return {
    componentKey,
    snapshot: {
      taxCodeDefinitionId: 'definition-1', externalTaxCode: 'O1', taxProfileKey: 'S4_TH', taxProfileVersion: 1,
      taxRegime: componentKey === 'CUSTOMS_DUTY' ? 'CUSTOMS_DUTY' : 'VAT', taxDirection: 'INPUT',
      taxTreatment: 'STANDARD', taxContext: componentKey === 'VAT' ? 'DOMESTIC_PURCHASE' : 'IMPORT_GOODS',
      taxRate: '7', sourceCurrency: 'THB', taxCurrency: 'THB', exchangeRate: '1', exchangeRateSource: 'FUNCTIONAL_CURRENCY', exchangeRateDate: '2026-07-01',
      taxBaseAmount: '100.00', taxAmount: amount, claimability: 'CLAIMABLE',
      evidenceStatus: 'VERIFIED', accountRuleVersion: 1, reportRuleVersion: 1,
    },
    accountRole: assignments[0]?.accountRole ?? null, accountId: assignments[0]?.accountId ?? null,
    accountAssignments: assignments, reportContributions: [],
  };
}

function source(components: TransactionTaxComponentPreview[], event = 'procurement.vendor_bill.approved'): LedgerSourcePostingInput {
  return {
    companyId: 'company-1', branchId: 'branch-1', sourceType: 'procurement.vendor_bill', sourceId: 'bill-1',
    sourceEventType: event, idempotencyKey: 'bill-1', sourceDate: '2026-07-01', periodKey: '2026-07', currency: 'THB',
    totalAmount: '107.00', taxTotal: '7.00', whtTotal: '0',
    lines: [{ sourceLineId: 'bill-line-1', netAmount: '100.00', vatAmount: '7.00', taxComponents: components }],
  };
}

function balanced(lines: LedgerJournalLineInput[]): boolean {
  const debit = lines.reduce((sum, line) => sum + Number(line.debitAmount ?? 0), 0);
  const credit = lines.reduce((sum, line) => sum + Number(line.creditAmount ?? 0), 0);
  return Math.abs(debit - credit) < 0.0001;
}

describe('transaction-tax ledger posting', () => {
  it('retains a configured inventory base account, appends server tax account, balances, and isolates source line', () => {
    const input = source([component('VAT', '7', [
      { accountRole: 'INPUT_VAT_CLAIMABLE', accountId: 'configured-input-vat-id', postingSide: 'DEBIT', ruleVersion: 2 },
    ])]);
    const base = [
      { accountId: 'configured-inventory-id', debitAmount: '107.0000', sourceType: input.sourceType, sourceId: input.sourceId },
      { accountId: 'configured-ap-id', creditAmount: '107.0000', sourceType: input.sourceType, sourceId: input.sourceId },
    ];
    const result = buildTransactionTaxPostingLines(input, base);
    assert.equal(result.error, undefined);
    assert.equal(result.lines?.find((line) => line.accountId === 'configured-inventory-id')?.debitAmount, '100.0000');
    const taxLine = result.lines?.find((line) => line.accountId === 'configured-input-vat-id');
    assert.equal(taxLine?.sourceId, 'bill-line-1');
    assert.equal(taxLine?.taxComponentKey, 'VAT');
    assert.equal(balanced(result.lines ?? []), true);
  });

  it('posts PP36 output/input as a balanced pair without changing the service base', () => {
    const input = source([
      component('PP36_OUTPUT', '7', [{ accountRole: 'PP36_OUTPUT_VAT_PAYABLE', accountId: 'pp36-output', postingSide: 'CREDIT', ruleVersion: 1 }]),
      component('PP36_INPUT', '7', [{ accountRole: 'PP36_INPUT_VAT_CLAIMABLE', accountId: 'pp36-input', postingSide: 'DEBIT', ruleVersion: 1 }]),
    ]);
    input.totalAmount = '100'; input.taxTotal = '0'; input.lines[0]!.vatAmount = '0';
    const base = buildDefaultPostingLines({ ...input, taxTotal: '0' })!;
    const result = buildTransactionTaxPostingLines(input, base);
    assert.equal(result.lines?.find((line) => line.accountId === 'pp36-output')?.creditAmount, '7.0000');
    assert.equal(result.lines?.find((line) => line.accountId === 'pp36-input')?.debitAmount, '7.0000');
    assert.equal(balanced(result.lines ?? []), true);
  });

  it('allows only a payment-recognized PP36 pending account with no PP30 contribution', () => {
    const output = component('PP36_OUTPUT', '7', [{ accountRole: 'PP36_OUTPUT_VAT_PAYABLE', accountId: 'pp36-output', postingSide: 'CREDIT', ruleVersion: 1 }]);
    const pending = component('PP36_INPUT', '7', [{ accountRole: 'INPUT_VAT_PENDING', accountId: 'pp36-pending', postingSide: 'DEBIT', ruleVersion: 1 }]);
    pending.snapshot = { ...pending.snapshot, taxContext: 'IMPORT_SERVICE', claimability: 'PENDING_EVIDENCE', evidenceStatus: 'REVIEW_REQUIRED', recognitionDate: '2026-08-15' };
    pending.accountRole = 'INPUT_VAT_PENDING'; pending.accountId = 'pp36-pending'; pending.reportContributions = [];
    const input = source([output, pending], 'procurement.vendor_bill.pp36_payment');
    input.totalAmount = '0'; input.taxTotal = '0'; input.lines[0]!.vatAmount = '0';
    const result = buildTransactionTaxPostingLines(input, []);
    assert.equal(result.error, undefined);
    assert.equal(result.lines?.find((line) => line.accountId === 'pp36-output')?.creditAmount, '7.0000');
    assert.equal(result.lines?.find((line) => line.accountId === 'pp36-pending')?.debitAmount, '7.0000');
    assert.equal(balanced(result.lines ?? []), true);
    const forged = { ...pending, reportContributions: [{ formType: 'PP30' as const, boxKey: 'box_7_input_tax', amountSource: 'TAX_AMOUNT' as const, amount: '7' }] };
    assert.equal(buildTransactionTaxPostingLines(source([output, forged]), []).error, 'tax_snapshot_needs_review');
  });

  it('posts import VAT and duty paired components without guessing VAT accounts', () => {
    const input = source([
      component('IMPORT_VAT', '7', [
        { accountRole: 'IMPORT_VAT_CLAIMABLE', accountId: 'import-vat', postingSide: 'DEBIT', ruleVersion: 1 },
        { accountRole: 'IMPORT_TAX_SETTLEMENT_PAYABLE', accountId: 'customs-payable', postingSide: 'CREDIT', ruleVersion: 1 },
      ]),
      component('CUSTOMS_DUTY', '5', [
        { accountRole: 'CUSTOMS_DUTY_CAPITALIZED', accountId: 'inventory-duty', postingSide: 'DEBIT', ruleVersion: 1 },
        { accountRole: 'CUSTOMS_DUTY_PAYABLE', accountId: 'duty-payable', postingSide: 'CREDIT', ruleVersion: 1 },
      ]),
    ]);
    input.totalAmount = '100'; input.taxTotal = '0'; input.lines[0]!.vatAmount = '0';
    const result = buildTransactionTaxPostingLines(input, buildDefaultPostingLines({ ...input, taxTotal: '0' }));
    assert.equal(result.lines?.some((line) => line.accountId === '1280-00'), false);
    assert.equal(balanced(result.lines ?? []), true);
  });

  it('fails closed when a non-zero component has no account mapping', () => {
    const input = source([component('VAT', '7', [])]);
    assert.equal(buildTransactionTaxPostingLines(input, buildDefaultPostingLines({ ...input, taxTotal: '0' })).error, 'tax_account_mapping_missing:VAT');
  });

  it('normalizes a USD commercial posting and its tax line to the functional currency', () => {
    const vat = component('VAT', '245', [{ accountRole: 'INPUT_VAT_CLAIMABLE', accountId: 'input-vat', postingSide: 'DEBIT', ruleVersion: 1 }]);
    vat.snapshot = { ...vat.snapshot, sourceCurrency: 'USD', taxCurrency: 'THB', exchangeRate: '35', exchangeRateSource: 'BOT', exchangeRateDate: '2026-07-01', taxBaseAmount: '3500' };
    const input = { ...source([vat]), currency: 'USD', totalAmount: '107', taxTotal: '7' };
    const result = buildTransactionTaxPostingLines(input, [
      { accountId: 'expense', debitAmount: '107', currency: 'USD' },
      { accountId: 'payable', creditAmount: '107', currency: 'USD' },
    ]);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.lines?.map((line) => line.currency), ['THB', 'THB', 'THB']);
    assert.equal(result.lines?.find((line) => line.accountId === 'expense')?.debitAmount, '3500.0000');
    assert.equal(result.lines?.find((line) => line.accountId === 'input-vat')?.debitAmount, '245.0000');
    assert.equal(balanced(result.lines ?? []), true);
  });

  it('fails closed for foreign tax facts without verified FX metadata', () => {
    const vat = component('VAT', '7', [{ accountRole: 'INPUT_VAT_CLAIMABLE', accountId: 'input-vat', postingSide: 'DEBIT', ruleVersion: 1 }]);
    vat.snapshot = { ...vat.snapshot, sourceCurrency: 'USD', taxCurrency: 'THB', exchangeRate: '0', exchangeRateSource: '', exchangeRateDate: '' };
    assert.equal(buildTransactionTaxPostingLines({ ...source([vat]), currency: 'USD' }, []).error, 'functional_currency_fx_required');
  });

  it('keeps the source expense line when nondeductible VAT uses the same expense account', () => {
    const nondeductible = component('VAT', '7', [
      { accountRole: 'NONDEDUCTIBLE_VAT_EXPENSE', accountId: 'same-expense-id', postingSide: 'DEBIT', ruleVersion: 1 },
    ]);
    nondeductible.snapshot.claimability = 'NONDEDUCTIBLE_EXPENSE';
    nondeductible.snapshot.taxTreatment = 'NONDEDUCTIBLE_EXPENSE';
    const input = source([nondeductible]);
    const result = buildTransactionTaxPostingLines(input, [
      { accountId: 'same-expense-id', debitAmount: '107.0000', sourceId: 'bill-1' },
      { accountId: 'ap-id', creditAmount: '107.0000', sourceId: 'bill-1' },
    ]);
    assert.equal(result.lines?.filter((line) => line.accountId === 'same-expense-id').length, 2);
    assert.equal(balanced(result.lines ?? []), true);
  });
});
