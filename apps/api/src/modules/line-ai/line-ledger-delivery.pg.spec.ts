import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { LineLedgerDeliveryService, lineLedgerDeliveryId } from './application/line-ledger-delivery.service';
import type { LedgerEntry } from './application/line-ai-ledger.service';

const databaseUrl = process.env.BILLING_TEST_DATABASE_URL;

describe('LINE queued exact-delivery reservation on isolated PostgreSQL', { skip: !databaseUrl }, () => {
  it('retains first output and fences stale/concurrent producers independently for each stream entry', async t => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok((url.port === '15432' && url.pathname === '/mangmee_billing_20260912')
      || (url.port === '15439' && url.pathname === '/watchdog_bms_ai_reliability_20260927')
      || url.pathname.endsWith('_ci'), `refusing to write to ${url.pathname}: only a disposable local *_ci database`);
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    let companyId = '', userId = '';
    try {
      const tag = randomUUID();
      userId = (await client.user.create({ data: { displayName: `queued-${tag}` } })).id;
      companyId = (await client.company.create({ data: { name: `queued-${tag}` } })).id;
      const service = new LineLedgerDeliveryService({ client } as PrismaService), now = new Date();
      const entry = (id: string, overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
        key: `lineai:ledger:${companyId}:synthetic-private-chat`, chatKey: 'synthetic-private-chat', id, companyId, userId,
        webhookEventId: 'same-source-webhook', turnId: 'source-turn', kind: 'sub_request', text: 'synthetic question', state: 'pending', createdAt: now.toISOString(), ...overrides,
      });
      const messages = [{ type: 'text' as const, text: 'First synthetic answer' }];
      const completion = { status: 'completed', refused: false, errorCode: null, replyPreview: 'First synthetic answer', toolCount: 1 };
      const auth = { v: 1, producerId: 'synthetic-proof-marker' };

      await t.test('one concurrent producer owns an entry and cannot accept before send', async () => {
        const claims = await Promise.all([service.claim(entry('1-0'), now), service.claim(entry('1-0'), now)]);
        assert.deepEqual(claims.map(c => c.kind).sort(), ['busy', 'prepare']);
        const claim = claims.find(c => c.kind === 'prepare')!;
        assert.equal(await service.finish(claim, 'ACCEPTED'), false);
        assert.equal(await service.save(claim, messages, auth, completion, now), true);
        assert.equal(await service.save(claim, [{ type: 'text', text: 'Different second answer' }], auth, completion, now), false);
        assert.deepEqual((await client.lineLedgerDelivery.findUniqueOrThrow({ where: { id: claim.row.id } })).messagesJson, messages);
        assert.equal(await service.finish(claim, 'ACCEPTED'), false);
        assert.equal(await service.beginSend(claim, now), true);
        assert.equal((await client.lineLedgerDelivery.findUniqueOrThrow({ where: { id: claim.row.id } })).status, 'UNKNOWN');
        assert.equal(await service.finish(claim, 'UNKNOWN', 'LINE_PUSH_FAILED_OTHER'), true);
        const retry = await service.claim(entry('1-0'), now);
        assert.equal(retry.kind, 'deliver'); assert.notEqual(retry.token, claim.token);
        assert.deepEqual(retry.row.messagesJson, messages); assert.deepEqual(retry.row.authorizationJson, auth);
        assert.equal(await service.beginSend(claim, now), false, 'old token cannot send');
        assert.equal(await service.beginSend(retry, now), true);
        assert.equal(await service.finish(retry, 'ACCEPTED'), true);
        const afterAckLoss = await service.claim(entry('1-0'), new Date(now.getTime() + 30 * 60_000));
        assert.equal(afterAckLoss.kind, 'terminal'); assert.equal(afterAckLoss.row.status, 'ACCEPTED');
        assert.ok(afterAckLoss.row.acceptedAt); assert.equal(afterAckLoss.row.attempts, 2);
      });

      await t.test('expired producer cannot overwrite or send a replacement producer result', async () => {
        const first = await service.claim(entry('2-0'), now), later = new Date(now.getTime() + 181_000);
        const replacement = await service.claim(entry('2-0'), later);
        assert.equal(replacement.kind, 'prepare'); assert.notEqual(first.token, replacement.token);
        assert.equal(await service.save(first, messages, auth, completion, later), false);
        assert.equal(await service.save(replacement, messages, auth, completion, later), true);
        assert.equal(await service.beginSend(first, later), false);
        assert.equal(await service.finish(first, 'REFUSED'), false);
      });

      await t.test('sub-requests sharing a webhook do not overwrite one another or cross streams', async () => {
        const entries = [entry('3-0'), entry('4-0'), entry('3-0', { key: `lineai:ledger:${companyId}:other-chat` })];
        const claims = await Promise.all(entries.map(e => service.claim(e, now)));
        assert.equal(new Set(claims.map(c => c.row.id)).size, 3);
        assert.ok(claims.every(c => c.kind === 'prepare'));
        assert.doesNotMatch(claims[0].row.id, /synthetic-private-chat/);
        await assert.rejects(service.claim(entry('3-0', { userId: 'foreign-user' }), now), /SCOPE_MISMATCH/);
      });

      await t.test('expired context and malformed or oversized messages cannot become a send', async () => {
        const old = entry('5-0', { createdAt: new Date(now.getTime() - 16 * 60_000).toISOString() });
        const expired = await service.claim(old, now);
        assert.equal(expired.kind, 'terminal'); assert.equal(expired.row.status, 'PARKED');
        const fresh = await service.claim(entry('6-0'), now);
        await assert.rejects(service.save(fresh, [{ type: 'text', text: 'x'.repeat(5001) }], auth, completion, now), /OUTCOME_INVALID/);
        assert.equal(await service.beginSend(fresh, now), false);
        assert.equal((await client.lineLedgerDelivery.findUniqueOrThrow({ where: { id: lineLedgerDeliveryId(entry('6-0')) } })).messagesJson, null);
      });

      await t.test('live and queued final producers cannot both claim the same outward notification', async () => {
        const webhookEventId = `owner-${tag}`;
        await client.lineWebhookEventLog.create({ data: { webhookEventId, companyId, eventType: 'message', status: 'processing' } });
        const claim = await service.claim(entry('7-0', { kind: 'turn', webhookEventId }), now);
        await service.save(claim, messages, auth, completion, now);
        const [queued, live] = await Promise.all([
          service.beginSend(claim, now),
          client.lineWebhookEventLog.updateMany({ where: { webhookEventId, OR: [{ deliveryOwnerId: null }, { deliveryOwnerId: 'webhook' }] }, data: { deliveryOwnerId: 'webhook' } }),
        ]);
        assert.equal(Number(queued) + live.count, 1);
        const owner = (await client.lineWebhookEventLog.findUniqueOrThrow({ where: { webhookEventId } })).deliveryOwnerId;
        assert.equal(owner, queued ? `ledger:${claim.row.id}` : 'webhook');
      });

      await t.test('an already stored live outcome blocks a new queued owner before any send', async () => {
        const webhookEventId = `saved-owner-${tag}`;
        await client.lineWebhookEventLog.create({ data: { webhookEventId, companyId, eventType: 'message', status: 'processing' } });
        await client.lineTurnOutcome.create({ data: { webhookEventId, companyId, messagesJson: messages, presentationKind: 'text' } });
        const claim = await service.claim(entry('8-0', { kind: 'turn', webhookEventId }), now);
        await service.save(claim, messages, auth, completion, now);
        assert.equal(await service.beginSend(claim, now), false);
        assert.equal((await client.lineLedgerDelivery.findUniqueOrThrow({ where: { id: claim.row.id } })).errorCode, 'LINE_ORIGINAL_OUTCOME_OWNS_DELIVERY');
      });

      // Owner 2026-09-30: one re-ask after "the previous answer did not complete" may pass the AI credit cap.
      await t.test('the re-ask pass is spent once, only in the same conversation, only inside its window', async () => {
        const notice = (id: string, conversationId: string, over: Record<string, unknown> = {}) => client.lineLedgerDelivery.create({ data: {
          id: `reask-${id}-${tag}`, companyId, userId, webhookEventId: `reask-${id}-${tag}`, entryId: `${id}-0`, entryKind: 'turn',
          status: 'ACCEPTED', acceptedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
          authorizationJson: { v: 1, staticRefusal: 'original_answer_unavailable' },
          completionJson: { ...completion, status: 'provider_unavailable', refused: true },
          acceptedRequestJson: { conversationId }, ...over,
        } });
        await notice('a', 'conversation-a');
        const pass = { companyId, userId, conversationId: 'conversation-a' };
        assert.equal(await service.consumeReaskPass({ ...pass, conversationId: 'conversation-b' }), false, 'another chat');
        assert.equal(await service.consumeReaskPass({ ...pass, userId: 'another-person' }), false, 'another person');
        assert.deepEqual((await Promise.all([service.consumeReaskPass(pass), service.consumeReaskPass(pass)])).sort(), [false, true], 'spent once');
        assert.equal(await service.consumeReaskPass(pass), false, 'gone after its one use');
        assert.ok(((await client.lineLedgerDelivery.findUniqueOrThrow({ where: { id: `reask-a-${tag}` } })).completionJson as { reaskPassUsedAt?: string }).reaskPassUsedAt);

        await notice('old', 'conversation-old', { acceptedAt: new Date(Date.now() - 31 * 60_000) });
        assert.equal(await service.consumeReaskPass({ ...pass, conversationId: 'conversation-old' }), false, 'the window has ended');
        await notice('other', 'conversation-other', { authorizationJson: { v: 1, staticRefusal: 'feature_disabled' } });
        assert.equal(await service.consumeReaskPass({ ...pass, conversationId: 'conversation-other' }), false, 'only the unfinished-answer notice');
      });
    } finally {
      if (companyId) await client.lineWebhookEventLog.deleteMany({ where: { companyId } });
      if (companyId) await client.company.deleteMany({ where: { id: companyId } });
      if (userId) await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
    }
  });
});
