import { lineMessagingCredentialsFixture } from '../../common/config/line-messaging-credentials.fixture';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { LineWebhookController } from './presentation/line-webhook.controller';

function sign(rawBody: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

function makeController(enqueueImpl?: (envelope: unknown) => Promise<void>, draftEditEnabled = false) {
  const enqueued: any[] = [];
  const controller = new LineWebhookController(lineMessagingCredentialsFixture({
      lineMessagingChannelSecret: 'line-secret',
      lineMessagingChannelId: 'msg-channel-1',
    } as any),
    {
      lineMessagingChannelSecret: 'line-secret',
      lineMessagingChannelId: 'msg-channel-1',
      lineAiDraftEditEnabled: draftEditEnabled,
    } as any,
    {
      enqueue: async (envelope: unknown) => {
        enqueued.push(envelope);
        if (enqueueImpl) await enqueueImpl(envelope);
      },
    } as any,
  );
  return { controller, enqueued };
}

function requestFor(payload: Record<string, unknown>) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return {
    headers: { 'x-line-signature': sign(rawBody, 'line-secret') },
    rawBody,
    body: JSON.parse(rawBody.toString('utf8')),
  } as any;
}

describe('LineWebhookController', () => {
  it('verifies signature against raw body and enqueues with canonical server channel id', async () => {
    const { controller, enqueued } = makeController();
    const result = await controller.lineWebhook(requestFor({
      destination: 'bot',
      events: [{
        type: 'message', webhookEventId: 'evt-1', replyToken: 'reply-1', timestamp: 1751700000000,
        source: { type: 'user', userId: 'line-user-1' },
        message: { type: 'text', id: 'mid-1', text: ' low stock? ' },
      }],
    }));

    assert.deepEqual(result, {});
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].messagingChannelId, 'msg-channel-1');
    assert.equal(enqueued[0].chatId, 'line-user-1');
    assert.equal(enqueued[0].lineUserId, 'line-user-1');
    assert.equal(enqueued[0].item.kind, 'text');
    assert.equal(enqueued[0].item.webhookEventId, 'evt-1');
    assert.equal(enqueued[0].item.timestamp, 1751700000000);
  });

  it('acks 200 without waiting for turn processing (enqueue is the only await)', async () => {
    // Processing happens on the buffer's worker, never inside the request.
    // The controller must resolve even though no turn has run at all.
    const { controller, enqueued } = makeController();
    const result = await controller.lineWebhook(requestFor({
      events: [{
        type: 'message', webhookEventId: 'evt-fast', replyToken: 'reply-1',
        source: { userId: 'line-user-1' },
        message: { type: 'text', text: 'ขอรายชื่อลูกค้า' },
      }],
    }));
    assert.deepEqual(result, {});
    assert.equal(enqueued.length, 1);
  });

  it('maps group chats to a group-scoped chat id', async () => {
    const { controller, enqueued } = makeController();
    await controller.lineWebhook(requestFor({
      events: [{
        type: 'message', webhookEventId: 'evt-g1', replyToken: 'reply-g1',
        source: { type: 'group', groupId: 'group-77', userId: 'line-user-1' },
        message: { type: 'text', text: 'ยอดขายวันนี้' },
      }],
    }));
    assert.equal(enqueued[0].chatId, 'group-77');
    assert.equal(enqueued[0].lineUserId, 'line-user-1');
  });

  it('maps only the rich-menu talk postback to the deterministic greeting command', async () => {
    const { controller, enqueued } = makeController();
    await controller.lineWebhook(requestFor({
      events: [
        {
          type: 'postback', webhookEventId: 'evt-talk', replyToken: 'reply-talk', timestamp: 1751700000000,
          source: { type: 'user', userId: 'line-user-1' },
          postback: { data: 'action=line-rich-talk' },
        },
        {
          type: 'postback', webhookEventId: 'evt-other', replyToken: 'reply-other',
          source: { type: 'user', userId: 'line-user-1' },
          postback: { data: 'action=unrelated' },
        },
      ],
    }));

    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].item.kind, 'text');
    assert.equal(enqueued[0].item.text, 'คุยกับน้องมั่งมี');
    assert.equal(enqueued[0].item.webhookEventId, 'evt-talk');
    assert.equal(enqueued[0].item.timestamp, 1751700000000);
  });

  it('maps the promotion card callback postback to its command words, carrying no id (G19)', async () => {
    const { controller, enqueued } = makeController();
    await controller.lineWebhook(requestFor({
      events: [{
        type: 'postback', webhookEventId: 'evt-callback', replyToken: 'reply-callback',
        source: { type: 'user', userId: 'line-user-1' },
        postback: { data: 'action=package-callback' },
      }],
    }));
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].item.kind, 'text');
    assert.equal(enqueued[0].item.text, 'ให้ทีมงานติดต่อกลับ');
  });

  it('passes only a strictly shaped preview id with draft confirm/cancel postbacks', async () => {
    const { controller, enqueued } = makeController(undefined, true);
    const previewId = '550e8400-e29b-41d4-a716-446655440000';
    await controller.lineWebhook(requestFor({
      events: [
        { type: 'postback', webhookEventId: 'draft-confirm', replyToken: 'c', source: { userId: 'u1' },
          postback: { data: `action=draft-update-confirm&previewId=${previewId}` } },
        { type: 'postback', webhookEventId: 'draft-cancel', replyToken: 'x', source: { userId: 'u1' },
          postback: { data: `action=draft-update-cancel&previewId=${previewId}` } },
        { type: 'postback', webhookEventId: 'draft-old-card', replyToken: 'o', source: { userId: 'u1' },
          postback: { data: 'action=draft-update-confirm' } },
        { type: 'postback', webhookEventId: 'draft-duplicate-id', replyToken: 'd', source: { userId: 'u1' },
          postback: { data: `action=draft-update-confirm&previewId=${previewId}&previewId=${previewId}` } },
      ],
    }));

    assert.deepEqual(enqueued.map((row) => row.item.text), [
      'ยืนยันการแก้ไข', 'ยกเลิกการแก้ไข', 'ยืนยันการแก้ไข', 'ยืนยันการแก้ไข',
    ], 'synthetic command text stays stable for atomic fast dispatch');
    assert.deepEqual(enqueued.map((row) => row.item.draftUpdatePreviewId), [previewId, previewId, undefined, undefined]);
  });

  it('enqueues image and file messages as media items', async () => {
    const { controller, enqueued } = makeController();
    await controller.lineWebhook(requestFor({
      events: [
        {
          type: 'message', webhookEventId: 'evt-img', replyToken: 'reply-img',
          source: { userId: 'line-user-1' },
          message: { type: 'image', id: 'mid-img' },
        },
        {
          type: 'message', webhookEventId: 'evt-file', replyToken: 'reply-file',
          source: { userId: 'line-user-1' },
          message: { type: 'file', id: 'mid-file', fileName: 'bill.pdf', fileSize: 1024 },
        },
      ],
    }));
    assert.equal(enqueued.length, 2);
    assert.equal(enqueued[0].item.kind, 'media');
    assert.equal(enqueued[0].item.messageType, 'image');
    assert.equal(enqueued[1].item.messageType, 'file');
    assert.equal(enqueued[1].item.fileName, 'bill.pdf');
  });

  it('skips non-message events and keeps processing the rest', async () => {
    const { controller, enqueued } = makeController();
    await controller.lineWebhook(requestFor({
      events: [
        { type: 'follow', webhookEventId: 'evt-follow', source: { userId: 'line-user-1' } },
        {
          type: 'message', webhookEventId: 'evt-2', replyToken: 'reply-2',
          source: { userId: 'line-user-1' },
          message: { type: 'text', text: 'สวัสดี' },
        },
      ],
    }));
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].item.webhookEventId, 'evt-2');
  });

  it('rejects the webhook when enqueue fails so LINE can redeliver it', async () => {
    const { controller, enqueued } = makeController(async (envelope: any) => {
      if (envelope.item.webhookEventId === 'evt-bad') throw new Error('db down');
    });
    await assert.rejects(
      () => controller.lineWebhook(requestFor({
        events: [
          { type: 'message', webhookEventId: 'evt-bad', replyToken: 'r1', source: { userId: 'u1' }, message: { type: 'text', text: 'a' } },
          { type: 'message', webhookEventId: 'evt-good', replyToken: 'r2', source: { userId: 'u1' }, message: { type: 'text', text: 'b' } },
        ],
      })),
      /db down/,
    );
    assert.equal(enqueued.length, 1, 'the request stops so the full LINE payload can be redelivered');
  });

  it('rejects invalid signature before enqueueing', async () => {
    const { controller, enqueued } = makeController();
    const rawBody = Buffer.from('{"events":[]}');
    await assert.rejects(
      () => controller.lineWebhook({
        headers: { 'x-line-signature': sign(Buffer.from('other'), 'line-secret') },
        rawBody,
        body: { events: [] },
      } as any),
      (error: unknown) => error instanceof UnauthorizedException,
    );
    assert.equal(enqueued.length, 0);
  });

  it('rejects when raw body is unavailable', async () => {
    const { controller } = makeController();
    await assert.rejects(
      () => controller.lineWebhook({ headers: { 'x-line-signature': 'sig' }, body: { events: [] } } as any),
      (error: unknown) => error instanceof UnauthorizedException,
    );
  });
});
