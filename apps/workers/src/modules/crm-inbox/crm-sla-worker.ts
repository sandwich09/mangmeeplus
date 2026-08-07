/**
 * CRM Inbox SLA Worker (Item 15A Phase 2)
 * One repeatable job that sweeps first-response SLA breaches by calling
 * apps/api's worker-token-protected internal endpoint. Mirrors the workflow
 * worker's dispatch-to-HTTP pattern.
 */
import { Worker, type Job } from 'bullmq';
import { createQueue } from '../../common/queue.js';
import { workerLog } from '../../common/log.js';
import { scheduleWithRetry } from '../../common/retry-schedule.js';

const CRM_INBOX_QUEUE = 'crm-inbox';
const SLA_SCAN_INTERVAL_MS = 60_000;
const NEW_CONVERSATION_SCAN_INTERVAL_MS = 60_000;
const RETRY_SCAN_INTERVAL_MS = 60_000;
const AUTONOMY_RETRY_SCAN_INTERVAL_MS = 60_000;
const BOOKING_REMINDER_SCAN_INTERVAL_MS = 60_000;
const BOOKING_PROPOSAL_SWEEP_INTERVAL_MS = 60_000;
const INTERNAL_API_TIMEOUT_MS = 10 * 60_000;

type CrmInboxJobPayload = { kind: 'sla.scan' | 'newconv.scan' | 'retry.scan' | 'autonomy.scan' | 'reminder.scan' | 'proposal.sweep' };

export function startCrmSlaWorker(redisUrl: string): Worker {
  const worker = new Worker(
    CRM_INBOX_QUEUE,
    async (job: Job<CrmInboxJobPayload>) => {
      if (job.data?.kind === 'sla.scan') await postScan('sla-breach-scan');
      else if (job.data?.kind === 'newconv.scan') await postScan('new-conversation-scan');
      else if (job.data?.kind === 'retry.scan') await postScan('inbox-retry-scan');
      else if (job.data?.kind === 'autonomy.scan') await postScan('autonomy-retry-scan');
      else if (job.data?.kind === 'reminder.scan') await postScan('booking-reminder-scan');
      else if (job.data?.kind === 'proposal.sweep') await postScan('booking-proposal-sweep');
      else workerLog('warn', { event: 'unknown_crm_inbox_job_kind', payload: job.data });
    },
    { connection: { url: redisUrl }, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    workerLog('error', { event: 'crm_sla_job_failed', jobId: job?.id, kind: job?.data?.kind, error: err?.message });
  });

  scheduleWithRetry(
    () => scheduleRepeatableJobs(redisUrl),
    RETRY_SCAN_INTERVAL_MS,
    (err) => {
      workerLog('error', { event: 'crm_inbox_schedule_failed', error: (err as Error).message });
    },
  );
  return worker;
}

async function scheduleRepeatableJobs(redisUrl: string): Promise<void> {
  const queue = createQueue(CRM_INBOX_QUEUE, redisUrl);
  try {
    await queue.add('sla.scan', { kind: 'sla.scan' }, { repeat: { every: SLA_SCAN_INTERVAL_MS }, jobId: 'crm-inbox-sla-scan' });
    // A4: new-chat notification scan (mirrors the SLA scan dispatch).
    await queue.add('newconv.scan', { kind: 'newconv.scan' }, { repeat: { every: NEW_CONVERSATION_SCAN_INTERVAL_MS }, jobId: 'crm-inbox-newconv-scan' });
    // A5: reply-send retry + inbound media re-fetch + profile re-enrichment.
    await queue.add('retry.scan', { kind: 'retry.scan' }, { repeat: { every: RETRY_SCAN_INTERVAL_MS }, jobId: 'crm-inbox-retry-scan' });
    // GC4: durable autonomy evaluation after API crashes/deploys.
    await queue.add('autonomy.scan', { kind: 'autonomy.scan' }, { repeat: { every: AUTONOMY_RETRY_SCAN_INTERVAL_MS }, jobId: 'crm-inbox-autonomy-scan' });
    // A7: appointment reminder sweep.
    await queue.add('reminder.scan', { kind: 'reminder.scan' }, { repeat: { every: BOOKING_REMINDER_SCAN_INTERVAL_MS }, jobId: 'crm-inbox-reminder-scan' });
    // CUST-02: booking proposal expiry + crash-recovery sweep.
    await queue.add('proposal.sweep', { kind: 'proposal.sweep' }, { repeat: { every: BOOKING_PROPOSAL_SWEEP_INTERVAL_MS }, jobId: 'crm-inbox-proposal-sweep' });
  } finally {
    await queue.close().catch(() => undefined);
  }
}

async function postScan(path: 'sla-breach-scan' | 'new-conversation-scan' | 'inbox-retry-scan' | 'autonomy-retry-scan' | 'booking-reminder-scan' | 'booking-proposal-sweep'): Promise<void> {
  const apiBase = process.env['INTERNAL_API_URL'] ?? 'http://localhost:3001/v1';
  const workerToken = process.env['WORKER_INTERNAL_TOKEN'] ?? '';
  const res = await fetch(`${apiBase}/internal/crm/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Token': workerToken },
    body: '{}',
    signal: AbortSignal.timeout(INTERNAL_API_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CRM ${path} endpoint returned ${res.status}: ${body.slice(0, 200)}`);
  }
}
