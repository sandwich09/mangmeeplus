import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GenerateSnapshotUseCase } from './generate-snapshot.use-case';
import { InventoryHealthProvider } from '../providers/inventory-health.provider';
import { ExpenseSummaryProvider } from '../providers/expense-summary.provider';
import { WORKER_NOTIFICATION_PERMISSIONS } from './notification-sweeps.use-cases';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

const COMPANY = 'c1';

/** `branchIds` undefined = an unrestricted membership; an array = SELECTED_BRANCHES. */
function ctxWith(permissions: readonly string[], branchIds?: string[]): RequestContext {
  return {
    requestId: 'r1',
    authSubject: 'u1',
    userId: 'u1',
    companyId: COMPANY,
    membershipId: 'm1',
    roles: [],
    permissions: [...permissions],
    scopes: { branchIds },
    authProvider: 'watchdog',
  };
}

/** Entitlement rows + the two providers' reads, over one fake Prisma client.
 *  `expenseWheres` collects what the expense provider actually queried, which is how the branch
 *  filter reaching the providers is observed. */
function makePrisma(entitlements: Record<string, boolean>, expenseWheres: any[]) {
  return {
    client: {
      companyFeatureEntitlement: {
        findMany: async () => Object.entries(entitlements).map(([featureKey, enabled]) => ({ featureKey, enabled })),
      },
      product: {
        findMany: async () => [{ id: 'p1', sku: 'A', name: 'A', reorderPoint: 10 }],
        count: async () => 1,
      },
      stockMovement: {
        groupBy: async () => [{ productId: 'p1', direction: 'IN', _sum: { quantity: 4 } }],
        findFirst: async () => ({ occurredAt: new Date('2026-08-02T00:00:00Z') }),
      },
      expenseRecord: {
        aggregate: async (args: any) => {
          expenseWheres.push(args.where);
          return args._sum?.outstandingAmount
            ? { _sum: { outstandingAmount: 400 } }
            : { _sum: { grandTotalAmount: 1250 }, _count: { _all: 2 } };
        },
        count: async (args: any) => { expenseWheres.push(args.where); return 3; },
      },
    },
  } as any;
}

/** In-memory DashboardSnapshot store; `seed` stands in for a snapshot an earlier run left behind. */
function makeSnapshots(seed?: { widgets: unknown[]; generatedAt: Date }) {
  const rows: any[] = seed
    ? [{
      id: 'seeded',
      companyId: COMPANY,
      periodKind: 'today',
      periodStart: new Date('2026-08-04T00:00:00Z'),
      periodEnd: new Date('2026-08-04T23:59:59Z'),
      metricsJson: { widgets: seed.widgets },
      freshnessStatus: 'partial',
      generatedAt: seed.generatedAt,
    }]
    : [];
  // Deliberately scope-blind: the real repository discriminates on scope/scopeKey in SQL, so what
  // this fake can prove is the lookup KEY the use case asks for.
  const findLatestCalls: Array<{ scope: string; scopeKey?: string }> = [];
  return {
    rows,
    findLatestCalls,
    findLatest: async (_companyId: string, _periodKind: string, scope: string, scopeKey?: string) => {
      findLatestCalls.push({ scope, scopeKey });
      return rows[rows.length - 1] ?? null;
    },
    create: async (input: any) => {
      const row = { id: `snap-${rows.length}`, ...input };
      rows.push(row);
      return row;
    },
  } as any;
}

function makeSut(entitlements: Record<string, boolean>, seed?: { widgets: unknown[]; generatedAt: Date }) {
  const expenseWheres: any[] = [];
  const prisma = makePrisma(entitlements, expenseWheres);
  const snapshots = makeSnapshots(seed);
  const useCase = new GenerateSnapshotUseCase(
    prisma,
    snapshots,
    new InventoryHealthProvider(prisma),
    new ExpenseSummaryProvider(prisma),
  );
  return { useCase, snapshots, expenseWheres };
}

const ENTITLED_EXPENSES_ONLY = { expenses: true, inventory: false, product_catalog: false };

