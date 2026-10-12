ALTER TABLE "WhtCertificateHandoff" ADD COLUMN "certificateRound" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "WhtCertificateHistory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expenseId" TEXT,
    "handoffId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "certificateId" TEXT,
    "certificateNumber" TEXT,
    "isExternal" BOOLEAN NOT NULL,
    "certificateDate" TIMESTAMP(3),
    "relatedCertificateId" TEXT,
    "relatedCertificateNumber" TEXT,
    "reason" TEXT,
    "detailsJson" JSONB,
    "taxFilingAttested" BOOLEAN NOT NULL DEFAULT false,
    "actorUserId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhtCertificateHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhtCertificateHistory_companyId_expenseId_occurredAt_idx"
    ON "WhtCertificateHistory"("companyId", "expenseId", "occurredAt");
CREATE INDEX "WhtCertificateHistory_companyId_handoffId_idx"
    ON "WhtCertificateHistory"("companyId", "handoffId");
ALTER TABLE "WhtCertificateHistory" ADD CONSTRAINT "WhtCertificateHistory_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
