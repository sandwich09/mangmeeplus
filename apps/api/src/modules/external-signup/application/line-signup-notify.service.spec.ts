import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LINE_SIGNUP_PUSH_EVENT_TYPE, LineSignupNotifyService, lineSignupPushEventKey, lineSignupPushRetryKey,
} from './line-signup-notify.service';
import { pushLineMessages } from '../../auth/infrastructure/system-line-push';

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
} = {}) {
  const appended: any[] = [];
  const marks: any[] = [];
  const logs: any[] = [];
  const pushes: any[] = [];
  const adminPushes: Array<{ userIds: string[]; text: string }> = [];
  const queries: any[] = [];

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
      companyOcrMonthlyUsage: { aggregate: async () => ({ _sum: { usedCount: options.ocrUsed ?? 0 } }) },
      companyMembership: { findFirst: async () => (options.owner ? { user: options.owner } : null), findMany: async () => [] },
      company: { findUnique: async () => ({ name: 'ร้านนิด' }) },
      externalIdentity: { findMany: async () => [] },
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
  const service = new LineSignupNotifyService(
    prisma,
    { append: async (input: any) => { appended.push(input); } } as any,
    { lineMessagingChannelAccessToken: TOKEN, lineLiffId: '1234567890-abcdef', sesWebBaseUrl: 'https://app.example.test' } as any,
    {
      activeSystemAdmins: async () => options.admins ?? [{ companyId: 'sys', userId: 'admin-1' }],
      pushToLinkedAdmins: async (userIds: string[], text: string) => { adminPushes.push({ userIds, text }); },
    } as any,
    { raise: async (kind: string) => { alerts.push(kind); } } as any,
    { warn: (fields: any) => logs.push(fields), error: (fields: any) => logs.push(fields) } as any,
  );
  return {
    service, appended, marks, logs, pushes, adminPushes, queries, alerts,
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
});

describe('P10-L push delivery', () => {
  it('sends the ready card with the CENTRAL start URL and no token in the message', async () => {
    const h = harness({ request: completed() });
    await h.service.deliver('r1', 'approved');
    h.restore();

    const sent = JSON.stringify(h.pushes[0].body);
    assert.match(sent, /ร้าน ร้านนิด พร้อมใช้แล้ว/);
    assert.match(sent, /https:\/\/liff\.line\.me\/1234567890-abcdef\/start/);
    // LINE-ONBOARD-01: nothing that could be a credential travels in a chat message.
    assert.equal(/\/l\/|token/i.test(sent), false);
    assert.equal(h.pushes[0].init.headers['X-Line-Retry-Key'], lineSignupPushRetryKey('r1', 'approved'));
  });

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

  it('throws on a LINE failure so the drain records it instead of losing the one message owed', async () => {
    const h = harness({
      request: completed(),
      fetchImpl: async () => ({ ok: false, status: 429, headers: { get: (name: string) => (name === 'retry-after' ? '17' : null) } }),
    });

    await assert.rejects(() => h.service.deliver('r1', 'approved'), /line_api_429/);
    h.restore();
    assert.equal(h.logs.at(-1).retryAfterSeconds, 17, 'LINE\'s own schedule is what gets recorded');
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
    const P29_PUSHES_OVER_THIRTY_DAYS = 4;
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

describe('P10-L support alerts (§7/§8)', () => {
  it('keys the alert per shop per Bangkok day, and carries no LINE id into the outbox', async () => {
    const h = harness();
    const day1 = new Date('2026-09-03T02:00:00.000Z');   // 09:00 Bangkok
    const sameDay = new Date('2026-09-03T16:00:00.000Z'); // 23:00 Bangkok
    const nextDay = new Date('2026-09-03T17:30:00.000Z'); // 00:30 Bangkok, the 4th

    await h.service.enqueueSupportRequest('Uline-1', 'co-1', day1);
    await h.service.enqueueSupportRequest('Uline-1', 'co-1', sameDay);
    await h.service.enqueueSupportRequest('Uline-1', 'co-1', nextDay);
    h.restore();

    const keys = h.appended.map((row: any) => row.eventKey);
    assert.equal(new Set(keys.slice(0, 2)).size, 1, 'two asks on one Bangkok day are one alert');
    assert.notEqual(keys[2], keys[0], 'a new Bangkok day is a new alert');
    // A LINE user id is a durable identifier for a person; the outbox is readable platform-wide.
    assert.equal(JSON.stringify(h.appended).includes('Uline-1'), false);
  });

  it('keys an unlinked stranger by a digest, not by their LINE id', async () => {
    const h = harness();
    await h.service.enqueueSupportRequest('Uline-1', null);
    await h.service.enqueueSupportRequest('Uline-2', null);
    h.restore();

    const [first, second] = h.appended.map((row: any) => row.eventKey);
    assert.notEqual(first, second, 'two strangers are two alerts');
    assert.match(first, /^notify:line_support:anon:[0-9a-f]{16}:\d{4}-\d{2}-\d{2}$/);
    assert.equal(JSON.stringify(h.appended).includes('Uline-1'), false);
  });

  it('points an operator at the partner page, or the queue when there is no shop yet', async () => {
    const withShop = harness();
    await withShop.service.deliverSupportNotice('co-1');
    withShop.restore();
    assert.match(withShop.adminPushes[0]!.text, /\/system\/partners\/co-1/);
    assert.match(withShop.adminPushes[0]!.text, /ร้านนิด/);
    assert.deepEqual(withShop.adminPushes[0]!.userIds, ['admin-1']);

    const noShop = harness();
    await noShop.service.deliverSupportNotice(null);
    noShop.restore();
    assert.match(noShop.adminPushes[0]!.text, /\/system\/signup-requests/);
  });

  it('says nothing when there is no operator to say it to', async () => {
    const h = harness({ admins: [] });
    await h.service.deliverSupportNotice('co-1');
    h.restore();
    assert.deepEqual(h.adminPushes, []);
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
