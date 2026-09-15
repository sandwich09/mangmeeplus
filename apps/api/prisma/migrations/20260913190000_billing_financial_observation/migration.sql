ALTER TABLE "BillingInvoice" ADD COLUMN "disputed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "financialObservedAt" TIMESTAMP(3);
