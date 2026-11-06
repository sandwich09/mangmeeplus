ALTER TABLE "SalesDemoLink" ADD COLUMN "aiCreditUnits" INTEGER NOT NULL DEFAULT 80;
ALTER TABLE "SalesDemoLink" ADD CONSTRAINT "SalesDemoLink_aiCreditUnits_check" CHECK ("aiCreditUnits" BETWEEN 1 AND 300);
CREATE TABLE "DemoChatMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "chatId" TEXT NOT NULL,
  "direction" TEXT NOT NULL CHECK ("direction" IN ('in', 'out')),
  "messagesJson" JSONB NOT NULL,
  "webhookEventId" TEXT,
  "replyToken" TEXT,
  "deliveryKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "DemoChatMessage_replyToken_key" ON "DemoChatMessage"("replyToken");
CREATE UNIQUE INDEX "DemoChatMessage_deliveryKey_key" ON "DemoChatMessage"("deliveryKey");
CREATE INDEX "DemoChatMessage_companyId_createdAt_id_idx" ON "DemoChatMessage"("companyId", "createdAt", "id");
CREATE INDEX "DemoChatMessage_webhookEventId_idx" ON "DemoChatMessage"("webhookEventId");
