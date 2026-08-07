import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaExpenseRepository } from './prisma-expense.repository';

function makeRepo(journals: Array<{ id: string; sourceType: string; entryNumber: string }>) {
  const prisma = {
    client: {
      expenseRecord: {
        findFirst: async () => ({
          id: 'expense-1',
          companyId: 'co-1',
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          sourceReimbursementRequestId: null,
          journalEntryId: null,
          lines: [],
          duplicateCandidates: [],
        }),
      },
      journalEntry: {
        findMany: async () => journals,
      },
      attachmentLink: {
        findMany: async () => [],
      },
      expenseSubstituteReceiptEvidence: {
        findFirst: async () => null,
      },
    },
  };
  return new PrismaExpenseRepository(prisma as any);
}

describe('PrismaExpenseRepository expense posting-source projection', () => {
  it('requests the accrual when no generated journal exists', async () => {
    const expense = await makeRepo([]).findByIdWithRelations('co-1', 'expense-1');
    assert.equal(expense?.pendingPostingSourceType, 'expense.record');
    assert.equal(expense?.journalEntryId, null);
  });

  it('requests the payment leg and repairs the readable JV reference from ledger truth', async () => {
    const expense = await makeRepo([
      { id: 'journal-accrual', sourceType: 'expense.record', entryNumber: 'JV-ACCRUAL' },
    ]).findByIdWithRelations('co-1', 'expense-1');
    assert.equal(expense?.pendingPostingSourceType, 'expense.payment');
    assert.equal(expense?.journalEntryId, 'journal-accrual');
    assert.equal(expense?.journalEntryNumber, 'JV-ACCRUAL');
  });

  it('has no outstanding source after both generated journals exist', async () => {
    const expense = await makeRepo([
      { id: 'journal-accrual', sourceType: 'expense.record', entryNumber: 'JV-ACCRUAL' },
      { id: 'journal-payment', sourceType: 'expense.payment', entryNumber: 'JV-PAYMENT' },
    ]).findByIdWithRelations('co-1', 'expense-1');
    assert.equal(expense?.pendingPostingSourceType, null);
    assert.equal(expense?.journalEntryId, 'journal-payment');
    assert.equal(expense?.journalEntryNumber, 'JV-PAYMENT');
  });
});
