/**
 * Executive report read — the rules, with no database in them (executive backend spec §12.4, §13.1, §13.6, §16.2).
 * The read service loads one month of the summary tables and hands the rows to these functions, so every card, group row,
 * list and chart of one answer is computed from the same rows by the same predicates.
 */
import type { ExecutiveCount, ExecutiveMoney, ExecutiveRatio, ExecutiveReasonCode, ExecutiveSourceCoverage, ExecutiveTie } from '@watchdog-bms/contracts';
import type { ExecutiveCompanyMonth, ExecutiveCompanyProfile } from '../../../generated/prisma/client';

/** One company in one month: its month figures and its profile as of the build. */
export type ReportRow = ExecutiveCompanyMonth & { profile: ExecutiveCompanyProfile };

export const netOf = (row: Pick<ExecutiveCompanyMonth, 'receiptsSatang' | 'refundsSatang'>) => row.receiptsSatang - row.refundsSatang;
export const documentsOf = (row: ExecutiveCompanyMonth) => row.confirmedExpensesLine + row.confirmedExpensesWeb + row.issuedDocuments;
export const expenseReceiptsOf = (row: ExecutiveCompanyMonth) => row.expenseReceiptsLine + row.expenseReceiptsWeb;

// ── Rounding (spec §13.1): from whole numbers, half up, by the backend only ─────────────────────────

/** numerator / denominator rounded half up to `decimals` places; null when the denominator is 0. Inputs must be integers. */
export function roundRatio(numerator: number, denominator: number, decimals: number): number | null {
  if (denominator === 0) return null;
  const scale = 10n ** BigInt(decimals), n = 2n * BigInt(numerator) * scale + BigInt(denominator), d = 2n * BigInt(denominator);
  const quotient = n / d - (n % d !== 0n && (n < 0n) !== (d < 0n) ? 1n : 0n); // floor, also below zero
  return Number(quotient) / Number(scale);
}
/** A percentage with one decimal, with the whole numbers it came from. */
export const shareOf = (part: number, whole: number): ExecutiveRatio => ({ value: roundRatio(part * 100, whole, 1), numerator: part, denominator: whole });
/** Shares of one whole that do not add up to 100.0 only because of rounding. */
export const roundingNote = (shares: ExecutiveRatio[]) =>
  shares.some((share) => share.value !== null) && shares.reduce((sum, share) => sum + Math.round((share.value ?? 0) * 10), 0) !== 1000;

// ── Coverage (spec §13.1, §14.1, §12.3) ─────────────────────────────────────────────────────────

const COMPLETE: ExecutiveSourceCoverage = { coverage: 'complete', reasonCodes: [] };
const partialOf = (reasonCodes: ExecutiveReasonCode[]): ExecutiveSourceCoverage => (reasonCodes.length ? { coverage: 'partial', reasonCodes } : COMPLETE);

/** Unavailable wins, then partial with every reason; a complete source adds nothing. */
export function combined(...sources: ExecutiveSourceCoverage[]): ExecutiveSourceCoverage {
  const missing = sources.filter((source) => source.coverage === 'unavailable');
  if (missing.length) return { coverage: 'unavailable', reasonCodes: [...new Set(missing.flatMap((source) => source.reasonCodes))] };
  return partialOf([...new Set(sources.flatMap((source) => source.reasonCodes))]);
}

/**
 * The month's money: whole when the balance scans cover it from its first instant to its (effective) end. Before the first
 * billing account of the running mode there is no money data at all, which is "no data", never 0 (spec §12.1).
 */
export function moneyCoverageOf(month: { end: Date; effectiveEnd: Date; billingSince: Date | null; billingCoveredThrough: Date | null; untiedCount: number }): ExecutiveSourceCoverage {
  if (!month.billingSince || month.billingSince >= month.end) return { coverage: 'unavailable', reasonCodes: ['HISTORY_BEFORE_COLLECTION'] };
  const reasons: ExecutiveReasonCode[] = [];
  if (!month.billingCoveredThrough || month.billingCoveredThrough < month.effectiveEnd) reasons.push('BILLING_SCAN_NOT_COMPLETE');
  if (month.untiedCount > 0) reasons.push('UNMATCHED_MONEY');
  return partialOf(reasons);
}

