import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaExpenseRepository } from './prisma-expense.repository';

function makeRepo(
  journals: Array<{ id: string; sourceId: string; sourceType: string; entryNumber: string }>,
  payments: Array<{ id: string; status: string; postingStatus: string }> = [],
) {
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
          payments: payments.map((payment) => ({
            companyId: 'co-1', expenseId: 'expense-1', amount: '50.00', currency: 'THB', paymentMethod: 'BANK_TRANSFER',
            paidAt: new Date('2026-08-10T00:00:00.000Z'), bankAccountRef: null, journalEntryId: null, postingError: null,
            createdByUserId: 'finance-1', voidedByUserId: null, voidedAt: null,
            createdAt: new Date('2026-08-10T00:00:00.000Z'), updatedAt: new Date('2026-08-10T00:00:00.000Z'),
            ...payment,
          })),
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
    assert.equal(expense?.pendingPostingSourceId, 'expense-1');
    assert.equal(expense?.journalEntryId, null);
  });

  it('requests the payment leg and repairs the readable JV reference from ledger truth', async () => {
    const expense = await makeRepo([
      { id: 'journal-accrual', sourceId: 'expense-1', sourceType: 'expense.record', entryNumber: 'JV-ACCRUAL' },
    ], [{ id: 'payment-1', status: 'RECORDED', postingStatus: 'pending' }]).findByIdWithRelations('co-1', 'expense-1');
    assert.equal(expense?.pendingPostingSourceType, 'expense.payment');
    assert.equal(expense?.pendingPostingSourceId, 'payment-1');
    assert.equal(expense?.journalEntryId, 'journal-accrual');
    assert.equal(expense?.journalEntryNumber, 'JV-ACCRUAL');
  });

  it('has no outstanding source after both generated journals exist', async () => {
    const expense = await makeRepo([
      { id: 'journal-accrual', sourceId: 'expense-1', sourceType: 'expense.record', entryNumber: 'JV-ACCRUAL' },
      { id: 'journal-payment', sourceId: 'payment-1', sourceType: 'expense.payment', entryNumber: 'JV-PAYMENT' },
    ], [{ id: 'payment-1', status: 'RECORDED', postingStatus: 'posted' }]).findByIdWithRelations('co-1', 'expense-1');
    assert.equal(expense?.pendingPostingSourceType, null);
    assert.equal(expense?.journalEntryId, 'journal-accrual');
    assert.equal(expense?.journalEntryNumber, 'JV-ACCRUAL');
  });
});

describe('PrismaExpenseRepository shared evidence posting state', () => {
  it('honors the 500-row export contract and uses stable pagination for tied dates', async () => {
    let query: any;
    const repo = new PrismaExpenseRepository({ client: { expenseRecord: {
      findMany: async (args: any) => { query = args; return []; }, count: async () => 0,
    } } } as any);
    const page = await repo.listSharedEvidence('co-1', { page: 2, pageSize: 500 });
    assert.equal(page.pageSize, 500);
    assert.equal(query.take, 500);
    assert.equal(query.skip, 500);
    assert.deepEqual(query.orderBy, [{ uploadedAt: 'desc' }, { id: 'desc' }]);
  });
  it('uses the selected branch and includes the last civil day with the same date lens as the list', () => {
    const repo = makeRepo([]);
    const uploaded = repo.buildSharedEvidenceWhere('co-1', { branchId: 'b1', yearMonth: '2026-08', dateField: 'uploadedAt' });
    assert.equal(uploaded.branchId, 'b1');
    assert.deepEqual(uploaded.uploadedAt, { gte: new Date('2026-07-31T17:00:00Z'), lt: new Date('2026-08-31T17:00:00Z') });
    const document = repo.buildSharedEvidenceWhere('co-1', { fromDate: '2026-08-31', toDate: '2026-08-31', dateField: 'expenseDate' });
    assert.deepEqual(document.expenseDate, { gte: new Date('2026-08-31T00:00:00Z'), lt: new Date('2026-09-01T00:00:00Z') });
  });
  it('keeps branch scope while filtering pending payment events', () => {
    const where = makeRepo([]).buildSharedEvidenceWhere('co-1', { postingStatus: 'pending' }, { branchIds: ['branch-1'] });
    assert.deepEqual(where['AND'], [
      { OR: [{ branchId: { in: ['branch-1'] } }, { branchId: null }] },
      { OR: [
        { postingStatus: 'pending' },
        { payments: { some: { status: 'RECORDED', postingStatus: 'pending' } } },
      ] },
    ]);
  });

  it('shows a payment posting error instead of the already-posted accrual state', async () => {
    const record: any = {
      id: 'expense-1', companyId: 'co-1', status: 'CONFIRMED', postingStatus: 'posted', postingError: null,
      sourceReimbursementRequestId: null, journalEntryId: 'journal-accrual', expenseCategory: null,
    };
    const repo = new PrismaExpenseRepository({ client: {
      expenseRecord: { findMany: async () => [record], count: async () => 1 },
      attachmentLink: { findMany: async () => [] },
      expensePayment: { findMany: async () => [{ id: 'payment-1', expenseId: 'expense-1', postingStatus: 'posting_error', postingError: 'payment failed' }] },
      journalEntry: { findMany: async () => [{ id: 'journal-accrual', sourceId: 'expense-1', sourceType: 'expense.record', entryNumber: 'JV-1' }] },
    } } as any);

    const page = await repo.listSharedEvidence('co-1', {});
    assert.equal(page.rows[0]?.postingStatus, 'posting_error');
    assert.equal(page.rows[0]?.postingError, 'payment failed');
    assert.equal(page.rows[0]?.pendingPostingSourceId, 'payment-1');
  });
});
