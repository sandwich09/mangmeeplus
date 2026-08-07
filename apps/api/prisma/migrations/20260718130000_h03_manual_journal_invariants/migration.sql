-- H-03: fail closed when historical rows already violate tenant/provenance
-- coherence. Repair must be reviewed; this migration never guesses ownership.
SET lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "JournalEntry" je
    JOIN "AccountingPeriod" ap ON ap."id" = je."periodId"
    WHERE ap."companyId" <> je."companyId"
  ) THEN RAISE EXCEPTION 'H-03: cross-company journal period rows require manual repair';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je."id" = jl."journalEntryId"
    WHERE je."companyId" <> jl."companyId"
  ) THEN RAISE EXCEPTION 'H-03: cross-company journal line rows require manual repair';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "JournalLine" jl
    LEFT JOIN "ChartOfAccount" a ON a."id" = jl."accountId"
    WHERE a."id" IS NULL
       OR NOT (a."companyId" = jl."companyId" OR (a."companyId" IS NULL AND a."isSystem" = true))
  ) THEN RAISE EXCEPTION 'H-03: journal lines with foreign/unapproved accounts require manual repair';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "JournalLine" jl
    LEFT JOIN "Branch" b ON b."id" = jl."branchId"
    WHERE jl."branchId" IS NOT NULL AND (b."id" IS NULL OR b."companyId" <> jl."companyId")
  ) THEN RAISE EXCEPTION 'H-03: journal lines with foreign branches require manual repair';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je."id" = jl."journalEntryId" AND je."companyId" = jl."companyId"
    WHERE je."entryType" = 'MANUAL'
      AND (jl."sourceType" IS NOT NULL OR jl."sourceId" IS NOT NULL OR jl."taxCode" IS NOT NULL
        OR jl."componentKey" IS NOT NULL OR jl."taxCodeDefinitionId" IS NOT NULL
        OR jl."externalTaxCodeSnapshot" IS NOT NULL OR jl."taxProfileKeySnapshot" IS NOT NULL
        OR jl."taxProfileVersionSnapshot" IS NOT NULL OR jl."roundingModeSnapshot" IS NOT NULL
        OR jl."roundingScaleSnapshot" IS NOT NULL OR jl."taxAmountToleranceSnapshot" IS NOT NULL
        OR jl."taxRegimeSnapshot" IS NOT NULL OR jl."taxDirectionSnapshot" IS NOT NULL
        OR jl."taxTreatmentSnapshot" IS NOT NULL OR jl."taxContextSnapshot" IS NOT NULL
        OR jl."taxRateSnapshot" IS NOT NULL OR jl."sourceCurrencySnapshot" IS NOT NULL
        OR jl."taxCurrencySnapshot" IS NOT NULL OR jl."exchangeRateSnapshot" IS NOT NULL
        OR jl."exchangeRateSourceSnapshot" IS NOT NULL OR jl."exchangeRateDateSnapshot" IS NOT NULL
        OR jl."taxBaseAmount" IS NOT NULL OR jl."transactionTaxAmount" IS NOT NULL
        OR jl."claimabilitySnapshot" IS NOT NULL OR jl."accountRuleVersionSnapshot" IS NOT NULL
        OR jl."reportRuleVersionSnapshot" IS NOT NULL OR jl."taxEvidenceReviewStatus" IS NOT NULL
        OR jl."reportContributionsJson" IS NOT NULL)
  ) THEN RAISE EXCEPTION 'H-03: manual journal caller provenance/tax rows require manual repair';
  END IF;
END $$;

ALTER TABLE "Branch" ADD CONSTRAINT "Branch_companyId_id_key" UNIQUE ("companyId", "id");
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_companyId_id_key" UNIQUE ("companyId", "id");
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_companyId_id_key" UNIQUE ("companyId", "id");

