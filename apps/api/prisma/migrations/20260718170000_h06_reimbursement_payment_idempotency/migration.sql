-- H-06: existing rows get a durable, collision-free legacy key before the
-- payment write path starts requiring server-generated attempt keys.
ALTER TABLE "ReimbursementPayment" ADD COLUMN "idempotencyKey" TEXT;

UPDATE "ReimbursementPayment"
SET "idempotencyKey" = 'legacy:' || "id";

ALTER TABLE "ReimbursementPayment" ALTER COLUMN "idempotencyKey" SET NOT NULL;

CREATE UNIQUE INDEX "ReimbursementPayment_companyId_idempotencyKey_key"
ON "ReimbursementPayment"("companyId", "idempotencyKey");
