import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { DrainWorkflowOutboxUseCase, outboxEventFeatureKey } from './workflow-outbox-drain.use-case';

function makeDrain(opts: { events?: any[]; dead?: number; wouldBlock?: boolean; leaseLost?: boolean; ingestThrows?: boolean } = {}) {
  const calls: string[] = [];
  const shadowRecords: any[] = [];
  const logs: any[] = [];
  const completions: any[] = [];
  const claims: any[] = [];

  // P0-4: a completion returns whether this worker still held its claim lease.
  const held = () => !opts.leaseLost;
  const outbox = {
    reclaimStalledProcessing: async () => { calls.push('reclaim'); return { reclaimed: 2, dead: 1 }; },
    countDead: async () => opts.dead ?? 0,
    claimBatch: async (input: any) => { calls.push('claim'); claims.push(input); return opts.events ?? []; },
    markPublished: async (input: any) => { calls.push(`published:${input.id}`); completions.push(input); return held(); },
    markFailed: async (input: any) => { calls.push(`failed:${input.id}`); completions.push(input); return held(); },
  } as any;

  const ingest = {
    execute: async () => {
      calls.push('ingest');
      if (opts.ingestThrows) throw new Error('handler blew up');
    },
  } as any;

  const shadow = {
    startSweep: (surface: string) => ({
      record: async (companyId: string | null, featureKey: string | null) => {
        shadowRecords.push({ surface, companyId, featureKey, wouldBlock: opts.wouldBlock ?? false });
        return { wouldBlock: opts.wouldBlock ?? false, reason: 'available' as const };
      },
      flush: () => ({}),
    }),
  } as any;

  const logger = { warn: (payload: any) => logs.push(payload), info: () => {}, error: () => {} } as any;
  return { drain: new DrainWorkflowOutboxUseCase(outbox, ingest, shadow, logger), calls, claims, shadowRecords, logs, completions };
}

const event = (overrides: any = {}) => ({
  id: 'evt-1',
  companyId: 'co-1',
  eventType: 'expense.receipt_uploaded',
  aggregateType: 'ExpenseRecord',
  aggregateId: 'exp-1',
  eventKey: 'k-1',
  payloadJson: {},
  claimToken: 'tok-1',
  createdAt: new Date(),
  ...overrides,
});

describe('outbox event → owning feature (shadow mapping)', () => {
  it('maps producer prefixes from the F0 async-surface inventory', () => {
    assert.equal(outboxEventFeatureKey('journal.posted'), 'double_entry_ledger');
    assert.equal(outboxEventFeatureKey('period.closed'), 'double_entry_ledger');
    assert.equal(outboxEventFeatureKey('expense.receipt_uploaded'), 'expenses');
    assert.equal(outboxEventFeatureKey('accounting.invoice.issued'), 'sales_documents');
    assert.equal(outboxEventFeatureKey('supplier_payment.recorded'), 'procurement');
    assert.equal(outboxEventFeatureKey('tax.document_tax.finalized'), 'thai_tax');
  });

  it('returns null rather than guessing at an unknown prefix', () => {
    assert.equal(outboxEventFeatureKey('something.new'), null);
    assert.equal(outboxEventFeatureKey(''), null);
  });
});

