import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { RejectExpenseUseCase, VoidExpenseUseCase } from './expense-draft.use-case';

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

describe('void certificate cancellation notices (A5)', () => {
  for (const failure of ['actor lookup', 'notifier']) it(`returns the committed expense when ${failure} fails`, async () => {
    const s = stubs();
    const expense = { id: 'exp_1', status: 'VOIDED' };
    const repo: any = {
      findById: async () => ({ id: 'exp_1', status: 'CONFIRMED', branchId: null }),
      findPostedGeneratedJournalId: async () => null, findPostedExpensePaymentJournals: async () => [],
      findMemberDisplayName: async () => { if (failure === 'actor lookup') throw new Error('lookup unavailable'); return 'สมใจ'; },
      voidExpenseTrueReversal: async () => ({ expense, reversalEntryId: null, paymentReversalEntryIds: [],
        cancelledCertificate: { issuerUserId: 'issuer-1', certificateNumber: 'WT-1', isExternal: false, certificateRound: 1 } }),
    };
    const notify = { execute: async () => { throw new Error('notice unavailable'); } };
    const useCase = new VoidExpenseUseCase(repo, s.audit as any, s.outbox as any, s.reserveNumber as any, s.commitNumber as any, s.cancelNumber as any, notify as any);
    assert.deepEqual(await useCase.execute(ctx, 'exp_1', 'ข้อมูลผิด', true), { ...expense, cancelledCertificate: { kind: 'SYSTEM', number: 'WT-1' } });
  });
  for (const isExternal of [false, true]) {
    it(`notifies the original ${isExternal ? 'external recorder' : 'system issuer'} only after void commits and returns the actual number despite a stale page`, async () => {
      const s = stubs(); const notices: any[] = []; let committed = false; let issuerUserId = 'issuer-1'; let round = 1;
      const repo: any = {
        findById: async () => ({ id: 'exp_1', status: 'CONFIRMED', branchId: null, certificateOnExpense: { number: 'WT-OLD' } }),
        findMemberDisplayName: async () => 'สมใจ',
        findPostedGeneratedJournalId: async () => null, findPostedExpensePaymentJournals: async () => [],
        voidExpenseTrueReversal: async () => { committed = true; return {
          expense: { id: 'exp_1', status: 'VOIDED' }, reversalEntryId: null, paymentReversalEntryId: null, paymentReversalEntryIds: [],
          cancelledCertificate: { issuerUserId, certificateNumber: 'WT-1', isExternal, certificateRound: round++ },
        }; },
      };
      const notify = { execute: async (input: any) => { assert.equal(committed, true); notices.push(input); } };
      const useCase = new (VoidExpenseUseCase as any)(repo, s.audit, s.outbox, s.reserveNumber, s.commitNumber, s.cancelNumber, notify);
      assert.deepEqual(await useCase.execute(ctx, 'exp_1', 'ข้อมูลผิด', true), { id: 'exp_1', status: 'VOIDED', cancelledCertificate: { kind: isExternal ? 'EXTERNAL' : 'SYSTEM', number: 'WT-1' } });
      assert.deepEqual(notices, [{ companyId: ctx.companyId, triggerKey: 'expense.wht_certificate_cancelled',
        sourceModule: 'expenses', sourceType: 'expense_record', sourceId: 'exp_1', periodKey: '1', severity: 'info',
        title: isExternal ? 'ยกเลิกการบันทึกแล้ว: หนังสือรับรองที่ออกเอง เลขที่ WT-1' : 'ยกเลิกแล้ว: หนังสือรับรอง 50 ทวิ เลขที่ WT-1',
        body: isExternal ? 'สมใจ ยกเลิกเอกสารรายจ่ายนี้ ระบบจึงยกเลิกการบันทึกนี้ กรุณายกเลิกหนังสือรับรองที่ออกเองด้วย เหตุผล: ข้อมูลผิด'
          : 'สมใจ ยกเลิกเอกสารรายจ่ายนี้ ระบบจึงยกเลิกหนังสือรับรองด้วย เหตุผล: ข้อมูลผิด',
        deepLinkHref: '/companies/co_1/expenses/exp_1#wht-certificate', recipientUserIds: ['issuer-1'] }]);
      await useCase.execute(ctx, 'exp_1', 'ข้อมูลผิด', true);
      assert.deepEqual(notices.map(row => row.periodKey), ['1', '2']);
      issuerUserId = ctx.userId; await useCase.execute(ctx, 'exp_1', 'ข้อมูลผิด', true); assert.equal(notices.length, 2);
      repo.voidExpenseTrueReversal = async () => { throw new Error('rollback'); };
      await assert.rejects(useCase.execute(ctx, 'exp_1', 'ข้อมูลผิด', true), /rollback/); assert.equal(notices.length, 2);
    });
  }
});

