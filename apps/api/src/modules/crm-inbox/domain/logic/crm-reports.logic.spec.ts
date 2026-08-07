import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCrmReportsSummary, deriveTier } from './crm-reports.logic';
import type { CrmReportsSummary } from '@watchdog-bms/contracts';

const NOW = new Date('2026-07-12T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe('buildCrmReportsSummary', () => {
  it('builds a hand-computed CRM reports summary', () => {
    const summary = buildCrmReportsSummary({
      statusCounts: [
        { status: 'NEW', count: 2 },
        { status: 'OPEN', count: 1 },
        { status: 'WAITING_INTERNAL', count: 1 },
        { status: 'FOLLOW_UP', count: 1 },
        { status: 'RESOLVED', count: 2 },
      ],
      overdue: 3,
      respondedDurationsMin: [5, 10, 11],
      staff: [
        { userId: 'u-manager', displayName: 'Mali', assigned: 4, resolved: 3 },
        { userId: null, assigned: 2, resolved: 1 },
        { userId: 'u-support', displayName: 'Niran', assigned: 2, resolved: 0 },
      ],
      customers: [
        { customerId: 'c-active', displayName: 'Active Customer', lifetimeValueAmount: '100.2500', paymentCount: 1, latestPaidAt: NOW },
        { customerId: 'c-zero', displayName: 'Lead Customer', lifetimeValueAmount: '0.0000', paymentCount: 0, latestPaidAt: null },
        { customerId: 'c-vip-boundary', displayName: 'Boundary VIP', lifetimeValueAmount: '50000.0000', paymentCount: 1, latestPaidAt: NOW },
        { customerId: 'c-under-vip', displayName: 'Almost VIP', lifetimeValueAmount: '49999.9900', paymentCount: 1, latestPaidAt: NOW },
        { customerId: 'c-top', displayName: 'Top VIP', lifetimeValueAmount: '75000.1200', paymentCount: 1, latestPaidAt: NOW },
      ],
      branchId: 'branch-1',
    }, NOW);

    const expected: CrmReportsSummary = {
      total: 7,
      resolved: 2,
      resolvedRate: 29,
      avgResponseMin: 9,
      overdue: 3,
      statusBreakdown: [
        { status: 'NEW', count: 2, pct: 29 },
        { status: 'OPEN', count: 1, pct: 14 },
        { status: 'WAITING_CUSTOMER', count: 0, pct: 0 },
        { status: 'WAITING_INTERNAL', count: 1, pct: 14 },
        { status: 'FOLLOW_UP', count: 1, pct: 14 },
        { status: 'RESOLVED', count: 2, pct: 29 },
      ],
      staffPerformance: [
        { userId: 'u-manager', displayName: 'Mali', assigned: 4, resolved: 3, rate: 75 },
        { userId: null, assigned: 2, resolved: 1, rate: 50 },
        { userId: 'u-support', displayName: 'Niran', assigned: 2, resolved: 0, rate: 0 },
      ],
      topCustomers: [
        { customerId: 'c-top', displayName: 'Top VIP', lifetimeValueAmount: '75000.1200', tier: 'vip' },
        { customerId: 'c-vip-boundary', displayName: 'Boundary VIP', lifetimeValueAmount: '50000.0000', tier: 'vip' },
        { customerId: 'c-under-vip', displayName: 'Almost VIP', lifetimeValueAmount: '49999.9900', tier: 'active' },
        { customerId: 'c-active', displayName: 'Active Customer', lifetimeValueAmount: '100.2500', tier: 'active' },
      ],
      retention: { totalCount: 4, returningCount: 0, newCount: 4, atRiskCount: 0, repeatRatePct: 0, churnRatePct: 0, avgLtvAmount: '43775', atRiskName: null },
      branchId: 'branch-1',
    };

    assert.deepEqual(summary, expected);
  });

  it('returns null average response time when no conversations have responses', () => {
    const summary = buildCrmReportsSummary({
      statusCounts: [],
      overdue: 0,
      respondedDurationsMin: [],
      staff: [],
      customers: [],
      branchId: null,
    }, NOW);

    assert.equal(summary.avgResponseMin, null);
    assert.equal(summary.total, 0);
    assert.equal(summary.resolvedRate, 0);
    assert.deepEqual(summary.topCustomers, []);
    assert.deepEqual(summary.retention, {
      totalCount: 0,
      returningCount: 0,
      newCount: 0,
      atRiskCount: 0,
      repeatRatePct: 0,
      churnRatePct: 0,
      avgLtvAmount: '0',
      atRiskName: null,
    });
  });

  it('derives every retention field from payment aggregates with deterministic age and tie breaks', () => {
    const summary = buildCrmReportsSummary({
      statusCounts: [],
      overdue: 0,
      respondedDurationsMin: [],
      staff: [],
      customers: [
        { customerId: 'new', displayName: 'New Recent', lifetimeValueAmount: '100', paymentCount: 1, latestPaidAt: daysAgo(89) },
        { customerId: 'returning', displayName: 'Returning Recent', lifetimeValueAmount: '501', paymentCount: 2, latestPaidAt: daysAgo(89) },
        { customerId: 'alpha', displayName: 'Alpha', lifetimeValueAmount: '301', paymentCount: 2, latestPaidAt: daysAgo(91) },
        { customerId: 'zulu', displayName: 'Zulu', lifetimeValueAmount: '301', paymentCount: 2, latestPaidAt: daysAgo(91) },
        { customerId: 'lower', displayName: 'Lower LTV', lifetimeValueAmount: '300', paymentCount: 1, latestPaidAt: daysAgo(91) },
        { customerId: 'unpaid', displayName: 'Unpaid', lifetimeValueAmount: '999999', paymentCount: 0, latestPaidAt: null },
      ],
      branchId: null,
    }, NOW);

    assert.deepEqual(summary.retention, {
      totalCount: 5,
      returningCount: 3,
      newCount: 2,
      atRiskCount: 3,
      repeatRatePct: 60,
      churnRatePct: 60,
      avgLtvAmount: '301',
      atRiskName: 'Alpha',
    });
  });
});

describe('deriveTier', () => {
  it('uses decimal-safe LTV boundaries', () => {
    assert.equal(deriveTier('50000.0000'), 'vip');
    assert.equal(deriveTier('49999.9900'), 'active');
    assert.equal(deriveTier('0.0100'), 'active');
    assert.equal(deriveTier('0.0000'), 'lead');
  });
});
