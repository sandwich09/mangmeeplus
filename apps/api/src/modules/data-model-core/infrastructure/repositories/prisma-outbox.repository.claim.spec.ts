/**
 * REAL-DATABASE spec for the atomic outbox claim and the PROCESSING lease reclaim.
 *
 * The double-claim bug F0.E §3 measured is invisible to a mocked test — it only exists when two
 * connections race one another — so this is the only place the "zero double-claims" invariant is
 * actually proven. `prisma-outbox.repository.spec.ts` pins the statement shape; this pins the
 * behaviour.
 *
 * SKIPS (never fails) when no database is reachable, so the suite still exits 0 without one.
 *
 * Safety: every row it creates is tagged and deleted afterwards, and any pre-existing claimable row
 * is parked out of the claim predicate for the duration and restored exactly — the claim SQL is the
 * production one and has no tenant filter, so it would otherwise claim real local rows.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../../generated/prisma/client';
import {
  MAX_OUTBOX_ATTEMPTS,
  OUTBOX_PROCESSING_LEASE_MS,
  PrismaOutboxRepository,
} from './prisma-outbox.repository';

const TAG = `f1c4-claim-${process.pid}`;
const SEEDED = 40;

/**
 * The ROOT `.env` is the real local database (docker `127.0.0.1:15432/watchdog_bms`).
 * `apps/api/.env` carries a stale `5432/mydb` URL that only the Prisma CLI should ever see.
 */
function rootDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(__dirname, '../'.repeat(7), '.env'), 'utf8');
    return /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(env)?.[1] ?? null;
  } catch {
    return null;
  }
}

