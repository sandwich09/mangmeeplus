import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { GetCrmReportsSummaryUseCase } from './crm-reports-summary.use-case';

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'u-1', companyId: 'co-1',
    membershipId: 'm-1', roles: ['OWNER'], permissions: ['crm.report.read'], scopes: {}, authProvider: 'dev',
    ...overrides,
  } as any;
}

type CustomerRow = {
  id: string;
  companyId: string;
  branchId?: string | null;
  displayName: string;
  accountingCounterpartyId?: string | null;
  status?: string;
  tier?: 'VIP' | 'ACTIVE' | 'LEAD';
  leadScore?: number | null;
  lifetimeValueAmount?: string;
  ownerUserId?: string | null;
};
type ConversationRow = {
  companyId: string;
  customerId: string;
  status: string;
  createdAt?: Date;
  firstRespondedAt?: Date | null;
  firstResponseDueAt?: Date | null;
  assignedToUserId?: string | null;
};
type PaymentRow = {
  companyId: string;
  counterpartyId?: string | null;
  amount: string;
  direction: 'RECEIVED' | 'PAID';
  status: 'DRAFT' | 'RECORDED' | 'VOIDED';
  paidAt: Date;
};

function makeUseCase(data: {
  customers?: CustomerRow[];
  conversations?: ConversationRow[];
  payments?: PaymentRow[];
  users?: Record<string, string>;
  paymentQueries?: string[][];
}) {
  const customers = data.customers ?? [];
  const conversations = data.conversations ?? [];
  const payments = data.payments ?? [];
  const scopedConversations = (companyId: string, customerIds?: string[]) =>
    conversations.filter((row) => row.companyId === companyId && (!customerIds || customerIds.includes(row.customerId)));

  const repo = {
    reportsBranchCustomerIds: async (companyId: string, branchId?: string, ownerUserId?: string) =>
      customers.filter((row) =>
        row.companyId === companyId &&
        (!branchId || row.branchId === branchId) &&
        (!ownerUserId || row.ownerUserId === ownerUserId),
      ).map((row) => row.id),
    reportsStatusCounts: async (companyId: string, customerIds?: string[]) => {
      const counts = new Map<string, number>();
      for (const row of scopedConversations(companyId, customerIds).filter((c) => c.status !== 'SPAM')) {
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
      }
      return [...counts.entries()].map(([status, count]) => ({ status, count }));
    },
    reportsOverdueCount: async (companyId: string, customerIds: string[] | undefined, now: Date) =>
      scopedConversations(companyId, customerIds).filter((row) =>
        row.status !== 'RESOLVED' && row.status !== 'SPAM' && !row.firstRespondedAt && !!row.firstResponseDueAt && row.firstResponseDueAt < now,
      ).length,
    reportsRespondedDurationsMin: async (companyId: string, customerIds?: string[]) =>
      scopedConversations(companyId, customerIds)
        .filter((row) => row.status !== 'SPAM' && row.firstRespondedAt && row.createdAt)
        .map((row) => Math.max(0, Math.round((row.firstRespondedAt!.getTime() - row.createdAt!.getTime()) / 60000))),
    reportsStaff: async (companyId: string, customerIds?: string[]) => {
      const byUser = new Map<string | null, { userId: string | null; assigned: number; resolved: number }>();
      for (const row of scopedConversations(companyId, customerIds).filter((c) => c.status !== 'SPAM')) {
        const userId = row.assignedToUserId ?? null;
        const current = byUser.get(userId) ?? { userId, assigned: 0, resolved: 0 };
        current.assigned += 1;
        if (row.status === 'RESOLVED') current.resolved += 1;
        byUser.set(userId, current);
      }
      return [...byUser.values()];
    },
    reportsCustomersWithCounterparty: async (companyId: string, branchId?: string, ownerUserId?: string) =>
      customers
        .filter((row) =>
          row.companyId === companyId &&
          row.accountingCounterpartyId &&
          !['ARCHIVED', 'MERGED'].includes(row.status ?? 'ACTIVE') &&
          (!branchId || row.branchId === branchId) &&
          (!ownerUserId || row.ownerUserId === ownerUserId),
        )
        .map((row) => ({ id: row.id, displayName: row.displayName, accountingCounterpartyId: row.accountingCounterpartyId! })),
    userDisplayNames: async (userIds: string[]) => new Map(userIds.map((id) => [id, data.users?.[id] ?? id])),
  } as any;

  const sumReceivedPayments = {
    execute: async (runCtx: any, counterpartyIds: string[]) => {
      data.paymentQueries?.push(counterpartyIds);
      const totals = new Map<string, { amount: number; paymentCount: number; latestPaidAt: Date }>();
      for (const payment of payments) {
        if (
          payment.companyId === runCtx.companyId &&
          payment.counterpartyId &&
          counterpartyIds.includes(payment.counterpartyId) &&
          payment.direction === 'RECEIVED' &&
          payment.status === 'RECORDED'
        ) {
          const current = totals.get(payment.counterpartyId);
          totals.set(payment.counterpartyId, {
            amount: (current?.amount ?? 0) + Number(payment.amount),
            paymentCount: (current?.paymentCount ?? 0) + 1,
            latestPaidAt: !current || payment.paidAt > current.latestPaidAt ? payment.paidAt : current.latestPaidAt,
          });
        }
      }
      return [...totals.entries()].map(([counterpartyId, aggregate]) => ({
        counterpartyId,
        amount: aggregate.amount.toFixed(4),
        paymentCount: aggregate.paymentCount,
        latestPaidAt: aggregate.latestPaidAt,
      }));
    },
  } as any;

  return new GetCrmReportsSummaryUseCase(repo, sumReceivedPayments);
}

