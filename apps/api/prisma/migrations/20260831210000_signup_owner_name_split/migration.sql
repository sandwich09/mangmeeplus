-- Owner 2026-08-31: the public signup form collects first and last name as separate fields and
-- both are stored. ownerDisplayName stays the joined value every downstream reader already uses;
-- the split columns are nullable because pre-split requests never captured them.
ALTER TABLE "CompanySignupRequest" ADD COLUMN "ownerFirstName" TEXT;
ALTER TABLE "CompanySignupRequest" ADD COLUMN "ownerLastName" TEXT;
