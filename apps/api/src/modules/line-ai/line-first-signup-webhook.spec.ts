import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { LineWebhookController } from '../auth/presentation/line-webhook.controller';
import {
  LINE_FOLLOW_EVENT_TEXT, PACKAGE_CHANGE_COMMAND, PROFILE_GUARD_COMMAND, PROFILE_GUARD_LATER_COMMAND,
  STAFF_CONTACT_COMMAND, EMPLOYEE_DOOR_COMMAND, RESUME_AI_COMMAND,
  linePostbackCommandText, staffMenuCommand,
} from './domain/logic/line-staff-menu.logic';
import { buildSignupDoorCard, buildSignupStatusCard, buildAiBudgetExceededMessage } from './domain/logic/line-business-card.logic';
import { classifyLineAiGatewayFailure } from './domain/logic/line-ai-terminal-outcome.logic';
import { ProcessLineWebhookUseCase } from './application/use-cases/process-line-webhook.use-case';
import { AuthRateLimitService } from '../auth/application/auth-rate-limit.service';
import { RedisRateLimitService } from '../../common/security/redis-rate-limit.service';

const WEB_BASE = 'https://app.example.test';

// ── Controller: the two event kinds that used to fall off the end of the arms (G-03, G-04) ──

function sign(rawBody: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

function webhookRequest(events: unknown[]) {
  const rawBody = Buffer.from(JSON.stringify({ destination: 'bot', events }));
  return {
    headers: { 'x-line-signature': sign(rawBody, 'line-secret') },
    rawBody,
    body: JSON.parse(rawBody.toString('utf8')),
  } as any;
}

function makeWebhookController() {
  const enqueued: any[] = [];
  const controller = new LineWebhookController(
    { lineMessagingChannelSecret: 'line-secret', lineMessagingChannelId: 'msg-channel-1' } as any,
    { enqueue: async (envelope: unknown) => { enqueued.push(envelope); } } as any,
  );
  return { controller, enqueued };
}

describe('P10-L webhook intake (G-03/G-04)', () => {
  it('carries a follow event into the turn lane instead of dropping it', async () => {
    const { controller, enqueued } = makeWebhookController();

    await controller.lineWebhook(webhookRequest([{
      type: 'follow', webhookEventId: 'evt-follow', replyToken: 'reply-1', timestamp: 1751700000000,
      source: { type: 'user', userId: 'Uline-1' },
    }]));

    assert.equal(enqueued.length, 1, 'adding the friend must produce exactly one greeting');
    assert.equal(enqueued[0].item.text, LINE_FOLLOW_EVENT_TEXT);
    // The buffer routes anything staffMenuCommand recognises down the command lane, so the greeting
    // is answered on its own rather than merged into the customer's next message.
    assert.equal(staffMenuCommand(LINE_FOLLOW_EVENT_TEXT), 'follow');
  });

  it('dispatches a known postback action and drops a forged one', async () => {
    const { controller, enqueued } = makeWebhookController();

    await controller.lineWebhook(webhookRequest([
      { type: 'postback', webhookEventId: 'e1', replyToken: 'r1', source: { userId: 'Uline-1' }, postback: { data: 'action=package-change' } },
      { type: 'postback', webhookEventId: 'e2', replyToken: 'r2', source: { userId: 'Uline-1' }, postback: { data: 'action=make-me-owner&companyId=co-9' } },
      { type: 'postback', webhookEventId: 'e3', replyToken: 'r3', source: { userId: 'Uline-1' }, postback: { data: 'companyId=co-9' } },
    ]));

    assert.equal(enqueued.length, 1, 'only the known intent travels; the rest are dropped');
    assert.equal(enqueued[0].item.text, PACKAGE_CHANGE_COMMAND);
  });

  it('keeps the rich-talk postback working through the same dispatcher', async () => {
    const { controller, enqueued } = makeWebhookController();
    await controller.lineWebhook(webhookRequest([{
      type: 'postback', webhookEventId: 'e1', replyToken: 'r1', source: { userId: 'Uline-1' },
      postback: { data: 'action=line-rich-talk' },
    }]));
    assert.equal(enqueued[0].item.text, 'คุยกับน้องมั่งมี');
  });

  it('reads only the action name, never anything else the client attached (SEC-04)', () => {
    // Extra parameters are ignored rather than parsed: there is nothing in `data` a server decision
    // reads, so a forged postback can reach no further than a typed message could.
    assert.equal(linePostbackCommandText('action=package-change&companyId=co-9&role=OWNER'), PACKAGE_CHANGE_COMMAND);
    assert.equal(linePostbackCommandText('action=profile-guard'), PROFILE_GUARD_COMMAND);
    assert.equal(linePostbackCommandText('action=profile-guard-later'), PROFILE_GUARD_LATER_COMMAND);
    assert.equal(linePostbackCommandText('action=unknown'), null);
    assert.equal(linePostbackCommandText(undefined), null);
    assert.equal(linePostbackCommandText(''), null);
  });
});

// ── Cards ──

describe('P10-L door and status cards (§3.1/§7)', () => {
  it('offers four ways on, including one that reaches a person', () => {
    const card = JSON.stringify(buildSignupDoorCard('1234567890-abcdef', WEB_BASE));
    assert.match(card, /เปิดร้านใหม่ ทดลองฟรี/);
    assert.match(card, /https:\/\/liff\.line\.me\/1234567890-abcdef\/signup/);
    assert.match(card, /ฉันเป็นพนักงาน/);
    assert.match(card, /ติดต่อเจ้าหน้าที่/, 'the keyword must be tappable, not only typeable');
    assert.match(card, /บัญชีทางการที่ยืนยันแล้ว/, 'the verified shield guards against a fake OA (§9)');
  });

  // The old door pointed at the LIFF account link-page, whose client reads a `watchdog_access_token`
  // from localStorage — a key nothing writes any more. Every tap ended on an English "WatchDog
  // session missing", which is the opposite of what the door promises.
  it('sends "I already have an account" to the P12 link login, in the external browser', () => {
    const card = JSON.stringify(buildSignupDoorCard('1234567890-abcdef', WEB_BASE));

    assert.match(card, /มีบัญชีอยู่แล้ว เชื่อม LINE/);
    assert.ok(card.includes(`${WEB_BASE}/login?line=link-required&next=%2F&openExternalBrowser=1`));
    // Never the LIFF root: that is the dead page this door used to open.
    assert.equal(card.includes('"https://liff.line.me/1234567890-abcdef"'), false);
  });

  it('drops a door it cannot build rather than sending a broken link', () => {
    const noWeb = JSON.stringify(buildSignupDoorCard('1234567890-abcdef', undefined));
    assert.equal(noWeb.includes('/login?line=link-required'), false);
    assert.match(noWeb, /เปิดร้านใหม่ ทดลองฟรี/, 'the other doors survive');

    const noLiff = JSON.stringify(buildSignupDoorCard(undefined, WEB_BASE));
    assert.equal(noLiff.includes('liff.line.me'), false);
    assert.match(noLiff, /ฉันเป็นพนักงาน/, 'the staff door needs no LIFF id and must survive');
    assert.match(noLiff, /ติดต่อเจ้าหน้าที่/, 'and so must the one that reaches a person');

    // A LIFF id that is not a LIFF id must not be pasted into a URL.
    assert.equal(JSON.stringify(buildSignupDoorCard('javascript:alert(1)', WEB_BASE)).includes('liff.line.me'), false);
    // Neither must a web base that is not an http(s) origin.
    assert.equal(JSON.stringify(buildSignupDoorCard(undefined, 'javascript:alert(1)')).includes('login?line='), false);
  });

  it('says the right thing inside and outside business hours', () => {
    const open = JSON.stringify(buildSignupStatusCard('ร้านนิด', true));
    assert.match(open, /ทีมงานกำลังตรวจสอบ/);
    assert.match(open, /ร้าน ร้านนิด/);
    // The bubble's title is already "ได้รับคำขอแล้ว" — the body must not open with it too
    // (Owner 2026-09-05), and it says the same thing the LIFF waiting card says.
    assert.match(open, /"text":"คำขอเปิดร้าน ร้านนิด เข้าระบบแล้วค่ะ/);
    assert.equal(open.includes('นอกเวลาทำการ'), false);
    // Waiting is when someone most wants a person, so this card carries that door too.
    assert.match(open, /ติดต่อเจ้าหน้าที่/);

    const closed = JSON.stringify(buildSignupStatusCard('ร้านนิด', false));
    assert.match(closed, /นอกเวลาทำการ/);
    assert.match(closed, /วันทำการถัดไป/);
  });

  it('names the trial only for the trial tier (G-05, §15.1)', () => {
    const trial = JSON.stringify(buildAiBudgetExceededMessage(true));
    assert.match(trial, /โควตา AI ของแพ็กเกจเดือนนี้ครบแล้วค่ะ/);
    assert.match(trial, /ช่วงทดลอง/);
    assert.match(trial, /ขอเปลี่ยนแพ็กเกจ/);
    // The reply this replaces; sending it here is the bug G-05 names.
    assert.equal(trial.includes('กำลังประมวลผลข้อความก่อนหน้า'), false);

    const paid = JSON.stringify(buildAiBudgetExceededMessage(false));
    assert.equal(paid.includes('ช่วงทดลอง'), false, 'a paying shop is never told it is on a trial');
    assert.match(paid, /ขอเปลี่ยนแพ็กเกจ/);
  });

  it('maps only the monthly-budget 429 away from the congestion reply', () => {
    const budget = { getStatus: () => 429, getResponse: () => ({ code: 'AI_MONTHLY_BUDGET_EXCEEDED' }) };
    assert.equal(classifyLineAiGatewayFailure(budget).replyKind, 'budget_exceeded');
    assert.equal(classifyLineAiGatewayFailure(budget).status, 'ai_budget_exceeded');

    // Everything else keeps the behaviour it had: this is a fix, not a re-classification.
    const busy = { getStatus: () => 429, getResponse: () => ({ code: 'AI_BUDGET_BUSY' }) };
    assert.equal(classifyLineAiGatewayFailure(busy).replyKind, 'rate_limited');
    const unavailable = { getStatus: () => 429, getResponse: () => ({ code: 'AI_BUDGET_UNAVAILABLE' }) };
    assert.equal(classifyLineAiGatewayFailure(unavailable).replyKind, 'unavailable');
  });
});

// ── Use case: the door, the pause and the package-change request ──

type Harness = ReturnType<typeof harness>;

function harness(options: {
  // `id` only matters to the support path (§2.1.1 queue link); the status card reads the name.
  pendingSignup?: { id?: string; companyName: string } | null;
  identity?: { userId: string; user: { status: string; aiAssistantOptOutAt: Date | null; displayName: string } } | null;
  ownerMembership?: any;
  /** ACTIVE memberships in ACTIVE companies — what `resolveCompanyForLineUser` reads (§2.1.1). */
  memberships?: Array<{ companyId: string; roles: unknown[]; company?: { name: string } }>;
  context?: { companyId: string; aiPausedUntil: Date | null } | null;
  contextUpdateCount?: number;
  /** A live `LineSupportRequest` for this LINE user, if one is already in the queue (§2.2.4).
   *  `lastMessageAt` is NOT NULL in the schema, so the fake supplies one; it is the clock the
   *  confirmation throttle reads (§2.2 delta รอบ 6) and defaults to "long enough ago to speak". */
  openSupportRequest?: { id: string; status?: string; companyId?: string | null; lastMessageAt?: Date } | null;
  /** Rows the conditional follow-up write actually moved. `0` = somebody else got there first. */
  followUpUpdateCount?: number;
  /** The last thing this customer typed, as `AiTurn` kept it. */
  lastTurn?: { userMessagePreview: string | null } | null;
  /** The amplification floor: `false` = this LINE account has spent its three asks for today. */
  supportSlot?: boolean;
  /** A REAL `AuthRateLimitService`, for the store-failure case a fake boolean cannot show. */
  rateLimit?: unknown;
  /** Absent means LINE_MESSAGING_CHANNEL_ID is unset (L-19). */
  channelId?: string;
  liffId?: string;
} = {}) {
  const replies: any[] = [];
  const eventLog: any[] = [];
  const audits: any[] = [];
  const packageChanges: any[] = [];
  const supportNotices: any[] = [];
  const contextUpdates: any[] = [];
  const contextUpserts: any[] = [];
  const supportRequests: any[] = [];
  const supportClosures: any[] = [];
  const supportLookups: any[] = [];
  const supportUpdates: any[] = [];
  const supportSlots: string[] = [];
  const membershipQueries: any[] = [];
  const errors: any[] = [];

  const prisma = {
    client: {
      companySignupRequest: { findFirst: async () => options.pendingSignup ?? null },
      lineCompanyContext: {
        findUnique: async () => options.context ?? null,
        updateMany: async (args: any) => {
          contextUpdates.push(args);
          return { count: options.contextUpdateCount ?? (options.context ? 1 : 0) };
        },
        upsert: async (args: any) => { contextUpserts.push(args); return {}; },
      },
      // §2.1: the request row IS the fact of the ask, written before anyone is notified.
      lineSupportRequest: {
        // The `where` IS the guard for the follow-up lookup (which statuses may be reopened), so
        // the query is recorded: a fake that only returns a row cannot show what was asked for.
        findFirst: async (args: any) => {
          supportLookups.push(args);
          return options.openSupportRequest
            ? { lastMessageAt: new Date(Date.now() - 86_400_000), ...options.openSupportRequest }
            : null;
        },
        create: async (args: any) => { supportRequests.push(args); return { id: 'sr-1' }; },
        // Two callers share this model. The resume/close path writes a terminal status; the
        // follow-up path writes the newest customer message (or, for a photo, the marker alone),
        // and its `count` is load-bearing — 0 means "ตอบแล้ว" won the race and nothing was recorded.
        updateMany: async (args: any) => {
          if (args.data?.lastMessageAt !== undefined || args.data?.lastMediaAt !== undefined) {
            supportUpdates.push(args);
            return { count: options.followUpUpdateCount ?? 1 };
          }
          supportClosures.push(args);
          return { count: 1 };
        },
      },
      aiTurn: { findFirst: async () => options.lastTurn ?? null },
      externalIdentity: { findFirst: async () => options.identity ?? null },
      companyMembership: {
        // The role and company-status filters ARE the guard here, so the query is recorded: a fake
        // that only returns a row cannot tell whether the guard was asked for.
        findFirst: async (args: any) => {
          membershipQueries.push(args);
          // Two shapes, two questions: the package-change owner check asks for a ROLE; the
          // profile-guard and support-asker lookups ask only "any shop this person is still in".
          if (args?.where?.roles) return options.ownerMembership ?? null;
          return options.memberships?.[0] ?? options.ownerMembership ?? null;
        },
        findMany: async (args: any) => { membershipQueries.push(args); return options.memberships ?? []; },
      },
      companyPlanTerm: { findUnique: async () => null },
      lineWebhookEventLog: {
        // No prior row: the claim takes the "create it" branch, which is the live path for a
        // greeting or a button the buffer forwarded straight through.
        findUnique: async () => null,
        create: async () => ({}),
        // `updateEventLog` writes through updateMany; the claim's CAS uses it too, so the recorded
        // list starts at the claim and the OUTCOME is the last entry.
        updateMany: async (args: any) => { eventLog.push(args); return { count: 1 }; },
        update: async (args: any) => { eventLog.push(args); return {}; },
        upsert: async () => ({}),
      },
    },
  } as any;

  const useCase = new ProcessLineWebhookUseCase(
    prisma,
    {
      lineLiffId: 'liffId' in options ? options.liffId : '1234567890-abcdef',
      lineMessagingChannelId: 'channelId' in options ? options.channelId : 'msg-channel-1',
      lineSignupBusinessDays: 'MON-SAT',
      lineSignupBusinessHours: '09:00-18:00',
      webBaseUrl: 'https://app.example.test',
      sesWebBaseUrl: 'https://app.example.test',
    } as any,
    {} as any,
    { log: async (entry: any) => { audits.push(entry); } } as any,
    {} as any,
    {
      buildTextMessage: (text: string, quickReply?: unknown) => ({ type: 'text', text, ...(quickReply ? { quickReply } : {}) }),
      sendReply: async (_token: string, messages: any[]) => { replies.push(messages); return 'ok'; },
      sendPush: async () => 'ok',
    } as any,
    {} as any, {} as any, {} as any,
    { startSweep: () => ({ end: () => {} }) } as any,
    {} as any,
    // Everything from here is @Optional(). Seventeen slots (initReceiptUpload … handoffLinks) come
    // before the two P10-L collaborators, which the constructor deliberately keeps last.
    ...Array.from({ length: 17 }, () => undefined),
    { create: async (cmd: any) => { packageChanges.push(cmd); return { id: 'pcr-1' }; } } as any,
    { enqueueSupportRequest: async (supportRequestId: string) => { supportNotices.push(supportRequestId); } } as any,
    (options.rateLimit ?? {
      consumeLineSupportRequestSlot: async (lineUserId: string) => {
        supportSlots.push(lineUserId);
        return options.supportSlot ?? true;
      },
    }) as any,
  );

  // The use case builds its own Logger; capture what it writes at ERROR.
  (useCase as any).logger = { error: (entry: any) => errors.push(entry), warn: () => {}, log: () => {} };
  return {
    useCase, replies, eventLog, audits, packageChanges, supportNotices, contextUpdates, contextUpserts,
    supportRequests, supportClosures, supportLookups, supportUpdates, supportSlots, membershipQueries, errors,
  };
}

const event = (text: string) => ({
  webhookEventId: `evt-${text}`,
  replyToken: 'reply-1',
  lineUserId: 'Uline-1',
  messageText: text,
  messagingChannelId: 'msg-channel-1',
}) as any;

const rendered = (h: Harness) => JSON.stringify(h.replies);
/** The status this turn settled on — the last write, after the claim's own CAS. */
const outcome = (h: Harness) => h.eventLog.at(-1)!.data.status;

describe('P10-L webhook doors', () => {
  it('answers a follow with the three doors when nothing is pending', async () => {
    const h = harness({ pendingSignup: null });
    await h.useCase.execute(event(LINE_FOLLOW_EVENT_TEXT));

    assert.match(rendered(h), /เปิดร้านใหม่ ทดลองฟรี/);
    assert.equal(outcome(h), 'line_follow');
    // L-B follow-up (c): adding the OA is the INVITED first step of this flow. Recording it DENIED
    // put every prospect into a security signal whose whole value is that it is rare.
    const denied = h.audits.filter((entry: any) => entry.result === 'DENIED');
    assert.deepEqual(denied, [], 'a friend-add is not a denied access attempt');
    const entry = h.audits.find((row: any) => row.action === 'ai.line.unlinked_access');
    assert.equal(entry.result, 'SUCCESS');
    assert.equal(entry.metadataJson.entry, 'follow');
    assert.equal(entry.metadataJson.lineUserId, '[REDACTED]');
    assert.equal(h.eventLog.at(-1)!.data.errorCode, undefined, 'and it is not an error outcome');
  });

  it('still records a DENIED attempt when an unlinked stranger MESSAGES the OA', async () => {
    const h = harness({ pendingSignup: null });
    await h.useCase.execute(event('สวัสดีครับ'));

    assert.equal(outcome(h), 'unlinked');
    const entry = h.audits.find((row: any) => row.action === 'ai.line.unlinked_access');
    assert.equal(entry.result, 'DENIED', 'reaching for the assistant without an account still is');
  });

  it('answers a follow with the status card while an application is travelling', async () => {
    const h = harness({ pendingSignup: { companyName: 'ร้านนิด' } });
    await h.useCase.execute(event(LINE_FOLLOW_EVENT_TEXT));

    assert.match(rendered(h), /ได้รับคำขอแล้ว/, 'the bubble title');
    assert.match(rendered(h), /คำขอเปิดร้าน ร้านนิด เข้าระบบแล้วค่ะ/, 'the body names the shop without repeating the title');
    assert.equal(rendered(h).includes('เปิดร้านใหม่ ทดลองฟรี'), false, 'never invite a second application');
  });

  // L-17: a customer who already has a shop and re-adds the OA is not a prospect. The three doors
  // would read as though the system had forgotten them — and door one invites a duplicate signup.
  it('welcomes back a LINE account it already knows, instead of offering to open a shop', async () => {
    const h = harness({
      identity: { userId: 'user-1', user: { status: 'ACTIVE', aiAssistantOptOutAt: null, displayName: 'นิด' } },
    });
    await h.useCase.execute(event(LINE_FOLLOW_EVENT_TEXT));

    assert.match(rendered(h), /ยินดีต้อนรับกลับมา/);
    assert.equal(rendered(h).includes('เปิดร้านใหม่ ทดลองฟรี'), false, 'never invite a second shop');
    assert.match(rendered(h), /ติดต่อเจ้าหน้าที่/, 'the way to a person still travels with it');
    assert.equal(outcome(h), 'line_follow_known');
  });

  // L-19. A LINE user id only means anything WITHIN one messaging channel. An absent Prisma filter
  // matches every row, so an unset channel id would let one OA's application decide another's card.
  it('fails closed on an unconfigured channel rather than matching any application', async () => {
    const h = harness({ pendingSignup: { companyName: 'ร้านของคนอื่น' }, channelId: undefined });
    await h.useCase.execute(event(LINE_FOLLOW_EVENT_TEXT));

    assert.match(rendered(h), /เปิดร้านใหม่ ทดลองฟรี/, 'the doors, never a stranger\'s status');
    assert.equal(rendered(h).includes('ร้านของคนอื่น'), false);
  });

  // Residual: an unusable LIFF id costs the card two of its three doors. That must be visible in the
  // logs rather than a card that quietly stopped offering signup.
  it('says so at ERROR when the LIFF id is unusable, and still sends the doors that work', async () => {
    const h = harness({ pendingSignup: null, liffId: 'not-a-liff-id' });
    await h.useCase.execute(event(LINE_FOLLOW_EVENT_TEXT));

    assert.equal(h.errors.filter((entry) => entry.msg === 'line.signup.liff_id_unusable').length, 1);
    assert.equal(rendered(h).includes('liff.line.me'), false);
    assert.match(rendered(h), /ฉันเป็นพนักงาน/, 'the doors that need no LIFF id still work');
    assert.match(rendered(h), /ติดต่อเจ้าหน้าที่/);
  });

  it('answers an unlinked message with the same door card, not a dead-end line', async () => {
    const h = harness({ identity: null, pendingSignup: null });
    await h.useCase.execute(event('สวัสดี'));

    assert.match(rendered(h), /เปิดร้านใหม่ ทดลองฟรี/);
    assert.equal(rendered(h).includes('กรุณาเชื่อมต่อบัญชี'), false);
    assert.equal(outcome(h), 'unlinked');
  });

  it('sends the staff door to the owner-issued link, never a self-serve signup', async () => {
    const h = harness();
    await h.useCase.execute(event(EMPLOYEE_DOOR_COMMAND));

    assert.match(rendered(h), /ให้เจ้าของร้านเปิดเมนู/);
    assert.match(rendered(h), /ไม่ต้องสมัครร้านใหม่/);
    assert.equal(outcome(h), 'line_employee_door');
  });
});

describe('P10-L contact-staff pause (§8), rewritten by line-support-request-spec-th §2.1', () => {
  const linked = { userId: 'user-1', user: { status: 'ACTIVE', aiAssistantOptOutAt: null, displayName: 'นิด' } };

  it('opens a request against the shop the asker is in NOW, and pauses the assistant', async () => {
    const h = harness({
      identity: linked,
      memberships: [{ companyId: 'co-now', roles: [] }],
      // E2: the context row still points at a shop this person unlinked from on 2026-09-02.
      context: { companyId: 'co-stale', aiPausedUntil: null },
      lastTurn: { userMessagePreview: 'ส่งใบเสร็จแล้วไม่เห็นขึ้นเลยค่ะ' },
    });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.match(rendered(h), /รับเรื่องแล้วค่ะ/);
    assert.match(rendered(h), /098-256-5628/, 'and the number for someone in a hurry');
    assert.match(rendered(h), /คุยกับ AI ต่อ/, 'and the way back out of the pause');
    assert.equal(h.supportRequests[0].data.companyId, 'co-now', 'membership decides, not the stale row');
    assert.equal(h.supportRequests[0].data.lastMessageText, 'ส่งใบเสร็จแล้วไม่เห็นขึ้นเลยค่ะ');
    assert.match(h.supportRequests[0].data.lineUserIdHash, /^[0-9a-f]{16}$/);
    assert.deepEqual(h.supportNotices, ['sr-1'], 'the notice names the request, not a shop and a day');

    const pausedUntil = h.contextUpserts[0].update.aiPausedUntil as Date;
    const hours = (pausedUntil.getTime() - Date.now()) / 3_600_000;
    assert.ok(hours > 23.9 && hours <= 24, `pause is 24h, got ${hours}`);
  });

  // The worst outcome this flow can produce: telling a stranger "รับเรื่องแล้ว" and telling nobody.
  it('files an unlinked asker against their pending application, and pauses nothing', async () => {
    const h = harness({
      identity: null,
      context: { companyId: 'co-stale', aiPausedUntil: null },
      pendingSignup: { id: 'sr-signup-1', companyName: 'The sun coffee' },
    });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.match(rendered(h), /รับเรื่องแล้วค่ะ/);
    assert.equal(h.supportRequests[0].data.companyId, undefined, 'no membership, no shop');
    assert.equal(h.supportRequests[0].data.signupRequestId, 'sr-signup-1', 'the queue link instead');
    assert.deepEqual(h.contextUpserts, [], 'nobody to pause: they are talking to the door card');
    assert.deepEqual(h.supportNotices, ['sr-1']);
  });

  it('files an unlinked asker with no application at all rather than dropping them', async () => {
    const h = harness({ identity: null, context: null, pendingSignup: null });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.equal(h.supportRequests.length, 1);
    assert.equal(h.supportRequests[0].data.signupRequestId, undefined);
    assert.deepEqual(h.supportNotices, ['sr-1']);
  });

  // §2.2.4. Dedupe is per OPEN request, not per day: yesterday's answered request must never be
  // the reason today's customer reaches nobody.
  it('answers a repeat tap with "still in the queue" and pages nobody twice', async () => {
    const h = harness({
      identity: linked,
      memberships: [{ companyId: 'co-now', roles: [] }],
      context: { companyId: 'co-now', aiPausedUntil: new Date(Date.now() + 3_600_000) },
      openSupportRequest: { id: 'sr-open' },
    });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.match(rendered(h), /ยังอยู่ในคิว/, 'the customer is still answered');
    assert.deepEqual(h.supportRequests, [], 'and no second request is opened');
    assert.deepEqual(h.supportNotices, []);
    assert.ok(h.contextUpserts[0].update.aiPausedUntil, 'the pause is extended, not left to lapse');
    assert.equal(outcome(h), 'support_already_open');
  });

  // §2.4. The other half of the complaint: a 24h pause with no way out.
  it('lets the customer bring the assistant back, and closes their request with it', async () => {
    const h = harness({ identity: linked, context: { companyId: 'co-now', aiPausedUntil: new Date(Date.now() + 3_600_000) } });
    await h.useCase.execute(event(RESUME_AI_COMMAND));

    assert.match(rendered(h), /น้องมั่งมีกลับมาแล้ว/);
    assert.deepEqual(h.contextUpdates[0].data, { aiPausedUntil: null });
    assert.equal(h.supportClosures[0].data.closedReason, 'customer_resumed');
    assert.equal(h.supportClosures[0].where.status, 'OPEN');
    assert.equal(outcome(h), 'support_resumed');
  });

  it('answers the resume command the same way with no pause and no account', async () => {
    const h = harness({ identity: null, context: null });
    await h.useCase.execute(event('ให้ AI ตอบ'));

    assert.match(rendered(h), /น้องมั่งมีกลับมาแล้ว/, 'a promise must not depend on state nobody can see');
    assert.equal(outcome(h), 'support_resumed');
  });

  // Closing a request frees the dedupe above, so tap → "คุยกับ AI ต่อ" → tap, repeated, was an
  // unbounded source of rows, letters and pushes from one unauthenticated LINE account.
  it('stops opening new requests after three in a day, warmly and without writing anything', async () => {
    const h = harness({ identity: linked, memberships: [{ companyId: 'co-now', roles: [] }], supportSlot: false });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.deepEqual(h.supportSlots, ['Uline-1'], 'the floor is keyed on the LINE account');
    assert.deepEqual(h.supportRequests, [], 'no fourth row');
    assert.deepEqual(h.supportNotices, [], 'and nobody is paged for it');
    assert.match(rendered(h), /รับเรื่องไว้แล้วค่ะ/, 'and the customer is answered warmly, not refused');
    assert.equal(rendered(h).includes('Too many'), false);
    assert.equal(outcome(h), 'support_rate_limited');
    assert.equal(h.audits.at(-1).result, 'DENIED');
  });

  // The floor is charged where a row is CREATED, so a repeat tap on an open request — which costs
  // nothing — must never be the thing that spends the last slot.
  it('never spends a slot on a repeat tap of an already-open request', async () => {
    const h = harness({
      identity: linked,
      memberships: [{ companyId: 'co-now', roles: [] }],
      openSupportRequest: { id: 'sr-open' },
      supportSlot: false,
    });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.deepEqual(h.supportSlots, [], 'the floor was never consulted');
    assert.match(rendered(h), /ยังอยู่ในคิว/);
  });

  /**
   * The floor's own failure mode, end to end with the REAL rate limiter over a store that cannot
   * answer under production semantics. `fail-closed` here would throw out of `handleStaffContact`
   * — no row, no notice, no reply, on an event already claimed and so never redelivered — which is
   * exactly the E1 silence this branch exists to remove.
   */
  it('still opens the request when Redis is down in production, instead of going silent', async () => {
    const store = new RedisRateLimitService({ redisUrl: 'redis://unused', isProduction: true } as never);
    const down = async () => { throw new Error('redis down'); };
    (store as unknown as { client: unknown }).client = { eval: down, get: down, ttl: down };
    const h = harness({
      identity: linked,
      memberships: [{ companyId: 'co-now', roles: [] }],
      rateLimit: new AuthRateLimitService({} as never, store),
    });

    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.equal(h.supportRequests.length, 1, 'the row a human is answered from exists');
    assert.deepEqual(h.supportNotices, ['sr-1'], 'and somebody is paged');
    assert.match(rendered(h), /รับเรื่องแล้วค่ะ/, 'and the customer is answered');
    assert.equal(outcome(h), 'support_requested');
  });

  // A refused fourth tap opens nothing and pages nobody, so silencing the assistant for 24 hours
  // on the strength of it is the worst of both.
  it('does not re-arm the 24h pause on a tap the floor refused', async () => {
    const h = harness({ identity: linked, memberships: [{ companyId: 'co-now', roles: [] }], supportSlot: false });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.deepEqual(h.contextUpserts, [], 'no request to answer means no assistant to silence');
    assert.equal(outcome(h), 'support_rate_limited');
  });

  // M7 (reviewer probe): a membership in a company the plan-term sweep DISABLED is not a shop this
  // person can be helped in, so the request carries no company — and nothing may pause an
  // assistant that has no company to run for.
  it('files a DISABLED-company member as having no shop, and creates no context row', async () => {
    const h = harness({ identity: linked, memberships: [], context: null, pendingSignup: null });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.equal(h.supportRequests[0].data.companyId, undefined);
    assert.deepEqual(h.contextUpserts, [], 'no company, no pause, no row invented for one');
    assert.deepEqual(h.supportNotices, ['sr-1'], 'they still reach a human');
  });

  it('holds the assistant back while the pause runs, and lets go once it expires', async () => {
    const paused = harness({ identity: linked, context: { companyId: 'co-1', aiPausedUntil: new Date(Date.now() + 3_600_000) } });
    await paused.useCase.execute(event('ยอดขายวันนี้'));
    assert.match(rendered(paused), /ทีมงานรับเรื่องแล้ว/);
    assert.equal(outcome(paused), 'support_paused');

    // Self-expiring: a stamp in the past is the same as no stamp, with nothing to clean up.
    const expired = harness({ identity: linked, context: { companyId: 'co-1', aiPausedUntil: new Date(Date.now() - 1) } });
    await expired.useCase.execute(event(STAFF_CONTACT_COMMAND));
    assert.equal(outcome(expired), 'support_requested', 'the turn ran normally again');
  });

  /**
   * The pause is about the ASSISTANT, not about the buttons we put in front of the customer. It was
   * swallowing the explicit commands too: a paused owner who asked to change package got only "we
   * are looking into it" and NO request was created — for 24 hours, on the one action an expired
   * shop is in the chat to take.
   */
  it('still opens a package-change request while a human is handling the thread', async () => {
    const identity = { userId: 'user-1', user: { status: 'ACTIVE', aiAssistantOptOutAt: null, displayName: 'นิด' } };
    const paused = harness({
      identity,
      ownerMembership: { companyId: 'co-1', company: { planTerm: { tierKey: 'FREE_TRIAL_15' } } },
      context: { companyId: 'co-1', aiPausedUntil: new Date(Date.now() + 3_600_000) },
    });
    await paused.useCase.execute(event(PACKAGE_CHANGE_COMMAND));

    assert.equal(paused.packageChanges.length, 1, 'the request an operator has to act on exists');
    assert.match(rendered(paused), /รับคำขอแล้ว/);
    assert.equal(rendered(paused).includes('ทีมงานรับเรื่องแล้ว'), false, 'not the paused reply');
  });

  it('still keeps free text paused, which is what the pause is for', async () => {
    const identity = { userId: 'user-1', user: { status: 'ACTIVE', aiAssistantOptOutAt: null, displayName: 'นิด' } };
    const paused = harness({
      identity,
      context: { companyId: 'co-1', aiPausedUntil: new Date(Date.now() + 3_600_000) },
    });
    await paused.useCase.execute(event('ยอดขายวันนี้เท่าไหร่'));

    assert.match(rendered(paused), /ทีมงานรับเรื่องแล้ว/);
    assert.equal(outcome(paused), 'support_paused');
    assert.deepEqual(paused.packageChanges, []);
  });
});

/**
 * UAT 2026-09-06: "เจ้าหน้าที่ตอบกลับแล้วคำขอหายไปเลย ทั้งที่ยังไม่จบ".
 *
 * "ตอบแล้ว" moved the row to ANSWERED, which is off the รอตอบ tab and out of the header badge —
 * and NOTHING could put it back, because the pause gate answered every later customer message with
 * a canned line and never touched `LineSupportRequest`. The customer kept typing into a thread no
 * operator surface could see, while being told a human was reading it.
 */
describe('a customer who writes back is still in the queue (UAT 2026-09-06)', () => {
  const linked = { userId: 'user-1', user: { status: 'ACTIVE', aiAssistantOptOutAt: null, displayName: 'นิด' } };
  const pausedContext = { companyId: 'co-1', aiPausedUntil: new Date(Date.now() + 3_600_000) };
  const mediaEvent = () => ({
    webhookEventId: 'evt-photo', replyToken: 'reply-1', lineUserId: 'Uline-1',
    lineMessageId: 'msg-1', messageType: 'image', messagingChannelId: 'msg-channel-1',
  }) as any;

  it('reopens an ANSWERED request and stops promising what it does not do', async () => {
    const h = harness({
      identity: linked,
      context: pausedContext,
      openSupportRequest: { id: 'sr-9', status: 'ANSWERED', companyId: 'co-1' },
    });
    await h.useCase.execute(event('ยังไม่ได้เลยค่ะ ลองแล้วไม่ขึ้น'));

    const [update] = h.supportUpdates;
    assert.ok(update, 'the message an operator has to read must land on the request');
    assert.equal(update.where.id, 'sr-9');
    assert.equal(update.data.status, 'OPEN', 'back onto the รอตอบ tab, and back into the badge');
    assert.equal(update.data.lastMessageText, 'ยังไม่ได้เลยค่ะ ลองแล้วไม่ขึ้น');
    assert.ok(update.data.lastMessageAt instanceof Date, 'the waiting clock restarts from this');
    assert.deepEqual(update.data.reopenedCount, { increment: 1 });
    // The answer is history, not a lie to erase: the inbox says "ตอบแล้ว 1 ครั้ง · ลูกค้าตอบกลับ".
    assert.equal(update.data.answeredAt, undefined);
    assert.equal(update.data.answeredByUserId, undefined);

    assert.match(rendered(h), /ส่งข้อความถึงทีมงานแล้ว/);
    assert.equal(rendered(h).includes('กำลังดูให้อยู่'), false, 'not the reply that swallowed it');
    assert.equal(rendered(h).includes('+'), false, 'no plus sign anywhere a customer reads');
    assert.equal(outcome(h), 'support_paused');
  });

  it('records the fact, never the words, and never the LINE id (§3)', async () => {
    const h = harness({
      identity: linked,
      context: pausedContext,
      openSupportRequest: { id: 'sr-9', status: 'ANSWERED', companyId: 'co-1' },
    });
    await h.useCase.execute(event('เลขบัญชี 1234567890 ค่ะ'));

    const entry = h.audits.find((row: any) => row.action === 'signup.line.support_follow_up');
    assert.ok(entry, 'somebody wrote to a waiting request, and that is an auditable fact');
    assert.equal(entry.targetType, 'line_support_request');
    assert.equal(entry.targetId, 'sr-9');
    assert.equal(entry.companyId, 'co-1');
    assert.equal(entry.result, 'SUCCESS');
    assert.deepEqual(entry.metadataJson, { reopened: true, hasText: true });
    const written = JSON.stringify(entry);
    assert.equal(written.includes('Uline-1'), false, 'no LINE id in the audit rail');
    assert.equal(written.includes('1234567890'), false, 'and never the message itself');
  });

  it('appends to a request that never left รอตอบ without counting a reopen', async () => {
    const h = harness({
      identity: linked, context: pausedContext,
      openSupportRequest: { id: 'sr-9', status: 'OPEN', companyId: 'co-1' },
    });
    await h.useCase.execute(event('มีอัปเดตไหมคะ'));

    const [update] = h.supportUpdates;
    assert.equal(update.data.lastMessageText, 'มีอัปเดตไหมคะ');
    assert.equal(update.data.status, undefined, 'it was never off the tab');
    assert.equal(update.data.reopenedCount, undefined, 'and nobody answered it to reopen');
    assert.equal(h.audits.find((row: any) => row.action === 'signup.line.support_follow_up').metadataJson.reopened, false);
  });

  // CLOSED is settled: a fresh "ติดต่อเจ้าหน้าที่" opens a new request (§2.2.4), and a stray
  // message must not resurrect a matter both sides finished with.
  it('asks only for a request that is still live, for this person in any shop', async () => {
    const h = harness({
      identity: linked, context: pausedContext,
      openSupportRequest: { id: 'sr-9', status: 'OPEN', companyId: 'co-1' },
    });
    await h.useCase.execute(event('สวัสดีค่ะ'));

    const lookup = h.supportLookups.at(-1);
    assert.deepEqual(lookup.where.status, { in: ['OPEN', 'ANSWERED'] });
    assert.equal(lookup.where.lineUserId, 'Uline-1');
    assert.equal(lookup.where.companyId, undefined, 'one person, whatever shop the request names');
  });

  it('keeps the old reply when there is no request to append to', async () => {
    const h = harness({ identity: linked, context: pausedContext, openSupportRequest: null });
    await h.useCase.execute(event('ยอดขายวันนี้'));

    assert.deepEqual(h.supportUpdates, [], 'nothing to write to');
    assert.match(rendered(h), /กำลังดูให้อยู่/, 'and the customer keeps the answer they had');
    assert.equal(outcome(h), 'support_paused');
  });

  // Bookkeeping beside the turn, never in front of it: the fallback is the old reply, not silence
  // on an event that has already been claimed and so is never redelivered.
  it('still answers the customer when the request cannot be written to', async () => {
    const h = harness({
      identity: linked, context: pausedContext,
      openSupportRequest: { id: 'sr-9', status: 'OPEN', companyId: 'co-1' },
    });
    (h.useCase as any).prisma.client.lineSupportRequest.updateMany = async () => { throw new Error('deadlock'); };

    await h.useCase.execute(event('มีอัปเดตไหมคะ'));

    assert.match(rendered(h), /กำลังดูให้อยู่/, 'the old reply, which promises nothing we did not do');
    assert.equal(rendered(h).includes('ส่งข้อความถึงทีมงานแล้ว'), false, 'and never a promise we broke');
    assert.equal(outcome(h), 'support_paused');
  });

  it('never loses a receipt turn because the support table could not be written', async () => {
    const h = harness({
      identity: linked, memberships: [],
      openSupportRequest: { id: 'sr-9', status: 'OPEN', companyId: 'co-1' },
    });
    (h.useCase as any).prisma.client.lineSupportRequest.findFirst = async () => { throw new Error('down'); };

    await h.useCase.executeReceiptUpload(mediaEvent());

    // The media turn ran its own course (no company resolves here) rather than being swallowed by
    // the outer catch, which would have answered "ประมวลผลรูปนี้ไม่สำเร็จ" and released the event.
    assert.equal(outcome(h), 'unlinked');
    assert.equal(rendered(h).includes('ประมวลผลรูปนี้ไม่สำเร็จ'), false);
  });

  /**
   * The photo lane has no pause gate of its own, so a customer answering a human WITH A PICTURE was
   * the one message that reached nobody at all — here it is refused as a receipt (no company
   * resolves) and still lands on the request, because those are two different questions.
   *
   * Review 2026-09-06 (F3, then N1): it lands as a MARKER and nothing else. F3 stopped it
   * overwriting `lastMessageText`; N1 stopped it counting as the customer asking again. The
   * commonest photo on a live thread is an ordinary receipt with nothing to do with the request, so
   * treating it as a follow-up reopened settled threads, restarted the waiting clock and re-armed
   * the 24 h mute — a shop that uploads one receipt a day never got its assistant back.
   */
  it('marks a photo on an ANSWERED request without reopening it or moving its clocks', async () => {
    const h = harness({
      identity: linked, memberships: [],
      openSupportRequest: { id: 'sr-9', status: 'ANSWERED', companyId: 'co-1' },
    });
    await h.useCase.executeReceiptUpload(mediaEvent());

    const [update] = h.supportUpdates;
    assert.ok(update, 'a photo is still a fact worth showing beside the thread');
    assert.deepEqual(update.where, { id: 'sr-9', status: 'ANSWERED' });
    assert.ok(update.data.lastMediaAt instanceof Date, 'the operator learns a photo arrived');
    assert.deepEqual(Object.keys(update.data), ['lastMediaAt'],
      'and that is the WHOLE write: no reopen, no reopenedCount, no lastMessageAt, no words');
    assert.equal(JSON.stringify(update.data).includes('msg-1'), false, 'nothing about the bytes');
    assert.equal(h.audits.some((row: any) => row.action === 'signup.line.support_follow_up'), false,
      'nobody wrote a sentence, so nothing is audited as though they had');
    assert.deepEqual(h.contextUpserts, [], 'and a receipt never re-arms the 24h mute');
    assert.deepEqual(h.contextUpdates, []);
  });

  // The same lane carries PDFs. One marker covers both: the inbox says a picture arrived, and an
  // operator opening the chat sees which — spending a column on the distinction buys nothing.
  it('marks a document on a live OPEN request the same way, and moves nothing else', async () => {
    const h = harness({
      identity: linked, memberships: [],
      openSupportRequest: { id: 'sr-9', status: 'OPEN', companyId: 'co-1' },
    });
    await h.useCase.executeReceiptUpload({ ...mediaEvent(), messageType: 'file', fileName: 'bill.pdf' });

    const [update] = h.supportUpdates;
    assert.deepEqual(update.where, { id: 'sr-9', status: 'OPEN' });
    assert.ok(update.data.lastMediaAt instanceof Date);
    assert.deepEqual(Object.keys(update.data), ['lastMediaAt'], 'the waiting clock is the customer\'s words');
    assert.equal(JSON.stringify(update.data).includes('bill.pdf'), false, 'never the file name');
    assert.deepEqual(h.contextUpserts, [], 'and the mute keeps whatever end it already had');
    assert.deepEqual(h.contextUpdates, []);
  });

  /**
   * Review 2026-09-06 (F2). `findFirst` then `update` is read-then-write: an operator pressing
   * "ตอบแล้ว" in the gap left the row ANSWERED while the customer was told their message had been
   * delivered to a queue it was no longer in. The write now carries the status it read as its own
   * precondition, and a `count` of 0 means nothing was recorded.
   */
  it('does not promise delivery when "ตอบแล้ว" won the race', async () => {
    const h = harness({
      identity: linked, context: pausedContext,
      openSupportRequest: { id: 'sr-9', status: 'ANSWERED', companyId: 'co-1' },
      followUpUpdateCount: 0,
    });
    await h.useCase.execute(event('ยังไม่ได้เลยค่ะ'));

    assert.deepEqual(h.supportUpdates[0].where, { id: 'sr-9', status: 'ANSWERED' },
      'the status it read is the precondition it writes under');
    assert.match(rendered(h), /กำลังดูให้อยู่/, 'the old reply, which promises nothing we did not do');
    assert.equal(rendered(h).includes('ส่งข้อความถึงทีมงานแล้ว'), false);
    assert.equal(h.audits.some((row: any) => row.action === 'signup.line.support_follow_up'), false,
      'and nothing was recorded, so nothing is audited as recorded');
  });

  it('guards the plain append with OPEN, so a close in the gap cannot be written over', async () => {
    const h = harness({
      identity: linked, context: pausedContext,
      openSupportRequest: { id: 'sr-9', status: 'OPEN', companyId: 'co-1' },
    });
    await h.useCase.execute(event('มีอัปเดตไหมคะ'));

    assert.deepEqual(h.supportUpdates[0].where, { id: 'sr-9', status: 'OPEN' });
  });

  /**
   * Review 2026-09-06 (F1). The sweep closes a request 24 h after its last customer message, so a
   * follow-up that did not move the pause left the assistant free to talk over a human — and the
   * row expired on a clock the customer had already reset. One rule, both places.
   */
  it('re-arms the 24h pause from the message it just recorded, and only ever extends one', async () => {
    const h = harness({
      identity: linked, context: pausedContext,
      openSupportRequest: { id: 'sr-9', status: 'ANSWERED', companyId: 'co-1' },
    });
    await h.useCase.execute(event('ยังไม่ได้เลยค่ะ'));

    assert.deepEqual(h.contextUpserts, [], 'a follow-up extends a pause; it never opens one');
    const [update] = h.contextUpdates;
    assert.ok(update, 'a customer who just wrote is not somebody the assistant may interrupt');
    assert.deepEqual(update.where, { lineUserId: 'Uline-1', aiPausedUntil: { not: null } });
    const hours = (update.data.aiPausedUntil.getTime() - Date.now()) / 3_600_000;
    assert.ok(hours > 23.9 && hours <= 24, `24h from the follow-up, got ${hours}`);
  });

  it('leaves an unlinked asker unpaused, because there is no assistant to silence (§2.1.2)', async () => {
    const h = harness({
      identity: linked, context: pausedContext,
      openSupportRequest: { id: 'sr-9', status: 'OPEN', companyId: null },
    });
    await h.useCase.execute(event('มีอัปเดตไหมคะ'));

    assert.deepEqual(h.contextUpserts, [], 'no shop, no context row to create out of nothing');
    assert.equal(h.supportUpdates.length, 1, 'their message is still recorded');
  });

  /**
   * Review 2026-09-06 (N2). The re-arm was an `upsert` whose CREATE branch used the `companyId` the
   * request happened to remember, with no identity or membership check anywhere near it — and §2.5
   * DELETES `LineCompanyContext` on unlink. So an ex-member's follow-up rebuilt the row pointing at
   * the shop they had left. Extend only; the tap's own `pauseAssistant`, which asks about
   * membership first, stays the one thing allowed to create it.
   */
  it('never rebuilds a context row that an unlink deleted', async () => {
    const h = harness({
      identity: null, context: null,
      openSupportRequest: { id: 'sr-9', status: 'OPEN', companyId: 'co-left' },
    });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.deepEqual(h.contextUpserts, [], 'no membership, no row — not even the one the request names');
    assert.equal(h.supportUpdates.length, 1, 'their tap still reaches the operator inbox');
    assert.deepEqual(h.contextUpdates[0].where, { lineUserId: 'Uline-1', aiPausedUntil: { not: null } },
      'the write can only ever touch a pause that is already running');
  });

  /**
   * §3 PDPA bounds the operator's line of context at 200 characters. Pinned as its own case
   * because the bound is one `.slice` — removing it stores whatever LINE accepted (up to 5000)
   * and quietly widens what a settled row keeps about a customer.
   */
  it('stores at most 200 characters of a long follow-up', async () => {
    const h = harness({
      identity: linked, context: pausedContext,
      openSupportRequest: { id: 'sr-9', status: 'OPEN', companyId: 'co-1' },
    });
    await h.useCase.execute(event('ก'.repeat(400)));

    assert.equal(h.supportUpdates[0].data.lastMessageText.length, 200);
  });
});

/**
 * UAT 2026-09-06, 15:42 ICT (build f2bd38ed). Four screenshots of one chat under a pause set at
 * 10:58: `/companies` answered "ส่งข้อความถึงทีมงานแล้ว", the rich-menu tile answered the ordinary
 * welcome — contradicting the hold it was sitting under — and the resume command the reply itself
 * advertises did nothing because the phone keyboard wrote "ai". Spec §2.2 delta รอบ 6.
 */
describe('the pause silences the assistant, not the app (UAT 2026-09-06 รอบ 6)', () => {
  const linked = { userId: 'user-1', user: { status: 'ACTIVE', aiAssistantOptOutAt: null, displayName: 'นิด' } };
  const pausedContext = { companyId: 'co-1', aiPausedUntil: new Date(Date.now() + 3_600_000) };
  const waiting = { id: 'sr-9', status: 'OPEN', companyId: 'co-1' };

  // A deterministic command costs no model call and answers a button we put in front of the
  // customer. Swallowing it filed a button press as a sentence for an operator to read, and gave
  // back a confirmation nobody asked for instead of the card.
  it('answers /companies under the pause instead of filing it as a follow-up', async () => {
    const h = harness({
      identity: linked, context: pausedContext, openSupportRequest: waiting,
      memberships: [{ companyId: 'co-1', roles: [], company: { name: 'ร้านนิด' } }],
    });
    await h.useCase.execute(event('/companies'));

    assert.match(rendered(h), /ร้านนิด/, 'the company card, which needs neither a model nor an operator');
    assert.equal(rendered(h).includes('ส่งข้อความถึงทีมงานแล้ว'), false, 'and no confirmation on top of it');
    assert.deepEqual(h.supportUpdates, [], 'pressing a button is not the customer asking again');
    assert.equal(outcome(h), 'company_context_listed');
  });

  // The rich-menu tile literally says "คุยกับน้องมั่งมี", so the greeting was the honest reply to
  // it — and a flat contradiction of the line the same chat had just been sent.
  it('keeps the rich-menu greeting out of a thread a human is holding', async () => {
    const h = harness({ identity: linked, context: pausedContext, openSupportRequest: waiting });
    await h.useCase.execute(event('คุยกับน้องมั่งมี'));

    assert.equal(rendered(h).includes('น้องมั่งมีมาแล้ว'), false, 'the welcome contradicted the pause');
    assert.match(rendered(h), /กำลังดูให้อยู่/);
    assert.match(rendered(h), /คุยกับ AI ต่อ/, 'and it still says the way out');
    assert.deepEqual(h.supportUpdates, [], 'a tile tap is not a message to the team');
    assert.equal(outcome(h), 'support_paused');
  });

  it('brings the assistant back on the lowercase spelling its own reply advertises', async () => {
    const h = harness({ identity: linked, context: pausedContext, openSupportRequest: waiting });
    await h.useCase.execute(event('คุยกับ ai ต่อ'));

    assert.match(rendered(h), /น้องมั่งมีกลับมาแล้ว/);
    assert.deepEqual(h.contextUpdates[0].data, { aiPausedUntil: null }, 'the hold is lifted');
    assert.equal(h.supportClosures[0].data.closedReason, 'customer_resumed');
    assert.equal(h.supportClosures[0].where.status, 'OPEN', 'and the inbox stops showing รอตอบ');
    assert.deepEqual(h.supportUpdates, [], 'never filed as one more message to the team');
    assert.equal(outcome(h), 'support_resumed');
  });

  /**
   * The Owner got the same seven-line confirmation, menu hint and all, three times in one screen.
   * The message still goes onto the request every time (that is the fix this rides on); only the
   * SPEECH is rationed, off the stamp the row already carries.
   */
  it('confirms in full once, then acknowledges briefly for ten minutes', async () => {
    const burst = harness({
      identity: linked, context: pausedContext,
      openSupportRequest: { ...waiting, lastMessageAt: new Date(Date.now() - 60_000) },
    });
    await burst.useCase.execute(event('ยังไม่ได้เลยค่ะ'));

    assert.equal(burst.supportUpdates.length, 1, 'still recorded — the operator reads every line');
    assert.match(rendered(burst), /รับข้อความแล้วค่ะ/);
    assert.equal(rendered(burst).includes('ทีมงานจะตอบกลับในแชทนี้'), false, 'said once, not to every line');
    assert.equal(rendered(burst).includes('คุยกับ AI ต่อ'), false, 'and the menu hint least of all');

    const later = harness({
      identity: linked, context: pausedContext,
      openSupportRequest: { ...waiting, lastMessageAt: new Date(Date.now() - 11 * 60_000) },
    });
    await later.useCase.execute(event('ยังไม่ได้เลยค่ะ'));

    assert.match(rendered(later), /ส่งข้อความถึงทีมงานแล้ว/, 'a fresh message gets the full answer');
    assert.equal(later.supportUpdates.length, 1);
  });
});

/**
 * Review 2026-09-06 (F3/F7). Two questions the row now answers separately: what they ASKED, which
 * is the sentence an operator is answering, and what they last WROTE, which is where the thread
 * has got to. Before this, one column held both and the newest message ate the question.
 */
describe('the original question outlives every follow-up (UAT 2026-09-06)', () => {
  const linked = { userId: 'user-1', user: { status: 'ACTIVE', aiAssistantOptOutAt: null, displayName: 'นิด' } };

  it('keeps the tap-time question in its own column', async () => {
    const h = harness({
      identity: linked,
      memberships: [{ companyId: 'co-now', roles: [] }],
      lastTurn: { userMessagePreview: 'ส่งใบเสร็จแล้วไม่เห็นขึ้นเลยค่ะ' },
    });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    const { data } = h.supportRequests[0];
    assert.equal(data.requestText, 'ส่งใบเสร็จแล้วไม่เห็นขึ้นเลยค่ะ', 'the question, never rewritten');
    assert.equal(data.lastMessageText, 'ส่งใบเสร็จแล้วไม่เห็นขึ้นเลยค่ะ', 'and also the newest message, so far');
  });

  /**
   * F7. `handleStaffContact` deduped on OPEN only, so tapping the button while a request was
   * ANSWERED opened a SECOND row — while typing the same thing reopened the first. One path: the
   * tap is a message like any other, and a reopen is not a new request, so it spends no daily slot.
   */
  it('reopens an ANSWERED request on a tap instead of opening a second one', async () => {
    const h = harness({
      identity: linked,
      memberships: [{ companyId: 'co-now', roles: [] }],
      context: { companyId: 'co-now', aiPausedUntil: new Date(Date.now() + 3_600_000) },
      openSupportRequest: { id: 'sr-answered', status: 'ANSWERED', companyId: 'co-now' },
    });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.deepEqual(h.supportRequests, [], 'no second row for the same conversation');
    assert.deepEqual(h.supportSlots, [], 'and a reopen never spends one of the three daily asks');
    const [update] = h.supportUpdates;
    assert.ok(update, 'the tap is what brings it back');
    assert.equal(update.data.status, 'OPEN');
    assert.deepEqual(update.data.reopenedCount, { increment: 1 });
    assert.match(rendered(h), /ยังอยู่ในคิว/);
    assert.equal(outcome(h), 'support_already_open');
    assert.deepEqual(h.supportNotices, [], 'nobody is paged twice for one conversation');
  });

  it('asks for a live request of either status before opening a new one', async () => {
    const h = harness({
      identity: linked,
      memberships: [{ companyId: 'co-now', roles: [] }],
      openSupportRequest: null,
    });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.deepEqual(h.supportLookups[0].where.status, { in: ['OPEN', 'ANSWERED'] });
    assert.equal(h.supportRequests.length, 1, 'nothing live, so this really is a new request');
  });
});

describe('P10-L package change from LINE (§3.7)', () => {
  const identity = { userId: 'user-1', user: { status: 'ACTIVE', aiAssistantOptOutAt: null, displayName: 'นิด' } };

  it('opens a request for an owner and says the team will call back', async () => {
    const h = harness({
      identity,
      ownerMembership: { companyId: 'co-1', company: { planTerm: { tierKey: 'FREE_TRIAL_15' } } },
    });
    await h.useCase.execute(event(PACKAGE_CHANGE_COMMAND));

    assert.equal(h.packageChanges.length, 1);
    assert.equal(h.packageChanges[0].companyId, 'co-1');
    assert.equal(h.packageChanges[0].requestedByUserId, 'user-1');
    // A chat button chose no tier, so the request opens one step up and says so for the operator.
    assert.equal(h.packageChanges[0].requestedTierKey, 'STARTER_249');
    assert.match(h.packageChanges[0].note, /ยังไม่ได้เลือกแพ็กเกจ/);
    assert.match(rendered(h), /รับคำขอแล้วค่ะ/);
    // SEC-04: the shop is found by asking for an OWNER membership, not by trusting the button.
    const where = h.membershipQueries[0].where;
    assert.deepEqual(where.roles, { some: { role: { key: 'OWNER' } } });
    assert.equal(where.status, 'ACTIVE');
  });

  it('works for a shop whose trial already expired — the case the button is printed on', async () => {
    // The expiry message carries this button, and that company is DISABLED. A request that 403s
    // there would make the button decorative.
    const h = harness({
      identity,
      ownerMembership: { companyId: 'co-1', company: { planTerm: { tierKey: 'FREE_TRIAL_15' } } },
    });
    await h.useCase.execute(event(PACKAGE_CHANGE_COMMAND));
    assert.equal(h.packageChanges.length, 1);
    // DISABLED is in the accepted set precisely because an expired trial IS the caller here.
    assert.deepEqual(h.membershipQueries[0].where.company, { status: { in: ['ACTIVE', 'DISABLED'] } });
  });

  it('refuses a non-owner without opening anything', async () => {
    const h = harness({ identity, ownerMembership: null });
    await h.useCase.execute(event(PACKAGE_CHANGE_COMMAND));

    assert.equal(h.packageChanges.length, 0);
    assert.match(rendered(h), /ต้องให้เจ้าของร้านเป็นคนขอ/);
    assert.equal(outcome(h), 'package_change_denied');
  });

  it('never claims a request exists when the collaborator is not wired', async () => {
    const h = harness({ identity, ownerMembership: { companyId: 'co-1', company: { planTerm: null } } });
    (h.useCase as any).packageChange = undefined;
    await h.useCase.execute(event(PACKAGE_CHANGE_COMMAND));

    assert.equal(rendered(h).includes('รับคำขอแล้ว'), false);
    assert.match(rendered(h), /ติดต่อทีมงาน/);
  });
});

describe('P10-L day-7 nudge answers (§3.6)', () => {
  const identity = { userId: 'user-1', user: { status: 'ACTIVE', aiAssistantOptOutAt: null, displayName: 'นิด' } };

  it('sends the settings link on "ใส่เลย"', async () => {
    const h = harness({ identity, ownerMembership: { companyId: 'co-1' } });
    await h.useCase.execute(event(PROFILE_GUARD_COMMAND));

    // The L-E profile page, anchored at the account section: the card asked for an email or a
    // phone, so the tap must land on that field rather than on a dashboard to search from.
    assert.match(rendered(h), /https:\/\/app\.example\.test\/companies\/co-1\/settings\/profile#account/);
    // Inside the tenant root, which is the only shape the handoff mint will accept.
    assert.match(rendered(h), /\/companies\/co-1\//);
    assert.equal(outcome(h), 'profile_guard_accepted');
  });

  it('acknowledges "ไว้ก่อน" and asks nothing further', async () => {
    const h = harness({ identity });
    await h.useCase.execute(event(PROFILE_GUARD_LATER_COMMAND));

    assert.match(rendered(h), /ได้ค่ะ/);
    assert.equal(outcome(h), 'profile_guard_declined');
  });
});
