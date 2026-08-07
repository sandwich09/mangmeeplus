import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LAUNCH_SHADOW_READ_FAILED_EVENT, LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { DrainLineLedgerUseCase } from './drain-line-ledger.use-case';
import { REFUSAL_MESSAGES } from '../../domain/logic/line-ai-formatter.logic';
import { LineAiLedgerInternalController } from '../../presentation/http/line-ai-ledger-internal.controller';
import { ledgerKey, type LedgerEntry } from '../line-ai-ledger.service';

const NOW = new Date('2026-07-07T10:00:00.000Z');

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: '1-0',
    key: ledgerKey('c1', 'chat1'),
    companyId: 'c1',
    chatKey: 'chat1',
    kind: 'sub_request',
    turnId: 't1',
    webhookEventId: 'evt1',
    userId: 'u1',
    text: 'ยอดค้างซัพพลายเออร์',
    state: 'pending',
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function makeUseCase(opts: {
  claims?: Array<{ entry: LedgerEntry; deliveryCount: number; idleMs: number }>;
  enabled?: boolean;
  permissions?: string[];
  userStatus?: string | null;
  entitlements?: Array<{ featureKey: string; enabled: boolean }>;
  turnFn?: (req: any) => any;
  pushResult?: 'ok' | 'failed_token' | 'failed_other' | 'skipped';
} = {}) {
  const acks: Array<{ id: string; outcome: string }> = [];
  const ackReasons: Array<unknown> = [];
  const pushes: Array<{ to: string; message: any; text: string }> = [];
  const turnRequests: any[] = [];
  const aiTurnUpdates: any[] = [];
  const eventUpdates: any[] = [];
  const ledger = {
    enabled: opts.enabled ?? true,
    claimOpenEntries: async () => opts.claims ?? [],
    ack: async (e: { id: string }, outcome: string, metadata?: Record<string, unknown>) => {
      acks.push({ id: e.id, outcome });
      ackReasons.push(metadata?.reason);
    },
  } as any;
  const prisma = {
    client: {
      user: { findUnique: async () => (opts.userStatus === null ? null : { status: opts.userStatus ?? 'ACTIVE' }) },
      // The entitlement re-read the drain does at execution time. Default: the family is ON.
      companyFeatureEntitlement: {
        findMany: async () => opts.entitlements ?? [{ featureKey: 'ai_line_assistant', enabled: true }],
      },
      aiTurn: { updateMany: async (args: any) => { aiTurnUpdates.push(args); return { count: 1 }; } },
      lineWebhookEventLog: { updateMany: async (args: any) => { eventUpdates.push(args); return { count: 1 }; } },
    },
  } as any;
  const config = { lineAiLedgerClaimMinIdleMs: 1000, lineAiLedgerDeliveryCap: 3, webBaseUrl: 'https://web.test' } as any;
  const permissionResolver = {
    resolveAccess: async () => ({
      membershipId: 'm1',
      roles: ['owner'],
      permissions: opts.permissions ?? ['line.ai.query'],
      scopes: { branchIds: undefined },
    }),
  } as any;
  const aiGateway = {
    requestLineTurn: async (req: any) => {
      turnRequests.push(req);
      if (opts.turnFn) return opts.turnFn(req);
      return {
        requestId: req.requestId, replyText: 'ยอดค้าง 5,000 บาท', sourceRefs: [], sourceLabels: [], webLinks: [],
        intent: 'read_summary', agent: 'accounting', refused: false, toolsInvoked: ['procurement.get_ap_outstanding'], durationMs: 5,
      };
    },
  } as any;
  const lineReply = {
    buildTextMessage: (text: string) => ({ type: 'text', text }),
    sendPush: async (to: string, messages: any[]) => {
      pushes.push({ to, message: messages[0], text: messages[0]?.text ?? messages[0]?.altText ?? '' });
      return opts.pushResult ?? 'ok';
    },
  } as any;
  // SHADOW (piece 5): the drain records one `ai_line_assistant` observation per claimed entry,
  // independently of the entitlement gate below it (the counter measures the whole claimed set).
  const shadowRecords: any[] = [];
  const shadowFlushes: string[] = [];
  const shadow = {
    startSweep: (surface: string) => ({
      record: async (companyId: string | null, featureKey: string | null) => {
        shadowRecords.push({ surface, companyId, featureKey });
        return { wouldBlock: false, reason: 'available' as const };
      },
      flush: async () => { shadowFlushes.push(surface); return {}; },
    }),
  } as any;
  const useCase = new DrainLineLedgerUseCase(prisma, config, permissionResolver, ledger, aiGateway, lineReply, shadow);
  return { useCase, acks, ackReasons, pushes, turnRequests, aiTurnUpdates, eventUpdates, shadowRecords, shadowFlushes };
}

