import { Worker, type Job } from 'bullmq';
import { workerLog } from './log.js';
import { attachDeadLetterQueue, createQueue, defaultJobOptions } from './queue.js';

/**
 * A rolling deploy runs the workers ahead of the api, so a timer whose internal endpoint ships in
 * the same release POSTs to a route the still-running old api tasks answer with 404. On quiet UAT
 * those 404s are most of the target group's traffic, and the canary RollbackAlarm — 4xx/total > 1%
 * — rolled the api deploy back twice on 2026-08-31.
 *
 * A 404 here is not an error, it is an endpoint that has not landed yet: log it once, stop hitting
 * it more than once every few minutes, and let the api catch up. The first non-404 answer clears
 * the backoff, so a renamed-away endpoint keeps costing one probe per window and nothing more.
 */
export const MISSING_ENDPOINT_RETRY_MS = 5 * 60_000;

export function createMissingEndpointGate(retryMs: number = MISSING_ENDPOINT_RETRY_MS) {
  // ponytail: in-process Map, one entry per path. A restart costs one extra probe per endpoint,
  // which is the same single 404 the first run after any deploy makes anyway; persist it only if
  // workers ever restart often enough for that probe to matter.
  const retryAfter = new Map<string, number>();
  return {
    shouldSkip: (path: string, now: number): boolean => now < (retryAfter.get(path) ?? 0),
    /** True the first time a path goes missing, so the log line is written once per outage. */
    markMissing(path: string, now: number): boolean {
      const firstSighting = !retryAfter.has(path);
      retryAfter.set(path, now + retryMs);
      return firstSighting;
    },
    markPresent(path: string): void {
      retryAfter.delete(path);
    },
  };
}

const missingEndpoints = createMissingEndpointGate();

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
  if (missingEndpoints.shouldSkip(path, Date.now())) return;
  const apiBase = process.env['INTERNAL_API_URL'] ?? 'http://localhost:3001/v1';
  const workerToken = process.env['WORKER_INTERNAL_TOKEN'] ?? '';
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Token': workerToken },
    body: '{}',
  });
  if (res.status === 404) {
    if (missingEndpoints.markMissing(path, Date.now())) {
      workerLog('warn', { event: 'internal_endpoint_missing', path, retryInMs: MISSING_ENDPOINT_RETRY_MS });
    }
    // Deliberately not thrown: throwing lands in the `failed` handler above, which logs at error
    // level and retries the job — exactly the error accounting a not-yet-deployed route must stay
    // out of.
    return;
  }
  missingEndpoints.markPresent(path);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Scan endpoint returned ${res.status}: ${body.slice(0, 200)}`);
  }
}
