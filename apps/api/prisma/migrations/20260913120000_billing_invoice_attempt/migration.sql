ALTER TABLE "BillingInvoice" ADD COLUMN "sourceAttemptId" TEXT;
CREATE UNIQUE INDEX "BillingInvoice_sourceAttemptId_key" ON "BillingInvoice"("sourceAttemptId");
