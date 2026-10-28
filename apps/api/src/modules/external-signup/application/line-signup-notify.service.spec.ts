import { lineMessagingCredentialsFixture } from '../../../common/config/line-messaging-credentials.fixture';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LINE_SIGNUP_PUSH_EVENT_TYPE, LineSignupNotifyService, lineSignupPushEventKey, lineSignupPushRetryKey, supportAskerLabelTh,
} from './line-signup-notify.service';
import { pushLineMessages } from '../../auth/infrastructure/system-line-push';
import { RequestLineSignupSupportUseCase } from './request-line-signup-support.use-case';
import { WARNING_LADDER_DAYS } from '../../system-partner-management/domain/logic/plan-term.logic';

const LINE_USER = 'Uline-1';
const TOKEN = 'channel-token';

type RequestRow = Record<string, unknown> | null;

function harness(options: {
  request?: RequestRow;
  due?: any[];
  readDue?: any[];
  owner?: { email: string | null; phoneNumber: string | null } | null;
  ocrUsed?: number;
  fetchImpl?: (url: string, init: any) => Promise<any>;
  markCount?: number;
  admins?: Array<{ companyId: string; userId: string }>;
  /** LINE users whose assistant pause has not lapsed yet, for the expiry sweep. */
  stillPaused?: Array<{ lineUserId: string }>;
  /** The §2.2-delta row `deliverSupportNotice` reads. `null` = the request was deleted meanwhile. */
  supportRequest?: Record<string, unknown> | null;
  /** How many admin LINE pushes actually landed. Owner 2026-09-05: in production this is 0. */
  lineDelivered?: number;
  /** `false` = no mail provider, `throw` = SES refused. */
  emailSent?: boolean | 'throw';
} = {}) {
  const appended: any[] = [];
  const marks: any[] = [];
  const logs: any[] = [];
  const pushes: any[] = [];
  const adminPushes: Array<{ userIds: string[]; text: string; opts?: { skipProviderUserIdHash?: string } }> = [];
  const queries: any[] = [];
  const letters: any[] = [];
  const supportUpdates: any[] = [];
  const supportQueries: any[] = [];
  const supportDeletes: any[] = [];

  const prisma = {
    client: {
      companySignupRequest: {
        findUnique: async () => options.request ?? null,
        // Two bounded reads now: the SQL-expressible day-7 branch, then the maybe-read-due one.
        // The fake answers them separately so the spec can see WHICH query found a row.
        findMany: async (args: any) => {
          queries.push(args);
          const timeBranch = Array.isArray(args?.where?.OR);
          return (timeBranch ? options.due : options.readDue) ?? [];
        },
        updateMany: async (args: any) => {
          marks.push(args);
          return { count: options.markCount ?? 1 };
        },
      },
      companyOcrUsageEvent: { count: async () => options.ocrUsed ?? 0 },
      companyMembership: { findFirst: async () => (options.owner ? { user: options.owner } : null), findMany: async () => [] },
      company: { findUnique: async () => ({ name: 'ร้านนิด' }) },
      externalIdentity: { findMany: async () => [] },
      lineSupportRequest: {
        findUnique: async () => (options.supportRequest === undefined
          ? { companyId: 'co-1', lineUserIdHash: 'deadbeefdeadbeef', lastMessageText: null, signupRequestId: null }
          : options.supportRequest),
        update: async (args: any) => { supportUpdates.push(args); return args; },
        findMany: async (args: any) => { supportQueries.push(args); return options.due ?? []; },
        updateMany: async (args: any) => { supportUpdates.push(args); return { count: (options.due ?? []).length }; },
        deleteMany: async (args: any) => { supportDeletes.push(args); return { count: (options.due ?? []).length }; },
      },
      lineCompanyContext: { findMany: async () => options.stillPaused ?? [] },
    },
  } as any;

  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    pushes.push({ url, init, body: JSON.parse(init.body) });
    if (options.fetchImpl) return options.fetchImpl(url, init);
    return { ok: true, status: 200, headers: { get: () => null } };
  }) as any;

  // §15.6: a failed push raises the once-a-day ops alert; recorded here rather than sent.
  const alerts: string[] = [];
  const service = new LineSignupNotifyService(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: TOKEN, lineLiffId: '1234567890-abcdef', sesWebBaseUrl: 'https://app.example.test' } as any),
    prisma,
    { append: async (input: any) => { appended.push(input); } } as any,
    { lineMessagingChannelAccessToken: TOKEN, lineLiffId: '1234567890-abcdef', sesWebBaseUrl: 'https://app.example.test' } as any,
    {
      activeSystemAdmins: async () => options.admins ?? [{ companyId: 'sys', userId: 'admin-1' }],
      pushToLinkedAdmins: async (userIds: string[], text: string, opts?: any) => {
        adminPushes.push({ userIds, text, ...(opts ? { opts } : {}) });
        return options.lineDelivered ?? userIds.length;
      },
    } as any,
    { raise: async (kind: string) => { alerts.push(kind); } } as any,
    {
      sendSupportRequestNotice: async (input: any) => {
        letters.push(input);
        if (options.emailSent === 'throw') throw new Error('ses_refused');
        return options.emailSent ?? true;
      },
    } as any,
    {
      info: (fields: any) => logs.push(fields),
      warn: (fields: any) => logs.push(fields),
      error: (fields: any) => logs.push(fields),
    } as any,
  );
  return {
    service, appended, marks, logs, pushes, adminPushes, queries, alerts, letters,
    supportUpdates, supportQueries, supportDeletes,
    restore: () => { globalThis.fetch = original; },
  };
}

