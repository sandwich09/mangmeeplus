import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RecordExpensePaymentUseCase } from './expense-draft.use-case';

const noopAudit = { log: async () => undefined } as any;
const noopOutbox = { append: async () => undefined } as any;

function ctx() {
  return {
    requestId: 'req-1', authSubject: 'finance-1', userId: 'finance-1', companyId: 'co-1',
    membershipId: 'm-1', roles: ['FINANCE'], permissions: ['expense.payment.record'],
    scopes: {}, authProvider: 'watchdog',
  } as any;
}

describe('RecordExpensePaymentUseCase', () => {
  it('refuses a manual payment on a claim projection — the reimbursement payout settles it', async () => {
    const repo: any = {
      findById: async () => ({
        id: 'exp-2', companyId: 'co-1', branchId: null, status: 'CONFIRMED',
        sourceReimbursementRequestId: 'rb-1', outstandingAmount: '289.0000',
      }),
      recordPaymentAtomic: async () => { throw new Error('must not reach the write'); },
    };
    const useCase = new RecordExpensePaymentUseCase(repo, noopAudit, noopOutbox);
    await assert.rejects(
      () => useCase.execute(ctx(), 'exp-2', { paidAmount: '289.0000', paymentMethod: 'BANK_TRANSFER' }),
      (error: any) => error.getResponse?.().code === 'expense_settled_via_reimbursement',
    );
  });

  it('still records payments on ordinary expenses', async () => {
    let recorded: any;
    const repo: any = {
      findById: async () => ({
        id: 'exp-1', companyId: 'co-1', branchId: null, status: 'CONFIRMED',
        sourceReimbursementRequestId: null, outstandingAmount: '289.0000',
      }),
      recordPaymentAtomic: async (input: any) => {
        recorded = input;
        return {
          payment: { id: 'pay-1' },
          expense: { id: 'exp-1', paidAmount: '289.0000', paymentStatus: 'PAID' },
        };
      },
    };
    const useCase = new RecordExpensePaymentUseCase(repo, noopAudit, noopOutbox);
    const result = await useCase.execute(ctx(), 'exp-1', { paidAmount: '289.0000', paymentMethod: 'CASH' });
    assert.equal(recorded.amount, '289.0000');
    assert.equal(result.paymentStatus, 'PAID');
  });
});
