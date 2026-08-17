import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import {
  RemoteReleaseOperationBlocked,
  RemoteReleaseOperationInterrupted,
  acquireRemoteWriterFence,
  attachRemoteReleaseFinalizer,
  beginRemoteReleaseOperation,
  bindRemoteReleaseDeployment,
  classifyChildOutcome,
  decideMutationIntentRecovery,
  ensureRecoveredSsmIdentity,
  ensureRemoteReleaseOperationSchema,
  finishRemoteReleaseOperation,
  holdRemoteReleaseOperation,
  markRecoveredLegacyCutoverCompleted,
  needsRemoteWriterFence,
  parseOrphanTaskEvidence,
  parseStoppedParentTaskEvidence,
  parseBootstrapClosedRecoveryEvidence,
  prepareRemoteReleaseMutationIntent,
  recoverOrphanReleaseMutationIntent,
  recoverBootstrapClosedPreIntentRelease,
  recoverPreIntentApiRelease,
  recoverRemoteReleaseMutationIntent,
  reconcileRemoteReleaseOperation,
  releaseRemoteWriterFence,
  recoveryTargetChildEnvironment,
  runChild,
  terminalizeRecoveredReleaseIfReady,
  validateCurrentApiBuildState,
  validateBootstrapClosedRecoveryPlatform,
  validateGithubControllerWorkflow,
  validateManualControllerMode,
  validateOrphanMutationPlatform,
  validatePreIntentApiNoMutation,
  validateRetirementPlatformState,
  validateStoredIntentRecoveryReplay,
  validateStoredPreIntentReplay,
} from './run-exclusive-release-operation';

function rootDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(__dirname, '../../..', '.env'), 'utf8');
    return /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(env)?.[1] ?? null;
  } catch {
    return null;
  }
}

function isConnectionRefused(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; errors?: unknown[] };
  if (candidate.code === 'ECONNREFUSED') return true;
  return Array.isArray(candidate.errors)
    && candidate.errors.length > 0
    && candidate.errors.every(isConnectionRefused);
}

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SERVICE = 'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-uat/api-web';
const DEPLOYMENT = 'arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-uat/api-web/deploy-1';
const REVISION = 'arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-uat/api-web/rev-1';
const TASK_A = 'arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-uat/task-a';
const TASK_B = 'arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-uat/task-b';
const TASK_C = 'arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-uat/task-c';
const stoppedParentTaskEvidence = (taskArn = TASK_A) => parseStoppedParentTaskEvidence('uat', JSON.stringify({
  taskArn,
  taskDefinitionArn: 'arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-uat-release-task:55',
  lastStatus: 'STOPPED',
  desiredStatus: 'STOPPED',
  stoppedAt: '2026-08-03T03:28:45.366Z',
  stopCode: 'EssentialContainerExited',
  stoppedReason: 'Essential container in task exited',
  startedBy: 'watchdog-bms-uat-release',
  group: 'family:watchdog-bms-uat-release-task',
}));
const GITHUB_CONTROLLER = {
  sourceBranch: 'develop',
  controllerKind: 'GITHUB_ACTIONS' as const,
  githubRunId: '123456',
  githubRunAttempt: 2,
  githubActor: 'uat-operator',
  githubActorId: '789',
  githubWorkflowRef: 'example/watchdog/.github/workflows/f2-normalize-apply.yml@refs/heads/main',
  githubRepository: 'example/watchdog',
  manualActorRef: null,
};

const operation = (id: string, taskArn: string) => ({
  id,
  targetEnvironment: 'uat' as const,
  mode: 'f2-apply',
  releaseDeployTarget: null,
  buildReleaseId: SHA_A,
  ecsTaskArn: taskArn,
  ecsServiceArn: null,
  serviceDeploymentArn: null,
  targetServiceRevisionArn: null,
  activeBuilds: null,
  deploymentManifest: null,
  ...GITHUB_CONTROLLER,
  leaseSeconds: 30,
});

it('accepts only exact canonical STOPPED parent-task evidence', () => {
  assert.equal(stoppedParentTaskEvidence().taskArn, TASK_A);
  assert.throws(() => parseStoppedParentTaskEvidence('uat', JSON.stringify({
    ...stoppedParentTaskEvidence(), lastStatus: 'RUNNING',
  })), /not stably STOPPED/);
  assert.throws(() => parseStoppedParentTaskEvidence('uat', JSON.stringify({
    ...stoppedParentTaskEvidence(), unexpected: true,
  })), /unexpected shape/);
  assert.throws(() => parseStoppedParentTaskEvidence('uat', JSON.stringify({
    ...stoppedParentTaskEvidence(),
    taskDefinitionArn: 'arn:aws:ecs:ap-southeast-1:000000000000:task-definition/watchdog-bms-uat-release-task:55',
  })), /outside the exact release family/);
  assert.throws(() => parseStoppedParentTaskEvidence('production', JSON.stringify(
    stoppedParentTaskEvidence(),
  )), /watchdog-bms-prod|exact watchdog-bms-prod task/);
});

