import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import {
  DEFAULT_DISPATCH_LEASE_MS,
  ExecutionAttemptService,
  attemptIdentityFingerprint,
  availabilityVectorHash,
  expandRequiredFeatureKeys,
  scopedAttemptKey,
} from './execution-attempt.service';

type Row = Record<string, any>;

/** Minimal Prisma-shaped double: enough `where`/`data` semantics for the CAS predicates used here. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('in' in expected) return (expected.in as unknown[]).includes(actual);
      if ('gt' in expected) return actual != null && actual > (expected as any).gt;
      if ('not' in expected) return (expected as any).not === null ? actual != null : actual !== (expected as any).not;
    }
    return actual === expected;
  });
}

function applyData(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) row[key] = (row[key] ?? 0) + (value as any).increment;
    else row[key] = value;
  }
}

function makePrisma(opts: {
  attempt?: Row;
  /** Rows the upsert can HIT, keyed by their stored (scoped) attemptKey. */
  storedAttempts?: Row[];
  entitlements?: Array<{ featureKey: string; enabled: boolean; epoch: number }>;
  gates?: Array<{ gateKey: string; routeKey: string; state: string; generation: number }>;
  /**
   * Control-plane markers the deployment check can find, in append order. Defaults to "every gate is
   * attested on the RUNNING deployment at its own generation", which is what a healthy single-build
   * deploy looks like; the rolling-deploy, stale-build and RETIRED cases pass their own.
   *
   * `action` defaults to OPEN and `seq` to the append order, because the authority rule is
   * newest-marker-wins: a later `CLOSE` naming the same build is a retirement.
   */
  transitions?: Array<{
    gateKey: string;
    routeKey: string;
    generation: number;
    targetEnvironment: string;
    buildReleaseId: string;
    action?: string;
    seq?: number;
  }>;
} = {}) {
  const attempt: Row | null = opts.attempt ? { attempts: 0, ...opts.attempt } : null;
  const entitlements = opts.entitlements ?? [];
  const gates = opts.gates ?? [];
  const transitions = (opts.transitions ?? gates.map((gate) => ({
    gateKey: gate.gateKey,
    routeKey: gate.routeKey,
    generation: gate.generation,
    targetEnvironment: DEPLOYMENT.targetEnvironment,
    buildReleaseId: DEPLOYMENT.buildReleaseId,
  }))).map((row, index) => ({ action: 'OPEN', seq: index + 1, ...row }));
  const locks: string[] = [];
  const lockEvents: string[] = [];
  const upserts: Row[] = [];
  const stored = new Map<string, Row>((opts.storedAttempts ?? []).map((row) => [row.attemptKey, { ...row }]));

  const api = {
    // The `FOR UPDATE` read `acquireDispatchLease` decides on. The row lock itself is only provable
    // against a real database — `execution-attempt.service.race.spec.ts` does that.
    $queryRaw: async () => {
      lockEvents.push('row-lock');
      return attempt ? [{ ...attempt }] : [];
    },
    executionAttempt: {
      // Two callers: the claim reads by `id`, the stamp pre-reads by the canonical SOURCE identity
      // (which is how a second caller key naming the same work is caught before it can collide).
      findUnique: async (args: Row = {}) => {
        const bySource = args.where?.companyScope_sourceType_sourceId_attemptSeq;
        if (bySource) {
          const hit = [...stored.values()].find((row) => row.companyScope === bySource.companyScope
            && row.sourceType === bySource.sourceType
            && row.sourceId === bySource.sourceId
            && (row.attemptSeq ?? 1) === bySource.attemptSeq);
          return hit ? { ...hit } : null;
        }
        return attempt ? { ...attempt } : null;
      },
      // Models the real unique: a hit returns the STORED row (including whose it is), never the
      // row the caller wanted to create.
      upsert: async (args: Row) => {
        upserts.push(args);
        const key = args.where.attemptKey;
        const hit = stored.get(key);
        if (hit) return { id: hit.id ?? 'att-stored', status: 'QUEUED', identityFingerprint: null, ...hit };
        const created = { id: `att-${stored.size + 1}`, status: 'QUEUED', ...args.create };
        stored.set(key, created);
        return created;
      },
      updateMany: async (args: Row) => {
        if (!attempt || !matches(attempt, args.where)) return { count: 0 };
        applyData(attempt, args.data);
        return { count: 1 };
      },
    },
    companyFeatureEntitlement: {
      findMany: async (args: Row) => {
        const wanted: string[] | undefined = args.where?.featureKey?.in;
        return entitlements.filter((row) => !wanted || wanted.includes(row.featureKey)).map((row) => ({ ...row }));
      },
    },
    featureLaunchGate: { findMany: async () => gates.map((row) => ({ ...row })) },
    featureLaunchGateTransition: {
      findMany: async (args: Row) => {
        const { OR, ...scalars } = args.where ?? {};
        return transitions
          .filter((row) => matches(row, scalars) && (!OR || OR.some((clause: Row) => matches(row, clause))))
          .map((row) => ({ ...row }));
      },
    },
    $executeRaw: async (sql: any) => {
      const key = String(sql.values?.[0] ?? '');
      locks.push(key);
      lockEvents.push(`advisory:${key}`);
      return 1;
    },
  };

  const client = { ...api, $transaction: async (fn: (tx: typeof api) => Promise<unknown>) => fn(api) };
  return { prisma: { client } as any, attempt, locks, lockEvents, upserts, stored };
}

const noopLogger = { warn() {}, info() {}, error() {} } as any;
/** The identity every gate transition and every stamp in this file is written under. */
const DEPLOYMENT = resolveDeploymentIdentity(process.env);
const makeService = (prisma: any) =>
  new ExecutionAttemptService(prisma, noopLogger, { deploymentIdentity: DEPLOYMENT } as any);

const queuedAttempt = (overrides: Row = {}): Row => ({
  id: 'att-1',
  companyId: 'co-1',
  status: 'QUEUED',
  entitlementEpochsJson: { expenses: 3 },
  launchEntriesJson: [{ gateKey: 'expenses', routeKey: 'DEFAULT', generation: 7 }],
  targetEnvironment: DEPLOYMENT.targetEnvironment,
  buildReleaseId: DEPLOYMENT.buildReleaseId,
  dispatchToken: null,
  dispatchedAt: null,
  leaseOwner: null,
  leaseExpiresAt: null,
  leaseGeneration: 0,
  ...overrides,
});

