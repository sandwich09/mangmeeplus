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
  owner?: { email: string | null; phoneNumber: string | null } | null;
  ocrUsed?: number;
  fetchImpl?: (url: string, init: any) => Promise<any>;
  markCount?: number;
} = {}) {
  const appended: any[] = [];
  const marks: any[] = [];
  const logs: any[] = [];
  const pushes: any[] = [];

  const prisma = {
    client: {
      companySignupRequest: {
        findUnique: async () => options.request ?? null,
        findMany: async () => options.due ?? [],
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

  const service = new LineSignupNotifyService(
    prisma,
    { append: async (input: any) => { appended.push(input); } } as any,
    { lineMessagingChannelAccessToken: TOKEN, lineLiffId: '1234567890-abcdef', sesWebBaseUrl: 'https://app.example.test' } as any,
    { warn: (fields: any) => logs.push(fields), error: (fields: any) => logs.push(fields) } as any,
  );
  return { service, appended, marks, logs, pushes, restore: () => { globalThis.fetch = original; } };
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
      due: [{ id: 'r1', companyId: 'co-1', approvedAt: fresh, createdAt: fresh }],
      owner: { email: null, phoneNumber: null },
      ocrUsed: 4,
    });
    assert.equal((await early.service.sweepProfileGuardNudges(now)).queued, 0);
    early.restore();

    const busy = harness({
      due: [{ id: 'r1', companyId: 'co-1', approvedAt: fresh, createdAt: fresh }],
      owner: { email: null, phoneNumber: null },
      ocrUsed: 5,
    });
    assert.equal((await busy.service.sweepProfileGuardNudges(now)).queued, 1);
    busy.restore();
  });

  it('keeps a normal signup inside the first-week push budget (§7: 2 pushes)', async () => {
    // Provisioning queues one; the day-7 sweep queues at most one more. Nothing else in this slice
    // enqueues before day 7, so the budget table's "≤2" is a property of these two keys.
    const keys = new Set([
      lineSignupPushEventKey('r1', 'approved'),
      lineSignupPushEventKey('r1', 'attached'),
      lineSignupPushEventKey('r1', 'profile_guard'),
    ]);
    assert.equal(keys.size, 2, 'exactly two push slots exist in the first seven days');
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
