// Local HTTP integration against the running Next preview, never a cloud endpoint.
// Usage: node docs/evidence/halloween-release-2026-10-28/check-combined-draw.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
const temporary = await mkdtemp(join(tmpdir(), 'halloween-proxy-proof-'));
const api = http.createServer((_request, response) => response.writeHead(404).end('wrong-api-upstream'));
const results = [];
try {
  await listen(api);
  Object.assign(process.env, { API_PORT: String(api.address().port), WEB_PORT: '43841',
    GLOBAL_MAINTENANCE_MODE: 'false', PRODUCTION_SERVING_MODE: 'live' });
  const oldPath = join(temporary, 'old-proxy.mjs');
  await writeFile(oldPath, execFileSync('git', ['show', '8802028dc967d3f95c2af7548bd2e652b4118a78:infra/api-web/web-api-proxy.mjs']));
  for (const [version, moduleUrl] of [
    ['before', pathToFileURL(oldPath).href],
    ['after', new URL('../../../infra/api-web/web-api-proxy.mjs', import.meta.url).href],
  ]) {
    const { server } = await import(moduleUrl);
    await listen(server);
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const path = '/api/public/halloween/draw?preview=events&event=halloween';
      const send = (path, extra = {}) => fetch(origin + path, { method: 'POST',
        headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' }, signal: AbortSignal.timeout(30000), ...extra });
      const response = await send(path);
      if (version === 'before') {
        assert.equal(response.status, 404);
        assert.equal(await response.text(), 'wrong-api-upstream');
        results.push({ version, status: response.status, reachesWrongUpstream: true });
      } else {
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.deepEqual(Object.keys(result), ['cardId']);
        assert.equal(typeof result.cardId, 'string');
        const crossOrigin = await send(path, { headers: { Origin: 'https://untrusted.example', 'Sec-Fetch-Site': 'cross-site' } });
        assert.equal(crossOrigin.status, 403);
        const choice = await send(path + '&cardId=23-mangmee-secret');
        assert.equal(choice.status, 400);
        results.push({ version, status: response.status, cardId: result.cardId,
          crossOriginStatus: crossOrigin.status, clientChoiceStatus: choice.status });
      }
    } finally { await close(server); }
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await close(api);
  await rm(temporary, { recursive: true, force: true });
}
