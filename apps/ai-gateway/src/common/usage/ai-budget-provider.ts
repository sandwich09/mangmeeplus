/**
 * The one provider decorator that makes the gateway unable to spend outside what the API reserved
 * (ADR 0013 §6, spec §12.3/§12.6). Applied inside `createProvider` — the single choke point every
 * agent in every module already goes through — so no call site had to learn about money.
 *
 * With no envelope in the request context (every company today, all SHARED) it is a PURE
 * pass-through: the same provider object's method is invoked with the caller's own input object,
 * so the provider receives identical bytes and returns an identical result. That property is the
 * reason the refusals below are all decided from the request itself and never by rewriting it.
 *
 * With an envelope, for every `generateText` / `generateWithTools` call:
 *   1. the model must be the one the hold was priced for;
 *   2. `maxTokens` must be declared and within the declared output bound;
 *   3. the request must be provably within the declared input bound;
 *   4. call index 0 uses the invocation the API reserved, index >= 1 must first win its own
 *      `budget-step`, and a call past `maxCalls` never happens at all;
 *   5. the invocation's evidence is posted to `budget-settle` afterwards — success, provider error
 *      and timeout alike — and a settle failure never fails the business call.
 */
import {
  AI_BUDGET_DOCUMENT_MAX_PAGES,
  AI_BUDGET_DOCUMENT_PAGE_TOKEN_CEILING,
  AI_BUDGET_IMAGE_TOKEN_CEILING,
  AI_BUDGET_REFUSAL_CODES,
  type AiBudgetEnvelope,
  type AiBudgetRefusalCode,
  type AiBudgetScope,
  type ProviderError,
} from '@watchdog-bms/contracts';
import type { IModelProvider, ProviderInput, ProviderToolsInput } from '../../modules/line-ai/infrastructure/provider/provider.port';
import type { AiBudgetSeam } from './ai-budget-seam';
import {
  claimBudgetCallOrdinal,
  currentBudgetState,
  tagUsageInvocation,
  usageEntryCount,
  type BudgetRequestState,
} from './usage-context';

export type AiBudgetProviderOptions = {
  /** The model `createProvider` actually configured — compared with the envelope's, not trusted. */
  modelId: string;
  companyId: string | undefined;
  seam: AiBudgetSeam;
  log: (line: Record<string, unknown>) => void;
};

/**
 * A budget refusal travels as a `ProviderError`, which is the one shape EVERY route in this
 * gateway already knows how to surface in its own error envelope (`{status:'failed', errorCode}`,
 * an UNAVAILABLE route plan, a `{status:'unavailable', error}` CRM result). `budgetCode` carries
 * the seam's own vocabulary so "เหลือไม่พอ" is never reported as "ลองใหม่อีกครั้ง" (spec §9.1).
 */
export function aiBudgetProviderError(
  code: AiBudgetRefusalCode,
  budgetScope: AiBudgetScope,
  reason: string,
): ProviderError {
  return { code: 'PROVIDER_BUDGET_EXHAUSTED', message: reason, retryable: false, budgetScope, budgetCode: code };
}

const unavailable = (scope: AiBudgetScope, reason: string): ProviderError =>
  aiBudgetProviderError(AI_BUDGET_REFUSAL_CODES.unavailable, scope, reason);

/**
 * What a route puts in its OWN error envelope for a failed provider call. `budgetCode` wins when
 * present, so a money refusal reaches the API as `AI_BUDGET_*` + scope — the vocabulary every seam
 * already understands (spec §9.1) — while every other failure keeps its exact existing code.
 */
export function providerErrorEnvelope(
  error: ProviderError,
): { errorCode: string; budgetScope?: AiBudgetScope } {
  return {
    errorCode: error.budgetCode ?? error.code,
    ...(error.budgetScope ? { budgetScope: error.budgetScope } : {}),
  };
}

/**
 * Upper bound on a PDF's page count from its own bytes, or `undefined` when it cannot be proven.
 *
 * `/Count` in the page tree is the document's own page total and `/Type /Page` counts the page
 * objects; the larger of the two is taken, because over-counting only refuses work while
 * under-counting would spend past the hold. A PDF whose page objects live in compressed object
 * streams shows neither, and an unprovable bound is `AI_BUDGET_UNAVAILABLE` (spec §12.3) rather
 * than a guess.
 */
