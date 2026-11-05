import { parsePublicLookupRequest, publicLookupPolicy, publicQueryNeedsRephrase, publicSourceUrl, PUBLIC_LOOKUP_SYSTEM_PROMPT, type AiUsageEntry, type ProviderError } from '@watchdog-bms/contracts';
import type { IModelProvider, ProviderInput, ProviderOutput, ProviderToolCall, ProviderToolsInput, ProviderToolsOutput } from './provider.port';
import { conservativeTimeoutUsage } from './provider-usage-estimate';
import { parseProviderToolCalls } from './provider-output.logic';
import { appendUsage, currentUsageCompanyId } from '../../../../common/usage/usage-context';
import { normalizePublicLookupOutput, publicLookupExternalUnits, type PublicSearchResponse } from './public-lookup-output.logic';

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
  status?: string;
  incomplete_details?: { reason?: string };
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
  usage?: OpenAiUsage;
  error?: { message?: string; type?: string; code?: string };
};

type OpenAiToolsResponse = {
  status?: string;
  incomplete_details?: { reason?: string };
  usage?: OpenAiUsage;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
    call_id?: string;
    name?: string;
    arguments?: string;
  }>;
  error?: { message?: string; type?: string; code?: string };
};

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function readJsonBounded(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error('Provider response exceeded the bounded body size.');
  if (!response.body?.getReader) {
    // Fetch implementations normally expose a stream. If they do not, require a declared bounded
    // body before reading it; never fall back to an unbounded response.json().
    if (!Number.isFinite(length) || length < 0) throw new Error('Provider response has no bounded body stream.');
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Provider response exceeded the bounded body size.');
    return JSON.parse(body);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Provider response exceeded the bounded body size.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(body));
}

function isBlocked(body: OpenAiResponse | OpenAiToolsResponse): boolean {
  return (body.output ?? []).some((item) => item.type === 'refusal'
    || item.content?.some((content) => content.type === 'refusal' || typeof content.refusal === 'string'));
}

function incompleteError(): ProviderError {
  return { code: 'PROVIDER_OUTPUT_INCOMPLETE', message: 'The provider did not return a complete response.', retryable: false };
}

export class OpenAiProvider implements IModelProvider {
  constructor(private readonly cfg: OpenAiProviderConfig) {}

