import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InternalNotificationController, InternalNotificationSweepController } from './internal.controller';

/**
 * Shadow probe double (piece 5). Recording into module-level arrays and asserting on the DELTA
 * keeps every pre-existing test untouched.
 */
const shadowRecords: Array<{ surface: string; companyId: string | null; featureKey: string | null }> = [];
const shadowFlushes: string[] = [];
const shadowProbe = {
  startSweep: (surface: string) => ({
    record: async (companyId: string | null, featureKey: string | null) => {
      shadowRecords.push({ surface, companyId, featureKey });
      return { wouldBlock: false, reason: 'available' as const };
    },
    flush: async () => { shadowFlushes.push(surface); return {}; },
  }),
} as any;



const TOKEN = 'worker-secret';

function makeController(opts: { company?: { id: string } | null } = {}) {
  const companyQueries: any[] = [];
  const snapshotCalls: any[] = [];
  const summaryCalls: any[] = [];
  const deliveryCalls: any[] = [];

  const prisma = {
    client: {
      company: {
        findFirst: async (args: any) => {
          companyQueries.push(args);
          return opts.company === undefined ? { id: args.where.id } : opts.company;
        },
      },
    },
  } as any;
  const generateSnapshot = { execute: async (...args: any[]) => { snapshotCalls.push(args); return { generated: true }; } } as any;
  const stockLowScan = { execute: async () => ({}) } as any;
  const dailyOwnerSummary = { execute: async (...args: any[]) => { summaryCalls.push(args); return {}; } } as any;
  const processDelivery = { execute: async (...args: any[]) => { deliveryCalls.push(args); return {}; } } as any;

  const controller = new InternalNotificationController(prisma, generateSnapshot, stockLowScan, dailyOwnerSummary, processDelivery, shadowProbe);
  return { controller, companyQueries, snapshotCalls, summaryCalls, deliveryCalls, shadowRecords, shadowFlushes };
}

describe('InternalNotificationController (H-14)', () => {
  const originalToken = process.env['WORKER_INTERNAL_TOKEN'];

  beforeEach(() => {
    process.env['WORKER_INTERNAL_TOKEN'] = TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env['WORKER_INTERNAL_TOKEN'];
    else process.env['WORKER_INTERNAL_TOKEN'] = originalToken;
  });

  it('rejects a bad worker token before touching the database', async () => {
    const { controller, companyQueries, snapshotCalls } = makeController();
    await assert.rejects(
      () => controller.handleGenerateSnapshot('co-1', 'wrong', {}),
      UnauthorizedException,
    );
    assert.equal(companyQueries.length, 0);
    assert.equal(snapshotCalls.length, 0);
  });

  it('refuses to run a job for a company that is not ACTIVE', async () => {
    const { controller, companyQueries, snapshotCalls } = makeController({ company: null });
    await assert.rejects(
      () => controller.handleGenerateSnapshot('co-ghost', TOKEN, {}),
      NotFoundException,
    );
    assert.deepEqual(companyQueries[0].where, { id: 'co-ghost', status: 'ACTIVE' });
    assert.equal(snapshotCalls.length, 0);
  });

  it('runs the snapshot with a least-privilege system context (no OWNER role)', async () => {
    const { controller, snapshotCalls } = makeController();
    await controller.handleGenerateSnapshot('co-1', TOKEN, { periodKind: 'today' });

    assert.equal(snapshotCalls.length, 1);
    const [ctx, companyId, options] = snapshotCalls[0];
    assert.equal(companyId, 'co-1');
    assert.deepEqual(options, { periodKind: 'today', forceGenerate: true });
    assert.deepEqual(ctx.roles, []);
    assert.equal(ctx.authProvider, 'system');
    assert.equal(ctx.companyId, 'co-1');
    assert.ok(ctx.permissions.includes('dashboard.snapshot.generate'));
    assert.ok(!ctx.permissions.includes('ai.tool.invoke'));
    // H-14 least-privilege: the worker never reaches the rule-manage path, so it
    // must not hold that write permission.
    assert.ok(!ctx.permissions.includes('notification.rule.manage'));
  });

  it('validates the company before processing a queued delivery', async () => {
    const { controller, deliveryCalls } = makeController({ company: null });
    await assert.rejects(() => controller.delivery('co-ghost', 'dl-1', TOKEN), NotFoundException);
    assert.equal(deliveryCalls.length, 0);
  });

  it('passes a system context to the daily owner summary', async () => {
    const { controller, summaryCalls } = makeController();
    await controller.dailySummary('co-1', TOKEN, { periodKey: '2026-07-18' });
    const [ctx, companyId, periodKey] = summaryCalls[0];
    assert.equal(companyId, 'co-1');
    assert.equal(periodKey, '2026-07-18');
    assert.deepEqual(ctx.roles, []);
  });
});

