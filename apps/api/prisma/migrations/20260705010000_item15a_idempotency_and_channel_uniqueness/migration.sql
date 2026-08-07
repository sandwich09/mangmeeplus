-- Item 15A review fixes:
-- 1. Widen inbound idempotency to (companyId, providerMessageId) so concurrent
--    redeliveries that resolve to different conversations still collide.
-- 2. Enforce spec section 11 "unique lineChannelId where status != DISABLED"
--    at the DB level (closes the connect check-then-insert race).
--    NOTE: partial unique index — Prisma cannot model it; keep it out of
--    future `prisma migrate diff` drops (see schema.prisma comment).

-- DropIndex
DROP INDEX "CrmMessage_conversationId_providerMessageId_key";

-- CreateIndex
CREATE UNIQUE INDEX "CrmMessage_companyId_providerMessageId_key" ON "CrmMessage"("companyId", "providerMessageId");

-- CreateIndex (partial)
CREATE UNIQUE INDEX "CompanyMessagingChannel_lineChannelId_active_key" ON "CompanyMessagingChannel"("lineChannelId") WHERE "status" <> 'DISABLED';