describe('DrainLineLedgerUseCase (item 10F)', () => {
  it('reports skipped when the ledger is disabled (fail-open)', async () => {
    const { useCase } = makeUseCase({ enabled: false });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.skipped, true);
    assert.equal(result.claimed, 0);
  });

  it('follows up a pending sub_request: re-resolves permissions, runs the turn, pushes, acks', async () => {
    const candidates = { amounts: [{ span: 'หกสิบ', value: '60' }], dates: [] };
    const { useCase, acks, pushes, turnRequests } = makeUseCase({
      claims: [{ entry: entry({ valueCandidates: candidates as never }), deliveryCount: 2, idleMs: 5000 }],
    });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.followedUp, 1);
    assert.equal(turnRequests[0].messageText, 'ยอดค้างซัพพลายเออร์');
    assert.deepEqual(turnRequests[0].valueCandidates, candidates);
    assert.equal(turnRequests[0].userContext.lineUserId, '[REDACTED]');
    assert.equal(pushes[0].to, 'chat1', 'push lands in the source chat');
    assert.ok(pushes[0].text.includes('5,000'));
    assert.deepEqual(acks, [{ id: '1-0', outcome: 'followed_up' }]);
  });

  it('preserves a structured answer card when replaying by push', async () => {
    const { useCase, pushes } = makeUseCase({
      claims: [{ entry: entry(), deliveryCount: 1, idleMs: 5000 }],
      turnFn: (req) => ({
        requestId: req.requestId, replyText: 'ยอดค้าง 5,000 บาท', sourceRefs: [], sourceLabels: [], webLinks: [],
        intent: 'read_summary', agent: 'accounting', refused: false, toolsInvoked: ['procurement.get_summary'], durationMs: 5,
        presentation: { kind: 'answer_cards', cards: [{
          title: 'ยอดค้าง', text: 'ยอดค้าง 5,000 บาท',
          webLink: { label: 'เปิดดู', path: '/companies/c1/procurement' },
        }] },
      }),
    });
    await useCase.execute(20, NOW);
    assert.equal(pushes[0]?.message.type, 'flex');
    assert.match(JSON.stringify(pushes[0]?.message), /https:\/\/web\.test\/companies\/c1\/procurement/);
  });

  it('expires a waiting_user entry past the clarify window and leaves fresh ones untouched', async () => {
    const waiting = entry({ id: '2-0', state: 'waiting_user', clarifyQuestion: 'ปีไหน?' });
    const { useCase, acks, pushes } = makeUseCase({
      claims: [
        { entry: { ...waiting, createdAt: new Date(NOW.getTime() - 20 * 60_000).toISOString() }, deliveryCount: 1, idleMs: 5000 },
        { entry: { ...waiting, id: '3-0' }, deliveryCount: 1, idleMs: 5000 },
      ],
    });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.expired, 1);
    assert.deepEqual(acks, [{ id: '2-0', outcome: 'clarify_expired' }], 'in-window entry stays open');
    assert.equal(pushes.length, 0, 'expiry is silent — no nagging push');
  });

  it('parks an entry past the delivery cap instead of looping (poison protection)', async () => {
    const { useCase, acks, turnRequests } = makeUseCase({
      claims: [{ entry: entry(), deliveryCount: 4, idleMs: 5000 }],
    });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.parked, 1);
    assert.equal(turnRequests.length, 0, 'parked entries never reach the gateway');
    assert.deepEqual(acks, [{ id: '1-0', outcome: 'parked' }]);
  });

  // Freeze in place (owner decision 2026-08-04): `ai_line_assistant` can now really be switched off
  // post-onboarding. `line.ai.query` lives in the UNGATED core pack, so the permission re-resolution
  // below would still accept this entry — the entitlement has to be re-read separately.
  it('refuses an in-flight entry when ai_line_assistant was disabled after the turn was deferred', async () => {
    const { useCase, acks, ackReasons, pushes, turnRequests } = makeUseCase({
      claims: [{ entry: entry(), deliveryCount: 1, idleMs: 5000 }],
      entitlements: [{ featureKey: 'ai_line_assistant', enabled: false }, { featureKey: 'crm', enabled: true }],
    });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.refused, 1);
    assert.equal(turnRequests.length, 0, 'no AI turn is produced after the cutoff');
    assert.equal(pushes.length, 0, 'a sub_request refusal stays silent — nobody is waiting on it');
    assert.deepEqual(acks, [{ id: '1-0', outcome: 'refused' }], 'terminal — a re-enable must not revive it');
    assert.deepEqual(ackReasons, ['feature_disabled']);
  });

  // The claim delay is min-idle (seconds), not the 15-minute context window, so a refused `turn` is
  // normally still inside it with a real user waiting. Silently dropping it looks like a hang.
  it('tells the waiting user when a still-in-window turn is refused after the cutoff', async () => {
    const disabled = [{ featureKey: 'ai_line_assistant', enabled: false }, { featureKey: 'crm', enabled: true }];
    const inWindow = makeUseCase({
      claims: [{ entry: entry({ kind: 'turn', state: 'pending' }), deliveryCount: 1, idleMs: 5000 }],
      entitlements: disabled,
    });
    const result = await inWindow.useCase.execute(20, NOW);
    assert.equal(result.refused, 1);
    assert.equal(inWindow.turnRequests.length, 0, 'no AI turn is produced after the cutoff');
    assert.equal(inWindow.pushes.length, 1, 'the waiting user gets the refusal, not silence');
    assert.equal(inWindow.pushes[0]?.to, 'chat1');
    assert.equal(inWindow.pushes[0]?.text, REFUSAL_MESSAGES.feature_disabled,
      'the same Thai refusal the synchronous webhook sends');
    assert.deepEqual(inWindow.acks, [{ id: '1-0', outcome: 'refused' }], 'still terminal');
    assert.deepEqual(inWindow.ackReasons, ['feature_disabled']);

    // Past the context window nobody is waiting — an unsolicited push would be pure noise.
    const stale = makeUseCase({
      claims: [{
        entry: entry({
          kind: 'turn',
          state: 'pending',
          createdAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
        }),
        deliveryCount: 1,
        idleMs: 5000,
      }],
      entitlements: disabled,
    });
    assert.equal((await stale.useCase.execute(20, NOW)).refused, 1);
    assert.equal(stale.pushes.length, 0, 'out-of-window turns keep the old silent behaviour');
    assert.deepEqual(stale.acks, [{ id: '1-0', outcome: 'refused' }]);
  });

  it('still runs for a legacy company with no entitlement rows at all (fail-open)', async () => {
    const { useCase, pushes } = makeUseCase({
      claims: [{ entry: entry(), deliveryCount: 1, idleMs: 5000 }],
      entitlements: [],
    });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.followedUp, 1);
    assert.equal(pushes.length, 1);
  });

  it('refuses safely when permission was revoked between turn and follow-up', async () => {
    const { useCase, acks, pushes } = makeUseCase({
      claims: [{ entry: entry(), deliveryCount: 1, idleMs: 5000 }],
      permissions: ['dashboard.read'],
    });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.refused, 1);
    assert.equal(pushes.length, 0, 'no data pushed to a revoked user');
    assert.deepEqual(acks, [{ id: '1-0', outcome: 'refused' }]);
  });

  it('refuses when the user is no longer active', async () => {
    const { useCase, acks } = makeUseCase({
      claims: [{ entry: entry(), deliveryCount: 1, idleMs: 5000 }],
      userStatus: 'SUSPENDED',
    });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.refused, 1);
    assert.equal(acks[0]?.outcome, 'refused');
  });

  it('leaves the entry unacked when the gateway throws (next reclaim retries)', async () => {
    const { useCase, acks } = makeUseCase({
      claims: [{ entry: entry(), deliveryCount: 1, idleMs: 5000 }],
      turnFn: () => { throw new Error('gateway down'); },
    });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.followedUp, 0);
    assert.equal(acks.length, 0, 'no ack without a confirmed outcome');
  });

  it('leaves the entry unacked when LINE push is not confirmed', async () => {
    const { useCase, acks } = makeUseCase({
      claims: [{ entry: entry(), deliveryCount: 1, idleMs: 5000 }],
      pushResult: 'failed_other',
    });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.followedUp, 0);
    assert.equal(acks.length, 0);
  });

  it('re-runs an unacked turn entry after a crash (at-least-once, read-only safe)', async () => {
    const { useCase, acks, pushes, turnRequests, aiTurnUpdates, eventUpdates } = makeUseCase({
      claims: [{ entry: entry({ kind: 'turn', state: 'pending', text: 'ยอดขายวันนี้ กับของใกล้หมด' }), deliveryCount: 2, idleMs: 300000 }],
    });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.followedUp, 1);
    assert.equal(turnRequests[0].webhookEventId, 'evt1', 'original webhookEventId keeps capture idempotency');
    assert.equal(pushes.length, 1, 'the crashed turn is answered by push');
    assert.equal(acks[0]?.outcome, 'followed_up');
    assert.deepEqual(aiTurnUpdates[0].where.status.in, ['PROCESSING', 'ERROR']);
    assert.deepEqual(eventUpdates[0].where.status.in, ['processing', 'response_ready', 'delivery_pending']);
    assert.equal(eventUpdates[0].data.status, 'completed');
  });
});

