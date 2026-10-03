import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bangkokDayBounds, buildDailyBriefWidgets } from './crm-daily-brief.logic';

describe('bangkokDayBounds', () => {
  it('floors to Bangkok midnight (UTC+7) as a UTC instant, 24h span', () => {
    // 2026-07-09T02:00:00Z = 09:00 Bangkok → day is 2026-07-08T17:00:00Z .. 2026-07-09T17:00:00Z
    const { dayStart, dayEnd } = bangkokDayBounds(new Date('2026-07-09T02:00:00Z'));
    assert.equal(dayStart.toISOString(), '2026-07-08T17:00:00.000Z');
    assert.equal(dayEnd.toISOString(), '2026-07-09T17:00:00.000Z');
  });
  it('just-after-midnight Bangkok stays in the new day', () => {
    // 2026-07-09T17:30:00Z = 00:30 Bangkok on the 10th
    const { dayStart } = bangkokDayBounds(new Date('2026-07-09T17:30:00Z'));
    assert.equal(dayStart.toISOString(), '2026-07-09T17:00:00.000Z');
  });
});

describe('buildDailyBriefWidgets', () => {
  const counts = {
    unanswered: 3,
    slaBreaches: 1,
    newCustomersToday: 5,
    appointmentsToday: 2,
    paymentProofs: 4,
    openDeals: { count: 6, amount: '12345.5000' },
    quotationsAwaitingAcceptance: { count: 2, amount: '2500.0000' },
    overduePayments: { count: 3, amount: '700.2500' },
    unresolvedComplaints: 2,
    averageFirstResponse: { minutes: 18, count: 4 },
  };
  const widgets = buildDailyBriefWidgets('co-1', counts);

  it('produces one widget per metric with the right value + deep link', () => {
    assert.equal(widgets.length, 10);
    const by = Object.fromEntries(widgets.map((w) => [w.key, w]));
    assert.equal(by['unanswered'].value, 3);
    assert.equal(by['unanswered'].href, '/companies/co-1/inbox?unanswered=true');
    assert.equal(by['sla_breaches'].href, '/companies/co-1/inbox?overdue=true');
    assert.equal(by['appointments_today'].href, '/companies/co-1/bookings');
    assert.equal(by['payment_proofs'].href, '/companies/co-1/crm/payment-proofs');
    assert.deepEqual(
      { value: by['open_deals'].value, count: by['open_deals'].count, amount: by['open_deals'].amount, href: by['open_deals'].href },
      { value: 12345.5, count: 6, amount: '12345.5000', href: '/companies/co-1/crm?tab=pipeline' },
    );
    assert.deepEqual(
      { value: by['quotations_awaiting_acceptance'].value, count: by['quotations_awaiting_acceptance'].count, amount: by['quotations_awaiting_acceptance'].amount, href: by['quotations_awaiting_acceptance'].href },
      { value: 2500, count: 2, amount: '2500.0000', href: '/companies/co-1/sales-documents?documentType=QUOTATION' },
    );
    assert.deepEqual(
      { value: by['overdue_payments'].value, count: by['overdue_payments'].count, amount: by['overdue_payments'].amount, href: by['overdue_payments'].href },
      { value: 700.25, count: 3, amount: '700.2500', href: '/companies/co-1/sales-documents' },
    );
    assert.deepEqual(
      { value: by['unresolved_complaints'].value, count: by['unresolved_complaints'].count, href: by['unresolved_complaints'].href },
      { value: 2, count: 2, href: '/companies/co-1/inbox' },
    );
    assert.deepEqual(
      { value: by['average_first_response_today'].value, count: by['average_first_response_today'].count, unit: by['average_first_response_today'].unit, href: by['average_first_response_today'].href },
      { value: 18, count: 4, unit: 'minutes', href: '/companies/co-1/crm-reports?period=today' },
    );
  });

  // Owner report 2026-10-02: the dashboard card said "เกิน SLA". Late is "เกินกำหนด" on every screen.
  it('labels every card in words a shop reads, with no "SLA"', () => {
    const by = Object.fromEntries(widgets.map((w) => [w.key, w]));
    assert.equal(by['sla_breaches'].label, 'รอตอบเกินกำหนด');
    for (const widget of widgets) assert.doesNotMatch(widget.label, /SLA/, widget.key);
  });

  it('escalates severity only when a queue needs attention', () => {
    const by = Object.fromEntries(widgets.map((w) => [w.key, w]));
    assert.equal(by['sla_breaches'].severity, 'critical'); // >0 breaches
    assert.equal(by['unanswered'].severity, 'action');
    const calm = Object.fromEntries(buildDailyBriefWidgets('co-1', {
      unanswered: 0,
      slaBreaches: 0,
      newCustomersToday: 0,
      appointmentsToday: 0,
      paymentProofs: 0,
      openDeals: { count: 0, amount: '0.0000' },
      quotationsAwaitingAcceptance: { count: 0, amount: '0.0000' },
      overduePayments: { count: 0, amount: '0.0000' },
      unresolvedComplaints: 0,
      averageFirstResponse: { minutes: null, count: 0 },
    }).map((w) => [w.key, w]));
    assert.equal(calm['sla_breaches'].severity, 'info');
    assert.equal(calm['unanswered'].severity, 'info');
    assert.equal(calm['open_deals'].severity, 'info');
    assert.equal(calm['quotations_awaiting_acceptance'].severity, 'info');
    assert.equal(calm['overdue_payments'].severity, 'info');
    assert.equal(calm['unresolved_complaints'].severity, 'info');
    assert.equal(calm['average_first_response_today'].value, null);
  });
});
