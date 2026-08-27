import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { changePassword, loginWithPassword, refreshSessionWithOutcome, requestEmailChange } from './auth.api';
import { localizedErrorMessage } from '../../common/i18n/error-message.logic';
import { authErrorMessage } from './auth.logic';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('loginWithPassword', () => {
  it('keeps forwarding username and email identifiers unchanged despite username-first UI copy', async () => {
    const response = { passwordChangeRequired: false, legalAcceptanceRequired: false, companyId: null, redirectPath: '/' };
    const fetchMock = mock.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json(response));
    globalThis.fetch = fetchMock as typeof fetch;

    for (const username of ['test-user', 'test-user@example.com']) {
      assert.deepEqual(await loginWithPassword(username, 'Test-password-123', false), response);
      const [url, init] = fetchMock.mock.calls.at(-1)!.arguments;
      assert.equal(url, '/api/auth/login');
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), { username, password: 'Test-password-123', remember: false });
    }
  });
});

describe('changePassword', () => {
  it('preserves a wrong-current-password error without refreshing or retrying', async () => {
    const fetchMock = mock.fn(async (_input: string | URL | Request) => Response.json({
      code: 'current_password_incorrect', message: 'Current password is incorrect.',
    }, { status: 400 }));
    globalThis.fetch = fetchMock as typeof fetch;

    await assert.rejects(changePassword('synthetic-wrong', 'synthetic-new-password'), (error: any) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'current_password_incorrect');
      assert.equal(authErrorMessage(error, 'fallback'), 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
      return true;
    });
    assert.deepEqual(fetchMock.mock.calls.map((call) => String(call.arguments[0])), ['/api/auth/change-password']);
  });

  it('refreshes an expired first-login session and retries once', async () => {
    let changeAttempts = 0;
    const fetchMock = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/auth/refresh') return new Response(null, { status: 204 });
      changeAttempts += 1;
      return changeAttempts === 1
        ? Response.json({ message: 'No active session.' }, { status: 401 })
        : new Response(null, { status: 204 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await changePassword('Temporary1!', 'Permanent12!');

    assert.deepEqual(fetchMock.mock.calls.map((call) => String(call.arguments[0])), [
      '/api/auth/change-password',
      '/api/auth/refresh',
      '/api/auth/change-password',
    ]);
  });

  it('retains session-expiry guidance when a genuine 401 cannot refresh', async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return Response.json({ message: 'No active session.' }, { status: 401 });
    };
    await assert.rejects(changePassword('synthetic-current', 'synthetic-new'), (error: any) => {
      assert.equal(error.statusCode, 401);
      assert.equal(localizedErrorMessage(error, 'th'), 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      return true;
    });
    assert.deepEqual(calls, ['/api/auth/change-password', '/api/auth/refresh']);
  });

  it('does not retry again when the recovered session rejects the supplied password', async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      if (calls.length === 1) return Response.json({ message: 'No active session.' }, { status: 401 });
      if (String(input) === '/api/auth/refresh') return new Response(null, { status: 204 });
      return Response.json({ code: 'current_password_incorrect', message: 'Current password is incorrect.' }, { status: 400 });
    };
    await assert.rejects(changePassword('synthetic-wrong', 'synthetic-new'), (error: any) => {
      assert.equal(error.code, 'current_password_incorrect');
      assert.equal(error.statusCode, 400);
      return true;
    });
    assert.deepEqual(calls, ['/api/auth/change-password', '/api/auth/refresh', '/api/auth/change-password']);
  });
});

describe('requestEmailChange reauthentication', () => {
  it('preserves the same correctable error without refresh, retry or session-expiry copy', async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return Response.json({ code: 'current_password_incorrect', message: 'Current password is incorrect.' }, { status: 400 });
    };
    await assert.rejects(requestEmailChange('synthetic-wrong', 'new@example.test'), (error: any) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, 'current_password_incorrect');
      assert.equal(authErrorMessage(error, 'fallback'), 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
      return true;
    });
    assert.deepEqual(calls, ['/api/v1/auth/account/email']);
  });
});

describe('refreshSessionWithOutcome', () => {
  it('keeps a real signed-out response distinct from service failure', async () => {
    for (const [status, expected] of [[204, 'restored'], [401, 'signed_out'], [500, 'unavailable']] as const) {
      globalThis.fetch = mock.fn(async () => new Response(null, { status })) as typeof fetch;
      assert.equal(await refreshSessionWithOutcome(), expected);
    }
  });

  it('bounds a refresh request that never settles', async () => {
    globalThis.fetch = mock.fn(async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(new Error('aborted'));
      else signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as typeof fetch;

    assert.equal(await refreshSessionWithOutcome(1), 'timeout');
  });

  it('reports a rejected fetch as unavailable', async () => {
    globalThis.fetch = mock.fn(async () => { throw new Error('network down'); }) as typeof fetch;
    assert.equal(await refreshSessionWithOutcome(), 'unavailable');
  });

  it('clears the timeout after a settled response', async () => {
    let signal: AbortSignal | undefined;
    globalThis.fetch = mock.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    assert.equal(await refreshSessionWithOutcome(1), 'restored');
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(signal?.aborted, false);
  });
});
