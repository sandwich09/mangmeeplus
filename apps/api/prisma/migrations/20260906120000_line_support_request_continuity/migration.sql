-- UAT 2026-09-06: "เจ้าหน้าที่ตอบกลับแล้วคำขอหายไปเลย ทั้งที่ยังไม่จบ".
--
-- Additive columns so a customer who writes back after "ตอบแล้ว" can put their own request back on
-- the รอตอบ tab, and so the question they asked survives everything they send afterwards. Its own
-- migration rather than an edit to an applied one (checksums); unreleased, so it still grows.

-- The newest customer message on this request. Defaulted rather than nullable so the inbox can
-- ORDER BY it without a nulls-first surprise; `requestedAt` keeps saying when they FIRST asked.
ALTER TABLE "LineSupportRequest" ADD COLUMN     "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Answer → customer replies → answer again: each round trip is one reopen. The inbox chip reads it.
ALTER TABLE "LineSupportRequest" ADD COLUMN     "reopenedCount" INTEGER NOT NULL DEFAULT 0;

-- Rows that existed before this migration have written nothing since they were raised, so their
-- newest customer message IS the tap. Without this backfill every old row would claim it was
-- written to at deploy time and sort above genuinely fresh ones.
UPDATE "LineSupportRequest" SET "lastMessageAt" = "requestedAt";

-- The question that was on the screen when they tapped. Immutable: a nudge or an unrelated receipt
-- photo used to overwrite the one sentence an operator was about to answer.
ALTER TABLE "LineSupportRequest" ADD COLUMN     "requestText" TEXT;

-- A photo/document marker rather than the bytes or a sentence about them (§3), so a picture never
-- costs the thread its words.
ALTER TABLE "LineSupportRequest" ADD COLUMN     "lastMediaAt" TIMESTAMP(3);

-- Existing rows only ever had the tap-time text in `lastMessageText`, so that IS their question.
UPDATE "LineSupportRequest" SET "requestText" = "lastMessageText";

-- The inbox read (status, then newest customer message) and the expiry sweep both order and filter
-- on this pair now; without it both fall back to a scan of every request ever raised.
CREATE INDEX "LineSupportRequest_status_lastMessageAt_idx" ON "LineSupportRequest"("status", "lastMessageAt");
