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
};