const openExpenses = [{ gateKey: 'expenses', routeKey: 'DEFAULT', state: 'OPEN', generation: 7 }];
const entitledExpenses = [{ featureKey: 'expenses', enabled: true, epoch: 3 }];

describe('availability vector stamping (spec:59)', () => {
  it('expands declared dependencies, not only the owning feature', () => {
    assert.deepEqual(expandRequiredFeatureKeys(['expense_auto_post']), ['double_entry_ledger', 'expense_auto_post']);
  });

  it('hashes the company as well as the vector, so it can never be reused across tenants', () => {
    const epochs = { expenses: 1 };
    const entries = [{ gateKey: 'expenses', routeKey: 'DEFAULT', generation: 2 }];
    const hash = (companyId: string, e = epochs, l = entries, d = DEPLOYMENT) => availabilityVectorHash(companyId, e, l, d);
    assert.notEqual(hash('co-1'), hash('co-2'));
    assert.notEqual(hash('co-1'), hash('co-1', { expenses: 2 }));
    assert.notEqual(hash('co-1'), hash('co-1', epochs, [{ gateKey: 'expenses', routeKey: 'DEFAULT', generation: 3 }]));
  });

  /**
   * F1.5.2 owner ruling 4 — the batch-eligibility key covers the stamped deployment too, so a future
   * bounded batch claim can never put two builds (or two environments) in one batch: a single claim
   * decision cannot be right for both at once.
   */
  it('hashes the stamped environment and build, so a batch can never mix builds', () => {
    const epochs = { expenses: 1 };
    const entries = [{ gateKey: 'expenses', routeKey: 'DEFAULT', generation: 2 }];
    const base = availabilityVectorHash('co-1', epochs, entries, DEPLOYMENT);
    assert.notEqual(base, availabilityVectorHash('co-1', epochs, entries, { ...DEPLOYMENT, buildReleaseId: 'build-B' }));
    assert.notEqual(base, availabilityVectorHash('co-1', epochs, entries, { ...DEPLOYMENT, targetEnvironment: 'uat-not-this-one' }));
    assert.equal(base, availabilityVectorHash('co-1', epochs, entries, { ...DEPLOYMENT }));
  });

  it('stamps every required epoch and every route generation', async () => {
    const { prisma, upserts } = makePrisma({
      entitlements: [
        { featureKey: 'expense_auto_post', enabled: true, epoch: 4 },
        { featureKey: 'double_entry_ledger', enabled: true, epoch: 2 },
      ],
      gates: [{ gateKey: 'expense_auto_post', routeKey: 'DEFAULT', state: 'OPEN', generation: 9 }],
    });
    const stamped = await makeService(prisma).createStampedAttempt({
      companyId: 'co-1',
      sourceType: 'expense.record',
      sourceId: 'exp-1',
      attemptKey: 'expense.record:exp-1',
      featureKeys: ['expense_auto_post'],
      routes: [{ gateKey: 'expense_auto_post' }],
    });
    assert.deepEqual(stamped.entitlementEpochs, { double_entry_ledger: 2, expense_auto_post: 4 });
    assert.deepEqual(stamped.launchEntries, [{ gateKey: 'expense_auto_post', routeKey: 'DEFAULT', generation: 9 }]);
    // spec:63 — an existing attempt is never re-stamped with current epochs/generations. The update
    // self-assigns the matched key only, which is what makes the statement a native atomic upsert.
    assert.deepEqual(upserts[0]!.update, { attemptKey: upserts[0]!.where.attemptKey });
  });

  it('stamps a null epoch for a feature the company has no row for, and generation 0 for an unseeded route', async () => {
    const { prisma } = makePrisma({ entitlements: [], gates: [] });
    const stamped = await makeService(prisma).createStampedAttempt({
      companyId: 'co-1',
      sourceType: 'crm.campaign',
      sourceId: 'camp-1',
      attemptKey: 'crm.campaign:camp-1',
      featureKeys: ['crm'],
      routes: [{ gateKey: 'crm' }],
    });
    assert.deepEqual(stamped.entitlementEpochs, { crm: null });
    assert.deepEqual(stamped.launchEntries, [{ gateKey: 'crm', routeKey: 'DEFAULT', generation: 0 }]);
  });
});