const completed = (overrides: Record<string, unknown> = {}) => ({
  state: 'COMPLETED', source: 'line-oa', companyName: 'ร้านนิด', companyId: 'co-1',
  lineProviderUserId: LINE_USER, lineDisplayName: 'นิด', attachUserId: null, ...overrides,
});

describe('P10-L push queueing (§7)', () => {
  it('gives the approved and attached pushes ONE slot, so a retry cannot double-send', () => {
    // The two are the same event seen from two sides: one provisioning, one "your shop is ready".
    assert.equal(lineSignupPushEventKey('r1', 'approved'), lineSignupPushEventKey('r1', 'attached'));
    assert.notEqual(lineSignupPushEventKey('r1', 'approved'), lineSignupPushEventKey('r1', 'rejected'));
    assert.notEqual(lineSignupPushEventKey('r1', 'approved'), lineSignupPushEventKey('r2', 'approved'));
  });

  it('derives a stable UUID retry key, because LINE rejects anything else', () => {
    const key = lineSignupPushRetryKey('r1', 'approved');
    assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(key, lineSignupPushRetryKey('r1', 'approved'), 'the same event must retry under the same key');
    assert.notEqual(key, lineSignupPushRetryKey('r1', 'rejected'));
  });

  it('queues one outbox row carrying no personal data', async () => {
    const h = harness();
    await h.service.enqueue('r1', 'approved');
    h.restore();

    assert.equal(h.appended.length, 1);
    assert.equal(h.appended[0].eventType, LINE_SIGNUP_PUSH_EVENT_TYPE);
    assert.equal(h.appended[0].eventKey, lineSignupPushEventKey('r1', 'approved'));
    assert.deepEqual(h.appended[0].payloadJson.data, { signupRequestId: 'r1', kind: 'approved' });
  });

  it('gives each real information request its review-version key without putting the question in the outbox', async () => {
    const h = harness();
    await h.service.enqueue('r1', 'requested_info', new Date('2026-09-07T00:00:00Z'), { reviewVersion: 2 });
    await h.service.enqueue('r1', 'requested_info', new Date('2026-09-07T01:00:00Z'), { reviewVersion: 3 });
    h.restore();

    assert.equal(h.appended[0].eventKey, lineSignupPushEventKey('r1', 'requested_info', 2));
    assert.equal(h.appended[1].eventKey, lineSignupPushEventKey('r1', 'requested_info', 3));
    assert.notEqual(h.appended[0].eventKey, h.appended[1].eventKey);
    assert.deepEqual(h.appended[0].payloadJson.data, {
      signupRequestId: 'r1', kind: 'requested_info', reviewVersion: 2,
    });
  });
});

