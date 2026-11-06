import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { HttpException, Injectable } from '@nestjs/common';
import {
  looksLikeAccountNumber, maskedPayoutAccountNumber, EXECUTIVE_SHEET_WORDS as S, EXECUTIVE_COMPANY_SHEET_COLUMNS, COMPANY_TEAM_NOTE_WORDS, COMPANY_TEAM_NOTE_MANAGE_PERMISSION, type ExecutiveCompanyNoteBody, type ExecutiveCompanyNoteResult, type ExecutiveReportNote, type ExecutiveChurn, type ExecutiveAsOfFigures,
  DBD_TSIC_ACTIVITIES, EXECUTIVE_FLAG_LABELS, EXECUTIVE_UNKNOWN_LABEL, EXECUTIVE_PAID_EVER_REASONS, EXECUTIVE_PURCHASE_GROUPS, EXECUTIVE_REPORT_LABELS, EXECUTIVE_SORT_OPTIONS,
  executivePlanLabel, EXECUTIVE_EXPORT_REPORT_KEYS, EXECUTIVE_WORDS as LEGACY_WORDS, EXECUTIVE_REFERRER_ADMIN_SUFFIX, executiveThaiLabel, executiveComparisonLabel, executiveExportColumns, executiveMoneyQualifier,
  EXECUTIVE_PERIOD_WORDS as P, executivePeriodLabel, executivePeriodExportColumns, executivePeriodFilterLabel, executivePeriodSortLabel, executivePeriodComparisonQualifier,
  type ExecutiveExportBody, type ExecutiveRangePeriod, type ExecutivePeriodMetric, type ExecutiveCount, type ExecutivePeriodSummary, type ExecutiveMonthMetadata,
  type ExecutiveAnalysis, type ExecutiveAnalysisQuery, type ExecutiveCompanies, type ExecutiveCompaniesQuery, type ExecutiveCompanyDetail,
  type ExecutiveCompanyHistory, type ExecutiveCompanyRow, type ExecutiveCompareSide, type ExecutiveContext, type ExecutiveDrilldownFilters,
  type ExecutiveEnvelope, type ExecutiveFilterKey, type ExecutiveGroupRow, type ExecutiveHistoryEvent, type ExecutiveHistoryEventKind,
  type ExecutiveHistoryQuery, type ExecutiveMoneyRow, type ExecutiveOption, type ExecutiveOverview, type ExecutivePaidUsage, type ExecutiveRankingMetric,
  type ExecutiveRatio, type ExecutiveReasonCode, type ExecutiveReceiptAdoption, type ExecutiveReportQuery, type ExecutiveSeller, type ExecutiveSortBy,
  type ExecutiveSourceCoverage, type ExecutiveSpendConcentration,
} from '@watchdog-bms/contracts';
import { xlsxThaiDate, columnName, type WorkbookCell } from '../../../common/export/xlsx.logic';
import { PermissionResolverService } from '../../access-control/application/permission-resolver.service';
import { assertPlatformTenant, isSystemAdmin } from '../../sales-console/application/sales-context';
import { buildExecutiveWorkbook, exportDateTime, exportMonth, type ExportFigure, type ExportPanel, type ExportTable } from '../domain/executive-export.logic';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma, type ExecutiveCompanyMonth, type ExecutiveCompanyProfile, type ExecutiveReportBuild, type ExecutiveReportMonth } from '../../../generated/prisma/client';
import { AuditService } from '../../audit/application/audit.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { BillingCashMovementsService } from '../../billing/application/billing-cash-movements.service';
import {
  safeTotal, aggregatePeriodRows, monthsBetween, periodInput, periodPresets, rangePeriod, rangeCoverage, periodComparison, shiftMonth, aiCostCoverageOf, combined, countOf, documentsOf, expenseReceiptsOf, industryKeyOf, isMonth, matchesDirectory, matchesGlobal, moneyCoverageOf, moneyOf, netOf,
  ranksOf, referrerKeyOf, roundRatio, roundingNote, shareOf, sortedBy, spendGroupsOf, usageCoverageOf,
  type DirectoryFilters, type GlobalFilters, type ReportRow, type SpendGroups,
} from '../domain/executive-read.logic';
import { EXECUTIVE_DEFINITION_VERSION, executiveMonthOf, executiveMonthRange } from '../domain/executive-report.logic';
import { executiveError } from './executive-users.service';

import { CompanyTeamNoteService } from '../../system-partner-management/application/company-team-note.service';
import { bangkokDate, companyInactivity, companyPlanLabelOf as planLabelOf, companySheetOf, receiptFactsOf, receiptCoverageOf, receiptsInSystem } from '../domain/executive-company-sheet.logic';

