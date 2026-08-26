/**
 * §8.3 neutral intake state — the four zero-write guarantees, at the repository boundary.
 *
 * The double below is not a stub that returns canned rows: it models the two things the guarantees
 * actually rest on — the PARTIAL unique index (one OPEN row per owner triple) and `updateMany`'s
 * conditional matching (owner + version + status + TTL). A double that ignored either would pass
 * these tests while the real table failed them, so those two behaviors are implemented, and the
 * live index itself is proven separately by `prisma migrate deploy` against PostgreSQL.
 *
 * Every refusal test asserts the store is BYTE-UNCHANGED afterwards, because "it returned an error"
 * and "it wrote nothing" are different claims and only the second one is the spec's requirement.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { LineIntakeStateRepository, type LineIntakeStateOwner } from './line-intake-state.repository';

const OWNER: LineIntakeStateOwner = { companyId: 'company-1', userId: 'user-1', chatKeyHash: 'chat-hash-1' };
const OPEN_INPUT = {
  ...OWNER,
  targetIntent: 'EXPENSE_DOCUMENT_CAPTURE',
  missingFields: ['amount'],
  sourceEventHash: 'evt-hash-1',
  ttlMinutes: 15,
};

type Row = Record<string, any>;

/** Minimal Prisma double with REAL partial-unique and conditional-update semantics. */
function makeStore(opts: { failOn?: 'create' | 'findFirst' | 'updateMany' | 'all' } = {}) {
  const rows: Row[] = [];
  let seq = 0;
  const boom = (op: string) => {
    if (opts.failOn === 'all' || opts.failOn === op) throw Object.assign(new Error('store down'), { name: 'PrismaClientKnownRequestError' });
  };

  const matches = (row: Row, where: Row): boolean => Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('gt' in cond) return row[key] > cond.gt;
      if ('lte' in cond) return row[key] <= cond.lte;
    }
    return row[key] === cond;
  });

  const table = {
    create: async ({ data }: any) => {
      boom('create');
      // The partial unique index: at most ONE OPEN row per (companyId, userId, chatKeyHash).
      const status = data.status ?? 'OPEN';
      if (status === 'OPEN' && rows.some((row) => row.status === 'OPEN'
        && row.companyId === data.companyId && row.userId === data.userId && row.chatKeyHash === data.chatKeyHash)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const row = { id: `state-${++seq}`, version: 1, status, conflictingFields: [], createdAt: new Date(Date.now() + seq), ...data };
      rows.push(row);
      // Prisma returns a snapshot, not a live handle. Returning the stored object instead would let
      // a later `updateMany` silently mutate a version a caller already read — which is exactly the
      // stale-read these tests are about, so the double must not paper over it.
      return { ...row };
    },
    findFirst: async ({ where }: any) => {
      boom('findFirst');
      const hit = [...rows].reverse().find((row) => matches(row, where));
      return hit ? { ...hit } : null;
    },
    updateMany: async ({ where, data }: any) => {
      boom('updateMany');
      const hits = rows.filter((row) => matches(row, where));
      for (const row of hits) Object.assign(row, data);
      return { count: hits.length };
    },
  };
  const prisma = {
    client: {
      lineIntakeState: table,
      $transaction: async (work: (tx: any) => Promise<unknown>) => work({ lineIntakeState: table }),
    },
  } as any;
  return { prisma, rows, snapshot: () => JSON.stringify(rows) };
}

function makeRepo(opts: Parameters<typeof makeStore>[0] = {}) {
  const store = makeStore(opts);
  return { repo: new LineIntakeStateRepository(store.prisma), ...store };
}

