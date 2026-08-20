import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLineAiPreparedPlan } from '@watchdog-bms/contracts';
import type { LineAiTurnRequest, ToolResult } from '@watchdog-bms/contracts';
import { OrchestratorAgent } from './orchestrator.agent';
import { ResponseComposerAgent } from './response-composer.agent';
import { CoverageCriticAgent } from './coverage-critic.agent';
import { IntentRouterAgent } from './intent-router.agent';
import { LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES } from '../../../../../../scripts/line-ai-latency-autonomy.corpus';

// Real method-call counters (not just fetch): prove the eligible/terminal lane instantiates or calls
// NO ResponseComposer.compose, CoverageCritic.judge, or IntentRouter.route.
const spy = { compose: 0, judge: 0, route: 0 };
const origCompose = ResponseComposerAgent.prototype.compose;
const origJudge = CoverageCriticAgent.prototype.judge;
const origRoute = IntentRouterAgent.prototype.route;

// TRUE Phase-4 execution: every case runs through the real OrchestratorAgent prepared lane with a
// call-counting ERP mock. The model wire (router/critic/composer) is a failing fetch, so any fallback
// routes to UNROUTABLE and executes ZERO tools — making the ERP call count attributable to the prepared
// lane alone. Reject/fallback security cases must reach the ERP ZERO times; source-honesty cases run
// exactly one call and return an honest terminal (never a fabricated success).

const SALES_FAMILY = 'sales.get_sales_summary::single_metric';

function makeConfig(over: Record<string, unknown> = {}): any {
  return {
    aiMaxToolCalls: 8, modelProvider: 'openai', openAiApiKey: 'k', openAiModel: 'm',
    bedrockRegion: undefined, bedrockModelId: undefined, aiToolTimeoutMs: 1000,
    lineAiPreparedSimpleReadEnabled: true, lineAiDeterministicResponseFamilies: [SALES_FAMILY],
    lineAiFusedPlanShadowEnabled: false, lineAiTooluseLoopEnabled: false, lineAiCoverageCriticEnabled: false,
    ...over,
  };
}

/** Call-counting ERP double: records every tool name + input it is asked to invoke and returns `result`. */
function makeErp(result: Partial<ToolResult> = {}) {
  const calls: string[] = [];
  const inputs: unknown[] = [];
  const okData = { totalSales: '12,345', transactionCount: 42, basis: 'accrual' };
  const client = {
    invoke: async (tool: any, _ctx: any, input: unknown) => {
      calls.push(tool.name);
      inputs.push(input);
      return {
        toolName: tool.name, status: 'ok', data: okData,
        sourceRefs: [{ label: 'ยอดขายรวม', module: tool.sourceModule, entityType: 'summary', permissionChecked: true, webPath: '/sales' }],
        asOf: '2026-07-15T00:00:00Z', durationMs: 3, ...result,
      };
    },
  } as any;
  return { client, calls, inputs };
}

function rawPreparedSales(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'simple_grounded', answerShape: 'single_metric',
    intentPlan: {
      status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [],
      intents: [{ intent: 'read_summary', subject: 'sale', agent: 'sales', priority: 1, requiredTools: ['sales.get_sales_summary'], missingContext: [] }],
    },
    proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { fromDate: '2026-08-20', toDate: '2026-08-20' } }],
    ...over,
  };
}

function baseReq(over: Partial<LineAiTurnRequest> = {}, rawPlan: Record<string, unknown> = rawPreparedSales()): LineAiTurnRequest {
  const userContext = { lineUserId: 'l', internalUserId: 'u', companyId: 'c', membershipId: 'm', permissions: ['crm.report.read'], roles: ['owner'], locale: 'th-TH', ...(over.userContext ?? {}) };
  return {
    requestId: 'r', webhookEventId: 'e', messageText: 'ยอดขายวันนี้เท่าไหร่', messagePreviewHash: 'h', attachments: [],
    actorDelegations: { 'sales.get_sales_summary': ['deleg-token'] },
    preparedPlan: parseLineAiPreparedPlan(rawPlan),
    intakeIntent: 'BUSINESS_READ_QUESTION', // trusted API-bound outer provenance
    ...over,
    userContext,
  } as LineAiTurnRequest;
}

