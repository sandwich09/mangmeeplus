/**
 * Step 0 Release A migration proof, against a REAL PostgreSQL.
 *
 * Hard-fails without a database instead of skipping. Everything asserted here is Postgres
 * semantics that no mock reproduces — a partial unique index, `date` column round-tripping,
 * and the backfill SQL itself — so a green "0 tests, all skipped" run would be a lie about
 * exactly the statements that run once, in production, with no undo.
 *
 * Every fixture lives inside a transaction that is rolled back, so the spec is safe to point
 * at any migrated database including a shared dev one.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';

const MIGRATION_SQL_PATH = path.resolve(
  __dirname,
  '../../../../prisma/migrations/20260804180000_company_tax_identity_step0/migration.sql',
);

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL is required. This suite proves PostgreSQL-only behaviour (partial unique ' +
        'index, date columns, backfill SQL); skipping it would report success for assertions ' +
        'that never ran. Run it through `pnpm --filter @watchdog-bms/api test:tax-identity-pg` ' +
        'against a migrated database.',
    );
  }
  return url;
}

/** Pull a backfill statement out of the real migration file rather than restating it here. */
function migrationStatementStartingWith(prefix: string): string {
  // Comments are stripped BEFORE splitting on ';': a semicolon inside a `--` comment would
  // otherwise cut a statement in half and leave prose glued to the SQL.
  const sql = readFileSync(MIGRATION_SQL_PATH, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const statements = sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  const match = statements.filter((statement) => statement.startsWith(prefix));
  assert.equal(
    match.length,
    1,
    `expected exactly one migration statement starting with ${JSON.stringify(prefix)}, found ${match.length} — ` +
      'the migration was edited and this proof no longer covers it',
  );
  return match[0];
}

const CO_DATED = 'step0-pg-dated';
const CO_UNDATED = 'step0-pg-undated';
const CO_NOT_REGISTERED = 'step0-pg-not-registered';

describe('Step 0 Release A migration (real PostgreSQL)', () => {
  let client: Client;

  before(async () => {
    client = new Client({ connectionString: requireDatabaseUrl(), application_name: 'step0-migration-pg-spec' });
    await client.connect();
  });

  after(async () => {
    await client?.end();
  });

  it('left no failed migration row behind', async () => {
    const { rows } = await client.query(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`,
    );
    assert.deepEqual(rows, [], 'a failed or unfinished migration is recorded in _prisma_migrations');
  });

  it('created all nine tables and the partial unique index', async () => {
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1)`,
      [
        [
          'CompanyLegalIdentityRevision',
          'CompanyVatRegistrationState',
          'CompanyVatRegistrationCommand',
          'CompanyVatRegistrationFact',
          'VatRegistrationPrompt',
          'CompanyIdentityReconciliationItem',
          'AccountingDocumentIssueCommand',
          'AccountingDocumentBuyerEvidenceRevision',
          'AccountingIssueAuthzObservation',
        ],
      ],
    );
    assert.equal(rows.length, 9, `missing tables: ${rows.map((r) => r.table_name).join(', ')}`);

    const index = await client.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'identity_reconciliation_item_pending_key'`,
    );
    assert.equal(index.rows.length, 1, 'partial unique index is missing');
    assert.match(index.rows[0].indexdef, /WHERE \(status = 'PENDING'/);
  });

  // The whole point of making it partial: one open item per key, unlimited closed ones. If this
  // were a plain unique the second drift on a key could not be recorded at all, and the resolver
  // would have to reopen a resolved row — which erases the history the audit needs.
  it('allows one PENDING and unlimited RESOLVED reconciliation items per key', async () => {
    await client.query('BEGIN');
    try {
      await insertCompany(client, CO_DATED, 'Pending key company');
      const insertItem = (status: string, fingerprint: string) =>
        client.query(
          `INSERT INTO "CompanyIdentityReconciliationItem"
             ("id","companyId","kind","discriminator","sourceState","payloadMaskedJson","sourceFingerprint","status","updatedAt")
           VALUES (gen_random_uuid()::text,$1,'TAX_ID','TAX_ID','PENDING_CONFLICT','{}'::jsonb,$2,$3::"ReconciliationStatus",NOW())`,
          [CO_DATED, fingerprint, status],
        );

      await insertItem('RESOLVED', 'fp-1');
      await insertItem('RESOLVED', 'fp-2');
      await insertItem('PENDING', 'fp-3');
      await assert.rejects(
        () => insertItem('PENDING', 'fp-4'),
        /duplicate key value/,
        'a second PENDING row for the same key must be refused',
      );
    } finally {
      await client.query('ROLLBACK');
    }
  });

  // A `date` column written through a local-midnight Date shifts a day in Asia/Bangkok. This
  // asserts the column itself carries no time and no offset, which is what makes the civil-date
  // helper's UTC-midnight rule sufficient.
  it('round-trips an effectiveFrom date without shifting the day', async () => {
    await client.query('BEGIN');
    try {
      await insertCompany(client, CO_DATED, 'Date round trip');
      await client.query(
        `INSERT INTO "CompanyVatRegistrationFact" ("id","companyId","status","effectiveFrom","source")
         VALUES ('step0-pg-fact',$1,'REGISTERED','2026-08-04','USER_ANSWER')`,
        [CO_DATED],
      );
      const { rows } = await client.query(
        `SELECT to_char("effectiveFrom", 'YYYY-MM-DD') AS day FROM "CompanyVatRegistrationFact" WHERE id = 'step0-pg-fact'`,
      );
      assert.equal(rows[0].day, '2026-08-04');
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('backfills isVatEstablishment from taxBranchCode and from nothing else', async () => {
    await client.query('BEGIN');
    try {
      await insertCompany(client, CO_DATED, 'Branch backfill');
      await insertBranch(client, 'step0-br-coded', CO_DATED, 'HO', '00000');
      await insertBranch(client, 'step0-br-uncoded', CO_DATED, 'WH', null);

      await client.query(migrationStatementStartingWith('UPDATE "Branch"'));

      const { rows } = await client.query(
        `SELECT id, "isVatEstablishment" FROM "Branch" WHERE "companyId" = $1 ORDER BY id`,
        [CO_DATED],
      );
      assert.deepEqual(rows, [
        { id: 'step0-br-coded', isVatEstablishment: true },
        { id: 'step0-br-uncoded', isVatEstablishment: false },
      ]);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('creates exactly one VAT state row per company and is safe to re-run', async () => {
    await client.query('BEGIN');
    try {
      await insertCompany(client, CO_DATED, 'State backfill');
      const statement = migrationStatementStartingWith('INSERT INTO "CompanyVatRegistrationState"');
      await client.query(statement);
      await client.query(statement);

      const { rows } = await client.query(
        `SELECT version FROM "CompanyVatRegistrationState" WHERE "companyId" = $1`,
        [CO_DATED],
      );
      assert.deepEqual(rows, [{ version: 0 }]);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  // The rule that keeps a guess out of the tax record: a legacy `vatRegistered = true` with no
  // date is a hint for a human to date, not an answer anyone gave.
  it('seeds a VAT fact only for a dated legacy answer, and never touches Company.vatRegistered', async () => {
    await client.query('BEGIN');
    try {
      await insertCompany(client, CO_DATED, 'Dated legacy');
      await insertCompany(client, CO_UNDATED, 'Undated legacy');
      await insertCompany(client, CO_NOT_REGISTERED, 'Not registered');
      await insertTaxProfile(client, CO_DATED, true, '2020-01-15');
      await insertTaxProfile(client, CO_UNDATED, true, null);
      await insertTaxProfile(client, CO_NOT_REGISTERED, false, '2020-01-15');

      const statement = migrationStatementStartingWith('INSERT INTO "CompanyVatRegistrationFact"');
      // Run under a non-UTC session timezone: the same migration must seed the same calendar
      // day on every server, so the date cast may not depend on the session's TimeZone.
      await client.query("SET LOCAL TimeZone = 'Asia/Bangkok'");
      await client.query(statement);
      await client.query(statement); // re-runnable: the NOT EXISTS guard holds

      const { rows } = await client.query(
        `SELECT "companyId", status::text, to_char("effectiveFrom",'YYYY-MM-DD') AS day, "effectiveTo", source::text
         FROM "CompanyVatRegistrationFact" WHERE "companyId" = ANY($1) ORDER BY "companyId"`,
        [[CO_DATED, CO_UNDATED, CO_NOT_REGISTERED]],
      );
      assert.deepEqual(rows, [
        { companyId: CO_DATED, status: 'REGISTERED', day: '2020-01-15', effectiveTo: null, source: 'LEGACY_SEED' },
      ]);

      const mirrors = await client.query(
        `SELECT "vatRegistered" FROM "Company" WHERE id = ANY($1)`,
        [[CO_DATED, CO_UNDATED, CO_NOT_REGISTERED]],
      );
      assert.deepEqual(
        mirrors.rows.map((row) => row.vatRegistered),
        [false, false, false],
        'the seed must not write the mirror bit that seven call sites already read',
      );
    } finally {
      await client.query('ROLLBACK');
    }
  });
});

async function insertCompany(client: Client, id: string, name: string): Promise<void> {
  await client.query(`INSERT INTO "Company" ("id","name","updatedAt") VALUES ($1,$2,NOW())`, [id, name]);
}

async function insertBranch(
  client: Client,
  id: string,
  companyId: string,
  code: string,
  taxBranchCode: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO "Branch" ("id","companyId","code","name","taxBranchCode","updatedAt") VALUES ($1,$2,$3,$3,$4,NOW())`,
    [id, companyId, code, taxBranchCode],
  );
}

async function insertTaxProfile(
  client: Client,
  companyId: string,
  vatRegistered: boolean,
  vatEffectiveDate: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO "CompanyTaxProfile" ("id","companyId","vatRegistered","vatEffectiveDate","updatedAt")
     VALUES ($1,$1,$2,$3::timestamp,NOW())`,
    [companyId, vatRegistered, vatEffectiveDate],
  );
}
