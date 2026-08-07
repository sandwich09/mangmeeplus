-- CreateEnum
CREATE TYPE "TaxSourceSystem" AS ENUM ('SAP_ERP', 'SAP_S4HANA', 'WATCHDOG', 'CUSTOM');

-- Extend Item 11 tax periods for customs-support reconciliation.
ALTER TYPE "TaxType" ADD VALUE IF NOT EXISTS 'CUSTOMS';
ALTER TYPE "TaxFormType" ADD VALUE IF NOT EXISTS 'CUSTOMS_SUPPORT';
ALTER TYPE "TaxEventType" ADD VALUE IF NOT EXISTS 'CUSTOMS_ASSESSED';

-- CreateEnum
CREATE TYPE "TaxCodeProfileStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "TaxConfigurationStatus" AS ENUM ('DRAFT', 'REVIEW_REQUIRED', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "TransactionTaxRegime" AS ENUM ('VAT', 'IMPORT_VAT', 'CUSTOMS_DUTY', 'EXCISE_TAX', 'MUNICIPAL_OR_OTHER_IMPORT_TAX', 'WITHHOLDING_TAX', 'CORPORATE_INCOME_TAX_SUPPORT', 'OTHER_TRANSACTION_TAX');

-- CreateEnum
CREATE TYPE "TransactionTaxDirection" AS ENUM ('OUTPUT', 'INPUT', 'SELF_ASSESSED', 'WITHHELD_PAYABLE', 'WITHHELD_RECEIVABLE');

-- CreateEnum
CREATE TYPE "TransactionTaxTreatment" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT', 'NON_TAXABLE', 'DEFERRED', 'REVERSE_CHARGE', 'CLAIMABLE', 'PENDING_EVIDENCE', 'PARTIALLY_DEDUCTIBLE', 'NONDEDUCTIBLE_EXPENSE', 'NONDEDUCTIBLE_CAPITALIZED', 'OUTSIDE_SCOPE', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "TransactionTaxContext" AS ENUM ('DOMESTIC_SALE', 'DOMESTIC_PURCHASE', 'IMPORT_GOODS', 'IMPORT_SERVICE', 'EXPORT_GOODS', 'EXPORT_SERVICE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT', 'MANUAL_TAX_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TaxCalculationMethod" AS ENUM ('EXCLUSIVE', 'INCLUSIVE', 'NONE');

-- CreateEnum
CREATE TYPE "TaxClaimability" AS ENUM ('NOT_APPLICABLE', 'CLAIMABLE', 'PENDING_EVIDENCE', 'PARTIAL', 'NONDEDUCTIBLE_EXPENSE', 'NONDEDUCTIBLE_CAPITALIZED');

-- CreateEnum
CREATE TYPE "TaxAccountRole" AS ENUM ('OUTPUT_VAT_PAYABLE', 'OUTPUT_VAT_DEFERRED', 'INPUT_VAT_CLAIMABLE', 'INPUT_VAT_PENDING', 'INPUT_VAT_DEFERRED', 'IMPORT_VAT_CLAIMABLE', 'IMPORT_VAT_PENDING', 'IMPORT_TAX_SETTLEMENT_PAYABLE', 'PP36_OUTPUT_VAT_PAYABLE', 'PP36_INPUT_VAT_CLAIMABLE', 'NONDEDUCTIBLE_VAT_EXPENSE', 'NONDEDUCTIBLE_VAT_CAPITALIZED', 'CUSTOMS_DUTY_PAYABLE', 'CUSTOMS_DUTY_EXPENSE', 'CUSTOMS_DUTY_CAPITALIZED', 'EXCISE_TAX_PAYABLE', 'EXCISE_TAX_EXPENSE_OR_COST', 'WHT_PAYABLE', 'WHT_RECEIVABLE');

-- CreateEnum
CREATE TYPE "TaxPostingSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "TaxComponentKey" AS ENUM ('VAT', 'IMPORT_VAT', 'PP36_OUTPUT', 'PP36_INPUT', 'CUSTOMS_DUTY', 'EXCISE_TAX', 'OTHER_IMPORT_TAX');

-- CreateEnum
CREATE TYPE "TaxReportForm" AS ENUM ('PP30', 'PP36', 'TAX_LEDGER', 'CUSTOMS_SUPPORT');

