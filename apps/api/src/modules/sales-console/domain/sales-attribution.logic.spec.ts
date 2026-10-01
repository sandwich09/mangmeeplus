import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateReport,
  attributionFlags,
  bangkokDateKey,
  bangkokMonthKey,
  countableAmountSatang,
  identitiesMatch,
  reportRange,
  SalesReportRangeError,
  withinReferralWindow,
  withinRefundWindow,
  type AttributionFacts,
  type AttributionReportDeduction,
  type AttributionReportRow,
} from './sales-attribution.logic';

const DAY = 24 * 60 * 60 * 1000;
const REFERRED = new Date('2026-09-01T00:00:00Z');

const facts = (over: Partial<AttributionFacts> = {}): AttributionFacts => ({
  owners: [{ email: 'owner@shop.th', phone: '0812345678', lineUserIds: ['U-owner'] }],
  salesAgents: [{ email: 'agent@mangmee.com', phone: '0899999999', lineUserIds: ['U-agent'] }],
  ownerAlreadyAttributed: false,
  sameDayReferralCount: 0,
  sharesIdentityWithAttributedShop: false,
  source: 'REFERRAL',
  ...over,
});

describe('Bangkok keys (§17.1 — the day and month the money landed in Thailand)', () => {
  it('rolls the day over at 17:00 UTC, not at midnight UTC', () => {
    assert.equal(bangkokDateKey(new Date('2026-09-05T16:59:59Z')), '2026-09-05');
    assert.equal(bangkokDateKey(new Date('2026-09-05T17:00:00Z')), '2026-09-06');
  });

  it('puts a payment made late on the last UTC day of a month into the NEXT Bangkok month', () => {
    assert.equal(bangkokMonthKey(new Date('2026-09-30T17:30:00Z')), '2026-10');
    assert.equal(bangkokMonthKey(new Date('2026-09-30T16:30:00Z')), '2026-09');
  });
});

describe('referral window (§17.1 — 14 days from the shop opening, inclusive)', () => {
  it('counts a payment exactly 14 days later and refuses one a second after', () => {
    assert.equal(withinReferralWindow(REFERRED, new Date(REFERRED.getTime() + 14 * DAY)), true);
    assert.equal(withinReferralWindow(REFERRED, new Date(REFERRED.getTime() + 14 * DAY + 1000)), false);
  });

  it('refuses a payment before the shop opened, and a shop with no referral instant at all', () => {
    assert.equal(withinReferralWindow(REFERRED, new Date(REFERRED.getTime() - 1000)), false);
    assert.equal(withinReferralWindow(null, new Date()), false);
    assert.equal(withinReferralWindow(undefined, new Date()), false);
  });

  it('deducts a refund inside 60 days and ignores one after', () => {
    assert.equal(withinRefundWindow(REFERRED, new Date(REFERRED.getTime() + 60 * DAY)), true);
    assert.equal(withinRefundWindow(REFERRED, new Date(REFERRED.getTime() + 61 * DAY)), false);
  });
});

describe('identity matching (§17.1 anti-gaming)', () => {
  it('matches on email case-insensitively and on a phone written differently', () => {
    assert.equal(identitiesMatch({ email: 'A@B.TH' }, { email: 'a@b.th ' }), true);
    assert.equal(identitiesMatch({ phone: '+66 81-234-5678' }, { phone: '0812345678' }), true);
  });

  it('never matches two blanks, or a phone too short to identify anyone', () => {
    assert.equal(identitiesMatch({ email: null, phone: '' }, { email: null, phone: null }), false);
    assert.equal(identitiesMatch({ phone: '1234' }, { phone: '1234' }), false);
  });

  it('matches a shared LINE user id', () => {
    assert.equal(identitiesMatch({ lineUserIds: ['U1', 'U2'] }, { lineUserIds: ['U2'] }), true);
    assert.equal(identitiesMatch({ lineUserIds: ['U1'] }, { lineUserIds: ['U3'] }), false);
  });
});

describe('anti-gaming flags (§17.1)', () => {
  it('raises nothing for an ordinary referral', () => {
    assert.deepEqual(attributionFlags(facts()), []);
  });

  it('raises self_referral when the shop owner IS a sales agent, on any team', () => {
    assert.deepEqual(
      attributionFlags(facts({ salesAgents: [{ email: 'OWNER@shop.th' }] })),
      ['self_referral'],
    );
  });

  it('raises repeat_owner on the second shop of the same owner', () => {
    assert.deepEqual(attributionFlags(facts({ ownerAlreadyAttributed: true })), ['repeat_owner']);
  });

  it('raises referral_anomaly on the 21st shop of one code in a Bangkok day, not the 20th', () => {
    assert.deepEqual(attributionFlags(facts({ sameDayReferralCount: 19 })), []);
    assert.deepEqual(attributionFlags(facts({ sameDayReferralCount: 20 })), ['referral_anomaly']);
  });

  it('raises referral_anomaly when the owner shares a phone or LINE with another counted shop', () => {
    assert.deepEqual(attributionFlags(facts({ sharesIdentityWithAttributedShop: true })), ['referral_anomaly']);
  });

  it('never raises referral_anomaly on a DEAL row — an agent writing deals is the job', () => {
    assert.deepEqual(
      attributionFlags(facts({ source: 'DEAL', sameDayReferralCount: 99, sharesIdentityWithAttributedShop: true })),
      [],
    );
  });
});

