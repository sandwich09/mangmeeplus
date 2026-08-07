import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  CrmGetBookingSummaryTool,
  CrmGetConversationSummaryTool,
  CrmGetInboxSummaryTool,
  CrmGetPipelineSummaryTool,
  CrmGetReportSummaryTool,
  CrmListBookingsTool,
  CrmListConversationsTool,
  CrmListOpenFollowupsTool,
} from './erp-crm-operational-tools.use-case';

const base = { companyId: 'co-1', userId: 'u-1', membershipId: 'm-1', roles: ['SALES'], permissions: [], branchIds: ['br-1'], locale: 'th-TH' };

describe('CRM operational LINE AI tools', () => {
  it('returns a bounded CRM report and forwards authoritative role/branch context', async () => {
    let seen: any;
    const source = { execute: async (ctx: any, input: any) => {
      seen = { ctx, input };
      return {
        total: 20, resolved: 15, resolvedRate: 75, avgResponseMin: 4, overdue: 2,
        statusBreakdown: [{ status: 'OPEN', count: 5, pct: 25 }],
        staffPerformance: Array.from({ length: 15 }, (_, i) => ({ userId: `u${i}`, assigned: 1, resolved: 1, rate: 100 })),
        topCustomers: Array.from({ length: 8 }, (_, i) => ({ customerId: `c${i}`, displayName: `C${i}`, lifetimeValueAmount: '1', tier: 'active' })),
        branchId: 'br-1',
      };
    } } as any;
    const result = await new CrmGetReportSummaryTool(source).execute(
      { ...base, permissions: ['crm.report.read'] },
      { branchId: 'br-1', period: 'month' },
    );
    assert.equal((result.data as any).staffPerformance.length, 10);
    assert.equal((result.data as any).topCustomers.length, 5);
    assert.deepEqual(seen.ctx.roles, ['SALES']);
    assert.deepEqual(seen.ctx.scopes.branchIds, ['br-1']);
    assert.deepEqual(seen.input, { branchId: 'br-1', period: 'month' });
  });

  it('summarizes the canonical pipeline board without returning opportunity rows', async () => {
    const board = { execute: async () => ({ columns: [
      { stage: { id: 's1', name: 'ใหม่', canonicalGroup: 'OPEN' }, opportunities: [{ title: 'must not leak' }], count: 2, totalAmount: '100.00' },
      { stage: { id: 's2', name: 'เจรจา', canonicalGroup: 'OPEN' }, opportunities: [], count: 1, totalAmount: '50.00' },
    ] }) } as any;
    const result = await new CrmGetPipelineSummaryTool(board).execute({ ...base, permissions: ['crm.opportunity.read'] });
    assert.equal((result.data as any).openCount, 3);
    assert.equal((result.data as any).totalPipelineAmount, '150.0000');
    assert.equal(JSON.stringify(result).includes('must not leak'), false);
  });

  it('keeps follow-ups bounded and delegates owner/customer filters to the source use case', async () => {
    let filter: any;
    const source = { execute: async (_ctx: any, input: any) => {
      filter = input;
      return { total: 12, page: 1, pageSize: 10, items: [{ id: 'f1', customerId: 'c1', title: 'โทรกลับ', dueAt: '2026-07-15', priority: 'HIGH', channel: 'PHONE', status: 'OPEN' }] };
    } } as any;
    const result = await new CrmListOpenFollowupsTool(source).execute(
      { ...base, permissions: ['crm.follow_up.read'] },
      { view: 'due_today', assignedToMe: true, customerId: 'c1', limit: 99 },
    );
    assert.deepEqual(filter, { status: 'OPEN', view: 'due_today', customerId: 'c1', scope: 'own', page: 1, pageSize: 10 });
    assert.equal((result.data as any).total, 12);
  });

  it('builds exact weekly booking counts and a separately bounded booking list', async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `b${i}`, branchId: 'br-1', customerId: `c${i}`, customerName: `C${i}`,
      serviceName: 'consult', startAt: '2026-07-15T02:00:00Z', endAt: '2026-07-15T03:00:00Z', status: i === 0 ? 'CANCELLED' : 'BOOKED',
    }));
    const source = { execute: async () => ({ items, weekStart: '2026-07-12T00:00:00Z', weekEnd: '2026-07-19T00:00:00Z' }) } as any;
    const ctx = { ...base, permissions: ['crm.booking.read'] };
    const summary = await new CrmGetBookingSummaryTool(source).execute(ctx);
    const list = await new CrmListBookingsTool(source).execute(ctx, { limit: 99 });
    assert.deepEqual((summary.data as any).byStatus, { CANCELLED: 1, BOOKED: 11 });
    assert.equal((list.data as any).total, 12);
    assert.equal((list.data as any).items.length, 10);
  });

  it('returns scoped inbox counts and display-safe bounded conversation rows', async () => {
    const item = { id: 'cv1', customerId: 'c1', customerDisplayName: 'A', status: 'OPEN', priority: 'HIGH', tags: Array(12).fill('tag'), unreadCount: 2, lastMessagePreview: 'x'.repeat(300) };
    const source = { execute: async (_ctx: any, input: any) => ({
      items: input.pageSize === 1 ? [item] : [item], total: 7, page: 1, pageSize: input.pageSize,
      statusCounts: { OPEN: 5 }, overdueCount: 2, mineCount: 3, unassignedCount: 1,
    }) } as any;
    const ctx = { ...base, permissions: ['crm.inbox.read'] };
    const summary = await new CrmGetInboxSummaryTool(source).execute(ctx);
    const list = await new CrmListConversationsTool(source).execute(ctx, { limit: 99 });
    assert.deepEqual(summary.data, { total: 7, statusCounts: { OPEN: 5 }, overdueCount: 2, mineCount: 3, unassignedCount: 1 });
    assert.equal((list.data as any).items[0].tags.length, 10);
    assert.equal((list.data as any).items[0].lastMessagePreview.length, 200);
  });

  it('conversation summary excludes internal notes, provider ids, and attachments', async () => {
    const messages = [
      { visibility: 'INTERNAL_NOTE', direction: 'OUTBOUND', messageType: 'TEXT', contentText: 'secret note', createdAt: '2026-07-15' },
      { visibility: 'CUSTOMER', direction: 'INBOUND', messageType: 'TEXT', contentText: 'hello', providerMessageId: 'provider-secret', attachmentId: 'file-secret', createdAt: '2026-07-15' },
    ];
    const source = { execute: async () => ({ id: 'cv1', customerId: 'c1', status: 'OPEN', priority: 'NORMAL', tags: [], unreadCount: 1, messages }) } as any;
    const result = await new CrmGetConversationSummaryTool(source).execute(
      { ...base, permissions: ['crm.inbox.read'] },
      { conversationId: 'cv1' },
    );
    const encoded = JSON.stringify(result.data);
    assert.equal((result.data as any).recentCustomerVisibleMessages.length, 1);
    assert.equal(encoded.includes('secret note'), false);
    assert.equal(encoded.includes('provider-secret'), false);
    assert.equal(encoded.includes('file-secret'), false);
  });

  it('fails closed when conversation ABAC denies the record', async () => {
    const source = { execute: async () => { throw new ForbiddenException('Conversation is out of scope'); } } as any;
    const result = await new CrmGetConversationSummaryTool(source).execute(
      { ...base, permissions: ['crm.inbox.read'] },
      { conversationId: 'cv-other' },
    );
    assert.equal(result.status, 'forbidden');
    assert.deepEqual(result.sourceRefs, []);
    assert.equal(result.data, undefined);
  });

  it('returns a grounded found:false result for an unknown conversation', async () => {
    const source = { execute: async () => { throw new NotFoundException(); } } as any;
    const result = await new CrmGetConversationSummaryTool(source).execute(
      { ...base, permissions: ['crm.inbox.read'] },
      { conversationId: 'missing' },
    );
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, { found: false });
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
    assert.equal(result.sourceRefs[0]?.entityId, undefined);
  });

  it('all operational tools fail before source access without their ERP permission', async () => {
    const never = { execute: async () => assert.fail('source must not execute') } as any;
    const results = await Promise.all([
      new CrmGetReportSummaryTool(never).execute(base),
      new CrmGetPipelineSummaryTool(never).execute(base),
      new CrmListOpenFollowupsTool(never).execute(base),
      new CrmGetBookingSummaryTool(never).execute(base),
      new CrmListBookingsTool(never).execute(base),
      new CrmGetInboxSummaryTool(never).execute(base),
      new CrmListConversationsTool(never).execute(base),
      new CrmGetConversationSummaryTool(never).execute(base),
    ]);
    assert.ok(results.every((result) => result.status === 'forbidden' && result.sourceRefs.length === 0));
  });
});
