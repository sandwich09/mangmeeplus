import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_OUTBOX_CLAIM_BATCH,
  OUTBOX_PROCESSING_LEASE_MS,
  PrismaOutboxRepository,
} from './prisma-outbox.repository';

const now = new Date();

const baseRow = {
  id: 'out-1',
  companyId: 'co-1',
  eventType: 'test.event',
  aggregateType: 'Branch',
  aggregateId: 'b-1',
  eventKey: 'key-1',
  payloadJson: { aggregateId: 'b-1', aggregateType: 'Branch', occurredAt: now.toISOString(), data: {} },
  headersJson: null,
  status: 'PENDING',
  priority: 'NORMAL',
  attempts: 0,
  availableAt: now,
  lockedAt: null,
  lockedBy: null,
  publishedAt: null,
  lastError: null,
  createdAt: now,
  updatedAt: now,
};

function makeClient(overrides: Record<string, any> = {}, clientOverrides: Record<string, any> = {}) {
  return {
    $queryRaw: mock.fn(async () => []),
    ...clientOverrides,
    outboxEvent: {
      findUnique: mock.fn(async () => null),
      findUniqueOrThrow: mock.fn(async () => ({ ...baseRow })),
      create: mock.fn(async () => ({ ...baseRow })),
      findMany: mock.fn(async () => []),
      updateMany: mock.fn(async () => ({ count: 0 })),
      update: mock.fn(async () => ({ ...baseRow })),
      ...overrides,
    },
  };
}

function makeRepo(clientOverrides: Record<string, any> = {}, rootOverrides: Record<string, any> = {}) {
  const client = makeClient(clientOverrides, rootOverrides);
  const prisma = { client } as any;
  return { repo: new PrismaOutboxRepository(prisma), client };
}

/** The parameterized SQL text of the Nth `$queryRaw` call, whitespace-collapsed. */
function rawSql(client: any, call = 0): string {
  return String(client.$queryRaw.mock.calls[call].arguments[0].sql).replace(/\s+/g, ' ').trim();
}
function rawValues(client: any, call = 0): unknown[] {
  return client.$queryRaw.mock.calls[call].arguments[0].values;
}

const validPayload = {
  companyId: 'co-1',
  aggregateId: 'b-1',
  aggregateType: 'Branch',
  occurredAt: now.toISOString(),
  data: {},
};

const appendInput = {
  companyId: 'co-1',
  eventType: 'test.event',
  aggregateType: 'Branch',
  aggregateId: 'b-1',
  eventKey: 'key-1',
  payloadJson: validPayload as unknown as Record<string, unknown>,
};