const originalFetch = globalThis.fetch;
let fetchCalls = 0;
beforeEach(() => {
  fetchCalls = 0;
  spy.compose = 0; spy.judge = 0; spy.route = 0;
  // Model wire fails → any fallback route is UNROUTABLE and calls zero tools.
  globalThis.fetch = (async () => { fetchCalls += 1; return { ok: false, json: async () => ({}) } as Response; }) as typeof fetch;
  ResponseComposerAgent.prototype.compose = function (this: ResponseComposerAgent, ...a: Parameters<typeof origCompose>) { spy.compose += 1; return origCompose.apply(this, a); };
  CoverageCriticAgent.prototype.judge = function (this: CoverageCriticAgent, ...a: Parameters<typeof origJudge>) { spy.judge += 1; return origJudge.apply(this, a); };
  IntentRouterAgent.prototype.route = function (this: IntentRouterAgent, ...a: Parameters<typeof origRoute>) { spy.route += 1; return origRoute.apply(this, a); };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  ResponseComposerAgent.prototype.compose = origCompose;
  CoverageCriticAgent.prototype.judge = origJudge;
  IntentRouterAgent.prototype.route = origRoute;
});

const deep = (n: number): Record<string, unknown> => (n <= 0 ? { leaf: 1 } : { a: deep(n - 1) });

// Each security case → the concrete mutation applied to the valid sales plan / request / ERP result,
// plus the number of ERP calls the prepared lane is allowed to make. `assertReply` runs on the run
// result for the post-tool honest-terminal cases.
type CaseSpec = {
  plan?: Record<string, unknown>;
  req?: Partial<LineAiTurnRequest>;
  erp?: Partial<ToolResult>;
  expectCalls: 0 | 1;
  assertReply?: (replyText: string) => void;
};