-- CreateEnum
CREATE TYPE "TaxReportAmountSource" AS ENUM ('TAX_BASE', 'TAX_AMOUNT', 'GROSS', 'DUTY', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxReportSignRule" AS ENUM ('NORMAL', 'INVERT');

-- CreateEnum
CREATE TYPE "TaxEvidenceReviewStatus" AS ENUM ('DRAFT', 'REVIEW_REQUIRED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TaxReconciliationStatus" AS ENUM ('GENERATED', 'NEEDS_REVIEW', 'REVIEWED');

-- CreateEnum
CREATE TYPE "TaxReconciliationIssueCode" AS ENUM ('MATCHED', 'SOURCE_EVENT_MISMATCH', 'EVENT_JOURNAL_MISMATCH', 'REPORT_MISMATCH', 'MISSING_TAX_CODE', 'MISSING_ACCOUNT_RULE', 'MISSING_REPORT_RULE', 'EVIDENCE_PENDING', 'CURRENCY_MISMATCH');

-- AlterTable
ALTER TABLE "AccountingDocumentLine" ADD COLUMN     "accountAssignmentsJson" JSONB,
ADD COLUMN     "accountRuleVersionSnapshot" INTEGER,
ADD COLUMN     "claimabilitySnapshot" "TaxClaimability",
ADD COLUMN     "exchangeRateDateSnapshot" DATE,
ADD COLUMN     "exchangeRateSnapshot" DECIMAL(18,8),
ADD COLUMN     "exchangeRateSourceSnapshot" TEXT,
ADD COLUMN     "externalTaxCodeSnapshot" TEXT,
ADD COLUMN     "reportRuleVersionSnapshot" INTEGER,
ADD COLUMN     "sourceCurrencySnapshot" TEXT,
ADD COLUMN     "taxBaseAmount" DECIMAL(18,4),
ADD COLUMN     "taxCodeDefinitionId" TEXT,
ADD COLUMN     "taxComponentsJson" JSONB,
ADD COLUMN     "taxContextSnapshot" "TransactionTaxContext",
ADD COLUMN     "taxCurrencySnapshot" TEXT,
ADD COLUMN     "taxDirectionSnapshot" "TransactionTaxDirection",
ADD COLUMN     "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus",
ADD COLUMN     "taxProfileKeySnapshot" TEXT,
ADD COLUMN     "taxProfileVersionSnapshot" INTEGER,
ADD COLUMN     "taxRateSnapshot" DECIMAL(8,4),
ADD COLUMN     "taxRegimeSnapshot" "TransactionTaxRegime",
ADD COLUMN     "taxTreatmentSnapshot" "TransactionTaxTreatment",
ADD COLUMN     "transactionTaxAmount" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "ExpenseLine" ADD COLUMN     "accountAssignmentsJson" JSONB,
ADD COLUMN     "accountRuleVersionSnapshot" INTEGER,
ADD COLUMN     "claimabilitySnapshot" "TaxClaimability",
ADD COLUMN     "exchangeRateDateSnapshot" DATE,
ADD COLUMN     "exchangeRateSnapshot" DECIMAL(18,8),
ADD COLUMN     "exchangeRateSourceSnapshot" TEXT,
ADD COLUMN     "externalTaxCodeSnapshot" TEXT,
ADD COLUMN     "reportRuleVersionSnapshot" INTEGER,
ADD COLUMN     "sourceCurrencySnapshot" TEXT,
ADD COLUMN     "taxBaseAmount" DECIMAL(18,4),
ADD COLUMN     "taxCodeDefinitionId" TEXT,
ADD COLUMN     "taxComponentsJson" JSONB,
ADD COLUMN     "taxContextSnapshot" "TransactionTaxContext",
ADD COLUMN     "taxCurrencySnapshot" TEXT,
ADD COLUMN     "taxDirectionSnapshot" "TransactionTaxDirection",
ADD COLUMN     "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus",
ADD COLUMN     "taxProfileKeySnapshot" TEXT,
ADD COLUMN     "taxProfileVersionSnapshot" INTEGER,
ADD COLUMN     "taxRateSnapshot" DECIMAL(8,4),
ADD COLUMN     "taxRegimeSnapshot" "TransactionTaxRegime",
ADD COLUMN     "taxTreatmentSnapshot" "TransactionTaxTreatment",
ADD COLUMN     "transactionTaxAmount" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "accountRuleVersionSnapshot" INTEGER,
ADD COLUMN     "claimabilitySnapshot" "TaxClaimability",
ADD COLUMN     "componentKey" "TaxComponentKey",
ADD COLUMN     "exchangeRateDateSnapshot" DATE,
ADD COLUMN     "exchangeRateSnapshot" DECIMAL(18,8),
ADD COLUMN     "exchangeRateSourceSnapshot" TEXT,
ADD COLUMN     "externalTaxCodeSnapshot" TEXT,
ADD COLUMN     "reportContributionsJson" JSONB,
ADD COLUMN     "reportRuleVersionSnapshot" INTEGER,
ADD COLUMN     "sourceCurrencySnapshot" TEXT,
ADD COLUMN     "taxBaseAmount" DECIMAL(18,4),
ADD COLUMN     "taxCodeDefinitionId" TEXT,
ADD COLUMN     "taxContextSnapshot" "TransactionTaxContext",
ADD COLUMN     "taxCurrencySnapshot" TEXT,
ADD COLUMN     "taxDirectionSnapshot" "TransactionTaxDirection",
ADD COLUMN     "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus",
ADD COLUMN     "taxProfileKeySnapshot" TEXT,
ADD COLUMN     "taxProfileVersionSnapshot" INTEGER,
ADD COLUMN     "taxRateSnapshot" DECIMAL(8,4),
ADD COLUMN     "taxRegimeSnapshot" "TransactionTaxRegime",
ADD COLUMN     "taxTreatmentSnapshot" "TransactionTaxTreatment",
ADD COLUMN     "transactionTaxAmount" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "TaxEvent" ADD COLUMN     "accountAssignmentsJson" JSONB,
ADD COLUMN     "accountRuleVersionSnapshot" INTEGER,
ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "claimabilitySnapshot" "TaxClaimability",
ADD COLUMN     "componentKey" "TaxComponentKey",
ADD COLUMN     "exchangeRateDateSnapshot" DATE,
ADD COLUMN     "exchangeRateSnapshot" DECIMAL(18,8),
ADD COLUMN     "exchangeRateSourceSnapshot" TEXT,
ADD COLUMN     "externalTaxCodeSnapshot" TEXT,
ADD COLUMN     "reportContributionsJson" JSONB,
ADD COLUMN     "reportRuleVersionSnapshot" INTEGER,
ADD COLUMN     "sourceLineId" TEXT,
ADD COLUMN     "sourceLineKey" TEXT NOT NULL DEFAULT '__HEADER__',
ADD COLUMN     "sourceCurrencySnapshot" TEXT,
ADD COLUMN     "taxCodeDefinitionId" TEXT,
ADD COLUMN     "taxContextSnapshot" "TransactionTaxContext",
ADD COLUMN     "taxCurrencySnapshot" TEXT,
ADD COLUMN     "taxDirectionSnapshot" "TransactionTaxDirection",
ADD COLUMN     "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus",
ADD COLUMN     "taxProfileKeySnapshot" TEXT,
ADD COLUMN     "taxProfileVersionSnapshot" INTEGER,
ADD COLUMN     "taxRateSnapshot" DECIMAL(8,4),
ADD COLUMN     "taxRegimeSnapshot" "TransactionTaxRegime",
ADD COLUMN     "taxTreatmentSnapshot" "TransactionTaxTreatment";

-- AlterTable
ALTER TABLE "PurchaseRequestLine" ADD COLUMN     "accountAssignmentsJson" JSONB,
ADD COLUMN     "accountRuleVersionSnapshot" INTEGER,
ADD COLUMN     "claimabilitySnapshot" "TaxClaimability",
ADD COLUMN     "exchangeRateDateSnapshot" DATE,
ADD COLUMN     "exchangeRateSnapshot" DECIMAL(18,8),
ADD COLUMN     "exchangeRateSourceSnapshot" TEXT,
ADD COLUMN     "externalTaxCodeSnapshot" TEXT,
ADD COLUMN     "reportRuleVersionSnapshot" INTEGER,
ADD COLUMN     "sourceCurrencySnapshot" TEXT,
ADD COLUMN     "taxBaseAmount" DECIMAL(18,4),
ADD COLUMN     "taxCodeDefinitionId" TEXT,
ADD COLUMN     "taxComponentsJson" JSONB,
ADD COLUMN     "taxContextSnapshot" "TransactionTaxContext",
ADD COLUMN     "taxCurrencySnapshot" TEXT,
ADD COLUMN     "taxDirectionSnapshot" "TransactionTaxDirection",
ADD COLUMN     "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus",
ADD COLUMN     "taxProfileKeySnapshot" TEXT,
ADD COLUMN     "taxProfileVersionSnapshot" INTEGER,
ADD COLUMN     "taxRateSnapshot" DECIMAL(8,4),
ADD COLUMN     "taxRegimeSnapshot" "TransactionTaxRegime",
ADD COLUMN     "taxTreatmentSnapshot" "TransactionTaxTreatment",
ADD COLUMN     "transactionTaxAmount" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "accountAssignmentsJson" JSONB,
ADD COLUMN     "accountRuleVersionSnapshot" INTEGER,
ADD COLUMN     "claimabilitySnapshot" "TaxClaimability",
ADD COLUMN     "exchangeRateDateSnapshot" DATE,
ADD COLUMN     "exchangeRateSnapshot" DECIMAL(18,8),
ADD COLUMN     "exchangeRateSourceSnapshot" TEXT,
ADD COLUMN     "externalTaxCodeSnapshot" TEXT,
ADD COLUMN     "reportRuleVersionSnapshot" INTEGER,
ADD COLUMN     "sourceCurrencySnapshot" TEXT,
ADD COLUMN     "taxBaseAmount" DECIMAL(18,4),
ADD COLUMN     "taxCodeDefinitionId" TEXT,
ADD COLUMN     "taxComponentsJson" JSONB,
ADD COLUMN     "taxContextSnapshot" "TransactionTaxContext",
ADD COLUMN     "taxCurrencySnapshot" TEXT,
ADD COLUMN     "taxDirectionSnapshot" "TransactionTaxDirection",
ADD COLUMN     "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus",
ADD COLUMN     "taxProfileKeySnapshot" TEXT,
ADD COLUMN     "taxProfileVersionSnapshot" INTEGER,
ADD COLUMN     "taxRateSnapshot" DECIMAL(8,4),
ADD COLUMN     "taxRegimeSnapshot" "TransactionTaxRegime",
ADD COLUMN     "taxTreatmentSnapshot" "TransactionTaxTreatment",
ADD COLUMN     "transactionTaxAmount" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "VendorBillLine" ADD COLUMN     "accountAssignmentsJson" JSONB,
ADD COLUMN     "accountRuleVersionSnapshot" INTEGER,
ADD COLUMN     "claimabilitySnapshot" "TaxClaimability",
ADD COLUMN     "exchangeRateDateSnapshot" DATE,
ADD COLUMN     "exchangeRateSnapshot" DECIMAL(18,8),
ADD COLUMN     "exchangeRateSourceSnapshot" TEXT,
ADD COLUMN     "externalTaxCodeSnapshot" TEXT,
ADD COLUMN     "reportRuleVersionSnapshot" INTEGER,
ADD COLUMN     "sourceCurrencySnapshot" TEXT,
ADD COLUMN     "taxBaseAmount" DECIMAL(18,4),
ADD COLUMN     "taxCodeDefinitionId" TEXT,
ADD COLUMN     "taxComponentsJson" JSONB,
ADD COLUMN     "taxContextSnapshot" "TransactionTaxContext",
ADD COLUMN     "taxCurrencySnapshot" TEXT,
ADD COLUMN     "taxDirectionSnapshot" "TransactionTaxDirection",
ADD COLUMN     "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus",
ADD COLUMN     "taxProfileKeySnapshot" TEXT,
ADD COLUMN     "taxProfileVersionSnapshot" INTEGER,
ADD COLUMN     "taxRateSnapshot" DECIMAL(8,4),
ADD COLUMN     "taxRegimeSnapshot" "TransactionTaxRegime",
ADD COLUMN     "taxTreatmentSnapshot" "TransactionTaxTreatment",
ADD COLUMN     "transactionTaxAmount" DECIMAL(18,4);

-- CreateTable
CREATE TABLE "CompanyTaxCodeProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceSystem" "TaxSourceSystem" NOT NULL,
    "sourceProfileKey" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'TH',
    "sapClient" TEXT,
    "sapCompanyCode" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "TaxCodeProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "sourceUrl" TEXT,
    "sourceAttachmentId" TEXT,
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyTaxCodeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCodeDefinition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "externalCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "taxRegime" "TransactionTaxRegime" NOT NULL,
    "direction" "TransactionTaxDirection" NOT NULL,
    "treatment" "TransactionTaxTreatment" NOT NULL,
    "transactionContextsJson" JSONB NOT NULL,
    "rate" DECIMAL(8,4) NOT NULL,
    "calculationMethod" "TaxCalculationMethod" NOT NULL,
    "sapAccountKey" TEXT,
    "targetTaxCodeDefinitionId" TEXT,
    "claimabilityDefault" "TaxClaimability" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "evidenceRuleKey" TEXT,
    "status" "TaxConfigurationStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceMetadataJson" JSONB,
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCodeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxAccountDeterminationRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "taxCodeDefinitionId" TEXT,
    "taxRegime" "TransactionTaxRegime" NOT NULL,
    "direction" "TransactionTaxDirection" NOT NULL,
    "treatment" "TransactionTaxTreatment" NOT NULL,
    "transactionContext" "TransactionTaxContext",
    "sourceModule" TEXT,
    "accountRole" "TaxAccountRole" NOT NULL,
    "postingSide" "TaxPostingSide" NOT NULL,
    "accountId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditionJson" JSONB,
    "status" "TaxConfigurationStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxAccountDeterminationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxReportMappingRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "taxCodeDefinitionId" TEXT NOT NULL,
    "formType" "TaxReportForm" NOT NULL,
    "boxKey" TEXT NOT NULL,
    "amountSource" "TaxReportAmountSource" NOT NULL,
    "signRule" "TaxReportSignRule" NOT NULL DEFAULT 'NORMAL',
    "includeWhenJson" JSONB,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "TaxConfigurationStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxReportMappingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeTaxEvidence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "transactionContext" "TransactionTaxContext" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLineId" TEXT,
    "evidenceType" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "evidenceDate" DATE NOT NULL,
    "countryCode" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "exchangeRate" DECIMAL(18,8),
    "exchangeRateSource" TEXT,
    "customsValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "dutyAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "exciseAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "otherTaxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "importVatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "attachmentIdsJson" JSONB NOT NULL,
    "status" "TaxEvidenceReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeTaxEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxReconciliationRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "formType" "TaxReportForm" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "status" "TaxReconciliationStatus" NOT NULL DEFAULT 'GENERATED',
    "checksum" TEXT NOT NULL,
    "blockingIssueCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxReconciliationLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "branchId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLineId" TEXT,
    "sourceLineKey" TEXT NOT NULL DEFAULT '__HEADER__',
    "componentKey" "TaxComponentKey" NOT NULL,
    "taxEventId" TEXT,
    "journalEntryId" TEXT,
    "taxCodeDefinitionId" TEXT,
    "externalTaxCode" TEXT,
    "sourceCurrency" TEXT,
    "taxCurrency" TEXT,
    "sourceBaseAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sourceTaxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "eventBaseAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "eventTaxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "journalTaxAccountId" TEXT,
    "journalDebitAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "journalCreditAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "journalTaxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reportAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reportBoxesJson" JSONB,
    "sourceEventDelta" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "eventJournalDelta" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "eventReportDelta" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "issueCode" "TaxReconciliationIssueCode" NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "sourceRefsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxReconciliationLine_pkey" PRIMARY KEY ("id")
);

-- Safe legacy bridge: preserve the item 11A O7/O0/OX columns while creating
-- review-gated profile rows only for companies that already use those codes.
-- Nothing is activated automatically and posted/filed facts are not rewritten.
INSERT INTO "CompanyTaxCodeProfile" (
    "id", "companyId", "name", "sourceSystem", "sourceProfileKey", "countryCode",
    "isDefault", "status", "version", "effectiveFrom", "sourceUrl", "createdAt", "updatedAt"
)
SELECT
    'item11b_legacy_' || md5(company."id"),
    company."id",
    'SAP ERP Thailand legacy (migration review required)',
    'SAP_ERP'::"TaxSourceSystem",
    'SAP_ERP_TH_LEGACY',
    'TH',
    true,
    'DRAFT'::"TaxCodeProfileStatus",
    1,
    DATE '1900-01-01',
    'https://help.sap.com/docs/SAP_ERP/a70c5fce76eb44adb0c86a9d3059e4dd/ec83d0531d8b4208e10000000a174cb4.html',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Company" AS company
WHERE EXISTS (
    SELECT 1
    FROM "AccountingDocument" AS document
    WHERE document."companyId" = company."id"
      AND document."outputTaxCode" IS NOT NULL
)
OR EXISTS (
    SELECT 1
    FROM "TaxEvent" AS event
    WHERE event."companyId" = company."id"
      AND event."outputTaxCode" IS NOT NULL
);

INSERT INTO "TaxCodeDefinition" (
    "id", "companyId", "profileId", "externalCode", "displayName", "taxRegime",
    "direction", "treatment", "transactionContextsJson", "rate", "calculationMethod",
    "claimabilityDefault", "status", "effectiveFrom", "version", "sourceMetadataJson",
    "createdAt", "updatedAt"
)
SELECT
    'item11b_def_' || lower(definition."externalCode") || '_' || md5(profile."companyId"),
    profile."companyId",
    profile."id",
    definition."externalCode",
    definition."displayName",
    'VAT'::"TransactionTaxRegime",
    'OUTPUT'::"TransactionTaxDirection",
    definition."treatment"::"TransactionTaxTreatment",
    definition."contexts"::jsonb,
    definition."rate",
    CASE WHEN definition."rate" = 0 THEN 'NONE'::"TaxCalculationMethod" ELSE 'EXCLUSIVE'::"TaxCalculationMethod" END,
    'NOT_APPLICABLE'::"TaxClaimability",
    'REVIEW_REQUIRED'::"TaxConfigurationStatus",
    DATE '1900-01-01',
    1,
    jsonb_build_object('migration', 'item11b', 'legacyHeaderCodePreserved', true),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "CompanyTaxCodeProfile" AS profile
CROSS JOIN (
    VALUES
        ('O7', 'Output VAT 7% (legacy)', 'STANDARD', 7.0000::decimal(8,4), '["DOMESTIC_SALE","RETURN_OR_CREDIT","DEBIT_ADJUSTMENT"]'),
        ('O0', 'Output VAT 0% (legacy)', 'ZERO_RATED', 0.0000::decimal(8,4), '["EXPORT_GOODS","EXPORT_SERVICE","RETURN_OR_CREDIT","DEBIT_ADJUSTMENT"]'),
        ('OX', 'VAT exempt output (legacy)', 'EXEMPT', 0.0000::decimal(8,4), '["DOMESTIC_SALE","RETURN_OR_CREDIT","DEBIT_ADJUSTMENT"]')
) AS definition("externalCode", "displayName", "treatment", "rate", "contexts")
WHERE profile."sourceProfileKey" = 'SAP_ERP_TH_LEGACY';

-- Backfill only header-wide output codes whose every line agrees with the
-- legacy rate/zero-tax invariant. Existing amounts are copied, never recalculated.
UPDATE "AccountingDocumentLine" AS line
SET
    "taxCodeDefinitionId" = definition."id",
    "externalTaxCodeSnapshot" = document."outputTaxCode"::text,
    "taxProfileKeySnapshot" = profile."sourceProfileKey",
    "taxProfileVersionSnapshot" = profile."version",
    "taxRegimeSnapshot" = definition."taxRegime",
    "taxDirectionSnapshot" = definition."direction",
    "taxTreatmentSnapshot" = definition."treatment",
    "taxContextSnapshot" = CASE document."documentType"
        WHEN 'CREDIT_NOTE' THEN 'RETURN_OR_CREDIT'::"TransactionTaxContext"
        WHEN 'DEBIT_NOTE' THEN 'DEBIT_ADJUSTMENT'::"TransactionTaxContext"
        ELSE 'DOMESTIC_SALE'::"TransactionTaxContext"
    END,
    "taxRateSnapshot" = definition."rate",
    "taxBaseAmount" = line."lineSubtotalAmount",
    "transactionTaxAmount" = line."vatAmount",
    "claimabilitySnapshot" = 'NOT_APPLICABLE'::"TaxClaimability",
    "taxEvidenceReviewStatus" = 'REVIEW_REQUIRED'::"TaxEvidenceReviewStatus"
FROM "AccountingDocument" AS document
JOIN "CompanyTaxCodeProfile" AS profile
  ON profile."companyId" = document."companyId"
 AND profile."sourceProfileKey" = 'SAP_ERP_TH_LEGACY'
JOIN "TaxCodeDefinition" AS definition
  ON definition."profileId" = profile."id"
 AND definition."externalCode" = document."outputTaxCode"::text
 AND definition."direction" = 'OUTPUT'
WHERE line."documentId" = document."id"
  AND document."outputTaxCode" IN ('O7', 'OX')
  AND document."documentType" = 'TAX_INVOICE'
  AND NOT EXISTS (
      SELECT 1
      FROM "AccountingDocumentLine" AS sibling
      WHERE sibling."documentId" = document."id"
        AND (
          (document."outputTaxCode" = 'O7' AND sibling."vatRate" IS DISTINCT FROM 7.0000)
          OR (document."outputTaxCode" = 'OX' AND sibling."vatAmount" <> 0)
        )
  );

-- Explicit review markers for legacy tax-document lines that cannot be mapped
-- without guessing. They remain detached from a TaxCodeDefinition.
UPDATE "AccountingDocumentLine" AS line
SET
    "taxRegimeSnapshot" = 'VAT'::"TransactionTaxRegime",
    "taxDirectionSnapshot" = 'OUTPUT'::"TransactionTaxDirection",
    "taxTreatmentSnapshot" = 'NEEDS_REVIEW'::"TransactionTaxTreatment",
    "taxContextSnapshot" = CASE document."documentType"
        WHEN 'CREDIT_NOTE' THEN 'RETURN_OR_CREDIT'::"TransactionTaxContext"
        WHEN 'DEBIT_NOTE' THEN 'DEBIT_ADJUSTMENT'::"TransactionTaxContext"
        WHEN 'TAX_INVOICE' THEN CASE
            WHEN document."outputTaxCode" = 'O0' THEN NULL
            ELSE 'DOMESTIC_SALE'::"TransactionTaxContext"
        END
        ELSE NULL
    END,
    "taxRateSnapshot" = line."vatRate",
    "taxBaseAmount" = line."lineSubtotalAmount",
    "transactionTaxAmount" = line."vatAmount",
    "claimabilitySnapshot" = 'NOT_APPLICABLE'::"TaxClaimability",
    "taxEvidenceReviewStatus" = 'REVIEW_REQUIRED'::"TaxEvidenceReviewStatus"
FROM "AccountingDocument" AS document
WHERE line."documentId" = document."id"
  AND document."documentType" IN ('TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE')
  AND line."taxCodeDefinitionId" IS NULL;

-- Purchase-side legacy rows have no trustworthy external code. Preserve their
-- existing amount/rate facts and mark semantic classification for review.
UPDATE "ExpenseLine"
SET
    "taxRegimeSnapshot" = 'VAT'::"TransactionTaxRegime",
    "taxDirectionSnapshot" = 'INPUT'::"TransactionTaxDirection",
    "taxTreatmentSnapshot" = 'NEEDS_REVIEW'::"TransactionTaxTreatment",
    "taxContextSnapshot" = 'DOMESTIC_PURCHASE'::"TransactionTaxContext",
    -- ExpenseLine historically stores 7% as 0.07; item11B snapshots use 7.
    "taxRateSnapshot" = CASE
        WHEN ABS("vatRate") <= 1 THEN "vatRate" * 100
        ELSE "vatRate"
    END,
    "taxBaseAmount" = "taxableAmount",
    "transactionTaxAmount" = "vatAmount",
    "claimabilitySnapshot" = 'PENDING_EVIDENCE'::"TaxClaimability",
    "taxEvidenceReviewStatus" = 'REVIEW_REQUIRED'::"TaxEvidenceReviewStatus"
WHERE "vatRate" IS NOT NULL OR "vatAmount" <> 0;

UPDATE "PurchaseRequestLine"
SET
    "taxRegimeSnapshot" = 'VAT'::"TransactionTaxRegime",
    "taxDirectionSnapshot" = 'INPUT'::"TransactionTaxDirection",
    "taxTreatmentSnapshot" = 'NEEDS_REVIEW'::"TransactionTaxTreatment",
    "taxContextSnapshot" = 'DOMESTIC_PURCHASE'::"TransactionTaxContext",
    "taxRateSnapshot" = "vatRate",
    "taxBaseAmount" = "lineSubtotalAmount",
    "transactionTaxAmount" = "vatAmount",
    "claimabilitySnapshot" = 'PENDING_EVIDENCE'::"TaxClaimability",
    "taxEvidenceReviewStatus" = 'REVIEW_REQUIRED'::"TaxEvidenceReviewStatus"
WHERE "vatRate" IS NOT NULL OR "vatAmount" <> 0;

UPDATE "PurchaseOrderLine"
SET
    "taxRegimeSnapshot" = 'VAT'::"TransactionTaxRegime",
    "taxDirectionSnapshot" = 'INPUT'::"TransactionTaxDirection",
    "taxTreatmentSnapshot" = 'NEEDS_REVIEW'::"TransactionTaxTreatment",
    "taxContextSnapshot" = 'DOMESTIC_PURCHASE'::"TransactionTaxContext",
    "taxRateSnapshot" = "vatRate",
    "taxBaseAmount" = "lineSubtotalAmount",
    "transactionTaxAmount" = "vatAmount",
    "claimabilitySnapshot" = 'PENDING_EVIDENCE'::"TaxClaimability",
    "taxEvidenceReviewStatus" = 'REVIEW_REQUIRED'::"TaxEvidenceReviewStatus"
WHERE "vatRate" IS NOT NULL OR "vatAmount" <> 0;

UPDATE "VendorBillLine"
SET
    "taxRegimeSnapshot" = 'VAT'::"TransactionTaxRegime",
    "taxDirectionSnapshot" = 'INPUT'::"TransactionTaxDirection",
    "taxTreatmentSnapshot" = 'NEEDS_REVIEW'::"TransactionTaxTreatment",
    "taxContextSnapshot" = 'DOMESTIC_PURCHASE'::"TransactionTaxContext",
    "taxRateSnapshot" = "vatRate",
    "taxBaseAmount" = "lineSubtotalAmount",
    "transactionTaxAmount" = "vatAmount",
    "claimabilitySnapshot" = CASE "inputVatClaimStatus"
        WHEN 'CLAIMABLE' THEN 'CLAIMABLE'::"TaxClaimability"
        WHEN 'NON_CLAIMABLE' THEN 'NONDEDUCTIBLE_EXPENSE'::"TaxClaimability"
        ELSE 'PENDING_EVIDENCE'::"TaxClaimability"
    END,
    "taxEvidenceReviewStatus" = 'REVIEW_REQUIRED'::"TaxEvidenceReviewStatus"
WHERE "vatRate" IS NOT NULL OR "vatAmount" <> 0;

-- Tax events keep their original base/tax/status and gain only immutable
-- classification snapshots plus branch/source-line markers.
UPDATE "TaxEvent" AS event
SET "branchId" = document."branchId"
FROM "AccountingDocument" AS document
WHERE event."sourceType" = 'accounting.document'
  AND event."sourceId" = document."id"
  AND event."companyId" = document."companyId"
  AND event."branchId" IS NULL;

UPDATE "TaxEvent" AS event
SET "branchId" = expense."branchId"
FROM "ExpenseRecord" AS expense
WHERE event."sourceType" = 'expense.record'
  AND event."sourceId" = expense."id"
  AND event."companyId" = expense."companyId"
  AND event."branchId" IS NULL;

UPDATE "TaxEvent" AS event
SET
    "componentKey" = 'VAT'::"TaxComponentKey",
    "taxCodeDefinitionId" = definition."id",
    "externalTaxCodeSnapshot" = event."outputTaxCode"::text,
    "taxProfileKeySnapshot" = profile."sourceProfileKey",
    "taxProfileVersionSnapshot" = profile."version",
    "taxRegimeSnapshot" = definition."taxRegime",
    "taxDirectionSnapshot" = definition."direction",
    "taxTreatmentSnapshot" = definition."treatment",
    "taxRateSnapshot" = definition."rate",
    "claimabilitySnapshot" = definition."claimabilityDefault",
    "taxEvidenceReviewStatus" = 'REVIEW_REQUIRED'::"TaxEvidenceReviewStatus"
FROM "CompanyTaxCodeProfile" AS profile
JOIN "TaxCodeDefinition" AS definition
  ON definition."profileId" = profile."id"
 AND definition."direction" = 'OUTPUT'
WHERE event."companyId" = profile."companyId"
  AND event."outputTaxCode" IN ('O7', 'OX')
  AND COALESCE(event."sourceEventType", '') NOT IN ('CREDIT_NOTE', 'DEBIT_NOTE')
  AND definition."externalCode" = event."outputTaxCode"::text;

UPDATE "TaxEvent"
SET
    "componentKey" = 'VAT'::"TaxComponentKey",
    "externalTaxCodeSnapshot" = COALESCE("externalTaxCodeSnapshot", "outputTaxCode"::text),
    "taxProfileKeySnapshot" = CASE WHEN "outputTaxCode" IS NOT NULL THEN 'SAP_ERP_TH_LEGACY' ELSE "taxProfileKeySnapshot" END,
    "taxProfileVersionSnapshot" = CASE WHEN "outputTaxCode" IS NOT NULL THEN 1 ELSE "taxProfileVersionSnapshot" END,
    "taxRegimeSnapshot" = 'VAT'::"TransactionTaxRegime",
    "taxContextSnapshot" = CASE "sourceEventType"
        WHEN 'CREDIT_NOTE' THEN 'RETURN_OR_CREDIT'::"TransactionTaxContext"
        WHEN 'DEBIT_NOTE' THEN 'DEBIT_ADJUSTMENT'::"TransactionTaxContext"
        ELSE "taxContextSnapshot"
    END,
    "taxDirectionSnapshot" = CASE "eventType"
        WHEN 'VAT_INPUT' THEN 'INPUT'::"TransactionTaxDirection"
        WHEN 'VAT_OUTPUT' THEN 'OUTPUT'::"TransactionTaxDirection"
        WHEN 'VAT_EXEMPT' THEN 'OUTPUT'::"TransactionTaxDirection"
        ELSE NULL
    END,
    "taxTreatmentSnapshot" = 'NEEDS_REVIEW'::"TransactionTaxTreatment",
    "claimabilitySnapshot" = CASE "eventType"
        WHEN 'VAT_INPUT' THEN 'PENDING_EVIDENCE'::"TaxClaimability"
        WHEN 'VAT_OUTPUT' THEN 'NOT_APPLICABLE'::"TaxClaimability"
        WHEN 'VAT_EXEMPT' THEN 'NOT_APPLICABLE'::"TaxClaimability"
        ELSE NULL
    END,
    "taxEvidenceReviewStatus" = 'REVIEW_REQUIRED'::"TaxEvidenceReviewStatus"
WHERE "eventType" IN ('VAT_OUTPUT', 'VAT_INPUT', 'VAT_EXEMPT', 'VAT_REVIEW')
  AND "taxCodeDefinitionId" IS NULL;

-- A legacy journal taxCode is copied as an audit snapshot only when it matches
-- a company-scoped legacy definition; debit/credit amounts are untouched.
UPDATE "JournalLine" AS line
SET
    "componentKey" = 'VAT'::"TaxComponentKey",
    "taxCodeDefinitionId" = definition."id",
    "externalTaxCodeSnapshot" = line."taxCode",
    "taxProfileKeySnapshot" = profile."sourceProfileKey",
    "taxProfileVersionSnapshot" = profile."version",
    "taxRegimeSnapshot" = definition."taxRegime",
    "taxDirectionSnapshot" = definition."direction",
    "taxTreatmentSnapshot" = definition."treatment",
    "taxRateSnapshot" = definition."rate",
    "claimabilitySnapshot" = definition."claimabilityDefault",
    "taxEvidenceReviewStatus" = 'REVIEW_REQUIRED'::"TaxEvidenceReviewStatus"
FROM "CompanyTaxCodeProfile" AS profile
JOIN "TaxCodeDefinition" AS definition
  ON definition."profileId" = profile."id"
 AND definition."direction" = 'OUTPUT'
WHERE line."companyId" = profile."companyId"
  AND line."taxCode" = definition."externalCode"
  AND definition."externalCode" IN ('O7', 'OX');

UPDATE "JournalLine"
SET
    "componentKey" = 'VAT'::"TaxComponentKey",
    "externalTaxCodeSnapshot" = "taxCode",
    "taxProfileKeySnapshot" = 'SAP_ERP_TH_LEGACY',
    "taxProfileVersionSnapshot" = 1,
    "taxRegimeSnapshot" = 'VAT'::"TransactionTaxRegime",
    "taxDirectionSnapshot" = 'OUTPUT'::"TransactionTaxDirection",
    "taxTreatmentSnapshot" = 'NEEDS_REVIEW'::"TransactionTaxTreatment",
    "taxEvidenceReviewStatus" = 'REVIEW_REQUIRED'::"TaxEvidenceReviewStatus"
WHERE "taxCode" = 'O0'
  AND "taxCodeDefinitionId" IS NULL;

-- CreateIndex
CREATE INDEX "CompanyTaxCodeProfile_companyId_sourceSystem_status_effecti_idx" ON "CompanyTaxCodeProfile"("companyId", "sourceSystem", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "CompanyTaxCodeProfile_companyId_isDefault_status_effectiveF_idx" ON "CompanyTaxCodeProfile"("companyId", "isDefault", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "CompanyTaxCodeProfile_sourceAttachmentId_idx" ON "CompanyTaxCodeProfile"("sourceAttachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyTaxCodeProfile_companyId_sourceSystem_sourceProfileK_key" ON "CompanyTaxCodeProfile"("companyId", "sourceSystem", "sourceProfileKey", "effectiveFrom", "version");

-- CreateIndex
CREATE INDEX "TaxCodeDefinition_companyId_profileId_status_effectiveFrom__idx" ON "TaxCodeDefinition"("companyId", "profileId", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "TaxCodeDefinition_companyId_taxRegime_direction_treatment_s_idx" ON "TaxCodeDefinition"("companyId", "taxRegime", "direction", "treatment", "status");

-- CreateIndex
CREATE INDEX "TaxCodeDefinition_targetTaxCodeDefinitionId_idx" ON "TaxCodeDefinition"("targetTaxCodeDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCodeDefinition_profileId_direction_externalCode_effectiv_key" ON "TaxCodeDefinition"("profileId", "direction", "externalCode", "effectiveFrom", "version");

-- CreateIndex
CREATE INDEX "TaxAccountDeterminationRule_companyId_status_effectiveFrom__idx" ON "TaxAccountDeterminationRule"("companyId", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "TaxAccountDeterminationRule_companyId_taxRegime_direction_t_idx" ON "TaxAccountDeterminationRule"("companyId", "taxRegime", "direction", "treatment", "transactionContext", "status");

-- CreateIndex
CREATE INDEX "TaxAccountDeterminationRule_companyId_accountRole_status_idx" ON "TaxAccountDeterminationRule"("companyId", "accountRole", "status");

-- CreateIndex
CREATE INDEX "TaxAccountDeterminationRule_taxCodeDefinitionId_idx" ON "TaxAccountDeterminationRule"("taxCodeDefinitionId");

-- CreateIndex
CREATE INDEX "TaxAccountDeterminationRule_accountId_idx" ON "TaxAccountDeterminationRule"("accountId");

-- CreateIndex
CREATE INDEX "TaxReportMappingRule_companyId_formType_status_effectiveFro_idx" ON "TaxReportMappingRule"("companyId", "formType", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "TaxReportMappingRule_companyId_taxCodeDefinitionId_status_idx" ON "TaxReportMappingRule"("companyId", "taxCodeDefinitionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaxReportMappingRule_taxCodeDefinitionId_formType_boxKey_ef_key" ON "TaxReportMappingRule"("taxCodeDefinitionId", "formType", "boxKey", "effectiveFrom", "version");

-- CreateIndex
CREATE INDEX "TradeTaxEvidence_companyId_branchId_status_evidenceDate_idx" ON "TradeTaxEvidence"("companyId", "branchId", "status", "evidenceDate");

-- CreateIndex
CREATE INDEX "TradeTaxEvidence_companyId_sourceType_sourceId_sourceLineId_idx" ON "TradeTaxEvidence"("companyId", "sourceType", "sourceId", "sourceLineId");

-- CreateIndex
CREATE INDEX "TradeTaxEvidence_companyId_transactionContext_status_idx" ON "TradeTaxEvidence"("companyId", "transactionContext", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TradeTaxEvidence_companyId_idempotencyKey_key" ON "TradeTaxEvidence"("companyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "TaxReconciliationRun_companyId_branchId_formType_periodKey__idx" ON "TaxReconciliationRun"("companyId", "branchId", "formType", "periodKey", "status");

-- CreateIndex
CREATE INDEX "TaxReconciliationRun_companyId_formType_periodKey_checksum_idx" ON "TaxReconciliationRun"("companyId", "formType", "periodKey", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "TaxReconciliationRun_companyId_idempotencyKey_key" ON "TaxReconciliationRun"("companyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "TaxReconciliationLine_companyId_branchId_issueCode_blocking_idx" ON "TaxReconciliationLine"("companyId", "branchId", "issueCode", "blocking");

-- CreateIndex
CREATE INDEX "TaxReconciliationLine_companyId_sourceType_sourceId_sourceL_idx" ON "TaxReconciliationLine"("companyId", "sourceType", "sourceId", "sourceLineId");

-- CreateIndex
CREATE INDEX "TaxReconciliationLine_taxEventId_idx" ON "TaxReconciliationLine"("taxEventId");

-- CreateIndex
CREATE INDEX "TaxReconciliationLine_journalEntryId_idx" ON "TaxReconciliationLine"("journalEntryId");

-- CreateIndex
CREATE INDEX "TaxReconciliationLine_taxCodeDefinitionId_idx" ON "TaxReconciliationLine"("taxCodeDefinitionId");

-- CreateIndex
CREATE INDEX "TaxReconciliationLine_journalTaxAccountId_idx" ON "TaxReconciliationLine"("journalTaxAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxReconciliationLine_runId_sourceType_sourceId_sourceLineK_key" ON "TaxReconciliationLine"("runId", "sourceType", "sourceId", "sourceLineKey", "componentKey");

-- CreateIndex
CREATE INDEX "AccountingDocumentLine_companyId_taxCodeDefinitionId_idx" ON "AccountingDocumentLine"("companyId", "taxCodeDefinitionId");

-- CreateIndex
CREATE INDEX "AccountingDocumentLine_companyId_taxTreatmentSnapshot_idx" ON "AccountingDocumentLine"("companyId", "taxTreatmentSnapshot");

-- CreateIndex
CREATE INDEX "ExpenseLine_companyId_taxCodeDefinitionId_idx" ON "ExpenseLine"("companyId", "taxCodeDefinitionId");

-- CreateIndex
CREATE INDEX "ExpenseLine_companyId_taxTreatmentSnapshot_idx" ON "ExpenseLine"("companyId", "taxTreatmentSnapshot");

-- CreateIndex
CREATE INDEX "JournalLine_companyId_taxCodeDefinitionId_idx" ON "JournalLine"("companyId", "taxCodeDefinitionId");

-- CreateIndex
CREATE INDEX "JournalLine_companyId_taxTreatmentSnapshot_idx" ON "JournalLine"("companyId", "taxTreatmentSnapshot");

-- CreateIndex
CREATE INDEX "TaxEvent_companyId_branchId_sourceType_sourceId_sourceLineI_idx" ON "TaxEvent"("companyId", "branchId", "sourceType", "sourceId", "sourceLineId");

-- CreateIndex
CREATE INDEX "TaxEvent_companyId_taxCodeDefinitionId_status_idx" ON "TaxEvent"("companyId", "taxCodeDefinitionId", "status");

-- CreateIndex
CREATE INDEX "PurchaseRequestLine_companyId_taxCodeDefinitionId_idx" ON "PurchaseRequestLine"("companyId", "taxCodeDefinitionId");

-- CreateIndex
CREATE INDEX "PurchaseRequestLine_companyId_taxTreatmentSnapshot_idx" ON "PurchaseRequestLine"("companyId", "taxTreatmentSnapshot");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_companyId_taxCodeDefinitionId_idx" ON "PurchaseOrderLine"("companyId", "taxCodeDefinitionId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_companyId_taxTreatmentSnapshot_idx" ON "PurchaseOrderLine"("companyId", "taxTreatmentSnapshot");

-- CreateIndex
CREATE INDEX "VendorBillLine_companyId_taxCodeDefinitionId_idx" ON "VendorBillLine"("companyId", "taxCodeDefinitionId");

-- CreateIndex
CREATE INDEX "VendorBillLine_companyId_taxTreatmentSnapshot_idx" ON "VendorBillLine"("companyId", "taxTreatmentSnapshot");

-- AddForeignKey
ALTER TABLE "AccountingDocumentLine" ADD CONSTRAINT "AccountingDocumentLine_taxCodeDefinitionId_fkey" FOREIGN KEY ("taxCodeDefinitionId") REFERENCES "TaxCodeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_taxCodeDefinitionId_fkey" FOREIGN KEY ("taxCodeDefinitionId") REFERENCES "TaxCodeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_taxCodeDefinitionId_fkey" FOREIGN KEY ("taxCodeDefinitionId") REFERENCES "TaxCodeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxCodeProfile" ADD CONSTRAINT "CompanyTaxCodeProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxCodeProfile" ADD CONSTRAINT "CompanyTaxCodeProfile_sourceAttachmentId_fkey" FOREIGN KEY ("sourceAttachmentId") REFERENCES "AttachmentObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCodeDefinition" ADD CONSTRAINT "TaxCodeDefinition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCodeDefinition" ADD CONSTRAINT "TaxCodeDefinition_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CompanyTaxCodeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCodeDefinition" ADD CONSTRAINT "TaxCodeDefinition_targetTaxCodeDefinitionId_fkey" FOREIGN KEY ("targetTaxCodeDefinitionId") REFERENCES "TaxCodeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxAccountDeterminationRule" ADD CONSTRAINT "TaxAccountDeterminationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxAccountDeterminationRule" ADD CONSTRAINT "TaxAccountDeterminationRule_taxCodeDefinitionId_fkey" FOREIGN KEY ("taxCodeDefinitionId") REFERENCES "TaxCodeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxAccountDeterminationRule" ADD CONSTRAINT "TaxAccountDeterminationRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReportMappingRule" ADD CONSTRAINT "TaxReportMappingRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReportMappingRule" ADD CONSTRAINT "TaxReportMappingRule_taxCodeDefinitionId_fkey" FOREIGN KEY ("taxCodeDefinitionId") REFERENCES "TaxCodeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeTaxEvidence" ADD CONSTRAINT "TradeTaxEvidence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeTaxEvidence" ADD CONSTRAINT "TradeTaxEvidence_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReconciliationRun" ADD CONSTRAINT "TaxReconciliationRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReconciliationRun" ADD CONSTRAINT "TaxReconciliationRun_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReconciliationLine" ADD CONSTRAINT "TaxReconciliationLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReconciliationLine" ADD CONSTRAINT "TaxReconciliationLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TaxReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReconciliationLine" ADD CONSTRAINT "TaxReconciliationLine_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReconciliationLine" ADD CONSTRAINT "TaxReconciliationLine_taxEventId_fkey" FOREIGN KEY ("taxEventId") REFERENCES "TaxEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReconciliationLine" ADD CONSTRAINT "TaxReconciliationLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReconciliationLine" ADD CONSTRAINT "TaxReconciliationLine_taxCodeDefinitionId_fkey" FOREIGN KEY ("taxCodeDefinitionId") REFERENCES "TaxCodeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReconciliationLine" ADD CONSTRAINT "TaxReconciliationLine_journalTaxAccountId_fkey" FOREIGN KEY ("journalTaxAccountId") REFERENCES "ChartOfAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxEvent" ADD CONSTRAINT "TaxEvent_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxEvent" ADD CONSTRAINT "TaxEvent_taxCodeDefinitionId_fkey" FOREIGN KEY ("taxCodeDefinitionId") REFERENCES "TaxCodeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_taxCodeDefinitionId_fkey" FOREIGN KEY ("taxCodeDefinitionId") REFERENCES "TaxCodeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_taxCodeDefinitionId_fkey" FOREIGN KEY ("taxCodeDefinitionId") REFERENCES "TaxCodeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillLine" ADD CONSTRAINT "VendorBillLine_taxCodeDefinitionId_fkey" FOREIGN KEY ("taxCodeDefinitionId") REFERENCES "TaxCodeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
