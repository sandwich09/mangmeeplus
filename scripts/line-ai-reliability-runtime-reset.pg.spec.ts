/** Explicit local-only replay reset proof; requires a dedicated migrated disposable replay DB.
 * LINE_RELIABILITY_RESET_TEST_DATABASE_URL=<local replay DB> pnpm exec tsx --test scripts/line-ai-reliability-runtime-reset.pg.spec.ts
 * This is separate from the parallel domain PG runner: resetting its shared test DB would be unsafe.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertIsolatedReplayDatabase, resetRuntimeFixtureDatabase } from './line-ai-reliability-runtime';
import { AUTHORED_SOURCE_SNAPSHOT_MANIFEST } from './line-ai-reliability-corpus';

test('isolated reset restores database trigger enforcement after success and rollback', async () => {
  const url = process.env.LINE_RELIABILITY_RESET_TEST_DATABASE_URL;
  assert.ok(url, 'LINE_RELIABILITY_RESET_TEST_DATABASE_URL_REQUIRED'); assertIsolatedReplayDatabase(url);
  const requireApi = createRequire(resolve('apps/api/package.json'));
  const { Client } = requireApi('pg'); const db = new Client({ connectionString: url });
  await db.connect();
  try {
    assert.equal((await db.query("SELECT pg_try_advisory_lock(hashtext('line-reliability-runtime-reset')) AS locked")).rows[0].locked, true);
    await assert.rejects(resetRuntimeFixtureDatabase({ query: async sql => {
      if (sql.startsWith('TRUNCATE')) throw new Error('injected_cleanup_failure');
      return db.query(sql);
    } }, url), /injected_cleanup_failure/);
    assert.equal((await db.query("SHOW session_replication_role")).rows[0].session_replication_role, 'origin');
    await resetRuntimeFixtureDatabase(db, url);
    assert.equal((await db.query("SHOW session_replication_role")).rows[0].session_replication_role, 'origin');
    const record = Object.values(AUTHORED_SOURCE_SNAPSHOT_MANIFEST.snapshots).flatMap(s => s.rows).find(s => s.model === 'legalDocumentActionRecord')!.data;
    const fields = Object.keys(record); assert.ok(fields.every(name => /^[A-Za-z0-9_]+$/.test(name)));
    for (const mutation of [
      'UPDATE "public"."LegalDocumentActionRecord" SET "statementText" = \'blocked\'',
      'DELETE FROM "public"."LegalDocumentActionRecord"',
      'TRUNCATE TABLE "public"."LegalDocumentActionRecord"',
    ]) {
      await db.query('BEGIN');
      try {
        await db.query(`INSERT INTO "public"."LegalDocumentActionRecord" (${fields.map(f => `"${f}"`).join(',')}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(',')})`,
          fields.map(f => typeof record[f] === 'object' && record[f] !== null ? JSON.stringify(record[f]) : record[f]));
        await assert.rejects(db.query(mutation), (error: any) => error.code === '55000' && error.message.includes('append-only'));
      } finally { await db.query('ROLLBACK'); }
    }
  } finally { await db.end(); }
});
