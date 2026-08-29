-- P12-3a desktop QR login (master plan §13.6E). AUTH-03: the QR encodes a short-TTL, single-use
-- transaction — never the OA add-friend QR, never a static code.
--
-- The row stores hashes only. `publicCodeHash` fences the code the scanning phone presents when the
-- signed-in user approves; `desktopSecretHash` fences the browser-bound secret the desktop BFF holds
-- in an HttpOnly cookie and presents when polling. Neither raw value is ever persisted or logged, so
-- a database reader cannot mint or approve a session.
--
-- `status` is the CAS token for both mutations. Approve is a conditional UPDATE on status='PENDING'
-- and redeem on status='APPROVED', so a concurrent second approve or a replayed desktop secret
-- matches zero rows and the caller fails closed instead of issuing a second session. CONSUMED is
-- terminal by design: nothing moves a row out of it.
--
-- The expiresAt index serves the TTL sweep; there is no user FK on purpose — the row is a
-- pre-session artifact whose userId is only meaningful once status reaches APPROVED.

-- CreateEnum
CREATE TYPE "LineWebLoginTransactionStatus" AS ENUM ('PENDING', 'APPROVED', 'CONSUMED');

-- CreateTable
CREATE TABLE "LineWebLoginTransaction" (
    "id" TEXT NOT NULL,
    "publicCodeHash" TEXT NOT NULL,
    "desktopSecretHash" TEXT NOT NULL,
    "status" "LineWebLoginTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "returnTo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineWebLoginTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LineWebLoginTransaction_publicCodeHash_key" ON "LineWebLoginTransaction"("publicCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "LineWebLoginTransaction_desktopSecretHash_key" ON "LineWebLoginTransaction"("desktopSecretHash");

-- CreateIndex
CREATE INDEX "LineWebLoginTransaction_expiresAt_idx" ON "LineWebLoginTransaction"("expiresAt");
