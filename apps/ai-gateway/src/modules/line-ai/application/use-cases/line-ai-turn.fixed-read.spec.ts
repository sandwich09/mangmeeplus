import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  AI_BUDGET_PROFILE_TABLE_DIGEST_V2, createLineAiInputEvidence, extractValueCandidatesV2,
  parseLineAiPreparedPlan, parseLineAiSemanticSubrequests, type AiBudgetGrantV2, type LineAiTurnRequest,
} from '@watchdog-bms/contracts';
import { runWithUsageContext } from '../../../../common/usage/usage-context';
import { OrchestratorAgent } from '../../agents/orchestrator.agent';
import { LineAiTurnUseCase } from './line-ai-turn.use-case';

async function fixture() {
  const now = Date.now(), messageText = 'ดูค่าใช้จ่ายเดือนนี้';
  // Same evidence/candidate helpers and part shape as the API's textEvidenceV2/textValueCandidates.
  const built = await createLineAiInputEvidence({ turnKey: 'fixed-turn', parts: [{ partId: 'part-0',
    eventIdHash: 'a'.repeat(64), acceptedAtMs: now, rawText: messageText }] });
  assert.ok(built);
  const inputEvidence = built.inputEvidence;
  const valueCandidates = await extractValueCandidatesV2(inputEvidence,
    new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }));
  assert.ok(valueCandidates);
  const period = valueCandidates.periods.find(candidate => candidate.kind === 'month')!;
  const input = { fromDate: period.fromDate, toDate: period.toDate };
  const grant: AiBudgetGrantV2 = {
    version: 2, turnKey: inputEvidence.turnKey, authorityKind: 'webhook_event', authorityId: 'log-1',
    channelOwnerDigest: 'b'.repeat(64), attemptKey: 'fixed-attempt', monthKey: period.fromDate.slice(0, 7), payerCompanyId: 'company-1',
    model: { provider: 'openai', modelId: 'gpt-4.1-mini', region: 'global' }, allowedProfileIds: ['line-answer/2'],
    profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2, maxTurnSlots: 2, maxRepairs: 1,
    admittedAtMs: now, workDeadlineAtMs: now + 60_000, finalDeadlineAtMs: now + 90_000,
    nonce: 'fixed-nonce', issuerVersion: 'api-test', nextOrdinal: 0, signature: 'c'.repeat(64),
  };
  const request: LineAiTurnRequest = {
    requestId: 'fixed-request', webhookEventId: 'fixed-event', messageText, messagePreviewHash: 'd'.repeat(16),
    userContext: { lineUserId: '[REDACTED]', internalUserId: 'user-1', companyId: 'company-1', membershipId: 'membership-1',
      permissions: ['line.ai.query', 'ai.tool.invoke', 'expense.read'], roles: ['OWNER'], locale: 'th-TH', entitledFeatureKeys: ['expenses'] },
    inputEvidence, valueCandidates, budgetGrantV2: grant, contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'],
    // AiGatewayClient.requestLineTurn adds server-signed delegations before HTTP ingress.
    actorDelegations: { 'expense.list_recent': ['server-read-delegation'] },
    intakeIntent: 'BUSINESS_READ_QUESTION',
    preparedPlan: { version: 1, complexity: 'simple', confidence: 1, responseMode: 'simple_grounded', answerShape: 'single_metric',
      intentPlan: { status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [], intents: [
        { intent: 'read_summary', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.list_recent'], missingContext: [] }] },
      proposedCalls: [{ toolName: 'expense.list_recent', input }] },
    semanticSubrequests: [{ index: 0, kind: 'read', goal: messageText, requestedFilters: input, requiredEvidence: [], dependsOn: [],
      evidenceRefs: inputEvidence.parts.map(part => ({ partId: part.partId, startUtf16: 0, endUtf16: part.rawText.length, rawSha256: part.rawSha256 })) }],
  };
  const calls: any[] = [];
  const erp = { invoke: async (tool: any, ctx: any, args: any) => {
    calls.push({ name: tool.name, ctx, input: args });
    return { toolName: tool.name, status: 'ok', asOf: new Date(now).toISOString(), durationMs: 1,
      data: { total: 1, period: input, summary: { countedItems: 1, cancelledCount: 0, totalAmount: 250,
        pendingAmount: 0, draftAmount: 0, confirmedAmount: 250, paidAmount: 250, unpaidAmount: 0 }, items: [] },
      sourceRefs: [{ id: 'expense-summary', label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary',
        permissionChecked: true, webPath: '/companies/company-1/expenses' }] };
  } } as any;
  const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local',
    modelProvider: 'disabled', aiMaxToolCalls: 8, aiToolTimeoutMs: 1000 } as any;
  const useCase = new LineAiTurnUseCase(erp, new OrchestratorAgent(erp, config), config, {} as any);
  const run = () => runWithUsageContext({ companyId: 'company-1', budget: { status: 'active-v2', grant,
    inputDigest: inputEvidence.joinedSha256, sourceRoute: 'line-turn', calls: 0, repairCount: 0 } }, () => useCase.execute(request));
  return { request, calls, run };
}

it('fixed-read v2 request passes gateway ingress and the real guarded expense formatter', async () => {
  const h = await fixture();
  assert.ok(parseLineAiPreparedPlan(h.request.preparedPlan, { inputEvidence: h.request.inputEvidence! }));
  assert.ok(parseLineAiSemanticSubrequests(h.request.semanticSubrequests, h.request.messageText, h.request.inputEvidence));
  const response = await h.run();
  assert.equal(response.errorCode, undefined);
  assert.equal(response.refused, false);
  assert.equal(response.semanticCoverage?.[0]?.status, 'handled');
  assert.equal(response.presentation?.kind, 'answer_cards');
  assert.match(response.replyText, /250/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, 'expense.list_recent');
  assert.deepEqual(h.calls[0].input, h.request.preparedPlan!.proposedCalls[0]!.input);
  assert.deepEqual(h.calls[0].ctx.inputEvidence, h.request.inputEvidence);
});

for (const fault of ['missing', 'forged'] as const) it(`gateway still rejects ${fault} fixed-read semantic source refs before any tool call`, async () => {
  const h = await fixture(), item = h.request.semanticSubrequests![0]!;
  if (fault === 'missing') delete item.evidenceRefs;
  else item.evidenceRefs![0]!.rawSha256 = 'f'.repeat(64);
  assert.equal(parseLineAiSemanticSubrequests(h.request.semanticSubrequests, h.request.messageText, h.request.inputEvidence), undefined);
  const response = await h.run();
  assert.equal(response.errorCode, 'AI_CONTRACT_UNSUPPORTED');
  assert.equal(response.refusalReason, 'tool_unavailable');
  assert.equal(response.refused, true);
  assert.equal(h.calls.length, 0);
});
