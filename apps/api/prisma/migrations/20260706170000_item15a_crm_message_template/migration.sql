-- Item 15A Phase 2: CrmMessageTemplate (quick replies)
CREATE TYPE "CrmMessageTemplateStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "CrmMessageTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "category" TEXT,
    "variablesJson" JSONB,
    "status" "CrmMessageTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmMessageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmMessageTemplate_companyId_status_idx" ON "CrmMessageTemplate"("companyId", "status");

-- Spec: unique(companyId,title) where active — partial unique index (Prisma cannot express this)
CREATE UNIQUE INDEX "CrmMessageTemplate_companyId_title_active_key"
    ON "CrmMessageTemplate"("companyId", "title")
    WHERE "status" = 'ACTIVE';

ALTER TABLE "CrmMessageTemplate" ADD CONSTRAINT "CrmMessageTemplate_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
