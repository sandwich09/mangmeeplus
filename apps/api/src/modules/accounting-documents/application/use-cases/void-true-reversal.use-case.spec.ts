import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { VoidPaymentUseCase } from './payment.use-case';
import { VoidDocumentUseCase } from './document.use-case';

// H-04 closure evidence: void orchestration reserves the reversal entry number
// only when a posted journal exists, commits it only when a reversal was
// created, and releases it on failure or when the reversal was unnecessary.

const ctx: any = {
  companyId: 'co_1', userId: 'u1', requestId: 'req_1',
  permissions: ['accounting.payment.void', 'accounting.document.void'],
  scopes: {},
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

describe('VoidPaymentUseCase (H-04)', () => {
  let s: ReturnType<typeof stubs>;
  let repo: any;

  beforeEach(() => {
    s = stubs();
    repo = {
      findPaymentById: mock.fn(async () => ({ id: 'pay_1', status: 'RECORDED', amount: '400.00' })),
      findPostedGeneratedJournalId: mock.fn(async () => 'je_orig'),
      voidPaymentTrueReversal: mock.fn(async () => ({
        payment: { id: 'pay_1', status: 'VOIDED' },
        releasedAllocations: [{ allocationId: 'a1', paymentId: 'pay_1', documentId: 'doc_1', amount: '400.00' }],
        reversalEntryId: 'je_rev',
      })),
    };
  });

  const make = () => new VoidPaymentUseCase(repo, s.audit as any, s.outbox as any, s.reserveNumber as any, s.commitNumber as any, s.cancelNumber as any);

  it('reserves and commits the reversal number when the payment was posted', async () => {
    const result = await make().execute(ctx, 'pay_1', 'บันทึกผิด');
    assert.equal(result.status, 'VOIDED');
    assert.equal(s.reserveNumber.execute.mock.callCount(), 1);
    assert.equal(repo.voidPaymentTrueReversal.mock.calls[0].arguments[4], 'JV-REV-1');
    assert.equal(s.commitNumber.execute.mock.callCount(), 1);
    assert.equal((s.commitNumber.execute.mock.calls[0] as any).arguments[0].ownerId, 'je_rev');
    assert.equal(s.cancelNumber.execute.mock.callCount(), 0);
  });

  it('releases the reserved number and rethrows when the void transaction fails', async () => {
    repo.voidPaymentTrueReversal = mock.fn(async () => { throw new UnprocessableEntityException('boom'); });
    await assert.rejects(() => make().execute(ctx, 'pay_1', 'บันทึกผิด'), UnprocessableEntityException);
    assert.equal(s.cancelNumber.execute.mock.callCount(), 1);
    assert.equal(s.commitNumber.execute.mock.callCount(), 0);
  });

  it('releases the reserved number when the journal was already reversed elsewhere', async () => {
    repo.voidPaymentTrueReversal = mock.fn(async () => ({ payment: { id: 'pay_1', status: 'VOIDED' }, releasedAllocations: [], reversalEntryId: null }));
    await make().execute(ctx, 'pay_1', 'บันทึกผิด');
    assert.equal(s.cancelNumber.execute.mock.callCount(), 1);
    assert.equal(s.commitNumber.execute.mock.callCount(), 0);
  });

  it('skips number reservation entirely for unposted payments', async () => {
    repo.findPostedGeneratedJournalId = mock.fn(async () => null);
    repo.voidPaymentTrueReversal = mock.fn(async () => ({ payment: { id: 'pay_1', status: 'VOIDED' }, releasedAllocations: [], reversalEntryId: null }));
    await make().execute(ctx, 'pay_1', 'บันทึกผิด');
    assert.equal(s.reserveNumber.execute.mock.callCount(), 0);
    assert.equal(repo.voidPaymentTrueReversal.mock.calls[0].arguments[4], undefined);
  });

  it('enforces permission, reason length, and already-voided guards before any side effect', async () => {
    await assert.rejects(() => make().execute({ ...ctx, permissions: [] }, 'pay_1', 'เหตุผล'), ForbiddenException);
    await assert.rejects(() => make().execute(ctx, 'pay_1', 'ab'), UnprocessableEntityException);
    repo.findPaymentById = mock.fn(async () => ({ id: 'pay_1', status: 'VOIDED' }));
    await assert.rejects(() => make().execute(ctx, 'pay_1', 'เหตุผล'), UnprocessableEntityException);
    assert.equal(s.reserveNumber.execute.mock.callCount(), 0);
  });
});

describe('VoidDocumentUseCase (H-04)', () => {
  let s: ReturnType<typeof stubs>;
  let repo: any;

  beforeEach(() => {
    s = stubs();
    repo = {
      findDocumentById: mock.fn(async () => ({ id: 'doc_1', status: 'ISSUED', documentType: 'TAX_INVOICE', documentNumber: 'TI-1' })),
      findPostedGeneratedJournalId: mock.fn(async () => 'je_doc'),
      voidDocumentTrueReversal: mock.fn(async () => ({
        document: { id: 'doc_1', status: 'VOIDED' },
        releasedAllocations: [{ allocationId: 'a1', paymentId: 'pay_1', documentId: 'doc_1', amount: '500.00' }],
        unappliedCredits: [{ paymentId: 'pay_1', unappliedAmount: '500.00', currency: 'THB' }],
        reversalEntryId: 'je_rev',
      })),
    };
  });

  const make = () => new VoidDocumentUseCase(repo, s.audit as any, s.outbox as any, s.reserveNumber as any, s.commitNumber as any, s.cancelNumber as any);

  it('passes the CAS expected status and emits unapplied-credit events for released payments', async () => {
    const result = await make().execute(ctx, 'doc_1', 'ออกเอกสารผิด');
    assert.equal(result.status, 'VOIDED');
    assert.equal(repo.voidDocumentTrueReversal.mock.calls[0].arguments[4], 'ISSUED');
    assert.equal(repo.voidDocumentTrueReversal.mock.calls[0].arguments[5], 'JV-REV-1');
    assert.equal(s.commitNumber.execute.mock.callCount(), 1);
    const events = s.outbox.append.mock.calls.map((c: any) => c.arguments[0]);
    assert.ok(events.includes('accounting.tax.invoice.voided'));
    assert.ok(events.includes('accounting.payment.unapplied_credit_created'));
  });

  it('rejects terminal statuses via validateVoid before touching anything', async () => {
    repo.findDocumentById = mock.fn(async () => ({ id: 'doc_1', status: 'VOIDED', documentType: 'INVOICE' }));
    await assert.rejects(() => make().execute(ctx, 'doc_1', 'เหตุผล'), UnprocessableEntityException);
    assert.equal(repo.voidDocumentTrueReversal.mock.callCount(), 0);
    assert.equal(s.reserveNumber.execute.mock.callCount(), 0);
  });

  it('releases the reserved number when the transaction fails', async () => {
    repo.voidDocumentTrueReversal = mock.fn(async () => { throw new UnprocessableEntityException('boom'); });
    await assert.rejects(() => make().execute(ctx, 'doc_1', 'เหตุผล'), UnprocessableEntityException);
    assert.equal(s.cancelNumber.execute.mock.callCount(), 1);
    assert.equal(s.commitNumber.execute.mock.callCount(), 0);
  });
});

describe('buildDocumentPostingInput (H-04)', () => {
  it('refuses a voided document as a posting source', async () => {
    const { buildDocumentPostingInput } = await import('./posting-source.use-case');
    const { BadRequestException } = await import('@nestjs/common');
    const doc: any = { id: 'doc_1', companyId: 'co_1', status: 'VOIDED', documentType: 'INVOICE', documentDate: new Date(), lines: [] };
    assert.throws(() => buildDocumentPostingInput(doc), BadRequestException);
  });
});
