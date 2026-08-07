-- U1 — durable per-environment operation lease for remote release, F2 and retirement writers.
--
-- The session advisory lock remains the atomic mutating-operation fence. Parallel release-bind
-- metadata appends serialize on this parent row instead, so an `all` service wave cannot deadlock
-- itself. This row survives runner cancellation, task termination and lost terminal output.
-- RUNNING and UNKNOWN are both unresolved and share one partial unique slot per environment.
--
-- Additive and idempotent. The release wrapper bootstraps the same DDL before the first deployment's
-- `prisma migrate deploy`, avoiding the otherwise circular dependency where the wrapper needs the
-- table in order to run the migration that creates it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RemoteReleaseOperationStatus') THEN
    CREATE TYPE "RemoteReleaseOperationStatus" AS ENUM (
      'RUNNING',
      'UNKNOWN',
      'SUCCEEDED',
      'FAILED_CONFIRMED',
      'RECONCILED_SUCCEEDED',
      'RECONCILED_FAILED_CONFIRMED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RemoteReleaseMutationIntentStatus') THEN
    CREATE TYPE "RemoteReleaseMutationIntentStatus" AS ENUM (
      'OPEN',
      'BOUND',
      'CONFIRMED_NO_MUTATION'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "RemoteReleaseOperation" (
  "id"                        TEXT NOT NULL,
  "targetEnvironment"         TEXT NOT NULL,
  "mode"                      TEXT NOT NULL,
  "releaseDeployTarget"       TEXT,
  "buildReleaseId"            TEXT NOT NULL,
  "ecsTaskArn"                TEXT NOT NULL,
  "ecsServiceArn"             TEXT,
  "serviceDeploymentArn"      TEXT,
  "targetServiceRevisionArn"  TEXT,
  "activeBuildsJson"          JSONB,
  "deploymentManifestJson"   JSONB,
  "platformAuthorizedAt"      TIMESTAMP(3),
  "sourceBranch"              TEXT NOT NULL,
  "controllerKind"            TEXT NOT NULL,
  "githubRunId"               TEXT,
  "githubRunAttempt"          INTEGER,
  "githubActor"               TEXT,
  "githubActorId"             TEXT,
  "githubWorkflowRef"         TEXT,
  "githubRepository"          TEXT,
  "manualActorRef"            TEXT,
  "status"                    "RemoteReleaseOperationStatus" NOT NULL DEFAULT 'RUNNING',
  "leaseOwner"                TEXT NOT NULL,
  "heartbeatAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseExpiresAt"            TIMESTAMP(3) NOT NULL,
  "unknownAt"                 TIMESTAMP(3),
  "completedAt"               TIMESTAMP(3),
  "outcomeReason"             TEXT,
  "reconciledAt"              TIMESTAMP(3),
  "reconciledByActorRef"      TEXT,
  "reconciledByTaskArn"       TEXT,
  "reconciliationEvidenceRef" TEXT,
  "reconciliationReason"      TEXT,
  "preIntentApiCleanupCompletedAt" TIMESTAMP(3),
  "preIntentApiCleanupEvidenceJson" JSONB,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RemoteReleaseOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RemoteReleaseOperation_controller_provenance_check" CHECK (
    ("controllerKind" = 'GITHUB_ACTIONS'
      AND "githubRunId" IS NOT NULL AND "githubRunAttempt" IS NOT NULL
      AND "githubActor" IS NOT NULL AND "githubActorId" IS NOT NULL
      AND "githubWorkflowRef" IS NOT NULL AND "githubRepository" IS NOT NULL
      AND "manualActorRef" IS NULL)
    OR
    ("controllerKind" = 'MANUAL'
      AND "manualActorRef" IS NOT NULL
      AND "githubRunId" IS NULL AND "githubRunAttempt" IS NULL
      AND "githubActor" IS NULL AND "githubActorId" IS NULL
      AND "githubWorkflowRef" IS NULL AND "githubRepository" IS NULL)
  ),
  CONSTRAINT "RemoteReleaseOperation_deploy_target_check" CHECK (
    "releaseDeployTarget" IS NULL OR "releaseDeployTarget" IN ('all','api-web','ai-gateway','workers')
  )
);

