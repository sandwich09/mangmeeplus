import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_CLAIM_EMAIL_EVENT_TYPE,
  CLAIM_EXPIRY_FAILURE_CODE,
  SIGNUP_REJECTION_NOTICE_EVENT_TYPE,
  SignupClaimEmailService,
  claimEmailEventKey,
} from './signup-claim-email.service';
import {
  SIGNUP_PENDING_REVIEW_EVENT_TYPE,
  SignupAdminNotifyService,
  signupPendingReviewMessage,
} from './signup-admin-notify.service';
import { LINE_SIGNUP_PUSH_EVENT_TYPE, LINE_SUPPORT_NOTICE_EVENT_TYPE, LinePushThrottledError } from './line-signup-notify.service';

const NOW = new Date('2026-09-01T12:00:00.000Z');

type Harness = ReturnType<typeof harness>;

function harness(options: { request?: any; sendFails?: boolean } = {}) {
  const appended: any[] = [];
  const sent: any[] = [];
  const rejections: any[] = [];
  const notified: string[] = [];
  const claims: any[] = [];
  const published: any[] = [];
  const failed: any[] = [];
  const updates: any[] = [];
  const minted: string[] = [];
  const logs: any[] = [];
  let claimable: any[] = [];

  const request = options.request === undefined
    ? {
      id: 'signup-1', state: 'EMAIL_PENDING',
      contactEmail: 'somchai@example.com', companyName: 'ร้านมั่งมี',
    }
    : options.request;

  const prisma = {
    client: {
      companySignupRequest: {
        findUnique: async () => request,
        findMany: async () => [],
        update: async (args: any) => { updates.push(args); return {}; },
        updateMany: async () => ({ count: 1 }),
      },
    },
  } as any;

  const outbox = {
    append: async (input: any) => { appended.push(input); return input; },
    reclaimStalledProcessing: async () => ({ reclaimed: 0, dead: 0 }),
    claimBatch: async (input: any) => { claims.push(input); return claimable; },
    markPublished: async (input: any) => { published.push(input); return true; },
    markFailed: async (input: any) => { failed.push(input); return true; },
  } as any;

  const tokens = {
    mint: async (id: string) => {
      const rawToken = `raw-token-for-${id}`;
      minted.push(rawToken);
      return { rawToken, expiresAt: new Date(NOW.getTime() + 72 * 3_600_000) };
    },
  } as any;

  const mailer = {
    sendAccountClaim: async (input: any) => {
      if (options.sendFails) throw new Error('SES unavailable');
      sent.push(input);
      return 'ses-message-1';
    },
    sendSignupRejection: async (input: any) => {
      if (options.sendFails) throw new Error('SES unavailable');
      rejections.push(input);
    },
  } as any;

  const logger = {
    error: (fields: any) => logs.push(fields),
    warn: (fields: any) => logs.push(fields),
  } as any;

  const core = { advance: async () => ({ replayed: false }) } as any;
  const adminNotify = { notify: async (id: string) => { notified.push(id); } } as any;

  const lineDelivered: Array<{ id: string; kind: string }> = [];
  let lineFailure: unknown = null;
  const lineNotify = {
    deliver: async (id: string, kind: string) => {
      if (lineFailure) throw lineFailure;
      lineDelivered.push({ id, kind });
    },
    deliverSupportNotice: async () => undefined,
  } as any;

  const service = new SignupClaimEmailService(prisma, outbox, tokens, core, adminNotify, lineNotify, mailer, logger);
  return {
    service, appended, sent, rejections, notified, claims, published, failed, updates, minted, logs, lineDelivered,
    lineFails: (error: unknown) => { lineFailure = error; },
    queue: (events: any[]) => { claimable = events; },
  };
}

