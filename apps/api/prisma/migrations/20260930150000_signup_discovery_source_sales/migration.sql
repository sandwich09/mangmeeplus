-- Owner 2026-09-30 (production hotfix): the signup form's "รู้จักเราจากที่ไหน" offers
-- "เซลล์ของมั่งมี" (discoverySource 'SALES', D6) but the check from 20260917190000 predates it,
-- so every signup that chose it was refused by the database. Same rule, with 'SALES' allowed
-- (its sales code lives in its own column, so discoverySourceOther stays NULL like the others).
ALTER TABLE "CompanySignupRequest"
  DROP CONSTRAINT "CompanySignupRequest_discovery_source_check";

ALTER TABLE "CompanySignupRequest"
  ADD CONSTRAINT "CompanySignupRequest_discovery_source_check"
  CHECK (
    ("discoverySource" IS NULL AND "discoverySourceOther" IS NULL)
    OR ("discoverySource" IS NOT NULL AND (
      ("discoverySource" IN ('WEBSITE', 'IG', 'TIKTOK', 'FACEBOOK', 'SALES') AND "discoverySourceOther" IS NULL)
      OR "discoverySource" = 'OTHER'
    ))
  );
