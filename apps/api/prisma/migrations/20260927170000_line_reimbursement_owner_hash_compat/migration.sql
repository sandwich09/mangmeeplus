-- Preserve the existing LINE chat hash as an opaque owner coordinate; never hash it twice.
ALTER TABLE "ReimbursementDraftAction" DROP CONSTRAINT "ReimbursementDraftAction_hashes_check";
ALTER TABLE "ReimbursementDraftAction" ALTER COLUMN "chatKeyHash" TYPE VARCHAR(64) USING trim("chatKeyHash");
ALTER TABLE "ReimbursementDraftAction" ADD CONSTRAINT "ReimbursementDraftAction_hashes_check" CHECK (
  "chatKeyHash" ~ '^([0-9a-f]{16}|[0-9a-f]{64})$'
  AND "intentKeyHash" ~ '^[0-9a-f]{64}$'
  AND ("confirmationDigest" IS NULL OR "confirmationDigest" ~ '^[0-9a-f]{64}$')
);
