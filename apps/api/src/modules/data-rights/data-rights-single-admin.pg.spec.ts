/**
 * Single-admin mode of a data-rights case (P31 §8) against real PostgreSQL.
 *
 * The five same-person rules are enforced twice: by `DataRightsService` and by the triggers of
 * migration 20260809120000, which 20261002120000 replaces. The service spec's in-memory database
 * has no triggers, so a self-step built in the service alone passed there and was refused by the
 * real database. This spec is the proof that needs the real thing:
 *
 * 1. the DATABASE refuses a same-person step without the marker and reason, exactly as before;
 * 2. with ONE active System Admin the service takes each of the five steps as an explicit
 *    single-admin step, and the database accepts the marked row;
 * 3. with a SECOND active System Admin the service refuses the same person even with a reason
 *    (who the active System Admins are is a fact about other tables, so the service decides it);
 * 4. two different people work as before, and a marker on their steps is refused.
 *
 * It builds its own scratch database from the real migration files on the given server and drops
 * it afterwards, because "exactly one System Admin" is a fact about the whole database and the
 * shared test database carries other specs' admins.
 *
 * Run with (any database on a disposable local server; it is only used to create the scratch one):
 *   DATA_RIGHTS_SINGLE_ADMIN_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     npx tsx --test src/modules/data-rights/data-rights-single-admin.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import {
  DATA_RIGHTS_DECISION_CATEGORIES,
  dataRightsAllowedDispositions,
  dataRightsCaseEvidenceRequirements,
  type DataRightsDisposition,
} from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import type { RequestContext } from '../auth/domain/models/request-context.model';
import { DATA_RIGHTS_MANAGE_PERMISSION, DataRightsService } from './data-rights.service';

const databaseUrl = process.env.DATA_RIGHTS_SINGLE_ADMIN_TEST_DATABASE_URL;
const MIGRATIONS = join(__dirname, '..', '..', '..', 'prisma', 'migrations');
const PLATFORM = 'platform-company';
const REASON = 'ระบบมีผู้ดูแลระบบเพียงคนเดียว จึงทำขั้นตอนนี้ด้วยตนเอง';
const SHA = 'a'.repeat(64);

/** The five refusals of migration 20260809120000, word for word. */
const DATABASE_RULE = {
  APPROVAL: 'data-rights case requires an approver independent from its creator',
  EXECUTION: 'data-rights approver cannot execute the case',
  VERIFICATION: 'data-rights execution requires an independent verifier',
  INDEPENDENT_VERIFICATION: 'data-rights executor cannot provide independent verification',
  COMPLETION: 'data-rights executor cannot verify completion',
} as const;

function operator(userId: string): RequestContext {
  return {
    requestId: `req-${randomUUID().slice(0, 8)}`, authSubject: userId, userId, companyId: PLATFORM,
    membershipId: `m-${userId}`, roles: ['SYSTEM_ADMIN'], permissions: [DATA_RIGHTS_MANAGE_PERMISSION],
    scopes: {}, authProvider: 'watchdog',
  };
}

