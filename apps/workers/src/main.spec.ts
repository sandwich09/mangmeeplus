/**
 * Audit H-30: workers handled no signal, so every deploy SIGKILLed whatever job was mid-flight —
 * a LINE send that died between "sent" and "recorded" came back on redelivery and sent twice.
 *
 * main.ts runs its whole startup on import (queues, listeners, timers), so this asserts the wiring
 * from the source rather than by executing it. The regression these guard against is mechanical and
 * likely: someone adds the tenth worker and forgets to register it for shutdown, and nothing fails
 * until a deploy drops one of its jobs in production.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const main = readFileSync(fileURLToPath(new URL('./main.ts', import.meta.url)), 'utf8');

describe('workers startup wiring', () => {
  it('registers every started worker for shutdown', () => {
    const started = [...main.matchAll(/^\s*(?:workers\.push\()?(start[A-Za-z]+Worker)\(/gm)];
    assert.ok(started.length >= 9, `expected the full worker set, saw ${started.length}`);

    const unregistered = started
      .filter((match) => !match[0].includes('workers.push('))
      .map((match) => match[1]);
    assert.deepEqual(unregistered, [], `these close on SIGKILL instead of draining: ${unregistered.join(', ')}`);
  });

  it('starts the capture read scan so a stranded PDF job is resumed, not stranded', () => {
    // The API kicks a job in its own process; this timer is the ONLY thing that picks one up
    // again after the task that owned it died mid-file (appendix §4.5).
    assert.match(main, /startExpenseCaptureReadWorker\(config\.REDIS_URL\)/);
    assert.match(main, /workers\.push\(startExpenseCaptureReadWorker/);
  });

  it('handles both SIGTERM and SIGINT', () => {
    // ECS sends SIGTERM; SIGINT is the local Ctrl-C equivalent. Handling only one leaves the other
    // path killing jobs exactly as before.
    assert.match(main, /'SIGTERM',\s*'SIGINT'/);
  });

  it('bounds the drain with the configured timeout instead of waiting forever', () => {
    assert.match(main, /WORKER_SHUTDOWN_TIMEOUT_MS/);
    assert.match(main, /workers_shutdown_timeout/);
  });

  it('closes the health server before draining so the balancer stops routing here', () => {
    const closeAt = main.indexOf('healthServer.close()');
    const drainAt = main.indexOf('worker.close()');
    assert.ok(closeAt > 0 && drainAt > 0, 'both steps must exist');
    assert.ok(closeAt < drainAt, 'health check must stop answering before jobs are drained');
  });

  it('applies the queue retry/DLQ policy before any worker starts', () => {
    const configureAt = main.indexOf('configureQueues(');
    const firstWorkerAt = main.search(/workers\.push\(start/);
    assert.ok(configureAt > 0, 'QUEUE_RETRY_* and DLQ_ENABLED must be applied, not just declared');
    // Queues read the policy when they are constructed, so a later call would leave the first
    // workers on the old defaults — the exact half-applied state that is hardest to notice.
    assert.ok(configureAt < firstWorkerAt, 'policy must be set before the first worker is built');
  });

  it('refuses a second shutdown rather than racing two closes', () => {
    assert.match(main, /if \(shuttingDown\) return;/);
  });
});
