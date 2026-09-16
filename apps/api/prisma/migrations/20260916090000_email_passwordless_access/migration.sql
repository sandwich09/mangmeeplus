ALTER TABLE "User" ADD COLUMN "emailLoginEnabledAt" TIMESTAMP(3);
CREATE TABLE "EmailAccessChallenge" (
 "id" TEXT PRIMARY KEY, "email" TEXT NOT NULL, "browserSecretHash" TEXT NOT NULL,
 "requestKey" TEXT NOT NULL, "codeHash" TEXT NOT NULL, "keyVersion" TEXT NOT NULL,
 "environment" TEXT NOT NULL, "userId" TEXT, "securityBindingHash" TEXT,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "failedAttempts" INTEGER NOT NULL DEFAULT 0,
 "sendAttemptId" TEXT, "signupRequestId" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL,
 "verifiedAt" TIMESTAMP(3), "usedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EmailAccessChallenge_status_check" CHECK ("status" IN ('PENDING','VERIFIED','USED','REVOKED','EXPIRED')),
 CONSTRAINT "EmailAccessChallenge_attempts_check" CHECK ("failedAttempts" BETWEEN 0 AND 5)
);
CREATE UNIQUE INDEX "EmailAccessChallenge_requestKey_key" ON "EmailAccessChallenge" ("requestKey");
CREATE INDEX "EmailAccessChallenge_email_createdAt_idx" ON "EmailAccessChallenge" ("email", "createdAt");
CREATE INDEX "EmailAccessChallenge_expiresAt_idx" ON "EmailAccessChallenge" ("expiresAt");

CREATE UNIQUE INDEX "CompanySignupRequest_email_otp_first_key" ON "CompanySignupRequest" (lower("contactEmail")) WHERE "source" = 'email-otp';
ALTER TABLE "CompanySignupRequest" ADD COLUMN "emailProofVerifiedAt" TIMESTAMP(3);
