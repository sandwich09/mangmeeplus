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

function makeTool(data: Array<ReturnType<typeof expense>>) {
  const listExpenses = {
    execute: async () => ({ data, total: data.length, page: 1, pageSize: 100 }),
  } as any;
  return new ExpenseListRecentTool(listExpenses);
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
  return { tool: new ExpenseListRecentTool(listExpenses), calls };
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
    const result = await makeTool([expense({})]).execute(baseCtx, { branchId: 'branch-1' });

    assert.equal(result.sourceRefs[0]?.webPath, '/companies/c1/expenses?branchId=branch-1');
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