const SECURITY: Record<string, CaseSpec> = {
  // Reject / fallback BEFORE any ERP call (parser bound, injection key, simple invariant, or predicate).
  'prepared-missing-permission': { req: { userContext: { permissions: [] } as any }, expectCalls: 0 },
  'prepared-high-confidence-no-authority': { plan: rawPreparedSales({ confidence: 1 }), req: { userContext: { permissions: [] } as any }, expectCalls: 0 },
  'prepared-feature-disabled': { req: { userContext: { permissions: ['crm.report.read'], entitledFeatureKeys: ['unrelated_feature'] } as any }, expectCalls: 0 },
  'prepared-foreign-company-input': { plan: rawPreparedSales({ proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { companyId: 'other-tenant' } }] }), expectCalls: 0 },
  'prepared-foreign-branch-input': { plan: rawPreparedSales({ proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { branchId: 'other-branch' } }] }), expectCalls: 0 },
  'prepared-tool-not-required': { plan: rawPreparedSales({ proposedCalls: [{ toolName: 'ledger.get_financial_summary', input: {} }] }), expectCalls: 0 },
  'prepared-unknown-tool': { plan: rawPreparedSales({ proposedCalls: [{ toolName: 'not.a.real.tool', input: {} }] }), expectCalls: 0 },
  'prepared-forged-mutation-tool': {
    plan: rawPreparedSales({
      intentPlan: { status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [], intents: [{ intent: 'read_summary', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['accounting.capture_receipt_evidence'], missingContext: [] }] },
      proposedCalls: [{ toolName: 'accounting.capture_receipt_evidence', input: {} }],
    }), expectCalls: 0,
  },
  'prepared-missing-delegation': { req: { actorDelegations: {} }, expectCalls: 0 },
  'prepared-wrong-delegation': { req: { actorDelegations: { 'inventory.list_low_stock': ['t'] } }, expectCalls: 0 },
  'prepared-duplicate-call': { plan: rawPreparedSales({ proposedCalls: [{ toolName: 'sales.get_sales_summary', input: {} }, { toolName: 'sales.get_sales_summary', input: {} }] }), expectCalls: 0 },
  'prepared-too-many-calls': { plan: rawPreparedSales({ proposedCalls: [{ toolName: 'sales.get_sales_summary', input: {} }, { toolName: 'ledger.get_financial_summary', input: {} }] }), expectCalls: 0 },
  'prepared-too-many-input-keys': { plan: rawPreparedSales({ proposedCalls: [{ toolName: 'sales.get_sales_summary', input: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, 1])) }] }), expectCalls: 0 },
  'prepared-input-too-deep': { plan: rawPreparedSales({ proposedCalls: [{ toolName: 'sales.get_sales_summary', input: deep(6) }] }), expectCalls: 0 },
  'prepared-input-oversized-string': { plan: rawPreparedSales({ proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { note: 'x'.repeat(513) } }] }), expectCalls: 0 },
  'prepared-input-prototype-key': { plan: rawPreparedSales({ proposedCalls: [{ toolName: 'sales.get_sales_summary', input: JSON.parse('{"__proto__": 1, "fromDate": "2026-08-20"}') }] }), expectCalls: 0 },
  'prepared-unsupported-version': { plan: rawPreparedSales({ version: 2 }), expectCalls: 0 },
  'prepared-low-confidence': { plan: rawPreparedSales({ confidence: 0.5 }), expectCalls: 0 },
  'prepared-subject-mismatch': {
    plan: rawPreparedSales({ intentPlan: { status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [], intents: [{ intent: 'read_summary', subject: 'inventory', agent: 'sales', priority: 1, requiredTools: ['sales.get_sales_summary'], missingContext: [] }] } }), expectCalls: 0,
  },
  // Source honesty AFTER exactly one call — honest terminal, never a fabricated success.
  'prepared-explicit-empty': { erp: { data: { totalSales: '0', transactionCount: 0, basis: 'accrual' } }, expectCalls: 1, assertReply: (r) => assert.match(r, /0 บาท/) },
  'prepared-source-unavailable': { erp: { status: 'unavailable', data: null, sourceRefs: [] }, expectCalls: 1, assertReply: (r) => assert.doesNotMatch(r, /12,345/) },
  'prepared-tool-failure-authoritative': { erp: { status: 'error', data: null, sourceRefs: [], errorCode: 'HTTP_500' }, expectCalls: 1, assertReply: (r) => assert.doesNotMatch(r, /12,345/) },
  'prepared-partial-result': { erp: { data: { transactionCount: 5 } }, expectCalls: 1, assertReply: (r) => assert.doesNotMatch(r, /12,345/) },
};

describe('prepared simple-read lane — real runtime execution of every security/source case', () => {
  it('maps every corpus security case to a concrete executed scenario (no case left as a recorded gap)', () => {
    for (const { id } of LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES) {
      assert.ok(SECURITY[id], `security case ${id} must have an executed scenario`);
    }
    assert.equal(Object.keys(SECURITY).length, LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES.length);
  });

  for (const testCase of LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES) {
    it(`${testCase.id}: executes at the real boundary and makes exactly ${SECURITY[testCase.id].expectCalls} prepared call(s)`, async () => {
      const spec = SECURITY[testCase.id];
      const { client, calls } = makeErp(spec.erp);
      const orchestrator = new OrchestratorAgent(client, makeConfig());
      const result = await orchestrator.run(baseReq(spec.req ?? {}, spec.plan ?? rawPreparedSales()));
      assert.equal(calls.length, spec.expectCalls, `${testCase.id} expected ${spec.expectCalls} ERP call(s), got ${calls.length}`);
      // The corpus's own expectedToolCallCount must agree with the executed reality.
      assert.equal(testCase.expectedToolCallCount, spec.expectCalls, `${testCase.id} corpus count vs executed`);
      if (spec.expectCalls === 1) {
        // A post-call outcome (formatted answer OR honest terminal) is handled ENTIRELY by the lane —
        // no composer, no critic, no router re-plan after the single call.
        assert.deepEqual(calls, ['sales.get_sales_summary']);
        assert.equal(spy.compose, 0, `${testCase.id}: ResponseComposer.compose must be 0`);
        assert.equal(spy.judge, 0, `${testCase.id}: CoverageCritic.judge must be 0`);
        assert.equal(spy.route, 0, `${testCase.id}: IntentRouter.route must be 0`);
      }
      // Pre-call rejections make ZERO prepared calls; the subsequent fresh fallback route may run.
      spec.assertReply?.(result.replyText);
    });
  }
});

