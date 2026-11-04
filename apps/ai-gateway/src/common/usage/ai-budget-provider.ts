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
import { createHash } from 'node:crypto';
import { calibratedIntakeTextBound } from './intake-token-calibration';
import { conservativeTimeoutUsage, pdfPageUpperBound } from '../../modules/line-ai/infrastructure/provider/provider-usage-estimate';
export { pdfPageUpperBound } from '../../modules/line-ai/infrastructure/provider/provider-usage-estimate';

import {
  AI_BUDGET_DOCUMENT_MAX_PAGES,
  AI_BUDGET_DOCUMENT_PAGE_TOKEN_CEILING,
  AI_BUDGET_IMAGE_TOKEN_CEILING,
  AI_BUDGET_ESTIMATOR_VERSION_V2,
  AI_BUDGET_PROFILES_V2,
  aiBudgetV2CallAllowed,
  parseAiBudgetEnvelopeV2,
  AI_BUDGET_REFUSAL_CODES,
  type AiBudgetEnvelopeV2,
  type AiBudgetInvocationV2,
  type AiBudgetProfileIdV2,
  type AiBudgetEnvelope,
  type AiBudgetRefusalCode,
  type AiBudgetScope,
  type AiUsageEntry,
  type ProviderError,
} from '@watchdog-bms/contracts';
import type { IModelProvider, ProviderInput, ProviderOutput, ProviderToolsInput } from '../../modules/line-ai/infrastructure/provider/provider.port';
import type { AiBudgetSeam } from './ai-budget-seam';
import { beginGuardedProviderCall, endGuardedProviderCall } from './ai-budget-durability';
import {
  appendUsage,
  claimBudgetCallOrdinal,
  claimBudgetInFlight,
  currentBudgetState,
  releaseBudgetInFlight,
  tagUsageInvocation,
  usageEntryCount,
  type BudgetRequestState,
} from './usage-context';

/** This artifact implements exact-grant, cross-hop ordinal, reservation and settlement v2.
 * Activation still requires the configured runtime, approved model/capacity and API rollout gates. */
export const AI_BUDGET_V2_SUPPORTED: boolean = true;

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

const bytes = (value: string | undefined): number => (value ? Buffer.byteLength(value, 'utf8') : 0);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function v2ProfileFor(input: ProviderInput | ProviderToolsInput): AiBudgetProfileIdV2 | undefined {
  const tag = input.usageTag ?? '';
  if (tag === 'line.intake-route') return ('images' in input && ((input.images?.length ?? 0) > 0 || (input.documents?.length ?? 0) > 0))
    ? 'line-intake-image/2' : 'line-intake-text/2';
  if (tag.startsWith('ocr.')) return 'document-qa/2';
  if (tag === 'line.document.qa') return 'document-qa/2';
  if (tag === 'line.plan-route' || tag === 'line.critic' || tag === 'line.loop') return 'line-control/2';
  if (tag === 'line.compose' || tag === 'line.casual' || tag === 'line.polish' || tag === 'line.public.general') return 'line-answer/2';
  if (tag === 'line.public.lookup') return 'public-lookup/2';
  return undefined;
}

export function v2RenderedInput(input: ProviderInput | ProviderToolsInput, modelId = ''): {
  inputTokenBound: number;
  payloadDigest: string;
  schemaDigest: string;
} {
  const messages = input.messages.map((message) => message.role === 'tool_results'
    ? { role: message.role, results: message.results.map((result) => ({ toolUseId: result.toolUseId, content: result.content, isError: result.isError })) }
    : { role: message.role, text: message.text, ...('toolCalls' in message && message.toolCalls ? { toolCalls: message.toolCalls } : {}) });
  const tools = 'tools' in input ? input.tools : undefined;
  const payload = {
    systemPrompt: input.systemPrompt ?? '', cacheableContext: input.cacheableContext ?? '', messages,
    ...(tools ? { tools } : {}),
    ...('images' in input && input.images ? { images: input.images } : {}),
    ...('documents' in input && input.documents ? { documents: input.documents } : {}),
  };
  const canonical = canonicalJson(payload);
  // Include framing, IDs, escaped JSON and the full tool schema. Counting only visible strings
  // misses substantial native tool-result input and can price less than the rendered request.
  let textBytes = bytes(canonicalJson({ systemPrompt: input.systemPrompt ?? '', cacheableContext: input.cacheableContext ?? '', messages, ...(tools ? { tools } : {}) }));
  // Constant identity excludes permission/package-dependent catalogue entries. Unknown parts
  // retain bytes; reviewed finite catalogue entries have independent cache-checkpoint evidence.
  textBytes = calibratedIntakeTextBound(input, modelId) ?? textBytes;
  if ('images' in input) textBytes += (input.images?.length ?? 0) * AI_BUDGET_IMAGE_TOKEN_CEILING;
  if ('documents' in input) {
    for (const document of input.documents ?? []) {
      const pages = pdfPageUpperBound(document.contentBase64);
      textBytes += pages === undefined ? Number.MAX_SAFE_INTEGER : pages * AI_BUDGET_DOCUMENT_PAGE_TOKEN_CEILING;
    }
  }
  // The framing allowance is part of the v2 estimator; round up before comparing to the fixed table.
  const inputTokenBound = Math.max(1024, Math.ceil((textBytes + 4096) / 1024) * 1024);
  return {
    inputTokenBound,
    payloadDigest: sha256(canonical),
    schemaDigest: sha256(canonicalJson(tools ?? [])),
  };
}

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