describe('P10-L push delivery', () => {
  it('sends the ready card with the CENTRAL start URL and no token in the message', async () => {
    const h = harness({ request: completed() });
    await h.service.deliver('r1', 'approved');
    h.restore();

    const sent = JSON.stringify(h.pushes[0].body);
    // Opening is confirmed without a paid prerequisite or an unsolicited free offer.
    assert.match(sent, /เปิดร้าน ร้านนิด ให้แล้ว/);
    assert.doesNotMatch(sent, /เลือกแพ็กเกจ|ชำระเงิน|3 ใบ|ทดลองใช้ฟรี/);
    assert.equal(sent.includes('ทดลอง'), false);
    assert.match(sent, /https:\/\/liff\.line\.me\/1234567890-abcdef\/start/);
    // LINE-ONBOARD-01: nothing that could be a credential travels in a chat message.
    assert.equal(/\/l\/|token/i.test(sent), false);
    assert.equal(h.pushes[0].init.headers['X-Line-Retry-Key'], lineSignupPushRetryKey('r1', 'approved'));
    // R-C4: the card names the next step in both the bold title and the button, not "ready to use".
    assert.match(sent, /เปิดร้านแล้ว/);
    assert.match(sent, /"label":"เปิดหน้าร้าน"/);
    assert.equal(sent.includes('พร้อมใช้งานแล้ว'), false);
    assert.equal(sent.includes('เริ่มใช้งาน"'), false);
    // The exit-point transform (line-reply.adapter.ts et al.) skips liff.line.me; the URL here is untouched.
    assert.equal(sent.includes('openExternalBrowser'), false);
  });

  it('titles the second-shop card "เพิ่มร้านแล้ว" with the same button and LIFF start URL (R-C4)', async () => {
    const h = harness({ request: completed({ attachUserId: 'user-9' }) });
    await h.service.deliver('r1', 'attached');
    h.restore();

    const sent = JSON.stringify(h.pushes[0].body);
    assert.match(sent, /เพิ่มร้านแล้ว/);
    assert.match(sent, /"label":"เปิดหน้าร้าน"/);
    assert.match(sent, /https:\/\/liff\.line\.me\/1234567890-abcdef\/start/);
  });

  // Review 2026-09-29: with no LIFF id the push is plain text with no button under it, so it must not
  // tell the owner to press one.
  for (const kind of ['approved', 'attached'] as const) {
    it(`never points at a button that is not there (${kind}, no LIFF id)`, async () => {
      const h = harness({ request: completed(kind === 'attached' ? { attachUserId: 'user-9' } : {}) });
      (h.service as any).config.lineLiffId = undefined;
      await h.service.deliver('r1', kind);
      h.restore();

      const [message] = h.pushes[0].body.messages;
      assert.equal(message.type, 'text');
      assert.doesNotMatch(message.text, /กดปุ่ม|ด้านล่าง/);
      assert.match(message.text, /เข้าหน้าร้าน/);
      assert.match(message.text, /เว็บแอปมั่งมีพลัส/, 'and says where to go instead');
    });
  }

  it('says "second shop" for an attach, and the polite refusal for a rejection', async () => {
    const attach = harness({ request: completed({ attachUserId: 'user-9' }) });
    await attach.service.deliver('r1', 'attached');
    attach.restore();
    assert.match(JSON.stringify(attach.pushes[0].body), /เพิ่มร้าน ร้านนิด ให้บัญชีของคุณ/);

    const reject = harness({ request: completed({ state: 'REJECTED' }) });
    await reject.service.deliver('r1', 'rejected');
    reject.restore();
    const text = JSON.stringify(reject.pushes[0].body);
    assert.match(text, /เรียน คุณนิด/);
    assert.match(text, /098-256-5628/, 'Owner asked for both a phone and an email');
    assert.match(text, /contact@mangmeeplus.com/);
  });

  it('sends nothing when the decision moved on between queueing and draining', async () => {
    const reopened = harness({ request: completed({ state: 'PENDING_REVIEW' }) });
    await reopened.service.deliver('r1', 'approved');
    reopened.restore();
    assert.equal(reopened.pushes.length, 0);

    const notRejected = harness({ request: completed({ state: 'COMPLETED' }) });
    await notRejected.service.deliver('r1', 'rejected');
    notRejected.restore();
    assert.equal(notRejected.pushes.length, 0, 'a revived application must not receive its rejection');
  });

  it('loads only the matching current information request and suppresses an obsolete queued question', async () => {
    const current = harness({ request: completed({
      state: 'PENDING_REVIEW', companyId: null, version: 3,
      reviewResolution: 'REQUEST_INFO', resolutionNote: 'กรุณาส่งชื่อร้านและเบอร์โทรศัพท์ให้ครบถ้วน',
    }) });
    await current.service.deliver('r1', 'requested_info', 3);
    current.restore();
    assert.match(JSON.stringify(current.pushes[0].body), /กรุณาส่งชื่อร้านและเบอร์โทรศัพท์ให้ครบถ้วน/);

    const stale = harness({ request: completed({
      state: 'PENDING_REVIEW', companyId: null, version: 4,
      reviewResolution: 'REQUEST_INFO', resolutionNote: 'คำถามใหม่กว่า',
    }) });
    await stale.service.deliver('r1', 'requested_info', 3);
    stale.restore();
    assert.deepEqual(stale.pushes, [], 'version 3 must not send the version 4 question');
  });

  it('throws on a LINE failure so the drain records it instead of losing the one message owed', async () => {
    const h = harness({
      request: completed(),
      fetchImpl: async () => ({ ok: false, status: 429, headers: { get: (name: string) => (name === 'retry-after' ? '17' : null) } }),
    });

    await assert.rejects(() => h.service.deliver('r1', 'approved'), /line_api_429/);
    h.restore();
    assert.equal(h.logs.at(-1).retryAfterSeconds, 17, 'LINE\'s own schedule is what gets recorded');
    // §15.6 (b): a 429 means customers are not hearing that their shop is open, and the log line
    // above is not something anyone reads. Raised BEFORE the throttle throw, which returns early.
    assert.deepEqual(h.alerts, ['line_push_failed']);
  });

  it('raises the same alert for a dead OA, and none for a delivery that lands', async () => {
    const dead = harness({
      request: completed(),
      fetchImpl: async () => ({ ok: false, status: 401, headers: { get: () => null } }),
    });
    await assert.rejects(() => dead.service.deliver('r1', 'approved'), /invalid_access_token/);
    dead.restore();
    assert.deepEqual(dead.alerts, ['line_push_failed']);

    const ok = harness({ request: completed() });
    await ok.service.deliver('r1', 'approved');
    ok.restore();
    assert.deepEqual(ok.alerts, [], 'a push that landed is not an ops event');
  });
});

