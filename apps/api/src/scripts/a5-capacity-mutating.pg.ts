import { createHash } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';

export const CAPACITY_AGGREGATE_TYPE = 'U5CapacityProbe';
export const CAPACITY_INBOX_SOURCE_TYPE = 'U5CapacityProbe';

export type CapacitySqlClient = {
  query<R extends QueryResultRow = any>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
};

export type CapacityEstateFingerprint = {
  outboxCount: number;
  outboxStateHash: string;
  inboxCount: number;
  inboxStateHash: string;
  nullCompanyOutbox: number;
};

export type CapacityClaimRow = {
  id: string;
  companyId: string | null;
  aggregateType: string;
  eventKey: string;
  eventType: string;
  aggregateId: string;
  payloadJson: { occurredAt?: string; data?: Record<string, unknown> };
  claimToken: string | null;
  createdAt: Date;
};

function fixtureEventPattern(marker: string): string {
  return `${marker}:%`;
}

function quotedIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('capacity_relation_identifier_invalid');
  return `"${value.replaceAll('"', '""')}"`;
}

export function fingerprintHash(fingerprint: CapacityEstateFingerprint): string {
  return createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
}

/** Hash only the two shared relations the workload mutates; exact-marker fixture rows are excluded. */
export async function readCapacityEstateFingerprint(
  client: CapacitySqlClient,
  companyId: string,
  marker: string,
): Promise<CapacityEstateFingerprint> {
  const outbox = await client.query<{ count: number; hash: string; nulls: number }>(`
    SELECT count(*)::int AS count,
           md5(coalesce(string_agg(md5(concat_ws('|', id, status::text, attempts::text,
             coalesce("availableAt"::text,''), coalesce("lockedAt"::text,''), coalesce("lockedBy",''),
             coalesce("claimToken",''), coalesce("publishedAt"::text,''), coalesce("lastError",''),
             "updatedAt"::text, coalesce("companyId",''))), '' ORDER BY id), '')) AS hash,
           count(*) FILTER (WHERE "companyId" IS NULL)::int AS nulls
    FROM "OutboxEvent"
    WHERE "companyId" IS DISTINCT FROM $1
       OR "aggregateType" <> $2
       OR "eventKey" NOT LIKE $3
  `, [companyId, CAPACITY_AGGREGATE_TYPE, fixtureEventPattern(marker)]);
  const inbox = await client.query<{ count: number; hash: string }>(`
    SELECT count(*)::int AS count,
           md5(coalesce(string_agg(md5(concat_ws('|', id, status::text, coalesce("processedAt"::text,''),
             coalesce("errorCode",''), coalesce("errorMessage",''))), '' ORDER BY id), '')) AS hash
    FROM "WorkflowEventInbox"
    WHERE "companyId" <> $1 OR "sourceType" <> $2 OR "dedupKey" NOT LIKE $3
  `, [companyId, CAPACITY_INBOX_SOURCE_TYPE, fixtureEventPattern(marker)]);
  return {
    outboxCount: Number(outbox.rows[0]?.count ?? -1),
    outboxStateHash: outbox.rows[0]?.hash ?? '',
    inboxCount: Number(inbox.rows[0]?.count ?? -1),
    inboxStateHash: inbox.rows[0]?.hash ?? '',
    nullCompanyOutbox: Number(outbox.rows[0]?.nulls ?? -1),
  };
}

export async function readCapacityBaselineHash(
  client: CapacitySqlClient,
  companyId: string,
  marker: string,
): Promise<string> {
  return fingerprintHash(await readCapacityEstateFingerprint(client, companyId, marker));
}

/** Any real eligible row makes a production-shaped capacity claim unsafe. */
export async function assertZeroEligibleNonFixture(
  client: CapacitySqlClient,
  companyId: string,
  marker: string,
): Promise<void> {
  const result = await client.query<{ count: number }>(`
    SELECT count(*)::int AS count
    FROM "OutboxEvent"
    WHERE status IN ('PENDING','FAILED') AND "availableAt" <= now()
      AND ("companyId" IS DISTINCT FROM $1 OR "aggregateType" <> $2 OR "eventKey" NOT LIKE $3)
  `, [companyId, CAPACITY_AGGREGATE_TYPE, fixtureEventPattern(marker)]);
  if (Number(result.rows[0]?.count ?? -1) !== 0) throw new Error('capacity_eligible_non_fixture_present');
}

/**
 * Candidate selection is byte-for-byte the production predicate/order. The marker is an outer
 * atomic guard only: a real row may be locked briefly as a top candidate, but can never be updated.
 */
export async function claimProductionShape(
  client: CapacitySqlClient,
  input: { companyId: string; marker: string; batchSize: number; claimer: string },
): Promise<CapacityClaimRow[]> {
  const result = await client.query<CapacityClaimRow>(`
    UPDATE "OutboxEvent" o
    SET status='PROCESSING', "lockedAt"=now(), "lockedBy"=$4,
        "claimToken"=gen_random_uuid()::text, "updatedAt"=now()
    WHERE o.id IN (
      SELECT id FROM "OutboxEvent"
      WHERE status IN ('PENDING','FAILED') AND "availableAt" <= now()
      ORDER BY "availableAt" ASC
      LIMIT $3 FOR UPDATE SKIP LOCKED
    )
      AND o."companyId"=$1 AND o."aggregateType"=$5 AND o."eventKey" LIKE $2
    RETURNING o.id, o."companyId", o."aggregateType", o."eventKey", o."eventType",
              o."aggregateId", o."payloadJson", o."claimToken", o."createdAt"
  `, [input.companyId, fixtureEventPattern(input.marker), input.batchSize, input.claimer, CAPACITY_AGGREGATE_TYPE]);
  return result.rows;
}