ALTER TABLE "JournalEntry" DROP CONSTRAINT "JournalEntry_periodId_fkey";
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_companyId_periodId_fkey"
  FOREIGN KEY ("companyId", "periodId") REFERENCES "AccountingPeriod"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "JournalLine" DROP CONSTRAINT "JournalLine_journalEntryId_fkey";
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_companyId_journalEntryId_fkey"
  FOREIGN KEY ("companyId", "journalEntryId") REFERENCES "JournalEntry"("companyId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_companyId_branchId_fkey"
  FOREIGN KEY ("companyId", "branchId") REFERENCES "Branch"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "JournalEntry" VALIDATE CONSTRAINT "JournalEntry_companyId_periodId_fkey";
ALTER TABLE "JournalLine" VALIDATE CONSTRAINT "JournalLine_companyId_journalEntryId_fkey";
ALTER TABLE "JournalLine" VALIDATE CONSTRAINT "JournalLine_companyId_branchId_fkey";

-- A normal composite FK cannot express "same company OR approved global system
-- account" because ChartOfAccount.companyId is nullable. Enforce that union at
-- the database boundary and re-check status/posting eligibility for MANUAL rows.
CREATE OR REPLACE FUNCTION enforce_journal_line_tenant_invariants()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  is_manual boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ChartOfAccount" a
    WHERE a."id" = NEW."accountId"
      AND (a."companyId" = NEW."companyId" OR (a."companyId" IS NULL AND a."isSystem" = true))
  ) THEN RAISE EXCEPTION 'journal account is outside company scope' USING ERRCODE = '23514';
  END IF;

  IF NEW."branchId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Branch" b WHERE b."id" = NEW."branchId" AND b."companyId" = NEW."companyId"
  ) THEN RAISE EXCEPTION 'journal branch is outside company scope' USING ERRCODE = '23514';
  END IF;

  SELECT je."entryType" = 'MANUAL' INTO is_manual
  FROM "JournalEntry" je
  WHERE je."id" = NEW."journalEntryId" AND je."companyId" = NEW."companyId";

  IF is_manual THEN
    IF NOT EXISTS (
      SELECT 1 FROM "ChartOfAccount" a
      WHERE a."id" = NEW."accountId" AND a."status" = 'ACTIVE' AND a."isPosting" = true
    ) THEN RAISE EXCEPTION 'manual journal account is inactive or non-posting' USING ERRCODE = '23514';
    END IF;
    IF NEW."branchId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Branch" b WHERE b."id" = NEW."branchId" AND b."companyId" = NEW."companyId" AND b."status" = 'ACTIVE'
    ) THEN RAISE EXCEPTION 'manual journal branch is inactive' USING ERRCODE = '23514';
    END IF;
    IF NEW."sourceType" IS NOT NULL OR NEW."sourceId" IS NOT NULL OR NEW."taxCode" IS NOT NULL
      OR NEW."componentKey" IS NOT NULL OR NEW."taxCodeDefinitionId" IS NOT NULL
      OR NEW."externalTaxCodeSnapshot" IS NOT NULL OR NEW."taxProfileKeySnapshot" IS NOT NULL
      OR NEW."taxProfileVersionSnapshot" IS NOT NULL OR NEW."roundingModeSnapshot" IS NOT NULL
      OR NEW."roundingScaleSnapshot" IS NOT NULL OR NEW."taxAmountToleranceSnapshot" IS NOT NULL
      OR NEW."taxRegimeSnapshot" IS NOT NULL OR NEW."taxDirectionSnapshot" IS NOT NULL
      OR NEW."taxTreatmentSnapshot" IS NOT NULL OR NEW."taxContextSnapshot" IS NOT NULL
      OR NEW."taxRateSnapshot" IS NOT NULL OR NEW."sourceCurrencySnapshot" IS NOT NULL
      OR NEW."taxCurrencySnapshot" IS NOT NULL OR NEW."exchangeRateSnapshot" IS NOT NULL
      OR NEW."exchangeRateSourceSnapshot" IS NOT NULL OR NEW."exchangeRateDateSnapshot" IS NOT NULL
      OR NEW."taxBaseAmount" IS NOT NULL OR NEW."transactionTaxAmount" IS NOT NULL
      OR NEW."claimabilitySnapshot" IS NOT NULL OR NEW."accountRuleVersionSnapshot" IS NOT NULL
      OR NEW."reportRuleVersionSnapshot" IS NOT NULL OR NEW."taxEvidenceReviewStatus" IS NOT NULL
      OR NEW."reportContributionsJson" IS NOT NULL
    THEN RAISE EXCEPTION 'manual journal provenance and tax metadata are server-owned' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "JournalLine_tenant_invariants"
