ALTER TABLE "NotificationRecipient"
  ADD COLUMN "waitingKey" TEXT,
  ADD COLUMN "supersededAt" TIMESTAMP(3),
  ADD COLUMN "finishedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "NotificationRecipient_unread_waiting_key"
  ON "NotificationRecipient" ("companyId", "userId", "waitingKey")
  WHERE "waitingKey" IS NOT NULL AND "readAt" IS NULL AND "dismissedAt" IS NULL
    AND "supersededAt" IS NULL AND "finishedAt" IS NULL;
