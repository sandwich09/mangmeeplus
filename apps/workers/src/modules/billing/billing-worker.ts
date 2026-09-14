import type { Worker } from 'bullmq';
import { startScanWorker } from '../../common/scan-worker.js';

// Webhooks are the fast path; the independent scan repairs missing/delayed delivery.
export function startBillingEventWorker(redisUrl: string): Worker {
  return startScanWorker({ queueName: 'billing-events', kind: 'billing-events-drain', jobId: 'billing-events-drain',
    intervalMs: 10_000, path: '/internal/billing/drain', failEvent: 'billing_events_drain_failed', redisUrl });
}
export function startBillingScanWorker(redisUrl: string): Worker {
  return startScanWorker({ queueName: 'billing-scan', kind: 'billing-scan', jobId: 'billing-scan',
    intervalMs: 30_000, path: '/internal/billing/scan', failEvent: 'billing_scan_failed', redisUrl });
}

// External message latency must never occupy the payment reconciliation queue.
export function startBillingNotificationWorker(redisUrl: string): Worker {
  return startScanWorker({ queueName: 'billing-notifications', kind: 'billing-notifications-drain', jobId: 'billing-notifications-drain',
    intervalMs: 10_000, path: '/internal/billing/notifications/drain', failEvent: 'billing_notifications_drain_failed', redisUrl });
}
