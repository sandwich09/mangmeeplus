/**
 * REAL-DATABASE spec for the CC1 safe-OFF lifecycle (spec:59-60, 69).
 *
 * Three things here are invisible to a mocked test and are the reason this piece needed one:
 *
 *  1. DISABLE vs IN-FLIGHT CLAIM — the guarantee the whole piece exists for (spec:60): a concurrent
 *     disable either commits first and PREVENTS the claim, or the claim commits first and the work
 *     runs. Never both, never neither. That dichotomy is enforced by real advisory locks across two
 *     real connections; a shared in-memory row cannot lose a race.
 *  2. Two concurrent disables of one feature — the set CAS must produce exactly one winner and
 *     exactly one `RunoffSnapshot`, with no unique violation on the transition.
 *  3. Concurrent completions — N sweeps racing the post-commit call must append exactly ONE OFF,
 *     arbitrated by `@@unique([companyId, featureKey, commandId])`.
 *
 * SKIPS (never fails) when no database is reachable, so the suite still exits 0 without one.
 *
 * Safety: it creates its own throwaway company, writes only under that company id, and deletes it
 * afterwards. It never touches an existing tenant.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import type { RequestContext } from '@watchdog-bms/contracts';
import { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { ExecutionAttemptService, sharedEntitlementLock } from './execution-attempt.service';
import {
  completeRunoffIfDrained,
  decodeDrainCursor,
  drainingStateOf,
  listDrainingPage,
  runoffCompletionCommandId,
  sweepDrainingLifecycles,
  type RunoffCompletionInspectors,
} from './runoff-lifecycle';
import { SetPartnerFeaturesUseCase } from '../../system-partner-management/application/use-cases/set-partner-features.use-case';
import { NORMALIZER_VERSION } from '../../employee-access/application/normalize-entitlements';
import { ReportEntitlementService } from '../../reports/application/report-entitlement.service';
import {
  CreateReportExportUseCase,
  CreateReportViewUseCase,
  DownloadReportExportUseCase,
  GetReportRunUseCase,
  ListReportExportsUseCase,
  ListReportViewsUseCase,
  ReportDrilldownUseCase,
  RunReportQueryUseCase,
} from '../../reports/application/report.use-cases';
import { sha256 } from '../../reports/domain/report-csv.logic';
import { PrismaReportRepository } from '../../reports/infrastructure/prisma-report.repository';

const TAG = `runoff-${process.pid}`;
const DEPLOYMENT = resolveDeploymentIdentity(process.env);
/** Independent rounds, so one lucky iteration cannot hide a defect. */
const RACES = 20;

/**
 * The ROOT `.env` is the real local database (docker `127.0.0.1:15432/watchdog_bms`).
 * `apps/api/.env` carries a stale `5432/mydb` URL that only the Prisma CLI should ever see.
 */
function rootDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(__dirname, '../'.repeat(6), '.env'), 'utf8');
    return /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(env)?.[1] ?? null;
  } catch {
    return null;
  }
}

const noopLogger = { warn() {}, info() {}, error() {} } as any;
/** `reports` needs no chart readiness; the command only loads it for an `expense_auto_post` enable. */
const readinessStub = { load: async () => ({ readyForAutomaticPosting: true }) } as any;

