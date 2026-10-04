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
import { Prisma, PrismaClient } from '../../generated/prisma/client';
import { AuditService } from '../audit/application/audit.service';
import { PrismaAuditRepository } from '../audit/infrastructure/prisma-audit.repository';
import type { RequestContext } from '../auth/domain/models/request-context.model';
import { BillingCashMovementsService } from '../billing/application/billing-cash-movements.service';
import { CompanyTeamNoteService } from '../system-partner-management/application/company-team-note.service';
import { PLATFORM_TENANT_ID } from '../sales-console/application/sales-context';
import { ExecutiveReportBuildUseCase } from './application/executive-report-build.use-case';
import { ExecutiveReportReadService } from './application/executive-report-read.service';
import { aiCostCoverageOf, combined, countOf, moneyCoverageOf, ranksOf, roundRatio, roundingNote, shareOf, sortedBy, spendGroupsOf, usageCoverageOf, type ReportRow } from './domain/executive-read.logic';
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
    report = new ExecutiveReportReadService({ client } as never, new AuditService(new PrismaAuditRepository({ client } as never), { error: () => undefined } as never), billing, { resolveAccess: async () => ({ permissions: ['system.executive.read', 'system.executive.export', 'system.executive.contact.read'] }) } as never, new CompanyTeamNoteService({ client } as never, new AuditService(new PrismaAuditRepository({ client } as never), { error: () => undefined } as never)));
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
    const unbuilt = await report.context(reader());
    assert.deepEqual([unbuilt.build, unbuilt.months, unbuilt.builtMonths], [null, null, []]);
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
      prefix80: top.prefix80Count, prefix80Share: top.prefix80Share, tie: top.boundaryTie, tie80: top.prefix80BoundaryTie, coverage: top.coverage,
      nonPositive: top.nonPositiveCount, rest: top.restCount, restShare: top.restShare,
      companyShares: [top.topCompanyShare, top.prefix80CompanyShare, top.restCompanyShare], roundingNote: top.roundingNote },
    // N = 16, K = ceil(16 × 0.2) = 4: the fourth place is one of four companies paying 299,000; the one that joined last stays outside.
    // The rest is N − 4 = 12 companies, the eight paying 0 or less among them, with 475,543 of the positive total.
    { population: 16, positive: 8, total: 1_872_543, signed: 1_822_643, negative: -49_900, notPositive: 1, target: 4, topCount: 4,
      topShare: { value: 74.6, numerator: 1_397_000, denominator: 1_872_543 }, prefix80: 5, prefix80Share: { value: 90.6, numerator: 1_696_000, denominator: 1_872_543 },
      tie: { count: 1, netSatang: 299_000 }, tie80: { count: 0, netSatang: 299_000 }, coverage: 'complete',
      nonPositive: 8, rest: 12, restShare: { value: 25.4, numerator: 475_543, denominator: 1_872_543 },
      companyShares: [{ value: 25, numerator: 4, denominator: 16 }, { value: 31.3, numerator: 5, denominator: 16 }, { value: 75, numerator: 12, denominator: 16 }],
      roundingNote: false });
    const ids = async (cohort: string) => (await list('2026-09', top.drilldownFilters[cohort as 'TOP20'])).items.map((row) => row.id);
    assert.deepEqual(await ids('TOP20'), ['c-a', 'c-b', 'c-c', 'c-d']);
    assert.deepEqual(await ids('TO80'), ['c-a', 'c-b', 'c-c', 'c-d', 'c-dup1']);
    assert.deepEqual(await ids('BOUNDARY_TIE'), ['c-b', 'c-c', 'c-d', 'c-dup1']);
    assert.equal((await ids('REST')).length, top.restCount);
    // The companies paying 0 or less are counted on the same companies as the groups.
    assert.equal((await list('2026-09', { pageSize: 100 })).items.filter((row) => row.metrics.netReceiptsSatang! <= 0).length, top.nonPositiveCount);
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
    assert.deepEqual([few.restCount, few.restShare, few.topCompanyShare, few.prefix80CompanyShare, few.restCompanyShare, few.roundingNote, few.nonPositiveCount],
      [null, null, null, null, null, false, 0]);
    const empty = await list('2026-09', { industry: 'FOOD_ACCOMMODATION', spendCohort: 'TOP20' });
    assert.deepEqual([empty.pagination.total, empty.reasonCodes], [0, ['TOO_FEW_COMPANIES']]);
    // October's money is not read whole: no group and no rank that may still change.
    const october = (await report.analysis(reader(), { month: '2026-10', section: 'revenue', view: 'top' })).spendConcentration!;
    assert.deepEqual([october.coverage, october.reasonCodes], ['unavailable', ['BILLING_SCAN_NOT_COMPLETE']]);
    assert.deepEqual([october.restCount, october.restShare, october.restCompanyShare, october.positiveCompanyCount, october.nonPositiveCount], [null, null, null, 1, 15]);
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
      const november = await report.context(reader());
      assert.deepEqual([november.months, november.builtMonths], [{ first: '2026-06', last: '2026-11' }, ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']]);
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
    assert.deepEqual([context.currentMonth, context.defaultMonth, context.months, context.builtMonths, context.earliestAvailableMonth],
      ['2026-10', '2026-10', { first: '2026-06', last: '2026-10' }, ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
        { aiUsage: '2026-07', receiptReading: '2026-08', billing: '2026-08', discovery: '2026-08' }]);
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
      ['ร้านอาหารเอ', 'บริษัท เอ จำกัด', 'เชียงใหม่', { key: 'FOOD_ACCOMMODATION', label: 'ร้านอาหารและที่พัก' }, 'การบริการด้านอาหารในภัตตาคาร/ร้านอาหาร', 'เริ่มต้น', 'CURRENT']);
    assert.deepEqual(company.creditedSeller, { label: 'เซลล์สอง · S002', salesCode: 'S002', creditSatang: 24_900, creditedAt: '2026-09-10T04:00:00.000Z', state: 'COUNTED' });
    assert.deepEqual([month!.paidEver, month!.usageGroup, valueOf(month!.money.netReceiptsSatang), valueOf(month!.money.feesSatang),
      month!.usage.activeDays, month!.usage.expenseReceiptCountInPeriod], [{ value: 'YES' }, 'ACTIVE', 500_000, 1_000, 1, 1]);
    // The measured AI cost has its own coverage: the meter's first row was 29 July, so July holds only what was measured since.
    const cost = { currency: 'THB' };
    assert.deepEqual(month!.money.aiCostSatang, { value: 0, coverage: 'complete', reasonCodes: [], ...cost });
    assert.deepEqual((await report.company(reader(), 'c-a', { month: '2026-10' })).month!.money.aiCostSatang, { value: 10, coverage: 'complete', reasonCodes: [], ...cost });
    assert.deepEqual((await report.company(reader(), 'c-old', { month: '2026-07' })).month!.money.aiCostSatang,
      { value: null, knownValue: 0, coverage: 'partial', reasonCodes: ['HISTORY_BEFORE_COLLECTION'], ...cost });
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
      { kind: 'PACKAGE_PURCHASED', at: '2026-09-03T05:00:00.000Z', planLabel: 'เริ่มต้น' },
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
      'signupRail', 'referrer', 'creditedSeller', 'paidEver', 'fullyRefunded', 'usageGroup', 'usageUnassessedReason', 'receiptAdoption', 'coverage', 'metrics', 'lastActivityAt', 'sheet', 'inactivity', 'ownerContact', 'note', 'canEditNote'];
    // Contracted per-row money/usage coverage, including missing summary rows; no extra source fields escape.
    for (const row of rows) assert.deepEqual(Object.keys(row).filter((key) => !allowed.includes(key)), [], row.id);
    const payload = JSON.stringify([rows, await report.company(reader(), 'c-a', { month: '2026-09' }), await report.company(reader(), 'c-unres', { month: '2026-09' }),
      await report.history(reader(), 'c-a', {}), await report.analysis(reader(), { month: '2026-09', section: 'customers', view: 'sales' })]);
    for (const secret of ['sales-1', 'sales-2', 'ghost', 'exec-reader', '@example.test', '0811111111', 'ชื่อจริงตามบัตร', 'ร้านขอพักเอง', 'ต่ออายุแล้ว', 'ชื่อในคำขอสมัคร'])
      assert.equal(payload.includes(secret), false, `the payload carries "${secret}"`);
  });

  it('audits every read as the platform did it: who, what, which filters, never a customer company, a search text or a person', async () => {
    const contexts = [reader(), contactReader(), reader(), reader(), reader()];
    await report.companies(contexts[0]!, { month: '2026-09', q: 'ร้านซ้ำ', paidEver: 'YES' });
    await report.company(contexts[1]!, 'c-a', { month: '2026-09' });
    await report.company(contexts[2]!, 'c-b', { month: '2026-09' });
    await report.history(contexts[3]!, 'c-a', {});
    await report.company(contexts[4]!, 'c-a', { from: '2026-09', to: '2026-10' });
    const rows = (await client.auditLog.findMany({ where: { requestId: { in: contexts.map((ctx) => ctx.requestId) } } }))
      .sort((a, b) => contexts.findIndex((ctx) => ctx.requestId === a.requestId) - contexts.findIndex((ctx) => ctx.requestId === b.requestId));
    assert.deepEqual(rows.map((row) => [row.action, row.companyId, row.actorUserId, row.targetType, row.targetId]), [
      ['executive.report.read', null, 'exec-reader', 'ExecutiveReport', null],
      ['executive.company.read', null, 'exec-reader', 'Company', 'c-a'],
      ['executive.company.read', null, 'exec-reader', 'Company', 'c-b'],
      ['executive.company.read', null, 'exec-reader', 'Company', 'c-a'],
      ['executive.company.read', null, 'exec-reader', 'Company', 'c-a'],
    ]);
    const listed = rows[0]!.metadataJson as Record<string, unknown>;
    // One of the two companies of that name has paid: the row count is the filtered result; the words searched are not kept.
    assert.deepEqual([listed.reportKey, listed.month, listed.rowCount, listed.hasSearch, (listed.filters as Record<string, unknown>).paidEver], ['companies', '2026-09', 1, true, 'YES']);
    assert.deepEqual(rows.slice(1).map((row) => row.metadataJson), [{ month: '2026-09', period: { from: '2026-09', to: '2026-09' }, contactsReturned: true },
      { month: '2026-09', period: { from: '2026-09', to: '2026-09' }, contactsReturned: false }, { month: null, contactsReturned: false },
      { month: null, period: { from: '2026-09', to: '2026-10' }, contactsReturned: false }]);
    assert.deepEqual(listed.period, { from: '2026-09', to: '2026-09' });
    assert.equal(JSON.stringify(rows).includes('ร้านซ้ำ'), false);
    // No report read writes any row of a customer.
    assert.equal(await client.auditLog.count({ where: { action: { startsWith: 'executive.' }, companyId: { not: null } } }), 0);
  });

  it('API13 files match real overview/list figures, contacts are opt-in and export audit never belongs to the customer', async () => {
    const ctx = reader(['system.executive.read', 'system.executive.export', 'system.executive.contact.read']);
    const screen = await report.overview(ctx, { month: '2026-09' });
    const body = { reportKey: 'overview', month: '2026-09', filters: {}, buildId: screen.build.id, format: 'xlsx', includeContacts: false } as const;
    const output = await report.export(ctx, body), parts = workbookParts(output.file), dashboard = parts.get('xl/worksheets/sheet1.xml')!;
    assert.equal(output.rowCount, valueOf(screen.metrics.companies));
    assert.match(cellXml(dashboard, 'B7'), new RegExp(`<v>${valueOf(screen.metrics.companies)}</v>`));
    assert.match(cellXml(dashboard, 'R7'), new RegExp(`<v>${valueOf(screen.metrics.netReceiptsSatang)! / 100}</v>`));
    assert.doesNotMatch(parts.get('xl/worksheets/sheet2.xml')!, /อีเมลเจ้าของบัญชี|เบอร์โทรเจ้าของบัญชี|owner-a/);
    const listed = await report.companies(ctx, { month: '2026-09', paidEver: 'YES', pageSize: 1 });
    const filtered = await report.export(ctx, { ...body, reportKey: 'companies', filters: { paidEver: 'YES' } });
    assert.equal(filtered.rowCount, listed.pagination.total);
    const contact = await report.export(ctx, { ...body, reportKey: 'detail', targetCompanyId: 'c-a', includeContacts: true });
    const detail = workbookParts(contact.file).get('xl/worksheets/sheet2.xml')!;
    assert.match(detail, /owner-a@example.test/); assert.match(sourceCellXml(detail, 'เบอร์โทร'), /t="inlineStr"/);
    assert.match(detail, /มีข้อมูลส่วนบุคคล ใช้ภายในเท่านั้น/);
    const audit = await client.auditLog.findFirst({ where: { action: 'executive.export.created', requestId: ctx.requestId }, orderBy: { createdAt: 'desc' } });
    assert.equal(audit!.companyId, null); assert.doesNotMatch(JSON.stringify(audit!.metadataJson), /owner-a|0811111111|ร้านอาหารเอ/);
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
      await assert.rejects(() => report.export(reader(['system.executive.read', 'system.executive.export']), { reportKey: 'overview', month: '2026-09', filters: {}, buildId: before.build.id, format: 'xlsx', includeContacts: false }), error => codeOf(error) === 'EXECUTIVE_SNAPSHOT_EXPIRED');
      assert.deepEqual([after.buildChanged, after.build.monthRevision, after.build.monthRevisedAt, valueOf(after.metrics.netReceiptsSatang)],
        [true, before.build.monthRevision + 1, clock.toISOString(), 1_822_643 + 10_000]);
      await opens('2026-09', 'after the revision', after.metrics.netReceiptsSatang.drilldownFilters, 16, 1_832_643);
      const kept = await report.company(reader(), 'c-d', { month: '2026-09' });
      assert.deepEqual([kept.month!.usage.activeDays, kept.month!.usageGroup, kept.monthReasonCodes], [1, 'ACTIVE', ['SOURCE_ROWS_PURGED']]);
    } finally { clock = NOW; }
  });
  it('RP04/RP08/RP19 reads a range from real built rows with union membership and reconciling totals', async () => {
    const ctx = reader(), pair = { from: '2026-09', to: '2026-10' };
    const [september, october, range, list] = await Promise.all([report.overview(ctx, { month: pair.from }), report.overview(ctx, { month: pair.to }), report.overview(ctx, pair), report.companies(ctx, { ...pair, pageSize: 100 })]);
    assert.equal(valueOf(range.metrics.netReceiptsSatang), valueOf(september.metrics.netReceiptsSatang)! + valueOf(october.metrics.netReceiptsSatang)!);
    const source = await client.executiveCompanyMonth.findMany({ where: { month: { in: [pair.from, pair.to] } } });
    const customerIds = new Set((await client.executiveCompanyProfile.findMany({ where: { reportClassification: 'CUSTOMER' } })).map(row => row.companyId));
    assert.equal(valueOf(range.metrics.activeCompanies), new Set(source.filter(row => customerIds.has(row.companyId) && row.activeDays > 0).map(row => row.companyId)).size);
    assert.equal(list.pagination.total, valueOf(range.metrics.companies));
    assert.equal(valueOf(list.summary.netReceiptsSatang), valueOf(range.metrics.netReceiptsSatang));
    assert.equal((await report.company(ctx, 'c-a', pair)).periodSummary!.usage.activeUsers, null);
    assert.equal((await report.analysis(ctx, { ...pair, section: 'revenue' })).revenue!.disputedInvoiceCount, null);
  });
  it('RP07 on real PostgreSQL preserves a missing middle header and a missing company row without fabricated zeroes', async () => {
    const header = await client.executiveReportMonth.findFirstOrThrow({ where: { month: '2026-09' } });
    try {
      await client.executiveReportMonth.delete({ where: { month_definitionVersion: { month: header.month, definitionVersion: header.definitionVersion } } });
      const range = await report.overview(reader(), { from: '2026-08', to: '2026-10' });
      assert.equal(range.months!.find(month => month.month === '2026-09')!.built, false);
      assert.ok(range.metrics.netReceiptsSatang.affectedMonths!.some(month => month.month === '2026-09' && month.reasonCodes.includes('RANGE_MONTH_NOT_BUILT')));
    } finally { await client.executiveReportMonth.create({ data: header }); }
    const row = await client.executiveCompanyMonth.findFirstOrThrow({ where: { month: '2026-09', companyId: 'c-a' } });
    try {
      await client.executiveCompanyMonth.delete({ where: { companyId_month_definitionVersion: { companyId: row.companyId, month: row.month, definitionVersion: row.definitionVersion } } });
      const detail = await report.company(reader(), 'c-a', { from: '2026-09', to: '2026-09' });
      assert.equal(detail.periodSummary!.money.netReceiptsSatang.coverage, 'unavailable');
      assert.equal(detail.periodSummary!.usage.activeDays, null);
      assert.equal(detail.monthlyHistory![0]!.summary, null);
    } finally { await client.executiveCompanyMonth.create({ data: { ...row, moneyByPurchaseKind: row.moneyByPurchaseKind ?? Prisma.JsonNull } }); }
  });
  it('RP16 reads old monthly build IDs with current labels after a real hourly build', async () => {
    const billing = new BillingCashMovementsService({ client } as never, { billingMode: 'live', stripeAccountId: STRIPE } as never);
    const build = new ExecutiveReportBuildUseCase({ client } as never, billing);
    const latest = await client.executiveReportBuild.findFirstOrThrow({ orderBy: { asOf: 'desc' } }), now = new Date(latest.asOf.getTime() + 3 * 3600000);
    const original = await client.company.findUniqueOrThrow({ where: { id: 'c-a' }, select: { reportClassification: true } });
    try {
      await client.company.update({ where: { id: 'c-a' }, data: { reportClassification: 'TEST' } });
      const built = await build.rebuild(now); assert.equal((built as { kind: string }).kind, 'HOURLY'); clock = now;
      const range = await report.overview(reader(), { from: '2026-08', to: '2026-09' });
      const august = await client.executiveCompanyMonth.findFirstOrThrow({ where: { month: '2026-08', companyId: 'c-a' } });
      assert.notEqual(august.buildId, range.build.id);
      const listed = await report.companies(reader(), { from: '2026-08', to: '2026-09', pageSize: 100 });
      assert.ok(listed.items.every(row => row.id !== 'c-a'));
      assert.ok(range.population.excludedTestInternalNetReceiptsSatang >= 500000);
    } finally {
      await client.company.update({ where: { id: 'c-a' }, data: original });
      await build.rebuild(new Date(now.getTime() + 3600000)); clock = NOW;
    }
  });

  it('reads historical and current churn, rolling facts, note versions and audited contact pages from real summaries', async () => {
    const billing = new BillingCashMovementsService({ client } as never, { billingMode: 'live', stripeAccountId: STRIPE } as never);
    const builder = new ExecutiveReportBuildUseCase({ client } as never, billing);
    await shop('range-boundary', { name: 'ร้านทดสอบวันสิ้นเดือน' });
    await shop('range-churn', { name: 'ร้านทดสอบการเลิกใช้' });
    const owner = await person('range-boundary', { owner: true, email: 'range-owner@example.test', phone: '0823456789' });
    const user = await person('range-churn');
    await expense('range-boundary', owner, '2026-08-30T17:00:00Z', 'WEB_MANUAL');
    await expense('range-churn', user, '2026-08-28T17:00:00Z', 'WEB_MANUAL');
    await expense('range-boundary', owner, '2026-10-02T00:00:00Z', 'WEB_UPLOAD');
    clock = at('2026-10-18T03:00:00Z');
    try {
      assert.equal((await builder.rebuild(clock)).status, 'BUILT');
      const boundary = await report.company(reader(), 'range-boundary', { from: '2026-09', to: '2026-09' });
      const churn = await report.company(reader(), 'range-churn', { from: '2026-09', to: '2026-09' });
      assert.equal(boundary.company.inactivity.referenceDate, '2026-09-30'); assert.equal(boundary.company.inactivity.churned, false);
      assert.equal(boundary.company.inactivity.lastUseAt, '2026-08-30T17:00:00.000Z');
      assert.equal(churn.company.inactivity.churned, true); assert.equal(churn.company.inactivity.daysSinceLastUse, 32);
      const current = await report.company(reader(), 'range-boundary', { from: '2026-10', to: '2026-10' });
      assert.equal(current.company.inactivity.referenceDate, '2026-10-18'); assert.equal(current.company.inactivity.churned, false);
      assert.equal(current.company.sheet.receipts7.value, 0); assert.equal(valueOf(current.company.sheet.receipts30), 1);
      const selected = await report.overview(reader(), { from: '2026-09', to: '2026-10' });
      assert.deepEqual(selected.churn.comparison!.period.from, '2026-07'); assert.deepEqual(selected.churn.comparison!.period.to, '2026-08');
      const filtered = await report.companies(reader(), { from: '2026-09', to: '2026-09', churned: 'true', pageSize: 100 });
      assert.ok(filtered.items.some(row => row.id === 'range-churn')); assert.ok(filtered.items.every(row => row.id !== 'range-boundary'));
      const editor = reader(['system.executive.read', 'system.executive.company_note.manage']);
      const note = await report.updateNote(editor, 'range-boundary', { text: 'ทีมติดตามแล้ว', expectedVersion: 0 });
      assert.equal(note.note.version, 1); assert.equal(note.canEditNote, true);
      await assert.rejects(report.updateNote(editor, 'range-boundary', { text: 'อีกข้อความ', expectedVersion: 0 }), error => statusOf(error) === 409);
      const pageCtx = contactReader(), page = await report.companies(pageCtx, { from: '2026-09', to: '2026-09', q: 'ร้านทดสอบวันสิ้นเดือน' });
      assert.equal(page.items[0]!.note.text, 'ทีมติดตามแล้ว'); assert.equal(page.items[0]!.ownerContact.email, 'range-owner@example.test');
      const audits = await client.auditLog.findMany({ where: { requestId: pageCtx.requestId } });
      assert.equal(audits.length, 1); assert.deepEqual((audits[0]!.metadataJson as any).contactsReturnedCompanyIds, ['range-boundary']);
      assert.doesNotMatch(JSON.stringify(audits), /range-owner@example|0823456789|ร้านทดสอบวันสิ้นเดือน/);
      assert.deepEqual((await report.companies(reader(), { from: '2026-09', to: '2026-09', q: 'ร้านทดสอบวันสิ้นเดือน' })).items[0]!.ownerContact, { status: 'NOT_PERMITTED' });
      const exportCtx = reader(['system.executive.read', 'system.executive.export', 'system.executive.contact.read']);
      const file = await report.export(exportCtx, { reportKey: 'companies', from: '2026-09', to: '2026-09', filters: { q: 'ร้านทดสอบวันสิ้นเดือน' }, buildId: selected.build.id, includeContacts: true, format: 'xlsx' });
      const source = workbookParts(file.file).get('xl/worksheets/sheet2.xml')!;
      assert.match(sourceCellXml(source, 'หมายเหตุ'), /ทีมติดตามแล้ว/); assert.match(sourceCellXml(source, 'อีเมล'), /range-owner@example.test/);
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
    // The measured AI cost: nothing metered yet is a true 0; a month that began before the meter's first row holds part of it; one that ended before holds none.
    const july = { start: at('2026-06-30T17:00:00Z'), end: at('2026-07-31T17:00:00Z') };
    for (const since of [null, july.start]) assert.deepEqual(aiCostCoverageOf({ ...july, aiUsageSince: since }), { coverage: 'complete', reasonCodes: [] });
    assert.deepEqual(aiCostCoverageOf({ ...july, aiUsageSince: at('2026-07-29T00:00:00Z') }), { coverage: 'partial', reasonCodes: ['HISTORY_BEFORE_COLLECTION'] });
    assert.deepEqual(aiCostCoverageOf({ ...july, aiUsageSince: july.end }), { coverage: 'unavailable', reasonCodes: ['HISTORY_BEFORE_COLLECTION'] });
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
    // The rest is everyone outside the 20% group; each group as a share of the 72 companies; the ten paying nothing are counted apart.
    assert.deepEqual([groups.restCount, groups.nonPositiveCount, groups.topCompanyShare?.value, groups.prefix80CompanyShare?.value, groups.restCompanyShare?.value,
      groups.topShare?.value, groups.restShare?.value, groups.roundingNote], [57, 10, 20.8, 18.1, 79.2, 84.5, 15.5, false]);
    // Two halves that both round up miss 100.0: in money (62.35 + 37.65 → 62.4 + 37.7), or in companies (12.25 + 87.75 → 12.3 + 87.8).
    const money = spendGroupsOf([row('m-1', 700), row('m-2', 547), row('m-3', 500), row('m-4', 253), ...Array.from({ length: 6 }, (_, i) => row(`m-zero-${i}`, 0))], false);
    assert.deepEqual([money.topShare?.value, money.restShare?.value, money.topCompanyShare?.value, money.restCompanyShare?.value, money.roundingNote], [62.4, 37.7, 20, 80, true]);
    const companies = spendGroupsOf([...Array.from({ length: 49 }, (_, i) => row(`p-${i}`, 1_000)), ...Array.from({ length: 351 }, (_, i) => row(`z-${i}`, 0))], false);
    assert.deepEqual([companies.topCount, companies.topShare?.value, companies.restShare?.value, companies.topCompanyShare?.value, companies.restCompanyShare?.value,
      companies.roundingNote], [49, 100, 0, 12.3, 87.8, true]);
    // Under ten companies, nothing to spend, or money not read whole: no group; ranks still exist unless the money may change.
    assert.deepEqual(spendGroupsOf(rows.slice(0, 9), false).blocked, ['TOO_FEW_COMPANIES']);
    assert.deepEqual(spendGroupsOf(rows.slice(-10), false).blocked, ['NO_POSITIVE_NET']);
    const unread = spendGroupsOf(rows, true);
    assert.deepEqual([unread.blocked, unread.topCount, unread.cumulative.size], [['BILLING_SCAN_NOT_COMPLETE'], null, 0]);
    assert.deepEqual([unread.restCount, unread.restShare, unread.topCompanyShare, unread.roundingNote, unread.nonPositiveCount], [null, null, null, false, 10]);
    assert.equal(spendGroupsOf(rows.slice(0, 9), false).cumulative.size, 9);
  });
});

