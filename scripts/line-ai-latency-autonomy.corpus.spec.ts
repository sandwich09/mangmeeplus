import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_TOOL_REGISTRY } from '@watchdog-bms/contracts';
import { LINE_AI_SUBSTITUTE_ROUTING_CORPUS } from './line-ai-substitute-routing.corpus';
import { nextFlushDelayMs } from '../apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic';
import {
  LINE_AI_BUFFER_MAX_WAIT_MS,
  LINE_AI_CONTROLLED_ATTACHMENT_REQUIREMENTS,
  LINE_AI_DEBOUNCE_CANDIDATES_MS,
  LINE_AI_DEBOUNCE_EVAL_CASES,
  LINE_AI_DEBOUNCE_EXPERIMENT_REQUIREMENTS,
  LINE_AI_DEBOUNCE_OFFLINE_FLOOR_MS,
  LINE_AI_IMPLEMENTED_DEBOUNCE_MS,
  LINE_AI_LATENCY_AUTONOMY_EVAL_CASES,
  LINE_AI_LATENCY_AUTONOMY_CONTEXT_FIXTURES,
  LINE_AI_LATENCY_SLOS_MS,
  LINE_AI_PREPARED_PLAN_POLICY,
  LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES,
  LINE_AI_PROTECTED_EVAL_CASE_IDS,
  LINE_AI_PROTECTED_JOURNEY_GROUPS,
  LINE_AI_PROVIDER_EVAL_REQUIREMENTS,
  LINE_AI_ROLLOUT_GATES,
  type LatencyAutonomyLane,
  type PreparedPlanSecurityEvalCase,
} from './line-ai-latency-autonomy.corpus';

/** Integrity oracle only: replays a subset of timing/segmentation semantics; service tests remain authoritative. */
function simulateDebounce(testCase: (typeof LINE_AI_DEBOUNCE_EVAL_CASES)[number]) {
  const batches: typeof testCase.events[] = [];
  const flushTimes: number[] = [];
  let open: typeof testCase.events = [];
  let firstAt = 0;
  let scheduledAt: number | null = null;

  const flush = (atMs: number) => {
    if (open.length > 0) {
      batches.push(open);
      flushTimes.push(atMs);
    }
    open = [];
    scheduledAt = null;
  };

  for (const event of testCase.events) {
    if (scheduledAt !== null && scheduledAt < event.atMs) flush(scheduledAt);
    const idleCommand = event.kind === 'command' && open.length === 0;
    if (open.length === 0) firstAt = event.atMs;
    open.push(event);
    if (event.kind === 'command' || idleCommand) {
      scheduledAt = event.atMs;
      flush(event.atMs);
      continue;
    }
    scheduledAt = event.atMs + nextFlushDelayMs(firstAt, event.atMs, {
      debounceMs: testCase.debounceMs,
      maxWaitMs: testCase.maxWaitMs,
    });
  }
  if (open.length > 0) flush(scheduledAt ?? testCase.events.at(-1)!.atMs);

  const groups = batches.flatMap((batch) => {
    const result: string[] = [];
    let content: typeof testCase.events = [];
    const closeContent = () => {
      if (content.length > 0) {
        const hasMedia = content.some(({ kind }) => kind === 'image');
        const segmentText = content
          .filter(({ kind }) => !hasMedia || kind === 'text')
          .map(({ text }) => text)
          .join('\n');
        const segmentCount = hasMedia ? content.filter(({ kind }) => kind === 'image').length : 1;
        result.push(...Array.from({ length: segmentCount }, () => segmentText));
      }
      content = [];
    };
    for (const event of batch) {
      if (event.kind === 'command') {
        closeContent();
        result.push(event.text);
      } else {
        content.push(event);
      }
    }
    closeContent();
    return result;
  });

  return {
    batchCount: batches.length,
    firstFlushAtMs: flushTimes[0],
    groups,
  };
}

