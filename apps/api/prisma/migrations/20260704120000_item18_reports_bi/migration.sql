-- CreateEnum
CREATE TYPE "ReportViewVisibility" AS ENUM ('PRIVATE', 'COMPANY', 'ROLE', 'TEAM');

-- CreateEnum
CREATE TYPE "ReportRunStatus" AS ENUM ('READY', 'PARTIAL', 'EMPTY', 'FORBIDDEN', 'UNAVAILABLE', 'STALE', 'INVALID_FILTER', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportExportFormat" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "ReportExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReportDrilldownAccessResult" AS ENUM ('ALLOWED', 'DENIED');

-- CreateTable
CREATE TABLE "ReportView" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "datasetCode" TEXT NOT NULL,
    "datasetVersion" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "ReportViewVisibility" NOT NULL DEFAULT 'PRIVATE',
    "sharedRoleIdsJson" JSONB NOT NULL DEFAULT '[]',
    "sharedTeamIdsJson" JSONB NOT NULL DEFAULT '[]',
    "filtersJson" JSONB NOT NULL DEFAULT '{}',
    "dimensionsJson" JSONB NOT NULL DEFAULT '[]',
    "measuresJson" JSONB NOT NULL DEFAULT '[]',
    "sortJson" JSONB NOT NULL DEFAULT '[]',
    "chartConfigJson" JSONB NOT NULL DEFAULT '{}',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "invalidReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "datasetCode" TEXT NOT NULL,
    "datasetVersion" INTEGER NOT NULL DEFAULT 1,
    "viewId" TEXT,
    "status" "ReportRunStatus" NOT NULL,
    "filtersJson" JSONB NOT NULL DEFAULT '{}',
    "permissionSnapshotJson" JSONB NOT NULL DEFAULT '{}',
    "sourceScopeSnapshotJson" JSONB NOT NULL DEFAULT '{}',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3),
    "sourceFreshnessJson" JSONB NOT NULL DEFAULT '{}',
    "sourceRefsPreviewJson" JSONB NOT NULL DEFAULT '{}',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportExportRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "datasetCode" TEXT NOT NULL,
    "datasetVersion" INTEGER NOT NULL DEFAULT 1,
    "viewId" TEXT,
    "runId" TEXT,
    "format" "ReportExportFormat" NOT NULL,
    "status" "ReportExportStatus" NOT NULL DEFAULT 'QUEUED',
    "filtersJson" JSONB NOT NULL DEFAULT '{}',
    "columnConfigJson" JSONB NOT NULL DEFAULT '{}',
    "permissionSnapshotJson" JSONB NOT NULL DEFAULT '{}',
    "sourceScopeSnapshotJson" JSONB NOT NULL DEFAULT '{}',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "fileName" TEXT,
    "fileMimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "storageKey" TEXT,
    "sha256" TEXT,
    "expiresAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportExportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportDrilldownAccessLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "datasetCode" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "result" "ReportDrilldownAccessResult" NOT NULL,
    "reason" TEXT,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportDrilldownAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportView_companyId_ownerUserId_archivedAt_idx" ON "ReportView"("companyId", "ownerUserId", "archivedAt");

-- CreateIndex
CREATE INDEX "ReportView_companyId_datasetCode_idx" ON "ReportView"("companyId", "datasetCode");

-- CreateIndex
CREATE INDEX "ReportView_companyId_visibility_archivedAt_idx" ON "ReportView"("companyId", "visibility", "archivedAt");

-- CreateIndex
CREATE INDEX "ReportRun_companyId_requestedByUserId_createdAt_idx" ON "ReportRun"("companyId", "requestedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportRun_companyId_datasetCode_createdAt_idx" ON "ReportRun"("companyId", "datasetCode", "createdAt");

-- CreateIndex
CREATE INDEX "ReportRun_companyId_status_idx" ON "ReportRun"("companyId", "status");

-- CreateIndex
CREATE INDEX "ReportExportRequest_companyId_requestedByUserId_createdAt_idx" ON "ReportExportRequest"("companyId", "requestedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportExportRequest_companyId_datasetCode_createdAt_idx" ON "ReportExportRequest"("companyId", "datasetCode", "createdAt");

-- CreateIndex
CREATE INDEX "ReportExportRequest_companyId_status_expiresAt_idx" ON "ReportExportRequest"("companyId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "ReportDrilldownAccessLog_companyId_datasetCode_createdAt_idx" ON "ReportDrilldownAccessLog"("companyId", "datasetCode", "createdAt");

-- CreateIndex
CREATE INDEX "ReportDrilldownAccessLog_companyId_sourceModule_sourceType_s_idx" ON "ReportDrilldownAccessLog"("companyId", "sourceModule", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "ReportDrilldownAccessLog_companyId_userId_createdAt_idx" ON "ReportDrilldownAccessLog"("companyId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReportView" ADD CONSTRAINT "ReportView_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportExportRequest" ADD CONSTRAINT "ReportExportRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDrilldownAccessLog" ADD CONSTRAINT "ReportDrilldownAccessLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
