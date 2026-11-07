import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessLineWebhookUseCase } from './process-line-webhook.use-case';
// Owner signed-card/delivery state uses real class field initializers, including on public turns.
import { createLineAiInputEvidence } from '@watchdog-bms/contracts';

function fixture() {
  const seen: Record<string, any[]> = { identities: [], grants: [], turns: [], plans: [], logs: [], replies: [] };
  const now = new Date();
  const config: any = { lineAiReliabilityV2Mode: 'on', lineAiDeliveryPlanV2Enabled: true, lineMessagingChannelId: 'oa', lineAiDeliveryPlanV2PublicChannelIds: ['oa'], aiDataRetentionDays: 30 };
  const forbidden = () => { throw new Error('PRIVATE_PREFETCH'); };
  const handler: any = new (ProcessLineWebhookUseCase as any)();
  Object.assign(handler, { mediaTextContinuations: new WeakMap(), config, logger: { log() {} }, claimWebhookEvent: async () => true, launchGate: { assertLaunchRouteOpen: async () => undefined },
    // buildTurnAuthorizationJson (called from executePublicGeneral) reads these WeakMaps directly on
    // `this`, same as the real class fields — empty here since this fixture's whole point is a public
    // turn with no private access/read/expenseSummary/readMemory proof to carry.
    deliveryAccess: new WeakMap(), deliverySources: new WeakMap(), publicPolicyTopics: new WeakMap(), deliveryDraftPreviews: new WeakMap(),
    deliveryReceiptSources: new WeakMap(), deliverySubstituteSources: new WeakMap(), deliveryCandidates: new WeakMap(),
    legalAcceptance: { isPublicAiAcceptanceRequired: async () => false, isRequired: forbidden },
    permissionResolver: { resolveAccess: forbidden }, contextV2: { load: forbidden }, expenseRepo: { listCategories: forbidden },
    prisma: { client: { lineChannelBinding: { findMany: async () => [{ id: 'binding', companyId: 'payer', updatedAt: now }] },
      externalIdentity: { findFirst: async (input: any) => { seen.identities.push(input); return { userId: 'actor', user: { status: 'ACTIVE', aiAssistantOptOutAt: null } }; } },
      lineCompanyContext: { findUnique: async (input: any) => { assert.deepEqual(input.select, { aiPausedUntil: true }); return null; } },
      companyFeatureEntitlement: { findMany: async () => [] },
      companyMembership: { findMany: forbidden, findFirst: forbidden }, company: { findUnique: forbidden }, aiConversation: { findFirst: forbidden }, lineIntakePendingMedia: { findMany: forbidden },
      lineWebhookEventLog: { findUniqueOrThrow: async () => ({ id: 'admission', createdAt: now, budgetAuthorityRevision: 2 }), update: async () => ({}) } } },
    aiGateway: { issueLineReliabilityGrant: async (_id: string, input: any) => { seen.grants.push(input); return { authorityId: 'admission', payerCompanyId: 'payer', monthKey: '2026-09', finalDeadlineAtMs: Date.now() + 10_000 }; },
      requestLinePublicGeneral: async (input: any) => { seen.turns.push(input); return { status: 'answered', replyText: 'คำตอบทั่วไป', language: 'th' }; } },
    lineReply: { sendReply: async (...args: any[]) => { seen.replies.push(args); return 'ok'; } }, deliveryPlans: { savePlan: async (_fence: any, plan: any) => { seen.plans.push(plan); return { id: plan.planId }; } },
    replayDeliveryPlan: async () => 'ok', updateEventLog: async (...args: any[]) => { seen.logs.push(args); } });
  return { handler, seen, config };
}

test('verified group general bypasses private company/member/context/media and preserves original turn', async () => {
  const { handler, seen } = fixture(), raw = 'อธิบายแนวคิดนี้\nแต่ไม่อ่านข้อมูลของบริษัท';
  const built = await createLineAiInputEvidence({ turnKey: 'test-turn', parts: [{ partId: 'p1', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now() - 5, rawText: raw }] });
  await handler.execute({ webhookEventId: 'event', lineUserId: 'Uactor', pushTargetId: 'Cgroup', channelKind: 'GROUP', messagingChannelId: 'oa', replyToken: 'reply', messageText: raw, inputEvidence: built!.inputEvidence });
  assert.equal(seen.turns.length, 1); assert.equal(seen.turns[0].messageText, raw);
  assert.equal(seen.turns[0].kind, 'PUBLIC_GENERAL'); assert.equal(seen.turns[0].userContext, undefined); assert.equal(seen.turns[0].conversationContext, undefined); assert.equal(seen.turns[0].responsePreferences, undefined);
  assert.deepEqual(seen.grants[0].allowedProfileIds, ['line-answer/2']); assert.equal(seen.grants[0].owner.kind, 'PUBLIC_GENERAL');
  assert.equal(seen.plans[0].authorization.destination.lineTargetId, 'Cgroup'); assert.equal(seen.plans[0].control, null); assert.equal(seen.plans[0].businessResult, null);
  assert.ok(seen.identities.every(input => !input.include && Object.keys(input.select.user.select).join(',') === 'status,aiAssistantOptOutAt'));
});

