import type { TokenUsage } from '@aws-sdk/client-bedrock-runtime';
import type { ProviderError } from '@watchdog-bms/contracts';
import type { IModelProvider, ProviderInput, ProviderOutput, ProviderToolsInput, ProviderToolsOutput } from './provider.port';
import {
  type BedrockProviderConfig, CACHE_MIN_CHARS, THROTTLE_MAX_RETRIES, ProviderResponseError,
  cacheableContextIndex, cacheableContextParts, defaultThrottleSleep, jitteredThrottleBackoffMs, logProviderUsage, toolLoopCachePlan,
} from './bedrock.provider';
import { conservativeTimeoutUsage } from './provider-usage-estimate';
import { validateProviderStructuredText, validateProviderToolCalls } from './provider-output.logic';

type AnthropicApiProviderConfig = Pick<BedrockProviderConfig, 'modelId' | 'timeoutMs' | 'maxAttempts' | 'sleep'> & { apiKey: string };
type ApiBlock = { type: string; text?: string; id?: string; name?: string; input?: unknown };
type ApiResponse = {
  content?: ApiBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
};
type ApiMessage = { role: 'user' | 'assistant'; content: Record<string, unknown>[] };
type ApiRequest = { messages: ApiMessage[]; max_tokens: number; system?: Record<string, unknown>[]; tools?: Record<string, unknown>[]; thinking?: { type: 'disabled' }; output_config?: Record<string, unknown> };

/** Only the wire ID changes; approval, pricing, and usage retain the original Bedrock ID. */
export function anthropicModelId(modelId: string): string {
  return modelId.replace(/^(global|apac|us|eu|jp|au)\./, '').replace(/^anthropic\./, '').replace(/-v\d+:\d+$/, '');
}

function cachedText(text?: string): Record<string, unknown>[] {
  return text ? [{ type: 'text', text, ...(text.length >= CACHE_MIN_CHARS ? { cache_control: { type: 'ephemeral' } } : {}) }] : [];
}

function contextBlocks(input: ProviderInput | ProviderToolsInput): Record<string, unknown>[] {
  return cacheableContextParts(input).map(({ text, cache }) => ({ type: 'text', text, ...(cache ? { cache_control: { type: 'ephemeral' } } : {}) }));
}

function precheck(input: { signal?: AbortSignal; deadlineAt?: number }): ProviderError | undefined {
  if (input.signal?.aborted || (input.deadlineAt !== undefined && input.deadlineAt <= Date.now())) {
    return { code: 'PROVIDER_TIMEOUT', message: 'Provider work deadline elapsed before dispatch.', retryable: false };
  }
  return undefined;
}

class ApiHttpError extends Error {
  constructor(readonly status: number) { super(`Anthropic API returned HTTP ${status}.`); }
}

/** Local eval transport. The factory's config boundary refuses its key outside APP_ENV=local. */
export class AnthropicApiProvider implements IModelProvider {
  constructor(private readonly cfg: AnthropicApiProviderConfig) {}

