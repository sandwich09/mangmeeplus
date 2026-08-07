import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaCrmPdpaSelfServiceRepository } from './prisma-crm-pdpa-self-service.repository';

describe('PrismaCrmPdpaSelfServiceRepository.exportCustomerData', () => {
  it('scopes every read to companyId+customerId and excludes staff-internal notes', async () => {
    const captured: any = {};
    const client = {
      crmCustomer: {
        findFirst: async (args: any) => { captured.customer = args; return { id: 'cust-1', displayName: 'A', consentStatus: 'GRANTED', consentUpdatedAt: null, createdAt: new Date() }; },
      },
      crmConversation: {
        count: async () => 1,
        findMany: async (args: any) => { captured.conversations = args; return [{ id: 'conv-1', channelId: 'ch-1', status: 'NEW', createdAt: new Date(), lastMessageAt: null }]; },
      },
      crmMessage: {
        count: async () => 1,
        findMany: async (args: any) => { captured.messages = args; return [{ id: 'msg-1', conversationId: 'conv-1', direction: 'INBOUND', contentText: 'hi', createdAt: new Date() }]; },
      },
      crmBooking: {
        count: async () => 0,
        findMany: async (args: any) => { captured.bookings = args; return []; },
      },
    };
    const repo = new PrismaCrmPdpaSelfServiceRepository({ client } as any);

    const data = await repo.exportCustomerData('co-1', 'cust-1');

    assert.ok(data);
    // tenant + customer isolation on every collection query
    assert.deepEqual(captured.customer.where, { id: 'cust-1', companyId: 'co-1', personalDataErasedAt: null });
    assert.equal(captured.conversations.where.companyId, 'co-1');
    assert.equal(captured.conversations.where.customerId, 'cust-1');
    assert.equal(captured.bookings.where.companyId, 'co-1');
    assert.equal(captured.bookings.where.customerId, 'cust-1');
    // customer-visible messages only: never INTERNAL_NOTE staff notes
    assert.equal(captured.messages.where.visibility, 'CUSTOMER');
    assert.equal(captured.messages.where.companyId, 'co-1');
    assert.equal(captured.messages.where.conversation.companyId, 'co-1');
    assert.equal(captured.messages.where.conversation.customerId, 'cust-1');
    assert.equal(data?.pagination.messages.total, 1);
    assert.equal(data?.pagination.messages.truncated, false);
    // no finance amounts / internal notes / lead-trust scores leak in the selects
    const bannedFields = ['salePrice', 'priceAmount', 'amount', 'notes', 'note', 'leadScore', 'trustScore', 'aiSummaryText', 'assignedToUserId'];
    for (const sel of [captured.customer.select, captured.conversations.select, captured.messages.select, captured.bookings.select]) {
      for (const banned of bannedFields) assert.equal(sel[banned], undefined);
    }
  });

  it('returns null when the customer is not in the tenant (no cross-company leak)', async () => {
    const client = {
      crmCustomer: { findFirst: async () => null },
    };
    const repo = new PrismaCrmPdpaSelfServiceRepository({ client } as any);
    assert.equal(await repo.exportCustomerData('co-1', 'other-co-customer'), null);
  });

  it('queries messages through the customer-scoped relation even when the current conversation page is empty', async () => {
    let messageQueried = false;
    const client = {
      crmCustomer: { findFirst: async () => ({ id: 'cust-1', displayName: 'A', consentStatus: 'GRANTED', consentUpdatedAt: null, createdAt: new Date() }) },
      crmConversation: { count: async () => 0, findMany: async () => [] },
      crmMessage: { count: async () => 0, findMany: async () => { messageQueried = true; return []; } },
      crmBooking: { count: async () => 0, findMany: async () => [] },
    };
    const repo = new PrismaCrmPdpaSelfServiceRepository({ client } as any);
    const data = await repo.exportCustomerData('co-1', 'cust-1');
    assert.deepEqual(data?.messages, []);
    assert.equal(messageQueried, true);
  });

  it('reports totals and a stable cursor instead of silently truncating data over the limit', async () => {
    const at = new Date('2026-07-28T00:00:00.000Z');
    const messages = Array.from({ length: 251 }, (_, index) => ({
      id: `msg-${String(index).padStart(4, '0')}`,
      conversationId: 'conv-1',
      direction: 'INBOUND',
      contentText: `message-${index}`,
      createdAt: at,
    }));
    const captured: any = {};
    const client = {
      crmCustomer: { findFirst: async () => ({ id: 'cust-1', displayName: 'A', consentStatus: 'GRANTED', consentUpdatedAt: null, createdAt: at }) },
      crmConversation: { count: async () => 1, findMany: async () => [{ id: 'conv-1', channelId: 'ch-1', status: 'NEW', createdAt: at, lastMessageAt: at }] },
      crmMessage: {
        count: async () => 1001,
        findMany: async (args: any) => { captured.messages = args; return messages; },
      },
      crmBooking: { count: async () => 0, findMany: async () => [] },
    };
    const repo = new PrismaCrmPdpaSelfServiceRepository({ client } as any);
    const first = await repo.exportCustomerData('co-1', 'cust-1', { limit: 250 });

    assert.equal(first?.messages.length, 250);
    assert.deepEqual(first?.pagination.messages, {
      total: 1001,
      returned: 250,
      limit: 250,
      truncated: true,
      nextCursor: first?.pagination.messages.nextCursor,
    });
    assert.ok(first?.pagination.messages.nextCursor);
    assert.equal(captured.messages.take, 251);
    assert.deepEqual(captured.messages.orderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);

    await repo.exportCustomerData('co-1', 'cust-1', { limit: 250, messageCursor: first!.pagination.messages.nextCursor! });
    assert.ok(Array.isArray(captured.messages.where.OR), 'next page applies createdAt+id cursor inside the tenant filter');
    assert.equal(captured.messages.where.companyId, 'co-1');
  });
});

