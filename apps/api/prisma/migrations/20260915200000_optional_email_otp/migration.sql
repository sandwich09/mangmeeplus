ALTER TABLE "User" ADD COLUMN "emailRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AuthSession"
  ADD COLUMN "emailReauthenticatedAt" TIMESTAMP(3),
  ADD COLUMN "emailReauthBindingHash" TEXT,
  ADD COLUMN "emailReauthNonceHash" TEXT,
  ADD COLUMN "emailReauthExpiresAt" TIMESTAMP(3);
ALTER TABLE "CompanySignupRequest" ADD COLUMN "intakePolicyVersion" TEXT;
ALTER TABLE "EmailVerificationToken"
  ADD COLUMN "proofKind" TEXT NOT NULL DEFAULT 'LINK',
  ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "emailRevision" INTEGER,
  ADD COLUMN "securityBindingHash" TEXT,
  ADD COLUMN "sessionId" TEXT,
  ADD COLUMN "keyVersion" TEXT,
  ADD COLUMN "sendAttemptId" TEXT,
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "requestFingerprint" TEXT;
CREATE UNIQUE INDEX "EmailVerificationToken_userId_requestKey_key"
  ON "EmailVerificationToken" ("userId", "requestKey");
CREATE INDEX "EmailVerificationToken_newEmail_createdAt_idx"
  ON "EmailVerificationToken" ("newEmail", "createdAt");
-- Legacy LINK rows remain readable. Only the new writer creates OTP rows.
CREATE UNIQUE INDEX "EmailVerificationToken_one_pending_otp"
  ON "EmailVerificationToken" ("userId") WHERE "proofKind" = 'OTP' AND "status" = 'PENDING';
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_otp_shape"
  CHECK ("proofKind" IN ('LINK', 'OTP') AND "failedAttempts" BETWEEN 0 AND 5 AND
    ("proofKind" <> 'OTP' OR ("emailRevision" IS NOT NULL AND "securityBindingHash" IS NOT NULL
      AND "sessionId" IS NOT NULL AND "keyVersion" IS NOT NULL AND "sendAttemptId" IS NOT NULL
      AND "requestKey" IS NOT NULL AND "requestFingerprint" IS NOT NULL)));

-- Deploy with old account-email writers drained; old public links cannot bypass authenticated OTP.
UPDATE "EmailVerificationToken" SET status = 'REVOKED' WHERE status = 'PENDING' AND "proofKind" = 'LINK';

ALTER TABLE "BillingAccount" ADD COLUMN "activeEmailOperationId" TEXT;
CREATE UNIQUE INDEX "BillingAccount_activeEmailOperationId_key" ON "BillingAccount" ("activeEmailOperationId");
