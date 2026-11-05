import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ContentBlock, ConverseCommandOutput, Message, SystemContentBlock, TokenUsage, ToolUseBlock } from '@aws-sdk/client-bedrock-runtime';
import type { IModelProvider, ProviderInput, ProviderOutput, ProviderToolCall, ProviderToolsInput, ProviderToolsOutput } from './provider.port';
import type { AiUsageEntry, ProviderError } from '@watchdog-bms/contracts';
import { appendUsage, currentUsageCompanyId } from '../../../../common/usage/usage-context';
import { conservativeTimeoutUsage } from './provider-usage-estimate';
import { validateProviderToolCalls } from './provider-output.logic';

export type BedrockProviderConfig = {
  region: string;
  modelId: string;
  timeoutMs: number;
  /** SDK attempts for one invocation. Set only under a SPLIT budget envelope, where the hold
   *  prices exactly one attempt (ADR 0013 §6); absent keeps the SDK's own default. */
  maxAttempts?: number;
  /** Item 5 test hook: replaces the real throttle-retry wait so specs never actually sleep.
   *  Defaults to a real, unref'd timer. */
  sleep?: (ms: number) => Promise<void>;
};

/** Item 5 (223-turn eval, 14 `PROVIDER_THROTTLED` turns): Bedrock throttles under real sustained
 *  sequential load. A small bounded retry absorbs a transient throttle instead of surfacing a
 *  failure the customer cannot act on — capped low enough it can never itself become the slow path,
 *  and only spent while there is genuinely time left before this call's own deadline. */
export const THROTTLE_MAX_RETRIES = 2;
const THROTTLE_BACKOFF_MIN_MS = 400;
const THROTTLE_BACKOFF_MAX_MS = 1200;

export function jitteredThrottleBackoffMs(): number {
  return THROTTLE_BACKOFF_MIN_MS + Math.random() * (THROTTLE_BACKOFF_MAX_MS - THROTTLE_BACKOFF_MIN_MS);
}

export function defaultThrottleSleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });
}

/** Minimum covered text before a cache checkpoint is worth emitting. Claude Sonnet 4.x will not
 *  cache a prefix under 1,024 tokens — it ignores the checkpoint entirely (no cache write, so no
 *  extra billing), which just leaves a dead checkpoint in the request. At the ~3.14 chars/token
 *  measured on these prompts, 4,000 chars ≈ 1,270 tokens clears the floor with margin. Exported so
 *  tests assert against the real boundary instead of a copied number. */
export const CACHE_MIN_CHARS = 4000;
const CACHE_POINT = { cachePoint: { type: 'default' as const } };

export class ProviderResponseError extends Error {
  constructor(readonly code: 'PROVIDER_OUTPUT_INCOMPLETE' | 'PROVIDER_BLOCKED' | 'PROVIDER_TOOL_ARGUMENT_INVALID') { super(code); }
}

export class BedrockProvider implements IModelProvider {
  private readonly client: BedrockRuntimeClient;

  constructor(private readonly cfg: BedrockProviderConfig) {
    this.client = new BedrockRuntimeClient({
      region: cfg.region,
      ...(cfg.maxAttempts ? { maxAttempts: cfg.maxAttempts } : {}),
    });
  }

  async generateText(input: ProviderInput): Promise<ProviderOutput> {
    if (input.signal?.aborted || (input.deadlineAt !== undefined && input.deadlineAt <= Date.now())) {
      return { ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'Provider work deadline elapsed before dispatch.', retryable: false } };
    }
    // Converse image blocks ride on the last user message (vision routing/OCR).
    const imageBlocks = (input.images ?? []).map((image) => ({
      image: {
        format: (image.mimeType === 'image/png' ? 'png' : 'jpeg') as 'png' | 'jpeg',
        source: { bytes: Buffer.from(image.contentBase64, 'base64') },
      },
    }));
    // Converse rejects document names outside [a-zA-Z0-9()[\]\s-] and requires them unique,
    // so the name is generated here rather than taken from the caller's filename.
    const documentBlocks = (input.documents ?? []).map((doc, index) => ({
      document: {
        format: 'pdf' as const,
        name: `document ${index + 1}`,
        source: { bytes: Buffer.from(doc.contentBase64, 'base64') },
      },
    }));
    const attachmentBlocks = [...imageBlocks, ...documentBlocks];
    const lastUserIndex = input.messages.map((m) => m.role).lastIndexOf('user');
    const contextIndex = cacheableContextIndex(input.messages);
    const contextBlocks = cacheableContextBlocks(input);
    const command = new ConverseCommand({
      modelId: this.cfg.modelId,
      messages: input.messages.map((m, index) => ({
        role: m.role,
        content: [
          ...(index === contextIndex ? contextBlocks : []),
          { text: m.text },
          ...(index === lastUserIndex ? attachmentBlocks : []),
        ],
      })),
      ...systemBlocks(input.systemPrompt),
      inferenceConfig: { maxTokens: input.maxTokens ?? 2048 },
    });

