import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { VoidExpenseUseCase } from './expense-draft.use-case';

// H-04 (expenses) closure evidence: void orchestration reserves the reversal
// entry number only when a posted journal exists, commits it only when a
// reversal was created, and releases it on failure or when it was unnecessary.

const ctx: any = {
  companyId: 'co_1', userId: 'u1', requestId: 'req_1',
  permissions: ['expense.void'], scopes: {},
};

function stubs() {
  return {
    audit: { log: mock.fn(async () => undefined) },
    outbox: { append: mock.fn(async () => undefined) },
    reserveNumber: { execute: mock.fn(async () => ({ id: 'num_1', documentNumber: 'JV-REV-1' })) },
    commitNumber: { execute: mock.fn(async () => undefined) },
    cancelNumber: { execute: mock.fn(async () => undefined) },
  };
}

describe('VoidExpenseUseCase (H-04)', () => {
  let s: ReturnType<typeof stubs>;
  let repo: any;

  beforeEach(() => {
    s = stubs();
    repo = {
      findById: mock.fn(async () => ({ id: 'exp_1', status: 'CONFIRMED', branchId: null, grandTotalAmount: '107.00' })),
      // GAP-07: the accrual leg is posted, the settlement leg is not (unpaid expense).
      findPostedGeneratedJournalId: mock.fn(async (_c: string, _id: string, sourceType: string = 'expense.record') => (sourceType === 'expense.record' ? 'je_orig' : null)),
      findPostedExpensePaymentJournals: mock.fn(async () => []),
      voidExpenseTrueReversal: mock.fn(async () => ({
        expense: { id: 'exp_1', status: 'VOIDED' },
        reversalEntryId: 'je_rev',
        paymentReversalEntryId: null,
        paymentReversalEntryIds: [],
      })),
    };
  });

  const make = () => new VoidExpenseUseCase(repo, s.audit as any, s.outbox as any, s.reserveNumber as any, s.commitNumber as any, s.cancelNumber as any);

  it('uses the existing reversal pipeline for a paid source before expense confirmation, with void permission still required', async () => {
    repo.findById = mock.fn(async () => ({ id: 'exp_1', status: 'NEEDS_REVIEW', paidAmount: '100', branchId: null, grandTotalAmount: '100' }));
    const result = await make().execute(ctx, 'exp_1', 'วันที่จ่ายไม่ถูกต้อง');
    assert.equal(result.status, 'VOIDED');
    assert.equal(repo.voidExpenseTrueReversal.mock.callCount(), 1);
    await assert.rejects(make().execute({ ...ctx, permissions: [] }, 'exp_1', 'ไม่มีสิทธิ์'), /expense.void/);
    assert.equal(repo.voidExpenseTrueReversal.mock.callCount(), 1);
  });

  it('reserves and commits the reversal number when the expense was posted', async () => {
    const result = await make().execute(ctx, 'exp_1', 'บันทึกผิด');
    assert.equal(result.status, 'VOIDED');
    assert.equal(s.reserveNumber.execute.mock.callCount(), 1);
    assert.equal(repo.voidExpenseTrueReversal.mock.calls[0].arguments[4], 'JV-REV-1');
    assert.equal(s.commitNumber.execute.mock.callCount(), 1);
    assert.equal((s.commitNumber.execute.mock.calls[0] as any).arguments[0].ownerId, 'je_rev');
    assert.equal(s.cancelNumber.execute.mock.callCount(), 0);
    const outboxPayload = (s.outbox.append.mock.calls[0] as any).arguments[3];
    assert.equal(outboxPayload.data.reversalEntryId, 'je_rev');
  });

  it('releases the reserved number and rethrows when the void transaction fails', async () => {
    repo.voidExpenseTrueReversal = mock.fn(async () => { throw new UnprocessableEntityException('boom'); });
    await assert.rejects(() => make().execute(ctx, 'exp_1', 'บันทึกผิด'), UnprocessableEntityException);
    assert.equal(s.cancelNumber.execute.mock.callCount(), 1);
    assert.equal(s.commitNumber.execute.mock.callCount(), 0);
    assert.equal(s.outbox.append.mock.callCount(), 0);
  });

  it('releases the reserved number when the journal was already reversed elsewhere', async () => {
    repo.voidExpenseTrueReversal = mock.fn(async () => ({ expense: { id: 'exp_1', status: 'VOIDED' }, reversalEntryId: null, paymentReversalEntryIds: [] }));
    await make().execute(ctx, 'exp_1', 'บันทึกผิด');
    assert.equal(s.cancelNumber.execute.mock.callCount(), 1);
    assert.equal(s.commitNumber.execute.mock.callCount(), 0);
  });

  it('skips number reservation entirely for unposted expenses', async () => {
    repo.findPostedGeneratedJournalId = mock.fn(async () => null);
    repo.voidExpenseTrueReversal = mock.fn(async () => ({ expense: { id: 'exp_1', status: 'VOIDED' }, reversalEntryId: null, paymentReversalEntryIds: [] }));
    await make().execute(ctx, 'exp_1', 'บันทึกผิด');
    assert.equal(s.reserveNumber.execute.mock.callCount(), 0);
    assert.equal(repo.voidExpenseTrueReversal.mock.calls[0].arguments[4], undefined);
  });

  it('reserves and commits two reversal numbers when both accrual and settlement legs were posted', async () => {
    // GAP-07: a paid expense has BOTH an accrual (expense.record) and a settlement
    // (expense.payment) posted journal; the void reverses and commits each.
    repo.findPostedExpensePaymentJournals = mock.fn(async () => [{ paymentId: 'payment-1', journalId: 'je_pay' }]);
    repo.voidExpenseTrueReversal = mock.fn(async () => ({
      expense: { id: 'exp_1', status: 'VOIDED' }, reversalEntryId: 'je_rev', paymentReversalEntryId: 'je_pay_rev',
      paymentReversalEntryIds: [{ paymentId: 'payment-1', reversalEntryId: 'je_pay_rev' }],
    }));
    let seq = 0;
    s.reserveNumber.execute = mock.fn(async () => { seq += 1; return { id: `num_${seq}`, documentNumber: `JV-REV-${seq}` }; });

    await make().execute(ctx, 'exp_1', 'บันทึกผิด');

    assert.equal(s.reserveNumber.execute.mock.callCount(), 2);
    // Both reserved numbers are passed to the repo (accrual arg[4], settlement arg[5]).
    assert.equal(repo.voidExpenseTrueReversal.mock.calls[0].arguments[4], 'JV-REV-1');
    assert.deepEqual(repo.voidExpenseTrueReversal.mock.calls[0].arguments[5], [{ paymentId: 'payment-1', reversalEntryNumber: 'JV-REV-2' }]);
    assert.equal(s.commitNumber.execute.mock.callCount(), 2);
    const committedOwners = s.commitNumber.execute.mock.calls.map((c: any) => c.arguments[0].ownerId);
    assert.deepEqual(committedOwners.sort(), ['je_pay_rev', 'je_rev']);
    assert.equal(s.cancelNumber.execute.mock.callCount(), 0);
  });

  it('enforces permission, reason length, and status guards before any side effect', async () => {
    await assert.rejects(() => make().execute({ ...ctx, permissions: [] }, 'exp_1', 'เหตุผล'), ForbiddenException);
    await assert.rejects(() => make().execute(ctx, 'exp_1', 'ab'), BadRequestException);
    repo.findById = mock.fn(async () => ({ id: 'exp_1', status: 'VOIDED', branchId: null }));
    await assert.rejects(() => make().execute(ctx, 'exp_1', 'เหตุผล'), BadRequestException);
    assert.equal(s.reserveNumber.execute.mock.callCount(), 0);
    assert.equal(repo.voidExpenseTrueReversal.mock.callCount(), 0);
  });
});
