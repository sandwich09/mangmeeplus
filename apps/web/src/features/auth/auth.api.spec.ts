import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { changePassword } from './auth.api';

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