describe('GenerateSnapshotUseCase entitlement/permission split', () => {
  it('computes only entitled modules, whatever permissions the generating context carries', async () => {
    const { useCase, snapshots } = makeSut(ENTITLED_EXPENSES_ONLY);

    // The 15-minute worker sweep: dashboard permissions only, no module reads.
    await useCase.execute(ctxWith(WORKER_NOTIFICATION_PERMISSIONS), COMPANY, { periodKind: 'today', forceGenerate: true });

    const stored = snapshots.rows.at(-1).metricsJson.widgets;
    assert.deepEqual(stored.map((w: any) => w.module), ['expenses'], 'Inventory is off: no inventory widget may be stored');
    assert.equal(stored[0].unavailableReason, undefined, 'entitled module must be computed even though the worker lacks expense.read');
  });

  it('returns a stored widget only to a caller holding its read permission', async () => {
    const { useCase } = makeSut(ENTITLED_EXPENSES_ONLY);

    const forWorker = await useCase.execute(ctxWith(WORKER_NOTIFICATION_PERMISSIONS), COMPANY, { periodKind: 'today', forceGenerate: true });
    assert.deepEqual(forWorker.widgets, [], 'the worker has no expense.read, so it sees no expense card');

    // Same cached snapshot, read by an owner one second later.
    const forOwner = await useCase.execute(ctxWith(['dashboard.read', 'expense.read']), COMPANY, { periodKind: 'today' });
    assert.deepEqual(forOwner.widgets.map((w) => w.module), ['expenses']);
    assert.equal(forOwner.widgets[0].metrics.length, 3);
  });

  it('drops a fresh cached snapshot whose modules no longer match the entitlements', async () => {
    // What the old code left in the database: an inventory card for a company with Inventory off.
    const { useCase } = makeSut(ENTITLED_EXPENSES_ONLY, {
      generatedAt: new Date(),
      widgets: [
        { key: 'inventory_health', title: 'สุขภาพคลังสินค้า', kind: 'metric_card', module: 'inventory', metrics: [{ key: 'total_active_products', label: 'สินค้าที่ใช้งาน', value: 0 }] },
        { key: 'expense_summary', title: 'ค่าใช้จ่ายและใบเสร็จ', kind: 'metric_card', module: 'expenses', metrics: [], unavailableReason: 'ต้องการสิทธิ์: expense.read' },
      ],
    });

    const dto = await useCase.execute(ctxWith(['dashboard.read', 'expense.read', 'inventory.report.read']), COMPANY, { periodKind: 'today' });

    assert.deepEqual(dto.widgets.map((w) => w.module), ['expenses'], 'the ghost inventory card must not survive the freshness window');
    assert.equal(dto.widgets[0].metrics.length, 3, 'the entitled card is regenerated instead of served empty');
  });

  it('keeps serving a fresh cached snapshot that still matches the entitlements', async () => {
    const { useCase, snapshots } = makeSut(ENTITLED_EXPENSES_ONLY);
    const reader = ctxWith(['dashboard.read', 'expense.read']);

    await useCase.execute(reader, COMPANY, { periodKind: 'today' });
    await useCase.execute(reader, COMPANY, { periodKind: 'today' });

    assert.equal(snapshots.rows.length, 1, 'the second read reuses the cache');
  });

  it('falls open for a company with no entitlement rows at all (legacy)', async () => {
    const { useCase } = makeSut({});
    const dto = await useCase.execute(ctxWith(['dashboard.read', 'expense.read', 'inventory.report.read']), COMPANY, { periodKind: 'today' });
    assert.deepEqual(dto.widgets.map((w) => w.module), ['inventory', 'expenses']);
  });

  it('still refuses a caller without any dashboard permission', async () => {
    const { useCase } = makeSut(ENTITLED_EXPENSES_ONLY);
    await assert.rejects(() => useCase.execute(ctxWith(['expense.read']), COMPANY, {}), /dashboard.read required/);
  });
});

const READER = ['dashboard.read', 'expense.read'];