describe('countable amount (§17.1/§17.2)', () => {
  const base = { amountSatang: 100_000, refundedSatang: 0, flags: [] as string[], flagReviewedAt: null as Date | null };

  it('counts the full amount for a clean row and deducts a refund', () => {
    assert.equal(countableAmountSatang(base), 100_000);
    assert.equal(countableAmountSatang({ ...base, refundedSatang: 30_000 }), 70_000);
  });

  it('never goes negative when a refund exceeds the recorded amount', () => {
    assert.equal(countableAmountSatang({ ...base, refundedSatang: 150_000 }), 0);
  });

  it('counts zero while a flag is unreviewed and the full amount once it is reviewed', () => {
    assert.equal(countableAmountSatang({ ...base, flags: ['self_referral'] }), 0);
    assert.equal(countableAmountSatang({ ...base, flags: ['self_referral'], flagReviewedAt: new Date() }), 100_000);
  });
});

describe('report aggregation (§17.2 — per agent per Bangkok month)', () => {
  const row = (over: Partial<AttributionReportRow>): AttributionReportRow => ({
    salesUserId: 'agent-1', source: 'DEAL', amountSatang: 100_000, refundedSatang: 0,
    paidAt: new Date('2026-09-10T03:00:00Z'), flags: [], flagReviewedAt: null, ...over,
  });
  const agent = (id: string) => ({ displayName: id.toUpperCase(), teamLeadUserId: 'lead-1', teamLeadDisplayName: 'LEAD-1' });

  it('splits deal and referral activations and sums the money', () => {
    const [month] = aggregateReport([row({}), row({ source: 'REFERRAL', amountSatang: 49_900 })], [], agent);
    assert.equal(month!.monthKey, '2026-09');
    assert.deepEqual(month!.rows, [{
      salesUserId: 'agent-1', displayName: 'AGENT-1', teamLeadUserId: 'lead-1', teamLeadDisplayName: 'LEAD-1',
      dealActivations: 1, referralActivations: 1, amountSatang: 149_900, flaggedCount: 0,
    }]);
  });

  it('withholds a flagged row from the total but still reports it as flagged', () => {
    const [month] = aggregateReport([row({ flags: ['repeat_owner'] }), row({ amountSatang: 20_000 })], [], agent);
    assert.equal(month!.rows[0]!.amountSatang, 20_000);
    assert.equal(month!.rows[0]!.flaggedCount, 1);
    assert.equal(month!.rows[0]!.dealActivations, 2);
  });

  it('groups by Bangkok month, newest month first', () => {
    const months = aggregateReport([
      row({ paidAt: new Date('2026-08-15T00:00:00Z') }),
      row({ paidAt: new Date('2026-09-30T17:30:00Z') }),
    ], [], agent);
    assert.deepEqual(months.map((month) => month.monthKey), ['2026-10', '2026-08']);
  });

  // ── owner 2026-10-02: a deduction is its own line, in the month it was recorded ──

  const paid = row({ source: 'REFERRAL', amountSatang: 49_900, paidAt: new Date('2026-09-20T03:00:00Z') });
  const taken = (over: Partial<AttributionReportDeduction> = {}): AttributionReportDeduction => ({
    kind: 'REFUND', amountSatang: 49_900, occurredAt: new Date('2026-10-05T02:00:00Z'),
    recordedAt: new Date('2026-10-05T02:03:00Z'), companyName: 'ร้านกาแฟดี', row: paid, ...over,
  });

  it('leaves the month of the payment as it was and makes the month of the refund negative', () => {
    const before = aggregateReport([paid], [], agent);
    const after = aggregateReport([paid], [taken()], agent);
    assert.deepEqual(after.map((month) => month.monthKey), ['2026-10', '2026-09']);
    assert.deepEqual(after[1], before[0], 'September reads exactly what it read before the refund');
    assert.deepEqual(after[0]!.rows, [{
      salesUserId: 'agent-1', displayName: 'AGENT-1', teamLeadUserId: 'lead-1', teamLeadDisplayName: 'LEAD-1',
      dealActivations: 0, referralActivations: 0, amountSatang: -49_900, flaggedCount: 0,
    }]);
    assert.deepEqual(after[0]!.deductions, [{
      salesUserId: 'agent-1', kind: 'REFUND', companyName: 'ร้านกาแฟดี', paidMonthKey: '2026-09',
      amountSatang: 49_900, occurredAt: '2026-10-05T02:00:00.000Z',
    }]);
  });

  it('nets a deduction against the same month\'s credit and names a lost dispute as its own kind', () => {
    const october = row({ amountSatang: 100_000, paidAt: new Date('2026-10-02T03:00:00Z') });
    const [month] = aggregateReport([october], [taken({ kind: 'DISPUTE', amountSatang: 30_000 })], agent);
    assert.equal(month!.monthKey, '2026-10');
    assert.equal(month!.rows[0]!.amountSatang, 70_000);
    assert.equal(month!.rows[0]!.dealActivations, 1);
    assert.deepEqual(month!.deductions!.map((line) => [line.kind, line.amountSatang, line.paidMonthKey]), [['DISPUTE', 30_000, '2026-09']]);
  });

  it('deducts in the month it was recorded, so a refund noticed after its month ended moves no month that is over', () => {
    // The provider dates the refund 30 Sep; the system records it on 2 Oct.
    const late = taken({ occurredAt: new Date('2026-09-30T05:00:00Z'), recordedAt: new Date('2026-10-02T05:00:00Z') });
    const months = aggregateReport([paid], [late], agent);
    assert.equal(months.find((month) => month.monthKey === '2026-09')!.rows[0]!.amountSatang, 49_900);
    assert.equal(months.find((month) => month.monthKey === '2026-10')!.rows[0]!.amountSatang, -49_900);
    // The line still tells the reader when the money really went back.
    assert.equal(months[0]!.deductions![0]!.occurredAt, '2026-09-30T05:00:00.000Z');
  });

  it('splits two deductions at Bangkok midnight, not at midnight UTC', () => {
    const months = aggregateReport([], [
      taken({ amountSatang: 10_000, recordedAt: new Date('2026-09-30T16:59:59.999Z') }),
      taken({ amountSatang: 20_000, recordedAt: new Date('2026-09-30T17:00:00.000Z') }),
    ], agent);
    assert.deepEqual(months.map((month) => [month.monthKey, month.rows[0]!.amountSatang]), [['2026-10', -20_000], ['2026-09', -10_000]]);
  });

  it('keeps giving an older row, refunded before deductions were dated, the figure it gave before', () => {
    // Cumulative refund, no dated record: deducted in the payment month, no line.
    const old = row({ amountSatang: 100_000, refundedSatang: 30_000 });
    const [alone] = aggregateReport([old], [], agent);
    assert.equal(alone!.rows[0]!.amountSatang, 70_000);
    assert.deepEqual(alone!.deductions, []);
    // A later, dated refund on that same row goes to its own month and leaves September at 70,000.
    const months = aggregateReport([old], [taken({ amountSatang: 20_000, row: old })], agent);
    assert.deepEqual(months.map((month) => [month.monthKey, month.rows[0]!.amountSatang]), [['2026-10', -20_000], ['2026-09', 70_000]]);
  });

  it('counts nothing for a flagged row nobody reviewed — neither its credit nor what was taken back', () => {
    const flagged = row({ flags: ['self_referral'] });
    const months = aggregateReport([flagged], [taken({ row: flagged })], agent);
    assert.deepEqual(months.map((month) => month.monthKey), ['2026-09']);
    assert.equal(months[0]!.rows[0]!.amountSatang, 0);
    assert.equal(months[0]!.rows[0]!.flaggedCount, 1);
    assert.deepEqual(months[0]!.deductions, []);
    // Once reviewed, the credit and the deduction both count, each in its own month.
    const reviewed = { ...flagged, flags: [], flagReviewedAt: new Date('2026-10-06T00:00:00Z') };
    const after = aggregateReport([reviewed], [taken({ row: reviewed })], agent);
    assert.deepEqual(after.map((month) => [month.monthKey, month.rows[0]!.amountSatang]), [['2026-10', -49_900], ['2026-09', 100_000]]);
  });
});

describe('report range', () => {
  const now = new Date('2026-09-21T06:00:00Z');

  it('defaults to the current Bangkok month when nothing is asked for', () => {
    const range = reportRange(undefined, undefined, now);
    assert.equal(range.from, '2026-09');
    assert.equal(range.to, '2026-09');
    assert.equal(range.start.toISOString(), '2026-08-31T17:00:00.000Z');
    assert.equal(range.end.toISOString(), '2026-09-30T17:00:00.000Z');
  });

  it('spans inclusive months and ends at the first instant of the month after `to`', () => {
    const range = reportRange('2026-07', '2026-09', now);
    assert.equal(range.start.toISOString(), '2026-06-30T17:00:00.000Z');
    assert.equal(range.end.toISOString(), '2026-09-30T17:00:00.000Z');
  });

  it('refuses a reversed range, a malformed month and a span over 24 months', () => {
    assert.throws(() => reportRange('2026-09', '2026-07', now), SalesReportRangeError);
    assert.throws(() => reportRange('2026-13', '2026-13', now), SalesReportRangeError);
    assert.throws(() => reportRange('2024-01', '2026-09', now), SalesReportRangeError);
  });
});
