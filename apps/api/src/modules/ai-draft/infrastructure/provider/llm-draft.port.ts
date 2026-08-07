import type { AiProviderMode, AiDraftGenerationRequest, AiDraftGenerationResult } from '@watchdog-bms/contracts';

// Draft-generation provider port. The API gathers grounded evidence (source reads) and
// asks this port to AUTHOR the suggestion content. Production routes to the AI Gateway's
// Bedrock provider; tests use the deterministic fake provider. When no provider is
// configured the port is unavailable and generation yields provider-unavailable state —
// it never emits canned/deterministic product content in production.

export type LlmDraftPort = {
  readonly mode: AiProviderMode;
  readonly available: boolean;
  generate(input: AiDraftGenerationRequest): Promise<AiDraftGenerationResult>;
};

export const LLM_DRAFT_PORT = 'LLM_DRAFT_PORT';
