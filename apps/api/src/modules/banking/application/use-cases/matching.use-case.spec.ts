import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { ConfirmMatchUseCase, VoidMatchUseCase, ListMatchCandidatesUseCase } from './matching.use-case';
import { PrismaBankingRepository } from '../../infrastructure/prisma-banking.repository';
import type { RequestContext } from '@watchdog-bms/contracts';

const ctx: RequestContext = {
  requestId: 'req-1',
  authSubject: 'sub-1',
  userId: 'user-1',
  companyId: 'co-1',
  membershipId: 'mem-1',
  roles: ['ACCOUNTANT'],
  permissions: ['bank.match.confirm', 'bank.match.unmatch'],
  scopes: {},
  authProvider: 'dev',
};

const depositLine = {
  id: 'line-1',
  companyId: 'co-1',
  bankAccountId: 'ba-1',
  sourceType: 'MANUAL',
  lineHash: 'hash-1',
  postedDate: new Date(),
  description: 'Deposit',
  direction: 'DEPOSIT',
  signedAmount: '0.30',
  currency: 'THB',
  status: 'PARTIALLY_MATCHED',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    findStatementLineById: mock.fn(async () => depositLine),
    listMatchesByLine: mock.fn(async () => []),
    createMatch: mock.fn(async () => ({
      id: 'match-1',
      companyId: 'co-1',
      bankAccountId: 'ba-1',
      statementLineId: 'line-1',
      sourceType: 'CUSTOMER_PAYMENT',
      sourceId: 'pay-1',
      allocatedAmount: '0.20',
      currency: 'THB',
      status: 'CONFIRMED',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    updateStatementLineStatus: mock.fn(async () => depositLine),
    findMatchById: mock.fn(async () => ({
      id: 'match-1',
      companyId: 'co-1',
      bankAccountId: 'ba-1',
      statementLineId: 'line-1',
      sourceType: 'CUSTOMER_PAYMENT',
      sourceId: 'pay-1',
      allocatedAmount: '0.20',
      currency: 'THB',
      status: 'CONFIRMED',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    updateMatchStatus: mock.fn(async () => ({ id: 'match-1', status: 'VOIDED', statementLineId: 'line-1' })),
    isStatementLineLockedByCompletedReconciliation: mock.fn(async () => false),
    ...overrides,
  };
}

const audit = { log: mock.fn(async () => {}) };
const outbox = { append: mock.fn(async () => {}) };

describe('ConfirmMatchUseCase', () => {
  it('blocks source types whose business direction does not match the bank line', async () => {
    const repo = makeRepo();
    const uc = new ConfirmMatchUseCase(repo as any, audit as any, outbox as any);
    await assert.rejects(
      () => uc.execute(ctx, {
        statementLineId: 'line-1',
        sourceType: 'SUPPLIER_PAYMENT',
        sourceId: 'sup-pay-1',
        allocatedAmount: '0.30',
        currency: 'THB',
      }),
      UnprocessableEntityException,
    );
    assert.equal(repo.createMatch.mock.calls.length, 0);
  });

  it('hands the confirm to the repository, which writes the match and the line\'s status together', async () => {
    const repo = makeRepo({
      listMatchesByLine: mock.fn(async () => [{ status: 'CONFIRMED', allocatedAmount: '0.10' }]),
    });
    const uc = new ConfirmMatchUseCase(repo as any, audit as any, outbox as any);
    await uc.execute(ctx, {
      statementLineId: 'line-1',
      sourceType: 'CUSTOMER_PAYMENT',
      sourceId: 'pay-1',
      allocatedAmount: '0.20',
      currency: 'THB',
    });
    assert.deepEqual(repo.createMatch.mock.calls.map((call: any) => call.arguments[0]), [{
      companyId: 'co-1', bankAccountId: 'ba-1', statementLineId: 'line-1', sourceType: 'CUSTOMER_PAYMENT', sourceId: 'pay-1',
      sourceDisplayNumber: undefined, allocatedAmount: '0.20', currency: 'THB', overrideReason: undefined,
    }]);
    // Before: the status was worked out here, from the matches read before the write, and saved by a second
    // call after the match. A void in between left the line reading matched with nothing matched to it.
    assert.equal(repo.updateStatementLineStatus.mock.calls.length, 0);
  });
});

// Review 2026-10-01: the source of a match was stored unread, so a candidate list a few minutes old
// confirmed a match against a claim payment voided since. Real PostgreSQL proves the two serialize
// (prisma-reimbursement.repository.draft-submit-race.spec.ts); this pins what the confirm reads and writes.
describe('PrismaBankingRepository.createMatch', () => {
  function harness(payment: { reimbursementRequestId: string; status: string } | null, standing: string[] = []) {
    const calls: any[] = [];
    const tx = {
      reimbursementPayment: { findFirst: async ({ where }: any) => { calls.push(['payment', where]); return payment; } },
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { calls.push(['lock', strings.join('?'), values]); return 1; },
      bankReconciliationMatch: { create: async ({ data }: any) => {
        calls.push(['match', data.sourceType, data.sourceId, data.status]);
        standing.push(data.allocatedAmount);
        return { id: 'match-new', ...data, createdAt: new Date(), updatedAt: new Date() };
      } },
      bankStatementLine: {
        findFirstOrThrow: async () => ({ signedAmount: '-100.0000', matches: standing.map((allocatedAmount) => ({ allocatedAmount })) }),
        update: async ({ where, data }: any) => { calls.push(['line', where.id, data.status]); },
      },
    };
    let attempts = 0;
    const client = { $transaction: async (work: (transaction: any) => Promise<unknown>, options: any) => {
      attempts += 1;
      assert.equal(options.isolationLevel, 'Serializable');
      return work(tx);
    } };
    return { repo: new PrismaBankingRepository({ client } as any), calls, attempts: () => attempts };
  }
  const input = (overrides: Record<string, unknown> = {}) => ({
    companyId: 'co-1', bankAccountId: 'ba-1', statementLineId: 'line-1', sourceType: 'REIMBURSEMENT_PAYMENT', sourceId: 'rbpay-1',
    allocatedAmount: '100.0000', currency: 'THB', ...overrides,
  }) as any;

  it('takes a claim payment only while it is RECORDED, read under the lock its void takes', async () => {
    const h = harness({ reimbursementRequestId: 'rb-1', status: 'RECORDED' });
    assert.equal((await h.repo.createMatch(input())).status, 'CONFIRMED');
    assert.deepEqual(h.calls, [
      ['payment', { id: 'rbpay-1', companyId: 'co-1' }],
      // The key voidPaymentTrueReversal locks: company, claim, "reimbursement-payment".
      ['lock', 'SELECT pg_advisory_xact_lock(hashtext(?))', ['co-1:rb-1:reimbursement-payment']],
      ['match', 'REIMBURSEMENT_PAYMENT', 'rbpay-1', 'CONFIRMED'],
      ['line', 'line-1', 'MATCHED'],
    ]);
  });

  it('refuses a claim payment that was voided, or that this company does not have, and writes nothing', async () => {
    for (const payment of [{ reimbursementRequestId: 'rb-1', status: 'VOIDED' }, null]) {
      const h = harness(payment);
      await assert.rejects(() => h.repo.createMatch(input()),
        (error: any) => error.getStatus() === 409 && error.getResponse().code === 'bank_match_payment_not_recorded');
      assert.deepEqual(h.calls.filter(([kind]) => kind === 'match' || kind === 'line'), [], JSON.stringify(payment));
      assert.equal(h.attempts(), 1, 'a refusal is not retried');
    }
  });

  it('reads no claim payment for any other source, and derives the status from every match that stands', async () => {
    const h = harness(null, ['40.0000']);
    await h.repo.createMatch(input({ sourceType: 'EXPENSE_PAYMENT', sourceId: 'exp-pay-1', allocatedAmount: '30.0000' }));
    assert.deepEqual(h.calls, [['match', 'EXPENSE_PAYMENT', 'exp-pay-1', 'CONFIRMED'], ['line', 'line-1', 'PARTIALLY_MATCHED']]);
  });

  it('answers a confirm that lost a serialization conflict as "the match changed", after the shared retries', async () => {
    let attempts = 0;
    const client = { $transaction: async () => { attempts += 1; throw Object.assign(new Error('write conflict'), { code: 'P2034' }); } };
    await assert.rejects(() => new PrismaBankingRepository({ client } as any).createMatch(input()),
      (error: any) => error.getStatus() === 409 && error.message === 'bank_match_state_changed');
    assert.equal(attempts, 5);
  });
});

describe('VoidMatchUseCase', () => {
  it('blocks unmatching a line locked by completed reconciliation', async () => {
    const repo = makeRepo({
      isStatementLineLockedByCompletedReconciliation: mock.fn(async () => true),
    });
    const uc = new VoidMatchUseCase(repo as any, audit as any, outbox as any);
    await assert.rejects(() => uc.execute(ctx, 'match-1'), UnprocessableEntityException);
    assert.equal(repo.updateMatchStatus.mock.calls.length, 0);
  });
});

describe('ListMatchCandidatesUseCase', () => {
  const readCtx = { ...ctx, permissions: ['bank.match.read'] };
  const candidate = {
    sourceType: 'CUSTOMER_PAYMENT', sourceId: 'pay-1', companyId: 'co-1',
    direction: 'DEPOSIT', paymentDate: '2026-07-01', amount: '100.00',
    remainingUnmatchedAmount: '100.00', currency: 'THB', status: 'RECORDED', webUrl: '/x',
  };

  function makeListRepo() {
    return {
      findBankAccountById: mock.fn(async () => ({ id: 'ba-1', companyId: 'co-1' })),
      listStatementLines: mock.fn(async (_c: string, _b: string, status: string) =>
        status === 'UNMATCHED' ? [depositLine] : []),
      listMatchesByLine: mock.fn(async () => []),
    };
  }

  it('returns open lines, their matches, and source candidates together', async () => {
    const repo = makeListRepo();
    const sourceQuery = { listCandidates: mock.fn(async () => [candidate]) };
    const uc = new ListMatchCandidatesUseCase(repo as any, sourceQuery as any);
    const result = await uc.execute(readCtx, 'ba-1');
    assert.equal(result.lines.length, 1);
    assert.deepEqual(result.matchesByLine['line-1'], []);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].sourceId, 'pay-1');
    assert.equal((sourceQuery.listCandidates.mock.calls[0] as any).arguments[0], 'co-1');
  });

  it('refuses without bank.match.read', async () => {
    const repo = makeListRepo();
    const sourceQuery = { listCandidates: mock.fn(async () => []) };
    const uc = new ListMatchCandidatesUseCase(repo as any, sourceQuery as any);
    await assert.rejects(() => uc.execute({ ...ctx, permissions: [] }, 'ba-1'), ForbiddenException);
    assert.equal(sourceQuery.listCandidates.mock.calls.length, 0);
  });
});
