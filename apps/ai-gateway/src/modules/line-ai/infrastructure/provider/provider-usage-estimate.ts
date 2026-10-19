import type { TokenUsage } from '@aws-sdk/client-bedrock-runtime';
import { AI_BUDGET_DOCUMENT_PAGE_TOKEN_CEILING, AI_BUDGET_IMAGE_TOKEN_CEILING } from '@watchdog-bms/contracts';
import { currentBudgetEnvelope } from '../../../../common/usage/usage-context';
import type { ProviderInput, ProviderToolsInput } from './provider.port';

/** PDF page-tree evidence, shared with admission's stricter upper-bound estimator. */
export function pdfPageUpperBound(contentBase64: string): number | undefined {
  let text: string;
  try { text = Buffer.from(contentBase64, 'base64').toString('latin1'); } catch { return undefined; }
  const pageObjects = text.match(/\/Type\s*\/Page(?![sA-Za-z])/g)?.length ?? 0;
  let declared = 0;
  for (const match of text.matchAll(/\/Count\s+(\d+)/g)) declared = Math.max(declared, Number(match[1]));
  const pages = Math.max(pageObjects, declared);
  return pages > 0 ? pages : undefined;
}

/** Internal cost estimate only: never customer spend. Media bytes are not text tokens. */
export async function conservativeTimeoutUsage(
  input: ProviderInput | ProviderToolsInput,
  bounds: { maxInputTokens: number; maxOutputTokens: number } | undefined = currentBudgetEnvelope()?.bounds,
): Promise<TokenUsage> {
  const text = JSON.stringify({ systemPrompt: input.systemPrompt ?? '', cacheableContext: input.cacheableContext ?? '',
    messages: input.messages, ...('tools' in input ? { tools: input.tools } : {}) });
  let estimated = Math.ceil(Buffer.byteLength(text, 'utf8') / 3.14);
  if ('images' in input) {
    for (const image of input.images ?? []) {
      try {
        // Loaded on use: the AgentCore bundle leaves sharp out, and a top-level import crashed it at start.
        const { default: sharp } = await import('sharp');
        const { width, height } = await sharp(Buffer.from(image.contentBase64, 'base64')).metadata();
        estimated += width && height ? Math.ceil(width * height / 750) : AI_BUDGET_IMAGE_TOKEN_CEILING;
      } catch {
        estimated += AI_BUDGET_IMAGE_TOKEN_CEILING;
      }
    }
  }
  if ('documents' in input) {
    for (const document of input.documents ?? []) {
      // ponytail: compressed page trees fall back to one page for internal estimates only;
      // admission still refuses documents whose upper bound cannot be proven.
      estimated += (pdfPageUpperBound(document.contentBase64) ?? 1) * AI_BUDGET_DOCUMENT_PAGE_TOKEN_CEILING;
    }
  }
  const inputTokens = Math.min(estimated, bounds?.maxInputTokens ?? estimated);
  const outputTokens = Math.min(Math.max(1, input.maxTokens ?? 2048), bounds?.maxOutputTokens ?? Infinity);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 };
}
