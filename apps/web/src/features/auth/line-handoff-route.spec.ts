/**
 * RV22 / deeplink spec §G7. `/l/<token>` is spent by its first GET, so a link preview's HEAD must
 * never reach the API; and the exchange must carry the visitor's forwarded chain, or the API's
 * 20-per-minute exchange limiter counts the web container instead of the people tapping.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET, HEAD } from '../../../app/l/[token]/route';

const TOKEN = 'a'.repeat(40);
// browser → Cloudflare → the ECS gateway; 203.0.113.55 is the visitor (same fixture as the claim BFF).
const VISITOR_CHAIN = '203.0.113.55, 172.71.14.9';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

async function exchangeWith(headers: Record<string, string>): Promise<{ sent: Record<string, string>; location: string | null }> {
  let sent: Record<string, string> = {};
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent = (init.headers ?? {}) as Record<string, string>;
    return new Response(JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresIn: 900, companyId: 'co-1',
      targetPath: '/companies/co-1/billing?channel=line' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  // The LINE exit adds `openExternalBrowser=1` to the link; the route reads the token from the path only.
  const response = await GET(new NextRequest(`http://localhost:3000/l/${TOKEN}?openExternalBrowser=1`, { headers }),
    { params: Promise.resolve({ token: TOKEN }) });
  assert.equal(response.status, 303);
  return { sent, location: response.headers.get('location') };
}

describe('LINE handoff route', () => {
  it('answers HEAD with an empty 204 and never spends the token', async () => {
    globalThis.fetch = (async () => { throw new Error('HEAD must not call the API'); }) as typeof fetch;
    const response = HEAD();
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
  });

  it('forwards the visitor chain to the exchange and lands on the target', async () => {
    const { sent, location } = await exchangeWith({ 'x-forwarded-for': VISITOR_CHAIN });
    assert.equal(sent['x-forwarded-for'], VISITOR_CHAIN);
    assert.equal(sent['Content-Type'], 'application/json');
    assert.ok(location?.endsWith('/companies/co-1/billing?channel=line'), String(location));
  });

  it('sends no forwarded chain when the request carries none', async () => {
    const { sent } = await exchangeWith({});
    assert.equal('x-forwarded-for' in sent, false);
  });
});
