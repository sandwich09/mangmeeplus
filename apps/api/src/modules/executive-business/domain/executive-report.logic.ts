/**
 * Executive report build — the rules, with no database in them (executive backend spec §12–§15).
 * The build reads sets, hands each company's facts to these functions, and stores what they answer.
 */
import { SIGNUP_DISCOVERY_SOURCE_OPTIONS, planTermLockReason, type BillingPurchaseSource } from '@watchdog-bms/contracts';
import { SIGNUP_SOURCE_EMAIL_OTP, SIGNUP_SOURCE_LINE_OA, SIGNUP_SOURCE_OFFICIAL_SITE } from '../../external-signup/domain/company-signup.logic';

/** Raise when the meaning of a stored figure or group changes: the build then writes a new set of rows. */
export const EXECUTIVE_DEFINITION_VERSION = 1;

const BANGKOK_OFFSET_MS = 7 * 3_600_000; // Asia/Bangkok is UTC+7 all year (no DST since 1976)
const DAY_MS = 86_400_000;

/** 'YYYY-MM' of an instant on the Bangkok calendar. */
export function executiveMonthOf(at: Date): string {
  return new Date(at.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 7);
}
/** A Bangkok month as the UTC instants a query is given: `>= start AND < end` (spec §12.1). */
export function executiveMonthRange(month: string): { start: Date; end: Date } {
  const [year, index] = month.split('-').map(Number) as [number, number];
  const next = index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`;
  return { start: new Date(`${month}-01T00:00:00+07:00`), end: new Date(`${next}-01T00:00:00+07:00`) };
}
/** Every month from `first` to `last`, both included. */
export function executiveMonths(first: string, last: string): string[] {
  const months: string[] = [];
  for (let month = first; month <= last; month = executiveMonthOf(executiveMonthRange(month).end)) months.push(month);
  return months;
}
/** 00:00 Bangkok of the day `at` falls on. */
export function bangkokDayStart(at: Date): Date {
  return new Date(Math.floor((at.getTime() + BANGKOK_OFFSET_MS) / DAY_MS) * DAY_MS - BANGKOK_OFFSET_MS);
}

// ── Paid ever (spec §13.2) ────────────────────────────────────────────────────────────────────

export type PaidEverReason = 'BILLING_SOURCE_REVIEW' | 'MANUAL_TERM_NO_RECEIPT' | 'LEGACY_NO_TERM' | 'BILLING_SCAN_NOT_COMPLETE' | 'UNMATCHED_MONEY';
export type PaidEver = { value: 'YES' | 'NO' | 'UNKNOWN'; reason: PaidEverReason | null };
type TermShape = { termStartAt: Date; termEndsAt: Date; renewCount: number };

/**
 * The first rule that fits answers. A dated receipt proves "paid by this month". An invoice proves
 * "paid by now" only, so for a month that is over it needs the provider read whole up to that
 * month's end before it may say "not yet": otherwise the payment could sit in what was not read.
 */
export function decidePaidEver(input: {
  /** A receipt counted for the company, dated by the provider before the month's cutoff. */
  receiptBeforeCutoff: boolean;
  /** Billing holds a paid invoice of the running mode for the company, as of now. */
  paidInvoiceNow: boolean;
  /** The month is still running: its cutoff is the build's own `asOf`. */
  monthIsCurrent: boolean;
  /** Successful balance scans cover everything from the first billing account to the cutoff. */
  billingReadToCutoff: boolean;
  /** Money no company answers for exists before the cutoff: it could be this company's. */
  untiedReceiptBeforeCutoff: boolean;
  /** `billingPurchaseSource()` for the company without an invoice; null = neither a term nor an account. */
  sourceWithoutInvoice: BillingPurchaseSource | null;
  term: TermShape | null;
}): PaidEver {
  const yes: PaidEver = { value: 'YES', reason: null }, no: PaidEver = { value: 'NO', reason: null };
  const unknown = (reason: PaidEverReason): PaidEver => ({ value: 'UNKNOWN', reason });
  if (input.receiptBeforeCutoff) return yes;
  if (input.paidInvoiceNow) {
    if (input.monthIsCurrent) return yes;
    if (!input.billingReadToCutoff) return unknown('BILLING_SCAN_NOT_COMPLETE');
    return input.untiedReceiptBeforeCutoff ? unknown('UNMATCHED_MONEY') : no; // paid, but after this month
  }
  switch (input.sourceWithoutInvoice ?? 'NO_TERM') {
    case 'NO_TERM': return unknown('LEGACY_NO_TERM');
    case 'TRIAL': return no;
    // ADMIN_MANUAL is both the shop that never bought (its term is the "no package" marker) and the
    // shop whose package the admin set by hand; only the term row tells them apart.
    case 'ADMIN_MANUAL': return input.term && planTermLockReason(input.term) === 'no_package' ? no : unknown('MANUAL_TERM_NO_RECEIPT');
    // Any paid shape with no paid invoice behind it is billing's own review case.
    default: return unknown('BILLING_SOURCE_REVIEW');
  }
}

// ── Usage group (spec §13.2) ──────────────────────────────────────────────────────────────────

export type UsageGroup = 'NOT_STARTED' | 'INACTIVE' | 'ACTIVE' | 'NOT_PAID';
export type UsageUnassessedReason = 'ACTIVITY_HISTORY_INCOMPLETE' | 'PAYMENT_HISTORY_INCOMPLETE';

export function decideUsageGroup(input: {
  paidEver: PaidEver['value'];
  fullyRefunded: boolean;
  /** A counted action in the month (after the keep-the-larger rule). */
  activeInMonth: boolean;
  /** A counted action was ever found before the month's cutoff. */
  usedBeforeCutoff: boolean;
  /** Every usage source kept rows for the whole month. */
  monthHistoryComplete: boolean;
  /** Every usage source already kept rows when the company was created. */
  historyCompleteSinceSignup: boolean;
}): { usageGroup: UsageGroup | null; reason: UsageUnassessedReason | null } {
  if (input.paidEver === 'NO') return { usageGroup: 'NOT_PAID', reason: null };
  if (input.paidEver === 'UNKNOWN') return { usageGroup: null, reason: 'PAYMENT_HISTORY_INCOMPLETE' };
  if (input.fullyRefunded) return { usageGroup: null, reason: null }; // shown as its own label (Q19)
  if (input.activeInMonth) return { usageGroup: 'ACTIVE', reason: null };
  if (!input.monthHistoryComplete) return { usageGroup: null, reason: 'ACTIVITY_HISTORY_INCOMPLETE' };
  if (input.usedBeforeCutoff) return { usageGroup: 'INACTIVE', reason: null };
  return input.historyCompleteSinceSignup ? { usageGroup: 'NOT_STARTED', reason: null }
    : { usageGroup: null, reason: 'ACTIVITY_HISTORY_INCOMPLETE' };
}

// ── Receipt adoption (spec §13.4) ─────────────────────────────────────────────────────────────

export type ReceiptAdoption = 'EVER' | 'NOT_ENTITLED' | 'UNKNOWN' | 'NEVER';
export function decideReceiptAdoption(input: {
  /** Positive evidence found now, or EVER already stored: it is never taken back (Q20). */
  evidence: boolean;
  /** The shop may use the expenses feature at the build. */
  entitled: boolean;
  createdAt: Date;
  /** When receipt-reading events began to be kept; null = there is none yet. */
  ocrUsageSince: Date | null;
}): ReceiptAdoption {
  if (input.evidence) return 'EVER';
  if (!input.entitled) return 'NOT_ENTITLED';
  return input.ocrUsageSince && input.createdAt < input.ocrUsageSince ? 'UNKNOWN' : 'NEVER';
}

// ── Discovery, signup rail, referrer (spec §15) ───────────────────────────────────────────────

const DISCOVERY_VALUES: readonly string[] = SIGNUP_DISCOVERY_SOURCE_OPTIONS.map((option) => option.value);
type OriginalSignup = { source: string; discoverySource: string | null; createdAt: Date };

/** `discoverySince`: the first signup that ever recorded an answer; before it the question did not exist here. */
export function decideDiscovery(signup: OriginalSignup | null, discoverySince: Date | null): string {
  if (!signup) return 'ADMIN_CREATED';
  if (signup.discoverySource && DISCOVERY_VALUES.includes(signup.discoverySource)) return signup.discoverySource;
  return discoverySince && signup.createdAt >= discoverySince ? 'UNKNOWN' : 'BEFORE_COLLECTION';
}
/** Every rail the signup code has: the website form, the LINE OA form and the email signup (spec §15 names the first two). */
const SIGNUP_RAILS: readonly string[] = [SIGNUP_SOURCE_OFFICIAL_SITE, SIGNUP_SOURCE_LINE_OA, SIGNUP_SOURCE_EMAIL_OTP];
export function decideSignupRail(signup: OriginalSignup | null): string {
  if (!signup) return 'ADMIN_CREATED';
  return SIGNUP_RAILS.includes(signup.source) ? signup.source : 'UNKNOWN';
}
/**
 * KNOWN: a referrer whose sales profile exists. UNRESOLVED: an id with no profile behind it.
 * UNKNOWN: the customer said "a Mangmee salesperson" and no id was kept, or the shop signed up
 * before the question existed. NONE: every other shop — it had the chance to name one and did not.
 */
export function decideReferrer(input: { referralSalesUserId: string | null; salesProfileExists: boolean; discovery: string }): 'KNOWN' | 'NONE' | 'UNKNOWN' | 'UNRESOLVED' {
  if (input.referralSalesUserId) return input.salesProfileExists ? 'KNOWN' : 'UNRESOLVED';
  return input.discovery === 'SALES' || input.discovery === 'BEFORE_COLLECTION' ? 'UNKNOWN' : 'NONE';
}

// ── Rebuild rules (spec §12.3) ────────────────────────────────────────────────────────────────

/** Counted from customer rows that can be deleted later, so a rebuild keeps the larger value (RB-42). */
export const USAGE_COUNTERS = ['activeDays', 'activeDaysLine', 'activeDaysWeb', 'activeUsers', 'activeUsersLine', 'activeUsersWeb',
  'confirmedExpensesLine', 'confirmedExpensesWeb', 'issuedDocuments', 'aiRequests', 'expenseReceiptsLine', 'expenseReceiptsWeb'] as const;
export type UsageCounters = Record<typeof USAGE_COUNTERS[number], number>;
export const NO_USAGE: UsageCounters = Object.fromEntries(USAGE_COUNTERS.map((key) => [key, 0])) as UsageCounters;

export function keepLargerCounters(recount: UsageCounters, stored: Partial<UsageCounters> | null): { counters: UsageCounters; held: boolean } {
  const counters = { ...recount };
  let held = false;
  for (const key of USAGE_COUNTERS) {
    const kept = stored?.[key] ?? 0;
    if (kept > counters[key]) { counters[key] = kept; held = true; }
  }
  return { counters, held };
}

export type MoneyByKind = Record<string, { receiptsSatang: number; refundsSatang: number; feesSatang: number; taxSatang: number }>;
/** What a company-month row reports. Two rows with the same figures are the same answer, whatever build wrote them. */
export type CompanyMonthFigures = UsageCounters & {
  lastActivityAt?: Date | null; activityHistorySince?: Date | null; activitySnapshotReady?: boolean;
  reportClassification: string | null;
  receiptsSatang: number; refundsSatang: number; feesSatang: number; taxSatang: number;
  moneyByPurchaseKind: MoneyByKind;
  disputedInvoiceCount: number; aiCostSatang: number; countersHeld: boolean;
  paidEver: string; paidEverReason: string | null; fullyRefunded: boolean;
  usageGroup: string | null; usageUnassessedReason: string | null;
  salesCreditSatang: number; salesCreditActivations: number; salesCreditWaiting: number;
};
const FIGURE_KEYS = ['lastActivityAt', 'activityHistorySince', 'activitySnapshotReady', 'reportClassification', 'receiptsSatang', 'refundsSatang', 'feesSatang', 'taxSatang', 'disputedInvoiceCount', 'aiCostSatang',
  ...USAGE_COUNTERS, 'paidEver', 'paidEverReason', 'fullyRefunded', 'usageGroup', 'usageUnassessedReason',
  'salesCreditSatang', 'salesCreditActivations', 'salesCreditWaiting'] as const;
/**
 * A stable text of the figures, for "did a rebuild change this row" (key order never matters).
 * `countersHeld` is left out: when source rows are deleted the counters stay as they were, so no figure changed.
 */
export function figuresKey(row: CompanyMonthFigures): string {
  const kinds = Object.keys(row.moneyByPurchaseKind ?? {}).sort().map((kind) => {
    const money = row.moneyByPurchaseKind[kind]!;
    return [kind, money.receiptsSatang, money.refundsSatang, money.feesSatang, money.taxSatang];
  });
  return JSON.stringify([FIGURE_KEYS.map((key) => row[key] ?? null), kinds]);
}

/**
 * A month whose stored answer was final gets a new revision when a rebuild changes a figure (Q31).
 * `wasFinished`: when it was last built the month had ended and the provider had been read to its
 * end. Before that there is no final answer to revise — the last day's money is still on its way.
 */
export function nextRevision(stored: { revision: number; revisedAt: Date | null; wasFinished: boolean } | null, changed: boolean, asOf: Date):
  { revision: number; revisedAt: Date | null } {
  if (!stored) return { revision: 0, revisedAt: null };
  return stored.wasFinished && changed ? { revision: stored.revision + 1, revisedAt: asOf } : { revision: stored.revision, revisedAt: stored.revisedAt };
}

/** A stored number must fit the INTEGER column it goes into; anything else fails the round rather than being cut. */
export function int32(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value > 2_147_483_647 || value < -2_147_483_648) throw new Error(`executive.build_value_out_of_range:${name}`);
  return value;
}