/**
 * The month's usage counts: only a lower bound for a month that began before the first build (its deleted rows were never
 * seen) or that began before questions to the assistant were kept. Positive evidence still counts, hence "at least".
 */
export function usageCoverageOf(month: { start: Date; beforeFirstBuild: boolean; aiUsageSince: Date | null }): ExecutiveSourceCoverage {
  const reasons: ExecutiveReasonCode[] = [];
  if (month.beforeFirstBuild) reasons.push('HISTORY_BEFORE_FIRST_BUILD');
  if (month.aiUsageSince && month.aiUsageSince > month.start) reasons.push('HISTORY_BEFORE_COLLECTION');
  return partialOf(reasons);
}

/**
 * The month's measured AI cost (the meter's rows, by the month it filed them in): it exists from the meter's first row on.
 * A month that ended before it holds no cost data ("no data", never 0); one that began before it holds only what was
 * measured since. No meter row at all means nothing was metered yet, so 0 is true. Never "before the first build": every
 * round sums the meter again, and nothing deletes the meter rows of a company that is still there (spec §12.3).
 */
export function aiCostCoverageOf(month: { start: Date; end: Date; aiUsageSince: Date | null }): ExecutiveSourceCoverage {
  if (!month.aiUsageSince || month.aiUsageSince <= month.start) return COMPLETE;
  return { coverage: month.aiUsageSince >= month.end ? 'unavailable' : 'partial', reasonCodes: ['HISTORY_BEFORE_COLLECTION'] };
}

/** One rule for every count (§9.1): partial → `value: null` with `knownValue`; unavailable → neither. */
export function countOf(value: number, source: ExecutiveSourceCoverage): ExecutiveCount {
  if (source.coverage === 'unavailable') return { value: null, coverage: 'unavailable', reasonCodes: source.reasonCodes };
  return source.coverage === 'partial' ? { value: null, knownValue: value, coverage: 'partial', reasonCodes: source.reasonCodes }
    : { value, coverage: 'complete', reasonCodes: [] };
}
export const moneyOf = (value: number, source: ExecutiveSourceCoverage): ExecutiveMoney => ({ ...countOf(value, source), currency: 'THB' });

// ── Filters (spec §12.4) ────────────────────────────────────────────────────────────────────────

export type GlobalFilters = { industry: string; discovery: string; referringSales: string };
export type DirectoryFilters = {
  companyStatus: string; planState: string; usageGroup: string; paidEver: string; receiptAdoption: string; spendCohort: string; signupRail: string;
  usageAssessed?: boolean; activeInPeriod?: true; paidInPeriod?: true; positiveNetInPeriod?: true; fullyRefunded?: true;
};
export const industryKeyOf = (row: ReportRow) => row.profile.industryGroup ?? 'UNKNOWN';
/** The referrer filter's value of a company: the seller's code, or NONE / UNKNOWN / UNRESOLVED. A seller whose profile is gone since the build is UNRESOLVED. */
export function referrerKeyOf(row: ReportRow, salesCodeOf: ReadonlyMap<string, string>): string {
  if (row.profile.referrerKind !== 'KNOWN') return row.profile.referrerKind;
  return salesCodeOf.get(row.profile.referrerSalesUserId ?? '') ?? 'UNRESOLVED';
}
export function matchesGlobal(row: ReportRow, filters: GlobalFilters, salesCodeOf: ReadonlyMap<string, string>): boolean {
  return (filters.industry === 'ALL' || industryKeyOf(row) === filters.industry)
    && (filters.discovery === 'ALL' || row.profile.discovery === filters.discovery)
    && (filters.referringSales === 'ALL' || referrerKeyOf(row, salesCodeOf) === filters.referringSales);
}
export function matchesDirectory(row: ReportRow, filters: DirectoryFilters, cohort: ReadonlySet<string> | null): boolean {
  const is = (value: string, wanted: string) => wanted === 'ALL' || value === wanted;
  return is(row.profile.companyStatus, filters.companyStatus) && is(row.profile.planState, filters.planState)
    && is(row.usageGroup ?? '', filters.usageGroup) && is(row.paidEver, filters.paidEver)
    && is(row.profile.receiptAdoption, filters.receiptAdoption) && is(row.profile.signupRail, filters.signupRail)
    // "assessed" = placed in a group or carrying a label of its own (fully refunded); only an unassessed reason makes it false.
    && (filters.usageAssessed === undefined || filters.usageAssessed === (row.usageUnassessedReason === null))
    && (!filters.activeInPeriod || row.activeDays > 0)
    && (!filters.paidInPeriod || row.receiptsSatang > 0)
    && (!filters.positiveNetInPeriod || netOf(row) > 0)
    && (!filters.fullyRefunded || row.fullyRefunded)
    && (cohort === null || cohort.has(row.companyId));
}