  async generateText(input: ProviderInput): Promise<ProviderOutput> {
    if (input.outputSchema) return { ok: false, error: { code: 'PROVIDER_CONTRACT_UNSUPPORTED', message: 'Structured output is unsupported by this provider.', retryable: false } };
    if (input.usageTag === 'line.public.lookup') return this.generatePublicLookup(input);
    if (input.signal?.aborted || (input.deadlineAt !== undefined && input.deadlineAt <= Date.now())) {
      return { ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'Provider work deadline elapsed before dispatch.', retryable: false } };
    }
    const controller = new AbortController();
    const remaining = input.deadlineAt === undefined ? this.cfg.timeoutMs : input.deadlineAt - Date.now();
    const timer = setTimeout(() => controller.abort(), Math.max(0, Math.min(this.cfg.timeoutMs, remaining)));
    const abortFromCaller = () => controller.abort(input.signal?.reason);
    if (input.signal?.aborted) controller.abort(input.signal.reason);
    else input.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const startedAt = Date.now();
    // No OpenAI-side caching here: the context is prepended so both providers show the model the
    // same information (spec §4.4).
    const firstUserIndex = input.messages.findIndex((m) => m.role === 'user');
    const lastUserIndex = input.messages.map((message) => message.role).lastIndexOf('user');

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
              ...(index === lastUserIndex ? (input.images ?? []) : []).map((image) => ({
                type: 'input_image',
                image_url: `data:${image.mimeType};base64,${image.contentBase64}`,
              })),
            ],
          })),
          max_output_tokens: input.maxTokens ?? 2048,
        }),
        signal: controller.signal,
      });
      const body = await readJsonBounded(response) as OpenAiResponse;
      usage = body.usage;
      if (!response.ok) {
        const error = this.mapHttpError(response.status, body);
        errorCode = error.code;
        return { ok: false, error };
      }
      if (isBlocked(body)) {
        errorCode = 'PROVIDER_BLOCKED';
        return { ok: false, error: { code: 'PROVIDER_BLOCKED', message: 'The provider blocked this response.', retryable: false } };
      }
      if (body.status === 'incomplete' && body.incomplete_details?.reason !== 'max_output_tokens') {
        errorCode = 'PROVIDER_OUTPUT_INCOMPLETE';
        return { ok: false, error: incompleteError() };
      }
      if (body.status !== 'completed' && body.status !== 'incomplete') {
        errorCode = 'PROVIDER_OUTPUT_INCOMPLETE';
        return { ok: false, error: incompleteError() };
      }
      const text = this.extractText(body);
      if (!text.trim()) {
        errorCode = 'PROVIDER_OUTPUT_INCOMPLETE';
        return { ok: false, error: incompleteError() };
      }
      const completion = body.status === 'completed' ? 'complete' as const : 'output_limit' as const;
      if (completion === 'output_limit') errorCode = 'PROVIDER_OUTPUT_INCOMPLETE';
      return {
        ok: true,
        text,
        completion,
        providerStopReason: body.status === 'completed' ? 'completed' : body.incomplete_details?.reason ?? 'incomplete',
        stopReason: body.status === 'incomplete' && body.incomplete_details?.reason === 'max_output_tokens'
          ? 'max_tokens'
          : body.status === 'completed' ? 'end_turn' : 'other',
      };
    } catch (err) {
      const error = this.mapThrownError(err);
      errorCode = error.code;
      return { ok: false, error };
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abortFromCaller);
      // Reported from `finally` (Bedrock's shape) so every call yields exactly one usage entry,
      // successes and mapped errors alike.
      await this.logUsage(input, startedAt, usage, errorCode);
    }
  }

  /** Same Responses adapter and budget decorator; this strict lane has no conversation history,
   * business tools, remote URL fetches, model fallback, or provider retry. */
  private async generatePublicLookup(input: ProviderInput): Promise<ProviderOutput> {
    const denied = (message: string): ProviderOutput => ({ ok: false, error: { code: 'PROVIDER_ACCESS_NOT_READY', message, retryable: false } });
    if (!['gpt-4.1-mini', 'gpt-4.1-mini-2025-04-14'].includes(this.cfg.model)
      || input.messages.length !== 1 || input.messages[0]?.role !== 'user' || input.cacheableContext
      || input.images?.length || input.documents?.length || input.systemPrompt !== PUBLIC_LOOKUP_SYSTEM_PROMPT
      || !Number.isSafeInteger(input.maxTokens) || input.maxTokens! < 1 || input.maxTokens! > 4096) return denied('Public lookup contract is unavailable.');
    let payload: any;
    try { payload = JSON.parse(input.messages[0].text); } catch { return denied('Public lookup input is invalid.'); }
    if (!payload || typeof payload !== 'object' || Object.keys(payload).sort().join(',') !== 'policy,request') return denied('Public lookup input is invalid.');
    const request = parsePublicLookupRequest(payload.request), policy = request && publicLookupPolicy(request);
    if (!request || !policy || JSON.stringify(payload.policy) !== JSON.stringify(policy)
      || publicQueryNeedsRephrase(request.publicQuestion, [])
      || [...request.publicQuestion.matchAll(/https?:\/\/[^\s<>"']+/gu)].some(match => !publicSourceUrl(match[0], policy))) return denied('Public question requires rephrasing.');
    const remaining = input.deadlineAt === undefined ? this.cfg.timeoutMs : input.deadlineAt - Date.now();
    if (input.signal?.aborted || remaining <= 0) return { ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'Public lookup deadline elapsed.', retryable: false } };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.min(this.cfg.timeoutMs, remaining));
    const abort = () => controller.abort(); input.signal?.addEventListener('abort', abort, { once: true });
    const startedAt = Date.now(); let usage: OpenAiUsage | undefined, errorCode: string | undefined, externalUnits: number | null = null;
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ model: this.cfg.model, instructions: PUBLIC_LOOKUP_SYSTEM_PROMPT,
          input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(request) }] }],
          tools: [{ type: 'web_search', external_web_access: true, filters: { allowed_domains: policy.domains } }],
          tool_choice: 'required', max_tool_calls: 2, include: ['web_search_call.action.sources'], store: false, max_output_tokens: input.maxTokens }),
      });
      const body = await readJsonBounded(response) as OpenAiResponse & PublicSearchResponse;
      usage = body.usage; externalUnits = publicLookupExternalUnits(body);
      if (!response.ok) { const error = this.mapHttpError(response.status, body); errorCode = error.code; return { ok: false, error: { ...error, retryable: false } }; }
      if (isBlocked(body)) { errorCode = 'PROVIDER_BLOCKED'; return { ok: false, error: { code: 'PROVIDER_BLOCKED', message: 'Public lookup response blocked.', retryable: false } }; }
      const result = normalizePublicLookupOutput(body, policy);
      return { ok: true, text: JSON.stringify(result), completion: 'complete', providerStopReason: body.status ?? 'unknown', stopReason: 'end_turn' };
    } catch (err) { const error = this.mapThrownError(err); errorCode = error.code; return { ok: false, error: { ...error, retryable: false } }; }
    finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort); await this.logUsage(input, startedAt, usage, errorCode, externalUnits); }
  }

  /** Item 10F native tool loop – Responses API function calling (`tools` / `function_call` /
   *  `function_call_output`). Mirrors the Bedrock adapter's contract. */
  async generateWithTools(input: ProviderToolsInput): Promise<ProviderToolsOutput> {
    if (input.signal?.aborted || (input.deadlineAt !== undefined && input.deadlineAt <= Date.now())) {
      return { ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'Provider work deadline elapsed before dispatch.', retryable: false } };
    }
    const controller = new AbortController();
    const remaining = input.deadlineAt === undefined ? this.cfg.timeoutMs : input.deadlineAt - Date.now();
    const timer = setTimeout(() => controller.abort(), Math.max(0, Math.min(this.cfg.timeoutMs, remaining)));
    const abortFromCaller = () => controller.abort(input.signal?.reason);
    if (input.signal?.aborted) controller.abort(input.signal.reason);
    else input.signal?.addEventListener('abort', abortFromCaller, { once: true });

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
      const body = await readJsonBounded(response) as OpenAiToolsResponse;
      usage = body.usage;
      if (!response.ok) {
        const error = this.mapHttpError(response.status, body as OpenAiResponse);
        errorCode = error.code;
        return { ok: false, error };
      }
      if (isBlocked(body)) {
        errorCode = 'PROVIDER_BLOCKED';
        return { ok: false, error: { code: 'PROVIDER_BLOCKED', message: 'The provider blocked this response.', retryable: false } };
      }
      if (body.status === 'incomplete' && body.incomplete_details?.reason !== 'max_output_tokens') {
        errorCode = 'PROVIDER_OUTPUT_INCOMPLETE';
        return { ok: false, error: incompleteError() };
      }
      if (body.status !== 'completed' && body.status !== 'incomplete') {
        errorCode = 'PROVIDER_OUTPUT_INCOMPLETE';
        return { ok: false, error: incompleteError() };
      }
      const outputLimited = body.status === 'incomplete';
      if (outputLimited) errorCode = 'PROVIDER_OUTPUT_INCOMPLETE';

      const rawCalls: Array<{ callId?: unknown; name?: unknown; arguments?: unknown }> = [];
      const textParts: string[] = [];
      for (const item of body.output ?? []) {
        if (item.type === 'function_call') {
          rawCalls.push({ callId: item.call_id, name: item.name, arguments: item.arguments });
        } else if (item.type === 'message') {
          for (const c of item.content ?? []) {
            if (c.type === 'refusal' || typeof c.refusal === 'string') {
              errorCode = 'PROVIDER_BLOCKED';
              return { ok: false, error: { code: 'PROVIDER_BLOCKED', message: 'The provider blocked this response.', retryable: false } };
            }
            if (c.type === 'output_text' && typeof c.text === 'string') textParts.push(c.text);
          }
        }
      }
      if (outputLimited && rawCalls.length > 0) return { ok: true, text: textParts.join('\n'), toolCalls: [],
        completion: 'output_limit', providerStopReason: body.incomplete_details?.reason, stopReason: 'max_tokens' };
      const toolCalls = parseProviderToolCalls(rawCalls.map((call) => ({
        ...call,
        arguments: typeof call.arguments === 'string' ? call.arguments : undefined,
      })), input.tools);
      if (!toolCalls) {
        errorCode = 'PROVIDER_TOOL_ARGUMENT_INVALID';
        return { ok: false, error: { code: 'PROVIDER_TOOL_ARGUMENT_INVALID', message: 'The provider returned invalid tool arguments.', retryable: false } };
      }
      if (toolCalls.length === 0 && !textParts.some((part) => part.trim())) {
        errorCode = 'PROVIDER_OUTPUT_INCOMPLETE';
        return { ok: false, error: incompleteError() };
      }
      const stopReason = toolCalls.length > 0 ? 'tool_use' : outputLimited ? 'max_tokens' : 'end_turn';
      return { ok: true, text: textParts.join('\n'), toolCalls, completion: outputLimited ? 'output_limit' : 'complete',
        providerStopReason: outputLimited ? body.incomplete_details?.reason : 'completed', stopReason };
    } catch (err) {
      const error = this.mapThrownError(err);
      errorCode = error.code;
      return { ok: false, error };
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abortFromCaller);
      await this.logUsage(input, startedAt, usage, errorCode);
    }
  }

  /** Same bounded `ai.usage` shape as Bedrock. Known counters survive provider and parser errors. */
  private async logUsage(input: ProviderInput | ProviderToolsInput, startedAt: number, usage?: OpenAiUsage, errorCode?: string, externalUnits?: number | null): Promise<void> {
    // Responses input_tokens includes cached tokens; the shared cost contract keeps disjoint
    // input/cache buckets. Invalid counters stay unknown, never a fabricated free measurement.
    if (usage && (![usage.input_tokens, usage.output_tokens, usage.input_tokens_details?.cached_tokens ?? 0]
      .every(value => Number.isSafeInteger(value) && Number(value) >= 0)
      || (usage.input_tokens_details?.cached_tokens ?? 0) > usage.input_tokens!)) usage = undefined;
    const estimated = !usage && errorCode === 'PROVIDER_TIMEOUT' ? await conservativeTimeoutUsage(input) : undefined;
    const entry: AiUsageEntry = {
      tag: input.usageTag ?? 'untagged',
      modelId: this.cfg.model,
      ok: !errorCode,
      ...(errorCode ? { errorCode } : {}),
      inputTokens: estimated?.inputTokens ?? (usage?.input_tokens ?? 0) - (usage?.input_tokens_details?.cached_tokens ?? 0),
      outputTokens: estimated?.outputTokens ?? usage?.output_tokens ?? 0,
      cacheReadInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
      // The Responses API exposes no cache-write counter; 0 keeps the entry shape uniform.
      cacheWriteInputTokens: 0,
      durationMs: Date.now() - startedAt,
      ...(externalUnits !== undefined ? { externalUnits } : {}),
      // Unknown timeout counters are internal estimates; the API absorbs every failed call.
      ...(estimated ? { usageBasis: 'CONSERVATIVE_ESTIMATE' as const } : usage ? { usageBasis: 'PROVIDER_REPORTED' as const } : {}),
    };
    try {
      appendUsage(entry);
      if (!usage && !estimated) return;
      const companyId = currentUsageCompanyId();
      console.log(JSON.stringify({
        msg: 'ai.usage',
        tag: entry.tag,
        modelId: entry.modelId,
        ok: entry.ok,
        ...(companyId ? { companyId } : {}),
        ...(usage?.input_tokens !== undefined || estimated ? { inputTokens: entry.inputTokens } : {}),
        ...(usage?.output_tokens !== undefined || estimated ? { outputTokens: entry.outputTokens } : {}),
        ...(estimated ? { usageEstimated: true } : {}),
        ...(errorCode ? { errorCode } : {}),
        ...(usage?.input_tokens_details?.cached_tokens !== undefined ? { cacheReadInputTokens: usage.input_tokens_details.cached_tokens } : {}),
        durationMs: entry.durationMs,
      }));
    } catch {
      // never throw from logging
    }
  }

  private extractText(body: OpenAiResponse): string {
    if (body.output_text) return body.output_text;
    return body.output?.flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text')
      .map((c) => c.text ?? '').join('') ?? '';
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
