ALTER TABLE "CompanySignupRequest"
  ADD COLUMN "discoverySource" TEXT,
  ADD COLUMN "discoverySourceOther" VARCHAR(200);

ALTER TABLE "CompanySignupRequest"
  ADD CONSTRAINT "CompanySignupRequest_discovery_source_check"
  CHECK (
    ("discoverySource" IS NULL AND "discoverySourceOther" IS NULL)
    OR ("discoverySource" IS NOT NULL AND (
      ("discoverySource" IN ('WEBSITE', 'IG', 'TIKTOK', 'FACEBOOK') AND "discoverySourceOther" IS NULL)
      OR "discoverySource" = 'OTHER'
    ))
  );
