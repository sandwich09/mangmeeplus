import 'reflect-metadata';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { pushLineMessages, pushSystemLineMessage, pushSystemLineMessages } from './system-line-push';
import { pushLineMessage } from '../../dashboard-notifications/application/use-cases/notification.use-cases';

it('system and dashboard direct pushes drop virtual destinations without fetch', async () => {
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return new Response('{}', { status: 200 }); };
    assert.equal(await pushSystemLineMessage('token', 'Vdemocompany', 'text'), true);
    assert.equal(await pushSystemLineMessages('token', 'Vdemocompany', [{ type: 'text', text: 'text' }]), true);
    assert.deepEqual(await pushLineMessages({ token: 'token', channelId: 'demo-web', lineUserId: 'U-real', messages: [] }), { ok: true });
    assert.deepEqual(await pushLineMessages({ token: 'token', isDemo: true, lineUserId: 'U-real', messages: [] }), { ok: true });
    assert.equal((await pushLineMessage('token', 'Vdemocompany', { type: 'flex', altText: 'text', contents: {} }, 'delivery')).status, 'suppressed');
    assert.equal((await pushLineMessage('token', 'U-real', { type: 'flex', altText: 'text', contents: {} }, 'delivery', 'demo-web')).status, 'suppressed');
    assert.equal(calls, 0);
    assert.equal(await pushSystemLineMessage('token', 'U-real', 'text'), true); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
