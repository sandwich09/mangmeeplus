import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderInput } from '../apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.port';
import { IntentRouterAgent } from '../apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent';
import { LINE_AI_SUBSTITUTE_ROUTING_CORPUS } from './line-ai-substitute-routing.corpus';
import { buildSubstituteRouteRequest, evaluationSchedule, scoreSubstituteRow } from './run-line-ai-operator-language-eval';

describe('operator evaluation repeat scheduling', () => {
  it('keeps stable case identity and repeat identity without counting repeats as scenarios', () => {
    const cases = [{ id: 'one', message: 'เดิอนนี้' }, { id: 'two', message: 'สิงหา' }];
    const result = evaluationSchedule(cases, 3);
    assert.equal(result.length, 6);
    assert.deepEqual(result.map(({ testCase, repeat }) => [testCase.id, repeat]), [
      ['one', 0], ['two', 0], ['one', 1], ['two', 1], ['one', 2], ['two', 2],
    ]);
    assert.equal(new Set(result.map(({ testCase }) => testCase.id)).size, 2);
    assert.equal(result[4]!.testCase, cases[0]);
  });
  it('rejects invalid repetition or duplicate fixtures before any paid call', () => {
    for (const repeat of [0, -1, 1.5, NaN, Infinity, 11]) {
      assert.throws(() => evaluationSchedule([{ id: 'one' }], repeat), /INVALID_EVALUATION_REPEATS/);
    }
    assert.throws(() => evaluationSchedule([{ id: 'one' }, { id: 'one' }], 3), /DUPLICATE_EVALUATION_CASE/);
  });
});

// Importing the runner module for these tests must NOT replay the eval (the main() guard prevents it).
const OPEN_ROW = LINE_AI_SUBSTITUTE_ROUTING_CORPUS.find((row) => row.openSubstitute)!;
const CLOSED_ROW = LINE_AI_SUBSTITUTE_ROUTING_CORPUS.find((row) => !row.openSubstitute)!;

const capturingRouter = (capture: (input: ProviderInput) => void, intent = 'SUBSTITUTE_RECEIPT_CONTINUATION') =>
  new IntentRouterAgent({
    generateText: async (input: ProviderInput) => { capture(input); return { ok: true as const, text: JSON.stringify({ intent, language: 'th', confidence: 0.9, reason: 'x' }) }; },
  } as any);

