/** One-time repair of unissued expense handoffs; run with the API's normal database settings:
 * pnpm --filter @watchdog-bms/api exec node --import tsx src/scripts/repair-pnd2-handoffs.ts --dry-run
 * Writes only with --apply; any other run is a dry run. Issued and external certificate snapshots are never changed.
 */
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client';
import { withholdingFormFor } from '../modules/tax/domain/logic/expense-payment-withholding.logic';

export async function repairPnd2Handoffs(db: PrismaClient, dryRun: boolean) {
  const categories = await db.whtIncomeCategory.findMany({ where: { filingRoute: 'SEPARATE_PND2' }, select: { code: true } });
  const codes = new Set(categories.map(row => row.code));
  const unissued = { status: 'REQUIRED' as const, certificateId: null, externalCertificateNumber: null, sourcePaymentType: 'expense.record' };
  const rows = await db.whtCertificateHandoff.findMany({ where: unissued });
  let matched = 0, updated = 0;
  for (const row of rows) {
    const prefill = row.prefillSnapshotJson as Prisma.JsonObject | null;
    if (!prefill || prefill.formType === 'PND2' || typeof prefill.incomeCategoryCode !== 'string' || !codes.has(prefill.incomeCategoryCode) || !row.sourcePaymentId) continue;
    const expense = await db.expenseRecord.findFirst({ where: { id: row.sourcePaymentId, companyId: row.companyId, vendorEntityKindSnapshot: 'INDIVIDUAL' }, select: { vendorEntityKindSnapshot: true } });
    if (!expense) continue;
    matched++;
    if (dryRun) continue;
    const next = { ...prefill, formType: withholdingFormFor(expense.vendorEntityKindSnapshot, 'SEPARATE_PND2') };
    const hash = createHash('sha256').update(JSON.stringify(next)).digest('hex');
    const result = await db.whtCertificateHandoff.updateMany({
      where: { ...unissued, id: row.id, companyId: row.companyId, updatedAt: row.updatedAt },
      data: { prefillSnapshotJson: next, prefillSnapshotHash: hash, payloadFingerprint: hash },
    });
    updated += result.count;
  }
  return { matched, updated };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const dryRun = !process.argv.includes('--apply');
  try { console.log(JSON.stringify({ dryRun, ...await repairPnd2Handoffs(db, dryRun) })); }
  finally { await db.$disconnect(); }
}
if (require.main === module) void main().catch(error => { console.error(error); process.exitCode = 1; });
