import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleWithRetry } from './retry-schedule.js';

describe('scheduleWithRetry', () => {
  it('retries a failed scheduler and stops retrying after success', async () => {
    let attempts = 0;
    const errors: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const guard = setTimeout(() => reject(new Error('scheduler retry timed out')), 1_000);
      scheduleWithRetry(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('redis unavailable');
        clearTimeout(guard);
        resolve();
      }, 1, (error) => errors.push(error.message));
    });

    assert.equal(attempts, 2);
    assert.deepEqual(errors, ['redis unavailable']);
  });
});
