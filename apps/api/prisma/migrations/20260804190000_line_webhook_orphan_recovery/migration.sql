-- The LINE message buffer holds accepted messages in process memory and the webhook is acked
-- before the turn runs, so a hard pod exit loses the message with nothing able to redeliver it.
-- Keep the buffered envelope on the event row while the turn is in flight so the orphan sweep
-- can replay it; every terminal status clears the column again.
ALTER TABLE "LineWebhookEventLog"
  ADD COLUMN IF NOT EXISTS "payloadJson" JSONB;

-- Orphan sweep predicate (status + age) and the retention purge (age).
CREATE INDEX IF NOT EXISTS "LineWebhookEventLog_status_createdAt_idx"
  ON "LineWebhookEventLog"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "LineWebhookEventLog_createdAt_idx"
  ON "LineWebhookEventLog"("createdAt");