    return this.converse(command, input.usageTag, (response) => {
      const blocks = response.output?.message?.content;
      if (!Array.isArray(blocks)) throw new ProviderResponseError('PROVIDER_OUTPUT_INCOMPLETE');
      if (response.stopReason === 'guardrail_intervened') throw new ProviderResponseError('PROVIDER_BLOCKED');
      if (response.stopReason !== 'end_turn' && response.stopReason !== 'max_tokens') throw new ProviderResponseError('PROVIDER_OUTPUT_INCOMPLETE');
      const text = blocks.flatMap((block) => typeof block.text === 'string' && block.text ? [block.text] : []).join('\n');
      if (!text.trim()) throw new ProviderResponseError('PROVIDER_OUTPUT_INCOMPLETE');
      return {
        text,
        completion: response.stopReason === 'end_turn' ? 'complete' as const : 'output_limit' as const,
        providerStopReason: response.stopReason,
        stopReason: response.stopReason === 'end_turn' ? 'end_turn' as const : 'max_tokens' as const,
      };
    }, input);
  }

  /** Item 10F native tool loop – Converse `toolConfig`/`toolUse`/`toolResult`. Verified live
   *  on the pinned Claude model (parallel toolUse blocks in one turn) 2026-07-07. */
  async generateWithTools(input: ProviderToolsInput): Promise<ProviderToolsOutput> {
    if (input.signal?.aborted || (input.deadlineAt !== undefined && input.deadlineAt <= Date.now())) {
      return { ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'Provider work deadline elapsed before dispatch.', retryable: false } };
    }
    const contextIndex = cacheableContextIndex(input.messages);
    const contextBlocks = cacheableContextBlocks(input);
    const cache = toolLoopCachePlan(input);
    const command = new ConverseCommand({
      modelId: this.cfg.modelId,
      messages: input.messages.map((m, index): Message => {
        // Leading blocks are applied by index, not by branch, so the context is never dropped.
        const lead = index === contextIndex ? contextBlocks : [];
        if (m.role === 'tool_results') {
          return {
            role: 'user',
            content: [...lead, ...m.results.map((r): ContentBlock => ({
              toolResult: {
                toolUseId: r.toolUseId,
                content: [{ text: r.content }],
                ...(r.isError ? { status: 'error' as const } : {}),
              },
            }))],
          };
        }
        if (m.role === 'assistant') {
          const content: ContentBlock[] = [...lead];
          if (m.text) content.push({ text: m.text });
          for (const c of m.toolCalls ?? []) {
            content.push({ toolUse: { toolUseId: c.toolUseId, name: c.name, input: c.input as ToolUseBlock['input'] } });
          }
          return { role: 'assistant', content };
        }
        return { role: 'user', content: [...lead, { text: m.text }] };
      }),
      toolConfig: {
        tools: [...input.tools.map((t) => ({
          toolSpec: {
            name: t.name,
            ...(t.description ? { description: t.description } : {}),
            inputSchema: { json: t.inputSchema as never },
          },
        })), ...(cache.tools ? [CACHE_POINT] : [])],
      },
      ...systemBlocks(input.systemPrompt),
      inferenceConfig: { maxTokens: input.maxTokens ?? 1024 },
    });
    for (const index of cache.messages) command.input.messages![index]!.content!.push(CACHE_POINT);

    return this.converse(command, input.usageTag, (response) => {
      const blocks = response.output?.message?.content ?? [];
      if (!Array.isArray(blocks)) throw new ProviderResponseError('PROVIDER_OUTPUT_INCOMPLETE');
      if (response.stopReason === 'guardrail_intervened') throw new ProviderResponseError('PROVIDER_BLOCKED');
      if (!['tool_use', 'end_turn', 'max_tokens'].includes(String(response.stopReason))) throw new ProviderResponseError('PROVIDER_OUTPUT_INCOMPLETE');
      const text = blocks.flatMap((block) => typeof block.text === 'string' && block.text ? [block.text] : []).join('\n');
      if (response.stopReason === 'max_tokens') return {
        text, toolCalls: [], completion: 'output_limit' as const, providerStopReason: response.stopReason,
        stopReason: 'max_tokens' as const,
      };
      const toolUses = blocks.flatMap((block) => block.toolUse ? [{
        toolUseId: block.toolUse.toolUseId ?? '', name: block.toolUse.name ?? '', input: block.toolUse.input,
      }] : []);
      if (response.stopReason === 'end_turn' && !text.trim() && toolUses.length === 0) throw new ProviderResponseError('PROVIDER_OUTPUT_INCOMPLETE');
      if (response.stopReason === 'tool_use' && toolUses.length === 0) throw new ProviderResponseError('PROVIDER_TOOL_ARGUMENT_INVALID');
      if (toolUses.some((call) => !call.toolUseId || !call.name || call.input === undefined)
        || !validateProviderToolCalls(toolUses, input.tools)) throw new ProviderResponseError('PROVIDER_TOOL_ARGUMENT_INVALID');
      return { text, toolCalls: toolUses, completion: 'complete' as const, providerStopReason: response.stopReason,
        stopReason: response.stopReason === 'tool_use' ? 'tool_use' as const : 'end_turn' as const };
    }, input);
  }

  /** One Converse round-trip: abortable timeout, response parsing, and exactly one `ai.usage` line
   *  (spec §4.3). `parse` runs INSIDE the error boundary so a malformed response becomes a mapped
   *  ProviderError (the orchestrator's fallback signal) instead of escaping as a throw. */
  private async converse<T extends object>(
    command: ConverseCommand,
    usageTag: string | undefined,
    parse: (response: ConverseCommandOutput) => T,
    context: ProviderInput | ProviderToolsInput,
  ): Promise<({ ok: true } & T) | { ok: false; error: ProviderError }> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(context?.signal?.reason);
    if (context?.signal?.aborted) controller.abort(context.signal.reason);
    else context?.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const remaining = context?.deadlineAt === undefined ? this.cfg.timeoutMs : context.deadlineAt - Date.now();
    if (remaining <= 0 || context?.signal?.aborted) {
      context?.signal?.removeEventListener('abort', abortFromCaller);
      return { ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'Provider work deadline elapsed before dispatch.', retryable: false } };
    }
    const timeout = setTimeout(() => controller.abort(), Math.max(0, Math.min(this.cfg.timeoutMs, remaining)));

    let usage: TokenUsage | undefined;
    let usageEstimated = false;
    let errorCode: string | undefined;
    let providerFailure: { providerErrorClass?: string; providerStatus?: number } | undefined;
    let retryCount = 0;
    try {
      // The retry lives INSIDE this one guarded call rather than at a call site: a throttled attempt
      // bills nothing (Bedrock rejects it before doing any work), so looping here never spends an
      // extra turn slot from the caller's budget grant, and `logUsage` below still runs exactly once
      // for the whole invocation — the one entry the budget decorator's positional settlement expects.
      for (;;) {
        try {
          const response = await this.client.send(command, { abortSignal: controller.signal });
          usage = response.usage;
          const parsed = parse(response);
          if ('completion' in parsed && parsed.completion === 'output_limit') errorCode = 'PROVIDER_OUTPUT_INCOMPLETE';
          return { ok: true, ...parsed };
        } catch (err) {
          const failure = err as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
          providerFailure = { ...(typeof failure?.name === 'string' ? { providerErrorClass: failure.name } : {}),
            ...(typeof failure?.$metadata?.httpStatusCode === 'number' ? { providerStatus: failure.$metadata.httpStatusCode } : {}) };
          const timedOut = controller.signal.aborted;
          const providerCode = (err as { code?: unknown })?.code;
          const isProviderResponseError = providerCode === 'PROVIDER_OUTPUT_INCOMPLETE' || providerCode === 'PROVIDER_BLOCKED'
            || providerCode === 'PROVIDER_TOOL_ARGUMENT_INVALID';
          if (!isProviderResponseError && !timedOut && (err as { name?: unknown })?.name === 'ThrottlingException'
            && retryCount < THROTTLE_MAX_RETRIES) {
            const backoffMs = jitteredThrottleBackoffMs();
            // Never retry past this call's own deadline — a retry that could not finish before the
            // turn's work deadline is strictly worse than failing now and letting the caller decide.
            if (context?.deadlineAt === undefined || Date.now() + backoffMs < context.deadlineAt) {
              retryCount += 1;
              await (this.cfg.sleep ?? defaultThrottleSleep)(backoffMs);
              continue;
            }
          }
          const error = isProviderResponseError
            ? { code: providerCode, message: 'The provider response was incomplete or invalid.', retryable: false } as ProviderError
            : this.mapError(timedOut ? { name: 'ProviderTimeout' } : err);
          if (timedOut) {
            usage = await conservativeTimeoutUsage(context);
            usageEstimated = true;
          }
          errorCode = error.code;
          return { ok: false, error };
        }
      }
    } finally {
      clearTimeout(timeout);
      context?.signal?.removeEventListener('abort', abortFromCaller);
      // Logged here so exactly one line is emitted whatever throws, and so logging can never
      // double-log or turn a success into an error.
      logProviderUsage(this.cfg.modelId, usageTag, startedAt, usage, errorCode, usageEstimated, retryCount, errorCode ? providerFailure : undefined);
    }
  }

  private mapError(err: unknown): ProviderError {
    const name = (err as Record<string, unknown>)?.['name'] as string ?? '';
    const message = (err as Record<string, unknown>)?.['message'] as string ?? 'Unknown error';

    if (name === 'ProviderTimeout') {
      return { code: 'PROVIDER_TIMEOUT', message: 'Bedrock request timed out.', retryable: true };
    }
    if (name === 'ThrottlingException') {
      return { code: 'PROVIDER_THROTTLED', message, retryable: true };
    }
    if (name === 'AccessDeniedException') {
      return { code: 'PROVIDER_ACCESS_NOT_READY', message, retryable: false };
    }
    if (name === 'ValidationException') {
      const lower = message.toLowerCase();
      if (lower.includes('use case') || lower.includes('on-demand throughput') || lower.includes('inference profile')) {
        return { code: 'PROVIDER_ACCESS_NOT_READY', message, retryable: false };
      }
    }
    return { code: 'PROVIDER_UNKNOWN', message, retryable: false };
  }
}

