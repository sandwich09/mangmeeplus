import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERIC_UPLOAD_ERROR_MESSAGE,
  UPLOAD_FILE_TYPE_MISMATCH_ERROR_MESSAGE,
} from '@/common/files/upload-file.logic';
import { confirmDuplicate, dismissDuplicate, normalizeApiBase, resolveUploadUrl, uploadReceiptFile } from './expenses.api';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('expenses.api URL helpers', () => {
  it('normalizes API base URL that already includes v1', () => {
    assert.equal(normalizeApiBase('http://localhost:3001/v1'), 'http://localhost:3001');
    assert.equal(normalizeApiBase('http://localhost:3001/v1/'), 'http://localhost:3001');
  });

  it('resolves local upload URL against API origin', () => {
    assert.equal(
      resolveUploadUrl('/local-storage/upload/abc', 'http://localhost:3001'),
      'http://localhost:3001/local-storage/upload/abc',
    );
  });

  it('forwards the signed create-only upload headers to storage', async () => {
    let request: { method?: string; headers?: Headers; body?: BodyInit | null } = {};
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      request = { method: init?.method, headers: new Headers(init?.headers), body: init?.body };
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const file = new File([Uint8Array.from([1, 2, 3])], 'receipt.png', { type: 'image/png' });

    await uploadReceiptFile('https://storage.example.test/upload', 'PUT', file, {
      'Content-Type': 'image/png',
      'If-None-Match': '*',
    });

    assert.equal(request.method, 'PUT');
    assert.equal(request.headers?.get('content-type'), 'image/png');
    assert.equal(request.headers?.get('if-none-match'), '*');
    assert.equal(request.body, file);
  });

  it('masks file-server failures behind upload-safe messages', async () => {
    const file = new File([], 'receipt.png', { type: 'image/png' });
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;

    await assert.rejects(
      uploadReceiptFile('https://storage.example.test/upload', 'PUT', file),
      { message: GENERIC_UPLOAD_ERROR_MESSAGE },
    );

    globalThis.fetch = (async () => new Response(
      JSON.stringify({ message: 'File signature does not match the declared MIME type.' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;
    await assert.rejects(
      uploadReceiptFile('https://storage.example.test/upload', 'PUT', file),
      { message: UPLOAD_FILE_TYPE_MISMATCH_ERROR_MESSAGE },
    );
  });

  it('sends the reviewer reason to both duplicate-resolution actions', async () => {
    const requests: Array<{ url: string; method?: string; body?: BodyInit | null }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method, body: init?.body });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    await confirmDuplicate('co-1', 'exp-1', 'candidate-1', 'same receipt');
    await dismissDuplicate('co-1', 'exp-1', 'candidate-2', 'different purchase');

    assert.deepEqual(requests, [
      {
        url: '/api/v1/companies/co-1/expenses/exp-1/duplicates/candidate-1/confirm',
        method: 'POST',
        body: JSON.stringify({ reason: 'same receipt' }),
      },
      {
        url: '/api/v1/companies/co-1/expenses/exp-1/duplicates/candidate-2/dismiss',
        method: 'POST',
        body: JSON.stringify({ reason: 'different purchase' }),
      },
    ]);
  });
});
