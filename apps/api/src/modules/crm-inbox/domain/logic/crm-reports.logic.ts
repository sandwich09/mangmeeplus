// Pure CRM reports summary logic. No I/O, no Nest/Prisma imports.

import { Decimal } from 'decimal.js';
import type { CrmConversationStatus, CrmReportsSummary } from '@watchdog-bms/contracts';

export const LTV_TIER_THRESHOLDS = { vip: 50000 } as const;

type CrmReportStatus = Exclude<CrmConversationStatus, 'SPAM'>;

const REPORT_STATUS_ORDER: CrmReportStatus[] = [
  'NEW',
  'OPEN',
  'WAITING_CUSTOMER',
  'WAITING_INTERNAL',
  'FOLLOW_UP',
  'RESOLVED',
];

export type CrmReportsInput = {
  statusCounts: { status: CrmConversationStatus; count: number }[];
  overdue: number;
  respondedDurationsMin: number[];
  staff: { userId: string | null; displayName?: string; assigned: number; resolved: number }[];
  customers: {
    customerId: string;
    displayName: string;
    lifetimeValueAmount: string;
    paymentCount: number;
    latestPaidAt: Date | null;
  }[];
  branchId: string | null;
};

const AT_RISK_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function buildRetention(rows: CrmReportsInput['customers'], now: Date): CrmReportsSummary['retention'] {
  const paying = rows.filter((row) => row.paymentCount >= 1);
  const total = paying.length;
  const returning = paying.filter((row) => row.paymentCount >= 2);
  const newCount = paying.filter((row) => row.paymentCount === 1).length;
  const cutoff = now.getTime() - AT_RISK_AGE_MS;
  const atRisk = paying
    .filter((row) => row.latestPaidAt != null && row.latestPaidAt.getTime() < cutoff)
    .sort((a, b) =>
      a.latestPaidAt!.getTime() - b.latestPaidAt!.getTime()
      || compareDecimalStrings(b.lifetimeValueAmount, a.lifetimeValueAmount)
      || a.displayName.localeCompare(b.displayName),
    );
  const ltvSum = paying.reduce((sum, row) => sum.add(row.lifetimeValueAmount), new Decimal(0));
  return {
    totalCount: total,
    returningCount: returning.length,
    newCount,
    atRiskCount: atRisk.length,
    repeatRatePct: total ? Math.round((returning.length / total) * 100) : 0,
    churnRatePct: total ? Math.round((atRisk.length / total) * 100) : 0,
    avgLtvAmount: total ? ltvSum.div(total).toDecimalPlaces(0).toFixed(0) : '0',
    atRiskName: atRisk[0]?.displayName ?? null,
  };
}

/** Tier rule: >= VIP threshold => vip, > 0 => active, 0 => lead. */
export function deriveTier(lifetimeValueAmount: string): 'vip' | 'active' | 'lead' {
  if (compareDecimalStrings(lifetimeValueAmount, String(LTV_TIER_THRESHOLDS.vip)) >= 0) return 'vip';
  if (compareDecimalStrings(lifetimeValueAmount, '0') > 0) return 'active';
  return 'lead';
}

export function buildCrmReportsSummary(input: CrmReportsInput, now: Date): CrmReportsSummary {
  const counts = new Map<CrmConversationStatus, number>();
  for (const row of input.statusCounts) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + row.count);
  }

  const total = input.statusCounts.reduce((sum, row) => sum + row.count, 0);
  const resolved = counts.get('RESOLVED') ?? 0;
  const durationSum = input.respondedDurationsMin.reduce((sum, minutes) => sum + minutes, 0);

  return {
    total,
    resolved,
    resolvedRate: total ? Math.round((resolved / total) * 100) : 0,
    avgResponseMin: input.respondedDurationsMin.length
      ? Math.round(durationSum / input.respondedDurationsMin.length)
      : null,
    overdue: input.overdue,
    statusBreakdown: REPORT_STATUS_ORDER.map((status) => {
      const count = counts.get(status) ?? 0;
      return { status, count, pct: total ? Math.round((count / total) * 100) : 0 };
    }),
    staffPerformance: input.staff
      .map((row, index) => ({
        ...row,
        rate: row.assigned ? Math.round((row.resolved / row.assigned) * 100) : 0,
        index,
      }))
      .sort((a, b) => b.assigned - a.assigned || a.index - b.index)
      .map(({ index: _index, ...row }) => row),
    topCustomers: input.customers
      .filter((customer) => compareDecimalStrings(customer.lifetimeValueAmount, '0') > 0)
      .sort((a, b) => compareDecimalStrings(b.lifetimeValueAmount, a.lifetimeValueAmount))
      .slice(0, 5)
      .map(({ paymentCount: _paymentCount, latestPaidAt: _latestPaidAt, ...customer }) => ({
        ...customer,
        tier: deriveTier(customer.lifetimeValueAmount),
      })),
    retention: buildRetention(input.customers, now),
    branchId: input.branchId,
  };
}

function compareDecimalStrings(a: string, b: string): number {
  const left = parseDecimalString(a);
  const right = parseDecimalString(b);
  if (left.negative !== right.negative) return left.negative ? -1 : 1;
  const sign = left.negative ? -1 : 1;
  const intCompare = compareDigitStrings(left.integer, right.integer);
  if (intCompare !== 0) return intCompare * sign;
  const maxFrac = Math.max(left.fraction.length, right.fraction.length);
  return compareDigitStrings(left.fraction.padEnd(maxFrac, '0'), right.fraction.padEnd(maxFrac, '0')) * sign;
}

function parseDecimalString(value: string): { negative: boolean; integer: string; fraction: string } {
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid decimal string: ${value}`);
  const integer = stripLeadingZeros(match[2]);
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  return {
    negative: match[1] === '-' && (integer !== '0' || fraction.length > 0),
    integer,
    fraction,
  };
}

function compareDigitStrings(a: string, b: string): number {
  const left = stripLeadingZeros(a);
  const right = stripLeadingZeros(b);
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function stripLeadingZeros(value: string): string {
  return value.replace(/^0+/, '') || '0';
}
