-- Per-company screen setting "แสดงเมนูบันทึกด้วยมือบนเว็บ" (manual-expense-web-entry-flag spec §5.1).
-- Additive only: one new table, its unique index and its foreign key. Nothing existing is altered
-- and nothing is back-filled. A company without a row reads as the application's one default
-- (`MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW`), so the flag column has no database default: a row
-- always states its value. Not an entitlement — no permission, billing or LINE code reads this table.

-- CreateTable
CREATE TABLE "CompanyWebEntrySetting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "manualExpenseEntryEnabled" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedBySystemAdminUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyWebEntrySetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyWebEntrySetting_companyId_key" ON "CompanyWebEntrySetting"("companyId");

-- AddForeignKey
ALTER TABLE "CompanyWebEntrySetting" ADD CONSTRAINT "CompanyWebEntrySetting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