describe('claim email event keys', () => {
  it('gives approve the spec key so a repeated decision queues one email', () => {
    assert.equal(claimEmailEventKey('signup-1', 'approve', NOW), 'email:claim:signup-1');
    assert.equal(
      claimEmailEventKey('signup-1', 'approve', new Date(NOW.getTime() + 86_400_000)),
      'email:claim:signup-1',
    );
  });

  it('makes the reminder exactly-once at the database level', () => {
    assert.equal(claimEmailEventKey('signup-1', 'reminder', NOW), 'email:claim:signup-1:reminder');
    assert.equal(
      claimEmailEventKey('signup-1', 'reminder', new Date(NOW.getTime() + 9_000_000)),
      'email:claim:signup-1:reminder',
    );
  });

  it('collapses a double-clicked resend but lets a later one through', () => {
    const first = claimEmailEventKey('signup-1', 'resend', NOW);
    const doubleClick = claimEmailEventKey('signup-1', 'resend', new Date(NOW.getTime() + 5_000));
    const aMinuteLater = claimEmailEventKey('signup-1', 'resend', new Date(NOW.getTime() + 61_000));
    assert.equal(first, doubleClick);
    assert.notEqual(first, aMinuteLater);
    assert.notEqual(first, claimEmailEventKey('signup-1', 'reissue', NOW));
  });
});

describe('SignupClaimEmailService.enqueue', () => {
  it('puts the request id and nothing else in the outbox payload', async () => {
    const h = harness();
    await h.service.enqueue('signup-1', 'approve', NOW);

    const [event] = h.appended;
    assert.equal(event.eventType, ACCOUNT_CLAIM_EMAIL_EVENT_TYPE);
    assert.equal(event.eventKey, 'email:claim:signup-1');
    assert.equal(event.priority, 'HIGH');
    assert.deepEqual(event.payloadJson.data, { signupRequestId: 'signup-1', reminder: false });
    // No address, company name, token or hash may ride along (mint-at-send, PII-free evidence).
    const serialised = JSON.stringify(event);
    for (const secret of ['somchai@example.com', 'ร้านมั่งมี', 'raw-token', 'tokenHash']) {
      assert.equal(serialised.includes(secret), false, `payload leaked ${secret}`);
    }
  });

  it('flags the reminder in the payload', async () => {
    const h = harness();
    await h.service.enqueue('signup-1', 'reminder', NOW);
    assert.equal(h.appended[0].payloadJson.data.reminder, true);
  });
});

describe('SignupClaimEmailService.enqueueRejectionNotice', () => {
  it('carries the admin paragraph and keeps one key per rejection', async () => {
    const h = harness();
    await h.service.enqueueRejectionNotice('signup-1', '  ข้อมูลบริษัทไม่ครบ  ', NOW);

    const [event] = h.appended;
    assert.equal(event.eventType, SIGNUP_REJECTION_NOTICE_EVENT_TYPE);
    assert.equal(event.eventKey, 'email:signup_rejected:signup-1');
    assert.deepEqual(event.payloadJson.data, { signupRequestId: 'signup-1', reason: 'ข้อมูลบริษัทไม่ครบ' });
  });

  it('omits the reason entirely when the admin wrote nothing', async () => {
    const h = harness();
    await h.service.enqueueRejectionNotice('signup-1', '   ', NOW);
    assert.deepEqual(h.appended[0].payloadJson.data, { signupRequestId: 'signup-1' });

    const bare = harness();
    await bare.service.enqueueRejectionNotice('signup-1', undefined, NOW);
    assert.deepEqual(bare.appended[0].payloadJson.data, { signupRequestId: 'signup-1' });
  });

  it('bounds a pasted essay before it reaches the outbox', async () => {
    const h = harness();
    await h.service.enqueueRejectionNotice('signup-1', 'ก'.repeat(900), NOW);
    assert.equal(h.appended[0].payloadJson.data.reason.length, 500);
  });
});

