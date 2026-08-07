import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaCrmInboxRepository } from './prisma-crm-inbox.repository';
import { CrmAiContextRepository } from './crm-ai-context.repository';

// listMessages regression pin: a thread longer than `take` must keep its
// NEWEST messages (staff thread view + AI window both read this), while the
// response stays oldest→newest — the web inbox appends new messages at the end.

const base = Date.UTC(2026, 0, 1);

/** msg-1 is the oldest; msg-<n> is the newest. */
function messageRow(i: number) {
  return {
    id: `msg-${i}`,
    companyId: 'co-1',
    conversationId: 'conv-1',
    direction: 'INBOUND',
    visibility: 'CUSTOMER',
    authorType: 'CUSTOMER',
    authorUserId: null,
    messageType: 'TEXT',
    contentText: `message ${i}`,
    contentJson: null,
    attachmentId: null,
    providerMessageId: `line-${i}`,
    webhookEventId: null,
    deliveryStatus: 'RECEIVED',
    deliveryError: null,
    sentAt: null,
    createdAt: new Date(base + i * 1000),
  };
}

function makeRepo(rowCount: number) {
  const rows = Array.from({ length: rowCount }, (_, idx) => messageRow(idx + 1));
  // Emulates the documented Prisma semantics this query relies on: rows come
  // back in `orderBy` order; a negative `take` returns the last |take| rows
  // of that ordering (order preserved), a positive one the first `take`.
  const findMany = mock.fn(async (args: { orderBy: { createdAt: 'asc' | 'desc' }; take?: number }) => {
    const sorted = [...rows].sort((a, b) =>
      args.orderBy.createdAt === 'asc'
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : b.createdAt.getTime() - a.createdAt.getTime(),
    );
    if (args.take === undefined) return sorted;
    return args.take < 0 ? sorted.slice(args.take) : sorted.slice(0, args.take);
  });
  const prisma = { client: { crmMessage: { findMany } } } as any;
  return { repo: new PrismaCrmInboxRepository(prisma), findMany };
}

function conversationRow(customerId: string) {
  const now = new Date('2026-07-12T00:00:00.000Z');
  return {
    id: 'conv-1', companyId: 'co-1', channelId: 'ch-1', customerId, channelIdentityId: 'idn-1',
    status: 'NEW', priority: 'NORMAL', tagsJson: null, assignedToUserId: null, unreadCount: 0,
    lastMessageAt: null, lastInboundAt: null, lastOutboundAt: null, lastMessagePreview: null,
    firstResponseDueAt: now, firstRespondedAt: null, slaBreachedAt: null, resolvedAt: null,
    resolvedByUserId: null, reopenedCount: 0, autoReplyEnabled: true, autoReplyCount: 0,
    autoReplyCheckedAt: null, createdAt: now, updatedAt: now,
  };
}

describe('PrismaCrmInboxRepository.listMessages', () => {
  it('keeps the newest messages when the thread exceeds take, still ascending', async () => {
    const { repo, findMany } = makeRepo(250);
    const messages = await repo.listMessages('co-1', 'conv-1');

    assert.equal(messages.length, 200);
    // The oldest 50 fall off; the newest message is present and last.
    assert.equal(messages[0]?.id, 'msg-51');
    assert.equal(messages[199]?.id, 'msg-250');
    for (let i = 1; i < messages.length; i++) {
      assert.ok(messages[i - 1]!.createdAt <= messages[i]!.createdAt, 'response must stay oldest→newest');
    }

    // Pin the query shape itself: ascending + negative take (last n rows).
    const args = (findMany.mock.calls as any[])[0]?.arguments[0];
    assert.deepEqual(args.where, { companyId: 'co-1', conversationId: 'conv-1' });
    assert.deepEqual(args.orderBy, { createdAt: 'asc' });
    assert.equal(args.take, -200);
  });

  it('returns short threads in full, oldest first', async () => {
    const { repo } = makeRepo(3);
    const messages = await repo.listMessages('co-1', 'conv-1');
    assert.deepEqual(
      messages.map((m) => m.id),
      ['msg-1', 'msg-2', 'msg-3'],
    );
  });

  it('honors an explicit take, keeping the newest tail', async () => {
    const { repo } = makeRepo(30);
    const messages = await repo.listMessages('co-1', 'conv-1', 20);
    assert.equal(messages.length, 20);
    assert.equal(messages[0]?.id, 'msg-11');
    assert.equal(messages[19]?.id, 'msg-30');
  });
});

describe('CrmAiContextRepository.listAiApprovedTemplateExamples', () => {
  it('selects only active templates approved at their current version', async () => {
    const queryRaw = mock.fn(async () => [{ title: 'อนุมัติแล้ว', bodyText: 'ข้อความ', version: 2 }]);
    const repo = new CrmAiContextRepository({ client: { $queryRaw: queryRaw } } as any);

    assert.deepEqual(await repo.listAiApprovedTemplateExamples('co-1'), [
      { title: 'อนุมัติแล้ว', bodyText: 'ข้อความ', version: 2 },
    ]);
    const sql = (queryRaw.mock.calls as any[])[0].arguments[0].join('?');
    assert.match(sql, /"status" = 'ACTIVE'/);
    assert.match(sql, /"aiApprovedVersion" = "version"/);
    assert.match(sql, /"aiApprovedAt" IS NOT NULL/);
    assert.match(sql, /"aiApprovedByUserId" IS NOT NULL/);
  });
});

describe('PrismaCrmInboxRepository.approveTemplateVersionForAi', () => {
  it('returns no approval when a concurrent edit invalidates the reviewed version after the write', async () => {
    const updateMany = mock.fn(async () => ({ count: 1 }));
    const findFirst = mock.fn(async () => ({
      id: 'tpl-1',
      companyId: 'co-1',
      status: 'ACTIVE',
      version: 3,
      aiApprovedVersion: null,
    }));
    const repo = new PrismaCrmInboxRepository({
      client: { crmMessageTemplate: { updateMany, findFirst } },
    } as any);

    assert.equal(await repo.approveTemplateVersionForAi('co-1', 'tpl-1', 2, 'user-1'), null);
    assert.deepEqual((updateMany.mock.calls as any[])[0].arguments[0].where, {
      id: 'tpl-1',
      companyId: 'co-1',
      status: 'ACTIVE',
      version: 2,
    });
  });
});

