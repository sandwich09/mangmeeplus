import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { UnprocessableEntityException } from '@nestjs/common';
import { VoidReimbursementPaymentUseCase } from './reimbursement-finance.use-case';

// Evidence fake for detailWithFileNames — decision endpoints now return the same hydrated
// detail as a GET (names + file names), so their specs feed the assembler harmless lookups.
const fakeDetailEvidence = { getAttachmentFileName: async () => undefined, getAttachmentFileNames: async () => ({}) };


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
      listPaymentSlips: async () => ({}),
      findPaymentById: mock.fn(async () => ({ id: 'pay-1', reimbursementRequestId: 'rb-1', status: 'RECORDED', paidAmount: '500.0000' })),
      findPostedGeneratedJournalId: mock.fn(async () => 'je-orig'),
      voidPaymentTrueReversal: mock.fn(async () => ({ request: requestDetail('READY_FOR_PAYMENT'), payment: { id: 'pay-1', status: 'VOIDED' }, reversalEntryId: 'je-rev' })),
    };
  });

  const make = () => new VoidReimbursementPaymentUseCase(repo, fakeDetailEvidence as any);

  it('passes audit identity to the atomic void and returns its current detail', async () => {
    const detail = await make().execute(ctx, 'rb-1', 'pay-1', { reason: 'จ่ายผิดบัญชี' });
    assert.ok(detail);
    assert.deepEqual(repo.voidPaymentTrueReversal.mock.calls[0].arguments, ['co-1', 'rb-1', 'pay-1', 'fin-1', 'จ่ายผิดบัญชี', undefined, 'req-1']);
  });
  it('propagates transaction failure without emitting a second event or committing a number', async () => {
    repo.voidPaymentTrueReversal = mock.fn(async () => { throw new UnprocessableEntityException('injected rollback'); });
    await assert.rejects(make().execute(ctx, 'rb-1', 'pay-1', { reason: 'ผิดพลาด' }), /injected rollback/);
  });
  it('checks permission, branch and payment association before replay', async () => {
    await assert.rejects(make().execute({ ...ctx, permissions: [] }, 'rb-1', 'pay-1', { reason: 'ซ้ำ' }), /permission/);
    repo.findRequestById = mock.fn(async () => ({ ...requestDetail('UNPAID'), branchId: 'outside' }));
    await assert.rejects(make().execute({ ...ctx, scopes: { branchIds: ['inside'] } }, 'rb-1', 'pay-1', { reason: 'ซ้ำ' }));
    repo.findRequestById = mock.fn(async () => requestDetail('UNPAID'));
    repo.findPaymentById = mock.fn(async () => ({ id: 'pay-1', reimbursementRequestId: 'other-request', status: 'VOIDED' }));
    await assert.rejects(make().execute(ctx, 'rb-1', 'pay-1', { reason: 'ซ้ำ' }), /not found/);
    assert.equal(repo.voidPaymentTrueReversal.mock.callCount(), 0);
  });

  it('recovers an already-voided payment without another reversal or event', async () => {
    repo.findPaymentById = mock.fn(async () => ({ id: 'pay-1', reimbursementRequestId: 'rb-1', status: 'VOIDED', paidAmount: '500.0000' }));
    const result = await make().execute(ctx, 'rb-1', 'pay-1', { reason: 'ซ้ำ' });
    assert.ok(result);
    assert.equal(s.reserveNumber.execute.mock.callCount(), 0);
    assert.equal(s.audit.log.mock.callCount(), 0);
    assert.equal(s.outbox.append.mock.callCount(), 0);
    assert.equal(repo.voidPaymentTrueReversal.mock.callCount(), 0);
  });
});