describe('operator-language runner — substitute provider pass sends the trusted capability + bounded context', () => {
  it('the replay request carries LITERAL-true substitute AND reimbursement capabilities (only true activates)', () => {
    const req = buildSubstituteRouteRequest(OPEN_ROW);
    assert.deepEqual(req.capabilities, { substituteSemantic: true, reimbursementSemantic: true });
    assert.strictEqual(req.capabilities!.substituteSemantic, true, 'a literal boolean true, never a coercible value');
    assert.strictEqual(req.capabilities!.reimbursementSemantic, true, 'without it REIMBURSEMENT_REQUEST_START is unroutable');
  });

  it('the replay request carries a BOUNDED server-derived substituteContext (open vs closed rows)', () => {
    const open = buildSubstituteRouteRequest(OPEN_ROW).substituteContext!;
    assert.deepEqual(open, { workflowState: 'open', hasPendingQuestion: true, preparedState: 'in_progress', recentCandidateCount: 1 });
    const closed = buildSubstituteRouteRequest(CLOSED_ROW).substituteContext!;
    assert.deepEqual(closed, { workflowState: 'none', hasPendingQuestion: false, preparedState: 'none', recentCandidateCount: 1 });
    // Exactly the four bounded fields — no extra/authority data leaks into the eval context.
    assert.deepEqual(Object.keys(open).sort(), ['hasPendingQuestion', 'preparedState', 'recentCandidateCount', 'workflowState']);
  });

  it('routeIntake with the runner request ACTIVATES the substitute prompt section AND forwards substituteContext', async () => {
    let seen: ProviderInput | undefined;
    await capturingRouter((input) => { seen = input; }).routeIntake(buildSubstituteRouteRequest(OPEN_ROW));
    assert.match(seen!.systemPrompt ?? '', /SUBSTITUTE_RECEIPT_CONTINUATION/, 'the substitute route section is present in the prompt');
    assert.match(seen!.systemPrompt ?? '', /REIMBURSEMENT_REQUEST_START/, 'the reimbursement route section is present too');
    const payload = JSON.parse(seen!.messages[0]!.text);
    assert.ok(payload.substituteContext, 'substituteContext rides the DATA payload under the validated capability');
    assert.equal(payload.substituteContext.workflowState, 'open');
    assert.equal(seen!.usageTag, 'line.intake-route');
  });

  it('REGRESSION: the SAME request WITHOUT the capability (the pre-fix bug) runs the legacy prompt and STRIPS substituteContext — false evidence', async () => {
    let seen: ProviderInput | undefined;
    const legacyReq = buildSubstituteRouteRequest(OPEN_ROW);
    delete (legacyReq as { capabilities?: unknown }).capabilities; // reproduce the pre-fix runner (no capability)
    await capturingRouter((input) => { seen = input; }).routeIntake(legacyReq);
    assert.doesNotMatch(seen!.systemPrompt ?? '', /SUBSTITUTE_RECEIPT_CONTINUATION/, 'no substitute section without the capability');
    const payload = JSON.parse(seen!.messages[0]!.text);
    assert.equal(payload.substituteContext, undefined, 'substituteContext is stripped without the capability — proving the fix is load-bearing');
  });
});

const REIMBURSEMENT_ROW = LINE_AI_SUBSTITUTE_ROUTING_CORPUS.find((row) => row.id === 'reimbursement-greeting-uat')!;
const STRONG_CLAIM_ROW = LINE_AI_SUBSTITUTE_ROUTING_CORPUS.find((row) => row.id === 'reimbursement-employee-paid')!;
const VOUCHER_ROW = LINE_AI_SUBSTITUTE_ROUTING_CORPUS.find((row) => row.category === 'payment_voucher')!;
const ORDINARY_ROW = LINE_AI_SUBSTITUTE_ROUTING_CORPUS.find((row) => row.id === 'ordinary-win-purpose')!;
const QUESTION_ROW = LINE_AI_SUBSTITUTE_ROUTING_CORPUS.find((row) => row.id === 'question-may-claim')!;
const ADVANCE_ROW = LINE_AI_SUBSTITUTE_ROUTING_CORPUS.find((row) => row.id === 'advance-cash')!;

