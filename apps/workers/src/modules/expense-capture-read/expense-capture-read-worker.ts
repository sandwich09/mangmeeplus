import type { Worker } from 'bullmq';
import { startScanWorker } from '../../common/scan-worker.js';

/**
 * The timer behind the bounded PDF reader (appendix §4.5).
 *
 * It carries no logic at all — the API's drain claims the jobs and runs them where the attachment
 * storage, the gateway client and the money governance live. 30 s because a job that a dying API
 * task left mid-file should resume within one lease (120 s), not on the next hourly sweep.
 */
export const EXPENSE_CAPTURE_READ_WORKER_OPTIONS = {
  queueName: 'expense-capture-read',
  kind: 'expense-capture-read-scan',
  jobId: 'expense-capture-read-scan',
  intervalMs: 30_000,
  path: '/internal/expenses/capture-read/drain',
  failEvent: 'expense_capture_read_scan_failed',
} as const;

export function startExpenseCaptureReadWorker(redisUrl: string): Worker {
  return startScanWorker({ ...EXPENSE_CAPTURE_READ_WORKER_OPTIONS, redisUrl });
}
