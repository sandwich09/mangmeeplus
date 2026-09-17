/** Durable, request-level record of every model processor that handled the payload. */
export type AiModelLineage = {
  provider: string;
  modelId: string;
  region: string;
  purpose: string;
};

/** Server-issued tenant policy. The gateway must not accept a caller-selected model. */
export type AiModelPolicy = {
  modelId: string;
};

/** One model call as the gateway measured it, reported additively on every internal AI response
 *  so the API can meter per-company spend (metering spec §7.1). Failed calls keep provider usage
 *  when available; an aborted Bedrock timeout uses conservative ceiling counts instead of zero.
 *  `tag` is the call site's usageTag, 'untagged' when it passed none. */
export type AiUsageEntry = {
  tag: string;
  modelId: string;
  ok: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  durationMs: number;
  /**
   * How the counters above were obtained (remediation spec §11.2, F-11). Absent from an older
   * gateway and from any provider that cannot tell — the API then stores NULL and the console
   * reports UNKNOWN. A conservative timeout ceiling must never be displayed as measured tokens.
   */
  usageBasis?: AiUsageBasis;
  /**
   * The budget invocation this call was held against (ADR 0013 §6/§7), set by the gateway only
   * under a `budgetEnvelope`. It makes the response path an IDEMPOTENT duplicate of the evidence
   * the gateway already posted to `POST /internal/ai/budget-settle`: the API settles each tagged
   * entry by its own key and the unique fence turns the second arrival into a no-op. Absent from
   * an older gateway and from every SHARED company, where the normal metering path applies.
   */
  invocationKey?: string;
};

export type AiUsageBasis = 'PROVIDER_REPORTED' | 'CONSERVATIVE_ESTIMATE';
