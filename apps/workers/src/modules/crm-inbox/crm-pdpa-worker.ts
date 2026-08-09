/**
 * CRM PDPA Retention Worker (Item 15A / MVP1 A6)
 * Daily repeatable job that drains the PDPA purge backlog by calling apps/api's
 * worker-token-protected internal endpoint in bounded batches until a pass purges
 * nothing (or a safety cap is hit). Mirrors the CRM SLA worker's dispatch-to-HTTP
 * pattern; the retention rules + finance exemption live in the API use-case.
 */
import { Worker, type Job } from 'bullmq';
import { attachDeadLetterQueue, createQueue } from '../../common/queue.js';
import { workerLog } from '../../common/log.js';

const CRM_PDPA_QUEUE = 'crm-pdpa';
// Once a day — retention windows move in months, so a daily sweep is ample.
const PDPA_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PDPA_ERASURE_INTERVAL_MS = 5 * 60 * 1000;
// Bound one job run: each pass purges up to PDPA_PURGE_BATCH_LIMIT (500) rows,
// so 200 passes drain up to ~100k rows before the job yields to the next tick.
const MAX_PASSES_PER_RUN = 200;

type CrmPdpaJobPayload = { kind: 'pdpa.purge' | 'pdpa.erasure' };

export function startCrmPdpaWorker(redisUrl: string): Worker {
  const worker = new Worker(
    CRM_PDPA_QUEUE,
    async (job: Job<CrmPdpaJobPayload>) => {
      if (job.data?.kind === 'pdpa.purge') await runPurgeUntilDrained();
      if (job.data?.kind === 'pdpa.erasure') await processErasureCases();
    },
    { connection: { url: redisUrl }, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    workerLog('error', { event: 'crm_pdpa_job_failed', jobId: job?.id, error: err?.message });
  });

  void scheduleRepeatableJobs(redisUrl);
  attachDeadLetterQueue(worker, CRM_PDPA_QUEUE, redisUrl);
  return worker;
}

async function scheduleRepeatableJobs(redisUrl: string): Promise<void> {
  const queue = createQueue(CRM_PDPA_QUEUE, redisUrl);
  await queue.add('pdpa.purge', { kind: 'pdpa.purge' }, { repeat: { every: PDPA_PURGE_INTERVAL_MS }, jobId: 'crm-pdpa-purge' });
  await queue.add('pdpa.erasure', { kind: 'pdpa.erasure' }, { repeat: { every: PDPA_ERASURE_INTERVAL_MS }, jobId: 'crm-pdpa-erasure' });
}

async function processErasureCases(): Promise<void> {
  const apiBase = process.env['INTERNAL_API_URL'] ?? 'http://localhost:3001/v1';
  const workerToken = process.env['WORKER_INTERNAL_TOKEN'] ?? '';
  const res = await fetch(`${apiBase}/internal/crm/pdpa-erasure-process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Token': workerToken },
    body: '{}',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CRM PDPA erasure endpoint returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const result = await res.json().catch(() => ({}));
  workerLog('info', { event: 'crm_pdpa_erasure_run', ...result });
}

async function runPurgeUntilDrained(): Promise<void> {
  const apiBase = process.env['INTERNAL_API_URL'] ?? 'http://localhost:3001/v1';
  const workerToken = process.env['WORKER_INTERNAL_TOKEN'] ?? '';
  let totalText = 0;
  let totalMedia = 0;
  let totalAiTurns = 0;
  let totalAiConversations = 0;
  for (let pass = 0; pass < MAX_PASSES_PER_RUN; pass += 1) {
    const res = await fetch(`${apiBase}/internal/crm/pdpa-purge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Token': workerToken },
      body: '{}',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`CRM PDPA purge endpoint returned ${res.status}: ${body.slice(0, 200)}`);
    }
    const { textPurged = 0, mediaPurged = 0, aiTurnsPurged = 0, aiConversationsPurged = 0 } = (await res.json().catch(() => ({}))) as {
      textPurged?: number;
      mediaPurged?: number;
      aiTurnsPurged?: number;
      aiConversationsPurged?: number;
    };
    totalText += textPurged;
    totalMedia += mediaPurged;
    totalAiTurns += aiTurnsPurged;
    totalAiConversations += aiConversationsPurged;
    if (textPurged === 0 && mediaPurged === 0 && aiTurnsPurged === 0 && aiConversationsPurged === 0) break;
  }
  workerLog('info', { event: 'crm_pdpa_purge_run', totalText, totalMedia, totalAiTurns, totalAiConversations });
}
