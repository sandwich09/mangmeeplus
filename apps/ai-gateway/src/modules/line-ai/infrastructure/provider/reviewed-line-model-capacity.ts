/** Reviewed context ceilings, not an assertion that a vendor deployment is live. Unknown models
 * must add reviewed capacity evidence before v2 admission; there is no substring/fallback match. */
export const REVIEWED_LINE_MODEL_CAPACITY: Readonly<Record<string, { contextTokens: number; maxOutputTokens: number }>> = {
  // AWS model card, reviewed 2026-09-27: 1M context / 64K output for this exact Bedrock ID.
  // https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html
  // Deliberately retain a 200K integration ceiling: the pinned standard tariff does not authorize
  // long-context/beta requests. This is a supported subset, not the vendor's maximum context.
  'global.anthropic.claude-sonnet-4-6': { contextTokens: 200_000, maxOutputTokens: 64_000 },
  // AWS model card referenced by workflow-first R19/MC10, reviewed locally 2026-11-08.
  // https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html
  // Integration ceilings retain the <=100K prompt tariff and cover both routing profiles.
  'global.anthropic.claude-haiku-5-5': { contextTokens: 100_000, maxOutputTokens: 8192 },
  'apac.anthropic.claude-3-5-sonnet-20241022-v2:0': { contextTokens: 200_000, maxOutputTokens: 8192 },
  'apac.anthropic.claude-3-haiku-20240307-v1:0': { contextTokens: 200_000, maxOutputTokens: 4096 },
  'gpt-4.1-mini': { contextTokens: 1_047_576, maxOutputTokens: 32_768 },
  'gpt-4.1-mini-2025-04-14': { contextTokens: 1_047_576, maxOutputTokens: 32_768 },
};
