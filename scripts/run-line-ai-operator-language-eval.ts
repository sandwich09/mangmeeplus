#!/usr/bin/env tsx
/** Real-provider semantic-router evaluation. No API, DB, ERP, LINE, or mutation tool is used. */
import { IntentRouterAgent } from '../apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent';
import { createProvider } from '../apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.factory';
import { LINE_AI_ALL_OPERATOR_CASES, type OperatorAvailabilityCase, type OperatorLanguageCase } from './line-ai-operator-language.corpus';

function csv(name: string): string[] | undefined {
  const value = process.env[name]?.trim();
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : undefined;
}

const config = {
  modelProvider: process.env['MODEL_PROVIDER'] ?? 'bedrock',
  bedrockRegion: process.env['BEDROCK_REGION'],
  bedrockModelId: process.env['BEDROCK_MODEL_ID'],
  openAiApiKey: process.env['OPENAI_API_KEY'],
  openAiModel: process.env['OPENAI_MODEL'] ?? 'gpt-4.1-mini',
  openAiProcessingRegion: process.env['OPENAI_PROCESSING_REGION'],
  aiToolTimeoutMs: Number(process.env['AI_TOOL_TIMEOUT_MS'] ?? '25000'),
  approvedAiProviders: csv('APPROVED_AI_PROVIDERS'),
  approvedAiModelIds: csv('APPROVED_AI_MODEL_IDS'),
  approvedAiRegions: csv('APPROVED_AI_REGIONS'),
} as any;

const requestedLimit = Number(process.env['LINE_AI_EVAL_LIMIT'] ?? LINE_AI_ALL_OPERATOR_CASES.length);
const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
  ? Math.min(requestedLimit, LINE_AI_ALL_OPERATOR_CASES.length)
  : LINE_AI_ALL_OPERATOR_CASES.length;
const requestedConcurrency = Number(process.env['LINE_AI_EVAL_CONCURRENCY'] ?? '3');
const concurrency = Number.isInteger(requestedConcurrency)
  ? Math.max(1, Math.min(requestedConcurrency, 8))
  : 3;
const selected = LINE_AI_ALL_OPERATOR_CASES.slice(0, limit);

type EvaluationCase = OperatorLanguageCase | OperatorAvailabilityCase;

type Evaluation = {
  id: string;
  category: EvaluationCase['category'];
  expectedTools: string[];
  plannedTools: string[];
  forbiddenTools: string[];
  durationMs: number;
  passed: boolean;
  reason?: string;
};

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function evaluate(testCase: EvaluationCase, plannedTools: string[], durationMs: number, planStatus: 'ROUTABLE' | 'PARTIAL' | 'UNROUTABLE'): Evaluation {
  const planned = [...new Set(plannedTools)].sort();
  const expected = [...new Set(testCase.expectedTools)].sort();
  const missing = difference(expected, planned);
  const unexpected = difference(planned, expected);
  const forbidden = planned.filter((tool) => testCase.forbiddenTools.includes(tool));
  // This script evaluates routing only. Feature/permission truth is injected and asserted by the
  // full local replay; before that boundary every supported availability case is still routable.
  const expectedStatus = 'accessMode' in testCase
    ? ['tool_unavailable', 'unsupported_module'].includes(testCase.accessMode) ? 'UNROUTABLE' : 'ROUTABLE'
    : 'ROUTABLE';
  const reasons = [
    ...(planStatus !== expectedStatus ? [`status=${planStatus},expected=${expectedStatus}`] : []),
    ...(missing.length ? [`missing=${missing.join(',')}`] : []),
    ...(unexpected.length ? [`unexpected=${unexpected.join(',')}`] : []),
    ...(forbidden.length ? [`forbidden=${forbidden.join(',')}`] : []),
  ];
  return {
    id: testCase.id,
    category: testCase.category,
    expectedTools: expected,
    plannedTools: planned,
    forbiddenTools: testCase.forbiddenTools,
    durationMs,
    passed: reasons.length === 0,
    ...(reasons.length ? { reason: reasons.join(';') } : {}),
  };
}

void (async () => {
  if (selected.length < 100 && !process.env['LINE_AI_EVAL_LIMIT']) {
    throw new Error(`CORPUS_BELOW_REQUIRED_MINIMUM:${selected.length}`);
  }
  const router = new IntentRouterAgent(createProvider(config));
  const results = new Array<Evaluation>(selected.length);
  const startedAt = Date.now();

  // One preflight prevents a missing credential/network path from being mistaken for hundreds
  // of language failures (and avoids repeating the same unavailable provider call).
  const preflightStartedAt = Date.now();
  const preflightPlan = await router.route(selected[0]!.message);
  if (preflightPlan.refusals.some((refusal) => refusal.reason === 'tool_unavailable')) {
    throw new Error('PROVIDER_UNAVAILABLE');
  }
  results[0] = evaluate(
    selected[0]!,
    preflightPlan.intents.flatMap((intent) => intent.requiredTools),
    Date.now() - preflightStartedAt,
    preflightPlan.status,
  );
  let nextIndex = 1;

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(0, selected.length - 1)) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const testCase = selected[index];
      if (!testCase) return;
      const caseStartedAt = Date.now();
      const plan = await router.route(testCase.message);
      const plannedTools = plan.intents.flatMap((intent) => intent.requiredTools);
      results[index] = evaluate(testCase, plannedTools, Date.now() - caseStartedAt, plan.status);
    }
  }));

  const failures = results.filter((result) => !result.passed);
  const categoryCounts = Object.fromEntries([...new Set(results.map(({ category }) => category))].map((category) => {
    const categoryResults = results.filter((result) => result.category === category);
    return [category, {
      total: categoryResults.length,
      passed: categoryResults.filter((result) => result.passed).length,
      failed: categoryResults.filter((result) => !result.passed).length,
    }];
  }));
  console.log(JSON.stringify({
    event: 'line_ai_operator_language_eval_complete',
    provider: config.modelProvider,
    model: config.modelProvider === 'bedrock' ? config.bedrockModelId : config.openAiModel,
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    concurrency,
    durationMs: Date.now() - startedAt,
    categoryCounts,
    failures,
  }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
})().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : 'UNKNOWN';
  console.error(JSON.stringify({ event: 'line_ai_operator_language_eval_failed', errorCode: detail.split(':')[0], detail }));
  process.exitCode = 1;
});
