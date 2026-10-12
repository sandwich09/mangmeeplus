-- A nullable per-company screen setting. A missing or null value reads as hidden in the application.
-- Keep the existing manual-entry column and stored rows unchanged; both settings share the row version.
ALTER TABLE "CompanyWebEntrySetting" ADD COLUMN "disbursementVoucherEntryEnabled" BOOLEAN;
