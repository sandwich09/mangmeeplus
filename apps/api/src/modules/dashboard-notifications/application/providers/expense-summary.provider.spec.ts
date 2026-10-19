import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXPENSE_PENDING_STATUSES } from '@watchdog-bms/contracts';
import { ExpenseSummaryProvider } from './expense-summary.provider';

const PERIOD = { periodStart: new Date('2026-07-31T17:00:00Z'), periodEnd: new Date('2026-08-31T16:59:59.999Z') };

function makeSut(opts: {
  confirmedTotal?: string | number;
  pendingReview?: number;
  outstanding?: string | number;
  throws?: boolean;
} = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const expenseRecord = {
    aggregate: async (args: any) => {
      if (opts.throws) throw new Error('db down');
      calls.push(args.where);
      return args._sum?.outstandingAmount
        ? { _sum: { outstandingAmount: opts.outstanding ?? 0 } }
        : { _sum: { grandTotalAmount: opts.confirmedTotal ?? 0 }, _count: { _all: 0 } };
    },
    count: async (args: any) => {
      if (opts.throws) throw new Error('db down');
      calls.push(args.where);
      return opts.pendingReview ?? 0;
    },
  };
  const prisma = { client: { expenseRecord } } as any;
  return { provider: new ExpenseSummaryProvider(prisma), calls };
}

const input = () => ({ companyId: 'c1', ...PERIOD });

describe('ExpenseSummaryProvider', () => {
  it('declares the Expenses entitlement and the single key that may read the card', () => {
    const { provider } = makeSut();
    assert.equal(provider.featureKey, 'expenses');
    // expense.read_own must never unlock company-wide totals.
    assert.deepEqual([...provider.readPermissions], ['expense.read']);
  });

  it('returns period totals, pending review count and outstanding', async () => {
    const { provider, calls } = makeSut({ confirmedTotal: '1250.5000', pendingReview: 3, outstanding: '400.0000' });
    const [widget] = await provider.collectMetrics(input());

    assert.equal(widget.unavailableReason, undefined);
    assert.equal(widget.module, 'expenses');
    assert.deepEqual(
      widget.metrics.map((m) => [m.key, m.value, m.severity]),
      [
        ['expense_total_in_period', 1250.5, 'normal'],
        ['expense_pending_review', 3, 'warning'],
        ['expense_unpaid_outstanding', 400, 'warning'],
      ],
    );
    // The money metric is period-scoped; the two worklist metrics are current-state.
    assert.deepEqual((calls[0] as any).expenseDate, { gte: new Date('2026-08-01T00:00:00Z'), lt: new Date('2026-09-01T00:00:00Z') });
    assert.deepEqual(widget.metrics.map((metric) => metric.sourceRefs?.[0]?.href), [
      '/companies/c1/expenses?view=confirmed&fromDate=2026-08-01&toDate=2026-08-31',
      '/companies/c1/expenses?view=pending',
      '/companies/c1/expenses?view=unpaid',
    ]);
    assert.equal((calls[1] as any).expenseDate, undefined);
    assert.equal((calls[2] as any).expenseDate, undefined);
  });

  it('counts ใบเสร็จรอตรวจ from DRAFT onward, by the shared rule the expenses list uses', async () => {
    const { provider, calls } = makeSut({ pendingReview: 4 });
    await provider.collectMetrics(input());

    // The drift this guards: the list counted DRAFT and this card did not, so the same Thai word
    // reported different numbers on two screens. Both now read the contracts constant.
    assert.deepEqual((calls[1] as any).status, { in: [...EXPENSE_PENDING_STATUSES] });
    assert.deepEqual([...EXPENSE_PENDING_STATUSES], ['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION']);
  });

  it('UAT-Q1 outstanding sums remaining confirmed unpaid and partially paid balances across all months in the selected branches', async () => {
    const { provider, calls } = makeSut({ outstanding: '6842.1200' });
    const [widget] = await provider.collectMetrics({ ...input(), branchIds: ['b1'] });
    assert.deepEqual(calls[2], { companyId: 'c1', branchId: { in: ['b1'] }, status: 'CONFIRMED',
      paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] } });
    const metric = widget.metrics.find(metric => metric.key === 'expense_unpaid_outstanding')!;
    assert.equal(metric.value, 6842.12);
    assert.equal(metric.label, 'ค้างจ่ายที่ยืนยันแล้ว (ทุกช่วงเวลา)');
  });

  it('stays normal severity when there is nothing pending or outstanding', async () => {
    const { provider } = makeSut({ confirmedTotal: 0, pendingReview: 0, outstanding: 0 });
    const [widget] = await provider.collectMetrics(input());
    assert.deepEqual(widget.metrics.map((m) => m.severity), ['normal', 'normal', 'normal']);
  });

  it('degrades to an unavailable widget instead of throwing when the query fails', async () => {
    const { provider } = makeSut({ throws: true });
    const [widget] = await provider.collectMetrics(input());
    assert.equal(widget.unavailableReason, 'ข้อมูลค่าใช้จ่ายไม่พร้อมใช้งาน');
  });

  it('narrows all three queries to the given branches, by exact match', async () => {
    const { provider, calls } = makeSut();
    await provider.collectMetrics({ ...input(), branchIds: ['b1', 'b2'] });

    assert.equal(calls.length, 3);
    for (const where of calls) {
      assert.deepEqual((where as any).branchId, { in: ['b1', 'b2'] });
      // Exact match, not branchScopeWhere: company-central rows (branchId null) belong to the
      // combined view and to no individual branch (spec R4), so per-branch figures need not sum to
      // the company total. This mirrors the Expenses list, which the card links to.
      assert.equal((where as any).OR, undefined);
    }
  });

  it('applies no branch predicate at all when unscoped', async () => {
    const { provider, calls } = makeSut();
    await provider.collectMetrics(input());
    assert.deepEqual(calls.map((where) => (where as any).branchId), [undefined, undefined, undefined]);
  });
});

