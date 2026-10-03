import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrmDailyBriefUseCase } from './crm-daily-brief.use-case';
import { ListCrmConversationsUseCase } from './crm-conversation.use-case';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';

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
      conversationCounts: async () => ({ overdueCount: 1, unansweredCount: 3 }),
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
      conversationCounts: async () => ({ overdueCount: 0, unansweredCount: 0 }),
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

  it('keeps customer aggregates scoped and counts unanswered and overdue with inbox visibility', async () => {
    const seen: Record<string, any[]> = {
      overdueCounts: [],
      proof: [],
      customerCounts: [],
      bookingCounts: [],
      conversations: [],
      opportunities: [],
      counterparties: [],
    };
    const repo = {
      conversationCounts: async (...args: any[]) => { seen.overdueCounts.push(args); return { overdueCount: 1, unansweredCount: 1 }; },
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
    // One inbox count call, in the inbox's own assignment scope, gives both inbox cards.
    assert.deepEqual(seen.overdueCounts, [['co-1', 'sales-1', 'sales-1', fixedNow]]);
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
      conversationCounts: async () => ({ overdueCount: 0, unansweredCount: 1 }),
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

// Evaluate only the Prisma where operators used by these conversation queries.
// This exercises the real repository's predicate; it is not a PostgreSQL test.
function matchesWhere(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND') return value.every((part: any) => matchesWhere(row, part));
    if (key === 'OR') return value.some((part: any) => matchesWhere(row, part));
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      if ('not' in value) return row[key] !== value.not;
      if ('notIn' in value) return !value.notIn.includes(row[key]);
      if ('in' in value) return value.in.includes(row[key]);
      if ('lt' in value) return row[key] !== null && row[key] < value.lt;
      return matchesWhere(row[key], value);
    }
    return row[key] === value;
  });
}

describe('daily-brief overdue card matches the real inbox predicate and visibility', () => {
  const past = new Date(fixedNow.getTime() - 60_000);
  const future = new Date(fixedNow.getTime() + 60_000);
  const row = {
    id: 'conv-1', companyId: 'co-1', customerId: 'cust-1', status: 'OPEN', tagsJson: [],
    assignedToUserId: null, firstRespondedAt: null, firstResponseDueAt: past, slaBreachedAt: null,
    createdAt: past, updatedAt: past,
    customer: { ownerUserId: 'other-user', branchId: 'other-branch' },
  };

  async function checkCard(rows: any[], viewer: any, expectedIds: string[]) {
    const selected = (where: any) => rows.filter((item) => matchesWhere(item, where));
    const countWheres: any[] = [];
    let listWhere: any;
    const repo = new PrismaCrmInboxRepository({ client: { crmConversation: {
      count: async ({ where }: any) => { countWheres.push(where); return selected(where).length; },
      findMany: async ({ where }: any) => { listWhere = where; return selected(where); },
      groupBy: async () => [],
    } } } as any);
    repo.countPaymentProofs = async () => 0;
    const crmRepo = { countCustomersBetween: async () => 0, countBookingsBetween: async () => 0 } as any;
    const brief = await new CrmDailyBriefUseCase(repo, crmRepo, {} as any).execute(
      { ...viewer, permissions: ['crm.inbox.read'] }, {}, fixedNow,
    );
    const scopeUserId = ['OWNER', 'MANAGER', 'COMPANY_VIEW'].some((role) => viewer.roles.includes(role))
      ? undefined : viewer.userId;
    const list = await repo.listConversations(viewer.companyId, {
      overdue: true, scopeUserId, page: 1, pageSize: 100,
    }, fixedNow);
    assert.deepEqual(list.items.map((item) => item.id), expectedIds);
    const widget = brief.widgets.find((item) => item.key === 'sla_breaches')!;
    assert.equal(widget.value, expectedIds.length);
    assert.equal(widget.value, list.total);
    assert.equal(widget.severity, expectedIds.length ? 'critical' : 'info');
    assert.equal(widget.href, '/companies/co-1/inbox?overdue=true');
    // Pin the deadline instant and absence of scan/customer predicates in the chip query.
    assert.deepEqual(countWheres.find((where) => 'firstResponseDueAt' in where), {
      companyId: viewer.companyId,
      ...(scopeUserId ? { OR: [{ assignedToUserId: scopeUserId }, { assignedToUserId: null }] } : {}),
      status: listWhere.status, firstRespondedAt: null, firstResponseDueAt: { lt: fixedNow },
    });
  }

  it('counts an unscanned overdue chat and excludes not-yet-due, undated, resolved and spam chats', async () => {
    await checkCard([
      row,
      { ...row, id: 'at-deadline', firstResponseDueAt: fixedNow },
      { ...row, id: 'future', firstResponseDueAt: future },
      { ...row, id: 'undated', firstResponseDueAt: null },
      { ...row, id: 'resolved', status: 'RESOLVED' },
      { ...row, id: 'spam', status: 'SPAM' },
    ], ctx, ['conv-1']);
  });

  it('excludes a scanned overdue chat after its first reply even while still open', async () => {
    await checkCard([{
      ...row, status: 'WAITING_CUSTOMER',
      slaBreachedAt: new Date(fixedNow.getTime() - 30_000), firstRespondedAt: fixedNow,
    }], ctx, []);
  });

  for (const roles of [['SALES'], ['OWNER'], ['MANAGER'], ['COMPANY_VIEW']]) {
    it(`matches inbox assignment visibility for ${roles[0]} regardless of customer owner and branch`, async () => {
      const viewer = { ...ctx, userId: 'sales-1', roles, scopes: { branchIds: ['branch-allowed'] } };
      const scanned = { ...row, slaBreachedAt: past };
      await checkCard([
        { ...scanned, id: 'assigned-to-self', assignedToUserId: viewer.userId },
        { ...scanned, id: 'unassigned' },
        { ...scanned, id: 'assigned-to-other', assignedToUserId: 'other-user', customer: { ownerUserId: viewer.userId, branchId: 'branch-allowed' } },
        { ...scanned, id: 'other-company', companyId: 'co-2' },
      ], viewer, roles[0] === 'SALES'
        ? ['assigned-to-self', 'unassigned']
        : ['assigned-to-self', 'unassigned', 'assigned-to-other']);
    });
  }
});

