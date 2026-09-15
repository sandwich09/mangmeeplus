ALTER TABLE "EmailSendAttempt" ADD COLUMN "historyArchivedAt" TIMESTAMP(3);
CREATE TABLE "EmailHistoryPolicy" (
 "id" TEXT NOT NULL PRIMARY KEY, "providerServerId" INTEGER NOT NULL, "stream" TEXT NOT NULL,
 "retentionDays" INTEGER NOT NULL DEFAULT 180 CHECK ("retentionDays" BETWEEN 1 AND 3650),
 "enabled" BOOLEAN NOT NULL DEFAULT false, "version" INTEGER NOT NULL DEFAULT 0,
 "lastCleanupAt" TIMESTAMP(3), "lastArchivedCount" INTEGER NOT NULL DEFAULT 0,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "EmailHistoryPolicy_providerServerId_stream_key" UNIQUE ("providerServerId", "stream")
);
CREATE INDEX "EmailSendAttempt_history_archive_idx" ON "EmailSendAttempt" ("providerServerId", stream, "createdAt", id)
 WHERE "historyArchivedAt" IS NULL AND status = 'ACCEPTED' AND "deliveredAt" IS NOT NULL;
