import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { RecordExpensePaymentUseCase } from '../application/use-cases/expense-draft.use-case';
import { AuditService } from '../../audit/application/audit.service';
import { PrismaAuditRepository } from '../../audit/infrastructure/prisma-audit.repository';
import { PrismaExpenseRepository } from './prisma-expense.repository';

const VERSION = new Date('2026-08-10T01:00:00.000Z');

function expense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'expense-1', companyId: 'company-1', branchId: null, status: 'CONFIRMED', sourceReimbursementRequestId: null,
    currency: 'THB', netPayableAmount: '100.0000', paidAmount: '0.0000', outstandingAmount: '100.0000',
    paymentStatus: 'UNPAID', postingStatus: 'posted', paymentMethod: null, paidAt: null, bankAccountRef: null,
    createdByUserId: 'creator-1', updatedByUserId: null, createdAt: VERSION, updatedAt: VERSION,
    ...overrides,
  };
}

function harness(overrides: Record<string, unknown> = {}) {
  const state = { expense: expense(overrides), payments: [] as any[], audits: [] as any[], events: [] as any[] };
  let forceCasFailure = false;
  let failingWrite: 'audit' | 'outbox' | undefined;
  const client: any = {
    expenseRecord: { findFirst: async () => state.expense },
    $transaction: async (work: (tx: any) => Promise<unknown>) => {
      const draft = structuredClone(state);
      const tx = {
        $executeRaw: async () => 0,
        expenseRecord: {
          findFirst: async ({ where }: any) => where.companyId === draft.expense.companyId && where.id === draft.expense.id ? draft.expense : null,
          findFirstOrThrow: async () => draft.expense,
          updateMany: async ({ where, data }: any) => {
            if (forceCasFailure || where.status !== draft.expense.status
              || where.updatedAt.getTime() !== draft.expense.updatedAt.getTime()) return { count: 0 };
            Object.assign(draft.expense, data, { updatedAt: new Date(draft.expense.updatedAt.getTime() + 1) });
            return { count: 1 };
          },
        },
        expensePayment: {
          findFirst: async ({ where }: any) => draft.payments.find((row) => row.companyId === where.companyId && row.idempotencyKey === where.idempotencyKey) ?? null,
          create: async ({ data }: any) => {
            const row = {
              ...data, id: `payment-${draft.payments.length + 1}`, journalEntryId: null, postingError: null,
              voidedByUserId: null, voidedAt: null, createdAt: VERSION, updatedAt: VERSION,
            };
            draft.payments.push(row);
            return row;
          },
        },
        auditLog: { create: async ({ data }: any) => {
          if (failingWrite === 'audit') throw new Error('audit unavailable');
          draft.audits.push(data);
        } },
        outboxEvent: { create: async ({ data }: any) => {
          if (failingWrite === 'outbox') throw new Error('outbox unavailable');
          draft.events.push(data);
        } },
      };
      const result = await work(tx);
      state.expense = draft.expense;
      state.payments = draft.payments;
      state.audits = draft.audits;
      state.events = draft.events;
      return result;
    },
  };
  return {
    state,
    repo: new PrismaExpenseRepository({ client } as any),
    failNextCas: () => { forceCasFailure = true; },
    failWrite: (kind: 'audit' | 'outbox') => { failingWrite = kind; },
  };
}

function paymentInput(amount: string, overrides: Record<string, unknown> = {}) {
  return {
    companyId: 'company-1', expenseId: 'expense-1', actorUserId: 'finance-1', amount,
    scopes: {}, idempotencyKey: `client:${randomUUID()}`,
    paymentMethod: 'BANK_TRANSFER', paidAt: '2026-08-10', bankAccountRef: 'BANK-1',
    ...overrides,
  };
}

