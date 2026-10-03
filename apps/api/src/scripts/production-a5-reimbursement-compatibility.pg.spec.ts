/** Real-PostgreSQL reimbursement migration proof; every change rolls back. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { PRODUCTION_A5_REVIEWED_QUERY_CATALOG } from '../../prisma/production-a5/reviewed-manifest';

const migrationName = '20260804150000_reimbursement_line_compatibility';
const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
const gateRequired = process.env.REIMBURSEMENT_PG_GATE_REQUIRED === 'true';
const marker = `u5a5_reimbursement_${process.pid}_${Date.now()}`;

describe('production A5 reimbursement dual-build compatibility (real PostgreSQL)', {
  skip: databaseUrl === '' && !gateRequired,
}, () => {
  let client: Client;
  let companyId: string;
  let migrationSql: string;
  let invariantSql: string;

  before(async () => {
    if (databaseUrl === '') throw new Error('reimbursement_pg_gate_database_url_required');
    client = new Client({ connectionString: databaseUrl, application_name: 'production-a5-reimbursement-spec' });
    await client.connect();
    const version = Number((await client.query(`SELECT current_setting('server_version_num')::int AS version`)).rows[0]?.version);
    // Local developer Postgres is 16; the production clone controller separately
    // proves its required 18.x engine before invoking this same SQL gate.
    if (version < 160000) throw new Error('production_a5_reimbursement_test_requires_postgresql_16');
    await client.query('BEGIN');
    companyId = String((await client.query(`SELECT id FROM "Company" ORDER BY id LIMIT 1`)).rows[0]?.id ?? '');
    if (companyId === '') {
      companyId = `${marker}_company`;
      await client.query(`
        INSERT INTO "Company" (id,name,status,"createdAt","updatedAt")
        VALUES ($1,'Reimbursement compatibility fixture','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `, [companyId]);
    }
    migrationSql = readFileSync(join(
      __dirname, '..', '..', 'prisma', 'migrations', migrationName, 'migration.sql',
    ), 'utf8');
    invariantSql = PRODUCTION_A5_REVIEWED_QUERY_CATALOG.find((row) => (
      row.migrationName === migrationName && row.phase === 'POST_DATA'
    ))?.sql ?? '';
    if (invariantSql === '') throw new Error('production_a5_reimbursement_invariant_missing');
  });

  after(async () => {
    if (!client) return;
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
  });

  async function invariant(): Promise<string> {
    return String((await client.query(invariantSql)).rows[0]?.result);
  }

  async function bytesFor(table: 'ReimbursementRequest' | 'ReimbursementLine', requestIds: string[]): Promise<string> {
    const relation = table === 'ReimbursementRequest' ? '"ReimbursementRequest"' : '"ReimbursementLine"';
    const predicate = table === 'ReimbursementRequest' ? 'id = ANY($1::text[])' : '"reimbursementRequestId" = ANY($1::text[])';
    const order = table === 'ReimbursementRequest' ? 'id' : '"reimbursementRequestId", "lineNo"';
    return String((await client.query(
      `SELECT COALESCE(jsonb_agg(to_jsonb(row_value) ORDER BY ${order})::text, '[]') AS bytes
       FROM (SELECT * FROM ${relation} WHERE ${predicate} ORDER BY ${order}) row_value`,
      [requestIds],
    )).rows[0]?.bytes);
  }

  it('backfills zero-line only, preserves one/many-line aggregates byte-for-byte and is idempotent', async () => {
    // A clone is already fully migrated. Recreate the reviewed pre-migration state
    // inside this rollback-only transaction before seeding the three shapes.
    await client.query(`DROP TRIGGER IF EXISTS "ReimbursementRequest_fallback_line" ON "ReimbursementRequest"`);
    await client.query(`DROP FUNCTION IF EXISTS public."ensure_reimbursement_request_fallback_line"()`);

    const ids = [`${marker}_zero`, `${marker}_one`, `${marker}_many`];
    await client.query(`
      INSERT INTO "ReimbursementRequest" (
        id, "companyId", "requesterUserId", "requesterDisplayNameSnapshot", title, reason,
        "categoryKey", "categoryLabelSnapshot", amount, currency, "incurredDate", "outstandingAmount",
        "createdByUserId", "createdAt", "updatedAt"
      ) VALUES
        ($1,$4,'legacy-user','Legacy User','Zero title','zero reason','travel','Travel',125.5000,'THB',
          TIMESTAMP '2026-08-01 00:00:00',125.5000,'legacy-user',TIMESTAMP '2026-08-01 01:00:00',TIMESTAMP '2026-08-01 02:00:00'),
        ($2,$4,'legacy-user','Legacy User','One title','one reason','travel','Travel',50.0000,'THB',
          TIMESTAMP '2026-08-02 00:00:00',50.0000,'legacy-user',TIMESTAMP '2026-08-02 01:00:00',TIMESTAMP '2026-08-02 02:00:00'),
        ($3,$4,'legacy-user','Legacy User','Many title','many reason','travel','หลายหมวด (2 รายการ)',30.0000,'THB',
          TIMESTAMP '2026-08-03 00:00:00',30.0000,'legacy-user',TIMESTAMP '2026-08-03 01:00:00',TIMESTAMP '2026-08-03 02:00:00')
    `, [...ids, companyId]);
    await client.query(`
      INSERT INTO "ReimbursementLine" (
        id,"companyId","reimbursementRequestId","lineNo","incurredDate",description,purpose,
        "categoryKey","categoryLabelSnapshot",amount,"attachmentId","linkedExpenseId","createdAt","updatedAt"
      ) VALUES
        ($1,$5,$2,1,TIMESTAMP '2026-08-02 00:00:00','one exact','purpose','travel','Travel',50.0000,
          'att-one',NULL,TIMESTAMP '2026-08-02 01:00:00',TIMESTAMP '2026-08-02 02:00:00'),
        ($3,$5,$4,1,TIMESTAMP '2026-08-03 00:00:00','many one',NULL,'travel','Travel',10.0000,
          NULL,'expense-one',TIMESTAMP '2026-08-03 01:00:00',TIMESTAMP '2026-08-03 02:00:00'),
        ($6,$5,$4,2,TIMESTAMP '2026-08-04 00:00:00','many two','second','meal','Meal',20.0000,
          'att-two',NULL,TIMESTAMP '2026-08-04 01:00:00',TIMESTAMP '2026-08-04 02:00:00')
    `, [`${marker}_line_one`, ids[1], `${marker}_line_many_1`, ids[2], companyId, `${marker}_line_many_2`]);

    const headersBefore = await bytesFor('ReimbursementRequest', ids);
    const existingLinesBefore = await bytesFor('ReimbursementLine', [ids[1]!, ids[2]!]);
    await client.query(migrationSql);
    await client.query(migrationSql);

    assert.equal(await bytesFor('ReimbursementRequest', ids), headersBefore);
    assert.equal(await bytesFor('ReimbursementLine', [ids[1]!, ids[2]!]), existingLinesBefore);
    const counts = await client.query(`
      SELECT request.id, count(line.id)::int AS count
      FROM "ReimbursementRequest" request
      LEFT JOIN "ReimbursementLine" line ON line."reimbursementRequestId"=request.id
      WHERE request.id = ANY($1::text[])
      GROUP BY request.id ORDER BY request.id
    `, [ids]);
    assert.deepEqual(counts.rows.map((row) => [row.id, row.count]), [
      [ids[2], 2], [ids[1], 1], [ids[0], 1],
    ].sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
    const fallback = (await client.query(`
      SELECT line.id,line."companyId",line."reimbursementRequestId",line."lineNo",
        line."incurredDate"=request."incurredDate" AS "incurredDateMatches",
        line.description,line.purpose,line."categoryKey",line."categoryLabelSnapshot",line.amount,
        line."attachmentId",line."linkedExpenseId",
        line."createdAt"=request."createdAt" AS "createdAtMatches",
        line."updatedAt"=request."updatedAt" AS "updatedAtMatches"
      FROM "ReimbursementLine" line
      JOIN "ReimbursementRequest" request ON request.id=line."reimbursementRequestId"
      WHERE line."reimbursementRequestId"=$1
    `, [ids[0]])).rows[0];
    assert.deepEqual({
      id: fallback.id,
      companyId: fallback.companyId,
      requestId: fallback.reimbursementRequestId,
      lineNo: fallback.lineNo,
      incurredDateMatches: fallback.incurredDateMatches,
      description: fallback.description,
      purpose: fallback.purpose,
      categoryKey: fallback.categoryKey,
      categoryLabelSnapshot: fallback.categoryLabelSnapshot,
      amount: String(fallback.amount),
      attachmentId: fallback.attachmentId,
      linkedExpenseId: fallback.linkedExpenseId,
      createdAtMatches: fallback.createdAtMatches,
      updatedAtMatches: fallback.updatedAtMatches,
    }, {
      id: `rbl_${ids[0]}`,
      companyId,
      requestId: ids[0],
      lineNo: 1,
      incurredDateMatches: true,
      description: 'Zero title',
      purpose: null,
      categoryKey: 'travel',
      categoryLabelSnapshot: 'Travel',
      amount: '125.5000',
      attachmentId: null,
      linkedExpenseId: null,
      createdAtMatches: true,
      updatedAtMatches: true,
    });
    assert.equal(await invariant(), 'PASS');
  });

  it('bridges a legacy insert and lets the current writer replace the fallback atomically', async () => {
    const legacyId = `${marker}_legacy_insert`;
    await client.query(`
      INSERT INTO "ReimbursementRequest" (
        id,"companyId","requesterUserId","requesterDisplayNameSnapshot",reason,"categoryKey",amount,
        currency,"incurredDate","outstandingAmount","createdByUserId","createdAt","updatedAt"
      ) VALUES ($1,$2,'legacy-user','Legacy User','legacy request','travel',125.5000,'THB',
        TIMESTAMP '2026-08-03 00:00:00',125.5000,'legacy-user',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `, [legacyId, companyId]);
    assert.deepEqual((await client.query(`
      SELECT "lineNo",description,amount FROM "ReimbursementLine" WHERE "reimbursementRequestId"=$1
    `, [legacyId])).rows.map((row) => [row.lineNo, row.description, String(row.amount)]), [[1, 'legacy request', '125.5000']]);

    const currentId = `${marker}_current_writer`;
    await client.query('SAVEPOINT current_writer');
    await client.query(`
      INSERT INTO "ReimbursementRequest" (
        id,"companyId","requesterUserId","requesterDisplayNameSnapshot",reason,"categoryKey",amount,
        currency,"incurredDate","outstandingAmount","createdByUserId","createdAt","updatedAt"
      ) VALUES ($1,$2,'current-user','Current User','current request','travel',30.0000,'THB',
        CURRENT_TIMESTAMP,30.0000,'current-user',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `, [currentId, companyId]);
    await client.query(`DELETE FROM "ReimbursementLine" WHERE id=$1`, [`rbl_${currentId}`]);
    await client.query(`DELETE FROM "ReimbursementLine"
      WHERE "reimbursementRequestId"=$1 AND "lineNo" NOT IN (1,2)`, [currentId]);
    for (const [lineNo, description, amount] of [[1, 'current one', '10.0000'], [2, 'current two', '20.0000']] as const) {
      await client.query(`
        INSERT INTO "ReimbursementLine" (
          id,"companyId","reimbursementRequestId","lineNo","incurredDate",description,"categoryKey",amount,"createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP,$5,'travel',$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT ("reimbursementRequestId","lineNo") DO UPDATE SET
          description=EXCLUDED.description, amount=EXCLUDED.amount, "updatedAt"=EXCLUDED."updatedAt"
      `, [`${marker}_current_${lineNo}`, companyId, currentId, lineNo, description, amount]);
    }
    assert.deepEqual((await client.query(`
      SELECT "lineNo",description,amount FROM "ReimbursementLine"
      WHERE "reimbursementRequestId"=$1 ORDER BY "lineNo"
    `, [currentId])).rows.map((row) => [row.lineNo, row.description, String(row.amount)]), [
      [1, 'current one', '10.0000'], [2, 'current two', '20.0000'],
    ]);
    assert.equal(await invariant(), 'PASS');
    await client.query('RELEASE SAVEPOINT current_writer');
  });

  it('rolls trigger work back and detects line-less, amount, tenant and derived-header corruption', async () => {
    await client.query('SAVEPOINT rollback_probe');
    const rollbackId = `${marker}_rollback`;
    await client.query(`
      INSERT INTO "ReimbursementRequest" (
        id,"companyId","requesterUserId","requesterDisplayNameSnapshot",reason,"categoryKey",amount,
        currency,"incurredDate","outstandingAmount","createdByUserId","createdAt","updatedAt"
      ) VALUES ($1,$2,'legacy-user','Legacy User','rollback','travel',1,'THB',CURRENT_TIMESTAMP,1,
        'legacy-user',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `, [rollbackId, companyId]);
    await client.query('ROLLBACK TO SAVEPOINT rollback_probe');
    assert.equal(Number((await client.query(`
      SELECT (SELECT count(*) FROM "ReimbursementRequest" WHERE id=$1)
           + (SELECT count(*) FROM "ReimbursementLine" WHERE "reimbursementRequestId"=$1) AS count
    `, [rollbackId])).rows[0]?.count), 0);

    await client.query('SAVEPOINT line_less_corruption');
    await client.query(`ALTER TABLE "ReimbursementRequest" DISABLE TRIGGER "ReimbursementRequest_fallback_line"`);
    await client.query(`
      INSERT INTO "ReimbursementRequest" (
        id,"companyId","requesterUserId","requesterDisplayNameSnapshot",reason,"categoryKey",amount,
        currency,"incurredDate","outstandingAmount","createdByUserId","createdAt","updatedAt"
      ) VALUES ($1,$2,'legacy-user','Legacy User','line-less','travel',1,'THB',CURRENT_TIMESTAMP,1,
        'legacy-user',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `, [`${marker}_line_less`, companyId]);
    assert.equal(await invariant(), 'FAIL');
    await client.query('ROLLBACK TO SAVEPOINT line_less_corruption');

    await client.query('SAVEPOINT amount_corruption');
    await client.query(`UPDATE "ReimbursementRequest" SET amount=999 WHERE id=$1`, [`${marker}_legacy_insert`]);
    assert.equal(await invariant(), 'FAIL');
    await client.query('ROLLBACK TO SAVEPOINT amount_corruption');

    await client.query('SAVEPOINT tenant_corruption');
    const otherCompanyId = `${marker}_other_company`;
    await client.query(`
      INSERT INTO "Company" (id,name,status,"createdAt","updatedAt")
      VALUES ($1,'Other fixture','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `, [otherCompanyId]);
    await assert.rejects(
      client.query(`UPDATE "ReimbursementLine" SET "companyId"=$1 WHERE "reimbursementRequestId"=$2`, [
        otherCompanyId, `${marker}_legacy_insert`,
      ]),
      (error: unknown) => {
        const postgres = error as { code?: string; constraint?: string };
        return postgres.code === '23503'
          && postgres.constraint === 'ReimbursementLine_companyId_reimbursementRequestId_fkey';
      },
    );
    await client.query('ROLLBACK TO SAVEPOINT tenant_corruption');

    await client.query('SAVEPOINT date_corruption');
    await client.query(`UPDATE "ReimbursementRequest" SET "incurredDate"="incurredDate"+INTERVAL '1 day'
      WHERE id=$1`, [`${marker}_current_writer`]);
    assert.equal(await invariant(), 'FAIL');
    await client.query('ROLLBACK TO SAVEPOINT date_corruption');

    await client.query('SAVEPOINT category_corruption');
    await client.query(`UPDATE "ReimbursementRequest" SET "categoryKey"='meal' WHERE id=$1`, [
      `${marker}_current_writer`,
    ]);
    assert.equal(await invariant(), 'FAIL');
    await client.query('ROLLBACK TO SAVEPOINT category_corruption');

    await client.query('SAVEPOINT label_corruption');
    await client.query(`UPDATE "ReimbursementRequest" SET "categoryLabelSnapshot"='Wrong' WHERE id=$1`, [
      `${marker}_many`,
    ]);
    assert.equal(await invariant(), 'FAIL');
    await client.query('ROLLBACK TO SAVEPOINT label_corruption');

    await client.query('SAVEPOINT fallback_corruption');
    await client.query(`UPDATE "ReimbursementLine" SET description='changed fallback' WHERE id=$1`, [
      `rbl_${marker}_legacy_insert`,
    ]);
    assert.equal(await invariant(), 'FAIL');
    await client.query('ROLLBACK TO SAVEPOINT fallback_corruption');

    await client.query('SAVEPOINT dense_line_corruption');
    await client.query(`UPDATE "ReimbursementLine" SET "lineNo"=3
      WHERE "reimbursementRequestId"=$1 AND "lineNo"=2`, [`${marker}_current_writer`]);
    assert.equal(await invariant(), 'FAIL');
    await client.query('ROLLBACK TO SAVEPOINT dense_line_corruption');
    assert.equal(await invariant(), 'PASS');
  });
});

// Fifth round: exercise the actual transaction/notification writers. No server or egress is involved.
describe('claim payout notice gaps (real PostgreSQL)', { skip: databaseUrl === '' && !gateRequired }, () => {
  let db: import('../generated/prisma/client').PrismaClient;
  let repo: import('../modules/reimbursements/infrastructure/prisma-reimbursement.repository').PrismaReimbursementRepository;
  let payouts: import('../modules/reimbursements/application/use-cases/reimbursement-payout.use-case').MemberPayoutAccountUseCase;
  let writer: import('../modules/dashboard-notifications/application/use-cases/notification.use-cases').CreateOrUpdateNotificationEventUseCase;
  let companyId: string;
  let branchId: string;
  const requester = `${marker}_notice_requester`;
  const preparer = `${marker}_notice_preparer`;
  const account = { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'สมชาย', accountNumber: '0123456789' } as const;
  const ctx = (userId = preparer) => ({ companyId, userId, requestId: marker, authSubject: userId, membershipId: marker, authProvider: 'dev' as const, roles: [], permissions: ['reimbursement.create', 'access.employee.update', 'reimbursement.finance_review'], scopes: {} });

  before(async () => {
    if (!databaseUrl) throw new Error('reimbursement_pg_gate_database_url_required');
    const { PrismaClient } = await import('../generated/prisma/client');
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const { PrismaReimbursementRepository } = await import('../modules/reimbursements/infrastructure/prisma-reimbursement.repository');
    const { MemberPayoutAccountUseCase } = await import('../modules/reimbursements/application/use-cases/reimbursement-payout.use-case');
    const { CreateOrUpdateNotificationEventUseCase } = await import('../modules/dashboard-notifications/application/use-cases/notification.use-cases');
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    await db.user.createMany({ data: [{ id: requester, displayName: 'สมชาย' }, { id: preparer, displayName: 'อรทัย' }] });
    companyId = (await db.company.create({ data: { name: marker, status: 'ACTIVE' } })).id;
    await db.companyMembership.createMany({ data: [requester, preparer].map(userId => ({ companyId, userId, status: 'ACTIVE' as const, branchScopeMode: 'ALL_BRANCHES' as const })) });
    branchId = (await db.branch.create({ data: { companyId, code: 'NOTICE', name: 'สาขาทดสอบ' } })).id;
    const membership = await db.companyMembership.findUniqueOrThrow({ where: { companyId_userId: { companyId, userId: requester } } });
    await db.employeeAccessProfile.create({ data: {
      companyId, userId: requester, membershipId: membership.id, displayName: 'สมชาย', identityType: 'THAI_NATIONAL_ID',
      identityLast4: '0002', identityHash: `${marker}_identity`, identityEncryptedRef: 'sealed', phoneNumber: `${marker}_phone`, status: 'ACTIVE', createdByUserId: preparer,
    } });
    repo = new PrismaReimbursementRepository({ client: db } as never, {} as never);
    writer = new CreateOrUpdateNotificationEventUseCase(null as never, null as never, null as never, null as never, null as never, { client: db } as never);
    payouts = new MemberPayoutAccountUseCase(repo, { log: async () => undefined } as never, { credentialEncryptionKey: Buffer.alloc(32, 7) } as never, writer);
  });
  after(async () => {
    if (!db) return;
    try {
      if (companyId) await db.company.delete({ where: { id: companyId } });
      await db.user.deleteMany({ where: { id: { in: [requester, preparer] } } });
    } finally { await db.$disconnect(); }
  });
  const notices = (sourceId: string) => db.notificationRecipient.findMany({ where: { companyId, event: { sourceId } }, include: { event: true, deliveries: true } });
  const draft = (payout?: Parameters<typeof repo.createRequest>[1]) => repo.createRequest({
    companyId, branchId, requesterUserId: requester, requesterDisplayNameSnapshot: 'สมชาย', createdByUserId: preparer,
    reason: 'ค่าเดินทาง', categoryKey: 'travel', amount: '10.0000', currency: 'THB', incurredDate: new Date('2026-10-02'), receiptRequirementStatus: 'WAIVED_BY_POLICY',
    lines: [{ lineNo: 1, description: 'ค่าเดินทาง', categoryKey: 'travel', amount: '10.0000', incurredDate: new Date('2026-10-02') }],
  }, payout);

  it('commits each changed draft choice with one claim notice and rolls back the combined default save if its notice fails', async () => {
    await payouts.setOwn(ctx(requester), account);
    const automatic = await draft();
    assert.equal((await notices(automatic.id)).length, 0);
    for (const mode of ['CASH', 'DEFAULT'] as const) {
      const claim = await draft(await payouts.draftPayoutChange(ctx(), requester, { mode }));
      const sent = await notices(claim.id);
      assert.equal(sent.length, 1, mode);
      assert.equal(sent[0]!.userId, requester);
      assert.equal(sent[0]!.deliveries.length, 2);
      await repo.updateDraftRequest(companyId, claim.id, claim.updatedAt, {}, undefined, await payouts.draftPayoutChange(ctx(), requester, { mode }));
      assert.equal((await notices(claim.id)).length, 1, 'same destination stays silent');
    }
    const combined = await draft(await payouts.draftPayoutChange(ctx(), requester, { mode: 'SPECIFIED', ...account, saveAsDefault: true }));
    assert.equal((await notices(combined.id)).length, 1);
    assert.match((await notices(combined.id))[0]!.event.body!, /บัญชีรับเงินคืนประจำ/);
    assert.equal((await notices(requester)).length, 0, 'no standalone default notice for a claim act');
    const before = await repo.findMemberPayoutAccount(companyId, requester);
    const claimBefore = await repo.findRequestById(companyId, combined.id);
    const countBefore = await db.notificationEvent.count({ where: { companyId } });
    const { MemberPayoutAccountUseCase } = await import('../modules/reimbursements/application/use-cases/reimbursement-payout.use-case');
    const fails = new MemberPayoutAccountUseCase(repo, { log: async () => undefined } as never, { credentialEncryptionKey: Buffer.alloc(32, 7) } as never, {
      executeInTransaction: async (input: any, tx: any) => { await writer.executeInTransaction(input, tx); throw new Error('notice failed'); },
    } as never);
    await assert.rejects(repo.updateDraftRequest(companyId, combined.id, combined.updatedAt, {}, undefined,
      await fails.draftPayoutChange(ctx(), requester, { mode: 'SPECIFIED', ...account, accountNumber: '9999956789', saveAsDefault: true })), /notice failed/);
    assert.deepEqual(await repo.findMemberPayoutAccount(companyId, requester), before);
    assert.deepEqual(await repo.findRequestById(companyId, combined.id), claimBefore);
    assert.equal(await db.notificationEvent.count({ where: { companyId } }), countBefore);
    const own = await repo.updateDraftRequest(companyId, combined.id, combined.updatedAt, {}, undefined, await payouts.draftPayoutChange(ctx(requester), requester, { mode: 'CASH' }));
    assert.equal((await notices(combined.id)).length, 1);
    await db.companyMembership.update({ where: { companyId_userId: { companyId, userId: requester } }, data: { status: 'SUSPENDED' } });
    try {
      const changed = await repo.updateDraftRequest(companyId, combined.id, own.updatedAt, {}, undefined, await payouts.draftPayoutChange(ctx(), requester, { mode: 'DEFAULT' }));
      assert.equal(changed.payoutMethod, undefined);
      assert.equal((await notices(combined.id)).length, 1);
    } finally {
      await db.companyMembership.update({ where: { companyId_userId: { companyId, userId: requester } }, data: { status: 'ACTIVE' } });
    }
    assert.doesNotMatch(JSON.stringify(await db.notificationEvent.findMany({ where: { companyId } })), /0123456789|9999956789/);
  });

  it('delivers the finance-block notice once per act, never to its actor or an inactive requester', async () => {
    const { WORKFLOW_TEMPLATE_CATALOG } = await import('../modules/workflow/domain/workflow-template-catalog');
    const { ExecuteWorkflowActionUseCase } = await import('../modules/workflow/application/use-cases/workflow-action-runner.use-case');
    const template = WORKFLOW_TEMPLATE_CATALOG.find(t => t.key === 'reimbursement_finance_blocked_requester')!;
    assert.ok(template);
    const action = template.defaultActionJson[0]!;
    const claim = await draft();
    const runner = new ExecuteWorkflowActionUseCase({
      findUserIdsByRoles: async () => [], findUserIdsByPermissions: async () => [], updateActionRun: async (_id: string, update: any) => { assert.notEqual(update.status, 'FAILED_FINAL'); assert.notEqual(update.status, 'FAILED_RETRYABLE'); },
    } as never, {} as never, {} as never, {
      execute: (input: any) => db.$transaction(tx => writer.executeInTransaction(input, tx)),
    } as never, {} as never, {} as never, {} as never);
    const send = (runId: string, actorUserId = preparer) => runner.execute({ id: runId, companyId, workflowRunId: runId, actionType: 'SEND_NOTIFICATION', actionKey: action.actionKey, actionConfigSnapshotJson: action.configJson, status: 'QUEUED', idempotencyKey: runId, attemptCount: 0, createdAt: new Date(), updatedAt: new Date() }, {
      companyId, ruleName: template.name, triggerType: 'EVENT', sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: claim.id,
      payload: { requestId: claim.id, requesterUserId: requester, actorUserId, decision: 'BLOCKED', note: 'ห้ามคัดลอก 0123456789' }, siblingActions: [],
    });
    await send('block-1');
    await send('block-1');
    assert.equal((await notices(claim.id)).length, 1);
    assert.equal((await notices(claim.id))[0]!.deliveries.length, 2);
    await send('block-own', requester);
    assert.equal((await notices(claim.id)).length, 1);
    await db.companyMembership.update({ where: { companyId_userId: { companyId, userId: requester } }, data: { status: 'SUSPENDED' } });
    try {
      await send('block-inactive');
      assert.equal((await notices(claim.id)).length, 1);
    } finally {
      await db.companyMembership.update({ where: { companyId_userId: { companyId, userId: requester } }, data: { status: 'ACTIVE' } });
    }
    await send('block-2');
    const sent = await notices(claim.id);
    assert.equal(sent.length, 2);
    assert.ok(sent.every(n => n.userId === requester && !/0123456789|ห้ามคัดลอก/.test(n.event.body!)));
  });
});
