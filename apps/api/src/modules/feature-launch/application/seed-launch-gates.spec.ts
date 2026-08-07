import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import { seedLaunchGates } from './seed-launch-gates';
import { FEATURE_LAUNCH_MATRIX, MATERIALIZABLE_LAUNCH_MATRIX_ROWS } from '../domain/launch-matrix.catalog';

type GateRow = {
  gateKey: string;
  routeKey: string;
  state: 'OPEN' | 'CLOSED';
  generation: number;
  lastSeq: number;
  reason: string | null;
};

/**
 * In-memory stand-in for the control-plane tables, shared across both runs of a bootstrap.
 *
 * `hooks.onLock` fires when a transaction takes the exclusive advisory lock, which is where a
 * concurrent operator command has to be simulated: anything the bootstrap decided BEFORE that point
 * is exactly what F1.5.2 (f) forbids it from acting on.
 */
function makePrisma(seed: GateRow[] = [], hooks: { onLock?: (lockKey: string) => void } = {}) {
  const gates = new Map(seed.map((row) => [`${row.gateKey} ${row.routeKey}`, { ...row }]));
  const transitions: any[] = [];
  const audits: any[] = [];

  const gateApi = {
    findUnique: async (args: any) => {
      const { gateKey, routeKey } = args.where.gateKey_routeKey;
      const row = gates.get(`${gateKey} ${routeKey}`);
      return row ? { ...row } : null;
    },
    upsert: async (args: any) => {
      const { gateKey, routeKey } = args.where.gateKey_routeKey;
      const key = `${gateKey} ${routeKey}`;
      if (!gates.has(key)) {
        gates.set(key, { gateKey, routeKey, state: 'CLOSED', generation: 0, lastSeq: 0, reason: null, ...args.create });
      }
      return { ...gates.get(key)! };
    },
    updateMany: async (args: any) => {
      const row = gates.get(`${args.where.gateKey} ${args.where.routeKey}`);
      if (!row || row.generation !== args.where.generation) return { count: 0 };
      Object.assign(row, args.data);
      return { count: 1 };
    },
  };

  const transitionApi = {
    create: async (args: any) => { transitions.push(args.data); return args.data; },
    findUnique: async (args: any) => {
      const { gateKey, routeKey, commandId } = args.where.gateKey_routeKey_commandId;
      return transitions.find((row) => row.gateKey === gateKey && row.routeKey === routeKey && row.commandId === commandId) ?? null;
    },
    /**
     * Filters on EVERY scalar the caller sent, exactly like the real `where` — so an attestation
     * lookup that forgets the generation, the environment or the build fails here instead of
     * quietly passing — and honours `orderBy.seq`, which is what picks the OPEN that CREATED a
     * generation rather than the newest one inside it.
     */
    findFirst: async (args: any) => {
      const direction = args.orderBy?.seq === 'asc' ? 1 : -1;
      return transitions
        .filter((row) => Object.entries(args.where).every(([key, value]) => row[key] === value))
        .sort((a, b) => (a.seq - b.seq) * direction)[0] ?? null;
    },
    /**
     * The authority rule reads EVERY marker of a (route, generation, environment) — OPENs and
     * retirement markers alike — and takes the newest per build, so this must not filter on `action`.
     */
    findMany: async (args: any) => transitions
      .filter((row) => Object.entries(args.where).every(([key, value]) => row[key] === value)),
  };

  /** The stored-result table every real command writes (UAT r5 item 2); attestations write none. */
  const results: any[] = [];
  const resultApi = {
    create: async (args: any) => { results.push(args.data); return args.data; },
    findUnique: async (args: any) => {
      const { gateKey, routeKey, commandId } = args.where.gateKey_routeKey_commandId;
      return results.find((row) => row.gateKey === gateKey && row.routeKey === routeKey && row.commandId === commandId) ?? null;
    },
  };

  const tx = {
    // The exclusive half of the CC1 claim protocol, taken by every gate transition (spec:60).
    $executeRaw: async (sql: any) => { hooks.onLock?.(String(sql?.values?.[0] ?? '')); return 1; },
    featureLaunchGate: {
      ...gateApi,
      update: async (args: any) => {
        const { gateKey, routeKey } = args.where.gateKey_routeKey;
        const row = gates.get(`${gateKey} ${routeKey}`)!;
        Object.assign(row, args.data);
        return { ...row };
      },
    },
    featureLaunchGateTransition: transitionApi,
    featureLaunchCommandResult: resultApi,
    auditLog: { create: async (args: any) => { audits.push(args.data); return args.data; } },
  };

  return {
    gates,
    transitions,
    results,
    audits,
    client: {
      featureLaunchGate: gateApi,
      featureLaunchGateTransition: transitionApi,
      featureLaunchCommandResult: resultApi,
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    },
  } as any;
}

