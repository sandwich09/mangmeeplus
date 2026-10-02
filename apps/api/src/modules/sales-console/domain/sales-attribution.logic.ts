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
  salesCreditState,
  type SalesAttributionFlag,
  type SalesAttributionSource,
  type SalesDeductionKind,
  type SalesReportDeduction,
  type SalesReportMonth,
  type SalesReportRow,
} from '@watchdog-bms/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` in Asia/Bangkok — the same shape `notification-sweeps` uses for its period keys. */
export function bangkokDateKey(at: Date): string {
  return bangkokParts(at, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** `YYYY-MM` in Asia/Bangkok. The report groups credit by the month the money arrived, and a deduction by the month it was recorded. */
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

/**
 * §17.1: a refund or a lost dispute takes the credit back only when it happens within 60 days of
 * the payment. Owner 2026-10-02: the 60 days run to the provider's own time of it — a refund made
 * on day 59 counts even when this system notices it on day 61.
 */
export function withinRefundWindow(paidAt: Date, occurredAt: Date): boolean {
  const elapsed = occurredAt.getTime() - paidAt.getTime();
  return elapsed >= 0 && elapsed <= SALES_ATTRIBUTION_REFUND_WINDOW_DAYS * DAY_MS;
}

/**
 * Money that went back to the customer, exactly as the payment provider reports it: a refund that
 * succeeded, or a dispute that was lost. `occurredAt` is the provider's time of the refund, or of
 * the dispute being opened.
 */
export type CreditTakeBack = { kind: SalesDeductionKind; providerRef: string; amountSatang: number; occurredAt: Date };

/** Credit still standing on a row: what was credited, less the undated refund an older row carries and every dated deduction. */
export function creditLeftSatang(row: { amountSatang: number; refundedSatang: number }, recorded: readonly { amountSatang: number }[]): number {
  return Math.max(0, row.amountSatang - row.refundedSatang - recorded.reduce((sum, item) => sum + item.amountSatang, 0));
}

/**
 * Owner 2026-10-02: which of the provider's refunds and lost disputes become deductions, and for
 * how much. The caller passes everything the provider lists for the payment, every time.
 *
 * - One provider id deducts once, however often it is observed.
 * - Outside the 60 days (by the provider's time) it deducts nothing.
 * - Never more than the credit that is left: a refund of the tax added on top cannot push a row
 *   below zero. ponytail: the refunded satang come off as they are, so with tax added on top a
 *   PARTIAL refund also takes its tax share; scale by credit/paid if that ever matters.
 * - A row from before this change carries an undated cumulative `refundedSatang`, already deducted
 *   in its payment month. That amount IS the provider's earliest refunds, so they are consumed
 *   against it first and only what exceeds it is dated. A dispute was never part of it.
 */
export function creditDeductions(
  row: { amountSatang: number; refundedSatang: number; paidAt: Date },
  recorded: readonly { providerRef: string; amountSatang: number }[],
  takeBacks: readonly CreditTakeBack[],
): CreditTakeBack[] {
  const seen = new Set(recorded.map((item) => item.providerRef));
  let undated = row.refundedSatang;
  let left = creditLeftSatang(row, recorded);
  const deductions: CreditTakeBack[] = [];
  for (const item of [...takeBacks].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.providerRef.localeCompare(b.providerRef))) {
    if (!(item.amountSatang > 0)) continue;
    const covered = item.kind === 'REFUND' ? Math.min(undated, item.amountSatang) : 0;
    undated -= covered;
    const amountSatang = Math.min(item.amountSatang - covered, left);
    if (seen.has(item.providerRef) || amountSatang <= 0 || !withinRefundWindow(row.paidAt, item.occurredAt)) continue;
    seen.add(item.providerRef);
    left -= amountSatang;
    deductions.push({ ...item, amountSatang });
  }
  return deductions;
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
  /** Cumulative and undated: only rows refunded before 2026-10-02 carry one. Deducted in the payment month. */
  refundedSatang: number;
  paidAt: Date;
  flags: readonly string[];
  flagReviewedAt: Date | null;
};

/** One dated deduction (`SalesAttributionDeduction`) with the row it takes credit back from. */
export type AttributionReportDeduction = {
  kind: SalesDeductionKind;
  amountSatang: number;
  /** The provider's time of the refund, or of the dispute being opened. */
  occurredAt: Date;
  /** When this system recorded it: the Bangkok month it is deducted in. */
  recordedAt: Date;
  companyName: string;
  row: Pick<AttributionReportRow, 'salesUserId' | 'paidAt' | 'flags' | 'flagReviewedAt'>;
};

/** §17.1: where a row's credit stands — waiting for the Owner, cut out by the Owner, or counted. */
const creditState = (row: Pick<AttributionReportRow, 'flags' | 'flagReviewedAt'>) =>
  salesCreditState(row.flags, row.flagReviewedAt);

/**
 * §17.1/§17.2: a row that carries a flag counts ZERO — while nobody has reviewed it, and for good
 * once the Owner cut it out ("ตัดออกจากยอด" keeps the flags). Only a row whose flags the Owner
 * cleared ("ยืนยันว่าไม่ผิดปกติ"), or that never had one, counts: whatever is left after the
 * undated refund older rows carry, and never below zero.
 */
export function countableAmountSatang(row: Pick<AttributionReportRow, 'amountSatang' | 'refundedSatang' | 'flags' | 'flagReviewedAt'>): number {
  if (creditState(row) !== 'COUNTED') return 0;
  return Math.max(0, row.amountSatang - row.refundedSatang);
}

/**
 * Roll rows up by Bangkok month and agent. Months with no rows are omitted rather than padded:
 * the console renders what it is given, and an empty month is not a fact worth transmitting.
 *
 * Owner 2026-10-02: the credit stays in the month of the payment; a refund or a lost dispute is
 * its own line in the month it was recorded in, so a month that is over never changes and an
 * agent's month may be negative. A row from before that change still has its undated cumulative
 * refund taken off in the payment month (`countableAmountSatang`), which is the figure it always gave.
 *
 * A row waiting for review still appears, as an activation under `flaggedCount`, so the Owner can
 * see what is being withheld. A row the Owner cut out appears nowhere: §17.2 counts "ร้านที่นับได้",
 * so it is no activation, no amount and no pending flag, and what was taken back from it cannot
 * make a month negative for credit that was never counted.
 */
export function aggregateReport(
  rows: readonly AttributionReportRow[],
  deductions: readonly AttributionReportDeduction[],
  agent: (salesUserId: string) => { displayName: string; teamLeadUserId: string | null; teamLeadDisplayName: string | null },
): SalesReportMonth[] {
  const byMonth = new Map<string, { rows: Map<string, SalesReportRow>; deductions: SalesReportDeduction[] }>();
  const bucket = (monthKey: string, salesUserId: string) => {
    const month = byMonth.get(monthKey) ?? { rows: new Map<string, SalesReportRow>(), deductions: [] };
    byMonth.set(monthKey, month);
    const current = month.rows.get(salesUserId) ?? {
      salesUserId, ...agent(salesUserId),
      dealActivations: 0, referralActivations: 0, amountSatang: 0, flaggedCount: 0,
    };
    month.rows.set(salesUserId, current);
    return { month, current };
  };
  for (const row of rows) {
    const state = creditState(row);
    if (state === 'EXCLUDED') continue;
    const { current } = bucket(bangkokMonthKey(row.paidAt), row.salesUserId);
    if (row.source === 'DEAL') current.dealActivations += 1; else current.referralActivations += 1;
    current.amountSatang += countableAmountSatang(row);
    if (state === 'WAITING') current.flaggedCount += 1;
  }
  for (const item of deductions) {
    // Credit that counts zero, waiting or cut out, has nothing to take back.
    if (creditState(item.row) !== 'COUNTED') continue;
    const { month, current } = bucket(bangkokMonthKey(item.recordedAt), item.row.salesUserId);
    current.amountSatang -= item.amountSatang;
    month.deductions.push({
      salesUserId: item.row.salesUserId, kind: item.kind, companyName: item.companyName,
      paidMonthKey: bangkokMonthKey(item.row.paidAt), amountSatang: item.amountSatang,
      occurredAt: item.occurredAt.toISOString(),
    });
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([monthKey, month]) => ({
      monthKey,
      rows: [...month.rows.values()].sort((a, b) => b.amountSatang - a.amountSatang || a.salesUserId.localeCompare(b.salesUserId)),
      deductions: month.deductions,
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