// L-B follow-up (b). The old exclusion was lost when the fan-out moved to the shared helper, so an
// operator who is also the person asking got "a customer wants to talk to us" in their OWN chat.
describe('support notice never lands in the asker own chat', () => {
  it('reads the exclusion off the request row, so no LINE id ever enters the outbox', async () => {
    const h = harness({
      supportRequest: {
        companyId: 'co-1', lineUserIdHash: 'feedfacefeedface', lastMessageText: null, signupRequestId: null,
      },
    });
    await h.service.enqueueSupportRequest('req-1');
    await h.service.deliverSupportNotice('req-1');
    h.restore();

    assert.equal(JSON.stringify(h.appended[0].payloadJson).includes(LINE_USER), false,
      'the payload is an id and nothing else');
    assert.equal(h.adminPushes[0]!.opts!.skipProviderUserIdHash, 'feedfacefeedface');
  });
});

describe('P10-L day-7 nudge sweep (§3.6)', () => {
  const day = 86_400_000;
  const now = new Date('2026-09-20T03:00:00.000Z');
  const old = new Date(now.getTime() - 8 * day);
  const cutoffOf = (at: Date) => new Date(at.getTime() - 7 * day);
  const fresh = new Date(now.getTime() - 2 * day);

  it('queues one card for a shop that has been running a week with no way back in', async () => {
    const h = harness({
      due: [{ id: 'r1', companyId: 'co-1', approvedAt: old, createdAt: old }],
      owner: { email: null, phoneNumber: null },
    });
    const result = await h.service.sweepProfileGuardNudges(now);
    h.restore();

    assert.equal(result.queued, 1);
    assert.equal(h.appended[0].eventKey, lineSignupPushEventKey('r1', 'profile_guard'));
    // Claimed by CAS on its own null before queueing: two sweeps in flight produce one card.
    assert.deepEqual(h.marks[0].where, { id: 'r1', profileGuardNudgedAt: null });
  });

  it('claims the row exactly once — a lost race queues nothing', async () => {
    const h = harness({
      due: [{ id: 'r1', companyId: 'co-1', approvedAt: old, createdAt: old }],
      owner: { email: null, phoneNumber: null },
      markCount: 0,
    });
    const result = await h.service.sweepProfileGuardNudges(now);
    h.restore();
    assert.equal(result.queued, 0);
    assert.equal(h.appended.length, 0);
  });

  it('asks nothing of an owner who can already get back in', async () => {
    for (const owner of [{ email: 'a@b.co', phoneNumber: null }, { email: null, phoneNumber: '0812345678' }]) {
      const h = harness({ due: [{ id: 'r1', companyId: 'co-1', approvedAt: old, createdAt: old }], owner });
      const result = await h.service.sweepProfileGuardNudges(now);
      h.restore();
      assert.equal(result.queued, 0);
      // Stamped anyway, so the 15-minute sweep stops reconsidering a row it will never send.
      assert.equal(h.marks.length, 1);
      assert.equal(h.appended.length, 0);
    }
  });

  it('lets five reads stand in for seven days, and waits otherwise', async () => {
    const early = harness({
      readDue: [{ id: 'r1', companyId: 'co-1', approvedAt: fresh, createdAt: fresh }],
      owner: { email: null, phoneNumber: null },
      ocrUsed: 4,
    });
    assert.equal((await early.service.sweepProfileGuardNudges(now)).queued, 0);
    early.restore();

    const busy = harness({
      readDue: [{ id: 'r1', companyId: 'co-1', approvedAt: fresh, createdAt: fresh }],
      owner: { email: null, phoneNumber: null },
      ocrUsed: 5,
    });
    assert.equal((await busy.service.sweepProfileGuardNudges(now)).queued, 1);
    busy.restore();
  });

  // L-13. `approvedAt` is when the shop OPENED — for this source, approval and provisioning are the
  // same step. `createdAt` is when the form was submitted, which for a MANUAL application can be
  // days earlier: counting from it would nudge a shop that has barely been used.
  it('counts the seven days from approval, not from when the form was sent', async () => {
    // Applied nine days ago, approved two days ago: not due, and the clock says so.
    const justApproved = harness({
      readDue: [{ id: 'r1', companyId: 'co-1', approvedAt: fresh, createdAt: new Date(now.getTime() - 9 * day) }],
      owner: { email: null, phoneNumber: null },
      ocrUsed: 0,
    });
    assert.equal((await justApproved.service.sweepProfileGuardNudges(now)).queued, 0);
    justApproved.restore();

    // And the SQL branch asks about approvedAt, so a not-yet-due row is never even fetched.
    const h = harness({ due: [], owner: { email: null, phoneNumber: null } });
    await h.service.sweepProfileGuardNudges(now);
    h.restore();
    assert.deepEqual(h.queries[0].where.OR, [
      { approvedAt: { lte: cutoffOf(now) } },
      { approvedAt: null, createdAt: { lte: cutoffOf(now) } },
    ]);
  });

  // L-14/L-15. Two properties of the query itself: a phone given at signup already answers the
  // question the card asks, and the oldest rows are read first so a batch of shops that opened this
  // morning can never fill `take` and starve one that has been waiting eight days.
  it('asks the database for un-nudged, phone-less rows, oldest first', async () => {
    const h = harness({ due: [], owner: { email: null, phoneNumber: null } });
    await h.service.sweepProfileGuardNudges(now);
    h.restore();

    const where = h.queries[0].where;
    assert.equal(where.phoneNumber, null, 'a phone at signup means this card is not needed');
    assert.equal(where.profileGuardNudgedAt, null);
    assert.equal(where.state, 'COMPLETED');
    assert.equal(where.source, 'line-oa');
    assert.deepEqual(where.companyId, { not: null });
    assert.deepEqual(h.queries[0].orderBy, [{ approvedAt: 'asc' }, { createdAt: 'asc' }]);
  });

});