// API13 and the writer also run without PostgreSQL; CI already registers this file.
import { inflateRawSync } from 'node:zlib';
import * as xlsxWriter from '../../common/export/xlsx.logic';
function workbookParts(file: Buffer): Map<string, string> {
  const parts = new Map<string, string>();
  for (let offset = 0; file.readUInt32LE(offset) === 0x04034b50;) {
    const method = file.readUInt16LE(offset + 8), size = file.readUInt32LE(offset + 18);
    const nameLength = file.readUInt16LE(offset + 26), extraLength = file.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    const data = file.subarray(start, start + size);
    parts.set(file.subarray(offset + 30, offset + 30 + nameLength).toString(), (method === 8 ? inflateRawSync(data) : data).toString());
    offset = start + size;
  }
  return parts;
}
const cellXml = (sheet: string, ref: string) => sheet.match(new RegExp(`<c r="${ref}"[^>]*>([\\s\\S]*?)</c>`))?.[0] ?? '';
const sourceColumnOf = (sheet: string, label: string) => {
  const escaped = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  assert.ok(cellXml(sheet, 'A6').includes('>บริษัท / ร้าน</t>'), 'owner sheet company column first');
  const header = sheet.match(/<row r="6"[^>]*>[\s\S]*?<\/row>/)![0];
  const match = [...header.matchAll(/<c r="([A-Z]+)6"[^>]*>[\s\S]*?<\/c>/g)].find(cell => cell[0].includes(`>${escaped}</t>`));
  assert.ok(match, `missing source column: ${label}`); return match[1]!;
};
const sourceCellXml = (sheet: string, label: string, row = 7) => cellXml(sheet, `${sourceColumnOf(sheet, label)}${row}`);

