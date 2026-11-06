import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  parseLineAiPreparedPlan, parseLineAiSemanticSubrequests, validateLineAiSourceRefV2,
  verifyLineAiInputEvidence, verifyLineAiValueCandidatesV2, type LineAiTurnRequest,
} from '@watchdog-bms/contracts';
import { buildLineBufferEnvelope } from '../line-buffer-envelope';
import { LineReadEvidenceService } from '../line-read-evidence.service';
import { resolvedLineDeliveryAccessFingerprint } from '../line-delivery-access';
import { FIXED_READ } from '../../domain/logic/line-staff-menu.logic';
import { deliveryHash, initialDeliveryBatchStates, parseLineDeliveryPlan } from '../../domain/logic/line-delivery-plan.logic';
import { ProcessLineWebhookUseCase, chatKeyHashOf } from './process-line-webhook.use-case';
import { evaluateEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';

function fixture(options: { permissions?: string[]; features?: Set<string> | null; unbound?: boolean; missingRead?: boolean; deliveryV2?: boolean } = {}) {
  // UTC is still October: the admitted turn must read November in Bangkok.
  const admittedAt = options.deliveryV2 ? new Date() : new Date('2026-10-31T17:05:00Z');
  const envelope = buildLineBufferEnvelope({ type: 'postback', webhookEventId: 'fixed-event', replyToken: 'reply-token',
    timestamp: admittedAt.getTime(), source: { type: 'user', userId: 'line-user' },
    postback: { data: 'action=fixed-read&id=expense_month' } }, 'channel-1', false)!;
  assert.equal(envelope.item.kind, 'text');
  const event: any = { ...envelope.item, messageText: (envelope.item as { text: string }).text,
    lineUserId: envelope.lineUserId, messagingChannelId: envelope.messagingChannelId, channelKind: 'USER' };
  const access = { companyId: 'company-1', membershipId: 'membership-1', roles: ['OWNER'], scopes: {},
    permissions: options.permissions ?? ['line.ai.query', 'ai.tool.invoke', 'expense.read'] };
  const features = evaluateEntitledFeatureKeys(options.features === null ? []
    : [{ featureKey: 'expenses', enabled: options.features?.has('expenses') ?? true }]);
  const requests: LineAiTurnRequest[] = [], sent: any[] = [], statuses: string[] = [], grants: any[] = [], reads: any[] = [];
  const result = { toolName: FIXED_READ.expense_month.tool, status: 'ok' as const,
    data: { total: 1, summary: { totalAmount: 250 }, items: [] },
    sourceRefs: [{ module: 'expenses', entityType: 'expense_summary', label: 'รายการค่าใช้จ่าย', permissionChecked: true as const }],
    asOf: new Date().toISOString() };
  const client: any = {
    lineWebhookEventLog: { findUnique: async () => ({ id: 'log-1', createdAt: admittedAt }),
      updateMany: async ({ data }: any) => { if (data.status) statuses.push(data.status); return { count: 1 }; } },
    lineReadEvidence: { findMany: async () => reads, count: async () => reads.length,
      create: async ({ data }: any) => { const row = { id: 'read-1', ...data }; reads.push(row); return row; } },
    $executeRaw: async () => 1,
    user: { findUnique: async () => ({ status: 'ACTIVE', aiAssistantOptOutAt: null }) },
    company: { findUnique: async () => ({ reportClassification: 'PRODUCTION' }) },
    companyFeatureEntitlement: { findMany: async () => features === null ? []
      : [{ featureKey: 'expenses', enabled: features.has('expenses') }] },
    externalIdentity: { findFirst: async () => ({ status: 'ACTIVE', userId: 'user-1', user: { status: 'ACTIVE' } }) },
    lineCompanyContext: { findUnique: async () => ({ companyId: access.companyId }) },
  };
  client.$transaction = async (work: any) => work(client);
  const prisma = { client } as any, resolver = { resolveAccess: async () => access } as any;
  const evidence = new LineReadEvidenceService(prisma, resolver,
    new Map([[result.toolName, { execute: async () => result }]]) as any);
  const gateway = {
    issueLineReliabilityGrant: async (_requestId: string, input: any) => { grants.push(input); return { turnKey: input.turnKey }; },
    narrowLineReliabilityGrant: async (grant: any, lane: string, profiles: string[]) => {
      assert.equal(lane, 'simple'); assert.deepEqual(profiles, ['line-answer/2']); return grant;
    },
    requestLineTurn: async (request: LineAiTurnRequest) => {
      requests.push(request);
      if (!options.missingRead) await evidence.record({ requestId: request.requestId, companyId: access.companyId,
        userId: 'user-1', membershipId: access.membershipId, permissions: access.permissions, roles: access.roles,
        locale: 'th-TH', chatKeyHash: request.userContext.chatKeyHash }, request.preparedPlan!.proposedCalls[0]!.input, result);
      return { requestId: request.requestId, replyText: 'ค่าใช้จ่ายเดือนนี้ 250.00 บาท', intent: 'read_summary', agent: 'accounting',
        durationMs: 1, webLinks: [], sourceLabels: [], sourceRefs: result.sourceRefs, toolsInvoked: [result.toolName],
        toolCalls: [{ name: result.toolName, status: 'ok', durationMs: 1 }], refused: false,
        semanticCoverage: [{ index: 0, status: 'handled' }],
        presentation: { kind: 'answer_cards', cards: [{ text: 'ค่าใช้จ่ายเดือนนี้ 250.00 บาท' }] } };
    },
  };
  const reply = { sendReply: async (_token: string, messages: any[]) => { sent.push(...messages); return 'ok'; },
    sendFrozenV2: async ({ messages }: any) => { sent.push(...messages); return { kind: 'accepted' }; },
    buildTextMessage: (text: string) => ({ type: 'text', text }) } as any;
  const flow = new ProcessLineWebhookUseCase({} as any, prisma, { webBaseUrl: 'https://app.test', aiDataRetentionDays: 30,
    lineAiDeliveryPlanV2Enabled: options.deliveryV2, lineAiTerminalOutcomeReplayEnabled: options.deliveryV2 } as any, resolver,
    { log: async () => undefined } as any, gateway as any, reply, {} as any, {} as any, {} as any, {} as any, {} as any) as any;
  flow.readEvidence = evidence;
  flow.logger = { log() {}, warn() {} };
  if (!options.unbound) flow.boundConversations.set(event, { id: 'line-v2:conversation-1', epoch: 1, owner: {
    companyId: access.companyId, userId: 'user-1', membershipId: access.membershipId, channel: 'line', channelKind: 'USER',
    messagingChannelId: event.messagingChannelId, chatKeyHash: chatKeyHashOf(event) } });
  flow.deliveryAccess.set(event, { userId: 'user-1', companyId: access.companyId, membershipId: access.membershipId,
    fingerprint: resolvedLineDeliveryAccessFingerprint('user-1', access.companyId, access as any, features) });
  if (options.deliveryV2) {
    let saved: any, states: any[];
    client.lineTurnOutcome = { findUnique: async () => null, updateMany: async () => ({ count: 1 }) };
    client.lineDeliveryPlan = { findUnique: async () => saved };
    flow.contextV2 = { load: async () => ({ row: { id: 'line-v2:conversation-1', lifecycleEpoch: 1 } }) };
    flow.deliveryPlans = {
      savePlan: async (producer: any, plan: any) => {
        assert.ok(parseLineDeliveryPlan(plan));
        saved = { id: plan.planId, planJson: plan, planHash: deliveryHash(plan), outcomeId: producer.id, status: 'READY' };
        states = initialDeliveryBatchStates(plan); return saved;
      },
      claimPlan: async () => ({ plan: saved.planJson, states }),
      beginPlanBatch: async () => ({ index: 0, timeoutMs: 1000 }),
      finishPlanBatch: async () => { states[0]!.status = 'ACCEPTED'; return true; },
    };
  }
  return { flow, event, requests, sent, statuses, grants, run: () => flow.handleFixedRead(event, 'request-1', 'user-1', access.companyId, access, features) };
}

it('fixed-read builds a gateway-parseable request from the real postback and text evidence helpers', async () => {
  const h = fixture(); await h.run();
  assert.equal(h.requests.length, 1);
  const req = h.requests[0]!;
  assert.equal(req.messageText, FIXED_READ.expense_month.text);
  assert.equal(req.taskProjection, undefined);
  assert.equal(req.retainedTaskSource, undefined);
  assert.equal(req.responsePreferences, undefined);
  assert.ok(await verifyLineAiInputEvidence(req.inputEvidence, req.messageText));
  assert.ok(await verifyLineAiValueCandidatesV2(req.valueCandidates, req.inputEvidence!));
  assert.ok(parseLineAiPreparedPlan(req.preparedPlan, { inputEvidence: req.inputEvidence! }));
  const parsed = parseLineAiSemanticSubrequests(req.semanticSubrequests, req.messageText, req.inputEvidence);
  assert.ok(parsed, 'v2 semanticSubrequests must bind to the original text evidence');
  assert.deepEqual(parsed, req.semanticSubrequests);
  assert.equal(validateLineAiSourceRefV2(parsed[0]!.evidenceRefs![0], req.inputEvidence!), req.messageText);
  assert.deepEqual(req.preparedPlan!.proposedCalls, [{ toolName: FIXED_READ.expense_month.tool,
    input: { fromDate: '2026-11-01', toDate: '2026-11-01' } }]);
  assert.deepEqual(parsed[0]!.requestedFilters, req.preparedPlan!.proposedCalls[0]!.input);
  assert.equal(req.intakeIntent, 'BUSINESS_READ_QUESTION');
  assert.equal(h.grants[0].serverRoute, 'fixed_read');
});

for (const deliveryV2 of [false, true]) it(`handled fixed-tool response passes read evidence, card building and delivery (v2=${deliveryV2})`, async () => {
  const h = fixture({ deliveryV2 }); await h.run();
  assert.deepEqual(h.flow.deliverySources.get(h.event), { requestId: 'request-1', ids: ['read-1'] });
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].type, 'flex');
  assert.match(h.sent[0].canonicalText ?? JSON.stringify(h.sent[0]), /250\.00/);
  assert.deepEqual(h.statuses, ['completed']);
  assert.equal(h.flow.deliveredTextTurns.has(h.event), true);
});

it('handled telemetry without the fixed-tool read evidence still uses unavailable with a web action', async () => {
  const h = fixture({ missingRead: true }); await h.run();
  assert.deepEqual(h.statuses, ['fixed_read_unavailable']);
  assert.match(JSON.stringify(h.sent), /ตอนนี้ยังดูยอดให้ไม่ได้ค่ะ/);
  assert.match(JSON.stringify(h.sent), /เปิดในเว็บ/);
  assert.doesNotMatch(JSON.stringify(h.sent), /250\.00/);
});

for (const [name, options] of Object.entries({
  noQuery: { permissions: ['ai.tool.invoke', 'expense.read'] },
  noInvoke: { permissions: ['line.ai.query', 'expense.read'] },
  noExpense: { permissions: ['line.ai.query', 'ai.tool.invoke'] },
  noFeature: { features: new Set<string>() }, unbound: { unbound: true },
})) it(`fixed-read preserves the ${name} unavailable guard`, async () => {
  const h = fixture(options); await h.run();
  assert.equal(h.requests.length, 0); assert.equal(h.grants.length, 0);
  assert.deepEqual(h.statuses, ['fixed_read_unavailable']);
  assert.match(JSON.stringify(h.sent), /เปิดในเว็บ/);
});
