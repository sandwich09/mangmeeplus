/**
 * Review R03. The public signup calls are session-less by design, but they were sent with
 * `credentials: 'include'` — so a visitor who happens to be signed in (an employee opening their
 * own shop, an owner adding a second one, or anyone with a stale cookie) attached the access cookie
 * to a `/api/v1` mutation with no CSRF header, and the proxy rejected it before the API ever saw it.
 *
 * The check runs the REAL api module against the REAL proxy: it captures what the browser would
 * actually send, rebuilds the request a browser would make from that fetch init, and asks the
 * middleware what it does with it. A test that hand-wrote the request would prove nothing about the
 * caller.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { proxy } from '../../../proxy';
import {
  getSignupClaimInfo,
  resendSignupClaimEmail,
  setSignupClaimPassword,
  submitCompanySignup,
} from './external-signup.api';

const ORIGIN = 'http://localhost:3000';
const ACCESS_COOKIE = 'watchdog_token=header.payload.signature';

type Captured = { url: string; init: RequestInit };

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

async function capture(call: () => Promise<unknown>): Promise<Captured> {
  const seen: Captured[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  await call();
  assert.equal(seen.length, 1, 'expected exactly one outgoing request');
  return seen[0]!;
}

/**
 * The request a browser would put on the wire for this fetch init, for a visitor who IS signed in.
 * `omit` is the only credentials mode that leaves the cookie behind; the default and `same-origin`
 * both attach it for a same-origin URL.
 */
function asBrowserRequest({ url, init }: Captured): NextRequest {
  const attachesCookie = init.credentials !== 'omit';
  return new NextRequest(new URL(url, ORIGIN), {
    method: init.method ?? 'GET',
    headers: new Headers({
      host: 'localhost:3000',
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...(attachesCookie ? { cookie: ACCESS_COOKIE } : {}),
    }),
  });
}

describe('public signup calls survive an existing session (review R03)', () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['submit', () => submitCompanySignup({ companyName: 'ร้านมั่งมี' } as never)],
    ['resend claim email', () => resendSignupClaimEmail('cmtgzg42a000x4k5xje8ot9mg')],
    ['claim info', () => getSignupClaimInfo('t'.repeat(48))],
  ];

  for (const [name, call] of cases) {
    it(`${name} is not rejected by the CSRF gate`, async () => {
      const response = proxy(asBrowserRequest(await capture(call)));
      assert.notEqual(response.status, 403, `${name} was rejected before it reached the API`);
      assert.equal(response.status, 200);
    });
  }

  it('sends no ambient credential at all on the public API boundary', async () => {
    for (const [name, call] of cases) {
      const { url, init } = await capture(call);
      assert.ok(url.startsWith('/api/v1/public/'), url);
      assert.equal(init.credentials, 'omit', `${name} must not attach the session cookie`);
    }
  });

  // The claim BFF is the opposite case and must stay that way: it RETURNS Set-Cookie, and a
  // browser drops those on a credentials-omitted fetch, so the welcome page would lose its session.
  it('keeps the claim BFF on an ambient-credential fetch, because it sets the session cookies', async () => {
    const { url, init } = await capture(() =>
      setSignupClaimPassword({ token: 't'.repeat(48), username: 'somchai', password: 'secret123' }));
    assert.equal(url, '/api/auth/signup-claim');
    assert.notEqual(init.credentials, 'omit');
    // /api/auth/* is outside the double-submit gate, so the cookie costs nothing here.
    assert.equal(proxy(asBrowserRequest({ url, init })).status, 200);
  });
});