// P0-3: the bootstrap no longer declares an environment/build — the server derives both, so the
// expected values come from the same resolver the command uses (never a hard-coded literal, which
// would fail wherever CI injects a real GIT_SHA).
const SEED_OPTIONS = {};
const DEPLOYMENT = resolveDeploymentIdentity(process.env);

describe('FEATURE_LAUNCH_MATRIX catalog', () => {
  it('matches docs/specs/feature-entitlement-launch-matrix.json row for row', () => {
    const docPath = path.resolve(__dirname, '../../../../../../docs/specs/feature-entitlement-launch-matrix.json');
    const doc = JSON.parse(readFileSync(docPath, 'utf8')) as { rows: any[]; counts: { total: number } };

    assert.equal(FEATURE_LAUNCH_MATRIX.length, doc.counts.total);
    assert.deepEqual(
      FEATURE_LAUNCH_MATRIX.map((row) => ({
        gateKey: row.gateKey,
        routeKey: row.routeKey,
        routeClass: row.routeClass,
        seedState: row.seedState,
        status: row.matrixRowStatus,
        specialistApprovalRequired: row.specialistApprovalRequired,
      })),
      doc.rows.map((row) => ({
        gateKey: row.gateKey,
        routeKey: row.routeKey,
        routeClass: row.routeClass,
        seedState: row.seedState,
        status: row.status,
        specialistApprovalRequired: row.specialistApprovalRequired,
      })),
    );
  });

  it('treats exactly the `<...>` namespace rows as non-materializable', () => {
    for (const row of FEATURE_LAUNCH_MATRIX) {
      assert.equal(row.materializable, !row.routeKey.startsWith('<'), row.routeKey);
      if (!row.materializable) assert.ok((row.notMaterializableReason ?? '').length > 0);
    }
    assert.equal(MATERIALIZABLE_LAUNCH_MATRIX_ROWS.length, 20);
    assert.equal(MATERIALIZABLE_LAUNCH_MATRIX_ROWS.filter((row) => row.seedState === 'OPEN').length, 16);
    assert.equal(MATERIALIZABLE_LAUNCH_MATRIX_ROWS.filter((row) => row.seedState === 'CLOSED').length, 4);
  });
});

