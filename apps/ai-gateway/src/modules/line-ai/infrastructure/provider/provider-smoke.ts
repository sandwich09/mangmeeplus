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
import { validateProviderStructuredText } from './provider-output.logic';
import { drainUsage, runWithUsageContext } from '../../../../common/usage/usage-context';

const provider = process.env['MODEL_PROVIDER'] ?? 'disabled';
const region = process.env['BEDROCK_REGION'];
const modelId = process.env['BEDROCK_MODEL_ID'];
const openAiKey = process.env['OPENAI_API_KEY'];
const openAiModel = process.env['OPENAI_MODEL'] ?? 'gpt-4.1-mini';
const timeoutMs = Number(process.env['AI_TOOL_TIMEOUT_MS'] ?? '15000');
const showPrompt = process.env['AI_PROMPT_LOGGING_ENABLED'] === 'true';
const probeOutputSchema = process.env['PROVIDER_SMOKE_OUTPUT_SCHEMA'] === '1';

const CLASSIFIER_LABELS = ['reimbursement_claim', 'reimbursement_submit', 'reimbursement_cancel', 'approvals',
  'reimbursement_reject', 'reimbursement_pay', 'expense_submit', 'expense_confirm', 'expense_delete', 'expense_void',
  'expense_pay', 'payment_voucher', 'wht_certificate', 'substitute_receipt', 'read', 'howto', 'open', 'smalltalk', 'multi', 'unclear'];
const CLASSIFIER_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['label', 'second_label', 'confidence', 'second_confidence', 'reference', 'ordinal', 'person_name', 'vendor_name',
    'description_text', 'amount_text', 'date_text', 'reason_text', 'category_text'],
  properties: {
    label: { type: 'string', enum: CLASSIFIER_LABELS }, second_label: { type: 'string', enum: [...CLASSIFIER_LABELS, 'none'] },
    confidence: { type: 'number' }, second_confidence: { type: 'number' },
    reference: { type: 'string', enum: ['this', 'last_shown', 'named', 'none'] }, ordinal: { type: 'integer' },
    person_name: { type: 'string' }, vendor_name: { type: 'string' }, description_text: { type: 'string' },
    amount_text: { type: 'string' }, date_text: { type: 'string' }, reason_text: { type: 'string' }, category_text: { type: 'string' },
  },
};

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
  const call = () => p.generateText({
    messages: [{ role: 'user', text: probeOutputSchema ? 'ส่งใบเบิกของฉันให้อนุมัติหน่อย' : TEST_MESSAGE }],
    maxTokens: probeOutputSchema ? 256 : 64,
    ...(probeOutputSchema ? { outputSchema: { name: 'line_workflow_classifier', schema: CLASSIFIER_SCHEMA } } : {}),
  });
  const { result, usage } = probeOutputSchema
    ? await runWithUsageContext({}, async () => ({ result: await call(), usage: drainUsage() }))
    : { result: await call(), usage: [] };
  const durationMs = Date.now() - start;

  if (probeOutputSchema) {
    const validJson = result.ok && validateProviderStructuredText(result.text, CLASSIFIER_SCHEMA);
    console.log(JSON.stringify({ ok: result.ok, provider, schemaEnforcement: result.ok ? result.schemaEnforcement ?? null : null,
      validJson, durationMs, usage, ...(!result.ok ? { errorCode: result.error.code } : {}) }));
    process.exit(result.ok && validJson ? 0 : 1);
  }

  if (result.ok) {
    const text = showPrompt ? result.text : `[${result.text.length} chars – set AI_PROMPT_LOGGING_ENABLED=true to show]`;
    console.log(JSON.stringify({ ok: true, provider, durationMs, text }));
    process.exit(0);
  } else {
    console.error(JSON.stringify({ ok: false, provider, durationMs, errorCode: result.error.code, message: result.error.message, retryable: result.error.retryable }));
    process.exit(1);
  }
})();
