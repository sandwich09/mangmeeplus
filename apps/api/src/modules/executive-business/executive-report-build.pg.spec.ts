/**
 * The executive report build (executive backend spec §12.3, §13, §14; plan §4.2) on real PostgreSQL.
 *
 * What a mocked client cannot show and this file proves: Bangkok month and day boundaries on
 * timestamp columns that carry no time zone, sums that a join must not multiply, a round that is
 * all-or-nothing, counters that never fall when a shop deletes its rows, a finished month that is
 * revised with a label, and the population rule.
 *
 * It builds its own scratch database from the real migration files on the given server and drops
 * it afterwards: the build reads every company and every billing row, so it cannot share a
 * database with other specs. The rule tables at the bottom need no database and run wherever this
 * file runs.
 *
 * Run with (any database on a disposable local server; it is only used to create the scratch one):
 *   EXECUTIVE_REPORT_BUILD_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     npx tsx --test src/modules/executive-business/executive-report-build.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { PrismaClient } from '../../generated/prisma/client';
import { BillingCashMovementsService } from '../billing/application/billing-cash-movements.service';
import { PrismaExpenseRepository } from '../expenses/infrastructure/prisma-expense.repository';
import { PLATFORM_TENANT_ID } from '../sales-console/application/sales-context';
import { ExecutiveReportBuildUseCase } from './application/executive-report-build.use-case';
import { bangkokDayStart, decideDiscovery, decidePaidEver, decideReceiptAdoption, decideReferrer, decideSignupRail, decideUsageGroup,
  executiveMonthOf, executiveMonthRange, executiveMonths, figuresKey, int32, keepLargerCounters, nextRevision, NO_USAGE,
  type CompanyMonthFigures } from './domain/executive-report.logic';
import { ExecutiveInternalController } from './presentation/http/executive-internal.controller';

const databaseUrl = process.env.EXECUTIVE_REPORT_BUILD_TEST_DATABASE_URL;
const MIGRATIONS = join(__dirname, '..', '..', '..', 'prisma', 'migrations');
const at = (iso: string) => new Date(iso);
const seconds = (iso: string) => Date.parse(iso) / 1000;
const STRIPE = 'acct_executive_spec';
/** 15 October 2026, 10:00 in Bangkok: October is running, September is over. */
const NOW = at('2026-10-15T03:00:00.000Z');
const SEPTEMBER = executiveMonthRange('2026-09');

