import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { GetExpenseUseCase, ListExpensesUseCase } from './expense-draft.use-case';
import { ListCompanySubstituteReceiptsUseCase } from './substitute-receipt.use-case';
import { expenseRelatedToUserWhere, PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { ListExpenseCategoriesUseCase } from './expense-upload.use-case';

const ctx = {
  requestId: 'request-1', authSubject: 'actor-1', userId: 'actor-1', companyId: 'company-1',
  membershipId: 'member-1', roles: [], permissions: ['expense.read_related'],
  scopes: { branchIds: ['branch-1'] }, authProvider: 'watchdog',
} as any;

const detail = {
  id: 'expense-1', companyId: 'company-1', branchId: 'branch-1', createdByUserId: 'creator-1',
  substituteReceiptEvidence: null,
} as any;

describe('expense related-view ABAC', () => {
  it('allows a persisted related actor and denies an unrelated member', async () => {
    let related = true;
    const repo = {
      findByIdWithRelations: async () => detail,
      isUserRelatedToExpense: async (_companyId: string, _expenseId: string, userId: string, scopes: unknown) => {
        assert.equal(userId, 'actor-1');
        assert.deepEqual(scopes, { branchIds: ['branch-1'] });
        return related;
      },
    } as any;
    const useCase = new GetExpenseUseCase(repo);
    assert.equal((await useCase.execute(ctx, detail.id)).id, detail.id);

    related = false;
    await assert.rejects(() => useCase.execute(ctx, detail.id), ForbiddenException);
  });

  it('passes related-user scope to the list repository instead of widening to company rows', async () => {
    let captured: unknown[] = [];
    const repo = {
      listExpenses: async (...args: unknown[]) => {
        captured = args;
        return { data: [], total: 0, page: 1, pageSize: 20 };
      },
    } as any;
    await new ListExpensesUseCase(repo).execute(ctx, { page: 1, pageSize: 20 });
    assert.equal((captured[0] as any).createdByUserId, undefined);
    assert.deepEqual(captured[1], ctx.scopes);
    assert.equal(captured[2], ctx.userId);
  });

  // Item 1 (spec R-A1 row 18, eval: 15 turns): the AI answer must state when a read is scoped to
  // less than the whole company. `readAiSummary`/`readAiBreakdown` now echo the SAME own/related/
  // company classification `aiReadScope` already uses to build the repository filter/scope above,
  // so a tool adapter can read it off the snapshot without re-deriving the permission logic.
  it('readAiSummary echoes accessScope: related for a read_related-only caller (same ctx as above)', async () => {
    const repo = { readAiExpenseSummary: async () => ({ total: 0 }) } as any;
    const result = await new ListExpensesUseCase(repo).readAiSummary(ctx, { fromDate: '2026-08-01', toDate: '2026-08-31' }, 20);
    assert.equal((result as any).accessScope, 'related');
  });

  it('readAiSummary echoes accessScope: own for a read_own-only caller', async () => {
    const repo = { readAiExpenseSummary: async () => ({ total: 0 }) } as any;
    const ownCtx = { ...ctx, permissions: ['expense.read_own'] };
    const result = await new ListExpensesUseCase(repo).readAiSummary(ownCtx, { fromDate: '2026-08-01', toDate: '2026-08-31' }, 20);
    assert.equal((result as any).accessScope, 'own');
  });

  it('readAiSummary echoes accessScope: company for a full expense.read caller, even with read_own too', async () => {
    const repo = { readAiExpenseSummary: async () => ({ total: 0 }) } as any;
    const fullCtx = { ...ctx, permissions: ['expense.read', 'expense.read_own'] };
    const result = await new ListExpensesUseCase(repo).readAiSummary(fullCtx, { fromDate: '2026-08-01', toDate: '2026-08-31' }, 20);
    assert.equal((result as any).accessScope, 'company');
  });

  it('readAiBreakdown echoes the same accessScope classification as readAiSummary', async () => {
    const repo = { readAiExpenseBreakdown: async () => ({}) } as any;
    const ownCtx = { ...ctx, permissions: ['expense.read_own'] };
    const result = await new ListExpensesUseCase(repo).readAiBreakdown(ownCtx, { fromDate: '2026-08-01', toDate: '2026-08-31' });
    assert.equal((result as any).accessScope, 'own');
  });

  it('scopes the substitute-receipt hub to all persisted relations, not only the payer', async () => {
    let capturedScope: any;
    const repo = {
      listCompanySubstituteReceipts: async (_companyId: string, _filter: unknown, scope: unknown) => {
        capturedScope = scope;
        return { rows: [], total: 0 };
      },
    } as any;
    await new ListCompanySubstituteReceiptsUseCase(repo).execute(ctx, { page: 1, pageSize: 20 });
    assert.deepEqual(capturedScope, {
      branchIds: ['branch-1'], onlyPayerUserId: null, relatedUserId: 'actor-1',
    });
  });

  it('covers direct, payment, substitute-receipt, and source-claim actors in the repository predicate', () => {
    const json = JSON.stringify(expenseRelatedToUserWhere('actor-1'));
    for (const field of [
      'createdByUserId', 'reviewedByUserId', 'payments', 'preparedByUserId', 'payerUserId',
      'approverUserId', 'issuedByUserId', 'sourceReimbursementRequest', 'currentApproverUserId',
      'financeReviewedByUserId', 'claimSignatures',
    ]) assert.match(json, new RegExp(`"${field}"`));
  });

  it('lets a related viewer load the category labels needed by the read-only detail', async () => {
    const repo = { listCategories: async () => [{ id: 'category-1' }] } as any;
    assert.deepEqual(await new ListExpenseCategoriesUseCase(repo).execute(ctx), [{ id: 'category-1' }]);
  });

  it('keeps branch, relation, and month OR clauses isolated under AND', async () => {
    let capturedWhere: any;
    const delegate = {
      findMany: async ({ where }: any) => { capturedWhere = where; return []; },
      count: async () => 0,
    };
    const prisma = {
      client: {
        expenseSubstituteReceiptEvidence: delegate,
        $transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
      },
    } as any;
    await new PrismaExpenseRepository(prisma).listCompanySubstituteReceipts(
      'company-1',
      { yearMonth: '2026-08', page: 1, pageSize: 20 },
      { branchIds: ['branch-1'], onlyPayerUserId: null, relatedUserId: 'actor-1' },
    );

    assert.equal(capturedWhere.OR, undefined);
    assert.equal(capturedWhere.AND.length, 3);
    assert.deepEqual(capturedWhere.AND[0].OR, [
      { branchId: { in: ['branch-1'] } }, { branchId: null },
    ]);
    assert.ok(capturedWhere.AND[1].OR.some((clause: any) => clause.approverUserId === 'actor-1'));
    assert.ok(capturedWhere.AND[2].OR.some((clause: any) => clause.paymentDate));
  });

  it('orders upload-range lists by newest intake before applying the page limit', async () => {
    let capturedFindMany: any;
    const prisma = {
      client: {
        expenseRecord: {
          findMany: async (input: any) => { capturedFindMany = input; return []; },
          count: async () => 0,
        },
      },
    } as any;

    await new PrismaExpenseRepository(prisma).listExpenses({
      companyId: 'company-1', uploadedFromDate: '2026-08-01', uploadedToDate: '2026-08-31', pageSize: 200,
    }, { branchIds: ['branch-1'] }, 'actor-1');

    assert.deepEqual(capturedFindMany.orderBy, [{ uploadedAt: 'desc' }, { id: 'desc' }]);
    assert.equal(capturedFindMany.take, 200);
    assert.equal(capturedFindMany.where.companyId, 'company-1');
    assert.deepEqual(capturedFindMany.where.OR, [
      { branchId: { in: ['branch-1'] } }, { branchId: null },
    ]);
    assert.equal(capturedFindMany.where.AND.length, 1);
    assert.match(JSON.stringify(capturedFindMany.where.AND[0]), /"createdByUserId":"actor-1"/);
    assert.deepEqual(capturedFindMany.where.uploadedAt, {
      gte: new Date('2026-07-31T17:00:00.000Z'),
      lt: new Date('2026-08-31T17:00:00.000Z'),
    });
    assert.equal(capturedFindMany.where.expenseDate, undefined);
  });

  it('keeps document-date ordering for callers without a dedicated upload-date lens', async () => {
    let capturedFindMany: any;
    const prisma = {
      client: {
        expenseRecord: {
          findMany: async (input: any) => { capturedFindMany = input; return []; },
          count: async () => 0,
        },
      },
    } as any;

    await new PrismaExpenseRepository(prisma).listExpenses({ companyId: 'company-1', pageSize: 20 });

    assert.deepEqual(capturedFindMany.orderBy, [{ expenseDate: 'desc' }, { id: 'desc' }]);

    await new PrismaExpenseRepository(prisma).listExpenses({
      companyId: 'company-1', fromDate: '2026-08-01', uploadedFromDate: '2026-08-01', pageSize: 20,
    });

    assert.deepEqual(capturedFindMany.orderBy, [{ expenseDate: 'desc' }, { id: 'desc' }]);
  });
});
