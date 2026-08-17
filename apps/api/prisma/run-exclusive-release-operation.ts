/**
 * Durable fence for release/F2/retirement tasks.
 *
 * The PostgreSQL session advisory lock prevents concurrent mutating operations; short release-bind
 * metadata appends serialize on the parent row so parallel service waves remain possible.
 * RemoteReleaseOperation keeps unresolved state and exact ECS identity after GitHub/Fargate
 * disappears. A stale RUNNING row becomes UNKNOWN; neither permits another writer until audited.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const LOCK_KEY = 'watchdog-bms:release-writer';
const MIGRATION = join(__dirname, 'migrations/20260804130000_remote_release_operation_lease/migration.sql');
const LEASE_SECONDS = 60;
const ROLLOUT_HOLD_SECONDS = 90 * 60;
const HEARTBEAT_MS = 15_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Environment = 'uat' | 'production';
type TerminalStatus = 'SUCCEEDED' | 'FAILED_CONFIRMED';
type ReconciledStatus = 'RECONCILED_SUCCEEDED' | 'RECONCILED_FAILED_CONFIRMED';

type ControllerProvenance = {
  sourceBranch: string;
  controllerKind: 'GITHUB_ACTIONS' | 'MANUAL';
  githubRunId: string | null;
  githubRunAttempt: number | null;
  githubActor: string | null;
  githubActorId: string | null;
  githubWorkflowRef: string | null;
  githubRepository: string | null;
  manualActorRef: string | null;
};

type UnresolvedRow = {
  id: string;
  status: 'RUNNING' | 'UNKNOWN';
  ecsTaskArn: string;
  leaseExpired: boolean;
};

type ReconcileRow = {
  id: string;
  status: string;
  ecsTaskArn: string;
  serviceDeploymentArn: string | null;
  leaseExpired: boolean;
  reconciledByActorRef: string | null;
  reconciliationEvidenceRef: string | null;
  reconciliationReason: string | null;
  releaseDeployTarget: string | null;
  preIntentApiCleanupCompletedAt: Date | null;
};

type StoppedParentTaskEvidence = {
  taskArn: string;
  taskDefinitionArn: string;
  lastStatus: 'STOPPED';
  desiredStatus: 'STOPPED';
  stoppedAt: string;
  stopCode: string | null;
  stoppedReason: string | null;
  startedBy: string;
  group: string;
};

type ExactRecoveryHoldContext = {
  buildReleaseId: string;
  recovererTaskArn: string;
  controller: ControllerProvenance;
  stoppedParentTaskEvidence: StoppedParentTaskEvidence | null;
};

type ParentOperationRow = ControllerProvenance & {
  id: string;
  status: 'RUNNING' | 'UNKNOWN';
  mode: string;
  releaseDeployTarget: string | null;
  buildReleaseId: string;
  ecsTaskArn: string;
  leaseOwner: string;
  leaseExpired: boolean;
  deploymentManifestJson: unknown;
  preIntentApiCleanupCompletedAt: Date | null;
  preIntentApiCleanupEvidenceJson: unknown;
};

export class RemoteReleaseOperationBlocked extends Error {
  readonly exitCode = 75;
}

class RemoteReleaseOperationExpired extends RemoteReleaseOperationBlocked {}

export class RemoteReleaseOperationInterrupted extends Error {}

export type BeginRemoteReleaseOperation = {
  id: string;
  targetEnvironment: Environment;
  mode: string;
  releaseDeployTarget: string | null;
  buildReleaseId: string;
  ecsTaskArn: string;
  ecsServiceArn: string | null;
  serviceDeploymentArn: string | null;
  targetServiceRevisionArn: string | null;
  activeBuilds: readonly string[] | null;
  deploymentManifest: readonly DeploymentEvidence[] | null;
  sourceBranch: string;
  controllerKind: 'GITHUB_ACTIONS' | 'MANUAL';
  githubRunId: string | null;
  githubRunAttempt: number | null;
  githubActor: string | null;
  githubActorId: string | null;
  githubWorkflowRef: string | null;
  githubRepository: string | null;
  manualActorRef: string | null;
  leaseSeconds?: number;
};

type DeploymentEvidence = {
  service: string;
  serviceArn: string;
  deploymentArn: string | null;
  targetRevisionArn: string;
  sourceSha: string;
  noOp: boolean;
};

type BootstrapClosedRecoveryService = DeploymentEvidence & {
  deploymentArn: string;
  image: string;
  maintenanceControls: Record<string, string>;
};

type BootstrapClosedRecoveryEvidence = {
  schemaVersion: 2;
  artifactDigest: string;
  maintenanceProofSha256: string;
  failedPromotionRunId: string;
  failedPromotionRunAttempt: number;
  controllerCommit: string;
  sourceCommit: string;
  operationId: string;
  parentTaskArn: string;
  manifestSha256: string;
  services: BootstrapClosedRecoveryService[];
  boundHistory: DeploymentEvidence[];
};

type MutationIntent = {
  id: string;
  serviceKey: 'api-web' | 'ai-gateway' | 'workers';
  mutationKind: 'CREATE' | 'UPDATE';
  expectedServiceArn: string;
  clusterName: string;
  serviceName: string;
  ssmParameterName: string;
  requestHash: string;
  desiredConfigHash: string;
  beforeDeploymentArns: string[];
  beforeCurrentDeploymentArn: string | null;
  beforeActiveConfigurations: unknown[];
  legacyBootstrapDescriptor: Record<string, unknown> | null;
};

type MutationIntentRow = {
  id: string;
  operationId: string;
  targetEnvironment: string;
  buildReleaseId: string;
  serviceKey: string;
  mutationKind: string;
  expectedServiceArn: string;
  clusterName: string;
  serviceName: string;
  ssmParameterName: string;
  requestHash: string;
  desiredConfigHash: string;
  beforeDeploymentArnsJson: unknown;
  beforeCurrentDeploymentArn: string | null;
  beforeActiveConfigurationsJson: unknown;
  legacyBootstrapDescriptorJson: unknown;
  status: 'OPEN' | 'BOUND' | 'CONFIRMED_NO_MUTATION';
  evidenceJson: unknown;
  requestStartedAt: Date;
  requestDeadlineAt: Date;
  legacyRollbackObservedAt: Date | null;
  legacyRollbackCleanedAt: Date | null;
  legacyCutoverCompletedAt: Date | null;
  failedBuildCleanupRequiredAt: Date | null;
  failedBuildCleanupCompletedAt: Date | null;
};

export type ReconcileRemoteReleaseOperation = {
  id: string;
  targetEnvironment: Environment;
  originalTaskArn: string;
  reconcilerTaskArn: string;
  actorRef: string;
  evidenceRef: string;
  reason: string;
  outcome: TerminalStatus;
  controller: ControllerProvenance;
};

/** First-deploy bootstrap: this wrapper must exist before it can run `prisma migrate deploy`. */
export async function ensureRemoteReleaseOperationSchema(client: Client): Promise<void> {
  await client.query(readFileSync(MIGRATION, 'utf8'));
}

export async function acquireRemoteWriterFence(client: Client): Promise<boolean> {
  const result = await client.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
    [LOCK_KEY],
  );
  return result.rows[0]?.acquired === true;
}

export async function releaseRemoteWriterFence(client: Client): Promise<void> {
  await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
}

