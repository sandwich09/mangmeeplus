import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { UnprocessableEntityException } from '@nestjs/common';
import { VoidReimbursementPaymentUseCase } from './reimbursement-finance.use-case';

// Evidence fake for detailWithFileNames — decision endpoints now return the same hydrated
// detail as a GET (names + file names), so their specs feed the assembler harmless lookups.
const fakeDetailEvidence = { getAttachmentFileName: async () => undefined, getAttachmentFileNames: async () => ({}) };


// GAP-02 Phase 3 closure evidence: the payment void reserves the reversal entry
// number only when a posted settlement journal exists, commits it only when a
// reversal was created, and releases it on failure or when it was unnecessary —
// mirroring VoidExpenseUseCase (H-04).

const ctx: any = {
  companyId: 'co-1', userId: 'fin-1', requestId: 'req-1',
  permissions: ['reimbursement.payment.void'], scopes: {},
};

function stubs() {
  return {
    audit: { log: mock.fn(async () => undefined) },
    outbox: { append: mock.fn(async () => undefined) },
    reserveNumber: { execute: mock.fn(async () => ({ id: 'num-1', documentNumber: 'JV-REV-1' })) },
    commitNumber: { execute: mock.fn(async () => undefined) },
    cancelNumber: { execute: mock.fn(async () => undefined) },
  };
}

function requestDetail(paymentStatus: string): any {
  return {
    id: 'rb-1', companyId: 'co-1', requestNo: 'RB-1', requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'Somchai',
    amount: '500.0000', currency: 'THB', categoryKey: 'travel', reason: 'Taxi', status: 'READY_FOR_PAYMENT',
    financeReviewStatus: 'APPROVED_FOR_PAYMENT', paymentStatus, paymentTotalAmount: '0.0000', outstandingAmount: '500.0000',
    duplicateStatus: 'NO_MATCH', incurredDate: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lines: [], approvalSteps: [], payments: [], duplicateCandidates: [],
  };
}

describe('VoidReimbursementPaymentUseCase (GAP-02 true reversal)', () => {
  let s: ReturnType<typeof stubs>;
  let repo: any;

  beforeEach(() => {
    s = stubs();
    repo = {
      findRequestById: mock.fn(async () => requestDetail('PARTIALLY_PAID')),
      findPolicy: async () => null,
      getUserDisplayNames: async () => ({}),
      listSignedClaimFormCopies: async () => [],
      findPaymentById: mock.fn(async () => ({ id: 'pay-1', reimbursementRequestId: 'rb-1', status: 'RECORDED', paidAmount: '500.0000' })),
      findPostedGeneratedJournalId: mock.fn(async () => 'je-orig'),
      voidPaymentTrueReversal: mock.fn(async () => ({ request: requestDetail('READY_FOR_PAYMENT'), payment: { id: 'pay-1', status: 'VOIDED' }, reversalEntryId: 'je-rev' })),
    };
  });

  const make = () => new VoidReimbursementPaymentUseCase(repo, s.audit as any, s.outbox as any, s.reserveNumber as any, s.commitNumber as any, s.cancelNumber as any, fakeDetailEvidence as any);

  it('reserves and commits the reversal number when the payment was posted', async () => {
    const detail: any = await make().execute(ctx, 'rb-1', 'pay-1', { reason: 'จ่ายผิดบัญชี' });
    assert.ok(detail);
    assert.equal(s.reserveNumber.execute.mock.callCount(), 1);
    // reversal entry number is threaded into the repo transaction
    assert.equal(repo.voidPaymentTrueReversal.mock.calls[0].arguments[5], 'JV-REV-1');
    assert.equal(s.commitNumber.execute.mock.callCount(), 1);
    assert.equal((s.commitNumber.execute.mock.calls[0] as any).arguments[0].ownerId, 'je-rev');
    assert.equal(s.cancelNumber.execute.mock.callCount(), 0);
    const outboxPayload = (s.outbox.append.mock.calls[0] as any).arguments[3];
    assert.equal(outboxPayload.data.reversalEntryId, 'je-rev');
  });

  it('skips the reversal number and reverses nothing when the payment was never posted', async () => {
    repo.findPostedGeneratedJournalId = mock.fn(async () => null);
    repo.voidPaymentTrueReversal = mock.fn(async () => ({ request: requestDetail('READY_FOR_PAYMENT'), payment: { id: 'pay-1', status: 'VOIDED' }, reversalEntryId: null }));
    await make().execute(ctx, 'rb-1', 'pay-1', { reason: 'ยกเลิก' });
    assert.equal(s.reserveNumber.execute.mock.callCount(), 0);
    // no reserved number is threaded through
    assert.equal(repo.voidPaymentTrueReversal.mock.calls[0].arguments[5], undefined);
    assert.equal(s.commitNumber.execute.mock.callCount(), 0);
    assert.equal(s.cancelNumber.execute.mock.callCount(), 0);
    const outboxPayload = (s.outbox.append.mock.calls[0] as any).arguments[3];
    assert.equal(outboxPayload.data.reversalEntryId, null);
  });

  it('releases the reserved number and rethrows when the void transaction fails', async () => {
    repo.voidPaymentTrueReversal = mock.fn(async () => { throw new UnprocessableEntityException('boom'); });
    await assert.rejects(() => make().execute(ctx, 'rb-1', 'pay-1', { reason: 'ผิดพลาด' }), UnprocessableEntityException);
    assert.equal(s.cancelNumber.execute.mock.callCount(), 1);
    assert.equal(s.commitNumber.execute.mock.callCount(), 0);
    assert.equal(s.outbox.append.mock.callCount(), 0);
  });

  it('rejects voiding an already-voided payment', async () => {
    repo.findPaymentById = mock.fn(async () => ({ id: 'pay-1', reimbursementRequestId: 'rb-1', status: 'VOIDED', paidAmount: '500.0000' }));
    await assert.rejects(() => make().execute(ctx, 'rb-1', 'pay-1', { reason: 'ซ้ำ' }), UnprocessableEntityException);
    assert.equal(repo.voidPaymentTrueReversal.mock.callCount(), 0);
  });
});
