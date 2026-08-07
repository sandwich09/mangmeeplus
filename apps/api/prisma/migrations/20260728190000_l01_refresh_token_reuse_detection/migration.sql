-- L-01: refresh token family reuse detection.
-- Existing rows keep NULL: a session that has never rotated has no previous token,
-- so a replay against it simply matches nothing and still answers 401.
-- Idempotent so a partially-applied deploy can be re-run safely.
ALTER TABLE "AuthSession" ADD COLUMN IF NOT EXISTS "previousTokenId" TEXT;
ALTER TABLE "AuthSession" ADD COLUMN IF NOT EXISTS "rotatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_previousTokenId_key" ON "AuthSession"("previousTokenId");