describe('operator-language runner — how one replayed substitute-corpus row is scored', () => {
  it('scores a reimbursement row by its EXACT route and semantic pair, not merely "not substitute"', () => {
    const expected = scoreSubstituteRow(REIMBURSEMENT_ROW, { intent: 'REIMBURSEMENT_REQUEST_START', semanticOutcome: 'AMBIGUOUS', fundingSource: 'UNKNOWN' });
    assert.deepEqual({ basis: expected.scoringBasis, passed: expected.passed }, { basis: 'expected_intent', passed: true });
    // The old basis passed this answer (CLARIFY is not the substitute route) even though the claim was missed.
    const wrongRoute = scoreSubstituteRow(REIMBURSEMENT_ROW, { intent: 'CLARIFY', semanticOutcome: 'AMBIGUOUS', fundingSource: 'UNKNOWN' });
    assert.equal(wrongRoute.passed, false, 'a missed claim is a failure, not a pass');
    assert.match(wrongRoute.reason, /intent=CLARIFY,expected=REIMBURSEMENT_REQUEST_START/);
    // The dangerous answer: a claim labelled company-paid business expense would license expense capture.
    const wrongSemantics = scoreSubstituteRow(REIMBURSEMENT_ROW, { intent: 'REIMBURSEMENT_REQUEST_START', semanticOutcome: 'BUSINESS_EXPENSE', fundingSource: 'COMPANY_PAID' });
    assert.equal(wrongSemantics.passed, false);
    assert.match(wrongSemantics.reason, /semanticOutcome=BUSINESS_EXPENSE.*fundingSource=COMPANY_PAID/);
  });

  it('scores the explicit employee-paid row by its STRONG pair — the fail-closed pair FAILS there', () => {
    const right = scoreSubstituteRow(STRONG_CLAIM_ROW, { intent: 'REIMBURSEMENT_REQUEST_START', semanticOutcome: 'REIMBURSEMENT_CLAIM', fundingSource: 'EMPLOYEE_PAID' });
    assert.deepEqual({ basis: right.scoringBasis, passed: right.passed }, { basis: 'expected_intent', passed: true });
    // Answering AMBIGUOUS/UNKNOWN to a text that literally says "สำรองจ่าย…ขอเบิกคืน" is a MISS, not a safe
    // default: without this row an all-fail-closed corpus would pass a router that never reads the payer.
    const failClosed = scoreSubstituteRow(STRONG_CLAIM_ROW, { intent: 'REIMBURSEMENT_REQUEST_START', semanticOutcome: 'AMBIGUOUS', fundingSource: 'UNKNOWN' });
    assert.equal(failClosed.passed, false, 'the fail-closed pair is wrong when the payer IS stated');
    assert.match(failClosed.reason, /semanticOutcome=AMBIGUOUS.*fundingSource=UNKNOWN/);
  });

  it('keeps every other protected negative on the "not substitute" basis (any safe route passes)', () => {
    const safe = scoreSubstituteRow(VOUCHER_ROW, { intent: 'MUTATION_REQUEST_REFUSAL' });
    assert.deepEqual({ basis: safe.scoringBasis, passed: safe.passed }, { basis: 'not_substitute', passed: true });
    assert.equal(scoreSubstituteRow(VOUCHER_ROW, { intent: 'SUBSTITUTE_RECEIPT_CONTINUATION' }).passed, false);
  });

  it('scores an ordinary spend note by its EXACT capture route — the complement of the claim rows', () => {
    // Without this, a router that answered REIMBURSEMENT_REQUEST_START to every "ค่า… บาท" would pass the
    // whole corpus on the not-substitute basis while breaking §16's "ordinary note still captures".
    const right = scoreSubstituteRow(ORDINARY_ROW, { intent: 'EXPENSE_DOCUMENT_CAPTURE', semanticOutcome: 'BUSINESS_EXPENSE', fundingSource: 'COMPANY_PAID' });
    assert.deepEqual({ basis: right.scoringBasis, passed: right.passed }, { basis: 'expected_intent', passed: true });
    const overTriggered = scoreSubstituteRow(ORDINARY_ROW, { intent: 'REIMBURSEMENT_REQUEST_START', semanticOutcome: 'REIMBURSEMENT_CLAIM', fundingSource: 'EMPLOYEE_PAID' });
    assert.equal(overTriggered.passed, false, 'a spend note answered as a claim is a failure');
    assert.match(overTriggered.reason, /intent=REIMBURSEMENT_REQUEST_START,expected=EXPENSE_DOCUMENT_CAPTURE/);
  });

  it('REQUIRES the capture route contract: capture + UNKNOWN is a FAILURE, not a weakly-labelled pass', () => {
    // The server's isSemanticContradiction rewrites capture + anything-but-BUSINESS_EXPENSE/COMPANY_PAID
    // into a CLARIFY with the hints stripped, so scoring it as agreement would report a capture the user
    // would never have received. The pair is the OPERATIONAL route contract, not a payer-provenance claim.
    for (const plan of [
      { intent: 'EXPENSE_DOCUMENT_CAPTURE' },
      { intent: 'EXPENSE_DOCUMENT_CAPTURE', semanticOutcome: 'BUSINESS_EXPENSE', fundingSource: 'UNKNOWN' },
      { intent: 'EXPENSE_DOCUMENT_CAPTURE', semanticOutcome: 'AMBIGUOUS', fundingSource: 'COMPANY_PAID' },
      { intent: 'EXPENSE_DOCUMENT_CAPTURE', semanticOutcome: 'REIMBURSEMENT_CLAIM', fundingSource: 'EMPLOYEE_PAID' },
    ] as const) {
      const scored = scoreSubstituteRow(ORDINARY_ROW, plan);
      assert.equal(scored.passed, false, JSON.stringify(plan));
      assert.match(scored.reason, /semanticOutcome=|fundingSource=/);
    }
  });

  it('applies the same capture contract to a row that never states a payer at all', () => {
    // 'ค่ากาแฟ 65 บาท' names nobody as the payer; the corpus still pins the pair because the SERVER
    // requires it to route the note to capture. Every capture-expected row is scored the same way.
    const bare = LINE_AI_SUBSTITUTE_ROUTING_CORPUS.find((row) => row.id === 'ordinary-coffee-open')!;
    assert.equal(bare.expectedSemanticOutcome, 'BUSINESS_EXPENSE');
    assert.equal(bare.expectedFundingSource, 'COMPANY_PAID');
    assert.equal(scoreSubstituteRow(bare, { intent: 'EXPENSE_DOCUMENT_CAPTURE', semanticOutcome: 'BUSINESS_EXPENSE', fundingSource: 'COMPANY_PAID' }).passed, true);
    assert.equal(scoreSubstituteRow(bare, { intent: 'EXPENSE_DOCUMENT_CAPTURE', semanticOutcome: 'AMBIGUOUS', fundingSource: 'UNKNOWN' }).passed, false);
  });

  it('leaves the non-capture bases untouched: a claim keeps its own pinned pair', () => {
    // The capture contract must not leak onto the claim rows — a claim answered COMPANY_PAID is still the
    // dangerous answer, and the fail-closed pair is still the right one for a bare "เบิก…".
    assert.equal(scoreSubstituteRow(REIMBURSEMENT_ROW, { intent: 'REIMBURSEMENT_REQUEST_START', semanticOutcome: 'AMBIGUOUS', fundingSource: 'UNKNOWN' }).passed, true);
    assert.equal(scoreSubstituteRow(REIMBURSEMENT_ROW, { intent: 'REIMBURSEMENT_REQUEST_START', semanticOutcome: 'BUSINESS_EXPENSE', fundingSource: 'COMPANY_PAID' }).passed, false);
  });

  it('scores a question / negation / stock / advance row by "never a command", not by one pinned route', () => {
    // §7.2 licenses more than one safe answer here (clarify, help, a read, a refusal), so the basis claims
    // only what the contract does: whatever the router picks, it must not start or mutate anything.
    for (const intent of ['CLARIFY', 'UNSUPPORTED', 'BUSINESS_READ_QUESTION', 'MUTATION_REQUEST_REFUSAL'] as const) {
      const safe = scoreSubstituteRow(QUESTION_ROW, { intent });
      assert.deepEqual({ basis: safe.scoringBasis, passed: safe.passed }, { basis: 'not_command', passed: true }, intent);
    }
    for (const intent of ['REIMBURSEMENT_REQUEST_START', 'EXPENSE_DOCUMENT_CAPTURE', 'SUBSTITUTE_RECEIPT_CONTINUATION'] as const) {
      assert.equal(scoreSubstituteRow(QUESTION_ROW, { intent }).passed, false, `${intent} turns a question into a command`);
      assert.equal(scoreSubstituteRow(ADVANCE_ROW, { intent }).passed, false, `${intent} turns an advance request into a command`);
    }
    assert.match(scoreSubstituteRow(ADVANCE_ROW, { intent: 'REIMBURSEMENT_REQUEST_START' }).reason, /mustNotStartOrMutate/);
  });
});
