/**
 * Phase 4 counting rules (spec §17.1 "สูตรนับ" + anti-gaming, §17.2 "นับเฉพาะเปิดครั้งแรก").
 *
 * Everything here is pure: the caller reads the rows, this file decides what they mean. That split
 * is what lets the whole counting formula — the 14-day window, the flags, the refund deduction and
 * the monthly roll-up — be checked without a database.
 */
import {
  SALES_ATTRIBUTION_REFUND_WINDOW_DAYS,
  SALES_REFERRAL_DAILY_ANOMALY_LIMIT,
  SALES_REFERRAL_WINDOW_DAYS,
  SALES_REPORT_MAX_MONTHS,
  SALES_REPORT_MONTH_PATTERN,
  type SalesAttributionFlag,
  type SalesAttributionSource,
  type SalesReportMonth,
  type SalesReportRow,
} from '@watchdog-bms/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` in Asia/Bangkok — the same shape `notification-sweeps` uses for its period keys. */
export function bangkokDateKey(at: Date): string {
  return bangkokParts(at, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** `YYYY-MM` in Asia/Bangkok. The report groups by the month the money actually arrived in Thailand. */
export function bangkokMonthKey(at: Date): string {
  return bangkokParts(at, { year: 'numeric', month: '2-digit' });
}

function bangkokParts(at: Date, options: Intl.DateTimeFormatOptions): string {
  // `en-CA` formats as YYYY-MM-DD, so the parts already come out in the order the key needs.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', ...options }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const day = options.day ? `-${value('day')}` : '';
  return `${value('year')}-${value('month')}${day}`;
}

/**
 * §17.1: a catalog purchase counts for the referring agent only when it is paid within 14 days of
 * the shop opening. A shop with no referral instant never counts — there is nothing to anchor to.
 *
 * The boundary is inclusive ("ภายใน 14 วัน"), so a payment exactly 14 days later still counts.
 */
export function withinReferralWindow(referredAt: Date | null | undefined, paidAt: Date): boolean {
  if (!referredAt || !Number.isFinite(referredAt.getTime()) || !Number.isFinite(paidAt.getTime())) return false;
  const elapsed = paidAt.getTime() - referredAt.getTime();
  return elapsed >= 0 && elapsed <= SALES_REFERRAL_WINDOW_DAYS * DAY_MS;
}

/** §17.1: a refund only cancels the credit when it lands inside 60 days of the payment. */
export function withinRefundWindow(paidAt: Date, observedAt: Date): boolean {
  const elapsed = observedAt.getTime() - paidAt.getTime();
  return elapsed >= 0 && elapsed <= SALES_ATTRIBUTION_REFUND_WINDOW_DAYS * DAY_MS;
}

/** One person's contactable identity, lower-cased so two spellings of the same email match. */
export type AttributionIdentity = { email?: string | null; phone?: string | null; lineUserIds?: readonly string[] };

/** What the writer read from the database, expressed as facts rather than rows. */
export type AttributionFacts = {
  /** ACTIVE OWNER members of the shop being credited. */
  owners: readonly AttributionIdentity[];
  /** Every user holding a sales role, any team (§17.1: "หรือเซลล์คนใดในทีม"). */
  salesAgents: readonly AttributionIdentity[];
  /** True when an OWNER of this shop already owns another shop that has an attribution row. */
  ownerAlreadyAttributed: boolean;
  /** REFERRAL rows this agent already has for the same Bangkok day, this one excluded. */
  sameDayReferralCount: number;
  /** True when an OWNER's phone or LINE id matches an OWNER of another attributed shop. */
  sharesIdentityWithAttributedShop: boolean;
  source: SalesAttributionSource;
};

/**
 * §17.1 anti-gaming. Flags are additive and never block the write: the money was really paid, so
 * the row is recorded and simply counts zero until the Owner reviews it.
 *
 * The IP leg of "referral_anomaly" is deliberately absent — no signup IP is stored anywhere in the
 * schema, so there is nothing to compare. Reported as a spec gap rather than faked.
 */
export function attributionFlags(facts: AttributionFacts): SalesAttributionFlag[] {
  const flags: SalesAttributionFlag[] = [];
  if (facts.owners.some((owner) => facts.salesAgents.some((agent) => identitiesMatch(owner, agent)))) {
    flags.push('self_referral');
  }
  if (facts.ownerAlreadyAttributed) flags.push('repeat_owner');
  // The count excludes this row, so "> 20 shops in a day" is reached on the 21st.
  if (facts.source === 'REFERRAL' &&
      (facts.sameDayReferralCount >= SALES_REFERRAL_DAILY_ANOMALY_LIMIT || facts.sharesIdentityWithAttributedShop)) {
    flags.push('referral_anomaly');
  }
  return flags;
}

/** Two identities are the same person when any ONE contactable field matches. Blanks never match. */
export function identitiesMatch(a: AttributionIdentity, b: AttributionIdentity): boolean {
  if (normalize(a.email) && normalize(a.email) === normalize(b.email)) return true;
  if (digits(a.phone) && digits(a.phone) === digits(b.phone)) return true;
  const theirs = new Set(b.lineUserIds ?? []);
  return (a.lineUserIds ?? []).some((id) => id && theirs.has(id));
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Thai numbers are written +66…, 0…, with spaces and dashes; only the digits identify the line. */
function digits(value: string | null | undefined): string {
  const only = (value ?? '').replace(/\D/g, '');
  // Too short to identify anyone — an empty string never matches another empty string above.
  return only.length >= 9 ? only.replace(/^66/, '0') : '';
}

/** One stored attribution row, as the report reads it. */
export type AttributionReportRow = {
  salesUserId: string;
  source: SalesAttributionSource;
  amountSatang: number;
  refundedSatang: number;
  paidAt: Date;
  flags: readonly string[];
  flagReviewedAt: Date | null;
};

/**
 * §17.1/§17.2: a flagged row that nobody has reviewed counts ZERO — it still appears, under
 * `flaggedCount`, so the Owner can see what is being withheld. A reviewed row counts whatever is
 * left after refunds, and never below zero.
 */
export function countableAmountSatang(row: Pick<AttributionReportRow, 'amountSatang' | 'refundedSatang' | 'flags' | 'flagReviewedAt'>): number {
  if (row.flags.length > 0 && !row.flagReviewedAt) return 0;
  return Math.max(0, row.amountSatang - row.refundedSatang);
}

/**
 * Roll rows up by Bangkok month and agent. Months with no rows are omitted rather than padded:
 * the console renders what it is given, and an empty month is not a fact worth transmitting.
 */
export function aggregateReport(
  rows: readonly AttributionReportRow[],
  agent: (salesUserId: string) => { displayName: string; teamLeadUserId: string | null; teamLeadDisplayName: string | null },
): SalesReportMonth[] {
  const byMonth = new Map<string, Map<string, SalesReportRow>>();
  for (const row of rows) {
    const monthKey = bangkokMonthKey(row.paidAt);
    const month = byMonth.get(monthKey) ?? new Map<string, SalesReportRow>();
    byMonth.set(monthKey, month);
    const current = month.get(row.salesUserId) ?? {
      salesUserId: row.salesUserId, ...agent(row.salesUserId),
      dealActivations: 0, referralActivations: 0, amountSatang: 0, flaggedCount: 0,
    };
    if (row.source === 'DEAL') current.dealActivations += 1; else current.referralActivations += 1;
    current.amountSatang += countableAmountSatang(row);
    if (row.flags.length > 0 && !row.flagReviewedAt) current.flaggedCount += 1;
    month.set(row.salesUserId, current);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([monthKey, month]) => ({
      monthKey,
      rows: [...month.values()].sort((a, b) => b.amountSatang - a.amountSatang || a.salesUserId.localeCompare(b.salesUserId)),
    }));
}

export class SalesReportRangeError extends Error {}

/**
 * Validate and widen `from`/`to` (`YYYY-MM`) into the UTC instants the query needs. The range is
 * inclusive of both months, and the end is the first instant of the month AFTER `to`, so a payment
 * at 23:59 Bangkok on the last day is inside it.
 */
export function reportRange(from: string | undefined, to: string | undefined, now: Date): { from: string; to: string; start: Date; end: Date } {
  const end = to?.trim() || bangkokMonthKey(now);
  const start = from?.trim() || end;
  if (!SALES_REPORT_MONTH_PATTERN.test(start) || !SALES_REPORT_MONTH_PATTERN.test(end) || start > end) {
    throw new SalesReportRangeError('range');
  }
  const months = monthsBetween(start, end);
  if (months > SALES_REPORT_MAX_MONTHS) throw new SalesReportRangeError('span');
  // Asia/Bangkok is UTC+7 all year (no DST since 1976), so the month boundary is a fixed offset.
  return { from: start, to: end, start: bangkokMonthStart(start), end: bangkokMonthStart(nextMonth(end)) };
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm) + 1;
}

function nextMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

function bangkokMonthStart(monthKey: string): Date {
  return new Date(`${monthKey}-01T00:00:00+07:00`);
}
