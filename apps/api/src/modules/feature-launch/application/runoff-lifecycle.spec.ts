/**
 * CC1 runoff lifecycle unit behaviour (spec:59-60, 69).
 *
 * The completer's CONCURRENCY guarantees are proved against a real database in
 * `runoff-lifecycle.race.spec.ts`; this file pins the decisions a fake can prove: what counts as
 * drained, what completion writes, and what it refuses to touch.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import {
  MAX_DRAINING_PAGE,
  RESERVED_COMMAND_ID_CODE,
  aggregateDrainingByFeature,
  listDrainingPage,
  assertCallerCommandId,
  buildRunoffRoots,
  INVALID_CURSOR_CODE,
  clampDrainingLimit,
  decodeDrainCursor,
  encodeDrainCursor,
  completeRunoffIfDrained,
  inspectOpenRunoffItems,
  drainingStateOf,
  listDrainingLifecycles,
  runoffCompletionCommandId,
  sweepDrainingLifecycles,
  type RunoffCompletionInspectors,
} from './runoff-lifecycle';
import { RUNOFF_MATRIX_VERSION } from '../domain/runoff-matrix.catalog';

type TransitionRow = { companyId: string; featureKey: string; seq: number; action: string; commandId: string; createdAt: Date; actorUserId?: string; id?: string };
type SnapshotRow = { companyId: string; featureKey: string; disableSeq: number; cutoffAt: Date; rootsJson: unknown };
type FenceRow = { companyId: string; featureKey: string; enabled: boolean; epoch: number; lastSeq: number };

function makePrisma(opts: {
  transitions?: TransitionRow[];
  snapshots?: SnapshotRow[];
  fences?: FenceRow[];
} = {}) {
  const transitions = [...(opts.transitions ?? [])];
  const snapshots = [...(opts.snapshots ?? [])];
  const fences = [...(opts.fences ?? [])];
  const audits: any[] = [];
  const raws: any[] = [];

  const matchesKey = (row: { companyId: string; featureKey: string }, where: any) =>
    (where.companyId === undefined || row.companyId === where.companyId)
    && (where.featureKey === undefined || row.featureKey === where.featureKey);

  const tx = {
    $executeRaw: async (sql: any) => {
      raws.push(sql);
      const statement = String(sql.strings?.join('?') ?? '');
      if (statement.includes('"lastSeq"')) {
        const [seq, companyId, featureKey] = sql.values ?? [];
        const fence = fences.find((row) => row.companyId === companyId && row.featureKey === featureKey);
        if (fence) fence.lastSeq = seq;
      }
      return 1;
    },
    $queryRaw: async (sql: any) => {
      const statement = String(sql.strings?.join('?') ?? '');
      if (!statement.includes('RUNOFF_TEST_EVIDENCE')) throw new Error(`unexpected tx raw query: ${statement}`);
      const [companyId, rootType, rootId, versionOrHash, terminal, open] = sql.values ?? [];
      return [{ companyId, rootType, rootId, versionOrHash, terminal, open }];
    },
    companyFeatureEntitlement: {
      findUnique: async (args: any) => {
        const key = args.where.companyId_featureKey;
        return fences.find((row) => row.companyId === key.companyId && row.featureKey === key.featureKey) ?? null;
      },
    },
    entitlementTransition: {
      findFirst: async (args: any) => [...transitions]
        .filter((row) => matchesKey(row, args.where) && row.action === args.where.action)
        .sort((a, b) => b.seq - a.seq)[0] ?? null,
      findUnique: async (args: any) => {
        const key = args.where.companyId_featureKey_commandId;
        return transitions.find((row) => row.companyId === key.companyId
          && row.featureKey === key.featureKey && row.commandId === key.commandId) ?? null;
      },
      create: async (args: any) => { transitions.push({ createdAt: new Date(), ...args.data }); return {}; },
    },
    runoffSnapshot: {
      findUnique: async (args: any) => {
        const key = args.where.companyId_featureKey_disableSeq;
        return snapshots.find((row) => row.companyId === key.companyId
          && row.featureKey === key.featureKey && row.disableSeq === key.disableSeq) ?? null;
      },
    },
    auditLog: { create: async (args: any) => { audits.push(args.data); return {}; } },
  };

  return {
    tx,
    transitions: () => transitions,
    fences: () => fences,
    audits: () => audits,
    advisoryLocks: () => raws
      .filter((sql) => String(sql.strings?.join('?') ?? '').includes('pg_advisory_xact_lock'))
      .map((sql) => String(sql.values?.[0] ?? '')),
    client: {
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
      /**
       * Stands in for the live-drain keyset query. The REAL predicate is a cross-table column
       * comparison in raw SQL and is proved against Postgres in `runoff-lifecycle.race.spec.ts`;
       * this reproduces its SEMANTICS so the sweep/aggregate tests around it stay meaningful.
       */
      $queryRaw: async (sql: any) => {
        const statement = String(sql.strings?.join('?') ?? '');
        if (statement.includes('RUNOFF_TEST_EVIDENCE')) {
          const [companyId, rootType, rootId, versionOrHash, terminal, open] = sql.values ?? [];
          return [{ companyId, rootType, rootId, versionOrHash, terminal, open }];
        }
        if (!statement.includes('DISABLE_REQUESTED')) throw new Error(`unexpected raw query: ${statement}`);
        const fenceByKey = new Map(fences.map((row) => [`${row.companyId} ${row.featureKey}`, row.lastSeq ?? 0]));
        let live = transitions
          .filter((row) => row.action === 'DISABLE_REQUESTED'
            && fenceByKey.get(`${row.companyId} ${row.featureKey}`) === row.seq)
          .map((row) => ({ ...row, id: row.id ?? `${row.companyId}::${row.featureKey}::${row.seq}` }))
          .sort((a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) || a.id.localeCompare(b.id));
        if (statement.includes('GROUP BY t."featureKey"')) {
          const grouped = new Map<string, { featureKey: string; companies: number; oldestRequestedAt: Date }>();
          for (const row of live) {
            const current = grouped.get(row.featureKey);
            grouped.set(row.featureKey, {
              featureKey: row.featureKey,
              companies: (current?.companies ?? 0) + 1,
              oldestRequestedAt: current && current.oldestRequestedAt < row.createdAt
                ? current.oldestRequestedAt
                : row.createdAt,
            });
          }
          return [...grouped.values()];
        }
        if (statement.includes('LIMIT')) {
          const values = sql.values ?? [];
          const take = values[values.length - 1];
          // The keyset values are bound directly now: [createdAt, id, take] when a cursor is present.
          if (values.length >= 3) {
            const [afterCreatedAt, afterId] = values;
            live = live.filter((row) => row.createdAt.getTime() > new Date(afterCreatedAt).getTime()
              || (row.createdAt.getTime() === new Date(afterCreatedAt).getTime() && row.id > afterId));
          }
          live = live.slice(0, take);
        }
        return live;
      },
      entitlementTransition: {
        findMany: async (args: any) => transitions
          .filter((row) => row.action === args.where.action)
          .sort((a, b) => b.seq - a.seq),
      },
      companyFeatureEntitlement: { findMany: async () => fences },
      runoffSnapshot: { findMany: async () => snapshots },
    },
  } as any;
}

