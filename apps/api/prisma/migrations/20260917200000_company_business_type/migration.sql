ALTER TABLE "Company"
  ADD COLUMN "businessTypeCode" VARCHAR(5),
  ADD COLUMN "businessTypeOther" VARCHAR(200),
  ADD COLUMN "businessTypeVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Company" ADD CONSTRAINT "Company_business_type_check" CHECK (
  ("businessTypeCode" IS NULL AND "businessTypeOther" IS NULL)
  OR ("businessTypeCode" IS NOT NULL AND (
    ("businessTypeCode" ~ '^[0-9]{5}$' AND "businessTypeOther" IS NULL)
    OR ("businessTypeCode" = 'OTHER' AND "businessTypeOther" IS NOT NULL AND length(btrim("businessTypeOther")) > 0)
  ))
);
