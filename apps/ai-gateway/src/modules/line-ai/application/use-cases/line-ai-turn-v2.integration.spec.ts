import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
  PUBLIC_LOOKUP_SYSTEM_PROMPT,
  aiBudgetV2CallAllowed,
  aiBudgetV2RepairsBefore,
  createLineAiInputEvidence,
  extractValueCandidatesV2,
  publicLookupPolicy,
  type AiBudgetGrantV2,
  type LineAiSemanticSubrequestV2,
} from '@watchdog-bms/contracts';
import { drainUsage, runWithUsageContext } from '../../../../common/usage/usage-context';
import { ToolPolicyEnforcerService } from '../../../../common/ai/tool-policy-enforcer.service';
import { LineAiTurnUseCase } from './line-ai-turn.use-case';
import { OrchestratorAgent } from '../../agents/orchestrator.agent';
import { ErpToolClient } from '../../infrastructure/erp-tool.client';
import { AI_BUDGET_V2_SUPPORTED } from '../../../../common/usage/ai-budget-provider';

const COMPANY = 'company-private-canary';
const USER = 'user-private-canary';
const MEMBERSHIP = 'membership-private-canary';
const BRANCH = 'branch-private-canary';
const LOCATION = 'location-private-canary';
const CHAT = 'chat-private-canary';
const HISTORY = 'conversation-history-private-canary';
const MODEL = 'gpt-4.1-mini';
const REGION = 'global';
const API_BASE = 'https://api.test/v1';
const PUBLIC_QUESTION = 'อัตราดอกเบี้ยนโยบายล่าสุดของไทยเท่าไร';

type Scenario = {
  messageText: string;
  subrequests: Array<Pick<LineAiSemanticSubrequestV2, 'kind' | 'goal'> & Partial<Pick<LineAiSemanticSubrequestV2, 'dependsOn' | 'writeIntent' | 'requestedFilters'>>>;
  controls?: string[];
  answers: string[];
  apiResults?: Record<string, Record<string, unknown>>;
  permissions?: string[];
  reimbursementDraftWriteEnabled?: boolean;
  selectedKnowledgeCardIds?: string[];
  conversationContext?: Record<string, unknown>;
  /** The narrowed lane: slots and where the turn resumes (ordinal 2 = the intake spent its repair). */
  maxTurnSlots?: 2 | 4;
  nextOrdinal?: number;
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function completed(text: string): unknown {
  return { status: 'completed', output_text: text, usage: { input_tokens: 48, output_tokens: 14, input_tokens_details: { cached_tokens: 0 } } };
}

function publicSearchResponse(): unknown {
  const url = 'https://www.bot.or.th/en/our-roles/monetary-policy.html';
  const text = 'ธนาคารแห่งประเทศไทยเผยแพร่ข้อมูลอัตราดอกเบี้ยนโยบาย';
  return { status: 'completed', usage: { input_tokens: 68, output_tokens: 24, input_tokens_details: { cached_tokens: 0 } }, output: [
    { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ url }] } },
    { type: 'message', content: [{ type: 'output_text', text, annotations: [{ type: 'url_citation', url, title: 'ธนาคารแห่งประเทศไทย', start_index: 0, end_index: text.length }] }] },
  ] };
}