const drainedRoots = { matrixVersion: RUNOFF_MATRIX_VERSION, policyByRootType: {}, roots: [], openCount: 0 };

const testRoot = (
  rootType = 'expense',
  rootId = 'e1',
  versionOrHash = 'v1',
) => ({ rootType, rootId, versionOrHash, status: 'OPEN' });

const rootsOf = (...roots: ReturnType<typeof testRoot>[]) => ({
  matrixVersion: RUNOFF_MATRIX_VERSION,
  policyByRootType: Object.fromEntries(roots.map((root) => [root.rootType, 'PRE_CUTOFF_RUNOFF_ONLY'])),
  roots,
  openCount: roots.length,
});

function inspectorsFor(
  featureKey: string,
  root: ReturnType<typeof testRoot>,
  isOpen: () => boolean,
): RunoffCompletionInspectors {
  return {
    [featureKey]: {
      rootTypes: [root.rootType],
      matrixVersions: [RUNOFF_MATRIX_VERSION],
      inspectCurrent: async ({ reader, companyId }) => {
        const open = isOpen();
        return reader.query(Prisma.sql`
          SELECT ${companyId}::text AS "companyId",
                 ${root.rootType}::text AS "rootType",
                 ${root.rootId}::text AS "rootId",
                 ${root.versionOrHash}::text AS "versionOrHash",
                 ${!open}::boolean AS "terminal",
                 ${open}::boolean AS "open"
            /* RUNOFF_TEST_EVIDENCE */
        `);
      },
    },
  };
}

function disableRequested(over: Partial<TransitionRow> = {}): TransitionRow {
  return {
    companyId: 'co-1',
    featureKey: 'reports',
    seq: 6,
    action: 'DISABLE_REQUESTED',
    commandId: 'req-1',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...over,
  };
}

describe('buildRunoffRoots', () => {
  it('returns an empty, matrix-stamped snapshot for EVERY family (freeze in place)', () => {
    // Owner decision 2026-08-04: a disable grants no continuation, so no family — including the six
    // the matrix once proposed PRE_CUTOFF_RUNOFF_ONLY rows for — has runoff roots, and residual work
    // can never hold a disable up by making this builder fail.
    for (const featureKey of ['reports', 'expenses', 'procurement', 'sales_documents', 'reimbursement', 'bank_reconciliation', 'double_entry_ledger', 'procurement.supplier_payments']) {
      const roots = buildRunoffRoots(featureKey);
      assert.deepEqual(roots.roots, []);
      assert.equal(roots.openCount, 0);
      // Stamped so a later matrix revision cannot reinterpret this snapshot.
      assert.equal(roots.matrixVersion, RUNOFF_MATRIX_VERSION);
    }
  });
});

describe('inspectOpenRunoffItems', () => {
  it('ignores the immutable stamped count and re-reads non-empty membership through its adapter', async () => {
    const db = makePrisma().tx;
    const root = testRoot();
    const input = {
      companyId: 'co-1', featureKey: 'expenses', disableSeq: 6, cutoffAt: new Date(),
      rootsJson: rootsOf(root),
    };
    assert.equal(await inspectOpenRunoffItems(db, input, inspectorsFor('expenses', root, () => false)), 0);
    assert.equal(await inspectOpenRunoffItems(db, { ...input, rootsJson: drainedRoots }), 0);
  });
  // Everything it CANNOT read now throws — see the r19-2 block below.
});

