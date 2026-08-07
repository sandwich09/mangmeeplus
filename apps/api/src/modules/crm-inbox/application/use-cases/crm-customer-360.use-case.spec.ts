import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GetCrmCustomer360SummaryUseCase, GetCrmCustomer360TimelineUseCase } from './crm-customer-360.use-case';

const ALL_PERMS = [
  'crm.customer.read',
  'crm.inbox.read',
  'crm.opportunity.read',
  'crm.follow_up.read',
  'crm.activity.read',
  'accounting.document.read',
];

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'staff-1', companyId: 'co-1',
    membershipId: 'm', roles: ['OWNER'], permissions: ALL_PERMS, scopes: {}, authProvider: 'dev',
    ...overrides,
  } as any;
}

function customerDetail(overrides: Partial<any> = {}) {
  return {
    id: 'cust-1', companyId: 'co-1', displayName: 'ลูกค้า หนึ่ง', customerType: 'PERSON', status: 'ACTIVE',
    accountingCounterpartyId: 'cp-1', consentStatus: 'GRANTED', consentUpdatedAt: '2026-07-06T09:00:00.000Z',
    consentNote: 'ยินยอมผ่าน LINE', contacts: [],
    createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', ...overrides,
  } as any;
}

function conversationSummary(overrides: Partial<any> = {}) {
  return {
    id: 'conv-1', channelId: 'ch-1', customerId: 'cust-1', status: 'OPEN', priority: 'NORMAL',
    unreadCount: 2, lastMessageAt: '2026-07-05T10:00:00.000Z', reopenedCount: 0,
    createdAt: '2026-07-04T10:00:00.000Z', ...overrides,
  } as any;
}

function opportunitySummary(overrides: Partial<any> = {}) {
  return {
    id: 'opp-1', companyId: 'co-1', customerId: 'cust-1', ownerUserId: 'staff-1', title: 'ดีลหลังคา',
    stageId: 'st-1', canonicalStageGroup: 'PROPOSAL', status: 'OPEN', amountEstimate: '100.50', currency: 'THB',
    createdAt: '2026-07-03T10:00:00.000Z', updatedAt: '2026-07-03T10:00:00.000Z', ...overrides,
  } as any;
}

function followUpSummary(overrides: Partial<any> = {}) {
  return {
    id: 'task-1', companyId: 'co-1', customerId: 'cust-1', ownerUserId: 'staff-1', title: 'โทรติดตาม',
    dueAt: '2026-07-08T03:00:00.000Z', timezone: 'Asia/Bangkok', priority: 'NORMAL', channel: 'PHONE',
    status: 'OPEN', createdAt: '2026-07-02T10:00:00.000Z', updatedAt: '2026-07-02T10:00:00.000Z', ...overrides,
  } as any;
}

function documentRecord(overrides: Partial<any> = {}) {
  return {
    id: 'doc-1', companyId: 'co-1', documentType: 'INVOICE', documentNumber: 'INV-0001', status: 'ISSUED',
    documentDate: new Date('2026-07-01T00:00:00.000Z'), dueDate: new Date('2026-07-15T00:00:00.000Z'),
    currency: 'THB', vatMode: 'EXCLUSIVE', subtotalAmount: '100.00', discountAmount: '0.00',
    taxableAmount: '100.00', vatAmount: '7.00', whtAmount: '0.00', grandTotalAmount: '107.00',
    paidAmount: '0.00', outstandingAmount: '107.00', paymentStatus: 'UNPAID', postingStatus: 'NOT_POSTED',
    ...overrides,
  } as any;
}

function quotationLinkRecord(overrides: Partial<any> = {}) {
  return {
    id: 'ql-1', companyId: 'co-1', customerId: 'cust-1', opportunityId: 'opp-1',
    accountingDocumentId: 'doc-q1', accountingDocumentType: 'QUOTATION', accountingDocumentNumber: 'QT-0001',
    status: 'DRAFT', grandTotalAmount: '500.00', currency: 'THB',
    createdAt: '2026-07-02T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z', ...overrides,
  } as any;
}

/** Fake injected use cases capturing calls; each returns its module's wire shape. */
function makeDeps(data: Partial<{
  customer: any; conversations: any[]; conversationTotal: number; opportunities: any[]; followUps: any[];
  followUpTotal: number; documents: any[]; quotationLinks: any[];
}> = {}) {
  const calls: Record<string, any[]> = { customer: [], conversations: [], opportunities: [], followUps: [], documents: [], quotationLinks: [], activities: [] };
  const conversations = data.conversations ?? [];
  const followUps = data.followUps ?? [];
  return {
    calls,
    getCustomer: { execute: async (_ctx: any, id: string) => { calls.customer.push(id); return { projection: 'OPERATIONAL', customer: data.customer ?? customerDetail() }; } } as any,
    listConversations: { execute: async (_ctx: any, filter: any) => { calls.conversations.push(filter); return { items: conversations, total: data.conversationTotal ?? conversations.length, page: 1, pageSize: 50 }; } } as any,
    listOpportunities: { execute: async (_ctx: any, filter: any) => { calls.opportunities.push(filter); return { items: data.opportunities ?? [], total: (data.opportunities ?? []).length, page: 1, pageSize: 100 }; } } as any,
    listFollowUps: { execute: async (_ctx: any, filter: any) => { calls.followUps.push(filter); return { items: followUps, total: data.followUpTotal ?? followUps.length, page: 1, pageSize: 100 }; } } as any,
    listDocuments: { execute: async (_ctx: any, filter: any) => { calls.documents.push(filter); return { data: data.documents ?? [], total: (data.documents ?? []).length, page: 1, pageSize: 50 }; } } as any,
    listActivities: { execute: async (_ctx: any, filter: any) => { calls.activities.push(filter); return []; } } as any,
    listQuotationLinks: {
      executeForCustomer: async (requestCtx: any, customerId: string) => {
        calls.quotationLinks.push({ companyId: requestCtx.companyId, customerId });
        return data.quotationLinks ?? [];
      },
    } as any,
  };
}

