/**
 * Model provider port – AI Gateway calls this; never imports DB or LINE SDK.
 */
import type { ProviderError } from '@watchdog-bms/contracts';

export type ProviderInput = {
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  images?: Array<{ mimeType: 'image/jpeg' | 'image/png'; contentBase64: string }>;
  /** ponytail: Bedrock Converse document blocks only — the image channel above cannot carry a PDF, so the
   *  PDF branch of receipt OCR reads the file here instead. OpenAI ignores these; callers gate
   *  on MODEL_PROVIDER=bedrock rather than the port growing a capability flag. */
  documents?: Array<{ mimeType: 'application/pdf'; contentBase64: string }>;
  systemPrompt?: string;
  maxTokens?: number;
  /** Provider-enforced JSON schema for the text response. */
  outputSchema?: { name: string; schema: Record<string, unknown> };
  /** Deterministic, byte-stable context rendered as the leading text blocks of the first
   *  user message, before that message's text. Bedrock adds a cachePoint after it when
   *  long enough; OpenAI prepends it to the first user text (same model-visible content,
   *  no caching). Callers must pass byte-identical strings for identical logical context. */
  cacheableContext?: string;
  /** Optional character boundary between the shared catalogue and per-turn context. Local
   *  cache metadata only: splitting at this offset preserves the concatenated context bytes. */
  cacheableContextPrefixLength?: number;
  /** Short call-site label for usage logs, e.g. 'ocr.receipt.extract'. */
  usageTag?: string;
  /** Local-only cancellation; never serialized to the provider wire. */
  signal?: AbortSignal;
  /** Absolute Unix deadline carried in process memory, never as provider metadata. */
  deadlineAt?: number;
  /** Local, synchronous parser/acceptance only: no business writes, tools or I/O. Never sent to the provider. */
  acceptOutput?: (output: Extract<ProviderOutput, { ok: true }>) => boolean;
};

export type ProviderCompletion = 'complete' | 'output_limit' | 'blocked' | 'unknown';

export type ProviderOutput =
  | { ok: true; text: string; schemaEnforcement?: 'output_config' | 'strict_tool'; completion?: ProviderCompletion; providerStopReason?: string; stopReason?: 'end_turn' | 'max_tokens' | 'other' }
  | { ok: false; error: ProviderError };

// ── Item 10F: native tool-use (Bedrock Converse toolConfig / OpenAI function calling) ──

/** Wire-safe tool description. `name` must match ^[a-zA-Z0-9_-]{1,64}$ on both providers —
 *  registry names carry dots, so callers map them (see orchestrator wireToolName). */
export type ProviderToolSpec = {
  name: string;
  description?: string;
  /** JSON-schema object for the tool input. */
  inputSchema: Record<string, unknown>;
  /** Ask Bedrock to enforce this tool's input schema. */
  strict?: boolean;
};

export type ProviderToolCall = {
  /** Provider-issued id; must be echoed back on the matching tool result. */
  toolUseId: string;
  name: string;
  input: unknown;
};

export type ProviderToolResult = {
  toolUseId: string;
  /** Serialized (bounded) tool output – DATA for the model, never instructions. */
  content: string;
  isError?: boolean;
};

/** Conversation turns for the tool loop. `tool_results` rides as a user turn on both wires. */
export type ProviderToolMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text?: string; toolCalls?: ProviderToolCall[] }
  | { role: 'tool_results'; results: ProviderToolResult[] };

export type ProviderToolsInput = {
  messages: ProviderToolMessage[];
  tools: ProviderToolSpec[];
  systemPrompt?: string;
  maxTokens?: number;
  /** Same contract as `ProviderInput.cacheableContext`. */
  cacheableContext?: string;
  cacheableContextPrefixLength?: number;
  /** Same contract as `ProviderInput.usageTag`. */
  usageTag?: string;
  /** Local-only cancellation/deadline. */
  signal?: AbortSignal;
  deadlineAt?: number;
  /** Local, synchronous parser/acceptance only: no business writes, tools or I/O. Never sent to the provider. */
  acceptOutput?: (output: Extract<ProviderOutput, { ok: true }>) => boolean;
};

export type ProviderToolsOutput =
  | { ok: true; text: string; toolCalls: ProviderToolCall[]; schemaEnforcement?: 'output_config' | 'strict_tool'; completion?: ProviderCompletion; providerStopReason?: string; stopReason: 'tool_use' | 'end_turn' | 'max_tokens' | 'other' }
  | { ok: false; error: ProviderError };

export interface IModelProvider {
  generateText(input: ProviderInput): Promise<ProviderOutput>;
  /** Optional so existing single-purpose stubs keep compiling; the orchestrator treats a
   *  missing implementation as "not capable" and falls back to the JSON loop. */
  generateWithTools?(input: ProviderToolsInput): Promise<ProviderToolsOutput>;
}