export async function beginRemoteReleaseOperation(
  client: Client,
  input: BeginRemoteReleaseOperation,
): Promise<void> {
  const releaseTargets = ['all', 'api-web', 'ai-gateway', 'workers'];
  if ((input.mode === 'release' && !releaseTargets.includes(input.releaseDeployTarget ?? ''))
    || (input.mode !== 'release' && input.releaseDeployTarget !== null)) {
    throw new Error('releaseDeployTarget must be an exact release target and is forbidden for non-release operations');
  }
  const leaseSeconds = input.leaseSeconds ?? LEASE_SECONDS;
  let transactionOpen = true;
  await client.query('BEGIN');
  try {
    const existing = await client.query<UnresolvedRow>(`
      SELECT "id", "status", "ecsTaskArn", ("leaseExpiresAt" <= CURRENT_TIMESTAMP) AS "leaseExpired"
        FROM "RemoteReleaseOperation"
       WHERE "targetEnvironment" = $1
         AND "status" IN ('RUNNING', 'UNKNOWN')
       ORDER BY "createdAt" DESC
       LIMIT 1
       FOR UPDATE
    `, [input.targetEnvironment]);
    const row = existing.rows[0];
    if (row?.status === 'UNKNOWN') {
      throw new RemoteReleaseOperationBlocked(
        `release operation blocked by UNKNOWN ${row.id} (${row.ecsTaskArn}); reconcile that exact task first`,
      );
    }
    if (row?.status === 'RUNNING') {
      if (row.leaseExpired) {
        await client.query(`
          UPDATE "RemoteReleaseOperation"
             SET "status" = 'UNKNOWN',
                 "unknownAt" = CURRENT_TIMESTAMP,
                 "outcomeReason" = 'heartbeat lease expired before a terminal outcome',
                 "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $1 AND "status" = 'RUNNING'
        `, [row.id]);
        await client.query('COMMIT');
        transactionOpen = false;
        throw new RemoteReleaseOperationBlocked(
          `release operation ${row.id} became UNKNOWN after its heartbeat expired; reconcile ${row.ecsTaskArn}`,
        );
      }
      throw new RemoteReleaseOperationBlocked(
        `release operation ${row.id} is still RUNNING for ${input.targetEnvironment} (${row.ecsTaskArn})`,
      );
    }

    await client.query(`
      INSERT INTO "RemoteReleaseOperation" (
        "id", "targetEnvironment", "mode", "releaseDeployTarget", "buildReleaseId", "ecsTaskArn",
        "ecsServiceArn", "serviceDeploymentArn", "targetServiceRevisionArn", "activeBuildsJson",
        "deploymentManifestJson",
        "sourceBranch", "controllerKind", "githubRunId", "githubRunAttempt", "githubActor",
        "githubActorId", "githubWorkflowRef", "githubRepository", "manualActorRef",
        "status", "leaseOwner", "heartbeatAt", "leaseExpiresAt",
        "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16,
                $17, $18, $19, $20, 'RUNNING', $6, CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP + make_interval(secs => $21), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      input.id,
      input.targetEnvironment,
      input.mode,
      input.releaseDeployTarget,
      input.buildReleaseId,
      input.ecsTaskArn,
      input.ecsServiceArn,
      input.serviceDeploymentArn,
      input.targetServiceRevisionArn,
      input.activeBuilds ? JSON.stringify(input.activeBuilds) : null,
      input.deploymentManifest ? JSON.stringify(input.deploymentManifest) : null,
      input.sourceBranch,
      input.controllerKind,
      input.githubRunId,
      input.githubRunAttempt,
      input.githubActor,
      input.githubActorId,
      input.githubWorkflowRef,
      input.githubRepository,
      input.manualActorRef,
      leaseSeconds,
    ]);
    await client.query('COMMIT');
    transactionOpen = false;
  } catch (error: any) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    if (error?.code === '23505') {
      throw new RemoteReleaseOperationBlocked(
        `another unresolved release operation already owns ${input.targetEnvironment}`,
      );
    }
    throw error;
  }
}

export async function heartbeatRemoteReleaseOperation(
  client: Client,
  id: string,
  ecsTaskArn: string,
  leaseSeconds = LEASE_SECONDS,
): Promise<void> {
  const result = await client.query(`
    UPDATE "RemoteReleaseOperation"
       SET "heartbeatAt" = CURRENT_TIMESTAMP,
           "leaseExpiresAt" = CURRENT_TIMESTAMP + make_interval(secs => $3),
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "status" = 'RUNNING' AND "leaseOwner" = $2
  `, [id, ecsTaskArn, leaseSeconds]);
  if (result.rowCount !== 1) {
    throw new RemoteReleaseOperationBlocked(`release operation ${id} lost its durable lease`);
  }
}

export async function holdRemoteReleaseOperation(
  client: Client,
  id: string,
  ecsTaskArn: string,
): Promise<void> {
  const result = await client.query(`
    UPDATE "RemoteReleaseOperation"
       SET "heartbeatAt" = CURRENT_TIMESTAMP,
           "leaseExpiresAt" = CURRENT_TIMESTAMP + make_interval(secs => $3),
           "outcomeReason" = 'pre-deploy release task succeeded; awaiting exact rollout binding and finalization',
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "status" = 'RUNNING' AND "leaseOwner" = $2 AND "mode" = 'release'
  `, [id, ecsTaskArn, ROLLOUT_HOLD_SECONDS]);
  if (result.rowCount !== 1) throw new RemoteReleaseOperationBlocked(`release operation ${id} could not enter rollout hold`);
}

function sameController(row: ParentOperationRow, controller: ControllerProvenance): boolean {
  return row.sourceBranch === controller.sourceBranch
    && row.controllerKind === controller.controllerKind
    && row.githubRunId === controller.githubRunId
    && row.githubRunAttempt === controller.githubRunAttempt
    && row.githubActor === controller.githubActor
    && row.githubActorId === controller.githubActorId
    && row.githubWorkflowRef === controller.githubWorkflowRef
    && row.githubRepository === controller.githubRepository
    && row.manualActorRef === controller.manualActorRef;
}

function sameEvidence(left: DeploymentEvidence, right: DeploymentEvidence): boolean {
  return left.service === right.service
    && left.serviceArn === right.serviceArn
    && left.deploymentArn === right.deploymentArn
    && left.targetRevisionArn === right.targetRevisionArn
    && left.sourceSha === right.sourceSha
    && left.noOp === right.noOp;
}

function compareDeploymentEvidence(left: DeploymentEvidence, right: DeploymentEvidence): number {
  const leftKey = [left.service, left.deploymentArn ?? '', left.targetRevisionArn];
  const rightKey = [right.service, right.deploymentArn ?? '', right.targetRevisionArn];
  for (let index = 0; index < leftKey.length; index += 1) {
    if (leftKey[index]! < rightKey[index]!) return -1;
    if (leftKey[index]! > rightKey[index]!) return 1;
  }
  return 0;
}

function expectedReleaseServices(target: string | null): string[] {
  if (target === 'all') return ['ai-gateway', 'api-web', 'workers'];
  if (target === 'api-web' || target === 'ai-gateway' || target === 'workers') return [target];
  return [];
}

async function hasCompleteReleaseServiceCoverage(
  client: Client,
  operationId: string,
  releaseDeployTarget: string | null,
  preIntentApiCleanupCompletedAt: Date | null,
): Promise<boolean> {
  const expected = expectedReleaseServices(releaseDeployTarget);
  if (expected.length === 0) return false;
  const result = await client.query<{ serviceKey: string }>(`
    SELECT DISTINCT "serviceKey" FROM "RemoteReleaseMutationIntent" WHERE "operationId" = $1
  `, [operationId]);
  const observed = result.rows.map((row) => row.serviceKey);
  if (preIntentApiCleanupCompletedAt !== null && !observed.includes('api-web')) observed.push('api-web');
  return canonicalJson([...new Set(observed)].sort()) === canonicalJson(expected);
}

async function hasRecoveredPartialAllTargetCoverage(
  client: Client,
  operationId: string,
  releaseDeployTarget: string | null,
): Promise<boolean> {
  if (releaseDeployTarget !== 'all') return false;
  const expected = new Set(expectedReleaseServices(releaseDeployTarget));
  const result = await client.query<{ serviceKey: string; recovererControllerJson: unknown }>(`
    SELECT "serviceKey", "recovererControllerJson"
      FROM "RemoteReleaseMutationIntent"
     WHERE "operationId" = $1
  `, [operationId]);
  if (result.rows.length === 0) return false;
  const observed = new Set(result.rows.map((row) => row.serviceKey));
  return observed.size < expected.size
    && [...observed].every((service) => expected.has(service))
    && result.rows.every((row) => row.recovererControllerJson !== null);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameIntent(row: MutationIntentRow, input: MutationIntent): boolean {
  return row.id === input.id
    && row.serviceKey === input.serviceKey
    && row.mutationKind === input.mutationKind
    && row.expectedServiceArn === input.expectedServiceArn
    && row.clusterName === input.clusterName
    && row.serviceName === input.serviceName
    && row.ssmParameterName === input.ssmParameterName
    && row.requestHash === input.requestHash
    && row.desiredConfigHash === input.desiredConfigHash
    && row.beforeCurrentDeploymentArn === input.beforeCurrentDeploymentArn
    && canonicalJson(row.beforeDeploymentArnsJson) === canonicalJson(input.beforeDeploymentArns)
    && canonicalJson(row.beforeActiveConfigurationsJson) === canonicalJson(input.beforeActiveConfigurations)
    && canonicalJson(row.legacyBootstrapDescriptorJson) === canonicalJson(input.legacyBootstrapDescriptor);
}

export async function prepareRemoteReleaseMutationIntent(
  client: Client,
  input: {
    operationId: string; targetEnvironment: Environment; buildReleaseId: string;
    preparerTaskArn: string; controller: ControllerProvenance; intent: MutationIntent;
  },
): Promise<{ replay: boolean }> {
  await client.query('BEGIN');
  try {
    const parent = await parentForUpdate(client, input.operationId, input.targetEnvironment);
    if (parent.mode !== 'release' || parent.buildReleaseId !== input.buildReleaseId
      || !sameController(parent, input.controller) || parent.leaseOwner !== parent.ecsTaskArn) {
      throw new RemoteReleaseOperationBlocked('mutation intent does not belong to the exact held release/controller');
    }
    if (parent.releaseDeployTarget !== 'all' && parent.releaseDeployTarget !== input.intent.serviceKey) {
      throw new RemoteReleaseOperationBlocked(
        `held release target ${parent.releaseDeployTarget ?? 'missing'} does not authorize ${input.intent.serviceKey}`,
      );
    }
    if (input.intent.serviceKey !== 'api-web' && input.intent.legacyBootstrapDescriptor !== null) {
      throw new RemoteReleaseOperationBlocked('legacy bootstrap evidence is valid only for api-web');
    }
    const existing = await client.query<MutationIntentRow>(`
      SELECT * FROM "RemoteReleaseMutationIntent" WHERE "id" = $1 FOR UPDATE
    `, [input.intent.id]);
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.operationId === input.operationId && row.targetEnvironment === input.targetEnvironment
        && row.buildReleaseId === input.buildReleaseId && row.status === 'OPEN'
        && sameIntent(row, input.intent)) {
        await client.query('COMMIT');
        return { replay: true };
      }
      throw new RemoteReleaseOperationBlocked('mutation intent UUID was already used for different or closed evidence');
    }
    if (input.intent.legacyBootstrapDescriptor !== null) {
      const legacyHistory = await client.query<{
        legacyBootstrapDescriptorJson: unknown; legacyCutoverCompletedAt: Date | null;
      }>(`
        SELECT "legacyBootstrapDescriptorJson", "legacyCutoverCompletedAt"
          FROM "RemoteReleaseMutationIntent"
         WHERE "targetEnvironment" = $1 AND "serviceKey" = 'api-web'
           AND "legacyBootstrapDescriptorJson" IS NOT NULL
         ORDER BY "createdAt" ASC
         FOR UPDATE
      `, [input.targetEnvironment]);
      if (legacyHistory.rows.some((item) => item.legacyCutoverCompletedAt !== null)) {
        throw new RemoteReleaseOperationBlocked('legacy api-web descriptor reappeared after first-cutover completed');
      }
      if (legacyHistory.rows.some((item) => canonicalJson(item.legacyBootstrapDescriptorJson)
        !== canonicalJson(input.intent.legacyBootstrapDescriptor))) {
        throw new RemoteReleaseOperationBlocked('legacy api-web descriptor changed between exact cutover retries');
      }
    }
    await client.query(`
      INSERT INTO "RemoteReleaseMutationIntent" (
        "id", "operationId", "targetEnvironment", "buildReleaseId", "serviceKey",
        "mutationKind", "expectedServiceArn", "clusterName", "serviceName", "ssmParameterName", "requestHash",
        "desiredConfigHash", "beforeDeploymentArnsJson", "beforeCurrentDeploymentArn",
        "beforeActiveConfigurationsJson", "legacyBootstrapDescriptorJson", "preparedByTaskArn",
        "status", "requestStartedAt", "requestDeadlineAt", "createdAt", "updatedAt"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb,$16::jsonb,$17,
                'OPEN',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + INTERVAL '10 minutes',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `, [
      input.intent.id, input.operationId, input.targetEnvironment, input.buildReleaseId,
      input.intent.serviceKey, input.intent.mutationKind, input.intent.expectedServiceArn,
      input.intent.clusterName, input.intent.serviceName, input.intent.ssmParameterName, input.intent.requestHash,
      input.intent.desiredConfigHash, JSON.stringify(input.intent.beforeDeploymentArns),
      input.intent.beforeCurrentDeploymentArn, JSON.stringify(input.intent.beforeActiveConfigurations),
      input.intent.legacyBootstrapDescriptor === null ? null : JSON.stringify(input.intent.legacyBootstrapDescriptor),
      input.preparerTaskArn,
    ]);
    await client.query(`
      INSERT INTO "AuditLog" (
        "id", "companyId", "actorType", "actorUserId", "actorRefId", "action", "targetType",
        "targetId", "requestId", "result", "riskLevel", "metadataJson", "createdAt"
      ) VALUES ($1,NULL,'SERVICE',NULL,$2,'system.release_operation.prepare_remote_mutation',
                'RemoteReleaseMutationIntent',$3,$4,'SUCCESS','CRITICAL',$5::jsonb,CURRENT_TIMESTAMP)
    `, [randomUUID(), input.preparerTaskArn, input.intent.id,
      `release-mutation-intent:${input.intent.id}`,
      JSON.stringify({ operationId: input.operationId, ...input.intent, controller: input.controller })]);
    await client.query('COMMIT');
    return { replay: false };
  } catch (error: any) {
    if (error instanceof RemoteReleaseOperationExpired) await client.query('COMMIT').catch(() => undefined);
    else await client.query('ROLLBACK').catch(() => undefined);
    if (error?.code === '23505') {
      throw new RemoteReleaseOperationBlocked(`an OPEN mutation intent already exists for ${input.intent.serviceKey}`);
    }
    throw error;
  }
}

async function parentForUpdate(
  client: Client,
  id: string,
  environment: Environment,
): Promise<ParentOperationRow> {
  const result = await client.query<ParentOperationRow>(`
    SELECT "id", "status", "mode", "releaseDeployTarget", "buildReleaseId", "ecsTaskArn", "leaseOwner",
           ("leaseExpiresAt" <= CURRENT_TIMESTAMP) AS "leaseExpired", "deploymentManifestJson",
           "preIntentApiCleanupCompletedAt", "preIntentApiCleanupEvidenceJson",
           "sourceBranch", "controllerKind", "githubRunId", "githubRunAttempt", "githubActor",
           "githubActorId", "githubWorkflowRef", "githubRepository", "manualActorRef"
      FROM "RemoteReleaseOperation"
     WHERE "id" = $1 AND "targetEnvironment" = $2 AND "status" IN ('RUNNING', 'UNKNOWN')
     FOR UPDATE
  `, [id, environment]);
  const row = result.rows[0];
  if (!row) throw new RemoteReleaseOperationBlocked(`parent release operation ${id} is not unresolved in ${environment}`);
  if (row.status === 'UNKNOWN') throw new RemoteReleaseOperationBlocked(`parent release operation ${id} is UNKNOWN and requires reconciliation`);
  if (row.leaseExpired) {
    await client.query(`
      UPDATE "RemoteReleaseOperation"
         SET "status" = 'UNKNOWN', "unknownAt" = CURRENT_TIMESTAMP,
             "outcomeReason" = 'rollout hold expired before exact finalization', "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "status" = 'RUNNING'
    `, [id]);
    throw new RemoteReleaseOperationExpired(`parent release operation ${id} expired into UNKNOWN`);
  }
  return row;
}

export async function bindRemoteReleaseDeployment(
  client: Client,
  input: {
    id: string; targetEnvironment: Environment; buildReleaseId: string; binderTaskArn: string;
    controller: ControllerProvenance; intentId: string; evidence: DeploymentEvidence;
  },
): Promise<{ replay: boolean }> {
  await client.query('BEGIN');
  try {
    const row = await parentForUpdate(client, input.id, input.targetEnvironment);
    if (row.mode !== 'release' || row.buildReleaseId !== input.buildReleaseId || !sameController(row, input.controller)) {
      throw new RemoteReleaseOperationBlocked('deployment binding does not belong to the exact held release/controller');
    }
    if (row.releaseDeployTarget !== 'all' && row.releaseDeployTarget !== input.evidence.service) {
      throw new RemoteReleaseOperationBlocked(
        `held release target ${row.releaseDeployTarget ?? 'missing'} does not authorize ${input.evidence.service}`,
      );
    }
    if (row.leaseOwner !== row.ecsTaskArn) {
      throw new RemoteReleaseOperationBlocked('deployment binding arrived after release finalization started');
    }
    const intentResult = await client.query<MutationIntentRow>(`
      SELECT * FROM "RemoteReleaseMutationIntent"
       WHERE "id" = $1 AND "operationId" = $2
       FOR UPDATE
    `, [input.intentId, input.id]);
    const intent = intentResult.rows[0];
    if (!intent) throw new RemoteReleaseOperationBlocked('deployment binding has no exact durable mutation intent');
    if (intent.targetEnvironment !== input.targetEnvironment || intent.buildReleaseId !== input.buildReleaseId
      || intent.serviceKey !== input.evidence.service || intent.expectedServiceArn !== input.evidence.serviceArn) {
      throw new RemoteReleaseOperationBlocked('deployment evidence disagrees with its durable mutation intent');
    }
    if (intent.status === 'BOUND') {
      if (canonicalJson(intent.evidenceJson) === canonicalJson(input.evidence)) {
        await client.query('COMMIT');
        return { replay: true };
      }
      throw new RemoteReleaseOperationBlocked('mutation intent was already bound to different evidence');
    }
    if (intent.status !== 'OPEN') {
      throw new RemoteReleaseOperationBlocked(`mutation intent is ${intent.status}, not OPEN`);
    }
    const manifest = Array.isArray(row.deploymentManifestJson)
      ? row.deploymentManifestJson as DeploymentEvidence[]
      : [];
    const existing = manifest.find((item) => sameEvidence(item, input.evidence));
    if (!existing && manifest.length >= 8) {
      throw new RemoteReleaseOperationBlocked('held release already contains the maximum eight deployment records');
    }
    // One logical service can roll more than once in a release (bootstrap URL discovery and the
    // api-web refresh after an AI endpoint change). Keep every exact deployment append-only; the
    // finalizer must present the full history, so a late/replayed binder can never erase evidence.
    const next = (existing ? manifest : [...manifest, input.evidence]).sort((a, b) =>
      a.service.localeCompare(b.service)
        || (a.deploymentArn ?? '').localeCompare(b.deploymentArn ?? '')
        || a.targetRevisionArn.localeCompare(b.targetRevisionArn));
    await client.query(`
      UPDATE "RemoteReleaseOperation"
         SET "deploymentManifestJson" = $2::jsonb,
             "heartbeatAt" = CURRENT_TIMESTAMP,
             "leaseExpiresAt" = CURRENT_TIMESTAMP + make_interval(secs => $3),
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "status" = 'RUNNING'
    `, [input.id, JSON.stringify(next), ROLLOUT_HOLD_SECONDS]);
    const closed = await client.query(`
      UPDATE "RemoteReleaseMutationIntent"
         SET "status" = 'BOUND', "evidenceJson" = $2::jsonb, "closedByTaskArn" = $3,
             "closedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "status" = 'OPEN'
    `, [input.intentId, JSON.stringify(input.evidence), input.binderTaskArn]);
    if (closed.rowCount !== 1) throw new RemoteReleaseOperationBlocked('mutation intent moved while binding evidence');
    await client.query(`
      INSERT INTO "AuditLog" (
        "id", "companyId", "actorType", "actorUserId", "actorRefId", "action", "targetType",
        "targetId", "requestId", "result", "riskLevel", "metadataJson", "createdAt"
      ) VALUES ($1, NULL, 'SERVICE', NULL, $2, 'system.release_operation.bind_deployment',
                'RemoteReleaseOperation', $3, $4, 'SUCCESS', 'HIGH', $5::jsonb, CURRENT_TIMESTAMP)
    `, [
      randomUUID(), input.binderTaskArn, input.id,
      `release-operation-bind:${input.id}:${input.intentId}`,
      JSON.stringify({ intentId: input.intentId, originalTaskArn: row.ecsTaskArn, binderTaskArn: input.binderTaskArn, evidence: input.evidence, controller: input.controller }),
    ]);
    await client.query('COMMIT');
    return { replay: false };
  } catch (error) {
    if (error instanceof RemoteReleaseOperationExpired) await client.query('COMMIT').catch(() => undefined);
    else await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function attachRemoteReleaseFinalizer(
  client: Client,
  input: {
    id: string; targetEnvironment: Environment; buildReleaseId: string; finalizerTaskArn: string;
    controller: ControllerProvenance; manifest: readonly DeploymentEvidence[];
    ecsServiceArn: string | null; serviceDeploymentArn: string | null;
    targetServiceRevisionArn: string | null; activeBuilds: readonly string[] | null;
  },
): Promise<void> {
  await client.query('BEGIN');
  try {
    const row = await parentForUpdate(client, input.id, input.targetEnvironment);
    if (row.mode !== 'release' || row.buildReleaseId !== input.buildReleaseId || !sameController(row, input.controller)) {
      throw new RemoteReleaseOperationBlocked('release finalizer does not belong to the exact held release/controller');
    }
    if (row.leaseOwner !== row.ecsTaskArn && row.leaseOwner !== input.finalizerTaskArn) {
      throw new RemoteReleaseOperationBlocked('another release finalizer already owns this held release');
    }
    const openIntents = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM "RemoteReleaseMutationIntent"
       WHERE "operationId" = $1 AND "status" = 'OPEN'
    `, [input.id]);
    if ((openIntents.rows[0]?.count ?? 0) !== 0) {
      throw new RemoteReleaseOperationBlocked('release finalization is blocked by an OPEN remote mutation intent');
    }
    if (row.releaseDeployTarget !== null && !await hasCompleteReleaseServiceCoverage(
      client, input.id, row.releaseDeployTarget, row.preIntentApiCleanupCompletedAt,
    )) {
      throw new RemoteReleaseOperationBlocked('release finalization is blocked by incomplete target-service intent coverage');
    }
    const bound = Array.isArray(row.deploymentManifestJson) ? row.deploymentManifestJson as DeploymentEvidence[] : [];
    const exactHistory = bound.length === input.manifest.length
      && bound.every((prior) => input.manifest.some((item) => sameEvidence(item, prior)));
    if (!exactHistory) {
      throw new RemoteReleaseOperationBlocked('final deployment manifest does not exactly match bound deployment history');
    }
    await client.query(`
      UPDATE "RemoteReleaseOperation"
         SET "leaseOwner" = $2,
             "ecsServiceArn" = $3,
             "serviceDeploymentArn" = $4,
             "targetServiceRevisionArn" = $5,
             "activeBuildsJson" = $6::jsonb,
             "deploymentManifestJson" = $7::jsonb,
             "heartbeatAt" = CURRENT_TIMESTAMP,
             "leaseExpiresAt" = CURRENT_TIMESTAMP + make_interval(secs => $8),
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "status" = 'RUNNING'
    `, [
      input.id, input.finalizerTaskArn, input.ecsServiceArn, input.serviceDeploymentArn,
      input.targetServiceRevisionArn, input.activeBuilds ? JSON.stringify(input.activeBuilds) : null,
      JSON.stringify(input.manifest), LEASE_SECONDS,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    if (error instanceof RemoteReleaseOperationExpired) await client.query('COMMIT').catch(() => undefined);
    else await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function finishRemoteReleaseOperation(
  client: Client,
  id: string,
  ecsTaskArn: string,
  status: TerminalStatus | 'UNKNOWN',
  reason: string,
): Promise<void> {
  if (status === 'SUCCEEDED') {
    // First-cutover is permanent only after the post-health finalizer re-read one exact full-SHA
    // api-web configuration under the DB fence and its retirement child succeeded. Preparing or
    // binding the update is intentionally insufficient: an exact rollback remains retryable.
    await client.query(`
      UPDATE "RemoteReleaseMutationIntent" AS intent
         SET "legacyCutoverCompletedAt" = COALESCE(intent."legacyCutoverCompletedAt", CURRENT_TIMESTAMP),
             "updatedAt" = CURRENT_TIMESTAMP
        FROM "RemoteReleaseOperation" AS operation
       WHERE operation."id" = $1 AND intent."targetEnvironment" = operation."targetEnvironment"
         AND intent."serviceKey" = 'api-web' AND intent."status" = 'BOUND'
         AND intent."legacyBootstrapDescriptorJson" IS NOT NULL
         AND operation."leaseOwner" = $2 AND operation."platformAuthorizedAt" IS NOT NULL
         AND operation."activeBuildsJson" = jsonb_build_array(operation."buildReleaseId")
    `, [id, ecsTaskArn]);
  }
  const result = await client.query(`
    UPDATE "RemoteReleaseOperation"
       SET "status" = $3::"RemoteReleaseOperationStatus",
           "unknownAt" = CASE WHEN $3 = 'UNKNOWN' THEN CURRENT_TIMESTAMP ELSE "unknownAt" END,
           "completedAt" = CASE WHEN $3 = 'UNKNOWN' THEN NULL ELSE CURRENT_TIMESTAMP END,
           "outcomeReason" = $4,
           "leaseExpiresAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "status" = 'RUNNING' AND "leaseOwner" = $2
  `, [id, ecsTaskArn, status, reason]);
  if (result.rowCount !== 1) {
    throw new RemoteReleaseOperationBlocked(`release operation ${id} could not record its ${status} outcome`);
  }
}

export async function recordPlatformAuthorization(
  client: Client,
  id: string,
  ecsTaskArn: string,
  authorizedAtEpoch: number,
): Promise<void> {
  const result = await client.query(`
    UPDATE "RemoteReleaseOperation"
       SET "platformAuthorizedAt" = to_timestamp($3), "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "status" = 'RUNNING' AND "leaseOwner" = $2
       AND "ecsServiceArn" IS NOT NULL AND "serviceDeploymentArn" IS NOT NULL
       AND "targetServiceRevisionArn" IS NOT NULL AND "activeBuildsJson" IS NOT NULL
  `, [id, ecsTaskArn, authorizedAtEpoch]);
  if (result.rowCount !== 1) {
    throw new RemoteReleaseOperationBlocked(`release operation ${id} could not persist platform authorization`);
  }
}

/**
 * Resolve exactly one UNKNOWN row. An expired RUNNING row is first committed as UNKNOWN, so a crash
 * in the reconciler can only leave it blocking; it can never silently free the environment.
 */
export async function reconcileRemoteReleaseOperation(
  client: Client,
  input: ReconcileRemoteReleaseOperation,
): Promise<{ status: ReconciledStatus; replay: boolean }> {
  await markExpiredTargetUnknown(client, input.id, input.targetEnvironment);
  await client.query('BEGIN');
  try {
    const result = await client.query<ReconcileRow>(`
      SELECT "id", "status", "ecsTaskArn", "serviceDeploymentArn", "releaseDeployTarget",
             "preIntentApiCleanupCompletedAt",
             ("leaseExpiresAt" <= CURRENT_TIMESTAMP) AS "leaseExpired",
             "reconciledByActorRef", "reconciliationEvidenceRef", "reconciliationReason"
        FROM "RemoteReleaseOperation"
       WHERE "id" = $1 AND "targetEnvironment" = $2
       FOR UPDATE
    `, [input.id, input.targetEnvironment]);
    const row = result.rows[0];
    if (!row) throw new Error(`release operation ${input.id} does not exist in ${input.targetEnvironment}`);
    if (row.ecsTaskArn !== input.originalTaskArn) {
      throw new Error(`release operation ${input.id} belongs to ${row.ecsTaskArn}, not ${input.originalTaskArn}`);
    }
    const status: ReconciledStatus = input.outcome === 'SUCCEEDED'
      ? 'RECONCILED_SUCCEEDED'
      : 'RECONCILED_FAILED_CONFIRMED';
    if (row.status === status) {
      if (
        row.reconciledByActorRef === input.actorRef
        && row.reconciliationEvidenceRef === input.evidenceRef
        && row.reconciliationReason === input.reason
      ) {
        await client.query('COMMIT');
        return { status, replay: true };
      }
      throw new Error(`release operation ${input.id} was already reconciled with different evidence`);
    }
    if (row.status !== 'UNKNOWN') {
      throw new Error(`release operation ${input.id} is ${row.status}, not UNKNOWN`);
    }
    const openIntents = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM "RemoteReleaseMutationIntent"
       WHERE "operationId" = $1 AND "status" = 'OPEN'
    `, [input.id]);
    if ((openIntents.rows[0]?.count ?? 0) !== 0) {
      throw new RemoteReleaseOperationBlocked(
        `release operation ${input.id} has an OPEN remote mutation intent; recover that exact intent first`,
      );
    }
    if (row.releaseDeployTarget === 'all' || row.releaseDeployTarget === 'api-web') {
      const apiIntents = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM "RemoteReleaseMutationIntent"
         WHERE "operationId" = $1 AND "serviceKey" = 'api-web'
      `, [input.id]);
      if ((apiIntents.rows[0]?.count ?? 0) === 0) {
        if (row.preIntentApiCleanupCompletedAt === null) {
          throw new RemoteReleaseOperationBlocked(
            `release operation ${input.id} pre-attested api-web but stopped before a durable api-web intent; exact pre-intent recovery is required`,
          );
        }
        throw new RemoteReleaseOperationBlocked(
          `release operation ${input.id} has exact pre-intent cleanup evidence; replay pre-intent recovery to terminalize FAILED_CONFIRMED`,
        );
      }
    }
    if (row.releaseDeployTarget !== null && !await hasCompleteReleaseServiceCoverage(
      client, input.id, row.releaseDeployTarget, row.preIntentApiCleanupCompletedAt,
    )) {
      // A single ai-gateway/workers target that produced no intent at all was never mutated.
      // deploy.sh prepares the durable intent (deploy.sh:1055) *before* it calls
      // UpdateExpressGatewayService (deploy.sh:1058), so zero intents proves the service was
      // never touched, and FAILED_CONFIRMED is then the only truthful outcome.
      //
      // Without this, such an operation is unrecoverable by any sanctioned path: generic
      // reconcile stops here, PRE_INTENT recovery is gated to all|api-web, and ORPHAN needs
      // intent and binder task ARNs that were never created. It blocks every production deploy
      // until someone edits the row by hand, which the runbook forbids for good reason.
      //
      // api-web keeps the stricter pre-intent path above: it also carries launch-gate authority
      // that has to be retired, so absence of an intent is not the whole story there.
      const targetIsNonApi = row.releaseDeployTarget === 'ai-gateway'
        || row.releaseDeployTarget === 'workers';
      const anyIntent = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM "RemoteReleaseMutationIntent" WHERE "operationId" = $1
      `, [input.id]);
      const neverMutated = targetIsNonApi
        && (anyIntent.rows[0]?.count ?? 0) === 0
        && input.outcome === 'FAILED_CONFIRMED';
      if (!neverMutated) {
        throw new RemoteReleaseOperationBlocked(
          `release operation ${input.id} has incomplete target-service intent/orphan coverage`,
        );
      }
    }
    const pendingLegacyCleanup = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM "RemoteReleaseMutationIntent"
       WHERE "operationId" = $1 AND (
         ("legacyRollbackObservedAt" IS NOT NULL AND "legacyRollbackCleanedAt" IS NULL)
         OR ("failedBuildCleanupRequiredAt" IS NOT NULL AND "failedBuildCleanupCompletedAt" IS NULL)
         OR ("serviceKey" = 'api-web' AND "status" = 'BOUND'
           AND "legacyBootstrapDescriptorJson" IS NOT NULL
           AND "legacyRollbackObservedAt" IS NULL
           AND "legacyCutoverCompletedAt" IS NULL)
       )
    `, [input.id]);
    if ((pendingLegacyCleanup.rows[0]?.count ?? 0) !== 0) {
      throw new RemoteReleaseOperationBlocked(
        `release operation ${input.id} still needs exact bootstrap cutover/rollback attestation cleanup`,
      );
    }

    const updated = await client.query(`
      UPDATE "RemoteReleaseOperation"
         SET "status" = $3::"RemoteReleaseOperationStatus",
             "completedAt" = CURRENT_TIMESTAMP,
             "reconciledAt" = CURRENT_TIMESTAMP,
             "reconciledByActorRef" = $4,
             "reconciledByTaskArn" = $5,
             "reconciliationEvidenceRef" = $6,
             "reconciliationReason" = $7,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "targetEnvironment" = $2 AND "status" = 'UNKNOWN'
    `, [
      input.id,
      input.targetEnvironment,
      status,
      input.actorRef,
      input.reconcilerTaskArn,
      input.evidenceRef,
      input.reason,
    ]);
    if (updated.rowCount !== 1) throw new Error(`release operation ${input.id} moved during reconciliation`);

    await client.query(`
      INSERT INTO "AuditLog" (
        "id", "companyId", "actorType", "actorUserId", "actorRefId", "action", "targetType",
        "targetId", "requestId", "result", "riskLevel", "metadataJson", "createdAt"
      ) VALUES ($1, NULL, 'SERVICE', NULL, $2, 'system.release_operation.reconcile',
                'RemoteReleaseOperation', $3, $4, 'SUCCESS', 'CRITICAL', $5::jsonb, CURRENT_TIMESTAMP)
    `, [
      randomUUID(),
      input.actorRef,
      input.id,
      `release-operation-reconcile:${input.id}`,
      JSON.stringify({
        outcome: input.outcome,
        originalTaskArn: row.ecsTaskArn,
        serviceDeploymentArn: row.serviceDeploymentArn,
        reconcilerTaskArn: input.reconcilerTaskArn,
        evidenceRef: input.evidenceRef,
        reason: input.reason,
        controller: input.controller,
      }),
    ]);
    await client.query('COMMIT');
    return { status, replay: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function markExpiredTargetUnknown(
  client: Client,
  id: string,
  environment: Environment,
  recovery: ExactRecoveryHoldContext | null = null,
): Promise<void> {
  await client.query('BEGIN');
  try {
    const result = await client.query<{
      status: string; leaseExpired: boolean; mode: string; buildReleaseId: string;
      ecsTaskArn: string; leaseOwner: string;
    }>(`
      SELECT "status", "mode", "buildReleaseId", "ecsTaskArn", "leaseOwner",
             ("leaseExpiresAt" <= CURRENT_TIMESTAMP) AS "leaseExpired"
        FROM "RemoteReleaseOperation"
       WHERE "id" = $1 AND "targetEnvironment" = $2
       FOR UPDATE
    `, [id, environment]);
    const row = result.rows[0];
    const stopped = recovery?.stoppedParentTaskEvidence ?? null;
    if (stopped && (!row || row.mode !== 'release'
      || row.buildReleaseId !== recovery!.buildReleaseId || row.ecsTaskArn !== stopped.taskArn)) {
      throw new RemoteReleaseOperationBlocked('stopped parent-task evidence does not belong to the exact held release');
    }
    if (row?.status === 'RUNNING') {
      if (!row.leaseExpired && (!recovery || !stopped)) {
        throw new RemoteReleaseOperationBlocked(`release operation ${id} still has a live heartbeat lease`);
      }
      if (!row.leaseExpired && row.leaseOwner !== row.ecsTaskArn) {
        throw new RemoteReleaseOperationBlocked('stopped parent-task evidence cannot replace a finalizer-owned live lease');
      }
      const reason = row.leaseExpired
        ? 'operator found an expired heartbeat without a terminal outcome'
        : `exact recovery controller proved held parent task STOPPED at ${stopped!.stoppedAt}`;
      await client.query(`
        UPDATE "RemoteReleaseOperation"
           SET "status" = 'UNKNOWN', "unknownAt" = CURRENT_TIMESTAMP,
               "outcomeReason" = $2,
               "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "status" = 'RUNNING'
      `, [id, reason]);
      if (!row.leaseExpired) {
        await client.query(`
          INSERT INTO "AuditLog" (
            "id", "companyId", "actorType", "actorUserId", "actorRefId", "action", "targetType",
            "targetId", "requestId", "result", "riskLevel", "metadataJson", "createdAt"
          ) VALUES ($1, NULL, 'SERVICE', NULL, $2, 'system.release_operation.reclaim_stopped_hold',
                    'RemoteReleaseOperation', $3, $4, 'SUCCESS', 'CRITICAL', $5::jsonb, CURRENT_TIMESTAMP)
        `, [
          randomUUID(), recovery!.recovererTaskArn, id,
          `release-operation-reclaim-stopped-hold:${id}`,
          JSON.stringify({
            stoppedParentTaskEvidence: stopped,
            buildReleaseId: recovery!.buildReleaseId,
            priorLeaseOwner: row.leaseOwner,
            controller: recovery!.controller,
          }),
        ]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

function expectedCluster(environment: Environment): string {
  return environment === 'uat' ? 'watchdog-bms-uat' : 'watchdog-bms-prod';
}

function validateTaskArn(value: string, environment: Environment): string {
  const cluster = expectedCluster(environment).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:task/${cluster}/[A-Za-z0-9_-]+$`).test(value)) {
    throw new Error(`ECS task ARN is not an exact ${expectedCluster(environment)} task`);
  }
  return value;
}

export function parseStoppedParentTaskEvidence(
  environment: Environment,
  serialized?: string,
): StoppedParentTaskEvidence {
  const text = serialized ?? requiredText('RELEASE_RECOVERY_PARENT_TASK_EVIDENCE_JSON', 4_096);
  if (text.length < 1 || text.length > 4_096) {
    throw new Error('RELEASE_RECOVERY_PARENT_TASK_EVIDENCE_JSON exceeds its bounded size');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('RELEASE_RECOVERY_PARENT_TASK_EVIDENCE_JSON must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('stopped parent-task evidence must be an object');
  }
  const row = value as Record<string, unknown>;
  const expectedKeys = [
    'desiredStatus', 'group', 'lastStatus', 'startedBy', 'stopCode', 'stoppedAt',
    'stoppedReason', 'taskArn', 'taskDefinitionArn',
  ].sort();
  if (canonicalJson(Object.keys(row).sort()) !== canonicalJson(expectedKeys)) {
    throw new Error('stopped parent-task evidence has an unexpected shape');
  }
  const taskArn = validateTaskArn(String(row.taskArn ?? ''), environment);
  const stage = environment === 'uat' ? 'uat' : 'prod';
  const family = environment === 'uat' ? 'watchdog-bms-uat-release-task' : 'watchdog-bms-release-task';
  const taskDefinitionArn = String(row.taskDefinitionArn ?? '');
  const familyPattern = family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const [, , , taskRegion, taskAccount] = taskArn.split(':');
  if (!new RegExp(`^arn:aws:ecs:${taskRegion}:${taskAccount}:task-definition/${familyPattern}:[1-9][0-9]*$`)
    .test(taskDefinitionArn)) {
    throw new Error('stopped parent task definition is outside the exact release family');
  }
  if (row.lastStatus !== 'STOPPED' || row.desiredStatus !== 'STOPPED') {
    throw new RemoteReleaseOperationBlocked('parent release task is not stably STOPPED');
  }
  if (row.startedBy !== `watchdog-bms-${stage}-release` || row.group !== `family:${family}`) {
    throw new Error('stopped parent task provenance is not the exact release launcher/family');
  }
  const stoppedAt = String(row.stoppedAt ?? '');
  if (!Number.isFinite(new Date(stoppedAt).getTime())) {
    throw new Error('stopped parent task has no valid stoppedAt');
  }
  const optionalText = (name: 'stopCode' | 'stoppedReason'): string | null => {
    const candidate = row[name];
    if (candidate === null) return null;
    if (typeof candidate !== 'string' || candidate.length > 1_000 || /[\u0000-\u001f]/.test(candidate)) {
      throw new Error(`stopped parent task ${name} is malformed`);
    }
    return candidate;
  };
  return {
    taskArn,
    taskDefinitionArn,
    lastStatus: 'STOPPED',
    desiredStatus: 'STOPPED',
    stoppedAt: new Date(stoppedAt).toISOString(),
    stopCode: optionalText('stopCode'),
    stoppedReason: optionalText('stoppedReason'),
    startedBy: `watchdog-bms-${stage}-release`,
    group: `family:${family}`,
  };
}

function validateDeploymentArn(value: string, environment: Environment): string | null {
  if (!value) return null;
  const cluster = expectedCluster(environment).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:service-deployment/${cluster}/[^/]+/[^/]+$`).test(value)) {
    throw new Error(`service deployment ARN is not an exact ${expectedCluster(environment)} deployment`);
  }
  return value;
}

function validateServiceArn(value: string, environment: Environment): string {
  const cluster = expectedCluster(environment).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:service/${cluster}/[^/]+$`).test(value)) {
    throw new Error(`service ARN is not an exact ${expectedCluster(environment)} service`);
  }
  return value;
}

function validateRevisionArn(value: string, environment: Environment): string {
  const cluster = expectedCluster(environment).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:service-revision/${cluster}/[^/]+/[^/]+$`).test(value)) {
    throw new Error(`service revision ARN is not an exact ${expectedCluster(environment)} revision`);
  }
  return value;
}

function parseDeploymentEvidence(value: unknown, environment: Environment, buildReleaseId: string): DeploymentEvidence {
  if (!value || typeof value !== 'object') throw new Error('deployment evidence must be an object');
  const row = value as Record<string, unknown>;
  const service = typeof row.service === 'string' ? row.service : '';
  if (!['api-web', 'ai-gateway', 'workers'].includes(service)) throw new Error('deployment evidence service is unknown');
  const serviceArn = validateServiceArn(typeof row.serviceArn === 'string' ? row.serviceArn : '', environment);
  const targetRevisionArn = validateRevisionArn(
    typeof row.targetRevisionArn === 'string' ? row.targetRevisionArn : '', environment,
  );
  const sourceSha = typeof row.sourceSha === 'string' ? row.sourceSha : '';
  if (sourceSha !== buildReleaseId) throw new Error('deployment evidence belongs to another release SHA');
  if (typeof row.noOp !== 'boolean') throw new Error('deployment evidence noOp must be boolean');
  const deploymentArn = row.deploymentArn === null
    ? null
    : validateDeploymentArn(typeof row.deploymentArn === 'string' ? row.deploymentArn : '', environment);
  if ((row.noOp && deploymentArn !== null) || (!row.noOp && deploymentArn === null)) {
    throw new Error('deployment evidence deployment ARN does not match its no-op shape');
  }
  const serviceName = serviceArn.split('/').at(-1)!;
  if (!targetRevisionArn.includes(`/${serviceName}/`)
    || (deploymentArn && !deploymentArn.includes(`/${serviceName}/`))) {
    throw new Error('deployment evidence service/deployment/revision identities disagree');
  }
  return { service, serviceArn, deploymentArn, targetRevisionArn, sourceSha, noOp: row.noOp };
}

function parseDeploymentManifest(
  environment: Environment,
  buildReleaseId: string,
  variable = 'RELEASE_OPERATION_DEPLOYMENT_MANIFEST',
): DeploymentEvidence[] {
  const text = requiredText(variable, 16_384);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${variable} must be valid JSON`);
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new Error('deployment manifest must contain one to eight deployment records');
  }
  const manifest = value.map((row) => parseDeploymentEvidence(row, environment, buildReleaseId))
    .sort((a, b) => a.service.localeCompare(b.service)
      || (a.deploymentArn ?? '').localeCompare(b.deploymentArn ?? '')
      || a.targetRevisionArn.localeCompare(b.targetRevisionArn));
  if (manifest.some((row, index) => manifest.slice(0, index).some((prior) => sameEvidence(prior, row)))) {
    throw new Error('deployment manifest carries duplicate deployment evidence');
  }
  return manifest;
}

function parseMutationIntent(environment: Environment, variable = 'RELEASE_MUTATION_INTENT_JSON'): MutationIntent {
  const text = requiredText(variable, 32_768);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${variable} must be valid JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('mutation intent must be an object');
  }
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  if (!UUID_PATTERN.test(id)) throw new Error('mutation intent id must be a UUID');
  const serviceKey = row.serviceKey;
  if (!['api-web', 'ai-gateway', 'workers'].includes(String(serviceKey))) {
    throw new Error('mutation intent serviceKey is unknown');
  }
  const mutationKind = row.mutationKind;
  if (mutationKind !== 'CREATE' && mutationKind !== 'UPDATE') {
    throw new Error('mutation intent mutationKind must be CREATE or UPDATE');
  }
  const clusterName = typeof row.clusterName === 'string' ? row.clusterName : '';
  if (clusterName !== expectedCluster(environment)) throw new Error('mutation intent cluster is not the target environment cluster');
  const serviceName = typeof row.serviceName === 'string' ? row.serviceName : '';
  const ssmParameterName = typeof row.ssmParameterName === 'string' ? row.ssmParameterName : '';
  const prefix = environment === 'uat' ? 'watchdog-bms-uat' : 'watchdog-bms';
  const aiGatewayServiceName = environment === 'uat'
    ? 'watchdog-bms-uat-ai-gateway'
    : 'watchdog-bms-ai-gateway-v2';
  const exactIdentities: Record<string, Array<{ serviceName: string; ssmParameterName: string }>> = {
    'api-web': [{
      serviceName: environment === 'uat' ? 'watchdog-bms-uat-api-web' : 'watchdog-bms-api-web-pub',
      ssmParameterName: `/watchdog-bms/${environment}/ecs-express-api-web-service-arn`,
    }],
    // Production's ai-gateway is -v2. The original watchdog-bms-ai-gateway was deleted 2026-07-03
    // after its control-plane state broke, and the SSM ARN was repointed then; this map and
    // deploy.sh's AI_SERVICE_NAME both kept the old name. api-web was already special-cased for
    // its own -pub suffix, ai-gateway simply was not. The two must agree: deploy.sh builds the
    // intent from its name and this rejects it, so a mismatch fails only after images are built
    // and pushed - and leaves an operation open behind it.
    'ai-gateway': [
      { serviceName: aiGatewayServiceName, ssmParameterName: `/watchdog-bms/${environment}/ecs-express-ai-gateway-service-arn` },
      { serviceName: `${aiGatewayServiceName}-priv`, ssmParameterName: `/watchdog-bms/${environment}/ecs-express-ai-gateway-priv-service-arn` },
    ],
    workers: [
      { serviceName: `${prefix}-workers`, ssmParameterName: `/watchdog-bms/${environment}/ecs-express-workers-service-arn` },
      { serviceName: `${prefix}-workers-priv`, ssmParameterName: `/watchdog-bms/${environment}/ecs-express-workers-priv-service-arn` },
    ],
  };
  if (!exactIdentities[String(serviceKey)]?.some((identity) =>
    identity.serviceName === serviceName && identity.ssmParameterName === ssmParameterName)) {
    throw new Error('mutation intent service name/key/SSM parameter do not match an exact environment mapping');
  }
  const expectedServiceArn = validateServiceArn(
    typeof row.expectedServiceArn === 'string' ? row.expectedServiceArn : '', environment,
  );
  if (!expectedServiceArn.endsWith(`/${serviceName}`)) throw new Error('mutation intent expected service ARN/name disagree');
  const requestHash = typeof row.requestHash === 'string' ? row.requestHash : '';
  const desiredConfigHash = typeof row.desiredConfigHash === 'string' ? row.desiredConfigHash : '';
  if (!/^[0-9a-f]{64}$/.test(requestHash) || !/^[0-9a-f]{64}$/.test(desiredConfigHash)) {
    throw new Error('mutation intent request/config hashes must be lowercase SHA-256');
  }
  // The bound is a sanity ceiling on a durable JSON column, not a statement about how many
  // deployments a service may have. It used to be 100, which silently matched the single
  // ListServiceDeployments page the producer read - so the two could never disagree. Now that the
  // producer walks every page (it has to: the before-set is what proves a bound deployment is new),
  // a long-lived service legitimately exceeds 100. Production api-web was at 184 the first time
  // this ran. 5000 is the pager's own ceiling, LIST_DEPLOYMENTS_MAX_PAGES=50 x 100 rows, so the two
  // limits move together instead of one quietly capping the other.
  if (!Array.isArray(row.beforeDeploymentArns) || row.beforeDeploymentArns.length > 5000) {
    throw new Error('mutation intent beforeDeploymentArns must be a bounded array');
  }
  const beforeDeploymentArns = row.beforeDeploymentArns.map((item) =>
    validateDeploymentArn(typeof item === 'string' ? item : '', environment) ?? '');
  if (beforeDeploymentArns.some((arn) => !arn.includes(`/${serviceName}/`))
    || new Set(beforeDeploymentArns).size !== beforeDeploymentArns.length
    || canonicalJson(beforeDeploymentArns) !== canonicalJson([...beforeDeploymentArns].sort())) {
    throw new Error('mutation intent before deployment identities must be sorted, unique and service-scoped');
  }
  const beforeCurrentDeploymentArn = row.beforeCurrentDeploymentArn === null
    ? null
    : validateDeploymentArn(typeof row.beforeCurrentDeploymentArn === 'string' ? row.beforeCurrentDeploymentArn : '', environment);
  if (beforeCurrentDeploymentArn && !beforeCurrentDeploymentArn.includes(`/${serviceName}/`)) {
    throw new Error('mutation intent current deployment belongs to another service');
  }
  if (!Array.isArray(row.beforeActiveConfigurations) || row.beforeActiveConfigurations.length > 2) {
    throw new Error('mutation intent active configuration snapshot must contain zero to two records');
  }
  const beforeActiveConfigurations = row.beforeActiveConfigurations.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('active configuration descriptor must be an object');
    const descriptor = item as Record<string, unknown>;
    const revisionArn = validateRevisionArn(
      typeof descriptor.revisionArn === 'string' ? descriptor.revisionArn : '', environment,
    );
    const sourceSha = typeof descriptor.sourceSha === 'string' ? descriptor.sourceSha : '';
    const configHash = typeof descriptor.configHash === 'string' ? descriptor.configHash : '';
    const image = typeof descriptor.image === 'string' ? descriptor.image : '';
    if (!revisionArn.includes(`/${serviceName}/`) || !/^(?:[0-9a-f]{12}|[0-9a-f]{40})$/.test(sourceSha)
      || !/^[0-9a-f]{64}$/.test(configHash) || !image || image.length > 1024) {
      throw new Error('active configuration descriptor is incomplete or outside the exact service');
    }
    return { revisionArn, sourceSha, configHash, image };
  }).sort((left, right) => left.revisionArn.localeCompare(right.revisionArn));
  if (new Set(beforeActiveConfigurations.map((item) => item.revisionArn)).size !== beforeActiveConfigurations.length
    || canonicalJson(beforeActiveConfigurations) !== canonicalJson(row.beforeActiveConfigurations)) {
    throw new Error('active configuration descriptors must be canonical, sorted and unique');
  }
  const legacy = row.legacyBootstrapDescriptor;
  let legacyBootstrapDescriptor: Record<string, unknown> | null = null;
  if (legacy !== null) {
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)
      || mutationKind !== 'UPDATE' || beforeCurrentDeploymentArn !== null
      || beforeActiveConfigurations.length !== 1
      || canonicalJson(legacy) !== canonicalJson(beforeActiveConfigurations[0])) {
      throw new Error('legacy bootstrap descriptor must be the exact singleton pre-update descriptor with null currentDeployment');
    }
    if (!/^[0-9a-f]{12}$/.test(beforeActiveConfigurations[0]!.sourceSha)) {
      throw new Error('legacy bootstrap descriptor must preserve the observed 12-character SHA');
    }
    legacyBootstrapDescriptor = legacy as Record<string, unknown>;
  }
  if (mutationKind === 'CREATE' && (beforeDeploymentArns.length !== 0 || beforeCurrentDeploymentArn !== null
    || beforeActiveConfigurations.length !== 0 || legacyBootstrapDescriptor !== null)) {
    throw new Error('CREATE intent must carry an empty before-state');
  }
  return {
    id, serviceKey: serviceKey as MutationIntent['serviceKey'], mutationKind,
    expectedServiceArn, clusterName, serviceName, ssmParameterName, requestHash, desiredConfigHash,
    beforeDeploymentArns, beforeCurrentDeploymentArn, beforeActiveConfigurations,
    legacyBootstrapDescriptor,
  };
}

type ReviewedExpiredTaskAuditMetadata = {
  cloudTrailRunTaskEvents: Record<'parent' | 'intent' | 'binder', {
    eventId: string;
    eventTime: string;
    roleSessionArn: string;
    requestOverridesPresent: false;
  }>;
};

const REVIEWED_EXPIRED_EVIDENCE_PATH =
  'infra/uat/recovery-evidence/bf131086-6055-4143-a77c-579bc7d58b57.json';
const REVIEWED_EXPIRED_EVIDENCE_SHA256 =
  'f152c3da1b7d6cb54d1d51b6714f8028fb2c43f8dd324efbc829142906fc7cfb';
const REVIEWED_EXPIRED_AUDIT_METADATA: ReviewedExpiredTaskAuditMetadata = {
  cloudTrailRunTaskEvents: {
    parent: {
      eventId: 'fb35c60e-8abb-46ab-bba2-73805de726ce',
      eventTime: '2026-08-02T18:28:16Z',
      roleSessionArn: 'arn:aws:sts::311414082667:assumed-role/watchdog-bms-deploy-uat/watchdog-bms-uat-deploy-30760853050',
      requestOverridesPresent: false,
    },
    intent: {
      eventId: '09c116fd-9fdb-450d-a92f-056ade94ac63',
      eventTime: '2026-08-02T18:32:41Z',
      roleSessionArn: 'arn:aws:sts::311414082667:assumed-role/watchdog-bms-deploy-uat/watchdog-bms-uat-target-30760853050',
      requestOverridesPresent: false,
    },
    binder: {
      eventId: 'a8af36f4-f63f-4f37-a8dc-d498d9e6fe3d',
      eventTime: '2026-08-02T18:35:14Z',
      roleSessionArn: 'arn:aws:sts::311414082667:assumed-role/watchdog-bms-deploy-uat/watchdog-bms-uat-target-30760853050',
      requestOverridesPresent: false,
    },
  },
};

type OrphanTaskEvidence = {
  parentTaskArn: string;
  intentTaskArn: string;
  binderTaskArn: string;
  parentTaskDefinitionArn: string;
  intentTaskDefinitionArn: string;
  binderTaskDefinitionArn: string;
  imageDigest: string;
  parentStartedAt: string;
  parentStoppedAt: string;
  intentStartedAt: string;
  intentStoppedAt: string;
  binderStartedAt: string;
  binderStoppedAt: string;
  originalController: ControllerProvenance;
  evidenceKind: 'RETAINED_ECS_TASK' | 'REVIEWED_EXPIRED_ECS_TASK';
  reviewedEvidenceManifestPath: string | null;
  reviewedEvidenceManifestSha256: string | null;
  reviewedAuditMetadata: ReviewedExpiredTaskAuditMetadata | null;
};

export function parseOrphanTaskEvidence(environment: Environment, serialized?: string): OrphanTaskEvidence {
  const text = serialized ?? requiredText('RELEASE_ORPHAN_TASK_EVIDENCE_JSON', 16_384);
  if (text.length < 1 || text.length > 16_384) {
    throw new Error('RELEASE_ORPHAN_TASK_EVIDENCE_JSON exceeds its bounded size');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('RELEASE_ORPHAN_TASK_EVIDENCE_JSON must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('orphan task evidence must be an object');
  }
  const row = value as Record<string, any>;
  const evidenceKind = row.evidenceKind;
  const baseKeys = [
    'binderStartedAt', 'binderStoppedAt', 'binderTaskArn', 'binderTaskDefinitionArn', 'evidenceKind',
    'imageDigest', 'intentStartedAt', 'intentStoppedAt', 'intentTaskArn', 'intentTaskDefinitionArn',
    'originalController', 'parentStartedAt', 'parentStoppedAt', 'parentTaskArn', 'parentTaskDefinitionArn',
  ];
  const expiredKeys = [
    ...baseKeys, 'reviewedAuditMetadata', 'reviewedEvidenceManifestPath', 'reviewedEvidenceManifestSha256',
  ];
  const actualKeys = Object.keys(row).sort();
  let reviewedEvidenceManifestPath: string | null = null;
  let reviewedEvidenceManifestSha256: string | null = null;
  let reviewedAuditMetadata: ReviewedExpiredTaskAuditMetadata | null = null;
  if (evidenceKind === 'RETAINED_ECS_TASK') {
    if (canonicalJson(actualKeys) !== canonicalJson([...baseKeys].sort())) {
      throw new Error('retained ECS task evidence cannot carry reviewed-expiry authority');
    }
  } else if (evidenceKind === 'REVIEWED_EXPIRED_ECS_TASK') {
    if (environment !== 'uat' || canonicalJson(actualKeys) !== canonicalJson(expiredKeys.sort())) {
      throw new Error('reviewed expired ECS task evidence is UAT-only and requires the exact audit shape');
    }
    reviewedEvidenceManifestPath = String(row.reviewedEvidenceManifestPath ?? '');
    reviewedEvidenceManifestSha256 = String(row.reviewedEvidenceManifestSha256 ?? '');
    if (reviewedEvidenceManifestPath !== REVIEWED_EXPIRED_EVIDENCE_PATH
      || reviewedEvidenceManifestSha256 !== REVIEWED_EXPIRED_EVIDENCE_SHA256
      || canonicalJson(row.reviewedAuditMetadata) !== canonicalJson(REVIEWED_EXPIRED_AUDIT_METADATA)) {
      throw new Error('reviewed expired ECS task evidence does not match the pinned incident manifest');
    }
    reviewedAuditMetadata = row.reviewedAuditMetadata as ReviewedExpiredTaskAuditMetadata;
  } else {
    throw new Error('orphan task evidence kind is not recognized');
  }
  const parentTaskArn = validateTaskArn(String(row.parentTaskArn ?? ''), environment);
  const intentTaskArn = validateTaskArn(String(row.intentTaskArn ?? ''), environment);
  const binderTaskArn = validateTaskArn(String(row.binderTaskArn ?? ''), environment);
  if (new Set([parentTaskArn, intentTaskArn, binderTaskArn]).size !== 3) {
    throw new Error('orphan recovery requires three distinct historical task ARNs');
  }
  const cluster = expectedCluster(environment).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const taskDefinitionPattern = new RegExp(
    `^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:task-definition/watchdog-bms-${environment === 'uat' ? 'uat-' : ''}release-task:[1-9][0-9]*$`,
  );
  const parentTaskDefinitionArn = String(row.parentTaskDefinitionArn ?? '');
  const intentTaskDefinitionArn = String(row.intentTaskDefinitionArn ?? '');
  const binderTaskDefinitionArn = String(row.binderTaskDefinitionArn ?? '');
  if (![parentTaskDefinitionArn, intentTaskDefinitionArn, binderTaskDefinitionArn]
    .every((arn) => taskDefinitionPattern.test(arn))) {
    throw new Error(`orphan task definition is outside ${cluster}`);
  }
  const imageDigest = String(row.imageDigest ?? '');
  if (!/^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/watchdog-bms-api@sha256:[0-9a-f]{64}$/.test(imageDigest)) {
    throw new Error('orphan historical tasks must share one immutable API image digest');
  }
  const timestamps = ['parentStartedAt', 'parentStoppedAt', 'intentStartedAt', 'intentStoppedAt', 'binderStartedAt', 'binderStoppedAt']
    .map((key) => [key, String(row[key] ?? ''), new Date(String(row[key] ?? '')).getTime()] as const);
  if (timestamps.some(([, , epoch]) => !Number.isFinite(epoch))) {
    throw new Error('orphan task chronology is incomplete');
  }
  const byKey = Object.fromEntries(timestamps.map(([key, , epoch]) => [key, epoch]));
  if (!(byKey.parentStartedAt! < byKey.parentStoppedAt!
    && byKey.parentStoppedAt! < byKey.intentStartedAt!
    && byKey.intentStartedAt! < byKey.intentStoppedAt!
    && byKey.intentStoppedAt! < byKey.binderStartedAt!
    && byKey.binderStartedAt! < byKey.binderStoppedAt!
    && byKey.binderStoppedAt! - byKey.parentStartedAt! <= 30 * 60 * 1_000)) {
    throw new Error('orphan task chronology is not one bounded release attempt');
  }
  const controller = row.originalController as Record<string, unknown> | undefined;
  const originalController: ControllerProvenance = {
    sourceBranch: String(controller?.sourceBranch ?? ''),
    controllerKind: controller?.controllerKind === 'GITHUB_ACTIONS' ? 'GITHUB_ACTIONS' : 'MANUAL',
    githubRunId: typeof controller?.githubRunId === 'string' ? controller.githubRunId : null,
    githubRunAttempt: typeof controller?.githubRunAttempt === 'number' ? controller.githubRunAttempt : null,
    githubActor: typeof controller?.githubActor === 'string' ? controller.githubActor : null,
    githubActorId: typeof controller?.githubActorId === 'string' ? controller.githubActorId : null,
    githubWorkflowRef: typeof controller?.githubWorkflowRef === 'string' ? controller.githubWorkflowRef : null,
    githubRepository: typeof controller?.githubRepository === 'string' ? controller.githubRepository : null,
    manualActorRef: null,
  };
  const expectedBranch = environment === 'uat' ? 'develop' : 'main';
  const expectedWorkflowRefs = expectedGithubWorkflows(environment, 'release')
    .map((workflow) => `${originalController.githubRepository}/.github/workflows/${workflow}@refs/heads/main`);
  if (originalController.controllerKind !== 'GITHUB_ACTIONS'
    || originalController.sourceBranch !== expectedBranch
    || !originalController.githubRunId?.match(/^[0-9]+$/)
    || !originalController.githubRunAttempt
    || !originalController.githubActor
    || !originalController.githubActorId?.match(/^[0-9]+$/)
    || !expectedWorkflowRefs.includes(originalController.githubWorkflowRef ?? '')) {
    throw new Error('orphan task controller provenance is not the exact original release controller');
  }
  return {
    parentTaskArn, intentTaskArn, binderTaskArn,
    parentTaskDefinitionArn, intentTaskDefinitionArn, binderTaskDefinitionArn, imageDigest,
    parentStartedAt: timestamps[0]![1], parentStoppedAt: timestamps[1]![1],
    intentStartedAt: timestamps[2]![1], intentStoppedAt: timestamps[3]![1],
    binderStartedAt: timestamps[4]![1], binderStoppedAt: timestamps[5]![1],
    originalController, evidenceKind, reviewedEvidenceManifestPath,
    reviewedEvidenceManifestSha256, reviewedAuditMetadata,
  };
}

function parseRecoveryNetworkEvidence(
  environment: Environment,
  expectedServiceArn: string,
): RecoveryNetworkEvidence | null {
  const text = requiredText('RELEASE_RECOVERY_NETWORK_EVIDENCE_JSON', 4_096);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('RELEASE_RECOVERY_NETWORK_EVIDENCE_JSON must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('recovery network evidence must be an object');
  }
  const row = value as Record<string, unknown>;
  const serviceArn = validateServiceArn(String(row.serviceArn ?? ''), environment);
  if (row.serviceAbsent === true) {
    if (serviceArn !== expectedServiceArn
      || canonicalJson(Object.keys(row).sort()) !== canonicalJson(['serviceAbsent', 'serviceArn'])) {
      throw new Error('absent-service recovery evidence must contain only the exact service identity');
    }
    return null;
  }
  const activeSecurityGroups = Array.isArray(row.activeSecurityGroups)
    ? row.activeSecurityGroups.map(String).sort() : [];
  const requestedSecurityGroup = String(row.requestedSecurityGroup ?? '');
  const managedSecurityGroup = row.managedSecurityGroup === null ? null : String(row.managedSecurityGroup ?? '');
  const managedDescription = row.managedDescription === null ? null : String(row.managedDescription ?? '');
  if (serviceArn !== expectedServiceArn
    || activeSecurityGroups.length < 1 || activeSecurityGroups.length > 2
    || activeSecurityGroups.some((sg) => !/^sg-[0-9a-f]+$/.test(sg))
    || new Set(activeSecurityGroups).size !== activeSecurityGroups.length
    || !activeSecurityGroups.includes(requestedSecurityGroup)
    || (activeSecurityGroups.length === 1 && (managedSecurityGroup !== null || managedDescription !== null))
    || (activeSecurityGroups.length === 2 && (!managedSecurityGroup
      || !activeSecurityGroups.includes(managedSecurityGroup)
      || managedDescription !== `Security group for ECS service: ${serviceArn}`))) {
    throw new Error('recovery network evidence does not exactly identify the requested/managed service groups');
  }
  return {
    serviceArn, activeSecurityGroups, requestedSecurityGroup, managedSecurityGroup, managedDescription,
  };
}

export async function readEcsTaskArn(environment: Environment, metadataUri: string): Promise<string> {
  const url = new URL(metadataUri);
  if (url.protocol !== 'http:' || url.hostname !== '169.254.170.2' || !url.pathname.startsWith('/v4/')) {
    throw new Error('ECS_CONTAINER_METADATA_URI_V4 is not the ECS task metadata endpoint');
  }
  const response = await fetch(`${metadataUri.replace(/\/$/, '')}/task`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`ECS task metadata returned HTTP ${response.status}`);
  const body = await response.json() as { TaskARN?: unknown };
  return validateTaskArn(typeof body.TaskARN === 'string' ? body.TaskARN : '', environment);
}

type TaskCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

type RetirementExpectedState = {
  serviceArn: string;
  deploymentArn: string;
  targetRevisionArn: string;
  activeBuilds: readonly string[];
};

type RetirementPlatformState = {
  deploymentStatus: string;
  currentDeployment: string | null;
  active: Array<{ revision: string; sha: string }>;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

async function readTaskCredentials(): Promise<TaskCredentials> {
  const relative = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ?? '';
  if (!/^\/v2\/credentials\/[A-Za-z0-9_-]+$/.test(relative)) {
    throw new Error('release task has no valid ECS task-role credential endpoint');
  }
  const response = await fetch(`http://169.254.170.2${relative}`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`ECS task-role credentials returned HTTP ${response.status}`);
  const body = await response.json() as Record<string, unknown>;
  const accessKeyId = typeof body.AccessKeyId === 'string' ? body.AccessKeyId : '';
  const secretAccessKey = typeof body.SecretAccessKey === 'string' ? body.SecretAccessKey : '';
  const sessionToken = typeof body.Token === 'string' ? body.Token : '';
  if (!/^ASIA[A-Z0-9]+$/.test(accessKeyId) || !secretAccessKey || !sessionToken) {
    throw new Error('ECS task-role credentials are incomplete');
  }
  return { accessKeyId, secretAccessKey, sessionToken };
}

/** Minimal SigV4 JSON 1.1 client; keeps the release image dependency-free and task-role scoped. */
async function ecsJsonRequest(
  region: string,
  operation: 'DescribeExpressGatewayService' | 'DescribeServiceDeployments' | 'ListServiceDeployments',
  input: Record<string, unknown>,
  credentials: TaskCredentials,
): Promise<Record<string, unknown>> {
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region)) throw new Error('AWS_REGION is invalid');
  const body = JSON.stringify(input);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const host = `ecs.${region}.amazonaws.com`;
  const target = `AmazonEC2ContainerServiceV20141113.${operation}`;
  const canonicalHeaders = [
    'content-type:application/x-amz-json-1.1',
    `host:${host}`,
    `x-amz-date:${amzDate}`,
    `x-amz-security-token:${credentials.sessionToken}`,
    `x-amz-target:${target}`,
  ].join('\n') + '\n';
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-security-token;x-amz-target';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(body)].join('\n');
  const scope = `${date}/${region}/ecs/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${credentials.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 'ecs');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const response = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-date': amzDate,
      'x-amz-security-token': credentials.sessionToken,
      'x-amz-target': target,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`ECS ${operation} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
    (error as Error & { ecsCode?: string }).ecsCode = /ServiceNotFoundException/.test(text)
      ? 'ServiceNotFoundException'
      : undefined;
    throw error;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`ECS ${operation} returned invalid JSON`);
  }
}

async function ssmJsonRequest(
  region: string,
  operation: 'GetParameter' | 'PutParameter',
  input: Record<string, unknown>,
  credentials: TaskCredentials,
): Promise<Record<string, unknown>> {
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region)) throw new Error('AWS_REGION is invalid');
  const body = JSON.stringify(input);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const host = `ssm.${region}.amazonaws.com`;
  const target = `AmazonSSM.${operation}`;
  const canonicalHeaders = [
    'content-type:application/x-amz-json-1.1', `host:${host}`, `x-amz-date:${amzDate}`,
    `x-amz-security-token:${credentials.sessionToken}`, `x-amz-target:${target}`,
  ].join('\n') + '\n';
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-security-token;x-amz-target';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(body)].join('\n');
  const scope = `${date}/${region}/ssm/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${credentials.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 'ssm');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const response = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'content-type': 'application/x-amz-json-1.1', 'x-amz-date': amzDate,
      'x-amz-security-token': credentials.sessionToken, 'x-amz-target': target,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`SSM ${operation} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
    (error as Error & { ssmCode?: string }).ssmCode = /ParameterNotFound/.test(text)
      ? 'ParameterNotFound'
      : /ParameterAlreadyExists/.test(text)
        ? 'ParameterAlreadyExists'
        : undefined;
    throw error;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`SSM ${operation} returned invalid JSON`);
  }
}

