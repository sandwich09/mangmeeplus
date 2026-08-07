CREATE TYPE "VerificationTokenStatus" AS ENUM ('PENDING', 'USED', 'EXPIRED', 'REVOKED');

ALTER TABLE "User"
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE "EmailVerificationToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "newEmail" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "VerificationTokenStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "VerificationTokenStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_status_expiresAt_idx" ON "EmailVerificationToken"("userId", "status", "expiresAt");

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_status_expiresAt_idx" ON "PasswordResetToken"("userId", "status", "expiresAt");

ALTER TABLE "EmailVerificationToken"
ADD CONSTRAINT "EmailVerificationToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PasswordResetToken"
ADD CONSTRAINT "PasswordResetToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
