#!/usr/bin/env tsx
/** Real-provider semantic-router evaluation. No API, DB, ERP, LINE, or mutation tool is used. */
import { fileURLToPath } from 'node:url';
import type { LineIntakeRouteIntent, LineIntakeRoutePlan, LineIntakeRouteRequest } from '@watchdog-bms/contracts';
import { IntentRouterAgent } from '../apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent';
import { createProvider } from '../apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.factory';
import { LINE_AI_ALL_OPERATOR_CASES, type OperatorAvailabilityCase, type OperatorLanguageCase } from './line-ai-operator-language.corpus';
import { LINE_AI_SEMANTIC_COVERAGE_CASES, LINE_AI_SUBSTITUTE_ROUTING_CORPUS, type SubstituteRouteCase } from './line-ai-substitute-routing.corpus';

/** Which replayed rows also belong to the uat-correctness-latency §14.1 semantic dataset, so the report
 *  says how much of it the provider actually scored (outage-only rows are skipped for everyone). */
const semanticCoverageIds = new Set(LINE_AI_SEMANTIC_COVERAGE_CASES.map(({ id }) => id));

/**
 * The intake-route request the SUBSTITUTE provider pass replays for one corpus row. The substitute and
 * reimbursement semantic routes exist ONLY under their trusted capabilities: without `substituteSemantic:
 * true` the gateway runs the EXACT legacy prompt (no SUBSTITUTE_RECEIPT_CONTINUATION route) AND strips
 * substituteContext from the payload, and without `reimbursementSemantic: true` REIMBURSEMENT_REQUEST_START
 * is neither offered by the prompt nor accepted by the parser (it fails closed to UNAVAILABLE) and no
 * semanticOutcome/fundingSource is produced at all. Either one missing makes the rows that pin those routes
 * unroutable and the agreement evidence FALSE. Sending BOTH literal capability trues (and the bounded
 * server-derived context) is what makes this pass a faithful replay of the PRIMARY dispatch. Never sent by
 * the plan-route (`router.route`) operator-language pass, which is unchanged.
 */
export function buildSubstituteRouteRequest(testCase: SubstituteRouteCase): LineIntakeRouteRequest {
  return {
    requestId: `sub-${testCase.id}`, companyId: 'eval', userId: 'eval',
    locale: testCase.language === 'en' ? 'en-US' : 'th-TH', messageText: testCase.message,
    permissions: ['expense.review'],
    capabilities: { substituteSemantic: true, reimbursementSemantic: true },
    substituteContext: {
      workflowState: testCase.openSubstitute ? 'open' : 'none',
      hasPendingQuestion: testCase.openSubstitute, preparedState: testCase.openSubstitute ? 'in_progress' : 'none',
      recentCandidateCount: 1,
    },
  };
}

export type SubstituteRowScore = {
  scoringBasis: 'expected_intent' | 'not_substitute' | 'not_command';
  passed: boolean;
  reason: string;
};

/**
 * Categories whose EXACT route the uat-correctness-latency contract itself pins (spec §7.2 table, §16
 * acceptance): a claim start, a claim status read, and an ordinary company spend note. Scoring these by
 * "anything but substitute" would keep passing the two defects this work exists to close — a claim
 * answered as expense capture, and a spend note answered as a claim.
 */
const EXACT_ROUTE_CATEGORIES: ReadonlySet<SubstituteRouteCase['category']> = new Set<SubstituteRouteCase['category']>([
  'reimbursement', 'reimbursement_read', 'ordinary_expense', 'unrelated_expense',
]);

/** Routes that START or MUTATE something; §16 requires every question/negation/out-of-scope row to create
 *  zero records, and §7.2 gives each of those categories a safe route of "clarify / document-specific /
 *  unsupported" rather than ONE route. So the basis below asserts strictly LESS than an exact pin (the
 *  answer may be any safe route) while still catching the failure not-substitute would let through. */
