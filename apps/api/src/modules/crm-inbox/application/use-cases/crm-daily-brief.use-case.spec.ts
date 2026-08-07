import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrmDailyBriefUseCase } from './crm-daily-brief.use-case';

const ctx = {
  companyId: 'co-1',
  userId: 'owner-1',
  roles: ['OWNER'],
  permissions: ['crm.inbox.read', 'crm.opportunity.read', 'accounting.document.read'],
  scopes: {},
} as any;

const fixedNow = new Date('2026-07-09T02:00:00.000Z');

describe('CrmDailyBriefUseCase (A8)', () => {
  it('gathers real source rows and returns all ten deep-linked widgets', async () => {
    const calls: Record<string, any[]> = { conversations: [], counterparties: [], opportunities: [], documents: [] };
    const repo = {
      countUnansweredConversations: async () => 3,
      countOpenSlaBreaches: async () => 1,
      countPaymentProofs: async () => 4,
      reportsCustomersWithCounterparty: async (companyId: string) => {
        calls.counterparties.push(companyId);
        return [{ id: 'cust-1', displayName: 'A', accountingCounterpartyId: 'cp-1' }];
      },
      listConversations: async (companyId: string, filter: any) => {
        calls.conversations.push({ companyId, filter });
        const items = [
          { id: 'c1', status: 'OPEN', tags: ['Complaint'], createdAt: new Date('2026-07-08T18:00:00.000Z'), firstRespondedAt: new Date('2026-07-08T18:10:00.000Z') },
          { id: 'c2', status: 'WAITING_INTERNAL', tags: ['escalation'], createdAt: new Date('2026-07-09T00:00:00.000Z'), firstRespondedAt: new Date('2026-07-09T00:50:00.000Z') },
          { id: 'c3', status: 'RESOLVED', tags: ['complaint'], createdAt: new Date('2026-07-08T19:00:00.000Z'), firstRespondedAt: null },
          { id: 'c4', status: 'OPEN', tags: [], createdAt: new Date('2026-07-07T18:00:00.000Z'), firstRespondedAt: new Date('2026-07-07T18:20:00.000Z') },
        ];
        return { items, total: items.length };
      },
    } as any;
    const crmRepo = {
      countCustomersSince: async () => 5,
      countCustomersBetween: async () => 5,
      countBookingsBetween: async () => 2,
      listOpportunities: async (filter: any) => {
        calls.opportunities.push(filter);
        return [{ amountEstimate: '100.2500' }, { amountEstimate: '200.7500' }];
      },
    } as any;
    const listDocuments = {
      execute: async (_ctx: any, filter: any) => {
        calls.documents.push(filter);
        const data = [
          { documentType: 'QUOTATION', grandTotalAmount: '1000.5000', outstandingAmount: '0', counterpartyId: 'cp-1' },
          { documentType: 'QUOTATION', grandTotalAmount: '499.5000', outstandingAmount: '0', counterpartyId: 'cp-1' },
          { documentType: 'INVOICE', grandTotalAmount: '200', outstandingAmount: '200.0000', counterpartyId: 'cp-1', dueDate: new Date('2026-07-08T00:00:00.000Z') },
          { documentType: 'BILLING_NOTE', grandTotalAmount: '900', outstandingAmount: '900.0000', counterpartyId: 'cp-not-linked', dueDate: new Date('2026-07-08T00:00:00.000Z') },
          { documentType: 'INVOICE', grandTotalAmount: '300', outstandingAmount: '300.0000', counterpartyId: 'cp-1', dueDate: new Date('2026-07-10T00:00:00.000Z') },
          { documentType: 'DEBIT_NOTE', grandTotalAmount: '50', outstandingAmount: '0.0000', counterpartyId: 'cp-1', dueDate: new Date('2026-07-08T00:00:00.000Z') },
        ];
        return { data, total: data.length, page: 1, pageSize: 100 };
      },
    } as any;

    const result = await new CrmDailyBriefUseCase(repo, crmRepo, listDocuments).execute(ctx, {}, fixedNow);
    assert.equal(result.generatedAt, fixedNow.toISOString());
    const by = Object.fromEntries(result.widgets.map((w) => [w.key, w.value]));
    assert.deepEqual(by, {
      unanswered: 3,
      sla_breaches: 1,
      new_customers_today: 5,
      appointments_today: 2,
      payment_proofs: 4,
      open_deals: 301,
      quotations_awaiting_acceptance: 1500,
      overdue_payments: 200,
      unresolved_complaints: 2,
      average_first_response_today: 30,
    });
    const widgets = Object.fromEntries(result.widgets.map((widget) => [widget.key, widget]));
    assert.deepEqual(
      { count: widgets['open_deals'].count, amount: widgets['open_deals'].amount },
      { count: 2, amount: '301.0000' },
    );
    assert.deepEqual(
      { count: widgets['quotations_awaiting_acceptance'].count, amount: widgets['quotations_awaiting_acceptance'].amount },
      { count: 2, amount: '1500.0000' },
    );
    assert.deepEqual(
      { count: widgets['overdue_payments'].count, amount: widgets['overdue_payments'].amount },
      { count: 1, amount: '200.0000' },
    );
    assert.deepEqual(calls.opportunities, [{ companyId: 'co-1', ownerUserId: undefined, status: 'OPEN' }]);
    assert.deepEqual(calls.documents, [{ status: 'ISSUED', page: 1, pageSize: 100 }]);
    assert.deepEqual(calls.counterparties, ['co-1']);
    assert.equal(calls.conversations[0].filter.scopeUserId, undefined);
  });

  it('does not query or expose sales/finance aggregates without their read permissions', async () => {
    const repo = {
      countUnansweredConversations: async () => 0,
      countOpenSlaBreaches: async () => 0,
      countPaymentProofs: async () => 0,
      reportsCustomersWithCounterparty: async () => { throw new Error('must not query accounting bridge'); },
      listConversations: async () => ({ items: [], total: 0 }),
    } as any;
    const crmRepo = {
      countCustomersSince: async () => 0,
      countCustomersBetween: async () => 0,
      countBookingsBetween: async () => 0,
      listOpportunities: async () => { throw new Error('must not query deals'); },
    } as any;
    const listDocuments = { execute: async () => { throw new Error('must not query documents'); } } as any;

    const result = await new CrmDailyBriefUseCase(repo, crmRepo, listDocuments).execute({
      ...ctx,
      roles: ['SALES'],
      permissions: ['crm.inbox.read'],
    }, {}, fixedNow);
    const keys = result.widgets.map((widget) => widget.key);
    assert.equal(keys.includes('open_deals'), false);
    assert.equal(keys.includes('quotations_awaiting_acceptance'), false);
    assert.equal(keys.includes('overdue_payments'), false);
  });

  it('intersects every customer-derived aggregate with owner and branch scope', async () => {
    const seen: Record<string, any[]> = {
      inboxCounts: [],
      proof: [],
      customerCounts: [],
      bookingCounts: [],
      conversations: [],
      opportunities: [],
      counterparties: [],
    };
    const repo = {
      countUnansweredConversations: async (_companyId: string, scope: any) => { seen.inboxCounts.push(scope); return 1; },
      countOpenSlaBreaches: async (_companyId: string, scope: any) => { seen.inboxCounts.push(scope); return 1; },
      countPaymentProofs: async (...args: any[]) => { seen.proof.push(args); return 1; },
      reportsCustomersWithCounterparty: async (...args: any[]) => {
        seen.counterparties.push(args);
        return [{ id: 'cust-allowed', displayName: 'Allowed', accountingCounterpartyId: 'cp-allowed' }];
      },
      listConversations: async (_companyId: string, filter: any) => {
        seen.conversations.push(filter);
        return { items: [], total: 0 };
      },
    } as any;
    const crmRepo = {
      countCustomersBetween: async (...args: any[]) => { seen.customerCounts.push(args); return 1; },
      countBookingsBetween: async (...args: any[]) => { seen.bookingCounts.push(args); return 1; },
      listOpportunities: async (filter: any) => {
        seen.opportunities.push(filter);
        return [{ amountEstimate: '100.0000' }];
      },
    } as any;
    const listDocuments = {
      execute: async () => ({
        data: [
          { documentType: 'QUOTATION', grandTotalAmount: '10', outstandingAmount: '0', counterpartyId: 'cp-allowed' },
          { documentType: 'QUOTATION', grandTotalAmount: '999', outstandingAmount: '0', counterpartyId: 'cp-denied' },
          { documentType: 'INVOICE', grandTotalAmount: '20', outstandingAmount: '20', counterpartyId: 'cp-allowed', dueDate: new Date('2026-07-08T00:00:00.000Z') },
          { documentType: 'INVOICE', grandTotalAmount: '888', outstandingAmount: '888', counterpartyId: 'cp-denied', dueDate: new Date('2026-07-08T00:00:00.000Z') },
        ],
        total: 4,
        page: 1,
        pageSize: 100,
      }),
    } as any;

    const result = await new CrmDailyBriefUseCase(repo, crmRepo, listDocuments).execute({
      ...ctx,
      userId: 'sales-1',
      roles: ['SALES'],
      scopes: { branchIds: ['branch-allowed'] },
    }, {}, fixedNow);

    const expectedScope = { ownerUserId: 'sales-1', branchIds: ['branch-allowed'] };
    assert.deepEqual(seen.inboxCounts, [expectedScope, expectedScope]);
    assert.deepEqual(seen.proof[0].slice(0, 3), ['co-1', 'crm_conversation', 'payment_proof']);
    assert.deepEqual(seen.proof[0][3], expectedScope);
    assert.deepEqual(seen.customerCounts[0][3], expectedScope);
    assert.deepEqual(seen.bookingCounts[0][3], expectedScope);
    assert.deepEqual(seen.opportunities, [{ companyId: 'co-1', ownerUserId: 'sales-1', branchIds: ['branch-allowed'], status: 'OPEN' }]);
    assert.deepEqual(seen.counterparties, [['co-1', undefined, 'sales-1', ['branch-allowed']]]);
    assert.deepEqual(seen.conversations, [{
      scopeUserId: 'sales-1',
      customerOwnerUserId: 'sales-1',
      customerBranchIds: ['branch-allowed'],
      page: 1,
      pageSize: 100,
    }]);
    const widgets = Object.fromEntries(result.widgets.map((widget) => [widget.key, widget]));
    assert.equal(widgets['quotations_awaiting_acceptance'].count, 1);
    assert.equal(widgets['quotations_awaiting_acceptance'].amount, '10.0000');
    assert.equal(widgets['overdue_payments'].count, 1);
    assert.equal(widgets['overdue_payments'].amount, '20.0000');
  });

  it('scopes dated widgets to the selected period (7-day window + period label)', async () => {
    const windows: Array<{ start: Date; end: Date }> = [];
    const repo = {
      countUnansweredConversations: async () => 1,
      countOpenSlaBreaches: async () => 0,
      countPaymentProofs: async () => 0,
      listConversations: async () => ({ items: [], total: 0 }),
    } as any;
    const crmRepo = {
      countCustomersBetween: async (_c: string, start: Date, end: Date) => { windows.push({ start, end }); return 12; },
      countBookingsBetween: async () => 3,
    } as any;
    const listDocuments = { execute: async () => ({ data: [], total: 0, page: 1, pageSize: 100 }) } as any;

    const result = await new CrmDailyBriefUseCase(repo, crmRepo, listDocuments).execute(
      { ...ctx, permissions: ['crm.inbox.read'] },
      { periodKind: 'week' },
      fixedNow,
    );
    // 7-day window ends at the Bangkok day-end and spans exactly 7 days.
    const span = windows[0].end.getTime() - windows[0].start.getTime();
    assert.equal(Math.round(span / 86_400_000), 7);
    const newCustomers = result.widgets.find((w) => w.key === 'new_customers_today');
    assert.equal(newCustomers?.value, 12);
    assert.equal(newCustomers?.label, 'ลูกค้าใหม่7 วัน');
    assert.equal(
      result.widgets.find((w) => w.key === 'average_first_response_today')?.href,
      '/companies/co-1/crm-reports?period=week',
    );
  });
});
