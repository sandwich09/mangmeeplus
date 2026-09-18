/**
 * Layer 1 of the hold-reconciliation spec (§3): do not LOSE the evidence while this process is
 * still alive.
 *
 * Two process-wide pieces, in one file because the drain needs both:
 *
 * 1. **The settle-evidence queue.** When `budget-settle` has failed its two inline attempts, the
 *    evidence is parked here and re-posted on a backoff OUTSIDE the request path. A hold only
 *    becomes `UNRESOLVED` if the API is unreachable for the whole window. Nothing here can delay a
 *    business call: enqueue is synchronous and in-memory, and the retries run on an `unref`ed timer.
 * 2. **The in-flight gauge.** How many guarded provider calls are running right now, so a SIGTERM
 *    can wait for them to finish before the evidence queue is flushed and the process exits.
 *
 * Process-wide rather than per-seam on purpose: `createProvider` builds a NEW seam for every
 * provider it wraps, so a queue owned by a seam would be thrown away with it.
 *
 * NOTHING in here is reachable without a `budgetEnvelope`. A SHARED request never calls
 * `settle`, never marks itself in flight, and the drain finds an empty queue and a zero gauge.
 */

/** Delay before re-post attempt 1, 2, 3, then 60s for every later one (spec §3). */
const BACKOFF_MS = [1_000, 5_000, 30_000, 60_000] as const;
/** Total time one piece of evidence may stay queued. Past it the hold is honestly `UNRESOLVED`. */
export const SETTLE_EVIDENCE_MAX_AGE_MS = 10 * 60_000;
/** Bounded memory: the gateway has no disk, and an unbounded queue is an OOM waiting for an outage. */
export const SETTLE_EVIDENCE_MAX_ENTRIES = 1_000;

/** What the re-post answers. `rejected` is terminal: the API decided, retrying repeats it. */
export type SettleEvidenceOutcome = 'recorded' | 'rejected' | 'unreachable';

export type SettleEvidenceItem = {
  invocationKey: string;
  sourceRoute: string;
  companyId: string | undefined;
  /** Attempts so far, INCLUDING the two the request path already made. */
  attempts: number;
  /** Re-posts the exact same body the inline attempts sent. Must never throw. */
  post: () => Promise<SettleEvidenceOutcome>;
  queuedAtMs: number;
  nextAtMs: number;
};

export type DurabilityLog = (line: Record<string, unknown>) => void;

