/**
 * Idempotent permission/role sync for any environment (safe on production).
 * Upserts the code-defined permission registry, system roles, and role grants
 * only — never company/demo data, with one class of additive exception:
 * COMPANY_ROLE_BACKFILLS below. Each permission a backfill adds to a company role
 * writes an audit row (actor SYSTEM) in that company, in the same transaction.
 * Runs on production boot after migrate deploy so new permission keys ship
 * with the code that requires them.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { PERMISSIONS, ROLE_GRANTS, SYSTEM_ROLES } from '../src/modules/auth/permission-registry';
import { AuditAction } from '../src/modules/audit/domain/models/audit-action';
import { COMPANY_ROLE_BACKFILLS } from '../src/modules/employee-access/domain/registries/company-role-backfill.registry';

/** Minimal surface this sync needs, so seed.ts can pass its own client. */
type SyncClient = Pick<PrismaClient, 'permission' | 'role' | 'rolePermission' | 'company' | 'auditLog' | '$transaction'>;

/**
 * Reconcile permissions, system roles and their grants against the code registry.
 * Exported so `seed.ts` runs the identical logic — it used to keep its own additive copy,
 * which upserted grants but never revoked ones dropped from the registry, so any database
 * that had only ever been seeded kept permissions the code had deliberately removed.
 */
export async function syncPermissions(prisma: SyncClient, log: (message: string) => void = console.log) {
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: { description: perm.description, riskLevel: perm.riskLevel },
      create: { key: perm.key, description: perm.description, riskLevel: perm.riskLevel },
    });
  }

  for (const role of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { scopeKey_key: { scopeKey: 'system', key: role.key } },
      update: { name: role.name, description: role.description, isSystem: true },
      create: { scopeKey: 'system', key: role.key, name: role.name, description: role.description, isSystem: true },
    });
  }

  const allPerms = await prisma.permission.findMany();
  const permMap = new Map(allPerms.map((p) => [p.key, p.id]));

  let grants = 0;
  let revoked = 0;
  for (const role of SYSTEM_ROLES) {
    const dbRole = await prisma.role.findUniqueOrThrow({ where: { scopeKey_key: { scopeKey: 'system', key: role.key } } });
    const grantKeys = ROLE_GRANTS[role.key] ?? [];
    const grantIds: string[] = [];
    for (const permKey of grantKeys) {
      const permId = permMap.get(permKey);
      if (!permId) continue;
      grantIds.push(permId);
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: dbRole.id, permissionId: permId } },
        update: {},
        create: { roleId: dbRole.id, permissionId: permId },
      });
      grants += 1;
    }
    // System roles are code-defined: grants dropped from the registry must be
    // revoked too (e.g. crm.inbox.assign removed from SALES for ABAC pickup).
    // Custom/company roles live under other scopeKeys and are never touched.
    const removed = await prisma.rolePermission.deleteMany({
      where: { roleId: dbRole.id, permissionId: { notIn: grantIds } },
    });
    revoked += removed.count;
  }

  // Additive backfills for custom/company roles, never revoked. See the registry for why each
  // entry exists and why its anchor is the right one.
  const backfillReport: string[] = [];
  for (const backfill of COMPANY_ROLE_BACKFILLS) {
    const permissionId = permMap.get(backfill.key);
    if (!permissionId) {
      backfillReport.push(`${backfill.key}: SKIPPED (not in the permission registry)`);
      continue;
    }
    const anchorId = backfill.anchor ? permMap.get(backfill.anchor) : null;
    if (backfill.anchor && !anchorId) {
      backfillReport.push(`${backfill.key}: SKIPPED (anchor ${backfill.anchor} not in the registry)`);
      continue;
    }
    const companyRoles = await prisma.role.findMany({
      where: {
        scopeKey: { not: 'system' },
        // An anchored backfill lands only on roles that already hold the anchor, so it can never
        // widen a role that was not built from the same capability pack.
        ...(anchorId ? { permissions: { some: { permissionId: anchorId } } } : {}),
      },
      select: { id: true, companyId: true, permissions: { where: { permissionId }, select: { permissionId: true } } },
    });
    // Only a role that gains the key now is written and audited, so a rerun changes nothing.
    const gaining = companyRoles.filter((role) => role.permissions.length === 0);
    if (gaining.length > 0) {
      // Role.companyId is not a foreign key: an audit row pointing at a company that is gone would fail the deploy.
      const companies = await prisma.company.findMany({
        where: { id: { in: gaining.flatMap((role) => role.companyId ?? []) } },
        select: { id: true },
      });
      const companyIds = new Set(companies.map((company) => company.id));
      // One transaction per key: a grant never lands without the audit row that says the system made it.
      await prisma.$transaction([
        prisma.rolePermission.createMany({
          data: gaining.map((role) => ({ roleId: role.id, permissionId })),
          skipDuplicates: true,
        }),
        prisma.auditLog.createMany({
          data: gaining.map((role) => ({
            companyId: role.companyId && companyIds.has(role.companyId) ? role.companyId : null,
            actorType: 'SYSTEM' as const,
            action: AuditAction.ACCESS_ROLE_UPDATE,
            targetType: 'Role',
            targetId: role.id,
            requestId: `sync-permissions:${backfill.key}`,
            result: 'SUCCESS' as const,
            riskLevel: 'HIGH' as const,
            metadataJson: { source: 'sync-permissions', addedPermissionKeys: [backfill.key], anchor: backfill.anchor },
          })),
        }),
      ]);
    }
    backfillReport.push(
      `${backfill.key}: +${gaining.length} of ${companyRoles.length} matching company roles`
      + `${backfill.anchor ? ` (anchor ${backfill.anchor})` : ' (universal)'}`,
    );
  }

  log(`Permission sync complete: ${PERMISSIONS.length} permissions, ${SYSTEM_ROLES.length} roles, ${grants} grants upserted, ${revoked} stale grants revoked.`);
  log(`Company-role backfills:\n  ${backfillReport.join('\n  ')}`);
  return { grants, revoked };
}

/** Standalone entry point: production boot (`start-production.sh`) and the release task. */
async function main() {
  const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' });
  const prisma = new PrismaClient({ adapter });
  try {
    await syncPermissions(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

// tsx runs this file directly on boot; importing it from seed.ts must not re-run main().
if (process.argv[1]?.endsWith('sync-permissions.ts')) {
  main().catch((err) => {
    console.error('Permission sync failed:', err);
    process.exit(1);
  });
}