async function admitV2(
  state: Extract<BudgetRequestState, { status: 'active-v2' }>,
  input: ProviderInput | ProviderToolsInput,
  opts: AiBudgetProviderOptions,
): Promise<{ ok: true; invocationKey: string; envelope: AiBudgetEnvelopeV2 } | { ok: false; error: ProviderError }> {
  const refuse = (reason: string) => {
    opts.log({ msg: 'ai.budget.gateway_refused', reason });
    return { ok: false as const, error: unavailable('TOTAL', reason) };
  };
  const grant = state.grant;
  if (opts.companyId !== grant.payerCompanyId || opts.modelId !== grant.model.modelId) return refuse('v2_authority_or_model_mismatch');
  if (Date.now() >= grant.workDeadlineAtMs || Date.now() >= grant.finalDeadlineAtMs) return refuse('v2_deadline_elapsed');
  if (input.signal?.aborted || input.deadlineAt !== undefined && (!Number.isFinite(input.deadlineAt) || input.deadlineAt <= Date.now())) return refuse('v2_deadline_elapsed');
  if (input.maxTokens === undefined || !Number.isSafeInteger(input.maxTokens)) return refuse('v2_output_bound_missing');
  const profileId = v2ProfileFor(input);
  if (!profileId || !grant.allowedProfileIds.includes(profileId)) return refuse('v2_profile_not_allowed');
  const profile = AI_BUDGET_PROFILES_V2[profileId];
  if (input.maxTokens < 1 || input.maxTokens > profile.maxOutputTokens) return refuse('v2_output_bound_exceeded');
  const rendered = v2RenderedInput(input, opts.modelId);
  if (rendered.inputTokenBound > profile.maxInputTokens) return refuse('v2_input_bound_exceeded');
  const ordinal = claimBudgetCallOrdinal();
  const repair = state.repairPending === true;
  // A repair never spends an answer slot and an answer never spends the repair (aiBudgetV2CallAllowed). The
  // state's repairCount starts from the repairs earlier stages spent (aiBudgetV2RepairsBefore); the API's
  // reservation re-checks the same rule against the authority's own exact count.
  if (repair && state.repairCount >= grant.maxRepairs) return refuse('v2_repair_exhausted');
  if (!aiBudgetV2CallAllowed(grant, ordinal, repair, state.repairCount)) return refuse('v2_turn_slot_exhausted');
  if (!opts.seam.stepV2) return refuse('v2_reservation_seam_unavailable');
  const invocation: AiBudgetInvocationV2 = {
    grant,
    ordinal,
    profileId,
    inputTokenBound: rendered.inputTokenBound,
    requestedOutputTokens: input.maxTokens,
    estimatorVersion: AI_BUDGET_ESTIMATOR_VERSION_V2,
    promptVersion: 'line-ai-runtime-v2',
    payloadDigest: rendered.payloadDigest,
    schemaDigest: rendered.schemaDigest,
    inputDigest: state.inputDigest,
  };
  const step = await opts.seam.stepV2(invocation, repair);
  if (!step.ok) {
    opts.log({ msg: 'ai.budget.step_refused', profileId, ordinal, code: step.code, budgetScope: step.budgetScope });
    return { ok: false, error: aiBudgetProviderError(step.code, step.budgetScope, 'step_refused') };
  }
  const returned = parseAiBudgetEnvelopeV2(step.envelope);
  const { version: _version, reservationId: _id, invocationKey: _key, tariffVersion: _tariff, ...echo } = returned ?? {};
  if (!returned || canonicalJson(echo) !== canonicalJson(invocation)) return refuse('v2_reservation_echo_mismatch');
  if (Date.now() >= grant.workDeadlineAtMs || input.signal?.aborted || input.deadlineAt !== undefined && input.deadlineAt <= Date.now()) return refuse('v2_deadline_elapsed');
  state.repairPending = false;
  if (repair) state.repairCount += 1;
  return { ok: true, invocationKey: returned.invocationKey, envelope: returned };
}

