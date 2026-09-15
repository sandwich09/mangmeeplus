CREATE INDEX "EmailSendAttempt_monitor_history_idx"
ON "EmailSendAttempt" ("provider", "providerServerId", "stream", "createdAt", "id");
