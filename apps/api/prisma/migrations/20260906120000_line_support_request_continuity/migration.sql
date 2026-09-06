-- UAT 2026-09-06: "เจ้าหน้าที่ตอบกลับแล้วคำขอหายไปเลย ทั้งที่ยังไม่จบ".
--
-- Two additive columns so a customer who writes back after "ตอบแล้ว" can put their own request
-- back on the รอตอบ tab. Its own migration rather than an edit to an applied one (checksums).

-- The newest customer message on this request. Defaulted rather than nullable so the inbox can
-- ORDER BY it without a nulls-first surprise; `requestedAt` keeps saying when they FIRST asked.
ALTER TABLE "LineSupportRequest" ADD COLUMN     "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Answer → customer replies → answer again: each round trip is one reopen. The inbox chip reads it.
ALTER TABLE "LineSupportRequest" ADD COLUMN     "reopenedCount" INTEGER NOT NULL DEFAULT 0;

-- Rows that existed before this migration have written nothing since they were raised, so their
-- newest customer message IS the tap. Without this backfill every old row would claim it was
-- written to at deploy time and sort above genuinely fresh ones.
UPDATE "LineSupportRequest" SET "lastMessageAt" = "requestedAt";
