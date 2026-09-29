/**
 * AI credit cycles follow the package's PAID periods (add-on spec §5.1, T-01, O-01).
 *
 * A paid period is `[periodStart, periodEnd)` of an APPLIED `PACKAGE` invoice. Inside it, cycle k
 * starts at `appendPackageInterval(periodStart, 'month', anchorDay, k)` capped at `periodEnd`, counted
 * from the period start in one step so the anchor never drifts; the last cycle always ends on the
 * period end, so a cycle boundary is always a package renewal boundary.
 *
 * Plain functions, the `company-ai-budget-policy.ts` style: `aiCreditCycleAt` decides from rows it is
 * given, `readAiCreditCycle` reads those rows. Nothing here writes — the lot for a cycle is created
 * lazily by the funding path under the company lock (`ai-credit-ledger.ts`).
 */
import { appendPackageInterval } from '../../billing/domain/billing-package';

export type AiCreditCycleState = 'PAID' | 'RENEWAL_PENDING';

export type AiCreditCycle = {
  /** `<billingAccountId>:<cycleStart ISO UTC>` — one cycle per company, paid or pending. */
  cycleKey: string;
  billingAccountId: string;
  start: Date;
  end: Date;
  state: AiCreditCycleState;
  /** The paid period's invoice; null while the renewal is still unpaid (O-01). */
  invoiceId: string | null;
  /** Grace end for a RENEWAL_PENDING cycle (the customer's "pay by" date), else null. */
  renewalPaymentDueAt: Date | null;
};

export type AiCreditPaidPeriod = { id: string; periodStart: Date; periodEnd: Date };

export type AiCreditCycleAccount = {
  id: string;
  billingAnchorDay: number | null;
  renewalMode: string;
  cancelAtPeriodEnd: boolean;
  subscriptionState: string;
  paidThrough: Date | null;
  graceEndsAt: Date | null;
};

const AUTO_RENEW = new Set(['CARD_AUTO', 'PROMPTPAY_RENEW']);
const DAY_MS = 86_400_000;
/** appendPackageInterval accepts at most 1200 intervals; an annual period needs 12. */
const MAX_CYCLES_PER_PERIOD = 1200;

/**
 * The periods that define cycles. An upgrade invoice covers `[prorationAt, paidThrough)`, INSIDE a
 * period that is already paid, so it must never start a cycle of its own (spec §5.1: no new cycle
 * mid-cycle from an upgrade, repeat purchase, advance renewal, deal or add-on). A period counts only
 * when it starts at or after the end of everything kept before it.
 */
function basePeriods(periods: readonly AiCreditPaidPeriod[]): AiCreditPaidPeriod[] {
  const sorted = periods
    .filter(p => p.periodEnd.getTime() > p.periodStart.getTime())
    .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime() || b.periodEnd.getTime() - a.periodEnd.getTime());
  const kept: AiCreditPaidPeriod[] = [];
  let coveredUntil = Number.NEGATIVE_INFINITY;
  for (const period of sorted) {
    if (period.periodStart.getTime() < coveredUntil) continue;
    kept.push(period);
    coveredUntil = period.periodEnd.getTime();
  }
  return kept;
}

/**
 * Start of the continuous run of periods that `period` belongs to. A subscription stores no anchor
 * day (`billingAnchorDay: null`), and a period that starts on a clamped day (28 Feb after a 31 Jan
 * start) must keep the ORIGINAL day, or the next period would split into two cycles.
 */
function chainStart(periods: readonly AiCreditPaidPeriod[], period: AiCreditPaidPeriod): Date {
  let start = period.periodStart;
  for (let i = periods.indexOf(period) - 1; i >= 0; i--) {
    if (periods[i]!.periodEnd.getTime() !== start.getTime()) break;
    start = periods[i]!.periodStart;
  }
  return start;
}

const cycleKey = (accountId: string, start: Date) => `${accountId}:${start.toISOString()}`;

/**
 * The cycle in force at `at`, or null when the company has no paid package cycle then (package
 * ended, grace over, renewal under review, or no paid history — spec §11.3 legacy).
 */
