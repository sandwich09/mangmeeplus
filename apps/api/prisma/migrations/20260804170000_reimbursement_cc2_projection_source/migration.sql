-- CC2: one durable expense projection per reimbursement claim line.
ALTER TABLE "ExpenseRecord"
  ADD COLUMN IF NOT EXISTS "sourceReimbursementLineId" TEXT;

ALTER TABLE "ReimbursementRequest"
  ADD COLUMN IF NOT EXISTS "cancellationPendingAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancellationPendingByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "cancellationPendingReason" TEXT;

-- The preceding reimbursement compatibility migration guarantees lines exist.
-- Refuse an ambiguous legacy bridge row instead of guessing or asking a user to
-- re-key accounting evidence.
DO $$
DECLARE
  invalid_count BIGINT;
BEGIN
  SELECT count(*) INTO invalid_count
  FROM "ExpenseRecord" expense
  WHERE expense."sourceReimbursementRequestId" IS NOT NULL
    AND expense."sourceReimbursementLineId" IS NULL
    AND (
      SELECT count(*)
      FROM "ReimbursementLine" line
      WHERE line."companyId" = expense."companyId"
        AND line."reimbursementRequestId" = expense."sourceReimbursementRequestId"
        AND line."linkedExpenseId" = expense."id"
    ) <> 1;

  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'CC2 backfill requires one exact reimbursement line per claim-born expense; invalid rows=%', invalid_count;
  END IF;
END $$;

UPDATE "ExpenseRecord" expense
SET "sourceReimbursementLineId" = line."id"
FROM "ReimbursementLine" line
WHERE expense."sourceReimbursementLineId" IS NULL
  AND expense."sourceReimbursementRequestId" IS NOT NULL
  AND line."companyId" = expense."companyId"
  AND line."reimbursementRequestId" = expense."sourceReimbursementRequestId"
  AND line."linkedExpenseId" = expense."id";

-- Tenant/parent/branch provenance must be provable before composite keys are
-- installed. Never rewrite a branch or parent during deploy: that is a business
-- decision, not a migration default.
DO $$
DECLARE
  invalid_request_branch_count BIGINT;
  invalid_line_parent_count BIGINT;
  invalid_expense_request_count BIGINT;
  invalid_expense_line_count BIGINT;
