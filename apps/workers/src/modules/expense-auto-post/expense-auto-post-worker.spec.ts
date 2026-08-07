import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXPENSE_AUTO_POST_WORKER_OPTIONS } from './expense-auto-post-worker.js';

describe('expense Auto-post worker', () => {
  it('uses the protected bounded drain once per minute', () => {
    assert.deepEqual(EXPENSE_AUTO_POST_WORKER_OPTIONS, {
      queueName: 'expense-auto-post',
      kind: 'expense-auto-post-scan',
      jobId: 'expense-auto-post-scan',
      intervalMs: 60_000,
      path: '/internal/ledger/expense-auto-post/drain',
      failEvent: 'expense_auto_post_scan_failed',
    });
  });
});
