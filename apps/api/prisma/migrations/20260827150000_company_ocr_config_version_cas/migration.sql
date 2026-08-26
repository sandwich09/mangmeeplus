-- Dedicated OCR-config CAS fence. Other AI configuration writes must not invalidate this version.
ALTER TABLE "CompanyAiConfiguration"
  ADD COLUMN "ocrConfigVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CompanyAiConfiguration"
  ADD CONSTRAINT "CompanyAiConfiguration_ocrConfigVersion_check"
  CHECK ("ocrConfigVersion" >= 0);
