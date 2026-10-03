import type { Worker } from 'bullmq';
import { startScanWorker } from '../../common/scan-worker.js';

/**
 * Executive report build (executive backend spec §12.3, Q30): once an hour.
 *
 * Like every other sweep worker this one only decides WHEN. The API decides what a round builds —
 * every profile and the current and previous month each time, every month back to the first one
 * once a Bangkok day — and skips a round that would overlap another. So a missed tick costs an
 * hour of freshness, a doubled one costs nothing, and the daily round needs no timer of its own.
 */
export const EXECUTIVE_REBUILD_WORKER_OPTIONS = {
  queueName: 'executive-rebuild',
  kind: 'executive-rebuild',
  jobId: 'executive-rebuild',
  intervalMs: 3_600_000,
  path: '/internal/executive/rebuild',
  failEvent: 'executive_rebuild_failed',
} as const;

export function startExecutiveRebuildWorker(redisUrl: string): Worker {
  return startScanWorker({ ...EXECUTIVE_REBUILD_WORKER_OPTIONS, redisUrl });
}