describe('GenerateSnapshotUseCase branch dimension', () => {
  it('rejects an explicit branch outside the caller scope', async () => {
    const { useCase } = makeSut(ENTITLED_EXPENSES_ONLY);
    // isBranchInScope() would pass this through for an absent branchId, which is why the use case
    // writes the check itself.
    await assert.rejects(
      () => useCase.execute(ctxWith(READER, ['b1']), COMPANY, { periodKind: 'today', branchId: 'b2' }),
      /Branch out of scope/,
    );
  });

  it('scopes a restricted caller with no selection to its own branches, never company-wide', async () => {
    const { useCase, snapshots, expenseWheres } = makeSut(ENTITLED_EXPENSES_ONLY);

    await useCase.execute(ctxWith(READER, ['b2', 'b1']), COMPANY, { periodKind: 'today' });

    const stored = snapshots.rows.at(-1);
    assert.equal(stored.scope, 'branch');
    assert.equal(stored.scopeKey, 'b1,b2', 'sorted, so two callers holding the same branches share one row');
    assert.equal(expenseWheres.length, 3);
    for (const where of expenseWheres) {
      assert.deepEqual(where.branchId, { in: ['b2', 'b1'] }, 'every expense query is narrowed to the membership branches');
    }
  });

  it('leaves an unrestricted caller with no selection exactly as it was', async () => {
    const { useCase, snapshots, expenseWheres } = makeSut(ENTITLED_EXPENSES_ONLY);

    await useCase.execute(ctxWith(READER), COMPANY, { periodKind: 'today' });

    const stored = snapshots.rows.at(-1);
    assert.equal(stored.scope, 'company');
    assert.equal(stored.scopeKey, undefined);
    assert.deepEqual(expenseWheres.map((w) => w.branchId), [undefined, undefined, undefined], 'no branch predicate at all (spec R7)');
  });

  it('looks the cache up under the resolved scope, so a cached row cannot cross scopes', async () => {
    const { useCase, snapshots } = makeSut(ENTITLED_EXPENSES_ONLY);

    await useCase.execute(ctxWith(READER), COMPANY, { periodKind: 'today' });
    await useCase.execute(ctxWith(READER, ['b1']), COMPANY, { periodKind: 'today' });
    // Unrestricted caller naming a branch: allowed, and keyed to that branch alone.
    await useCase.execute(ctxWith(READER), COMPANY, { periodKind: 'today', branchId: 'b9' });

    assert.deepEqual(
      snapshots.findLatestCalls.map((call: any) => [call.scope, call.scopeKey]),
      [['company', undefined], ['branch', 'b1'], ['branch', 'b9']],
    );
  });

  it('reuses the cache on period and module set only — scope discrimination belongs to findLatest', async () => {
    const { useCase, snapshots } = makeSut(ENTITLED_EXPENSES_ONLY);
    const restricted = ctxWith(READER, ['b1']);

    await useCase.execute(restricted, COMPANY, { periodKind: 'today' });
    await useCase.execute(restricted, COMPANY, { periodKind: 'today' });

    assert.equal(snapshots.rows.length, 1, 'the entitlement guard still reuses a matching fresh row');
    assert.deepEqual(snapshots.findLatestCalls.map((call: any) => call.scopeKey), ['b1', 'b1'],
      'the guard never compares scope itself; it only ever sees rows findLatest already keyed');
  });
});

describe('HOME-1 expense months access', () => {
  function monthly(entitlements: Record<string, boolean> = { expenses: true }) {
    const prisma = makePrisma(entitlements, []);
    prisma.client.company = { findUniqueOrThrow: async (query: any) => { assert.deepEqual(query, { where: { id: COMPANY }, select: { timezone: true } }); return { timezone: 'Asia/Bangkok' }; } };
    const calls: any[] = [];
    const expense = new ExpenseSummaryProvider(prisma);
    expense.collectMonths = async input => { calls.push(input); return { year: input.year, months: [], years: [] }; };
    return { calls, sut: new GenerateSnapshotUseCase(prisma, makeSnapshots(), new InventoryHealthProvider(prisma), expense) };
  }
  it('refuses missing dashboard or full expense permission, tenant mismatch and disabled Expenses before totals', async () => {
    for (const permissions of [['dashboard.read'], ['dashboard.read', 'expense.read_own'], ['expense.read'], ['dashboard.snapshot.generate', 'expense.read']]) {
      const { sut, calls } = monthly();
      await assert.rejects(() => sut.getExpenseMonths(ctxWith(permissions), COMPANY, { year: 2026 }), (e: any) => e.getStatus() === 403);
      assert.equal(calls.length, 0);
    }
    for (const [company, entitlements] of [['other', { expenses: true }], [COMPANY, { expenses: false }]] as const) {
      const { sut, calls } = monthly(entitlements);
      await assert.rejects(() => sut.getExpenseMonths(ctxWith(['dashboard.read', 'expense.read']), company, { year: 2026 }), (e: any) => e.getStatus() === 403);
      assert.equal(calls.length, 0);
    }
  });
  it('uses the same explicit, restricted, unrestricted and empty branch scopes as the dashboard', async () => {
    const { sut, calls } = monthly();
    const permissions = ['dashboard.read', 'expense.read'];
    await assert.rejects(() => sut.getExpenseMonths(ctxWith(permissions, ['b1']), COMPANY, { year: 2026, branchId: 'b2' }), (e: any) => e.getStatus() === 403);
    assert.equal(calls.length, 0);
    for (const [scope, selected, expected] of [[undefined, undefined, undefined], [['b1', 'b2'], undefined, ['b1', 'b2']], [['b1', 'b2'], 'b1', ['b1']], [[], undefined, []]] as [string[] | undefined, string | undefined, string[] | undefined][]) {
      await sut.getExpenseMonths(ctxWith(permissions, scope), COMPANY, { year: 2026, branchId: selected });
      assert.deepEqual(calls.at(-1), { companyId: COMPANY, year: 2026, branchIds: expected, timezone: 'Asia/Bangkok' });
    }
  });
});