describe('PrismaCrmInboxRepository.findLatestBookingPromptMessage', () => {
  it('loads only a delivered prompt for the active proposal', async () => {
    const row = {
      ...messageRow(1),
      direction: 'OUTBOUND',
      authorType: 'AI',
      deliveryStatus: 'SENT',
      contentJson: { operationalType: 'BOOKING_CONTACT', proposalId: 'prop-1' },
    };
    const findFirst = mock.fn(async () => row);
    const repo = new PrismaCrmInboxRepository({
      client: { crmMessage: { findFirst } },
    } as any);

    const result = await repo.findLatestBookingPromptMessage('co-1', 'conv-1', 'prop-1');

    assert.equal(result?.id, 'msg-1');
    assert.deepEqual((findFirst.mock.calls as any[])[0].arguments[0], {
      where: {
        companyId: 'co-1',
        conversationId: 'conv-1',
        direction: 'OUTBOUND',
        visibility: 'CUSTOMER',
        deliveryStatus: 'SENT',
        contentJson: { path: ['proposalId'], equals: 'prop-1' },
      },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('PrismaCrmInboxRepository daily-brief customer scope', () => {
  const scope = { ownerUserId: 'sales-1', branchIds: ['branch-1'] };
  const customer = {
    ownerUserId: 'sales-1',
    OR: [{ branchId: { in: ['branch-1'] } }, { branchId: null }],
  };

  it('applies owner and branch scope to conversation counts and listings', async () => {
    const count = mock.fn(async () => 0);
    const findMany = mock.fn(async () => []);
    const repo = new PrismaCrmInboxRepository({
      client: { crmConversation: { count, findMany } },
    } as any);

    await repo.countUnansweredConversations('co-1', scope);
    await repo.countOpenSlaBreaches('co-1', scope);
    await repo.listConversations('co-1', {
      scopeUserId: 'sales-1',
      customerOwnerUserId: 'sales-1',
      customerBranchIds: ['branch-1'],
      page: 1,
      pageSize: 25,
    });

    assert.deepEqual((count.mock.calls as any[])[0].arguments[0].where, {
      companyId: 'co-1', customer, firstRespondedAt: null, status: { notIn: ['RESOLVED', 'SPAM'] },
    });
    assert.deepEqual((count.mock.calls as any[])[1].arguments[0].where, {
      companyId: 'co-1', customer, slaBreachedAt: { not: null }, status: { notIn: ['RESOLVED', 'SPAM'] },
    });
    const listWhere = (findMany.mock.calls as any[])[0].arguments[0].where;
    assert.deepEqual(listWhere.customer, customer);
    assert.deepEqual(listWhere.AND, [{ OR: [{ assignedToUserId: 'sales-1' }, { assignedToUserId: null }] }]);
    assert.deepEqual((count.mock.calls as any[])[2].arguments[0].where, listWhere);
  });

  it('counts payment proofs through the scoped conversation/customer join', async () => {
    const queryRaw = mock.fn(async () => [{ count: 7n }]);
    const repo = new PrismaCrmInboxRepository({ client: { $queryRaw: queryRaw } } as any);

    assert.equal(await repo.countPaymentProofs('co-1', 'crm_conversation', 'payment_proof', scope), 7);
    const sql = (queryRaw.mock.calls as any[])[0].arguments[0];
    assert.match(sql.strings.join(' '), /CrmConversation/);
    assert.match(sql.strings.join(' '), /CrmCustomer/);
    assert.deepEqual(sql.values, ['co-1', 'crm_conversation', 'payment_proof', 'sales-1', 'branch-1']);
  });
});

describe('PrismaCrmInboxRepository reply retry age boundary', () => {
  it('never selects a pending LINE retry key after its 24-hour provider window', async () => {
    const findMany = mock.fn(async () => []);
    const repo = new PrismaCrmInboxRepository({ client: { crmMessage: { findMany } } } as any);
    const now = new Date('2026-07-12T12:00:00.000Z');

    await repo.findRetryableReplies(now, 60_000, 24 * 60 * 60 * 1000, 100);

    assert.deepEqual((findMany.mock.calls as any[])[0].arguments[0].where.createdAt, {
      gte: new Date('2026-07-11T12:00:00.000Z'),
    });
  });
});

describe('PrismaCrmInboxRepository notification scanner tombstone filters', () => {
  it('filters stale candidates, breach claims, and display-name reads to live customers', async () => {
    const conversationFindMany = mock.fn(async () => []);
    const conversationUpdateMany = mock.fn(async () => ({ count: 0 }));
    const customerFindMany = mock.fn(async () => []);
    const repo = new PrismaCrmInboxRepository({
      client: {
        crmConversation: { findMany: conversationFindMany, updateMany: conversationUpdateMany },
        crmCustomer: { findMany: customerFindMany },
      },
    } as any);
    const now = new Date('2026-07-12T00:00:00.000Z');

    await repo.findSlaBreachCandidates(now, 20);
    await repo.findNewUnassignedConversations(now, 60_000, 20);
    await repo.markSlaBreached('conv-erased', now);
    await repo.findCustomerDisplayNames('co-1', ['cust-erased']);

    for (const call of conversationFindMany.mock.calls as any[]) {
      assert.deepEqual(call.arguments[0].where.customer, { status: 'ACTIVE', personalDataErasedAt: null });
    }
    assert.deepEqual((conversationUpdateMany.mock.calls as any[])[0].arguments[0].where.customer, {
      status: 'ACTIVE', personalDataErasedAt: null,
    });
    assert.deepEqual((customerFindMany.mock.calls as any[])[0].arguments[0].where, {
      companyId: 'co-1', id: { in: ['cust-erased'] }, status: 'ACTIVE', personalDataErasedAt: null,
    });
  });
});

describe('customer tombstone guards on direct conversation writers', () => {
  it('locks the conversation customer and rejects tag-style updates after erasure', async () => {
    const locks: string[] = [];
    let writes = 0;
    const tx: any = {
      $queryRaw: async (strings: TemplateStringsArray) => { locks.push(strings.join('?')); return []; },
      crmConversation: {
        findFirst: async () => conversationRow('cust-1'),
        updateMany: async () => { writes += 1; return { count: 1 }; },
      },
      crmCustomer: { findFirst: async () => null },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    const updated = await repo.updateConversation('co-1', 'conv-1', { tagsJson: ['VIP'] });
    assert.equal(updated, null);
    assert.equal(writes, 0);
    assert.deepEqual(locks.map((sql) => sql.includes('identity-graph') ? 'graph' : sql.includes('crm-customer:') ? 'customer' : 'conversation'), [
      'graph', 'customer', 'conversation',
    ]);
  });

  it('does not clear unread state after the linked customer has been erased', async () => {
    let writes = 0;
    const tx = {
      $queryRaw: async () => [],
      crmConversation: {
        findFirst: async () => conversationRow('cust-1'),
        updateMany: async () => { writes += 1; return { count: 1 }; },
      },
      crmCustomer: { findFirst: async () => null },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    await repo.markConversationRead('co-1', 'conv-1', {
      actorUserId: 'staff-1', canAccessAll: false, expectedAssignedToUserId: null,
    });
    assert.equal(writes, 0);
  });

  it('rechecks active assignee membership after locking and does not write after revocation', async () => {
    let writes = 0;
    const tx = {
      $queryRaw: async () => [],
      crmConversation: {
        findFirst: async () => conversationRow('cust-1'),
        updateMany: async () => { writes += 1; return { count: 1 }; },
      },
      crmCustomer: { findFirst: async () => ({ id: 'cust-1' }) },
      companyMembership: { findFirst: async () => null },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    await assert.rejects(
      () => repo.assignConversation('co-1', 'conv-1', 'revoked-user', {
        actorUserId: 'admin-1', canAccessAll: true, expectedAssignedToUserId: null, canAssignAll: true,
      }),
      /assignee_not_active_company_member/,
    );
    assert.equal(writes, 0);
  });

  it('rejects a stale actor mutation after the conversation is reassigned under the lock', async () => {
    let writes = 0;
    const tx: any = {
      $queryRaw: async () => [],
      crmConversation: {
        findFirst: async () => conversationRow('cust-1'),
        updateMany: async () => { writes += 1; return { count: 1 }; },
      },
      crmCustomer: { findFirst: async () => ({ id: 'cust-1' }) },
    };
    tx.crmConversation.findFirst = async () => ({ ...conversationRow('cust-1'), assignedToUserId: 'staff-2' });
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    await assert.rejects(
      () => repo.updateConversation('co-1', 'conv-1', { priority: 'URGENT' }, {
        actorUserId: 'staff-1', canAccessAll: false, expectedAssignedToUserId: null,
      }),
      /conversation_assignment_changed/,
    );
    assert.equal(writes, 0);
  });

  it('validates self-pickup and self-release transitions against the locked assignee snapshot', async () => {
    for (const scenario of [
      { current: null, next: 'staff-1' },
      { current: 'staff-1', next: null },
    ] as const) {
      let updateWhere: any;
      const tx = {
        $queryRaw: async () => [],
        crmConversation: {
          findFirst: async () => ({ ...conversationRow('cust-1'), assignedToUserId: scenario.current }),
          updateMany: async ({ where }: any) => { updateWhere = where; return { count: 1 }; },
        },
        crmCustomer: { findFirst: async () => ({ id: 'cust-1' }) },
        companyMembership: { findFirst: async () => ({ id: 'membership-1' }) },
      };
      const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
      await repo.assignConversation('co-1', 'conv-1', scenario.next, {
        actorUserId: 'staff-1', canAccessAll: false,
        expectedAssignedToUserId: scenario.current, canAssignAll: false,
      });
      assert.equal(updateWhere.assignedToUserId, scenario.current);
    }
  });

  it('blocks a stale self-pickup when another agent wins assignment first', async () => {
    let writes = 0;
    const tx = {
      $queryRaw: async () => [],
      crmConversation: {
        findFirst: async () => ({ ...conversationRow('cust-1'), assignedToUserId: 'staff-2' }),
        updateMany: async () => { writes += 1; return { count: 1 }; },
      },
      crmCustomer: { findFirst: async () => ({ id: 'cust-1' }) },
      companyMembership: { findFirst: async () => ({ id: 'membership-1' }) },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    await assert.rejects(
      () => repo.assignConversation('co-1', 'conv-1', 'staff-1', {
        actorUserId: 'staff-1', canAccessAll: false, expectedAssignedToUserId: null, canAssignAll: false,
      }),
      /conversation_assignment_changed/,
    );
    assert.equal(writes, 0);
  });

  it('does not insert AI feedback when the linked customer is archived or erased', async () => {
    let feedbackWrites = 0;
    const tx = {
      $queryRaw: async () => [],
      crmConversation: { findFirst: async () => ({ customerId: 'cust-1' }) },
      crmCustomer: { findFirst: async () => null },
      crmAiAssistFeedback: {
        findFirst: async () => null,
        create: async () => { feedbackWrites += 1; return { id: 'fb-1', createdAt: new Date() }; },
      },
    };
    const context = new CrmAiContextRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    await assert.rejects(
      () => context.saveLiveAssistFeedback({
        companyId: 'co-1', conversationId: 'conv-1', kind: 'SUMMARY', rating: 'UP',
        requestId: 'req-ai-1', createdByUserId: 'staff-1', comment: 'useful',
      }),
      /customer_not_active/,
    );
    assert.equal(feedbackWrites, 0);
  });
});

describe('PrismaCrmInboxRepository.createConversation', () => {
  it('waits for identity topology changes, then persists only the canonical ACTIVE customer', async () => {
    let releaseTopology!: () => void;
    let topologyWaitStarted!: () => void;
    const topologyGate = new Promise<void>((resolve) => { releaseTopology = resolve; });
    const waiting = new Promise<void>((resolve) => { topologyWaitStarted = resolve; });
    let canonicalCustomerId = 'cust-secondary';
    const lockSql: string[] = [];
    const createdData: any[] = [];
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        lockSql.push(sql);
        if (sql.includes('crm-customer-identity-graph:')) {
          topologyWaitStarted();
          await topologyGate;
        }
        return [];
      },
      crmChannelIdentity: {
        findFirst: async () => ({ customerId: canonicalCustomerId }),
      },
      crmCustomer: {
        findFirst: async (args: any) => args.where.status === 'ACTIVE' ? { id: canonicalCustomerId } : null,
      },
      crmConversation: {
        findFirst: async () => null,
        create: async (args: any) => {
          createdData.push(args.data);
          return conversationRow(args.data.customerId);
        },
      },
    };
    const prisma = { client: { $transaction: async (run: any) => run(tx) } } as any;
    const repo = new PrismaCrmInboxRepository(prisma);

    const pending = repo.createConversation({
      companyId: 'co-1', channelId: 'ch-1', channelIdentityId: 'idn-1',
      customerId: 'cust-secondary', status: 'NEW', firstResponseDueAt: new Date(),
    });
    await waiting;
    // Simulates a merge/relink committing while it owns the shared graph lock.
    canonicalCustomerId = 'cust-primary';
    releaseTopology();

    const created = await pending;
    assert.equal(created.conversation.customerId, 'cust-primary');
    assert.equal(created.created, true);
    assert.equal(createdData[0].customerId, 'cust-primary');
    assert.deepEqual(lockSql.map((sql) =>
      sql.includes('identity-graph') ? 'graph' : sql.includes('line-identity') ? 'identity' : 'customer'),
    ['graph', 'identity', 'customer']);
  });

  it('refuses to create when the identity does not resolve to an ACTIVE customer', async () => {
    let createCalls = 0;
    const tx = {
      $queryRaw: async () => [],
      crmChannelIdentity: { findFirst: async () => ({ customerId: 'cust-merged' }) },
      crmCustomer: { findFirst: async () => null },
      crmConversation: { create: async () => { createCalls += 1; } },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);

    await assert.rejects(() => repo.createConversation({
      companyId: 'co-1', channelId: 'ch-1', channelIdentityId: 'idn-1', customerId: 'cust-merged',
    }), /customer_not_active/);
    assert.equal(createCalls, 0);
  });

  it('reuses the latest open conversation under the graph lock instead of creating a duplicate', async () => {
    let createCalls = 0;
    const existing = conversationRow('cust-primary');
    const tx = {
      $queryRaw: async () => [],
      crmChannelIdentity: { findFirst: async () => ({ customerId: 'cust-primary' }) },
      crmCustomer: { findFirst: async () => ({ id: 'cust-primary' }) },
      crmConversation: {
        findFirst: async () => existing,
        update: async () => { throw new Error('canonical row should not need repair'); },
        create: async () => { createCalls += 1; },
      },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);

    const result = await repo.createConversation({
      companyId: 'co-1', channelId: 'ch-1', channelIdentityId: 'idn-1', customerId: 'cust-secondary',
    });

    assert.equal(result.created, false);
    assert.equal(result.conversation.id, 'conv-1');
    assert.equal(result.conversation.customerId, 'cust-primary');
    assert.equal(createCalls, 0);
  });
});

describe('PrismaCrmInboxRepository.registerExistingIdentityConsent', () => {
  it('waits for merge/relink, then grants consent only on the canonical ACTIVE customer', async () => {
    let releaseTopology!: () => void;
    let topologyWaitStarted!: () => void;
    const topologyGate = new Promise<void>((resolve) => { releaseTopology = resolve; });
    const waiting = new Promise<void>((resolve) => { topologyWaitStarted = resolve; });
    let canonicalCustomerId = 'cust-secondary';
    const locks: string[] = [];
    const customerUpdates: any[] = [];
    const identityUpdates: any[] = [];
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        locks.push(sql);
        if (sql.includes('crm-customer-identity-graph:')) {
          topologyWaitStarted();
          await topologyGate;
        }
        return [];
      },
      crmChannelIdentity: {
        findFirst: async () => ({ id: 'idn-1', customerId: canonicalCustomerId, verifiedLinkAt: null, verifiedLinkVia: null }),
        update: async (args: any) => { identityUpdates.push(args); return args.data; },
      },
      crmCustomer: {
        findFirst: async () => ({ id: canonicalCustomerId }),
        updateMany: async (args: any) => { customerUpdates.push(args); return { count: 1 }; },
      },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    const now = new Date('2026-07-12T00:00:00.000Z');

    const pending = repo.registerExistingIdentityConsent({
      companyId: 'co-1', channelId: 'ch-1', identityId: 'idn-1', now,
      consentNote: 'notice-v1', updatedByUserId: 'system',
    });
    await waiting;
    canonicalCustomerId = 'cust-primary';
    releaseTopology();

    assert.deepEqual(await pending, { customerId: 'cust-primary' });
    assert.equal(customerUpdates[0].where.id, 'cust-primary');
    assert.equal(customerUpdates[0].where.status, 'ACTIVE');
    assert.equal(customerUpdates[0].data.consentStatus, 'GRANTED');
    assert.deepEqual(identityUpdates[0].data, { verifiedLinkAt: now, verifiedLinkVia: 'LIFF' });
    assert.deepEqual(locks.map((sql) =>
      sql.includes('identity-graph') ? 'graph' : sql.includes('line-identity') ? 'identity' : 'customer'),
    ['graph', 'identity', 'customer']);
  });
});

describe('PrismaCrmInboxRepository.appendInboundMessage', () => {
  it('locks/updates the conversation before inserting content so PDPA erase has a linear boundary', async () => {
    const order: string[] = [];
    const row = messageRow(1);
    let conversationReads = 0;
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray) => { order.push(strings.join('?').includes('FOR UPDATE') ? 'conversation-lock' : 'advisory'); return []; },
      crmConversation: {
        findFirst: async () => { conversationReads += 1; return { customerId: 'cust-1' }; },
        update: async () => { order.push('conversation'); return {}; },
      },
      crmCustomer: { findFirst: async () => ({ id: 'cust-1' }) },
      crmMessage: { create: async () => { order.push('message'); return row; } },
    };
    const prisma = {
      client: {
        $transaction: async (run: any) => run(tx),
      },
    } as any;
    const repo = new PrismaCrmInboxRepository(prisma);

    const result = await repo.appendInboundMessage({ companyId: 'co-1', conversationId: 'conv-1' }, 'conv-1', { lastMessageAt: new Date() });

    assert.equal(result?.id, 'msg-1');
    assert.equal(conversationReads, 2);
    assert.deepEqual(order.slice(-3), ['conversation-lock', 'conversation', 'message']);
  });

  it('acknowledges a post-erasure inbound as a no-op without storing content', async () => {
    let creates = 0;
    const tx = {
      $queryRaw: async () => [],
      crmConversation: { findFirst: async () => ({ customerId: 'cust-erased' }), update: async () => { throw new Error('must not update'); } },
      crmCustomer: { findFirst: async () => null },
      crmMessage: { create: async () => { creates += 1; } },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    const result = await repo.appendInboundMessage(
      { companyId: 'co-1', conversationId: 'conv-1', contentText: 'must disappear' },
      'conv-1',
      { lastMessagePreview: 'must disappear' },
    );
    assert.equal(result, null);
    assert.equal(creates, 0);
  });
});

describe('PrismaCrmInboxRepository personal-data tombstone writers', () => {
  it('does not restore LINE profile or placeholder customer name after erasure', async () => {
    let identityWrites = 0;
    let customerWrites = 0;
    const tx = {
      $queryRaw: async () => [],
      crmChannelIdentity: {
        findFirst: async () => ({ id: 'idn-1', customerId: 'cust-erased' }),
        update: async () => { identityWrites += 1; },
      },
      crmCustomer: {
        findFirst: async () => null,
        updateMany: async () => { customerWrites += 1; },
      },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    assert.equal(await repo.updateIdentityProfileUnlessErased({
      companyId: 'co-1', identityId: 'idn-1', expectedCustomerId: 'cust-erased',
      displayName: 'Restored Name', pictureUrl: 'https://secret/p.jpg', placeholderName: 'ลูกค้า LINE', updatedByUserId: 'system',
    }), false);
    assert.equal(identityWrites, 0);
    assert.equal(customerWrites, 0);
  });

  it('does not attach fetched media after erasure', async () => {
    let attachmentWrites = 0;
    const tx = {
      $queryRaw: async () => [],
      crmConversation: { findFirst: async () => ({ customerId: 'cust-erased' }) },
      crmCustomer: { findFirst: async () => null },
      attachmentObject: { create: async () => { attachmentWrites += 1; } },
      attachmentBlob: { create: async () => { attachmentWrites += 1; } },
      crmMessage: { findFirst: async () => ({ id: 'msg-1' }), updateMany: async () => { attachmentWrites += 1; return { count: 1 }; } },
    };
    const client = {
      crmMessage: { findFirst: async () => ({ conversationId: 'conv-1' }) },
      $transaction: async (run: any) => run(tx),
    };
    const repo = new PrismaCrmInboxRepository({ client } as any);
    assert.equal(await repo.storeInboundMediaAttachment({
      attachmentId: 'att-1', companyId: 'co-1', messageId: 'msg-1', originalFileName: 'secret-name.jpg',
      mimeType: 'image/jpeg', data: Buffer.from('secret'), checksumSha256: 'secret-checksum',
    }), false);
    assert.equal(attachmentWrites, 0);
  });

  it('rejects an outbound append after erasure before content is inserted', async () => {
    let messages = 0;
    const tx = {
      $queryRaw: async () => [],
      crmConversation: { findFirst: async () => ({ customerId: 'cust-erased' }) },
      crmCustomer: { findFirst: async () => null },
      crmMessage: { create: async () => { messages += 1; } },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    await assert.rejects(() => repo.appendOutboundMessage(
      { companyId: 'co-1', conversationId: 'conv-1', contentText: 'must not persist' },
      'conv-1',
      { lastMessagePreview: 'must not persist' },
    ), /customer_personal_data_erased/);
    assert.equal(messages, 0);
  });

  it('does not finalize delivery metadata after erasure', async () => {
    let updates = 0;
    const tx = {
      $queryRaw: async () => [],
      crmConversation: { findFirst: async () => ({ customerId: 'cust-erased' }) },
      crmCustomer: { findFirst: async () => null },
      crmMessage: { updateMany: async () => { updates += 1; return { count: 1 }; } },
    };
    const client = {
      crmMessage: { findFirst: async () => ({ companyId: 'co-1', conversationId: 'conv-1' }) },
      $transaction: async (run: any) => run(tx),
    };
    const repo = new PrismaCrmInboxRepository({ client } as any);

    assert.equal(await repo.updateMessageDelivery('msg-1', { deliveryStatus: 'FAILED', deliveryError: 'secret' }), null);
    assert.equal(updates, 0);
  });

  it('does not mutate LINE follow state after erasure', async () => {
    let updates = 0;
    const tx = {
      $queryRaw: async () => [],
      crmChannelIdentity: {
        findFirst: async () => ({ id: 'idn-1', customerId: 'cust-erased' }),
        updateMany: async () => { updates += 1; return { count: 1 }; },
      },
      crmCustomer: { findFirst: async () => null },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);

    assert.equal(await repo.updateIdentityLifecycleUnlessErased({
      companyId: 'co-1', identityId: 'idn-1', expectedCustomerId: 'cust-erased',
      status: 'UNFOLLOWED', unfollowedAt: new Date(),
    }), null);
    assert.equal(updates, 0);
  });

  it('does not reopen a conversation after erasure', async () => {
    let updates = 0;
    const tx = {
      $queryRaw: async () => [],
      crmConversation: {
        findFirst: async () => ({ customerId: 'cust-erased' }),
        update: async () => { updates += 1; },
      },
      crmCustomer: { findFirst: async () => null },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);

    assert.equal(await repo.reopenConversation('co-1', 'conv-1', new Date()), null);
    assert.equal(updates, 0);
  });
});

describe('PrismaCrmInboxRepository autonomy tombstone boundaries', () => {
  it('does not enqueue an autonomy job when erasure wins the shared graph lock', async () => {
    let releaseGraph!: () => void;
    let graphWaitStarted!: () => void;
    const graphGate = new Promise<void>((resolve) => { releaseGraph = resolve; });
    const waiting = new Promise<void>((resolve) => { graphWaitStarted = resolve; });
    let erased = false;
    let creates = 0;
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        if (strings.join('?').includes('crm-customer-identity-graph:')) {
          graphWaitStarted();
          await graphGate;
        }
        return [];
      },
      crmConversation: { findFirst: async () => ({ customerId: 'cust-1' }) },
      crmCustomer: { findFirst: async () => erased ? null : { id: 'cust-1' } },
      crmAutonomyJob: { create: async () => { creates += 1; } },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);

    const pending = repo.createAutonomyJob({ companyId: 'co-1', conversationId: 'conv-1', messageId: 'msg-1', replyToken: 'secret' });
    await waiting;
    erased = true;
    releaseGraph();

    assert.equal(await pending, null);
    assert.equal(creates, 0);
  });

  it('does not claim a job scanned before erasure when erasure wins the graph lock', async () => {
    let updateCalls = 0;
    const tx = {
      $queryRaw: async () => [],
      crmConversation: { findFirst: async () => ({ customerId: 'cust-erased' }) },
      crmCustomer: { findFirst: async () => null },
      crmAutonomyJob: { updateMany: async () => { updateCalls += 1; return { count: 1 }; } },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    const at = new Date('2026-07-12T00:00:00.000Z');

    assert.equal(await repo.claimAutonomyJob({
      id: 'job-1', companyId: 'co-1', conversationId: 'conv-1', messageId: 'msg-1',
      replyToken: 'secret', replyTokenAt: at, status: 'FAILED', attempts: 1,
      nextAttemptAt: at, lastError: 'provider secret', createdAt: at, updatedAt: at,
    }, at), false);
    assert.equal(updateCalls, 0);
  });

  it('claims only the oldest open autonomy job in a live conversation', async () => {
    let oldestId = 'job-old';
    let updateCalls = 0;
    const tx = {
      $queryRaw: async () => [],
      crmConversation: { findFirst: async () => ({ customerId: 'cust-1' }) },
      crmCustomer: { findFirst: async () => ({ id: 'cust-1' }) },
      crmAutonomyJob: {
        findFirst: async () => ({ id: oldestId }),
        updateMany: async () => { updateCalls += 1; return { count: 1 }; },
      },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    const at = new Date('2026-07-12T00:00:00.000Z');
    const candidate = {
      id: 'job-new', companyId: 'co-1', conversationId: 'conv-1', messageId: 'msg-new',
      replyToken: null, replyTokenAt: null, status: 'PENDING' as const, attempts: 0,
      nextAttemptAt: null, lastError: null, createdAt: at, updatedAt: at,
    };

    assert.equal(await repo.claimAutonomyJob(candidate, at), false);
    assert.equal(updateCalls, 0);

    oldestId = candidate.id;
    assert.equal(await repo.claimAutonomyJob(candidate, at), true);
    assert.equal(updateCalls, 1);
  });

  it('does not let a stale worker restore job errors after erasure', async () => {
    let updateCalls = 0;
    const tx = {
      $queryRaw: async () => [],
      crmConversation: { findFirst: async () => ({ customerId: 'cust-erased' }) },
      crmCustomer: { findFirst: async () => null },
      crmAutonomyJob: { update: async () => { updateCalls += 1; } },
    };
    const client = {
      crmAutonomyJob: { findUnique: async () => ({ companyId: 'co-1', conversationId: 'conv-1' }) },
      $transaction: async (run: any) => run(tx),
    };
    const repo = new PrismaCrmInboxRepository({ client } as any);

    assert.equal(await repo.updateAutonomyJob('job-1', { status: 'FAILED', lastError: 'secret', nextAttemptAt: new Date() }), null);
    assert.equal(updateCalls, 0);
  });

  it('does not enter a final provider callback when erasure wins the customer lock', async () => {
    let releaseGraph!: () => void;
    let graphWaitStarted!: () => void;
    const graphGate = new Promise<void>((resolve) => { releaseGraph = resolve; });
    const waiting = new Promise<void>((resolve) => { graphWaitStarted = resolve; });
    let erased = false;
    let callbacks = 0;
    const locks: string[] = [];
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        locks.push(sql);
        if (sql.includes('crm-customer:') && !sql.includes('identity-graph')) {
          graphWaitStarted();
          await graphGate;
        }
        return [];
      },
      crmCustomer: { findFirst: async () => erased ? null : { id: 'cust-1' } },
      crmConversation: { findFirst: async () => { throw new Error('must not inspect conversation'); } },
      crmChannelIdentity: { findFirst: async () => { throw new Error('must not load identity'); } },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);

    const pending = repo.withLiveCustomerLock(
      { companyId: 'co-1', customerId: 'cust-erased', conversationId: 'conv-1', channelIdentityId: 'idn-1' },
      async () => { callbacks += 1; return { ok: true }; },
    );
    await waiting;
    erased = true;
    releaseGraph();

    assert.equal(await pending, null);
    assert.equal(callbacks, 0);
    assert.equal(locks.some((sql) => sql.includes('crm-customer-identity-graph:')), false);
    assert.equal(locks.filter((sql) => sql.includes('crm-customer:')).length, 1);
  });

  it('does not enter an AI-assist callback after the conversation leaves the actor scope', async () => {
    let callbacks = 0;
    const tx = {
      $queryRaw: async () => [],
      crmCustomer: { findFirst: async () => ({ id: 'cust-1', consentStatus: 'GRANTED' }) },
      crmConversation: {
        findFirst: async () => ({ id: 'conv-1', assignedToUserId: 'staff-2' }),
      },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);

    await assert.rejects(
      () => repo.withLiveCustomerDataLock(
        {
          companyId: 'co-1', customerId: 'cust-1', conversationId: 'conv-1',
          actorScope: { actorUserId: 'staff-1', canAccessAll: false, expectedAssignedToUserId: null },
        },
        async () => { callbacks += 1; return { ok: true }; },
      ),
      /conversation_assignment_changed/,
    );
    assert.equal(callbacks, 0);
  });

  it('lets only one overlapping worker call the provider for the same pending reply attempt', async () => {
    const at = new Date('2026-07-12T00:00:00.000Z');
    let state: any = {
      ...messageRow(1),
      direction: 'OUTBOUND', authorType: 'STAFF', contentText: 'hello',
      deliveryStatus: 'PENDING', deliveryAttemptCount: 1,
    };
    let providerCalls = 0;
    const tx = {
      $queryRaw: async () => [],
      crmCustomer: { findFirst: async () => ({ id: 'cust-1', consentStatus: 'UNKNOWN' }) },
      crmConversation: { findFirst: async () => conversationRow('cust-1') },
      crmMessage: {
        findFirst: async (query: any) => {
          if (query.where.deliveryStatus && (state.deliveryStatus !== query.where.deliveryStatus || state.deliveryAttemptCount !== query.where.deliveryAttemptCount)) return null;
          return state;
        },
        updateMany: async (query: any) => {
          if (state.deliveryStatus !== query.where.deliveryStatus || state.deliveryAttemptCount !== query.where.deliveryAttemptCount) return { count: 0 };
          state = { ...state, ...query.data };
          return { count: 1 };
        },
      },
      companyMessagingChannel: { findFirst: async () => ({ id: 'ch-1', companyId: 'co-1', status: 'ACTIVE' }) },
      crmChannelIdentity: { findFirst: async () => ({ id: 'idn-1', companyId: 'co-1', channelId: 'ch-1', customerId: 'cust-1', status: 'ACTIVE', providerUserId: 'U1' }) },
    };
    let mutexTail = Promise.resolve();
    const client = {
      $transaction: async (run: any) => {
        const previous = mutexTail;
        let release!: () => void;
        mutexTail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try { return await run(tx); } finally { release(); }
      },
    };
    const repo = new PrismaCrmInboxRepository({ client } as any);
    const run = () => repo.processPendingReplyAttempt(
      { companyId: 'co-1', customerId: 'cust-1', conversationId: 'conv-1', messageId: 'msg-1', expectedAttemptCount: 1 },
      async () => {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { result: { ok: true }, messageUpdate: { deliveryStatus: 'SENT', sentAt: at } };
      },
    );

    const results = await Promise.all([run(), run()]);

    assert.equal(providerCalls, 1);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(state.deliveryStatus, 'SENT');
    assert.equal(state.deliveryAttemptCount, 2);
  });

  it('does not call or settle a stale pending reply when erasure wins the customer lock', async () => {
    let releaseLock!: () => void;
    let lockStarted!: () => void;
    const gate = new Promise<void>((resolve) => { releaseLock = resolve; });
    const waiting = new Promise<void>((resolve) => { lockStarted = resolve; });
    let erased = false;
    let providerCalls = 0;
    let updateCalls = 0;
    const tx = {
      $queryRaw: async () => { lockStarted(); await gate; return []; },
      crmCustomer: { findFirst: async () => erased ? null : ({ id: 'cust-1', consentStatus: 'UNKNOWN' }) },
      crmMessage: { updateMany: async () => { updateCalls += 1; return { count: 1 }; } },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    const pending = repo.processPendingReplyAttempt(
      { companyId: 'co-1', customerId: 'cust-1', conversationId: 'conv-1', messageId: 'msg-1', expectedAttemptCount: 1 },
      async () => { providerCalls += 1; return { result: { ok: true }, messageUpdate: { deliveryStatus: 'SENT' } }; },
    );
    await waiting;
    erased = true;
    releaseLock();

    assert.equal(await pending, null);
    assert.equal(providerCalls, 0);
    assert.equal(updateCalls, 0);
  });

  it('does not enter a provider callback for an archived customer', async () => {
    const findCustomer = mock.fn(async () => null);
    let callbacks = 0;
    const tx = {
      $queryRaw: async () => [],
      crmCustomer: { findFirst: findCustomer },
      crmChannelIdentity: { findFirst: async () => { throw new Error('must not load identity'); } },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);

    assert.equal(await repo.withLiveCustomerLock(
      { companyId: 'co-1', customerId: 'cust-archived' },
      async () => { callbacks += 1; return { ok: true }; },
    ), null);
    assert.equal(callbacks, 0);
    assert.equal((findCustomer.mock.calls as any[])[0].arguments[0].where.status, 'ACTIVE');
  });

  it('uses only the per-customer lock and denies archived AI/data callbacks', async () => {
    const locks: string[] = [];
    const findCustomer = mock.fn(async () => null);
    let callbacks = 0;
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray) => { locks.push(strings.join('?')); return []; },
      crmCustomer: { findFirst: findCustomer },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);

    assert.equal(await repo.withLiveCustomerDataLock(
      { companyId: 'co-1', customerId: 'cust-archived', conversationId: 'conv-1' },
      async () => { callbacks += 1; return { ok: true }; },
    ), null);
    assert.equal(callbacks, 0);
    assert.equal(locks.some((sql) => sql.includes('crm-customer-identity-graph:')), false);
    assert.equal(locks.filter((sql) => sql.includes('crm-customer:')).length, 1);
    assert.equal((findCustomer.mock.calls as any[])[0].arguments[0].where.status, 'ACTIVE');
    assert.equal((findCustomer.mock.calls as any[])[0].arguments[0].where.personalDataErasedAt, null);
  });

  it('excludes tombstoned customers from autonomy retry and reminder identity queries', async () => {
    const findJobs = mock.fn(async () => []);
    const findIdentity = mock.fn(async () => null);
    const repo = new PrismaCrmInboxRepository({
      client: {
        crmAutonomyJob: { findMany: findJobs },
        crmChannelIdentity: { findFirst: findIdentity },
      },
    } as any);

    assert.deepEqual(await repo.findRetryableAutonomyJobs(new Date(), 60_000, 3, 20), []);
    assert.equal(await repo.findActiveIdentityForCustomer('co-1', 'cust-erased'), null);
    assert.deepEqual((findJobs.mock.calls as any[])[0].arguments[0].where.conversation, {
      customer: { status: 'ACTIVE', personalDataErasedAt: null },
    });
    assert.deepEqual((findIdentity.mock.calls as any[])[0].arguments[0].where.customer, {
      status: 'ACTIVE', personalDataErasedAt: null,
    });
  });
});

describe('CrmAiContextRepository personal-data tombstone writers', () => {
  it('drops trust, advisory, and summary final saves after erasure', async () => {
    let customerWrites = 0;
    let conversationWrites = 0;
    const tx = {
      $queryRaw: async () => [],
      crmCustomer: {
        findFirst: async () => null,
        updateMany: async () => { customerWrites += 1; return { count: 1 }; },
      },
      crmConversation: {
        findFirst: async () => ({ customerId: 'cust-erased' }),
        updateMany: async () => { conversationWrites += 1; return { count: 1 }; },
      },
    };
    const repo = new CrmAiContextRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    assert.equal(await repo.saveTrustScore('co-1', 'cust-erased', 99, [], new Date()), false);
    assert.equal(await repo.updateCustomerAdvisory('co-1', 'cust-erased', { leadScore: 99, sentiment: 'POSITIVE', riskLevel: 'LOW' }), false);
    assert.equal(await repo.saveConversationSummary('co-1', 'conv-1', 'secret summary', new Date()), false);
    assert.equal(customerWrites, 0);
    assert.equal(conversationWrites, 0);
  });

  it('excludes tombstoned customers from both trust scanner SQL branches', async () => {
    const sql: string[] = [];
    const repo = new CrmAiContextRepository({
      client: {
        $queryRaw: async (strings: TemplateStringsArray) => { sql.push(strings.join('?')); return []; },
      },
    } as any);
    assert.deepEqual(await repo.findTrustScanCandidates(new Date('2026-07-12T00:00:00.000Z')), []);
    assert.equal(sql.length, 2);
    assert.equal(sql.every((query) => query.includes('"personalDataErasedAt" IS NULL')), true);
  });
});

describe('PrismaCrmInboxRepository erased LINE identifier lookup', () => {
  it('falls back to the keyed pseudonym for inbound suppression and redelivery idempotency', async () => {
    const identityLookups: string[] = [];
    const messageLookups: string[] = [];
    const now = new Date('2026-07-12T00:00:00.000Z');
    const identityRow = {
      id: 'identity-1', companyId: 'co-1', channelId: 'channel-1', customerId: 'customer-erased',
      provider: 'LINE_OA', providerUserId: '', displayName: null, pictureUrl: null,
      followedAt: null, unfollowedAt: null, verifiedLinkAt: null, verifiedLinkVia: null,
      status: 'ACTIVE', createdAt: now, updatedAt: now,
    };
    const prisma = {
      client: {
        crmChannelIdentity: {
          findUnique: async (args: any) => {
            const value = args.where.channelId_providerUserId.providerUserId as string;
            identityLookups.push(value);
            return value.startsWith('pdpa-hmac-v2:') ? { ...identityRow, providerUserId: value } : null;
          },
        },
        crmMessage: {
          findUnique: async (args: any) => {
            const value = args.where.companyId_providerMessageId.providerMessageId as string;
            messageLookups.push(value);
            return value.startsWith('pdpa-hmac-v2:') ? { ...messageRow(1), providerMessageId: value } : null;
          },
        },
      },
    } as any;
    const repo = new PrismaCrmInboxRepository(prisma, {
      pdpaPseudonymizationKeyRing: { current: Buffer.alloc(32, 7), previous: [] },
    } as any);

    const identity = await repo.findIdentity('channel-1', 'U-raw-provider-id');
    const message = await repo.findMessageByProviderId('co-1', 'raw-provider-message-id');

    assert.equal(identity?.id, 'identity-1');
    assert.equal(message?.id, 'msg-1');
    assert.equal(identityLookups[0], 'U-raw-provider-id');
    assert.match(identityLookups[1]!, /^pdpa-hmac-v2:[0-9a-f]{16}:[0-9a-f]{64}$/);
    assert.equal(messageLookups[0], 'raw-provider-message-id');
    assert.match(messageLookups[1]!, /^pdpa-hmac-v2:[0-9a-f]{16}:[0-9a-f]{64}$/);
  });
});

describe('PrismaCrmInboxRepository.eraseCustomerData', () => {
  it('follows a merged alias, locks the canonical graph, and scrubs direct + profiled PII atomically', async () => {
    const identityUpdate = mock.fn(async () => ({ id: 'identity-1' }));
    const messageIdentifierUpdate = mock.fn(async () => ({ id: 'message-1' }));
    const contactUpdate = mock.fn(async () => ({ count: 1 }));
    const customerUpdate = mock.fn(async () => ({ count: 1 }));
    const conversationUpdate = mock.fn(async (_args: any) => ({ count: 1 }));
    const bookingUpdate = mock.fn(async () => ({ count: 1 }));
    const leadUpdate = mock.fn(async () => ({ count: 1 }));
    const activityUpdate = mock.fn(async () => ({ count: 1 }));
    const followUpUpdate = mock.fn(async () => ({ count: 1 }));
    const opportunityUpdate = mock.fn(async () => ({ count: 1 }));
    const feedbackUpdate = mock.fn(async () => ({ count: 1 }));
    const autonomyUpdate = mock.fn(async () => ({ count: 1 }));
    const outboxUpdate = mock.fn(async () => ({ id: 'outbox-1' }));
    const outboxCreate = mock.fn(async () => ({ id: 'event-erase' }));
    // L-11 fixtures: a forensic audit row and a forensic outbox payload that mix
    // personal data with amounts/checksums/counts that must survive erasure.
    const auditFind = mock.fn(async () => [
      {
        id: 'audit-old-1',
        metadataJson: {
          customerName: 'สมชาย ใจดี', primaryPhone: '0812345678', note: 'called back',
          grandTotalAmount: '1250.00', checksumSha256: 'abc123', reason: 'late payment',
          reasonCode: 'AR_OVERDUE', result: 'SUCCESS', messagesRedacted: 3,
        },
      },
      { id: 'audit-old-2', metadataJson: { grandTotalAmount: '9.00', result: 'SUCCESS' } },
    ]);
    const outboxFind = mock.fn(async () => [
      {
        id: 'outbox-1',
        payloadJson: {
          companyId: 'co-1', eventType: 'crm.booking.created', occurredAt: '2026-07-01T00:00:00.000Z',
          aggregateType: 'crm_booking', aggregateId: 'booking-1',
          data: { customerName: 'สมชาย ใจดี', depositAmount: '500.00', status: 'BOOKED' },
        },
      },
    ]);
    const auditUpdate = mock.fn(async () => ({ id: 'audit-old-1' }));
    const auditCreate = mock.fn(async (args: any) => ({ id: args?.data?.action === 'crm.customer.erase' ? 'audit-erase' : 'audit-correction' }));
    const notificationUpdate = mock.fn(async () => ({ count: 2 }));
    const notificationDeliveryUpdate = mock.fn(async () => ({ count: 4 }));
    const attachmentUpdate = mock.fn(async () => ({ count: 1 }));
    const activityFind = mock.fn(async () => [
      { id: 'activity-direct' },
      { id: 'activity-opportunity-only' },
      { id: 'activity-converted-lead-only' },
    ]);
    const followUpFind = mock.fn(async () => [
      { id: 'follow-up-direct' },
      { id: 'follow-up-opportunity-only' },
      { id: 'follow-up-converted-lead-only' },
    ]);
    const operationOrder: string[] = [];
    const locks: string[] = [];
    let erasureTransactionOptions: unknown;
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray) => { locks.push(strings.join('?')); return []; },
      crmCustomer: {
        findFirst: async (args: any) => args.where.id === 'cust-secondary'
          ? { id: 'cust-secondary', status: 'MERGED', mergedIntoCustomerId: 'cust-primary' }
          : { id: 'cust-primary', status: 'ACTIVE', mergedIntoCustomerId: null },
        findMany: async () => [],
        updateMany: customerUpdate,
      },
      crmConversation: {
        findMany: async () => [{ id: 'conv-1' }],
        updateMany: async (args: any) => { operationOrder.push('conversation'); return conversationUpdate(args); },
      },
      crmMessage: {
        findMany: async () => [
          { id: 'msg-clean', messageType: 'IMAGE', attachmentId: 'att-clean', providerMessageId: 'line-message-clean', webhookEventId: 'line-event-clean' },
          { id: 'msg-finance', messageType: 'IMAGE', attachmentId: 'att-finance', providerMessageId: 'line-message-finance', webhookEventId: 'line-event-finance' },
        ],
        updateMany: async () => { operationOrder.push('message'); return { count: 5 }; },
        update: messageIdentifierUpdate,
      },
      crmAiAssistFeedback: { updateMany: feedbackUpdate },
      crmAutonomyJob: { updateMany: autonomyUpdate },
      attachmentObject: {
        findMany: async () => [
          { id: 'att-clean', status: 'ACTIVE', links: [] },
          { id: 'att-finance', status: 'ACTIVE', links: [{ id: 'link-1' }] },
        ],
        updateMany: attachmentUpdate,
      },
      attachmentBlob: { deleteMany: async () => ({ count: 1 }) },
      crmChannelIdentity: {
        findMany: async () => [{ id: 'identity-1', channelId: 'channel-1', providerUserId: 'U-raw-provider-id' }],
        update: identityUpdate,
      },
      crmContactPerson: { findMany: async () => [{ id: 'contact-1' }], updateMany: contactUpdate },
      crmBooking: { findMany: async () => [{ id: 'booking-1' }], updateMany: bookingUpdate },
      crmLead: { findMany: async () => [{ id: 'lead-converted' }], updateMany: leadUpdate },
      crmActivity: { findMany: activityFind, updateMany: activityUpdate },
      crmFollowUpTask: { findMany: followUpFind, updateMany: followUpUpdate },
      crmOpportunity: { findMany: async () => [{ id: 'opportunity-1' }], updateMany: opportunityUpdate },
      notificationEvent: {
        findMany: async () => [{ id: 'notification-1' }, { id: 'notification-2' }],
        updateMany: notificationUpdate,
      },
      notificationRecipient: {
        findMany: async () => [{ id: 'recipient-1' }, { id: 'recipient-2' }],
      },
      notificationDelivery: { updateMany: notificationDeliveryUpdate },
      auditLog: { findMany: auditFind, update: auditUpdate, create: auditCreate },
      outboxEvent: { findUnique: async () => null, findMany: outboxFind, update: outboxUpdate, create: outboxCreate },
    };
    const prisma = {
      client: {
        $transaction: async (run: any, options: unknown) => {
          erasureTransactionOptions = options;
          return run(tx);
        },
      },
    } as any;
    const repo = new PrismaCrmInboxRepository(prisma, {
      pdpaPseudonymizationKeyRing: { current: Buffer.alloc(32, 7), previous: [] },
    } as any);

    const result = await repo.eraseCustomerData({
      companyId: 'co-1',
      customerId: 'cust-secondary',
      now: new Date('2026-07-12T00:00:00.000Z'),
      marker: { purged: true },
      erasedDisplayName: 'ลูกค้าที่ขอลบข้อมูล (PDPA)',
      actorUserId: 'admin-1',
      requestId: 'req-erase-1',
      reason: 'customer request',
    });

    assert.deepEqual(result, {
      customerId: 'cust-primary', messagesRedacted: 5, mediaPurged: 1,
      conversations: 1, retainedFinanceAttachments: 1,
      auditLogId: 'audit-erase',
      evidenceEventKey: 'crm.customer.personal_data_erased:crm_customer:cust-primary:req-erase-1',
    });
    assert.equal(locks[0].includes('crm-customer-identity-graph:'), true);
    assert.equal(locks.slice(1).every((sql) => sql.includes('crm-customer:')), true);
    assert.deepEqual(operationOrder, ['conversation', 'message']);
    assert.deepEqual(erasureTransactionOptions, { maxWait: 10_000, timeout: 120_000 });

    const autonomyArgs = (autonomyUpdate.mock.calls as any[])[0]?.arguments[0];
    assert.deepEqual(autonomyArgs.where, { companyId: 'co-1', conversationId: { in: ['conv-1'] } });
    assert.deepEqual(autonomyArgs.data, {
      status: 'DONE', replyToken: null, replyTokenAt: null, nextAttemptAt: null, lastError: null,
    });

    const contactArgs = (contactUpdate.mock.calls as any[])[0]?.arguments[0];
    assert.deepEqual(contactArgs.where, { companyId: 'co-1', customerId: { in: ['cust-secondary', 'cust-primary'] } });
    assert.deepEqual(contactArgs.data, {
      name: 'ลูกค้าที่ขอลบข้อมูล (PDPA)',
      role: null,
      phone: null,
      phoneNormalized: null,
      email: null,
      emailNormalized: null,
      lineUserId: null,
      preferredChannel: null,
      consentStatus: 'REVOKED',
      note: null,
    });

    const conversationArgs = (conversationUpdate.mock.calls as any[])[0]?.arguments[0];
    assert.deepEqual({ ...conversationArgs.data, tagsJson: undefined }, {
      lastMessagePreview: null, aiSummaryText: null, aiSummaryAt: null, tagsJson: undefined,
    });
    assert.equal(conversationArgs.data.tagsJson.constructor.name, 'DbNull');

    const attachmentArgs = (attachmentUpdate.mock.calls as any[])[0]?.arguments[0];
    assert.deepEqual(attachmentArgs.where, { id: { in: ['att-clean'] } });
    assert.deepEqual({ ...attachmentArgs.data, metadataJson: undefined }, {
      status: 'DELETED', deletedAt: new Date('2026-07-12T00:00:00.000Z'), originalFileName: 'erased',
      objectKey: 'erased', byteSize: 0, checksumSha256: null, metadataJson: undefined,
    });
    assert.equal(attachmentArgs.data.metadataJson.constructor.name, 'DbNull');
    const retainedAttachmentArgs = (attachmentUpdate.mock.calls as any[])[1]?.arguments[0];
    assert.deepEqual(retainedAttachmentArgs, {
      where: {
        id: 'att-finance',
        originalFileName: { in: ['image-line-message-finance', 'media-line-message-finance'] },
      },
      data: { originalFileName: 'retained-document' },
    });

    const identityArgs = (identityUpdate.mock.calls as any[])[0]?.arguments[0];
    assert.equal(identityArgs.where.id, 'identity-1');
    assert.match(identityArgs.data.providerUserId, /^pdpa-hmac-v2:[0-9a-f]{16}:[0-9a-f]{64}$/);
    assert.equal(identityArgs.data.providerUserId.includes('U-raw-provider-id'), false);
    assert.equal(identityArgs.data.displayName, null);
    assert.equal(identityArgs.data.pictureUrl, null);

    const messageIdentifierCalls = messageIdentifierUpdate.mock.calls as any[];
    assert.equal(messageIdentifierCalls.length, 2);
    for (const call of messageIdentifierCalls) {
      assert.match(call.arguments[0].data.providerMessageId, /^pdpa-hmac-v2:[0-9a-f]{16}:[0-9a-f]{64}$/);
      assert.match(call.arguments[0].data.webhookEventId, /^pdpa-hmac-v2:[0-9a-f]{16}:[0-9a-f]{64}$/);
    }
    assert.equal(messageIdentifierCalls[1]?.arguments[0].where.id, 'msg-finance', 'legal retention never requires raw provider ids');

    const customerCalls = customerUpdate.mock.calls as any[];
    assert.deepEqual(customerCalls.map((call) => call.arguments[0].where.id), ['cust-secondary', 'cust-primary']);
    assert.notEqual(customerCalls[0].arguments[0].data.marketingRef, customerCalls[1].arguments[0].data.marketingRef);
    const customerArgs = customerCalls[1]?.arguments[0];
    assert.equal(customerArgs.where.id, 'cust-primary');
    assert.match(customerArgs.data.marketingRef, /^[0-9a-f-]{36}$/i);
    assert.equal(customerArgs.data.displayName, 'ลูกค้าที่ขอลบข้อมูล (PDPA)');
    assert.equal(customerArgs.data.displayNameNormalized, 'ลูกค้าที่ขอลบข้อมูล (pdpa)');
    assert.equal(customerArgs.data.taxId, null);
    assert.equal(customerArgs.data.taxIdNormalized, null);
    assert.equal(customerArgs.data.lineUserId, null);
    assert.equal(customerArgs.data.leadScore, null);
    assert.equal(customerArgs.data.sentiment, null);
    assert.equal(customerArgs.data.riskLevel, null);
    assert.equal(customerArgs.data.tier, 'LEAD');
    assert.equal(customerArgs.data.engagementScore, 0);
    assert.equal(customerArgs.data.trustScore, null);
    assert.equal(customerArgs.data.lastActivityAt, null);
    assert.equal(customerArgs.data.originSource, 'OTHER');
    assert.equal(customerArgs.data.personalDataErasedAt.toISOString(), '2026-07-12T00:00:00.000Z');
    const outboxScopeWhere = (outboxFind.mock.calls as any[])[0]?.arguments[0].where;
    assert.deepEqual(outboxScopeWhere.eventType, { not: 'crm.customer.personal_data_erased' });
    assert.deepEqual(outboxScopeWhere.OR, [
      { aggregateType: 'crm_customer', aggregateId: { in: ['cust-secondary', 'cust-primary'] } },
      { aggregateType: 'crm_contact', aggregateId: { in: ['contact-1'] } },
      { aggregateType: 'crm_conversation', aggregateId: { in: ['conv-1'] } },
      { aggregateType: 'crm_booking', aggregateId: { in: ['booking-1'] } },
      { aggregateType: 'crm_lead', aggregateId: { in: ['lead-converted'] } },
      { aggregateType: 'crm_opportunity', aggregateId: { in: ['opportunity-1'] } },
      { aggregateType: 'crm_activity', aggregateId: { in: ['activity-direct', 'activity-opportunity-only', 'activity-converted-lead-only'] } },
      { aggregateType: 'crm_follow_up', aggregateId: { in: ['follow-up-direct', 'follow-up-opportunity-only', 'follow-up-converted-lead-only'] } },
    ]);
    // L-11: field-level, not a blanket overwrite. The envelope and the non-personal
    // fields inside `data` survive; only the personal field is replaced.
    const outboxCalls = outboxUpdate.mock.calls as any[];
    assert.equal(outboxCalls.length, 1);
    assert.equal(outboxCalls[0].arguments[0].where.id, 'outbox-1');
    const redactedPayload = outboxCalls[0].arguments[0].data.payloadJson;
    assert.equal(redactedPayload.companyId, 'co-1');
    assert.equal(redactedPayload.eventType, 'crm.booking.created');
    assert.equal(redactedPayload.occurredAt, '2026-07-01T00:00:00.000Z');
    assert.equal(redactedPayload.aggregateId, 'booking-1');
    assert.equal(redactedPayload.data.customerName, '[PDPA_ERASED]');
    assert.equal(redactedPayload.data.depositAmount, '500.00');
    assert.equal(redactedPayload.data.status, 'BOOKED');

    assert.deepEqual((bookingUpdate.mock.calls as any[])[0]?.arguments[0], {
      where: { companyId: 'co-1', id: { in: ['booking-1'] } },
      data: { customerName: null },
    });
    const leadData = (leadUpdate.mock.calls as any[])[0]?.arguments[0].data;
    for (const key of ['rawName', 'rawPhone', 'rawPhoneNormalized', 'rawEmail', 'rawEmailNormalized', 'sourceRefId', 'note']) {
      assert.equal(leadData[key], null);
    }
    assert.equal((feedbackUpdate.mock.calls as any[])[0]?.arguments[0].data.comment, null);
    assert.deepEqual((activityFind.mock.calls as any[])[0]?.arguments[0].where.OR, [
      { customerId: { in: ['cust-secondary', 'cust-primary'] } },
      { opportunityId: { in: ['opportunity-1'] } },
      { leadId: { in: ['lead-converted'] } },
    ]);
    assert.deepEqual((activityUpdate.mock.calls as any[])[0]?.arguments[0].where, {
      companyId: 'co-1',
      id: { in: ['activity-direct', 'activity-opportunity-only', 'activity-converted-lead-only'] },
    });
    assert.equal((activityUpdate.mock.calls as any[])[0]?.arguments[0].data.note, 'ลูกค้าที่ขอลบข้อมูล (PDPA)');
    assert.deepEqual((followUpFind.mock.calls as any[])[0]?.arguments[0].where.OR, [
      { customerId: { in: ['cust-secondary', 'cust-primary'] } },
      { opportunityId: { in: ['opportunity-1'] } },
      { leadId: { in: ['lead-converted'] } },
    ]);
    assert.deepEqual((followUpUpdate.mock.calls as any[])[0]?.arguments[0].where, {
      companyId: 'co-1',
      id: { in: ['follow-up-direct', 'follow-up-opportunity-only', 'follow-up-converted-lead-only'] },
    });
    assert.equal((followUpUpdate.mock.calls as any[])[0]?.arguments[0].data.cancelReason, null);
    const opportunityData = (opportunityUpdate.mock.calls as any[])[0]?.arguments[0].data;
    assert.deepEqual({ ...opportunityData, quotationSummaryJson: undefined }, {
      title: 'ลูกค้าที่ขอลบข้อมูล (PDPA)', closeReason: null, lostReason: null, quotationSummaryJson: undefined,
    });
    assert.equal(opportunityData.quotationSummaryJson.constructor.name, 'DbNull');
    // L-11: audit rows are redacted field by field, and the row skeleton is untouched.
    const auditScopeWhere = (auditFind.mock.calls as any[])[0]?.arguments[0].where;
    assert.equal(auditScopeWhere.companyId, 'co-1');
    assert.equal(auditScopeWhere.OR.some((scope: any) => scope.targetType === 'crm_conversation'), true);
    const auditRedactCalls = auditUpdate.mock.calls as any[];
    assert.equal(auditRedactCalls.length, 1, 'only the row that actually held personal data is rewritten');
    assert.deepEqual(auditRedactCalls[0].arguments[0].where, { id: 'audit-old-1' });
    assert.deepEqual(Object.keys(auditRedactCalls[0].arguments[0].data), ['metadataJson']);
    const redactedMetadata = auditRedactCalls[0].arguments[0].data.metadataJson;
    assert.equal(redactedMetadata.customerName, '[PDPA_ERASED]');
    assert.equal(redactedMetadata.primaryPhone, '[PDPA_ERASED]');
    assert.equal(redactedMetadata.note, '[PDPA_ERASED]');
    // Non-personal forensic content survives — the whole point of the finding.
    assert.equal(redactedMetadata.grandTotalAmount, '1250.00');
    assert.equal(redactedMetadata.checksumSha256, 'abc123');
    assert.equal(redactedMetadata.reason, 'late payment');
    assert.equal(redactedMetadata.reasonCode, 'AR_OVERDUE');
    assert.equal(redactedMetadata.result, 'SUCCESS');
    assert.equal(redactedMetadata.messagesRedacted, 3);
    assert.deepEqual(redactedMetadata.personalDataRedaction, {
      redacted: true, at: '2026-07-12T00:00:00.000Z', keys: ['customerName', 'note', 'primaryPhone'],
    });
    const notificationArgs = (notificationUpdate.mock.calls as any[])[0]?.arguments[0];
    assert.deepEqual(notificationArgs.where, {
      companyId: 'co-1',
      OR: [
        { sourceType: 'crm_conversation', sourceId: { in: ['conv-1'] } },
        { sourceType: 'crm_booking', sourceId: { in: ['booking-1'] } },
        { sourceType: 'crm_customer', sourceId: { in: ['cust-secondary', 'cust-primary'] } },
      ],
    });
    assert.deepEqual(notificationArgs.data, {
      title: 'ข้อมูลลูกค้าถูกลบแล้ว',
      body: 'รายการนี้ถูกปิดตามคำขอลบข้อมูลส่วนบุคคล',
      payloadJson: { personalDataErased: true },
      sourceRefsJson: [],
      deepLinkHref: null,
      status: 'RESOLVED',
      resolvedAt: new Date('2026-07-12T00:00:00.000Z'),
    });
    const notificationDeliveryArgs = (notificationDeliveryUpdate.mock.calls as any[])[0]?.arguments[0];
    assert.deepEqual(notificationDeliveryArgs, {
      where: {
        companyId: 'co-1',
        recipientId: { in: ['recipient-1', 'recipient-2'] },
        status: { in: ['QUEUED', 'FAILED'] },
      },
      data: {
        status: 'SUPPRESSED',
        nextAttemptAt: null,
        errorCode: 'CUSTOMER_PERSONAL_DATA_ERASED',
        errorMessage: 'Customer-linked notification suppressed after personal data erasure',
        metadataJson: { personalDataErased: true },
      },
    });
    const auditArgs = (auditCreate.mock.calls as any[])[0]?.arguments[0].data;
    assert.equal(auditArgs.action, 'crm.customer.erase');
    assert.equal(auditArgs.riskLevel, 'CRITICAL');
    assert.equal(auditArgs.requestId, 'req-erase-1');
    assert.equal(auditArgs.metadataJson.reasonProvided, true);
    assert.equal('reason' in auditArgs.metadataJson, false);
    // L-11: append-only correction event describing the redaction scope and counts.
    const correctionArgs = (auditCreate.mock.calls as any[])[1]?.arguments[0].data;
    assert.equal(correctionArgs.action, 'pdpa.audit.redacted');
    assert.equal(correctionArgs.targetId, 'cust-primary');
    assert.equal(correctionArgs.requestId, 'req-erase-1');
    assert.equal(correctionArgs.result, 'SUCCESS');
    assert.equal(correctionArgs.metadataJson.erasureAuditLogId, 'audit-erase');
    assert.equal(correctionArgs.metadataJson.auditRowsScanned, 2);
    assert.equal(correctionArgs.metadataJson.auditRowsRedacted, 1);
    assert.equal(correctionArgs.metadataJson.outboxRowsRedacted, 1);
    assert.equal(correctionArgs.metadataJson.scopes.some((scope: any) => scope.targetType === 'crm_conversation'), true);
    const evidenceArgs = (outboxCreate.mock.calls as any[])[0]?.arguments[0].data;
    assert.equal(evidenceArgs.eventKey, 'crm.customer.personal_data_erased:crm_customer:cust-primary:req-erase-1');
    assert.equal(evidenceArgs.payloadJson.data.auditLogId, 'audit-erase');
    assert.equal(evidenceArgs.payloadJson.data.reasonProvided, true);
    assert.equal('reason' in evidenceArgs.payloadJson.data, false);
  });

  it('returns prior atomic evidence for the same request without re-running destructive writes or duplicate audit', async () => {
    let customerUpdates = 0;
    let auditCreates = 0;
    const tx = {
      $queryRaw: async () => [],
      crmCustomer: {
        findFirst: async () => ({ id: 'cust-1', status: 'ACTIVE', mergedIntoCustomerId: null }),
        findMany: async () => [],
        updateMany: async () => { customerUpdates += 1; return { count: 1 }; },
      },
      outboxEvent: {
        findUnique: async () => ({
          payloadJson: { data: { messagesRedacted: 4, mediaPurged: 2, conversations: 1, retainedFinanceAttachments: 3, auditLogId: 'audit-existing' } },
        }),
      },
      auditLog: { create: async () => { auditCreates += 1; } },
    };
    const repo = new PrismaCrmInboxRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);

    const result = await repo.eraseCustomerData({
      companyId: 'co-1', customerId: 'cust-1', now: new Date(), marker: { purged: true },
      erasedDisplayName: 'erased', actorUserId: 'admin-1', requestId: 'req-same',
    });

    assert.deepEqual(result, {
      customerId: 'cust-1', messagesRedacted: 4, mediaPurged: 2, conversations: 1,
      retainedFinanceAttachments: 3, auditLogId: 'audit-existing',
      evidenceEventKey: 'crm.customer.personal_data_erased:crm_customer:cust-1:req-same',
    });
    assert.equal(customerUpdates, 0);
    assert.equal(auditCreates, 0);
  });
});
