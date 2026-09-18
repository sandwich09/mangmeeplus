import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GetExpenseReadStatusUseCase } from './expense-capture-read-status.use-case';

const ctx = {
  requestId: 'req-1', userId: 'user-1', companyId: 'co-1', membershipId: 'mem-1',
  roles: ['STAFF'], permissions: ['expense.read'], scopes: {}, authProvider: 'watchdog',
} as any;

const job = (patch: Record<string, unknown> = {}) => ({
  fileId: 'file-1', attachmentId: 'att-1', status: 'READING', pausedReason: null, lastErrorCode: null,
  manifestJson: {
    pageCount: 4,
    pages: [{ index: 0, state: 'read' }, { index: 1, state: 'blank' }, { index: 2, state: 'pending' }, { index: 3, state: 'failed' }],
    chunks: [], windows: [], electronicVerification: { status: 'NOT_CHECKED' },
  },
  updatedAt: new Date('2026-09-18T10:00:00.000Z'),
  ...patch,
});

function harness(options: { jobs?: unknown[]; expense?: Record<string, unknown> | null; related?: boolean } = {}) {
  const queries: any[] = [];
  const prisma = {
    client: {
      expenseCaptureReadJob: {
        findMany: async (args: any) => { queries.push(args); return options.jobs ?? [job()]; },
      },
    },
  } as any;
  const access = { loadReadable: async () => ({ id: 'group-1' }) } as any;
  const expenses = {
    findById: async () => (options.expense === undefined
      ? { id: 'expense-1', branchId: null, createdByUserId: 'user-2' }
      : options.expense),
    isUserRelatedToExpense: async () => Boolean(options.related),
  } as any;
  return { uc: new GetExpenseReadStatusUseCase(prisma, access, expenses), queries };
}

describe('read status (appendix §9)', () => {
  it('reports pages the reader finished, never the pages it has yet to open', async () => {
    const { uc } = harness();
    const result = await uc.group(ctx, 'group-1');
    assert.deepEqual(result.files, [{
      fileId: 'file-1', attachmentId: 'att-1', status: 'READING', pagesRead: 2, pageCount: 4,
      pausedReason: null, lastErrorCode: null, updatedAt: '2026-09-18T10:00:00.000Z',
    }]);
  });

  it('carries the paused reason and the failure code the UI turns into Thai', async () => {
    const { uc } = harness({ jobs: [job({ status: 'PAUSED', pausedReason: 'ai_credit', lastErrorCode: 'AI_BUDGET_INSUFFICIENT' })] });
    const [file] = (await uc.group(ctx, 'group-1')).files;
    assert.equal(file?.pausedReason, 'ai_credit');
    assert.equal(file?.lastErrorCode, 'AI_BUDGET_INSUFFICIENT');
  });

  it('reads the expense lane by company and expense, newest job only', async () => {
    const { uc, queries } = harness({ expense: { id: 'expense-1', branchId: null, createdByUserId: 'user-2' } });
    await uc.expense(ctx, 'expense-1');
    assert.deepEqual(queries[0].where, { companyId: 'co-1', expenseId: 'expense-1' });
    assert.deepEqual(queries[0].orderBy, { createdAt: 'desc' });
    assert.equal(queries[0].take, 1);
  });

  it('answers 404 for an expense of another company and 403 outside the branch scope', async () => {
    const missing = harness({ expense: null });
    await assert.rejects(() => missing.uc.expense(ctx, 'expense-1'), /not found/i);

    const otherBranch = harness({ expense: { id: 'expense-1', branchId: 'branch-b', createdByUserId: 'user-1' } });
    await assert.rejects(
      () => otherBranch.uc.expense({ ...ctx, scopes: { branchIds: ['branch-a'] } }, 'expense-1'),
      /branch scope/i,
    );
  });

  it('lets an uploader follow their own record, and refuses a stranger without paying for a query', async () => {
    const own = harness({ expense: { id: 'expense-1', branchId: null, createdByUserId: 'user-1' } });
    const uploader = { ...ctx, permissions: ['expense.receipt.upload'] };
    assert.equal((await own.uc.expense(uploader, 'expense-1')).files.length, 1);

    const stranger = harness({ expense: { id: 'expense-1', branchId: null, createdByUserId: 'someone-else' } });
    await assert.rejects(() => stranger.uc.expense(uploader, 'expense-1'), /Missing permission/);
    assert.deepEqual(stranger.queries, [], 'a refused read never touches the job table');
  });

  it('still answers a related reader, which is the one case worth a second query', async () => {
    const related = harness({ expense: { id: 'expense-1', branchId: null, createdByUserId: 'someone-else' }, related: true });
    const result = await related.uc.expense({ ...ctx, permissions: ['expense.read_related'] }, 'expense-1');
    assert.equal(result.files.length, 1);
  });
});
