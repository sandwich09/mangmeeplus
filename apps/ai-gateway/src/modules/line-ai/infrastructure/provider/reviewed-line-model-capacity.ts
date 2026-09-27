/** Reviewed context ceilings, not an assertion that a vendor deployment is live. Unknown models
 * must add reviewed capacity evidence before v2 admission; there is no substring/fallback match. */
export const REVIEWED_LINE_MODEL_CAPACITY: Readonly<Record<string, { contextTokens: number; maxOutputTokens: number }>> = {
  'apac.anthropic.claude-3-5-sonnet-20241022-v2:0': { contextTokens: 200_000, maxOutputTokens: 8192 },
  'apac.anthropic.claude-3-haiku-20240307-v1:0': { contextTokens: 200_000, maxOutputTokens: 4096 },
  'gpt-4.1-mini': { contextTokens: 1_047_576, maxOutputTokens: 32_768 },
  'gpt-4.1-mini-2025-04-14': { contextTokens: 1_047_576, maxOutputTokens: 32_768 },
};

