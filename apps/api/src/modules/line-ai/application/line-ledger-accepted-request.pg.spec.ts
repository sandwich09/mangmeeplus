import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { AI_BUDGET_PROFILE_TABLE_DIGEST_V2, createLineAiInputEvidence, type AiBudgetGrantV2, type LineAiTurnRequest } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { lineConversationId } from './line-conversation-context.service';
import { freezeAcceptedLedgerRequest, parseAcceptedLedgerRequest } from './line-ledger-accepted-request';
import { LineAiLedgerService, fieldsToEntry, ledgerKey } from './line-ai-ledger.service';
import { LineLedgerDeliveryService } from './line-ledger-delivery.service';
import { FakeRedis } from './line-ai-ledger-redis.fixture';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

async function fixture(tag = 'frozen-fixture') {
  const now = new Date(), chatKey = 'synthetic-private-chat', channelId = 'synthetic-oa';
  const scope = { companyId: tag, userId: `${tag}-user`, webhookEventId: `${tag}-event`, turnId: `${tag}-request`, chatKey, messagingChannelId: channelId };
  const owner = { companyId: tag, userId: scope.userId, membershipId: `${tag}-member`, channel: 'line' as const, channelKind: 'USER' as const, messagingChannelId: channelId, chatKeyHash: hash(chatKey).slice(0, 16) };
  const input = (await createLineAiInputEvidence({ turnKey: `${tag}-turn`, parts: [{ partId: 'part-1', eventIdHash: hash(scope.webhookEventId), acceptedAtMs: now.getTime(), rawText: '  ยอดจ่าย\nเดือนนี้เท่าไหร่🙂  ' }] }))!;
  const grant: AiBudgetGrantV2 = { version: 2, turnKey: input.inputEvidence.turnKey, authorityKind: 'webhook_event', authorityId: 'event-db-id', channelOwnerDigest: hash('owner'), attemptKey: 'attempt-1', monthKey: '2026-09', payerCompanyId: tag,
    model: { provider: 'openai', modelId: 'gpt-4.1-mini', region: 'global' }, allowedProfileIds: ['line-answer/2'], profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
    maxTurnSlots: 2, maxRepairs: 1, admittedAtMs: now.getTime(), workDeadlineAtMs: now.getTime() + 17000, finalDeadlineAtMs: now.getTime() + 20000, nonce: 'nonce', issuerVersion: 'api-1', signature: hash('signature'), nextOrdinal: 1 };
  const request: LineAiTurnRequest = { ...input, requestId: scope.turnId, webhookEventId: scope.webhookEventId, messagePreviewHash: hash(input.messageText).slice(0, 16), budgetGrantV2: grant,
    userContext: { companyId: tag, internalUserId: scope.userId, membershipId: owner.membershipId, lineUserId: chatKey, roles: ['owner'], permissions: ['line.ai.query'], locale: 'th-TH' },
    actorDelegations: { secret: ['single-use-token'] }, responsePreferences: { language: 'th', detail: 'short', presentation: 'prose' }, approvedKnowledge: true, selectedKnowledgeCardIds: ['expense-entry'] };
  return { now, scope, input: { request, ownerEpoch: 3, conversationId: lineConversationId(owner), accessFingerprint: 'original-access' } };
}

test('frozen ledger input keeps raw text/style/grant, removes one-use credentials and rejects transplanted or tampered evidence', async () => {
  const f = await fixture(), frozen = freezeAcceptedLedgerRequest(f.input, f.scope);
  assert.equal(frozen.request.messageText, f.input.request.messageText);
  assert.deepEqual(frozen.request.budgetGrantV2, f.input.request.budgetGrantV2);
  assert.deepEqual(frozen.request.responsePreferences, f.input.request.responsePreferences);
  assert.equal(frozen.request.actorDelegations, undefined);
  assert.ok(f.input.request.actorDelegations, 'caller object is not mutated');
  assert.ok(parseAcceptedLedgerRequest(frozen, f.scope));
  assert.equal(parseAcceptedLedgerRequest(frozen, { ...f.scope, messagingChannelId: 'different-oa' }), null);
  assert.equal(parseAcceptedLedgerRequest(frozen, { ...f.scope, chatKey: 'different-chat' }), null);
  assert.equal(parseAcceptedLedgerRequest({ ...frozen, request: { ...frozen.request, messageText: frozen.request.messageText.trim() } }, f.scope), null);
  assert.equal(parseAcceptedLedgerRequest({ ...frozen, ownerEpoch: 4 }, f.scope), null);
});

