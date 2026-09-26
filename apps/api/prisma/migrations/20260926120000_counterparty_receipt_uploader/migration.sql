-- Keep the uploader of the expense receipt that first auto-created this counterparty.
-- This is a record-scoped access subject, not a company-wide permission grant.
ALTER TABLE "AccountingCounterparty"
  ADD COLUMN IF NOT EXISTS "receiptUploaderUserId" TEXT;