function pay(repo: PrismaExpenseRepository, amount: string, overrides: Record<string, unknown> = {}) {
  return repo.recordPaymentAtomic(paymentInput(amount, overrides));
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

  it('replays equivalent money/reference without another row, totals increment, or hook', async () => {
    const { repo, state } = harness();
    let hooks = 0;
    const input = paymentInput('40', { bankAccountRef: ' BANK-1 ' });
    const first = await repo.recordPaymentAtomic(input, async () => { hooks += 1; });
    const replay = await repo.recordPaymentAtomic({ ...input, amount: '40.00', bankAccountRef: 'BANK-1' }, async () => { hooks += 1; });
    assert.equal(replay.payment.id, first.payment.id);
    assert.equal(replay.replayed, true);
    assert.equal(replay.expense.paidAmount, '40.0000');
    assert.equal(state.payments.length, 1);
    assert.equal(hooks, 1);
  });

  it('keeps an omitted legacy date stable instead of assigning a new instant on replay', async () => {
    const { repo, state } = harness();
    const input = paymentInput('40', { paidAt: undefined });
    const first = await repo.recordPaymentAtomic(input);
    const replay = await repo.recordPaymentAtomic(input);
    assert.equal(replay.payment.paidAt.getTime(), first.payment.paidAt.getTime());
    assert.equal(state.payments.length, 1);
  });

  it('normalizes legacy optional null/blank fields and preserves an already-posted payment on replay', async () => {
    const { repo, state } = harness();
    const input = paymentInput('40', { paidAt: undefined, paymentMethod: undefined, bankAccountRef: undefined });
    await repo.recordPaymentAtomic(input);
    Object.assign(state.payments[0], { postingStatus: 'posted', journalEntryId: 'original-journal' });
    const replay = await repo.recordPaymentAtomic({ ...input, paidAt: null, paymentMethod: null, bankAccountRef: '  ' } as any);
    assert.equal(replay.replayed, true);
    assert.equal(replay.payment.postingStatus, 'posted');
    assert.equal(replay.payment.journalEntryId, 'original-journal');
    assert.equal(state.payments.length, 1);
  });

  it('returns 409 for each changed canonical field, without rounding a distinct satang into a replay', async () => {
    const { repo, state } = harness();
    const input = paymentInput('40.00');
    await repo.recordPaymentAtomic(input);
    for (const change of [{ amount: '40.01' }, { paidAt: '2026-08-09' }, { paidAt: undefined }, { paymentMethod: 'CASH' }, { bankAccountRef: 'BANK-2' }]) {
      await assert.rejects(() => repo.recordPaymentAtomic({ ...input, ...change }), (error: any) => error.getStatus?.() === 409 && error.getResponse().code === 'expense_payment_idempotency_conflict');
    }
    assert.equal(state.payments.length, 1);
    assert.equal(state.expense.paidAmount, '40.0000');
  });

  it('allows a genuine equal-value second payment with a new key', async () => {
    const { repo, state } = harness();
    await pay(repo, '40');
    await pay(repo, '40');
    assert.equal(state.payments.length, 2);
    assert.equal(state.expense.paidAmount, '80.0000');
  });

  it('rechecks tenant and branch at the final transaction boundary before replay', async () => {
    const { repo, state } = harness({ branchId: 'branch-1' });
    const input = paymentInput('40', { scopes: { branchIds: ['branch-1'] } });
    await repo.recordPaymentAtomic(input);
    await assert.rejects(() => repo.recordPaymentAtomic({ ...input, companyId: 'foreign-company' }), NotFoundException);
    await assert.rejects(() => repo.recordPaymentAtomic({ ...input, scopes: { branchIds: ['branch-2'] } }), ForbiddenException);
    Object.assign(state.expense, { branchId: 'branch-2' });
    await assert.rejects(() => repo.recordPaymentAtomic(input), ForbiddenException);
    assert.equal(state.payments.length, 1);
  });

  it('replays a voided source as its current voided state and never reapplies settlement', async () => {
    const { repo, state } = harness();
    const input = paymentInput('40');
    await repo.recordPaymentAtomic(input);
    Object.assign(state.expense, { status: 'VOIDED', paidAmount: '0.0000', outstandingAmount: '0.0000' });
    state.payments[0].status = 'VOIDED';
    const result = await repo.recordPaymentAtomic(input, async () => { assert.fail('no replay side effects'); });
    assert.equal(result.expense.status, 'VOIDED');
    assert.equal(result.expense.paidAmount, '0.0000');
    assert.equal(result.payment.status, 'VOIDED');
    assert.equal(state.payments.length, 1);
  });

  it('rejects impossible dates and non-public money grammar without writing anything', async () => {
    const { repo, state } = harness();
    for (const amount of ['40.0001', '4e1', 'NaN', 'Infinity', '0', '-1', '01']) {
      await assert.rejects(() => pay(repo, amount), BadRequestException);
    }
    for (const paidAt of ['2026-02-30', '2026-08-10T00:00:00Z', '2569-08-10', '']) {
      await assert.rejects(() => pay(repo, '40', { paidAt }), BadRequestException);
    }
    assert.equal(state.payments.length, 0);
  });

  for (const failedWrite of ['audit', 'outbox'] as const) {
    it(`rolls payment, totals, and all earlier side effects back when ${failedWrite} fails`, async () => {
      const { repo, state, failWrite } = harness();
      failWrite(failedWrite);
      const audit = { log: async (entry: any, tx: any) => tx.auditLog.create({ data: entry }) } as any;
      const useCase = new RecordExpensePaymentUseCase(repo, audit);
      await assert.rejects(() => useCase.execute({ companyId: 'company-1', userId: 'finance-1', requestId: 'request-1', permissions: ['expense.payment.record'], scopes: {} } as any,
        'expense-1', { paidAmount: '40', idempotencyKey: 'atomic-intent' }), new RegExp(`${failedWrite} unavailable`));
      assert.equal(state.expense.paidAmount, '0.0000');
      assert.equal(state.payments.length, 0);
      assert.equal(state.audits.length, 0);
      assert.equal(state.events.length, 0);
    });
  }
});