async function makeScenario(scenario: Scenario) {
  const turnKey = `turn-${Math.random().toString(36).slice(2, 10)}`;
  const built = await createLineAiInputEvidence({
    turnKey,
    parts: [{ partId: `part-${turnKey}`, eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: scenario.messageText }],
  });
  assert.ok(built);
  const evidence = built.inputEvidence;
  const candidates = await extractValueCandidatesV2(evidence, '2026-09-27');
  assert.ok(candidates);
  const part = evidence.parts[0]!;
  const sourceRef = { partId: part.partId, startUtf16: 0, endUtf16: part.rawText.length, rawSha256: part.rawSha256 };
  const semanticSubrequests = scenario.subrequests.map((item, index) => ({
    index, ...item, requiredEvidence: [], requestedFilters: item.requestedFilters ?? {}, dependsOn: item.dependsOn ?? [], evidenceRefs: [sourceRef],
  }));
  const now = Date.now();
  const profiles = new Set<string>(['line-answer/2']);
  if (scenario.controls?.length) profiles.add('line-control/2');
  if (scenario.subrequests.some((item) => item.kind === 'public')) profiles.add('public-lookup/2');
  const grant: AiBudgetGrantV2 = {
    version: 2, turnKey, authorityKind: 'webhook_event', authorityId: `event-${turnKey}`,
    channelOwnerDigest: 'b'.repeat(64), attemptKey: `attempt-${turnKey}`, monthKey: '2026-09', payerCompanyId: COMPANY,
    model: { provider: 'openai', modelId: MODEL, region: REGION }, allowedProfileIds: [...profiles] as AiBudgetGrantV2['allowedProfileIds'],
    profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2, maxTurnSlots: scenario.maxTurnSlots ?? 4, maxRepairs: 1,
    admittedAtMs: now - 1_000, workDeadlineAtMs: now + 60_000, finalDeadlineAtMs: now + 90_000,
    nonce: `nonce-${turnKey}`, issuerVersion: 'api-test-v2', nextOrdinal: scenario.nextOrdinal ?? 1, signature: 'c'.repeat(64),
  };
  const config = {
    modelProvider: 'openai', openAiApiKey: 'synthetic-key', openAiModel: MODEL, openAiProcessingRegion: REGION,
    approvedAiProviders: ['openai'], approvedAiModelIds: [MODEL], approvedAiRegions: [REGION],
    erpCoreInternalUrl: API_BASE, aiGatewayInternalSecret: 'synthetic-internal-secret', aiToolTimeoutMs: 5_000,
    aiToolPolicyEnforced: true, aiToolAuditEnabled: true, aiFinalMutationEnabled: false,
    aiMaxToolCalls: 8, lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local',
    lineAiDraftEditEnabled: false, lineAiReimbursementDraftWriteEnabled: scenario.reimbursementDraftWriteEnabled === true, lineAiPublicLookupEnabled: true,
    lineAiApprovedKnowledgeEnabled: !!scenario.selectedKnowledgeCardIds,
  } as any;
  const erp = new ErpToolClient(config, new ToolPolicyEnforcerService(config));
  const useCase = new LineAiTurnUseCase(erp, new OrchestratorAgent(erp, config), config, {} as any);
  const req = {
    requestId: `request-${turnKey}`, webhookEventId: `event-${turnKey}`, messageText: built.messageText,
    messagePreviewHash: 'd'.repeat(16), inputEvidence: evidence, valueCandidates: candidates,
    contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'], budgetGrantV2: grant,
    semanticSubrequests, actorDelegations: {
      'expense.get_breakdown': ['read-delegation-v2'], 'public.lookup': ['public-delegation-v2'],
      'reimbursement.draft.get_options': ['reimbursement-options-delegation-v2'],
      'reimbursement.draft.preview_create': ['reimbursement-preview-delegation-v2'],
    },
    userContext: {
      lineUserId: 'line-id-private-canary', internalUserId: USER, companyId: COMPANY, membershipId: MEMBERSHIP,
      permissions: scenario.permissions ?? ['ai.tool.invoke', 'expense.read'], roles: ['owner'], branchIds: [BRANCH], locationIds: [LOCATION],
      locale: 'th-TH', chatKeyHash: CHAT,
    },
    conversationContext: scenario.conversationContext ?? { windowMinutes: 15, maxTurns: 15,
      recentTurns: [{ at: new Date().toISOString(), userMessagePreview: HISTORY }] },
    ...(scenario.selectedKnowledgeCardIds ? { approvedKnowledge: true, selectedKnowledgeCardIds: scenario.selectedKnowledgeCardIds,
      entitledFeatureKeys: ['expenses'] } : {}),
  } as any;

  const originalFetch = globalThis.fetch;
  const steps: Array<{ invocation: Record<string, any>; repair: boolean }> = [];
  const refusedSteps: Array<{ ordinal: number; repair: boolean }> = [];
  // The API authority's own repair count: the intake's repair, when the turn resumes past it.
  let authorityRepairs = aiBudgetV2RepairsBefore(grant);
  const settlements: Array<Record<string, any>> = [];
  const apiCalls: Array<{ body: Record<string, any>; actorDelegation: string | null }> = [];
  const providerRequests: Array<Record<string, any>> = [];
  const events: string[] = [];
  const controls = [...(scenario.controls ?? [])];
  const answers = [...scenario.answers];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const body = bodyText ? JSON.parse(bodyText) as Record<string, any> : {};
    if (url.endsWith('/internal/ai/budget-step')) {
      const invocation = body.invocation as Record<string, any>;
      if (!aiBudgetV2CallAllowed(grant, invocation.ordinal, body.repair === true, authorityRepairs)) {
        refusedSteps.push({ ordinal: invocation.ordinal, repair: body.repair === true });
        return response({ ok: false, code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' });
      }
      if (body.repair === true) authorityRepairs += 1;
      steps.push({ invocation, repair: body.repair === true });
      events.push(`step:${invocation.ordinal}`);
      return response({ ok: true, envelope: {
        ...invocation, version: 2, reservationId: `reservation-${invocation.ordinal}`,
        invocationKey: `${COMPANY}#${grant.attemptKey}#provider-v2#${invocation.ordinal}`, tariffVersion: 'tariff-test-v2',
      } });
    }
    if (url.endsWith('/internal/ai/budget-settle')) {
      settlements.push(body);
      events.push(`settle:${body.invocationKey}`);
      return response({ result: 'settled' });
    }
    if (url.endsWith('/internal/ai/tools/invoke')) {
      apiCalls.push({ body, actorDelegation: new Headers(init?.headers).get('x-actor-delegation') });
      events.push(`api:${body.toolName}`);
      if (body.toolName === 'public.lookup') {
        const request = body.input;
        return response({ toolName: body.toolName, status: 'ok', asOf: new Date().toISOString(),
          sourceRefs: [{ label: 'Public lookup admitted', module: 'public', entityType: 'public_lookup_admission', permissionChecked: true }],
          data: { admissionOnly: true, approvedLookup: { request, policy: publicLookupPolicy(request) } } });
      }
      const result = scenario.apiResults?.[body.toolName];
      return response(result ?? { toolName: body.toolName, status: 'unavailable', sourceRefs: [], errorCode: 'UNEXPECTED_TOOL' });
    }
    if (url === 'https://api.openai.com/v1/responses') {
      providerRequests.push(body);
      if (body.instructions === PUBLIC_LOOKUP_SYSTEM_PROMPT) { events.push('vendor:public'); return response(publicSearchResponse()); }
      if (String(body.instructions).startsWith('You plan one complete LINE request.')) {
        events.push('vendor:control');
        const next = controls.shift();
        return response(completed(next ?? '{"calls":[],"questions":[]}'));
      }
      events.push('vendor:answer');
      const next = answers.shift();
      return response(completed(next ?? '{"answers":[]}'));
    }
    return response({ error: `Unexpected integration-test URL: ${url}` }, 500);
  }) as typeof fetch;

  try {
    const budget = { status: 'active-v2' as const, grant, inputDigest: evidence.joinedSha256,
      sourceRoute: 'line-turn', requestId: req.requestId, calls: grant.nextOrdinal ?? 1, repairCount: aiBudgetV2RepairsBefore(grant) };
    const result = await runWithUsageContext({ companyId: COMPANY, budget }, async () => ({
      response: await useCase.execute(req), usage: drainUsage(),
    }));
    assert.equal(steps.length, settlements.length, 'each paid provider call settled evidence');
    for (const step of steps) {
      const key = `${COMPANY}#${grant.attemptKey}#provider-v2#${step.invocation.ordinal}`;
      const settlement = settlements.find((item) => item.invocationKey === key);
      assert.ok(settlement, `missing settlement for ordinal ${step.invocation.ordinal}`);
      const evidence = result.usage.find(entry => entry.invocationKey === key);
      assert.ok(evidence);
      assert.equal(settlement.usage.ok, evidence.ok);
      if (!evidence.ok) assert.equal(settlement.usage.errorCode, 'OUTPUT_UNUSABLE');
      assert.ok(settlement.usage.inputTokens <= step.invocation.inputTokenBound, `input usage exceeded ordinal ${step.invocation.ordinal} reservation`);
      assert.ok(settlement.usage.outputTokens <= step.invocation.requestedOutputTokens, `output usage exceeded ordinal ${step.invocation.ordinal} reservation`);
    }
    return { ...result, req, grant, evidence, candidates, budget, steps, refusedSteps, settlements, apiCalls, providerRequests, events };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const expenseSummary = {
  'expense.get_breakdown': {
    toolName: 'expense.get_breakdown', status: 'ok', data: { total: '420.00', currency: 'THB' },
    sourceRefs: [{ id: 'expense-summary-source', label: 'Expense summary', module: 'expenses', entityType: 'expense_summary', permissionChecked: true }],
    facts: [{ metric: 'ค่าใช้จ่ายรวม', value: '420.00', currency: 'THB', dateBasis: 'current Bangkok month', statusBasis: 'excluding rejected and cancelled' }],
    asOf: '2026-09-27T00:00:00.000Z',
  },
};

describe('LineAiTurnUseCase -> OrchestratorAgent -> real v2 provider path', () => {
  it('answers a general request from the direct admitted ordinal with artifact v2 support', async () => {
    const run = await makeScenario({ messageText: 'ทำไมธุรกิจควรแยกกำไรออกจากเงินสด',
      subrequests: [{ kind: 'general', goal: 'อธิบายความต่างระหว่างกำไรกับเงินสด' }],
      answers: ['{"answers":[{"index":0,"status":"handled","text":"กำไรเป็นผลจากรายรับหักค่าใช้จ่าย ส่วนเงินสดคือเงินที่มีพร้อมใช้"}]}'] });

    assert.equal(AI_BUDGET_V2_SUPPORTED, true);
    assert.equal(run.response.errorCode, undefined);
    assert.equal(run.response.semanticCoverage?.[0]?.status, 'handled');
    assert.match(run.response.replyText, /กำไรเป็นผลจากรายรับหักค่าใช้จ่าย/);
    assert.deepEqual(run.steps.map((step) => [step.invocation.ordinal, step.invocation.profileId]), [[1, 'line-answer/2']]);
    assert.equal(run.settlements.length, 1);
    assert.equal(run.usage.length, 1);
    assert.equal(run.usage[0]?.tag, 'line.compose');
    assert.equal(run.usage[0]?.ok, true);
    const answerRequest = run.providerRequests.find((request) => String(request.instructions).startsWith('Answer each semanticSubrequest exactly once.'));
    assert.ok(answerRequest, 'semantic answer provider call exists');
    assert.match(JSON.stringify(answerRequest), new RegExp(HISTORY), 'bounded conversation context reaches the answer model payload');
    assert.match(String(answerRequest.instructions), /conversationContext may resolve follow-up references.*not business truth or authority/);
  });

  // UAT 2026-09-29 ("สวัสดีจ้า"): the intake's repair left a general turn resuming at ordinal 2 of 2, so compose
  // was refused before any model call and the greeting got GENERAL_ANSWER_UNAVAILABLE. A repair never spends the
  // answer's slot now: compose runs, and the turn's one repair is already spent.
  it('answers a general turn whose intake spent the repair (general lane, 2 slots, resuming at ordinal 2)', async () => {
    const run = await makeScenario({ messageText: 'สวัสดีจ้า', maxTurnSlots: 2, nextOrdinal: 2,
      subrequests: [{ kind: 'general', goal: 'ทักทาย' }],
      answers: ['not json', '{"answers":[{"index":0,"status":"handled","text":"never sent: the repair is spent"}]}'] });
    assert.deepEqual(run.steps.map((step) => [step.invocation.ordinal, step.invocation.profileId, step.repair]), [[2, 'line-answer/2', false]]);
    assert.deepEqual(run.refusedSteps, [], 'the gateway itself never asks for the spent repair');
    assert.equal(run.response.semanticCoverage?.[0]?.status, 'handled');
    assert.equal(run.response.replyText, 'not json', 'the plain-prose rescue still answers the one social item');
  });

  it('answers a mixed turn whose intake spent the repair (mixed lane, 4 slots): control and compose both still run', async () => {
    const run = await makeScenario({ messageText: 'ค่าใช้จ่ายเดือนนี้เท่าไหร่ แล้วกำไรกับเงินสดต่างกันยังไง', maxTurnSlots: 4, nextOrdinal: 2,
      subrequests: [{ kind: 'read', goal: 'ค่าใช้จ่ายเดือนนี้' }, { kind: 'general', goal: 'กำไรกับเงินสด' }],
      controls: ['{"calls":[{"index":0,"toolName":"expense.get_breakdown","input":{}}],"questions":[]}'],
      answers: ['{"answers":[{"index":0,"status":"handled","text":"ค่าใช้จ่ายรวม 420.00 บาท","sourceRefIds":["expense-summary-source"]},{"index":1,"status":"handled","text":"กำไรคือผลต่างรายรับกับรายจ่าย เงินสดคือเงินที่มีจริง"}]}'],
      apiResults: expenseSummary });
    assert.deepEqual(run.steps.map((step) => [step.invocation.ordinal, step.invocation.profileId]), [[2, 'line-control/2'], [3, 'line-answer/2']]);
    assert.deepEqual(run.response.semanticCoverage?.map((item) => item.status), ['handled', 'handled']);
  });

  it('covers a business read and independent general answer with permission checked source grounding', async () => {
    const run = await makeScenario({ messageText: 'สรุปค่าใช้จ่ายรวมและอธิบายกำไรคืออะไร',
      subrequests: [{ kind: 'read', goal: 'สรุปค่าใช้จ่ายรวม' }, { kind: 'general', goal: 'อธิบายว่ากำไรคืออะไร' }],
      controls: ['{"calls":[{"index":0,"toolName":"expense.get_breakdown","input":{}}],"questions":[]}'],
      answers: ['{"answers":[{"index":0,"status":"handled","text":"ค่าใช้จ่ายรวม 420.00 บาท","sourceRefIds":["expense-summary-source"]},{"index":1,"status":"handled","text":"กำไรคือรายรับหักค่าใช้จ่าย","sourceRefIds":[]}]}'],
      apiResults: expenseSummary });

    assert.equal(run.response.errorCode, undefined);
    assert.deepEqual(run.response.semanticCoverage?.map((item) => [item.index, item.status]), [[0, 'handled'], [1, 'handled']]);
    assert.deepEqual(run.response.semanticCoverage?.[0]?.sourceRefIds, ['expense-summary-source']);
    assert.ok(run.response.sourceRefs.some((source) => source.id === 'expense-summary-source' && source.permissionChecked));
    assert.match(run.response.replyText, /420\.00 บาท/);
    assert.deepEqual(run.steps.map((step) => [step.invocation.ordinal, step.invocation.profileId]), [[1, 'line-control/2'], [2, 'line-answer/2']]);
    assert.equal(run.apiCalls.length, 1);
    const api = run.apiCalls[0]!;
    assert.equal(api.body.toolName, 'expense.get_breakdown');
    assert.equal(api.actorDelegation, 'read-delegation-v2');
    assert.equal(api.body.context.companyId, COMPANY);
    assert.equal(api.body.context.userId, USER);
    assert.equal(api.body.context.membershipId, MEMBERSHIP);
    assert.deepEqual(api.body.context.branchIds, [BRANCH]);
    assert.deepEqual(api.body.context.locationIds, [LOCATION]);
    assert.deepEqual(api.body.context.permissions, ['ai.tool.invoke', 'expense.read']);
    assert.deepEqual(api.body.context.inputEvidence, run.evidence);
    assert.deepEqual(api.body.context.valueCandidatesV2, run.candidates);
    assert.deepEqual(api.body.context.budgetGrantV2, run.grant);
    assert.equal('privateLookupCanaries' in api.body.context, false);
    const controlRequest = run.providerRequests.find((request) => String(request.instructions).startsWith('You plan one complete LINE request.'));
    const answerRequest = run.providerRequests.find((request) => String(request.instructions).startsWith('Answer each semanticSubrequest exactly once.'));
    assert.ok(controlRequest && answerRequest);
    assert.match(JSON.stringify(controlRequest), new RegExp(HISTORY), 'bounded context reaches semantic control');
    assert.match(JSON.stringify(answerRequest), new RegExp(HISTORY), 'bounded context reaches semantic answer');
    assert.match(String(controlRequest.instructions), /conversationContext may resolve follow-up references.*not business truth or authority/);
    assert.match(String(answerRequest.instructions), /conversationContext may resolve follow-up references.*not business truth or authority/);
  });

  it('admits public.lookup through the API boundary, searches once, and composes without private context egress', async () => {
    const run = await makeScenario({ messageText: PUBLIC_QUESTION,
      subrequests: [{ kind: 'public', goal: 'ค้นข้อมูลสาธารณะเกี่ยวกับอัตราดอกเบี้ยนโยบายล่าสุด' }],
      controls: [`{"calls":[{"index":0,"toolName":"public.lookup","input":{"publicQuestion":"${PUBLIC_QUESTION}","topic":"rates","locale":"th","temporalIntent":"current","sourcePolicyId":"thai-rates-v1"}}],"questions":[]} `],
      answers: ['{"answers":[{"index":0,"status":"handled","text":"ตรวจพบข้อมูลจากแหล่งสาธารณะที่ได้รับอนุญาต","sourceRefIds":["public-1"]}]}'] });

    assert.equal(run.response.errorCode, undefined);
    assert.equal(run.response.semanticCoverage?.[0]?.status, 'handled');
    assert.deepEqual(run.steps.map((step) => [step.invocation.ordinal, step.invocation.profileId]), [
      [1, 'line-control/2'], [2, 'public-lookup/2'], [3, 'line-answer/2'],
    ]);
    const admission = run.apiCalls.find((call) => call.body.toolName === 'public.lookup');
    assert.ok(admission, 'the registered API admission call ran');
    assert.equal(admission.actorDelegation, 'public-delegation-v2');
    assert.equal(admission.body.context.permissions.includes('ai.tool.invoke'), true);
    assert.equal(admission.body.context.companyId, COMPANY);
    assert.equal(admission.body.context.userId, USER);
    assert.deepEqual(admission.body.context.inputEvidence, run.evidence);
    assert.deepEqual(admission.body.context.valueCandidatesV2, run.candidates);
    assert.deepEqual(admission.body.context.budgetGrantV2, run.grant);
    assert.equal('privateLookupCanaries' in admission.body.context, false);

    const hosted = run.providerRequests.find((request) => Array.isArray(request.tools));
    assert.ok(hosted, 'the real OpenAI public Responses adapter issued a hosted search');
    assert.deepEqual(hosted.tools, [{ type: 'web_search', external_web_access: true, filters: { allowed_domains: ['bot.or.th'] } }]);
    assert.equal(hosted.tool_choice, 'required');
    assert.equal(hosted.max_tool_calls, 2);
    assert.equal(hosted.store, false);
    assert.deepEqual(run.events.filter((item) => item.startsWith('vendor:') || item === 'api:public.lookup'), [
      'vendor:control', 'api:public.lookup', 'vendor:public', 'vendor:answer',
    ]);
    const vendorPayload = JSON.stringify(hosted);
    for (const privateValue of [COMPANY, USER, MEMBERSHIP, BRANCH, LOCATION, CHAT, HISTORY]) assert.equal(vendorPayload.includes(privateValue), false, privateValue);
    assert.equal(run.settlements.find((item) => item.usage.tag === 'line.public.lookup')?.externalUnits, 1);
    assert.equal(run.settlements.length, 3);
    assert.equal(run.usage.length, 3);
  });

  it('handles API-issued reimbursement options and a preview without claiming the request was saved', async () => {
    const taskId = '40000000-0000-4000-8000-000000000001';
    const actionId = '40000000-0000-4000-8000-000000000002';
    const run = await makeScenario({ messageText: 'ช่วยเตรียมร่างใบเบิกค่าเดินทาง 420 บาท',
      subrequests: [{ kind: 'write', goal: 'เตรียมร่างใบเบิกค่าเดินทางจำนวน 420 บาท' }],
      reimbursementDraftWriteEnabled: true, permissions: ['ai.tool.invoke', 'reimbursement.create'],
      controls: [
        '{"calls":[{"index":0,"toolName":"reimbursement.draft.get_options","input":{"operation":"CREATE","subrequestIndex":0}}],"questions":[]}',
        `{"calls":[{"index":0,"toolName":"reimbursement.draft.preview_create","input":{"action":{"taskId":"${taskId}","actionId":"${actionId}"},"proposal":{"schemaVersion":1,"taskId":"${taskId}","taskRevision":0,"operation":"CREATE","fields":{},"lineChanges":[]}}}],"questions":[]}`,
      ],
      answers: ['{"answers":[{"index":0,"status":"handled","text":"ได้ตรวจสอบข้อมูลสำหรับร่างแล้ว","sourceRefIds":["reimbursement-preview-source"]}]}'],
      apiResults: {
        'reimbursement.draft.get_options': {
          toolName: 'reimbursement.draft.get_options', status: 'ok', asOf: '2026-09-27T00:00:00.000Z',
          sourceRefs: [{ id: 'reimbursement-options-source', label: 'Reimbursement options', module: 'reimbursements', entityType: 'reimbursement_draft_action', entityId: actionId, sourceType: 'ACTION', permissionChecked: true }],
          data: { reimbursementDraft: { status: 'needs_fields', taskId, actionId, operation: 'CREATE', fieldPaths: ['requesterChoiceId'] }, actionLocator: { taskId, actionId, operation: 'CREATE' } },
        },
        'reimbursement.draft.preview_create': {
          toolName: 'reimbursement.draft.preview_create', status: 'ok', asOf: '2026-09-27T00:00:00.000Z',
          sourceRefs: [{ id: 'reimbursement-preview-source', label: 'Reimbursement preview', module: 'reimbursements', entityType: 'reimbursement_draft_action', entityId: actionId, sourceType: 'ACTION', permissionChecked: true }],
          data: { reimbursementDraft: { status: 'preview', actionId, operation: 'CREATE', previewRevision: 1 } },
        },
      },
    });

    assert.equal(run.response.errorCode, undefined);
    assert.deepEqual(run.apiCalls.map((call) => call.body.toolName), [
      'reimbursement.draft.get_options', 'reimbursement.draft.preview_create',
    ]);
    // NAT-04 (2026-09-30): a draft write is answered by the fixed draft text and the API's own card, so no compose call.
    assert.deepEqual(run.steps.map((step) => [step.invocation.ordinal, step.invocation.profileId]), [
      [1, 'line-control/2'], [2, 'line-control/2'],
    ]);
    const [options, preview] = run.apiCalls;
    assert.equal(options?.actorDelegation, 'reimbursement-options-delegation-v2');
    assert.equal(options?.body.context.permissions.includes('reimbursement.create'), true);
    assert.deepEqual(options?.body.context.inputEvidence, run.evidence);
    assert.deepEqual(options?.body.context.valueCandidatesV2, run.candidates);
    assert.equal(preview?.actorDelegation, 'reimbursement-preview-delegation-v2');
    assert.equal(preview?.body.input.action.taskId, taskId);
    assert.equal(preview?.body.input.action.actionId, actionId);
    assert.equal(run.response.semanticCoverage?.[0]?.status, 'needs_user');
    assert.equal(run.response.semanticCoverage?.[0]?.reasonCode, 'CONFIRMATION_REQUIRED');
    assert.match(run.response.replyText, /ยังไม่ได้บันทึกหรือยื่นใบเบิก/);
    assert.doesNotMatch(run.response.replyText, /บันทึกแล้ว|ยื่นแล้ว|อนุมัติแล้ว|จ่ายแล้ว/);
  });

  it('repairs missing or duplicate semantic coverage once using the next global ordinal', async () => {
    const run = await makeScenario({ messageText: 'อธิบายความต่างระหว่างกำไรกับเงินสด',
      subrequests: [{ kind: 'general', goal: 'อธิบายความต่างระหว่างกำไรกับเงินสด' }],
      answers: [
        '{"answers":[{"index":0,"status":"handled","text":"คำตอบแรก"},{"index":0,"status":"handled","text":"คำตอบซ้ำ"}]}',
        '{"answers":[{"index":0,"status":"handled","text":"กำไรเป็นผลการดำเนินงาน ส่วนเงินสดคือเงินพร้อมใช้"}]}',
      ] });

    assert.equal(run.response.errorCode, undefined);
    assert.deepEqual(run.response.semanticCoverage?.map((item) => [item.index, item.status]), [[0, 'handled']]);
    assert.deepEqual(run.steps.map((step) => [step.invocation.ordinal, step.repair]), [[1, false], [2, true]]);
    assert.equal(run.budget.repairCount, 1);
    assert.equal(run.settlements.length, 2);
    assert.equal(run.usage.length, 2);
  });

  // The 2026-09-28 eval's knowledge questions ("หัก ณ ที่จ่ายคืออะไรครับ", 8 tuning + 2 held-out turns) got one
  // rejected compose and then GENERAL_ANSWER_UNAVAILABLE: a two-slot general lane had no room for the repair.
  it('gives a two-slot general lane its compose repair: the repair is not an answer slot', async () => {
    const run = await makeScenario({ messageText: 'กำไรต่างจากเงินสดยังไง', maxTurnSlots: 2, nextOrdinal: 1,
      subrequests: [{ kind: 'general', goal: 'อธิบายกำไรกับเงินสด' }],
      answers: [
        '{"answers":[{"index":0,"status":"handled","text":"คำตอบแรก"},{"index":0,"status":"handled","text":"คำตอบซ้ำ"}]}',
        '{"answers":[{"index":0,"status":"handled","text":"กำไรคือผลรายได้หักค่าใช้จ่าย ส่วนเงินสดคือเงินที่มีอยู่ค่ะ"}]}',
      ] });
    assert.deepEqual(run.steps.map((step) => [step.invocation.ordinal, step.repair]), [[1, false], [2, true]]);
    assert.deepEqual(run.response.semanticCoverage?.map((item) => item.status), ['handled']);
    assert.match(run.response.replyText, /กำไรคือผลรายได้/);
  });

  it('skips composition when control already resolves every clause, while preserving inventory order', async () => {
    const subrequests = [{ kind: 'read' as const, goal: 'ตรวจข้อแรก' }, { kind: 'read' as const, goal: 'ตรวจข้อสอง' }];
    const cases = [
      { control: '{}', reasons: ['SEMANTIC_CONTROL_UNAVAILABLE', 'SEMANTIC_CONTROL_UNAVAILABLE'] },
      { control: JSON.stringify({ calls: [], questions: [{ index: 1, text: 'ถามข้อสอง' }, { index: 0, text: 'ถามข้อแรก' }] }),
        reasons: ['MISSING_REQUIRED_INPUT', 'MISSING_REQUIRED_INPUT'] },
    ];
    for (const [index, candidate] of cases.entries()) {
      const run = await makeScenario({ messageText: `ตรวจสองข้อ ${index}`, subrequests, controls: [candidate.control], answers: [] });
      assert.deepEqual(run.response.semanticCoverage?.map(item => [item.index, item.reasonCode]), [[0, candidate.reasons[0]], [1, candidate.reasons[1]]]);
      assert.deepEqual(run.steps.map(step => step.invocation.profileId), ['line-control/2']);
      assert.equal(run.events.includes('vendor:answer'), false);
    }
  });

  it('binds the canonical status and exact historical period when a read follow-up changes the breakdown', async () => {
    const requestedFilters = { fromDate: '2026-09-01', toDate: '2026-09-27', documentStatus: 'confirmed' };
    const run = await makeScenario({ messageText: 'แยกตามหมวดให้ดูหน่อย',
      subrequests: [{ kind: 'read', goal: 'แยกค่าใช้จ่ายเดิมตามหมวด', requestedFilters }],
      conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: [{ at: '2026-09-27T05:00:00.000Z',
        userMessagePreview: 'เดือนนี้เอาเฉพาะรายการยืนยันแล้ว', userMessagePreviewComplete: true }] },
      controls: ['{"calls":[{"index":0,"toolName":"expense.get_breakdown","input":{}}],"questions":[]}'],
      answers: ['{"answers":[{"index":0,"status":"handled","text":"ค่าใช้จ่ายยืนยันแล้ว 420.00 บาท","sourceRefIds":["expense-summary-source"]}]}'],
      apiResults: expenseSummary });

    assert.equal(run.apiCalls.length, 1);
    assert.deepEqual(run.apiCalls[0]?.body.input, {
      fromDate: '2026-09-01', toDate: '2026-09-27', documentStatus: 'CONFIRMED',
    });
    const control = run.providerRequests.find(request => String(request.instructions).startsWith('You plan one complete LINE request.'));
    assert.ok(control);
    assert.match(String(control.instructions), /Preserve every canonical requestedFilter/);
    assert.match(JSON.stringify(control), /readContextCandidates/);
  });

  it('rejects a control call that conflicts with an accepted read filter instead of widening the ERP read', async () => {
    const run = await makeScenario({ messageText: 'แยกตามหมวดให้ดูหน่อย',
      subrequests: [{ kind: 'read', goal: 'แยกค่าใช้จ่ายเดิมตามหมวด', requestedFilters: {
        fromDate: '2026-09-01', toDate: '2026-09-27', documentStatus: 'CONFIRMED',
      } }],
      conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: [{ at: '2026-09-27T05:00:00.000Z',
        userMessagePreview: 'เดือนนี้เอาเฉพาะรายการยืนยันแล้ว', userMessagePreviewComplete: true }] },
      controls: ['{"calls":[{"index":0,"toolName":"expense.get_breakdown","input":{"documentStatus":"DRAFT"}}],"questions":[]}'],
      answers: [] });

    assert.equal(run.apiCalls.length, 0);
    assert.equal(run.response.semanticCoverage?.[0]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
  });

  // UAT 2026-09-29 ("ของเดือนสิงหาละ" → "ยังดึงข้อมูลไม่ได้"): a period the resolver could not read used to sink the
  // whole read as TOOL_INPUT_NOT_AUTHORIZED + READ_UNAVAILABLE. It now asks back, naming the word it did not read.
  it('asks back naming the unread month word instead of a silent read-unavailable dead end', async () => {
    const run = await makeScenario({ messageText: 'ของเดือนสิงโตละ',
      subrequests: [{ kind: 'read', goal: 'ค่าใช้จ่ายเดือนสิงหาคม', requestedFilters: { fromDate: '2026-08-01', toDate: '2026-08-31' } }],
      controls: ['{"calls":[{"index":0,"toolName":"expense.get_breakdown","input":{"fromDate":"2026-08-01","toDate":"2026-08-31"}}],"questions":[]}'],
      answers: [] });
    assert.equal(run.apiCalls.length, 0, 'an ungrounded period never reaches the ERP read');
    const coverage = run.response.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'needs_user');
    assert.equal(coverage?.reasonCode, 'READ_FILTER_NOT_UNDERSTOOD');
    assert.match(String(coverage?.question), /ชื่อเดือน "สิงโตละ" หมายถึงเดือนไหนคะ/);
    assert.doesNotMatch(run.response.replyText, /ยังดึงข้อมูลส่วนนี้ไม่ได้/);
  });

  it('keeps the historical period but omits a reset status filter instead of inventing null or ALL', async () => {
    const run = await makeScenario({ messageText: 'รวมรายการร่างด้วย ไม่เอาเฉพาะยืนยันแล้ว',
      subrequests: [{ kind: 'read', goal: 'แยกค่าใช้จ่ายเดิมรวมรายการร่าง', requestedFilters: {
        fromDate: '2026-09-01', toDate: '2026-09-27',
      } }],
      conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: [{ at: '2026-09-27T05:00:00.000Z',
        userMessagePreview: 'เดือนนี้เอาเฉพาะรายการยืนยันแล้ว', userMessagePreviewComplete: true }] },
      controls: ['{"calls":[{"index":0,"toolName":"expense.get_breakdown","input":{}}],"questions":[]}'],
      answers: ['{"answers":[{"index":0,"status":"handled","text":"ค่าใช้จ่ายรวม 420.00 บาท","sourceRefIds":["expense-summary-source"]}]}'],
      apiResults: expenseSummary });

    assert.equal(run.apiCalls.length, 1);
    assert.deepEqual(run.apiCalls[0]?.body.input, { fromDate: '2026-09-01', toDate: '2026-09-27' });
  });

  it('refuses a business number that does not match the permission checked fact', async () => {
    const run = await makeScenario({ messageText: 'สรุปค่าใช้จ่ายรวมและอธิบายกำไรคืออะไร',
      subrequests: [{ kind: 'read', goal: 'สรุปค่าใช้จ่ายรวม' }, { kind: 'general', goal: 'อธิบายว่ากำไรคืออะไร' }],
      controls: ['{"calls":[{"index":0,"toolName":"expense.get_breakdown","input":{}}],"questions":[]}'],
      answers: ['{"answers":[{"index":0,"status":"handled","text":"ค่าใช้จ่ายรวม 999.00 บาท","sourceRefIds":["expense-summary-source"]},{"index":1,"status":"handled","text":"กำไรคือรายรับหักค่าใช้จ่าย","sourceRefIds":[]}]}'],
      apiResults: expenseSummary });

    assert.equal(run.response.errorCode, undefined);
    // C1(d): a grounding failure is a system outcome, not a customer question — `unsupported`
    // (never `needs_user`, which would leave a phantom wait no answer could ever resolve). No
    // deterministic family is enabled in this harness's plain config object, so it falls through
    // to the honest §8 terminal rather than a rendered fallback.
    assert.equal(run.response.semanticCoverage?.[0]?.status, 'unsupported');
    assert.equal(run.response.semanticCoverage?.[0]?.reasonCode, 'ANSWER_NUMBER_NOT_GROUNDED');
    assert.doesNotMatch(run.response.replyText, /999/);
    assert.match(run.response.replyText, /ดึงข้อมูลส่วนนี้ไม่ได้/);
    assert.equal(run.response.semanticCoverage?.[1]?.status, 'handled');
  });
});