BEFORE INSERT OR UPDATE ON "JournalLine"
FOR EACH ROW EXECUTE FUNCTION enforce_journal_line_tenant_invariants();

CREATE OR REPLACE FUNCTION enforce_manual_journal_post_invariants()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."entryType" = 'MANUAL' AND NEW."status" = 'POSTED' AND OLD."status" IS DISTINCT FROM NEW."status" AND EXISTS (
    SELECT 1 FROM "JournalLine" jl
    LEFT JOIN "ChartOfAccount" a ON a."id" = jl."accountId"
    LEFT JOIN "Branch" b ON b."id" = jl."branchId"
    WHERE jl."journalEntryId" = NEW."id" AND (
      jl."companyId" <> NEW."companyId"
      OR a."id" IS NULL OR a."status" <> 'ACTIVE' OR a."isPosting" = false
      OR NOT (a."companyId" = NEW."companyId" OR (a."companyId" IS NULL AND a."isSystem" = true))
      OR (jl."branchId" IS NOT NULL AND (b."id" IS NULL OR b."companyId" <> NEW."companyId" OR b."status" <> 'ACTIVE'))
      OR jl."sourceType" IS NOT NULL OR jl."sourceId" IS NOT NULL OR jl."taxCode" IS NOT NULL
      OR jl."componentKey" IS NOT NULL OR jl."taxCodeDefinitionId" IS NOT NULL
      OR jl."externalTaxCodeSnapshot" IS NOT NULL OR jl."taxProfileKeySnapshot" IS NOT NULL
      OR jl."taxProfileVersionSnapshot" IS NOT NULL OR jl."roundingModeSnapshot" IS NOT NULL
      OR jl."roundingScaleSnapshot" IS NOT NULL OR jl."taxAmountToleranceSnapshot" IS NOT NULL
      OR jl."taxRegimeSnapshot" IS NOT NULL OR jl."taxDirectionSnapshot" IS NOT NULL
      OR jl."taxTreatmentSnapshot" IS NOT NULL OR jl."taxContextSnapshot" IS NOT NULL
      OR jl."taxRateSnapshot" IS NOT NULL OR jl."sourceCurrencySnapshot" IS NOT NULL
      OR jl."taxCurrencySnapshot" IS NOT NULL OR jl."exchangeRateSnapshot" IS NOT NULL
      OR jl."exchangeRateSourceSnapshot" IS NOT NULL OR jl."exchangeRateDateSnapshot" IS NOT NULL
      OR jl."taxBaseAmount" IS NOT NULL OR jl."transactionTaxAmount" IS NOT NULL
      OR jl."claimabilitySnapshot" IS NOT NULL OR jl."accountRuleVersionSnapshot" IS NOT NULL
      OR jl."reportRuleVersionSnapshot" IS NOT NULL OR jl."taxEvidenceReviewStatus" IS NOT NULL
      OR jl."reportContributionsJson" IS NOT NULL
    )
  ) THEN RAISE EXCEPTION 'manual journal post violates tenant/branch/provenance invariants' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "JournalEntry_manual_post_invariants"
BEFORE UPDATE OF "status" ON "JournalEntry"
FOR EACH ROW EXECUTE FUNCTION enforce_manual_journal_post_invariants();
