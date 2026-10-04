/**
 * Executive report read — the rules, with no database in them (executive backend spec §12.4, §13.1, §13.6, §16.2).
 * The read service loads one month of the summary tables and hands the rows to these functions, so every card, group row,
 * list and chart of one answer is computed from the same rows by the same predicates.
 */
import { EXECUTIVE_PERIOD_PRESETS, type ExecutivePeriodRequest, type ExecutivePreset, type ExecutiveRangePeriod, type ExecutivePeriodComparison, type ExecutiveCount, ExecutiveMoney, ExecutiveRatio, ExecutiveReasonCode, ExecutiveSourceCoverage, ExecutiveTie } from '@watchdog-bms/contracts';
import { decideUsageGroup, executiveMonthOf, executiveMonthRange, NO_USAGE, USAGE_COUNTERS } from './executive-report.logic';
import type { ExecutiveCompanyMonth, ExecutiveCompanyProfile } from '../../../generated/prisma/client';

/** One company in one month: its month figures and its profile as of the build. */
export type ReportRow = ExecutiveCompanyMonth & { profile: ExecutiveCompanyProfile; sheet?: import('@watchdog-bms/contracts').ExecutiveCompanySheet; inactivity?: import('@watchdog-bms/contracts').ExecutiveInactivity };

export const netOf = (row: Pick<ExecutiveCompanyMonth, 'receiptsSatang' | 'refundsSatang'>) => row.receiptsSatang - row.refundsSatang;
export const documentsOf = (row: ExecutiveCompanyMonth) => row.confirmedExpensesLine + row.confirmedExpensesWeb + row.issuedDocuments;
export const expenseReceiptsOf = (row: ExecutiveCompanyMonth) => row.expenseReceiptsLine + row.expenseReceiptsWeb;

// ── Rounding (spec §13.1): from whole numbers, half up, by the backend only ─────────────────────────

/** Exact whole-number totals; refuse overflow rather than rounding a report silently. */
export function safeTotal(values: Iterable<number>): number {
  let total = 0n;
  for (const value of values) total += BigInt(value);
  const number = Number(total);
  if (!Number.isSafeInteger(number)) throw new RangeError('EXECUTIVE_TOTAL_OVERFLOW');
  return number;
}
/** numerator / denominator rounded half up to `decimals` places; null when the denominator is 0. Inputs must be integers. */
export function roundRatio(numerator: number | bigint, denominator: number | bigint, decimals: number): number | null {
  if (denominator === 0 || denominator === 0n) return null;
  const scale = 10n ** BigInt(decimals), n = 2n * BigInt(numerator) * scale + BigInt(denominator), d = 2n * BigInt(denominator);
  const quotient = n / d - (n % d !== 0n && (n < 0n) !== (d < 0n) ? 1n : 0n); // floor, also below zero
  return Number(quotient) / Number(scale);
}
/** A percentage with one decimal, with the whole numbers it came from. */
export const shareOf = (part: number, whole: number): ExecutiveRatio => ({ value: roundRatio(BigInt(part) * 100n, whole, 1), numerator: part, denominator: whole });
/** Shares of one whole that do not add up to 100.0 only because of rounding. */
export const roundingNote = (shares: ExecutiveRatio[]) =>
  shares.some((share) => share.value !== null) && shares.reduce((sum, share) => sum + Math.round((share.value ?? 0) * 10), 0) !== 1000;

// ── Coverage (spec §13.1, §14.1, §12.3) ─────────────────────────────────────────────────────────

const COMPLETE: ExecutiveSourceCoverage = { coverage: 'complete', reasonCodes: [] };
const partialOf = (reasonCodes: ExecutiveReasonCode[]): ExecutiveSourceCoverage => (reasonCodes.length ? { coverage: 'partial', reasonCodes } : COMPLETE);