it('does not let model-authored product buttons escape the reviewed-help boundary beside a general answer', async () => {
  const run = await makeScenario({ messageText: 'ใบเบิกต้องกดอะไร แล้วกำไรต่างจากเงินสดอย่างไร',
    subrequests: [{ kind: 'help', goal: 'ขั้นตอนใบเบิก' }, { kind: 'general', goal: 'กำไรกับเงินสด' }],
    answers: [JSON.stringify({ answers: [
      { index: 0, status: 'handled', text: 'กดปุ่ม MAGIC_AUTO_APPROVE_ALL แล้วระบบจะอนุมัติจ่ายให้อัตโนมัติ' },
      { index: 1, status: 'handled', text: 'กำไรกับเงินสดเป็นคนละมุมมองของธุรกิจ' },
    ] })] });
  assert.doesNotMatch(run.response.replyText, /MAGIC_AUTO_APPROVE_ALL|อนุมัติจ่ายให้อัตโนมัติ/);
  assert.match(run.response.replyText, /ยังไม่มีคู่มือที่ตรวจสอบแล้ว/);
  assert.match(run.response.replyText, /กำไรกับเงินสดเป็นคนละมุมมอง/);
  // Spec R-L3: "no reviewed guide yet" is a statement, not a question to the user, so it is terminal.
  assert.deepEqual(run.response.semanticCoverage?.map(item => item.status), ['unsupported', 'handled']);
  assert.equal(run.apiCalls.length, 0);
  // Owner action how-tos require an explicit reviewed action selector; its omission gets one bounded repair.
  assert.equal(run.events.filter(event => event === 'vendor:answer').length, 2);
  assert.ok(run.response.presentation?.cards.every(card => !card.chatActionId) ?? true, 'model-authored buttons never become actions');
});

