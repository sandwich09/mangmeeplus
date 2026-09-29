-- Add-on foundation (chat credit and receipt image plan, PR A): attempts and invoices know what they sell,
-- and add-on Checkout gets its own slot. Additive only; every existing row becomes PACKAGE from the default.
ALTER TABLE "BillingAccount" ADD COLUMN "activeAddOnAttemptId" TEXT;
ALTER TABLE "BillingAttempt" ADD COLUMN "productKind" TEXT NOT NULL DEFAULT 'PACKAGE';
ALTER TABLE "BillingInvoice" ADD COLUMN "productKind" TEXT NOT NULL DEFAULT 'PACKAGE';
CREATE UNIQUE INDEX "BillingAccount_activeAddOnAttemptId_key" ON "BillingAccount"("activeAddOnAttemptId");
CREATE INDEX "BillingInvoice_billingAccountId_productKind_periodEnd_idx" ON "BillingInvoice"("billingAccountId", "productKind", "periodEnd");
