import type { Worker } from 'bullmq';
import { startScanWorker } from '../../common/scan-worker.js';

/**
 * P29 §4B. Every 5 minutes: flip ACTIVE companies past `termEndsAt` to DISABLED and fire the
 * 7/3/1-day warning ladder. All state lives behind the internal API — this worker only decides
 * when, exactly like the expense auto-post scan.
 *
 * Enforcement does NOT depend on this worker running: the API refuses an expired company on
 * access, to the hour. A missed pass delays the status flip and the notification, nothing else.
 */
export const PLAN_TERM_SWEEP_WORKER_OPTIONS = {
  queueName: 'plan-term-sweep',
  kind: 'plan-term-sweep-scan',
  jobId: 'plan-term-sweep-scan',
  intervalMs: 300_000,
  path: '/internal/plan-term/sweep',
  failEvent: 'plan_term_sweep_scan_failed',
} as const;

export function startPlanTermSweepWorker(redisUrl: string): Worker {
  return startScanWorker({ ...PLAN_TERM_SWEEP_WORKER_OPTIONS, redisUrl });
}