/** Keep the previous input's endpoint as well as this input's endpoint: a tool follow-up can
 *  read the exact prefix written by its predecessor. System checkpoints already cover tools.
 *  Reserve system/tool/context slots before choosing up to two message points (Bedrock limit 4). */
export function toolLoopCachePlan(input: ProviderToolsInput): { tools: boolean; messages: number[] } {
  const toolChars = input.tools.length ? JSON.stringify(input.tools).length : 0;
  const tools = toolChars >= CACHE_MIN_CHARS && (input.systemPrompt?.length ?? 0) < CACHE_MIN_CHARS;
  let coveredChars = toolChars + (input.systemPrompt?.length ?? 0);
  const contextIndex = cacheableContextIndex(input.messages);
  const eligible: number[] = [];
  input.messages.forEach((message, index) => {
    if (index === contextIndex) coveredChars += input.cacheableContext?.length ?? 0;
    coveredChars += message.role === 'tool_results' ? JSON.stringify(message.results).length
      : (message.text?.length ?? 0) + (message.role === 'assistant' && message.toolCalls ? JSON.stringify(message.toolCalls).length : 0);
    if (message.role !== 'assistant' && coveredChars >= CACHE_MIN_CHARS) eligible.push(index);
  });
  const remaining = 4 - Number(tools) - Number((input.systemPrompt?.length ?? 0) >= CACHE_MIN_CHARS)
    - cacheableContextParts(input).filter(part => part.cache).length;
  return { tools, messages: remaining > 0 ? eligible.slice(-Math.min(2, remaining)) : [] };
}