// §7 sets a hard budget: ≤2 pushes in the first week, ≤6 over thirty days, because the OA's free
// plan is ~500 messages a month and the flow is sized for ~80 signups. Counting the ROWS a real
// lifecycle enqueues is the only version of this test that fails when someone adds a push.
describe('P10-L push budget (§7)', () => {
  const day = 86_400_000;
  const opened = new Date('2026-09-01T03:00:00.000Z');

  /** Every outbox row a shop's first thirty days produce, driven through the real enqueue paths. */
  async function lifecycleKeys(): Promise<string[]> {
    const h = harness({
      due: [{ id: 'r1', companyId: 'co-1', approvedAt: opened, createdAt: opened }],
      owner: { email: null, phoneNumber: null },
    });
    // Day 0: provisioning announces the shop. Both COMPLETED paths call this — the normal finish
    // and the stranded-row close-out — so it is enqueued twice on purpose.
    await h.service.enqueue('r1', 'approved');
    await h.service.enqueue('r1', 'approved');
    // Day 7: the กันหลุด sweep, appending into the same recorded outbox.
    await h.service.sweepProfileGuardNudges(new Date(opened.getTime() + 7 * day));
    h.restore();
    return h.appended.map((row: any) => row.eventKey);
  }

  it('spends at most two pushes in the first seven days, and dedupes a repeated announcement', async () => {
    const keys = await lifecycleKeys();
    const distinct = new Set(keys);

    assert.equal(distinct.size, 2, `first week must cost ≤2 pushes, got ${[...distinct].join(', ')}`);
    assert.ok(distinct.has(lineSignupPushEventKey('r1', 'approved')));
    assert.ok(distinct.has(lineSignupPushEventKey('r1', 'profile_guard')));
    // Three enqueue calls, two keys: the outbox is what makes the double announcement one message.
    assert.equal(keys.length, 3);
  });

  it('stays inside six over thirty days once P29 adds its own four', async () => {
    const distinct = new Set(await lifecycleKeys());
    // P29 owns the 7/3/1 warnings and the expiry notice and sends them on its own rail — this slice
    // must not add a fifth and sixth of its own, or the table in §7 stops being true.
    //
    // Derived from P29's own ladder rather than typed: adding a fourth warning day there would make
    // the §7 budget false, and a hardcoded 4 here would have gone on agreeing with itself.
    const P29_PUSHES_OVER_THIRTY_DAYS = WARNING_LADDER_DAYS.length + 1; // + the expiry notice
    assert.ok(
      distinct.size + P29_PUSHES_OVER_THIRTY_DAYS <= 6,
      `thirty-day budget is 6; this slice contributes ${distinct.size}`,
    );
  });

  it('adds nothing for a shop that gave a phone at signup', async () => {
    // The sweep's own SQL excludes it, so the only push that shop gets is the announcement.
    const h = harness({ due: [], owner: { email: null, phoneNumber: null } });
    await h.service.enqueue('r1', 'approved');
    await h.service.sweepProfileGuardNudges(new Date(opened.getTime() + 7 * day));
    h.restore();

    assert.deepEqual(h.appended.map((row: any) => row.eventKey), [lineSignupPushEventKey('r1', 'approved')]);
  });
});

