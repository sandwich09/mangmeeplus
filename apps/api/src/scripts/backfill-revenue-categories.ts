/**
 * One-shot backfill: seed the six default revenue categories (ledger spec F-LED-2) for every
 * EXISTING company. New companies get them from onboarding; this covers companies created before
 * the RevenueCategory migration. Safe to re-run: the bootstrap is idempotent (NOT NULL companyId
 * unique fence + skipDuplicates), so a second pass creates zero rows.
 *
 * Run (from apps/api, DATABASE_URL pointing at the target env):
 *   pnpm exec tsx src/scripts/backfill-revenue-categories.ts
 */
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { bootstrapCompanyRevenueCategories } from '../modules/accounting-documents/application/services/revenue-category-bootstrap.service.js';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const companies = await prisma.company.findMany({ select: { id: true, name: true } });
    let createdTotal = 0;
    for (const company of companies) {
      const result = await prisma.$transaction((tx) => bootstrapCompanyRevenueCategories(tx, { companyId: company.id }));
      createdTotal += result.createdCount;
      if (result.createdCount > 0) {
        console.log(`seeded ${result.createdCount}/${result.categoryCount} revenue categories for ${company.id} (${company.name})`);
      }
    }
    console.log(`done: ${companies.length} companies scanned, ${createdTotal} category rows created`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
