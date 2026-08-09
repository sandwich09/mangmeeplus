-- Attestation seam for the reviewed ledger account behind an expense category (audit CR-2).
-- Onboarding now seeds the binding from the chart template's mapping, so `ledgerAccountCode` can
-- no longer double as the "nobody reviewed this" signal. These columns carry that instead, matching
-- the reviewedByUserId/reviewedAt pair the tax-config bootstrap already uses for the same problem.
ALTER TABLE "ExpenseCategory"
  ADD COLUMN "ledgerAccountReviewedByUserId" TEXT,
  ADD COLUMN "ledgerAccountReviewedAt" TIMESTAMP(3);

-- Existing bound categories were bound by a human through the posting-rule route (the only writer
-- before this change). Leaving the reviewer null would report them as unreviewed seeds, which is
-- the opposite of the truth; the audit log holds who and when, so backfill only the fact.
UPDATE "ExpenseCategory"
  SET "ledgerAccountReviewedByUserId" = 'system:pre-attestation-review'
  WHERE "ledgerAccountCode" IS NOT NULL;
