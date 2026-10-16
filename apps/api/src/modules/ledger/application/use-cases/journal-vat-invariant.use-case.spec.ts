import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asLedgerSource } from './journal.use-case.js';
import { buildDefaultPostingLines, buildTransactionTaxPostingLines, DEFAULT_ACCOUNT_CODES } from '../../domain/logic/posting-engine.logic.js';

function expenseSource(inputVatClaimStatus?: string, taxEvidenceStatus?: string) {
  return {
    companyId: 'company-1',
    branchId: null,
    sourceType: 'expense.record',
    sourceId: 'expense-1',
    sourceEventType: 'confirmed',
    idempotencyKey: 'expense:confirmed:expense-1',
    expenseNumber: 'EXP-1',
    expenseDate: '2026-07-13T00:00:00.000Z',
    currency: 'THB',
    vendorCounterpartyId: null,
    grandTotalAmount: '107.0000',
    vatAmount: '7.0000',
    whtAmount: '0',
    paidAmount: '0',
    inputVatClaimStatus,
    taxEvidenceStatus,
    lines: [{ lineNumber: 1, description: 'Office supplies', quantity: '1', taxableAmount: '100.0000', vatAmount: '7.0000', whtAmount: '0' }],
  };
}

describe('expense VAT ledger invariant', () => {
  for (const [inputVatClaimStatus, taxEvidenceStatus] of [
    ['NON_CLAIMABLE', 'USABLE_FOR_TAX'],
    ['NEEDS_REVIEW', 'USABLE_FOR_TAX'],
    ['CLAIMABLE', 'SUPPORTING_ONLY'],
    ['CLAIMABLE', 'NEEDS_REVIEW'],
    [undefined, undefined],
  ] as const) {
    it(`books VAT as expense for ${inputVatClaimStatus ?? 'missing'} + ${taxEvidenceStatus ?? 'missing'}`, () => {
      const source = asLedgerSource(expenseSource(inputVatClaimStatus, taxEvidenceStatus) as any);
      assert.equal(source.taxTotal, '0');
      assert.equal(source.lines[0]?.vatAmount, '0');

      const lines = buildDefaultPostingLines(source)!;
      assert.equal(lines.some((line) => line.accountId === DEFAULT_ACCOUNT_CODES.INPUT_VAT), false);
      assert.equal(lines.find((line) => line.accountId === DEFAULT_ACCOUNT_CODES.EXPENSE_GENERAL)?.debitAmount, '107.0000');
      assert.equal(lines.find((line) => line.accountId === DEFAULT_ACCOUNT_CODES.ACCOUNTS_PAYABLE)?.creditAmount, '107.0000');
    });
  }

  it('separates input VAT only for exact CLAIMABLE + USABLE_FOR_TAX evidence', () => {
    const source = asLedgerSource(expenseSource('CLAIMABLE', 'USABLE_FOR_TAX') as any);
    assert.equal(source.taxTotal, '7.0000');
    assert.equal(source.lines[0]?.vatAmount, '7.0000');

    const lines = buildDefaultPostingLines(source)!;
    assert.equal(lines.find((line) => line.accountId === DEFAULT_ACCOUNT_CODES.EXPENSE_GENERAL)?.debitAmount, '100.0000');
    assert.equal(lines.find((line) => line.accountId === DEFAULT_ACCOUNT_CODES.INPUT_VAT)?.debitAmount, '7.0000');
  });

  it('fails closed for pre-shaped expense posting input without evidence statuses', () => {
    const source = asLedgerSource({
      companyId: 'company-1', sourceType: 'expense.record', sourceId: 'expense-1', sourceEventType: 'expense.confirmed',
      idempotencyKey: 'expense:confirmed:expense-1', sourceDate: '2026-07-13T00:00:00.000Z', periodKey: '2026-07',
      currency: 'THB', totalAmount: '107.0000', taxTotal: '7.0000', lines: [{ netAmount: '100.0000', vatAmount: '7.0000' }],
    } as any);
    assert.equal(source.taxTotal, '0');
    assert.equal(source.lines[0]?.vatAmount, '0');
  });
});

function inputComponent(key = 'VAT'): any {
  return { componentKey: key, snapshot: { taxCodeDefinitionId: 'vat-code', externalTaxCode: 'I1',
    taxRegime: 'VAT', taxDirection: 'INPUT', taxTreatment: 'STANDARD', taxContext: 'DOMESTIC_PURCHASE',
    taxCurrency: 'THB', sourceCurrency: 'THB', exchangeRate: '1', taxAmount: '7', taxBaseAmount: '100',
    taxRate: '7', claimability: 'CLAIMABLE', evidenceStatus: 'VERIFIED' },
    accountAssignments: [{ accountId: 'input-vat-account', accountRole: 'INPUT_VAT_CLAIMABLE', postingSide: 'DEBIT', ruleVersion: 1 },
      ...(key === 'IMPORT_VAT' ? [{ accountId: 'customs-payable', accountRole: 'IMPORT_TAX_SETTLEMENT_PAYABLE', postingSide: 'CREDIT', ruleVersion: 1 }] : [])],
    reportContributions: [] };
}
for (const right of ['NEEDS_REVIEW', 'NON_CLAIMABLE', 'CLAIMABLE']) for (const evidence of ['USABLE_FOR_TAX', 'SUPPORTING_ONLY']) {
  for (const key of ['VAT', 'IMPORT_VAT', 'PP36_INPUT']) it(`${right}/${evidence}: ${key} follows the expense right and stays balanced`, () => {
    const raw: any = expenseSource(right, evidence);
    raw.lines[0].taxComponents = [inputComponent(key)];
    if (key !== 'VAT') { raw.grandTotalAmount = '100'; raw.vatAmount = '0'; raw.lines[0].vatAmount = '0'; }
    if (key === 'PP36_INPUT') raw.lines[0].taxComponents.push({ ...inputComponent('PP36_OUTPUT'),
      snapshot: { ...inputComponent().snapshot, taxDirection: 'OUTPUT' },
      accountAssignments: [{ accountId: 'pp36-payable', accountRole: 'PP36_OUTPUT_VAT_PAYABLE', postingSide: 'CREDIT', ruleVersion: 1 }] });
    const original = structuredClone(raw);
    const source = asLedgerSource(raw);
    const result = buildTransactionTaxPostingLines(source, buildDefaultPostingLines({ ...source, taxTotal: '0' }));
    assert.equal(result.error, undefined);
    const claimable = right === 'CLAIMABLE' && evidence === 'USABLE_FOR_TAX';
    assert.equal(result.lines?.some(l => l.accountId === 'input-vat-account'), claimable);
    assert.equal(result.lines?.filter(l => l.accountId === DEFAULT_ACCOUNT_CODES.EXPENSE_GENERAL).reduce((n, l) => n + Number(l.debitAmount ?? 0), 0), claimable ? 100 : 107);
    assert.equal(result.lines?.reduce((n, l) => n + Number(l.debitAmount ?? 0) - Number(l.creditAmount ?? 0), 0), 0);
    assert.deepEqual(raw, original, 'immutable tax snapshots are not rewritten');
  });
}