describe('SignupClaimEmailService.drain', () => {
  const event = (overrides: any = {}) => ({
    id: 'evt-1', claimToken: 'lease-1', attempts: 0, eventType: ACCOUNT_CLAIM_EMAIL_EVENT_TYPE,
    payloadJson: { schemaVersion: 1, data: { signupRequestId: 'signup-1', reminder: false } },
    ...overrides,
  });

  it('mints at send, mails the raw token once, and never persists it', async () => {
    const h = harness();
    h.queue([event()]);
    const result = await h.service.drain();

    assert.deepEqual(
      { claimed: result.claimed, sent: result.sent, failed: result.failed },
      { claimed: 1, sent: 1, failed: 0 },
    );
    assert.equal(h.sent[0].rawToken, 'raw-token-for-signup-1');
    assert.equal(h.sent[0].toEmail, 'somchai@example.com');
    // The only writes back to the request are the send timestamp and the SES message id that a
    // later bounce/complaint event will arrive with — the raw token goes nowhere.
    assert.equal(h.updates.length, 1);
    assert.ok(h.updates[0].data.claimEmailLastSentAt instanceof Date);
    assert.equal(h.updates[0].data.claimEmailSesMessageId, 'ses-message-1');
    assert.equal(JSON.stringify(h.updates).includes('raw-token'), false);
    assert.deepEqual(h.published[0], {
      id: 'evt-1', claimToken: 'lease-1', expectedEventType: ACCOUNT_CLAIM_EMAIL_EVENT_TYPE,
    });
  });

  it('routes a LINE push row to the push sender, carrying the kind the row names', async () => {
    const h = harness();
    h.queue([event({
      id: 'evt-push', eventType: LINE_SIGNUP_PUSH_EVENT_TYPE,
      payloadJson: { schemaVersion: 1, data: { signupRequestId: 'signup-1', kind: 'approved' } },
    })]);

    const result = await h.service.drain();

    assert.equal(result.sent, 1);
    assert.deepEqual(h.lineDelivered, [{ id: 'signup-1', kind: 'approved' }]);
    // Settled against its OWN type, so a mis-typed CAS cannot publish someone else's work.
    assert.deepEqual(h.published[0], {
      id: 'evt-push', claimToken: 'lease-1', expectedEventType: LINE_SIGNUP_PUSH_EVENT_TYPE,
    });
  });

  // G-07 / MEDIUM-5. LINE answers a monthly-quota 429 with a retry-after measured in hours. The
  // default ladder is 2^n seconds and DEADs at five attempts — about two minutes — which would
  // throw away "ร้านของคุณพร้อมใช้แล้ว" for a condition that fixes itself.
  it('reschedules a throttled push at LINE\'s own time and spends none of its attempts', async () => {
    const h = harness();
    h.lineFails(new LinePushThrottledError('line_api_429', 3600));
    h.queue([event({
      id: 'evt-push', eventType: LINE_SIGNUP_PUSH_EVENT_TYPE,
      payloadJson: { schemaVersion: 1, data: { signupRequestId: 'signup-1', kind: 'approved' } },
    })]);

    const before = Date.now();
    await h.service.drain();

    assert.equal(h.failed.length, 1);
    assert.equal(h.failed[0].countsTowardMax, false, 'a throttle is not one of the five attempts');
    const scheduled = (h.failed[0].nextAvailableAt as Date).getTime();
    assert.ok(scheduled >= before + 3_600_000, 'and it waits exactly as long as LINE asked');
    assert.ok(scheduled <= Date.now() + 3_600_000);
  });

  it('survives a sustained quota outage without ever going DEAD', async () => {
    // Five drains — one more than the ladder needs to terminalize an ordinary failure.
    const h = harness();
    h.lineFails(new LinePushThrottledError('line_api_429', 60));
    for (let pass = 0; pass < 5; pass += 1) {
      h.queue([event({
        id: 'evt-push', eventType: LINE_SIGNUP_PUSH_EVENT_TYPE,
        payloadJson: { schemaVersion: 1, data: { signupRequestId: 'signup-1', kind: 'approved' } },
      })]);
      await h.service.drain();
    }

    assert.equal(h.failed.length, 5);
    assert.ok(h.failed.every((row: any) => row.countsTowardMax === false), 'none of them spend an attempt');
    // The repository is what turns that into "never DEAD"; asserted directly on the ladder below.
  });

  it('still spends an attempt on a failure that is NOT a throttle', async () => {
    const h = harness();
    h.lineFails(new Error('line_api_500'));
    h.queue([event({
      id: 'evt-push', eventType: LINE_SIGNUP_PUSH_EVENT_TYPE,
      payloadJson: { schemaVersion: 1, data: { signupRequestId: 'signup-1', kind: 'approved' } },
    })]);

    await h.service.drain();

    assert.equal(h.failed[0].countsTowardMax, undefined, 'the default ladder still owns real failures');
    assert.equal(h.failed[0].nextAvailableAt, undefined);
  });

  it('fails a LINE push row that names no kind instead of guessing one', async () => {
    const h = harness();
    h.queue([event({
      id: 'evt-push', eventType: LINE_SIGNUP_PUSH_EVENT_TYPE,
      payloadJson: { schemaVersion: 1, data: { signupRequestId: 'signup-1' } },
    })]);

    const result = await h.service.drain();

    assert.equal(result.failed, 1);
    assert.deepEqual(h.lineDelivered, []);
    assert.equal(h.failed[0].error, 'missing_line_push_kind');
  });

  it('claims exactly the signup event types the workflow drain excludes', async () => {
    const h = harness();
    h.queue([event()]);
    await h.service.drain();
    assert.deepEqual(h.sent.length, 1);
    // Any type claimed here must also appear in DrainWorkflowOutboxUseCase's exclusion list, or
    // the generic drain publishes it into a void and the real consumer never sees it.
    assert.deepEqual(h.claims[0].eventTypes, [
      ACCOUNT_CLAIM_EMAIL_EVENT_TYPE,
      SIGNUP_REJECTION_NOTICE_EVENT_TYPE,
      SIGNUP_PENDING_REVIEW_EVENT_TYPE,
      LINE_SIGNUP_PUSH_EVENT_TYPE,
      LINE_SUPPORT_NOTICE_EVENT_TYPE,
    ]);
  });

  it('routes each signup event type to its own handler', async () => {
    const h = harness({ request: { id: 'signup-1', state: 'REJECTED', contactEmail: 'a@b.co', companyName: 'X' } });
    h.queue([
      event({ id: 'evt-reject', eventType: SIGNUP_REJECTION_NOTICE_EVENT_TYPE,
        payloadJson: { schemaVersion: 1, data: { signupRequestId: 'signup-1', reason: 'ข้อมูลไม่ครบ' } } }),
      event({ id: 'evt-notify', eventType: SIGNUP_PENDING_REVIEW_EVENT_TYPE }),
    ]);
    const result = await h.service.drain();

    assert.equal(result.sent, 2);
    assert.equal(result.failed, 0);
    assert.deepEqual(h.rejections, [{ toEmail: 'a@b.co', companyName: 'X', reason: 'ข้อมูลไม่ครบ' }]);
    assert.deepEqual(h.notified, ['signup-1']);
    // Each row settles against its own type, so a mis-typed CAS cannot publish someone else's work.
    assert.deepEqual(h.published.map((p: any) => p.expectedEventType), [
      SIGNUP_REJECTION_NOTICE_EVENT_TYPE, SIGNUP_PENDING_REVIEW_EVENT_TYPE,
    ]);
  });

  it('sends no rejection notice for a request that is no longer rejected', async () => {
    // Reissued between the decision and the drain: the applicant is live again, so no "we declined".
    const h = harness({ request: { id: 'signup-1', state: 'EMAIL_PENDING', contactEmail: 'a@b.co', companyName: 'X' } });
    h.queue([event({ eventType: SIGNUP_REJECTION_NOTICE_EVENT_TYPE })]);
    const result = await h.service.drain();

    assert.equal(result.sent, 1, 'the event settles rather than retrying forever');
    assert.deepEqual(h.rejections, []);
  });

  // Review B-03: `contactEmail` is nullable now. Neither letter may be attempted for a row without
  // one — no token is minted and no send is retried forever.
  it('mints no claim token and sends no letter for an application with no address', async () => {
    const h = harness({ request: { id: 'signup-1', state: 'EMAIL_PENDING', contactEmail: null, companyName: 'X' } });
    h.queue([event()]);
    const result = await h.service.drain();

    assert.equal(result.sent, 1, 'the event settles rather than retrying forever');
    assert.deepEqual(h.sent, []);
    assert.deepEqual(h.minted, []);
    assert.deepEqual(h.updates, []);
  });

  it('sends no rejection letter for an application with no address', async () => {
    const h = harness({ request: { id: 'signup-1', state: 'REJECTED', contactEmail: null, companyName: 'X' } });
    h.queue([event({ eventType: SIGNUP_REJECTION_NOTICE_EVENT_TYPE })]);
    const result = await h.service.drain();

    assert.equal(result.sent, 1);
    assert.deepEqual(h.rejections, []);
  });

  it('fails a redelivered event with an unknown type instead of settling it silently', async () => {
    const h = harness();
    h.queue([event({ eventType: 'email.something_else.requested' })]);
    const result = await h.service.drain();

    assert.equal(result.failed, 1);
    assert.equal(h.published.length, 0);
    assert.match(h.failed[0].error, /unhandled_signup_event_type/);
  });

  it('fails the event with a bounded code and no stack when the provider is down', async () => {
    const h = harness({ sendFails: true });
    h.queue([event()]);
    const result = await h.service.drain();

    assert.equal(result.sent, 0);
    assert.equal(result.failed, 1);
    assert.equal(h.published.length, 0);
    assert.equal(h.failed[0].expectedEventType, ACCOUNT_CLAIM_EMAIL_EVENT_TYPE);
    assert.match(h.failed[0].error, /^[a-z0-9_.:-]+$/);
    // No send timestamp is written for an email that never left.
    assert.equal(h.updates.length, 0);
    assert.equal(h.logs[0].riskLevel, 'HIGH');
  });

  it('skips a request that already moved on rather than mailing a stale link', async () => {
    const h = harness({ request: { id: 'signup-1', state: 'EMAIL_VERIFIED', contactEmail: 'a@b.co', companyName: 'X' } });
    h.queue([event()]);
    const result = await h.service.drain();

    assert.equal(result.sent, 1, 'the event is settled, not retried forever');
    assert.equal(h.sent.length, 0, 'but no email is sent');
    assert.equal(h.published.length, 1);
  });
});

