-- Audit CR-2 / chart-of-accounts bootstrap spec §9.2.
-- Reviewed ledger account per expense category. Nullable on purpose: every existing category starts
-- unmapped and posting reports `expense_account_unmapped` naming it, which is the spec's
-- "leave unreviewed mappings incomplete and visible" rule. Backfilling a guess here would put every
-- expense into whatever account the guess named, so no default is set.
ALTER TABLE "ExpenseCategory" ADD COLUMN "ledgerAccountCode" TEXT;
