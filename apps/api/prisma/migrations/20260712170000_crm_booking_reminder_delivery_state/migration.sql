-- Durable claim/backoff state for booking reminders. Existing reminderSentAt
-- values remain completed deliveries; unsent rows start immediately eligible.
ALTER TABLE "CrmBooking"
  ADD COLUMN "reminderClaimedAt" TIMESTAMP(3),
  ADD COLUMN "reminderAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reminderNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "reminderLastError" TEXT;

CREATE INDEX "CrmBooking_reminder_delivery_due_idx"
  ON "CrmBooking"("status", "reminderSentAt", "reminderNextAttemptAt", "startAt");