/** Tools and system precede messages in the cached prefix, so one system checkpoint covers
 *  toolConfig + system for `generateWithTools`. A sub-threshold system prompt gets no checkpoint of
 *  its own, but a later `cacheableContext` checkpoint still covers it — checkpoints cache
 *  everything before them, not just the block they follow. */
function systemBlocks(systemPrompt?: string): { system?: SystemContentBlock[] } {
  if (!systemPrompt) return {};
  return { system: systemPrompt.length >= CACHE_MIN_CHARS ? [{ text: systemPrompt }, CACHE_POINT] : [{ text: systemPrompt }] };
}

/** The context block is always rendered so model-visible content never depends on caching;
 *  only the checkpoint after it is size-gated. */
function cacheableContextBlocks(input: ProviderInput | ProviderToolsInput): ContentBlock[] {
  return cacheableContextParts(input).flatMap(({ text, cache }): ContentBlock[] => cache ? [{ text }, CACHE_POINT] : [{ text }]);
}

export function cacheableContextParts(input: ProviderInput | ProviderToolsInput): Array<{ text: string; cache: boolean }> {
  const text = input.cacheableContext;
  if (!text) return [];
  const boundary = input.cacheableContextPrefixLength;
  if (typeof boundary !== 'number' || !Number.isSafeInteger(boundary) || boundary <= 0 || boundary >= text.length) {
    return [{ text, cache: text.length >= CACHE_MIN_CHARS }];
  }
  return [
    { text: text.slice(0, boundary), cache: (input.systemPrompt?.length ?? 0) + boundary >= CACHE_MIN_CHARS },
    { text: text.slice(boundary), cache: (input.systemPrompt?.length ?? 0) + text.length >= CACHE_MIN_CHARS },
  ];
}

