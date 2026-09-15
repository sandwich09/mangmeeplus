ALTER TABLE "BillingAttempt" ADD COLUMN "collectionJson" JSONB;
ALTER TABLE "BillingInvoice" ALTER COLUMN "subscriptionId" DROP NOT NULL;
