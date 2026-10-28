import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bangkokMonthKey } from '../../../line-ai/application/company-ai-usage-meter';
import { GetExpenseReadStatusUseCase } from './expense-capture-read-status.use-case';
import { ExpenseCaptureAccessService } from './expense-capture-group.use-case';

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

function harness(options: { jobs?: unknown[]; expense?: Record<string, unknown> | null; related?: boolean; observation?: { payloadJson: unknown } | null; freeSuccesses?: number; eventSucceeded?: boolean } = {}) {
  const queries: any[] = [];
  const prisma = {
    client: {
      companyOcrUsageEvent: {
        findFirst: async () => options.eventSucceeded ? { id: 'free-event' } : null,
        findMany: async () => Array.from({ length: options.freeSuccesses ?? 0 }, () => ({ succeededAt: new Date() })),
      },
      expenseCaptureReadJob: {
        findMany: async (args: any) => { queries.push(args); return options.jobs ?? [job()]; },
      },
      // The expense lane also reads the job's assembled observation for the multi-document verdict.
      expenseCaptureObservation: {
        findFirst: async () => (options.observation === undefined ? null : options.observation),
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

  /**
   * A47 / IG13. Polling is how a customer watches a read they already paid for finish. It is a
   * READ, so the intake flag may not touch it — proven against the REAL access service with
   * `EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED=false`, not the fake one the other cases use.
   */
  it('still answers while new intake is disabled (A47)', async () => {
    const { uc } = harness();
    const capture = {
      client: {},
      findGroup: async () => ({ id: 'group-1', companyId: 'co-1', branchId: null, createdByUserId: 'user-1' }),
    } as any;
    const closed = new ExpenseCaptureAccessService(capture, { expenseCaptureGroupIntakeEnabled: false } as any);
    assert.throws(() => closed.assertIntakeOpen(), 'the same service really is refusing new evidence');

    const result = await new GetExpenseReadStatusUseCase((uc as any).prisma, closed, (uc as any).expenses).group(ctx, 'group-1');
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0]?.status, 'READING', 'a read in flight keeps reporting its progress');
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

  /**
   * Appendix §25: `multiDocument` no longer means "go and review a group" — it means the engine
   * already split the file, and the ids it created come off the JOB's own checkpoint. The FIRST
   * document is applied either way, so `applied` says what it says.
   */
  it('reports the document count and the drafts the auto-split created', async () => {
    const multi = harness({
      expense: { id: 'expense-1', branchId: null, createdByUserId: 'user-2', aiVerifiedAt: new Date() },
      jobs: [job({ status: 'DONE', checkpointJson: { splitExpenseIds: { d2: 'exp-2', d3: 'exp-3' } } })],
      observation: { payloadJson: { multiDocument: true, documents: [{ ref: 'd1' }, { ref: 'd2' }, { ref: 'd3' }] } },
    });
    const split = await multi.uc.expense(ctx, 'expense-1');
    assert.equal(split.files[0]?.multiDocument, true);
    assert.equal(split.files[0]?.documentCount, 3);
    assert.deepEqual(split.files[0]?.splitExpenseIds, ['exp-2', 'exp-3']);
    assert.equal(split.files[0]?.applied, true, 'the first document landed on this draft');

    const applied = harness({
      expense: { id: 'expense-1', branchId: null, createdByUserId: 'user-2', aiVerifiedAt: new Date() },
      jobs: [job({ status: 'DONE' })],
      observation: { payloadJson: { multiDocument: false, documents: [{ ref: 'd1' }] } },
    });
    const done = await applied.uc.expense(ctx, 'expense-1');
    assert.equal(done.files[0]?.multiDocument, false);
    assert.equal(done.files[0]?.documentCount, 1);
    assert.deepEqual(done.files[0]?.splitExpenseIds, []);
    assert.equal(done.files[0]?.applied, true);
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

it('projects successful free allowance only for the exact admitted event and current Bangkok month', async () => {
  const checkpoint = { ocrQuotaSource: 'FREE_MONTHLY_3', ocrEventId: 'free-event', ocrMonthKey: bangkokMonthKey() };
  const h = harness({ jobs: [job({ status: 'DONE', checkpointJson: checkpoint })], eventSucceeded: true, freeSuccesses: 3 });
  const result = await h.uc.expense(ctx, 'expense-1');
  assert.equal(result.freeAllowance?.usedCount, 3);
  assert.equal(result.freeAllowance?.source, 'FREE_MONTHLY_3');
  for (const over of [
    { checkpointJson: { ...checkpoint, ocrMonthKey: '2000-01' } },
    { checkpointJson: { ...checkpoint, ocrQuotaSource: null } },
  ]) {
    const stale = harness({ jobs: [job({ status: 'DONE', ...over })], eventSucceeded: true, freeSuccesses: 3 });
    assert.equal((await stale.uc.expense(ctx, 'expense-1')).freeAllowance, undefined);
  }
  const pending = harness({ jobs: [job({ status: 'READING', checkpointJson: checkpoint })], eventSucceeded: false });
  assert.equal((await pending.uc.expense(ctx, 'expense-1')).freeAllowance, undefined);
});
