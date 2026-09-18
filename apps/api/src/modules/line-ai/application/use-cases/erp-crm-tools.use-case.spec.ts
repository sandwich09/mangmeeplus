import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CrmGetCustomer360Tool, CrmGetCustomerSummaryTool, CrmSearchCustomersTool } from './erp-crm-tools.use-case';
import { GetCrmCustomerSummaryUseCase } from '../../../crm/application/use-cases/crm-customer.use-case';
import { PrismaCrmRepository } from '../../../crm/infrastructure/prisma-crm.repository';

const ctx = {
  companyId: 'co-1',
  userId: 'u-1',
  membershipId: 'm-1',
  roles: ['SALES'],
  permissions: ['crm.customer.read'],
  branchIds: ['br-1'],
  locale: 'th-TH',
};

describe('CRM customer LINE AI tools', () => {
  it('keeps SALES aggregate owned while OWNER aggregate remains company-wide', async () => {
    const seen: any[] = [];
    const useCase = new GetCrmCustomerSummaryUseCase({
      summarizeCustomers: async (scope: any) => { seen.push(scope); return { total: 0, active: 0, inactive: 0, archived: 0, newCustomers: 0 }; },
    } as any);
    const since = new Date('2026-07-01T00:00:00.000Z');
    await useCase.execute({ ...ctx, requestId: 'r', authSubject: 'u-1', scopes: { branchIds: ['br-1'] }, authProvider: 'watchdog' } as any, since);
    await useCase.execute({ ...ctx, roles: ['OWNER'], requestId: 'r', authSubject: 'u-1', scopes: {}, authProvider: 'watchdog' } as any, since);
    assert.equal(seen[0].ownerUserId, 'u-1');
    assert.deepEqual(seen[0].branchIds, ['br-1']);
    assert.equal(seen[1].ownerUserId, undefined);
  });

  it('returns exact source-owned summary semantics and forwards authoritative role/scope', async () => {
    let seen: any;
    const source = {
      execute: async (requestCtx: any, since: Date, until?: Date) => {
        seen = { requestCtx, since, until };
        return { total: 12, active: 9, inactive: 1, archived: 2, newCustomers: 3 };
      },
    } as any;
    const result = await new CrmGetCustomerSummaryTool(source).execute(ctx, { newSince: '2026-07-01', newUntil: '2026-07-31' });
    assert.deepEqual(result.data, {
      total: 12,
      active: 9,
      inactive: 1,
      archived: 2,
      newCustomers: 3,
      newCustomersSince: '2026-07-01',
      newCustomersUntil: '2026-07-31',
      totalIncludesArchived: true,
      totalExcludesMerged: true,
    });
    assert.deepEqual(seen.requestCtx.roles, ['SALES']);
    assert.deepEqual(seen.requestCtx.scopes.branchIds, ['br-1']);
    assert.equal(seen.since.toISOString(), '2026-06-30T17:00:00.000Z');
    // Period-resolution spec §3.3: the window is INCLUSIVE, so the end is the last instant of that
    // Bangkok day — a customer created at 23:30 on the 31st is inside "ลูกค้าใหม่เดือนกรกฎาคม".
    assert.equal(seen.until.toISOString(), '2026-07-31T16:59:59.999Z');
    assert.equal(result.sourceRefs[0]?.module, 'crm');
  });

  it('defaults the new-customer window to the current month and reports both ends (spec §3.3)', async () => {
    let seen: any;
    const source = {
      execute: async (_requestCtx: any, since: Date, until?: Date) => {
        seen = { since, until };
        return { total: 1, active: 1, inactive: 0, archived: 0, newCustomers: 1 };
      },
    } as any;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const result = await new CrmGetCustomerSummaryTool(source).execute(ctx);
    const data = result.data as Record<string, unknown>;
    assert.equal(data['newCustomersSince'], `${today.slice(0, 8)}01`);
    assert.equal(data['newCustomersUntil'], today);
    assert.equal(seen.since.toISOString(), new Date(`${today.slice(0, 8)}01T00:00:00+07:00`).toISOString());
    assert.equal(seen.until.toISOString(), new Date(`${today}T23:59:59.999+07:00`).toISOString());
    // A malformed bound from the model is replaced by the default, never passed through.
    await new CrmGetCustomerSummaryTool(source).execute(ctx, { newSince: 'เดือนที่แล้ว', newUntil: '31/08/2569' } as never);
    assert.equal(seen.since.toISOString(), new Date(`${today.slice(0, 8)}01T00:00:00+07:00`).toISOString());
  });

  it('counts only customers created inside [newSince, newUntil] (repository window)', async () => {
    const calls: any[] = [];
    const repository = new PrismaCrmRepository({
      client: {
        $transaction: async (queries: unknown[]) => Promise.all(queries),
        crmCustomer: { count: async (args: any) => { calls.push(args.where); return 0; } },
      },
    } as any);
    const since = new Date('2026-08-01T00:00:00+07:00');
    const until = new Date('2026-08-31T23:59:59.999+07:00');
    await repository.summarizeCustomers({ companyId: 'co-1', newSince: since, newUntil: until });
    assert.deepEqual(calls[4].createdAt, { gte: since, lte: until });
    calls.length = 0;
    await repository.summarizeCustomers({ companyId: 'co-1', newSince: since });
    assert.deepEqual(calls[4].createdAt, { gte: since }, 'no end means the window still runs to now');
  });

  it('fails closed without crm.customer.read', async () => {
    const never = { execute: async () => assert.fail('source must not run') } as any;
    const result = await new CrmGetCustomerSummaryTool(never).execute({ ...ctx, permissions: [] });
    assert.equal(result.status, 'forbidden');
    assert.deepEqual(result.sourceRefs, []);
  });

  it('bounds search to ten and returns projection-safe candidates', async () => {
    let filter: any;
    const list = {
      execute: async (_ctx: any, value: any) => {
        filter = value;
        return {
          total: 1,
          page: 1,
          pageSize: value.pageSize,
          items: [{
            projection: 'OPERATIONAL',
            customer: { id: 'cust-1', displayName: 'ลูกค้า เอ', status: 'ACTIVE', tier: 'VIP', branchId: 'br-1', notes: 'must not leak' },
          }],
        };
      },
    } as any;
    const result = await new CrmSearchCustomersTool(list).execute(ctx, { search: ' ลูกค้า ', assignedToMe: true, limit: 99 });
    assert.deepEqual(filter, { search: 'ลูกค้า', scope: 'own', page: 1, pageSize: 10 });
    assert.equal((result.data as any).items[0].displayName, 'ลูกค้า เอ');
    assert.equal(JSON.stringify(result).includes('must not leak'), false);
  });

  it('requires a canonical customer id before Customer 360 lookup', async () => {
    const never = { execute: async () => assert.fail('source must not run') } as any;
    const result = await new CrmGetCustomer360Tool(never).execute(ctx, {});
    assert.deepEqual(result.data, { needsCustomerId: true });
  });

  it('fails closed without source refs when Customer 360 scope denies the record', async () => {
    const denied = { execute: async () => { throw new ForbiddenException('customer_360_not_permitted_for_projection'); } } as any;
    const result = await new CrmGetCustomer360Tool(denied).execute(ctx, { customerId: 'cust-other-scope' });
    assert.equal(result.status, 'forbidden');
    assert.equal(result.errorCode, 'CUSTOMER_SCOPE_DENIED');
    assert.deepEqual(result.sourceRefs, []);
    assert.equal(result.data, undefined);
  });

  it('returns a grounded not-found result without disclosing the requested customer id', async () => {
    const missing = { execute: async () => { throw new NotFoundException('Customer not found'); } } as any;
    const result = await new CrmGetCustomer360Tool(missing).execute(ctx, { customerId: 'cust-other-company' });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, { found: false });
    assert.equal(result.errorCode, 'CUSTOMER_NOT_FOUND');
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
    assert.equal(result.sourceRefs[0]?.entityId, undefined);
  });

  it('returns a bounded Customer 360 view and preserves redacted source evidence', async () => {
    const docs = Array.from({ length: 8 }, (_, i) => ({ id: `d-${i}`, documentType: 'INVOICE', status: 'ISSUED', documentDate: '2026-07-01', currency: 'THB', grandTotalAmount: '100', outstandingAmount: '0' }));
    const contacts = Array.from({ length: 8 }, (_, i) => ({ id: `ct-${i}`, customerId: 'cust-1', name: `Contact ${i}`, status: 'ACTIVE', isPrimary: i === 0 }));
    const get360 = {
      execute: async (_ctx: any, id: string) => ({
        customer: {
          id, displayName: 'Customer One', customerType: 'PERSON', status: 'ACTIVE', tier: 'ACTIVE',
          consentStatus: 'GRANTED', contacts, lineIdentities: [{ maskedProviderUserId: 'secret' }],
        },
        conversations: null,
        deals: null,
        tasks: null,
        quotations: [],
        finance: { documents: docs },
        redactedSources: ['conversations'],
      }),
    } as any;
    const result = await new CrmGetCustomer360Tool(get360).execute(ctx, { customerId: 'cust-1' });
    const data = result.data as any;
    assert.equal(data.customer.contacts.length, 5);
    assert.equal(data.finance.documents.length, 5);
    assert.deepEqual(data.redactedSources, ['conversations']);
    assert.equal(JSON.stringify(data).includes('maskedProviderUserId'), false);
    assert.equal(result.sourceRefs[0]?.entityId, 'cust-1');
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/co-1/crm/customers/cust-1');
  });
});
