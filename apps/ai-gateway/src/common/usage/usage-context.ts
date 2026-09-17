/**
 * Request-scoped AI usage collector (metering spec §6.3, §7.2).
 *
 * One employee turn fans out into several provider calls across orchestrator, routers, critic
 * and composer; threading an accumulator through every agent signature would be a wide diff for
 * no extra information. `AsyncLocalStorage` (node built-in — no dependency, and the gateway keeps
 * no database) holds one array per internal AI request instead: providers append at the point
 * they already log `ai.usage`, and the interceptor drains it onto the response.
 *
 * Phase E1c parks the request's validated SPLIT budget state here too (ADR 0013 §6). The same
 * reason applies — the provider decorator, the AgentCore branch and the Bedrock timeout estimate
 * all need it, and none of them is on a path that could thread it through by hand. A request with
 * no `budgetEnvelope` (every company today) stores nothing, so every reader sees `undefined` and
 * behaves exactly as before.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AiBudgetEnvelope, AiUsageEntry } from '@watchdog-bms/contracts';

/**
 * What the receiver boundary decided about this request's money.
 *
 * `invalid` is NOT the same as absent: the request carried an envelope that failed validation, so
 * it must be refused rather than run unmetered (spec §12.3). It is kept as a distinct state
 * precisely so no reader can mistake "could not be checked" for "no budget envelope".
 */
export type BudgetRequestState =
  | { status: 'invalid' }
  | {
      status: 'active';
      envelope: AiBudgetEnvelope;
      /** Route segment, e.g. `receipt-ocr` — what the API's own meter calls this seam. */
      sourceRoute: string;
      requestId?: string;
      /** Provider calls already claimed by this request; the next call's ordinal. */
      calls: number;
    };

type UsageStore = { companyId?: string; entries: AiUsageEntry[]; budget?: BudgetRequestState };

const storage = new AsyncLocalStorage<UsageStore>();

/** Runs `fn` with a fresh, isolated collector. Concurrent runs never see each other's entries. */
export function runWithUsageContext<T>(seed: { companyId?: string; budget?: BudgetRequestState }, fn: () => T): T {
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

/** This request's validated money state, or `undefined` when it carried no envelope at all. */
export function currentBudgetState(): BudgetRequestState | undefined {
  return storage.getStore()?.budget;
}

/** The declared envelope, only when one validated. Readers that just need the bounds use this. */
export function currentBudgetEnvelope(): AiBudgetEnvelope | undefined {
  const budget = storage.getStore()?.budget;
  return budget?.status === 'active' ? budget.envelope : undefined;
}

/**
 * Claims the next provider-call ordinal of this request. Call index 0 is the invocation the API
 * already reserved and dispatched; every later index needs its own `budget-step` first, which is
 * why the counter lives with the request rather than with a provider instance — one receipt chain
 * builds three separate providers and they must share one ordinal sequence.
 */
export function claimBudgetCallOrdinal(): number {
  const budget = storage.getStore()?.budget;
  if (budget?.status !== 'active') return 0;
  return budget.calls++;
}

/** How many usage rows this request has collected — the index the next provider call appends at. */
export function usageEntryCount(): number {
  return storage.getStore()?.entries.length ?? 0;
}

/**
 * Stamps the invocation key on every usage row appended at or after `fromIndex` and returns them.
 *
 * The rows are the same objects the interceptor drains onto the response, so this is what makes
 * the response path an idempotent duplicate of the evidence path (ADR 0013 §7) — and what the
 * decorator posts as that invocation's evidence.
 */
export function tagUsageInvocation(fromIndex: number, invocationKey: string): AiUsageEntry[] {
  const store = storage.getStore();
  if (!store) return [];
  const tagged = store.entries.slice(fromIndex);
  for (const entry of tagged) entry.invocationKey = invocationKey;
  return tagged;
}
