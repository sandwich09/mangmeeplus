// expense.list_recent answers "ค่าใช้จ่ายเดือนนี้เท่าไหร่" over LINE, so its summary is a money
// path with no UI to sanity-check it. It used to sum every row, including rejected and voided
// documents, while the sibling expense.get_breakdown excluded them — two tools, same period, two
// answers.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { ExpenseListRecentTool } from './erp-tools.use-case';
import {
  CATEGORY_NAME_STRIP_PREFIXES,
  VENDOR_NAME_STRIP_PREFIXES,
  normalizeNameQuery,
  resolveBranchCandidate,
  resolveNameCandidate,
} from '../../domain/logic/business-read-source.logic';

const baseCtx = { companyId: 'c1', userId: 'u1', locale: 'th-TH', permissions: ['expense.read'] } as any;

it('R17 older unpaid expenses use a cutoff instead of the current month', async () => {
  const { todayCivilDate } = await import('@watchdog-bms/contracts');
  const h = makeFilterCapturingTool();
  await h.tool.execute(baseCtx, { olderThanMonths: 2, paymentStatus: 'UNPAID' } as any);
  const cutoff = new Date(`${todayCivilDate()}T00:00:00Z`); cutoff.setUTCMonth(cutoff.getUTCMonth() - 2);
  assert.equal(h.filters[0].toDate, cutoff.toISOString().slice(0, 10));
  assert.equal(h.filters[0].fromDate, '0001-01-01');
});

const expense = (over: Record<string, unknown>) => ({
  id: 'e1',
  expenseNumber: 'EXP-2026-0001',
  expenseDate: new Date('2026-08-04T00:00:00.000Z'),
  vendorNameSnapshot: 'Starbucks Coffee',
  vendorDocumentNumber: '260705-02-17420',
  status: 'NEEDS_REVIEW',
  paymentStatus: 'UNPAID',
  currency: 'THB',
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
    if (where?.OR && !where.OR.some((term: any) => (term.id !== undefined && term.id === b.id)
      || (term.code !== undefined && term.code === b.code) || (term.name !== undefined && term.name === b.name))) return false;
    return true;
  });
  return {
    client: {
      company: { findUnique: async () => ({ baseCurrency: 'THB' }) },
      branch: {
        findFirst: async ({ where }: any) => allowed(where)[0] ?? null,
        findMany: async ({ where, take }: any) => allowed(where).slice(0, take),
      },
    },
  } as any;
}

function makeTool(data: Array<ReturnType<typeof expense>>, branches?: Array<{ id: string; name: string }>) {
  const included = data.filter((row) => row.status !== 'REJECTED' && row.status !== 'VOIDED');
  const listExpenses = {
    readAiSummary: async (_ctx: unknown, _filter: unknown, limit: number) => {
      const byCurrency = new Map<string, { count: number; total: Decimal; paid: Decimal; outstanding: Decimal }>();
      const byStatus = new Map<string, { status: string; currency: string; count: number; total: Decimal }>();
      for (const row of included) {
        const currency = String(row.currency);
        const currencyBucket = byCurrency.get(currency) ?? { count: 0, total: new Decimal(0), paid: new Decimal(0), outstanding: new Decimal(0) };
        currencyBucket.count += 1;
        currencyBucket.total = currencyBucket.total.add(String(row.grandTotalAmount));
        currencyBucket.paid = currencyBucket.paid.add(String(row.paidAmount));
        currencyBucket.outstanding = currencyBucket.outstanding.add(String(row.outstandingAmount));
        byCurrency.set(currency, currencyBucket);
        const key = `${row.status}:${currency}`;
        const statusBucket = byStatus.get(key) ?? { status: String(row.status), currency, count: 0, total: new Decimal(0) };
        statusBucket.count += 1;
        statusBucket.total = statusBucket.total.add(String(row.grandTotalAmount));
        byStatus.set(key, statusBucket);
      }
      return {
        asOf: new Date('2026-08-31T12:00:00.000Z'), total: included.length,
        byCurrency: [...byCurrency.entries()].map(([currency, bucket]) => ({
          currency, count: bucket.count, totalAmount: bucket.total.toString(),
          paidAmount: bucket.paid.toString(), outstandingAmount: bucket.outstanding.toString(),
        })),
        byStatus: [...byStatus.values()].map((bucket) => ({
          status: bucket.status, currency: bucket.currency, count: bucket.count, totalAmount: bucket.total.toString(),
        })),
        items: included.slice(0, limit), hasMore: included.length > limit,
        nextCursorSource: included.length > limit
          ? { expenseDate: included[limit - 1]!.expenseDate, id: String(included[limit - 1]!.id) }
          : null,
      };
    },
  } as any;
  return new ExpenseListRecentTool(listExpenses, fakePrisma(branches));
}

/** Same tool, but capturing the filter each repository call received. */
function makeFilterCapturingTool(branches?: Array<{ id: string; name: string; code?: string }>) {
  const filters: any[] = [];
  const listExpenses = {
    readAiSummary: async (_ctx: unknown, filter: any) => {
      filters.push(filter);
      return {
        asOf: new Date('2026-08-31T12:00:00.000Z'), total: 0,
        byCurrency: [{ currency: 'THB', count: 0, totalAmount: '0', paidAmount: '0', outstandingAmount: '0' }],
        byStatus: [], items: [], hasMore: false, nextCursorSource: null,
      };
    },
  } as any;
  return { tool: new ExpenseListRecentTool(listExpenses, fakePrisma(branches)), filters };
}

