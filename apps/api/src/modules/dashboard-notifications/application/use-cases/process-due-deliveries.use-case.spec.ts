import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LAUNCH_SHADOW_READ_FAILED_EVENT, LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import {
  CreateOrUpdateNotificationEventUseCase,
  CreateDailyOwnerSummaryUseCase,
  ProcessDueNotificationDeliveriesUseCase,
  ProcessQueuedDeliveryUseCase,
} from './notification.use-cases';
import {

  CreateDailyOwnerSummariesSweepUseCase,
  GenerateDashboardSnapshotsSweepUseCase,
  ScanStockLowNotificationsSweepUseCase,
} from './notification-sweeps.use-cases';

/**
 * Shadow probe double (piece 5). Recording into module-level arrays and asserting on the DELTA
 * keeps every pre-existing test untouched.
 */
const shadowRecords: Array<{ surface: string; companyId: string | null; featureKey: string | null }> = [];
const shadowFlushes: string[] = [];
const shadowProbe = {
  startSweep: (surface: string) => ({
    record: async (companyId: string | null, featureKey: string | null) => {
      shadowRecords.push({ surface, companyId, featureKey });
      return { wouldBlock: false, reason: 'available' as const };
    },
    flush: async () => { shadowFlushes.push(surface); return {}; },
  }),
} as any;


function makeSut(due: Array<{ id: string; companyId: string }>, failIds: string[] = []) {
  const processed: string[] = [];
  const deliveries = { findDue: async () => due } as any;
  const processDelivery = {
    execute: async (companyId: string, id: string) => {
      if (failIds.includes(id)) throw new Error('boom');
      processed.push(id);
      return { id, status: 'SENT' };
    },
  } as any;
  return { sut: new ProcessDueNotificationDeliveriesUseCase(deliveries, processDelivery, shadowProbe), processed };
}

describe('ProcessDueNotificationDeliveriesUseCase (A4)', () => {
  it('processes every due delivery and reports the count', async () => {
    const { sut, processed } = makeSut([
      { id: 'd1', companyId: 'c1' },
      { id: 'd2', companyId: 'c2' },
    ]);
    const result = await sut.execute();
    assert.deepEqual(result, { processed: 2, failures: 0 });
    assert.deepEqual(processed, ['d1', 'd2']);
  });

  it('one delivery failure never aborts the rest of the sweep', async () => {
    const { sut, processed } = makeSut(
      [
        { id: 'd1', companyId: 'c1' },
        { id: 'd2', companyId: 'c2' },
        { id: 'd3', companyId: 'c3' },
      ],
      ['d2'],
    );
    const result = await sut.execute();
    assert.deepEqual(result, { processed: 3, failures: 1 });
    assert.deepEqual(processed, ['d1', 'd3']);
  });

  it('empty due set is a no-op', async () => {
    const { sut } = makeSut([]);
    assert.deepEqual(await sut.execute(), { processed: 0, failures: 0 });
  });
});

describe('CreateOrUpdateNotificationEventUseCase recipients', () => {
  it('creates deliveries only for distinct ACTIVE company members', async () => {
    const createdRecipients: string[] = [];
    const event = { id: 'event-1', status: 'open' };
    const useCase = new CreateOrUpdateNotificationEventUseCase(
      { findByDedupKey: async () => null, create: async () => event } as any,
      {
        findByEventAndUser: async () => null,
        create: async (data: any) => { createdRecipients.push(data.userId); return { id: `recipient-${data.userId}` }; },
      } as any,
      { create: async () => ({}) } as any,
      { findByDedupKey: async () => null, upsert: async () => ({}) } as any,
      { findByTriggerKey: async () => null } as any,
      {
        client: {
          notificationDelivery: { findFirst: async () => null },
          companyMembership: {
            findMany: async (query: any) => {
              assert.deepEqual(query.where.userId.in, ['active-user', 'inactive-user']);
              assert.equal(query.where.status, 'ACTIVE');
              return [{ userId: 'active-user' }];
            },
          },
        },
      } as any,
    );

    await useCase.execute({
      companyId: 'co-1', triggerKey: 'crm_sla_breach', sourceModule: 'crm_inbox', sourceType: 'crm_conversation',
      sourceId: 'conv-1', severity: 'action', title: 'SLA', body: 'Needs reply',
      recipientUserIds: ['active-user', 'inactive-user', 'active-user'],
    });

    assert.deepEqual(createdRecipients, ['active-user']);
  });
});

