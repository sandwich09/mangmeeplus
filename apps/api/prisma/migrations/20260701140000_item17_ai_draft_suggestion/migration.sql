-- CreateEnum
CREATE TYPE "AiSuggestionDomain" AS ENUM ('CFO', 'SALES_CRM', 'INVENTORY', 'TAX_ACCOUNTING', 'WORKFLOW');

-- CreateEnum
CREATE TYPE "AiSuggestionAgent" AS ENUM ('CFO', 'SALES', 'CRM', 'INVENTORY', 'TAX', 'ACCOUNTING', 'WORKFLOW');

-- CreateEnum
CREATE TYPE "AiDraftRequestOrigin" AS ENUM ('WEB', 'LINE', 'WORKFLOW', 'SCHEDULE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AiDraftRequestStatus" AS ENUM ('QUEUED', 'GENERATING', 'READY', 'NEEDS_DATA', 'PROVIDER_UNAVAILABLE', 'FAILED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AiSuggestionStatus" AS ENUM ('NEW', 'IN_REVIEW', 'ACCEPTED_FOR_SOURCE_DRAFT', 'SOURCE_DRAFT_CREATED', 'DISMISSED', 'SUPERSEDED', 'EXPIRED', 'BLOCKED_BY_PERMISSION', 'BLOCKED_BY_SOURCE_STATE', 'FAILED');

-- CreateEnum
CREATE TYPE "AiDraftArtifactStatus" AS ENUM ('DRAFT', 'REGENERATED', 'LOCKED_FOR_REVIEW', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AiDraftArtifactType" AS ENUM ('TEXT', 'JSON_PAYLOAD', 'CHECKLIST', 'SOURCE_DRAFT_PAYLOAD');

-- CreateEnum
CREATE TYPE "AiCandidateActionType" AS ENUM ('CREATE_CRM_FOLLOW_UP_DRAFT', 'CREATE_ACCOUNTING_QUOTATION_DRAFT', 'CREATE_INVENTORY_REORDER_REVIEW', 'CREATE_INVENTORY_TRANSFER_OR_COUNT_REQUEST', 'CREATE_TAX_EVIDENCE_CHECKLIST', 'CREATE_TAX_CERTIFICATE_DRAFT', 'CREATE_WORKFLOW_TASK', 'CREATE_REVIEW_CHECKLIST', 'NO_SOURCE_DRAFT_AVAILABLE');

-- CreateEnum
CREATE TYPE "AiCandidateActionStatus" AS ENUM ('PROPOSED', 'VALIDATED', 'VALIDATION_FAILED', 'SOURCE_DRAFT_CREATED', 'REJECTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AiReviewDecision" AS ENUM ('ACCEPT_AS_SOURCE_DRAFT', 'REQUEST_REGENERATION', 'EDIT_AND_ACCEPT', 'DISMISS', 'MARK_NEEDS_DATA', 'MARK_NOT_USEFUL', 'ESCALATE_TO_OWNER');

-- CreateEnum
CREATE TYPE "AiRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "AiDraftRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "origin" "AiDraftRequestOrigin" NOT NULL,
    "agent" "AiSuggestionAgent" NOT NULL,
    "templateKey" TEXT NOT NULL,
    "sourceModule" TEXT,
    "sourceRecordType" TEXT,
    "sourceRecordId" TEXT,
    "sourceRefsJson" JSONB NOT NULL DEFAULT '{}',
    "requestedPromptPreview" TEXT,
    "requestedPromptHash" TEXT,
    "language" TEXT NOT NULL DEFAULT 'th-TH',
    "status" "AiDraftRequestStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiDraftRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "draftRequestId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "agent" "AiSuggestionAgent" NOT NULL,
    "domain" "AiSuggestionDomain" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "riskLevel" "AiRiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "status" "AiSuggestionStatus" NOT NULL DEFAULT 'NEW',
    "needsDataReasonsJson" JSONB NOT NULL DEFAULT '[]',
    "blockedReasonsJson" JSONB NOT NULL DEFAULT '[]',
    "sourceStateHash" TEXT,
    "sourceModule" TEXT,
    "sourceRecordType" TEXT,
    "sourceRecordId" TEXT,
    "candidateActionCount" INTEGER NOT NULL DEFAULT 0,
    "reviewOwnerUserId" TEXT,
    "assignedRole" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSuggestionCitation" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "sourceRecordType" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "sourceField" TEXT,
    "label" TEXT NOT NULL,
    "valuePreview" TEXT,
    "valueHash" TEXT,
    "webDeepLink" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSuggestionCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDraftArtifact" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "artifactType" "AiDraftArtifactType" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'th-TH',
    "contentPreview" TEXT,
    "contentHash" TEXT,
    "structuredContentJson" JSONB,
    "status" "AiDraftArtifactStatus" NOT NULL DEFAULT 'DRAFT',
    "modelProvider" TEXT,
    "modelName" TEXT,
    "modelVersion" TEXT,
    "tokenUsageJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDraftArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCandidateAction" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "artifactId" TEXT,
    "companyId" TEXT NOT NULL,
    "actionType" "AiCandidateActionType" NOT NULL,
    "targetModule" TEXT NOT NULL,
    "targetRecordType" TEXT,
    "targetRecordId" TEXT,
    "draftPayloadJson" JSONB NOT NULL DEFAULT '{}',
    "payloadHash" TEXT,
    "requiredPermissions" JSONB NOT NULL DEFAULT '[]',
    "riskLevel" "AiRiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "idempotencyKey" TEXT NOT NULL,
    "status" "AiCandidateActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "validationResultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCandidateAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSuggestionReview" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "candidateActionId" TEXT,
    "companyId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "decision" "AiReviewDecision" NOT NULL,
    "note" TEXT,
    "editedPayloadJson" JSONB,
    "createdSourceModule" TEXT,
    "createdSourceRecordType" TEXT,
    "createdSourceRecordId" TEXT,
    "sourceDraftDeepLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSuggestionReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiToolInvocationLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "suggestionId" TEXT,
    "agent" "AiSuggestionAgent" NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolCategory" TEXT NOT NULL,
    "inputPreview" TEXT,
    "inputHash" TEXT,
    "outputPreview" TEXT,
    "outputHash" TEXT,
    "sourceRefsJson" JSONB,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiToolInvocationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiDraftRequest_companyId_status_agent_idx" ON "AiDraftRequest"("companyId", "status", "agent");

-- CreateIndex
CREATE INDEX "AiDraftRequest_companyId_requesterUserId_status_idx" ON "AiDraftRequest"("companyId", "requesterUserId", "status");

-- CreateIndex
CREATE INDEX "AiDraftRequest_companyId_sourceModule_sourceRecordType_sour_idx" ON "AiDraftRequest"("companyId", "sourceModule", "sourceRecordType", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "AiDraftRequest_companyId_idempotencyKey_key" ON "AiDraftRequest"("companyId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiSuggestion_draftRequestId_key" ON "AiSuggestion"("draftRequestId");

-- CreateIndex
CREATE INDEX "AiSuggestion_companyId_status_domain_idx" ON "AiSuggestion"("companyId", "status", "domain");

-- CreateIndex
CREATE INDEX "AiSuggestion_companyId_agent_status_idx" ON "AiSuggestion"("companyId", "agent", "status");

-- CreateIndex
CREATE INDEX "AiSuggestion_companyId_reviewOwnerUserId_status_idx" ON "AiSuggestion"("companyId", "reviewOwnerUserId", "status");

-- CreateIndex
CREATE INDEX "AiSuggestion_companyId_sourceModule_sourceRecordType_source_idx" ON "AiSuggestion"("companyId", "sourceModule", "sourceRecordType", "sourceRecordId");

-- CreateIndex
CREATE INDEX "AiSuggestionCitation_suggestionId_idx" ON "AiSuggestionCitation"("suggestionId");

-- CreateIndex
CREATE INDEX "AiSuggestionCitation_companyId_sourceModule_sourceRecordTyp_idx" ON "AiSuggestionCitation"("companyId", "sourceModule", "sourceRecordType", "sourceRecordId");

-- CreateIndex
CREATE INDEX "AiDraftArtifact_suggestionId_idx" ON "AiDraftArtifact"("suggestionId");

-- CreateIndex
CREATE UNIQUE INDEX "AiDraftArtifact_suggestionId_version_key" ON "AiDraftArtifact"("suggestionId", "version");

-- CreateIndex
CREATE INDEX "AiCandidateAction_suggestionId_idx" ON "AiCandidateAction"("suggestionId");

-- CreateIndex
CREATE INDEX "AiCandidateAction_companyId_status_idx" ON "AiCandidateAction"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiCandidateAction_companyId_idempotencyKey_key" ON "AiCandidateAction"("companyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AiSuggestionReview_suggestionId_idx" ON "AiSuggestionReview"("suggestionId");

-- CreateIndex
CREATE INDEX "AiSuggestionReview_companyId_reviewerUserId_idx" ON "AiSuggestionReview"("companyId", "reviewerUserId");

-- CreateIndex
CREATE INDEX "AiToolInvocationLog_companyId_createdAt_idx" ON "AiToolInvocationLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AiToolInvocationLog_companyId_suggestionId_idx" ON "AiToolInvocationLog"("companyId", "suggestionId");

-- AddForeignKey
ALTER TABLE "AiDraftRequest" ADD CONSTRAINT "AiDraftRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_draftRequestId_fkey" FOREIGN KEY ("draftRequestId") REFERENCES "AiDraftRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestionCitation" ADD CONSTRAINT "AiSuggestionCitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestionCitation" ADD CONSTRAINT "AiSuggestionCitation_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "AiSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraftArtifact" ADD CONSTRAINT "AiDraftArtifact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraftArtifact" ADD CONSTRAINT "AiDraftArtifact_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "AiSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCandidateAction" ADD CONSTRAINT "AiCandidateAction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCandidateAction" ADD CONSTRAINT "AiCandidateAction_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "AiSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestionReview" ADD CONSTRAINT "AiSuggestionReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestionReview" ADD CONSTRAINT "AiSuggestionReview_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "AiSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiToolInvocationLog" ADD CONSTRAINT "AiToolInvocationLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

