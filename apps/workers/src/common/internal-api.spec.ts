import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MISSING_ENDPOINT_RETRY_MS, createMissingEndpointGate } from './internal-api.js';

const RETRY_MS = 5_000;
const SRC = fileURLToPath(new URL('..', import.meta.url));

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

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

  /**
   * Seven workers each carried their own copy of the `apiBase + fetch + throw` block, so fixing the
   * two that were noticed would have left five still storming. `postInternal` is the only door now,
   * and this keeps the eighth from cutting a new one.
   *
   * `X-Worker-Token` is the real signature of an internal call — the env var alone also matches
   * `main.ts`, which merely forwards the URL into a config object.
   */
  it('keeps the internal api behind postInternal', () => {
    const offenders = tsFiles(SRC)
      .map((file) => [relative(SRC, file), readFileSync(file, 'utf8')] as const)
      .filter(([, source]) => source.includes("'X-Worker-Token'"))
      .map(([file]) => file)
      .filter((file) => !INTENTIONALLY_UNGATED.includes(file))
      .sort();

    assert.deepEqual(offenders, ['common/internal-api.ts'], `send these through postInternal: ${offenders.join(', ')}`);
  });
});

/**
 * The gate keys on the path, which only works for a fixed endpoint. `notification-worker.ts` posts
 * per-entity paths (`companies/<id>/notification-deliveries/<id>/process`), so routing it through
 * `postInternal` would grow an unbounded map of one-shot keys AND swallow a real 404 for a single
 * delivery — which must keep failing so the job retries and the DLQ sees it. Its own 404s are
 * per-record, not the deploy-wide storm this gate exists for.
 *
 * `object-version-cleanup-worker.ts` builds a token header for S3-side work driven through the
 * workflow worker, which is gated at that end.
 */
const INTENTIONALLY_UNGATED = [
  'modules/notifications/notification-worker.ts',
  'modules/object-version-cleanup/object-version-cleanup-worker.ts',
];
