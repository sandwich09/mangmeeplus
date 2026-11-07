import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_AI_EXPENSE_CRITERION_REPLIES } from '@watchdog-bms/contracts';
import { LAUNCH_SHADOW_READ_FAILED_EVENT, LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { DrainLineLedgerUseCase } from './drain-line-ledger.use-case';
import { REFUSAL_MESSAGES } from '../../domain/logic/line-ai-formatter.logic';
import { ASK_PLAN_MANAGER_TH, PLAN_MANAGE_PERMISSION_KEY } from '../../../access-control/domain/logic/plan-manager.logic';
import { LineAiLedgerInternalController } from '../../presentation/http/line-ai-ledger-internal.controller';
import { ledgerKey, type LedgerEntry } from '../line-ai-ledger.service';
import { readLineSystemCard } from '../../domain/logic/line-system-card.fixture';

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
  duringTurn?: () => void;
  pushResult?: 'ok' | 'failed_token' | 'failed_flex' | 'failed_other' | 'skipped';
  /** One result per push, in order; when it runs out, `pushResult` (or 'ok') answers. */
  pushResults?: Array<'ok' | 'failed_flex' | 'failed_other' | 'failed_permanent'>;
} = {}) {
  const acks: Array<{ id: string; outcome: string }> = [];
  const ackReasons: Array<unknown> = [];
  const pushes: Array<{ to: string; message: any; text: string; operationId?: string }> = [];
  const turnRequests: any[] = [];
  const aiTurnUpdates: any[] = [];
  const eventUpdates: any[] = [];
  const identityReads: any[] = [];
  const state = {
    linked: true, userStatus: opts.userStatus === undefined ? 'ACTIVE' : opts.userStatus,
    optedOut: false, selectedCompany: null as string | null, pausedUntil: null as Date | null,
    entitlements: opts.entitlements ?? [{ featureKey: 'ai_line_assistant', enabled: true }],
    access: {
      membershipId: 'm1', roles: ['owner'], permissions: opts.permissions ?? ['line.ai.query'],
      entitlementDeniedPermissions: { 'inventory.report.read': 'inventory' },
      entitledFeatureKeys: ['ai_line_assistant'] as string[] | null | undefined,
      scopes: { branchIds: undefined as string[] | undefined, locationIds: undefined as string[] | undefined },
    },
  };
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
      lineTurnOutcome: { findUnique: async () => null },
      user: { findUnique: async () => (state.userStatus === null ? null : { status: state.userStatus, aiAssistantOptOutAt: state.optedOut ? NOW : null }) },
      externalIdentity: { findFirst: async (args: any) => {
        identityReads.push(args.where);
        return state.linked && state.userStatus === 'ACTIVE' && !state.optedOut ? { id: 'identity1' } : null;
      } },
      lineCompanyContext: { findUnique: async () => ({ companyId: state.selectedCompany, aiPausedUntil: state.pausedUntil }) },
      // The entitlement re-read the drain does at execution time. Default: the family is ON.
      companyFeatureEntitlement: {
        findMany: async () => state.entitlements,
      },
      aiTurn: { updateMany: async (args: any) => { aiTurnUpdates.push(args); return { count: 1 }; } },
      lineWebhookEventLog: { updateMany: async (args: any) => { eventUpdates.push(args); return { count: 1 }; } },
    },
  } as any;
  const config = { lineAiLedgerClaimMinIdleMs: 1000, lineAiLedgerDeliveryCap: 3, webBaseUrl: 'https://web.test' } as any;
  const permissionResolver = {
    resolveAccess: async () => state.access,
  } as any;
  const turnOptions: any[] = [];
  const aiGateway = {
    requestLineTurn: async (req: any, options?: any) => {
      turnRequests.push(req);
      turnOptions.push(options);
      opts.duringTurn?.();
      if (opts.turnFn) return opts.turnFn(req);
      return {
        requestId: req.requestId, replyText: 'ยอดค้าง 5,000 บาท', sourceRefs: [], sourceLabels: [], webLinks: [],
        intent: 'read_summary', agent: 'accounting', refused: false, toolsInvoked: ['procurement.get_ap_outstanding'], durationMs: 5,
      };
    },
  } as any;
  const lineReply = {
    buildTextMessage: (text: string) => ({ type: 'text', text }),
    sendPush: async (to: string, messages: any[], operationId?: string) => {
      pushes.push({ to, message: messages[0], text: messages[0]?.canonicalText ?? messages[0]?.text ?? messages[0]?.altText ?? '', operationId });
      return opts.pushResults?.shift() ?? opts.pushResult ?? 'ok';
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
  (useCase as any).readEvidence = { forTurn: async () => [], verify: async () => true, verifyDelivery: async () => true };
  const deliveryRows = new Map<string, any>();
  (useCase as any).deliveryStore = {
    claim: async (e: LedgerEntry) => {
      const id = JSON.stringify([e.key, e.id]);
      const row = deliveryRows.get(id) ?? { id, status: 'PREPARING' }; deliveryRows.set(id, row);
      return { kind: ['ACCEPTED', 'REFUSED', 'PARKED'].includes(row.status) ? 'terminal' : row.status === 'PREPARING' ? 'prepare' : 'deliver', token: 'synthetic-lease', row };
    },
    save: async (claim: any, messages: any, authorization: any, completion: any) => {
      Object.assign(claim.row, { status: 'READY', messagesJson: messages, authorizationJson: authorization, completionJson: completion }); return true;
    },
    beginSend: async (claim: any) => { claim.row.status = 'UNKNOWN'; return true; },
    finish: async (claim: any, status: string, errorCode: string | null) => { Object.assign(claim.row, { status, errorCode }); return true; },
  };
  // The drain's own logger, so a test can assert what an operator actually sees at level 40.
  const warnings: any[] = [];
  const terminalLogs: any[] = [];
  (useCase as any).logger = { warn: (payload: any) => warnings.push(payload), debug: () => {}, log: (payload: any) => terminalLogs.push(payload), error: () => {} };
  return { useCase, acks, ackReasons, pushes, turnRequests, turnOptions, aiTurnUpdates, eventUpdates, shadowRecords, shadowFlushes, warnings, terminalLogs, state, identityReads, deliveryRows, prisma };
}

describe('v2 ledger never recreates a paid turn from a stale Redis reference', () => {
  it('parks uncovered v2 subrequests without a model call, even beyond the legacy delivery cap', async () => {
    const queued = entry({ reliabilityVersion: 2 });
    const harness = makeUseCase({ claims: [{ entry: queued, deliveryCount: 9, idleMs: 1000 }] });
    const result = await harness.useCase.execute(20, NOW);
    assert.equal(result.parked, 1);
    assert.equal(harness.turnRequests.length, 0);
    assert.equal(harness.pushes.length, 0);
    assert.deepEqual(harness.ackReasons, ['v2_subrequest_requires_new_admission']);
  });
  it('refuses missing authoritative request rather than treating v2 text as a legacy turn', async () => {
    const queued = entry({ kind: 'turn', reliabilityVersion: 2, durableDeliveryId: 'a'.repeat(64) });
    const harness = makeUseCase({ claims: [{ entry: queued, deliveryCount: 1, idleMs: 1000 }] });
    const result = await harness.useCase.execute(20, NOW);
    assert.equal(result.refused, 1);
    assert.equal(harness.turnRequests.length, 0);
    assert.equal(harness.pushes.length, 0);
  });
  it('a saved v2 parent whose child is missing cannot send the legacy sentinel or regenerate', async () => {
    const queued = entry({ kind: 'turn', reliabilityVersion: 2 });
    const harness = makeUseCase({ claims: [{ entry: queued, deliveryCount: 1, idleMs: 1000 }] });
    harness.deliveryRows.set(JSON.stringify([queued.key, queued.id]), { id: 'parent', status: 'READY', messagesJson: [{ type: 'text', text: 'SENTINEL' }],
      completionJson: { deliveryPlanVersion: 2, deliveryPlanId: 'missing' } });
    const result = await harness.useCase.execute(20, NOW);
    assert.equal(result.refused, 1);
    assert.equal(harness.turnRequests.length, 0);
    assert.ok(harness.pushes.every(push => push.text !== 'SENTINEL'));
  });
});

describe('AP22 queued UNKNOWN and accepted recovery', () => {
  it('reuses saved bytes/key after UNKNOWN without another model or handoff', async () => {
    const opts = { claims: [{ entry: entry(), deliveryCount: 1, idleMs: 10_000 }], pushResult: 'failed_other' as 'failed_other' | 'ok' };
    const h = makeUseCase(opts); let wraps = 0;
    (h.useCase as any).handoffLinks = { wrapOutgoingLineContent: async (_actor: unknown, messages: unknown) => { wraps++; return messages; } };
    await h.useCase.execute(20, NOW);
    assert.equal([...h.deliveryRows.values()][0].status, 'UNKNOWN');
    opts.pushResult = 'ok';
    await h.useCase.execute(20, NOW);
    assert.equal(h.turnRequests.length, 1); assert.equal(wraps, 1); assert.equal(h.pushes.length, 2);
    assert.deepEqual(h.pushes[1], h.pushes[0]);
    assert.equal([...h.deliveryRows.values()][0].status, 'ACCEPTED');
  });

  // A refused BODY is the one way a card can lose an answer: the same bytes cannot succeed, the text
  // the card itself declares can. Design lock 2026-10-04: the answer is now a card of the locked design.
  it('re-sends an answer card LINE refuses for its body ONCE, as the text it declares, under a key derived from the first', async () => {
    const h = makeUseCase({ claims: [{ entry: entry(), deliveryCount: 1, idleMs: 10_000 }], pushResults: ['failed_flex', 'ok'] });
    const result = await h.useCase.execute(20, NOW);
    assert.equal(result.followedUp, 1);
    assert.equal(h.turnRequests.length, 1, 'the fallback repeats no model work');
    assert.equal(h.pushes.length, 2);
    const [card, text] = h.pushes;
    assert.equal(card!.message.type, 'flex');
    assert.deepEqual(readLineSystemCard(card!.message).prose, ['ยอดค้าง 5,000 บาท'], 'the answer went out first as the locked card');
    assert.deepEqual(text!.message, { type: 'text', text: card!.message.canonicalText });
    assert.match(text!.message.text, /ยอดค้าง 5,000 บาท/u, 'not one figure of the answer is lost');
    assert.match(card!.operationId ?? '', /^ledger:/u);
    assert.equal(text!.operationId, `${card!.operationId}:text`, 'so a repeat of the fallback is the same request to LINE');
    assert.equal([...h.deliveryRows.values()][0].status, 'ACCEPTED');
    assert.ok(h.warnings.some((entry: any) => entry?.msg === 'line_flex_text_fallback_used'));
  });

  it('sends nothing more when the text is refused too, and treats that result as any failed push', async () => {
    const h = makeUseCase({ claims: [{ entry: entry(), deliveryCount: 1, idleMs: 10_000 }], pushResults: ['failed_flex', 'failed_other'] });
    await h.useCase.execute(20, NOW);
    assert.equal(h.pushes.length, 2, 'one card, one text, never a third attempt in the same pass');
    assert.deepEqual([[...h.deliveryRows.values()][0].status, [...h.deliveryRows.values()][0].errorCode], ['UNKNOWN', 'LINE_PUSH_FAILED_OTHER']);
    // A push that failed for any other reason is not re-sent as text: the card may still arrive.
    const other = makeUseCase({ claims: [{ entry: entry(), deliveryCount: 1, idleMs: 10_000 }], pushResults: ['failed_other'] });
    await other.useCase.execute(20, NOW);
    assert.equal(other.pushes.length, 1);
    assert.equal(other.pushes[0]!.message.type, 'flex');
  });

  it('acceptance survives an ack failure and later access revocation without a new send', async () => {
    const h = makeUseCase({ claims: [{ entry: entry(), deliveryCount: 1, idleMs: 10_000 }] });
    const ledger = (h.useCase as any).ledger, ack = ledger.ack; let first = true;
    ledger.ack = async (...args: any[]) => { if (first) { first = false; throw new Error('synthetic ack loss'); } return ack(...args); };
    await h.useCase.execute(20, NOW); h.state.linked = false;
    const recovered = await h.useCase.execute(20, NOW);
    assert.equal(recovered.followedUp, 1); assert.equal(h.pushes.length, 1); assert.equal(h.turnRequests.length, 1);
  });

  it('a body LINE refuses as a card and again as its text stays terminal with the existing permanent error code', async () => {
    const h = makeUseCase({ claims: [{ entry: entry(), deliveryCount: 1, idleMs: 10_000 }], pushResult: 'failed_flex' });
    await h.useCase.execute(20, NOW);
    assert.deepEqual(h.pushes.map((push) => push.message.type), ['flex', 'text'], 'the card, then its text once');
    assert.equal([...h.deliveryRows.values()][0].status, 'REFUSED');
    assert.equal([...h.deliveryRows.values()][0].errorCode, 'LINE_PUSH_FAILED_PERMANENT');
  });

  it('changed source after UNKNOWN gets a static recovery notice and preserves the original output', async () => {
    const opts = { claims: [{ entry: entry(), deliveryCount: 1, idleMs: 10_000 }], pushResult: 'failed_other' as 'failed_other' | 'ok' };
    const h = makeUseCase(opts); await h.useCase.execute(20, NOW);
    const stored = structuredClone([...h.deliveryRows.values()][0].messagesJson);
    (h.useCase as any).readEvidence.verifyDelivery = async () => false; opts.pushResult = 'ok';
    await h.useCase.execute(20, NOW); await h.useCase.execute(20, NOW);
    assert.equal(h.turnRequests.length, 1); assert.equal(h.pushes.length, 2);
    assert.match(h.pushes[1].text, /กรุณาเปิดเว็บ/); assert.doesNotMatch(h.pushes[1].text, /5,000/);
    assert.deepEqual([...h.deliveryRows.values()][0].messagesJson, stored);
    assert.equal([...h.deliveryRows.values()][0].status, 'REFUSED');
  });

  for (const accepted of [false, true]) it(`existing live outcome owns recovery and cannot trigger a second model: accepted=${accepted}`, async () => {
    const h = makeUseCase({ claims: [{ entry: entry({ kind: 'turn' }), deliveryCount: 1, idleMs: 10_000 }] });
    h.prisma.client.lineTurnOutcome.findUnique = async () => ({ id: 'original', deliveredAt: accepted ? NOW : null });
    await h.useCase.execute(20, NOW);
    assert.equal(h.turnRequests.length, 0); assert.equal(h.pushes.length, 0);
    assert.equal(h.acks[0].outcome, accepted ? 'followed_up' : 'parked');
    assert.deepEqual(h.ackReasons, ['original_outcome_owns_delivery']);
  });
});

describe('drain read-free expense criterion replay', () => {
  it('saves an API-validated access proof and retries without another model turn', async () => {
    const opts = {
      claims: [{ entry: entry({ text: 'ไม่รวมรายการที่ถูกปฏิเสธหรือยกเลิกแล้วใช่ไหม' }), deliveryCount: 1, idleMs: 10_000 }],
      pushResult: 'failed_other' as 'failed_other' | 'ok',
      turnFn: (req: any) => ({ requestId: req.requestId, replyText: LINE_AI_EXPENSE_CRITERION_REPLIES.generalTh,
        sourceRefs: [], sourceLabels: [], webLinks: [], intent: 'read_summary', agent: 'accounting', refused: false,
        toolsInvoked: [], durationMs: 5, deterministicExpenseCriterionConfirmation: true }),
    };
    const h = makeUseCase(opts);
    let proofChecks = 0;
    (h.useCase as any).readEvidence = {
      forTurn: async () => [], verify: async () => true,
      isReadFreeExpenseCriterionConfirmation: async () => true,
      verifyDelivery: async (proof: any) => { proofChecks++; return proof?.access?.kind === 'expense_criterion_confirmation'; },
    };
    await h.useCase.execute(20, NOW);
    const delivery = [...h.deliveryRows.values()][0];
    assert.equal(delivery.status, 'UNKNOWN');
    assert.equal(delivery.authorizationJson.access.kind, 'expense_criterion_confirmation');
    assert.equal(delivery.authorizationJson.read, undefined);

    opts.pushResult = 'ok';
    await h.useCase.execute(20, NOW);
    assert.equal(proofChecks, 1);
    assert.equal(h.turnRequests.length, 1);
    assert.equal(h.pushes.length, 2);
    assert.equal([...h.deliveryRows.values()][0].status, 'ACCEPTED');
  });
});

describe('AP22 queued source delivery fence', () => {
  for (const fault of ['missing', 'store-error', 'changed', 'read-error', 'unchanged'] as const) {
    it(`suppresses a queued private response without current read evidence: ${fault}`, async () => {
      const h = makeUseCase({ claims: [{ entry: entry({ kind: 'turn' }), deliveryCount: 1, idleMs: 10_000 }] });
      (h.useCase as any).readEvidence = {
        forTurn: async () => { if (fault === 'store-error') throw new Error('store down'); return fault === 'missing' ? null : ['source-1']; },
        verify: async () => { if (fault === 'read-error') throw new Error('read down'); return fault === 'unchanged'; },
      };
      const result = await h.useCase.execute(20, NOW);
      assert.equal(h.turnRequests.length, 1);
      if (fault === 'unchanged') assert.equal(result.followedUp, 1);
      else {
        assert.equal(result.refused, 1); assert.equal(h.pushes.length, 1);
        assert.match(h.pushes[0].text, /กรุณาเปิดเว็บ/);
        assert.doesNotMatch(h.pushes[0].text, /5,000/);
        assert.deepEqual(h.ackReasons, ['delivery_source_changed']);
        assert.ok(h.eventUpdates.some((update: any) => update.data.errorCode === 'LINE_DELIVERY_SOURCE_CHANGED'));
      }
    });
  }
});

describe('AP22 queued delivery actor fence', () => {
  const changes: Array<[string, (state: ReturnType<typeof makeUseCase>['state']) => void]> = [
    ['membership replacement', state => { state.access.membershipId = 'replacement'; }],
    ['role revoked', state => { state.access.roles = []; }],
    ['permission revoked', state => { state.access.permissions = []; }],
    ['branches restricted to empty', state => { state.access.scopes.branchIds = []; }],
    ['location restricted', state => { state.access.scopes.locationIds = ['location2']; }],
    ['feature disabled', state => { state.entitlements = [{ featureKey: 'ai_line_assistant', enabled: false }]; }],
    ['entitlements changed', state => { state.access.entitledFeatureKeys = []; }],
    ['company switched', state => { state.selectedCompany = 'c2'; }],
    ['LINE unlinked', state => { state.linked = false; }],
    ['user disabled', state => { state.userStatus = 'DISABLED'; }],
    ['user opted out', state => { state.optedOut = true; }],
    ['support pause', state => { state.pausedUntil = new Date(Date.now() + 60_000); }],
  ];
  for (const [name, change] of changes) it(`suppresses private model output when ${name} during processing`, async () => {
    const h = makeUseCase({
      claims: [{ entry: entry({ kind: 'turn' }), deliveryCount: 1, idleMs: 5000 }],
      duringTurn: () => change(h.state),
    });
    const result = await h.useCase.execute(20, NOW);
    assert.equal(result.refused, 1);
    assert.equal(h.turnRequests.length, 1);
    assert.equal(h.pushes.length, 0, 'no stale private facts or handoff URL may leave the API');
    assert.deepEqual(h.acks, [{ id: '1-0', outcome: 'refused' }]);
    assert.deepEqual(h.ackReasons, ['delivery_access_changed']);
    assert.equal(h.eventUpdates.at(-1)?.data.errorCode, 'LINE_DELIVERY_ACCESS_CHANGED');
    assert.equal(h.aiTurnUpdates.length, 0, 'delivery refusal must not overwrite an existing ERP/AI outcome');
  });

  it('checks again after slow handoff preparation', async () => {
    const h = makeUseCase({ claims: [{ entry: entry({ kind: 'turn' }), deliveryCount: 1, idleMs: 5000 }] });
    (h.useCase as any).handoffLinks = { wrapOutgoingLineContent: async (_recipient: unknown, messages: unknown) => {
      h.state.linked = false;
      return messages;
    } };
    assert.equal((await h.useCase.execute(20, NOW)).refused, 1);
    assert.equal(h.pushes.length, 0);
  });

  it('requires the current identity to belong to the exact actor and private destination before model work', async () => {
    const h = makeUseCase({ claims: [{ entry: entry({ chatKey: 'group-or-other-user' }), deliveryCount: 1, idleMs: 5000 }] });
    h.state.linked = false;
    assert.equal((await h.useCase.execute(20, NOW)).refused, 1);
    assert.deepEqual(h.identityReads[0], { provider: 'LINE', status: 'ACTIVE', userId: 'u1',
      providerUserId: 'group-or-other-user', user: { status: 'ACTIVE', aiAssistantOptOutAt: null } });
    assert.equal(h.turnRequests.length, 0);
    assert.equal(h.pushes.length, 0);
  });

  it('delivers unchanged authority despite canonical ordering differences', async () => {
    const h = makeUseCase({
      claims: [{ entry: entry(), deliveryCount: 1, idleMs: 5000 }],
      duringTurn: () => {
        h.state.access.permissions.reverse();
        h.state.access.roles.reverse();
        h.state.access.scopes.branchIds!.reverse();
      },
    });
    h.state.access.permissions = ['line.ai.query', 'dashboard.read'];
    h.state.access.roles = ['OWNER', 'STAFF'];
    h.state.access.scopes.branchIds = ['branch1', 'branch2'];
    assert.equal((await h.useCase.execute(20, NOW)).followedUp, 1);
    assert.equal(h.pushes.length, 1);
    assert.match(h.pushes[0].text, /5,000/);
  });

  it('does not equate legacy null entitlements with explicit empty', async () => {
    const h = makeUseCase({
      claims: [{ entry: entry(), deliveryCount: 1, idleMs: 5000 }],
      duringTurn: () => { h.state.access.entitledFeatureKeys = []; },
    });
    h.state.access.entitledFeatureKeys = null;
    assert.equal((await h.useCase.execute(20, NOW)).refused, 1);
    assert.equal(h.pushes.length, 0);
  });
});

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
      claims: [{ entry: entry({ valueCandidates: candidates as never, intakeIntent: 'BUSINESS_READ_QUESTION' as never }), deliveryCount: 2, idleMs: 5000 }],
    });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.followedUp, 1);
    assert.equal(turnRequests[0].messageText, 'ยอดค้างซัพพลายเออร์');
    assert.deepEqual(turnRequests[0].valueCandidates, candidates);
    // Spec §5.3: the other half of the ledger round-trip. A reclaimed business turn that lost its
    // trusted provenance gets the "out of scope" answer the live turn would never have given.
    assert.equal(turnRequests[0].intakeIntent, 'BUSINESS_READ_QUESTION');
    assert.equal(turnRequests[0].userContext.lineUserId, '[REDACTED]');
    assert.deepEqual(turnRequests[0].userContext.entitlementDeniedPermissions, { 'inventory.report.read': 'inventory' });
    assert.deepEqual(turnRequests[0].userContext.entitledFeatureKeys, ['ai_line_assistant']);
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

  // UAT 2026-09-05: `ai.line.ledger.follow_up_failed` … "waiting_user entry still inside the clarify
  // window" rode every drain of a chat with an open question. It is the DESIGNED hold — the live turn
  // path owns that answer — so it may not be reported at level 40 next to real delivery failures.
  it('holds a fresh waiting_user entry without reporting it as a failure', async () => {
    const { useCase, acks, warnings } = makeUseCase({
      claims: [{ entry: entry({ id: '3-0', state: 'waiting_user', clarifyQuestion: 'ปีไหน?' }), deliveryCount: 1, idleMs: 5000 }],
    });

    const result = await useCase.execute(20, NOW);

    assert.equal(result.claimed, 1);
    assert.equal(result.expired, 0, 'still inside the window — nothing expires');
    assert.deepEqual(acks, [], 'the entry stays in the PEL for the live path to answer');
    assert.deepEqual(warnings, [], 'an expected hold is not an operator-visible failure');
  });

  it('parks an entry past the delivery cap instead of looping (poison protection)', async () => {
    const { useCase, acks, turnRequests, eventUpdates } = makeUseCase({
      claims: [{ entry: entry({ kind: 'turn' }), deliveryCount: 4, idleMs: 5000 }],
    });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.parked, 1);
    assert.equal(turnRequests.length, 0, 'parked entries never reach the gateway');
    assert.deepEqual(acks, [{ id: '1-0', outcome: 'parked' }]);
    assert.equal(eventUpdates[0]?.data.status, 'failed_terminal');
    assert.equal(eventUpdates[0]?.data.errorCode, 'LINE_LEDGER_DELIVERY_CAP_EXCEEDED');
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
    assert.equal(inWindow.eventUpdates[0]?.data.status, 'feature_disabled');

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
    assert.equal(stale.eventUpdates[0]?.data.status, 'failed_terminal');
  });

  it('does not acknowledge a disabled in-window turn when its refusal cannot reach LINE', async () => {
    const h = makeUseCase({
      claims: [{ entry: entry({ kind: 'turn' }), deliveryCount: 1, idleMs: 5000 }],
      entitlements: [{ featureKey: 'ai_line_assistant', enabled: false }],
      pushResult: 'failed_other',
    });

    assert.equal((await h.useCase.execute(20, NOW)).refused, 0);
    assert.equal(h.acks.length, 0, 'delivery failure remains reclaimable');
    assert.equal(h.eventUpdates.length, 0, 'source stays nonterminal until the refusal is visible');
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
    const { useCase, acks, pushes, eventUpdates } = makeUseCase({
      claims: [{ entry: entry({ kind: 'turn' }), deliveryCount: 1, idleMs: 5000 }],
      permissions: ['dashboard.read'],
    });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.refused, 1);
    assert.equal(pushes.length, 1, 'the waiting user gets a bounded refusal, never business data');
    assert.equal(pushes[0]?.text, REFUSAL_MESSAGES.forbidden);
    assert.equal(eventUpdates[0]?.data.status, 'forbidden');
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

  it('sends the company entitlement set with the drained turn, like the live webhook does', async () => {
    const { useCase, turnRequests } = makeUseCase({
      claims: [{ entry: entry(), deliveryCount: 2, idleMs: 5000 }],
      entitlements: [
        { featureKey: 'ai_line_assistant', enabled: true },
        { featureKey: 'expenses', enabled: true },
        { featureKey: 'crm', enabled: false },
      ],
    });
    await useCase.execute(20, NOW);
    // A drained turn must not describe the assistant's capabilities differently from a live one.
    assert.ok(turnRequests[0].entitledFeatureKeys.includes('expenses'));
    assert.ok(!turnRequests[0].entitledFeatureKeys.includes('crm'));
  });

  it('omits entitlements for a legacy company with no rows (fail-open)', async () => {
    const { useCase, turnRequests } = makeUseCase({
      claims: [{ entry: entry(), deliveryCount: 2, idleMs: 5000 }],
      entitlements: [],
    });
    await useCase.execute(20, NOW);
    assert.equal(turnRequests[0].entitledFeatureKeys, undefined);
  });

  it('computes a crashed turn only when no saved outcome exists and closes deferred event states', async () => {
    const { useCase, acks, pushes, turnRequests, aiTurnUpdates, eventUpdates } = makeUseCase({
      claims: [{ entry: entry({ kind: 'turn', state: 'pending', text: 'ยอดขายวันนี้ กับของใกล้หมด' }), deliveryCount: 2, idleMs: 300000 }],
    });
    const result = await useCase.execute(20, NOW);
    assert.equal(result.followedUp, 1);
    assert.equal(turnRequests[0].webhookEventId, 'evt1', 'original webhookEventId keeps capture idempotency');
    assert.equal(pushes.length, 1, 'the crashed turn is answered by push');
    assert.equal(acks[0]?.outcome, 'followed_up');
    assert.deepEqual(aiTurnUpdates[0].where.status.in, ['PROCESSING', 'ERROR']);
    assert.deepEqual(eventUpdates[0].where.status.in, ['processing', 'response_ready', 'delivery_pending', 'ai_error', 'provider_unavailable', 'rate_limited']);
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

// Owner 2026-09-30 ("ข้อความตอนเครดิตหมดระหว่างส่งซ้ำ ต้องยอมให้ใช้เกินโควต้า"): a queued or reclaimed turn —
// and a sub_request of one — is re-run past the AI credit cap and answered for real. The admission
// itself (cap yields, usage metered, every other refusal kept) is proven in ai-gateway.client.spec.ts.
describe('drain: a queued turn may go past the AI credit cap', () => {
  for (const kind of ['turn', 'sub_request'] as const) {
    it(`asks for over-cap admission at the next retry ordinal and delivers the real answer: ${kind}`, async () => {
      const h = makeUseCase({ claims: [{ entry: entry({ kind }), deliveryCount: 2, idleMs: 10_000 }] });

      const result = await h.useCase.execute(20, NOW);

      assert.deepEqual(h.turnOptions, [{ retryOrdinal: 2, admitOverCap: true }]);
      assert.equal(result.followedUp, 1);
      assert.ok(h.pushes[0].text.includes('5,000'), 'the real answer, not the credit notice');
      assert.doesNotMatch(h.pushes[0].text, /เครดิต AI/);
    });
  }
});

/**
 * Remediation spec §9.4 / impact review F-08, criterion R-09.
 *
 * A 429 from our own money gate used to escape into `execute`'s generic catch: the entry stayed
 * unacked, was reclaimed until `lineAiLedgerDeliveryCap`, and ended as
 * `LINE_LEDGER_DELIVERY_CAP_EXCEEDED` / `failed_terminal` — a permanent refusal retried as if it
 * were transient, with its reason rewritten on the way out.
 */
describe('drain: a permanent money refusal is an answer, not a retry (§9.4)', () => {
  const budgetThrow = (code: string, budgetScope = 'TOTAL') => () => {
    const error: any = new Error(code);
    error.getStatus = () => 429;
    error.getResponse = () => ({ code, budgetScope });
    throw error;
  };
  /** Older than LINE_AI_CONTEXT_WINDOW_MINUTES, so nobody is still waiting on this turn. */
  const STALE = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();

  for (const code of ['AI_MONTHLY_BUDGET_EXCEEDED', 'AI_BUDGET_INSUFFICIENT']) {
    it(`tells an in-window turn once and finishes it durably: ${code}`, async () => {
      const h = makeUseCase({ claims: [{ entry: entry({ kind: 'turn' }), deliveryCount: 1, idleMs: 10_000 }], turnFn: budgetThrow(code) });

      const result = await h.useCase.execute(20, NOW);

      assert.equal(result.refused, 1);
      assert.equal(h.pushes.length, 1, 'exactly one notice, not one per reclaim');
      assert.match(h.pushes[0].text, code === 'AI_BUDGET_INSUFFICIENT' ? /เครดิต AI ที่เหลือของเดือนนี้ไม่พอ/ : /เครดิต AI ของเดือนนี้หมดแล้ว/);
      assert.deepEqual(h.acks, [{ id: '1-0', outcome: 'refused' }]);
      assert.deepEqual(h.ackReasons, [code]);
      // The durable event row keeps the money reason, not the delivery-cap story.
      const errorCodes = h.eventUpdates.map((update: any) => update.data.errorCode);
      assert.ok(errorCodes.includes(code), `expected ${code} in ${JSON.stringify(errorCodes)}`);
      assert.equal(errorCodes.includes('LINE_LEDGER_DELIVERY_CAP_EXCEEDED'), false);
      assert.equal(h.eventUpdates.at(-1).data.status, code === 'AI_BUDGET_INSUFFICIENT' ? 'ai_budget_insufficient' : 'ai_budget_exceeded');
    });
  }

  it('keeps CHAT scope through a reclaimed refusal and removes the same-month package upsell', async () => {
    const h = makeUseCase({
      claims: [{ entry: entry({ kind: 'turn' }), deliveryCount: 1, idleMs: 10_000 }],
      turnFn: budgetThrow('AI_MONTHLY_BUDGET_EXCEEDED', 'CHAT'),
    });
    await h.useCase.execute(20, NOW);

    assert.match(h.pushes[0]!.text, /เครดิต AI ส่วนแชตของเดือนนี้หมดแล้ว/);
    assert.match(h.pushes[0]!.text, /ไม่เติมเครดิตแชตในเดือนนี้/);
    assert.match(h.pushes[0]!.text, /ติดต่อเจ้าหน้าที่/);
    assert.doesNotMatch(h.pushes[0]!.text, /ขอเปลี่ยนแพ็กเกจ|ดูแพ็กเกจ/);
    const saved = [...h.deliveryRows.values()][0]!;
    // This harness reader holds no `company.plan.manage`, and the stored refusal says so (next test).
    assert.deepEqual(saved.authorizationJson.staticRefusal,
      { code: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'CHAT', canManagePlan: false });
    assert.equal(saved.completionJson.budgetScope, 'CHAT');
    assert.equal(h.terminalLogs.find((event) => event.msg === 'line.ai.terminal')?.budgetScope, 'CHAT');
  });

  // Advisor spec §2.2 (Owner 2026-09-30): only a reader who may buy is pointed at a package change;
  // staff are told who to ask. The reader's right is frozen on the stored refusal, so a re-send after
  // an unconfirmed push re-derives the same words and passes the integrity check.
  it('tells a reader who may not buy who to ask, and re-sends those same stored words', async () => {
    for (const code of ['AI_MONTHLY_BUDGET_EXCEEDED', 'AI_BUDGET_INSUFFICIENT']) {
      const opts = { claims: [{ entry: entry({ kind: 'turn' }), deliveryCount: 1, idleMs: 10_000 }],
        turnFn: budgetThrow(code), pushResult: 'failed_other' as 'failed_other' | 'ok' };
      const h = makeUseCase(opts);
      // Only the static-refusal integrity check may let the stored notice through again.
      (h.useCase as any).readEvidence.verifyDelivery = async () => false;
      await h.useCase.execute(20, NOW);
      assert.equal([...h.deliveryRows.values()][0].status, 'UNKNOWN');
      opts.pushResult = 'ok';
      await h.useCase.execute(20, NOW);

      assert.equal(h.turnRequests.length, 1, 'the stored refusal is re-sent, never recomputed');
      assert.equal(h.pushes.length, 2);
      assert.equal(h.pushes[1].text, h.pushes[0].text);
      assert.ok(h.pushes[0].text.endsWith(`เดือนหน้าเริ่มใหม่ ${ASK_PLAN_MANAGER_TH}`), h.pushes[0].text);
      assert.doesNotMatch(h.pushes[0].text, /ขอเปลี่ยนแพ็กเกจ|ดูแพ็กเกจ|ซื้อ|โปรโมชั่น/);
      const saved = [...h.deliveryRows.values()][0]!;
      assert.deepEqual(saved.authorizationJson.staticRefusal, { code, budgetScope: 'TOTAL', canManagePlan: false });
      assert.equal(saved.status, 'ACCEPTED');
    }
  });

  it('keeps the package-change wording, and the stored refusal as it was, for a reader who may buy', async () => {
    const h = makeUseCase({ claims: [{ entry: entry({ kind: 'turn' }), deliveryCount: 1, idleMs: 10_000 }],
      permissions: ['line.ai.query', PLAN_MANAGE_PERMISSION_KEY], turnFn: budgetThrow('AI_MONTHLY_BUDGET_EXCEEDED') });
    await h.useCase.execute(20, NOW);

    assert.equal(h.pushes[0]!.text, '💚 เครดิต AI ของเดือนนี้หมดแล้วค่ะ น้องมั่งมีจึงยังไม่ได้ตอบข้อความก่อนหน้านี้ให้นะคะ '
      + 'เดือนหน้าเริ่มใหม่ หรือขอเปลี่ยนแพ็กเกจเพื่อใช้ต่อได้เลยค่ะ');
    // No reader field for a buyer: a refusal stored before this rule re-derives to these same words.
    assert.deepEqual([...h.deliveryRows.values()][0]!.authorizationJson.staticRefusal,
      { code: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL' });
  });

  it('never sends an unsolicited notice for a stale turn or a sub_request', async () => {
    for (const claim of [entry({ kind: 'turn', createdAt: STALE }), entry({ kind: 'sub_request', createdAt: STALE })]) {
      const h = makeUseCase({ claims: [{ entry: claim, deliveryCount: 1, idleMs: 10_000 }], turnFn: budgetThrow('AI_MONTHLY_BUDGET_EXCEEDED') });

      const result = await h.useCase.execute(20, NOW);

      assert.equal(result.refused, 1, `${claim.kind} must finish, not loop`);
      assert.deepEqual(h.pushes, [], `${claim.kind}: nobody is waiting on this one`);
      assert.deepEqual(h.ackReasons, ['AI_MONTHLY_BUDGET_EXCEEDED']);
    }
  });

  it('does not revive itself on the next drain after the money is topped up', async () => {
    const claims = [{ entry: entry({ kind: 'turn' }), deliveryCount: 1, idleMs: 10_000 }];
    let refuse = true;
    const h = makeUseCase({ claims, turnFn: (req: any) => {
      if (refuse) budgetThrow('AI_MONTHLY_BUDGET_EXCEEDED')();
      return { requestId: req.requestId, replyText: 'ยอดค้าง 5,000 บาท', sourceRefs: [], sourceLabels: [], webLinks: [],
        intent: 'read_summary', agent: 'accounting', refused: false, toolsInvoked: [], durationMs: 5 };
    } });

    await h.useCase.execute(20, NOW);
    refuse = false; // a top-up, or simply the next month
    await h.useCase.execute(20, NOW);

    assert.equal(h.turnRequests.length, 1, 'the finished refusal must not buy a second model execution');
    assert.equal(h.pushes.length, 1, 'and must not answer the same turn twice');
  });

  for (const code of ['AI_BUDGET_BUSY', 'AI_BUDGET_UNAVAILABLE']) {
    it(`still holds ${code} for the existing bounded reclaim`, async () => {
      const h = makeUseCase({ claims: [{ entry: entry({ kind: 'turn' }), deliveryCount: 1, idleMs: 10_000 }], turnFn: budgetThrow(code) });

      const result = await h.useCase.execute(20, NOW);

      assert.equal(result.refused, 0);
      assert.deepEqual(h.acks, [], 'left unacked on purpose: the reclaim owns it, capped as before');
      assert.deepEqual(h.pushes, []);
      assert.equal(h.warnings.at(-1)?.msg, 'ai.line.ledger.follow_up_failed');
    });
  }

  it('still parks a genuinely poisonous entry at the delivery cap', async () => {
    const h = makeUseCase({ claims: [{ entry: entry({ kind: 'turn' }), deliveryCount: 9, idleMs: 10_000 }], turnFn: budgetThrow('AI_MONTHLY_BUDGET_EXCEEDED') });

    const result = await h.useCase.execute(20, NOW);

    assert.equal(result.parked, 1, 'the cap check runs before the model, exactly as before');
    assert.equal(h.turnRequests.length, 0);
  });
});

it('R17 a stored refusal card with altered body is refused even when its canonical sentence is unchanged', async () => {
  const opts = { claims: [{ entry: entry({ kind: 'turn' }), deliveryCount: 1, idleMs: 10_000 }],
    turnFn: () => {
      const error: any = new Error('AI_MONTHLY_BUDGET_EXCEEDED');
      error.getStatus = () => 429;
      error.getResponse = () => ({ code: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL' });
      throw error;
    }, pushResult: 'failed_other' as 'failed_other' | 'ok' };
  const h = makeUseCase(opts);
  (h.useCase as any).readEvidence.verifyDelivery = async () => false;
  await h.useCase.execute(20, NOW);
  const saved = [...h.deliveryRows.values()][0]!;
  assert.equal(saved.status, 'UNKNOWN');
  const card: any = saved.messagesJson[0];
  assert.equal(card.type, 'flex');
  card.contents.body.contents[1].contents.push({ type: 'text', text: 'ข้อมูลที่แทรกเข้ามา', wrap: true });
  opts.pushResult = 'ok';
  await h.useCase.execute(20, NOW);
  assert.equal(saved.status, 'REFUSED');
  assert.equal(JSON.stringify(h.pushes.slice(1)).includes('ข้อมูลที่แทรกเข้ามา'), false);
  assert.equal(h.turnRequests.length, 1);
});