  async generateText(input: ProviderInput): Promise<ProviderOutput> {
    const error = precheck(input);
    if (error) return { ok: false, error };
    const contextIndex = cacheableContextIndex(input.messages);
    const lastUserIndex = input.messages.map((m) => m.role).lastIndexOf('user');
    const attachments = [
      ...(input.images ?? []).map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.contentBase64 } })),
      ...(input.documents ?? []).map((doc) => ({ type: 'document', source: { type: 'base64', media_type: doc.mimeType, data: doc.contentBase64 } })),
    ];
    return this.messages({
      messages: input.messages.map((m, index) => ({ role: m.role, content: [
        ...(index === contextIndex ? contextBlocks(input) : []),
        { type: 'text', text: m.text },
        ...(index === lastUserIndex ? attachments : []),
      ] })),
      ...(input.systemPrompt ? { system: cachedText(input.systemPrompt) } : {}),
      max_tokens: input.maxTokens ?? 2048,
      // Messages API structured outputs, the same schema the Bedrock provider sends as Converse outputConfig.
      ...(input.outputSchema ? { output_config: { format: { type: 'json_schema', schema: input.outputSchema.schema } } } : {}),
    }, input, (response) => {
      const blocks = this.responseBlocks(response, ['end_turn', 'max_tokens']);
      const text = blocks.flatMap((b) => b.type === 'text' && typeof b.text === 'string' && b.text ? [b.text] : []).join('\n');
      if (!text.trim()) throw new ProviderResponseError('PROVIDER_OUTPUT_INCOMPLETE');
      if (input.outputSchema && (response.stop_reason !== 'end_turn' || !validateProviderStructuredText(text, input.outputSchema.schema)))
        throw new ProviderResponseError('PROVIDER_OUTPUT_INCOMPLETE');
      return { text, ...(input.outputSchema ? { schemaEnforcement: 'output_config' as const } : {}), completion: response.stop_reason === 'end_turn' ? 'complete' as const : 'output_limit' as const,
        providerStopReason: response.stop_reason, stopReason: response.stop_reason === 'end_turn' ? 'end_turn' as const : 'max_tokens' as const };
    });
  }

  async generateWithTools(input: ProviderToolsInput): Promise<ProviderToolsOutput> {
    const error = precheck(input);
    if (error) return { ok: false, error };
    const contextIndex = cacheableContextIndex(input.messages);
    const cache = toolLoopCachePlan(input);
    const body: ApiRequest = {
      messages: input.messages.map((m, index): ApiMessage => {
        const lead = index === contextIndex ? contextBlocks(input) : [];
        if (m.role === 'tool_results') return { role: 'user', content: [...lead, ...m.results.map((r) => ({
          type: 'tool_result', tool_use_id: r.toolUseId, content: r.content, ...(r.isError ? { is_error: true } : {}),
        }))] };
        if (m.role === 'assistant') return { role: 'assistant', content: [
          ...lead, ...(m.text ? [{ type: 'text', text: m.text }] : []),
          ...(m.toolCalls ?? []).map((c) => ({ type: 'tool_use', id: c.toolUseId, name: c.name, input: c.input })),
        ] };
        return { role: 'user', content: [...lead, { type: 'text', text: m.text }] };
      }),
      tools: input.tools.map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}), input_schema: t.inputSchema, ...(t.strict ? { strict: true } : {}) })),
      ...(input.systemPrompt ? { system: cachedText(input.systemPrompt) } : {}),
      max_tokens: input.maxTokens ?? 1024,
    };
    if (cache.tools) body.tools!.at(-1)!.cache_control = { type: 'ephemeral' };
    for (const index of cache.messages) {
      const block = body.messages[index]!.content.at(-1);
      if (block) block.cache_control = { type: 'ephemeral' };
    }
    return this.messages(body, input, (response) => {
      const blocks = this.responseBlocks(response, ['tool_use', 'end_turn', 'max_tokens']);
      const text = blocks.flatMap((b) => b.type === 'text' && typeof b.text === 'string' && b.text ? [b.text] : []).join('\n');
      if (response.stop_reason === 'max_tokens') return {
        text, toolCalls: [], completion: 'output_limit' as const, providerStopReason: response.stop_reason, stopReason: 'max_tokens' as const,
      };
      const toolCalls = blocks.flatMap((b) => b.type === 'tool_use' ? [{ toolUseId: b.id ?? '', name: b.name ?? '', input: b.input }] : []);
      if (response.stop_reason === 'end_turn' && !text.trim() && toolCalls.length === 0) throw new ProviderResponseError('PROVIDER_OUTPUT_INCOMPLETE');
      if (response.stop_reason === 'tool_use' && toolCalls.length === 0) throw new ProviderResponseError('PROVIDER_TOOL_ARGUMENT_INVALID');
      if (toolCalls.some((c) => !c.toolUseId || !c.name || c.input === undefined)
        || !validateProviderToolCalls(toolCalls, input.tools)) throw new ProviderResponseError('PROVIDER_TOOL_ARGUMENT_INVALID');
      return { text, toolCalls, completion: 'complete' as const, providerStopReason: response.stop_reason,
        ...(toolCalls.length && toolCalls.every((c) => input.tools.find((t) => t.name === c.name)?.strict === true) ? { schemaEnforcement: 'strict_tool' as const } : {}),
        stopReason: response.stop_reason === 'tool_use' ? 'tool_use' as const : 'end_turn' as const };
    });
  }

  private responseBlocks(response: ApiResponse, allowedStops: string[]): ApiBlock[] {
    if (response?.stop_reason === 'refusal') throw new ProviderResponseError('PROVIDER_BLOCKED');
    if (!allowedStops.includes(String(response?.stop_reason)) || !Array.isArray(response?.content)
      || response.content.some((b) => !b || typeof b !== 'object')) throw new ProviderResponseError('PROVIDER_OUTPUT_INCOMPLETE');
    return response.content;
  }

  private async messages<T extends object>(
    body: ApiRequest,
    input: ProviderInput | ProviderToolsInput,
    parse: (response: ApiResponse) => T,
  ): Promise<({ ok: true } & T) | { ok: false; error: ProviderError }> {
    const error = precheck(input);
    if (error) return { ok: false, error };
    if (anthropicModelId(this.cfg.modelId) === 'claude-haiku-5-5') {
      body.thinking = { type: 'disabled' };
      body.output_config = { ...body.output_config, effort: 'low' };
    }
    const startedAt = Date.now();
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const remaining = Math.min(this.cfg.timeoutMs, (input.deadlineAt ?? Infinity) - Date.now());
    const timeout = setTimeout(() => controller.abort(), Math.max(0, remaining));
    const deadlineAt = startedAt + remaining;
    let usage: TokenUsage | undefined;
    let usageEstimated = false;
    let errorCode: string | undefined;
    let retryCount = 0;
    try {
      for (;;) {
        try {
          if (controller.signal.aborted || Date.now() >= deadlineAt) throw new DOMException('Aborted', 'AbortError');
          // fetch has no implicit retries; maxAttempts cannot introduce hidden, billable attempts.
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST', signal: controller.signal,
            headers: { 'x-api-key': this.cfg.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model: anthropicModelId(this.cfg.modelId), ...body }),
          });
          if (!response.ok) throw new ApiHttpError(response.status);
          let data: ApiResponse;
          try { data = await response.json() as ApiResponse; }
          catch (err) {
            if (controller.signal.aborted || ['AbortError', 'TimeoutError'].includes((err as Error)?.name)) throw err;
            throw new ProviderResponseError('PROVIDER_OUTPUT_INCOMPLETE');
          }
          if (data?.usage) usage = {
            inputTokens: data.usage.input_tokens ?? 0, outputTokens: data.usage.output_tokens ?? 0,
            totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
            cacheReadInputTokens: data.usage.cache_read_input_tokens ?? 0, cacheWriteInputTokens: data.usage.cache_creation_input_tokens ?? 0,
          };
          const parsed = parse(data);
          if ('completion' in parsed && parsed.completion === 'output_limit') errorCode = 'PROVIDER_OUTPUT_INCOMPLETE';
          return { ok: true, ...parsed };
        } catch (err) {
          const timedOut = controller.signal.aborted || ['AbortError', 'TimeoutError'].includes((err as Error)?.name);
          const throttled = err instanceof ApiHttpError && [429, 529].includes(err.status);
          if (!timedOut && throttled && retryCount < THROTTLE_MAX_RETRIES) {
            const backoffMs = jitteredThrottleBackoffMs();
            if (Date.now() + backoffMs < deadlineAt) {
              retryCount += 1;
              await (this.cfg.sleep ?? defaultThrottleSleep)(backoffMs);
              continue;
            }
          }
          const error: ProviderError = timedOut
            ? { code: 'PROVIDER_TIMEOUT', message: 'Anthropic API request timed out.', retryable: true }
            : err instanceof ProviderResponseError
              ? { code: err.code, message: 'The provider response was incomplete or invalid.', retryable: false }
              : throttled
                ? { code: 'PROVIDER_THROTTLED', message: 'Anthropic API throttled the request.', retryable: true }
                : { code: 'PROVIDER_UNKNOWN', message: err instanceof ApiHttpError ? err.message : 'Anthropic API request failed.', retryable: false };
          if (timedOut) {
            usage = await conservativeTimeoutUsage(input, undefined, this.cfg.modelId);
            usageEstimated = true;
          }
          errorCode = error.code;
          return { ok: false, error };
        }
      }
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', abortFromCaller);
      logProviderUsage(this.cfg.modelId, input.usageTag, startedAt, usage, errorCode, usageEstimated, retryCount);
    }
  }
}
