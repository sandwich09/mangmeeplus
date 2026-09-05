/**
 * Review R06. The claim BFF calls the API server-to-server, so the API's `trustedClientIp` sees the
 * BFF's own peer — 127.0.0.1 inside the api-web container — and every applicant in the country
 * shares one 20/hour claim bucket and one password-login failure bucket.
 *
 * The trust boundary is the one the API already enforces: `x-forwarded-for` is honoured only when
 * the TCP peer is the private/loopback tier, and the chain is walked from the RIGHT past every hop
 * our own infrastructure and Cloudflare appended. So the fix is to forward the chain this request
 * already carries — verbatim, capped — which is exactly what `forwardedClientHeaders` does, and a
 * visitor-prepended hop still cannot become the answer.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST } from '../../../app/api/auth/signup-claim/route';

// browser → Cloudflare → the ECS gateway, which appends the hop it observed. 203.0.113.55 is the
// visitor; 172.71.14.9 is Cloudflare's egress, which `trustedClientIp` walks past.
const VISITOR_CHAIN = '203.0.113.55, 172.71.14.9';
const OTHER_VISITOR_CHAIN = '198.51.100.7, 172.71.14.9';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

type Outgoing = { url: string; headers: Record<string, string> };

async function claimWith(forwardedFor: string): Promise<Outgoing[]> {
  const outgoing: Outgoing[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    outgoing.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify({ companyId: 'co-1', accessToken: 'a', refreshToken: 'r' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const response = await POST(new NextRequest('http://localhost:3000/api/auth/signup-claim', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', 'x-forwarded-for': forwardedFor }),
    body: JSON.stringify({ mode: 'set-password', token: 't'.repeat(48), username: 'somchai', password: 'secret123' }),
  }));
  assert.equal(response.status, 200);
  return outgoing;
}

describe('the claim BFF gives the API the visitor it is acting for (review R06)', () => {
  it('forwards the visitor chain on the claim call AND on the password-login lane', async () => {
    const outgoing = await claimWith(VISITOR_CHAIN);

    assert.equal(outgoing.length, 2, 'the claim and its follow-up login both go to the API');
    for (const call of outgoing) {
      assert.equal(call.headers['x-forwarded-for'], VISITOR_CHAIN, `no visitor context on ${call.url}`);
    }
    // The login lane is the one the report calls out separately: its failure bucket is keyed on the
    // same address, so without this every wrong password in the country counts against one key.
    assert.ok(outgoing.some((call) => call.url.includes('/auth/password/login')));
  });

  it('gives two visitors two different keys instead of one shared bucket', async () => {
    const first = await claimWith(VISITOR_CHAIN);
    const second = await claimWith(OTHER_VISITOR_CHAIN);

    assert.notEqual(first[0]!.headers['x-forwarded-for'], second[0]!.headers['x-forwarded-for']);
  });

  it('sends no x-forwarded-for at all when the request carries none', async () => {
    const outgoing = await claimWith('   ');

    for (const call of outgoing) {
      assert.equal('x-forwarded-for' in call.headers, false, `invented a chain for ${call.url}`);
    }
  });
});
