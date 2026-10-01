import type { Worker } from 'bullmq';
import { startScanWorker } from '../../common/scan-worker.js';

/**
 * Audit B4. Every 2 minutes: finish the expense claims whose decision was recorded and not carried
 * out, and the cancellations that were started and not finished. All state and every rule live
 * behind the internal API; this worker only decides when, exactly like the expense auto-post scan.
 *
 * A missed pass delays a repair and nothing else: the claim page offers "ดำเนินการต่อ" for the same
 * step to the person who may ask for it.
 */
export const REIMBURSEMENT_RECONCILE_WORKER_OPTIONS = {
  queueName: 'reimbursement-reconcile',
  kind: 'reimbursement-reconcile-scan',
  jobId: 'reimbursement-reconcile-scan',
  intervalMs: 120_000,
  path: '/internal/reimbursements/reconcile',
  failEvent: 'reimbursement_reconcile_scan_failed',
} as const;

export function startReimbursementReconcileWorker(redisUrl: string): Worker {
  return startScanWorker({ ...REIMBURSEMENT_RECONCILE_WORKER_OPTIONS, redisUrl });
}
