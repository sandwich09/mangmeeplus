/**
 * The executive report's read API (executive backend spec §16.1 API01–API06; plan §2 stage S3, §4.2) on real PostgreSQL.
 *
 * The rows are written by the real build (`ExecutiveReportBuildUseCase`) from real source rows, then read by the real read
 * service, so what is proven here is the whole path a screen gets: every card and group row opens a list of exactly its
 * count and money (RB-19), the population and its exclusions, money and usage coverage, the payment and usage groups, the
 * customers who pay the most with ties at the edge, rankings, search/sort/paging, the company detail with and without the
 * right to see contact data, the company history, and the audit rows the reads leave.
 *
 * It builds its own scratch database from the real migration files on the given server and drops it afterwards. The rule
 * tables at the bottom need no database and run wherever this file runs.
 *
 * Run with (any database on a disposable local server; it is only used to create the scratch one):
 *   EXECUTIVE_REPORT_READ_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     npx tsx --test src/modules/executive-business/executive-report-read.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import type { ExecutiveCount, ExecutiveDrilldownFilters } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import { AuditService } from '../audit/application/audit.service';
import { PrismaAuditRepository } from '../audit/infrastructure/prisma-audit.repository';
import type { RequestContext } from '../auth/domain/models/request-context.model';
import { BillingCashMovementsService } from '../billing/application/billing-cash-movements.service';
import { PLATFORM_TENANT_ID } from '../sales-console/application/sales-context';
import { ExecutiveReportBuildUseCase } from './application/executive-report-build.use-case';
import { ExecutiveReportReadService } from './application/executive-report-read.service';
import { combined, countOf, moneyCoverageOf, ranksOf, roundRatio, roundingNote, shareOf, sortedBy, spendGroupsOf, usageCoverageOf, type ReportRow } from './domain/executive-read.logic';
import { executiveMonthOf, executiveMonthRange } from './domain/executive-report.logic';

const databaseUrl = process.env.EXECUTIVE_REPORT_READ_TEST_DATABASE_URL;
const MIGRATIONS = join(__dirname, '..', '..', '..', 'prisma', 'migrations');
const at = (iso: string) => new Date(iso);
const seconds = (iso: string) => Date.parse(iso) / 1000;
const STRIPE = 'acct_executive_read_spec';
/** 15 October 2026, 10:00 in Bangkok: October is running, September is over. */
const NOW = at('2026-10-15T03:00:00.000Z');
/** The first build ran before any shop existed: months that begin after it hold every usage row. */
const FIRST_BUILD = at('2026-08-05T03:00:00.000Z');
const SEPTEMBER = executiveMonthRange('2026-09');
const valueOf = (count: ExecutiveCount) => count.value ?? count.knownValue ?? null;
const statusOf = (error: unknown) => (error as { getStatus?: () => number }).getStatus?.();
const codeOf = (error: unknown) => ((error as { getResponse?: () => { code?: string } }).getResponse?.() ?? {}).code;

