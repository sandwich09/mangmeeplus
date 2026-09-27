import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { LineMessageBufferService, type LineBufferEnvelope } from './line-message-buffer.service';
import { parseBufferEnvelope } from './use-cases/recover-orphan-line-events.use-case';
import { verifyLineAiInputEvidence } from '@watchdog-bms/contracts';
const url = process.env.BILLING_TEST_DATABASE_URL;
test('v2 raw batch freezes all parts transactionally before dispatch and survives flag-off replay', { skip: !url }, async () => {
  const parsed = new URL(url!);
  assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.ok(parsed.port === '15439' && parsed.pathname === '/watchdog_bms_ai_reliability_20260927' || parsed.port === '5432' && parsed.pathname === '/watchdog_postmark_ci');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const id = randomUUID(), ids = [`${id}-1`, `${id}-2`, `${id}-3`], events: any[] = [];
  const config: any = { lineAiBufferDebounceMs: 60_000, lineAiBufferMaxWaitMs: 60_000,
    lineAiReliabilityV2Mode: 'on', lineAiReliabilityV2CompanyIds: ['company-1'],
    lineAiDeliveryPlanV2Enabled: true, lineAiDeliveryPlanV2WriteCompanyIds: ['company-1'], lineAiDeliveryPlanV2PublicChannelIds: [] };
  const make = (cfg: any) => new LineMessageBufferService({ client } as any, cfg, { log: async () => {} } as any,
    { buildTextMessage: (text: string) => ({ type: 'text', text }), sendReply: async () => 'ok' } as any,
    { preflightLegalAcceptance: async () => ({ status: 'continue', companyId: 'company-1' }), execute: async (event: any) => {
      // The entire coalesced input must already be durable when the first downstream call runs.
      const row = await client.lineWebhookEventLog.findUniqueOrThrow({ where: { webhookEventId: event.webhookEventId } });
      const stored = parseBufferEnvelope(row.payloadJson)!;
      assert.equal(stored.item.kind, 'text');
      if (stored.item.kind === 'text') assert.deepEqual(stored.item.inputEvidence, event.inputEvidence);
      events.push(event);
    } } as any);
  const service = make(config);
  const envelope = (i: number, text: string, channel = 'oa-A'): LineBufferEnvelope => ({ chatId: 'U1', lineUserId: 'U1', messagingChannelId: channel,
    item: { kind: 'text', webhookEventId: ids[i]!, replyToken: `rt-${i}`, text, timestamp: Date.now() } });
  try {
    const rawA = 'Case ABC\n' + 'ก'.repeat(3900), rawB = 'Case xyz\n' + 'ข'.repeat(5000);
    await service.enqueue(envelope(0, rawA)); await service.enqueue(envelope(1, rawB));
    await service.enqueue(envelope(2, 'OA-B must stay separate', 'oa-B'));
    await service.onModuleDestroy();
    assert.equal(events.length, 2);
    const joined = events.find(e => e.webhookEventId === ids[1]);
    assert.equal(joined.messageText, `${rawA}\n${rawB}`);
    assert.ok(await verifyLineAiInputEvidence(joined.inputEvidence, joined.messageText));
    assert.equal(joined.inputEvidence.parts.length, 2);
    assert.equal((await client.lineWebhookEventLog.findUniqueOrThrow({ where: { webhookEventId: ids[0] } })).status, 'batched');
    const stored = parseBufferEnvelope((await client.lineWebhookEventLog.findUniqueOrThrow({ where: { webhookEventId: ids[1] } })).payloadJson)!;
    await client.lineWebhookEventLog.update({ where: { webhookEventId: ids[1] }, data: { createdAt: new Date(Date.now() - 180_000) } });
    const replay = make({ ...config, lineAiReliabilityV2Mode: 'off', lineAiDeliveryPlanV2Enabled: false });
    await replay.enqueue(stored); await replay.onModuleDestroy();
    assert.deepEqual(events.at(-1).inputEvidence, joined.inputEvidence);
    assert.equal(events.at(-1).messageText, joined.messageText);
  } finally {
    await service.onModuleDestroy();
    await client.lineWebhookEventLog.deleteMany({ where: { webhookEventId: { in: ids } } });
    await client.$disconnect();
  }
});