/** Aggregate population stays complete even when the display rows are bounded. */
function makePagingTool(reportedTotal: number, hasMore: boolean) {
  const calls: Array<{ limit: number; cursor: unknown }> = [];
  const listExpenses = {
    readAiSummary: async (_ctx: unknown, _filter: unknown, limit: number, cursor: unknown) => {
      calls.push({ limit, cursor });
      return {
        asOf: new Date('2026-08-31T12:00:00.000Z'), total: reportedTotal,
        byCurrency: [{ currency: 'THB', count: reportedTotal, totalAmount: String(reportedTotal), paidAmount: '0', outstandingAmount: String(reportedTotal) }],
        byStatus: [{ status: 'NEEDS_REVIEW', currency: 'THB', count: reportedTotal, totalAmount: String(reportedTotal) }],
        items: [expense({})], hasMore,
        nextCursorSource: hasMore ? { expenseDate: new Date('2026-08-04T00:00:00.000Z'), id: 'e1' } : null,
      };
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
    assert.equal(summary.totalAmount, '450');
    assert.equal(summary.draftAmount, '90');
    assert.equal(summary.confirmedAmount, '180');
    assert.equal(summary.paidAmount, '180');
    // A rejected expense keeps its outstandingAmount, so this is the figure that used to claim the
    // company owed money it had already refused.
    assert.equal(summary.unpaidAmount, '270');
    assert.equal(summary.countedItems, 3);
    assert.equal(summary.cancelledCount, 0);
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
    assert.equal(summary.pendingAmount, '100');
    assert.equal(summary.draftAmount, '10');
    assert.equal(summary.confirmedAmount, '50');
    // Every non-cancelled status lands in exactly one of the two buckets, so the parts add up.
    assert.equal(new Decimal(summary.pendingAmount).add(summary.confirmedAmount).toString(), summary.totalAmount);
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
    assert.equal(data.summary.cancelledCount, 0);
    assert.equal(data.truncated, undefined);
    assert.deepEqual(data.items.map((i: { status: string }) => i.status), ['NEEDS_REVIEW']);
    // No branch asked for, no branch in the link: the web list opens on the same all-branches scope.
    assert.match(result.sourceRefs[0]?.webPath!, /^\/companies\/c1\/expenses\?month=\d{4}-\d{2}$/u);
  });

  // Item 1 (spec R-A1 row 18, eval: 15 turns): the tool echoes whatever `accessScope`
  // `ListExpensesUseCase.readAiSummary` reports into `queryApplied.accessScope`, so the formatter/
  // model can state "only your own records" instead of a bare own-scoped total looking company-wide.
  it('echoes a non-company accessScope from readAiSummary into queryApplied', async () => {
    const listExpenses = {
      readAiSummary: async () => ({
        asOf: new Date('2026-08-31T12:00:00.000Z'), total: 0,
        byCurrency: [{ currency: 'THB', count: 0, totalAmount: '0', paidAmount: '0', outstandingAmount: '0' }],
        byStatus: [], items: [], hasMore: false, nextCursorSource: null, accessScope: 'own',
      }),
    } as any;
    const result = await new ExpenseListRecentTool(listExpenses, fakePrisma()).execute(baseCtx);
    assert.equal((result.data as any).queryApplied.accessScope, 'own');
    assert.equal((result as any).queryApplied.accessScope, 'own');
  });

  it('defaults to company scope when the use case predates accessScope (old test doubles/callers)', async () => {
    const result = await makeTool([expense({})]).execute(baseCtx);
    assert.equal((result.data as any).queryApplied.accessScope, 'company');
  });

  // A branch-scoped answer used to link to the bare expenses page, so the web landed on every
  // branch and disagreed with the figures the user had just read.
  it('carries the branch filter into the web link', async () => {
    const result = await makeTool([expense({})], [{ id: 'branch-1', name: 'สาขาหนึ่ง' }])
      .execute(baseCtx, { branchId: 'branch-1' });

    assert.match(result.sourceRefs[0]?.webPath!, /^\/companies\/c1\/expenses\?month=\d{4}-\d{2}&branchId=branch-1$/u);
  });

  // Live UAT 2026-08-29: the model passed the branch NAME the user said, the raw value filtered
  // nothing and reached the link, and the web (correctly) ignored a non-id. Names must resolve.
  it('resolves a branch name to its id for both the filter and the web link', async () => {
    const { tool, filters } = makeFilterCapturingTool([{ id: 'branch-1', name: 'สาธุประดิษฐ์' }]);
    const result = await tool.execute(baseCtx, { branchId: 'สาธุประดิษฐ์' });

    assert.equal(filters[0]?.branchId, 'branch-1');
    assert.match(result.sourceRefs[0]?.webPath!, /^\/companies\/c1\/expenses\?month=\d{4}-\d{2}&branchId=branch-1$/u);
  });

  it('spec §4 R-M1: echoes the resolved branch display name in queryApplied, not the raw id/code/name the caller sent', async () => {
    const { tool } = makeFilterCapturingTool([{ id: 'branch-1', name: 'สาธุประดิษฐ์', code: 'STP' }]);
    const byName = await tool.execute(baseCtx, { branchId: 'สาธุประดิษฐ์' });
    assert.equal(byName.queryApplied?.filters?.['branchName'], 'สาธุประดิษฐ์');
    const byCode = await tool.execute(baseCtx, { branchId: 'STP' });
    assert.equal(byCode.queryApplied?.filters?.['branchName'], 'สาธุประดิษฐ์');
  });

  it('resolves a branch code the same way', async () => {
    const { tool, filters } = makeFilterCapturingTool([{ id: 'branch-1', name: 'สาธุประดิษฐ์', code: 'STP' }]);
    const result = await tool.execute(baseCtx, { branchId: 'STP' });

    assert.equal(filters[0]?.branchId, 'branch-1');
    assert.match(result.sourceRefs[0]?.webPath!, /^\/companies\/c1\/expenses\?month=\d{4}-\d{2}&branchId=branch-1$/u);
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

  // C3 (batch 5c, T-148-b): "ขอดูค่าใช้จ่ายของสาขา 2" sent branchId "2" — the exact id/code/name
  // lookups above all missed it, and the customer got "ยังระบุสาขาที่ต้องการไม่ได้ค่ะ" for a branch
  // that was right there in the list. A normalized contains/trailing-number match now runs first.
  describe('fuzzy branch match after exact lookups miss (C3)', () => {
    it('resolves a bare number to the one branch whose name ends in that number', async () => {
      const { tool, filters } = makeFilterCapturingTool([
        { id: 'branch-1', name: 'สำนักงานใหญ่', code: 'BR1' },
        { id: 'branch-2', name: 'สาขา 2', code: 'BR2' },
      ]);
      const result = await tool.execute(baseCtx, { branchId: '2' });

      assert.equal(filters[0]?.branchId, 'branch-2');
      assert.equal((result.data as any).queryApplied?.filters?.branchName, 'สาขา 2');
    });

    it('resolves a branch name typed without the space the stored name has', async () => {
      const { tool, filters } = makeFilterCapturingTool([{ id: 'branch-2', name: 'สาขา 2', code: 'BR2' }]);
      await tool.execute(baseCtx, { branchId: 'สาขา2' });
      assert.equal(filters[0]?.branchId, 'branch-2');
    });

    it('resolves a branch code typed in a different case', async () => {
      const { tool, filters } = makeFilterCapturingTool([{ id: 'branch-2', name: 'สาขา 2', code: 'BR2' }]);
      await tool.execute(baseCtx, { branchId: 'br2' });
      assert.equal(filters[0]?.branchId, 'branch-2');
    });

    it('reports an ambiguous number match instead of guessing between two branches', async () => {
      const { tool, filters } = makeFilterCapturingTool([
        { id: 'branch-2', name: 'สาขา 2', code: 'BR2' },
        { id: 'branch-12', name: 'คลังสาขา 2', code: 'WH2' },
      ]);
      const result = await tool.execute(baseCtx, { branchId: '2' });

      assert.equal(filters.length, 0);
      assert.equal((result.data as any).branchAmbiguous, '2');
    });

    it('still reports an unknown name as unresolved, never a fuzzy guess', async () => {
      const { tool, filters } = makeFilterCapturingTool([{ id: 'branch-2', name: 'สาขา 2', code: 'BR2' }]);
      const result = await tool.execute(baseCtx, { branchId: 'สาขา 99' });

      assert.equal(filters.length, 0);
      assert.equal((result.data as any).branchUnresolved, 'สาขา 99');
    });

    it('normalizes the out-of-scope existence check the same way, so a spacing difference does not misreport it as unknown', async () => {
      const { tool, filters } = makeFilterCapturingTool([
        { id: 'branch-1', name: 'สาขา 1', code: 'BR1' },
        { id: 'branch-2', name: 'สาขา 2', code: 'BR2' },
      ]);
      const scopedCtx = { ...baseCtx, branchIds: ['branch-1'] };
      const result = await tool.execute(scopedCtx, { branchId: 'สาขา2' });

      assert.equal(filters.length, 0);
      assert.equal((result.data as any).branchOutOfScope, 'สาขา2');
      assert.equal((result.data as any).branchUnresolved, undefined);
    });
  });

  it('does not widen an incomplete or invalid date range to 1970 or the current month', async () => {
    const { tool, filters } = makeFilterCapturingTool();
    for (const [input, code] of [
      [{ fromDate: '2026-07-01' }, 'INCOMPLETE_RANGE'],
      [{ toDate: '2026-07-31' }, 'INCOMPLETE_RANGE'],
      [{ fromDate: '2026-07-40', toDate: '2026-07-31' }, 'INVALID_PERIOD'],
      [{ fromDate: '2026-08-01', toDate: '2026-07-31' }, 'INVALID_PERIOD'],
    ] as const) {
      const result = await tool.execute(baseCtx, input);
      assert.equal(result.status, 'error');
      assert.equal(result.errorCode, code);
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
    // Item 2 (T-148): status 'ok' with an empty sourceRefs made the gateway's enforceSourceHonesty
    // boundary discard this whole answer as an opaque TOOL_RESULT_NO_SOURCE error.
    assert.equal(result.sourceRefs.length, 1);
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/c1/expenses');
  });

  // Item 2 (T-148): a STAFF user asking for a branch outside their own scope used to get the same
  // ambiguous "unresolved" shape as a typo — and, combined with the missing sourceRefs above, a raw
  // TOOL_RESULT_NO_SOURCE code. It must say so honestly instead, without ever exposing anything
  // about the forbidden branch itself.
  it('reports an out-of-scope branch honestly instead of the ambiguous unresolved shape', async () => {
    const { tool, filters } = makeFilterCapturingTool([
      { id: 'branch-1', name: 'สาธุประดิษฐ์' },
      { id: 'branch-2', name: 'บางนา' },
    ]);
    const scopedCtx = { ...baseCtx, branchIds: ['branch-1'] };
    const result = await tool.execute(scopedCtx, { branchId: 'บางนา' });

    assert.equal(filters.length, 0);
    const data = result.data as any;
    assert.equal(data.branchOutOfScope, 'บางนา');
    assert.equal(data.branchUnresolved, undefined);
    // Never the forbidden branch's own data — only the identifiers this caller can already see.
    assert.deepEqual(data.availableBranches, [{ id: 'branch-1', code: 'C-branch-1', name: 'สาธุประดิษฐ์' }]);
    assert.equal(result.sourceRefs.length, 1);
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
  });

  // A branch that is genuinely nonexistent (typo) for a branch-restricted caller must still read as
  // a plain "unresolved" catalog, not the more specific out-of-scope outcome — the two must not
  // collapse into one shape once a scope restriction is present.
  it('still reports a genuinely nonexistent branch as unresolved, not out-of-scope, for a scoped caller', async () => {
    const { tool, filters } = makeFilterCapturingTool([{ id: 'branch-1', name: 'สาธุประดิษฐ์' }]);
    const scopedCtx = { ...baseCtx, branchIds: ['branch-1'] };
    const result = await tool.execute(scopedCtx, { branchId: 'ไม่มีสาขานี้' });

    assert.equal(filters.length, 0);
    const data = result.data as any;
    assert.equal(data.branchUnresolved, 'ไม่มีสาขานี้');
    assert.equal(data.branchOutOfScope, undefined);
    assert.equal(result.sourceRefs.length, 1);
  });

  it('reads one snapshot and marks bounded detail rows without degrading the complete aggregate', async () => {
    const { tool, calls } = makePagingTool(5000, true);

    const result = await tool.execute(baseCtx);

    assert.deepEqual(calls, [{ limit: 20, cursor: undefined }]);
    assert.equal((result.data as any).completeness.aggregate, 'complete');
    assert.equal((result.data as any).completeness.rows.hasMore, true);
    assert.equal(typeof (result.data as any).completeness.rows.nextCursor, 'string');
  });

  it('does not invent a continuation when all detail rows fit', async () => {
    const { tool, calls } = makePagingTool(1, false);

    const result = await tool.execute(baseCtx);

    assert.equal(calls.length, 1);
    assert.equal((result.data as any).completeness.rows.hasMore, false);
    assert.equal((result.data as any).completeness.rows.nextCursor, null);
  });

  // categoryName/vendorName resolution (spec §3 row 6, plan P4.2): same exact-then-contains match
  // as the branch lookup above, reusing the shared `applyNameFilter`/`resolveNameCandidate` helper
  // (unit-tested on its own below).
  describe('categoryName / vendorName resolution', () => {
    /** Same tool, wired for name resolution: captures the repository filter and lets each test
     *  supply its own candidate catalog. `vendorRoster` additionally simulates the repository's
     *  createdByUserId ABAC scoping (the real enforcement lives in
     *  PrismaExpenseRepository.readAiVendorCandidates / aiExpenseWhere) so a read_own caller here
     *  proves the SAME rule the repository enforces, not just that the tool calls through. */
    function makeNameResolutionTool(options: {
      categories?: Array<{ id: string; name: string }>;
      vendors?: Array<{ id: string; name: string }>;
      vendorRoster?: Array<{ id: string; name: string; createdByUserId: string }>;
    }) {
      const filters: any[] = [];
      const listExpenses = {
        readAiSummary: async (_ctx: unknown, filter: any) => {
          filters.push(filter);
          return {
            asOf: new Date('2026-08-31T12:00:00.000Z'), total: 0,
            byCurrency: [{ currency: 'THB', count: 0, totalAmount: '0', paidAmount: '0', outstandingAmount: '0' }],
            byStatus: [], items: [], hasMore: false, nextCursorSource: null,
          };
        },
        listCategoryCandidates: async () => options.categories ?? [],
        readAiVendorCandidates: async (ctx: { userId: string; permissions: string[] }) => {
          if (!options.vendorRoster) return options.vendors ?? [];
          const canReadAll = ctx.permissions.includes('expense.read') || ctx.permissions.includes('expense.review');
          const visible = canReadAll ? options.vendorRoster : options.vendorRoster.filter((row) => row.createdByUserId === ctx.userId);
          return visible.map(({ id, name }) => ({ id, name }));
        },
      } as any;
      return { tool: new ExpenseListRecentTool(listExpenses, fakePrisma()), filters };
    }

    it('resolves an exact category name to its id and echoes it in queryApplied.filters', async () => {
      const { tool, filters } = makeNameResolutionTool({ categories: [{ id: 'cat1', name: 'ค่าน้ำมัน' }, { id: 'cat2', name: 'ค่าน้ำมันรถ' }] });
      const result = await tool.execute(baseCtx, { categoryName: 'ค่าน้ำมัน' } as any);

      assert.equal(filters[0]?.expenseCategoryId, 'cat1');
      assert.equal((result.data as any).queryApplied.filters.categoryName, 'ค่าน้ำมัน');
    });

    // Confirms the real call site passes CATEGORY_NAME_STRIP_PREFIXES through, not just the pure
    // resolveNameCandidate helper tested in isolation elsewhere.
    it('strips a leading "หมวด" from a categoryName the same way through the real tool', async () => {
      const { tool, filters } = makeNameResolutionTool({ categories: [{ id: 'cat1', name: 'ค่าเดินทาง' }, { id: 'cat2', name: 'ค่าน้ำมัน' }] });
      const result = await tool.execute(baseCtx, { categoryName: 'หมวดค่าเดินทาง' } as any);

      assert.equal(filters[0]?.expenseCategoryId, 'cat1');
      assert.equal((result.data as any).queryApplied.filters.categoryName, 'ค่าเดินทาง');
    });

    // batch 9a real repro, through the real tool: the model itself sent categoryName "ค่าเดินทาน"
    // (one Thai character off "ค่าเดินทาง") calling this tool, not a user typo forwarded verbatim.
    it('resolves the model\'s one-character miswrite of a categoryName the same way through the real tool', async () => {
      const { tool, filters } = makeNameResolutionTool({ categories: [{ id: 'cat1', name: 'ค่าเดินทาง' }, { id: 'cat2', name: 'ค่าน้ำมัน' }] });
      const result = await tool.execute(baseCtx, { categoryName: 'ค่าเดินทาน' } as any);

      assert.equal(filters[0]?.expenseCategoryId, 'cat1');
      assert.equal((result.data as any).queryApplied.filters.categoryName, 'ค่าเดินทาง');
    });

    it('resolves a vendor name that only appears as a substring of one candidate', async () => {
      const { tool, filters } = makeNameResolutionTool({ vendors: [{ id: 'v1', name: 'ร้านสมใจการค้า' }] });
      const result = await tool.execute(baseCtx, { vendorName: 'สมใจ' } as any);

      assert.equal(filters[0]?.vendorCounterpartyId, 'v1');
      assert.equal((result.data as any).queryApplied.filters.vendorName, 'ร้านสมใจการค้า');
    });

    it('prefers an exact match over a broader contains match on another candidate', async () => {
      const { tool, filters } = makeNameResolutionTool({ vendors: [{ id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'ร้านสมใจการค้า' }] });
      const result = await tool.execute(baseCtx, { vendorName: 'ร้านสมใจ' } as any);

      assert.equal(result.status, 'ok');
      assert.equal(filters[0]?.vendorCounterpartyId, 'v1');
    });

    it('returns a structured ambiguity for similar vendor names instead of aggregating them', async () => {
      const { tool, filters } = makeNameResolutionTool({ vendors: [{ id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'ร้านสมใจการค้า' }] });
      const result = await tool.execute(baseCtx, { vendorName: 'สมใจ' } as any);

      assert.equal(filters.length, 0);
      assert.equal((result.data as any).vendorAmbiguous, 'สมใจ');
      assert.deepEqual((result.data as any).availableVendors, [
        { id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'ร้านสมใจการค้า' },
      ]);
      // Item 2 (223-turn eval batch 2): this 'ok' result must carry a real source citation, or the
      // gateway's enforceSourceHonesty boundary check discards it as TOOL_RESULT_NO_SOURCE before
      // any caller (classic or model-driven) ever sees availableVendors.
      assert.ok(result.sourceRefs.length > 0);
      assert.ok(result.sourceRefs.every((ref) => ref.permissionChecked === true && ref.module === 'expenses'));
    });

    it('returns a not-found result listing the available categories instead of records', async () => {
      const { tool, filters } = makeNameResolutionTool({ categories: [{ id: 'cat1', name: 'ค่าน้ำมัน' }, { id: 'cat2', name: 'ค่าไฟ' }] });
      const result = await tool.execute(baseCtx, { categoryName: 'ค่าเช่า' } as any);

      assert.equal(filters.length, 0);
      assert.equal((result.data as any).categoryUnresolved, 'ค่าเช่า');
      assert.deepEqual((result.data as any).availableCategories, [{ id: 'cat1', name: 'ค่าน้ำมัน' }, { id: 'cat2', name: 'ค่าไฟ' }]);
      // Item 2: same source-honesty requirement as the ambiguous case above.
      assert.ok(result.sourceRefs.length > 0);
      assert.ok(result.sourceRefs.every((ref) => ref.permissionChecked === true && ref.module === 'expenses'));
    });

    it('returns an input error when vendorId and vendorName resolve to different vendors', async () => {
      const { tool, filters } = makeNameResolutionTool({ vendors: [{ id: 'v1', name: 'ร้านสมใจ' }] });
      const result = await tool.execute(baseCtx, { vendorId: 'v-other', vendorName: 'ร้านสมใจ' } as any);

      assert.equal(result.status, 'error');
      assert.equal(result.errorCode, 'UNSUPPORTED_FILTER');
      assert.equal(filters.length, 0);
    });

    it('accepts an id and name that resolve to the same vendor', async () => {
      const { tool, filters } = makeNameResolutionTool({ vendors: [{ id: 'v1', name: 'ร้านสมใจ' }] });
      const result = await tool.execute(baseCtx, { vendorId: 'v1', vendorName: 'ร้านสมใจ' } as any);

      assert.equal(result.status, 'ok');
      assert.equal(filters[0]?.vendorCounterpartyId, 'v1');
    });

    // Owner requirement (spec §3 row 6 scope note): a read_own caller must not learn a vendor name
    // from someone else's expense. The roster fake above simulates the repository's
    // createdByUserId scoping so this test proves the RULE, not just that the tool calls through.
    it('a read_own caller cannot resolve a vendor that exists only on someone else\'s expense', async () => {
      const roster = [
        { id: 'v1', name: 'ร้านของฉัน', createdByUserId: 'u1' },
        { id: 'v2', name: 'ร้านของคนอื่น', createdByUserId: 'u2' },
      ];
      const { tool, filters } = makeNameResolutionTool({ vendorRoster: roster });
      const result = await tool.execute({ ...baseCtx, permissions: ['expense.read_own'] }, { vendorName: 'ร้านของคนอื่น' } as any);

      assert.equal(filters.length, 0);
      assert.equal((result.data as any).vendorUnresolved, 'ร้านของคนอื่น');
      assert.deepEqual((result.data as any).availableVendors, [{ id: 'v1', name: 'ร้านของฉัน' }]);
    });

    it('a read_own caller resolves a vendor that exists on their own expense', async () => {
      const roster = [
        { id: 'v1', name: 'ร้านของฉัน', createdByUserId: 'u1' },
        { id: 'v2', name: 'ร้านของคนอื่น', createdByUserId: 'u2' },
      ];
      const { tool, filters } = makeNameResolutionTool({ vendorRoster: roster });
      const result = await tool.execute({ ...baseCtx, permissions: ['expense.read_own'] }, { vendorName: 'ร้านของฉัน' } as any);

      assert.equal(result.status, 'ok');
      assert.equal(filters[0]?.vendorCounterpartyId, 'v1');
    });
  });
});

describe('normalizeNameQuery / resolveNameCandidate (Thai-safe name matching helper)', () => {
  it('folds case and trims, so a differently-cased or padded query still matches', () => {
    assert.equal(normalizeNameQuery('  Starbucks  '), 'starbucks');
  });

  // U+3300 is a standard NFC/NFKC divergence example: NFKC expands every CJK compatibility
  // ideograph into its multi-character reading; NFC leaves it untouched. Thai vowel/tone marks
  // such as U+0E33 (SARA AM) have the same kind of NFKC-only decomposition, which is why the
  // resolver must never switch to NFKC — it would silently rewrite real Thai names.
  it('uses NFC, not NFKC', () => {
    assert.equal(normalizeNameQuery('㌀'), '㌀'.normalize('NFC'));
    assert.notEqual(normalizeNameQuery('㌀'), '㌀'.normalize('NFKC'));
  });

  it('matches an exact name over a broader contains match', () => {
    const candidates = [{ id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'ร้านสมใจการค้า' }];
    assert.deepEqual(resolveNameCandidate('ร้านสมใจ', candidates), { kind: 'resolved', id: 'v1', name: 'ร้านสมใจ' });
  });

  it('falls back to a contains match when nothing matches exactly', () => {
    const candidates = [{ id: 'v1', name: 'ร้านสมใจการค้า' }];
    assert.deepEqual(resolveNameCandidate('สมใจ', candidates), { kind: 'resolved', id: 'v1', name: 'ร้านสมใจการค้า' });
  });

  it('returns ambiguous for several equally-good contains matches, capped at 10', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => ({ id: `v${i}`, name: `ร้านสมใจ ${i}` }));
    const result = resolveNameCandidate('สมใจ', candidates);
    assert.equal(result.kind, 'ambiguous');
    if (result.kind === 'ambiguous') assert.equal(result.matches.length, 10);
  });

  it('returns not_found with up to 10 available names when nothing matches', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `หมวด ${i}` }));
    const result = resolveNameCandidate('ไม่มีจริง', candidates);
    assert.equal(result.kind, 'not_found');
    if (result.kind === 'not_found') assert.equal(result.available.length, 10);
  });

  // 2026-09-27 review: relaxed matching. Stages (a) exact and (b) forward-contains are unchanged
  // (tested above); these cover the two NEW fallback stages, tried only when (a)+(b) find nothing:
  // (c) strip a leading category/vendor word from the query, then repeat (a)+(b); (d) reverse
  // contains (the query contains the candidate), for candidates 2+ characters.
  describe('relaxed fallback stages (c) strip-prefix and (d) reverse-contains', () => {
    it('(d) resolves a longer phrase to the one category name it contains', () => {
      // "ค่าน้ำมันรถ" names no category on its own; "น้ำมัน" (2+ chars) is the only candidate name
      // that is a substring of it, and "ค่าไฟ" is not, so this is unambiguous.
      const candidates = [{ id: 'cat1', name: 'น้ำมัน' }, { id: 'cat2', name: 'ค่าไฟ' }];
      assert.deepEqual(
        resolveNameCandidate('ค่าน้ำมันรถ', candidates, CATEGORY_NAME_STRIP_PREFIXES),
        { kind: 'resolved', id: 'cat1', name: 'น้ำมัน' },
      );
    });

    it('(c) strips a leading "หมวด" from the query and resolves the remainder exactly', () => {
      const candidates = [{ id: 'cat1', name: 'ค่าเดินทาง' }, { id: 'cat2', name: 'ค่าน้ำมัน' }];
      assert.deepEqual(
        resolveNameCandidate('หมวดค่าเดินทาง', candidates, CATEGORY_NAME_STRIP_PREFIXES),
        { kind: 'resolved', id: 'cat1', name: 'ค่าเดินทาง' },
      );
    });

    // Regression: an exact match at stage (a) must still short-circuit everything below it, with
    // strip prefixes engaged exactly as the real vendorName call site passes them.
    it('still resolves "ร้านสมใจ" exactly when "ร้านสมใจการค้า" also exists', () => {
      const candidates = [{ id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'ร้านสมใจการค้า' }];
      assert.deepEqual(
        resolveNameCandidate('ร้านสมใจ', candidates, VENDOR_NAME_STRIP_PREFIXES),
        { kind: 'resolved', id: 'v1', name: 'ร้านสมใจ' },
      );
    });

    it('still reports "สมใจ" as ambiguous between the same two vendors', () => {
      const candidates = [{ id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'ร้านสมใจการค้า' }];
      const result = resolveNameCandidate('สมใจ', candidates, VENDOR_NAME_STRIP_PREFIXES);
      assert.equal(result.kind, 'ambiguous');
    });
  });

  // batch 9a: the MODEL itself (not the user) misspelled a category name by one Thai character
  // calling a read tool — "ค่าเดินทาน" for "ค่าเดินทาง" — in two separate real-model runs. This
  // last-resort stage only runs once (a)-(d) above all find nothing (tested there already).
  describe('near-match last resort (e) (batch 9a)', () => {
    it('resolves the model\'s one-character miswrite of a category name (real repro)', () => {
      const candidates = [{ id: 'cat1', name: 'ค่าเดินทาง' }, { id: 'cat2', name: 'ค่าน้ำมัน' }];
      assert.deepEqual(
        resolveNameCandidate('ค่าเดินทาน', candidates),
        { kind: 'resolved', id: 'cat1', name: 'ค่าเดินทาง' },
      );
    });

    it('resolves a one-character typo of a vendor name when it is the only near match', () => {
      const candidates = [{ id: 'v1', name: 'ร้านกาแฟ' }];
      assert.deepEqual(
        resolveNameCandidate('ร้านขาแฟ', candidates),
        { kind: 'resolved', id: 'v1', name: 'ร้านกาแฟ' },
      );
    });

    it('is ambiguous when two candidates are each one edit away from the query', () => {
      const candidates = [{ id: 'c1', name: 'roast' }, { id: 'c2', name: 'toast' }];
      const result = resolveNameCandidate('coast', candidates);
      assert.equal(result.kind, 'ambiguous');
      if (result.kind === 'ambiguous') assert.deepEqual(result.matches.map((m) => m.id), ['c1', 'c2']);
    });

    it('never near-matches a 3-code-point query, however close a candidate is', () => {
      const candidates = [{ id: 'c1', name: 'cat' }];
      assert.deepEqual(resolveNameCandidate('cot', candidates), { kind: 'not_found', available: candidates });
    });

    it('leaves a distance-2 query unresolved', () => {
      const candidates = [{ id: 'c1', name: 'count' }];
      assert.deepEqual(resolveNameCandidate('coast', candidates), { kind: 'not_found', available: candidates });
    });
  });
});

