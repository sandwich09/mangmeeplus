import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeThemeForRequest } from './home-theme.server';

test('production ignores preview overrides and fetches current persisted choice without cache or credentials', async () => {
  let persisted = 'halloween';
  let reads = 0;
  const fetcher: typeof fetch = async (url, init) => {
    assert.match(String(url), /\/v1\/public\/home-theme$/);
    assert.equal(init?.cache, 'no-store');
    assert.ok(init?.signal);
    assert.equal(init?.headers, undefined);
    reads++;
    return Response.json({ event: persisted });
  };
  const params = { preview: 'events', event: 'default', palette: 'forest' };
  assert.deepEqual(await homeThemeForRequest(params, 'production', fetcher), { event: 'halloween', preview: false });
  persisted = 'default';
  assert.deepEqual(await homeThemeForRequest({ ...params, event: 'halloween' }, 'production', fetcher), { event: 'default', preview: false });
  assert.equal(reads, 2);
  assert.deepEqual(await homeThemeForRequest({ ...params, event: 'halloween' }, 'development', fetcher), { event: 'halloween', preview: true });
  assert.equal(reads, 2);
});

test('unavailable, malformed, removed and untrusted event values preserve the normal page', async () => {
  for (const payload of [null, {}, { event: 'removed' }, { event: '__proto__' }, { event: ['halloween'] }, { event: 1 }]) {
    assert.deepEqual(await homeThemeForRequest({}, 'production', async () => Response.json(payload)), { event: 'default', preview: false });
  }
  for (const fetcher of [
    async () => new Response('unavailable', { status: 503 }),
    async () => new Response('not-json'),
    async () => { throw new Error('network'); },
    async (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))),
  ]) {
    const keepAlive = setTimeout(() => {}, 2000);
    try { assert.equal((await homeThemeForRequest({}, 'production', fetcher)).event, 'default'); }
    finally { clearTimeout(keepAlive); }
  }
});
