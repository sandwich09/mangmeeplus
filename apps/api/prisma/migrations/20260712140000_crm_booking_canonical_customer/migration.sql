-- Every confirmed booking must belong to one canonical CRM customer.
-- Do not infer identity by name: each legacy name-only booking gets a separate
-- provisional customer that staff can later merge through the CRM workflow.

ALTER TYPE "CrmBookingSource" ADD VALUE IF NOT EXISTS 'WEB';
ALTER TYPE "CrmBookingSource" ADD VALUE IF NOT EXISTS 'PHONE';
ALTER TYPE "CrmBookingSource" ADD VALUE IF NOT EXISTS 'FACEBOOK';
ALTER TYPE "CrmBookingSource" ADD VALUE IF NOT EXISTS 'WALK_IN';
ALTER TYPE "CrmBookingSource" ADD VALUE IF NOT EXISTS 'OTHER';

INSERT INTO "CrmCustomer" (
  "id",
  "companyId",
  "displayName",
  "source",
  "notes",
  "createdByUserId",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy-booking-' || b."id",
  b."companyId",
  COALESCE(NULLIF(BTRIM(b."customerName"), ''), 'ลูกค้าจากการจองเดิม'),
  'BOOKING_BACKFILL',
  'สร้างอัตโนมัติเพื่อผูกการจองเดิม ' || b."id",
  b."createdByUserId",
  b."createdAt",
  b."updatedAt"
FROM "CrmBooking" b
WHERE b."customerId" IS NULL
ON CONFLICT ("id") DO NOTHING;

UPDATE "CrmBooking"
SET "customerId" = 'legacy-booking-' || "id"
WHERE "customerId" IS NULL;

UPDATE "CrmBooking" b
SET "customerName" = c."displayName"
FROM "CrmCustomer" c
WHERE b."customerId" = c."id"
  AND (b."customerName" IS NULL OR BTRIM(b."customerName") = '');

CREATE UNIQUE INDEX "CrmCustomer_companyId_id_key"
ON "CrmCustomer"("companyId", "id");

ALTER TABLE "CrmBooking"
ALTER COLUMN "customerId" SET NOT NULL;

ALTER TABLE "CrmBooking"
ADD CONSTRAINT "CrmBooking_companyId_customerId_fkey"
FOREIGN KEY ("companyId", "customerId")
REFERENCES "CrmCustomer"("companyId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