describe('PrismaCrmPdpaSelfServiceRepository.revokeConsent', () => {
  function makeClient(count: number) {
    const captured: any = {};
    const tx = {
      $queryRaw: async () => [],
      crmCustomer: { updateMany: async (args: any) => { captured.update = args; return { count }; } },
    };
    const client = { $transaction: async (fn: any) => fn(tx) };
    return { client, captured };
  }

  it('writes REVOKED scoped to companyId+customerId and skips erased rows', async () => {
    const { client, captured } = makeClient(1);
    const repo = new PrismaCrmPdpaSelfServiceRepository({ client } as any);
    const now = new Date();
    const res = await repo.revokeConsent('co-1', 'cust-1', now, 'note');

    assert.deepEqual(res, { updated: true });
    assert.deepEqual(captured.update.where, { id: 'cust-1', companyId: 'co-1', personalDataErasedAt: null });
    assert.equal(captured.update.data.consentStatus, 'REVOKED');
    assert.equal(captured.update.data.consentUpdatedAt, now);
    assert.equal(captured.update.data.consentNote, 'note');
  });

  it('reports not-updated when no row matches the tenant scope', async () => {
    const { client } = makeClient(0);
    const repo = new PrismaCrmPdpaSelfServiceRepository({ client } as any);
    assert.deepEqual(await repo.revokeConsent('co-1', 'ghost', new Date(), 'note'), { updated: false });
  });
});

describe('PrismaCrmPdpaSelfServiceRepository erasure cases', () => {
  it('creates a durable idempotent case with SLA and claims it atomically', async () => {
    const captured: any = {};
    const row = {
      id: 'case-1', companyId: 'co-1', customerId: 'cust-1', status: 'RECEIVED',
      requestedAt: new Date(), dueAt: new Date(), attemptCount: 0, notificationStatus: 'PENDING',
    };
    const client = {
      crmDataSubjectRequest: {
        upsert: async (args: any) => { captured.upsert = args; return row; },
        findFirst: async (args: any) => {
          captured.find = args;
          return args.where?.id ? { ...row, status: 'PROCESSING', attemptCount: 1 } : row;
        },
        updateMany: async (args: any) => { captured.claim = args; return { count: 1 }; },
      },
    };
    const repo = new PrismaCrmPdpaSelfServiceRepository({ client } as any);
    const created = await repo.createOrGetErasureCase('co-1', 'cust-1', true, new Date('2026-07-28T00:00:00.000Z'));
    assert.equal(created.id, 'case-1');
    assert.equal(captured.upsert.where.requestKey, 'co-1:cust-1:ERASURE');
    assert.equal(captured.upsert.create.reasonProvided, true);
    assert.equal(captured.upsert.create.dueAt.toISOString(), '2026-08-27T00:00:00.000Z');

    const claimed = await repo.claimNextErasureCase(new Date());
    assert.equal(claimed?.status, 'PROCESSING');
    assert.deepEqual(captured.claim.where, { id: 'case-1', status: 'RECEIVED' });
    assert.deepEqual(captured.claim.data.attemptCount, { increment: 1 });
  });

  it('marks retries with bounded backoff and terminal failure after five attempts', async () => {
    const updates: any[] = [];
    const repo = new PrismaCrmPdpaSelfServiceRepository({
      client: { crmDataSubjectRequest: { update: async (args: any) => { updates.push(args); } } },
    } as any);
    const now = new Date('2026-07-28T00:00:00.000Z');
    await repo.failErasureCase('case-1', 1, 'temporary', now);
    await repo.failErasureCase('case-1', 5, 'terminal', now);
    assert.equal(updates[0].data.status, 'FAILED_RETRYABLE');
    assert.ok(updates[0].data.nextAttemptAt > now);
    assert.equal(updates[1].data.status, 'FAILED');
    assert.equal(updates[1].data.nextAttemptAt, null);
    assert.equal(updates[1].data.notificationStatus, 'QUEUED');
  });

  it('requeues completed cases restored from a backup for deterministic re-erasure', async () => {
    let captured: any;
    const repo = new PrismaCrmPdpaSelfServiceRepository({
      client: {
        crmDataSubjectRequest: {
          updateMany: async (args: any) => { captured = args; return { count: 2 }; },
        },
      },
    } as any);
    const restoredAt = new Date('2026-07-20T00:00:00.000Z');
    const now = new Date('2026-07-28T00:00:00.000Z');
    assert.equal(await repo.requeueCompletedErasureCasesBefore(restoredAt, now), 2);
    assert.deepEqual(captured.where.status.in, ['COMPLETED', 'COMPLETED_WITH_EXCEPTION']);
    assert.equal(captured.where.completedAt.lte, restoredAt);
    assert.equal(captured.data.status, 'FAILED_RETRYABLE');
    assert.equal(captured.data.nextAttemptAt, now);
  });
});
