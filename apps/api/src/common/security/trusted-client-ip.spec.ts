import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { trustedClientIp } from './trusted-client-ip';

function request(xForwardedFor?: string | string[], remoteAddress = '10.0.0.5') {
  return {
    headers: xForwardedFor === undefined ? {} : { 'x-forwarded-for': xForwardedFor },
    socket: { remoteAddress },
  } as any;
}

describe('trustedClientIp', () => {
  it('uses the last non-empty X-Forwarded-For hop', () => {
    assert.equal(trustedClientIp(request('spoofed, 198.51.100.7,  ')), '198.51.100.7');
  });

  it('ignores spoofed XFF when the TCP peer is not the trusted private proxy tier', () => {
    assert.equal(trustedClientIp(request('1.2.3.4', '203.0.113.10')), '203.0.113.10');
  });

  it('ignores client-prepended hops', () => {
    assert.equal(trustedClientIp(request('203.0.113.1, 203.0.113.2, 198.51.100.7')), '198.51.100.7');
  });

  it('falls back to the socket remote address', () => {
    assert.equal(trustedClientIp(request(undefined, '192.0.2.9')), '192.0.2.9');
  });
});