describe('drainingStateOf', () => {
  it('is DRAINING when the latest transition is DISABLE_REQUESTED', async () => {
    const prisma = makePrisma({
      transitions: [disableRequested()],
      snapshots: [{ companyId: 'co-1', featureKey: 'reports', disableSeq: 6, cutoffAt: new Date('2026-08-01T00:00:00.000Z'), rootsJson: drainedRoots }],
      fences: [{ companyId: 'co-1', featureKey: 'reports', enabled: false, epoch: 2, lastSeq: 6 }],
    });
    const state = await drainingStateOf(prisma.tx, 'co-1', 'reports');
    assert.ok(state);
    assert.equal(state.disableSeq, 6);
    assert.equal(state.openItems, 0);
  });

  it('is NOT draining once something happened after the request (a re-enable, or the OFF)', async () => {
    // "Latest" is the canonical fence, not a timestamp: `lastSeq` IS the highest transition seq.
    const prisma = makePrisma({
      transitions: [disableRequested()],
      snapshots: [{ companyId: 'co-1', featureKey: 'reports', disableSeq: 6, cutoffAt: new Date(), rootsJson: drainedRoots }],
      fences: [{ companyId: 'co-1', featureKey: 'reports', enabled: true, epoch: 3, lastSeq: 7 }],
    });
    assert.equal(await drainingStateOf(prisma.tx, 'co-1', 'reports'), null);
  });

  it('is NOT draining when the feature was never disabled', async () => {
    const prisma = makePrisma({ fences: [{ companyId: 'co-1', featureKey: 'reports', enabled: true, epoch: 1, lastSeq: 1 }] });
    assert.equal(await drainingStateOf(prisma.tx, 'co-1', 'reports'), null);
  });

  it('treats a DISABLE_REQUESTED with no snapshot as UNDRAINABLE, never as drained', async () => {
    // Unreachable (both are written in one transaction), but "0 open items" must never be the
    // answer to "I cannot find the snapshot" — that would force OFF on an unknown amount of work.
    const prisma = makePrisma({
      transitions: [disableRequested()],
      fences: [{ companyId: 'co-1', featureKey: 'reports', enabled: false, epoch: 2, lastSeq: 6 }],
    });
    const state = await drainingStateOf(prisma.tx, 'co-1', 'reports');
    assert.ok(state);
    assert.equal(state.openItems, Number.POSITIVE_INFINITY);
  });
});

describe('completeRunoffIfDrained', () => {
  function drainingFixture() {
    return makePrisma({
      transitions: [disableRequested()],
      snapshots: [{ companyId: 'co-1', featureKey: 'reports', disableSeq: 6, cutoffAt: new Date('2026-08-01T00:00:00.000Z'), rootsJson: drainedRoots }],
      fences: [{ companyId: 'co-1', featureKey: 'reports', enabled: false, epoch: 2, lastSeq: 6 }],
    });
  }

  it('appends OFF as SYSTEM at seq + 1 under its own derived commandId', async () => {
    const prisma = drainingFixture();
    assert.equal(await completeRunoffIfDrained(prisma, 'co-1', 'reports'), 'COMPLETED');

    const off = prisma.transitions().find((row: any) => row.action === 'OFF');
    assert.equal(off.seq, 7);
    assert.equal(off.epoch, 2, 'OFF carries the epoch — it is not an OFF→ON transition');
    assert.equal(off.actorUserId, 'SYSTEM');
    assert.equal(off.commandId, runoffCompletionCommandId('reports', 6));
  });

  it('takes the exclusive entitlement lock the partner command shares', async () => {
    const prisma = drainingFixture();
    await completeRunoffIfDrained(prisma, 'co-1', 'reports');
    assert.deepEqual(prisma.advisoryLocks(), ['entitlement:co-1']);
  });

  it('advances the fence so the lifecycle stops reading as DRAINING', async () => {
    const prisma = drainingFixture();
    await completeRunoffIfDrained(prisma, 'co-1', 'reports');
    assert.equal(prisma.fences()[0].lastSeq, 7);
    assert.equal(await drainingStateOf(prisma.tx, 'co-1', 'reports'), null);
  });

  it('is idempotent: a second call writes nothing', async () => {
    const prisma = drainingFixture();
    assert.equal(await completeRunoffIfDrained(prisma, 'co-1', 'reports'), 'COMPLETED');
    const after = prisma.transitions().length;
    // The fence has moved, so the second call sees NOT_DRAINING — and even if it did not, the
    // commandId-unique replay check would answer ALREADY_COMPLETED.
    assert.equal(await completeRunoffIfDrained(prisma, 'co-1', 'reports'), 'NOT_DRAINING');
    assert.equal(prisma.transitions().length, after);
  });

  it('answers ALREADY_COMPLETED when the OFF exists but the fence never advanced', async () => {
    // The crash shape: transition committed, fence bump lost. The unique index is the fence of
    // last resort and prevents a duplicate OFF.
    const prisma = makePrisma({
      transitions: [
        disableRequested(),
        // A FAITHFUL completion row: the real completer always stamps the SYSTEM actor, and the
        // shape check added for r18 F2 requires it — a row missing it is a squatter, not a
        // completion.
        { companyId: 'co-1', featureKey: 'reports', seq: 7, action: 'OFF', actorUserId: 'SYSTEM', commandId: runoffCompletionCommandId('reports', 6), createdAt: new Date() } as any,
      ],
      snapshots: [{ companyId: 'co-1', featureKey: 'reports', disableSeq: 6, cutoffAt: new Date(), rootsJson: drainedRoots }],
      fences: [{ companyId: 'co-1', featureKey: 'reports', enabled: false, epoch: 2, lastSeq: 6 }],
    });
    assert.equal(await completeRunoffIfDrained(prisma, 'co-1', 'reports'), 'ALREADY_COMPLETED');
    assert.equal(prisma.transitions().filter((row: any) => row.action === 'OFF').length, 1);
  });

  it('refuses to complete while items are open', async () => {
    const root = testRoot();
    const prisma = makePrisma({
      transitions: [disableRequested({ featureKey: 'expenses' })],
      snapshots: [{
        companyId: 'co-1',
        featureKey: 'expenses',
        disableSeq: 6,
        cutoffAt: new Date(),
        rootsJson: rootsOf(root),
      }],
      fences: [{ companyId: 'co-1', featureKey: 'expenses', enabled: false, epoch: 1, lastSeq: 6 }],
    });
    const inspectors = inspectorsFor('expenses', root, () => true);
    assert.equal(await completeRunoffIfDrained(prisma, 'co-1', 'expenses', inspectors), 'STILL_DRAINING');
    assert.equal(prisma.transitions().filter((row: any) => row.action === 'OFF').length, 0);
  });

  it('re-reads domain truth so a non-empty immutable snapshot can eventually reach OFF', async () => {
    let open = true;
    const root = testRoot();
    const prisma = makePrisma({
      transitions: [disableRequested({ featureKey: 'expenses' })],
      snapshots: [{
        companyId: 'co-1', featureKey: 'expenses', disableSeq: 6, cutoffAt: new Date(),
        rootsJson: rootsOf(root),
      }],
      fences: [{ companyId: 'co-1', featureKey: 'expenses', enabled: false, epoch: 1, lastSeq: 6 }],
    });
    const inspectors = inspectorsFor('expenses', root, () => open);

    assert.equal(await completeRunoffIfDrained(prisma, 'co-1', 'expenses', inspectors), 'STILL_DRAINING');
    open = false;
    assert.equal(await completeRunoffIfDrained(prisma, 'co-1', 'expenses', inspectors), 'COMPLETED');
    assert.equal(prisma.transitions().filter((row: any) => row.action === 'OFF').length, 1);
  });

  it('fails closed when a non-empty snapshot has no family inspector', async () => {
    const root = testRoot();
    const prisma = makePrisma({
      transitions: [disableRequested({ featureKey: 'expenses' })],
      snapshots: [{
        companyId: 'co-1', featureKey: 'expenses', disableSeq: 6, cutoffAt: new Date(),
        rootsJson: rootsOf(root),
      }],
      fences: [{ companyId: 'co-1', featureKey: 'expenses', enabled: false, epoch: 1, lastSeq: 6 }],
    });

    await assert.rejects(
      () => completeRunoffIfDrained(prisma, 'co-1', 'expenses'),
      /runoff_snapshot_inspector_missing/,
    );
    assert.equal(prisma.transitions().filter((row: any) => row.action === 'OFF').length, 0);
  });

  it('does NOT complete a feature that was re-enabled after the request', async () => {
    // The reason the state is re-read UNDER the lock: completing here would switch a live feature
    // off, days after the operator cancelled the drain.
    const prisma = makePrisma({
      transitions: [disableRequested(), { companyId: 'co-1', featureKey: 'reports', seq: 7, action: 'ENABLE', commandId: 'resume', createdAt: new Date() }],
      snapshots: [{ companyId: 'co-1', featureKey: 'reports', disableSeq: 6, cutoffAt: new Date(), rootsJson: drainedRoots }],
      fences: [{ companyId: 'co-1', featureKey: 'reports', enabled: true, epoch: 3, lastSeq: 7 }],
    });
    assert.equal(await completeRunoffIfDrained(prisma, 'co-1', 'reports'), 'NOT_DRAINING');
    assert.equal(prisma.fences()[0].enabled, true);
  });
});

