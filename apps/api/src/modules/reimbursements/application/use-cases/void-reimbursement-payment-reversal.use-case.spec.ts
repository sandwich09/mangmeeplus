import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { UnprocessableEntityException } from '@nestjs/common';
import { VoidReimbursementPaymentUseCase } from './reimbursement-finance.use-case';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { WORKFLOW_TEMPLATE_CATALOG } from '../../../workflow/domain/workflow-template-catalog';

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

// B7 (impact audit 2026-10-01): a bank statement line confirmed against a payment must not be left
// matched to a payment that no longer stands. The rule deleting an expense already follows.
describe('PrismaReimbursementRepository.voidPaymentTrueReversal: confirmed bank match', () => {
  function harness(matches: any[]) {
    const seen: any[] = [];
    let attempts = 0;
    const tx = {
      $executeRaw: async () => 1,
      reimbursementPayment: {
        findFirst: async () => ({ id: 'pay-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', status: 'RECORDED', paidAmount: '500.0000', paidAt: new Date('2026-02-01T00:00:00.000Z'), createdAt: new Date('2026-02-01T00:00:00.000Z'), updatedAt: new Date('2026-02-01T00:00:00.000Z') }),
        // Reaching the write is all these cases need to prove; the reversal itself is covered on real PostgreSQL.
        updateMany: async () => { throw new Error('reached:void-write'); },
      },
      bankReconciliationMatch: {
        findFirst: async ({ where }: any) => {
          seen.push(where);
          return matches.find((match) => Object.entries(where).every(([key, value]) => match[key] === value)) ?? null;
        },
      },
    };
    const client = { $transaction: async (work: (transaction: any) => Promise<unknown>) => { attempts += 1; return work(tx); } };
    return { repo: new PrismaReimbursementRepository({ client } as any, {} as any), seen, attempts: () => attempts };
  }
  const match = (overrides: Record<string, unknown> = {}) => ({ id: 'match-1', companyId: 'co-1', sourceType: 'REIMBURSEMENT_PAYMENT', sourceId: 'pay-1', status: 'CONFIRMED', ...overrides });
  const voidIt = (h: ReturnType<typeof harness>) => h.repo.voidPaymentTrueReversal('co-1', 'rb-1', 'pay-1', 'fin-1', 'โอนผิดบัญชี', undefined, 'req-1');

  it('refuses the void while a statement line is confirmed against the payment, before anything is written', async () => {
    const h = harness([match()]);
    await assert.rejects(() => voidIt(h), (error: any) => error.getStatus() === 409 && error.getResponse().code === 'reimbursement_payment_bank_matched');
    assert.deepEqual(h.seen, [{ companyId: 'co-1', sourceType: 'REIMBURSEMENT_PAYMENT', sourceId: 'pay-1', status: 'CONFIRMED' }]);
    assert.equal(h.attempts(), 1, 'a refusal is not retried');
  });

  it('voids once the match is undone, and is not held up by a suggestion, a rejection or another payment\'s match', async () => {
    for (const rows of [
      [],
      [match({ status: 'VOIDED' })],
      [match({ status: 'SUGGESTED' })],
      [match({ status: 'REJECTED' })],
      [match({ sourceId: 'pay-of-another-claim' })],
      [match({ sourceType: 'EXPENSE_PAYMENT' })],
      [match({ companyId: 'co-2' })],
    ]) {
      await assert.rejects(() => voidIt(harness(rows)), /reached:void-write/, JSON.stringify(rows));
    }
  });

  it('answers a void that lost a serialization conflict as "the payment changed", after its own retries', async () => {
    let attempts = 0;
    const client = { $transaction: async () => { attempts += 1; throw Object.assign(new Error('write conflict'), { code: 'P2034' }); } };
    const repo = new PrismaReimbursementRepository({ client } as any, {} as any);
    await assert.rejects(() => repo.voidPaymentTrueReversal('co-1', 'rb-1', 'pay-1', 'fin-1', 'โอนผิดบัญชี'),
      (error: any) => error.getStatus() === 409 && error.message === 'reimbursement_payment_state_changed');
    assert.equal(attempts, 5, 'the shared helper retried the conflict before giving up');
  });
});