describe('CC1 safe-OFF / runoff lifecycle (real database)', () => {
  let clients: PrismaClient[] = [];
  let useCases: SetPartnerFeaturesUseCase[] = [];
  let attempts: ExecutionAttemptService;
  let companyId = '';
  /** `AuditLog.actorUserId` is a real FK to User, so the acting admin must exist. Borrowed, never written to. */
  let adminUserId = '';
  let reachable = false;

  /** Resets the company to a single ON `reports` row with a known fence, and clears its history. */
  async function resetToOn(): Promise<void> {
    await clients[0]!.reportDrilldownAccessLog.deleteMany({ where: { companyId } });
    await clients[0]!.reportExportRequest.deleteMany({ where: { companyId } });
    await clients[0]!.reportRun.deleteMany({ where: { companyId } });
    await clients[0]!.reportView.deleteMany({ where: { companyId } });
    await clients[0]!.runoffSnapshot.deleteMany({ where: { companyId } });
    await clients[0]!.entitlementTransition.deleteMany({ where: { companyId } });
    await clients[0]!.entitlementCommand.deleteMany({ where: { companyId } });
    await clients[0]!.executionAttempt.deleteMany({ where: { companyId } });
    await clients[0]!.companyFeatureEntitlement.deleteMany({ where: { companyId } });
    await clients[0]!.companyFeatureEntitlement.createMany({
      data: [
        { companyId, featureKey: 'reports', enabled: true, epoch: 1, lastSeq: 1 },
        // A second row so the evaluator is NOT in its zero-row fail-open mode.
        { companyId, featureKey: 'inventory', enabled: true, epoch: 1, lastSeq: 1 },
      ],
    });
    await clients[0]!.companyEntitlementSet.upsert({
      where: { companyId },
      create: { companyId, setVersion: 0 },
      update: { setVersion: 0 },
    });
  }

  const disableReports = (commandId: string, expectedSetVersion = 0) => ({
    companyId,
    features: [{ featureKey: 'reports', enabled: false }],
    requestingAdminUserId: adminUserId,
    requestId: commandId,
    commandId,
    expectedSetVersion,
  });

  before(async () => {
    const url = rootDatabaseUrl();
    if (!url) return;
    try {
      clients = [
        new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
        new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
      ];
      await clients[0]!.$queryRaw`SELECT 1`;
      reachable = true;
    } catch {
      reachable = false;
      return;
    }

    const company = await clients[0]!.company.create({
      data: { name: `${TAG}-co`, status: 'ACTIVE' },
      select: { id: true },
    });
    companyId = company.id;
    // Own throwaway row: the partner command audits `actorUserId` and that column is a real FK to
    // User, so an invented id fails the insert (found by this spec, invisible to a fake). Borrowing
    // an existing id is not safe — spec files run as concurrent processes against one shared
    // database, and another file's teardown can delete the borrowed user mid-run.
    adminUserId = (await clients[0]!.user.create({ data: { displayName: `${TAG} admin` }, select: { id: true } })).id;
    // The partner command refuses every shape until normalization is COMPLETE at the current
    // version with a valid cohort (F1.5.1 item 1) — this fixture is what gets past that gate.
    await clients[0]!.companyEntitlementNormalization.create({
      data: {
        companyId,
        status: 'COMPLETED',
        snapshotHash: TAG,
        runId: TAG,
        normalizerVersion: NORMALIZER_VERSION,
        cohortKind: 'EXPLICIT',
        completedAt: new Date(),
      },
    });

    useCases = clients.map((client) => new SetPartnerFeaturesUseCase({ client } as any, readinessStub));
    attempts = new ExecutionAttemptService(
      { client: clients[0]! } as any,
      noopLogger,
      { deploymentIdentity: DEPLOYMENT } as any,
    );
  });

  after(async () => {
    if (!reachable) return;
    // Company delete cascades every child row this spec wrote.
    await clients[0]!.company.deleteMany({ where: { id: companyId } });
    // AuditLog survives the company cascade (its company relation is SetNull), so the throwaway
    // admin's audit rows go first, then the user itself.
    await clients[0]!.auditLog.deleteMany({ where: { actorUserId: adminUserId } });
    await clients[0]!.user.deleteMany({ where: { id: adminUserId } });
    await Promise.all(clients.map((client) => client.$disconnect()));
  });

  /** A QUEUED attempt stamped against this company's live `reports` epoch. */
  async function queuedAttempt(label: string): Promise<string> {
    const attempt = await attempts.createStampedAttempt({
      companyId,
      sourceType: TAG,
      sourceId: label,
      attemptKey: `${TAG}:${label}`,
      featureKeys: ['reports'],
      routes: [],
    });
    return attempt.id;
  }

  it('DISABLE-THEN-CLAIM — queued work terminalizes SUPPRESSED, never silently vanishes', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetToOn();

    // The ORDERED half of the dichotomy, forced rather than raced: the free race below is won by
    // the claim essentially every time (it is a far shorter transaction), so leaving this branch to
    // chance would leave the suppression path — the entire point of safe OFF — unproven.
    const attemptId = await queuedAttempt('ordered-disable-first');
    await useCases[0]!.execute(disableReports(`ordered-${randomUUID()}`));

    const outcome = await attempts.claimAttempt(attemptId);
    assert.equal(outcome.claimed, false, 'a disabled feature grants no claim');

    const row = await clients[0]!.executionAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: { status: true, lastError: true },
    });
    assert.equal(row.status, 'SUPPRESSED_FEATURE_DISABLED', 'and leaves a TERMINAL, not a silent drop');
    assert.match(String(row.lastError), /reports is disabled/);
  });

  it('CLAIM-THEN-DISABLE — work already claimed under the old vector completes', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetToOn();

    // The other ordered half: a disable must not retroactively strand work that already committed
    // its claim. spec:60 — the claimant "either commits first and prevents the claim, or observes
    // the already claimed attempt".
    const attemptId = await queuedAttempt('ordered-claim-first');
    assert.equal((await attempts.claimAttempt(attemptId)).claimed, true);

    await useCases[0]!.execute(disableReports(`ordered2-${randomUUID()}`));

    const row = await clients[0]!.executionAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: { status: true },
    });
    assert.equal(row.status, 'CLAIMED', 'a committed claim survives a later disable');
  });

  it('RACE 1 — a disable and an in-flight claim have exactly one winner, never a third outcome (spec:60)', async (t) => {
    if (!reachable) return t.skip('no database reachable');

    // THE dichotomy. `claimAttempt` takes the SHARED entitlement lock; the disable takes the
    // EXCLUSIVE side. So either the claim commits first (work runs under the vector it was stamped
    // with) or the disable commits first (`enabled=false`, and the claim terminalizes). A result
    // that is NEITHER — a claim granted while the feature reads disabled, or a row left QUEUED with
    // no terminal — is the stranded-work failure this whole piece exists to prevent. Both ordered
    // halves are proved deterministically above; this proves no third outcome exists under real
    // contention.
    const outcomes = { claimed: 0, suppressed: 0 };

    for (let round = 0; round < RACES; round += 1) {
      await resetToOn();
      const attemptId = await queuedAttempt(`race1-${round}`);

      const [claimResult, disableResult] = await Promise.allSettled([
        attempts.claimAttempt(attemptId),
        useCases[1]!.execute(disableReports(`race1-${round}-${randomUUID()}`)),
      ]);

      const row = await clients[0]!.executionAttempt.findUniqueOrThrow({
        where: { id: attemptId },
        select: { status: true, lastError: true },
      });
      const entitlement = await clients[0]!.companyFeatureEntitlement.findUniqueOrThrow({
        where: { companyId_featureKey: { companyId, featureKey: 'reports' } },
        select: { enabled: true },
      });

      // The disable itself must always succeed — losing the race is not a failure mode for it.
      assert.equal(disableResult.status, 'fulfilled');
      assert.equal(entitlement.enabled, false, 'the disable committed either way');

      if (claimResult.status === 'fulfilled' && claimResult.value.claimed) {
        outcomes.claimed += 1;
        assert.equal(row.status, 'CLAIMED', 'a granted claim really claimed the row, and did so first');
      } else {
        outcomes.suppressed += 1;
        assert.equal(row.status, 'SUPPRESSED_FEATURE_DISABLED', 'a refused claim leaves a TERMINAL');
        assert.match(String(row.lastError), /reports is disabled/);
      }
      assert.notEqual(row.status, 'QUEUED', 'the round must resolve one way or the other');
    }

    assert.equal(outcomes.claimed + outcomes.suppressed, RACES);
    // Reported, not asserted: the split is scheduling-dependent and pinning it would make this
    // spec flaky. The ordered halves above are what prove BOTH branches actually work.
    console.log(`  race-1 over ${RACES} rounds: claimed=${outcomes.claimed} suppressed=${outcomes.suppressed}`);
  });

  it('RACE 2 — two concurrent disables produce one winner and ONE snapshot', async (t) => {
    if (!reachable) return t.skip('no database reachable');

    for (let round = 0; round < RACES; round += 1) {
      await resetToOn();

      const results = await Promise.allSettled([
        useCases[0]!.execute(disableReports(`race2a-${round}-${randomUUID()}`)),
        useCases[1]!.execute(disableReports(`race2b-${round}-${randomUUID()}`)),
      ]);

      const winners = results.filter((result) => result.status === 'fulfilled');
      assert.equal(winners.length, 1, 'exactly one disable command may win the set CAS');

      const snapshots = await clients[0]!.runoffSnapshot.findMany({ where: { companyId, featureKey: 'reports' } });
      assert.equal(snapshots.length, 1, 'and it writes exactly one immutable snapshot');

      const requested = await clients[0]!.entitlementTransition.findMany({
        where: { companyId, featureKey: 'reports', action: 'DISABLE_REQUESTED' },
      });
      assert.equal(requested.length, 1);
      assert.equal(snapshots[0]!.disableSeq, requested[0]!.seq, 'keyed by the transition seq');

      const set = await clients[0]!.companyEntitlementSet.findUniqueOrThrow({ where: { companyId } });
      assert.equal(set.setVersion, 1, 'the loser moved nothing');
    }
  });

  /**
   * Rewinds a just-disabled lifecycle back to GENUINE DRAINING: deletes the OFF the post-commit
   * completion already wrote and restores the fence to the request's seq. This is the crash shape
   * (commit landed, completion died) and it is what makes the concurrency test below non-vacuous —
   * racing three completions against an ALREADY-completed lifecycle proves nothing, because all
   * three would trivially answer NOT_DRAINING (r18 F6).
   */
  async function rewindToDraining(featureKey: string): Promise<number> {
    const request = await clients[0]!.entitlementTransition.findFirstOrThrow({
      where: { companyId, featureKey, action: 'DISABLE_REQUESTED' },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    await clients[0]!.entitlementTransition.deleteMany({ where: { companyId, featureKey, action: 'OFF' } });
    await clients[0]!.companyFeatureEntitlement.update({
      where: { companyId_featureKey: { companyId, featureKey } },
      data: { lastSeq: request.seq },
    });
    return request.seq;
  }

  it('RACE 3 — three concurrent completions on a GENUINELY draining lifecycle append exactly ONE OFF', async (t) => {
    if (!reachable) return t.skip('no database reachable');

    let contended = 0;
    for (let round = 0; round < RACES; round += 1) {
      await resetToOn();
      await useCases[0]!.execute(disableReports(`race3-${round}-${randomUUID()}`));
      const disableSeq = await rewindToDraining('reports');

      // Precondition: the arbitration is actually being exercised this round.
      assert.notEqual(await drainingStateOf(clients[0]! as any, companyId, 'reports'), null,
        'fixture must be genuinely DRAINING before the race');

      const outcomes = await Promise.all([
        completeRunoffIfDrained({ client: clients[0]! } as any, companyId, 'reports'),
        completeRunoffIfDrained({ client: clients[1]! } as any, companyId, 'reports'),
        completeRunoffIfDrained({ client: clients[0]! } as any, companyId, 'reports'),
      ]);
      // Exactly one caller may claim it did the work; the others must see it already done or gone.
      const completedBy = outcomes.filter((outcome) => outcome === 'COMPLETED').length;
      assert.equal(completedBy, 1, `exactly one COMPLETED (outcomes: ${outcomes.join(',')})`);
      // Reported, not asserted. The exclusive entitlement lock serializes the three callers, so the
      // losers normally re-read under the lock and answer NOT_DRAINING (the fence already moved) —
      // that IS the primary arbitration. The commandId unique + shape check is the backstop for a
      // caller that gets past the lock (proved in `runoff-lifecycle.spec.ts`).
      if (outcomes.some((outcome) => outcome === 'ALREADY_COMPLETED')) contended += 1;

      const off = await clients[0]!.entitlementTransition.findMany({
        where: { companyId, featureKey: 'reports', action: 'OFF' },
      });
      assert.equal(off.length, 1, `exactly one OFF (outcomes: ${outcomes.join(',')})`);
      assert.equal(off[0]!.actorUserId, 'SYSTEM');
      assert.equal(off[0]!.seq, disableSeq + 1);
      assert.equal(off[0]!.commandId, runoffCompletionCommandId('reports', disableSeq));
    }
    console.log(`  race-3 over ${RACES} rounds: exactly 1 COMPLETED each; ${contended} also hit the ALREADY_COMPLETED backstop (the rest arbitrated on the lock)`);
  });

  it('r18 F2 — a partner command may not squat the completion command-id namespace', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetToOn();

    // Without this refusal the partner transition would occupy the unique the completer uses as its
    // fence: completion would read it as "already done", the OFF would never land, and the sweep
    // would report the lifecycle finished.
    await assert.rejects(
      () => useCases[0]!.execute({
        companyId,
        features: [{ featureKey: 'reports', enabled: false }],
        requestingAdminUserId: adminUserId,
        requestId: 'squat',
        commandId: runoffCompletionCommandId('reports', 2),
        expectedSetVersion: 0,
      }),
      (error: any) => (error.getResponse() as any).code === 'reserved_command_id_prefix',
    );

    const row = await clients[0]!.companyFeatureEntitlement.findUniqueOrThrow({
      where: { companyId_featureKey: { companyId, featureKey: 'reports' } },
      select: { enabled: true },
    });
    assert.equal(row.enabled, true, 'refused before any write');
    assert.equal(await clients[0]!.entitlementTransition.count({ where: { companyId } }), 0);
  });

  it('completes the empty drain in-request, leaving the lifecycle OFF and not DRAINING', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetToOn();

    await useCases[0]!.execute(disableReports(`inrequest-${randomUUID()}`));

    // The post-commit completion already ran, so a `reports` disable is OFF by the time the
    // operator's request returns — no sweep needed for a family with no runoff roots.
    assert.equal(await drainingStateOf(clients[0]! as any, companyId, 'reports'), null);
    const transitions = await clients[0]!.entitlementTransition.findMany({
      where: { companyId, featureKey: 'reports' },
      orderBy: { seq: 'asc' },
      select: { seq: true, action: true, epoch: true, actorUserId: true },
    });
    assert.deepEqual(transitions, [
      { seq: 2, action: 'DISABLE_REQUESTED', epoch: 1, actorUserId: adminUserId },
      { seq: 3, action: 'OFF', epoch: 1, actorUserId: 'SYSTEM' },
    ]);
  });

  it('FULL CYCLE — ON → DRAINING → OFF → ON → DRAINING → OFF with the epoch advancing on every resume', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetToOn();

    const epochOf = async () => (await clients[0]!.companyFeatureEntitlement.findUniqueOrThrow({
      where: { companyId_featureKey: { companyId, featureKey: 'reports' } },
      select: { epoch: true },
    })).epoch;

    assert.equal(await epochOf(), 1, 'starting epoch');

    await useCases[0]!.execute(disableReports(`cycle-off-1-${randomUUID()}`));
    assert.equal(await epochOf(), 1, 'spec:54 — a disable never moves the epoch');

    await useCases[0]!.execute({
      companyId,
      features: [{ featureKey: 'reports', enabled: true }],
      requestingAdminUserId: adminUserId,
      requestId: `cycle-on-${randomUUID()}`,
      commandId: `cycle-on-${randomUUID()}`,
      expectedSetVersion: 1,
    });
    // spec:54 — "Returning DRAINING→ON with the pre-disable epoch is forbidden." The resume bumps
    // it because the drain left `enabled=false`, so `wasOn()` is false on the ordinary enable path.
    assert.equal(await epochOf(), 2, 'the resume mints a NEW epoch');

    await useCases[0]!.execute(disableReports(`cycle-off-2-${randomUUID()}`, 2));
    assert.equal(await epochOf(), 2);

    // spec:64 — a later disable cycle gets its OWN immutable snapshot; re-enable never revived the
    // first one, and neither snapshot was mutated.
    const snapshots = await clients[0]!.runoffSnapshot.findMany({
      where: { companyId, featureKey: 'reports' },
      orderBy: { disableSeq: 'asc' },
      select: { disableSeq: true, rootsJson: true },
    });
    assert.equal(snapshots.length, 2, 'two cycles, two snapshots');
    assert.notEqual(snapshots[0]!.disableSeq, snapshots[1]!.disableSeq);

    const actions = (await clients[0]!.entitlementTransition.findMany({
      where: { companyId, featureKey: 'reports' },
      orderBy: { seq: 'asc' },
      select: { action: true },
    })).map((row) => row.action);
    assert.deepEqual(actions, ['DISABLE_REQUESTED', 'OFF', 'ENABLE', 'DISABLE_REQUESTED', 'OFF']);
  });

  it('AC26 — real report roots remain readable byte-for-byte while OFF blocks every new root, then ON resumes without customer input', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetToOn();

    const reportRepo = new PrismaReportRepository({ client: clients[0]! } as any);
    const reportEntitlement = new ReportEntitlementService({ client: clients[0]! } as any);
    const computedAt = new Date().toISOString();
    const page = {
      status: 'READY' as const,
      computedAt,
      freshness: {
        computedAt,
        sourceModules: ['accounting-documents'],
        freshnessStatus: 'fresh' as const,
      },
      warnings: [] as string[],
      columns: [{ key: 'documentNumber', label: 'เลขที่เอกสาร', type: 'string' as const }],
      rows: [{ documentNumber: 'INV-AC26' }],
      sourceRefs: [],
      filters: {},
      page: 1,
      pageSize: 5_000,
      total: 1,
      sourcePermissionsUsed: ['accounting.document.read'],
    };
    const adapters = {
      isAvailable: () => true,
      execute: async () => ({ ...page, pageSize: 100 }),
      executeForExport: async () => page,
    } as any;
    const audit = { log: async () => undefined } as any;
    const notify = { execute: async () => undefined } as any;
    const objects = new Map<string, Buffer>();
    const storage = {
      putObject: async (input: { objectKey: string; bytes: Buffer }) => {
        objects.set(input.objectKey, Buffer.from(input.bytes));
        return {
          bucket: 'reports',
          objectKey: input.objectKey,
          objectVersionId: 'ac26-v1',
          storageProvider: 'test',
          byteSize: input.bytes.byteLength,
          checksumSha256: sha256(input.bytes.toString('utf8')),
        };
      },
      getObject: async ({ objectKey }: { objectKey: string }) => ({ bytes: Buffer.from(objects.get(objectKey)!) }),
      deleteObject: async ({ objectKey }: { objectKey: string }) => { objects.delete(objectKey); },
    } as any;
    const ctx: RequestContext = {
      requestId: `ac26-${randomUUID()}`,
      authSubject: adminUserId,
      userId: adminUserId,
      companyId,
      membershipId: `${TAG}-report-member`,
      roles: ['OWNER'],
      permissions: [
        'report.catalog.read',
        'report.dataset.read',
        'report.query.run',
        'report.view.read',
        'report.view.create',
        'report.snapshot.read',
        'report.export',
        'report.export.read_own',
        'accounting.document.read',
      ],
      scopes: {},
      authProvider: 'dev',
    };
    const runQuery = new RunReportQueryUseCase(reportRepo, adapters, audit, reportEntitlement);
    const createView = new CreateReportViewUseCase(reportRepo, adapters, audit, reportEntitlement);
    const createExport = new CreateReportExportUseCase(
      reportRepo,
      runQuery,
      audit,
      notify,
      reportEntitlement,
      storage,
      { enqueue: async () => true } as any,
    );

    const run = await runQuery.execute(ctx, companyId, { datasetCode: 'ar.aging' });
    const view = await createView.execute(ctx, companyId, { datasetCode: 'ar.aging', name: 'AC26 retained view' });
    const exported = await createExport.execute(ctx, companyId, { datasetCode: 'ar.aging', format: 'CSV' });
    const originalBytes = Buffer.from(objects.values().next().value!);
    assert.equal(originalBytes.toString('utf8').startsWith('\uFEFF'), true, 'the exact stored CSV includes its UTF-8 BOM');

    await useCases[0]!.execute(disableReports(`ac26-off-${randomUUID()}`));
    assert.equal(await drainingStateOf(clients[0]! as any, companyId, 'reports'), null, 'empty drain reaches OFF before returning');

    const retainedCtx: RequestContext = {
      ...ctx,
      requestId: `ac26-retained-${randomUUID()}`,
      permissions: [
        'report.view.read',
        'report.snapshot.read',
        'report.export.read_own',
        'accounting.document.read',
      ],
    };
    const retainedRun = await new GetReportRunUseCase(reportRepo, reportEntitlement).execute(retainedCtx, companyId, run.runId);
    const retainedViews = await new ListReportViewsUseCase(reportRepo, reportEntitlement).execute(retainedCtx, companyId);
    const retainedExports = await new ListReportExportsUseCase(reportRepo, reportEntitlement).execute(retainedCtx, companyId);
    const downloaded = await new DownloadReportExportUseCase(reportRepo, audit, reportEntitlement, storage)
      .execute(retainedCtx, companyId, exported.id);
    assert.equal(retainedRun.id, run.runId);
    assert.equal(retainedViews.some((item) => item.id === view.id), true);
    assert.equal(retainedExports.some((item) => item.id === exported.id), true);
    assert.deepEqual(Buffer.from(downloaded.content, 'utf8'), originalBytes, 'OFF download returns byte-identical stored content');

    const countsBeforeDeniedWrites = {
      runs: await clients[0]!.reportRun.count({ where: { companyId } }),
      views: await clients[0]!.reportView.count({ where: { companyId } }),
      exports: await clients[0]!.reportExportRequest.count({ where: { companyId } }),
      drilldowns: await clients[0]!.reportDrilldownAccessLog.count({ where: { companyId } }),
    };
    const offAttempts = [
      () => runQuery.execute(ctx, companyId, { datasetCode: 'ar.aging' }),
      () => createView.execute(ctx, companyId, { datasetCode: 'ar.aging', name: 'must not persist' }),
      () => createExport.execute(ctx, companyId, { datasetCode: 'ar.aging', format: 'CSV' }),
      () => new ReportDrilldownUseCase(reportRepo, reportEntitlement).execute(ctx, companyId, {
        datasetCode: 'ar.aging',
        sourceRef: {
          label: 'AR aging',
          module: 'accounting-documents',
          entityType: 'ar_aging',
          permissionChecked: true,
          webPath: `/companies/${companyId}/accounting`,
        },
      }),
    ];
    for (const attempt of offAttempts) {
      await assert.rejects(attempt, (error: any) => error.getResponse?.().code === 'feature_not_enabled');
    }
    assert.deepEqual({
      runs: await clients[0]!.reportRun.count({ where: { companyId } }),
      views: await clients[0]!.reportView.count({ where: { companyId } }),
      exports: await clients[0]!.reportExportRequest.count({ where: { companyId } }),
      drilldowns: await clients[0]!.reportDrilldownAccessLog.count({ where: { companyId } }),
    }, countsBeforeDeniedWrites, 'OFF attempts create no report roots or access logs');

    const enableCommandId = `ac26-on-${randomUUID()}`;
    await useCases[0]!.execute({
      companyId,
      features: [{ featureKey: 'reports', enabled: true }],
      requestingAdminUserId: adminUserId,
      requestId: enableCommandId,
      commandId: enableCommandId,
      expectedSetVersion: 1,
    });
    const resumed = await runQuery.execute(ctx, companyId, { datasetCode: 'ar.aging' });
    assert.equal(resumed.status, 'READY', 'the same user resumes immediately without migration or new input');
  });

  it('a disable leaves updatedAt moved once (the value changed) and the completion never restamps it', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetToOn();

    await useCases[0]!.execute(disableReports(`stamp-${randomUUID()}`));
    const afterDisable = await clients[0]!.companyFeatureEntitlement.findUniqueOrThrow({
      where: { companyId_featureKey: { companyId, featureKey: 'reports' } },
      select: { updatedAt: true, lastSeq: true, enabled: true },
    });
    assert.equal(afterDisable.enabled, false);
    assert.equal(afterDisable.lastSeq, 3, 'the completion advanced the fence past the request');

    // Re-running the completion must be a pure no-op — no fence move, no timestamp move.
    assert.equal(await completeRunoffIfDrained({ client: clients[0]! } as any, companyId, 'reports'), 'NOT_DRAINING');
    const afterSweep = await clients[0]!.companyFeatureEntitlement.findUniqueOrThrow({
      where: { companyId_featureKey: { companyId, featureKey: 'reports' } },
      select: { updatedAt: true, lastSeq: true },
    });
    assert.equal(afterSweep.updatedAt.getTime(), afterDisable.updatedAt.getTime(), 'byte-identical');
    assert.equal(afterSweep.lastSeq, afterDisable.lastSeq);
  });

  it('disables a matrix-BLOCKED family against the real database and freezes it in place', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetToOn();

    // `inventory` carries 5 BLOCKED matrix rows — refused outright before the owner's 2026-08-04
    // freeze-in-place decision. Now it switches off like any other family.
    await useCases[0]!.execute({
      companyId,
      features: [{ featureKey: 'inventory', enabled: false }],
      requestingAdminUserId: adminUserId,
      requestId: `blocked-${randomUUID()}`,
      commandId: `blocked-${randomUUID()}`,
      expectedSetVersion: 0,
    });

    const row = await clients[0]!.companyFeatureEntitlement.findUniqueOrThrow({
      where: { companyId_featureKey: { companyId, featureKey: 'inventory' } },
      select: { enabled: true },
    });
    assert.equal(row.enabled, false, 'the family really is off');
    // One immutable cutoff record, with nothing in it to run off.
    const snapshot = await clients[0]!.runoffSnapshot.findFirstOrThrow({
      where: { companyId, featureKey: 'inventory' },
      select: { rootsJson: true },
    });
    assert.deepEqual((snapshot.rootsJson as any).roots, []);
    const set = await clients[0]!.companyEntitlementSet.findUniqueOrThrow({ where: { companyId } });
    assert.equal(set.setVersion, 1);
  });
});

