ALTER TABLE "CompanyBusinessPolicy"
  ADD COLUMN "retentionPolicyJson" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "consentPolicyJson" JSONB NOT NULL DEFAULT '{}';
