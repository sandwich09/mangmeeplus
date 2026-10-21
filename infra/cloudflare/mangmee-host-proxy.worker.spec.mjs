import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const nativeRequest = globalThis.Request;
const nativeFetch = globalThis.fetch;

assert.throws(
  () => new nativeRequest('https://example.test/login', { method: 'GET', body: '{}' }),
  TypeError,
  'the Fetch contract must reject a GET request body',
);

for (const file of [
  'infra/cloudflare/mangmee-host-proxy.worker.js',
  'infra/cloudflare/mangmee-uat-host-proxy.worker.js',
]) {
  const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
  const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`))
    .default;
  const origin = source.match(/const ORIGIN = '([^']+)'/)[1];
  let forwarded;
  let upstream = new Response('ok');
  globalThis.Request = class {
    constructor(url, init) {
      this.url = String(url);
      Object.assign(this, init);
      forwarded = this;
      if ((init.method === 'GET' || init.method === 'HEAD') && init.body !== undefined) {
        throw new TypeError('GET/HEAD request cannot have body');
      }
    }
  };
  globalThis.fetch = async () => upstream;

  forwarded = undefined;
  await worker.fetch({ url: 'https://example.test/', method: 'GET', headers: {} });
  assert.equal(new URL(forwarded.url).pathname, '/', `${file} must serve the public home from the origin, not redirect it`);

  for (const method of ['GET', 'HEAD']) {
    await worker.fetch({ url: 'https://example.test/login', method, headers: {}, body: 'forbidden' });
    assert.equal(forwarded.body, undefined, `${file} forwarded a ${method} body`);
    assert.equal(new URL(forwarded.url).hostname, origin);
    assert.equal(forwarded.headers.get('X-Forwarded-Host'), 'example.test');
    assert.equal(forwarded.headers.get('X-Forwarded-Proto'), 'https');
  }
  const body = { stream: true };
  await worker.fetch({ url: 'https://example.test/webhook', method: 'POST', headers: {}, body });
  assert.equal(forwarded.body, body, `${file} dropped the POST body`);

  upstream = new Response(null, { status: 302, headers: { location: `https://${origin}/login` } });
  const redirect = await worker.fetch({ url: 'https://example.test/old', method: 'GET', headers: {} });
  assert.equal(redirect.headers.get('location'), 'https://example.test/login');
}

globalThis.Request = nativeRequest;
globalThis.fetch = nativeFetch;
console.log('Cloudflare host proxy request contract: PASS');