describe('LINE AI latency/autonomy eval corpus', () => {
  it('covers every protected lane with stable machine-readable expectations', () => {
    assert.equal(LINE_AI_LATENCY_AUTONOMY_EVAL_CASES.length, 103);
    assert.equal(
      new Set(LINE_AI_LATENCY_AUTONOMY_EVAL_CASES.map(({ id }) => id)).size,
      LINE_AI_LATENCY_AUTONOMY_EVAL_CASES.length,
    );
    const lanes = new Set(LINE_AI_LATENCY_AUTONOMY_EVAL_CASES.map(({ expectedLane }) => expectedLane));
    const requiredLanes: LatencyAutonomyLane[] = [
      'zero_model', 'casual', 'capability_help', 'simple_read',
      'complex_agentic', 'clarification', 'document_capture', 'semantic_refusal',
    ];
    for (const required of requiredLanes) {
      assert.ok(lanes.has(required), `missing ${required} lane`);
    }
    assert.ok(LINE_AI_LATENCY_AUTONOMY_EVAL_CASES.some(({ language }) => language === 'th'));
    assert.ok(LINE_AI_LATENCY_AUTONOMY_EVAL_CASES.some(({ language }) => language === 'en'));
    assert.equal(LINE_AI_LATENCY_SLOS_MS.loadingRequestAcceptedP95, 1_000);
    assert.equal(LINE_AI_LATENCY_SLOS_MS.simpleReadFinalP95, 8_000);
    assert.equal(LINE_AI_ROLLOUT_GATES.groundedAccuracyAbsoluteRegressionPercentagePoints, 1);
    assert.equal(LINE_AI_ROLLOUT_GATES.protectedJourneyLatencyOrCostRelativeRegression, 0.10);
    assert.equal(LINE_AI_ROLLOUT_GATES.fixedFullFlowFixturePassRate, 1);
    assert.equal(LINE_AI_ROLLOUT_GATES.blindPairwisePreferenceLowerBound, 0.50);
    assert.ok(LINE_AI_ROLLOUT_GATES.blindPairwiseMinimumRatingsPerRow >= 3);
    assert.equal(LINE_AI_ROLLOUT_GATES.blindPairwiseMinimumRatingsPerLanguageFamilyStratum, 30);
    assert.ok(LINE_AI_PROTECTED_JOURNEY_GROUPS.length >= 7);
    assert.equal(new Set(LINE_AI_PROTECTED_JOURNEY_GROUPS).size, LINE_AI_PROTECTED_JOURNEY_GROUPS.length);
    assert.equal(LINE_AI_PROVIDER_EVAL_REQUIREMENTS.nonAttachmentRouteRows, 96);
    assert.equal(LINE_AI_PROVIDER_EVAL_REQUIREMENTS.attachmentRouteRows, 7);
    assert.equal(LINE_AI_PROVIDER_EVAL_REQUIREMENTS.attachmentRowsRunnableOnExistingHarness, 3);
    assert.equal(LINE_AI_PROVIDER_EVAL_REQUIREMENTS.attachmentRowsBlockedOnHarnessExtension, 4);
    assert.equal(LINE_AI_PROVIDER_EVAL_REQUIREMENTS.requireEveryRouteRow, true);

    const registered = new Set(LINE_TOOL_REGISTRY.map(({ name }) => name));
    for (const testCase of LINE_AI_LATENCY_AUTONOMY_EVAL_CASES) {
      assert.ok(testCase.message.trim(), `${testCase.id} needs a message`);
      assert.ok(testCase.maxModelCalls === null || testCase.maxModelCalls >= 0, `${testCase.id} has an invalid model budget`);
      assert.ok(testCase.requiredPolicies && testCase.requiredPolicies.length > 0, `${testCase.id} needs answer-policy assertions`);
      assert.equal(new Set(testCase.expectedTools).size, testCase.expectedTools.length, `${testCase.id} repeats expected tools`);
      assert.ok(testCase.expectedTools.every((tool) => registered.has(tool)), `${testCase.id} expects an unknown tool`);
      assert.ok(testCase.forbiddenTools.every((tool) => registered.has(tool)), `${testCase.id} forbids an unknown tool`);
      assert.ok(testCase.expectedTools.every((tool) => !testCase.forbiddenTools.includes(tool)), `${testCase.id} expects and forbids ${testCase.expectedTools}`);
      if (testCase.expectedTools.length === 0) assert.equal(testCase.expectedToolCallCount, 0, `${testCase.id} must not call an ERP tool`);
      if (testCase.expectedLane === 'zero_model') assert.equal(testCase.maxModelCalls, 0, testCase.id);
      if (testCase.expectedLane === 'casual') assert.equal(testCase.expectedPreparedZeroToolIntent, 'casual_conversation', testCase.id);
      if (testCase.expectedLane === 'capability_help') assert.equal(testCase.expectedPreparedZeroToolIntent, 'capability_help', testCase.id);
      if (testCase.expectedLane === 'simple_read') {
        assert.equal(testCase.expectedTools.length, 1, `${testCase.id} must have one tool`);
        assert.equal(testCase.expectedToolCallCount, 1, `${testCase.id} must call once`);
        assert.equal(testCase.maxModelCalls, 1, `${testCase.id} must use one model call`);
        assert.equal(testCase.expectsComposer, false, `${testCase.id} must skip composer`);
        assert.equal(testCase.expectsCritic, false, `${testCase.id} must skip critic`);
      }
      if (testCase.maxModelCalls === null) {
        assert.ok(['complex_agentic', 'document_capture'].includes(testCase.expectedLane), `${testCase.id} has no derived budget`);
      }
      if (testCase.expectedLane === 'complex_agentic') assert.ok((testCase.idealModelCalls ?? 0) > 0, `${testCase.id} needs an ideal call count`);
      if (testCase.expectedCalls) assert.equal(testCase.expectedCalls.length, testCase.expectedToolCallCount, `${testCase.id} ordered call count`);
    }

    assert.ok(LINE_AI_LATENCY_AUTONOMY_EVAL_CASES.some(({ precondition }) => precondition === 'permission_denied'));
    const contextFixtures = new Set(LINE_AI_LATENCY_AUTONOMY_CONTEXT_FIXTURES.map(({ id }) => id));
    assert.equal(contextFixtures.size, LINE_AI_LATENCY_AUTONOMY_CONTEXT_FIXTURES.length);
    for (const id of [
      'clarify-correction-target-th', 'clarify-bare-answer-th', 'clarify-product-which-th',
      'document-draft-answer-th', 'document-correction-th',
    ]) {
      const testCase = LINE_AI_LATENCY_AUTONOMY_EVAL_CASES.find((item) => item.id === id);
      assert.ok(testCase?.contextFixtureId, `${id} needs context`);
      assert.ok(contextFixtures.has(testCase.contextFixtureId), `${id} has unknown context`);
    }

    const attachmentRequirements = new Map(LINE_AI_CONTROLLED_ATTACHMENT_REQUIREMENTS.map((item) => [item.scenarioId, item]));
    const attachmentCases = LINE_AI_LATENCY_AUTONOMY_EVAL_CASES.filter(({ attachmentScenarioId }) => attachmentScenarioId);
    assert.equal(LINE_AI_LATENCY_AUTONOMY_EVAL_CASES.length - attachmentCases.length, LINE_AI_PROVIDER_EVAL_REQUIREMENTS.nonAttachmentRouteRows);
    assert.equal(attachmentCases.length, LINE_AI_PROVIDER_EVAL_REQUIREMENTS.attachmentRouteRows);
    assert.equal(
      attachmentCases.filter(({ attachmentScenarioId }) => attachmentRequirements.get(attachmentScenarioId!)?.harnessStatus === 'existing').length,
      LINE_AI_PROVIDER_EVAL_REQUIREMENTS.attachmentRowsRunnableOnExistingHarness,
    );
    assert.equal(
      attachmentCases.filter(({ attachmentScenarioId }) => attachmentRequirements.get(attachmentScenarioId!)?.harnessStatus === 'extension_required').length,
      LINE_AI_PROVIDER_EVAL_REQUIREMENTS.attachmentRowsBlockedOnHarnessExtension,
    );
    for (const testCase of attachmentCases) {
      const requirement = attachmentRequirements.get(testCase.attachmentScenarioId!);
      assert.ok(requirement, `${testCase.id} needs a controlled attachment requirement`);
      assert.equal(requirement.expectedIntakeIntent, testCase.expectedIntakeIntent, `${testCase.id} attachment intent`);
      assert.equal(requirement.sourceSha256Required, true, testCase.id);
      assert.equal(requirement.humanReviewRequired, true, testCase.id);
    }
  });

  it('pins the mandatory prepared-plan forgery, boundary, and source-honesty suite', () => {
    assert.equal(LINE_AI_PREPARED_PLAN_POLICY.version, 1);
    assert.equal(LINE_AI_PREPARED_PLAN_POLICY.simpleConfidenceVetoFloor, 0.85);
    assert.equal(LINE_AI_PREPARED_PLAN_POLICY.serverRecomputesConfidence, false);
    assert.equal(LINE_AI_PREPARED_PLAN_POLICY.confidenceCanGrantEligibility, false);
    assert.equal(LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES.length, 23);
    assert.equal(
      new Set(LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES.map(({ id }) => id)).size,
      LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES.length,
    );
    const threats = new Set(LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES.map(({ threat }) => threat));
    const requiredThreats: PreparedPlanSecurityEvalCase['threat'][] = [
      'permission', 'entitlement', 'tenant_scope', 'branch_scope', 'tool_scope',
      'mutation', 'delegation', 'bounds', 'input_shape', 'plan_version',
      'confidence', 'subject', 'source_honesty',
    ];
    for (const required of requiredThreats) {
      assert.ok(threats.has(required), `missing ${required} threat`);
    }
    for (const testCase of LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES) {
      assert.ok(testCase.mutation.trim(), `${testCase.id} needs a mutation`);
      if (!['explicit_empty', 'source_unavailable', 'honest_terminal', 'complex_coverage'].includes(testCase.expectedOutcome)) {
        assert.equal(testCase.expectedToolCallCount, 0, `${testCase.id} must fail before a tool call`);
      } else {
        assert.equal(testCase.expectedToolCallCount, 1, `${testCase.id} must exercise post-tool handling`);
      }
    }
    const highConfidenceForgery = LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES.find(({ id }) => id === 'prepared-high-confidence-no-authority');
    assert.equal(highConfidenceForgery?.expectedToolCallCount, 0);
    assert.ok(LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES.some(({ expectedOutcome }) => expectedOutcome === 'honest_terminal'));
    assert.ok(LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES.some(({ expectedOutcome }) => expectedOutcome === 'complex_coverage'));
  });

  it('pins the debounce control, candidates, boundaries, max-wait, command, media, and group cases', () => {
    assert.equal(LINE_AI_IMPLEMENTED_DEBOUNCE_MS, 2_500);
    assert.deepEqual(LINE_AI_DEBOUNCE_CANDIDATES_MS, [1_000, 1_500]);
    assert.equal(LINE_AI_DEBOUNCE_OFFLINE_FLOOR_MS, 750);
    assert.equal(LINE_AI_BUFFER_MAX_WAIT_MS, 8_000);
    assert.equal(LINE_AI_DEBOUNCE_EXPERIMENT_REQUIREMENTS.stableAssignmentScope, 'company_chat');
    assert.equal(LINE_AI_DEBOUNCE_EXPERIMENT_REQUIREMENTS.cohortCollection, 'concurrent');
    assert.equal(LINE_AI_DEBOUNCE_EXPERIMENT_REQUIREMENTS.controlMs, 2_500);
    assert.deepEqual(LINE_AI_DEBOUNCE_EXPERIMENT_REQUIREMENTS.selectionOrderMs, [1_000, 1_500]);
    assert.equal(LINE_AI_DEBOUNCE_EXPERIMENT_REQUIREMENTS.inferenceUnit, 'company_chat_cluster');
    assert.match(LINE_AI_DEBOUNCE_EXPERIMENT_REQUIREMENTS.intervalMethod, /cluster/);
    assert.match(LINE_AI_DEBOUNCE_EXPERIMENT_REQUIREMENTS.multiplicityMethod, /holm/);
    assert.equal(LINE_AI_DEBOUNCE_EXPERIMENT_REQUIREMENTS.designEffectAdjustedPower, true);
    assert.equal(LINE_AI_DEBOUNCE_EXPERIMENT_REQUIREMENTS.freezeLatencyAffectingFlags, true);
    assert.equal(LINE_AI_DEBOUNCE_EXPERIMENT_REQUIREMENTS.confidenceLevel, 0.95);
    assert.equal(LINE_AI_DEBOUNCE_EXPERIMENT_REQUIREMENTS.minimumPower, 0.80);
    assert.ok(LINE_AI_DEBOUNCE_EXPERIMENT_REQUIREMENTS.minimumAcceptedIntentsPerCohort >= 10_000);
    assert.ok(LINE_AI_DEBOUNCE_EXPERIMENT_REQUIREMENTS.minimumDurationDays >= 14);
    assert.equal(LINE_AI_DEBOUNCE_EVAL_CASES.length, 38);
    assert.equal(new Set(LINE_AI_DEBOUNCE_EVAL_CASES.map(({ id }) => id)).size, LINE_AI_DEBOUNCE_EVAL_CASES.length);

    const ids = new Set(LINE_AI_DEBOUNCE_EVAL_CASES.map(({ id }) => id));
    for (const debounceMs of [750, 1_000, 1_500, 2_500]) {
      for (const scenario of ['single', 'inside-boundary', 'exact-boundary', 'outside-boundary', 'three-bubbles', 'image-caption', 'max-wait', 'group']) {
        const required = `debounce-${debounceMs}-${scenario}`;
        assert.ok(ids.has(required), `missing ${required}`);
      }
    }
    for (const required of [
      'debounce-idle-command', 'debounce-command-after-text', 'debounce-caption-then-image',
      'debounce-multiple-images-caption', 'debounce-image-business-question',
      'debounce-company-separates-content',
    ]) {
      assert.ok(ids.has(required), `missing ${required}`);
    }

    for (const testCase of LINE_AI_DEBOUNCE_EVAL_CASES) {
      assert.ok(testCase.events.length > 0, `${testCase.id} needs events`);
      assert.ok(testCase.debounceMs >= 0 && testCase.maxWaitMs > 0, `${testCase.id} has invalid timing`);
      assert.ok(testCase.expectedBatchCount > 0, `${testCase.id} needs a batch`);
      assert.ok(testCase.expectedFirstFlushAtMs >= testCase.events[0]!.atMs, `${testCase.id} flushes before arrival`);
      assert.equal(testCase.events.every((event, index, all) => index === 0 || event.atMs >= all[index - 1]!.atMs), true, `${testCase.id} events are unordered`);
      if (testCase.chat === 'group') assert.equal(testCase.expectsLoading, false, testCase.id);
      if (testCase.id === 'debounce-idle-command') assert.equal(testCase.expectsLoading, false, testCase.id);
      const simulated = simulateDebounce(testCase);
      assert.equal(simulated.batchCount, testCase.expectedBatchCount, `${testCase.id} batch count`);
      assert.equal(simulated.firstFlushAtMs, testCase.expectedFirstFlushAtMs, `${testCase.id} first flush`);
      assert.deepEqual(simulated.groups, testCase.expectedSegmentTexts, `${testCase.id} segments`);
    }

    const expectedProtectedCount = LINE_AI_LATENCY_AUTONOMY_EVAL_CASES.length
      + LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES.length
      + LINE_AI_DEBOUNCE_EVAL_CASES.length
      + LINE_AI_SUBSTITUTE_ROUTING_CORPUS.length;
    assert.equal(expectedProtectedCount, 164 + 47, 'the 47 substitute-routing rows are bound into the protected union');
    assert.equal(LINE_AI_PROTECTED_EVAL_CASE_IDS.length, expectedProtectedCount);
    assert.equal(new Set(LINE_AI_PROTECTED_EVAL_CASE_IDS).size, expectedProtectedCount);
  });
});