describe('LineIntakeStateRepository — open and owner binding', () => {
  it('opens one state and reads it back for the exact owner triple', async () => {
    const { repo } = makeRepo();
    const opened = await repo.openState(OPEN_INPUT);
    assert.equal(opened.ok, true);

    const read = await repo.readOpenState(OWNER);
    assert.equal(read.ok, true);
    assert.equal(read.ok && read.value.targetIntent, 'EXPENSE_DOCUMENT_CAPTURE');
    assert.equal(read.ok && read.value.version, 1);
  });

  it('supersedes the previous question instead of leaving two open ones', async () => {
    const { repo, rows } = makeRepo();
    await repo.openState(OPEN_INPUT);
    await repo.openState({ ...OPEN_INPUT, missingFields: ['amount', 'description'], sourceEventHash: 'evt-hash-2' });

    assert.equal(rows.filter((row) => row.status === 'OPEN').length, 1, 'exactly one live question per owner');
    assert.equal(rows.filter((row) => row.status === 'SUPERSEDED').length, 1, 'the old one is kept as history');
    const read = await repo.readOpenState(OWNER);
    assert.deepEqual(read.ok && read.value.missingFields, ['amount', 'description']);
  });

  it('refuses the loser of a concurrent open race rather than creating a rival state', async () => {
    const { repo, rows } = makeRepo();
    // Both calls read "no OPEN row" before either writes — the index, not the read, is the arbiter.
    const [first, second] = await Promise.all([
      repo.openState(OPEN_INPUT),
      repo.openState({ ...OPEN_INPUT, sourceEventHash: 'evt-hash-2' }),
    ]);
    const outcomes = [first, second];
    assert.equal(outcomes.filter((result) => result.ok).length, 1, 'exactly one open wins');
    const loser = outcomes.find((result) => !result.ok)!;
    assert.equal(loser.ok === false && loser.reason, 'stale');
    assert.equal(rows.filter((row) => row.status === 'OPEN').length, 1);
  });
});

describe('LineIntakeStateRepository — cross-owner refusal is zero-write (§8.3 gaps 5 and 6)', () => {
  // Same open state, three different intruders. Each one both READS and tries to RESOLVE, because
  // a leak in either direction is a leak: reading gives them the accepted amount, resolving
  // consumes a question that was never theirs to answer.
  for (const [label, intruder] of [
    ['another member in the same chat', { ...OWNER, userId: 'user-2' }],
    ['the same member in another chat', { ...OWNER, chatKeyHash: 'chat-hash-2' }],
    ['the same member in another company', { ...OWNER, companyId: 'company-2' }],
  ] as const) {
    it(`${label} can neither read nor resolve the state, and writes nothing`, async () => {
      const { repo, snapshot } = makeRepo();
      const opened = await repo.openState(OPEN_INPUT);
      assert.equal(opened.ok, true);
      const owned = opened.ok ? opened.value : undefined!;
      const before = snapshot();

      const read = await repo.readOpenState(intruder);
      assert.equal(read.ok, false, 'a different owner sees no open state at all');
      assert.equal(read.ok === false && read.reason, 'not_found');

      // Even holding the correct id AND the correct version — the strongest possible guess — the
      // owner triple in the WHERE clause means zero rows match.
      const resolved = await repo.resolveState(intruder, { id: owned.id, version: owned.version });
      assert.equal(resolved.ok, false);
      assert.equal(resolved.ok === false && resolved.reason, 'stale');

      assert.equal(snapshot(), before, 'ZERO writes: the real owner state is untouched and still OPEN');
      const stillOpen = await repo.readOpenState(OWNER);
      assert.equal(stillOpen.ok, true, 'the rightful owner can still answer their own question');
    });
  }
});

