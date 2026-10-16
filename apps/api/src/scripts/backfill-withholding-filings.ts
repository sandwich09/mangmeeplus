/** One-off release operation. Run with the API's normal database and attachment-storage settings:
 * pnpm --filter @watchdog-bms/api exec node --import tsx src/scripts/backfill-withholding-filings.ts
 * Existing papers are never changed. Period locks serialize this command with downloads/filing.
 */
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfigService } from '../common/config/app-config.service';
import { LocalStorageAdapter } from '../modules/data-model-core/infrastructure/storage/local-storage.adapter';
import { S3StorageAdapter } from '../modules/data-model-core/infrastructure/storage/s3-storage.adapter';
import { restoreLegacyWithholdingPeriod } from '../modules/tax/application/services/legacy-withholding-filing';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const config = new AppConfigService();
  const storage = config.s3Bucket ? new S3StorageAdapter(config) : new LocalStorageAdapter();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const counts = { exact: 0, uncertain: 0, skipped: 0 };
  try {
    const periods = await db.taxPeriod.findMany({ where: { formType: { in: ['PND3', 'PND53'] }, status: { in: ['EXPORTED', 'FILED', 'PAID', 'CLOSED'] } }, select: { id: true, companyId: true }, orderBy: [{ companyId: 'asc' }, { periodKey: 'asc' }] });
    for (const period of periods) counts[await restoreLegacyWithholdingPeriod(db, storage, period)]++;
    console.log(JSON.stringify(counts));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