it('keeps retained evidence separate from the exact reviewed expired-task incident', () => {
  const manifestPath = 'infra/uat/recovery-evidence/bf131086-6055-4143-a77c-579bc7d58b57.json';
  const manifestBytes = readFileSync(join(__dirname, '../../..', manifestPath));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const base = {
    parentTaskArn: manifest.tasks.parent.taskArn,
    intentTaskArn: manifest.tasks.intent.taskArn,
    binderTaskArn: manifest.tasks.binder.taskArn,
    parentTaskDefinitionArn: manifest.tasks.parent.taskDefinitionArn,
    intentTaskDefinitionArn: manifest.tasks.intent.taskDefinitionArn,
    binderTaskDefinitionArn: manifest.tasks.binder.taskDefinitionArn,
    imageDigest: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:${'e'.repeat(64)}`,
    parentStartedAt: manifest.tasks.parent.startedAt,
    parentStoppedAt: manifest.tasks.parent.stoppedAt,
    intentStartedAt: manifest.tasks.intent.startedAt,
    intentStoppedAt: manifest.tasks.intent.stoppedAt,
    binderStartedAt: manifest.tasks.binder.startedAt,
    binderStoppedAt: manifest.tasks.binder.stoppedAt,
    originalController: {
      ...GITHUB_CONTROLLER,
      githubRunId: manifest.githubRunId,
      githubWorkflowRef: 'example/watchdog/.github/workflows/deploy-uat.yml@refs/heads/main',
    },
  };
  const retained = parseOrphanTaskEvidence('uat', JSON.stringify({
    ...base, evidenceKind: 'RETAINED_ECS_TASK',
  }));
  assert.equal(retained.evidenceKind, 'RETAINED_ECS_TASK');
  assert.equal(retained.reviewedEvidenceManifestPath, null);
  assert.equal(retained.reviewedAuditMetadata, null);
  const productionV2 = parseOrphanTaskEvidence('production', JSON.stringify({
    ...base,
    parentTaskArn: base.parentTaskArn.replace('watchdog-bms-uat/', 'watchdog-bms-prod/'),
    intentTaskArn: base.intentTaskArn.replace('watchdog-bms-uat/', 'watchdog-bms-prod/'),
    binderTaskArn: base.binderTaskArn.replace('watchdog-bms-uat/', 'watchdog-bms-prod/'),
    parentTaskDefinitionArn: base.parentTaskDefinitionArn.replace('watchdog-bms-uat-release-task', 'watchdog-bms-release-task'),
    intentTaskDefinitionArn: base.intentTaskDefinitionArn.replace('watchdog-bms-uat-release-task', 'watchdog-bms-release-task'),
    binderTaskDefinitionArn: base.binderTaskDefinitionArn.replace('watchdog-bms-uat-release-task', 'watchdog-bms-release-task'),
    originalController: {
      ...base.originalController,
      sourceBranch: 'main',
      githubWorkflowRef: 'example/watchdog/.github/workflows/deploy-production-v2.yml@refs/heads/main',
    },
    evidenceKind: 'RETAINED_ECS_TASK',
  }));
  assert.equal(productionV2.originalController.githubWorkflowRef,
    'example/watchdog/.github/workflows/deploy-production-v2.yml@refs/heads/main');
  assert.throws(() => parseOrphanTaskEvidence('uat', JSON.stringify({
    ...base,
    evidenceKind: 'RETAINED_ECS_TASK',
    reviewedEvidenceManifestPath: manifestPath,
    reviewedEvidenceManifestSha256: 'f'.repeat(64),
    reviewedAuditMetadata: manifest.auditMetadata,
  })), /retained ECS task evidence cannot carry reviewed-expiry authority/);

  const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
  const expiredInput = {
    ...base,
    evidenceKind: 'REVIEWED_EXPIRED_ECS_TASK',
    reviewedEvidenceManifestPath: manifestPath,
    reviewedEvidenceManifestSha256: manifestSha256,
    reviewedAuditMetadata: manifest.auditMetadata,
  };
  const expired = parseOrphanTaskEvidence('uat', JSON.stringify(expiredInput));
  assert.equal(expired.evidenceKind, 'REVIEWED_EXPIRED_ECS_TASK');
  assert.equal(expired.reviewedEvidenceManifestSha256, manifestSha256);
  assert.deepEqual(expired.reviewedAuditMetadata, manifest.auditMetadata);
  assert.throws(() => parseOrphanTaskEvidence('uat', JSON.stringify({
    ...expiredInput, reviewedEvidenceManifestSha256: '0'.repeat(64),
  })), /does not match the pinned incident manifest/);
  assert.throws(() => parseOrphanTaskEvidence('uat', JSON.stringify({
    ...expiredInput,
    reviewedAuditMetadata: {
      ...manifest.auditMetadata,
      cloudTrailRunTaskEvents: {
        ...manifest.auditMetadata.cloudTrailRunTaskEvents,
        parent: {
          ...manifest.auditMetadata.cloudTrailRunTaskEvents.parent,
          eventId: '00000000-0000-0000-0000-000000000000',
        },
      },
    },
  })), /does not match the pinned incident manifest/);
  assert.throws(() => parseOrphanTaskEvidence('production', JSON.stringify(expiredInput)), /UAT-only/);
});

const intent = (id: string, service: 'api-web' | 'ai-gateway' | 'workers', serviceArn: string) => {
  const serviceName = serviceArn.split('/').at(-1)!;
  return {
    id,
    serviceKey: service,
    mutationKind: 'UPDATE' as const,
    expectedServiceArn: serviceArn,
    clusterName: 'watchdog-bms-uat',
    serviceName,
    ssmParameterName: `/watchdog-bms/uat/ecs-express-${service}-service-arn`,
    requestHash: '1'.repeat(64),
    desiredConfigHash: '2'.repeat(64),
    beforeDeploymentArns: [],
    beforeCurrentDeploymentArn: null,
    beforeActiveConfigurations: [],
    legacyBootstrapDescriptor: null,
  };
};

describe('durable remote release operation (real PostgreSQL)', () => {
  let first: Client | null = null;
  let second: Client | null = null;
  let reachable = false;
  let schemaCreated = false;
  const schema = `release_operation_spec_${process.pid}`;

  before(async () => {
    const explicitDatabaseUrl = Boolean(process.env.DATABASE_URL);
    const url = rootDatabaseUrl();
    if (!url) return;
    first = new Client({ connectionString: url });
    second = new Client({ connectionString: url });
    try {
      await first.connect();
      await second.connect();
    } catch (error) {
      await first.end().catch(() => undefined);
      await second.end().catch(() => undefined);
      first = null;
      second = null;
      // A developer without a configured local database may skip these integration cases. CI and
      // every explicit invocation promise a database, so an unreachable URL is a hard failure.
      if (!explicitDatabaseUrl && isConnectionRefused(error)) return;
      throw error;
    }
    // Once PostgreSQL accepted the connection, schema/migration/setup regressions are test
    // failures. They must never be downgraded to an environment skip by a broad catch.
    await first.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    for (const client of [first, second]) await client.query(`SET search_path TO "${schema}", public`);
    await first.query(`
      CREATE TABLE "AuditLog" (
        "id" TEXT PRIMARY KEY, "companyId" TEXT, "actorType" TEXT, "actorUserId" TEXT,
        "actorRefId" TEXT, "action" TEXT, "targetType" TEXT, "targetId" TEXT,
        "requestId" TEXT, "result" TEXT, "riskLevel" TEXT, "metadataJson" JSONB,
        "createdAt" TIMESTAMP(3)
      )
    `);
    await ensureRemoteReleaseOperationSchema(first);
    reachable = true;
  });

  after(async () => {
    if (first) {
      if (schemaCreated) await first.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => undefined);
      await first.end().catch(() => undefined);
    }
    if (second) await second.end().catch(() => undefined);
  });

  it('serializes writers, expires to blocking UNKNOWN, and reconciles exact identity idempotently', async (t) => {
    if (!reachable || !first || !second) return t.skip('no local PostgreSQL database is reachable');

    assert.equal(await acquireRemoteWriterFence(first), true);
    assert.equal(await acquireRemoteWriterFence(second), false, 'a second DB session cannot own the writer fence');

    const firstId = randomUUID();
    await beginRemoteReleaseOperation(first, operation(firstId, TASK_A));
    await assert.rejects(
      () => beginRemoteReleaseOperation(first!, operation(randomUUID(), TASK_B)),
      RemoteReleaseOperationBlocked,
    );
    const stored = await first.query(`
      SELECT "sourceBranch", "controllerKind", "githubRunId", "githubRunAttempt", "githubActor",
             "githubActorId", "githubWorkflowRef", "githubRepository", "ecsTaskArn"
        FROM "RemoteReleaseOperation" WHERE "id" = $1
    `, [firstId]);
    assert.deepEqual(stored.rows[0], {
      sourceBranch: 'develop',
      controllerKind: 'GITHUB_ACTIONS',
      githubRunId: '123456',
      githubRunAttempt: 2,
      githubActor: 'uat-operator',
      githubActorId: '789',
      githubWorkflowRef: 'example/watchdog/.github/workflows/f2-normalize-apply.yml@refs/heads/main',
      githubRepository: 'example/watchdog',
      ecsTaskArn: TASK_A,
    });

    await first.query('UPDATE "RemoteReleaseOperation" SET "leaseExpiresAt" = CURRENT_TIMESTAMP - INTERVAL \'1 second\' WHERE "id" = $1', [firstId]);
    assert.equal((await first.query('SELECT "status" FROM "RemoteReleaseOperation" WHERE "id" = $1', [firstId])).rows[0].status, 'RUNNING');
    await assert.rejects(
      () => beginRemoteReleaseOperation(first!, operation(randomUUID(), TASK_B)),
      /became UNKNOWN/,
    );
    assert.equal((await first.query('SELECT "status" FROM "RemoteReleaseOperation" WHERE "id" = $1', [firstId])).rows[0].status, 'UNKNOWN');
    await assert.rejects(
      () => beginRemoteReleaseOperation(first!, operation(randomUUID(), TASK_B)),
      /blocked by UNKNOWN/,
    );

    await assert.rejects(() => reconcileRemoteReleaseOperation(first!, {
      id: firstId,
      targetEnvironment: 'uat',
      originalTaskArn: TASK_B,
      reconcilerTaskArn: TASK_B,
      actorRef: 'arn:aws:sts::311414082667:assumed-role/watchdog-bms-deploy-uat/operator',
      evidenceRef: 'cloudwatch://wrong-task',
      reason: 'wrong task must not resolve the unknown operation',
      outcome: 'FAILED_CONFIRMED',
      controller: GITHUB_CONTROLLER,
    }), /belongs to/);

    const reconcileInput = {
      id: firstId,
      targetEnvironment: 'uat' as const,
      originalTaskArn: TASK_A,
      reconcilerTaskArn: TASK_B,
      actorRef: 'arn:aws:sts::311414082667:assumed-role/watchdog-bms-deploy-uat/operator',
      evidenceRef: 'cloudwatch://release/task-a/terminal-success',
      reason: 'task exit and post-condition independently confirmed',
      outcome: 'SUCCEEDED' as const,
      controller: GITHUB_CONTROLLER,
    };
    assert.deepEqual(await reconcileRemoteReleaseOperation(first, reconcileInput), {
      status: 'RECONCILED_SUCCEEDED', replay: false,
    });
    assert.deepEqual(await reconcileRemoteReleaseOperation(first, reconcileInput), {
      status: 'RECONCILED_SUCCEEDED', replay: true,
    });
    const audits = await first.query(`SELECT "metadataJson" FROM "AuditLog" WHERE "targetId" = $1`, [firstId]);
    assert.equal(audits.rowCount, 1);
    assert.deepEqual(audits.rows[0].metadataJson.controller, GITHUB_CONTROLLER);

    const secondId = randomUUID();
    await beginRemoteReleaseOperation(first, operation(secondId, TASK_B));
    await finishRemoteReleaseOperation(first, secondId, TASK_B, 'SUCCEEDED', 'test completed');
    assert.equal((await first.query('SELECT "status" FROM "RemoteReleaseOperation" WHERE "id" = $1', [secondId])).rows[0].status, 'SUCCEEDED');

    await releaseRemoteWriterFence(first);
    assert.equal(await acquireRemoteWriterFence(second), true);
    await releaseRemoteWriterFence(second);
  });

  it('holds one release across concurrent/repeated rollout binding and cancellation expires to UNKNOWN', async (t) => {
    if (!reachable || !first || !second) return t.skip('no local PostgreSQL database is reachable');
    assert.equal(await acquireRemoteWriterFence(first), true);
    const releaseId = randomUUID();
    await beginRemoteReleaseOperation(first, {
      ...operation(releaseId, TASK_A),
      mode: 'release',
      releaseDeployTarget: 'all',
      deploymentManifest: null,
    });
    await holdRemoteReleaseOperation(first, releaseId, TASK_A);
    const evidence = {
      service: 'api-web',
      serviceArn: SERVICE,
      deploymentArn: DEPLOYMENT,
      targetRevisionArn: REVISION,
      sourceSha: SHA_A,
      noOp: false,
    };
    const aiEvidence = {
      service: 'ai-gateway',
      serviceArn: SERVICE.replace('/api-web', '/ai-gateway'),
      deploymentArn: DEPLOYMENT.replace('/api-web/', '/ai-gateway/'),
      targetRevisionArn: REVISION.replace('/api-web/', '/ai-gateway/'),
      sourceSha: SHA_A,
      noOp: false,
    };
    const workerEvidence = {
      service: 'workers',
      serviceArn: SERVICE.replace('/api-web', '/workers'),
      deploymentArn: DEPLOYMENT.replace('/api-web/', '/workers/'),
      targetRevisionArn: REVISION.replace('/api-web/', '/workers/'),
      sourceSha: SHA_A,
      noOp: false,
    };
    const apiIntentId = randomUUID();
    const aiIntentId = randomUUID();
    const workerIntentId = randomUUID();
    await assert.rejects(() => prepareRemoteReleaseMutationIntent(first!, {
      operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
      intent: { ...intent(randomUUID(), 'ai-gateway', aiEvidence.serviceArn), legacyBootstrapDescriptor: { historical: true } },
    }), /valid only for api-web/);
    await Promise.all([
      prepareRemoteReleaseMutationIntent(first, {
        operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
        preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
        intent: intent(apiIntentId, 'api-web', evidence.serviceArn),
      }),
      prepareRemoteReleaseMutationIntent(second, {
        operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
        preparerTaskArn: TASK_C, controller: GITHUB_CONTROLLER,
        intent: intent(aiIntentId, 'ai-gateway', aiEvidence.serviceArn),
      }),
    ]);
    await prepareRemoteReleaseMutationIntent(first, {
      operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
      intent: intent(workerIntentId, 'workers', workerEvidence.serviceArn),
    });
    const [apiBind, aiBind] = await Promise.all([
      bindRemoteReleaseDeployment(first, {
        id: releaseId,
        targetEnvironment: 'uat',
        buildReleaseId: SHA_A,
        binderTaskArn: TASK_B,
        controller: GITHUB_CONTROLLER,
        intentId: apiIntentId,
        evidence,
      }),
      bindRemoteReleaseDeployment(second, {
        id: releaseId,
        targetEnvironment: 'uat',
        buildReleaseId: SHA_A,
        binderTaskArn: TASK_C,
        controller: GITHUB_CONTROLLER,
        intentId: aiIntentId,
        evidence: aiEvidence,
      }),
    ]);
    const workerBind = await bindRemoteReleaseDeployment(first, {
      id: releaseId,
      targetEnvironment: 'uat',
      buildReleaseId: SHA_A,
      binderTaskArn: TASK_B,
      controller: GITHUB_CONTROLLER,
      intentId: workerIntentId,
      evidence: workerEvidence,
    });
    assert.deepEqual(apiBind, { replay: false });
    assert.deepEqual(aiBind, { replay: false });
    assert.deepEqual(workerBind, { replay: false });
    assert.deepEqual(await bindRemoteReleaseDeployment(first, {
      id: releaseId,
      targetEnvironment: 'uat',
      buildReleaseId: SHA_A,
      binderTaskArn: TASK_B,
      controller: GITHUB_CONTROLLER,
      intentId: apiIntentId,
      evidence,
    }), { replay: true });
    const apiRefresh = {
      ...evidence,
      deploymentArn: DEPLOYMENT.replace('deploy-1', 'deploy-2'),
      targetRevisionArn: REVISION.replace('rev-1', 'rev-2'),
    };
    const refreshIntentId = randomUUID();
    await prepareRemoteReleaseMutationIntent(first, {
      operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
      intent: intent(refreshIntentId, 'api-web', evidence.serviceArn),
    });
    assert.deepEqual(await bindRemoteReleaseDeployment(first, {
      id: releaseId,
      targetEnvironment: 'uat',
      buildReleaseId: SHA_A,
      binderTaskArn: TASK_B,
      controller: GITHUB_CONTROLLER,
      intentId: refreshIntentId,
      evidence: apiRefresh,
    }), { replay: false }, 'a later exact rollout of the same logical service is preserved');
    assert.equal((await first.query(`SELECT count(*)::int AS count FROM "AuditLog" WHERE "action" = 'system.release_operation.bind_deployment' AND "targetId" = $1`, [releaseId])).rows[0].count, 4);
    await assert.rejects(
      () => beginRemoteReleaseOperation(first!, operation(randomUUID(), TASK_B)),
      /still RUNNING/,
    );
    await assert.rejects(() => attachRemoteReleaseFinalizer(first!, {
      id: releaseId,
      targetEnvironment: 'uat',
      buildReleaseId: SHA_A,
      finalizerTaskArn: TASK_B,
      controller: GITHUB_CONTROLLER,
      manifest: [apiRefresh, aiEvidence, workerEvidence],
      ecsServiceArn: SERVICE,
      serviceDeploymentArn: DEPLOYMENT,
      targetServiceRevisionArn: REVISION,
      activeBuilds: [SHA_A],
    }), /does not exactly match/, 'finalization cannot erase an intermediate deployment');
    await assert.rejects(() => attachRemoteReleaseFinalizer(first!, {
      id: releaseId,
      targetEnvironment: 'uat',
      buildReleaseId: SHA_A,
      finalizerTaskArn: TASK_B,
      controller: GITHUB_CONTROLLER,
      manifest: [evidence, apiRefresh, aiEvidence, workerEvidence, { ...aiEvidence, deploymentArn: `${aiEvidence.deploymentArn}-fabricated` }],
      ecsServiceArn: SERVICE,
      serviceDeploymentArn: DEPLOYMENT,
      targetServiceRevisionArn: REVISION,
      activeBuilds: [SHA_A],
    }), /does not exactly match/, 'finalization cannot invent evidence that no binder persisted');
    const finalizerInput = (finalizerTaskArn: string) => ({
      id: releaseId,
      targetEnvironment: 'uat' as const,
      buildReleaseId: SHA_A,
      finalizerTaskArn,
      controller: GITHUB_CONTROLLER,
      manifest: [evidence, apiRefresh, aiEvidence, workerEvidence],
      ecsServiceArn: SERVICE,
      serviceDeploymentArn: DEPLOYMENT,
      targetServiceRevisionArn: REVISION,
      activeBuilds: [SHA_A],
    });
    const finalizerRace = await Promise.allSettled([
      attachRemoteReleaseFinalizer(first, finalizerInput(TASK_B)),
      attachRemoteReleaseFinalizer(second, finalizerInput(TASK_C)),
    ]);
    assert.equal(finalizerRace.filter((result) => result.status === 'fulfilled').length, 1,
      'exactly one concurrent finalizer takes the parent lease');
    const loser = finalizerRace.find((result) => result.status === 'rejected');
    assert.match(String(loser && loser.status === 'rejected' ? loser.reason : ''), /another release finalizer/);
    const finalizerOwner = (await first.query(
      `SELECT "leaseOwner" FROM "RemoteReleaseOperation" WHERE "id" = $1`, [releaseId],
    )).rows[0].leaseOwner as string;
    await attachRemoteReleaseFinalizer(first, finalizerInput(finalizerOwner));
    await assert.rejects(() => bindRemoteReleaseDeployment(second!, {
      id: releaseId,
      targetEnvironment: 'uat',
      buildReleaseId: SHA_A,
      binderTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER,
      intentId: refreshIntentId,
      evidence: { ...apiRefresh, deploymentArn: DEPLOYMENT.replace('deploy-1', 'deploy-late') },
    }), /after release finalization started/);
    await finishRemoteReleaseOperation(first, releaseId, finalizerOwner, 'SUCCEEDED', 'retirement and health finalized');
    const completed = await first.query(`SELECT "status", "ecsTaskArn", "leaseOwner", "deploymentManifestJson" FROM "RemoteReleaseOperation" WHERE "id" = $1`, [releaseId]);
    assert.equal(completed.rows[0].status, 'SUCCEEDED');
    assert.equal(completed.rows[0].ecsTaskArn, TASK_A, 'original release task identity is retained');
    assert.equal(completed.rows[0].leaseOwner, finalizerOwner, 'exact race winner owns the terminal transition');
    assert.deepEqual(completed.rows[0].deploymentManifestJson, [evidence, apiRefresh, aiEvidence, workerEvidence]);

    const cancelledId = randomUUID();
    await beginRemoteReleaseOperation(first, {
      ...operation(cancelledId, TASK_A),
      mode: 'release',
      releaseDeployTarget: 'all',
      deploymentManifest: null,
    });
    await holdRemoteReleaseOperation(first, cancelledId, TASK_A);
    const cancelledIntentId = randomUUID();
    await prepareRemoteReleaseMutationIntent(first, {
      operationId: cancelledId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
      intent: intent(cancelledIntentId, 'api-web', evidence.serviceArn),
    });
    await first.query('UPDATE "RemoteReleaseOperation" SET "leaseExpiresAt" = CURRENT_TIMESTAMP - INTERVAL \'1 second\' WHERE "id" = $1', [cancelledId]);
    await assert.rejects(() => bindRemoteReleaseDeployment(first!, {
      id: cancelledId,
      targetEnvironment: 'uat',
      buildReleaseId: SHA_A,
      binderTaskArn: TASK_B,
      controller: GITHUB_CONTROLLER,
      intentId: cancelledIntentId,
      evidence,
    }), /expired into UNKNOWN/);
    assert.equal((await first.query('SELECT "status" FROM "RemoteReleaseOperation" WHERE "id" = $1', [cancelledId])).rows[0].status, 'UNKNOWN');
    await first.query(`
      UPDATE "RemoteReleaseMutationIntent"
         SET "status" = 'CONFIRMED_NO_MUTATION', "closedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1
    `, [cancelledIntentId]);
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: cancelledId,
      targetEnvironment: 'uat',
      recovererTaskArn: TASK_B,
      controller: GITHUB_CONTROLLER,
    }), false, 'missing all-target intents cannot terminalize before every existing intent has exact recovery proof');
    await first.query(`
      UPDATE "RemoteReleaseOperation"
         SET "status" = 'RECONCILED_FAILED_CONFIRMED', "completedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "status" = 'UNKNOWN'
    `, [cancelledId]);
    await releaseRemoteWriterFence(first);
  });

  // This is the hosted PostgreSQL proof required before recovering a partially-started UAT wave.
  it('terminalizes partial all-target coverage only after exact revalidation of every existing intent', async (t) => {
    if (!reachable || !first) return t.skip('no local PostgreSQL database is reachable');
    const releaseId = randomUUID();
    const intentId = randomUUID();
    const incoming = activeConfiguration(REVISION, SHA_A);
    const evidence = {
      service: 'api-web', serviceArn: SERVICE, deploymentArn: DEPLOYMENT,
      targetRevisionArn: REVISION, sourceSha: SHA_A, noOp: false,
    } as const;
    await beginRemoteReleaseOperation(first, {
      ...operation(releaseId, TASK_A), mode: 'release', releaseDeployTarget: 'all',
    });
    await holdRemoteReleaseOperation(first, releaseId, TASK_A);
    await prepareRemoteReleaseMutationIntent(first, {
      operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
      intent: { ...intent(intentId, 'api-web', SERVICE), desiredConfigHash: configurationHash(incoming) },
    });
    await bindRemoteReleaseDeployment(first, {
      id: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      binderTaskArn: TASK_B, controller: GITHUB_CONTROLLER, intentId, evidence,
    });
    await first.query(`
      UPDATE "RemoteReleaseOperation"
         SET "status" = 'UNKNOWN', "unknownAt" = CURRENT_TIMESTAMP,
             "leaseExpiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second'
       WHERE "id" = $1
    `, [releaseId]);
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER,
    }), false, 'a binder-BOUND row alone is not exact recovery evidence');

    const requestStartedAt = (await first.query<{ requestStartedAt: Date }>(`
      SELECT "requestStartedAt" FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0]!.requestStartedAt;
    const deployments = { serviceDeployments: [{
      ...recoveryDeployment(SERVICE, REVISION),
      createdAt: new Date(requestStartedAt.getTime() + 1_000).toISOString(),
    }] };
    const recovered = await recoverRemoteReleaseMutationIntent(first, {
      operationId: releaseId, intentId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      recoveryExecutorBuildReleaseId: SHA_B,
      recoveryExecutorImage: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:${'f'.repeat(64)}`,
      recoveryValidatedCiRunId: '987654', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER, region: 'ap-southeast-1', networkEvidence: null,
      observedSsmServiceArn: SERVICE, expectedServiceArn: SERVICE,
      ssmParameterName: '/watchdog-bms/uat/ecs-express-api-web-service-arn',
      readPlatform: async () => ({
        deployments,
        service: recoveryService(SERVICE, incoming, DEPLOYMENT),
      }),
      readSsmServiceArn: async () => SERVICE,
      ensureSsmIdentity: async () => undefined,
    });
    assert.equal(recovered.replay, true);
    assert.deepEqual((await first.query(`
      SELECT "recovererControllerJson" FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0].recovererControllerJson, GITHUB_CONTROLLER);
    assert.equal((await first.query(`
      SELECT count(*)::int AS count FROM "AuditLog"
       WHERE "action" = 'system.release_operation.revalidate_remote_mutation' AND "targetId" = $1
    `, [intentId])).rows[0].count, 1);
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER,
    }), true);
    const parent = (await first.query(`
      SELECT "status", "reconciliationEvidenceRef", "outcomeReason"
        FROM "RemoteReleaseOperation" WHERE "id" = $1
    `, [releaseId])).rows[0];
    assert.equal(parent.status, 'RECONCILED_FAILED_CONFIRMED');
    assert.equal(parent.reconciliationEvidenceRef, `RemoteReleasePartialIntentRecovery:${releaseId}`);
    assert.match(parent.outcomeReason, /partial all-target exact-intent recovery/);
  });

  it('reclaims an unexpired rollout hold only for its exact stopped parent task', async (t) => {
    if (!reachable || !first) return t.skip('no local PostgreSQL database is reachable');
    const releaseId = randomUUID();
    const intentId = randomUUID();
    const incoming = activeConfiguration(REVISION, SHA_A);
    await beginRemoteReleaseOperation(first, {
      ...operation(releaseId, TASK_A), mode: 'release', releaseDeployTarget: 'api-web',
    });
    await holdRemoteReleaseOperation(first, releaseId, TASK_A);
    await prepareRemoteReleaseMutationIntent(first, {
      operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
      intent: {
        ...intent(intentId, 'api-web', SERVICE),
        desiredConfigHash: configurationHash(incoming),
      },
    });
    const requestStartedAt = (await first.query<{ requestStartedAt: Date }>(`
      SELECT "requestStartedAt" FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0]!.requestStartedAt;
    const deployments = { serviceDeployments: [{
      ...recoveryDeployment(SERVICE, REVISION),
      createdAt: new Date(requestStartedAt.getTime() + 1_000).toISOString(),
    }] };
    let platformReads = 0;
    const recoveryInput: Parameters<typeof recoverRemoteReleaseMutationIntent>[1] = {
      operationId: releaseId, intentId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      recoveryExecutorBuildReleaseId: SHA_B,
      recoveryExecutorImage: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:${'f'.repeat(64)}`,
      recoveryValidatedCiRunId: '987654', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER, region: 'ap-southeast-1',
      networkEvidence: {
        serviceArn: SERVICE,
        activeSecurityGroups: ['sg-0123456789abcdef0'],
        requestedSecurityGroup: 'sg-0123456789abcdef0',
        managedSecurityGroup: null,
        managedDescription: null,
      },
      observedSsmServiceArn: SERVICE, expectedServiceArn: SERVICE,
      ssmParameterName: '/watchdog-bms/uat/ecs-express-api-web-service-arn',
      readPlatform: async () => {
        platformReads += 1;
        return { deployments, service: recoveryService(SERVICE, incoming, DEPLOYMENT) };
      },
      readSsmServiceArn: async () => SERVICE,
      ensureSsmIdentity: async () => undefined,
    };

    await assert.rejects(
      () => recoverRemoteReleaseMutationIntent(first!, recoveryInput),
      /still has a live heartbeat lease/,
    );
    assert.equal(platformReads, 0, 'live-hold refusal precedes platform/SSM reads');
    await assert.rejects(
      () => recoverRemoteReleaseMutationIntent(first!, {
        ...recoveryInput, stoppedParentTaskEvidence: stoppedParentTaskEvidence(TASK_B),
      }),
      /does not belong to the exact held release/,
    );
    assert.equal((await first.query(
      `SELECT "status" FROM "RemoteReleaseOperation" WHERE "id" = $1`, [releaseId],
    )).rows[0].status, 'RUNNING');

    await first.query(`
      UPDATE "RemoteReleaseOperation" SET "leaseOwner" = $2 WHERE "id" = $1
    `, [releaseId, TASK_B]);
    await assert.rejects(
      () => recoverRemoteReleaseMutationIntent(first!, {
        ...recoveryInput, stoppedParentTaskEvidence: stoppedParentTaskEvidence(),
      }),
      /cannot replace a finalizer-owned live lease/,
    );
    await first.query(`
      UPDATE "RemoteReleaseOperation" SET "leaseOwner" = "ecsTaskArn" WHERE "id" = $1
    `, [releaseId]);

    const recovered = await recoverRemoteReleaseMutationIntent(first, {
      ...recoveryInput, stoppedParentTaskEvidence: stoppedParentTaskEvidence(),
    });
    assert.equal(recovered.status, 'BOUND');
    assert.equal(platformReads, 2);
    const parent = (await first.query(`
      SELECT "status", "outcomeReason" FROM "RemoteReleaseOperation" WHERE "id" = $1
    `, [releaseId])).rows[0];
    assert.equal(parent.status, 'UNKNOWN');
    assert.match(parent.outcomeReason, /proved held parent task STOPPED/);
    const audit = await first.query(`
      SELECT "riskLevel", "metadataJson" FROM "AuditLog"
       WHERE "action" = 'system.release_operation.reclaim_stopped_hold' AND "targetId" = $1
    `, [releaseId]);
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].riskLevel, 'CRITICAL');
    assert.equal(audit.rows[0].metadataJson.stoppedParentTaskEvidence.taskArn, TASK_A);
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER,
    }), true);
    const replay = await recoverRemoteReleaseMutationIntent(first, {
      ...recoveryInput, stoppedParentTaskEvidence: stoppedParentTaskEvidence(),
    });
    assert.equal(replay.terminalReplay, true);
    assert.equal((await first.query(`
      SELECT count(*)::int AS count FROM "AuditLog"
       WHERE "action" = 'system.release_operation.reclaim_stopped_hold' AND "targetId" = $1
    `, [releaseId])).rows[0].count, 1, 'terminal replay does not duplicate hold-reclaim audit');
  });

  it('persists cleanup before terminalizing a binder-BOUND api-web rollback', async (t) => {
    if (!reachable || !first) return t.skip('no local PostgreSQL database is reachable');
    const releaseId = randomUUID();
    const intentId = randomUUID();
    const before = activeConfiguration(REVISION.replace('rev-1', 'rev-before'), SHA_B);
    const incoming = activeConfiguration(REVISION, SHA_A);
    const evidence = {
      service: 'api-web', serviceArn: SERVICE, deploymentArn: DEPLOYMENT,
      targetRevisionArn: REVISION, sourceSha: SHA_A, noOp: false,
    };
    await beginRemoteReleaseOperation(first, {
      ...operation(releaseId, TASK_A), mode: 'release', releaseDeployTarget: 'api-web',
    });
    await holdRemoteReleaseOperation(first, releaseId, TASK_A);
    await prepareRemoteReleaseMutationIntent(first, {
      operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
      intent: {
        ...intent(intentId, 'api-web', SERVICE),
        desiredConfigHash: configurationHash(incoming),
        beforeCurrentDeploymentArn: `${DEPLOYMENT}-before`,
        beforeActiveConfigurations: [descriptor(before)],
      },
    });
    await bindRemoteReleaseDeployment(first, {
      id: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      binderTaskArn: TASK_B, controller: GITHUB_CONTROLLER, intentId, evidence,
    });
    await first.query(`
      UPDATE "RemoteReleaseOperation"
         SET "leaseExpiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second'
       WHERE "id" = $1
    `, [releaseId]);

    const requestStartedAt = (await first.query<{ requestStartedAt: Date }>(`
      SELECT "requestStartedAt" FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0]!.requestStartedAt;
    const deployments = { serviceDeployments: [{
      ...recoveryDeployment(SERVICE, REVISION, 'ROLLBACK_SUCCESSFUL'),
      createdAt: new Date(requestStartedAt.getTime() + 1_000).toISOString(),
    }] };
    const rolledBack = recoveryService(SERVICE, before, DEPLOYMENT);
    let platformReads = 0;
    let ssmReads = 0;
    let ssmCompletions = 0;
    const recoveryInput = {
      operationId: releaseId, intentId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      recoveryExecutorBuildReleaseId: SHA_B,
      recoveryExecutorImage: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:${'f'.repeat(64)}`,
      recoveryValidatedCiRunId: '987654', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER, region: 'ap-southeast-1', networkEvidence: null,
      observedSsmServiceArn: SERVICE, expectedServiceArn: SERVICE,
      ssmParameterName: '/watchdog-bms/uat/ecs-express-api-web-service-arn',
      readPlatform: async () => {
        platformReads += 1;
        return { deployments, service: rolledBack };
      },
      readSsmServiceArn: async () => {
        ssmReads += 1;
        return SERVICE;
      },
      ensureSsmIdentity: async (_region: string, _parameterName: string, expectedServiceArn: string, repair: boolean) => {
        ssmCompletions += 1;
        assert.equal(expectedServiceArn, SERVICE);
        assert.equal(repair, false);
        const beforeCompletion = (await first!.query(`
          SELECT "failedBuildCleanupRequiredAt" FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
        `, [intentId])).rows[0];
        assert.equal(beforeCompletion.failedBuildCleanupRequiredAt, null,
          'cleanup marker must not precede exact SSM completion');
      },
    } as const;
    const recovered = await recoverRemoteReleaseMutationIntent(first, recoveryInput);
    assert.equal(platformReads, 2);
    assert.equal(recovered.replay, true);
    assert.equal(recovered.rollback, true, 'fresh rollback evidence must not be replaced by empty binder markers');
    assert.equal(recovered.failedBuildCleanupRequired, true);
    assert.equal(recovered.failedBuildCleanupCompleted, false);
    assert.equal(ssmReads, 2, 'normal UPDATE recovery uses fresh SSM reads rather than the controller snapshot');
    assert.equal(ssmCompletions, 1, 'SSM completion runs before durable cleanup markers');
    const mismatchedDeploymentArn = DEPLOYMENT.replace('deploy-1', 'deploy-mismatch');
    let mismatchedCompletion = 0;
    await assert.rejects(
      () => recoverRemoteReleaseMutationIntent(first!, {
        ...recoveryInput,
        readPlatform: async () => ({
          deployments: { serviceDeployments: [{
            ...recoveryDeployment(SERVICE, REVISION),
            serviceDeploymentArn: mismatchedDeploymentArn,
            createdAt: new Date(requestStartedAt.getTime() + 1_000).toISOString(),
          }] },
          service: recoveryService(SERVICE, incoming, mismatchedDeploymentArn),
        }),
        readSsmServiceArn: async () => SERVICE,
        ensureSsmIdentity: async () => { mismatchedCompletion += 1; },
      }),
      /closed mutation intent no longer matches fresh remote recovery evidence/,
    );
    assert.equal(mismatchedCompletion, 0,
      'stored-evidence mismatch must block before any SSM completion or CREATE repair');
    const persisted = (await first.query(`
      SELECT "status", "failedBuildCleanupRequiredAt", "failedBuildCleanupCompletedAt",
             "recovererControllerJson"
        FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0];
    assert.equal(persisted.status, 'BOUND');
    assert.ok(persisted.failedBuildCleanupRequiredAt instanceof Date);
    assert.equal(persisted.failedBuildCleanupCompletedAt, null);
    assert.deepEqual(persisted.recovererControllerJson, GITHUB_CONTROLLER);
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER,
    }), false, 'durable cleanup requirement keeps the UNKNOWN parent blocked');

    await first.query(`
      UPDATE "RemoteReleaseMutationIntent"
         SET "failedBuildCleanupCompletedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1
    `, [intentId]);
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER,
    }), true);
    const beforeTerminalReplay = (await first.query(`
      SELECT "updatedAt", "failedBuildCleanupRequiredAt", "failedBuildCleanupCompletedAt",
             "recovererControllerJson"
        FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0];
    const auditCount = (await first.query(`
      SELECT count(*)::int AS count FROM "AuditLog"
       WHERE "action" = 'system.release_operation.recover_remote_mutation' AND "targetId" = $1
    `, [intentId])).rows[0].count;
    const terminalReplay = await recoverRemoteReleaseMutationIntent(first, recoveryInput);
    assert.equal(terminalReplay.terminalReplay, true);
    assert.equal(terminalReplay.replay, true);
    assert.equal(platformReads, 4, 'terminal replay still requires two fresh platform reads');
    assert.equal(ssmReads, 4, 'terminal replay revalidates the controller-observed SSM identity twice');
    assert.equal(ssmCompletions, 1, 'terminal replay remains read-only and does not repeat SSM completion');
    assert.deepEqual((await first.query(`
      SELECT "updatedAt", "failedBuildCleanupRequiredAt", "failedBuildCleanupCompletedAt",
             "recovererControllerJson"
        FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0], beforeTerminalReplay, 'terminal replay must not mutate its durable intent');
    assert.equal((await first.query(`
      SELECT count(*)::int AS count FROM "AuditLog"
       WHERE "action" = 'system.release_operation.recover_remote_mutation' AND "targetId" = $1
    `, [intentId])).rows[0].count, auditCount, 'terminal replay must not append another audit mutation');

    await first.query(`
      UPDATE "RemoteReleaseMutationIntent"
         SET "failedBuildCleanupRequiredAt" = NULL, "failedBuildCleanupCompletedAt" = NULL
       WHERE "id" = $1
    `, [intentId]);
    await assert.rejects(
      () => recoverRemoteReleaseMutationIntent(first!, recoveryInput),
      /conflicting or incomplete cleanup\/SSM state/,
      'a terminal parent cannot acquire a newly discovered cleanup requirement',
    );
  });

  it('keeps an OPEN CREATE intent uncommitted until SSM repair is proven', async (t) => {
    if (!reachable || !first) return t.skip('no local PostgreSQL database is reachable');
    const releaseId = randomUUID();
    const intentId = randomUUID();
    const incoming = activeConfiguration(REVISION, SHA_A);
    await beginRemoteReleaseOperation(first, {
      ...operation(releaseId, TASK_A), mode: 'release', releaseDeployTarget: 'api-web',
    });
    await holdRemoteReleaseOperation(first, releaseId, TASK_A);
    await prepareRemoteReleaseMutationIntent(first, {
      operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
      intent: {
        ...intent(intentId, 'api-web', SERVICE),
        mutationKind: 'CREATE' as const,
        desiredConfigHash: configurationHash(incoming),
      },
    });
    await first.query(`
      UPDATE "RemoteReleaseOperation"
         SET "leaseExpiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second'
       WHERE "id" = $1
    `, [releaseId]);
    const requestStartedAt = (await first.query<{ requestStartedAt: Date }>(`
      SELECT "requestStartedAt" FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0]!.requestStartedAt;
    const deployments = { serviceDeployments: [{
      ...recoveryDeployment(SERVICE, REVISION),
      createdAt: new Date(requestStartedAt.getTime() + 1_000).toISOString(),
    }] };
    let ssmReads = 0;
    const recoveryInput = {
      operationId: releaseId, intentId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      recoveryExecutorBuildReleaseId: SHA_B,
      recoveryExecutorImage: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:${'f'.repeat(64)}`,
      recoveryValidatedCiRunId: '987654', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER, region: 'ap-southeast-1', networkEvidence: null,
      observedSsmServiceArn: null, expectedServiceArn: SERVICE,
      ssmParameterName: '/watchdog-bms/uat/ecs-express-api-web-service-arn',
      readPlatform: async () => ({
        deployments,
        service: recoveryService(SERVICE, incoming, DEPLOYMENT),
      }),
      readSsmServiceArn: async () => {
        ssmReads += 1;
        return null;
      },
    } as const;

    await assert.rejects(
      () => recoverRemoteReleaseMutationIntent(first!, {
        ...recoveryInput,
        ensureSsmIdentity: async (_region, _parameterName, expectedServiceArn, repair) => {
          assert.equal(expectedServiceArn, SERVICE);
          assert.equal(repair, true, 'CREATE recovery must request create-only SSM repair');
          assert.equal((await first!.query(`
            SELECT "status" FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
          `, [intentId])).rows[0].status, 'OPEN', 'SSM completion must run before the close transaction');
          throw new RemoteReleaseOperationBlocked('injected SSM completion failure');
        },
      }),
      /injected SSM completion failure/,
    );
    assert.equal(ssmReads, 2, 'CREATE recovery checks the controller-observed absence twice');
    assert.deepEqual((await first.query(`
      SELECT "status", "evidenceJson", "closedAt", "failedBuildCleanupRequiredAt"
        FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0], {
      status: 'OPEN', evidenceJson: null, closedAt: null, failedBuildCleanupRequiredAt: null,
    }, 'SSM failure must leave every durable close/cleanup field untouched');
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER,
    }), false, 'an SSM-unverified OPEN intent cannot terminalize its parent');

    let successfulCompletion = 0;
    const recovered = await recoverRemoteReleaseMutationIntent(first, {
      ...recoveryInput,
      ensureSsmIdentity: async (_region, _parameterName, expectedServiceArn, repair) => {
        successfulCompletion += 1;
        assert.equal(expectedServiceArn, SERVICE);
        assert.equal(repair, true);
        assert.equal((await first!.query(`
          SELECT "status" FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
        `, [intentId])).rows[0].status, 'OPEN');
      },
    });
    assert.equal(recovered.status, 'BOUND');
    assert.equal(recovered.repairSsm, true);
    assert.equal(successfulCompletion, 1);
    assert.equal(ssmReads, 4);
    assert.equal((await first.query(`
      SELECT "status" FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0].status, 'BOUND', 'intent closes only after successful SSM completion');
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER,
    }), true);
  });

  it('requires two in-task missing-SSM reads for CONFIRMED_NO_MUTATION and blocks a late parameter', async (t) => {
    if (!reachable || !first) return t.skip('no local PostgreSQL database is reachable');
    const releaseId = randomUUID();
    const intentId = randomUUID();
    await beginRemoteReleaseOperation(first, {
      ...operation(releaseId, TASK_A), mode: 'release', releaseDeployTarget: 'api-web',
    });
    await holdRemoteReleaseOperation(first, releaseId, TASK_A);
    await prepareRemoteReleaseMutationIntent(first, {
      operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
      intent: { ...intent(intentId, 'api-web', SERVICE), mutationKind: 'CREATE' as const },
    });
    await first.query(`
      UPDATE "RemoteReleaseOperation"
         SET "leaseExpiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second'
       WHERE "id" = $1
    `, [releaseId]);

    const baseInput = {
      operationId: releaseId, intentId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      recoveryExecutorBuildReleaseId: SHA_B,
      recoveryExecutorImage: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:${'f'.repeat(64)}`,
      recoveryValidatedCiRunId: '987654', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER, region: 'ap-southeast-1', networkEvidence: null,
      observedSsmServiceArn: null, expectedServiceArn: SERVICE,
      ssmParameterName: '/watchdog-bms/uat/ecs-express-api-web-service-arn',
      readPlatform: async () => ({ deployments: { serviceDeployments: [] }, service: null }),
    } as const;
    let lateReads = 0;
    await assert.rejects(
      () => recoverRemoteReleaseMutationIntent(first!, {
        ...baseInput,
        readSsmServiceArn: async () => {
          lateReads += 1;
          return lateReads === 1 ? null : SERVICE;
        },
      }),
      /missing SSM identity appeared/,
    );
    assert.equal(lateReads, 2, 'a parameter appearing on the second in-task read must be observed');
    assert.equal((await first.query(`
      SELECT "status" FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0].status, 'OPEN', 'late SSM appearance must block before intent mutation');

    let missingReads = 0;
    const stableMissingInput = {
      ...baseInput,
      readSsmServiceArn: async () => {
        missingReads += 1;
        return null;
      },
    };
    const recovered = await recoverRemoteReleaseMutationIntent(first, stableMissingInput);
    assert.equal(missingReads, 2);
    assert.equal(recovered.status, 'CONFIRMED_NO_MUTATION');
    assert.equal(recovered.failedBuildCleanupRequired, true);
    const persisted = (await first.query(`
      SELECT "status", "failedBuildCleanupRequiredAt", "failedBuildCleanupCompletedAt"
        FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0];
    assert.equal(persisted.status, 'CONFIRMED_NO_MUTATION');
    assert.ok(persisted.failedBuildCleanupRequiredAt instanceof Date);
    assert.equal(persisted.failedBuildCleanupCompletedAt, null);
    await first.query(`
      UPDATE "RemoteReleaseMutationIntent"
         SET "failedBuildCleanupCompletedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1
    `, [intentId]);
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER,
    }), true);

    const terminalReplay = await recoverRemoteReleaseMutationIntent(first, stableMissingInput);
    assert.equal(terminalReplay.terminalReplay, true);
    assert.equal(missingReads, 4, 'terminal no-mutation replay repeats both missing-SSM reads');
    let terminalLateReads = 0;
    await assert.rejects(
      () => recoverRemoteReleaseMutationIntent(first!, {
        ...baseInput,
        readSsmServiceArn: async () => {
          terminalLateReads += 1;
          return terminalLateReads === 1 ? null : SERVICE;
        },
      }),
      /missing SSM identity appeared/,
    );
    assert.equal(terminalLateReads, 2);
  });

  it('blocks a terminal BOUND replay that would need a new SSM repair', async (t) => {
    if (!reachable || !first) return t.skip('no local PostgreSQL database is reachable');
    const releaseId = randomUUID();
    const intentId = randomUUID();
    const incoming = activeConfiguration(REVISION, SHA_A);
    const evidence = {
      service: 'api-web', serviceArn: SERVICE, deploymentArn: DEPLOYMENT,
      targetRevisionArn: REVISION, sourceSha: SHA_A, noOp: false,
    };
    await beginRemoteReleaseOperation(first, {
      ...operation(releaseId, TASK_A), mode: 'release', releaseDeployTarget: 'api-web',
    });
    await holdRemoteReleaseOperation(first, releaseId, TASK_A);
    await prepareRemoteReleaseMutationIntent(first, {
      operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
      intent: {
        ...intent(intentId, 'api-web', SERVICE),
        mutationKind: 'CREATE' as const,
        desiredConfigHash: configurationHash(incoming),
      },
    });
    await bindRemoteReleaseDeployment(first, {
      id: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      binderTaskArn: TASK_B, controller: GITHUB_CONTROLLER, intentId, evidence,
    });
    await first.query(`
      UPDATE "RemoteReleaseOperation"
         SET "status" = 'UNKNOWN', "unknownAt" = CURRENT_TIMESTAMP,
             "leaseExpiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second'
       WHERE "id" = $1
    `, [releaseId]);
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER,
    }), true);
    const requestStartedAt = (await first.query<{ requestStartedAt: Date }>(`
      SELECT "requestStartedAt" FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0]!.requestStartedAt;
    const deployments = { serviceDeployments: [{
      ...recoveryDeployment(SERVICE, REVISION),
      createdAt: new Date(requestStartedAt.getTime() + 1_000).toISOString(),
    }] };
    const beforeReplay = (await first.query(`
      SELECT "updatedAt", "recovererControllerJson"
        FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0];
    await assert.rejects(
      () => recoverRemoteReleaseMutationIntent(first!, {
        operationId: releaseId, intentId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
        recoveryExecutorBuildReleaseId: SHA_B,
        recoveryExecutorImage: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:${'f'.repeat(64)}`,
        recoveryValidatedCiRunId: '987654', recovererTaskArn: TASK_C,
        controller: GITHUB_CONTROLLER, region: 'ap-southeast-1', networkEvidence: null,
        observedSsmServiceArn: null, expectedServiceArn: SERVICE,
        ssmParameterName: '/watchdog-bms/uat/ecs-express-api-web-service-arn',
        readPlatform: async () => ({
          deployments,
          service: recoveryService(SERVICE, incoming, DEPLOYMENT),
        }),
        readSsmServiceArn: async () => null,
      }),
      /conflicting or incomplete cleanup\/SSM state/,
    );
    assert.deepEqual((await first.query(`
      SELECT "updatedAt", "recovererControllerJson"
        FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [intentId])).rows[0], beforeReplay, 'blocked terminal repair must not mutate the intent');
  });

  it('blocks legacy first-cutover terminalization/reconcile and marks the earlier multi-api intent', async (t) => {
    if (!reachable || !first) return t.skip('no local PostgreSQL database is reachable');
    const legacyConfiguration = activeConfiguration(REVISION.replace('rev-1', 'rev-legacy'), 'd'.repeat(12));
    const legacyDescriptor = descriptor(legacyConfiguration);
    const apiEvidence = {
      service: 'api-web', serviceArn: SERVICE, deploymentArn: DEPLOYMENT,
      targetRevisionArn: REVISION, sourceSha: SHA_A, noOp: false,
    };
    const createLegacyAllTargetRelease = async (withMultipleApiIntents = false) => {
      const releaseId = randomUUID();
      const apiIntentId = randomUUID();
      await beginRemoteReleaseOperation(first!, {
        ...operation(releaseId, TASK_A), mode: 'release', releaseDeployTarget: 'all',
      });
      await holdRemoteReleaseOperation(first!, releaseId, TASK_A);
      await prepareRemoteReleaseMutationIntent(first!, {
        operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
        preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
        intent: {
          ...intent(apiIntentId, 'api-web', SERVICE),
          desiredConfigHash: configurationHash(activeConfiguration(REVISION, SHA_A)),
          beforeActiveConfigurations: [legacyDescriptor],
          legacyBootstrapDescriptor: legacyDescriptor,
        },
      });
      await bindRemoteReleaseDeployment(first!, {
        id: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
        binderTaskArn: TASK_B, controller: GITHUB_CONTROLLER, intentId: apiIntentId,
        evidence: apiEvidence,
      });
      let rollbackApiIntentId: string | null = null;
      let latestApiIntentId: string | null = null;
      if (withMultipleApiIntents) {
        rollbackApiIntentId = randomUUID();
        await prepareRemoteReleaseMutationIntent(first!, {
          operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
          preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
          intent: {
            ...intent(rollbackApiIntentId, 'api-web', SERVICE),
            desiredConfigHash: configurationHash(activeConfiguration(REVISION, SHA_A)),
            beforeActiveConfigurations: [legacyDescriptor],
            legacyBootstrapDescriptor: legacyDescriptor,
          },
        });
        await bindRemoteReleaseDeployment(first!, {
          id: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
          binderTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
          intentId: rollbackApiIntentId,
          evidence: {
            ...apiEvidence,
            deploymentArn: DEPLOYMENT.replace('deploy-1', 'deploy-rollback'),
            targetRevisionArn: REVISION.replace('rev-1', 'rev-rollback'),
          },
        });
        await first!.query(`
          UPDATE "RemoteReleaseMutationIntent"
             SET "legacyRollbackObservedAt" = CURRENT_TIMESTAMP,
                 "legacyRollbackCleanedAt" = CURRENT_TIMESTAMP,
                 "failedBuildCleanupRequiredAt" = CURRENT_TIMESTAMP,
                 "failedBuildCleanupCompletedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $1
        `, [rollbackApiIntentId]);
        latestApiIntentId = randomUUID();
        await prepareRemoteReleaseMutationIntent(first!, {
          operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
          preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
          intent: intent(latestApiIntentId, 'api-web', SERVICE),
        });
        await bindRemoteReleaseDeployment(first!, {
          id: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
          binderTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
          intentId: latestApiIntentId,
          evidence: {
            ...apiEvidence,
            deploymentArn: DEPLOYMENT.replace('deploy-1', 'deploy-latest'),
            targetRevisionArn: REVISION.replace('rev-1', 'rev-latest'),
          },
        });
      }
      for (const [serviceKey, serviceArn] of [
        ['ai-gateway', SERVICE.replace('/api-web', '/ai-gateway')],
        ['workers', SERVICE.replace('/api-web', '/workers')],
      ] as const) {
        const childIntentId = randomUUID();
        await prepareRemoteReleaseMutationIntent(first!, {
          operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
          preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
          intent: intent(childIntentId, serviceKey, serviceArn),
        });
        await first!.query(`
          UPDATE "RemoteReleaseMutationIntent"
             SET "status" = 'CONFIRMED_NO_MUTATION', "closedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $1
        `, [childIntentId]);
      }
      await first!.query(`
        UPDATE "RemoteReleaseOperation"
           SET "status" = 'UNKNOWN', "unknownAt" = CURRENT_TIMESTAMP,
               "leaseExpiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second'
         WHERE "id" = $1
      `, [releaseId]);
      return { releaseId, apiIntentId, rollbackApiIntentId, latestApiIntentId };
    };

    const rolledBack = await createLegacyAllTargetRelease();
    await first.query(`
      UPDATE "RemoteReleaseMutationIntent"
         SET "legacyRollbackObservedAt" = CURRENT_TIMESTAMP,
             "legacyRollbackCleanedAt" = CURRENT_TIMESTAMP,
             "failedBuildCleanupRequiredAt" = CURRENT_TIMESTAMP,
             "failedBuildCleanupCompletedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1
    `, [rolledBack.apiIntentId]);
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: rolledBack.releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER,
    }), true, 'completed rollback cleanup remains terminalizable without a cutover marker');

    const successful = await createLegacyAllTargetRelease(true);
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: successful.releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER,
    }), false, 'legacy BOUND success stays unresolved until first-cutover cleanup is durable');
    const reconcileInput = {
      id: successful.releaseId,
      targetEnvironment: 'uat' as const,
      originalTaskArn: TASK_A,
      reconcilerTaskArn: TASK_C,
      actorRef: 'arn:aws:sts::311414082667:assumed-role/watchdog-bms-deploy-uat/operator',
      evidenceRef: 'cloudwatch://legacy-first-cutover/reviewed',
      reason: 'reviewed legacy first-cutover recovery',
      outcome: 'FAILED_CONFIRMED' as const,
      controller: GITHUB_CONTROLLER,
    };
    await assert.rejects(
      () => reconcileRemoteReleaseOperation(first!, reconcileInput),
      /bootstrap cutover\/rollback attestation cleanup/,
      'audited reconciliation cannot bypass pending legacy first-cutover cleanup',
    );
    assert.equal(await markRecoveredLegacyCutoverCompleted(first, {
      operationId: successful.releaseId,
      targetEnvironment: 'uat',
      buildReleaseId: SHA_A,
    }), 1, 'one successful retirement marks every eligible legacy row in the exact release scope');
    const cutovers = await first.query(`
      SELECT "id", "legacyCutoverCompletedAt"
        FROM "RemoteReleaseMutationIntent"
       WHERE "id" = ANY($1::text[])
    `, [[successful.apiIntentId, successful.rollbackApiIntentId, successful.latestApiIntentId]]);
    const cutoverById = new Map(cutovers.rows.map((row) => [row.id, row.legacyCutoverCompletedAt]));
    assert.ok(cutoverById.get(successful.apiIntentId) instanceof Date,
      'the earlier legacy BOUND row receives the cutover marker');
    assert.equal(cutoverById.get(successful.rollbackApiIntentId), null,
      'a rollback-observed legacy row is never marked as successful cutover');
    assert.equal(cutoverById.get(successful.latestApiIntentId), null,
      'the later non-legacy BOUND row needs no legacy marker');
    assert.deepEqual(await reconcileRemoteReleaseOperation(first, reconcileInput), {
      status: 'RECONCILED_FAILED_CONFIRMED', replay: false,
    });
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: successful.releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER,
    }), true, 'durable first-cutover marker unlocks terminalization');
  });

  it('keeps a zero-api-intent release blocked until durable cleanup and only exact recovery terminalizes it', async (t) => {
    if (!reachable || !first) return t.skip('no local PostgreSQL database is reachable');
    const releaseId = randomUUID();
    await beginRemoteReleaseOperation(first, {
      ...operation(releaseId, TASK_A), mode: 'release', releaseDeployTarget: 'all',
    });
    await holdRemoteReleaseOperation(first, releaseId, TASK_A);
    await first.query(`
      UPDATE "RemoteReleaseOperation"
         SET "leaseExpiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second'
       WHERE "id" = $1
    `, [releaseId]);
    await assert.rejects(() => reconcileRemoteReleaseOperation(first!, {
      id: releaseId, targetEnvironment: 'uat', originalTaskArn: TASK_A, reconcilerTaskArn: TASK_B,
      actorRef: 'arn:aws:sts::311414082667:assumed-role/watchdog-bms-deploy-uat/operator',
      evidenceRef: 'manual://unsafe-bypass', reason: 'generic evidence cannot replace exact cleanup',
      outcome: 'FAILED_CONFIRMED', controller: GITHUB_CONTROLLER,
    }), /exact pre-intent recovery is required/);
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_B,
      controller: GITHUB_CONTROLLER,
    }), false, 'a pre-attested API build cannot terminalize without exact cleanup evidence');

    const aiIntentId = randomUUID();
    const workerIntentId = randomUUID();
    await first.query(`
      INSERT INTO "RemoteReleaseMutationIntent" (
        "id", "operationId", "targetEnvironment", "buildReleaseId", "serviceKey", "mutationKind",
        "expectedServiceArn", "clusterName", "serviceName", "ssmParameterName", "requestHash",
        "desiredConfigHash", "beforeDeploymentArnsJson", "beforeActiveConfigurationsJson",
        "preparedByTaskArn", "status", "requestDeadlineAt", "createdAt", "updatedAt"
      ) VALUES ($1,$2,'uat',$3,'ai-gateway','UPDATE',$4,'watchdog-bms-uat','ai-gateway',
                '/watchdog-bms/uat/ecs-express-ai-gateway-service-arn',$5,$6,'[]'::jsonb,'[]'::jsonb,
                $7,'OPEN',CURRENT_TIMESTAMP + INTERVAL '10 minutes',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `, [aiIntentId, releaseId, SHA_A, SERVICE.replace('/api-web', '/ai-gateway'),
      '1'.repeat(64), '2'.repeat(64), TASK_B]);
    await first.query(`
      INSERT INTO "RemoteReleaseMutationIntent" (
        "id", "operationId", "targetEnvironment", "buildReleaseId", "serviceKey", "mutationKind",
        "expectedServiceArn", "clusterName", "serviceName", "ssmParameterName", "requestHash",
        "desiredConfigHash", "beforeDeploymentArnsJson", "beforeActiveConfigurationsJson",
        "preparedByTaskArn", "status", "requestDeadlineAt", "createdAt", "updatedAt"
      ) VALUES ($1,$2,'uat',$3,'workers','UPDATE',$4,'watchdog-bms-uat','workers',
                '/watchdog-bms/uat/ecs-express-workers-service-arn',$5,$6,'[]'::jsonb,'[]'::jsonb,
                $7,'OPEN',CURRENT_TIMESTAMP + INTERVAL '10 minutes',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `, [workerIntentId, releaseId, SHA_A, SERVICE.replace('/api-web', '/workers'),
      '1'.repeat(64), '2'.repeat(64), TASK_B]);
    const preIntentServiceArn = SERVICE.replace('/api-web', '/watchdog-bms-uat-api-web');
    const preIntentRevisionArn = REVISION.replace('/api-web/', '/watchdog-bms-uat-api-web/');
    const legacyConfiguration = activeConfiguration(preIntentRevisionArn, SHA_A.slice(0, 12));
    const preIntentState = {
      serviceArn: preIntentServiceArn,
      currentDeployment: null,
      targetRevisionArn: preIntentRevisionArn,
      sourceSha: SHA_A.slice(0, 12),
    };
    await first.query(`
      UPDATE "RemoteReleaseOperation"
         SET "preIntentApiCleanupCompletedAt" = CURRENT_TIMESTAMP,
             "preIntentApiCleanupEvidenceJson" = $2::jsonb
       WHERE "id" = $1
    `, [releaseId, JSON.stringify(preIntentState)]);
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_B,
      controller: GITHUB_CONTROLLER,
    }), false, 'another OPEN intent still blocks terminalization');
    await first.query(`
      UPDATE "RemoteReleaseMutationIntent"
         SET "status" = 'CONFIRMED_NO_MUTATION', "closedAt" = CURRENT_TIMESTAMP
       WHERE "id" = ANY($1::text[])
    `, [[aiIntentId, workerIntentId]]);
    await assert.rejects(() => reconcileRemoteReleaseOperation(first!, {
      id: releaseId, targetEnvironment: 'uat', originalTaskArn: TASK_A, reconcilerTaskArn: TASK_B,
      actorRef: 'arn:aws:sts::311414082667:assumed-role/watchdog-bms-deploy-uat/operator',
      evidenceRef: 'manual://success-bypass', reason: 'must not claim success after proved no mutation',
      outcome: 'SUCCEEDED', controller: GITHUB_CONTROLLER,
    }), /replay pre-intent recovery/);
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_B,
      controller: GITHUB_CONTROLLER,
    }), true);
    const recovered = (await first.query(`
      SELECT "status", "reconciliationEvidenceRef"
        FROM "RemoteReleaseOperation" WHERE "id" = $1
    `, [releaseId])).rows[0];
    assert.equal(recovered.status, 'RECONCILED_FAILED_CONFIRMED');
    assert.equal(recovered.reconciliationEvidenceRef, `RemoteReleasePreIntentCleanup:${releaseId}`);
    const beforeTerminalReplay = (await first.query(`
      SELECT "updatedAt", "preIntentApiCleanupCompletedAt", "preIntentApiCleanupEvidenceJson"
        FROM "RemoteReleaseOperation" WHERE "id" = $1
    `, [releaseId])).rows[0];
    const auditCount = (await first.query(`
      SELECT count(*)::int AS count FROM "AuditLog"
       WHERE "action" = 'system.release_operation.pre_intent_api_cleanup' AND "targetId" = $1
    `, [releaseId])).rows[0].count;
    let platformReads = 0;
    const preIntentReplayInput = {
      operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      recoveryExecutorBuildReleaseId: SHA_B,
      recoveryExecutorImage: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:${'f'.repeat(64)}`,
      recoveryValidatedCiRunId: '987654', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER, region: 'ap-southeast-1',
      readPlatform: async () => {
        platformReads += 1;
        return {
          service: recoveryService(preIntentServiceArn, legacyConfiguration, null),
          deployment: null,
          ssmServiceArn: preIntentServiceArn,
        };
      },
    } as const;
    const replay = await recoverPreIntentApiRelease(first, preIntentReplayInput);
    assert.deepEqual(replay, { replay: true, state: preIntentState, terminalReplay: true });
    assert.equal(platformReads, 2, 'terminal pre-intent replay still requires two live reads');
    assert.deepEqual((await first.query(`
      SELECT "updatedAt", "preIntentApiCleanupCompletedAt", "preIntentApiCleanupEvidenceJson"
        FROM "RemoteReleaseOperation" WHERE "id" = $1
    `, [releaseId])).rows[0], beforeTerminalReplay, 'terminal pre-intent replay must not mutate its parent');
    assert.equal((await first.query(`
      SELECT count(*)::int AS count FROM "AuditLog"
       WHERE "action" = 'system.release_operation.pre_intent_api_cleanup' AND "targetId" = $1
    `, [releaseId])).rows[0].count, auditCount);
    const changedLegacy = activeConfiguration(preIntentRevisionArn, 'b'.repeat(12));
    await assert.rejects(
      () => recoverPreIntentApiRelease(first!, {
        ...preIntentReplayInput,
        readPlatform: async () => ({
          service: recoveryService(preIntentServiceArn, changedLegacy, null),
          deployment: null,
          ssmServiceArn: preIntentServiceArn,
        }),
      }),
      /no longer matches fresh platform evidence/,
      'terminal pre-intent replay must reject live evidence that differs from its stored proof',
    );

    await assert.rejects(() => beginRemoteReleaseOperation(first!, {
      ...operation(randomUUID(), TASK_A), mode: 'release', releaseDeployTarget: 'unknown',
    }), /exact release target/);
    const workersOnlyId = randomUUID();
    await beginRemoteReleaseOperation(first, {
      ...operation(workersOnlyId, TASK_A), mode: 'release', releaseDeployTarget: 'workers',
    });
    await assert.rejects(() => prepareRemoteReleaseMutationIntent(first!, {
      operationId: workersOnlyId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
      preparerTaskArn: TASK_B, controller: GITHUB_CONTROLLER,
      intent: intent(randomUUID(), 'api-web', SERVICE),
    }), /does not authorize api-web/);
    await finishRemoteReleaseOperation(first, workersOnlyId, TASK_A, 'FAILED_CONFIRMED', 'test cleanup');
  });

  it('terminalizes an all-target release that stopped before every durable service intent', async (t) => {
    if (!reachable || !first) return t.skip('no local PostgreSQL database is reachable');
    const releaseId = randomUUID();
    await beginRemoteReleaseOperation(first, {
      ...operation(releaseId, TASK_A), mode: 'release', releaseDeployTarget: 'all',
    });
    await holdRemoteReleaseOperation(first, releaseId, TASK_A);
    await first.query(`
      UPDATE "RemoteReleaseOperation"
         SET "status" = 'UNKNOWN', "leaseExpiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second',
             "preIntentApiCleanupCompletedAt" = CURRENT_TIMESTAMP,
             "preIntentApiCleanupEvidenceJson" = '{}'::jsonb
       WHERE "id" = $1
    `, [releaseId]);

    assert.equal((await first.query(`
      SELECT count(*)::int AS count FROM "RemoteReleaseMutationIntent" WHERE "operationId" = $1
    `, [releaseId])).rows[0].count, 0, 'the release failed before its first durable service intent');
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_B,
      controller: GITHUB_CONTROLLER,
    }), true, 'zero intents proves no service mutation began before the controller failed');
    assert.equal((await first.query(`
      SELECT "status" FROM "RemoteReleaseOperation" WHERE "id" = $1
    `, [releaseId])).rows[0].status, 'RECONCILED_FAILED_CONFIRMED');
  });

  it('persists bounded orphan evidence, completes all-target coverage and replays only after live revalidation', async (t) => {
    if (!reachable || !first) return t.skip('no local PostgreSQL database is reachable');
    const releaseId = randomUUID();
    const orphanController = {
      ...GITHUB_CONTROLLER,
      githubRunId: '30760853050',
      githubWorkflowRef: 'example/watchdog/.github/workflows/deploy-uat.yml@refs/heads/main',
    };
    await beginRemoteReleaseOperation(first, {
      ...operation(releaseId, TASK_A), mode: 'release', releaseDeployTarget: 'all', ...orphanController,
    });
    await holdRemoteReleaseOperation(first, releaseId, TASK_A);
    const apiEvidence = {
      service: 'api-web', serviceArn: SERVICE, deploymentArn: DEPLOYMENT,
      targetRevisionArn: REVISION, sourceSha: SHA_A, noOp: false,
    };
    const workerEvidence = {
      service: 'workers', serviceArn: SERVICE.replace('/api-web', '/workers'),
      deploymentArn: DEPLOYMENT.replace('/api-web/', '/workers/'),
      targetRevisionArn: REVISION.replace('/api-web/', '/workers/'), sourceSha: SHA_A, noOp: false,
    };
    for (const [serviceKey, evidence] of [['api-web', apiEvidence], ['workers', workerEvidence]] as const) {
      const intentId = randomUUID();
      await prepareRemoteReleaseMutationIntent(first, {
        operationId: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
        preparerTaskArn: TASK_B, controller: orphanController,
        intent: intent(intentId, serviceKey, evidence.serviceArn),
      });
      await bindRemoteReleaseDeployment(first, {
        id: releaseId, targetEnvironment: 'uat', buildReleaseId: SHA_A,
        binderTaskArn: TASK_B, controller: orphanController, intentId, evidence,
      });
    }
    await first.query(`
      UPDATE "RemoteReleaseOperation"
         SET "status" = 'UNKNOWN', "unknownAt" = CURRENT_TIMESTAMP,
             "leaseExpiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second'
       WHERE "id" = $1
    `, [releaseId]);

    const serviceArn = SERVICE.replace('/api-web', '/ai-gateway');
    const targetRevisionArn = REVISION.replace('/api-web/', '/ai-gateway/');
    const orphanEvidence = {
      service: 'ai-gateway', serviceArn,
      deploymentArn: DEPLOYMENT.replace('/api-web/', '/ai-gateway/'),
      targetRevisionArn, sourceSha: SHA_A, noOp: false,
    };
    const previous = activeConfiguration(targetRevisionArn.replace('rev-1', 'rev-old'), 'd'.repeat(12));
    const serving = activeConfiguration(targetRevisionArn, SHA_A);
    const legacyDescriptor = descriptor(previous);
    const orphanIntent = {
      id: randomUUID(), serviceKey: 'ai-gateway' as const, mutationKind: 'UPDATE' as const,
      expectedServiceArn: serviceArn, clusterName: 'watchdog-bms-uat', serviceName: 'ai-gateway',
      ssmParameterName: '/watchdog-bms/uat/ecs-express-ai-gateway-service-arn',
      requestHash: '1'.repeat(64), desiredConfigHash: configurationHash(serving),
      beforeDeploymentArns: [], beforeCurrentDeploymentArn: null,
      beforeActiveConfigurations: [legacyDescriptor], legacyBootstrapDescriptor: legacyDescriptor,
    };
    const incidentPath = 'infra/uat/recovery-evidence/bf131086-6055-4143-a77c-579bc7d58b57.json';
    const incidentBytes = readFileSync(join(__dirname, '../../..', incidentPath));
    const incident = JSON.parse(incidentBytes.toString('utf8'));
    const taskEvidence = parseOrphanTaskEvidence('uat', JSON.stringify({
      parentTaskArn: TASK_A, intentTaskArn: TASK_B, binderTaskArn: TASK_C,
      parentTaskDefinitionArn: 'arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-uat-release-task:28',
      intentTaskDefinitionArn: 'arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-uat-release-task:30',
      binderTaskDefinitionArn: 'arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-uat-release-task:34',
      imageDigest: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:${'e'.repeat(64)}`,
      parentStartedAt: '2026-08-02T01:28:51.000Z', parentStoppedAt: '2026-08-02T01:30:10.000Z',
      intentStartedAt: '2026-08-02T01:33:19.000Z', intentStoppedAt: '2026-08-02T01:33:45.000Z',
      binderStartedAt: '2026-08-02T01:35:45.000Z', binderStoppedAt: '2026-08-02T01:36:11.000Z',
      originalController: orphanController,
      evidenceKind: 'REVIEWED_EXPIRED_ECS_TASK',
      reviewedEvidenceManifestPath: incidentPath,
      reviewedEvidenceManifestSha256: createHash('sha256').update(incidentBytes).digest('hex'),
      reviewedAuditMetadata: incident.auditMetadata,
    }));
    let platformReads = 0;
    const recoveryInput = {
      operationId: releaseId, targetEnvironment: 'uat' as const, buildReleaseId: SHA_A,
      recoveryExecutorBuildReleaseId: SHA_B,
      recoveryExecutorImage: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:${'f'.repeat(64)}`,
      recoveryValidatedCiRunId: '987654', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER, region: 'ap-southeast-1', intent: orphanIntent,
      evidence: orphanEvidence, taskEvidence,
      networkEvidence: {
        serviceArn, activeSecurityGroups: ['sg-0123456789abcdef0'],
        requestedSecurityGroup: 'sg-0123456789abcdef0', managedSecurityGroup: null, managedDescription: null,
      },
      readPlatform: async () => {
        platformReads += 1;
        return { platform: { currentDeployment: null, sourceSha: SHA_A }, ssmServiceArn: serviceArn };
      },
    };
    assert.deepEqual(await recoverOrphanReleaseMutationIntent(first, recoveryInput), { replay: false });
    const persisted = (await first.query(`
      SELECT "status", "legacyBootstrapDescriptorJson", "evidenceJson"
        FROM "RemoteReleaseMutationIntent" WHERE "id" = $1
    `, [orphanIntent.id])).rows[0];
    assert.equal(persisted.status, 'BOUND');
    assert.equal(persisted.legacyBootstrapDescriptorJson, null);
    assert.deepEqual(persisted.evidenceJson, orphanEvidence);
    const audit = (await first.query(`
      SELECT "metadataJson" FROM "AuditLog"
       WHERE "action" = 'system.release_operation.recover_orphan_mutation' AND "targetId" = $1
    `, [orphanIntent.id])).rows[0].metadataJson;
    assert.equal(audit.targetBuildReleaseId, SHA_A);
    assert.equal(audit.recoveryExecutorBuildReleaseId, SHA_B);
    assert.equal(audit.recoveryValidatedCiRunId, '987654');
    assert.equal(audit.recoveryExecutorImage, recoveryInput.recoveryExecutorImage);
    assert.equal(audit.taskEvidence.evidenceKind, 'REVIEWED_EXPIRED_ECS_TASK');
    assert.equal(audit.taskEvidence.reviewedEvidenceManifestSha256, createHash('sha256').update(incidentBytes).digest('hex'));
    assert.deepEqual(audit.taskEvidence.reviewedAuditMetadata, incident.auditMetadata);
    assert.equal(await terminalizeRecoveredReleaseIfReady(first, {
      operationId: releaseId, targetEnvironment: 'uat', recovererTaskArn: TASK_C,
      controller: GITHUB_CONTROLLER,
    }), true);
    assert.deepEqual(await recoverOrphanReleaseMutationIntent(first, recoveryInput), { replay: true });
    assert.equal(platformReads, 4, 'initial recovery and replay each require two fresh platform reads');
  });

  it('terminalizes only the exact Production V2 zero-intent bootstrap-closed hold', async (t) => {
    if (!reachable || !first) return t.skip('no local PostgreSQL database is reachable');
    await beginRemoteReleaseOperation(first, {
      id: bootstrapEvidence.operationId, targetEnvironment: 'production', mode: 'release',
      releaseDeployTarget: 'all', buildReleaseId: PROD_SOURCE, ecsTaskArn: PROD_PARENT_TASK,
      ecsServiceArn: null, serviceDeploymentArn: null, targetServiceRevisionArn: null,
      activeBuilds: null, deploymentManifest: null, ...PROD_ORIGINAL_CONTROLLER, leaseSeconds: 30,
    });
    await holdRemoteReleaseOperation(first, bootstrapEvidence.operationId, PROD_PARENT_TASK);
    await first.query(`UPDATE "RemoteReleaseOperation" SET "leaseExpiresAt"=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE "id"=$1`,
      [bootstrapEvidence.operationId]);
    let reads = 0;
    const input = {
      operationId: bootstrapEvidence.operationId, targetEnvironment: 'production' as const,
      buildReleaseId: PROD_SOURCE, recoveryExecutorBuildReleaseId: SHA_B,
      recoveryExecutorImage: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:${'f'.repeat(64)}`,
      recoveryValidatedCiRunId: '31730000001', recovererTaskArn: PROD_RECOVERY_TASK,
      controller: PROD_RECOVERY_CONTROLLER, region: 'ap-southeast-1', evidence: bootstrapEvidence,
      readPlatform: async () => { reads += 1; return bootstrapPlatformReads(); },
    };
    const unexpectedIntentId = randomUUID();
    await first.query(`
      INSERT INTO "RemoteReleaseMutationIntent" (
        "id", "operationId", "targetEnvironment", "buildReleaseId", "serviceKey", "mutationKind",
        "expectedServiceArn", "clusterName", "serviceName", "ssmParameterName", "requestHash",
        "desiredConfigHash", "beforeDeploymentArnsJson", "beforeActiveConfigurationsJson",
        "preparedByTaskArn", "status", "requestDeadlineAt", "createdAt", "updatedAt"
      ) VALUES ($1,$2,'production',$3,'workers','UPDATE',$4,'watchdog-bms-prod','watchdog-bms-workers',
                '/watchdog-bms/production/ecs-express-workers-service-arn',$5,$6,'[]'::jsonb,'[]'::jsonb,
                $7,'OPEN',CURRENT_TIMESTAMP + INTERVAL '10 minutes',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `, [unexpectedIntentId, bootstrapEvidence.operationId, PROD_SOURCE,
      bootstrapEvidence.services.find((service) => service.service === 'workers')!.serviceArn,
      '1'.repeat(64), '2'.repeat(64), PROD_RECOVERY_TASK]);
    await assert.rejects(() => recoverBootstrapClosedPreIntentRelease(first!, input), /exact resolved non-api intent history/);
    await first.query('DELETE FROM "RemoteReleaseMutationIntent" WHERE "id"=$1', [unexpectedIntentId]);
    assert.deepEqual(await recoverBootstrapClosedPreIntentRelease(first, input), {
      replay: false,
      services: bootstrapEvidence.services.slice().sort((left, right) => left.service.localeCompare(right.service)),
    });
    const parent = (await first.query(`
      SELECT "status","reconciliationEvidenceRef" FROM "RemoteReleaseOperation" WHERE "id"=$1
    `, [bootstrapEvidence.operationId])).rows[0];
    assert.equal(parent.status, 'RECONCILED_FAILED_CONFIRMED');
    assert.equal(parent.reconciliationEvidenceRef,
      `ProductionV2ControllerEvidence:${bootstrapEvidence.failedPromotionRunId}:1:${bootstrapEvidence.artifactDigest}`);
    assert.deepEqual(await recoverBootstrapClosedPreIntentRelease(first, input), {
      replay: true,
      services: bootstrapEvidence.services.slice().sort((left, right) => left.service.localeCompare(right.service)),
    });
    assert.equal(reads, 6, 'blocked, initial and replay attempts each require two live platform reads');
    const audit = (await first.query(`
      SELECT "metadataJson" FROM "AuditLog"
       WHERE "action"='system.release_operation.recover_bootstrap_closed_pre_intent' AND "targetId"=$1
    `, [bootstrapEvidence.operationId])).rows[0].metadataJson;
    assert.equal(audit.evidence.artifactDigest, bootstrapEvidence.artifactDigest);
    assert.equal(audit.recoveryValidatedCiRunId, input.recoveryValidatedCiRunId);
  });

  it('terminalizes exact candidate-closed partial history only after every non-api intent is resolved', async (t) => {
    if (!reachable || !first) return t.skip('no local PostgreSQL database is reachable');
    const partialEvidence = structuredClone(bootstrapEvidence);
    partialEvidence.operationId = randomUUID();
    partialEvidence.parentTaskArn = 'arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/partial-parent';
    partialEvidence.artifactDigest = `sha256:${'9'.repeat(64)}`;
    partialEvidence.boundHistory = partialEvidence.services
      .filter((service) => service.service !== 'api-web')
      .map((service) => ({
        service: service.service, serviceArn: service.serviceArn, deploymentArn: service.deploymentArn,
        targetRevisionArn: service.targetRevisionArn, sourceSha: service.sourceSha, noOp: service.noOp,
      }));
    await beginRemoteReleaseOperation(first, {
      id: partialEvidence.operationId, targetEnvironment: 'production', mode: 'release',
      releaseDeployTarget: 'all', buildReleaseId: PROD_SOURCE, ecsTaskArn: partialEvidence.parentTaskArn,
      ecsServiceArn: null, serviceDeploymentArn: null, targetServiceRevisionArn: null,
      activeBuilds: null, deploymentManifest: partialEvidence.boundHistory,
      ...PROD_ORIGINAL_CONTROLLER, leaseSeconds: 30,
    });
    await holdRemoteReleaseOperation(first, partialEvidence.operationId, partialEvidence.parentTaskArn);
    const intentIds: string[] = [];
    for (const evidence of partialEvidence.boundHistory) {
      const id = randomUUID();
      intentIds.push(id);
      const serviceName = evidence.serviceArn.split('/').at(-1)!;
      await first.query(`
        INSERT INTO "RemoteReleaseMutationIntent" (
          "id","operationId","targetEnvironment","buildReleaseId","serviceKey","mutationKind",
          "expectedServiceArn","clusterName","serviceName","ssmParameterName","requestHash",
          "desiredConfigHash","beforeDeploymentArnsJson","beforeActiveConfigurationsJson",
          "preparedByTaskArn","status","evidenceJson","closedByTaskArn","closedAt",
          "requestDeadlineAt","createdAt","updatedAt"
        ) VALUES ($1,$2,'production',$3,$4,'UPDATE',$5,'watchdog-bms-prod',$6,$7,$8,$9,
                  '[]'::jsonb,'[]'::jsonb,$10,'BOUND',$11::jsonb,$12,CURRENT_TIMESTAMP,
                  CURRENT_TIMESTAMP + INTERVAL '10 minutes',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `, [id, partialEvidence.operationId, PROD_SOURCE, evidence.service, evidence.serviceArn, serviceName,
        `/watchdog-bms/production/ecs-express-${evidence.service}-service-arn`,
        '4'.repeat(64), '5'.repeat(64), partialEvidence.parentTaskArn, JSON.stringify(evidence), PROD_RECOVERY_TASK]);
    }
    await first.query(`
      UPDATE "RemoteReleaseOperation" SET "leaseExpiresAt"=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE "id"=$1
    `, [partialEvidence.operationId]);
    const input = {
      operationId: partialEvidence.operationId, targetEnvironment: 'production' as const,
      buildReleaseId: PROD_SOURCE, recoveryExecutorBuildReleaseId: SHA_B,
      recoveryExecutorImage: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:${'f'.repeat(64)}`,
      recoveryValidatedCiRunId: '31730000002', recovererTaskArn: PROD_RECOVERY_TASK,
      controller: PROD_RECOVERY_CONTROLLER, region: 'ap-southeast-1', evidence: partialEvidence,
      readPlatform: async () => bootstrapPlatformReads(),
    };
    await first.query(`
      UPDATE "RemoteReleaseMutationIntent" SET "failedBuildCleanupRequiredAt"=CURRENT_TIMESTAMP WHERE "id"=$1
    `, [intentIds[0]]);
    await assert.rejects(() => recoverBootstrapClosedPreIntentRelease(first!, input),
      /exact resolved non-api intent history/);
    await first.query(`
      UPDATE "RemoteReleaseMutationIntent" SET "failedBuildCleanupCompletedAt"=CURRENT_TIMESTAMP WHERE "id"=$1
    `, [intentIds[0]]);
    const duplicateIntentId = randomUUID();
    const duplicateEvidence = partialEvidence.boundHistory[0]!;
    await first.query(`
      INSERT INTO "RemoteReleaseMutationIntent" (
        "id","operationId","targetEnvironment","buildReleaseId","serviceKey","mutationKind",
        "expectedServiceArn","clusterName","serviceName","ssmParameterName","requestHash",
        "desiredConfigHash","beforeDeploymentArnsJson","beforeActiveConfigurationsJson",
        "preparedByTaskArn","status","evidenceJson","closedByTaskArn","closedAt",
        "requestDeadlineAt","createdAt","updatedAt"
      ) VALUES ($1,$2,'production',$3,$4,'UPDATE',$5,'watchdog-bms-prod',$6,$7,$8,$9,
                '[]'::jsonb,'[]'::jsonb,$10,'BOUND',$11::jsonb,$12,CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP + INTERVAL '10 minutes',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `, [duplicateIntentId, partialEvidence.operationId, PROD_SOURCE, duplicateEvidence.service,
      duplicateEvidence.serviceArn, duplicateEvidence.serviceArn.split('/').at(-1),
      `/watchdog-bms/production/ecs-express-${duplicateEvidence.service}-service-arn`,
      '6'.repeat(64), '7'.repeat(64), partialEvidence.parentTaskArn,
      JSON.stringify(duplicateEvidence), PROD_RECOVERY_TASK]);
    await assert.rejects(() => recoverBootstrapClosedPreIntentRelease(first!, input),
      /exact resolved non-api intent history/);
    await first.query('DELETE FROM "RemoteReleaseMutationIntent" WHERE "id"=$1', [duplicateIntentId]);
    assert.deepEqual(await recoverBootstrapClosedPreIntentRelease(first, input), {
      replay: false,
      services: partialEvidence.services.slice().sort((left, right) => left.service.localeCompare(right.service)),
    });
    const parent = (await first.query(`
      SELECT "status","reconciliationReason","outcomeReason" FROM "RemoteReleaseOperation" WHERE "id"=$1
    `, [partialEvidence.operationId])).rows[0];
    assert.equal(parent.status, 'RECONCILED_FAILED_CONFIRMED');
    assert.match(parent.reconciliationReason, /resolved non-api history/);
    assert.match(parent.outcomeReason, /partial-closed no-api-intent recovery/);
  });
});

function activeConfiguration(revision: string, sha: string) {
  return {
    serviceRevisionArn: revision,
    networkConfiguration: {
      securityGroups: ['sg-0123456789abcdef0'],
      subnets: [],
    },
    primaryContainer: {
      image: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:${'c'.repeat(64)}`,
      environment: [{ name: 'GIT_SHA', value: sha }],
    },
  };
}

const deploymentResponse = (status = 'SUCCESSFUL') => ({
  serviceDeployments: [{
    serviceDeploymentArn: DEPLOYMENT, status, serviceArn: SERVICE,
    targetServiceRevision: { arn: REVISION },
    createdAt: '2026-08-02T01:00:00.000Z',
  }],
});
const deploymentHistory = (overrides: Record<string, unknown> = {}) => ({
  ...deploymentResponse(),
  ...overrides,
});
const serviceResponse = (active = [activeConfiguration(REVISION, SHA_A)], currentDeployment = DEPLOYMENT) => ({
  service: { serviceArn: SERVICE, status: { statusCode: 'ACTIVE' }, currentDeployment, activeConfigurations: active },
});
const expected = { serviceArn: SERVICE, deploymentArn: DEPLOYMENT, targetRevisionArn: REVISION, activeBuilds: [SHA_A] };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function configurationHash(configuration: ReturnType<typeof activeConfiguration>): string {
  const primary = configuration.primaryContainer;
  return createHash('sha256').update(`${canonical({
    executionRoleArn: null,
    taskRoleArn: null,
    cpu: '',
    memory: '',
    networkConfiguration: configuration.networkConfiguration,
    healthCheckPath: null,
    primaryContainer: {
      image: primary.image,
      containerPort: null,
      awsLogsConfiguration: null,
      repositoryCredentials: null,
      command: [],
      environment: primary.environment,
      secrets: [],
    },
    scalingTarget: null,
  })}\n`).digest('hex');
}

function descriptor(configuration: ReturnType<typeof activeConfiguration>) {
  return {
    revisionArn: configuration.serviceRevisionArn,
    sourceSha: configuration.primaryContainer.environment[0]!.value,
    configHash: configurationHash(configuration),
    image: configuration.primaryContainer.image,
  };
}

function recoveryIntent(
  serviceKey: 'api-web' | 'ai-gateway',
  serviceArn: string,
  before: ReturnType<typeof activeConfiguration>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: randomUUID(),
    operationId: randomUUID(),
    targetEnvironment: 'uat',
    buildReleaseId: SHA_B,
    serviceKey,
    mutationKind: 'UPDATE',
    expectedServiceArn: serviceArn,
    clusterName: 'watchdog-bms-uat',
    serviceName: serviceArn.split('/').at(-1),
    ssmParameterName: `/watchdog-bms/uat/ecs-express-${serviceKey}-service-arn`,
    requestHash: '1'.repeat(64),
    desiredConfigHash: '2'.repeat(64),
    beforeDeploymentArnsJson: [],
    beforeCurrentDeploymentArn: `${DEPLOYMENT}-before`,
    beforeActiveConfigurationsJson: [descriptor(before)],
    legacyBootstrapDescriptorJson: null,
    preparedByTaskArn: TASK_A,
    status: 'OPEN',
    evidenceJson: null,
    requestStartedAt: new Date(Date.now() - 30_000),
    requestDeadlineAt: new Date(Date.now() + 30_000),
    legacyRollbackObservedAt: null,
    legacyRollbackCleanedAt: null,
    legacyCutoverCompletedAt: null,
    failedBuildCleanupRequiredAt: null,
    failedBuildCleanupCompletedAt: null,
    ...overrides,
  } as any;
}