describe('listDrainingLifecycles / sweepDrainingLifecycles', () => {
  it('lists only the drains whose request is still the latest transition', async () => {
    const prisma = makePrisma({
      transitions: [
        disableRequested({ companyId: 'co-1' }),
        disableRequested({ companyId: 'co-2', seq: 3 }),
      ],
      snapshots: [
        { companyId: 'co-1', featureKey: 'reports', disableSeq: 6, cutoffAt: new Date(), rootsJson: drainedRoots },
        { companyId: 'co-2', featureKey: 'reports', disableSeq: 3, cutoffAt: new Date(), rootsJson: drainedRoots },
      ],
      fences: [
        { companyId: 'co-1', featureKey: 'reports', enabled: false, epoch: 2, lastSeq: 6 },
        // co-2 already completed: its fence moved past the request.
        { companyId: 'co-2', featureKey: 'reports', enabled: false, epoch: 1, lastSeq: 4 },
      ],
    });
    const draining = await listDrainingLifecycles(prisma);
    assert.deepEqual(draining.map((row: any) => row.companyId), ['co-1']);
  });

  it('repairs a missed completion event (spec:69) — the crash-window path', async () => {
    const prisma = makePrisma({
      transitions: [disableRequested()],
      snapshots: [{ companyId: 'co-1', featureKey: 'reports', disableSeq: 6, cutoffAt: new Date(), rootsJson: drainedRoots }],
      fences: [{ companyId: 'co-1', featureKey: 'reports', enabled: false, epoch: 2, lastSeq: 6 }],
    });
    const result = await sweepDrainingLifecycles(prisma);
    assert.deepEqual(result, { examined: 1, completed: 1, stillDraining: 0, errors: 0, nextCursorId: null });
    assert.ok(prisma.transitions().some((row: any) => row.action === 'OFF'));
  });

  it('never widens membership: a drain with open items is examined and left alone', async () => {
    const root = testRoot();
    const prisma = makePrisma({
      transitions: [disableRequested({ featureKey: 'expenses' })],
      snapshots: [{
        companyId: 'co-1',
        featureKey: 'expenses',
        disableSeq: 6,
        cutoffAt: new Date(),
        rootsJson: rootsOf(root),
      }],
      fences: [{ companyId: 'co-1', featureKey: 'expenses', enabled: false, epoch: 1, lastSeq: 6 }],
    });
    const result = await sweepDrainingLifecycles(
      prisma, MAX_DRAINING_PAGE, undefined, inspectorsFor('expenses', root, () => true),
    );
    assert.deepEqual(result, { examined: 1, completed: 0, stillDraining: 1, errors: 0, nextCursorId: null });
  });

  it('returns nothing when no drain exists, without reading the fence table', async () => {
    const prisma = makePrisma();
    assert.deepEqual(await listDrainingLifecycles(prisma), []);
    assert.deepEqual(await sweepDrainingLifecycles(prisma), { examined: 0, completed: 0, stillDraining: 0, errors: 0, nextCursorId: null });
  });
});