const fixtureWorkbook = async (count = 3, metadata = ['ข้อมูลสมมติ']) => {
  const { buildExecutiveWorkbook } = await import('./domain/executive-export.logic');
  return buildExecutiveWorkbook({ title: 'รายงานสมมติ', month: '2026-09', metadata,
    columns: ['บริษัท', 'ยอดรับสุทธิในเดือน'], rows: Array.from({ length: count }, (_, i) => [`ร้านสมมติ ${i + 1}`, i === 0 ? -12.34 : 25]),
    kpis: [{ label: 'บริษัทลูกค้า', value: count, formula: count ? `COUNTA('รายบริษัท'!A7:A${6 + count})` : '0' }],
    panels: Array.from({ length: 4 }, (_, i) => ({ title: `กลุ่มสมมติ ${i + 1}`, kind: i ? 'bar' as const : 'doughnut' as const,
      labels: ['เคยเพิ่มใบเสร็จ', 'ยังประเมินไม่ได้'], values: [2, null], formulas: ['2', 'IF(1=1,"",0)'] })) });
};
describe('executive workbook without a calculating reader', () => {
  it('writes two Thai sheets, bounded cached formulas, four bound native charts and compressed parts', async () => {
    const file = await fixtureWorkbook(), parts = workbookParts(file), overview = parts.get('xl/worksheets/sheet1.xml')!;
    assert.equal(file.readUInt16LE(8), 8);
    assert.match(parts.get('xl/workbook.xml')!, /name="ภาพรวม"/); assert.match(parts.get('xl/workbook.xml')!, /name="รายบริษัท"/);
    assert.match(parts.get('xl/workbook.xml')!, /A1:X46/); assert.match(overview, /r="48"/);
    assert.match(overview, /COUNTA\('รายบริษัท'!A7:A9\)/); assert.match(cellXml(overview, 'B7'), /<v>3<\/v>/);
    assert.match(parts.get('xl/worksheets/sheet2.xml')!, /ySplit="6"/); assert.match(parts.get('xl/worksheets/sheet2.xml')!, /autoFilter ref="A6:B9"/);
    assert.doesNotMatch(parts.get('xl/worksheets/sheet2.xml')!, /mergeCells/);
    assert.match(cellXml(parts.get('xl/worksheets/sheet2.xml')!, 'B7'), /<v>-12.34<\/v>/);
    for (let i = 1; i <= 4; i++) {
      const chart = parts.get(`xl/charts/chart${i}.xml`)!;
      assert.match(chart, i === 1 ? /doughnutChart/ : /barChart/);
      assert.match(chart, /'ภาพรวม'!\$/); assert.match(chart, /strCache/); assert.match(chart, /numCache/);
      assert.match(chart, /<c:pt idx="0"><c:v>2<\/c:v>/); assert.doesNotMatch(chart, /<c:pt idx="1"><c:v>0<\/c:v>/);
    }
    assert.doesNotMatch([...parts.values()].join(''), /A78|NOW\(|TODAY\(|externalLink/);
  });
  it('keeps formula-like text explicit, numbers numeric, unknown blank and Bangkok Buddhist dates readable without number formats', () => {
    const build = (xlsxWriter as any).buildWorkbook;
    const date = (xlsxWriter as any).xlsxThaiDate;
    assert.equal(typeof build, 'function'); assert.equal(typeof date, 'function');
    const inputs = ['=1+1', '+1', '-1', '@x', '\tx', '\rx', '=*?~>\u0001'];
    const parts = workbookParts(build([{ name: 'ทดสอบ', rows: [inputs, [0, -1.25, null, date('2026-09-30T18:30:00Z', true)] ] }]));
    const sheet = parts.get('xl/worksheets/sheet1.xml')!;
    inputs.forEach((_, i) => assert.match(cellXml(sheet, `${String.fromCharCode(65 + i)}1`), /t="inlineStr"/));
    assert.doesNotMatch(sheet, /<f>|\u0001/); assert.match(sheet, /> x</); assert.match(sheet, /=\*\?~&gt;/);
    assert.match(cellXml(sheet, 'A2'), /<v>0<\/v>/); assert.doesNotMatch(cellXml(sheet, 'B2'), /inlineStr/);
    assert.equal(cellXml(sheet, 'C2'), ''); assert.match(cellXml(sheet, 'D2'), /t="inlineStr"[\s\S]*1 ต.ค. 2569 01:30 น./);
    assert.equal(date('2026-09-30T18:30:00Z'), '1 ต.ค. 2569');
    assert.equal(date(new Date('2026-09-30T18:30:00Z'), true), '1 ต.ค. 2569 01:30 น.');
    assert.equal(date(null), null); assert.throws(() => date('invalid'), /XLSX_INVALID_DATE/);
  });
  it('prints only the dashboard on one landscape page, keeps its month row compact and lets source descriptions wrap', async () => {
    const description = 'คำอธิบายสมมติที่ยาวและต้องอ่านได้ครบ '.repeat(30);
    const parts = workbookParts(await fixtureWorkbook(3, ['ข้อมูลถึงเวลาสมมติ', 'ตัวกรองสมมติ', description])), dashboard = parts.get('xl/worksheets/sheet1.xml')!, source = parts.get('xl/worksheets/sheet2.xml')!;
    assert.match(parts.get('xl/workbook.xml')!, /name="_xlnm.Print_Area" localSheetId="0">'ภาพรวม'!A1:X46/);
    assert.match(dashboard, /<sheetPr><pageSetUpPr fitToPage="1"\/><\/sheetPr>/);
    assert.match(dashboard, /<pageSetup[^>]*orientation="landscape"[^>]*fitToWidth="1"[^>]*fitToHeight="1"/);
    assert.match(dashboard, /<row r="4" ht="24" customHeight="1">/);
    for (const row of [3, 4, 5]) assert.match(source, new RegExp(`<row r="${row}">`));
    assert.ok(cellXml(source, 'A5').includes(description));
    assert.match(source, /<row r="6" ht="72" customHeight="1">/);
    assert.match(parts.get('xl/styles.xml')!, /wrapText="1"/);
    assert.doesNotMatch(source, /pageSetup|mergeCells/);
  });
  it('handles zero and non-template row counts and rejects invalid sheets, finite numbers and sizes', async () => {
    for (const n of [0, 1, 73]) {
      const parts = workbookParts(await fixtureWorkbook(n));
      assert.match(cellXml(parts.get('xl/worksheets/sheet1.xml')!, 'B7'), new RegExp(`<v>${n}</v>`));
      assert.doesNotMatch(parts.get('xl/worksheets/sheet1.xml')!, /A7:A6|A78/);
    }
    const build = (xlsxWriter as any).buildWorkbook;
    for (const name of ['bad/name', 'x'.repeat(32), '']) assert.throws(() => build([{ name, rows: [] }]));
    assert.throws(() => build([{ name: 'ดี', rows: [[NaN]] }])); assert.throws(() => build([{ name: 'ดี', rows: [[Infinity]] }]));
    assert.throws(() => build([{ name: 'ดี', rows: [['x'.repeat(32768)]] }]));
    assert.throws(() => build([{ name: 'ดี', rows: Array.from({ length: 1048577 }, () => []) }]));
    assert.throws(() => build([{ name: 'ดี', rows: [['ข้อมูล']] }], { maxBytes: 1 }));
  });
});

describe('API13 without PostgreSQL', () => {
  const exporter = (): RequestContext => ({ requestId: 'export-request', authSubject: 'reader', userId: 'exec-reader', companyId: PLATFORM_TENANT_ID,
    membershipId: 'member', roles: [], permissions: ['system.executive.read', 'system.executive.export'], scopes: {}, authProvider: 'watchdog' });
  const request = () => ({ reportKey: 'overview', month: '2026-09', filters: {}, buildId: 'old', format: 'xlsx', includeContacts: false } as const);
  const service = () => {
    const audits: any[] = [];
    const report = new ExecutiveReportReadService({ client: {} } as never, { logOrThrow: async (entry: any) => { audits.push(entry); } } as never, {} as never, { resolveAccess: async () => exporter() } as never);
    return { report, audits };
  };
  it('refuses missing rights and tenant spoofing, and audits each denied attempt without personal data', async () => {
    const { report, audits } = service();
    for (const ctx of [{ ...exporter(), permissions: ['system.executive.read'] }, { ...exporter(), companyId: 'customer' }]) {
      await assert.rejects(() => (report as any).export(ctx, request()), (e) => statusOf(e) === 403 && codeOf(e) === 'EXECUTIVE_ACCESS_DENIED');
    }
    assert.equal(audits.length, 2); assert.ok(audits.every(row => !row.companyId && row.result === 'DENIED' && row.metadataJson.exportReference));
  });
  it('rejects expired builds before building, records the reference and releases the per-user slot', async () => {
    const { report, audits } = service();
    (report as any).load = async (_ctx: unknown, _query: unknown, _global: boolean, extra: any) => { const data = { build: { id: 'new' } }; return { data, extra: await extra({}, data) }; };
    for (let i = 0; i < 2; i++) await assert.rejects(() => (report as any).export(exporter(), request()), (e) => statusOf(e) === 409 && codeOf(e) === 'EXECUTIVE_SNAPSHOT_EXPIRED');
    assert.equal(audits.length, 2); assert.equal(audits[0].metadataJson.outcome, 'EXECUTIVE_SNAPSHOT_EXPIRED');
    assert.notEqual(audits[0].metadataJson.exportReference, audits[1].metadataJson.exportReference);
  });
  it('rejects forged totals, paging, templates, dormant filters, invalid contact requests and invalid comparison', async () => {
    const { report } = service();
    for (const body of [{ ...request(), total: 1 }, { ...request(), page: 1 }, { ...request(), templateKey: 'v4' },
      { ...request(), filters: { paidEver: 'YES' } }, { ...request(), includeContacts: true },
      { ...request(), reportKey: 'compare', comparison: { dimension: 'industry', sideA: 'FOOD', sideB: 'FOOD' } }]) {
      await assert.rejects(() => (report as any).export(exporter(), body), (e) => statusOf(e) === 400 || statusOf(e) === 403);
    }
  });
});

/** No-network source rows for the real load()/export()/overview() path. No client totals enter this fixture. */
function exportSourceFixture(n = 15) {
  const when = new Date('2026-10-03T02:30:00Z'), since = new Date('2026-08-01T00:00:00Z');
  const profiles = Array.from({ length: n }, (_, i) => ({ companyId: `fiction-${i}`, reportClassification: 'CUSTOMER', companyCreatedAt: since,
    companyStatus: 'ACTIVE', planState: 'ACTIVE', planTierKey: 'STARTER_249', industryGroup: 'FOOD_ACCOMMODATION', provinceCode: null, discovery: 'OTHER',
    signupRail: 'official-site', referrerKind: 'NONE', creditedSalesUserId: null, referrerSalesUserId: null, referralSource: null, receiptAdoption: i === 0 ? 'UNKNOWN' : i % 2 ? 'EVER' : 'NEVER',
    expenseReceiptCountLifetime: i % 2 ? 2 : 0, firstActivityAt: null, lastActivityAt: null, lastWebEntryAt: null, lastLineActivityAt: null, salesCreditPaidAt: null }));
  const rows = profiles.map((p, i) => ({ companyId: p.companyId, month: '2026-09', reportClassification: 'CUSTOMER', paidEver: i === 0 ? 'UNKNOWN' : 'YES', paidEverReason: i === 0 ? 'MANUAL_TERM_NO_RECEIPT' : null,
    fullyRefunded: false, usageGroup: i === 0 ? null : 'ACTIVE', usageUnassessedReason: i === 0 ? 'PAYMENT_HISTORY_INCOMPLETE' : null,
    receiptsSatang: i === 0 ? 0 : 2500, refundsSatang: i === 0 ? 1234 : 0, feesSatang: 12, aiCostSatang: 4, taxSatang: 0,
    activeDays: i === 0 ? 0 : 1, activeUsers: i === 0 ? 0 : 1, confirmedExpensesLine: 0, confirmedExpensesWeb: i === 0 ? 0 : 1, issuedDocuments: 0,
    aiRequests: i === 0 ? 0 : 2, expenseReceiptsLine: 0, expenseReceiptsWeb: i === 0 ? 0 : 1, moneyByPurchaseKind: {}, disputedInvoiceCount: 0, countersHeld: false }));
  const companies = profiles.map((p, i) => ({ id: p.companyId, name: `ร้านสมมติ ${i + 1}`, registeredName: `บริษัท สมมติ ${i + 1} จำกัด`, businessTypeCode: 'OTHER', businessTypeOther: '=*?~>สมมติ' }));
  const build = { id: 'fixture-build', asOf: when, definitionVersion: 'fixture-version', dimensionVersion: '1', unclassifiedCount: 0, billingSince: since, billingDataThrough: when, aiUsageSince: since };
  let transactions = 0, contacts = 0;
  let permissions = ['system.executive.read', 'system.executive.export', 'system.executive.contact.read'];
  const audits: any[] = [];
  const tx: any = { authSession: { findUnique: async () => null }, executiveReportBuild: { findFirst: async () => build }, executiveReportMonth: { findFirst: async () => ({ month: '2026-08' }), findUnique: async () => ({ revision: 1, revisedAt: null, asOf: when, billingCoveredThrough: when, untiedCount: 0, untiedReceiptsSatang: 0, untiedRefundsSatang: 0, untiedOtherSatang: 0, beforeFirstBuild: false }), findMany: async () => [] },
    executiveCompanyMonth: { findMany: async () => rows, groupBy: async () => [] }, executiveCompanyProfile: { findMany: async () => profiles }, $queryRaw: async (parts: TemplateStringsArray) => parts.join('').includes('pg_try_advisory_xact_lock') ? [{ locked: true }] : [],
    company: { findMany: async () => companies }, companySignupRequest: { findMany: async () => [] }, user: { findMany: async () => [], findUnique: async () => ({ displayName: 'ผู้ส่งออกสมมติ', status: 'ACTIVE' }) }, salesAgentProfile: { findMany: async () => [] },
    companyMembership: { findMany: async () => { contacts++; return [{ user: { email: null, phoneNumber: null } }]; } } };
  const report = new ExecutiveReportReadService({ client: { ...tx, $transaction: async (fn: any, config: any) => { transactions++; assert.equal(config.isolationLevel, 'RepeatableRead'); return fn(tx); } } } as never,
    { log: async (entry: any) => { audits.push(entry); }, logOrThrow: async (entry: any) => { audits.push(entry); } } as never, {} as never,
    { resolveAccess: async () => ({ permissions }) } as never, { get: async () => ({ text: '', version: 0, updatedAt: null, updatedBy: null, canManage: false }) } as never);
  report.clock = () => when;
  const ctx: RequestContext = { requestId: 'fixture-request', authSubject: 'fictional', userId: 'fictional-exporter', companyId: PLATFORM_TENANT_ID, membershipId: 'fictional-member', roles: [], permissions, scopes: {}, authProvider: 'watchdog' };
  const body = { reportKey: 'overview', month: '2026-09', filters: {}, buildId: build.id, format: 'xlsx', includeContacts: false } as const;
  return { report, ctx, body, audits, tx, build, rows, companies, profiles, stats: () => ({ transactions, contacts }), revoke: () => { permissions = []; } };
}
describe('API13 snapshot to workbook agreement', () => {
  it('writes every source date as Thai text, including Bangkok day rollover and blank missing dates', async () => {
    const f = exportSourceFixture(1), at = new Date('2026-09-30T18:30:00Z'), body = { ...f.body, month: '2026-10' };
    f.rows[0]!.month = '2026-10';
    Object.assign(f.profiles[0]!, { companyCreatedAt: at, salesCreditPaidAt: at, firstActivityAt: at, lastActivityAt: at, lastWebEntryAt: at, lastLineActivityAt: at });
    const source = workbookParts((await f.report.export(f.ctx, body)).file).get('xl/worksheets/sheet2.xml')!;
    for (const label of ['วันที่สมัคร', 'วันที่นับยอดให้เซลล์', 'ใช้ระบบครั้งแรก']) assert.match(sourceCellXml(source, label), /t="inlineStr"[\s\S]*1 ต.ค. 2569/);
    for (const label of ['ใช้ระบบล่าสุด', 'เข้าเว็บล่าสุด', 'ใช้ผ่านไลน์ล่าสุด']) assert.match(sourceCellXml(source, label), /t="inlineStr"[\s\S]*1 ต.ค. 2569 01:30 น./);
    f.profiles[0]!.lastLineActivityAt = null;
    assert.equal(sourceCellXml(workbookParts((await f.report.export(f.ctx, body)).file).get('xl/worksheets/sheet2.xml')!, 'ใช้ผ่านไลน์ล่าสุด'), '');
  });
  it('gives money KPI values the same card font and fill as count cards while retaining numeric money formatting', async () => {
    const f = exportSourceFixture();
    for (const body of [f.body, { ...f.body, reportKey: 'companies' }, { ...f.body, reportKey: 'detail', targetCompanyId: 'fiction-0' },
      { ...f.body, reportKey: 'usage', subview: 'adoption' }, { ...f.body, reportKey: 'customers', subview: 'industry' },
      { ...f.body, reportKey: 'compare', comparison: { dimension: 'company', sideA: 'fiction-0', sideB: 'fiction-1' } },
      { ...f.body, reportKey: 'revenue', subview: 'top' }, { ...f.body, reportKey: 'revenue', subview: 'summary' }] as const) {
      const parts = workbookParts((await f.report.export(f.ctx, body)).file), sheet = parts.get('xl/worksheets/sheet1.xml')!;
      const styles = [...parts.get('xl/styles.xml')!.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)![1]!.matchAll(/<xf\b[\s\S]*?<\/xf>/g)].map(match => match[0]);
      for (const ref of ['B7', 'J7', 'R7']) {
        const cell = cellXml(sheet, ref), style = styles[Number(cell.match(/ s="(\d+)"/)![1])]!;
        assert.match(style, /fontId="2"/); assert.match(style, /fillId="3"/);
        const moneyCard = body.reportKey === 'detail' ? ref === 'B7' : body.reportKey === 'revenue' && 'subview' in body && body.subview === 'summary' || ref === 'R7';
        assert.match(style, moneyCard ? /numFmtId="164"/ : /numFmtId="0"/); assert.doesNotMatch(cell, /t="inlineStr"/);
      }
      assert.match(sourceCellXml(parts.get('xl/worksheets/sheet2.xml')!, 'ยอดรับสุทธิในเดือน (บาท)'), / s="3"/);
    }
  });
  it('qualifies each revenue chart-data row from its own coverage and add-on sale state', async () => {
    const f = exportSourceFixture(); f.build.billingSince = new Date('2026-08-15T00:00:00Z');
    const headers = ['2026-08', '2026-09'].map(month => ({ month, asOf: f.build.asOf, billingCoveredThrough: month === '2026-08' ? new Date('2026-08-15T00:00:00Z') : f.build.asOf, untiedCount: 0 }));
    f.tx.executiveReportMonth.findMany = async () => headers;
    const notes = (sheet: string, label: string) => {
      const row = [...sheet.matchAll(/<row r="(\d+)"[^>]*>[\s\S]*?<\/row>/g)].find(match => cellXml(match[0], `B${match[1]}`).includes(`>${label}</t>`));
      assert.ok(row, label); return cellXml(row[0], `H${row[1]}`);
    };
    for (const partial of [false, true]) {
      f.build.billingDataThrough = new Date(partial ? '2026-09-15T00:00:00Z' : '2026-10-03T02:30:00Z');
      f.tx.executiveReportMonth.findUnique = async () => ({ revision: 1, asOf: f.build.asOf, billingCoveredThrough: f.build.billingDataThrough, untiedCount: 0, untiedReceiptsSatang: 0, untiedRefundsSatang: 0, untiedOtherSatang: 0, beforeFirstBuild: false });
      const data = await f.report.analysis(f.ctx, { month: f.body.month, section: 'revenue', view: 'summary' });
      const sheet = workbookParts((await f.report.export(f.ctx, { ...f.body, reportKey: 'revenue', subview: 'summary' })).file).get('xl/worksheets/sheet1.xml')!;
      for (const group of data.revenue!.byPurchaseGroup) {
        assert.match(notes(sheet, group.label), new RegExp(group.key === 'ADD_ON' ? 'ยังไม่เปิดขาย' : partial ? 'ยอดเฉพาะรายการที่ยืนยันแล้ว' : '^<c[^>]*><is><t[^>]*></t></is></c>$'));
      }
      assert.match(notes(sheet, 'ส.ค. 2569'), /ยอดเฉพาะรายการที่ยืนยันแล้ว/);
      assert.match(notes(sheet, 'ก.ค. 2569'), /ยังไม่มีตัวเลข/);
      assert.doesNotMatch(notes(sheet, 'ก.ย. 2569'), /ยอดเฉพาะรายการที่ยืนยันแล้ว/);
    }
    f.tx.$queryRaw = async (parts: TemplateStringsArray) => [{ [parts.join('').includes('pg_try_advisory_xact_lock') ? 'locked' : 'sold']: true }];
    const sold = workbookParts((await f.report.export(f.ctx, { ...f.body, reportKey: 'revenue', subview: 'summary' })).file).get('xl/worksheets/sheet1.xml')!;
    assert.doesNotMatch(notes(sold, 'ส่วนเสริม'), /ยังไม่เปิดขาย/);
    f.build.billingDataThrough = f.build.asOf;
    f.rows[0]!.moneyByPurchaseKind = { UNKNOWN: { receiptsSatang: 100, refundsSatang: 0, feesSatang: 0, taxSatang: 0 } };
    const unclassified = workbookParts((await f.report.export(f.ctx, { ...f.body, reportKey: 'revenue', subview: 'summary' })).file).get('xl/worksheets/sheet1.xml')!;
    assert.match(notes(unclassified, 'ซื้อครั้งแรก'), /ยอดเฉพาะรายการที่ยืนยันแล้ว/);
  });
  it('uses the exact filtered list count instead of the population lower bound', async () => {
    const f = exportSourceFixture(); f.build.unclassifiedCount = 1;
    f.tx.executiveReportMonth.findUnique = async () => ({ revision: 1, asOf: f.build.asOf, billingCoveredThrough: f.build.asOf, beforeFirstBuild: true, untiedCount: 0 });
    const list = await f.report.companies(f.ctx, { month: f.body.month, paidEver: 'YES' });
    const sheet = workbookParts((await f.report.export(f.ctx, { ...f.body, reportKey: 'companies', filters: { paidEver: 'YES' } })).file).get('xl/worksheets/sheet1.xml')!;
    assert.match(cellXml(sheet, 'B7'), new RegExp(`<v>${list.pagination.total}</v>`));
    assert.match(cellXml(sheet, 'B11'), new RegExp(`พบ ${list.pagination.total} บริษัท`));
    assert.doesNotMatch(cellXml(sheet, 'B11'), /อย่างน้อย/);
  });
  it('uses the detail screen metrics instead of a one-company population card', async () => {
    const f = exportSourceFixture(); f.build.unclassifiedCount = 1;
    f.tx.company.findUnique = async () => f.companies[1];
    f.tx.executiveCompanyMonth.aggregate = async () => ({ _sum: { salesCreditSatang: 0 } });
    f.tx.executiveReportBuild.aggregate = async () => ({ _min: { asOf: f.build.asOf } });
    const detail = await f.report.company(f.ctx, 'fiction-1', { month: f.body.month });
    const single = workbookParts((await f.report.export(f.ctx, { ...f.body, reportKey: 'detail', targetCompanyId: 'fiction-1' })).file).get('xl/worksheets/sheet1.xml')!;
    assert.match(cellXml(single, 'B10'), /ยอดรับสุทธิในเดือน/);
    assert.match(cellXml(single, 'J10'), /ใบเสร็จในเดือน/); assert.match(cellXml(single, 'J7'), new RegExp(`<v>${detail.month!.usage.expenseReceiptCountInPeriod}</v>`));
    assert.match(cellXml(single, 'R10'), /วันใช้งาน/); assert.match(cellXml(single, 'R7'), new RegExp(`<v>${detail.month!.usage.activeDays}</v>`));
    assert.doesNotMatch(cellXml(single, 'B10'), /บริษัทลูกค้า/);
  });
  it('matches overview and all filtered list rows, preserves negatives, ties, unknowns and no personal audit data', async () => {
    const f = exportSourceFixture(), overview = await f.report.overview(f.ctx, { month: f.body.month });
    const output = await f.report.export(f.ctx, f.body), parts = workbookParts(output.file), sheet = parts.get('xl/worksheets/sheet1.xml')!;
    assert.match(cellXml(sheet, 'B7'), new RegExp(`<v>${overview.metrics.companies.value}</v>`));
    assert.match(cellXml(sheet, 'J7'), new RegExp(`<v>${overview.metrics.activeCompanies.value}</v>`));
    assert.match(cellXml(sheet, 'R7'), new RegExp(`<v>${overview.metrics.netReceiptsSatang.value! / 100}</v>`));
    assert.equal(output.rowCount, 15); assert.equal(f.stats().transactions, 2); assert.equal(f.stats().contacts, 0);
    const source = parts.get('xl/worksheets/sheet2.xml')!;
    assert.equal(sourceCellXml(source, 'ใบเสร็จสะสม'), ''); assert.match(sourceCellXml(source, 'ยอดรับสุทธิในเดือน (บาท)'), /<v>-12.34<\/v>/);
    assert.doesNotMatch([...parts.values()].join(''), /fiction-0|fixture-build|fixture-version|@|081\d{7}/);
    const companies = await f.report.companies(f.ctx, { month: f.body.month, paidEver: 'YES', pageSize: 1, sortBy: 'netReceipts' });
    const filtered = await f.report.export(f.ctx, { ...f.body, reportKey: 'companies', filters: { paidEver: 'YES' }, sortBy: 'netReceipts', sortDir: 'desc' });
    assert.equal(filtered.rowCount, companies.pagination.total); assert.equal(filtered.rowCount, 14);
    const top = await f.report.export(f.ctx, { ...f.body, reportKey: 'revenue', subview: 'top', sortBy: 'netReceipts' });
    const topSheet = workbookParts(top.file).get('xl/worksheets/sheet2.xml')!;
    assert.match(workbookParts(top.file).get('xl/charts/chart1.xml')!, /<c:dPt><c:idx val="1"\/>[\s\S]*?<a:srgbClr val="D1D5DB"/);
    assert.match(sourceCellXml(topSheet, 'อันดับตามยอดรับสุทธิ'), /<v>1<\/v>/); assert.match(sourceCellXml(topSheet, 'อันดับตามยอดรับสุทธิ', 8), /<v>1<\/v>/);
    const audit = f.audits.at(-1); assert.equal(audit.metadataJson.exportReference, top.exportReference); assert.equal(audit.companyId, undefined);
    assert.doesNotMatch(JSON.stringify(audit.metadataJson), /ร้านสมมติ|บริษัท สมมติ|ผู้ส่งออกสมมติ|email|phone/);
  });
  it('blanks unavailable money and cost, labels partial values, keeps contact columns opt-in and rechecks revocation', async () => {
    const f = exportSourceFixture(); f.build.billingSince = new Date('2026-10-01T00:00:00Z'); f.build.aiUsageSince = new Date('2026-10-01T00:00:00Z');
    const out = await f.report.export(f.ctx, f.body), parts = workbookParts(out.file), source = parts.get('xl/worksheets/sheet2.xml')!;
    for (const label of ['เงินรับในเดือน (บาท)', 'คืนเงินในเดือน (บาท)', 'ยอดรับสุทธิในเดือน (บาท)', 'ค่าธรรมเนียมการรับชำระในเดือน (บาท)', 'ต้นทุนผู้ช่วยและการอ่านใบเสร็จในเดือน (บาท)']) assert.equal(sourceCellXml(source, label), '');
    assert.match(sourceCellXml(source, 'หมายเหตุข้อมูล'), /ข้อมูลการชำระไม่ครบ/);
    // The money card keeps its card box without a number, and every unavailable figure uses the screen's words.
    const dashboard = parts.get('xl/worksheets/sheet1.xml')!;
    assert.match(dashboard, /<c r="R7" s="11"\/>/);
    assert.match(cellXml(dashboard, 'R11'), /ยังไม่มีตัวเลข/);
    const netRows = [...dashboard.matchAll(/<row r="(\d+)"[^>]*>[\s\S]*?<\/row>/g)]
      .filter(row => Number(row[1]) > 48 && /เงินรับในเดือน|คืนเงินในเดือน|ยอดรับสุทธิในเดือน/.test(cellXml(row[0], `B${row[1]}`)) && cellXml(row[0], `H${row[1]}`));
    assert.equal(netRows.length, 3);
    for (const row of netRows) assert.match(cellXml(row[0], `H${row[1]}`), /ยังไม่มีตัวเลข/);
    assert.doesNotMatch(dashboard, /ยังไม่มีข้อมูล/);
    assert.doesNotMatch(source, />อีเมล<|>เบอร์โทร</); assert.equal(f.stats().contacts, 0);
    const contacts = await f.report.export(f.ctx, { ...f.body, reportKey: 'companies', includeContacts: true });
    assert.match(workbookParts(contacts.file).get('xl/worksheets/sheet2.xml')!, />อีเมล<|>เบอร์โทร</);
    assert.equal(f.stats().contacts, 15);
    f.revoke(); await assert.rejects(() => f.report.export(f.ctx, f.body), e => statusOf(e) === 403 && codeOf(e) === 'EXECUTIVE_ACCESS_DENIED');
    const partial = exportSourceFixture(); partial.build.billingDataThrough = new Date('2026-09-15T00:00:00Z');
    partial.tx.executiveReportMonth.findUnique = async () => ({ revision: 1, revisedAt: null, asOf: partial.build.asOf, billingCoveredThrough: new Date('2026-09-15T00:00:00Z'), untiedCount: 0, beforeFirstBuild: true });
    const partialXml = workbookParts((await partial.report.export(partial.ctx, partial.body)).file).get('xl/worksheets/sheet1.xml')!;
    assert.match(cellXml(partialXml, 'J11'), /อย่างน้อย/); assert.match(cellXml(partialXml, 'R11'), /ยอดเฉพาะรายการที่ยืนยันแล้ว/);
  });
  it('rejects empty and oversized scopes, one concurrent request per actor, and audit failures before returning bytes', async () => {
    const empty = exportSourceFixture(0); await assert.rejects(() => empty.report.export(empty.ctx, empty.body), e => codeOf(e) === 'EXECUTIVE_EXPORT_EMPTY');
    const large = exportSourceFixture(10001); await assert.rejects(() => large.report.export(large.ctx, large.body), e => codeOf(e) === 'EXECUTIVE_EXPORT_LIMIT_EXCEEDED');
    const busy = exportSourceFixture(); let release!: () => void; let block = true;
    busy.tx.user.findUnique = async () => { if (block) { block = false; await new Promise<void>(resolve => { release = resolve; }); } return { displayName: 'ผู้ส่งออกสมมติ', status: 'ACTIVE' }; };
    const pending = busy.report.export(busy.ctx, busy.body);
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(() => busy.report.export(busy.ctx, busy.body), e => statusOf(e) === 429);
    release(); await pending;
    assert.equal(busy.audits.filter(row => row.action === 'executive.export.created').length, 2);
    const broken = exportSourceFixture(); (broken.report as any).audit.logOrThrow = async () => { throw new Error('audit unavailable'); };
    await assert.rejects(() => broken.report.export(broken.ctx, broken.body), /audit unavailable/);
  });
  it('exports 1000 companies inside the byte and time limits with cached figures', async () => {
    const f = exportSourceFixture(1000), began = Date.now(), out = await f.report.export(f.ctx, f.body);
    assert.equal(out.rowCount, 1000); assert.ok(out.file.length <= 20 * 1024 * 1024); assert.ok(Date.now() - began < 30000);
    assert.match(cellXml(workbookParts(out.file).get('xl/worksheets/sheet1.xml')!, 'B7'), /<v>1000<\/v>/);
  });
});

it('the fictional reference workbook is reproducible and every part contains only the invented company names and no contact-like data', async () => {
  const { fictionalExecutiveWorkbook, FICTIONAL_EXECUTIVE_COMPANIES } = await import('./fixtures/executive-export.fixture');
  const dir = join(__dirname, '../../../../..', 'docs/fixtures/executive');
  const files = readdirSync(dir).filter(name => name.endsWith('.xlsx'));
  assert.equal(files.length, 1);
  assert.deepEqual(readFileSync(join(dir, files[0]!)), fictionalExecutiveWorkbook());
  for (const name of files) {
    for (const [part, xml] of workbookParts(readFileSync(join(dir, name)))) {
      assert.doesNotMatch(xml, /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?<!\d)(?:0[2-9][ -]?(?:\d[ -]?){7,8}|\+?66[2-9](?:[ -]?\d){7,8})(?!\d)/, part);
      const companyNames = [...xml.matchAll(/<t[^>]*>(ร้าน[^<]+)<\/t>|<c:v>(ร้าน[^<]+)<\/c:v>/g)].map(match => match[1] ?? match[2]);
      for (const company of companyNames) assert.ok(FICTIONAL_EXECUTIVE_COMPANIES.includes(company!), `${part}: only invented companies`);
    }
  }
});

