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
import { QUEUE_JOB_RETENTION } from './queue.js';

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
