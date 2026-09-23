import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword, verifyPassword } from '../src/modules/auth/domain/logic/password-credential.logic';
import { PERMISSIONS, ROLE_GRANTS, SYSTEM_ROLES } from '../src/modules/auth/permission-registry';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' });
const prisma = new PrismaClient({ adapter });

const SYSTEM_COMPANY_ID = 'seed-watchdog-system-company';
const SYSTEM_ADMIN_ID = 'seed-watchdog-system-admin';

async function main() {
  const username = process.env['SEED_SYSTEM_ADMIN_USERNAME'] ?? 'thawatchai.watchdog';
  const password = process.env['SEED_SYSTEM_ADMIN_PASSWORD'];
  if (!password) return;

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

  const permissions = await prisma.permission.findMany();
  const permissionIds = new Map(permissions.map((permission) => [permission.key, permission.id]));
  for (const role of SYSTEM_ROLES) {
    const dbRole = await prisma.role.findUniqueOrThrow({ where: { scopeKey_key: { scopeKey: 'system', key: role.key } } });
    for (const permissionKey of ROLE_GRANTS[role.key] ?? []) {
      const permissionId = permissionIds.get(permissionKey);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: dbRole.id, permissionId } },
        update: {},
        create: { roleId: dbRole.id, permissionId },
      });
    }
  }

  const systemCompany = await prisma.company.upsert({
    where: { id: SYSTEM_COMPANY_ID },
    update: { name: 'มั่งมีพลัส · ระบบภายใน' },
    create: { id: SYSTEM_COMPANY_ID, name: 'มั่งมีพลัส · ระบบภายใน' },
  });

  const user = await prisma.user.upsert({
    where: { username },
    update: { displayName: 'ผู้ดูแลระบบมั่งมีพลัส', status: 'ACTIVE', isSystemProtected: true },
    create: {
      id: SYSTEM_ADMIN_ID,
      username,
      displayName: 'ผู้ดูแลระบบมั่งมีพลัส',
      status: 'ACTIVE',
      isSystemProtected: true,
    },
  });

  const passwordHash = hashPassword(password);
  await prisma.userCredential.upsert({
    where: { userId: user.id },
    update: { passwordHash, status: 'ACTIVE', mustChangePassword: false, expiresAt: null },
    create: { userId: user.id, passwordHash, status: 'ACTIVE', mustChangePassword: false },
  });

  const membership = await prisma.companyMembership.upsert({
    where: { companyId_userId: { companyId: systemCompany.id, userId: user.id } },
    update: { status: 'ACTIVE' },
    create: { companyId: systemCompany.id, userId: user.id, status: 'ACTIVE' },
  });
  const systemAdminRole = await prisma.role.findUniqueOrThrow({
    where: { scopeKey_key: { scopeKey: 'system', key: 'SYSTEM_ADMIN' } },
  });
  await prisma.membershipRole.upsert({
    where: { membershipId_roleId: { membershipId: membership.id, roleId: systemAdminRole.id } },
    update: {},
    create: { membershipId: membership.id, roleId: systemAdminRole.id },
  });

  const credential = await prisma.userCredential.findUniqueOrThrow({
    where: { userId: user.id },
    select: { passwordHash: true },
  });
  if (!verifyPassword(password, credential.passwordHash)) {
    throw new Error('System admin password reset verification failed.');
  }

  console.log(`System admin password reset for ${user.username}`);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