function makeSummaryUc(deps: ReturnType<typeof makeDeps>) {
  return new GetCrmCustomer360SummaryUseCase(deps.getCustomer, deps.listOpportunities, deps.listFollowUps, deps.listConversations, deps.listDocuments, deps.listQuotationLinks);
}

describe('GetCrmCustomer360SummaryUseCase', () => {
  it('aggregates every block for a caller holding all source permissions', async () => {
    const deps = makeDeps({
      conversations: [
        conversationSummary({ id: 'c1', status: 'OPEN', unreadCount: 2, lastMessageAt: '2026-07-05T10:00:00.000Z' }),
        conversationSummary({ id: 'c2', status: 'RESOLVED', unreadCount: 1, lastMessageAt: '2026-07-01T10:00:00.000Z' }),
      ],
      conversationTotal: 7,
      opportunities: [
        opportunitySummary({ id: 'o1', status: 'OPEN', amountEstimate: '100.50' }),
        opportunitySummary({ id: 'o2', status: 'WON', amountEstimate: '999.00' }),
        opportunitySummary({ id: 'o3', status: 'OPEN', amountEstimate: '200.00' }),
      ],
      followUps: [followUpSummary({ id: 't1' }), followUpSummary({ id: 't2', dueAt: '2026-07-09T03:00:00.000Z' })],
      followUpTotal: 5,
      documents: [documentRecord()],
      quotationLinks: [quotationLinkRecord()],
    });
    const result = await makeSummaryUc(deps).execute(ctx(), 'cust-1');

    assert.deepEqual(result.redactedSources, []);
    assert.deepEqual(result.conversations, { total: 7, open: 1, unread: 3, lastMessageAt: '2026-07-05T10:00:00.000Z' });
    assert.equal(result.deals?.openCount, 2);
    // sumAmounts emits the repo's canonical 4-dp decimal string.
    assert.equal(result.deals?.openAmountTotal, '300.5000');
    assert.equal(result.deals?.latest?.id, 'o1');
    assert.equal(result.tasks?.openCount, 5);
    assert.equal(result.tasks?.next?.id, 't1');
    assert.equal(result.quotations?.length, 1);
    assert.equal(result.quotations?.[0]?.accountingDocumentNumber, 'QT-0001');
    assert.equal(result.finance?.documents.length, 1);
    assert.deepEqual(result.finance?.documents[0], {
      id: 'doc-1', documentType: 'INVOICE', documentNumber: 'INV-0001', status: 'ISSUED',
      documentDate: '2026-07-01T00:00:00.000Z', dueDate: '2026-07-15T00:00:00.000Z', currency: 'THB',
      grandTotalAmount: '107.00', outstandingAmount: '107.00', paymentStatus: 'UNPAID',
    });
    // Sources were queried for this customer only.
    assert.equal(deps.calls.conversations[0].customerId, 'cust-1');
    assert.equal(deps.calls.opportunities[0].customerId, 'cust-1');
    assert.equal(deps.calls.followUps[0].customerId, 'cust-1');
    assert.equal(deps.calls.documents[0].counterpartyId, 'cp-1');
    assert.deepEqual(deps.calls.quotationLinks[0], { companyId: 'co-1', customerId: 'cust-1' });
  });

  it('redacts the finance block without accounting.document.read and never queries it', async () => {
    const deps = makeDeps({ documents: [documentRecord()] });
    const result = await makeSummaryUc(deps).execute(
      ctx({ permissions: ALL_PERMS.filter((p) => p !== 'accounting.document.read') }), 'cust-1',
    );
    assert.equal(result.finance, null);
    assert.deepEqual(result.redactedSources, ['finance']);
    assert.equal(deps.calls.documents.length, 0);
    assert.ok(result.conversations && result.deals && result.tasks && result.quotations);
  });

  it('redacts conversations without crm.inbox.read', async () => {
    const deps = makeDeps();
    const result = await makeSummaryUc(deps).execute(
      ctx({ permissions: ALL_PERMS.filter((p) => p !== 'crm.inbox.read') }), 'cust-1',
    );
    assert.equal(result.conversations, null);
    assert.deepEqual(result.redactedSources, ['conversations']);
    assert.equal(deps.calls.conversations.length, 0);
  });

  it('redacts both deals and quotations without crm.opportunity.read', async () => {
    const deps = makeDeps();
    const result = await makeSummaryUc(deps).execute(
      ctx({ permissions: ALL_PERMS.filter((p) => p !== 'crm.opportunity.read') }), 'cust-1',
    );
    assert.equal(result.deals, null);
    assert.equal(result.quotations, null);
    assert.deepEqual(result.redactedSources.sort(), ['deals', 'quotations']);
  });

  it('shows an empty (not redacted) finance block when the customer has no accounting link', async () => {
    const deps = makeDeps({ customer: customerDetail({ accountingCounterpartyId: undefined }) });
    const result = await makeSummaryUc(deps).execute(ctx(), 'cust-1');
    assert.deepEqual(result.finance, { documents: [] });
    assert.deepEqual(result.redactedSources, []);
    assert.equal(deps.calls.documents.length, 0);
  });

  it('propagates the item-15 owned-record scope from the customer fetch', async () => {
    const deps = makeDeps();
    deps.getCustomer = { execute: async () => { throw new Error('Record is out of scope'); } } as any;
    await assert.rejects(() => makeSummaryUc(deps).execute(ctx({ roles: ['SALES'] }), 'cust-x'), /out of scope/);
  });
});

