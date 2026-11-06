CREATE TABLE "SalesDemoLink" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "companyId" TEXT,
  "openedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesDemoLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalesDemoLink_tokenHash_key" ON "SalesDemoLink"("tokenHash");
CREATE UNIQUE INDEX "SalesDemoLink_companyId_key" ON "SalesDemoLink"("companyId");
ALTER TABLE "SalesDemoLink" ADD CONSTRAINT "SalesDemoLink_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesDemoLink" ADD CONSTRAINT "SalesDemoLink_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailSendAttempt" ADD COLUMN "companyId" TEXT;
