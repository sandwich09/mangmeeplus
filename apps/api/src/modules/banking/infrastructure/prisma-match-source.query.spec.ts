import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaMatchSourceQuery } from './prisma-match-source.query';

describe('PrismaMatchSourceQuery expense payment history', () => {
  it('returns and allocates each partial payment independently', async () => {
    let expenseWhere: any;
    const empty = { findMany: async () => [] };
    const prisma: any = { client: {
      accountingPayment: empty,
      expensePayment: { findMany: async ({ where }: any) => {
        expenseWhere = where;
        return [
          {
            id: 'payment-1', paidAt: new Date('2026-08-09T00:00:00.000Z'), amount: '40.0000', currency: 'THB',
            bankAccountRef: 'BANK-1', status: 'RECORDED',
            expense: { expenseNumber: 'EXP-1', vendorNameSnapshot: 'Vendor', vendorDocumentNumber: 'R-1' },
          },
          {
            id: 'payment-2', paidAt: new Date('2026-08-10T00:00:00.000Z'), amount: '60.0000', currency: 'THB',
            bankAccountRef: null, status: 'RECORDED',
            expense: { expenseNumber: 'EXP-1', vendorNameSnapshot: 'Vendor', vendorDocumentNumber: 'R-1' },
          },
        ];
      } },
      supplierPayment: empty,
      reimbursementPayment: empty,
      bankAdjustment: empty,
      bankReconciliationMatch: { findMany: async () => [{ sourceType: 'EXPENSE_PAYMENT', sourceId: 'payment-1', allocatedAmount: '10.0000' }] },
    } };

    const rows = await new PrismaMatchSourceQuery(prisma).listCandidates('company-1', ['branch-1']);

    assert.deepEqual(rows.map((row) => [row.sourceId, row.amount, row.remainingUnmatchedAmount]), [
      ['payment-1', '40.0000', '30.00'],
      ['payment-2', '60.0000', '60.00'],
    ]);
    assert.equal(rows[0]?.reference, 'BANK-1');
    assert.equal(rows[1]?.reference, 'R-1');
    assert.equal(expenseWhere.status, 'RECORDED');
    assert.equal(expenseWhere.expense.is.sourceReimbursementRequestId, null);
    assert.deepEqual(expenseWhere.expense.is.OR, [{ branchId: { in: ['branch-1'] } }, { branchId: null }]);
  });
});
