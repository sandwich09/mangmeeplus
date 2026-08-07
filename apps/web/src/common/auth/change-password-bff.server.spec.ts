import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { forwardPasswordChange } from './change-password-bff.server';

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
});