it('rechecks the current account and session before returning a file', async () => {
  const f = exportSourceFixture();
  f.ctx.sessionId = 'fictional-session';
  f.tx.authSession.findUnique = async () => ({ userId: f.ctx.userId, status: 'REVOKED', expiresAt: new Date('2030-01-01') });
  await assert.rejects(() => f.report.export(f.ctx, f.body), e => codeOf(e) === 'EXECUTIVE_ACCESS_DENIED');
});

it('HTTP export has both permissions, validated bodies, binary/no-store headers and an audit for failures before the action', async () => {
  const { ExecutiveReportController, ExecutiveExportDto, ExecutiveReportExceptionFilter } = await import('./presentation/http/executive-report.controller');
  const { ValidationPipe, ForbiddenException } = await import('@nestjs/common');
  const { GLOBAL_VALIDATION_PIPE_OPTIONS } = await import('../../common/pipes/validation-pipe.options');
  const { REQUIRED_PERMISSIONS_KEY } = await import('../../common/security/permissions.decorator');
  assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ExecutiveReportController.prototype.export), ['system.executive.read', 'system.executive.export']);
  assert.equal(Reflect.getMetadata('path', ExecutiveReportController.prototype.export), 'exports');
  const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
  const f = exportSourceFixture();
  await assert.rejects(() => pipe.transform({ ...f.body, total: 999 }, { type: 'body', metatype: ExecutiveExportDto }));
  const headers: Record<string, string> = {}; let sent: unknown;
  const res: any = { setHeader: (k: string, v: string) => { headers[k] = v; }, send: (file: unknown) => { sent = file; }, status: () => res, json: (body: unknown) => { sent = body; } };
  const controller = new ExecutiveReportController(f.report);
  await controller.export(f.body as never, { context: f.ctx } as never, res);
  assert.ok(Buffer.isBuffer(sent)); assert.equal(headers['Cache-Control'], 'no-store'); assert.equal(headers['X-Export-Row-Count'], '15');
  assert.equal(headers['Content-Disposition'], 'attachment; filename="executive-report.xlsx"');
  const audits: any[] = [];
  const filter = new ExecutiveReportExceptionFilter({ logOrThrow: async (entry: any) => { audits.push(entry); } } as never);
  const req = { method: 'POST', path: '/v1/system/executive/exports', headers: {}, context: f.ctx, body: { ...f.body, filters: { q: 'secret-name@example.test' } } };
  await filter.catch(new ForbiddenException('diagnostic'), { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as never);
  assert.equal((sent as any).code, 'EXECUTIVE_ACCESS_DENIED'); assert.equal((sent as any).message, 'คุณไม่มีสิทธิ์ส่งออกไฟล์นี้'); assert.equal(audits.length, 1);
  assert.doesNotMatch(JSON.stringify(audits[0]), /secret-name|diagnostic/); assert.equal(audits[0].companyId, undefined);
  await filter.catch(new ForbiddenException(), { switchToHttp: () => ({ getRequest: () => ({ ...req, path: '/V1/SYSTEM/EXECUTIVE/EXPORTS' }), getResponse: () => res }) } as never);
  assert.equal(audits.length, 2); assert.equal((sent as any).message, 'คุณไม่มีสิทธิ์ส่งออกไฟล์นี้');
});

