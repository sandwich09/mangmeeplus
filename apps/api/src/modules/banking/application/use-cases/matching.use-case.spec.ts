import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { ConfirmMatchUseCase, VoidMatchUseCase, ListMatchCandidatesUseCase } from './matching.use-case';
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

  it('marks a line matched when decimal allocations sum exactly to the line amount', async () => {
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
    assert.equal((repo.updateStatementLineStatus.mock.calls[0] as any).arguments[2], 'MATCHED');
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
