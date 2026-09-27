import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { LineLedgerDeliveryService, type LineDeliveryOwnerFence } from './application/line-ledger-delivery.service';
import { buildLineDeliveryPlan, deliveryHash, type DeliveryAuthorizationV2 } from './domain/logic/line-delivery-plan.logic';
const url = process.env.BILLING_TEST_DATABASE_URL;
test('G3/G6 durable delivery PostgreSQL leases, immutable replay, cancellation and prefix acceptance', { skip: !url }, async t => {
  const parsed = new URL(url!);
  assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.ok((parsed.port === '15439' && parsed.pathname === '/watchdog_bms_ai_reliability_20260927') || (parsed.port === '5432' && parsed.pathname === '/watchdog_postmark_ci'));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const service = new LineLedgerDeliveryService({ client } as PrismaService), tag = randomUUID(), now = new Date();
  const events: string[] = [];
  async function fixture(count = 11) {
    const webhookEventId = `${tag}-${events.length}`; events.push(webhookEventId);
    await client.lineWebhookEventLog.create({ data: { webhookEventId, eventType: 'message', status: 'delivery_pending', deliveryOwnerId: 'webhook' } });
    const outcome = await client.lineTurnOutcome.create({ data: { webhookEventId, messagesJson: [{ type: 'text', text: 'pre-save' }], presentationKind: 'text' } });
    const expiry = new Date(now.getTime() + 59 * 60_000).toISOString();
    const authorization: DeliveryAuthorizationV2 = { v: 2, kind: 'PUBLIC_GENERAL', admissionOwner: { kind: 'WEBHOOK', id: outcome.id, revision: 0 }, destination: { channelId: 'test-oa', channel: 'line', channelKind: 'GROUP', lineTargetId: 'test-group', targetHash: 'hash', chatKeyHash: 'chat' }, actorUserId: null, initiatorHash: 'initiator', admissionPolicyDigest: 'policy', sourceManifestDigest: 'manifest', approvedPublicSourceIds: [], issuedAt: now.toISOString(), expiresAt: expiry };
    const plan = buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId: outcome.id, createdAt: now.toISOString(), expiresAt: expiry, readyAt: now.toISOString(), firstDispatchDeadlineAt: new Date(now.getTime() + 3000).toISOString(), authorization, control: null, businessResult: null, answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: Array.from({ length: count }, (_, i) => ({ kind: 'answer', text: `immutable answer ${i}`, required: true, sourceProofIds: [] })) } });
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
    await t.test('database rejects orphan/multiple owners and plan version/hash corruption', async () => {
      const { plan, fence } = await fixture(1); await service.savePlan(fence, plan, new Date(now.getTime() + 86400000), now);
      await assert.rejects(client.lineDeliveryPlan.update({ where: { id: plan.planId }, data: { version: 1 } }));
      await assert.rejects(client.lineDeliveryPlan.update({ where: { id: plan.planId }, data: { outcomeId: null } }));
      await client.lineDeliveryPlan.update({ where: { id: plan.planId }, data: { planHash: '0'.repeat(64) } });
      await assert.rejects(service.claimPlan(plan.planId, fence, now), /CORRUPT/);
    });
  } finally { await client.lineWebhookEventLog.deleteMany({ where: { webhookEventId: { in: events } } }); await client.$disconnect(); }
});