it('the export slot is shared across API instances through a transaction advisory lock', async () => {
  const f = exportSourceFixture();
  f.tx.$queryRaw = async (parts: TemplateStringsArray) => parts.join('').includes('pg_try_advisory_xact_lock') ? [{ locked: false }] : [];
  // The fixture client keeps a copy of $queryRaw; exercise the actual transaction callback on tx.
  await assert.rejects(() => f.report.export(f.ctx, f.body), e => statusOf(e) === 429);
});


it('exports each analysis branch with the read API figures and preserves free company names in comparison', async () => {
  const f = exportSourceFixture();
  f.companies[0]!.name = 'ร้าน LINE · fiction-0';
  const cacheValues = (xml: string) => [...(xml.match(/<c:numCache>([\s\S]*?)<\/c:numCache>/)?.[1] ?? '').matchAll(/<c:pt idx="\d+"><c:v>([^<]+)<\/c:v>/g)].map(m => Number(m[1]));
  for (const view of ['industry', 'discovery', 'sales'] as const) {
    const read = await f.report.analysis(f.ctx, { month: f.body.month, section: 'customers', view });
    const parts = workbookParts((await f.report.export(f.ctx, { ...f.body, reportKey: 'customers', subview: view })).file);
    assert.deepEqual(cacheValues(parts.get('xl/charts/chart1.xml')!), read.groups!.map(group => group.companies.count));
    assert.deepEqual(cacheValues(parts.get('xl/charts/chart2.xml')!), read.groups!.map(group => group.netReceiptsSatang.value! / 100));
  }
  const revenue = await f.report.analysis(f.ctx, { month: f.body.month, section: 'revenue', view: 'summary' });
  const revenueSheet = workbookParts((await f.report.export(f.ctx, { ...f.body, reportKey: 'revenue', subview: 'summary' })).file).get('xl/worksheets/sheet1.xml')!;
  assert.match(cellXml(revenueSheet, 'B7'), new RegExp(`<v>${revenue.revenue!.receiptsSatang.value! / 100}</v>`));
  assert.match(cellXml(revenueSheet, 'J7'), new RegExp(`<v>${revenue.revenue!.refundsSatang.value! / 100}</v>`));
  assert.match(revenueSheet, /ยังไม่เปิดขาย/);
  const comparison = { dimension: 'company', sideA: 'fiction-0', sideB: 'fiction-1' };
  const compared = await f.report.analysis(f.ctx, { month: f.body.month, section: 'compare', ...comparison });
  const pair = workbookParts((await f.report.export(f.ctx, { ...f.body, reportKey: 'compare', comparison })).file);
  assert.match(pair.get('xl/charts/chart1.xml')!, /ร้าน LINE · fiction-0/);
  assert.deepEqual(cacheValues(pair.get('xl/charts/chart2.xml')!), [compared.comparison!.sideA.netReceiptsSatang.value! / 100, compared.comparison!.sideB.netReceiptsSatang.value! / 100]);
  assert.match(pair.get('xl/worksheets/sheet2.xml')!, /ฝั่งแรก|ฝั่งที่สอง/);
  const detail = workbookParts((await f.report.export(f.ctx, { ...f.body, reportKey: 'detail', targetCompanyId: 'fiction-0' })).file);
  assert.equal(detail.has('xl/charts/chart4.xml'), false); assert.doesNotMatch([...detail.values()].join(''), /doughnutChart/);
  const rank = await f.report.analysis(f.ctx, { month: f.body.month, section: 'usage', view: 'ranking', metric: 'aiRequests' });
  const ranked = workbookParts((await f.report.export(f.ctx, { ...f.body, reportKey: 'usage', subview: 'ranking', sortBy: 'aiRequests' })).file);
  assert.deepEqual(cacheValues(ranked.get('xl/charts/chart2.xml')!), rank.usageRanking!.items.map(item => item.value));
  assert.ok(ranked.get('xl/worksheets/sheet1.xml')!.includes(`'รายบริษัท'!${sourceColumnOf(ranked.get('xl/worksheets/sheet2.xml')!, 'ใช้ผู้ช่วยในเดือน (ครั้ง)')}7`));
  const credited = await f.report.export(f.ctx, { ...f.body, reportKey: 'customers', subview: 'creditedSales' });
  assert.match(workbookParts(credited.file).get('xl/worksheets/sheet1.xml')!, /ยอดขายครั้งแรกของเซลล์/);
});

it('keeps unavailable concentration totals blank and labels partial usage', async () => {
  const f = exportSourceFixture(); f.build.billingSince = new Date('2026-10-01');
  const top = workbookParts((await f.report.export(f.ctx, { ...f.body, reportKey: 'revenue', subview: 'top' })).file).get('xl/worksheets/sheet1.xml')!;
  const tableRows = [...top.matchAll(/<row r="\d+"[^>]*>[\s\S]*?<\/row>/g)];
  const header = tableRows.findIndex(row => row[0].includes('บริษัทลูกค้า') && row[0].includes('ยอดติดลบรวม'));
  assert.ok(header >= 0); assert.doesNotMatch(tableRows[header + 1]![0], /<v>/);
  f.tx.executiveReportMonth.findUnique = async () => ({ revision: 1, asOf: new Date('2026-08-01'), billingCoveredThrough: f.build.asOf, beforeFirstBuild: true });
  const rank = workbookParts((await f.report.export(f.ctx, { ...f.body, reportKey: 'usage', subview: 'ranking' })).file);
  assert.match(sourceCellXml(rank.get('xl/worksheets/sheet2.xml')!, 'อันดับ'), /<v>1<\/v>/);
  assert.match(rank.get('xl/worksheets/sheet2.xml')!, /ข้อมูลการใช้งานไม่ครบ/);
});

it('allows the full 10000-company ranking even when the dashboard calculation table adds rows', async () => {
  const f = exportSourceFixture(10000);
  const out = await f.report.export(f.ctx, { ...f.body, reportKey: 'usage', subview: 'ranking' });
  assert.equal(out.rowCount, 10000);
  const source = workbookParts(out.file).get('xl/worksheets/sheet2.xml')!;
  const header = source.match(/<row r="6"[^>]*>[\s\S]*?<\/row>/)![0];
  assert.equal(sourceColumnOf(source, 'บริษัท / ร้าน'), 'A');
  const lastColumn = [...header.matchAll(/<c r="([A-Z]+)6"/g)].at(-1)![1];
  assert.ok(source.includes(`autoFilter ref="A6:${lastColumn}10006"`));
});


it('writes company names, registered names, discovery details and business descriptions as text for every formula prefix', async () => {
  for (const prefix of ['=', '+', '-', '@', '\t', '\r']) {
    const f = exportSourceFixture(1), text = `${prefix}สมมติ*?~`;
    f.companies[0]!.name = text; f.companies[0]!.registeredName = `${text}จดทะเบียน`; f.companies[0]!.businessTypeOther = text; Object.assign(f.profiles[0]!, { businessTypeCode: 'OTHER', businessTypeOther: text });
    f.tx.companySignupRequest.findMany = async () => [{ companyId: 'fiction-0', discoverySourceOther: text }];
    const parts = workbookParts((await f.report.export(f.ctx, f.body)).file), source = parts.get('xl/worksheets/sheet2.xml')!;
    for (const label of ['บริษัท / ร้าน', 'ชื่อจดทะเบียน', 'ประเภทกิจการ', 'รายละเอียดที่ลูกค้าระบุ']) assert.match(sourceCellXml(source, label), /t="inlineStr"/);
    assert.doesNotMatch([...parts.values()].join(''), /<f>[^<]*สมมติ/);
    assert.doesNotMatch(source, /\t|\r/);
  }
});

it('explains each blocked concentration from its actual reason without saying known report data is absent', async () => {
  for (const [n, nonPositive, expected] of [[9, false, 'บริษัทน้อยเกินไปสำหรับการแบ่งกลุ่ม'], [15, true, 'ไม่มีบริษัทที่จ่ายมากกว่ายอดคืนเงินในเดือน จึงยังคำนวณสัดส่วนรายรับไม่ได้']] as const) {
    const f = exportSourceFixture(n);
    if (nonPositive) f.rows.forEach(row => { row.receiptsSatang = 0; });
    const parts = workbookParts((await f.report.export(f.ctx, { ...f.body, reportKey: 'revenue', subview: 'top' })).file);
    assert.match(parts.get('xl/worksheets/sheet1.xml')!, new RegExp(expected));
    assert.match(parts.get('xl/worksheets/sheet2.xml')!, new RegExp(expected));
    assert.doesNotMatch(parts.get('xl/worksheets/sheet1.xml')!, /ยังไม่มีข้อมูล/);
  }
});

it('maps a transaction that exceeds the export time limit to the same bounded-export refusal before sending bytes', async t => {
  const { performance } = await import('node:perf_hooks');
  let calls = 0;
  const clock = t.mock.method(performance, 'now', () => calls++ ? 30001 : 0);
  try {
    const f = exportSourceFixture();
    (f.report as any).load = async () => { throw new Error('transaction expired'); };
    await assert.rejects(() => f.report.export(f.ctx, f.body), e => codeOf(e) === 'EXECUTIVE_EXPORT_LIMIT_EXCEEDED');
    assert.equal(f.audits.at(-1).metadataJson.bytes, 0);
    calls = 0;
    const contacts = exportSourceFixture();
    await assert.rejects(() => contacts.report.export(contacts.ctx, { ...contacts.body, reportKey: 'companies', includeContacts: true }), e => codeOf(e) === 'EXECUTIVE_EXPORT_LIMIT_EXCEEDED');
    assert.equal(contacts.stats().contacts, 0, 'do not keep reading personal contacts after the time budget is spent');
  } finally { clock.mock.restore(); }
});

