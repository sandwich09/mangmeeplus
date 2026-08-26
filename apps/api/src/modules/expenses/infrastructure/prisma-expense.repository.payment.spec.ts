import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaExpenseRepository } from './prisma-expense.repository';

const VERSION = new Date('2026-08-10T01:00:00.000Z');

function expense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'expense-1', companyId: 'company-1', status: 'CONFIRMED', sourceReimbursementRequestId: null,
    currency: 'THB', netPayableAmount: '100.0000', paidAmount: '0.0000', outstandingAmount: '100.0000',
    paymentStatus: 'UNPAID', postingStatus: 'posted', paymentMethod: null, paidAt: null, bankAccountRef: null,
    createdByUserId: 'creator-1', updatedByUserId: null, createdAt: VERSION, updatedAt: VERSION,
    ...overrides,
  };
}

function harness(overrides: Record<string, unknown> = {}) {
  const state = { expense: expense(overrides), payments: [] as any[] };
  let forceCasFailure = false;
  const client: any = {
    $transaction: async (work: (tx: any) => Promise<unknown>) => {
      const draft = structuredClone(state);
      const tx = {
        $executeRaw: async () => 0,
        expenseRecord: {
          findFirst: async () => draft.expense,
          findFirstOrThrow: async () => draft.expense,
          updateMany: async ({ where, data }: any) => {
            if (forceCasFailure || where.status !== draft.expense.status
              || where.updatedAt.getTime() !== draft.expense.updatedAt.getTime()) return { count: 0 };
            Object.assign(draft.expense, data, { updatedAt: new Date(draft.expense.updatedAt.getTime() + 1) });
            return { count: 1 };
          },
        },
        expensePayment: {
          create: async ({ data }: any) => {
            const row = {
              ...data, id: `payment-${draft.payments.length + 1}`, journalEntryId: null, postingError: null,
              voidedByUserId: null, voidedAt: null, createdAt: VERSION, updatedAt: VERSION,
            };
            draft.payments.push(row);
            return row;
          },
        },
      };
      const result = await work(tx);
      state.expense = draft.expense;
      state.payments = draft.payments;
      return result;
    },
  };
  return {
    state,
    repo: new PrismaExpenseRepository({ client } as any),
    failNextCas: () => { forceCasFailure = true; },
  };
}

function pay(repo: PrismaExpenseRepository, amount: string) {
  return repo.recordPaymentAtomic({
    companyId: 'company-1', expenseId: 'expense-1', actorUserId: 'finance-1', amount,
    paymentMethod: 'BANK_TRANSFER', paidAt: new Date('2026-08-10T00:00:00.000Z'), bankAccountRef: 'BANK-1',
  });
}

describe('PrismaExpenseRepository partial payment history', () => {
  it('appends each payment, accumulates the header, and preserves accrual posting state', async () => {
    const { repo, state } = harness();
    const first = await pay(repo, '40.00');
    const second = await pay(repo, '60.00');

    assert.equal(first.expense.paidAmount, '40.0000');
    assert.equal(first.expense.paymentStatus, 'PARTIALLY_PAID');
    assert.equal(second.expense.paidAmount, '100.0000');
    assert.equal(second.expense.outstandingAmount, '0.0000');
    assert.equal(second.expense.paymentStatus, 'PAID');
    assert.equal(state.expense.postingStatus, 'posted');
    assert.deepEqual(state.payments.map((payment) => payment.amount), ['40.0000', '60.0000']);
  });

  it('rejects overpayment without appending or changing the cumulative total', async () => {
    const { repo, state } = harness({ paidAmount: '80.0000', outstandingAmount: '20.0000', paymentStatus: 'PARTIALLY_PAID' });
    await assert.rejects(
      () => pay(repo, '20.01'),
      (error: unknown) => error instanceof BadRequestException
        && (error.getResponse() as any).code === 'expense_payment_exceeds_outstanding',
    );
    assert.equal(state.expense.paidAmount, '80.0000');
    assert.equal(state.payments.length, 0);
  });

  it('returns the stable validation error for a malformed amount', async () => {
    const { repo, state } = harness();
    await assert.rejects(
      () => pay(repo, 'not-a-number'),
      (error: unknown) => error instanceof BadRequestException
        && (error.getResponse() as any).code === 'expense_payment_exceeds_outstanding',
    );
    assert.equal(state.payments.length, 0);
  });

  it('rolls the payment row back when the aggregate CAS loses', async () => {
    const { repo, state, failNextCas } = harness();
    failNextCas();
    await assert.rejects(
      () => pay(repo, '40.00'),
      (error: unknown) => error instanceof ConflictException
        && (error.getResponse() as any).code === 'expense_payment_changed',
    );
    assert.equal(state.expense.paidAmount, '0.0000');
    assert.equal(state.payments.length, 0);
  });

  // FIN-01: pre-satang-policy rows carry a 4dp payable. The document, the UI and the payment
  // input all show its 2dp rounding, so paying that figure has to settle the row — otherwise
  // finance sees an outstanding balance of ฿0.00 on a row the system still calls PARTIALLY_PAID,
  // and the overshoot guard leaves no amount that can ever close it.
  it('settles a legacy 4dp payable when the displayed satang amount is paid', async () => {
    const { repo, state } = harness({ netPayableAmount: '580.0042', outstandingAmount: '580.0042' });
    const { expense: paid } = await pay(repo, '580.00');

    assert.equal(paid.outstandingAmount, '0.0000');
    assert.equal(paid.paymentStatus, 'PAID');
    assert.equal(state.expense.paidAmount, '580.0000');
  });

  it('accepts the rounded-up satang amount of a legacy payable that rounds up', async () => {
    const { repo } = harness({ netPayableAmount: '580.0062', outstandingAmount: '580.0062' });
    const { expense: paid } = await pay(repo, '580.01');

    assert.equal(paid.outstandingAmount, '0.0000');
    assert.equal(paid.paymentStatus, 'PAID');
  });

  it('keeps a real one-satang shortfall partially paid', async () => {
    const { repo } = harness({ netPayableAmount: '580.0100', outstandingAmount: '580.0100' });
    const { expense: paid } = await pay(repo, '580.00');

    assert.equal(paid.outstandingAmount, '0.0100');
    assert.equal(paid.paymentStatus, 'PARTIALLY_PAID');
  });

  it('refuses an overpayment a full satang past the payable', async () => {
    const { repo, state } = harness({ netPayableAmount: '580.0062', outstandingAmount: '580.0062' });
    await assert.rejects(
      () => pay(repo, '580.02'),
      (error: unknown) => error instanceof BadRequestException
        && (error.getResponse() as any).code === 'expense_payment_exceeds_outstanding',
    );
    assert.equal(state.expense.paidAmount, '0.0000');
    assert.equal(state.payments.length, 0);
  });

  it('blocks direct settlement of a claim-born expense', async () => {
    const { repo, state } = harness({ sourceReimbursementRequestId: 'reimbursement-1' });
    await assert.rejects(
      () => pay(repo, '40.00'),
      (error: unknown) => error instanceof BadRequestException
        && (error.getResponse() as any).code === 'claim_expense_settles_via_reimbursement',
    );
    assert.equal(state.payments.length, 0);
  });
});
