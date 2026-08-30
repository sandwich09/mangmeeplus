import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_TERM_SWEEP_WORKER_OPTIONS } from './plan-term-sweep-worker.js';

describe('plan term sweep worker', () => {
  it('scans the internal sweep endpoint every five minutes', () => {
    assert.deepEqual(PLAN_TERM_SWEEP_WORKER_OPTIONS, {
      queueName: 'plan-term-sweep',
      kind: 'plan-term-sweep-scan',
      jobId: 'plan-term-sweep-scan',
      intervalMs: 300_000,
      path: '/internal/plan-term/sweep',
      failEvent: 'plan_term_sweep_scan_failed',
    });
  });
});
