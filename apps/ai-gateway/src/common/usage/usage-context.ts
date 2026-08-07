/**
 * Request-scoped AI usage collector (metering spec §6.3, §7.2).
 *
 * One employee turn fans out into several provider calls across orchestrator, routers, critic
 * and composer; threading an accumulator through every agent signature would be a wide diff for
 * no extra information. `AsyncLocalStorage` (node built-in — no dependency, and the gateway keeps
 * no database) holds one array per internal AI request instead: providers append at the point
 * they already log `ai.usage`, and the interceptor drains it onto the response.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AiUsageEntry } from '@watchdog-bms/contracts';

type UsageStore = { companyId?: string; entries: AiUsageEntry[] };

const storage = new AsyncLocalStorage<UsageStore>();

/** Runs `fn` with a fresh, isolated collector. Concurrent runs never see each other's entries. */
export function runWithUsageContext<T>(seed: { companyId?: string }, fn: () => T): T {
  return storage.run({ ...seed, entries: [] }, fn);
}

/** No-op outside a context (unit tests, smoke scripts, the deterministic path) and never throws:
 *  losing a usage row must never fail the business call it was measuring. */
export function appendUsage(entry: AiUsageEntry): void {
  storage.getStore()?.entries.push(entry);
}

/** Returns everything collected so far and clears it, so one response can never carry another's
 *  rows even if the same context is drained twice. */
export function drainUsage(): AiUsageEntry[] {
  const store = storage.getStore();
  return store ? store.entries.splice(0, store.entries.length) : [];
}

/** Tenant of the request being measured, for the `ai.usage` log line only. */
export function currentUsageCompanyId(): string | undefined {
  return storage.getStore()?.companyId;
}
