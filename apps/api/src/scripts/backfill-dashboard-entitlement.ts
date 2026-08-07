import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('backfill_dashboard_entitlement_database_url_required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    const { count } = await prisma.companyFeatureEntitlement.updateMany({
      where: { featureKey: 'dashboard_notifications', enabled: false },
      data: { enabled: true },
    });
    console.log(JSON.stringify({
      event: 'backfill_dashboard_entitlement_complete',
      updatedCount: count,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({
    event: 'backfill_dashboard_entitlement_failed',
    errorCode: error instanceof Error && /^[a-z0-9_]+$/i.test(error.message)
      ? error.message
      : 'backfill_dashboard_entitlement_failed',
  }));
  process.exit(1);
});
