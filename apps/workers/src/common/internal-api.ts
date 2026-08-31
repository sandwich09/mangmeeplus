import { workerLog } from './log.js';

/**
 * Every worker timer that POSTs a fixed internal api route goes through `postInternal`.
 *
 * A rolling deploy runs the workers ahead of the api, so a timer whose endpoint ships in the same
 * release POSTs to a route the still-running old api tasks answer with 404. On quiet UAT those 404s
 * are most of the target group's traffic, and the canary RollbackAlarm — 4xx/total > 1% — rolled the
 * api deploy back twice on 2026-08-31. Seven workers each carried their own copy of this fetch, so
 * fixing the one that was noticed would have left six still storming.
 *
 * A 404 here is not an error, it is an endpoint that has not landed yet: log it once, stop hitting
 * it more than once every few minutes, and let the api catch up. The first non-404 answer clears the
 * backoff, so a route that was renamed away costs one probe per window and nothing more.
 *
 * NOT for per-entity paths (`.../notification-deliveries/<id>/process`). The gate keys on the path,
 * so a path carrying an id would grow an unbounded map of one-shot keys AND swallow a genuine 404
 * for one record — which must keep failing so the job retries and the DLQ sees it.
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

// One gate for the whole process: the state is keyed by path, so every worker module sharing it
// behaves exactly as it would with its own instance, and the map stays one entry per real endpoint.
const missingEndpoints = createMissingEndpointGate();

/**
 * POST a fixed internal api path. Returns `null` when the call was skipped or the endpoint is not
 * deployed yet — callers treat that as "nothing to do this tick" and must NOT throw, or the failure
 * lands in the worker's `failed` handler, which logs at error level and retries. Every one of these
 * endpoints is an idempotent sweep, so a skipped tick is picked up whole by the next one.
 */
export async function postInternal(
  path: string,
  init: { body?: Record<string, unknown>; timeoutMs?: number } = {},
): Promise<Response | null> {
  if (missingEndpoints.shouldSkip(path, Date.now())) return null;
  const apiBase = process.env['INTERNAL_API_URL'] ?? 'http://localhost:3001/v1';
  const workerToken = process.env['WORKER_INTERNAL_TOKEN'] ?? '';
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Token': workerToken },
    body: JSON.stringify(init.body ?? {}),
    ...(init.timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(init.timeoutMs) }),
  });
  if (res.status === 404) {
    if (missingEndpoints.markMissing(path, Date.now())) {
      workerLog('warn', { event: 'internal_endpoint_missing', path, retryInMs: MISSING_ENDPOINT_RETRY_MS });
    }
    return null;
  }
  missingEndpoints.markPresent(path);
  return res;
}

/** The `!res.ok` half every caller repeated, so the message stays theirs but the shape does not. */
export async function throwIfNotOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  throw new Error(`${label} returned ${res.status}: ${body.slice(0, 200)}`);
}
