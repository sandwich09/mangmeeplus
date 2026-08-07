import type { Worker } from 'bullmq';
import { startScanWorker } from '../../common/scan-worker.js';

export const EXPENSE_AUTO_POST_WORKER_OPTIONS = {
  queueName: 'expense-auto-post',
  kind: 'expense-auto-post-scan',
  jobId: 'expense-auto-post-scan',
  intervalMs: 60_000,
  path: '/internal/ledger/expense-auto-post/drain',
  failEvent: 'expense_auto_post_scan_failed',
} as const;

export function startExpenseAutoPostWorker(redisUrl: string): Worker {
  return startScanWorker({ ...EXPENSE_AUTO_POST_WORKER_OPTIONS, redisUrl });
}