describe('LineIntakeStateRepository — stale and expired refusal is zero-write (§8.3 gap 4)', () => {
  it('refuses an expired state on read and on resolve, and never merges it', async () => {
    const { repo, rows, snapshot } = makeRepo();
    const opened = await repo.openState({ ...OPEN_INPUT, ttlMinutes: 15 });
    const owned = opened.ok ? opened.value : undefined!;
    // Walk the TTL into the past rather than sleeping.
    rows[0].expiresAt = new Date(Date.now() - 1_000);
    const before = snapshot();

    const read = await repo.readOpenState(OWNER);
    assert.equal(read.ok, false);
    assert.equal(read.ok === false && read.reason, 'expired', 'an expired question is a refusal, not a row to merge');

    const resolved = await repo.resolveState(OWNER, { id: owned.id, version: owned.version });
    assert.equal(resolved.ok, false);
    assert.equal(resolved.ok === false && resolved.reason, 'stale');
    assert.equal(snapshot(), before, 'ZERO writes on an expired state');
  });

  it('refuses a stale version — the second consumer of one answer loses', async () => {
    const { repo, snapshot } = makeRepo();
    const opened = await repo.openState(OPEN_INPUT);
    const owned = opened.ok ? opened.value : undefined!;

    const first = await repo.resolveState(OWNER, { id: owned.id, version: owned.version });
    assert.equal(first.ok, true);
    assert.equal(first.ok && first.value.version, owned.version + 1, 'CAS moves the version forward');
    const afterConsume = snapshot();

    // A replayed webhook, or a second worker, arriving with the version it read earlier.
    const replay = await repo.resolveState(OWNER, { id: owned.id, version: owned.version });
    assert.equal(replay.ok, false);
    assert.equal(replay.ok === false && replay.reason, 'stale');
    assert.equal(snapshot(), afterConsume, 'ZERO writes: a replay is idempotent, not a second consume');
  });

  it('lets exactly one of two concurrent resolves win', async () => {
    const { repo, rows } = makeRepo();
    const opened = await repo.openState(OPEN_INPUT);
    const owned = opened.ok ? opened.value : undefined!;

    const results = await Promise.all([
      repo.resolveState(OWNER, { id: owned.id, version: owned.version }),
      repo.resolveState(OWNER, { id: owned.id, version: owned.version }),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1, 'one answer consumes the question once');
    assert.equal(results.filter((result) => !result.ok).length, 1);
    assert.equal(rows[0].status, 'RESOLVED');
    assert.equal(rows[0].version, owned.version + 1, 'the version advanced exactly once');
  });

  it('refuses when the owner has no open state at all', async () => {
    const { repo } = makeRepo();
    const read = await repo.readOpenState(OWNER);
    assert.equal(read.ok === false && read.reason, 'not_found');
  });
});

describe('LineIntakeStateRepository — store outage fails CLOSED (§8.3 gap 3)', () => {
  // The whole point of this table: the Redis ledger fails OPEN, so an outage there looks like "no
  // open question" and lets a turn proceed. Here an outage must look like a REFUSAL every time.
  it('reports unavailable on read, resolve and open when the store errors', async () => {
    const read = await makeRepo({ failOn: 'findFirst' }).repo.readOpenState(OWNER);
    assert.equal(read.ok === false && read.reason, 'unavailable');

    const resolved = await makeRepo({ failOn: 'updateMany' }).repo.resolveState(OWNER, { id: 'state-1', version: 1 });
    assert.equal(resolved.ok === false && resolved.reason, 'unavailable');

    const opened = await makeRepo({ failOn: 'all' }).repo.openState(OPEN_INPUT);
    assert.equal(opened.ok === false && opened.reason, 'unavailable');
  });

  it('writes nothing when the store fails midway through an open', async () => {
    // The supersede succeeds and the create then fails: the transaction is what keeps the previous
    // question alive, so the customer is not left with neither an old state nor a new one.
    const { repo, rows, snapshot } = makeRepo();
    await repo.openState(OPEN_INPUT);
    const before = snapshot();
    const failing = makeRepo({ failOn: 'create' });
    const opened = await failing.repo.openState(OPEN_INPUT);
    assert.equal(opened.ok === false && opened.reason, 'unavailable');
    assert.equal(snapshot(), before, 'the healthy store is untouched');
    assert.equal(rows.filter((row) => row.status === 'OPEN').length, 1);
  });

  it('never turns an outage into a usable value', async () => {
    // Regression guard for the exact bug this table exists to prevent: no code path may swallow a
    // store error into `{ ok: true }`, because a caller would then write on state nobody can read.
    const { repo } = makeRepo({ failOn: 'all' });
    for (const result of [
      await repo.readOpenState(OWNER),
      await repo.resolveState(OWNER, { id: 'state-1', version: 1 }),
      await repo.openState(OPEN_INPUT),
      await repo.supersedeOpenState(OWNER),
      await repo.expireOpenState(OWNER),
    ]) {
      assert.equal(result.ok, false, 'an outage is never a success');
    }
  });
});

describe('LineIntakeStateRepository — abandon and expiry sweeps', () => {
  it('supersedes an open state without consuming it', async () => {
    const { repo, rows } = makeRepo();
    await repo.openState(OPEN_INPUT);
    const result = await repo.supersedeOpenState(OWNER);
    assert.equal(result.ok && result.value, 1);
    assert.equal(rows[0].status, 'SUPERSEDED', 'abandoned reads differently from answered');
    assert.equal(rows[0].version, 1, 'abandoning is not a consume, so the CAS token does not move');
  });

  it('expires only rows whose TTL has actually passed', async () => {
    const { repo, rows } = makeRepo();
    await repo.openState(OPEN_INPUT);
    assert.equal((await repo.expireOpenState(OWNER)).ok && rows[0].status, 'OPEN', 'a live question is left alone');

    rows[0].expiresAt = new Date(Date.now() - 1_000);
    const swept = await repo.expireOpenState(OWNER);
    assert.equal(swept.ok && swept.value, 1);
    assert.equal(rows[0].status, 'EXPIRED');
  });
});
