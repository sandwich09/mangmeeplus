import type { IModelProvider, ProviderInput, ProviderOutput, ProviderToolsInput, ProviderToolsOutput } from './provider.port';

/** Returned when MODEL_PROVIDER=disabled; safe for local no-key runs. */
export class DisabledProvider implements IModelProvider {
  async generateText(_input: ProviderInput): Promise<ProviderOutput> {
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
