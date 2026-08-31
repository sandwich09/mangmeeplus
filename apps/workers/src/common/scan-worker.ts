import { Worker, type Job } from 'bullmq';
import { workerLog } from './log.js';
import { postInternal, throwIfNotOk } from './internal-api.js';
import { attachDeadLetterQueue, createQueue, defaultJobOptions } from './queue.js';

export function startScanWorker<T>(opts: {
  queueName: string;
  kind: string;
  jobId: string;
  intervalMs: number;
  path: string;
  failEvent: string;
  redisUrl: string;
}): Worker<T> {
  const worker = new Worker<T>(
    opts.queueName,
    async (job: Job<T>) => {
      if ((job.data as { kind?: string })?.kind === opts.kind) await callInternal(opts.path);
    },
    { connection: { url: opts.redisUrl }, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    workerLog('error', { event: opts.failEvent, jobId: job?.id, error: err?.message });
  });
  attachDeadLetterQueue(worker, opts.queueName, opts.redisUrl);

  void scheduleScan(opts).catch((err) => {
    workerLog('error', { event: `${opts.failEvent}_schedule_failed`, error: err?.message });
  });
  return worker;
}

async function scheduleScan(opts: {
  queueName: string;
  kind: string;
  jobId: string;
  intervalMs: number;
  failEvent: string;
  redisUrl: string;
}): Promise<void> {
  const queue = createQueue(opts.queueName, opts.redisUrl);
  try {
    // upsertJobScheduler templates do not inherit the queue's defaultJobOptions, so this one
    // states the retention explicitly — from the same constant, not a second copy of the numbers.
    await queue.upsertJobScheduler(
      opts.jobId,
      { every: opts.intervalMs },
      {
        name: opts.kind,
        data: { kind: opts.kind },
        opts: { ...defaultJobOptions() },
      },
    );
  } finally {
    await queue.close();
  }
}

async function callInternal(path: string): Promise<void> {
  const res = await postInternal(path);
  if (res) await throwIfNotOk(res, 'Scan endpoint');
}