BEGIN
  SELECT count(*) INTO invalid_request_branch_count
  FROM "ReimbursementRequest" request
  LEFT JOIN "Branch" branch
    ON branch."companyId" = request."companyId"
   AND branch."id" = request."branchId"
  WHERE request."branchId" IS NOT NULL
    AND branch."id" IS NULL;

  SELECT count(*) INTO invalid_line_parent_count
  FROM "ReimbursementLine" line
  LEFT JOIN "ReimbursementRequest" request
    ON request."companyId" = line."companyId"
   AND request."id" = line."reimbursementRequestId"
  WHERE request."id" IS NULL;

  SELECT count(*) INTO invalid_expense_request_count
  FROM "ExpenseRecord" expense
  LEFT JOIN "ReimbursementRequest" request
    ON request."companyId" = expense."companyId"
   AND request."id" = expense."sourceReimbursementRequestId"
  WHERE expense."sourceReimbursementRequestId" IS NOT NULL
    AND request."id" IS NULL;

  SELECT count(*) INTO invalid_expense_line_count
  FROM "ExpenseRecord" expense
  LEFT JOIN "ReimbursementLine" line
    ON line."companyId" = expense."companyId"
   AND line."reimbursementRequestId" = expense."sourceReimbursementRequestId"
   AND line."id" = expense."sourceReimbursementLineId"
  WHERE expense."sourceReimbursementLineId" IS NOT NULL
    AND line."id" IS NULL;

  IF invalid_request_branch_count <> 0
    OR invalid_line_parent_count <> 0
    OR invalid_expense_request_count <> 0
    OR invalid_expense_line_count <> 0 THEN
    RAISE EXCEPTION 'CC2 tenant/parent preflight failed; request_branch=%, line_parent=%, expense_request=%, expense_line=%',
      invalid_request_branch_count, invalid_line_parent_count,
      invalid_expense_request_count, invalid_expense_line_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ReimbursementRequest_companyId_id_key"
  ON "ReimbursementRequest"("companyId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "ReimbursementLine_companyId_id_key"
  ON "ReimbursementLine"("companyId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "ReimbursementLine_companyId_reimbursementRequestId_id_key"
  ON "ReimbursementLine"("companyId", "reimbursementRequestId", "id");

-- A posted/confirmed legacy bridge row may already have affected accounting or
-- tax. Never reinterpret it during deploy. The aggregate count is part of the
-- migration error consumed by clone/A5 evidence.
DO $$
DECLARE
  finalized_ambiguous_count BIGINT;
BEGIN
  SELECT count(*) INTO finalized_ambiguous_count
  FROM "ExpenseRecord"
  WHERE "sourceReimbursementLineId" IS NOT NULL
    AND coalesce("sourceChannelMetadataJson"->>'cc2VatClaimClassification', '') = ''
    AND (
      "status"::text IN ('CONFIRMED', 'VOIDED')
      OR "postingStatus"::text IN ('posted', 'reversed')
    );

  IF finalized_ambiguous_count <> 0 THEN
    RAISE EXCEPTION 'CC2 finalized claim VAT rows require reviewed reconciliation before migration; rows=%', finalized_ambiguous_count;
  END IF;
END $$;

-- Old bridge rows that never reached accounting are safe to restore to the
-- neutral state. Preserve every stored amount and evidence reference.
UPDATE "ExpenseRecord"
SET "vatMode" = 'NEEDS_REVIEW'::"ExpenseVatMode",
    "inputVatClaimStatus" = 'NEEDS_REVIEW'::"InputVatClaimStatus",
    "sourceDocumentType" = 'NEEDS_REVIEW'::"SourceDocumentType",
    "taxEvidenceStatus" = 'NEEDS_REVIEW'::"TaxEvidenceStatus",
    "sourceChannelMetadataJson" = jsonb_set(
      coalesce("sourceChannelMetadataJson"::jsonb, '{}'::jsonb),
      '{cc2VatClaimClassification}',
      '"EXTERNAL_OR_UNRESOLVED"'::jsonb,
      true
    )
WHERE "sourceReimbursementLineId" IS NOT NULL
  AND "status"::text NOT IN ('CONFIRMED', 'VOIDED')
  AND "postingStatus"::text NOT IN ('posted', 'reversed');

DO $$
DECLARE
  duplicate_count BIGINT;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT "companyId", "sourceReimbursementLineId"
    FROM "ExpenseRecord"
    WHERE "sourceReimbursementLineId" IS NOT NULL
    GROUP BY "companyId", "sourceReimbursementLineId"
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_count <> 0 THEN
    RAISE EXCEPTION 'CC2 source-line projection identity is duplicated; duplicate keys=%', duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ExpenseRecord_companyId_sourceReimbursementLineId_key"
  ON "ExpenseRecord"("companyId", "sourceReimbursementLineId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExpenseRecord_companyId_sourceReimbursementRequestId_sourceReimbursementLineId_key"
  ON "ExpenseRecord"("companyId", "sourceReimbursementRequestId", "sourceReimbursementLineId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ReimbursementRequest_companyId_branchId_fkey'
      AND conrelid = '"ReimbursementRequest"'::regclass
  ) THEN
    ALTER TABLE "ReimbursementRequest"
      ADD CONSTRAINT "ReimbursementRequest_companyId_branchId_fkey"
      FOREIGN KEY ("companyId", "branchId")
      REFERENCES "Branch"("companyId", "id")
      ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ReimbursementLine_companyId_reimbursementRequestId_fkey'
      AND conrelid = '"ReimbursementLine"'::regclass
  ) THEN
    ALTER TABLE "ReimbursementLine"
      ADD CONSTRAINT "ReimbursementLine_companyId_reimbursementRequestId_fkey"
      FOREIGN KEY ("companyId", "reimbursementRequestId")
      REFERENCES "ReimbursementRequest"("companyId", "id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ExpenseRecord_companyId_sourceReimbursementRequestId_fkey'
      AND conrelid = '"ExpenseRecord"'::regclass
  ) THEN
    ALTER TABLE "ExpenseRecord"
      ADD CONSTRAINT "ExpenseRecord_companyId_sourceReimbursementRequestId_fkey"
      FOREIGN KEY ("companyId", "sourceReimbursementRequestId")
      REFERENCES "ReimbursementRequest"("companyId", "id")
      ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ExpenseRecord_reimbursement_source_line_fkey'
      AND conrelid = '"ExpenseRecord"'::regclass
  ) THEN
    ALTER TABLE "ExpenseRecord"
      ADD CONSTRAINT "ExpenseRecord_reimbursement_source_line_fkey"
      FOREIGN KEY ("companyId", "sourceReimbursementRequestId", "sourceReimbursementLineId")
      REFERENCES "ReimbursementLine"("companyId", "reimbursementRequestId", "id")
      ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE "ReimbursementRequest"
  VALIDATE CONSTRAINT "ReimbursementRequest_companyId_branchId_fkey";
ALTER TABLE "ReimbursementLine"
  VALIDATE CONSTRAINT "ReimbursementLine_companyId_reimbursementRequestId_fkey";
ALTER TABLE "ExpenseRecord"
  VALIDATE CONSTRAINT "ExpenseRecord_companyId_sourceReimbursementRequestId_fkey";
ALTER TABLE "ExpenseRecord"
  VALIDATE CONSTRAINT "ExpenseRecord_reimbursement_source_line_fkey";

-- The composite relation supersedes the legacy global-id-only parent FK.
ALTER TABLE "ReimbursementLine"
  DROP CONSTRAINT IF EXISTS "ReimbursementLine_reimbursementRequestId_fkey";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ExpenseRecord_reimbursement_source_pair_check'
      AND conrelid = '"ExpenseRecord"'::regclass
  ) THEN
    ALTER TABLE "ExpenseRecord"
      ADD CONSTRAINT "ExpenseRecord_reimbursement_source_pair_check"
      CHECK (("sourceReimbursementRequestId" IS NULL) = ("sourceReimbursementLineId" IS NULL))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE "ExpenseRecord"
  VALIDATE CONSTRAINT "ExpenseRecord_reimbursement_source_pair_check";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ExpenseRecord_cc2_vat_classification_check'
      AND conrelid = '"ExpenseRecord"'::regclass
  ) THEN
    ALTER TABLE "ExpenseRecord"
      ADD CONSTRAINT "ExpenseRecord_cc2_vat_classification_check"
      CHECK (
        "sourceReimbursementLineId" IS NULL
        OR "sourceChannelMetadataJson"->>'cc2VatClaimClassification' IN (
          'CLAIMABLE', 'PARTIALLY_RECOVERABLE', 'NON_RECOVERABLE_CONFIRMED',
          'EXTERNAL_OR_UNRESOLVED', 'NOT_APPLICABLE'
        )
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE "ExpenseRecord"
  VALIDATE CONSTRAINT "ExpenseRecord_cc2_vat_classification_check";
