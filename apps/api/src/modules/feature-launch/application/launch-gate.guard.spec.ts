import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import { LaunchGateGuardService } from './launch-gate.guard';
import { FEATURE_TEMPORARILY_UNAVAILABLE } from '../../employee-access/application/entitlement.helper';

/** Server truth for this process — the same resolver the guard uses (F1.5.1 item 4). */
const DEPLOYMENT = resolveDeploymentIdentity(process.env);

type StoredTransition = {
  action?: string;
  generation?: number;
  seq?: number;
  targetEnvironment: string;
  buildReleaseId: string;
};

/** An OPEN recorded at `generation` on the named build, in this environment. */
const openedOn = (buildReleaseId: string, generation = 1): StoredTransition => ({
  action: 'OPEN',
  generation,
  targetEnvironment: DEPLOYMENT.targetEnvironment,
  buildReleaseId,
});

/** The append-only retirement marker that takes a build out of the two-build window (ruling 1). */
const retired = (buildReleaseId: string, generation = 1): StoredTransition => ({
  ...openedOn(buildReleaseId, generation),
  action: 'CLOSE',
});

/** An OPEN recorded on THIS deployment, i.e. one that still authorizes the running build. */
const openedHere = (generation = 1): StoredTransition => openedOn(DEPLOYMENT.buildReleaseId, generation);

/**
 * Runs `fn` as if this process were the given build. The guard derives the build from the
 * environment, so a rolling window (two live builds, one control-plane row) can only be exercised
 * by moving what the process claims to be.
 */
async function asBuild(buildReleaseId: string, fn: () => Promise<void>): Promise<void> {
  const previous = process.env.GIT_SHA;
  process.env.GIT_SHA = buildReleaseId;
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = previous;
  }
}

function makePrisma(
  row: { state: 'OPEN' | 'CLOSED'; generation?: number } | null,
  transitions: StoredTransition[] = [openedHere()],
) {
  let reads = 0;
  const gate = row === null ? null : { generation: 1, ...row };
  return {
    reads: () => reads,
    client: {
      featureLaunchGate: {
        findUnique: async () => {
          reads += 1;
          return gate;
        },
      },
      featureLaunchGateTransition: {
        // Filters on EVERY scalar the caller sent, exactly like the real `where` — so a test that
        // forgets the generation, the environment or the build fails instead of quietly passing.
        findMany: async (args: any) => {
          const { gateKey, routeKey, ...predicate } = args.where;
          assert.equal(predicate.action, undefined, 'the authority rule reads EVERY marker, then takes the newest');
          return transitions
            .filter((stored) => Object.entries(predicate).every(([key, value]) => (stored as any)[key] === value))
            .map((stored, index) => ({ gateKey, routeKey, seq: index + 1, ...stored }));
        },
      },
    },
  } as any;
}

describe('LaunchGateGuardService.assertLaunchRouteOpen', () => {
  it('passes when the exact route is OPEN on this build and environment', async () => {
    await new LaunchGateGuardService(makePrisma({ state: 'OPEN' })).assertLaunchRouteOpen('inventory', 'DEFAULT');
  });

  it('throws feature_temporarily_unavailable — not feature_not_enabled — when the route is CLOSED', async () => {
    await assert.rejects(
      () => new LaunchGateGuardService(makePrisma({ state: 'CLOSED' })).assertLaunchRouteOpen('inventory'),
      (err: ForbiddenException) => {
        const body = err.getResponse() as any;
        assert.equal(body.code, FEATURE_TEMPORARILY_UNAVAILABLE);
        assert.equal(body.featureKey, 'inventory');
        return true;
      },
    );
  });

  it('treats a route with no gate row as CLOSED — an unseeded route was never opened', async () => {
    await assert.rejects(
      () => new LaunchGateGuardService(makePrisma(null)).assertLaunchRouteOpen('cap.wht50bis', 'SYSTEM_INITIAL_ISSUE'),
      (err: ForbiddenException) => (err.getResponse() as any).code === FEATURE_TEMPORARILY_UNAVAILABLE,
    );
  });

  it('reads the gate uncached on every call — a cached read is not a fence (spec:60)', async () => {
    const prisma = makePrisma({ state: 'OPEN' });
    const guard = new LaunchGateGuardService(prisma);
    await guard.assertLaunchRouteOpen('inventory');
    await guard.assertLaunchRouteOpen('inventory');
    assert.equal(prisma.reads(), 2);
  });

  it('defaults routeKey to DEFAULT', async () => {
    const prisma = {
      client: {
        featureLaunchGate: { findUnique: async (args: any) => {
          assert.equal(args.where.gateKey_routeKey.routeKey, 'DEFAULT');
          return { state: 'OPEN', generation: 1 };
        } },
        featureLaunchGateTransition: { findMany: async (args: any) => {
          assert.equal(args.where.routeKey, 'DEFAULT');
          return [{ ...openedHere(), gateKey: args.where.gateKey, routeKey: 'DEFAULT', seq: 1 }];
        } },
      },
    } as any;
    await new LaunchGateGuardService(prisma).assertLaunchRouteOpen('crm');
  });
});

/**
 * F1.5.1 item 4 — `state = OPEN` is not authorization. The OPEN this row lives on must name the
 * environment and build that are actually running, or the row reads as CLOSED.
 */