describe('LineAiLedgerInternalController auth', () => {
  it('rejects a missing/wrong worker token with 401', async () => {
    process.env['WORKER_INTERNAL_TOKEN'] = 'secret-token';
    const controller = new LineAiLedgerInternalController(
      { execute: async () => ({ claimed: 0 }) } as any,
      { execute: async () => ({ replayed: 0 }) } as any,
    );
    assert.throws(() => controller.drainLedger(undefined, {}), /Invalid worker token/);
    assert.throws(() => controller.drainLedger('wrong', {}), /Invalid worker token/);
    assert.throws(() => controller.sweepOrphanEvents(undefined, {}), /Invalid worker token/);
    assert.throws(() => controller.sweepOrphanEvents('wrong', {}), /Invalid worker token/);
    const ok = await controller.drainLedger('secret-token', { batchSize: 5 });
    assert.deepEqual(ok, { claimed: 0 });
    assert.deepEqual(await controller.sweepOrphanEvents('secret-token', { batchSize: 5 }), { replayed: 0 });
    delete process.env['WORKER_INTERNAL_TOKEN'];
  });

  it('rejects everything when no token is configured (fail closed)', () => {
    delete process.env['WORKER_INTERNAL_TOKEN'];
    const controller = new LineAiLedgerInternalController(
      { execute: async () => ({}) } as any,
      { execute: async () => ({}) } as any,
    );
    assert.throws(() => controller.drainLedger('anything', {}), /Invalid worker token/);
    assert.throws(() => controller.sweepOrphanEvents('anything', {}), /Invalid worker token/);
  });
});

