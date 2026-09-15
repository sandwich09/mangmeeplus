ALTER TABLE "BillingAccount" ADD COLUMN "activeCollectionOperationId" TEXT;
CREATE UNIQUE INDEX "BillingAccount_activeCollectionOperationId_key" ON "BillingAccount"("activeCollectionOperationId");
