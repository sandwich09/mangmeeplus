import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { HttpException, Injectable } from '@nestjs/common';
import {
  DBD_TSIC_ACTIVITIES, EXECUTIVE_FLAG_LABELS, EXECUTIVE_NO_PLAN_DATA_LABEL, EXECUTIVE_UNKNOWN_LABEL, EXECUTIVE_PAID_EVER_REASONS, EXECUTIVE_PURCHASE_GROUPS, EXECUTIVE_REPORT_LABELS, EXECUTIVE_SORT_OPTIONS,
  billingPlanLabel, EXECUTIVE_EXPORT_REPORT_KEYS, EXECUTIVE_WORDS as W, EXECUTIVE_REFERRER_ADMIN_SUFFIX, executiveThaiLabel, executiveComparisonLabel, executiveExportColumns,
  type ExecutiveExportBody,
  type ExecutiveAnalysis, type ExecutiveAnalysisQuery, type ExecutiveCompanies, type ExecutiveCompaniesQuery, type ExecutiveCompanyDetail,
  type ExecutiveCompanyHistory, type ExecutiveCompanyRow, type ExecutiveCompareSide, type ExecutiveContext, type ExecutiveDrilldownFilters,
  type ExecutiveEnvelope, type ExecutiveFilterKey, type ExecutiveGroupRow, type ExecutiveHistoryEvent, type ExecutiveHistoryEventKind,
  type ExecutiveHistoryQuery, type ExecutiveMoneyRow, type ExecutiveOption, type ExecutiveOverview, type ExecutivePaidUsage, type ExecutiveRankingMetric,
  type ExecutiveRatio, type ExecutiveReasonCode, type ExecutiveReceiptAdoption, type ExecutiveReportQuery, type ExecutiveSeller, type ExecutiveSortBy,
  type ExecutiveSourceCoverage, type ExecutiveSpendConcentration,
} from '@watchdog-bms/contracts';
import { xlsxThaiDate, columnName, type WorkbookCell } from '../../../common/export/xlsx.logic';
import { PermissionResolverService } from '../../access-control/application/permission-resolver.service';
import { assertPlatformTenant } from '../../sales-console/application/sales-context';
import { buildExecutiveWorkbook, exportDateTime, exportMonth, type ExportFigure, type ExportPanel, type ExportTable } from '../domain/executive-export.logic';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma, type ExecutiveCompanyMonth, type ExecutiveCompanyProfile, type ExecutiveReportBuild, type ExecutiveReportMonth } from '../../../generated/prisma/client';
import { AuditService } from '../../audit/application/audit.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { BillingCashMovementsService } from '../../billing/application/billing-cash-movements.service';
import {
  aiCostCoverageOf, combined, countOf, documentsOf, expenseReceiptsOf, industryKeyOf, isMonth, matchesDirectory, matchesGlobal, moneyCoverageOf, moneyOf, netOf,
  ranksOf, referrerKeyOf, roundRatio, roundingNote, shareOf, sortedBy, spendGroupsOf, usageCoverageOf,
  type DirectoryFilters, type GlobalFilters, type ReportRow, type SpendGroups,
} from '../domain/executive-read.logic';
import { EXECUTIVE_DEFINITION_VERSION, executiveMonthOf, executiveMonthRange } from '../domain/executive-report.logic';
import { executiveError } from './executive-users.service';

type Tx = Prisma.TransactionClient;
type Seller = { userId: string; salesCode: string; label: string };
/** One month of the current data set, read in one snapshot, and the companies in scope for the request. */
type DataSet = {
  build: ExecutiveReportBuild; header: ExecutiveReportMonth; month: string; range: { start: Date; end: Date }; effectiveEnd: Date;
  rows: ReportRow[]; population: ReportRow[]; scope: ReportRow[]; profiles: Map<string, ExecutiveCompanyProfile>;
  global: GlobalFilters; money: ExecutiveSourceCoverage; usage: ExecutiveSourceCoverage; populationCoverage: ExecutiveSourceCoverage;
  sellers: Map<string, Seller>; salesCodeOf: Map<string, string>; provinces: Map<string, string>;
};

const VERSION = EXECUTIVE_DEFINITION_VERSION;
/** Two hourly rounds (spec §12.3 Q30): an older set means rounds failed, and every answer says so (SOURCE_STALE). */
const STALE_AFTER_MS = 2 * 3_600_000;
const LAG_MS = 24 * 3_600_000;
const SNAPSHOT = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 30_000 };
const L = EXECUTIVE_REPORT_LABELS;
const iso = (at: Date | null | undefined) => (at ? at.toISOString() : null);
const sum = (rows: readonly ReportRow[], valueOf: (row: ReportRow) => number) => rows.reduce((total, row) => total + valueOf(row), 0);
const DEFAULT_DIR = Object.fromEntries(EXECUTIVE_SORT_OPTIONS.map((option) => [option.sortBy, option.sortDir])) as Record<ExecutiveSortBy, 'asc' | 'desc'>;
const METRIC_OF: Record<ExecutiveRankingMetric, (row: ReportRow) => number> = {
  expenseReceiptCount: expenseReceiptsOf, activeDays: (row) => row.activeDays, aiRequests: (row) => row.aiRequests,
};
const DBD_LABEL = new Map(DBD_TSIC_ACTIVITIES.map((row) => [row.code, row.label]));
const LIFECYCLE_ACTION = 'system.partner_company.lifecycle.transition';
const LIFECYCLE_KIND: Record<string, ExecutiveHistoryEventKind> = { ACTIVE: 'ACTIVATED', SUSPENDED: 'SUSPENDED', DISABLED: 'DISABLED', ARCHIVED: 'ARCHIVED' };
const VIEWS: Record<ExecutiveAnalysisQuery['section'], string[]> = { usage: ['adoption', 'ranking'], revenue: ['summary', 'top'], customers: ['industry', 'discovery', 'sales'], compare: [] };

/**
 * The executive report's read API (executive backend spec §16.1 API01–API06). Every figure comes from the summary tables the
 * build writes (§12.3), read in one snapshot per request; only names, contact data and the company history are read live
 * from the tables that own them. No read writes anything but its audit row.
 *
 * ponytail: a request filters, groups and sorts one month of rows in memory (about a thousand companies today). Move the
 * filters and the order into SQL on the indexed (month, definitionVersion, reportClassification) when companies reach tens
 * of thousands (spec §20.2 measures 1,000).
 */
