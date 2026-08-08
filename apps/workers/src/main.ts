import { createServer } from 'node:http';
import { validateProductionConfig, workersConfigSchema } from '@watchdog-bms/config';
import { fatalDetail, workerLog } from './common/log.js';
import { startNotificationWorker } from './modules/notifications/notification-worker.js';
import { startWorkflowWorker } from './modules/workflow/workflow-worker.js';
import { startAiDraftWorker } from './modules/ai-draft/ai-draft-worker.js';
import { startCrmSlaWorker } from './modules/crm-inbox/crm-sla-worker.js';
import { startCrmPdpaWorker } from './modules/crm-inbox/crm-pdpa-worker.js';
import { startCrmTrustWorker } from './modules/crm-inbox/crm-trust-worker.js';
import { startLineAiLedgerWorker } from './modules/line-ai-ledger/line-ai-ledger-worker.js';
import { startCrmCampaignWorker } from './modules/crm-inbox/crm-campaign-worker.js';
import { startExpenseAutoPostWorker } from './modules/expense-auto-post/expense-auto-post-worker.js';

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

function logHeartbeat() {
  workerLog('info', { event: 'workers_heartbeat', status: 'ok', redisUrlConfigured: Boolean(config.REDIS_URL) });
}

// ECS Express services require an HTTP health check; workers serve nothing else.
const healthPort = Number(process.env['PORT'] ?? 3000);
createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: config.SERVICE_NAME, status: 'ok' }));
}).listen(healthPort, '0.0.0.0');

logHeartbeat();
if (config.QUEUE_ENABLED) {
  startNotificationWorker(config.REDIS_URL);
  workerLog('info', { event: 'notification_worker_started' });
  startWorkflowWorker(config.REDIS_URL);
  workerLog('info', { event: 'workflow_worker_started' });
  startAiDraftWorker(config.REDIS_URL);
  workerLog('info', { event: 'ai_draft_worker_started' });
  startCrmSlaWorker(config.REDIS_URL);
  workerLog('info', { event: 'crm_sla_worker_started' });
  startCrmPdpaWorker(config.REDIS_URL);
  workerLog('info', { event: 'crm_pdpa_worker_started' });
  startCrmTrustWorker(config.REDIS_URL);
  workerLog('info', { event: 'crm_trust_worker_started' });
  startLineAiLedgerWorker(config.REDIS_URL, config.LINE_AI_LEDGER_RECLAIM_INTERVAL_MS);
  startCrmCampaignWorker(config.REDIS_URL);
  startExpenseAutoPostWorker(config.REDIS_URL);
  workerLog('info', { event: 'line_ai_ledger_worker_started' });
  workerLog('info', { event: 'expense_auto_post_worker_started' });
}
setInterval(logHeartbeat, 30_000);
