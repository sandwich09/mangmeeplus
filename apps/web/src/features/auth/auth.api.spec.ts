import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { changePassword, refreshSessionWithOutcome } from './auth.api';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('changePassword', () => {
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
