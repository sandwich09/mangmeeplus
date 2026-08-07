import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { WorkflowInternalController } from './workflow-internal.controller';

const TOKEN = 'worker-secret';

function makeController(opts: { company?: { id: string } | null; ingestThrows?: boolean } = {}) {
  const companyQueries: any[] = [];
  const ingestCalls: any[] = [];
  const shadowRecords: any[] = [];
  const flushes: string[] = [];

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
  const ingestEvent = {
    execute: async (body: any) => {
      ingestCalls.push(body);
      if (opts.ingestThrows) throw new Error('ingest blew up');
      return { matchedRuleCount: 0, skipped: true };
    },
  } as any;
  const drainOutbox = { execute: async () => ({}) } as any;
  const runScan = { execute: async () => ({}) } as any;
  const retryDue = { execute: async () => ({}) } as any;
  const shadow = {
    startSweep: (surface: string) => ({
      record: async (companyId: string | null, featureKey: string | null) => {
        shadowRecords.push({ surface, companyId, featureKey });
        return { wouldBlock: false, reason: 'available' as const };
      },
      flush: async () => { flushes.push(surface); return {}; },
    }),
  } as any;

  const controller = new WorkflowInternalController(prisma, ingestEvent, drainOutbox, runScan, retryDue, shadow);
  return { controller, companyQueries, ingestCalls, shadowRecords, flushes };
}

describe('WorkflowInternalController.ingest (H-14)', () => {
  const originalToken = process.env['WORKER_INTERNAL_TOKEN'];

  beforeEach(() => {
    process.env['WORKER_INTERNAL_TOKEN'] = TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env['WORKER_INTERNAL_TOKEN'];
    else process.env['WORKER_INTERNAL_TOKEN'] = originalToken;
  });

  const envelope = { companyId: 'co-1', eventId: 'e-1', eventType: 'x', sourceModule: 'm', sourceType: 't', sourceId: 's', payload: {} } as any;

  it('rejects a bad worker token before touching the database', async () => {
    const { controller, companyQueries, ingestCalls, shadowRecords } = makeController();
    await assert.rejects(() => controller.ingest('wrong', { ...envelope }), UnauthorizedException);
    assert.equal(companyQueries.length, 0);
    assert.equal(ingestCalls.length, 0);
    assert.deepEqual(shadowRecords, []);
  });

  it('refuses a forged event aimed at a non-existent/inactive company', async () => {
    const { controller, companyQueries, ingestCalls, shadowRecords } = makeController({ company: null });
    await assert.rejects(() => controller.ingest(TOKEN, { ...envelope, companyId: 'co-forged' }), NotFoundException);
    assert.deepEqual(companyQueries[0].where, { id: 'co-forged', status: 'ACTIVE' });
    assert.equal(ingestCalls.length, 0);
    // The counter never sees a tenant id the active-company guard rejected.
    assert.deepEqual(shadowRecords, []);
  });

  it('ingests an event for an ACTIVE company', async () => {
    const { controller, ingestCalls } = makeController();
    await controller.ingest(TOKEN, { ...envelope });
    assert.equal(ingestCalls.length, 1);
    assert.equal(ingestCalls[0].companyId, 'co-1');
  });

  it('records one shadow observation per ingested event and ingests regardless', async () => {
    const { controller, ingestCalls, shadowRecords, flushes } = makeController();
    await controller.ingest(TOKEN, { ...envelope });
    assert.deepEqual(shadowRecords, [
      { surface: 'workflow.events.ingest', companyId: 'co-1', featureKey: 'workflow_automation' },
    ]);
    // SHADOW ONLY: the observation never gates the work.
    assert.equal(ingestCalls.length, 1);
    assert.deepEqual(flushes, ['workflow.events.ingest']);
  });

  it('flushes buffered evidence when the ingest throws (finally, not a trailing await)', async () => {
    const { controller, shadowRecords, flushes } = makeController({ ingestThrows: true });
    await assert.rejects(() => controller.ingest(TOKEN, { ...envelope }), /ingest blew up/);
    // Mutation guard: with `await sweep.flush()` moved out of the `finally` this assertion fails,
    // and the observation would vanish with no bucket row and no persist_failed warn.
    assert.equal(shadowRecords.length, 1);
    assert.deepEqual(flushes, ['workflow.events.ingest']);
  });
});
