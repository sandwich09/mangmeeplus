import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '@/common/models/api-error.model';
import { employeeShortName, deleteEmployeeDraft, issueEmployeeLineLinkToken, listRoles, setEmployeeStatus } from './employee-access.api';
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
      [404, 'employee_draft_not_found', 'ไม่พบพนักงานนี้แล้ว เปิดหน้ารายชื่อพนักงานใหม่'],
      [409, 'employee_draft_not_deletable', 'ลบได้เฉพาะร่างพนักงานที่ยังไม่เสร็จ ตรวจสถานะล่าสุดอีกครั้ง'],
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


it('issues a fresh LINE link through the existing employee endpoint without saving a profile', async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    return new Response(JSON.stringify({ linkUrl: 'https://example.test/link', qrImageUrl: 'https://example.test/qr', expiresAt: '2026-10-13T10:15:00Z' }), { status: 200 });
  };
  const result = await issueEmployeeLineLinkToken('company-1', 'employee-1');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/companies\/company-1\/settings\/employees\/employee-1\/line-link-token$/);
  assert.equal(calls[0].method, 'POST');
  assert.equal(result.expiresAt, '2026-10-13T10:15:00Z');
});

it('a second issued link carries its own token and expiry', async () => {
  let count = 0;
  globalThis.fetch = async () => { count++; return new Response(JSON.stringify({ linkUrl: `https://example.test/${count}`, expiresAt: `2026-10-13T10:${count === 1 ? '15' : '18'}:00Z` }), { status: 200 }); };
  const first = await issueEmployeeLineLinkToken('company-1', 'employee-1');
  const second = await issueEmployeeLineLinkToken('company-1', 'employee-1');
  assert.notEqual(first.linkUrl, second.linkUrl);
  assert.equal(second.expiresAt, '2026-10-13T10:18:00Z');
});


it('employee rows and cards prefer the edit form display name over the account nickname', () => {
  assert.equal(employeeShortName({ displayName: 'มีนา ใจดี', nickname: 'STAFF' }), 'มีนา ใจดี');
  assert.equal(employeeShortName({ displayName: 'มีนา ใจดี' }), 'มีนา ใจดี');
});
