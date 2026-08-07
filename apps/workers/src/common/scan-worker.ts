import { Worker, type Job } from 'bullmq';
import { workerLog } from './log.js';
import { createQueue, QUEUE_JOB_RETENTION } from './queue.js';

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
        opts: { ...QUEUE_JOB_RETENTION },
      },
    );
  } finally {
    await queue.close();
  }
}

async function callInternal(path: string): Promise<void> {
  const apiBase = process.env['INTERNAL_API_URL'] ?? 'http://localhost:3001/v1';
  const workerToken = process.env['WORKER_INTERNAL_TOKEN'] ?? '';
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Token': workerToken },
    body: '{}',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Scan endpoint returned ${res.status}: ${body.slice(0, 200)}`);
  }
}
