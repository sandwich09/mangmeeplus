-- Item 10C: Employee Access and Role Management
-- Employee access profile (masked/encrypted identity) and short-lived LINE account-link tokens.

-- CreateEnum
CREATE TYPE "EmployeeIdentityType" AS ENUM ('THAI_NATIONAL_ID', 'PASSPORT');

-- CreateEnum
CREATE TYPE "EmployeeLineLinkTokenStatus" AS ENUM ('PENDING', 'USED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "EmployeeAccessProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "identityType" "EmployeeIdentityType" NOT NULL,
    "identityLast4" TEXT NOT NULL,
    "identityHash" TEXT NOT NULL,
    "identityEncryptedRef" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAccessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeLineLinkToken" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issuedByUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "EmployeeLineLinkTokenStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeLineLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAccessProfile_membershipId_key" ON "EmployeeAccessProfile"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAccessProfile_companyId_identityHash_key" ON "EmployeeAccessProfile"("companyId", "identityHash");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAccessProfile_companyId_phoneNumber_key" ON "EmployeeAccessProfile"("companyId", "phoneNumber");

-- CreateIndex
CREATE INDEX "EmployeeAccessProfile_companyId_status_idx" ON "EmployeeAccessProfile"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeLineLinkToken_tokenHash_key" ON "EmployeeLineLinkToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmployeeLineLinkToken_companyId_status_idx" ON "EmployeeLineLinkToken"("companyId", "status");

-- CreateIndex
CREATE INDEX "EmployeeLineLinkToken_membershipId_status_idx" ON "EmployeeLineLinkToken"("membershipId", "status");

-- AddForeignKey
ALTER TABLE "EmployeeAccessProfile" ADD CONSTRAINT "EmployeeAccessProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAccessProfile" ADD CONSTRAINT "EmployeeAccessProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAccessProfile" ADD CONSTRAINT "EmployeeAccessProfile_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CompanyMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLineLinkToken" ADD CONSTRAINT "EmployeeLineLinkToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
