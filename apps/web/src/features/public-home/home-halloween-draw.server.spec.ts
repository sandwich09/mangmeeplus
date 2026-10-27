import assert from 'node:assert/strict';
import test from 'node:test';
import { handleHalloweenDraw } from './home-halloween-draw.server';
import { getGhostCard } from './home-halloween-cards';

const environment = { NODE_ENV: 'production' as const };
const request = (suffix = '', init: RequestInit = {}) => new Request(`https://mangmeeplus.com/api/public/halloween/draw${suffix}`, { method: 'POST', headers: { origin: 'https://mangmeeplus.com', 'sec-fetch-site': 'same-origin' }, ...init });

test('production draws without a signing key while preserving theme, origin, body and no-store guards', async () => {
  let reads = 0;
  const enabled: typeof fetch = async () => { reads++; return Response.json({ event: 'halloween' }); };
  const response = await handleHalloweenDraw(request(), environment, enabled);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.equal(response.headers.get('set-cookie'), null);
  const result = await response.json();
  assert.deepEqual(Object.keys(result), ['cardId']);
  assert.ok(getGhostCard(result.cardId));
  const streamRequest = new Request('https://mangmeeplus.com/api/public/halloween/draw', { method: 'POST', body: new ReadableStream({ start(controller) { controller.close(); } }), duplex: 'half' } as RequestInit);
  assert.equal((await handleHalloweenDraw(streamRequest, environment, enabled)).status, 200);
  assert.equal((await handleHalloweenDraw(request('?preview=events&event=halloween'), environment, async () => Response.json({ event: 'default' }))).status, 404);
  assert.equal((await handleHalloweenDraw(request(), environment, async () => { throw new Error('offline'); })).status, 404);
  const previousReads = reads;
  for (const candidate of [request('?cardId=23-mangmee-secret'), request('', { body: JSON.stringify({ cardId: '23-mangmee-secret' }) })]) {
    assert.equal((await handleHalloweenDraw(candidate, environment, enabled)).status, 400);
  }
  const spoofedEmpty = new Request('https://mangmeeplus.com/api/public/halloween/draw', { method: 'POST', headers: { 'content-length': '0' }, body: 'untrusted' });
  assert.equal((await handleHalloweenDraw(spoofedEmpty, environment, enabled)).status, 400);
  for (const headers of [{ origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }] as Record<string, string>[]) {
    assert.equal((await handleHalloweenDraw(request('', { headers }), environment, enabled)).status, 403);
  }
  assert.equal((await handleHalloweenDraw(request('', { method: 'GET' }), environment, enabled)).status, 405);
  assert.equal(reads, previousReads);
  assert.equal((await handleHalloweenDraw(request('?preview=events&event=halloween'), { NODE_ENV: 'development' }, async () => { throw new Error('must not fetch for dev preview'); })).status, 200);
  const controller = new AbortController(); controller.abort();
  assert.equal((await handleHalloweenDraw(request('', { signal: controller.signal }), environment, enabled)).status, 408);
});

test('anonymous traffic bound rejects bursts before additional theme reads or draws', async () => {
  let reads = 0;
  const enabled: typeof fetch = async () => { reads++; return Response.json({ event: 'halloween' }); };
  const responses = await Promise.all(Array.from({ length: 40 }, () => handleHalloweenDraw(request(), environment, enabled)));
  const refused = responses.filter(response => response.status === 429);
  assert.ok(refused.length > 0);
  assert.equal(reads, responses.filter(response => response.status === 200).length);
  for (const response of refused) { assert.equal(response.headers.get('retry-after'), '1'); assert.match(response.headers.get('cache-control')!, /no-store/); }
});
