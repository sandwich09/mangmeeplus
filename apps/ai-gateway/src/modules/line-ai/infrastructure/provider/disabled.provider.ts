import type { IModelProvider, ProviderInput, ProviderOutput, ProviderToolsInput, ProviderToolsOutput } from './provider.port';

/** Returned when MODEL_PROVIDER=disabled; safe for local no-key runs. */
export class DisabledProvider implements IModelProvider {
  async generateText(_input: ProviderInput): Promise<ProviderOutput> {
    if (_input.outputSchema) return { ok: false, error: { code: 'PROVIDER_CONTRACT_UNSUPPORTED', message: 'Structured output is unsupported by this provider.', retryable: false } };
    return {
      ok: false,
      error: {
        code: 'PROVIDER_DISABLED',
        message: 'MODEL_PROVIDER=disabled – no AI model configured.',
        retryable: false,
      },
    };
  }

  async generateWithTools(_input: ProviderToolsInput): Promise<ProviderToolsOutput> {
    return {
      ok: false,
      error: {
        code: 'PROVIDER_DISABLED',
        message: 'MODEL_PROVIDER=disabled – no AI model configured.',
        retryable: false,
      },
    };
  }
}