function recoveryService(serviceArn: string, configuration: ReturnType<typeof activeConfiguration>, currentDeployment: string | null) {
  return {
    service: {
      serviceArn,
      status: { statusCode: 'ACTIVE' },
      currentDeployment,
      activeConfigurations: [configuration],
    },
  };
}

function recoveryDeployment(serviceArn: string, revisionArn: string, status = 'SUCCESSFUL') {
  return {
    serviceDeploymentArn: DEPLOYMENT,
    serviceArn,
    status,
    targetServiceRevisionArn: revisionArn,
    createdAt: new Date().toISOString(),
  };
}

const PROD_SOURCE = 'c'.repeat(40);
const PROD_PARENT_TASK = 'arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/parent-task';
const PROD_RECOVERY_TASK = 'arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/recovery-task';
const PROD_ORIGINAL_CONTROLLER = {
  ...GITHUB_CONTROLLER,
  sourceBranch: 'main',
  githubRunId: '31727367323',
  githubRunAttempt: 1,
  githubWorkflowRef: 'example/watchdog/.github/workflows/deploy-production-v2.yml@refs/heads/main',
};
const PROD_RECOVERY_CONTROLLER = {
  ...GITHUB_CONTROLLER,
  sourceBranch: 'main',
  githubRunId: '31730000000',
  githubRunAttempt: 1,
  githubWorkflowRef: 'example/watchdog/.github/workflows/recover-release-intent.yml@refs/heads/main',
};
const bootstrapServices = [
  {
    service: 'ai-gateway', name: 'watchdog-bms-ai-gateway-v2', repository: 'watchdog-bms-ai-gateway',
    controls: { modelProvider: 'disabled', aiGatewayEnabled: 'false', aiAgentRegistryEnabled: 'false', aiToolPolicyEnforced: 'false', aiToolAuditEnabled: 'false' },
    environment: [
      { name: 'MODEL_PROVIDER', value: 'disabled' }, { name: 'AI_GATEWAY_ENABLED', value: 'false' },
      { name: 'AI_AGENT_REGISTRY_ENABLED', value: 'false' }, { name: 'AI_TOOL_POLICY_ENFORCED', value: 'false' },
      { name: 'AI_TOOL_AUDIT_ENABLED', value: 'false' },
    ],
  },
  {
    service: 'api-web', name: 'watchdog-bms-api-web-pub', repository: 'watchdog-bms-api',
    controls: { globalMaintenanceMode: 'true', reimbursementWriteQuiesce: 'true', crmAutoReplyEnabled: 'false', aiGatewayEnabled: 'false', lineAiLedgerEnabled: 'false' },
    environment: [
      { name: 'GLOBAL_MAINTENANCE_MODE', value: 'true' }, { name: 'REIMBURSEMENT_WRITE_QUIESCE', value: 'true' },
      { name: 'CRM_AUTO_REPLY_ENABLED', value: 'false' }, { name: 'AI_GATEWAY_ENABLED', value: 'false' },
      { name: 'LINE_AI_LEDGER_ENABLED', value: 'false' },
    ],
  },
  {
    service: 'workers', name: 'watchdog-bms-workers', repository: 'watchdog-bms-workers',
    controls: { queueEnabled: 'false' }, environment: [{ name: 'QUEUE_ENABLED', value: 'false' }],
  },
] as const;
const bootstrapEvidence = {
  schemaVersion: 2 as const,
  artifactDigest: `sha256:${'1'.repeat(64)}`,
  maintenanceProofSha256: '2'.repeat(64),
  failedPromotionRunId: PROD_ORIGINAL_CONTROLLER.githubRunId,
  failedPromotionRunAttempt: PROD_ORIGINAL_CONTROLLER.githubRunAttempt,
  controllerCommit: 'd'.repeat(40), sourceCommit: PROD_SOURCE,
  operationId: '91794761-7661-468c-8e9c-91f5a69b1f06', parentTaskArn: PROD_PARENT_TASK,
  manifestSha256: '3'.repeat(64),
  services: bootstrapServices.map((item, index) => ({
    service: item.service,
    serviceArn: `arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/${item.name}`,
    deploymentArn: `arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-prod/${item.name}/deployment-${index}`,
    targetRevisionArn: `arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/${item.name}/revision-${index}`,
    sourceSha: PROD_SOURCE, noOp: false,
    image: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/${item.repository}@sha256:${String(index + 4).repeat(64)}`,
    maintenanceControls: item.controls,
  })),
  boundHistory: [],
};
const bootstrapPlatformReads = () => bootstrapServices.map((item) => {
  const expected = bootstrapEvidence.services.find((service) => service.service === item.service)!;
  return {
    service: item.service,
    serviceResponse: { service: {
      serviceArn: expected.serviceArn, status: { statusCode: 'ACTIVE' }, currentDeployment: null,
      activeConfigurations: [{
        serviceRevisionArn: expected.targetRevisionArn,
        primaryContainer: { image: expected.image, environment: [
          { name: 'GIT_SHA', value: PROD_SOURCE }, { name: 'PRODUCTION_SERVING_MODE', value: 'maintenance_only' },
          ...item.environment,
        ] },
      }],
    } },
    deploymentResponse: { serviceDeployments: [{
      serviceDeploymentArn: expected.deploymentArn, serviceArn: expected.serviceArn, status: 'SUCCESSFUL',
      targetServiceRevision: { arn: expected.targetRevisionArn }, createdAt: '2026-08-13T18:17:00.000Z',
    }] },
  };
});

describe('bootstrap-closed zero-intent recovery decision', () => {
  it('accepts only the stable exact closed candidate and successful bootstrap deployments', () => {
    assert.deepEqual(parseBootstrapClosedRecoveryEvidence(JSON.stringify(bootstrapEvidence)), bootstrapEvidence);
    const swappedImage = structuredClone(bootstrapEvidence);
    swappedImage.services[0]!.image = bootstrapEvidence.services[1]!.image;
    assert.throws(() => parseBootstrapClosedRecoveryEvidence(JSON.stringify(swappedImage)), /service evidence is invalid/);
    const partial = structuredClone(bootstrapEvidence);
    partial.boundHistory = partial.services.filter((service) => service.service !== 'api-web').map((service) => ({
      service: service.service, serviceArn: service.serviceArn, deploymentArn: service.deploymentArn,
      targetRevisionArn: service.targetRevisionArn, sourceSha: service.sourceSha, noOp: service.noOp,
    }));
    const aiCurrent = partial.boundHistory.find((item) => item.service === 'ai-gateway')!;
    partial.boundHistory.unshift({ ...aiCurrent,
      deploymentArn: `${aiCurrent.serviceArn.replace(':service/', ':service-deployment/')}/Z-mixed-case-older`,
      targetRevisionArn: `${aiCurrent.serviceArn.replace(':service/', ':service-revision/')}/revision-older`,
    });
    assert.deepEqual(parseBootstrapClosedRecoveryEvidence(JSON.stringify(partial)), partial);
    const apiHistory = structuredClone(partial);
    const api = apiHistory.services.find((service) => service.service === 'api-web')!;
    apiHistory.boundHistory.push({ service: api.service, serviceArn: api.serviceArn,
      deploymentArn: api.deploymentArn, targetRevisionArn: api.targetRevisionArn,
      sourceSha: api.sourceSha, noOp: api.noOp });
    apiHistory.boundHistory.sort((left, right) => left.service.localeCompare(right.service));
    assert.throws(() => parseBootstrapClosedRecoveryEvidence(JSON.stringify(apiHistory)), /bound history is invalid/);
    assert.deepEqual(validateBootstrapClosedRecoveryPlatform(bootstrapEvidence, bootstrapPlatformReads()),
      bootstrapEvidence.services.slice().sort((left, right) => left.service.localeCompare(right.service)));
    const providerSettled = bootstrapPlatformReads();
    for (const read of providerSettled) delete read.serviceResponse.service.currentDeployment;
    assert.deepEqual(validateBootstrapClosedRecoveryPlatform(bootstrapEvidence, providerSettled),
      bootstrapEvidence.services.slice().sort((left, right) => left.service.localeCompare(right.service)),
      'ECS Express omits currentDeployment after a service settles instead of returning null');
    const live = bootstrapPlatformReads();
    Object.assign(live[1]!.serviceResponse.service.activeConfigurations[0]!.primaryContainer.environment
      .find((item) => item.name === 'PRODUCTION_SERVING_MODE')!, { value: 'live' });
    assert.throws(() => validateBootstrapClosedRecoveryPlatform(bootstrapEvidence, live), /bootstrap maintenance controls/);
    const moved = bootstrapPlatformReads();
    moved[0]!.deploymentResponse.serviceDeployments[0]!.status = 'ROLLBACK_SUCCESSFUL';
    assert.throws(() => validateBootstrapClosedRecoveryPlatform(bootstrapEvidence, moved), /not exact and successful/);
  });
});

describe('remote mutation recovery decision', () => {
  const oldConfiguration = activeConfiguration(REVISION.replace('rev-1', 'rev-old'), SHA_A);
  const incomingConfiguration = activeConfiguration(REVISION, SHA_B);

  it('resolves exact success, no-op and no-mutation without widening API cleanup', () => {
    const jqGoldenHash = '626e46ca07fd0b0074f7e188e7e826737658c156a5e9e54f99466e84e323568b';
    assert.equal(configurationHash(incomingConfiguration), jqGoldenHash,
      'fixture must stay byte-identical to `jq -cS ... | shasum -a 256`, including the trailing newline');
    const successIntent = recoveryIntent('api-web', SERVICE, oldConfiguration, {
      desiredConfigHash: jqGoldenHash,
    });
    const successDeployment = { serviceDeployments: [recoveryDeployment(SERVICE, REVISION)] };
    const settledIncomingService = recoveryService(SERVICE, incomingConfiguration, null);
    const success = decideMutationIntentRecovery(
      successIntent, 'uat', successDeployment, settledIncomingService,
      successDeployment, settledIncomingService, SERVICE,
    );
    assert.equal(success.status, 'BOUND');
    assert.equal(success.evidence?.noOp, false);
    assert.equal(success.failedBuildCleanupRequired, false);

    const noOpIntent = recoveryIntent('api-web', SERVICE, incomingConfiguration, {
      desiredConfigHash: configurationHash(incomingConfiguration),
      beforeCurrentDeploymentArn: DEPLOYMENT,
    });
    const incomingService = recoveryService(SERVICE, incomingConfiguration, DEPLOYMENT);
    const noDeployments = { serviceDeployments: [] };
    const noOp = decideMutationIntentRecovery(
      noOpIntent, 'uat', noDeployments, incomingService, noDeployments, incomingService, SERVICE,
    );
    assert.equal(noOp.status, 'BOUND');
    assert.equal(noOp.evidence?.noOp, true);

    const oldService = recoveryService(SERVICE, oldConfiguration, `${DEPLOYMENT}-before`);
    const noMutation = decideMutationIntentRecovery(
      recoveryIntent('api-web', SERVICE, oldConfiguration), 'uat',
      noDeployments, oldService, noDeployments, oldService, SERVICE,
    );
    assert.equal(noMutation.status, 'CONFIRMED_NO_MUTATION');
    assert.equal(noMutation.failedBuildCleanupRequired, true);

    assert.doesNotThrow(() => validateStoredIntentRecoveryReplay('BOUND', success.evidence, success));
    assert.throws(
      () => validateStoredIntentRecoveryReplay('BOUND', success.evidence, noOp),
      /no longer matches fresh remote recovery evidence/,
      'a closed BOUND replay cannot reuse evidence after the live target changed',
    );
  });

  it('distinguishes generic/legacy API rollback from a non-API rollback', () => {
    const rollbackResponse = { serviceDeployments: [recoveryDeployment(SERVICE, REVISION, 'ROLLBACK_SUCCESSFUL')] };
    const oldService = recoveryService(SERVICE, oldConfiguration, DEPLOYMENT);
    const generic = decideMutationIntentRecovery(
      recoveryIntent('api-web', SERVICE, oldConfiguration), 'uat',
      rollbackResponse, oldService, rollbackResponse, oldService, SERVICE,
    );
    assert.equal(generic.rollback, true);
    assert.equal(generic.legacyRollback, false);
    assert.equal(generic.failedBuildCleanupRequired, true);

    const legacyConfiguration = activeConfiguration(REVISION.replace('rev-1', 'rev-legacy'), SHA_A.slice(0, 12));
    const legacyService = recoveryService(SERVICE, legacyConfiguration, DEPLOYMENT);
    const legacy = decideMutationIntentRecovery(
      recoveryIntent('api-web', SERVICE, legacyConfiguration, {
        beforeCurrentDeploymentArn: null,
        legacyBootstrapDescriptorJson: descriptor(legacyConfiguration),
      }),
      'uat', rollbackResponse, legacyService, rollbackResponse, legacyService, SERVICE,
    );
    assert.equal(legacy.legacyRollback, true);
    assert.equal(legacy.failedBuildCleanupRequired, true);

    const aiServiceArn = SERVICE.replace('/api-web', '/ai-gateway');
    const aiRevision = REVISION.replace('/api-web/', '/ai-gateway/');
    const aiOld = activeConfiguration(aiRevision.replace('rev-1', 'rev-old'), SHA_A);
    const aiService = recoveryService(aiServiceArn, aiOld, DEPLOYMENT);
    const aiRollback = { serviceDeployments: [recoveryDeployment(aiServiceArn, aiRevision, 'ROLLBACK_SUCCESSFUL')] };
    const nonApi = decideMutationIntentRecovery(
      recoveryIntent('ai-gateway', aiServiceArn, aiOld), 'uat',
      aiRollback, aiService, aiRollback, aiService, aiServiceArn,
    );
    assert.equal(nonApi.rollback, true);
    assert.equal(nonApi.failedBuildCleanupRequired, false);
  });

  it('rejects moving, paginated, ambiguous and non-ACTIVE evidence', () => {
    const row = recoveryDeployment(SERVICE, REVISION);
    const oldService = recoveryService(SERVICE, oldConfiguration, `${DEPLOYMENT}-before`);
    const baseIntent = recoveryIntent('api-web', SERVICE, oldConfiguration);
    assert.throws(() => decideMutationIntentRecovery(
      baseIntent, 'uat', { serviceDeployments: [], nextToken: 'more' }, oldService,
      { serviceDeployments: [], nextToken: 'more' }, oldService, SERVICE,
    ), /paginated/);
    assert.throws(() => decideMutationIntentRecovery(
      baseIntent, 'uat', { serviceDeployments: [] }, oldService,
      { serviceDeployments: [row] }, oldService, SERVICE,
    ), /moved/);
    assert.throws(() => decideMutationIntentRecovery(
      baseIntent, 'uat', { serviceDeployments: [row, { ...row, serviceDeploymentArn: `${DEPLOYMENT}-2` }] }, oldService,
      { serviceDeployments: [row, { ...row, serviceDeploymentArn: `${DEPLOYMENT}-2` }] }, oldService, SERVICE,
    ), /multiple causal/);
    const malformed = { serviceDeployments: [{ ...row, createdAt: 'not-a-time' }] };
    assert.throws(() => decideMutationIntentRecovery(
      baseIntent, 'uat', malformed, oldService, malformed, oldService, SERVICE,
    ), /malformed identity or time/);
    const later = {
      serviceDeployments: [
        row,
        { ...row, serviceDeploymentArn: `${DEPLOYMENT}-later`, createdAt: new Date(Date.now() + 120_000).toISOString() },
      ],
    };
    assert.throws(() => decideMutationIntentRecovery(
      baseIntent, 'uat', later, oldService, later, oldService, SERVICE,
    ), /later ECS deployment/);
    const draining = structuredClone(oldService);
    draining.service.status.statusCode = 'DRAINING';
    assert.throws(() => decideMutationIntentRecovery(
      baseIntent, 'uat', { serviceDeployments: [] }, draining,
      { serviceDeployments: [] }, draining, SERVICE,
    ), /ACTIVE/);
    const empty = structuredClone(oldService);
    empty.service.activeConfigurations = [];
    assert.throws(() => decideMutationIntentRecovery(
      baseIntent, 'uat', { serviceDeployments: [] }, empty,
      { serviceDeployments: [] }, empty, SERVICE,
    ), /active configuration/);
  });
});

describe('bounded orphan mutation recovery', () => {
  const serviceArn = SERVICE.replace('/api-web', '/ai-gateway');
  const revisionArn = REVISION.replace('/api-web/', '/ai-gateway/');
  const previous = activeConfiguration(revisionArn.replace('rev-1', 'rev-old'), SHA_A.slice(0, 12));
  const serving = activeConfiguration(revisionArn, SHA_B);
  const legacyDescriptor = descriptor(previous);
  const orphanIntent = {
    id: randomUUID(),
    serviceKey: 'ai-gateway',
    mutationKind: 'UPDATE',
    expectedServiceArn: serviceArn,
    clusterName: 'watchdog-bms-uat',
    serviceName: 'ai-gateway',
    ssmParameterName: '/watchdog-bms/uat/ecs-express-ai-gateway-service-arn',
    requestHash: '1'.repeat(64),
    desiredConfigHash: configurationHash(serving),
    beforeDeploymentArns: [],
    beforeCurrentDeploymentArn: null,
    beforeActiveConfigurations: [legacyDescriptor],
    legacyBootstrapDescriptor: legacyDescriptor,
  } as any;
  const evidence = {
    service: 'ai-gateway', serviceArn, deploymentArn: DEPLOYMENT,
    targetRevisionArn: revisionArn, sourceSha: SHA_B, noOp: false,
  };
  const exactDeployment = {
    serviceDeployments: [{
      serviceDeploymentArn: DEPLOYMENT, serviceArn, status: 'SUCCESSFUL',
      targetServiceRevision: { arn: revisionArn }, createdAt: '2026-08-02T01:00:00.000Z',
    }],
  };

  it('accepts only the exact stable singleton when currentDeployment has settled to null', () => {
    assert.equal(validateOrphanMutationPlatform(
      orphanIntent, evidence, 'uat', exactDeployment, exactDeployment,
      recoveryService(serviceArn, serving, null), null,
    ).currentDeployment, null);
  });

  it('rejects pagination, a later deployment, a different pointer and multiple active builds', () => {
    const service = recoveryService(serviceArn, serving, null);
    assert.throws(() => validateOrphanMutationPlatform(
      orphanIntent, evidence, 'uat', exactDeployment, { ...exactDeployment, nextToken: 'more' }, service, null,
    ), /paginated/);
    assert.throws(() => validateOrphanMutationPlatform(
      orphanIntent, evidence, 'uat', exactDeployment, { serviceDeployments: [
        ...exactDeployment.serviceDeployments,
        { ...exactDeployment.serviceDeployments[0], serviceDeploymentArn: `${DEPLOYMENT}-new`, createdAt: '2026-08-02T01:01:00.000Z' },
      ] }, service, null,
    ), /unique newest/);
    assert.throws(() => validateOrphanMutationPlatform(
      orphanIntent, evidence, 'uat', exactDeployment, exactDeployment,
      recoveryService(serviceArn, serving, `${DEPLOYMENT}-different`), null,
    ), /different non-null/);
    const dual = recoveryService(serviceArn, serving, null);
    dual.service.activeConfigurations.push(previous);
    assert.throws(() => validateOrphanMutationPlatform(
      orphanIntent, evidence, 'uat', exactDeployment, exactDeployment, dual, null,
    ), /exclusively serve/);
  });

  it('normalizes only one controller-proved ECS-managed security group', () => {
    const withManaged = structuredClone(serving);
    withManaged.networkConfiguration.securityGroups.push('sg-0fedcba9876543210');
    const exactNetwork = {
      serviceArn,
      activeSecurityGroups: [...withManaged.networkConfiguration.securityGroups].sort(),
      requestedSecurityGroup: 'sg-0123456789abcdef0',
      managedSecurityGroup: 'sg-0fedcba9876543210',
      managedDescription: `Security group for ECS service: ${serviceArn}`,
    };
    assert.doesNotThrow(() => validateOrphanMutationPlatform(
      orphanIntent, evidence, 'uat', exactDeployment, exactDeployment,
      recoveryService(serviceArn, withManaged, null), exactNetwork,
    ));
    assert.throws(() => validateOrphanMutationPlatform(
      orphanIntent, evidence, 'uat', exactDeployment, exactDeployment,
      recoveryService(serviceArn, withManaged, null), { ...exactNetwork, managedDescription: 'lookalike' },
    ), /exclusively serve/);
  });
});

describe('pre-intent API and F2 serving-build validation', () => {
  const oldFull = activeConfiguration(REVISION, SHA_A);
  const fullService = recoveryService(SERVICE, oldFull, DEPLOYMENT);
  const fullDeployment = deploymentResponse();
  const stableFull = { service: fullService, deployment: fullDeployment, ssmServiceArn: SERVICE };

  it('accepts only stable old full/legacy singletons or exact absence', () => {
    const stored = validatePreIntentApiNoMutation('uat', SERVICE, SHA_B, stableFull, stableFull);
    assert.equal(stored.sourceSha, SHA_A);
    assert.doesNotThrow(() => validateStoredPreIntentReplay(stored, stored));
    assert.throws(
      () => validateStoredPreIntentReplay(stored, {
        ...stored,
        currentDeployment: `${DEPLOYMENT}-new`,
      }),
      /no longer matches fresh platform evidence/,
    );
    const oldShort = activeConfiguration(REVISION, SHA_A.slice(0, 12));
    const legacy = { service: recoveryService(SERVICE, oldShort, null), deployment: null, ssmServiceArn: SERVICE };
    assert.equal(validatePreIntentApiNoMutation('uat', SERVICE, SHA_B, legacy, legacy).sourceSha, SHA_A.slice(0, 12));
    const absent = { service: null, deployment: null, ssmServiceArn: null };
    assert.deepEqual(validatePreIntentApiNoMutation('uat', SERVICE, SHA_B, absent, absent), {
      serviceArn: null, currentDeployment: null, targetRevisionArn: null, sourceSha: null,
    });
  });

  it('rejects incoming-active, moving, malformed and SSM-mismatched state', () => {
    const incoming = activeConfiguration(REVISION, SHA_B);
    const incomingState = {
      service: recoveryService(SERVICE, incoming, DEPLOYMENT), deployment: fullDeployment, ssmServiceArn: SERVICE,
    };
    assert.throws(() => validatePreIntentApiNoMutation('uat', SERVICE, SHA_B, incomingState, incomingState), /incoming/);
    assert.throws(() => validatePreIntentApiNoMutation('uat', SERVICE, SHA_B, stableFull, {
      ...stableFull, ssmServiceArn: `${SERVICE}-wrong`,
    }), /moved/);
    const mismatch = { ...stableFull, ssmServiceArn: `${SERVICE}-wrong` };
    assert.throws(() => validatePreIntentApiNoMutation('uat', SERVICE, SHA_B, mismatch, mismatch), /not exact/);
    const malformed = { ...stableFull, service: recoveryService(SERVICE, oldFull, null), deployment: null };
    assert.throws(() => validatePreIntentApiNoMutation('uat', SERVICE, SHA_B, malformed, malformed), /settled deployment evidence/);
  });

  it('pins F2 to one successful full-SHA deployment and rejects legacy serving state', () => {
    assert.equal(validateCurrentApiBuildState(fullService, fullDeployment, SERVICE, SHA_A).buildReleaseId, SHA_A);
    assert.equal(validateCurrentApiBuildState(
      recoveryService(SERVICE, oldFull, null), fullDeployment, SERVICE, SHA_A,
    ).currentDeployment, DEPLOYMENT);
    assert.throws(() => validateCurrentApiBuildState(
      recoveryService(SERVICE, oldFull, null), { ...fullDeployment, nextToken: 'more' }, SERVICE, SHA_A,
    ), /paginated/);
    const legacy = recoveryService(SERVICE, activeConfiguration(REVISION, SHA_A.slice(0, 12)), null);
    assert.throws(() => validateCurrentApiBuildState(legacy, { serviceDeployments: [] }, SERVICE, SHA_A), /exact single full SHA/);
  });
});

describe('retirement platform identity validation', () => {
  it('accepts only the exact terminal deployment and serving manifest', () => {
    assert.deepEqual(validateRetirementPlatformState(deploymentResponse(), deploymentHistory(), serviceResponse(), expected), {
      deploymentStatus: 'SUCCESSFUL',
      currentDeployment: DEPLOYMENT,
      active: [{ revision: REVISION, sha: SHA_A }],
    });
  });

  it('rejects zero/multiple deployments, a newer current deployment and a moved build', () => {
    assert.throws(() => validateRetirementPlatformState({ serviceDeployments: [] }, deploymentHistory(), serviceResponse(), expected), /zero or multiple/);
    assert.throws(() => validateRetirementPlatformState({ serviceDeployments: [{}, {}] }, deploymentHistory(), serviceResponse(), expected), /zero or multiple/);
    assert.throws(() => validateRetirementPlatformState(deploymentResponse(), deploymentHistory(), serviceResponse(undefined, `${DEPLOYMENT}-new`), expected), /different service deployment/);
    assert.throws(() => validateRetirementPlatformState(
      deploymentResponse(), deploymentHistory(), serviceResponse([activeConfiguration(REVISION, SHA_B)]), expected,
    ), /active ECS Express builds moved/);
    const draining = serviceResponse();
    draining.service.status.statusCode = 'DRAINING';
    assert.throws(() => validateRetirementPlatformState(deploymentResponse(), deploymentHistory(), draining, expected), /service identity/);
    assert.throws(() => validateRetirementPlatformState(
      deploymentResponse(), deploymentHistory({ nextToken: 'more' }), serviceResponse(), expected,
    ), /paginated/);
    assert.throws(() => validateRetirementPlatformState(
      deploymentResponse(), { serviceDeployments: [
        ...deploymentResponse().serviceDeployments,
        { ...deploymentResponse().serviceDeployments[0], serviceDeploymentArn: `${DEPLOYMENT}-new`, createdAt: '2026-08-02T01:01:00.000Z' },
      ] }, serviceResponse(), expected,
    ), /unique latest/);
  });

  it('requires a successful target to remain active but permits an exact successful rollback survivor', () => {
    const survivor = 'arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-uat/api-web/rev-old';
    const rolledBack = serviceResponse([activeConfiguration(survivor, SHA_A)]);
    assert.throws(() => validateRetirementPlatformState(
      deploymentResponse(), deploymentHistory(), rolledBack, expected,
    ), /target revision is no longer serving/);
    assert.equal(validateRetirementPlatformState(
      deploymentResponse('ROLLBACK_SUCCESSFUL'), deploymentHistory(), rolledBack, expected,
    ).deploymentStatus, 'ROLLBACK_SUCCESSFUL');
    assert.equal(validateRetirementPlatformState(
      deploymentResponse(), deploymentHistory(), serviceResponse(undefined, null), expected,
    ).currentDeployment, null);
  });
});

describe('recovered SSM identity compare-and-set', { concurrency: false }, () => {
  it('uses create-only repair and refuses a conflicting value that wins the race', async () => {
    const previousFetch = globalThis.fetch;
    const previousRelative = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
    const expectedArn = SERVICE;
    const observedPutBodies: Array<Record<string, unknown>> = [];
    let ssmValue = expectedArn;
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = '/v2/credentials/recovery-test';
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('http://169.254.170.2/')) {
        return new Response(JSON.stringify({
          AccessKeyId: 'ASIARECOVERYTEST1234',
          SecretAccessKey: 'secret',
          Token: 'token',
        }), { status: 200 });
      }
      const target = String((init?.headers as Record<string, string> | undefined)?.['x-amz-target'] ?? '');
      if (target.endsWith('.PutParameter')) {
        observedPutBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response('{"__type":"ParameterAlreadyExists"}', { status: 400 });
      }
      if (target.endsWith('.GetParameter')) {
        return new Response(JSON.stringify({ Parameter: { Value: ssmValue } }), { status: 200 });
      }
      return new Response('unexpected request', { status: 500 });
    }) as typeof fetch;
    try {
      await ensureRecoveredSsmIdentity(
        'ap-southeast-1', '/watchdog-bms/uat/ecs-express-api-web-service-arn', expectedArn, true,
      );
      assert.deepEqual(observedPutBodies, [{
        Name: '/watchdog-bms/uat/ecs-express-api-web-service-arn',
        Type: 'String',
        Value: expectedArn,
        Overwrite: false,
      }]);

      ssmValue = SERVICE.replace('/api-web', '/different-service');
      await assert.rejects(
        () => ensureRecoveredSsmIdentity(
          'ap-southeast-1', '/watchdog-bms/uat/ecs-express-api-web-service-arn', expectedArn, true,
        ),
        /not stably exact/,
      );
    } finally {
      globalThis.fetch = previousFetch;
      if (previousRelative === undefined) delete process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
      else process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = previousRelative;
    }
  });
});

describe('child outcome classification', () => {
  it('keeps executor identity on the parent and scopes target identity to cleanup children', () => {
    const base = { GIT_SHA: SHA_B, DEPLOY_ENVIRONMENT: 'uat', KEEP: 'yes' };
    const child = recoveryTargetChildEnvironment(base, 'uat', SHA_A);
    assert.equal(base.GIT_SHA, SHA_B, 'the recovery executor identity was mutated');
    assert.equal(child.GIT_SHA, SHA_A);
    assert.equal(child.DEPLOY_ENVIRONMENT, 'uat');
    assert.equal(child.KEEP, 'yes');
    assert.throws(() => recoveryTargetChildEnvironment(base, 'uat', 'short'), /full lowercase SHA/);
  });

  it('rejects an observed interrupt synchronously before spawning a mutating child', async () => {
    let childObserved = false;
    await assert.rejects(
      () => runChild('exit 0', () => { childObserved = true; }, () => {
        throw new RemoteReleaseOperationInterrupted('operation interrupted before child launch');
      }),
      /interrupted before child launch/,
    );
    assert.equal(childObserved, false, 'no child process was launched or exposed after the interrupt');
  });

  it('accepts only the exact mode-owned GitHub controller and reserves manual for reconciliation', () => {
    assert.doesNotThrow(() => validateGithubControllerWorkflow(
      'example/watchdog',
      'example/watchdog/.github/workflows/deploy-uat.yml@refs/heads/main',
      'uat',
      'release',
    ));
    assert.throws(() => validateGithubControllerWorkflow(
      'example/watchdog',
      'example/watchdog/.github/workflows/ci.yml@refs/heads/main',
      'uat',
      'release',
    ), /must be controlled by/);
    assert.doesNotThrow(() => validateGithubControllerWorkflow(
      'example/watchdog',
      'example/watchdog/.github/workflows/recover-release-intent.yml@refs/heads/main',
      'uat',
      'release-pre-intent-recover',
    ));
    assert.throws(() => validateGithubControllerWorkflow(
      'example/watchdog',
      'example/watchdog/.github/workflows/f2-normalize-apply.yml@refs/heads/main',
      'uat',
      'f2-plan',
    ), /must be controlled by/);
    for (const mode of ['release', 'release-prepare', 'release-intent', 'release-bind',
      'release-finalize', 'retire', 'reconcile', 'm01-live', 'operation-reconcile']) {
      for (const workflow of ['deploy-production.yml', 'deploy-production-v2.yml']) {
        assert.doesNotThrow(() => validateGithubControllerWorkflow(
          'example/watchdog',
          `example/watchdog/.github/workflows/${workflow}@refs/heads/main`,
          'production',
          mode,
        ), `${mode}:${workflow}`);
      }
    }
    assert.throws(() => validateGithubControllerWorkflow(
      'example/watchdog',
      'example/watchdog/.github/workflows/deploy-production-v2.yml@refs/heads/main',
      'uat',
      'release-prepare',
    ), /must be controlled by/);
    assert.throws(() => validateManualControllerMode('release'), /only for audited operation-reconcile/);
    assert.doesNotThrow(() => validateManualControllerMode('operation-reconcile'));
  });

  it('never frees a mutating lane merely because its child exited non-zero', () => {
    for (const mode of ['release', 'f2-apply', 'retire', 'reconcile', 'm01-live']) {
      assert.equal(classifyChildOutcome(mode, { code: 1, signal: null }), 'UNKNOWN', mode);
    }
    assert.equal(classifyChildOutcome('release', { code: null, signal: 'SIGKILL' }), 'UNKNOWN');
  });

  it('accepts exit zero and treats failed read-only plan/verify as confirmed failures', () => {
    assert.equal(classifyChildOutcome('release', { code: 0, signal: null }), 'SUCCEEDED');
    assert.equal(classifyChildOutcome('f2-plan', { code: 2, signal: null }), 'FAILED_CONFIRMED');
    assert.equal(classifyChildOutcome('f2-verify', { code: 2, signal: null }), 'FAILED_CONFIRMED');
    assert.equal(classifyChildOutcome('reconcile', { code: 0, signal: null }, true), 'FAILED_CONFIRMED');
    assert.equal(classifyChildOutcome('reconcile', { code: 0, signal: null }, false), 'SUCCEEDED');
  });

  it('lets parallel deployment binders serialize on the parent row without taking the global writer fence', () => {
    assert.equal(needsRemoteWriterFence('release-bind'), false);
    for (const mode of ['release', 'release-finalize', 'release-intent-recover', 'release-pre-intent-recover', 'f2-apply', 'retire', 'reconcile']) {
      assert.equal(needsRemoteWriterFence(mode), true, mode);
    }
  });
});
