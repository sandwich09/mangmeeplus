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
});
