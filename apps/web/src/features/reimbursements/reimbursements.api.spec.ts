import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { submitReimbursement, uploadReceiptFile } from './reimbursements.api';
import { errorText } from './reimbursements.logic';
import { subscribeToastBus, type ToastEvent } from '@/common/feedback/toast-bus';

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as Record<string, unknown>)['window'];
});

describe('reimbursement submit error notifications', () => {
  const cases = [
    [422, 'missing_receipt', 'ยังส่งไม่ได้ตามนโยบายใบเสร็จของบริษัท กรุณาเปิดรายละเอียดเพื่อแนบใบเสร็จหรือแก้ไขคำขอ'],
    [400, 'missing_receipt_reason_required', 'มีรายการที่ยังไม่แนบหลักฐาน กรุณาระบุเหตุผลที่ไม่มีใบเสร็จก่อนส่งใบเบิก'],
    [400, 'unreviewed_internal_rule', 'ข้อมูลจากหน้าจอไม่ตรงกับที่ระบบรองรับ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง'],
    [422, 'unreviewed_internal_rule', 'ข้อมูลจากหน้าจอไม่ตรงกับที่ระบบรองรับ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง'],
  ] as const;

  for (const [status, code, expected] of cases) {
    for (const shape of ['message', 'code'] as const) {
      it(`shows consistent safe guidance for HTTP ${status} ${code} in ${shape}`, async () => {
        const events: ToastEvent[] = [];
        const unsubscribe = subscribeToastBus((event) => events.push(event));
        const body = { statusCode: status, [shape]: code };
        let requests = 0;
        (globalThis as Record<string, unknown>)['window'] = {};
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          requests++;
          assert.equal(String(input), '/api/v1/companies/co-1/reimbursements/rb-1/submit');
          assert.equal(init?.method, 'POST');
          return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
        try {
          await assert.rejects(() => submitReimbursement('co-1', 'rb-1'), (error: Error & {
            status?: number; code?: string; details?: unknown;
          }) => {
            assert.equal(error.status, status);
            assert.equal(error.message, shape === 'message' ? code : `API error ${status}`);
            assert.equal(error.code, shape === 'code' ? code : undefined);
            assert.deepEqual(error.details, body);
            assert.equal(errorText(error), expected);
            assert.deepEqual(events, [{ tone: 'error', message: expected }]);
            if (code === 'missing_receipt') {
              assert.doesNotMatch(expected, /โหลดหน้าใหม่|ข้อมูลจากหน้าจอ|ระบุเหตุผล/);
            }
            return true;
          });
          assert.equal(requests, 1, 'a policy rejection must not retry the submit');
        } finally {
          unsubscribe();
        }
      });
    }
  }
});

describe('reimbursement receipt upload', () => {
  it('normalizes image/jpg metadata to a server-valid JPEG before creating the intent', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/attachments/upload-intent')) {
        return new Response(JSON.stringify({
          attachmentId: 'att-1',
          uploadUrl: 'https://storage.example.test/receipt',
          uploadMethod: 'PUT',
          uploadHeaders: { 'If-None-Match': '*' },
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://storage.example.test/receipt') return new Response(null, { status: 200 });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const source = new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], 'dime-slip.jpg', { type: 'image/jpg' });

    const attachmentId = await uploadReceiptFile('co-1', source, 'source-branch');

    assert.equal(attachmentId, 'att-1');
    assert.equal(requests.length, 3);
    assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
      originalFileName: 'dime-slip.jpg',
      mimeType: 'image/jpeg',
      byteSize: 4,
      visibility: 'INTERNAL',
      branchId: 'source-branch',
    });
    const uploaded = requests[1]?.init?.body as File;
    assert.equal(uploaded.type, 'image/jpeg');
    assert.equal(uploaded.name, 'dime-slip.jpg');
    assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), { byteSize: 4 });
  });

  it('does not upload receipt bytes without the saved claim branch', async () => {
    let requests = 0;
    globalThis.fetch = (async () => { requests++; return new Response(null); }) as typeof fetch;
    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    for (const branchId of [null, undefined, '', '  ']) {
      await assert.rejects(() => uploadReceiptFile('co-1', file, branchId), /สาขา/);
    }
    assert.equal(requests, 0);
  });
});