test('closed public gate or missing consent makes zero provider calls without falling back to private routing', async () => {
  for (const kind of ['off', 'consent', 'unlinked', 'ambiguous_payer', 'wrong_channel']) {
    const { handler, seen, config } = fixture();
    if (kind === 'off') config.lineAiReliabilityV2Mode = 'off';
    if (kind === 'consent') handler.legalAcceptance.isPublicAiAcceptanceRequired = async () => true;
    if (kind === 'unlinked') handler.prisma.client.externalIdentity.findFirst = async () => null;
    if (kind === 'ambiguous_payer') handler.prisma.client.lineChannelBinding.findMany = async () => [{ id: 'a' }, { id: 'b' }];
    await handler.execute({ webhookEventId: 'event', lineUserId: 'Uactor', pushTargetId: 'Cgroup', channelKind: 'GROUP', messagingChannelId: kind === 'wrong_channel' ? 'other' : 'oa', replyToken: 'reply', messageText: 'สวัสดี' });
    assert.equal(seen.turns.length, 0); assert.equal(seen.grants.length, 0); assert.equal(seen.replies.length, 1);
  }
});

test('public admission creates raw evidence without a private context and rejects tampered buffered evidence before paying', async () => {
  const { handler, seen } = fixture();
  const event = { webhookEventId: 'event', lineUserId: 'Uactor', pushTargetId: 'Cgroup', channelKind: 'GROUP' as const, messagingChannelId: 'oa', replyToken: 'reply', messageText: 'คำถามทั่วไปแบบเต็ม' };
  await handler.execute(event);
  assert.equal(seen.turns.length, 1);
  assert.equal(seen.turns[0].inputEvidence.parts[0].rawText, event.messageText);
  const tampered = { ...event, inputEvidence: { ...seen.turns[0].inputEvidence, joinedSha256: 'f'.repeat(64) } };
  await handler.execute(tampered);
  assert.equal(seen.turns.length, 1); assert.equal(seen.grants.length, 1);
  assert.ok(seen.logs.some(args => args[1] === 'input_rejected'));
});


test('empty public rollout permits only the configured, currently authorized channel', async () => {
  const { handler, seen, config } = fixture();
  config.lineAiDeliveryPlanV2PublicChannelIds = [];
  const event = { webhookEventId: 'event', lineUserId: 'Uactor', pushTargetId: 'Cgroup', channelKind: 'GROUP' as const, messagingChannelId: 'oa', replyToken: 'reply', messageText: 'อธิบายความหมายทั่วไป' };
  await handler.execute(event);
  assert.equal(seen.turns.length, 1);
  await handler.execute({ ...event, messagingChannelId: 'other' });
  assert.equal(seen.turns.length, 1, 'empty rollout never authorizes another messaging channel');
});

test('private v2 owner allows empty rollout but still requires current membership and private chat', async () => {
  const { handler, config } = fixture();
  config.lineAiReliabilityV2CompanyIds = [];
  config.lineAiDeliveryPlanV2WriteCompanyIds = [];
  handler.deliveryAccess = new WeakMap();
  const event = { lineUserId: 'Uactor', messagingChannelId: 'oa' };
  assert.equal((await handler.conversationOwner('company-1', 'actor', event)), null, 'missing current access is denied');
  handler.deliveryAccess.set(event, { membershipId: 'member' });
  assert.equal((await handler.conversationOwner('company-1', 'actor', event))?.membershipId, 'member');
  config.lineAiReliabilityV2CompanyIds = ['other'];
  assert.equal((await handler.conversationOwner('company-1', 'actor', event)), null);
  config.lineAiReliabilityV2CompanyIds = [];
  config.lineAiDeliveryPlanV2WriteCompanyIds = ['other'];
  assert.equal((await handler.conversationOwner('company-1', 'actor', event)), null);
  config.lineAiDeliveryPlanV2WriteCompanyIds = [];
  const group = { ...event, pushTargetId: 'Cgroup' };
  handler.deliveryAccess.set(group, { membershipId: 'member' });
  assert.equal((await handler.conversationOwner('company-1', 'actor', group)), null);
  config.lineAiReliabilityV2Mode = 'off';
  assert.equal((await handler.conversationOwner('company-1', 'actor', event)), null);
});
