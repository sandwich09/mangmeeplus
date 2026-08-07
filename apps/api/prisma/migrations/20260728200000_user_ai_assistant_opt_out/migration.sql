-- PDPA objection route for the LINE AI assistant (M-05 register §3.1): a user with the
-- timestamp set has opted out, and the webhook use-case refuses the turn before any
-- model or gateway involvement. Nullable, no default: existing users stay opted in.
-- Idempotent so a partially-applied deploy can be re-run safely.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "aiAssistantOptOutAt" TIMESTAMP(3);
