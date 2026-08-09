/**
 * Workflow Automation Worker (Item 16)
 * Repeatable jobs that drive event ingestion (outbox drain), schedule/threshold/SLA
 * scans, and the retry sweep, by calling apps/api's worker-token-protected internal
 * endpoints. Mirrors the notification worker's dispatch-to-HTTP pattern.
 */
import { Worker, type Job } from 'bullmq';
import { createQueue } from '../../common/queue.js';
import { WORKFLOW_QUEUE, type WorkflowJobPayload } from './workflow-jobs.js';
import { workerLog } from '../../common/log.js';
import {
  createObjectVersionCleanupS3Client,
  drainObjectVersionCleanup,
  type ObjectVersionCleanupWorkerConfig,
} from '../object-version-cleanup/object-version-cleanup-worker.js';

const OUTBOX_DRAIN_INTERVAL_MS = 30_000;
const SCAN_INTERVAL_MS = 15 * 60_000;
const RETRY_INTERVAL_MS = 60_000;

export function startWorkflowWorker(redisUrl: string, cleanupConfig: ObjectVersionCleanupWorkerConfig): Worker {
  const cleanupS3 = createObjectVersionCleanupS3Client(cleanupConfig);
  const worker = new Worker(
    WORKFLOW_QUEUE,
    async (job: Job<WorkflowJobPayload>) => {
      await processJob(job.data, cleanupConfig, cleanupS3);
    },
    { connection: { url: redisUrl }, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    workerLog('error', { event: 'workflow_job_failed', jobId: job?.id, kind: job?.data?.kind, error: err?.message });
  });

  void scheduleRepeatableJobs(redisUrl);
  return worker;
}

async function scheduleRepeatableJobs(redisUrl: string): Promise<void> {
  const queue = createQueue(WORKFLOW_QUEUE, redisUrl);
  await queue.add('outbox.drain', { kind: 'outbox.drain' }, { repeat: { every: OUTBOX_DRAIN_INTERVAL_MS }, jobId: 'workflow-outbox-drain' });
  await queue.add(
    'object-version-cleanup.drain',
    { kind: 'object-version-cleanup.drain' },
    { repeat: { every: OUTBOX_DRAIN_INTERVAL_MS }, jobId: 'object-version-cleanup-drain' },
  );
  await queue.add('scan.threshold', { kind: 'scan.threshold' }, { repeat: { every: SCAN_INTERVAL_MS }, jobId: 'workflow-scan-threshold' });
  await queue.add('scan.sla', { kind: 'scan.sla' }, { repeat: { every: SCAN_INTERVAL_MS }, jobId: 'workflow-scan-sla' });
  await queue.add('scan.schedule', { kind: 'scan.schedule' }, { repeat: { every: SCAN_INTERVAL_MS }, jobId: 'workflow-scan-schedule' });
  await queue.add('action.retry', { kind: 'action.retry' }, { repeat: { every: RETRY_INTERVAL_MS }, jobId: 'workflow-action-retry' });
}

async function processJob(
  payload: WorkflowJobPayload,
  cleanupConfig: ObjectVersionCleanupWorkerConfig,
  cleanupS3: ReturnType<typeof createObjectVersionCleanupS3Client>,
): Promise<void> {
  const apiBase = process.env['INTERNAL_API_URL'] ?? 'http://localhost:3001/v1';
  const workerToken = process.env['WORKER_INTERNAL_TOKEN'] ?? '';
  const headers = { 'Content-Type': 'application/json', 'X-Worker-Token': workerToken };

  const request = (path: string, body: Record<string, unknown>) =>
    fetch(`${apiBase}/internal/workflow/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

  let res: Response;
  switch (payload.kind) {
    case 'outbox.drain':
      res = await request('outbox/drain', {});
      break;
    case 'object-version-cleanup.drain': {
      const result = await drainObjectVersionCleanup(cleanupConfig, { s3: cleanupS3 });
      workerLog('info', { event: 'workflow_job_completed', kind: payload.kind, result });
      return;
    }
    case 'scan.threshold':
      res = await request('scan', { triggerType: 'THRESHOLD_SCAN' });
      break;
    case 'scan.sla':
      res = await request('scan', { triggerType: 'SLA_SCAN' });
      break;
    case 'scan.schedule':
      res = await request('scan', { triggerType: 'SCHEDULE' });
      break;
    case 'action.retry':
      res = await request('action-runs/retry', {});
      break;
    default:
      workerLog('warn', { event: 'unknown_workflow_job_kind', payload });
      return;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Workflow internal endpoint returned ${res.status}: ${body.slice(0, 200)}`);
  }
  // Mirrors notification_job_completed. Without it a workflow job that drained events but fired
  // nothing left no trace anywhere; the endpoint's own counts ({claimed, published, ...}) are the
  // cheapest way to see whether the pipe is moving.
  workerLog('info', { event: 'workflow_job_completed', kind: payload.kind, result: await res.json().catch(() => undefined) });
}