describe('prepared simple-read lane — eligible deterministic answer (no model, no composer)', () => {
  it('serves Thai single_metric via the compiled formatter: one ERP call, zero model-wire calls, source + as-of + link', async () => {
    const { client, calls, inputs } = makeErp();
    const result = await new OrchestratorAgent(client, makeConfig()).run(baseReq());
    assert.deepEqual(calls, ['sales.get_sales_summary'], 'exactly one specialist/ERP call');
    // The lane passes the EXACT sanitized proposed input (the whitelisted, valid-format dates), never a
    // value re-derived from the user text.
    assert.deepEqual(inputs, [{ fromDate: '2026-08-20', toDate: '2026-08-20' }], 'exact sanitized proposed input reached the ERP');
    assert.equal(fetchCalls, 0, 'zero model wire calls after intake');
    assert.equal(spy.route, 0, 'IntentRouter.route === 0');
    assert.equal(spy.compose, 0, 'ResponseComposer.compose === 0');
    assert.equal(spy.judge, 0, 'CoverageCritic.judge === 0');
    assert.match(result.replyText, /12,345/); // grounded number, from the tool
    assert.match(result.replyText, /ที่มา: ยอดขายรวม/); // source reference
    assert.match(result.replyText, /ข้อมูล ณ 2026-07-15/); // as-of state
    assert.equal(result.webLinks[0]?.path, '/sales'); // link
    assert.equal(result.presentation?.kind, 'answer_cards');
  });

  // P0: any input the sanitizer would CHANGE must fall back BEFORE a call — never strip-and-execute.
  const sanitizerFallbackCases: Array<[string, Record<string, unknown>, Partial<LineAiTurnRequest>]> = [
    ['an unknown / non-whitelisted key', { fromDate: '2026-08-20', toDate: '2026-08-20', evilKey: 1 }, {}],
    ['an invalid date format', { fromDate: '20-08-2026' }, {}],
    ['a date not backed by a value candidate', { fromDate: '2020-05-05', toDate: '2020-05-05' },
      { valueCandidates: { dates: [{ raw: '1 ม.ค.', isoDate: '2026-01-01', assumptions: [] }], amounts: [] } as any }],
    // P2-D: with NO candidates at all, a model-invented past date (never "today") must STILL fall back
    // pre-call — the prepared lane requires deterministic backing (today or an unambiguous candidate).
    ['a date with NO candidate backing at all (not today)', { fromDate: '2019-01-01', toDate: '2019-01-01' }, {}],
    ['a nested (non-primitive) input value', { filter: { nested: true } }, {}],
  ];
  for (const [label, input, reqOver] of sanitizerFallbackCases) {
    it(`sanitizer exact-equality: ${label} makes ZERO prepared calls and falls back`, async () => {
      const { client, calls } = makeErp();
      const logs: any[] = [];
      const orchestrator = new OrchestratorAgent(client, makeConfig());
      (orchestrator as any).logger = { log: (e: any) => logs.push(e), warn: () => {}, error: () => {} };
      await orchestrator.run(baseReq(reqOver, rawPreparedSales({ proposedCalls: [{ toolName: 'sales.get_sales_summary', input }] })));
      assert.equal(calls.length, 0, 'the altered input must not execute');
      const fallback = logs.find((e) => e.msg === 'line.ai.prepared_simple_read.fallback');
      assert.equal(fallback?.reason, 'input_sanitizer_changed');
    });
  }

  it('trusted provenance: a forged/missing REQUEST intakeIntent cannot activate the lane even with a valid wrapper', async () => {
    for (const forged of [undefined, 'CLARIFY', 'MUTATION_REQUEST_REFUSAL', 'UNSUPPORTED']) {
      const { client, calls } = makeErp();
      await new OrchestratorAgent(client, makeConfig()).run(baseReq({ intakeIntent: forged as any }));
      assert.equal(calls.length, 0, `intakeIntent=${forged} must not activate the lane`);
    }
  });

  it('trusted provenance: only a server-bound BUSINESS_READ_QUESTION activates the lane', async () => {
    const { client, calls } = makeErp();
    await new OrchestratorAgent(client, makeConfig()).run(baseReq({ intakeIntent: 'BUSINESS_READ_QUESTION' }));
    assert.deepEqual(calls, ['sales.get_sales_summary']);
  });

  it('serves English single_metric with English copy (Sales / THB / Source / Data as of)', async () => {
    const { client } = makeErp();
    const result = await new OrchestratorAgent(client, makeConfig()).run(baseReq(
      { messageText: 'sales today?', userContext: { permissions: ['crm.report.read'], locale: 'en-US' } as any },
      rawPreparedSales({ intentPlan: { status: 'ROUTABLE', language: 'en', requiresHumanReview: false, refusals: [], intents: [{ intent: 'read_summary', subject: 'sale', agent: 'sales', priority: 1, requiredTools: ['sales.get_sales_summary'], missingContext: [] }] } }),
    ));
    assert.match(result.replyText, /Sales: 12,345 THB/);
    assert.match(result.replyText, /Source: ยอดขายรวม/);
    assert.match(result.replyText, /Data as of 2026-07-15/);
  });

  it('default off: the lane never runs — the model wire is used (router) and no prepared call is made', async () => {
    const { client, calls } = makeErp();
    const logs: any[] = [];
    const orchestrator = new OrchestratorAgent(client, makeConfig({ lineAiPreparedSimpleReadEnabled: false }));
    (orchestrator as any).logger = { log: (e: any) => logs.push(e), warn: () => {}, error: () => {} };
    await orchestrator.run(baseReq());
    assert.equal(calls.length, 0, 'fallback route is UNROUTABLE → zero tools');
    assert.ok(fetchCalls > 0, 'the router model wire was attempted (lane skipped)');
    assert.ok(!logs.some((e) => typeof e.msg === 'string' && e.msg.startsWith('line.ai.prepared_simple_read')), 'lane untouched when off');
  });

  it('fixed formatter registry rejects an arbitrary env family string (env can only narrow the compiled set)', async () => {
    const { client, calls } = makeErp();
    const logs: any[] = [];
    // Neither entry is the compiled sales single_metric family → active set is empty → lane ineligible.
    const orchestrator = new OrchestratorAgent(client, makeConfig({ lineAiDeterministicResponseFamilies: ['evil::family', 'sales.get_sales_summary::list'] }));
    (orchestrator as any).logger = { log: (e: any) => logs.push(e), warn: () => {}, error: () => {} };
    await orchestrator.run(baseReq());
    assert.equal(calls.length, 0, 'no compiled family enabled → zero prepared calls');
    const fallback = logs.find((e) => e.msg === 'line.ai.prepared_simple_read.fallback');
    assert.equal(fallback?.reason, 'formatter_family_not_allowed');
  });
});
