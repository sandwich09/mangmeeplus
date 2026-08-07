import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CrmLineWebhookController } from './crm-line-webhook.controller';
import { MessagingChannelSecretsService } from '../../application/use-cases/messaging-channel.use-case';

const KEY = Buffer.alloc(32, 7);
const secrets = new MessagingChannelSecretsService({ credentialEncryptionKey: KEY, publicApiBaseUrl: undefined } as any);
const CHANNEL_SECRET = 'smoke-channel-secret-01';

function channelRecord(overrides: Partial<any> = {}) {
  return {
    id: 'ch-1', companyId: 'co-1', provider: 'LINE_OA', displayName: 'ร้าน',
    lineChannelId: '1234567890',
    encryptedSecretJson: secrets.encrypt({ channelId: '1234567890', channelSecret: CHANNEL_SECRET, accessToken: 'token-token-1234' }),
    credentialLast4: '1234', secretVersion: 1, webhookKey: 'whk-1',
    status: 'ACTIVE', lastWebhookAt: null, lastValidatedAt: null, lastErrorAt: null, lastErrorCode: null,
    connectedByUserId: 'admin-1', disabledAt: null, disabledByUserId: null, disableReason: null,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  } as any;
}

function sign(body: string): string {
  return createHmac('sha256', CHANNEL_SECRET).update(Buffer.from(body)).digest('base64');
}

function makeRequest(body: string, signature?: string) {
  return {
    headers: signature ? { 'x-line-signature': signature } : {},
    rawBody: Buffer.from(body),
    body: JSON.parse(body),
  } as any;
}

function makeController(channel: any) {
  const calls = { touched: [] as any[], processed: [] as any[] };
  const repo = {
    findChannelByWebhookKey: async (key: string) => (channel && key === channel.webhookKey ? channel : null),
    touchChannelWebhook: async (id: string, at: Date, hasCustomerMessage: boolean) => {
      calls.touched.push({ id, at, hasCustomerMessage });
    },
  } as any;
  const processInbound = {
    execute: async (ch: any, events: any[]) => { calls.processed.push({ ch, events }); },
  } as any;
  return { controller: new CrmLineWebhookController(repo, secrets, processInbound), calls };
}

const MESSAGE_BODY = JSON.stringify({
  events: [{ type: 'message', webhookEventId: 'e1', replyToken: 'reply-token-1', source: { userId: 'U1' }, message: { id: 'm1', type: 'text', text: 'สวัสดี' } }],
});
const EMPTY_BODY = JSON.stringify({ events: [] });

describe('CrmLineWebhookController', () => {
  it('unknown webhook key returns a generic 404', async () => {
    const { controller } = makeController(null);
    await assert.rejects(() => controller.receive('nope', makeRequest(MESSAGE_BODY, sign(MESSAGE_BODY))), NotFoundException);
  });

  it('missing signature is 401 even for a disabled channel (no unauthenticated state oracle)', async () => {
    const { controller, calls } = makeController(channelRecord({ status: 'DISABLED' }));
    await assert.rejects(() => controller.receive('whk-1', makeRequest(MESSAGE_BODY)), UnauthorizedException);
    assert.equal(calls.processed.length, 0);
  });

  it('invalid signature is 401 and nothing is processed', async () => {
    const { controller, calls } = makeController(channelRecord());
    await assert.rejects(
      () => controller.receive('whk-1', makeRequest(MESSAGE_BODY, 'aW52YWxpZA==')),
      UnauthorizedException,
    );
    assert.equal(calls.processed.length, 0);
    assert.equal(calls.touched.length, 0);
  });

  it('signed webhook for a DISABLED channel is dropped with 200 and no processing', async () => {
    const { controller, calls } = makeController(channelRecord({ status: 'DISABLED' }));
    const result = await controller.receive('whk-1', makeRequest(MESSAGE_BODY, sign(MESSAGE_BODY)));
    assert.deepEqual(result, {});
    assert.equal(calls.processed.length, 0);
    assert.equal(calls.touched.length, 0);
  });

  it('valid signed message event is processed and marks customer-message activity', async () => {
    const { controller, calls } = makeController(channelRecord({ status: 'CONNECTED' }));
    const before = Date.now();
    const result = await controller.receive('whk-1', makeRequest(MESSAGE_BODY, sign(MESSAGE_BODY)));
    assert.deepEqual(result, {});
    assert.equal(calls.processed.length, 1);
    assert.equal(calls.processed[0].events.length, 1);
    assert.equal(calls.processed[0].events[0].replyToken, 'reply-token-1');
    assert.ok(calls.processed[0].events[0].receivedAt >= before);
    assert.ok(calls.processed[0].events[0].receivedAt <= Date.now());
    assert.equal(calls.touched[0].hasCustomerMessage, true);
    assert.equal(calls.processed[0].ch.status, 'ACTIVE');
  });

  it("LINE console Verify ping (empty events) touches the heartbeat but must NOT claim customer traffic", async () => {
    const { controller, calls } = makeController(channelRecord({ status: 'CONNECTED' }));
    await controller.receive('whk-1', makeRequest(EMPTY_BODY, sign(EMPTY_BODY)));
    assert.equal(calls.touched[0].hasCustomerMessage, false);
  });

  // L-14: a forged webhook signature is a bot signal; it must reach the alarm as a stable
  // dotted event name with a root-level riskLevel, not as an English sentence or nothing at all.
  it('emits line.webhook.signature_invalid with riskLevel=HIGH on a forged signature', async () => {
    const lines: Array<Record<string, unknown>> = [];
    Logger.overrideLogger({
      log: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {},
      warn: (message: unknown) => void lines.push(message as Record<string, unknown>),
    });
    try {
      const { controller } = makeController(channelRecord());
      await assert.rejects(
        () => controller.receive('whk-1', makeRequest(MESSAGE_BODY, 'aW52YWxpZA==')),
        UnauthorizedException,
      );
      const event = lines.find((line) => line['msg'] === 'line.webhook.signature_invalid');
      assert.ok(event, 'the signature rejection must emit line.webhook.signature_invalid');
      assert.equal(event['riskLevel'], 'HIGH');
      assert.equal(event['channelId'], 'ch-1');
    } finally {
      Logger.overrideLogger(false);
    }
  });

  it('renames the disabled-channel drop to a dotted event name (alarm keys cannot be sentences)', async () => {
    const lines: Array<Record<string, unknown>> = [];
    Logger.overrideLogger({
      log: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {},
      warn: (message: unknown) => void lines.push(message as Record<string, unknown>),
    });
    try {
      const { controller } = makeController(channelRecord({ status: 'DISABLED' }));
      await controller.receive('whk-1', makeRequest(MESSAGE_BODY, sign(MESSAGE_BODY)));
      assert.ok(lines.some((line) => line['msg'] === 'line.webhook.channel_disabled'));
    } finally {
      Logger.overrideLogger(false);
    }
  });
});
