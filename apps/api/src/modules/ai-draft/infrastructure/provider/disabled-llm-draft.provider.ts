import type { AiProviderMode, AiDraftGenerationResult } from '@watchdog-bms/contracts';
import type { LlmDraftPort } from './llm-draft.port';

// Selected when no AI draft provider is configured. Generation stays visible and
// retryable in provider-unavailable state; it never emits canned product content.
export class DisabledLlmDraftProvider implements LlmDraftPort {
  readonly mode: AiProviderMode = 'disabled';
  readonly available = false;

  async generate(): Promise<AiDraftGenerationResult> {
    return {
      ok: false,
      error: { code: 'PROVIDER_DISABLED', message: 'No AI draft model provider configured. Set AI_DRAFT_PROVIDER=gateway and wire the AI Gateway (Bedrock).', retryable: false },
    };
  }
}
