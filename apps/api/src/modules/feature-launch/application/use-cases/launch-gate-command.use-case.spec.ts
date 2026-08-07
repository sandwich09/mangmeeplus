import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import {
  LAUNCH_GATE_ADMIN_ROLE,
  LAUNCH_GATE_MANAGE_PERMISSION,
  LaunchGateCommandUseCase,
  type LaunchGateCommand,
} from './launch-gate-command.use-case';

type GateRow = {
  gateKey: string;
  routeKey: string;
  state: 'OPEN' | 'CLOSED';
  generation: number;
  lastSeq: number;
  reason: string | null;
};

/** In-memory stand-in for the two control-plane tables, with the same uniques the schema has. */
function makePrisma(seedGates: GateRow[] = [], hooks: { beforeCas?: () => void } = {}, seedTransitions: any[] = [], seedResults: any[] = []) {
  const gates = new Map(seedGates.map((gate) => [`${gate.gateKey} ${gate.routeKey}`, { ...gate }]));
  const transitions: any[] = [...seedTransitions];
  const audits: any[] = [];
  const advisoryLocks: string[] = [];

  const gateApi = {
    upsert: async (args: any) => {
      const { gateKey, routeKey } = args.where.gateKey_routeKey;
      const key = `${gateKey} ${routeKey}`;
      if (!gates.has(key)) {
        gates.set(key, { gateKey, routeKey, state: 'CLOSED', generation: 0, lastSeq: 0, reason: null, ...args.create });
      }
      return { ...gates.get(key)! };
    },
    updateMany: async (args: any) => {
      hooks.beforeCas?.();
      const key = `${args.where.gateKey} ${args.where.routeKey}`;
      const row = gates.get(key);
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
    // Filters on EVERY scalar the caller sent, exactly like the real `where`: the idempotence check
    // must miss unless the generation, environment AND build all match, and the authority rule must
    // see RETIREMENT markers as well as OPENs.
    findMany: async (args: any) => transitions
      .filter((row) => Object.entries(args.where).every(([key, value]) => row[key] === value))
      .map((row, index) => ({ seq: index + 1, ...row })),
  };

  // Item 2 — the stored-result table, with the same `(gateKey, routeKey, commandId)` unique the
  // schema has, so a second write under one key is a real collision rather than a silent overwrite.
  const results: any[] = [...seedResults];
  const resultApi = {
    create: async (args: any) => {
      const { gateKey, routeKey, commandId } = args.data;
      if (results.some((row) => row.gateKey === gateKey && row.routeKey === routeKey && row.commandId === commandId)) {
        throw new Error(`unique violation FeatureLaunchCommandResult(${gateKey}, ${routeKey}, ${commandId})`);
      }
      results.push(args.data);
      return args.data;
    },
    findUnique: async (args: any) => {
      const { gateKey, routeKey, commandId } = args.where.gateKey_routeKey_commandId;
      return results.find((row) => row.gateKey === gateKey && row.routeKey === routeKey && row.commandId === commandId) ?? null;
    },
  };

  const tx = {
    // The exclusive half of the CC1 claim protocol (spec:60): the claim takes the SHARED side.
    $executeRaw: async (sql: any) => { advisoryLocks.push(String(sql.values?.[0] ?? '')); return 1; },
    featureLaunchGate: gateApi,
    featureLaunchGateTransition: transitionApi,
    featureLaunchCommandResult: resultApi,
    auditLog: { create: async (args: any) => { audits.push(args.data); return args.data; } },
  };

  return {
    gates,
    transitions,
    results,
    audits,
    advisoryLocks,
    client: {
      featureLaunchGate: gateApi,
      featureLaunchGateTransition: transitionApi,
      featureLaunchCommandResult: resultApi,
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    },
  } as any;
}

/** Server truth for this process — the same resolver the command uses (P0-3). */
const DEPLOYMENT = resolveDeploymentIdentity(process.env);

const OPEN_INVENTORY: LaunchGateCommand = {
  gateKey: 'inventory',
  routeKey: 'DEFAULT',
  action: 'OPEN',
  commandId: 'cmd-1',
  actorUserId: 'release-owner-1',
  actorRoles: [LAUNCH_GATE_ADMIN_ROLE],
  actorPermissions: [LAUNCH_GATE_MANAGE_PERMISSION],
  requestId: 'req-1',
  snapshot: {
    // Environment and build are omitted: they are server truth, not caller input.
    expectedGeneration: 0,
    emergencyClose: false,
  },
};

describe('LaunchGateCommandUseCase — real transition', () => {
  it('takes the exclusive lock on the exact route the CC1 claim shares (spec:60)', async () => {
    const prisma = makePrisma();
    await new LaunchGateCommandUseCase(prisma).execute(OPEN_INVENTORY);
    assert.deepEqual(prisma.advisoryLocks, ['launch_gate:inventory:DEFAULT'], 'one exact route row, never a sibling');
  });

  it('materializes the row at CLOSED/0 and opens it to generation 1 with its snapshot', async () => {
    const prisma = makePrisma();
    const result = await new LaunchGateCommandUseCase(prisma).execute(OPEN_INVENTORY);

    assert.deepEqual(
      { state: result.state, generation: result.generation, lastSeq: result.lastSeq, changed: result.changed, replayed: result.replayed },
      { state: 'OPEN', generation: 1, lastSeq: 1, changed: true, replayed: false },
    );
    assert.equal(prisma.transitions.length, 1);
    const transition = prisma.transitions[0];
    assert.equal(transition.seq, 1);
    assert.equal(transition.generation, 1);
    assert.equal(transition.expectedGeneration, 0);
    assert.equal(transition.routeClass, 'ORDINARY', 'routeClass comes from the matrix, not the caller');
    assert.equal(transition.buildReleaseId, DEPLOYMENT.buildReleaseId, 'build id comes from the deployment');
    assert.equal(transition.targetEnvironment, DEPLOYMENT.targetEnvironment);
    assert.equal(transition.releaseApprovedByUserId, 'release-owner-1', 'the release approver IS the actor');
    assert.equal(transition.emergencyClose, false);
    assert.equal(prisma.audits.length, 1);
    assert.equal(prisma.audits[0].action, 'system.launch_gate.open');
    assert.equal(prisma.audits[0].riskLevel, 'HIGH');
  });

  it('emergency CLOSE records the incident authority and closes an OPEN route', async () => {
    const prisma = makePrisma([{ gateKey: 'crm', routeKey: 'DEFAULT', state: 'OPEN', generation: 1, lastSeq: 1, reason: null }]);
    const result = await new LaunchGateCommandUseCase(prisma).execute({
      ...OPEN_INVENTORY,
      gateKey: 'crm',
      action: 'CLOSE',
      commandId: 'cmd-close',
      snapshot: {
        expectedGeneration: 1,
        emergencyClose: true,
        incidentRef: 'INC-1',
      },
    });

    assert.equal(result.state, 'CLOSED');
    assert.equal(result.generation, 2);
    assert.equal(prisma.transitions[0].incidentRef, 'INC-1');
    assert.equal(prisma.transitions[0].releaseApprovedByUserId, null);
    // P0-3(c): the on-call actor IS the emergency authority; it is never a payload string.
    assert.equal(prisma.transitions[0].emergencyAuthorityUserId, 'release-owner-1');
  });

  // Uses two ORDINARY routes: since F1.5.1 the only same-gate sibling pair in the matrix
  // (cap.wht50bis) is SPECIALIST_LEGAL and can no longer be opened by any command at all.
  it('increments only its own route row — an OPEN sibling never moves', async () => {
    const prisma = makePrisma([
      { gateKey: 'inventory', routeKey: 'DEFAULT', state: 'CLOSED', generation: 0, lastSeq: 0, reason: null },
      { gateKey: 'crm', routeKey: 'DEFAULT', state: 'CLOSED', generation: 0, lastSeq: 0, reason: null },
    ]);
    await new LaunchGateCommandUseCase(prisma).execute(OPEN_INVENTORY);

    assert.deepEqual(
      prisma.gates.get('inventory DEFAULT'),
      { gateKey: 'inventory', routeKey: 'DEFAULT', state: 'OPEN', generation: 1, lastSeq: 1, reason: null },
    );
    const sibling = prisma.gates.get('crm DEFAULT');
    assert.equal(sibling.state, 'CLOSED');
    assert.equal(sibling.generation, 0, 'an OPEN sibling never authorizes another route');
  });
});

describe('LaunchGateCommandUseCase — idempotency and CAS (spec:53)', () => {
  it('replays the stored result for the same key + fingerprint + action', async () => {
    const prisma = makePrisma();
    const useCase = new LaunchGateCommandUseCase(prisma);
    await useCase.execute(OPEN_INVENTORY);
    const replay = await useCase.execute(OPEN_INVENTORY);

    assert.equal(replay.replayed, true);
    assert.equal(replay.generation, 1);
    assert.equal(replay.lastSeq, 1);
    assert.equal(prisma.transitions.length, 1, 'a replay appends no transition');
    assert.equal(prisma.gates.get('inventory DEFAULT').generation, 1, 'a replay never bumps the generation');
  });

  it('rejects key reuse with a different payload', async () => {
    const prisma = makePrisma();
    const useCase = new LaunchGateCommandUseCase(prisma);
    await useCase.execute(OPEN_INVENTORY);

    await assert.rejects(
      // The payload can no longer carry a different build, so a distinct payload is a distinct
      // reason/evidence shape — the fingerprint still has to reject it.
      () => useCase.execute({
        ...OPEN_INVENTORY,
        snapshot: { ...OPEN_INVENTORY.snapshot, validationEvidenceRef: 'matrix://something-else' },
      }),
      (err: ConflictException) => {
        assert.equal((err.getResponse() as any).code, 'launch_gate_command_conflict');
        return true;
      },
    );
    assert.equal(prisma.transitions.length, 1);
  });

  it('rejects key reuse with a different action', async () => {
    const prisma = makePrisma();
    const useCase = new LaunchGateCommandUseCase(prisma);
    await useCase.execute(OPEN_INVENTORY);

    await assert.rejects(
      () => useCase.execute({ ...OPEN_INVENTORY, action: 'CLOSE' }),
      (err: ConflictException) => (err.getResponse() as any).code === 'launch_gate_command_conflict',
    );
  });

  it('rejects a delayed command carrying a stale expected generation, and writes nothing', async () => {
    const prisma = makePrisma([{ gateKey: 'inventory', routeKey: 'DEFAULT', state: 'CLOSED', generation: 4, lastSeq: 4, reason: null }]);

    await assert.rejects(
      () => new LaunchGateCommandUseCase(prisma).execute({ ...OPEN_INVENTORY, commandId: 'cmd-stale' }),
      (err: ConflictException) => {
        const body = err.getResponse() as any;
        assert.equal(body.code, 'launch_gate_generation_conflict');
        assert.equal(body.currentGeneration, 4);
        return true;
      },
    );
    assert.equal(prisma.transitions.length, 0);
    assert.equal(prisma.gates.get('inventory DEFAULT').state, 'CLOSED');
  });

  it('conflicts when a racing command commits between the read and the CAS', async () => {
    const prisma = makePrisma([], {
      // A concurrent winner bumps the row after this command read generation 0.
      beforeCas: () => {
        const row = prisma.gates.get('inventory DEFAULT');
        if (row && row.generation === 0) Object.assign(row, { state: 'OPEN', generation: 1, lastSeq: 1 });
      },
    });

    await assert.rejects(
      () => new LaunchGateCommandUseCase(prisma).execute(OPEN_INVENTORY),
      (err: ConflictException) => (err.getResponse() as any).code === 'launch_gate_generation_conflict',
    );
    assert.equal(prisma.transitions.length, 0, 'the loser appends no transition');
  });

  it('treats a CLOSE whose target state already holds as a no-op, not a transition', async () => {
    const prisma = makePrisma([{ gateKey: 'inventory', routeKey: 'DEFAULT', state: 'CLOSED', generation: 2, lastSeq: 2, reason: null }]);
    const result = await new LaunchGateCommandUseCase(prisma).execute({
      ...OPEN_INVENTORY,
      action: 'CLOSE',
      commandId: 'cmd-close-again',
      snapshot: { ...OPEN_INVENTORY.snapshot, expectedGeneration: 2 },
    });

    assert.equal(result.changed, false);
    assert.equal(result.generation, 2);
    assert.equal(prisma.transitions.length, 0, 'CLOSED→CLOSED carries no deployment claim and is never real');
    assert.equal(prisma.audits.length, 0);
  });
});

/**
 * F1.5.2 owner ruling 2 — "already OPEN" is two different facts, and NEITHER moves the generation.
 * An OPEN this deployment already holds at the current generation is an idempotent no-op; an OPEN
 * naming a build or environment this generation has not accepted is a per-build ACCEPTANCE: a real,
 * audited transition appended at the SAME generation. The generation is the fence every in-flight
 * `ExecutionAttempt` stamped, so bumping it here would orphan work stamped on build A the moment a
 * human accepts build B. To kill that work the operator issues an explicit CLOSE, then an OPEN.
 */
describe('LaunchGateCommandUseCase — OPEN on an already-OPEN row (F1.5.2 ruling 2)', () => {
  const OPEN_ROW: GateRow = { gateKey: 'inventory', routeKey: 'DEFAULT', state: 'OPEN', generation: 1, lastSeq: 1, reason: null };

  /** The OPEN (or per-build attestation) the row is currently living on. */
  const livingOn = (overrides: Record<string, unknown> = {}) => ({
    gateKey: 'inventory',
    routeKey: 'DEFAULT',
    seq: 1,
    generation: 1,
    commandId: 'earlier-open',
    action: 'OPEN',
    actorUserId: 'release-owner-0',
    targetEnvironment: DEPLOYMENT.targetEnvironment,
    buildReleaseId: DEPLOYMENT.buildReleaseId,
    ...overrides,
  });

  const reOpen = (commandId = 'cmd-reopen'): LaunchGateCommand => ({
    ...OPEN_INVENTORY,
    commandId,
    snapshot: { ...OPEN_INVENTORY.snapshot, expectedGeneration: 1 },
  });

  it('is an idempotent no-op when this exact deployment already holds the OPEN', async () => {
    const prisma = makePrisma([OPEN_ROW], {}, [livingOn()]);
    const result = await new LaunchGateCommandUseCase(prisma).execute(reOpen('cmd-again'));

    assert.equal(result.changed, false);
    assert.equal(result.generation, 1);
    assert.equal(prisma.transitions.length, 1, 'nothing was appended');
    assert.equal(prisma.audits.length, 0);
    assert.equal(prisma.gates.get('inventory DEFAULT').generation, 1);
  });

  it('ACCEPTS another build at the SAME generation — real transition, generation unchanged', async () => {
    const prisma = makePrisma([OPEN_ROW], {}, [livingOn({ buildReleaseId: 'build-from-the-previous-deploy' })]);
    const result = await new LaunchGateCommandUseCase(prisma).execute(reOpen());

    assert.deepEqual(
      { state: result.state, generation: result.generation, lastSeq: result.lastSeq, changed: result.changed },
      { state: 'OPEN', generation: 1, lastSeq: 2, changed: true },
    );
    const appended = prisma.transitions[1];
    assert.equal(appended.action, 'OPEN');
    assert.equal(appended.expectedGeneration, 1);
    assert.equal(appended.generation, 1, 'an acceptance never moves the generation');
    assert.equal(appended.buildReleaseId, DEPLOYMENT.buildReleaseId);
    assert.equal(appended.releaseApprovedByUserId, 'release-owner-1', 'an acceptance is a fresh human approval');
    assert.equal(prisma.audits.length, 1, 'an acceptance is audited like any other real transition');
    assert.equal(prisma.audits[0].metadataJson.generation, 1);

    // Ruling 2: work stamped on the previously accepted build keeps its availability vector — the
    // generation `ExecutionAttempt` compares at claim time is exactly where it was.
    assert.equal(prisma.gates.get('inventory DEFAULT').generation, livingOn().generation);
    assert.equal(prisma.gates.get('inventory DEFAULT').lastSeq, 2, 'only the sequence advances');
  });

  it('ACCEPTS another environment at the same generation too', async () => {
    const otherEnvironment = DEPLOYMENT.targetEnvironment === 'production' ? 'uat' : 'production';
    const prisma = makePrisma([OPEN_ROW], {}, [livingOn({ targetEnvironment: otherEnvironment })]);
    const result = await new LaunchGateCommandUseCase(prisma).execute(reOpen());

    assert.equal(result.changed, true);
    assert.equal(result.generation, 1);
    assert.equal(prisma.transitions[1].targetEnvironment, DEPLOYMENT.targetEnvironment);
  });

  it('accepts on an OPEN of a DEAD generation — only the CURRENT generation can make it idempotent', async () => {
    // Same environment, same build, but recorded before a CLOSE/re-OPEN cycle moved the row on.
    const prisma = makePrisma(
      [{ ...OPEN_ROW, generation: 3, lastSeq: 3 }],
      {},
      [livingOn({ generation: 1 })],
    );
    const result = await new LaunchGateCommandUseCase(prisma).execute({
      ...OPEN_INVENTORY,
      commandId: 'cmd-reopen-gen3',
      snapshot: { ...OPEN_INVENTORY.snapshot, expectedGeneration: 3 },
    });

    assert.equal(result.changed, true);
    assert.equal(result.generation, 3, 'the acceptance lands on the live generation, not a new one');
    assert.equal(prisma.transitions[1].generation, 3);
  });

  it('still replays an acceptance by commandId instead of appending it twice', async () => {
    const prisma = makePrisma([OPEN_ROW], {}, [livingOn({ buildReleaseId: 'build-from-the-previous-deploy' })]);
    const useCase = new LaunchGateCommandUseCase(prisma);
    await useCase.execute(reOpen());
    const replay = await useCase.execute(reOpen());

    assert.equal(replay.replayed, true);
    assert.equal(replay.generation, 1, 'the stored result, not a second acceptance');
    assert.equal(replay.lastSeq, 2);
    assert.equal(prisma.transitions.length, 2, 'a replay appends no transition');
    assert.equal(prisma.gates.get('inventory DEFAULT').generation, 1, 'a replay never bumps the generation');
  });

  it('kills the accepted builds only on an explicit CLOSE then OPEN — each of those bumps', async () => {
    const prisma = makePrisma([OPEN_ROW], {}, [livingOn({ buildReleaseId: 'build-A' })]);
    const useCase = new LaunchGateCommandUseCase(prisma);

    await useCase.execute(reOpen('cmd-accept'));
    assert.equal(prisma.gates.get('inventory DEFAULT').generation, 1);

    const closed = await useCase.execute({
      ...OPEN_INVENTORY,
      action: 'CLOSE',
      commandId: 'cmd-close',
      snapshot: { ...OPEN_INVENTORY.snapshot, expectedGeneration: 1 },
    });
    assert.deepEqual({ state: closed.state, generation: closed.generation }, { state: 'CLOSED', generation: 2 });

    const reopened = await useCase.execute({
      ...OPEN_INVENTORY,
      commandId: 'cmd-open-again',
      snapshot: { ...OPEN_INVENTORY.snapshot, expectedGeneration: 2 },
    });
    assert.deepEqual({ state: reopened.state, generation: reopened.generation }, { state: 'OPEN', generation: 3 });
  });
});

/**
 * UAT r5 item 1 — a WRITE PATH never retires. The command can only see the transitions on the route,
 * never which builds are actually serving, so bounding the window from here is a guess made at the
 * worst possible moment (before the incoming build has proven healthy). Accepting a third build now
 * simply appends; `retireLaunchBuilds` bounds the window after health verification.
 */
describe('LaunchGateCommandUseCase — acceptance only appends (UAT r5 item 1)', () => {
  const OPEN_ROW: GateRow = { gateKey: 'inventory', routeKey: 'DEFAULT', state: 'OPEN', generation: 1, lastSeq: 2, reason: null };

  const attestation = (buildReleaseId: string, seq: number) => ({
    gateKey: 'inventory',
    routeKey: 'DEFAULT',
    seq,
    generation: 1,
    commandId: `open-${buildReleaseId}`,
    action: 'OPEN',
    actorUserId: 'SYSTEM',
    targetEnvironment: DEPLOYMENT.targetEnvironment,
    buildReleaseId,
  });

  it('appends ONLY the acceptance when a third build is accepted — no retirement marker', async () => {
    const prisma = makePrisma([OPEN_ROW], {}, [attestation('build-1', 1), attestation('build-2', 2)]);
    const result = await new LaunchGateCommandUseCase(prisma).execute({
      ...OPEN_INVENTORY,
      commandId: 'cmd-accept-third',
      snapshot: { ...OPEN_INVENTORY.snapshot, expectedGeneration: 1 },
    });

    const appended = prisma.transitions.slice(2);
    assert.deepEqual(
      appended.map((row: any) => [row.action, row.buildReleaseId, row.seq]),
      [['OPEN', DEPLOYMENT.buildReleaseId, 3]],
      'the outgoing build keeps its authority until the post-deploy pass sees it stop serving',
    );
    assert.equal(appended[0].generation, 1, 'an acceptance never moves the generation');
    assert.equal(result.lastSeq, 3);
    assert.equal(prisma.gates.get('inventory DEFAULT').lastSeq, 3);
  });

  it('records the acceptance as ACCEPTED, and a real state change as APPLIED', async () => {
    const accepting = makePrisma([OPEN_ROW], {}, [attestation('build-1', 1), attestation('build-2', 2)]);
    await new LaunchGateCommandUseCase(accepting).execute({
      ...OPEN_INVENTORY,
      commandId: 'cmd-accept-kind',
      snapshot: { ...OPEN_INVENTORY.snapshot, expectedGeneration: 1 },
    });
    assert.deepEqual(
      accepting.results.map((row: any) => [row.resultKind, row.generation, row.lastSeq]),
      [['ACCEPTED', 1, 3]],
    );

    const applying = makePrisma();
    await new LaunchGateCommandUseCase(applying).execute(OPEN_INVENTORY);
    assert.deepEqual(
      applying.results.map((row: any) => [row.resultKind, row.state, row.generation, row.buildReleaseId]),
      [['APPLIED', 'OPEN', 1, DEPLOYMENT.buildReleaseId]],
      'the stored result carries the deployment it was answered on',
    );
  });

  it('leaves a CLOSE alone — a closed generation invalidates every attestation at once', async () => {
    const prisma = makePrisma([OPEN_ROW], {}, [attestation('build-1', 1), attestation('build-2', 2)]);
    await new LaunchGateCommandUseCase(prisma).execute({
      ...OPEN_INVENTORY,
      action: 'CLOSE',
      commandId: 'cmd-close-window',
      snapshot: { ...OPEN_INVENTORY.snapshot, expectedGeneration: 1 },
    });

    assert.deepEqual(prisma.transitions.slice(2).map((row: any) => row.action), ['CLOSE'], 'no retirement markers');
    assert.equal(prisma.gates.get('inventory DEFAULT').generation, 2);
  });
});

/**
 * UAT r5 item 2 — a no-op OPEN used to return without storing anything. The command was then only
 * "idempotent" for as long as the world it was decided against held: once the post-deploy pass
 * retired the build, the SAME commandId stopped looking satisfied and the acceptance branch
 * re-admitted a build nobody had re-approved. The stored NOOP is what closes that.
 */
describe('LaunchGateCommandUseCase — durable no-op results (UAT r5 item 2)', () => {
  const OPEN_ROW: GateRow = { gateKey: 'inventory', routeKey: 'DEFAULT', state: 'OPEN', generation: 1, lastSeq: 1, reason: null };
  const liveOpen = {
    gateKey: 'inventory',
    routeKey: 'DEFAULT',
    seq: 1,
    generation: 1,
    commandId: 'open-this-build',
    action: 'OPEN',
    actorUserId: 'SYSTEM',
    targetEnvironment: DEPLOYMENT.targetEnvironment,
    buildReleaseId: DEPLOYMENT.buildReleaseId,
  };
  const noOp = { ...OPEN_INVENTORY, commandId: 'cmd-noop', snapshot: { ...OPEN_INVENTORY.snapshot, expectedGeneration: 1 } };

  it('stores a NOOP result for a command that changed nothing', async () => {
    const prisma = makePrisma([OPEN_ROW], {}, [liveOpen]);
    const result = await new LaunchGateCommandUseCase(prisma).execute(noOp);

    assert.deepEqual({ changed: result.changed, replayed: result.replayed }, { changed: false, replayed: false });
    assert.equal(prisma.transitions.length, 1, 'a no-op appends no transition');
    assert.deepEqual(
      prisma.results.map((row: any) => [row.commandId, row.resultKind, row.state, row.generation, row.lastSeq]),
      [['cmd-noop', 'NOOP', 'OPEN', 1, 1]],
    );
  });

  /** The exact hole: the delayed retry lands after a post-deploy pass retired the build it named. */
  it('replays the stored NOOP after its build was RETIRED, instead of re-accepting it', async () => {
    const prisma = makePrisma([OPEN_ROW], {}, [liveOpen]);
    const useCase = new LaunchGateCommandUseCase(prisma);
    await useCase.execute(noOp);

    // The post-deploy pass retires this build: its newest marker is now a CLOSE, so the deployment
    // is no longer admitted and the old idempotence check would MISS.
    prisma.transitions.push({ ...liveOpen, seq: 2, commandId: 'F1-RETIRE:x', action: 'CLOSE' });
    Object.assign(prisma.gates.get('inventory DEFAULT'), { lastSeq: 2 });

    const replay = await useCase.execute(noOp);

    assert.deepEqual(
      { changed: replay.changed, replayed: replay.replayed, generation: replay.generation },
      { changed: false, replayed: true, generation: 1 },
    );
    assert.deepEqual(
      prisma.transitions.map((row: any) => row.action),
      ['OPEN', 'CLOSE'],
      'the retired build must NOT be re-attested by replaying an old command',
    );
    assert.equal(prisma.results.length, 1, 'a replay stores nothing new');
  });

  /** Item 6 — the way back for a retired human approval is a FRESH command, and only that. */
  it('still admits a genuinely new human command for the same build', async () => {
    const prisma = makePrisma([OPEN_ROW], {}, [
      { ...liveOpen, actorUserId: 'release-owner-1' },
      { ...liveOpen, seq: 2, commandId: 'F1-RETIRE:x', action: 'CLOSE' },
    ]);
    Object.assign(prisma.gates.get('inventory DEFAULT'), { lastSeq: 2 });

    const fresh = await new LaunchGateCommandUseCase(prisma).execute({
      ...OPEN_INVENTORY,
      commandId: 'cmd-fresh-human-open',
      snapshot: { ...OPEN_INVENTORY.snapshot, expectedGeneration: 1 },
    });

    assert.deepEqual({ changed: fresh.changed, replayed: fresh.replayed, generation: fresh.generation }, { changed: true, replayed: false, generation: 1 });
    assert.equal(prisma.transitions.at(-1).action, 'OPEN');
    assert.equal(prisma.results[0].resultKind, 'ACCEPTED');
  });

  it('rejects key reuse on a stored NOOP with a different action', async () => {
    const prisma = makePrisma([OPEN_ROW], {}, [liveOpen]);
    const useCase = new LaunchGateCommandUseCase(prisma);
    await useCase.execute(noOp);

    await assert.rejects(
      () => useCase.execute({ ...noOp, action: 'CLOSE' }),
      (err: ConflictException) => (err.getResponse() as any).code === 'launch_gate_command_conflict',
    );
  });

  /**
   * Commands recorded before the result table existed still replay from their transition row — and
   * UAT r8: that replay BACKFILLS the missing result. Answering from the transition alone left a
   * pre-migration command permanently absent from the durable-results table, so "every command is
   * durable" held only for commands issued after the migration.
   */
  it('replays a legacy command that has only a transition row, and backfills its result', async () => {
    // Another build holds the generation, so the command below is a real acceptance and writes a
    // transition — the only artefact a pre-migration command left behind.
    const prisma = makePrisma([OPEN_ROW], {}, [{ ...liveOpen, buildReleaseId: 'build-other' }]);
    const useCase = new LaunchGateCommandUseCase(prisma);
    const legacyCmd = { ...OPEN_INVENTORY, commandId: 'cmd-legacy', snapshot: { ...OPEN_INVENTORY.snapshot, expectedGeneration: 1 } };
    const original = await useCase.execute(legacyCmd);
    prisma.results.length = 0;
    // The whole point of a HISTORICAL replay: the command ran on a build that is no longer the one
    // answering. Only the transition remembers where it actually executed, and the fingerprint is
    // left untouched so the replay still resolves to this row.
    const historicalEnvironment = `${DEPLOYMENT.targetEnvironment}-before`;
    const historicalBuild = `${DEPLOYMENT.buildReleaseId}-before`;
    Object.assign(prisma.transitions.at(-1), {
      targetEnvironment: historicalEnvironment,
      buildReleaseId: historicalBuild,
    });

    const replay = await useCase.execute(legacyCmd);
    // Without the fallback this would re-decide against the live world and answer "no-op" instead.
    assert.deepEqual({ replayed: replay.replayed, changed: replay.changed }, { replayed: true, changed: true });
    assert.deepEqual(
      { ...replay, replayed: false },
      { ...original, replayed: false },
      'the replay answers exactly what the original command answered',
    );
    assert.equal(prisma.transitions.length, 2, 'a legacy replay appends nothing');
    // The acceptance stayed on its own generation, so the backfilled kind is the one a fresh apply
    // of that same command would have recorded — and the deployment identity is the one the command
    // RAN on, taken from the transition, never the build that happens to be replaying it.
    assert.deepEqual(
      prisma.results.map((row: any) => [
        row.commandId, row.resultKind, row.state, row.generation, row.lastSeq,
        row.targetEnvironment, row.buildReleaseId,
      ]),
      [['cmd-legacy', 'ACCEPTED', 'OPEN', 1, 2, historicalEnvironment, historicalBuild]],
    );
    assert.notEqual(prisma.results[0].buildReleaseId, DEPLOYMENT.buildReleaseId, 'never the replaying build');

    // The next replay is answered by the row just backfilled — the `(gateKey, routeKey, commandId)`
    // unique would throw if the fallback ran a second time.
    const again = await useCase.execute(legacyCmd);
    assert.deepEqual({ ...again, replayed: false }, { ...original, replayed: false });
    assert.equal(prisma.results.length, 1, 'the backfill happens at most once');
    assert.equal(prisma.transitions.length, 2);
  });

  /** A retirement marker carries its own commandId as its fingerprint, so it can never be backfilled. */
  it('never backfills a result for a retirement marker that shares a commandId', async () => {
    const prisma = makePrisma([OPEN_ROW], {}, [
      liveOpen,
      { ...liveOpen, seq: 2, commandId: 'cmd-1', action: 'CLOSE', payloadFingerprint: 'cmd-1' },
    ]);

    await assert.rejects(
      () => new LaunchGateCommandUseCase(prisma).execute({
        ...OPEN_INVENTORY,
        snapshot: { ...OPEN_INVENTORY.snapshot, expectedGeneration: 1 },
      }),
      (err: ConflictException) => (err.getResponse() as any).code === 'launch_gate_command_conflict',
    );
    assert.equal(prisma.results.length, 0, 'a marker that is not a command records nothing');
  });
});

describe('LaunchGateCommandUseCase — route and shape validation', () => {
  it('rejects a route that is not in FEATURE_LAUNCH_MATRIX', async () => {
    await assert.rejects(
      () => new LaunchGateCommandUseCase(makePrisma()).execute({ ...OPEN_INVENTORY, gateKey: 'made_up' }),
      (err: UnprocessableEntityException) => (err.getResponse() as any).code === 'unknown_launch_route',
    );
  });

  it('rejects OPEN on a BLOCKED namespace row', async () => {
    await assert.rejects(
      () => new LaunchGateCommandUseCase(makePrisma()).execute({
        ...OPEN_INVENTORY,
        gateKey: 'cap.thai_tax.vat_scope_credit_transfer',
        routeKey: '<transitionKind> (namespace — catalog not enumerable)',
      }),
      (err: UnprocessableEntityException) => (err.getResponse() as any).code === 'launch_route_blocked',
    );
  });

  it('rejects any command on a non-materializable namespace row', async () => {
    await assert.rejects(
      () => new LaunchGateCommandUseCase(makePrisma()).execute({
        ...OPEN_INVENTORY,
        action: 'CLOSE',
        gateKey: 'cap.thai_tax.vat_scope_credit_transfer',
        routeKey: '<transitionKind> (namespace — catalog not enumerable)',
      }),
      (err: UnprocessableEntityException) => (err.getResponse() as any).code === 'launch_route_not_materializable',
    );
  });

  it('rejects an emergency OPEN before touching the database', async () => {
    const prisma = makePrisma();
    await assert.rejects(
      () => new LaunchGateCommandUseCase(prisma).execute({
        ...OPEN_INVENTORY,
        snapshot: { ...OPEN_INVENTORY.snapshot, emergencyClose: true, incidentRef: 'INC-1' },
      }),
      (err: UnprocessableEntityException) => {
        const body = err.getResponse() as any;
        return body.code === 'launch_gate_snapshot_invalid' && body.violations.some((v: string) => v.includes('forbids an OPEN'));
      },
    );
    assert.equal(prisma.gates.size, 0);
  });
});

/**
 * F1.5b P0-3 — the control-plane trust boundary. The theme of every case here is the same: a caller
 * may state an EXPECTATION, never an authority.
 */
describe('LaunchGateCommandUseCase — server-derived authority (P0-3)', () => {
  const VAT_OFFSET = {
    gateKey: 'cap.thai_tax.vat_credit_in_product_offset',
    routeKey: 'DEFAULT',
  };

  it('rejects a spoofed environment or build id and writes nothing', async () => {
    for (const spoof of [{ targetEnvironment: 'production-but-not-really' }, { buildReleaseId: 'sha-i-made-up' }]) {
      const prisma = makePrisma();
      await assert.rejects(
        () => new LaunchGateCommandUseCase(prisma).execute({
          ...OPEN_INVENTORY,
          snapshot: { ...OPEN_INVENTORY.snapshot, ...spoof },
        }),
        (err: ConflictException) => {
          const body = err.getResponse() as any;
          assert.equal(body.code, 'launch_gate_deployment_mismatch');
          assert.equal(body.current, spoof.targetEnvironment ? DEPLOYMENT.targetEnvironment : DEPLOYMENT.buildReleaseId);
          return true;
        },
      );
      assert.equal(prisma.transitions.length, 0);
      assert.equal(prisma.gates.size, 0, 'a rejected command never even materializes the row');
    }
  });

  it('accepts a MATCHING expected environment/build as a CAS on the deployment', async () => {
    const prisma = makePrisma();
    const result = await new LaunchGateCommandUseCase(prisma).execute({
      ...OPEN_INVENTORY,
      snapshot: { ...OPEN_INVENTORY.snapshot, ...DEPLOYMENT },
    });
    assert.equal(result.state, 'OPEN');
    assert.equal(prisma.transitions[0].targetEnvironment, DEPLOYMENT.targetEnvironment);
  });

  it('refuses to record another user as release, specialist or emergency authority', async () => {
    const fields = [
      { releaseApprovedByUserId: 'someone-else' },
      { specialistApprovedByUserId: 'someone-else' },
      { emergencyAuthorityUserId: 'someone-else' },
    ];
    for (const spoof of fields) {
      const prisma = makePrisma();
      await assert.rejects(
        () => new LaunchGateCommandUseCase(prisma).execute({
          ...OPEN_INVENTORY,
          snapshot: { ...OPEN_INVENTORY.snapshot, ...spoof },
        }),
        (err: UnprocessableEntityException) => {
          const body = err.getResponse() as any;
          assert.equal(body.code, 'launch_gate_authority_mismatch');
          assert.equal(body.field, Object.keys(spoof)[0]);
          return true;
        },
      );
      assert.equal(prisma.transitions.length, 0);
    }
  });

  it('records the authenticated actor as the release approver even when the payload omits one', async () => {
    const prisma = makePrisma();
    await new LaunchGateCommandUseCase(prisma).execute({
      ...OPEN_INVENTORY,
      snapshot: { expectedGeneration: 0 },
    });
    assert.equal(prisma.transitions[0].releaseApprovedByUserId, 'release-owner-1');
    assert.equal(prisma.audits[0].metadataJson.releaseApprovedByUserId, 'release-owner-1');
  });

  it('rejects an actor without the SYSTEM_ADMIN role or the manage permission', async () => {
    for (const actor of [
      { actorRoles: ['OWNER'], actorPermissions: [LAUNCH_GATE_MANAGE_PERMISSION] },
      { actorRoles: [LAUNCH_GATE_ADMIN_ROLE], actorPermissions: ['system.launch_gate.read'] },
      { actorRoles: [], actorPermissions: [] },
    ]) {
      const prisma = makePrisma();
      await assert.rejects(
        () => new LaunchGateCommandUseCase(prisma).execute({ ...OPEN_INVENTORY, ...actor }),
        (err: ForbiddenException) => (err.getResponse() as any).code === 'launch_gate_actor_not_authorized',
      );
      assert.equal(prisma.transitions.length, 0);
    }
  });

  it('HARD-rejects OPEN on the [LATER] VAT-offset route, whatever shape the command has (spec:272)', async () => {
    const perfectSpecialistShape = {
      ...OPEN_INVENTORY.snapshot,
      ...DEPLOYMENT,
      validationEvidenceRef: 'matrix://cap.thai_tax.vat_credit_in_product_offset/DEFAULT',
      validationEvidenceHash: 'sha256:cafebabe',
      specialistApprovedByUserId: 'release-owner-1',
      releaseApprovedByUserId: 'release-owner-1',
    };
    for (const snapshot of [
      OPEN_INVENTORY.snapshot,
      perfectSpecialistShape,
      { ...perfectSpecialistShape, emergencyClose: false, incidentRef: null },
    ]) {
      const prisma = makePrisma();
      await assert.rejects(
        () => new LaunchGateCommandUseCase(prisma).execute({ ...OPEN_INVENTORY, ...VAT_OFFSET, snapshot }),
        (err: UnprocessableEntityException) => {
          const body = err.getResponse() as any;
          assert.equal(body.code, 'launch_route_open_forbidden');
          assert.equal(body.openPolicy, 'FORBIDDEN_V5_1');
          return true;
        },
      );
      assert.equal(prisma.gates.size, 0, 'nothing is materialized, so nothing can be opened later');
    }
  });

  it('still allows CLOSE on the forbidden route, so it can be kept shut', async () => {
    const prisma = makePrisma([{ ...VAT_OFFSET, state: 'OPEN', generation: 1, lastSeq: 1, reason: null }]);
    const result = await new LaunchGateCommandUseCase(prisma).execute({
      ...OPEN_INVENTORY,
      ...VAT_OFFSET,
      action: 'CLOSE',
      commandId: 'cmd-shut',
      snapshot: { expectedGeneration: 1 },
    });
    assert.equal(result.state, 'CLOSED');
  });
});

/**
 * F1.5.1 item 1 — the SPECIALIST_LEGAL door is closed at the command boundary, not defended inside
 * it. There is no persisted approval record to bind an approval to (F1.6), so every OPEN is
 * rejected regardless of shape: the previously documented residual — one SYSTEM_ADMIN signing as
 * both release owner and specialist over caller-typed evidence strings — is now unreachable.
 */
describe('LaunchGateCommandUseCase — SPECIALIST_LEGAL OPEN is hard-closed (F1.5.1)', () => {
  const WHT_ROUTES = ['SYSTEM_INITIAL_ISSUE', 'SYSTEM_CONTENT_CORRECTION', 'SYSTEM_REPLACEMENT_COPY'];

  const specialistOpen = (routeKey: string, snapshot: Record<string, unknown> = {}): LaunchGateCommand => ({
    ...OPEN_INVENTORY,
    gateKey: 'cap.wht50bis',
    routeKey,
    snapshot: { ...OPEN_INVENTORY.snapshot, ...snapshot },
  });

  it('rejects the PERFECT specialist shape on every concrete specialist route, and writes nothing', async () => {
    const perfectShape = {
      ...DEPLOYMENT,
      validationEvidenceRef: 'matrix://cap.wht50bis/evidence',
      validationEvidenceHash: 'sha256:deadbeef',
      specialistApprovedByUserId: 'release-owner-1',
      releaseApprovedByUserId: 'release-owner-1',
    };
    for (const routeKey of WHT_ROUTES) {
      const prisma = makePrisma();
      await assert.rejects(
        () => new LaunchGateCommandUseCase(prisma).execute(specialistOpen(routeKey, perfectShape)),
        (err: UnprocessableEntityException) => {
          const body = err.getResponse() as any;
          assert.equal(body.code, 'launch_route_specialist_approval_unavailable');
          assert.equal(body.routeClass, 'SPECIALIST_LEGAL');
          assert.ok(body.requires.length >= 5, 'the rejection states what a future OPEN must present');
          assert.ok(body.requires.some((line: string) => /DISTINCT from the release owner/.test(line)));
          return true;
        },
      );
      assert.equal(prisma.transitions.length, 0);
      assert.equal(prisma.gates.size, 0, 'a rejected specialist OPEN never even materializes the row');
    }
  });

  it('rejects the bare shape and a named third-party specialist alike — no shape buys its way in', async () => {
    for (const snapshot of [
      {},
      { specialistApprovedByUserId: 'tax-specialist-1' },
      { validationEvidenceRef: 'x', validationEvidenceHash: 'y', specialistApprovedByUserId: 'tax-specialist-1' },
      { emergencyClose: false, incidentRef: null },
    ]) {
      await assert.rejects(
        () => new LaunchGateCommandUseCase(makePrisma()).execute(specialistOpen('SYSTEM_INITIAL_ISSUE', snapshot)),
        (err: UnprocessableEntityException) =>
          (err.getResponse() as any).code === 'launch_route_specialist_approval_unavailable',
      );
    }
  });

  it('still CLOSES a specialist route — ordinary and emergency — so an open one can be shut', async () => {
    for (const snapshot of [
      { expectedGeneration: 1 },
      { expectedGeneration: 1, emergencyClose: true, incidentRef: 'INC-9' },
    ]) {
      const prisma = makePrisma([
        { gateKey: 'cap.wht50bis', routeKey: 'SYSTEM_INITIAL_ISSUE', state: 'OPEN', generation: 1, lastSeq: 1, reason: null },
      ]);
      const result = await new LaunchGateCommandUseCase(prisma).execute({
        ...specialistOpen('SYSTEM_INITIAL_ISSUE'),
        action: 'CLOSE',
        commandId: `cmd-close-${String(snapshot.emergencyClose)}`,
        snapshot: snapshot as any,
      });
      assert.equal(result.state, 'CLOSED');
      assert.equal(prisma.transitions[0].routeClass, 'SPECIALIST_LEGAL');
    }
  });

  it('leaves an ORDINARY OPEN completely unaffected', async () => {
    const prisma = makePrisma();
    const result = await new LaunchGateCommandUseCase(prisma).execute(OPEN_INVENTORY);
    assert.equal(result.state, 'OPEN');
    assert.equal(prisma.transitions[0].routeClass, 'ORDINARY');
  });
});