// ── Order and rank (spec §12.4, §13.6) ──────────────────────────────────────────────────────────

/** Equal values: the company that joined first, then the internal id (never shown). */
const tieBreak = (a: ReportRow, b: ReportRow) =>
  a.profile.companyCreatedAt.getTime() - b.profile.companyCreatedAt.getTime() || (a.companyId < b.companyId ? -1 : a.companyId > b.companyId ? 1 : 0);

/** Sorts by a value; a missing value goes last in both directions. */
export function sortedBy<T extends string | number>(rows: readonly ReportRow[], valueOf: (row: ReportRow) => T | null, dir: 'asc' | 'desc'): ReportRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = valueOf(a), right = valueOf(b);
    if (left === null || right === null) return left === right ? tieBreak(a, b) : left === null ? 1 : -1;
    const order = typeof left === 'string' ? left.localeCompare(String(right), 'th') : Number(left) - Number(right);
    return order * sign || tieBreak(a, b);
  });
}
/** Competition ranks of rows already sorted by value, best first: equal values share a rank (1, 1, 3). */
export function ranksOf(sorted: readonly ReportRow[], valueOf: (row: ReportRow) => number): Map<string, number> {
  const ranks = new Map<string, number>();
  sorted.forEach((row, index) => ranks.set(row.companyId,
    index > 0 && valueOf(sorted[index - 1]!) === valueOf(row) ? ranks.get(sorted[index - 1]!.companyId)! : index + 1));
  return ranks;
}

// ── Customers who pay the most (spec §13.6) ─────────────────────────────────────────────────────

export type SpendGroups = {
  /** Empty when there are groups; otherwise why not (then no group, no tie, no cohort member). */
  blocked: ExecutiveReasonCode[];
  population: number; positiveCompanyCount: number; nonPositiveCount: number; positiveNetTotalSatang: number; signedNetTotalSatang: number; negativeNetSatang: number;
  topTargetCount: number; topCount: number | null; topShare: ExecutiveRatio | null; prefix80Count: number | null; prefix80Share: ExecutiveRatio | null;
  restCount: number | null; restShare: ExecutiveRatio | null;
  topCompanyShare: ExecutiveRatio | null; prefix80CompanyShare: ExecutiveRatio | null; restCompanyShare: ExecutiveRatio | null; roundingNote: boolean;
  boundaryTie?: ExecutiveTie; prefix80BoundaryTie?: ExecutiveTie;
  /** Members of each list filter (`spendCohort`), computed on the companies in scope only. */
  members: Record<'TOP20' | 'REST' | 'TO80' | 'BOUNDARY_TIE' | 'TO80_BOUNDARY_TIE', Set<string>>;
  /** Pareto order of the positive payers and each one's cumulative share of the positive total. */
  cumulative: Map<string, ExecutiveRatio>;
};

/**
 * `net_i` of the selected month, `w_i = max(net_i, 0)`, N = every company in scope, K = ceil(N × 0.2); the 80% group is the
 * shortest prefix whose sum reaches 80% in whole satang. Groups never grow for ties at their edge: the tie is counted instead.
 * The rest is N minus the 20% group, those paying 0 or less included; each group is also a share of N (usage-Pareto spec §5).
 */
