/**
 * One-shot UAT A5-CAPACITY-MUTATING v2 evidence harness.
 *
 * `preflight` is SELECT-only. `run` and `cleanup` require the preflight baseline hash and own only
 * one SUSPENDED synthetic company. Output is aggregate-only: no customer identifier or payload.
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/common/database/prisma.service';
import { PrismaWorkflowRepository } from '../src/modules/workflow/infrastructure/prisma-workflow.repository';
import { IngestWorkflowEventUseCase } from '../src/modules/workflow/application/use-cases/workflow-event-ingest.use-case';
import type { RunWorkflowRuleUseCase } from '../src/modules/workflow/application/use-cases/workflow-runner.use-case';
import {
  U5_CAPACITY_LIMITS as LIMITS,
  advisoryLockKeys,
  assertClaimRowsScoped,
  capacityEvidenceHash,
  latencySummary,
  markerCompanyId,
  markerHash,
  parseCapacityBaselineHash,
  parseCapacityConfig,
} from '../src/scripts/a5-capacity-mutating.logic';
import {
  CAPACITY_AGGREGATE_TYPE,
  assertClaimCardinality,
  assertZeroEligibleNonFixture,
  claimProductionShape,
  cleanupCapacityFixture,
  readCapacityBaselineHash,
  readCapacityEstateFingerprint,
  type CapacityClaimRow,
  type CapacityCleanupResult,
  type CapacityEstateFingerprint,
} from '../src/scripts/a5-capacity-mutating.pg';

type ClaimRow = CapacityClaimRow;
type PhaseEvidence = {
  rows: number;
  claimShapes: Array<{
    backlogDepth: number;
    batchSize: number;
    concurrency: number;
    latency: ReturnType<typeof latencySummary>;
  }>;
  processing: {
    rows: number;
    wallMs: number;
    rowsPerSecond: number;
    itemLatency: ReturnType<typeof latencySummary>;
  };
  locks: Array<{ concurrency: number; latency: ReturnType<typeof latencySummary> }>;
  maxConnectionRatio: number;
};

const config = parseCapacityConfig(process.env);
const databaseUrl = process.env['DATABASE_URL'] ?? '';
if (databaseUrl === '') throw new Error('capacity_database_url_missing');
const command = process.argv[2] ?? 'run';
if (command !== 'preflight' && command !== 'run' && command !== 'cleanup') throw new Error('capacity_command_invalid');
const expectedBaselineHash = command === 'preflight' ? null : parseCapacityBaselineHash(process.env);

const companyId = markerCompanyId(config.marker);
const fixtureName = `U5 Capacity Fixture ${config.marker}`;
const startedAt = new Date();
const deadline = startedAt.getTime() + LIMITS.maxWallMs;
let maxConnectionRatio = 0;

function ensureWithinDeadline(): void {
  if (Date.now() >= deadline) throw new Error('capacity_wall_clock_exceeded');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connect(): Promise<Client> {
  const client = new Client({
    connectionString: databaseUrl,
    application_name: `watchdog-u5-capacity-${markerHash(config.marker).slice(0, 12)}`,
  });
  await client.connect();
  await client.query(`SET statement_timeout = '${LIMITS.statementTimeoutMs}ms'`);
  await client.query(`SET lock_timeout = '${LIMITS.lockTimeoutMs}ms'`);
  await client.query(`SET idle_in_transaction_session_timeout = '${LIMITS.idleInTransactionTimeoutMs}ms'`);
  return client;
}

async function withClient<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function connectionRatio(client: Client): Promise<{ used: number; maximum: number; ratio: number }> {
  const result = await client.query<{ used: number; maximum: number }>(`
    SELECT count(*)::int AS used, current_setting('max_connections')::int AS maximum
    FROM pg_stat_activity WHERE datname=current_database()
  `);
  const row = result.rows[0];
  if (!row || Number(row.maximum) <= 0) throw new Error('capacity_connection_measurement_failed');
  const used = Number(row.used);
  const maximum = Number(row.maximum);
  const ratio = used / maximum;
  maxConnectionRatio = Math.max(maxConnectionRatio, ratio);
  if (ratio >= LIMITS.connectionRatioAbort) throw new Error('capacity_connection_threshold_exceeded');
  return { used, maximum, ratio };
}

async function assertCleanStartingState(client: Client): Promise<void> {
  await connectionRatio(client);
  const result = await client.query<{ fixtureRows: number; fixtureCompanies: number; dead: number; stale: number }>(`
    SELECT
      (SELECT count(*)::int FROM "OutboxEvent" WHERE "aggregateType"=$1) AS "fixtureRows",
      (SELECT count(*)::int FROM "Company" WHERE name LIKE 'U5 Capacity Fixture U5C-%') AS "fixtureCompanies",
      (SELECT count(*)::int FROM "OutboxEvent" WHERE status='DEAD') AS dead,
      (SELECT count(*)::int FROM "OutboxEvent"
         WHERE status='PROCESSING' AND "lockedAt" < now()-interval '5 minutes') AS stale
  `, [CAPACITY_AGGREGATE_TYPE]);
  const row = result.rows[0];
  if (!row) throw new Error('capacity_preflight_missing');
  if (Number(row.fixtureRows) !== 0 || Number(row.fixtureCompanies) !== 0) throw new Error('capacity_preexisting_fixture_residue');
  if (Number(row.dead) !== 0 || Number(row.stale) !== 0) throw new Error('capacity_preexisting_outbox_incident');
  await assertZeroEligibleNonFixture(client, companyId, config.marker);
}

async function createFixture(client: Client, phase: string, rows: number): Promise<void> {
  ensureWithinDeadline();
  await client.query('BEGIN');
  try {
    await client.query(`
      INSERT INTO "Company" (id,name,status,timezone,locale,"baseCurrency","businessCategory","createdAt","updatedAt")
      VALUES ($1,$2,'SUSPENDED','Asia/Bangkok','th-TH','THB','OTHER',now(),now())
    `, [companyId, fixtureName]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  for (let base = 0; base < rows; base += LIMITS.seedChunkRows) {
    ensureWithinDeadline();
    const chunkStarted = performance.now();
    const count = Math.min(LIMITS.seedChunkRows, rows - base);
    const values: string[] = [];
    const params: unknown[] = [];
    for (let offset = 0; offset < count; offset++) {
      const seq = base + offset;
      const parameter = params.length;
      values.push(`($${parameter + 1},$${parameter + 2},'capacity.probe',$${parameter + 3},$${parameter + 4},$${parameter + 5},$${parameter + 6}::jsonb,'PENDING','NORMAL',0,now()-($${parameter + 7}::int*interval '1 millisecond'),now(),now())`);
      params.push(
        `u5c-${config.marker}-${phase}-${seq}`,
        companyId,
        CAPACITY_AGGREGATE_TYPE,
        `${phase}-${seq}`,
        `${config.marker}:${phase}:${seq}`,
        JSON.stringify({ occurredAt: new Date().toISOString(), data: { seq, fixture: 'u5-capacity-v2' } }),
        rows - seq,
      );
    }
    await client.query(`
      INSERT INTO "OutboxEvent"
        (id,"companyId","eventType","aggregateType","aggregateId","eventKey","payloadJson",status,priority,attempts,"availableAt","createdAt","updatedAt")
      VALUES ${values.join(',')}
    `, params);
    const remaining = (count / LIMITS.maxSeedRowsPerSecond) * 1_000 - (performance.now() - chunkStarted);
    if (remaining > 0) await sleep(remaining);
  }
  const count = await client.query<{ count: number }>(`
    SELECT count(*)::int AS count FROM "OutboxEvent"
    WHERE "companyId"=$1 AND "aggregateType"=$2 AND "eventKey" LIKE $3
  `, [companyId, CAPACITY_AGGREGATE_TYPE, `${config.marker}:${phase}:%`]);
  if (Number(count.rows[0]?.count) !== rows) throw new Error('capacity_seed_count_mismatch');
}

async function resetDepth(client: Client, phase: string, totalRows: number, depth: number): Promise<void> {
  const result = await client.query(`
    UPDATE "OutboxEvent"
    SET status=CASE WHEN (("payloadJson"->'data'->>'seq')::int < $3)
                    THEN 'PENDING'::"OutboxEventStatus" ELSE 'PUBLISHED'::"OutboxEventStatus" END,
        attempts=0,"lockedAt"=NULL,"lockedBy"=NULL,"claimToken"=NULL,
        "publishedAt"=CASE WHEN (("payloadJson"->'data'->>'seq')::int < $3) THEN NULL ELSE now() END,
        "lastError"=NULL,"updatedAt"=now()
    WHERE "companyId"=$1 AND "aggregateType"=$4 AND "eventKey" LIKE $2
  `, [companyId, `${config.marker}:${phase}:%`, depth, CAPACITY_AGGREGATE_TYPE]);
  if (result.rowCount !== totalRows) throw new Error('capacity_reset_scope_mismatch');
}

async function assertPendingDepth(client: Client, phase: string, expected: number): Promise<void> {
  const result = await client.query<{ count: number }>(`
    SELECT count(*)::int AS count FROM "OutboxEvent"
    WHERE "companyId"=$1 AND "aggregateType"=$2 AND "eventKey" LIKE $3 AND status='PENDING'
  `, [companyId, CAPACITY_AGGREGATE_TYPE, `${config.marker}:${phase}:%`]);
  if (Number(result.rows[0]?.count ?? -1) !== expected) throw new Error('capacity_pending_cardinality_mismatch');
}

async function claim(client: Client, batchSize: number, claimer: string): Promise<{ rows: ClaimRow[]; latencyMs: number }> {
  const start = performance.now();
  const rows = await claimProductionShape(client, { companyId, marker: config.marker, batchSize, claimer });
  assertClaimRowsScoped(rows, companyId, config.marker);
  if (rows.some((row) => !row.claimToken)) throw new Error('capacity_claim_token_missing');
  return { rows, latencyMs: performance.now() - start };
}

async function restoreClaims(client: Client, rows: ClaimRow[]): Promise<void> {
  if (rows.length === 0) return;
  const result = await client.query(`
    UPDATE "OutboxEvent" o
    SET status='PENDING',"lockedAt"=NULL,"lockedBy"=NULL,"claimToken"=NULL,"updatedAt"=now()
    FROM unnest($1::text[],$2::text[]) AS claimed(id,token)
    WHERE o.id=claimed.id AND o."claimToken"=claimed.token AND o."companyId"=$3
      AND o."aggregateType"=$4 AND o."eventKey" LIKE $5
  `, [rows.map((row) => row.id), rows.map((row) => row.claimToken), companyId, CAPACITY_AGGREGATE_TYPE, `${config.marker}:%`]);
  if (result.rowCount !== rows.length) throw new Error('capacity_restore_claim_cas_failed');
}

function assertDistinctClaims(rows: ClaimRow[]): void {
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('capacity_duplicate_claim_detected');
}

async function sampleClaims(client: Client, phase: string, totalRows: number): Promise<PhaseEvidence['claimShapes']> {
  const output: PhaseEvidence['claimShapes'] = [];
  for (const depth of LIMITS.backlogDepths.filter((candidate) => candidate <= totalRows)) {
    for (const batchSize of LIMITS.claimBatchSizes) {
      for (const concurrency of LIMITS.claimConcurrencies) {
        ensureWithinDeadline();
        await resetDepth(client, phase, totalRows, depth);
        const clients = await Promise.all(Array.from({ length: concurrency }, () => connect()));
        await connectionRatio(client);
        const latencies: number[] = [];
        try {
          for (let sample = 0; sample < LIMITS.samplesPerDepthAndShape; sample++) {
            ensureWithinDeadline();
            await assertZeroEligibleNonFixture(client, companyId, config.marker);
            const claimed = await Promise.all(clients.map((worker, index) => claim(worker, batchSize, `u5c-sample-${index}`)));
            const rows = claimed.flatMap((item) => item.rows);
            assertDistinctClaims(rows);
            assertClaimCardinality(rows.length, Math.min(depth, batchSize * concurrency));
            latencies.push(...claimed.map((item) => item.latencyMs));
            await restoreClaims(client, rows);
            await assertPendingDepth(client, phase, depth);
            await connectionRatio(client);
          }
        } finally {
          await Promise.all(clients.map((worker) => worker.end()));
        }
        const latency = latencySummary(latencies);
        if (latency.p95Ms > LIMITS.claimP95AbortMs) throw new Error('capacity_claim_p95_threshold_exceeded');
        output.push({ backlogDepth: depth, batchSize, concurrency, latency });
      }
    }
  }
  return output;
}

async function createWorkflowIngest(): Promise<{ ingest: IngestWorkflowEventUseCase; prisma: PrismaClient }> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      statement_timeout: LIMITS.statementTimeoutMs,
      lock_timeout: LIMITS.lockTimeoutMs,
      idle_in_transaction_session_timeout: LIMITS.idleInTransactionTimeoutMs,
    }),
  });
  await prisma.$connect();
  const repository = new PrismaWorkflowRepository({ client: prisma } as unknown as PrismaService);
  const unreachableRunner = {
    execute: async () => { throw new Error('capacity_fixture_must_have_no_workflow_rule'); },
  } as unknown as RunWorkflowRuleUseCase;
  return { ingest: new IngestWorkflowEventUseCase(repository, unreachableRunner), prisma };
}

async function completePublished(client: Client, row: ClaimRow): Promise<void> {
  const result = await client.query(`
    UPDATE "OutboxEvent" SET status='PUBLISHED',"publishedAt"=now(),"lockedAt"=NULL,"lockedBy"=NULL,
      "claimToken"=NULL,"updatedAt"=now()
    WHERE id=$1 AND "companyId"=$2 AND "aggregateType"=$3 AND "eventKey" LIKE $4
      AND status='PROCESSING' AND "claimToken"=$5
  `, [row.id, companyId, CAPACITY_AGGREGATE_TYPE, `${config.marker}:%`, row.claimToken]);
  if (result.rowCount !== 1) throw new Error('capacity_publish_cas_failed');
}

async function processFixture(client: Client, phase: string, totalRows: number): Promise<PhaseEvidence['processing']> {
  await resetDepth(client, phase, totalRows, totalRows);
  const { ingest, prisma } = await createWorkflowIngest();
  const clients = await Promise.all(Array.from({ length: LIMITS.processingConcurrency }, () => connect()));
  await connectionRatio(client);
  const observedIds = new Set<string>();
  const itemLatencies: number[] = [];
  const started = performance.now();
  try {
    while (observedIds.size < totalRows) {
      ensureWithinDeadline();
      await assertZeroEligibleNonFixture(client, companyId, config.marker);
      const remaining = totalRows - observedIds.size;
      const claimed = await Promise.all(clients.map((worker, index) => claim(worker, 25, `u5c-process-${index}`)));
      const rows = claimed.flatMap((item) => item.rows);
      assertDistinctClaims(rows);
      assertClaimCardinality(rows.length, Math.min(remaining, 25 * LIMITS.processingConcurrency));
      await Promise.all(claimed.map(async (grant, index) => {
        const worker = clients[index]!;
        for (const row of grant.rows) {
          const itemStarted = performance.now();
          if (observedIds.has(row.id)) throw new Error('capacity_duplicate_claim_detected');
          observedIds.add(row.id);
          await ingest.execute({
            eventId: row.id,
            eventType: row.eventType,
            companyId,
            sourceModule: 'capacity',
            sourceType: row.aggregateType,
            sourceId: row.aggregateId,
            occurredAt: row.payloadJson.occurredAt ?? row.createdAt.toISOString(),
            dedupKey: row.eventKey,
            payload: row.payloadJson.data ?? {},
            schemaVersion: 1,
          });
          await completePublished(worker, row);
          itemLatencies.push(performance.now() - itemStarted);
        }
      }));
      await connectionRatio(client);
    }
  } finally {
    await Promise.all(clients.map((worker) => worker.end()));
    await prisma.$disconnect();
  }
  assertClaimCardinality(observedIds.size, totalRows);
  const wallMs = performance.now() - started;
  return {
    rows: observedIds.size,
    wallMs: Math.round(wallMs * 100) / 100,
    rowsPerSecond: Math.round((observedIds.size / wallMs) * 100_000) / 100,
    itemLatency: latencySummary(itemLatencies),
  };
}

async function lockEvidence(client: Client): Promise<PhaseEvidence['locks']> {
  const [key1, key2] = advisoryLockKeys(config.marker);
  const output: PhaseEvidence['locks'] = [];
  for (const concurrency of LIMITS.lockConcurrencies) {
    ensureWithinDeadline();
    const clients = await Promise.all(Array.from({ length: concurrency }, () => connect()));
    await connectionRatio(client);
    const waits: number[] = [];
    try {
      await Promise.all(clients.map(async (worker) => {
        for (let iteration = 0; iteration < LIMITS.lockIterations; iteration++) {
          ensureWithinDeadline();
          await worker.query('BEGIN');
          try {
            const started = performance.now();
            await worker.query('SELECT pg_advisory_xact_lock($1,$2)', [key1, key2]);
            waits.push(performance.now() - started);
            await sleep(LIMITS.lockHoldMs);
            await worker.query('COMMIT');
          } catch (error) {
            await worker.query('ROLLBACK');
            throw error;
          }
        }
      }));
      await connectionRatio(client);
    } finally {
      await Promise.all(clients.map((worker) => worker.end()));
    }
    const latency = latencySummary(waits);
    assertClaimCardinality(latency.count, concurrency * LIMITS.lockIterations);
    if (latency.p95Ms > LIMITS.lockP95AbortMs) throw new Error('capacity_lock_p95_threshold_exceeded');
    output.push({ concurrency, latency });
  }
  return output;
}

async function runPhase(client: Client, phase: 'smoke' | 'full', rows: number): Promise<PhaseEvidence> {
  await createFixture(client, phase, rows);
  const claimShapes = await sampleClaims(client, phase, rows);
  const locks = phase === 'full' ? await lockEvidence(client) : [];
  const processing = await processFixture(client, phase, rows);
  return { rows, claimShapes, processing, locks, maxConnectionRatio };
}

function safeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{3,100}$/.test(value) ? value : 'capacity_unknown_failure';
}

async function preflight(): Promise<void> {
  const result = await withClient(async (client) => {
    await assertCleanStartingState(client);
    const connections = await connectionRatio(client);
    const baseline = await readCapacityEstateFingerprint(client, companyId, config.marker);
    const baselineHash = await readCapacityBaselineHash(client, companyId, config.marker);
    return { baseline, baselineHash, maxConnections: connections.maximum, connectionRatio: connections.ratio };
  });
  process.stdout.write(`${JSON.stringify({
    artifact: 'a5-capacity-preflight-v2', targetEnvironment: config.environment,
    sourceCommit: config.sourceCommit, markerHash: markerHash(config.marker), clean: true, ...result,
  })}\n`);
}

async function cleanupOnly(): Promise<void> {
  const result = await withClient((client) => cleanupCapacityFixture(client, {
    companyId, marker: config.marker, fixtureName, expectedBaselineHash: expectedBaselineHash!,
  }));
  process.stdout.write(`${JSON.stringify({
    artifact: 'a5-capacity-cleanup-v2', markerHash: markerHash(config.marker),
    expectedBaselineHash, ...result,
  })}\n`);
  if (!result.cleanupVerified) process.exitCode = 78;
}

async function run(): Promise<void> {
  let baseline: CapacityEstateFingerprint | null = null;
  let smoke: PhaseEvidence | null = null;
  let smokeCleanupResult: CapacityCleanupResult | null = null;
  let full: PhaseEvidence | null = null;
  let cleanupResult: CapacityCleanupResult | null = null;
  let failureCode: string | null = null;

  await withClient(async (client) => {
    await assertCleanStartingState(client);
    baseline = await readCapacityEstateFingerprint(client, companyId, config.marker);
    if (await readCapacityBaselineHash(client, companyId, config.marker) !== expectedBaselineHash) {
      throw new Error('capacity_preflight_baseline_moved');
    }
    try {
      smoke = await runPhase(client, 'smoke', LIMITS.smokeRows);
      smokeCleanupResult = await cleanupCapacityFixture(client, {
        companyId, marker: config.marker, fixtureName, expectedBaselineHash: expectedBaselineHash!,
      });
      if (!smokeCleanupResult.cleanupVerified || smokeCleanupResult.outboxRows !== LIMITS.smokeRows
        || smokeCleanupResult.inboxRows !== LIMITS.smokeRows || smokeCleanupResult.companies !== 1) {
        throw new Error('capacity_smoke_cleanup_mismatch');
      }
      full = await runPhase(client, 'full', LIMITS.fullRows);
    } catch (error) {
      failureCode = safeErrorCode(error);
    } finally {
      try {
        cleanupResult = await cleanupCapacityFixture(client, {
          companyId, marker: config.marker, fixtureName, expectedBaselineHash: expectedBaselineHash!,
        });
        if (!cleanupResult.cleanupVerified && failureCode === null) failureCode = 'capacity_cleanup_or_baseline_mismatch';
      } catch (error) {
        cleanupResult = null;
        if (failureCode === null) failureCode = safeErrorCode(error);
      }
    }
  });

  const completedAt = new Date();
  const elapsedMs = completedAt.getTime() - startedAt.getTime();
  if (elapsedMs > LIMITS.maxWallMs && failureCode === null) failureCode = 'capacity_wall_clock_exceeded';
  const cleanupVerified = cleanupResult?.cleanupVerified === true;
  const passed = failureCode === null && cleanupVerified && smoke !== null && full !== null
    && elapsedMs <= LIMITS.maxWallMs;
  const evidenceWithoutHash = {
    artifact: 'a5-capacity-mutating-v2', targetEnvironment: config.environment,
    sourceCommit: config.sourceCommit, markerHash: markerHash(config.marker),
    approvalRefHash: createHash('sha256').update(config.approvalRef).digest('hex'),
    expectedBaselineHash, startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(),
    elapsedMs, limits: LIMITS, baseline, smoke, smokeCleanup: smokeCleanupResult,
    full, cleanup: cleanupResult,
    cleanupVerified, failureCode, passed,
  };
  const evidenceHash = capacityEvidenceHash(evidenceWithoutHash);
  process.stdout.write(`${JSON.stringify({ ...evidenceWithoutHash, evidenceHash })}\n`);
  if (!cleanupVerified) process.exitCode = 78;
  else if (!passed) process.exitCode = 1;
}

async function main(): Promise<void> {
  if (command === 'preflight') return preflight();
  if (command === 'cleanup') return cleanupOnly();
  return run();
}

main().catch((error) => {
  process.stderr.write(`A5-CAPACITY-MUTATING failed: ${safeErrorCode(error)}\n`);
  process.exitCode = 78;
});