describe('r18 F2 — the completion command-id namespace is enforced at both ends', () => {
  it('refuses a caller command id inside the reserved prefix', () => {
    assert.throws(
      () => assertCallerCommandId(runoffCompletionCommandId('reports', 6)),
      (error: any) => {
        assert.equal(error.getResponse().code, RESERVED_COMMAND_ID_CODE);
        return true;
      },
    );
    assert.throws(() => assertCallerCommandId('runoff-complete:anything'), UnprocessableEntityException);
  });

  it('allows every ordinary command id, including near-misses', () => {
    for (const commandId of ['req-1', 'runoff-completed:x', 'x-runoff-complete:y', 'runoff-complete', 'entitlement-exception:r1']) {
      assert.doesNotThrow(() => assertCallerCommandId(commandId));
    }
  });

  it('completion REFUSES to read a squatted id as ALREADY_COMPLETED', async () => {
    // The attack the finding describes: a transition that is not a completion occupying the
    // deterministic id. Reading it as "already done" would leave the OFF permanently unwritten
    // while the sweep reported the lifecycle finished — silent, and unrecoverable without this.
    const squatted = makePrisma({
      transitions: [
        disableRequested(),
        {
          companyId: 'co-1',
          featureKey: 'reports',
          seq: 99,
          action: 'ENABLE',
          commandId: runoffCompletionCommandId('reports', 6),
          createdAt: new Date(),
        },
      ],
      snapshots: [{ companyId: 'co-1', featureKey: 'reports', disableSeq: 6, cutoffAt: new Date(), rootsJson: drainedRoots }],
      fences: [{ companyId: 'co-1', featureKey: 'reports', enabled: false, epoch: 2, lastSeq: 6 }],
    });

    await assert.rejects(
      () => completeRunoffIfDrained(squatted, 'co-1', 'reports'),
      (error: any) => {
        assert.equal(error.getResponse().code, 'runoff_completion_command_id_squatted');
        return true;
      },
    );
    assert.equal(squatted.transitions().filter((row: any) => row.action === 'OFF').length, 0);
  });

  it('still accepts a GENUINE completion row as ALREADY_COMPLETED', async () => {
    const real = makePrisma({
      transitions: [
        disableRequested(),
        { companyId: 'co-1', featureKey: 'reports', seq: 7, action: 'OFF', actorUserId: 'SYSTEM', commandId: runoffCompletionCommandId('reports', 6), createdAt: new Date() } as any,
      ],
      snapshots: [{ companyId: 'co-1', featureKey: 'reports', disableSeq: 6, cutoffAt: new Date(), rootsJson: drainedRoots }],
      fences: [{ companyId: 'co-1', featureKey: 'reports', enabled: false, epoch: 2, lastSeq: 6 }],
    });
    assert.equal(await completeRunoffIfDrained(real, 'co-1', 'reports'), 'ALREADY_COMPLETED');
  });
});

describe('r19 — the uncompletable repair drain is WITHDRAWN', () => {
  it('no snapshot shape can express "unknown" any more', async () => {
    const roots = buildRunoffRoots('reports');
    assert.deepEqual(Object.keys(roots).sort(), ['matrixVersion', 'openCount', 'policyByRootType', 'roots']);
    assert.equal(await inspectOpenRunoffItems(makePrisma().tx, {
      companyId: 'co-1', featureKey: 'reports', disableSeq: 6, cutoffAt: new Date(), rootsJson: roots,
    }), 0);
  });
});