/**
 * r19-1 — the LIVE-drain predicate is a cross-table column comparison in RAW SQL, so a fake proves
 * nothing about it. These run it against Postgres.
 */
describe('CC1 runoff paging — live predicate + keyset cursor (real database)', () => {
  let client: PrismaClient;
  let mutatorClient: PrismaClient;
  let pagingCompanyId = '';
  let reachable = false;
  const PAGING_TAG = `runoff-paging-${process.pid}`;

  before(async () => {
    const url = rootDatabaseUrl();
    if (!url) return;
    try {
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      mutatorClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      await client.$queryRaw`SELECT 1`;
      await mutatorClient.$queryRaw`SELECT 1`;
      reachable = true;
    } catch {
      reachable = false;
      return;
    }
    const company = await client.company.create({ data: { name: `${PAGING_TAG}-co`, status: 'ACTIVE' }, select: { id: true } });
    pagingCompanyId = company.id;
  });

  after(async () => {
    if (!reachable) return;
    await client.company.deleteMany({ where: { id: pagingCompanyId } });
    await client.$disconnect();
    await mutatorClient.$disconnect();
  });

  /** One entitlement row plus a DISABLE_REQUESTED transition; `live` decides whether the fence still points at it. */
  async function seedDrain(featureKey: string, opts: {
    live: boolean;
    createdAt: Date;
    root?: { rootType: string; rootId: string; versionOrHash: string };
  }): Promise<void> {
    const seq = 2;
    await client.companyFeatureEntitlement.create({
      data: { companyId: pagingCompanyId, featureKey, enabled: false, epoch: 1, lastSeq: opts.live ? seq : seq + 1 },
    });
    await client.entitlementTransition.create({
      data: {
        companyId: pagingCompanyId,
        featureKey,
        seq,
        epoch: 1,
        commandId: `${PAGING_TAG}:${featureKey}`,
        action: 'DISABLE_REQUESTED',
        actorUserId: 'SYSTEM',
        createdAt: opts.createdAt,
      },
    });
    await client.runoffSnapshot.create({
      data: {
        companyId: pagingCompanyId,
        featureKey,
        disableSeq: seq,
        cutoffAt: opts.createdAt,
        rootsJson: {
          matrixVersion: 'x',
          policyByRootType: opts.root ? { [opts.root.rootType]: 'PRE_CUTOFF_RUNOFF_ONLY' } : {},
          roots: opts.root ? [{ ...opts.root, status: 'OPEN' }] : [],
          openCount: opts.root ? 1 : 0,
        },
      },
    });
    if (!opts.live) {
      // The completed history the old code counted as candidates: an OFF after the request.
      await client.entitlementTransition.create({
        data: {
          companyId: pagingCompanyId,
          featureKey,
          seq: seq + 1,
          epoch: 1,
          commandId: runoffCompletionCommandId(featureKey, seq),
          action: 'OFF',
          actorUserId: 'SYSTEM',
          createdAt: opts.createdAt,
        },
      });
    }
  }

  async function resetPagingCompany(): Promise<void> {
    await client.runoffSnapshot.deleteMany({ where: { companyId: pagingCompanyId } });
    await client.entitlementTransition.deleteMany({ where: { companyId: pagingCompanyId } });
    await client.companyFeatureEntitlement.deleteMany({ where: { companyId: pagingCompanyId } });
  }

  it('finds the ONE live drain behind 200 completed historical requests, on page one', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetPagingCompany();

    // The exact failure r19-1 describes: bounding CANDIDATES and filtering afterwards returned a
    // page of zero live rows, and the sweep re-read that same dead page forever.
    const base = new Date('2026-01-01T00:00:00.000Z');
    for (let index = 0; index < 200; index += 1) {
      await seedDrain(`${PAGING_TAG}.hist${index}`, { live: false, createdAt: new Date(base.getTime() + index * 1000) });
    }
    await seedDrain(`${PAGING_TAG}.live`, { live: true, createdAt: new Date(base.getTime() + 999_000) });

    const page = await listDrainingPage({ client } as any, 200);
    const found = page.lifecycles.filter((row) => row.companyId === pagingCompanyId);
    assert.equal(found.length, 1, 'the live drain is on page ONE, not buried behind 200 dead rows');
    assert.equal(found[0]!.featureKey, `${PAGING_TAG}.live`);
  });

  it('a never-completing drain cannot starve the completable rows behind it', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetPagingCompany();

    // Oldest first, so the STILL_DRAINING row is page one and the completable row is page two.
    const stuckAt = new Date('2026-02-01T00:00:00.000Z');
    const stuckFeature = `${PAGING_TAG}.stuck`;
    const stuckRoot = { rootType: 'test-root', rootId: 'root-1', versionOrHash: 'v1' };
    await seedDrain(stuckFeature, { live: true, createdAt: stuckAt, root: stuckRoot });
    await seedDrain(`${PAGING_TAG}.ready`, { live: true, createdAt: new Date(stuckAt.getTime() + 60_000) });
    const inspectors: RunoffCompletionInspectors = {
      [stuckFeature]: {
        rootTypes: ['test-root'],
        matrixVersions: ['x'],
        inspectCurrent: ({ reader, companyId }) => reader.query(Prisma.sql`
          SELECT ${companyId}::text AS "companyId",
                 ${stuckRoot.rootType}::text AS "rootType",
                 ${stuckRoot.rootId}::text AS "rootId",
                 ${stuckRoot.versionOrHash}::text AS "versionOrHash",
                 false::boolean AS "terminal",
                 true::boolean AS "open"
        `),
      },
    };

    const first = await sweepDrainingLifecycles({ client } as any, 1, undefined, inspectors);
    assert.equal(first.stillDraining, 1, 'page one is the row that will never complete');
    assert.equal(first.completed, 0);
    assert.ok(first.nextCursorId, 'and it hands back a cursor to continue past itself');

    const second = await sweepDrainingLifecycles({ client } as any, 1, first.nextCursorId, inspectors);
    assert.equal(second.completed, 1, 'the row BEHIND it is reachable');

    const off = await client.entitlementTransition.findMany({
      where: { companyId: pagingCompanyId, featureKey: `${PAGING_TAG}.ready`, action: 'OFF' },
    });
    assert.equal(off.length, 1);
    // And the stuck row is still draining — never forced OFF.
    assert.notEqual(await drainingStateOf(client as any, pagingCompanyId, stuckFeature, inspectors), null);
  });

  it('non-empty completion serializes after an in-flight final mutation and never writes OFF early', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetPagingCompany();

    const drainFeature = `${PAGING_TAG}.nonempty-race`;
    const rootFeature = `${PAGING_TAG}.domain-root`;
    const root = { rootType: 'feature-entitlement', rootId: rootFeature, versionOrHash: '1:1' };
    await client.companyFeatureEntitlement.create({
      data: { companyId: pagingCompanyId, featureKey: rootFeature, enabled: true, epoch: 1, lastSeq: 1 },
    });
    await seedDrain(drainFeature, { live: true, createdAt: new Date(), root });
    const inspectors: RunoffCompletionInspectors = {
      [drainFeature]: {
        rootTypes: [root.rootType],
        matrixVersions: ['x'],
        inspectCurrent: ({ reader, companyId, roots }) => reader.query(Prisma.sql`
          SELECT e."companyId"::text AS "companyId",
                 ${root.rootType}::text AS "rootType",
                 e."featureKey"::text AS "rootId",
                 (e."epoch"::text || ':' || e."lastSeq"::text) AS "versionOrHash",
                 (NOT e."enabled")::boolean AS "terminal",
                 e."enabled"::boolean AS "open"
            FROM "CompanyFeatureEntitlement" e
           WHERE e."companyId" = ${companyId}
             AND e."featureKey" IN (${Prisma.join(roots.map((item) => item.rootId))})
        `),
      },
    };

    let mutationReady!: () => void;
    const ready = new Promise<void>((resolve) => { mutationReady = resolve; });
    let releaseMutation!: () => void;
    const release = new Promise<void>((resolve) => { releaseMutation = resolve; });
    t.after(() => releaseMutation());
    const mutation = mutatorClient.$transaction(async (tx) => {
      await tx.$executeRaw(sharedEntitlementLock(pagingCompanyId));
      await tx.companyFeatureEntitlement.update({
        where: { companyId_featureKey: { companyId: pagingCompanyId, featureKey: rootFeature } },
        data: { enabled: false },
      });
      mutationReady();
      await release;
    });
    await ready;

    let completionSettled = false;
    const completion = completeRunoffIfDrained(
      { client } as any,
      pagingCompanyId,
      drainFeature,
      inspectors,
    ).finally(() => { completionSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(completionSettled, false, 'exclusive completion waits behind the shared final-mutation fence');
    assert.equal(await client.entitlementTransition.count({
      where: { companyId: pagingCompanyId, featureKey: drainFeature, action: 'OFF' },
    }), 0, 'OFF is impossible while the final mutation is uncommitted');

    releaseMutation();
    await mutation;
    assert.equal(await completion, 'COMPLETED');
    assert.equal(await client.entitlementTransition.count({
      where: { companyId: pagingCompanyId, featureKey: drainFeature, action: 'OFF' },
    }), 1);
  });

  it('r20-2 — paging continues after the CURSOR ROW ITSELF is deleted', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetPagingCompany();

    // The failure the id-only cursor had: resuming resolved `(createdAt, id)` through
    // `SELECT … WHERE c."id" = $cursor`. Delete that transition and the subquery returns no row,
    // the tuple comparison goes NULL for EVERY candidate, and the page comes back empty — a silent
    // terminal that hides every live drain behind it. The opaque cursor carries both values, so
    // resuming never looks the row up.
    const base = new Date('2026-03-01T00:00:00.000Z');
    await seedDrain(`${PAGING_TAG}.a`, { live: true, createdAt: base });
    await seedDrain(`${PAGING_TAG}.b`, { live: true, createdAt: new Date(base.getTime() + 60_000) });
    await seedDrain(`${PAGING_TAG}.c`, { live: true, createdAt: new Date(base.getTime() + 120_000) });

    const first = await listDrainingPage({ client } as any, 1);
    assert.deepEqual(first.lifecycles.map((row) => row.featureKey), [`${PAGING_TAG}.a`]);
    const cursor = first.nextCursorId!;
    assert.ok(cursor);
    // The cursor keeps working even though nothing can be looked up by its id any more.
    assert.equal(decodeDrainCursor(cursor)!.id, first.lifecycles[0]!.transitionId);

    await client.entitlementTransition.deleteMany({ where: { id: decodeDrainCursor(cursor)!.id } });

    const second = await listDrainingPage({ client } as any, 5, cursor);
    assert.deepEqual(
      second.lifecycles.map((row) => row.featureKey),
      [`${PAGING_TAG}.b`, `${PAGING_TAG}.c`],
      'the drains behind the deleted cursor row are still reachable',
    );
  });

  it('r20-2 — a malformed cursor is rejected, never treated as "start from nowhere"', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await assert.rejects(
      () => listDrainingPage({ client } as any, 5, 'not-a-cursor!!'),
      (error: any) => (error.getResponse() as any).code === 'invalid_runoff_cursor',
    );
  });
});