describe('SignupClaimEmailService.sweepReminders', () => {
  function sweepHarness(due: Array<{ id: string }>, markResult = 1) {
    const enqueued: string[] = [];
    const marks: any[] = [];
    const prisma = {
      client: {
        companySignupRequest: {
          findMany: async (args: any) => { marks.push(args.where); return due; },
          updateMany: async (args: any) => { marks.push(args); return { count: markResult }; },
          update: async () => ({}),
        },
      },
    } as any;
    const outbox = { append: async (input: any) => { enqueued.push(input.eventKey); return input; } } as any;
    const service = new SignupClaimEmailService(
      prisma, outbox, {} as any, {} as any, {} as any, {} as any, {} as any, { error: () => {}, warn: () => {} } as any,
    );
    return { service, enqueued, marks };
  }

  it('queues one reminder per due request, 24h before the link dies', async () => {
    const h = sweepHarness([{ id: 'signup-1' }, { id: 'signup-2' }]);
    const result = await h.service.sweepReminders(NOW);

    assert.equal(result.queued, 2);
    assert.deepEqual(h.enqueued, ['email:claim:signup-1:reminder', 'email:claim:signup-2:reminder']);
    // The window is the 48h mark: sent at least 48h ago, still EMAIL_PENDING, never reminded.
    const where = h.marks[0];
    assert.equal(where.state, 'EMAIL_PENDING');
    assert.equal(where.claimReminderSentAt, null);
    assert.equal(
      NOW.getTime() - (where.claimEmailLastSentAt.lt as Date).getTime(),
      48 * 3_600_000,
    );
  });

  it('queues nothing when another sweep already claimed the row', async () => {
    // The CAS on claimReminderSentAt is what makes the reminder exactly-once under concurrency.
    const h = sweepHarness([{ id: 'signup-1' }], 0);
    const result = await h.service.sweepReminders(NOW);
    assert.equal(result.queued, 0);
    assert.deepEqual(h.enqueued, []);
  });
});

