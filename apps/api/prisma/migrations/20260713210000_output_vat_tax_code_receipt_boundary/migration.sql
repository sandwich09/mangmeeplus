CREATE TYPE "AccountingOutputTaxCode" AS ENUM ('O7', 'OX', 'O0');

ALTER TABLE "AccountingDocument"
ADD COLUMN "outputTaxCode" "AccountingOutputTaxCode";

ALTER TABLE "TaxEvent"
ADD COLUMN "outputTaxCode" "AccountingOutputTaxCode";

-- Preserve legacy tax-document intent without treating plain receipts or invoices as tax evidence.
UPDATE "AccountingDocument"
SET "outputTaxCode" = CASE
  WHEN "vatMode" = 'EXEMPT' AND "vatAmount" = 0 THEN 'OX'::"AccountingOutputTaxCode"
  WHEN "vatMode" IN ('VAT_INCLUDED', 'VAT_EXCLUDED') AND "vatAmount" > 0 THEN 'O7'::"AccountingOutputTaxCode"
  WHEN "vatMode" = 'NO_VAT' AND "vatAmount" = 0 THEN 'O0'::"AccountingOutputTaxCode"
  ELSE NULL
END
WHERE "documentType" IN ('TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- Ambiguous legacy tax documents stay review-gated instead of being guessed as zero-rated.
UPDATE "AccountingDocument"
SET "vatMode" = 'NEEDS_REVIEW'
WHERE "documentType" IN ('TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE')
  AND "outputTaxCode" IS NULL;

UPDATE "AccountingDocument"
SET "outputTaxCode" = 'O0'::"AccountingOutputTaxCode"
WHERE "documentType" = 'INVOICE'
  AND "vatMode" = 'NO_VAT';

UPDATE "TaxEvent" AS event
SET "outputTaxCode" = document."outputTaxCode"
FROM "AccountingDocument" AS document
WHERE event."sourceType" = 'accounting.document'
  AND event."sourceId" = document."id"
  AND document."documentType" IN ('TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- Old receipt/invoice-derived VAT events violated the legal document boundary.
UPDATE "TaxEvent" AS event
SET "status" = 'SUPERSEDED'
FROM "AccountingDocument" AS document
WHERE event."sourceType" = 'accounting.document'
  AND event."sourceId" = document."id"
  AND event."eventType" IN ('VAT_OUTPUT', 'VAT_EXEMPT')
  AND document."documentType" NOT IN ('TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- Credit notes reduce the referenced output tax; keep retries idempotent with signed facts.
UPDATE "TaxEvent" AS event
SET "taxableBase" = -ABS(event."taxableBase"),
    "taxAmount" = -ABS(event."taxAmount")
FROM "AccountingDocument" AS document
WHERE event."sourceType" = 'accounting.document'
  AND event."sourceId" = document."id"
  AND event."eventType" IN ('VAT_OUTPUT', 'VAT_EXEMPT')
  AND document."documentType" = 'CREDIT_NOTE';

ALTER TABLE "AccountingDocument"
ADD CONSTRAINT "AccountingDocument_output_tax_code_role_check"
CHECK (
  ("documentType" IN ('QUOTATION', 'BILLING_NOTE', 'RECEIPT') AND "outputTaxCode" IS NULL)
  OR ("documentType" = 'INVOICE' AND ("outputTaxCode" IS NULL OR ("outputTaxCode" = 'O0' AND "vatMode" = 'NO_VAT')))
  OR (
    "documentType" IN ('TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE')
    AND (
      ("outputTaxCode" = 'O7' AND "vatMode" IN ('VAT_INCLUDED', 'VAT_EXCLUDED') AND "vatAmount" > 0)
      OR ("outputTaxCode" = 'OX' AND "vatMode" = 'EXEMPT' AND "vatAmount" = 0)
      OR ("outputTaxCode" = 'O0' AND "vatMode" = 'NO_VAT' AND "vatAmount" = 0)
      OR ("outputTaxCode" IS NULL AND "vatMode" = 'NEEDS_REVIEW')
    )
  )
);

CREATE INDEX "AccountingDocument_companyId_outputTaxCode_status_idx"
ON "AccountingDocument"("companyId", "outputTaxCode", "status");