describe('r19-2 — an unreadable snapshot THROWS rather than counting as drained', () => {
  it('THROWS on the legacy r18-era `rootsEnumerated:false` sentinel (r20-1)', async () => {
    // The withdrawn design's exact on-disk shape. Its three fields contradict each other: to a
    // later reader `openCount: 0` says "drained" while the sentinel says "we never looked".
    // Snapshots are IMMUTABLE, so this shape can never be migrated away — if it is ever read it
    // must refuse, or the sweep appends OFF over unenumerated work and the withdrawn design
    // returns through the back door.
    const legacy = { matrixVersion: 'x', policyByRootType: {}, roots: [], openCount: 0, rootsEnumerated: false };
    const inspect = (rootsJson: unknown) => inspectOpenRunoffItems(makePrisma().tx, {
      companyId: 'co-1', featureKey: 'reports', disableSeq: 6, cutoffAt: new Date(), rootsJson,
    });
    await assert.rejects(() => inspect(legacy), /runoff_snapshot_unreadable/);
    // The sentinel wins over every other readable field, in either order of appearance.
    await assert.rejects(() => inspect({ rootsEnumerated: false, openCount: 7 }), /runoff_snapshot_unreadable/);
    // A truthy sentinel is harmless only when the complete versioned envelope is readable.
    assert.equal(await inspect({ ...drainedRoots, rootsEnumerated: true }), 0);
  });

  it('the sweep skips a legacy sentinel row as an ERROR and never appends OFF', async () => {
    const prisma = makePrisma({
      transitions: [disableRequested()],
      snapshots: [{
        companyId: 'co-1',
        featureKey: 'reports',
        disableSeq: 6,
        cutoffAt: new Date(),
        rootsJson: { matrixVersion: 'x', policyByRootType: {}, roots: [], openCount: 0, rootsEnumerated: false },
      }],
      fences: [{ companyId: 'co-1', featureKey: 'reports', enabled: false, epoch: 2, lastSeq: 6 }],
    });
    const sweep = await sweepDrainingLifecycles(prisma);
    assert.equal(sweep.errors, 1);
    assert.equal(sweep.completed, 0);
    assert.equal(prisma.transitions().filter((row: any) => row.action === 'OFF').length, 0);
  });

  it('refuses to turn an unrecognisable payload or root identity into 0', async () => {
    // The most dangerous default in this file: "I cannot read this" silently becoming "nothing left
    // to run off", after which the completer appends OFF over unknown work.
    const inspect = (rootsJson: unknown) => inspectOpenRunoffItems(makePrisma().tx, {
      companyId: 'co-1', featureKey: 'reports', disableSeq: 6, cutoffAt: new Date(), rootsJson,
    });
    for (const payload of [
      {},
      { roots: 'not-an-array' },
      { openCount: 'many' },
      { roots: [], openCount: 0 },
      { ...drainedRoots, openCount: 1 },
      { ...drainedRoots, roots: [{}], openCount: 1 },
      42,
      'x',
    ]) {
      await assert.rejects(() => inspect(payload), /runoff_snapshot_unreadable/);
    }
    await assert.rejects(() => inspect(null), /runoff_snapshot_unreadable/);
  });

  it('fails closed when the family adapter does not recognize a root type', async () => {
    const root = testRoot('unknown');
    await assert.rejects(
      () => inspectOpenRunoffItems(makePrisma().tx, {
        companyId: 'co-1', featureKey: 'expenses', disableSeq: 6, cutoffAt: new Date(),
        rootsJson: rootsOf(root),
      }, inspectorsFor('expenses', testRoot('expense'), () => false)),
      /runoff_snapshot_root_unknown/,
    );
  });

  it('rejects duplicate roots, missing exact versions, and non-runoff policy before inspection', async () => {
    const root = testRoot();
    const inspect = (rootsJson: unknown) => inspectOpenRunoffItems(makePrisma().tx, {
      companyId: 'co-1', featureKey: 'expenses', disableSeq: 6, cutoffAt: new Date(), rootsJson,
    }, inspectorsFor('expenses', root, () => false));

    await assert.rejects(
      () => inspect({ ...rootsOf(root), roots: [root, { ...root }] }),
      /runoff_snapshot_duplicate_root/,
    );
    await assert.rejects(
      () => inspect(rootsOf({ ...root, versionOrHash: '' })),
      /runoff_snapshot_unreadable/,
    );
    await assert.rejects(
      () => inspect({ ...rootsOf(root), policyByRootType: { expense: 'RETAINED_READ' } }),
      /runoff_snapshot_policy_mismatch/,
    );
  });

  it('requires an inspector for the exact historical matrix version', async () => {
    const root = testRoot();
    await assert.rejects(
      () => inspectOpenRunoffItems(makePrisma().tx, {
        companyId: 'co-1', featureKey: 'expenses', disableSeq: 6, cutoffAt: new Date(),
        rootsJson: { ...rootsOf(root), matrixVersion: 'unknown-version' },
      }, inspectorsFor('expenses', root, () => false)),
      /runoff_snapshot_matrix_version_unknown/,
    );
  });

  it('requires exact one-to-one current evidence including the immutable version/hash', async () => {
    const first = testRoot('expense', 'e1', 'v1');
    const second = testRoot('expense', 'e2', 'v2');
    await assert.rejects(
      () => inspectOpenRunoffItems(makePrisma().tx, {
        companyId: 'co-1', featureKey: 'expenses', disableSeq: 6, cutoffAt: new Date(),
        rootsJson: rootsOf(first, second),
      }, inspectorsFor('expenses', first, () => false)),
      /runoff_inspector_coverage_mismatch/,
    );
    await assert.rejects(
      () => inspectOpenRunoffItems(makePrisma().tx, {
        companyId: 'co-1', featureKey: 'expenses', disableSeq: 6, cutoffAt: new Date(),
        rootsJson: rootsOf(first),
      }, inspectorsFor('expenses', { ...first, versionOrHash: 'wrong-version' }, () => false)),
      /runoff_inspector_identity_mismatch/,
    );
    const wrongTenant: RunoffCompletionInspectors = {
      expenses: {
        rootTypes: [first.rootType],
        matrixVersions: [RUNOFF_MATRIX_VERSION],
        inspectCurrent: ({ reader }) => reader.query(Prisma.sql`
          SELECT ${'co-other'} AS "companyId", ${first.rootType} AS "rootType",
                 ${first.rootId} AS "rootId", ${first.versionOrHash} AS "versionOrHash",
                 true AS "terminal", false AS "open" /* RUNOFF_TEST_EVIDENCE */
        `),
      },
    };
    await assert.rejects(
      () => inspectOpenRunoffItems(makePrisma().tx, {
        companyId: 'co-1', featureKey: 'expenses', disableSeq: 6, cutoffAt: new Date(),
        rootsJson: rootsOf(first),
      }, wrongTenant),
      /runoff_inspector_evidence_invalid/,
    );
  });

  it('permits only bounded non-locking domain reads', async () => {
    const root = testRoot();
    const base = {
      rootTypes: [root.rootType],
      matrixVersions: [RUNOFF_MATRIX_VERSION],
    };
    const inspectWith = (inspector: RunoffCompletionInspectors[string]) => inspectOpenRunoffItems(
      makePrisma().tx,
      {
        companyId: 'co-1', featureKey: 'expenses', disableSeq: 6, cutoffAt: new Date(),
        rootsJson: rootsOf(root),
      },
      { expenses: inspector },
    );
    await assert.rejects(
      () => inspectWith({
        ...base,
        inspectCurrent: ({ reader }) => reader.query(Prisma.sql`SELECT 1 FOR UPDATE`),
      }),
      /runoff_inspector_query_not_readonly/,
    );
    await assert.rejects(
      () => inspectWith({
        ...base,
        inspectCurrent: ({ reader }) => reader.query(Prisma.sql`SELECT pg_advisory_xact_lock(1)`),
      }),
      /runoff_inspector_query_not_readonly/,
    );
    await assert.rejects(
      () => inspectWith({
        ...base,
        inspectCurrent: async ({ reader }) => {
          for (let index = 0; index <= 4; index += 1) {
            await reader.query(Prisma.sql`
              SELECT ${'co-1'} AS "companyId", ${root.rootType} AS "rootType", ${root.rootId} AS "rootId",
                     ${root.versionOrHash} AS "versionOrHash", true AS "terminal", false AS "open"
                /* RUNOFF_TEST_EVIDENCE */
            `);
          }
          return [];
        },
      }),
      /runoff_inspector_query_limit/,
    );
    await assert.rejects(
      () => inspectWith({
        ...base,
        inspectCurrent: async ({ reader }) => {
          await reader.query(Prisma.sql`
            SELECT ${'co-1'} AS "companyId", ${root.rootType} AS "rootType", ${root.rootId} AS "rootId",
                   ${root.versionOrHash} AS "versionOrHash", true AS "terminal", false AS "open"
              /* RUNOFF_TEST_EVIDENCE */
          `);
          return new Promise<never>(() => undefined);
        },
      }),
      /runoff_inspector_timeout/,
    );
  });

  it('the sweep records an unreadable snapshot as an ERROR, never as completed', async () => {
    const prisma = makePrisma({
      transitions: [disableRequested()],
      snapshots: [{ companyId: 'co-1', featureKey: 'reports', disableSeq: 6, cutoffAt: new Date(), rootsJson: { garbage: true } }],
      fences: [{ companyId: 'co-1', featureKey: 'reports', enabled: false, epoch: 2, lastSeq: 6 }],
    });
    const sweep = await sweepDrainingLifecycles(prisma);
    assert.equal(sweep.completed, 0);
    assert.equal(sweep.errors, 1);
    assert.equal(prisma.transitions().filter((row: any) => row.action === 'OFF').length, 0);
  });

  it('the health aggregate never fabricates a count from an uncountable drain', async () => {
    // A DISABLE_REQUESTED with no snapshot is unreachable (both are written in one transaction) and
    // reports Infinity. It must contribute a draining COMPANY but not a fabricated open item.
    const prisma = makePrisma({
      transitions: [disableRequested()],
      fences: [{ companyId: 'co-1', featureKey: 'reports', enabled: false, epoch: 2, lastSeq: 6 }],
    });
    const aggregate = await aggregateDrainingByFeature(prisma);
    assert.equal(aggregate.get('reports')!.companies, 1);
    assert.equal(aggregate.get('reports')!.openItems, 0, 'counted as a drain, not as N open items');
    assert.equal(aggregate.get('reports')!.inspectionErrors, 1, 'unknown is explicit, never zero-open proof');
  });
});