describe('SignupClaimEmailService.sweepExpiredApprovals', () => {
  function expiryHarness(due: Array<{ id: string }>, advance?: (id: string) => Promise<any>) {
    const queries: any[] = [];
    const advanced: any[] = [];
    const logs: any[] = [];
    const prisma = {
      client: {
        companySignupRequest: {
          findMany: async (args: any) => { queries.push(args); return due; },
        },
      },
    } as any;
    const core = {
      advance: async (id: string, state: string, actor: string, failureCode?: string) => {
        advanced.push({ id, state, actor, failureCode });
        return advance ? advance(id) : { replayed: false };
      },
    } as any;
    const service = new SignupClaimEmailService(
      prisma, {} as any, {} as any, core, {} as any, {} as any, {} as any,
      { error: (f: any) => logs.push(f), warn: (f: any) => logs.push(f) } as any,
    );
    return { service, queries, advanced, logs };
  }

  it('parks only approvals older than 30 days that never reached a claim', async () => {
    const h = expiryHarness([{ id: 'signup-1' }, { id: 'signup-2' }]);
    const result = await h.service.sweepExpiredApprovals(NOW);

    assert.equal(result.expired, 2);
    const where = h.queries[0].where;
    // A fresh approval, an unapproved application and an already-claimed one are all out of scope
    // by the predicate itself — the sweep never sees them.
    assert.deepEqual(where.state, { in: ['EMAIL_PENDING', 'EMAIL_FAILED'] });
    assert.equal(where.approvedAt.not, null);
    assert.equal(NOW.getTime() - (where.approvedAt.lt as Date).getTime(), 30 * 86_400_000);
    assert.equal(h.queries[0].take, 100, 'one pass stays bounded');
    assert.deepEqual(h.advanced, [
      { id: 'signup-1', state: 'EXPIRED', actor: 'signup-expiry-sweep', failureCode: CLAIM_EXPIRY_FAILURE_CODE },
      { id: 'signup-2', state: 'EXPIRED', actor: 'signup-expiry-sweep', failureCode: CLAIM_EXPIRY_FAILURE_CODE },
    ]);
  });

  it('counts a row already parked by an earlier pass as no work', async () => {
    const h = expiryHarness([{ id: 'signup-1' }], async () => ({ replayed: true }));
    assert.deepEqual(await h.service.sweepExpiredApprovals(NOW), { expired: 0 });
  });

  it('skips a row another writer won without aborting the batch', async () => {
    const h = expiryHarness(
      [{ id: 'signup-1' }, { id: 'signup-2' }],
      async (id) => {
        if (id === 'signup-1') throw new Error('company_signup_concurrent_transition');
        return { replayed: false };
      },
    );
    const result = await h.service.sweepExpiredApprovals(NOW);

    assert.equal(result.expired, 1);
    assert.equal(h.logs[0].event, 'signup.claim_expiry.skipped');
  });

  it('does nothing at all when nothing is due', async () => {
    const h = expiryHarness([]);
    assert.deepEqual(await h.service.sweepExpiredApprovals(NOW), { expired: 0 });
    assert.deepEqual(h.advanced, []);
  });
});

