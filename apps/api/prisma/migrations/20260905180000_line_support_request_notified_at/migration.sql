-- Review follow-up. One additive nullable column; no backfill, no default, no index.
--
-- Its own migration rather than an edit to 20260905170000: that file has already been applied to
-- reviewers' local databases, and changing an applied migration's bytes fails the checksum check
-- on the next `migrate deploy` for everyone who has run it.

-- NULL = the support-notice drain has not run for this request yet. Without it, `lineNotifiedCount
-- = 0 AND emailSent = false` was indistinguishable from "every channel failed", so a request
-- rendered the red "nobody was told" chip for the seconds between the tap and the drain.
ALTER TABLE "LineSupportRequest" ADD COLUMN     "notifiedAt" TIMESTAMP(3);
