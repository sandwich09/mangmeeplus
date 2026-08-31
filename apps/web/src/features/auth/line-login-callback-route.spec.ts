// The authed link lane of the LINE callback (P12-2) ends by redirecting to the page that started
// it. Which query parameter rides along IS the outcome as far as that page is concerned: with none
// at all, /signup/welcome re-renders its connect panel and the next press reopens LINE — the loop
// Owner reproduced on UAT 2026-08-31 while linking from a second company's welcome page.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../../../app/api/auth/line-login/callback/route';
import { ACCESS_TOKEN_COOKIE } from '@/common/auth/auth-cookies.constants';
import { ACCOUNT_MERGE_COOKIE } from './account-merge-bff.logic';
import { encodeLineLoginTxn, LINE_LOGIN_TXN_COOKIE } from './line-login-bff.logic';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const TXN = { state: 'state-1', nonce: 'nonce-1', verifier: 'verifier-1', returnTo: '/signup/welcome' };

/** A callback arriving with a live transaction cookie and, by default, an active session. */
function request(options: { authed?: boolean; state?: string; returnTo?: string } = {}): NextRequest {
  const txn = options.returnTo === undefined ? TXN : { ...TXN, returnTo: options.returnTo };
  const cookies = [`${LINE_LOGIN_TXN_COOKIE}=${encodeLineLoginTxn(txn)}`];
  if (options.authed !== false) cookies.push(`${ACCESS_TOKEN_COOKIE}=access-token-1`);
  const url = new URL('/api/auth/line-login/callback', 'http://localhost:3000');
  url.searchParams.set('code', 'auth-code-1');
  url.searchParams.set('state', options.state ?? TXN.state);
  return new NextRequest(url, { headers: new Headers({ host: 'localhost:3000', cookie: cookies.join('; ') }) });
}

function stubLinkApi(status: number, body: unknown = {}): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
}

function location(res: Response): URL {
  return new URL(res.headers.get('location')!);
}

describe('BFF /api/auth/line-login/callback — the link lane has to say what happened', () => {
  it('sends a successful link back with line=linked, so the page can show it worked', async () => {
    stubLinkApi(200, { linked: true, providerUserId: 'U1' });
    const res = await GET(request());
    const target = location(res);
    assert.equal(target.pathname, '/signup/welcome');
    assert.equal(target.searchParams.get('line'), 'linked');
  });

  it('says the same thing when the API answers a same-user relink with another success', async () => {
    // link-line-identity.use-case.ts returns { linked: true } for an ACTIVE identity already owned
    // by this user, so pressing the button twice must land on the success state, not on silence.
    stubLinkApi(200, { linked: true, providerUserId: 'U1' });
    assert.equal(location(await GET(request())).searchParams.get('line'), 'linked');
  });

  it('still clears the transaction cookie and any stale merge ticket on success', async () => {
    stubLinkApi(200, { linked: true, providerUserId: 'U1' });
    const set = (await GET(request())).headers.getSetCookie().join('\n');
    assert.match(set, new RegExp(`${LINE_LOGIN_TXN_COOKIE}=;.*[Mm]ax-[Aa]ge=0`));
    assert.match(set, new RegExp(`${ACCOUNT_MERGE_COOKIE}=;.*[Mm]ax-[Aa]ge=0`));
  });

  it('leaves the conflict and failure outcomes exactly as they were', async () => {
    stubLinkApi(409, { mergeTicket: 'ticket-1', existingAccount: { displayName: 'สมชาย', companyNames: [] } });
    const conflict = await GET(request());
    assert.equal(location(conflict).searchParams.get('line'), 'link-conflict');
    // The ticket rides an HttpOnly cookie, never the redirect URL.
    assert.match(conflict.headers.getSetCookie().join('\n'), new RegExp(`${ACCOUNT_MERGE_COOKIE}=[^;]+`));
    assert.doesNotMatch(conflict.headers.get('location')!, /ticket-1/);

    stubLinkApi(500, { message: 'upstream trouble' });
    assert.equal(location(await GET(request())).searchParams.get('line'), 'link-failed');

    // A state that does not match the transaction never reaches the API at all.
    stubLinkApi(200, { linked: true });
    const forged = location(await GET(request({ state: 'not-my-state' })));
    assert.equal(forged.pathname, '/login');
    assert.equal(forged.searchParams.get('line'), 'failed');
  });

  it('falls back to the root when the transaction carries no usable return path', async () => {
    stubLinkApi(200, { linked: true, providerUserId: 'U1' });
    const target = location(await GET(request({ returnTo: 'https://evil.example.com/' })));
    assert.equal(target.origin, 'http://localhost:3000');
    assert.equal(target.pathname, '/');
    assert.equal(target.searchParams.get('line'), 'linked');
  });
});
