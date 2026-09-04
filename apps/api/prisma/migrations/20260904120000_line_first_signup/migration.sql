-- P10-L LINE-first signup (spec §5). Additive only: one column relaxed to nullable, new nullable
-- columns, one new table, new indexes. No backfill, no data rewrite, no dropped column.

-- A `line-oa` application has no mailbox to ask for. Flow B still requires an address at its own
-- validator; this only stops the DB from claiming every source has one.
ALTER TABLE "CompanySignupRequest" ALTER COLUMN "contactEmail" DROP NOT NULL;

ALTER TABLE "CompanySignupRequest"
  -- Identity of the LINE account that submitted, from a server-verified ID token. There is
  -- deliberately NO picture column (DATA-MIN-01): display name and typed fields only.
  ADD COLUMN "lineProviderUserId" TEXT,
  ADD COLUMN "lineChannelId" TEXT,
  ADD COLUMN "lineDisplayName" TEXT,
  -- Clickwrap evidence captured on LIFF, replayed into LegalDocumentActionRecord at provisioning.
  ADD COLUMN "legalDocumentVersion" TEXT,
  ADD COLUMN "legalStatementSha256" TEXT,
  ADD COLUMN "legalReleaseFingerprintSha256" TEXT,
  ADD COLUMN "legalDisplayChallenge" TEXT,
  ADD COLUMN "legalLocale" TEXT,
  ADD COLUMN "legalUserAgent" TEXT,
  ADD COLUMN "legalAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "autoApproved" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "adminReminderSentAt" TIMESTAMP(3);

CREATE INDEX "CompanySignupRequest_lineChannelId_lineProviderUserId_state_idx"
  ON "CompanySignupRequest"("lineChannelId", "lineProviderUserId", "state");

-- Review B-05: "one open application per LINE account" is a DB fact, not a use-case convention —
-- two fast taps on the LIFF button race the read otherwise. Partial unique indexes have no Prisma
-- syntax, so this lives here and the schema carries a pointer comment.
CREATE UNIQUE INDEX "CompanySignupRequest_line_open_key"
  ON "CompanySignupRequest"("lineChannelId", "lineProviderUserId")
  WHERE "state" IN ('RECEIVED', 'VALIDATED', 'PENDING_REVIEW', 'PROVISIONING');

-- P10-L §9 warm-up cap and the once-a-month quota notice marker.
ALTER TABLE "CompanyPlanTerm"
  ADD COLUMN "warmupUntil" TIMESTAMP(3),
  ADD COLUMN "warmupSlipLimit" INTEGER,
  ADD COLUMN "quotaNoticeSentMonthKey" TEXT;

-- P10-L §15.3 (H-01). The payment columns are hooks for P26: nullable, defaulted, unread today.
CREATE TABLE "PackageChangeRequest" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "requestedTierKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "note" TEXT,
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "amountSatang" INTEGER,
  "offerSnapshotJson" JSONB,
  "paymentState" TEXT NOT NULL DEFAULT 'NONE',
  "paymentRef" TEXT,
  "slipAttachmentId" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PackageChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PackageChangeRequest_companyId_status_idx" ON "PackageChangeRequest"("companyId", "status");

-- Idempotency for "ask to change package": a second tap finds the row instead of opening a queue
-- of duplicates. Partial, so a closed request never blocks the next one.
CREATE UNIQUE INDEX "PackageChangeRequest_company_open_key"
  ON "PackageChangeRequest"("companyId")
  WHERE "status" = 'OPEN';

ALTER TABLE "PackageChangeRequest"
  ADD CONSTRAINT "PackageChangeRequest_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
