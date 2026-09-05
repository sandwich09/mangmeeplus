-- Review R09. One additive nullable column plus a backfill of the value it replaces, so the sweep
-- has a single clock to read and no row changes meaning on deploy.

-- When the CURRENT claim link's 30-day activation window started. An admin reissue restarts it;
-- `approvedAt` keeps recording when the application was decided, which no later action may rewrite.
ALTER TABLE "CompanySignupRequest" ADD COLUMN     "claimWindowStartedAt" TIMESTAMP(3);

-- Existing approvals carry their original window, so the sweep behaves for them exactly as before.
UPDATE "CompanySignupRequest"
   SET "claimWindowStartedAt" = "approvedAt"
 WHERE "approvedAt" IS NOT NULL
   AND "claimWindowStartedAt" IS NULL;
