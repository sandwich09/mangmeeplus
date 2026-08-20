import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '@/common/models/api-error.model';
import { listRoles } from './employee-access.api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('listRoles', () => {
  it('bypasses the browser cache and accepts the request-context contract', async () => {
    let requestInit: RequestInit | undefined;
    globalThis.fetch = async (_input, init) => {
      requestInit = init;
      return new Response(JSON.stringify([{
        id: 'sales',
        key: 'SALES',
        name: 'Sales',
        isSystem: true,
        status: 'ACTIVE',
        permissionKeys: [],
        assignableByCurrentUser: true,
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const roles = await listRoles('company-1');

    assert.equal(requestInit?.cache, 'no-store');
    assert.equal(roles[0]?.assignableByCurrentUser, true);
  });

  it('surfaces a pre-flag response as invalid instead of an empty picker', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify([{
      id: 'sales',
      key: 'SALES',
      name: 'Sales',
      isSystem: true,
      status: 'ACTIVE',
      permissionKeys: [],
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } });

    await assert.rejects(
      listRoles('company-1'),
      (error: unknown) => error instanceof ApiError && error.code === 'invalid_response',
    );
  });
});
