ALTER TABLE "LineWebhookEventLog" ADD COLUMN "lineMessageId" VARCHAR(200);

CREATE INDEX "LineWebhookEventLog_lineMessageId_idx" ON "LineWebhookEventLog"("lineMessageId");
