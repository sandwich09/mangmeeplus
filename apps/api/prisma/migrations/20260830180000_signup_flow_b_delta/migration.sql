-- Flow B delta (P10 amendment v2): review states, claim fields, claim tokens.
ALTER TYPE "CompanySignupState" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW';
ALTER TYPE "CompanySignupState" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "CompanySignupRequest"
  ADD COLUMN "businessType" TEXT,
  ADD COLUMN "phoneNumber" TEXT,
  ADD COLUMN "vatRegistered" BOOLEAN,
  ADD COLUMN "mxValid" BOOLEAN,
  ADD COLUMN "pendingPasswordHash" TEXT,
  ADD COLUMN "attachUserId" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedByUserId" TEXT,
  ADD COLUMN "claimEmailLastSentAt" TIMESTAMP(3),
  ADD COLUMN "claimReminderSentAt" TIMESTAMP(3);

CREATE TABLE "AccountClaimToken" (
  "id" TEXT NOT NULL,
  "signupRequestId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountClaimToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountClaimToken_tokenHash_key" ON "AccountClaimToken"("tokenHash");
CREATE INDEX "AccountClaimToken_signupRequestId_idx" ON "AccountClaimToken"("signupRequestId");
CREATE INDEX "AccountClaimToken_expiresAt_idx" ON "AccountClaimToken"("expiresAt");

ALTER TABLE "AccountClaimToken"
  ADD CONSTRAINT "AccountClaimToken_signupRequestId_fkey"
  FOREIGN KEY ("signupRequestId") REFERENCES "CompanySignupRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
