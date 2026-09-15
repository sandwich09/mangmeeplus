ALTER TABLE "CompanyPlanTerm" ADD COLUMN "capacityOverride" JSONB;
ALTER TABLE "CompanyPlanTerm" ADD CONSTRAINT "CompanyPlanTerm_capacity_override_object"
  CHECK ("capacityOverride" IS NULL OR jsonb_typeof("capacityOverride") = 'object');
