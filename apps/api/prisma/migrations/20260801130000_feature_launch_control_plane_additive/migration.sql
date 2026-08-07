-- CreateEnum
CREATE TYPE "EntitlementTransitionAction" AS ENUM ('ENABLE', 'DISABLE_REQUESTED', 'OFF');

-- CreateEnum
CREATE TYPE "CompanyEntitlementNormalizationStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FeatureLaunchGateState" AS ENUM ('CLOSED', 'OPEN');

-- CreateEnum
CREATE TYPE "FeatureLaunchGateAction" AS ENUM ('OPEN', 'CLOSE');

-- CreateEnum
CREATE TYPE "FeatureLaunchRouteClass" AS ENUM ('ORDINARY', 'SPECIALIST_LEGAL');

-- CreateEnum
CREATE TYPE "ExecutionAttemptStatus" AS ENUM ('QUEUED', 'CLAIMED', 'DISPATCHING', 'SUCCEEDED', 'HANDED_OFF', 'SUPPRESSED_FEATURE_DISABLED', 'SKIPPED_FEATURE_DISABLED', 'SUPPRESSED_LAUNCH_GATE_CLOSED', 'SKIPPED_LAUNCH_GATE_CLOSED', 'UNKNOWN_EXTERNAL_OUTCOME', 'POISONED');

