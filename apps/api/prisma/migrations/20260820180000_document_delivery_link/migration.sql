-- Phase 5 of the LINE substitute-receipt assisted issuance spec (§10/§12/R16): the delivery-link
-- credential. Only the SHA-256 of the token is stored, so a database reader can never mint or replay
-- a link. `tempObjectKey` names an opaque COPY under the `line-delivery/` prefix — the source
-- artifact is never moved or deleted. Purely additive: one new enum, one new table, no existing
-- table touched, reversible by dropping both.
--
-- Trimmed by hand: `prisma migrate dev` also re-emits the repository's pre-existing schema drift
-- (DataRightsCase/RemoteRelease* updatedAt defaults and four index renames from migration
-- 20260809120000). Those belong to that defect, not to this change.
-- CreateEnum
CREATE TYPE "DocumentDeliveryLinkKind" AS ENUM ('ISSUED_PDF', 'UNSIGNED_FORM_PDF');

-- CreateTable
CREATE TABLE "DocumentDeliveryLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "kind" "DocumentDeliveryLinkKind" NOT NULL,
    "tokenHashSha256" TEXT NOT NULL,
    "tempBucket" TEXT NOT NULL,
    "tempObjectKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "lastOpenedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentDeliveryLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentDeliveryLink_tokenHashSha256_key" ON "DocumentDeliveryLink"("tokenHashSha256");

-- CreateIndex
CREATE INDEX "DocumentDeliveryLink_companyId_evidenceId_expiresAt_idx" ON "DocumentDeliveryLink"("companyId", "evidenceId", "expiresAt");
