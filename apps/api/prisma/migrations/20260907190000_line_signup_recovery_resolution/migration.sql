ALTER TABLE "CompanySignupRequest"
  ADD COLUMN "lineSignupIntent" TEXT,
  ADD COLUMN "contactEmailConflict" BOOLEAN,
  ADD COLUMN "reviewResolution" TEXT,
  ADD COLUMN "resolutionNote" TEXT,
  ADD COLUMN "resolvedExistingCompanyId" TEXT,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedByUserId" TEXT,
  ADD COLUMN "repeatTrialGrantedAt" TIMESTAMP(3),
  ADD COLUMN "repeatTrialGrantedByUserId" TEXT,
  ADD COLUMN "repeatTrialGrantNote" TEXT,
  ADD COLUMN "sharedContactReviewedAt" TIMESTAMP(3),
  ADD COLUMN "sharedContactReviewedByUserId" TEXT,
  ADD COLUMN "sharedContactReviewNote" TEXT;

CREATE INDEX "CompanySignupRequest_resolvedExistingCompanyId_idx"
  ON "CompanySignupRequest"("resolvedExistingCompanyId");
