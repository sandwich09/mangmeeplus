import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendPackageInterval } from '../../billing/domain/billing-package';
import { aiCreditCycleAt, type AiCreditCycleAccount, type AiCreditPaidPeriod } from './ai-credit-cycles';

const utc = (value: string) => new Date(value);
const account = (over: Partial<AiCreditCycleAccount> = {}): AiCreditCycleAccount => ({
  id: 'acct', billingAnchorDay: null, renewalMode: 'NONE', cancelAtPeriodEnd: false, subscriptionState: 'NONE',
  paidThrough: null, graceEndsAt: null, ...over,
});
/** One-time periods bought back to back, the way `fullPackagePurchaseImpact` chains them. */
function oneTimeChain(first: Date, intervals: Array<{ interval: 'month' | 'year'; count?: number }>): AiCreditPaidPeriod[] {
  const anchor = first.getUTCDate();
  const periods: AiCreditPaidPeriod[] = [];
  let start = first;
  intervals.forEach(({ interval, count }, index) => {
    const end = appendPackageInterval(start, interval, anchor, count ?? 1);
    periods.push({ id: `inv-${index}`, periodStart: start, periodEnd: end });
    start = end;
  });
  return periods;
}
const cycleAt = (acct: AiCreditCycleAccount, periods: AiCreditPaidPeriod[], at: Date, graceDays: number | null = 7, renewalReview = false) =>
  aiCreditCycleAt({ account: acct, periods, at, graceDays, renewalReview });
/** Every cycle start inside [from, to), walking from one cycle end to the next. */
function boundaries(acct: AiCreditCycleAccount, periods: AiCreditPaidPeriod[], from: Date): string[] {
  const out: string[] = [];
  for (let at = from, guard = 0; guard < 40; guard++) {
    const cycle = cycleAt(acct, periods, at);
    if (!cycle) break;
    out.push(cycle.start.toISOString());
    at = cycle.end;
  }
  return out;
}