it('answers pure help from the deterministic guide boundary without control or composition', async () => {
  const run = await makeScenario({ messageText: 'รายการยืนยันแล้ว แปลว่าจ่ายเงินแล้วหรือยัง',
    subrequests: [{ kind: 'help', goal: 'อธิบายสถานะยืนยันและชำระเงินของมั่งมี' }],
    selectedKnowledgeCardIds: ['expense.status'], answers: [] });
  assert.equal(run.response.semanticCoverage?.[0]?.status, 'handled');
  assert.equal(run.response.semanticCoverage?.[0]?.reasonCode, undefined);
  assert.match(run.response.replyText, /เอกสารยืนยันแล้วอาจรอจ่าย/);
  assert.equal(run.response.sourceRefs[0]?.entityType, 'approved_product_help');
  assert.match(run.response.sourceRefs[0]?.entityId ?? '', /:7:expense\.status:5$/);
  assert.equal(run.response.sourceRefs[0]?.permissionChecked, true);
  assert.deepEqual(run.steps, []);
  assert.deepEqual(run.providerRequests, []);
  assert.deepEqual(run.usage, []);
});


describe('v2 financial and dependency dispatch fences', () => {
  it('keeps both financial clauses pending without opening or merging a draft', async () => {
    const result = await makeScenario({ messageText: 'สร้างร่างเบิกค่าเดินทาง และสร้างร่างเบิกค่าอาหาร',
      subrequests: [{ kind: 'write', goal: 'เบิกค่าเดินทาง' }, { kind: 'write', goal: 'เบิกค่าอาหาร' }],
      reimbursementDraftWriteEnabled: true, permissions: ['ai.tool.invoke', 'reimbursement.create'],
      controls: [JSON.stringify({ calls: [0, 1].map(index => ({ index, toolName: 'reimbursement.draft.get_options', input: { operation: 'CREATE', subrequestIndex: index } })), questions: [] })],
      answers: [JSON.stringify({ answers: [0, 1].map(index => ({ index, status: 'handled', text: 'สร้างร่างแล้ว', sourceRefIds: [] })) })] });
    assert.equal(result.apiCalls.length, 0);
    assert.deepEqual(result.response.semanticCoverage?.map(item => [item.status, item.reasonCode]),
      [['needs_user', 'FINANCIAL_ACTION_SELECTION_REQUIRED'], ['needs_user', 'FINANCIAL_ACTION_SELECTION_REQUIRED']]);
  });

  it('does not run a dependent read before its source, even if the control orders it first', async () => {
    const result = await makeScenario({ messageText: 'สรุปค่าใช้จ่าย แล้วตรวจยอดจากผลสรุปนั้น',
      subrequests: [{ kind: 'read', goal: 'สรุปค่าใช้จ่าย' }, { kind: 'read', goal: 'ตรวจผลสรุป', dependsOn: [0] }],
      controls: [JSON.stringify({ calls: [1, 0].map(index => ({ index, toolName: 'expense.get_breakdown', input: {} })), questions: [] })],
      answers: [JSON.stringify({ answers: [0, 1].map(index => ({ index, status: 'handled', text: 'ค่าใช้จ่าย 420.00 THB', sourceRefIds: ['expense-summary-source'] })) })],
      apiResults: expenseSummary });
    assert.equal(result.apiCalls.length, 1);
    assert.equal(result.response.semanticCoverage?.[1]?.reasonCode, 'DEPENDENCY_SOURCE_PENDING');
    assert.equal(result.events.filter(event => event === 'vendor:answer').length, 1, 'the unresolved independent clause still composes once');
  });

  it('does not treat reimbursement options as a completed financial dependency', async () => {
    const result = await makeScenario({ messageText: 'สร้างร่างเบิก แล้วสรุปยอดหลังบันทึก',
      subrequests: [{ kind: 'write', goal: 'สร้างร่างเบิก' }, { kind: 'read', goal: 'ยอดหลังบันทึก', dependsOn: [0] }],
      reimbursementDraftWriteEnabled: true, permissions: ['ai.tool.invoke', 'reimbursement.create', 'expense.read'],
      controls: [JSON.stringify({ calls: [
        { index: 0, toolName: 'reimbursement.draft.get_options', input: { operation: 'CREATE', subrequestIndex: 0 } },
        { index: 1, toolName: 'expense.get_breakdown', input: {} }], questions: [] })],
      answers: [JSON.stringify({ answers: [{ index: 0, status: 'needs_user', text: 'เลือกข้อมูลร่าง', question: 'เลือกข้อมูลร่าง', sourceRefIds: [] },
        { index: 1, status: 'handled', text: 'ยอดหลังบันทึก 420.00 THB', sourceRefIds: ['expense-summary-source'] }] })],
      apiResults: { ...expenseSummary, 'reimbursement.draft.get_options': { toolName: 'reimbursement.draft.get_options', status: 'ok', data: { options: {} },
        sourceRefs: [{ id: 'options-source', module: 'reimbursements', entityType: 'draft_options', label: 'Options', permissionChecked: true }] } } });
    assert.deepEqual(result.apiCalls.map(call => call.body.toolName), ['reimbursement.draft.get_options']);
    assert.equal(result.response.semanticCoverage?.[1]?.reasonCode, 'DEPENDENCY_SOURCE_PENDING');
  });
});
