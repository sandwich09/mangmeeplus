import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_INTAKE_CLARIFICATION_FIELDS, LINE_TOOL_REGISTRY } from '@watchdog-bms/contracts';
import { LINE_AI_SUBSTITUTE_ROUTING_CORPUS } from './line-ai-substitute-routing.corpus';
import { nextFlushDelayMs } from '../apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic';
import { assessLineTextExpenseCapture } from '../apps/api/src/modules/expenses/domain/logic/expense-document.logic';
import {
  LINE_AI_BUFFER_MAX_WAIT_MS,
  LINE_AI_COMPLETENESS_ACTIVE_CATEGORIES,
  LINE_AI_COMPLETENESS_MERGE_MANIFEST,
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
  LINE_AI_PRESENTATION_PERMISSION_MANIFEST,
  LINE_AI_PROTECTED_EVAL_CASE_IDS,
  LINE_AI_PROTECTED_JOURNEY_GROUPS,
  LINE_AI_PROVIDER_EVAL_REQUIREMENTS,
  LINE_AI_ROLLOUT_GATES,
  type CompletenessMergeCase,
  type LatencyAutonomyLane,
  type PreparedPlanSecurityEvalCase,
  type PresentationPermissionCase,
} from './line-ai-latency-autonomy.corpus';