describe('support notices (line-support-request-spec-th §2.2)', () => {
  it('keys the notice per REQUEST, not per shop per day', async () => {
    const h = harness();
    const day1 = new Date('2026-09-03T02:00:00.000Z');
    const sameDay = new Date('2026-09-03T16:00:00.000Z');

    await h.service.enqueueSupportRequest('req-1', day1);
    await h.service.enqueueSupportRequest('req-1', sameDay);
    await h.service.enqueueSupportRequest('req-2', sameDay);
    h.restore();

    const keys = h.appended.map((row: any) => row.eventKey);
    assert.equal(new Set(keys.slice(0, 2)).size, 1, 'one request is one notice, however often it is queued');
    assert.notEqual(keys[2], keys[0], 'a second request is a second notice, even the same day');
    assert.match(keys[0], /^notify:line_support:req:req-1$/);
    // The whole payload is an id: no LINE id, no name, no message text (P11 F-EM-3).
    assert.deepEqual(h.appended[0].payloadJson.data, { supportRequestId: 'req-1' });
  });

  it('points every channel at the support inbox, and names the shop from the request row', async () => {
    const h = harness();
    await h.service.deliverSupportNotice('req-1');
    h.restore();
    assert.match(h.adminPushes[0]!.text, /\/system\/support-requests/);
    assert.match(h.adminPushes[0]!.text, /ร้านนิด/);
    assert.equal(h.letters[0].actionUrl, 'https://app.example.test/system/support-requests');
    assert.equal(h.letters[0].toEmail, 'contact@mangmeeplus.com');
    assert.equal(h.letters[0].who, 'ร้านนิด');
  });

  it('names an applicant by the shop they applied for, never by a LINE id', async () => {
    const h = harness({
      supportRequest: {
        companyId: null, lineUserIdHash: 'aaaabbbbccccdddd',
        lastMessageText: 'สมัครแล้วยังไม่ได้เรื่องเลยค่ะ', signupRequestId: 'sr-1',
      },
      request: { companyName: 'The sun coffee' },
    });
    await h.service.deliverSupportNotice('req-1');
    h.restore();
    assert.equal(h.letters[0].who, 'ผู้ที่ยังไม่ได้เปิดร้าน (มีคำขอสมัคร: The sun coffee)');
    assert.equal(h.letters[0].lastMessageText, 'สมัครแล้วยังไม่ได้เรื่องเลยค่ะ');
    assert.match(h.adminPushes[0]!.text, /สมัครแล้วยังไม่ได้เรื่องเลยค่ะ/);
  });

  // Review 2026-09-29 (item 1): a COMPLETED application IS a shop — asks filed before the row
  // carried its company must not read "ผู้ที่ยังไม่ได้เปิดร้าน" in the mailbox or the admin push.
  it('names a completed application by its shop, never as someone who has not opened one', async () => {
    const h = harness({
      supportRequest: { companyId: null, lineUserIdHash: 'aaaabbbbccccdddd', lastMessageText: null, signupRequestId: 'sr-1' },
      request: { companyName: 'The sun coffee', state: 'COMPLETED' },
    });
    await h.service.deliverSupportNotice('req-1');
    h.restore();
    assert.equal(h.letters[0].who, 'The sun coffee');
    assert.match(h.adminPushes[0]!.text, /^📮 ลูกค้าขอคุยกับเจ้าหน้าที่: The sun coffee\n/);
    assert.equal(supportAskerLabelTh(null, 'The sun coffee', true), 'The sun coffee');
    assert.equal(supportAskerLabelTh('ร้านจริง', 'The sun coffee', true), 'ร้านจริง', 'the live shop name still wins');
  });

  // The UAT evidence: zero LINE-linked admins, notice PUBLISHED, nobody told, nothing said so.
  it('records what actually landed on each channel', async () => {
    const h = harness({ lineDelivered: 0 });
    await h.service.deliverSupportNotice('req-1');
    h.restore();
    assert.deepEqual(Object.keys(h.supportUpdates[0].data).sort(),
      ['emailSent', 'lineNotifiedCount', 'notifiedAt']);
    assert.equal(h.supportUpdates[0].data.lineNotifiedCount, 0);
    assert.equal(h.supportUpdates[0].data.emailSent, true);
    // `notifiedAt` is what separates this from "the drain has not run yet" in the inbox.
    assert.ok(h.supportUpdates[0].data.notifiedAt instanceof Date);
    assert.equal(h.logs.at(-1).event, 'signup.support.notified');
    assert.deepEqual(h.alerts, [], 'the letter went out, so somebody was told');
  });

  it('raises support_unreachable only when NO channel delivered anything', async () => {
    const h = harness({ admins: [], lineDelivered: 0, emailSent: false });
    await h.service.deliverSupportNotice('req-1');
    h.restore();
    assert.equal(h.supportUpdates[0].data.lineNotifiedCount, 0);
    assert.equal(h.supportUpdates[0].data.emailSent, false);
    assert.ok(h.supportUpdates[0].data.notifiedAt instanceof Date, 'we DID try; nobody heard');
    assert.equal(h.logs.at(-1).event, 'signup.support.unreachable');
    assert.equal(h.logs.at(-1).riskLevel, 'HIGH');
    assert.deepEqual(h.alerts, ['support_unreachable']);
  });

  it('treats an SES refusal as "not sent" instead of letting it reach the drain', async () => {
    const h = harness({ admins: [], emailSent: 'throw' });
    await h.service.deliverSupportNotice('req-1');
    h.restore();
    assert.deepEqual(h.alerts, ['support_unreachable']);
    assert.ok(h.logs.some((row: any) => row.event === 'signup.support.email_failed'));
  });

  it('does nothing at all for a request that no longer exists', async () => {
    const h = harness({ supportRequest: null });
    await h.service.deliverSupportNotice('gone');
    h.restore();
    assert.deepEqual(h.letters, []);
    assert.deepEqual(h.adminPushes, []);
    assert.deepEqual(h.supportUpdates, []);
  });

  it('never hides an unanswered case when its assistant pause lapses', async () => {
    const h = harness({ due: [{ id: 'req-1' }], stillPaused: [{ lineUserId: 'Uline-9' }] });
    const result = await h.service.sweepExpiredSupportRequests(new Date('2026-09-05T00:00:00.000Z'));
    h.restore();
    assert.equal(result.expired, 0);
    assert.deepEqual(h.supportQueries, []);
    assert.deepEqual(h.supportUpdates, []);
  });

  /**
   * Review 2026-09-06 (F1). Timing the window from `requestedAt` closed a request 24 h after it was
   * FIRST raised, however recently the customer had written — so a thread reopened at hour 23 was
   * swept at hour 24 with an unanswered question on it, straight after being told "ทีมงานจะตอบกลับ
   * ในแชทนี้นะคะ". The thread's life is measured from the last thing the customer said.
   */
  it('does not infer resolution from either customer-message clock', async () => {
    const h = harness({ due: [{ id: 'req-1' }] });
    const now = new Date('2026-09-05T00:00:00.000Z');
    await h.service.sweepExpiredSupportRequests(now);
    h.restore();

    assert.deepEqual(h.supportQueries, []);
    assert.deepEqual(h.supportUpdates, []);
  });

  // §3 PDPA. A settled request keeps a raw LINE id and up to 200 characters the customer typed;
  // 90 days after the matter was settled neither has a purpose, so the whole row goes.
  it('deletes settled requests 90 days after they settled, not after they were asked', async () => {
    const h = harness({ due: [{ id: 'req-1' }, { id: 'req-2' }] });
    const now = new Date('2026-12-05T00:00:00.000Z');
    const result = await h.service.purgeSettledSupportRequests(now);
    h.restore();

    assert.equal(result.purged, 2);
    const where = h.supportQueries[0].where;
    // The clock runs from the SETTLED stamp, and an OPEN request is never touched however old:
    // one of those is somebody still waiting.
    assert.equal(where.status, 'CLOSED');
    const cutoff = where.closedAt.lte as Date;
    assert.equal(Math.round((now.getTime() - cutoff.getTime()) / 86_400_000), 90);
    assert.equal(JSON.stringify(where).includes('ANSWERED'), false, 'an answer is not proof the issue was resolved');
    assert.equal(JSON.stringify(where).includes('requestedAt'), false);
    assert.deepEqual(h.supportDeletes[0].where, { id: { in: ['req-1', 'req-2'] } });
  });

  it('deletes nothing at all when nothing is due', async () => {
    const h = harness({ due: [] });
    assert.deepEqual(await h.service.purgeSettledSupportRequests(), { purged: 0 });
    h.restore();
    assert.deepEqual(h.supportDeletes, []);
  });
});