describe('claimAttempt (spec:60)', () => {
  it('claims QUEUED→CLAIMED and commits the final mutation in the same transaction', async () => {
    const { prisma, attempt } = makePrisma({ attempt: queuedAttempt(), entitlements: entitledExpenses, gates: openExpenses });
    let mutatedInTx = false;
    const outcome = await makeService(prisma).claimAttempt('att-1', { onClaimed: async () => { mutatedInTx = true; } });
    assert.deepEqual(outcome, { claimed: true, status: 'CLAIMED' });
    assert.equal(attempt!.status, 'CLAIMED');
    assert.ok(attempt!.claimedAt instanceof Date);
    assert.equal(mutatedInTx, true);
  });

  it('takes the tenant entitlement lock first, then the gate locks, on the SHARED side', async () => {
    const { prisma, locks } = makePrisma({
      attempt: queuedAttempt({
        entitlementEpochsJson: { expenses: 3 },
        launchEntriesJson: [
          { gateKey: 'expenses', routeKey: 'DEFAULT', generation: 7 },
          { gateKey: 'thai_tax', routeKey: 'DEFAULT', generation: 1 },
        ],
      }),
      entitlements: entitledExpenses,
      gates: [...openExpenses, { gateKey: 'thai_tax', routeKey: 'DEFAULT', state: 'OPEN', generation: 1 }],
    });
    await makeService(prisma).claimAttempt('att-1');
    assert.deepEqual(locks, ['entitlement:co-1', 'launch_gate:expenses:DEFAULT', 'launch_gate:thai_tax:DEFAULT']);
  });

  it('suppresses on an entitlement epoch mismatch', async () => {
    const { prisma, attempt } = makePrisma({
      attempt: queuedAttempt(),
      entitlements: [{ featureKey: 'expenses', enabled: true, epoch: 4 }],
      gates: openExpenses,
    });
    const outcome = await makeService(prisma).claimAttempt('att-1');
    assert.equal(outcome.status, 'SUPPRESSED_FEATURE_DISABLED');
    assert.equal(attempt!.status, 'SUPPRESSED_FEATURE_DISABLED');
    assert.ok(attempt!.terminalAt instanceof Date);
  });

  it('suppresses a disabled feature that the epoch alone cannot see (spec:51 — disable does not bump it)', async () => {
    const { prisma } = makePrisma({
      attempt: queuedAttempt(),
      entitlements: [{ featureKey: 'expenses', enabled: false, epoch: 3 }],
      gates: openExpenses,
    });
    const outcome = await makeService(prisma).claimAttempt('att-1');
    assert.equal(outcome.status, 'SUPPRESSED_FEATURE_DISABLED');
    assert.match(outcome.reason!, /disabled/);
  });

  it('suppresses when a required route is CLOSED', async () => {
    const { prisma } = makePrisma({
      attempt: queuedAttempt(),
      entitlements: entitledExpenses,
      gates: [{ gateKey: 'expenses', routeKey: 'DEFAULT', state: 'CLOSED', generation: 8 }],
    });
    assert.equal((await makeService(prisma).claimAttempt('att-1')).status, 'SUPPRESSED_LAUNCH_GATE_CLOSED');
  });

  it('suppresses on a stale generation even when the route is OPEN again', async () => {
    const { prisma } = makePrisma({
      attempt: queuedAttempt(),
      entitlements: entitledExpenses,
      // Closed and reopened while the work was queued: reopening never revives it (spec:64).
      gates: [{ gateKey: 'expenses', routeKey: 'DEFAULT', state: 'OPEN', generation: 9 }],
    });
    const outcome = await makeService(prisma).claimAttempt('att-1');
    assert.equal(outcome.status, 'SUPPRESSED_LAUNCH_GATE_CLOSED');
    assert.match(outcome.reason!, /generation 9 != stamped 7/);
  });

  it('writes the SKIPPED terminals when the matrix treatment is SKIP', async () => {
    const disabled = { attempt: queuedAttempt(), entitlements: [{ featureKey: 'expenses', enabled: false, epoch: 3 }], gates: openExpenses };
    const closed = { attempt: queuedAttempt(), entitlements: entitledExpenses, gates: [{ gateKey: 'expenses', routeKey: 'DEFAULT', state: 'CLOSED', generation: 7 }] };
    const first = makePrisma(disabled);
    const second = makePrisma(closed);
    assert.equal((await makeService(first.prisma).claimAttempt('att-1', { treatment: 'SKIP' })).status, 'SKIPPED_FEATURE_DISABLED');
    assert.equal((await makeService(second.prisma).claimAttempt('att-1', { treatment: 'SKIP' })).status, 'SKIPPED_LAUNCH_GATE_CLOSED');
  });

  it('never revives a terminal attempt and never re-claims a claimed one', async () => {
    for (const status of ['SUPPRESSED_LAUNCH_GATE_CLOSED', 'CLAIMED', 'SUCCEEDED']) {
      const { prisma, attempt } = makePrisma({ attempt: queuedAttempt({ status }), entitlements: entitledExpenses, gates: openExpenses });
      const outcome = await makeService(prisma).claimAttempt('att-1');
      assert.deepEqual(outcome, { claimed: false, status, reason: 'not_queued' });
      assert.equal(attempt!.status, status);
    }
  });

  it('exports no batch claim (spec:61 forbids one until the UAT capacity rerun)', async () => {
    const service = makeService(makePrisma().prisma);
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    assert.deepEqual(names.filter((name) => /batch|claimMany|claimAll/i.test(name)), []);
  });
});

describe('DISPATCHING token/lease (spec:62, plan:40)', () => {
  it('mints one token from CLAIMED and keeps it stable when an expired lease resumes', async () => {
    const { prisma, attempt } = makePrisma({ attempt: queuedAttempt({ status: 'CLAIMED' }), entitlements: entitledExpenses, gates: openExpenses });
    const service = makeService(prisma);
    const first = await service.acquireDispatchLease('att-1', 'worker-a');
    assert.ok(first?.dispatchToken);
    assert.equal(attempt!.status, 'DISPATCHING');
    assert.equal(first!.leaseGeneration, 1, 'the first grant bumps the fencing generation off 0');

    // A live lease belongs to its holder.
    assert.equal(await service.acquireDispatchLease('att-1', 'worker-b'), null);

    // Expired BEFORE the provider was invoked: resumable under the same attempt AND the same token,
    // because the token is the provider idempotency key.
    attempt!.leaseExpiresAt = new Date(Date.now() - 1_000);
    const resumed = await service.acquireDispatchLease('att-1', 'worker-b');
    assert.equal(resumed?.dispatchToken, first.dispatchToken);
    assert.equal(attempt!.leaseOwner, 'worker-b');
    assert.equal(resumed!.leaseGeneration, 2, 'the takeover strands the previous holder');
    assert.ok(attempt!.leaseExpiresAt.getTime() > Date.now() + DEFAULT_DISPATCH_LEASE_MS - 5_000);
  });

  it('is never resumable once the provider call has started', async () => {
    const { prisma, attempt } = makePrisma({ attempt: queuedAttempt({ status: 'CLAIMED' }), entitlements: entitledExpenses, gates: openExpenses });
    const service = makeService(prisma);
    const lease = await service.acquireDispatchLease('att-1', 'worker-a');
    assert.equal(await service.markDispatchStarted('att-1', lease!, 'provider-ref-1'), true);
    assert.ok(attempt!.dispatchedAt instanceof Date);

    attempt!.leaseExpiresAt = new Date(Date.now() - 1_000);
    // An HTTP request already dispatched cannot be unsent — no second dispatch, ever.
    assert.equal(await service.acquireDispatchLease('att-1', 'worker-b'), null);
    assert.equal(await service.markDispatchStarted('att-1', lease!), false);
  });

  it('refuses to dispatch on a lease that expired while the worker was stalled', async () => {
    const { prisma, attempt } = makePrisma({ attempt: queuedAttempt({ status: 'CLAIMED' }), entitlements: entitledExpenses, gates: openExpenses });
    const service = makeService(prisma);
    const lease = await service.acquireDispatchLease('att-1', 'worker-a');
    attempt!.leaseExpiresAt = new Date(Date.now() - 1_000);
    // The row is untouched: the request was never sent, so the work stays resumable.
    assert.equal(await service.markDispatchStarted('att-1', lease!), false);
    assert.equal(attempt!.dispatchedAt, null);
  });

  it('renews only a live lease held by this exact fence', async () => {
    const { prisma, attempt } = makePrisma({ attempt: queuedAttempt({ status: 'CLAIMED' }), entitlements: entitledExpenses, gates: openExpenses });
    const service = makeService(prisma);
    const lease = await service.acquireDispatchLease('att-1', 'worker-a');
    assert.equal(await service.renewDispatchLease('att-1', lease!), true);
    assert.equal(await service.renewDispatchLease('att-1', { ...lease!, leaseOwner: 'worker-b' }), false);
    // Same owner NAME, stranded generation: a worker restarted under its old identity is still stale.
    assert.equal(await service.renewDispatchLease('att-1', { ...lease!, leaseGeneration: 0 }), false);
    attempt!.leaseExpiresAt = new Date(Date.now() - 1_000);
    assert.equal(await service.renewDispatchLease('att-1', lease!), false, 'an expired lease is re-acquired, not renewed');
  });

  it('records UNKNOWN_EXTERNAL_OUTCOME only for work that was actually dispatched', async () => {
    const { prisma, attempt } = makePrisma({ attempt: queuedAttempt({ status: 'CLAIMED' }), entitlements: entitledExpenses, gates: openExpenses });
    const service = makeService(prisma);
    const lease = await service.acquireDispatchLease('att-1', 'worker-a');
    // Not yet dispatched: this is resumable work, not an ambiguous outcome.
    assert.equal(await service.markUnknownExternalOutcome('att-1', 'timeout', lease!), false);

    await service.markDispatchStarted('att-1', lease!);
    assert.equal(await service.markUnknownExternalOutcome('att-1', 'timeout after send', lease!), true);
    assert.equal(attempt!.status, 'UNKNOWN_EXTERNAL_OUTCOME');
    assert.ok(attempt!.terminalAt instanceof Date);
    assert.equal(attempt!.leaseOwner, null, 'the lease is released so nothing blind-retries it');
    // Terminal: never claimed as failure or success afterwards, by anyone.
    assert.equal(await service.markSucceeded('att-1', lease!), false);
    assert.equal(await service.markSucceeded('att-1'), false);
  });
});

