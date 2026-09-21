import { Worker, type Job } from 'bullmq';
import { workerLog } from '../../common/log.js';
import { postInternal, throwIfNotOk } from '../../common/internal-api.js';
import { attachDeadLetterQueue, createQueue, defaultJobOptions } from '../../common/queue.js';

/**
 * Sales console sweeps (spec §17 D3, §17.2, S17).
 *
 * Three timers, one queue: the two 15-minute sweeps that close expired offers and write renewal
 * offers, and the 07:00 Bangkok digest that rides the same cron shape as `daily_owner_summary`.
 *
 * Like every other sweep worker this one only decides WHEN — all state lives behind the internal
 * API, and every endpoint is idempotent, so a missed tick costs nothing but a delay. Enforcement
 * never depends on it: reads derive EXPIRED on their own and P29 locks an unpaid shop on access.
 *
 * ponytail: one queue with three scheduler ids rather than three `startScanWorker` queues. The
 * jobs are a handful a day and share one failure story; split them if one ever needs its own
 * concurrency or retry policy.
 */
export const SALES_SWEEP_QUEUE = 'sales-sweep';
export const SALES_SWEEP_INTERVAL_MS = 15 * 60_000;
export const SALES_DIGEST_CRON = { pattern: '0 7 * * *', tz: 'Asia/Bangkok' } as const;

const PATHS: Record<string, string> = {
  'sales-expire-sweep': '/internal/sales/deals/expire-sweep',
  'sales-renewal-sweep': '/internal/sales/deals/renewal-sweep',
  'sales-daily-digest': '/internal/sales/daily-digest',
};

export function startSalesSweepWorker(redisUrl: string): Worker {
  const worker = new Worker(
    SALES_SWEEP_QUEUE,
    async (job: Job<{ kind?: string }>) => {
      const path = PATHS[job.data?.kind ?? ''];
      if (!path) return;
      const res = await postInternal(path);
      if (res) await throwIfNotOk(res, 'Sales sweep endpoint');
    },
    { connection: { url: redisUrl }, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    workerLog('error', { event: 'sales_sweep_failed', jobId: job?.id, kind: job?.data?.kind, error: err?.message });
  });
  attachDeadLetterQueue(worker, SALES_SWEEP_QUEUE, redisUrl);

  void schedule(redisUrl).catch((err) => {
    workerLog('error', { event: 'sales_sweep_schedule_failed', error: (err as Error)?.message });
  });
  return worker;
}

async function schedule(redisUrl: string): Promise<void> {
  const queue = createQueue(SALES_SWEEP_QUEUE, redisUrl);
  try {
    // Scheduler templates do not inherit the queue's defaultJobOptions, so each one states it.
    for (const kind of ['sales-expire-sweep', 'sales-renewal-sweep']) {
      await queue.upsertJobScheduler(kind, { every: SALES_SWEEP_INTERVAL_MS },
        { name: kind, data: { kind }, opts: { ...defaultJobOptions() } });
    }
    await queue.upsertJobScheduler('sales-daily-digest', SALES_DIGEST_CRON, {
      name: 'sales-daily-digest', data: { kind: 'sales-daily-digest' },
      // Fires once a day: without retries one 07:00 blip (api restart, canary, DB hiccup) loses
      // the whole day's digest, exactly as the owner summary next door found out.
      opts: { ...defaultJobOptions(), attempts: 5, backoff: { type: 'exponential', delay: 60_000 } },
    });
  } finally {
    await queue.close();
  }
}
