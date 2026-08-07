-- Preserve one immutable PP36 recognition snapshot per supplier-payment allocation.
ALTER TABLE "SupplierPaymentAllocation"
ADD COLUMN "pp36RecognitionJson" JSONB,
ADD COLUMN "pp36RecognitionStatus" TEXT,
ADD COLUMN "pp36ReversedAt" TIMESTAMP(3),
ADD COLUMN "pp36ReversedByUserId" TEXT,
ADD COLUMN "pp36ReversalReason" TEXT;

ALTER TABLE "SupplierPayment" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "SupplierPayment_companyId_idempotencyKey_key"
ON "SupplierPayment"("companyId", "idempotencyKey");

-- A verified payment proof can recognize PP36 for only one supplier payment.
-- Bindings are retained after reversal as the audit trail; they are never deleted.
CREATE TABLE "Pp36PaymentEvidenceBinding" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "supplierPaymentId" TEXT NOT NULL,
  "supplierPaymentAllocationId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Pp36PaymentEvidenceBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Pp36PaymentEvidenceBinding_evidenceId_key"
ON "Pp36PaymentEvidenceBinding"("evidenceId");
CREATE UNIQUE INDEX "Pp36PaymentEvidenceBinding_supplierPaymentAllocationId_evidenceId_key"
ON "Pp36PaymentEvidenceBinding"("supplierPaymentAllocationId", "evidenceId");
CREATE INDEX "Pp36PaymentEvidenceBinding_companyId_supplierPaymentId_idx"
ON "Pp36PaymentEvidenceBinding"("companyId", "supplierPaymentId");

ALTER TABLE "Pp36PaymentEvidenceBinding"
ADD CONSTRAINT "Pp36PaymentEvidenceBinding_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Pp36PaymentEvidenceBinding"
ADD CONSTRAINT "Pp36PaymentEvidenceBinding_supplierPaymentId_fkey"
FOREIGN KEY ("supplierPaymentId") REFERENCES "SupplierPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Pp36PaymentEvidenceBinding"
ADD CONSTRAINT "Pp36PaymentEvidenceBinding_supplierPaymentAllocationId_fkey"
FOREIGN KEY ("supplierPaymentAllocationId") REFERENCES "SupplierPaymentAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
