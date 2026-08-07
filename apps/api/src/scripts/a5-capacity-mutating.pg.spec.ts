/** Real-PostgreSQL safety proof; creates and drops only an isolated temporary schema. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import {
  assertZeroEligibleNonFixture,
  claimProductionShape,
  cleanupCapacityFixture,
  readCapacityBaselineHash,
} from './a5-capacity-mutating.pg';

const marker = 'U5C-0123456789AB';
const companyId = 'u5c-test-company';
const fixtureName = `U5 Capacity Fixture ${marker}`;
const schema = `u5c_capacity_${process.pid}_${Date.now()}`;

function rootDatabaseUrl(): string | null {
  return process.env.U5_CAPACITY_TEST_DATABASE_URL?.trim() || null;
}

describe('A5 capacity SQL guards (real PostgreSQL, isolated schema)', () => {
  let client: Client | null = null;
  let reachable = false;
  let schemaCreated = false;

  before(async () => {
    const url = rootDatabaseUrl();
    if (!url) return;
    client = new Client({ connectionString: url, application_name: 'u5-capacity-real-pg-spec' });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await client.query(`SET search_path TO "${schema}",public`);
    await client.query(`
        CREATE TABLE "Company" (
          id text PRIMARY KEY, name text NOT NULL, status text NOT NULL
        );
        CREATE TABLE "OutboxEvent" (
          id text PRIMARY KEY, "companyId" text, "eventType" text NOT NULL,
          "aggregateType" text NOT NULL, "aggregateId" text NOT NULL, "eventKey" text UNIQUE NOT NULL,
          "payloadJson" jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'PENDING',
          attempts int NOT NULL DEFAULT 0, "availableAt" timestamptz NOT NULL DEFAULT now(),
          "lockedAt" timestamptz, "lockedBy" text, "claimToken" text, "publishedAt" timestamptz,
          "lastError" text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE "WorkflowEventInbox" (
          id text PRIMARY KEY, "companyId" text NOT NULL, "sourceType" text NOT NULL,
          "dedupKey" text NOT NULL, status text NOT NULL DEFAULT 'RECEIVED', "processedAt" timestamptz,
          "errorCode" text, "errorMessage" text
        );
        CREATE TABLE "UnexpectedRelation" (id text PRIMARY KEY, "companyId" text NOT NULL);
      `);
    reachable = true;
  });

  after(async () => {
    if (!client) return;
    try {
      if (schemaCreated) {
        await client.query('SET search_path TO public');
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    } finally {
      await client.end();
    }
  });

  it('never updates a non-marker top candidate and refuses cleanup before an unexpected relation', async (t) => {
    if (!reachable || !client) return t.skip('set U5_CAPACITY_TEST_DATABASE_URL to an explicitly disposable PostgreSQL database');
    const baselineHash = await readCapacityBaselineHash(client, companyId, marker);
    await client.query(`INSERT INTO "Company" (id,name,status) VALUES ($1,$2,'SUSPENDED')`, [companyId, fixtureName]);
    await client.query(`
      INSERT INTO "OutboxEvent"
        (id,"companyId","eventType","aggregateType","aggregateId","eventKey","availableAt")
      VALUES
        ('real-row','real-company','real.event','Real','real','real:event',now()-interval '2 seconds'),
        ('fixture-1',$1,'capacity.probe','U5CapacityProbe','1',$2,now()-interval '1 second')
    `, [companyId, `${marker}:full:1`]);

    await assert.rejects(assertZeroEligibleNonFixture(client, companyId, marker), /capacity_eligible_non_fixture_present/);
    const blocked = await claimProductionShape(client, { companyId, marker, batchSize: 1, claimer: 'spec' });
    assert.equal(blocked.length, 0, 'outer marker guard must not mutate the real top candidate');
    assert.equal((await client.query(`SELECT status FROM "OutboxEvent" WHERE id='real-row'`)).rows[0]?.status, 'PENDING');

    await client.query(`DELETE FROM "OutboxEvent" WHERE id='real-row'`);
    await assert.doesNotReject(assertZeroEligibleNonFixture(client, companyId, marker));
    await client.query(`
      INSERT INTO "OutboxEvent"
        (id,"companyId","eventType","aggregateType","aggregateId","eventKey","availableAt")
      VALUES ('fixture-2',$1,'capacity.probe','U5CapacityProbe','2',$2,now())
    `, [companyId, `${marker}:full:2`]);
    const claimed = await claimProductionShape(client, { companyId, marker, batchSize: 25, claimer: 'spec' });
    assert.deepEqual(new Set(claimed.map((row) => row.id)), new Set(['fixture-1', 'fixture-2']));

    await client.query(`INSERT INTO "UnexpectedRelation" (id,"companyId") VALUES ('unexpected',$1)`, [companyId]);
    await assert.rejects(cleanupCapacityFixture(client, {
      companyId, marker, fixtureName, expectedBaselineHash: baselineHash,
    }), /capacity_unexpected_company_relation/);
    assert.equal(Number((await client.query(`SELECT count(*) FROM "Company" WHERE id=$1`, [companyId])).rows[0]?.count), 1);
    assert.equal(Number((await client.query(`SELECT count(*) FROM "OutboxEvent" WHERE "companyId"=$1`, [companyId])).rows[0]?.count), 2);

    await client.query(`DELETE FROM "UnexpectedRelation" WHERE "companyId"=$1`, [companyId]);
    const cleanup = await cleanupCapacityFixture(client, {
      companyId, marker, fixtureName, expectedBaselineHash: baselineHash,
    });
    assert.equal(cleanup.inspectedRelations, 3);
    assert.equal(cleanup.outboxRows, 2);
    assert.equal(cleanup.companies, 1);
    assert.equal(cleanup.residue, 0);
    assert.equal(cleanup.afterBaselineHash, baselineHash);
    assert.equal(cleanup.cleanupVerified, true);
  });
});
