import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderInput } from '../apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.port';
import { IntentRouterAgent } from '../apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent';
import { LINE_AI_SUBSTITUTE_ROUTING_CORPUS } from './line-ai-substitute-routing.corpus';
import { buildSubstituteRouteRequest } from './run-line-ai-operator-language-eval';

// Importing the runner module for these tests must NOT replay the eval (the main() guard prevents it).
const OPEN_ROW = LINE_AI_SUBSTITUTE_ROUTING_CORPUS.find((row) => row.openSubstitute)!;
const CLOSED_ROW = LINE_AI_SUBSTITUTE_ROUTING_CORPUS.find((row) => !row.openSubstitute)!;

const capturingRouter = (capture: (input: ProviderInput) => void, intent = 'SUBSTITUTE_RECEIPT_CONTINUATION') =>
  new IntentRouterAgent({
    generateText: async (input: ProviderInput) => { capture(input); return { ok: true as const, text: JSON.stringify({ intent, language: 'th', confidence: 0.9, reason: 'x' }) }; },
  } as any);

describe('operator-language runner — substitute provider pass sends the trusted capability + bounded context', () => {
  it('the replay request carries a LITERAL-true substituteSemantic capability (only true activates)', () => {
    const req = buildSubstituteRouteRequest(OPEN_ROW);
    assert.deepEqual(req.capabilities, { substituteSemantic: true });
    assert.strictEqual(req.capabilities!.substituteSemantic, true, 'a literal boolean true, never a coercible value');
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