@Injectable()
export class ExecutiveReportReadService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly billing: BillingCashMovementsService, private readonly access: PermissionResolverService) {}

  // Reject a duplicate in-process before reading; the transaction advisory lock also covers other instances.
  private readonly exporting = new Set<string>();

  /** The time this report is read at: the current month, and how old the data set is. Tests set it; nothing else does. */
  clock = () => new Date();

  // ── API01 ────────────────────────────────────────────────────────────────────────────────────

  async context(ctx: RequestContext): Promise<ExecutiveContext> {
    const currentMonth = executiveMonthOf(this.clock());
    const { build, built, sellers } = await this.prisma.client.$transaction(async (tx) => {
      const build = await latestBuild(tx);
      if (!build) return { build: null, built: [] as string[], sellers: [] as Seller[] };
      const [months, referrers] = await Promise.all([
        tx.executiveReportMonth.findMany({ where: { definitionVersion: VERSION }, orderBy: { month: 'asc' }, select: { month: true } }),
        tx.executiveCompanyProfile.findMany({ where: { reportClassification: 'CUSTOMER', referrerKind: 'KNOWN' }, distinct: ['referrerSalesUserId'],
          select: { referrerSalesUserId: true } }),
      ]);
      const sellers = await sellersOf(tx, referrers.map((row) => row.referrerSalesUserId));
      return { build, built: months.map((row) => row.month), sellers: [...sellers.values()] };
    }, SNAPSHOT);
    const has = (permission: string) => ({ allowed: ctx.permissions.includes(permission) });
    const options = (key: ExecutiveFilterKey, leaveOut: string[] = []) =>
      Object.entries(L[key]).filter(([value]) => !leaveOut.includes(value)).map(([value, label]) => ({ value, label }));
    const [all, ...special] = options('referringSales');
    const monthOf = (at: Date | null) => (at ? executiveMonthOf(at) : null);
    return {
      requestId: ctx.requestId,
      capabilities: { readReport: has('system.executive.read'), export: has('system.executive.export'), seeContacts: has('system.executive.contact.read'),
        manageAccounts: has('system.executive_user.manage') },
      filters: {
        industry: options('industry'), discovery: options('discovery'), companyStatus: options('companyStatus'), planState: options('planState'),
        usageGroup: options('usageGroup'), paidEver: options('paidEver'), receiptAdoption: options('receiptAdoption'), signupRail: options('signupRail'),
        spendCohort: options('spendCohort', ['BOUNDARY_TIE', 'TO80_BOUNDARY_TIE']),
        referringSales: [all!, ...sellers.sort((a, b) => a.label.localeCompare(b.label, 'th')).map((seller) => ({ value: seller.salesCode, label: seller.label })), ...special],
      },
      sortOptions: EXECUTIVE_SORT_OPTIONS,
      currentMonth, defaultMonth: currentMonth, // Q32: the current month
      months: build && built.length ? { first: built[0]!, last: currentMonth } : null,
      builtMonths: built, // the month headers a round wrote: the months API02–API05 can answer
      earliestAvailableMonth: { aiUsage: monthOf(build?.aiUsageSince ?? null), receiptReading: monthOf(build?.ocrUsageSince ?? null),
        billing: monthOf(build?.billingSince ?? null), discovery: monthOf(build?.discoverySince ?? null) },
      build: build ? { id: build.id, asOf: build.asOf.toISOString(), definitionVersion: build.definitionVersion, dimensionVersion: build.dimensionVersion } : null,
    };
  }

  // ── API02 ────────────────────────────────────────────────────────────────────────────────────

  async overview(ctx: RequestContext, query: ExecutiveReportQuery): Promise<ExecutiveOverview> {
    const { data } = await this.load(ctx, query, true);
    const { scope } = data, drill = this.drill(data);
    const active = scope.filter((row) => row.activeDays > 0), spend = this.spendOf(data, scope);
    const result: ExecutiveOverview = {
      ...this.envelope(ctx, data, query),
      metrics: {
        companies: { ...countOf(scope.length, data.populationCoverage), unclassifiedCount: data.build.unclassifiedCount, drilldownFilters: drill({}) },
        activeCompanies: { ...countOf(active.length, data.usage), drilldownFilters: drill({ activeInPeriod: 'true' }), breakdown: {
          paidActive: active.filter((row) => row.usageGroup === 'ACTIVE').length, notPaid: active.filter((row) => row.paidEver === 'NO').length,
          paymentUnknown: active.filter((row) => row.paidEver === 'UNKNOWN').length, fullyRefunded: active.filter((row) => row.fullyRefunded).length } },
        companiesWithReceipts: { ...countOf(scope.filter((row) => row.receiptsSatang > 0).length, data.money), drilldownFilters: drill({ paidInPeriod: 'true' }) },
        netReceiptsSatang: { ...moneyOf(sum(scope, netOf), data.money), drilldownFilters: drill({}) },
      },
      paidUsage: this.paidUsageOf(data, scope),
      expenseReceiptAdoption: this.adoptionOf(data, scope),
      spendConcentration: (({ topCount, population, topShare, periodBasis, coverage, reasonCodes }) =>
        ({ topCount, population, topShare, periodBasis, coverage, reasonCodes }))(spend),
    };
    await this.readAudit(ctx, 'overview', data, query, {}, scope.length);
    return result;
  }

  // ── API03 ────────────────────────────────────────────────────────────────────────────────────

  async companies(ctx: RequestContext, query: ExecutiveCompaniesQuery): Promise<ExecutiveCompanies> {
    const directory = directoryOf(query);
    const sortBy = query.sortBy ?? 'joinedAt', sortDir = query.sortDir ?? DEFAULT_DIR[sortBy], q = query.q?.trim().toLocaleLowerCase('th') ?? '';
    const pageSize = query.pageSize ?? 20;
    const { data, extra: names } = await this.load(ctx, query, true, (tx, data) => namesOf(tx, data.scope.map((row) => row.companyId)));
    const groups = spendGroupsOf(data.scope, moneyIncomplete(data.money));
    const cohort = directory.spendCohort === 'ALL' ? null : groups.members[directory.spendCohort as keyof SpendGroups['members']];
    const nameOf = (row: ReportRow) => names.get(row.companyId)?.name ?? null;
    let list = data.scope.filter((row) => matchesDirectory(row, directory, cohort));
    if (q) list = list.filter((row) => [nameOf(row), names.get(row.companyId)?.registeredName, provinceOf(data, row.profile)]
      .some((text) => text?.toLocaleLowerCase('th').includes(q)));
    const sorted = sortedBy<string | number>(list, sortValueOf(sortBy, nameOf), sortDir);
    const total = sorted.length, totalPages = Math.ceil(total / pageSize), page = Math.max(1, Math.min(query.page ?? 1, totalPages));
    const shown = sorted.slice((page - 1) * pageSize, page * pageSize);

    // A rank belongs to the companies in scope (the report's filters), not to the list's own filters or its page.
    const metric = sortBy === 'netReceipts' ? netOf : (METRIC_OF as Partial<Record<string, (row: ReportRow) => number>>)[sortBy];
    const ranks = metric && !(sortBy === 'netReceipts' && moneyIncomplete(data.money)) ? ranksOf(sortedBy(data.scope, metric, 'desc'), metric) : null;
    const others = await otherTextsOf(this.prisma.client, shown.filter((row) => row.profile.discovery === 'OTHER').map((row) => row.companyId));
    const items = shown.map((row): ExecutiveCompanyRow => ({ ...this.rowOf(data, row, names, others.get(row.companyId)),
      ...(ranks ? { rank: ranks.get(row.companyId)! } : {}),
      ...(sortBy === 'netReceipts' && ranks ? { cumulativeShare: groups.cumulative.get(row.companyId) ?? null } : {}) }));
    const result: ExecutiveCompanies = {
      ...this.envelope(ctx, data, query, directoryLabels(query), groupsReason(directory.spendCohort, groups)),
      summary: { netReceiptsSatang: moneyOf(sum(sorted, netOf), data.money) },
      items, pagination: { page, pageSize, total, totalPages }, sort: { sortBy, sortDir },
    };
    await this.readAudit(ctx, 'companies', data, query, { ...auditableDirectory(query), sortBy, sortDir, page, pageSize }, total, !!q);
    return result;
  }

  // ── API04 ────────────────────────────────────────────────────────────────────────────────────

  async analysis(ctx: RequestContext, query: ExecutiveAnalysisQuery): Promise<ExecutiveAnalysis> {
    const view = query.view ?? VIEWS[query.section][0] ?? 'compare';
    const invalid = (field: string) => executiveError(ctx.requestId, 'EXECUTIVE_QUERY_INVALID', field);
    if (query.section !== 'compare' && !VIEWS[query.section].includes(view)) throw invalid('view');
    if (query.metric && view !== 'ranking') throw invalid('metric');
    const comparing = query.section === 'compare';
    for (const field of ['dimension', 'sideA', 'sideB'] as const) if (!comparing && query[field] !== undefined) throw invalid(field);
    if (comparing) {
      if (query.view !== undefined) throw invalid('view');
      // The comparison starts from every customer company of the month; it takes no report filter (spec §16.1).
      for (const field of ['industry', 'discovery', 'referringSales'] as const) if (query[field] !== undefined && query[field] !== 'ALL') throw invalid(field);
      if (!query.dimension || !query.sideA || !query.sideB) throw invalid(!query.dimension ? 'dimension' : !query.sideA ? 'sideA' : 'sideB');
      if (query.sideA === query.sideB) throw invalid('sideB');
    }

    const { data, extra } = await this.load(ctx, query, !comparing, async (tx, data): Promise<AnalysisExtra> => {
      if (query.section === 'revenue' && view === 'summary') return { trend: await trendOf(tx, data), addOnEverSold: await addOnEverSold(tx) };
      if (query.section === 'customers' && view === 'sales') return { credit: await cumulativeCreditOf(tx) };
      if (query.section === 'usage' && view === 'ranking') return { names: await namesOf(tx, data.scope.map((row) => row.companyId)) };
      if (comparing && query.dimension === 'company') return { names: await namesOf(tx, [query.sideA!, query.sideB!]) };
      return {};
    });
    const result: ExecutiveAnalysis = { ...this.envelope(ctx, data, query), section: query.section, view };
    let rowCount = 0;
    if (query.section === 'usage' && view === 'adoption') {
      Object.assign(result, { expenseReceiptAdoption: this.adoptionOf(data, data.scope), paidUsage: this.paidUsageOf(data, data.scope) });
      rowCount = data.scope.length;
    } else if (query.section === 'usage') {
      result.usageRanking = this.rankingOf(data, query.metric ?? 'expenseReceiptCount', extra.names!);
      rowCount = result.usageRanking.items.length;
    } else if (query.section === 'revenue' && view === 'summary') {
      result.revenue = this.revenueOf(data, extra.trend!, extra.addOnEverSold!);
      rowCount = data.scope.length;
    } else if (query.section === 'revenue') {
      result.spendConcentration = this.spendOf(data, data.scope);
      rowCount = data.scope.length;
    } else if (query.section === 'customers') {
      Object.assign(result, this.groupsOf(data, view as 'industry' | 'discovery' | 'sales', extra.credit));
      rowCount = result.groups!.length;
    } else {
      result.comparison = this.compareOf(ctx, data, query.dimension!, query.sideA!, query.sideB!, extra.names);
      rowCount = 2;
    }
    await this.readAudit(ctx, `analysis.${query.section}${comparing ? '' : `.${view}`}`, data, query,
      { ...(query.metric ? { metric: query.metric } : {}), ...(comparing ? { dimension: query.dimension } : {}) }, rowCount);
    return result;
  }

  // ── API05 ────────────────────────────────────────────────────────────────────────────────────

  async company(ctx: RequestContext, targetCompanyId: string, query: ExecutiveReportQuery): Promise<ExecutiveCompanyDetail> {
    const { data, extra } = await this.load(ctx, query, false, async (tx, data) => {
      const profile = data.profiles.get(targetCompanyId);
      if (profile?.reportClassification !== 'CUSTOMER') return null;
      const [live, credit, firstBuild] = await Promise.all([
        tx.company.findUnique({ where: { id: targetCompanyId }, select: { name: true, registeredName: true, businessTypeCode: true, businessTypeOther: true } }),
        tx.executiveCompanyMonth.aggregate({ where: { companyId: targetCompanyId, definitionVersion: VERSION }, _sum: { salesCreditSatang: true } }),
        tx.executiveReportBuild.aggregate({ _min: { asOf: true } }),
      ]);
      return live ? { profile, live, credit: credit._sum.salesCreditSatang ?? 0, firstBuildAt: firstBuild._min.asOf, other: await otherTextsOf(tx, [targetCompanyId]) } : null;
    });
    // Test, internal, unclassified or unknown: the same answer, which does not tell whether the company exists (spec §16.2).
    if (!extra) throw executiveError(ctx.requestId, 'COMPANY_NOT_FOUND');
    const { profile, live, credit, firstBuildAt, other } = extra;
    const ownerContact = await this.ownerContactOf(ctx, targetCompanyId);
    const names = new Map([[targetCompanyId, { name: live.name, registeredName: live.registeredName }]]);
    const row = data.rows.find((candidate) => candidate.companyId === targetCompanyId) ?? null;
    // The company's current fields; the month's fields of `base` are read only below, where the month row exists.
    const base = this.rowOf(data, { ...(row ?? ({} as ExecutiveCompanyMonth)), companyId: targetCompanyId, profile } as ReportRow, names, other.get(targetCompanyId));
    const monthReasons: ExecutiveReasonCode[] = [];
    if (!row) monthReasons.push('NOT_YET_REGISTERED');
    if (row?.countersHeld) monthReasons.push('SOURCE_ROWS_PURGED');
    if (row?.usageGroup === 'NOT_STARTED' && firstBuildAt && profile.companyCreatedAt < firstBuildAt) monthReasons.push('HISTORY_BEFORE_FIRST_BUILD');
    const result: ExecutiveCompanyDetail = {
      ...this.envelope(ctx, data, query),
      company: {
        id: base.id, displayName: base.displayName, registeredName: base.registeredName, provinceLabel: base.provinceLabel, joinedAt: base.joinedAt,
        industryGroup: base.industryGroup, companyStatus: base.companyStatus, planState: base.planState, planLabel: base.planLabel,
        discovery: base.discovery, signupRail: base.signupRail, referrer: base.referrer, receiptAdoption: base.receiptAdoption, lastActivityAt: base.lastActivityAt,
        timeBasis: 'CURRENT',
        businessTypeLabel: live.businessTypeCode && live.businessTypeCode !== 'OTHER' ? DBD_LABEL.get(live.businessTypeCode) ?? null : null,
        businessTypeOtherText: live.businessTypeCode === 'OTHER' ? live.businessTypeOther : null,
        planEndsAt: iso(profile.planEndsAt), currentActiveMemberCount: profile.activeMemberCount, currentBranchCount: profile.branchCount,
        creditedSeller: { ...base.creditedSeller, ...(profile.creditedSalesUserId ? { creditSatang: credit, creditedAt: iso(profile.salesCreditPaidAt), state: profile.salesCreditState } : {}) },
        paidEver: { value: profile.paidEver as PaidEverValue, ...(profile.paidEverReason ? { reason: profile.paidEverReason } : {}) }, fullyRefunded: profile.fullyRefunded,
        lifetimeReceiptsSatang: profile.lifetimeReceiptsSatang, lifetimeRefundsSatang: profile.lifetimeRefundsSatang,
        expenseReceiptCountLifetime: profile.expenseReceiptCountLifetime, firstActivityAt: iso(profile.firstActivityAt),
        lastWebEntryAt: iso(profile.lastWebEntryAt), lastLineActivityAt: iso(profile.lastLineActivityAt), ownerContact,
      },
      month: row && {
        paidEver: base.paidEver, fullyRefunded: row.fullyRefunded, paidInMonth: row.receiptsSatang > 0, positiveNetInMonth: netOf(row) > 0,
        usageGroup: base.usageGroup, ...(row.usageUnassessedReason ? { usageUnassessedReason: row.usageUnassessedReason } : {}),
        money: { ...moneyRowOf([row], data.money),
          aiCostSatang: moneyOf(row.aiCostSatang, aiCostCoverageOf({ start: data.range.start, end: data.range.end, aiUsageSince: data.build.aiUsageSince })) },
        usage: { activeDays: row.activeDays, activeDaysLine: row.activeDaysLine, activeDaysWeb: row.activeDaysWeb, activeUsers: row.activeUsers,
          activeUsersLine: row.activeUsersLine, activeUsersWeb: row.activeUsersWeb, documents: documentsOf(row), confirmedExpensesLine: row.confirmedExpensesLine,
          confirmedExpensesWeb: row.confirmedExpensesWeb, issuedDocuments: row.issuedDocuments, aiRequests: row.aiRequests,
          expenseReceiptCountInPeriod: expenseReceiptsOf(row), expenseReceiptsLine: row.expenseReceiptsLine, expenseReceiptsWeb: row.expenseReceiptsWeb },
      },
      monthReasonCodes: monthReasons,
    };
    await this.companyAudit(ctx, targetCompanyId, query.month, ownerContact.status === 'OK' && (!!ownerContact.email || !!ownerContact.phoneNumber));
    return result;
  }

  // ── API13 ────────────────────────────────────────────────────────────────────────────────────

  async export(ctx: RequestContext, body: ExecutiveExportBody): Promise<{ file: Buffer; exportReference: string; rowCount: number }> {
    const started = performance.now(), exportReference = randomUUID();
    let ownsSlot = false, rowCount = 0, bytes = 0, data: DataSet | undefined, query: ExecutiveCompaniesQuery | undefined;
    let includesContacts = false, outcome = 'FAILED';
    let auditComparison: ExecutiveExportBody['comparison'];
    try {
      assertPlatformTenant(ctx);
      if (!['system.executive.read', 'system.executive.export'].every(key => ctx.permissions.includes(key))) throw executiveError(ctx.requestId, 'EXECUTIVE_ACCESS_DENIED', undefined, W.export.denied);
      const validatedQuery = exportQueryOf(ctx, body);
      query = validatedQuery;
      includesContacts = body.includeContacts;
      if (includesContacts && !ctx.permissions.includes('system.executive.contact.read')) throw executiveError(ctx.requestId, 'EXECUTIVE_ACCESS_DENIED', undefined, W.export.denied);
      if (this.exporting.has(ctx.userId)) throw new HttpException({ code: 'RATE_LIMITED', message: W.export.busy, requestId: ctx.requestId, retryAfterSeconds: 1 }, 429);
      this.exporting.add(ctx.userId); ownsSlot = true;
      const detail = body.reportKey === 'detail', comparing = body.reportKey === 'compare';
      const loaded = await this.load(ctx, validatedQuery, !detail && !comparing, async (tx, set) => {
        const query = validatedQuery;
        data = set;
        if (body.buildId !== set.build.id) throw executiveError(ctx.requestId, 'EXECUTIVE_SNAPSHOT_EXPIRED');
        // A transaction-scoped lock is released on every completion/failure, including another API instance.
        const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(6013, hashtext(${ctx.userId})) AS locked`;
        if (!lock?.locked) throw new HttpException({ code: 'RATE_LIMITED', message: W.export.busy, requestId: ctx.requestId, retryAfterSeconds: 1 }, 429);
        // Everything except the owner's current contact is read inside the report snapshot.
        const ids = [...set.profiles.keys()];
        const [companies, others, credit, actor, trend, addOnSold] = await Promise.all([
          tx.company.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, registeredName: true, businessTypeCode: true, businessTypeOther: true } }),
          otherTextsOf(tx, ids), cumulativeCreditOf(tx), tx.user.findUnique({ where: { id: ctx.userId }, select: { displayName: true } }),
          body.reportKey === 'revenue' && body.subview === 'summary' ? trendOf(tx, set) : Promise.resolve([]),
          body.reportKey === 'revenue' && body.subview === 'summary' ? addOnEverSold(tx) : Promise.resolve(false),
        ]);
        const extra = { companies: new Map(companies.map(row => [row.id, row])), names: new Map(companies.map(row => [row.id, { name: row.name, registeredName: row.registeredName }])), others, credit, actor: actor?.displayName ?? '', trend, addOnSold };

        const groups = spendGroupsOf(set.scope, moneyIncomplete(set.money));
        const spendStatus = moneyIncomplete(set.money) ? W.partialRanking : groups.blocked.map(reason => reason === 'TOO_FEW_COMPANIES' ? W.fewCompanies : reason === 'NO_POSITIVE_NET' ? W.noPositiveCompanies : W.partialRanking).join(' · ');
        const directory = directoryOf(query), cohort = directory.spendCohort === 'ALL' ? null : groups.members[directory.spendCohort as keyof SpendGroups['members']];
        let list = set.scope, comparison: ExecutiveAnalysis['comparison'];
        const sideOf = new Map<string, string>();
        if (detail) {
          const profile = set.profiles.get(body.targetCompanyId!);
          if (profile?.reportClassification !== 'CUSTOMER' || !extra.companies.has(body.targetCompanyId!)) throw executiveError(ctx.requestId, 'COMPANY_NOT_FOUND');
          list = set.rows.filter(row => row.companyId === body.targetCompanyId);
          if (!list.length) throw executiveError(ctx.requestId, 'EXECUTIVE_EXPORT_EMPTY');
        } else if (comparing) {
          const pair = body.comparison!;
          comparison = this.compareOf(ctx, set, pair.dimension, pair.sideA, pair.sideB, extra.names);
          auditComparison = pair;
          const belongs = (row: ReportRow, key: string) => pair.dimension === 'company' ? row.companyId === key : pair.dimension === 'industry' ? industryKeyOf(row) === key : pair.dimension === 'discovery' ? row.profile.discovery === key : referrerKeyOf(row, set.salesCodeOf) === key;
          list = set.population.filter(row => belongs(row, pair.sideA) || belongs(row, pair.sideB));
          for (const row of list) sideOf.set(row.companyId, `${belongs(row, pair.sideA) ? W.sideA : W.sideB} · ${executiveComparisonLabel(belongs(row, pair.sideA) ? comparison.sideA : comparison.sideB, comparison.dimension)}`);
        } else if (body.reportKey === 'companies') {
          const search = query.q?.trim().toLocaleLowerCase('th');
          list = list.filter(row => matchesDirectory(row, directory, cohort) && (!search || [extra.names.get(row.companyId)?.name, extra.names.get(row.companyId)?.registeredName, provinceOf(set, row.profile)].some(text => text?.toLocaleLowerCase('th').includes(search))));
        }
        if (!list.length) throw executiveError(ctx.requestId, 'EXECUTIVE_EXPORT_EMPTY');
        if (list.length > 10_000) throw executiveError(ctx.requestId, 'EXECUTIVE_EXPORT_LIMIT_EXCEEDED');
        const sortBy = query.sortBy ?? 'joinedAt', sortDir = query.sortDir ?? DEFAULT_DIR[sortBy];
        list = sortedBy(list, sortValueOf(sortBy, row => extra.names.get(row.companyId)?.name ?? null), sortDir);
        rowCount = list.length;
        const metric = sortBy === 'netReceipts' ? netOf : (METRIC_OF as Partial<Record<string, (row: ReportRow) => number>>)[sortBy];
        const ranks = metric && !(sortBy === 'netReceipts' && moneyIncomplete(set.money)) ? ranksOf(sortedBy(set.scope, metric, 'desc'), metric) : null;
        const contactAt = this.clock(), columns = executiveExportColumns(body.reportKey, body.subview, includesContacts);
        const costs = aiCostCoverageOf({ start: set.range.start, end: set.range.end, aiUsageSince: set.build.aiUsageSince });
        const rows: WorkbookCell[][] = [];
        for (const row of list) {
          if (performance.now() - started > 30_000) throw executiveError(ctx.requestId, 'EXECUTIVE_EXPORT_LIMIT_EXCEEDED');
          const company = this.rowOf(set, row, extra.names, extra.others.get(row.companyId)), profile = row.profile, live = extra.companies.get(row.companyId);
          const money = (satang: number) => set.money.coverage === 'unavailable' ? null : { value: satang / 100, style: 3 };
          const usage = (n: number) => set.usage.coverage === 'unavailable' ? null : n;
          const notes = [set.usage.coverage !== 'complete' ? W.export.usageMissing : '', set.money.coverage !== 'complete' ? W.export.moneyMissing : '', costs.coverage !== 'complete' ? W.export.aiMissing : '',
            profile.receiptAdoption === 'UNKNOWN' ? L.receiptAdoption.UNKNOWN : '', row.paidEverReason === 'MANUAL_TERM_NO_RECEIPT' ? W.manualTerm : '', body.reportKey === 'revenue' && body.subview === 'top' ? spendStatus : ''].filter(Boolean).join(' · ');
          const cells: WorkbookCell[] = [company.displayName, company.registeredName, company.provinceLabel, executiveThaiLabel(company.industryGroup.label),
            live?.businessTypeCode === 'OTHER' ? live.businessTypeOther : DBD_LABEL.get(live?.businessTypeCode ?? '') ?? null, xlsxThaiDate(company.joinedAt),
            L.companyStatus[company.companyStatus] ?? W.unknown, executiveThaiLabel(company.planLabel), L.planState[company.planState] ?? W.unknown,
            executiveThaiLabel(company.discovery.label), company.discovery.otherText ?? null, executiveThaiLabel(L.signupRail[company.signupRail] ?? W.unknown),
            executiveThaiLabel(company.referrer.label, company.referrer.salesCode) + (company.referrer.source === 'ADMIN' ? ` ${EXECUTIVE_REFERRER_ADMIN_SUFFIX}` : ''),
            company.creditedSeller.label ? executiveThaiLabel(company.creditedSeller.label, company.creditedSeller.salesCode) : null,
            profile.creditedSalesUserId ? { value: (extra.credit.get(row.companyId) ?? 0) / 100, style: 3 } : null, xlsxThaiDate(iso(profile.salesCreditPaidAt)),
            L.paidEver[row.paidEver]!, row.fullyRefunded ? EXECUTIVE_FLAG_LABELS.fullyRefunded.true! : row.usageGroup ? L.usageGroup[row.usageGroup]! : L.paidEver.UNKNOWN!,
            L.receiptAdoption[profile.receiptAdoption]!, profile.receiptAdoption === 'UNKNOWN' || profile.receiptAdoption === 'NOT_ENTITLED' ? null : profile.expenseReceiptCountLifetime,
            usage(expenseReceiptsOf(row)), usage(row.activeDays), usage(row.activeUsers), usage(documentsOf(row)), usage(row.aiRequests),
            money(row.receiptsSatang), money(row.refundsSatang), money(netOf(row)), money(row.feesSatang), costs.coverage === 'unavailable' ? null : { value: row.aiCostSatang / 100, style: 3 },
            xlsxThaiDate(iso(profile.firstActivityAt)), xlsxThaiDate(iso(profile.lastActivityAt), true), xlsxThaiDate(iso(profile.lastWebEntryAt), true), xlsxThaiDate(iso(profile.lastLineActivityAt), true)];
          if (body.reportKey === 'usage' && body.subview === 'ranking') cells.push(ranks?.get(row.companyId) ?? null);
          if (body.reportKey === 'revenue' && body.subview === 'top') cells.push(ranks?.get(row.companyId) ?? null, set.money.coverage === 'complete' ? { value: Math.max(netOf(row), 0) / 100, style: 3 } : null,
            groups.cumulative.get(row.companyId)?.value == null ? null : { value: groups.cumulative.get(row.companyId)!.value! / 100, style: 6 },
            groups.blocked.length ? null : L.spendCohort[groups.members.TOP20.has(row.companyId) ? 'TOP20' : 'REST']!, groups.blocked.length ? null : groups.members.TO80.has(row.companyId) ? W.export.yes : W.export.no);
          if (comparing) cells.push(sideOf.get(row.companyId)!);
          cells.push(notes);
          if (includesContacts) {
            const contact = await this.ownerContactOf(ctx, row.companyId);
            const reason = contact.status === 'OK' ? (!contact.email || !contact.phoneNumber ? W.contactMissing : '') : contact.status === 'MULTIPLE_OWNERS' ? W.multipleOwners : contact.status === 'NO_CURRENT_OWNER' ? W.noOwner : W.export.unavailable;
            cells.push(contact.status === 'OK' ? contact.email ?? null : null, contact.status === 'OK' ? contact.phoneNumber ?? null : null, reason);
          }
          rows.push(cells);
        }
        const envelope = this.envelope(ctx, set, query, directoryLabels(query));
        const range = (c: number) => `'รายบริษัท'!${columnName(c)}7:${columnName(c)}${6 + rows.length}`;
        const count = (label: string, n: number, source: ExecutiveSourceCoverage, formula?: string): ExportFigure => ({ label, value: source.coverage === 'unavailable' ? null : n,
          status: source.coverage === 'partial' ? W.atLeast : undefined, ...(source.coverage !== 'unavailable' && formula ? { formula } : {}) });
        const sumFormula = (c: number, source: ExecutiveSourceCoverage) => source.coverage === 'unavailable' ? undefined : `SUM(${range(c)})`;
        const kpis: ExportFigure[] = [count(W.companyCount, list.length, set.populationCoverage, `COUNTA(${range(1)})`),
          count(W.active, list.filter(row => row.activeDays > 0).length, set.usage, `COUNTIF(${range(22)},">0")`),
          { label: W.net, value: set.money.coverage === 'unavailable' ? null : sum(list, netOf) / 100, formula: sumFormula(28, set.money), style: 3, status: set.money.coverage === 'partial' ? W.partialMoney : undefined }];
        const adoption = this.adoptionOf(set, list);
        let panels: ExportPanel[] = [{ title: W.adoptionTitle, kind: 'doughnut', labels: adoption.segments.map(segment => L.receiptAdoption[segment.key]!), values: adoption.segments.map(segment => segment.count),
          formulas: adoption.segments.map(segment => `COUNTIF(${range(19)},"${L.receiptAdoption[segment.key]}")`) },
          { title: W.lifetimeReceipts, kind: 'bar', labels: W.export.buckets, values: [rows.filter(row => row[19] === 0).length, rows.filter(row => typeof row[19] === 'number' && row[19] >= 1 && row[19] <= 5).length, rows.filter(row => typeof row[19] === 'number' && row[19] >= 6).length],
            formulas: [`COUNTIFS(${range(20)},"=0",${range(20)},"<>")`, `COUNTIFS(${range(20)},">=1",${range(20)},"<=5")`, `COUNTIF(${range(20)},">=6")`], status: W.export.bucketsDefinition },
          { title: W.paidUsage, kind: 'bar', labels: Object.values(L.usageGroup).slice(1), values: this.paidUsageOf(set, list).groups.map(group => group.count),
            formulas: Object.values(L.usageGroup).slice(1).map(label => `COUNTIF(${range(18)},"${label}")`) },
          { title: W.net, kind: 'bar', labels: [W.receipts, W.refunds, W.net], values: [sum(list, row => row.receiptsSatang), sum(list, row => row.refundsSatang), sum(list, netOf)].map(n => set.money.coverage === 'unavailable' ? null : n / 100),
            formulas: [26, 27, 28].map(c => sumFormula(c, set.money) ?? 'IF(1=1,"",0)'), status: set.money.coverage === 'partial' ? W.partialMoney : undefined, style: 3 }];
        const tables: ExportTable[] = [];
        if (body.reportKey === 'usage' && body.subview === 'ranking') {
          const ranking = this.rankingOf(set, sortBy as ExecutiveRankingMetric, extra.names);
          panels[1] = { title: W.rankTitle, kind: 'bar', labels: ranking.items.map(row => row.displayName), values: ranking.items.map(row => row.value), formulas: ranking.items.map(item => `'รายบริษัท'!${columnName(sortBy === 'expenseReceiptCount' ? 21 : sortBy === 'activeDays' ? 22 : 25)}${7 + list.findIndex(row => row.companyId === item.id)}`), status: set.usage.coverage === 'partial' ? W.atLeast : undefined };
          tables.push({ title: W.ranking, headers: [W.export.rank, W.company, EXECUTIVE_SORT_OPTIONS.find(option => option.sortBy === sortBy)!.label], rows: rows.map(row => [row[34]!, row[0]!, row[sortBy === 'expenseReceiptCount' ? 20 : sortBy === 'activeDays' ? 21 : 24]!]) });
        }
        if (body.reportKey === 'revenue' && body.subview === 'summary') {
          const revenue = this.revenueOf(set, extra.trend, extra.addOnSold);
          panels[0] = { title: W.purchase, kind: 'bar', labels: revenue.byPurchaseGroup.map(group => group.label), values: revenue.byPurchaseGroup.map(group => figureValue(group.netReceiptsSatang, 100)), style: 3 };
          panels[1] = { title: W.trend, kind: 'bar', labels: revenue.trend.map(point => exportMonth(point.month)), values: revenue.trend.map(point => figureValue(point.netReceiptsSatang, 100)), style: 3 };
          tables.push({ title: W.purchase, headers: [W.purchase, W.receipts, W.refunds, W.net, W.fees, W.tax, W.export.notes], rows: revenue.byPurchaseGroup.map(group => [group.label,
            ...[group.receiptsSatang, group.refundsSatang, group.netReceiptsSatang, group.feesSatang, group.taxSatang].map(figure => ({ value: figureValue(figure, 100), style: 3 })), group.netReceiptsSatang.coverage === 'complete' ? '' : group.netReceiptsSatang.reasonCodes.includes('ADDON_NOT_ON_SALE') ? W.addOnNotSold : group.netReceiptsSatang.coverage === 'unavailable' ? W.export.moneyMissing : W.partialMoney]) });
          tables.push({ title: W.unmatched, headers: [W.receipts, W.refunds], rows: [[{ value: envelope.unmatchedMoney.receiptsSatang / 100, style: 3 }, { value: envelope.unmatchedMoney.refundsSatang / 100, style: 3 }]] });
          kpis[0] = { label: W.receipts, value: figureValue(revenue.receiptsSatang, 100), formula: sumFormula(26, set.money), style: 3, status: set.money.coverage === 'partial' ? W.partialMoney : undefined };
          kpis[1] = { label: W.refunds, value: figureValue(revenue.refundsSatang, 100), formula: sumFormula(27, set.money), style: 3, status: set.money.coverage === 'partial' ? W.partialMoney : undefined };
        }
        if (body.reportKey === 'revenue' && body.subview === 'top') {
          const negativeNote = `${W.negativeTotal} · ${W.notInShare}`;
          panels[0] = { title: W.top, kind: 'doughnut', labels: [L.spendCohort.TOP20!, L.spendCohort.REST!], values: [groups.topShare?.value == null ? null : groups.topShare.value / 100, groups.restShare?.value == null ? null : groups.restShare.value / 100], style: 6, colors: ['14532D', 'D1D5DB'],
            status: spendStatus || undefined };
          const payers = sortedBy(list.filter(row => netOf(row) > 0), netOf, 'desc').slice(0, 10);
          panels[1] = { title: W.cumulativeShare, kind: 'bar', labels: payers.map(row => extra.names.get(row.companyId)?.name ?? ''), values: payers.map(row => groups.cumulative.get(row.companyId)?.value == null ? null : groups.cumulative.get(row.companyId)!.value! / 100), style: 6 };
          panels[2] = { title: W.positiveNet, kind: 'bar', labels: [W.positiveNet, W.negativeTotal], values: set.money.coverage === 'unavailable' ? [null, null] : [groups.positiveNetTotalSatang / 100, groups.negativeNetSatang / 100], style: 3, status: negativeNote };
          tables.push({ title: W.positiveNet, headers: [W.companyCount, W.positiveNet, W.negativeTotal, W.export.notes], rows: [[set.money.coverage === 'unavailable' ? null : groups.positiveCompanyCount, { value: set.money.coverage === 'unavailable' ? null : groups.positiveNetTotalSatang / 100, style: 3 }, { value: set.money.coverage === 'unavailable' ? null : groups.negativeNetSatang / 100, style: 3 }, negativeNote]] });
        }
        if (body.reportKey === 'customers') {
          const grouped = this.groupsOf(set, body.subview === 'creditedSales' ? 'sales' : body.subview as 'industry' | 'discovery' | 'sales', extra.credit);
          const groupLabel = (group: ExecutiveGroupRow) => executiveThaiLabel(group.label, set.sellers.get(group.key)?.salesCode ?? group.key);
          const labels = grouped.groups!.map(groupLabel);
          panels[0] = { title: W.companyCount, kind: 'bar', labels, values: grouped.groups!.map(group => group.companies.count) };
          panels[1] = { title: W.net, kind: 'bar', labels, values: grouped.groups!.map(group => figureValue(group.netReceiptsSatang, 100)), style: 3 };
          panels[2] = { title: W.active, kind: 'bar', labels, values: grouped.groups!.map(group => figureValue(group.activeCompanies)), status: set.usage.coverage === 'partial' ? W.atLeast : undefined };
          panels[3] = { title: W.paid, kind: 'bar', labels, values: grouped.groups!.map(group => figureValue(group.companiesWithReceipts)), status: set.money.coverage === 'partial' ? W.atLeast : undefined };
          tables.push({ title: W.customers, headers: [W.group, W.companyCount, W.net, W.active, W.export.notes], rows: grouped.groups!.map(group => [groupLabel(group), group.companies.count, { value: figureValue(group.netReceiptsSatang, 100), style: 3 }, figureValue(group.activeCompanies), set.populationCoverage.coverage === 'partial' || group.netReceiptsSatang.coverage === 'partial' ? W.atLeast : '']) });
          if (body.subview === 'creditedSales') {
            panels[0] = { title: W.creditAmount, kind: 'bar', labels: grouped.creditedSellers!.rows.map(row => executiveThaiLabel(row.seller.label ?? '', row.seller.salesCode)), values: grouped.creditedSellers!.rows.map(row => row.creditSatang / 100), style: 3 };
            tables.push({ title: W.credited, headers: [W.sales, W.companyCount, W.waiting, W.creditAmount], rows: grouped.creditedSellers!.rows.map(row => [executiveThaiLabel(row.seller.label ?? '', row.seller.salesCode), row.companies, row.waiting, { value: row.creditSatang / 100, style: 3 }]) });
          }
        }
        if (comparison) {
          const pair = [comparison.sideA, comparison.sideB];
          panels = [{ title: W.companyCount, kind: 'bar', labels: pair.map(side => executiveComparisonLabel(side, comparison!.dimension)), values: pair.map(side => figureValue(side.companies)) },
            { title: W.net, kind: 'bar', labels: pair.map(side => executiveComparisonLabel(side, comparison!.dimension)), values: pair.map(side => figureValue(side.netReceiptsSatang, 100)), style: 3 },
            { title: W.receiptCount, kind: 'bar', labels: pair.map(side => executiveComparisonLabel(side, comparison!.dimension)), values: pair.map(side => figureValue(side.expenseReceiptCount)) },
            { title: W.active, kind: 'bar', labels: pair.map(side => executiveComparisonLabel(side, comparison!.dimension)), values: pair.map(side => figureValue(side.activeCompanies)) }];
          const metrics = ['companies', 'netReceiptsSatang', 'netReceiptsPerCompanySatang', 'expenseReceiptCount', 'expenseReceiptsPerCompany', 'everAddedReceiptShare', 'activeCompanies'] as const;
          const labels = [W.companyCount, W.net, W.netPerCompany, W.receiptCount, W.receiptsPerCompany, W.adoptionShare, W.active];
          tables.push({ title: W.compare, headers: [W.figure, W.sideA, W.sideB, W.difference], rows: metrics.map((key, i) => {
            const money = key.includes('Satang'), rate = key === 'everAddedReceiptShare', scale = money || rate ? 100 : 1, style = money ? 3 : rate ? 6 : 0;
            return [labels[i]!, ...pair.map(side => ({ value: figureValue(side[key], scale), style })), { value: comparison!.difference[key] == null ? null : comparison!.difference[key]! / (money ? 100 : 1), style: money ? 3 : 0 }];
          }) });
        }
        if (detail) panels = panels.filter(panel => panel.kind !== 'doughnut');
        const sort = EXECUTIVE_SORT_OPTIONS.find(option => option.sortBy === sortBy)!;
        const filters = [...Object.values(envelope.appliedFilters.global), ...Object.values(envelope.appliedFilters.directory)].filter(option => option.value !== 'ALL').map(option => executiveThaiLabel(option.label, option.value));
        const metadata = [W.through(exportDateTime(envelope.dataThrough.oldest ?? set.build.asOf)), `${W.filters} · ${[...filters, ...(query.q ? [`${W.search} · ${query.q}`] : []), ...(comparison ? [executiveComparisonLabel(comparison.sideA, comparison.dimension), executiveComparisonLabel(comparison.sideB, comparison.dimension)] : [])].join(' · ') || W.export.none}`,
          `${W.sort} · ${sortDir === sort.sortDir ? sort.label : sort.label.replace('มาก → น้อย', 'น้อย → มาก').replace('ก → ฮ', 'ฮ → ก').replace('ล่าสุดก่อน', 'เก่าสุดก่อน')}`, W.found(list.length), W.excluded,
          W.moneyDefinition, W.vatIncluded, W.receiptDefinition, W.documentDefinition, W.usersDefinition, W.aiDefinition,
          W.export.sentBy(extra.actor, exportDateTime(this.clock())), `${W.export.reference} · ${exportReference}`,
          ...(set.money.coverage !== 'complete' ? [W.export.moneyMissing] : []), ...(set.usage.coverage !== 'complete' ? [W.export.usageMissing] : []),
          ...envelope.dataThrough.lagging.map(source => source === 'billing' && envelope.dataThrough.billing ? W.moneyThrough(exportDateTime(envelope.dataThrough.billing)) : ''),
          ...(includesContacts ? [W.export.personal, W.contactAt(exportDateTime(contactAt))] : [])];
        const file = buildExecutiveWorkbook({ title: W[body.reportKey], month: body.month, metadata, columns, rows, kpis, panels, tables });
        bytes = file.length;
        const [current, currentActor, session] = await Promise.all([
          this.access.resolveAccess(ctx.userId, ctx.companyId),
          this.prisma.client.user.findUnique({ where: { id: ctx.userId }, select: { status: true } }),
          ctx.sessionId ? this.prisma.client.authSession.findUnique({ where: { id: ctx.sessionId }, select: { userId: true, status: true, expiresAt: true } }) : Promise.resolve(null),
        ]);
        if (currentActor?.status !== 'ACTIVE' || (ctx.sessionId && (!session || session.userId !== ctx.userId || session.status !== 'ACTIVE' || session.expiresAt <= this.clock()))) throw executiveError(ctx.requestId, 'EXECUTIVE_ACCESS_DENIED', undefined, W.export.denied);
        if (!['system.executive.read', 'system.executive.export', ...(includesContacts ? ['system.executive.contact.read'] : [])].every(key => current.permissions.includes(key))) throw executiveError(ctx.requestId, 'EXECUTIVE_ACCESS_DENIED', undefined, W.export.denied);
        if (performance.now() - started > 30_000) throw executiveError(ctx.requestId, 'EXECUTIVE_EXPORT_LIMIT_EXCEEDED');
        return { file, exportReference, rowCount };
      });
      outcome = 'SUCCESS';
      return loaded.extra;
    } catch (error) {
      const mapped = error instanceof HttpException && error.getStatus() === 403 ? executiveError(ctx.requestId, 'EXECUTIVE_ACCESS_DENIED', undefined, W.export.denied)
        : error instanceof Error && (error.message === 'XLSX_LIMIT' || (!(error instanceof HttpException) && performance.now() - started > 30_000)) ? executiveError(ctx.requestId, 'EXECUTIVE_EXPORT_LIMIT_EXCEEDED') : error;
      outcome = mapped instanceof HttpException ? String((mapped.getResponse() as { code?: string }).code ?? (mapped.getStatus() === 403 ? 'EXECUTIVE_ACCESS_DENIED' : 'FAILED')) : 'FAILED';
      throw mapped;
    } finally {
      try {
        await this.audit.logOrThrow({ actorUserId: ctx.userId, action: 'executive.export.created', targetType: 'ExecutiveExport', requestId: ctx.requestId,
          result: outcome === 'SUCCESS' ? 'SUCCESS' : outcome === 'EXECUTIVE_ACCESS_DENIED' ? 'DENIED' : 'FAILED', riskLevel: includesContacts ? 'MEDIUM' : 'LOW',
          metadataJson: { exportReference, reportKey: query ? body.reportKey : null, subview: query ? body.subview ?? null : null, month: query?.month ?? null,
            filters: data && query ? { ...data.global, ...auditableDirectory(query) } : {}, comparison: auditComparison ?? null,
            sortBy: query?.sortBy ?? null, sortDir: query?.sortDir ?? null, hasSearch: !!query?.q, rowCount, companyCount: rowCount, bytes, includesContacts, outcome,
            buildId: data?.build.id ?? null, definitionVersion: data?.build.definitionVersion ?? null, templateVersion: 'executive-v4-1' } });
      } finally { if (ownsSlot) this.exporting.delete(ctx.userId); }
    }
  }

  // ── API06 ────────────────────────────────────────────────────────────────────────────────────

  /** The company's own events from the rows that already record them; nothing of who did it or why (spec §16.1 API06). */
  async history(ctx: RequestContext, targetCompanyId: string, query: ExecutiveHistoryQuery): Promise<ExecutiveCompanyHistory> {
    const found = await this.prisma.client.$transaction(async (tx) => {
      const build = await latestBuild(tx);
      if (!build) throw executiveError(ctx.requestId, 'SOURCE_UNAVAILABLE');
      const profile = await tx.executiveCompanyProfile.findUnique({ where: { companyId: targetCompanyId }, select: { reportClassification: true } });
      if (profile?.reportClassification !== 'CUSTOMER') return null;
      return Promise.all([
        tx.company.findUnique({ where: { id: targetCompanyId }, select: { createdAt: true } }),
        tx.auditLog.findMany({ where: { action: LIFECYCLE_ACTION, targetType: 'company', targetId: targetCompanyId },
          select: { createdAt: true, actorUserId: true, metadataJson: true } }),
      ]);
    }, SNAPSHOT);
    if (!found?.[0]) throw executiveError(ctx.requestId, 'COMPANY_NOT_FOUND');
    const [company, transitions] = found;
    const events: ExecutiveHistoryEvent[] = [{ kind: 'SIGNED_UP', at: company.createdAt.toISOString() }];
    for (const row of transitions) {
      const meta = (row.metadataJson ?? {}) as { toStatus?: unknown; reason?: unknown };
      const kind = typeof meta.toStatus === 'string' && Object.hasOwn(LIFECYCLE_KIND, meta.toStatus) ? LIFECYCLE_KIND[meta.toStatus] : undefined;
      // The term sweep (no person) disables a shop whose paid term ran out: to the shop, its package expired.
      if (kind) events.push({ kind: kind === 'DISABLED' && row.actorUserId === null && meta.reason === 'term_expired' ? 'PACKAGE_EXPIRED' : kind, at: row.createdAt.toISOString() });
    }
    for (const purchase of await this.billing.companyPackagePurchases(targetCompanyId)) {
      const renewal = EXECUTIVE_PURCHASE_GROUPS.find((group) => (group.kinds as readonly string[]).includes(purchase.purchaseKind))?.key === 'RENEWAL';
      events.push({ kind: renewal ? 'PACKAGE_RENEWED' : 'PACKAGE_PURCHASED', at: purchase.appliedAt.toISOString(), planLabel: billingPlanLabel(purchase.tierKey) });
    }
    events.sort((a, b) => b.at.localeCompare(a.at));
    const pageSize = query.pageSize ?? 20, totalPages = Math.ceil(events.length / pageSize), page = Math.max(1, Math.min(query.page ?? 1, totalPages));
    await this.companyAudit(ctx, targetCompanyId, null, false);
    return { requestId: ctx.requestId, items: events.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total: events.length, totalPages } };
  }

  // ── The data set ─────────────────────────────────────────────────────────────────────────────

  /**
   * One month of the latest build, in one REPEATABLE READ snapshot: a round that commits meanwhile is either all seen or not at
   * all. `extra` reads more in the same snapshot. No build yet, or a month the data set does not hold yet (the first hour of a
   * month): 503, never zeros.
   */
  private async load<T = undefined>(ctx: RequestContext, query: ExecutiveReportQuery, useGlobalFilters: boolean,
    extra?: (tx: Tx, data: DataSet) => Promise<T>): Promise<{ data: DataSet; extra: T }> {
    const invalid = (field: string) => executiveError(ctx.requestId, 'EXECUTIVE_QUERY_INVALID', field);
    if (!isMonth(query.month) || query.month > executiveMonthOf(this.clock())) throw invalid('month');
    return this.prisma.client.$transaction(async (tx) => {
      const build = await latestBuild(tx);
      if (!build) throw executiveError(ctx.requestId, 'SOURCE_UNAVAILABLE');
      const [first, header, monthRows, profileRows, provinces] = await Promise.all([
        tx.executiveReportMonth.findFirst({ where: { definitionVersion: VERSION }, orderBy: { month: 'asc' }, select: { month: true } }),
        tx.executiveReportMonth.findUnique({ where: { month_definitionVersion: { month: query.month, definitionVersion: VERSION } } }),
        tx.executiveCompanyMonth.findMany({ where: { month: query.month, definitionVersion: VERSION } }),
        tx.executiveCompanyProfile.findMany(),
        tx.$queryRaw<Array<{ provinceCode: string; provinceTh: string }>>`SELECT DISTINCT "provinceCode", "provinceTh" FROM "ThaiAddressMaster"`,
      ]);
      if (!first || query.month < first.month) throw invalid('month');
      if (!header) throw executiveError(ctx.requestId, 'SOURCE_UNAVAILABLE');
      const profiles = new Map(profileRows.map((profile) => [profile.companyId, profile]));
      const sellers = await sellersOf(tx, profileRows.flatMap((profile) =>
        [profile.referrerKind === 'KNOWN' ? profile.referrerSalesUserId : null, profile.creditedSalesUserId]));
      const salesCodeOf = new Map([...sellers.values()].map((seller) => [seller.userId, seller.salesCode]));
      const global = await this.globalOf(tx, ctx, query, salesCodeOf, sellers, useGlobalFilters);
      // ponytail: a month row whose company has no profile any more is left out. That needs a deleted company, and deleting
      // companies belongs to the deferred data-deletion work (spec §19, PAY-20), which must decide what such money shows as.
      const rows = monthRows.flatMap((row) => { const profile = profiles.get(row.companyId); return profile ? [{ ...row, profile }] : []; });
      const population = rows.filter((row) => row.reportClassification === 'CUSTOMER');
      const range = executiveMonthRange(query.month), effectiveEnd = header.asOf < range.end ? header.asOf : range.end;
      const data: DataSet = {
        build, header, month: query.month, range, effectiveEnd, rows, population, profiles, global, sellers, salesCodeOf,
        scope: population.filter((row) => matchesGlobal(row, global, salesCodeOf)),
        provinces: new Map(provinces.map((row) => [row.provinceCode, row.provinceTh])),
        money: moneyCoverageOf({ end: range.end, effectiveEnd, billingSince: build.billingSince, billingCoveredThrough: header.billingCoveredThrough, untiedCount: header.untiedCount }),
        usage: usageCoverageOf({ start: range.start, beforeFirstBuild: header.beforeFirstBuild, aiUsageSince: build.aiUsageSince }),
        populationCoverage: build.unclassifiedCount > 0 ? { coverage: 'partial', reasonCodes: ['CLASSIFICATION_INCOMPLETE'] } : { coverage: 'complete', reasonCodes: [] },
      };
      return { data, extra: (extra ? await extra(tx, data) : undefined) as T };
    }, SNAPSHOT);
  }

  /** The report's own filters, checked against the data: a sales code must be a seller that exists (400 otherwise, never ALL). */
  private async globalOf(tx: Tx, ctx: RequestContext, query: ExecutiveReportQuery, salesCodeOf: Map<string, string>, sellers: Map<string, Seller>,
    useGlobalFilters: boolean): Promise<GlobalFilters> {
    const global = { industry: query.industry ?? 'ALL', discovery: query.discovery ?? 'ALL', referringSales: query.referringSales ?? 'ALL' };
    if (!useGlobalFilters) return { industry: 'ALL', discovery: 'ALL', referringSales: 'ALL' };
    const code = global.referringSales;
    if (!Object.hasOwn(L.referringSales, code) && ![...salesCodeOf.values()].includes(code)) {
      const profile = await tx.salesAgentProfile.findUnique({ where: { salesCode: code }, select: { userId: true } });
      if (!profile) throw executiveError(ctx.requestId, 'EXECUTIVE_QUERY_INVALID', 'referringSales');
      for (const seller of (await sellersOf(tx, [profile.userId])).values()) sellers.set(seller.userId, seller);
    }
    return global;
  }

  private envelope(ctx: RequestContext, data: DataSet, query: ExecutiveReportQuery, directory: Record<string, ExecutiveOption> = {},
    reasons: ExecutiveReasonCode[] = []): ExecutiveEnvelope {
    const { build, header, rows } = data;
    const sources = { billing: build.billingDataThrough, activity: build.asOf, aiCost: build.asOf, profile: build.asOf };
    const known = Object.values(sources).filter((at): at is Date => at !== null).map((at) => at.getTime());
    const newest = Math.max(...known);
    const excluded = rows.filter((row) => row.reportClassification === 'TEST' || row.reportClassification === 'INTERNAL');
    const sellerLabel = (code: string) => L.referringSales[code] ?? [...data.sellers.values()].find((seller) => seller.salesCode === code)?.label ?? code;
    return {
      requestId: ctx.requestId,
      build: { id: build.id, asOf: build.asOf.toISOString(), definitionVersion: build.definitionVersion, dimensionVersion: build.dimensionVersion,
        monthRevision: header.revision, monthRevisedAt: iso(header.revisedAt) },
      buildChanged: !!query.buildId && query.buildId !== build.id,
      reasonCodes: [...(this.clock().getTime() - build.asOf.getTime() > STALE_AFTER_MS ? ['SOURCE_STALE' as const] : []), ...reasons],
      period: { month: data.month, timeZone: 'Asia/Bangkok', startInclusive: data.range.start.toISOString(), endExclusive: data.range.end.toISOString(),
        effectiveEndExclusive: data.effectiveEnd.toISOString(), isPartialMonth: data.effectiveEnd < data.range.end },
      dataThrough: { billing: iso(sources.billing), activity: iso(sources.activity), aiCost: iso(sources.aiCost), profile: iso(sources.profile),
        oldest: known.length ? new Date(Math.min(...known)).toISOString() : null,
        lagging: (Object.keys(sources) as Array<keyof typeof sources>).filter((key) => !sources[key] || newest - sources[key]!.getTime() > LAG_MS) },
      appliedFilters: {
        global: { industry: { value: data.global.industry, label: L.industry[data.global.industry]! }, discovery: { value: data.global.discovery, label: L.discovery[data.global.discovery]! },
          referringSales: { value: data.global.referringSales, label: sellerLabel(data.global.referringSales) } },
        directory,
      },
      population: {
        eligibleCount: countOf(data.scope.length, data.populationCoverage), excludedTestInternalCount: excluded.length,
        unclassifiedCount: build.unclassifiedCount, excludedTestInternalNetReceiptsSatang: sum(excluded, netOf),
        unclassifiedNetReceiptsSatang: sum(rows.filter((row) => row.reportClassification === null), netOf),
      },
      unmatchedMoney: { count: header.untiedCount, receiptsSatang: header.untiedReceiptsSatang, refundsSatang: header.untiedRefundsSatang, otherSatang: header.untiedOtherSatang },
      coverage: { money: data.money, usage: data.usage },
    };
  }

  /** The complete list query behind an item: the request's report filters plus the item's own. */
  private drill(data: DataSet) {
    const global = Object.fromEntries(Object.entries(data.global).filter(([, value]) => value !== 'ALL'));
    return (own: ExecutiveDrilldownFilters): ExecutiveDrilldownFilters => ({ ...global, ...own });
  }

  // ── Figures ─────────────────────────────────────────────────────────────────────────────────

  private paidUsageOf(data: DataSet, scope: ReportRow[]): ExecutivePaidUsage {
    const drill = this.drill(data), unknown = scope.filter((row) => row.paidEver === 'UNKNOWN');
    const byReason = Object.fromEntries(EXECUTIVE_PAID_EVER_REASONS.map((reason) => [reason, unknown.filter((row) => row.paidEverReason === reason).length])
      .filter(([, count]) => count));
    return {
      basis: 'EVER_PAID_BEFORE_CUTOFF',
      paidEver: { count: scope.filter((row) => row.paidEver === 'YES').length, drilldownFilters: drill({ paidEver: 'YES' }) },
      groups: (['NOT_STARTED', 'INACTIVE', 'ACTIVE', 'NOT_PAID'] as const).map((key) =>
        ({ key, count: scope.filter((row) => row.usageGroup === key).length, drilldownFilters: drill({ usageGroup: key }) })),
      // Paid ever is YES, so the only reason left is the usage history.
      usageUnassessed: { count: scope.filter((row) => row.paidEver === 'YES' && row.usageUnassessedReason !== null).length,
        drilldownFilters: drill({ paidEver: 'YES', usageAssessed: 'false' }) },
      fullyRefunded: { count: scope.filter((row) => row.fullyRefunded).length, drilldownFilters: drill({ fullyRefunded: 'true' }) },
      paymentUnknown: { count: unknown.length, drilldownFilters: drill({ paidEver: 'UNKNOWN' }), byReason },
    };
  }

  private adoptionOf(data: DataSet, scope: ReportRow[]): ExecutiveReceiptAdoption {
    const drill = this.drill(data), count = (key: string) => scope.filter((row) => row.profile.receiptAdoption === key).length;
    const segments = (['EVER', 'NEVER', 'UNKNOWN', 'NOT_ENTITLED'] as const).map((key) =>
      ({ key, count: count(key), share: shareOf(count(key), scope.length), drilldownFilters: drill({ receiptAdoption: key }) }));
    const unknown = count('UNKNOWN');
    return { population: scope.length, ever: count('EVER'), never: count('NEVER'), unknown, notEntitled: count('NOT_ENTITLED'), segments,
      roundingNote: roundingNote(segments.map((segment) => segment.share)),
      coverage: unknown ? 'partial' : 'complete', reasonCodes: unknown ? ['HISTORY_BEFORE_COLLECTION'] : [], timeBasis: 'CURRENT' };
  }

  private spendOf(data: DataSet, scope: ReportRow[]): ExecutiveSpendConcentration {
    const groups = spendGroupsOf(scope, moneyIncomplete(data.money)), drill = this.drill(data);
    const coverage: ExecutiveSourceCoverage = data.money.coverage === 'unavailable' ? data.money
      : groups.blocked.length ? { coverage: 'unavailable', reasonCodes: groups.blocked } : data.money;
    const { blocked: _blocked, members: _members, cumulative: _cumulative, ...figures } = groups;
    return {
      ...figures, receiptsWithoutPositiveNet: scope.filter((row) => row.receiptsSatang > 0 && netOf(row) <= 0).length,
      periodBasis: 'SELECTED_MONTH', coverage: coverage.coverage, reasonCodes: coverage.reasonCodes,
      drilldownFilters: groups.blocked.length ? {} : Object.fromEntries((['TOP20', 'REST', 'TO80', 'BOUNDARY_TIE', 'TO80_BOUNDARY_TIE'] as const)
        .map((cohort) => [cohort, drill({ spendCohort: cohort, sortBy: 'netReceipts', sortDir: 'desc' })])),
    };
  }

  private rankingOf(data: DataSet, metric: ExecutiveRankingMetric, names: Map<string, CompanyName>): NonNullable<ExecutiveAnalysis['usageRanking']> {
    const valueOf = METRIC_OF[metric];
    const ranked = sortedBy(data.scope.filter((row) => valueOf(row) > 0), valueOf, 'desc'), ranks = ranksOf(ranked, valueOf);
    const shown = ranked.slice(0, 10), last = shown.at(-1);
    return {
      metric, total: data.scope.length, coverage: data.usage.coverage, reasonCodes: data.usage.reasonCodes,
      items: shown.map((row) => ({ id: row.companyId, displayName: names.get(row.companyId)?.name ?? '', registeredName: registeredOf(names, row.companyId),
        provinceLabel: provinceOf(data, row.profile), value: valueOf(row), rank: ranks.get(row.companyId)! })),
      ...(last ? { boundaryTie: { count: ranked.slice(10).filter((row) => valueOf(row) === valueOf(last)).length, value: valueOf(last) } } : {}),
      drilldownFilters: this.drill(data)({ sortBy: metric, sortDir: 'desc' }),
    };
  }

  private revenueOf(data: DataSet, trend: TrendPoint[], addOnEverSold: boolean): NonNullable<ExecutiveAnalysis['revenue']> {
    const unknownMoney = data.scope.some((row) => kindMoney(row, ['UNKNOWN']).receiptsSatang || kindMoney(row, ['UNKNOWN']).refundsSatang);
    const groupCoverage = combined(data.money, unknownMoney ? { coverage: 'partial', reasonCodes: ['PURCHASE_KIND_UNKNOWN'] } : { coverage: 'complete', reasonCodes: [] });
    return {
      ...moneyRowOf(data.scope, data.money),
      byPurchaseGroup: EXECUTIVE_PURCHASE_GROUPS.map((group) => {
        const totals = data.scope.map((row) => kindMoney(row, group.kinds));
        const has = totals.some((money) => money.receiptsSatang || money.refundsSatang);
        // Paid add-ons are not on sale until one is sold: then the row says so, not 0 baht (spec §14.1).
        const coverage: ExecutiveSourceCoverage = group.key === 'ADD_ON' && !has && !addOnEverSold ? { coverage: 'unavailable', reasonCodes: ['ADDON_NOT_ON_SALE'] } : groupCoverage;
        const total = (key: keyof Money) => totals.reduce((acc, money) => acc + money[key], 0);
        return { key: group.key, label: group.label, receiptsSatang: moneyOf(total('receiptsSatang'), coverage), refundsSatang: moneyOf(total('refundsSatang'), coverage),
          netReceiptsSatang: moneyOf(total('receiptsSatang') - total('refundsSatang'), coverage), feesSatang: moneyOf(total('feesSatang'), coverage), taxSatang: moneyOf(total('taxSatang'), coverage) };
      }),
      disputedInvoiceCount: sum(data.scope, (row) => row.disputedInvoiceCount),
      trend: trend.map((point) => {
        const scope = point.rows.filter((row) => row.reportClassification === 'CUSTOMER' && matchesGlobal(row, data.global, data.salesCodeOf));
        const receipts = sum(scope, (row) => row.receiptsSatang), refunds = sum(scope, (row) => row.refundsSatang);
        return { month: point.month, isPartialMonth: point.isPartialMonth, receiptsSatang: moneyOf(receipts, point.money), refundsSatang: moneyOf(refunds, point.money),
          netReceiptsSatang: moneyOf(receipts - refunds, point.money) };
      }),
    };
  }

  private groupsOf(data: DataSet, view: 'industry' | 'discovery' | 'sales', credit?: Map<string, number>): Pick<ExecutiveAnalysis, 'groups' | 'roundingNote' | 'industryCoverage' | 'creditedSellers'> {
    const drill = this.drill(data);
    const keyOf = view === 'industry' ? industryKeyOf : view === 'discovery' ? (row: ReportRow) => row.profile.discovery : (row: ReportRow) => referrerKeyOf(row, data.salesCodeOf);
    const filter = view === 'sales' ? 'referringSales' : view;
    const sellerOfCode = new Map([...data.sellers.values()].map((seller) => [seller.salesCode, seller.label]));
    const labelOf = (key: string) => L[filter][key] ?? sellerOfCode.get(key) ?? key;
    // Contract order for groups and channels; sellers by name, then the three kinds that are not a seller.
    const order = view === 'sales' ? [...[...sellerOfCode.entries()].sort((a, b) => a[1].localeCompare(b[1], 'th')).map(([code]) => code), 'NONE', 'UNKNOWN', 'UNRESOLVED']
      : Object.keys(L[filter]).filter((key) => key !== 'ALL');
    const byKey = new Map<string, ReportRow[]>();
    for (const row of data.scope) { const key = keyOf(row); if (byKey.has(key)) byKey.get(key)!.push(row); else byKey.set(key, [row]); }
    const groups = order.filter((key) => byKey.has(key)).map((key): ExecutiveGroupRow => {
      const rows = byKey.get(key)!;
      return { key, label: labelOf(key), companies: { count: rows.length, share: shareOf(rows.length, data.scope.length) },
        companiesWithReceipts: countOf(rows.filter((row) => row.receiptsSatang > 0).length, data.money),
        paidEverCompanies: rows.filter((row) => row.paidEver === 'YES').length,
        activeCompanies: countOf(rows.filter((row) => row.activeDays > 0).length, data.usage),
        netReceiptsSatang: moneyOf(sum(rows, netOf), data.money), drilldownFilters: drill({ [filter]: key }) };
    });
    const result: ReturnType<ExecutiveReportReadService['groupsOf']> = { groups, roundingNote: roundingNote(groups.map((group) => group.companies.share)) };
    if (view === 'industry') result.industryCoverage = shareOf(data.scope.filter((row) => row.profile.industryGroup !== null).length, data.scope.length);
    if (view === 'sales') {
      // First-payment credit as it stands now (spec §14.3): the companies credited to each seller among today's customers in the report's filters.
      const credited = new Map<string, ExecutiveCompanyProfile[]>();
      for (const profile of data.profiles.values()) {
        if (profile.reportClassification !== 'CUSTOMER' || !profile.creditedSalesUserId || !matchesGlobal({ profile } as ReportRow, data.global, data.salesCodeOf)) continue;
        if (credited.has(profile.creditedSalesUserId)) credited.get(profile.creditedSalesUserId)!.push(profile); else credited.set(profile.creditedSalesUserId, [profile]);
      }
      result.creditedSellers = { timeBasis: 'CURRENT', asOf: data.build.asOf.toISOString(), rows: [...credited.entries()]
        .map(([userId, profiles]) => ({ seller: sellerOf(data, userId), companies: profiles.filter((profile) => profile.salesCreditState === 'COUNTED').length,
          waiting: profiles.filter((profile) => profile.salesCreditState === 'WAITING').length,
          creditSatang: profiles.reduce((total, profile) => total + (credit?.get(profile.companyId) ?? 0), 0) }))
        .sort((a, b) => (a.seller.label ?? '').localeCompare(b.seller.label ?? '', 'th')) };
    }
    return result;
  }

  private compareOf(ctx: RequestContext, data: DataSet, dimension: string, sideA: string, sideB: string, names?: Map<string, CompanyName>): NonNullable<ExecutiveAnalysis['comparison']> {
    const invalid = (field: string) => executiveError(ctx.requestId, 'EXECUTIVE_QUERY_INVALID', field);
    const filter = dimension === 'referringSales' ? 'referringSales' : dimension;
    const sellerCodes = new Set(data.salesCodeOf.values());
    const side = (key: string, field: string): ExecutiveCompareSide & { rows: ReportRow[]; counts: ExecutiveSourceCoverage } => {
      let rows: ReportRow[], label: string;
      if (dimension === 'company') {
        rows = data.population.filter((row) => row.companyId === key);
        // A company outside this month's customers: the same answer as the detail page, which says nothing about existence.
        if (!rows.length) throw executiveError(ctx.requestId, 'COMPANY_NOT_FOUND');
        label = names?.get(key)?.name ?? '';
      } else {
        const known = key !== 'ALL' && (Object.hasOwn(L[filter as ExecutiveFilterKey], key) || (filter === 'referringSales' && sellerCodes.has(key)));
        if (!known) throw invalid(field);
        const keyOf = filter === 'industry' ? industryKeyOf : filter === 'discovery' ? (row: ReportRow) => row.profile.discovery : (row: ReportRow) => referrerKeyOf(row, data.salesCodeOf);
        rows = data.population.filter((row) => keyOf(row) === key);
        label = L[filter as ExecutiveFilterKey][key] ?? [...data.sellers.values()].find((seller) => seller.salesCode === key)?.label ?? key;
      }
      const counts = dimension === 'company' ? { coverage: 'complete' as const, reasonCodes: [] } : data.populationCoverage;
      const net = sum(rows, netOf), receipts = sum(rows, expenseReceiptsOf), ever = rows.filter((row) => row.profile.receiptAdoption === 'EVER').length;
      const exact = (source: ExecutiveSourceCoverage) => source.coverage === 'complete' && counts.coverage === 'complete';
      return { rows, counts, key, label, drilldownFilters: dimension === 'company' ? null : { [filter]: key },
        companies: countOf(rows.length, counts), netReceiptsSatang: moneyOf(net, data.money),
        netReceiptsPerCompanySatang: exact(data.money) ? { value: roundRatio(net, rows.length, 0), numerator: net, denominator: rows.length } : null,
        expenseReceiptCount: countOf(receipts, data.usage),
        expenseReceiptsPerCompany: exact(data.usage) ? { value: roundRatio(receipts, rows.length, 1), numerator: receipts, denominator: rows.length } : null,
        everAddedReceiptShare: counts.coverage === 'complete' ? shareOf(ever, rows.length) : null,
        activeCompanies: countOf(rows.filter((row) => row.activeDays > 0).length, data.usage) };
    };
    const a = side(sideA, 'sideA'), b = side(sideB, 'sideB');
    const diff = (left: { value: number | null }, right: { value: number | null }) => (left.value === null || right.value === null ? null : left.value - right.value);
    // A − B of two ratios from their whole numbers, rounded once; percentages give percentage points.
    const ratioDiff = (left: ExecutiveRatio | null, right: ExecutiveRatio | null, decimals: number, scale = 1) =>
      !left || !right || left.value === null || right.value === null ? null
        : roundRatio(scale * (left.numerator * right.denominator - right.numerator * left.denominator), left.denominator * right.denominator, decimals);
    const strip = ({ rows: _rows, counts: _counts, ...rest }: typeof a): ExecutiveCompareSide => rest;
    return {
      dimension, base: 'ALL_CUSTOMER_COMPANIES', sideA: strip(a), sideB: strip(b),
      difference: {
        companies: diff(a.companies, b.companies), netReceiptsSatang: diff(a.netReceiptsSatang, b.netReceiptsSatang),
        netReceiptsPerCompanySatang: ratioDiff(a.netReceiptsPerCompanySatang, b.netReceiptsPerCompanySatang, 0),
        expenseReceiptCount: diff(a.expenseReceiptCount, b.expenseReceiptCount),
        expenseReceiptsPerCompany: ratioDiff(a.expenseReceiptsPerCompany, b.expenseReceiptsPerCompany, 1),
        everAddedReceiptShare: ratioDiff(a.everAddedReceiptShare, b.everAddedReceiptShare, 1, 100),
        activeCompanies: diff(a.activeCompanies, b.activeCompanies),
      },
    };
  }

  /** One list row: only the keys of spec §16.2, names read live, sellers as "ชื่อ · รหัสเซลล์". */
  private rowOf(data: DataSet, row: ReportRow, names: Map<string, CompanyName>, otherText?: string | null): ExecutiveCompanyRow {
    const profile = row.profile, industry = industryKeyOf(row);
    const seller = profile.referrerKind === 'KNOWN' ? data.sellers.get(profile.referrerSalesUserId ?? '') : undefined;
    const kind = profile.referrerKind === 'KNOWN' && !seller ? 'UNRESOLVED' : profile.referrerKind as ExecutiveCompanyRow['referrer']['kind'];
    return {
      id: row.companyId, displayName: names.get(row.companyId)?.name ?? '', registeredName: registeredOf(names, row.companyId),
      provinceLabel: provinceOf(data, profile), joinedAt: profile.companyCreatedAt.toISOString(),
      industryGroup: { key: industry, label: L.industry[industry] ?? L.industry.UNKNOWN! },
      companyStatus: profile.companyStatus, planState: profile.planState,
      planLabel: !profile.planTierKey ? EXECUTIVE_NO_PLAN_DATA_LABEL : profile.planState === 'NO_PACKAGE' ? L.planState.NO_PACKAGE! : billingPlanLabel(profile.planTierKey),
      discovery: { key: profile.discovery, label: L.discovery[profile.discovery] ?? L.discovery.UNKNOWN!, ...(otherText ? { otherText } : {}) },
      signupRail: profile.signupRail,
      referrer: { kind, label: seller?.label ?? L.referringSales[kind]!, ...(seller ? { salesCode: seller.salesCode } : {}),
        ...(profile.referralSource && (kind === 'KNOWN' || kind === 'UNRESOLVED') ? { source: profile.referralSource as 'SIGNUP_CODE' | 'ADMIN' } : {}) },
      creditedSeller: profile.creditedSalesUserId ? sellerOf(data, profile.creditedSalesUserId) : {},
      paidEver: { value: row.paidEver as PaidEverValue, ...(row.paidEverReason ? { reason: row.paidEverReason } : {}) }, fullyRefunded: row.fullyRefunded,
      usageGroup: row.usageGroup as ExecutiveCompanyRow['usageGroup'], ...(row.usageUnassessedReason ? { usageUnassessedReason: row.usageUnassessedReason } : {}),
      receiptAdoption: profile.receiptAdoption,
      metrics: { receiptsSatang: row.receiptsSatang, refundsSatang: row.refundsSatang, netReceiptsSatang: netOf(row), activeDays: row.activeDays,
        activeUsers: row.activeUsers, documents: documentsOf(row), aiRequests: row.aiRequests, expenseReceiptCountInPeriod: expenseReceiptsOf(row),
        expenseReceiptCountLifetime: profile.expenseReceiptCountLifetime },
      lastActivityAt: iso(profile.lastActivityAt),
    };
  }

  /** Read live from the owner's own account (D02), only for a caller allowed to see it; never a stand-in owner (spec §16.2). */
  private async ownerContactOf(ctx: RequestContext, companyId: string): Promise<ExecutiveCompanyDetail['company']['ownerContact']> {
    if (!ctx.permissions.includes('system.executive.contact.read')) return { status: 'NOT_PERMITTED' };
    try {
      const owners = await this.prisma.client.companyMembership.findMany({
        where: { companyId, status: 'ACTIVE', roles: { some: { role: { key: 'OWNER', isSystem: true, scopeKey: 'system', status: 'ACTIVE' } } } },
        select: { user: { select: { email: true, phoneNumber: true } } }, take: 2 });
      if (owners.length !== 1) return { status: owners.length ? 'MULTIPLE_OWNERS' : 'NO_CURRENT_OWNER', email: null, phoneNumber: null };
      return { status: 'OK', email: owners[0]!.user.email ?? null, phoneNumber: owners[0]!.user.phoneNumber ?? null };
    } catch {
      return { status: 'SOURCE_UNAVAILABLE', email: null, phoneNumber: null };
    }
  }

  // ── Audit (spec §20.3): who read what with which filters; no company of the customer, no search text, no person ──

  private readAudit(ctx: RequestContext, reportKey: string, data: DataSet, query: ExecutiveReportQuery, filters: Record<string, unknown>, rowCount: number, hasSearch = false) {
    const global = Object.fromEntries(Object.entries(data.global).filter(([, value]) => value !== 'ALL'));
    return this.audit.log({ actorUserId: ctx.userId, action: 'executive.report.read', targetType: 'ExecutiveReport', requestId: ctx.requestId, result: 'SUCCESS',
      riskLevel: 'LOW', metadataJson: { reportKey, month: query.month, buildId: data.build.id, filters: { ...global, ...filters }, rowCount, hasSearch } });
  }

  private companyAudit(ctx: RequestContext, companyId: string, month: string | null, contactsReturned: boolean) {
    return this.audit.log({ actorUserId: ctx.userId, action: 'executive.company.read', targetType: 'Company', targetId: companyId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: contactsReturned ? 'MEDIUM' : 'LOW', metadataJson: { month, contactsReturned } });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

type CompanyName = { name: string; registeredName: string | null };
type AnalysisExtra = { trend?: TrendPoint[]; addOnEverSold?: boolean; credit?: Map<string, number>; names?: Map<string, CompanyName> };
type Money = { receiptsSatang: number; refundsSatang: number; feesSatang: number; taxSatang: number };
type PaidEverValue = ExecutiveCompanyRow['paidEver']['value'];
type TrendPoint = { month: string; isPartialMonth: boolean; money: ExecutiveSourceCoverage; rows: ReportRow[] };

function latestBuild(tx: Tx) {
  return tx.executiveReportBuild.findFirst({ where: { definitionVersion: VERSION }, orderBy: [{ asOf: 'desc' }, { id: 'desc' }] });
}

/** Sellers as the screen names them: `User.displayName` and `SalesAgentProfile.salesCode` only (spec §14.3). */
async function sellersOf(tx: Tx, userIds: Array<string | null>): Promise<Map<string, Seller>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (!ids.length) return new Map();
  const [profiles, users] = await Promise.all([
    tx.salesAgentProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, salesCode: true } }),
    tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }),
  ]);
  const nameOf = new Map(users.map((user) => [user.id, user.displayName]));
  return new Map(profiles.filter((profile) => nameOf.has(profile.userId)).map((profile) =>
    [profile.userId, { userId: profile.userId, salesCode: profile.salesCode, label: `${nameOf.get(profile.userId)} · ${profile.salesCode}` }]));
}
function sellerOf(data: DataSet, userId: string): ExecutiveSeller {
  const seller = data.sellers.get(userId);
  return seller ? { label: seller.label, salesCode: seller.salesCode } : { label: L.referringSales.UNRESOLVED };
}

async function namesOf(tx: Tx, ids: string[]): Promise<Map<string, CompanyName>> {
  const rows = ids.length ? await tx.company.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, registeredName: true } }) : [];
  return new Map(rows.map((row) => [row.id, { name: row.name, registeredName: row.registeredName }]));
}
const registeredOf = (names: Map<string, CompanyName>, id: string) => {
  const name = names.get(id);
  return name?.registeredName && name.registeredName !== name.name ? name.registeredName : null;
};
const provinceOf = (data: DataSet, profile: ExecutiveCompanyProfile) => (profile.provinceCode && data.provinces.get(profile.provinceCode)) || EXECUTIVE_UNKNOWN_LABEL;

/** What the customer typed under "อื่น ๆ" on its original signup (the earliest linked request), read live (spec §15). */
async function otherTextsOf(db: Tx | PrismaService['client'], companyIds: string[]): Promise<Map<string, string | null>> {
  if (!companyIds.length) return new Map();
  const rows = await db.companySignupRequest.findMany({ where: { companyId: { in: companyIds } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { companyId: true, discoverySourceOther: true } });
  const result = new Map<string, string | null>();
  for (const row of rows) if (row.companyId && !result.has(row.companyId)) result.set(row.companyId, row.discoverySourceOther);
  return result;
}

const moneyIncomplete = (money: ExecutiveSourceCoverage) => money.coverage === 'unavailable' || money.reasonCodes.includes('BILLING_SCAN_NOT_COMPLETE');
function kindMoney(row: ReportRow, kinds: readonly string[]): Money {
  const byKind = (row.moneyByPurchaseKind ?? {}) as Record<string, Money>;
  const total: Money = { receiptsSatang: 0, refundsSatang: 0, feesSatang: 0, taxSatang: 0 };
  for (const kind of kinds) for (const key of Object.keys(total) as Array<keyof Money>) total[key] += byKind[kind]?.[key] ?? 0;
  return total;
}
function moneyRowOf(rows: ReportRow[], coverage: ExecutiveSourceCoverage): ExecutiveMoneyRow {
  const receipts = sum(rows, (row) => row.receiptsSatang), refunds = sum(rows, (row) => row.refundsSatang);
  return { receiptsSatang: moneyOf(receipts, coverage), refundsSatang: moneyOf(refunds, coverage), netReceiptsSatang: moneyOf(receipts - refunds, coverage),
    feesSatang: moneyOf(sum(rows, (row) => row.feesSatang), coverage), taxSatang: moneyOf(sum(rows, (row) => row.taxSatang), coverage) };
}

/** Six months up to the selected one, from the same set. A month the set does not hold is "no data", never 0 (spec §12.4). */
async function trendOf(tx: Tx, data: DataSet): Promise<TrendPoint[]> {
  const months: string[] = [];
  for (let month = data.month; months.length < 6; month = executiveMonthOf(new Date(executiveMonthRange(month).start.getTime() - 1))) months.unshift(month);
  const [headers, rows] = await Promise.all([
    tx.executiveReportMonth.findMany({ where: { month: { in: months }, definitionVersion: VERSION } }),
    tx.executiveCompanyMonth.findMany({ where: { month: { in: months }, definitionVersion: VERSION } }),
  ]);
  return months.map((month) => {
    const header = headers.find((row) => row.month === month), range = executiveMonthRange(month);
    if (!header) return { month, isPartialMonth: false, money: { coverage: 'unavailable', reasonCodes: ['HISTORY_BEFORE_COLLECTION'] }, rows: [] };
    const effectiveEnd = header.asOf < range.end ? header.asOf : range.end;
    return { month, isPartialMonth: effectiveEnd < range.end,
      money: moneyCoverageOf({ end: range.end, effectiveEnd, billingSince: data.build.billingSince, billingCoveredThrough: header.billingCoveredThrough, untiedCount: header.untiedCount }),
      rows: rows.filter((row) => row.month === month).flatMap((row) => { const profile = data.profiles.get(row.companyId); return profile ? [{ ...row, profile }] : []; }) };
  });
}
/** Whether any paid add-on money was ever recorded: until then the add-on row reads "not on sale" (spec §14.1). */
async function addOnEverSold(tx: Tx): Promise<boolean> {
  const [row] = await tx.$queryRaw<Array<{ sold: boolean }>>`SELECT EXISTS (SELECT 1 FROM "ExecutiveCompanyMonth"
    WHERE "definitionVersion" = ${VERSION} AND "moneyByPurchaseKind" ? 'ADD_ON') AS sold`;
  return row?.sold === true;
}
/** First-payment credit per company over every month the set holds: the credit as it stands now (spec §14.3). */
async function cumulativeCreditOf(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx.executiveCompanyMonth.groupBy({ by: ['companyId'], where: { definitionVersion: VERSION }, _sum: { salesCreditSatang: true } });
  return new Map(rows.map((row) => [row.companyId, row._sum.salesCreditSatang ?? 0]));
}

// ── Query reading ─────────────────────────────────────────────────────────────────────────────

function directoryOf(query: ExecutiveCompaniesQuery): DirectoryFilters {
  return {
    companyStatus: query.companyStatus ?? 'ALL', planState: query.planState ?? 'ALL', usageGroup: query.usageGroup ?? 'ALL', paidEver: query.paidEver ?? 'ALL',
    receiptAdoption: query.receiptAdoption ?? 'ALL', spendCohort: query.spendCohort ?? 'ALL', signupRail: query.signupRail ?? 'ALL',
    ...(query.usageAssessed ? { usageAssessed: query.usageAssessed === 'true' } : {}),
    ...(query.activeInPeriod ? { activeInPeriod: true } : {}), ...(query.paidInPeriod ? { paidInPeriod: true } : {}),
    ...(query.positiveNetInPeriod ? { positiveNetInPeriod: true } : {}), ...(query.fullyRefunded ? { fullyRefunded: true } : {}),
  };
}
const DIRECTORY_KEYS = ['companyStatus', 'planState', 'usageGroup', 'paidEver', 'receiptAdoption', 'spendCohort', 'signupRail'] as const;
const FLAG_KEYS = ['usageAssessed', 'activeInPeriod', 'paidInPeriod', 'positiveNetInPeriod', 'fullyRefunded'] as const;
/** The list filters in force, with their words (spec §16.2 appliedFilters). */
function directoryLabels(query: ExecutiveCompaniesQuery): Record<string, ExecutiveOption> {
  const result: Record<string, ExecutiveOption> = {};
  for (const key of DIRECTORY_KEYS) if (query[key] && query[key] !== 'ALL') result[key] = { value: query[key]!, label: L[key][query[key]!]! };
  for (const key of FLAG_KEYS) if (query[key]) result[key] = { value: query[key]!, label: EXECUTIVE_FLAG_LABELS[key][query[key]!]! };
  return result;
}
function auditableDirectory(query: ExecutiveCompaniesQuery): Record<string, string> {
  return Object.fromEntries([...DIRECTORY_KEYS, ...FLAG_KEYS].flatMap((key) => (query[key] && query[key] !== 'ALL' ? [[key, String(query[key])]] : [])));
}
/** A list filtered on a payment group that does not exist this month is empty, and says why. */
const groupsReason = (cohort: string, groups: SpendGroups): ExecutiveReasonCode[] => (cohort !== 'ALL' ? groups.blocked : []);
/** The value a list order reads; null goes last whichever the direction. */
function sortValueOf(sortBy: ExecutiveSortBy, nameOf: (row: ReportRow) => string | null): (row: ReportRow) => string | number | null {
  switch (sortBy) {
    case 'joinedAt': return (row) => row.profile.companyCreatedAt.getTime();
    case 'companyName': return nameOf;
    case 'netReceipts': return netOf;
    case 'lastActivityAt': return (row) => row.profile.lastActivityAt?.getTime() ?? null;
    default: return METRIC_OF[sortBy];
  }
}

const figureValue = (figure: { value: number | null; knownValue?: number } | null, scale = 1) => figure ? (figure.value ?? figure.knownValue ?? null) === null ? null : (figure.value ?? figure.knownValue!) / scale : null;

/** Reject unused and untrusted fields before reading data; shared filters use the read API's enums. */
function exportQueryOf(ctx: RequestContext, body: ExecutiveExportBody): ExecutiveCompaniesQuery {
  const invalid = (field: string): never => { throw executiveError(ctx.requestId, 'EXECUTIVE_QUERY_INVALID', field); };
  if (!body || typeof body !== 'object') return invalid('body');
  const allowed = ['buildId', 'reportKey', 'subview', 'month', 'filters', 'sortBy', 'sortDir', 'comparison', 'targetCompanyId', 'includeContacts', 'format'];
  for (const key of Object.keys(body)) if (!allowed.includes(key)) invalid(key);
  if (!EXECUTIVE_EXPORT_REPORT_KEYS.includes(body.reportKey)) invalid('reportKey');
  if (typeof body.buildId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.buildId)) invalid('buildId');
  if (body.format !== 'xlsx') invalid('format');
  if (typeof body.includeContacts !== 'boolean') invalid('includeContacts');
  if (body.includeContacts && !['companies', 'detail'].includes(body.reportKey)) invalid('includeContacts');
  if (!body.filters || typeof body.filters !== 'object' || Array.isArray(body.filters)) invalid('filters');
  const globals = ['industry', 'discovery', 'referringSales'];
  const filterKeys = body.reportKey === 'companies' ? [...globals, ...DIRECTORY_KEYS, ...FLAG_KEYS, 'q'] : ['compare', 'detail'].includes(body.reportKey) ? [] : globals;
  for (const [key, value] of Object.entries(body.filters)) {
    if (!filterKeys.includes(key) || typeof value !== 'string') invalid(key);
    if (key === 'q') { if (value.length > 120) invalid(key); }
    else if (key === 'referringSales') { if (!/^[A-Za-z0-9_-]{1,40}$/.test(value)) invalid(key); }
    else if (!(L[key as ExecutiveFilterKey]?.[value] ?? EXECUTIVE_FLAG_LABELS[key as keyof typeof EXECUTIVE_FLAG_LABELS]?.[value])) invalid(key);
  }
  const views = { usage: ['adoption', 'ranking'], revenue: ['summary', 'top'], customers: ['industry', 'discovery', 'sales', 'creditedSales'] };
  if (Object.hasOwn(views, body.reportKey)) { if (!views[body.reportKey as keyof typeof views].includes(body.subview!)) invalid('subview'); }
  else if (body.subview !== undefined) invalid('subview');
  if (body.sortBy !== undefined && !EXECUTIVE_SORT_OPTIONS.some(option => option.sortBy === body.sortBy)) invalid('sortBy');
  if (body.sortDir !== undefined && !['asc', 'desc'].includes(body.sortDir)) invalid('sortDir');
  const ranked = body.reportKey === 'usage' && body.subview === 'ranking', top = body.reportKey === 'revenue' && body.subview === 'top';
  if (body.reportKey !== 'companies' && !ranked && !top && (body.sortBy !== undefined || body.sortDir !== undefined)) invalid('sortBy');
  if (ranked && body.sortBy !== undefined && !Object.hasOwn(METRIC_OF, body.sortBy)) invalid('sortBy');
  if ((ranked || top) && body.sortDir !== undefined && body.sortDir !== 'desc') invalid('sortDir');
  if (top && body.sortBy !== undefined && body.sortBy !== 'netReceipts') invalid('sortBy');
  if (body.reportKey === 'detail') { if (typeof body.targetCompanyId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.targetCompanyId)) invalid('targetCompanyId'); }
  else if (body.targetCompanyId !== undefined) invalid('targetCompanyId');
  if (body.reportKey === 'compare') {
    const pair = body.comparison;
    if (!pair || Object.keys(pair).some(key => !['dimension', 'sideA', 'sideB'].includes(key)) || !['industry', 'discovery', 'referringSales', 'company'].includes(pair.dimension)) invalid('comparison');
    if (!pair!.sideA || !pair!.sideB || pair!.sideA === pair!.sideB || ![pair!.sideA, pair!.sideB].every(side => typeof side === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(side))) invalid('comparison');
  } else if (body.comparison !== undefined) invalid('comparison');
  return { month: body.month, buildId: body.buildId, ...body.filters, ...(body.sortBy ? { sortBy: body.sortBy } : ranked ? { sortBy: 'expenseReceiptCount' } : top ? { sortBy: 'netReceipts' } : {}), ...(body.sortDir ? { sortDir: body.sortDir } : ranked || top ? { sortDir: 'desc' } : {}) };
}