/** Unavailable wins, then partial with every reason; a complete source adds nothing. */
export function combined(...sources: ExecutiveSourceCoverage[]): ExecutiveSourceCoverage {
  const missing = sources.filter((source) => source.coverage === 'unavailable');
  const coverage = missing.length ? { coverage: 'unavailable' as const, reasonCodes: [...new Set(missing.flatMap((source) => source.reasonCodes))] }
    : partialOf([...new Set(sources.flatMap((source) => source.reasonCodes))]);
  if (!sources.some(source => source.affectedMonths)) return coverage;
  const affected = new Map<string, ExecutiveReasonCode[]>();
  for (const part of sources.flatMap(source => source.affectedMonths ?? [])) affected.set(part.month, [...new Set([...affected.get(part.month) ?? [], ...part.reasonCodes])]);
  return { ...coverage, affectedMonths: [...affected].sort(([a], [b]) => a.localeCompare(b)).map(([month, reasonCodes]) => ({ month, reasonCodes })) };

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
  const affected = source.affectedMonths ? { affectedMonths: source.affectedMonths } : {};
  if (source.coverage === 'unavailable') return { value: null, coverage: 'unavailable', reasonCodes: source.reasonCodes, ...affected };
  return source.coverage === 'partial' ? { value: null, knownValue: value, coverage: 'partial', reasonCodes: source.reasonCodes, ...affected }
    : { value, coverage: 'complete', reasonCodes: [], ...affected };
}
export const moneyOf = (value: number, source: ExecutiveSourceCoverage): ExecutiveMoney => ({ ...countOf(value, source), currency: 'THB' });

// ── Filters (spec §12.4) ────────────────────────────────────────────────────────────────────────