describe('ProcessQueuedDeliveryUseCase LINE target resolution', () => {
  it('delivers through the configured shared OA channel when the company has no binding row', async () => {
    const identityQueries: any[] = [];
    const updates: any[] = [];
    const prisma = {
      client: {
        notificationDelivery: {
          findFirst: async () => ({
            id: 'delivery-1', companyId: 'co-1', channel: 'LINE', status: 'QUEUED', attemptCount: 0,
            recipient: {
              userId: 'user-1',
              event: {
                triggerKey: 'workflow.reimbursement_pending_approval', severity: 'ACTION',
                title: 'อนุมัติเบิกจ่าย: RB-202608-00002', body: 'ยอด 40 THB · รออนุมัติจากคุณ',
                deepLinkHref: '/companies/co-1/reimbursements?tab=approvals&focus=rb-1',
              },
            },
          }),
        },
        notificationPreference: { findUnique: async () => null },
        lineChannelBinding: { findFirst: async () => null },
        externalIdentity: {
          findFirst: async (query: any) => {
            identityQueries.push(query);
            return { providerUserId: 'line-user-1' };
          },
        },
      },
    } as any;
    prisma.client.$transaction = async (run: any) => run({
      notificationDelivery: {
        findFirst: async () => ({
          id: 'delivery-1', companyId: 'co-1', channel: 'LINE', status: 'QUEUED', attemptCount: 0,
          recipient: { userId: 'user-1', event: {
            status: 'OPEN', triggerKey: 'workflow.reimbursement_pending_approval', severity: 'ACTION',
            title: 'อนุมัติเบิกจ่าย: RB-202608-00002', body: 'ยอด 40 THB · รออนุมัติจากคุณ',
            deepLinkHref: '/companies/co-1/reimbursements?tab=approvals&focus=rb-1',
          } },
        }),
        updateMany: async (query: any) => { updates.push(query.data); return { count: 1 }; },
        update: async (query: any) => { updates.push(query.data); return query.data; },
      },
      $queryRaw: async () => [{ id: 'membership-1' }],
    });
    const deliveries = {
      update: async (_companyId: string, _deliveryId: string, data: any) => {
        updates.push(data);
        return data;
      },
    } as any;
    const originalFetch = globalThis.fetch;
    const originalWebBaseUrl = process.env['WEB_BASE_URL'];
    const requests: Array<{ input: any; init: any }> = [];
    try {
      process.env['WEB_BASE_URL'] = 'https://uat.mangmeeplus.com';
      globalThis.fetch = (async (input: any, init: any) => {
        requests.push({ input, init });
        return new Response(JSON.stringify({ sentMessages: [{ id: 'line-message-1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;
      const useCase = new ProcessQueuedDeliveryUseCase(
        prisma,
        deliveries,
        { log: async () => undefined } as any,
        { lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any,
      );

      await useCase.execute('co-1', 'delivery-1');

      assert.equal(identityQueries[0]?.where.providerChannelId, 'shared-channel');
      assert.equal(requests[0]?.init.headers.Authorization, 'Bearer shared-token');
      assert.match(requests[0]?.init.headers['X-Line-Retry-Key'], /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const payload = JSON.parse(requests[0]?.init.body);
      assert.equal(payload.messages[0]?.type, 'flex');
      assert.equal(payload.messages[0]?.contents.footer.contents[0]?.action.type, 'uri');
      assert.equal(
        payload.messages[0]?.contents.footer.contents[0]?.action.uri,
        'https://uat.mangmeeplus.com/companies/co-1/reimbursements?tab=approvals&focus=rb-1',
      );
      assert.match(payload.messages[0]?.altText, /RB-202608-00002/);
      assert.doesNotMatch(JSON.stringify(payload.messages[0]?.contents.body), /https:\/\//, 'no naked URL or LINE link preview');
      assert.equal(updates.at(-1)?.status, 'SENT');
      assert.equal(updates.at(-1)?.providerMessageId, 'line-message-1');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalWebBaseUrl === undefined) delete process.env['WEB_BASE_URL'];
      else process.env['WEB_BASE_URL'] = originalWebBaseUrl;
    }
  });

  it('records a 409 with LINE accepted-request evidence as sent', async () => {
    const updates: any[] = [];
    const delivery = {
      id: 'delivery-accepted', companyId: 'co-1', channel: 'LINE', status: 'QUEUED', attemptCount: 0,
      recipient: { userId: 'user-1', event: { triggerKey: 'stock_low', severity: 'INFO', title: 'Low stock', body: 'SKU-1', deepLinkHref: null } },
    };
    const prisma = {
      client: {
        notificationDelivery: { findFirst: async () => delivery },
        notificationPreference: { findUnique: async () => null },
        externalIdentity: { findFirst: async () => ({ providerUserId: 'line-user-1' }) },
      },
    } as any;
    prisma.client.$transaction = async (run: any) => run({
      notificationDelivery: {
        findFirst: async () => ({ ...delivery, recipient: { ...delivery.recipient, event: { ...delivery.recipient.event, status: 'OPEN' } } }),
        updateMany: async (query: any) => { updates.push(query.data); return { count: 1 }; },
        update: async (query: any) => { updates.push(query.data); return query.data; },
      },
      $queryRaw: async () => [{ id: 'membership-1' }],
    });
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response('{}', {
        status: 409,
        headers: { 'x-line-accepted-request-id': 'accepted-request-1', 'Content-Type': 'application/json' },
      }) as any;
      await new ProcessQueuedDeliveryUseCase(
        prisma,
        { update: async (_companyId: string, _deliveryId: string, data: any) => { updates.push(data); return data; } } as any,
        { log: async () => undefined } as any,
        { lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any,
      ).execute('co-1', delivery.id);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(updates.at(-1)?.status, 'SENT');
    assert.equal(updates.at(-1)?.providerMessageId, 'accepted-request-1');
  });

  it('keeps a bare LINE 409 as a failed delivery', async () => {
    const updates: any[] = [];
    const delivery = {
      id: 'delivery-conflict', companyId: 'co-1', channel: 'LINE', status: 'QUEUED', attemptCount: 0,
      recipient: { userId: 'user-1', event: { triggerKey: 'stock_low', severity: 'INFO', title: 'Low stock', body: 'SKU-1', deepLinkHref: null } },
    };
    const prisma = {
      client: {
        notificationDelivery: { findFirst: async () => delivery },
        notificationPreference: { findUnique: async () => null },
        externalIdentity: { findFirst: async () => ({ providerUserId: 'line-user-1' }) },
      },
    } as any;
    prisma.client.$transaction = async (run: any) => run({
      notificationDelivery: {
        findFirst: async () => ({ ...delivery, recipient: { ...delivery.recipient, event: { ...delivery.recipient.event, status: 'OPEN' } } }),
        updateMany: async (query: any) => { updates.push(query.data); return { count: 1 }; },
        update: async (query: any) => { updates.push(query.data); return query.data; },
      },
      $queryRaw: async () => [{ id: 'membership-1' }],
    });
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response('{}', { status: 409, headers: { 'Content-Type': 'application/json' } }) as any;
      await new ProcessQueuedDeliveryUseCase(
        prisma,
        { update: async (_companyId: string, _deliveryId: string, data: any) => { updates.push(data); return data; } } as any,
        { log: async () => undefined } as any,
        { lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any,
      ).execute('co-1', delivery.id);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(updates.at(-1)?.status, 'FAILED');
    assert.equal(updates.at(-1)?.errorCode, 'HTTP_409');
  });

  it('claims a non-customer LINE delivery so overlapping workers push once', async () => {
    const event = { status: 'OPEN', triggerKey: 'stock_low', severity: 'INFO', title: 'Low stock', body: 'SKU-1', deepLinkHref: null };
    const stale = {
      id: 'delivery-stock-race', companyId: 'co-1', channel: 'LINE', status: 'QUEUED', attemptCount: 0,
      recipient: { userId: 'user-1', event },
    };
    let persisted: any = { ...stale };
    let outerReads = 0;
    let providerCalls = 0;
    let mutexTail = Promise.resolve();
    const matches = (where: any) => ['QUEUED', 'FAILED'].includes(persisted.status) && persisted.attemptCount === where.attemptCount;
    const tx = {
      notificationDelivery: {
        findFirst: async (query: any) => matches(query.where) ? { ...persisted, recipient: stale.recipient } : null,
        updateMany: async (query: any) => {
          if (!matches(query.where)) return { count: 0 };
          persisted = { ...persisted, ...query.data };
          return { count: 1 };
        },
        update: async (query: any) => { persisted = { ...persisted, ...query.data }; return persisted; },
      },
      $queryRaw: async () => [{ id: 'membership-1' }],
    };
    const prisma = {
      client: {
        notificationDelivery: { findFirst: async () => { outerReads += 1; return outerReads <= 2 ? stale : persisted; } },
        notificationPreference: { findUnique: async () => null },
        externalIdentity: { findFirst: async () => ({ providerUserId: 'line-user-1' }) },
        $transaction: async (run: any) => {
          const previous = mutexTail;
          let release!: () => void;
          mutexTail = new Promise<void>((resolve) => { release = resolve; });
          await previous;
          try { return await run(tx); } finally { release(); }
        },
      },
    } as any;
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(JSON.stringify({ sentMessages: [{ id: 'line-once' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as any;
      const make = () => new ProcessQueuedDeliveryUseCase(
        prisma,
        { update: async () => { throw new Error('must settle in claim transaction'); } } as any,
        { log: async () => undefined } as any,
        { lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any,
      );
      await Promise.all([make().execute('co-1', stale.id), make().execute('co-1', stale.id)]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(providerCalls, 1);
    assert.equal(persisted.status, 'SENT');
    assert.equal(persisted.attemptCount, 1);
  });

  it('does not send cached CRM customer PII when erasure suppresses the delivery before the final lock', async () => {
    const secretName = 'คุณลูกค้า Secret';
    const cleanupAttempts: any[] = [];
    let providerCalls = 0;
    let locked = false;
    let outerDeliveryReads = 0;
    const staleDelivery = {
      id: 'delivery-crm-1', companyId: 'co-1', channel: 'LINE', status: 'QUEUED', attemptCount: 0,
      recipient: {
        userId: 'staff-1',
        event: {
          sourceModule: 'crm_inbox', sourceType: 'crm_conversation', sourceId: 'conv-1', status: 'OPEN',
          triggerKey: 'crm_new_conversation', severity: 'ACTION', title: `แชทใหม่จาก ${secretName}`,
          body: 'มีลูกค้าทักเข้ามาใหม่', deepLinkHref: '/companies/co-1/inbox',
        },
      },
    };
    const tx = {
      notificationDelivery: { findFirst: async () => (locked ? null : staleDelivery) },
      crmConversation: { findFirst: async () => ({ customerId: 'customer-1' }) },
      crmCustomer: { findFirst: async () => { throw new Error('must not read after suppressed delivery'); } },
      $queryRaw: async () => { locked = true; return []; },
    };
    const prisma = {
      client: {
        notificationDelivery: {
          findFirst: async () => {
            outerDeliveryReads += 1;
            return outerDeliveryReads === 1 ? staleDelivery : { ...staleDelivery, status: 'SUPPRESSED' };
          },
          updateMany: async (query: any) => {
            cleanupAttempts.push(query);
            return { count: 0 };
          },
        },
        notificationPreference: { findUnique: async () => null },
        externalIdentity: { findFirst: async () => ({ providerUserId: 'line-staff-1' }) },
        $transaction: async (run: any, options: any) => {
          assert.deepEqual(options, { maxWait: 5_000, timeout: 35_000 });
          return run(tx);
        },
      },
    } as any;
    const deliveries = {
      update: async () => { throw new Error('CRM outcome must not update outside the lock transaction'); },
    } as any;
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        providerCalls += 1;
        return new Response('{}', { status: 200 });
      }) as any;
      await new ProcessQueuedDeliveryUseCase(
        prisma,
        deliveries,
        { log: async () => undefined } as any,
        { lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any,
      ).execute('co-1', staleDelivery.id);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(providerCalls, 0);
    assert.equal(cleanupAttempts[0]?.data.status, 'SUPPRESSED');
    assert.equal(cleanupAttempts[0]?.data.errorCode, 'CUSTOMER_DATA_UNAVAILABLE');
    assert.equal(JSON.stringify(cleanupAttempts).includes(secretName), false);
  });

  it('suppresses customer-linked LINE egress when the recipient membership is no longer active', async () => {
    const cleanupAttempts: any[] = [];
    let providerCalls = 0;
    const delivery = {
      id: 'delivery-inactive-recipient', companyId: 'co-1', channel: 'LINE', status: 'QUEUED', attemptCount: 0,
      recipient: {
        userId: 'inactive-user',
        event: {
          sourceModule: 'crm_inbox', sourceType: 'crm_conversation', sourceId: 'conv-1', status: 'OPEN',
          triggerKey: 'crm_sla_breach', severity: 'ACTION', title: 'SLA customer', body: 'Needs reply', deepLinkHref: null,
        },
      },
    };
    const tx = {
      notificationDelivery: { findFirst: async () => delivery },
      crmConversation: { findFirst: async () => ({ customerId: 'customer-1' }) },
      crmCustomer: { findFirst: async () => ({ id: 'customer-1' }) },
      $queryRaw: async () => [],
    };
    const prisma = {
      client: {
        notificationDelivery: {
          findFirst: async () => delivery,
          updateMany: async (query: any) => { cleanupAttempts.push(query); return { count: 1 }; },
        },
        notificationPreference: { findUnique: async () => null },
        externalIdentity: { findFirst: async () => ({ providerUserId: 'line-user-1' }) },
        $transaction: async (run: any) => run(tx),
      },
    } as any;
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => { providerCalls += 1; return new Response('{}', { status: 200 }); }) as any;
      await new ProcessQueuedDeliveryUseCase(
        prisma,
        { update: async () => { throw new Error('must not update outside the CRM transaction'); } } as any,
        { log: async () => undefined } as any,
        { lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any,
      ).execute('co-1', delivery.id);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(providerCalls, 0);
    assert.equal(cleanupAttempts[0]?.data.status, 'SUPPRESSED');
    assert.equal(cleanupAttempts[0]?.data.errorCode, 'CUSTOMER_DATA_UNAVAILABLE');
  });

  it('re-reads a live CRM notification under the customer lock before LINE egress', async () => {
    const staleSecret = 'STALE-CUSTOMER-NAME';
    const currentName = 'Current customer';
    const transactionUpdates: any[] = [];
    const providerBodies: string[] = [];
    let deliveryReads = 0;
    const event = (title: string) => ({
      sourceModule: 'crm_inbox', sourceType: 'crm_booking', sourceId: 'booking-1', status: 'OPEN',
      triggerKey: 'crm_booking_reminder', severity: 'ACTION', title,
      body: 'Reminder body', deepLinkHref: '/companies/co-1/bookings',
    });
    const outerDelivery = {
      id: 'delivery-crm-2', companyId: 'co-1', channel: 'LINE', status: 'QUEUED', attemptCount: 0,
      recipient: { userId: 'staff-1', event: event(staleSecret) },
    };
    const tx = {
      notificationDelivery: {
        findFirst: async () => {
          deliveryReads += 1;
          return {
            ...outerDelivery,
            recipient: { ...outerDelivery.recipient, event: event(deliveryReads === 1 ? staleSecret : currentName) },
          };
        },
        updateMany: async (query: any) => {
          transactionUpdates.push(query);
          return { count: 1 };
        },
        update: async (query: any) => {
          transactionUpdates.push(query);
          return { ...outerDelivery, ...query.data };
        },
      },
      crmBooking: { findFirst: async () => ({ customerId: 'customer-1' }) },
      crmCustomer: { findFirst: async () => ({ id: 'customer-1' }) },
      $queryRaw: async (sql: TemplateStringsArray) => sql.join('').includes('CompanyMembership') ? [{ id: 'membership-1' }] : [],
    };
    const prisma = {
      client: {
        notificationDelivery: { findFirst: async () => outerDelivery },
        notificationPreference: { findUnique: async () => null },
        externalIdentity: { findFirst: async () => ({ providerUserId: 'line-staff-1' }) },
        $transaction: async (run: any) => run(tx),
      },
    } as any;
    const deliveries = {
      update: async () => { throw new Error('CRM outcome must not update outside the lock transaction'); },
    } as any;
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (_input: any, init: any) => {
        providerBodies.push(String(init.body));
        return new Response(JSON.stringify({ sentMessages: [{ id: 'line-message-current' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;
      await new ProcessQueuedDeliveryUseCase(
        prisma,
        deliveries,
        { log: async () => undefined } as any,
        { lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any,
      ).execute('co-1', outerDelivery.id);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(providerBodies.length, 1);
    assert.equal(providerBodies[0].includes(currentName), true);
    assert.equal(providerBodies[0].includes(staleSecret), false);
    assert.equal(transactionUpdates[0]?.data.status, 'SENDING');
    assert.equal(transactionUpdates[1]?.data.status, 'SENT');
    assert.equal(transactionUpdates[1]?.data.attemptCount, 1);
  });

  it('claims and persists a CRM LINE outcome inside the customer lock so overlapping workers push once', async () => {
    const baseEvent = {
      sourceModule: 'crm_inbox', sourceType: 'crm_conversation', sourceId: 'conv-1', status: 'OPEN',
      triggerKey: 'crm_sla_breach', severity: 'ACTION', title: 'SLA customer', body: 'Needs reply',
      deepLinkHref: '/companies/co-1/inbox',
    };
    const staleOuter = {
      id: 'delivery-race', companyId: 'co-1', channel: 'LINE', status: 'QUEUED', attemptCount: 0,
      recipient: { userId: 'staff-1', event: baseEvent },
    };
    let persisted: any = { ...staleOuter };
    let outerInitialReads = 0;
    let providerCalls = 0;
    let mutexTail = Promise.resolve();
    const matchesClaim = (where: any) => (
      ['QUEUED', 'FAILED'].includes(persisted.status)
      && persisted.attemptCount === where.attemptCount
    );
    const tx = {
      notificationDelivery: {
        findFirst: async (query: any) => matchesClaim(query.where)
          ? { ...persisted, recipient: staleOuter.recipient }
          : null,
        updateMany: async (query: any) => {
          if (!matchesClaim(query.where)) return { count: 0 };
          persisted = { ...persisted, ...query.data };
          return { count: 1 };
        },
        update: async (query: any) => {
          persisted = { ...persisted, ...query.data };
          return persisted;
        },
      },
      crmConversation: { findFirst: async () => ({ customerId: 'customer-1' }) },
      crmCustomer: { findFirst: async () => ({ id: 'customer-1' }) },
      $queryRaw: async (sql: TemplateStringsArray) => sql.join('').includes('CompanyMembership') ? [{ id: 'membership-1' }] : [],
    };
    const prisma = {
      client: {
        notificationDelivery: {
          findFirst: async () => {
            outerInitialReads += 1;
            return outerInitialReads <= 2 ? staleOuter : persisted;
          },
          updateMany: async (query: any) => {
            if (!matchesClaim(query.where)) return { count: 0 };
            persisted = { ...persisted, ...query.data };
            return { count: 1 };
          },
        },
        notificationPreference: { findUnique: async () => null },
        externalIdentity: { findFirst: async () => ({ providerUserId: 'line-staff-1' }) },
        $transaction: async (run: any) => {
          const previous = mutexTail;
          let release!: () => void;
          mutexTail = new Promise<void>((resolve) => { release = resolve; });
          await previous;
          try {
            return await run(tx);
          } finally {
            release();
          }
        },
      },
    } as any;
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(JSON.stringify({ sentMessages: [{ id: 'line-message-once' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;
      const first = new ProcessQueuedDeliveryUseCase(
        prisma,
        { update: async () => { throw new Error('must not use repository update'); } } as any,
        { log: async () => undefined } as any,
        { lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any,
      );
      const second = new ProcessQueuedDeliveryUseCase(
        prisma,
        { update: async () => { throw new Error('must not use repository update'); } } as any,
        { log: async () => undefined } as any,
        { lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any,
      );
      await Promise.all([
        first.execute('co-1', staleOuter.id),
        second.execute('co-1', staleOuter.id),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(providerCalls, 1);
    assert.equal(persisted.status, 'SENT');
    assert.equal(persisted.attemptCount, 1);
  });
});

describe('notification producer sweeps', () => {
  it('uses the stable period key for daily-summary identity and keeps the snapshot in source refs', async () => {
    const events: any[] = [];
    const useCase = new CreateDailyOwnerSummaryUseCase(
      { execute: async () => ({ id: 'fresh-snapshot-id', widgets: [{ key: 'inventory' }] }) } as any,
      { execute: async (input: any) => { events.push(input); return { skipped: false }; } } as any,
      { client: { companyMembership: { findMany: async () => [{ userId: 'owner-1' }] } } } as any,
    );

    await useCase.execute({} as any, 'co-1', '2026-07-12');

    assert.equal(events[0]?.sourceId, '2026-07-12');
    assert.equal(events[0]?.periodKey, '2026-07-12');
    assert.equal(events[0]?.sourceRefs[0]?.sourceId, 'fresh-snapshot-id');
  });

  it('generates today snapshots for every active company and isolates failures', async () => {
    const generated: string[] = [];
    const prisma = { client: { company: { findMany: async () => [{ id: 'co-1' }, { id: 'co-2' }] } } } as any;
    const generateSnapshot = {
      execute: async (_ctx: any, companyId: string, options: any) => {
        assert.deepEqual(options, { periodKind: 'today', forceGenerate: true });
        generated.push(companyId);
        if (companyId === 'co-1') throw new Error('one company failed');
      },
    } as any;

    const result = await new GenerateDashboardSnapshotsSweepUseCase(prisma, generateSnapshot, shadowProbe).execute();
    assert.deepEqual(result, { processed: 2, failures: 1 });
    assert.deepEqual(generated, ['co-1', 'co-2']);
  });

  it('runs the stock-low scan for every active company', async () => {
    const scanned: string[] = [];
    const prisma = { client: { company: { findMany: async () => [{ id: 'co-1' }, { id: 'co-2' }] } } } as any;
    const stockLowScan = { execute: async (companyId: string) => { scanned.push(companyId); } } as any;

    const result = await new ScanStockLowNotificationsSweepUseCase(prisma, stockLowScan, shadowProbe).execute();
    assert.deepEqual(result, { processed: 2, failures: 0 });
    assert.deepEqual(scanned, ['co-1', 'co-2']);
  });

  it('creates Bangkok-day summaries only for companies with an enabled rule', async () => {
    const queries: any[] = [];
    const calls: any[] = [];
    const prisma = {
      client: {
        notificationRule: {
          findMany: async (query: any) => {
            queries.push(query);
            return [{ companyId: 'co-enabled' }];
          },
        },
      },
    } as any;
    const dailyOwnerSummary = {
      execute: async (_ctx: any, companyId: string, periodKey: string) => calls.push({ companyId, periodKey }),
    } as any;

    const result = await new CreateDailyOwnerSummariesSweepUseCase(prisma, dailyOwnerSummary, shadowProbe)
      .execute(new Date('2026-07-11T18:30:00.000Z'));

    assert.deepEqual(result, { processed: 1, failures: 0 });
    assert.deepEqual(queries[0]?.where, {
      triggerKey: 'daily_owner_summary', status: 'ENABLED', company: { status: 'ACTIVE' },
    });
    assert.deepEqual(calls, [{ companyId: 'co-enabled', periodKey: '2026-07-12' }]);
  });
});

/**
 * Shadow coverage for the notification async surfaces (piece 5).
 *
 * Four of the eleven `dashboard_notifications` async rows are measured here: the delivery sweep,
 * and the three cross-tenant sweeps that share the `runSweep` helper. Each keeps its own surface
 * name, so a sweep that silently stops firing is individually visible in the health view.
 */
describe('notification sweeps shadow coverage (piece 5)', () => {
  const takeNew = () => {
    const from = shadowRecords.length;
    const fromFlush = shadowFlushes.length;
    return () => ({ records: shadowRecords.slice(from), flushes: shadowFlushes.slice(fromFlush) });
  };

  it('records one observation per due delivery, and processes them all', async () => {
    const { sut, processed } = makeSut([
      { id: 'd1', companyId: 'c1' },
      { id: 'd2', companyId: 'c2' },
    ]);
    const since = takeNew();

    const result = await sut.execute();

    assert.deepEqual(since().records, [
      { surface: 'notifications.delivery.sweep', companyId: 'c1', featureKey: 'dashboard_notifications' },
      { surface: 'notifications.delivery.sweep', companyId: 'c2', featureKey: 'dashboard_notifications' },
    ]);
    assert.deepEqual(since().flushes, ['notifications.delivery.sweep']);
    // SHADOW ONLY: the sweep behaves exactly as before.
    assert.deepEqual(processed, ['d1', 'd2']);
    assert.deepEqual(result, { processed: 2, failures: 0 });
  });

  it('records a delivery that then fails — the observation is about the guard, not the outcome', async () => {
    const { sut } = makeSut([{ id: 'd1', companyId: 'c1' }], ['d1']);
    const since = takeNew();

    const result = await sut.execute();

    assert.equal(since().records.length, 1);
    assert.deepEqual(result, { processed: 1, failures: 1 });
  });

  it('gives each shared-helper sweep its own surface name', async () => {
    const prisma = { client: { company: { findMany: async () => [{ id: 'co-1' }, { id: 'co-2' }] } } } as any;
    const generateSnapshot = { execute: async () => undefined } as any;
    const stockLowScan = { execute: async () => undefined } as any;
    const since = takeNew();

    await new GenerateDashboardSnapshotsSweepUseCase(prisma, generateSnapshot, shadowProbe).execute();
    await new ScanStockLowNotificationsSweepUseCase(prisma, stockLowScan, shadowProbe).execute();

    const { records, flushes } = since();
    assert.deepEqual(records.map((r) => r.surface), [
      'notifications.sweep.snapshot', 'notifications.sweep.snapshot',
      'notifications.sweep.stock_low', 'notifications.sweep.stock_low',
    ]);
    assert.ok(records.every((r) => r.featureKey === 'dashboard_notifications'));
    assert.deepEqual(flushes, ['notifications.sweep.snapshot', 'notifications.sweep.stock_low']);
  });

  it('flushes the daily-summary sweep even though it re-throws on partial failure', async () => {
    const prisma = {
      client: { notificationRule: { findMany: async () => [{ companyId: 'co-1' }, { companyId: 'co-2' }] } },
    } as any;
    const dailyOwnerSummary = {
      execute: async (_ctx: any, companyId: string) => { if (companyId === 'co-1') throw new Error('one company failed'); },
    } as any;
    const since = takeNew();

    // The cron sweep deliberately re-throws after the loop so the worker job retries. Mutation
    // guard: with `await probe.flush()` outside the `finally`, the throw skips the flush and both
    // observations vanish with no bucket row and no persist_failed warn.
    await assert.rejects(
      () => new CreateDailyOwnerSummariesSweepUseCase(prisma, dailyOwnerSummary, shadowProbe).execute(),
      /daily_owner_summary sweep failed for 1\/2/,
    );

    const { records, flushes } = since();
    assert.equal(records.length, 2);
    assert.deepEqual(flushes, ['notifications.sweep.daily_owner_summary']);
  });

  /**
   * STRUCTURAL guard for the `finally` (mutation-proved). The double below is NOT a stand-in for
   * `LaunchShadowProbe`, which cannot throw — see `launch-shadow.probe.spec.ts`. It stands for ANY
   * future escape from inside the loop, because `runSweep`'s per-company try/catch wraps the ACTION
   * only. Move `await probe.flush()` out of the `finally` and this fails: everything buffered before
   * the escape would vanish with no bucket row AND no persist_failed warn.
   */
  it('flushes on any escape from inside the sweep loop (finally, mutation-proved)', async () => {
    const seen: string[] = [];
    const flushed: string[] = [];
    const escapingDouble = {
      startSweep: (surface: string) => ({
        record: async (companyId: string) => {
          seen.push(companyId);
          if (companyId === 'co-2') throw new Error('hypothetical escape');
          return { wouldBlock: false, reason: 'available' as const };
        },
        flush: async () => { flushed.push(surface); return {}; },
      }),
    } as any;
    const prisma = { client: { company: { findMany: async () => [{ id: 'co-1' }, { id: 'co-2' }] } } } as any;
    const stockLowScan = { execute: async () => undefined } as any;

    await assert.rejects(
      () => new ScanStockLowNotificationsSweepUseCase(prisma, stockLowScan, escapingDouble).execute(),
      /hypothetical escape/,
    );
    assert.deepEqual(seen, ['co-1', 'co-2']);
    assert.deepEqual(flushed, ['notifications.sweep.stock_low']);
  });

  it('flushes the delivery sweep on any escape from inside its loop (finally, mutation-proved)', async () => {
    const flushed: string[] = [];
    const escapingDouble = {
      startSweep: (surface: string) => ({
        record: async (companyId: string) => {
          if (companyId === 'c2') throw new Error('hypothetical escape');
          return { wouldBlock: false, reason: 'available' as const };
        },
        flush: async () => { flushed.push(surface); return {}; },
      }),
    } as any;
    const deliveries = { findDue: async () => [{ id: 'd1', companyId: 'c1' }, { id: 'd2', companyId: 'c2' }] } as any;
    const processDelivery = { execute: async () => ({ id: 'd1', status: 'SENT' }) } as any;

    await assert.rejects(
      () => new ProcessDueNotificationDeliveriesUseCase(deliveries, processDelivery, escapingDouble).execute(),
      /hypothetical escape/,
    );
    assert.deepEqual(flushed, ['notifications.delivery.sweep']);
  });

  /**
   * THE CONTRACT (codex r23 F1). With the REAL probe, a launch-table read failure must not be able
   * to stop a notification delivery — the surface is entitlement-blind today and must stay exactly
   * as blind, only measured. The inverse of the structural fixtures above.
   */
  it('completes every delivery when the real probe cannot read the launch tables', async () => {
    const warns: any[] = [];
    // Tenant-bearing message, exactly what a driver is free to throw (codex r24): the caller must
    // survive it AND none of it may reach the log index.
    const leaky = () => { throw new Error('read failed for companyId c2-secret'); };
    const prisma = {
      client: {
        featureLaunchGate: { findMany: async () => leaky() },
        companyFeatureEntitlement: { findMany: async () => leaky() },
        featureLaunchObservationBucket: { upsert: async () => { throw new Error('must not be reached'); } },
      },
    } as any;
    const logger = { info: () => {}, warn: (payload: any) => warns.push(payload), error: () => {} } as any;
    const realProbe = new LaunchShadowProbe(prisma, logger);

    const processed: string[] = [];
    const deliveries = { findDue: async () => [{ id: 'd1', companyId: 'c1' }, { id: 'd2', companyId: 'c2' }] } as any;
    const processDelivery = { execute: async (_c: string, id: string) => { processed.push(id); return { id, status: 'SENT' }; } } as any;

    const result = await new ProcessDueNotificationDeliveriesUseCase(deliveries, processDelivery, realProbe).execute();

    assert.deepEqual(processed, ['d1', 'd2'], 'deliveries must not depend on the measurement');
    assert.deepEqual(result, { processed: 2, failures: 0 });
    // A failed read is not evidence: nothing durable was written, and the failure is visible.
    assert.equal(warns.length, 2);
    assert.ok(warns.every((w) => w.event === LAUNCH_SHADOW_READ_FAILED_EVENT));
    const serialized = JSON.stringify(warns);
    assert.equal(serialized.includes('companyId'), false);
    assert.equal(serialized.includes('c2-secret'), false);
  });

  it('runs every company in a shared-helper sweep when the real probe cannot read', async () => {
    const prisma = {
      client: {
        featureLaunchGate: { findMany: async () => { throw new Error('LAUNCH_TABLES_DOWN'); } },
        companyFeatureEntitlement: { findMany: async () => [] },
        featureLaunchObservationBucket: { upsert: async () => ({}) },
      },
    } as any;
    const realProbe = new LaunchShadowProbe(prisma, { info: () => {}, warn: () => {}, error: () => {} } as any);
    const scanned: string[] = [];
    const companyPrisma = { client: { company: { findMany: async () => [{ id: 'co-1' }, { id: 'co-2' }] } } } as any;
    const stockLowScan = { execute: async (companyId: string) => { scanned.push(companyId); } } as any;

    const result = await new ScanStockLowNotificationsSweepUseCase(companyPrisma, stockLowScan, realProbe).execute();

    assert.deepEqual(scanned, ['co-1', 'co-2']);
    assert.deepEqual(result, { processed: 2, failures: 0 });
  });
});
