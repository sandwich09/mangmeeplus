-- Multi-payout spec §7. Additive only: the default table and its readers remain unchanged.
-- No backfill. Existing claim destinations and older writers receive SELF from the column default.
CREATE TABLE "MemberSavedPayoutAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "holderType" TEXT NOT NULL,
    "holderNote" TEXT,
    "payoutKind" TEXT NOT NULL,
    "bankName" TEXT,
    "accountName" TEXT NOT NULL,
    "accountNumberEncrypted" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberSavedPayoutAccount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MemberSavedPayoutAccount_shape_check" CHECK (
      "payoutKind" IN ('BANK_ACCOUNT', 'PROMPTPAY_PHONE')
      AND "accountLast4" ~ '^[0-9]{4}$'
      AND (("payoutKind" = 'BANK_ACCOUNT') = ("bankName" IS NOT NULL))
    ),
    CONSTRAINT "MemberSavedPayoutAccount_holder_type_check" CHECK ("holderType" IN ('SELF', 'THIRD_PARTY')),
    CONSTRAINT "MemberSavedPayoutAccount_holder_note_check" CHECK (
      ("holderType" = 'SELF' AND "holderNote" IS NULL)
      OR ("holderType" = 'THIRD_PARTY' AND "holderNote" IS NOT NULL AND length(btrim("holderNote")) BETWEEN 2 AND 200)
    )
);

-- The fingerprint is the account's own v1 fingerprint: changing holder facts cannot evade duplicates.
CREATE UNIQUE INDEX "MemberSavedPayoutAccount_companyId_userId_fingerprint_key"
  ON "MemberSavedPayoutAccount"("companyId", "userId", "fingerprint");

ALTER TABLE "MemberSavedPayoutAccount" ADD CONSTRAINT "MemberSavedPayoutAccount_companyId_userId_fkey"
  FOREIGN KEY ("companyId", "userId") REFERENCES "CompanyMembership"("companyId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReimbursementPayoutDestination"
  ADD COLUMN "holderType" TEXT NOT NULL DEFAULT 'SELF',
  ADD COLUMN "holderNote" TEXT,
  ADD CONSTRAINT "ReimbursementPayoutDestination_holder_type_check" CHECK ("holderType" IN ('SELF', 'THIRD_PARTY')),
  ADD CONSTRAINT "ReimbursementPayoutDestination_holder_note_check" CHECK (
    ("holderType" = 'SELF' AND "holderNote" IS NULL)
    OR ("holderType" = 'THIRD_PARTY' AND "holderNote" IS NOT NULL AND length(btrim("holderNote")) BETWEEN 2 AND 200)
  );

-- Retain every existing frozen field and also freeze the holder facts; verification stays mutable.
CREATE OR REPLACE FUNCTION "reimbursement_payout_destination_frozen_guard"() RETURNS trigger AS $$
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
    OR NEW."holderType" IS DISTINCT FROM OLD."holderType"
    OR NEW."holderNote" IS DISTINCT FROM OLD."holderNote"
  ) THEN
    RAISE EXCEPTION 'reimbursement_payout_destination_frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