describe('r18 F5 — the ops bound is clamped', () => {
  it('clamps to 1..200 and lands junk on the ceiling, never on zero', () => {
    assert.equal(clampDrainingLimit(50), 50);
    assert.equal(clampDrainingLimit(0), MAX_DRAINING_PAGE);
    assert.equal(clampDrainingLimit(-5), MAX_DRAINING_PAGE);
    assert.equal(clampDrainingLimit(10_000), MAX_DRAINING_PAGE);
    assert.equal(clampDrainingLimit(undefined), MAX_DRAINING_PAGE);
    assert.equal(clampDrainingLimit('abc'), MAX_DRAINING_PAGE);
    assert.equal(clampDrainingLimit(1), 1);
  });

  it('pushes the LIVE predicate and the bound into one DB query, oldest first', async () => {
    const seen: any[] = [];
    const prisma = makePrisma();
    prisma.client.$queryRaw = async (sql: any) => { seen.push(sql); return []; };

    await listDrainingLifecycles(prisma, 7);
    const statement = String(seen[0].strings.join('?'));
    // r19-1 — the LIVE condition must be IN the query. Bounding candidates and filtering afterwards
    // meant 200 completed historical requests ahead of one live drain produced a page of zero.
    assert.match(statement, /JOIN "CompanyFeatureEntitlement"/);
    assert.match(statement, /e\."lastSeq" = t\."seq"/);
    assert.match(statement, /LIMIT/);
    // Newest-first would let a steady stream of new drains starve a genuinely stuck old one.
    assert.match(statement, /ORDER BY t\."createdAt" ASC, t\."id" ASC/);
    assert.equal(seen[0].values[seen[0].values.length - 1], 7, 'bounded in the query');

    await listDrainingLifecycles(prisma, 10_000);
    assert.equal(seen[1].values[seen[1].values.length - 1], MAX_DRAINING_PAGE, 'no unbounded scan');
  });

  it('hands back a cursor only when the page was full', async () => {
    const rows = Array.from({ length: 3 }, (_, index) => disableRequested({ companyId: `co-${index}`, id: `t-${index}` }));
    const prisma = makePrisma({
      transitions: rows,
      snapshots: rows.map((row) => ({ companyId: row.companyId, featureKey: 'reports', disableSeq: 6, cutoffAt: new Date(), rootsJson: drainedRoots })),
      fences: rows.map((row) => ({ companyId: row.companyId, featureKey: 'reports', enabled: false, epoch: 1, lastSeq: 6 })),
    });

    const full = await listDrainingPage(prisma, 2);
    assert.equal(full.lifecycles.length, 2);
    // Opaque to the caller, but it must point at the last row of the page — and carry its
    // timestamp, not just its id (r20-2). All three fixtures share a createdAt, so this also
    // exercises the id tie-break.
    assert.equal(decodeDrainCursor(full.nextCursorId)!.id, 't-1', 'continue after the last row of a full page');

    const rest = await listDrainingPage(prisma, 2, full.nextCursorId);
    assert.deepEqual(rest.lifecycles.map((row: any) => row.companyId), ['co-2']);
    // A short page means the predicate is exhausted; a cursor there can only cost a round trip.
    assert.equal(rest.nextCursorId, null);
  });
});

