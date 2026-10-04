import { executivePlanLabel, EXECUTIVE_NO_PLAN_DATA_LABEL, EXECUTIVE_REPORT_LABELS, type ExecutiveCompanySheet, type ExecutiveInactivity, type ExecutiveSourceCoverage } from '@watchdog-bms/contracts';
import { aiCostCoverageOf, countOf, moneyOf } from './executive-read.logic';
import { bangkokDayStart, executiveMonthOf, executiveMonths } from './executive-report.logic';
import type { ExecutiveCompanyProfile, ExecutiveCompanyMonth } from '../../../generated/prisma/client';

const DAY = 86_400_000;
export type ReceiptSheetFacts = { firstReceiptAt: string | null; lastReceiptAt: string | null;
  receipts7: number; receipts30: number; receiptDays30: number; confirmed: number; pending: number; draft: number; sourceCount: number;
  activityHistorySince: string | null; activitySnapshotReady: boolean; receiptHistorySince: string | null; receiptCountersHeld: boolean; purgedReceiptMonths?: string[]; aiRequests30?: number; aiUsageSince?: string | null; unmatchedMoneyMonths?: string[] };
export const bangkokDate = (at: Date) => new Date(bangkokDayStart(at).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date) => (bangkokDayStart(b).getTime() - bangkokDayStart(a).getTime()) / DAY;
/** Addition anchored on the last-use date; clamp missing day to the last day of the next Bangkok month. */
export function inactivityAt(last: Date | null, reference: Date) {
  if (!last) return { lastUseAt: null, daysSinceLastUse: null, churned: false };
  const [year, month, day] = bangkokDate(last).split('-').map(Number);
  const anniversary = new Date(Date.UTC(year!, month!, Math.min(day!, new Date(Date.UTC(year!, month! + 1, 0)).getUTCDate())) - 7 * 3_600_000);
  return { lastUseAt: last.toISOString(), daysSinceLastUse: daysBetween(last, reference), churned: bangkokDayStart(reference) > anniversary };
}
export function receiptBucket(n: number) { return n === 0 ? 'ZERO' as const : n <= 5 ? 'ONE_TO_FIVE' as const : 'SIX_PLUS' as const; }
export const receiptFactsOf = (profile: ExecutiveCompanyProfile) => profile.sheetFacts as ReceiptSheetFacts | null;
export function receiptCoverageOf(profile: ExecutiveCompanyProfile): ExecutiveSourceCoverage {
  const facts = receiptFactsOf(profile);
  if (!facts) return { coverage: profile.expenseReceiptCountLifetime > 0 ? 'partial' : 'unavailable', reasonCodes: ['SHEET_FACTS_NOT_BUILT'] };
  const reasons: ExecutiveSourceCoverage['reasonCodes'] = [];
  const affected = new Map<string, ExecutiveSourceCoverage['reasonCodes']>();
  const add = (month: string, reason: ExecutiveSourceCoverage['reasonCodes'][number]) => affected.set(month, [...new Set([...(affected.get(month) ?? []), reason])]);
  if (facts.receiptCountersHeld || facts.sourceCount < profile.expenseReceiptCountLifetime) reasons.push('SOURCE_ROWS_PURGED');
  if (reasons.length) for (const month of facts.purgedReceiptMonths ?? []) add(month, 'SOURCE_ROWS_PURGED');
  if (facts.receiptHistorySince && new Date(facts.receiptHistorySince) > profile.companyCreatedAt) {
    reasons.push('HISTORY_BEFORE_COLLECTION');
    for (const month of executiveMonths(executiveMonthOf(profile.companyCreatedAt), executiveMonthOf(new Date(Date.parse(facts.receiptHistorySince) - 1)))) add(month, 'HISTORY_BEFORE_COLLECTION');
  }
  return { coverage: reasons.length ? 'partial' : 'complete', reasonCodes: reasons, ...(affected.size ? { affectedMonths: [...affected].sort(([a], [b]) => a.localeCompare(b)).map(([month, reasonCodes]) => ({ month, reasonCodes })) } : {}) };
}
export function companyPlanLabelOf(profile: ExecutiveCompanyProfile) { return !profile.planTierKey ? EXECUTIVE_NO_PLAN_DATA_LABEL : profile.planState === 'NO_PACKAGE' ? EXECUTIVE_REPORT_LABELS.planState.NO_PACKAGE! : executivePlanLabel(profile.planTierKey); }
export function companySheetOf(profile: ExecutiveCompanyProfile, asOf: Date, businessTypeLabel: string | null, money: ExecutiveSourceCoverage): ExecutiveCompanySheet {
  const facts = receiptFactsOf(profile), coverage = receiptCoverageOf(profile);
  const windowCoverage = (days: number): ExecutiveSourceCoverage => {
    if (!facts) return coverage;
    const reasons: ExecutiveSourceCoverage['reasonCodes'] = [];
    if ((facts.receiptCountersHeld || facts.sourceCount < profile.expenseReceiptCountLifetime) && (!facts.purgedReceiptMonths?.length || facts.purgedReceiptMonths.some(month => month >= executiveMonthOf(new Date(bangkokDayStart(asOf).getTime() - (days - 1) * DAY)) && month <= executiveMonthOf(asOf)))) reasons.push('SOURCE_ROWS_PURGED');
    if (facts.receiptHistorySince && new Date(facts.receiptHistorySince) > new Date(bangkokDayStart(asOf).getTime() - (days - 1) * DAY)) reasons.push('HISTORY_BEFORE_COLLECTION');
    return { coverage: reasons.length ? 'partial' : 'complete', reasonCodes: reasons };
  };
  const daysLeft = profile.planEndsAt ? daysBetween(asOf, profile.planEndsAt) : null;
  const packageExpired = profile.planEndsAt ? profile.planEndsAt <= asOf : null;
  return { asOf: asOf.toISOString(), planLabel: companyPlanLabelOf(profile), businessTypeLabel, planEndsAt: profile.planEndsAt?.toISOString() ?? null,
    daysLeft: daysLeft !== null && !packageExpired ? daysLeft : null, packageExpired,
    receiptsLifetime: countOf(profile.expenseReceiptCountLifetime, coverage), firstReceiptAt: facts?.firstReceiptAt ?? null, lastReceiptAt: facts?.lastReceiptAt ?? null,
    daysSinceLastReceipt: facts?.lastReceiptAt ? daysBetween(new Date(facts.lastReceiptAt), asOf) : null,
    ...Object.fromEntries(['receipts7', 'receipts30', 'receiptDays30', 'confirmed', 'pending', 'draft'].map(key => [key, countOf(facts?.[key as 'receipts7'] ?? 0, key === 'receipts7' ? windowCoverage(7) : ['receipts30', 'receiptDays30'].includes(key) ? windowCoverage(30) : coverage)])) as Pick<ExecutiveCompanySheet, 'receipts7' | 'receipts30' | 'receiptDays30' | 'confirmed' | 'pending' | 'draft'>,
    aiRequests30: countOf(facts?.aiRequests30 ?? 0, facts?.aiRequests30 === undefined ? { coverage: 'unavailable', reasonCodes: ['SHEET_FACTS_NOT_BUILT'] } : aiCostCoverageOf({ start: new Date(bangkokDayStart(asOf).getTime() - 29 * DAY), end: asOf, aiUsageSince: facts.aiUsageSince ? new Date(facts.aiUsageSince) : null })),
    receiptBucket: coverage.coverage === 'complete' ? receiptBucket(profile.expenseReceiptCountLifetime) : profile.expenseReceiptCountLifetime >= 6 ? 'SIX_PLUS' : null,
    paymentState: { paidEver: profile.paidEver as 'YES' | 'NO' | 'UNKNOWN', fullyRefunded: profile.fullyRefunded },
    lifetimeReceiptsSatang: moneyOf(profile.lifetimeReceiptsSatang ?? 0, money), lifetimeRefundsSatang: moneyOf(profile.lifetimeRefundsSatang ?? 0, money),
    lifetimeNetSatang: moneyOf((profile.lifetimeReceiptsSatang ?? 0) - (profile.lifetimeRefundsSatang ?? 0), money),
    activeMemberCount: profile.activeMemberCount ?? 0, branchCount: profile.branchCount ?? 0 };
}
export function companyInactivity(profile: ExecutiveCompanyProfile, snapshot: Pick<ExecutiveCompanyMonth, 'lastActivityAt' | 'activityHistorySince' | 'activitySnapshotReady'> | null,
  reference: Date, source: ExecutiveSourceCoverage): ExecutiveInactivity {
  const facts = snapshot?.activitySnapshotReady ? snapshot : null;
  const last = facts?.lastActivityAt ?? null;
  const ever = !!last || !!profile.firstActivityAt && bangkokDayStart(profile.firstActivityAt) <= bangkokDayStart(reference);
  const historySince = facts?.activityHistorySince;
  const historyComplete = !!facts && (!historySince || historySince <= profile.companyCreatedAt || (ever && (!!last && last >= historySince || inactivityAt(new Date(historySince.getTime() - 1), reference).churned)));
  const coverage: ExecutiveSourceCoverage = !facts ? { coverage: 'unavailable', reasonCodes: ['SHEET_FACTS_NOT_BUILT'] }
    : !historyComplete || source.coverage !== 'complete' ? { coverage: 'unavailable', reasonCodes: [...new Set([...source.reasonCodes, ...(!historyComplete ? ['ACTIVITY_HISTORY_INCOMPLETE' as const] : [])])] }
    : { coverage: 'complete', reasonCodes: [] };
  const inactivity = inactivityAt(last, reference);
  return { referenceDate: bangkokDate(reference), ...inactivity, churned: coverage.coverage === 'complete' ? inactivity.churned : null,
    neverUsed: coverage.coverage === 'complete' ? !ever : null, coverage };
}
