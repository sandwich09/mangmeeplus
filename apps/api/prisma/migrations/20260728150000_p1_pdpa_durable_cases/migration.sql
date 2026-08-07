CREATE TYPE "CrmDataSubjectRequestStatus" AS ENUM (
  'RECEIVED',
  'PROCESSING',
  'COMPLETED',
  'COMPLETED_WITH_EXCEPTION',
  'FAILED_RETRYABLE',
  'FAILED',
  'REJECTED'
);

CREATE TABLE "CrmDataSubjectRequest" (
  "id" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "requestType" TEXT NOT NULL DEFAULT 'ERASURE',
  "status" "CrmDataSubjectRequestStatus" NOT NULL DEFAULT 'RECEIVED',
  "source" TEXT NOT NULL DEFAULT 'CRM_CUSTOMER',
  "reasonProvided" BOOLEAN NOT NULL DEFAULT false,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "resultJson" JSONB,
  "notificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CrmDataSubjectRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CrmDataSubjectRequest_companyId_customerId_fkey"
    FOREIGN KEY ("companyId", "customerId")
    REFERENCES "CrmCustomer"("companyId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CrmDataSubjectRequest_requestKey_key"
  ON "CrmDataSubjectRequest"("requestKey");
CREATE INDEX "CrmDataSubjectRequest_status_nextAttemptAt_requestedAt_idx"
  ON "CrmDataSubjectRequest"("status", "nextAttemptAt", "requestedAt");
CREATE INDEX "CrmDataSubjectRequest_companyId_customerId_requestedAt_idx"
  ON "CrmDataSubjectRequest"("companyId", "customerId", "requestedAt");
