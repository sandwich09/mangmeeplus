import type { AiProviderMode, AiDraftGenerationRequest, AiDraftGenerationResult } from '@watchdog-bms/contracts';
import type { LlmDraftPort } from './llm-draft.port';

// Deterministic provider for CI/tests ONLY (spec requires a deterministic test provider
// so CI needs no model credentials). It composes the suggestion from the grounded facts
// so tests are stable. Production must not use this — it is selected only when
// AI_DRAFT_PROVIDER=fake.
export class FakeLlmDraftProvider implements LlmDraftPort {
  readonly mode: AiProviderMode = 'fake';
  readonly available = true;

  async generate(input: AiDraftGenerationRequest): Promise<AiDraftGenerationResult> {
    // Structured-output validation stand-in: refuse when there is nothing to ground on.
    if (input.facts.length === 0 && input.citations.length === 0) {
      return { ok: false, error: { code: 'NO_EVIDENCE', message: 'no grounded evidence', retryable: false } };
    }
    const summary = input.facts[0] ?? input.defaultTitle;
    const recommendation = input.facts.join(' ');
    return {
      ok: true,
      provider: 'fake',
      model: 'fake-deterministic-v1',
      title: input.defaultTitle,
      summary,
      recommendation,
      riskLevel: input.wantsChecklist ? 'LOW' : 'MEDIUM',
      confidence: 0.6,
      actionTitle: input.defaultTitle,
      checklistItems: input.wantsChecklist ? input.facts : undefined,
    };
  }
}
