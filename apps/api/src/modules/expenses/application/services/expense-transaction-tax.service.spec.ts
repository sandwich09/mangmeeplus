import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExpenseTransactionTaxService } from './expense-transaction-tax.service.js';

describe('ExpenseTransactionTaxService', () => {
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
