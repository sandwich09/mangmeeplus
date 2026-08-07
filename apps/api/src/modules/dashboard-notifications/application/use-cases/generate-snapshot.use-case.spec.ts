import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GenerateSnapshotUseCase } from './generate-snapshot.use-case';
import { InventoryHealthProvider } from '../providers/inventory-health.provider';
import { ExpenseSummaryProvider } from '../providers/expense-summary.provider';
import { WORKER_NOTIFICATION_PERMISSIONS } from './notification-sweeps.use-cases';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

const COMPANY = 'c1';

function ctxWith(permissions: readonly string[]): RequestContext {
  return {
    requestId: 'r1',
    authSubject: 'u1',
    userId: 'u1',
    companyId: COMPANY,
    membershipId: 'm1',
    roles: [],
    permissions: [...permissions],
    scopes: {},
    authProvider: 'watchdog',
  };
}

/** Entitlement rows + the two providers' reads, over one fake Prisma client. */
function makePrisma(entitlements: Record<string, boolean>) {
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
        aggregate: async (args: any) => (args._sum?.outstandingAmount
          ? { _sum: { outstandingAmount: 400 } }
          : { _sum: { grandTotalAmount: 1250 }, _count: { _all: 2 } }),
        count: async () => 3,
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
  return {
    rows,
    findLatest: async () => rows[rows.length - 1] ?? null,
    create: async (input: any) => {
      const row = { id: `snap-${rows.length}`, ...input };
      rows.push(row);
      return row;
    },
  } as any;
}

function makeSut(entitlements: Record<string, boolean>, seed?: { widgets: unknown[]; generatedAt: Date }) {
  const prisma = makePrisma(entitlements);
  const snapshots = makeSnapshots(seed);
  const useCase = new GenerateSnapshotUseCase(
    prisma,
    snapshots,
    new InventoryHealthProvider(prisma),
    new ExpenseSummaryProvider(prisma),
  );
  return { useCase, snapshots };
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