/**
 * Shadow coverage for the AI ledger drain (piece 5).
 *
 * F0 async inventory §5d names this path as the entitlement bypass: it re-resolves permissions, but
 * `line.ai.query` lives in the ungated `pack.core.basics`, so `ai_line_assistant = false` never
 * strips it and queued entries keep pushing AI answers after the feature is disabled.
 */
describe('DrainLineLedgerUseCase shadow coverage (piece 5)', () => {
  it('records one observation per claimed entry and follows up regardless', async () => {
    const { useCase, shadowRecords, shadowFlushes, acks } = makeUseCase({
      claims: [
        { entry: entry(), deliveryCount: 1, idleMs: 5000 },
        { entry: entry({ id: '1-1', companyId: 'c2', key: ledgerKey('c2', 'chat2'), chatKey: 'chat2' }), deliveryCount: 1, idleMs: 5000 },
      ],
    });

    const result = await useCase.execute(20, NOW);

    assert.deepEqual(shadowRecords, [
      { surface: 'ai.ledger.drain', companyId: 'c1', featureKey: 'ai_line_assistant' },
      { surface: 'ai.ledger.drain', companyId: 'c2', featureKey: 'ai_line_assistant' },
    ]);
    assert.deepEqual(shadowFlushes, ['ai.ledger.drain']);
    // SHADOW ONLY: both entries still drain.
    assert.equal(result.claimed, 2);
    assert.equal(acks.length, 2);
  });

  it('records an entry whose follow-up fails — the failure is caught per entry, the count is not', async () => {
    const { useCase, shadowRecords, shadowFlushes } = makeUseCase({
      claims: [{ entry: entry(), deliveryCount: 1, idleMs: 5000 }],
      turnFn: () => { throw new Error('gateway down'); },
    });

    const result = await useCase.execute(20, NOW);

    assert.equal(shadowRecords.length, 1);
    assert.deepEqual(shadowFlushes, ['ai.ledger.drain']);
    assert.equal(result.claimed, 1);
    assert.equal(result.followedUp, 0);
  });

  it('does not start a sweep at all when the ledger is disabled', async () => {
    const { useCase, shadowRecords, shadowFlushes } = makeUseCase({ enabled: false });
    await useCase.execute(20, NOW);
    // The early return precedes the sweep: no work happened, so there is nothing to attest to.
    assert.deepEqual(shadowRecords, []);
    assert.deepEqual(shadowFlushes, []);
  });
});

