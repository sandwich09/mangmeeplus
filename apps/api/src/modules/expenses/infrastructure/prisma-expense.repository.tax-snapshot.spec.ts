import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TransactionTaxSnapshot } from '@watchdog-bms/contracts';
import { PrismaExpenseRepository } from './prisma-expense.repository.js';

const taxSnapshot: TransactionTaxSnapshot = {
  taxCodeDefinitionId: 'tax-i7', externalTaxCode: 'I7', taxProfileKey: 'SAP_S4_TH_CURRENT', taxProfileVersion: 2,
  roundingMode: 'HALF_EVEN', roundingScale: 3, taxAmountTolerance: '0.005',
  taxRegime: 'VAT', taxDirection: 'INPUT', taxTreatment: 'STANDARD', taxContext: 'DOMESTIC_PURCHASE', taxRate: '7',
  sourceCurrency: 'THB', taxCurrency: 'THB', exchangeRate: '1', exchangeRateSource: 'FUNCTIONAL_CURRENCY', exchangeRateDate: '2026-07-15',
  taxBaseAmount: '100.000', taxAmount: '7.000', claimability: 'CLAIMABLE', evidenceStatus: 'VERIFIED', accountRuleVersion: 1, reportRuleVersion: 1,
};

describe('PrismaExpenseRepository tax snapshot mapping', () => {
  it('round-trips the resolver rounding policy through ExpenseLine', async () => {
    let persistedLine: any;
    const client: any = {
      // Added by the expense auto-post work (#59): findByIdWithRelations now reads
      // generated journals to resolve the entry number. No journals in these fixtures.
      journalEntry: { findMany: async () => [] },
      $transaction: async (work: (tx: any) => Promise<unknown>) => work(client),
      $executeRaw: async () => undefined,
      expenseSubstituteReceiptEvidence: { findFirst: async () => null },
      expenseLine: {
        deleteMany: async () => ({ count: 0 }),
        upsert: async ({ create }: any) => { persistedLine = { id: 'line-1', ...create }; return persistedLine; },
      },
      expenseRecord: { findFirst: async () => ({ id: 'expense-1', lines: [persistedLine], duplicateCandidates: [] }) },
      attachmentLink: { findMany: async () => [] },
    };
    const repo = new PrismaExpenseRepository({ client } as any);
    await repo.upsertLines('company-1', 'expense-1', [{
      expenseId: 'expense-1', companyId: 'company-1', lineNumber: 1, description: 'Service', quantity: '1', unitPrice: '100',
      discountAmount: '0', taxableAmount: '100', vatRate: '7', vatAmount: '7', whtRate: null, whtAmount: '0',
      lineSubtotalAmount: '100', lineTotalAmount: '107', expenseCategoryId: null, accountHintKey: null, taxCategory: null, taxSnapshot,
    }]);
    const result = await repo.findByIdWithRelations('company-1', 'expense-1');
    assert.deepEqual([
      persistedLine.roundingModeSnapshot, persistedLine.roundingScaleSnapshot, persistedLine.taxAmountToleranceSnapshot,
    ], ['HALF_EVEN', 3, '0.005']);
    assert.deepEqual([
      result?.lines[0]?.taxSnapshot?.roundingMode,
      result?.lines[0]?.taxSnapshot?.roundingScale,
      result?.lines[0]?.taxSnapshot?.taxAmountTolerance,
    ], ['HALF_EVEN', 3, '0.005']);
  });

  it('does not leak resolver-only tax fields into Prisma create or update data', async () => {
    let upsertInput: any;
    const client: any = {
      // Added by the expense auto-post work (#59): findByIdWithRelations now reads
      // generated journals to resolve the entry number. No journals in these fixtures.
      journalEntry: { findMany: async () => [] },
      $transaction: async (work: (tx: any) => Promise<unknown>) => work(client),
      $executeRaw: async () => undefined,
      expenseSubstituteReceiptEvidence: { findFirst: async () => null },
      expenseLine: {
        deleteMany: async () => ({ count: 0 }),
        upsert: async (input: any) => { upsertInput = input; return input.create; },
      },
    };
    const repo = new PrismaExpenseRepository({ client } as any);
    await repo.upsertLines('company-1', 'expense-1', [{
      expenseId: 'expense-1', companyId: 'company-1', lineNumber: 1, description: 'Imported service', quantity: '1', unitPrice: '100',
      discountAmount: '0', taxableAmount: '100', vatRate: '0.07', vatAmount: '7', whtRate: null, whtAmount: '0',
      lineSubtotalAmount: '100', lineTotalAmount: '107', expenseCategoryId: null, accountHintKey: null, taxCategory: null,
      taxCodeDefinitionId: 'tax-i7', externalTaxCode: 'I7', sourceLineId: 'source-line-1', transactionContext: 'IMPORT_SERVICE',
      evidenceRefs: ['attachment-1'], authoritativeCustomsValue: '100', authoritativeDutyAmount: '1', authoritativeExciseAmount: '2',
      authoritativeOtherTaxAmount: '3', authoritativeImportVatAmount: '7', taxSnapshot, taxComponents: [],
    } as any]);

    const resolverOnlyFields = [
      'externalTaxCode', 'sourceLineId', 'transactionContext', 'evidenceRefs', 'authoritativeCustomsValue',
      'authoritativeDutyAmount', 'authoritativeExciseAmount', 'authoritativeOtherTaxAmount', 'authoritativeImportVatAmount',
      'taxSnapshot', 'taxComponents',
    ];
    for (const field of resolverOnlyFields) {
      assert.equal(field in upsertInput.create, false, `${field} leaked into create`);
      assert.equal(field in upsertInput.update, false, `${field} leaked into update`);
    }
  });
});
