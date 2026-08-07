-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('LINE', 'DEV');

-- CreateEnum
CREATE TYPE "ExternalIdentityStatus" AS ENUM ('ACTIVE', 'UNLINKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AuthSessionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RoleStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "PermissionRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "status" "AuthSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "providerChannelId" TEXT NOT NULL,
    "status" "ExternalIdentityStatus" NOT NULL DEFAULT 'ACTIVE',
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineChannelBinding" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lineOfficialAccountId" TEXT,
    "messagingChannelId" TEXT NOT NULL,
    "liffChannelId" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineChannelBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMembership" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "defaultBranchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "status" "RoleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "riskLevel" "PermissionRiskLevel" NOT NULL DEFAULT 'LOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "MembershipRole" (
    "membershipId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "MembershipRole_pkey" PRIMARY KEY ("membershipId","roleId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "requestId" TEXT NOT NULL,
    "result" "AuditResult" NOT NULL,
    "riskLevel" "AuditRiskLevel" NOT NULL DEFAULT 'LOW',
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "eventType" TEXT NOT NULL,
    "aggregateId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenId_key" ON "AuthSession"("tokenId");

-- CreateIndex
CREATE INDEX "AuthSession_userId_status_expiresAt_idx" ON "AuthSession"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "ExternalIdentity_userId_provider_status_idx" ON "ExternalIdentity"("userId", "provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_provider_providerChannelId_providerUserId_key" ON "ExternalIdentity"("provider", "providerChannelId", "providerUserId");

-- CreateIndex
CREATE INDEX "LineChannelBinding_messagingChannelId_status_idx" ON "LineChannelBinding"("messagingChannelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LineChannelBinding_companyId_messagingChannelId_key" ON "LineChannelBinding"("companyId", "messagingChannelId");

-- CreateIndex
CREATE INDEX "CompanyMembership_userId_status_idx" ON "CompanyMembership"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMembership_companyId_userId_key" ON "CompanyMembership"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_scopeKey_key_key" ON "Role"("scopeKey", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog"("requestId");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_createdAt_idx" ON "OutboxEvent"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineChannelBinding" ADD CONSTRAINT "LineChannelBinding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CompanyMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