describe('seedLaunchGates', () => {
  it('opens the 16 ordinary rows and materializes the 4 concrete rows as CLOSED baselines', async () => {
    const prisma = makePrisma();
    const result = await seedLaunchGates(prisma, SEED_OPTIONS);

    assert.equal(result.opened.length, 16);
    assert.equal(result.closedBaseline.length, 4);
    assert.equal(prisma.gates.size, 20);
    assert.equal(prisma.transitions.length, 16, 'a CLOSED baseline is not a transition');

    for (const transition of prisma.transitions) {
      assert.equal(transition.action, 'OPEN');
      // P0-3: recorded from the deployment, not from the caller or a seed literal.
      assert.equal(transition.buildReleaseId, DEPLOYMENT.buildReleaseId);
      assert.equal(transition.targetEnvironment, DEPLOYMENT.targetEnvironment);
      assert.equal(transition.actorUserId, 'SYSTEM');
      assert.equal(transition.expectedGeneration, 0);
      assert.equal(transition.generation, 1);
      assert.equal(transition.emergencyClose, false);
      assert.equal(transition.releaseApprovedByUserId, 'SYSTEM');
    }
    for (const row of [...prisma.gates.values()]) {
      const matrixRow = MATERIALIZABLE_LAUNCH_MATRIX_ROWS.find((m) => m.gateKey === row.gateKey && m.routeKey === row.routeKey)!;
      assert.equal(row.state, matrixRow.seedState);
      assert.equal(row.generation, matrixRow.seedState === 'OPEN' ? 1 : 0);
    }
  });

  it('never materializes a namespace placeholder, and records why it was skipped', async () => {
    const prisma = makePrisma();
    const result = await seedLaunchGates(prisma, SEED_OPTIONS);

    assert.equal(result.skipped.length, 2);
    for (const skipped of result.skipped) {
      assert.ok(skipped.routeKey.startsWith('<'));
      assert.match(skipped.reason, /namespace/);
      assert.equal(prisma.gates.get(`${skipped.gateKey} ${skipped.routeKey}`), undefined);
    }
  });

  it('is a no-op on the second run', async () => {
    const prisma = makePrisma();
    await seedLaunchGates(prisma, SEED_OPTIONS);
    const before = JSON.stringify([...prisma.gates.values()]);

    const second = await seedLaunchGates(prisma, SEED_OPTIONS);

    assert.equal(second.opened.length, 0);
    assert.equal(second.closedBaseline.length, 0);
    assert.equal(second.unchanged.length, 20);
    assert.equal(prisma.transitions.length, 16, 'the second run appends no transition');
    assert.equal(JSON.stringify([...prisma.gates.values()]), before, 'no generation moved');
  });

  it('never reopens a route an operator has closed', async () => {
    const prisma = makePrisma([
      // Emergency-closed after the first bootstrap: generation 2, two recorded transitions.
      { gateKey: 'crm', routeKey: 'DEFAULT', state: 'CLOSED', generation: 2, lastSeq: 2, reason: 'INC-1' },
    ]);

    const result = await seedLaunchGates(prisma, SEED_OPTIONS);

    assert.ok(result.skipped.some((row) => row.gateKey === 'crm' && /never reopens/.test(row.reason)));
    assert.ok(!result.opened.includes('crm/DEFAULT'));
    assert.equal(prisma.gates.get('crm DEFAULT').state, 'CLOSED');
    assert.equal(prisma.gates.get('crm DEFAULT').generation, 2);
  });

  it('never re-closes a specialist route an operator has legitimately opened', async () => {
    const prisma = makePrisma([
      { gateKey: 'cap.wht50bis', routeKey: 'SYSTEM_INITIAL_ISSUE', state: 'OPEN', generation: 1, lastSeq: 1, reason: null },
    ]);

    await seedLaunchGates(prisma, SEED_OPTIONS);

    assert.equal(prisma.gates.get('cap.wht50bis SYSTEM_INITIAL_ISSUE').state, 'OPEN');
    assert.equal(prisma.gates.get('cap.wht50bis SYSTEM_INITIAL_ISSUE').generation, 1);
  });
});

/**
 * F1.5.1 item 4 — the guard requires the latest OPEN to name the RUNNING build, so the bootstrap
 * re-attests what the bootstrap itself opened, and only that. A human approval is never re-stated
 * by a deploy: the operator re-OPENs it, or the route stays unavailable.
 */
