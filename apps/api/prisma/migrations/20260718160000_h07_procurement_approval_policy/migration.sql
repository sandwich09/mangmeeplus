-- H-07: maker-checker policy for vendor bill approval.
-- Idempotent: safe if a dirty-tree deploy already recorded a partial apply.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "ProcurementApprovalPolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "dualApprovalThresholdAmount" DECIMAL(18,4),
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcurementApprovalPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProcurementApprovalPolicy_companyId_key" ON "ProcurementApprovalPolicy"("companyId");

DO $$ BEGIN
  ALTER TABLE "ProcurementApprovalPolicy"
    ADD CONSTRAINT "ProcurementApprovalPolicy_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill: recording a supplier payment now requires the new release
-- permission in addition to create. Boot-time sync-permissions covers system
-- roles only; custom/company roles (including capability-pack-compiled ones)
-- must keep working, so every role currently holding create is granted
-- release here. Orgs can then revoke release per role to split duties.
INSERT INTO "Permission" ("id", "key", "description", "riskLevel", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'procurement.supplier_payment.release',
       'Release supplier payment funds (H-07 maker-checker split)',
       'CRITICAL'::"PermissionRiskLevel", NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "key" = 'procurement.supplier_payment.release');

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", target."id"
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId" AND source."key" = 'procurement.supplier_payment.create'
JOIN "Permission" target ON target."key" = 'procurement.supplier_payment.release'
ON CONFLICT DO NOTHING;
