-- มั่งมี Flow A (spec D8): online booking / appointment calendar.
-- CreateEnum
CREATE TYPE "CrmBookingStatus" AS ENUM ('BOOKED', 'CANCELLED', 'DONE');

-- CreateTable
CREATE TABLE "CrmBooking" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "serviceName" TEXT NOT NULL,
    "staffUserId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "CrmBookingStatus" NOT NULL DEFAULT 'BOOKED',
    "sourceConversationId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmBooking_companyId_branchId_startAt_idx" ON "CrmBooking"("companyId", "branchId", "startAt");

-- CreateIndex
CREATE INDEX "CrmBooking_companyId_staffUserId_startAt_idx" ON "CrmBooking"("companyId", "staffUserId", "startAt");

-- CreateIndex
CREATE INDEX "CrmBooking_companyId_customerId_idx" ON "CrmBooking"("companyId", "customerId");

-- AddForeignKey
ALTER TABLE "CrmBooking" ADD CONSTRAINT "CrmBooking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
