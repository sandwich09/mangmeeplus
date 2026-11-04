import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RecordExpensePaymentUseCase } from './expense-draft.use-case';

const noopAudit = { log: async () => undefined } as any;

describe('R3 e-WHT paid payment preview', () => {
  it('refuses cash and card and accepts every permitted bank method before a LINE card', async () => {
    const row: any = { id: 'exp-1', branchId: 'branch-1', status: 'CONFIRMED', netPayableAmount: '100', paidAmount: '0', whtRemittance: 'E_WHT' };
    const uc = new RecordExpensePaymentUseCase({ findById: async () => row } as any, noopAudit);
    for (const paymentMethod of ['CASH', 'CARD'] as const) await assert.rejects(() => uc.previewLineAction(ctx(), row.id, { paidAmount: '10', paymentMethod }),
      (e: any) => e.getStatus() === 409 && e.getResponse().code === 'expense_ewht_payment_method');
    for (const paymentMethod of ['BANK_TRANSFER', 'CHEQUE', 'OTHER', undefined] as const) assert.equal(await uc.previewLineAction(ctx(), row.id, { paidAmount: '10', paymentMethod }), row);
    row.whtRemittance = 'PAYER_FILES';
    assert.equal(await uc.previewLineAction(ctx(), row.id, { paidAmount: '10', paymentMethod: 'CASH' }), row);
  });
});

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
        title: isExternal ? 'ยกเลิกการบันทึกแล้ว: ใบ 50 ทวิ ที่ทำนอกระบบ เลขที่ WT-1' : 'ยกเลิกแล้ว: หนังสือรับรอง 50 ทวิ เลขที่ WT-1',
        body: isExternal
          ? 'สมใจ แก้ไขเอกสารรายจ่ายนี้ ระบบจึงยกเลิกการบันทึกนี้ กรุณายกเลิกใบ 50 ทวิ ที่ทำนอกระบบด้วย เหตุผล: ข้อมูลผิด ถ้าเอกสารถูกยืนยันอีกครั้งและยังต้องมีหนังสือรับรอง ระบบจะขึ้นให้ออกใบใหม่'
          : 'สมใจ แก้ไขเอกสารรายจ่ายนี้ ระบบจึงยกเลิกหนังสือรับรองใบเดิม เหตุผล: ข้อมูลผิด ถ้าเอกสารถูกยืนยันอีกครั้งและยังต้องมีหนังสือรับรอง ระบบจะขึ้นให้ออกใบใหม่',
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
    assert.equal(h.notices[0].title, isExternal ? 'ยกเลิกการบันทึกแล้ว: ใบ 50 ทวิ ที่ทำนอกระบบ' : 'ยกเลิกแล้ว: หนังสือรับรอง 50 ทวิ');
    assert.equal(h.notices[0].deepLinkHref, '/companies/co-1/expenses/exp-1#wht-certificate');
  });
});

import { ExpensePaymentSlipUploadUseCase } from './expense-upload.use-case';
describe('expense payment slip upload authority', () => {
  const file = { originalFileName: 'slip.png', mimeType: 'image/png', byteSize: 100 };
  function uploader() {
    const calls: any[] = [];
    const service = new ExpensePaymentSlipUploadUseCase({ findById: async () => ({ branchId: 'branch-1' }) } as any,
      { client: { attachmentObject: { findFirst: async ({ where }: any) => {
        assert.equal(where.companyId, 'co-1'); assert.equal(where.uploadedByUserId, 'finance-1'); assert.equal(where.branchId, 'branch-1');
        assert.deepEqual(where.AND[1], { metadataJson: { path: ['expenseId'], equals: 'exp-1' } });
        return where.id === 'owned' ? { id: 'owned' } : null;
      } } } } as any,
      { execute: async (context: any, input: any) => { calls.push({ context, input }); return { attachmentId: 'owned' }; } } as any,
      { execute: async (context: any, input: any) => { calls.push({ context, input }); } } as any);
    return { service, calls };
  }
  it('the payer may upload and complete without a receipt-upload permission', async () => {
    const h = uploader(); await h.service.init(ctx(), 'exp-1', file);
    assert.deepEqual(h.calls[0].input.metadataJson, { generatedFor: 'expense.payment.slip', expenseId: 'exp-1' });
    assert.equal(h.calls[0].input.branchId, 'branch-1');
    assert.ok(h.calls[0].context.permissions.includes('attachment.create'));
    await h.service.complete(ctx(), 'exp-1', 'owned', { byteSize: 100 }); assert.equal(h.calls.length, 2);
  });
  it('refuses another file, a non-payer, an inaccessible branch and files outside the claim limits', async () => {
    const h = uploader();
    await assert.rejects(h.service.complete(ctx(), 'exp-1', 'foreign', {}), /payment_slip_invalid/);
    await assert.rejects(h.service.init({ ...ctx(), permissions: ['expense.receipt.upload'] }, 'exp-1', file), ForbiddenException);
    await assert.rejects(h.service.init({ ...ctx(), scopes: { branchIds: ['elsewhere'] } }, 'exp-1', file), ForbiddenException);
    for (const patch of [{ byteSize: 0 }, { byteSize: 10 * 1024 * 1024 + 1 }, { mimeType: 'text/plain' }]) {
      await assert.rejects(h.service.init(ctx(), 'exp-1', { ...file, ...patch }), /payment_slip_invalid/);
    }
    assert.equal(h.calls.length, 0);
  });
});

