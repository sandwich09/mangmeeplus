import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { forwardedClientHeaders } from './forwarded-client-headers';

function incoming(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

describe('forwardedClientHeaders', () => {
  it('forwards the chain so the API audits the visitor, not this container', () => {
    assert.deepEqual(
      forwardedClientHeaders(incoming({ 'x-forwarded-for': '203.0.113.55, 172.71.14.9' })),
      { 'x-forwarded-for': '203.0.113.55, 172.71.14.9' },
    );
  });

  it('sends nothing when there is no chain, so the API falls back to the real peer', () => {
    assert.deepEqual(forwardedClientHeaders(incoming({})), {});
    assert.deepEqual(forwardedClientHeaders(incoming({ 'x-forwarded-for': '   ' })), {});
    assert.deepEqual(forwardedClientHeaders(incoming({ 'x-forwarded-for': ' , , ' })), {});
  });

  it('normalises whitespace and drops empty hops', () => {
    assert.deepEqual(
      forwardedClientHeaders(incoming({ 'x-forwarded-for': ' 203.0.113.55 ,, 172.71.14.9  ' })),
      { 'x-forwarded-for': '203.0.113.55, 172.71.14.9' },
    );
  });

  it('caps an oversized attacker-supplied chain, keeping the hops the infrastructure appended', () => {
    const chain = Array.from({ length: 40 }, (_, index) => `10.0.0.${index}`);
    const forwarded = forwardedClientHeaders(incoming({ 'x-forwarded-for': chain.join(',') }));

    const hops = forwarded['x-forwarded-for']!.split(', ');
    assert.equal(hops.length, 8);
    // trustedClientIp walks right-to-left, so the RIGHT end is the end that must survive.
    assert.equal(hops[hops.length - 1], '10.0.0.39');
  });

  it('forwards nothing else — only x-forwarded-for is read by trustedClientIp', () => {
    const forwarded = forwardedClientHeaders(incoming({
      'x-forwarded-for': '203.0.113.55',
      'x-real-ip': '203.0.113.55',
      cookie: 'session=secret',
      authorization: 'Bearer secret',
    }));
    assert.deepEqual(Object.keys(forwarded), ['x-forwarded-for']);
  });
});
