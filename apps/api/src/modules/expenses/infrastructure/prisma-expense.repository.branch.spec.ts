import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PrismaExpenseRepository, assertActiveExpenseBranch } from './prisma-expense.repository';
import { InitReceiptUploadUseCase } from '../application/use-cases/expense-upload.use-case';

const rejectsCode = (code: string) => (error: any) => error.getStatus() === 422 && error.getResponse().code === code;

describe('expense source branch is mandatory', () => {
  it('defaults only one active branch and never guesses among multiple branches', async () => {
    const queries: any[] = [];
    let branches = [{ id: 'only-branch' }];
    const repo = new PrismaExpenseRepository({ client: { branch: {
      findMany: async (query: any) => { queries.push(query); return branches; },
      findFirst: async () => ({ id: 'selected-branch' }),
    } } } as any);
    assert.equal(await repo.resolveCreateBranchId('co-1', {}), 'only-branch');
    assert.equal(await repo.resolveCreateBranchId('co-1', {}, 'selected-branch'), 'selected-branch');
    branches = [{ id: 'b1' }, { id: 'b2' }];
    await assert.rejects(() => repo.resolveCreateBranchId('co-1', {}), rejectsCode('TRANSACTION_BRANCH_REQUIRED'));
    branches = [];
    await assert.rejects(() => repo.resolveCreateBranchId('co-1', { branchIds: [] }), rejectsCode('TRANSACTION_BRANCH_REQUIRED'));
    assert.deepEqual(queries.at(-1).where, { companyId: 'co-1', status: 'ACTIVE', id: { in: [] } });
    await assert.rejects(() => repo.resolveCreateBranchId('co-1', { branchIds: ['b1'] }, 'b2'), /branch scope/);
  });

  for (const captureSource of ['WEB_MANUAL', 'WEB_UPLOAD', 'LINE_UPLOAD']) {
    for (const branchId of [undefined, null, '', '  ']) {
      it(`rejects ${captureSource} with branch ${JSON.stringify(branchId)} before any write`, async () => {
        let writes = 0;
        const repo = new PrismaExpenseRepository({ client: { expenseRecord: { create: async () => { writes++; } } } } as any);
        await assert.rejects(() => repo.createExpense({ companyId: 'co-1', branchId, captureSource } as any), rejectsCode('TRANSACTION_BRANCH_REQUIRED'));
        assert.equal(writes, 0);
      });
    }
  }

  it('validates that the source branch is active and belongs to this company', async () => {
    const queries: unknown[] = [];
    const db = { branch: { findFirst: async (query: unknown) => { queries.push(query); return { id: 'branch-1' }; } } };
    await assertActiveExpenseBranch(db as any, 'co-1', 'branch-1');
    assert.deepEqual(queries, [{ where: { id: 'branch-1', companyId: 'co-1', status: 'ACTIVE' }, select: { id: true } }]);
  });

  it('rejects missing, foreign-company and inactive branches without creating an expense', async () => {
    let writes = 0;
    const repo = new PrismaExpenseRepository({ client: {
      branch: { findFirst: async () => null },
      expenseRecord: { create: async () => { writes++; } },
    } } as any);
    await assert.rejects(() => repo.createExpense({ companyId: 'co-1', branchId: 'not-an-active-company-branch' } as any), rejectsCode('TRANSACTION_BRANCH_INVALID'));
    assert.equal(writes, 0);
  });

  it('rejects clearing a saved branch', async () => {
    const repo = new PrismaExpenseRepository({ client: {} } as any);
    for (const branchId of [null, '', '  ']) {
      await assert.rejects(() => repo.updateExpense({ companyId: 'co-1', id: 'exp-1', branchId } as any), rejectsCode('TRANSACTION_BRANCH_REQUIRED'));
    }
  });

  it('rejects an unassigned receipt before creating its storage intent or draft', async () => {
    let intents = 0;
    const repo = new PrismaExpenseRepository({ client: { company: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null, planTerm: null }) }, branch: { findMany: async () => [{ id: 'b1' }, { id: 'b2' }] } } } as any);
    const upload = new InitReceiptUploadUseCase(repo,
      { execute: async () => { intents++; } } as any,
      { log: async () => undefined } as any,
      { execute: async () => ({ mode: 'SIMPLE' }) } as any,
      { assertLaunchRouteOpen: async () => undefined } as any);
    await assert.rejects(() => upload.execute({
      companyId: 'co-1', permissions: ['expense.receipt.upload'], scopes: {},
    } as any, { originalFileName: 'receipt.png', mimeType: 'image/png', byteSize: 100, expenseDate: '2026-08-27' }), rejectsCode('TRANSACTION_BRANCH_REQUIRED'));
    assert.equal(intents, 0);
  });
});