describe('executive report read API on real PostgreSQL', { skip: !databaseUrl }, () => {
  let admin: Client;
  let client: PrismaClient;
  let report: ExecutiveReportReadService;
  let scratch: string;
  let scanJob: string;
  let firstBuildId: string;
  let ownerRoleId: string;
  let sequence = 0;
  let clock = NOW;
  const next = (prefix: string) => `${prefix}-${++sequence}`;
  const reader = (permissions: string[] = ['system.executive.read']): RequestContext => ({ requestId: next('request'), authSubject: 'reader', userId: 'exec-reader',
    companyId: PLATFORM_TENANT_ID, membershipId: 'membership-reader', roles: [], permissions, scopes: {}, authProvider: 'watchdog' });
  const contactReader = () => reader(['system.executive.read', 'system.executive.contact.read']);

  // ── Fixtures: the smallest rows each source table accepts ──
  const company = (id: string, data: Record<string, unknown> = {}) =>
    client.company.create({ data: { id, name: `ร้าน ${id}`, createdAt: at('2026-08-10T02:00:00Z'), ...data } });
  const chiangMai = { line1: '1 ถนนลับ', subdistrict: 'ศรีภูมิ', district: 'เมืองเชียงใหม่', province: 'จังหวัดเชียงใหม่', postalCode: '50200' };
  const shop = (id: string, data: Record<string, unknown> = {}) => company(id, { reportClassification: 'CUSTOMER', addressJson: chiangMai, ...data });
  const person = async (companyId: string, options: { owner?: boolean; email?: string; phone?: string } = {}) => {
    const id = next('user');
    await client.user.create({ data: { id, displayName: `คุณ ${id}`, email: options.email ?? null, phoneNumber: options.phone ?? null } });
    const membership = await client.companyMembership.create({ data: { companyId, userId: id } });
    if (options.owner) await client.membershipRole.create({ data: { membershipId: membership.id, roleId: ownerRoleId } });
    return id;
  };
  const expense = (companyId: string, userId: string, confirmedAt: string, captureSource = 'WEB_MANUAL') =>
    client.expenseRecord.create({ data: { companyId, expenseDate: at(confirmedAt), createdByUserId: userId, confirmedByUserId: userId, confirmedAt: at(confirmedAt),
      captureSource: captureSource as never, createdAt: at(confirmedAt), status: 'CONFIRMED' } });
  const aiEvent = (companyId: string, createdAt: string) =>
    client.aiUsageEvent.create({ data: { companyId, monthKey: executiveMonthOf(at(createdAt)), sourceRoute: 'line-turn', usageTag: 'spec', modelId: 'spec', ok: true,
      inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, costSatang: 10, thbPerUsd: 35, thbPerUsdSource: 'stored',
      requestId: next('request'), createdAt: at(createdAt) } });
  const term = (companyId: string, tierKey: string, days: number, renewCount = 1) =>
    client.companyPlanTerm.create({ data: { companyId, tierKey, branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 30, termStartAt: at('2026-09-01T00:00:00Z'),
      termEndsAt: new Date(Date.parse('2026-09-01T00:00:00Z') + days * 86_400_000), renewCount } });
  const signup = (companyId: string, createdAt: string, source: string, discoverySource: string | null, other: string | null = null) =>
    client.companySignupRequest.create({ data: { companyId, source, discoverySource, discoverySourceOther: other, externalSignupId: next('signup'), payloadHash: 'h',
      companyName: 'ชื่อในคำขอสมัคร', ownerDisplayName: 'เจ้าของในคำขอ', consentVersion: 'v1', createdAt: at(createdAt) } });
  /** A paid package invoice of the running mode; `quote` names the purchase, null = a subscription's later cycle (a renewal). */
  const paidInvoice = async (companyId: string, paidSatang: number, options: { quote?: string | null; appliedAt?: string; disputed?: boolean; tier?: string } = {}) => {
    const account = await client.billingAccount.upsert({ where: { companyId_stripeAccountId_livemode: { companyId, stripeAccountId: STRIPE, livemode: true } },
      update: {}, create: { companyId, stripeAccountId: STRIPE, livemode: true, createdAt: at('2026-08-20T00:00:00Z') } });
    const quote = options.quote === undefined ? 'INITIAL' : options.quote;
    const attempt = quote === null ? null : await client.billingAttempt.create({ data: { billingAccountId: account.id, initiatingUserId: 'spec', quoteId: randomUUID(),
      channel: 'web', idempotencyKey: randomUUID(), requestHash: 'h', quoteSnapshot: { quote: { purchase: { kind: quote } } }, policyRevisionId: 'p', consentRevision: 'c', consentAt: new Date() } });
    return (await client.billingInvoice.create({ data: { billingAccountId: account.id, providerInvoiceId: `in_${randomUUID()}`, sourceAttemptId: attempt?.id ?? null,
      subscriptionId: quote === null ? 'sub_spec' : null, offerSnapshot: { offerKey: options.tier ?? 'STARTER_249' }, policyRevisionId: 'p', currency: 'THB',
      totalSatang: paidSatang, paidSatang, disputed: options.disputed ?? false, taxSatang: 0, periodStart: SEPTEMBER.start, periodEnd: SEPTEMBER.end, providerStatus: 'paid',
      evidenceHash: 'h', appliedAt: options.appliedAt ? at(options.appliedAt) : null } })).id;
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
  const lifecycle = (companyId: string, toStatus: string, createdAt: string, reason: string | null, actorUserId: string | null = null) =>
    client.auditLog.create({ data: { action: 'system.partner_company.lifecycle.transition', targetType: 'company', targetId: companyId, requestId: next('r'),
      result: 'SUCCESS', riskLevel: 'CRITICAL', actorUserId, metadataJson: { fromStatus: 'ACTIVE', toStatus, reason }, createdAt: at(createdAt) } });

  const overview = (month: string, filters: Record<string, string> = {}) => report.overview(reader(), { month, ...filters });
  const list = (month: string, filters: Record<string, unknown> = {}) => report.companies(reader(), { month, pageSize: 100, ...filters } as never);
  /** The acceptance rule of RB-19: the list a drilldown opens has exactly the count shown, and the money shown. */
  const opens = async (month: string, label: string, filters: ExecutiveDrilldownFilters, count: number | null, net?: number | null) => {
    const result = await list(month, filters);
    assert.equal(result.pagination.total, count, `${label}: count`);
    if (net !== undefined) assert.equal(valueOf(result.summary.netReceiptsSatang), net, `${label}: net`);
  };

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test server is allowed');
    assert.ok(url.pathname === '/watchdog_bms' || url.pathname.endsWith('_ci'), `refusing to work next to ${url.pathname}: only a disposable test server is allowed`);
    scratch = `executive_report_read_${randomUUID().slice(0, 8)}_ci`;
    admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${scratch}"`);
    url.pathname = `/${scratch}`;
    const raw = new Client({ connectionString: url.toString() });
    await raw.connect();
    try {
      const names = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      for (const name of names) await raw.query(readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));
    } finally { await raw.end(); }
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
    const billing = new BillingCashMovementsService({ client } as never, { billingMode: 'live', stripeAccountId: STRIPE } as never);
    const build = new ExecutiveReportBuildUseCase({ client } as never, billing);
    report = new ExecutiveReportReadService({ client } as never, new AuditService(new PrismaAuditRepository({ client } as never), { error: () => undefined } as never), billing);
    report.clock = () => clock;

    // Masters and people.
    await client.thaiAddressMaster.create({ data: { subdistrictCode: '500101', postalCode: '50200', subdistrictTh: 'ศรีภูมิ', districtTh: 'เมืองเชียงใหม่',
      provinceTh: 'เชียงใหม่', districtCode: '5001', provinceCode: '50' } });
    ownerRoleId = (await client.role.create({ data: { key: 'OWNER', scopeKey: 'system', isSystem: true, name: 'Owner' } })).id;
    await client.user.create({ data: { id: 'exec-reader', displayName: 'ผู้บริหารทดสอบ' } });
    for (const [id, name, code] of [['sales-1', 'เซลล์หนึ่ง', 'S001'], ['sales-2', 'เซลล์สอง', 'S002']] as const) {
      await client.user.create({ data: { id, displayName: name } });
      await client.salesAgentProfile.create({ data: { userId: id, salesCode: code, createdByUserId: 'spec', legalName: 'ชื่อจริงตามบัตร' } });
    }
    // The platform company; the first question to the assistant and the first receipt-reading event set when those sources begin.
    await company(PLATFORM_TENANT_ID, { createdAt: at('2026-06-01T00:00:00Z') });
    await aiEvent(PLATFORM_TENANT_ID, '2026-07-29T00:00:00Z');
    await client.companyOcrUsageEvent.create({ data: { companyId: PLATFORM_TENANT_ID, monthKey: '2026-08', sourceRoute: 'bank-statement-extract', requestId: 'ocr-since',
      createdAt: at('2026-08-27T00:00:00Z') } });

    // No data set yet: the report says it cannot answer, never zeros; the context still answers.
    await assert.rejects(report.overview(reader(), { month: '2026-09' }), (error) => statusOf(error) === 503 && codeOf(error) === 'SOURCE_UNAVAILABLE');
    assert.equal((await report.context(reader())).build, null);
    const first = await build.rebuild(FIRST_BUILD);
    assert.equal(first.status, 'BUILT');
    firstBuildId = (first as { buildId: string }).buildId;

    // The provider was read from 1 August to 15 October 00:00 Bangkok.
    scanJob = (await client.billingOperation.create({ data: { stripeAccountId: STRIPE, livemode: true, type: 'SCAN_PROVIDER_BALANCE', state: 'SUCCEEDED',
      proposedJson: { since: seconds('2026-07-31T17:00:00Z'), until: seconds('2026-10-14T17:00:00Z'), membershipId: 'm', actorCompanyId: 'c' }, sourceVersion: 0, reason: 'spec',
      initiatorUserId: 'spec', requestHash: 'spec', expiresAt: at('2030-01-01T00:00:00Z'), resultJson: {} } })).id;

    // ── Fifteen customer companies of September ──
    // c-a: food, sold by S001 at signup, first-payment credit to S002; 500,000 in September; one owner with contact data.
    await shop('c-a', { name: 'ร้านอาหารเอ', registeredName: 'บริษัท เอ จำกัด', businessTypeCode: '56101', referralSalesUserId: 'sales-1', referralSource: 'SIGNUP_CODE' });
    await signup('c-a', '2026-08-09T01:00:00Z', 'official-site', 'SALES');
    await term('c-a', 'STARTER_249', 60);
    const ownerA = await person('c-a', { owner: true, email: 'owner-a@example.test', phone: '0811111111' });
    const invoiceA = await paidInvoice('c-a', 500_000, { appliedAt: '2026-09-03T05:00:00Z' });
    await receipt('c-a', invoiceA, 500_000, '2026-09-03T04:00:00Z', 3_000, 1_000);
    await expense('c-a', ownerA, '2026-09-05T03:00:00Z', 'WEB_UPLOAD');
    await client.salesAttribution.create({ data: { companyId: 'c-a', salesUserId: 'sales-2', source: 'DEAL', amountSatang: 24_900, paidAt: at('2026-09-10T04:00:00Z'), sourceInvoiceId: invoiceA } });
    // c-b: retail by the admin's label, Facebook, a referrer the admin put in later; two owners.
    await shop('c-b', { reportIndustryGroup: 'RETAIL_WHOLESALE', referralSalesUserId: 'sales-2', referralSource: 'ADMIN' });
    await signup('c-b', '2026-08-09T02:00:00Z', 'line-oa', 'FACEBOOK');
    await term('c-b', 'STARTER_249', 60);
    const ownerB = await person('c-b', { owner: true, email: 'b1@example.test' });
    await person('c-b', { owner: true, email: 'b2@example.test' });
    await receipt('c-b', await paidInvoice('c-b', 299_000), 299_000, '2026-09-04T04:00:00Z');
    await expense('c-b', ownerB, '2026-09-06T03:00:00Z');
    // c-c: used in August only; a member but no owner.
    await shop('c-c'); await signup('c-c', '2026-08-09T03:00:00Z', 'official-site', 'WEBSITE'); await term('c-c', 'STARTER_249', 60);
    await receipt('c-c', await paidInvoice('c-c', 299_000), 299_000, '2026-09-05T04:00:00Z');
    await expense('c-c', await person('c-c'), '2026-08-20T03:00:00Z', 'WEB_UPLOAD');
    // c-d: food, "other" channel with what the customer typed; a receipt sent through LINE.
    await shop('c-d', { businessTypeCode: '56101' }); await signup('c-d', '2026-08-09T04:00:00Z', 'official-site', 'OTHER', 'งานอีเวนต์'); await term('c-d', 'STARTER_249', 60);
    await receipt('c-d', await paidInvoice('c-d', 299_000), 299_000, '2026-09-06T04:00:00Z');
    await expense('c-d', await person('c-d'), '2026-09-07T03:00:00Z', 'LINE_UPLOAD');
    // c-dup1 and c-dup2: the same name, told apart by registered name, province and date (Q29). c-dup1 joined a day later and pays the tie amount.
    await shop('c-dup1', { name: 'ร้านซ้ำ', registeredName: 'บริษัท ซ้ำหนึ่ง จำกัด', createdAt: at('2026-08-11T02:00:00Z') });
    await signup('c-dup1', '2026-08-11T01:00:00Z', 'official-site', 'WEBSITE'); await term('c-dup1', 'STARTER_249', 60);
    await receipt('c-dup1', await paidInvoice('c-dup1', 299_000, { disputed: true }), 299_000, '2026-09-07T04:00:00Z');
    await shop('c-dup2', { name: 'ร้านซ้ำ', registeredName: 'ห้างหุ้นส่วน ซ้ำสอง', addressJson: null, reportIndustryGroup: 'RETAIL_WHOLESALE' });
    await term('c-dup2', 'STARTER_249', 0, 0); // the "no package" marker: never bought
    // c-e: paid, never used; it joined before the first build. The owner of c-a is also one of its members: two shops, still two companies (REP-04).
    await shop('c-e', { createdAt: at('2026-08-01T02:00:00Z') }); await signup('c-e', '2026-08-09T05:00:00Z', 'official-site', 'WEBSITE'); await term('c-e', 'STARTER_249', 60);
    await receipt('c-e', await paidInvoice('c-e', 100_000), 100_000, '2026-09-08T04:00:00Z');
    await client.companyMembership.create({ data: { companyId: 'c-e', userId: ownerA } });
    // c-old: joined in July, before questions to the assistant were kept and before the channel question existed; paid in August, silent since.
    await shop('c-old', { createdAt: at('2026-07-01T00:00:00Z') }); await signup('c-old', '2026-06-30T00:00:00Z', 'official-site', null); await term('c-old', 'STARTER_249', 60);
    await receipt('c-old', await paidInvoice('c-old', 49_900), 49_900, '2026-08-22T04:00:00Z');
    // c-refund: everything paid went back in the same month (Q19).
    await shop('c-refund'); await signup('c-refund', '2026-08-09T06:00:00Z', 'official-site', 'IG'); await term('c-refund', 'STARTER_249', 60);
    const refunded = await paidInvoice('c-refund', 50_000);
    await receipt('c-refund', refunded, 50_000, '2026-09-03T04:00:00Z');
    await refund('c-refund', refunded, 50_000, '2026-09-20T04:00:00Z');
    // c-neg: paid at the last instant of August, part refunded at the first instant of September; archived; its channel unknown (PX-02).
    await shop('c-neg', { status: 'ARCHIVED' }); await signup('c-neg', '2026-08-09T07:00:00Z', 'official-site', null); await term('c-neg', 'STARTER_249', 60);
    const negative = await paidInvoice('c-neg', 149_000);
    await receipt('c-neg', negative, 149_000, '2026-08-31T16:59:59Z');
    await refund('c-neg', negative, 49_900, '2026-08-31T17:00:00Z');
    // c-trial: on the free trial and using it: not paid, but active (USE-06).
    await shop('c-trial'); await signup('c-trial', '2026-08-09T08:00:00Z', 'line-oa', 'TIKTOK'); await term('c-trial', 'FREE_TRIAL_15', 30, 0);
    await expense('c-trial', await person('c-trial'), '2026-09-09T03:00:00Z');
    // c-manual: a package the admin set by hand, no receipt, no right to expenses. c-legacy: from before packages.
    await shop('c-manual'); await term('c-manual', 'PRO_999', 365);
    await client.companyFeatureEntitlement.create({ data: { companyId: 'c-manual', featureKey: 'expenses', enabled: false } });
    await shop('c-legacy');
    // c-unres: its referrer's profile is gone (the admin put it in); a flagged credit; bought in August, renewed in September, asks the assistant (PX-12).
    await shop('c-unres', { referralSalesUserId: 'ghost', referralSource: 'ADMIN' }); await term('c-unres', 'STARTER_249', 60);
    await receipt('c-unres', await paidInvoice('c-unres', 49_900, { appliedAt: '2026-08-21T05:00:00Z' }), 49_900, '2026-08-21T04:00:00Z');
    await receipt('c-unres', await paidInvoice('c-unres', 49_900, { quote: null, appliedAt: '2026-09-12T05:00:00Z' }), 49_900, '2026-09-12T04:00:00Z');
    await aiEvent('c-unres', '2026-09-15T03:00:00Z');
    await client.salesAttribution.create({ data: { companyId: 'c-unres', salesUserId: 'sales-1', source: 'REFERRAL', amountSatang: 49_900, paidAt: at('2026-08-21T04:00:00Z'),
      sourceInvoiceId: 'inv-unres', flags: ['self_referral'], flaggedAt: at('2026-08-21T04:00:00Z') } });
    // c-late: joined on 20 September through the e-mail signup, pays in October.
    await shop('c-late', { createdAt: at('2026-09-20T02:00:00Z') }); await signup('c-late', '2026-09-20T01:00:00Z', 'email-otp', 'WEBSITE'); await term('c-late', 'STARTER_249', 60);
    await receipt('c-late', await paidInvoice('c-late', 26_643), 26_643, '2026-10-05T04:00:00Z');
    // c-return: came back after its package ran out (RESTART: shown with renewals, Q22); said "sales" but named no seller.
    await shop('c-return'); await signup('c-return', '2026-08-09T09:00:00Z', 'line-oa', 'SALES'); await term('c-return', 'STARTER_249', 60);
    await receipt('c-return', await paidInvoice('c-return', 26_643, { quote: 'RESTART', appliedAt: '2026-09-14T05:00:00Z' }), 26_643, '2026-09-14T04:00:00Z');
    // ── Outside the population: a test shop, a shop nobody labelled, and money no company answers for ──
    await company('t-test', { reportClassification: 'TEST' });
    await receipt('t-test', await paidInvoice('t-test', 24_900), 24_900, '2026-09-10T04:00:00Z');
    await company('u-unlabelled');
    await receipt('u-unlabelled', await paidInvoice('u-unlabelled', 5_000), 5_000, '2026-09-11T04:00:00Z');
    await movement('charge', 7_700, '2026-08-25T04:00:00Z', { classification: 'LOCAL_MISSING' });
    // October: twelve companies ask the assistant once each (a tie across the tenth place).
    for (const id of ['c-a', 'c-b', 'c-c', 'c-d', 'c-dup1', 'c-dup2', 'c-e', 'c-trial', 'c-legacy', 'c-unres', 'c-late', 'c-return']) await aiEvent(id, '2026-10-02T03:00:00Z');
    // History rows of c-a: the term sweep, an admin's hold, a renewal back to active; and rows that are not company events.
    await lifecycle('c-a', 'DISABLED', '2026-09-15T00:00:00Z', 'ร้านขอพักเอง', 'exec-reader');
    await lifecycle('c-a', 'DISABLED', '2026-09-30T00:00:00Z', 'term_expired');
    await lifecycle('c-a', 'ACTIVE', '2026-10-01T00:00:00Z', 'ต่ออายุแล้ว', 'exec-reader');
    await lifecycle('c-b', 'ARCHIVED', '2026-10-01T00:00:00Z', null, 'exec-reader');
    await client.auditLog.create({ data: { action: 'system.partner_company.update', targetType: 'company', targetId: 'c-a', requestId: 'r', result: 'SUCCESS' } });

    const second = await build.rebuild(NOW);
    assert.deepEqual([second.status, (second as { kind: string }).kind], ['BUILT', 'FULL']);
  });

  after(async () => {
    await client?.$disconnect().catch(() => undefined);
    if (admin) {
      try { if (scratch) await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`); }
      finally { await admin.end(); }
    }
  });

  it('counts the customer companies of the month and keeps the rest apart, for reconciliation', async () => {
    const september = await overview('2026-09');
    // Sixteen customers; a company nobody labelled makes the count "at least" (CLASSIFICATION_INCOMPLETE).
    assert.deepEqual(september.metrics.companies, { value: null, knownValue: 16, coverage: 'partial', reasonCodes: ['CLASSIFICATION_INCOMPLETE'], unclassifiedCount: 1,
      drilldownFilters: {} });
    assert.deepEqual({ ...september.population, eligibleCount: valueOf(september.population.eligibleCount) },
      { eligibleCount: 16, excludedTestInternalCount: 2, unclassifiedCount: 1, excludedTestInternalNetReceiptsSatang: 24_900, unclassifiedNetReceiptsSatang: 5_000 });
    // August: the shop that joined on 20 September is not in it (NOT_YET_REGISTERED), and money no company answers for shows.
    const august = await overview('2026-08');
    assert.equal(valueOf(august.metrics.companies), 15);
    assert.deepEqual(august.unmatchedMoney, { count: 1, receiptsSatang: 7_700, refundsSatang: 0, otherSatang: 0 });
    assert.deepEqual(august.coverage.money, { coverage: 'partial', reasonCodes: ['UNMATCHED_MONEY'] });
    assert.deepEqual(august.coverage.usage, { coverage: 'partial', reasonCodes: ['HISTORY_BEFORE_FIRST_BUILD'] });
    const late = await report.company(reader(), 'c-late', { month: '2026-08' });
    assert.deepEqual([late.month, late.monthReasonCodes], [null, ['NOT_YET_REGISTERED']]);
    // July: before the first billing account there is no money data at all: unavailable, never 0.
    const july = await overview('2026-07');
    assert.equal(valueOf(july.metrics.companies), 1);
    assert.deepEqual(july.metrics.netReceiptsSatang, { value: null, coverage: 'unavailable', reasonCodes: ['HISTORY_BEFORE_COLLECTION'], currency: 'THB', drilldownFilters: {} });
  });

  it('puts the money of September where the provider dated it, with every coverage reason that applies', async () => {
    const september = await overview('2026-09');
    assert.deepEqual(september.coverage.money, { coverage: 'complete', reasonCodes: [] });
    assert.deepEqual(september.metrics.netReceiptsSatang, { value: 1_822_643, coverage: 'complete', reasonCodes: [], currency: 'THB', drilldownFilters: {} });
    assert.deepEqual(september.metrics.companiesWithReceipts, { value: 9, coverage: 'complete', reasonCodes: [], drilldownFilters: { paidInPeriod: 'true' } });
    assert.deepEqual([september.period.isPartialMonth, september.period.startInclusive, september.period.endExclusive, september.period.effectiveEndExclusive],
      [false, '2026-08-31T17:00:00.000Z', '2026-09-30T17:00:00.000Z', '2026-09-30T17:00:00.000Z']);
    const revenue = (await report.analysis(reader(), { month: '2026-09', section: 'revenue', view: 'summary' })).revenue!;
    assert.deepEqual([valueOf(revenue.receiptsSatang), valueOf(revenue.refundsSatang), valueOf(revenue.netReceiptsSatang), valueOf(revenue.feesSatang), valueOf(revenue.taxSatang)],
      [1_922_543, 99_900, 1_822_643, 1_000, 3_000]);
    const byGroup = Object.fromEntries(revenue.byPurchaseGroup.map((group) => [group.key, [valueOf(group.receiptsSatang), valueOf(group.refundsSatang), group.receiptsSatang.coverage]]));
    // First purchases (the refund of c-neg's August purchase lands in September); a renewal and a return shown together (Q22); add-ons not on sale.
    assert.deepEqual(byGroup, { FIRST_PURCHASE: [1_846_000, 99_900, 'complete'], RENEWAL: [76_543, 0, 'complete'], UPGRADE: [0, 0, 'complete'], ADD_ON: [null, null, 'unavailable'],
      UNKNOWN: [0, 0, 'complete'] });
    assert.deepEqual(revenue.byPurchaseGroup.find((group) => group.key === 'ADD_ON')!.netReceiptsSatang.reasonCodes, ['ADDON_NOT_ON_SALE']);
    assert.equal(revenue.disputedInvoiceCount, 1);
    // Six months up to September: no data before the data set, no money before billing existed, a refund-only month below zero.
    assert.deepEqual(revenue.trend.map((point) => [point.month, valueOf(point.netReceiptsSatang), point.netReceiptsSatang.coverage]),
      [['2026-04', null, 'unavailable'], ['2026-05', null, 'unavailable'], ['2026-06', null, 'unavailable'], ['2026-07', null, 'unavailable'],
        ['2026-08', 248_800, 'partial'], ['2026-09', 1_822_643, 'complete']]);
    const negative = (await list('2026-09', { companyStatus: 'ARCHIVED' })).items;
    assert.deepEqual(negative.map((row) => [row.id, row.metrics.receiptsSatang, row.metrics.refundsSatang, row.metrics.netReceiptsSatang, row.discovery.key, row.planState]),
      [['c-neg', 0, 49_900, -49_900, 'UNKNOWN', 'ADMIN_HOLD']]);
    // October is running and read only to its 15th: partial, and the money says so.
    const october = await overview('2026-10');
    assert.deepEqual([october.period.isPartialMonth, october.period.effectiveEndExclusive], [true, NOW.toISOString()]);
    assert.deepEqual(october.coverage.money, { coverage: 'partial', reasonCodes: ['BILLING_SCAN_NOT_COMPLETE'] });
    assert.deepEqual(october.metrics.netReceiptsSatang, { value: null, knownValue: 26_643, coverage: 'partial', reasonCodes: ['BILLING_SCAN_NOT_COMPLETE'], currency: 'THB', drilldownFilters: {} });
  });

  it('files every customer in one payment-and-usage group, and the equations of spec §13.2 hold', async () => {
    const { paidUsage, metrics } = await overview('2026-09');
    const groups = Object.fromEntries(paidUsage.groups.map((group) => [group.key, group.count]));
    assert.deepEqual(groups, { NOT_STARTED: 4, INACTIVE: 1, ACTIVE: 4, NOT_PAID: 2 });
    // c-old paid but joined before the questions were kept, and never shows a counted action: not assessable, not "not started".
    assert.deepEqual([paidUsage.paidEver.count, paidUsage.usageUnassessed.count, paidUsage.fullyRefunded.count, paidUsage.paymentUnknown.count],
      [11, 1, 1, 3]);
    assert.deepEqual(paidUsage.paymentUnknown.byReason, { MANUAL_TERM_NO_RECEIPT: 1, LEGACY_NO_TERM: 1, UNMATCHED_MONEY: 1 });
    // paid ever = the three paid groups + not assessable + fully refunded; population = paid ever + never paid + payment unknown.
    assert.equal(paidUsage.paidEver.count, groups.NOT_STARTED! + groups.INACTIVE! + groups.ACTIVE! + paidUsage.usageUnassessed.count + paidUsage.fullyRefunded.count);
    assert.equal(valueOf(metrics.companies), paidUsage.paidEver.count + groups.NOT_PAID! + paidUsage.paymentUnknown.count);
    // Five companies used it in September: the four paid ones and the free trial that never paid (USE-06), said in so many words.
    assert.deepEqual([metrics.activeCompanies.value, metrics.activeCompanies.coverage, metrics.activeCompanies.breakdown],
      [5, 'complete', { paidActive: 4, notPaid: 1, paymentUnknown: 0, fullyRefunded: 0 }]);
  });

  it('opens, from every card, group row and segment, a list of exactly its count and money (RB-19)', async () => {
    for (const [month, filters] of [['2026-09', {}], ['2026-09', { discovery: 'WEBSITE' }], ['2026-09', { referringSales: 'NONE' }], ['2026-10', {}],
      ['2026-09', { industry: 'FOOD_ACCOMMODATION', discovery: 'FACEBOOK' }]] as const) {
      const label = `${month} ${JSON.stringify(filters)}`;
      const result = await overview(month, filters);
      const { companies, activeCompanies, companiesWithReceipts, netReceiptsSatang } = result.metrics;
      await opens(month, `${label} companies`, { ...filters, ...companies.drilldownFilters }, valueOf(companies), valueOf(netReceiptsSatang));
      await opens(month, `${label} active`, { ...filters, ...activeCompanies.drilldownFilters }, valueOf(activeCompanies));
      await opens(month, `${label} paid in month`, { ...filters, ...companiesWithReceipts.drilldownFilters }, valueOf(companiesWithReceipts));
      for (const group of result.paidUsage.groups) await opens(month, `${label} ${group.key}`, group.drilldownFilters, group.count);
      for (const item of [result.paidUsage.paidEver, result.paidUsage.usageUnassessed, result.paidUsage.fullyRefunded, result.paidUsage.paymentUnknown])
        await opens(month, `${label} paid usage line`, item.drilldownFilters, item.count);
      for (const segment of result.expenseReceiptAdoption.segments) await opens(month, `${label} receipts ${segment.key}`, segment.drilldownFilters, segment.count);
      for (const view of ['industry', 'discovery', 'sales']) {
        const groups = (await report.analysis(reader(), { month, section: 'customers', view, ...filters })).groups!;
        assert.equal(groups.reduce((total, group) => total + group.companies.count, 0), valueOf(companies), `${label} ${view} rows add up`);
        assert.equal(groups.reduce((total, group) => total + valueOf(group.netReceiptsSatang)!, 0), valueOf(netReceiptsSatang), `${label} ${view} money adds up`);
        for (const group of groups) await opens(month, `${label} ${view} ${group.key}`, group.drilldownFilters, group.companies.count, valueOf(group.netReceiptsSatang));
      }
    }
    // An empty combination is an empty answer, not an error, and the cards say 0 (REP-11, PX-04).
    assert.equal(valueOf((await overview('2026-09', { industry: 'FOOD_ACCOMMODATION', discovery: 'FACEBOOK' })).metrics.companies), 0);
  });

  it('groups by industry, channel and referring seller, with the credited seller kept apart (PX-12)', async () => {
    const rows = async (view: string) => Object.fromEntries((await report.analysis(reader(), { month: '2026-09', section: 'customers', view })).groups!
      .map((group) => [group.key, [group.label, group.companies.count, valueOf(group.companiesWithReceipts), group.paidEverCompanies, valueOf(group.activeCompanies), valueOf(group.netReceiptsSatang)]]));
    assert.deepEqual(await rows('industry'), {
      RETAIL_WHOLESALE: ['ค้าปลีกและค้าส่ง', 2, 1, 1, 1, 299_000], FOOD_ACCOMMODATION: ['ร้านอาหารและที่พัก', 2, 2, 2, 2, 799_000],
      UNKNOWN: ['ไม่ระบุ', 12, 6, 8, 2, 724_643] });
    const industry = await report.analysis(reader(), { month: '2026-09', section: 'customers', view: 'industry' });
    assert.deepEqual(industry.industryCoverage, { value: 25, numerator: 4, denominator: 16 });
    assert.deepEqual(Object.fromEntries(Object.entries(await rows('discovery')).map(([key, value]) => [key, value[1]])),
      { WEBSITE: 4, FACEBOOK: 1, SALES: 2, OTHER: 1, IG: 1, TIKTOK: 1, UNKNOWN: 1, BEFORE_COLLECTION: 1, ADMIN_CREATED: 4 });
    const sales = await report.analysis(reader(), { month: '2026-09', section: 'customers', view: 'sales' });
    assert.deepEqual(sales.groups!.map((group) => [group.key, group.label, group.companies.count]),
      // Sellers in Thai order of their names (สอง before หนึ่ง), then the three kinds that are not a seller.
      [['S002', 'เซลล์สอง · S002', 1], ['S001', 'เซลล์หนึ่ง · S001', 1], ['NONE', 'ไม่มีเซลล์ผู้แนะนำ', 11], ['UNKNOWN', 'ไม่ระบุ', 2], ['UNRESOLVED', 'เซลล์ที่ไม่พบข้อมูลแล้ว', 1]]);
    // The credit of a first payment is the sales module's, as it stands now, and is never money received.
    assert.deepEqual(sales.creditedSellers!.rows, [
      { seller: { label: 'เซลล์สอง · S002', salesCode: 'S002' }, companies: 1, waiting: 0, creditSatang: 24_900 },
      { seller: { label: 'เซลล์หนึ่ง · S001', salesCode: 'S001' }, companies: 0, waiting: 1, creditSatang: 0 },
    ].sort((a, b) => a.seller.label.localeCompare(b.seller.label, 'th')));
    // The referrer filter: a seller's code, and the three kinds that are not a seller.
    await opens('2026-09', 'S001', { referringSales: 'S001' }, 1);
    await opens('2026-09', 'UNRESOLVED', { referringSales: 'UNRESOLVED' }, 1);
    const unresolved = (await list('2026-09', { referringSales: 'UNRESOLVED' })).items[0]!;
    assert.deepEqual([unresolved.referrer, unresolved.creditedSeller], [{ kind: 'UNRESOLVED', label: 'เซลล์ที่ไม่พบข้อมูลแล้ว', source: 'ADMIN' },
      { label: 'เซลล์หนึ่ง · S001', salesCode: 'S001' }]);
    const sold = (await list('2026-09', { referringSales: 'S001' })).items[0]!;
    assert.deepEqual([sold.referrer, sold.creditedSeller], [{ kind: 'KNOWN', label: 'เซลล์หนึ่ง · S001', salesCode: 'S001', source: 'SIGNUP_CODE' },
      { label: 'เซลล์สอง · S002', salesCode: 'S002' }]);
    // A code that exists but referred nobody is an empty answer; a code that does not exist is refused, not widened to ALL.
    await client.user.create({ data: { id: 'sales-3', displayName: 'เซลล์สาม' } });
    await client.salesAgentProfile.create({ data: { userId: 'sales-3', salesCode: 'S003', createdByUserId: 'spec' } });
    await opens('2026-09', 'S003', { referringSales: 'S003' }, 0);
    await assert.rejects(list('2026-09', { referringSales: 'S999' }), (error) => statusOf(error) === 400 && codeOf(error) === 'EXECUTIVE_QUERY_INVALID');
  });

  it('finds the customers who pay the most, says how many tie at each edge, and opens exactly them (REP-29, REP-33)', async () => {
    const top = (await report.analysis(reader(), { month: '2026-09', section: 'revenue', view: 'top' })).spendConcentration!;
    assert.deepEqual({ population: top.population, positive: top.positiveCompanyCount, total: top.positiveNetTotalSatang, signed: top.signedNetTotalSatang,
      negative: top.negativeNetSatang, notPositive: top.receiptsWithoutPositiveNet, target: top.topTargetCount, topCount: top.topCount, topShare: top.topShare,
      prefix80: top.prefix80Count, prefix80Share: top.prefix80Share, tie: top.boundaryTie, tie80: top.prefix80BoundaryTie, coverage: top.coverage },
    // N = 16, K = ceil(16 × 0.2) = 4: the fourth place is one of four companies paying 299,000; the one that joined last stays outside.
    { population: 16, positive: 8, total: 1_872_543, signed: 1_822_643, negative: -49_900, notPositive: 1, target: 4, topCount: 4,
      topShare: { value: 74.6, numerator: 1_397_000, denominator: 1_872_543 }, prefix80: 5, prefix80Share: { value: 90.6, numerator: 1_696_000, denominator: 1_872_543 },
      tie: { count: 1, netSatang: 299_000 }, tie80: { count: 0, netSatang: 299_000 }, coverage: 'complete' });
    const ids = async (cohort: string) => (await list('2026-09', top.drilldownFilters[cohort as 'TOP20'])).items.map((row) => row.id);
    assert.deepEqual(await ids('TOP20'), ['c-a', 'c-b', 'c-c', 'c-d']);
    assert.deepEqual(await ids('TO80'), ['c-a', 'c-b', 'c-c', 'c-d', 'c-dup1']);
    assert.deepEqual(await ids('BOUNDARY_TIE'), ['c-b', 'c-c', 'c-d', 'c-dup1']);
    assert.equal((await ids('REST')).length, 12);
    const tied = await list('2026-09', top.drilldownFilters.BOUNDARY_TIE!);
    assert.equal(valueOf(tied.summary.netReceiptsSatang), 4 * 299_000);
    // Ranks share a place (1, 2, 2, 2, 2, 6); the cumulative share checks the 80% edge; nothing positive, no share.
    const ranked = await list('2026-09', { sortBy: 'netReceipts', sortDir: 'desc' });
    assert.deepEqual(ranked.items.slice(0, 8).map((row) => [row.id, row.rank, row.cumulativeShare?.value]), [
      ['c-a', 1, 26.7], ['c-b', 2, 42.7], ['c-c', 2, 58.6], ['c-d', 2, 74.6], ['c-dup1', 2, 90.6], ['c-e', 6, 95.9], ['c-unres', 7, 98.6], ['c-return', 8, 100]]);
    assert.deepEqual([ranked.items.at(-1)!.id, ranked.items.at(-1)!.rank, ranked.items.at(-1)!.cumulativeShare], ['c-neg', 16, null]);
    // The list's own filters and its page change neither the rank nor the summary of the whole result.
    const page = await list('2026-09', { sortBy: 'netReceipts', sortDir: 'desc', pageSize: 2, page: 2 });
    assert.deepEqual([page.items.map((row) => [row.id, row.rank]), page.pagination, valueOf(page.summary.netReceiptsSatang)],
      [[['c-c', 2], ['c-d', 2]], { page: 2, pageSize: 2, total: 16, totalPages: 8 }, 1_822_643]);
    assert.deepEqual((await list('2026-09', { paidEver: 'NO', sortBy: 'netReceipts', sortDir: 'desc' })).items.map((row) => [row.id, row.rank]), [['c-dup2', 9], ['c-trial', 9]]);
    // Fewer than ten companies in scope: no groups, and a list asked for a group is empty with the reason.
    const few = (await report.analysis(reader(), { month: '2026-09', section: 'revenue', view: 'top', industry: 'FOOD_ACCOMMODATION' })).spendConcentration!;
    assert.deepEqual([few.coverage, few.reasonCodes, few.topCount, few.boundaryTie, few.drilldownFilters], ['unavailable', ['TOO_FEW_COMPANIES'], null, undefined, {}]);
    const empty = await list('2026-09', { industry: 'FOOD_ACCOMMODATION', spendCohort: 'TOP20' });
    assert.deepEqual([empty.pagination.total, empty.reasonCodes], [0, ['TOO_FEW_COMPANIES']]);
    // October's money is not read whole: no group and no rank that may still change.
    const october = (await report.analysis(reader(), { month: '2026-10', section: 'revenue', view: 'top' })).spendConcentration!;
    assert.deepEqual([october.coverage, october.reasonCodes], ['unavailable', ['BILLING_SCAN_NOT_COMPLETE']]);
    assert.equal((await list('2026-10', { sortBy: 'netReceipts' })).items[0]!.rank, undefined);
  });

  it('ranks usage, tells the tie across the tenth place, and states receipt adoption in one state per company (REP-30, REP-34)', async () => {
    const ranking = (await report.analysis(reader(), { month: '2026-10', section: 'usage', view: 'ranking', metric: 'aiRequests' })).usageRanking!;
    assert.deepEqual([ranking.total, ranking.items.length, new Set(ranking.items.map((item) => item.rank)), ranking.boundaryTie],
      [16, 10, new Set([1]), { count: 2, value: 1 }]);
    assert.deepEqual(ranking.drilldownFilters, { sortBy: 'aiRequests', sortDir: 'desc' });
    const all = await list('2026-10', ranking.drilldownFilters);
    assert.deepEqual(all.items.filter((row) => row.metrics.aiRequests === 1).map((row) => row.rank), Array(12).fill(1));
    assert.deepEqual(all.items.filter((row) => row.metrics.aiRequests === 0).map((row) => row.rank), [13, 13, 13, 13]);
    const adoption = (await report.analysis(reader(), { month: '2026-09', section: 'usage', view: 'adoption' })).expenseReceiptAdoption!;
    assert.deepEqual({ population: adoption.population, ever: adoption.ever, never: adoption.never, unknown: adoption.unknown, notEntitled: adoption.notEntitled,
      shares: adoption.segments.map((segment) => segment.share.value), note: adoption.roundingNote, coverage: adoption.coverage },
    { population: 16, ever: 3, never: 1, unknown: 11, notEntitled: 1, shares: [18.8, 6.3, 68.8, 6.3], note: true, coverage: 'partial' });
  });

  it('compares two groups or two companies on the same base, A − B only where both are exact', async () => {
    const byIndustry = (await report.analysis(reader(), { month: '2026-09', section: 'compare', dimension: 'industry', sideA: 'FOOD_ACCOMMODATION', sideB: 'RETAIL_WHOLESALE' })).comparison!;
    // One company is still unlabelled, so a group's company count is "at least": a count difference, an average or a share from it is unknown.
    assert.deepEqual([byIndustry.sideA.companies, valueOf(byIndustry.sideA.netReceiptsSatang), byIndustry.sideA.netReceiptsPerCompanySatang,
      byIndustry.sideA.everAddedReceiptShare, byIndustry.sideA.drilldownFilters],
    [{ value: null, knownValue: 2, coverage: 'partial', reasonCodes: ['CLASSIFICATION_INCOMPLETE'] }, 799_000, null, null, { industry: 'FOOD_ACCOMMODATION' }]);
    assert.deepEqual([byIndustry.difference.companies, byIndustry.difference.netReceiptsSatang, byIndustry.difference.everAddedReceiptShare], [null, 500_000, null]);
    const companies = (await report.analysis(reader(), { month: '2026-09', section: 'compare', dimension: 'company', sideA: 'c-a', sideB: 'c-e' })).comparison!;
    // Two companies are exactly one each: every figure and difference is known.
    assert.deepEqual([companies.sideA.label, companies.sideB.label, companies.sideA.drilldownFilters, companies.difference],
      ['ร้านอาหารเอ', 'ร้าน c-e', null, { companies: 0, netReceiptsSatang: 400_000, netReceiptsPerCompanySatang: 400_000, expenseReceiptCount: 1,
        expenseReceiptsPerCompany: 1, everAddedReceiptShare: 100, activeCompanies: 1 }]);
    for (const [query, code] of [
      [{ dimension: 'industry', sideA: 'RETAIL_WHOLESALE', sideB: 'RETAIL_WHOLESALE' }, 'EXECUTIVE_QUERY_INVALID'],
      [{ dimension: 'industry', sideA: 'RETAIL_WHOLESALE', sideB: 'MINING' }, 'EXECUTIVE_QUERY_INVALID'],
      [{ dimension: 'industry', sideA: 'RETAIL_WHOLESALE', sideB: 'FOOD_ACCOMMODATION', discovery: 'WEBSITE' }, 'EXECUTIVE_QUERY_INVALID'],
      [{ dimension: 'company', sideA: 'c-a', sideB: 't-test' }, 'COMPANY_NOT_FOUND'],
    ] as const) await assert.rejects(report.analysis(reader(), { month: '2026-09', section: 'compare', ...query } as never), (error) => codeOf(error) === code, JSON.stringify(query));
  });

  it('searches names, registered names and provinces only, sorts with ties and blanks in a fixed place, and pages', async () => {
    const twins = await list('2026-09', { q: 'ร้านซ้ำ' });
    assert.deepEqual(twins.items.map((row) => [row.displayName, row.registeredName, row.provinceLabel, row.joinedAt]).sort(),
      [['ร้านซ้ำ', 'บริษัท ซ้ำหนึ่ง จำกัด', 'เชียงใหม่', '2026-08-11T02:00:00.000Z'], ['ร้านซ้ำ', 'ห้างหุ้นส่วน ซ้ำสอง', 'ไม่ระบุ', '2026-08-10T02:00:00.000Z']]);
    assert.equal((await list('2026-09', { q: 'ซ้ำหนึ่ง' })).pagination.total, 1);
    assert.equal((await list('2026-09', { q: 'เชียงใหม่' })).pagination.total, 15);
    // The summary is of the whole result and moves with the search (REP-33).
    assert.equal(valueOf(twins.summary.netReceiptsSatang), 299_000);
    // Never by an internal id, a contact or anything else; text that looks like SQL is only text.
    for (const q of ['c-a', 'owner-a@example.test', '0811111111', `'; DROP TABLE "Company"; --`]) assert.equal((await list('2026-09', { q })).pagination.total, 0, q);
    const blanks = await list('2026-09', { sortBy: 'lastActivityAt', sortDir: 'asc' });
    assert.equal(blanks.items.at(-1)!.lastActivityAt, null);
    assert.equal((await list('2026-09', { sortBy: 'lastActivityAt', sortDir: 'desc' })).items.at(-1)!.lastActivityAt, null);
    assert.deepEqual((await list('2026-09', { sortBy: 'companyName', sortDir: 'asc' })).items.slice(0, 2).map((row) => row.id), ['c-dup2', 'c-dup1']);
    // The default order is the newest company first; a page past the last answers the last page.
    const lastPage = await list('2026-09', { pageSize: 4, page: 99 });
    assert.deepEqual([lastPage.sort, lastPage.pagination, lastPage.items.length], [{ sortBy: 'joinedAt', sortDir: 'desc' }, { page: 4, pageSize: 4, total: 16, totalPages: 4 }, 4]);
    assert.equal((await list('2026-09')).items[0]!.id, 'c-late');
    // The filters in force come back with their words, the report's and the list's own (spec §16.2).
    const filtered = await list('2026-09', { discovery: 'WEBSITE', usageGroup: 'NOT_STARTED', paidInPeriod: 'true', usageAssessed: 'true' });
    assert.deepEqual([filtered.appliedFilters, filtered.pagination.total], [{
      global: { industry: { value: 'ALL', label: 'ทุกธุรกิจ' }, discovery: { value: 'WEBSITE', label: 'Website' }, referringSales: { value: 'ALL', label: 'ทั้งหมด' } },
      directory: { usageGroup: { value: 'NOT_STARTED', label: 'จ่ายแล้ว ยังไม่เริ่มใช้' }, usageAssessed: { value: 'true', label: 'ไม่รวมบริษัทที่ยังประเมินไม่ได้' },
        paidInPeriod: { value: 'true', label: 'ชำระในเดือน' } } }, 2]);
    // Each list filter on its own.
    for (const [filters, count] of [[{ planState: 'ADMIN_HOLD' }, 1], [{ signupRail: 'email-otp' }, 1], [{ signupRail: 'ADMIN_CREATED' }, 4], [{ usageAssessed: 'false' }, 4],
      [{ usageAssessed: 'true' }, 12], [{ positiveNetInPeriod: 'true' }, 8], [{ receiptAdoption: 'NOT_ENTITLED' }, 1], [{ paidEver: 'NO' }, 2]] as const)
      assert.equal((await list('2026-09', filters)).pagination.total, count, JSON.stringify(filters));
  });

  it('refuses a month outside the data set, and answers a month the set does not hold yet with "not available", never zeros', async () => {
    for (const month of ['2026-13', '2569-09', '2026-05', '2026-11', '26-09']) await assert.rejects(overview(month), (error) => statusOf(error) === 400, month);
    try {
      clock = at('2026-10-31T17:30:00Z'); // 1 November 00:30 Bangkok: the month exists, no round has built it yet
      await assert.rejects(overview('2026-11'), (error) => statusOf(error) === 503 && codeOf(error) === 'SOURCE_UNAVAILABLE');
      assert.deepEqual((await report.context(reader())).months, { first: '2026-06', last: '2026-11' });
      // Two hourly rounds missed: every answer says the set is old (SOURCE_STALE) and still answers from it.
      clock = new Date(NOW.getTime() + 3 * 3_600_000);
      assert.deepEqual((await overview('2026-09')).reasonCodes, ['SOURCE_STALE']);
    } finally { clock = NOW; }
    assert.deepEqual((await overview('2026-09')).reasonCodes, []);
    // A screen holding the set it was given hears when a newer one answers instead.
    assert.equal((await overview('2026-09', { buildId: firstBuildId })).buildChanged, true);
    const current = await overview('2026-09');
    assert.equal((await overview('2026-09', { buildId: current.build.id })).buildChanged, false);
    assert.deepEqual([current.build.monthRevision, current.dataThrough.billing, current.dataThrough.oldest, current.dataThrough.lagging],
      [0, '2026-10-14T17:00:00.000Z', '2026-10-14T17:00:00.000Z', []]);
  });

  it('answers the context with the filter options, the months and what the caller may do', async () => {
    const context = await report.context(reader(['system.executive.read', 'system.executive.export']));
    assert.deepEqual([context.currentMonth, context.defaultMonth, context.months, context.earliestAvailableMonth],
      ['2026-10', '2026-10', { first: '2026-06', last: '2026-10' }, { aiUsage: '2026-07', receiptReading: '2026-08', billing: '2026-08', discovery: '2026-08' }]);
    assert.deepEqual(context.capabilities, { readReport: { allowed: true }, export: { allowed: true }, seeContacts: { allowed: false }, manageAccounts: { allowed: false } });
    assert.deepEqual(context.filters.referringSales.map((option) => option.value), ['ALL', 'S002', 'S001', 'NONE', 'UNKNOWN', 'UNRESOLVED']);
    assert.deepEqual(context.filters.spendCohort.map((option) => option.value), ['ALL', 'TOP20', 'REST', 'TO80']);
    assert.equal(context.filters.signupRail.find((option) => option.value === 'line-oa')!.label, 'สมัครทาง LINE');
  });

  it('shows one company: current values apart from the month, contact data only to whom may see it (Q14, R20)', async () => {
    const plain = await report.company(reader(), 'c-a', { month: '2026-09' });
    assert.deepEqual(plain.company.ownerContact, { status: 'NOT_PERMITTED' });
    const detail = await report.company(contactReader(), 'c-a', { month: '2026-09' });
    assert.deepEqual(detail.company.ownerContact, { status: 'OK', email: 'owner-a@example.test', phoneNumber: '0811111111' });
    assert.deepEqual((await report.company(contactReader(), 'c-b', { month: '2026-09' })).company.ownerContact, { status: 'MULTIPLE_OWNERS', email: null, phoneNumber: null });
    assert.deepEqual((await report.company(contactReader(), 'c-c', { month: '2026-09' })).company.ownerContact, { status: 'NO_CURRENT_OWNER', email: null, phoneNumber: null });
    const { company, month } = detail;
    assert.deepEqual([company.displayName, company.registeredName, company.provinceLabel, company.industryGroup, company.businessTypeLabel, company.planLabel, company.timeBasis],
      ['ร้านอาหารเอ', 'บริษัท เอ จำกัด', 'เชียงใหม่', { key: 'FOOD_ACCOMMODATION', label: 'ร้านอาหารและที่พัก' }, 'การบริการด้านอาหารในภัตตาคาร/ร้านอาหาร', 'เริ่มต้น (STARTER)', 'CURRENT']);
    assert.deepEqual(company.creditedSeller, { label: 'เซลล์สอง · S002', salesCode: 'S002', creditSatang: 24_900, creditedAt: '2026-09-10T04:00:00.000Z', state: 'COUNTED' });
    assert.deepEqual([month!.paidEver, month!.usageGroup, valueOf(month!.money.netReceiptsSatang), valueOf(month!.money.feesSatang), month!.money.aiCostSatang,
      month!.usage.activeDays, month!.usage.expenseReceiptCountInPeriod], [{ value: 'YES' }, 'ACTIVE', 500_000, 1_000, 0, 1, 1]);
    // "Paid, not started" of a shop that joined before the first build carries the note that its deleted rows were never seen.
    assert.deepEqual([detail.monthReasonCodes, (await report.company(reader(), 'c-e', { month: '2026-09' })).monthReasonCodes], [[], ['HISTORY_BEFORE_FIRST_BUILD']]);
    const other = await report.company(reader(), 'c-d', { month: '2026-09' });
    assert.deepEqual(other.company.discovery, { key: 'OTHER', label: 'อื่น ๆ', otherText: 'งานอีเวนต์' });
    // Outside the report's customers, or unknown: one answer that does not tell whether the company exists.
    for (const id of ['t-test', 'u-unlabelled', PLATFORM_TENANT_ID, 'no-such-company'])
      await assert.rejects(report.company(contactReader(), id, { month: '2026-09' }), (error) => statusOf(error) === 404 && codeOf(error) === 'COMPANY_NOT_FOUND', id);
  });

  it('lists the company history from the rows that record it: no actor, no reason, no other kind', async () => {
    const history = await report.history(reader(), 'c-a', {});
    assert.deepEqual(history.items, [
      { kind: 'ACTIVATED', at: '2026-10-01T00:00:00.000Z' },
      { kind: 'PACKAGE_EXPIRED', at: '2026-09-30T00:00:00.000Z' },
      { kind: 'DISABLED', at: '2026-09-15T00:00:00.000Z' },
      { kind: 'PACKAGE_PURCHASED', at: '2026-09-03T05:00:00.000Z', planLabel: 'เริ่มต้น (STARTER)' },
      { kind: 'SIGNED_UP', at: '2026-08-10T02:00:00.000Z' },
    ]);
    assert.deepEqual((await report.history(reader(), 'c-unres', {})).items.filter((item) => item.kind.startsWith('PACKAGE')).map((item) => item.kind),
      ['PACKAGE_RENEWED', 'PACKAGE_PURCHASED']);
    assert.deepEqual((await report.history(reader(), 'c-return', {})).items.map((item) => item.kind), ['PACKAGE_RENEWED', 'SIGNED_UP']);
    // Paid but its package never applied: no moment it took effect, so no purchase event; the archive by the admin is one.
    assert.deepEqual((await report.history(reader(), 'c-b', {})).items.map((item) => item.kind), ['ARCHIVED', 'SIGNED_UP']);
    const paged = await report.history(reader(), 'c-a', { page: 2, pageSize: 2 });
    assert.deepEqual([paged.items.map((item) => item.kind), paged.pagination], [['DISABLED', 'PACKAGE_PURCHASED'], { page: 2, pageSize: 2, total: 5, totalPages: 3 }]);
    for (const id of ['t-test', 'no-such-company'])
      await assert.rejects(report.history(reader(), id, {}), (error) => statusOf(error) === 404 && codeOf(error) === 'COMPANY_NOT_FOUND', id);
  });

  it('returns only the allowed keys, no internal id of a person, and no contact data without the right (RB-22)', async () => {
    const rows = (await list('2026-09')).items;
    const allowed = ['id', 'displayName', 'registeredName', 'provinceLabel', 'joinedAt', 'industryGroup', 'companyStatus', 'planState', 'planLabel', 'discovery',
      'signupRail', 'referrer', 'creditedSeller', 'paidEver', 'fullyRefunded', 'usageGroup', 'usageUnassessedReason', 'receiptAdoption', 'metrics', 'lastActivityAt'];
    for (const row of rows) assert.deepEqual(Object.keys(row).filter((key) => !allowed.includes(key)), [], row.id);
    const payload = JSON.stringify([rows, await report.company(reader(), 'c-a', { month: '2026-09' }), await report.company(reader(), 'c-unres', { month: '2026-09' }),
      await report.history(reader(), 'c-a', {}), await report.analysis(reader(), { month: '2026-09', section: 'customers', view: 'sales' })]);
    for (const secret of ['sales-1', 'sales-2', 'ghost', 'exec-reader', '@example.test', '0811111111', 'ชื่อจริงตามบัตร', 'ร้านขอพักเอง', 'ต่ออายุแล้ว', 'ชื่อในคำขอสมัคร'])
      assert.equal(payload.includes(secret), false, `the payload carries "${secret}"`);
  });

  it('audits every read as the platform did it: who, what, which filters, never a customer company, a search text or a person', async () => {
    const contexts = [reader(), contactReader(), reader(), reader()];
    await report.companies(contexts[0]!, { month: '2026-09', q: 'ร้านซ้ำ', paidEver: 'YES' });
    await report.company(contexts[1]!, 'c-a', { month: '2026-09' });
    await report.company(contexts[2]!, 'c-b', { month: '2026-09' });
    await report.history(contexts[3]!, 'c-a', {});
    const rows = (await client.auditLog.findMany({ where: { requestId: { in: contexts.map((ctx) => ctx.requestId) } } }))
      .sort((a, b) => contexts.findIndex((ctx) => ctx.requestId === a.requestId) - contexts.findIndex((ctx) => ctx.requestId === b.requestId));
    assert.deepEqual(rows.map((row) => [row.action, row.companyId, row.actorUserId, row.targetType, row.targetId]), [
      ['executive.report.read', null, 'exec-reader', 'ExecutiveReport', null],
      ['executive.company.read', null, 'exec-reader', 'Company', 'c-a'],
      ['executive.company.read', null, 'exec-reader', 'Company', 'c-b'],
      ['executive.company.read', null, 'exec-reader', 'Company', 'c-a'],
    ]);
    const listed = rows[0]!.metadataJson as Record<string, unknown>;
    // One of the two companies of that name has paid: the row count is the filtered result; the words searched are not kept.
    assert.deepEqual([listed.reportKey, listed.month, listed.rowCount, listed.hasSearch, (listed.filters as Record<string, unknown>).paidEver], ['companies', '2026-09', 1, true, 'YES']);
    assert.deepEqual(rows.slice(1).map((row) => row.metadataJson), [{ month: '2026-09', contactsReturned: true }, { month: '2026-09', contactsReturned: false },
      { month: null, contactsReturned: false }]);
    assert.equal(JSON.stringify(rows).includes('ร้านซ้ำ'), false);
    // No report read writes any row of a customer.
    assert.equal(await client.auditLog.count({ where: { action: { startsWith: 'executive.' }, companyId: { not: null } } }), 0);
  });

  // Last, because it changes the data: a late payment for September arrives and a new round writes a new set (PAY-11, FE-23).
  it('labels a finished month that a later round revised, and tells a screen holding the old set', async () => {
    const before = await overview('2026-09');
    await receipt('c-e', await paidInvoice('c-e', 10_000), 10_000, '2026-09-28T04:00:00Z');
    await client.expenseRecord.deleteMany({ where: { companyId: 'c-d' } }); // its rows are gone; its counted use is not
    clock = at('2026-10-16T03:00:00.000Z'); // the next day: a full round
    try {
      const billing = new BillingCashMovementsService({ client } as never, { billingMode: 'live', stripeAccountId: STRIPE } as never);
      assert.equal((await new ExecutiveReportBuildUseCase({ client } as never, billing).rebuild(clock)).status, 'BUILT');
      const after = await report.overview(reader(), { month: '2026-09', buildId: before.build.id });
      assert.deepEqual([after.buildChanged, after.build.monthRevision, after.build.monthRevisedAt, valueOf(after.metrics.netReceiptsSatang)],
        [true, before.build.monthRevision + 1, clock.toISOString(), 1_822_643 + 10_000]);
      await opens('2026-09', 'after the revision', after.metrics.netReceiptsSatang.drilldownFilters, 16, 1_832_643);
      const kept = await report.company(reader(), 'c-d', { month: '2026-09' });
      assert.deepEqual([kept.month!.usage.activeDays, kept.month!.usageGroup, kept.monthReasonCodes], [1, 'ACTIVE', ['SOURCE_ROWS_PURGED']]);
    } finally { clock = NOW; }
  });
});

