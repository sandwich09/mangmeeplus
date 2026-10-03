-- Executive report summary tables (executive backend spec §12.3, §20.1; owner decisions Q30, Q31).
-- Additive only: four new tables and their indexes. Nothing existing is altered.
--   "ExecutiveReportBuild"     one row per build round that wrote a data set
--   "ExecutiveReportMonth"     one row per month and definition version: what belongs to no single company
--   "ExecutiveCompanyMonth"    one row per company, month and definition version
--   "ExecutiveCompanyProfile"  one row per company: current dimensions and whole-life values
-- They hold numbers, dates, dimension codes and internal ids only: no person's name, e-mail, phone,
-- search text or document content. Every row is written by the report build and can be rebuilt.
-- No foreign key to "Company" on purpose: deleting a company must never delete what it paid.

-- CreateTable
CREATE TABLE "ExecutiveReportBuild" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "definitionVersion" INTEGER NOT NULL,
    "dimensionVersion" INTEGER NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "firstMonth" CHAR(7) NOT NULL,
    "lastMonth" CHAR(7) NOT NULL,
    "companyCount" INTEGER NOT NULL,
    "unclassifiedCount" INTEGER NOT NULL,
    "billingDataThrough" TIMESTAMP(3),
    "billingSince" TIMESTAMP(3),
    "aiUsageSince" TIMESTAMP(3),
    "ocrUsageSince" TIMESTAMP(3),
    "discoverySince" TIMESTAMP(3),

    CONSTRAINT "ExecutiveReportBuild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutiveReportMonth" (
    "month" CHAR(7) NOT NULL,
    "definitionVersion" INTEGER NOT NULL,
    "buildId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "billingCoveredThrough" TIMESTAMP(3),
    "untiedCount" INTEGER NOT NULL DEFAULT 0,
    "untiedReceiptsSatang" INTEGER NOT NULL DEFAULT 0,
    "untiedRefundsSatang" INTEGER NOT NULL DEFAULT 0,
    "untiedOtherSatang" INTEGER NOT NULL DEFAULT 0,
    "unsuccessfulRefundCount" INTEGER NOT NULL DEFAULT 0,
    "beforeFirstBuild" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "revisedAt" TIMESTAMP(3),

    CONSTRAINT "ExecutiveReportMonth_pkey" PRIMARY KEY ("month","definitionVersion")
);

-- CreateTable
CREATE TABLE "ExecutiveCompanyMonth" (
    "companyId" TEXT NOT NULL,
    "month" CHAR(7) NOT NULL,
    "definitionVersion" INTEGER NOT NULL,
    "buildId" TEXT NOT NULL,
    "reportClassification" TEXT,
    "receiptsSatang" INTEGER NOT NULL DEFAULT 0,
    "refundsSatang" INTEGER NOT NULL DEFAULT 0,
    "feesSatang" INTEGER NOT NULL DEFAULT 0,
    "taxSatang" INTEGER NOT NULL DEFAULT 0,
    "moneyByPurchaseKind" JSONB NOT NULL,
    "disputedInvoiceCount" INTEGER NOT NULL DEFAULT 0,
    "aiCostSatang" INTEGER NOT NULL DEFAULT 0,
    "activeDays" INTEGER NOT NULL DEFAULT 0,
    "activeDaysLine" INTEGER NOT NULL DEFAULT 0,
    "activeDaysWeb" INTEGER NOT NULL DEFAULT 0,
    "activeUsers" INTEGER NOT NULL DEFAULT 0,
    "activeUsersLine" INTEGER NOT NULL DEFAULT 0,
    "activeUsersWeb" INTEGER NOT NULL DEFAULT 0,
    "confirmedExpensesLine" INTEGER NOT NULL DEFAULT 0,
    "confirmedExpensesWeb" INTEGER NOT NULL DEFAULT 0,
    "issuedDocuments" INTEGER NOT NULL DEFAULT 0,
    "aiRequests" INTEGER NOT NULL DEFAULT 0,
    "expenseReceiptsLine" INTEGER NOT NULL DEFAULT 0,
    "expenseReceiptsWeb" INTEGER NOT NULL DEFAULT 0,
    "countersHeld" BOOLEAN NOT NULL DEFAULT false,
    "paidEver" TEXT NOT NULL,
    "paidEverReason" TEXT,
    "fullyRefunded" BOOLEAN NOT NULL DEFAULT false,
    "usageGroup" TEXT,
    "usageUnassessedReason" TEXT,
    "salesCreditSatang" INTEGER NOT NULL DEFAULT 0,
    "salesCreditActivations" INTEGER NOT NULL DEFAULT 0,
    "salesCreditWaiting" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "revisedAt" TIMESTAMP(3),

    CONSTRAINT "ExecutiveCompanyMonth_pkey" PRIMARY KEY ("companyId","month","definitionVersion")
);

-- CreateTable
CREATE TABLE "ExecutiveCompanyProfile" (
    "companyId" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "companyCreatedAt" TIMESTAMP(3) NOT NULL,
    "companyStatus" TEXT NOT NULL,
    "reportClassification" TEXT,
    "industryGroup" TEXT,
    "industryGroupSource" TEXT,
    "provinceCode" TEXT,
    "discovery" TEXT NOT NULL,
    "signupRail" TEXT NOT NULL,
    "referrerKind" TEXT NOT NULL,
    "referrerSalesUserId" TEXT,
    "referralSource" TEXT,
    "creditedSalesUserId" TEXT,
    "salesCreditState" TEXT,
    "salesCreditPaidAt" TIMESTAMP(3),
    "planState" TEXT NOT NULL,
    "planTierKey" TEXT,
    "planEndsAt" TIMESTAMP(3),
    "paidEver" TEXT NOT NULL,
    "paidEverReason" TEXT,
    "fullyRefunded" BOOLEAN NOT NULL DEFAULT false,
    "lifetimeReceiptsSatang" INTEGER NOT NULL DEFAULT 0,
    "lifetimeRefundsSatang" INTEGER NOT NULL DEFAULT 0,
    "firstActivityAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "lastLineActivityAt" TIMESTAMP(3),
    "lastWebEntryAt" TIMESTAMP(3),
    "receiptAdoption" TEXT NOT NULL,
    "expenseReceiptCountLifetime" INTEGER NOT NULL DEFAULT 0,
    "activeMemberCount" INTEGER NOT NULL DEFAULT 0,
    "branchCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExecutiveCompanyProfile_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE INDEX "ExecutiveReportBuild_asOf_idx" ON "ExecutiveReportBuild"("asOf");

-- CreateIndex
CREATE INDEX "ExecutiveReportBuild_definitionVersion_kind_asOf_idx" ON "ExecutiveReportBuild"("definitionVersion", "kind", "asOf");

-- CreateIndex
CREATE INDEX "ExecutiveCompanyMonth_month_definitionVersion_reportClassif_idx" ON "ExecutiveCompanyMonth"("month", "definitionVersion", "reportClassification");

-- CreateIndex
CREATE INDEX "ExecutiveCompanyProfile_reportClassification_idx" ON "ExecutiveCompanyProfile"("reportClassification");