export async function ensureRecoveredSsmIdentity(
  region: string,
  parameterName: string,
  expectedServiceArn: string,
  repair: boolean,
): Promise<void> {
  const credentials = await readTaskCredentials();
  if (repair) {
    try {
      // CREATE recovery may fill an absent cache but must never overwrite a value that appeared
      // after the controller's read. ParameterAlreadyExists is resolved only by the two exact
      // reads below: same ARN is an idempotent race, any other value blocks.
      await ssmJsonRequest(region, 'PutParameter', {
        Name: parameterName, Type: 'String', Value: expectedServiceArn, Overwrite: false,
      }, credentials);
    } catch (error) {
      if ((error as Error & { ssmCode?: string }).ssmCode !== 'ParameterAlreadyExists') throw error;
    }
  }
  const read = async () => {
    const response = await ssmJsonRequest(region, 'GetParameter', { Name: parameterName }, credentials);
    return (response.Parameter as Record<string, unknown> | undefined)?.Value;
  };
  const first = await read();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const second = await read();
  if (first !== expectedServiceArn || second !== expectedServiceArn) {
    throw new RemoteReleaseOperationBlocked('intent-owned SSM service cache is not stably exact after recovery');
  }
}

type CurrentApiBuildState = {
  serviceArn: string;
  currentDeployment: string;
  targetRevisionArn: string;
  buildReleaseId: string;
};

