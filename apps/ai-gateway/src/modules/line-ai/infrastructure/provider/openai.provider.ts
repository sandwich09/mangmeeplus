import type { AiUsageEntry, ProviderError } from '@watchdog-bms/contracts';
import type { IModelProvider, ProviderInput, ProviderOutput, ProviderToolCall, ProviderToolsInput, ProviderToolsOutput } from './provider.port';
import { appendUsage, currentUsageCompanyId } from '../../../../common/usage/usage-context';

export type OpenAiProviderConfig = {
  apiKey: string;
  model: string;
  timeoutMs: number;
};

/** Responses API usage block; absent on errors and on older deployments. */
type OpenAiUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
};

type OpenAiResponse = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
  usage?: OpenAiUsage;
  error?: { message?: string; type?: string; code?: string };
};

type OpenAiToolsResponse = {
  status?: string;
  incomplete_details?: { reason?: string };
  usage?: OpenAiUsage;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
    call_id?: string;
    name?: string;
    arguments?: string;
  }>;
  error?: { message?: string; type?: string; code?: string };
};

export class OpenAiProvider implements IModelProvider {
  constructor(private readonly cfg: OpenAiProviderConfig) {}

  async generateText(input: ProviderInput): Promise<ProviderOutput> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    const startedAt = Date.now();
    // No OpenAI-side caching here: the context is prepended so both providers show the model the
    // same information (spec §4.4).
    const firstUserIndex = input.messages.findIndex((m) => m.role === 'user');

