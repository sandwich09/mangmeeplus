-- Preserve source-document VAT separately from deterministic accepted accounting totals.
ALTER TABLE "ExpenseRecord" ADD COLUMN "vatCaptureSnapshotJson" JSONB;
