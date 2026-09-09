ALTER TABLE "ExpenseSubstituteReceiptEvidence"
  ALTER COLUMN "payerUserId" DROP NOT NULL,
  ADD COLUMN "paperFormSnapshotJson" JSONB,
  ADD COLUMN "paperSubmissionJson" JSONB,
  ADD COLUMN "paperReviewedByUserId" TEXT;
