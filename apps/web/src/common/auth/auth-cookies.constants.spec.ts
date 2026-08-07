import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { joinCookieChunks, splitCookieValue } from './auth-cookies.constants';

describe('auth cookie chunking', () => {
  it('splits values larger than the chunk size and re-joins them losslessly', () => {
    const value = 'x'.repeat(9000) + '.tail';
    const chunks = splitCookieValue(value, 3500);
    assert.equal(chunks.length, 3);
    assert.ok(chunks.every((c) => c.length <= 3500));

    const record = Object.fromEntries(chunks.map((c, i) => [`watchdog_token.${i}`, c]));
    const joined = joinCookieChunks((name) => record[name], 'watchdog_token');
    assert.equal(joined, value);
  });

  it('keeps small values as a single chunk', () => {
    assert.deepEqual(splitCookieValue('short', 3500), ['short']);
  });

  it('prefers the unchunked cookie when present', () => {
    const record: Record<string, string> = { watchdog_token: 'whole', 'watchdog_token.0': 'stale' };
    assert.equal(joinCookieChunks((name) => record[name], 'watchdog_token'), 'whole');
  });

  it('returns undefined when no cookie or chunks exist', () => {
    assert.equal(joinCookieChunks(() => undefined, 'watchdog_token'), undefined);
  });

  it('stops joining at the first missing chunk index', () => {
    const record: Record<string, string> = { 'watchdog_token.0': 'a', 'watchdog_token.2': 'orphan' };
    assert.equal(joinCookieChunks((name) => record[name], 'watchdog_token'), 'a');
  });
});