const url = process.env.BILLING_TEST_DATABASE_URL;
test('accepted ledger request is durable before Redis, immutable on duplicate enqueue and never reconstructable from Redis alone', { skip: !url }, async () => {
  const address = new URL(url!);
  assert.ok(['localhost', '127.0.0.1'].includes(address.hostname));
  assert.ok(address.pathname.endsWith('_ci') || address.port === '15439' && address.pathname === '/watchdog_bms_ai_reliability_20260927', `refusing to write to ${address.pathname}: only a disposable local *_ci database`);
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const f = await fixture(`ledger-${randomUUID()}`), prisma = { client } as PrismaService;
  const redis = new FakeRedis(), service = new LineAiLedgerService({ lineAiLedgerEnabled: true, lineAiLedgerMaxLen: 200, lineAiLedgerTtlSeconds: 3600 } as never, { log: async () => {} } as never, prisma);
  service.attachClient(redis);
  const delivery = new LineLedgerDeliveryService(prisma), accepted = freezeAcceptedLedgerRequest(f.input, f.scope);
  try {
    await client.company.create({ data: { id: f.scope.companyId, name: 'Synthetic ledger company' } });
    await client.user.create({ data: { id: f.scope.userId, displayName: 'Synthetic user' } });
    const originalXadd = redis.xadd.bind(redis);
    redis.xadd = async (...args) => {
      assert.equal((await client.lineLedgerDelivery.findUniqueOrThrow({ where: { id: accepted.deliveryId } })).acceptedRequestJson && true, true);
      return originalXadd(...args);
    };
    const enqueue = { ...f.scope, text: 'incorrect normalized placeholder', acceptedRequest: f.input, now: f.now };
    const first = await service.appendTurn(enqueue); assert.ok(first);
    const key = ledgerKey(f.scope.companyId, f.scope.chatKey), fields = redis.streams.get(key)!.find(row => row.id === first)!.fields;
    const entry = fieldsToEntry(key, first!, fields)!; assert.ok(entry);
    assert.equal(entry.text, f.input.request.messageText);
    assert.equal((await delivery.claim(entry, f.now)).kind, 'busy', 'foreground retains original paid-work lease');
    const second = await service.appendTurn(enqueue); assert.ok(second);
    assert.equal(await client.lineLedgerDelivery.count({ where: { companyId: f.scope.companyId } }), 1);
    await assert.rejects(service.appendTurn({ ...enqueue, acceptedRequest: { ...f.input, ownerEpoch: 4 } }), /CHANGED/);
    const reclaimed = await delivery.claim(entry, new Date(f.now.getTime() + 20001));
    assert.equal(reclaimed.kind, 'prepare');
    assert.deepEqual(reclaimed.row.acceptedRequestJson, accepted);
    await assert.rejects(delivery.claim({ ...entry, chatKey: 'transplanted-chat' }, new Date(f.now.getTime() + 20002)), /MISSING_OR_CHANGED/);
    await client.lineLedgerDelivery.delete({ where: { id: accepted.deliveryId } });
    await assert.rejects(delivery.claim(entry, new Date(f.now.getTime() + 20003)), /MISSING_OR_CHANGED/);
    const withoutRedis = new LineAiLedgerService({ lineAiLedgerEnabled: false } as never, { log: async () => {} } as never, prisma);
    assert.equal(await withoutRedis.appendTurn(enqueue), null, 'Redis is optional, durable v2 admission is not');
    assert.deepEqual((await client.lineLedgerDelivery.findUniqueOrThrow({ where: { id: accepted.deliveryId } })).acceptedRequestJson, accepted);
    await assert.rejects(withoutRedis.appendTurn({ ...enqueue, acceptedRequest: { ...f.input, ownerEpoch: 4 } }), /CHANGED/);
  } finally {
    await client.company.deleteMany({ where: { id: f.scope.companyId } });
    await client.user.deleteMany({ where: { id: f.scope.userId } });
    await client.$disconnect();
  }
});
