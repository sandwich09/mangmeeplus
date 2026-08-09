/**
 * LINE AI Ledger Reclaim Worker (item 10F)
 * Repeatable job that calls apps/api's worker-token-protected ledger drain endpoint, which
 * XAUTOCLAIMs stalled turn/sub-request entries and pushes follow-up answers. Mirrors the
 * ai-draft worker's dispatch-to-HTTP pattern; the API owns all Redis stream semantics.
 */
import { Worker, type Job } from 'bullmq';
import { attachDeadLetterQueue, createQueue } from '../../common/queue.js';
import { workerLog } from '../../common/log.js';
import { scheduleWithRetry } from '../../common/retry-schedule.js';

export const LINE_AI_LEDGER_QUEUE = 'line-ai-ledger';
export type LineAiLedgerJobPayload = { kind: 'ledger.drain' };
const INTERNAL_API_TIMEOUT_MS = 10 * 60_000;

export function startLineAiLedgerWorker(redisUrl: string, intervalMs = 60_000): Worker {
  const worker = new Worker(
    LINE_AI_LEDGER_QUEUE,
    async (job: Job<LineAiLedgerJobPayload>) => {
      await processJob(job.data);
    },
    { connection: { url: redisUrl }, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    workerLog('error', { event: 'line_ai_ledger_job_failed', jobId: job?.id, kind: job?.data?.kind, error: err?.message });
  });

  scheduleWithRetry(
    () => scheduleRepeatableJobs(redisUrl, intervalMs),
    intervalMs,
    (err) => {
      workerLog('error', { event: 'line_ai_ledger_schedule_failed', error: (err as Error).message });
    },
  );
  attachDeadLetterQueue(worker, LINE_AI_LEDGER_QUEUE, redisUrl);
  return worker;
}

async function scheduleRepeatableJobs(redisUrl: string, intervalMs: number): Promise<void> {
  const queue = createQueue(LINE_AI_LEDGER_QUEUE, redisUrl);
  try {
    await queue.add('ledger.drain', { kind: 'ledger.drain' }, { repeat: { every: intervalMs }, jobId: 'line-ai-ledger-drain' });
  } finally {
    await queue.close().catch(() => undefined);
  }
}

async function processJob(payload: LineAiLedgerJobPayload): Promise<void> {
  if (payload.kind !== 'ledger.drain') {
    workerLog('warn', { event: 'unknown_line_ai_ledger_job_kind', payload });
    return;
  }
  // Independent on purpose: a message the employee never got an answer to must still be replayed
  // when the ledger drain fails, and vice versa. BullMQ retries the job on either failure; both
  // endpoints are idempotent (row-level CAS), so a repeat costs a no-op sweep.
  const outcomes = await Promise.allSettled([callInternal('sweep-orphan-events'), callInternal('drain')]);
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

async function callInternal(route: 'drain' | 'sweep-orphan-events'): Promise<void> {
  const apiBase = process.env['INTERNAL_API_URL'] ?? 'http://localhost:3001/v1';
  const workerToken = process.env['WORKER_INTERNAL_TOKEN'] ?? '';
  const res = await fetch(`${apiBase}/internal/ai/line-ledger/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Token': workerToken },
    body: JSON.stringify({ batchSize: 20 }),
    signal: AbortSignal.timeout(INTERNAL_API_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE AI ${route} endpoint returned ${res.status}: ${body.slice(0, 200)}`);
  }
}
