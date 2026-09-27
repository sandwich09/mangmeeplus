import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessLineWebhookUseCase } from './process-line-webhook.use-case';
import { createLineAiInputEvidence } from '@watchdog-bms/contracts';

function fixture() {
  const seen: Record<string, any[]> = { identities: [], grants: [], turns: [], plans: [], logs: [], replies: [] };
  const now = new Date();
  const config: any = { lineAiReliabilityV2Mode: 'on', lineAiDeliveryPlanV2Enabled: true, lineMessagingChannelId: 'oa', lineAiDeliveryPlanV2PublicChannelIds: ['oa'], aiDataRetentionDays: 30 };
  const forbidden = () => { throw new Error('PRIVATE_PREFETCH'); };
  const handler: any = Object.create(ProcessLineWebhookUseCase.prototype);
  Object.assign(handler, { mediaTextContinuations: new WeakMap(), config, logger: { log() {} }, claimWebhookEvent: async () => true, launchGate: { assertLaunchRouteOpen: async () => undefined },
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
