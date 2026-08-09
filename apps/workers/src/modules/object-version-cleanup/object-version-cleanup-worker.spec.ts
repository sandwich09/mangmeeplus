import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import {
  drainObjectVersionCleanup,
  parseObjectVersionCleanupTask,
  type ObjectVersionCleanupWorkerConfig,
} from './object-version-cleanup-worker.js';

const config: ObjectVersionCleanupWorkerConfig = {
  internalApiUrl: 'http://api:3001/v1',
  workerToken: 'worker-secret',
  bucket: 'watchdog-bms-prod',
  region: 'ap-southeast-1',
};

function task(payload: Record<string, unknown> = {}) {
  return {
    id: 'cleanup-1',
    claimToken: '11111111-1111-4111-8111-111111111111',
    attempt: 2,
    payload: {
      schemaVersion: 1,
      companyId: 'company-1',
      bucket: config.bucket,
      path: 'evidence/company-1/ab/cd/file.pdf',
      expectedVersion: '3LgAbC+_-=',
      source: 'ATTACHMENT_FINALIZATION',
      ...payload,
    },
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function apiFor(rawTask: unknown, acknowledgement: { written: boolean } = { written: true }) {
  const calls: Array<{ url: string; body: any; token: string | null }> = [];
  const fetchImpl = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ url, body, token: new Headers(init?.headers).get('X-Worker-Token') });
    if (url.endsWith('/claim')) return response({ tasks: [rawTask], reclaimed: 1, dead: 0 });
    return response(acknowledgement);
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe('object version cleanup worker target validation', () => {
  it('accepts only the exact producer-owned prefixes', () => {
    const cases = [
      ['ATTACHMENT_FINALIZATION', 'evidence/company-1/ab/cd/file.pdf'],
      ['REPORT_EXPORT', 'report-export/company-1/run-1/file.csv'],
      ['SUBSTITUTE_RECEIPT_CERTIFIED', 'company-1/generated/expense-substitute/expense-1/cert.svg'],
      ['SUBSTITUTE_RECEIPT_ISSUED', 'company-1/generated/expense-substitute/expense-1/issued.svg'],
    ] as const;
    for (const [source, path] of cases) {
      assert.equal(parseObjectVersionCleanupTask(task({ source, path }), config.bucket).path, path);
    }
  });

  it('rejects cross-bucket, cross-company, traversal, and non-exact version tasks', () => {
    for (const payload of [
      { bucket: 'another-bucket' },
      { path: 'evidence/company-2/file.pdf' },
      { path: 'evidence/company-1/../company-2/file.pdf' },
      { expectedVersion: 'null' },
      { expectedVersion: '' },
    ]) {
      assert.throws(() => parseObjectVersionCleanupTask(task(payload), config.bucket));
    }
  });
});

describe('object version cleanup drain', () => {
  it('deletes the exact VersionId and completes the fenced lease', async () => {
    let command: DeleteObjectCommand | undefined;
    const s3 = { send: mock.fn(async (input: DeleteObjectCommand) => { command = input; return {}; }) };
    const api = apiFor(task());

    const result = await drainObjectVersionCleanup(config, { s3, fetchImpl: api.fetchImpl });

    assert.deepEqual(command?.input, {
      Bucket: config.bucket,
      Key: 'evidence/company-1/ab/cd/file.pdf',
      VersionId: '3LgAbC+_-=',
    });
    assert.equal(result.completed, 1);
    assert.equal(result.reclaimed, 1);
    assert.match(api.calls[1]!.url, /cleanup-1\/complete$/);
    assert.deepEqual(api.calls[1]!.body, { claimToken: task().claimToken });
    assert.equal(api.calls[0]!.token, config.workerToken);
  });

  it('treats NoSuchVersion as idempotent success', async () => {
    const s3 = { send: mock.fn(async () => { throw Object.assign(new Error('absent'), { name: 'NoSuchVersion' }); }) };
    const api = apiFor(task());

    const result = await drainObjectVersionCleanup(config, { s3, fetchImpl: api.fetchImpl });

    assert.equal(result.completed, 1);
    assert.match(api.calls[1]!.url, /complete$/);
  });

  it('records a bounded failure against the claimed attempt for retry', async () => {
    const s3 = { send: mock.fn(async () => { throw Object.assign(new Error('secret detail'), { name: 'AccessDeniedException' }); }) };
    const api = apiFor(task());

    const result = await drainObjectVersionCleanup(config, { s3, fetchImpl: api.fetchImpl });

    assert.equal(result.failed, 1);
    assert.match(api.calls[1]!.url, /cleanup-1\/fail$/);
    assert.deepEqual(api.calls[1]!.body, {
      claimToken: task().claimToken,
      errorCode: 's3_delete_failed:accessdeniedexception',
    });
  });

  it('rejects invalid payloads before S3 and persists failure evidence', async () => {
    const s3 = { send: mock.fn(async () => ({})) };
    const api = apiFor(task({ path: 'private/company-1/file.pdf' }));

    const result = await drainObjectVersionCleanup(config, { s3, fetchImpl: api.fetchImpl });

    assert.equal(s3.send.mock.callCount(), 0);
    assert.equal(result.failed, 1);
    assert.equal(api.calls[1]!.body.errorCode, 'cleanup_payload_invalid');
  });
});
