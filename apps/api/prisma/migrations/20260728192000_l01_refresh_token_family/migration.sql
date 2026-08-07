-- L-01: refresh token FAMILY identity, so reuse detection survives more than one rotation.
-- Existing rows keep NULL: a session issued before this column has no family, and a NULL can
-- never match a lookup (nullable unique index), so a pre-L-01 token stays a plain 401 and is
-- never mistaken for reuse.
-- Idempotent so a partially-applied deploy can be re-run safely.
ALTER TABLE "AuthSession" ADD COLUMN IF NOT EXISTS "familyId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_familyId_key" ON "AuthSession"("familyId");
