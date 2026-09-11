/** Read-only local fixture check; never deletes or targets a remote database. */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../apps/api/src/generated/prisma/client';
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local database required');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const counts = {
      companies: await db.company.count({ where: { id: { startsWith: 'e2e-billing-' } } }),
      users: await db.user.count({ where: { id: { startsWith: 'e2e-billing-user-' } } }),
      handoffTokens: await db.lineWebHandoffToken.count({ where: { companyId: { startsWith: 'e2e-billing-' } } }),
      externalIdentities: await db.externalIdentity.count({ where: { providerChannelId: 'e2e-local', userId: { startsWith: 'e2e-billing-user-' } } }),
    };
    console.log(JSON.stringify(counts));
    if (Object.values(counts).some(Boolean)) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
void main();
