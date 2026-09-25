// expense.list_recent answers "ค่าใช้จ่ายเดือนนี้เท่าไหร่" over LINE, so its summary is a money
// path with no UI to sanity-check it. It used to sum every row, including rejected and voided
// documents, while the sibling expense.get_breakdown excluded them — two tools, same period, two
// answers.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExpenseListRecentTool } from './erp-tools.use-case';

const baseCtx = { companyId: 'c1', userId: 'u1', locale: 'th-TH', permissions: ['expense.read'] } as any;

const expense = (over: Record<string, unknown>) => ({
  id: 'e1',
  expenseNumber: 'EXP-2026-0001',
  expenseDate: '2026-08-04',
  vendorNameSnapshot: 'Starbucks Coffee',
  vendorDocumentNumber: '260705-02-17420',
  status: 'NEEDS_REVIEW',
  paymentStatus: 'UNPAID',
  grandTotalAmount: '180.0000',
  paidAmount: '0.0000',
  outstandingAmount: '180.0000',
  ...over,
});

/** Prisma fake for the branch catalog read; honors the ABAC `id: { in }` narrowing the tool sends. */
function fakePrisma(branches: Array<{ id: string; name: string; code?: string }> = []) {
  const rows = branches.map((b) => ({ id: b.id, name: b.name, code: b.code ?? `C-${b.id}` }));
  const allowed = (where: any) => rows.filter((b) => {
    if (where?.companyId && where.companyId !== 'c1') return false;
    if (where?.status && where.status !== 'ACTIVE') return false;
    if (where?.id?.in && !where.id.in.includes(b.id)) return false;
    if (where?.name && where.name !== b.name) return false;
    if (where?.OR && !where.OR.some((term: any) => term.id ? term.id === b.id : term.code === b.code)) return false;
    return true;
  });
  return {
    client: {
      branch: {
        findFirst: async ({ where }: any) => allowed(where)[0] ?? null,
        findMany: async ({ where, take }: any) => allowed(where).slice(0, take),
      },
    },
  } as any;
}

function makeTool(data: Array<ReturnType<typeof expense>>, branches?: Array<{ id: string; name: string }>) {
  const listExpenses = {
    execute: async () => ({ data, total: data.length, page: 1, pageSize: 100 }),
  } as any;
  return new ExpenseListRecentTool(listExpenses, fakePrisma(branches));
}

/** Same tool, but capturing the filter each repository call received. */
function makeFilterCapturingTool(branches?: Array<{ id: string; name: string; code?: string }>) {
  const filters: any[] = [];
  const listExpenses = {
    execute: async (_ctx: unknown, filter: any) => {
      filters.push(filter);
      return { data: [], total: 0, page: 1, pageSize: 100 };
    },
  } as any;
  return { tool: new ExpenseListRecentTool(listExpenses, fakePrisma(branches)), filters };
}

/** Repository that reports more rows than it will ever hand back, so the page loop keeps asking. */
function makePagingTool(reportedTotal: number) {
  const calls: Array<{ page: number; pageSize: number }> = [];
  const listExpenses = {
    execute: async (_ctx: unknown, filter: { page: number; pageSize: number }) => {
      calls.push({ page: filter.page, pageSize: filter.pageSize });
      return { data: [expense({ id: `e${filter.page}` })], total: reportedTotal, page: filter.page, pageSize: 100 };
    },
  } as any;
  return { tool: new ExpenseListRecentTool(listExpenses, fakePrisma()), calls };
}

