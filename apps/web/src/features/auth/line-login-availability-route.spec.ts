import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { GET } from '../../../app/api/auth/line-login/availability/route';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

it('keeps configured availability distinct from an upstream failure without exposing channel details', async () => {
  for (const available of [true, false]) {
    globalThis.fetch = async () => Response.json({ line: { available, channelId: 'private-test-channel' } });
    const response = await GET();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { available });
  }
  for (const upstream of [() => Response.json({}, { status: 500 }), () => Response.json({}), () => { throw new Error('offline'); }]) {
    globalThis.fetch = async () => upstream();
    const response = await GET();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { available: false });
  }
});
