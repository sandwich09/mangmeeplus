import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaReimbursementRepository } from './prisma-reimbursement.repository';

// Owner decision 2026-08-10: recording the claim payout mirrors PAID onto the claim's
// CONFIRMED expense projections (no ExpensePayment row), and voiding the payout takes
// the mirror back. These specs pin both directions of that contract.

const PAID_AT = new Date('2026-08-10T04:00:00.000Z');
const VERSION = new Date('2026-08-10T01:00:00.000Z');

function recordHarness() {
  const expenseUpdates: any[] = [];
  const request: any = {
    id: 'rb-1', companyId: 'co-1', status: 'READY_FOR_PAYMENT', updatedAt: VERSION,
    amount: '289.0000', paymentTotalAmount: '0.0000', outstandingAmount: '289.0000',
    financeReviewStatus: 'APPROVED_FOR_PAYMENT', requesterDisplayNameSnapshot: 'sandwich',
    lines: [], approvalSteps: [], payments: [], duplicateCandidates: [],
    createdAt: VERSION, paymentStatus: 'UNPAID', duplicateStatus: 'NO_MATCH',
    receiptRequirementStatus: 'ATTACHED', postingStatus: 'not_required',
    requesterUserId: 'staff-1', reason: 'r', categoryKey: 'other', currency: 'THB',
    incurredDate: VERSION, createdByUserId: 'staff-1',
  };
  const tx: any = {
    $executeRaw: async () => 0,
    reimbursementRequest: {
      findFirst: async () => request,
      findFirstOrThrow: async () => request,
      updateMany: async ({ data }: any) => { Object.assign(request, data); return { count: 1 }; },
    },
    reimbursementPayment: {
      findFirst: async () => null,
      create: async ({ data }: any) => ({ id: 'pay-1', ...data, createdAt: VERSION, updatedAt: VERSION, status: 'RECORDED' }),
      update: async ({ data }: any) => ({
        id: 'pay-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', paidAmount: '289.0000',
        currency: 'THB', paymentMethod: 'BANK_TRANSFER', paidAt: PAID_AT, status: 'RECORDED',
        postingStatus: 'pending', paidByUserId: 'finance-1', createdAt: VERSION, updatedAt: VERSION, ...data,
      }),
    },
    reimbursementPolicy: { findFirst: async () => null },
    reimbursementDuplicateCandidate: { count: async () => 0 },
    expenseRecord: {
      findMany: async ({ where }: any) => {
        assert.equal(where.sourceReimbursementRequestId, 'rb-1');
        assert.equal(where.status, 'CONFIRMED');
        return [{ id: 'exp-2', netPayableAmount: '289.0000' }];
      },
      update: async (args: any) => { expenseUpdates.push(args); return {}; },
    },
  };
  const client: any = { $transaction: async (work: (t: any) => Promise<unknown>) => work(tx) };
  const repo = new PrismaReimbursementRepository({ client } as any, {} as any);
  // Projection readiness runs its own queries; the mirror is what this spec pins.
  (repo as any).assertClaimProjectionsReady = async () => undefined;
  return { repo, expenseUpdates };
}

describe('reimbursement payout mirrors the claim expense projections', () => {
  it('marks confirmed projections PAID with the payout method/date and no ExpensePayment row', async () => {
    const { repo, expenseUpdates } = recordHarness();
    await repo.recordPaymentAtomic({
      companyId: 'co-1', reimbursementRequestId: 'rb-1', idempotencyKey: 'k-1',
      paidAmount: '289.0000', currency: 'THB', paymentMethod: 'BANK_TRANSFER',
      paidAt: PAID_AT, paymentReference: 'TRX-123', paidByUserId: 'finance-1',
    });

    assert.equal(expenseUpdates.length, 1);
    assert.deepEqual(expenseUpdates[0].where, { id: 'exp-2' });
    assert.deepEqual(expenseUpdates[0].data, {
      paymentStatus: 'PAID', paidAmount: '289.0000', outstandingAmount: '0.0000',
      paymentMethod: 'BANK_TRANSFER', paidAt: PAID_AT, updatedByUserId: 'finance-1',
    });
  });

  it('reverts projections to unpaid when the payout is voided', async () => {
    const expenseUpdates: any[] = [];
    const request: any = {
      id: 'rb-1', companyId: 'co-1', status: 'PAID', amount: '289.0000',
      paymentTotalAmount: '289.0000', outstandingAmount: '0.0000', paymentStatus: 'PAID',
      requesterDisplayNameSnapshot: 'sandwich', lines: [], approvalSteps: [], payments: [],
      duplicateCandidates: [], claimSignatures: [], createdAt: VERSION, updatedAt: VERSION,
      duplicateStatus: 'NO_MATCH', receiptRequirementStatus: 'ATTACHED', postingStatus: 'not_required',
      financeReviewStatus: 'APPROVED_FOR_PAYMENT', requesterUserId: 'staff-1', reason: 'r',
      categoryKey: 'other', currency: 'THB', incurredDate: VERSION, createdByUserId: 'staff-1',
    };
    const tx: any = {
      reimbursementPayment: {
        updateMany: async () => ({ count: 1 }),
        findFirstOrThrow: async () => ({
          id: 'pay-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', paidAmount: '289.0000',
          currency: 'THB', paymentMethod: 'BANK_TRANSFER', paidAt: PAID_AT, status: 'VOIDED',
          postingStatus: 'pending', paidByUserId: 'finance-1', createdAt: VERSION, updatedAt: VERSION,
        }),
        update: async ({ data }: any) => data,
      },
      journalEntry: { findFirst: async () => null },
      reimbursementRequest: {
        findFirstOrThrow: async () => request,
        update: async ({ data }: any) => { Object.assign(request, data); return request; },
      },
      expenseRecord: {
        findMany: async ({ where }: any) => {
          assert.equal(where.paymentStatus, 'PAID');
          return [{ id: 'exp-2', netPayableAmount: '289.0000' }];
        },
        update: async (args: any) => { expenseUpdates.push(args); return {}; },
      },
    };
    const client: any = { $transaction: async (work: (t: any) => Promise<unknown>) => work(tx) };
    const repo = new PrismaReimbursementRepository({ client } as any, {} as any);
    await repo.voidPaymentTrueReversal('co-1', 'rb-1', 'pay-1', 'finance-1', 'โอนผิดบัญชี');

    assert.equal(expenseUpdates.length, 1);
    assert.deepEqual(expenseUpdates[0].data, {
      paymentStatus: 'UNPAID', paidAmount: '0.0000', outstandingAmount: '289.0000',
      paymentMethod: null, paidAt: null, updatedByUserId: 'finance-1',
    });
    assert.equal(request.status, 'READY_FOR_PAYMENT');
  });
});