export function spendGroupsOf(rows: readonly ReportRow[], moneyIncomplete: boolean): SpendGroups {
  const positives = sortedBy(rows.filter((row) => netOf(row) > 0), netOf, 'desc');
  const positiveTotal = positives.reduce((sum, row) => sum + netOf(row), 0);
  const blocked: ExecutiveReasonCode[] = [];
  if (moneyIncomplete) blocked.push('BILLING_SCAN_NOT_COMPLETE');
  if (rows.length < 10) blocked.push('TOO_FEW_COMPANIES');
  if (positiveTotal === 0) blocked.push('NO_POSITIVE_NET');
  const empty = () => new Set<string>();
  const result: SpendGroups = {
    blocked, population: rows.length, positiveCompanyCount: positives.length, nonPositiveCount: rows.length - positives.length, positiveNetTotalSatang: positiveTotal,
    signedNetTotalSatang: rows.reduce((sum, row) => sum + netOf(row), 0),
    negativeNetSatang: rows.reduce((sum, row) => sum + Math.min(netOf(row), 0), 0),
    topTargetCount: Math.ceil(rows.length / 5), topCount: null, topShare: null, prefix80Count: null, prefix80Share: null,
    restCount: null, restShare: null, topCompanyShare: null, prefix80CompanyShare: null, restCompanyShare: null, roundingNote: false,
    members: { TOP20: empty(), REST: empty(), TO80: empty(), BOUNDARY_TIE: empty(), TO80_BOUNDARY_TIE: empty() }, cumulative: new Map(),
  };
  if (moneyIncomplete) return result; // no rank that may still change (spec §13.6)
  const prefixSums = [0];
  for (const row of positives) {
    prefixSums.push(prefixSums.at(-1)! + netOf(row));
    result.cumulative.set(row.companyId, shareOf(prefixSums.at(-1)!, positiveTotal));
  }
  if (blocked.length) return result;

  const prefixSum = (count: number) => prefixSums[count]!;
  const topCount = Math.min(result.topTargetCount, positives.length);
  const prefix80 = prefixSums.findIndex((sum) => sum * 100 >= positiveTotal * 80);
  const tieAt = (count: number, inGroup: Set<string>, tied: Set<string>): ExecutiveTie => {
    const edge = netOf(positives[count - 1]!);
    for (const row of positives) if (netOf(row) === edge) tied.add(row.companyId);
    return { count: [...tied].filter((id) => !inGroup.has(id)).length, netSatang: edge };
  };
  positives.slice(0, topCount).forEach((row) => result.members.TOP20.add(row.companyId));
  positives.slice(0, prefix80).forEach((row) => result.members.TO80.add(row.companyId));
  rows.forEach((row) => { if (!result.members.TOP20.has(row.companyId)) result.members.REST.add(row.companyId); });
  const topShare = shareOf(prefixSum(topCount), positiveTotal), restShare = shareOf(positiveTotal - prefixSum(topCount), positiveTotal);
  const restCount = result.members.REST.size; // N − topCount: the list of the rest has exactly this many rows
  const topCompanyShare = shareOf(topCount, rows.length), restCompanyShare = shareOf(restCount, rows.length);
  return Object.assign(result, {
    topCount, topShare, prefix80Count: prefix80, prefix80Share: shareOf(prefixSum(prefix80), positiveTotal),
    restCount, restShare, topCompanyShare, prefix80CompanyShare: shareOf(prefix80, rows.length), restCompanyShare,
    roundingNote: roundingNote([topShare, restShare]) || roundingNote([topCompanyShare, restCompanyShare]),
    boundaryTie: tieAt(topCount, result.members.TOP20, result.members.BOUNDARY_TIE),
    prefix80BoundaryTie: tieAt(prefix80, result.members.TO80, result.members.TO80_BOUNDARY_TIE),
  });
}

// ── Months (spec §12.1, §12.4) ──────────────────────────────────────────────────────────────────

/** A real Gregorian `YYYY-MM`; the range check against the data set is the caller's. */
export const isMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
