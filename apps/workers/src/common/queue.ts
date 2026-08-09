import { Queue, type Worker, type Job } from 'bullmq';
import { workerLog } from './log.js';

// BullMQ keeps every completed and failed job forever unless told otherwise, and only one of the
// seven queues ever said otherwise. Nineteen repeating jobs firing every few minutes filled UAT's
// 400 MB Redis with 270k job records until `maxmemory` was hit; because the cluster runs
// volatile-lru and job keys carry no TTL, nothing could be evicted, so every worker died on
// "OOM command not allowed when used memory > 'maxmemory'" and ECS rolled the release back.
//
// Build every queue through here. A queue that constructs itself is a queue that can forget again,
// which is exactly how six of them did.
export const QUEUE_JOB_RETENTION = {
  removeOnComplete: { count: 48 },
  removeOnFail: { count: 100 },
};

/** Suffix of the parking queue a permanently failed job is copied to. */
export const DLQ_SUFFIX = '-dlq';

export type QueuePolicy = {
  /** Total tries per job, BullMQ semantics: 1 means "no retry". */
  attempts: number;
  backoffMs: number;
  dlqEnabled: boolean;
};

// Audit H-30: QUEUE_RETRY_ATTEMPTS, QUEUE_RETRY_BACKOFF_MS and DLQ_ENABLED were declared in the
// config schema and read by nothing, so every queue ran on BullMQ's default of one attempt and a
// job that failed was trimmed away by removeOnFail. The values live in ONE place — the config
// package — and reach here through configureQueues() rather than a second copy of the defaults.
//
// The pre-configuration value is deliberately today's behaviour, not the intended one: a worker
// that somehow starts without configureQueues() keeps running exactly as it does now instead of
// silently gaining retries nobody chose.
let policy: QueuePolicy = { attempts: 1, backoffMs: 0, dlqEnabled: false };

export function configureQueues(next: QueuePolicy): void {
  policy = next;
}

export function queuePolicy(): QueuePolicy {
  return policy;
}

/** Retention + retry, as every queue and every scheduler template should declare them. */
export function defaultJobOptions(): Record<string, unknown> {
  return {
    ...QUEUE_JOB_RETENTION,
    attempts: policy.attempts,
    ...(policy.attempts > 1 ? { backoff: { type: 'exponential', delay: policy.backoffMs } } : {}),
  };
}

export function createQueue(name: string, redisUrl: string): Queue {
  return new Queue(name, { connection: { url: redisUrl }, defaultJobOptions: defaultJobOptions() });
}

/**
 * Park a job that has exhausted its attempts on `<queue>-dlq` so it survives for inspection.
 *
 * Without this a permanently failed job is just one of the last 100 failures and is trimmed away by
 * the next hundred — the failure is a log line and nothing else. BullMQ emits `failed` on EVERY
 * attempt, so only the last one is parked; otherwise a job with 3 attempts would land in the DLQ
 * three times.
 *
 * Best-effort by design: the DLQ write must never take down the worker that was only reporting a
 * failure. A DLQ that is itself unreachable degrades to the log line we already had.
 */
export function attachDeadLetterQueue(worker: Worker, queueName: string, redisUrl: string): void {
  if (!policy.dlqEnabled) return;
  const dlq = createQueue(`${queueName}${DLQ_SUFFIX}`, redisUrl);
  worker.on('failed', (job, err) => {
    void parkFailedJob(dlq, queueName, job, err).catch((dlqError: Error) => {
      workerLog('error', { event: 'worker_dlq_write_failed', queue: queueName, jobId: job?.id, error: dlqError.message });
    });
  });
  worker.on('closed', () => { void dlq.close().catch(() => {}); });
}

export function isFinalAttempt(job: Pick<Job, 'attemptsMade' | 'opts'> | undefined): boolean {
  if (!job) return false;
  // `attempts` unset means BullMQ's default of 1, so the first failure is already the last.
  return job.attemptsMade >= (job.opts?.attempts ?? 1);
}

async function parkFailedJob(dlq: Queue, queueName: string, job: Job | undefined, err: Error | undefined): Promise<void> {
  if (!isFinalAttempt(job) || !job) return;
  await dlq.add(job.name, {
    // The payload plus why it died, so the row is actionable without cross-referencing logs.
    originalQueue: queueName,
    originalJobId: job.id,
    kind: (job.data as { kind?: string } | undefined)?.kind,
    data: job.data,
    failedReason: err?.message ?? job.failedReason,
    attemptsMade: job.attemptsMade,
    failedAt: new Date().toISOString(),
  }, {
    // Parked jobs are evidence, never work: nothing consumes this queue, so a retry would only
    // re-park them. Retention is bounded so the DLQ cannot repeat the OOM the note above describes.
    attempts: 1,
    removeOnComplete: false,
    removeOnFail: { count: 500 },
  });
  workerLog('error', {
    event: 'worker_job_dead_lettered',
    queue: queueName,
    jobId: job.id,
    attemptsMade: job.attemptsMade,
    error: err?.message,
  });
}
