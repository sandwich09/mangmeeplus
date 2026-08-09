/**
 * Audit "dashboard/noti/reports": four defects that all look like nothing in review and all show up
 * as wrong data, missing data, or no data on the user's screen.
 *
 *  - the snapshot cache matched on freshness and module set but never on the period, so a "today"
 *    snapshot generated at 23:50 kept being served past midnight under today's heading
 *  - three cursor lists filtered on `id` while sorting by `createdAt`, so page two skipped rows
 *  - the unread badge fetched the whole unread backlog with a join and counted it in JS, every
 *    60 seconds per open tab
 *  - `report_ready` was emitted by Reports but classified as a future trigger, so the preference
 *    gate — which defaults to exactly the implemented list — dropped every LINE push, and the
 *    preferences screen only offers implemented keys, so nobody could opt in either
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GenerateSnapshotUseCase } from './application/use-cases/generate-snapshot.use-case';
import { InventoryHealthProvider } from './application/providers/inventory-health.provider';
import { ExpenseSummaryProvider } from './application/providers/expense-summary.provider';
import {
  PrismaNotificationDeliveryRepository,
  PrismaNotificationEventRepository,
  PrismaNotificationRecipientRepository,
} from './infrastructure/prisma-notification.repository';
import { IMPLEMENTED_TRIGGER_KEYS, FUTURE_TRIGGER_KEYS } from './domain/models/notification.model';
import type { RequestContext } from '../auth/domain/models/request-context.model';

const COMPANY = 'co-1';

const ctx: RequestContext = {
  requestId: 'r1', authSubject: 'u1', userId: 'u1', companyId: COMPANY, membershipId: 'm1',
  roles: [], permissions: ['dashboard.read', 'expense.read'], scopes: {}, authProvider: 'watchdog',
};

const YESTERDAY = { start: new Date('2026-08-09T00:00:00Z'), end: new Date('2026-08-09T23:59:59Z') };
const TODAY = { start: new Date('2026-08-10T00:00:00Z'), end: new Date('2026-08-10T23:59:59Z') };

function snapshotSut(seeded: { start: Date; end: Date }) {
  const prisma = {
    client: {
      companyFeatureEntitlement: { findMany: async () => [{ featureKey: 'expenses', enabled: true }] },
      expenseRecord: {
        aggregate: async (args: any) => (args._sum?.outstandingAmount
          ? { _sum: { outstandingAmount: 400 } }
          : { _sum: { grandTotalAmount: 1250 }, _count: { _all: 2 } }),
        count: async () => 3,
      },
    },
  } as any;
  const rows: any[] = [{
    id: 'yesterday', companyId: COMPANY, periodKind: 'today',
    periodStart: seeded.start, periodEnd: seeded.end,
    metricsJson: { widgets: [{ key: 'expense_summary', kind: 'metric_card', module: 'expenses', title: 'ค่าใช้จ่าย', metrics: [] }] },
    freshnessStatus: 'fresh',
    // Deliberately fresh by the clock: age alone was never the thing that went stale.
    generatedAt: new Date(),
  }];
  const snapshots = {
    rows,
    findLatest: async () => rows[rows.length - 1] ?? null,
    create: async (input: any) => { const row = { id: `snap-${rows.length}`, ...input }; rows.push(row); return row; },
  } as any;
  return {
    snapshots,
    useCase: new GenerateSnapshotUseCase(prisma, snapshots, new InventoryHealthProvider(prisma), new ExpenseSummaryProvider(prisma)),
  };
}

// `custom` is the one kind whose boundaries the caller supplies verbatim; every other kind derives
// them from the wall clock, which would make "the period rolled over" untestable without faking time.
const forPeriod = (period: { start: Date; end: Date }) =>
  ({ periodKind: 'custom' as const, periodStart: period.start, periodEnd: period.end });

describe('dashboard snapshot cache across a period rollover', () => {
  it('does not serve yesterday numbers under today heading', async () => {
    const { useCase, snapshots } = snapshotSut(YESTERDAY);

    await useCase.execute(ctx, COMPANY, forPeriod(TODAY));

    assert.equal(snapshots.rows.length, 2, 'a snapshot for a different period must not satisfy this read');
    assert.equal(snapshots.rows.at(-1).periodStart.getTime(), TODAY.start.getTime());
  });

  it('still reuses the cache within the same period, so the fix costs no extra generation', async () => {
    const { useCase, snapshots } = snapshotSut(TODAY);

    await useCase.execute(ctx, COMPANY, forPeriod(TODAY));

    assert.equal(snapshots.rows.length, 1, 'the matching cached period must still be served');
  });
});

/** Records what each list actually asked Prisma for. */
function capturingPrisma(captured: Record<string, any>) {
  const model = (name: string) => ({
    findMany: async (args: any) => { captured[name] = args; return []; },
    groupBy: async (args: any) => { captured[`${name}.groupBy`] = args; return []; },
  });
  return {
    client: {
      notificationEvent: model('event'),
      notificationRecipient: model('recipient'),
      notificationDelivery: model('delivery'),
    },
  } as any;
}