const COMMAND_INTENTS: ReadonlySet<LineIntakeRouteIntent> = new Set<LineIntakeRouteIntent>([
  'EXPENSE_DOCUMENT_CAPTURE', 'EXPENSE_DRAFT_CONTINUATION', 'EXPENSE_CAPTURE_CORRECTION',
  'SUBSTITUTE_RECEIPT_CONTINUATION', 'REIMBURSEMENT_REQUEST_START',
]);
const NOT_COMMAND_CATEGORIES: ReadonlySet<SubstituteRouteCase['category']> = new Set<SubstituteRouteCase['category']>([
  'question_not_command', 'claim_negation', 'stock_withdrawal', 'advance',
]);

/**
 * The server's OPERATIONAL route contract, mirrored here so the replay cannot report agreement for an
 * answer the dispatcher would reject. `isSemanticContradiction` (intent-router.agent.ts) rewrites an
 * EXPENSE_DOCUMENT_CAPTURE whose pair is not exactly BUSINESS_EXPENSE + COMPANY_PAID into a CLARIFY with
 * the capture hints stripped — so capture + UNKNOWN is not "a capture with a weak label", it is a
 * different outcome for the user. The pair classifies the expense room; it is NOT evidence about who
 * really paid, and it licenses no reimbursement or approver decision.
 */
function requiredSemanticPair(testCase: SubstituteRouteCase): {
  outcome?: SubstituteRouteCase['expectedSemanticOutcome'];
  funding?: SubstituteRouteCase['expectedFundingSource'];
} {
  if (testCase.expectedIntent === 'EXPENSE_DOCUMENT_CAPTURE') {
    return { outcome: 'BUSINESS_EXPENSE', funding: 'COMPANY_PAID' };
  }
  return { outcome: testCase.expectedSemanticOutcome, funding: testCase.expectedFundingSource };
}

/**
 * Score ONE replayed substitute-corpus row.
 *  - `reimbursement` and the other EXACT_ROUTE_CATEGORIES are protected negatives RELATIVE TO SUBSTITUTE
 *    ONLY: they own an exact route the feature contract pins, so they are scored by the pinned intent plus
 *    the required semantic pair (the fail-closed AMBIGUOUS/UNKNOWN pair, the strong EMPLOYEE_PAID pair, or
 *    the BUSINESS_EXPENSE/COMPANY_PAID capture contract — never an invented one).
 *  - NOT_COMMAND_CATEGORIES are scored by "the router did not turn a question / negation / stock or
 *    advance request into a command", the strongest claim §7.2 actually licenses for them.
 *  - every other protected negative keeps the not-substitute basis: any safe route (CLARIFY,
 *    MUTATION_REQUEST_REFUSAL, a read, a capture) is acceptable.
 *  - every remaining row is scored against its pinned expected intent, as before.
 * No basis observes a domain mutation: this pass replays routing only.
 */
export function scoreSubstituteRow(
  testCase: SubstituteRouteCase,
  plan: Pick<LineIntakeRoutePlan, 'intent' | 'semanticOutcome' | 'fundingSource'>,
): SubstituteRowScore {
  if (testCase.protectedNegative && NOT_COMMAND_CATEGORIES.has(testCase.category)) {
    return {
      scoringBasis: 'not_command',
      passed: !COMMAND_INTENTS.has(plan.intent),
      reason: `intent=${plan.intent},mustNotStartOrMutate`,
    };
  }
  if (testCase.protectedNegative && !EXACT_ROUTE_CATEGORIES.has(testCase.category)) {
    return {
      scoringBasis: 'not_substitute',
      passed: plan.intent !== 'SUBSTITUTE_RECEIPT_CONTINUATION',
      reason: `intent=${plan.intent},mustNotBe=SUBSTITUTE_RECEIPT_CONTINUATION`,
    };
  }
  const required = requiredSemanticPair(testCase);
  const mismatches = [
    ...(plan.intent !== testCase.expectedIntent ? [`intent=${plan.intent},expected=${testCase.expectedIntent}`] : []),
    ...(required.outcome && plan.semanticOutcome !== required.outcome
      ? [`semanticOutcome=${plan.semanticOutcome},expected=${required.outcome}`] : []),
    ...(required.funding && plan.fundingSource !== required.funding
      ? [`fundingSource=${plan.fundingSource},expected=${required.funding}`] : []),
  ];
  return {
    scoringBasis: 'expected_intent',
    passed: mismatches.length === 0,
    reason: mismatches.length ? mismatches.join(';') : `intent=${plan.intent},expected=${testCase.expectedIntent}`,
  };
}

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

