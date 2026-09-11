import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './src/generated/prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.pathname, '/expense_number_impl_20260911');
  assert.equal(url.hostname, '127.0.0.1');
  url.pathname = '/expense_number_impl_migration_20260911';
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
  try {
    // Query raw rows so old schema and additive columns are compared without generated-client skew.
    const snapshot = async () => {
      const result: Record<string, any[]> = {};
      for (const table of ['ExpenseRecord','ExpenseLine','ExpenseSubstituteReceiptEvidence','ReimbursementRequest','ReimbursementLine','ReimbursementPayment','ExpensePayment','JournalEntry','JournalLine','DocumentNumber','DocumentSequence','AttachmentObject','OutboxEvent']) {
        const rows = await db.$queryRawUnsafe<any[]>(`SELECT row_to_json(t)::jsonb AS row FROM "${table}" t ORDER BY id`);
        result[table] = rows.map(({ row }) => { delete row.draftIdempotencyKey; delete row.draftPayloadHash; return row; });
      }
      return result;
    };
    const before = await snapshot();
    const sql = readFileSync('prisma/migrations/20260911120000_expense_draft_number_identity/migration.sql','utf8');
    await db.$transaction(async tx => { for (const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement); });
    const after = await snapshot();
    assert.deepEqual(after, before);
    const digest = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const columns = await db.$queryRawUnsafe<any[]>('SELECT count(*)::int AS count FROM "ExpenseRecord" WHERE "draftIdempotencyKey" IS NOT NULL OR "draftPayloadHash" IS NOT NULL');
    assert.equal(columns[0].count,0);
    const report = { rehearsal: 'additive EXP migration on restored pre-change local DB', equal: true, backfilledRows: 0,
      tables: Object.fromEntries(Object.entries(before).map(([name, rows]) => [name, { count: rows.length, beforeSha256: digest(rows), afterSha256: digest(after[name]) }])) };
    writeFileSync('/tmp/expense-number-impl-migration-result.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally { await db.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exitCode=1; });
