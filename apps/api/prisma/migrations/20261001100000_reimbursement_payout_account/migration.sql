-- Reimbursement payout account (payout spec §8–§11, plan Phase 1 part A).
--
-- Additive only: two new tables and three nullable columns on "ReimbursementRequest". Nothing is
-- backfilled. Every existing claim keeps NULL in the new columns, which is what "legacy claim"
-- means, so its approval hash and its signatures stay valid. An OLD binary reads none of this.

ALTER TABLE "ReimbursementRequest"
  ADD COLUMN "payoutMethod" "ReimbursementPaymentMethod",
  ADD COLUMN "payoutDestinationVersion" INTEGER,
  ADD COLUMN "payoutFingerprint" TEXT;

-- A member's default account. One row per company membership: the composite key follows the
-- membership itself, so an account merge that moves the membership to another user carries it along.
CREATE TABLE "MemberPayoutAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payoutMethod" "ReimbursementPaymentMethod" NOT NULL,
    "payoutKind" TEXT,
    "bankName" TEXT,
    "accountName" TEXT,
    "accountNumberEncrypted" TEXT,
    "accountLast4" TEXT,
    "fingerprint" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberPayoutAccount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MemberPayoutAccount_version_check" CHECK ("version" >= 1),
    -- Cash carries no account at all; a transfer carries a complete one. Never half of either.
    CONSTRAINT "MemberPayoutAccount_shape_check" CHECK (
      ("payoutMethod" = 'CASH' AND "payoutKind" IS NULL AND "bankName" IS NULL AND "accountName" IS NULL
        AND "accountNumberEncrypted" IS NULL AND "accountLast4" IS NULL AND "fingerprint" IS NULL)
      OR ("payoutMethod" = 'BANK_TRANSFER' AND "payoutKind" IN ('BANK_ACCOUNT', 'PROMPTPAY_PHONE')
        AND "accountName" IS NOT NULL AND "accountNumberEncrypted" IS NOT NULL
        AND "accountLast4" ~ '^[0-9]{4}$' AND "fingerprint" IS NOT NULL
        AND (("payoutKind" = 'BANK_ACCOUNT') = ("bankName" IS NOT NULL)))
    )
);

-- The claim's own copy of the account, one row per version.
CREATE TABLE "ReimbursementPayoutDestination" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reimbursementRequestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payoutKind" TEXT NOT NULL,
    "bankName" TEXT,
    "accountName" TEXT NOT NULL,
    "accountNumberEncrypted" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "frozenAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedVia" TEXT,
    "approvalStepId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReimbursementPayoutDestination_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReimbursementPayoutDestination_version_check" CHECK ("version" >= 1),
    CONSTRAINT "ReimbursementPayoutDestination_shape_check" CHECK (
      "payoutKind" IN ('BANK_ACCOUNT', 'PROMPTPAY_PHONE')
      AND "accountLast4" ~ '^[0-9]{4}$'
      AND (("payoutKind" = 'BANK_ACCOUNT') = ("bankName" IS NOT NULL))
    ),
    -- Who attested, when and how are written together, and only on a frozen snapshot.
    CONSTRAINT "ReimbursementPayoutDestination_verification_check" CHECK (
      (("verifiedAt" IS NULL) = ("verifiedByUserId" IS NULL))
      AND (("verifiedAt" IS NULL) = ("verifiedVia" IS NULL))
      AND ("verifiedAt" IS NULL OR "frozenAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "MemberPayoutAccount_companyId_userId_key" ON "MemberPayoutAccount"("companyId", "userId");
CREATE UNIQUE INDEX "ReimbursementPayoutDestination_request_version_key" ON "ReimbursementPayoutDestination"("reimbursementRequestId", "version");

ALTER TABLE "MemberPayoutAccount" ADD CONSTRAINT "MemberPayoutAccount_companyId_userId_fkey" FOREIGN KEY ("companyId", "userId") REFERENCES "CompanyMembership"("companyId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReimbursementPayoutDestination" ADD CONSTRAINT "ReimbursementPayoutDestination_request_fkey" FOREIGN KEY ("companyId", "reimbursementRequestId") REFERENCES "ReimbursementRequest"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One snapshot, one truth: once a version is frozen at submit, the account it names never moves.
-- Only the attestation columns ("verified*", "approvalStepId") may change afterwards, so what the
-- approver attested is what the payer pays and what the form prints, whatever code runs later.
CREATE FUNCTION "reimbursement_payout_destination_frozen_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD."frozenAt" IS NOT NULL AND (
    NEW."frozenAt" IS DISTINCT FROM OLD."frozenAt"
    OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
    OR NEW."reimbursementRequestId" IS DISTINCT FROM OLD."reimbursementRequestId"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."payoutKind" IS DISTINCT FROM OLD."payoutKind"
    OR NEW."bankName" IS DISTINCT FROM OLD."bankName"
    OR NEW."accountName" IS DISTINCT FROM OLD."accountName"
    OR NEW."accountNumberEncrypted" IS DISTINCT FROM OLD."accountNumberEncrypted"
    OR NEW."accountLast4" IS DISTINCT FROM OLD."accountLast4"
    OR NEW."fingerprint" IS DISTINCT FROM OLD."fingerprint"
    OR NEW."source" IS DISTINCT FROM OLD."source"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
  ) THEN
    RAISE EXCEPTION 'reimbursement_payout_destination_frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReimbursementPayoutDestination_frozen_guard"
  BEFORE UPDATE ON "ReimbursementPayoutDestination"
  FOR EACH ROW EXECUTE FUNCTION "reimbursement_payout_destination_frozen_guard"();