function makeTimelineUc(deps: ReturnType<typeof makeDeps>) {
  return new GetCrmCustomer360TimelineUseCase(deps.getCustomer, deps.listActivities, deps.listOpportunities, deps.listFollowUps, deps.listConversations, deps.listDocuments);
}

function activitySummary(overrides: Partial<any> = {}) {
  return {
    id: 'act-1', companyId: 'co-1', customerId: 'cust-1', actorUserId: 'staff-1', type: 'STAGE_CHANGED',
    note: 'Moved to เจรจา', occurredAt: '2026-07-05T12:00:00.000Z', createdAt: '2026-07-05T12:00:00.000Z', ...overrides,
  } as any;
}

describe('GetCrmCustomer360TimelineUseCase', () => {
  function richDeps() {
    const deps = makeDeps({
      conversations: [conversationSummary({ id: 'c1', createdAt: '2026-07-04T10:00:00.000Z' })],
      opportunities: [opportunitySummary({ id: 'o1', createdAt: '2026-07-03T10:00:00.000Z' })],
      followUps: [followUpSummary({ id: 't1', createdAt: '2026-07-02T10:00:00.000Z' })],
      documents: [documentRecord({ documentDate: new Date('2026-07-01T00:00:00.000Z') })],
    });
    deps.listActivities = { execute: async (_c: any, f: any) => { deps.calls.activities.push(f); return [activitySummary()]; } } as any;
    return deps;
  }

  it('merges all sources newest-first with consent as a first-class event', async () => {
    const result = await makeTimelineUc(richDeps()).execute(ctx(), 'cust-1');
    assert.deepEqual(result.redactedSources, []);
    assert.deepEqual(
      result.events.map((e) => e.type),
      ['CONSENT_CHANGED', 'ACTIVITY', 'CONVERSATION_STARTED', 'DEAL_CREATED', 'TASK_CREATED', 'FINANCE_DOCUMENT'],
    );
    assert.equal(result.events[3]?.title, 'ดีลหลังคา');
    assert.equal(result.events[3]?.amount, '100.50');
    assert.equal(result.events[5]?.title, 'INV-0001');
    assert.equal(result.nextBefore, undefined);
  });

  it('pages with before/limit and hands back the next cursor', async () => {
    const uc = makeTimelineUc(richDeps());
    const first = await uc.execute(ctx(), 'cust-1', { limit: 2 });
    assert.equal(first.events.length, 2);
    assert.equal(first.nextBefore, first.events[1]?.occurredAt);
    const second = await uc.execute(ctx(), 'cust-1', { before: first.nextBefore });
    assert.deepEqual(
      second.events.map((e) => e.type),
      ['CONVERSATION_STARTED', 'DEAL_CREATED', 'TASK_CREATED', 'FINANCE_DOCUMENT'],
    );
  });

  it('omits redacted sources from events and reports them', async () => {
    const deps = richDeps();
    const result = await makeTimelineUc(deps).execute(
      ctx({ permissions: ALL_PERMS.filter((p) => p !== 'accounting.document.read' && p !== 'crm.activity.read') }),
      'cust-1',
    );
    assert.ok(!result.events.some((e) => e.type === 'FINANCE_DOCUMENT' || e.type === 'ACTIVITY'));
    assert.deepEqual(result.redactedSources.sort(), ['activities', 'finance']);
    assert.equal(deps.calls.documents.length, 0);
    assert.equal(deps.calls.activities.length, 0);
  });

  it('rejects an unparseable before cursor', async () => {
    await assert.rejects(() => makeTimelineUc(richDeps()).execute(ctx(), 'cust-1', { before: 'not-a-date' }), /before/i);
  });
});
