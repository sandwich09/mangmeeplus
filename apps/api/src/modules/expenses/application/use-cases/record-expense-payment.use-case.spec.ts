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
  it('refuses a cancelled payment replay with its remedy and returns an active replay as before (E5)', async () => {
    let status = 'VOIDED';
    const saved = { id: 'exp-1', paidAmount: '0.0000' };
    const repo: any = { findById: async () => ({ branchId: 'branch-1' }), recordPaymentAtomic: async () => ({ expense: saved, payment: { id: 'pay-1', status }, replayed: true }) };
    const useCase = new RecordExpensePaymentUseCase(repo, { log: async () => assert.fail('replay has no audit') } as any);
    await assert.rejects(() => useCase.execute(ctx(), 'exp-1', { paidAmount: '1' }), (e: any) => e.getResponse?.().code === 'expense_payment_cancelled_replay' && e.getResponse().message === 'การจ่ายรายการนี้ถูกยกเลิกไปแล้ว ระบบจึงไม่ได้บันทึกซ้ำ ถ้าต้องการจ่ายอีกครั้ง ให้เปิดหน้านี้ใหม่แล้วบันทึกการจ่ายใหม่');
    status = 'RECORDED';
    assert.equal(await useCase.execute(ctx(), 'exp-1', { paidAmount: '1' }), saved);
  });
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

  it('rejects future expense paid dates using Bangkok today, allowing yesterday/today across the UTC boundary', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T16:30:00Z').getTime() });
    const { calls, useCase } = ordinary();
    for (const paidAt of ['2026-10-03', '2026-10-04']) await useCase.execute(ctx(), 'exp-1', { paidAmount: '1', paidAt });
    await assert.rejects(() => useCase.execute(ctx(), 'exp-1', { paidAmount: '1', paidAt: '2026-10-05' }),
      (e: any) => e.getResponse?.().code === 'expense_payment_future_date' && e.getResponse().message === 'วันที่จ่ายเงินจริงต้องไม่เกินวันนี้');
    assert.equal(calls.length, 2);
    t.mock.timers.setTime(new Date('2026-10-04T17:30:00Z').getTime());
    await useCase.execute(ctx(), 'exp-1', { paidAmount: '1', paidAt: '2026-10-05' });
    await assert.rejects(() => useCase.execute(ctx(), 'exp-1', { paidAmount: '1', paidAt: '2026-10-06' }), (e: any) => e.getResponse?.().code === 'expense_payment_future_date');
    assert.equal(calls.length, 3);
  });

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
  for (const condition of ['permission', 'web', 'branch', 'missing']) it(`returns coded Thai for reopen ${condition} refusal`, async () => {
    const { ReopenExpenseUseCase } = await import('./expense-draft.use-case');
    const repo = { findById: async () => condition === 'missing' ? null : ({ branchId: 'b1' }) } as any;
    const actor = { ...ctx(), permissions: ['expense.confirm'], ...(condition === 'permission' && { permissions: [] }),
      ...(condition === 'web' && { authProvider: 'line' }), ...(condition === 'branch' && { scopes: { branchIds: ['other'] } }) };
    await assert.rejects(new ReopenExpenseUseCase(repo, noopAudit).execute(actor, 'exp-1', 'ข้อมูลผิด'), (error: any) => {
      const response = error.getResponse(); assert.ok(response.code); assert.match(response.message, /[ก-๙]/u);
      assert.doesNotMatch(response.message, /[A-Za-z]/u); return true;
    });
  });
  it('requires permission, web authority, branch scope and a meaningful bounded reason', async () => {
    const production = await import('./expense-draft.use-case');
    for (const [name, permission, method] of [
      ['ReopenExpenseUseCase', 'expense.confirm', 'reopenExpenseAtomic'],
      ['CancelExpensePaymentUseCase', 'expense.payment.record', 'cancelPaymentAtomic'],
    ]) {
      const UseCase = (production as any)[name]; assert.equal(typeof UseCase, 'function');
      const calls: any[] = [];
      const repo = { findById: async () => ({ branchId: 'branch-1' }), [method]: async (input: any, hook: any) => { calls.push(input); await hook({}); return name === 'ReopenExpenseUseCase' ? { expense: { status: 'NEEDS_REVIEW' }, cancelledCertificate: null } : { status: 'NEEDS_REVIEW' }; } };
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
  const repo: any = { findById: async () => ({ branchId: 'branch-1' }), reopenExpenseAtomic: async (_input: any, hook: any) => { await hook({}); return { expense: {}, cancelledCertificate: null }; } };
  await new ReopenExpenseUseCase(repo, { log: async (entry: any) => { logged = entry; } } as any).execute({ ...ctx(), permissions: ['expense.confirm'] }, 'exp-1', 'แก้ยอดบัญชี 012-3-45678-9');
  assert.equal(JSON.stringify(logged).includes('012-3-45678-9'), false);
  assert.match(logged.metadataJson.reason, /6789/);
});

test('detail correction history keeps persisted cancellation reasons and marks only open documents', async () => {
  const { GetExpenseUseCase } = await import('./expense-draft.use-case');
  const repo = { paymentDisbursements: async () => new Map(), findCorrectionHistory: async () => ({ reopenedAt: new Date('2026-10-04T02:00:00Z'), cancellationReasons: new Map([['p1', 'ยอดผิด']]) }) } as any;
  const useCase = new GetExpenseUseCase(repo);
  for (const status of ['NEEDS_REVIEW', 'READY_FOR_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'VOIDED']) {
    const history = (useCase as any).correctionHistory; assert.equal(typeof history, 'function');
    const result = await history.call(useCase, ctx(), { id: 'e1', status, payments: [{ id: 'p1', status: 'VOIDED' }] });
    assert.equal(Boolean(result.correctionOpenedAt), ['NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(status));
    assert.equal(result.payments[0].cancellationReason, 'ยอดผิด');
  }
});


test('reopen passes the actor permissions and explicit attestation into the locked mutation', async () => {
  const { ReopenExpenseUseCase } = await import('./expense-draft.use-case');
  let input: any;
  const repo: any = { findById: async () => ({ branchId: 'branch-1' }), reopenExpenseAtomic: async (value: any) => { input = value; return { expense: {}, cancelledCertificate: null }; } };
  const context = { ...ctx(), permissions: ['expense.confirm', 'wht.certificate.correct'] };
  await new ReopenExpenseUseCase(repo, {} as any).execute(context, 'exp-1', 'ข้อมูลผิด', true);
  assert.deepEqual(input.permissions, context.permissions); assert.equal(input.taxFilingAttested, true);
});

describe('reopen certificate cancellation notices (A5)', () => {
  for (const failure of ['actor lookup', 'notifier']) it(`returns the committed reopened expense when ${failure} fails`, async () => {
    const { ReopenExpenseUseCase } = await import('./expense-draft.use-case');
    const expense = { id: 'exp-1', status: 'NEEDS_REVIEW' };
    const repo: any = {
      findById: async () => ({ branchId: 'branch-1' }),
      findMemberDisplayName: async () => { if (failure === 'actor lookup') throw new Error('lookup unavailable'); return 'สมใจ'; },
      reopenExpenseAtomic: async () => ({ expense,
        cancelledCertificate: { issuerUserId: 'issuer-1', certificateNumber: 'WT-1', isExternal: false, certificateRound: 1 } }),
    };
    const notify = { execute: async () => { throw new Error('notice unavailable'); } };
    const useCase = new ReopenExpenseUseCase(repo, noopAudit as any, notify as any);
    assert.deepEqual(await useCase.execute({ ...ctx(), permissions: ['expense.confirm'] }, 'exp-1', 'ข้อมูลผิด', true), { ...expense, cancelledCertificate: { kind: 'SYSTEM', number: 'WT-1' } });
  });
  async function run(isExternal: boolean, issuerUserId = 'issuer-1', rounds = [1], fail = false, number: string | null = 'WT-1') {
    const { ReopenExpenseUseCase } = await import('./expense-draft.use-case');
    const notices: any[] = [];
    let committed = false;
    const repo: any = {
      findById: async () => ({ branchId: 'branch-1', certificateOnExpense: { number: 'WT-OLD' } }),
      findMemberDisplayName: async () => 'สมใจ',
      reopenExpenseAtomic: async (_input: any, audit: any) => {
        committed = false;
        await audit({});
        if (fail) throw new Error('rollback');
        committed = true;
        return { expense: { id: 'exp-1', status: 'NEEDS_REVIEW' }, cancelledCertificate: {
          issuerUserId, certificateNumber: number, isExternal, certificateRound: rounds.shift(),
        } };
      },
    };
    const notify = { execute: async (input: any) => { assert.equal(committed, true); notices.push(input); } };
    const useCase = new (ReopenExpenseUseCase as any)(repo, noopAudit, notify);
    const execute = () => useCase.execute({ ...ctx(), permissions: ['expense.confirm'] }, 'exp-1', 'ข้อมูลผิด', true);
    return { notices, execute };
  }
  for (const isExternal of [false, true]) {
    it(`notifies only the original ${isExternal ? 'external recorder' : 'system issuer'} after reopen commits and returns the actual number despite a stale page`, async () => {
      const h = await run(isExternal);
      assert.deepEqual(await h.execute(), { id: 'exp-1', status: 'NEEDS_REVIEW', cancelledCertificate: { kind: isExternal ? 'EXTERNAL' : 'SYSTEM', number: 'WT-1' } });
      assert.deepEqual(h.notices, [{ companyId: 'co-1', triggerKey: 'expense.wht_certificate_cancelled',
        sourceModule: 'expenses', sourceType: 'expense_record', sourceId: 'exp-1', periodKey: '1', severity: 'info',
        title: isExternal ? 'ยกเลิกการบันทึกแล้ว: หนังสือรับรองที่ออกเอง เลขที่ WT-1' : 'ยกเลิกแล้ว: หนังสือรับรอง 50 ทวิ เลขที่ WT-1',
        body: isExternal
          ? 'สมใจ แก้ไขเอกสารรายจ่ายนี้ ระบบจึงยกเลิกการบันทึกนี้ กรุณายกเลิกหนังสือรับรองที่ออกเองด้วย เหตุผล: ข้อมูลผิด เมื่อเอกสารถูกยืนยันอีกครั้ง ให้ออกหนังสือรับรองใบใหม่'
          : 'สมใจ แก้ไขเอกสารรายจ่ายนี้ ระบบจึงยกเลิกหนังสือรับรองใบเดิม เหตุผล: ข้อมูลผิด เมื่อเอกสารถูกยืนยันอีกครั้ง ให้ออกหนังสือรับรองใบใหม่',
        deepLinkHref: '/companies/co-1/expenses/exp-1#wht-certificate', recipientUserIds: ['issuer-1'] }]);
    });
    it(`does not notify a ${isExternal ? 'recorder' : 'issuer'} who reopened their own certificate`, async () => {
      const h = await run(isExternal, ctx().userId); await h.execute(); assert.deepEqual(h.notices, []);
    });
  }
  it('uses a different periodKey for each cancellation round', async () => {
    const h = await run(false, 'issuer-1', [1, 2]); await h.execute(); await h.execute();
    assert.deepEqual(h.notices.map(row => row.periodKey), ['1', '2']);
  });
  it('does not send a notice when the cancellation rolls back', async () => {
    const h = await run(false, 'issuer-1', [1], true); await assert.rejects(h.execute(), /rollback/); assert.deepEqual(h.notices, []);
  });
  for (const isExternal of [false, true]) it(`omits the number wording when a ${isExternal ? 'recorded paper' : 'system certificate'} has no number`, async () => {
    const h = await run(isExternal, 'issuer-1', [1], false, null); await h.execute();
    assert.equal(h.notices[0].title, isExternal ? 'ยกเลิกการบันทึกแล้ว: หนังสือรับรองที่ออกเอง' : 'ยกเลิกแล้ว: หนังสือรับรอง 50 ทวิ');
    assert.equal(h.notices[0].deepLinkHref, '/companies/co-1/expenses/exp-1#wht-certificate');
  });
});