function connect(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

describe('PrismaOutboxRepository claim/reclaim (real database)', () => {
  let clients: PrismaClient[] = [];
  let repos: PrismaOutboxRepository[] = [];
  let reachable = false;
  let parked: Array<{ id: string; availableAt: Date }> = [];

  before(async () => {
    const url = rootDatabaseUrl();
    if (!url) return;
    try {
      clients = [connect(url), connect(url)];
      await clients[0]!.$queryRaw`SELECT 1`;
      reachable = true;
    } catch {
      reachable = false;
      return;
    }
    repos = clients.map((client) => new PrismaOutboxRepository({ client } as any));

    parked = await clients[0]!.$queryRaw<Array<{ id: string; availableAt: Date }>>`
      SELECT id, "availableAt" FROM "OutboxEvent"
      WHERE status IN ('PENDING', 'FAILED') AND "availableAt" <= now() AND "eventKey" NOT LIKE ${`${TAG}%`}
    `;
    if (parked.length > 0) {
      await clients[0]!.outboxEvent.updateMany({
        where: { id: { in: parked.map((row) => row.id) } },
        data: { availableAt: new Date(Date.now() + 86_400_000) },
      });
    }
  });

  after(async () => {
    if (!reachable) return;
    await clients[0]!.outboxEvent.deleteMany({ where: { eventKey: { startsWith: TAG } } });
    for (const row of parked) {
      await clients[0]!.outboxEvent.update({ where: { id: row.id }, data: { availableAt: row.availableAt } });
    }
    await Promise.all(clients.map((client) => client.$disconnect()));
  });

  async function seed(prefix: string, count: number, overrides: Record<string, unknown> = {}): Promise<void> {
    await clients[0]!.outboxEvent.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        // companyId stays null so the probe needs no Company row and touches no tenant data.
        eventType: 'f1c4.probe',
        aggregateType: 'Probe',
        aggregateId: `${prefix}-${index}`,
        eventKey: `${TAG}:${prefix}:${index}`,
        payloadJson: {},
        availableAt: new Date(Date.now() - 1_000),
        ...overrides,
      })),
    });
  }

  it('two parallel claimers never claim the same row', async (t) => {
    if (!reachable) return t.skip('no database reachable — start docker postgres on 127.0.0.1:15432');
    await seed('race', SEEDED);

    const grants: string[] = [];
    await Promise.all(
      repos.map(async (repo, index) => {
        for (;;) {
          const claimed = await repo.claimBatch({ batchSize: 5, claimedBy: `probe-${index}` });
          if (claimed.length === 0) return;
          grants.push(...claimed.map((event) => event.id));
        }
      }),
    );

    const distinct = new Set(grants);
    // F0.E §3 measured 31,650 duplicate grants at N=10 on the old claim. The invariant is 0, not "few".
    assert.equal(grants.length - distinct.size, 0, 'a row was granted to more than one claimer');
    const mine = await clients[0]!.outboxEvent.count({ where: { eventKey: { startsWith: `${TAG}:race:` } } });
    assert.equal(mine, SEEDED);
    const claimedMine = await clients[0]!.outboxEvent.count({
      where: { eventKey: { startsWith: `${TAG}:race:` }, status: 'PROCESSING' },
    });
    assert.equal(claimedMine, SEEDED, 'every seeded row was claimed exactly once');
  });

  it('reclaims a stalled PROCESSING row exactly once', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await seed('stall', 1);
    const [claimed] = await repos[0]!.claimBatch({ batchSize: 1, claimedBy: 'probe-crashed' });
    assert.ok(claimed, 'seeded row was claimable');

    // Simulate the claimer dying: its lease ages past the limit while the row stays PROCESSING.
    await clients[0]!.outboxEvent.update({
      where: { id: claimed!.id },
      data: { lockedAt: new Date(Date.now() - OUTBOX_PROCESSING_LEASE_MS - 60_000) },
    });

    const first = await repos[0]!.reclaimStalledProcessing();
    assert.equal(first.reclaimed, 1);
    const requeued = await clients[0]!.outboxEvent.findUniqueOrThrow({ where: { id: claimed!.id } });
    assert.equal(requeued.status, 'PENDING');
    assert.equal(requeued.attempts, 1);
    assert.equal(requeued.lockedBy, null);

    // Once requeued it is no longer PROCESSING, so a second sweep cannot count it again.
    assert.equal((await repos[0]!.reclaimStalledProcessing()).reclaimed, 0);
  });

  /**
   * F1.5b P0-4. The live sequence the owner review named: a claimer stalls, the reclaim requeues its
   * row, a second claimer picks it up — and then the FIRST worker wakes up and finishes. Without a
   * fencing token its `markPublished` would publish work the new claimer is still processing.
   */
  it('a stale claimer cannot complete a row that was reclaimed and re-claimed', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await seed('fence', 1);
    const [first] = await repos[0]!.claimBatch({ batchSize: 1, claimedBy: 'probe-stale' });
    assert.ok(first?.claimToken, 'the claim minted a fencing token');

    // The claimer stalls past its lease and the reclaim hands the row back to the queue.
    await clients[0]!.outboxEvent.update({
      where: { id: first!.id },
      data: { lockedAt: new Date(Date.now() - OUTBOX_PROCESSING_LEASE_MS - 60_000) },
    });
    assert.equal((await repos[0]!.reclaimStalledProcessing()).reclaimed, 1);

    const [second] = await repos[1]!.claimBatch({ batchSize: 1, claimedBy: 'probe-fresh' });
    assert.equal(second?.id, first!.id, 'the same row was re-claimed');
    assert.notEqual(second!.claimToken, first!.claimToken, 'the reclaim revoked the old lease');

    // The dead worker wakes up and finishes. Both completion paths must be no-ops.
    assert.equal(await repos[0]!.markPublished({ id: first!.id, claimToken: first!.claimToken }), false);
    assert.equal(await repos[0]!.markFailed({ id: first!.id, error: 'zombie', claimToken: first!.claimToken }), false);
    const held = await clients[0]!.outboxEvent.findUniqueOrThrow({ where: { id: first!.id } });
    assert.equal(held.status, 'PROCESSING', 'the new claimer still owns the row');
    assert.equal(held.claimToken, second!.claimToken);
    assert.equal(held.lockedBy, 'probe-fresh');

    // The rightful holder completes exactly once, and its own token is spent afterwards.
    assert.equal(await repos[1]!.markPublished({ id: second!.id, claimToken: second!.claimToken }), true);
    const done = await clients[0]!.outboxEvent.findUniqueOrThrow({ where: { id: first!.id } });
    assert.equal(done.status, 'PUBLISHED');
    assert.equal(done.claimToken, null);
    assert.equal(await repos[1]!.markPublished({ id: second!.id, claimToken: second!.claimToken }), false);
  });

  it('terminalizes an exhausted stalled row and never resurrects a DEAD one', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const stale = new Date(Date.now() - OUTBOX_PROCESSING_LEASE_MS - 60_000);
    await seed('exhausted', 1, { status: 'PROCESSING', lockedAt: stale, attempts: MAX_OUTBOX_ATTEMPTS - 1 });
    await seed('dead', 1, { status: 'DEAD', lockedAt: stale, attempts: MAX_OUTBOX_ATTEMPTS });

    const result = await repos[0]!.reclaimStalledProcessing();
    assert.equal(result.dead, 1, 'the exhausted row terminalizes instead of looping forever');
    assert.equal(result.reclaimed, 0);

    const dead = await clients[0]!.outboxEvent.findUniqueOrThrow({ where: { eventKey: `${TAG}:dead:0` } });
    assert.equal(dead.status, 'DEAD');
    assert.equal(dead.attempts, MAX_OUTBOX_ATTEMPTS, 'the pre-existing DEAD row was not touched at all');
  });
});
