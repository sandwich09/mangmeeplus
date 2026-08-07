/**
 * AI Draft and Suggestion Worker (Item 17)
 * Repeatable job that drains QUEUED AI draft requests by calling apps/api's
 * worker-token-protected internal drain endpoint, which runs AI-authored generation via
 * the AI Gateway model (gateway/fake/disabled provider). Mirrors the item-16 workflow
 * worker dispatch-to-HTTP pattern.
 */
import { Worker, type Job } from 'bullmq';
import { createQueue } from '../../common/queue.js';
import { workerLog } from '../../common/log.js';
import { scheduleWithRetry } from '../../common/retry-schedule.js';

export const AI_DRAFT_QUEUE = 'ai-draft';
export type AiDraftJobPayload = { kind: 'draft.drain' };

const DRAIN_INTERVAL_MS = 15_000;
const INTERNAL_API_TIMEOUT_MS = 10 * 60_000;

export function startAiDraftWorker(redisUrl: string): Worker {
  const worker = new Worker(
    AI_DRAFT_QUEUE,
    async (job: Job<AiDraftJobPayload>) => {
      await processJob(job.data);
    },
    { connection: { url: redisUrl }, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    workerLog('error', { event: 'ai_draft_job_failed', jobId: job?.id, kind: job?.data?.kind, error: err?.message });
  });

  scheduleWithRetry(
    () => scheduleRepeatableJobs(redisUrl),
    DRAIN_INTERVAL_MS,
    (err) => {
      workerLog('error', { event: 'ai_draft_schedule_failed', error: (err as Error).message });
    },
  );
  return worker;
}

async function scheduleRepeatableJobs(redisUrl: string): Promise<void> {
  const queue = createQueue(AI_DRAFT_QUEUE, redisUrl);
  try {
    await queue.add('draft.drain', { kind: 'draft.drain' }, { repeat: { every: DRAIN_INTERVAL_MS }, jobId: 'ai-draft-drain' });
  } finally {
    await queue.close().catch(() => undefined);
  }
}

async function processJob(payload: AiDraftJobPayload): Promise<void> {
  if (payload.kind !== 'draft.drain') {
    workerLog('warn', { event: 'unknown_ai_draft_job_kind', payload });
    return;
  }
  const apiBase = process.env['INTERNAL_API_URL'] ?? 'http://localhost:3001/v1';
  const workerToken = process.env['WORKER_INTERNAL_TOKEN'] ?? '';
  const res = await fetch(`${apiBase}/internal/ai/draft-requests/drain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Token': workerToken },
    body: JSON.stringify({ batchSize: 20 }),
    signal: AbortSignal.timeout(INTERNAL_API_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI draft drain endpoint returned ${res.status}: ${body.slice(0, 200)}`);
  }
}
