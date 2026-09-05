/**
 * Review F13. The applicant-facing half of F7 had no cover at all: nothing asserted that a resend
 * near the end of the activation window is refused rather than answered with a link that dies
 * between the inbox and the tap. A self-serve resend deliberately does NOT restart the window —
 * that is what makes it self-serve — so late in the window the honest answer is "ask an operator",
 * whose reissue has no age limit and does restart the clock.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PublicSignupStatusUseCase } from './public-signup-status.use-case';
import { CLAIM_EXPIRY_AFTER_APPROVAL_DAYS } from '../domain/account-claim.logic';

const NOW = new Date('2026-09-06T00:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const DAY_MS = 86_400_000;
const WINDOW_MS = CLAIM_EXPIRY_AFTER_APPROVAL_DAYS * DAY_MS;

function harness(request: Record<string, unknown> | null) {
  const updates: any[] = [];
  const advances: any[] = [];
  const enqueued: any[] = [];
  const prisma = {
    client: {
      companySignupRequest: {
        findUnique: async () => request,
        update: async (args: any) => { updates.push(args); return {}; },
      },
    },
  } as any;
  const core = { advance: async (id: string, state: string) => { advances.push({ id, state }); return {}; } } as any;
  const claimEmail = { enqueue: async (id: string, reason: string) => { enqueued.push({ id, reason }); } } as any;
  return {
    useCase: new PublicSignupStatusUseCase(prisma, core, claimEmail),
    updates, advances, enqueued,
  };
}

const approved = (overrides: Record<string, unknown> = {}) => ({
  id: 'signup-1',
  state: 'EMAIL_PENDING',
  approvedAt: ago(DAY_MS),
  claimWindowStartedAt: ago(DAY_MS),
  ...overrides,
});

describe('PublicSignupStatusUseCase.status', () => {
  it('answers the coarse state and nothing about the applicant', async () => {
    const h = harness(approved());
    const status = await h.useCase.status('signup-1', NOW);

    assert.deepEqual(status, { requestId: 'signup-1', status: 'AWAITING_CLAIM', canResendClaim: true });
  });

  it('404s an unknown id', async () => {
    const h = harness(null);
    await assert.rejects(() => h.useCase.status('nope', NOW), NotFoundException);
  });
});

describe('PublicSignupStatusUseCase.resendClaim', () => {
  it('queues a fresh link while the window has room for one', async () => {
    const h = harness(approved());

    await h.useCase.resendClaim('signup-1', 'req-1', NOW);

    assert.deepEqual(h.enqueued, [{ id: 'signup-1', reason: 'resend' }]);
    // A fresh link earns a fresh reminder, and the window is NOT restarted by a self-serve resend.
    assert.equal(h.updates[0].data.claimReminderSentAt, null);
    assert.equal('claimWindowStartedAt' in h.updates[0].data, false, 'self-serve must not extend itself');
  });

  it('refuses when under an hour of the window is left, and sends nothing (F7)', async () => {
    const h = harness(approved({
      approvedAt: ago(WINDOW_MS - 59 * 60_000),
      claimWindowStartedAt: ago(WINDOW_MS - 59 * 60_000),
    }));

    await assert.rejects(
      () => h.useCase.resendClaim('signup-1', 'req-1', NOW),
      (error: unknown) => error instanceof ConflictException
        && (error as ConflictException).message === 'claim_window_almost_over',
    );
    assert.deepEqual(h.enqueued, [], 'a link that would die in the inbox must not be sent');
    assert.deepEqual(h.updates, []);
  });

  it('still sends with just over an hour left', async () => {
    const h = harness(approved({
      approvedAt: ago(WINDOW_MS - 61 * 60_000),
      claimWindowStartedAt: ago(WINDOW_MS - 61 * 60_000),
    }));

    await h.useCase.resendClaim('signup-1', 'req-1', NOW);

    assert.deepEqual(h.enqueued, [{ id: 'signup-1', reason: 'resend' }]);
  });

  it('reads the reissue-restarted window, not the approval date', async () => {
    // Approved 40 days ago and reissued yesterday: measuring from `approvedAt` would refuse this.
    const h = harness(approved({ approvedAt: ago(40 * DAY_MS), claimWindowStartedAt: ago(DAY_MS) }));

    await h.useCase.resendClaim('signup-1', 'req-1', NOW);

    assert.deepEqual(h.enqueued, [{ id: 'signup-1', reason: 'resend' }]);
  });

  it('refuses outright once the request is past its self-serve window', async () => {
    const h = harness(approved({
      state: 'EXPIRED',
      approvedAt: ago(40 * DAY_MS),
      claimWindowStartedAt: ago(40 * DAY_MS),
    }));

    await assert.rejects(
      () => h.useCase.resendClaim('signup-1', 'req-1', NOW),
      (error: unknown) => error instanceof ConflictException
        && (error as ConflictException).message === 'claim_resend_not_available',
    );
    assert.deepEqual(h.enqueued, []);
  });

  it('walks an expired-but-revivable request back to EMAIL_PENDING before sending', async () => {
    const h = harness(approved({ state: 'EXPIRED', approvedAt: ago(DAY_MS), claimWindowStartedAt: ago(DAY_MS) }));

    await h.useCase.resendClaim('signup-1', 'req-1', NOW);

    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'EMAIL_PENDING' }]);
    assert.deepEqual(h.enqueued, [{ id: 'signup-1', reason: 'resend' }]);
  });
});
