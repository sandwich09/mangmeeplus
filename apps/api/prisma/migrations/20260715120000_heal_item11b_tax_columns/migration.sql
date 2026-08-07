-- Heals partial application of 20260714120000_item11b_transaction_tax_schema.
--
-- Prod dirty-deployed an earlier version of that migration on 2026-07-14, so its row in
-- _prisma_migrations is marked applied but the ALTER TABLE column-adds never landed. Because
-- the migration is recorded as applied, `migrate deploy` skips the finalized file and the
-- columns stay missing -> every read that includes these line/event tables throws
-- P2022 "column ... does not exist" (e.g. expense detail: prisma.expenseRecord include lines).
--
-- This migration re-asserts ONLY the enum types + tax-snapshot columns, idempotently, so it is a
-- no-op on correctly-migrated databases and adds the missing columns on drifted ones. The new tax
-- tables / FKs / one-time data backfills from the original migration are intentionally NOT replayed.

-- Enum types referenced by the snapshot columns (idempotent create).
DO $$ BEGIN CREATE TYPE "TransactionTaxRegime" AS ENUM ('VAT', 'IMPORT_VAT', 'CUSTOMS_DUTY', 'EXCISE_TAX', 'MUNICIPAL_OR_OTHER_IMPORT_TAX', 'WITHHOLDING_TAX', 'CORPORATE_INCOME_TAX_SUPPORT', 'OTHER_TRANSACTION_TAX'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "TransactionTaxDirection" AS ENUM ('OUTPUT', 'INPUT', 'SELF_ASSESSED', 'WITHHELD_PAYABLE', 'WITHHELD_RECEIVABLE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "TransactionTaxTreatment" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT', 'NON_TAXABLE', 'DEFERRED', 'REVERSE_CHARGE', 'CLAIMABLE', 'PENDING_EVIDENCE', 'PARTIALLY_DEDUCTIBLE', 'NONDEDUCTIBLE_EXPENSE', 'NONDEDUCTIBLE_CAPITALIZED', 'OUTSIDE_SCOPE', 'NEEDS_REVIEW'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "TransactionTaxContext" AS ENUM ('DOMESTIC_SALE', 'DOMESTIC_PURCHASE', 'IMPORT_GOODS', 'IMPORT_SERVICE', 'EXPORT_GOODS', 'EXPORT_SERVICE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT', 'MANUAL_TAX_ADJUSTMENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "TaxClaimability" AS ENUM ('NOT_APPLICABLE', 'CLAIMABLE', 'PENDING_EVIDENCE', 'PARTIAL', 'NONDEDUCTIBLE_EXPENSE', 'NONDEDUCTIBLE_CAPITALIZED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "TaxComponentKey" AS ENUM ('VAT', 'IMPORT_VAT', 'PP36_OUTPUT', 'PP36_INPUT', 'CUSTOMS_DUTY', 'EXCISE_TAX', 'OTHER_IMPORT_TAX'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "TaxEvidenceReviewStatus" AS ENUM ('DRAFT', 'REVIEW_REQUIRED', 'VERIFIED', 'REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AccountingDocumentLine
ALTER TABLE "AccountingDocumentLine"
  ADD COLUMN IF NOT EXISTS "accountAssignmentsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "accountRuleVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "claimabilitySnapshot" "TaxClaimability",
  ADD COLUMN IF NOT EXISTS "exchangeRateDateSnapshot" DATE,
  ADD COLUMN IF NOT EXISTS "exchangeRateSnapshot" DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS "exchangeRateSourceSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "externalTaxCodeSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "reportRuleVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "sourceCurrencySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxBaseAmount" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "taxCodeDefinitionId" TEXT,
  ADD COLUMN IF NOT EXISTS "taxComponentsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "taxContextSnapshot" "TransactionTaxContext",
  ADD COLUMN IF NOT EXISTS "taxCurrencySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxDirectionSnapshot" "TransactionTaxDirection",
  ADD COLUMN IF NOT EXISTS "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus",
  ADD COLUMN IF NOT EXISTS "taxProfileKeySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxProfileVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "taxRateSnapshot" DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS "taxRegimeSnapshot" "TransactionTaxRegime",
  ADD COLUMN IF NOT EXISTS "taxTreatmentSnapshot" "TransactionTaxTreatment",
  ADD COLUMN IF NOT EXISTS "transactionTaxAmount" DECIMAL(18,4);

-- ExpenseLine (the table behind the reported expense-detail 500)
ALTER TABLE "ExpenseLine"
  ADD COLUMN IF NOT EXISTS "accountAssignmentsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "accountRuleVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "claimabilitySnapshot" "TaxClaimability",
  ADD COLUMN IF NOT EXISTS "exchangeRateDateSnapshot" DATE,
  ADD COLUMN IF NOT EXISTS "exchangeRateSnapshot" DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS "exchangeRateSourceSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "externalTaxCodeSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "reportRuleVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "sourceCurrencySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxBaseAmount" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "taxCodeDefinitionId" TEXT,
  ADD COLUMN IF NOT EXISTS "taxComponentsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "taxContextSnapshot" "TransactionTaxContext",
  ADD COLUMN IF NOT EXISTS "taxCurrencySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxDirectionSnapshot" "TransactionTaxDirection",
  ADD COLUMN IF NOT EXISTS "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus",
  ADD COLUMN IF NOT EXISTS "taxProfileKeySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxProfileVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "taxRateSnapshot" DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS "taxRegimeSnapshot" "TransactionTaxRegime",
  ADD COLUMN IF NOT EXISTS "taxTreatmentSnapshot" "TransactionTaxTreatment",
  ADD COLUMN IF NOT EXISTS "transactionTaxAmount" DECIMAL(18,4);

-- JournalLine
ALTER TABLE "JournalLine"
  ADD COLUMN IF NOT EXISTS "accountRuleVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "claimabilitySnapshot" "TaxClaimability",
  ADD COLUMN IF NOT EXISTS "componentKey" "TaxComponentKey",
  ADD COLUMN IF NOT EXISTS "exchangeRateDateSnapshot" DATE,
  ADD COLUMN IF NOT EXISTS "exchangeRateSnapshot" DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS "exchangeRateSourceSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "externalTaxCodeSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "reportContributionsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "reportRuleVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "sourceCurrencySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxBaseAmount" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "taxCodeDefinitionId" TEXT,
  ADD COLUMN IF NOT EXISTS "taxContextSnapshot" "TransactionTaxContext",
  ADD COLUMN IF NOT EXISTS "taxCurrencySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxDirectionSnapshot" "TransactionTaxDirection",
  ADD COLUMN IF NOT EXISTS "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus",
  ADD COLUMN IF NOT EXISTS "taxProfileKeySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxProfileVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "taxRateSnapshot" DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS "taxRegimeSnapshot" "TransactionTaxRegime",
  ADD COLUMN IF NOT EXISTS "taxTreatmentSnapshot" "TransactionTaxTreatment",
  ADD COLUMN IF NOT EXISTS "transactionTaxAmount" DECIMAL(18,4);

-- TaxEvent
ALTER TABLE "TaxEvent"
  ADD COLUMN IF NOT EXISTS "accountAssignmentsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "accountRuleVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "branchId" TEXT,
  ADD COLUMN IF NOT EXISTS "claimabilitySnapshot" "TaxClaimability",
  ADD COLUMN IF NOT EXISTS "componentKey" "TaxComponentKey",
  ADD COLUMN IF NOT EXISTS "exchangeRateDateSnapshot" DATE,
  ADD COLUMN IF NOT EXISTS "exchangeRateSnapshot" DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS "exchangeRateSourceSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "externalTaxCodeSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "reportContributionsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "reportRuleVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "sourceLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceLineKey" TEXT NOT NULL DEFAULT '__HEADER__',
  ADD COLUMN IF NOT EXISTS "sourceCurrencySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxCodeDefinitionId" TEXT,
  ADD COLUMN IF NOT EXISTS "taxContextSnapshot" "TransactionTaxContext",
  ADD COLUMN IF NOT EXISTS "taxCurrencySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxDirectionSnapshot" "TransactionTaxDirection",
  ADD COLUMN IF NOT EXISTS "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus",
  ADD COLUMN IF NOT EXISTS "taxProfileKeySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxProfileVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "taxRateSnapshot" DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS "taxRegimeSnapshot" "TransactionTaxRegime",
  ADD COLUMN IF NOT EXISTS "taxTreatmentSnapshot" "TransactionTaxTreatment";

-- PurchaseRequestLine
ALTER TABLE "PurchaseRequestLine"
  ADD COLUMN IF NOT EXISTS "accountAssignmentsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "accountRuleVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "claimabilitySnapshot" "TaxClaimability",
  ADD COLUMN IF NOT EXISTS "exchangeRateDateSnapshot" DATE,
  ADD COLUMN IF NOT EXISTS "exchangeRateSnapshot" DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS "exchangeRateSourceSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "externalTaxCodeSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "reportRuleVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "sourceCurrencySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxBaseAmount" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "taxCodeDefinitionId" TEXT,
  ADD COLUMN IF NOT EXISTS "taxComponentsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "taxContextSnapshot" "TransactionTaxContext",
  ADD COLUMN IF NOT EXISTS "taxCurrencySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxDirectionSnapshot" "TransactionTaxDirection",
  ADD COLUMN IF NOT EXISTS "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus",
  ADD COLUMN IF NOT EXISTS "taxProfileKeySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxProfileVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "taxRateSnapshot" DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS "taxRegimeSnapshot" "TransactionTaxRegime",
  ADD COLUMN IF NOT EXISTS "taxTreatmentSnapshot" "TransactionTaxTreatment",
  ADD COLUMN IF NOT EXISTS "transactionTaxAmount" DECIMAL(18,4);

-- PurchaseOrderLine
ALTER TABLE "PurchaseOrderLine"
  ADD COLUMN IF NOT EXISTS "accountAssignmentsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "accountRuleVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "claimabilitySnapshot" "TaxClaimability",
  ADD COLUMN IF NOT EXISTS "exchangeRateDateSnapshot" DATE,
  ADD COLUMN IF NOT EXISTS "exchangeRateSnapshot" DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS "exchangeRateSourceSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "externalTaxCodeSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "reportRuleVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "sourceCurrencySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxBaseAmount" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "taxCodeDefinitionId" TEXT,
  ADD COLUMN IF NOT EXISTS "taxComponentsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "taxContextSnapshot" "TransactionTaxContext",
  ADD COLUMN IF NOT EXISTS "taxCurrencySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxDirectionSnapshot" "TransactionTaxDirection",
  ADD COLUMN IF NOT EXISTS "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus",
  ADD COLUMN IF NOT EXISTS "taxProfileKeySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxProfileVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "taxRateSnapshot" DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS "taxRegimeSnapshot" "TransactionTaxRegime",
  ADD COLUMN IF NOT EXISTS "taxTreatmentSnapshot" "TransactionTaxTreatment",
  ADD COLUMN IF NOT EXISTS "transactionTaxAmount" DECIMAL(18,4);

-- VendorBillLine
ALTER TABLE "VendorBillLine"
  ADD COLUMN IF NOT EXISTS "accountAssignmentsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "accountRuleVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "claimabilitySnapshot" "TaxClaimability",
  ADD COLUMN IF NOT EXISTS "exchangeRateDateSnapshot" DATE,
  ADD COLUMN IF NOT EXISTS "exchangeRateSnapshot" DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS "exchangeRateSourceSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "externalTaxCodeSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "reportRuleVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "sourceCurrencySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxBaseAmount" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "taxCodeDefinitionId" TEXT,
  ADD COLUMN IF NOT EXISTS "taxComponentsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "taxContextSnapshot" "TransactionTaxContext",
  ADD COLUMN IF NOT EXISTS "taxCurrencySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxDirectionSnapshot" "TransactionTaxDirection",
  ADD COLUMN IF NOT EXISTS "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus",
  ADD COLUMN IF NOT EXISTS "taxProfileKeySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "taxProfileVersionSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "taxRateSnapshot" DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS "taxRegimeSnapshot" "TransactionTaxRegime",
  ADD COLUMN IF NOT EXISTS "taxTreatmentSnapshot" "TransactionTaxTreatment",
  ADD COLUMN IF NOT EXISTS "transactionTaxAmount" DECIMAL(18,4);
