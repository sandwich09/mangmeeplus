-- Keep successful draft command results after a draft is edited or deleted.
CREATE TABLE "DisbursementVoucherCommand" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "payloadFingerprint" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DisbursementVoucherCommand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DisbursementVoucherCommand_companyId_commandId_key" ON "DisbursementVoucherCommand"("companyId", "commandId");
CREATE INDEX "DisbursementVoucherCommand_companyId_voucherId_idx" ON "DisbursementVoucherCommand"("companyId", "voucherId");
ALTER TABLE "DisbursementVoucherCommand" ADD CONSTRAINT "DisbursementVoucherCommand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