describe('cursor pagination keys', () => {
  // A filter on one key and an order on another: any row that sorts after the cursor but carries a
  // larger id is skipped, and one that sorts before it with a smaller id comes back twice.
  it('never filters the page on a key it does not sort by', async () => {
    const captured: Record<string, any> = {};
    const prisma = capturingPrisma(captured);
    await new PrismaNotificationEventRepository(prisma).list(COMPANY, 'u1', { cursor: 'evt-9', pageSize: 10 } as any);
    await new PrismaNotificationRecipientRepository(prisma).listByUser(COMPANY, 'u1', { cursor: 'rec-9', pageSize: 10 });
    await new PrismaNotificationDeliveryRepository(prisma).listByCompany(COMPANY, { cursor: 'del-9', pageSize: 10 });

    for (const [name, cursor] of [['event', 'evt-9'], ['recipient', 'rec-9'], ['delivery', 'del-9']] as const) {
      const args = captured[name];
      assert.ok(args, `${name} list did not run`);
      assert.deepEqual(args.cursor, { id: cursor }, `${name} must page with a real cursor`);
      assert.equal(args.skip, 1, `${name} must step past the cursor row`);
      assert.equal(args.where.id, undefined, `${name} still filters on id while ordering by createdAt`);
      // createdAt is not unique - a batch of recipients lands in the same millisecond - so the id
      // tiebreaker is what makes the order total and the cursor meaningful.
      assert.deepEqual(args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }], name);
    }
  });

  it('asks for no cursor at all on the first page', async () => {
    const captured: Record<string, any> = {};
    await new PrismaNotificationEventRepository(capturingPrisma(captured)).list(COMPANY, 'u1', { pageSize: 10 } as any);
    assert.equal(captured['event'].cursor, undefined);
    assert.equal(captured['event'].skip, undefined);
  });
});

describe('unread badge counting', () => {
  it('counts in the database instead of transferring the backlog', async () => {
    const captured: Record<string, any> = {};
    const prisma = capturingPrisma(captured);
    prisma.client.notificationEvent.groupBy = async (args: any) => {
      captured['event.groupBy'] = args;
      return [
        { severity: 'CRITICAL', _count: { _all: 2 } },
        { severity: 'INFO', _count: { _all: 5 } },
      ];
    };
    prisma.client.notificationRecipient.findMany = async () => assert.fail('the unread badge must not read the backlog row by row');

    const result = await new PrismaNotificationRecipientRepository(prisma).countUnread(COMPANY, 'u1');

    assert.deepEqual(result, { total: 7, bySeverity: { critical: 2, action: 0, insight: 0, info: 5 } });
    assert.deepEqual(captured['event.groupBy'].by, ['severity']);
    // Dismissed rows are not unread; keeping both conditions is what makes the badge match the list.
    assert.deepEqual(captured['event.groupBy'].where.recipients.some, { userId: 'u1', readAt: null, dismissedAt: null });
  });
});

/**
 * Trigger keys that some module emits but the preference gate will drop, because that gate defaults
 * to IMPLEMENTED_TRIGGER_KEYS. Recorded rather than silently allowed: every one of these is a
 * notification the product creates and can never deliver over LINE.
 *
 * The eleven below are workflow templates. They are left disabled deliberately - moving a key into
 * the implemented list turns its LINE push on by default for every company, which is a product
 * decision about what a shop owner's phone buzzes for, not a defect fix. Delete an entry here in
 * the same change that implements it.
 */
const EMITTED_BUT_NOT_DELIVERABLE = new Set([
  'workflow.daily_owner_summary',
  'workflow.low_stock_alert',
  'workflow.stockout_risk',
  'workflow.vendor_bill_pending',
  'workflow.vendor_bill_second_approval',
  'workflow.tax_due_soon',
  'workflow.bank_reconciliation_aging',
  'workflow.overdue_invoice',
  'workflow.crm_follow_up_due',
  'workflow.crm_opportunity_stuck',
  'workflow.sales_below_target',
]);

function apiSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return apiSourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('every emitted trigger can actually be delivered', () => {
  it('leaves no trigger emitted by a module but dropped by the preference gate', () => {
    const implemented = new Set(IMPLEMENTED_TRIGGER_KEYS);
    const undeliverable = new Set<string>();

    for (const file of apiSourceFiles(join(__dirname, '..'))) {
      if (file.endsWith('notification.model.ts')) continue;
      for (const match of readFileSync(file, 'utf8').matchAll(/triggerKey:\s*'([a-z][a-z0-9_.]+)'/g)) {
        const key = match[1]!;
        if (!implemented.has(key) && !EMITTED_BUT_NOT_DELIVERABLE.has(key)) undeliverable.add(key);
      }
    }

    assert.deepEqual([...undeliverable], [], `emitted but undeliverable: ${[...undeliverable].join(', ')}`);
  });

  it('keeps report_ready deliverable, and out of the future list that suppressed it', () => {
    assert.ok(IMPLEMENTED_TRIGGER_KEYS.includes('report_ready'));
    assert.ok(!FUTURE_TRIGGER_KEYS.includes('report_ready'));
  });

  it('never lets a key sit in both lists, which would make the gate depend on read order', () => {
    const both = IMPLEMENTED_TRIGGER_KEYS.filter((key) => FUTURE_TRIGGER_KEYS.includes(key));
    assert.deepEqual(both, []);
  });
});