describe('seedLaunchGates — per-build attestation', () => {
  /** The transition a PREVIOUS deploy left behind, on a build that is no longer running. */
  const staleSystemOpen = (gateKey: string, actorUserId = 'SYSTEM') => ({
    gateKey,
    routeKey: 'DEFAULT',
    seq: 1,
    generation: 1,
    action: 'OPEN',
    actorUserId,
    targetEnvironment: DEPLOYMENT.targetEnvironment,
    buildReleaseId: 'build-from-the-previous-deploy',
  });

  it('appends a SYSTEM attestation on the new build without moving the generation', async () => {
    const prisma = makePrisma([{ gateKey: 'crm', routeKey: 'DEFAULT', state: 'OPEN', generation: 1, lastSeq: 1, reason: null }]);
    prisma.transitions.push(staleSystemOpen('crm'));

    const result = await seedLaunchGates(prisma, SEED_OPTIONS);

    assert.deepEqual(result.attested, ['crm/DEFAULT']);
    const attestation = prisma.transitions.find((row: any) => row.gateKey === 'crm' && row.seq === 2);
    assert.equal(attestation.action, 'OPEN');
    assert.equal(attestation.actorUserId, 'SYSTEM');
    assert.equal(attestation.buildReleaseId, DEPLOYMENT.buildReleaseId);
    assert.equal(attestation.targetEnvironment, DEPLOYMENT.targetEnvironment);
    // The generation is the CC1 fence every in-flight ExecutionAttempt stamped: it must NOT move.
    assert.equal(attestation.generation, 1);
    // The generation AND the seq are part of the key: one build may attest two generations of a
    // route over its lifetime, and may be retired and re-attested on one generation after a
    // rollback, while (gateKey, routeKey, commandId) stays unique.
    assert.equal(attestation.commandId, `F1-SEED:attest:${DEPLOYMENT.targetEnvironment}:${DEPLOYMENT.buildReleaseId}:g1:s2`);
    assert.equal(prisma.gates.get('crm DEFAULT').generation, 1);
    assert.equal(prisma.gates.get('crm DEFAULT').state, 'OPEN');
    assert.equal(prisma.gates.get('crm DEFAULT').lastSeq, 2, 'only the sequence advances');
  });

  it('is idempotent — re-running the bootstrap on the same build appends nothing', async () => {
    const prisma = makePrisma([{ gateKey: 'crm', routeKey: 'DEFAULT', state: 'OPEN', generation: 1, lastSeq: 1, reason: null }]);
    prisma.transitions.push(staleSystemOpen('crm'));

    await seedLaunchGates(prisma, SEED_OPTIONS);
    const afterFirst = prisma.transitions.length;
    const second = await seedLaunchGates(prisma, SEED_OPTIONS);

    assert.equal(prisma.transitions.length, afterFirst, 'the same build attests once');
    assert.deepEqual(second.attested, []);
    assert.ok(second.unchanged.includes('crm/DEFAULT'));
  });

  it('never attests a HUMAN-opened row — it is skipped with the re-OPEN reason', async () => {
    const prisma = makePrisma([{ gateKey: 'crm', routeKey: 'DEFAULT', state: 'OPEN', generation: 1, lastSeq: 1, reason: null }]);
    prisma.transitions.push(staleSystemOpen('crm', 'release-owner-1'));

    const result = await seedLaunchGates(prisma, SEED_OPTIONS);

    assert.deepEqual(result.attested, []);
    assert.ok(result.skipped.some((row) => row.gateKey === 'crm' && /re-OPEN it on this build/.test(row.reason)));
    assert.equal(prisma.transitions.filter((row: any) => row.gateKey === 'crm').length, 1, 'nothing was appended');
  });

  it('never attests a SPECIALIST_LEGAL row, even one opened by SYSTEM', async () => {
    const prisma = makePrisma([
      { gateKey: 'cap.wht50bis', routeKey: 'SYSTEM_INITIAL_ISSUE', state: 'OPEN', generation: 1, lastSeq: 1, reason: null },
    ]);
    prisma.transitions.push({ ...staleSystemOpen('cap.wht50bis'), routeKey: 'SYSTEM_INITIAL_ISSUE' });

    const result = await seedLaunchGates(prisma, SEED_OPTIONS);

    assert.deepEqual(result.attested, []);
    assert.equal(prisma.transitions.filter((row: any) => row.gateKey === 'cap.wht50bis').length, 1);
  });

  it('leaves a first-run bootstrap alone — every OPEN it just wrote already names this build', async () => {
    const prisma = makePrisma();
    const first = await seedLaunchGates(prisma, SEED_OPTIONS);
    assert.deepEqual(first.attested, []);

    const second = await seedLaunchGates(prisma, SEED_OPTIONS);
    assert.deepEqual(second.attested, []);
    assert.equal(prisma.transitions.length, 16);
  });

  it('reads the lineage of the CURRENT generation — a human reopen buries an older SYSTEM one', async () => {
    const prisma = makePrisma([{ gateKey: 'crm', routeKey: 'DEFAULT', state: 'OPEN', generation: 2, lastSeq: 3, reason: null }]);
    prisma.transitions.push(
      staleSystemOpen('crm'),
      { ...staleSystemOpen('crm', 'release-owner-1'), seq: 3, generation: 2 },
    );

    const result = await seedLaunchGates(prisma, SEED_OPTIONS);

    assert.deepEqual(result.attested, [], 'the SYSTEM open of generation 1 no longer speaks for generation 2');
    assert.ok(result.skipped.some((row) => row.gateKey === 'crm' && /re-OPEN it on this build/.test(row.reason)));
    assert.equal(prisma.transitions.filter((row: any) => row.gateKey === 'crm').length, 2);
  });
});

/**
 * F1.5.2 — the rolling-deploy window at the bootstrap end, and the race the pre-lock read allowed.
 */
