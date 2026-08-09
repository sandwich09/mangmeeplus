/**
 * The queue that forgets its retention is the queue that fills Redis. Six of seven did, and UAT's
 * workers died on "OOM command not allowed when used memory > 'maxmemory'" with 270k job records
 * held in a 400 MB cache. `createQueue` is the only place allowed to call `new Queue`, so a
 * seventh cannot repeat it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUEUE_JOB_RETENTION, configureQueues, defaultJobOptions, isFinalAttempt, queuePolicy } from './queue.js';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('queue retention', () => {
  it('keeps new Queue() confined to the createQueue helper', () => {
    const offenders = tsFiles(SRC)
      .filter((file) => readFileSync(file, 'utf8').includes('new Queue('))
      .map((file) => relative(SRC, file))
      .filter((file) => file !== 'common/queue.ts')
      .sort();

    assert.deepEqual(offenders, [], `construct these through createQueue: ${offenders.join(', ')}`);
  });

  it('bounds both completed and failed job history', () => {
    // Unbounded on either side refills Redis just as fast — a failing repeat job produces one
    // record per interval exactly like a succeeding one.
    assert.ok(QUEUE_JOB_RETENTION.removeOnComplete.count > 0);
    assert.ok(QUEUE_JOB_RETENTION.removeOnFail.count > 0);
  });
});

/**
 * Audit H-30: QUEUE_RETRY_ATTEMPTS, QUEUE_RETRY_BACKOFF_MS and DLQ_ENABLED were declared in the
 * config schema and read by nothing, so every queue ran BullMQ's default of one attempt and a
 * permanently failed job was trimmed away by removeOnFail.
 */
describe('queue retry policy', () => {
  it('runs as it always did until main.ts applies the configured policy', () => {
    // Not the intended values: a worker that somehow starts without configureQueues() must keep
    // today's behaviour rather than silently gain retries nobody chose.
    assert.equal(queuePolicy().attempts, 1);
    assert.equal(queuePolicy().dlqEnabled, false);
    assert.equal(defaultJobOptions()['attempts'], 1);
    assert.equal(defaultJobOptions()['backoff'], undefined, 'one attempt needs no backoff');
  });

  it('carries the configured attempts and backoff into every job', () => {
    configureQueues({ attempts: 3, backoffMs: 1000, dlqEnabled: true });
    const opts = defaultJobOptions();

    assert.equal(opts['attempts'], 3);
    assert.deepEqual(opts['backoff'], { type: 'exponential', delay: 1000 });
    // Retention must survive alongside retry — dropping it is how Redis filled up before.
    assert.deepEqual(opts['removeOnComplete'], QUEUE_JOB_RETENTION.removeOnComplete);
    assert.deepEqual(opts['removeOnFail'], QUEUE_JOB_RETENTION.removeOnFail);
  });

  it('omits backoff when retries are switched off', () => {
    configureQueues({ attempts: 1, backoffMs: 5000, dlqEnabled: false });
    assert.equal(defaultJobOptions()['backoff'], undefined);
  });
});

describe('dead-letter routing', () => {
  // BullMQ emits `failed` on EVERY attempt. Parking on each one would file the same job three
  // times over and make the DLQ depth meaningless.
  it('parks a job only once its attempts are exhausted', () => {
    assert.equal(isFinalAttempt({ attemptsMade: 1, opts: { attempts: 3 } } as never), false);
    assert.equal(isFinalAttempt({ attemptsMade: 2, opts: { attempts: 3 } } as never), false);
    assert.equal(isFinalAttempt({ attemptsMade: 3, opts: { attempts: 3 } } as never), true);
  });

  it('treats an unset attempts option as BullMQ does — one try, so the first failure is final', () => {
    assert.equal(isFinalAttempt({ attemptsMade: 1, opts: {} } as never), true);
  });

  it('ignores a missing job rather than parking an empty row', () => {
    assert.equal(isFinalAttempt(undefined), false);
  });
});