describe('the shared LINE push helper (G-07)', () => {
  const withFetch = async (impl: (url: string, init: any) => Promise<any>, run: () => Promise<unknown>) => {
    const original = globalThis.fetch;
    globalThis.fetch = impl as any;
    try {
      return await run();
    } finally {
      globalThis.fetch = original;
    }
  };

  it('reports LINE\'s own retry-after on a 429 instead of guessing one', async () => {
    const outcome = await withFetch(
      async () => ({ ok: false, status: 429, headers: { get: (n: string) => (n === 'retry-after' ? '30' : null) } }),
      () => pushLineMessages({ token: TOKEN, lineUserId: LINE_USER, messages: [] }),
    ) as any;
    assert.deepEqual(outcome, { ok: false, error: 'line_api_429', retryAfterSeconds: 30 });
  });

  it('ignores a retry-after it cannot read, rather than scheduling on NaN', async () => {
    const outcome = await withFetch(
      async () => ({ ok: false, status: 429, headers: { get: () => 'soon' } }),
      () => pushLineMessages({ token: TOKEN, lineUserId: LINE_USER, messages: [] }),
    ) as any;
    assert.deepEqual(outcome, { ok: false, error: 'line_api_429' });
  });

  it('treats an already-accepted 409 as delivered, so a retry does not double-send', async () => {
    const outcome = await withFetch(
      async () => ({ ok: false, status: 409, headers: { get: (n: string) => (n === 'x-line-accepted-request-id' ? 'req-1' : null) } }),
      () => pushLineMessages({ token: TOKEN, lineUserId: LINE_USER, messages: [], retryKey: 'k' }),
    );
    assert.deepEqual(outcome, { ok: true });
  });

  it('names a bad token apart from a transport failure, and never throws', async () => {
    const unauthorized = await withFetch(
      async () => ({ ok: false, status: 401, headers: { get: () => null } }),
      () => pushLineMessages({ token: TOKEN, lineUserId: LINE_USER, messages: [] }),
    );
    assert.deepEqual(unauthorized, { ok: false, error: 'invalid_access_token' });

    const dead = await withFetch(
      async () => { throw new Error('ECONNRESET'); },
      () => pushLineMessages({ token: TOKEN, lineUserId: LINE_USER, messages: [] }),
    );
    assert.deepEqual(dead, { ok: false, error: 'line_api_unreachable' });
  });
});