// C3 (batch 5c, T-148-b): branches get their own matcher, not `resolveNameCandidate` — a space
// ("สาขา 2" vs "สาขา2") or a case difference ("BR2" vs "br2") is the common case here, and a bare
// number should resolve the branch whose name ends in it.
describe('resolveBranchCandidate (branch matching helper)', () => {
  const BRANCHES = [
    { id: 'b1', name: 'สำนักงานใหญ่', code: 'BR1' },
    { id: 'b2', name: 'สาขา 2', code: 'BR2' },
  ];

  it('matches a bare number against the trailing number of exactly one name', () => {
    assert.deepEqual(resolveBranchCandidate('2', BRANCHES), { kind: 'resolved', id: 'b2', name: 'สาขา 2', code: 'BR2' });
  });

  it('matches a name typed without the space the stored name has', () => {
    assert.deepEqual(resolveBranchCandidate('สาขา2', BRANCHES), { kind: 'resolved', id: 'b2', name: 'สาขา 2', code: 'BR2' });
  });

  it('matches a code typed in a different case', () => {
    assert.deepEqual(resolveBranchCandidate('br2', BRANCHES), { kind: 'resolved', id: 'b2', name: 'สาขา 2', code: 'BR2' });
  });

  it('is ambiguous when the bare number ends two different names', () => {
    const candidates = [{ id: 'b2', name: 'สาขา 2', code: 'BR2' }, { id: 'b12', name: 'คลังสาขา 2', code: 'WH2' }];
    const result = resolveBranchCandidate('2', candidates);
    assert.equal(result.kind, 'ambiguous');
    if (result.kind === 'ambiguous') assert.deepEqual(result.matches.map((m) => m.id).sort(), ['b12', 'b2']);
  });

  it('is not_found for a name outside the catalog', () => {
    assert.deepEqual(resolveBranchCandidate('สาขา 99', BRANCHES), { kind: 'not_found' });
  });

  it('an exact match short-circuits before a contains match ever runs', () => {
    // "สาขา 2" itself contains "สาขา 2" AND "สำนักงานใหญ่" does not — only relevant here because the
    // exact stage must be the one that resolves it, not a coincidental single contains match.
    assert.deepEqual(resolveBranchCandidate('สาขา 2', BRANCHES), { kind: 'resolved', id: 'b2', name: 'สาขา 2', code: 'BR2' });
  });

  // batch 9a: same last-resort near-match stage as resolveNameCandidate, for a one-character slip
  // in a branch NAME (not a number — see the guard test right below).
  describe('near-match last resort (batch 9a)', () => {
    it('resolves a one-character typo of a branch name when it is the only near match', () => {
      const candidates = [{ id: 'b1', name: 'สาขาลาดพร้าว', code: 'LP' }];
      assert.deepEqual(
        resolveBranchCandidate('สาขาลาคพร้าว', candidates),
        { kind: 'resolved', id: 'b1', name: 'สาขาลาดพร้าว', code: 'LP' },
      );
    });

    // Regression guard: "สาขา 1" and "สาขา 2" are one edit apart, but a branch number is an
    // identifier, never a spelling slip of its neighbour — the near-match stage must not blur them
    // even though it would otherwise be well within distance 1.
    it('never near-matches across two different branch numbers', () => {
      const candidates = [{ id: 'b1', name: 'สาขา 1', code: 'BR1' }];
      assert.deepEqual(resolveBranchCandidate('สาขา 2', candidates), { kind: 'not_found' });
    });
  });
});

