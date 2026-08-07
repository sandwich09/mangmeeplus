-- Item 10A: platform company onboarding foundations

CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'TEMPORARY', 'DISABLED');

ALTER TABLE "User"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "isSystemProtected" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

CREATE TABLE "UserCredential" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
  "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserCredential_userId_key" ON "UserCredential"("userId");
CREATE INDEX "UserCredential_status_expiresAt_idx" ON "UserCredential"("status", "expiresAt");

ALTER TABLE "UserCredential"
  ADD CONSTRAINT "UserCredential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Protected system principals may change only their password credential.
CREATE OR REPLACE FUNCTION "prevent_protected_user_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."isSystemProtected"
    AND (
      NEW."username" IS DISTINCT FROM OLD."username"
      OR NEW."displayName" IS DISTINCT FROM OLD."displayName"
      OR NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."isSystemProtected" IS DISTINCT FROM OLD."isSystemProtected"
    ) THEN
    RAISE EXCEPTION 'Protected system user cannot be modified';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "prevent_protected_user_delete"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."isSystemProtected" THEN
    RAISE EXCEPTION 'Protected system user cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "prevent_protected_membership_mutation"()
RETURNS TRIGGER AS $$
DECLARE
  protected_user_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    protected_user_id := OLD."userId";
  ELSE
    protected_user_id := NEW."userId";
  END IF;

  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1
    FROM "User"
    WHERE "id" = protected_user_id
      AND "isSystemProtected"
  ) THEN
    RAISE EXCEPTION 'Protected system user membership cannot be modified';
  END IF;

  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1
    FROM "User"
    WHERE "id" = protected_user_id
      AND "isSystemProtected"
  ) AND (
    NEW."companyId" IS DISTINCT FROM OLD."companyId"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."defaultBranchId" IS DISTINCT FROM OLD."defaultBranchId"
    OR NEW."branchScopeMode" IS DISTINCT FROM OLD."branchScopeMode"
  ) THEN
    RAISE EXCEPTION 'Protected system user membership cannot be modified';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "prevent_protected_system_role_removal"()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CompanyMembership" membership
    JOIN "User" user_account ON user_account."id" = membership."userId"
    JOIN "Role" role ON role."id" = OLD."roleId"
    WHERE membership."id" = OLD."membershipId"
      AND user_account."isSystemProtected"
      AND role."scopeKey" = 'system'
      AND role."key" = 'SYSTEM_ADMIN'
  ) THEN
    RAISE EXCEPTION 'Protected SYSTEM_ADMIN role cannot be removed';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "User_protected_mutation" ON "User";
CREATE TRIGGER "User_protected_mutation"
BEFORE UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION "prevent_protected_user_mutation"();

DROP TRIGGER IF EXISTS "User_protected_delete" ON "User";
CREATE TRIGGER "User_protected_delete"
BEFORE DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION "prevent_protected_user_delete"();

DROP TRIGGER IF EXISTS "CompanyMembership_protected_mutation" ON "CompanyMembership";
CREATE TRIGGER "CompanyMembership_protected_mutation"
BEFORE UPDATE OR DELETE ON "CompanyMembership"
FOR EACH ROW EXECUTE FUNCTION "prevent_protected_membership_mutation"();

DROP TRIGGER IF EXISTS "MembershipRole_protected_system_admin_mutation" ON "MembershipRole";
CREATE TRIGGER "MembershipRole_protected_system_admin_mutation"
BEFORE UPDATE OR DELETE ON "MembershipRole"
FOR EACH ROW EXECUTE FUNCTION "prevent_protected_system_role_removal"();