it('a failed audit before the export action returns an unavailable response without an unhandled filter rejection', async () => {
  const { ExecutiveReportExceptionFilter } = await import('./presentation/http/executive-report.controller');
  const { ForbiddenException } = await import('@nestjs/common');
  const f = exportSourceFixture(); let status = 0, payload: any;
  const response = { setHeader: () => {}, status: (n: number) => { status = n; return response; }, json: (body: any) => { payload = body; } };
  const filter = new ExecutiveReportExceptionFilter({ logOrThrow: async () => { throw Error('audit diagnostic'); } } as never);
  const request = { method: 'POST', path: '/v1/system/executive/exports', headers: {}, context: f.ctx };
  await filter.catch(new ForbiddenException(), { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as never);
  assert.equal(status, 503); assert.equal(payload.code, 'SOURCE_UNAVAILABLE'); assert.doesNotMatch(JSON.stringify(payload), /audit diagnostic/);
});

it('keeps all four native charts when a ranking has no positive items, without inventing a zero chart value', async () => {
  const f = exportSourceFixture(1);
  const parts = workbookParts((await f.report.export(f.ctx, { ...f.body, reportKey: 'usage', subview: 'ranking' })).file);
  assert.equal([...parts.keys()].filter(name => /^xl\/charts\/chart\d+\.xml$/.test(name)).length, 4);
  assert.match(parts.get('xl/worksheets/sheet1.xml')!, /ไม่มีรายการตามเงื่อนไขที่เลือก/);
  const empty = parts.get('xl/charts/chart2.xml')!;
  assert.match(empty, /'ภาพรวม'!\$G\$\d+:\$G\$\d+/);
  assert.doesNotMatch(empty.match(/<c:numCache>[\s\S]*?<\/c:numCache>/)![0], /<c:pt idx=/);
});


/** RP fixtures: the spec's three companies, all sources complete, plus the equal-length previous period. */
function rangeSourceFixture() {
  const f = exportSourceFixture(3), headers = new Map<string, any>();
  Object.assign(f.build, { firstMonth: '2026-04', billingSince: at('2026-03-31T17:00:00Z'), aiUsageSince: at('2026-03-31T17:00:00Z') });
  for (const month of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']) headers.set(month,
    { month, revision: month === '2026-07' ? 2 : 1, revisedAt: month === '2026-07' ? f.build.asOf : null, asOf: f.build.asOf,
      billingCoveredThrough: f.build.asOf, beforeFirstBuild: false, untiedCount: 0, untiedReceiptsSatang: 0, untiedRefundsSatang: 0, untiedOtherSatang: 0 });
  f.profiles.forEach((profile, i) => Object.assign(profile, { companyCreatedAt: at(['2026-06-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'][i]!),
    paidEver: 'YES', fullyRefunded: false, firstActivityAt: at('2026-07-02T00:00:00Z') }));
  const source: any[] = [];
  const put = (i: number, month: string, receipts: number, refunds: number, count: number, active: boolean) => source.push({ ...f.rows[i], month,
    definitionVersion: 1, buildId: month === '2026-07' ? 'older-hourly-build' : f.build.id,
    receiptsSatang: receipts, refundsSatang: refunds, expenseReceiptsWeb: count, activeDays: active ? 1 : 0, activeUsers: active ? 2 : 0,
    activeDaysLine: 0, activeDaysWeb: active ? 1 : 0, activeUsersLine: 0, activeUsersWeb: active ? 2 : 0, confirmedExpensesWeb: count,
    paidEver: receipts || i < 2 ? 'YES' : 'NO', paidEverReason: null, fullyRefunded: false,
    usageGroup: i === 2 ? 'NOT_PAID' : active ? 'ACTIVE' : 'INACTIVE', usageUnassessedReason: null,
    moneyByPurchaseKind: { FIRST_PURCHASE: { receiptsSatang: receipts, refundsSatang: refunds, feesSatang: 12, taxSatang: 0 } }, disputedInvoiceCount: receipts ? 1 : 0 });
  put(0, '2026-06', 20000, 0, 0, false);
  put(0, '2026-07', 10000, 0, 2, true); put(0, '2026-08', 10000, 15000, 1, true); put(0, '2026-09', 0, 0, 0, true);
  put(1, '2026-08', 5000, 0, 3, true); put(1, '2026-09', 20000, 3000, 2, false); put(2, '2026-09', 0, 0, 0, false);
  const requested = (where: any, month: string) => typeof where.month === 'string' ? where.month === month
    : where.month?.in ? where.month.in.includes(month) : (!where.month?.gte || month >= where.month.gte) && (!where.month?.lte || month <= where.month.lte);
  f.tx.executiveReportMonth.findFirst = async () => ({ month: '2026-04' });
  f.tx.executiveReportMonth.findUnique = async (args: any) => headers.get(args.where.month_definitionVersion.month) ?? null;
  f.tx.executiveReportMonth.findMany = async (args: any = {}) => [...headers.values()].filter(row => requested(args.where ?? {}, row.month));
  f.tx.executiveCompanyMonth.findMany = async (args: any) => source.filter(row => requested(args.where, row.month));
  f.tx.company.findUnique = async (args: any) => ({ ...f.companies.find(row => row.id === args.where.id), createdAt: f.profiles.find(row => row.companyId === args.where.id)?.companyCreatedAt });
  f.tx.executiveCompanyMonth.aggregate = async () => ({ _sum: { salesCreditSatang: 0 } });
  f.tx.executiveReportBuild.aggregate = async () => ({ _min: { asOf: at('2026-03-01T00:00:00Z') } });
  f.tx.executiveCompanyProfile.findUnique = async (args: any) => f.profiles.find(row => row.companyId === args.where.companyId);
  f.tx.auditLog = { findMany: async () => [] };
  (f.report as any).billing.companyPackagePurchases = async () => [];
  return { ...f, headers, source, query: { from: '2026-07', to: '2026-09' } };
}

describe('executive period range RP01–RP19 without PostgreSQL', () => {
  it('RP01 accepts month pairs and legacy month, rejects incomplete, mixed, reversed, future and daily inputs', async () => {
    const f = rangeSourceFixture();
    const paired = await f.report.overview(f.ctx, f.query as any);
    assert.equal((paired.period as any).monthCount, 3);
    assert.equal(paired.period.appliedPreset, null);
    assert.equal((await f.report.overview(f.ctx, { month: '2026-09' })).period.month, '2026-09');
    for (const query of [{ from: '2026-07' }, { to: '2026-09' }, {}, { ...f.query, month: '2026-09' },
      { from: '2026-13', to: '2026-09' }, { from: '2026-09', to: '2026-07' }, { from: '2026-09', to: '2026-11' },
      { from: '2026-09-01', to: '2026-09-30' }, { ...f.query, preset: 'ALL' }]) {
      await assert.rejects(() => f.report.overview(f.ctx, query as any), e => statusOf(e) === 400 && codeOf(e) === 'EXECUTIVE_QUERY_INVALID');
    }
  });
  it('RP02–RP03 resolves Bangkok defaults, shortened preset starts, ALL and unbuilt boundaries without hiding interior gaps', async () => {
    const f = rangeSourceFixture();
    f.report.clock = () => at('2026-09-30T17:00:00Z');
    let context: any = await f.report.context(f.ctx);
    assert.deepEqual(context.defaultPeriod, { from: '2026-09', to: '2026-09', appliedPreset: 'LAST_MONTH' });
    assert.deepEqual(context.presets.find((p: any) => p.key === 'THIS_YEAR'), { key: 'THIS_YEAR', from: '2026-04', to: '2026-10', available: true, unbuiltBoundaryMonths: [] });
    f.headers.delete('2026-08'); f.headers.delete('2026-10');
    context = await f.report.context(f.ctx);
    assert.equal(context.presets.find((p: any) => p.key === 'THIS_MONTH').available, false);
    assert.deepEqual([context.presets.find((p: any) => p.key === 'ALL').from, context.presets.find((p: any) => p.key === 'ALL').to], ['2026-04', '2026-09']);
    assert.ok(!context.builtMonths.includes('2026-08'));
    await assert.rejects(() => f.report.overview(f.ctx, { from: '2026-08', to: '2026-09' } as any), e => statusOf(e) === 503 &&
      codeOf(e) === 'EXECUTIVE_REPORT_UNAVAILABLE' && JSON.stringify((e as any).getResponse().unbuiltMonths) === '["2026-08"]');
    f.report.clock = () => at('2026-10-07T17:00:00Z');
    assert.equal((await f.report.context(f.ctx) as any).defaultPeriod.appliedPreset, 'THIS_MONTH');
    f.headers.clear(); assert.ok((await f.report.context(f.ctx) as any).presets.every((p: any) => !p.available));
  });
  it('RP04–RP06/RP19 aggregates before ranking, unions companies, applies end flags and partitions current dimensions', async () => {
    const f = rangeSourceFixture(), overview: any = await f.report.overview(f.ctx, f.query as any);
    assert.deepEqual([overview.metrics.companies.value, overview.metrics.activeCompanies.value, overview.metrics.companiesWithReceipts.value,
      overview.metrics.netReceiptsSatang.value, overview.metrics.newCompanies.value], [3, 2, 2, 27000, 2]);
    const directory: any = await f.report.companies(f.ctx, { ...f.query, sortBy: 'netReceipts' } as any);
    assert.deepEqual(directory.items.map((r: any) => [r.id, r.metrics.netReceiptsSatang]), [['fiction-1', 22000], ['fiction-0', 5000], ['fiction-2', 0]]);
    assert.equal(directory.summary.netReceiptsSatang.value, 27000);
    const newCompanies = await f.report.companies(f.ctx, overview.metrics.newCompanies.drilldownFilters);
    assert.equal(newCompanies.pagination.total, 2);
    assert.equal(directory.items[0].metrics.activeUsers, null);
    assert.equal(overview.paidUsage.groups.find((g: any) => g.key === 'ACTIVE').count, 2);
    assert.equal(overview.paidUsage.groups.find((g: any) => g.key === 'NOT_PAID').count, 1);
    const groups = await f.report.analysis(f.ctx, { ...f.query, section: 'customers' } as any);
    assert.equal(groups.groups!.reduce((n, g) => n + g.netReceiptsSatang.value!, 0), 27000);
    assert.equal(groups.groups!.reduce((n, g) => n + g.activeCompanies.value!, 0), 2);
    const detail: any = await f.report.company(f.ctx, 'fiction-0', f.query as any);
    assert.equal(detail.periodSummary.money.netReceiptsSatang.value, 5000);
    assert.equal(detail.periodSummary.usage.expenseReceiptCountInPeriod, 3);
    assert.equal(detail.periodComparisons.activeDays.absoluteChange, 3);
    assert.equal(detail.monthlyHistory.length, 3);
    assert.deepEqual(detail.months.map((m: any) => m.revision), [2, 1, 1]);
    // The current profile label wins over the old month's label, without requiring the old row's buildId to match.
    f.profiles[1]!.reportClassification = 'TEST';
    const relabelled: any = await f.report.overview(f.ctx, f.query as any);
    assert.equal(relabelled.metrics.netReceiptsSatang.value, 5000);
    assert.equal(relabelled.population.excludedTestInternalNetReceiptsSatang, 22000);
    f.build.unclassifiedCount = 1; f.profiles[2]!.reportClassification = null as any; f.profiles[2]!.companyCreatedAt = at('2026-10-01T00:00:00Z');
    const beforeSignup = await f.report.overview(f.ctx, f.query);
    assert.equal(beforeSignup.metrics.companies.unclassifiedCount, 0); assert.equal(beforeSignup.population.unclassifiedCount, 0);
  });
  it('RP07 preserves interior gaps and metric-specific known values; before signup is not a source gap', async () => {
    const f = rangeSourceFixture(); f.headers.delete('2026-08');
    const data: any = await f.report.overview(f.ctx, f.query as any);
    assert.deepEqual(data.months.map((m: any) => [m.month, m.built]), [['2026-07', true], ['2026-08', false], ['2026-09', true]]);
    assert.deepEqual([data.metrics.activeCompanies.value, data.metrics.activeCompanies.knownValue, data.metrics.activeCompanies.coverage], [null, 1, 'partial']);
    assert.deepEqual(data.metrics.netReceiptsSatang.affectedMonths, [{ month: '2026-08', reasonCodes: ['RANGE_MONTH_NOT_BUILT'] }]);
    const concentration = (await f.report.analysis(f.ctx, { ...f.query, section: 'revenue', view: 'top' })).spendConcentration!;
    assert.equal(concentration.positiveCompanyCount, null);
    assert.equal(data.metrics.netReceiptsSatang.knownValue, 27000); // Only July + September, not the stored orphan August rows.
    const detail: any = await f.report.company(f.ctx, 'fiction-2', f.query as any);
    assert.deepEqual(detail.monthlyHistory[0].reasonCodes, ['NOT_YET_REGISTERED']);
    f.profiles[2]!.companyCreatedAt = at('2026-10-01T00:00:00Z');
    const later: any = await f.report.company(f.ctx, 'fiction-2', f.query as any);
    assert.equal(later.periodSummary, null); assert.deepEqual(later.periodReasonCodes, ['NOT_YET_REGISTERED']);
  });
  it('RP07/RP08 never invents distinct users, invoices or missing-row zeroes and keeps cost coverage separate', async () => {
    const f = rangeSourceFixture(), detail: any = await f.report.company(f.ctx, 'fiction-0', f.query as any);
    assert.equal(detail.periodSummary.usage.activeUsers, null);
    assert.equal(detail.monthlyHistory[0].summary.usage.activeUsers, 2);
    assert.equal(detail.monthlyHistory[0].summary.disputedInvoiceCount.value, 1);
    const revenue: any = await f.report.analysis(f.ctx, { ...f.query, section: 'revenue' } as any);
    assert.equal(revenue.revenue.disputedInvoiceCount, null);
    assert.equal(revenue.revenue.trend[0].disputedInvoiceCount.value, 1);
    f.source.splice(f.source.findIndex(r => r.companyId === 'fiction-0' && r.month === '2026-08'), 1);
    const missing: any = await f.report.overview(f.ctx, f.query as any);
    assert.equal(missing.metrics.netReceiptsSatang.coverage, 'partial');
    assert.equal(missing.metrics.netReceiptsSatang.affectedMonths[0].month, '2026-08');
    const one: any = await f.report.company(f.ctx, 'fiction-0', { from: '2026-07', to: '2026-07' } as any);
    assert.equal(one.periodSummary.usage.activeUsers, 2);
    f.build.aiUsageSince = at('2026-08-15T00:00:00Z');
    const costs: any = await f.report.company(f.ctx, 'fiction-1', f.query as any);
    assert.equal(costs.periodSummary.money.netReceiptsSatang.coverage, 'complete');
    assert.equal(costs.periodSummary.money.aiCostSatang.coverage, 'partial');
    assert.equal(costs.periodSummary.money.aiCostSatang.affectedMonths[0].month, '2026-08');
  });
  it('RP07 reconciles purchase-kind totals with confirmed money when a stored month predates collection', async () => {
    const f = rangeSourceFixture();
    f.build.billingSince = at('2026-07-31T17:00:00Z');
    const revenue = (await f.report.analysis(f.ctx, { ...f.query, section: 'revenue' })).revenue!;
    assert.equal(revenue.netReceiptsSatang.knownValue, 17000);
    for (const key of ['receiptsSatang', 'refundsSatang', 'netReceiptsSatang', 'feesSatang', 'taxSatang'] as const)
      assert.equal(revenue.byPurchaseGroup.reduce((total, group) => total + (group[key].knownValue ?? group[key].value ?? 0), 0), revenue[key].knownValue);
  });
  it('RP07/RP15 scopes directory and detail coverage to their companies and labels wholly unavailable cost truthfully', async () => {
    const f = rangeSourceFixture();
    f.source.splice(f.source.findIndex(row => row.companyId === 'fiction-1' && row.month === '2026-08'), 1);
    const directory = await f.report.companies(f.ctx, { ...f.query, q: f.companies[0]!.name });
    assert.equal(directory.summary.netReceiptsSatang.value, 5000);
    const body: any = { ...f.body, ...f.query, reportKey: 'detail', targetCompanyId: 'fiction-0' }; delete body.month;
    const words = await import('@watchdog-bms/contracts');
    const detail = workbookParts((await f.report.export(f.ctx, body)).file);
    assert.doesNotMatch(detail.get('xl/worksheets/sheet1.xml')!, new RegExp(words.EXECUTIVE_WORDS.partialMoney));
    const cost = rangeSourceFixture(); cost.build.aiUsageSince = at('2026-09-30T17:00:00Z');
    const costBody: any = { ...cost.body, ...cost.query }; delete costBody.month;
    const workbook = workbookParts((await cost.report.export(cost.ctx, costBody)).file);
    assert.match(workbook.get('xl/worksheets/sheet2.xml')!, new RegExp(words.EXECUTIVE_WORDS.unavailableFigure));
    assert.doesNotMatch(workbook.get('xl/worksheets/sheet2.xml')!, new RegExp(words.EXECUTIVE_WORDS.partialMeasuredMoney));
  });
  it('RP15 qualifies grouped partial money from money facts instead of an at-least count word', async () => {
    const f = rangeSourceFixture();
    f.source.splice(f.source.findIndex(row => row.companyId === 'fiction-1' && row.month === '2026-08'), 1);
    const body: any = { ...f.body, ...f.query, reportKey: 'customers', subview: 'industry' }; delete body.month;
    const { EXECUTIVE_WORDS, EXECUTIVE_REPORT_LABELS } = await import('@watchdog-bms/contracts');
    const dashboard = workbookParts((await f.report.export(f.ctx, body)).file).get('xl/worksheets/sheet1.xml')!;
    const groupRow = dashboard.match(/<row\b[^>]*>[\s\S]*?<\/row>/g)!.find(row => row.includes(EXECUTIVE_REPORT_LABELS.industry.FOOD_ACCOMMODATION!) && /<c r="F\d+"/.test(row));
    assert.ok(groupRow);
    assert.match(groupRow, new RegExp(EXECUTIVE_WORDS.partialMoney));
  });
  it('RP09 compares the previous equal-length population and distinguishes zero, negative, absent and partial bases', async () => {
    const f = rangeSourceFixture(), data: any = await f.report.overview(f.ctx, f.query as any);
    const comparison = data.metrics.netReceiptsSatang.comparison;
    assert.deepEqual([comparison.period.from, comparison.period.to, comparison.previous.value, comparison.absoluteChange, comparison.percentChange, comparison.status],
      ['2026-04', '2026-06', 20000, 7000, 35, 'COMPLETE']);
    assert.equal(data.metrics.companies.comparison.previous.value, 1);
    f.source.find(r => r.month === '2026-06').receiptsSatang = 0;
    assert.equal((await f.report.overview(f.ctx, f.query as any) as any).metrics.netReceiptsSatang.comparison.status, 'ZERO_BASE');
    f.source.find(r => r.month === '2026-06').refundsSatang = 100;
    assert.equal((await f.report.overview(f.ctx, f.query as any) as any).metrics.netReceiptsSatang.comparison.status, 'NEGATIVE_BASE');
    f.headers.delete('2026-05');
    assert.equal((await f.report.overview(f.ctx, f.query as any) as any).metrics.netReceiptsSatang.comparison.status, 'PARTIAL');
    f.headers.delete('2026-04'); f.headers.delete('2026-06');
    assert.equal((await f.report.overview(f.ctx, f.query as any) as any).metrics.netReceiptsSatang.comparison.status, 'NO_PREVIOUS');
  });
  it('RP10/RP19 keeps open-month actuals, monthly series and CURRENT values separate from temporal deltas', async () => {
    const f = rangeSourceFixture();
    const data: any = await f.report.overview(f.ctx, { from: '2026-09', to: '2026-10' } as any);
    assert.equal(data.period.includesOpenMonth, true);
    assert.equal(data.period.effectiveEndExclusive, f.build.asOf.toISOString());
    assert.equal(data.metrics.netReceiptsSatang.comparison.includesOpenMonth, true);
    assert.equal(data.expenseReceiptAdoption.timeBasis, 'CURRENT');
    assert.equal(data.expenseReceiptAdoption.comparison, undefined);
    assert.deepEqual(data.monthlySeries.find((s: any) => s.metric === 'netReceiptsSatang').points.map((p: any) => p.month), ['2026-09', '2026-10']);
  });
  it('API06 filters live allowlisted events to the applied range and records the period in audit', async () => {
    const f = rangeSourceFixture();
    f.tx.auditLog.findMany = async () => [{ createdAt: at('2026-08-02T00:00:00Z'), actorUserId: 'actor', metadataJson: { toStatus: 'SUSPENDED' } },
      { createdAt: at('2026-10-01T00:00:00Z'), actorUserId: 'actor', metadataJson: { toStatus: 'ACTIVE' } }];
    const history: any = await f.report.history(f.ctx, 'fiction-0', f.query as any);
    assert.deepEqual(history.items.map((e: any) => e.kind), ['SUSPENDED']);
    assert.equal(history.period.from, f.query.from); assert.equal(history.build.id, f.build.id);
    assert.deepEqual(f.audits.at(-1).metadataJson.period, f.query);
  });
  it('RP15/RP17 exports the applied range, monthly sources and previous figures with cached totals and blank distinct users', async () => {
    const f = rangeSourceFixture(), body: any = { ...f.body, ...f.query }; delete body.month;
    const output = await f.report.export(f.ctx, body), parts = workbookParts(output.file), source = parts.get('xl/worksheets/sheet2.xml')!, dashboard = parts.get('xl/worksheets/sheet1.xml')!;
    assert.equal(output.rowCount, 3); assert.match(cellXml(dashboard, 'R7'), /<v>270<\/v>/);
    assert.match(dashboard, /ช่วงเดือน ก.ค. 2569 ถึง ก.ย. 2569/); assert.match(dashboard, /ประวัติรายเดือน/); assert.match(dashboard, /เม.ย. 2569/);
    assert.match(source, /ใบเสร็จในช่วงนี้/); assert.equal(sourceCellXml(source, 'จำนวนผู้ใช้แยกเดือน'), '');
    assert.deepEqual(f.audits.at(-1).metadataJson.period, f.query);
    assert.doesNotMatch([...parts.values()].join(''), /fiction-0|older-hourly-build|DISTINCT_USERS/);
  });
  it('RP15 HTTP range download names the report and actual month pair in Thai', async () => {
    const { ExecutiveReportController } = await import('./presentation/http/executive-report.controller');
    const { EXECUTIVE_WORDS, executivePeriodLabel } = await import('@watchdog-bms/contracts');
    const { xlsxThaiDate } = await import('../../common/export/xlsx.logic');
    const f = rangeSourceFixture(), body: any = { ...f.body, ...f.query }; delete body.month;
    const headers: Record<string, string> = {};
    await new ExecutiveReportController(f.report).export(body, { context: f.ctx } as never,
      { setHeader: (key: string, value: string) => { headers[key] = value; }, send: () => {} } as never);
    assert.equal(headers['Content-Disposition'], `attachment; filename*=UTF-8''${encodeURIComponent(`${EXECUTIVE_WORDS.overview} ${executivePeriodLabel(f.query.from, f.query.to)} ${xlsxThaiDate(f.report.clock())}.xlsx`)}`);
  });
});


describe('executive period range boundary, cohort and HTTP regressions', () => {
  it('RP01 HTTP DTOs admit pairs and legacy requests but reject daily and unknown inputs before reading', async () => {
    const { ExecutiveReportQueryDto, ExecutiveCompanyQueryDto, ExecutiveHistoryQueryDto, ExecutiveExportDto } = await import('./presentation/http/executive-report.controller');
    const { ValidationPipe } = await import('@nestjs/common');
    const { GLOBAL_VALIDATION_PIPE_OPTIONS } = await import('../../common/pipes/validation-pipe.options');
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS), f = rangeSourceFixture();
    for (const metatype of [ExecutiveReportQueryDto, ExecutiveCompanyQueryDto, ExecutiveHistoryQueryDto]) {
      const pair: any = await pipe.transform(f.query, { type: 'query', metatype });
      assert.deepEqual([pair.from, pair.to], [f.query.from, f.query.to]);
      await pipe.transform({ month: '2026-09' }, { type: 'query', metatype });
      await assert.rejects(() => pipe.transform({ ...f.query, timezone: 'UTC' }, { type: 'query', metatype }));
      await assert.rejects(() => pipe.transform({ from: '2026-09-01', to: '2026-09-30' }, { type: 'query', metatype }));
    }
    const body: any = { ...f.body, ...f.query }; delete body.month;
    assert.equal((await pipe.transform(body, { type: 'body', metatype: ExecutiveExportDto }) as any).from, f.query.from);
    await assert.rejects(() => f.report.export(f.ctx, { ...body, filters: { from: '2026-07' } }), e => codeOf(e) === 'EXECUTIVE_QUERY_INVALID');
  });
  it('RP02/RP09 resolves quarter/year/year-crossing previous periods from Bangkok, not the machine date', async () => {
    const f = rangeSourceFixture(); f.report.clock = () => at('2026-12-31T17:00:00Z');
    const context: any = await f.report.context(f.ctx);
    assert.equal(context.currentMonth, '2027-01');
    assert.deepEqual(context.defaultPeriod, { from: '2026-12', to: '2026-12', appliedPreset: 'LAST_MONTH' });
    for (const key of ['THIS_QUARTER', 'THIS_YEAR']) assert.deepEqual([context.presets.find((p: any) => p.key === key).from, context.presets.find((p: any) => p.key === key).to], ['2027-01', '2027-01']);
    f.tx.executiveReportMonth.findFirst = async () => ({ month: '2025-12' });
    for (const month of ['2025-12', '2026-01']) f.headers.set(month, { ...f.headers.get('2026-09'), month });
    const data: any = await f.report.overview(f.ctx, { from: '2026-01', to: '2026-01' } as any);
    assert.deepEqual([data.metrics.companies.comparison.period.from, data.metrics.companies.comparison.period.to], ['2025-12', '2025-12']);
  });
  it('RP05/RP06 recomputes cohorts from signed range nets, never unions monthly payers or cutoff flags', async () => {
    const f = rangeSourceFixture();
    for (let i = 3; i < 10; i++) {
      f.profiles.push({ ...f.profiles[2]!, companyId: `extra-${i}` });
      f.companies.push({ ...f.companies[2]!, id: `extra-${i}` });
      f.source.push({ ...f.source.at(-1), companyId: `extra-${i}`, month: '2026-09' });
    }
    const first = { ...f.source[1], companyId: 'extra-3', month: '2026-07', receiptsSatang: 9000, refundsSatang: 0 };
    f.profiles[3]!.companyCreatedAt = at('2026-06-01T00:00:00Z');
    f.source.push(first, { ...first, month: '2026-08', receiptsSatang: 0, refundsSatang: 10000 });
    const result = await f.report.analysis(f.ctx, { ...f.query, section: 'revenue', view: 'top' } as any), concentration = result.spendConcentration!;
    assert.deepEqual([concentration.positiveCompanyCount, concentration.positiveNetTotalSatang, concentration.signedNetTotalSatang, concentration.topCount], [2, 27000, 26000, 2]);
    const list = await f.report.companies(f.ctx, { ...f.query, spendCohort: 'TOP20', sortBy: 'netReceipts' } as any);
    assert.deepEqual(list.items.map(row => row.id), ['fiction-1', 'fiction-0']);
    f.source.find(row => row.companyId === 'fiction-0' && row.month === '2026-07').fullyRefunded = true;
    assert.equal((await f.report.company(f.ctx, 'fiction-0', f.query as any) as any).periodSummary.fullyRefunded, false);
    f.source.find(row => row.companyId === 'fiction-0' && row.month === '2026-09').fullyRefunded = true;
    const overview = await f.report.overview(f.ctx, f.query as any);
    assert.equal(overview.paidUsage.fullyRefunded.count, 1); assert.equal(overview.paidUsage.groups.find(group => group.key === 'ACTIVE')!.count, 1);
  });
  it('RP07 returns no invented zero when all applicable company rows are missing', async () => {
    const f = rangeSourceFixture(); f.source.splice(0, f.source.length);
    const detail: any = await f.report.company(f.ctx, 'fiction-0', f.query as any);
    assert.equal(detail.periodSummary.money.netReceiptsSatang.coverage, 'unavailable');
    assert.equal(detail.periodSummary.money.netReceiptsSatang.knownValue, undefined);
    assert.equal(detail.periodSummary.usage.activeDays, null);
    assert.ok(detail.monthlyHistory.every((month: any) => month.summary === null));
  });
  it('RP09/RP10/RP19 compares side populations and rate points, suppresses incomplete deltas and does not truncate long series', async () => {
    const f = rangeSourceFixture();
    const comparison: any = (await f.report.analysis(f.ctx, { ...f.query, section: 'compare', dimension: 'company', sideA: 'fiction-0', sideB: 'fiction-1' } as any)).comparison;
    assert.equal(comparison.sideA.periodComparisons.netReceiptsSatang.absoluteChange, -15000);
    assert.equal(comparison.sideB.periodComparisons.netReceiptsSatang.previous.value, 0);
    const compared: any = await f.report.analysis(f.ctx, { ...f.query, section: 'compare', dimension: 'company', sideA: 'fiction-0', sideB: 'fiction-1' });
    assert.deepEqual(compared.monthlySeries.map((s: any) => s.side), ['A', 'B']);
    assert.deepEqual(compared.monthlySeries[0].points.map((p: any) => p.metricValue.value), [10000, -5000, 0]);
    const overview: any = await f.report.overview(f.ctx, f.query as any);
    assert.equal(overview.periodComparisons.activeCompanyShare.absoluteChange, 66.7);
    assert.equal(overview.periodComparisons.activeCompanyShare.percentChange, null);
    f.headers.get('2026-08').billingCoveredThrough = at('2026-08-15T00:00:00Z');
    const partial: any = await f.report.overview(f.ctx, f.query as any);
    assert.equal(partial.metrics.netReceiptsSatang.comparison.status, 'PARTIAL');
    assert.equal(partial.metrics.netReceiptsSatang.comparison.absoluteChange, null);
    const long: any = await f.report.analysis(f.ctx, { from: '2026-04', to: '2026-10', section: 'revenue' } as any);
    assert.equal(long.revenue.trend.length, 7); assert.equal(long.monthlySeries[0].points.length, 7);
    f.headers.get('2026-08').asOf = at('2026-08-15T00:00:00Z');
    const stale: any = await f.report.overview(f.ctx, f.query);
    assert.equal(stale.metrics.activeCompanies.coverage, 'partial');
    assert.ok(stale.metrics.activeCompanies.affectedMonths.some((m: any) => m.month === '2026-08' && m.reasonCodes.includes('SOURCE_STALE')));
  });
  it('RP18 preserves build reload/export expiry and counts range-export companies once', async () => {
    const f = rangeSourceFixture();
    const overview = await f.report.overview(f.ctx, { ...f.query, buildId: 'old' } as any);
    assert.equal(overview.buildChanged, true);
    const body: any = { ...f.body, ...f.query, buildId: 'old' }; delete body.month;
    await assert.rejects(() => f.report.export(f.ctx, body), e => statusOf(e) === 409 && codeOf(e) === 'EXECUTIVE_SNAPSHOT_EXPIRED');
    const output = await f.report.export(f.ctx, { ...body, buildId: f.build.id });
    assert.equal(output.rowCount, 3);
    assert.equal(f.audits.at(-1).metadataJson.companyCount, 3);
  });
  it('RP20 refuses unsafe range sums and rounds large integer ratios without floating intermediate products', async () => {
    assert.equal(roundRatio(1n, 0n, 0), null);
    assert.equal(roundRatio(9007199254740000n, 3n, 0), 3002399751580000);
    const f = rangeSourceFixture();
    for (const row of f.source) row.receiptsSatang = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
    await assert.rejects(() => f.report.overview(f.ctx, f.query), e => statusOf(e) === 503 && codeOf(e) === 'SOURCE_UNAVAILABLE');
  });

});