export function pdfPageUpperBound(contentBase64: string): number | undefined {
  let text: string;
  try {
    text = Buffer.from(contentBase64, 'base64').toString('latin1');
  } catch {
    return undefined;
  }
  // `/Type /Page` must not match `/Pages` (the tree node), hence the trailing guard.
  const pageObjects = text.match(/\/Type\s*\/Page(?![sA-Za-z])/g)?.length ?? 0;
  let declared = 0;
  for (const match of text.matchAll(/\/Count\s+(\d+)/g)) {
    declared = Math.max(declared, Number(match[1]));
  }
  const pages = Math.max(pageObjects, declared);
  return pages > 0 ? pages : undefined;
}

const bytes = (value: string | undefined): number => (value ? Buffer.byteLength(value, 'utf8') : 0);

/**
 * Upper bound on the input tokens one provider call will be billed for, or `undefined` when it
 * cannot be proven.
 *
 * Text uses UTF-8 BYTE length, which is a safe over-estimate of the token count for every script
 * (ADR 0013 §10 records that it is loose — roughly 2–4x — for Thai). Tool specs are counted: the
 * 32 KB LINE tool catalogue is the largest single block of a turn prompt. Images use the declared
 * per-image ceiling and documents the declared per-page one.
 */
export function providerInputTokenUpperBound(
  input: ProviderInput | ProviderToolsInput,
): number | undefined {
  let total = bytes(input.systemPrompt) + bytes(input.cacheableContext);
  if ('tools' in input) {
    total += bytes(JSON.stringify(input.tools));
    for (const message of input.messages) {
      if (message.role === 'tool_results') {
        for (const result of message.results) total += bytes(result.content);
        continue;
      }
      total += bytes(message.text);
      if (message.role === 'assistant' && message.toolCalls?.length) {
        total += bytes(JSON.stringify(message.toolCalls));
      }
    }
    return total;
  }
  for (const message of input.messages) total += bytes(message.text);
  total += (input.images?.length ?? 0) * AI_BUDGET_IMAGE_TOKEN_CEILING;
  for (const document of input.documents ?? []) {
    const pages = pdfPageUpperBound(document.contentBase64);
    if (pages === undefined || pages > AI_BUDGET_DOCUMENT_MAX_PAGES) return undefined;
    total += pages * AI_BUDGET_DOCUMENT_PAGE_TOKEN_CEILING;
  }
  return total;
}

/** Everything decided before the provider may run. Returns the invocation key, or the refusal. */
async function admit(
  state: Extract<BudgetRequestState, { status: 'active' }>,
  input: ProviderInput | ProviderToolsInput,
  opts: AiBudgetProviderOptions,
): Promise<{ ok: true; invocationKey: string } | { ok: false; error: ProviderError }> {
  const { envelope } = state;
  const scope: AiBudgetScope = envelope.bucket;
  const refuse = (reason: string) => {
    opts.log({ msg: 'ai.budget.gateway_refused', stepKind: envelope.stepKind, bucket: envelope.bucket, reason });
    return { ok: false as const, error: unavailable(scope, reason) };
  };

  // The hold was priced for ONE model. A different approved model is a different price, so it is
  // not money this reservation covers (spec §12.3: "Gateway ห้าม ... ใช้ approved model อื่น").
  if (opts.modelId !== envelope.modelId) return refuse('model_mismatch');
  // An absent `maxTokens` would fall back to the provider's own 2048/1024 default, which is above
  // several declared output bounds. No production call site omits it; an unprovable output ceiling
  // is refused rather than assumed.
  if (input.maxTokens === undefined || input.maxTokens > envelope.bounds.maxOutputTokens) {
    return refuse('output_bound_exceeded');
  }
  const estimate = providerInputTokenUpperBound(input);
  if (estimate === undefined) return refuse('input_bound_unprovable');
  if (estimate > envelope.bounds.maxInputTokens) return refuse('input_bound_exceeded');

  const ordinal = claimBudgetCallOrdinal();
  // The chain's declared ceiling. Asking the seam for an ordinal it would refuse anyway only adds
  // a round-trip; the API answers the same `unavailable` for `ordinal >= maxCalls`.
  if (ordinal >= envelope.maxCalls) return refuse('step_call_budget_exhausted');
  if (ordinal === 0) return { ok: true, invocationKey: envelope.invocationKey };

  if (!opts.companyId) return refuse('company_unknown');
  const step = await opts.seam.step({
    companyId: opts.companyId,
    attemptKey: envelope.attemptKey,
    stepKind: envelope.stepKind,
    ordinal,
    // The PINNED month of the parent attempt, never this process's clock (spec §12.6).
    monthKey: envelope.monthKey,
  });
  if (!step.ok) {
    opts.log({ msg: 'ai.budget.step_refused', stepKind: envelope.stepKind, ordinal, code: step.code, budgetScope: step.budgetScope });
    return { ok: false, error: aiBudgetProviderError(step.code, step.budgetScope, 'step_refused') };
  }
  return { ok: true, invocationKey: step.envelope.invocationKey };
}

