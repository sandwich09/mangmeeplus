-- Income-expense-ledger spec F-LED-2 (M1 + M2): revenue-category master + line FK.
--
-- RevenueCategory is COMPANY-SCOPED ONLY — no global (NULL companyId) rows on purpose. The
-- expense-side union of global + per-company defaults produced near-duplicate pickers, and
-- `@@unique([companyId, name])` cannot fence NULL rows (Postgres treats every NULL as distinct;
-- documented at prisma/seed.ts DEFAULT_EXPENSE_CATEGORIES). With companyId NOT NULL the unique
-- below is a real fence, which also makes the 6-row bootstrap idempotent via skipDuplicates.
--
-- AccountingDocumentLine.revenueCategoryId is the live FK for pickers/reports;
-- the existing free-text `revenueCategory` column becomes the immutable NAME snapshot frozen at
-- issue time — the ledger keeps reading the string (journal.use-case categoryKey), unchanged.

-- CreateEnum
CREATE TYPE "RevenueCategoryStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "RevenueCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountHintKey" TEXT NOT NULL,
    "ledgerAccountCode" TEXT,
    "ledgerAccountReviewedByUserId" TEXT,
    "ledgerAccountReviewedAt" TIMESTAMP(3),
    "defaultOutputTaxCode" TEXT,
    "status" "RevenueCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RevenueCategory_companyId_name_key" ON "RevenueCategory"("companyId", "name");

-- CreateIndex
CREATE INDEX "RevenueCategory_companyId_status_idx" ON "RevenueCategory"("companyId", "status");

-- AddForeignKey
ALTER TABLE "RevenueCategory" ADD CONSTRAINT "RevenueCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "AccountingDocumentLine" ADD COLUMN "revenueCategoryId" TEXT;

-- CreateIndex
CREATE INDEX "AccountingDocumentLine_companyId_revenueCategoryId_idx" ON "AccountingDocumentLine"("companyId", "revenueCategoryId");

-- AddForeignKey
ALTER TABLE "AccountingDocumentLine" ADD CONSTRAINT "AccountingDocumentLine_revenueCategoryId_fkey" FOREIGN KEY ("revenueCategoryId") REFERENCES "RevenueCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
