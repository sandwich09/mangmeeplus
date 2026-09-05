import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, HttpException, ValidationPipe } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import { AuthRateLimitService } from '../../../auth/application/auth-rate-limit.service';
import { CustomerLineRegisterController, CustomerLineRegisterDto } from './customer-line-register.controller';

describe('CustomerLineRegisterController rate limit key', () => {
  it('does not let a spoofed first XFF hop create a fresh bucket', async () => {
    const rateLimit = new AuthRateLimitService({
      customerRegisterMaxPerIpChannel: 1,
      customerRegisterWindowSeconds: 60,
    } as any);
    const registrations: any[] = [];
    const controller = new CustomerLineRegisterController(
      {} as any,
      rateLimit,
      { execute: async (input: any) => { registrations.push(input); return { customerId: 'customer-1' }; } } as any,
      {} as any,
      {} as any,
    );
    const dto = { idToken: 'token', lineChannelId: 'line-channel-1', consent: true };

    await controller.customerRegister(dto, {
      headers: { 'x-forwarded-for': 'spoof-a, 198.51.100.7' },
      socket: { remoteAddress: '10.0.0.5' },
    } as any);

    await assert.rejects(
      () => controller.customerRegister(dto, {
        headers: { 'x-forwarded-for': 'spoof-b, 198.51.100.7' },
        socket: { remoteAddress: '10.0.0.5' },
      } as any),
      HttpException,
    );
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].ipAddress, '198.51.100.7');
  });
});

describe('CustomerLineRegisterController LIFF page security (H-08)', () => {
  it('does not reflect a closing-script channel payload or query it in storage', async () => {
    const payload = '</script><script>globalThis.__h08_customer_xss__=true</script>';
    let channelLookups = 0;
    const controller = new CustomerLineRegisterController(
      { lineLiffId: '1234567890-test' } as any,
      {} as any,
      {} as any,
      { findActiveChannelByLineChannelId: async () => { channelLookups += 1; return null; } } as any,
      {} as any,
    );

    const html = await controller.customerRegisterPage({
      url: `/v1/auth/line/customer-register-page?lineChannelId=${encodeURIComponent(payload)}`,
      headers: {},
      protocol: 'https',
      get: () => 'api.example.test',
    } as any);

    assert.equal(channelLookups, 0);
    assert.equal(html.includes(payload), false);
    assert.equal(html.includes('__h08_customer_xss__'), false);
    assert.match(html, /data-client-compatibility-notice="generic"/);
    assert.match(html, /id="liff-content"/);
    // Built by the shared liffPageHtml since the round-3 review, so it carries the มั่งมี theme and
    // the message tones. dvh, not vh: a phone browser's collapsing address bar makes vh lie.
    assert.match(html, /<header class="brand">/);
    assert.match(html, /\.notice-warning\{background:/);
    assert.match(html, /max-height:40dvh/);
    assert.equal(html.includes('max-height:40vh'), false, 'vh is banned on mobile surfaces');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.equal(scripts.length, 2);
    assert.ok(scripts.every(([, attributes, body]) => /\bsrc="[^"]+"/.test(attributes!) && body!.trim() === ''));
  });

  it('uses no-inline-script CSP/no-referrer and rejects malformed token/channel bodies', async () => {
    const headers = Object.fromEntries(
      ((Reflect.getMetadata(HEADERS_METADATA, CustomerLineRegisterController.prototype.customerRegisterPage) ?? []) as Array<{ name: string; value: string }>)
        .map(({ name, value }) => [name.toLowerCase(), value]),
    ) as Record<string, string>;
    const scriptSrc = headers['content-security-policy']!.split(';').find((directive) => directive.trim().startsWith('script-src'))!;
    assert.equal(scriptSrc.includes("'unsafe-inline'"), false);
    assert.equal(headers['referrer-policy'], 'no-referrer');

    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    for (const body of [
      { idToken: 'not-a-jwt', lineChannelId: 'line-channel-1', consent: true },
      { idToken: 'header.payload.signature', lineChannelId: '</script>', consent: true },
      { idToken: 'header.payload.signature', lineChannelId: 'x'.repeat(129), consent: true },
    ]) {
      await assert.rejects(
        () => pipe.transform(body, { type: 'body', metatype: CustomerLineRegisterDto }),
        BadRequestException,
      );
    }
  });
});
