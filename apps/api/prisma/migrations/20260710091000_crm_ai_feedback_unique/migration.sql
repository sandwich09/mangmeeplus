-- CRM AI assist feedback idempotency.
-- Partial unique index: Prisma cannot model requestId IS NOT NULL.
CREATE UNIQUE INDEX "CrmAiAssistFeedback_conversation_kind_request_user_key"
    ON "CrmAiAssistFeedback"("conversationId", "kind", "requestId", "createdByUserId")
    WHERE "requestId" IS NOT NULL;