describe('DrainWorkflowOutboxUseCase', () => {
  it('reclaims stalled PROCESSING rows before claiming', async () => {
    const { drain, calls } = makeDrain();
    const result = await drain.execute();
    assert.equal(calls.indexOf('reclaim') < calls.indexOf('claim'), true);
    assert.equal(result.reclaimed, 2);
  });

  it('never claims exact-version cleanup work owned by the S3 cleanup worker', async () => {
    const { drain, claims } = makeDrain();
    await drain.execute();
    assert.deepEqual(claims[0].excludeEventTypes, ['storage.object_version_cleanup.requested']);
  });

  it('logs DEAD rows each sweep at HIGH risk (no handler exists yet)', async () => {
    const { drain, logs } = makeDrain({ dead: 3 });
    const result = await drain.execute();
    assert.equal(result.dead, 3);
    assert.equal(logs[0].event, 'outbox.dead_rows');
    assert.equal(logs[0].riskLevel, 'HIGH');
  });

  it('stays silent when there are no DEAD rows', async () => {
    const { drain, logs } = makeDrain({ dead: 0 });
    await drain.execute();
    assert.deepEqual(logs, []);
  });

  // The whole point of shadow: it MEASURES, it never decides.
  it('records would_block per event without changing what gets published', async () => {
    const events = [event(), event({ id: 'evt-2', eventType: 'crm.lead.created' })];
    const blocked = makeDrain({ events, wouldBlock: true });
    const allowed = makeDrain({ events, wouldBlock: false });

    const blockedResult = await blocked.drain.execute();
    const allowedResult = await allowed.drain.execute();

    assert.deepEqual(blockedResult, allowedResult, 'the shadow decision changed the outcome');
    assert.equal(blockedResult.published, 2);
    assert.equal(blocked.calls.filter((call) => call === 'ingest').length, 2, 'every event still dispatched');
    assert.deepEqual(
      blocked.shadowRecords.map((row) => [row.surface, row.companyId, row.featureKey, row.wouldBlock]),
      [['outbox.drain', 'co-1', 'expenses', true], ['outbox.drain', 'co-1', 'crm', true]],
    );
  });

  it('records platform-level events with a null company and still publishes them', async () => {
    const { drain, calls, shadowRecords } = makeDrain({ events: [event({ companyId: null })], wouldBlock: true });
    const result = await drain.execute();
    assert.equal(result.published, 1);
    assert.equal(calls.includes('published:evt-1'), true);
    assert.equal(shadowRecords[0].companyId, null);
  });

  // F1.5b P0-4: the claim lease travels with the event through both completion paths.
  describe('claim-lease fencing (P0-4)', () => {
    it('threads the claim token into every completion, tenant and platform alike', async () => {
      const published = makeDrain({ events: [event(), event({ id: 'evt-2', companyId: null, claimToken: 'tok-2' })] });
      await published.drain.execute();
      assert.deepEqual(published.completions, [
        { id: 'evt-1', claimToken: 'tok-1' },
        { id: 'evt-2', claimToken: 'tok-2' },
      ]);

      const failed = makeDrain({ events: [event()], ingestThrows: true });
      await failed.drain.execute();
      assert.equal(failed.completions[0].claimToken, 'tok-1');
      assert.equal(failed.completions[0].error, 'handler blew up');
    });

    it('counts nothing and logs when the lease was lost mid-handler', async () => {
      const { drain, logs } = makeDrain({ events: [event()], leaseLost: true });
      const result = await drain.execute();
      assert.equal(result.published, 0, 'another claimer owns the row — this worker published nothing');
      assert.equal(result.failed, 0);
      assert.equal(logs[0].event, 'outbox.lost_lease');
      assert.equal(logs[0].outboxEventId, 'evt-1');
    });

    it('does not throw on a lost lease — a reclaim is expected, not an error', async () => {
      const { drain } = makeDrain({ events: [event(), event({ id: 'evt-2' })], leaseLost: true });
      await assert.doesNotReject(() => drain.execute());
    });
  });
});

/**
 * The real probe against a fake database, so the fold is exercised end to end rather than stubbed.
 * The drain's per-event `try/catch` only wraps INGESTION — a throw from the outbox repository on the
 * platform-level branch escapes it and used to take the whole sweep's buffered evidence with it: no
 * bucket row, no persist_failed warn, and later healthy sweeps would leave the health view looking
 * normal while a BLOCKING observation had vanished.
 */
function makeDrainThatThrowsMidSweep() {
  const upserts: any[] = [];
  const prisma = {
    client: {
      // CLOSED, so the observation this sweep buffers is a would_block — the evidence that matters.
      featureLaunchGate: { findMany: async () => [{ gateKey: 'expenses', routeKey: 'DEFAULT', state: 'CLOSED', generation: 1 }] },
      companyFeatureEntitlement: { findMany: async () => [] },
      featureLaunchObservationBucket: { upsert: async (args: any) => { upserts.push(args); return { id: 'bucket-1' }; } },
    },
  } as any;
  const logger = { warn: () => {}, info: () => {}, error: () => {} } as any;

  const outbox = {
    reclaimStalledProcessing: async () => ({ reclaimed: 0, dead: 0 }),
    countDead: async () => 0,
    // Platform-level work: its completion runs OUTSIDE the per-event ingestion try/catch.
    claimBatch: async () => [event({ companyId: null })],
    markPublished: async () => { throw new Error('OUTBOX_WRITE_FAILED'); },
    markFailed: async () => true,
  } as any;
  const ingest = { execute: async () => {} } as any;

  return {
    drain: new DrainWorkflowOutboxUseCase(outbox, ingest, new LaunchShadowProbe(prisma, logger), logger),
    upserts,
  };
}

describe('DrainWorkflowOutboxUseCase — buffered evidence survives a mid-sweep failure', () => {
  it('persists the recorded would_block and still propagates the original error', async () => {
    const { drain, upserts } = makeDrainThatThrowsMidSweep();

    await assert.rejects(() => drain.execute(), /OUTBOX_WRITE_FAILED/, 'the flush must not mask the real failure');

    assert.equal(upserts.length, 1, 'the observation buffered before the throw was lost');
    const key = upserts[0].where.bucketKey;
    assert.equal(key.gateKey, 'expenses');
    assert.equal(key.surface, 'outbox.drain');
    assert.equal(key.reason, 'launch_gate_closed');
    assert.equal(key.wouldBlock, true);
    assert.equal(upserts[0].create.observedCount, 1);
  });
});