function deploymentTargetRevision(deployment: Record<string, any>): string {
  return String(deployment.targetServiceRevisionArn ?? deployment.targetServiceRevision?.arn ?? '');
}

function selectServingDeployment(
  response: Record<string, unknown>,
  currentDeployment: unknown,
): Record<string, any> {
  const rows = response.serviceDeployments;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new RemoteReleaseOperationBlocked('F2 could not resolve a deployment for the serving api-web revision');
  }
  if (typeof currentDeployment === 'string') {
    const exact = rows.filter((row: any) => row?.serviceDeploymentArn === currentDeployment);
    if (exact.length !== 1) {
      throw new RemoteReleaseOperationBlocked('F2 current api-web deployment could not be read exactly once');
    }
    return exact[0] as Record<string, any>;
  }
  if (currentDeployment !== null && currentDeployment !== undefined) {
    throw new RemoteReleaseOperationBlocked('F2 api-web currentDeployment has an invalid shape');
  }
  if (response.nextToken != null) {
    throw new RemoteReleaseOperationBlocked('F2 deployment history is paginated; settled identity is not exhaustive');
  }
  const ranked = rows.map((row: any) => ({
    row,
    createdAt: typeof row?.createdAt === 'number'
      ? row.createdAt * 1_000
      : new Date(String(row?.createdAt ?? '')).getTime(),
  }));
  if (ranked.some((item) => !Number.isFinite(item.createdAt))) {
    throw new RemoteReleaseOperationBlocked('F2 settled deployment history has no exact creation time');
  }
  const newest = Math.max(...ranked.map((item) => item.createdAt));
  const latest = ranked.filter((item) => item.createdAt === newest);
  if (latest.length !== 1) {
    throw new RemoteReleaseOperationBlocked('F2 settled deployment history has an ambiguous newest deployment');
  }
  return latest[0]!.row as Record<string, any>;
}

/** F2 may normalize only the code that is exclusively serving api-web at the instant of mutation. */
export function validateCurrentApiBuildState(
  serviceResponse: Record<string, unknown>,
  deploymentResponse: Record<string, unknown>,
  expectedServiceArn: string,
  expectedBuildReleaseId: string,
): CurrentApiBuildState {
  const service = serviceResponse.service as Record<string, any> | undefined;
  if (!service || service.serviceArn !== expectedServiceArn || service.status?.statusCode !== 'ACTIVE') {
    throw new RemoteReleaseOperationBlocked('F2 api-web service is absent, moved or not ACTIVE');
  }
  if (service.currentDeployment != null
    && (typeof service.currentDeployment !== 'string' || !service.currentDeployment.startsWith('arn:'))) {
    throw new RemoteReleaseOperationBlocked('F2 api-web currentDeployment has an invalid shape');
  }
  if (!Array.isArray(service.activeConfigurations) || service.activeConfigurations.length !== 1) {
    throw new RemoteReleaseOperationBlocked('F2 requires exactly one serving api-web configuration');
  }
  const configuration = service.activeConfigurations[0] as Record<string, any>;
  const revision = typeof configuration.serviceRevisionArn === 'string' ? configuration.serviceRevisionArn : '';
  const shas = Array.isArray(configuration.primaryContainer?.environment)
    ? configuration.primaryContainer.environment
      .filter((item: any) => item?.name === 'GIT_SHA')
      .map((item: any) => item?.value)
    : [];
  if (!revision.startsWith('arn:') || shas.length !== 1 || shas[0] !== expectedBuildReleaseId
    || !/^[0-9a-f]{40}$/.test(shas[0])) {
    throw new RemoteReleaseOperationBlocked('F2 requested SHA is not the exact single full SHA serving api-web');
  }
  const deployment = selectServingDeployment(deploymentResponse, service.currentDeployment);
  const expectedDeploymentPrefix = `${expectedServiceArn.replace(':service/', ':service-deployment/')}/`;
  if (typeof deployment.serviceDeploymentArn !== 'string'
    || !deployment.serviceDeploymentArn.startsWith(expectedDeploymentPrefix)
    || deployment.serviceArn !== expectedServiceArn
    || deployment.status !== 'SUCCESSFUL'
    || deploymentTargetRevision(deployment) !== revision) {
    throw new RemoteReleaseOperationBlocked('F2 api-web current deployment is not exact, successful and serving');
  }
  return {
    serviceArn: expectedServiceArn,
    currentDeployment: deployment.serviceDeploymentArn,
    targetRevisionArn: revision,
    buildReleaseId: shas[0],
  };
}

export async function revalidateCurrentApiBuild(
  region: string,
  environment: Environment,
  taskArn: string,
  expectedBuildReleaseId: string,
): Promise<CurrentApiBuildState> {
  const accountId = taskArn.split(':')[4] ?? '';
  if (!/^[0-9]{12}$/.test(accountId)) throw new Error('F2 cannot derive the release task AWS account');
  const serviceName = environment === 'uat' ? 'watchdog-bms-uat-api-web' : 'watchdog-bms-api-web-pub';
  const serviceArn = `arn:aws:ecs:${region}:${accountId}:service/${expectedCluster(environment)}/${serviceName}`;
  const credentials = await readTaskCredentials();
  const read = async () => {
    const service = await ecsJsonRequest(region, 'DescribeExpressGatewayService', { serviceArn }, credentials);
    const current = (service.service as Record<string, unknown> | undefined)?.currentDeployment;
    const deployment = typeof current === 'string'
      ? await ecsJsonRequest(region, 'DescribeServiceDeployments', {
        serviceDeploymentArns: [current],
      }, credentials)
      : await listAllServiceDeployments(region, {
        service: serviceArn,
      }, credentials);
    return validateCurrentApiBuildState(service, deployment, serviceArn, expectedBuildReleaseId);
  };
  const first = await read();
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const second = await read();
  if (canonicalJson(first) !== canonicalJson(second)) {
    throw new RemoteReleaseOperationBlocked('F2 api-web serving identity moved between two in-task reads');
  }
  return second;
}

type PreIntentApiState = {
  serviceArn: string | null;
  currentDeployment: string | null;
  targetRevisionArn: string | null;
  sourceSha: string | null;
};

/**
 * Prove the narrow crash window where the parent pre-attested api-web but no durable api intent
 * was ever committed. The incoming SHA must be absent and the old singleton must be stable and
 * internally consistent; any dual-build, moving, malformed or mismatched state stays UNKNOWN.
 */
export function validatePreIntentApiNoMutation(
  environment: Environment,
  expectedServiceArn: string,
  incomingBuildReleaseId: string,
  first: { service: Record<string, unknown> | null; deployment: Record<string, unknown> | null; ssmServiceArn: string | null },
  second: { service: Record<string, unknown> | null; deployment: Record<string, unknown> | null; ssmServiceArn: string | null },
): PreIntentApiState {
  if (canonicalJson(first) !== canonicalJson(second)) {
    throw new RemoteReleaseOperationBlocked('pre-intent api-web state moved between recovery reads');
  }
  if (first.ssmServiceArn !== second.ssmServiceArn) {
    throw new RemoteReleaseOperationBlocked('pre-intent api-web SSM identity moved between recovery reads');
  }
  const service = second.service?.service as Record<string, any> | undefined;
  if (!service) {
    if (second.ssmServiceArn !== null || second.deployment !== null) {
      throw new RemoteReleaseOperationBlocked('pre-intent api-web service absence disagrees with SSM/deployment state');
    }
    return { serviceArn: null, currentDeployment: null, targetRevisionArn: null, sourceSha: null };
  }
  if (second.ssmServiceArn !== expectedServiceArn || service.serviceArn !== expectedServiceArn
    || service.status?.statusCode !== 'ACTIVE') {
    throw new RemoteReleaseOperationBlocked('pre-intent api-web service/SSM identity is not exact and ACTIVE');
  }
  if (!Array.isArray(service.activeConfigurations) || service.activeConfigurations.length !== 1) {
    throw new RemoteReleaseOperationBlocked('pre-intent api-web recovery requires one stable serving configuration');
  }
  const active = activeIntentDescriptors(service, environment);
  if (active.length !== 1 || active[0]!.sourceSha === incomingBuildReleaseId) {
    throw new RemoteReleaseOperationBlocked('incoming api-web build is active or the serving singleton is malformed');
  }
  const descriptor = active[0]!;
  const currentDeployment = service.currentDeployment ?? null;
  if (/^[0-9a-f]{12}$/.test(descriptor.sourceSha)) {
    if (currentDeployment !== null || second.deployment !== null) {
      throw new RemoteReleaseOperationBlocked('legacy api-web singleton must preserve null currentDeployment');
    }
  } else {
    if (!second.deployment) {
      throw new RemoteReleaseOperationBlocked('full-SHA api-web singleton requires settled deployment evidence');
    }
    const deployment = selectServingDeployment(second.deployment, currentDeployment);
    if (deployment.serviceArn !== expectedServiceArn
      || deployment.status !== 'SUCCESSFUL'
      || deploymentTargetRevision(deployment) !== descriptor.revisionArn) {
      throw new RemoteReleaseOperationBlocked('pre-intent api-web current deployment is not exact and successful');
    }
  }
  return {
    serviceArn: expectedServiceArn,
    currentDeployment: currentDeployment ?? (second.deployment
      ? String(selectServingDeployment(second.deployment, currentDeployment).serviceDeploymentArn)
      : null),
    targetRevisionArn: descriptor.revisionArn,
    sourceSha: descriptor.sourceSha,
  };
}

type IntentActiveDescriptor = { revisionArn: string; sourceSha: string; configHash: string; image: string };
type IntentRecoveryDecision = {
  status: 'BOUND' | 'CONFIRMED_NO_MUTATION';
  evidence: DeploymentEvidence | null;
  legacyRollback: boolean;
  rollback: boolean;
  failedBuildCleanupRequired: boolean;
  failedBuildCleanupCompleted: boolean;
  repairSsm: boolean;
  observed: Record<string, unknown>;
};

export function validateStoredIntentRecoveryReplay(
  storedStatus: MutationIntentRow['status'],
  storedEvidence: unknown,
  live: IntentRecoveryDecision,
): void {
  const evidence = storedEvidence as DeploymentEvidence | null;
  const evidenceMatches = evidence === null
    ? live.evidence === null
    : live.evidence !== null && sameEvidence(evidence, live.evidence);
  if (live.status !== storedStatus || !evidenceMatches) {
    throw new RemoteReleaseOperationBlocked('closed mutation intent no longer matches fresh remote recovery evidence');
  }
}

export function validateStoredPreIntentReplay(stored: unknown, live: PreIntentApiState): void {
  if (canonicalJson(stored) !== canonicalJson(live)) {
    throw new RemoteReleaseOperationBlocked('pre-intent cleanup marker no longer matches fresh platform evidence');
  }
}

function runtimeConfig(configuration: Record<string, any>): Record<string, unknown> {
  const primary = configuration.primaryContainer ?? {};
  const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const byName = (left: any, right: any) => compareText(String(left?.name ?? ''), String(right?.name ?? ''))
    || compareText(String(left?.value ?? left?.valueFrom ?? ''), String(right?.value ?? right?.valueFrom ?? ''));
  return {
    executionRoleArn: configuration.executionRoleArn ?? null,
    taskRoleArn: configuration.taskRoleArn ?? null,
    cpu: String(configuration.cpu ?? ''),
    memory: String(configuration.memory ?? ''),
    networkConfiguration: {
      securityGroups: [...(configuration.networkConfiguration?.securityGroups ?? [])].sort(),
      subnets: [...(configuration.networkConfiguration?.subnets ?? [])].sort(),
    },
    healthCheckPath: configuration.healthCheckPath ?? null,
    primaryContainer: {
      image: primary.image ?? null,
      containerPort: primary.containerPort ?? null,
      awsLogsConfiguration: primary.awsLogsConfiguration ?? null,
      repositoryCredentials: primary.repositoryCredentials ?? null,
      command: primary.command ?? [],
      environment: [...(primary.environment ?? [])].sort(byName),
      secrets: [...(primary.secrets ?? [])].sort(byName),
    },
    scalingTarget: configuration.scalingTarget ?? null,
  };
}

type RecoveryNetworkEvidence = {
  serviceArn: string;
  activeSecurityGroups: string[];
  requestedSecurityGroup: string;
  managedSecurityGroup: string | null;
  managedDescription: string | null;
};

function matchesRequestedRuntimeConfigHash(
  configuration: Record<string, any>,
  expectedHash: string,
  serviceArn: string,
  networkEvidence: RecoveryNetworkEvidence | null,
): boolean {
  const projected = runtimeConfig(configuration) as Record<string, any>;
  const securityGroups = projected.networkConfiguration?.securityGroups;
  // deploy.sh sends exactly one operator-owned SG. ECS Express may append its managed SG to the
  // active configuration, so recovery removes exactly one candidate at a time and accepts only one
  // cryptographically unique match to the durable request hash.
  if (!Array.isArray(securityGroups) || securityGroups.length < 1 || securityGroups.length > 2
    || securityGroups.some((value) => typeof value !== 'string')
    || new Set(securityGroups).size !== securityGroups.length) return false;
  let candidates = securityGroups;
  if (securityGroups.length === 2) {
    if (!networkEvidence || networkEvidence.serviceArn !== serviceArn
      || canonicalJson([...networkEvidence.activeSecurityGroups].sort()) !== canonicalJson([...securityGroups].sort())
      || networkEvidence.managedSecurityGroup === null
      || networkEvidence.managedDescription !== `Security group for ECS service: ${serviceArn}`
      || !securityGroups.includes(networkEvidence.requestedSecurityGroup)
      || !securityGroups.includes(networkEvidence.managedSecurityGroup)
      || networkEvidence.requestedSecurityGroup === networkEvidence.managedSecurityGroup) return false;
    candidates = [networkEvidence.requestedSecurityGroup];
  }
  const matching = candidates.filter((securityGroup) => {
    const candidate = structuredClone(projected);
    candidate.networkConfiguration.securityGroups = [securityGroup];
    return sha256(`${canonicalJson(candidate)}\n`) === expectedHash;
  });
  return matching.length === 1;
}

function activeIntentDescriptors(service: Record<string, any>, environment: Environment): IntentActiveDescriptor[] {
  if (!Array.isArray(service.activeConfigurations)
    || service.activeConfigurations.length < 1
    || service.activeConfigurations.length > 2) {
    throw new RemoteReleaseOperationBlocked('recovery observed an invalid active configuration window');
  }
  const descriptors = service.activeConfigurations.map((configuration: Record<string, any>) => {
    const revisionArn = validateRevisionArn(String(configuration.serviceRevisionArn ?? ''), environment);
    const shas = Array.isArray(configuration.primaryContainer?.environment)
      ? configuration.primaryContainer.environment.filter((item: any) => item?.name === 'GIT_SHA').map((item: any) => item?.value)
      : [];
    const image = String(configuration.primaryContainer?.image ?? '');
    if (shas.length !== 1 || !/^(?:[0-9a-f]{12}|[0-9a-f]{40})$/.test(String(shas[0])) || !image) {
      throw new RemoteReleaseOperationBlocked('recovery observed an incomplete active build descriptor');
    }
    return {
      revisionArn,
      sourceSha: String(shas[0]),
      // deploy.sh persists `jq -cS ... | shasum`, including jq's trailing newline and raw
      // codepoint ordering. Recovery must reproduce those exact historical bytes.
      configHash: sha256(`${canonicalJson(runtimeConfig(configuration))}\n`),
      image,
    };
  }).sort((left, right) => left.revisionArn.localeCompare(right.revisionArn));
  if (new Set(descriptors.map((item) => item.revisionArn)).size !== descriptors.length) {
    throw new RemoteReleaseOperationBlocked('recovery observed duplicate active revisions');
  }
  return descriptors;
}

function normalizedDeploymentRows(response: Record<string, unknown>): Array<Record<string, any>> {
  const rows = response.serviceDeployments;
  if (!Array.isArray(rows)) throw new RemoteReleaseOperationBlocked('recovery could not list ECS deployments');
  const normalized = rows.map((row: any) => ({
    serviceDeploymentArn: row?.serviceDeploymentArn ?? '',
    serviceArn: row?.serviceArn ?? '',
    status: row?.status ?? '',
    targetRevisionArn: row?.targetServiceRevisionArn ?? row?.targetServiceRevision?.arn ?? '',
    createdAt: row?.createdAt ?? null,
  })).sort((left, right) => String(left.serviceDeploymentArn).localeCompare(String(right.serviceDeploymentArn)));
  const timestamp = (value: unknown) => typeof value === 'number'
    ? value * 1_000
    : new Date(String(value ?? '')).getTime();
  if (normalized.some((row) => !String(row.serviceDeploymentArn).startsWith('arn:aws:ecs:')
    || !String(row.serviceArn).startsWith('arn:aws:ecs:')
    || !String(row.targetRevisionArn).startsWith('arn:aws:ecs:')
    || typeof row.status !== 'string' || !row.status
    || !Number.isFinite(timestamp(row.createdAt)))) {
    throw new RemoteReleaseOperationBlocked('recovery deployment history contains malformed identity or time evidence');
  }
  return normalized;
}

function exactObjectKeys(value: unknown, wanted: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...wanted].sort());
}

export function parseBootstrapClosedRecoveryEvidence(serialized: string): BootstrapClosedRecoveryEvidence {
  if (!serialized || serialized.length > 32_768) {
    throw new Error('RELEASE_BOOTSTRAP_CLOSED_RECOVERY_JSON must be one bounded evidence object');
  }
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error('bootstrap-closed recovery evidence must be valid JSON'); }
  const keys = [
    'artifactDigest', 'boundHistory', 'controllerCommit', 'failedPromotionRunAttempt', 'failedPromotionRunId',
    'maintenanceProofSha256', 'manifestSha256', 'operationId', 'parentTaskArn', 'schemaVersion',
    'services', 'sourceCommit',
  ];
  if (!exactObjectKeys(value, keys)) throw new Error('bootstrap-closed recovery evidence has an unexpected shape');
  const evidence = value as unknown as BootstrapClosedRecoveryEvidence;
  if (evidence.schemaVersion !== 2
    || !/^sha256:[0-9a-f]{64}$/.test(evidence.artifactDigest)
    || !/^[0-9a-f]{64}$/.test(evidence.maintenanceProofSha256)
    || !/^[1-9][0-9]*$/.test(evidence.failedPromotionRunId)
    || !Number.isInteger(evidence.failedPromotionRunAttempt) || evidence.failedPromotionRunAttempt < 1
    || !/^[0-9a-f]{40}$/.test(evidence.controllerCommit)
    || !/^[0-9a-f]{40}$/.test(evidence.sourceCommit)
    || !UUID_PATTERN.test(evidence.operationId)
    || !/^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:task\/watchdog-bms-prod\/[A-Za-z0-9_-]+$/.test(evidence.parentTaskArn)
    || !/^[0-9a-f]{64}$/.test(evidence.manifestSha256)
    || !Array.isArray(evidence.services) || evidence.services.length !== 3
    || !Array.isArray(evidence.boundHistory) || evidence.boundHistory.length > 8) {
    throw new Error('bootstrap-closed recovery evidence identity is invalid');
  }
  const serviceKeys = ['deploymentArn', 'image', 'maintenanceControls', 'noOp', 'service',
    'serviceArn', 'sourceSha', 'targetRevisionArn'];
  const historyKeys = ['deploymentArn', 'noOp', 'service', 'serviceArn', 'sourceSha', 'targetRevisionArn'];
  const [, , , region, accountId] = evidence.parentTaskArn.split(':');
  const identities: Record<string, { serviceName: string; repository: string }> = {
    'api-web': { serviceName: 'watchdog-bms-api-web-pub', repository: 'watchdog-bms-api' },
    'ai-gateway': { serviceName: 'watchdog-bms-ai-gateway-v2', repository: 'watchdog-bms-ai-gateway' },
    workers: { serviceName: 'watchdog-bms-workers', repository: 'watchdog-bms-workers' },
  };
  if (canonicalJson(evidence.services.map((item) => item.service).sort())
      !== canonicalJson(['ai-gateway', 'api-web', 'workers'])
    || evidence.services.some((item) => {
      const identity = identities[item.service];
      const serviceArn = `arn:aws:ecs:${region}:${accountId}:service/watchdog-bms-prod/${identity?.serviceName}`;
      return !identity || !exactObjectKeys(item, serviceKeys)
        || item.noOp !== false || item.sourceSha !== evidence.sourceCommit
        || item.serviceArn !== serviceArn
        || !item.deploymentArn.startsWith(serviceArn.replace(':service/', ':service-deployment/') + '/')
        || !item.targetRevisionArn.startsWith(serviceArn.replace(':service/', ':service-revision/') + '/')
        || !new RegExp(`^${accountId}\\.dkr\\.ecr\\.${region}\\.amazonaws\\.com/${identity.repository}@sha256:[0-9a-f]{64}$`).test(item.image)
        || item.maintenanceControls === null || typeof item.maintenanceControls !== 'object'
        || Array.isArray(item.maintenanceControls);
    })) {
    throw new Error('bootstrap-closed recovery service evidence is invalid');
  }
  const sortedHistory = evidence.boundHistory.slice().sort(compareDeploymentEvidence);
  if (canonicalJson(sortedHistory) !== canonicalJson(evidence.boundHistory)
    || new Set(evidence.boundHistory.map(canonicalJson)).size !== evidence.boundHistory.length
    || evidence.boundHistory.some((item) => {
      const identity = identities[item.service];
      const serviceArn = `arn:aws:ecs:${region}:${accountId}:service/watchdog-bms-prod/${identity?.serviceName}`;
      return !identity || item.service === 'api-web' || !exactObjectKeys(item, historyKeys)
        || item.sourceSha !== evidence.sourceCommit || item.serviceArn !== serviceArn
        || !item.targetRevisionArn.startsWith(serviceArn.replace(':service/', ':service-revision/') + '/')
        || item.noOp !== false || typeof item.deploymentArn !== 'string'
        || !item.deploymentArn.startsWith(serviceArn.replace(':service/', ':service-deployment/') + '/');
    })
    || [...new Set(evidence.boundHistory.map((item) => item.service))].some((service) =>
      !evidence.services.some((current) => current.service === service
        && evidence.boundHistory.some((item) => sameEvidence(current, item))))) {
    throw new Error('bootstrap-closed recovery bound history is invalid');
  }
  return evidence;
}

type BootstrapClosedPlatformRead = {
  service: string;
  serviceResponse: Record<string, unknown>;
  deploymentResponse: Record<string, unknown>;
};

/** Proves the exact candidate remains a stable, globally closed singleton after the failed controller. */
export function validateBootstrapClosedRecoveryPlatform(
  evidence: BootstrapClosedRecoveryEvidence,
  reads: readonly BootstrapClosedPlatformRead[],
): BootstrapClosedRecoveryService[] {
  if (reads.length !== 3 || canonicalJson(reads.map((item) => item.service).sort())
      !== canonicalJson(['ai-gateway', 'api-web', 'workers'])) {
    throw new RemoteReleaseOperationBlocked('bootstrap-closed recovery did not read all three exact services');
  }
  return reads.map((read) => {
    const expected = evidence.services.find((item) => item.service === read.service)!;
    const service = read.serviceResponse.service as Record<string, any> | undefined;
    if (!service || service.serviceArn !== expected.serviceArn || service.status?.statusCode !== 'ACTIVE'
      || service.currentDeployment != null || !Array.isArray(service.activeConfigurations)
      || service.activeConfigurations.length !== 1) {
      throw new RemoteReleaseOperationBlocked(`${read.service} is not the exact settled bootstrap-closed service`);
    }
    const configuration = service.activeConfigurations[0] as Record<string, any>;
    if (configuration.serviceRevisionArn !== expected.targetRevisionArn
      || configuration.primaryContainer?.image !== expected.image) {
      throw new RemoteReleaseOperationBlocked(`${read.service} image or revision moved after bootstrap closure`);
    }
    const values = new Map<string, string[]>();
    for (const item of configuration.primaryContainer?.environment ?? []) {
      if (typeof item?.name !== 'string' || typeof item?.value !== 'string') continue;
      values.set(item.name, [...(values.get(item.name) ?? []), item.value]);
    }
    const one = (name: string): string => {
      const found = values.get(name) ?? [];
      if (found.length !== 1) throw new RemoteReleaseOperationBlocked(`${read.service} ${name} is not singular`);
      return found[0]!;
    };
    const controls = read.service === 'api-web' ? {
      globalMaintenanceMode: one('GLOBAL_MAINTENANCE_MODE'),
      reimbursementWriteQuiesce: one('REIMBURSEMENT_WRITE_QUIESCE'),
      crmAutoReplyEnabled: one('CRM_AUTO_REPLY_ENABLED'),
      aiGatewayEnabled: one('AI_GATEWAY_ENABLED'),
      lineAiLedgerEnabled: one('LINE_AI_LEDGER_ENABLED'),
    } : read.service === 'ai-gateway' ? {
      modelProvider: one('MODEL_PROVIDER'),
      aiGatewayEnabled: one('AI_GATEWAY_ENABLED'),
      aiAgentRegistryEnabled: one('AI_AGENT_REGISTRY_ENABLED'),
      aiToolPolicyEnforced: one('AI_TOOL_POLICY_ENFORCED'),
      aiToolAuditEnabled: one('AI_TOOL_AUDIT_ENABLED'),
    } : { queueEnabled: one('QUEUE_ENABLED') };
    if (one('GIT_SHA') !== evidence.sourceCommit || one('PRODUCTION_SERVING_MODE') !== 'maintenance_only'
      || canonicalJson(controls) !== canonicalJson(expected.maintenanceControls)) {
      throw new RemoteReleaseOperationBlocked(`${read.service} no longer has the exact bootstrap maintenance controls`);
    }
    const deployments = normalizedDeploymentRows(read.deploymentResponse);
    if (deployments.length !== 1 || deployments[0]!.serviceDeploymentArn !== expected.deploymentArn
      || deployments[0]!.serviceArn !== expected.serviceArn || deployments[0]!.status !== 'SUCCESSFUL'
      || deployments[0]!.targetRevisionArn !== expected.targetRevisionArn) {
      throw new RemoteReleaseOperationBlocked(`${read.service} bootstrap deployment is not exact and successful`);
    }
    return expected;
  }).sort((left, right) => left.service.localeCompare(right.service));
}