export type GlobalFilters = { industry: string; discovery: string; referringSales: string };
export type DirectoryFilters = {
  companyStatus: string; planState: string; usageGroup: string; paidEver: string; receiptAdoption: string; spendCohort: string; signupRail: string;
  receiptBucket?: string; packageLabel?: string; churned?: true; neverUsed?: true; receiptAdded7?: true; receiptAdded30?: true; receiptDays30AtLeast2?: true; atDataDate?: true;
  joinedInPeriod?: true; usageAssessed?: boolean; activeInPeriod?: true; paidInPeriod?: true; positiveNetInPeriod?: true; fullyRefunded?: true;
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
export function matchesDirectory(row: ReportRow, filters: DirectoryFilters, cohort: ReadonlySet<string> | null, start?: Date): boolean {
  const is = (value: string, wanted: string) => wanted === 'ALL' || value === wanted;
  return is(row.profile.companyStatus, filters.companyStatus) && is(row.profile.planState, filters.planState)
    && is(row.usageGroup ?? '', filters.usageGroup) && is(row.paidEver, filters.paidEver)
    && is(row.profile.receiptAdoption, filters.receiptAdoption) && is(row.profile.signupRail, filters.signupRail)
    // "assessed" = placed in a group or carrying a label of its own (fully refunded); only an unassessed reason makes it false.
    && (filters.usageAssessed === undefined || filters.usageAssessed === (row.usageUnassessedReason === null))
    && (!filters.joinedInPeriod || !!start && row.profile.companyCreatedAt >= start)
    && (!filters.activeInPeriod || row.activeDays > 0)
    && (!filters.paidInPeriod || row.receiptsSatang > 0)
    && (!filters.positiveNetInPeriod || netOf(row) > 0)
    && (!filters.fullyRefunded || row.fullyRefunded)
    && (!filters.receiptBucket || filters.receiptBucket === 'ALL' || row.sheet?.receiptBucket === filters.receiptBucket)
    && (!filters.packageLabel || filters.packageLabel === 'ALL' || row.sheet?.planLabel === filters.packageLabel)
    && (!filters.churned || row.inactivity?.churned === true) && (!filters.neverUsed || row.inactivity?.neverUsed === true)
    && (!filters.receiptAdded7 || (row.sheet?.receipts7.value ?? row.sheet?.receipts7.knownValue ?? 0) > 0)
    && (!filters.receiptAdded30 || (row.sheet?.receipts30.value ?? row.sheet?.receipts30.knownValue ?? 0) > 0)
    && (!filters.receiptDays30AtLeast2 || (row.sheet?.receiptDays30.value ?? row.sheet?.receiptDays30.knownValue ?? 0) >= 2)
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


export function shiftMonth(month: string, offset: number): string {
  const [year, number] = month.split('-').map(Number), index = year! * 12 + number! - 1 + offset;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
}
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to; month = shiftMonth(month, 1)) months.push(month);
  return months;
}
/** Throw only the invalid field, so transport errors never echo untrusted input. */
export function periodInput(query: ExecutivePeriodRequest, currentMonth: string): { from: string; to: string } {
  for (const field of ['preset', 'timeZone', 'startInclusive', 'endExclusive']) if (Object.hasOwn(query, field)) throw new RangeError(field);
  const legacy = query.month !== undefined;
  if (legacy && (query.from !== undefined || query.to !== undefined)) throw new RangeError('month');
  const from = legacy ? query.month : query.from, to = legacy ? query.month : query.to;
  if (!isMonth(from)) throw new RangeError(legacy ? 'month' : 'from');
  if (!isMonth(to) || to > currentMonth || from > to) throw new RangeError(legacy ? 'month' : 'to');
  return { from, to };
}
export function periodPresets(now: Date, built: readonly string[]): { defaultPeriod: { from: string; to: string; appliedPreset: 'LAST_MONTH' | 'THIS_MONTH' }; presets: ExecutivePreset[] } {
  const current = executiveMonthOf(now), month = Number(current.slice(5)), day = Number(new Intl.DateTimeFormat('en-CA', { day: '2-digit', timeZone: 'Asia/Bangkok' }).format(now));
  const appliedPreset = day <= 7 ? 'LAST_MONTH' : 'THIS_MONTH', defaultMonth = appliedPreset === 'LAST_MONTH' ? shiftMonth(current, -1) : current;
  const first = built[0], latest = built.at(-1);
  const presets = EXECUTIVE_PERIOD_PRESETS.map((key): ExecutivePreset => {
    if (!first) return { key, from: null, to: null, available: false, unbuiltBoundaryMonths: [] };
    let from: string | null = key === 'ALL' ? first ?? null : key === 'LAST_MONTH' ? shiftMonth(current, -1)
      : key === 'THIS_QUARTER' ? shiftMonth(current, -(month - 1) % 3) : key === 'THIS_YEAR' ? `${current.slice(0, 4)}-01`
      : key === 'LAST_12_MONTHS' ? shiftMonth(current, -11) : current;
    const to = key === 'ALL' ? latest ?? null : key === 'LAST_MONTH' ? shiftMonth(current, -1) : current;
    // Q38: only shorten an unbuilt start before the built history, never skip an interior gap or move the end.
    if (from && first && !built.includes(from) && from < first && to && first <= to) from = first;
    const unbuiltBoundaryMonths = [...new Set([from, to].filter((m): m is string => !!m && !built.includes(m)))];
    return { key, from, to, available: !!first && !!from && !!to && !unbuiltBoundaryMonths.length, unbuiltBoundaryMonths };
  });
  return { defaultPeriod: { from: defaultMonth, to: defaultMonth, appliedPreset }, presets };
}
export function rangePeriod(from: string, to: string, asOf: Date, currentMonth: string): ExecutiveRangePeriod {
  const start = executiveMonthRange(from).start, end = executiveMonthRange(to).end, effectiveEnd = asOf < end ? asOf : end;
  return { from, to, monthCount: monthsBetween(from, to).length, appliedPreset: null, timeZone: 'Asia/Bangkok',
    startInclusive: start.toISOString(), endExclusive: end.toISOString(), effectiveEndExclusive: effectiveEnd.toISOString(), includesOpenMonth: to === currentMonth && effectiveEnd < end };
}
/** Across months: retain confirmed parts when another month is absent; combine() still governs sources within a month. */
export function rangeCoverage(parts: Array<{ month: string; source: ExecutiveSourceCoverage }>): ExecutiveSourceCoverage {
  const affectedMonths = parts.filter(p => p.source.coverage !== 'complete').map(p => ({ month: p.month, reasonCodes: p.source.reasonCodes }));
  return { coverage: !affectedMonths.length ? 'complete' : parts.some(p => p.source.coverage !== 'unavailable') ? 'partial' : 'unavailable',
    reasonCodes: [...new Set(affectedMonths.flatMap(p => p.reasonCodes))], affectedMonths };
}
/** The figure alone. A comparison is attached to the very figure it compares, so it must not carry that object
 *  (or anything the object holds, such as its share): a cycle cannot be sent as JSON and the whole answer fails. */
