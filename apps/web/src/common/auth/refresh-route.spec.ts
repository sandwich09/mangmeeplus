// The BFF refresh route decides whether a session lives or dies, so which statuses delete the
// auth cookies is a security *and* a liveness contract. Clearing them on anything but 401 logs
// out every user whose 15-minute access token happens to expire during a dependency outage,
// while their AuthSession rows are still ACTIVE (spec §4 rule 6).
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST } from '../../../app/api/auth/refresh/route';
import { ACCESS_TOKEN_COOKIE, CSRF_COOKIE, REFRESH_TOKEN_COOKIE } from './auth-cookies.constants';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function request(cookie = `${REFRESH_TOKEN_COOKIE}=refresh-token-1`): NextRequest {
  return new NextRequest(new URL('/api/auth/refresh', 'http://localhost:3000'), {
    method: 'POST',
    headers: new Headers({ host: 'localhost:3000', cookie }),
  });
}

function stubApi(status: number, body: unknown = {}): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
}

/** A cookie is deleted by setting it empty with Max-Age=0 — that is what clearAuthCookies emits. */
function deletedCookies(res: Response): string[] {
  return res.headers
    .getSetCookie()
    .filter((cookie) => /(^|;\s*)max-age=0(;|$)/i.test(cookie))
    .map((cookie) => cookie.split('=')[0]!);
}

const TOKENS = { accessToken: 'access-1', refreshToken: 'refresh-2', expiresIn: 900 };

describe('BFF /api/auth/refresh — only a gone session destroys the cookies', () => {
  it('rotates the cookies on a successful refresh', async () => {
    stubApi(200, TOKENS);
    const res = await POST(request());
    assert.equal(res.status, 204);
    const set = res.headers.getSetCookie().join('\n');
    assert.match(set, new RegExp(`${REFRESH_TOKEN_COOKIE}=refresh-2`));
    assert.match(set, new RegExp(`${ACCESS_TOKEN_COOKIE}=access-1`));
  });

  it('clears the cookies on 401, the one answer that means the session is gone', async () => {
    stubApi(401, { message: 'Session is expired or revoked.' });
    const res = await POST(request());
    assert.equal(res.status, 401);
    const deleted = deletedCookies(res);
    for (const cookie of [REFRESH_TOKEN_COOKIE, ACCESS_TOKEN_COOKIE, CSRF_COOKIE]) {
      assert.ok(deleted.includes(cookie), `${cookie} must be deleted when the session is gone`);
    }
  });

  it('keeps the cookies on every other failure so the client can retry', async () => {
    // 503 = the API's abuse-control store is down; 500/502 = the API itself. None of these is
    // the session ending, and the refresh row is untouched, so the session must survive.
    for (const status of [429, 500, 502, 503]) {
      stubApi(status, { message: 'upstream trouble' });
      const res = await POST(request());
      assert.equal(res.status, status, `status ${status} is passed through`);
      assert.deepEqual(res.headers.getSetCookie(), [], `status ${status} must not touch the cookies`);
    }
  });

  it('keeps the cookies when the API answers 200 without a token pair', async () => {
    stubApi(200, { accessToken: 'only-half' });
    const res = await POST(request());
    assert.equal(res.status, 502);
    assert.deepEqual(res.headers.getSetCookie(), []);
  });

  it('keeps the cookies when the API is unreachable', async () => {
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    const res = await POST(request());
    assert.equal(res.status, 502);
    assert.deepEqual(res.headers.getSetCookie(), []);
  });

  it('clears the cookies when there is no refresh cookie to present', async () => {
    const res = await POST(request('other=1'));
    assert.equal(res.status, 401);
    assert.ok(deletedCookies(res).includes(REFRESH_TOKEN_COOKIE));
  });
});