describe('DrainLineLedgerUseCase finally-flush (mutation-proved)', () => {
  /**
   * STRUCTURAL guard. The double is NOT a stand-in for `LaunchShadowProbe`, which cannot throw
   * (see `launch-shadow.probe.spec.ts`); it stands for ANY future escape from inside the loop,
   * whose per-entry try/catch wraps `processEntry` only. Move `await sweep.flush()` out of the
   * `finally` and this fails.
   */
  it('flushes on any escape from inside the drain loop', async () => {
    const flushed: string[] = [];
    const escapingDouble = {
      startSweep: (surface: string) => ({
        record: async (companyId: string) => {
          if (companyId === 'c2') throw new Error('hypothetical escape');
          return { wouldBlock: false, reason: 'available' as const };
        },
        flush: async () => { flushed.push(surface); return {}; },
      }),
    } as any;
    const base = makeUseCase({
      claims: [
        { entry: entry(), deliveryCount: 1, idleMs: 5000 },
        { entry: entry({ id: '1-1', companyId: 'c2', key: ledgerKey('c2', 'chat2'), chatKey: 'chat2' }), deliveryCount: 1, idleMs: 5000 },
      ],
    });
    (base.useCase as any).shadow = escapingDouble;

    await assert.rejects(() => base.useCase.execute(20, NOW), /hypothetical escape/);
    assert.deepEqual(flushed, ['ai.ledger.drain']);
  });

  /**
   * THE CONTRACT (codex r23 F1). With the REAL probe, a launch-table read failure must not stop the
   * ledger from draining. The MEASUREMENT is what must not change behaviour; the drain's own
   * entitlement gate (`lineAssistantDisabled`, asserted above) is a separate, enforcing read.
   */
  it('drains every claimed entry when the real probe cannot read the launch tables', async () => {
    const warns: any[] = [];
    const prisma = {
      client: {
        featureLaunchGate: { findMany: async () => { throw new Error('read failed for companyId c1-secret'); } },
        companyFeatureEntitlement: { findMany: async () => { throw new Error('read failed for companyId c1-secret'); } },
        featureLaunchObservationBucket: { upsert: async () => { throw new Error('must not be reached'); } },
      },
    } as any;
    const realProbe = new LaunchShadowProbe(prisma, { info: () => {}, warn: (p: any) => warns.push(p), error: () => {} } as any);
    const base = makeUseCase({ claims: [{ entry: entry(), deliveryCount: 1, idleMs: 5000 }] });
    (base.useCase as any).shadow = realProbe;

    const result = await base.useCase.execute(20, NOW);

    assert.equal(result.claimed, 1);
    assert.equal(result.followedUp, 1, 'the follow-up must not depend on the measurement');
    assert.deepEqual(base.acks, [{ id: '1-0', outcome: 'followed_up' }]);
    assert.equal(warns.length, 1);
    assert.equal(warns[0].event, LAUNCH_SHADOW_READ_FAILED_EVENT);
    assert.equal(JSON.stringify(warns).includes('c1-secret'), false);
  });
});
