-- Item 10: Double-Entry Ledger and Period Closing

CREATE TYPE "LedgerAccountClass" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST', 'EXPENSE', 'TAX_EXPENSE', 'SUSPENSE');
CREATE TYPE "LedgerNormalBalance" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "LedgerAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "JournalEntryType" AS ENUM ('GENERATED', 'MANUAL', 'REVERSAL', 'OPENING_BALANCE', 'CLOSING');
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED', 'VOIDED');
CREATE TYPE "LedgerPeriodStatus" AS ENUM ('OPEN', 'CLOSING_REVIEW', 'CLOSED', 'REOPENED');
CREATE TYPE "PostingRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "PeriodCloseRunStatus" AS ENUM ('STARTED', 'PASSED', 'FAILED', 'CLOSED', 'REOPENED');

CREATE TABLE "ChartOfAccount" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "code" TEXT NOT NULL,
  "nameTh" TEXT NOT NULL,
  "nameEn" TEXT,
  "accountClass" "LedgerAccountClass" NOT NULL,
  "reportGroup" TEXT,
  "normalBalance" "LedgerNormalBalance" NOT NULL,
  "parentAccountId" TEXT,
  "isPosting" BOOLEAN NOT NULL DEFAULT true,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "isControlled" BOOLEAN NOT NULL DEFAULT false,
  "taxCategory" TEXT,
  "cashFlowCategory" TEXT,
  "sourceGroup1" TEXT,
  "sourceGroup2" TEXT,
  "status" "LedgerAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChartOfAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingPeriod" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "status" "LedgerPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "closedByUserId" TEXT,
  "closedAt" TIMESTAMP(3),
  "reopenedByUserId" TEXT,
  "reopenedAt" TIMESTAMP(3),
  "closeNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalEntry" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "entryNumber" TEXT NOT NULL,
  "entryType" "JournalEntryType" NOT NULL,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "reversalOfJournalEntryId" TEXT,
  "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
  "entryDate" DATE NOT NULL,
  "postedAt" TIMESTAMP(3),
  "postedByUserId" TEXT,
  "memo" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalLine" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "journalEntryId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "branchId" TEXT,
  "lineNumber" INTEGER NOT NULL,
  "description" TEXT,
  "debitAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "creditAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'THB',
  "sourceType" TEXT,
  "sourceId" TEXT,
  "taxCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostingRule" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "documentType" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "PostingRuleStatus" NOT NULL DEFAULT 'ACTIVE',
  "debitAccountId" TEXT,
  "creditAccountId" TEXT,
  "conditionJson" JSONB,
  "mappingJson" JSONB NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PostingRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PeriodCloseRun" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "status" "PeriodCloseRunStatus" NOT NULL DEFAULT 'STARTED',
  "checksJson" JSONB NOT NULL DEFAULT '[]',
  "requestedByUserId" TEXT NOT NULL,
  "completedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "PeriodCloseRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChartOfAccount_companyId_code_key" ON "ChartOfAccount"("companyId", "code");
CREATE INDEX "ChartOfAccount_companyId_accountClass_status_idx" ON "ChartOfAccount"("companyId", "accountClass", "status");
CREATE INDEX "ChartOfAccount_companyId_reportGroup_idx" ON "ChartOfAccount"("companyId", "reportGroup");
CREATE UNIQUE INDEX "AccountingPeriod_companyId_periodKey_key" ON "AccountingPeriod"("companyId", "periodKey");
CREATE INDEX "AccountingPeriod_companyId_status_idx" ON "AccountingPeriod"("companyId", "status");
CREATE UNIQUE INDEX "JournalEntry_companyId_entryNumber_key" ON "JournalEntry"("companyId", "entryNumber");
CREATE UNIQUE INDEX "JournalEntry_companyId_sourceType_sourceId_entryType_key" ON "JournalEntry"("companyId", "sourceType", "sourceId", "entryType");
CREATE INDEX "JournalEntry_companyId_periodId_status_idx" ON "JournalEntry"("companyId", "periodId", "status");
CREATE INDEX "JournalEntry_companyId_sourceType_sourceId_idx" ON "JournalEntry"("companyId", "sourceType", "sourceId");
CREATE INDEX "JournalEntry_companyId_entryDate_idx" ON "JournalEntry"("companyId", "entryDate");
CREATE UNIQUE INDEX "JournalLine_journalEntryId_lineNumber_key" ON "JournalLine"("journalEntryId", "lineNumber");
CREATE INDEX "JournalLine_companyId_accountId_idx" ON "JournalLine"("companyId", "accountId");
CREATE INDEX "JournalLine_companyId_branchId_idx" ON "JournalLine"("companyId", "branchId");
CREATE INDEX "JournalLine_journalEntryId_idx" ON "JournalLine"("journalEntryId");
CREATE UNIQUE INDEX "PostingRule_companyId_documentType_ruleKey_version_key" ON "PostingRule"("companyId", "documentType", "ruleKey", "version");
CREATE INDEX "PostingRule_companyId_documentType_status_idx" ON "PostingRule"("companyId", "documentType", "status");
CREATE INDEX "PeriodCloseRun_companyId_periodId_createdAt_idx" ON "PeriodCloseRun"("companyId", "periodId", "createdAt");

ALTER TABLE "ChartOfAccount" ADD CONSTRAINT "ChartOfAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChartOfAccount" ADD CONSTRAINT "ChartOfAccount_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "ChartOfAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalOfJournalEntryId_fkey" FOREIGN KEY ("reversalOfJournalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostingRule" ADD CONSTRAINT "PostingRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostingRule" ADD CONSTRAINT "PostingRule_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "ChartOfAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PostingRule" ADD CONSTRAINT "PostingRule_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "ChartOfAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PeriodCloseRun" ADD CONSTRAINT "PeriodCloseRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PeriodCloseRun" ADD CONSTRAINT "PeriodCloseRun_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
