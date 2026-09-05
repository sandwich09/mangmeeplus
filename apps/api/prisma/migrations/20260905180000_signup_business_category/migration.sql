-- R10 (review 2026-09-05): the PDPA health tripwire reads CompanyBusinessCategory, but the public
-- form asks for free text and a Thai answer ("คลินิก") only maps by exact enum match — so the
-- safeguard never fired for the applicants it exists for. The admin now picks the enum at review
-- and the choice is stored here; provisioning prefers it over the free-text mapping.
--
-- Nullable and additive: every row decided before this, and every review that leaves the field
-- alone, keeps falling back to mapBusinessCategory(businessType). Stored as TEXT rather than the
-- enum type because this column records an operator's CHOICE about an application, and a value the
-- enum no longer knows must degrade to OTHER at read time instead of failing the read.
ALTER TABLE "CompanySignupRequest" ADD COLUMN "businessCategory" TEXT;
