-- Executive report labels on a company (executive backend spec §12.2, §15; owner decisions Q16, Q26).
-- Additive only: four nullable columns, no default, no index, nothing back-filled here.
-- "reportClassification" is 'CUSTOMER' | 'TEST' | 'INTERNAL'; NULL means the System Admin has not
-- chosen yet, and only CUSTOMER is counted by the report. "reportIndustryGroup" is the industry
-- group the admin sets for the report; NULL means the report maps the shop's own business type.
-- The values are checked in the application (contracts `report-labels.ts`), not by the database.
-- Existing companies are labelled by the one-time release task, never by this migration.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "reportClassification" TEXT,
ADD COLUMN     "reportClassifiedAt" TIMESTAMP(3),
ADD COLUMN     "reportClassifiedByUserId" TEXT,
ADD COLUMN     "reportIndustryGroup" TEXT;
