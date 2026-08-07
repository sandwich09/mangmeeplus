import type { ProviderError } from '@watchdog-bms/contracts';

const TYPHOON_BASE_URL = 'https://api.opentyphoon.ai/v1';
const TYPHOON_MODEL = 'typhoon-ocr';
// Official Typhoon OCR generation settings (docs.opentyphoon.ai + model card):
// OCR must run near-deterministic; repetition_penalty guards against loop artifacts.
const TYPHOON_SAMPLING = { temperature: 0.1, top_p: 0.6, repetition_penalty: 1.2 } as const;
const TYPHOON_MAX_TOKENS = 4096;

export type TyphoonOcrResult = { ok: true; text: string } | { ok: false; error: ProviderError };

/**
 * Single-provider Typhoon OCR client for receipt/tax-invoice extraction.
 * Owner decision 2026-07-03: no provider registry/fallback until evidence requires it.
 * Uses the OpenAI-compatible OpenTyphoon chat/completions API with an image data URI.
 */
export class TyphoonOcrClient {
  constructor(private readonly cfg: { apiKey: string; timeoutMs: number }) {}

  async extract(input: { mimeType: 'image/jpeg' | 'image/png'; contentBase64: string; prompt: string }): Promise<TyphoonOcrResult> {
    try {
      const response = await fetch(`${TYPHOON_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: TYPHOON_MODEL,
          max_tokens: TYPHOON_MAX_TOKENS,
          ...TYPHOON_SAMPLING,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: input.prompt },
                { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${input.contentBase64}` } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });

      if (!response.ok) {
        return { ok: false, error: this.mapHttpError(response.status) };
      }

      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = payload.choices?.[0]?.message?.content ?? '';
      if (!text.trim()) {
        return { ok: false, error: { code: 'PROVIDER_UNKNOWN', message: 'Typhoon OCR returned empty output.', retryable: false } };
      }
      return { ok: true, text };
    } catch (err) {
      const name = (err as { name?: string })?.name ?? '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        return { ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'Typhoon OCR request timed out.', retryable: true } };
      }
      return { ok: false, error: { code: 'PROVIDER_UNKNOWN', message: 'Typhoon OCR request failed.', retryable: false } };
    }
  }

  private mapHttpError(status: number): ProviderError {
    if (status === 401 || status === 403) {
      return { code: 'PROVIDER_ACCESS_NOT_READY', message: 'Typhoon OCR rejected the API key.', retryable: false };
    }
    if (status === 429) {
      return { code: 'PROVIDER_THROTTLED', message: 'Typhoon OCR rate limit reached.', retryable: true };
    }
    return { code: 'PROVIDER_UNKNOWN', message: `Typhoon OCR HTTP ${status}.`, retryable: status >= 500 };
  }
}
