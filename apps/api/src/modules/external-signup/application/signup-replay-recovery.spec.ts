import { lineMessagingCredentialsFixture } from '../../../common/config/line-messaging-credentials.fixture';
/**
 * Review R08/R09. Both are "the answer was success and the work was not done": a submit replay that
 * short-circuits on any non-RECEIVED state, an approve that writes state, approval metadata and the
 * claim email as three separate writes, and a reissue that restarts nothing the 30-day sweep reads.
 *
 * The outbox fake below implements the ONE thing that makes "exactly one email" true — dedupe on
 * `eventKey` — so these run the REAL `SignupClaimEmailService` and `SignupAdminNotifyService` key
 * builders rather than asserting against a spy that cannot tell a repair from a duplicate.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SubmitCompanySignupUseCase } from './submit-company-signup.use-case';
import { SignupAdminQueueUseCase } from './signup-admin-queue.use-case';
import { SignupClaimEmailService, ACCOUNT_CLAIM_EMAIL_EVENT_TYPE } from './signup-claim-email.service';
import { SignupAdminNotifyService, SIGNUP_PENDING_REVIEW_EVENT_TYPE } from './signup-admin-notify.service';
import { CLAIM_EXPIRY_AFTER_APPROVAL_DAYS } from '../domain/account-claim.logic';
import type { CompanySignupInput } from '../domain/company-signup.logic';

const DAY_MS = 86_400_000;

const INPUT: CompanySignupInput = {
  externalSignupId: '0f9b1d2e-3c4a-4b5c-8d7e-1f2a3b4c5d6e',
  companyName: 'ร้านมั่งมี',
  ownerFirstName: 'สมชาย',
  ownerLastName: 'ใจดี',
  contactEmail: 'somchai@example.com',
  consentVersion: 'v1',
};

/** The real contract of `PrismaOutboxRepository.append`: one row per eventKey, ever. */
function fakeOutbox(options: { failOn?: string } = {}) {
  const rows = new Map<string, { eventType: string; eventKey: string }>();
  return {
    rows,
    of: (eventType: string) => [...rows.values()].filter((row) => row.eventType === eventType),
    repository: {
      append: async (input: { eventType: string; eventKey: string }) => {
        if (options.failOn && input.eventType === options.failOn) throw new Error('outbox_unavailable');
        if (!rows.has(input.eventKey)) rows.set(input.eventKey, { eventType: input.eventType, eventKey: input.eventKey });
        return {};
      },
    } as never,
  };
}

/**
 * A signup row plus the transition semantics the real core guarantees: the state moves under one
 * transaction, extra columns ride the SAME write, and required side effects commit with it.
 */
function fakeCore(row: Record<string, unknown>) {
  const advances: string[] = [];
  return {
    row,
    advances,
    service: {
      receive: async () => ({ request: row, replayed: true }),
      advance: async (
        _id: string,
        toState: string,
        _corr: string,
        _failureCode?: string,
        _expect?: unknown,
        extras?: { data?: Record<string, unknown>; alsoInTransaction?: () => Promise<void> },
      ) => {
        const replayed = row['state'] === toState;
        if (!replayed) {
          advances.push(toState);
          row['state'] = toState;
          Object.assign(row, extras?.data ?? {});
          // Same transaction as the state move: a failure here undoes the move.
          if (extras?.alsoInTransaction) {
            try {
              await extras.alsoInTransaction();
            } catch (error) {
              row['state'] = 'PENDING_REVIEW';
              for (const key of Object.keys(extras.data ?? {})) row[key] = null;
              advances.pop();
              throw error;
            }
          }
        }
        return { request: row, replayed };
      },
    } as never,
  };
}

function submitHarness(row: Record<string, unknown>, outbox: ReturnType<typeof fakeOutbox>) {
  const core = fakeCore(row);
  const prisma = { client: { companySignupRequest: { update: async () => ({}) } } } as never;
  const adminNotify = new SignupAdminNotifyService(lineMessagingCredentialsFixture(null as never),
    prisma, outbox.repository, null as never, null as never, null as never,
  );
  return {
    core,
    useCase: new SubmitCompanySignupUseCase(prisma, core.service, adminNotify, async () => [{ exchange: 'mx' }]),
  };
}

function queueHarness(row: Record<string, unknown>, outbox: ReturnType<typeof fakeOutbox>) {
  const core = fakeCore(row);
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    client: {
      companySignupRequest: {
        findUnique: async () => row,
        update: async (args: { data: Record<string, unknown> }) => { updates.push(args.data); Object.assign(row, args.data); return {}; },
      },
      auditLog: { create: async () => ({}) },
    },
  } as never;
  const claimEmail = new SignupClaimEmailService(
    prisma, outbox.repository, null as never, null as never, null as never,
    null as never, null as never, null as never, null as never,
  );
  return {
    core, updates, claimEmail,
    useCase: new SignupAdminQueueUseCase(
      prisma, core.service, { revokeAll: async () => 0 } as never, claimEmail,
      { execute: async () => ({}) } as never, { enqueue: async () => undefined } as never,
    ),
  };
}

