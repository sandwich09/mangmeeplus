import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApiError } from '../models/api-error.model';
import { apiErrorMessage } from './api-error-message';
import { HttpClient } from './http-client';

async function withFetch<T>(fetchImpl: typeof fetch, body: () => Promise<T>): Promise<T> {
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await body();
  } finally {
    globalThis.fetch = previous;
  }
}

describe('HttpClient transport errors', () => {
  it('tags an actual fetch rejection as network and retains its cause', async () => {
    const cause = new TypeError('Failed to fetch');
    await withFetch(async () => { throw cause; }, async () => {
      const client = new HttpClient({ baseUrl: '' });
      await assert.rejects(
        () => client.get('/api/example'),
        (error: ApiError) => {
          assert.equal(error.kind, 'network_error');
          assert.equal(error.cause, cause);
          assert.equal(apiErrorMessage(error), 'เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง');
          return true;
        },
      );
    });
  });

  it('turns malformed successful JSON into a safe server error and retains its cause', async () => {
    await withFetch(async () => new Response('{not-json', { status: 200 }), async () => {
      const client = new HttpClient({ baseUrl: '' });
      await assert.rejects(
        () => client.get('/api/example'),
        (error: ApiError) => {
          assert.equal(error.kind, 'server_error');
          assert.equal(error.code, 'invalid_response');
          assert.equal(error.statusCode, 200);
          assert.ok(error.cause instanceof SyntaxError);
          assert.equal(apiErrorMessage(error), 'ระบบขัดข้องชั่วคราว ลองอีกครั้ง');
          return true;
        },
      );
    });
  });
});