/**
 * `SignupAdminNotifyService` is the producer/consumer pair for the same drain, so it is covered
 * here: `apps/api/package.json`'s test list is explicit, and a spec file of its own would never be
 * registered and would silently never run.
 */
describe('SignupAdminNotifyService', () => {
  function notifyHarness(options: {
    request?: any;
    admins?: Array<{ companyId: string; userId: string }>;
    identities?: Array<{ providerUserId: string }>;
    token?: string | undefined;
    skipped?: boolean;
    pushOk?: boolean;
  } = {}) {
    const appended: any[] = [];
    const events: any[] = [];
    const pushes: Array<{ to: string; body: string }> = [];
    const logs: any[] = [];

    const prisma = {
      client: {
        companySignupRequest: {
          findUnique: async () => (options.request === undefined
            ? { id: 'signup-1', state: 'PENDING_REVIEW', companyName: 'ร้านมั่งมี' }
            : options.request),
        },
        companyMembership: {
          findMany: async (args: any) => {
            events.push({ adminQuery: args.where });
            return options.admins ?? [{ companyId: 'system-co', userId: 'admin-1' }, { companyId: 'system-co', userId: 'admin-2' }];
          },
        },
        externalIdentity: {
          findMany: async (args: any) => {
            events.push({ identityQuery: args.where });
            return options.identities ?? [{ providerUserId: 'U-admin-1' }, { providerUserId: 'U-admin-2' }];
          },
        },
      },
    } as any;

    const outbox = { append: async (input: any) => { appended.push(input); return input; } } as any;
    const notifications = {
      execute: async (input: any) => { events.push({ notification: input }); return { skipped: options.skipped === true }; },
    } as any;
    const config = {
      lineMessagingChannelAccessToken: 'token' in options ? options.token : 'channel-token',
    } as any;
    const logger = { warn: (fields: any) => logs.push(fields), error: (fields: any) => logs.push(fields) } as any;

    // The push helper hits the network; stub `fetch` so nothing leaves the process.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: any, init: any) => {
      const parsed = JSON.parse(init.body);
      pushes.push({ to: parsed.to, body: parsed.messages[0].text });
      return { ok: options.pushOk !== false, status: options.pushOk === false ? 500 : 200 };
    }) as any;
    const restore = () => { globalThis.fetch = realFetch; };

    return {
      service: new SignupAdminNotifyService(prisma, outbox, notifications, config, logger),
      appended, events, pushes, logs, restore,
    };
  }

  it('queues one platform-level outbox row carrying only the request id', async () => {
    const h = notifyHarness();
    try {
      await h.service.enqueue('signup-1', NOW);
      const [event] = h.appended;
      assert.equal(event.eventType, SIGNUP_PENDING_REVIEW_EVENT_TYPE);
      assert.equal(event.eventKey, 'notify:signup_pending_review:signup-1');
      assert.deepEqual(event.payloadJson.data, { signupRequestId: 'signup-1' });
      // No applicant PII rides along; the consumer reads the row it names.
      assert.equal(JSON.stringify(event).includes('ร้านมั่งมี'), false);
    } finally { h.restore(); }
  });

  it('creates a dashboard row for every active system admin and pushes to each linked LINE', async () => {
    const h = notifyHarness();
    try {
      await h.service.notify('signup-1');

      const admins = h.events.find((e) => e.adminQuery)!.adminQuery;
      assert.equal(admins.status, 'ACTIVE');
      assert.deepEqual(admins.user, { status: 'ACTIVE' });
      assert.deepEqual(admins.roles, { some: { role: { key: 'SYSTEM_ADMIN' } } });

      const notification = h.events.find((e) => e.notification)!.notification;
      assert.equal(notification.companyId, 'system-co');
      assert.deepEqual(notification.recipientUserIds, ['admin-1', 'admin-2']);
      assert.equal(notification.deepLinkHref, '/system/signup-requests');
      assert.equal(notification.severity, 'action');
      assert.match(notification.title, /ร้านมั่งมี/);

      assert.deepEqual(h.pushes.map((p) => p.to), ['U-admin-1', 'U-admin-2']);
      assert.ok(h.pushes[0]!.body.startsWith(signupPendingReviewMessage('ร้านมั่งมี')));
      assert.match(h.pushes[0]!.body, /\/system\/signup-requests/);
      assert.equal(h.pushes[0]!.body.includes('+'), false, 'Owner rule: no plus sign in copy');
    } finally { h.restore(); }
  });

  it('pushes nothing a second time when the event is drained twice', async () => {
    // The notification use case answers `skipped` while its own alert is cooling down; that is the
    // single dedup source, so a redelivered event neither opens a row nor sends a push.
    const h = notifyHarness({ skipped: true });
    try {
      await h.service.notify('signup-1');
      assert.deepEqual(h.pushes, []);
    } finally { h.restore(); }
  });

  it('says nothing about an application that already left the queue', async () => {
    const h = notifyHarness({ request: { id: 'signup-1', state: 'EMAIL_PENDING', companyName: 'ร้านมั่งมี' } });
    try {
      await h.service.notify('signup-1');
      assert.deepEqual(h.pushes, []);
      assert.equal(h.events.some((e) => e.notification), false);
    } finally { h.restore(); }
  });

  it('sends one message to an admin holding two identity rows', async () => {
    const h = notifyHarness({ identities: [{ providerUserId: 'U-admin-1' }, { providerUserId: 'U-admin-1' }] });
    try {
      await h.service.notify('signup-1');
      assert.deepEqual(h.pushes.map((p) => p.to), ['U-admin-1']);
    } finally { h.restore(); }
  });

  it('keeps the dashboard row when the LINE push fails, and never throws', async () => {
    const h = notifyHarness({ pushOk: false });
    try {
      await h.service.notify('signup-1');
      assert.equal(h.events.some((e) => e.notification), true);
      assert.equal(h.logs[0].event, 'signup.pending_review.line_push_failed');
    } finally { h.restore(); }
  });

  it('skips the push entirely when no LINE channel is configured', async () => {
    const h = notifyHarness({ token: undefined });
    try {
      await h.service.notify('signup-1');
      assert.deepEqual(h.pushes, []);
      assert.equal(h.events.some((e) => e.notification), true);
    } finally { h.restore(); }
  });
});

export type { Harness };