-- Heal a bootstrap that created the table from an earlier copy of this additive migration.
ALTER TABLE "RemoteReleaseOperation"
  ADD COLUMN IF NOT EXISTS "ecsServiceArn"            TEXT,
  ADD COLUMN IF NOT EXISTS "releaseDeployTarget"       TEXT,
  ADD COLUMN IF NOT EXISTS "targetServiceRevisionArn" TEXT,
  ADD COLUMN IF NOT EXISTS "activeBuildsJson"          JSONB,
  ADD COLUMN IF NOT EXISTS "deploymentManifestJson"   JSONB,
  ADD COLUMN IF NOT EXISTS "platformAuthorizedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sourceBranch"              TEXT,
  ADD COLUMN IF NOT EXISTS "controllerKind"            TEXT,
  ADD COLUMN IF NOT EXISTS "githubRunId"               TEXT,
  ADD COLUMN IF NOT EXISTS "githubRunAttempt"          INTEGER,
  ADD COLUMN IF NOT EXISTS "githubActor"               TEXT,
  ADD COLUMN IF NOT EXISTS "githubActorId"             TEXT,
  ADD COLUMN IF NOT EXISTS "githubWorkflowRef"         TEXT,
  ADD COLUMN IF NOT EXISTS "githubRepository"          TEXT,
  ADD COLUMN IF NOT EXISTS "manualActorRef"            TEXT,
  ADD COLUMN IF NOT EXISTS "preIntentApiCleanupCompletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "preIntentApiCleanupEvidenceJson" JSONB;

-- The only possible pre-existing rows are from this release wrapper's pre-migration bootstrap.
-- Preserve them as explicitly unknown manual provenance; never invent a GitHub run.
UPDATE "RemoteReleaseOperation"
   SET "sourceBranch" = CASE WHEN "targetEnvironment" = 'uat' THEN 'develop' ELSE 'main' END,
       "controllerKind" = 'MANUAL',
       "manualActorRef" = 'legacy-bootstrap:unknown',
       "status" = CASE WHEN "status" = 'RUNNING' THEN 'UNKNOWN' ELSE "status" END,
       "unknownAt" = CASE WHEN "status" IN ('RUNNING', 'UNKNOWN') THEN CURRENT_TIMESTAMP ELSE "unknownAt" END,
       "outcomeReason" = CASE WHEN "status" IN ('RUNNING', 'UNKNOWN')
         THEN 'bootstrap row predates durable controller provenance; operator reconciliation required'
         ELSE COALESCE("outcomeReason", 'legacy bootstrap completed before controller provenance was captured')
       END
 WHERE "sourceBranch" IS NULL OR "controllerKind" IS NULL;