test('W4 only a payment recorder in branch scope confirms a real date, with an audit', async () => {
  const writes: any[] = [], audits: any[] = [];
  const repo: any = { findById: async () => ({ branchId: 'branch-1' }), confirmPaymentDateAtomic: async (input: any, audit: any) => { writes.push(input); await audit({}); return {}; } };
  const useCase = new RecordExpensePaymentUseCase(repo, { log: async (entry: any) => audits.push(entry) } as any);
  await assert.rejects(() => useCase.confirmDate({ ...ctx(), permissions: [] }, 'exp-1', 'p1', '2026-10-01'), ForbiddenException);
  await assert.rejects(() => useCase.confirmDate({ ...ctx(), scopes: { branchIds: ['other'] } }, 'exp-1', 'p1', '2026-10-01'), ForbiddenException);
  await assert.rejects(() => useCase.confirmDate(ctx(), 'exp-1', 'p1', '2026-02-31'), BadRequestException);
  await useCase.confirmDate(ctx(), 'exp-1', 'p1', '2026-10-01');
  assert.equal(writes.length, 1); assert.equal(writes[0].paidAt, '2026-10-01');
  assert.equal(audits[0].action, 'expense.payment_date_confirmed');
});

import { LinkAttachmentUseCase } from '../../../data-model-core/application/use-cases/link-attachment.use-case';

describe('Round 3 LINE expense payment evidence transaction', () => {
  it('links the existing active upload through LinkAttachmentUseCase using the same transaction and user context; rolls back a refused link', async () => {
    let allowed = true, committed = 0; const links: any[] = [], audits: any[] = [];
    const actor = { ...ctx(), authProvider: 'line', permissions: ['expense.payment.record', 'attachment.create'], scopes: { branchIds: ['branch-1'] } };
    const tx: any = { attachmentLink: { findFirst: async () => null }, outboxEvent: { create: async () => {} } };
    const attachments: any = { findById: async (_input: any, transaction: any) => { assert.equal(transaction, tx); return { status: allowed ? 'ACTIVE' : 'DELETED' }; },
      linkToTarget: async (input: any, transaction: any) => { assert.equal(transaction, tx); links.push(input); return { id: 'link-1' }; } };
    const audit: any = { log: async (entry: any) => audits.push(entry) };
    const link = new LinkAttachmentUseCase(attachments, audit);
    const repo: any = { findById: async () => ({ branchId: 'branch-1', updatedAt: new Date(0) }),
      recordPaymentAtomic: async (input: any, effects: any) => {
        assert.equal(input.expectedUpdatedAt.getTime(), 0); assert.equal(input.actorUserId, actor.userId); assert.deepEqual(input.scopes, actor.scopes);
        const result = { expense: { id: 'exp-1', paidAmount: '10.00', paymentStatus: 'PAID' }, payment: { id: 'pay-1', amount: '10.00' } };
        await effects(tx, result); committed += 1; return result;
      } };
    const useCase = new RecordExpensePaymentUseCase(repo, audit, link);
    const input = { paidAmount: '10.00', paidAt: '2026-10-14', idempotencyKey: 'line-card-1' };
    await useCase.execute(actor, 'exp-1', input, { expectedUpdatedAt: new Date(0), evidenceAttachmentId: 'chat-slip', beforeEvidence: async transaction => assert.equal(transaction, tx) });
    assert.equal(committed, 1); assert.equal(links.length, 1); assert.equal(links[0].purpose, 'expense.payment.evidence'); assert.equal(links[0].linkedByUserId, actor.userId);
    allowed = false;
    await assert.rejects(() => useCase.execute(actor, 'exp-1', input, { expectedUpdatedAt: new Date(0), evidenceAttachmentId: 'chat-slip' }), /ACTIVE/);
    assert.equal(committed, 1); assert.equal(links.length, 1);
  });
  it('preview uses the same input/outstanding validators and preserves branch/source/status/permission guards', async () => {
    const row: any = { id: 'exp-1', branchId: 'branch-1', status: 'CONFIRMED', netPayableAmount: '100.00', paidAmount: '25.00' };
    const uc = new RecordExpensePaymentUseCase({ findById: async () => row } as any, noopAudit);
    assert.equal(await uc.previewLineAction(ctx(), row.id, { paidAmount: '75.00' }), row);
    for (const input of [{ paidAmount: '76.00' }, { paidAmount: '0' }, { paidAmount: 'oops' }, { paidAmount: '1', paymentMethod: 'invalid' }, { paidAmount: '1', paidAt: '2026-02-30' }]) await assert.rejects(() => uc.previewLineAction(ctx(), row.id, input as any), BadRequestException);
    await assert.rejects(() => uc.previewLineAction({ ...ctx(), permissions: [] }, row.id, { paidAmount: '1' }), ForbiddenException);
    await assert.rejects(() => uc.previewLineAction({ ...ctx(), scopes: { branchIds: ['other'] } }, row.id, { paidAmount: '1' }), ForbiddenException);
    row.status = 'DRAFT'; await assert.rejects(() => uc.previewLineAction(ctx(), row.id, { paidAmount: '1' }), BadRequestException);
    row.status = 'CONFIRMED'; row.sourceReimbursementRequestId = 'claim-1'; await assert.rejects(() => uc.previewLineAction(ctx(), row.id, { paidAmount: '1' }), /reimbursement/i);
  });
});