    let usage: OpenAiUsage | undefined;
    let errorCode: string | undefined;
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.cfg.model,
          instructions: input.systemPrompt,
          input: input.messages.map((m, index) => ({
            role: m.role,
            content: [
              { type: 'input_text', text: index === firstUserIndex && input.cacheableContext ? `${input.cacheableContext}\n${m.text}` : m.text },
              ...(input.images ?? []).map((image) => ({
                type: 'input_image',
                image_url: `data:${image.mimeType};base64,${image.contentBase64}`,
              })),
            ],
          })),
          max_output_tokens: input.maxTokens ?? 2048,
        }),
        signal: controller.signal,
      });
      const body = await response.json() as OpenAiResponse;
      if (!response.ok) {
        const error = this.mapHttpError(response.status, body);
        errorCode = error.code;
        return { ok: false, error };
      }
      usage = body.usage;
      return { ok: true, text: this.extractText(body) };
    } catch (err) {
      const error = this.mapThrownError(err);
      errorCode = error.code;
      return { ok: false, error };
    } finally {
      clearTimeout(timer);
      // Reported from `finally` (Bedrock's shape) so every call yields exactly one usage entry,
      // successes and mapped errors alike.
      this.logUsage(input.usageTag, startedAt, usage, errorCode);
    }
  }

  /** Item 10F native tool loop – Responses API function calling (`tools` / `function_call` /
   *  `function_call_output`). Mirrors the Bedrock adapter's contract. */
  async generateWithTools(input: ProviderToolsInput): Promise<ProviderToolsOutput> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);

    const startedAt = Date.now();
    const items: Array<Record<string, unknown>> = [];
    let firstUser = true;
    for (const m of input.messages) {
      if (m.role === 'user') {
        const text = firstUser && input.cacheableContext ? `${input.cacheableContext}\n${m.text}` : m.text;
        firstUser = false;
        items.push({ role: 'user', content: [{ type: 'input_text', text }] });
      } else if (m.role === 'assistant') {
        if (m.text) items.push({ role: 'assistant', content: [{ type: 'output_text', text: m.text }] });
        for (const call of m.toolCalls ?? []) {
          items.push({ type: 'function_call', call_id: call.toolUseId, name: call.name, arguments: JSON.stringify(call.input ?? {}) });
        }
      } else {
        for (const result of m.results) {
          items.push({ type: 'function_call_output', call_id: result.toolUseId, output: result.content });
        }
      }
    }

    let usage: OpenAiUsage | undefined;
    let errorCode: string | undefined;
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.cfg.model,
          instructions: input.systemPrompt,
          input: items,
          tools: input.tools.map((t) => ({
            type: 'function',
            name: t.name,
            ...(t.description ? { description: t.description } : {}),
            parameters: t.inputSchema,
            strict: false,
          })),
          max_output_tokens: input.maxTokens ?? 1024,
        }),
        signal: controller.signal,
      });
      const body = await response.json() as OpenAiToolsResponse;
      if (!response.ok) {
        const error = this.mapHttpError(response.status, body as OpenAiResponse);
        errorCode = error.code;
        return { ok: false, error };
      }
      usage = body.usage;

      const toolCalls: ProviderToolCall[] = [];
      const textParts: string[] = [];
      for (const item of body.output ?? []) {
        if (item.type === 'function_call' && item.call_id && item.name) {
          let parsed: unknown = {};
          try { parsed = JSON.parse(item.arguments ?? '{}'); } catch { parsed = {}; }
          toolCalls.push({ toolUseId: item.call_id, name: item.name, input: parsed });
        } else if (item.type === 'message') {
          for (const c of item.content ?? []) {
            if (typeof c.text === 'string' && c.text) textParts.push(c.text);
          }
        }
      }
      const stopReason = toolCalls.length > 0 ? 'tool_use'
        : body.status === 'incomplete' && body.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens'
        : 'end_turn';
      return { ok: true, text: textParts.join('\n'), toolCalls, stopReason };
    } catch (err) {
      const error = this.mapThrownError(err);
      errorCode = error.code;
      return { ok: false, error };
    } finally {
      clearTimeout(timer);
      this.logUsage(input.usageTag, startedAt, usage, errorCode);
    }
  }

  /** Same `ai.usage` shape as the Bedrock provider, limited to the fields the API exposes, and the
   *  same two sinks: the request-scoped collector the API meters from (metering §7.2) plus the
   *  stdout line. The line is still emitted only for a success that carried a usage block, so
   *  `ok:true` is never claimed for a failed call (spec §4.4) — the appended entry covers the
   *  failures instead, with zero counts. Never throws. */
  private logUsage(tag: string | undefined, startedAt: number, usage?: OpenAiUsage, errorCode?: string): void {
    const entry: AiUsageEntry = {
      tag: tag ?? 'untagged',
      modelId: this.cfg.model,
      ok: !errorCode,
      inputTokens: errorCode ? 0 : usage?.input_tokens ?? 0,
      outputTokens: errorCode ? 0 : usage?.output_tokens ?? 0,
      cacheReadInputTokens: errorCode ? 0 : usage?.input_tokens_details?.cached_tokens ?? 0,
      // The Responses API exposes no cache-write counter; 0 keeps the entry shape uniform.
      cacheWriteInputTokens: 0,
      durationMs: Date.now() - startedAt,
    };
    try {
      appendUsage(entry);
      if (errorCode || !usage) return;
      const companyId = currentUsageCompanyId();
      console.log(JSON.stringify({
        msg: 'ai.usage',
        tag: entry.tag,
        modelId: entry.modelId,
        ok: true,
        ...(companyId ? { companyId } : {}),
        ...(usage.input_tokens !== undefined ? { inputTokens: usage.input_tokens } : {}),
        ...(usage.output_tokens !== undefined ? { outputTokens: usage.output_tokens } : {}),
        ...(usage.input_tokens_details?.cached_tokens !== undefined ? { cacheReadInputTokens: usage.input_tokens_details.cached_tokens } : {}),
        durationMs: entry.durationMs,
      }));
    } catch {
      // never throw from logging
    }
  }

  private extractText(body: OpenAiResponse): string {
    if (body.output_text) return body.output_text;
    return body.output?.flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('') ?? '';
  }

  private mapHttpError(status: number, body: OpenAiResponse): ProviderError {
    const message = body.error?.message ?? `OpenAI request failed with HTTP ${status}`;
    if (status === 401 || status === 403) return { code: 'PROVIDER_ACCESS_NOT_READY', message, retryable: false };
    if (status === 429) return { code: 'PROVIDER_THROTTLED', message, retryable: true };
    if (status >= 500) return { code: 'PROVIDER_UNKNOWN', message, retryable: true };
    return { code: 'PROVIDER_UNKNOWN', message, retryable: false };
  }

  private mapThrownError(err: unknown): ProviderError {
    if ((err as Error)?.name === 'AbortError') {
      return { code: 'PROVIDER_TIMEOUT', message: 'OpenAI request timed out.', retryable: true };
    }
    return { code: 'PROVIDER_UNKNOWN', message: (err as Error)?.message ?? 'Unknown error', retryable: false };
  }
}
