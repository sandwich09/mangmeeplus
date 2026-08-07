// Regression cover for the production ERR_TOO_MANY_REDIRECTS: middleware must never treat an
// access cookie as proof of authentication, because the server layouts validate the real session
// and bounce rejected ones back to /login.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { proxy } from '../../../proxy';
import { CSRF_ERROR_CODE } from './auth-cookies.constants';

const ORIGIN = 'http://localhost:3000';

function request(path: string, opts: { cookie?: string; method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(new URL(path, ORIGIN), {
    method: opts.method ?? 'GET',
    headers: new Headers({
      host: 'localhost:3000',
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...opts.headers,
    }),
  });
}

const VALID_COOKIE = 'watchdog_token=header.payload.signature';
const CHUNKED_COOKIE = 'watchdog_token.0=header.payload; watchdog_token.1=.signature';

describe('proxy — page routes', () => {
  it('never redirects away from /login, whatever the access cookie looks like', () => {
    for (const cookie of [undefined, VALID_COOKIE, CHUNKED_COOKIE, 'watchdog_token=malformed']) {
      const res = proxy(request('/login?next=/companies/c1/dashboard', { cookie }));
      assert.equal(res.status, 200, `cookie ${String(cookie)} must not trigger a redirect`);
      assert.equal(res.headers.get('location'), null);
    }
  });

  it('bounces cookie-less protected visits to /login with the exact next target', () => {
    const res = proxy(request('/companies/c1/expenses?tab=open'));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get('location'), `${ORIGIN}/login?next=%2Fcompanies%2Fc1%2Fexpenses%3Ftab%3Dopen`);
  });

  it('bounces cookie-less system visits to /login', () => {
    const res = proxy(request('/system/partners'));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get('location'), `${ORIGIN}/login?next=%2Fsystem%2Fpartners`);
  });

  it('lets cookie-carrying protected visits through to the layout session check', () => {
    // The cookie may be expired/revoked/malformed — only GET /auth/me can tell, and that is the
    // layout's job. Middleware must not send it back to /login on cookie presence alone.
    for (const cookie of [VALID_COOKIE, CHUNKED_COOKIE]) {
      assert.equal(proxy(request('/companies/c1/dashboard', { cookie })).status, 200);
      assert.equal(proxy(request('/system/partners', { cookie })).status, 200);
    }
  });

  it('adds nonce CSP and production security headers to login and protected responses', () => {
    for (const res of [proxy(request('/login')), proxy(request('/companies/c1/dashboard', { cookie: VALID_COOKIE }))]) {
      const csp = res.headers.get('content-security-policy') ?? '';
      assert.match(csp, /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.equal(res.headers.get('strict-transport-security'), 'max-age=63072000; includeSubDomains; preload');
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
      assert.match(res.headers.get('permissions-policy') ?? '', /camera=\(\)/);
    }
  });

  it('allows the exact configured S3 upload host in production CSP', () => {
    const mutableEnv = process.env as Record<string, string | undefined>;
    const previous = {
      nodeEnv: mutableEnv.NODE_ENV,
      bucket: mutableEnv.S3_BUCKET,
      region: mutableEnv.S3_REGION,
    };
    mutableEnv.NODE_ENV = 'production';
    mutableEnv.S3_BUCKET = 'watchdog-bms-uat-311414082667';
    mutableEnv.S3_REGION = 'ap-southeast-1';
    try {
      const csp = proxy(request('/login')).headers.get('content-security-policy') ?? '';
      const connectDirective = csp.split('; ').find((value) => value.startsWith('connect-src ')) ?? '';
      assert.match(connectDirective, /https:\/\/watchdog-bms-uat-311414082667\.s3\.ap-southeast-1\.amazonaws\.com/);
      assert.equal(connectDirective.split(' ').includes('https:'), false);
      assert.equal(connectDirective.includes('*'), false);
    } finally {
      if (previous.nodeEnv === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = previous.nodeEnv;
      if (previous.bucket === undefined) delete mutableEnv.S3_BUCKET;
      else mutableEnv.S3_BUCKET = previous.bucket;
      if (previous.region === undefined) delete mutableEnv.S3_REGION;
      else mutableEnv.S3_REGION = previous.region;
    }
  });
});

describe('proxy — api gate', () => {
  it('rejects cross-origin mutations', async () => {
    const res = proxy(
      request('/api/v1/companies/c1/expenses', {
        method: 'POST',
        cookie: VALID_COOKIE,
        headers: { origin: 'https://evil.example' },
      }),
    );
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { code?: string }).code, undefined, 'never retryable');
  });

  it('fails closed on a missing CSRF cookie and marks the rejection as CSRF-recoverable', async () => {
    const res = proxy(
      request('/api/v1/companies/c1/expenses', {
        method: 'POST',
        cookie: VALID_COOKIE,
        headers: { origin: ORIGIN },
      }),
    );
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { code?: string }).code, CSRF_ERROR_CODE);
  });

  it('passes a matching double-submit pair', () => {
    const res = proxy(
      request('/api/v1/companies/c1/expenses', {
        method: 'POST',
        cookie: `${VALID_COOKIE}; watchdog_csrf=tok1`,
        headers: { origin: ORIGIN, 'x-csrf-token': 'tok1' },
      }),
    );
    assert.equal(res.status, 200);
  });

  it('does not gate reads or the BFF auth routes', () => {
    assert.equal(proxy(request('/api/v1/companies/c1/expenses', { cookie: VALID_COOKIE })).status, 200);
    // /api/auth/refresh must work without a CSRF cookie — it is what reissues one.
    assert.equal(
      proxy(request('/api/auth/refresh', { method: 'POST', cookie: VALID_COOKIE, headers: { origin: ORIGIN } })).status,
      200,
    );
  });
});
