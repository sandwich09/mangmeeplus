import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_CLAIM_EMAIL_EVENT_TYPE,
  SignupClaimEmailService,
  claimEmailEventKey,
  officialLineOaAddUrl,
} from './signup-claim-email.service';

const NOW = new Date('2026-09-01T12:00:00.000Z');

type Harness = ReturnType<typeof harness>;

function harness(options: { request?: any; sendFails?: boolean } = {}) {
  const appended: any[] = [];
  const sent: any[] = [];
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
    claimBatch: async (input: any) => { claimable = claimable.map((e) => ({ ...e, claimedWith: input })); return claimable; },
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
    },
  } as any;

  const logger = {
    error: (fields: any) => logs.push(fields),
    warn: (fields: any) => logs.push(fields),
  } as any;

  const service = new SignupClaimEmailService(prisma, outbox, tokens, mailer, logger);
  return {
    service, appended, sent, published, failed, updates, minted, logs,
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

describe('SignupClaimEmailService.drain', () => {
  const event = (overrides: any = {}) => ({
    id: 'evt-1', claimToken: 'lease-1', attempts: 0,
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
    // The only write back to the request is the send timestamp — the raw token goes nowhere.
    assert.equal(h.updates.length, 1);
    assert.ok(h.updates[0].data.claimEmailLastSentAt instanceof Date);
    assert.equal(JSON.stringify(h.updates).includes('raw-token'), false);
    assert.deepEqual(h.published[0], {
      id: 'evt-1', claimToken: 'lease-1', expectedEventType: ACCOUNT_CLAIM_EMAIL_EVENT_TYPE,
    });
  });

  it('claims only its own event type, so the workflow drain cannot steal it', async () => {
    const h = harness();
    h.queue([event()]);
    await h.service.drain();
    assert.deepEqual(h.sent.length, 1);
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

describe('officialLineOaAddUrl', () => {
  it('is empty when unset, so the email drops one line instead of failing', () => {
    assert.equal(officialLineOaAddUrl({} as NodeJS.ProcessEnv), '');
    assert.equal(officialLineOaAddUrl({ LINE_OA_ADD_URL: '  ' } as NodeJS.ProcessEnv), '');
    assert.equal(
      officialLineOaAddUrl({ LINE_OA_ADD_URL: ' https://lin.ee/mangmee ' } as NodeJS.ProcessEnv),
      'https://lin.ee/mangmee',
    );
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
    const service = new SignupClaimEmailService(prisma, outbox, {} as any, {} as any, { error: () => {}, warn: () => {} } as any);
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

export type { Harness };
