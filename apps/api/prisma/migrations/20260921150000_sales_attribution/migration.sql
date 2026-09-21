-- Phase 3 "deal payment on the one-time purchase path"
-- (docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md §19, D-P3-9 / D-P3-10).
-- Additive only: one new table and one nullable column with its index.

-- ── Who gets credited for a paid shop (§17.2) ─────────────────────────────────────────
-- One row per company, written the first time a deal is applied. `companyId` is UNIQUE so a
-- second deal, or a Phase 4 referral, can never double-credit the same shop; the writer inserts
-- only when no row exists yet.
CREATE TABLE "SalesAttribution" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "salesUserId"     TEXT NOT NULL,
  "source"          TEXT NOT NULL,
  "amountSatang"    INTEGER NOT NULL,
  "months"          INTEGER,
  "interval"        TEXT,
  "paidAt"          TIMESTAMP(3) NOT NULL,
  "refundedSatang"  INTEGER NOT NULL DEFAULT 0,
  "sourceInvoiceId" TEXT NOT NULL,
  "dealRequestId"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesAttribution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalesAttribution_companyId_key" ON "SalesAttribution"("companyId");
CREATE INDEX "SalesAttribution_salesUserId_paidAt_idx" ON "SalesAttribution"("salesUserId", "paidAt");

-- ── The EXPIRED sweep must not close a deal that is mid-Checkout (S46/D-P3-9) ─────────
-- A JSON lookup into `quoteSnapshot` would be unindexable, so the deal id is mirrored onto the
-- attempt when the Checkout session is reserved.
ALTER TABLE "BillingAttempt" ADD COLUMN "dealRequestId" TEXT;
CREATE INDEX "BillingAttempt_dealRequestId_idx" ON "BillingAttempt"("dealRequestId");