// ── The rules, with no database (executive backend spec §13.1, §13.6) ─────────────────────────────

describe('executive report read rules', () => {
  const at = (iso: string) => new Date(iso);
  /** The smallest row the rules read: a company's net in the month and when it joined. */
  const row = (companyId: string, net: number, joined = '2026-08-01T00:00:00Z') =>
    ({ companyId, receiptsSatang: Math.max(net, 0), refundsSatang: Math.max(-net, 0), profile: { companyCreatedAt: at(joined) } }) as unknown as ReportRow;

  it('rounds half up from whole numbers, once, and says when shares do not add up to 100.0', () => {
    assert.equal(roundRatio(4000, 72, 1), 55.6); // 40 of 72 = 55.555…%
    assert.equal(roundRatio(3200, 72, 1), 44.4);
    assert.equal(roundRatio(100, 16, 1), 6.3); // 6.25 → 6.3, half up
    assert.equal(roundRatio(-5, 2, 0), -2); // −2.5 → −2, half up
    assert.equal(roundRatio(5, 0, 1), null);
    assert.equal(roundRatio(2_000_000_000_000, 3, 0), 666_666_666_667);
    assert.deepEqual(shareOf(1, 3), { value: 33.3, numerator: 1, denominator: 3 });
    assert.equal(roundingNote([shareOf(1, 3), shareOf(1, 3), shareOf(1, 3)]), true); // 99.9
    assert.equal(roundingNote([shareOf(1, 2), shareOf(1, 2)]), false);
    assert.equal(roundingNote([shareOf(0, 0)]), false);
  });

  it('gives every count one rule: partial is null with what is known, unavailable is nothing', () => {
    assert.deepEqual(countOf(7, { coverage: 'complete', reasonCodes: [] }), { value: 7, coverage: 'complete', reasonCodes: [] });
    assert.deepEqual(countOf(7, { coverage: 'partial', reasonCodes: ['UNMATCHED_MONEY'] }), { value: null, knownValue: 7, coverage: 'partial', reasonCodes: ['UNMATCHED_MONEY'] });
    assert.deepEqual(countOf(7, { coverage: 'unavailable', reasonCodes: ['HISTORY_BEFORE_COLLECTION'] }), { value: null, coverage: 'unavailable', reasonCodes: ['HISTORY_BEFORE_COLLECTION'] });
    assert.deepEqual(combined({ coverage: 'partial', reasonCodes: ['UNMATCHED_MONEY'] }, { coverage: 'partial', reasonCodes: ['PURCHASE_KIND_UNKNOWN', 'UNMATCHED_MONEY'] }),
      { coverage: 'partial', reasonCodes: ['UNMATCHED_MONEY', 'PURCHASE_KIND_UNKNOWN'] });
    const month = { end: at('2026-09-30T17:00:00Z'), effectiveEnd: at('2026-09-30T17:00:00Z'), billingCoveredThrough: at('2026-09-30T17:00:00Z'), untiedCount: 0 };
    assert.deepEqual(moneyCoverageOf({ ...month, billingSince: at('2026-08-20T00:00:00Z') }), { coverage: 'complete', reasonCodes: [] });
    assert.deepEqual(moneyCoverageOf({ ...month, billingSince: at('2026-08-20T00:00:00Z'), billingCoveredThrough: at('2026-09-30T16:59:59Z'), untiedCount: 2 }),
      { coverage: 'partial', reasonCodes: ['BILLING_SCAN_NOT_COMPLETE', 'UNMATCHED_MONEY'] });
    for (const since of [null, at('2026-09-30T17:00:00Z')]) assert.equal(moneyCoverageOf({ ...month, billingSince: since }).coverage, 'unavailable');
    assert.deepEqual(usageCoverageOf({ start: at('2026-08-31T17:00:00Z'), beforeFirstBuild: true, aiUsageSince: at('2026-09-02T00:00:00Z') }),
      { coverage: 'partial', reasonCodes: ['HISTORY_BEFORE_FIRST_BUILD', 'HISTORY_BEFORE_COLLECTION'] });
    assert.deepEqual(usageCoverageOf({ start: at('2026-08-31T17:00:00Z'), beforeFirstBuild: false, aiUsageSince: null }), { coverage: 'complete', reasonCodes: [] });
  });

  it('ranks with shared places, ties broken by joining first, blanks last in both directions', () => {
    const rows = [row('d', 5, '2026-08-04T00:00:00Z'), row('a', 9), row('c', 5, '2026-08-02T00:00:00Z'), row('b', 5, '2026-08-02T00:00:00Z'), row('e', 1)];
    const sorted = sortedBy(rows, (item) => item.receiptsSatang, 'desc');
    assert.deepEqual(sorted.map((item) => item.companyId), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual([...ranksOf(sorted, (item) => item.receiptsSatang).values()], [1, 2, 2, 2, 5]);
    const blanks = (dir: 'asc' | 'desc') => sortedBy(rows, (item) => (item.companyId === 'a' ? null : item.receiptsSatang), dir).map((item) => item.companyId);
    assert.equal(blanks('asc').at(-1), 'a');
    assert.equal(blanks('desc').at(-1), 'a');
  });

  it('cuts the 20% and the 80% groups without growing them for a tie, and counts the tie (spec §13.6 example)', () => {
    // The spec's 72 companies: 8 pay more, 14 pay 299,000 each, the rest little or nothing.
    const rows = [...Array.from({ length: 8 }, (_, i) => row(`big-${i}`, 1_200_000)), ...Array.from({ length: 14 }, (_, i) => row(`tie-${String(i).padStart(2, '0')}`, 299_000)),
      ...Array.from({ length: 40 }, (_, i) => row(`small-${i}`, 1_250)), ...Array.from({ length: 10 }, (_, i) => row(`zero-${i}`, 0))];
    const groups = spendGroupsOf(rows, false);
    assert.deepEqual([groups.population, groups.topTargetCount, groups.topCount, groups.prefix80Count, groups.boundaryTie, groups.prefix80BoundaryTie],
      [72, 15, 15, 13, { count: 7, netSatang: 299_000 }, { count: 9, netSatang: 299_000 }]);
    assert.equal(groups.members.BOUNDARY_TIE.size, 14);
    assert.equal(groups.members.TO80_BOUNDARY_TIE.size, 14);
    assert.equal(groups.members.REST.size, 72 - 15);
    // Under ten companies, nothing to spend, or money not read whole: no group; ranks still exist unless the money may change.
    assert.deepEqual(spendGroupsOf(rows.slice(0, 9), false).blocked, ['TOO_FEW_COMPANIES']);
    assert.deepEqual(spendGroupsOf(rows.slice(-10), false).blocked, ['NO_POSITIVE_NET']);
    const unread = spendGroupsOf(rows, true);
    assert.deepEqual([unread.blocked, unread.topCount, unread.cumulative.size], [['BILLING_SCAN_NOT_COMPLETE'], null, 0]);
    assert.equal(spendGroupsOf(rows.slice(0, 9), false).cumulative.size, 9);
  });
});