type Tx = Prisma.TransactionClient;
type Seller = { userId: string; salesCode: string; label: string };
/** One month of the current data set, read in one snapshot, and the companies in scope for the request. */
type DataSet = {
  legacy: boolean; period: ExecutiveRangePeriod; monthly: DataSet[]; previous?: DataSet; built: boolean; rawIds: Set<string>; rowsById: Map<string, ReportRow>;
  sourceMoney: ExecutiveSourceCoverage; sourceUsage: ExecutiveSourceCoverage; sourceCost: ExecutiveSourceCoverage; cost: ExecutiveSourceCoverage;
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
const W = LEGACY_WORDS;
const iso = (at: Date | null | undefined) => (at ? at.toISOString() : null);
const sum = (rows: readonly ReportRow[], valueOf: (row: ReportRow) => number) => safeTotal(rows.map(valueOf));
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
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly billing: BillingCashMovementsService, private readonly access: PermissionResolverService, private readonly notes?: CompanyTeamNoteService) {}

  // Reject a duplicate in-process before reading; the transaction advisory lock also covers other instances.
  private readonly exporting = new Set<string>();

  /** The time this report is read at: the current month, and how old the data set is. Tests set it; nothing else does. */
  clock = () => new Date();

  // ── API01 ────────────────────────────────────────────────────────────────────────────────────

  async context(ctx: RequestContext): Promise<ExecutiveContext> {
    const now = this.clock(), currentMonth = executiveMonthOf(now);
    const { build, built, sellers, packages } = await this.prisma.client.$transaction(async (tx) => {
      const build = await latestBuild(tx);
      if (!build) return { build: null, built: [] as string[], sellers: [] as Seller[], packages: [] as ExecutiveCompanyProfile[] };
      const [months, referrers, packages] = await Promise.all([
        tx.executiveReportMonth.findMany({ where: { definitionVersion: VERSION }, orderBy: { month: 'asc' }, select: { month: true } }),
        tx.executiveCompanyProfile.findMany({ where: { reportClassification: 'CUSTOMER', referrerKind: 'KNOWN' }, distinct: ['referrerSalesUserId'],
          select: { referrerSalesUserId: true } }),
        tx.executiveCompanyProfile.findMany({ where: { reportClassification: 'CUSTOMER' }, distinct: ['planTierKey', 'planState'] }),
      ]);
      const sellers = await sellersOf(tx, referrers.map((row) => row.referrerSalesUserId));
      return { build, built: months.map((row) => row.month), sellers: [...sellers.values()], packages };
    }, SNAPSHOT);
    const has = (permission: string) => ({ allowed: ctx.permissions.includes(permission) });
    const options = (key: ExecutiveFilterKey, leaveOut: string[] = []) =>
      Object.entries(L[key]).filter(([value]) => !leaveOut.includes(value)).map(([value, label]) => ({ value, label: key === 'usageGroup' ? executivePeriodFilterLabel(key, value) : label }));
    const [all, ...special] = options('referringSales');
    const monthOf = (at: Date | null) => (at ? executiveMonthOf(at) : null);
    return {
      requestId: ctx.requestId,
      capabilities: { readReport: has('system.executive.read'), export: has('system.executive.export'), seeContacts: has('system.executive.contact.read'),
        manageAccounts: has('system.executive_user.manage') },
      filters: {
        industry: options('industry'), discovery: options('discovery'), companyStatus: options('companyStatus'), planState: options('planState'),
        receiptBucket: options('receiptBucket'), packageLabel: [...options('packageLabel'), ...[...new Map(packages.map(profile => [planLabelOf(profile), { value: planLabelOf(profile), label: planLabelOf(profile) }])).values()]], usageGroup: options('usageGroup'), paidEver: options('paidEver'), receiptAdoption: options('receiptAdoption'), signupRail: options('signupRail'),
        spendCohort: options('spendCohort', ['BOUNDARY_TIE', 'TO80_BOUNDARY_TIE']),
        referringSales: [all!, ...sellers.sort((a, b) => a.label.localeCompare(b.label, 'th')).map((seller) => ({ value: seller.salesCode, label: seller.label })), ...special],
      },
      sortOptions: EXECUTIVE_SORT_OPTIONS.map(option => ({ ...option, label: executivePeriodSortLabel(option) })),
      currentMonth, defaultMonth: periodPresets(now, built).defaultPeriod.from, ...periodPresets(now, built),
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
        companies: { ...countOf(scope.length, data.populationCoverage), unclassifiedCount: data.legacy ? data.build.unclassifiedCount : data.rows.filter(row => row.profile.reportClassification === null).length, drilldownFilters: drill({}) },
        activeCompanies: { ...countOf(active.length, data.usage), drilldownFilters: drill({ activeInPeriod: 'true' }), breakdown: {
          paidActive: active.filter((row) => row.usageGroup === 'ACTIVE').length, notPaid: active.filter((row) => row.paidEver === 'NO').length,
          paymentUnknown: active.filter((row) => row.paidEver === 'UNKNOWN').length, fullyRefunded: active.filter((row) => row.fullyRefunded).length } },
        companiesWithReceipts: { ...countOf(scope.filter((row) => row.receiptsSatang > 0).length, data.money), drilldownFilters: drill({ paidInPeriod: 'true' }) },
        netReceiptsSatang: { ...moneyOf(sum(scope, netOf), data.money), drilldownFilters: drill({}) },
      },
      churn: churnOf(data, scope, drill), asOfFigures: this.asOfFiguresOf(data),
      paidUsage: this.paidUsageOf(data, scope),
      expenseReceiptAdoption: this.adoptionOf(data, scope),
      spendConcentration: (({ topCount, population, topShare, periodBasis, coverage, reasonCodes }) =>
        ({ topCount, population, topShare, periodBasis, coverage, reasonCodes }))(spend),
    };
    if (data.previous) {
      const prior = churnOf(data.previous, data.previous.scope, this.drill(data.previous));
      result.churn.comparison = periodComparison(result.churn, prior, data.previous.period, data.period.includesOpenMonth);
      if (result.churn.share?.value !== null && result.churn.share && prior.share?.value !== null && prior.share) {
        const comparison = periodComparison({ ...result.churn, value: result.churn.share.value }, { ...prior, value: prior.share.value }, data.previous.period, data.period.includesOpenMonth, 1);
        comparison.absoluteChange = roundRatio(100n * (BigInt(result.churn.share.numerator) * BigInt(prior.share.denominator) - BigInt(prior.share.numerator) * BigInt(result.churn.share.denominator)), BigInt(result.churn.share.denominator) * BigInt(prior.share.denominator), 1);
        comparison.percentChange = null;
        result.churn.share.comparison = comparison;
      }
    }
    if (!data.legacy) {
      result.metrics.newCompanies = { ...figuresOf(data).newCompanies, drilldownFilters: drill({ joinedInPeriod: 'true' }) };
      const comparisons = result.periodComparisons!;
      for (const key of Object.keys(result.metrics) as Array<keyof typeof result.metrics>) if (result.metrics[key]) Object.assign(result.metrics[key]!, { comparison: comparisons[key] });
    }
    result.monthlySeries = seriesOf(data, ['companies', 'activeCompanies', 'companiesWithReceipts', 'netReceiptsSatang']);
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
    let list = data.scope.filter((row) => matchesDirectory(row, directory, cohort, data.range.start));
    if (q) list = list.filter((row) => [nameOf(row), names.get(row.companyId)?.registeredName, provinceOf(data, row.profile)]
      .some((text) => text?.toLocaleLowerCase('th').includes(q)));
    const sorted = sortedBy<string | number>(list, sortValueOf(sortBy, nameOf), sortDir);
    const total = sorted.length, totalPages = Math.ceil(total / pageSize), page = Math.max(1, Math.min(query.page ?? 1, totalPages));
    const shown = sorted.slice((page - 1) * pageSize, page * pageSize);

    // A rank belongs to the companies in scope (the report's filters), not to the list's own filters or its page.
    const metric = sortBy === 'netReceipts' ? netOf : (METRIC_OF as Partial<Record<string, (row: ReportRow) => number>>)[sortBy];
    const ranks = metric && !(sortBy === 'netReceipts' && moneyIncomplete(data.money)) ? ranksOf(sortedBy(data.scope, metric, 'desc'), metric) : null;
    const others = await otherTextsOf(this.prisma.client, shown.filter((row) => row.profile.discovery === 'OTHER').map((row) => row.companyId));
    const items = await Promise.all(shown.map(async (row): Promise<ExecutiveCompanyRow> => ({ ...this.rowOf(data, row, names, others.get(row.companyId)),
      ...await this.noteOf(ctx, row.companyId), ownerContact: await this.ownerContactOf(ctx, row.companyId),
      ...(ranks ? { rank: ranks.get(row.companyId)! } : {}),
      ...(sortBy === 'netReceipts' && ranks ? { cumulativeShare: groups.cumulative.get(row.companyId) ?? null } : {}) })));
    const result: ExecutiveCompanies = {
      ...this.envelope(ctx, data, query, directoryLabels(query), groupsReason(directory.spendCohort, groups)),
      summary: { netReceiptsSatang: moneyOf(sum(sorted, netOf), data.legacy ? data.money : coverageFor(data, sorted, 'money')) },
      items, pagination: { page, pageSize, total, totalPages }, sort: { sortBy, sortDir },
    };
    if (!data.legacy && data.previous) {
      result.periodComparisons = comparisonsOf(data, sorted, directoryScopeOf(data.previous, query, names));
      result.summary.netReceiptsSatang.comparison = result.periodComparisons.netReceiptsSatang;
    }
    await this.readAudit(ctx, 'companies', data, query, { ...auditableDirectory(query), sortBy, sortDir, page, pageSize }, total, !!q, items.filter(item => item.ownerContact.status === 'OK' && (item.ownerContact.email || item.ownerContact.phoneNumber)).map(item => item.id));
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
    result.monthlySeries = seriesOf(data, query.section === 'usage' ? ['activeCompanies', 'expenseReceiptCount'] : query.section === 'revenue' ? ['receiptsSatang', 'refundsSatang', 'netReceiptsSatang'] : query.section === 'customers' ? ['companies', 'newCompanies'] : ['netReceiptsSatang']);
    if (comparing && result.comparison) result.monthlySeries = (['A', 'B'] as const).flatMap(side => seriesOf(data, ['netReceiptsSatang'], month => month.population.filter(row => inComparisonSide(row, query.dimension!, side === 'A' ? query.sideA! : query.sideB!, data.salesCodeOf))).map(series => ({ ...series, side })));
    if (!data.legacy && result.revenue) for (const key of ['receiptsSatang', 'refundsSatang', 'netReceiptsSatang', 'feesSatang', 'taxSatang'] as const) result.revenue[key].comparison = result.periodComparisons?.[key];
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
        lastWebEntryAt: iso(profile.lastWebEntryAt), lastLineActivityAt: iso(profile.lastLineActivityAt), ownerContact, sheet: base.sheet, inactivity: base.inactivity, ...await this.noteOf(ctx, targetCompanyId),
      },
      periodSummary: row ? periodSummaryOf(data, row) : null,
      periodComparisons: row ? comparisonsOf(data, [row], data.previous?.population.filter(item => item.companyId === targetCompanyId)) : {},
      periodReasonCodes: monthReasons,
      monthlyHistory: data.monthly.map(month => {
        const applicable = profile.companyCreatedAt < month.effectiveEnd, r = month.rowsById.get(targetCompanyId), available = !!r && month.rawIds.has(targetCompanyId);
        const coverage = !applicable ? { money: complete(), usage: complete(), aiCost: complete(), population: complete() }
          : { ...monthMetadata(month).coverage, money: coverageFor(month, [r!], 'money'), usage: coverageFor(month, [r!], 'usage'), aiCost: coverageFor(month, [r!], 'cost') };
        return { ...monthMetadata(month), applicable, coverage, summary: applicable && available ? periodSummaryOf(month, r!) : null,
          reasonCodes: !applicable ? ['NOT_YET_REGISTERED' as const] : !available ? coverage.money.reasonCodes : r!.countersHeld ? ['SOURCE_ROWS_PURGED' as const] : [] };
      }),
      month: data.period.monthCount === 1 && row ? {
        paidEver: base.paidEver, fullyRefunded: row.fullyRefunded, paidInMonth: row.receiptsSatang > 0, positiveNetInMonth: netOf(row) > 0,
        usageGroup: base.usageGroup, ...(row.usageUnassessedReason ? { usageUnassessedReason: row.usageUnassessedReason } : {}),
        money: { ...moneyRowOf([row], data.money),
          aiCostSatang: moneyOf(row.aiCostSatang, aiCostCoverageOf({ start: data.range.start, end: data.range.end, aiUsageSince: data.build.aiUsageSince })) },
        usage: { activeDays: row.activeDays, activeDaysLine: row.activeDaysLine, activeDaysWeb: row.activeDaysWeb, activeUsers: row.activeUsers,
          activeUsersLine: row.activeUsersLine, activeUsersWeb: row.activeUsersWeb, documents: documentsOf(row), confirmedExpensesLine: row.confirmedExpensesLine,
          confirmedExpensesWeb: row.confirmedExpensesWeb, issuedDocuments: row.issuedDocuments, aiRequests: row.aiRequests,
          expenseReceiptCountInPeriod: expenseReceiptsOf(row), expenseReceiptsLine: row.expenseReceiptsLine, expenseReceiptsWeb: row.expenseReceiptsWeb },
      } : null,
      monthReasonCodes: monthReasons,
    };
    await this.companyAudit(ctx, targetCompanyId, query.month ?? null, ownerContact.status === 'OK' && (!!ownerContact.email || !!ownerContact.phoneNumber), { from: data.period.from, to: data.period.to });
    return result;
  }

  // ── API13 ────────────────────────────────────────────────────────────────────────────────────

  async export(ctx: RequestContext, body: ExecutiveExportBody): Promise<{ file: Buffer; exportReference: string; rowCount: number; period: ExecutiveRangePeriod }> {
    const W = body?.month !== undefined ? LEGACY_WORDS : { ...LEGACY_WORDS, ...P, partialMonth: P.openMonth, compareBase: P.selectedBase, detailBase: P.selectedBase,
      noPositiveCompanies: LEGACY_WORDS.noPositiveCompanies.replace('ในเดือน', 'ในช่วงนี้'), documentDefinition: LEGACY_WORDS.documentDefinition.replace('ในเดือน', 'ในช่วงนี้') };
    const usageLabels = body?.month !== undefined ? L.usageGroup : { ...L.usageGroup, INACTIVE: P.inactive, ACTIVE: P.paidActive };
    const started = performance.now(), exportReference = randomUUID();
    let ownsSlot = false, rowCount = 0, bytes = 0, data: DataSet | undefined, query: ExecutiveCompaniesQuery | undefined;
    let includesContacts = false, outcome = 'FAILED';
    let auditComparison: ExecutiveExportBody['comparison'];
    try {
      assertPlatformTenant(ctx);
      if (!['system.executive.read', 'system.executive.export'].every(key => ctx.permissions.includes(key))) throw executiveError(ctx.requestId, 'EXECUTIVE_ACCESS_DENIED', undefined, W.export.denied);
      const validatedQuery = exportQueryOf(ctx, body);
      validatedPeriod(ctx, validatedQuery, executiveMonthOf(this.clock()));
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
        for (const [id, seller] of set.sellers) set.sellers.set(id, { ...seller, label: safeNoteForExport(seller.label) });
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
        const extra = { companies: new Map(companies.map(row => [row.id, { ...row, businessTypeOther: row.businessTypeOther ? safeNoteForExport(row.businessTypeOther) : null }])), names: new Map(companies.map(row => [row.id, { name: safeNoteForExport(row.name), registeredName: row.registeredName ? safeNoteForExport(row.registeredName) : null }])), others: new Map([...others].map(([id, text]) => [id, text ? safeNoteForExport(text) : null])), credit, actor: safeNoteForExport(actor?.displayName ?? ''), trend, addOnSold };

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
          list = list.filter(row => matchesDirectory(row, directory, cohort, set.range.start) && (!search || [extra.names.get(row.companyId)?.name, extra.names.get(row.companyId)?.registeredName, provinceOf(set, row.profile)].some(text => text?.toLocaleLowerCase('th').includes(search))));
        }
        if (!list.length) throw executiveError(ctx.requestId, 'EXECUTIVE_EXPORT_EMPTY');
        if (list.length > 10_000) throw executiveError(ctx.requestId, 'EXECUTIVE_EXPORT_LIMIT_EXCEEDED');
        const sortBy = query.sortBy ?? 'joinedAt', sortDir = query.sortDir ?? DEFAULT_DIR[sortBy];
        list = sortedBy(list, sortValueOf(sortBy, row => extra.names.get(row.companyId)?.name ?? null), sortDir);
        rowCount = list.length;
        const selectedMoney = set.legacy ? set.money : coverageFor(set, list, 'money'), selectedUsage = set.legacy ? set.usage : coverageFor(set, list, 'usage');
        const selectedCost = set.legacy ? set.cost : coverageFor(set, list, 'cost');
        const metric = sortBy === 'netReceipts' ? netOf : (METRIC_OF as Partial<Record<string, (row: ReportRow) => number>>)[sortBy];
        const ranks = metric && !(sortBy === 'netReceipts' && moneyIncomplete(set.money)) ? ranksOf(sortedBy(set.scope, metric, 'desc'), metric) : null;
        const contactAt = this.clock(), oldColumns = (body.month !== undefined ? executiveExportColumns : executivePeriodExportColumns)(body.reportKey, body.subview, includesContacts);
        const sheetColumns = EXECUTIVE_COMPANY_SHEET_COLUMNS.filter(column => includesContacts || !['email', 'phone'].includes(column.key));
        const aliases: Record<string, number> = { company: 0, businessType: 4, plan: 7, joinedAt: 5, signupRail: 11, discovery: 9, referrer: 12, receiptsLifetime: 19 };
        const replaced = new Set(Object.values(aliases));
        const kept = oldColumns.map((label, index) => ({ label, index })).filter(({ index, label }) => !replaced.has(index) && ![W.email, W.phoneNumber].includes(label));
        const columns = [...sheetColumns.map(column => column.label), ...kept.map(column => column.label)];
        const sourceColumn = (old: number) => {
          const key = Object.keys(aliases).find(key => aliases[key] === old - 1);
          return key ? sheetColumns.findIndex(column => column.key === key) + 1 : sheetColumns.length + kept.findIndex(column => column.index === old - 1) + 1;
        };
        const prefixes: WorkbookCell[][] = [];
        const costs = selectedCost;
        const rows: WorkbookCell[][] = [];
        for (const row of list) {
          if (performance.now() - started > 30_000) throw executiveError(ctx.requestId, 'EXECUTIVE_EXPORT_LIMIT_EXCEEDED');
          const company = this.rowOf(set, row, extra.names, extra.others.get(row.companyId)), profile = row.profile, live = extra.companies.get(row.companyId);
          const countValue = (figure: ExecutiveCount) => figure.coverage === 'complete' ? figure.value : figure.coverage === 'partial' ? `${W.atLeast} ${figure.knownValue ?? 0}` : W.unavailableFigure;
          const sources = set.legacy ? { money: set.money, usage: set.usage, aiCost: costs } : periodSummaryOf(set, row).coverage;
          const money = (satang: number) => sources.money.coverage === 'unavailable' ? null : { value: satang / 100, style: 3 };
          const usage = (n: number) => sources.usage.coverage === 'unavailable' ? null : n;
          const notes = [sources.usage.coverage !== 'complete' ? W.export.usageMissing : '', sources.money.coverage !== 'complete' ? W.export.moneyMissing : '', sources.aiCost.coverage !== 'complete' ? W.export.aiMissing : '',
            profile.receiptAdoption === 'UNKNOWN' ? L.receiptAdoption.UNKNOWN : '', row.paidEverReason === 'MANUAL_TERM_NO_RECEIPT' ? W.manualTerm : '', body.reportKey === 'revenue' && body.subview === 'top' ? spendStatus : ''].filter(Boolean).join(' · ');
          const cells: WorkbookCell[] = [company.displayName, company.registeredName, company.provinceLabel, executiveThaiLabel(company.industryGroup.label),
            live?.businessTypeCode === 'OTHER' ? live.businessTypeOther : DBD_LABEL.get(live?.businessTypeCode ?? '') ?? null, xlsxThaiDate(company.joinedAt),
            L.companyStatus[company.companyStatus] ?? W.unknown, executiveThaiLabel(company.planLabel), L.planState[company.planState] ?? W.unknown,
            executiveThaiLabel(company.discovery.label), company.discovery.otherText ?? null, executiveThaiLabel(L.signupRail[company.signupRail] ?? W.unknown),
            executiveThaiLabel(company.referrer.label, company.referrer.salesCode) + (company.referrer.source === 'ADMIN' ? ` ${EXECUTIVE_REFERRER_ADMIN_SUFFIX}` : ''),
            company.creditedSeller.label ? executiveThaiLabel(company.creditedSeller.label, company.creditedSeller.salesCode) : null,
            profile.creditedSalesUserId ? { value: (extra.credit.get(row.companyId) ?? 0) / 100, style: 3 } : null, xlsxThaiDate(iso(profile.salesCreditPaidAt)),
            L.paidEver[row.paidEver]!, row.fullyRefunded ? EXECUTIVE_FLAG_LABELS.fullyRefunded.true! : row.usageGroup ? usageLabels[row.usageGroup]! : L.paidEver.UNKNOWN!,
            L.receiptAdoption[profile.receiptAdoption]!, countValue(company.sheet.receiptsLifetime),
            usage(expenseReceiptsOf(row)), usage(row.activeDays), set.period.monthCount > 1 ? null : usage(row.activeUsers), usage(documentsOf(row)), usage(row.aiRequests),
            money(row.receiptsSatang), money(row.refundsSatang), money(netOf(row)), money(row.feesSatang), sources.aiCost.coverage === 'unavailable' ? null : { value: row.aiCostSatang / 100, style: 3 },
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
          const note = await this.noteOf(ctx, row.companyId), sheet = company.sheet, inactivity = company.inactivity;
          const contact = includesContacts ? { email: cells[cells.length - 3], phone: cells[cells.length - 2] } : { email: null, phone: null };
          const moneyValue = (figure: ExecutiveCount): WorkbookCell => ({ value: figureValue(figure, 100), style: 3 });
          const values: Record<string, WorkbookCell> = {
            company: company.displayName, businessType: sheet.businessTypeLabel ? safeNoteForExport(sheet.businessTypeLabel) : null, plan: executiveThaiLabel(company.planLabel), receiptsLifetime: countValue(sheet.receiptsLifetime),
            firstReceiptAt: xlsxThaiDate(sheet.firstReceiptAt), lastReceiptAt: xlsxThaiDate(sheet.lastReceiptAt), planEndsAt: xlsxThaiDate(sheet.planEndsAt), ...contact,
            note: safeNoteForExport(note.note.text), noteUpdatedBy: safeNoteForExport(note.note.updatedBy?.displayName ?? ''), noteUpdatedAt: xlsxThaiDate(note.note.updatedAt, true),
            daysSinceLastReceipt: sheet.daysSinceLastReceipt, receiptBucket: sheet.receiptBucket ? S.receiptBucket[sheet.receiptBucket] : W.unavailableFigure,
            paymentState: sheet.paymentState.fullyRefunded ? EXECUTIVE_FLAG_LABELS.fullyRefunded.true! : L.paidEver[sheet.paymentState.paidEver]!,
            daysLeft: sheet.packageExpired ? S.expired : sheet.daysLeft,
            ...Object.fromEntries(['receipts7', 'receipts30', 'receiptDays30', 'confirmed', 'pending', 'draft', 'aiRequests30'].map(key => [key, countValue(sheet[key as 'receipts7'])])),
            lifetimeReceiptsSatang: moneyValue(sheet.lifetimeReceiptsSatang), lifetimeRefundsSatang: moneyValue(sheet.lifetimeRefundsSatang), lifetimeNetSatang: moneyValue(sheet.lifetimeNetSatang),
            activeMemberCount: sheet.activeMemberCount, branchCount: sheet.branchCount, joinedAt: xlsxThaiDate(company.joinedAt), signupRail: cells[11]!, discovery: cells[9]!, referrer: cells[12]!,
            lastUseAt: xlsxThaiDate(inactivity.lastUseAt), daysSinceLastUse: inactivity.daysSinceLastUse,
            churned: inactivity.churned === null ? W.unavailableFigure : inactivity.churned ? W.export.yes : W.export.no,
          };
          prefixes.push(sheetColumns.map(column => values[column.key] ?? null));
          rows.push(cells);
        }
        const envelope = this.envelope(ctx, set, query, directoryLabels(query));
        const range = (c: number) => `'รายบริษัท'!${columnName(sourceColumn(c))}7:${columnName(sourceColumn(c))}${6 + rows.length}`;
        const count = (label: string, n: number, source: ExecutiveSourceCoverage, formula?: string): ExportFigure => ({ label, value: source.coverage === 'unavailable' ? null : n,
          status: source.coverage === 'partial' ? W.atLeast : undefined, ...(source.coverage !== 'unavailable' && formula ? { formula } : {}) });
        const sumFormula = (c: number, source: ExecutiveSourceCoverage) => source.coverage === 'unavailable' ? undefined : `SUM(${range(c)})`;
        const kpis: ExportFigure[] = [count(W.companyCount, list.length, set.populationCoverage, `COUNTA(${range(1)})`),
          count(W.active, list.filter(row => row.activeDays > 0).length, selectedUsage, `COUNTIF(${range(22)},">0")`),
          { label: W.net, value: selectedMoney.coverage === 'unavailable' ? null : sum(list, netOf) / 100, formula: sumFormula(28, selectedMoney), style: 3, status: selectedMoney.coverage === 'partial' ? W.partialMoney : undefined }];
        if (body.reportKey === 'companies') kpis[0] = { label: W.companyCount, value: list.length, formula: `COUNTA(${range(1)})`, status: W.found(list.length) };
        if (detail) kpis.splice(0, 3, kpis[2]!, count(W.receiptCount, sum(list, expenseReceiptsOf), selectedUsage, sumFormula(21, selectedUsage)),
          count(W.days, sum(list, row => row.activeDays), selectedUsage, sumFormula(22, selectedUsage)));
        const adoption = this.adoptionOf(set, list);
        const bucketRange = `'รายบริษัท'!${columnName(1 + sheetColumns.findIndex(column => column.key === 'receiptBucket'))}7:${columnName(1 + sheetColumns.findIndex(column => column.key === 'receiptBucket'))}${6 + rows.length}`;
        let panels: ExportPanel[] = [{ title: W.adoptionTitle, kind: 'doughnut', labels: adoption.segments.map(segment => L.receiptAdoption[segment.key]!), values: adoption.segments.map(segment => segment.count),
          formulas: adoption.segments.map(segment => `COUNTIF(${range(19)},"${L.receiptAdoption[segment.key]}")`) },
          { title: S.receiptDistribution, kind: 'bar', labels: W.export.buckets, values: (['ZERO', 'ONE_TO_FIVE', 'SIX_PLUS'] as const).map(key => list.filter(row => row.sheet!.receiptBucket === key).length),
            formulas: W.export.buckets.map(label => `COUNTIF(${bucketRange},"${label}")`), status: W.export.bucketsDefinition },
          { title: W.paidUsage, kind: 'bar', labels: Object.values(usageLabels).slice(1), values: this.paidUsageOf(set, list).groups.map(group => group.count),
            formulas: Object.values(usageLabels).slice(1).map(label => `COUNTIF(${range(18)},"${label}")`) },
          { title: W.net, kind: 'bar', labels: [W.receipts, W.refunds, W.net], values: [sum(list, row => row.receiptsSatang), sum(list, row => row.refundsSatang), sum(list, netOf)].map(n => selectedMoney.coverage === 'unavailable' ? null : n / 100),
            formulas: [26, 27, 28].map(c => sumFormula(c, selectedMoney) ?? 'IF(1=1,"",0)'), status: selectedMoney.coverage === 'partial' ? W.partialMoney : undefined, style: 3 }];
        const tables: ExportTable[] = [];
        if (body.reportKey === 'usage' && body.subview === 'ranking') {
          const ranking = this.rankingOf(set, sortBy as ExecutiveRankingMetric, extra.names);
          panels[1] = { title: W.rankTitle, kind: 'bar', labels: ranking.items.map(row => row.displayName), values: ranking.items.map(row => row.value), formulas: ranking.items.map(item => `'รายบริษัท'!${columnName(sourceColumn(sortBy === 'expenseReceiptCount' ? 21 : sortBy === 'activeDays' ? 22 : 25))}${7 + list.findIndex(row => row.companyId === item.id)}`), status: set.usage.coverage === 'partial' ? W.atLeast : undefined };
          tables.push({ title: W.ranking, headers: [W.export.rank, W.company, EXECUTIVE_SORT_OPTIONS.find(option => option.sortBy === sortBy)!.label], rows: rows.map(row => [row[34]!, row[0]!, row[sortBy === 'expenseReceiptCount' ? 20 : sortBy === 'activeDays' ? 21 : 24]!]) });
        }
        if (body.reportKey === 'revenue' && body.subview === 'summary') {
          const revenue = this.revenueOf(set, extra.trend, extra.addOnSold);
          panels[0] = { title: W.purchase, kind: 'bar', labels: revenue.byPurchaseGroup.map(group => group.label), values: revenue.byPurchaseGroup.map(group => figureValue(group.netReceiptsSatang, 100)), statuses: revenue.byPurchaseGroup.map(group => executiveMoneyQualifier(group.netReceiptsSatang)), style: 3 };
          panels[1] = { title: W.trend, kind: 'bar', labels: revenue.trend.map(point => exportMonth(point.month)), values: revenue.trend.map(point => figureValue(point.netReceiptsSatang, 100)), statuses: revenue.trend.map(point => executiveMoneyQualifier(point.netReceiptsSatang)), style: 3 };
          tables.push({ title: W.purchase, headers: [W.purchase, W.receipts, W.refunds, W.net, W.fees, W.tax, W.export.notes], rows: revenue.byPurchaseGroup.map(group => [group.label,
            ...[group.receiptsSatang, group.refundsSatang, group.netReceiptsSatang, group.feesSatang, group.taxSatang].map(figure => ({ value: figureValue(figure, 100), style: 3 })), executiveMoneyQualifier(group.netReceiptsSatang)]) });
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
          panels[2] = { title: W.positiveNet, kind: 'bar', labels: [W.positiveNet, W.negativeTotal], values: (set.legacy ? set.money.coverage === 'unavailable' : moneyIncomplete(set.money)) ? [null, null] : [groups.positiveNetTotalSatang / 100, groups.negativeNetSatang / 100], style: 3, status: negativeNote };
          tables.push({ title: W.positiveNet, headers: [W.companyCount, W.positiveNet, W.negativeTotal, W.export.notes], rows: [[(set.legacy ? set.money.coverage === 'unavailable' : moneyIncomplete(set.money)) ? null : groups.positiveCompanyCount, { value: (set.legacy ? set.money.coverage === 'unavailable' : moneyIncomplete(set.money)) ? null : groups.positiveNetTotalSatang / 100, style: 3 }, { value: (set.legacy ? set.money.coverage === 'unavailable' : moneyIncomplete(set.money)) ? null : groups.negativeNetSatang / 100, style: 3 }, negativeNote]] });
        }
        if (body.reportKey === 'customers') {
          const grouped = this.groupsOf(set, body.subview === 'creditedSales' ? 'sales' : body.subview as 'industry' | 'discovery' | 'sales', extra.credit);
          const groupLabel = (group: ExecutiveGroupRow) => executiveThaiLabel(group.label, set.sellers.get(group.key)?.salesCode ?? group.key);
          const labels = grouped.groups!.map(groupLabel);
          panels[0] = { title: W.companyCount, kind: 'bar', labels, values: grouped.groups!.map(group => group.companies.count) };
          panels[1] = { title: W.net, kind: 'bar', labels, values: grouped.groups!.map(group => figureValue(group.netReceiptsSatang, 100)), style: 3 };
          panels[2] = { title: W.active, kind: 'bar', labels, values: grouped.groups!.map(group => figureValue(group.activeCompanies)), status: set.usage.coverage === 'partial' ? W.atLeast : undefined };
          panels[3] = { title: W.paid, kind: 'bar', labels, values: grouped.groups!.map(group => figureValue(group.companiesWithReceipts)), status: set.money.coverage === 'partial' ? W.atLeast : undefined };
          tables.push({ title: W.customers, headers: [W.group, W.companyCount, W.net, W.active, W.export.notes], rows: grouped.groups!.map(group => [groupLabel(group), group.companies.count, { value: figureValue(group.netReceiptsSatang, 100), style: 3 }, figureValue(group.activeCompanies),
            set.legacy ? set.populationCoverage.coverage === 'partial' || group.netReceiptsSatang.coverage === 'partial' ? W.atLeast : ''
              : [executiveMoneyQualifier(group.netReceiptsSatang), group.activeCompanies.coverage !== 'complete' ? W.export.usageMissing : '', set.populationCoverage.coverage === 'partial' ? W.atLeast : ''].filter(Boolean).join(' · ')]) });
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
        const churn = churnOf(set, list, this.drill(set));
        tables.push({ title: S.churn, headers: [W.figure, W.companyCount, S.everUsedShare, W.export.notes], rows: [[S.churn, figureValue(churn), churn.share?.value ?? null, churn.coverage === 'partial' ? W.atLeast : churn.coverage === 'unavailable' ? W.unavailableFigure : '']] });
        if (body.reportKey === 'overview') {
          const figures = this.asOfFiguresOf(set), blocks = [figures.companies, figures.receiptsLifetime, ...figures.receiptBuckets, figures.receipts7, figures.receipts30, figures.receiptDays30AtLeast2, figures.followUp.neverUsed, figures.followUp.churn];
          const labels = [W.companyCount, S.lifetime, ...figures.receiptBuckets.map(bucket => bucket.label), S.receipts7, S.receipts30, S.receiptDays30AtLeast2, S.neverUsed, S.churn];
          tables.push({ title: `${S.asOf} · ${xlsxThaiDate(figures.asOf)}`, headers: [W.figure, S.count, S.share, W.export.notes], rows: blocks.map((block, i) => [labels[i]!, figureValue(block), 'share' in block ? block.share?.value ?? null : null, [block.coverage === 'partial' ? W.atLeast : block.coverage === 'unavailable' ? W.unavailableFigure : '', ...('everUsed' in block ? [S.everUsedShare] : [])].filter(Boolean).join(' · ')]) });
          tables.push({ title: S.package, headers: [S.package, W.companyCount, W.export.notes], rows: figures.packages.map(item => [item.label, figureValue(item), item.coverage === 'partial' ? W.atLeast : item.coverage === 'unavailable' ? W.unavailableFigure : '']) });
          tables.push({ title: W.adoptionTitle, headers: [W.figure, W.companyCount, S.share], rows: figures.adoption.segments.map(segment => [L.receiptAdoption[segment.key]!, segment.count, segment.share.value]) });
        }
        if (detail) panels = panels.filter(panel => panel.kind !== 'doughnut');
        const sort = EXECUTIVE_SORT_OPTIONS.find(option => option.sortBy === sortBy)!, sortLabel = body.month !== undefined ? sort.label : executivePeriodSortLabel(sort);
        const filters = [...Object.values(envelope.appliedFilters.global), ...Object.values(envelope.appliedFilters.directory)].filter(option => option.value !== 'ALL').map(option => safeNoteForExport(executiveThaiLabel(option.label, option.value)));
        const metadata = [S.asOfHelp, S.churnHelp(xlsxThaiDate(churn.referenceDate)!), W.through(exportDateTime(envelope.dataThrough.oldest ?? set.build.asOf)), `${W.filters} · ${[...filters, ...(query.q ? [`${W.search} · ${safeNoteForExport(query.q)}`] : []), ...(comparison ? [executiveComparisonLabel(comparison.sideA, comparison.dimension), executiveComparisonLabel(comparison.sideB, comparison.dimension)] : [])].join(' · ') || W.export.none}`,
          `${W.sort} · ${sortDir === sort.sortDir ? sortLabel : sortLabel.replace('มาก → น้อย', 'น้อย → มาก').replace('ก → ฮ', 'ฮ → ก').replace('ล่าสุดก่อน', 'เก่าสุดก่อน')}`, W.found(list.length), W.excluded,
          W.moneyDefinition, W.vatIncluded, W.receiptDefinition, W.documentDefinition, W.usersDefinition, W.aiDefinition,
          ...[executiveMoneyQualifier(poolCoverage(list.map(row => row.sheet!.lifetimeReceiptsSatang)))].filter(Boolean),
          W.export.sentBy(extra.actor, exportDateTime(this.clock())), `${W.export.reference} · ${exportReference}`,
          ...(selectedMoney.coverage !== 'complete' ? [W.export.moneyMissing] : []), ...(selectedUsage.coverage !== 'complete' ? [W.export.usageMissing] : []),
          ...envelope.dataThrough.lagging.map(source => source === 'billing' && envelope.dataThrough.billing ? W.moneyThrough(exportDateTime(envelope.dataThrough.billing)) : ''),
          ...(includesContacts ? [W.export.personal, W.contactAt(exportDateTime(contactAt))] : [])];
        if (body.month === undefined) {
          metadata.push(...(set.period.includesOpenMonth ? [P.openMonth] : []), ...(set.period.monthCount > 1 ? [P.distinctUsersUnavailable] : []), P.currentAt(exportDateTime(set.build.asOf)));
          for (const [source, measured] of [[selectedMoney, false], [selectedUsage, false], [selectedCost, true]] as const) if (source.coverage !== 'complete') {
            const months = (source.affectedMonths ?? []).map(part => exportMonth(part.month)).join(', ');
            metadata.push(P.incomplete(months), ...(measured ? [executiveMoneyQualifier(source, true)] : []));
          }
          // Monthly sources and previous-period inputs stay in the calculation area of the original two sheets.

          tables.push(monthlyExportTable(set, list, extra.names, P.monthlyHistory, started));
          const selectedPrevious = body.reportKey === 'companies' ? directoryScopeOf(set.previous!, query, extra.names)
            : detail ? set.previous!.population.filter(row => row.companyId === body.targetCompanyId)
            : comparing ? set.previous!.population.filter(row => body.comparison!.dimension === 'company' ? [body.comparison!.sideA, body.comparison!.sideB].includes(row.companyId)
              : [body.comparison!.sideA, body.comparison!.sideB].includes(body.comparison!.dimension === 'industry' ? industryKeyOf(row) : body.comparison!.dimension === 'discovery' ? row.profile.discovery : referrerKeyOf(row, set.salesCodeOf)))
            : set.previous!.scope;
          tables.push(monthlyExportTable(set.previous!, selectedPrevious, extra.names, `${P.previous} · ${P.monthlyHistory}`, started));
          const comparisons = comparisonsOf(set, list, selectedPrevious);
          tables.push({ title: P.compareWith(executivePeriodLabel(set.previous!.period.from, set.previous!.period.to)), headers: [W.figure, W.current, P.previous, W.difference, W.export.notes],
            rows: (['companies', 'activeCompanies', 'companiesWithReceipts', 'netReceiptsSatang', 'expenseReceiptCount'] as const).map((key, i) => {
              const comparison = comparisons[key]!, scale = key === 'netReceiptsSatang' ? 100 : 1;
              const status = executivePeriodComparisonQualifier(comparison);
              return [[W.companyCount, W.active, W.paid, W.net, W.receiptCount][i]!, { value: figureValue(comparison.current, scale), style: scale === 100 ? 3 : 0 },
                { value: figureValue(comparison.previous, scale), style: scale === 100 ? 3 : 0 }, { value: comparison.absoluteChange === null ? null : comparison.absoluteChange / scale, style: scale === 100 ? 3 : 0 }, status];
            }) });
        }
        const file = buildExecutiveWorkbook({ title: W[body.reportKey], month: body.month ?? set.month, ...(body.month === undefined ? { period: set.period } : {}), metadata, columns, rows: rows.map((row, i) => [...prefixes[i]!, ...kept.map(column => row[column.index]!)]), kpis, panels, tables });
        bytes = file.length;
        const [current, currentActor, session] = await Promise.all([
          this.access.resolveAccess(ctx.userId, ctx.companyId),
          this.prisma.client.user.findUnique({ where: { id: ctx.userId }, select: { status: true } }),
          ctx.sessionId ? this.prisma.client.authSession.findUnique({ where: { id: ctx.sessionId }, select: { userId: true, status: true, expiresAt: true } }) : Promise.resolve(null),
        ]);
        if (currentActor?.status !== 'ACTIVE' || (ctx.sessionId && (!session || session.userId !== ctx.userId || session.status !== 'ACTIVE' || session.expiresAt <= this.clock()))) throw executiveError(ctx.requestId, 'EXECUTIVE_ACCESS_DENIED', undefined, W.export.denied);
        if (!['system.executive.read', 'system.executive.export', ...(includesContacts ? ['system.executive.contact.read'] : [])].every(key => current.permissions.includes(key))) throw executiveError(ctx.requestId, 'EXECUTIVE_ACCESS_DENIED', undefined, W.export.denied);
        if (performance.now() - started > 30_000) throw executiveError(ctx.requestId, 'EXECUTIVE_EXPORT_LIMIT_EXCEEDED');
        return { file, exportReference, rowCount, period: set.period };
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
          metadataJson: { exportReference, reportKey: query ? body.reportKey : null, subview: query ? body.subview ?? null : null, month: query?.month ?? null, period: data?.period ? { from: data.period.from, to: data.period.to } : query ? { from: query.from ?? query.month, to: query.to ?? query.month } : null,
            filters: data && query ? { ...data.global, ...auditableDirectory(query) } : {}, comparison: auditComparison ?? null,
            sortBy: query?.sortBy ?? null, sortDir: query?.sortDir ?? null, hasSearch: !!query?.q, rowCount, companyCount: rowCount, bytes, includesContacts, outcome,
            buildId: data?.build.id ?? null, definitionVersion: data?.build.definitionVersion ?? null, templateVersion: 'executive-v4-1' } });
      } finally { if (ownsSlot) this.exporting.delete(ctx.userId); }
    }
  }

  // ── API06 ────────────────────────────────────────────────────────────────────────────────────

  /** The company's own events from the rows that already record them; nothing of who did it or why (spec §16.1 API06). */
  async history(ctx: RequestContext, targetCompanyId: string, query: ExecutiveHistoryQuery): Promise<ExecutiveCompanyHistory> {
    const readEvents = async (tx: Tx) => {
      const profile = await tx.executiveCompanyProfile.findUnique({ where: { companyId: targetCompanyId }, select: { reportClassification: true } });
      if (profile?.reportClassification !== 'CUSTOMER') return null;
      return Promise.all([
        tx.company.findUnique({ where: { id: targetCompanyId }, select: { createdAt: true } }),
        tx.auditLog.findMany({ where: { action: LIFECYCLE_ACTION, targetType: 'company', targetId: targetCompanyId }, select: { createdAt: true, actorUserId: true, metadataJson: true } }),
      ]);
    };
    const loaded = query.from !== undefined || query.to !== undefined || query.month !== undefined ? await this.load(ctx, query, false, readEvents) : null;
    const periodData = loaded?.data ?? null;
    const found = loaded ? loaded.extra : await this.prisma.client.$transaction(async tx => {
      if (!await latestBuild(tx)) throw executiveError(ctx.requestId, 'SOURCE_UNAVAILABLE');
      return readEvents(tx);
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
      events.push({ kind: renewal ? 'PACKAGE_RENEWED' : 'PACKAGE_PURCHASED', at: purchase.appliedAt.toISOString(), planLabel: executivePlanLabel(purchase.tierKey) });
    }
    const appliedEvents = periodData ? events.filter(event => event.at >= periodData.period.startInclusive && event.at < periodData.period.effectiveEndExclusive) : events;
    appliedEvents.sort((a, b) => b.at.localeCompare(a.at));
    const pageSize = query.pageSize ?? 20, totalPages = Math.ceil(appliedEvents.length / pageSize), page = Math.max(1, Math.min(query.page ?? 1, totalPages));
    await this.companyAudit(ctx, targetCompanyId, query.month ?? null, false, periodData ? { from: periodData.period.from, to: periodData.period.to } : undefined);
    return { requestId: ctx.requestId, ...(periodData ? (({ build, buildChanged, period, coverage, sourceStatus, dataThrough }) => ({ build, buildChanged, period, coverage, sourceStatus, dataThrough }))(this.envelope(ctx, periodData, query)) : {}), items: appliedEvents.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total: appliedEvents.length, totalPages } };
  }

  // ── The data set ─────────────────────────────────────────────────────────────────────────────

  /**
   * One month of the latest build, in one REPEATABLE READ snapshot: a round that commits meanwhile is either all seen or not at
   * all. `extra` reads more in the same snapshot. No build yet, or a month the data set does not hold yet (the first hour of a
   * month): 503, never zeros.
   */
  private async load<T = undefined>(ctx: RequestContext, query: ExecutiveReportQuery, useGlobalFilters: boolean,
    extra?: (tx: Tx, data: DataSet) => Promise<T>): Promise<{ data: DataSet; extra: T }> {
    const requested = validatedPeriod(ctx, query, executiveMonthOf(this.clock()));
    return this.prisma.client.$transaction(async (tx) => {
      const build = await latestBuild(tx);
      if (!build) throw executiveError(ctx.requestId, 'SOURCE_UNAVAILABLE');
      const months = monthsBetween(requested.from, requested.to), previousTo = shiftMonth(requested.from, -1), previousFrom = shiftMonth(requested.from, -months.length);
      const [first, headers, monthRows, profileRows, provinces, legacyHeader] = await Promise.all([
        tx.executiveReportMonth.findFirst({ where: { definitionVersion: VERSION }, orderBy: { month: 'asc' }, select: { month: true } }),
        tx.executiveReportMonth.findMany({ where: { month: { gte: previousFrom, lte: requested.to }, definitionVersion: VERSION } }),
        tx.executiveCompanyMonth.findMany({ where: { month: { gte: previousFrom, lte: requested.to }, definitionVersion: VERSION } }),
        tx.executiveCompanyProfile.findMany(),
        tx.$queryRaw<Array<{ provinceCode: string; provinceTh: string }>>`SELECT DISTINCT "provinceCode", "provinceTh" FROM "ThaiAddressMaster"`,
        query.month ? tx.executiveReportMonth.findUnique({ where: { month_definitionVersion: { month: query.month, definitionVersion: VERSION } } }) : Promise.resolve(null),
      ]);
      if (!first || requested.from < first.month) throw executiveError(ctx.requestId, 'EXECUTIVE_QUERY_INVALID', query.month ? 'month' : 'from', query.month ? undefined : P.invalid);
      const headerOf = new Map(headers.map(header => [header.month, header]));
      if (legacyHeader) headerOf.set(query.month!, { ...legacyHeader, month: query.month! });
      const unbuiltMonths = [...new Set([requested.from, requested.to].filter(month => !headerOf.has(month)))];
      if (unbuiltMonths.length && query.month !== undefined) throw executiveError(ctx.requestId, 'SOURCE_UNAVAILABLE');
      if (unbuiltMonths.length) throw new HttpException({ code: 'EXECUTIVE_REPORT_UNAVAILABLE', message: P.unbuilt(unbuiltMonths.map(exportMonth).join(', ')), requestId: ctx.requestId, unbuiltMonths }, 503);
      const profiles = new Map(profileRows.map(profile => [profile.companyId, profile]));
      const sellers = await sellersOf(tx, profileRows.flatMap(profile => [profile.referrerKind === 'KNOWN' ? profile.referrerSalesUserId : null, profile.creditedSalesUserId]));
      const salesCodeOf = new Map([...sellers.values()].map(seller => [seller.userId, seller.salesCode]));
      const global = await this.globalOf(tx, ctx, query, salesCodeOf, sellers, useGlobalFilters);
      const shared = { legacy: query.month !== undefined, build, profiles, global, sellers, salesCodeOf, provinces: new Map(provinces.map(row => [row.provinceCode, row.provinceTh])) };
      const byMonth = new Map<string, ReportRow[]>();
      for (const row of monthRows) {
        const profile = profiles.get(row.companyId);
        if (!profile || !headerOf.has(row.month)) continue;
        const rows = byMonth.get(row.month) ?? []; rows.push({ ...row, reportClassification: profile.reportClassification, profile }); byMonth.set(row.month, rows);
      }
      const make = (from: string, to: string): DataSet => {
        const period = rangePeriod(from, to, build.asOf, executiveMonthOf(this.clock()));
        const monthly = monthsBetween(from, to).map(month => monthDataSet(shared, month, headerOf.get(month), byMonth.get(month) ?? [], executiveMonthOf(this.clock())));
        return aggregateDataSet(shared, period, monthly);
      };
      const packageLabel = (query as ExecutiveCompaniesQuery).packageLabel;
      if (packageLabel && packageLabel !== 'ALL' && !profileRows.some(profile => planLabelOf(profile) === packageLabel)) throw executiveError(ctx.requestId, 'EXECUTIVE_QUERY_INVALID', 'packageLabel');
      const data = make(requested.from, requested.to); data.previous = make(previousFrom, previousTo);
      if ((query as ExecutiveCompaniesQuery).atDataDate === 'true') { data.scope = asOfRowsOf(data); data.population = data.scope; data.rowsById = new Map(data.scope.map(row => [row.companyId, row])); }
      // API01 identifies the server's default preset. An explicit pair cannot prove which shortcut a caller chose.
      return { data, extra: (extra ? await extra(tx, data) : undefined) as T };
    }, SNAPSHOT).catch(error => {
      if (error instanceof RangeError && error.message === 'EXECUTIVE_TOTAL_OVERFLOW') throw executiveError(ctx.requestId, 'SOURCE_UNAVAILABLE');
      throw error;
    });
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
    const excluded = rows.filter((row) => row.reportClassification === 'TEST' || row.reportClassification === 'INTERNAL' || row.reportClassification === 'DEMO');
    const sellerLabel = (code: string) => L.referringSales[code] ?? [...data.sellers.values()].find((seller) => seller.salesCode === code)?.label ?? code;
    return {
      requestId: ctx.requestId,
      build: { id: build.id, asOf: build.asOf.toISOString(), definitionVersion: build.definitionVersion, dimensionVersion: build.dimensionVersion,
        monthRevision: header.revision, monthRevisedAt: iso(header.revisedAt) },
      buildChanged: !!query.buildId && query.buildId !== build.id,
      reasonCodes: [...(this.clock().getTime() - build.asOf.getTime() > STALE_AFTER_MS ? ['SOURCE_STALE' as const] : []), ...reasons],
      months: data.monthly.map(monthMetadata), previousMonths: data.previous?.monthly.map(monthMetadata),
      periodComparisons: comparisonsOf(data),
      period: { ...data.period, month: data.month, timeZone: 'Asia/Bangkok', startInclusive: data.range.start.toISOString(), endExclusive: data.range.end.toISOString(),
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
        unclassifiedCount: data.legacy ? build.unclassifiedCount : rows.filter(row => row.profile.reportClassification === null).length, excludedTestInternalNetReceiptsSatang: sum(excluded, netOf),
        unclassifiedNetReceiptsSatang: sum(rows.filter((row) => row.reportClassification === null), netOf),
        ...(data.legacy ? {} : { excludedTestInternalMoneyCoverage: coverageFor(data, excluded, 'money'), unclassifiedMoneyCoverage: coverageFor(data, rows.filter(row => row.reportClassification === null), 'money') }),
      },
      unmatchedMoney: { count: header.untiedCount, receiptsSatang: header.untiedReceiptsSatang, refundsSatang: header.untiedRefundsSatang, otherSatang: header.untiedOtherSatang, ...(data.legacy ? {} : { coverage: rangeCoverage(data.monthly.map(month => ({ month: month.month, source: month.sourceMoney }))) }) },
      coverage: { money: data.money, usage: data.usage, aiCost: data.cost },
      sourceStatus: sourceStatusOf(data, this.clock()),
    };
  }

  /** The complete list query behind an item: the request's report filters plus the item's own. */
  private drill(data: DataSet) {
    const global = Object.fromEntries(Object.entries(data.global).filter(([, value]) => value !== 'ALL'));
    return (own: ExecutiveDrilldownFilters): ExecutiveDrilldownFilters => ({ ...(data.legacy ? {} : { from: data.period.from, to: data.period.to }), ...global, ...own });
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
      ...figures, ...(!data.legacy && moneyIncomplete(data.money) ? { positiveCompanyCount: null, nonPositiveCount: null, positiveNetTotalSatang: null, negativeNetSatang: null } : {}), receiptsWithoutPositiveNet: !data.legacy && moneyIncomplete(data.money) ? null : scope.filter((row) => row.receiptsSatang > 0 && netOf(row) <= 0).length,
      periodBasis: data.period.monthCount === 1 ? 'SELECTED_MONTH' : 'SELECTED_PERIOD', coverage: coverage.coverage, reasonCodes: coverage.reasonCodes,
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
    const kindCoverage: ExecutiveSourceCoverage = data.legacy ? unknownMoney ? { coverage: 'partial', reasonCodes: ['PURCHASE_KIND_UNKNOWN'] } : complete()
      : rangeCoverage(data.monthly.map(month => ({ month: month.month, source: month.scope.some(row => kindMoney(row, ['UNKNOWN']).receiptsSatang || kindMoney(row, ['UNKNOWN']).refundsSatang) ? { coverage: 'partial', reasonCodes: ['PURCHASE_KIND_UNKNOWN'] } : complete() })));
    const groupCoverage = combined(data.money, kindCoverage);
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
      disputedInvoiceCount: data.period.monthCount === 1 ? sum(data.scope, (row) => row.disputedInvoiceCount) : null,
      trend: trend.map((point) => {
        const scope = point.rows.filter((row) => row.reportClassification === 'CUSTOMER' && matchesGlobal(row, data.global, data.salesCodeOf));
        const receipts = sum(scope, (row) => row.receiptsSatang), refunds = sum(scope, (row) => row.refundsSatang);
        return { month: point.month, isPartialMonth: point.isPartialMonth, ...(data.legacy ? {} : { disputedInvoiceCount: countOf(sum(scope, row => row.disputedInvoiceCount), point.money) }), receiptsSatang: moneyOf(receipts, point.money), refundsSatang: moneyOf(refunds, point.money),
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
      const comparisons = data.legacy ? {} : comparisonsOf(data, rows, data.previous?.scope.filter(row => keyOf(row) === key));
      return { key, label: labelOf(key), companies: { count: rows.length, share: shareOf(rows.length, data.scope.length), ...(data.legacy ? {} : { comparison: comparisons.companies }) },
        companiesWithReceipts: { ...countOf(rows.filter((row) => row.receiptsSatang > 0).length, coverageFor(data, rows, 'money')), ...(data.legacy ? {} : { comparison: comparisons.companiesWithReceipts }) },
        paidEverCompanies: rows.filter((row) => row.paidEver === 'YES').length,
        activeCompanies: { ...countOf(rows.filter((row) => row.activeDays > 0).length, coverageFor(data, rows, 'usage')), ...(data.legacy ? {} : { comparison: comparisons.activeCompanies }) },
        netReceiptsSatang: { ...moneyOf(sum(rows, netOf), coverageFor(data, rows, 'money')), ...(data.legacy ? {} : { comparison: comparisons.netReceiptsSatang }) }, drilldownFilters: drill({ [filter]: key }) };
    });
    const result: ReturnType<ExecutiveReportReadService['groupsOf']> = { groups, roundingNote: roundingNote(groups.map((group) => group.companies.share)) };
    if (view === 'industry') result.industryCoverage = shareOf(data.scope.filter((row) => row.profile.industryGroup !== null).length, data.scope.length);
    if (view === 'sales') {
      // First-payment credit as it stands now (spec §14.3): the companies credited to each seller among today's customers in the report's filters.
      const credited = new Map<string, ExecutiveCompanyProfile[]>();
      for (const profile of data.profiles.values()) {
        if (profile.reportClassification !== 'CUSTOMER' || profile.companyCreatedAt >= data.effectiveEnd || !profile.creditedSalesUserId || !matchesGlobal({ profile } as ReportRow, data.global, data.salesCodeOf)) continue;
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
      const previousRows = data.previous?.population.filter(row => dimension === 'company' ? row.companyId === key : filter === 'industry' ? industryKeyOf(row) === key : filter === 'discovery' ? row.profile.discovery === key : referrerKeyOf(row, data.salesCodeOf) === key);
      const periodComparisons = data.legacy ? undefined : comparisonsOf(data, rows, previousRows);
      const net = sum(rows, netOf), receipts = sum(rows, expenseReceiptsOf), ever = rows.filter((row) => row.profile.receiptAdoption === 'EVER').length;
      const exact = (source: ExecutiveSourceCoverage) => source.coverage === 'complete' && counts.coverage === 'complete';
      return { rows, counts, key, label, ...(periodComparisons ? { periodComparisons } : {}), drilldownFilters: dimension === 'company' ? null : { [filter]: key },
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
    const money = coverageFor(data, [row], 'money'), usage = coverageFor(data, [row], 'usage');
    const applicable = profile.companyCreatedAt < data.effectiveEnd;
    const moneyValue = (n: number) => !applicable || !data.legacy && money.coverage === 'unavailable' ? null : n;
    const usageValue = (n: number) => !applicable || !data.legacy && usage.coverage === 'unavailable' ? null : n;
    const kind = profile.referrerKind === 'KNOWN' && !seller ? 'UNRESOLVED' : profile.referrerKind as ExecutiveCompanyRow['referrer']['kind'];
    return {
      id: row.companyId, displayName: names.get(row.companyId)?.name ?? '', registeredName: registeredOf(names, row.companyId),
      provinceLabel: provinceOf(data, profile), joinedAt: profile.companyCreatedAt.toISOString(),
      industryGroup: { key: industry, label: L.industry[industry] ?? L.industry.UNKNOWN! },
      companyStatus: profile.companyStatus, planState: profile.planState,
      planLabel: planLabelOf(profile),
      discovery: { key: profile.discovery, label: L.discovery[profile.discovery] ?? L.discovery.UNKNOWN!, ...(otherText ? { otherText } : {}) },
      signupRail: profile.signupRail,
      referrer: { kind, label: seller?.label ?? L.referringSales[kind]!, ...(seller ? { salesCode: seller.salesCode } : {}),
        ...(profile.referralSource && (kind === 'KNOWN' || kind === 'UNRESOLVED') ? { source: profile.referralSource as 'SIGNUP_CODE' | 'ADMIN' } : {}) },
      creditedSeller: profile.creditedSalesUserId ? sellerOf(data, profile.creditedSalesUserId) : {},
      paidEver: { value: row.paidEver as PaidEverValue, ...(row.paidEverReason ? { reason: row.paidEverReason } : {}) }, fullyRefunded: row.fullyRefunded,
      usageGroup: row.usageGroup as ExecutiveCompanyRow['usageGroup'], ...(row.usageUnassessedReason ? { usageUnassessedReason: row.usageUnassessedReason } : {}),
      receiptAdoption: profile.receiptAdoption,
      coverage: { money, usage },
      metrics: { receiptsSatang: moneyValue(row.receiptsSatang), refundsSatang: moneyValue(row.refundsSatang), netReceiptsSatang: moneyValue(netOf(row)), activeDays: usageValue(row.activeDays),
        activeUsers: data.period.monthCount > 1 ? null : usageValue(row.activeUsers), documents: usageValue(documentsOf(row)), aiRequests: usageValue(row.aiRequests), expenseReceiptCountInPeriod: usageValue(expenseReceiptsOf(row)),
        expenseReceiptCountLifetime: profile.expenseReceiptCountLifetime },
      lastActivityAt: iso(profile.lastActivityAt), sheet: row.sheet ?? sheetOf(data, profile), inactivity: row.inactivity ?? inactivityOf(data, row),
      ownerContact: { status: 'NOT_PERMITTED' }, note: { text: '', version: 0, updatedAt: null, updatedBy: null }, canEditNote: false,
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

  private async noteOf(ctx: RequestContext, companyId: string): Promise<ExecutiveCompanyNoteResult> {
    if (!this.notes) throw executiveError(ctx.requestId, 'SOURCE_UNAVAILABLE');
    const dto = await this.notes.get(ctx, companyId);
    return { note: reportNoteOf(dto), canEditNote: dto.canManage && !isSystemAdmin(ctx) };
  }

  async updateNote(ctx: RequestContext, companyId: string, body: ExecutiveCompanyNoteBody): Promise<ExecutiveCompanyNoteResult> {
    assertPlatformTenant(ctx);
    if (isSystemAdmin(ctx)) throw executiveError(ctx.requestId, 'EXECUTIVE_ACCESS_DENIED', undefined, S.noteAdminRoute);
    if (!['system.executive.read', COMPANY_TEAM_NOTE_MANAGE_PERMISSION].every(key => ctx.permissions.includes(key))) throw executiveError(ctx.requestId, 'EXECUTIVE_ACCESS_DENIED', undefined, COMPANY_TEAM_NOTE_WORDS.editDenied);
    const profile = await this.prisma.client.executiveCompanyProfile.findUnique({ where: { companyId }, select: { reportClassification: true } });
    if (profile?.reportClassification !== 'CUSTOMER') throw executiveError(ctx.requestId, 'COMPANY_NOT_FOUND');
    if (!this.notes) throw executiveError(ctx.requestId, 'SOURCE_UNAVAILABLE');
    const dto = await this.notes.put(ctx, companyId, body);
    return { note: reportNoteOf(dto), canEditNote: dto.canManage };
  }

  private asOfFiguresOf(data: DataSet): ExecutiveAsOfFigures {
    const rows = asOfRowsOf(data), drill = (filters: ExecutiveDrilldownFilters) => this.drill(data)({ atDataDate: 'true', ...filters });
    const populationCoverage: ExecutiveSourceCoverage = [...data.profiles.values()].some(profile => profile.reportClassification === null) ? { coverage: 'partial', reasonCodes: ['CLASSIFICATION_INCOMPLETE'] } : complete();
    const receipt = poolCoverage(rows.map(row => receiptCoverageOf(row.profile)));
    const count = (n: number, source: ExecutiveSourceCoverage, filters: ExecutiveDrilldownFilters) => {
      const coverage = combined(source, populationCoverage);
      return { ...countOf(n, coverage), share: coverage.coverage === 'complete' ? shareOf(n, rows.length) : null, drilldownFilters: drill(filters) };
    };
    const packages = [...new Set(rows.map(row => planLabelOf(row.profile)))].map(label => ({ label, ...count(rows.filter(row => planLabelOf(row.profile) === label).length, populationCoverage, { packageLabel: label }) }));
    const inactivityCoverage = poolCoverage(rows.map(row => row.inactivity!.coverage));
    return { asOf: data.build.asOf.toISOString(), timeBasis: 'DATA_DATE', companies: count(rows.length, populationCoverage, {}),
      receiptsLifetime: { ...count(sum(rows, row => receiptsInSystem(row.profile)), receipt, {}), share: null },
      adoption: { ...this.adoptionOf(data, rows), segments: this.adoptionOf(data, rows).segments.map(segment => ({ ...segment, drilldownFilters: drill({ receiptAdoption: segment.key }) })) },
      receiptBuckets: (['ZERO', 'ONE_TO_FIVE', 'SIX_PLUS'] as const).map(key => ({ key, label: S.receiptBucket[key], ...count(rows.filter(row => row.sheet!.receiptBucket === key).length, receipt, { receiptBucket: key }) })),
      ...Object.fromEntries((['receipts7', 'receipts30', 'receiptDays30AtLeast2'] as const).map(key => [key, count(rows.filter(row => (row.sheet![key === 'receiptDays30AtLeast2' ? 'receiptDays30' : key].value ?? row.sheet![key === 'receiptDays30AtLeast2' ? 'receiptDays30' : key].knownValue ?? 0) >= (key === 'receiptDays30AtLeast2' ? 2 : 1)).length, poolCoverage(rows.map(row => row.sheet![key === 'receiptDays30AtLeast2' ? 'receiptDays30' : key])), { [key === 'receipts7' ? 'receiptAdded7' : key === 'receipts30' ? 'receiptAdded30' : key]: 'true' })])) as Pick<ExecutiveAsOfFigures, 'receipts7' | 'receipts30' | 'receiptDays30AtLeast2'>,
      packages, followUp: { neverUsed: count(rows.filter(row => row.inactivity!.neverUsed).length, inactivityCoverage, { neverUsed: 'true' }), churn: churnOf(data, rows, drill, data.build.asOf) } };
  }

  // ── Audit (spec §20.3): who read what with which filters; no company of the customer, no search text, no person ──

  private readAudit(ctx: RequestContext, reportKey: string, data: DataSet, query: ExecutiveReportQuery, filters: Record<string, unknown>, rowCount: number, hasSearch = false, contactsReturnedCompanyIds: string[] = []) {
    const global = Object.fromEntries(Object.entries(data.global).filter(([, value]) => value !== 'ALL'));
    const log = contactsReturnedCompanyIds.length ? this.audit.logOrThrow.bind(this.audit) : this.audit.log.bind(this.audit);
    return log({ actorUserId: ctx.userId, action: 'executive.report.read', targetType: 'ExecutiveReport', requestId: ctx.requestId, result: 'SUCCESS',
      riskLevel: contactsReturnedCompanyIds.length ? 'MEDIUM' : 'LOW', metadataJson: { ...(contactsReturnedCompanyIds.length ? { contactsReturnedCompanyIds } : {}), reportKey, month: query.month ?? null, period: { from: data.period.from, to: data.period.to }, buildId: data.build.id, filters: { ...global, ...filters }, rowCount, hasSearch } });
  }

  private companyAudit(ctx: RequestContext, companyId: string, month: string | null, contactsReturned: boolean, period?: { from: string; to: string }) {
    const log = contactsReturned ? this.audit.logOrThrow.bind(this.audit) : this.audit.log.bind(this.audit);
    return log({ actorUserId: ctx.userId, action: 'executive.company.read', targetType: 'Company', targetId: companyId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: contactsReturned ? 'MEDIUM' : 'LOW', metadataJson: { month, ...(period ? { period } : {}), contactsReturned } });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

type CompanyName = { name: string; registeredName: string | null };
type AnalysisExtra = { trend?: TrendPoint[]; addOnEverSold?: boolean; credit?: Map<string, number>; names?: Map<string, CompanyName> };
type Money = { receiptsSatang: number; refundsSatang: number; feesSatang: number; taxSatang: number };
type PaidEverValue = ExecutiveCompanyRow['paidEver']['value'];
type TrendPoint = { month: string; isPartialMonth: boolean; money: ExecutiveSourceCoverage; rows: ReportRow[] };

type SharedData = Pick<DataSet, 'legacy' | 'build' | 'profiles' | 'global' | 'sellers' | 'salesCodeOf' | 'provinces'>;
const complete = (): ExecutiveSourceCoverage => ({ coverage: 'complete', reasonCodes: [] });
const missingMonth = (): ExecutiveSourceCoverage => ({ coverage: 'unavailable', reasonCodes: ['RANGE_MONTH_NOT_BUILT'] });

function monthDataSet(shared: SharedData, month: string, stored: ExecutiveReportMonth | undefined, raw: ReportRow[], currentMonth: string): DataSet {
  const period = rangePeriod(month, month, shared.build.asOf, currentMonth), range = executiveMonthRange(month), effectiveEnd = new Date(period.effectiveEndExclusive);
  const header = stored ?? { month, asOf: shared.build.asOf, revision: 0, revisedAt: null, beforeFirstBuild: false,
    untiedCount: 0, untiedReceiptsSatang: 0, untiedRefundsSatang: 0, untiedOtherSatang: 0 } as ExecutiveReportMonth;
  const eligibleProfiles = [...shared.profiles.values()].filter(p => p.companyCreatedAt < effectiveEnd);
  const rowOf = new Map(raw.map(row => [row.companyId, row])), rawIds = new Set(rowOf.keys());
  const sourceMoney = stored ? moneyCoverageOf({ end: range.end, effectiveEnd, billingSince: shared.build.billingSince, billingCoveredThrough: header.billingCoveredThrough, untiedCount: header.untiedCount }) : missingMonth();
  const outdated = !shared.legacy && stored && header.asOf < effectiveEnd ? { coverage: 'partial' as const, reasonCodes: ['SOURCE_STALE' as const] } : complete();
  const sourceUsage = stored ? combined(usageCoverageOf({ start: range.start, beforeFirstBuild: header.beforeFirstBuild, aiUsageSince: shared.build.aiUsageSince }), outdated) : missingMonth();
  const sourceCost = stored ? combined(aiCostCoverageOf({ start: range.start, end: range.end, aiUsageSince: shared.build.aiUsageSince }), outdated) : missingMonth();
  const rows = eligibleProfiles.map(profile => rowOf.get(profile.companyId) ?? aggregatePeriodRows(profile, [month], [], false));
  const population = rows.filter(row => row.profile.reportClassification === 'CUSTOMER'), scope = population.filter(row => matchesGlobal(row, shared.global, shared.salesCodeOf));
  const populationCoverage: ExecutiveSourceCoverage = !stored ? missingMonth() : eligibleProfiles.some(p => p.reportClassification === null) ? { coverage: 'partial', reasonCodes: ['CLASSIFICATION_INCOMPLETE'] } : complete();
  const data: DataSet = { ...shared, period, monthly: [], built: !!stored, header, month, range, effectiveEnd, rows, population, scope, rawIds, rowsById: new Map(rows.map(row => [row.companyId, row])),
    sourceMoney, sourceUsage, sourceCost, money: sourceMoney, usage: sourceUsage, cost: sourceCost, populationCoverage };
  for (const row of rows) { row.sheet = sheetOf(data, row.profile); row.inactivity = inactivityOf(data, row); }
  data.money = coverageFor(data, scope, 'money'); data.usage = coverageFor(data, scope, 'usage'); data.cost = coverageFor(data, scope, 'cost');
  return data;
}
/** Scope-aware coverage: a company before signup contributes nothing and is not a gap. A built month's missing row is unknown. */
function coverageFor(data: DataSet, scope: ReportRow[], kind: 'money' | 'usage' | 'cost'): ExecutiveSourceCoverage {
  const months = data.monthly.length ? data.monthly : [data], ids = new Set(scope.map(row => row.companyId));
  const parts = months.flatMap(month => {
    const applicable = [...ids].flatMap(id => { const row = month.rowsById.get(id); return row ? [row] : []; });
    // Empty populations still need a header/source to prove a zero; a specific company before signup does not.
    if (!applicable.length && ids.size && scope !== data.scope) return [];
    let source = kind === 'money' ? month.sourceMoney : kind === 'usage' ? month.sourceUsage : month.sourceCost;
    if (month.built && applicable.some(row => !month.rawIds.has(row.companyId))) source = combined(source, { coverage: applicable.every(row => !month.rawIds.has(row.companyId)) ? 'unavailable' : 'partial', reasonCodes: ['MONTH_SUMMARY_INCOMPLETE'] });
    if (!data.legacy && kind !== 'cost' && month.populationCoverage.reasonCodes.includes('CLASSIFICATION_INCOMPLETE')) source = combined(source, month.populationCoverage);
    return [{ month: month.month, source }];
  });
  const coverage = rangeCoverage(parts);
  return data.legacy ? { coverage: coverage.coverage, reasonCodes: coverage.reasonCodes } : coverage;
}
function aggregateDataSet(shared: SharedData, period: ExecutiveRangePeriod, monthly: DataSet[]): DataSet {
  const last = monthly.at(-1)!, eligible = [...shared.profiles.values()].filter(profile => profile.companyCreatedAt < new Date(period.effectiveEndExclusive));
  const rows = eligible.map(profile => {
    const selected = monthly.flatMap(month => {
      if (!month.built || !month.rawIds.has(profile.companyId)) return [];
      const row = month.rowsById.get(profile.companyId)!;
      return [month.sourceMoney.coverage === 'unavailable' ? { ...row, moneyByPurchaseKind: null } : row];
    });
    const usage = coverageFor({ ...last, monthly } as DataSet, [{ companyId: profile.companyId } as ReportRow], 'usage');
    const row = aggregatePeriodRows(profile, monthly.map(month => month.month), selected, usage.coverage === 'complete');
    for (const [kind, keys] of [['sourceMoney', ['receiptsSatang', 'refundsSatang', 'feesSatang', 'taxSatang']], ['sourceCost', ['aiCostSatang']]] as const)
      for (const key of keys) row[key] = safeTotal(monthly.map(month => month[kind].coverage === 'unavailable' ? 0 : month.rowsById.get(profile.companyId)?.[key] ?? 0));
    return row;
  });
  for (const key of ['receiptsSatang', 'refundsSatang', 'feesSatang', 'taxSatang', 'aiCostSatang', 'activeDays', 'expenseReceiptsLine', 'expenseReceiptsWeb', 'confirmedExpensesLine', 'confirmedExpensesWeb', 'issuedDocuments', 'aiRequests'] as const) sum(rows, row => row[key]);
  const population = rows.filter(row => row.profile.reportClassification === 'CUSTOMER'), scope = population.filter(row => matchesGlobal(row, shared.global, shared.salesCodeOf));
  const data: DataSet = { ...last, ...shared, period, monthly, rows, rowsById: new Map(rows.map(row => [row.companyId, row])), population, scope, range: { start: new Date(period.startInclusive), end: new Date(period.endExclusive) },
    effectiveEnd: new Date(period.effectiveEndExclusive), header: { ...last.header,
      untiedCount: monthly.reduce((n, m) => n + (m.header.untiedCount ?? 0), 0), untiedReceiptsSatang: monthly.reduce((n, m) => n + (m.header.untiedReceiptsSatang ?? 0), 0),
      untiedRefundsSatang: monthly.reduce((n, m) => n + (m.header.untiedRefundsSatang ?? 0), 0), untiedOtherSatang: monthly.reduce((n, m) => n + (m.header.untiedOtherSatang ?? 0), 0) } };
  data.money = coverageFor(data, scope, 'money'); data.usage = coverageFor(data, scope, 'usage'); data.cost = coverageFor(data, scope, 'cost');
  data.populationCoverage = data.legacy ? last.populationCoverage : rangeCoverage([{ month: last.month, source: last.populationCoverage }]);
  return data;
}
function monthMetadata(data: DataSet): ExecutiveMonthMetadata {
  const sources = { billing: data.built ? data.header.billingCoveredThrough : null, activity: data.built ? data.header.asOf : null,
    aiCost: data.built ? data.header.asOf : null, profile: data.build.asOf };
  const known = Object.values(sources).filter((at): at is Date => !!at).map(at => at.getTime()), newest = Math.max(...known);
  return { month: data.month, built: data.built, isPartialMonth: data.period.includesOpenMonth, revision: data.built ? data.header.revision : null, revisedAt: iso(data.header.revisedAt),
    dataThrough: { billing: iso(sources.billing), activity: iso(sources.activity), aiCost: iso(sources.aiCost), profile: iso(sources.profile), oldest: known.length ? new Date(Math.min(...known)).toISOString() : null,
      lagging: (Object.keys(sources) as Array<keyof typeof sources>).filter(key => !sources[key] || newest - sources[key]!.getTime() > LAG_MS) },
    coverage: { money: data.money, usage: data.usage, aiCost: data.cost, population: data.populationCoverage } };
}
function figuresOf(data: DataSet, scope = data.scope): Record<Exclude<ExecutivePeriodMetric, 'activeDays'>, ExecutiveCount> {
  const money = coverageFor(data, scope, 'money'), usage = coverageFor(data, scope, 'usage'), cost = coverageFor(data, scope, 'cost');
  const endFlags = rangeCoverage([{ month: data.period.to, source: !data.built ? missingMonth() : scope.some(row => row.paidEver === 'UNKNOWN') ? { coverage: 'partial', reasonCodes: ['PAYMENT_HISTORY_INCOMPLETE'] } : data.populationCoverage }]);
  const ratios = (numerator: number, source: ExecutiveSourceCoverage, decimals: number, scale = 1): ExecutiveCount => ({ value: source.coverage === 'complete' && data.populationCoverage.coverage === 'complete' ? roundRatio(numerator * scale, scope.length, decimals) : null, coverage: source.coverage, reasonCodes: source.reasonCodes, affectedMonths: source.affectedMonths });
  return {
    netReceiptsPerCompanySatang: ratios(sum(scope, netOf), money, 0), expenseReceiptsPerCompany: ratios(sum(scope, expenseReceiptsOf), usage, 1),
    activeCompanyShare: ratios(scope.filter(row => row.activeDays > 0).length, usage, 1, 100), paidCompanyShare: ratios(scope.filter(row => row.receiptsSatang > 0).length, money, 1, 100),
    churnedCompanies: churnOf(data, scope, () => ({})),
    companies: countOf(scope.length, data.populationCoverage), newCompanies: countOf(scope.filter(row => row.profile.companyCreatedAt >= data.range.start).length, data.populationCoverage),
    activeCompanies: countOf(scope.filter(row => row.activeDays > 0).length, usage), companiesWithReceipts: countOf(scope.filter(row => row.receiptsSatang > 0).length, money),
    // Missing refunds can reverse positive-net membership: it is not a lower bound.
    positiveNetCompanies: money.coverage === 'complete' ? countOf(scope.filter(row => netOf(row) > 0).length, money) : { value: null, coverage: money.coverage, reasonCodes: money.reasonCodes, affectedMonths: money.affectedMonths },
    paidEverCompanies: countOf(scope.filter(row => row.paidEver === 'YES').length, endFlags), fullyRefundedCompanies: countOf(scope.filter(row => row.fullyRefunded).length, endFlags),
    ...moneyRowOf(scope, money), aiCostSatang: moneyOf(sum(scope, row => row.aiCostSatang), cost),
    expenseReceiptCount: countOf(sum(scope, expenseReceiptsOf), usage), documents: countOf(sum(scope, documentsOf), usage), aiRequests: countOf(sum(scope, row => row.aiRequests), usage),
  };
}
function comparisonsOf(data: DataSet, scope = data.scope, previousScope = data.previous?.scope): Partial<Record<ExecutivePeriodMetric, ReturnType<typeof periodComparison>>> {
  if (!data.previous) return {};
  const current = figuresOf(data, scope), previous = figuresOf(data.previous, previousScope);
  const comparisons = Object.fromEntries((Object.keys(current) as Array<keyof typeof current>).map(key => [key, periodComparison(current[key], previous[key], data.previous!.period, data.period.includesOpenMonth, ['expenseReceiptsPerCompany', 'activeCompanyShare', 'paidCompanyShare'].includes(key) ? 1 : 0)])) as Record<ExecutivePeriodMetric, ReturnType<typeof periodComparison>>;
  const priorRows = previousScope ?? data.previous.scope;
  if (scope.length === 1 && priorRows.length <= 1) comparisons.activeDays = periodComparison(countOf(scope[0]!.activeDays, coverageFor(data, scope, 'usage')),
    priorRows.length ? countOf(priorRows[0]!.activeDays, coverageFor(data.previous, priorRows, 'usage')) : countOf(0, { coverage: 'unavailable', reasonCodes: ['NOT_YET_REGISTERED'] }), data.previous.period, data.period.includesOpenMonth);
  const numerators: Array<[ExecutivePeriodMetric, (rows: ReportRow[]) => number, number, number]> = [
    ['netReceiptsPerCompanySatang', rows => sum(rows, netOf), 0, 1], ['expenseReceiptsPerCompany', rows => sum(rows, expenseReceiptsOf), 1, 1],
    ['activeCompanyShare', rows => rows.filter(row => row.activeDays > 0).length, 1, 100], ['paidCompanyShare', rows => rows.filter(row => row.receiptsSatang > 0).length, 1, 100],
  ];
  for (const [key, numerator, decimals, scale] of numerators) {
    const comparison = comparisons[key], prior = previousScope ?? data.previous.scope;
    if (comparison.absoluteChange === null) continue;
    const left = numerator(scope), right = numerator(prior), difference = BigInt(left) * BigInt(prior.length) - BigInt(right) * BigInt(scope.length);
    comparison.absoluteChange = roundRatio(difference * BigInt(scale), BigInt(scope.length) * BigInt(prior.length), decimals);
    comparison.percentChange = scale === 100 || right <= 0 ? null : roundRatio(difference * 100n, BigInt(right) * BigInt(scope.length), 1);
    comparison.status = right === 0 ? 'ZERO_BASE' : right < 0 ? 'NEGATIVE_BASE' : comparison.absoluteChange === 0 ? 'UNCHANGED' : 'COMPLETE';
  }
  return comparisons;

}
function seriesOf(data: DataSet, metrics: Array<Exclude<ExecutivePeriodMetric, 'activeDays'>>, select: (month: DataSet) => ReportRow[] = month => month.scope) {
  return metrics.map(metric => ({ metric, timeBasis: metric === 'companies' ? 'END_OF_PERIOD' as const : 'PERIOD' as const,
    points: data.monthly.map(month => { const metricValue = figuresOf(month, select(month))[metric]; return { month: month.month, metricValue, coverage: metricValue.coverage, reasonCodes: metricValue.reasonCodes }; }) }));
}
function periodSummaryOf(data: DataSet, row: ReportRow): ExecutivePeriodSummary {
  const money = coverageFor(data, [row], 'money'), usage = coverageFor(data, [row], 'usage'), cost = coverageFor(data, [row], 'cost');
  const activeUsersCoverage: ExecutiveSourceCoverage = data.period.monthCount > 1 ? { coverage: 'unavailable', reasonCodes: ['DISTINCT_USERS_NOT_AVAILABLE'] } : usage;
  const count = (n: number) => usage.coverage === 'unavailable' ? null : n;
  return { ...(data.period.monthCount === 1 ? { disputedInvoiceCount: countOf(row.disputedInvoiceCount, money) } : {}), paidEver: { value: row.paidEver as PaidEverValue, ...(row.paidEverReason ? { reason: row.paidEverReason } : {}) }, fullyRefunded: row.paidEver === 'UNKNOWN' ? null : row.fullyRefunded,
    paidInPeriod: row.receiptsSatang > 0 ? true : money.coverage === 'complete' ? false : null, positiveNetInPeriod: money.coverage === 'complete' ? netOf(row) > 0 : null,
    usageGroup: row.usageGroup as ExecutivePeriodSummary['usageGroup'], ...(row.usageUnassessedReason ? { usageUnassessedReason: row.usageUnassessedReason } : {}),
    money: { ...moneyRowOf([row], money), aiCostSatang: moneyOf(row.aiCostSatang, cost) }, coverage: { money, usage, aiCost: cost },
    usage: { activeDays: count(row.activeDays), activeDaysLine: count(row.activeDaysLine), activeDaysWeb: count(row.activeDaysWeb),
      activeUsers: activeUsersCoverage.coverage === 'unavailable' ? null : row.activeUsers, activeUsersLine: activeUsersCoverage.coverage === 'unavailable' ? null : row.activeUsersLine, activeUsersWeb: activeUsersCoverage.coverage === 'unavailable' ? null : row.activeUsersWeb, activeUsersCoverage,
      documents: count(documentsOf(row)), confirmedExpensesLine: count(row.confirmedExpensesLine), confirmedExpensesWeb: count(row.confirmedExpensesWeb), issuedDocuments: count(row.issuedDocuments),
      aiRequests: count(row.aiRequests), expenseReceiptCountInPeriod: count(expenseReceiptsOf(row)), expenseReceiptsLine: count(row.expenseReceiptsLine), expenseReceiptsWeb: count(row.expenseReceiptsWeb) } };
}

function monthlyExportTable(data: DataSet, list: ReportRow[], names: Map<string, CompanyName>, title: string, started: number): ExportTable {
  const value = (figure: ExecutiveCount, scale = 1): WorkbookCell => ({ value: figureValue(figure, scale), style: scale === 100 ? 3 : 0 });
  return { title, headers: [W.company, W.month, P.receipts, P.refunds, P.net, P.fees, P.tax, W.aiCost, P.receiptCount, W.days, P.usersByMonth, P.documents, P.ai, W.disputes, W.export.notes],
    rows: data.monthly.flatMap(month => list.map(row => {
      if (performance.now() - started > 30_000) throw new Error('XLSX_LIMIT');
      const name = names.get(row.companyId)?.name ?? '';
      if (row.profile.companyCreatedAt >= month.effectiveEnd) return [name, exportMonth(month.month), ...Array.from({ length: 12 }, () => null), P.notRegistered];
      const monthlyRow = month.rowsById.get(row.companyId)!, summary = periodSummaryOf(month, monthlyRow);
      const known = month.built && month.rawIds.has(row.companyId), moneyStatus = executiveMoneyQualifier(summary.money.netReceiptsSatang), costStatus = executiveMoneyQualifier(summary.money.aiCostSatang, true);
      return [name, exportMonth(month.month), ...[summary.money.receiptsSatang, summary.money.refundsSatang, summary.money.netReceiptsSatang, summary.money.feesSatang, summary.money.taxSatang, summary.money.aiCostSatang].map(figure => value(figure, 100)),
        known ? summary.usage.expenseReceiptCountInPeriod : null, known ? summary.usage.activeDays : null, known ? summary.usage.activeUsers : null, known ? summary.usage.documents : null, known ? summary.usage.aiRequests : null, summary.disputedInvoiceCount ? figureValue(summary.disputedInvoiceCount) : null,
        !month.built ? P.unbuilt(exportMonth(month.month)) : [moneyStatus, costStatus, summary.coverage.usage.coverage !== 'complete' ? W.export.usageMissing : ''].filter(Boolean).join(' · ')];
    })) };
}

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

const moneyIncomplete = (money: ExecutiveSourceCoverage) => money.affectedMonths !== undefined ? money.coverage !== 'complete' : money.coverage === 'unavailable' || money.reasonCodes.includes('BILLING_SCAN_NOT_COMPLETE');
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
  if (!data.legacy) return data.monthly.map(month => ({ month: month.month, isPartialMonth: month.period.includesOpenMonth, money: month.money, rows: month.built ? month.rows : [] }));
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
      rows: rows.filter((row) => row.month === month).flatMap((row) => { const profile = data.profiles.get(row.companyId); return profile ? [{ ...row, reportClassification: profile.reportClassification, profile }] : []; }) };
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

function inComparisonSide(row: ReportRow, dimension: string, key: string, salesCodeOf: Map<string, string>): boolean {
  return dimension === 'company' ? row.companyId === key : dimension === 'industry' ? industryKeyOf(row) === key : dimension === 'discovery' ? row.profile.discovery === key : referrerKeyOf(row, salesCodeOf) === key;
}
function validatedPeriod(ctx: RequestContext, query: ExecutiveReportQuery, currentMonth: string) {
  try { return periodInput(query, currentMonth); }
  catch (error) { throw executiveError(ctx.requestId, 'EXECUTIVE_QUERY_INVALID', error instanceof RangeError ? error.message : 'from', query.month !== undefined ? undefined : P.invalid); }
}
function directoryScopeOf(data: DataSet, query: ExecutiveCompaniesQuery, names: Map<string, CompanyName>): ReportRow[] {
  const directory = directoryOf(query), groups = spendGroupsOf(data.scope, moneyIncomplete(data.money)), cohort = directory.spendCohort === 'ALL' ? null : groups.members[directory.spendCohort as keyof SpendGroups['members']];
  const q = query.q?.trim().toLocaleLowerCase('th');
  return data.scope.filter(row => matchesDirectory(row, directory, cohort, data.range.start) && (!q || [names.get(row.companyId)?.name, names.get(row.companyId)?.registeredName, provinceOf(data, row.profile)].some(text => text?.toLocaleLowerCase('th').includes(q))));
}
function directoryOf(query: ExecutiveCompaniesQuery): DirectoryFilters {
  return {
    companyStatus: query.companyStatus ?? 'ALL', planState: query.planState ?? 'ALL', usageGroup: query.usageGroup ?? 'ALL', paidEver: query.paidEver ?? 'ALL',
    receiptAdoption: query.receiptAdoption ?? 'ALL', spendCohort: query.spendCohort ?? 'ALL', signupRail: query.signupRail ?? 'ALL',
    ...Object.fromEntries(['receiptBucket', 'packageLabel'].filter(key => (query as any)[key]).map(key => [key, (query as any)[key]])),
    ...Object.fromEntries(['churned', 'neverUsed', 'receiptAdded7', 'receiptAdded30', 'receiptDays30AtLeast2', 'atDataDate'].filter(key => (query as any)[key] === 'true').map(key => [key, true])),
    ...(query.joinedInPeriod ? { joinedInPeriod: true } : {}),
    ...(query.usageAssessed ? { usageAssessed: query.usageAssessed === 'true' } : {}),
    ...(query.activeInPeriod ? { activeInPeriod: true } : {}), ...(query.paidInPeriod ? { paidInPeriod: true } : {}),
    ...(query.positiveNetInPeriod ? { positiveNetInPeriod: true } : {}), ...(query.fullyRefunded ? { fullyRefunded: true } : {}),
  };
}
const DIRECTORY_KEYS = ['companyStatus', 'planState', 'usageGroup', 'paidEver', 'receiptAdoption', 'spendCohort', 'signupRail', 'receiptBucket', 'packageLabel'] as const;
const FLAG_KEYS = ['joinedInPeriod', 'usageAssessed', 'activeInPeriod', 'paidInPeriod', 'positiveNetInPeriod', 'fullyRefunded', 'churned', 'neverUsed', 'receiptAdded7', 'receiptAdded30', 'receiptDays30AtLeast2', 'atDataDate'] as const;
/** The list filters in force, with their words (spec §16.2 appliedFilters). */
function directoryLabels(query: ExecutiveCompaniesQuery): Record<string, ExecutiveOption> {
  const result: Record<string, ExecutiveOption> = {};
  for (const key of DIRECTORY_KEYS) if (query[key] && query[key] !== 'ALL') result[key] = { value: query[key]!, label: key === 'packageLabel' ? query[key]! : query.month !== undefined ? L[key][query[key]!]! : executivePeriodFilterLabel(key, query[key]!) };
  for (const key of FLAG_KEYS) if (query[key]) result[key] = { value: query[key]!, label: query.month !== undefined ? EXECUTIVE_FLAG_LABELS[key][query[key]!]! : executivePeriodFilterLabel(key, query[key]!) };
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
    default: return (row) => {
      if (sortBy === 'activeDays' || sortBy === 'aiRequests' || sortBy === 'expenseReceiptCount') return METRIC_OF[sortBy](row);
      if (sortBy === 'lastUseAt') return row.inactivity?.lastUseAt ? Date.parse(row.inactivity.lastUseAt) : null;
      if (sortBy === 'daysSinceLastUse') return row.inactivity?.daysSinceLastUse ?? null;
      const value = row.sheet?.[sortBy as keyof typeof row.sheet];
      if (typeof value === 'number') return value;
      if (typeof value === 'string') return Date.parse(value);
      return value && typeof value === 'object' && 'value' in value ? value.value ?? value.knownValue ?? null : null;
    };
  }
}

const figureValue = (figure: { value: number | null; knownValue?: number } | null, scale = 1) => figure ? (figure.value ?? figure.knownValue ?? null) === null ? null : (figure.value ?? figure.knownValue!) / scale : null;

/** Reject unused and untrusted fields before reading data; shared filters use the read API's enums. */
function exportQueryOf(ctx: RequestContext, body: ExecutiveExportBody): ExecutiveCompaniesQuery {
  const invalid = (field: string): never => { throw executiveError(ctx.requestId, 'EXECUTIVE_QUERY_INVALID', field); };
  if (!body || typeof body !== 'object') return invalid('body');
  const allowed = ['buildId', 'reportKey', 'subview', 'month', 'from', 'to', 'filters', 'sortBy', 'sortDir', 'comparison', 'targetCompanyId', 'includeContacts', 'format'];
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
    else if (key === 'packageLabel') { if (!value || value.length > 120) invalid(key); }
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
  return { ...(body.month !== undefined ? { month: body.month } : { from: body.from, to: body.to }), buildId: body.buildId, ...body.filters, ...(body.sortBy ? { sortBy: body.sortBy } : ranked ? { sortBy: 'expenseReceiptCount' } : top ? { sortBy: 'netReceipts' } : {}), ...(body.sortDir ? { sortDir: body.sortDir } : ranked || top ? { sortDir: 'desc' } : {}) };
}

function reportNoteOf(dto: { text: string; version: number; updatedAt: string | null; updatedBy: { displayName: string } | null }): ExecutiveReportNote {
  return { text: dto.text, version: dto.version, updatedAt: dto.updatedAt, updatedBy: dto.updatedBy ? { displayName: dto.updatedBy.displayName } : null };
}
function sheetOf(data: DataSet, profile: ExecutiveCompanyProfile) {
  const months = receiptFactsOf(profile)?.unmatchedMoneyMonths;
  const money = combined(moneyCoverageOf({ end: data.build.asOf, effectiveEnd: data.build.asOf, billingSince: data.build.billingSince, billingCoveredThrough: data.build.billingDataThrough, untiedCount: months?.length ?? 0 }),
    months ? { coverage: 'complete', reasonCodes: [], affectedMonths: months.map(month => ({ month, reasonCodes: ['UNMATCHED_MONEY'] })) } : { coverage: 'unavailable', reasonCodes: ['SHEET_FACTS_NOT_BUILT'] });
  return companySheetOf(profile, data.build.asOf, profile.businessTypeCode === 'OTHER' ? profile.businessTypeOther : DBD_LABEL.get(profile.businessTypeCode ?? '') ?? null, money);
}
function referenceOf(data: DataSet) { return data.period.includesOpenMonth ? data.build.asOf : new Date(data.range.end.getTime() - 1); }
function inactivityOf(data: DataSet, row: ReportRow) {
  const month = data.monthly.at(-1) ?? data;
  const throughReference = month.built && (data.period.includesOpenMonth || month.header.asOf >= month.range.end);
  const snapshot = throughReference && month.rawIds.has(row.companyId) ? month.rowsById.get(row.companyId) ?? null : null;
  const result = companyInactivity(row.profile, snapshot, referenceOf(data), month.sourceUsage);
  if (!snapshot) result.coverage = combined(result.coverage, { coverage: 'unavailable', reasonCodes: ['MONTH_SUMMARY_INCOMPLETE'], affectedMonths: [{ month: month.month, reasonCodes: ['MONTH_SUMMARY_INCOMPLETE'] }] });
  else if (result.coverage.coverage !== 'complete') result.coverage.affectedMonths = [{ month: month.month, reasonCodes: result.coverage.reasonCodes }];
  return result;
}
function asOfRowsOf(data: DataSet): ReportRow[] {
  return [...data.profiles.values()].filter(profile => profile.reportClassification === 'CUSTOMER').map(profile => {
    const row = data.rowsById.get(profile.companyId) ?? aggregatePeriodRows(profile, [data.period.to], [], false);
    const facts = receiptFactsOf(profile);
    return { ...row, sheet: sheetOf(data, profile), inactivity: companyInactivity(profile, facts ? { lastActivityAt: profile.lastActivityAt, activityHistorySince: facts.activityHistorySince ? new Date(facts.activityHistorySince) : null, activitySnapshotReady: facts.activitySnapshotReady } : null, data.build.asOf, complete()) };
  }).filter(row => matchesGlobal(row, data.global, data.salesCodeOf));
}
function churnOf(data: DataSet, rows: ReportRow[], drill: (filters: ExecutiveDrilldownFilters) => ExecutiveDrilldownFilters, reference = referenceOf(data)): ExecutiveChurn {
  const facts = rows.map(row => row.inactivity ?? inactivityOf(data, row)), known = facts.filter(fact => fact.churned !== null);
  const reasons = [...new Set(facts.flatMap(fact => fact.coverage.reasonCodes))];
  const knownCoverage: ExecutiveSourceCoverage = { coverage: known.length === facts.length ? 'complete' : known.length ? 'partial' : 'unavailable', reasonCodes: reasons,
    affectedMonths: rangeCoverage(facts.flatMap(fact => fact.coverage.affectedMonths?.map(month => ({ month: month.month, source: fact.coverage })) ?? [])).affectedMonths };
  const coverage = combined(knownCoverage, data.populationCoverage);
  const n = facts.filter(fact => fact.churned === true).length;
  const ever = rows.filter(row => !!row.profile.firstActivityAt && row.profile.firstActivityAt <= reference || !!row.inactivity?.lastUseAt).length;
  const result: ExecutiveChurn = { ...countOf(n, coverage), referenceDate: bangkokDate(reference), share: coverage.coverage === 'complete' ? shareOf(n, ever) : null, everUsed: countOf(ever, coverage), drilldownFilters: drill({ churned: 'true' }) };
  return result;
}
function sourceStatusOf(data: DataSet, now: Date): ExecutiveEnvelope['sourceStatus'] {
  const moneyDates = data.monthly.map(month => month.built ? month.header.billingCoveredThrough : null);
  const moneyThrough = moneyDates.every(date => !!date) ? iso(new Date(Math.min(data.effectiveEnd.getTime(), ...moneyDates.map(date => date!.getTime())))) : null;
  const usageSources = [data.usage, ...data.scope.flatMap(row => [receiptCoverageOf(row.profile), (row.inactivity ?? inactivityOf(data, row)).coverage, (row.sheet ?? sheetOf(data, row.profile)).aiRequests30])];
  const stale: ExecutiveSourceCoverage = now.getTime() - data.build.asOf.getTime() > STALE_AFTER_MS ? { coverage: 'partial', reasonCodes: ['SOURCE_STALE'] } : complete();
  const usage = { ...poolCoverage(usageSources), affectedMonths: rangeCoverage(usageSources.flatMap(source => source.affectedMonths?.map(month => ({ month: month.month, source: { ...source, reasonCodes: month.reasonCodes } })) ?? [])).affectedMonths };
  const moneySources = [data.money, ...data.scope.map(row => (row.sheet ?? sheetOf(data, row.profile)).lifetimeReceiptsSatang)];
  const money = { ...poolCoverage(moneySources), affectedMonths: rangeCoverage(moneySources.flatMap(source => source.affectedMonths?.map(month => ({ month: month.month, source: { ...source, reasonCodes: month.reasonCodes } })) ?? [])).affectedMonths };
  return { money: { ...combined(money, stale), dataThrough: moneyThrough }, usage: { ...combined(usage, stale), dataThrough: iso(data.build.asOf) }, aiCost: { ...combined(data.cost, stale), dataThrough: iso(data.build.asOf) } };
}

function safeNoteForExport(text: string): string {
  return text.replace(/[0-9๐-๙]+(?:(?:\s+|[-./])[0-9๐-๙]+)*/g, written => looksLikeAccountNumber(written) ? maskedPayoutAccountNumber(written.replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 0x0e50)).replace(/\D/g, '').slice(-4)) : written);
}

function poolCoverage(sources: ExecutiveSourceCoverage[]): ExecutiveSourceCoverage {
  return { coverage: sources.every(source => source.coverage === 'complete') ? 'complete' : sources.every(source => source.coverage === 'unavailable') ? 'unavailable' : 'partial', reasonCodes: [...new Set(sources.flatMap(source => source.reasonCodes))] };
}
