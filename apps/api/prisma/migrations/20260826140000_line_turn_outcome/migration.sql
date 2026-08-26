-- §8.3 (uat-correctness-latency spec), reliability spec §6 / E3: the DURABLE terminal outcome of one
-- LINE turn — the exact rendered message array, persisted BEFORE the first send attempt.
--
-- What existed before this table: `AiTurn.replyPreview`, 240 characters kept for audit. A preview is
-- not a deliverable, so a delivery retry had nothing to send and the only recovery was to replay the
-- INPUT through the message buffer, which re-routes the turn and may compute a DIFFERENT answer from
-- the same message. §8.3 forbids exactly that: an expired reply token or a failed send must replay
-- the SAME outcome, "โดยไม่ route ใหม่และไม่ทำ accepted facts สูญหาย".
--
-- Delivery is a SEPARATE status, also per §8.3 ("ห้ามถือว่า resolved ตอนเริ่มเรียก LINE API"):
--   * the row existing  = the outcome is decided and replayable;
--   * "deliveredAt"     = LINE returned ok for it;
--   * "attempts"        = send attempts, not successes.
--
-- ON DELETE CASCADE is the entire retention story. The orphan sweep already deletes
-- LineWebhookEventLog rows past AI_DATA_RETENTION_DAYS; these go with them instead of needing a
-- second purge job that could drift out of step. The FK also makes an orphan outcome impossible, so
-- the replay can always resolve the chat to push into from the event row it belongs to.
CREATE TABLE "LineTurnOutcome" (
    "id" TEXT NOT NULL,
    "webhookEventId" TEXT NOT NULL,
    "companyId" TEXT,
    "messagesJson" JSONB NOT NULL,
    "presentationKind" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineTurnOutcome_pkey" PRIMARY KEY ("id")
);

-- One outcome per turn. This is the idempotency key: the delivery seam upserts on it, so a retried
-- turn REPLACES its own outcome rather than leaving two candidate answers for one question.
CREATE UNIQUE INDEX "LineTurnOutcome_webhookEventId_key" ON "LineTurnOutcome"("webhookEventId");

-- AddForeignKey
ALTER TABLE "LineTurnOutcome" ADD CONSTRAINT "LineTurnOutcome_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "LineWebhookEventLog"("webhookEventId") ON DELETE CASCADE ON UPDATE CASCADE;