// Browser check 2026-10-03: the card "ยังไม่ได้ตอบ" counted chats by their CUSTOMER's owner and branch and opened the whole
// inbox, which is scoped by assignment: an owner read 7 and found 14 chats, a salesperson read 0 beside 3 unanswered chats,
// a manager 0 beside 14. The card now counts the inbox's own unanswered list for the same viewer and links to it.
describe('daily-brief unanswered card counts the rows of the inbox list it opens, for the same viewer', () => {
  const past = new Date(fixedNow.getTime() - 60_000);
  const future = new Date(fixedNow.getTime() + 60_000);
  const row = {
    id: 'waiting', companyId: 'co-1', customerId: 'cust-1', status: 'OPEN', tagsJson: [],
    assignedToUserId: null, firstRespondedAt: null, firstResponseDueAt: future, slaBreachedAt: null,
    createdAt: past, updatedAt: past, lastMessageAt: past,
    customer: { ownerUserId: 'other-user', branchId: 'other-branch' },
  };

  async function checkCard(rows: any[], viewer: any, expectedIds: string[]) {
    const selected = (where: any) => rows.filter((item) => matchesWhere(item, where));
    const repo = new PrismaCrmInboxRepository({ client: { crmConversation: {
      count: async ({ where }: any) => selected(where).length,
      findMany: async ({ where }: any) => selected(where),
      groupBy: async () => [],
    } } } as any);
    repo.countPaymentProofs = async () => 0;
    repo.customerDisplayNames = async () => new Map();
    repo.userDisplayNames = async () => new Map();
    const crmRepo = { countCustomersBetween: async () => 0, countBookingsBetween: async () => 0 } as any;
    const viewerCtx = { ...viewer, permissions: ['crm.inbox.read'] };
    const brief = await new CrmDailyBriefUseCase(repo, crmRepo, {} as any).execute(viewerCtx, {}, fixedNow);
    const widget = brief.widgets.find((item) => item.key === 'unanswered')!;
    assert.equal(widget.href, '/companies/co-1/inbox?unanswered=true');
    // The list that link opens, through the inbox endpoint's own use case and viewer scope.
    const list = await new ListCrmConversationsUseCase(repo).execute(viewerCtx, { unanswered: true, pageSize: 50 } as any);
    assert.deepEqual(list.items.map((item) => item.id).sort(), [...expectedIds].sort());
    assert.equal(widget.value, expectedIds.length);
    assert.equal(widget.value, list.total);
    assert.equal((list as any).unansweredCount, list.total, 'the inbox chip says the same number');
    assert.equal(widget.severity, expectedIds.length ? 'action' : 'info');
  }

  it('counts every chat still waiting for its first reply, due or not, and nothing answered, resolved or spam', async () => {
    await checkCard([
      row,
      { ...row, id: 'late', firstResponseDueAt: past },
      { ...row, id: 'undated', firstResponseDueAt: null },
      { ...row, id: 'new', status: 'NEW' },
      { ...row, id: 'answered', status: 'WAITING_CUSTOMER', firstRespondedAt: past },
      { ...row, id: 'resolved', status: 'RESOLVED' },
      { ...row, id: 'spam', status: 'SPAM' },
      { ...row, id: 'other-company', companyId: 'co-2' },
    ], ctx, ['waiting', 'late', 'undated', 'new']);
  });

  for (const roles of [['SALES'], ['OWNER'], ['MANAGER'], ['COMPANY_VIEW']]) {
    it(`matches inbox assignment visibility for ${roles[0]} regardless of customer owner and branch`, async () => {
      const viewer = { ...ctx, userId: 'sales-1', roles, scopes: { branchIds: ['branch-allowed'] } };
      await checkCard([
        { ...row, id: 'assigned-to-self', assignedToUserId: viewer.userId },
        { ...row, id: 'unassigned' },
        { ...row, id: 'assigned-to-other', assignedToUserId: 'other-user', customer: { ownerUserId: viewer.userId, branchId: 'branch-allowed' } },
      ], viewer, roles[0] === 'SALES'
        ? ['assigned-to-self', 'unassigned']
        : ['assigned-to-self', 'unassigned', 'assigned-to-other']);
    });
  }
});
