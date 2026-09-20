-- Vendor address spec §6: the seller address as printed on the document we received.
--
-- Additive and idempotent, with NO backfill: §8 says a missing address must never block anything,
-- so every existing row stays NULL and keeps its current evidence/claim status untouched. The
-- filter `vendorAddressMissing=true` is how old rows are filled in over time.
ALTER TABLE "ExpenseRecord" ADD COLUMN IF NOT EXISTS "vendorAddressSnapshot" VARCHAR(500);
