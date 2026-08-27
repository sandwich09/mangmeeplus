-- Additive capture only: never infer historical rates/treatment or rewrite money totals.
ALTER TABLE "ExpenseRecord" ADD COLUMN "whtInputJson" JSONB;
ALTER TABLE "ExpenseLine" ADD COLUMN "vatTreatment" TEXT;
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_vatTreatment_check"
  CHECK ("vatTreatment" IS NULL OR ("vatTreatment" IN ('ZERO_RATED', 'EXEMPT', 'NON_VAT') AND "vatRate" IS NOT NULL AND "vatRate" = 0));