describe('GetCrmReportsSummaryUseCase', () => {
  it('denies callers without crm.report.read', async () => {
    await assert.rejects(() => makeUseCase({}).execute(ctx({ permissions: [] })), ForbiddenException);
  });

  it('keeps LTV company-scoped when another company has payments for the same counterparty', async () => {
    const result = await makeUseCase({
      customers: [{ id: 'cust-1', companyId: 'co-1', branchId: 'b-1', displayName: 'Customer One', accountingCounterpartyId: 'cp-1' }],
      conversations: [{ companyId: 'co-1', customerId: 'cust-1', status: 'OPEN', assignedToUserId: 'u-1' }],
      payments: [{ companyId: 'co-2', counterpartyId: 'cp-1', amount: '999.00', direction: 'RECEIVED', status: 'RECORDED', paidAt: new Date() }],
    }).execute(ctx());

    assert.equal(result.total, 1);
    assert.deepEqual(result.topCustomers, []);
  });

  it('changes report numbers when branchId changes', async () => {
    const uc = makeUseCase({
      customers: [
        { id: 'cust-b1', companyId: 'co-1', branchId: 'b-1', displayName: 'Branch One', accountingCounterpartyId: 'cp-b1' },
        { id: 'cust-b2', companyId: 'co-1', branchId: 'b-2', displayName: 'Branch Two', accountingCounterpartyId: 'cp-b2' },
      ],
      conversations: [
        { companyId: 'co-1', customerId: 'cust-b1', status: 'OPEN', assignedToUserId: 'u-1' },
        { companyId: 'co-1', customerId: 'cust-b1', status: 'NEW', assignedToUserId: null },
        { companyId: 'co-1', customerId: 'cust-b2', status: 'RESOLVED', assignedToUserId: 'u-2' },
      ],
      payments: [
        { companyId: 'co-1', counterpartyId: 'cp-b1', amount: '100.00', direction: 'RECEIVED', status: 'RECORDED', paidAt: new Date() },
        { companyId: 'co-1', counterpartyId: 'cp-b2', amount: '200.00', direction: 'RECEIVED', status: 'RECORDED', paidAt: new Date() },
      ],
    });

    const b1 = await uc.execute(ctx(), { branchId: 'b-1' });
    const b2 = await uc.execute(ctx(), { branchId: 'b-2' });

    assert.equal(b1.branchId, 'b-1');
    assert.equal(b2.branchId, 'b-2');
    assert.equal(b1.total, 2);
    assert.equal(b2.total, 1);
    assert.equal(b1.resolvedRate, 0);
    assert.equal(b2.resolvedRate, 100);
    assert.equal(b1.topCustomers[0]?.customerId, 'cust-b1');
    assert.equal(b2.topCustomers[0]?.customerId, 'cust-b2');
  });

  it('sums only RECORDED RECEIVED payments and derives the top-customer tier', async () => {
    const result = await makeUseCase({
      customers: [{ id: 'cust-vip', companyId: 'co-1', displayName: 'VIP Customer', accountingCounterpartyId: 'cp-vip' }],
      payments: [
        { companyId: 'co-1', counterpartyId: 'cp-vip', amount: '25000.00', direction: 'RECEIVED', status: 'RECORDED', paidAt: new Date() },
        { companyId: 'co-1', counterpartyId: 'cp-vip', amount: '26000.00', direction: 'RECEIVED', status: 'RECORDED', paidAt: new Date() },
        { companyId: 'co-1', counterpartyId: 'cp-vip', amount: '10000.00', direction: 'RECEIVED', status: 'VOIDED', paidAt: new Date() },
        { companyId: 'co-1', counterpartyId: 'cp-vip', amount: '5000.00', direction: 'RECEIVED', status: 'DRAFT', paidAt: new Date() },
        { companyId: 'co-1', counterpartyId: 'cp-vip', amount: '3000.00', direction: 'PAID', status: 'RECORDED', paidAt: new Date() },
      ],
    }).execute(ctx());

    assert.equal(result.topCustomers[0]?.customerId, 'cust-vip');
    assert.equal(result.topCustomers[0]?.lifetimeValueAmount, '51000.0000');
    assert.equal(result.topCustomers[0]?.tier, 'vip');
  });

  it('excludes customers without an accounting counterparty from top customers', async () => {
    const result = await makeUseCase({
      customers: [
        { id: 'cust-null', companyId: 'co-1', displayName: 'No Link', accountingCounterpartyId: null },
        { id: 'cust-linked', companyId: 'co-1', displayName: 'Linked', accountingCounterpartyId: 'cp-linked' },
      ],
      payments: [{ companyId: 'co-1', counterpartyId: 'cp-linked', amount: '10.00', direction: 'RECEIVED', status: 'RECORDED', paidAt: new Date() }],
    }).execute(ctx());

    assert.deepEqual(result.topCustomers.map((customer) => customer.customerId), ['cust-linked']);
  });

  it('derives retention only from one scoped RECORDED RECEIVED payment aggregate', async () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const paymentQueries: string[][] = [];
    const paidAt = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY_MS);
    const result = await makeUseCase({
      paymentQueries,
      customers: [
        { id: 'new', companyId: 'co-1', displayName: 'New Recent', accountingCounterpartyId: 'cp-new', tier: 'VIP', leadScore: 1, lifetimeValueAmount: '999999' },
        { id: 'returning', companyId: 'co-1', displayName: 'Returning Recent', accountingCounterpartyId: 'cp-returning', tier: 'LEAD', leadScore: 99, lifetimeValueAmount: '0' },
        { id: 'alpha', companyId: 'co-1', displayName: 'Alpha', accountingCounterpartyId: 'cp-alpha', tier: 'LEAD', leadScore: 99, lifetimeValueAmount: '0' },
        { id: 'zulu', companyId: 'co-1', displayName: 'Zulu', accountingCounterpartyId: 'cp-zulu', tier: 'LEAD', leadScore: 99, lifetimeValueAmount: '0' },
        { id: 'lower', companyId: 'co-1', displayName: 'Lower LTV', accountingCounterpartyId: 'cp-lower', tier: 'VIP', leadScore: 1, lifetimeValueAmount: '999999' },
        { id: 'unpaid', companyId: 'co-1', displayName: 'Unpaid Proxy VIP', accountingCounterpartyId: 'cp-unpaid', tier: 'VIP', leadScore: 1, lifetimeValueAmount: '999999' },
      ],
      payments: [
        { companyId: 'co-1', counterpartyId: 'cp-new', amount: '100', direction: 'RECEIVED', status: 'RECORDED', paidAt: paidAt(89) },
        { companyId: 'co-1', counterpartyId: 'cp-returning', amount: '200', direction: 'RECEIVED', status: 'RECORDED', paidAt: paidAt(120) },
        { companyId: 'co-1', counterpartyId: 'cp-returning', amount: '301', direction: 'RECEIVED', status: 'RECORDED', paidAt: paidAt(89) },
        { companyId: 'co-1', counterpartyId: 'cp-alpha', amount: '100', direction: 'RECEIVED', status: 'RECORDED', paidAt: paidAt(120) },
        { companyId: 'co-1', counterpartyId: 'cp-alpha', amount: '201', direction: 'RECEIVED', status: 'RECORDED', paidAt: paidAt(91) },
        { companyId: 'co-1', counterpartyId: 'cp-zulu', amount: '150', direction: 'RECEIVED', status: 'RECORDED', paidAt: paidAt(120) },
        { companyId: 'co-1', counterpartyId: 'cp-zulu', amount: '151', direction: 'RECEIVED', status: 'RECORDED', paidAt: paidAt(91) },
        { companyId: 'co-1', counterpartyId: 'cp-lower', amount: '300', direction: 'RECEIVED', status: 'RECORDED', paidAt: paidAt(91) },
        { companyId: 'co-1', counterpartyId: 'cp-unpaid', amount: '10000', direction: 'RECEIVED', status: 'VOIDED', paidAt: paidAt(200) },
        { companyId: 'co-1', counterpartyId: 'cp-unpaid', amount: '10000', direction: 'PAID', status: 'RECORDED', paidAt: paidAt(200) },
      ],
    }).execute(ctx());

    assert.equal(paymentQueries.length, 1);
    assert.deepEqual(result.retention, {
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

  it('rejects a requested branch outside ctx.scopes.branchIds', async () => {
    await assert.rejects(
      () => makeUseCase({}).execute(ctx({ scopes: { branchIds: ['b-allowed'] } }), { branchId: 'b-denied' }),
      ForbiddenException,
    );
  });

  it('returns aggregate-only exact projection for MARKETING without customer/staff identifiers or names', async () => {
    const result = await makeUseCase({
      customers: [{ id: 'cust-secret', companyId: 'co-1', displayName: 'Secret Customer', accountingCounterpartyId: 'cp-1' }],
      conversations: [{ companyId: 'co-1', customerId: 'cust-secret', status: 'RESOLVED', assignedToUserId: 'staff-secret' }],
      payments: [
        { companyId: 'co-1', counterpartyId: 'cp-1', amount: '50000', direction: 'RECEIVED', status: 'RECORDED', paidAt: new Date(Date.now() - 100 * 86_400_000) },
      ],
      users: { 'staff-secret': 'Secret Staff' },
    }).execute(ctx({ roles: ['MARKETING'] }));

    assert.deepEqual(Object.keys(result).sort(), [
      'avgResponseMin', 'branchId', 'overdue', 'resolved', 'resolvedRate', 'retention',
      'staffPerformance', 'statusBreakdown', 'topCustomers', 'total',
    ]);
    assert.deepEqual(result.topCustomers, []);
    assert.deepEqual(result.staffPerformance, []);
    assert.equal(result.retention?.atRiskName, null);
    const wire = JSON.stringify(result);
    for (const secret of ['cust-secret', 'Secret Customer', 'staff-secret', 'Secret Staff']) assert.equal(wire.includes(secret), false);
  });

  it('keeps FINANCE and ACCOUNTANT on aggregate-only CRM report fields', async () => {
    for (const role of ['FINANCE', 'ACCOUNTANT']) {
      const result = await makeUseCase({
        customers: [{ id: 'cust-fin', companyId: 'co-1', displayName: 'Finance Customer', accountingCounterpartyId: 'cp-fin' }],
        payments: [{ companyId: 'co-1', counterpartyId: 'cp-fin', amount: '51000', direction: 'RECEIVED', status: 'RECORDED', paidAt: new Date() }],
      }).execute(ctx({ roles: [role] }));
      assert.deepEqual(result.topCustomers, []);
      assert.deepEqual(result.staffPerformance, []);
      assert.equal(JSON.stringify(result).includes('Finance Customer'), false);
    }
  });

  it('scopes SALES report details to explicitly owned customers', async () => {
    const result = await makeUseCase({
      customers: [
        { id: 'mine', companyId: 'co-1', displayName: 'Mine', accountingCounterpartyId: 'cp-mine', ownerUserId: 'u-1' },
        { id: 'other', companyId: 'co-1', displayName: 'Other', accountingCounterpartyId: 'cp-other', ownerUserId: 'u-2' },
      ],
      conversations: [
        { companyId: 'co-1', customerId: 'mine', status: 'OPEN', assignedToUserId: 'u-1' },
        { companyId: 'co-1', customerId: 'other', status: 'RESOLVED', assignedToUserId: 'u-2' },
      ],
      payments: [
        { companyId: 'co-1', counterpartyId: 'cp-mine', amount: '100', direction: 'RECEIVED', status: 'RECORDED', paidAt: new Date() },
        { companyId: 'co-1', counterpartyId: 'cp-other', amount: '999', direction: 'RECEIVED', status: 'RECORDED', paidAt: new Date() },
      ],
    }).execute(ctx({ roles: ['SALES'] }));

    assert.equal(result.total, 1);
    assert.deepEqual(result.topCustomers.map((customer) => customer.customerId), ['mine']);
    assert.equal(JSON.stringify(result).includes('Other'), false);
  });
});
