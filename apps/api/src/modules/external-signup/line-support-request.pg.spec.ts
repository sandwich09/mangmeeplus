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
    admin: new SupportRequestAdminUseCase(prisma),
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
      const queue = await dark.admin.list('OPEN');
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

  it('lets the customer bring the assistant back, and closes their request with it', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      await seed(client, tag, lineUserId);
      const h = wire(client);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      await h.webhook.execute(event(lineUserId, RESUME_AI_COMMAND));

      const context = await client.lineCompanyContext.findUniqueOrThrow({ where: { lineUserId } });
      assert.equal(context.aiPausedUntil, null, 'the pause is what the customer is living with');
      const row = await client.lineSupportRequest.findFirstOrThrow({ where: { lineUserId } });
      assert.equal(row.status, 'CLOSED');
      assert.equal(row.closedReason, 'customer_resumed');
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

      await h.admin.markAnswered(id, userId, `${tag}-answered`);
      assert.equal((await client.lineSupportRequest.findUniqueOrThrow({ where: { id } })).status, 'ANSWERED');

      const result = await h.admin.resumeAssistant(id, userId, `${tag}-resume`);
      assert.equal(result.pauseCleared, true);
      const context = await client.lineCompanyContext.findUniqueOrThrow({ where: { lineUserId } });
      assert.equal(context.aiPausedUntil, null);
      const row = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, 'CLOSED');
      assert.equal(row.closedReason, 'admin');

      const audits = await client.auditLog.findMany({ where: { targetId: id }, orderBy: { createdAt: 'asc' } });
      assert.deepEqual(audits.map((a) => a.action), [
        'system.support_request.answered', 'system.support_request.resume_ai',
      ]);
      assert.ok(audits.every((a) => a.riskLevel === 'HIGH'));
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
      assert.match(h.replies.at(-1)!, /รับเรื่องไว้แล้วค่ะ/);
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
  it('deletes a settled request 90 days on, and never an OPEN one', async () => {
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

  it('expires an OPEN request once its 24h pause has lapsed, and leaves a live one alone', async () => {
    const client = connect();
    const tag = `linesupport-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      await seed(client, tag, lineUserId);
      const h = wire(client);
      await h.webhook.execute(event(lineUserId, STAFF_CONTACT_COMMAND));
      const id = h.notices[0]!;

      // Still inside the pause: nothing to expire, even though the row is a day old.
      await client.lineSupportRequest.update({
        where: { id }, data: { requestedAt: new Date(Date.now() - 48 * 3_600_000) },
      });
      assert.deepEqual(await h.notify.sweepExpiredSupportRequests(), { expired: 0 });
      assert.equal((await client.lineSupportRequest.findUniqueOrThrow({ where: { id } })).status, 'OPEN');

      // Pause lapsed: the customer is not waiting on us any more.
      await client.lineCompanyContext.update({
        where: { lineUserId }, data: { aiPausedUntil: new Date(Date.now() - 1_000) },
      });
      assert.equal((await h.notify.sweepExpiredSupportRequests()).expired >= 1, true);
      const row = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, 'CLOSED');
      assert.equal(row.closedReason, 'expired');
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });
});