/**
 * F1.5.1 item 5 — every write after the token is minted CASes on the exact lease that minted it.
 * The single-winner half of the takeover needs two connections and lives in the real-database spec.
 */
describe('dispatch fencing (F1.5.1 item 5)', () => {
  it('strands the previous holder: its completion no-ops instead of overwriting the new one', async () => {
    const { prisma, attempt } = makePrisma({ attempt: queuedAttempt({ status: 'CLAIMED' }), entitlements: entitledExpenses, gates: openExpenses });
    const service = makeService(prisma);
    const stale = (await service.acquireDispatchLease('att-1', 'worker-a'))!;
    attempt!.leaseExpiresAt = new Date(Date.now() - 1_000);
    const fresh = (await service.acquireDispatchLease('att-1', 'worker-b'))!;
    assert.notEqual(stale.leaseGeneration, fresh.leaseGeneration);

    assert.equal(await service.markDispatchStarted('att-1', stale), false);
    assert.equal(await service.markSucceeded('att-1', stale), false);
    assert.equal(await service.markUnknownExternalOutcome('att-1', 'zombie', stale), false);
    assert.equal(attempt!.status, 'DISPATCHING', 'the new holder still owns the row');
    assert.equal(attempt!.leaseOwner, 'worker-b');

    // The rightful holder completes exactly once; its own fence is spent afterwards.
    assert.equal(await service.markDispatchStarted('att-1', fresh), true);
    assert.equal(await service.markSucceeded('att-1', fresh, 'provider-ref-9'), true);
    assert.equal(attempt!.status, 'SUCCEEDED');
    assert.equal(await service.markSucceeded('att-1', fresh), false);
  });

  /**
   * F1.5.2 ruling 2 — holding the lease is not evidence that anything was sent. `markDispatchStarted`
   * is the durable pre-network record, and success without it would record an outcome for a request
   * that provably never left the process.
   */
  it('refuses success that skips the durable dispatch record', async () => {
    const { prisma, attempt } = makePrisma({ attempt: queuedAttempt({ status: 'CLAIMED' }), entitlements: entitledExpenses, gates: openExpenses });
    const service = makeService(prisma);
    const lease = (await service.acquireDispatchLease('att-1', 'worker-a'))!;

    assert.equal(await service.markSucceeded('att-1', lease), false, 'success straight after the lease');
    assert.equal(attempt!.status, 'DISPATCHING');
    assert.equal(attempt!.terminalAt ?? null, null);

    assert.equal(await service.markDispatchStarted('att-1', lease), true);
    assert.equal(await service.markSucceeded('att-1', lease), true);
    assert.equal(attempt!.status, 'SUCCEEDED');
  });

  /**
   * F1.5.2 ruling 4 — the two post-dispatch terminals are not interchangeable. FAILED_CONFIRMED is
   * the retryable one, so it is the strictest: it also needs a lease that has not expired.
   */
  it('records FAILED_CONFIRMED only for a live holder of dispatched work, and UNKNOWN otherwise', async () => {
    const { prisma, attempt } = makePrisma({ attempt: queuedAttempt({ status: 'CLAIMED' }), entitlements: entitledExpenses, gates: openExpenses });
    const service = makeService(prisma);
    const lease = (await service.acquireDispatchLease('att-1', 'worker-a'))!;
    // Nothing was sent yet: the provider cannot have refused it.
    assert.equal(await service.markFailedConfirmed('att-1', lease, 'HTTP 400'), false);

    await service.markDispatchStarted('att-1', lease);
    assert.equal(await service.markFailedConfirmed('att-1', { ...lease, leaseGeneration: 0 }, 'HTTP 400'), false, 'stale fence');
    assert.equal(await service.markFailedConfirmed('att-1', lease, 'HTTP 400 invalid recipient'), true);
    assert.equal(attempt!.status, 'FAILED_CONFIRMED');
    assert.equal(attempt!.lastError, 'HTTP 400 invalid recipient');
    assert.equal(attempt!.leaseOwner, null);
    // Written once: the terminal is not re-stated, nor downgraded to "unknown" afterwards.
    assert.equal(await service.markFailedConfirmed('att-1', lease), false);
    assert.equal(await service.markUnknownExternalOutcome('att-1', 'late timeout', lease), false);
  });

  it('sends a holder that can no longer prove its lease to UNKNOWN, never to FAILED_CONFIRMED', async () => {
    const { prisma, attempt } = makePrisma({ attempt: queuedAttempt({ status: 'CLAIMED' }), entitlements: entitledExpenses, gates: openExpenses });
    const service = makeService(prisma);
    const lease = (await service.acquireDispatchLease('att-1', 'worker-a'))!;
    await service.markDispatchStarted('att-1', lease);
    attempt!.leaseExpiresAt = new Date(Date.now() - 1_000);

    assert.equal(await service.markFailedConfirmed('att-1', lease, 'HTTP 400'), false);
    assert.equal(await service.markUnknownExternalOutcome('att-1', 'lease lapsed mid-flight', lease), true);
    assert.equal(attempt!.status, 'UNKNOWN_EXTERNAL_OUTCOME');
  });

  it('rejects a fence carrying the wrong provider idempotency key', async () => {
    const { prisma } = makePrisma({ attempt: queuedAttempt({ status: 'CLAIMED' }), entitlements: entitledExpenses, gates: openExpenses });
    const service = makeService(prisma);
    const lease = (await service.acquireDispatchLease('att-1', 'worker-a'))!;
    assert.equal(await service.markSucceeded('att-1', { ...lease, dispatchToken: 'someone-elses-token' }), false);
  });

  it('completes a CLAIMED database-only mutation, but only while no lease was ever taken', async () => {
    const { prisma, attempt } = makePrisma({ attempt: queuedAttempt({ status: 'CLAIMED' }), entitlements: entitledExpenses, gates: openExpenses });
    const service = makeService(prisma);
    assert.equal(await service.markSucceeded('att-1'), true);
    assert.equal(attempt!.status, 'SUCCEEDED');

    const dispatching = makePrisma({ attempt: queuedAttempt({ status: 'CLAIMED' }), entitlements: entitledExpenses, gates: openExpenses });
    const other = makeService(dispatching.prisma);
    await other.acquireDispatchLease('att-1', 'worker-a');
    // A dispatched row belongs to its lease holder: the unfenced path cannot terminalize it.
    assert.equal(await other.markSucceeded('att-1'), false);
    assert.equal(dispatching.attempt!.status, 'DISPATCHING');
  });
});