describe('ExpenseListRecentTool', () => {
  it('refuses a caller with no expense read permission', async () => {
    const result = await makeTool([]).execute({ ...baseCtx, permissions: [] });
    assert.equal(result.status, 'forbidden');
  });

  it('leaves rejected and voided documents out of every money figure', async () => {
    const result = await makeTool([
      expense({ status: 'DRAFT', grandTotalAmount: '90.0000', outstandingAmount: '90.0000' }),
      expense({ id: 'e2', status: 'REJECTED' }),
      expense({ id: 'e3' }),
      expense({ id: 'e4', status: 'VOIDED', paymentStatus: 'VOIDED' }),
      expense({ id: 'e5', status: 'CONFIRMED', paymentStatus: 'PAID', paidAmount: '180.0000', outstandingAmount: '0.0000' }),
    ]).execute(baseCtx);

    const summary = (result.data as any).summary;
    assert.equal(summary.totalAmount, 450);
    assert.equal(summary.draftAmount, 90);
    assert.equal(summary.confirmedAmount, 180);
    assert.equal(summary.paidAmount, 180);
    // A rejected expense keeps its outstandingAmount, so this is the figure that used to claim the
    // company owed money it had already refused.
    assert.equal(summary.unpaidAmount, 270);
    assert.equal(summary.countedItems, 3);
    assert.equal(summary.cancelledCount, 2);
  });

  // The buckets used to be DRAFT-only and CONFIRMED-only, so the whole review pipeline
  // (EXTRACTING / NEEDS_REVIEW / READY_FOR_CONFIRMATION) was money nobody could see.
  it('counts every pending status as work in progress, not just drafts', async () => {
    const result = await makeTool([
      expense({ status: 'DRAFT', grandTotalAmount: '10.0000' }),
      expense({ id: 'e2', status: 'EXTRACTING', grandTotalAmount: '20.0000' }),
      expense({ id: 'e3', status: 'NEEDS_REVIEW', grandTotalAmount: '30.0000' }),
      expense({ id: 'e4', status: 'READY_FOR_CONFIRMATION', grandTotalAmount: '40.0000' }),
      expense({ id: 'e5', status: 'CONFIRMED', grandTotalAmount: '50.0000' }),
      expense({ id: 'e6', status: 'REJECTED', grandTotalAmount: '60.0000' }),
    ]).execute(baseCtx);

    const summary = (result.data as any).summary;
    assert.equal(summary.pendingAmount, 100);
    assert.equal(summary.draftAmount, 10);
    assert.equal(summary.confirmedAmount, 50);
    // Every non-cancelled status lands in exactly one of the two buckets, so the parts add up.
    assert.equal(summary.pendingAmount + summary.confirmedAmount, summary.totalAmount);
  });

  it('reports the counted basis as the total so the headline agrees with the money figures', async () => {
    const result = await makeTool([
      expense({}),
      expense({ id: 'e2', status: 'REJECTED' }),
    ]).execute(baseCtx);

    const data = result.data as any;
    // The unfiltered record count (2) contradicted a summary that excludes the rejected row.
    assert.equal(data.total, 1);
    assert.equal(data.summary.countedItems, 1);
    assert.equal(data.summary.cancelledCount, 1);
    assert.equal(data.truncated, undefined);
    // The listing itself still shows the rejected row — it is real, it just is not spend.
    assert.deepEqual(data.items.map((i: { status: string }) => i.status), ['NEEDS_REVIEW', 'REJECTED']);
    // No branch asked for, no branch in the link: the web list opens on the same all-branches scope.
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/c1/expenses');
  });

  // A branch-scoped answer used to link to the bare expenses page, so the web landed on every
  // branch and disagreed with the figures the user had just read.
  it('carries the branch filter into the web link', async () => {
    const result = await makeTool([expense({})], [{ id: 'branch-1', name: 'สาขาหนึ่ง' }])
      .execute(baseCtx, { branchId: 'branch-1' });

    assert.equal(result.sourceRefs[0]?.webPath, '/companies/c1/expenses?branchId=branch-1');
  });

  // Live UAT 2026-08-29: the model passed the branch NAME the user said, the raw value filtered
  // nothing and reached the link, and the web (correctly) ignored a non-id. Names must resolve.
  it('resolves a branch name to its id for both the filter and the web link', async () => {
    const { tool, filters } = makeFilterCapturingTool([{ id: 'branch-1', name: 'สาธุประดิษฐ์' }]);
    const result = await tool.execute(baseCtx, { branchId: 'สาธุประดิษฐ์' });

    assert.equal(filters[0]?.branchId, 'branch-1');
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/c1/expenses?branchId=branch-1');
  });

  it('resolves a branch code the same way', async () => {
    const { tool, filters } = makeFilterCapturingTool([{ id: 'branch-1', name: 'สาธุประดิษฐ์', code: 'STP' }]);
    const result = await tool.execute(baseCtx, { branchId: 'STP' });

    assert.equal(filters[0]?.branchId, 'branch-1');
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/c1/expenses?branchId=branch-1');
  });

  it('asks for a disambiguating branch code when exact names collide', async () => {
    const { tool, filters } = makeFilterCapturingTool([
      { id: 'branch-1', name: 'สาขากลาง', code: 'A' },
      { id: 'branch-2', name: 'สาขากลาง', code: 'B' },
    ]);
    const result = await tool.execute(baseCtx, { branchId: 'สาขากลาง' });

    assert.equal(filters.length, 0);
    assert.deepEqual((result.data as any).availableBranches, [
      { id: 'branch-1', name: 'สาขากลาง', code: 'A' },
      { id: 'branch-2', name: 'สาขากลาง', code: 'B' },
    ]);
    assert.equal((result.data as any).branchAmbiguous, 'สาขากลาง');
  });

  it('reports branch lookup limits instead of implying a requested branch does not exist', async () => {
    const branches = Array.from({ length: 101 }, (_, index) => ({
      id: `branch-${index}`, name: `สาขา ${index}`, code: `B-${index}`,
    }));
    const { tool, filters } = makeFilterCapturingTool(branches);
    const result = await tool.execute(baseCtx, { branchId: 'missing-name' });

    assert.equal(filters.length, 0);
    assert.equal((result.data as any).branchLookupLimited, true);
    assert.equal((result.data as any).availableBranches.length, 100);
  });

  it('asks when the requested branch text collides with another branch identifier', async () => {
    const { tool, filters } = makeFilterCapturingTool([
      { id: 'STP', name: 'สาขาหนึ่ง', code: 'A' },
      { id: 'branch-2', name: 'สาขาสอง', code: 'STP' },
    ]);
    const result = await tool.execute(baseCtx, { branchId: 'STP' });

    assert.equal(filters.length, 0);
    assert.equal((result.data as any).branchAmbiguous, 'STP');
  });

  it('does not widen an incomplete or invalid date range to 1970 or the current month', async () => {
    const { tool, filters } = makeFilterCapturingTool();
    for (const input of [
      { fromDate: '2026-07-01' },
      { toDate: '2026-07-31' },
      { fromDate: '2026-07-40', toDate: '2026-07-31' },
      { fromDate: '2026-08-01', toDate: '2026-07-31' },
    ]) {
      const result = await tool.execute(baseCtx, input);
      assert.equal(result.status, 'error');
      assert.equal(result.errorCode, 'INVALID_EXPENSE_PERIOD');
    }
    assert.equal(filters.length, 0);
  });

  // Typos and partial wording are the model's job to reconcile — the tool hands back the real
  // catalog instead of answering a confident zero for a branch that exists under another spelling.
  it('returns the branch catalog instead of records when the branch cannot be resolved', async () => {
    const { tool, filters } = makeFilterCapturingTool([{ id: 'branch-1', name: 'สาธุประดิษฐ์' }]);
    const result = await tool.execute(baseCtx, { branchId: 'สาธุประดิด' });

    assert.equal(filters.length, 0);
    const data = result.data as any;
    assert.equal(data.branchUnresolved, 'สาธุประดิด');
    assert.deepEqual(data.availableBranches, [{ id: 'branch-1', code: 'C-branch-1', name: 'สาธุประดิษฐ์' }]);
    assert.deepEqual(result.sourceRefs, []);
  });

  it('keeps branches outside the caller branch scope out of the catalog and unresolvable', async () => {
    const { tool, filters } = makeFilterCapturingTool([
      { id: 'branch-1', name: 'สาธุประดิษฐ์' },
      { id: 'branch-2', name: 'บางนา' },
    ]);
    const scopedCtx = { ...baseCtx, branchIds: ['branch-1'] };
    const result = await tool.execute(scopedCtx, { branchId: 'บางนา' });

    assert.equal(filters.length, 0);
    const data = result.data as any;
    assert.equal(data.branchUnresolved, 'บางนา');
    assert.deepEqual(data.availableBranches, [{ id: 'branch-1', code: 'C-branch-1', name: 'สาธุประดิษฐ์' }]);
  });

  it('caps the page loop and flags the answer as truncated', async () => {
    const { tool, calls } = makePagingTool(5000);

    const result = await tool.execute(baseCtx);

    assert.equal(calls.length, 10);
    assert.deepEqual(calls.map((c) => c.page), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal((result.data as any).truncated, true);
  });

  it('does not flag truncation when every page fits inside the cap', async () => {
    const { tool, calls } = makePagingTool(250);

    const result = await tool.execute(baseCtx);

    assert.equal(calls.length, 3);
    assert.equal((result.data as any).truncated, undefined);
  });
});