function sheetSourceFixture() {
  const f = rangeSourceFixture();
  f.profiles.forEach((p: any, i) => Object.assign(p, { businessTypeCode: 'OTHER', businessTypeOther: 'ร้านอาหาร', planEndsAt: at(i === 0 ? '2026-10-01T17:00:00Z' : i === 1 ? '2026-10-10T02:30:00Z' : '2026-10-03T05:00:00Z'), activeMemberCount: 2, branchCount: 1,
    firstActivityAt: i === 2 ? null : at('2026-07-01T00:00:00Z'), lastActivityAt: i === 2 ? null : at('2026-08-30T17:00:00Z'),
    expenseReceiptCountLifetime: [0, 5, 6][i], sheetFacts: { firstReceiptAt: i ? '2026-08-01T00:00:00Z' : null,
      lastReceiptAt: i ? '2026-10-02T00:00:00Z' : null, receipts7: i, receipts30: i + 1, receiptDays30: i, confirmed: i, pending: i, draft: 0, sourceCount: [0,5,6][i],
      unmatchedMoneyMonths: [], aiRequests30: i, aiUsageSince: '2026-01-01T00:00:00Z', activityHistorySince: '2026-01-01T00:00:00Z', activitySnapshotReady: true, receiptHistorySince: '2026-01-01T00:00:00Z', receiptCountersHeld: false } }));
  f.source.forEach(row => Object.assign(row, { activitySnapshotReady: true, activityHistorySince: at('2026-01-01T00:00:00Z'), lastActivityAt: row.month < '2026-09' ? at('2026-07-01T00:00:00Z') : row.companyId === 'fiction-2' ? null : at('2026-08-30T17:00:00Z') }));
  return f;
}

