/**
 * UAT 2026-09-05 (build 1399bb83), against real PostgreSQL.
 *
 * The Owner tapped "ติดต่อเจ้าหน้าที่" at 16:38, was told "รับเรื่องแล้วค่ะ", and nobody was told
 * anything. Two mechanisms, both of which only a real database can show:
 *
 *  - the shop came off `LineCompanyContext`, a row that SURVIVES an unlink — so the notice named
 *    "The lobby clube", which the asker had left on 2026-09-02, and linked the wrong partner page.
 *    A fake that models identities and memberships as lists happily agrees with whichever one the
 *    code reads; only real rows can disagree with each other.
 *  - the notice went to SYSTEM_ADMINs holding an ACTIVE LINE identity. There are none, in UAT or in
 *    production, and the outbox row still finished PUBLISHED.
 *
 * Run with:
 *   LINE_SUPPORT_TEST_DATABASE_URL='postgresql://…@127.0.0.1:15432/watchdog_bms?schema=public' \
 *     npx tsx --test src/modules/external-signup/line-support-request.pg.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { RESUME_AI_COMMAND, STAFF_CONTACT_COMMAND } from '../line-ai/domain/logic/line-staff-menu.logic';
import { ProcessLineWebhookUseCase } from '../line-ai/application/use-cases/process-line-webhook.use-case';
import { UnlinkLineIdentityUseCase } from '../auth/application/use-cases/unlink-line-identity.use-case';
import { LineSignupNotifyService } from './application/line-signup-notify.service';
import { SupportRequestAdminUseCase } from './application/support-request-admin.use-case';

const databaseUrl = process.env.LINE_SUPPORT_TEST_DATABASE_URL;

const CHANNEL = 'line-support-pg-channel';
const WEB_BASE = 'https://app.example.test';
const originalFetch = globalThis.fetch;

function connect(): PrismaClient {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test database is allowed');
  // Localhost alone is NOT proof of a local database: the production access recipe port-forwards
  // prod to 127.0.0.1 through SSM. This spec writes to the real `public` schema, so it also
  // requires the local docker database by name before it creates a single row.
  assert.equal(url.pathname, '/watchdog_bms', 'refusing to write to anything but the local docker database');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
}

type Wiring = {
  webhook: ProcessLineWebhookUseCase;
  notify: LineSignupNotifyService;
  admin: SupportRequestAdminUseCase;
  unlink: UnlinkLineIdentityUseCase;
  replies: string[];
  notices: string[];
  letters: Array<{ who: string; lastMessageText?: string }>;
  alerts: string[];
  adminPushes: number;
};

/** The real use cases over one client; only LINE, SES and the outbox are faked. */
function wire(client: PrismaClient, options: {
  /** Admins the notice fans out to, and how many of their LINE pushes land. */
  linkedAdminPushes?: number;
  adminUserIds?: string[];
  mailerSends?: boolean;
  /** The amplification floor: `false` = this LINE account has spent its three asks for today. */
  supportSlot?: boolean;
} = {}): Wiring {
  const prisma = { client } as any;
  const replies: string[] = [];
  const notices: string[] = [];
  const letters: Array<{ who: string; lastMessageText?: string }> = [];
  const alerts: string[] = [];
  const state = { adminPushes: 0 };

  const config = {
    lineMessagingChannelId: CHANNEL,
    lineMessagingChannelAccessToken: 'token-1',
    lineSignupBusinessDays: 'MON-SAT',
    lineSignupBusinessHours: '09:00-18:00',
    webBaseUrl: WEB_BASE,
    sesWebBaseUrl: WEB_BASE,
  } as any;

  const notify = new LineSignupNotifyService(
    prisma,
    { append: async () => undefined } as any,
    config,
    {
      activeSystemAdmins: async () => (options.adminUserIds ?? []).map((userId) => ({ companyId: 'sys', userId })),
      pushToLinkedAdmins: async () => {
        state.adminPushes = options.linkedAdminPushes ?? 0;
        return state.adminPushes;
      },
    } as any,
    { raise: async (kind: string) => { alerts.push(kind); } } as any,
    {
      sendSupportRequestNotice: async (input: any) => {
        letters.push({ who: input.who, ...(input.lastMessageText ? { lastMessageText: input.lastMessageText } : {}) });
        return options.mailerSends ?? true;
      },
    } as any,
    { info: () => {}, warn: () => {}, error: () => {} } as any,
  );

  const webhook = new ProcessLineWebhookUseCase(
    prisma,
    config,
    {} as any,
    { log: async () => undefined } as any,
    {} as any,
    {
      buildTextMessage: (text: string) => ({ type: 'text', text }),
      sendReply: async (_token: string, messages: any[]) => { replies.push(JSON.stringify(messages)); return 'ok'; },
      sendPush: async () => 'ok',
    } as any,
    {} as any, {} as any, {} as any,
    { startSweep: () => ({ end: () => {} }) } as any,
    {} as any,
    ...Array.from({ length: 17 }, () => undefined) as [],
    undefined as any,
    { enqueueSupportRequest: async (id: string) => { notices.push(id); } } as any,
    { consumeLineSupportRequestSlot: async () => options.supportSlot ?? true } as any,
  );
  (webhook as any).logger = { error: () => {}, warn: () => {}, log: () => {} };

  return {
    webhook, notify, unlink: new UnlinkLineIdentityUseCase(prisma),
    admin: new SupportRequestAdminUseCase(prisma, config),
    replies, notices, letters, alerts,
    get adminPushes() { return state.adminPushes; },
  };
}

