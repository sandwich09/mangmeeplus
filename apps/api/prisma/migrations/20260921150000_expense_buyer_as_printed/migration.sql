-- Vendor address spec §6 / Slice 2: the buyer block a full tax invoice printed, and how it compared
-- with the company registry.
--
-- Additive and idempotent, with NO backfill: the comparison is warn-only (§8), so a NULL row simply
-- has no comparison yet. A draft read before this column existed is re-checked from its
-- `aiVerifiedFieldsJson` on its next review save.
ALTER TABLE "ExpenseRecord" ADD COLUMN IF NOT EXISTS "buyerAsPrintedJson" JSONB;
