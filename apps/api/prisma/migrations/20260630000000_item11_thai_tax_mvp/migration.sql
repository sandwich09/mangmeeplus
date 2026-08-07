-- Item 11: Thai Tax MVP

-- Enums
CREATE TYPE "TaxType" AS ENUM ('VAT', 'WHT', 'CIT');
CREATE TYPE "TaxFormType" AS ENUM ('PP30', 'PP36', 'PND3', 'PND53', 'PND50', 'PND51');
CREATE TYPE "TaxRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "TaxPeriodStatus" AS ENUM ('OPEN', 'NEEDS_REVIEW', 'READY_FOR_REVIEW', 'REVIEWED', 'EXPORTED', 'FILED', 'PAID', 'CLOSED', 'AMENDED');
CREATE TYPE "TaxEventType" AS ENUM ('VAT_OUTPUT', 'VAT_INPUT', 'VAT_EXEMPT', 'VAT_REVIEW', 'WHT_PND3', 'WHT_PND53');
CREATE TYPE "TaxEventStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REVERSED', 'EXCLUDED');
CREATE TYPE "FilingPackageStatus" AS ENUM ('GENERATED', 'DOWNLOADED', 'VOIDED', 'ACCEPTED_MANUAL', 'REJECTED_MANUAL');
CREATE TYPE "ReviewIssueSeverity" AS ENUM ('INFO', 'WARNING', 'BLOCKING');
CREATE TYPE "ReviewIssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');
CREATE TYPE "WhtCertificateStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOIDED');
CREATE TYPE "TaxAdjustmentType" AS ENUM ('CORRECTION', 'REVERSAL', 'AMENDED');