describe('AI credit cycles follow the paid package periods (add-on spec §5.1, T-01)', () => {
  it('keeps the anchor day of the 31st through short months, matching the renewal boundary every month (spec example)', () => {
    // Paid 31 Jan 03:00 Bangkok = 30 Jan 20:00 UTC, so the UTC anchor is the 30th.
    const periods = oneTimeChain(utc('2026-01-30T20:00:00Z'), [{ interval: 'month' }, { interval: 'month' }, { interval: 'month' }]);
    const acct = account({ billingAnchorDay: 30, paidThrough: periods[2]!.periodEnd });
    assert.deepEqual(boundaries(acct, periods, periods[0]!.periodStart), [
      '2026-01-30T20:00:00.000Z', '2026-02-28T20:00:00.000Z', '2026-03-30T20:00:00.000Z']);
    assert.equal(periods[2]!.periodEnd.toISOString(), '2026-04-30T20:00:00.000Z', 'each cycle ends on a renewal boundary');
  });

  it('handles anchor days 15, 29, 30 and 31 and a leap-year February without drifting', () => {
    for (const [first, expected] of [
      ['2026-01-15T05:00:00Z', ['2026-01-15', '2026-02-15', '2026-03-15']],
      ['2026-01-29T05:00:00Z', ['2026-01-29', '2026-02-28', '2026-03-29']],
      ['2027-12-31T05:00:00Z', ['2027-12-31', '2028-01-31', '2028-02-29']],
      ['2028-01-30T05:00:00Z', ['2028-01-30', '2028-02-29', '2028-03-30']],
    ] as const) {
      const periods = oneTimeChain(utc(first), [{ interval: 'month' }, { interval: 'month' }, { interval: 'month' }]);
      const acct = account({ billingAnchorDay: utc(first).getUTCDate(), paidThrough: periods[2]!.periodEnd });
      assert.deepEqual(boundaries(acct, periods, periods[0]!.periodStart).map(iso => iso.slice(0, 10)), expected, first);
    }
  });

  it('splits an annual period into exactly 12 monthly cycles that end on the period end', () => {
    const periods = oneTimeChain(utc('2026-01-31T02:00:00Z'), [{ interval: 'year' }]);
    const acct = account({ billingAnchorDay: 31, paidThrough: periods[0]!.periodEnd });
    const starts = boundaries(acct, periods, periods[0]!.periodStart);
    assert.equal(starts.length, 12);
    assert.deepEqual(starts.slice(0, 3).map(iso => iso.slice(0, 10)), ['2026-01-31', '2026-02-28', '2026-03-31']);
    assert.equal(cycleAt(acct, periods, utc('2027-01-30T00:00:00Z'))!.end.toISOString(), periods[0]!.periodEnd.toISOString());
    assert.equal(cycleAt(acct, periods, periods[0]!.periodEnd), null, 'nothing after the paid year without a renewal');
  });

  it('gives a sales deal of N months N cycles, and one cycle per one-time monthly period', () => {
    const deal = oneTimeChain(utc('2026-03-10T00:00:00Z'), [{ interval: 'month', count: 3 }]);
    const acct = account({ billingAnchorDay: 10, paidThrough: deal[0]!.periodEnd });
    assert.deepEqual(boundaries(acct, deal, deal[0]!.periodStart).map(iso => iso.slice(0, 10)), ['2026-03-10', '2026-04-10', '2026-05-10']);
    const one = oneTimeChain(utc('2026-03-10T00:00:00Z'), [{ interval: 'month' }]);
    assert.equal(boundaries(account({ billingAnchorDay: 10, paidThrough: one[0]!.periodEnd }), one, one[0]!.periodStart).length, 1);
  });

  it('never splits a subscription month that starts on a clamped day (anchor = chain start, not period start)', () => {
    // Stripe subscription anchored on the 31st: periods end 28 Feb, then 31 Mar. billingAnchorDay is null.
    const periods = [
      { id: 's1', periodStart: utc('2026-01-31T03:00:00Z'), periodEnd: utc('2026-02-28T03:00:00Z') },
      { id: 's2', periodStart: utc('2026-02-28T03:00:00Z'), periodEnd: utc('2026-03-31T03:00:00Z') },
    ];
    const acct = account({ paidThrough: periods[1]!.periodEnd, renewalMode: 'CARD_AUTO', subscriptionState: 'active' });
    const march = cycleAt(acct, periods, utc('2026-03-29T00:00:00Z'))!;
    assert.equal(march.start.toISOString(), '2026-02-28T03:00:00.000Z');
    assert.equal(march.end.toISOString(), '2026-03-31T03:00:00.000Z', 'not a spurious 28 Mar boundary');
    assert.equal(march.invoiceId, 's2');
  });

  it('opens no cycle mid-cycle for an upgrade, a repeat purchase or an advance renewal', () => {
    const base = oneTimeChain(utc('2026-01-05T00:00:00Z'), [{ interval: 'year' }, { interval: 'month' }]);
    const upgrade = { id: 'upgrade', periodStart: utc('2026-06-20T00:00:00Z'), periodEnd: base[0]!.periodEnd };
    const periods = [...base, upgrade];
    const acct = account({ billingAnchorDay: 5, paidThrough: base[1]!.periodEnd });
    const cycle = cycleAt(acct, periods, utc('2026-06-25T00:00:00Z'))!;
    assert.equal(cycle.start.toISOString(), '2026-06-05T00:00:00.000Z');
    assert.equal(cycle.invoiceId, 'inv-0', 'the upgrade invoice never becomes a cycle source');
    // The advance month continues on the same anchor.
    assert.equal(cycleAt(acct, periods, utc('2027-01-20T00:00:00Z'))!.start.toISOString(), '2027-01-05T00:00:00.000Z');
  });

  it('opens RENEWAL_PENDING at the boundary while an auto-renewal is unpaid, until grace ends (O-01)', () => {
    const periods = [{ id: 'p1', periodStart: utc('2026-09-10T00:00:00Z'), periodEnd: utc('2026-10-10T00:00:00Z') }];
    const acct = account({ renewalMode: 'PROMPTPAY_RENEW', subscriptionState: 'active', paidThrough: utc('2026-10-10T00:00:00Z') });
    const pending = cycleAt(acct, periods, utc('2026-10-10T00:00:01Z'), 7)!;
    assert.equal(pending.state, 'RENEWAL_PENDING');
    assert.equal(pending.cycleKey, 'acct:2026-10-10T00:00:00.000Z');
    assert.equal(pending.end.toISOString(), '2026-11-10T00:00:00.000Z');
    assert.equal(pending.renewalPaymentDueAt!.toISOString(), '2026-10-17T00:00:00.000Z');
    assert.equal(cycleAt(acct, periods, utc('2026-10-17T00:00:00Z'), 7), null, 'grace over: the cycle closes');
    // The reconciler's graceEndsAt wins once it is set.
    const reconciled = account({ ...acct, graceEndsAt: utc('2026-10-12T00:00:00Z') });
    assert.equal(cycleAt(reconciled, periods, utc('2026-10-13T00:00:00Z'), 7), null);
    for (const blocked of [account({ ...acct, cancelAtPeriodEnd: true }), account({ ...acct, renewalMode: 'CARD_ONCE' }),
      account({ ...acct, subscriptionState: 'canceled' })]) assert.equal(cycleAt(blocked, periods, utc('2026-10-11T00:00:00Z'), 7), null);
    assert.equal(cycleAt(acct, periods, utc('2026-10-11T00:00:00Z'), 7, true), null, 'an open RENEWAL_REVIEW keeps it closed');
    assert.equal(cycleAt(acct, periods, utc('2026-10-11T00:00:00Z'), null), null, 'no grace policy, no pending cycle');
  });

  it('keeps the same cycle key when the pending renewal is paid, so the allowance is not given twice', () => {
    const first = { id: 'p1', periodStart: utc('2026-09-10T00:00:00Z'), periodEnd: utc('2026-10-10T00:00:00Z') };
    const acct = account({ renewalMode: 'CARD_AUTO', subscriptionState: 'past_due', paidThrough: first.periodEnd });
    const pending = cycleAt(acct, [first], utc('2026-10-11T00:00:00Z'))!;
    const renewal = { id: 'p2', periodStart: first.periodEnd, periodEnd: utc('2026-11-10T00:00:00Z') };
    const paid = cycleAt(account({ ...acct, subscriptionState: 'active', paidThrough: renewal.periodEnd }), [first, renewal], utc('2026-10-11T00:00:00Z'))!;
    assert.equal(paid.state, 'PAID');
    assert.equal(paid.cycleKey, pending.cycleKey);
    assert.equal(paid.invoiceId, 'p2');
  });

  it('starts a new anchor after a lapse, with no cycle overlapping the old one', () => {
    const old = { id: 'old', periodStart: utc('2026-05-20T00:00:00Z'), periodEnd: utc('2026-06-20T00:00:00Z') };
    const fresh = { id: 'new', periodStart: utc('2026-07-03T09:00:00Z'), periodEnd: utc('2026-08-03T09:00:00Z') };
    const acct = account({ billingAnchorDay: 3, paidThrough: fresh.periodEnd });
    assert.equal(cycleAt(acct, [old, fresh], utc('2026-06-25T00:00:00Z')), null, 'the lapse has no cycle');
    const cycle = cycleAt(acct, [old, fresh], utc('2026-07-05T00:00:00Z'))!;
    assert.equal(cycle.start.toISOString(), fresh.periodStart.toISOString());
    assert.equal(cycle.cycleKey, 'acct:2026-07-03T09:00:00.000Z');
  });

  it('stretches the running cycle over admin gift days, adding no allowance, and renews from the gift end', () => {
    const periods = [{ id: 'sub', periodStart: utc('2026-09-10T00:00:00Z'), periodEnd: utc('2026-10-10T00:00:00Z') }];
    const acct = account({ renewalMode: 'CARD_AUTO', subscriptionState: 'active', paidThrough: utc('2026-10-20T00:00:00Z') });
    const gift = cycleAt(acct, periods, utc('2026-10-15T00:00:00Z'))!;
    assert.equal(gift.start.toISOString(), '2026-09-10T00:00:00.000Z', 'the same cycle as before the gift');
    assert.equal(gift.end.toISOString(), '2026-10-20T00:00:00.000Z');
    const pending = cycleAt(acct, periods, utc('2026-10-21T00:00:00Z'))!;
    assert.equal(pending.state, 'RENEWAL_PENDING');
    assert.equal(pending.start.toISOString(), '2026-10-20T00:00:00.000Z');
  });

  it('ends with the package: a refund that ends the term (paidThrough = now) leaves no cycle', () => {
    const periods = oneTimeChain(utc('2026-09-01T00:00:00Z'), [{ interval: 'year' }]);
    const endedAt = utc('2026-10-15T00:00:00Z');
    assert.equal(cycleAt(account({ billingAnchorDay: 1, paidThrough: endedAt }), periods, utc('2026-10-16T00:00:00Z')), null);
    assert.equal(cycleAt(account({ billingAnchorDay: 1, paidThrough: null }), periods, utc('2026-09-16T00:00:00Z')), null);
  });
});