/** The input half of a completeness row: two rows with the same key must carry the same verdict. */
const completenessInputKey = (row: CompletenessMergeCase) => JSON.stringify([
  row.lane, row.message, row.groundingSegments ?? [], row.hints, row.semanticBusinessExpenseConfirmed,
]);
const completenessVerdict = (row: CompletenessMergeCase) => JSON.stringify([
  row.expectedAcceptedFields, row.expectedMissingFields, row.expectedConflictingFields, row.expectedWriteAllowed,
]);

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

    // Exact standalone greeting (spec §11.2, plan Phase 6B): only the WHOLE-message allowlist match is the
    // 0-call lane. Any greeting carrying business text — or an unlisted variant — stays fully routed, so the
    // lane can never become a regex synonym engine for business intent.
    const exactGreeting = LINE_AI_LATENCY_AUTONOMY_EVAL_CASES.find(({ message }) => message === 'สวัสดี');
    assert.ok(exactGreeting, 'the exact standalone greeting row is present');
    assert.equal(exactGreeting.expectedLane, 'zero_model', 'the exact greeting answers deterministically');
    assert.equal(exactGreeting.maxModelCalls, 0, 'the exact greeting costs zero model calls');
    assert.equal(exactGreeting.expectedToolCallCount, 0, exactGreeting.id);
    const mixedGreetings = LINE_AI_LATENCY_AUTONOMY_EVAL_CASES.filter(({ message }) => message.includes('สวัสดี') && message !== 'สวัสดี');
    assert.ok(mixedGreetings.length >= 2, 'mixed greeting + business rows stay in the corpus');
    for (const testCase of mixedGreetings) {
      assert.notEqual(testCase.expectedLane, 'zero_model', `${testCase.id}: greeting + business text keeps the full route`);
      assert.notEqual(testCase.maxModelCalls, 0, `${testCase.id}: greeting + business text still costs a model call`);
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
    assert.equal(expectedProtectedCount, 164 + 92, 'the 92 substitute-routing rows (incl. the §14.1 semantic set) are bound into the protected union');
    assert.equal(LINE_AI_PROTECTED_EVAL_CASE_IDS.length, expectedProtectedCount);
    assert.equal(new Set(LINE_AI_PROTECTED_EVAL_CASE_IDS).size, expectedProtectedCount);
  });

  // The three tests below own the frozen §14.2/§14.3 manifests. The first and the third prove SHAPE and
  // safety invariants; the second REPLAYS every §14.2 expense row through the real
  // `assessLineTextExpenseCapture`, so those expectations are runtime-checked rather than asserted about
  // themselves. Still out of scope here: rendering a card, observing a domain mutation, and any
  // provider/UAT evidence.
  it('freezes the §14.2 completeness/merge manifest (>=20 rows, bounded enums, conflicts zero-write)', () => {
    const rows = LINE_AI_COMPLETENESS_MERGE_MANIFEST;
    assert.ok(rows.length >= 20, `expected >=20 completeness rows, got ${rows.length}`);
    assert.equal(new Set(rows.map(({ id }) => id)).size, rows.length, 'completeness ids are unique');
    const fields: ReadonlySet<string> = new Set(LINE_INTAKE_CLARIFICATION_FIELDS);
    for (const row of rows) {
      assert.ok(row.message.trim(), `${row.id} needs a message`);
      assert.ok(row.note.trim(), `${row.id} needs a note`);
      assert.ok(['expense', 'reimbursement'].includes(row.lane), `${row.id} has an unknown lane`);
      assert.ok((row.groundingSegments ?? []).every((segment) => segment.trim()), `${row.id} has an empty grounding segment`);
      const verdict = [...row.expectedAcceptedFields, ...row.expectedMissingFields, ...row.expectedConflictingFields];
      for (const field of verdict) assert.ok(fields.has(field), `${row.id} reports unknown field ${field}`);
      assert.equal(new Set(verdict).size, verdict.length, `${row.id} reports one field under two verdicts`);
      if (row.lane === 'expense' && !row.semanticBusinessExpenseConfirmed) {
        // Default-off delegates to the LEGACY boolean gate, which has no field vocabulary at all. A row
        // that reported typed fields here would describe a verdict this release never produces.
        assert.deepEqual(verdict, [], `${row.id}: the default-off lane reports no typed field`);
      } else {
        assert.equal(
          row.expectedWriteAllowed,
          row.expectedMissingFields.length === 0 && row.expectedConflictingFields.length === 0,
          `${row.id}: writeAllowed must hold exactly when nothing is missing and nothing conflicts`,
        );
      }
      if (row.expectedConflictingFields.length > 0) assert.equal(row.expectedWriteAllowed, false, `${row.id}: a conflict is zero-write`);
      // Release one is handoff-only, so no claim row may report a complete, write-ready reimbursement.
      if (row.lane === 'reimbursement') assert.equal(row.expectedWriteAllowed, false, `${row.id}: reimbursement rows are zero-write`);
      assert.ok(!/lineUserId|providerUserId|chatKey/.test(JSON.stringify(row)), `${row.id} must not carry raw identity`);
    }

    // Wrong-domain safety: a message that asks to be reimbursed (or says the user advanced the money)
    // may never license a write from this verdict, whatever the lane.
    for (const row of rows.filter(({ message }) => /เบิก|สำรองจ่าย/u.test(message))) {
      assert.equal(row.expectedWriteAllowed, false, `${row.id}: a claim-shaped message must not license a write`);
    }

    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of [
      'uat-60-purpose-only-guard-off', 'uat-50-purpose-only-guard-off',
      'purpose-only-in-business-purpose-company-paid', 'purpose-only-in-business-purpose-50-company-paid',
      'expense-note-grounded-description',
      'amount-only-missing', 'purpose-only-missing', 'reimbursement-date-only-missing',
      'incidental-quantity-is-not-an-amount', 'two-amounts-conflict',
      'followup-purpose-keeps-original-amount', 'followup-new-amount-without-correction-conflicts',
      'explicit-closed-correction-replaces-amount', 'correction-question-is-not-a-correction',
      'correction-negation-is-not-a-correction', 'model-amount-mismatch', 'invented-purpose-not-grounded',
      'invented-category-is-not-a-purpose', 'unrelated-answer-does-not-complete',
      'thai-digit-amount-accepted', 'redelivery-repeats-the-same-verdict',
    ]) {
      assert.ok(byId.has(id), `missing headline completeness row ${id}`);
    }

    // The exact UAT texts, frozen as route-veto rows: a "เบิก…" claim can never reach the semantic guard,
    // so the assessor stays on its legacy branch — zero write and, deliberately, no typed field to build a
    // field-specific re-ask from. These two rows are the defect, not its fix.
    assert.equal(byId.get('uat-60-purpose-only-guard-off')!.message, 'เบิกค่ารถวินมอไซต์ 60 บาท ไปพบลูกค้า');
    assert.equal(byId.get('uat-50-purpose-only-guard-off')!.message, 'เบิกค่าวินมอไซด์ไปพบลูกค้าหน่อย 50 บาท');
    for (const id of ['uat-60-purpose-only-guard-off', 'uat-50-purpose-only-guard-off']) {
      assert.equal(byId.get(id)!.semanticBusinessExpenseConfirmed, false, `${id}: a claim never clears the guard`);
      assert.equal(byId.get(id)!.expectedWriteAllowed, false, id);
    }
    // The fix, on text that says the company paid: the purpose grounded only in `businessPurpose` completes.
    for (const id of ['purpose-only-in-business-purpose-company-paid', 'purpose-only-in-business-purpose-50-company-paid']) {
      assert.deepEqual(byId.get(id)!.expectedAcceptedFields, ['amount', 'purpose'], id);
      assert.equal(byId.get(id)!.expectedWriteAllowed, true, id);
    }
    assert.deepEqual(byId.get('amount-only-missing')!.expectedMissingFields, ['amount']);
    assert.deepEqual(byId.get('purpose-only-missing')!.expectedMissingFields, ['description', 'purpose']);
    assert.deepEqual(byId.get('reimbursement-date-only-missing')!.expectedMissingFields, ['incurredDate']);
    assert.deepEqual(byId.get('two-amounts-conflict')!.expectedConflictingFields, ['amount']);
    assert.deepEqual(byId.get('followup-new-amount-without-correction-conflicts')!.expectedConflictingFields, ['amount']);
    for (const id of ['correction-question-is-not-a-correction', 'correction-negation-is-not-a-correction']) {
      assert.deepEqual(byId.get(id)!.expectedConflictingFields, ['amount'], `${id}: neither shape is a correction`);
    }
    // A resolved clarification is VETO evidence only (§8.3): it settles or creates a conflict and never
    // supplies the value a write is made from. So the correction clears the conflict without licensing a
    // write, and a purpose-only follow-up must ask for the amount again rather than reuse the earlier one.
    const correction = byId.get('explicit-closed-correction-replaces-amount')!;
    assert.deepEqual(correction.expectedConflictingFields, [], 'the closed grammar settles which amount is meant');
    assert.deepEqual(correction.expectedAcceptedFields, ['amount']);
    assert.equal(correction.expectedWriteAllowed, false, 'the item it would be written under is not in this message');
    const followUp = byId.get('followup-purpose-keeps-original-amount')!;
    assert.deepEqual(followUp.expectedAcceptedFields, ['purpose'], 'an accepted purpose is never asked for again');
    assert.deepEqual(followUp.expectedMissingFields, ['amount'], 'a Redis-only 60 is not write authority');
    assert.equal(followUp.expectedWriteAllowed, false);
    assert.deepEqual(byId.get('model-amount-mismatch')!.expectedMissingFields, ['amount']);
    assert.equal(byId.get('incidental-quantity-is-not-an-amount')!.expectedConflictingFields.length, 0);
    assert.ok(byId.get('thai-digit-amount-accepted')!.message.includes('๖๐'), 'the Thai-digit row keeps Thai digits');

    // Determinism: identical input rows (the redelivery pair) must carry an identical verdict.
    const byInput = new Map<string, CompletenessMergeCase[]>();
    for (const row of rows) {
      const key = completenessInputKey(row);
      byInput.set(key, [...(byInput.get(key) ?? []), row]);
    }
    const repeated = [...byInput.values()].filter((group) => group.length > 1);
    assert.ok(repeated.length >= 1, 'the redelivery row repeats an existing input on purpose');
    for (const [first, ...rest] of repeated) {
      for (const row of rest) {
        assert.equal(completenessVerdict(row), completenessVerdict(first!), `${row.id} contradicts ${first!.id} on identical input`);
      }
    }
  });

  // The manifest stops being a self-referential expectation here: every EXPENSE row is fed to the real
  // deterministic assessor with the frozen active-category map, and all four outputs are compared. Pure
  // function, no database, no network, no provider. The reimbursement rows are excluded by `lane`, not by
  // omission — that lane has no deterministic assessor, so there is nothing honest to call for them.
  it('replays every §14.2 expense row through the real assessLineTextExpenseCapture', () => {
    const expenseRows = LINE_AI_COMPLETENESS_MERGE_MANIFEST.filter(({ lane }) => lane === 'expense');
    assert.equal(expenseRows.length, LINE_AI_COMPLETENESS_MERGE_MANIFEST.length - 2, 'only the two claim rows opt out');
    for (const row of expenseRows) {
      const actual = assessLineTextExpenseCapture(
        row.message,
        row.hints,
        LINE_AI_COMPLETENESS_ACTIVE_CATEGORIES,
        row.groundingSegments ?? [],
        { semanticBusinessExpenseConfirmed: row.semanticBusinessExpenseConfirmed },
      );
      assert.deepEqual(actual.acceptedFields, row.expectedAcceptedFields, `${row.id}: acceptedFields`);
      assert.deepEqual(actual.missingFields, row.expectedMissingFields, `${row.id}: missingFields`);
      assert.deepEqual(actual.conflictingFields, row.expectedConflictingFields, `${row.id}: conflictingFields`);
      assert.equal(actual.eligible, row.expectedWriteAllowed, `${row.id}: eligible`);
    }
    for (const row of LINE_AI_COMPLETENESS_MERGE_MANIFEST.filter(({ lane }) => lane === 'reimbursement')) {
      assert.equal(row.expectedWriteAllowed, false, `${row.id}: the claim lane is zero-write in this release`);
    }
  });

  it('freezes the §14.3 presentation/permission manifest and reports its implemented/gap split', () => {
    const rows = LINE_AI_PRESENTATION_PERMISSION_MANIFEST;
    assert.ok(rows.length >= 16, `expected >=16 presentation rows, got ${rows.length}`);
    assert.equal(new Set(rows.map(({ id }) => id)).size, rows.length, 'presentation ids are unique');
    const journeys: PresentationPermissionCase['journey'][] = [
      'expense_capture_terminal', 'reimbursement_clarify', 'reimbursement_handoff', 'reimbursement_draft',
      'legal_gate', 'clarification_state', 'delivery_replay', 'long_reply', 'renderer_fallback',
    ];
    const kinds: PresentationPermissionCase['expectedPresentationKind'][] = ['flex', 'text', 'text_parts_then_flex', 'text_fallback'];
    const authorities: PresentationPermissionCase['authority'][] = [
      'allowed', 'no_permission', 'feature_off', 'empty_branch_scope', 'legal_pending', 'state_unavailable',
      'state_stale_or_expired', 'cross_user', 'cross_chat_or_company', 'owner_go_pending',
    ];
    /** Authorities that refuse the journey outright — never a CTA, never a write, never another model call. */
    const denied: PresentationPermissionCase['authority'][] = [
      'no_permission', 'feature_off', 'empty_branch_scope', 'legal_pending', 'state_unavailable',
      'state_stale_or_expired', 'cross_user', 'cross_chat_or_company',
    ];
    for (const row of rows) {
      assert.ok(journeys.includes(row.journey), `${row.id} has an unknown journey`);
      assert.ok(kinds.includes(row.expectedPresentationKind), `${row.id} has an unknown presentation kind`);
      assert.ok(authorities.includes(row.authority), `${row.id} has an unknown authority`);
      assert.ok(['implemented_fixture', 'required_gap'].includes(row.evidenceStatus), `${row.id} evidenceStatus`);
      assert.ok(row.note.trim(), `${row.id} needs a note`);
      assert.ok(row.maxAdditionalModelCalls <= 1, `${row.id} has an unbounded model budget`);
      // URL policy (§9.1): a CTA is a company-scoped PATH — no query, no hash, no financial parameter.
      if (row.expectedCtaPolicy === 'no_cta') assert.equal(row.expectedWebPath, undefined, `${row.id} must carry no CTA path`);
      if (row.expectedWebPath) {
        assert.equal(row.expectedCtaPolicy, 'tenant_path_no_financial_params', row.id);
        assert.ok(row.expectedWebPath.startsWith('/companies/{companyId}/'), `${row.id} CTA must be company-scoped`);
        assert.ok(!/[?#]/.test(row.expectedWebPath), `${row.id} CTA must carry no query or hash`);
        assert.ok(!/amount|purpose|total|price/i.test(row.expectedWebPath), `${row.id} CTA must carry no financial parameter`);
      }
      // Mutation safety: only an expense capture terminal may create anything in this release.
      if (row.journey !== 'expense_capture_terminal') assert.equal(row.expectedDomainWriteCount, 0, `${row.id} must write nothing`);
      assert.ok(row.expectedDomainWriteCount <= 1, `${row.id} must not create more than one record`);
      if (denied.includes(row.authority)) {
        assert.equal(row.expectedDomainWriteCount, 0, `${row.id}: a refused journey writes nothing`);
        assert.equal(row.expectedCtaPolicy, 'no_cta', `${row.id}: a route the user cannot open is never offered`);
        assert.equal(row.maxAdditionalModelCalls, 0, `${row.id}: a deterministic terminal spends no further model call`);
      }
    }

    // Honest split: the manifest freezes gold expectations, and says which ones the code does not do yet.
    const implemented = rows.filter(({ evidenceStatus }) => evidenceStatus === 'implemented_fixture');
    const gaps = rows.filter(({ evidenceStatus }) => evidenceStatus === 'required_gap');
    assert.equal(implemented.length + gaps.length, rows.length, 'evidenceStatus stays bounded to the two members');
    assert.ok(implemented.length >= 8, `expected a real implemented set, got ${implemented.length}`);
    // Four clarification-state rows moved to implemented when the DB-backed neutral state landed
    // (§8.3 / plan Phase 1A), and two delivery rows moved when LineTurnOutcome + the Flex→text
    // fallback landed, so the floor drops with them. It stays a FLOOR, not a target: the manifest's
    // job is to keep naming what is still missing — here the two card-rendering rows.
    assert.ok(gaps.length >= 2, `the manifest must keep naming its gaps, got ${gaps.length}`);

    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of [
      'expense-terminal-single-flex', 'expense-terminal-multipart-flex', 'reimbursement-payer-clarify-card',
      'reimbursement-clarify-only-no-cta', 'reimbursement-handoff-tenant-path',
      'reimbursement-handoff-no-permission', 'reimbursement-handoff-feature-off',
      'reimbursement-handoff-empty-branch-scope', 'legal-pending-zero-write',
      'duplicate-webhook-single-outcome', 'expired-reply-token-push-same-messages',
      'long-reply-over-1200-lossless', 'long-reply-over-4800-lossless',
      // §8.3 DB-backed neutral intake state (plan Phase 1A). "Implemented" here means the code path
      // and its specs exist, NOT that the lane is live: LINE_AI_INTAKE_STATE_MODE defaults to 'off'
      // and no provider-replay or UAT evidence has been recorded for these four yet.
      'state-store-outage-zero-write', 'state-stale-or-expired-zero-write',
      'state-cross-user-zero-write', 'state-cross-chat-or-company-zero-write',
      // §8.3 durable delivery. Same meaning of "implemented" as the four above: the code path and its
      // fixtures exist, and BOTH flags default off with no provider/UAT evidence recorded yet.
      'persisted-terminal-outcome-replay', 'flex-failure-text-fallback',
    ]) {
      assert.ok(byId.has(id), `missing presentation row ${id}`);
      assert.equal(byId.get(id)!.evidenceStatus, 'implemented_fixture', `${id} exists in the current path`);
    }
    for (const id of ['expense-draft-structured-card', 'reimbursement-draft-card-owner-go']) {
      assert.ok(byId.has(id), `missing presentation row ${id}`);
      assert.equal(byId.get(id)!.evidenceStatus, 'required_gap', `${id} is not implemented, so it must not read as implemented`);
    }
    assert.equal(byId.get('reimbursement-handoff-tenant-path')!.expectedWebPath, '/companies/{companyId}/reimbursements/new');
    assert.equal(byId.get('expense-terminal-multipart-flex')!.expectedPresentationKind, 'text_parts_then_flex');
    assert.equal(byId.get('flex-failure-text-fallback')!.expectedPresentationKind, 'text_fallback');
    for (const row of rows.filter(({ journey }) => journey === 'clarification_state')) {
      assert.equal(row.expectedDomainWriteCount, 0, `${row.id} must be zero-write`);
      // The DB-backed state now exists (LineIntakeState + LineIntakeStateRepository), so these four
      // are implemented rather than pending. The note on each row still says the flag is default-off
      // and that provider/UAT evidence is outstanding — that honesty is asserted below.
      assert.equal(row.evidenceStatus, 'implemented_fixture', `${row.id} is backed by the DB state store`);
      assert.match(row.note, /DEFAULT OFF/,
        `${row.id}: an implemented-but-dark lane must say so, or the manifest reads as a live guarantee`);
    }
    // Same rule for the two delivery rows: implemented CODE behind a dark flag is not a live guarantee.
    for (const id of ['persisted-terminal-outcome-replay', 'flex-failure-text-fallback']) {
      assert.match(byId.get(id)!.note, /DEFAULT OFF/,
        `${id}: an implemented-but-dark lane must say so, or the manifest reads as a live guarantee`);
      assert.equal(byId.get(id)!.maxAdditionalModelCalls, 0, `${id}: a delivery retry must never re-decide the turn`);
    }

    // Both long-reply thresholds are represented, and both are backed by a deterministic fixture on the
    // multipart lane: the terminal text ships intact and a concise card closes the turn. The Flex-DELIVERY
    // failure fallback is now its own implemented row above, with its altText ceiling written into the note.
    const thresholds = rows
      .map(({ expectedLongReplyThreshold }) => expectedLongReplyThreshold)
      .filter((value): value is NonNullable<PresentationPermissionCase['expectedLongReplyThreshold']> => value !== undefined);
    assert.deepEqual([...new Set(thresholds)].sort((a, b) => a - b), [1_200, 4_800]);
    for (const row of rows.filter(({ expectedLongReplyThreshold }) => expectedLongReplyThreshold !== undefined)) {
      assert.equal(row.evidenceStatus, 'implemented_fixture', `${row.id}: the lossless text + concise card fixture exists`);
      assert.equal(row.expectedPresentationKind, 'text_parts_then_flex', row.id);
    }
    assert.equal(implemented.length, 19, 'implemented_fixture rows');
    assert.equal(gaps.length, 2, 'required_gap rows');

    // Both manifests are gold expectations, NOT provider route rows: they stay OUT of the protected replay
    // union, so an id may never collide with one the runner scores.
    const protectedIds = new Set(LINE_AI_PROTECTED_EVAL_CASE_IDS);
    for (const id of [...LINE_AI_COMPLETENESS_MERGE_MANIFEST, ...rows].map(({ id: rowId }) => rowId)) {
      assert.ok(!protectedIds.has(id), `${id} collides with a protected replay id`);
    }
  });
});
