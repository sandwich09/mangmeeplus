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
  // Final review W1: the reason is shown on the payment row to every reader of the claim, and kept in the audit row.
  it('refuses a reason that carries an account number, before the claim is read, and takes an ordinary one', async () => {
    for (const reason of ['โอนเข้าบัญชี 012-3-45678-9 ผิด', 'ต้องโอนเข้า 0812345678', 'เลขบัญชีที่ถูกคือ ๑๒๓๔๕๖๗๘๙๐']) {
      await assert.rejects(make().execute(ctx, 'rb-1', 'pay-1', { reason }), (error: any) => error.getStatus() === 400 && error.message === 'note_contains_account_number', reason);
    }
    assert.deepEqual([repo.findRequestById.mock.callCount(), repo.voidPaymentTrueReversal.mock.callCount()], [0, 0]);
    // What a payer really writes: the last four digits, the claim's own number, an amount.
    for (const reason of ['โอนผิดบัญชี ที่ถูกลงท้าย 6789', 'ซ้ำกับใบ RB-202609-0003', 'โอนเกิน 1500 บาท']) {
      await make().execute(ctx, 'rb-1', 'pay-1', { reason });
    }
    assert.equal(repo.voidPaymentTrueReversal.mock.callCount(), 3);
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
// matched to a payment that no longer stands. Review 2026-10-01: the void refused and sent the user
// to undo the match on the bank screen, which does not list a fully matched line, so the payment
// could not be voided from the product at all. The void now undoes the match itself.
describe('PrismaReimbursementRepository.voidPaymentTrueReversal: confirmed bank match', () => {
  /** `matches` are the bank match rows; `lines` the amount of each statement line; `reconciled` the lines a completed reconciliation holds. */
  function harness(matches: any[], lines: Record<string, string> = { 'line-1': '-500.0000' }, reconciled: string[] = []) {
    const seen: any[] = [];
    const writes: any[] = [];
    let attempts = 0;
    const tx = {
      $executeRaw: async () => 1,
      reimbursementPayment: {
        findFirst: async () => ({ id: 'pay-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', status: 'RECORDED', paidAmount: '500.0000', paidAt: new Date('2026-02-01T00:00:00.000Z'), createdAt: new Date('2026-02-01T00:00:00.000Z'), updatedAt: new Date('2026-02-01T00:00:00.000Z') }),
        // Reaching the write is all these cases need to prove; the reversal itself is covered on real PostgreSQL.
        updateMany: async () => { throw new Error('reached:void-write'); },
      },
      bankReconciliationMatch: {
        findMany: async ({ where }: any) => {
          seen.push(where);
          return matches.filter((match) => Object.entries(where).every(([key, value]) => match[key] === value));
        },
        update: async ({ where, data }: any) => {
          writes.push(['match', where.id, data]);
          Object.assign(matches.find((match) => match.id === where.id), data);
        },
      },
      bankReconciliationSessionLine: {
        count: async ({ where }: any) => {
          assert.deepEqual(where, { companyId: 'co-1', statementLineId: where.statementLineId, session: { status: 'COMPLETED' } });
          return reconciled.includes(where.statementLineId) ? 1 : 0;
        },
      },
      bankStatementLine: {
        findFirstOrThrow: async ({ where }: any) => ({
          signedAmount: lines[where.id],
          matches: matches.filter((match) => match.statementLineId === where.id && match.companyId === where.companyId && match.status === 'CONFIRMED'),
        }),
        update: async ({ where, data }: any) => { writes.push(['line', where.id, data]); },
      },
    };
    const client = { $transaction: async (work: (transaction: any) => Promise<unknown>) => { attempts += 1; return work(tx); } };
    return { repo: new PrismaReimbursementRepository({ client } as any, {} as any), seen, writes, attempts: () => attempts };
  }
  const match = (overrides: Record<string, unknown> = {}) => ({
    id: 'match-1', companyId: 'co-1', statementLineId: 'line-1', sourceType: 'REIMBURSEMENT_PAYMENT', sourceId: 'pay-1', status: 'CONFIRMED', allocatedAmount: '500.0000', ...overrides,
  });
  const voidIt = (h: ReturnType<typeof harness>) => h.repo.voidPaymentTrueReversal('co-1', 'rb-1', 'pay-1', 'fin-1', 'โอนผิดบัญชี', undefined, 'req-1');

  it('undoes the confirmed match and derives the line\'s status again, then goes on to void', async () => {
    // Before: 409 reimbursement_payment_bank_matched, with no way to undo the match of a fully matched line.
    const h = harness([match()]);
    await assert.rejects(() => voidIt(h), /reached:void-write/);
    assert.deepEqual(h.seen, [{ companyId: 'co-1', sourceType: 'REIMBURSEMENT_PAYMENT', sourceId: 'pay-1', status: 'CONFIRMED' }]);
    assert.deepEqual(h.writes, [['match', 'match-1', { status: 'VOIDED' }], ['line', 'line-1', { status: 'UNMATCHED' }]]);

    // What another payment still holds on the same line stays, and the line reads partly matched.
    const shared = harness([match({ allocatedAmount: '300.0000' }), match({ id: 'match-2', sourceType: 'EXPENSE_PAYMENT', sourceId: 'exp-pay', allocatedAmount: '200.0000' })]);
    await assert.rejects(() => voidIt(shared), /reached:void-write/);
    assert.deepEqual(shared.writes, [['match', 'match-1', { status: 'VOIDED' }], ['line', 'line-1', { status: 'PARTIALLY_MATCHED' }]]);

    // A payment split over two statement lines: both matches are undone, each line by its own matches.
    const split = harness([match({ allocatedAmount: '200.0000' }), match({ id: 'match-2', statementLineId: 'line-2', allocatedAmount: '300.0000' })],
      { 'line-1': '-200.0000', 'line-2': '-300.0000' });
    await assert.rejects(() => voidIt(split), /reached:void-write/);
    assert.deepEqual(split.writes, [
      ['match', 'match-1', { status: 'VOIDED' }], ['line', 'line-1', { status: 'UNMATCHED' }],
      ['match', 'match-2', { status: 'VOIDED' }], ['line', 'line-2', { status: 'UNMATCHED' }],
    ]);
  });

  it('refuses only a match whose line sits in a completed reconciliation, and says to reopen it', async () => {
    const h = harness([match()], undefined, ['line-1']);
    await assert.rejects(() => voidIt(h), (error: any) => error.getStatus() === 409 && error.getResponse().code === 'reimbursement_payment_bank_reconciled'
      && /Reopen that reconciliation/.test(error.getResponse().message));
    assert.deepEqual(h.writes, [], 'nothing is written before the refusal');
    assert.equal(h.attempts(), 1, 'a refusal is not retried');
  });

  it('is not held up by a match already undone, a suggestion, a rejection or another payment\'s match, and leaves them alone', async () => {
    for (const rows of [
      [],
      [match({ status: 'VOIDED' })],
      [match({ status: 'SUGGESTED' })],
      [match({ status: 'REJECTED' })],
      [match({ sourceId: 'pay-of-another-claim' })],
      [match({ sourceType: 'EXPENSE_PAYMENT' })],
      [match({ companyId: 'co-2' })],
    ]) {
      const h = harness(rows, undefined, ['line-1']);
      await assert.rejects(() => voidIt(h), /reached:void-write/, JSON.stringify(rows));
      assert.deepEqual(h.writes, [], JSON.stringify(rows));
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
  const at = new Date('2026-08-10T01:00:00.000Z');
  /** A void run to its end over one fake transaction: every row and event it writes goes through `tx`. */
  async function voidedThrough(bank: Record<string, unknown> = { bankReconciliationMatch: { findMany: async () => [] } }) {
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
      ...bank,
      reimbursementRequest: {
        findFirstOrThrow: async () => request,
        update: async ({ data }: any) => { Object.assign(request, data); return request; },
      },
      reimbursementPolicy: { findFirst: async ({ where }: any) => {
        assert.deepEqual(where, { companyId: 'co-1', branchId: null });
        return null;
      } },
      expenseRecord: { findMany: async () => [], update: async () => ({}) },
      auditLog: { create: async () => ({}) },
      outboxEvent: { create: async ({ data }: any) => { outbox.push(data); return data; } },
    };
    const client: any = { $transaction: async (work: (t: any) => Promise<unknown>) => work(tx) };
    const realRepo = new PrismaReimbursementRepository({ client } as any, {} as any);

    await realRepo.voidPaymentTrueReversal('co-1', 'rb-1', 'pay-1', 'finance-1', 'โอนผิดบัญชี', undefined, 'http-req-1');
    return outbox;
  }

  it('carries the claim number and the requester, and every field the void notice reads', async () => {
    const outbox = await voidedThrough();

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

  // Final review W10: the bank screen's own "ยกเลิกการจับคู่" writes `banking.statement_line.unmatched`. A void
  // that undoes a match wrote that screen's audit row but not its event.
  it('writes the bank module\'s own unmatched event for each match it undoes, through the void\'s transaction', async () => {
    const matches = [{ id: 'match-1', statementLineId: 'line-1' }, { id: 'match-2', statementLineId: 'line-2' }];
    const outbox = await voidedThrough({
      bankReconciliationMatch: { findMany: async () => matches, update: async () => ({}) },
      bankReconciliationSessionLine: { count: async () => 0 },
      bankStatementLine: { findFirstOrThrow: async () => ({ signedAmount: '-100.0000', matches: [] }), update: async () => ({}) },
    });
    assert.deepEqual(outbox.map((event) => [event.eventType, event.aggregateType, event.aggregateId, event.eventKey]), [
      ['banking.statement_line.unmatched', 'bank_statement_line', 'line-1', 'banking.statement_line.unmatched:bank_statement_line:line-1:match-1'],
      ['banking.statement_line.unmatched', 'bank_statement_line', 'line-2', 'banking.statement_line.unmatched:bank_statement_line:line-2:match-2'],
      ['reimbursement.payment_voided', 'reimbursement_payment', 'pay-1', 'reimbursement.payment_voided:pay-1'],
    ]);
    // The shape the bank screen's own unmatch writes: who, in which request, which match of which line.
    const { occurredAt, ...payload } = outbox[0].payloadJson;
    assert.deepEqual(payload, {
      companyId: 'co-1', actorUserId: 'finance-1', requestId: 'http-req-1', aggregateType: 'bank_statement_line', aggregateId: 'line-1',
      data: { matchId: 'match-1', statementLineId: 'line-1' },
    });
    assert.ok(!Number.isNaN(Date.parse(occurredAt)));
    assert.deepEqual([outbox[0].companyId, outbox[0].priority, outbox[0].status], ['co-1', 'NORMAL', 'PENDING']);
  });
});
