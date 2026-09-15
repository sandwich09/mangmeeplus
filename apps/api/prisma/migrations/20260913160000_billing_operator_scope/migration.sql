CREATE TABLE "BillingOperatorScope" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "stripeAccountId" TEXT NOT NULL,
  "livemode" BOOLEAN NOT NULL,
  "companyId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT NOT NULL,
  CONSTRAINT "BillingOperatorScope_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingOperatorScope_userId_stripeAccountId_livemode_companyId_key" ON "BillingOperatorScope"("userId", "stripeAccountId", "livemode", "companyId");
