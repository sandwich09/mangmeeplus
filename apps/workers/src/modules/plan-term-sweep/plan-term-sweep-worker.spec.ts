import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_TERM_SWEEP_WORKER_OPTIONS } from './plan-term-sweep-worker.js';
import { EXECUTIVE_REBUILD_WORKER_OPTIONS } from '../executive/executive-rebuild-worker.js';

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

// Here because the package's `test` script lists this file; the executive worker is the same one-scan shape.
describe('executive rebuild worker', () => {
  it('asks the internal rebuild endpoint once an hour', () => {
    assert.deepEqual(EXECUTIVE_REBUILD_WORKER_OPTIONS, {
      queueName: 'executive-rebuild',
      kind: 'executive-rebuild',
      jobId: 'executive-rebuild',
      intervalMs: 3_600_000,
      path: '/internal/executive/rebuild',
      failEvent: 'executive_rebuild_failed',
    });
  });
});
