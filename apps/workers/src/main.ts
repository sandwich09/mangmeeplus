import { createServer } from 'node:http';
import { validateProductionConfig, workersConfigSchema } from '@watchdog-bms/config';
import type { Worker } from 'bullmq';
import { fatalDetail, workerLog } from './common/log.js';
import { configureQueues } from './common/queue.js';
import { startNotificationWorker } from './modules/notifications/notification-worker.js';
import { startWorkflowWorker } from './modules/workflow/workflow-worker.js';
import { startAiDraftWorker } from './modules/ai-draft/ai-draft-worker.js';
import { startCrmSlaWorker } from './modules/crm-inbox/crm-sla-worker.js';
import { startCrmPdpaWorker } from './modules/crm-inbox/crm-pdpa-worker.js';
import { startCrmTrustWorker } from './modules/crm-inbox/crm-trust-worker.js';
import { startLineAiLedgerWorker } from './modules/line-ai-ledger/line-ai-ledger-worker.js';
import { startCrmCampaignWorker } from './modules/crm-inbox/crm-campaign-worker.js';
import { startExpenseAutoPostWorker } from './modules/expense-auto-post/expense-auto-post-worker.js';
import { startPlanTermSweepWorker } from './modules/plan-term-sweep/plan-term-sweep-worker.js';

// Registered before anything that can reject: a full Redis takes every worker down at boot, and
// without this Node prints the whole BullMQ error object on the way out. One bounded line instead.
function exitFatal(event: string, err: unknown): void {
  workerLog('error', { event, error: fatalDetail(err) });
  // ECS pipes stdout, so the line above flushes on a later tick; exiting in this one can drop the
  // only record of why the task died.
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 50).unref();
}
process.on('unhandledRejection', (err) => exitFatal('worker_unhandled_rejection', err));
process.on('uncaughtException', (err) => exitFatal('worker_uncaught_exception', err));

const result = workersConfigSchema.safeParse(process.env);
if (!result.success) {
  throw new Error(`Workers config validation failed:\n${result.error.message}`);
}
const config = result.data;
validateProductionConfig(config as unknown as Record<string, unknown>);

// Audit H-30: these three were declared in the config schema and read by nothing. Applying them
// here, before any queue is built, is what makes QUEUE_RETRY_* and DLQ_ENABLED mean something.
configureQueues({
  attempts: config.QUEUE_RETRY_ATTEMPTS,
  backoffMs: config.QUEUE_RETRY_BACKOFF_MS,
  dlqEnabled: config.DLQ_ENABLED,
});

function logHeartbeat() {
  workerLog('info', { event: 'workers_heartbeat', status: 'ok', redisUrlConfigured: Boolean(config.REDIS_URL) });
}

// ECS Express services require an HTTP health check; workers serve nothing else.
const healthPort = Number(process.env['PORT'] ?? 3000);
const healthServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: config.SERVICE_NAME, status: 'ok' }));
}).listen(healthPort, '0.0.0.0');

logHeartbeat();
const workers: Worker[] = [];
if (config.QUEUE_ENABLED) {
  workers.push(startNotificationWorker(config.REDIS_URL));
  workerLog('info', { event: 'notification_worker_started' });
  workers.push(startPlanTermSweepWorker(config.REDIS_URL));
  workerLog('info', { event: 'plan_term_sweep_worker_started' });
  workers.push(startWorkflowWorker(config.REDIS_URL, {
    internalApiUrl: config.INTERNAL_API_URL,
    workerToken: config.WORKER_INTERNAL_TOKEN ?? '',
    bucket: config.S3_BUCKET,
    region: config.S3_REGION,
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    ...(config.S3_FORCE_PATH_STYLE !== undefined ? { forcePathStyle: config.S3_FORCE_PATH_STYLE } : {}),
    ...(config.S3_ACCESS_KEY_ID ? { accessKeyId: config.S3_ACCESS_KEY_ID } : {}),
    ...(config.S3_SECRET_ACCESS_KEY ? { secretAccessKey: config.S3_SECRET_ACCESS_KEY } : {}),
  }));
  workerLog('info', { event: 'workflow_worker_started' });
  workers.push(startAiDraftWorker(config.REDIS_URL));
  workerLog('info', { event: 'ai_draft_worker_started' });
  workers.push(startCrmSlaWorker(config.REDIS_URL));
  workerLog('info', { event: 'crm_sla_worker_started' });
  workers.push(startCrmPdpaWorker(config.REDIS_URL));
  workerLog('info', { event: 'crm_pdpa_worker_started' });
  workers.push(startCrmTrustWorker(config.REDIS_URL));
  workerLog('info', { event: 'crm_trust_worker_started' });
  workers.push(startLineAiLedgerWorker(config.REDIS_URL, config.LINE_AI_LEDGER_RECLAIM_INTERVAL_MS));
  workers.push(startCrmCampaignWorker(config.REDIS_URL));
  workers.push(startExpenseAutoPostWorker(config.REDIS_URL));
  workerLog('info', { event: 'line_ai_ledger_worker_started' });
  workerLog('info', { event: 'expense_auto_post_worker_started' });
}
const heartbeat = setInterval(logHeartbeat, 30_000);

/**
 * Audit H-30: nothing handled SIGTERM, so every deploy killed whatever job was mid-flight. ECS
 * sends SIGTERM, waits out the stop grace period, then SIGKILLs — an in-flight LINE send or campaign
 * job died between "sent" and "recorded" and was redelivered on the next boot, sending twice.
 *
 * `Worker.close()` stops fetching new jobs and waits for the active one, which is the whole point:
 * the task stays up just long enough to finish what it already started. WORKER_SHUTDOWN_TIMEOUT_MS
 * bounds that wait and must stay under the ECS stop grace period, or SIGKILL wins anyway.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  // A second SIGTERM (or an operator's Ctrl-C twice) must not start a second close: BullMQ's close
  // is not re-entrant and the timer below would race the first one to process.exit.
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  workerLog('info', { event: 'workers_shutdown_started', signal, workers: workers.length, timeoutMs: config.WORKER_SHUTDOWN_TIMEOUT_MS });

  // Stop answering health checks first so the load balancer drains this task while jobs finish.
  healthServer.close();

  const forced = setTimeout(() => {
    workerLog('error', { event: 'workers_shutdown_timeout', signal, timeoutMs: config.WORKER_SHUTDOWN_TIMEOUT_MS });
    process.exit(1);
  }, config.WORKER_SHUTDOWN_TIMEOUT_MS);
  // Deliberately NOT unref'd: this timer is the only thing that turns a close() that never settles
  // into a bounded exit. An unref'd timer lets Node exit 0 first and report a clean shutdown that
  // silently abandoned an in-flight job.

  // One slow or already-broken worker must not strand the others: settle them all, then report.
  const results = await Promise.allSettled(workers.map((worker) => worker.close()));
  const failed = results.filter((result) => result.status === 'rejected').length;
  clearTimeout(forced);
  workerLog(failed > 0 ? 'error' : 'info', { event: 'workers_shutdown_complete', signal, closed: results.length - failed, failed });
  process.exit(failed > 0 ? 1 : 0);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => { void shutdown(signal); });
}
