-- Company chart-template provenance is nullable for legacy companies. New onboarding stamps
-- these fields only after all 175 company-owned rows pass the in-transaction post-condition.
ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "chartOfAccountsTemplateKey" TEXT,
  ADD COLUMN IF NOT EXISTS "chartOfAccountsTemplateVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "chartOfAccountsTemplateChecksum" TEXT,
  ADD COLUMN IF NOT EXISTS "chartOfAccountsTemplateAppliedAt" TIMESTAMP(3);

-- Suggestions remain review-required; this records their template origin without activating
-- or changing any existing tax rule.
ALTER TABLE "TaxAccountDeterminationRule"
  ADD COLUMN IF NOT EXISTS "sourceMetadataJson" JSONB;

-- Stop before adding the company-scoped FK if any existing bank link violates the same rule
-- enforced by the API. An operator must repair the named bank rows deliberately; this migration
-- never clears or rewrites a customer link.
DO $$
DECLARE
  invalid_count INTEGER;
  invalid_ids TEXT;
BEGIN
  SELECT COUNT(*)
    INTO invalid_count
  FROM "BankAccount" bank
  LEFT JOIN "ChartOfAccount" account
    ON account."companyId" = bank."companyId"
   AND account."id" = bank."ledgerAccountId"
  WHERE bank."ledgerAccountId" IS NOT NULL
    AND (
      account."id" IS NULL
      OR account."status" <> 'ACTIVE'
      OR account."isPosting" = FALSE
      OR account."isControlled" = TRUE
      OR account."accountClass" <> 'ASSET'
      OR account."normalBalance" <> 'DEBIT'
      OR NOT (
        UPPER(TRIM(COALESCE(account."cashFlowCategory", ''))) IN ('BANK', 'CASH', 'CASH_AND_BANK', 'CASH_OR_BANK')
        OR LOWER(TRIM(COALESCE(account."reportGroup", ''))) = 'cash'
        OR account."code" ~ '^111[1-4]-[0-9]{2}$'
      )
    );

  SELECT STRING_AGG(invalid."id", ', ' ORDER BY invalid."id")
    INTO invalid_ids
  FROM (
    SELECT bank."id"
    FROM "BankAccount" bank
    LEFT JOIN "ChartOfAccount" account
      ON account."companyId" = bank."companyId"
     AND account."id" = bank."ledgerAccountId"
    WHERE bank."ledgerAccountId" IS NOT NULL
      AND (
        account."id" IS NULL
        OR account."status" <> 'ACTIVE'
        OR account."isPosting" = FALSE
        OR account."isControlled" = TRUE
        OR account."accountClass" <> 'ASSET'
        OR account."normalBalance" <> 'DEBIT'
        OR NOT (
          UPPER(TRIM(COALESCE(account."cashFlowCategory", ''))) IN ('BANK', 'CASH', 'CASH_AND_BANK', 'CASH_OR_BANK')
          OR LOWER(TRIM(COALESCE(account."reportGroup", ''))) = 'cash'
          OR account."code" ~ '^111[1-4]-[0-9]{2}$'
        )
      )
    ORDER BY bank."id"
    LIMIT 20
  ) invalid;

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'ledger_account_invalid_for_bank: % invalid BankAccount link(s); first ids: %',
      invalid_count,
      invalid_ids
      USING ERRCODE = '23514';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ChartOfAccount_companyId_id_key"
  ON "ChartOfAccount"("companyId", "id");

DO $$
BEGIN
  ALTER TABLE "BankAccount"
    ADD CONSTRAINT "BankAccount_companyId_ledgerAccountId_fkey"
    FOREIGN KEY ("companyId", "ledgerAccountId")
    REFERENCES "ChartOfAccount"("companyId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
