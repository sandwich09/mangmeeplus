import type { TokenUsage } from '@aws-sdk/client-bedrock-runtime';
import { AI_BUDGET_DOCUMENT_PAGE_TOKEN_CEILING, AI_BUDGET_IMAGE_TOKEN_CEILING } from '@watchdog-bms/contracts';
import { currentBudgetEnvelope } from '../../../../common/usage/usage-context';
import type { ProviderInput, ProviderToolsInput } from './provider.port';

/** Header dimensions only, like sharp.metadata(): no decoding or EXIF auto-orientation. */
function imageDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  const dimensions = (width: number, height: number) => width > 0 && height > 0 ? { width, height } : undefined;
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    if (bytes.readUInt32BE(8) !== 13 || bytes.toString('latin1', 12, 16) !== 'IHDR') return undefined;
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    return width <= 0x7fffffff && height <= 0x7fffffff ? dimensions(width, height) : undefined;
  }
  if (bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(bytes.toString('latin1', 0, 6))) {
    return dimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // ponytail: cap header traversal at 1024 markers; unusual/hostile headers use the existing ceiling.
    for (let offset = 2, markers = 0; offset + 1 < bytes.length && markers < 1024; markers++) {
      if (bytes[offset] !== 0xff) return undefined;
      const marker = bytes[offset + 1]!;
      if (marker === 0xff) { offset++; continue; }
      offset += 2;
      if (marker === 0x00 || marker === 0xd8 || marker === 0xd9 || marker === 0xda) return undefined;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return undefined;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return undefined;
      if (marker >= 0xc0 && marker <= 0xc2) {
        if (length < 11 || length !== 8 + 3 * bytes[offset + 7]! || !bytes[offset + 2]) return undefined;
        return dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
      }
      offset += length; // APPn/EXIF and other length-prefixed segments are opaque.
    }
    return undefined;
  }
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    const end = bytes.readUInt32LE(4) + 8;
    if (end < 12 || end > bytes.length) return undefined;
    for (let offset = 12, chunks = 0; offset + 8 <= end && chunks < 1024; chunks++) {
      const kind = bytes.toString('latin1', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
      offset += 8;
      if (offset + length + (length % 2) > end) return undefined;
      if (kind === 'VP8X') {
        if (length !== 10 || (bytes[offset]! & 0xc1) || bytes.readUIntBE(offset + 1, 3)) return undefined;
        return dimensions(bytes.readUIntLE(offset + 4, 3) + 1, bytes.readUIntLE(offset + 7, 3) + 1);
      }
      if (kind === 'VP8L') {
        if (length < 5 || bytes[offset] !== 0x2f) return undefined;
        const bits = bytes.readUInt32LE(offset + 1);
        return bits >>> 29 === 0 ? dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1) : undefined;
      }
      if (kind === 'VP8 ') {
        if (length < 10 || (bytes[offset]! & 1) || bytes.toString('hex', offset + 3, offset + 6) !== '9d012a') return undefined;
        return dimensions(bytes.readUInt16LE(offset + 6) & 0x3fff, bytes.readUInt16LE(offset + 8) & 0x3fff);
      }
      offset += length + (length % 2);
    }
  }
  return undefined;
}

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
    messages: input.messages, ...('tools' in input ? { tools: input.tools } : {}),
    ...('outputSchema' in input && input.outputSchema ? { outputSchema: input.outputSchema } : {}) });
  let estimated = Math.ceil(Buffer.byteLength(text, 'utf8') / 3.14);
  if ('images' in input) {
    for (const image of input.images ?? []) {
      try {
        const size = imageDimensions(Buffer.from(image.contentBase64, 'base64'));
        estimated += size ? Math.ceil(size.width * size.height / 750) : AI_BUDGET_IMAGE_TOKEN_CEILING;
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
