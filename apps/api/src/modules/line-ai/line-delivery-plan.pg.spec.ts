import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { LineLedgerDeliveryService, type LineDeliveryOwnerFence } from './application/line-ledger-delivery.service';
import { buildLineDeliveryPlan, deliveryHash, type DeliveryAuthorizationV2 } from './domain/logic/line-delivery-plan.logic';
import { buildLineBusinessAnswerMessage } from './domain/logic/line-business-card.logic';
const url = process.env.BILLING_TEST_DATABASE_URL;
test('G3/G6 durable delivery PostgreSQL leases, immutable replay, cancellation and prefix acceptance', { skip: !url }, async t => {
  const parsed = new URL(url!);
  assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.ok((parsed.port === '15439' && ['/watchdog_bms_ai_reliability_20260927', '/watchdog_delivery_integrity_test_20260927'].includes(parsed.pathname))
    || parsed.pathname.endsWith('_ci'), `refusing to write to ${parsed.pathname}: only a disposable local *_ci database`);
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const service = new LineLedgerDeliveryService({ client } as PrismaService), tag = randomUUID(), now = new Date();
  const events: string[] = [];
  async function fixture(count = 11, preferredMessages?: Parameters<typeof buildLineDeliveryPlan>[0]['preferredMessages']) {
    const webhookEventId = `${tag}-${events.length}`; events.push(webhookEventId);
    await client.lineWebhookEventLog.create({ data: { webhookEventId, eventType: 'message', status: 'delivery_pending', deliveryOwnerId: 'webhook' } });
    const outcome = await client.lineTurnOutcome.create({ data: { webhookEventId, messagesJson: [{ type: 'text', text: 'pre-save' }], presentationKind: 'text' } });
    const expiry = new Date(now.getTime() + 59 * 60_000).toISOString();
    const authorization: DeliveryAuthorizationV2 = { v: 2, kind: 'PUBLIC_GENERAL', admissionOwner: { kind: 'WEBHOOK', id: outcome.id, revision: 0 }, destination: { channelId: 'test-oa', channel: 'line', channelKind: 'GROUP', lineTargetId: 'test-group', targetHash: 'hash', chatKeyHash: 'chat' }, actorUserId: null, initiatorHash: 'initiator', admissionPolicyDigest: 'policy', sourceManifestDigest: 'manifest', approvedPublicSourceIds: [], issuedAt: now.toISOString(), expiresAt: expiry };
    const plan = buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId: outcome.id, createdAt: now.toISOString(), expiresAt: expiry, readyAt: now.toISOString(), firstDispatchDeadlineAt: new Date(now.getTime() + 3000).toISOString(), authorization, control: null, businessResult: null, answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: Array.from({ length: count }, (_, i) => ({ kind: 'answer', text: `immutable answer ${i}`, required: true, sourceProofIds: [] })) }, ...(preferredMessages ? { preferredMessages } : {}) });
    const fence: LineDeliveryOwnerFence = { kind: 'WEBHOOK', id: outcome.id };
    return { plan, fence };
  }
  try {
    await t.test('concurrent first save freezes winner; one worker claims, stale lease cannot checkpoint', async () => {
      const { plan, fence } = await fixture();
      const saved = await Promise.all([service.savePlan(fence, plan, new Date(now.getTime() + 86400000), now), service.savePlan(fence, plan, new Date(now.getTime() + 86400000), now)]);
      assert.equal(saved[0]!.id, saved[1]!.id);
      const parent = await client.lineTurnOutcome.findUniqueOrThrow({ where: { id: fence.id } });
      assert.equal(parent.presentationKind, 'delivery_plan_v2'); assert.equal(JSON.stringify(parent.messagesJson).includes('immutable'), false);
      const claims = await Promise.all([service.claimPlan(plan.planId, fence, now), service.claimPlan(plan.planId, fence, now)]);
      assert.equal(claims.filter(Boolean).length, 1);
      const first = claims.find(Boolean)!;
      const dispatch = await service.beginPlanBatch(first, 'PUSH', now);
      assert.equal(dispatch?.timeoutMs, 3000, 'three-second remaining reserve is usable');
      const later = new Date(now.getTime() + 181000), replacement = await service.claimPlan(plan.planId, fence, later);
      assert.ok(replacement);
      assert.equal(await service.finishPlanBatch(first, 0, { kind: 'accepted', code: 'API_ACCEPTED' }, later), false);
      assert.equal((await service.beginPlanBatch(replacement!, 'PUSH', later))?.index, 0);
      assert.equal(replacement!.plan.batches[0]!.primary.pushRetryKey, first.plan.batches[0]!.primary.pushRetryKey);
      assert.deepEqual(replacement!.plan.batches[0]!.primary.messages, first.plan.batches[0]!.primary.messages);
      assert.equal(await service.finishPlanBatch(replacement!, 0, { kind: 'accepted', code: 'API_ACCEPTED', requestId: 'line-request' }, later), true);
      const second = await service.claimPlan(plan.planId, fence, later); assert.ok(second);
      assert.equal((await service.beginPlanBatch(second!, 'PUSH', later))?.index, 1);
      await service.finishPlanBatch(second!, 1, { kind: 'accepted', code: 'API_ACCEPTED' }, later);
      assert.equal((await client.lineDeliveryPlan.findUniqueOrThrow({ where: { id: plan.planId } })).status, 'WAITING_CONTINUATION');
      assert.equal(await service.claimPlan(plan.planId, fence, later), null);
      assert.equal(await service.continuePlan(plan.planId, deliveryHash(plan), 2, later), true);
      assert.equal(await service.continuePlan(plan.planId, deliveryHash(plan), 2, later), false);
      const third = await service.claimPlan(plan.planId, fence, later); assert.ok(third);
      assert.equal((await service.beginPlanBatch(third!, 'PUSH', later))?.index, 2);
      await service.finishPlanBatch(third!, 2, { kind: 'accepted', code: 'API_ACCEPTED' }, later);
      assert.equal((await client.lineDeliveryPlan.findUniqueOrThrow({ where: { id: plan.planId } })).status, 'ACCEPTED');
    });
    await t.test('a refused reply token frees the same batch for an immediate push (E4, UAT 2026-09-29)', async () => {
      const { plan, fence } = await fixture(1);
      await service.savePlan(fence, plan, new Date(now.getTime() + 86400000), now);
      const first = (await service.claimPlan(plan.planId, fence, now))!;
      assert.equal((await service.beginPlanBatch(first, 'REPLY', now))?.index, 0);
      assert.equal(await service.finishPlanBatch(first, 0, { kind: 'rejected', code: 'REPLY_TOKEN_REJECTED', rejection: 'TOKEN' }, now), true);
      const push = await service.claimPlan(plan.planId, fence, now);
      assert.ok(push, 'claimable at once — a spent reply token is not a transport fault to back off from');
      assert.equal((await service.beginPlanBatch(push!, 'PUSH', now))?.index, 0);
    });
    await t.test('UNKNOWN reply never becomes a push; cancel is terminal even when in-flight request accepts', async () => {
      const { plan, fence } = await fixture(6);
      await service.savePlan(fence, plan, new Date(now.getTime() + 86400000), now);
      const first = (await service.claimPlan(plan.planId, fence, now))!;
      await service.beginPlanBatch(first, 'REPLY', now);
      await service.finishPlanBatch(first, 0, { kind: 'unknown', code: 'NETWORK' }, now);
      const later = new Date(now.getTime() + 3000), retry = (await service.claimPlan(plan.planId, fence, later))!;
      assert.equal(await service.beginPlanBatch(retry, 'PUSH', later), null);
      assert.equal(await service.cancelPlan(plan.planId, deliveryHash(plan), later), true);
      assert.equal(await service.finishPlanBatch(retry, 0, { kind: 'accepted', code: 'API_ACCEPTED' }, later), true);
      const row = await client.lineDeliveryPlan.findUniqueOrThrow({ where: { id: plan.planId } });
      assert.equal(row.status, 'CANCELLED'); assert.equal((row.batchStateJson as any[])[0].status, 'ACCEPTED');
      assert.equal(await service.claimPlan(plan.planId, fence, later), null);
    });
    await t.test('UNKNOWN keeps frozen Flex primary; only definitive Flex rejection selects its pre-frozen fallback', async () => {
      const rendered = buildLineBusinessAnswerMessage({ requestId: 'request', replyText: 'immutable answer 0', sourceRefs: [], sourceLabels: [],
        webLinks: [], intent: 'read_summary', agent: 'accounting', refused: false, toolsInvoked: ['expense.list_recent'], durationMs: 1,
        presentation: { kind: 'answer_cards', cards: [{ text: 'immutable answer 0' }] } }, 'immutable answer 0', undefined, 'company');
      assert.equal(rendered.type, 'flex');
      const preferred = [rendered];
      const unknownFixture = await fixture(1, preferred);
      await service.savePlan(unknownFixture.fence, unknownFixture.plan, new Date(now.getTime() + 86400000), now);
      const unknownClaim = (await service.claimPlan(unknownFixture.plan.planId, unknownFixture.fence, now))!;
      await service.beginPlanBatch(unknownClaim, 'PUSH', now);
      await service.finishPlanBatch(unknownClaim, 0, { kind: 'unknown', code: 'NETWORK' }, now);
      const unknownRow = await client.lineDeliveryPlan.findUniqueOrThrow({ where: { id: unknownFixture.plan.planId } });
      assert.equal((unknownRow.batchStateJson as any[])[0].variant, 'primary');
      assert.deepEqual(unknownFixture.plan.batches[0]!.primary.messages, unknownClaim.plan.batches[0]!.primary.messages);

      const rejectedFixture = await fixture(1, preferred);
      await service.savePlan(rejectedFixture.fence, rejectedFixture.plan, new Date(now.getTime() + 86400000), now);
      const rejectedClaim = (await service.claimPlan(rejectedFixture.plan.planId, rejectedFixture.fence, now))!;
      await service.beginPlanBatch(rejectedClaim, 'PUSH', now);
      await service.finishPlanBatch(rejectedClaim, 0, { kind: 'rejected', code: 'FLEX_REJECTED', rejection: 'FLEX' }, now);
      const rejectedRow = await client.lineDeliveryPlan.findUniqueOrThrow({ where: { id: rejectedFixture.plan.planId } });
      assert.equal((rejectedRow.batchStateJson as any[])[0].variant, 'fallback');
      const retry = (await service.claimPlan(rejectedFixture.plan.planId, rejectedFixture.fence, new Date(now.getTime() + 3000)))!;
      assert.deepEqual(retry.plan.batches[0]!.fallback!.messages, rejectedFixture.plan.batches[0]!.fallback!.messages);
    });
    await t.test('database rejects orphan/multiple owners and plan version/hash corruption', async () => {
      const { plan, fence } = await fixture(1); await service.savePlan(fence, plan, new Date(now.getTime() + 86400000), now);
      await assert.rejects(client.lineDeliveryPlan.update({ where: { id: plan.planId }, data: { version: 1 } }));
      await assert.rejects(client.lineDeliveryPlan.update({ where: { id: plan.planId }, data: { outcomeId: null } }));
      await client.lineDeliveryPlan.update({ where: { id: plan.planId }, data: { planHash: '0'.repeat(64) } });
      await assert.rejects(service.claimPlan(plan.planId, fence, now), /CORRUPT/);
    });
    // Regression (present on main since v2.4 turned delivery-plan-v2 on by default): a brand-new
    // webhook event graduating straight to v2 used to always leave LineTurnOutcome.authorizationJson
    // a JSON null, silently dropping the R-M2 readMemory AND the pre-existing deliveredExpenseSummary
    // proof for every v2-delivered turn — loadConversationContext's identity/chat/recipient re-check
    // has nothing to read for either field. savePlan's new authorizationJson parameter closes this.
    await t.test('R-M2/deliveredExpenseSummary: a webhook fence graduating straight to v2 persists the SAME access-proof, never JSON null', async () => {
      const webhookEventId = `${tag}-${events.length}`; events.push(webhookEventId);
      await client.lineWebhookEventLog.create({ data: { webhookEventId, eventType: 'message', status: 'delivery_pending' } });
      const outcomeId = randomUUID();
      const expiry = new Date(now.getTime() + 59 * 60_000).toISOString();
      const authorization: DeliveryAuthorizationV2 = { v: 2, kind: 'PUBLIC_GENERAL', admissionOwner: { kind: 'WEBHOOK', id: outcomeId, revision: 0 },
        destination: { channelId: 'test-oa', channel: 'line', channelKind: 'USER', lineTargetId: 'test-user', targetHash: 'hash', chatKeyHash: 'chat' },
        actorUserId: null, initiatorHash: 'initiator', admissionPolicyDigest: 'policy', sourceManifestDigest: 'manifest', approvedPublicSourceIds: [],
        issuedAt: now.toISOString(), expiresAt: expiry };
      const plan = buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId: outcomeId, createdAt: now.toISOString(), expiresAt: expiry, readyAt: now.toISOString(),
        firstDispatchDeadlineAt: new Date(now.getTime() + 3000).toISOString(), authorization, control: null, businessResult: null,
        answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: [{ kind: 'answer', text: 'ค่าใช้จ่าย: 3 รายการ', required: true, sourceProofIds: [] }] } });
      // Same authorizationJson shape recordTurnOutcome (legacy path) persists — see
      // process-line-webhook.use-case.ts buildTurnAuthorizationJson — both proofs present, one call.
      const authorizationJson = { v: 1, producerId: randomUUID(),
        readMemory: { userId: 'user-x', companyId: 'company-x', membershipId: 'mem-x', fingerprint: 'fp', chatKeyHash: 'chat-hash', recipientHash: 'recipient-hash',
          entries: [{ tool: 'expense.list_recent', answerShape: 'list', asOf: now.toISOString(),
            shownItems: [{ ordinal: 1, id: 'expense-1', label: 'ร้านหนึ่ง' }, { ordinal: 2, id: 'expense-2', label: 'ร้านสอง' }, { ordinal: 3, id: 'expense-3', label: 'ร้านสามการค้า' }] }] },
        expenseSummary: { userId: 'user-x', companyId: 'company-x', membershipId: 'mem-x', fingerprint: 'fp', chatKeyHash: 'chat-hash', recipientHash: 'recipient-hash',
          statusBasis: 'exclude_rejected_voided', continuationOfPrior: false, ranges: [{ fromDate: '2026-09-01', toDate: '2026-09-28', branchId: null }] } };
      const fence: LineDeliveryOwnerFence = { kind: 'WEBHOOK', id: outcomeId };
      const saved = await service.savePlan(fence, plan, new Date(now.getTime() + 86400000), now, webhookEventId, authorizationJson as any);
      assert.ok(saved, 'plan saved on first graduation from a brand-new webhook event');
      const outcome = await client.lineTurnOutcome.findUniqueOrThrow({ where: { webhookEventId } });
      assert.equal(outcome.presentationKind, 'delivery_plan_v2');
      assert.deepEqual(outcome.authorizationJson, authorizationJson, 'graduating to v2 must not drop the R-M2/deliveredExpenseSummary proof to JSON null');
    });
  } finally { await client.lineWebhookEventLog.deleteMany({ where: { webhookEventId: { in: events } } }); await client.$disconnect(); }
});