// The voucher service is the same web/domain entry point the LINE preview delegates to.
describe('R3 e-WHT voucher guards (paid path)', () => {
  async function voucherHarness(method: 'CASH' | 'CARD') {
    const { DisbursementVoucherUseCase } = await import('./disbursement-voucher.use-case');
    const { disbursementVoucherSourceHash } = await import('../../domain/logic/disbursement-voucher.logic');
    const source: any = { id: 'exp-1', status: 'CONFIRMED', branchId: 'branch-1', currency: 'THB', whtRemittance: 'E_WHT',
      netPayableAmount: '100', outstandingAmount: '100', vendorNameSnapshot: 'ผู้รับเงิน', vendorTaxIdSnapshot: null, recordPaymentBlocker: null };
    const voucher: any = { id: 'voucher-1', companyId: 'co-1', status: 'DRAFT', version: 0, revision: 0, preparedByUserId: 'finance-1',
      plannedMethod: method, payeeName: 'ผู้รับเงิน', payeeBasis: 'SINGLE', lines: [{ expenseId: source.id, amount: '10', expense: source }],
      documentNumber: null, totalAmount: '10', createdAt: new Date(0), updatedAt: new Date(0) };
    const tx: any = { disbursementVoucher: { findFirst: async () => voucher } };
    const repo: any = { readTransaction: async (work: any) => work(tx), findVisible: async () => voucher,
      saveDraftAtomic: async (_input: any, work: any) => work(tx), lifecycleAtomic: async (_input: any, work: any) => work(tx, voucher),
      canOwnerRecover: async () => false, lockSources: async () => undefined };
    const expenseRepo: any = { readDisbursementExpenseSources: async () => [source] };
    const list: any = { readScope: () => ({ filter: {}, scope: {} }) };
    const uc = new DisbursementVoucherUseCase(repo, expenseRepo, list, noopAudit);
    const actor = { ...ctx(), permissions: ['expense.disbursement.prepare', 'expense.disbursement.pay'] };
    return { uc, source, voucher, actor, forPay() {
      voucher.status = 'APPROVED'; voucher.documentNumber = 'PV-1'; source.reservedByDisbursementVoucherId = voucher.id;
      voucher.lines[0].sourceHashAtSubmit = disbursementVoucherSourceHash(source);
    } };
  }
  it('refuses planned cash/card on create, update, submit and submit preview', async () => {
    for (const method of ['CASH', 'CARD'] as const) {
      const h = await voucherHarness(method);
      const body = { commandId: 'command-1', lines: [{ expenseId: 'exp-1', amount: '10' }], plannedMethod: method };
      const denied = (e: any) => e.getStatus() === 409 && e.getResponse().code === 'disbursement_ewht_planned_method';
      await assert.rejects(() => h.uc.create(h.actor, body), denied);
      await assert.rejects(() => h.uc.update(h.actor, h.voucher.id, { ...body, expectedVersion: 0 }), denied);
      await assert.rejects(() => h.uc.submit(h.actor, h.voucher.id, { commandId: 'submit-1', expectedVersion: 0 }), denied);
      await assert.rejects(() => h.uc.previewLineAction(h.actor, 'submit', { id: h.voucher.id }), denied);
    }
  });
  it('checks the fallback planned method in pay preview and accepts an explicit bank override', async () => {
    const h = await voucherHarness('CASH'); h.forPay();
    await assert.rejects(() => h.uc.previewLineAction(h.actor, 'pay', { id: h.voucher.id, payment: { commandId: 'pay-1', expectedVersion: 0 } }),
      (e: any) => e.getStatus() === 409 && e.getResponse().code === 'expense_ewht_payment_method');
    const result = await h.uc.previewLineAction(h.actor, 'pay', { id: h.voucher.id, payment: { commandId: 'pay-1', expectedVersion: 0, paymentMethod: 'BANK_TRANSFER' } });
    assert.ok('status' in result);
    assert.equal(result.status, 'APPROVED');
  });
});