// Review 2026-09-29 (item 1): the LIFF "ติดต่อเจ้าหน้าที่" filed every ask with no company, so an ask
// from a shop that had already opened (locked until it buys) reached the inbox as
// "ผู้ที่ยังไม่ได้เปิดร้าน" and nobody could tell which shop to call.
describe('LIFF "ติดต่อเจ้าหน้าที่" (RequestLineSignupSupportUseCase)', () => {
  const run = async (signup: Record<string, unknown> | null) => {
    const created: any[] = [];
    const audits: any[] = [];
    const notices: string[] = [];
    const tx: any = {
      $executeRaw: async () => 0,
      lineSupportRequest: { findFirst: async () => null, create: async (args: any) => { created.push(args.data); return { id: 'sr-1' }; } },
      companySignupRequest: { findFirst: async () => signup },
      auditLog: { create: async (args: any) => { audits.push(args.data); return {}; } },
    };
    const useCase = new RequestLineSignupSupportUseCase(
      { client: { $transaction: async (fn: (client: any) => unknown) => fn(tx) } } as any,
      { verify: async () => ({ providerUserId: LINE_USER, channelId: 'channel-1' }) } as any,
      { consumeLineSupportRequestSlot: async () => true } as any,
      { enqueueSupportRequest: async (id: string) => { notices.push(id); } } as any,
    );
    await useCase.execute('a.b.c', 'corr-1');
    return { created, audits, notices };
  };

  it('files the ask against the shop a COMPLETED application opened', async () => {
    const { created, audits, notices } = await run({ id: 'signup-1', state: 'COMPLETED', companyId: 'co-1' });
    assert.equal(created[0].companyId, 'co-1');
    assert.equal(created[0].signupRequestId, 'signup-1');
    assert.equal(audits[0].companyId, 'co-1');
    assert.deepEqual(notices, ['sr-1']);
  });

  it('names no shop while the application is still travelling', async () => {
    const { created, audits } = await run({ id: 'signup-1', state: 'PENDING_REVIEW', companyId: null });
    assert.equal(created[0].companyId, undefined);
    assert.equal(created[0].signupRequestId, 'signup-1');
    assert.equal(audits[0].companyId, undefined);
  });
});
