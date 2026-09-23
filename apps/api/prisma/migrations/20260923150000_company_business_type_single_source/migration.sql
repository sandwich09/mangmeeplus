ALTER TABLE "CompanySignupRequest" DROP COLUMN IF EXISTS "businessCategory";
ALTER TABLE "Company" DROP COLUMN IF EXISTS "businessCategory";
DROP TYPE IF EXISTS "CompanyBusinessCategory";
