-- A7 appointment reminder: mark when the pre-appointment reminder was sent so the
-- reminder scanner never double-sends, + a global sweep index (BOOKED, upcoming).
ALTER TABLE "CrmBooking" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
CREATE INDEX "CrmBooking_status_startAt_idx" ON "CrmBooking"("status", "startAt");
