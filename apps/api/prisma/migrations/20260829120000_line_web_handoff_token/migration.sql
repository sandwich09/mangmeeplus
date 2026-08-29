-- P12-3b LINE → web deep-link session handoff (docs/specs/line-web-deeplink-handoff-spec.md §9).
-- The row is the identity a LINE deep link carries: it proves WHO the message was sent to, never
-- what they may do. Every permission, entitlement, and branch scope is re-resolved at page load.
--
-- `tokenHash` is the sha256 hex of a 24-byte base64url secret; the raw token never touches this
-- table, mirroring EmployeeLineLinkToken. A database reader therefore cannot open a link.
--
-- `status` is the CAS token for the single mutation. The exchange claims on status='PENDING' with a
-- conditional UPDATE to 'USED' BEFORE it issues a session, so two concurrent taps match one row
-- between them and the loser falls through to normal login instead of minting a second session.
-- Unlike the employee link QR, a re-tap is not idempotent — a second exchange would be a new side
-- effect — so USED is terminal.
--
-- `targetPath` is server-stored and bound to `companyId`: the destination is read from this row, not
-- from the request, so a token minted for company A can never open a /companies/B/… path.
-- `lineUserId` is never read by the exchange; it exists so a burned token can be traced to the
-- recipient it was minted for.
--
-- The expiresAt index serves the TTL sweep. There is no FK on purpose — the same rationale as
-- LineWebLoginTransaction: a minutes-lived pre-session artifact must not cascade into user,
-- company, or membership rows, and its userId/companyId are re-verified at exchange time anyway.

-- CreateEnum
CREATE TYPE "LineWebHandoffTokenStatus" AS ENUM ('PENDING', 'USED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "LineWebHandoffToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "status" "LineWebHandoffTokenStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineWebHandoffToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LineWebHandoffToken_tokenHash_key" ON "LineWebHandoffToken"("tokenHash");

-- CreateIndex
CREATE INDEX "LineWebHandoffToken_userId_status_idx" ON "LineWebHandoffToken"("userId", "status");

-- CreateIndex
CREATE INDEX "LineWebHandoffToken_companyId_status_idx" ON "LineWebHandoffToken"("companyId", "status");

-- CreateIndex
CREATE INDEX "LineWebHandoffToken_expiresAt_idx" ON "LineWebHandoffToken"("expiresAt");