describe('InternalNotificationSweepController (H-14)', () => {
  const originalToken = process.env['WORKER_INTERNAL_TOKEN'];

  beforeEach(() => {
    process.env['WORKER_INTERNAL_TOKEN'] = TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env['WORKER_INTERNAL_TOKEN'];
    else process.env['WORKER_INTERNAL_TOKEN'] = originalToken;
  });

  it('rejects a bad token on sweep routes', async () => {
    const calls: any[] = [];
    const sweep = { execute: async () => { calls.push(1); return {}; } } as any;
    const controller = new InternalNotificationSweepController(sweep, sweep, sweep, sweep);
    await assert.rejects(() => controller.deliverySweep('wrong'), UnauthorizedException);
    assert.equal(calls.length, 0);
  });

  it('runs the sweep with the configured token', async () => {
    const calls: any[] = [];
    const sweep = { execute: async () => { calls.push(1); return { processed: 0 }; } } as any;
    const controller = new InternalNotificationSweepController(sweep, sweep, sweep, sweep);
    await controller.generateSnapshots(TOKEN);
    assert.equal(calls.length, 1);
  });
});

/**
 * Shadow coverage for the four on-demand notification worker endpoints (piece 5).
 *
 * All four are `dashboard_notifications` async rows in the F0 inventory and all four take a
 * caller-supplied companyId, so the observation must land only after `assertActiveCompany`.
 */
describe('InternalNotificationController shadow coverage (piece 5)', () => {
  const originalToken = process.env['WORKER_INTERNAL_TOKEN'];
  beforeEach(() => { process.env['WORKER_INTERNAL_TOKEN'] = TOKEN; });
  afterEach(() => {
    if (originalToken === undefined) delete process.env['WORKER_INTERNAL_TOKEN'];
    else process.env['WORKER_INTERNAL_TOKEN'] = originalToken;
  });

  const takeNew = () => {
    const from = shadowRecords.length;
    const fromFlush = shadowFlushes.length;
    return () => ({ records: shadowRecords.slice(from), flushes: shadowFlushes.slice(fromFlush) });
  };

  it('gives each of the four endpoints its own surface, all under dashboard_notifications', async () => {
    const { controller } = makeController();
    const since = takeNew();

    await controller.handleGenerateSnapshot('co-1', TOKEN, { periodKind: 'today' } as any);
    await controller.stockLow('co-1', TOKEN);
    await controller.dailySummary('co-1', TOKEN, {} as any);
    await controller.delivery('co-1', 'del-1', TOKEN);

    const { records, flushes } = since();
    assert.deepEqual(records.map((r) => r.surface), [
      'notifications.ondemand.snapshot',
      'notifications.ondemand.stock_low',
      'notifications.ondemand.daily_owner_summary',
      'notifications.ondemand.delivery',
    ]);
    assert.ok(records.every((r) => r.companyId === 'co-1' && r.featureKey === 'dashboard_notifications'));
    assert.equal(flushes.length, 4);
  });

  it('never records for a company the active-company guard rejected', async () => {
    const { controller } = makeController({ company: null });
    const since = takeNew();
    await assert.rejects(() => controller.stockLow('co-forged', TOKEN));
    assert.deepEqual(since().records, []);
  });

  it('never records when the worker token is wrong', async () => {
    const { controller } = makeController();
    const since = takeNew();
    await assert.rejects(() => controller.stockLow('co-1', 'wrong'));
    assert.deepEqual(since().records, []);
  });
});
