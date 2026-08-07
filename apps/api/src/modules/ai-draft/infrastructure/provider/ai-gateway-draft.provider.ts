import type { AiProviderMode, AiDraftGenerationRequest, AiDraftGenerationResult } from '@watchdog-bms/contracts';
import type { LlmDraftPort } from './llm-draft.port';

// Production provider: routes draft authoring to the AI Gateway, which runs the model
// (Amazon Bedrock through its provider port) on the grounded evidence the API supplies.
// The AI Gateway never reads the DB — it only sees the bounded evidence in the request.
export class AiGatewayDraftProvider implements LlmDraftPort {
  readonly mode: AiProviderMode = 'bedrock';

  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
    private readonly timeoutMs = 20_000,
  ) {}

  get available(): boolean {
    return Boolean(this.baseUrl) && Boolean(this.internalSecret);
  }

  async generate(input: AiDraftGenerationRequest): Promise<AiDraftGenerationResult> {
    if (!this.available) {
      return { ok: false, error: { code: 'PROVIDER_DISABLED', message: 'AI Gateway URL/secret not configured', retryable: false } };
    }
    const url = `${this.baseUrl.replace(/\/$/, '')}/internal/ai/draft-generate`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': this.internalSecret },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        return { ok: false, error: { code: `HTTP_${res.status}`, message: `AI Gateway returned ${res.status}`, retryable: res.status >= 500 } };
      }
      return (await res.json()) as AiDraftGenerationResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: 'GATEWAY_UNREACHABLE', message, retryable: true } };
    }
  }
}
