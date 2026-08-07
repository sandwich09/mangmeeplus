import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertWebhookUrlPolicy,
  isPublicWebhookAddress,
  resolveWebhookDestination,
} from './workflow-webhook-security.logic';

describe('workflow webhook SSRF policy', () => {
  it('allows only canonical HTTPS allowlisted hosts', () => {
    assert.equal(assertWebhookUrlPolicy('https://hooks.example.com/path', ['hooks.example.com']).hostname, 'hooks.example.com');
    assert.equal(assertWebhookUrlPolicy('https://a.partner.example/path', ['*.partner.example']).hostname, 'a.partner.example');
    for (const url of [
      'http://hooks.example.com',
      'https://user:pass@hooks.example.com',
      'https://hooks.example.com:8443',
      'https://hooks.example.com/path#fragment',
      'https://evil.example',
      'https://partner.example',
    ]) assert.throws(() => assertWebhookUrlPolicy(url, ['hooks.example.com', '*.partner.example']));
  });

  it('denies every host on an empty allowlist, which is what the deny-all sentinel resolves to', () => {
    for (const url of [
      'https://hooks.example.com/path',
      'https://a.partner.example/path',
      'https://none/path',
    ]) assert.throws(() => assertWebhookUrlPolicy(url, []), /not allowlisted/);
  });

  it('rejects private, loopback, link-local, metadata, reserved, mapped, and transition addresses', () => {
    for (const address of [
      '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
      '172.16.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '::', '::1',
      'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1', '::10.0.0.1',
      '64:ff9b::a00:1', '2002:7f00:1::',
    ]) assert.equal(isPublicWebhookAddress(address), false, address);
    assert.equal(isPublicWebhookAddress('8.8.8.8'), true);
    assert.equal(isPublicWebhookAddress('2606:4700:4700::1111'), true);
  });

  it('rejects IP literals before connecting', async () => {
    await assert.rejects(
      resolveWebhookDestination('https://127.0.0.1/path', ['127.0.0.1']),
      /non-public/,
    );
    await assert.rejects(
      resolveWebhookDestination('https://[::1]/path', ['::1']),
      /non-public/,
    );
  });
});