describe('HOME-1 expense months', () => {
  it('uses one confirmed month aggregation, preserves decimal money and fills twelve months', async () => {
    const queries: any[] = [];
    const provider = new ExpenseSummaryProvider({ client: { $queryRaw: async (query: any) => {
      queries.push(query);
      return [{ month: '2025-12', total: '99.00', count: 1n }, { month: '2026-01', total: '32000.12', count: 5n }, { month: '2026-12', total: '90071992547409.99', count: 2n }, { month: '2027-01', total: '11.00', count: 1n }];
    } } } as any);
    const result = await provider.collectMonths({ companyId: 'c1', year: 2026 }, new Date('2027-12-31T17:00:00Z'));
    assert.equal(queries.length, 1);
    assert.match(queries[0].text, /GROUP BY/);
    assert.match(queries[0].text, /"status" = 'CONFIRMED'/);
    assert.match(queries[0].text, /SUM\("grandTotalAmount"\)/);
    assert.match(queries[0].text, /to_char\("expenseDate", 'YYYY-MM'\)/);
    assert.deepEqual(queries[0].values, ['c1']);
    assert.equal(result.year, 2026);
    assert.equal(result.months.length, 12);
    assert.deepEqual(result.months[0], { month: '2026-01', total: '32000.12', count: 5 });
    assert.deepEqual(result.months[1], { month: '2026-02', total: '0.00', count: 0 });
    assert.deepEqual(result.months[11], { month: '2026-12', total: '90071992547409.99', count: 2 });
    assert.deepEqual(result.years, [2025, 2026, 2027, 2028], 'current Bangkok year, not UTC year');
  });
  it('keeps company-central rows only in the unrestricted view, and an empty scope reads nothing', async () => {
    for (const branchIds of [undefined, ['b1', 'b2'], []]) {
      let query: any;
      const provider = new ExpenseSummaryProvider({ client: { $queryRaw: async (q: any) => { query = q; return []; } } } as any);
      const result = await provider.collectMonths({ companyId: 'c1', year: 2026, branchIds }, new Date('2026-06-01'));
      assert.equal(result.months.length, 12);
      assert.ok(result.months.every(row => row.total === '0.00' && row.count === 0));
      assert.deepEqual(result.years, [2026]);
      if (!branchIds) assert.doesNotMatch(query.text, /"branchId"/);
      else if (branchIds.length) { assert.match(query.text, /"branchId" IN/); assert.deepEqual(query.values, ['c1', 'b1', 'b2']); assert.doesNotMatch(query.text, /IS NULL/); }
      else assert.match(query.text, /AND FALSE/);
    }
  });
});


it('HOME-1 takes the current year from the shop timezone without shifting stored expense dates', async () => {
  const provider = new ExpenseSummaryProvider({ client: { $queryRaw: async () => [] } } as any);
  const result = await provider.collectMonths({ companyId: 'c1', year: 2026, timezone: 'America/Los_Angeles' }, new Date('2027-01-01T01:00:00Z'));
  assert.deepEqual(result.years, [2026]);
});