describe('Exam G4: bilingual entity words resolve only against the company catalog', () => {
  it('resolves head office and branch numbers in either language without weakening ambiguity', () => {
    const catalog = [{ id: 'head', name: 'สำนักงานใหญ่', code: 'MAIN' }, { id: 'two', name: 'สาขา 2', code: 'B2' }];
    for (const query of ['head office', 'HEAD_OFFICE', 'สำนักงานใหญ่', 'HQ']) assert.equal((resolveBranchCandidate(query, catalog) as any).id, 'head', query);
    for (const query of ['Branch 2', 'สาขา 2', 'สาขาสอง']) assert.equal((resolveBranchCandidate(query, catalog) as any).id, 'two', query);
    assert.equal(resolveBranchCandidate('head office', [...catalog, { id: 'other-head', name: 'สำนักงานใหญ่', code: 'OTHER' }]).kind, 'ambiguous');
    assert.equal(resolveBranchCandidate('Branch 3', catalog).kind, 'not_found');
  });
  it('maps bilingual category vocabulary after exact catalog matches, never vendor names', () => {
    const catalog = [{ id: 'fuel', name: 'ค่าน้ำมัน' }, { id: 'travel', name: 'ค่าเดินทาง' }];
    for (const query of ['fuel', 'category fuel', 'ค่าน้ำมัน']) assert.equal((resolveNameCandidate(query, catalog, CATEGORY_NAME_STRIP_PREFIXES) as any).id, 'fuel', query);
    for (const query of ['travel', 'category travel', 'ค่าเดินทาง']) assert.equal((resolveNameCandidate(query, catalog, CATEGORY_NAME_STRIP_PREFIXES) as any).id, 'travel', query);
    assert.equal((resolveNameCandidate('Travel', [...catalog, { id: 'english', name: 'Travel' }], CATEGORY_NAME_STRIP_PREFIXES) as any).id, 'english');
    assert.equal(resolveNameCandidate('fuel', catalog, VENDOR_NAME_STRIP_PREFIXES).kind, 'not_found');
  });
});

// Owner 2026-11-06: the web button opened the whole list, not what the answer counted.
it('the web link opens the month, tab and unpaid view the answer counted', async () => {
  const { expenseListWebPath } = await import('./erp-tools.use-case');
  const nov = { fromDate: '2026-11-01', toDate: '2026-11-06' };
  assert.equal(expenseListWebPath('c1', { period: nov, documentStatus: 'NEEDS_REVIEW' }), '/companies/c1/expenses?month=2026-11&chip=pending');
  assert.equal(expenseListWebPath('c1', { period: nov, documentStatus: 'CONFIRMED', paymentStatus: 'UNPAID', branchId: 'b 1' }), '/companies/c1/expenses?month=2026-11&chip=confirmed&view=unpaid&branchId=b+1');
  assert.equal(expenseListWebPath('c1', { period: { fromDate: '2026-10-01', toDate: '2026-11-06' } }), '/companies/c1/expenses');
});

it('R17 older unpaid expenses support periods longer than ten years', async () => {
  const h = makeFilterCapturingTool();
  const result = await h.tool.execute(baseCtx, { olderThanMonths: 121, paymentStatus: 'UNPAID' } as any);
  assert.equal(result.status, 'ok');
  assert.equal(h.filters.length, 1);
});