/** The same 16-char sha256 prefix the audit rail and the request row carry. */
const hashOf = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);

const event = (lineUserId: string, text: string) => ({
  webhookEventId: `evt-${randomUUID()}`,
  replyToken: 'reply-1',
  lineUserId,
  messageText: text,
  messagingChannelId: CHANNEL,
}) as any;

/** One shop, one owner, one linked LINE account — and a context row pointing somewhere else. */
async function seed(client: PrismaClient, tag: string, lineUserId: string) {
  const userId = `${tag}-user`;
  const companyId = `${tag}-company`;
  const staleCompanyId = `${tag}-stale-company`;
  const role = await client.role.findUniqueOrThrow({ where: { scopeKey_key: { scopeKey: 'system', key: 'OWNER' } } });
  await client.user.create({ data: { id: userId, displayName: `${tag} owner`, status: 'ACTIVE' } });
  for (const [id, name] of [[companyId, `ร้านปัจจุบัน ${tag}`], [staleCompanyId, `The lobby clube ${tag}`]] as const) {
    await client.company.create({ data: { id, name, businessCategory: 'RETAIL', status: 'ACTIVE' } });
  }
  await client.companyMembership.create({
    data: { id: `${tag}-membership`, companyId, userId, status: 'ACTIVE' },
  });
  await client.membershipRole.create({ data: { membershipId: `${tag}-membership`, roleId: role.id } });
  await client.externalIdentity.create({
    data: {
      id: `${tag}-identity`, userId, provider: 'LINE',
      providerUserId: lineUserId, providerChannelId: CHANNEL, status: 'ACTIVE',
    },
  });
  // E2: the chat had resolved to a shop this person is NOT a member of. Left deliberately stale.
  await client.lineCompanyContext.create({ data: { lineUserId, companyId: staleCompanyId } });
  return { userId, companyId, staleCompanyId };
}

/**
 * Every delete is keyed on this run's own ids. The guard above already refuses anything but the
 * local docker database, but this spec shares that database with a developer's seeded data — a
 * `deleteMany` broad enough to be convenient here is broad enough to empty their dev environment.
 */
async function cleanup(client: PrismaClient, tag: string, lineUserId: string) {
  const requestIds = (await client.lineSupportRequest.findMany({ where: { lineUserId }, select: { id: true } }))
    .map((row) => row.id);
  await client.auditLog.deleteMany({ where: { targetId: { in: requestIds } } });
  await client.lineSupportRequest.deleteMany({ where: { lineUserId } });
  await client.lineCompanyContext.deleteMany({ where: { lineUserId } });
  await client.lineWebhookEventLog.deleteMany({ where: { lineUserIdHash: hashOf(lineUserId) } });
  await client.companySignupRequest.deleteMany({ where: { lineProviderUserId: lineUserId } });
  await client.externalIdentity.deleteMany({ where: { providerUserId: lineUserId } });
  await client.membershipRole.deleteMany({ where: { membershipId: `${tag}-membership` } });
  await client.companyMembership.deleteMany({ where: { userId: `${tag}-user` } });
  await client.company.deleteMany({ where: { id: { in: [`${tag}-company`, `${tag}-stale-company`] } } });
  await client.user.deleteMany({ where: { id: `${tag}-user` } });
}