/** Which message carries the cacheable context: the first user turn, or the first message when
 *  there is no user turn at all — the contract is that the context is ALWAYS rendered. */
export function cacheableContextIndex(messages: ReadonlyArray<{ role: string }>): number {
  const firstUser = messages.findIndex((m) => m.role === 'user');
  return firstUser >= 0 ? firstUser : 0;
}

/** Counts and identifiers only — never prompt, message, or customer content (PDPA posture).
 *  One place, two sinks: the request-scoped collector the API meters from (metering §7.2) and
 *  the stdout line CloudWatch reconciles against. Swallows its own failures: losing either must
 *  never fail a business call. Errors keep real response usage when Bedrock supplied it; a
 *  timeout carries an internal request-size estimate because no response usage exists. */
export function logProviderUsage(
  modelId: string,
  tag: string | undefined,
  startedAt: number,
  usage?: TokenUsage,
  errorCode?: string,
  usageEstimated = false,
  retryCount = 0,
  providerFailure?: { providerErrorClass?: string; providerStatus?: number },
): void {
  const entry: AiUsageEntry = {
    tag: tag ?? 'untagged',
    modelId,
    ok: !errorCode,
    ...(errorCode ? { errorCode } : {}),
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadInputTokens: usage?.cacheReadInputTokens ?? 0,
    cacheWriteInputTokens: usage?.cacheWriteInputTokens ?? 0,
    durationMs: Date.now() - startedAt,
    // A timeout's internal estimate must never reach the console as measured tokens (spec §11.2).
    // A non-timeout error carries no counters at all, so the basis stays absent rather than guessed.
    ...(usageEstimated ? { usageBasis: 'CONSERVATIVE_ESTIMATE' as const }
      : usage ? { usageBasis: 'PROVIDER_REPORTED' as const } : {}),
  };
  try {
    appendUsage(entry);
    const companyId = currentUsageCompanyId();
    console.log(JSON.stringify({
      msg: 'ai.usage',
      tag: entry.tag,
      modelId: entry.modelId,
      ok: entry.ok,
      ...(companyId ? { companyId } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...providerFailure,
      ...(usage ? {
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cacheReadInputTokens: entry.cacheReadInputTokens,
        cacheWriteInputTokens: entry.cacheWriteInputTokens,
      } : {}),
      ...(usageEstimated ? { usageEstimated: true } : {}),
      ...(retryCount > 0 ? { throttleRetryCount: retryCount } : {}),
      durationMs: entry.durationMs,
    }));
  } catch {
    // never throw from logging
  }
}