describe('r18 F4 — the health aggregate is untruncated', () => {
  it('counts every drain and finds the true oldest, past the ops page size', async () => {
    // 201 live drains: the bounded page would silently count one as OFF, and the oldest could fall
    // outside the window — under-reporting W3 DRAINING age exactly when there is most to report.
    const total = MAX_DRAINING_PAGE + 1;
    const oldest = new Date('2020-01-01T00:00:00.000Z');
    const transitions = Array.from({ length: total }, (_, index) => disableRequested({
      companyId: `co-${index}`,
      seq: 6,
      // The OLDEST drain is the LAST one generated, so a newest-first page would miss it.
      createdAt: index === total - 1 ? oldest : new Date('2026-08-01T00:00:00.000Z'),
    }));
    const prisma = makePrisma({
      transitions,
      snapshots: transitions.map((row) => ({ companyId: row.companyId, featureKey: 'reports', disableSeq: 6, cutoffAt: new Date(), rootsJson: drainedRoots })),
      fences: transitions.map((row) => ({ companyId: row.companyId, featureKey: 'reports', enabled: false, epoch: 1, lastSeq: 6 })),
    });

    const aggregate = await aggregateDrainingByFeature(prisma);
    assert.equal(aggregate.get('reports')!.companies, total, 'every drain counted');
    assert.equal(aggregate.get('reports')!.oldestRequestedAt.getTime(), oldest.getTime(), 'the true oldest found');

    // And the bounded ops listing is still bounded — the two have different jobs.
    assert.equal((await listDrainingLifecycles(prisma)).length, MAX_DRAINING_PAGE);
  });
});

describe('r20-2 — the cursor is opaque and carries both keyset columns', () => {
  it('round-trips createdAt and id', () => {
    const createdAt = new Date('2026-08-01T12:34:56.789Z');
    const decoded = decodeDrainCursor(encodeDrainCursor(createdAt, 'ckabc123'));
    assert.equal(decoded!.createdAt.toISOString(), createdAt.toISOString());
    assert.equal(decoded!.id, 'ckabc123');
  });

  it('rejects a CORRUPTED valid token — lenient base64url must not accept it (r21)', () => {
    // Node's decoder silently drops invalid characters, so a mangled-but-mostly-valid token decodes
    // to the same tuple as the original. Canonical round-trip equality is what rejects it.
    const valid = encodeDrainCursor(new Date('2026-08-01T12:34:56.789Z'), 'ckabc123');
    for (const corrupted of [`${valid}!`, `${valid}===`, `!${valid}`, `${valid} `]) {
      assert.throws(
        () => decodeDrainCursor(corrupted),
        (error: any) => error?.response?.code === INVALID_CURSOR_CODE,
        `corrupted token ${JSON.stringify(corrupted)} must be refused`,
      );
    }
  });

  it('treats absent/empty as "start at the beginning", never as an error', () => {
    for (const value of [undefined, null, '']) assert.equal(decodeDrainCursor(value as any), null);
  });

  it('rejects a malformed cursor with a 422 instead of silently paging from nowhere', () => {
    for (const bad of ['not-base64!!', Buffer.from('no-colon', 'utf8').toString('base64url'), Buffer.from(':abc', 'utf8').toString('base64url'), Buffer.from('not-a-date:abc', 'utf8').toString('base64url'), Buffer.from('2026-08-01T00:00:00.000Z:', 'utf8').toString('base64url')]) {
      assert.throws(
        () => decodeDrainCursor(bad),
        (error: any) => {
          assert.ok(error instanceof UnprocessableEntityException);
          assert.equal((error.getResponse() as { code?: string }).code, INVALID_CURSOR_CODE);
          return true;
        },
        `expected ${bad} to be rejected`,
      );
    }
  });

  it('binds the keyset values DIRECTLY — no subquery that a deleted row could void', async () => {
    const seen: any[] = [];
    const prisma = makePrisma();
    prisma.client.$queryRaw = async (sql: any) => { seen.push(sql); return []; };

    await listDrainingPage(prisma, 5, encodeDrainCursor(new Date('2026-08-01T00:00:00.000Z'), 'ck-gone'));
    const statement = String(seen[0].strings.join('?'));
    assert.match(statement, /\(t\."createdAt", t\."id"\) > \(/);
    // The old shape resolved the tuple via `SELECT … WHERE c."id" = $cursor`; if that row had been
    // deleted the subquery returned nothing, the comparison went NULL for every candidate, and the
    // page came back empty — a silent terminal hiding every live drain behind it.
    assert.doesNotMatch(statement, /SELECT c\."createdAt"/);
    assert.ok(seen[0].values.some((value: any) => value instanceof Date || String(value).includes('2026-08-01')));
    assert.ok(seen[0].values.includes('ck-gone'), 'the id is bound, not looked up');
  });
});