describe('"ติดต่อเจ้าหน้าที่" on real PostgreSQL', { skip: !databaseUrl }, () => {
  it('claims, replies to a no-company case, and resolves it with durable operator evidence', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    const operationId = randomUUID();
    try {
      const { userId } = await seed(client, tag, lineUserId);
      const request = await client.lineSupportRequest.create({
        data: { lineUserId, lineUserIdHash: hashOf(lineUserId), requestText: 'สมัครร้านต่อไม่ได้ค่ะ' },
      });
      const h = wire(client);
      let pushedTo: string | undefined;
      globalThis.fetch = (async (_url: unknown, init: any) => {
        pushedTo = JSON.parse(init.body).to;
        return new Response('', { status: 200 });
      }) as typeof fetch;

      await h.admin.claim(request.id, userId, `${tag}-claim`);
      const replied = await h.admin.reply(
        request.id, 'กรุณาส่งอีเมลที่ต้องการใช้ค่ะ', operationId, null, userId, `${tag}-reply`,
      );
      assert.equal(replied.deliveryStatus, 'SENT');
      assert.equal(pushedTo, lineUserId, 'the recipient came from the server-side request');
      await h.admin.resolve(request.id, 'ได้รับอีเมลและดำเนินการให้แล้ว', userId, `${tag}-resolve`);

      const stored = await client.lineSupportRequest.findUniqueOrThrow({ where: { id: request.id } });
      assert.equal(stored.lastReplyText, 'กรุณาส่งอีเมลที่ต้องการใช้ค่ะ');
      assert.equal(stored.lastReplyDeliveryStatus, 'SENT');
      assert.equal(stored.status, 'CLOSED');
      assert.equal(stored.closedReason, 'resolved');
      assert.equal(stored.resolutionNote, 'ได้รับอีเมลและดำเนินการให้แล้ว');
      const audits = await client.auditLog.findMany({ where: { targetId: request.id } });
      assert.deepEqual(new Set(audits.map((audit) => audit.action)), new Set([
        'system.support_request.claimed',
        'system.support_request.reply',
        'system.support_request.resolved',
      ]));
    } finally {
      globalThis.fetch = originalFetch;
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  it('pages beyond 200 live cases without hiding the older queue tail', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const { userId, companyId } = await seed(client, tag, lineUserId);
      const start = new Date('2026-01-01T00:00:00.000Z').getTime();
      await client.lineSupportRequest.createMany({ data: Array.from({ length: 205 }, (_, index) => ({
        id: `${tag}-request-${String(index).padStart(3, '0')}`,
        companyId,
        lineUserId,
        lineUserIdHash: hashOf(lineUserId),
        requestedAt: new Date(start + index * 1_000),
        lastMessageAt: new Date(start + index * 1_000),
      })) });
      const h = wire(client);
      const first = await h.admin.list(userId, { status: 'OPEN', limit: 200 });
      assert.equal(first.items.length, 200);
      assert.equal(first.totalCount, 205);
      assert.ok(first.nextCursor);
      const second = await h.admin.list(userId, { status: 'OPEN', limit: 200, cursor: first.nextCursor! });
      assert.equal(second.items.length, 5);
      assert.equal(second.nextCursor, null);
      assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 205);
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  it('files the request against the shop the asker is IN, not the one the context row remembers', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const { companyId, staleCompanyId } = await seed(client, tag, lineUserId);
      const h = wire(client);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));

      const rows = await client.lineSupportRequest.findMany({ where: { lineUserId } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.companyId, companyId, 'membership decides');
      assert.notEqual(rows[0]!.companyId, staleCompanyId, 'the row that survived an unlink does not');
      assert.equal(rows[0]!.status, 'OPEN');
      assert.match(rows[0]!.lineUserIdHash, /^[0-9a-f]{16}$/);
      assert.deepEqual(h.notices, [rows[0]!.id], 'the notice names the request');

      // Linked, so there IS an assistant to stop.
      const context = await client.lineCompanyContext.findUnique({ where: { lineUserId } });
      assert.ok(context?.aiPausedUntil && context.aiPausedUntil.getTime() > Date.now(), 'the pause is running');

      // §2.2.4: a second tap while the first is OPEN answers, and pages nobody twice.
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      assert.equal(await client.lineSupportRequest.count({ where: { lineUserId } }), 1);
      assert.equal(h.notices.length, 1);
      assert.match(h.replies.at(-1)!, /ยังอยู่ในคิว/);
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  it('after an unlink: no shop, no pause, and the pending application carries the queue link', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const { userId } = await seed(client, tag, lineUserId);
      const h = wire(client);

      // §2.5: the unlink takes the context row with it, so nothing is left pointing at a shop.
      await h.unlink.execute({ userId, requestId: `${tag}-req` });
      assert.equal(await client.lineCompanyContext.count({ where: { lineUserId } }), 0);

      const signup = await client.companySignupRequest.create({
        data: {
          externalSignupId: `${tag}-ext`, payloadHash: tag, companyName: 'The sun coffee',
          ownerDisplayName: 'นิด', consentVersion: '2026-08-01', source: 'line-oa',
          state: 'PENDING_REVIEW', lineProviderUserId: lineUserId, lineChannelId: CHANNEL,
        },
      });

      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));

      const row = await client.lineSupportRequest.findFirstOrThrow({ where: { lineUserId } });
      assert.equal(row.companyId, null, 'no ACTIVE membership means no shop');
      assert.equal(row.signupRequestId, signup.id, 'the application is the queue link');
      assert.equal(await client.lineCompanyContext.count({ where: { lineUserId } }), 0,
        'an unlinked asker has no assistant to pause');
      assert.match(h.replies.at(-1)!, /รับเรื่องแล้วค่ะ/, 'and is answered all the same');
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  it('records zero LINE pushes and raises support_unreachable when no channel delivered', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      await seed(client, tag, lineUserId);

      // The production reading: nobody has LINE linked AND the mailer has no provider.
      const dark = wire(client, { adminUserIds: [], mailerSends: false });
      await dark.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      const id = dark.notices[0]!;
      await dark.notify.deliverSupportNotice(id);

      const row = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      assert.equal(row.lineNotifiedCount, 0);
      assert.equal(row.emailSent, false);
      assert.deepEqual(dark.alerts, ['support_unreachable']);
      assert.equal(row.status, 'OPEN', 'and the request is still in the inbox, which is the point');

      // The inbox names the shop and hides the LINE id, whatever happened on the other rails.
      const queue = await dark.admin.list('system-test-admin', { status: 'OPEN' });
      const item = queue.items.find((entry) => entry.id === id);
      assert.ok(item, 'the request an operator can act on is listed');
      assert.match(item!.askerLabel, /ร้านปัจจุบัน/);
      assert.equal(JSON.stringify(queue).includes(lineUserId), false, '§3: no raw LINE id crosses the API');
      assert.ok(queue.openCount >= 1);
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  it('sends the letter when SES works, and then does not shout', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      await seed(client, tag, lineUserId);
      const h = wire(client, { adminUserIds: [], mailerSends: true });
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      await h.notify.deliverSupportNotice(h.notices[0]!);

      const row = await client.lineSupportRequest.findUniqueOrThrow({ where: { id: h.notices[0]! } });
      assert.equal(row.emailSent, true);
      assert.match(h.letters[0]!.who, /ร้านปัจจุบัน/);
      assert.deepEqual(h.alerts, [], 'somebody was told');
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  it('lets the customer bring the assistant back without hiding their unresolved request', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      await seed(client, tag, lineUserId);
      const h = wire(client);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      // Owner 2026-09-06: the way back is the "คุยกับน้องมั่งมี" tile itself, tapped or typed. Driven
      // here so the whole chain — tile, pause state, row — is pinned on real rows.
      await h.webhook.execute(event(lineUserId, RESUME_AI_COMMAND));

      const context = await client.lineCompanyContext.findUniqueOrThrow({ where: { lineUserId } });
      assert.equal(context.aiPausedUntil, null, 'the pause is what the customer is living with');
      const row = await client.lineSupportRequest.findFirstOrThrow({ where: { lineUserId } });
      assert.equal(row.status, 'OPEN');
      assert.equal(row.closedReason, null);
      assert.match(h.replies.at(-1)!, /น้องมั่งมีกลับมาแล้ว/);
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  it('lets an operator lift the pause from /system, and audits it', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const { userId } = await seed(client, tag, lineUserId);
      const h = wire(client);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      const id = h.notices[0]!;

      await h.admin.claim(id, userId, `${tag}-claim`);
      await h.admin.markAnswered(id, userId, `${tag}-answered`);
      assert.equal((await client.lineSupportRequest.findUniqueOrThrow({ where: { id } })).status, 'ANSWERED');

      const result = await h.admin.resumeAssistant(id, userId, `${tag}-resume`);
      assert.equal(result.pauseCleared, true);
      const context = await client.lineCompanyContext.findUniqueOrThrow({ where: { lineUserId } });
      assert.equal(context.aiPausedUntil, null);
      const row = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, 'ANSWERED', 'resuming the assistant is not issue resolution');
      assert.equal(row.closedReason, null);

      const audits = await client.auditLog.findMany({ where: { targetId: id }, orderBy: { createdAt: 'asc' } });
      assert.deepEqual(audits.map((a) => a.action), [
        'system.support_request.claimed', 'system.support_request.answered', 'system.support_request.resume_ai',
      ]);
      assert.ok(audits.every((a) => a.riskLevel === 'HIGH'));
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  /**
   * UAT 2026-09-06: "เจ้าหน้าที่ตอบกลับแล้วคำขอหายไปเลย ทั้งที่ยังไม่จบ".
   *
   * Only real rows can show this one: the reopen is a status transition PLUS a counter increment
   * PLUS an answer that must survive both, and a fake that models the request as an object accepts
   * whichever shape the code happens to write. `openCount` is the load-bearing part — it is the
   * header badge, and an ANSWERED row is not in it.
   */
  it('brings an ANSWERED request back into รอตอบ when the customer writes again', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const { userId } = await seed(client, tag, lineUserId);
      const h = wire(client);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      const id = h.notices[0]!;

      await h.admin.claim(id, userId, `${tag}-claim`);
      await h.admin.markAnswered(id, userId, `${tag}-answered`);
      const answered = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      assert.equal(answered.status, 'ANSWERED');
      assert.equal((await h.admin.list(userId, { status: 'OPEN' })).items.some((row) => row.id === id), false,
        'off the tab, which is the state the customer then wrote into');

      await h.webhook.execute(event(lineUserId, 'ยังไม่ได้เลยค่ะ ลองแล้วไม่ขึ้น'));

      const row = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, 'OPEN', 'the same request, waiting again');
      assert.equal(row.reopenedCount, 1);
      assert.equal(row.lastMessageText, 'ยังไม่ได้เลยค่ะ ลองแล้วไม่ขึ้น');
      assert.ok(row.lastMessageAt.getTime() >= answered.answeredAt!.getTime(),
        'the waiting clock counts from the message, not from the answer');
      // History, not a lie to erase: the inbox says "ตอบแล้ว 1 ครั้ง · ลูกค้าตอบกลับ" from these.
      assert.equal(row.answeredByUserId, userId);
      assert.deepEqual(row.answeredAt, answered.answeredAt);

      const queue = await h.admin.list(userId, { status: 'OPEN' });
      const item = queue.items.find((entry) => entry.id === id);
      assert.ok(item, 'and an operator can see it again');
      assert.equal(item!.reopenedCount, 1);
      assert.equal(item!.lastMessageText, 'ยังไม่ได้เลยค่ะ ลองแล้วไม่ขึ้น');
      assert.equal(JSON.stringify(queue).includes(lineUserId), false, '§3: still no raw LINE id');
      assert.equal((await h.admin.openCount()).open >= 1, true, 'the header badge counts it again');

      // (The follow-up audit row is asserted in line-first-signup-webhook.spec.ts: the audit
      // service is a no-op fake in this harness, which only wires LINE, SES and the outbox.)

      // A pause is still running, so the customer was answered by the honest line, not the
      // assistant — and briefly, because the tap that opened this thread spoke moments ago
      // (§2.2 delta รอบ 6). The record is what matters and it is above; the card is not repeated.
      assert.match(h.replies.at(-1)!, /รับข้อความแล้วค่ะ/);
      assert.equal(h.replies.at(-1)!.includes('ทีมงานจะตอบกลับในแชทนี้'), false);

      // Ten minutes later the same customer is not repeating themselves, and hears the whole
      // thing again. Backdated rather than waited for: the clock is a column, not a timer.
      await client.lineSupportRequest.update({
        where: { id }, data: { lastMessageAt: new Date(Date.now() - 11 * 60_000) },
      });
      await h.webhook.execute(event(lineUserId, 'ยังอยู่ไหมคะ'));

      assert.match(h.replies.at(-1)!, /ส่งข้อความถึงทีมงานแล้ว/);
      assert.equal((await client.lineSupportRequest.findUniqueOrThrow({ where: { id } })).lastMessageText,
        'ยังอยู่ไหมคะ', 'and every line is still recorded, throttled reply or not');
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  // CLOSED is settled by somebody deciding. A later message must not resurrect it — a fresh
  // "ติดต่อเจ้าหน้าที่" is how a new matter opens (§2.2.4).
  it('never reopens a request an operator already resolved', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      await seed(client, tag, lineUserId);
      const h = wire(client);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      const id = h.notices[0]!;
      await client.lineSupportRequest.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: new Date(), closedReason: 'resolved' },
      });
      assert.equal((await client.lineSupportRequest.findUniqueOrThrow({ where: { id } })).status, 'CLOSED');

      // Keep the pause armed to prove the follow-up path itself refuses a CLOSED row.
      await client.lineCompanyContext.update({
        where: { lineUserId }, data: { aiPausedUntil: new Date(Date.now() + 3_600_000) },
      });
      await h.webhook.execute(event(lineUserId, 'ขอบคุณค่ะ'));

      const row = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, 'CLOSED');
      assert.equal(row.reopenedCount, 0);
      assert.notEqual(row.lastMessageText, 'ขอบคุณค่ะ');
      assert.match(h.replies.at(-1)!, /ยังส่งข้อความนี้เข้าคิวทีมงานไม่สำเร็จ/);
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  /**
   * M7 (reviewer probe). A membership in a company the plan-term sweep DISABLED is not a shop this
   * person can be helped in — and only real rows can show it, because the filter lives in the
   * `company: { status: 'ACTIVE' }` join a fake would have to reimplement to disagree with.
   */
  it('treats a DISABLED-company member as having no shop, and creates no context row', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const { companyId } = await seed(client, tag, lineUserId);
      await client.lineCompanyContext.deleteMany({ where: { lineUserId } });
      await client.company.update({ where: { id: companyId }, data: { status: 'DISABLED' } });

      const h = wire(client);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));

      const row = await client.lineSupportRequest.findFirstOrThrow({ where: { lineUserId } });
      assert.equal(row.companyId, null, 'a shop that is switched off is not a shop to file against');
      assert.equal(await client.lineCompanyContext.count({ where: { lineUserId } }), 0,
        'and nothing pauses an assistant that has no company to run for');
      assert.deepEqual(h.notices, [row.id], 'they still reach a human');
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  it('opens no request at all once the daily floor is spent, and silences nothing', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      await seed(client, tag, lineUserId);
      await client.lineCompanyContext.deleteMany({ where: { lineUserId } });
      const h = wire(client, { supportSlot: false });
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));

      assert.equal(await client.lineSupportRequest.count({ where: { lineUserId } }), 0);
      assert.deepEqual(h.notices, []);
      assert.match(h.replies.at(-1)!, /วันนี้ยังเปิดคำขอคุยกับเจ้าหน้าที่เพิ่มไม่ได้/);
      assert.doesNotMatch(h.replies.at(-1)!, /รับเรื่องไว้แล้ว|ทีมงานจะติดต่อกลับ/);
      // A refused tap opens nothing and pages nobody, so a 24h pause on the strength of it would
      // cost the customer the assistant AND leave nothing in the inbox to be answered from.
      assert.equal(await client.lineCompanyContext.count({ where: { lineUserId } }), 0,
        'the assistant is not silenced by a tap that did nothing');
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  // §3 PDPA: the raw LINE id and the customer's own words leave the database 90 days after the
  // matter settled. Proven against real rows because "the row is gone" is the whole assertion.
  it('deletes only an explicitly CLOSED request 90 days on', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      await seed(client, tag, lineUserId);
      const h = wire(client);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      const id = h.notices[0]!;
      const long = new Date(Date.now() - 100 * 86_400_000);

      // Old, but still OPEN: somebody is waiting, however long it has been.
      await client.lineSupportRequest.update({ where: { id }, data: { requestedAt: long } });
      assert.deepEqual(await h.notify.purgeSettledSupportRequests(), { purged: 0 });
      assert.equal(await client.lineSupportRequest.count({ where: { id } }), 1);

      // A reply is delivery evidence, not resolution. Keep old ANSWERED cases in the queue too.
      await client.lineSupportRequest.update({ where: { id }, data: { status: 'ANSWERED', answeredAt: long } });
      assert.deepEqual(await h.notify.purgeSettledSupportRequests(), { purged: 0 });
      assert.equal(await client.lineSupportRequest.count({ where: { id } }), 1);

      // Settled 100 days ago: the message text and the LINE id go with the row.
      await client.lineSupportRequest.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: long, closedReason: 'expired', lastMessageText: 'ช่วยด้วยค่ะ' },
      });
      assert.equal((await h.notify.purgeSettledSupportRequests()).purged >= 1, true);
      assert.equal(await client.lineSupportRequest.count({ where: { id } }), 0);
      assert.equal(await client.lineSupportRequest.count({ where: { lineUserId } }), 0);
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  it('keeps an OPEN request managed after its 24h assistant pause has lapsed', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      await seed(client, tag, lineUserId);
      const h = wire(client);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      const id = h.notices[0]!;

      // Still inside the pause: nothing to expire, even though the row is a day old. Both stamps
      // move: the window is measured from the newest customer message (review 2026-09-06), and
      // `requestedAt` alone must no longer be able to expire anything.
      await client.lineSupportRequest.update({
        where: { id },
        data: {
          requestedAt: new Date(Date.now() - 48 * 3_600_000),
          lastMessageAt: new Date(Date.now() - 48 * 3_600_000),
        },
      });
      assert.deepEqual(await h.notify.sweepExpiredSupportRequests(), { expired: 0 });
      assert.equal((await client.lineSupportRequest.findUniqueOrThrow({ where: { id } })).status, 'OPEN');

      // Pause lapsed: the assistant state changed, but nobody proved the support issue resolved.
      await client.lineCompanyContext.update({
        where: { lineUserId }, data: { aiPausedUntil: new Date(Date.now() - 1_000) },
      });
      assert.deepEqual(await h.notify.sweepExpiredSupportRequests(), { expired: 0 });
      const row = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, 'OPEN');
      assert.equal(row.closedReason, null);
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  /**
   * Review 2026-09-06 (F1). The sweep used to time from `requestedAt`, so a request reopened at
   * hour 23 was closed at hour 24 with an unanswered question on it — moments after the customer
   * was told "ทีมงานจะตอบกลับในแชทนี้นะคะ". Only real rows show it: the follow-up has to move BOTH
   * the request's clock and the pause the sweep excludes on, and they are two tables.
   */
  it('does not expire a request the customer wrote to an hour ago', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      await seed(client, tag, lineUserId);
      const h = wire(client);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      const id = h.notices[0]!;

      // Hour 23 of the original ask, and the pause with it: the state the old sweep closed.
      const old = new Date(Date.now() - 23 * 3_600_000);
      await client.lineSupportRequest.update({
        where: { id }, data: { requestedAt: old, lastMessageAt: old },
      });
      await client.lineCompanyContext.update({
        where: { lineUserId }, data: { aiPausedUntil: new Date(Date.now() + 3_600_000) },
      });

      await h.webhook.execute(event(lineUserId, 'ยังไม่ได้เลยค่ะ'));

      const written = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      assert.ok(written.lastMessageAt.getTime() > old.getTime(), 'their message moved the clock');
      const context = await client.lineCompanyContext.findUniqueOrThrow({ where: { lineUserId } });
      const pausedHours = (context.aiPausedUntil!.getTime() - Date.now()) / 3_600_000;
      assert.ok(pausedHours > 23.9, `the pause was re-armed with it, got ${pausedHours}`);

      // An hour later the ORIGINAL 24h would have lapsed. Nothing is due: they wrote a moment ago.
      assert.deepEqual(await h.notify.sweepExpiredSupportRequests(new Date(Date.now() + 3_600_000)), { expired: 0 });
      assert.equal((await client.lineSupportRequest.findUniqueOrThrow({ where: { id } })).status, 'OPEN');
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  /**
   * Review 2026-09-06 (F3/F7). Three things only real rows can show together: the question survives
   * every later message, a photo leaves a marker and not a sentence, and TAPPING the button on an
   * ANSWERED request reopens that request instead of opening a second one beside it.
   */
  it('keeps the question, marks a photo, and reopens on a tap rather than opening a second row', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const { userId } = await seed(client, tag, lineUserId);
      const h = wire(client);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      const id = h.notices[0]!;
      // What the tap files as the question comes from the assistant's own `AiTurn` memory, which
      // this harness does not wire (it fakes the AI lane). Written directly, because what is under
      // test here is that NOTHING AFTERWARDS may move it.
      await client.lineSupportRequest.update({
        where: { id },
        data: { requestText: 'ส่งใบเสร็จแล้วไม่เห็นขึ้นเลยค่ะ', lastMessageText: 'ส่งใบเสร็จแล้วไม่เห็นขึ้นเลยค่ะ' },
      });

      // A nudge moves the newest message and leaves the question alone.
      await h.webhook.execute(event(lineUserId, 'มีอัปเดตไหมคะ'));
      const nudged = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      assert.equal(nudged.requestText, 'ส่งใบเสร็จแล้วไม่เห็นขึ้นเลยค่ะ', 'still the question');
      assert.equal(nudged.lastMessageText, 'มีอัปเดตไหมคะ');
      assert.equal(nudged.lastMediaAt, null);

      // A photo is a marker: §3 keeps the bytes out, and the words stay exactly as they were.
      await h.webhook.executeReceiptUpload({
        webhookEventId: `evt-${randomUUID()}`, replyToken: 'reply-1', lineUserId,
        lineMessageId: `msg-${randomUUID()}`, messageType: 'image', messagingChannelId: CHANNEL,
      } as any);
      const withPhoto = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      assert.ok(withPhoto.lastMediaAt, 'the operator learns a photo arrived');
      assert.equal(withPhoto.lastMessageText, 'มีอัปเดตไหมคะ', 'and it costs the thread no words');
      assert.equal(withPhoto.requestText, 'ส่งใบเสร็จแล้วไม่เห็นขึ้นเลยค่ะ');

      // F7: answered, then TAPPED again. One request, reopened — not two rows for one conversation.
      await h.admin.claim(id, userId, `${tag}-claim`);
      await h.admin.markAnswered(id, userId, `${tag}-answered`);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));

      assert.equal(await client.lineSupportRequest.count({ where: { lineUserId } }), 1,
        'a tap after an answer is the same conversation');
      const reopened = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      assert.equal(reopened.status, 'OPEN');
      assert.equal(reopened.reopenedCount, 1);
      assert.equal(reopened.lastMessageText, 'มีอัปเดตไหมคะ', 'the tap itself is not a message to show');
      assert.equal(h.notices.length, 1, 'and nobody is paged twice for one conversation');
      assert.match(h.replies.at(-1)!, /ยังอยู่ในคิว/);
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  /**
   * Review 2026-09-06 (N1, the reviewer's own probe). A photo used to travel the full follow-up
   * path: it reopened an ANSWERED thread, moved `lastMessageAt`, and re-armed the 24 h mute. A shop
   * that uploads one receipt a day therefore kept its assistant switched off and its inbox row
   * alive for ever, on nothing but its ordinary bookkeeping. Two tables, so only real rows show it:
   * the request must not move and the pause must still end when it was going to.
   */
  it('leaves an ANSWERED request and its mute exactly where they were when a photo arrives', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const { userId } = await seed(client, tag, lineUserId);
      const h = wire(client);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      const id = h.notices[0]!;
      await h.admin.claim(id, userId, `${tag}-claim`);
      await h.admin.markAnswered(id, userId, `${tag}-answered`);

      // An hour of mute left — the state the probe describes, and the one the old code pushed out
      // by another full day on every receipt.
      const endsAt = new Date(Date.now() + 3_600_000);
      await client.lineCompanyContext.update({ where: { lineUserId }, data: { aiPausedUntil: endsAt } });
      const answered = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });

      await h.webhook.executeReceiptUpload({
        webhookEventId: `evt-${randomUUID()}`, replyToken: 'reply-1', lineUserId,
        lineMessageId: `msg-${randomUUID()}`, messageType: 'image', messagingChannelId: CHANNEL,
      } as any);

      const row = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, 'ANSWERED', 'a receipt is not the customer asking again');
      assert.equal(row.reopenedCount, 0);
      assert.ok(row.lastMediaAt, 'but the operator still learns a photo arrived');
      assert.deepEqual(row.lastMessageAt, answered.lastMessageAt, 'the waiting clock did not move');
      assert.equal(row.lastMessageText, answered.lastMessageText);

      const context = await client.lineCompanyContext.findUniqueOrThrow({ where: { lineUserId } });
      assert.deepEqual(context.aiPausedUntil, endsAt, 'and the mute still ends in an hour, not tomorrow');
      assert.equal((await h.admin.list(userId, { status: 'OPEN' })).items.some((entry) => entry.id === id), false,
        'a settled thread stays settled: the row is not back on รอตอบ');
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  /**
   * Review 2026-09-06 (N2). §2.5 deletes the context row on unlink; the re-arm was an upsert keyed
   * on the shop the REQUEST remembers, so a follow-up rebuilt it for a shop the person had left.
   * Real rows are the point: the delete and the resurrection are the same table.
   */
  it('does not resurrect a context row the unlink deleted', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const { userId, companyId } = await seed(client, tag, lineUserId);
      const h = wire(client);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      const id = h.notices[0]!;
      assert.equal((await client.lineSupportRequest.findUniqueOrThrow({ where: { id } })).companyId, companyId,
        'the live request still names the shop, which is the id the upsert used to trust');

      // §2.5: the unlink takes the context row with it. The request outlives it, so the follow-up
      // path is the one thing left holding a companyId nobody re-checked.
      await h.unlink.execute({ userId, requestId: `${tag}-unlink` });
      assert.equal(await client.lineCompanyContext.count({ where: { lineUserId } }), 0);

      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));

      assert.equal(await client.lineCompanyContext.count({ where: { lineUserId } }), 0,
        'a follow-up may extend a pause; it may not open one against a shop nobody re-checked');
      const row = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, 'OPEN', 'and the request itself is untouched by the missing row');
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });
});