// Audit B9: the void notice is rendered from this event and nothing else, so the event has to
// carry whatever the notice reads. Producer and consumer are checked against each other here.
describe('reimbursement.payment_voided event feeds the requester notice', () => {
  it('carries the claim number and the requester, and every field the void notice reads', async () => {
    const at = new Date('2026-08-10T01:00:00.000Z');
    const request: any = {
      id: 'rb-1', companyId: 'co-1', requestNo: 'RB-202608-00021', requesterUserId: 'staff-1', status: 'PAID',
      amount: '289.0000', paymentTotalAmount: '289.0000', outstandingAmount: '0.0000', paymentStatus: 'PAID',
      requesterDisplayNameSnapshot: 'sandwich', lines: [], approvalSteps: [], payments: [], duplicateCandidates: [],
      claimSignatures: [], createdAt: at, updatedAt: at, duplicateStatus: 'NO_MATCH', receiptRequirementStatus: 'ATTACHED',
      postingStatus: 'not_required', financeReviewStatus: 'APPROVED_FOR_PAYMENT', reason: 'r', categoryKey: 'other',
      currency: 'THB', incurredDate: at, createdByUserId: 'staff-1',
    };
    const outbox: any[] = [];
    const tx: any = {
      $executeRaw: async () => 0,
      reimbursementPayment: {
        findFirst: async () => ({ id: 'pay-1', status: 'RECORDED' }),
        updateMany: async () => ({ count: 1 }),
        findFirstOrThrow: async () => ({
          id: 'pay-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', paidAmount: '289.0000', currency: 'THB',
          paymentMethod: 'BANK_TRANSFER', paidAt: at, status: 'VOIDED', postingStatus: 'pending',
          paidByUserId: 'finance-1', createdAt: at, updatedAt: at,
        }),
        update: async ({ data }: any) => data,
      },
      journalEntry: { findFirst: async () => null },
      bankReconciliationMatch: { findFirst: async () => null },
      reimbursementRequest: {
        findFirstOrThrow: async () => request,
        update: async ({ data }: any) => { Object.assign(request, data); return request; },
      },
      expenseRecord: { findMany: async () => [], update: async () => ({}) },
      auditLog: { create: async () => ({}) },
      outboxEvent: { create: async ({ data }: any) => { outbox.push(data); return data; } },
    };
    const client: any = { $transaction: async (work: (t: any) => Promise<unknown>) => work(tx) };
    const realRepo = new PrismaReimbursementRepository({ client } as any, {} as any);

    await realRepo.voidPaymentTrueReversal('co-1', 'rb-1', 'pay-1', 'finance-1', 'โอนผิดบัญชี', undefined, 'http-req-1');

    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].eventType, 'reimbursement.payment_voided');
    const data = outbox[0].payloadJson.data;
    assert.equal(data.requestId, 'rb-1');
    assert.equal(data.requestNo, 'RB-202608-00021');
    assert.equal(data.requesterUserId, 'staff-1');
    // The reason is free text typed by whoever voided; it stays in the audit row, out of the event.
    assert.equal(JSON.stringify(outbox[0].payloadJson).includes('โอนผิดบัญชี'), false);

    const cfg = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_payment_voided')!.defaultActionJson[0]!.configJson;
    const texts = [cfg['titleTemplate'], cfg['bodyTemplate'], cfg['deepLinkPathTemplate']].join(' ');
    const read = [...texts.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1]!).filter((field) => field !== 'companyId');
    for (const field of [...read, ...(cfg['recipientPayloadKeys'] as string[])]) {
      assert.ok(data[field], `the void notice reads "${field}", which the event does not carry`);
    }
  });
});
