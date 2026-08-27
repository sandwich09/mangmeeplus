import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '@/common/models/api-error.model';
import { deleteEmployeeDraft, listRoles, setEmployeeStatus } from './employee-access.api';
import { apiErrorMessage } from '@/common/api/api-error-message';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('employee removal requests', () => {
  it('deletes a draft through the scoped endpoint and accepts an empty 204 response', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 204 });
    };
    assert.equal(await deleteEmployeeDraft('company-1', 'employee-1'), undefined);
    assert.match(calls[0].url, /\/companies\/company-1\/settings\/employees\/employee-1\/draft$/);
    assert.equal(calls[0].init?.method, 'DELETE');
    assert.equal(calls[0].init?.body, undefined);
  });

  it('keeps non-draft disabling on its original endpoint', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ status: 'DISABLED' }), { status: 200 });
    };
    await setEmployeeStatus('company-1', 'employee-1', 'DISABLED');
    assert.match(seen!.url, /\/employees\/employee-1\/disable$/);
    assert.equal(seen!.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(seen!.init?.body)), { status: 'DISABLED' });
  });

  it('retains actionable draft conflict and not-found codes, including a stale retry', async () => {
    for (const [status, code, copy] of [
      [404, 'employee_draft_not_found', 'ไม่พบพนักงานนี้แล้ว กรุณาโหลดรายชื่อพนักงานใหม่'],
      [409, 'employee_draft_not_deletable', 'ลบได้เฉพาะร่างพนักงานที่ยังไม่เสร็จสิ้น กรุณาตรวจสอบสถานะล่าสุด'],
    ] as const) {
      globalThis.fetch = async () => new Response(JSON.stringify({ code, message: 'Internal English diagnostic' }), { status });
      await assert.rejects(deleteEmployeeDraft('company-1', 'employee-1'), (error: any) => {
        assert.equal(error.code, code);
        assert.equal(apiErrorMessage(error), copy);
        return true;
      });
    }
  });
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