describe('seedLaunchGates — rolling window and the lock (F1.5.2)', () => {
  const staleSystemOpen = (gateKey: string, actorUserId = 'SYSTEM') => ({
    gateKey,
    routeKey: 'DEFAULT',
    seq: 1,
    generation: 1,
    action: 'OPEN',
    actorUserId,
    targetEnvironment: DEPLOYMENT.targetEnvironment,
    buildReleaseId: 'build-from-the-previous-deploy',
  });

  /** Runs the bootstrap as if this process were the given build. */
  async function asBuild<T>(buildReleaseId: string, fn: () => Promise<T>): Promise<T> {
    const previous = process.env.GIT_SHA;
    process.env.GIT_SHA = buildReleaseId;
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete process.env.GIT_SHA;
      else process.env.GIT_SHA = previous;
    }
  }

  const openCrm = (): GateRow[] => [{ gateKey: 'crm', routeKey: 'DEFAULT', state: 'OPEN', generation: 1, lastSeq: 1, reason: null }];
  /** The exact advisory-lock key crm's attestation transaction takes (spec:60). */
  const CRM_LOCK = 'launch_gate:crm:DEFAULT';

  it('lets builds A and B hold attestations of the SAME generation at once', async () => {
    const prisma = makePrisma(openCrm());
    prisma.transitions.push(staleSystemOpen('crm'));

    await asBuild('build-a', () => seedLaunchGates(prisma, SEED_OPTIONS));
    const second = await asBuild('build-b', () => seedLaunchGates(prisma, SEED_OPTIONS));

    assert.ok(second.attested.includes('crm/DEFAULT'));
    const crm = prisma.transitions.filter((row: any) => row.gateKey === 'crm');
    assert.deepEqual(
      crm.map((row: any) => [row.action, row.buildReleaseId]),
      [
        ['OPEN', 'build-from-the-previous-deploy'],
        ['OPEN', 'build-a'],
        ['OPEN', 'build-b'],
      ],
      'attesting B never retracts A — both tasks are live during a rolling deploy',
    );
    assert.ok(crm.every((row: any) => row.generation === 1), 'an attestation never moves the generation');
    assert.equal(prisma.gates.get('crm DEFAULT').generation, 1);
    assert.equal(prisma.gates.get('crm DEFAULT').lastSeq, 3, 'only the sequence advances');
  });

  /**
   * UAT r5 item 1 — the PRE-deploy bootstrap ONLY appends. It runs before the incoming build serves a
   * single request, so retiring the outgoing one here would strip authority from the runtime still
   * taking traffic whenever the rollout failed to become healthy. `retireLaunchBuilds` bounds the
   * window afterwards, from the builds actually serving.
   */
  it('appends a third attestation without retiring anything', async () => {
    const prisma = makePrisma(openCrm());
    prisma.transitions.push(staleSystemOpen('crm'));

    await asBuild('build-a', () => seedLaunchGates(prisma, SEED_OPTIONS));
    await asBuild('build-b', () => seedLaunchGates(prisma, SEED_OPTIONS));
    const third = await asBuild('build-c', () => seedLaunchGates(prisma, SEED_OPTIONS));

    assert.ok(third.attested.includes('crm/DEFAULT'));
    const crm = prisma.transitions.filter((row: any) => row.gateKey === 'crm');
    assert.deepEqual(
      crm.map((row: any) => [row.action, row.buildReleaseId]),
      [
        ['OPEN', 'build-from-the-previous-deploy'],
        ['OPEN', 'build-a'],
        ['OPEN', 'build-b'],
        ['OPEN', 'build-c'],
      ],
      'no write path retires — a deploy that never became healthy has taken nothing away',
    );
    assert.equal(crm.filter((row: any) => row.action === 'CLOSE').length, 0);
    assert.ok(crm.every((row: any) => row.generation === 1), 'an attestation never moves the generation');
    assert.equal(prisma.gates.get('crm DEFAULT').lastSeq, 4);
    assert.equal(prisma.gates.get('crm DEFAULT').state, 'OPEN');
  });

  it('re-attests a ROLLED-BACK build instead of bricking it — newest marker wins', async () => {
    const prisma = makePrisma(openCrm());
    prisma.transitions.push(staleSystemOpen('crm'));

    for (const build of ['build-a', 'build-b']) await asBuild(build, () => seedLaunchGates(prisma, SEED_OPTIONS));
    // A post-deploy pass retired the previous build once it stopped serving; a rollback redeploys it.
    prisma.transitions.push({ ...staleSystemOpen('crm'), seq: 4, action: 'CLOSE', commandId: 'F1-RETIRE:x' });
    Object.assign(prisma.gates.get('crm DEFAULT'), { lastSeq: 4 });
    const rolledBack = await asBuild('build-from-the-previous-deploy', () => seedLaunchGates(prisma, SEED_OPTIONS));

    assert.ok(rolledBack.attested.includes('crm/DEFAULT'), 'a retired build must be re-attestable');
    const crm = prisma.transitions.filter((row: any) => row.gateKey === 'crm');
    const last = crm[crm.length - 1];
    assert.deepEqual([last.action, last.buildReleaseId], ['OPEN', 'build-from-the-previous-deploy']);
    // Its commandId carries the seq, so re-attesting the same build+generation is not key reuse.
    assert.equal(last.commandId, `F1-SEED:attest:${DEPLOYMENT.targetEnvironment}:build-from-the-previous-deploy:g1:s${last.seq}`);
    assert.equal(new Set(crm.map((row: any) => row.commandId)).size, crm.length, 'every commandId is unique');
  });

  /**
   * Item 6 — SYSTEM lineage is re-attested by a verified deployment; human/specialist lineage is NOT,
   * ever, in either direction. A retired human approval stays retired until a person issues a fresh
   * command; no deploy, and no replay of the original, brings it back.
   */
  it('never re-attests a HUMAN-opened route, even after its build was retired', async () => {
    const prisma = makePrisma(openCrm());
    prisma.transitions.push(staleSystemOpen('crm', 'release-owner-1'));
    prisma.transitions.push({ ...staleSystemOpen('crm', 'release-owner-1'), seq: 2, action: 'CLOSE', commandId: 'F1-RETIRE:x' });
    Object.assign(prisma.gates.get('crm DEFAULT'), { lastSeq: 2 });

    const result = await asBuild('build-a', () => seedLaunchGates(prisma, SEED_OPTIONS));

    assert.ok(!result.attested.includes('crm/DEFAULT'), 'a deploy never re-states a human approval');
    assert.ok(
      result.skipped.some((row: any) => row.gateKey === 'crm' && /human/.test(row.reason)),
      'the skip is recorded with its reason, never silent',
    );
    assert.equal(
      prisma.transitions.filter((row: any) => row.gateKey === 'crm').length,
      2,
      'the bootstrap appended nothing to a human-opened route',
    );
  });

  it('does not attest a row a human CLOSED between the read and the lock', async () => {
    const prisma: any = makePrisma(openCrm(), {
      // Fires INSIDE crm's transaction, after the bootstrap already read the row as OPEN.
      onLock: (lockKey: string) => {
        if (lockKey !== CRM_LOCK) return;
        // An emergency CLOSE commits while the bootstrap is between its read and its lock.
        Object.assign(prisma.gates.get('crm DEFAULT'), { state: 'CLOSED', generation: 2, lastSeq: 2, reason: 'INC-9' });
      },
    });
    prisma.transitions.push(staleSystemOpen('crm'));

    const result = await seedLaunchGates(prisma, SEED_OPTIONS);

    assert.ok(!result.attested.includes('crm/DEFAULT'));
    assert.ok(result.skipped.some((row) => row.gateKey === 'crm' && /never reopens/.test(row.reason)));
    assert.equal(prisma.transitions.filter((row: any) => row.gateKey === 'crm').length, 1, 'nothing was appended');
    assert.equal(prisma.gates.get('crm DEFAULT').state, 'CLOSED');
    assert.equal(prisma.gates.get('crm DEFAULT').generation, 2);
  });

  it('does not resurrect its own build under a human re-OPEN that landed before the lock', async () => {
    const prisma: any = makePrisma(openCrm(), {
      onLock: (lockKey: string) => {
        if (lockKey !== CRM_LOCK) return;
        // A human CLOSEd (seq 2) and re-OPENed on ANOTHER build (seq 3) — generation 2 is a fresh
        // human approval that says nothing about the build this bootstrap is running.
        Object.assign(prisma.gates.get('crm DEFAULT'), { state: 'OPEN', generation: 2, lastSeq: 3 });
        prisma.transitions.push({
          ...staleSystemOpen('crm', 'release-owner-1'),
          seq: 3,
          generation: 2,
          buildReleaseId: 'build-the-human-approved',
        });
      },
    });
    prisma.transitions.push(staleSystemOpen('crm'));

    const result = await seedLaunchGates(prisma, SEED_OPTIONS);

    assert.deepEqual(result.attested.filter((label) => label === 'crm/DEFAULT'), []);
    assert.ok(result.skipped.some((row) => row.gateKey === 'crm' && /re-OPEN it on this build/.test(row.reason)));
    const crm = prisma.transitions.filter((row: any) => row.gateKey === 'crm');
    assert.equal(crm.length, 2, 'the deploy appended nothing under the human approval');
    assert.ok(
      !crm.some((row: any) => row.generation === 2 && row.actorUserId === 'SYSTEM'),
      'a deploy must never attest its own build onto a generation a person approved for another',
    );
  });
});