describe('PrismaOutboxRepository', () => {
  describe('append', () => {
    it('stores a new event', async () => {
      const { repo } = makeRepo();
      const result = await repo.append(appendInput);
      assert.equal(result.id, 'out-1');
      assert.equal(result.status, 'PENDING');
    });

    it('returns existing event on duplicate eventKey (idempotency)', async () => {
      const existing = { ...baseRow };
      const { repo, client } = makeRepo({
        findUnique: mock.fn(async () => existing),
      });
      const result = await repo.append(appendInput);
      assert.equal(result.id, 'out-1');
      // create should NOT be called
      assert.equal((client.outboxEvent.create.mock.calls as any[]).length, 0);
    });

    it('throws if payload exceeds 64 KB', async () => {
      const { repo } = makeRepo();
      const bigPayload = { data: 'x'.repeat(65_000) };
      await assert.rejects(
        () => repo.append({ ...appendInput, payloadJson: bigPayload }),
        /64 KB/,
      );
    });
  });

  describe('claimBatch', () => {
    it('returns empty array when no claimable events', async () => {
      const { repo } = makeRepo();
      const result = await repo.claimBatch({ batchSize: 10, claimedBy: 'worker-1' });
      assert.deepEqual(result, []);
    });

    // F0.E §3: the old findMany→updateMany pair double-claimed 99.5-100% of rows at N>=2 because
    // the update never re-checked `status`. These pin the shape that makes zero the invariant; the
    // behaviour itself is proven against a real database in `prisma-outbox.repository.claim.spec.ts`.
    it('claims in ONE statement with FOR UPDATE SKIP LOCKED', async () => {
      const { repo, client } = makeRepo();
      await repo.claimBatch({ batchSize: 10, claimedBy: 'worker-1' });
      assert.equal(client.$queryRaw.mock.calls.length, 1, 'one statement, not a read then a write');
      assert.equal(client.outboxEvent.findMany.mock.calls.length, 0);
      assert.equal(client.outboxEvent.updateMany.mock.calls.length, 0);
      const sql = rawSql(client);
      assert.match(sql, /FOR UPDATE SKIP LOCKED/);
      assert.match(sql, /RETURNING/);
      assert.match(sql, /status IN \('PENDING', 'FAILED'\)/);
    });

    it('does not sort on the inert priority key (F0.E §4 F6)', async () => {
      const { repo, client } = makeRepo();
      await repo.claimBatch({ batchSize: 10, claimedBy: 'worker-1' });
      const sql = rawSql(client);
      assert.match(sql, /ORDER BY "availableAt" ASC/);
      assert.equal(/ORDER BY[^)]*priority/i.test(sql), false, 'priority is inert and forces an O(backlog) sort');
    });

    it('supports mutually exclusive include/exclude consumer filters in the atomic claim', async () => {
      const included = makeRepo();
      await included.repo.claimBatch({
        batchSize: 10,
        claimedBy: 'cleanup-worker',
        eventTypes: ['storage.object_version_cleanup.requested'],
      });
      assert.match(rawSql(included.client), /"eventType" IN \(/);
      assert.equal(rawValues(included.client).includes('storage.object_version_cleanup.requested'), true);

      const excluded = makeRepo();
      await excluded.repo.claimBatch({
        batchSize: 10,
        claimedBy: 'workflow-worker',
        excludeEventTypes: ['storage.object_version_cleanup.requested'],
      });
      assert.match(rawSql(excluded.client), /"eventType" NOT IN \(/);
      await assert.rejects(() => excluded.repo.claimBatch({
        batchSize: 10,
        claimedBy: 'invalid-worker',
        eventTypes: ['a'],
        excludeEventTypes: ['b'],
      }), /cannot include and exclude/);
    });

    it('caps the caller-controlled batch at MAX_OUTBOX_CLAIM_BATCH', async () => {
      const { repo, client } = makeRepo();
      await repo.claimBatch({ batchSize: 5_000, claimedBy: 'worker-1' });
      assert.equal(rawValues(client).includes(MAX_OUTBOX_CLAIM_BATCH), true);
    });

    it('returns the post-update row rather than fabricating the claimed state', async () => {
      const claimed = { ...baseRow, status: 'PROCESSING', lockedAt: now, lockedBy: 'worker-1' };
      const { repo } = makeRepo({}, { $queryRaw: mock.fn(async () => [claimed]) });
      const [record] = await repo.claimBatch({ batchSize: 1, claimedBy: 'worker-1' });
      assert.equal(record!.status, 'PROCESSING');
      assert.equal(record!.lockedBy, 'worker-1');
    });
  });

  describe('reclaimStalledProcessing', () => {
    it('only touches PROCESSING rows past the lease, and never resurrects DEAD', async () => {
      const { repo, client } = makeRepo({}, { $queryRaw: mock.fn(async () => []) });
      const at = new Date('2026-07-31T10:00:00.000Z');
      await repo.reclaimStalledProcessing(at);
      const sql = rawSql(client);
      assert.match(sql, /WHERE status = 'PROCESSING' AND "lockedAt" < /);
      assert.equal(/DEAD'::"OutboxEventStatus" ELSE 'PENDING'/.test(sql), true, 'exhausted rows terminalize, the rest requeue');
      const cutoff = rawValues(client).find((value) => value instanceof Date) as Date;
      assert.equal(at.getTime() - cutoff.getTime(), OUTBOX_PROCESSING_LEASE_MS);
    });

    it('splits the returned rows into reclaimed vs newly dead', async () => {
      const { repo } = makeRepo({}, {
        $queryRaw: mock.fn(async () => [{ status: 'PENDING' }, { status: 'PENDING' }, { status: 'DEAD' }]),
      });
      assert.deepEqual(await repo.reclaimStalledProcessing(), { reclaimed: 2, dead: 1 });
    });
  });

  describe('markFailed', () => {
    it('increments attempts and schedules backoff', async () => {
      const row = { ...baseRow, attempts: 1 };
      const updateManyFn = mock.fn(async () => ({ count: 1 }));
      const { repo } = makeRepo({
        findUnique: mock.fn(async () => row),
        updateMany: updateManyFn,
      });
      assert.equal(await repo.markFailed({ id: 'out-1', error: 'timeout', claimToken: 'tok-1' }), true);
      const updateArg = (updateManyFn.mock.calls as any[])[0]?.arguments[0];
      assert.equal(updateArg.data.attempts, 2);
      assert.equal(updateArg.data.status, 'FAILED');
      assert.ok(updateArg.data.availableAt > now);
    });

    it('marks as DEAD after 5 attempts', async () => {
      const row = { ...baseRow, attempts: 4 };
      const updateManyFn = mock.fn(async () => ({ count: 1 }));
      const { repo } = makeRepo({
        findUnique: mock.fn(async () => row),
        updateMany: updateManyFn,
      });
      await repo.markFailed({ id: 'out-1', error: 'timeout' });
      const updateArg = (updateManyFn.mock.calls as any[])[0]?.arguments[0];
      assert.equal(updateArg.data.status, 'DEAD');
      assert.equal(updateArg.data.attempts, 5);
    });
  });

  // F1.5b P0-4. The behaviour is proven against a real database in
  // `prisma-outbox.repository.claim.spec.ts`; these pin the statement shape that makes it possible.
  describe('claim fencing (P0-4)', () => {
    it('mints one token per claimed row inside the claim statement', async () => {
      const { repo, client } = makeRepo();
      await repo.claimBatch({ batchSize: 10, claimedBy: 'worker-1' });
      // VOLATILE, so it is evaluated per row rather than once for the whole UPDATE.
      assert.match(rawSql(client), /"claimToken" = gen_random_uuid\(\)::text/);
    });

    it('returns the minted token to the caller so it can be threaded back', async () => {
      const claimed = { ...baseRow, status: 'PROCESSING', lockedBy: 'worker-1', claimToken: 'tok-1' };
      const { repo } = makeRepo({}, { $queryRaw: mock.fn(async () => [claimed]) });
      const [record] = await repo.claimBatch({ batchSize: 1, claimedBy: 'worker-1' });
      assert.equal(record!.claimToken, 'tok-1');
    });

    it('completes with a CAS on {id, PROCESSING, claimToken} — never a bare update by id', async () => {
      const updateManyFn = mock.fn(async () => ({ count: 1 }));
      const { repo, client } = makeRepo({ updateMany: updateManyFn });
      await repo.markPublished({ id: 'out-1', claimToken: 'tok-1' });
      assert.equal(client.outboxEvent.update.mock.calls.length, 0, 'update-by-id can overwrite a newer claimer');
      assert.deepEqual((updateManyFn.mock.calls as any[])[0]?.arguments[0].where, {
        id: 'out-1',
        status: 'PROCESSING',
        claimToken: 'tok-1',
      });
    });

    it('reports a lost lease instead of throwing when the CAS matches nothing', async () => {
      const { repo } = makeRepo({ updateMany: mock.fn(async () => ({ count: 0 })), findUnique: mock.fn(async () => baseRow) });
      assert.equal(await repo.markPublished({ id: 'out-1', claimToken: 'stale' }), false);
      assert.equal(await repo.markFailed({ id: 'out-1', error: 'boom', claimToken: 'stale' }), false);
    });

    it('optionally fences completion to the consumer event type', async () => {
      const updateManyFn = mock.fn(async () => ({ count: 1 }));
      const { repo } = makeRepo({
        findUnique: mock.fn(async () => ({ ...baseRow, eventType: 'storage.object_version_cleanup.requested' })),
        updateMany: updateManyFn,
      });
      await repo.markPublished({
        id: 'out-1', claimToken: 'tok-1', expectedEventType: 'storage.object_version_cleanup.requested',
      });
      assert.equal(
        (updateManyFn.mock.calls as any[])[0]?.arguments[0].where.eventType,
        'storage.object_version_cleanup.requested',
      );
      assert.equal(await repo.markFailed({
        id: 'out-1', claimToken: 'tok-1', error: 'failed', expectedEventType: 'another.consumer',
      }), false);
    });

    it('releases the token when the reclaim returns a row to PENDING', async () => {
      const { repo, client } = makeRepo({}, { $queryRaw: mock.fn(async () => []) });
      await repo.reclaimStalledProcessing();
      assert.match(rawSql(client), /"claimToken" = NULL/);
    });
  });
});