-- CompanyTaxProfile
CREATE TABLE "CompanyTaxProfile" (
  "id"                   TEXT NOT NULL,
  "companyId"            TEXT NOT NULL,
  "taxId"                TEXT,
  "vatRegistered"        BOOLEAN NOT NULL DEFAULT false,
  "vatEffectiveDate"     TIMESTAMP(3),
  "branchPolicy"         TEXT NOT NULL DEFAULT 'HEAD_OFFICE_ONLY',
  "accountingPeriodMonth" INTEGER NOT NULL DEFAULT 12,
  "taxReviewerRole"      TEXT NOT NULL DEFAULT 'ACCOUNTANT',
  "notes"                TEXT,
  "updatedByUserId"      TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyTaxProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyTaxProfile_companyId_key" ON "CompanyTaxProfile"("companyId");
CREATE INDEX "CompanyTaxProfile_companyId_idx" ON "CompanyTaxProfile"("companyId");
ALTER TABLE "CompanyTaxProfile" ADD CONSTRAINT "CompanyTaxProfile_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TaxRuleSource
CREATE TABLE "TaxRuleSource" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT,
  "sourceUrl"   TEXT NOT NULL,
  "sourceTitle" TEXT NOT NULL,
  "checkedAt"   TIMESTAMP(3) NOT NULL,
  "checkedBy"   TEXT NOT NULL,
  "note"        TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxRuleSource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaxRuleSource_companyId_idx" ON "TaxRuleSource"("companyId");
ALTER TABLE "TaxRuleSource" ADD CONSTRAINT "TaxRuleSource_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TaxYearConfig
CREATE TABLE "TaxYearConfig" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT,
  "year"          INTEGER NOT NULL,
  "status"        "TaxRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo"   TIMESTAMP(3) NOT NULL,
  "sourceRuleId"  TEXT,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxYearConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxYearConfig_companyId_year_key" ON "TaxYearConfig"("companyId", "year");
CREATE INDEX "TaxYearConfig_companyId_status_idx" ON "TaxYearConfig"("companyId", "status");
ALTER TABLE "TaxYearConfig" ADD CONSTRAINT "TaxYearConfig_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxYearConfig" ADD CONSTRAINT "TaxYearConfig_sourceRuleId_fkey"
  FOREIGN KEY ("sourceRuleId") REFERENCES "TaxRuleSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TaxRateConfig
CREATE TABLE "TaxRateConfig" (
  "id"              TEXT NOT NULL,
  "taxYearConfigId" TEXT NOT NULL,
  "taxType"         "TaxType" NOT NULL,
  "code"            TEXT NOT NULL,
  "description"     TEXT NOT NULL,
  "rate"            DECIMAL(8,4) NOT NULL,
  "cap"             DECIMAL(18,4),
  "conditionJson"   JSONB,
  "status"          "TaxRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "sourceRuleId"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxRateConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxRateConfig_taxYearConfigId_taxType_code_key" ON "TaxRateConfig"("taxYearConfigId", "taxType", "code");
CREATE INDEX "TaxRateConfig_taxYearConfigId_taxType_status_idx" ON "TaxRateConfig"("taxYearConfigId", "taxType", "status");
ALTER TABLE "TaxRateConfig" ADD CONSTRAINT "TaxRateConfig_taxYearConfigId_fkey"
  FOREIGN KEY ("taxYearConfigId") REFERENCES "TaxYearConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxRateConfig" ADD CONSTRAINT "TaxRateConfig_sourceRuleId_fkey"
  FOREIGN KEY ("sourceRuleId") REFERENCES "TaxRuleSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- WhtIncomeCategory
CREATE TABLE "WhtIncomeCategory" (
  "id"              TEXT NOT NULL,
  "code"            TEXT NOT NULL,
  "nameTh"          TEXT NOT NULL,
  "nameEn"          TEXT,
  "formType"        "TaxFormType" NOT NULL,
  "defaultRate"     DECIMAL(8,4) NOT NULL,
  "status"          "TaxRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "conditionNote"   TEXT,
  "taxRateConfigId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhtIncomeCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhtIncomeCategory_code_key" ON "WhtIncomeCategory"("code");
CREATE INDEX "WhtIncomeCategory_formType_status_idx" ON "WhtIncomeCategory"("formType", "status");
ALTER TABLE "WhtIncomeCategory" ADD CONSTRAINT "WhtIncomeCategory_taxRateConfigId_fkey"
  FOREIGN KEY ("taxRateConfigId") REFERENCES "TaxRateConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TaxCalendarRule
CREATE TABLE "TaxCalendarRule" (
  "id"                  TEXT NOT NULL,
  "taxYearConfigId"     TEXT NOT NULL,
  "formType"            "TaxFormType" NOT NULL,
  "periodType"          TEXT NOT NULL DEFAULT 'MONTHLY',
  "dueRuleJson"         JSONB NOT NULL,
  "onlineExtensionJson" JSONB,
  "status"              "TaxRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "sourceRuleId"        TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxCalendarRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxCalendarRule_taxYearConfigId_formType_key" ON "TaxCalendarRule"("taxYearConfigId", "formType");
CREATE INDEX "TaxCalendarRule_taxYearConfigId_status_idx" ON "TaxCalendarRule"("taxYearConfigId", "status");
ALTER TABLE "TaxCalendarRule" ADD CONSTRAINT "TaxCalendarRule_taxYearConfigId_fkey"
  FOREIGN KEY ("taxYearConfigId") REFERENCES "TaxYearConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxCalendarRule" ADD CONSTRAINT "TaxCalendarRule_sourceRuleId_fkey"
  FOREIGN KEY ("sourceRuleId") REFERENCES "TaxRuleSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TaxPeriod
CREATE TABLE "TaxPeriod" (
  "id"         TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "taxType"    "TaxType" NOT NULL,
  "formType"   "TaxFormType" NOT NULL,
  "periodKey"  TEXT NOT NULL,
  "status"     "TaxPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "dueDate"    TIMESTAMP(3),
  "filedAt"    TIMESTAMP(3),
  "paidAt"     TIMESTAMP(3),
  "reviewNote" TEXT,
  "closedAt"   TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxPeriod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxPeriod_companyId_formType_periodKey_key" ON "TaxPeriod"("companyId", "formType", "periodKey");
CREATE INDEX "TaxPeriod_companyId_taxType_status_idx" ON "TaxPeriod"("companyId", "taxType", "status");
CREATE INDEX "TaxPeriod_companyId_formType_periodKey_idx" ON "TaxPeriod"("companyId", "formType", "periodKey");
ALTER TABLE "TaxPeriod" ADD CONSTRAINT "TaxPeriod_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TaxEvent
CREATE TABLE "TaxEvent" (
  "id"                 TEXT NOT NULL,
  "companyId"          TEXT NOT NULL,
  "taxPeriodId"        TEXT NOT NULL,
  "idempotencyKey"     TEXT NOT NULL,
  "eventType"          "TaxEventType" NOT NULL,
  "status"             "TaxEventStatus" NOT NULL DEFAULT 'ACTIVE',
  "sourceType"         TEXT NOT NULL,
  "sourceId"           TEXT NOT NULL,
  "sourceEventType"    TEXT,
  "sourceHash"         TEXT,
  "periodKey"          TEXT NOT NULL,
  "eventDate"          TIMESTAMP(3) NOT NULL,
  "taxableBase"        DECIMAL(18,4) NOT NULL,
  "taxAmount"          DECIMAL(18,4) NOT NULL,
  "currency"           TEXT NOT NULL DEFAULT 'THB',
  "vatMode"            TEXT,
  "whtFormType"        "TaxFormType",
  "payeeSnapshotJson"  JSONB,
  "incomeCategoryCode" TEXT,
  "whtRate"            DECIMAL(8,4),
  "grossAmount"        DECIMAL(18,4),
  "withheldAmount"     DECIMAL(18,4),
  "netPaidAmount"      DECIMAL(18,4),
  "taxInvoiceNumber"   TEXT,
  "reviewNote"         TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxEvent_idempotencyKey_key" ON "TaxEvent"("idempotencyKey");
CREATE INDEX "TaxEvent_companyId_taxPeriodId_status_idx" ON "TaxEvent"("companyId", "taxPeriodId", "status");
CREATE INDEX "TaxEvent_companyId_sourceType_sourceId_idx" ON "TaxEvent"("companyId", "sourceType", "sourceId");
CREATE INDEX "TaxEvent_companyId_periodKey_eventType_idx" ON "TaxEvent"("companyId", "periodKey", "eventType");
ALTER TABLE "TaxEvent" ADD CONSTRAINT "TaxEvent_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxEvent" ADD CONSTRAINT "TaxEvent_taxPeriodId_fkey"
  FOREIGN KEY ("taxPeriodId") REFERENCES "TaxPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- TaxReviewIssue
CREATE TABLE "TaxReviewIssue" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "taxPeriodId"      TEXT NOT NULL,
  "taxEventId"       TEXT,
  "severity"         "ReviewIssueSeverity" NOT NULL,
  "status"           "ReviewIssueStatus" NOT NULL DEFAULT 'OPEN',
  "issueCode"        TEXT NOT NULL,
  "description"      TEXT NOT NULL,
  "sourceType"       TEXT,
  "sourceId"         TEXT,
  "resolvedAt"       TIMESTAMP(3),
  "resolvedNote"     TEXT,
  "resolvedByUserId" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxReviewIssue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaxReviewIssue_companyId_taxPeriodId_status_idx" ON "TaxReviewIssue"("companyId", "taxPeriodId", "status");
CREATE INDEX "TaxReviewIssue_companyId_issueCode_idx" ON "TaxReviewIssue"("companyId", "issueCode");
ALTER TABLE "TaxReviewIssue" ADD CONSTRAINT "TaxReviewIssue_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxReviewIssue" ADD CONSTRAINT "TaxReviewIssue_taxPeriodId_fkey"
  FOREIGN KEY ("taxPeriodId") REFERENCES "TaxPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxReviewIssue" ADD CONSTRAINT "TaxReviewIssue_taxEventId_fkey"
  FOREIGN KEY ("taxEventId") REFERENCES "TaxEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TaxReportSnapshot
CREATE TABLE "TaxReportSnapshot" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "taxPeriodId"     TEXT NOT NULL,
  "formType"        "TaxFormType" NOT NULL,
  "periodKey"       TEXT NOT NULL,
  "reportJson"      JSONB NOT NULL,
  "checksum"        TEXT NOT NULL,
  "snapshotAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxReportSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaxReportSnapshot_companyId_taxPeriodId_idx" ON "TaxReportSnapshot"("companyId", "taxPeriodId");
CREATE INDEX "TaxReportSnapshot_companyId_formType_periodKey_idx" ON "TaxReportSnapshot"("companyId", "formType", "periodKey");
ALTER TABLE "TaxReportSnapshot" ADD CONSTRAINT "TaxReportSnapshot_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxReportSnapshot" ADD CONSTRAINT "TaxReportSnapshot_taxPeriodId_fkey"
  FOREIGN KEY ("taxPeriodId") REFERENCES "TaxPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- TaxFilingPackage
CREATE TABLE "TaxFilingPackage" (
  "id"                TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "taxPeriodId"       TEXT NOT NULL,
  "formType"          "TaxFormType" NOT NULL,
  "periodKey"         TEXT NOT NULL,
  "exportNumber"      TEXT NOT NULL,
  "status"            "FilingPackageStatus" NOT NULL DEFAULT 'GENERATED',
  "exportFormat"      TEXT NOT NULL,
  "attachmentId"      TEXT,
  "checksum"          TEXT,
  "generatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "downloadedAt"      TIMESTAMP(3),
  "voidedAt"          TIMESTAMP(3),
  "filedManuallyAt"   TIMESTAMP(3),
  "filedManuallyNote" TEXT,
  "generatedByUserId" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxFilingPackage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaxFilingPackage_companyId_taxPeriodId_idx" ON "TaxFilingPackage"("companyId", "taxPeriodId");
CREATE INDEX "TaxFilingPackage_companyId_formType_periodKey_status_idx" ON "TaxFilingPackage"("companyId", "formType", "periodKey", "status");
ALTER TABLE "TaxFilingPackage" ADD CONSTRAINT "TaxFilingPackage_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxFilingPackage" ADD CONSTRAINT "TaxFilingPackage_taxPeriodId_fkey"
  FOREIGN KEY ("taxPeriodId") REFERENCES "TaxPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- WhtCertificate
CREATE TABLE "WhtCertificate" (
  "id"                 TEXT NOT NULL,
  "companyId"          TEXT NOT NULL,
  "certificateNumber"  TEXT NOT NULL,
  "status"             "WhtCertificateStatus" NOT NULL DEFAULT 'DRAFT',
  "taxPeriodId"        TEXT NOT NULL,
  "periodKey"          TEXT NOT NULL,
  "payeeSnapshotJson"  JSONB NOT NULL,
  "payerSnapshotJson"  JSONB NOT NULL,
  "incomeCategoryCode" TEXT NOT NULL,
  "incomeCategoryName" TEXT NOT NULL,
  "whtRate"            DECIMAL(8,4) NOT NULL,
  "grossAmount"        DECIMAL(18,4) NOT NULL,
  "withheldAmount"     DECIMAL(18,4) NOT NULL,
  "paymentDate"        TIMESTAMP(3) NOT NULL,
  "taxEventIdsJson"    JSONB NOT NULL DEFAULT '[]',
  "pdfAttachmentId"    TEXT,
  "issuedAt"           TIMESTAMP(3),
  "issuedByUserId"     TEXT,
  "voidedAt"           TIMESTAMP(3),
  "voidedByUserId"     TEXT,
  "voidReason"         TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhtCertificate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhtCertificate_companyId_certificateNumber_key" ON "WhtCertificate"("companyId", "certificateNumber");
CREATE INDEX "WhtCertificate_companyId_taxPeriodId_status_idx" ON "WhtCertificate"("companyId", "taxPeriodId", "status");
ALTER TABLE "WhtCertificate" ADD CONSTRAINT "WhtCertificate_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhtCertificate" ADD CONSTRAINT "WhtCertificate_taxPeriodId_fkey"
  FOREIGN KEY ("taxPeriodId") REFERENCES "TaxPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CitLedgerSummary
CREATE TABLE "CitLedgerSummary" (
  "id"                 TEXT NOT NULL,
  "companyId"          TEXT NOT NULL,
  "taxPeriodId"        TEXT NOT NULL,
  "accountingPeriodId" TEXT,
  "revenueTotal"       DECIMAL(18,4) NOT NULL,
  "expenseTotal"       DECIMAL(18,4) NOT NULL,
  "profitLoss"         DECIMAL(18,4) NOT NULL,
  "taxExpenseTotal"    DECIMAL(18,4) NOT NULL,
  "ledgerReportRef"    TEXT,
  "sourceRefsJson"     JSONB NOT NULL DEFAULT '[]',
  "checksum"           TEXT,
  "snapshotAt"         TIMESTAMP(3),
  "missingLedger"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CitLedgerSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CitLedgerSummary_companyId_taxPeriodId_key" ON "CitLedgerSummary"("companyId", "taxPeriodId");
CREATE INDEX "CitLedgerSummary_companyId_taxPeriodId_idx" ON "CitLedgerSummary"("companyId", "taxPeriodId");
ALTER TABLE "CitLedgerSummary" ADD CONSTRAINT "CitLedgerSummary_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CitLedgerSummary" ADD CONSTRAINT "CitLedgerSummary_taxPeriodId_fkey"
  FOREIGN KEY ("taxPeriodId") REFERENCES "TaxPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- TaxAdjustment
CREATE TABLE "TaxAdjustment" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "taxPeriodId"      TEXT NOT NULL,
  "adjustmentType"   "TaxAdjustmentType" NOT NULL,
  "reason"           TEXT NOT NULL,
  "adjustedByUserId" TEXT NOT NULL,
  "metadataJson"     JSONB,
  "adjustedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaxAdjustment_companyId_taxPeriodId_idx" ON "TaxAdjustment"("companyId", "taxPeriodId");
ALTER TABLE "TaxAdjustment" ADD CONSTRAINT "TaxAdjustment_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxAdjustment" ADD CONSTRAINT "TaxAdjustment_taxPeriodId_fkey"
  FOREIGN KEY ("taxPeriodId") REFERENCES "TaxPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- TaxVerificationChecklist
CREATE TABLE "TaxVerificationChecklist" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT,
  "taxYearConfigId" TEXT NOT NULL,
  "item"            TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "reviewer"        TEXT,
  "reviewedAt"      TIMESTAMP(3),
  "note"            TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxVerificationChecklist_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaxVerificationChecklist_companyId_taxYearConfigId_idx" ON "TaxVerificationChecklist"("companyId", "taxYearConfigId");
ALTER TABLE "TaxVerificationChecklist" ADD CONSTRAINT "TaxVerificationChecklist_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxVerificationChecklist" ADD CONSTRAINT "TaxVerificationChecklist_taxYearConfigId_fkey"
  FOREIGN KEY ("taxYearConfigId") REFERENCES "TaxYearConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