describe('executive report build on real PostgreSQL', { skip: !databaseUrl }, () => {
  let admin: Client;
  let raw: Client;
  let client: PrismaClient;
  let bangkokSession: PrismaClient;
  let build: ExecutiveReportBuildUseCase;
  let scratch: string;
  let scanJob: string;
  let sequence = 0;
  const next = (prefix: string) => `${prefix}-${++sequence}`;
  /** The build's "now". A minute later is another hourly round; the next day starts with a full round. */
  let clock = NOW;
  const minuteLater = () => (clock = new Date(clock.getTime() + 60_000));
  const nextDay = () => (clock = new Date(clock.getTime() + 86_400_000));

  // ── Fixtures: the smallest rows each source table accepts ──
  const company = (id: string, data: Record<string, unknown> = {}) =>
    client.company.create({ data: { id, name: `ร้าน ${id}`, createdAt: at('2026-08-10T02:00:00Z'), ...data } });
  const person = async (companyId: string, id = next('user'), status: 'ACTIVE' | 'DISABLED' = 'ACTIVE') => {
    await client.user.create({ data: { id, displayName: `คุณ ${id}`, email: `${id}@example.test`, phoneNumber: '0812345678' } });
    await client.companyMembership.create({ data: { companyId, userId: id, status } });
    return id;
  };
  const expense = (companyId: string, userId: string | null, confirmedAt: string | null, captureSource = 'WEB_UPLOAD', createdAt = confirmedAt ?? '2026-09-10T03:00:00Z') =>
    client.expenseRecord.create({ data: { companyId, expenseDate: at(createdAt), createdByUserId: userId ?? 'system', confirmedByUserId: userId,
      confirmedAt: confirmedAt ? at(confirmedAt) : null, captureSource: captureSource as never, createdAt: at(createdAt), status: confirmedAt ? 'CONFIRMED' : 'DRAFT' } });
  const document = (companyId: string, userId: string, issuedAt: string | null) =>
    client.accountingDocument.create({ data: { companyId, documentType: 'INVOICE', documentDate: at(issuedAt ?? '2026-09-10T03:00:00Z'), createdByUserId: userId,
      issuedAt: issuedAt ? at(issuedAt) : null } });
  const aiEvent = (companyId: string, createdAt: string, data: Record<string, unknown> = {}) =>
    client.aiUsageEvent.create({ data: { companyId, monthKey: executiveMonthOf(at(createdAt)), sourceRoute: 'line-turn', usageTag: 'spec', modelId: 'spec', ok: true,
      inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, costSatang: 10, thbPerUsd: 35, thbPerUsdSource: 'stored',
      requestId: next('request'), createdAt: at(createdAt), ...data } });
  const term = (companyId: string, tierKey: string, days: number, renewCount = 0) =>
    client.companyPlanTerm.create({ data: { companyId, tierKey, branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 30, termStartAt: at('2026-09-01T00:00:00Z'),
      termEndsAt: new Date(Date.parse('2026-09-01T00:00:00Z') + days * 86_400_000), renewCount } });
  const signup = (companyId: string, createdAt: string, source: string, discoverySource: string | null, other: string | null = null) =>
    client.companySignupRequest.create({ data: { companyId, source, discoverySource, discoverySourceOther: other, externalSignupId: next('signup'), payloadHash: 'h',
      companyName: 'ชื่อในคำขอสมัคร', ownerDisplayName: 'เจ้าของในคำขอ', consentVersion: 'v1', createdAt: at(createdAt) } });
  /** A paying company: a billing account and a paid invoice of the running mode. */
  const paidInvoice = async (companyId: string, paidSatang: number, refundedSatang = 0, disputed = false) => {
    const account = await client.billingAccount.upsert({ where: { companyId_stripeAccountId_livemode: { companyId, stripeAccountId: STRIPE, livemode: true } },
      update: {}, create: { companyId, stripeAccountId: STRIPE, livemode: true, createdAt: at('2026-08-20T00:00:00Z') } });
    const attempt = await client.billingAttempt.create({ data: { billingAccountId: account.id, initiatingUserId: 'spec', quoteId: randomUUID(), channel: 'web',
      idempotencyKey: randomUUID(), requestHash: 'h', quoteSnapshot: { quote: { purchase: { kind: 'INITIAL' } } }, policyRevisionId: 'p', consentRevision: 'c', consentAt: new Date() } });
    return (await client.billingInvoice.create({ data: { billingAccountId: account.id, providerInvoiceId: `in_${randomUUID()}`, sourceAttemptId: attempt.id, offerSnapshot: {},
      policyRevisionId: 'p', currency: 'THB', totalSatang: paidSatang, paidSatang, refundedSatang, disputed, taxSatang: 0, periodStart: SEPTEMBER.start,
      periodEnd: SEPTEMBER.end, providerStatus: 'paid', evidenceHash: 'h' } })).id;
  };
  /** One movement as the balance scan stores it. A charge has a positive amount, a refund a negative one. */
  const movement = (type: string, amount: number, created: string, observation: Record<string, unknown> = {}, fee = 0) => {
    const id = `txn_${next('m')}`;
    return client.billingOperation.create({ data: { stripeAccountId: STRIPE, livemode: true, type: 'OBSERVE_PROVIDER_BALANCE', referenceId: scanJob, state: 'SUCCEEDED',
      sourceVersion: 0, reason: 'spec', initiatorUserId: 'spec', requestHash: 'spec', idempotencyKey: `settlement:${scanJob}:${id}`, expiresAt: at('2030-01-01T00:00:00Z'),
      observedAt: new Date(), proposedJson: { movement: { id, sourceId: null, type, category: type, currency: 'thb', amount, fee, net: amount - fee, status: 'available',
        created: seconds(created), availableOn: seconds(created), balanceType: 'payments' }, classification: 'MANUAL', refundState: null, taxSatang: null, payout: null,
        invoiceId: null, companyId: null, accountId: null, localHash: null, disputed: null, ...observation } } });
  };
  const receipt = (companyId: string, invoiceId: string, amount: number, created: string, taxSatang = 0, fee = 0) =>
    movement('charge', amount, created, { classification: 'MATCHED', invoiceId, companyId, taxSatang }, fee);
  const refund = (companyId: string, invoiceId: string, amount: number, created: string) =>
    movement('refund', -amount, created, { classification: 'MATCHED', invoiceId, companyId, refundState: 'succeeded' });
  const scan = (since: string, until: string, state = 'SUCCEEDED') => client.billingOperation.create({ data: { stripeAccountId: STRIPE, livemode: true, type: 'SCAN_PROVIDER_BALANCE',
    state, proposedJson: { since: seconds(since), until: seconds(until), membershipId: 'm', actorCompanyId: 'c' }, sourceVersion: 0, reason: 'spec', initiatorUserId: 'spec',
    requestHash: 'spec', expiresAt: at('2030-01-01T00:00:00Z'), resultJson: {} } });

  const monthRow = (companyId: string, month: string, definitionVersion = 1) =>
    client.executiveCompanyMonth.findUnique({ where: { companyId_month_definitionVersion: { companyId, month, definitionVersion } } });
  const header = (month: string, definitionVersion = 1) =>
    client.executiveReportMonth.findUniqueOrThrow({ where: { month_definitionVersion: { month, definitionVersion } } });
  const profile = (companyId: string) => client.executiveCompanyProfile.findUniqueOrThrow({ where: { companyId } });
  /** Everything a reader could be answered from, without the pointers that move with every round. */
  const snapshot = async () => {
    const strip = <T extends { buildId?: string; asOf?: Date }>(rows: T[]) => rows.map(({ buildId: _build, asOf: _asOf, ...rest }) => rest);
    return JSON.stringify({
      months: strip(await client.executiveCompanyMonth.findMany({ orderBy: [{ month: 'asc' }, { companyId: 'asc' }, { definitionVersion: 'asc' }] })),
      headers: strip(await client.executiveReportMonth.findMany({ orderBy: [{ month: 'asc' }, { definitionVersion: 'asc' }] })),
      profiles: strip(await client.executiveCompanyProfile.findMany({ orderBy: { companyId: 'asc' } })),
    });
  };
  const built = (result: Awaited<ReturnType<ExecutiveReportBuildUseCase['rebuild']>>) => {
    assert.equal(result.status, 'BUILT');
    return result as Extract<typeof result, { status: 'BUILT' }>;
  };
  const useCase = (prisma: PrismaClient, billingClient: PrismaClient = prisma) => new ExecutiveReportBuildUseCase({ client: prisma } as never,
    new BillingCashMovementsService({ client: billingClient } as never, { billingMode: 'live', stripeAccountId: STRIPE } as never));

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test server is allowed');
    assert.ok(url.pathname === '/watchdog_bms' || url.pathname.endsWith('_ci'), `refusing to work next to ${url.pathname}: only a disposable test server is allowed`);
    scratch = `executive_report_build_${randomUUID().slice(0, 8)}_ci`;
    admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${scratch}"`);
    url.pathname = `/${scratch}`;
    // The real migrations, every one, in order — the way `prisma migrate deploy` sends them.
    raw = new Client({ connectionString: url.toString() });
    await raw.connect();
    const names = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    assert.ok(names.includes('20261003091000_executive_report_summary'));
    for (const name of names) await raw.query(readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
    // The same database through a session whose time zone is Bangkok: no answer may depend on the session.
    url.searchParams.set('options', '-c TimeZone=Asia/Bangkok');
    bangkokSession = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
    build = useCase(client);
    scanJob = (await scan('2026-07-31T17:00:00Z', '2026-10-14T17:00:00Z')).id;
    await client.thaiAddressMaster.create({ data: { subdistrictCode: '500101', postalCode: '50200', subdistrictTh: 'ศรีภูมิ', districtTh: 'เมืองเชียงใหม่',
      provinceTh: 'เชียงใหม่', districtCode: '5001', provinceCode: '50' } });
  });

  after(async () => {
    await bangkokSession?.$disconnect().catch(() => undefined);
    await client?.$disconnect().catch(() => undefined);
    await raw?.end().catch(() => undefined);
    if (admin) {
      try { if (scratch) await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`); }
      finally { await admin.end(); }
    }
  });

  it('sums each company once, however many invoices, signup requests and members it has', async () => {
    await company('shop', { reportClassification: 'CUSTOMER', businessTypeCode: '56101', createdAt: at('2026-08-10T02:00:00Z'),
      addressJson: { line1: '1 ถนนลับ', subdistrict: 'ศรีภูมิ', district: 'เมืองเชียงใหม่', province: 'จังหวัดเชียงใหม่', postalCode: '50200' } });
    const [owner, staff] = [await person('shop'), await person('shop')];
    await person('shop'); // a third member who never does anything
    await term('shop', 'STARTER_249', 60, 1);
    // Two signup requests: the original one decides discovery and rail, the later one must not replace or double it.
    await signup('shop', '2026-08-09T01:00:00Z', 'line-oa', 'WEBSITE');
    await signup('shop', '2026-09-20T01:00:00Z', 'official-site', 'OTHER', 'ข้อความที่ลูกค้าพิมพ์เอง');
    // Three paid invoices in September, one partly refunded in the same month.
    const first = await paidInvoice('shop', 26_643), second = await paidInvoice('shop', 53_393), third = await paidInvoice('shop', 10_000, 4_000);
    await receipt('shop', first, 26_643, '2026-09-03T04:00:00Z', 1_743, 1_000);
    await receipt('shop', second, 53_393, '2026-09-12T04:00:00Z', 3_493, 2_000);
    await receipt('shop', third, 10_000, '2026-09-20T04:00:00Z', 654, 400);
    await refund('shop', third, 4_000, '2026-09-25T04:00:00Z');
    // Four confirmed expenses by two people on three Bangkok days (one came in through LINE), one draft, two issued documents.
    await expense('shop', owner, '2026-09-05T03:00:00Z', 'LINE_UPLOAD');
    await expense('shop', owner, '2026-09-05T09:00:00Z', 'WEB_UPLOAD');
    await expense('shop', staff, '2026-09-06T03:00:00Z', 'WEB_MANUAL');
    await expense('shop', staff, '2026-09-18T03:00:00Z', 'WEB_UPLOAD');
    await expense('shop', owner, null, 'WEB_UPLOAD', '2026-09-19T03:00:00Z');
    await document('shop', owner, '2026-09-18T05:00:00Z');
    await document('shop', staff, '2026-09-21T05:00:00Z');
    await document('shop', staff, null);
    // Five model calls for three questions; a failed call, another route and a cost correction are not questions.
    const question = next('request');
    await aiEvent('shop', '2026-09-07T03:00:00Z', { requestId: question, costSatang: 30 });
    await aiEvent('shop', '2026-09-07T03:00:01Z', { requestId: question, costSatang: 20 });
    await aiEvent('shop', '2026-09-08T03:00:00Z', { costSatang: 15 });
    await aiEvent('shop', '2026-09-08T04:00:00Z', { costSatang: 5 });
    await aiEvent('shop', '2026-09-09T03:00:00Z', { ok: false, costSatang: 1 });
    await aiEvent('shop', '2026-09-10T03:00:00Z', { sourceRoute: 'receipt-ocr', costSatang: 100 });
    await aiEvent('shop', '2026-10-02T03:00:00Z', { eventKind: 'COST_ADJUSTMENT', monthKey: '2026-09', costSatang: -6, requestId: null });

    const result = built(await build.rebuild(NOW));
    assert.deepEqual({ kind: result.kind, months: result.months, companies: result.companyCount }, { kind: 'FULL', months: ['2026-08', '2026-09', '2026-10'], companies: 1 });

    const september = (await monthRow('shop', '2026-09'))!;
    assert.deepEqual({ receipts: september.receiptsSatang, refunds: september.refundsSatang, fees: september.feesSatang, tax: september.taxSatang, byKind: september.moneyByPurchaseKind },
      { receipts: 90_036, refunds: 4_000, fees: 3_400, tax: 5_890, byKind: { FIRST_PURCHASE: { receiptsSatang: 90_036, refundsSatang: 4_000, feesSatang: 3_400, taxSatang: 5_890 } } });
    assert.deepEqual({ days: september.activeDays, line: september.activeDaysLine, web: september.activeDaysWeb, users: september.activeUsers,
      usersLine: september.activeUsersLine, usersWeb: september.activeUsersWeb, expensesLine: september.confirmedExpensesLine, expensesWeb: september.confirmedExpensesWeb,
      documents: september.issuedDocuments, ai: september.aiRequests, receiptsLine: september.expenseReceiptsLine, receiptsWeb: september.expenseReceiptsWeb },
    // Days: 5, 6, 7, 8, 18, 21 Sep. LINE days: 5 (the LINE expense), 7, 8 (questions). Web days: 5, 6, 18, 21.
    { days: 6, line: 3, web: 4, users: 2, usersLine: 1, usersWeb: 2, expensesLine: 1, expensesWeb: 3, documents: 2, ai: 3, receiptsLine: 1, receiptsWeb: 3 });
    // AI cost is every row of the month key, the later correction included: 30 + 20 + 15 + 5 + 1 + 100 − 6.
    assert.equal(september.aiCostSatang, 165);
    assert.deepEqual({ paidEver: september.paidEver, usageGroup: september.usageGroup, classification: september.reportClassification, revision: september.revision },
      { paidEver: 'YES', usageGroup: 'ACTIVE', classification: 'CUSTOMER', revision: 0 });

    const shop = await profile('shop');
    assert.deepEqual({ discovery: shop.discovery, rail: shop.signupRail, members: shop.activeMemberCount, industry: shop.industryGroup, industrySource: shop.industryGroupSource,
      province: shop.provinceCode, plan: shop.planState, tier: shop.planTierKey, paidEver: shop.paidEver, receipts: shop.lifetimeReceiptsSatang, refunds: shop.lifetimeRefundsSatang,
      first: shop.firstActivityAt?.toISOString(), last: shop.lastActivityAt?.toISOString(), lastLine: shop.lastLineActivityAt?.toISOString(),
      adoption: shop.receiptAdoption, lifetimeReceipts: shop.expenseReceiptCountLifetime, referrer: shop.referrerKind },
    { discovery: 'WEBSITE', rail: 'line-oa', members: 3, industry: 'FOOD_ACCOMMODATION', industrySource: 'MAPPING', province: '50', plan: 'ACTIVE', tier: 'STARTER_249',
      paidEver: 'YES', receipts: 90_036, refunds: 4_000, first: '2026-09-05T03:00:00.000Z', last: '2026-09-21T05:00:00.000Z', lastLine: '2026-09-08T04:00:00.000Z',
      adoption: 'EVER', lifetimeReceipts: 4, referrer: 'NONE' });
  });

  it('puts an action in the Bangkok month and on the Bangkok day it happened, to the millisecond', async () => {
    await company('edge', { reportClassification: 'CUSTOMER', createdAt: at('2026-08-01T00:00:00Z') });
    const user = await person('edge');
    const times = [
      '2026-08-31T16:59:59.999Z', // 31 Aug 23:59:59.999 Bangkok: the last instant of August
      '2026-08-31T17:00:00.000Z', // 1 Sep 00:00:00.000 Bangkok: the first instant of September
      '2026-09-01T06:59:00.000Z', // 1 Sep 13:59 Bangkok: a wrong-way conversion would call this 31 Aug
      '2026-09-01T07:00:00.000Z', // 1 Sep 14:00 Bangkok
      '2026-09-01T16:59:59.999Z', // 1 Sep 23:59:59.999 Bangkok: still the 1st
      '2026-09-01T17:00:00.000Z', // 2 Sep 00:00 Bangkok
      '2026-09-15T16:59:59.999Z', // 15 Sep 23:59:59.999 Bangkok ...
      '2026-09-15T17:00:00.000Z', // ... and 16 Sep 00:00 Bangkok: two Bangkok days inside one UTC day
      '2026-09-30T16:59:59.999Z', // 30 Sep 23:59:59.999 Bangkok: the last instant of September
      '2026-09-30T17:00:00.000Z', // 1 Oct 00:00 Bangkok: October
    ];
    for (const time of times) await expense('edge', user, time, 'WEB_MANUAL');
    // The same boundaries on the other two sources: a document at the first instant of the month, a question at the last.
    await document('edge', user, '2026-08-31T17:00:00.000Z');
    await aiEvent('edge', '2026-09-30T16:59:59.999Z');
    await aiEvent('edge', '2026-09-30T17:00:00.000Z');

    const shape = async (prisma: PrismaClient) => {
      // A new day, so the round is a full one and reaches August.
      assert.equal(built(await useCase(prisma, client).rebuild(nextDay())).kind, 'FULL');
      const rows = await Promise.all(['2026-08', '2026-09', '2026-10'].map((month) => monthRow('edge', month)));
      return rows.map((row) => [row!.confirmedExpensesWeb, row!.issuedDocuments, row!.aiRequests, row!.activeDays, row!.activeDaysWeb, row!.activeDaysLine]);
    };
    const expected = [
      [1, 0, 0, 1, 1, 0], // August: one expense, on the 31st
      [8, 1, 1, 5, 5, 1], // September: 1st (four expenses and the document), 2nd, 15th, 16th, 30th (an expense and the question)
      [1, 0, 1, 1, 1, 1], // October: the expense and the question of the 1st
    ];
    assert.deepEqual(await shape(client), expected);
    // A session that runs in Bangkok time answers the same: the SQL never leans on the session's time zone.
    assert.deepEqual((await bangkokSession.$queryRaw<Array<{ zone: string }>>`SELECT current_setting('TimeZone') AS zone`)[0]!.zone, 'Asia/Bangkok');
    assert.deepEqual(await shape(bangkokSession), expected);
    const edge = await profile('edge');
    assert.deepEqual([edge.firstActivityAt?.toISOString(), edge.lastActivityAt?.toISOString()], ['2026-08-31T16:59:59.999Z', '2026-09-30T17:00:00.000Z']);
  });

  it('changes nothing when the build is called again', async () => {
    const before = await snapshot(), builds = await client.executiveReportBuild.count();
    const again = built(await build.rebuild(minuteLater()));
    // The full round already ran today, so this one is the hourly round: the current and the previous month.
    assert.deepEqual({ kind: again.kind, months: again.months }, { kind: 'HOURLY', months: ['2026-09', '2026-10'] });
    assert.equal(await snapshot(), before);
    assert.equal(await client.executiveReportBuild.count(), builds + 1);
    // The pointer moved, the figures and revisions did not: the rows of the round carry the new build, the others the old one.
    assert.equal((await monthRow('shop', '2026-09'))!.buildId, again.buildId);
    assert.equal((await monthRow('shop', '2026-08'))!.buildId === again.buildId, false);
    assert.equal((await client.executiveReportBuild.findFirstOrThrow({ orderBy: { asOf: 'desc' } })).id, again.buildId);
  });

  it('counts only CUSTOMER companies created before the month ended, and keeps the rest apart', async () => {
    await company('demo', { reportClassification: 'DEMO', createdAt: at('2026-08-15T00:00:00Z') });
    await company('tester', { reportClassification: 'TEST', createdAt: at('2026-08-15T00:00:00Z') });
    await receipt('tester', await paidInvoice('tester', 24_900), 24_900, '2026-09-10T04:00:00Z');
    await company('unlabelled', { createdAt: at('2026-08-15T00:00:00Z') });
    await receipt('unlabelled', await paidInvoice('unlabelled', 5_000), 5_000, '2026-09-11T04:00:00Z');
    await company(PLATFORM_TENANT_ID, { createdAt: at('2026-01-01T00:00:00Z') }); // the platform company carries no label of its own
    await company('newcomer', { reportClassification: 'CUSTOMER', createdAt: at('2026-09-30T17:00:00.000Z') }); // 1 Oct 00:00 Bangkok
    await company('lastminute', { reportClassification: 'CUSTOMER', createdAt: at('2026-09-30T16:59:59.999Z') });

    const result = built(await build.rebuild(minuteLater()));
    const september = await client.executiveCompanyMonth.findMany({ where: { month: '2026-09', definitionVersion: 1 }, orderBy: { companyId: 'asc' } });
    const of = (label: string | null) => september.filter((row) => row.reportClassification === label);
    // The population of September: every shop not labelled TEST or INTERNAL that existed before 1 Oct 00:00 Bangkok. A shop nobody labelled is a customer.
    assert.deepEqual(of('CUSTOMER').map((row) => row.companyId), ['edge', 'lastminute', 'shop', 'unlabelled']);
    assert.equal(await monthRow('newcomer', '2026-09'), null);
    assert.equal((await monthRow('newcomer', '2026-10'))!.reportClassification, 'CUSTOMER');
    // Excluded companies keep their money as their own figure, so the month still reconciles with the provider.
    assert.deepEqual(of('TEST').map((row) => [row.companyId, row.receiptsSatang - row.refundsSatang]), [['tester', 24_900]]);
    assert.deepEqual(of('DEMO').map(row => row.companyId), ['demo']);
    assert.equal((await profile('demo')).reportClassification, 'DEMO');
    assert.deepEqual(of('INTERNAL').map((row) => row.companyId), [PLATFORM_TENANT_ID]);
    assert.deepEqual(of(null), []);
    // The round still says how many shops wait for a label: the labelling work left (spec §16.1).
    const round = await client.executiveReportBuild.findUniqueOrThrow({ where: { id: result.buildId } });
    assert.deepEqual({ kind: round.kind, companies: round.companyCount, unclassified: round.unclassifiedCount }, { kind: 'HOURLY', companies: 7, unclassified: 1 });
    assert.equal(await client.executiveCompanyProfile.count({ where: { reportClassification: null } }), 0);
    assert.equal((await profile(PLATFORM_TENANT_ID)).reportClassification, 'INTERNAL');
    // The hourly round does not reach back: the platform company's first months wait for the next full round.
    assert.equal(await monthRow(PLATFORM_TENANT_ID, '2026-01'), null);
  });

  it('keeps money no company answers for on the month, with how far the provider was read', async () => {
    await movement('charge', 7_700, '2026-09-14T04:00:00Z', { classification: 'LOCAL_MISSING' });
    await movement('refund', -1_200, '2026-09-15T04:00:00Z', { classification: 'LOCAL_MISSING', refundState: 'succeeded' });
    await movement('adjustment', -900, '2026-09-16T04:00:00Z');
    await movement('refund', -300, '2026-09-17T04:00:00Z', { classification: 'MANUAL', refundState: 'pending' });
    await movement('payout', -50_000, '2026-09-18T04:00:00Z', { classification: 'MATCHED' });
    // Money matched to a company that no longer exists is not dropped either.
    await movement('charge', 4_000, '2026-09-19T04:00:00Z', { classification: 'MATCHED', companyId: 'deleted-company', invoiceId: 'gone' });

    const earlier = await header('2026-09'), shopBefore = (await monthRow('shop', '2026-09'))!.revision;
    built(await build.rebuild(minuteLater()));
    const september = await header('2026-09');
    assert.deepEqual({ count: september.untiedCount, receipts: september.untiedReceiptsSatang, refunds: september.untiedRefundsSatang, other: september.untiedOtherSatang,
      unsuccessful: september.unsuccessfulRefundCount }, { count: 4, receipts: 11_700, refunds: 1_200, other: -900, unsuccessful: 1 });
    // The scan covers 1 Aug to 15 Oct 00:00 Bangkok: September was read whole, October up to the 15th.
    assert.equal(september.billingCoveredThrough?.toISOString(), '2026-10-14T17:00:00.000Z');
    assert.equal((await header('2026-10')).billingCoveredThrough?.toISOString(), '2026-10-14T17:00:00.000Z');
    const round = await client.executiveReportBuild.findFirstOrThrow({ orderBy: { asOf: 'desc' } });
    assert.deepEqual([round.billingDataThrough?.toISOString(), round.billingSince?.toISOString()], ['2026-10-14T17:00:00.000Z', '2026-08-20T00:00:00.000Z']);
    // The untied money changed a month that was over: one more revision with its date, never a silent change.
    assert.deepEqual([september.revision, september.revisedAt?.toISOString()], [earlier.revision + 1, clock.toISOString()]);
    assert.equal((await monthRow('shop', '2026-09'))!.revision, shopBefore);
  });

  it('writes nothing when a round fails, whether a source cannot be read or the write breaks midway', async () => {
    const before = await snapshot(), builds = await client.executiveReportBuild.count();
    // Something new to write, so a round that got through would be visible.
    await expense('shop', (await client.companyMembership.findFirstOrThrow({ where: { companyId: 'shop' } })).userId, '2026-10-10T03:00:00Z');

    // (a) a source that cannot be read: billing's reader throws.
    const unreadable = new ExecutiveReportBuildUseCase({ client } as never, { movements: async () => { throw new Error('billing source unavailable'); },
      coverage: async () => ({ ranges: [], dataThrough: null, since: null }), companyPayments: async () => new Map() } as never);
    await assert.rejects(unreadable.rebuild(minuteLater()), /billing source unavailable/);
    assert.equal(await snapshot(), before);
    assert.equal(await client.executiveReportBuild.count(), builds);

    // (b) the write itself breaks at its last table: the profiles and company months written before it are rolled back with it.
    await raw.query(`CREATE FUNCTION executive_spec_break() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic write failure'; END $$`);
    await raw.query(`CREATE TRIGGER executive_spec_break BEFORE INSERT ON "ExecutiveReportMonth" FOR EACH ROW EXECUTE FUNCTION executive_spec_break()`);
    try {
      await assert.rejects(build.rebuild(minuteLater()), /synthetic write failure/);
    } finally {
      await raw.query(`DROP TRIGGER executive_spec_break ON "ExecutiveReportMonth"`);
      await raw.query(`DROP FUNCTION executive_spec_break()`);
    }
    assert.equal(await snapshot(), before);
    assert.equal(await client.executiveReportBuild.count(), builds);

    // The next round that gets through writes what the failed ones could not.
    built(await build.rebuild(minuteLater()));
    assert.notEqual(await snapshot(), before);
    assert.equal(await client.executiveReportBuild.count(), builds + 1);
  });

  it('skips a round while another one holds the lock', async () => {
    const builds = await client.executiveReportBuild.count(), before = await snapshot();
    await raw.query(`SELECT pg_advisory_lock(hashtextextended('executive-report-build', 0))`);
    try {
      assert.deepEqual(await build.rebuild(minuteLater()), { status: 'SKIPPED' });
    } finally {
      await raw.query(`SELECT pg_advisory_unlock(hashtextextended('executive-report-build', 0))`);
    }
    assert.equal(await client.executiveReportBuild.count(), builds);
    assert.equal(await snapshot(), before);
    built(await build.rebuild(minuteLater()));
  });

  it('never lowers a usage counter when the shop deletes its rows, and never takes "added a receipt" back', async () => {
    const COUNTERS = ['activeDays', 'activeDaysLine', 'activeDaysWeb', 'activeUsers', 'activeUsersLine', 'activeUsersWeb', 'confirmedExpensesLine',
      'confirmedExpensesWeb', 'issuedDocuments', 'aiRequests', 'expenseReceiptsLine', 'expenseReceiptsWeb'] as const;
    const before = (await monthRow('shop', '2026-09'))!, shopBefore = await profile('shop');
    assert.equal(before.countersHeld, false);
    // The shop deletes every expense and document of September.
    await client.expenseRecord.deleteMany({ where: { companyId: 'shop', createdAt: { lt: at('2026-10-01T00:00:00Z') } } });
    await client.accountingDocument.deleteMany({ where: { companyId: 'shop' } });

    built(await build.rebuild(minuteLater()));
    const after = (await monthRow('shop', '2026-09'))!, shopAfter = await profile('shop');
    for (const key of COUNTERS) assert.equal(after[key], before[key], key);
    // The counters are held, which is a reason to show (SOURCE_ROWS_PURGED), not a changed figure: no new revision.
    assert.deepEqual({ held: after.countersHeld, group: after.usageGroup, revision: after.revision }, { held: true, group: 'ACTIVE', revision: before.revision });
    assert.deepEqual([shopAfter.firstActivityAt, shopAfter.lastActivityAt, shopAfter.lastLineActivityAt, shopAfter.receiptAdoption, shopAfter.expenseReceiptCountLifetime],
      [shopBefore.firstActivityAt, shopBefore.lastActivityAt, shopBefore.lastLineActivityAt, 'EVER', shopBefore.expenseReceiptCountLifetime]);
    assert.deepEqual([after.receiptsSatang, after.aiCostSatang], [before.receiptsSatang, before.aiCostSatang]);

    // The questions go too. The count of questions stays; AI cost is not such a counter and is recomputed as it is
    // (the cost correction row is all that is left of September), which is a changed figure of a month that is over.
    await client.aiUsageEvent.deleteMany({ where: { companyId: 'shop', eventKind: 'MODEL_CALL' } });
    built(await build.rebuild(minuteLater()));
    const purged = (await monthRow('shop', '2026-09'))!;
    for (const key of COUNTERS) assert.equal(purged[key], before[key], key);
    assert.deepEqual({ cost: purged.aiCostSatang, revision: purged.revision, revisedAt: purged.revisedAt?.toISOString() },
      { cost: -6, revision: before.revision + 1, revisedAt: clock.toISOString() });
    assert.equal((await profile('shop')).lastLineActivityAt?.toISOString(), shopBefore.lastLineActivityAt?.toISOString());
  });

  it('gives a month that is over a new revision when a late movement arrives, and leaves the running month unrevised', async () => {
    const before = (await monthRow('shop', '2026-09'))!, monthBefore = await header('2026-09');
    const edgeBefore = (await monthRow('edge', '2026-09'))!, octoberBefore = (await monthRow('shop', '2026-10'))!;
    // The provider is read again and a September payment turns up that was not there before; October gets one too.
    await receipt('shop', await paidInvoice('shop', 9_900), 9_900, '2026-09-28T04:00:00Z', 648, 300);
    await receipt('shop', await paidInvoice('shop', 1_100), 1_100, '2026-10-12T04:00:00Z');

    built(await build.rebuild(minuteLater()));
    const after = (await monthRow('shop', '2026-09'))!, monthAfter = await header('2026-09'), october = (await monthRow('shop', '2026-10'))!;
    assert.deepEqual({ receipts: after.receiptsSatang, revision: after.revision, revisedAt: after.revisedAt?.toISOString() },
      { receipts: before.receiptsSatang + 9_900, revision: before.revision + 1, revisedAt: clock.toISOString() });
    assert.deepEqual([monthAfter.revision, monthAfter.revisedAt?.toISOString()], [monthBefore.revision + 1, clock.toISOString()]);
    // A company whose figures did not change keeps its revision; the running month changed and is not a revision.
    const edgeAfter = (await monthRow('edge', '2026-09'))!;
    assert.deepEqual([edgeAfter.revision, edgeAfter.revisedAt], [edgeBefore.revision, edgeBefore.revisedAt]);
    assert.deepEqual({ receipts: october.receiptsSatang, revision: october.revision, revisedAt: october.revisedAt },
      { receipts: octoberBefore.receiptsSatang + 1_100, revision: 0, revisedAt: null });
    assert.deepEqual([(await header('2026-10')).revision, (await header('2026-10')).revisedAt], [0, null]);
    // A refund never lowers the month the money came in: refunded in October, September keeps its receipts.
    await refund('shop', await paidInvoice('shop', 9_900), 9_900, '2026-10-13T04:00:00Z');
    built(await build.rebuild(minuteLater()));
    const kept = (await monthRow('shop', '2026-09'))!;
    assert.deepEqual([kept.receiptsSatang, kept.refundsSatang, kept.revision], [after.receiptsSatang, after.refundsSatang, after.revision]);
    assert.equal((await monthRow('shop', '2026-10'))!.refundsSatang, 9_900);
  });

  it('files each company in one payment and usage group, or says which history is missing', async () => {
    // Questions were first kept on 29 July: a shop created before that day may have asked without a trace.
    await aiEvent(PLATFORM_TENANT_ID, '2026-07-29T00:00:00Z');
    const shop = (id: string, data: Record<string, unknown> = {}) => company(id, { reportClassification: 'CUSTOMER', ...data });
    await shop('g-trial'); await term('g-trial', 'FREE_TRIAL_15', 30);
    await expense('g-trial', await person('g-trial'), '2026-09-10T03:00:00Z');
    await shop('g-nopackage'); await term('g-nopackage', 'STARTER_249', 0);
    await shop('g-manual'); await term('g-manual', 'PRO_999', 365, 1);
    await shop('g-legacy');
    await shop('g-notstarted'); await term('g-notstarted', 'STARTER_249', 60, 1);
    await receipt('g-notstarted', await paidInvoice('g-notstarted', 26_643), 26_643, '2026-09-05T04:00:00Z');
    await shop('g-inactive'); await term('g-inactive', 'STARTER_249', 60, 1);
    await receipt('g-inactive', await paidInvoice('g-inactive', 26_643), 26_643, '2026-08-20T04:00:00Z');
    await expense('g-inactive', await person('g-inactive'), '2026-08-25T03:00:00Z');
    await shop('g-refunded'); await term('g-refunded', 'STARTER_249', 60, 1);
    const refunded = await paidInvoice('g-refunded', 26_643, 26_643);
    await receipt('g-refunded', refunded, 26_643, '2026-09-03T04:00:00Z');
    await refund('g-refunded', refunded, 26_643, '2026-09-20T04:00:00Z');
    await shop('g-old', { createdAt: at('2026-06-01T00:00:00Z') }); await term('g-old', 'STARTER_249', 60, 1);
    await receipt('g-old', await paidInvoice('g-old', 26_643), 26_643, '2026-09-04T04:00:00Z');
    await shop('g-latepay'); await term('g-latepay', 'STARTER_249', 60, 1);
    await receipt('g-latepay', await paidInvoice('g-latepay', 26_643), 26_643, '2026-10-05T04:00:00Z');

    assert.equal(built(await build.rebuild(nextDay())).kind, 'FULL');
    const group = async (companyId: string, month: string) => {
      const row = (await monthRow(companyId, month))!;
      return [row.paidEver, row.paidEverReason, row.fullyRefunded, row.usageGroup, row.usageUnassessedReason];
    };
    // Never paid: the free trial and the "no package" marker. Using the product does not make them paid.
    assert.deepEqual(await group('g-trial', '2026-09'), ['NO', null, false, 'NOT_PAID', null]);
    assert.equal((await monthRow('g-trial', '2026-09'))!.activeDays, 1);
    assert.deepEqual(await group('g-nopackage', '2026-09'), ['NO', null, false, 'NOT_PAID', null]);
    // A package the admin set by hand, and a shop from before packages: payment unknown, never guessed either way.
    assert.deepEqual(await group('g-manual', '2026-09'), ['UNKNOWN', 'MANUAL_TERM_NO_RECEIPT', false, null, 'PAYMENT_HISTORY_INCOMPLETE']);
    assert.deepEqual(await group('g-legacy', '2026-09'), ['UNKNOWN', 'LEGACY_NO_TERM', false, null, 'PAYMENT_HISTORY_INCOMPLETE']);
    // Paid and never used, with the whole history in hand: the one "paid, not started" group.
    assert.deepEqual(await group('g-notstarted', '2026-09'), ['YES', null, false, 'NOT_STARTED', null]);
    assert.deepEqual(await group('g-notstarted', '2026-08'), ['NO', null, false, 'NOT_PAID', null]);
    // Used in August, silent since.
    assert.deepEqual(await group('g-inactive', '2026-08'), ['YES', null, false, 'ACTIVE', null]);
    assert.deepEqual(await group('g-inactive', '2026-09'), ['YES', null, false, 'INACTIVE', null]);
    assert.deepEqual(await group('g-inactive', '2026-10'), ['YES', null, false, 'INACTIVE', null]);
    // Everything paid went back: its own label, in no group to follow up.
    assert.deepEqual(await group('g-refunded', '2026-09'), ['YES', null, true, null, null]);
    assert.deepEqual([(await profile('g-refunded')).fullyRefunded, (await profile('g-refunded')).paidEver], [true, 'YES']);
    // Created before questions were kept, and nothing found: not "never used", not assessable.
    assert.deepEqual(await group('g-old', '2026-09'), ['YES', null, false, null, 'ACTIVITY_HISTORY_INCOMPLETE']);
    // Paid in October. August: read whole and nothing untied before it, so not yet paid. September: money no company
    // answers for lies before its end (14 and 19 Sep), which could be this shop's. Today: the invoice says paid.
    assert.deepEqual(await group('g-latepay', '2026-08'), ['NO', null, false, 'NOT_PAID', null]);
    assert.deepEqual(await group('g-latepay', '2026-09'), ['UNKNOWN', 'UNMATCHED_MONEY', false, null, 'PAYMENT_HISTORY_INCOMPLETE']);
    assert.deepEqual(await group('g-latepay', '2026-10'), ['YES', null, false, 'NOT_STARTED', null]);
    assert.deepEqual([(await profile('g-latepay')).paidEver, (await profile('g-manual')).paidEver, (await profile('g-manual')).paidEverReason],
      ['YES', 'UNKNOWN', 'MANUAL_TERM_NO_RECEIPT']);
  });

  it('says "added a receipt" only from evidence, and never "never" for a shop that could not or whose history is short', async () => {
    const shop = (id: string, data: Record<string, unknown> = {}) => company(id, { reportClassification: 'CUSTOMER', ...data });
    // Receipt-reading events were first kept on 27 August.
    await shop('a-ocr');
    await client.companyOcrUsageEvent.create({ data: { companyId: 'a-ocr', monthKey: '2026-08', sourceRoute: 'receipt-ocr-line', requestId: 'r1', createdAt: at('2026-08-27T00:00:00Z') } });
    await shop('a-attach', { createdAt: at('2026-09-02T00:00:00Z') });
    const uploader = await person('a-attach');
    const file = await client.attachmentObject.create({ data: { companyId: 'a-attach', storageProvider: 's3', bucket: 'b', objectKey: next('key'), originalFileName: 'ใบเสร็จ.jpg',
      mimeType: 'image/jpeg', byteSize: 1, uploadedByUserId: uploader } });
    await client.attachmentLink.create({ data: { companyId: 'a-attach', attachmentId: file.id, targetType: 'ExpenseRecord', targetId: 'gone', purpose: 'expense.receipt.primary', linkedByUserId: uploader } });
    await shop('a-never', { createdAt: at('2026-09-02T00:00:00Z') });
    await shop('a-noright', { createdAt: at('2026-08-01T00:00:00Z') });
    await client.companyFeatureEntitlement.create({ data: { companyId: 'a-noright', featureKey: 'expenses', enabled: false } });
    await shop('a-statement');
    await client.companyOcrUsageEvent.create({ data: { companyId: 'a-statement', monthKey: '2026-09', sourceRoute: 'bank-statement-extract', requestId: 'r2', createdAt: at('2026-09-03T00:00:00Z') } });

    built(await build.rebuild(minuteLater()));
    const adoption = async (...ids: string[]) => Promise.all(ids.map(async (id) => (await profile(id)).receiptAdoption));
    assert.deepEqual(await adoption('a-ocr', 'a-attach', 'a-never', 'a-noright', 'a-statement', 'g-notstarted', 'shop'),
      // a-noright was created before the events were kept AND has no right to the feature: "not in the package" wins.
      // a-statement and g-notstarted existed before 27 August with nothing found: not assessable. A bank statement is no receipt.
      ['EVER', 'EVER', 'NEVER', 'NOT_ENTITLED', 'UNKNOWN', 'UNKNOWN', 'EVER']);
    // The reading event is withdrawn (the intake was cancelled) and the link is gone: EVER stays.
    await client.companyOcrUsageEvent.deleteMany({ where: { companyId: 'a-ocr' } });
    await client.attachmentLink.deleteMany({ where: { companyId: 'a-attach' } });
    built(await build.rebuild(minuteLater()));
    assert.deepEqual(await adoption('a-ocr', 'a-attach'), ['EVER', 'EVER']);
  });

  it('keeps the referrer, the credited seller, the channel and the last web entry apart, from the rows that own them', async () => {
    const shop = (id: string, data: Record<string, unknown> = {}) => company(id, { reportClassification: 'CUSTOMER', ...data });
    await client.user.create({ data: { id: 'sales-1', displayName: 'เซลล์หนึ่ง' } });
    await client.salesAgentProfile.create({ data: { userId: 'sales-1', salesCode: 'S001', createdByUserId: 'spec', legalName: 'นาย ชื่อจริง นามสกุลจริง' } });
    await shop('r-known', { referralSalesUserId: 'sales-1', referralSource: 'SIGNUP_CODE' });
    await signup('r-known', '2026-08-10T01:00:00Z', 'official-site', 'SALES');
    await shop('r-unresolved', { referralSalesUserId: 'ghost', referralSource: 'ADMIN' });
    await shop('r-said-sales'); await signup('r-said-sales', '2026-08-10T01:00:00Z', 'official-site', 'SALES');
    await shop('r-admin');
    await shop('r-before', { createdAt: at('2026-07-02T00:00:00Z') }); await signup('r-before', '2026-07-01T00:00:00Z', 'official-site', null);
    await shop('r-noanswer'); await signup('r-noanswer', '2026-09-01T00:00:00Z', 'line-oa', null);
    // Sales credit: counted in the month of the payment, taken back in the month the deduction was recorded; a flagged row waits.
    const credit = await client.salesAttribution.create({ data: { companyId: 'r-known', salesUserId: 'sales-1', source: 'REFERRAL', amountSatang: 24_900,
      paidAt: at('2026-09-10T04:00:00Z'), sourceInvoiceId: 'inv' } });
    await client.salesAttributionDeduction.create({ data: { attributionId: credit.id, kind: 'REFUND', providerRef: 're_spec', amountSatang: 10_000,
      occurredAt: at('2026-10-03T04:00:00Z'), createdAt: at('2026-10-03T05:00:00Z') } });
    await client.salesAttribution.create({ data: { companyId: 'r-unresolved', salesUserId: 'sales-1', source: 'DEAL', amountSatang: 99_900,
      paidAt: at('2026-09-11T04:00:00Z'), sourceInvoiceId: 'inv2', flags: ['SAME_DEVICE'], flaggedAt: at('2026-09-11T04:00:00Z') } });
    // Web entry: a session of a member of this shop only, the LINE-to-web audit row, and a session of someone in two shops.
    const single = await person('r-known'), shared = await person('r-known');
    await client.companyMembership.create({ data: { companyId: 'r-admin', userId: shared } });
    const session = (userId: string, issuedAt: string) => client.authSession.create({ data: { userId, tokenId: next('token'), issuedAt: at(issuedAt), expiresAt: at('2030-01-01T00:00:00Z') } });
    await session(single, '2026-09-20T03:00:00Z');
    await session(shared, '2026-10-10T03:00:00Z');
    await client.auditLog.create({ data: { companyId: 'r-known', action: 'auth.line.liff_session', targetType: 'AuthSession', requestId: 'r', result: 'SUCCESS', createdAt: at('2026-09-25T03:00:00Z') } });
    await client.auditLog.create({ data: { companyId: 'r-known', action: 'expense.confirmed', targetType: 'ExpenseRecord', requestId: 'r', result: 'SUCCESS', createdAt: at('2026-10-11T03:00:00Z') } });
    for (const [code, status] of [['HQ', 'ACTIVE'], ['B2', 'ACTIVE'], ['B3', 'ARCHIVED']] as const) await client.branch.create({ data: { companyId: 'r-known', code, name: code, status } });

    built(await build.rebuild(minuteLater()));
    const dims = async (id: string) => { const row = await profile(id); return [row.discovery, row.signupRail, row.referrerKind, row.referrerSalesUserId, row.referralSource]; };
    assert.deepEqual(await dims('r-known'), ['SALES', 'official-site', 'KNOWN', 'sales-1', 'SIGNUP_CODE']);
    assert.deepEqual(await dims('r-unresolved'), ['ADMIN_CREATED', 'ADMIN_CREATED', 'UNRESOLVED', 'ghost', 'ADMIN']);
    assert.deepEqual(await dims('r-said-sales'), ['SALES', 'official-site', 'UNKNOWN', null, null]);
    assert.deepEqual(await dims('r-admin'), ['ADMIN_CREATED', 'ADMIN_CREATED', 'NONE', null, null]);
    // The first signup that recorded an answer is r-before's neighbour of 9 August; r-before signed up before the question existed.
    assert.deepEqual(await dims('r-before'), ['BEFORE_COLLECTION', 'official-site', 'UNKNOWN', null, null]);
    assert.deepEqual(await dims('r-noanswer'), ['UNKNOWN', 'line-oa', 'NONE', null, null]);

    const known = await profile('r-known'), unresolved = await profile('r-unresolved');
    assert.deepEqual([known.creditedSalesUserId, known.salesCreditState, known.salesCreditPaidAt?.toISOString(), known.branchCount, known.activeMemberCount],
      ['sales-1', 'COUNTED', '2026-09-10T04:00:00.000Z', 2, 2]);
    assert.deepEqual([unresolved.creditedSalesUserId, unresolved.salesCreditState], ['sales-1', 'WAITING']);
    const creditOf = async (id: string, month: string) => { const row = (await monthRow(id, month))!; return [row.salesCreditSatang, row.salesCreditActivations, row.salesCreditWaiting]; };
    assert.deepEqual(await creditOf('r-known', '2026-09'), [24_900, 1, 0]);
    assert.deepEqual(await creditOf('r-known', '2026-10'), [-10_000, 0, 0]);
    assert.deepEqual(await creditOf('r-unresolved', '2026-09'), [0, 0, 1]);
    // The audit row of 25 Sep beats the single-shop session of 20 Sep; the two-shop session of 10 Oct and other audit rows do not count.
    assert.equal(known.lastWebEntryAt?.toISOString(), '2026-09-25T03:00:00.000Z');
    assert.equal((await profile('r-admin')).lastWebEntryAt, null);
  });

  it('builds a whole new set for a new definition version and leaves the old one alone', async () => {
    const old = JSON.stringify(await client.executiveCompanyMonth.findMany({ where: { definitionVersion: 1 }, orderBy: [{ month: 'asc' }, { companyId: 'asc' }] }));
    const result = built(await build.rebuild(minuteLater(), 2));
    // No full round of version 2 exists yet, so this one is full although version 1 already had its full round today.
    assert.equal(result.kind, 'FULL');
    assert.equal(result.months[0], '2026-01');
    // The months every round builds hold the same companies in both sets.
    const [versionOne, versionTwo] = await Promise.all([1, 2].map((definitionVersion) => client.executiveCompanyMonth.count({ where: { definitionVersion, month: { in: ['2026-09', '2026-10'] } } })));
    assert.ok(versionOne > 40);
    assert.equal(versionTwo, versionOne);
    assert.equal(JSON.stringify(await client.executiveCompanyMonth.findMany({ where: { definitionVersion: 1 }, orderBy: [{ month: 'asc' }, { companyId: 'asc' }] })), old);
    // A counter whose source rows are gone keeps the value the old set recorded, and says so (SOURCE_ROWS_PURGED).
    const [one, two] = [(await monthRow('shop', '2026-09', 1))!, (await monthRow('shop', '2026-09', 2))!];
    assert.deepEqual([two.activeDays, two.confirmedExpensesWeb, two.aiRequests, two.countersHeld, two.revision], [one.activeDays, one.confirmedExpensesWeb, one.aiRequests, true, 0]);
    assert.equal(two.receiptsSatang, one.receiptsSatang);
    assert.deepEqual([(await header('2026-09', 2)).revision, (await header('2026-09', 2)).revisedAt], [0, null]);
    const round = await client.executiveReportBuild.findUniqueOrThrow({ where: { id: result.buildId } });
    assert.deepEqual([round.definitionVersion, round.dimensionVersion], [2, 1]);
  });

  it('marks the months that began before the first build, and reads a month back once a day', async () => {
    // Every month built so far began before the first build of 15 October: its counters hold what still existed then.
    const soFar = await client.executiveReportMonth.findMany({ where: { definitionVersion: 1 }, orderBy: { month: 'asc' } });
    assert.deepEqual([soFar[0]!.month, soFar.at(-1)!.month, soFar.length, soFar.every((row) => row.beforeFirstBuild)], ['2026-01', '2026-10', 10, true]);
    // 2 November: a new day and a new month. The full round goes back to the platform company's January.
    clock = at('2026-11-02T03:00:00.000Z');
    const result = built(await build.rebuild(clock));
    assert.deepEqual([result.kind, result.months[0], result.months.at(-1), result.months.length], ['FULL', '2026-01', '2026-11', 11]);
    assert.equal((await header('2026-11')).beforeFirstBuild, false);
    assert.equal((await header('2026-10')).beforeFirstBuild, true);
    assert.equal((await monthRow(PLATFORM_TENANT_ID, '2026-01'))!.reportClassification, 'INTERNAL');
    assert.equal(await monthRow('shop', '2026-07'), null); // not yet registered in July
    // October is over now, and the provider was read only up to the 15th: a shop with a paid invoice and no dated receipt
    // before October's end cannot be called "not yet paid" for October.
    await company('g-unread', { reportClassification: 'CUSTOMER', createdAt: at('2026-10-20T00:00:00Z') });
    await paidInvoice('g-unread', 26_643);
    built(await build.rebuild(minuteLater()));
    const october = (await monthRow('g-unread', '2026-10'))!;
    assert.deepEqual([october.paidEver, october.paidEverReason, october.usageUnassessedReason], ['UNKNOWN', 'BILLING_SCAN_NOT_COMPLETE', 'PAYMENT_HISTORY_INCOMPLETE']);
    assert.equal((await monthRow('g-unread', '2026-11'))!.paidEver, 'YES');
    const octoberHeader = await header('2026-10');
    assert.ok(octoberHeader.billingCoveredThrough! < executiveMonthRange('2026-10').end, 'October was not read whole');

    // The rest of October is read now: the money of its last days arrives after the month ended. That completes the
    // month's first final answer; it is not a revision, or every month would carry the label on its first morning.
    await scan('2026-10-14T17:00:00Z', '2026-11-01T17:00:00Z');
    await receipt('shop', await paidInvoice('shop', 2_200), 2_200, '2026-10-30T04:00:00Z');
    built(await build.rebuild(minuteLater()));
    const settled = await header('2026-10'), shopOctober = (await monthRow('shop', '2026-10'))!;
    assert.equal(settled.billingCoveredThrough?.toISOString(), '2026-11-01T17:00:00.000Z');
    assert.deepEqual([settled.revision, settled.revisedAt, shopOctober.revision, shopOctober.revisedAt], [octoberHeader.revision, octoberHeader.revisedAt, 0, null]);
    // Read whole, the reason changes: what is left in doubt is the money of September that no company answers for.
    assert.deepEqual([(await monthRow('g-unread', '2026-10'))!.paidEver, (await monthRow('g-unread', '2026-10'))!.paidEverReason], ['UNKNOWN', 'UNMATCHED_MONEY']);
    // From here on October is final: a movement that turns up later is a revision with its date.
    await receipt('shop', await paidInvoice('shop', 3_300), 3_300, '2026-10-31T04:00:00Z');
    built(await build.rebuild(minuteLater()));
    const revised = (await monthRow('shop', '2026-10'))!;
    assert.deepEqual([revised.receiptsSatang, revised.revision, revised.revisedAt?.toISOString(), (await header('2026-10')).revision],
      [shopOctober.receiptsSatang + 3_300, 1, clock.toISOString(), settled.revision + 1]);
  });

  it('stores no name, e-mail, phone or free text of anyone', async () => {
    const stored = JSON.stringify([await client.executiveCompanyMonth.findMany(), await client.executiveCompanyProfile.findMany(),
      await client.executiveReportMonth.findMany(), await client.executiveReportBuild.findMany()]);
    for (const secret of ['ร้าน', 'คุณ', '@example.test', '0812345678', 'ถนนลับ', 'ข้อความที่ลูกค้าพิมพ์เอง', 'ชื่อในคำขอสมัคร', 'เจ้าของในคำขอ', 'เซลล์หนึ่ง', 'ชื่อจริง', 'ใบเสร็จ.jpg', 'เชียงใหม่'])
      assert.equal(stored.includes(secret), false, `a summary table holds "${secret}"`);
    // What it does hold of a company: internal ids and codes.
    assert.ok(stored.includes('"provinceCode":"50"') && stored.includes('"referrerSalesUserId":"sales-1"'));
  });

  it('answers the worker endpoint only with the worker token', async () => {
    const token = process.env.WORKER_INTERNAL_TOKEN;
    process.env.WORKER_INTERNAL_TOKEN = 'executive-spec-token';
    try {
      const controller = new ExecutiveInternalController(build);
      const builds = await client.executiveReportBuild.count();
      for (const wrong of [undefined, '', 'nope']) assert.throws(() => controller.rebuild(wrong), /Invalid worker token/);
      assert.equal(await client.executiveReportBuild.count(), builds);
      const result = await controller.rebuild('executive-spec-token');
      assert.equal(result.status, 'BUILT');
      assert.equal(await client.executiveReportBuild.count(), builds + 1);
    } finally {
      if (token === undefined) delete process.env.WORKER_INTERNAL_TOKEN; else process.env.WORKER_INTERNAL_TOKEN = token;
    }
  });

  // Plan §2.1 row 11, spec §13.3: cancelling a confirmed expense must not erase that it was confirmed. Run through the
  // expense module's own void transaction (`voidExpenseTrueReversal`, which the web void and a claim cancellation both
  // end in for a confirmed expense), on real PostgreSQL, so a trigger or a later write would show too.
  it('builds owner-approved purchase kinds with every receipt and refund in exactly one kind', async () => {
    const cases = [
      ['SCHEDULED_CHANGE', false, null, 'RENEWAL'],
      ['INITIAL', true, '2026-09-20T03:00:00Z', 'RENEWAL'],
      ['INITIAL', true, '2026-09-01T03:00:00Z', 'RETURN'],
      ['INITIAL', true, null, 'FIRST_PURCHASE'],
      ['INITIAL', false, null, 'FIRST_PURCHASE'],
      [null, false, null, 'RENEWAL'],
      ['RESTART', false, null, 'RETURN'],
    ] as const;
    const ids: string[] = [];
    for (const [kind, deal, previousEnd] of cases) {
      const id = next('owner-answer'); ids.push(id);
      await company(id, { reportClassification: 'CUSTOMER' });
      const invoiceId = await paidInvoice(id, 10000);
      const invoice = await client.billingInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
      const dealId = next('deal');
      await client.billingAttempt.update({ where: { id: invoice.sourceAttemptId! }, data: { quoteSnapshot: {
        quote: { purchase: { kind: kind ?? 'INITIAL' } }, ...(deal ? { deal: { requestId: dealId } } : {}),
        ...(deal && previousEnd ? { subscriptionConversion: { subscriptionId: 'old-sub', paidThrough: previousEnd } } : {}),
      } } });
      await client.billingInvoice.update({ where: { id: invoiceId }, data: { applyStatus: 'APPLIED', appliedAt: at('2026-10-01T03:00:00Z'),
        ...(kind ? {} : { sourceAttemptId: null, subscriptionId: 'cycle-sub' }) } });
      if (previousEnd) await client.billingInvoice.create({ data: { billingAccountId: invoice.billingAccountId,
        providerInvoiceId: `in_${randomUUID()}`, offerSnapshot: {}, policyRevisionId: 'p', currency: 'THB', totalSatang: 5000, paidSatang: 5000,
        periodStart: at('2026-08-01T00:00:00Z'), periodEnd: at(previousEnd), providerStatus: 'paid', evidenceHash: 'h',
        applyStatus: 'APPLIED', appliedAt: at('2026-08-01T00:00:00Z') } });
      if (deal) await client.packageChangeRequest.create({ data: { id: dealId, companyId: id, requestedByUserId: 'spec', requestedTierKey: 'BASIC',
        kind: 'SALES_DEAL', status: 'APPLIED', paymentRef: invoiceId, verifiedAt: at('2026-09-15T03:00:00Z') } });
      await receipt(id, invoiceId, 10000, '2026-09-15T03:00:00Z');
      await refund(id, invoiceId, 1000, '2026-09-29T03:00:00Z');
    }
    built(await build.rebuild(nextDay()));
    for (const [index, [, , , expected]] of cases.entries()) {
      const row = (await monthRow(ids[index]!, '2026-09'))!;
      assert.equal(row.receiptsSatang, 10000);
      assert.equal(row.refundsSatang, 1000);
      assert.deepEqual(row.moneyByPurchaseKind, { [expected]: { receiptsSatang: 10000, refundsSatang: 1000, feesSatang: 0, taxSatang: 0 } });
    }
  });

  it('keeps the confirm action of an expense that is voided afterwards', async () => {
    const shop = next('voided-shop');
    await company(shop, { reportClassification: 'CUSTOMER' });
    const userId = await person(shop);
    // The clock is in November 2026 by now (the test above moved it), so an hourly round builds October and November.
    const confirmedAt = '2026-10-20T05:00:00.000Z';
    const row = await client.expenseRecord.create({ data: { companyId: shop, expenseDate: at(confirmedAt), createdByUserId: userId, confirmedByUserId: userId,
      confirmedAt: at(confirmedAt), captureSource: 'WEB_MANUAL', status: 'CONFIRMED', createdAt: at(confirmedAt) } });
    const voided = await new PrismaExpenseRepository({ client } as never).voidExpenseTrueReversal(shop, row.id, userId, 'บันทึกซ้ำ ยกเลิกรายการนี้');
    assert.equal(voided.expense.status, 'VOIDED');
    const stored = await client.expenseRecord.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.status, 'VOIDED');
    assert.ok(stored.voidedAt);
    assert.equal(stored.confirmedAt?.toISOString(), confirmedAt);
    assert.equal(stored.confirmedByUserId, userId);
    // This shop is new to the build, so nothing is held from an earlier round: the count below is the voided row's own.
    assert.equal(await client.executiveCompanyMonth.count({ where: { companyId: shop } }), 0);
    await build.rebuild(minuteLater());
    const october = await client.executiveCompanyMonth.findUniqueOrThrow({ where: { companyId_month_definitionVersion: { companyId: shop, month: '2026-10', definitionVersion: 1 } } });
    assert.deepEqual([october.confirmedExpensesWeb, october.activeDays, october.countersHeld], [1, 1, false]);
  });
  it('backfills cutoff last-use dates, rolling receipt boundaries and bucket-edge sheet facts in a FULL build', async () => {
    const asOf = nextDay(), since7 = new Date(bangkokDayStart(asOf).getTime() - 6 * 86_400_000), since30 = new Date(bangkokDayStart(asOf).getTime() - 29 * 86_400_000);
    const receiptMonths = new Set<string>();
    for (const n of [0, 1, 5, 6]) {
      const id = `sheet-${n}`; await company(id, { reportClassification: 'CUSTOMER', createdAt: at('2026-08-10T00:00:00Z'), businessTypeCode: 'OTHER', businessTypeOther: 'ค้าปลีก' });
      const user = await person(id);
      if (n === 6) await client.user.update({ where: { id: user }, data: { status: 'DISABLED' } });
      await document(id, user, '2026-08-30T17:00:00Z'); // Aug31, counted use, not a receipt
      for (let i = 0; i < n; i++) {
        const createdAt = n === 1 ? new Date(asOf.getTime() - 1) : n === 6 && i === 0 ? new Date(since30.getTime() - 1) : n === 6 && i === 5 ? since7 : new Date(since30.getTime() + i * 86_400_000);
        if (n === 6) receiptMonths.add(executiveMonthOf(createdAt));
        const row = await expense(id, user, null, 'WEB_UPLOAD', createdAt.toISOString());
        if (i === 1) await client.expenseRecord.update({ where: { id: row.id }, data: { status: 'NEEDS_REVIEW' } });
      }
    }
    await aiEvent('sheet-6', new Date(asOf.getTime() - 1).toISOString());
    const result = built(await build.rebuild(asOf)); assert.equal(result.kind, 'FULL');
    assert.ok(result.months.includes('2026-09'));
    const firstBuildAt = (await client.executiveReportBuild.aggregate({ _min: { asOf: true } }))._min.asOf!;
    for (const n of [0,1,5,6]) {
      const p = await profile(`sheet-${n}`), september = (await monthRow(p.companyId, '2026-09'))!, facts = p.sheetFacts as any;
      assert.equal(p.expenseReceiptCountLifetime, n); assert.equal(p.businessTypeOther, 'ค้าปลีก'); assert.equal(p.activeMemberCount, n === 6 ? 0 : 1);
      assert.equal(september.lastActivityAt!.toISOString(), '2026-08-30T17:00:00.000Z'); assert.equal(september.activitySnapshotReady, true);
      assert.equal(Object.hasOwn(facts, 'asOf'), false); assert.equal(facts.sourceCount, n);
      assert.equal(facts.aiRequests30, n === 6 ? 1 : 0);
      assert.ok(september.activityHistorySince! >= firstBuildAt);
      assert.ok(new Date(facts.activityHistorySince) >= firstBuildAt);
      assert.equal(facts.receipts30, n === 6 ? 5 : n); assert.equal(facts.receipts7, n === 1 || n === 6 ? 1 : 0);
      assert.equal(facts.receiptDays30, n === 6 ? 5 : n); assert.equal(facts.pending, n >= 5 ? 1 : 0); assert.equal(facts.draft, n - facts.pending);
    }
    const id = 'sheet-6', stored = (await profile(id)).sheetFacts as any;
    await client.expenseRecord.deleteMany({ where: { companyId: id } });
    await build.rebuild(minuteLater());
    const after = await profile(id), facts = after.sheetFacts as any;
    assert.equal(after.expenseReceiptCountLifetime, 6); assert.equal(facts.lastReceiptAt, stored.lastReceiptAt); assert.equal(facts.receipts7, 1); assert.equal(facts.sourceCount, 0);
    assert.deepEqual(facts.purgedReceiptMonths, [...receiptMonths].sort());
    assert.equal((await monthRow(id, '2026-09'))!.lastActivityAt!.toISOString(), '2026-08-30T17:00:00.000Z');
    // Legacy held usage has no date until a later observed action supersedes its whole month.
    await client.executiveCompanyMonth.update({ where: { companyId_month_definitionVersion: { companyId: id, month: '2026-08', definitionVersion: 1 } }, data: { activitySnapshotReady: false, lastActivityAt: null } });
    await client.accountingDocument.deleteMany({ where: { companyId: id } });
    assert.equal(built(await build.rebuild(nextDay())).kind, 'FULL'); // September is outside the current hourly window.
    assert.equal((await monthRow(id, '2026-09'))!.activitySnapshotReady, false);
    const staff = (await client.companyMembership.findFirstOrThrow({ where: { companyId: id } })).userId;
    await document(id, staff, new Date(clock.getTime() - 1).toISOString());
    await build.rebuild(minuteLater());
    assert.equal((await monthRow(id, executiveMonthOf(clock)))!.activitySnapshotReady, true);
    assert.equal((await profile(id)).sheetFacts && ((await profile(id)).sheetFacts as any).activitySnapshotReady, true);
  });
  it('keeps rolling facts unchanged within a Bangkok date and ages them at midnight without new source rows', async () => {
    const id = 'sheet-clock'; await company(id, { reportClassification: 'CUSTOMER' });
    const user = await person(id), day = bangkokDayStart(clock);
    for (const days of [6, 29]) await expense(id, user, null, 'WEB_UPLOAD', new Date(day.getTime() - days * 86_400_000).toISOString());
    await build.rebuild(minuteLater());
    const before = (await profile(id)).sheetFacts as any;
    assert.deepEqual([before.receipts7, before.receipts30], [1, 2]);
    await build.rebuild(minuteLater());
    assert.deepEqual((await profile(id)).sheetFacts, before);
    await build.rebuild(nextDay());
    const after = (await profile(id)).sheetFacts as any;
    assert.deepEqual([after.receipts7, after.receipts30], [0, 1]);
    assert.equal((await profile(id)).expenseReceiptCountLifetime, 2);
  });

});

