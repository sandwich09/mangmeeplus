-- Spec §4F account merge (docs/specs/mangmee-external-signup-contract-spec-th.md §4F).
--
-- The row is minted at conflict time by the web link lane, at the one moment the caller has already
-- proved control of a LINE account that an ACTIVE ExternalIdentity gives to a different user. It
-- carries no authority of its own: the spend re-reads the session owner, the target user's status
-- and the membership set, so a stolen ticket without that session merges nothing.
--
-- `tokenHash` is the sha256 hex of a 32-byte base64url secret (secure-token.logic.ts). The raw token
-- exists only in the BFF's HttpOnly cookie, mirroring AccountClaimToken and EmployeeLineLinkToken —
-- a database reader therefore cannot merge two accounts.
--
-- `consumedAt` is the CAS for the single mutation. The merge transaction claims it with a
-- conditional UPDATE on consumedAt IS NULL *before* moving anything, so two concurrent confirms
-- match one row between them and the loser answers "already merging" instead of running the move
-- twice. Because the claim is inside the transaction, a rolled-back merge releases it again — a
-- non-null consumedAt therefore means the merge committed, which is what makes the replay of a
-- double-clicked confirm safely idempotent.
--
-- Both FKs cascade: a ticket is a minutes-lived pre-merge artifact of two specific users and must
-- never outlive either of them. The newUserId index serves the replay lookup, expiresAt the sweep.

-- CreateTable
CREATE TABLE "AccountMergeTicket" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "newUserId" TEXT NOT NULL,
    "existingUserId" TEXT NOT NULL,
    "lineProviderUserId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountMergeTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountMergeTicket_tokenHash_key" ON "AccountMergeTicket"("tokenHash");

-- CreateIndex
CREATE INDEX "AccountMergeTicket_newUserId_consumedAt_idx" ON "AccountMergeTicket"("newUserId", "consumedAt");

-- CreateIndex
CREATE INDEX "AccountMergeTicket_expiresAt_idx" ON "AccountMergeTicket"("expiresAt");

-- AddForeignKey
ALTER TABLE "AccountMergeTicket" ADD CONSTRAINT "AccountMergeTicket_newUserId_fkey" FOREIGN KEY ("newUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMergeTicket" ADD CONSTRAINT "AccountMergeTicket_existingUserId_fkey" FOREIGN KEY ("existingUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
