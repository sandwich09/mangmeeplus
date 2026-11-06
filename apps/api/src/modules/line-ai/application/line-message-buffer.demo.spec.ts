import 'reflect-metadata';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { LineMessageBufferService } from './line-message-buffer.service';

it('a demo greeting cannot initialize a legacy buffer before the first AI question', async () => {
  for (const classification of ['DEMO', 'CUSTOMER']) {
    const service: any = new LineMessageBufferService({ client: {
      company: { findUnique: async ({ where }: any) => { assert.equal(where.id, 'one'); return { reportClassification: classification }; } },
      lineWebhookEventLog: { create: async () => ({}) },
    } } as any, { lineAiReliabilityV2Mode: 'off', lineAiDeliveryPlanV2Enabled: false, lineAiBufferDebounceMs: 1000 } as any, {} as any,
    { startLoadingAnimation: async () => true } as any, {} as any);
    service.kickWorker = () => {}; service.scheduleFlush = () => {}; service.dispatchBatch = async () => {};
    await service.enqueue({ chatId: 'Vdemoone', lineUserId: 'Vdemoone', messagingChannelId: 'demo-web', channelKind: 'USER',
      item: { kind: 'text', text: 'เพิ่มเพื่อนใหม่', webhookEventId: 'event', replyToken: 'vreply:token', timestamp: Date.now() } });
    assert.equal([...service.chats.values()][0].reliabilityV2, classification === 'DEMO');
    service.chats.clear();
  }
});