describe('executive owner sheet and churn without PostgreSQL', () => {
  it('uses Bangkok calendar months with clamping, strict boundary and day precision', async () => {
    const { inactivityAt } = await import('./domain/executive-company-sheet.logic');
    for (const [last, reference, expected] of [
      ['2026-08-30T17:00:00Z', '2026-09-29T17:00:00Z', false], // Aug31 to Sep30
      ['2026-08-30T17:00:00Z', '2026-09-30T17:00:00Z', true],
      ['2026-01-30T17:00:00Z', '2026-02-27T17:00:00Z', false],
      ['2026-01-30T17:00:00Z', '2026-02-28T17:00:00Z', true],
      ['2024-01-30T17:00:00Z', '2024-02-28T17:00:00Z', false],
      ['2026-09-02T23:59:00Z', '2026-10-03T00:00:00Z', false],
    ] as const) assert.equal(inactivityAt(at(last), at(reference)).churned, expected);
    assert.deepEqual(inactivityAt(null, NOW), { lastUseAt: null, daysSinceLastUse: null, churned: false });
    const { companyInactivity } = await import('./domain/executive-company-sheet.logic');
    const profile: any = { companyCreatedAt: at('2025-12-01T00:00:00Z'), firstActivityAt: at('2025-12-20T00:00:00Z') };
    const snapshot = { lastActivityAt: profile.firstActivityAt, activitySnapshotReady: true, activityHistorySince: at('2025-12-31T17:00:00Z') };
    const complete = { coverage: 'complete' as const, reasonCodes: [] };
    assert.equal(companyInactivity(profile, snapshot, at('2026-01-30T17:00:00Z'), complete).churned, null);
    assert.equal(companyInactivity(profile, snapshot, at('2026-01-31T17:00:00Z'), complete).churned, true);
  });
  it('returns historical churn from the cutoff snapshot with share, comparison and drilldown', async () => {
    const f = sheetSourceFixture();
    Object.assign(f.profiles[0]!, { lastActivityAt: at('2026-10-02T00:00:00Z') }); // must not rewrite September
    const result = await f.report.overview(f.ctx, f.query);
    assert.equal(result.churn.value, 0); assert.equal(result.churn.share?.denominator, 2);
    assert.equal(result.churn.referenceDate, '2026-09-30');
    assert.ok(result.churn.comparison); assert.equal(result.churn.drilldownFilters.churned, 'true');
    const october = await f.report.overview(f.ctx, { from: '2026-10', to: '2026-10' });
    assert.equal(october.churn.value, null); assert.ok(october.churn.reasonCodes.includes('MONTH_SUMMARY_INCOMPLETE'));
    const stale = sheetSourceFixture();
    stale.build.asOf = at('2026-09-30T03:00:00Z'); // report clock is October; September snapshot stopped before month end
    stale.headers.get('2026-09')!.asOf = stale.build.asOf;
    stale.source.find(row => row.month === '2026-09' && row.companyId === 'fiction-0').lastActivityAt = at('2026-08-01T00:00:00Z');
    const unfinished = await stale.report.overview(stale.ctx, { from: '2026-09', to: '2026-09' });
    assert.equal(unfinished.churn.value, null); assert.ok(unfinished.churn.reasonCodes.includes('MONTH_SUMMARY_INCOMPLETE'));
  });
  it('compares churn counts and share points with the previous equal-length period', async () => {
    const f = sheetSourceFixture();
    for (const row of f.source) if (row.month === '2026-08') row.lastActivityAt = at('2026-08-01T00:00:00Z');
    f.source.find(row => row.month === '2026-09' && row.companyId === 'fiction-1').lastActivityAt = at('2026-08-01T00:00:00Z');
    const result = await f.report.overview(f.ctx, { from: '2026-09', to: '2026-09' });
    assert.equal(result.churn.value, 1); assert.equal(result.churn.share?.value, 50);
    assert.equal(result.churn.comparison?.previous.value, 0); assert.equal(result.churn.comparison?.absoluteChange, 1);
    assert.equal(result.churn.share?.comparison?.absoluteChange, 50); assert.equal(result.churn.share?.comparison?.percentChange, null);
    assert.equal(result.churn.comparison?.status, 'ZERO_BASE');
    const list = await f.report.companies(f.ctx, { from: '2026-09', to: '2026-09', churned: 'true', sortBy: 'daysSinceLastUse' });
    assert.deepEqual(list.items.map(row => row.id), ['fiction-1']);
    assert.equal(list.items[0]!.inactivity.referenceDate, '2026-09-30');
    assert.equal(list.items[0]!.inactivity.daysSinceLastUse, 60);
    const never = await f.report.companies(f.ctx, { ...f.query, neverUsed: 'true' }); assert.deepEqual(never.items.map(row => row.id), ['fiction-2']);
  });
  it('returns rolling figures at the data date, bucket edges, filters and date/number sorts', async () => {
    const f = sheetSourceFixture(), result = await f.report.overview(f.ctx, f.query);
    assert.equal(result.asOfFigures.asOf, f.build.asOf.toISOString());
    assert.equal(result.asOfFigures.receiptsLifetime.value, 11);
    assert.deepEqual(result.asOfFigures.receiptBuckets.map(b => [b.key, b.value]), [['ZERO',1], ['ONE_TO_FIVE',1], ['SIX_PLUS',1]]);
    assert.equal(result.asOfFigures.receipts7.value, 2); assert.equal(result.asOfFigures.receiptDays30AtLeast2.value, 1);
    const list = await f.report.companies(f.ctx, { ...f.query, ...result.asOfFigures.receiptBuckets[1]!.drilldownFilters } as any);
    assert.deepEqual(list.items.map(row => row.id), ['fiction-1']);
    const recent = await f.report.companies(f.ctx, { ...f.query, receiptAdded30: 'true', sortBy: 'receipts30', sortDir: 'desc' });
    assert.deepEqual(recent.items.map(row => row.id), ['fiction-2', 'fiction-1', 'fiction-0']);
    assert.equal(recent.items[0]!.sheet.asOf, f.build.asOf.toISOString());
    assert.equal(recent.items[0]!.sheet.daysSinceLastReceipt, 1);
    assert.equal(recent.items[0]!.sheet.daysLeft, 0); assert.equal(recent.items[2]!.sheet.daysLeft, null); assert.equal(recent.items[2]!.sheet.packageExpired, true);
    assert.equal(recent.items[1]!.sheet.daysLeft, 7);
    assert.equal(recent.items[0]!.sheet.aiRequests30.value, 2);
    Object.assign(f.profiles[2]!, { planEndsAt: new Date(f.build.asOf.getTime() - 1) });
    const expiredToday = await f.report.companies(f.ctx, { ...f.query, receiptBucket: 'SIX_PLUS' });
    assert.equal(expiredToday.items[0]!.sheet.packageExpired, true); assert.equal(expiredToday.items[0]!.sheet.daysLeft, null);
    for (const profile of f.profiles) (profile as any).sheetFacts.receiptHistorySince = new Date(f.build.asOf.getTime() - 10 * 86_400_000).toISOString();
    const recentCoverage = await f.report.overview(f.ctx, f.query);
    assert.equal(recentCoverage.asOfFigures.receipts7.coverage, 'complete');
    assert.equal(recentCoverage.asOfFigures.receipts30.coverage, 'partial');
    const covered = await f.report.companies(f.ctx, f.query);
    assert.equal(covered.items[0]!.sheet.receipts7.coverage, 'complete');
    assert.equal(covered.items[0]!.sheet.confirmed.coverage, 'partial');
    for (const profile of f.profiles) Object.assign((profile as any).sheetFacts, { receiptHistorySince: '2026-01-01T00:00:00Z', receiptCountersHeld: true, purgedReceiptMonths: ['2026-06'] });
    const earlierPurge = await f.report.overview(f.ctx, f.query);
    assert.equal(earlierPurge.asOfFigures.receipts7.coverage, 'complete');
    assert.deepEqual(earlierPurge.sourceStatus.usage.affectedMonths?.map(month => month.month), ['2026-06']);
    for (const profile of f.profiles) (profile as any).sheetFacts.unmatchedMoneyMonths = ['2026-06'];
    const moneyStatus = await f.report.overview(f.ctx, f.query);
    assert.ok(moneyStatus.sourceStatus.money.reasonCodes.includes('UNMATCHED_MONEY'));
    assert.deepEqual(moneyStatus.sourceStatus.money.affectedMonths?.map(month => month.month), ['2026-06']);
    assert.equal((await f.report.companies(f.ctx, f.query)).items[0]!.sheet.lifetimeReceiptsSatang.coverage, 'partial');
  });
  it('carries source status once, missing months, cost coverage and applied money through date', async () => {
    const f = sheetSourceFixture(); f.headers.delete('2026-08');
    for (const response of [await f.report.overview(f.ctx, f.query), await f.report.companies(f.ctx, f.query), await f.report.analysis(f.ctx, { ...f.query, section: 'usage' })]) {
      assert.equal(response.coverage.aiCost.coverage, 'partial');
      assert.deepEqual(response.sourceStatus.money.affectedMonths?.map(m => m.month), ['2026-08']);
      assert.equal(response.sourceStatus.money.reasonCodes.filter(r => r === 'RANGE_MONTH_NOT_BUILT').length, 1);
      assert.equal(response.sourceStatus.money.dataThrough, null);
    }
  });
  it('reads notes through the merged service and audits one page of allowed contacts without values', async () => {
    const f = sheetSourceFixture();
    (f.report as any).notes = { get: async (_ctx: any, companyId: string) => ({ companyId, text: 'ติดตามแล้ว', version: 3, updatedAt: NOW.toISOString(), updatedBy: { userId: 'secret-person', displayName: 'ทีมงาน' }, canManage: true }) };
    f.tx.companyMembership.findMany = async () => [{ user: { email: 'private@example.test', phoneNumber: '0812345678' } }];
    const result = await f.report.companies(f.ctx, f.query);
    assert.equal(result.items[0]!.note.text, 'ติดตามแล้ว'); assert.equal(result.items[0]!.canEditNote, true);
    assert.equal(result.items[0]!.ownerContact.email, 'private@example.test');
    assert.doesNotMatch(JSON.stringify(result.items[0]!.note), /secret-person|userId/);
    assert.equal(f.audits.length, 1); assert.equal(f.audits[0].riskLevel, 'MEDIUM'); assert.equal(f.audits[0].metadataJson.contactsReturnedCompanyIds.length, 3);
    assert.doesNotMatch(JSON.stringify(f.audits), /private@example|0812345678|secret-person/);
    const denied = await f.report.companies({ ...f.ctx, permissions: ['system.executive.read'] }, f.query);
    assert.deepEqual(denied.items[0]!.ownerContact, { status: 'NOT_PERMITTED' });
  });
  it('exports the applied period and owner sheet columns with notes and safe account text', async () => {
    const f = sheetSourceFixture();
    f.companies[0]!.name = 'ร้านบัญชี 1234567890';
    f.tx.salesAgentProfile.findMany = async () => [{ userId: 'seller-id', salesCode: 'S001', user: { displayName: 'บัญชี 1234567890' } }];
    f.tx.user.findMany = async () => [{ id: 'seller-id', displayName: 'บัญชี 1234567890' }];
    for (const profile of f.profiles) Object.assign(profile, { referrerKind: 'KNOWN', referrerSalesUserId: 'seller-id' });
    Object.assign(f.profiles[0]!, { businessTypeOther: 'บัญชี ๑๒๓-๔๕๖-๗๘๙๐' });
    (f.report as any).notes = { get: async () => ({ text: 'โอนเข้าบัญชี 1234567890 แล้ว', version: 1, updatedAt: NOW.toISOString(), updatedBy: { displayName: 'ทีมงาน' }, canManage: false }) };
    const result = await f.report.export(f.ctx, { ...f.body, month: undefined, ...f.query, reportKey: 'companies' });
    assert.equal(result.period.from, '2026-07'); assert.equal(result.period.to, '2026-09');
    const parts = workbookParts(result.file), source = parts.get('xl/worksheets/sheet2.xml')!;
    const words = await import('@watchdog-bms/contracts');
    for (const label of words.EXECUTIVE_COMPANY_SHEET_COLUMNS.map(c => c.label)) if (!['อีเมล', 'เบอร์โทร'].includes(label)) assert.ok(source.includes(label), label);
    assert.ok(source.includes(words.EXECUTIVE_SHEET_WORDS.churn)); assert.ok(source.includes('ติดตาม') || source.includes('โอนเข้า'));
    assert.doesNotMatch([...parts.values()].join(''), /1234567890|๑๒๓-๔๕๖-๗๘๙๐/);
    (f.profiles[1] as any).sheetFacts.receiptCountersHeld = true; // five known receipts cannot prove the 1–5 group
    const overview = workbookParts((await f.report.export(f.ctx, { ...f.body, month: undefined, ...f.query, reportKey: 'overview' })).file);
    const cache = overview.get('xl/charts/chart2.xml')!.match(/<c:numCache>([\s\S]*?)<\/c:numCache>/)![1]!;
    assert.match(cache, /<c:pt idx="1"><c:v>0<\/c:v>/);
    assert.ok(overview.get('xl/worksheets/sheet1.xml')!.includes(words.EXECUTIVE_SHEET_WORDS.asOfHelp));
    const { xlsxThaiDate } = await import('../../common/export/xlsx.logic');
    assert.ok(overview.get('xl/worksheets/sheet1.xml')!.includes(`${words.EXECUTIVE_SHEET_WORDS.asOf} · ${xlsxThaiDate(f.build.asOf)}`));
    assert.ok(overview.get('xl/worksheets/sheet1.xml')!.includes('สัดส่วนจากบริษัทที่เคยใช้'));
  });
});

describe('executive owner sheet source and permission boundaries', () => {
  it('keeps data-date drilldowns independent of a past period and includes later signups', async () => {
    const f = sheetSourceFixture(); Object.assign(f.profiles[2]!, { companyCreatedAt: at('2026-10-01T00:00:00Z') });
    const overview = await f.report.overview(f.ctx, f.query);
    assert.equal(overview.metrics.companies.value, 2); assert.equal(overview.asOfFigures.companies.value, 3);
    const list = await f.report.companies(f.ctx, { ...f.query, atDataDate: 'true', receiptBucket: 'SIX_PLUS' });
    assert.equal(list.pagination.total, 1); assert.equal(list.items[0]!.id, 'fiction-2');
    assert.equal(list.items[0]!.metrics.activeDays, null); assert.equal(list.items[0]!.metrics.netReceiptsSatang, null);
    const label = overview.asOfFigures.packages[0]!.label;
    assert.doesNotMatch(label, /[A-Za-z_]/);
    const labelled = await f.report.companies(f.ctx, { month: '2026-09', packageLabel: label });
    assert.equal(labelled.appliedFilters.directory.packageLabel!.label, label);
    await assert.rejects(f.report.companies(f.ctx, { ...f.query, packageLabel: 'made-up-package' }), error => codeOf(error) === 'EXECUTIVE_QUERY_INVALID');
  });
  it('qualifies unknown snapshots and held receipt counters once at source level without false bucket zeroes', async () => {
    const f = sheetSourceFixture(); Object.assign(f.profiles[0]!, { sheetFacts: null });
    const facts: any = (f.profiles[1] as any).sheetFacts; facts.receiptCountersHeld = true; facts.sourceCount = 1;
    const overview = await f.report.overview(f.ctx, f.query);
    assert.equal(overview.asOfFigures.receiptsLifetime.coverage, 'partial');
    assert.equal(overview.asOfFigures.receiptBuckets[0]!.value, null);
    assert.ok(overview.sourceStatus.usage.reasonCodes.includes('SHEET_FACTS_NOT_BUILT'));
    assert.ok(overview.sourceStatus.usage.reasonCodes.includes('SOURCE_ROWS_PURGED'));
    const list = await f.report.companies(f.ctx, { ...f.query, receiptBucket: 'ONE_TO_FIVE' });
    assert.equal(list.pagination.total, 0);
  });
  it('fails closed if contact audit fails and uses the existing note write/concurrency boundary', async () => {
    const f = sheetSourceFixture(), writes: any[] = [];
    (f.report as any).notes = { get: async () => ({ text: '', version: 0, updatedAt: null, updatedBy: null, canManage: false }), put: async (ctx: any, id: string, body: any) => {
      writes.push({ ctx, id, body });
      if (body.expectedVersion !== 2) { const { ConflictException } = await import('@nestjs/common'); throw new ConflictException({ code: 'company_team_note_version_conflict' }); }
      return { text: body.text, version: 3, updatedAt: NOW.toISOString(), updatedBy: { displayName: 'ทีมงาน', userId: 'internal-person' }, canManage: true };
    } };
    const body = { text: 'ติดตามแล้ว', expectedVersion: 2 }, editor = { ...f.ctx, permissions: [...f.ctx.permissions, 'system.executive.company_note.manage'] };
    for (const ctx of [f.ctx, { ...editor, roles: ['SYSTEM_ADMIN'] }]) await assert.rejects(f.report.updateNote(ctx, 'fiction-0', body), error => statusOf(error) === 403);
    assert.equal(writes.length, 0);
    const { ExecutiveReportExceptionFilter } = await import('./presentation/http/executive-report.controller');
    const { HttpException } = await import('@nestjs/common');
    for (const [ctx, expected] of [[f.ctx, 'คุณไม่มีสิทธิ์แก้ไขหมายเหตุของทีมมั่งมี'], [{ ...editor, roles: ['SYSTEM_ADMIN'] }, 'กรุณาแก้ไขหมายเหตุผ่านหน้าผู้ดูแลระบบ']] as const) {
      let payload: any; const response = { setHeader: () => response, status: () => response, json: (value: any) => { payload = value; } };
      await new ExecutiveReportExceptionFilter({} as any).catch(new HttpException({}, 403), { switchToHttp: () => ({ getRequest: () => ({ method: 'PATCH', context: ctx }), getResponse: () => response }) } as any);
      assert.equal(payload.message, expected);
    }
    const result = await f.report.updateNote(editor, 'fiction-0', body);
    assert.equal(result.note.version, 3); assert.equal(result.canEditNote, true); assert.deepEqual(writes[0].body, body); assert.doesNotMatch(JSON.stringify(result), /internal-person/);
    await assert.rejects(f.report.updateNote(editor, 'fiction-0', { ...body, expectedVersion: 1 }), error => statusOf(error) === 409);
    f.tx.companyMembership.findMany = async () => [{ user: { email: 'secret@example.test', phoneNumber: null } }];
    (f.report as any).audit.logOrThrow = async () => { throw new Error('audit failed'); };
    await assert.rejects(f.report.companies(f.ctx, f.query), /audit failed/);
  });
  it('validates all new HTTP filters, sorts and note-version fields and exports contacts with both rights', async () => {
    const { plainToInstance } = await import('class-transformer'), { validate } = await import('class-validator');
    const { ExecutiveCompaniesQueryDto, ExecutiveCompanyNoteDto, ExecutiveReportController } = await import('./presentation/http/executive-report.controller');
    assert.equal((await validate(plainToInstance(ExecutiveCompaniesQueryDto, { from: '2026-09', to: '2026-09', receiptBucket: 'ONE_TO_FIVE', receiptAdded7: 'true', churned: 'true', sortBy: 'lastReceiptAt' }))).length, 0);
    assert.ok((await validate(plainToInstance(ExecutiveCompaniesQueryDto, { churned: 'false', receiptBucket: '5', sortBy: 'secret' }))).length);
    for (const expectedVersion of [-1, 1.5, '2', null]) assert.ok((await validate(plainToInstance(ExecutiveCompanyNoteDto, { text: 'ข้อความ', expectedVersion }))).length);
    const f = sheetSourceFixture(), body = { ...f.body, month: undefined, ...f.query, reportKey: 'companies' as const, includeContacts: true };
    await assert.rejects(f.report.export({ ...f.ctx, permissions: ['system.executive.read', 'system.executive.export'] }, body), error => statusOf(error) === 403);
    f.tx.companyMembership.findMany = async () => [{ user: { email: 'allowed@example.test', phoneNumber: '0812345678' } }];
    const file = await f.report.export(f.ctx, body), source = workbookParts(file.file).get('xl/worksheets/sheet2.xml')!;
    assert.match(sourceCellXml(source, 'อีเมล'), /allowed@example.test/); assert.match(sourceCellXml(source, 'เบอร์โทร'), /0812345678/);
    const applied = { ...file, period: { ...file.period, from: '2026-08', to: '2026-09' } }, headers: Record<string, string> = {};
    const controller = new ExecutiveReportController({ export: async () => applied, clock: () => NOW } as any);
    await controller.export(body, { context: f.ctx } as any, { setHeader: (k: string, v: string) => { headers[k] = v; }, send: () => undefined } as any);
    assert.match(decodeURIComponent(headers['Content-Disposition']!), /ส.ค. 2569 ถึง ก.ย. 2569/); assert.doesNotMatch(decodeURIComponent(headers['Content-Disposition']!), /ก.ค./);
  });
});