/**
 * F1.5b P0-2 — the claim and the dispatch are separated in time (a queued row, a retry, a resumed
 * lease), so "close before token prevents dispatch" only holds if the token mint re-runs the guard.
 * Every case here is a CLAIMED attempt whose vector stopped holding AFTERWARDS.
 */
describe('dispatch-lease revalidation (P0-2)', () => {
  const claimedAttempt = (overrides: Row = {}) => queuedAttempt({ status: 'CLAIMED', ...overrides });

  it('mints NO token when the route was closed after the claim, and suppresses the attempt', async () => {
    const { prisma, attempt } = makePrisma({
      attempt: claimedAttempt(),
      entitlements: entitledExpenses,
      gates: [{ gateKey: 'expenses', routeKey: 'DEFAULT', state: 'CLOSED', generation: 8 }],
    });
    assert.equal(await makeService(prisma).acquireDispatchLease('att-1', 'worker-a'), null);
    assert.equal(attempt!.status, 'SUPPRESSED_LAUNCH_GATE_CLOSED');
    assert.equal(attempt!.dispatchToken, null, 'no provider idempotency key was ever minted');
    assert.ok(attempt!.terminalAt instanceof Date);
    assert.equal(attempt!.leaseOwner, null);
  });

  it('mints no token when the feature was disabled after the claim', async () => {
    const { prisma, attempt } = makePrisma({
      attempt: claimedAttempt(),
      entitlements: [{ featureKey: 'expenses', enabled: false, epoch: 3 }],
      gates: openExpenses,
    });
    assert.equal(await makeService(prisma).acquireDispatchLease('att-1', 'worker-a'), null);
    assert.equal(attempt!.status, 'SUPPRESSED_FEATURE_DISABLED');
  });

  it('mints no token on a reopened route at a NEW generation (reopen never revives, spec:64)', async () => {
    const { prisma, attempt } = makePrisma({
      attempt: claimedAttempt(),
      entitlements: entitledExpenses,
      gates: [{ gateKey: 'expenses', routeKey: 'DEFAULT', state: 'OPEN', generation: 9 }],
    });
    assert.equal(await makeService(prisma).acquireDispatchLease('att-1', 'worker-a'), null);
    assert.equal(attempt!.status, 'SUPPRESSED_LAUNCH_GATE_CLOSED');
    assert.match(attempt!.lastError, /generation 9 != stamped 7/);
  });

  it('honours the SKIP treatment on the dispatch fence too', async () => {
    const { prisma, attempt } = makePrisma({
      attempt: claimedAttempt(),
      entitlements: [{ featureKey: 'expenses', enabled: false, epoch: 3 }],
      gates: openExpenses,
    });
    assert.equal(await makeService(prisma).acquireDispatchLease('att-1', 'worker-a', undefined, { treatment: 'SKIP' }), null);
    assert.equal(attempt!.status, 'SKIPPED_FEATURE_DISABLED');
  });

  it('takes the SAME shared locks the claim takes, in the same order', async () => {
    const { prisma, locks, lockEvents } = makePrisma({
      attempt: claimedAttempt({
        launchEntriesJson: [
          { gateKey: 'expenses', routeKey: 'DEFAULT', generation: 7 },
          { gateKey: 'thai_tax', routeKey: 'DEFAULT', generation: 1 },
        ],
      }),
      entitlements: entitledExpenses,
      gates: [...openExpenses, { gateKey: 'thai_tax', routeKey: 'DEFAULT', state: 'OPEN', generation: 1 }],
    });
    assert.ok(await makeService(prisma).acquireDispatchLease('att-1', 'worker-a'));
    assert.deepEqual(locks, ['entitlement:co-1', 'launch_gate:expenses:DEFAULT', 'launch_gate:thai_tax:DEFAULT']);
    assert.deepEqual(lockEvents, [
      'advisory:entitlement:co-1',
      'advisory:launch_gate:expenses:DEFAULT',
      'advisory:launch_gate:thai_tax:DEFAULT',
      'row-lock',
    ], 'the row lock is always last, so completion cannot form company→row / row→company deadlock');
  });

  it('suppresses an EXPIRED DISPATCHING lease rather than handing the token to the next worker', async () => {
    const { prisma, attempt } = makePrisma({
      attempt: claimedAttempt({
        status: 'DISPATCHING',
        dispatchToken: 'token-1',
        leaseOwner: 'worker-a',
        leaseExpiresAt: new Date(Date.now() - 1_000),
      }),
      entitlements: entitledExpenses,
      gates: [{ gateKey: 'expenses', routeKey: 'DEFAULT', state: 'CLOSED', generation: 7 }],
    });
    assert.equal(await makeService(prisma).acquireDispatchLease('att-1', 'worker-b'), null);
    assert.equal(attempt!.status, 'SUPPRESSED_LAUNCH_GATE_CLOSED');
  });

  it('mints no token for a vector stamped on a build this generation never attested', async () => {
    const { prisma, attempt } = makePrisma({
      attempt: claimedAttempt({ buildReleaseId: 'build-A' }),
      entitlements: entitledExpenses,
      gates: openExpenses,
    });
    assert.equal(await makeService(prisma).acquireDispatchLease('att-1', 'worker-a'), null);
    assert.equal(attempt!.status, 'SUPPRESSED_LAUNCH_GATE_CLOSED');
    assert.equal(attempt!.dispatchToken, null);
  });
});