/** A known timeout releases customer credit; retain only realistic company cost evidence. */
async function estimateTimeoutInPlace(
  entry: AiUsageEntry,
  input: ProviderInput | ProviderToolsInput,
  bounds: { maxInputTokens: number; maxOutputTokens: number },
): Promise<void> {
  entry.ok = false;
  entry.errorCode = 'PROVIDER_TIMEOUT';
  if (entry.usageBasis === 'PROVIDER_REPORTED') return;
  if (!entry.usageBasis) {
    const usage = await conservativeTimeoutUsage(input, bounds);
    entry.inputTokens = usage.inputTokens!;
    entry.outputTokens = usage.outputTokens!;
    entry.usageBasis = 'CONSERVATIVE_ESTIMATE';
  }
  entry.inputTokens = Math.min(entry.inputTokens, bounds.maxInputTokens);
  entry.outputTokens = Math.min(entry.outputTokens, bounds.maxOutputTokens);
}

/** Posts this invocation's evidence and tags the response rows with its key. Never throws. */
async function settle(
  state: Extract<BudgetRequestState, { status: 'active' }>,
  invocationKey: string,
  fromIndex: number,
  opts: AiBudgetProviderOptions,
  timedOut: ProviderInput | ProviderToolsInput | undefined,
): Promise<void> {
  const tagged = tagUsageInvocation(fromIndex, invocationKey);
  const entry = tagged[0];
  if (entry && timedOut) await estimateTimeoutInPlace(entry, timedOut, state.envelope.bounds);
  if (!entry || (entry.ok !== false && !entry.usageBasis && entry.inputTokens === 0 && entry.outputTokens === 0
    && entry.cacheReadInputTokens === 0 && entry.cacheWriteInputTokens === 0)) {
    // Missing provider counters leave the hold DISPATCHED -> UNRESOLVED rather than settling a
    // fabricated zero. The API's reconciliation path owns the unresolved dispatched reservation.
    opts.log({ msg: 'ai.budget.evidence_missing', stepKind: state.envelope.stepKind, invocationKey });
    return;
  }
  try {
    await opts.seam.settle({
      invocationKey,
      sourceRoute: state.sourceRoute,
      ...(state.requestId ? { requestId: state.requestId } : {}),
      ...(opts.companyId ? { companyId: opts.companyId } : {}),
      entry,
    });
  } catch {
    // Settlement is evidence, not control flow: it may never fail a completed business call.
  }
}

