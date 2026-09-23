// One-off ops utility: grant a (new or existing) user the SYSTEM_ADMIN role.
// Mirrors the seed.ts system-admin shape: user + credential + membership in the
// มั่งมีพลัส · ระบบภายใน company + SYSTEM_ADMIN membership role.
//
// Usage (from apps/api):
//   DATABASE_URL=... ADMIN_USERNAME=jane.doe ADMIN_PASSWORD='...' \
//     [ADMIN_DISPLAY_NAME='Jane Doe'] [ADMIN_MUST_CHANGE_PASSWORD=true] pnpm exec tsx prisma/add-system-admin.ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword } from '../src/modules/auth/domain/logic/password-credential.logic';

const SEED_SYSTEM_COMPANY_ID = 'seed-watchdog-system-company';

const username = process.env['ADMIN_USERNAME'];
const password = process.env['ADMIN_PASSWORD'];
const displayName = process.env['ADMIN_DISPLAY_NAME'] ?? username;
const mustChangePassword = process.env['ADMIN_MUST_CHANGE_PASSWORD'] === 'true';

if (!username || !password) {
  console.error('ADMIN_USERNAME and ADMIN_PASSWORD are required.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' });
const prisma = new PrismaClient({ adapter });

async function main() {
  const systemCompany = await prisma.company.findUnique({ where: { id: SEED_SYSTEM_COMPANY_ID } });
  if (!systemCompany) {
    throw new Error('System company not found. Run the seed first (pnpm exec tsx prisma/seed.ts).');
  }

  const user = await prisma.user.upsert({
    where: { username: username! },
    update: { displayName: displayName!, status: 'ACTIVE' },
    create: { username: username!, displayName: displayName!, status: 'ACTIVE', isSystemProtected: true },
  });

  // Overwrites the password on purpose: this utility is also the local password-reset path for admins.
  await prisma.userCredential.upsert({
    where: { userId: user.id },
    update: { passwordHash: hashPassword(password!), status: 'ACTIVE', mustChangePassword, expiresAt: null },
    create: { userId: user.id, passwordHash: hashPassword(password!), status: 'ACTIVE', mustChangePassword },
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

  console.log(`SYSTEM_ADMIN ready: ${username} (userId=${user.id}, mustChangePassword=${mustChangePassword})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