/** Pure, adversarially testable decision. Anything beyond one exact causal result remains blocked. */
export function decideMutationIntentRecovery(
  intent: MutationIntentRow,
  environment: Environment,
  firstDeployments: Record<string, unknown>,
  firstService: Record<string, unknown> | null,
  secondDeployments: Record<string, unknown>,
  secondService: Record<string, unknown> | null,
  observedSsmServiceArn: string | null,
  networkEvidence: RecoveryNetworkEvidence | null = null,
): IntentRecoveryDecision {
  const deploymentsA = normalizedDeploymentRows(firstDeployments);
  const deploymentsB = normalizedDeploymentRows(secondDeployments);
  if (firstDeployments.nextToken != null || secondDeployments.nextToken != null) {
    throw new RemoteReleaseOperationBlocked('recovery deployment window is paginated; causal result is not exhaustive');
  }
  if (canonicalJson(deploymentsA) !== canonicalJson(deploymentsB)
    || canonicalJson(firstService) !== canonicalJson(secondService)) {
    throw new RemoteReleaseOperationBlocked('remote ECS state moved between recovery reads');
  }
  if (observedSsmServiceArn !== null && observedSsmServiceArn !== intent.expectedServiceArn) {
    throw new RemoteReleaseOperationBlocked('SSM service identity disagrees with the durable mutation intent');
  }
  if (intent.mutationKind === 'UPDATE' && observedSsmServiceArn === null) {
    throw new RemoteReleaseOperationBlocked('UPDATE recovery requires the exact persisted SSM service identity');
  }
  const beforeDeployments = Array.isArray(intent.beforeDeploymentArnsJson)
    ? intent.beforeDeploymentArnsJson as string[] : [];
  const started = new Date(intent.requestStartedAt).getTime() - 5_000;
  const deadline = new Date(intent.requestDeadlineAt).getTime() + 5_000;
  const candidates = deploymentsA.filter((row) => {
    const created = typeof row.createdAt === 'number'
      ? row.createdAt * 1000
      : new Date(String(row.createdAt)).getTime();
    return !beforeDeployments.includes(row.serviceDeploymentArn)
      && Number.isFinite(created) && created >= started && created <= deadline;
  });
  const unexpectedLater = deploymentsA.filter((row) => {
    const created = typeof row.createdAt === 'number'
      ? row.createdAt * 1000
      : new Date(String(row.createdAt)).getTime();
    return !beforeDeployments.includes(row.serviceDeploymentArn)
      && Number.isFinite(created) && created > deadline;
  });
  if (unexpectedLater.length !== 0) {
    throw new RemoteReleaseOperationBlocked('a later ECS deployment exists after the durable mutation intent window');
  }
  if (candidates.length > 1) throw new RemoteReleaseOperationBlocked('multiple causal ECS deployments match one mutation intent');
  for (const row of candidates) {
    if (row.serviceArn !== intent.expectedServiceArn) {
      throw new RemoteReleaseOperationBlocked('causal deployment belongs to another service');
    }
    const revision = validateRevisionArn(String(row.targetRevisionArn), environment);
    if (!revision.includes(`/${intent.serviceName}/`)) {
      throw new RemoteReleaseOperationBlocked('causal deployment target revision belongs to another service');
    }
  }

  const service = secondService?.service as Record<string, any> | undefined;
  if (!service) {
    if (intent.mutationKind === 'CREATE' && candidates.length === 0 && observedSsmServiceArn === null) {
      return {
        status: 'CONFIRMED_NO_MUTATION', evidence: null, legacyRollback: false, rollback: false,
        failedBuildCleanupRequired: intent.serviceKey === 'api-web', failedBuildCleanupCompleted: false, repairSsm: false,
        observed: { service: null, deployments: deploymentsB },
      };
    }
    throw new RemoteReleaseOperationBlocked('expected ECS service is absent after a non-create or causal mutation');
  }
  if (service.serviceArn !== intent.expectedServiceArn) {
    throw new RemoteReleaseOperationBlocked('recovery observed a different ECS service identity');
  }
  if (service.status?.statusCode !== 'ACTIVE') {
    throw new RemoteReleaseOperationBlocked('recovery requires the exact ECS Express service to be ACTIVE');
  }
  const active = activeIntentDescriptors(service, environment);
  const beforeActive = intent.beforeActiveConfigurationsJson as unknown[];
  const beforeUnchanged = canonicalJson(active) === canonicalJson(beforeActive)
    && (service.currentDeployment ?? null) === intent.beforeCurrentDeploymentArn;
  const candidate = candidates[0];
  if (!candidate) {
    if (!beforeUnchanged) throw new RemoteReleaseOperationBlocked('zero causal deployments but ECS before-state changed');
    const desiredAlreadyServing = active.length === 1
      && active[0]!.sourceSha === intent.buildReleaseId
      && matchesRequestedRuntimeConfigHash(
        service.activeConfigurations[0], intent.desiredConfigHash, intent.expectedServiceArn, networkEvidence,
      );
    if (desiredAlreadyServing) {
      return {
        status: 'BOUND',
        evidence: {
          service: intent.serviceKey, serviceArn: intent.expectedServiceArn, deploymentArn: null,
          targetRevisionArn: active[0]!.revisionArn, sourceSha: intent.buildReleaseId, noOp: true,
        },
        legacyRollback: false, rollback: false,
        failedBuildCleanupRequired: false, failedBuildCleanupCompleted: false, repairSsm: false,
        observed: { service: { currentDeployment: service.currentDeployment ?? null, active }, deployments: deploymentsB },
      };
    }
    return {
      status: 'CONFIRMED_NO_MUTATION', evidence: null, legacyRollback: false, rollback: false,
      failedBuildCleanupRequired: intent.serviceKey === 'api-web', failedBuildCleanupCompleted: false, repairSsm: false,
      observed: { service: { currentDeployment: service.currentDeployment ?? null, active }, deployments: deploymentsB },
    };
  }
  const exactTarget = active.length === 1 && active[0]!.revisionArn === candidate.targetRevisionArn
    && active[0]!.sourceSha === intent.buildReleaseId
    && matchesRequestedRuntimeConfigHash(
      service.activeConfigurations[0], intent.desiredConfigHash, intent.expectedServiceArn, networkEvidence,
    );
  const candidateIsCurrentOrSettled = service.currentDeployment == null
    || service.currentDeployment === candidate.serviceDeploymentArn;
  if (candidate.status === 'SUCCESSFUL' && exactTarget && candidateIsCurrentOrSettled) {
    return {
      status: 'BOUND',
      evidence: {
        service: intent.serviceKey, serviceArn: intent.expectedServiceArn,
        deploymentArn: candidate.serviceDeploymentArn, targetRevisionArn: candidate.targetRevisionArn,
        sourceSha: intent.buildReleaseId, noOp: false,
      },
      legacyRollback: false,
      rollback: false,
      failedBuildCleanupRequired: false,
      failedBuildCleanupCompleted: false,
      repairSsm: intent.mutationKind === 'CREATE' && observedSsmServiceArn === null,
      observed: { service: { currentDeployment: service.currentDeployment ?? null, active }, candidate },
    };
  }
  const exactRollback = candidate.status === 'ROLLBACK_SUCCESSFUL'
    && candidateIsCurrentOrSettled
    && canonicalJson(active) === canonicalJson(intent.beforeActiveConfigurationsJson);
  if (exactRollback) {
    const legacyRollback = intent.legacyBootstrapDescriptorJson !== null
      && canonicalJson(active) === canonicalJson([intent.legacyBootstrapDescriptorJson]);
    return {
      status: 'BOUND',
      evidence: {
        service: intent.serviceKey, serviceArn: intent.expectedServiceArn,
        deploymentArn: candidate.serviceDeploymentArn, targetRevisionArn: candidate.targetRevisionArn,
        sourceSha: intent.buildReleaseId, noOp: false,
      },
      legacyRollback, rollback: true,
      failedBuildCleanupRequired: intent.serviceKey === 'api-web', failedBuildCleanupCompleted: false,
      repairSsm: false,
      observed: { service: { currentDeployment: service.currentDeployment ?? null, active }, candidate },
    };
  }
  throw new RemoteReleaseOperationBlocked('causal ECS deployment does not resolve to exact success or exact legacy rollback');
}

export function validateOrphanMutationPlatform(
  intent: MutationIntent,
  evidence: DeploymentEvidence,
  environment: Environment,
  deploymentResponse: Record<string, unknown>,
  historyResponse: Record<string, unknown>,
  serviceResponse: Record<string, unknown>,
  networkEvidence: RecoveryNetworkEvidence | null,
): Record<string, unknown> {
  if (intent.serviceKey === 'api-web' || intent.mutationKind !== 'UPDATE'
    || intent.legacyBootstrapDescriptor === null
    || canonicalJson(intent.legacyBootstrapDescriptor) !== canonicalJson(intent.beforeActiveConfigurations[0])) {
    throw new RemoteReleaseOperationBlocked('orphan recovery is limited to the proven non-api legacy-descriptor failure shape');
  }
  if (evidence.noOp || evidence.deploymentArn === null || evidence.service !== intent.serviceKey
    || evidence.serviceArn !== intent.expectedServiceArn) {
    throw new RemoteReleaseOperationBlocked('orphan binder evidence does not match the failed intent service');
  }
  const deployments = deploymentResponse.serviceDeployments;
  if (!Array.isArray(deployments) || deployments.length !== 1) {
    throw new RemoteReleaseOperationBlocked('orphan deployment evidence is not exactly readable');
  }
  const deployment = deployments[0] as Record<string, any>;
  if (deployment.serviceDeploymentArn !== evidence.deploymentArn
    || deployment.serviceArn !== evidence.serviceArn
    || deployment.status !== 'SUCCESSFUL'
    || deploymentTargetRevision(deployment) !== evidence.targetRevisionArn) {
    throw new RemoteReleaseOperationBlocked('orphan deployment is not the exact successful binder target');
  }
  if (historyResponse.nextToken != null) {
    throw new RemoteReleaseOperationBlocked('orphan deployment history is paginated');
  }
  const history = normalizedDeploymentRows(historyResponse);
  const causal = history.filter((row) => row.serviceDeploymentArn === evidence.deploymentArn);
  if (causal.length !== 1) throw new RemoteReleaseOperationBlocked('orphan deployment is absent or duplicated in service history');
  const epoch = (value: unknown) => typeof value === 'number'
    ? value * 1_000
    : new Date(String(value ?? '')).getTime();
  const causalEpoch = epoch(causal[0]!.createdAt);
  if (!Number.isFinite(causalEpoch) || history.some((row) => {
    const observed = epoch(row.createdAt);
    return !Number.isFinite(observed) || observed > causalEpoch
      || (observed === causalEpoch && row.serviceDeploymentArn !== evidence.deploymentArn);
  })) {
    throw new RemoteReleaseOperationBlocked('orphan deployment is not the unique newest service deployment');
  }
  const service = serviceResponse.service as Record<string, any> | undefined;
  if (!service || service.serviceArn !== evidence.serviceArn || service.status?.statusCode !== 'ACTIVE') {
    throw new RemoteReleaseOperationBlocked('orphan service is not the exact ACTIVE service');
  }
  if (service.currentDeployment != null && service.currentDeployment !== evidence.deploymentArn) {
    throw new RemoteReleaseOperationBlocked('orphan service has a different non-null current deployment');
  }
  const active = activeIntentDescriptors(service, environment);
  if (active.length !== 1 || active[0]!.revisionArn !== evidence.targetRevisionArn
    || active[0]!.sourceSha !== evidence.sourceSha
    || !matchesRequestedRuntimeConfigHash(
      service.activeConfigurations[0], intent.desiredConfigHash, intent.expectedServiceArn, networkEvidence,
    )) {
    throw new RemoteReleaseOperationBlocked('orphan service does not exclusively serve the exact requested target');
  }
  return {
    deploymentArn: evidence.deploymentArn,
    currentDeployment: service.currentDeployment ?? null,
    active,
  };
}