/** Posts this invocation's evidence and tags the response rows with its key. Never throws. */
async function settle(
  state: Extract<BudgetRequestState, { status: 'active' }>,
  invocationKey: string,
  fromIndex: number,
  opts: AiBudgetProviderOptions,
): Promise<void> {
  const tagged = tagUsageInvocation(fromIndex, invocationKey);
  const entry = tagged[0];
  if (!entry) {
    // A provider that reported nothing measurable leaves the hold DISPATCHED -> UNRESOLVED rather
    // than settling an invented number or a zero (spec §12.6: real cost must never become 0).
    opts.log({ msg: 'ai.budget.evidence_missing', stepKind: state.envelope.stepKind, invocationKey });
    return;
  }
  try {
    await opts.seam.settle({
      invocationKey,
      sourceRoute: state.sourceRoute,
      ...(state.requestId ? { requestId: state.requestId } : {}),
      entry,
    });
  } catch {
    // Settlement is evidence, not control flow: it may never fail a completed business call.
  }
}

/**
 * Wraps one provider in the money guard.
 *
 * A `Proxy` rather than a new object literal, for two reasons that are the same reason: the
 * decorator must change the two generate methods and NOTHING else. `generateWithTools` therefore
 * stays absent when the inner provider has none — the orchestrator reads that as "not capable" and
 * falls back to its JSON loop, so an always-present method would silently change which loop runs —
 * and everything else about the provider (its configured model, its client) reads through, so a
 * caller or a spec that inspects the real provider still sees it.
 */
export function withAiBudgetEnvelope(inner: IModelProvider, opts: AiBudgetProviderOptions): IModelProvider {
  const guard = async <I extends ProviderInput | ProviderToolsInput, O>(
    input: I,
    call: (input: I) => Promise<O>,
  ): Promise<O | { ok: false; error: ProviderError }> => {
    const state = currentBudgetState();
    if (!state) return call(input);
    if (state.status === 'invalid') {
      opts.log({ msg: 'ai.budget.gateway_refused', reason: 'envelope_invalid' });
      return { ok: false, error: unavailable('TOTAL', 'envelope_invalid') };
    }
    const admission = await admit(state, input, opts);
    if (!admission.ok) return { ok: false, error: admission.error };
    // Recorded BEFORE the call so the rows this call appends — and only those — are the evidence.
    const fromIndex = usageEntryCount();
    try {
      return await call(input);
    } finally {
      // In `finally` so a throw from the provider (or from a parser inside it) still settles the
      // money it already spent, exactly as the providers log their own usage from `finally`.
      await settle(state, admission.invocationKey, fromIndex, opts);
    }
  };

  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'generateText' && typeof target.generateText === 'function') {
        return (input: ProviderInput) => guard(input, (bounded) => target.generateText(bounded));
      }
      if (prop === 'generateWithTools' && typeof target.generateWithTools === 'function') {
        return (input: ProviderToolsInput) => guard(input, (bounded) => target.generateWithTools!(bounded));
      }
      const value = Reflect.get(target, prop, receiver);
      // Bound to the real provider, so anything else stays callable with its own `this`.
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
