import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RecordExpensePaymentUseCase } from './expense-draft.use-case';

const noopAudit = { log: async () => undefined } as any;

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
    const useCase = new RecordExpensePaymentUseCase(repo, noopAudit);
    await assert.rejects(
      () => useCase.execute(ctx(), 'exp-2', { paidAmount: '289.0000', paymentMethod: 'BANK_TRANSFER' }),
      (error: any) => error.getResponse?.().code === 'expense_settled_via_reimbursement',
    );
  });

  it('still records payments on ordinary expenses', async () => {
    let recorded: any;
    const repo: any = {
      findById: async () => ({
        id: 'exp-1', companyId: 'co-1', branchId: 'branch-1', status: 'CONFIRMED',
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
    const useCase = new RecordExpensePaymentUseCase(repo, noopAudit);
    const result = await useCase.execute(ctx(), 'exp-1', { paidAmount: '289.00', paymentMethod: 'CASH' });
    assert.equal(recorded.amount, '289.00');
    assert.equal(recorded.paidAt, undefined, 'legacy default date is assigned only on first repository write');
    assert.match(recorded.idempotencyKey, /^request:[a-f0-9]{64}$/);
    assert.equal(result.paymentStatus, 'PAID');
  });

  function ordinary(branchId: string | null = 'branch-1') {
    const calls: any[] = [];
    const repo: any = {
      findById: async () => ({ id: 'exp-1', companyId: 'co-1', branchId, status: 'CONFIRMED', currency: 'THB' }),
      recordPaymentAtomic: async (input: any) => { calls.push(input); return { expense: { id: 'exp-1' } }; },
    };
    return { calls, useCase: new RecordExpensePaymentUseCase(repo, noopAudit) };
  }

  it('keeps explicit keys and civil dates stable across request IDs, and forwards branch scope', async () => {
    const { calls, useCase } = ordinary('branch-1');
    const input = { paidAmount: '1.00', paidAt: '2026-07-31', idempotencyKey: 'payment-intent-1' };
    await useCase.execute({ ...ctx(), scopes: { branchIds: ['branch-1'] } }, 'exp-1', input);
    await useCase.execute({ ...ctx(), requestId: 'different-transport-id' }, 'exp-1', input);
    assert.equal(calls[0].idempotencyKey, 'client:payment-intent-1');
    assert.equal(calls[1].idempotencyKey, calls[0].idempotencyKey);
    assert.equal(calls[0].paidAt, '2026-07-31');
    assert.deepEqual(calls[0].scopes, { branchIds: ['branch-1'] });
  });

  it('refuses payment on a legacy expense whose source branch is unknown', async () => {
    const { calls, useCase } = ordinary(null);
    await assert.rejects(() => useCase.execute(ctx(), 'exp-1', { paidAmount: '1' }), /เลือกสาขา/);
    assert.equal(calls.length, 0);
  });

  it('hashes the whole legacy request ID, so shared prefixes never collapse different payments', async () => {
    const { calls, useCase } = ordinary();
    const prefix = 'x'.repeat(512);
    for (const requestId of [`${prefix}-1`, `${prefix}-1`, `${prefix}-2`]) {
      await useCase.execute({ ...ctx(), requestId }, 'exp-1', { paidAmount: '1' });
    }
    assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
    assert.notEqual(calls[0].idempotencyKey, calls[2].idempotencyKey);
    assert.equal(calls[0].idempotencyKey.length, 72);
  });

  it('refuses malformed supplied keys even for direct non-HTTP callers', async () => {
    const { calls, useCase } = ordinary();
    for (const idempotencyKey of [null, '', 'short', 'a'.repeat(65), 12345678, {}]) {
      await assert.rejects(() => useCase.execute(ctx(), 'exp-1', { paidAmount: '1', idempotencyKey } as any), BadRequestException);
    }
    assert.equal(calls.length, 0);
  });

  it('checks permission and current branch before entering any replay path', async () => {
    const { calls, useCase } = ordinary('branch-1');
    await assert.rejects(() => useCase.execute({ ...ctx(), permissions: [] }, 'exp-1', { paidAmount: '1' }), ForbiddenException);
    await assert.rejects(() => useCase.execute({ ...ctx(), scopes: { branchIds: ['other'] } }, 'exp-1', { paidAmount: '1' }), ForbiddenException);
    assert.equal(calls.length, 0);
  });

  it('passes the same transaction to audit and outbox, with the original payment as source identity', async () => {
    const tx = { outboxEvent: { create: async ({ data }: any) => { events.push(data); } } };
    const events: any[] = [];
    const audits: any[] = [];
    const repo: any = {
      findById: async () => ({ branchId: 'branch-1' }),
      recordPaymentAtomic: async (_input: any, hook: any) => {
        const result = { payment: { id: 'pay-original', amount: '40.0000' }, expense: { id: 'exp-1', paidAmount: '40.0000', paymentStatus: 'PARTIALLY_PAID' }, replayed: false };
        await hook(tx, result);
        return result;
      },
    };
    const useCase = new RecordExpensePaymentUseCase(repo, { log: async (entry: any, auditTx: any) => { assert.equal(auditTx, tx); audits.push(entry); } } as any);
    await useCase.execute(ctx(), 'exp-1', { paidAmount: '40', idempotencyKey: 'intent-atomic' });
    assert.equal(audits[0].targetId, 'pay-original');
    assert.equal(events[0].aggregateId, 'pay-original');
    assert.equal(events[0].eventKey, 'expense.payment_recorded:expense_payment:pay-original');
    assert.equal(events[0].payloadJson.data.paidAmount, '40.0000');
  });
});

// This file is in the API test script; direct callers have the same permission/reason boundary as HTTP.
describe('expense correction authorization and audit', () => {
  it('requires permission, web authority, branch scope and a meaningful bounded reason', async () => {
    const production = await import('./expense-draft.use-case');
    for (const [name, permission, method] of [
      ['ReopenExpenseUseCase', 'expense.confirm', 'reopenExpenseAtomic'],
      ['CancelExpensePaymentUseCase', 'expense.payment.record', 'cancelPaymentAtomic'],
    ]) {
      const UseCase = (production as any)[name]; assert.equal(typeof UseCase, 'function');
      const calls: any[] = [];
      const repo = { findById: async () => ({ branchId: 'branch-1' }), [method]: async (input: any, hook: any) => { calls.push(input); await hook({}); return { status: 'NEEDS_REVIEW' }; } };
      const audits: any[] = [];
      const useCase = new UseCase(repo, { log: async (entry: any, tx: any) => { assert.ok(tx); audits.push(entry); } });
      const run = (context: any, reason: any) => name === 'ReopenExpenseUseCase' ? useCase.execute(context, 'exp-1', reason) : useCase.execute(context, 'exp-1', 'pay-1', reason);
      const authorized = { ...ctx(), permissions: [permission] };
      await assert.rejects(() => run({ ...authorized, permissions: [] }, 'กรอกผิด'), ForbiddenException);
      await assert.rejects(() => run({ ...authorized, authProvider: 'line' }, 'กรอกผิด'), ForbiddenException);
      await assert.rejects(() => run({ ...authorized, scopes: { branchIds: ['other'] } }, 'กรอกผิด'), ForbiddenException);
      for (const reason of ['', '  ', 'ab', 'a'.repeat(501), null]) await assert.rejects(() => run(authorized, reason), BadRequestException);
      await run(authorized, '  กรอกผิด  ');
      assert.equal(calls.length, 1); assert.equal(calls[0].reason, 'กรอกผิด');
      assert.equal(audits[0].actorUserId, authorized.userId); assert.equal(audits[0].metadataJson.reason, 'กรอกผิด');
      assert.equal(JSON.stringify(audits).includes('bankAccountRef'), false);
    }
  });
});


test('correction audit reasons mask long account-number text as well as excluding bank fields', async () => {
  const { ReopenExpenseUseCase } = await import('./expense-draft.use-case');
  let logged: any;
  const repo: any = { findById: async () => ({ branchId: 'branch-1' }), reopenExpenseAtomic: async (_input: any, hook: any) => { await hook({}); return {}; } };
  await new ReopenExpenseUseCase(repo, { log: async (entry: any) => { logged = entry; } } as any).execute({ ...ctx(), permissions: ['expense.confirm'] }, 'exp-1', 'แก้ยอดบัญชี 012-3-45678-9');
  assert.equal(JSON.stringify(logged).includes('012-3-45678-9'), false);
  assert.match(logged.metadataJson.reason, /6789/);
});