export function assertClaimCardinality(actual: number, expected: number): void {
  if (actual !== expected) throw new Error('capacity_claim_cardinality_mismatch');
}

export type CapacityRelationScan = {
  inspectedRelations: number;
  fixtureOutboxRows: number;
  fixtureInboxRows: number;
};

/** Fail before delete if the synthetic company acquired any relation the harness does not own. */
export async function scanCapacityCompanyRelations(
  client: CapacitySqlClient,
  companyId: string,
  marker: string,
): Promise<CapacityRelationScan> {
  const relations = await client.query<{ tableName: string }>(`
    SELECT table_name AS "tableName"
    FROM information_schema.columns
    WHERE table_schema=current_schema() AND column_name='companyId'
    ORDER BY table_name
  `);
  let fixtureOutboxRows = 0;
  let fixtureInboxRows = 0;
  for (const { tableName } of relations.rows) {
    const table = quotedIdentifier(tableName);
    if (tableName === 'OutboxEvent') {
      const result = await client.query<{ total: number; owned: number }>(`
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE "aggregateType"=$2 AND "eventKey" LIKE $3)::int AS owned
        FROM ${table} WHERE "companyId"=$1
      `, [companyId, CAPACITY_AGGREGATE_TYPE, fixtureEventPattern(marker)]);
      const total = Number(result.rows[0]?.total ?? -1);
      fixtureOutboxRows = Number(result.rows[0]?.owned ?? -1);
      if (total !== fixtureOutboxRows) throw new Error('capacity_unexpected_company_relation');
      continue;
    }
    if (tableName === 'WorkflowEventInbox') {
      const result = await client.query<{ total: number; owned: number }>(`
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE "sourceType"=$2 AND "dedupKey" LIKE $3)::int AS owned
        FROM ${table} WHERE "companyId"=$1
      `, [companyId, CAPACITY_INBOX_SOURCE_TYPE, fixtureEventPattern(marker)]);
      const total = Number(result.rows[0]?.total ?? -1);
      fixtureInboxRows = Number(result.rows[0]?.owned ?? -1);
      if (total !== fixtureInboxRows) throw new Error('capacity_unexpected_company_relation');
      continue;
    }
    const result = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table} WHERE "companyId"=$1`, [companyId]);
    if (Number(result.rows[0]?.count ?? -1) !== 0) throw new Error('capacity_unexpected_company_relation');
  }
  return { inspectedRelations: relations.rowCount ?? relations.rows.length, fixtureOutboxRows, fixtureInboxRows };
}

export type CapacityCleanupResult = CapacityRelationScan & {
  inboxRows: number;
  outboxRows: number;
  companies: number;
  residue: number;
  afterBaselineHash: string;
  cleanupVerified: boolean;
};

export async function cleanupCapacityFixture(
  client: CapacitySqlClient,
  input: { companyId: string; marker: string; fixtureName: string; expectedBaselineHash: string },
): Promise<CapacityCleanupResult> {
  await client.query('BEGIN');
  try {
    const company = await client.query<{ id: string; name: string; status: string }>(`
      SELECT id,name,status::text AS status FROM "Company" WHERE id=$1 FOR UPDATE
    `, [input.companyId]);
    const companyRow = company.rows[0];
    if (companyRow && (companyRow.name !== input.fixtureName || companyRow.status !== 'SUSPENDED')) {
      throw new Error('capacity_fixture_company_identity_mismatch');
    }
    const relationScan = await scanCapacityCompanyRelations(client, input.companyId, input.marker);
    const inbox = await client.query(`
      DELETE FROM "WorkflowEventInbox"
      WHERE "companyId"=$1 AND "sourceType"=$2 AND "dedupKey" LIKE $3
    `, [input.companyId, CAPACITY_INBOX_SOURCE_TYPE, fixtureEventPattern(input.marker)]);
    const outbox = await client.query(`
      DELETE FROM "OutboxEvent"
      WHERE "companyId"=$1 AND "aggregateType"=$2 AND "eventKey" LIKE $3
    `, [input.companyId, CAPACITY_AGGREGATE_TYPE, fixtureEventPattern(input.marker)]);
    let deletedCompanies = 0;
    if (company.rowCount === 1) {
      const deleted = await client.query(`DELETE FROM "Company" WHERE id=$1 AND name=$2 AND status='SUSPENDED'`, [input.companyId, input.fixtureName]);
      deletedCompanies = deleted.rowCount ?? 0;
    }
    await client.query('COMMIT');

    const residueResult = await client.query<{ count: number }>(`
      SELECT
        (SELECT count(*) FROM "WorkflowEventInbox" WHERE "companyId"=$1)
        + (SELECT count(*) FROM "OutboxEvent" WHERE "companyId"=$1)
        + (SELECT count(*) FROM "Company" WHERE id=$1)::bigint AS count
    `, [input.companyId]);
    const residue = Number(residueResult.rows[0]?.count ?? -1);
    const afterBaselineHash = await readCapacityBaselineHash(client, input.companyId, input.marker);
    return {
      ...relationScan,
      inboxRows: inbox.rowCount ?? 0,
      outboxRows: outbox.rowCount ?? 0,
      companies: deletedCompanies,
      residue,
      afterBaselineHash,
      cleanupVerified: residue === 0 && afterBaselineHash === input.expectedBaselineHash,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
