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

import { emailAccessBff } from '../auth/email-access-bff.server';
describe('email access BFF proof and token boundaries', () => {
  it('keeps server-minted browser proof HttpOnly and forwards the visitor chain', async () => {
    let sent: any;
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      assert.equal((init.headers as any)['x-forwarded-for'], VISITOR_CHAIN);
      return new Response(JSON.stringify({ challengeId: '00000000-0000-4000-8000-000000000000', deliveryStatus: 'ACCEPTED', browserSecret: 'must-not-return' }), { status: 200 });
    }) as typeof fetch;
    const res = await emailAccessBff(new NextRequest('https://app.example.test/api/auth/email-access/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': VISITOR_CHAIN },
      body: JSON.stringify({ email: 'owner@example.test', requestKey: '00000000-0000-4000-8000-000000000001', browserSecret: 'client-chosen' }),
    }), 'request');
    assert.match(sent.browserSecret, /^[A-Za-z0-9_-]{43}$/);
    assert.equal((await res.json()).browserSecret, undefined);
    const cookie = res.cookies.get('mm_email_access'); assert.equal(cookie?.httpOnly, true); assert.equal(cookie?.secure, true);
  });
  it('ignores browser supplied proof/identity and emits only auth cookies on confirmed login', async () => {
    const secret = 'a'.repeat(43), challengeId = '00000000-0000-4000-8000-000000000000';
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
      assert.deepEqual(JSON.parse(String(init.body)), { challengeId, browserSecret: secret, code: '000012' });
      return new Response(JSON.stringify({ kind: 'LOGIN', accessToken: 'sensitive-access', refreshToken: 'sensitive-refresh', browserSecret: secret,
        companyId: 'c1', redirectPath: '/companies/c1/dashboard' }), { status: 200 });
    }) as typeof fetch;
    const res = await emailAccessBff(new NextRequest('https://app.example.test/api/auth/email-access/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: `mm_email_access=${encodeURIComponent(JSON.stringify({ browserSecret: secret, challengeId }))}` },
      body: JSON.stringify({ challengeId: 'attacker', browserSecret: 'attacker', userId: 'admin', code: '000012' }),
    }), 'confirm');
    assert.equal(res.status, 200); const text = JSON.stringify(await res.json());
    assert.ok(!text.includes('sensitive-') && !text.includes(secret));
    assert.equal(res.cookies.get('watchdog_token')?.httpOnly, true);
  });
  it('missing browser binding cannot call the API confirm endpoint', async () => {
    globalThis.fetch = (async () => { assert.fail('API must not receive an unbound proof'); }) as typeof fetch;
    const res = await emailAccessBff(new NextRequest('https://app.example.test/api/auth/email-access/confirm', { method: 'POST', body: '{}' }), 'confirm');
    assert.equal(res.status, 401);
  });
});

it('email BFF rejects null/array bodies and corrupted cookie without invoking upstream', async () => {
  globalThis.fetch = (async () => { throw new Error('must not call'); }) as typeof fetch;
  for (const body of ['null', '[]']) {
    const response = await emailAccessBff(new NextRequest('http://localhost/api/auth/email-access/request', { method: 'POST', body }), 'request');
    assert.equal(response.status, 400);
  }
  const response = await emailAccessBff(new NextRequest('http://localhost/api/auth/email-access/confirm', { method: 'POST', headers: { cookie: 'mm_email_access=null' }, body: '{}' }), 'confirm');
  assert.equal(response.status, 401);
});

it('email login preserves a safe business return path and rejects an external redirect', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ kind: 'LOGIN', accessToken: 'access', refreshToken: 'refresh', companyId: 'co-1', redirectPath: '/companies/co-1/dashboard', legalAcceptanceRequired: false }))) as typeof fetch;
  for (const [nextPath, expected] of [['/billing/companies?offer=PRO_999', '/billing/companies?offer=PRO_999'], ['//evil.example/path', '/companies/co-1/dashboard']]) {
    const cookie = encodeURIComponent(JSON.stringify({ challengeId: '00000000-0000-4000-8000-000000000001', browserSecret: 'a'.repeat(43), nextPath }));
    const response = await emailAccessBff(new NextRequest('http://localhost/api/auth/email-access/confirm', { method: 'POST', headers: { cookie: `mm_email_access=${cookie}` }, body: '{"code":"123456"}' }), 'confirm');
    assert.equal((await response.json()).redirectPath, expected);
  }
});
