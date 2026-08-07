-- Item 15A Phase 2: CrmInboxPolicy (per-company first-response SLA settings)
CREATE TABLE "CrmInboxPolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "firstResponseMinutes" INTEGER NOT NULL DEFAULT 30,
    "businessHoursJson" JSONB,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmInboxPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrmInboxPolicy_companyId_key" ON "CrmInboxPolicy"("companyId");

ALTER TABLE "CrmInboxPolicy" ADD CONSTRAINT "CrmInboxPolicy_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
