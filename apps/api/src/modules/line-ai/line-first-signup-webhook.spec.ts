import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { LineWebhookController } from '../auth/presentation/line-webhook.controller';
import {
  LINE_FOLLOW_EVENT_TEXT, PACKAGE_CHANGE_COMMAND, PROFILE_GUARD_COMMAND, PROFILE_GUARD_LATER_COMMAND,
  STAFF_CONTACT_COMMAND, EMPLOYEE_DOOR_COMMAND, linePostbackCommandText, staffMenuCommand,
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
  pendingSignup?: { companyName: string } | null;
  identity?: { userId: string; user: { status: string; aiAssistantOptOutAt: Date | null; displayName: string } } | null;
  ownerMembership?: any;
  context?: { companyId: string; aiPausedUntil: Date | null } | null;
  contextUpdateCount?: number;
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
      },
      externalIdentity: { findFirst: async () => options.identity ?? null },
      companyMembership: {
        // The role and company-status filters ARE the guard here, so the query is recorded: a fake
        // that only returns a row cannot tell whether the guard was asked for.
        findFirst: async (args: any) => { membershipQueries.push(args); return options.ownerMembership ?? null; },
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
    { enqueueSupportRequest: async (lineUserId: string, companyId: string | null) => { supportNotices.push({ companyId, lineUserId }); } } as any,
  );

  // The use case builds its own Logger; capture what it writes at ERROR.
  (useCase as any).logger = { error: (entry: any) => errors.push(entry), warn: () => {}, log: () => {} };
  return { useCase, replies, eventLog, audits, packageChanges, supportNotices, contextUpdates, membershipQueries, errors };
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
  });

  it('answers a follow with the status card while an application is travelling', async () => {
    const h = harness({ pendingSignup: { companyName: 'ร้านนิด' } });
    await h.useCase.execute(event(LINE_FOLLOW_EVENT_TEXT));

    assert.match(rendered(h), /ได้รับคำขอเปิดร้าน ร้านนิด/);
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

describe('P10-L contact-staff pause (§8)', () => {
  it('answers, pauses the assistant for 24 hours and tells the operators', async () => {
    const h = harness({ context: { companyId: 'co-1', aiPausedUntil: null } });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.match(rendered(h), /รับเรื่องแล้วค่ะ/);
    const pausedUntil = h.contextUpdates[0].data.aiPausedUntil as Date;
    const hours = (pausedUntil.getTime() - Date.now()) / 3_600_000;
    assert.ok(hours > 23.9 && hours <= 24, `pause is 24h, got ${hours}`);
    assert.deepEqual(h.supportNotices, [{ companyId: 'co-1', lineUserId: 'Uline-1' }]);
  });

  // The worst outcome this flow can produce: telling a stranger "รับเรื่องแล้ว" and telling nobody.
  // An unlinked prospect has no context row, and is exactly who most needs a person.
  it('tells the operators even when there is no shop to pause', async () => {
    const h = harness({ context: null });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.match(rendered(h), /รับเรื่องแล้วค่ะ/);
    assert.deepEqual(h.supportNotices, [{ companyId: null, lineUserId: 'Uline-1' }]);
  });

  // MEDIUM-6: a customer who asks twice inside the same pause is already in the queue. The alert
  // fires on the not-paused → paused transition; the daily outbox key is the durable second guard.
  it('does not re-alert while the pause it already opened is still running', async () => {
    const h = harness({ context: { companyId: 'co-1', aiPausedUntil: new Date(Date.now() + 3_600_000) } });
    await h.useCase.execute(event(STAFF_CONTACT_COMMAND));

    assert.match(rendered(h), /รับเรื่องแล้วค่ะ/, 'the customer is still answered');
    assert.deepEqual(h.supportNotices, []);
    assert.ok(h.contextUpdates[0].data.aiPausedUntil, 'and the pause is extended, not left to lapse');
  });

  it('holds the assistant back while the pause runs, and lets go once it expires', async () => {
    const identity = { userId: 'user-1', user: { status: 'ACTIVE', aiAssistantOptOutAt: null, displayName: 'นิด' } };

    const paused = harness({ identity, context: { companyId: 'co-1', aiPausedUntil: new Date(Date.now() + 3_600_000) } });
    await paused.useCase.execute(event('ยอดขายวันนี้'));
    assert.match(rendered(paused), /ทีมงานรับเรื่องแล้ว/);
    assert.equal(outcome(paused), 'support_paused');

    // Self-expiring: a stamp in the past is the same as no stamp, with nothing to clean up.
    const expired = harness({ identity, context: { companyId: 'co-1', aiPausedUntil: new Date(Date.now() - 1) } });
    await expired.useCase.execute(event(STAFF_CONTACT_COMMAND));
    assert.equal(outcome(expired), 'support_requested', 'the turn ran normally again');
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