describe('data-rights single-admin mode on real PostgreSQL', { skip: !databaseUrl }, () => {
  let admin: Client;
  let raw: Client;
  let client: PrismaClient;
  let service: DataRightsService;
  let scratch: string;
  const adminA = operator('admin-a');
  const adminB = operator('admin-b');

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test server is allowed');
    // Localhost is not proof of a local server (a production tunnel listens there too), so the
    // database named in the URL has to be a disposable one before anything is created beside it.
    assert.ok(url.pathname === '/watchdog_bms' || url.pathname.endsWith('_ci'),
      `refusing to work next to ${url.pathname}: only a disposable test server is allowed`);
    scratch = `data_rights_single_admin_${randomUUID().slice(0, 8)}_ci`;
    admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${scratch}"`);
    url.pathname = `/${scratch}`;

    // The real migrations, every one, in order — the way `prisma migrate deploy` sends them.
    raw = new Client({ connectionString: url.toString() });
    await raw.connect();
    const names = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    assert.ok(names.includes('20261002120000_data_rights_single_admin_mode'));
    for (const name of names) await raw.query(readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));

    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
    service = new DataRightsService(
      { client } as never,
      { pdpaPseudonymizationKeyRing: { current: Buffer.alloc(32, 0x2a), previous: [] } } as never,
    );

    await client.company.create({ data: { id: PLATFORM, name: 'Platform' } });
    const systemAdmin = await client.role.upsert({
      where: { scopeKey_key: { scopeKey: 'system', key: 'SYSTEM_ADMIN' } }, update: {},
      create: { scopeKey: 'system', key: 'SYSTEM_ADMIN', name: 'System Admin', isSystem: true },
    });
    for (const ctx of [adminA, adminB]) {
      await client.user.create({ data: { id: ctx.userId, displayName: ctx.userId } });
      await client.companyMembership.create({
        data: { id: ctx.membershipId!, companyId: PLATFORM, userId: ctx.userId, roles: { create: { roleId: systemAdmin.id } } },
      });
    }
  });

  after(async () => {
    await client?.$disconnect().catch(() => undefined);
    await raw?.end().catch(() => undefined);
    if (admin) {
      try {
        if (scratch) await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  });

  /** Who holds an ACTIVE platform membership right now; everyone else's is suspended. */
  async function activeAdmins(...ids: string[]) {
    for (const ctx of [adminA, adminB]) {
      await client.companyMembership.update({
        where: { id: ctx.membershipId! }, data: { status: ids.includes(ctx.userId) ? 'ACTIVE' : 'SUSPENDED' },
      });
    }
  }

  /** A company-offboarding case for a fresh shop, taken to the end of its retention review. */
  async function reviewedCase(creator: RequestContext): Promise<string> {
    const tag = randomUUID().slice(0, 8);
    const shop = await client.company.create({ data: { id: `shop-${tag}`, name: `Shop ${tag}` } });
    const created = await service.createCase(creator, {
      commandId: `create-${tag}`, requestKey: `DR-${tag}`, caseType: 'COMPANY_WORKSPACE_OFFBOARDING',
      requestSource: 'EMAIL', companyId: shop.id, dueAt: '2035-01-01T00:00:00.000Z',
    });
    const caseId = created.caseId;
    await service.verifyIdentity(creator, caseId, {
      commandId: `identity-${tag}`, method: 'VERIFIED_EMAIL_CHALLENGE', reference: `evidence://identity/${tag}`,
    });
    await service.verifyAuthority(creator, caseId, {
      commandId: `authority-${tag}`, method: 'COMPANY_AFFIDAVIT_REVIEWED', reference: `approval://authority/${tag}`,
    });
    await service.beginRetentionReview(creator, caseId, `review-${tag}`);
    for (const category of DATA_RIGHTS_DECISION_CATEGORIES) {
      const allowed = dataRightsAllowedDispositions('COMPANY_WORKSPACE_OFFBOARDING', category);
      const disposition: DataRightsDisposition = allowed.includes('DELETE') ? 'DELETE' : allowed[0]!;
      await service.recordDecision(creator, caseId, {
        commandId: `decision-${tag}-${category.toLowerCase()}`, category, disposition,
        legalBasisCode: 'PDPA-33', rationale: `Decision for ${category}.`,
      });
    }
    return caseId;
  }

  async function executionEvidence(ctx: RequestContext, caseId: string) {
    const decisions = await client.dataRightsDecisionRecord.findMany({ where: { caseId } });
    for (const requirement of dataRightsCaseEvidenceRequirements(
      'COMPANY_WORKSPACE_OFFBOARDING', decisions.map(({ category, disposition }) => ({ category, disposition })),
    )) {
      await service.recordEvidence(ctx, caseId, {
        commandId: `evidence-${caseId}-${requirement.evidenceType}-${requirement.category}`.toLowerCase(),
        evidenceType: requirement.evidenceType, category: requirement.category,
        reference: `run://execution/${requirement.evidenceType.toLowerCase()}/${requirement.category.toLowerCase()}`, sha256: SHA,
      });
    }
  }

  const independent = (commandId: string, singleAdminReason?: string) => ({
    commandId, evidenceType: 'INDEPENDENT_VERIFICATION' as const, reference: `evidence://verification/${commandId}`,
    sha256: SHA, ...(singleAdminReason !== undefined && { singleAdminReason }),
  });
  const completion = (commandId: string, singleAdminReason?: string) => ({
    commandId, outcome: 'COMPLETED' as const, outcomeSummary: 'Approved scope recorded; nothing retained.',
    ...(singleAdminReason !== undefined && { singleAdminReason }),
  });

  /** What the DATABASE says to a statement, with nothing kept: the statement is always rolled back. */
  async function database(sql: string, params: unknown[]): Promise<{ code: string; message: string } | 'ACCEPTED'> {
    await raw.query('BEGIN');
    try {
      await raw.query(sql, params);
      return 'ACCEPTED';
    } catch (error) {
      return { code: String((error as { code?: unknown }).code), message: (error as Error).message };
    } finally {
      await raw.query('ROLLBACK');
    }
  }
  /** The statements the service issues for each step, with or without the single-admin marker. */
  const statement = {
    APPROVAL: (caseId: string, by: string, marker?: string | null) => database(
      `UPDATE "DataRightsCase" SET "status"='APPROVED', "approvedAt"=now(), "approvedByUserId"=$2,
         "approvalSingleAdmin"=$3, "approvalSingleAdminReason"=$4 WHERE "id"=$1`,
      [caseId, by, marker !== undefined, marker ?? null]),
    EXECUTION: (caseId: string, by: string, marker?: string | null) => database(
      `UPDATE "DataRightsCase" SET "status"='EXECUTING', "executionStartedAt"=now(), "executionStartedByUserId"=$2,
         "executionSingleAdmin"=$3, "executionSingleAdminReason"=$4 WHERE "id"=$1`,
      [caseId, by, marker !== undefined, marker ?? null]),
    VERIFICATION: (caseId: string, by: string, marker?: string | null) => database(
      `UPDATE "DataRightsCase" SET "status"='VERIFICATION', "verificationStartedAt"=now(), "verificationStartedByUserId"=$2,
         "verificationSingleAdmin"=$3, "verificationSingleAdminReason"=$4 WHERE "id"=$1`,
      [caseId, by, marker !== undefined, marker ?? null]),
    INDEPENDENT_VERIFICATION: (caseId: string, by: string, marker?: string | null) => database(
      `INSERT INTO "DataRightsEvidenceRecord"
         ("id","caseId","evidenceType","reference","sha256","recordedByUserId","singleAdmin","singleAdminReason")
       VALUES ($5,$1,'INDEPENDENT_VERIFICATION','evidence://verification/raw',$6,$2,$3,$4)`,
      [caseId, by, marker !== undefined, marker ?? null, `raw-${randomUUID()}`, SHA]),
    COMPLETION: (caseId: string, by: string, marker?: string | null) => database(
      `UPDATE "DataRightsCase" SET "status"='COMPLETED', "completedAt"=now(), "completedByUserId"=$2, "outcomeSummary"='raw',
         "completionSingleAdmin"=$3, "completionSingleAdminReason"=$4 WHERE "id"=$1`,
      [caseId, by, marker !== undefined, marker ?? null]),
  };
  const refusedAsBefore = (step: keyof typeof DATABASE_RULE) => ({ code: '55000', message: DATABASE_RULE[step] });
  const code = (expected: string) => (error: unknown) => {
    assert.equal(((error as { getResponse?: () => { code?: string } }).getResponse?.())?.code, expected);
    return true;
  };
  const singleAdminAudits = (caseId: string) => client.auditLog.findMany({
    where: { action: 'system.data_rights.single_admin_step', targetId: caseId }, orderBy: { createdAt: 'asc' },
  });

  it('applies the real migrations: both guards replaced in place and still bound, ten columns, three checks', async () => {
    const triggers = (await raw.query(`
      SELECT tg.tgname AS trigger, fn.proname AS function, tg.tgenabled AS enabled
      FROM pg_trigger tg JOIN pg_proc fn ON fn.oid = tg.tgfoid
      WHERE tg.tgname IN ('DataRightsCase_transition_guard', 'DataRightsEvidenceRecord_phase_guard') ORDER BY 1`)).rows;
    assert.deepEqual(triggers, [
      { trigger: 'DataRightsCase_transition_guard', function: 'enforce_data_rights_case_transition', enabled: 'O' },
      { trigger: 'DataRightsEvidenceRecord_phase_guard', function: 'enforce_data_rights_evidence_phase', enabled: 'O' },
    ]);
    const columns = (await raw.query(`
      SELECT table_name || '.' || column_name AS name FROM information_schema.columns
      WHERE column_name ILIKE '%singleadmin%' ORDER BY 1`)).rows.map((row) => row.name);
    assert.equal(columns.length, 10);
    const checks = (await raw.query(`
      SELECT conname FROM pg_constraint WHERE conname LIKE '%single_admin%' AND contype = 'c' ORDER BY 1`)).rows;
    assert.deepEqual(checks.map((row) => row.conname), [
      'DataRightsCase_single_admin_marker_check', 'DataRightsCase_single_admin_reason_check',
      'DataRightsEvidenceRecord_single_admin_reason_check',
    ]);
  });

  it('one System Admin: every step is refused without the marker and accepted as an explicit single-admin step', async () => {
    await activeAdmins('admin-a');
    const caseId = await reviewedCase(adminA);
    const required = code('data_rights_single_admin_reason_required');
    const row = () => client.dataRightsCase.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal((await service.getCase(adminA, caseId)).singleAdminAvailable, true);

    // 1. approval
    assert.deepEqual(await statement.APPROVAL(caseId, 'admin-a'), refusedAsBefore('APPROVAL'));
    // A marker with no reason, or with one too short to be a reason, is not the explicit step either.
    assert.deepEqual(await statement.APPROVAL(caseId, 'admin-a', null), refusedAsBefore('APPROVAL'));
    assert.equal((await statement.APPROVAL(caseId, 'admin-a', 'สั้นไป') as { code: string }).code, '23514');
    assert.equal(await statement.APPROVAL(caseId, 'admin-a', REASON), 'ACCEPTED');
    await assert.rejects(() => service.approve(adminA, caseId, `approve-bare-${caseId}`), required);
    assert.equal((await row()).status, 'RETENTION_REVIEW');
    await service.approve(adminA, caseId, `approve-${caseId}`, REASON);

    // 2. execution
    assert.deepEqual(await statement.EXECUTION(caseId, 'admin-a'), refusedAsBefore('EXECUTION'));
    await assert.rejects(() => service.startExecution(adminA, caseId, `execute-bare-${caseId}`), required);
    await service.startExecution(adminA, caseId, `execute-${caseId}`, REASON);
    await executionEvidence(adminA, caseId);

    // 3. verification
    assert.deepEqual(await statement.VERIFICATION(caseId, 'admin-a'), refusedAsBefore('VERIFICATION'));
    await assert.rejects(() => service.startVerification(adminA, caseId, `verify-bare-${caseId}`), required);
    await service.startVerification(adminA, caseId, `verify-${caseId}`, REASON);

    // 4. independent verification
    assert.deepEqual(await statement.INDEPENDENT_VERIFICATION(caseId, 'admin-a'), refusedAsBefore('INDEPENDENT_VERIFICATION'));
    await assert.rejects(() => service.recordEvidence(adminA, caseId, independent(`independent-bare-${caseId}`)), required);
    await service.recordEvidence(adminA, caseId, independent(`independent-${caseId}`, REASON));

    // 5. completion
    assert.deepEqual(await statement.COMPLETION(caseId, 'admin-a'), refusedAsBefore('COMPLETION'));
    await assert.rejects(() => service.complete(adminA, caseId, completion(`complete-bare-${caseId}`)), required);
    const done = await service.complete(adminA, caseId, completion(`complete-${caseId}`, REASON));

    assert.equal(done.case.status, 'COMPLETED');
    const stored = await row();
    for (const flag of ['approval', 'execution', 'verification', 'completion'] as const) {
      assert.deepEqual([stored[`${flag}SingleAdmin`], stored[`${flag}SingleAdminReason`]], [true, REASON], flag);
    }
    assert.deepEqual(
      (await client.dataRightsEvidenceRecord.findMany({ where: { caseId, singleAdmin: true } }))
        .map((item) => [item.evidenceType, item.recordedByUserId, item.singleAdminReason]),
      [['INDEPENDENT_VERIFICATION', 'admin-a', REASON]],
    );
    // An audit row of its own for each of the five, and the same five labelled in the case history.
    assert.deepEqual(
      (await singleAdminAudits(caseId)).map((item) => [
        (item.metadataJson as { step: string }).step, item.actorUserId, item.companyId, item.riskLevel, item.result, item.targetType,
      ]),
      ['APPROVAL', 'EXECUTION', 'VERIFICATION', 'INDEPENDENT_VERIFICATION', 'COMPLETION']
        .map((step) => [step, 'admin-a', PLATFORM, 'CRITICAL', 'SUCCESS', 'DataRightsCase']),
    );
    assert.deepEqual(
      done.case.actions.filter((action) => (action.metadataJson as { singleAdmin?: boolean }).singleAdmin).map((action) => action.action),
      ['APPROVED', 'EXECUTION_STARTED', 'VERIFICATION_STARTED', 'EVIDENCE_RECORDED', 'CASE_COMPLETED'],
    );
    // The reason is part of the record of the step: it cannot be rewritten afterwards.
    assert.deepEqual(
      await database(`UPDATE "DataRightsCase" SET "approvalSingleAdminReason"=$2 WHERE "id"=$1`, [caseId, `${REASON} (แก้ภายหลัง)`]),
      { code: '55000', message: 'data-rights evidence stamps are immutable without a status transition' },
    );
  });

  it('a second active System Admin: the same person is refused even with a reason, and two people work as before', async () => {
    await activeAdmins('admin-a', 'admin-b');
    const caseId = await reviewedCase(adminA);
    const second = code('data_rights_second_admin_required');
    assert.equal((await service.getCase(adminA, caseId)).singleAdminAvailable, false);

    // 1. approval: A opened the case
    await assert.rejects(() => service.approve(adminA, caseId, `approve-self-${caseId}`, REASON), second);
    // The marker is the truth both ways: the database refuses it on a step two people took.
    assert.equal((await statement.APPROVAL(caseId, 'admin-b', REASON) as { code: string }).code, '23514');
    await assert.rejects(() => service.approve(adminB, caseId, `approve-marked-${caseId}`, REASON), code('data_rights_single_admin_not_applicable'));
    await service.approve(adminB, caseId, `approve-${caseId}`);
    // 2. execution: B approved
    await assert.rejects(() => service.startExecution(adminB, caseId, `execute-self-${caseId}`, REASON), second);
    await service.startExecution(adminA, caseId, `execute-${caseId}`);
    await executionEvidence(adminA, caseId);
    // 3. verification: A executes
    await assert.rejects(() => service.startVerification(adminA, caseId, `verify-self-${caseId}`, REASON), second);
    await service.startVerification(adminB, caseId, `verify-${caseId}`);
    // 4. independent verification
    await assert.rejects(() => service.recordEvidence(adminA, caseId, independent(`independent-self-${caseId}`, REASON)), second);
    assert.deepEqual(await statement.INDEPENDENT_VERIFICATION(caseId, 'admin-b', REASON), {
      code: '55000', message: 'single-admin marker is only valid when the executor records independent verification',
    });
    await service.recordEvidence(adminB, caseId, independent(`independent-${caseId}`));
    // 5. completion
    await assert.rejects(() => service.complete(adminA, caseId, completion(`complete-self-${caseId}`, REASON)), second);
    const done = await service.complete(adminB, caseId, completion(`complete-${caseId}`));

    assert.deepEqual(
      [done.case.status, done.case.createdByUserId, done.case.approvedByUserId, done.case.executionStartedByUserId,
        done.case.verificationStartedByUserId, done.case.completedByUserId],
      ['COMPLETED', 'admin-a', 'admin-b', 'admin-a', 'admin-b', 'admin-b'],
    );
    for (const flag of ['approval', 'execution', 'verification', 'completion'] as const) {
      assert.deepEqual([done.case[`${flag}SingleAdmin`], done.case[`${flag}SingleAdminReason`]], [false, null], flag);
    }
    assert.equal(done.case.evidence.some((item) => item.singleAdmin), false);
    assert.deepEqual(await singleAdminAudits(caseId), []);
  });

  it('counts a System Admin only when the person, the sign-in, the membership, the company and the system role are all real and active', async () => {
    await activeAdmins('admin-a', 'admin-b');
    const caseId = await reviewedCase(adminA);
    const available = async () => (await service.getCase(adminA, caseId)).singleAdminAvailable;
    assert.equal(await available(), false);

    // The System Admin cutover retires an admin by disabling the credential; the protected user,
    // membership and role rows stay. Nobody can sign in to that account, so it is not a second person.
    await client.userCredential.create({ data: { userId: 'admin-b', passwordHash: 'retired-account', status: 'DISABLED', expiresAt: new Date() } });
    assert.equal(await available(), true);
    // A temporary password is a person who has not signed in yet, and an active one a person who has.
    await client.userCredential.update({ where: { userId: 'admin-b' }, data: { status: 'TEMPORARY', expiresAt: null } });
    assert.equal(await available(), false);
    await client.userCredential.update({ where: { userId: 'admin-b' }, data: { status: 'ACTIVE' } });
    assert.equal(await available(), false);
    await client.userCredential.delete({ where: { userId: 'admin-b' } });
    assert.equal(await available(), false);

    // The second admin's account is suspended: one active admin again.
    await client.user.update({ where: { id: 'admin-b' }, data: { status: 'SUSPENDED' } });
    assert.equal(await available(), true);
    await client.user.update({ where: { id: 'admin-b' }, data: { status: 'ACTIVE' } });
    assert.equal(await available(), false);
    await activeAdmins('admin-a');
    assert.equal(await available(), true);

    // A shop's own role that merely carries the key is not a System Admin.
    const shop = await client.company.create({ data: { id: `shop-role-${randomUUID().slice(0, 8)}`, name: 'Shop with a named role' } });
    const lookalike = await client.role.create({ data: { companyId: shop.id, scopeKey: shop.id, key: 'SYSTEM_ADMIN', name: 'System Admin' } });
    const member = await client.user.create({ data: { id: `member-${randomUUID().slice(0, 8)}`, displayName: 'Shop member' } });
    const membership = await client.companyMembership.create({
      data: { companyId: shop.id, userId: member.id, roles: { create: { roleId: lookalike.id } } },
    });
    assert.equal(await available(), true);

    // The real system role held anywhere is one: that person could act as the second pair of eyes.
    const systemAdmin = await client.role.findUniqueOrThrow({ where: { scopeKey_key: { scopeKey: 'system', key: 'SYSTEM_ADMIN' } } });
    await client.membershipRole.create({ data: { membershipId: membership.id, roleId: systemAdmin.id } });
    assert.equal(await available(), false);
    await assert.rejects(() => service.approve(adminA, caseId, `approve-third-${caseId}`, REASON), code('data_rights_second_admin_required'));
    // ...unless their company is not active.
    await client.company.update({ where: { id: shop.id }, data: { status: 'DISABLED' } });
    assert.equal(await available(), true);
    await service.approve(adminA, caseId, `approve-${caseId}`, REASON);
    assert.equal((await client.dataRightsCase.findUniqueOrThrow({ where: { id: caseId } })).approvalSingleAdmin, true);
  });
});
