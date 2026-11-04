import { lineMessagingCredentialsFixture } from '../../../../common/config/line-messaging-credentials.fixture';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LAUNCH_SHADOW_READ_FAILED_EVENT, LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import {
  CreateOrUpdateNotificationEventUseCase,
  CreateDailyOwnerSummaryUseCase,
  ProcessDueNotificationDeliveriesUseCase,
  ProcessQueuedDeliveryUseCase,
  buildLineMessage,
} from './notification.use-cases';
import {
  PrismaAlertStateRepository,
  PrismaNotificationDeliveryRepository,
  PrismaNotificationEventRepository,
  PrismaNotificationRecipientRepository,
  PrismaNotificationRuleRepository,
} from '../../infrastructure/prisma-notification.repository';
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

describe('notification LINE copy', () => {
  it('labels critical messages as important without crisis wording', () => {
    const message = buildLineMessage({ companyId: 'co-1', severity: 'critical', title: 'แพ็กเกจหมดอายุแล้ว', body: '' });
    const header = (message.contents.header as { contents: Array<{ text: string }> }).contents[0]!.text;
    assert.equal(header, '🔴 สำคัญ');
  });

  it('offers the billing action on self-service plan-term notices', () => {
    const message = buildLineMessage({
      companyId: 'co-1', triggerKey: 'plan_term_expiring', severity: 'action', title: 'แพ็กเกจใกล้หมดอายุ',
      body: 'เลือกแพ็กเกจและชำระเงินได้เอง', deepLinkHref: 'https://app.example.test/companies/co-1/billing',
    });
    const footer = message.contents.footer as { contents: Array<{ action: { label: string; uri: string } }> };
    assert.equal(footer.contents[0]!.action.label, 'จัดการแพ็กเกจ');
    assert.match(footer.contents[0]!.action.uri, /\/companies\/co-1\/billing$/);
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
        trackWaiting: async () => undefined,
        create: async (data: any) => { createdRecipients.push(data.userId); return { id: `recipient-${data.userId}` }; },
      } as any,
      { create: async () => ({}) } as any,
      { findByDedupKey: async () => null, upsert: async () => ({}) } as any,
      { findByTriggerKey: async () => null } as any,
      {
        client: {
          companyFeatureEntitlement: { findMany: async () => [] },
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

/**
 * Review M1: the store keeps ONE notice per trigger, record and period, and a workflow notice is
 * never resolved. With no period a claim was notified once per person, ever. These run the real
 * repositories over an in-memory store, so the dedup key, the deliveries and the resolving of the
 * older notice are what is proven.
 */
describe('CreateOrUpdateNotificationEventUseCase periods', () => {
  function noticeStore() {
    const events: any[] = [];
    const recipients: any[] = [];
    const deliveries: any[] = [];
    const alertStates = new Map<string, any>();
    const client = {
      $executeRaw: async () => 1,
      companyFeatureEntitlement: { findMany: async () => [] },
      notificationEvent: {
        findFirst: async ({ where }: any) => events.find((row) => row.companyId === where.companyId && row.dedupKey === where.dedupKey) ?? null,
        create: async ({ data }: any) => { const row = { id: `event-${events.length + 1}`, createdAt: new Date(), ...data }; events.push(row); return row; },
        update: async ({ where, data }: any) => Object.assign(events.find((row) => row.id === where.id), data),
        updateMany: async ({ where, data }: any) => {
          const hits = events.filter((row) => Object.entries(where).every(([key, value]) => (
            key === 'id' ? row.id !== (value as any).not
              : Array.isArray((value as any)?.in) ? (value as any).in.includes(row[key]) : row[key] === value
          )));
          hits.forEach((row) => Object.assign(row, data));
          return { count: hits.length };
        },
      },
      notificationRule: { findFirst: async () => null },
      alertState: {
        findUnique: async ({ where }: any) => alertStates.get(where.companyId_dedupKey.dedupKey) ?? null,
        upsert: async ({ where, create }: any) => { alertStates.set(where.companyId_dedupKey.dedupKey, { status: 'COOLING_DOWN', ...create }); return alertStates.get(where.companyId_dedupKey.dedupKey); },
      },
      companyMembership: { findMany: async ({ where }: any) => where.userId.in.map((userId: string) => ({ userId })) },
      notificationRecipient: {
        findFirst: async ({ where }: any) => recipients.find(row => row.id === where.id && row.companyId === where.companyId && row.userId === where.userId),
        update: async ({ where, data }: any) => Object.assign(recipients.find(row => row.id === where.id), data),
        updateMany: async ({ where, data }: any) => {
          const hits = recipients.filter(row => Object.entries(where).every(([key, value]: any) => value === null ? row[key] == null : value?.not ? row[key] !== value.not : row[key] === value));
          hits.forEach(row => Object.assign(row, data)); return { count: hits.length };
        },
        findUnique: async ({ where }: any) => recipients.find((row) => row.eventId === where.eventId_userId.eventId && row.userId === where.eventId_userId.userId) ?? null,
        create: async ({ data }: any) => { const row = { id: `recipient-${recipients.length + 1}`, ...data }; recipients.push(row); return row; },
      },
      notificationDelivery: {
        findFirst: async ({ where }: any) => deliveries.find((row) => row.recipientId === where.recipientId && row.channel === where.channel) ?? null,
        create: async ({ data }: any) => { const row = { id: `delivery-${deliveries.length + 1}`, ...data }; deliveries.push(row); return row; },
      },
    };
    const prisma = { client } as any;
    const useCase = new CreateOrUpdateNotificationEventUseCase(
      new PrismaNotificationEventRepository(prisma), new PrismaNotificationRecipientRepository(prisma),
      new PrismaNotificationDeliveryRepository(prisma), new PrismaAlertStateRepository(prisma),
      new PrismaNotificationRuleRepository(prisma), prisma,
    );
    const pushedTo = (eventId: string) => recipients
      .filter((row) => row.eventId === eventId && deliveries.some((delivery) => delivery.recipientId === row.id && delivery.channel === 'LINE'))
      .map((row) => row.userId);
    return { useCase, events, recipients, deliveries, pushedTo };
  }
  const claimNotice = (extra: Record<string, unknown>) => ({
    companyId: 'co-1', triggerKey: 'workflow.reimbursement_pending_approval', sourceModule: 'reimbursements',
    sourceType: 'reimbursement_request', sourceId: 'rb-1', severity: 'action', title: 'อนุมัติเบิกจ่าย: RB-1',
    body: 'รออนุมัติจากคุณ', deepLinkHref: '/companies/co-1/reimbursements/rb-1', recipientUserIds: ['mgr-1'],
    supersedeEarlier: true, ...extra,
  }) as any;

  it('sends a claim sent again to its approver a second time, and the first notice stops being current', async () => {
    const { useCase, events, deliveries, pushedTo } = noticeStore();

    const round1 = await useCase.execute(claimNotice({ periodKey: 'run-1' }));
    // The same run retried: nothing new, nobody pushed twice.
    const retry = await useCase.execute(claimNotice({ periodKey: 'run-1' }));
    assert.equal(retry.event!.id, round1.event!.id);
    assert.equal(deliveries.length, 2);

    const round2 = await useCase.execute(claimNotice({ periodKey: 'run-2' }));

    assert.notEqual(round2.event!.id, round1.event!.id);
    assert.deepEqual(pushedTo(round2.event!.id), ['mgr-1']);
    assert.deepEqual(events.map((row) => [row.id, row.status]), [['event-1', 'RESOLVED'], ['event-2', 'OPEN']]);
    assert.ok(events[0].resolvedAt instanceof Date);
  });

  it('pushes "approved" after an earlier "rejected", with its own text, and retires the old one', async () => {
    const { useCase, events, pushedTo } = noticeStore();
    const decision = (periodKey: string, body: string) => useCase.execute(claimNotice({
      triggerKey: 'workflow.reimbursement_decision_requester', recipientUserIds: ['staff-1'], periodKey, body,
    }));

    await decision('run-reject', 'ผลการพิจารณา: ส่งกลับให้แก้แล้ว');
    const approved = await decision('run-approve', 'ผลการพิจารณา: อนุมัติ');

    assert.deepEqual(pushedTo(approved.event!.id), ['staff-1']);
    assert.deepEqual(events.map((row) => [row.body, row.status]), [
      ['ผลการพิจารณา: ส่งกลับให้แก้แล้ว', 'RESOLVED'], ['ผลการพิจารณา: อนุมัติ', 'OPEN'],
    ]);
  });

  it('retires an older notice about the same claim even when each is filed under its own payment', async () => {
    const { useCase, events } = noticeStore();
    const paid = (paymentId: string) => useCase.execute(claimNotice({
      triggerKey: 'workflow.reimbursement_payment_recorded', sourceType: 'reimbursement_payment', sourceId: paymentId,
      recipientUserIds: ['staff-1'], periodKey: `run-${paymentId}`,
    }));

    await paid('pay-1');
    await paid('pay-2');
    // Another claim's notice of the same kind is left alone.
    await useCase.execute(claimNotice({
      triggerKey: 'workflow.reimbursement_payment_recorded', sourceType: 'reimbursement_payment', sourceId: 'pay-9',
      deepLinkHref: '/companies/co-1/reimbursements/rb-other', recipientUserIds: ['staff-1'], periodKey: 'run-pay-9',
    }));

    assert.deepEqual(events.map((row) => [row.sourceId, row.status]), [['pay-1', 'RESOLVED'], ['pay-2', 'OPEN'], ['pay-9', 'OPEN']]);
  });

  // Final review item 15: "paid" and "payment voided" are about the same money. After a void the "paid" notice
  // stayed current beside the "voided" one, and after the next payment the "voided" one beside the new "paid".
  it('retires the "paid" notice of a claim when its "payment voided" notice is made, and that one when the claim is paid again', async () => {
    const { useCase, events } = noticeStore();
    const about = (kind: 'recorded' | 'voided', paymentId: string, extra: Record<string, unknown> = {}) => useCase.execute(claimNotice({
      triggerKey: `workflow.reimbursement_payment_${kind}`, sourceType: 'reimbursement_payment', sourceId: paymentId,
      recipientUserIds: ['staff-1'], periodKey: `run-${kind}-${paymentId}`,
      alsoSupersedeTriggerKeys: [`workflow.reimbursement_payment_${kind === 'recorded' ? 'voided' : 'recorded'}`], ...extra,
    }));
    const current = () => events.filter((row) => row.status === 'OPEN').map((row) => `${row.triggerKey.split('_').at(-1)}:${row.sourceId}`);

    // The claim's own "approved" notice and another claim's "paid" notice are no part of this.
    await useCase.execute(claimNotice({ triggerKey: 'workflow.reimbursement_decision_requester', recipientUserIds: ['staff-1'], periodKey: 'run-approve' }));
    await about('recorded', 'pay-9', { deepLinkHref: '/companies/co-1/reimbursements/rb-other' });

    await about('recorded', 'pay-1');
    assert.deepEqual(current(), ['requester:rb-1', 'recorded:pay-9', 'recorded:pay-1']);

    await about('voided', 'pay-1');
    assert.deepEqual(current(), ['requester:rb-1', 'recorded:pay-9', 'voided:pay-1']);

    await about('recorded', 'pay-2');
    assert.deepEqual(current(), ['requester:rb-1', 'recorded:pay-9', 'recorded:pay-2']);
    assert.ok(events.filter((row) => row.status === 'RESOLVED').every((row) => row.resolvedAt instanceof Date));

    // A producer that names no other kind replaces only its own, as before.
    await useCase.execute(claimNotice({
      triggerKey: 'workflow.reimbursement_payment_voided', sourceType: 'reimbursement_payment', sourceId: 'pay-2',
      recipientUserIds: ['staff-1'], periodKey: 'run-voided-pay-2',
    }));
    assert.deepEqual(current(), ['requester:rb-1', 'recorded:pay-9', 'recorded:pay-2', 'voided:pay-2']);
  });

  // Owner rule: a push about one's own action is annoying, but the to-do item must still exist.
  it('gives a web-only recipient the bell item and no LINE push, and everyone else both', async () => {
    const { useCase, recipients, deliveries } = noticeStore();

    await useCase.execute(claimNotice({
      triggerKey: 'workflow.reimbursement_ready_for_payment', periodKey: 'run-1',
      recipientUserIds: ['approver-1', 'admin-1'], webOnlyRecipientUserIds: ['approver-1'],
    }));

    const channelsOf = (userId: string) => deliveries
      .filter((delivery) => delivery.recipientId === recipients.find((row) => row.userId === userId)!.id)
      .map((delivery) => delivery.channel);
    assert.deepEqual(channelsOf('approver-1'), ['WEB']);
    assert.deepEqual(channelsOf('admin-1'), ['WEB', 'LINE']);
  });

  it('leaves the periods of a producer that did not ask for it open side by side', async () => {
    const { useCase, events } = noticeStore();
    const digest = (periodKey: string) => useCase.execute(claimNotice({
      triggerKey: 'sales_deal_renewal_pending', sourceModule: 'sales', sourceType: 'deal', sourceId: 'deal-1',
      deepLinkHref: '/companies/co-1/billing', periodKey, supersedeEarlier: undefined,
    }));

    await digest('2026-09');
    await digest('2026-10');

    assert.deepEqual(events.map((row) => row.status), ['OPEN', 'OPEN']);
  });
});

describe('ProcessQueuedDeliveryUseCase LINE target resolution', () => {
  it('delivers through the configured shared OA channel when the company has no binding row', async () => {
    const identityQueries: any[] = [];
    const updates: any[] = [];
    const prisma = {
      client: {
        companyFeatureEntitlement: { findMany: async () => [] },
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
      $executeRaw: async () => 0,
      companyFeatureEntitlement: { findMany: async () => [] },
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
      const useCase = new ProcessQueuedDeliveryUseCase(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any),
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
      // R-B1: the push exit sends the web link outside LINE's in-app browser.
      assert.equal(
        payload.messages[0]?.contents.footer.contents[0]?.action.uri,
        'https://uat.mangmeeplus.com/companies/co-1/reimbursements?tab=approvals&focus=rb-1&openExternalBrowser=1',
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
        companyFeatureEntitlement: { findMany: async () => [] },
        notificationDelivery: { findFirst: async () => delivery },
        notificationPreference: { findUnique: async () => null },
        externalIdentity: { findFirst: async () => ({ providerUserId: 'line-user-1' }) },
      },
    } as any;
    prisma.client.$transaction = async (run: any) => run({
      $executeRaw: async () => 0,
      companyFeatureEntitlement: { findMany: async () => [] },
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
      await new ProcessQueuedDeliveryUseCase(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any),
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
        companyFeatureEntitlement: { findMany: async () => [] },
        notificationDelivery: { findFirst: async () => delivery },
        notificationPreference: { findUnique: async () => null },
        externalIdentity: { findFirst: async () => ({ providerUserId: 'line-user-1' }) },
      },
    } as any;
    prisma.client.$transaction = async (run: any) => run({
      $executeRaw: async () => 0,
      companyFeatureEntitlement: { findMany: async () => [] },
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
      await new ProcessQueuedDeliveryUseCase(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any),
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
      $executeRaw: async () => 0,
      companyFeatureEntitlement: { findMany: async () => [] },
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
        companyFeatureEntitlement: { findMany: async () => [] },
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
      const make = () => new ProcessQueuedDeliveryUseCase(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any),
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
      $executeRaw: async () => 0,
      companyFeatureEntitlement: { findMany: async () => [] },
      notificationDelivery: { findFirst: async () => (locked ? null : staleDelivery) },
      crmConversation: { findFirst: async () => ({ customerId: 'customer-1' }) },
      crmCustomer: { findFirst: async () => { throw new Error('must not read after suppressed delivery'); } },
      $queryRaw: async () => { locked = true; return []; },
    };
    const prisma = {
      client: {
        companyFeatureEntitlement: { findMany: async () => [] },
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
      await new ProcessQueuedDeliveryUseCase(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any),
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
      $executeRaw: async () => 0,
      companyFeatureEntitlement: { findMany: async () => [] },
      notificationDelivery: { findFirst: async () => delivery },
      crmConversation: { findFirst: async () => ({ customerId: 'customer-1' }) },
      crmCustomer: { findFirst: async () => ({ id: 'customer-1' }) },
      $queryRaw: async () => [],
    };
    const prisma = {
      client: {
        companyFeatureEntitlement: { findMany: async () => [] },
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
      await new ProcessQueuedDeliveryUseCase(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any),
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
      $executeRaw: async () => 0,
      companyFeatureEntitlement: { findMany: async () => [] },
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
        companyFeatureEntitlement: { findMany: async () => [] },
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
      await new ProcessQueuedDeliveryUseCase(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any),
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
      $executeRaw: async () => 0,
      companyFeatureEntitlement: { findMany: async () => [] },
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
        companyFeatureEntitlement: { findMany: async () => [] },
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
      const first = new ProcessQueuedDeliveryUseCase(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any),
        prisma,
        { update: async () => { throw new Error('must not use repository update'); } } as any,
        { log: async () => undefined } as any,
        { lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any,
      );
      const second = new ProcessQueuedDeliveryUseCase(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any),
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

// Payout impact audit M7: a preference row saves the list of triggers as it was that day, so every
// trigger added later is missing from it. The notice that someone else set a member's payout account
// is the owner's condition for allowing that at all, and must not be dropped that way.
describe('ProcessQueuedDeliveryUseCase and a preference list saved before a trigger existed', () => {
  async function deliver(triggerKey: string, preference: Record<string, unknown> | null, severity = 'CRITICAL') {
    const event = { status: 'OPEN', triggerKey, severity, title: 'วิภา ตั้งบัญชีรับเงินคืนของคุณ', body: 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789', deepLinkHref: '/companies/co-1/reimbursements/payout-account' };
    const delivery = { id: 'delivery-1', companyId: 'co-1', channel: 'LINE', status: 'QUEUED', attemptCount: 0, recipient: { userId: 'user-1', event } };
    const updates: any[] = [];
    const prisma = { client: {
      companyFeatureEntitlement: { findMany: async () => [] },
      notificationDelivery: { findFirst: async () => delivery },
      notificationPreference: { findUnique: async () => preference },
      externalIdentity: { findFirst: async () => ({ providerUserId: 'line-user-1' }) },
    } } as any;
    prisma.client.$transaction = async (run: any) => run({
      $executeRaw: async () => 0,
      companyFeatureEntitlement: { findMany: async () => [] },
      notificationDelivery: {
        findFirst: async () => delivery,
        updateMany: async (query: any) => { updates.push(query.data); return { count: 1 }; },
        update: async (query: any) => { updates.push(query.data); return query.data; },
      },
      $queryRaw: async () => [{ id: 'membership-1' }],
    });
    const deliveries = { update: async (_companyId: string, _deliveryId: string, data: any) => { updates.push(data); return data; } } as any;
    const originalFetch = globalThis.fetch;
    const pushes: any[] = [];
    try {
      globalThis.fetch = (async (_input: any, init: any) => {
        pushes.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ sentMessages: [{ id: 'line-message-1' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as any;
      const config = { lineMessagingChannelAccessToken: 'shared-token', lineMessagingChannelId: 'shared-channel' } as any;
      await new ProcessQueuedDeliveryUseCase(lineMessagingCredentialsFixture(config), prisma, deliveries, { log: async () => undefined } as any, config).execute('co-1', 'delivery-1');
    } finally { globalThis.fetch = originalFetch; }
    return { pushes, last: updates.at(-1) };
  }
  /** Saved before the payout trigger existed, with quiet hours that cover the whole day. */
  const savedLong = { enabledChannelsJson: ['web', 'line'], enabledTriggerKeysJson: ['stock_low', 'daily_owner_summary'], quietHoursStart: '00:00', quietHoursEnd: '23:59', timezone: 'Asia/Bangkok' };

  it('still pushes the payout-account notice, quiet hours included, with the last 4 digits only', async () => {
    const { pushes, last } = await deliver('reimbursement.payout_account_set_by_other', savedLong);
    assert.equal(pushes.length, 1);
    assert.equal(last.status, 'SENT');
    const text = JSON.stringify(pushes[0]);
    assert.match(text, /วิภา ตั้งบัญชีรับเงินคืนของคุณ/);
    assert.match(text, /ลงท้าย 6789/);
    // Everything a person reads in the push (colours and sizes aside) has no run of digits longer than the last 4.
    const shown = [...text.matchAll(/"(?:text|altText|label)":"([^"]*)"/g)].map((match) => match[1]!);
    assert.ok(shown.length >= 3);
    for (const line of shown) assert.doesNotMatch(line, /\d{5,}/, line);
  });

  it('keeps dropping any other trigger the saved list leaves out, and respects LINE switched off', async () => {
    const other = await deliver('workflow.reimbursement_pending_approval', { ...savedLong, quietHoursStart: null, quietHoursEnd: null }, 'ACTION');
    assert.deepEqual([other.pushes.length, other.last.status, other.last.errorCode], [0, 'suppressed', 'PREFERENCE_SUPPRESSED']);
    const lineOff = await deliver('reimbursement.payout_account_set_by_other', { ...savedLong, enabledChannelsJson: ['web'] });
    assert.deepEqual([lineOff.pushes.length, lineOff.last.status], [0, 'suppressed']);
    // With no saved row at all the notice goes out like every implemented trigger.
    assert.equal((await deliver('reimbursement.payout_account_set_by_other', null)).pushes.length, 1);
  });

  // Audit B9, added the same day as the payout notice: a requester whose payment was taken back, and
  // whoever can pay a claim waiting past the deadline. A list saved earlier names neither.
  it('still pushes payment and finance-block notices past old preferences, respecting LINE off and quiet hours', async () => {
    const savedEarlier = { ...savedLong, quietHoursStart: null, quietHoursEnd: null };
    for (const [triggerKey, severity] of [['workflow.reimbursement_payment_voided', 'INFO'], ['workflow.reimbursement_finance_blocked_requester', 'INFO'], ['workflow.reimbursement_payment_sla_breach', 'ACTION']] as const) {
      const sent = await deliver(triggerKey, savedEarlier, severity);
      assert.deepEqual([sent.pushes.length, sent.last.status], [1, 'SENT'], triggerKey);
      const lineOff = await deliver(triggerKey, { ...savedEarlier, enabledChannelsJson: ['web'] }, severity);
      assert.deepEqual([lineOff.pushes.length, lineOff.last.status], [0, 'suppressed'], triggerKey);
    }
    // Quiet hours are a person's own choice and still hold a notice that is not critical: both of these.
    for (const [triggerKey, severity] of [['workflow.reimbursement_payment_voided', 'INFO'], ['workflow.reimbursement_finance_blocked_requester', 'INFO'], ['workflow.reimbursement_payment_sla_breach', 'ACTION']] as const) {
      const quiet = await deliver(triggerKey, savedLong, severity);
      assert.deepEqual([quiet.pushes.length, quiet.last.status], [0, 'suppressed'], triggerKey);
    }
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

import { reimbursementApprovalButtons } from '../../../line-ai/domain/logic/line-reimbursement-approval-control.logic';
it('Round 3 existing reimbursement approval notice renders scoped opening buttons instead of a web-only footer', () => {
  const buttons = reimbursementApprovalButtons('secret', 'co-1', 'approver-1', 'claim-1');
  const notice = buildLineMessage({ companyId: 'co-1', triggerKey: 'workflow.reimbursement_pending_approval', title: 'ใบเบิกรอคุณอนุมัติค่ะ', body: 'ค่าเดินทาง 100 บาท', severity: 'action', approvalButtons: buttons });
  const footer = (notice.contents as any).footer;
  assert.deepEqual(footer.contents.map((b: any) => b.action.label), ['อนุมัติ', 'ไม่อนุมัติ']);
  assert.ok(footer.contents.every((b: any) => b.action.type === 'postback'));
  assert.match(footer.contents[0].action.data, /expense_action_approve/u);
});

it('A4a the reimbursement payment notice renders the recipient-bound payment opener', async () => {
  const { reimbursementPaymentButton, parseLineWorkflowControl, verifyLineWorkflowOpenSig } = await import('../../../line-ai/domain/logic/line-reimbursement-approval-control.logic');
  const notice = buildLineMessage({ companyId: 'co-1', triggerKey: 'workflow.reimbursement_ready_for_payment', title: 'ใบเบิกรอจ่ายคืน', body: 'ค่าเดินทาง 400 บาท', severity: 'action',
    approvalButtons: [reimbursementPaymentButton('secret', 'co-1', 'payer', 'claim-1')] });
  const action = (notice.contents as any).footer.contents[0].action;
  assert.equal(action.label, 'บันทึกจ่ายคืน');
  const control = parseLineWorkflowControl(action.data)!;
  assert.equal(control.action, 'wf_open');
  if (control.action !== 'wf_open') assert.fail('payment notice is a signed opener');
  assert.equal(control.act, 'REIMBURSEMENT_RECORD_PAYMENT');
  assert.equal(verifyLineWorkflowOpenSig('secret', 'co-1', 'payer', control.act, control.id, '', '', '', control.sig), true);
  assert.equal(verifyLineWorkflowOpenSig('secret', 'co-1', 'other', control.act, control.id, '', '', '', control.sig), false);
});
