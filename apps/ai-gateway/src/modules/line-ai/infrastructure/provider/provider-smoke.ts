#!/usr/bin/env tsx
/**
 * Provider smoke script – proves a real model call works before production deploy.
 * Standalone (no NestJS). Run with tsx directly; never run in CI.
 *
 * Usage:
 *   MODEL_PROVIDER=disabled  tsx provider-smoke.ts
 *   MODEL_PROVIDER=bedrock   AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
 *     BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
 *     AI_TOOL_TIMEOUT_MS=15000 tsx provider-smoke.ts
 *   MODEL_PROVIDER=openai    OPENAI_API_KEY=<key> OPENAI_MODEL=gpt-4.1-mini \
 *     tsx provider-smoke.ts
 *
 * Output: JSON line with { ok, provider, durationMs, errorCode?, text? }
 * Prompt text is redacted unless AI_PROMPT_LOGGING_ENABLED=true.
 */

import { createProvider } from './provider.factory';
import type { AiGatewayConfigService } from '../../../../common/config/ai-gateway-config.service';
import { OpenAiProvider } from './openai.provider';
import { DisabledProvider } from './disabled.provider';
import type { IModelProvider } from './provider.port';

const provider = process.env['MODEL_PROVIDER'] ?? 'disabled';
const region = process.env['BEDROCK_REGION'];
const modelId = process.env['BEDROCK_MODEL_ID'];
const openAiKey = process.env['OPENAI_API_KEY'];
const openAiModel = process.env['OPENAI_MODEL'] ?? 'gpt-4.1-mini';
const timeoutMs = Number(process.env['AI_TOOL_TIMEOUT_MS'] ?? '15000');
const showPrompt = process.env['AI_PROMPT_LOGGING_ENABLED'] === 'true';

// ponytail: minimal Thai query; one-word answer keeps cost/latency low for smoke
const TEST_MESSAGE = 'ตอบด้วยคำเดียวในภาษาไทย: ยืนยัน';

function buildProvider(): IModelProvider {
  if (provider === 'bedrock') {
    if (!region || !modelId) {
      console.error('Bedrock smoke requires BEDROCK_REGION and BEDROCK_MODEL_ID');
      process.exit(2);
    }
    return createProvider({
      appEnv: process.env['APP_ENV'], anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
      modelProvider: provider, bedrockRegion: region, bedrockModelId: modelId, aiToolTimeoutMs: timeoutMs,
    } as AiGatewayConfigService);
  }
  if (provider === 'openai') {
    if (!openAiKey) {
      console.error('OpenAI smoke requires OPENAI_API_KEY');
      process.exit(2);
    }
    return new OpenAiProvider({ apiKey: openAiKey, model: openAiModel, timeoutMs });
  }
  return new DisabledProvider();
}

void (async () => {
  const p = buildProvider();
  const start = Date.now();
  const result = await p.generateText({
    messages: [{ role: 'user', text: TEST_MESSAGE }],
    maxTokens: 64,
  });
  const durationMs = Date.now() - start;

  if (result.ok) {
    const text = showPrompt ? result.text : `[${result.text.length} chars – set AI_PROMPT_LOGGING_ENABLED=true to show]`;
    console.log(JSON.stringify({ ok: true, provider, durationMs, text }));
    process.exit(0);
  } else {
    console.error(JSON.stringify({ ok: false, provider, durationMs, errorCode: result.error.code, message: result.error.message, retryable: result.error.retryable }));
    process.exit(1);
  }
})();
