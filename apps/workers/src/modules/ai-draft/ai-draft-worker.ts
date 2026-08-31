/**
 * AI Draft and Suggestion Worker (Item 17)
 * Repeatable job that drains QUEUED AI draft requests by calling apps/api's
 * worker-token-protected internal drain endpoint, which runs AI-authored generation via
 * the AI Gateway model (gateway/fake/disabled provider). Mirrors the item-16 workflow
 * worker dispatch-to-HTTP pattern.
 */
import { Worker, type Job } from 'bullmq';
import { attachDeadLetterQueue, createQueue } from '../../common/queue.js';
import { workerLog } from '../../common/log.js';
import { scheduleWithRetry } from '../../common/retry-schedule.js';
import { postInternal, throwIfNotOk } from '../../common/internal-api.js';

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
  attachDeadLetterQueue(worker, AI_DRAFT_QUEUE, redisUrl);
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
  const res = await postInternal('/internal/ai/draft-requests/drain', {
    body: { batchSize: 20 },
    timeoutMs: INTERNAL_API_TIMEOUT_MS,
  });
  if (res) await throwIfNotOk(res, 'AI draft drain endpoint');
}
