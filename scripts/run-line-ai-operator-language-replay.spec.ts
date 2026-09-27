import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOperatorLanguageReplay } from './run-line-ai-operator-language-replay';

test('runtime CLI uses the original transport, never the deterministic routing fetch', async (t) => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  const transport = (async (input) => { requests.push(String(input)); return new Response('{"realTransportSentinel":true}'); }) as typeof fetch;
  globalThis.fetch = transport;
  t.mock.method(console, 'log', () => {});
  try {
    await runOperatorLanguageReplay(['node', 'replay', '--reliability-runtime', 'manifest.json'], async (path) => {
      assert.equal(path, 'manifest.json');
      assert.equal(globalThis.fetch, transport);
      assert.deepEqual(await (await fetch('http://127.0.0.1:18992/v1/line-ai/turn')).json(), { realTransportSentinel: true });
      return { boundary: { nativeLineVerified: false } };
    });
    assert.equal(globalThis.fetch, transport);
    assert.deepEqual(requests, ['http://127.0.0.1:18992/v1/line-ai/turn']);
    await assert.rejects(runOperatorLanguageReplay(['node', 'replay', '--reliability-runtime', 'manifest.json'], async () => {
      assert.equal(globalThis.fetch, transport); throw new Error('runtime failed');
    }), /runtime failed/);
    assert.equal(globalThis.fetch, transport);
  } finally { globalThis.fetch = original; }
});