function figureOnly(figure: ExecutiveCount): ExecutiveCount {
  return { value: figure.value, ...(figure.knownValue !== undefined ? { knownValue: figure.knownValue } : {}), coverage: figure.coverage, reasonCodes: figure.reasonCodes,
    ...(figure.affectedMonths ? { affectedMonths: figure.affectedMonths } : {}), ...('currency' in figure ? { currency: (figure as ExecutiveMoney).currency } : {}) };
}
export function periodComparison(current: ExecutiveCount, previous: ExecutiveCount, period: ExecutiveRangePeriod, includesOpenMonth: boolean, decimals = 0): ExecutivePeriodComparison {
  const affectedMonths = [...current.affectedMonths ?? [], ...previous.affectedMonths ?? []];
  const exact = current.value !== null && previous.value !== null && current.coverage === 'complete' && previous.coverage === 'complete';
  const absoluteChange = exact ? current.value! - previous.value! : null;
  const status = previous.coverage === 'unavailable' ? 'NO_PREVIOUS' : !exact ? 'PARTIAL' : previous.value === 0 ? 'ZERO_BASE'
    : previous.value! < 0 ? 'NEGATIVE_BASE' : absoluteChange === 0 ? 'UNCHANGED' : 'COMPLETE';
  return { period, current: figureOnly(current), previous: figureOnly(previous), absoluteChange, percentChange: exact && previous.value! > 0 ? roundRatio(BigInt(Math.round(absoluteChange! * 10 ** decimals)) * 100n, Math.round(previous.value! * 10 ** decimals), 1) : null,
    status, affectedMonths, includesOpenMonth };
}
/** One row per company, sums before cohort/rank; cutoff flags come only from the final month. */
export function aggregatePeriodRows(profile: ExecutiveCompanyProfile, months: readonly string[], rows: readonly ReportRow[], usageComplete: boolean): ReportRow {
  const last = rows.find(row => row.month === months.at(-1)), sums = { ...NO_USAGE, receiptsSatang: 0, refundsSatang: 0, feesSatang: 0, taxSatang: 0, aiCostSatang: 0 };
  const moneyByPurchaseKind: Record<string, { receiptsSatang: number; refundsSatang: number; feesSatang: number; taxSatang: number }> = {};
  for (const row of rows) {
    for (const key of Object.keys(sums) as Array<keyof typeof sums>) { sums[key] += row[key] ?? 0; if (!Number.isSafeInteger(sums[key])) throw new RangeError('EXECUTIVE_TOTAL_OVERFLOW'); }
    for (const [kind, values] of Object.entries((row.moneyByPurchaseKind ?? {}) as typeof moneyByPurchaseKind)) {
      const total = moneyByPurchaseKind[kind] ??= { receiptsSatang: 0, refundsSatang: 0, feesSatang: 0, taxSatang: 0 };
      for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += values[key] ?? 0;
    }
  }
  if (months.length === 1 && last) return { ...last, profile, reportClassification: profile.reportClassification };
  const paidEver = last?.paidEver ?? 'UNKNOWN', fullyRefunded = last?.fullyRefunded ?? false;
  const decision = decideUsageGroup({ paidEver: paidEver as 'YES' | 'NO' | 'UNKNOWN', fullyRefunded, activeInMonth: sums.activeDays > 0,
    usedBeforeCutoff: rows.some(row => row.usageGroup === 'INACTIVE' || row.activeDays > 0), monthHistoryComplete: usageComplete,
    historyCompleteSinceSignup: last?.usageGroup === 'NOT_STARTED' });
  // A multi-month user sum has no meaning. It is exposed only via monthly history; never read these placeholders as a total.
  if (months.length > 1) for (const key of USAGE_COUNTERS.filter(key => key.startsWith('activeUsers'))) sums[key] = 0;
  return { ...last, ...sums, companyId: profile.companyId, profile, month: months.at(-1)!, reportClassification: profile.reportClassification,
    moneyByPurchaseKind, paidEver, paidEverReason: last?.paidEverReason ?? (last ? null : 'BILLING_SCAN_NOT_COMPLETE'), fullyRefunded,
    usageGroup: decision.usageGroup, usageUnassessedReason: decision.reason, countersHeld: rows.some(row => row.countersHeld),
    disputedInvoiceCount: months.length === 1 ? last?.disputedInvoiceCount ?? 0 : 0 } as ReportRow;
}
