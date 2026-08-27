import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExpenseTransactionTaxService } from './expense-transaction-tax.service.js';

describe('ExpenseTransactionTaxService', () => {
  it('preserves explicit zero treatment in DRAFT/FINAL and rejects conflicting Tax Codes', async () => {
    const source = {
      expenseId: 'expense-1', companyId: 'company-1', lineNumber: 1,
      description: 'Zero VAT', quantity: '1', unitPrice: '100', discountAmount: '0',
      taxableAmount: '100', vatRate: '0', vatAmount: '0', whtRate: null, whtAmount: '0',
      lineSubtotalAmount: '100', lineTotalAmount: '100', expenseCategoryId: null, accountHintKey: null, taxCategory: null,
      taxCodeDefinitionId: 'definition-zero', evidenceRefs: [],
    };
    let snapshot = { taxRegime: 'VAT', taxRate: '0', taxTreatment: 'EXEMPT' };
    const service = new ExpenseTransactionTaxService({
      resolveSourceTax: async () => ({ snapshot, components: [] }),
      resolveSourceTaxInTransaction: async () => ({ snapshot, components: [] }),
    } as any);
    const ctx = { companyId: 'company-1', userId: 'user-1', permissions: ['expense.create'] } as any;
    const header = { expenseId: 'expense-1', expenseDate: '2026-08-27', currency: 'THB' };
    for (const vatTreatment of ['ZERO_RATED', 'EXEMPT', 'NON_VAT'] as const) {
      snapshot = { taxRegime: 'VAT', taxRate: '0', taxTreatment: vatTreatment === 'NON_VAT' ? 'NON_TAXABLE' : vatTreatment };
      for (const mode of ['DRAFT', 'FINAL'] as const) {
        const [line] = await service.resolveLines(ctx, header, [{ ...source, vatTreatment }], mode, mode === 'FINAL' ? {} : undefined);
        assert.equal(line?.vatTreatment, vatTreatment);
        assert.equal(line?.vatRate, '0');
      }
    }
    for (const conflict of [
      { taxRegime: 'VAT', taxRate: '0', taxTreatment: 'ZERO_RATED' },
      { taxRegime: 'VAT', taxRate: '7', taxTreatment: 'STANDARD' },
    ]) {
      snapshot = conflict;
      await assert.rejects(() => service.resolveLines(ctx, header, [{ ...source, vatTreatment: 'EXEMPT' }]), /conflicts with the selected Tax Code/);
    }
    snapshot = { taxRegime: 'VAT', taxRate: '0', taxTreatment: 'EXEMPT' };
    const [legacy] = await service.resolveLines(ctx, header, [source]);
    assert.equal(legacy?.vatTreatment, undefined, 'Tax Code must not backfill an uncaptured line treatment');
  });

  it('keeps the Expense source rate as 0.07 while preserving canonical snapshot rate 7', async () => {
    const transactionTax = {
      resolveSourceTax: async () => ({
        snapshot: { taxRegime: 'VAT', taxRate: '7' },
        components: [{ componentKey: 'VAT' }],
      }),
    };
    const service = new ExpenseTransactionTaxService(transactionTax as any);

    const [line] = await service.resolveLines(
      { companyId: 'company-1', userId: 'user-1', permissions: ['expense.create'] } as any,
      { expenseId: 'expense-1', expenseDate: '2026-07-14', currency: 'THB' },
      [{
        expenseId: 'expense-1', companyId: 'company-1', lineNumber: 1,
        description: 'ค่าใช้จ่าย', quantity: '1', unitPrice: '100', discountAmount: '0',
        taxableAmount: '100', vatRate: '0.07', vatAmount: '7', whtRate: null, whtAmount: '0',
        lineSubtotalAmount: '100', lineTotalAmount: '107', taxCodeDefinitionId: 'definition-1',
      } as any],
    );

    assert.equal(line?.vatRate, '0.07');
    assert.equal(line?.taxSnapshot?.taxRate, '7');
  });
});