describe('VoidExpenseUseCase (H-04)', () => {
  it('refuses a stale status with a code and asks to reopen the page', async () => {
    const s = stubs(); const repo = { findById: async () => ({ id: 'exp_1', status: 'NEEDS_REVIEW', branchId: null }) } as any;
    const uc = new VoidExpenseUseCase(repo, s.audit as any, s.outbox as any, {} as any, {} as any, {} as any);
    await assert.rejects(uc.execute(ctx, 'exp_1', 'กรอกผิด'), (error: any) => {
      assert.equal(error.getResponse().code, 'expense_changed');
      assert.equal(error.getResponse().message, 'เอกสารนี้ยกเลิกจากหน้าที่เปิดค้างไว้ไม่ได้ เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด'); return true;
    });
  });
  for (const condition of ['permission', 'reason', 'missing', 'branch']) it(`returns coded Thai for void ${condition} refusal`, async () => {
    const s = stubs(); const repo = { findById: async () => condition === 'missing' ? null : ({ status: 'CONFIRMED', branchId: 'b1' }) } as any;
    const uc = new VoidExpenseUseCase(repo, s.audit as any, s.outbox as any, {} as any, {} as any, {} as any);
    const actor = { ...ctx, ...(condition === 'permission' && { permissions: [] }), ...(condition === 'branch' && { scopes: { branchIds: ['other'] } }) };
    await assert.rejects(uc.execute(actor, 'exp_1', condition === 'reason' ? 'x' : 'กรอกผิด'), (error: any) => {
      const response = error.getResponse(); assert.ok(response.code); assert.match(response.message, /[ก-๙]/u);
      assert.doesNotMatch(response.message, /[A-Za-z]/u); return true;
    });
  });
  it('passes stored claim authorisation without inventing permissions, audits the executor and names the starter in the notice', async () => {
    const s = stubs(); let seen: any[] = []; const notices: any[] = [];
    const repo: any = {
      findById: async () => ({ id: 'exp_1', status: 'CONFIRMED', branchId: 'branch-1', sourceReimbursementRequestId: 'claim-1', sourceReimbursementLineId: 'line-1' }),
      findPostedGeneratedJournalId: async () => null, findPostedExpensePaymentJournals: async () => [],
      findMemberDisplayName: async (_companyId: string, userId: string) => { assert.equal(userId, 'starter'); return 'ผู้เริ่มยกเลิก'; },
      voidExpenseTrueReversal: async (...args: any[]) => { seen = args; return { expense: { status: 'VOIDED' }, paymentReversalEntryIds: [],
        cancelledCertificate: { issuerUserId: 'issuer', certificateNumber: 'WT-1', isExternal: false, certificateRound: 1 } }; },
    };
    const voids = new VoidExpenseUseCase(repo, s.audit as any, s.outbox as any, {} as any, {} as any, {} as any, { execute: async (notice: any) => { notices.push(notice); } } as any);
    await voids.executeForReimbursement({ ...ctx, userId: 'continuing-user', permissions: [] }, 'exp_1', 'ข้อมูลผิด', {
      reimbursementRequestId: 'claim-1', reimbursementLineId: 'line-1', branchId: 'branch-1', systemReconcile: true,
      cancellationCertificateAttestedAt: new Date(), cancellationPendingByUserId: 'starter',
    } as any);
    assert.equal(seen[2], 'continuing-user');
    assert.equal((s.audit.log.mock.calls[0] as any).arguments[0].actorUserId, 'continuing-user');
    assert.equal(notices.length, 1); assert.match(notices[0].body, /^ผู้เริ่มยกเลิก /u);
    assert.deepEqual(seen[7], { permissions: [], taxFilingAttested: true, requestId: ctx.requestId, authorisedByClaimCancellation: true });
  });
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
    await assert.rejects(make().execute({ ...ctx, permissions: [] }, 'exp_1', 'ไม่มีสิทธิ์'), (error: any) => error.getResponse().code === 'expense_void_permission_missing');
    assert.equal(repo.voidExpenseTrueReversal.mock.callCount(), 1);
  });

  for (const leg of ['accrual', 'payment']) it(`returns coded Thai when the ${leg} reversal sequence is disabled`, async () => {
    if (leg === 'payment') {
      repo.findPostedGeneratedJournalId = mock.fn(async () => null);
      repo.findPostedExpensePaymentJournals = mock.fn(async () => [{ paymentId: 'payment-1' }]);
    }
    s.reserveNumber.execute = mock.fn(async () => { throw new UnprocessableEntityException('Document sequence is disabled or missing.'); });
    await assert.rejects(make().execute(ctx, 'exp_1', 'บันทึกผิด'), (error: any) => {
      assert.equal(error.getResponse().code, 'expense_void_number_unavailable');
      assert.equal(error.getResponse().message, 'ระบบยังออกเลขสำหรับยกเลิกเอกสารไม่ได้ ให้เจ้าของกิจการตรวจการตั้งค่าเลขเอกสารก่อนแล้วลองอีกครั้ง'); return true;
    });
    assert.equal(repo.voidExpenseTrueReversal.mock.callCount(), 0);
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

  it('translates P2034 into a retry sentence without retrying and releases reservations', async () => {
    repo.voidExpenseTrueReversal = mock.fn(async () => { throw Object.assign(new Error('serialization failure'), { code: 'P2034' }); });
    await assert.rejects(make().execute(ctx, 'exp_1', 'บันทึกผิด'), (error: any) => error instanceof ConflictException && (error.getResponse() as any).code === 'expense_changed_retry' && (error.getResponse() as any).message === 'มีคนทำรายการกับเอกสารนี้พร้อมกัน ระบบยังไม่ได้บันทึกการยกเลิก เปิดหน้านี้ใหม่แล้วลองอีกครั้ง');
    assert.equal(repo.voidExpenseTrueReversal.mock.callCount(), 1); assert.equal(s.cancelNumber.execute.mock.callCount(), 1);
  });
  it('translates a raw-statement serialization failure and releases reservations', async () => {
    repo.voidExpenseTrueReversal = mock.fn(async () => { throw Object.assign(new Error('serialization failure'), {
      code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '40001' } } },
    }); });
    await assert.rejects(make().execute(ctx, 'exp_1', 'บันทึกผิด'), (error: any) => error instanceof ConflictException && (error.getResponse() as any).code === 'expense_changed_retry');
    assert.equal(repo.voidExpenseTrueReversal.mock.callCount(), 1);
    assert.equal(s.cancelNumber.execute.mock.callCount(), 1);
    assert.equal(s.commitNumber.execute.mock.callCount(), 0);
  });
  it('passes actual permissions and attestation to the locked void', async () => {
    await make().execute(ctx, 'exp_1', 'บันทึกผิด', true);
    assert.deepEqual(repo.voidExpenseTrueReversal.mock.calls[0].arguments[7], { permissions: ctx.permissions, taxFilingAttested: true, requestId: ctx.requestId });
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

// A claim's expense records are built when the claim is approved and end with it: cancelling the claim
// voids every one of them, with the claim's own checks. Voided or rejected on the expense screen, the
// record left a claim that could be neither paid nor carried out (found while fixing audit B3 and B4).
describe('an expense record that belongs to a claim ends with the claim, never from the expense screen', () => {
  const claimRecord = (overrides: Record<string, unknown> = {}) => ({
    id: 'exp_1', status: 'CONFIRMED', branchId: 'branch-1', grandTotalAmount: '100.00',
    sourceReimbursementRequestId: 'claim-1', sourceReimbursementLineId: 'line-1', ...overrides,
  });
  function world(record: Record<string, unknown>, liveClaim: { requestId: string; requestNo: string | null } | null) {
    const s = stubs();
    const repo = {
      findById: mock.fn(async () => record),
      findLiveClaimOf: mock.fn(async () => liveClaim),
      findPostedGeneratedJournalId: mock.fn(async () => 'je_orig'),
      findPostedExpensePaymentJournals: mock.fn(async () => []),
      voidExpenseTrueReversal: mock.fn(async () => ({ expense: { id: 'exp_1', status: 'VOIDED' }, reversalEntryId: 'je_rev', paymentReversalEntryId: null, paymentReversalEntryIds: [] })),
      updateExpense: mock.fn(async () => ({ id: 'exp_1', status: 'REJECTED' })),
    };
    return {
      s, repo,
      voids: new VoidExpenseUseCase(repo as any, s.audit as any, s.outbox as any, s.reserveNumber as any, s.commitNumber as any, s.cancelNumber as any),
      rejects: new RejectExpenseUseCase(repo as any, s.audit as any),
    };
  }
  const LIVE = { requestId: 'claim-1', requestNo: 'RB-202610-00007' };
  const refusal = (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    const response = error.getResponse() as { code: string; message: string; reimbursementRequestId: string; requestNo?: string };
    assert.deepEqual([response.code, response.reimbursementRequestId], ['expense_belongs_to_reimbursement', 'claim-1']);
    // Plain Thai that says where to do it instead.
    assert.match(response.message, /ให้ยกเลิกที่ใบเบิกนั้นในเมนูการเบิกจ่าย ระบบจะยกเลิกรายการนี้ให้เอง/u);
    assert.doesNotMatch(response.message, /[A-Za-z_]{4,}/u, 'no code or key in what a person reads');
    return response;
  };

  it('refuses a void asked with expense.void, before a reversal number is reserved or anything is written, and still voids it for the claim itself', async () => {
    const w = world(claimRecord(), LIVE);

    await assert.rejects(() => w.voids.execute(ctx, 'exp_1', 'บันทึกผิด'), (error) => {
      assert.match(refusal(error).message, /ใบเบิก RB-202610-00007/u);
      return true;
    });

    assert.equal(w.s.reserveNumber.execute.mock.callCount(), 0);
    assert.equal(w.repo.voidExpenseTrueReversal.mock.callCount(), 0);
    assert.equal(w.s.audit.log.mock.callCount(), 0);
    // A claim that was sent before claims had numbers is still named as the place to go.
    const unnumbered = world(claimRecord(), { requestId: 'claim-1', requestNo: null });
    await assert.rejects(() => unnumbered.voids.execute(ctx, 'exp_1', 'บันทึกผิด'), (error) => { refusal(error); return true; });

    // Cancelling the claim is the way: the claim's own void goes through, and does not ask itself for leave.
    const asked = w.repo.findLiveClaimOf.mock.callCount();
    const voided = await w.voids.executeForReimbursement(ctx, 'exp_1', 'ซื้อซ้ำกับใบก่อน', { reimbursementRequestId: 'claim-1', reimbursementLineId: 'line-1', branchId: 'branch-1' });
    assert.equal(voided.status, 'VOIDED');
    assert.equal(w.repo.voidExpenseTrueReversal.mock.callCount(), 1);
    assert.equal(w.repo.findLiveClaimOf.mock.callCount(), asked);
  });

  it('refuses a rejection asked with expense.reject, which would have made the record deletable', async () => {
    const w = world(claimRecord({ status: 'READY_FOR_CONFIRMATION' }), LIVE);

    await assert.rejects(() => w.rejects.execute({ ...ctx, permissions: ['expense.reject'] }, 'exp_1', 'ซ้ำ'), (error) => { refusal(error); return true; });

    assert.equal(w.repo.updateExpense.mock.callCount(), 0);
  });

  it('leaves every other expense as it was: one with no claim is never asked about, and one whose claim has ended is voided', async () => {
    const plain = world({ id: 'exp_1', status: 'CONFIRMED', branchId: null, grandTotalAmount: '100.00' }, LIVE);
    assert.equal((await plain.voids.execute(ctx, 'exp_1', 'บันทึกผิด')).status, 'VOIDED');
    assert.equal(plain.repo.findLiveClaimOf.mock.callCount(), 0);

    // The reader answers nothing for a claim that was cancelled, rejected or voided (its own case, on PostgreSQL).
    const ended = world(claimRecord(), null);
    assert.equal((await ended.voids.execute(ctx, 'exp_1', 'บันทึกผิด')).status, 'VOIDED');
    assert.deepEqual((ended.repo.findLiveClaimOf.mock.calls[0] as any).arguments[0], 'co_1');
  });
});

it('notifies the covered documents only after the expense void commits (B8)', async () => {
  const s = stubs(); let committed = false; const calls: string[][] = [];
  const repo: any = {
    findById: async () => ({ id: 'exp_1', status: 'CONFIRMED', branchId: null }),
    findPostedGeneratedJournalId: async () => null, findPostedExpensePaymentJournals: async () => [],
    voidExpenseTrueReversal: async () => { committed = true; return { expense: { id: 'exp_1', status: 'VOIDED' }, reversalEntryId: null, paymentReversalEntryIds: [], cancelledCertificate: null, cancelledDisbursementVoucherIds: ['dv-1'] }; },
  };
  const notices = { cancelled: async (_ctx: any, ids: string[]) => { assert.equal(committed, true); calls.push(ids); } };
  const uc = new (VoidExpenseUseCase as any)(repo, s.audit, s.outbox, s.reserveNumber, s.commitNumber, s.cancelNumber, undefined, notices);
  await uc.execute(ctx, 'exp_1', 'ข้อมูลผิด', true);
  assert.deepEqual(calls, [['dv-1']]);
});