async function settleV2(
  state: Extract<BudgetRequestState, { status: 'active-v2' }>,
  envelope: AiBudgetEnvelopeV2,
  fromIndex: number,
  opts: AiBudgetProviderOptions,
  timedOut: ProviderInput | ProviderToolsInput | undefined,
): Promise<void> {
  const tagged = tagUsageInvocation(fromIndex, envelope.invocationKey);
  const entry = tagged[0];
  if (entry && timedOut) await estimateTimeoutInPlace(entry, timedOut, { maxInputTokens: envelope.inputTokenBound, maxOutputTokens: envelope.requestedOutputTokens });
  if (!entry || (entry.ok !== false && !entry.usageBasis && entry.inputTokens === 0 && entry.outputTokens === 0
    && entry.cacheReadInputTokens === 0 && entry.cacheWriteInputTokens === 0)) {
    opts.log({ msg: 'ai.budget.evidence_missing', invocationKey: envelope.invocationKey });
    return;
  }
  try {
    await opts.seam.settle({
      invocationKey: envelope.invocationKey,
      sourceRoute: state.sourceRoute,
      ...(state.requestId ? { requestId: state.requestId } : {}),
      ...(opts.companyId ? { companyId: opts.companyId } : {}),
      entry,
      ...(envelope.profileId === 'public-lookup/2' ? { externalUnits: entry.externalUnits ?? null } : {}),
      deadlineAt: state.grant.workDeadlineAtMs,
    });
  } catch {
    // Evidence settlement never changes the business response.
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
    // Evidence is attributed POSITIONALLY (`fromIndex` below), which is sound only while the
    // provider calls of one request are sequential — true today, since the single `Promise.all` in
    // this gateway runs ERP tool calls. An overlap would let this call tag and settle the other
    // call's row, so it is refused rather than mis-attributed. Cheap, and it fails loudly.
    if (!claimBudgetInFlight()) {
      opts.log({ msg: 'ai.budget.gateway_refused', reason: 'concurrent_provider_call' });
      return { ok: false, error: unavailable('TOTAL', 'concurrent_provider_call') };
    }
    try {
      const admission = state.status === 'active'
        ? await admit(state, input, opts)
        : await admitV2(state, input, opts);
      if (!admission.ok) return { ok: false, error: admission.error };
      // Recorded BEFORE the call so the rows this call appends — and only those — are the evidence.
      const fromIndex = usageEntryCount();
      let timedOut: ProviderInput | ProviderToolsInput | undefined;
      let failure: ProviderError | undefined;
      let outputUnusable = false;
      let providerThrew = false;
      // Process-wide gauge, so a SIGTERM waits for this call and its settlement instead of killing
      // them (hold spec §3). Only under an envelope: a SHARED request never reaches this line.
      beginGuardedProviderCall();
      try {
        const bounded = state.status === 'active-v2'
          ? { ...input, deadlineAt: Math.min(input.deadlineAt ?? Infinity, state.grant.workDeadlineAtMs,
              (admission as { envelope?: AiBudgetEnvelopeV2 }).envelope?.profileId === 'document-qa/2' ? Date.now() + 45_000 : Infinity) }
          : input;
        // The callback stays in this process, outside adapter payload construction.
        const { acceptOutput: _acceptOutput, ...providerInput } = bounded;
        const output = await call(providerInput as I);
        if (state.status === 'active-v2' && (Date.now() >= bounded.deadlineAt! || input.signal?.aborted)) {
          timedOut = input;
          failure = { code: 'PROVIDER_TIMEOUT', message: 'Admitted work deadline elapsed.', retryable: false };
          // Usage already appended by the provider still settles below. Late text/tool arguments
          // are not authorization to execute effects or publish an ordinary completed answer.
          return { ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'Admitted work deadline elapsed.', retryable: false } };
        }
        if ((output as { ok?: unknown }).ok === false) failure = (output as { error?: ProviderError }).error;
        if (failure?.code === 'PROVIDER_TIMEOUT') {
          timedOut = input;
        }
        if (state.status === 'active-v2' && ((output as { ok?: unknown; completion?: string }).completion === 'output_limit'
          || ((output as { ok?: unknown; error?: ProviderError }).ok === false
            && ['PROVIDER_OUTPUT_INCOMPLETE', 'PROVIDER_TOOL_ARGUMENT_INVALID'].includes(String((output as { error?: ProviderError }).error?.code))))) {
          state.repairPending = true;
        }
        if (state.status === 'active-v2' && (output as { ok?: boolean }).ok === true) {
          const result = output as Extract<ProviderOutput, { ok: true }>;
          outputUnusable = result.completion === 'output_limit' || result.completion === 'blocked' || result.stopReason === 'max_tokens';
          if (!outputUnusable && input.acceptOutput) {
            try { outputUnusable = !input.acceptOutput(result); } catch { outputUnusable = true; }
          }
        }
        return output;
      } catch (error) {
        providerThrew = true;
        failure = { code: 'PROVIDER_UNKNOWN', message: 'Provider call failed.', retryable: false };
        throw error;
      } finally {
        if (state.status === 'active-v2' && (failure || outputUnusable)) {
          for (const entry of tagUsageInvocation(fromIndex, admission.invocationKey)) {
            entry.ok = false;
            entry.errorCode = outputUnusable ? 'OUTPUT_UNUSABLE' : failure!.code;
          }
        }
        // A known refusal/timeout before the adapter logged counters still releases its hold.
        // A thrown/lost transport with no result retains the existing unresolved path.
        if (failure && !providerThrew && usageEntryCount() === fromIndex) appendUsage({
          tag: input.usageTag ?? 'untagged', modelId: opts.modelId, ok: false, errorCode: failure.code,
          inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, durationMs: 0,
        });
        // In `finally` so a throw from the provider (or from a parser inside it) still settles the
        // money it already spent, exactly as the providers log their own usage from `finally`.
        if (state.status === 'active') {
          await settle(state, admission.invocationKey, fromIndex, opts, timedOut);
        } else if ('envelope' in admission) {
          await settleV2(state, admission.envelope as AiBudgetEnvelopeV2, fromIndex, opts, timedOut);
        }
        endGuardedProviderCall();
      }
    } finally {
      releaseBudgetInFlight();
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
