import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { BadGatewayException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { apiConfigSchema, validateProductionConfig } from '@watchdog-bms/config';
import type { AppConfigService } from '../../common/config/app-config.service';
import { LineOfficialWebhookController } from './presentation/line-official-webhook.controller';

const officialSecret = 'official-oa-test-secret';
const settings = {
  lineOfficialReplyEnabled: true,
  lineOfficialChannelSecret: officialSecret,
  lineOfficialChannelAccessToken: 'official-oa-test-token',
  webBaseUrl: 'https://uat.mangmeeplus.com',
};
function request(events: unknown[], secret = officialSecret) {
  const body = { events };
  const rawBody = Buffer.from(JSON.stringify(body));
  return {
    body, rawBody,
    headers: { 'x-line-signature': createHmac('sha256', secret).update(rawBody).digest('base64') },
  } as unknown as Parameters<LineOfficialWebhookController['webhook']>[0];
}
function message(text: string, source = 'user') {
  return { type: 'message', source: { type: source }, message: { type: 'text', text }, replyToken: 'one-use-reply' };
}
function controller(overrides: Partial<typeof settings> = {}) {
  return new LineOfficialWebhookController({ ...settings, ...overrides } as unknown as AppConfigService);
}

describe('Official OA webhook', () => {
  it('defaults off and does not send even when a signed keyword is supplied', async (t) => {
    const defaults = apiConfigSchema.pick({
      LINE_OFFICIAL_REPLY_ENABLED: true,
      LINE_OFFICIAL_CHANNEL_SECRET: true,
      LINE_OFFICIAL_CHANNEL_ACCESS_TOKEN: true,
    }).parse({});
    assert.equal(defaults.LINE_OFFICIAL_REPLY_ENABLED, false);
    assert.throws(() => validateProductionConfig({
      APP_ENV: 'production', AUTH_PROVIDER: 'password', LINE_OFFICIAL_REPLY_ENABLED: true,
    }), /LINE_OFFICIAL_CHANNEL_SECRET is required when Official OA replies are enabled/);
    const outgoing = t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
    await assert.rejects(controller({ lineOfficialReplyEnabled: false }).webhook(request([message('Social Media')])), NotFoundException);
    assert.equal(outgoing.mock.callCount(), 0);
  });

  it('rejects another OA secret and missing signatures before outbound delivery', async (t) => {
    const outgoing = t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
    await assert.rejects(controller().webhook(request([message('Social Media')], 'system-oa-secret')), UnauthorizedException);
    const unsigned = request([message('Social Media')]);
    unsigned.headers = {};
    await assert.rejects(controller().webhook(unsigned), UnauthorizedException);
    assert.equal(outgoing.mock.callCount(), 0);
  });

  it('routes two known keywords to exactly three correct actions without contact body duplication', async (t) => {
    const deliveries: Array<{ headers: Record<string, string>; body: { messages: any[] } }> = [];
    t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
      deliveries.push({ headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) });
      return new Response('{}', { status: 200 });
    });
    await controller().webhook(request([message(' Social Media '), message('ติดต่อมั่งมีทีม')]));
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries[0].headers.Authorization, 'Bearer official-oa-test-token');
    const social = deliveries[0].body.messages[0];
    assert.equal(social.type, 'flex');
    assert.equal(social.contents.size, 'kilo');
    assert.deepEqual(social.contents.footer.contents.map((row: any) => row.action.uri), [
      'https://www.instagram.com/mangmee_plus?stkn=MXR2M2kwdjl0MnV2',
      'https://www.facebook.com/share/17k2DsH7TJ/',
      'https://www.tiktok.com/@mangmee_plus?_r=1&_t=ZS-9AGf8zsKkJY',
    ]);
    assert.ok(social.contents.footer.contents.every((row: any) => row.contents[0].url.startsWith('https://uat.mangmeeplus.com/assets/line/')));
    const contact = deliveries[1].body.messages[0].contents;
    assert.ok(!JSON.stringify(contact.body).includes('contact@mangmeeplus.com'));
    assert.ok(!JSON.stringify(contact.body).includes('098-256-5628'));
    assert.equal(contact.body.backgroundColor, '#F7F4E8');
    assert.deepEqual(contact.footer.contents.map((button: any) => button.action), [
      { type: 'clipboard', label: 'คัดลอกอีเมล', clipboardText: 'contact@mangmeeplus.com' },
      { type: 'uri', label: 'โทร 098-256-5628', uri: 'tel:0982565628' },
      { type: 'uri', label: 'เว็บไซต์อย่างเป็นทางการ', uri: 'https://mangmeeplus.com/' },
    ]);
  });

  it('accepts provider verification and ignores manual chat, groups and media', async (t) => {
    const outgoing = t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
    assert.deepEqual(await controller().webhook(request([])), {});
    assert.deepEqual(await controller().webhook(request([
      message('สวัสดี'), message('Social Media', 'group'),
      { type: 'follow', replyToken: 'follow-reply' },
      { type: 'message', source: { type: 'user' }, message: { type: 'image' }, replyToken: 'image-reply' },
    ])), {});
    assert.equal(outgoing.mock.callCount(), 0);
  });

  it('acknowledges a used reply token but reports provider failure for redelivery', async (t) => {
    const outgoing = t.mock.method(globalThis, 'fetch', async () =>
      new Response('{"message":"Invalid reply token"}', { status: 400 }));
    assert.deepEqual(await controller().webhook(request([message('Contact Us')])), {});
    outgoing.mock.mockImplementation(async () => new Response('Unavailable', { status: 503 }));
    await assert.rejects(controller().webhook(request([message('Contact Us')])), BadGatewayException);
  });
});
