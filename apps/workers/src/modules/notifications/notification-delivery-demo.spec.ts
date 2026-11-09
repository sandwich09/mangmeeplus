import { it } from 'node:test';
import assert from 'node:assert/strict';
import { processLineDelivery } from './notification-delivery-adapters.js';

it('worker drops DEMO company/channel/target before credentials or fetch; real delivery remains', async () => {
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return new Response('{}', { status: 200 }); };
    for (const input of [{ lineUserId: 'Vdemocompany' }, { lineUserId: 'vreply:demo-turn' }, { lineUserId: 'real', channelId: 'demo-web' }, { lineUserId: 'real', reportClassification: 'DEMO' }]) {
      assert.equal((await processLineDelivery({ ...input, channelAccessToken: '', message: 'text' })).status, 'suppressed');
    }
    assert.equal(calls, 0);
    assert.equal((await processLineDelivery({ lineUserId: 'real', channelAccessToken: 'token', message: 'text' })).status, 'sent');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
