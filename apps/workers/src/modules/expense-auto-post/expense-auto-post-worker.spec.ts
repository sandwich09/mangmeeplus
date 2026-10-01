import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXPENSE_AUTO_POST_WORKER_OPTIONS } from './expense-auto-post-worker.js';
import { REIMBURSEMENT_RECONCILE_WORKER_OPTIONS } from '../reimbursement-reconcile/reimbursement-reconcile-worker.js';

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

// Audit B4. Kept beside its sibling scan: this package runs only the spec files its `test` script
// lists, and a spec file of its own would never run.
describe('reimbursement reconcile worker', () => {
  it('posts the protected reconcile run every two minutes, with no body of its own', () => {
    assert.deepEqual(REIMBURSEMENT_RECONCILE_WORKER_OPTIONS, {
      queueName: 'reimbursement-reconcile',
      kind: 'reimbursement-reconcile-scan',
      jobId: 'reimbursement-reconcile-scan',
      intervalMs: 120_000,
      path: '/internal/reimbursements/reconcile',
      failEvent: 'reimbursement_reconcile_scan_failed',
    });
    // A queue and a scheduler id of its own: sharing either with another scan would make one of them replace the other's schedule.
    assert.notEqual(REIMBURSEMENT_RECONCILE_WORKER_OPTIONS.queueName, EXPENSE_AUTO_POST_WORKER_OPTIONS.queueName);
    assert.notEqual(REIMBURSEMENT_RECONCILE_WORKER_OPTIONS.jobId, EXPENSE_AUTO_POST_WORKER_OPTIONS.jobId);
  });

  it('is started with the other workers and registered for shutdown, so it runs at all', () => {
    // main.ts runs its whole startup on import, so the wiring is read from the source.
    const main = readFileSync(fileURLToPath(new URL('../../main.ts', import.meta.url)), 'utf8');
    assert.match(main, /import \{ startReimbursementReconcileWorker \} from '\.\/modules\/reimbursement-reconcile\/reimbursement-reconcile-worker\.js';/);
    assert.match(main, /^\s*workers\.push\(startReimbursementReconcileWorker\(config\.REDIS_URL\)\);$/m);
    // Inside the queue switch, like every other worker: a deployment without queues starts none of them.
    const queueBlock = main.slice(main.indexOf('if (config.QUEUE_ENABLED) {'), main.indexOf('const heartbeat = setInterval'));
    assert.ok(queueBlock.includes('startReimbursementReconcileWorker(config.REDIS_URL)'));
  });
});