describe('LaunchGateGuardService — build and environment binding (F1.5.1)', () => {
  const rejects = (transitions: StoredTransition[], message: string) =>
    assert.rejects(
      () => new LaunchGateGuardService(makePrisma({ state: 'OPEN' }, transitions)).assertLaunchRouteOpen('inventory'),
      (err: ForbiddenException) => (err.getResponse() as any).code === FEATURE_TEMPORARILY_UNAVAILABLE,
      message,
    );

  it('closes an OPEN approved in another environment', async () => {
    const otherEnvironment = DEPLOYMENT.targetEnvironment === 'production' ? 'uat' : 'production';
    await rejects(
      [{ ...openedHere(), targetEnvironment: otherEnvironment }],
      'a uat approval must not authorize production',
    );
  });

  it('closes an OPEN approved on another build', async () => {
    await rejects([openedOn('some-older-build')], 'an OPEN approved on build A must not authorize build B');
  });

  it('closes an OPEN row that carries no recorded OPEN transition at all', async () => {
    await rejects([], 'an OPEN with no lineage was never approved');
  });

  it('admits the row again once an OPEN names the running build and environment', async () => {
    await new LaunchGateGuardService(makePrisma({ state: 'OPEN' }, [openedHere()])).assertLaunchRouteOpen('inventory');
  });
});

/**
 * F1.5.2 — the rolling-deploy rule. The guard asks for ANY OPEN of the CURRENT generation naming
 * this deployment, never for the LATEST one: during a rolling deploy the release task attests build
 * B while build A is still serving, and "latest wins" would refuse every live A task at that moment.
 */
describe('LaunchGateGuardService — rolling deploy window (F1.5.2)', () => {
  const admits = (build: string, transitions: StoredTransition[], gate = { state: 'OPEN' as const, generation: 1 }) =>
    asBuild(build, () => new LaunchGateGuardService(makePrisma(gate, transitions)).assertLaunchRouteOpen('inventory'));

  const refuses = (build: string, transitions: StoredTransition[], gate: { state: 'OPEN'; generation: number }, message: string) =>
    asBuild(build, () => assert.rejects(
      () => new LaunchGateGuardService(makePrisma(gate, transitions)).assertLaunchRouteOpen('inventory'),
      (err: ForbiddenException) => (err.getResponse() as any).code === FEATURE_TEMPORARILY_UNAVAILABLE,
      message,
    ));

  /** One generation, two live builds: the state a rolling deploy is actually in. */
  const window = [openedOn('build-a', 1), openedOn('build-b', 1)];

  it('admits BOTH builds while two attestations of one generation coexist', async () => {
    await admits('build-a', window);
    await admits('build-b', window);
  });

  it('still refuses a build nobody attested, even mid-window', async () => {
    await refuses('build-c', window, { state: 'OPEN', generation: 1 }, 'an unattested build is not admitted by a sibling');
  });

  it('kills every attestation in the window at once when the generation moves', async () => {
    // A CLOSE (generation 2) then a human re-OPEN on build-c (generation 2, the row is OPEN again).
    const afterReopen = [...window, openedOn('build-c', 2)];
    await refuses('build-a', afterReopen, { state: 'OPEN', generation: 2 }, 'a generation-1 attestation is dead');
    await refuses('build-b', afterReopen, { state: 'OPEN', generation: 2 }, 'a generation-1 attestation is dead');
    await admits('build-c', afterReopen, { state: 'OPEN', generation: 2 });
  });

  it('requires the GENERATION to match, not just the environment and build', async () => {
    await refuses(
      'build-a',
      [openedOn('build-a', 1)],
      { state: 'OPEN', generation: 3 },
      'the right build on a dead generation is still closed',
    );
  });
});

/**
 * F1.5.2 owner ruling 1 — the window is BOUNDED at {previous, current}. An attestation is not a
 * permanent allowlist: a third build retires the first, and the retired build's runtime is refused
 * even though its OPEN row is still in the append-only history.
 */
describe('LaunchGateGuardService — two-build attestation window (F1.5.2 ruling 1)', () => {
  const admits = (build: string, transitions: StoredTransition[]) =>
    asBuild(build, () => new LaunchGateGuardService(makePrisma({ state: 'OPEN' }, transitions)).assertLaunchRouteOpen('inventory'));

  const refuses = (build: string, transitions: StoredTransition[], message: string) =>
    asBuild(build, () => assert.rejects(
      () => new LaunchGateGuardService(makePrisma({ state: 'OPEN' }, transitions)).assertLaunchRouteOpen('inventory'),
      (err: ForbiddenException) => (err.getResponse() as any).code === FEATURE_TEMPORARILY_UNAVAILABLE,
      message,
    ));

  /** Three builds attested on one generation; the bootstrap retired the oldest as it attested build-c. */
  const afterThirdBuild = [openedOn('build-a'), openedOn('build-b'), openedOn('build-c'), retired('build-a')];

  it('refuses the FIRST build once a third one retired it', async () => {
    await refuses('build-a', afterThirdBuild, 'a retired attestation must not still admit its runtime');
  });

  it('keeps admitting both members of the surviving {N-1, N} window', async () => {
    await admits('build-b', afterThirdBuild);
    await admits('build-c', afterThirdBuild);
  });

  it('re-admits a rolled-back build once a newer OPEN supersedes its retirement', async () => {
    // Newest marker wins, so a rollback is re-attested rather than permanently bricked.
    await admits('build-a', [...afterThirdBuild, openedOn('build-a')]);
  });

  it('retires per BUILD, not per route — a sibling build is untouched by another build\'s marker', async () => {
    await admits('build-b', [openedOn('build-b'), retired('build-a')]);
  });
});