/**
 * F1.5.2 blocker 2 (service side) — an OPEN is authorization only for the environment and build it
 * was approved on, which is what `launch-gate.guard.ts` enforces for inbound requests. Queued work
 * carries its own deployment identity, so the same rule is applied to the STAMPED build rather than
 * to the newest OPEN: during a rolling deploy both builds' attestations coexist and both hold.
 */
describe('stamped deployment identity (F1.5.2 blocker 2)', () => {
  const attested = (buildReleaseId: string, generation = 7) => ({
    gateKey: 'expenses',
    routeKey: 'DEFAULT',
    generation,
    targetEnvironment: DEPLOYMENT.targetEnvironment,
    buildReleaseId,
  });

  it('stamps the running deployment onto a new attempt', async () => {
    const { prisma, upserts } = makePrisma();
    await makeService(prisma).createStampedAttempt({
      companyId: 'co-1', sourceType: 'crm.campaign', sourceId: 'camp-1', attemptKey: 'k', featureKeys: [], routes: [],
    });
    assert.equal(upserts[0]!.create.targetEnvironment, DEPLOYMENT.targetEnvironment);
    assert.equal(upserts[0]!.create.buildReleaseId, DEPLOYMENT.buildReleaseId);
  });

  it('claims work stamped on an OLDER build while that build is still attested (rolling deploy)', async () => {
    const { prisma, attempt } = makePrisma({
      attempt: queuedAttempt({ buildReleaseId: 'build-A' }),
      entitlements: entitledExpenses,
      gates: openExpenses,
      // Both builds attested inside ONE generation: exactly what a half-rolled deploy looks like.
      transitions: [attested('build-A'), attested(DEPLOYMENT.buildReleaseId)],
    });
    assert.deepEqual(await makeService(prisma).claimAttempt('att-1'), { claimed: true, status: 'CLAIMED' });
    assert.equal(attempt!.status, 'CLAIMED');
  });

  it('suppresses work stamped on a build this generation never attested', async () => {
    const { prisma, attempt } = makePrisma({
      attempt: queuedAttempt({ buildReleaseId: 'build-A' }),
      entitlements: entitledExpenses,
      gates: openExpenses,
      transitions: [attested(DEPLOYMENT.buildReleaseId)],
    });
    const outcome = await makeService(prisma).claimAttempt('att-1');
    assert.equal(outcome.claimed, false);
    assert.equal(attempt!.status, 'SUPPRESSED_LAUNCH_GATE_CLOSED');
    assert.match(attempt!.lastError, /no OPEN attestation for build build-A/);
  });

  it('suppresses an attempt stamped in another environment, even on a route it did attest', async () => {
    const { prisma, attempt } = makePrisma({
      attempt: queuedAttempt({ targetEnvironment: 'uat' }),
      entitlements: entitledExpenses,
      gates: openExpenses,
      transitions: [{ ...attested(DEPLOYMENT.buildReleaseId), targetEnvironment: 'uat' }],
    });
    assert.equal((await makeService(prisma).claimAttempt('att-1')).claimed, false);
    assert.equal(attempt!.status, 'SUPPRESSED_LAUNCH_GATE_CLOSED');
    assert.match(attempt!.lastError, /stamped in uat/);
  });

  it('fails closed on a row that carries no deployment identity at all', async () => {
    const { prisma, attempt } = makePrisma({
      attempt: queuedAttempt({ targetEnvironment: null, buildReleaseId: null }),
      entitlements: entitledExpenses,
      gates: openExpenses,
    });
    assert.equal((await makeService(prisma).claimAttempt('att-1')).claimed, false);
    assert.equal(attempt!.status, 'SUPPRESSED_LAUNCH_GATE_CLOSED');
  });

  /**
   * Owner ruling 1 (b) — BOTH builds must hold authority. The stamped build proves the vector was
   * read under a real approval; the running build proves the code about to execute the work is
   * itself approved. Neither alone is enough, and neither is forced to equal the other.
   */
  it('refuses work whose STAMPED build is live but whose RUNNING build was never attested', async () => {
    const { prisma, attempt } = makePrisma({
      attempt: queuedAttempt({ buildReleaseId: 'build-A' }),
      entitlements: entitledExpenses,
      gates: openExpenses,
      transitions: [attested('build-A')],
    });
    assert.equal((await makeService(prisma).claimAttempt('att-1')).claimed, false);
    assert.equal(attempt!.status, 'SUPPRESSED_LAUNCH_GATE_CLOSED');
    assert.match(attempt!.lastError, new RegExp(`for build ${DEPLOYMENT.buildReleaseId}.*the running build`));
  });

  /**
   * Owner ruling 1 — an attestation is not a permanent allowlist. Once a third build retires it, the
   * retired build's runtime is refused even though its OPEN row is still there, and the surviving
   * window {N-1, N} keeps working.
   */
  it('refuses a RETIRED build, and still admits both members of the {previous, current} window', async () => {
    const retired = (buildReleaseId: string) => ({ ...attested(buildReleaseId), action: 'CLOSE' });
    // build-1 attested, then superseded by build-2 and this build, then retired by a marker.
    const window = [attested('build-1'), attested('build-2'), attested(DEPLOYMENT.buildReleaseId), retired('build-1')];

    const stale = makePrisma({
      attempt: queuedAttempt({ buildReleaseId: 'build-1' }),
      entitlements: entitledExpenses,
      gates: openExpenses,
      transitions: window,
    });
    assert.equal((await makeService(stale.prisma).claimAttempt('att-1')).claimed, false);
    assert.equal(stale.attempt!.status, 'SUPPRESSED_LAUNCH_GATE_CLOSED');
    assert.match(stale.attempt!.lastError, /no OPEN attestation for build build-1/);

    for (const build of ['build-2', DEPLOYMENT.buildReleaseId]) {
      const live = makePrisma({
        attempt: queuedAttempt({ buildReleaseId: build }),
        entitlements: entitledExpenses,
        gates: openExpenses,
        transitions: window,
      });
      assert.deepEqual(await makeService(live.prisma).claimAttempt('att-1'), { claimed: true, status: 'CLAIMED' }, build);
    }

    // A rollback re-attests the retired build at a higher seq — newest marker wins, so it is not bricked.
    const rolledBack = makePrisma({
      attempt: queuedAttempt({ buildReleaseId: 'build-1' }),
      entitlements: entitledExpenses,
      gates: openExpenses,
      transitions: [...window, attested('build-1')],
    });
    assert.equal((await makeService(rolledBack.prisma).claimAttempt('att-1')).claimed, true);
  });

  it('honours the SKIP treatment, and needs no attestation for work with no routes', async () => {
    const skipped = makePrisma({
      attempt: queuedAttempt({ buildReleaseId: 'build-A' }),
      entitlements: entitledExpenses,
      gates: openExpenses,
      transitions: [attested(DEPLOYMENT.buildReleaseId)],
    });
    await makeService(skipped.prisma).claimAttempt('att-1', { treatment: 'SKIP' });
    assert.equal(skipped.attempt!.status, 'SKIPPED_LAUNCH_GATE_CLOSED');

    const routeless = makePrisma({ attempt: queuedAttempt({ entitlementEpochsJson: {}, launchEntriesJson: [] }) });
    assert.equal((await makeService(routeless.prisma).claimAttempt('att-1')).claimed, true);
  });
});