ALTER TABLE "RemoteReleaseOperation"
  ALTER COLUMN "sourceBranch" SET NOT NULL,
  ALTER COLUMN "controllerKind" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RemoteReleaseOperation_deploy_target_check') THEN
    ALTER TABLE "RemoteReleaseOperation" ADD CONSTRAINT "RemoteReleaseOperation_deploy_target_check"
      CHECK ("releaseDeployTarget" IS NULL OR "releaseDeployTarget" IN ('all','api-web','ai-gateway','workers'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RemoteReleaseOperation_controller_provenance_check'
  ) THEN
    ALTER TABLE "RemoteReleaseOperation"
      ADD CONSTRAINT "RemoteReleaseOperation_controller_provenance_check" CHECK (
        ("controllerKind" = 'GITHUB_ACTIONS'
          AND "githubRunId" IS NOT NULL AND "githubRunAttempt" IS NOT NULL
          AND "githubActor" IS NOT NULL AND "githubActorId" IS NOT NULL
          AND "githubWorkflowRef" IS NOT NULL AND "githubRepository" IS NOT NULL
          AND "manualActorRef" IS NULL)
        OR
        ("controllerKind" = 'MANUAL'
          AND "manualActorRef" IS NOT NULL
          AND "githubRunId" IS NULL AND "githubRunAttempt" IS NULL
          AND "githubActor" IS NULL AND "githubActorId" IS NULL
          AND "githubWorkflowRef" IS NULL AND "githubRepository" IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "RemoteReleaseOperation_targetEnvironment_status_idx"
  ON "RemoteReleaseOperation" ("targetEnvironment", "status");

CREATE INDEX IF NOT EXISTS "RemoteReleaseOperation_ecsTaskArn_idx"
  ON "RemoteReleaseOperation" ("ecsTaskArn");

CREATE INDEX IF NOT EXISTS "RemoteReleaseOperation_serviceDeploymentArn_idx"
  ON "RemoteReleaseOperation" ("serviceDeploymentArn");

-- Prisma cannot express a partial unique index. This is the database-level backstop behind the
-- advisory lock: UNKNOWN is intentionally included, so expiry never grants permission to continue.
CREATE UNIQUE INDEX IF NOT EXISTS "RemoteReleaseOperation_unresolved_environment_key"
  ON "RemoteReleaseOperation" ("targetEnvironment")
  WHERE "status" IN ('RUNNING', 'UNKNOWN');

CREATE TABLE IF NOT EXISTS "RemoteReleaseMutationIntent" (
  "id"                             TEXT NOT NULL,
  "operationId"                    TEXT NOT NULL,
  "targetEnvironment"              TEXT NOT NULL,
  "buildReleaseId"                 TEXT NOT NULL,
  "serviceKey"                     TEXT NOT NULL,
  "mutationKind"                   TEXT NOT NULL,
  "expectedServiceArn"             TEXT NOT NULL,
  "clusterName"                    TEXT NOT NULL,
  "serviceName"                    TEXT NOT NULL,
  "ssmParameterName"               TEXT NOT NULL,
  "requestHash"                    TEXT NOT NULL,
  "desiredConfigHash"              TEXT NOT NULL,
  "beforeDeploymentArnsJson"       JSONB NOT NULL,
  "beforeCurrentDeploymentArn"     TEXT,
  "beforeActiveConfigurationsJson" JSONB NOT NULL,
  "legacyBootstrapDescriptorJson"  JSONB,
  "preparedByTaskArn"              TEXT NOT NULL,
  "status"                         "RemoteReleaseMutationIntentStatus" NOT NULL DEFAULT 'OPEN',
  "evidenceJson"                   JSONB,
  "closedByTaskArn"                TEXT,
  "recovererControllerJson"        JSONB,
  "legacyRollbackObservedAt"       TIMESTAMP(3),
  "legacyRollbackCleanedAt"        TIMESTAMP(3),
  "failedBuildCleanupRequiredAt"   TIMESTAMP(3),
  "failedBuildCleanupCompletedAt"  TIMESTAMP(3),
  "legacyCutoverCompletedAt"       TIMESTAMP(3),
  "requestStartedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requestDeadlineAt"              TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '10 minutes'),
  "closedAt"                       TIMESTAMP(3),
  "createdAt"                      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RemoteReleaseMutationIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RemoteReleaseMutationIntent_operationId_fkey"
    FOREIGN KEY ("operationId") REFERENCES "RemoteReleaseOperation"("id") ON DELETE RESTRICT,
  CONSTRAINT "RemoteReleaseMutationIntent_service_key_check"
    CHECK ("serviceKey" IN ('api-web', 'ai-gateway', 'workers')),
  CONSTRAINT "RemoteReleaseMutationIntent_kind_check"
    CHECK ("mutationKind" IN ('CREATE', 'UPDATE')),
  CONSTRAINT "RemoteReleaseMutationIntent_hashes_check"
    CHECK ("buildReleaseId" ~ '^[0-9a-f]{40}$'
      AND "requestHash" ~ '^[0-9a-f]{64}$'
      AND "desiredConfigHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "RemoteReleaseMutationIntent_arrays_check"
    CHECK (jsonb_typeof("beforeDeploymentArnsJson") = 'array'
      AND jsonb_typeof("beforeActiveConfigurationsJson") = 'array')
);

CREATE INDEX IF NOT EXISTS "RemoteReleaseMutationIntent_operationId_status_idx"
  ON "RemoteReleaseMutationIntent" ("operationId", "status");
CREATE INDEX IF NOT EXISTS "RemoteReleaseMutationIntent_targetEnvironment_status_idx"
  ON "RemoteReleaseMutationIntent" ("targetEnvironment", "status");
CREATE INDEX IF NOT EXISTS "RemoteReleaseMutationIntent_expectedServiceArn_requestStartedAt_idx"
  ON "RemoteReleaseMutationIntent" ("expectedServiceArn", "requestStartedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "RemoteReleaseMutationIntent_open_service_key"
  ON "RemoteReleaseMutationIntent" ("operationId", "serviceKey")
  WHERE "status" = 'OPEN';