async function main() {
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

  // Substitute-routing pass (SAME runner/provider framework): route each provider-eligible protected
  // substitute case through the REAL routeIntake with its bounded server-derived context. Scoring basis:
  //  - `unavailable` rows model a provider OUTAGE (expected UNSUPPORTED). A HEALTHY provider cannot
  //    reproduce that, so they are NOT provider-scored here — they are SKIPPED (structural/unit coverage
  //    retains them) to avoid a spurious failure.
  //  - reimbursement/read/ordinary-expense rows are scored by their pinned route AND semantic pair, and
  //    question/negation/stock/advance rows by "never a command route" (see scoreSubstituteRow); the
  //    other protected negatives keep the "never SUBSTITUTE" basis.
  //  - every other provider-eligible row is scored against its pinned expected intent.
  // The uat-correctness-latency §14.1 semantic dataset rides this same pass (it is a subset of the same
  // corpus). Absent provider credentials the whole runner is unavailable, so this evidence stays pending.
  const substituteResults = [] as Array<{ id: string; category: string; scoringBasis: SubstituteRowScore['scoringBasis']; expectedIntent: string; actualIntent: string; passed: boolean; reason?: string }>;
  const substituteSkipped = [] as string[];
  for (const testCase of LINE_AI_SUBSTITUTE_ROUTING_CORPUS) {
    if (testCase.category === 'unavailable') { substituteSkipped.push(testCase.id); continue; }
    const plan = await router.routeIntake(buildSubstituteRouteRequest(testCase));
    const { scoringBasis, passed, reason } = scoreSubstituteRow(testCase, plan);
    substituteResults.push({ id: testCase.id, category: testCase.category, scoringBasis, expectedIntent: testCase.expectedIntent, actualIntent: plan.intent, passed, ...(passed ? {} : { reason }) });
  }
  const substituteFailures = substituteResults.filter((result) => !result.passed);

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
    substitute: {
      corpusTotal: LINE_AI_SUBSTITUTE_ROUTING_CORPUS.length,
      scored: substituteResults.length,
      skippedOutageOnly: substituteSkipped.length,
      skippedIds: substituteSkipped,
      passed: substituteResults.length - substituteFailures.length,
      failed: substituteFailures.length,
      scoredByExpectedIntent: substituteResults.filter((r) => r.scoringBasis === 'expected_intent').length,
      scoredByNotSubstitute: substituteResults.filter((r) => r.scoringBasis === 'not_substitute').length,
      scoredByNotCommand: substituteResults.filter((r) => r.scoringBasis === 'not_command').length,
      semanticCoverageScored: substituteResults.filter((r) => semanticCoverageIds.has(r.id)).length,
      failures: substituteFailures,
    },
  }, null, 2));
  if (failures.length > 0 || substituteFailures.length > 0) process.exitCode = 1;
}

// Run only when executed directly (tsx scripts/run-…​.ts); importing the module for tests must NOT replay.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : 'UNKNOWN';
    console.error(JSON.stringify({ event: 'line_ai_operator_language_eval_failed', errorCode: detail.split(':')[0], detail }));
    process.exitCode = 1;
  });
}
