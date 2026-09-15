ALTER TABLE "LineWebhookEventLog" ADD COLUMN "deliveryOwnerId" TEXT;
ALTER TABLE "LineLedgerDelivery" ADD COLUMN "entryKind" TEXT NOT NULL DEFAULT 'sub_request';
