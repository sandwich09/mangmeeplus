-- Owner decision D14: a signature is a PERSONAL, REPLACEABLE asset — one current signature per
-- person, not a growing library. Nothing enforced that, so every upload simply added another ACTIVE
-- row and a user accumulated several. The user-visible cost was the delete button: archiving the row
-- the panel called "current" promoted the next ACTIVE one into the same slot, the screen came back
-- showing a signature, and the user read that as "I pressed delete and it did not delete".
--
-- Retire the shadow duplicates, keeping the NEWEST ACTIVE row per owner. Newest is not an arbitrary
-- pick: `findReusableSignatureAsset` already resolves the newest ACTIVE row, so the rows retired here
-- are exactly the ones that could never have signed anything. Nobody's effective signature changes.
-- Self-healing on next upload was the alternative and is not enough: the user who wants to DELETE
-- has no reason to upload again, and the unique index below cannot be created while duplicates exist.
UPDATE "CompanySignatureAsset" a
SET "status" = 'ARCHIVED',
    "archivedAt" = NOW(),
    "updatedAt" = NOW()
WHERE a."status" = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM "CompanySignatureAsset" b
    WHERE b."companyId" = a."companyId"
      AND b."submittedByUserId" = a."submittedByUserId"
      AND b."status" = 'ACTIVE'
      -- `id` breaks a `createdAt` tie, so exactly one row per owner survives.
      AND (b."createdAt", b."id") > (a."createdAt", a."id")
  );

-- The invariant itself, so "one current signature" is a guarantee rather than a convention: any write
-- path that forgets to retire the previous row now fails instead of quietly creating a second current
-- signature. Prisma cannot model a partial unique index, so it lives here and is noted on the model in
-- schema.prisma — a future `prisma migrate diff` must not drop it.
--
-- Nothing already signed is affected: only `status` moves. Retired rows keep their attachment ids, so
-- the pinned re-resolution at approve still finds exactly what certify recorded, and the
-- substitute-evidence retention hold still refuses to delete those bytes.
CREATE UNIQUE INDEX "CompanySignatureAsset_companyId_submittedByUserId_active_key"
  ON "CompanySignatureAsset" ("companyId", "submittedByUserId")
  WHERE "status" = 'ACTIVE';