export function aiCreditCycleAt(input: {
  account: AiCreditCycleAccount;
  periods: readonly AiCreditPaidPeriod[];
  at: Date;
  /** The contract's `policy.graceDays`; only read before the reconciler has set `graceEndsAt`. */
  graceDays: number | null;
  /** An unresolved `RENEWAL_REVIEW` issue: the unpaid renewal is not trusted, so no pending cycle (§5.1). */
  renewalReview: boolean;
}): AiCreditCycle | null {
  const { account, at } = input;
  const periods = basePeriods(input.periods);
  const time = at.getTime();
  if (!Number.isSafeInteger(time) || !account.paidThrough) return null;
  const paidThrough = account.paidThrough.getTime();

  const last = periods[periods.length - 1];
  if (time < paidThrough) {
    let period = periods.find(p => p.periodStart.getTime() <= time && time < p.periodEnd.getTime());
    // Admin gift days move paidThrough with no invoice (`billing-free-days.ts`, `aiQuotaAdded: 0`): the
    // running cycle stretches over them and no allowance is added.
    // ponytail: stretch, not a new cycle; revisit if the Owner wants gift days to carry AI credit.
    const gift = !period && !!last && time >= last.periodEnd.getTime();
    if (gift) period = last;
    if (!period) return null;
    const probe = gift ? period.periodEnd.getTime() - 1 : time;
    const anchorDay = account.billingAnchorDay ?? chainStart(periods, period).getUTCDate();
    let start = period.periodStart;
    for (let k = 1; k <= MAX_CYCLES_PER_PERIOD; k++) {
      const next = appendPackageInterval(period.periodStart, 'month', anchorDay, k);
      const end = next.getTime() < period.periodEnd.getTime() ? next : period.periodEnd;
      if (probe < end.getTime()) {
        return { cycleKey: cycleKey(account.id, start), billingAccountId: account.id, start, end: gift ? new Date(paidThrough) : end,
          state: 'PAID', invoiceId: period.id, renewalPaymentDueAt: null };
      }
      start = end;
    }
    return null;
  }

  // O-01: the boundary passed and the renewal is unpaid. An auto-renewing account that is not
  // cancelling gets the new cycle NOW, until grace ends — never waiting for the reconciler.
  if (!AUTO_RENEW.has(account.renewalMode) || account.cancelAtPeriodEnd || input.renewalReview
    || ['canceled', 'incomplete_expired'].includes(account.subscriptionState)) return null;
  const graceEnd = account.graceEndsAt?.getTime()
    ?? (input.graceDays === null ? null : paidThrough + input.graceDays * DAY_MS);
  if (graceEnd === null || time >= graceEnd) return null;
  // The period ending at paidThrough, or the last one when gift days stretched coverage past it.
  if (!last || last.periodEnd.getTime() > paidThrough) return null;
  const start = new Date(paidThrough);
  const end = appendPackageInterval(start, 'month', account.billingAnchorDay ?? chainStart(periods, last).getUTCDate());
  if (time >= end.getTime()) return null;
  return { cycleKey: cycleKey(account.id, start), billingAccountId: account.id, start, end, state: 'RENEWAL_PENDING',
    invoiceId: null, renewalPaymentDueAt: new Date(graceEnd) };
}

/**
 * Reads what {@link aiCreditCycleAt} needs for one company. Only the paid term's billing account
 * counts (`CompanyPlanTerm.billingReceiptAccountId`); a trial, a manual plan or an ended term has no
 * cycle. The contract and the review issue are read only inside the renewal window.
 */
export async function readAiCreditCycle(tx: any, companyId: string, at: Date): Promise<AiCreditCycle | null> {
  const term = await tx.companyPlanTerm.findUnique({
    where: { companyId }, select: { billingReceiptAccountId: true, termDisabledAt: true },
  }) as { billingReceiptAccountId: string | null; termDisabledAt: Date | null } | null;
  if (!term?.billingReceiptAccountId || term.termDisabledAt) return null;
  const account = await tx.billingAccount.findFirst({
    where: { id: term.billingReceiptAccountId, companyId },
    select: { id: true, billingAnchorDay: true, renewalMode: true, cancelAtPeriodEnd: true, subscriptionState: true,
      paidThrough: true, graceEndsAt: true },
  }) as AiCreditCycleAccount | null;
  if (!account?.paidThrough) return null;
  const periods = await tx.billingInvoice.findMany({
    where: { billingAccountId: account.id, productKind: 'PACKAGE', applyStatus: 'APPLIED' },
    select: { id: true, periodStart: true, periodEnd: true },
  }) as AiCreditPaidPeriod[];
  const inRenewalWindow = at.getTime() >= account.paidThrough.getTime();
  let graceDays: number | null = null;
  let renewalReview = false;
  if (inRenewalWindow) {
    if (!account.graceEndsAt) {
      const contract = await tx.billingSubscriptionContract.findFirst({
        where: { billingAccountId: account.id, effectiveAt: { lte: at } },
        orderBy: [{ effectiveAt: 'desc' }, { revision: 'desc' }], select: { snapshotJson: true },
      }) as { snapshotJson: { policy?: { graceDays?: unknown } } | null } | null;
      const days = contract?.snapshotJson?.policy?.graceDays;
      graceDays = Number.isInteger(days) && (days as number) >= 0 ? days as number : null;
    }
    renewalReview = !!await tx.billingIssue.findFirst({
      where: { kind: 'RENEWAL_REVIEW', referenceId: account.id, state: { not: 'RESOLVED' } }, select: { id: true },
    });
  }
  return aiCreditCycleAt({ account, periods, at, graceDays, renewalReview });
}
