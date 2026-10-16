ALTER TABLE "ExpenseRecord"
  ADD COLUMN "requestedReviewerUserId" TEXT,
  ADD COLUMN "submittedByUserId" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3);
