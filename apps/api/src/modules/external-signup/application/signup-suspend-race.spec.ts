import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { CompanySignupCoreService } from './company-signup-core.service';
import { SignupAdminQueueUseCase } from './signup-admin-queue.use-case';
import { STALE_PROVISIONING_MS } from '../domain/company-signup.logic';

/**
 * HIGH-2. `suspend()` decided from a row it read OUTSIDE the fence, and the core's own re-check is
 * the transition table — which answers "is PROVISIONING → SUSPENDED a legal edge" (it is, for the
 * stale-with-no-company recovery) and cannot know that THIS row acquired a company since.
 *
 * So the core is REAL here and only the database is faked: the fake runs the caller's transaction
 * body, and `mutateBeforeLock` fires between the use-case's read and the locked read — exactly the
 * window a concurrent provisioning run occupies.
 */
const NOW = new Date('2026-09-05T00:00:00.000Z');
const STALE_START = new Date(NOW.getTime() - STALE_PROVISIONING_MS - 1_000);
const FRESH_START = new Date(NOW.getTime() - 1_000);

const BASE_ROW = {
  id: 'signup-1',
  version: 1,
  state: 'PROVISIONING',
  source: 'line-oa',
  companyName: 'ร้านนิด',
  ownerDisplayName: 'นิด',
  contactEmail: null as string | null,
  companyId: null as string | null,
  ownerUserId: null as string | null,
  autoApproved: false,
  failureCode: null as string | null,
  provisioningAttemptId: 'attempt-1',
  provisioningStartedAt: STALE_START,
  pendingPasswordHash: null as string | null,
};

function harness(options: { row?: Record<string, unknown>; mutateBeforeLock?: Record<string, unknown> } = {}) {
  let row: any = { ...BASE_ROW, ...options.row };
  const audits: any[] = [];
  let locked = false;

  const client: any = {
    $executeRaw: async () => {
      // The advisory lock. Anything a concurrent transaction did lands BEFORE this returns.
      if (!locked && options.mutateBeforeLock) row = { ...row, ...options.mutateBeforeLock };
      locked = true;
      return 1;
    },
    $transaction: async (fn: any) => fn(client),
    companySignupRequest: {
      findUnique: async () => ({ ...row }),
      findUniqueOrThrow: async () => ({ ...row }),
      update: async (args: any) => { row = { ...row, ...args.data }; return { ...row }; },
      updateMany: async (args: any) => {
        const { id, state, version } = args.where;
        if (row.id !== id || row.state !== state || row.version !== version) return { count: 0 };
        const data = { ...args.data };
        if (data.version?.increment) { row.version += data.version.increment; delete data.version; }
        row = { ...row, ...data };
        return { count: 1 };
      },
    },
    auditLog: { create: async (args: any) => { audits.push(args.data); return {}; } },
    outboxEvent: { create: async () => ({}) },
  };

  const prisma = { client } as any;
  const core = new CompanySignupCoreService(prisma);
  const useCase = new SignupAdminQueueUseCase(
    prisma,
    core,
    { revokeAll: async () => 0 } as any,
    {} as any,
    { execute: async () => ({}) } as any,
    { enqueue: async () => undefined } as any,
  );
  return { useCase, audits, row: () => row };
}

const suspend = (h: ReturnType<typeof harness>) =>
  h.useCase.decide('signup-1', { action: 'SUSPEND', version: 1 }, 'admin-1', 'req-1', undefined, NOW);

describe('SUSPEND is decided under the fence, not from a stale snapshot (HIGH-2)', () => {
  it('refuses when the abandoned attempt finished into READY between the two reads', async () => {
    // The outer read still says "stale PROVISIONING, no company" — the one case suspend allows.
    // By the time the lock is held the run has committed a company and moved to READY.
    const h = harness({ mutateBeforeLock: { state: 'READY', companyId: 'co-1', ownerUserId: 'u-1' } });

    await assert.rejects(() => suspend(h), (error: Error) => error instanceof ConflictException
      && /suspend_not_allowed_in_flight/.test(error.message));
    assert.equal(h.row().state, 'READY', 'the shop that exists keeps its open application');
    assert.deepEqual(h.audits, [], 'and nothing is recorded as suspended');
  });

  it('refuses when the abandoned attempt stamped a company and is still PROVISIONING', async () => {
    const h = harness({ mutateBeforeLock: { companyId: 'co-1' } });

    await assert.rejects(() => suspend(h), /suspend_not_allowed_in_flight/);
    assert.equal(h.row().state, 'PROVISIONING');
  });

  it('refuses when a fresh attempt restarted between the two reads', async () => {
    const h = harness({ mutateBeforeLock: { provisioningStartedAt: FRESH_START } });

    await assert.rejects(() => suspend(h), /suspend_not_allowed_in_flight/);
    assert.equal(h.row().state, 'PROVISIONING');
  });

  // The recovery this exception exists for still works when nothing moved.
  it('suspends an abandoned attempt that really did build nothing', async () => {
    const h = harness();
    const result = await suspend(h);

    assert.deepEqual(result, { requestId: 'signup-1', state: 'SUSPENDED' });
    assert.equal(h.row().state, 'SUSPENDED');
    assert.equal(h.row().failureCode, 'admin_suspended');
  });

  // READY is refused from the FIRST read too, not only as a race: the shop exists and the
  // application has not closed, so suspending strands it and frees the LINE account to re-apply.
  it('never suspends a READY row, race or no race', async () => {
    const h = harness({ row: { state: 'READY', companyId: 'co-1' } });
    await assert.rejects(() => suspend(h), /suspend_not_allowed_in_flight/);
    assert.equal(h.row().state, 'READY');
  });

  it('still suspends the settled COMPLETED row §3.7 is about', async () => {
    const h = harness({ row: { state: 'COMPLETED', companyId: 'co-1', autoApproved: true } });
    const result = await suspend(h);

    assert.equal(result.state, 'SUSPENDED');
    assert.equal(h.audits.some((a) => a.action === 'signup.line.suspended'), true);
  });
});
