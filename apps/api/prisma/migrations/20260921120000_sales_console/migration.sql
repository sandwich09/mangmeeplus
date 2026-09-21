-- Phase 2 "Sales console" (docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md §9).
-- Additive only: every existing PackageChangeRequest row keeps its meaning through the
-- `kind` default, and no existing index or constraint is altered.

-- ── Deals ride the existing package-change row (spec R3) ──────────────────────────────
ALTER TABLE "PackageChangeRequest"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CUSTOMER_REQUEST',
  ADD COLUMN "salesUserId" TEXT,
  ADD COLUMN "approvedByUserId" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "offerExpiresAt" TIMESTAMP(3),
  ADD COLUMN "rejectedReason" TEXT,
  ADD COLUMN "internalReason" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "selfApproved" BOOLEAN NOT NULL DEFAULT false;

-- S18: a deal must never occupy the customer's single OPEN slot, so deal rows use their own
-- status vocabulary ('DRAFT'|'PENDING_APPROVAL'|…) and the pre-existing
-- "PackageChangeRequest_company_open_key" (WHERE status = 'OPEN') is left untouched.
-- This second partial index is the "one non-final deal per company" fence; its predicate is
-- SALES_DEAL_OPEN_STATUSES from packages/contracts/src/sales.ts.
CREATE UNIQUE INDEX "PackageChangeRequest_company_open_deal_key"
  ON "PackageChangeRequest"("companyId")
  WHERE "kind" = 'SALES_DEAL' AND "status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED');

-- The sales console's two list shapes: the lead's queue (by kind+status) and "my deals".
CREATE INDEX "PackageChangeRequest_kind_status_idx" ON "PackageChangeRequest"("kind", "status");
CREATE INDEX "PackageChangeRequest_salesUserId_idx" ON "PackageChangeRequest"("salesUserId");

-- ── Sales agent payroll/withholding record (spec R12, S10) ────────────────────────────
-- nationalId / taxId / bankAccount are AES-256-GCM ciphertext from credential-cipher.logic.ts.
-- They are decrypted only by the SYSTEM_ADMIN profile read and CSV export, both audited.
--
-- Every payroll column is NULLABLE: a team lead creates an agent account without any tax or bank
-- data (they hold sales.team.manage, never sales.agent_profile.manage), and the Owner fills the
-- record in later. NULL therefore means "not captured yet" — storing encrypted empty strings would
-- make a missing record indistinguishable from a blank one that somebody actually entered.
CREATE TABLE "SalesAgentProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "teamLeadUserId" TEXT,
  "salesCode" TEXT NOT NULL,
  "legalName" TEXT,
  "nationalIdEncrypted" TEXT,
  "taxIdEncrypted" TEXT,
  "address" TEXT,
  "bankName" TEXT,
  "bankAccountEncrypted" TEXT,
  "whtRatePercent" INTEGER NOT NULL DEFAULT 3,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT NOT NULL,
  "suspendedAt" TIMESTAMP(3),
  "suspendReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesAgentProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesAgentProfile_userId_key" ON "SalesAgentProfile"("userId");
-- The code a customer types at signup. Unique across the whole team, case-normalised to
-- upper case by the application before it ever reaches this column.
CREATE UNIQUE INDEX "SalesAgentProfile_salesCode_key" ON "SalesAgentProfile"("salesCode");
CREATE INDEX "SalesAgentProfile_teamLeadUserId_idx" ON "SalesAgentProfile"("teamLeadUserId");

-- ── D6 referral attribution ───────────────────────────────────────────────────────────
-- Phase 2 only RECORDS the attribution. Counting, self-referral detection and the anomaly
-- flags of spec §17.1 are Phase 4 and deliberately absent here.
ALTER TABLE "CompanySignupRequest"
  ADD COLUMN "referralSalesCode" TEXT,
  ADD COLUMN "referralSalesUserId" TEXT;

ALTER TABLE "Company"
  ADD COLUMN "referralSalesUserId" TEXT,
  ADD COLUMN "referredAt" TIMESTAMP(3),
  ADD COLUMN "referralSource" TEXT;

CREATE INDEX "Company_referralSalesUserId_idx" ON "Company"("referralSalesUserId");