describe('Expense payment intent integrity (real PostgreSQL)', () => {
  const required = process.env.EXPENSE_PAYMENT_REQUIRE_POSTGRES === 'true';
  const companyId = `expense-intent-pg-${randomUUID()}`;
  const userId = `${companyId}-user`;
  let clients: PrismaClient[] = [];
  let ready = false;
  let fixtureCreated = false;

  before(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      assert.equal(required, false, 'Expense payment PostgreSQL is required but DATABASE_URL is unavailable');
      return;
    }
    // A supplied but unavailable/unmigrated database is an error, never a silent skip.
    clients = [0, 1].map(() => new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }));
    await clients[0]!.$queryRaw`SELECT "idempotencyKey", "payloadFingerprint" FROM "ExpensePayment" LIMIT 0`;
    await clients[0]!.company.create({ data: { id: companyId, name: 'Synthetic expense intent tests' } });
    fixtureCreated = true;
    await clients[0]!.user.create({ data: { id: userId, displayName: 'Synthetic payment tester' } });
    ready = true;
  });

  after(async () => {
    const client = clients[0];
    if (!client) return;
    try {
      if (fixtureCreated) {
        await client.auditLog.deleteMany({ where: { companyId } });
        await client.outboxEvent.deleteMany({ where: { companyId } });
        await client.expensePayment.deleteMany({ where: { companyId } });
        await client.expenseRecord.deleteMany({ where: { companyId } });
        await client.company.deleteMany({ where: { id: companyId } });
        await client.user.deleteMany({ where: { id: userId } });
      }
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
  });

  const context = () => ({ companyId, userId, requestId: randomUUID(), permissions: ['expense.payment.record'], scopes: {} } as any);
  const useCase = (client: PrismaClient, audit?: AuditService) => new RecordExpensePaymentUseCase(
    new PrismaExpenseRepository({ client } as any),
    audit ?? new AuditService(new PrismaAuditRepository({ client } as any), { error: () => undefined } as any),
  );
  const createExpense = () => clients[0]!.expenseRecord.create({ data: {
    companyId, createdByUserId: userId, status: 'CONFIRMED', expenseDate: new Date('2026-07-31T00:00:00Z'),
    netPayableAmount: '100', outstandingAmount: '100', postingStatus: 'posted',
  } });

  async function assertPaymentEffects(expenseId: string, count: number, paidAmount: string) {
    const client = clients[0]!;
    const payments = await client.expensePayment.findMany({ where: { companyId, expenseId } });
    assert.equal(payments.length, count);
    assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } })).paidAmount.toFixed(4), paidAmount);
    const targetIds = payments.map((payment) => payment.id);
    assert.equal(await client.auditLog.count({ where: { companyId, action: 'expense.payment.record', targetId: { in: targetIds } } }), count);
    assert.equal(await client.outboxEvent.count({ where: { companyId, eventType: 'expense.payment_recorded', aggregateId: { in: targetIds } } }), count);
    assert.equal(new Set(payments.map((payment) => payment.id)).size, count, 'posting source identity is one per durable payment');
  }

  it('concurrent same-key calls from separate clients create exactly one payment, audit, event and totals increment', async (t) => {
    if (!ready) return t.skip('DATABASE_URL is not set');
    const expense = await createExpense();
    const input = { paidAmount: '40.00', paymentMethod: 'BANK_TRANSFER' as const, paidAt: '2026-07-31', idempotencyKey: randomUUID() };
    const [first, second] = await Promise.all(clients.map((client) => useCase(client).execute(context(), expense.id, input)));
    assert.equal(first.id, second.id);
    assert.equal(new Decimal(first.paidAmount).toFixed(4), '40.0000');
    assert.equal(new Decimal(second.paidAmount).toFixed(4), '40.0000');
    await assertPaymentEffects(expense.id, 1, '40.0000');
    const payment = await clients[0]!.expensePayment.findFirstOrThrow({ where: { companyId, expenseId: expense.id } });
    assert.equal(payment.paidAt.toISOString(), '2026-07-31T00:00:00.000Z');
    await useCase(clients[1]!).execute(context(), expense.id, { ...input, paidAmount: '40' });
    await assertPaymentEffects(expense.id, 1, '40.0000');
    await assert.rejects(() => useCase(clients[1]!).execute(context(), expense.id, { ...input, paidAmount: '40.01' }),
      (error: any) => error.getStatus?.() === 409 && error.getResponse().code === 'expense_payment_idempotency_conflict');
    await useCase(clients[1]!).execute(context(), expense.id, { ...input, idempotencyKey: randomUUID() });
    await assertPaymentEffects(expense.id, 2, '80.0000');
  });

  it('concurrent same-key different-expense calls return one success and a business 409, never a unique-constraint 500', async (t) => {
    if (!ready) return t.skip('DATABASE_URL is not set');
    const expenses = await Promise.all([createExpense(), createExpense()]);
    const input = { paidAmount: '40', idempotencyKey: randomUUID() };
    const results = await Promise.allSettled(clients.map((client, index) => useCase(client).execute(context(), expenses[index]!.id, input)));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const failed = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(failed.reason.getStatus?.(), 409);
    assert.equal(failed.reason.getResponse?.().code, 'expense_payment_idempotency_conflict');
    const payments = await clients[0]!.expensePayment.findMany({ where: { companyId, expenseId: { in: expenses.map((expense) => expense.id) } } });
    assert.equal(payments.length, 1);
    for (const expense of expenses) {
      await assertPaymentEffects(expense.id, expense.id === payments[0]!.expenseId ? 1 : 0, expense.id === payments[0]!.expenseId ? '40.0000' : '0.0000');
    }
  });

  it('concurrent distinct intents retain both genuine payments and legacy unkeyed history', async (t) => {
    if (!ready) return t.skip('DATABASE_URL is not set');
    const expense = await createExpense();
    await clients[0]!.expensePayment.createMany({ data: [0, 1].map(() => ({
      companyId, expenseId: expense.id, createdByUserId: userId, amount: '10', paidAt: new Date('2026-07-01T00:00:00Z'),
    })) });
    await clients[0]!.expenseRecord.update({ where: { id: expense.id }, data: { paidAmount: '20', outstandingAmount: '80', paymentStatus: 'PARTIALLY_PAID' } });
    await Promise.all(clients.map((client) => useCase(client).execute(context(), expense.id, { paidAmount: '40', idempotencyKey: randomUUID() })));
    const payments = await clients[0]!.expensePayment.findMany({ where: { companyId, expenseId: expense.id } });
    assert.equal(payments.length, 4);
    assert.equal(payments.filter((payment) => payment.idempotencyKey === null && payment.payloadFingerprint === null).length, 2);
    assert.equal((await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).paidAmount.toFixed(4), '100.0000');
    const newIds = payments.filter((payment) => payment.idempotencyKey !== null).map((payment) => payment.id);
    assert.equal(await clients[0]!.auditLog.count({ where: { companyId, targetId: { in: newIds } } }), 2);
    assert.equal(await clients[0]!.outboxEvent.count({ where: { companyId, aggregateId: { in: newIds } } }), 2);
  });

  for (const failedWrite of ['audit', 'outbox'] as const) {
    it(`a real PostgreSQL ${failedWrite} constraint failure rolls back payment/totals/audit/event, and retry succeeds`, async (t) => {
      if (!ready) return t.skip('DATABASE_URL is not set');
      const expense = await createExpense();
      const input = { paidAmount: '40', idempotencyKey: randomUUID() };
      const audit = new AuditService({ log: async (entry: any, tx: any) => {
        if (failedWrite === 'audit') {
          await tx.auditLog.create({ data: { ...entry, actorUserId: 'missing-user-for-intent-test' } });
        } else {
          await new PrismaAuditRepository({ client: clients[0] } as any).log(entry, tx);
          // Poison the exact event key inside the same transaction; the real use-case append
          // must fail and roll back this row, the preceding audit, payment and source totals.
          await tx.outboxEvent.create({ data: { companyId, eventType: 'synthetic-collision', aggregateType: 'expense_payment', aggregateId: entry.targetId,
            eventKey: `expense.payment_recorded:expense_payment:${entry.targetId}`, payloadJson: {} } });
        }
      } } as any, { error: () => undefined } as any);
      const auditBefore = await clients[0]!.auditLog.count({ where: { companyId } });
      const eventBefore = await clients[0]!.outboxEvent.count({ where: { companyId } });
      await assert.rejects(() => useCase(clients[0]!, audit).execute(context(), expense.id, input), (error: any) => ['P2002', 'P2003'].includes(error.code));
      await assertPaymentEffects(expense.id, 0, '0.0000');
      assert.equal(await clients[0]!.auditLog.count({ where: { companyId } }), auditBefore);
      assert.equal(await clients[0]!.outboxEvent.count({ where: { companyId } }), eventBefore);
      await useCase(clients[1]!).execute(context(), expense.id, input);
      await assertPaymentEffects(expense.id, 1, '40.0000');
    });
  }

  it('rechecks current scope on replay and returns voided state without restoring payment', async (t) => {
    if (!ready) return t.skip('DATABASE_URL is not set');
    const expense = await createExpense();
    const input = { paidAmount: '40', idempotencyKey: randomUUID() };
    await useCase(clients[0]!).execute(context(), expense.id, input);
    await clients[0]!.expenseRecord.update({ where: { id: expense.id }, data: { branchId: 'restricted-test-branch' } });
    await assert.rejects(() => useCase(clients[1]!).execute({ ...context(), scopes: { branchIds: ['other-branch'] } }, expense.id, input), ForbiddenException);
    await assert.rejects(() => useCase(clients[1]!).execute({ ...context(), companyId: 'foreign-company' }, expense.id, input), NotFoundException);
    await clients[0]!.expenseRecord.update({ where: { id: expense.id }, data: { branchId: null } });
    await new PrismaExpenseRepository({ client: clients[0] } as any).voidExpenseTrueReversal(companyId, expense.id, userId, 'Synthetic void replay regression');
    const result = await useCase(clients[1]!).execute(context(), expense.id, input);
    assert.equal(result.status, 'VOIDED');
    await assertPaymentEffects(expense.id, 1, '0.0000');
    assert.equal((await clients[0]!.expensePayment.findFirstOrThrow({ where: { companyId, expenseId: expense.id } })).status, 'VOIDED');
  });
});
