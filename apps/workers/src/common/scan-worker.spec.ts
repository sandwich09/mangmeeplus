import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MISSING_ENDPOINT_RETRY_MS, createMissingEndpointGate } from './scan-worker.js';

const RETRY_MS = 5_000;

describe('missing internal endpoint backoff', () => {
  it('logs the first sighting and then skips the endpoint for a whole window', () => {
    const gate = createMissingEndpointGate(RETRY_MS);

    assert.equal(gate.shouldSkip('/internal/a', 0), false, 'an unseen endpoint is always tried');
    assert.equal(gate.markMissing('/internal/a', 0), true, 'first 404 is the one that logs');
    assert.equal(gate.shouldSkip('/internal/a', 1), true);
    assert.equal(gate.shouldSkip('/internal/a', RETRY_MS - 1), true);
    assert.equal(gate.shouldSkip('/internal/a', RETRY_MS), false, 'the window ends, one probe is allowed');
  });

  it('stays quiet while the endpoint keeps 404ing', () => {
    const gate = createMissingEndpointGate(RETRY_MS);
    gate.markMissing('/internal/a', 0);

    assert.equal(gate.markMissing('/internal/a', RETRY_MS), false, 'no second log line for the same outage');
    assert.equal(gate.shouldSkip('/internal/a', RETRY_MS + 1), true, 'the probe re-armed the backoff');
  });

  it('resets on the first non-404 answer and logs again if it disappears later', () => {
    const gate = createMissingEndpointGate(RETRY_MS);
    gate.markMissing('/internal/a', 0);

    gate.markPresent('/internal/a');

    assert.equal(gate.shouldSkip('/internal/a', 1), false, 'a deployed endpoint is hit on its normal cadence');
    assert.equal(gate.markMissing('/internal/a', 1), true, 'a later outage is a new outage');
  });

  it('backs off one endpoint without muting the others', () => {
    const gate = createMissingEndpointGate(RETRY_MS);
    gate.markMissing('/internal/a', 0);

    assert.equal(gate.shouldSkip('/internal/b', 1), false);
    assert.equal(gate.shouldSkip('/internal/a', 1), true);
  });

  it('keeps the api under one probe per endpoint per five minutes', () => {
    // The 404 storm that tripped the canary RollbackAlarm came from 15s and 60s timers; the
    // default has to be far longer than any of those cadences to actually thin the traffic out.
    assert.equal(MISSING_ENDPOINT_RETRY_MS, 5 * 60_000);
  });
});
