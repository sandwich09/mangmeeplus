/**
 * The executive report labels on a company (executive backend spec §12.2, §15, §16.1) on real PostgreSQL.
 *
 * What a mocked client cannot show and this file proves: the one-time release backfill's SQL (which
 * companies count as signup companies, run-once under concurrency), the partner list filters as SQL
 * (NULL and unknown stored values, the platform company, the 1,098-code industry mapping), and the
 * detail's who/when for the industry group, read back through a JSON filter on the audit rows.
 *
 * It builds its own scratch database from the real migration files and drops it afterwards: the
 * backfill reads every company and its marker is global, so it cannot share a database.
 *
 * Run with (any database on a disposable local server; it is only used to create the scratch one):
 *   REPORT_LABELS_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     npx tsx --test src/modules/system-partner-management/report-labels.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UnprocessableEntityException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { PrismaClient } from '../../generated/prisma/client';
import { BillingCashMovementsService } from '../billing/application/billing-cash-movements.service';
import { ExecutiveReportBuildUseCase } from '../executive-business/application/executive-report-build.use-case';
import { backfillReportLabels, REPORT_LABEL_BACKFILL_REQUEST_ID } from '../../../prisma/report-label-backfill';
import { PLATFORM_TENANT_ID } from '../sales-console/application/sales-context';
import { GetPartnerDetailUseCase } from './application/use-cases/get-partner-detail.use-case';
import { ListPartnersUseCase } from './application/use-cases/list-partners.use-case';
import { UpdatePartnerProfileUseCase } from './application/use-cases/update-partner-profile.use-case';

const databaseUrl = process.env.REPORT_LABELS_TEST_DATABASE_URL;
const API_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS = join(API_ROOT, 'prisma', 'migrations');

describe('company report labels on real PostgreSQL', { skip: !databaseUrl }, () => {
  let admin: Client;
  let client: PrismaClient;
  let scratchUrl: string;
  let scratch: string;
  const others: PrismaClient[] = [];

  const company = (id: string, data: Record<string, unknown> = {}) =>
    client.company.upsert({ where: { id }, update: data, create: { id, name: `ร้าน ${id}`, ...data } });
  const signup = (data: Record<string, unknown>) => client.companySignupRequest.create({ data: { externalSignupId: randomUUID(), payloadHash: 'h',
    companyName: 'ชื่อในคำขอสมัคร', ownerDisplayName: 'เจ้าของในคำขอ', consentVersion: 'v1', ...data } });
  const labelsOf = async (ids: string[]) => new Map((await client.company.findMany({ where: { id: { in: ids } },
    select: { id: true, reportClassification: true, reportClassifiedAt: true, reportClassifiedByUserId: true } })).map((row) => [row.id, row]));
  const backfillRows = () => client.auditLog.findMany({ where: { requestId: REPORT_LABEL_BACKFILL_REQUEST_ID }, orderBy: { targetId: 'asc' } });
  const detail = () => new GetPartnerDetailUseCase({ client } as never, { get: async () => ({ status: 'UNKNOWN', version: 0 }) } as never);
  const update = () => new UpdatePartnerProfileUseCase({ client } as never, detail(), { stripeAccountId: 'acct_labels', billingMode: 'test' } as never);
  const cmd = (companyId: string, userId: string, labels: Record<string, unknown>) =>
    ({ companyId, requestingAdminUserId: userId, requestId: randomUUID(), ...labels });

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test server is allowed');
    assert.ok(url.pathname === '/watchdog_bms' || url.pathname.endsWith('_ci'), `refusing to work next to ${url.pathname}: only a disposable test server is allowed`);
    scratch = `report_labels_${randomUUID().slice(0, 8)}_ci`;
    admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${scratch}"`);
    url.pathname = `/${scratch}`;
    scratchUrl = url.toString();
    const raw = new Client({ connectionString: scratchUrl });
    await raw.connect();
    try {
      const names = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      assert.ok(names.includes('20261003090000_company_report_labels'));
      for (const name of names) await raw.query(readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));
    } finally { await raw.end(); }
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: scratchUrl }) });
  });

  after(async () => {
    for (const other of others) await other.$disconnect().catch(() => undefined);
    await client?.$disconnect().catch(() => undefined);
    if (admin) {
      try { if (scratch) await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`); }
      finally { await admin.end(); }
    }
  });

  it('the one-time backfill labels signup companies CUSTOMER and the platform INTERNAL, once, under concurrency too', async () => {
    await company(PLATFORM_TENANT_ID, { name: 'มั่งมีพลัส · ระบบภายใน' });
    await company('bf-signup');
    await signup({ companyId: 'bf-signup' });
    await company('bf-signup-twice');
    await signup({ companyId: 'bf-signup-twice' });
    await signup({ companyId: 'bf-signup-twice', source: 'line-oa' });
    await company('bf-signup-labelled', { reportClassification: 'TEST' });
    await signup({ companyId: 'bf-signup-labelled' });
    await company('bf-admin-made');
    // A request that only points at an existing shop ("return to my shop") did not create it.
    await company('bf-resolved-existing');
    await signup({ resolvedExistingCompanyId: 'bf-resolved-existing' });
    await signup({});
    const ids = [PLATFORM_TENANT_ID, 'bf-signup', 'bf-signup-twice', 'bf-signup-labelled', 'bf-admin-made', 'bf-resolved-existing'];

    // The first run goes through the release entry point exactly as the release calls it.
    const output = execFileSync(join(API_ROOT, 'node_modules', '.bin', 'tsx'), ['prisma/sync-permissions.ts'],
      { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: scratchUrl }, encoding: 'utf8' });
    assert.match(output, /Report-label backfill: 2 signup companies labelled CUSTOMER, 1 platform company labelled INTERNAL\./);
    let labels = await labelsOf(ids);
    for (const [id, expected] of [[PLATFORM_TENANT_ID, 'INTERNAL'], ['bf-signup', 'CUSTOMER'], ['bf-signup-twice', 'CUSTOMER']] as const) {
      assert.equal(labels.get(id)!.reportClassification, expected, id);
      assert.ok(labels.get(id)!.reportClassifiedAt instanceof Date, id);
      assert.equal(labels.get(id)!.reportClassifiedByUserId, null, `${id}: the system chose`);
    }
    assert.equal(labels.get('bf-signup-labelled')!.reportClassification, 'TEST', 'a label already chosen is kept');
    assert.equal(labels.get('bf-signup-labelled')!.reportClassifiedAt, null);
    for (const id of ['bf-admin-made', 'bf-resolved-existing']) assert.equal(labels.get(id)!.reportClassification, null, id);

    // One audit row per labelled company (as the profile update writes it) and the marker.
    const rows = await backfillRows();
    assert.deepEqual(rows.map((row) => row.targetId), ['bf-signup', 'bf-signup-twice', PLATFORM_TENANT_ID, null]);
    assert.deepEqual(rows.map((row) => [row.actorType, row.actorRefId, row.action, row.companyId]),
      rows.map(() => ['SYSTEM', 'report-label-backfill', 'system.partner_company.update', null]));
    assert.deepEqual(rows[0]!.metadataJson, { source: 'report-label-backfill', changedFields: ['reportClassification'],
      reportClassification: { from: null, to: 'CUSTOMER' } });
    assert.deepEqual(rows[3]!.metadataJson, { source: 'report-label-backfill', labelledCustomer: 2, labelledInternal: 1 });

    // The admin clears a label afterwards: the next release's run must not put it back.
    await client.user.create({ data: { id: 'bf-admin', displayName: 'แอดมิน' } });
    await update().execute(cmd('bf-signup', 'bf-admin', { reportClassification: null }));
    assert.equal(await backfillReportLabels(client, () => undefined), null);
    labels = await labelsOf(['bf-signup']);
    assert.equal(labels.get('bf-signup')!.reportClassification, null);
    assert.equal(labels.get('bf-signup')!.reportClassifiedByUserId, 'bf-admin');
    assert.equal((await backfillRows()).length, 4);

    // A fresh database where three containers boot at once: one run labels, the other two wait and find the marker.
    await client.auditLog.deleteMany({ where: { requestId: REPORT_LABEL_BACKFILL_REQUEST_ID } });
    await client.company.updateMany({ where: { id: { in: [PLATFORM_TENANT_ID, 'bf-signup', 'bf-signup-twice'] } },
      data: { reportClassification: null, reportClassifiedAt: null, reportClassifiedByUserId: null } });
    for (let index = 0; index < 3; index += 1) others.push(new PrismaClient({ adapter: new PrismaPg({ connectionString: scratchUrl }) }));
    const results = await Promise.all(others.map((other) => backfillReportLabels(other, () => undefined)));
    assert.deepEqual(results.filter(Boolean), [{ customer: 2, internal: 1 }]);
    assert.equal((await backfillRows()).length, 4);
  });

  it('the partner list filters classification and industry group exactly as the report reads them', async () => {
    // The platform row says CUSTOMER here on purpose: it is INTERNAL whatever its row says.
    await company(PLATFORM_TENANT_ID, { reportClassification: 'CUSTOMER' });
    await company('lf-customer', { reportClassification: 'CUSTOMER', reportIndustryGroup: 'FINANCE' });
    await company('lf-test', { reportClassification: 'TEST', businessTypeCode: '56101' });
    await company('lf-internal', { reportClassification: 'INTERNAL', businessTypeCode: 'OTHER', businessTypeOther: 'รับฝากของ' });
    await company('lf-none', { reportIndustryGroup: 'BOGUS' });
    await company('lf-unknown-value', { reportClassification: 'VIP', businessTypeCode: '99999' });
    const known = new Set([PLATFORM_TENANT_ID, 'lf-customer', 'lf-test', 'lf-internal', 'lf-none', 'lf-unknown-value']);
    const list = new ListPartnersUseCase({ client } as never);
    const ids = async (query: Record<string, string>) => {
      const result = await list.execute({ ...query, pageSize: 100 });
      assert.equal(result.total, result.items.length, `count and rows share one condition: ${JSON.stringify(query)}`);
      return result.items.map((item) => item.id).filter((id) => known.has(id)).sort();
    };

    assert.deepEqual(await ids({}), [...known].sort());
    assert.deepEqual(await ids({ reportClassification: 'ALL' }), [...known].sort());
    assert.deepEqual(await ids({ reportClassification: 'CUSTOMER' }), ['lf-customer']);
    assert.deepEqual(await ids({ reportClassification: 'TEST' }), ['lf-test']);
    assert.deepEqual(await ids({ reportClassification: 'INTERNAL' }), ['lf-internal', PLATFORM_TENANT_ID].sort());
    assert.deepEqual(await ids({ reportClassification: 'UNCLASSIFIED' }), ['lf-none', 'lf-unknown-value']);
    // No admin group and no business type the mapping knows (none, "OTHER", an unknown code, an unknown stored group).
    assert.deepEqual(await ids({ reportIndustryGroup: 'UNSET' }), ['lf-internal', 'lf-none', 'lf-unknown-value', PLATFORM_TENANT_ID].sort());
    assert.deepEqual(await ids({ reportClassification: 'INTERNAL', reportIndustryGroup: 'UNSET' }), ['lf-internal', PLATFORM_TENANT_ID].sort());

    const items = new Map((await list.execute({ pageSize: 100 })).items.map((item) => [item.id, item]));
    assert.equal(items.get(PLATFORM_TENANT_ID)!.reportClassification, 'INTERNAL');
    assert.equal(items.get('lf-unknown-value')!.reportClassification, null);
    assert.equal(items.get('lf-customer')!.reportIndustryGroup, 'FINANCE');
    assert.equal(items.get('lf-test')!.reportIndustryGroup, 'FOOD_ACCOMMODATION', 'restaurants (TSIC 56101) by the mapping');
    assert.equal(items.get('lf-none')!.reportIndustryGroup, null);

    for (const query of [{ reportClassification: 'customer' }, { reportClassification: 'NONE' }, { reportIndustryGroup: 'FINANCE' }]) {
      await assert.rejects(() => list.execute(query), UnprocessableEntityException, JSON.stringify(query));
    }

    // Spec §16.1: the UNCLASSIFIED total is the labelling work left, and equals the next build's `unclassifiedCount`.
    const build = await new ExecutiveReportBuildUseCase({ client } as never, new BillingCashMovementsService({ client } as never,
      { billingMode: 'live', stripeAccountId: 'acct_labels' } as never)).rebuild(new Date(Date.now() + 60_000));
    assert.equal(build.status, 'BUILT');
    const header = await client.executiveReportBuild.findUniqueOrThrow({ where: { id: (build as { buildId: string }).buildId } });
    assert.equal(header.unclassifiedCount, (await list.execute({ reportClassification: 'UNCLASSIFIED' })).total);
    assert.equal(header.companyCount, (await list.execute({})).total);
  });

  it('the profile update writes both labels on a locked company, and the detail reads them back with who and when', async () => {
    await client.user.create({ data: { id: 'rt-first-admin', displayName: 'แอดมินคนแรก' } });
    await client.user.create({ data: { id: 'rt-second-admin', displayName: 'แอดมินคนที่สอง' } });
    await company('rt-shop', { status: 'ARCHIVED', businessTypeCode: '56101' });

    const first = await update().execute(cmd('rt-shop', 'rt-first-admin', { reportClassification: 'TEST', reportIndustryGroup: 'MANUFACTURING' }));
    assert.equal(first.reportLabels.classification, 'TEST');
    assert.deepEqual(first.reportLabels.classifiedBy, { userId: 'rt-first-admin', displayName: 'แอดมินคนแรก' });
    assert.equal(first.reportLabels.industryGroup, 'MANUFACTURING');
    assert.deepEqual(first.reportLabels.industryGroupSetBy, { userId: 'rt-first-admin', displayName: 'แอดมินคนแรก' });
    assert.equal(first.reportLabels.effectiveIndustryGroup, 'MANUFACTURING');
    assert.equal(first.reportLabels.industryGroupVersion, 1);
    const groupSetAt = first.reportLabels.industryGroupSetAt;
    assert.ok(groupSetAt && first.reportLabels.classifiedAt);

    // A later change of the classification alone by someone else: the group's who/when stays the first admin's.
    const second = await update().execute(cmd('rt-shop', 'rt-second-admin', { reportClassification: 'CUSTOMER' }));
    assert.deepEqual(second.reportLabels.classifiedBy, { userId: 'rt-second-admin', displayName: 'แอดมินคนที่สอง' });
    assert.deepEqual(second.reportLabels.industryGroupSetBy, { userId: 'rt-first-admin', displayName: 'แอดมินคนแรก' });
    assert.equal(second.reportLabels.industryGroupSetAt, groupSetAt);

    // Cleared: the report falls back to the mapping of the shop's own business type.
    const cleared = await update().execute(cmd('rt-shop', 'rt-second-admin', { reportIndustryGroup: null }));
    assert.equal(cleared.reportLabels.industryGroup, null);
    assert.equal(cleared.reportLabels.industryGroupSetAt, undefined);
    assert.equal(cleared.reportLabels.effectiveIndustryGroup, 'FOOD_ACCOMMODATION');
    assert.equal((await client.company.findUniqueOrThrow({ where: { id: 'rt-shop' } })).status, 'ARCHIVED');

    // The platform company reads INTERNAL and refuses anything else.
    assert.equal((await detail().execute(PLATFORM_TENANT_ID)).reportLabels.classification, 'INTERNAL');
    await assert.rejects(() => update().execute(cmd(PLATFORM_TENANT_ID, 'rt-first-admin', { reportClassification: 'TEST' })), UnprocessableEntityException);
  });
});
