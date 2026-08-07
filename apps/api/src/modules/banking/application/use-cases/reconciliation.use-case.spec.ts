import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { UnprocessableEntityException } from '@nestjs/common';
import { CompleteReconciliationSessionUseCase, CreateReconciliationSessionUseCase } from './reconciliation.use-case';
import type { RequestContext } from '@watchdog-bms/contracts';

const ctx: RequestContext = {
  requestId: 'req-1',
  authSubject: 'sub-1',
  userId: 'user-1',
  companyId: 'co-1',
  membershipId: 'mem-1',
  roles: ['ACCOUNTANT'],
  permissions: ['bank.reconciliation.create', 'bank.reconciliation.complete'],
  scopes: {},
  authProvider: 'dev',
};

const account = {
  id: 'ba-1',
  companyId: 'co-1',
  displayName: 'Main bank',
  accountType: 'BANK_CHECKING',
  currency: 'THB',
  ledgerAccountId: 'ledger-bank',
  openingBalanceAmount: '0.00',
  status: 'ACTIVE',
  createdByUserId: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const session = {
  id: 'rec-1',
  companyId: 'co-1',
  bankAccountId: 'ba-1',
  sessionNumber: 'REC-1',
  periodStartDate: new Date('2026-06-01T00:00:00.000Z'),
  periodEndDate: new Date('2026-06-30T00:00:00.000Z'),
  openingStatementBalanceAmount: '100.00',
  closingStatementBalanceAmount: '100.00',
  calculatedStatementMovementAmount: '0.00',
  calculatedBookMovementAmount: '0.00',
  calculatedBookBalanceAmount: '100.00',
  differenceAmount: '0.00',
  currency: 'THB',
  status: 'DRAFT',
  createdByUserId: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    findBankAccountById: mock.fn(async () => account),
    createReconciliationSession: mock.fn(async (input: any) => ({ ...session, ...input, id: 'rec-new', status: 'DRAFT' })),
    findReconciliationSessionById: mock.fn(async () => session),
    listStatementLinesForPeriod: mock.fn(async () => []),
    listMatchesByLine: mock.fn(async () => []),
    hasClosedAccountingPeriodInRange: mock.fn(async () => false),
    completeReconciliationSession: mock.fn(async () => ({ ...session, status: 'COMPLETED' })),
    ...overrides,
  };
}

const audit = { log: mock.fn(async () => {}) };
const outbox = { append: mock.fn(async () => {}) };

describe('CreateReconciliationSessionUseCase', () => {
  it('calculates initial movement without floating-point drift', async () => {
    const repo = makeRepo();
    const uc = new CreateReconciliationSessionUseCase(repo as any, audit as any);
    await uc.execute(ctx, {
      bankAccountId: 'ba-1',
      periodStartDate: '2026-06-01',
      periodEndDate: '2026-06-30',
      openingStatementBalanceAmount: '90071992547409.91',
      closingStatementBalanceAmount: '90071992547410.01',
      currency: 'THB',
    });
    const input = (repo.createReconciliationSession.mock.calls[0] as any).arguments[0];
    assert.equal(input.calculatedStatementMovementAmount, '0.10');
    assert.equal(input.differenceAmount, '0.10');
  });
});

describe('CompleteReconciliationSessionUseCase', () => {
  it('blocks completion from real DB statement lines even when client sends an empty snapshot', async () => {
    const repo = makeRepo({
      listStatementLinesForPeriod: mock.fn(async () => [{
        id: 'line-1',
        status: 'UNMATCHED',
        ignoredReason: undefined,
      }]),
    });
    const uc = new CompleteReconciliationSessionUseCase(repo as any, audit as any, outbox as any);
    await assert.rejects(() => uc.execute(ctx, 'rec-1', []), UnprocessableEntityException);
    assert.equal(repo.completeReconciliationSession.mock.calls.length, 0);
  });

  it('blocks completion when an overlapping accounting period is closed', async () => {
    const repo = makeRepo({ hasClosedAccountingPeriodInRange: mock.fn(async () => true) });
    const uc = new CompleteReconciliationSessionUseCase(repo as any, audit as any, outbox as any);
    await assert.rejects(() => uc.execute(ctx, 'rec-1', []), UnprocessableEntityException);
    assert.equal(repo.completeReconciliationSession.mock.calls.length, 0);
  });

  it('builds completion snapshot server-side with matched amounts', async () => {
    const repo = makeRepo({
      listStatementLinesForPeriod: mock.fn(async () => [{
        id: 'line-1',
        status: 'MATCHED',
        ignoredReason: undefined,
      }]),
      listMatchesByLine: mock.fn(async () => [
        { status: 'CONFIRMED', allocatedAmount: '0.10' },
        { status: 'CONFIRMED', allocatedAmount: '0.20' },
      ]),
    });
    const uc = new CompleteReconciliationSessionUseCase(repo as any, audit as any, outbox as any);
    await uc.execute(ctx, 'rec-1', []);
    const snapshot = (repo.completeReconciliationSession.mock.calls[0] as any).arguments[3];
    assert.deepEqual(snapshot, [{
      statementLineId: 'line-1',
      statusAtCompletion: 'MATCHED',
      matchedAmountAtCompletion: '0.30',
      ignoredReasonAtCompletion: undefined,
    }]);
  });
});
