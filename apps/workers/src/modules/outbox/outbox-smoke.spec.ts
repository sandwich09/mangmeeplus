import { describe, it } from 'node:test';
import assert from 'node:assert';
import { processSmoke, computeNextAvailableAt } from './outbox-smoke.js';

describe('outbox-smoke', () => {
  it('marks smoke event published', () => {
    const result = processSmoke({
      id: '1',
      eventType: 'test.event',
      aggregateType: 'Branch',
      aggregateId: 'b1',
      eventKey: 'key1',
      status: 'PROCESSING',
    });
    assert.strictEqual(result.published, true);
    assert.strictEqual(result.eventId, '1');
  });

  it('computes exponential backoff', () => {
    const t0 = computeNextAvailableAt(0);
    const t1 = computeNextAvailableAt(1);
    assert.ok(t1 > t0);
  });

  it('caps backoff at 5 minutes', () => {
    const t = computeNextAvailableAt(20);
    assert.ok(t.getTime() - Date.now() <= 300_000 + 100);
  });
});
