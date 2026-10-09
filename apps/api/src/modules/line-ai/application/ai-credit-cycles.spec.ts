import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendPackageInterval, promotionBoundaries } from '../../billing/domain/billing-package';
import { aiCreditCycleAt, type AiCreditCycleAccount, type AiCreditPaidPeriod, type AiCreditPromoSegment } from './ai-credit-cycles';

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
const cycleAt = (acct: AiCreditCycleAccount, periods: AiCreditPaidPeriod[], at: Date, graceDays: number | null = 7, renewalReview = false,
  promoSegments?: AiCreditPromoSegment[]) => aiCreditCycleAt({ account: acct, periods, promoSegments, at, graceDays, renewalReview });
/** Every cycle start inside [from, to), walking from one cycle end to the next. */
function boundaries(acct: AiCreditCycleAccount, periods: AiCreditPaidPeriod[], from: Date, promoSegments?: AiCreditPromoSegment[]): string[] {
  const out: string[] = [];
  for (let at = from, guard = 0; guard < 40; guard++) {
    const cycle = cycleAt(acct, periods, at, 7, false, promoSegments);
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

/**
 * Promotion free time (plan R9, spec §5 "เครดิต AI และเงิน", owner decision Q2; A09, A32). The paid period `[first, paidEnd)` is
 * cut into monthly cycles as always; the free time `[paidEnd, benefitEnd)` is ONE cycle of its own. Boundaries come from the
 * real `promotionBoundaries`, so a clamped paid end is exactly the one a purchase writes.
 */
function promotion(first: Date, interval: 'month' | 'year', invoiceId = 'promo-inv') {
  const { paidEnd, benefitEnd } = promotionBoundaries({ serviceStartsAt: first, interval, bonusMonths: 1 });
  const paid: AiCreditPaidPeriod = { id: invoiceId, periodStart: first, periodEnd: paidEnd };
  const free: AiCreditPromoSegment = { start: paidEnd, end: benefitEnd, invoiceId };
  return { paid, free, paidEnd, benefitEnd };
}
const iso = (date: Date) => date.toISOString();
const DAY = 86_400_000;

describe('a promotion free time is one AI credit cycle of its own (plan R9, Q2, A09, A32)', () => {
  it('gives a monthly promotion its paid month and ONE free-time cycle, keyed on the paid end and marked PROMOTION', () => {
    const { paid, free, paidEnd, benefitEnd } = promotion(utc('2026-10-05T03:00:00Z'), 'month');
    assert.deepEqual([iso(paidEnd), iso(benefitEnd)], ['2026-11-05T03:00:00.000Z', '2026-12-05T03:00:00.000Z']);
    const acct = account({ billingAnchorDay: 5, paidThrough: benefitEnd });
    const cycle = (at: Date) => cycleAt(acct, [paid], at, 7, false, [free]);
    assert.equal(cycle(utc('2026-10-20T00:00:00Z'))!.fundingSource, undefined, 'a paid cycle carries no marker');
    assert.deepEqual(cycle(utc('2026-11-20T00:00:00Z')), { cycleKey: 'acct:2026-11-05T03:00:00.000Z', billingAccountId: 'acct', start: paidEnd, end: benefitEnd,
      state: 'PAID', invoiceId: 'promo-inv', renewalPaymentDueAt: null, fundingSource: 'PROMOTION' });
    assert.equal(iso(cycle(new Date(paidEnd.getTime() - 1))!.end), iso(paidEnd), 'the paid cycle still ends on the paid end');
    assert.equal(iso(cycle(paidEnd)!.start), iso(paidEnd), 'the free time starts exactly there');
    assert.equal(iso(cycle(new Date(benefitEnd.getTime() - 1))!.start), iso(paidEnd));
    assert.equal(cycle(benefitEnd), null, 'nothing after the free time without a renewal');
    assert.deepEqual(boundaries(acct, [paid], paid.periodStart, [free]), [iso(paid.periodStart), iso(paidEnd)]);
  });

  it('is not cut by month: a clamped paid end (31 Jan → 28 Feb → 31 Mar) is one cycle, with or without a stored anchor day', () => {
    const { paid, free, paidEnd, benefitEnd } = promotion(utc('2027-01-31T02:00:00Z'), 'month');
    assert.deepEqual([iso(paidEnd), iso(benefitEnd)], ['2027-02-28T02:00:00.000Z', '2027-03-31T02:00:00.000Z']);
    for (const billingAnchorDay of [31, null]) {
      const cycle = cycleAt(account({ billingAnchorDay, paidThrough: benefitEnd }), [paid], utc('2027-03-29T00:00:00Z'), 7, false, [free])!;
      assert.deepEqual([cycle.cycleKey, iso(cycle.start), iso(cycle.end), cycle.invoiceId, cycle.fundingSource],
        ['acct:2027-02-28T02:00:00.000Z', '2027-02-28T02:00:00.000Z', '2027-03-31T02:00:00.000Z', 'promo-inv', 'PROMOTION'], `no cut at 28 Mar (anchor ${billingAnchorDay})`);
    }
  });

  it('returns the same cycle whether the free time is a tail or a gap before a later paid period', () => {
    const { paid, free, paidEnd, benefitEnd } = promotion(utc('2026-10-05T03:00:00Z'), 'month');
    const repeat: AiCreditPaidPeriod = { id: 'repeat-inv', periodStart: benefitEnd, periodEnd: appendPackageInterval(benefitEnd, 'month', 5) };
    const tail = account({ billingAnchorDay: 5, paidThrough: benefitEnd }), gap = account({ billingAnchorDay: 5, paidThrough: repeat.periodEnd });
    const midFree = utc('2026-11-20T00:00:00Z');
    const fromTail = cycleAt(tail, [paid], midFree, 7, false, [free])!;
    assert.equal(fromTail.fundingSource, 'PROMOTION');
    assert.deepEqual(cycleAt(gap, [paid, repeat], midFree, 7, false, [free]), fromTail);
    assert.deepEqual(boundaries(gap, [paid, repeat], paid.periodStart, [free]), [iso(paid.periodStart), iso(paidEnd), iso(benefitEnd)]);
    assert.equal(cycleAt(gap, [paid, repeat], utc('2026-12-10T00:00:00Z'), 7, false, [free])!.invoiceId, 'repeat-inv', 'the repeat opens its own cycle at the end of the free time');
    // What the free time replaces: with none known the tail stretches the paid cycle and the gap has no cycle at all.
    assert.equal(iso(cycleAt(tail, [paid], midFree)!.start), iso(paid.periodStart));
    assert.equal(cycleAt(gap, [paid, repeat], midFree), null);
  });

  it('stretches the cycle of whichever run ended last over admin gift days, and adds no allowance', () => {
    const { paid, free, benefitEnd } = promotion(utc('2026-10-05T03:00:00Z'), 'month');
    const giftEnd = new Date(benefitEnd.getTime() + 10 * DAY);
    const acct = account({ billingAnchorDay: 5, renewalMode: 'CARD_AUTO', subscriptionState: 'active', paidThrough: giftEnd });
    const during = new Date(benefitEnd.getTime() + 3 * DAY);
    const freeCycle = cycleAt(acct, [paid], utc('2026-11-20T00:00:00Z'), 7, false, [free])!;
    const gift = cycleAt(acct, [paid], during, 7, false, [free])!;
    assert.equal(gift.cycleKey, freeCycle.cycleKey, 'the free-time lot again — never a new one, and not the closed paid cycle');
    assert.deepEqual([iso(gift.start), iso(gift.end), gift.invoiceId, gift.fundingSource], [iso(free.start), iso(giftEnd), 'promo-inv', 'PROMOTION']);
    const pending = cycleAt(acct, [paid], new Date(giftEnd.getTime() + DAY), 7, false, [free])!;
    assert.deepEqual([pending.state, iso(pending.start)], ['RENEWAL_PENDING', iso(giftEnd)], 'the renewal starts from the gift end');
    // No free time known: exactly today — the last paid cycle stretches, with its own key.
    const plain = cycleAt(acct, [paid], during)!;
    assert.deepEqual([plain.cycleKey, iso(plain.end), plain.fundingSource], [`acct:${iso(paid.periodStart)}`, iso(giftEnd), undefined]);
    // A paid period after the free time ended last: the gift days stretch ITS cycle, not the free time's.
    const repeat: AiCreditPaidPeriod = { id: 'repeat-inv', periodStart: benefitEnd, periodEnd: appendPackageInterval(benefitEnd, 'month', 5) };
    const afterRepeat = account({ billingAnchorDay: 5, paidThrough: new Date(repeat.periodEnd.getTime() + 4 * DAY) });
    const stretched = cycleAt(afterRepeat, [paid, repeat], new Date(repeat.periodEnd.getTime() + 2 * DAY), 7, false, [free])!;
    assert.deepEqual([stretched.cycleKey, stretched.invoiceId, stretched.fundingSource], [`acct:${iso(benefitEnd)}`, 'repeat-inv', undefined]);
  });

  it('gives an annual promotion exactly 12 paid cycles plus 1 free-time cycle, on a 31 Jan anchor too', () => {
    for (const [first, starts] of [
      ['2026-03-10T00:00:00Z', ['2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10', '2026-10-10',
        '2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10', '2027-03-10']],
      ['2026-01-31T02:00:00Z', ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31',
        '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']],
    ] as const) {
      const { paid, free, paidEnd, benefitEnd } = promotion(utc(first), 'year');
      const acct = account({ billingAnchorDay: utc(first).getUTCDate(), paidThrough: benefitEnd });
      assert.deepEqual(boundaries(acct, [paid], paid.periodStart, [free]).map(start => start.slice(0, 10)), starts, first);
      const last = cycleAt(acct, [paid], new Date(paidEnd.getTime() - 1), 7, false, [free])!;
      assert.deepEqual([iso(last.end), last.fundingSource], [iso(paidEnd), undefined], 'the twelfth cycle is still a paid one');
      assert.deepEqual([iso(cycleAt(acct, [paid], paidEnd, 7, false, [free])!.end), cycleAt(acct, [paid], paidEnd, 7, false, [free])!.fundingSource], [iso(benefitEnd), 'PROMOTION']);
      assert.equal(cycleAt(acct, [paid], benefitEnd, 7, false, [free]), null);
    }
  });

  it('opens no second cycle for a repeat or an upgrade inside covered time, the free time included', () => {
    const { paid, free, paidEnd, benefitEnd } = promotion(utc('2026-01-05T00:00:00Z'), 'year');
    const extra = (id: string, from: string, to: Date): AiCreditPaidPeriod => ({ id, periodStart: utc(from), periodEnd: to });
    const next = extra('repeat-next', iso(benefitEnd), appendPackageInterval(benefitEnd, 'month', 5));
    const periods = [paid, extra('upgrade-mid-year', '2026-06-20T00:00:00Z', paidEnd), extra('repeat-replay', '2026-03-05T00:00:00Z', utc('2026-04-05T00:00:00Z')),
      extra('upgrade-into-free-time', '2026-12-01T00:00:00Z', benefitEnd), next];
    const acct = account({ billingAnchorDay: 5, paidThrough: next.periodEnd });
    assert.equal(boundaries(acct, periods, paid.periodStart, [free]).length, 14, '12 paid cycles, the free time, the advance month');
    for (const [at, start, invoiceId, marker] of [
      ['2026-03-20', '2026-03-05', 'promo-inv', undefined], ['2026-06-25', '2026-06-05', 'promo-inv', undefined], ['2026-12-10', '2026-12-05', 'promo-inv', undefined],
      ['2027-01-20', '2027-01-05', 'promo-inv', 'PROMOTION'], ['2027-02-10', '2027-02-05', 'repeat-next', undefined],
    ] as const) {
      const cycle = cycleAt(acct, periods, utc(`${at}T00:00:00Z`), 7, false, [free])!;
      assert.deepEqual([iso(cycle.start).slice(0, 10), cycle.invoiceId, cycle.fundingSource], [start, invoiceId, marker], at);
    }
  });

  it('gives two promotions in a row four cycles, whatever order the free times arrive in', () => {
    const one = promotion(utc('2026-10-05T03:00:00Z'), 'month', 'promo-1'), two = promotion(one.benefitEnd, 'month', 'promo-2');
    const acct = account({ billingAnchorDay: 5, paidThrough: two.benefitEnd });
    const segments = [two.free, one.free];
    assert.deepEqual(boundaries(acct, [one.paid, two.paid], one.paid.periodStart, segments), [one.paid.periodStart, one.paidEnd, one.benefitEnd, two.paidEnd].map(iso));
    const seen = [one.paid.periodStart, one.paidEnd, one.benefitEnd, two.paidEnd].map(at => cycleAt(acct, [one.paid, two.paid], at, 7, false, segments)!);
    assert.deepEqual(seen.map(cycle => [cycle.invoiceId, cycle.fundingSource]), [['promo-1', undefined], ['promo-1', 'PROMOTION'], ['promo-2', undefined], ['promo-2', 'PROMOTION']]);
  });

  it('treats the free time as a link of the chain: a renewal that starts on its clamped end keeps the anchor (Dec 29–31 monthly)', () => {
    for (const day of [29, 30, 31]) {
      const first = utc(`2026-12-${day}T02:00:00Z`);
      const { paid, free, benefitEnd } = promotion(first, 'month');
      assert.equal(iso(benefitEnd), '2027-02-28T02:00:00.000Z', `${day}: the free month ends on a clamped day`);
      // The subscription renews on the ORIGINAL anchor, counted from the first purchase in one step: 28 Feb, then 29–31 Mar, 29–30 Apr.
      const edge = (n: number) => (n === 0 ? first : appendPackageInterval(first, 'month', day, n));
      const renewals = [2, 3, 4].map(n => ({ id: `renewal-${n}`, periodStart: edge(n), periodEnd: edge(n + 1) }));
      const acct = account({ billingAnchorDay: null, subscriptionState: 'active', paidThrough: edge(5) });
      assert.deepEqual(boundaries(acct, [paid, ...renewals], first, [free]), [0, 1, 2, 3, 4].map(n => iso(edge(n))), `${day}: no extra cycle after the free month`);
      // The witness: without the free time the chain breaks at the gap, the anchor becomes 28 and the first renewal month splits.
      const split = cycleAt(acct, [paid, ...renewals], utc('2027-03-28T12:00:00Z'))!;
      assert.notEqual(iso(split.start), iso(edge(2)), `${day}: what the link prevents`);
    }
  });

  it('keeps the anchor of a Jan 29–31 annual subscription across the clamped free month, with no thirteenth cycle in its next year', () => {
    for (const day of [29, 30, 31]) {
      const first = utc(`2026-01-${day}T02:00:00Z`);
      const { paid, free, benefitEnd } = promotion(first, 'year');
      assert.equal(iso(benefitEnd), '2027-02-28T02:00:00.000Z', `${day}: the free month ends on a clamped day`);
      const edge = (n: number) => (n === 0 ? first : appendPackageInterval(first, 'month', day, n));
      const renewal: AiCreditPaidPeriod = { id: 'renewal', periodStart: benefitEnd, periodEnd: edge(25) };
      const acct = account({ billingAnchorDay: null, subscriptionState: 'active', paidThrough: renewal.periodEnd });
      // 12 paid cycles, the free time, then the 12 months of the renewal year — every boundary where the first purchase's anchor puts it.
      assert.deepEqual(boundaries(acct, [paid, renewal], first, [free]), Array.from({ length: 25 }, (_, n) => iso(edge(n))), `${day}`);
    }
  });

  it('opens the pending renewal after the free month on the original anchor (31 Jan → 28 Feb → 31 Mar → 30 Apr)', () => {
    // The free time itself starts on the clamped 28 Feb: only the chain back to 31 Jan keeps the anchor for the renewal.
    const { paid, free, benefitEnd } = promotion(utc('2027-01-31T02:00:00Z'), 'month');
    const acct = account({ billingAnchorDay: null, renewalMode: 'CARD_AUTO', subscriptionState: 'active', paidThrough: benefitEnd });
    const pending = cycleAt(acct, [paid], new Date(benefitEnd.getTime() + 3_600_000), 7, false, [free])!;
    assert.deepEqual([pending.state, iso(pending.start), iso(pending.end), pending.invoiceId, pending.fundingSource],
      ['RENEWAL_PENDING', '2027-03-31T02:00:00.000Z', '2027-04-30T02:00:00.000Z', null, undefined]);
  });

  it('stops funding when a free time overlaps a kept paid period or another free time, and never picks one by row order', () => {
    const { paid, free, paidEnd, benefitEnd } = promotion(utc('2026-10-05T03:00:00Z'), 'month');
    const clash: AiCreditPaidPeriod = { id: 'clash', periodStart: new Date(paidEnd.getTime() + 5 * DAY), periodEnd: appendPackageInterval(benefitEnd, 'month', 5) };
    const acct = account({ billingAnchorDay: 5, paidThrough: clash.periodEnd });
    for (const at of ['2026-10-20', '2026-11-20', '2026-12-20']) assert.equal(cycleAt(acct, [paid, clash], utc(`${at}T00:00:00Z`), 7, false, [free]), null, at);
    const twin: AiCreditPromoSegment = { start: new Date(paidEnd.getTime() + DAY), end: new Date(benefitEnd.getTime() + DAY), invoiceId: 'twin' };
    assert.equal(cycleAt(account({ billingAnchorDay: 5, paidThrough: benefitEnd }), [paid], utc('2026-11-20T00:00:00Z'), 7, false, [free, twin]), null);
    // Adjacent is not overlapping, and an upgrade that starts inside the paid period is not a kept period at all.
    const upgrade: AiCreditPaidPeriod = { id: 'upgrade', periodStart: new Date(paidEnd.getTime() - 5 * DAY), periodEnd: benefitEnd };
    assert.equal(cycleAt(account({ billingAnchorDay: 5, paidThrough: benefitEnd }), [paid, upgrade], utc('2026-11-20T00:00:00Z'), 7, false, [free])!.invoiceId, 'promo-inv');
  });

  it('changes nothing for a shop without a free time: an empty list answers exactly like no list', () => {
    const periods = oneTimeChain(utc('2026-09-10T00:00:00Z'), [{ interval: 'month' }, { interval: 'month' }]);
    const acct = account({ renewalMode: 'CARD_AUTO', subscriptionState: 'active', billingAnchorDay: 10, paidThrough: new Date(periods[1]!.periodEnd.getTime() + 5 * DAY) });
    for (const day of ['2026-09-20', '2026-10-20', '2026-11-12', '2026-11-16', '2026-11-20', '2026-12-31']) {
      const at = utc(`${day}T00:00:00Z`);
      assert.deepEqual(cycleAt(acct, periods, at, 7, false, []), cycleAt(acct, periods, at), day);
    }
  });
});
