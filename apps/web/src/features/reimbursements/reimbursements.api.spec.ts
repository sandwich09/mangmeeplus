import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { uploadReceiptFile } from './reimbursements.api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
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
