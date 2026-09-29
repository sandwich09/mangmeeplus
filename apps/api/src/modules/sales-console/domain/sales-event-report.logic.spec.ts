import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateEventReport,
  emptyEventReportFigures,
  ticketDisplayState,
  type SalesEventReportTicketRow,
} from './sales-event-report.logic';

const NOW = new Date('2026-09-29T08:00:00Z');
const LATER = new Date('2026-10-30T00:00:00Z');
const BATCHES = new Map([
  ['b-early', { eventName: 'งานแฟร์ SME', batchName: 'ชุด ก' }],
  ['b-late', { eventName: 'งานแฟร์ SME', batchName: 'ชุด ข' }],
  ['b-other', { eventName: 'งานเกษตร', batchName: 'ชุดเดียว' }],
]);
const NAMES: Record<string, string> = { 'u-a': 'เซลล์ ก', 'u-b': 'เซลล์ ข' };

function row(overrides: Partial<SalesEventReportTicketRow>): SalesEventReportTicketRow {
  return { batchId: 'b-early', salesUserId: 'u-a', state: 'ISSUED', redeemedAs: null, expiresAt: LATER,
    discountSatang: 10_000, appliedDiscountSatang: null, invoice: null, ...overrides };
}

describe('ticketDisplayState — spec §6.3', () => {
  it('reads expiry from time: ISSUED at or after expiresAt is EXPIRED', () => {
    assert.equal(ticketDisplayState({ state: 'ISSUED', expiresAt: LATER }, NOW), 'AVAILABLE');
    assert.equal(ticketDisplayState({ state: 'ISSUED', expiresAt: NOW }, NOW), 'EXPIRED');
    assert.equal(ticketDisplayState({ state: 'RESERVED', expiresAt: NOW }, NOW), 'IN_PAYMENT');
    assert.equal(ticketDisplayState({ state: 'USED', expiresAt: NOW }, NOW), 'USED');
    assert.equal(ticketDisplayState({ state: 'REVOKED', expiresAt: LATER }, NOW), 'REVOKED');
  });
});

describe('aggregateEventReport — spec §10', () => {
  const rows: SalesEventReportTicketRow[] = [
    row({}),
    row({ expiresAt: NOW }),
    row({ state: 'RESERVED', redeemedAs: 'DISCOUNT', appliedDiscountSatang: 10_000 }),
    row({ state: 'USED', redeemedAs: 'DISCOUNT', appliedDiscountSatang: 10_000,
      invoice: { paidSatang: 39_900, refundedSatang: 5_000 } }),
    row({ salesUserId: 'u-b', state: 'USED', redeemedAs: 'CREDIT' }),
    row({ salesUserId: 'u-b', state: 'REVOKED' }),
    row({ batchId: 'b-late', discountSatang: 20_000 }),
    row({ batchId: 'b-other', salesUserId: 'u-b', state: 'USED', redeemedAs: 'DISCOUNT', appliedDiscountSatang: 5_000,
      invoice: { paidSatang: 44_900, refundedSatang: 0 } }),
    row({ batchId: 'b-gone' }),
  ];
  const report = aggregateEventReport(rows, BATCHES, (id) => NAMES[id] ?? '', NOW);

  it('counts each state once, and every issued ticket lands in exactly one bucket', () => {
    const t = report.totals;
    assert.deepEqual(
      { issued: t.issued, available: t.available, inPayment: t.inPayment, usedAsDiscount: t.usedAsDiscount,
        usedAsCredit: t.usedAsCredit, expired: t.expired, revoked: t.revoked },
      { issued: 8, available: 2, inPayment: 1, usedAsDiscount: 2, usedAsCredit: 1, expired: 1, revoked: 1 },
    );
    assert.equal(t.issued, t.available + t.inPayment + t.usedAsDiscount + t.usedAsCredit + t.expired + t.revoked);
  });

  it('sums the discount given only over USED first-bill uses — a reservation is not a sale', () => {
    assert.equal(report.totals.appliedDiscountSatang, 15_000);
    assert.equal(report.totals.paidSatang, 84_800);
    assert.equal(report.totals.refundedSatang, 5_000);
  });

  it('prices the open liability from tickets still usable, not from expired ones', () => {
    assert.equal(report.totals.openDiscountSatang, 30_000);
  });

  it('groups event → batch → เซลล์ in Thai order, and each level adds up to its parent', () => {
    assert.deepEqual(report.events.map((event) => event.eventName), ['งานเกษตร', 'งานแฟร์ SME']);
    const fair = report.events[1]!;
    assert.deepEqual(fair.batches.map((batch) => batch.batchName), ['ชุด ก', 'ชุด ข']);
    const morning = fair.batches[0]!;
    assert.deepEqual(morning.agents.map((agent) => agent.displayName), ['เซลล์ ก', 'เซลล์ ข']);
    assert.equal(morning.figures.issued, 6);
    assert.equal(morning.agents[0]!.figures.issued + morning.agents[1]!.figures.issued, 6);
    assert.equal(fair.figures.issued, 7);
    assert.equal(fair.figures.appliedDiscountSatang, 10_000);
    assert.equal(report.events[0]!.figures.appliedDiscountSatang, 5_000);
  });

  it('leaves out a ticket whose batch did not resolve instead of printing a nameless row', () => {
    assert.ok(report.events.every((event) => event.batches.every((batch) => batch.batchId !== 'b-gone')));
  });

  it('answers zeros for no tickets', () => {
    assert.deepEqual(aggregateEventReport([], BATCHES, () => '', NOW), { events: [], totals: emptyEventReportFigures() });
  });
});
