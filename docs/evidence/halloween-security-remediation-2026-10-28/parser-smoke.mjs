// Local, bounded regression probe for the resolved Express/body-parser dependency.
// Run from the workspace root: node docs/evidence/halloween-security-remediation-2026-10-28/parser-smoke.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

const requireApi = createRequire(new URL('../../../apps/api/package.json', import.meta.url));
const express = requireApi('express');
const results = [];

for (const inflate of [false, true]) {
  const app = express();
  app.use(express.json({ limit: '1kb', inflate }));
  app.post('/probe', (req, res) => res.json(req.body));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ type: error.type }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = (body, encoding) => fetch(`${origin}/probe`, {
    method: 'POST', body, signal: AbortSignal.timeout(2000),
    headers: { 'content-type': 'application/json', ...(encoding ? { 'content-encoding': encoding } : {}) },
  });
  try {
    const valid = await send('{"ok":true}');
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { ok: true });
    assert.equal((await send('{')).status, 400);
    assert.equal((await send(JSON.stringify({ text: 'x'.repeat(1100) }))).status, 413);
    const compressed = gzipSync('{"ok":true}');
    assert.equal((await send(compressed, 'gzip')).status, inflate ? 200 : 415);
    // A tiny malformed trailer must not turn a parser error into a process crash.
    const trailing = await send(Buffer.concat([compressed, Buffer.from('invalid-trailer')]), 'gzip');
    assert.ok(inflate ? [200, 400].includes(trailing.status) : trailing.status === 415);
    await trailing.arrayBuffer();
    const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
    results.push({ inflate, valid: 200, malformed: 400, oversized: 413, trailing: trailing.status, healthAfter: 200 });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
console.log(JSON.stringify(results, null, 2));