describe('R08 (a): a submit replay resumes instead of reporting success over missing work', () => {
  it('carries a request stranded at VALIDATED into the queue and announces it', async () => {
    const outbox = fakeOutbox();
    const h = submitHarness({ id: 'signup-1', state: 'VALIDATED', contactEmail: INPUT.contactEmail }, outbox);

    await h.useCase.execute(INPUT, 'req-replay');

    assert.deepEqual(h.core.advances, ['PENDING_REVIEW']);
    assert.equal(outbox.of(SIGNUP_PENDING_REVIEW_EVENT_TYPE).length, 1, 'the operators must be told');
  });

  it('repairs an announcement the first attempt failed to queue, exactly once', async () => {
    const outbox = fakeOutbox();
    // The first attempt reached the queue and then died on the outbox append.
    const h = submitHarness({ id: 'signup-1', state: 'PENDING_REVIEW', contactEmail: INPUT.contactEmail }, outbox);

    await h.useCase.execute(INPUT, 'req-replay-1');
    await h.useCase.execute(INPUT, 'req-replay-2');

    assert.equal(outbox.of(SIGNUP_PENDING_REVIEW_EVENT_TYPE).length, 1, 'one announcement, no more, no less');
  });

  it('still leaves a settled application alone', async () => {
    const outbox = fakeOutbox();
    const h = submitHarness({ id: 'signup-1', state: 'EMAIL_PENDING', contactEmail: INPUT.contactEmail }, outbox);

    await h.useCase.execute(INPUT, 'req-late');

    assert.deepEqual(h.core.advances, []);
    assert.equal(outbox.rows.size, 0, 'an approved application must not be re-announced');
  });
});

describe('R08 (b): approve writes the state, its metadata and the email as one unit', () => {
  const APPROVED = {
    id: 'signup-1', state: 'PENDING_REVIEW', source: 'official-site', contactEmail: 'a@b.co',
    taxId: null as string | null, mxValid: true,
    approvedAt: null as Date | null, approvedByUserId: null as string | null,
  };

  it('records the approval on the same write as the state, not as a second update', async () => {
    const outbox = fakeOutbox();
    const row = { ...APPROVED };
    const h = queueHarness(row, outbox);

    await h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-1');

    assert.equal(row.state, 'EMAIL_PENDING');
    assert.ok(row.approvedAt, 'the approval stamp must survive');
    assert.equal(row['approvedByUserId'], 'admin-1');
    assert.deepEqual(
      h.updates.filter((data) => 'approvedAt' in data),
      [],
      'approvedAt must ride the transition, not a separate update that can be lost on its own',
    );
    assert.equal(outbox.of(ACCOUNT_CLAIM_EMAIL_EVENT_TYPE).length, 1);
  });

  it('leaves nothing half-approved when the email cannot be queued', async () => {
    const outbox = fakeOutbox({ failOn: ACCOUNT_CLAIM_EMAIL_EVENT_TYPE });
    const row = { ...APPROVED };
    const h = queueHarness(row, outbox);

    await assert.rejects(() => h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-1'));

    assert.equal(row.state, 'PENDING_REVIEW', 'a failed approve must not leave the applicant waiting on nothing');
    assert.equal(row.approvedAt, null);
  });

  it('a retry after a failed enqueue queues exactly one claim email', async () => {
    const outbox = fakeOutbox();
    // The first approve moved the state and died before the email was queued.
    const row = { ...APPROVED, state: 'EMAIL_PENDING', approvedAt: new Date('2026-09-01T00:00:00.000Z') };
    const h = queueHarness(row, outbox);

    await h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-retry-1');
    await h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-retry-2');

    assert.equal(outbox.of(ACCOUNT_CLAIM_EMAIL_EVENT_TYPE).length, 1);
    assert.equal(row.approvedAt?.toISOString(), '2026-09-01T00:00:00.000Z', 'the original decision time is an audit fact');
  });
});

describe('R09: a reissue restarts the activation window the sweep reads', () => {
  it('keeps a reissued 31-day-old approval alive through the sweep', async () => {
    const outbox = fakeOutbox();
    const now = new Date('2026-09-05T00:00:00.000Z');
    const approvedAt = new Date(now.getTime() - (CLAIM_EXPIRY_AFTER_APPROVAL_DAYS + 1) * DAY_MS);
    const row: Record<string, unknown> = {
      id: 'signup-1', state: 'EMAIL_PENDING', source: 'official-site', contactEmail: 'a@b.co',
      approvedAt, claimWindowStartedAt: approvedAt,
    };
    const h = queueHarness(row, outbox);

    await h.useCase.reissue('signup-1', 'admin-1', 'req-1');

    // The audit fact stays where it was; the clock the sweep reads does not.
    assert.equal((row['approvedAt'] as Date).toISOString(), approvedAt.toISOString());
    const window = row['claimWindowStartedAt'] as Date;
    assert.ok(window.getTime() > approvedAt.getTime(), 'reissue must restart the activation window');

    // The sweep's own predicate, applied to the row it would read.
    const cutoff = new Date(now.getTime() - CLAIM_EXPIRY_AFTER_APPROVAL_DAYS * DAY_MS);
    assert.equal(window < cutoff, false, 'a freshly reissued link must not be expired by the next sweep');
  });
});
