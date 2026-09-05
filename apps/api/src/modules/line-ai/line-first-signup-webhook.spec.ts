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
  memberships?: Array<{ companyId: string; roles: unknown[] }>;
  context?: { companyId: string; aiPausedUntil: Date | null } | null;
  contextUpdateCount?: number;
  /** An OPEN `LineSupportRequest` for this LINE user, if one is already in the queue (§2.2.4). */
  openSupportRequest?: { id: string } | null;
  /** The last thing this customer typed, as `AiTurn` kept it. */
  lastTurn?: { userMessagePreview: string | null } | null;
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
        findFirst: async () => options.openSupportRequest ?? null,
        create: async (args: any) => { supportRequests.push(args); return { id: 'sr-1' }; },
        updateMany: async (args: any) => { supportClosures.push(args); return { count: 1 }; },
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
  );

  // The use case builds its own Logger; capture what it writes at ERROR.
  (useCase as any).logger = { error: (entry: any) => errors.push(entry), warn: () => {}, log: () => {} };
  return {
    useCase, replies, eventLog, audits, packageChanges, supportNotices, contextUpdates, contextUpserts,
    supportRequests, supportClosures, membershipQueries, errors,
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
