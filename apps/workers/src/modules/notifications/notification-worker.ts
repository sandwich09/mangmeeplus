/**
 * Notification Worker (Item 06)
 * Exports the worker setup function; main.ts will call startNotificationWorker().
 * Uses BullMQ for job processing.
 */
import { Worker, type Job } from 'bullmq';
import { attachDeadLetterQueue, createQueue } from '../../common/queue.js';
import { workerLog } from '../../common/log.js';
import type { NotificationJobPayload } from './notification-jobs.js';
import {
  DAILY_OWNER_SUMMARY_CRON,
  DELIVERY_SWEEP_INTERVAL_MS,
  NOTIFICATION_QUEUE,
  SNAPSHOT_SWEEP_INTERVAL_MS,
  STOCK_LOW_SWEEP_INTERVAL_MS,
} from './notification-jobs.js';

/** Pass redis URL or ioredis-compatible options object (avoids version mismatch). */
export function startNotificationWorker(redisUrl: string): Worker {
  const worker = new Worker(
    'notifications',
    async (job: Job<NotificationJobPayload>) => {
      await processJob(job.data);
    },
    {
      connection: { url: redisUrl },
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    workerLog('error', { event: 'notification_job_failed', jobId: job?.id, kind: job?.data?.kind, error: err?.message });
  });

  worker.on('completed', (job) => {
    workerLog('info', { event: 'notification_job_completed', jobId: job?.id, kind: job?.data?.kind });
  });

  void scheduleRepeatableJobs(redisUrl);
  attachDeadLetterQueue(worker, 'notifications', redisUrl);
  return worker;
}

// A4: the delivery dispatcher. Nothing previously enqueued delivery jobs, so QUEUED
// web+LINE deliveries never left the queue. This repeatable job drives the API sweep.
async function scheduleRepeatableJobs(redisUrl: string): Promise<void> {
  const queue = createQueue(NOTIFICATION_QUEUE, redisUrl);
  await queue.add(
    'delivery.sweep',
    { kind: 'delivery.sweep', data: {} },
    { repeat: { every: DELIVERY_SWEEP_INTERVAL_MS }, jobId: 'notifications-delivery-sweep' },
  );
  await queue.add(
    'snapshot.sweep',
    { kind: 'snapshot.sweep', data: {} },
    { repeat: { every: SNAPSHOT_SWEEP_INTERVAL_MS }, jobId: 'notifications-snapshot-sweep' },
  );
  await queue.add(
    'stock_low.sweep',
    { kind: 'stock_low.sweep', data: {} },
    { repeat: { every: STOCK_LOW_SWEEP_INTERVAL_MS }, jobId: 'notifications-stock-low-sweep' },
  );
  await queue.add(
    'daily_owner_summary.sweep',
    { kind: 'daily_owner_summary.sweep', data: {} },
    {
      repeat: DAILY_OWNER_SUMMARY_CRON,
      jobId: 'notifications-daily-owner-summary-sweep',
      // The cron fires once a day — without retries a transient 07:00 failure
      // (api restart, canary, DB blip) silently loses the whole day's summaries.
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
    },
  );
}

async function processJob(payload: NotificationJobPayload): Promise<void> {
  switch (payload.kind) {
    case 'snapshot.generate':
      await handleSnapshotGenerate(payload.data);
      break;
    case 'daily_owner_summary':
      await handleDailyOwnerSummary(payload.data);
      break;
    case 'stock_low.scan':
      await handleStockLowScan(payload.data);
      break;
    case 'delivery.process':
    case 'delivery.retry':
      await handleDeliveryProcess(payload.data);
      break;
    case 'delivery.sweep':
      await requestInternal('notifications/delivery-sweep');
      break;
    case 'snapshot.sweep':
      await requestInternal('notifications/snapshot-sweep');
      break;
    case 'stock_low.sweep':
      await requestInternal('notifications/stock-low-sweep');
      break;
    case 'daily_owner_summary.sweep':
      await requestInternal('notifications/daily-owner-summary-sweep');
      break;
    default:
      workerLog('warn', { event: 'unknown_job_kind', payload });
  }
}

// ---- Job Handlers ----
// These call the API service via HTTP (internal endpoint) or share PrismaService.
// For item 06, they are stubs that log intent; the API use cases handle actual logic.

async function handleSnapshotGenerate(data: { companyId: string; periodKind: string; idempotencyKey: string }) {
  await requestInternal(`companies/${data.companyId}/dashboard/snapshots/generate`, { periodKind: data.periodKind }, data.idempotencyKey);
}

async function handleDailyOwnerSummary(data: { companyId: string; periodKey: string; idempotencyKey: string }) {
  await requestInternal(`companies/${data.companyId}/notifications/daily-owner-summary`, { periodKey: data.periodKey }, data.idempotencyKey);
}

async function handleStockLowScan(data: { companyId: string; idempotencyKey: string }) {
  await requestInternal(`companies/${data.companyId}/notifications/scan/stock-low`, {}, data.idempotencyKey);
}

async function handleDeliveryProcess(data: { companyId: string; deliveryId: string; channel: string; idempotencyKey: string }) {
  await requestInternal(
    `companies/${data.companyId}/notification-deliveries/${data.deliveryId}/process`,
    { channel: data.channel },
    data.idempotencyKey,
  );
}

async function requestInternal(path: string, body: Record<string, unknown> = {}, idempotencyKey?: string): Promise<void> {
  const apiBase = process.env['INTERNAL_API_URL'] ?? 'http://localhost:3001/v1';
  const workerToken = process.env['WORKER_INTERNAL_TOKEN'] ?? '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Worker-Token': workerToken };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${apiBase}/internal/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const responseBody = await res.text().catch(() => '');
    throw new Error(`Notification internal endpoint returned ${res.status}: ${responseBody.slice(0, 200)}`);
  }
}