export async function recoverOrphanReleaseMutationIntent(
  client: Client,
  input: {
    operationId: string;
    targetEnvironment: Environment;
    buildReleaseId: string;
    recoveryExecutorBuildReleaseId: string;
    recoveryExecutorImage: string;
    recoveryValidatedCiRunId: string;
    recovererTaskArn: string;
    controller: ControllerProvenance;
    region: string;
    intent: MutationIntent;
    evidence: DeploymentEvidence;
    taskEvidence: OrphanTaskEvidence;
    networkEvidence: RecoveryNetworkEvidence;
    stoppedParentTaskEvidence?: StoppedParentTaskEvidence | null;
    readPlatform?: () => Promise<{ platform: Record<string, unknown>; ssmServiceArn: string }>;
  },
): Promise<{ replay: boolean }> {
  await markExpiredTargetUnknown(client, input.operationId, input.targetEnvironment, {
    buildReleaseId: input.buildReleaseId,
    recovererTaskArn: input.recovererTaskArn,
    controller: input.controller,
    stoppedParentTaskEvidence: input.stoppedParentTaskEvidence ?? null,
  });
  if (input.evidence.sourceSha !== input.buildReleaseId) {
    throw new RemoteReleaseOperationBlocked('orphan binder evidence belongs to another target build');
  }
  const read = input.readPlatform ?? (async () => {
    const credentials = await readTaskCredentials();
    const [deployment, history, service, ssm] = await Promise.all([
      ecsJsonRequest(input.region, 'DescribeServiceDeployments', {
        serviceDeploymentArns: [input.evidence.deploymentArn],
      }, credentials),
      listAllServiceDeployments(input.region, {
        service: input.evidence.serviceArn,
      }, credentials),
      ecsJsonRequest(input.region, 'DescribeExpressGatewayService', {
        serviceArn: input.evidence.serviceArn,
      }, credentials),
      ssmJsonRequest(input.region, 'GetParameter', { Name: input.intent.ssmParameterName }, credentials),
    ]);
    const ssmServiceArn = (ssm.Parameter as Record<string, unknown> | undefined)?.Value;
    if (ssmServiceArn !== input.evidence.serviceArn) {
      throw new RemoteReleaseOperationBlocked('orphan recovery SSM identity is not exact');
    }
    const platform = validateOrphanMutationPlatform(
      input.intent, input.evidence, input.targetEnvironment, deployment, history, service, input.networkEvidence,
    );
    return { platform, ssmServiceArn };
  });
  const first = await read();
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const second = await read();
  if (canonicalJson(first) !== canonicalJson(second)) {
    throw new RemoteReleaseOperationBlocked('orphan platform/SSM evidence moved between two reads');
  }

  await client.query('BEGIN');
  try {
    const parent = await client.query<ParentOperationRow>(`
      SELECT "id", "status", "mode", "releaseDeployTarget", "buildReleaseId", "ecsTaskArn", "leaseOwner",
             false AS "leaseExpired", "deploymentManifestJson", "preIntentApiCleanupCompletedAt",
             "preIntentApiCleanupEvidenceJson", "sourceBranch", "controllerKind", "githubRunId",
             "githubRunAttempt", "githubActor", "githubActorId", "githubWorkflowRef",
             "githubRepository", "manualActorRef"
        FROM "RemoteReleaseOperation"
       WHERE "id" = $1 AND "targetEnvironment" = $2 FOR UPDATE
    `, [input.operationId, input.targetEnvironment]);
    const row = parent.rows[0];
    if (!row || !['UNKNOWN', 'RECONCILED_FAILED_CONFIRMED'].includes(row.status) || row.mode !== 'release'
      || row.buildReleaseId !== input.buildReleaseId
      || row.ecsTaskArn !== input.taskEvidence.parentTaskArn
      || !sameController(row, input.taskEvidence.originalController)
      || (row.releaseDeployTarget !== 'all' && row.releaseDeployTarget !== input.intent.serviceKey)) {
      throw new RemoteReleaseOperationBlocked('orphan evidence does not belong to the exact UNKNOWN held release');
    }
    const existing = await client.query<MutationIntentRow & { preparedByTaskArn: string }>(`
      SELECT * FROM "RemoteReleaseMutationIntent"
       WHERE "id" = $1 AND "operationId" = $2 FOR UPDATE
    `, [input.intent.id, input.operationId]);
    if (existing.rows[0]) {
      const existingRow = existing.rows[0];
      const manifest = Array.isArray(row.deploymentManifestJson)
        ? row.deploymentManifestJson as DeploymentEvidence[] : [];
      if (existingRow.status === 'BOUND' && existingRow.buildReleaseId === input.buildReleaseId
        && existingRow.preparedByTaskArn === input.taskEvidence.intentTaskArn
        && sameEvidence(existingRow.evidenceJson as DeploymentEvidence, input.evidence)
        && manifest.some((item) => sameEvidence(item, input.evidence))) {
        await client.query('COMMIT');
        return { replay: true };
      }
      throw new RemoteReleaseOperationBlocked('orphan intent identity already exists with different evidence');
    }
    if (row.status !== 'UNKNOWN') {
      throw new RemoteReleaseOperationBlocked('a terminal parent cannot accept new orphan evidence');
    }
    const conflicts = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM "RemoteReleaseMutationIntent"
       WHERE "operationId" = $1 AND ("id" = $2 OR "serviceKey" = $3)
    `, [input.operationId, input.intent.id, input.intent.serviceKey]);
    if ((conflicts.rows[0]?.count ?? 0) !== 0) {
      throw new RemoteReleaseOperationBlocked('orphan service already has durable intent evidence');
    }
    let manifest = Array.isArray(row.deploymentManifestJson)
      ? row.deploymentManifestJson as DeploymentEvidence[] : [];
    if (!manifest.some((item) => sameEvidence(item, input.evidence))) {
      if (manifest.length >= 8) throw new RemoteReleaseOperationBlocked('orphan evidence would exceed the manifest bound');
      manifest = [...manifest, input.evidence].sort((left, right) => left.service.localeCompare(right.service)
        || (left.deploymentArn ?? '').localeCompare(right.deploymentArn ?? '')
        || left.targetRevisionArn.localeCompare(right.targetRevisionArn));
    }
    await client.query(`
      INSERT INTO "RemoteReleaseMutationIntent" (
        "id", "operationId", "targetEnvironment", "buildReleaseId", "serviceKey", "mutationKind",
        "expectedServiceArn", "clusterName", "serviceName", "ssmParameterName", "requestHash",
        "desiredConfigHash", "beforeDeploymentArnsJson", "beforeCurrentDeploymentArn",
        "beforeActiveConfigurationsJson", "legacyBootstrapDescriptorJson", "preparedByTaskArn",
        "status", "evidenceJson", "closedByTaskArn", "recovererControllerJson", "requestStartedAt",
        "requestDeadlineAt", "closedAt", "createdAt", "updatedAt"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb,NULL,$16,
                'BOUND',$17::jsonb,$18,$19::jsonb,$20::timestamptz,$21::timestamptz,
                CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `, [
      input.intent.id, input.operationId, input.targetEnvironment, input.buildReleaseId,
      input.intent.serviceKey, input.intent.mutationKind, input.intent.expectedServiceArn,
      input.intent.clusterName, input.intent.serviceName, input.intent.ssmParameterName,
      input.intent.requestHash, input.intent.desiredConfigHash,
      JSON.stringify(input.intent.beforeDeploymentArns), input.intent.beforeCurrentDeploymentArn,
      JSON.stringify(input.intent.beforeActiveConfigurations), input.taskEvidence.intentTaskArn,
      JSON.stringify(input.evidence), input.recovererTaskArn, JSON.stringify(input.controller),
      input.taskEvidence.intentStartedAt, input.taskEvidence.binderStoppedAt,
    ]);
    await client.query(`
      UPDATE "RemoteReleaseOperation" SET "deploymentManifestJson" = $2::jsonb, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "status" = 'UNKNOWN'
    `, [input.operationId, JSON.stringify(manifest)]);
    await client.query(`
      INSERT INTO "AuditLog" (
        "id", "companyId", "actorType", "actorUserId", "actorRefId", "action", "targetType",
        "targetId", "requestId", "result", "riskLevel", "metadataJson", "createdAt"
      ) VALUES ($1,NULL,'SERVICE',NULL,$2,'system.release_operation.recover_orphan_mutation',
                'RemoteReleaseMutationIntent',$3,$4,'SUCCESS','CRITICAL',$5::jsonb,CURRENT_TIMESTAMP)
    `, [randomUUID(), input.recovererTaskArn, input.intent.id, `release-orphan-recovery:${input.intent.id}`,
      JSON.stringify({
        taskEvidence: input.taskEvidence,
        networkEvidence: input.networkEvidence,
        rawLegacyDescriptorHash: sha256(canonicalJson(input.intent.legacyBootstrapDescriptor)),
        platform: second.platform,
        targetBuildReleaseId: input.buildReleaseId,
        recoveryExecutorBuildReleaseId: input.recoveryExecutorBuildReleaseId,
        recoveryExecutorImage: input.recoveryExecutorImage,
        recoveryValidatedCiRunId: input.recoveryValidatedCiRunId,
        recoveryExecutorSignerIdentity: `https://github.com/${input.controller.githubWorkflowRef}`,
        controller: input.controller,
      })]);
    await client.query('COMMIT');
    return { replay: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function recoverRemoteReleaseMutationIntent(
  client: Client,
  input: {
    operationId: string; intentId: string; targetEnvironment: Environment; buildReleaseId: string;
    recoveryExecutorBuildReleaseId: string;
    recoveryExecutorImage: string;
    recoveryValidatedCiRunId: string;
    recovererTaskArn: string; controller: ControllerProvenance; region: string;
    networkEvidence: RecoveryNetworkEvidence | null;
    observedSsmServiceArn: string | null; expectedServiceArn: string; ssmParameterName: string;
    stoppedParentTaskEvidence?: StoppedParentTaskEvidence | null;
    readPlatform?: () => Promise<{
      deployments: Record<string, unknown>; service: Record<string, unknown> | null;
    }>;
    readSsmServiceArn?: () => Promise<string | null>;
    ensureSsmIdentity?: typeof ensureRecoveredSsmIdentity;
  },
): Promise<IntentRecoveryDecision & {
  replay: boolean; legacyCutoverCompleted: boolean; terminalReplay: boolean;
}> {
  await markExpiredTargetUnknown(client, input.operationId, input.targetEnvironment, {
    buildReleaseId: input.buildReleaseId,
    recovererTaskArn: input.recovererTaskArn,
    controller: input.controller,
    stoppedParentTaskEvidence: input.stoppedParentTaskEvidence ?? null,
  });
  const intentResult = await client.query<MutationIntentRow>(`
    SELECT * FROM "RemoteReleaseMutationIntent"
     WHERE "id" = $1 AND "operationId" = $2 AND "targetEnvironment" = $3
  `, [input.intentId, input.operationId, input.targetEnvironment]);
  const intent = intentResult.rows[0];
  if (!intent || intent.buildReleaseId !== input.buildReleaseId) {
    throw new RemoteReleaseOperationBlocked('recovery target is not the exact release mutation intent');
  }
  if (intent.expectedServiceArn !== input.expectedServiceArn || intent.ssmParameterName !== input.ssmParameterName) {
    throw new RemoteReleaseOperationBlocked('recovery controller did not name the intent-owned ECS/SSM identities');
  }
  const replayParent = await client.query<{
    status: string; mode: string; buildReleaseId: string; ecsTaskArn: string;
  }>(`
    SELECT "status", "mode", "buildReleaseId", "ecsTaskArn" FROM "RemoteReleaseOperation"
     WHERE "id" = $1 AND "targetEnvironment" = $2
  `, [input.operationId, input.targetEnvironment]);
  const replayParentRow = replayParent.rows[0];
  if (!replayParentRow
    || !['UNKNOWN', 'RECONCILED_FAILED_CONFIRMED'].includes(replayParentRow.status)
    || replayParentRow.mode !== 'release'
    || replayParentRow.buildReleaseId !== input.buildReleaseId) {
    throw new RemoteReleaseOperationBlocked('recovery parent is not the exact UNKNOWN/recovered held release');
  }
  const terminalReplay = replayParentRow.status === 'RECONCILED_FAILED_CONFIRMED';
  if (terminalReplay && intent.status === 'OPEN') {
    throw new RemoteReleaseOperationBlocked('a recovered parent cannot acquire new OPEN intent evidence');
  }
  let credentials: TaskCredentials | undefined;
  const getCredentials = async () => {
    if (!credentials) credentials = await readTaskCredentials();
    return credentials;
  };
  let read = input.readPlatform;
  if (!read) {
    const taskCredentials = await getCredentials();
    read = async () => {
      let deployments: Record<string, unknown>;
      try {
        deployments = await listAllServiceDeployments(input.region, {
          service: intent.expectedServiceArn,
          createdAt: {
            after: (new Date(intent.requestStartedAt).getTime() - 5_000) / 1000,
          },
        }, taskCredentials);
      } catch (error) {
        if ((error as Error & { ecsCode?: string }).ecsCode === 'ServiceNotFoundException'
          && intent.mutationKind === 'CREATE') deployments = { serviceDeployments: [] };
        else throw error;
      }
      let service: Record<string, unknown> | null;
      try {
        service = await ecsJsonRequest(input.region, 'DescribeExpressGatewayService', {
          serviceArn: intent.expectedServiceArn,
        }, taskCredentials);
      } catch (error) {
        if ((error as Error & { ecsCode?: string }).ecsCode === 'ServiceNotFoundException') service = null;
        else throw error;
      }
      return { deployments, service };
    };
  }
  let readSsmServiceArn = input.readSsmServiceArn;
  if (!readSsmServiceArn) {
    const taskCredentials = await getCredentials();
    readSsmServiceArn = async () => {
      try {
        const ssm = await ssmJsonRequest(input.region, 'GetParameter', {
          Name: input.ssmParameterName,
        }, taskCredentials);
        const value = (ssm.Parameter as Record<string, unknown> | undefined)?.Value;
        return typeof value === 'string' ? value : '';
      } catch (error) {
        if ((error as Error & { ssmCode?: string }).ssmCode === 'ParameterNotFound') return null;
        throw error;
      }
    };
  }
  const first = await read();
  const firstSsmServiceArn = await readSsmServiceArn();
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const second = await read();
  const secondSsmServiceArn = await readSsmServiceArn();
  if (firstSsmServiceArn !== input.observedSsmServiceArn
    || secondSsmServiceArn !== input.observedSsmServiceArn) {
    throw new RemoteReleaseOperationBlocked(
      input.observedSsmServiceArn === null
        ? 'controller-observed missing SSM identity appeared during in-task recovery reads'
        : 'controller-observed SSM identity moved during in-task recovery reads',
    );
  }
  const decision = decideMutationIntentRecovery(
    intent, input.targetEnvironment, first.deployments, first.service,
    second.deployments, second.service, secondSsmServiceArn, input.networkEvidence,
  );

  const completeSsmIdentity = async () => {
    if (decision.status === 'BOUND' || input.observedSsmServiceArn !== null) {
      await (input.ensureSsmIdentity ?? ensureRecoveredSsmIdentity)(
        input.region,
        input.ssmParameterName,
        input.expectedServiceArn,
        decision.status === 'BOUND' && decision.repairSsm,
      );
    }
  };

  if (intent.status !== 'OPEN') {
    validateStoredIntentRecoveryReplay(intent.status, intent.evidenceJson, decision);
    if (terminalReplay) {
      const cleanupRequired = intent.failedBuildCleanupRequiredAt !== null;
      const legacyRollbackObserved = intent.legacyRollbackObservedAt !== null;
      const liveCleanupConflict = cleanupRequired !== decision.failedBuildCleanupRequired
        || legacyRollbackObserved !== decision.legacyRollback;
      const cleanupIncomplete = (cleanupRequired && intent.failedBuildCleanupCompletedAt === null)
        || (legacyRollbackObserved && intent.legacyRollbackCleanedAt === null);
      const legacyCutoverIncomplete = intent.legacyBootstrapDescriptorJson !== null
        && decision.status === 'BOUND' && !decision.rollback
        && decision.evidence?.noOp === false && intent.legacyCutoverCompletedAt === null;
      if (decision.repairSsm || liveCleanupConflict || cleanupIncomplete || legacyCutoverIncomplete) {
        throw new RemoteReleaseOperationBlocked(
          'terminal recovery replay discovered conflicting or incomplete cleanup/SSM state',
        );
      }
      return {
        ...decision,
        failedBuildCleanupRequired: cleanupRequired,
        failedBuildCleanupCompleted: intent.failedBuildCleanupCompletedAt !== null,
        observed: { ...decision.observed, replay: true },
        replay: true,
        legacyCutoverCompleted: true,
        terminalReplay: true,
      };
    }
    // Validate the stored result before any possible CREATE repair. Only an exact non-terminal
    // replay may complete SSM and then acquire new durable cleanup evidence.
    await completeSsmIdentity();
    let legacyRollbackObservedAt = intent.legacyRollbackObservedAt;
    let failedBuildCleanupRequiredAt = intent.failedBuildCleanupRequiredAt;
    const markLegacyRollback = decision.legacyRollback && decision.failedBuildCleanupRequired
      && legacyRollbackObservedAt === null;
    const markFailedBuildCleanup = decision.failedBuildCleanupRequired
      && failedBuildCleanupRequiredAt === null;
    if (markLegacyRollback || markFailedBuildCleanup) {
      await client.query('BEGIN');
      try {
        const parent = await client.query<{ status: string; mode: string; buildReleaseId: string; ecsTaskArn: string }>(`
          SELECT "status", "mode", "buildReleaseId", "ecsTaskArn"
            FROM "RemoteReleaseOperation"
           WHERE "id" = $1 AND "targetEnvironment" = $2
           FOR UPDATE
        `, [input.operationId, input.targetEnvironment]);
        const parentRow = parent.rows[0];
        if (!parentRow || parentRow.status !== 'UNKNOWN' || parentRow.mode !== 'release'
          || parentRow.buildReleaseId !== input.buildReleaseId) {
          throw new RemoteReleaseOperationBlocked('recovery parent moved while rollback evidence was read');
        }
        const locked = await client.query<MutationIntentRow>(`
          SELECT * FROM "RemoteReleaseMutationIntent"
           WHERE "id" = $1 AND "operationId" = $2 AND "targetEnvironment" = $3
           FOR UPDATE
        `, [input.intentId, input.operationId, input.targetEnvironment]);
        const lockedIntent = locked.rows[0];
        if (!lockedIntent || lockedIntent.status === 'OPEN') {
          throw new RemoteReleaseOperationBlocked('mutation intent moved while rollback evidence was read');
        }
        validateStoredIntentRecoveryReplay(lockedIntent.status, lockedIntent.evidenceJson, decision);
        const marked = await client.query<{
          legacyRollbackObservedAt: Date | null; failedBuildCleanupRequiredAt: Date | null;
        }>(`
          UPDATE "RemoteReleaseMutationIntent"
             SET "legacyRollbackObservedAt" = CASE WHEN $2
                   THEN COALESCE("legacyRollbackObservedAt", CURRENT_TIMESTAMP)
                   ELSE "legacyRollbackObservedAt" END,
                 "failedBuildCleanupRequiredAt" = CASE WHEN $3
                   THEN COALESCE("failedBuildCleanupRequiredAt", CURRENT_TIMESTAMP)
                   ELSE "failedBuildCleanupRequiredAt" END,
                 "recovererControllerJson" = COALESCE("recovererControllerJson", $4::jsonb),
                 "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $1
           RETURNING "legacyRollbackObservedAt", "failedBuildCleanupRequiredAt"
        `, [input.intentId, decision.legacyRollback && decision.failedBuildCleanupRequired,
          decision.failedBuildCleanupRequired, JSON.stringify(input.controller)]);
        legacyRollbackObservedAt = marked.rows[0]?.legacyRollbackObservedAt ?? legacyRollbackObservedAt;
        failedBuildCleanupRequiredAt = marked.rows[0]?.failedBuildCleanupRequiredAt
          ?? failedBuildCleanupRequiredAt;
        await client.query(`
          INSERT INTO "AuditLog" (
            "id", "companyId", "actorType", "actorUserId", "actorRefId", "action", "targetType",
            "targetId", "requestId", "result", "riskLevel", "metadataJson", "createdAt"
          ) VALUES ($1,NULL,'SERVICE',NULL,$2,'system.release_operation.recover_remote_mutation',
                    'RemoteReleaseMutationIntent',$3,$4,'SUCCESS','CRITICAL',$5::jsonb,CURRENT_TIMESTAMP)
        `, [randomUUID(), input.recovererTaskArn, input.intentId,
          `release-intent-recovery:${input.intentId}:rollback-marker`,
          JSON.stringify({
            decision,
            replay: true,
            targetBuildReleaseId: input.buildReleaseId,
            recoveryExecutorBuildReleaseId: input.recoveryExecutorBuildReleaseId,
            recoveryExecutorImage: input.recoveryExecutorImage,
            recoveryValidatedCiRunId: input.recoveryValidatedCiRunId,
            recoveryExecutorSignerIdentity: `https://github.com/${input.controller.githubWorkflowRef}`,
            originalTaskArn: parentRow.ecsTaskArn,
            controller: input.controller,
          })]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }
    const cleanupRequired = failedBuildCleanupRequiredAt !== null
      || decision.failedBuildCleanupRequired;
    await client.query('BEGIN');
    try {
      const marked = await client.query(`
        UPDATE "RemoteReleaseMutationIntent"
           SET "recovererControllerJson" = $2::jsonb, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "status" <> 'OPEN' AND "recovererControllerJson" IS NULL
         RETURNING "id"
      `, [input.intentId, JSON.stringify(input.controller)]);
      if (marked.rowCount === 1) {
        await client.query(`
          INSERT INTO "AuditLog" (
            "id", "companyId", "actorType", "actorUserId", "actorRefId", "action", "targetType",
            "targetId", "requestId", "result", "riskLevel", "metadataJson", "createdAt"
          ) VALUES ($1,NULL,'SERVICE',NULL,$2,'system.release_operation.revalidate_remote_mutation',
                    'RemoteReleaseMutationIntent',$3,$4,'SUCCESS','CRITICAL',$5::jsonb,CURRENT_TIMESTAMP)
        `, [randomUUID(), input.recovererTaskArn, input.intentId,
          `release-intent-revalidation:${input.intentId}`,
          JSON.stringify({
            decision,
            targetBuildReleaseId: input.buildReleaseId,
            recoveryExecutorBuildReleaseId: input.recoveryExecutorBuildReleaseId,
            recoveryExecutorImage: input.recoveryExecutorImage,
            recoveryValidatedCiRunId: input.recoveryValidatedCiRunId,
            originalTaskArn: replayParentRow.ecsTaskArn,
            controller: input.controller,
          })]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    return {
      ...decision,
      legacyRollback: decision.legacyRollback
        || (legacyRollbackObservedAt !== null && intent.legacyRollbackCleanedAt === null),
      rollback: decision.rollback || (cleanupRequired && intent.evidenceJson !== null),
      failedBuildCleanupRequired: cleanupRequired,
      failedBuildCleanupCompleted: intent.failedBuildCleanupCompletedAt !== null,
      observed: { ...decision.observed, replay: true },
      replay: true,
      legacyCutoverCompleted: intent.legacyCutoverCompletedAt !== null,
      terminalReplay: false,
    };
  }

  // An OPEN intent must not become durable until its SSM identity is complete. This keeps the
  // close/cleanup markers meaningful across a controller crash.
  await completeSsmIdentity();
  await client.query('BEGIN');
  try {
    const parent = await client.query<ParentOperationRow>(`
      SELECT "id", "status", "mode", "buildReleaseId", "ecsTaskArn", "leaseOwner",
             false AS "leaseExpired", "deploymentManifestJson", "sourceBranch", "controllerKind",
             "githubRunId", "githubRunAttempt", "githubActor", "githubActorId", "githubWorkflowRef",
             "githubRepository", "manualActorRef"
        FROM "RemoteReleaseOperation"
       WHERE "id" = $1 AND "targetEnvironment" = $2
       FOR UPDATE
    `, [input.operationId, input.targetEnvironment]);
    const parentRow = parent.rows[0];
    if (!parentRow || parentRow.status !== 'UNKNOWN' || parentRow.mode !== 'release'
      || parentRow.buildReleaseId !== input.buildReleaseId) {
      throw new RemoteReleaseOperationBlocked('recovery parent is not the exact UNKNOWN held release');
    }
    const lockedIntent = await client.query<MutationIntentRow>(`
      SELECT * FROM "RemoteReleaseMutationIntent" WHERE "id" = $1 FOR UPDATE
    `, [input.intentId]);
    if (lockedIntent.rows[0]?.status !== 'OPEN') {
      throw new RemoteReleaseOperationBlocked('mutation intent moved while remote recovery evidence was read');
    }
    let manifest = Array.isArray(parentRow.deploymentManifestJson)
      ? parentRow.deploymentManifestJson as DeploymentEvidence[] : [];
    if (decision.evidence && !manifest.some((item) => sameEvidence(item, decision.evidence!))) {
      if (manifest.length >= 8) throw new RemoteReleaseOperationBlocked('recovered deployment would exceed manifest bound');
      manifest = [...manifest, decision.evidence].sort((left, right) =>
        left.service.localeCompare(right.service)
          || (left.deploymentArn ?? '').localeCompare(right.deploymentArn ?? '')
          || left.targetRevisionArn.localeCompare(right.targetRevisionArn));
      await client.query(`
        UPDATE "RemoteReleaseOperation" SET "deploymentManifestJson" = $2::jsonb, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "status" = 'UNKNOWN'
      `, [input.operationId, JSON.stringify(manifest)]);
    }
    await client.query(`
      UPDATE "RemoteReleaseMutationIntent"
         SET "status" = $2::"RemoteReleaseMutationIntentStatus", "evidenceJson" = $3::jsonb,
             "closedByTaskArn" = $4, "recovererControllerJson" = $5::jsonb,
             "legacyRollbackObservedAt" = CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE "legacyRollbackObservedAt" END,
             "failedBuildCleanupRequiredAt" = CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE "failedBuildCleanupRequiredAt" END,
             "closedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "status" = 'OPEN'
    `, [input.intentId, decision.status, decision.evidence ? JSON.stringify(decision.evidence) : null,
      input.recovererTaskArn, JSON.stringify(input.controller),
      decision.legacyRollback && decision.failedBuildCleanupRequired,
      decision.failedBuildCleanupRequired]);
    await client.query(`
      INSERT INTO "AuditLog" (
        "id", "companyId", "actorType", "actorUserId", "actorRefId", "action", "targetType",
        "targetId", "requestId", "result", "riskLevel", "metadataJson", "createdAt"
      ) VALUES ($1,NULL,'SERVICE',NULL,$2,'system.release_operation.recover_remote_mutation',
                'RemoteReleaseMutationIntent',$3,$4,'SUCCESS','CRITICAL',$5::jsonb,CURRENT_TIMESTAMP)
    `, [randomUUID(), input.recovererTaskArn, input.intentId, `release-intent-recovery:${input.intentId}`,
      JSON.stringify({
        decision,
        targetBuildReleaseId: input.buildReleaseId,
        recoveryExecutorBuildReleaseId: input.recoveryExecutorBuildReleaseId,
        recoveryExecutorImage: input.recoveryExecutorImage,
        recoveryValidatedCiRunId: input.recoveryValidatedCiRunId,
        recoveryExecutorSignerIdentity: `https://github.com/${input.controller.githubWorkflowRef}`,
        originalTaskArn: parentRow.ecsTaskArn,
        controller: input.controller,
      })]);
    await client.query('COMMIT');
    return { ...decision, replay: false, legacyCutoverCompleted: false, terminalReplay: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function recoverPreIntentApiRelease(
  client: Client,
  input: {
    operationId: string; targetEnvironment: Environment; buildReleaseId: string;
    recoveryExecutorBuildReleaseId: string;
    recoveryExecutorImage: string;
    recoveryValidatedCiRunId: string;
    recovererTaskArn: string; controller: ControllerProvenance; region: string;
    stoppedParentTaskEvidence?: StoppedParentTaskEvidence | null;
    readPlatform?: () => Promise<{
      service: Record<string, unknown> | null;
      deployment: Record<string, unknown> | null;
      ssmServiceArn: string | null;
    }>;
  },
): Promise<{ replay: boolean; state: PreIntentApiState; terminalReplay: boolean }> {
  await markExpiredTargetUnknown(client, input.operationId, input.targetEnvironment, {
    buildReleaseId: input.buildReleaseId,
    recovererTaskArn: input.recovererTaskArn,
    controller: input.controller,
    stoppedParentTaskEvidence: input.stoppedParentTaskEvidence ?? null,
  });
  const parent = await client.query<{
    status: string; mode: string; releaseDeployTarget: string | null; buildReleaseId: string;
    preIntentApiCleanupCompletedAt: Date | null; preIntentApiCleanupEvidenceJson: unknown;
  }>(`
    SELECT "status", "mode", "releaseDeployTarget", "buildReleaseId",
           "preIntentApiCleanupCompletedAt", "preIntentApiCleanupEvidenceJson"
      FROM "RemoteReleaseOperation"
     WHERE "id" = $1 AND "targetEnvironment" = $2
  `, [input.operationId, input.targetEnvironment]);
  const parentRow = parent.rows[0];
  if (!parentRow || !['UNKNOWN', 'RECONCILED_FAILED_CONFIRMED'].includes(parentRow.status)
    || parentRow.mode !== 'release'
    || parentRow.buildReleaseId !== input.buildReleaseId
    || !['all', 'api-web'].includes(parentRow.releaseDeployTarget ?? '')) {
    throw new RemoteReleaseOperationBlocked('pre-intent recovery target is not the exact UNKNOWN/recovered api-web release');
  }
  const terminalReplay = parentRow.status === 'RECONCILED_FAILED_CONFIRMED';
  if (terminalReplay && parentRow.preIntentApiCleanupCompletedAt === null) {
    throw new RemoteReleaseOperationBlocked('recovered pre-intent parent has no durable cleanup evidence');
  }
  const intentState = await client.query<{ apiCount: number; unresolvedOtherCount: number }>(`
    SELECT
      count(*) FILTER (WHERE "serviceKey" = 'api-web')::int AS "apiCount",
      count(*) FILTER (WHERE "serviceKey" <> 'api-web' AND (
        "status" = 'OPEN'
        OR ("legacyRollbackObservedAt" IS NOT NULL AND "legacyRollbackCleanedAt" IS NULL)
        OR ("failedBuildCleanupRequiredAt" IS NOT NULL AND "failedBuildCleanupCompletedAt" IS NULL)
      ))::int AS "unresolvedOtherCount"
      FROM "RemoteReleaseMutationIntent"
     WHERE "operationId" = $1
  `, [input.operationId]);
  if ((intentState.rows[0]?.apiCount ?? 0) !== 0) {
    throw new RemoteReleaseOperationBlocked('api-web intent exists; recover that exact intent instead of pre-intent recovery');
  }
  if ((intentState.rows[0]?.unresolvedOtherCount ?? 0) !== 0) {
    throw new RemoteReleaseOperationBlocked('other remote mutation intents must be fully resolved before pre-intent cleanup');
  }
  const accountId = input.recovererTaskArn.split(':')[4] ?? '';
  if (!/^[0-9]{12}$/.test(accountId)) throw new Error('pre-intent recovery cannot derive the release task AWS account');
  const cluster = expectedCluster(input.targetEnvironment);
  const serviceName = input.targetEnvironment === 'uat' ? 'watchdog-bms-uat-api-web' : 'watchdog-bms-api-web-pub';
  const expectedServiceArn = `arn:aws:ecs:${input.region}:${accountId}:service/${cluster}/${serviceName}`;
  const parameterName = `/watchdog-bms/${input.targetEnvironment}/ecs-express-api-web-service-arn`;
  const read = input.readPlatform ?? (async () => {
    const credentials = await readTaskCredentials();
    let ssmServiceArn: string | null;
    try {
      const ssm = await ssmJsonRequest(input.region, 'GetParameter', { Name: parameterName }, credentials);
      const value = (ssm.Parameter as Record<string, unknown> | undefined)?.Value;
      ssmServiceArn = typeof value === 'string' ? value : '';
    } catch (error) {
      if ((error as Error & { ssmCode?: string }).ssmCode === 'ParameterNotFound') ssmServiceArn = null;
      else throw error;
    }
    let service: Record<string, unknown> | null;
    try {
      service = await ecsJsonRequest(input.region, 'DescribeExpressGatewayService', {
        serviceArn: expectedServiceArn,
      }, credentials);
    } catch (error) {
      if ((error as Error & { ecsCode?: string }).ecsCode === 'ServiceNotFoundException') service = null;
      else throw error;
    }
    const current = (service?.service as Record<string, unknown> | undefined)?.currentDeployment;
    const activeShas = (service?.service as Record<string, any> | undefined)?.activeConfigurations
      ?.flatMap((configuration: any) => configuration?.primaryContainer?.environment
        ?.filter((item: any) => item?.name === 'GIT_SHA').map((item: any) => item?.value) ?? []) ?? [];
    const deployment = typeof current === 'string'
      ? await ecsJsonRequest(input.region, 'DescribeServiceDeployments', {
        serviceDeploymentArns: [current],
      }, credentials)
      : activeShas.length === 1 && /^[0-9a-f]{40}$/.test(String(activeShas[0]))
        ? await listAllServiceDeployments(input.region, {
          service: expectedServiceArn,
        }, credentials)
        : null;
    return { service, deployment, ssmServiceArn };
  });
  const first = await read();
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const second = await read();
  const state = validatePreIntentApiNoMutation(
    input.targetEnvironment, expectedServiceArn, input.buildReleaseId, first, second,
  );
  if (parentRow.preIntentApiCleanupCompletedAt !== null) {
    validateStoredPreIntentReplay(parentRow.preIntentApiCleanupEvidenceJson, state);
    return { replay: true, state, terminalReplay };
  }

  const cleanup = await runChild(
    `./node_modules/.bin/tsx prisma/retire-failed-bootstrap-build.ts --build=${input.buildReleaseId} --deployment-arn=PRE_INTENT_NO_API_MUTATION --intent-id=${input.operationId}`,
    () => undefined,
    () => undefined,
    recoveryTargetChildEnvironment(process.env, input.targetEnvironment, input.buildReleaseId),
  );
  if (cleanup.code !== 0 || cleanup.signal) {
    throw new RemoteReleaseOperationBlocked('pre-intent api-web launch-attestation cleanup failed');
  }

  await client.query('BEGIN');
  try {
    const locked = await client.query<{
      status: string; mode: string; releaseDeployTarget: string | null; buildReleaseId: string;
      preIntentApiCleanupCompletedAt: Date | null;
    }>(`
      SELECT "status", "mode", "releaseDeployTarget", "buildReleaseId", "preIntentApiCleanupCompletedAt"
        FROM "RemoteReleaseOperation"
       WHERE "id" = $1 AND "targetEnvironment" = $2
       FOR UPDATE
    `, [input.operationId, input.targetEnvironment]);
    const row = locked.rows[0];
    if (!row || row.status !== 'UNKNOWN' || row.mode !== 'release'
      || row.buildReleaseId !== input.buildReleaseId || !['all', 'api-web'].includes(row.releaseDeployTarget ?? '')) {
      throw new RemoteReleaseOperationBlocked('pre-intent release parent moved before cleanup evidence was persisted');
    }
    const recheck = await client.query<{ apiCount: number; unresolvedOtherCount: number }>(`
      SELECT
        count(*) FILTER (WHERE "serviceKey" = 'api-web')::int AS "apiCount",
        count(*) FILTER (WHERE "serviceKey" <> 'api-web' AND (
          "status" = 'OPEN'
          OR ("legacyRollbackObservedAt" IS NOT NULL AND "legacyRollbackCleanedAt" IS NULL)
          OR ("failedBuildCleanupRequiredAt" IS NOT NULL AND "failedBuildCleanupCompletedAt" IS NULL)
        ))::int AS "unresolvedOtherCount"
        FROM "RemoteReleaseMutationIntent"
       WHERE "operationId" = $1
    `, [input.operationId]);
    if ((recheck.rows[0]?.apiCount ?? 0) !== 0 || (recheck.rows[0]?.unresolvedOtherCount ?? 0) !== 0) {
      throw new RemoteReleaseOperationBlocked('pre-intent recovery ownership changed before cleanup evidence was persisted');
    }
    if (row.preIntentApiCleanupCompletedAt === null) {
      await client.query(`
        UPDATE "RemoteReleaseOperation"
           SET "preIntentApiCleanupCompletedAt" = CURRENT_TIMESTAMP,
               "preIntentApiCleanupEvidenceJson" = $2::jsonb,
               "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "status" = 'UNKNOWN'
      `, [input.operationId, JSON.stringify(state)]);
      await client.query(`
        INSERT INTO "AuditLog" (
          "id", "companyId", "actorType", "actorUserId", "actorRefId", "action", "targetType",
          "targetId", "requestId", "result", "riskLevel", "metadataJson", "createdAt"
        ) VALUES ($1,NULL,'SERVICE',NULL,$2,'system.release_operation.pre_intent_api_cleanup',
                  'RemoteReleaseOperation',$3,$4,'SUCCESS','CRITICAL',$5::jsonb,CURRENT_TIMESTAMP)
      `, [randomUUID(), input.recovererTaskArn, input.operationId,
        `release-pre-intent-recovery:${input.operationId}`,
        JSON.stringify({
          state,
          targetBuildReleaseId: input.buildReleaseId,
          recoveryExecutorBuildReleaseId: input.recoveryExecutorBuildReleaseId,
          recoveryExecutorImage: input.recoveryExecutorImage,
          recoveryValidatedCiRunId: input.recoveryValidatedCiRunId,
          recoveryExecutorSignerIdentity: `https://github.com/${input.controller.githubWorkflowRef}`,
          controller: input.controller,
        })]);
    }
    await client.query('COMMIT');
    return { replay: row.preIntentApiCleanupCompletedAt !== null, state, terminalReplay: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

/**
 * Recover the narrow V2 controller crash where maintenance-bootstrap deployed the exact candidate,
 * release-prepare succeeded, and api-web never received a durable intent. Existing non-api intents
 * are accepted only when every one is BOUND and their complete evidence equals the failed artifact's
 * bounded append-only history. This records FAILED_CONFIRMED only; the next ordinary release repeats
 * preparation and creates the normal per-service intent/bind/finalizer chain.
 */
export async function recoverBootstrapClosedPreIntentRelease(
  client: Client,
  input: {
    operationId: string;
    targetEnvironment: Environment;
    buildReleaseId: string;
    recoveryExecutorBuildReleaseId: string;
    recoveryExecutorImage: string;
    recoveryValidatedCiRunId: string;
    recovererTaskArn: string;
    controller: ControllerProvenance;
    region: string;
    evidence: BootstrapClosedRecoveryEvidence;
    stoppedParentTaskEvidence?: StoppedParentTaskEvidence | null;
    readPlatform?: () => Promise<BootstrapClosedPlatformRead[]>;
  },
): Promise<{ replay: boolean; services: BootstrapClosedRecoveryService[] }> {
  if (input.targetEnvironment !== 'production' || input.evidence.operationId !== input.operationId
    || input.evidence.sourceCommit !== input.buildReleaseId
    || input.evidence.parentTaskArn !== (input.stoppedParentTaskEvidence?.taskArn ?? input.evidence.parentTaskArn)) {
    throw new RemoteReleaseOperationBlocked('bootstrap-closed recovery evidence does not name the exact production hold');
  }
  await markExpiredTargetUnknown(client, input.operationId, input.targetEnvironment, {
    buildReleaseId: input.buildReleaseId,
    recovererTaskArn: input.recovererTaskArn,
    controller: input.controller,
    stoppedParentTaskEvidence: input.stoppedParentTaskEvidence ?? null,
  });
  const read = input.readPlatform ?? (async () => {
    const credentials = await readTaskCredentials();
    return Promise.all(input.evidence.services.map(async (expected) => ({
      service: expected.service,
      serviceResponse: await ecsJsonRequest(input.region, 'DescribeExpressGatewayService', {
        serviceArn: expected.serviceArn,
      }, credentials),
      deploymentResponse: await ecsJsonRequest(input.region, 'DescribeServiceDeployments', {
        serviceDeploymentArns: [expected.deploymentArn],
      }, credentials),
    })));
  });
  const first = await read();
  const firstServices = validateBootstrapClosedRecoveryPlatform(input.evidence, first);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const second = await read();
  const services = validateBootstrapClosedRecoveryPlatform(input.evidence, second);
  if (canonicalJson(firstServices) !== canonicalJson(services)) {
    throw new RemoteReleaseOperationBlocked('bootstrap-closed production state moved between recovery reads');
  }
  const evidenceRef = `ProductionV2ControllerEvidence:${input.evidence.failedPromotionRunId}:${input.evidence.failedPromotionRunAttempt}:${input.evidence.artifactDigest}`;
  await client.query('BEGIN');
  try {
    const parent = await client.query<Omit<ParentOperationRow, 'status'> & {
      status: 'UNKNOWN' | 'RECONCILED_FAILED_CONFIRMED';
      ecsServiceArn: string | null; serviceDeploymentArn: string | null;
      targetServiceRevisionArn: string | null; activeBuildsJson: unknown;
      reconciledByTaskArn: string | null; reconciliationEvidenceRef: string | null;
    }>(`
      SELECT *, ("leaseExpiresAt" <= CURRENT_TIMESTAMP) AS "leaseExpired"
        FROM "RemoteReleaseOperation"
       WHERE "id" = $1 AND "targetEnvironment" = $2 FOR UPDATE
    `, [input.operationId, input.targetEnvironment]);
    const row = parent.rows[0];
    const expectedWorkflow = `${input.controller.githubRepository}/.github/workflows/deploy-production-v2.yml@refs/heads/main`;
    const parentHistory = Array.isArray(row?.deploymentManifestJson)
      ? (row.deploymentManifestJson as DeploymentEvidence[]).slice().sort(compareDeploymentEvidence) : [];
    const exactParent = row && row.mode === 'release' && row.releaseDeployTarget === 'all'
      && row.buildReleaseId === input.buildReleaseId && row.ecsTaskArn === input.evidence.parentTaskArn
      && row.sourceBranch === 'main' && row.controllerKind === 'GITHUB_ACTIONS'
      && row.githubRunId === input.evidence.failedPromotionRunId
      && row.githubRunAttempt === input.evidence.failedPromotionRunAttempt
      && row.githubWorkflowRef === expectedWorkflow
      && row.githubRepository === input.controller.githubRepository
      && row.leaseOwner === row.ecsTaskArn
      && canonicalJson(parentHistory) === canonicalJson(input.evidence.boundHistory.slice().sort(compareDeploymentEvidence))
      && row.preIntentApiCleanupCompletedAt === null && row.preIntentApiCleanupEvidenceJson === null
      && row.ecsServiceArn === null && row.serviceDeploymentArn === null
      && row.targetServiceRevisionArn === null && row.activeBuildsJson === null;
    if (!exactParent || !['UNKNOWN', 'RECONCILED_FAILED_CONFIRMED'].includes(row.status)) {
      throw new RemoteReleaseOperationBlocked('bootstrap-closed recovery parent is not the exact no-api-intent V2 hold');
    }
    const intents = await client.query<{
      operationId: string; targetEnvironment: string; buildReleaseId: string; serviceKey: string;
      status: string; evidenceJson: unknown; closedAt: Date | null;
      legacyRollbackObservedAt: Date | null; legacyRollbackCleanedAt: Date | null;
      failedBuildCleanupRequiredAt: Date | null; failedBuildCleanupCompletedAt: Date | null;
    }>(`
      SELECT "operationId","targetEnvironment","buildReleaseId","serviceKey","status","evidenceJson","closedAt",
             "legacyRollbackObservedAt","legacyRollbackCleanedAt",
             "failedBuildCleanupRequiredAt","failedBuildCleanupCompletedAt"
        FROM "RemoteReleaseMutationIntent" WHERE "operationId" = $1 ORDER BY "createdAt" ASC
    `, [input.operationId]);
    const observedHistory = input.evidence.boundHistory.filter((item) => intents.rows.some((intent) =>
      intent.evidenceJson !== null && typeof intent.evidenceJson === 'object'
        && sameEvidence(item, intent.evidenceJson as DeploymentEvidence)));
    const exactIntents = intents.rows.length === input.evidence.boundHistory.length
      && intents.rows.length <= 8 && intents.rows.every((intent) =>
      intent.operationId === input.operationId && intent.targetEnvironment === input.targetEnvironment
      && intent.buildReleaseId === input.buildReleaseId
      && (intent.serviceKey === 'ai-gateway' || intent.serviceKey === 'workers')
      && intent.status === 'BOUND' && intent.closedAt !== null
      && intent.evidenceJson !== null && typeof intent.evidenceJson === 'object'
      && input.evidence.boundHistory.some((item) => sameEvidence(item, intent.evidenceJson as DeploymentEvidence))
      && (intent.legacyRollbackObservedAt === null || intent.legacyRollbackCleanedAt !== null)
      && (intent.failedBuildCleanupRequiredAt === null || intent.failedBuildCleanupCompletedAt !== null));
    if (!exactIntents || canonicalJson(observedHistory) !== canonicalJson(input.evidence.boundHistory)) {
      throw new RemoteReleaseOperationBlocked('bootstrap-closed recovery requires exact resolved non-api intent history');
    }
    if (row.status === 'RECONCILED_FAILED_CONFIRMED') {
      if (row.reconciliationEvidenceRef !== evidenceRef) {
        throw new RemoteReleaseOperationBlocked('bootstrap-closed parent was reconciled with different evidence');
      }
      await client.query('COMMIT');
      return { replay: true, services };
    }
    const actorRef = `github:${input.controller.githubRepository}:${input.controller.githubRunId}:${input.controller.githubRunAttempt}`;
    const partial = input.evidence.boundHistory.length > 0;
    const updated = await client.query(`
      UPDATE "RemoteReleaseOperation"
         SET "status" = 'RECONCILED_FAILED_CONFIRMED', "completedAt" = CURRENT_TIMESTAMP,
             "reconciledAt" = CURRENT_TIMESTAMP, "reconciledByActorRef" = $2,
             "reconciledByTaskArn" = $3, "reconciliationEvidenceRef" = $4,
             "reconciliationReason" = $5,
             "outcomeReason" = $6,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "status" = 'UNKNOWN'
    `, [input.operationId, actorRef, input.recovererTaskArn, evidenceRef,
      partial
        ? 'V2 controller stopped before api-web intent; exact resolved non-api history and candidate-closed services remained stable'
        : 'V2 controller failed before the first rollout intent; exact bootstrap-closed candidate remained stable',
      partial
        ? 'FAILED_CONFIRMED after exact partial-closed no-api-intent recovery; clean release retry required'
        : 'FAILED_CONFIRMED after exact bootstrap-closed zero-intent recovery; clean release retry required']);
    if (updated.rowCount !== 1) throw new RemoteReleaseOperationBlocked('bootstrap-closed parent moved during recovery');
    await client.query(`
      INSERT INTO "AuditLog" (
        "id", "companyId", "actorType", "actorUserId", "actorRefId", "action", "targetType",
        "targetId", "requestId", "result", "riskLevel", "metadataJson", "createdAt"
      ) VALUES ($1,NULL,'SERVICE',NULL,$2,'system.release_operation.recover_bootstrap_closed_pre_intent',
                'RemoteReleaseOperation',$3,$4,'SUCCESS','CRITICAL',$5::jsonb,CURRENT_TIMESTAMP)
    `, [randomUUID(), input.recovererTaskArn, input.operationId,
      `release-bootstrap-closed-recovery:${input.operationId}`,
      JSON.stringify({
        evidence: input.evidence,
        observedServices: services,
        recoveryExecutorBuildReleaseId: input.recoveryExecutorBuildReleaseId,
        recoveryExecutorImage: input.recoveryExecutorImage,
        recoveryValidatedCiRunId: input.recoveryValidatedCiRunId,
        controller: input.controller,
      })]);
    await client.query('COMMIT');
    return { replay: false, services };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function terminalizeRecoveredReleaseIfReady(
  client: Client,
  input: {
    operationId: string; targetEnvironment: Environment; recovererTaskArn: string;
    controller: ControllerProvenance;
  },
): Promise<boolean> {
  await client.query('BEGIN');
  try {
    const parent = await client.query<{
      status: string; ecsTaskArn: string; releaseDeployTarget: string | null;
      preIntentApiCleanupCompletedAt: Date | null;
    }>(`
      SELECT "status", "ecsTaskArn", "releaseDeployTarget", "preIntentApiCleanupCompletedAt"
        FROM "RemoteReleaseOperation"
       WHERE "id" = $1 AND "targetEnvironment" = $2 FOR UPDATE
    `, [input.operationId, input.targetEnvironment]);
    const alreadyTerminal = parent.rows[0]?.status === 'RECONCILED_FAILED_CONFIRMED';
    if (!alreadyTerminal && parent.rows[0]?.status !== 'UNKNOWN') {
      throw new RemoteReleaseOperationBlocked('recovery terminalization requires the exact UNKNOWN parent');
    }
    const unresolved = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM "RemoteReleaseMutationIntent"
       WHERE "operationId" = $1
         AND ("status" = 'OPEN'
           OR ("legacyRollbackObservedAt" IS NOT NULL AND "legacyRollbackCleanedAt" IS NULL)
           OR ("failedBuildCleanupRequiredAt" IS NOT NULL AND "failedBuildCleanupCompletedAt" IS NULL)
           OR ("serviceKey" = 'api-web' AND "status" = 'BOUND'
             AND "legacyBootstrapDescriptorJson" IS NOT NULL
             AND "legacyRollbackObservedAt" IS NULL
             AND "legacyCutoverCompletedAt" IS NULL))
    `, [input.operationId]);
    if ((unresolved.rows[0]?.count ?? 0) !== 0) {
      await client.query('COMMIT');
      return false;
    }
    let preIntentRecovered = false;
    if (parent.rows[0].releaseDeployTarget === 'all' || parent.rows[0].releaseDeployTarget === 'api-web') {
      const apiIntents = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM "RemoteReleaseMutationIntent"
         WHERE "operationId" = $1 AND "serviceKey" = 'api-web'
      `, [input.operationId]);
      if ((apiIntents.rows[0]?.count ?? 0) === 0) {
        if (parent.rows[0].preIntentApiCleanupCompletedAt === null) {
          await client.query('COMMIT');
          return false;
        }
        preIntentRecovered = true;
      }
    }
    const completeServiceCoverage = await hasCompleteReleaseServiceCoverage(
      client,
      input.operationId,
      parent.rows[0].releaseDeployTarget,
      parent.rows[0].preIntentApiCleanupCompletedAt,
    );
    let allTargetStoppedBeforeAnyIntent = false;
    if (!completeServiceCoverage
      && parent.rows[0].releaseDeployTarget === 'all'
      && parent.rows[0].preIntentApiCleanupCompletedAt !== null) {
      const intentCount = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM "RemoteReleaseMutationIntent" WHERE "operationId" = $1
      `, [input.operationId]);
      // deploy.sh persists each service intent before its ECS mutation. Zero intents plus the
      // exact api-web pre-intent cleanup therefore proves an all-target rollout never started.
      allTargetStoppedBeforeAnyIntent = (intentCount.rows[0]?.count ?? 0) === 0;
    }
    // Recovery proof checkpoint: partial all-target terminalization stays behind exact revalidation
    // of every intent that exists; a service missing its pre-mutation intent is never synthesized.
    const recoveredPartialAllTarget = !completeServiceCoverage
      && await hasRecoveredPartialAllTargetCoverage(
        client, input.operationId, parent.rows[0].releaseDeployTarget,
      );
    if (!completeServiceCoverage && !allTargetStoppedBeforeAnyIntent && !recoveredPartialAllTarget) {
      await client.query('COMMIT');
      return false;
    }
    if (alreadyTerminal) {
      await client.query('COMMIT');
      return true;
    }
    const actorRef = input.controller.controllerKind === 'GITHUB_ACTIONS'
      ? `github:${input.controller.githubRepository}:${input.controller.githubRunId}:${input.controller.githubRunAttempt}`
      : input.controller.manualActorRef!;
    const updated = await client.query(`
      UPDATE "RemoteReleaseOperation"
         SET "status" = 'RECONCILED_FAILED_CONFIRMED', "completedAt" = CURRENT_TIMESTAMP,
             "reconciledAt" = CURRENT_TIMESTAMP, "reconciledByActorRef" = $3,
             "reconciledByTaskArn" = $4,
             "reconciliationEvidenceRef" = $5,
             "reconciliationReason" = $6,
             "outcomeReason" = $7,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "targetEnvironment" = $2 AND "status" = 'UNKNOWN'
    `, [input.operationId, input.targetEnvironment, actorRef, input.recovererTaskArn,
      preIntentRecovered
        ? `RemoteReleasePreIntentCleanup:${input.operationId}`
        : recoveredPartialAllTarget
          ? `RemoteReleasePartialIntentRecovery:${input.operationId}`
          : `RemoteReleaseMutationIntent:${input.operationId}`,
      recoveredPartialAllTarget
        ? 'controller stopped before every all-target service intent; each existing intent was exactly revalidated and missing services had no pre-mutation intent'
        : 'controller stopped during remote mutation; every durable intent was exactly recovered and a clean retry is required',
      recoveredPartialAllTarget
        ? 'FAILED_CONFIRMED after partial all-target exact-intent recovery; clean release retry required'
        : 'FAILED_CONFIRMED after exact remote-intent recovery; retry release for health verification']);
    if (updated.rowCount !== 1) throw new RemoteReleaseOperationBlocked('recovery parent moved before terminalization');
    await client.query(`
      INSERT INTO "AuditLog" (
        "id", "companyId", "actorType", "actorUserId", "actorRefId", "action", "targetType",
        "targetId", "requestId", "result", "riskLevel", "metadataJson", "createdAt"
      ) VALUES ($1,NULL,'SERVICE',NULL,$2,'system.release_operation.recovery_terminalize',
                'RemoteReleaseOperation',$3,$4,'SUCCESS','CRITICAL',$5::jsonb,CURRENT_TIMESTAMP)
    `, [randomUUID(), actorRef, input.operationId, `release-recovery-terminalize:${input.operationId}`,
      JSON.stringify({
        originalTaskArn: parent.rows[0].ecsTaskArn,
        recovererTaskArn: input.recovererTaskArn,
        recoveredPartialAllTarget,
        controller: input.controller,
      })]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function markRecoveredLegacyCutoverCompleted(
  client: Client,
  input: { operationId: string; targetEnvironment: Environment; buildReleaseId: string },
): Promise<number> {
  const marked = await client.query(`
    UPDATE "RemoteReleaseMutationIntent"
       SET "legacyCutoverCompletedAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "operationId" = $1
       AND "targetEnvironment" = $2
       AND "buildReleaseId" = $3
       AND "serviceKey" = 'api-web'
       AND "status" = 'BOUND'
       AND "legacyBootstrapDescriptorJson" IS NOT NULL
       AND "legacyRollbackObservedAt" IS NULL
       AND "legacyCutoverCompletedAt" IS NULL
  `, [input.operationId, input.targetEnvironment, input.buildReleaseId]);
  return marked.rowCount ?? 0;
}

/**
 * Exhaustive ListServiceDeployments.
 *
 * ECS returns one capped page plus a nextToken, and every caller here reasons over *the* deployment
 * set - the unique newest record, a causal window, two reads that must agree - so a truncated page
 * is a wrong answer rather than a smaller one. Each caller already refuses a paginated response;
 * walking every page keeps that refusal a tripwire instead of a wall.
 *
 * The shell side of this repo hit the same edge first: production api-web crossed the 100-row page
 * at 184 deployments while UAT was still at 93, so nothing caught it until the first production
 * retirement. Callers pass their own filters; maxResults and nextToken are owned here.
 */
async function listAllServiceDeployments(
  region: string,
  input: Record<string, unknown>,
  credentials: TaskCredentials,
  maxPages = 50,
): Promise<Record<string, unknown>> {
  const serviceDeployments: unknown[] = [];
  let nextToken: unknown = null;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await ecsJsonRequest(region, 'ListServiceDeployments', {
      ...input,
      maxResults: 100,
      ...(nextToken == null ? {} : { nextToken }),
    }, credentials);
    const rows = response.serviceDeployments;
    if (Array.isArray(rows)) serviceDeployments.push(...rows);
    nextToken = response.nextToken ?? null;
    if (nextToken == null) return { serviceDeployments, nextToken: null };
  }
  throw new Error(`service deployment history exceeds ${maxPages} pages; refusing a non-exhaustive read`);
}

/** Fail closed unless one exact terminal deployment and one stable serving manifest agree. */
export function validateRetirementPlatformState(
  deploymentResponse: Record<string, unknown>,
  historyResponse: Record<string, unknown>,
  serviceResponse: Record<string, unknown>,
  expected: RetirementExpectedState,
): RetirementPlatformState {
  const deployments = deploymentResponse.serviceDeployments;
  if (!Array.isArray(deployments) || deployments.length !== 1) {
    throw new Error('ECS returned zero or multiple records for the exact service deployment');
  }
  const deployment = deployments[0] as Record<string, any>;
  const status = typeof deployment.status === 'string' ? deployment.status : '';
  if (status !== 'SUCCESSFUL' && status !== 'ROLLBACK_SUCCESSFUL') {
    throw new Error(`service deployment is not terminal-safe (${status || 'missing status'})`);
  }
  if (deployment.serviceDeploymentArn !== expected.deploymentArn
    || deployment.serviceArn !== expected.serviceArn
    || deployment.targetServiceRevision?.arn !== expected.targetRevisionArn) {
    throw new Error('service deployment identity does not match the authorized service and target revision');
  }
  if (historyResponse.nextToken != null) {
    throw new Error('service deployment history is paginated and not safe for retirement');
  }
  const history = normalizedDeploymentRows(historyResponse);
  const targetHistory = history.filter((row) => row.serviceDeploymentArn === expected.deploymentArn);
  const timestamp = (value: unknown) => typeof value === 'number'
    ? value * 1_000
    : new Date(String(value ?? '')).getTime();
  const targetEpoch = targetHistory.length === 1 ? timestamp(targetHistory[0]!.createdAt) : Number.NaN;
  if (!Number.isFinite(targetEpoch) || history.some((row) => {
    const observed = timestamp(row.createdAt);
    return !Number.isFinite(observed) || observed > targetEpoch
      || (observed === targetEpoch && row.serviceDeploymentArn !== expected.deploymentArn);
  })) {
    throw new Error('authorized deployment is not the unique latest service deployment');
  }

  const service = serviceResponse.service as Record<string, any> | undefined;
  if (!service || service.serviceArn !== expected.serviceArn || service.status?.statusCode !== 'ACTIVE') {
    throw new Error('ECS Express service identity does not match the authorized service');
  }
  if (service.currentDeployment != null && service.currentDeployment !== expected.deploymentArn) {
    throw new Error('a different service deployment is now current');
  }
  if (!Array.isArray(service.activeConfigurations) || service.activeConfigurations.length !== 1) {
    throw new Error('terminal retirement requires one stable active ECS Express configuration');
  }
  const active = service.activeConfigurations.map((configuration: Record<string, any>) => {
    const revision = typeof configuration.serviceRevisionArn === 'string' ? configuration.serviceRevisionArn : '';
    const environment = configuration.primaryContainer?.environment;
    const shas = Array.isArray(environment)
      ? environment.filter((entry: any) => entry?.name === 'GIT_SHA').map((entry: any) => entry?.value)
      : [];
    if (!revision.startsWith('arn:') || shas.length !== 1 || !/^[0-9a-f]{40}$/.test(shas[0])) {
      throw new Error('every active ECS Express revision must carry exactly one full GIT_SHA');
    }
    return { revision, sha: shas[0] as string };
  }).sort((a, b) => a.revision.localeCompare(b.revision));
  if (new Set(active.map((row) => row.revision)).size !== active.length) {
    throw new Error('ECS Express returned duplicate active service revisions');
  }
  const observedBuilds = [...new Set(active.map((row) => row.sha))].sort();
  const expectedBuilds = [...new Set(expected.activeBuilds)].sort();
  if (JSON.stringify(observedBuilds) !== JSON.stringify(expectedBuilds)) {
    throw new Error(`active ECS Express builds moved (expected=${expectedBuilds.join(',')} observed=${observedBuilds.join(',')})`);
  }
  if (status === 'SUCCESSFUL' && active[0]!.revision !== expected.targetRevisionArn) {
    throw new Error('successful deployment target revision is no longer serving');
  }
  return { deploymentStatus: status, currentDeployment: service.currentDeployment ?? null, active };
}

export async function revalidateRetirementPlatform(
  region: string,
  expected: RetirementExpectedState,
): Promise<number> {
  const credentials = await readTaskCredentials();
  const read = async () => validateRetirementPlatformState(
    await ecsJsonRequest(region, 'DescribeServiceDeployments', {
      serviceDeploymentArns: [expected.deploymentArn],
    }, credentials),
    await listAllServiceDeployments(region, {
      service: expected.serviceArn,
    }, credentials),
    await ecsJsonRequest(region, 'DescribeExpressGatewayService', {
      serviceArn: expected.serviceArn,
    }, credentials),
    expected,
  );
  const first = await read();
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const second = await read();
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error('ECS Express deployment/active manifest moved between two in-task reads');
  }
  return Math.floor(Date.now() / 1000);
}

function requiredText(name: string, max: number): string {
  const value = process.env[name] ?? '';
  if (!value || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${name} must be 1-${max} printable characters`);
  }
  return value;
}

function expectedGithubWorkflows(environment: Environment, mode: string): string[] {
  if (mode === 'f2-plan') return ['f2-normalize.yml'];
  if (mode === 'f2-apply' || mode === 'f2-verify') return ['f2-normalize-apply.yml'];
  if (mode === 'release-intent-recover' || mode === 'release-orphan-intent-recover'
    || mode === 'release-pre-intent-recover' || mode === 'release-bootstrap-closed-recover') {
    return ['recover-release-intent.yml'];
  }
  if (['release', 'release-prepare', 'release-intent', 'release-bind', 'release-finalize', 'retire', 'reconcile', 'm01-live', 'operation-reconcile'].includes(mode)) {
    return environment === 'uat'
      ? ['deploy-uat.yml']
      : ['deploy-production.yml', 'deploy-production-v2.yml'];
  }
  throw new Error(`release operation mode ${mode} has no approved GitHub controller`);
}

export function validateGithubControllerWorkflow(
  repository: string,
  workflowRef: string,
  environment: Environment,
  mode: string,
): void {
  const expected = expectedGithubWorkflows(environment, mode)
    .map((workflow) => `${repository}/.github/workflows/${workflow}@refs/heads/main`);
  if (!expected.includes(workflowRef)) {
    throw new Error(`${environment} ${mode} must be controlled by ${expected.join(' or ')}`);
  }
}

export function validateManualControllerMode(mode: string): void {
  if (mode !== 'operation-reconcile') {
    throw new Error('manual controller is allowed only for audited operation-reconcile break-glass');
  }
}

function controllerProvenance(environment: Environment, mode: string): ControllerProvenance {
  const sourceBranch = requiredText('RELEASE_SOURCE_BRANCH', 128);
  const expectedBranch = environment === 'uat' ? 'develop' : 'main';
  if (sourceBranch !== expectedBranch) {
    throw new Error(`${environment} release operations must originate from ${expectedBranch}`);
  }
  const controllerKind = requiredText('RELEASE_CONTROLLER_KIND', 32);
  if (controllerKind === 'GITHUB_ACTIONS') {
    const githubRunId = requiredText('RELEASE_GITHUB_RUN_ID', 32);
    const runAttemptText = requiredText('RELEASE_GITHUB_RUN_ATTEMPT', 10);
    const githubActorId = requiredText('RELEASE_GITHUB_ACTOR_ID', 32);
    if (!/^\d+$/.test(githubRunId) || !/^[1-9]\d*$/.test(runAttemptText) || !/^\d+$/.test(githubActorId)) {
      throw new Error('GitHub run id, run attempt and actor id must be positive decimal identities');
    }
    const githubRepository = requiredText('RELEASE_GITHUB_REPOSITORY', 256);
    const githubWorkflowRef = requiredText('RELEASE_GITHUB_WORKFLOW_REF', 512);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepository)
      || !githubWorkflowRef.startsWith(`${githubRepository}/.github/workflows/`)
      || !githubWorkflowRef.includes('@refs/')) {
      throw new Error('GitHub repository/workflow provenance is malformed');
    }
    validateGithubControllerWorkflow(githubRepository, githubWorkflowRef, environment, mode);
    return {
      sourceBranch,
      controllerKind: 'GITHUB_ACTIONS' as const,
      githubRunId,
      githubRunAttempt: Number(runAttemptText),
      githubActor: requiredText('RELEASE_GITHUB_ACTOR', 128),
      githubActorId,
      githubWorkflowRef,
      githubRepository,
      manualActorRef: null,
    };
  }
  if (controllerKind !== 'MANUAL') throw new Error('RELEASE_CONTROLLER_KIND must be GITHUB_ACTIONS or MANUAL');
  validateManualControllerMode(mode);
  const manualActorRef = requiredText('RELEASE_MANUAL_ACTOR_REF', 512);
  if (!/^arn:aws:(iam|sts)::[0-9]{12}:.+/.test(manualActorRef)) {
    throw new Error('manual release operation requires the exact AWS IAM/STS actor ARN');
  }
  return {
    sourceBranch,
    controllerKind: 'MANUAL' as const,
    githubRunId: null,
    githubRunAttempt: null,
    githubActor: null,
    githubActorId: null,
    githubWorkflowRef: null,
    githubRepository: null,
    manualActorRef,
  };
}

export async function runChild(
  command: string,
  onChild: (child: ChildProcess) => void,
  assertLaunchAllowed: () => void = () => undefined,
  childEnvironment: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  // The assertion and spawn are deliberately synchronous and adjacent. A signal callback cannot
  // interleave between them on Node's event loop, so an interrupt observed after handler install
  // either prevents the child entirely or is delivered to the already-tracked child.
  assertLaunchAllowed();
  const child = spawn('/bin/sh', ['-lc', command], { env: childEnvironment, stdio: 'inherit' });
  onChild(child);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

export function recoveryTargetChildEnvironment(
  base: NodeJS.ProcessEnv,
  targetEnvironment: Environment,
  targetBuildReleaseId: string,
): NodeJS.ProcessEnv {
  if (!/^[0-9a-f]{40}$/.test(targetBuildReleaseId)) {
    throw new RemoteReleaseOperationBlocked('recovery cleanup target build must be one full lowercase SHA');
  }
  return {
    ...base,
    // Only the bounded cleanup child evaluates authority for the held target build. The recovery
    // executor process keeps its own GIT_SHA for provenance and audit.
    DEPLOY_ENVIRONMENT: targetEnvironment,
    GIT_SHA: targetBuildReleaseId,
  };
}

/** A non-zero mutating command may have committed partial effects; only read-only checks can prove failure by exit alone. */
export function classifyChildOutcome(
  mode: string,
  result: { code: number | null; signal: NodeJS.Signals | null },
  attachedToHeldRelease = false,
): TerminalStatus | 'UNKNOWN' {
  if (result.signal || result.code === null) return 'UNKNOWN';
  if (result.code === 0) {
    // The reconciliation action succeeded, but the rollout represented by the held parent did not.
    // Keep that business outcome explicit while still freeing the environment safely.
    return attachedToHeldRelease && mode === 'reconcile' ? 'FAILED_CONFIRMED' : 'SUCCEEDED';
  }
  return mode === 'f2-plan' || mode === 'f2-verify' ? 'FAILED_CONFIRMED' : 'UNKNOWN';
}

/** Intent preparation/binding are row-locked metadata writes and allow parallel service waves. */
export function needsRemoteWriterFence(mode: string): boolean {
  return mode !== 'release-intent' && mode !== 'release-bind';
}

async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const environment = process.env.DEPLOY_ENVIRONMENT as Environment;
  const mode = process.env.RELEASE_OPERATION_MODE ?? '';
  const durableMode = mode === 'release-prepare' ? 'release' : mode;
  const executorBuildReleaseId = process.env.GIT_SHA ?? '';
  const recoveryBuildReleaseId = process.env.RELEASE_RECOVERY_BUILD_RELEASE_ID ?? '';
  const recoveryExecutorImage = process.env.RELEASE_RECOVERY_EXECUTOR_IMAGE ?? '';
  const recoveryValidatedCiRunId = process.env.RELEASE_RECOVERY_VALIDATED_CI_RUN_ID ?? '';
  const recoveryParentTaskEvidenceText = process.env.RELEASE_RECOVERY_PARENT_TASK_EVIDENCE_JSON ?? '';
  const bootstrapClosedRecoveryText = process.env.RELEASE_BOOTSTRAP_CLOSED_RECOVERY_JSON ?? '';
  const recoveryMode = mode === 'release-intent-recover' || mode === 'release-orphan-intent-recover'
    || mode === 'release-pre-intent-recover' || mode === 'release-bootstrap-closed-recover';
  if (recoveryMode && !/^[0-9a-f]{40}$/.test(recoveryBuildReleaseId)) {
    throw new Error('exact recovery requires a full RELEASE_RECOVERY_BUILD_RELEASE_ID target');
  }
  if (!recoveryMode && recoveryBuildReleaseId) {
    throw new Error('RELEASE_RECOVERY_BUILD_RELEASE_ID is accepted only by exact recovery modes');
  }
  if (!recoveryMode && (recoveryExecutorImage || recoveryValidatedCiRunId)) {
    throw new Error('recovery executor provenance is accepted only by exact recovery modes');
  }
  if (!recoveryMode && recoveryParentTaskEvidenceText) {
    throw new Error('stopped parent-task evidence is accepted only by exact recovery modes');
  }
  if (mode !== 'release-bootstrap-closed-recover' && bootstrapClosedRecoveryText) {
    throw new Error('bootstrap-closed evidence is accepted only by its exact recovery mode');
  }
  const stoppedParentTaskEvidence = recoveryParentTaskEvidenceText
    ? parseStoppedParentTaskEvidence(environment, recoveryParentTaskEvidenceText)
    : null;
  const buildReleaseId = recoveryMode ? recoveryBuildReleaseId : executorBuildReleaseId;
  if (!databaseUrl || !/^(uat|production)$/.test(environment) || !mode || !/^[0-9a-f]{40}$/.test(executorBuildReleaseId)) {
    throw new Error('release operation requires DATABASE_URL, uat|production, mode and a full GIT_SHA');
  }
  const metadataUri = process.env.ECS_CONTAINER_METADATA_URI_V4 ?? '';
  const taskArn = await readEcsTaskArn(environment, metadataUri);
  if (recoveryMode) {
    const accountId = taskArn.split(':')[4] ?? '';
    const region = process.env.AWS_REGION ?? '';
    const expectedPrefix = `${accountId}.dkr.ecr.${region}.amazonaws.com/watchdog-bms-api@sha256:`;
    if (!recoveryExecutorImage.startsWith(expectedPrefix)
      || !/^[0-9a-f]{64}$/.test(recoveryExecutorImage.slice(expectedPrefix.length))
      || !/^[1-9][0-9]*$/.test(recoveryValidatedCiRunId)) {
      throw new Error('exact recovery requires its immutable executor image and successful CI run id');
    }
  }
  const client = new Client({ connectionString: databaseUrl });
  let locked = false;
  try {
    await client.connect();
    if (needsRemoteWriterFence(mode)) {
      locked = await acquireRemoteWriterFence(client);
      if (!locked) throw new RemoteReleaseOperationBlocked(`another ${environment} writer owns the database fence`);
    }
    // An intent/binder can only name a parent created by the pre-deploy release task, which already
    // bootstrapped/applied this schema. Avoid concurrent ALTER/DDL in a three-service rollout wave.
    if (mode !== 'release-intent' && mode !== 'release-bind' && mode !== 'release-prepare') {
      await ensureRemoteReleaseOperationSchema(client);
    }

    if (mode === 'f2-plan' || mode === 'f2-apply' || mode === 'f2-verify') {
      const serving = await revalidateCurrentApiBuild(
        process.env.AWS_REGION ?? '', environment, taskArn, buildReleaseId,
      );
      console.log(`F2 current api-web build pinned: sha=${serving.buildReleaseId} deployment=${serving.currentDeployment}`);
    }

    if (mode === 'operation-reconcile') {
      const controller = controllerProvenance(environment, mode);
      const outcome = requiredText('RELEASE_RECONCILE_OUTCOME', 32) as TerminalStatus;
      if (!['SUCCEEDED', 'FAILED_CONFIRMED'].includes(outcome)) {
        throw new Error('RELEASE_RECONCILE_OUTCOME must be SUCCEEDED or FAILED_CONFIRMED');
      }
      const actorRef = requiredText('RELEASE_RECONCILE_ACTOR_REF', 512);
      if (!/^arn:aws:(iam|sts)::[0-9]{12}:.+/.test(actorRef)) {
        throw new Error('reconciliation actor must be an exact AWS IAM/STS principal ARN');
      }
      if (controller.controllerKind === 'MANUAL' && controller.manualActorRef !== actorRef) {
        throw new Error('manual reconciliation actor does not match its durable controller actor');
      }
      const result = await reconcileRemoteReleaseOperation(client, {
        id: requiredText('RELEASE_RECONCILE_OPERATION_ID', 64),
        targetEnvironment: environment,
        originalTaskArn: validateTaskArn(requiredText('RELEASE_RECONCILE_TASK_ARN', 512), environment),
        reconcilerTaskArn: taskArn,
        actorRef,
        evidenceRef: requiredText('RELEASE_RECONCILE_EVIDENCE_REF', 512),
        reason: requiredText('RELEASE_RECONCILE_REASON', 1000),
        outcome,
        controller,
      });
      console.log(`release operation reconciled: id=${process.env.RELEASE_RECONCILE_OPERATION_ID} status=${result.status} replay=${result.replay}`);
      return 0;
    }

    const provenance = controllerProvenance(environment, mode);
    const parentId = process.env.RELEASE_PARENT_OPERATION_ID ?? '';
    if (parentId && !UUID_PATTERN.test(parentId)) {
      throw new Error('RELEASE_PARENT_OPERATION_ID must be a UUID');
    }

    if (mode === 'release-pre-intent-recover') {
      if (!parentId) throw new Error('release-pre-intent-recover requires RELEASE_PARENT_OPERATION_ID');
      const result = await recoverPreIntentApiRelease(client, {
        operationId: parentId,
        targetEnvironment: environment,
        buildReleaseId,
        recoveryExecutorBuildReleaseId: executorBuildReleaseId,
        recoveryExecutorImage,
        recoveryValidatedCiRunId,
        recovererTaskArn: taskArn,
        controller: provenance,
        region: process.env.AWS_REGION ?? '',
        stoppedParentTaskEvidence,
      });
      if (result.terminalReplay) {
        console.log(`pre-intent api-web terminal replay verified: parent=${parentId} serving=${result.state.sourceSha ?? 'absent'}`);
        return 0;
      }
      const terminalized = await terminalizeRecoveredReleaseIfReady(client, {
        operationId: parentId,
        targetEnvironment: environment,
        recovererTaskArn: taskArn,
        controller: provenance,
      });
      if (!terminalized) {
        throw new RemoteReleaseOperationBlocked('pre-intent cleanup completed but another release intent still needs exact recovery');
      }
      console.log(`pre-intent api-web release recovered: parent=${parentId} replay=${result.replay} serving=${result.state.sourceSha ?? 'absent'}`);
      return 0;
    }

    if (mode === 'release-bootstrap-closed-recover') {
      if (!parentId) throw new Error('release-bootstrap-closed-recover requires RELEASE_PARENT_OPERATION_ID');
      const evidence = parseBootstrapClosedRecoveryEvidence(bootstrapClosedRecoveryText);
      const result = await recoverBootstrapClosedPreIntentRelease(client, {
        operationId: parentId,
        targetEnvironment: environment,
        buildReleaseId,
        recoveryExecutorBuildReleaseId: executorBuildReleaseId,
        recoveryExecutorImage,
        recoveryValidatedCiRunId,
        recovererTaskArn: taskArn,
        controller: provenance,
        region: process.env.AWS_REGION ?? '',
        evidence,
        stoppedParentTaskEvidence,
      });
      console.log(`bootstrap-closed pre-intent release recovered: parent=${parentId} replay=${result.replay} services=${result.services.map((item) => item.service).join(',')}`);
      return 0;
    }

    if (mode === 'release-orphan-intent-recover') {
      if (!parentId) throw new Error('release-orphan-intent-recover requires RELEASE_PARENT_OPERATION_ID');
      const intent = parseMutationIntent(environment, 'RELEASE_ORPHAN_MUTATION_INTENT_JSON');
      const requestedIntentId = requiredText('RELEASE_MUTATION_INTENT_ID', 64);
      if (requestedIntentId !== intent.id) throw new Error('orphan intent id disagrees with historical task evidence');
      const manifest = parseDeploymentManifest(
        environment, buildReleaseId, 'RELEASE_ORPHAN_DEPLOYMENT_MANIFEST_JSON',
      );
      if (manifest.length !== 1) throw new Error('orphan recovery accepts exactly one binder deployment record');
      const taskEvidence = parseOrphanTaskEvidence(environment);
      const networkEvidence = parseRecoveryNetworkEvidence(environment, intent.expectedServiceArn);
      if (!networkEvidence) throw new Error('orphan recovery requires an existing service network identity');
      const result = await recoverOrphanReleaseMutationIntent(client, {
        operationId: parentId,
        targetEnvironment: environment,
        buildReleaseId,
        recoveryExecutorBuildReleaseId: executorBuildReleaseId,
        recoveryExecutorImage,
        recoveryValidatedCiRunId,
        recovererTaskArn: taskArn,
        controller: provenance,
        region: process.env.AWS_REGION ?? '',
        intent,
        evidence: manifest[0]!,
        taskEvidence,
        networkEvidence,
        stoppedParentTaskEvidence,
      });
      const terminalized = await terminalizeRecoveredReleaseIfReady(client, {
        operationId: parentId,
        targetEnvironment: environment,
        recovererTaskArn: taskArn,
        controller: provenance,
      });
      console.log(`orphan release mutation recovered: parent=${parentId} intent=${intent.id} replay=${result.replay}`);
      console.log(`release recovery parent terminalized=${terminalized}; ${terminalized ? 'a clean release retry is now allowed' : 'recover every remaining OPEN/uncovered service before retry'}`);
      return 0;
    }

    if (mode === 'release-intent-recover') {
      if (!parentId) throw new Error('release-intent-recover requires RELEASE_PARENT_OPERATION_ID');
      const intentId = requiredText('RELEASE_MUTATION_INTENT_ID', 64);
      if (!UUID_PATTERN.test(intentId)) throw new Error('RELEASE_MUTATION_INTENT_ID must be a UUID');
      const observedSsm = requiredText('RELEASE_RECOVERY_SSM_SERVICE_ARN', 512);
      const observedSsmServiceArn = observedSsm === 'MISSING'
        ? null
        : validateServiceArn(observedSsm, environment);
      const expectedServiceArn = validateServiceArn(requiredText('RELEASE_RECOVERY_EXPECTED_SERVICE_ARN', 512), environment);
      const networkEvidence = parseRecoveryNetworkEvidence(environment, expectedServiceArn);
      const ssmParameterName = requiredText('RELEASE_RECOVERY_SSM_PARAMETER_NAME', 256);
      if (!ssmParameterName.startsWith(`/watchdog-bms/${environment}/ecs-express-`)
        || !ssmParameterName.endsWith('-service-arn')) {
        throw new Error('RELEASE_RECOVERY_SSM_PARAMETER_NAME is outside the target environment service cache');
      }
      const result = await recoverRemoteReleaseMutationIntent(client, {
        operationId: parentId,
        intentId,
        targetEnvironment: environment,
        buildReleaseId,
        recoveryExecutorBuildReleaseId: executorBuildReleaseId,
        recoveryExecutorImage,
        recoveryValidatedCiRunId,
        recovererTaskArn: taskArn,
        controller: provenance,
        region: process.env.AWS_REGION ?? '',
        observedSsmServiceArn,
        expectedServiceArn,
        ssmParameterName,
        networkEvidence,
        stoppedParentTaskEvidence,
      });
      if (result.terminalReplay) {
        console.log(`release mutation terminal replay verified: parent=${parentId} intent=${intentId} status=${result.status}`);
        return result.status === 'CONFIRMED_NO_MUTATION' ? 78 : 0;
      }
      if (result.failedBuildCleanupRequired && !result.failedBuildCleanupCompleted) {
        const deploymentEvidence = result.evidence?.deploymentArn ?? 'CONFIRMED_NO_MUTATION';
        const cleanup = await runChild(
          `./node_modules/.bin/tsx prisma/retire-failed-bootstrap-build.ts --build=${buildReleaseId} --deployment-arn=${deploymentEvidence} --intent-id=${intentId}`,
          () => undefined,
          () => undefined,
          recoveryTargetChildEnvironment(process.env, environment, buildReleaseId),
        );
        if (cleanup.code !== 0 || cleanup.signal) {
          throw new RemoteReleaseOperationBlocked('proved non-serving api-web build launch-attestation cleanup failed');
        }
        const marked = await client.query(`
          UPDATE "RemoteReleaseMutationIntent"
             SET "failedBuildCleanupCompletedAt" = COALESCE("failedBuildCleanupCompletedAt", CURRENT_TIMESTAMP),
                 "legacyRollbackCleanedAt" = CASE WHEN "legacyRollbackObservedAt" IS NOT NULL
                   THEN COALESCE("legacyRollbackCleanedAt", CURRENT_TIMESTAMP) ELSE "legacyRollbackCleanedAt" END,
                 "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $1 AND "failedBuildCleanupRequiredAt" IS NOT NULL
        `, [intentId]);
        if (marked.rowCount !== 1) throw new RemoteReleaseOperationBlocked('failed api-web build cleanup marker could not be persisted');
      } else if (!result.rollback && !result.legacyCutoverCompleted
        && result.status === 'BOUND' && result.evidence?.service === 'api-web'
        && result.evidence.deploymentArn && !result.evidence.noOp) {
        const cleanup = await runChild(
          `./node_modules/.bin/tsx prisma/retire-launch-builds.ts --mode=retire --active-builds=${buildReleaseId} --deployment-arn=${result.evidence.deploymentArn}`,
          () => undefined,
          () => undefined,
          recoveryTargetChildEnvironment(process.env, environment, buildReleaseId),
        );
        if (cleanup.code !== 0 || cleanup.signal) {
          throw new RemoteReleaseOperationBlocked('api-web remote success was proved but superseded launch authority cleanup failed');
        }
        await markRecoveredLegacyCutoverCompleted(client, {
          operationId: parentId,
          targetEnvironment: environment,
          buildReleaseId,
        });
      }
      const terminalized = await terminalizeRecoveredReleaseIfReady(client, {
        operationId: parentId,
        targetEnvironment: environment,
        recovererTaskArn: taskArn,
        controller: provenance,
      });
      console.log(`release mutation intent recovered: parent=${parentId} intent=${intentId} status=${result.status} replay=${result.replay} repairSsm=${result.repairSsm} legacyRollback=${result.legacyRollback}`);
      console.log(`release recovery parent terminalized=${terminalized}; ${terminalized ? 'a clean release retry is now allowed' : 'recover every remaining OPEN intent before retry'}`);
      return result.status === 'CONFIRMED_NO_MUTATION' ? 78 : 0;
    }

    if (mode === 'release-intent') {
      if (!parentId) throw new Error('release-intent requires RELEASE_PARENT_OPERATION_ID');
      const intent = parseMutationIntent(environment);
      const result = await prepareRemoteReleaseMutationIntent(client, {
        operationId: parentId,
        targetEnvironment: environment,
        buildReleaseId,
        preparerTaskArn: taskArn,
        controller: provenance,
        intent,
      });
      console.log(`release mutation intent prepared: parent=${parentId} intent=${intent.id} service=${intent.serviceKey} replay=${result.replay}`);
      return 0;
    }

    if (mode === 'release-bind') {
      if (!parentId) throw new Error('release-bind requires RELEASE_PARENT_OPERATION_ID');
      const intentId = requiredText('RELEASE_MUTATION_INTENT_ID', 64);
      if (!UUID_PATTERN.test(intentId)) throw new Error('RELEASE_MUTATION_INTENT_ID must be a UUID');
      const manifest = parseDeploymentManifest(environment, buildReleaseId);
      if (manifest.length !== 1) throw new Error('release-bind accepts exactly one service evidence record');
      const result = await bindRemoteReleaseDeployment(client, {
        id: parentId,
        targetEnvironment: environment,
        buildReleaseId,
        binderTaskArn: taskArn,
        controller: provenance,
        intentId,
        evidence: manifest[0]!,
      });
      console.log(`release deployment bound: id=${parentId} service=${manifest[0]!.service} replay=${result.replay}`);
      return 0;
    }

    const deploymentArn = validateDeploymentArn(process.env.RELEASE_OPERATION_DEPLOYMENT_ARN ?? '', environment);
    if ((mode === 'retire' || mode === 'reconcile') && !deploymentArn) {
      throw new Error(`${mode} requires RELEASE_OPERATION_DEPLOYMENT_ARN`);
    }
    const id = parentId || process.env.RELEASE_OPERATION_ID || randomUUID();
    if (!UUID_PATTERN.test(id)) throw new Error('RELEASE_OPERATION_ID must be a UUID');
    const retirement = mode === 'retire' || mode === 'reconcile';
    const serviceArn = retirement
      ? validateServiceArn(requiredText('RELEASE_OPERATION_SERVICE_ARN', 512), environment)
      : null;
    const targetRevisionArn = retirement
      ? validateRevisionArn(requiredText('RELEASE_OPERATION_TARGET_REVISION_ARN', 512), environment)
      : null;
    const activeBuildsText = retirement ? requiredText('RELEASE_OPERATION_ACTIVE_BUILDS', 81) : '';
    if (retirement && !/^[0-9a-f]{40}(,[0-9a-f]{40})?$/.test(activeBuildsText)) {
      throw new Error('RELEASE_OPERATION_ACTIVE_BUILDS must be one or two full commit SHAs');
    }
    const manifest = parentId ? parseDeploymentManifest(environment, buildReleaseId) : null;
    if (mode === 'release-finalize') {
      if (!parentId || !manifest) throw new Error('release-finalize requires a parent operation and exact deployment manifest');
      await attachRemoteReleaseFinalizer(client, {
        id,
        targetEnvironment: environment,
        buildReleaseId,
        finalizerTaskArn: taskArn,
        controller: provenance,
        manifest,
        ecsServiceArn: null,
        serviceDeploymentArn: null,
        targetServiceRevisionArn: null,
        activeBuilds: null,
      });
      await finishRemoteReleaseOperation(client, id, taskArn, 'SUCCEEDED', 'health-verified deployment manifest finalized without launch retirement');
      console.log(`release operation finalized: id=${id} services=${manifest.map((row) => row.service).join(',')}`);
      return 0;
    }

    const command = requiredText('RELEASE_OPERATION_COMMAND', 32_768);
    if (parentId) {
      if (!retirement || !manifest) throw new Error('only retirement/reconciliation may attach to a held release operation');
      await attachRemoteReleaseFinalizer(client, {
        id,
        targetEnvironment: environment,
        buildReleaseId,
        finalizerTaskArn: taskArn,
        controller: provenance,
        manifest,
        ecsServiceArn: serviceArn,
        serviceDeploymentArn: deploymentArn,
        targetServiceRevisionArn: targetRevisionArn,
        activeBuilds: activeBuildsText.split(','),
      });
      console.log(`release operation finalizer attached: id=${id} task=${taskArn} deployment=${deploymentArn}`);
    } else {
      await beginRemoteReleaseOperation(client, {
        id,
        targetEnvironment: environment,
        mode: durableMode,
        releaseDeployTarget: durableMode === 'release' ? requiredText('RELEASE_DEPLOY_TARGET', 32) : null,
        buildReleaseId,
        ecsTaskArn: taskArn,
        ecsServiceArn: serviceArn,
        serviceDeploymentArn: deploymentArn,
        targetServiceRevisionArn: targetRevisionArn,
        activeBuilds: retirement ? activeBuildsText.split(',') : null,
        deploymentManifest: null,
        ...provenance,
      });
      console.log(`release operation started: id=${id} environment=${environment} mode=${mode} task=${taskArn} deployment=${deploymentArn ?? 'none'}`);
    }

    let child: ChildProcess | null = null;
    let interrupted = false;
    let leaseFailure: unknown = null;
    let heartbeatInFlight: Promise<void> | null = null;
    let killTimer: NodeJS.Timeout | null = null;
    const stopChild = () => {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      if (!killTimer) {
        killTimer = setTimeout(() => {
          if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }, 10_000);
        killTimer.unref();
      }
    };
    const interrupt = () => { interrupted = true; stopChild(); };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    client.once('error', (error) => { leaseFailure = error; stopChild(); });
    const heartbeat = setInterval(() => {
      if (heartbeatInFlight) return;
      heartbeatInFlight = heartbeatRemoteReleaseOperation(client, id, taskArn)
        .catch((error) => { leaseFailure = error; stopChild(); })
        .finally(() => { heartbeatInFlight = null; });
    }, HEARTBEAT_MS);

    let childResult: { code: number | null; signal: NodeJS.Signals | null };
    try {
      if (retirement) {
        try {
          await heartbeatRemoteReleaseOperation(client, id, taskArn);
          if (interrupted || leaseFailure) throw new Error('retirement platform authorization was interrupted');
          const authorizedAt = await revalidateRetirementPlatform(process.env.AWS_REGION ?? '', {
            serviceArn: serviceArn!,
            deploymentArn: deploymentArn!,
            targetRevisionArn: targetRevisionArn!,
            activeBuilds: activeBuildsText.split(','),
          });
          await heartbeatRemoteReleaseOperation(client, id, taskArn);
          await recordPlatformAuthorization(client, id, taskArn, authorizedAt);
          console.log(`release operation platform-authorized: id=${id} deployment=${deploymentArn}`);
        } catch (error) {
          await finishRemoteReleaseOperation(client, id, taskArn, 'UNKNOWN', String(error)).catch(() => undefined);
          throw error;
        }
      }
      childResult = await runChild(command, (running) => { child = running; }, () => {
        if (interrupted || leaseFailure) {
          throw new RemoteReleaseOperationInterrupted(
            leaseFailure
              ? `database lease/heartbeat failed before child launch: ${String(leaseFailure)}`
              : 'operation interrupted before child launch',
          );
        }
      });
    } catch (error) {
      if (error instanceof RemoteReleaseOperationInterrupted) {
        await finishRemoteReleaseOperation(client, id, taskArn, 'UNKNOWN', error.message).catch(() => undefined);
        console.error(`release operation UNKNOWN: id=${id} reason=${error.message}`);
        return 1;
      }
      throw error;
    } finally {
      clearInterval(heartbeat);
      if (heartbeatInFlight) await heartbeatInFlight;
      if (killTimer) clearTimeout(killTimer);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }

    if (leaseFailure || interrupted || childResult.signal) {
      const reason = leaseFailure
        ? `database lease/heartbeat failed: ${String(leaseFailure)}`
        : `operation interrupted without a definitive child outcome (${childResult.signal ?? 'signal'})`;
      await finishRemoteReleaseOperation(client, id, taskArn, 'UNKNOWN', reason).catch(() => undefined);
      console.error(`release operation UNKNOWN: id=${id} reason=${reason}`);
      return 1;
    }
    if ((mode === 'release' || mode === 'release-prepare') && childResult.code === 0) {
      await holdRemoteReleaseOperation(client, id, taskArn);
      console.log(`release operation awaiting rollout finalization: id=${id} holdSeconds=${ROLLOUT_HOLD_SECONDS}`);
      return 0;
    }
    const status = classifyChildOutcome(mode, childResult, Boolean(parentId));
    let reason = `child exited ${childResult.code}`;
    if (status === 'UNKNOWN') {
      reason = `mutating child exited ${childResult.code}; partial side effects were not independently disproved`;
    } else if (status === 'FAILED_CONFIRMED' && parentId && mode === 'reconcile') {
      reason = 'rollout failed or rolled back; launch authority reconciliation completed';
    }
    await finishRemoteReleaseOperation(client, id, taskArn, status, reason);
    console.log(`release operation finished: id=${id} status=${status}`);
    return childResult.code ?? 1;
  } finally {
    if (locked) await releaseRemoteWriterFence(client).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

if (require.main === module) {
  main()
    .then((exitCode) => { process.exitCode = exitCode; })
    .catch((error: any) => {
      console.error('release operation failed:', error?.message ?? error);
      process.exitCode = error instanceof RemoteReleaseOperationBlocked ? error.exitCode : 1;
    });
}
