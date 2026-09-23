import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST } from '../../../app/api/auth/change-password/route';
import { ACCESS_TOKEN_COOKIE } from './auth-cookies.constants';
import { forwardPasswordChange } from './change-password-bff.server';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('forwardPasswordChange', () => {
  it('authenticates the forced password change with the access token', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const response = await forwardPasswordChange(
      'chunked.access.token',
      { currentPassword: 'Temporary1!', newPassword: 'Permanent12!' },
      async (url, init) => {
        request = { url, init };
        return new Response(null, { status: 204 });
      },
    );

    assert.equal(response.status, 204);
    assert.match(request!.url, /\/v1\/auth\/password\/change$/);
    assert.equal((request!.init!.headers as Record<string, string>).Authorization, 'Bearer chunked.access.token');
    assert.deepEqual(JSON.parse(request!.init!.body as string), {
      currentPassword: 'Temporary1!',
      newPassword: 'Permanent12!',
    });
  });

  it('forwards a forced change without a current-password field', async () => {
    let body: unknown;
    await forwardPasswordChange('chunked.access.token', { newPassword: 'Permanent12!' }, async (_url, init) => {
      body = JSON.parse(init!.body as string);
      return new Response(null, { status: 204 });
    });
    assert.deepEqual(body, { newPassword: 'Permanent12!' });
  });
});

describe('change-password BFF response contract', () => {
  it('preserves the specific input error separately from a genuine upstream 401', async () => {
    for (const [status, body] of [
      [400, { code: 'current_password_incorrect', message: 'Current password is incorrect.' }],
      [400, { code: 'password_reuse', message: 'New password must be different from the current password.' }],
      [401, { message: 'Invalid authentication token.' }],
    ] as const) {
      globalThis.fetch = async () => Response.json(body, { status });
      const response = await POST(new NextRequest('http://localhost/api/auth/change-password', {
        method: 'POST',
        headers: { cookie: `${ACCESS_TOKEN_COOKIE}.0=synthetic.; ${ACCESS_TOKEN_COOKIE}.1=access` },
        body: JSON.stringify({ currentPassword: 'synthetic-current', newPassword: 'synthetic-new' }),
      }));
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
      assert.equal(response.headers.get('set-cookie'), null, 'input failures must not clear a session');
    }
  });

  it('keeps a missing session as 401 without sending credentials upstream', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error('Unexpected upstream call'); };
    const response = await POST(new NextRequest('http://localhost/api/auth/change-password', { method: 'POST' }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { message: 'No active session.' });
    assert.equal(calls, 0);
  });
});
