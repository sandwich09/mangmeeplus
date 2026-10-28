import assert from 'node:assert/strict';
import test from 'node:test';
import { GHOST_CARDS } from './home-halloween-cards';
import { HALLOWEEN_SEEN_STORAGE_KEY, readHalloweenSeenCards, rememberHalloweenDraw, requestHalloweenDraw } from './home-halloween-draw';

function response(cardId = '01-krasue') {
  return { cardId };
}

test('draw sends an anonymous no-body POST with the current seen cards and accepts the allowlisted card', async () => {
  const expected = response();
  const controller = new AbortController();
  const result = await requestHalloweenDraw(controller.signal, '?cardId=23-mangmee-secret&untrusted=1', ['02-krahang', '03-mae-nak'], async (url, options) => {
    assert.equal(url, '/api/public/halloween/draw');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.signal, controller.signal);
    assert.equal(options?.body, undefined);
    assert.equal(new Headers(options?.headers).get('x-halloween-seen'), '02-krahang,03-mae-nak');
    return Response.json(expected);
  });
  assert.deepEqual(result, expected);
});

test('tab storage remembers only unique normal cards and starts a new cycle after all 22', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  rememberHalloweenDraw(storage, '01-krasue');
  rememberHalloweenDraw(storage, '01-krasue');
  rememberHalloweenDraw(storage, '23-mangmee-secret');
  assert.deepEqual(readHalloweenSeenCards(storage), ['01-krasue']);
  for (const card of GHOST_CARDS.filter(card => card.region !== 'secret')) rememberHalloweenDraw(storage, card.id);
  assert.deepEqual(readHalloweenSeenCards(storage), []);
  assert.equal(values.has(HALLOWEEN_SEEN_STORAGE_KEY), false);
  values.set(HALLOWEEN_SEEN_STORAGE_KEY, JSON.stringify(['23-mangmee-secret']));
  assert.deepEqual(readHalloweenSeenCards(storage), []);
  assert.equal(values.has(HALLOWEEN_SEEN_STORAGE_KEY), false);
});

test('malformed or unknown cards never return a drawable result', async () => {
  for (const invalid of [null, {}, [], '01-krasue', { cardId: '14-sadako' },
    { cardId: '../secret' }, { cardId: 1 }, { cardId: ['01-krasue'] },
  ]) await assert.rejects(requestHalloweenDraw(new AbortController().signal, '', [], async () => Response.json(invalid)), /อ่านร่างวิญญาณไม่ได้/);
});

test('HTTP failure and aborted request do not fall back to local selection', async () => {
  await assert.rejects(requestHalloweenDraw(new AbortController().signal, '', [], async () => new Response(null, { status: 429 })), /รอสักครู่/);
  await assert.rejects(requestHalloweenDraw(new AbortController().signal, '', [], async () => { throw new TypeError('Failed to fetch'); }), /ตรวจการเชื่อมต่อแล้วลองอีกครั้ง/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(requestHalloweenDraw(controller.signal, '', [], async (_url, options) => {
    options?.signal?.throwIfAborted();
    throw new Error('Unexpected fetch');
  }), { name: 'AbortError' });
});

test('only development forwards the exact approved preview query', async () => {
  const environment = process.env.NODE_ENV;
  try {
    for (const [mode, search, suffix] of [
      ['development', '?preview=events&event=halloween&cardId=23-mangmee-secret', '?preview=events&event=halloween'],
      ['development', '?preview=events&event=default', ''],
      ['production', '?preview=events&event=halloween', ''],
    ]) {
      Object.assign(process.env, { NODE_ENV: mode });
      await requestHalloweenDraw(new AbortController().signal, search, [], async url => {
        assert.equal(url, `/api/public/halloween/draw${suffix}`);
        return Response.json(response());
      });
    }
  } finally {
    if (environment === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Object.assign(process.env, { NODE_ENV: environment });
  }
});