// ── The rules, with no database (executive backend spec §12.1, §12.3, §13.2, §13.4, §15) ──────────────

describe('executive report rules', () => {
  it('cuts a Bangkok month and day at the right UTC instants', () => {
    // The spec's own example: September 2026 is [2026-08-31T17:00:00Z, 2026-09-30T17:00:00Z).
    assert.deepEqual(Object.values(executiveMonthRange('2026-09')).map((value) => value.toISOString()), ['2026-08-31T17:00:00.000Z', '2026-09-30T17:00:00.000Z']);
    assert.deepEqual(Object.values(executiveMonthRange('2026-12')).map((value) => value.toISOString()), ['2026-11-30T17:00:00.000Z', '2026-12-31T17:00:00.000Z']);
    assert.equal(executiveMonthOf(at('2026-09-30T16:59:59.999Z')), '2026-09');
    assert.equal(executiveMonthOf(at('2026-09-30T17:00:00.000Z')), '2026-10');
    assert.equal(executiveMonthOf(at('2026-12-31T17:00:00.000Z')), '2027-01');
    assert.deepEqual(executiveMonths('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
    assert.deepEqual(executiveMonths('2026-09', '2026-09'), ['2026-09']);
    assert.equal(bangkokDayStart(at('2026-10-15T03:00:00.000Z')).toISOString(), '2026-10-14T17:00:00.000Z');
    assert.equal(bangkokDayStart(at('2026-10-14T16:59:59.999Z')).toISOString(), '2026-10-13T17:00:00.000Z');
    assert.equal(bangkokDayStart(at('2026-10-14T17:00:00.000Z')).toISOString(), '2026-10-14T17:00:00.000Z');
  });

  it('decides "paid ever" by the first rule that fits (spec §13.2)', () => {
    const nothing = { receiptBeforeCutoff: false, paidInvoiceNow: false, monthIsCurrent: true, billingReadToCutoff: true, untiedReceiptBeforeCutoff: false,
      sourceWithoutInvoice: null, term: null };
    const running = { termStartAt: at('2026-09-01T00:00:00Z'), termEndsAt: at('2026-10-01T00:00:00Z'), renewCount: 1 };
    const noPackage = { termStartAt: at('2026-09-01T00:00:00Z'), termEndsAt: at('2026-09-01T00:00:00Z'), renewCount: 0 };
    const decide = (change: Partial<Parameters<typeof decidePaidEver>[0]>) => { const result = decidePaidEver({ ...nothing, ...change }); return `${result.value} ${result.reason ?? '-'}`; };
    // 1. A dated receipt, or (for today) a paid invoice.
    assert.equal(decide({ receiptBeforeCutoff: true, sourceWithoutInvoice: 'SOURCE_INCONSISTENT' }), 'YES -');
    assert.equal(decide({ paidInvoiceNow: true }), 'YES -');
    // An invoice proves "paid by now". For a month that is over it needs the provider read whole and nothing untied before the month's end.
    assert.equal(decide({ paidInvoiceNow: true, monthIsCurrent: false }), 'NO -');
    assert.equal(decide({ paidInvoiceNow: true, monthIsCurrent: false, billingReadToCutoff: false }), 'UNKNOWN BILLING_SCAN_NOT_COMPLETE');
    assert.equal(decide({ paidInvoiceNow: true, monthIsCurrent: false, untiedReceiptBeforeCutoff: true }), 'UNKNOWN UNMATCHED_MONEY');
    // 2. Billing itself calls the company a case for review.
    for (const source of ['PAID_OTHER_MODE', 'SOURCE_INCONSISTENT', 'PAID_CURRENT_MODE', 'PAID_EXPIRED_CURRENT_MODE'] as const)
      assert.equal(decide({ sourceWithoutInvoice: source, term: running }), 'UNKNOWN BILLING_SOURCE_REVIEW');
    // 3. Never bought, or on the free trial.
    assert.equal(decide({ sourceWithoutInvoice: 'TRIAL', term: running }), 'NO -');
    assert.equal(decide({ sourceWithoutInvoice: 'ADMIN_MANUAL', term: noPackage }), 'NO -');
    // 4. A package the admin set by hand. ADMIN_MANUAL alone never decides: only the term row tells it from rule 3.
    assert.equal(decide({ sourceWithoutInvoice: 'ADMIN_MANUAL', term: running }), 'UNKNOWN MANUAL_TERM_NO_RECEIPT');
    assert.equal(decide({ sourceWithoutInvoice: 'ADMIN_MANUAL', term: { ...noPackage, renewCount: 1 } }), 'UNKNOWN MANUAL_TERM_NO_RECEIPT');
    // 5. No term at all.
    assert.equal(decide({ sourceWithoutInvoice: 'NO_TERM' }), 'UNKNOWN LEGACY_NO_TERM');
    assert.equal(decide({}), 'UNKNOWN LEGACY_NO_TERM');
  });

  it('files a company in exactly one usage group or names the missing history (spec §13.2)', () => {
    const base = { paidEver: 'YES' as const, fullyRefunded: false, activeInMonth: false, usedBeforeCutoff: false, monthHistoryComplete: true, historyCompleteSinceSignup: true };
    const decide = (change: Partial<Parameters<typeof decideUsageGroup>[0]>) => { const result = decideUsageGroup({ ...base, ...change }); return `${result.usageGroup ?? '-'} ${result.reason ?? '-'}`; };
    assert.equal(decide({ paidEver: 'NO', activeInMonth: true }), 'NOT_PAID -');
    assert.equal(decide({ paidEver: 'UNKNOWN', activeInMonth: true }), '- PAYMENT_HISTORY_INCOMPLETE');
    assert.equal(decide({ fullyRefunded: true, activeInMonth: true }), '- -');
    assert.equal(decide({ activeInMonth: true, monthHistoryComplete: false }), 'ACTIVE -');
    assert.equal(decide({ usedBeforeCutoff: true }), 'INACTIVE -');
    assert.equal(decide({ usedBeforeCutoff: true, monthHistoryComplete: false }), '- ACTIVITY_HISTORY_INCOMPLETE');
    assert.equal(decide({}), 'NOT_STARTED -');
    assert.equal(decide({ historyCompleteSinceSignup: false }), '- ACTIVITY_HISTORY_INCOMPLETE');
    // Being used earlier is positive evidence: a short history does not turn INACTIVE into "not assessable".
    assert.equal(decide({ usedBeforeCutoff: true, historyCompleteSinceSignup: false }), 'INACTIVE -');
  });

  it('answers receipt adoption in the order of spec §13.4', () => {
    const since = at('2026-08-27T00:00:00Z'), old = at('2026-08-01T00:00:00Z'), fresh = at('2026-08-27T00:00:00Z');
    assert.equal(decideReceiptAdoption({ evidence: true, entitled: false, createdAt: old, ocrUsageSince: since }), 'EVER');
    assert.equal(decideReceiptAdoption({ evidence: false, entitled: false, createdAt: old, ocrUsageSince: since }), 'NOT_ENTITLED');
    assert.equal(decideReceiptAdoption({ evidence: false, entitled: true, createdAt: old, ocrUsageSince: since }), 'UNKNOWN');
    assert.equal(decideReceiptAdoption({ evidence: false, entitled: true, createdAt: fresh, ocrUsageSince: since }), 'NEVER');
    assert.equal(decideReceiptAdoption({ evidence: false, entitled: true, createdAt: old, ocrUsageSince: null }), 'NEVER');
  });

  it('reads discovery, the signup rail and the referrer from the original signup (spec §15)', () => {
    const since = at('2026-09-17T19:00:00Z');
    const request = (discoverySource: string | null, createdAt: string, source = 'official-site') => ({ source, discoverySource, createdAt: at(createdAt) });
    assert.equal(decideDiscovery(null, since), 'ADMIN_CREATED');
    for (const value of ['WEBSITE', 'IG', 'TIKTOK', 'FACEBOOK', 'SALES', 'OTHER']) assert.equal(decideDiscovery(request(value, '2026-09-20T00:00:00Z'), since), value);
    assert.equal(decideDiscovery(request(null, '2026-09-17T19:00:00Z'), since), 'UNKNOWN');
    assert.equal(decideDiscovery(request(null, '2026-09-17T18:59:59Z'), since), 'BEFORE_COLLECTION');
    assert.equal(decideDiscovery(request(null, '2026-09-20T00:00:00Z'), null), 'BEFORE_COLLECTION');
    assert.equal(decideDiscovery(request('BILLBOARD', '2026-09-20T00:00:00Z'), since), 'UNKNOWN'); // a value the contract does not know is not passed on
    assert.deepEqual([null, 'official-site', 'line-oa', 'email-otp', 'partner-api'].map((source) => decideSignupRail(source ? request(null, '2026-09-20T00:00:00Z', source) : null)),
      ['ADMIN_CREATED', 'official-site', 'line-oa', 'email-otp', 'UNKNOWN']);
    assert.equal(decideReferrer({ referralSalesUserId: 'u1', salesProfileExists: true, discovery: 'WEBSITE' }), 'KNOWN'); // the admin's later entry shows as it is
    assert.equal(decideReferrer({ referralSalesUserId: 'u1', salesProfileExists: false, discovery: 'SALES' }), 'UNRESOLVED');
    assert.equal(decideReferrer({ referralSalesUserId: null, salesProfileExists: false, discovery: 'SALES' }), 'UNKNOWN');
    assert.equal(decideReferrer({ referralSalesUserId: null, salesProfileExists: false, discovery: 'BEFORE_COLLECTION' }), 'UNKNOWN');
    for (const discovery of ['WEBSITE', 'OTHER', 'UNKNOWN', 'ADMIN_CREATED']) assert.equal(decideReferrer({ referralSalesUserId: null, salesProfileExists: false, discovery }), 'NONE');
  });

  it('keeps the larger counter, revises only a month that was over, and refuses a number that does not fit', () => {
    const kept = keepLargerCounters({ ...NO_USAGE, activeDays: 3, aiRequests: 9 }, { activeDays: 5, aiRequests: 2, issuedDocuments: 1 });
    assert.deepEqual([kept.counters.activeDays, kept.counters.aiRequests, kept.counters.issuedDocuments, kept.held], [5, 9, 1, true]);
    assert.equal(keepLargerCounters({ ...NO_USAGE, activeDays: 3 }, { activeDays: 3 }).held, false);
    assert.equal(keepLargerCounters({ ...NO_USAGE, activeDays: 3 }, null).held, false);

    const asOf = at('2026-10-15T03:00:00Z'), revisedAt = at('2026-10-02T00:00:00Z');
    assert.deepEqual(nextRevision(null, true, asOf), { revision: 0, revisedAt: null });
    assert.deepEqual(nextRevision({ revision: 2, revisedAt, wasFinished: true }, true, asOf), { revision: 3, revisedAt: asOf });
    assert.deepEqual(nextRevision({ revision: 2, revisedAt, wasFinished: true }, false, asOf), { revision: 2, revisedAt });
    // The month was still running when it was last built: its first finished answer is not a revision of anything.
    assert.deepEqual(nextRevision({ revision: 0, revisedAt: null, wasFinished: false }, true, asOf), { revision: 0, revisedAt: null });

    const row: CompanyMonthFigures = { ...NO_USAGE, reportClassification: 'CUSTOMER', receiptsSatang: 100, refundsSatang: 0, feesSatang: 4, taxSatang: 7,
      moneyByPurchaseKind: { RENEWAL: { receiptsSatang: 60, refundsSatang: 0, feesSatang: 2, taxSatang: 4 }, UPGRADE: { receiptsSatang: 40, refundsSatang: 0, feesSatang: 2, taxSatang: 3 } },
      disputedInvoiceCount: 0, aiCostSatang: 0, countersHeld: false, paidEver: 'YES', paidEverReason: null, fullyRefunded: false, usageGroup: 'ACTIVE', usageUnassessedReason: null,
      salesCreditSatang: 0, salesCreditActivations: 0, salesCreditWaiting: 0 };
    const reordered = { ...row, moneyByPurchaseKind: { UPGRADE: row.moneyByPurchaseKind.UPGRADE!, RENEWAL: row.moneyByPurchaseKind.RENEWAL! } };
    assert.notEqual(figuresKey({ ...row, lastActivityAt: at('2026-08-01T00:00:00Z') } as CompanyMonthFigures), figuresKey({ ...row, lastActivityAt: at('2026-08-02T00:00:00Z') } as CompanyMonthFigures));
    assert.notEqual(figuresKey({ ...row, activitySnapshotReady: true } as CompanyMonthFigures), figuresKey(row));
    assert.equal(figuresKey(reordered), figuresKey(row));
    assert.equal(figuresKey({ ...row, countersHeld: true }), figuresKey(row));
    assert.notEqual(figuresKey({ ...row, receiptsSatang: 101 }), figuresKey(row));
    assert.notEqual(figuresKey({ ...row, reportClassification: 'TEST' }), figuresKey(row));
    assert.notEqual(figuresKey({ ...row, moneyByPurchaseKind: { ...row.moneyByPurchaseKind, RENEWAL: { receiptsSatang: 61, refundsSatang: 0, feesSatang: 2, taxSatang: 4 } } }), figuresKey(row));

    assert.equal(int32(2_147_483_647, 'x'), 2_147_483_647);
    for (const bad of [2_147_483_648, -2_147_483_649, 1.5, Number.NaN]) assert.throws(() => int32(bad, 'receiptsSatang'), /executive\.build_value_out_of_range:receiptsSatang/);
  });
});
