import assert from 'node:assert/strict';
import test from 'node:test';
import { requestHalloweenDraw } from './home-halloween-draw';

function response(cardId = '01-krasue') {
  return { cardId };
}

test('draw sends an anonymous no-body POST and accepts the allowlisted card', async () => {
  const expected = response();
  const controller = new AbortController();
  const result = await requestHalloweenDraw(controller.signal, '?cardId=23-mangmee-secret&untrusted=1', async (url, options) => {
    assert.equal(url, '/api/public/halloween/draw');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.signal, controller.signal);
    assert.equal(options?.body, undefined);
    return Response.json(expected);
  });
  assert.deepEqual(result, expected);
});

test('malformed or unknown cards never return a drawable result', async () => {
  for (const invalid of [null, {}, [], '01-krasue', { cardId: '14-sadako' },
    { cardId: '../secret' }, { cardId: 1 }, { cardId: ['01-krasue'] },
  ]) await assert.rejects(requestHalloweenDraw(new AbortController().signal, '', async () => Response.json(invalid)), /อ่านร่างวิญญาณไม่ได้/);
});

test('HTTP failure and aborted request do not fall back to local selection', async () => {
  await assert.rejects(requestHalloweenDraw(new AbortController().signal, '', async () => new Response(null, { status: 429 })), /รอสักครู่/);
  await assert.rejects(requestHalloweenDraw(new AbortController().signal, '', async () => { throw new TypeError('Failed to fetch'); }), /ตรวจการเชื่อมต่อแล้วลองอีกครั้ง/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(requestHalloweenDraw(controller.signal, '', async (_url, options) => {
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
      await requestHalloweenDraw(new AbortController().signal, search, async url => {
        assert.equal(url, `/api/public/halloween/draw${suffix}`);
        return Response.json(response());
      });
    }
  } finally {
    if (environment === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Object.assign(process.env, { NODE_ENV: environment });
  }
});
