import type { LlmDraftPort } from './llm-draft.port';
import { FakeLlmDraftProvider } from './fake-llm-draft.provider';
import { DisabledLlmDraftProvider } from './disabled-llm-draft.provider';
import { AiGatewayDraftProvider } from './ai-gateway-draft.provider';

// Select the draft provider from env. Production authors suggestions with the model via
// the AI Gateway (Bedrock). The deterministic fake provider is test/CI only. When neither
// is configured, generation is provider-unavailable (never canned product content).
//
//   AI_DRAFT_PROVIDER=gateway  -> AI Gateway (Bedrock) — production
//   AI_DRAFT_PROVIDER=fake     -> deterministic fake — tests/CI/demo
//   AI_DRAFT_PROVIDER=disabled -> provider-unavailable
//   (unset)                    -> gateway if AI_GATEWAY_URL+secret present, else disabled
export function createLlmDraftProvider(env: NodeJS.ProcessEnv = process.env): LlmDraftPort {
  const mode = env['AI_DRAFT_PROVIDER'];
  const gatewayUrl = env['AI_GATEWAY_URL'] ?? env['AI_GATEWAY_INTERNAL_URL'] ?? '';
  const secret = env['AI_GATEWAY_INTERNAL_SECRET'] ?? '';
  const gateway = () => new AiGatewayDraftProvider(gatewayUrl, secret);

  if (mode === 'fake') return new FakeLlmDraftProvider();
  if (mode === 'disabled') return new DisabledLlmDraftProvider();
  if (mode === 'gateway' || mode === 'bedrock') return gateway();
  // Default: use the gateway when it is configured, otherwise stay disabled.
  if (gatewayUrl && secret) return gateway();
  return new DisabledLlmDraftProvider();
}
