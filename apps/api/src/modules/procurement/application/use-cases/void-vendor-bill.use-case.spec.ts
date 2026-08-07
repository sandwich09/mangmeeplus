import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { VoidVendorBillUseCase } from './vendor-bill.use-case';

// H-04 closure evidence: vendor-bill void orchestration reserves a reversal
// entry number per posted generated journal, commits it only when the reversal
// was created, and releases it on failure or when it went unused.

const ctx: any = {
  companyId: 'co_1', userId: 'u1', requestId: 'req_1',
  permissions: ['procurement.vendor_bill.void'],
};

function stubs() {
  return {
    audit: { log: mock.fn(async () => undefined) },
    outbox: { append: mock.fn(async () => undefined) },
    reserveNumber: { execute: mock.fn(async () => ({ id: 'num_1', documentNumber: 'JV-R-1' })) },
    commitNumber: { execute: mock.fn(async () => undefined) },
    cancelNumber: { execute: mock.fn(async () => undefined) },
  };
}

describe('VoidVendorBillUseCase (H-04)', () => {
  let s: ReturnType<typeof stubs>;
  let repo: any;

  beforeEach(() => {
    s = stubs();
    repo = {
      findVendorBillById: mock.fn(async () => ({ id: 'bill_1', status: 'APPROVED', paidAmount: '0', supplierId: 'sup_1' })),
      listVendorBillJournalsForReversal: mock.fn(async () => [{ id: 'je_orig', periodKey: '2026-07' }]),
      voidVendorBillTrueReversal: mock.fn(async () => ({
        bill: { id: 'bill_1', status: 'VOIDED' },
        reversalJournals: [{ originalJournalId: 'je_orig', reversalJournalId: 'je_rev' }],
      })),
    };
  });

  const make = () => new VoidVendorBillUseCase(repo, s.audit as any, s.outbox as any, s.reserveNumber as any, s.commitNumber as any, s.cancelNumber as any);

  it('reserves and commits the reversal number when the bill was posted', async () => {
    const result = await make().execute(ctx, 'bill_1', 'บันทึกผิด');
    assert.equal(result.status, 'VOIDED');
    assert.equal(s.reserveNumber.execute.mock.callCount(), 1);
    assert.deepEqual(repo.voidVendorBillTrueReversal.mock.calls[0].arguments[4], { je_orig: 'JV-R-1' });
    assert.equal(s.commitNumber.execute.mock.callCount(), 1);
    assert.equal((s.commitNumber.execute.mock.calls[0] as any).arguments[0].ownerId, 'je_rev');
    assert.equal(s.cancelNumber.execute.mock.callCount(), 0);
    assert.equal((s.outbox.append.mock.calls[0] as any).arguments[0], 'vendor_bill.voided');
  });

  it('releases the reserved numbers and rethrows when the void transaction fails', async () => {
    repo.voidVendorBillTrueReversal = mock.fn(async () => { throw new ConflictException('accounting_period_locked'); });
    await assert.rejects(() => make().execute(ctx, 'bill_1', 'บันทึกผิด'), ConflictException);
    assert.equal(s.cancelNumber.execute.mock.callCount(), 1);
    assert.equal(s.commitNumber.execute.mock.callCount(), 0);
  });

  it('releases the number when the journal turned out to be already reversed', async () => {
    repo.voidVendorBillTrueReversal = mock.fn(async () => ({ bill: { id: 'bill_1', status: 'VOIDED' }, reversalJournals: [] }));
    await make().execute(ctx, 'bill_1', 'บันทึกผิด');
    assert.equal(s.commitNumber.execute.mock.callCount(), 0);
    assert.equal(s.cancelNumber.execute.mock.callCount(), 1);
  });

  it('voids an unposted bill without reserving any number', async () => {
    repo.listVendorBillJournalsForReversal = mock.fn(async () => []);
    repo.voidVendorBillTrueReversal = mock.fn(async () => ({ bill: { id: 'bill_1', status: 'VOIDED' }, reversalJournals: [] }));
    const result = await make().execute(ctx, 'bill_1', 'บันทึกผิด');
    assert.equal(result.status, 'VOIDED');
    assert.equal(s.reserveNumber.execute.mock.callCount(), 0);
    assert.equal(s.commitNumber.execute.mock.callCount(), 0);
    assert.equal(s.cancelNumber.execute.mock.callCount(), 0);
  });

  it('rejects a missing permission, a paid bill, a non-voidable status, and an empty reason', async () => {
    await assert.rejects(() => make().execute({ ...ctx, permissions: [] }, 'bill_1', 'reason'), ForbiddenException);
    repo.findVendorBillById = mock.fn(async () => ({ id: 'bill_1', status: 'APPROVED', paidAmount: '50' }));
    await assert.rejects(() => make().execute(ctx, 'bill_1', 'reason'), BadRequestException);
    repo.findVendorBillById = mock.fn(async () => ({ id: 'bill_1', status: 'PAID', paidAmount: '0' }));
    await assert.rejects(() => make().execute(ctx, 'bill_1', 'reason'), BadRequestException);
    await assert.rejects(() => make().execute(ctx, 'bill_1', '   '), BadRequestException);
    assert.equal(s.reserveNumber.execute.mock.callCount(), 0);
  });
});