-- CreateEnum
CREATE TYPE "BackfillRunStatus" AS ENUM ('AUTHORIZED', 'MATERIALIZED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BackfillRunItemStatus" AS ENUM ('PENDING', 'APPLIED', 'SKIPPED', 'NEEDS_REVIEW');

-- AlterTable
ALTER TABLE "CompanyFeatureEntitlement" ADD COLUMN     "epoch" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "grantOrigin" TEXT,
ADD COLUMN     "lastSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CompanyEntitlementSet" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "setVersion" INTEGER NOT NULL DEFAULT 0,
    "lastTransitionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyEntitlementSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementCommand" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "payloadFingerprint" TEXT NOT NULL,
    "expectedSetVersion" INTEGER NOT NULL,
    "resultSetVersion" INTEGER NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntitlementCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementTransition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "epoch" INTEGER NOT NULL,
    "commandId" TEXT NOT NULL,
    "action" "EntitlementTransitionAction" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reasonJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntitlementTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunoffSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "disableSeq" INTEGER NOT NULL,
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "rootsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunoffSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyEntitlementNormalization" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "CompanyEntitlementNormalizationStatus" NOT NULL DEFAULT 'STARTED',
    "snapshotHash" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyEntitlementNormalization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureLaunchGate" (
    "gateKey" TEXT NOT NULL,
    "routeKey" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "state" "FeatureLaunchGateState" NOT NULL DEFAULT 'CLOSED',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureLaunchGate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureLaunchGateTransition" (
    "id" TEXT NOT NULL,
    "gateKey" TEXT NOT NULL,
    "routeKey" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL,
    "commandId" TEXT NOT NULL,
    "action" "FeatureLaunchGateAction" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "payloadFingerprint" TEXT NOT NULL,
    "reason" TEXT,
    "targetEnvironment" TEXT NOT NULL,
    "buildReleaseId" TEXT NOT NULL,
    "expectedGeneration" INTEGER NOT NULL,
    "routeClass" "FeatureLaunchRouteClass" NOT NULL,
    "validationEvidenceRef" TEXT,
    "validationEvidenceHash" TEXT,
    "specialistApprovedByUserId" TEXT,
    "releaseApprovedByUserId" TEXT,
    "emergencyClose" BOOLEAN NOT NULL DEFAULT false,
    "emergencyAuthorityUserId" TEXT,
    "incidentRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureLaunchGateTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionAttempt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "attemptSeq" INTEGER NOT NULL DEFAULT 1,
    "attemptKey" TEXT NOT NULL,
    "status" "ExecutionAttemptStatus" NOT NULL DEFAULT 'QUEUED',
    "entitlementEpochsJson" JSONB NOT NULL,
    "launchEntriesJson" JSONB NOT NULL,
    "availabilityVectorHash" TEXT NOT NULL,
    "retainedArtifactPolicy" TEXT,
    "claimedAt" TIMESTAMP(3),
    "dispatchToken" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "providerRequestRef" TEXT,
    "providerLastCheckedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "terminalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackfillRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "confirmationSource" TEXT NOT NULL DEFAULT 'FEATURE_ENABLE',
    "authorizationFingerprint" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "policyVersionsJson" JSONB NOT NULL,
    "authorizedSourceTypesJson" JSONB NOT NULL,
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "itemSetHash" TEXT,
    "sourceCountsJson" JSONB,
    "status" "BackfillRunStatus" NOT NULL DEFAULT 'AUTHORIZED',
    "checkpointJson" JSONB,
    "errorSummary" TEXT,
    "parentRunId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackfillRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackfillRunItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" TEXT,
    "status" "BackfillRunItemStatus" NOT NULL DEFAULT 'PENDING',
    "resultRef" TEXT,
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackfillRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyEntitlementSet_companyId_key" ON "CompanyEntitlementSet"("companyId");

-- CreateIndex
CREATE INDEX "EntitlementCommand_companyId_createdAt_idx" ON "EntitlementCommand"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EntitlementCommand_companyId_commandId_key" ON "EntitlementCommand"("companyId", "commandId");

-- CreateIndex
CREATE INDEX "EntitlementTransition_companyId_createdAt_idx" ON "EntitlementTransition"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EntitlementTransition_companyId_featureKey_seq_key" ON "EntitlementTransition"("companyId", "featureKey", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "EntitlementTransition_companyId_featureKey_commandId_key" ON "EntitlementTransition"("companyId", "featureKey", "commandId");

-- CreateIndex
CREATE INDEX "RunoffSnapshot_companyId_featureKey_idx" ON "RunoffSnapshot"("companyId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "RunoffSnapshot_companyId_featureKey_disableSeq_key" ON "RunoffSnapshot"("companyId", "featureKey", "disableSeq");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyEntitlementNormalization_companyId_key" ON "CompanyEntitlementNormalization"("companyId");

-- CreateIndex
CREATE INDEX "CompanyEntitlementNormalization_status_idx" ON "CompanyEntitlementNormalization"("status");

-- CreateIndex
CREATE INDEX "FeatureLaunchGate_state_idx" ON "FeatureLaunchGate"("state");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureLaunchGate_gateKey_routeKey_key" ON "FeatureLaunchGate"("gateKey", "routeKey");

-- CreateIndex
CREATE INDEX "FeatureLaunchGateTransition_gateKey_routeKey_createdAt_idx" ON "FeatureLaunchGateTransition"("gateKey", "routeKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureLaunchGateTransition_gateKey_routeKey_seq_key" ON "FeatureLaunchGateTransition"("gateKey", "routeKey", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureLaunchGateTransition_gateKey_routeKey_commandId_key" ON "FeatureLaunchGateTransition"("gateKey", "routeKey", "commandId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionAttempt_attemptKey_key" ON "ExecutionAttempt"("attemptKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionAttempt_dispatchToken_key" ON "ExecutionAttempt"("dispatchToken");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_companyId_status_createdAt_idx" ON "ExecutionAttempt"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_status_leaseExpiresAt_idx" ON "ExecutionAttempt"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_status_terminalAt_idx" ON "ExecutionAttempt"("status", "terminalAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionAttempt_sourceType_sourceId_attemptSeq_key" ON "ExecutionAttempt"("sourceType", "sourceId", "attemptSeq");

-- CreateIndex
CREATE INDEX "BackfillRun_companyId_featureKey_status_idx" ON "BackfillRun"("companyId", "featureKey", "status");

-- CreateIndex
CREATE INDEX "BackfillRun_status_createdAt_idx" ON "BackfillRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BackfillRun_companyId_commandId_key" ON "BackfillRun"("companyId", "commandId");

-- CreateIndex
CREATE INDEX "BackfillRunItem_companyId_status_idx" ON "BackfillRunItem"("companyId", "status");

-- CreateIndex
CREATE INDEX "BackfillRunItem_runId_status_idx" ON "BackfillRunItem"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BackfillRunItem_runId_sourceType_sourceId_key" ON "BackfillRunItem"("runId", "sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "CompanyEntitlementSet" ADD CONSTRAINT "CompanyEntitlementSet_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementCommand" ADD CONSTRAINT "EntitlementCommand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementTransition" ADD CONSTRAINT "EntitlementTransition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunoffSnapshot" ADD CONSTRAINT "RunoffSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyEntitlementNormalization" ADD CONSTRAINT "CompanyEntitlementNormalization_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionAttempt" ADD CONSTRAINT "ExecutionAttempt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackfillRun" ADD CONSTRAINT "BackfillRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackfillRun" ADD CONSTRAINT "BackfillRun_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "BackfillRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackfillRunItem" ADD CONSTRAINT "BackfillRunItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackfillRunItem" ADD CONSTRAINT "BackfillRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BackfillRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