const queue: SettleEvidenceItem[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = 0;

/** Ids and counters only — this is the money path, and a log line is not a place for a prompt. */
function backoffFor(attemptsAfterInline: number): number {
  return BACKOFF_MS[Math.min(attemptsAfterInline, BACKOFF_MS.length - 1)]!;
}

/**
 * Parks one invocation's evidence for re-posting. Returns false when the queue is full — the
 * evidence is then dropped and logged, which is the same outcome as before this queue existed.
 */
export function enqueueSettleEvidence(
  item: Pick<SettleEvidenceItem, 'invocationKey' | 'sourceRoute' | 'companyId' | 'attempts' | 'post'>,
  log: DurabilityLog,
  now = Date.now(),
): boolean {
  if (queue.length >= SETTLE_EVIDENCE_MAX_ENTRIES) {
    log({ msg: 'ai.budget.settle_evidence_dropped', reason: 'queue_full', depth: queue.length,
      invocationKey: item.invocationKey, sourceRoute: item.sourceRoute });
    return false;
  }
  queue.push({ ...item, queuedAtMs: now, nextAtMs: now + backoffFor(0) });
  schedule(log);
  return true;
}

/**
 * One pass over the queue: expire what is too old, re-post what is due, re-arm the rest.
 *
 * Exported so tests drive it with an explicit clock instead of waiting on real timers. Sequential
 * on purpose — a burst of parked evidence must not become a burst of load on an API that is
 * already struggling.
 */
export async function runSettleEvidenceQueue(
  log: DurabilityLog,
  now = Date.now(),
  options: { ignoreBackoff?: boolean } = {},
): Promise<{ posted: number; dropped: number; remaining: number }> {
  let posted = 0;
  let dropped = 0;
  for (const item of [...queue]) {
    if (now - item.queuedAtMs >= SETTLE_EVIDENCE_MAX_AGE_MS) {
      remove(item);
      dropped += 1;
      log({ msg: 'ai.budget.settle_evidence_dropped', reason: 'expired', attempts: item.attempts,
        invocationKey: item.invocationKey, sourceRoute: item.sourceRoute });
      continue;
    }
    if (!options.ignoreBackoff && item.nextAtMs > now) continue;
    item.attempts += 1;
    // `post` is documented never to throw; a broken implementation must still not kill the loop.
    const outcome = await item.post().catch((): SettleEvidenceOutcome => 'unreachable');
    if (outcome === 'unreachable') {
      item.nextAtMs = now + backoffFor(item.attempts - 2);
      continue;
    }
    // Removed on `recorded` AND on `rejected`: both are the API's final word on this invocation,
    // so the item is posted exactly once successfully and never re-posted after that.
    remove(item);
    posted += 1;
    log({ msg: 'ai.budget.settle_evidence_posted', outcome, attempts: item.attempts,
      invocationKey: item.invocationKey, sourceRoute: item.sourceRoute });
  }
  return { posted, dropped, remaining: queue.length };
}

/** How much evidence is still parked. For the drain summary and for tests. */
export function settleEvidenceDepth(): number {
  return queue.length;
}

/** Clears the queue and its timer. Test teardown, and the last step of a completed drain. */
export function resetSettleEvidence(): void {
  queue.length = 0;
  if (timer) clearTimeout(timer);
  timer = undefined;
  inFlight = 0;
}

function remove(item: SettleEvidenceItem): void {
  const index = queue.indexOf(item);
  if (index >= 0) queue.splice(index, 1);
}

/**
 * Arms one timer for the earliest due item. `unref` so a parked retry can never be the reason a
 * process (or a test runner) refuses to exit — the drain is what guarantees a clean shutdown.
 */
function schedule(log: DurabilityLog): void {
  if (timer || queue.length === 0) return;
  const delay = Math.max(50, Math.min(...queue.map((item) => item.nextAtMs)) - Date.now());
  timer = setTimeout(() => {
    timer = undefined;
    void runSettleEvidenceQueue(log).finally(() => schedule(log));
  }, delay);
  timer.unref?.();
}

// ── The in-flight gauge (spec §3, graceful drain step 2) ─────────────────────────────────────────

/** A guarded provider call started. Called from the decorator, under an envelope only. */
export function beginGuardedProviderCall(): void {
  inFlight += 1;
}

/** …and finished. Always from the decorator's `finally`, so a throw still decrements. */
export function endGuardedProviderCall(): void {
  inFlight = Math.max(0, inFlight - 1);
}

export function guardedProviderCallsInFlight(): number {
  return inFlight;
}

/**
 * The SIGTERM drain (spec §3). Nest has already stopped the HTTP listener by the time this runs, so
 * step 1 ("stop accepting new work") is the framework's; this is steps 2 and 3:
 *
 * 1. wait for guarded provider calls that are already running, up to `budgetMs`;
 * 2. flush the evidence queue ignoring its backoff, with whatever of the budget is left;
 * 3. emit ONE summary line with counts only.
 *
 * `budgetMs` must stay below the container's stop timeout, or the runtime SIGKILLs mid-flush and
 * the wait was worse than not waiting: `infra/prod-ecs-express/deploy.sh` sets no `stopTimeout` on
 * the Express `primaryContainer` at all (the shape has no such field), so ECS's own 30-second
 * default applies to the live gateway.
 */
export async function drainAiBudgetDurability(options: {
  budgetMs: number;
  log: DurabilityLog;
  /** Injected in tests; real callers use the default. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<{ waitedMs: number; inFlightAtExit: number; posted: number; dropped: number; remaining: number }> {
  const clock = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms).unref?.(); }));
  const startedAt = clock();
  const deadline = startedAt + options.budgetMs;

  while (inFlight > 0 && clock() < deadline) await sleep(Math.min(100, Math.max(1, deadline - clock())));
  const waitedMs = clock() - startedAt;
  const inFlightAtExit = inFlight;

  // Whatever the wait cost, the evidence still gets at least one flush pass: a settle posted after
  // the process exits is a hold nobody can close.
  let posted = 0;
  let dropped = 0;
  do {
    const pass = await runSettleEvidenceQueue(options.log, clock(), { ignoreBackoff: true });
    posted += pass.posted;
    dropped += pass.dropped;
    if (pass.remaining === 0 || pass.posted === 0) break;
  } while (clock() < deadline);

  const summary = { waitedMs, inFlightAtExit, posted, dropped, remaining: queue.length };
  options.log({ msg: 'ai.budget.drain_complete', ...summary });
  return summary;
}