/**
 * F1.5b P0-5 + F1.5.1 item 2 — a caller-stable key is only unique WITHIN a tenant AND within one
 * attempt sequence. The stored key carries both, and an immutable identity fingerprint covering the
 * whole identity is compared on every hit, so an upsert can never hand back another company's, or
 * another sequence's, attempt.
 */
describe('attempt identity is tenant- and sequence-scoped (P0-5, F1.5.1 item 2)', () => {
  const stampInput = (overrides: Row = {}) => ({
    companyId: 'co-1' as string | null,
    sourceType: 'crm.campaign',
    sourceId: 'camp-1',
    attemptKey: 'crm.campaign:camp-1',
    featureKeys: ['crm'],
    routes: [{ gateKey: 'crm' }],
    ...overrides,
  });

  /**
   * What the DB rows written before `IDENTITY_FINGERPRINT_VERSION` look like on an upsert hit: no
   * comparable digest, but a full stored VECTOR — the required feature set, the route vector and the
   * retained-artifact policy the work will actually be checked against.
   */
  const legacyRow = (overrides: Row = {}): Row => ({
    id: 'att-legacy',
    attemptKey: scopedAttemptKey('co-1', 'crm.campaign:camp-1'),
    companyScope: 'co-1',
    sourceType: 'crm.campaign',
    sourceId: 'camp-1',
    attemptSeq: 1,
    identityFingerprint: null,
    entitlementEpochsJson: { crm: 1 },
    launchEntriesJson: [{ gateKey: 'crm', routeKey: 'DEFAULT', generation: 4 }],
    retainedArtifactPolicy: null,
    ...overrides,
  });

  it('scopes the stored key by company AND sequence, and gives platform work its own sentinel scope', () => {
    assert.equal(scopedAttemptKey('co-1', 'k'), 'co-1::1::k');
    assert.notEqual(scopedAttemptKey('co-2', 'k'), scopedAttemptKey('co-1', 'k'));
    assert.equal(scopedAttemptKey(null, 'k'), '__platform__::1::k');
    // Resume/Reissue mints the next sequence, so it must not address attempt #1's row.
    assert.notEqual(scopedAttemptKey('co-1', 'k', 2), scopedAttemptKey('co-1', 'k', 1));
  });

  it('fingerprints the sequence, the required feature set, the route vector and the policy', () => {
    const base = { companyId: 'co-1', sourceType: 'crm.campaign', sourceId: 'camp-1', attemptKey: 'k' };
    const of = (o: Row = {}) => attemptIdentityFingerprint({ ...base, featureKeys: ['crm'], routes: [{ gateKey: 'crm' }], ...o });
    assert.equal(of(), of({ routes: [{ gateKey: 'crm', routeKey: 'DEFAULT' }] }), 'route defaulting is canonical');
    assert.notEqual(of(), of({ attemptSeq: 2 }));
    assert.notEqual(of(), of({ featureKeys: ['expense_auto_post'] }));
    assert.notEqual(of(), of({ routes: [{ gateKey: 'crm', routeKey: 'PILOT' }] }));
    assert.notEqual(of(), of({ retainedArtifactPolicy: 'RETAIN' }));
    assert.notEqual(of(), of({ companyId: 'co-2' }));
    // Versioned, so a row hashed under an older identity is recognisable rather than mis-compared.
    assert.match(of(), /^v2:[0-9a-f]{64}$/);
  });

  it('mints a NEW attempt for a new sequence instead of resuming the old one', async () => {
    const { prisma, stored } = makePrisma();
    const service = makeService(prisma);
    const first = await service.createStampedAttempt(stampInput());
    const resumed = await service.createStampedAttempt(stampInput({ attemptSeq: 2 }));

    assert.notEqual(resumed.id, first.id, 'Resume/Reissue never revives the old row (spec:64)');
    assert.deepEqual([...stored.keys()].sort(), ['co-1::1::crm.campaign:camp-1', 'co-1::2::crm.campaign:camp-1']);
  });

  it('gives two companies sharing one caller key two separate attempts', async () => {
    const { prisma, stored } = makePrisma();
    const service = makeService(prisma);
    const first = await service.createStampedAttempt(stampInput());
    const second = await service.createStampedAttempt(stampInput({ companyId: 'co-2' }));

    assert.notEqual(first.id, second.id, 'co-2 must not resume co-1 work');
    assert.deepEqual([...stored.keys()].sort(), ['co-1::1::crm.campaign:camp-1', 'co-2::1::crm.campaign:camp-1']);
  });

  it('returns the SAME attempt for a repeat of the same work, without re-stamping it', async () => {
    const { prisma, upserts } = makePrisma({ entitlements: [{ featureKey: 'crm', enabled: true, epoch: 2 }] });
    const service = makeService(prisma);
    const first = await service.createStampedAttempt(stampInput());
    const again = await service.createStampedAttempt(stampInput());

    assert.equal(again.id, first.id);
    assert.deepEqual(again.entitlementEpochs, first.entitlementEpochs);
    for (const upsert of upserts) {
      assert.deepEqual(upsert.update, { attemptKey: upsert.where.attemptKey }, 'spec:63 — never back-stamped');
    }
  });

  it('throws instead of returning a row that belongs to another company', async () => {
    // The row a pre-P0-5 (unscoped) key could collide with: same stored key, different tenant.
    const { prisma } = makePrisma({ storedAttempts: [legacyRow({ id: 'att-other', companyScope: 'co-2' })] });
    await assert.rejects(
      () => makeService(prisma).createStampedAttempt(stampInput()),
      (err: ConflictException) => {
        assert.equal((err.getResponse() as any).code, 'execution_attempt_identity_conflict');
        return true;
      },
    );
  });

  it('throws when the same key inside one company names DIFFERENT source work', async () => {
    const { prisma } = makePrisma({
      storedAttempts: [legacyRow({
        id: 'att-1',
        identityFingerprint: attemptIdentityFingerprint({
          ...stampInput(),
          sourceId: 'a-DIFFERENT-campaign',
        } as any),
      })],
    });
    await assert.rejects(
      () => makeService(prisma).createStampedAttempt(stampInput()),
      (err: ConflictException) => (err.getResponse() as any).code === 'execution_attempt_identity_conflict',
    );
  });

  it('throws when a hit was fingerprinted under a different route vector', async () => {
    const { prisma } = makePrisma({
      storedAttempts: [legacyRow({
        identityFingerprint: attemptIdentityFingerprint({ ...stampInput(), routes: [{ gateKey: 'crm', routeKey: 'PILOT' }] } as any),
      })],
    });
    await assert.rejects(
      () => makeService(prisma).createStampedAttempt(stampInput()),
      (err: ConflictException) => (err.getResponse() as any).code === 'execution_attempt_identity_conflict',
    );
  });

  /**
   * The compatibility half of the migration's reconciliation: a row it rewrote into the scoped+seq
   * key still carries a fingerprint hashed under the older, narrower identity. It is compared
   * structurally rather than rejected — spec:63 forbids back-stamping old work.
   *
   * F1.5.2 ruling 1 — that structural comparison covers the stored GUARD VECTOR too. Comparing only
   * scope/source/seq would adopt a migrated row whose work is checked against a different feature
   * set, a different route vector or a different retained-artifact policy than the caller's
   * descriptor names, which is precisely what the fingerprint exists to prevent.
   */
  it('accepts a legacy row on a structural identity match, and rejects one that does not match', async () => {
    // The stored row's route GENERATION (4) is deliberately not today's (0, no gate row): a stale
    // generation is a claim-time suppression, never an identity conflict.
    const accepted = makePrisma({ storedAttempts: [legacyRow()] });
    assert.equal((await makeService(accepted.prisma).createStampedAttempt(stampInput())).id, 'att-legacy');

    const preVersionDigest = makePrisma({ storedAttempts: [legacyRow({ identityFingerprint: 'a'.repeat(64) })] });
    assert.equal((await makeService(preVersionDigest.prisma).createStampedAttempt(stampInput())).id, 'att-legacy');

    const drifts: Row[] = [
      { sourceId: 'other' },
      { attemptSeq: 2 },
      { companyScope: 'co-2' },
      // Same source, DIFFERENT guard vector — the untagged row a scope/source/seq-only comparison
      // would have adopted.
      { entitlementEpochsJson: { crm: 1, expenses: 2 } },
      { entitlementEpochsJson: {} },
      { launchEntriesJson: [{ gateKey: 'crm', routeKey: 'PILOT', generation: 4 }] },
      { launchEntriesJson: [] },
      { retainedArtifactPolicy: 'RETAIN' },
    ];
    for (const drift of drifts) {
      const { prisma } = makePrisma({ storedAttempts: [legacyRow(drift)] });
      await assert.rejects(
        () => makeService(prisma).createStampedAttempt(stampInput()),
        (err: ConflictException) => (err.getResponse() as any).code === 'execution_attempt_identity_conflict',
        `legacy row adopted despite ${JSON.stringify(drift)}`,
      );
    }
  });

  /**
   * F1.5.2 ruling 3 — the SAME work under a SECOND caller key. `(companyScope, sourceType, sourceId,
   * attemptSeq)` is a unique the `attemptKey` upsert does not arbitrate on, so without the source
   * pre-read this surfaces as a bare P2002. The concurrent half is raced in the real-database spec.
   */
  it('answers a second key naming work that already has an attempt, instead of colliding', async () => {
    const { prisma } = makePrisma({
      storedAttempts: [legacyRow({ attemptKey: scopedAttemptKey('co-1', 'crm.campaign:camp-1-ALTERNATE') })],
    });
    await assert.rejects(
      () => makeService(prisma).createStampedAttempt(stampInput()),
      (err: ConflictException) => {
        const body = err.getResponse() as any;
        assert.equal(body.code, 'execution_attempt_identity_conflict');
        assert.equal(body.attemptKey, 'crm.campaign:camp-1', 'the rejected key is named');
        assert.equal(body.conflictingAttemptKey, 'co-1::1::crm.campaign:camp-1-ALTERNATE', 'and so is the holder');
        return true;
      },
    );
  });
});
