import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ContentBlock, ConverseCommandOutput, Message, SystemContentBlock, TokenUsage, ToolUseBlock } from '@aws-sdk/client-bedrock-runtime';
import type { IModelProvider, ProviderInput, ProviderOutput, ProviderToolCall, ProviderToolsInput, ProviderToolsOutput } from './provider.port';
import type { AiUsageEntry, ProviderError } from '@watchdog-bms/contracts';
import { appendUsage, currentUsageCompanyId } from '../../../../common/usage/usage-context';

export type BedrockProviderConfig = {
  region: string;
  modelId: string;
  timeoutMs: number;
};

/** Minimum covered text before a cache checkpoint is worth emitting. Claude Sonnet 4.x will not
 *  cache a prefix under 1,024 tokens — it ignores the checkpoint entirely (no cache write, so no
 *  extra billing), which just leaves a dead checkpoint in the request. At the ~3.14 chars/token
 *  measured on these prompts, 4,000 chars ≈ 1,270 tokens clears the floor with margin. Exported so
 *  tests assert against the real boundary instead of a copied number. */
export const CACHE_MIN_CHARS = 4000;
/** Current approved Claude APAC profiles have a 200k input context. On a timeout Bedrock returns
 *  no usage, so charging that ceiling (plus requested max output) is deliberately fail-safe. */
export const TIMEOUT_INPUT_TOKEN_CEILING = 200_000;
const CACHE_POINT = { cachePoint: { type: 'default' as const } };

export class BedrockProvider implements IModelProvider {
  private readonly client: BedrockRuntimeClient;

  constructor(private readonly cfg: BedrockProviderConfig) {
    this.client = new BedrockRuntimeClient({ region: cfg.region });
  }

  async generateText(input: ProviderInput): Promise<ProviderOutput> {
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
    const contextBlocks = cacheableContextBlocks(input.cacheableContext);
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

    return this.converse(command, input.usageTag, (response) => ({
      text: response.output?.message?.content?.[0]?.text ?? '',
    }));
  }

  /** Item 10F native tool loop – Converse `toolConfig`/`toolUse`/`toolResult`. Verified live
   *  on the pinned Claude model (parallel toolUse blocks in one turn) 2026-07-07. */
  async generateWithTools(input: ProviderToolsInput): Promise<ProviderToolsOutput> {
    const contextIndex = cacheableContextIndex(input.messages);
    const contextBlocks = cacheableContextBlocks(input.cacheableContext);
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
        tools: input.tools.map((t) => ({
          toolSpec: {
            name: t.name,
            ...(t.description ? { description: t.description } : {}),
            inputSchema: { json: t.inputSchema as never },
          },
        })),
      },
      ...systemBlocks(input.systemPrompt),
      inferenceConfig: { maxTokens: input.maxTokens ?? 1024 },
    });

    return this.converse(command, input.usageTag, (response) => {
      const blocks = response.output?.message?.content ?? [];
      const toolCalls: ProviderToolCall[] = blocks
        .filter((b) => !!b.toolUse)
        .map((b) => ({
          toolUseId: b.toolUse!.toolUseId ?? '',
          name: b.toolUse!.name ?? '',
          input: b.toolUse!.input ?? {},
        }))
        .filter((c) => c.toolUseId && c.name);
      const stopReason = response.stopReason === 'tool_use' ? 'tool_use'
        : response.stopReason === 'end_turn' ? 'end_turn'
        : response.stopReason === 'max_tokens' ? 'max_tokens'
        : 'other';
      return { text: blocks.map((b) => b.text ?? '').filter(Boolean).join('\n'), toolCalls, stopReason };
    });
  }

  /** One Converse round-trip: abortable timeout, response parsing, and exactly one `ai.usage` line
   *  (spec §4.3). `parse` runs INSIDE the error boundary so a malformed response becomes a mapped
   *  ProviderError (the orchestrator's fallback signal) instead of escaping as a throw. */
  private async converse<T extends object>(
    command: ConverseCommand,
    usageTag: string | undefined,
    parse: (response: ConverseCommandOutput) => T,
  ): Promise<({ ok: true } & T) | { ok: false; error: ProviderError }> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.cfg.timeoutMs);

    let usage: TokenUsage | undefined;
    let usageEstimated = false;
    let errorCode: string | undefined;
    try {
      const response = await this.client.send(command, { abortSignal: controller.signal });
      usage = response.usage;
      return { ok: true, ...parse(response) };
    } catch (err) {
      const timedOut = controller.signal.aborted;
      const error = this.mapError(timedOut ? { name: 'ProviderTimeout' } : err);
      if (timedOut) {
        usage = conservativeTimeoutUsage(command);
        usageEstimated = true;
      }
      errorCode = error.code;
      return { ok: false, error };
    } finally {
      clearTimeout(timeout);
      // Logged here so exactly one line is emitted whatever throws, and so logging can never
      // double-log or turn a success into an error.
      this.logUsage(usageTag, startedAt, usage, errorCode, usageEstimated);
    }
  }

  /** Counts and identifiers only — never prompt, message, or customer content (PDPA posture).
   *  One place, two sinks: the request-scoped collector the API meters from (metering §7.2) and
   *  the stdout line CloudWatch reconciles against. Swallows its own failures: losing either must
   *  never fail a business call. Errors keep real response usage when Bedrock supplied it; a
   *  timeout carries the conservative ceiling estimate because no response usage exists. */
  private logUsage(
    tag: string | undefined,
    startedAt: number,
    usage?: TokenUsage,
    errorCode?: string,
    usageEstimated = false,
  ): void {
    const entry: AiUsageEntry = {
      tag: tag ?? 'untagged',
      modelId: this.cfg.modelId,
      ok: !errorCode,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cacheReadInputTokens: usage?.cacheReadInputTokens ?? 0,
      cacheWriteInputTokens: usage?.cacheWriteInputTokens ?? 0,
      durationMs: Date.now() - startedAt,
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
        ...(usage ? {
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          cacheReadInputTokens: entry.cacheReadInputTokens,
          cacheWriteInputTokens: entry.cacheWriteInputTokens,
        } : {}),
        ...(usageEstimated ? { usageEstimated: true } : {}),
        durationMs: entry.durationMs,
      }));
    } catch {
      // never throw from logging
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

/** Bedrock exposes no token counts after an aborted Converse request. The monthly meter must not
 *  call that spend free, so it prices the maximum current input context and requested output. */
function conservativeTimeoutUsage(command: ConverseCommand): TokenUsage {
  const outputTokens = Math.max(1, command.input.inferenceConfig?.maxTokens ?? 2048);
  return {
    inputTokens: TIMEOUT_INPUT_TOKEN_CEILING,
    outputTokens,
    totalTokens: TIMEOUT_INPUT_TOKEN_CEILING + outputTokens,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
  };
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
function cacheableContextBlocks(cacheableContext?: string): ContentBlock[] {
  if (!cacheableContext) return [];
  return cacheableContext.length >= CACHE_MIN_CHARS ? [{ text: cacheableContext }, CACHE_POINT] : [{ text: cacheableContext }];
}

/** Which message carries the cacheable context: the first user turn, or the first message when
 *  there is no user turn at all — the contract is that the context is ALWAYS rendered. */
function cacheableContextIndex(messages: ReadonlyArray<{ role: string }>): number {
  const firstUser = messages.findIndex((m) => m.role === 'user');
  return firstUser >= 0 ? firstUser : 0;
}
