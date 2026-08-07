-- CreateEnum
CREATE TYPE "WorkflowTriggerType" AS ENUM ('EVENT', 'SCHEDULE', 'THRESHOLD_SCAN', 'SLA_SCAN', 'MANUAL_TEST', 'MANUAL_REPLAY');

-- CreateEnum
CREATE TYPE "WorkflowTemplateStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "WorkflowRuleStatus" AS ENUM ('DRAFT', 'ENABLED', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkflowEventInboxStatus" AS ENUM ('RECEIVED', 'MATCHED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL_FAILED', 'FAILED', 'SKIPPED', 'CANCELED');

-- CreateEnum
CREATE TYPE "WorkflowActionRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'DEAD_LETTERED', 'SKIPPED', 'CANCELED');

-- CreateEnum
CREATE TYPE "WorkflowTaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "WorkflowTaskStatus" AS ENUM ('OPEN', 'SNOOZED', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "WorkflowDeadLetterResolutionStatus" AS ENUM ('OPEN', 'REPLAYED', 'IGNORED', 'RESOLVED_EXTERNALLY');

-- CreateEnum
CREATE TYPE "WorkflowWebhookStatus" AS ENUM ('DISABLED', 'ENABLED');

-- CreateTable
CREATE TABLE "WorkflowTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "triggerType" "WorkflowTriggerType" NOT NULL,
    "defaultConditionJson" JSONB NOT NULL,
    "defaultActionJson" JSONB NOT NULL,
    "requiredPermissions" JSONB NOT NULL DEFAULT '[]',
    "requiredSourceModules" JSONB NOT NULL DEFAULT '[]',
    "defaultEnabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "WorkflowTemplateStatus" NOT NULL DEFAULT 'UNAVAILABLE',
    "unavailableReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "templateId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkflowRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "triggerType" "WorkflowTriggerType" NOT NULL,
    "triggerConfigJson" JSONB NOT NULL DEFAULT '{}',
    "conditionJson" JSONB NOT NULL,
    "actionJson" JSONB NOT NULL,
    "recipientConfigJson" JSONB NOT NULL DEFAULT '{}',
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 3600,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "enabledByUserId" TEXT,
    "enabledAt" TIMESTAMP(3),
    "disabledByUserId" TEXT,
    "disabledAt" TIMESTAMP(3),
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRuleVersion" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "WorkflowRuleStatus" NOT NULL,
    "triggerSnapshotJson" JSONB NOT NULL,
    "conditionSnapshotJson" JSONB NOT NULL,
    "actionSnapshotJson" JSONB NOT NULL,
    "recipientSnapshotJson" JSONB NOT NULL,
    "cooldownSeconds" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEventInbox" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" TEXT,
    "payloadJson" JSONB NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "status" "WorkflowEventInboxStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "WorkflowEventInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "triggerType" "WorkflowTriggerType" NOT NULL,
    "triggerEventId" TEXT,
    "sourceModule" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "dedupKey" TEXT NOT NULL,
    "conditionResultJson" JSONB NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowActionRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionConfigSnapshotJson" JSONB NOT NULL,
    "status" "WorkflowActionRunStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "resultJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowActionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTask" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "workflowActionRunId" TEXT,
    "sourceModule" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeUserId" TEXT,
    "assigneeRole" TEXT,
    "priority" "WorkflowTaskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "WorkflowTaskStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "webDeepLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowDeadLetter" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "workflowActionRunId" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "errorDetailsJson" JSONB,
    "resolutionStatus" "WorkflowDeadLetterResolutionStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowDeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowWebhookEndpoint" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "WorkflowWebhookStatus" NOT NULL DEFAULT 'DISABLED',
    "allowedEventTypes" JSONB NOT NULL DEFAULT '[]',
    "secretRef" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowWebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTemplate_key_key" ON "WorkflowTemplate"("key");

-- CreateIndex
CREATE INDEX "WorkflowTemplate_status_idx" ON "WorkflowTemplate"("status");

-- CreateIndex
CREATE INDEX "WorkflowRule_companyId_status_triggerType_idx" ON "WorkflowRule"("companyId", "status", "triggerType");

-- CreateIndex
CREATE INDEX "WorkflowRule_companyId_templateId_idx" ON "WorkflowRule"("companyId", "templateId");

-- CreateIndex
CREATE INDEX "WorkflowRuleVersion_companyId_idx" ON "WorkflowRuleVersion"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRuleVersion_ruleId_version_key" ON "WorkflowRuleVersion"("ruleId", "version");

-- CreateIndex
CREATE INDEX "WorkflowEventInbox_companyId_status_eventType_idx" ON "WorkflowEventInbox"("companyId", "status", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowEventInbox_companyId_eventId_key" ON "WorkflowEventInbox"("companyId", "eventId");

-- CreateIndex
CREATE INDEX "WorkflowRun_companyId_status_createdAt_idx" ON "WorkflowRun"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_companyId_ruleId_createdAt_idx" ON "WorkflowRun"("companyId", "ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_companyId_sourceModule_sourceType_sourceId_idx" ON "WorkflowRun"("companyId", "sourceModule", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_companyId_ruleVersionId_dedupKey_key" ON "WorkflowRun"("companyId", "ruleVersionId", "dedupKey");

-- CreateIndex
CREATE INDEX "WorkflowActionRun_companyId_status_nextAttemptAt_idx" ON "WorkflowActionRun"("companyId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WorkflowActionRun_workflowRunId_idx" ON "WorkflowActionRun"("workflowRunId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowActionRun_companyId_actionType_idempotencyKey_key" ON "WorkflowActionRun"("companyId", "actionType", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WorkflowTask_companyId_assigneeUserId_status_idx" ON "WorkflowTask"("companyId", "assigneeUserId", "status");

-- CreateIndex
CREATE INDEX "WorkflowTask_companyId_status_priority_idx" ON "WorkflowTask"("companyId", "status", "priority");

-- CreateIndex
CREATE INDEX "WorkflowTask_companyId_sourceModule_sourceType_sourceId_idx" ON "WorkflowTask"("companyId", "sourceModule", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "WorkflowDeadLetter_companyId_resolutionStatus_idx" ON "WorkflowDeadLetter"("companyId", "resolutionStatus");

-- CreateIndex
CREATE INDEX "WorkflowWebhookEndpoint_companyId_status_idx" ON "WorkflowWebhookEndpoint"("companyId", "status");

-- AddForeignKey
ALTER TABLE "WorkflowRule" ADD CONSTRAINT "WorkflowRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRule" ADD CONSTRAINT "WorkflowRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkflowTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRuleVersion" ADD CONSTRAINT "WorkflowRuleVersion_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "WorkflowRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEventInbox" ADD CONSTRAINT "WorkflowEventInbox_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "WorkflowRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "WorkflowRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowActionRun" ADD CONSTRAINT "WorkflowActionRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowActionRun" ADD CONSTRAINT "WorkflowActionRun_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDeadLetter" ADD CONSTRAINT "WorkflowDeadLetter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDeadLetter" ADD CONSTRAINT "WorkflowDeadLetter_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDeadLetter" ADD CONSTRAINT "WorkflowDeadLetter_workflowActionRunId_fkey" FOREIGN KEY ("workflowActionRunId") REFERENCES "WorkflowActionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowWebhookEndpoint" ADD CONSTRAINT "WorkflowWebhookEndpoint_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
