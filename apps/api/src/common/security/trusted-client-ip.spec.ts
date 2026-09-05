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

  // H-3: prod chain is browser -> CF Worker -> ECS gateway -> proxy, so the rightmost hop is
  // Cloudflare's egress IP. Keying on it puts every visitor behind one colo in one bucket.
  it('skips the Cloudflare egress hop and keys on the visitor', () => {
    assert.equal(trustedClientIp(request('spoofed, 203.0.113.55, 172.71.14.9')), '203.0.113.55');
    assert.equal(trustedClientIp(request('203.0.113.55, 2a06:98c0::1')), '203.0.113.55');
  });

  it('skips a private hop appended after Cloudflare', () => {
    assert.equal(trustedClientIp(request('203.0.113.55, 104.16.0.1, 10.0.0.7')), '203.0.113.55');
  });

  it('never returns a client-asserted address that merely looks like Cloudflare', () => {
    // Direct-to-origin: the gateway appends the real peer, so the CF-range hop stays ignored.
    assert.equal(trustedClientIp(request('172.71.14.9, 203.0.113.55')), '203.0.113.55');
    // Degenerate all-Cloudflare chain must fall back to the peer, not to asserted input.
    assert.equal(trustedClientIp(request('172.71.14.9')), '10.0.0.5');
  });

  // Review R06: the claim BFF is co-located with the API in the api-web container, so it reaches
  // it over loopback and its forwarded chain IS trusted — that is the whole trust boundary. These
  // already pass; they are here so the property is named and a change to the walk has to face it.
  it('keys a BFF-forwarded chain on the visitor, one bucket per visitor', () => {
    assert.equal(trustedClientIp(request('203.0.113.55, 172.71.14.9', '127.0.0.1')), '203.0.113.55');
    assert.equal(trustedClientIp(request('198.51.100.7, 172.71.14.9', '127.0.0.1')), '198.51.100.7');
  });

  it('ignores the same chain when the caller is not the trusted tier', () => {
    // A public client that forges the header reaches the API through the gateway, which appends the
    // hop it actually observed — so the forged value is never the rightmost untrusted one.
    assert.equal(trustedClientIp(request('203.0.113.55, 172.71.14.9', '198.51.100.99')), '198.51.100.99');
    assert.equal(trustedClientIp(request('203.0.113.55', '198.51.100.99')), '198.51.100.99');
  });

  it('treats addresses just outside the Cloudflare ranges as visitors', () => {
    assert.equal(trustedClientIp(request('2a06:98c8::1')), '2a06:98c8::1');
    assert.equal(trustedClientIp(request('104.28.0.1')), '104.28.0.1');
  });
});
