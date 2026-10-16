import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrchestratorAgent, specialistOutputIsError } from './orchestrator.agent';
import type { LineAiTurnRequest } from '@watchdog-bms/contracts';

// Exercises the item 10F native tool-use loop through the real OpenAI adapter (fetch mocked at
// the Responses wire): parallel calls, tool+input dedupe, out-of-allowlist error results,
// ask_user, budget deferral, coverage critic verdicts/resume/fail-open, and the fallback chain.

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function makeReq(messageText: string): LineAiTurnRequest {
  return {
    requestId: 'req-native', webhookEventId: 'evt', messageText, messagePreviewHash: 'h', attachments: [],
    userContext: {
      lineUserId: 'l1', internalUserId: 'u1', companyId: 'c1', membershipId: 'm1',
      permissions: ['inventory.product.read', 'inventory.report.read', 'inventory.movement.read'],
      roles: ['owner'], locale: 'th-TH',
    },
  } as LineAiTurnRequest;
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    aiMaxToolCalls: 8, modelProvider: 'openai', openAiApiKey: 'k', openAiModel: 'gpt-test',
    bedrockRegion: undefined, bedrockModelId: undefined, aiToolTimeoutMs: 10000,
    lineAiTooluseLoopEnabled: true, lineAiCoverageCriticEnabled: true,
    ...overrides,
  } as any;
}

const INVENTORY_PLAN = {
  status: 'ROUTABLE', language: 'th',
  intents: [{ intent: 'read_detail', subject: 'inventory', agent: 'inventory', priority: 1, requiredTools: ['inventory.get_stock_balance'], missingContext: [] }],
  refusals: [], requiresHumanReview: false,
};

function inventoryPlan(requiredTools: string[]) {
  return {
    ...INVENTORY_PLAN,
    intents: [{ ...INVENTORY_PLAN.intents[0], requiredTools }],
  };
}

const MONTHLY_EXPENSE_PLAN = {
  status: 'ROUTABLE', language: 'th',
  intents: [{ intent: 'read_summary', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.list_recent'], missingContext: [] }],
  refusals: [], requiresHumanReview: false,
};

type NativeTurn = { toolCalls?: Array<{ name: string; input?: unknown }>; text?: string };

/** Routes by payload shape: body.tools → native turn queue; toolsCalled → critic queue;
 *  systemData → composer answer; reply → polish echo; else → router plan. */
function installNativeFetch(opts: {
  plan?: unknown;
  nativeTurns?: NativeTurn[];
  nativeHttpErrorFirst?: boolean;
  criticAnswers?: string[];
  jsonLoopChoices?: unknown[];
  nativeBodies?: any[];
}) {
  const { plan = INVENTORY_PLAN, nativeTurns = [], criticAnswers = [], jsonLoopChoices = [], nativeBodies = [] } = opts;
  let nativeIndex = 0;
  let criticIndex = 0;
  let jsonIndex = 0;
  let callId = 0;
  let httpErrorPending = opts.nativeHttpErrorFirst ?? false;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      nativeBodies.push(body);
      if (httpErrorPending) {
        httpErrorPending = false;
        return Response.json({ error: { message: 'boom' } }, { status: 500 });
      }
      const turn = nativeTurns[nativeIndex++] ?? { text: 'done' };
      const output = [
        ...(turn.toolCalls ?? []).map((c) => ({ type: 'function_call', call_id: `c${callId++}`, name: c.name, arguments: JSON.stringify(c.input ?? {}) })),
        ...(turn.text ? [{ type: 'message', content: [{ type: 'output_text', text: turn.text }] }] : []),
      ];
      return Response.json({ status: 'completed', output });
    }
    let payload: any = {};
    // The router's feature catalog is prepended as a cacheable block on the OpenAI wire, so the
    // turn payload is the last newline-delimited JSON object of the first user text.
    const firstUserText = String(body.input?.[0]?.content?.[0]?.text ?? '{}');
    try { payload = JSON.parse(firstUserText.slice(firstUserText.lastIndexOf('\n') + 1)); } catch { payload = {}; }
    if (Array.isArray(payload.toolsCalled)) {
      const answer = criticAnswers[criticIndex++] ?? JSON.stringify([]);
      return Response.json({ status: 'completed', output_text: answer });
    }
    if (payload.systemData) {
      return Response.json({ status: 'completed', output_text: 'สรุปตามข้อมูลด้านบนค่ะ' });
    }
    if (typeof payload.reply === 'string') {
      return Response.json({ status: 'completed', output_text: payload.reply });
    }
    if (Array.isArray(payload.availableTools)) {
      const choice = jsonLoopChoices[jsonIndex++] ?? { done: true };
      return Response.json({ status: 'completed', output_text: JSON.stringify(choice) });
    }
    return Response.json({ status: 'completed', output_text: JSON.stringify(plan) });
  }) as typeof fetch;
}

function trackingErpTools(calls: Array<{ name: string; input: any }>) {
  return {
    invoke: async (tool: any, _ctx: any, input: any) => {
      calls.push({ name: tool.name, input });
      return {
        toolName: tool.name, status: 'ok', data: { count: 4 },
        sourceRefs: [{ label: tool.name, module: tool.sourceModule, entityType: 'tool', permissionChecked: true }],
        asOf: new Date().toISOString(),
      };
    },
  } as any;
}

const COVERED = JSON.stringify([{ request: 'สต็อกใกล้หมด', verdict: 'covered' }]);

describe('OrchestratorAgent – native tool-use loop (item 10F)', () => {
  it('marks every non-success specialist outcome as a native tool error', () => {
    assert.equal(specialistOutputIsError('SUCCEEDED'), false);
    assert.equal(specialistOutputIsError('FAILED'), true);
    assert.equal(specialistOutputIsError('UNSUPPORTED'), true);
    assert.equal(specialistOutputIsError('PERMISSION_DENIED'), true);
  });

  it('executes parallel tool calls from one model turn', async () => {
    const calls: Array<{ name: string; input: any }> = [];
    installNativeFetch({
      plan: inventoryPlan(['inventory.list_low_stock', 'inventory.get_stock_balance']),
      nativeTurns: [
        { toolCalls: [{ name: 'inventory__list_low_stock' }, { name: 'inventory__get_stock_balance' }] },
        { text: 'done' },
      ],
      criticAnswers: [JSON.stringify([{ request: 'ของใกล้หมด', verdict: 'covered' }, { request: 'สต็อกคงเหลือ', verdict: 'covered' }])],
    });
    const orchestrator = new OrchestratorAgent(trackingErpTools(calls), makeConfig());
    const result = await orchestrator.run(makeReq('ของใกล้หมดมีอะไร แล้วสต็อกคงเหลือเท่าไหร่'));
    assert.deepEqual(calls.map((c) => c.name).sort(), ['inventory.get_stock_balance', 'inventory.list_low_stock']);
    assert.equal(result.coverage?.length, 2);
    assert.ok(result.coverage?.every((c) => c.verdict === 'covered'));
    assert.ok(!result.replyText.includes('⏳'), 'no deferral line when everything is covered');
  });

  it('allows the same tool twice with different input and blocks an identical repeat', async () => {
    const calls: Array<{ name: string; input: any }> = [];
    installNativeFetch({
      plan: inventoryPlan(['inventory.summarize_stock_movements']),
      nativeTurns: [
        { toolCalls: [
          { name: 'inventory__summarize_stock_movements', input: { fromDate: '2026-06-01' } },
          { name: 'inventory__summarize_stock_movements', input: { fromDate: '2026-05-01' } },
        ] },
        { toolCalls: [{ name: 'inventory__summarize_stock_movements', input: { fromDate: '2026-06-01' } }] },
        { text: 'done' },
      ],
      criticAnswers: [COVERED],
    });
    const orchestrator = new OrchestratorAgent(trackingErpTools(calls), makeConfig());
    await orchestrator.run(makeReq('เทียบการเคลื่อนไหวสต็อกเดือนนี้กับเดือนที่แล้ว'));
    const movementCalls = calls.filter((c) => c.name === 'inventory.summarize_stock_movements');
    assert.equal(movementCalls.length, 2, 'two different periods executed; identical repeat blocked');
    assert.deepEqual(movementCalls.map((c) => c.input.fromDate).sort(), ['2026-05-01', '2026-06-01']);
  });

  it('rejects an out-of-allowlist tool with an error result and keeps looping', async () => {
    const calls: Array<{ name: string; input: any }> = [];
    installNativeFetch({
      plan: inventoryPlan(['inventory.list_low_stock']),
      nativeTurns: [
        { toolCalls: [{ name: 'ledger__get_financial_summary' }] },
        { toolCalls: [{ name: 'inventory__list_low_stock' }] },
        { text: 'done' },
      ],
      criticAnswers: [COVERED],
    });
    const orchestrator = new OrchestratorAgent(trackingErpTools(calls), makeConfig());
    await orchestrator.run(makeReq('ดูของใกล้หมด'));
    assert.ok(!calls.some((c) => c.name === 'ledger.get_financial_summary'), 'out-of-domain tool never executed');
    assert.ok(calls.some((c) => c.name === 'inventory.list_low_stock'), 'loop continued after the violation');
  });

  it('surfaces ask_user as THE clarify question when nothing was gathered', async () => {
    const calls: Array<{ name: string; input: any }> = [];
    installNativeFetch({
      nativeTurns: [{ toolCalls: [{ name: 'ask_user', input: { question: 'ต้องการดูสาขาไหนครับ' } }] }],
    });
    const orchestrator = new OrchestratorAgent(trackingErpTools(calls), makeConfig());
    const result = await orchestrator.run(makeReq('ขอดูข้อมูลหน่อย'));
    assert.equal(result.replyText, 'ต้องการดูสาขาไหนค่ะ');
    assert.equal(calls.length, 0);
    assert.deepEqual(result.coverage, [{ request: 'ขอดูข้อมูลหน่อย', subject: 'inventory', verdict: 'needs_user', question: 'ต้องการดูสาขาไหนค่ะ' }]);
  });

  it('F3/F5: guards write acknowledgements and Markdown in native questions', async () => {
    for (const question of ['สร้างร่างค่าใช้จ่ายแล้วค่ะ', '## ขอข้อมูล\n**ต้องการดูสาขาไหนคะ**']) {
      const calls: Array<{ name: string; input: any }> = [];
      installNativeFetch({ nativeTurns: [{ toolCalls: [{ name: 'ask_user', input: { question } }] }] });
      const result = await new OrchestratorAgent(trackingErpTools(calls), makeConfig()).run(makeReq('ขอดูข้อมูลหน่อย'));
      assert.equal(calls.length, 0);
      assert.doesNotMatch(result.replyText, /สร้างร่างค่าใช้จ่ายแล้ว|[*#]/u);
      assert.equal(result.coverage?.[0]?.question, result.replyText);
    }
  });

  it('caps executions at the tool budget and defers the tail honestly', async () => {
    const calls: Array<{ name: string; input: any }> = [];
    installNativeFetch({
      plan: inventoryPlan(['inventory.list_low_stock', 'inventory.get_stock_balance']),
      nativeTurns: [{ toolCalls: [{ name: 'inventory__list_low_stock' }, { name: 'inventory__get_stock_balance' }] }],
      criticAnswers: [JSON.stringify([
        { request: 'ของใกล้หมด', verdict: 'covered' },
        { request: 'สต็อกคงเหลือ', verdict: 'uncovered', reason: 'tool budget exhausted' },
      ])],
    });
    const orchestrator = new OrchestratorAgent(trackingErpTools(calls), makeConfig({ aiMaxToolCalls: 1 }));
    const result = await orchestrator.run(makeReq('ของใกล้หมดกับสต็อกคงเหลือ'));
    assert.equal(calls.length, 1, 'budget capped execution');
    assert.ok(result.replyText.includes('⏳'), 'honest deferral line appended');
    assert.equal(result.coverage?.filter((c) => c.verdict === 'uncovered').length, 1);
  });

  it('critic failure fails open – reply proceeds without coverage', async () => {
    const calls: Array<{ name: string; input: any }> = [];
    installNativeFetch({
      plan: inventoryPlan(['inventory.list_low_stock']),
      nativeTurns: [{ toolCalls: [{ name: 'inventory__list_low_stock' }] }, { text: 'done' }],
      criticAnswers: ['this is not json'],
    });
    const orchestrator = new OrchestratorAgent(trackingErpTools(calls), makeConfig());
    const result = await orchestrator.run(makeReq('ของใกล้หมด'));
    assert.equal(calls.length, 1);
    assert.equal(result.coverage, undefined);
    assert.ok(result.replyText.length > 0);
  });

  it('uncovered verdicts resume the loop once and coverage is re-judged', async () => {
    const calls: Array<{ name: string; input: any }> = [];
    installNativeFetch({
      plan: inventoryPlan(['inventory.list_low_stock', 'inventory.get_stock_balance']),
      nativeTurns: [
        { toolCalls: [{ name: 'inventory__list_low_stock' }] },
        { text: 'ครบแล้ว' },
        { toolCalls: [{ name: 'inventory__get_stock_balance' }] },
        { text: 'done' },
      ],
      criticAnswers: [
        JSON.stringify([{ request: 'ของใกล้หมด', verdict: 'covered' }, { request: 'สต็อกคงเหลือ', verdict: 'uncovered', reason: 'not gathered' }]),
        JSON.stringify([{ request: 'ของใกล้หมด', verdict: 'covered' }, { request: 'สต็อกคงเหลือ', verdict: 'covered' }]),
      ],
    });
    const orchestrator = new OrchestratorAgent(trackingErpTools(calls), makeConfig());
    const result = await orchestrator.run(makeReq('ของใกล้หมดกับสต็อกคงเหลือ'));
    assert.ok(calls.some((c) => c.name === 'inventory.get_stock_balance'), 'resume round executed the missing tool');
    assert.ok(result.coverage?.every((c) => c.verdict === 'covered'), 'final coverage reflects the resumed facts');
  });

  // Owner 2026-09-29 ("no more switches; always on"): a stale LINE_AI_TOOLUSE_LOOP_ENABLED/COVERAGE_CRITIC
  // value — like the one AgentCore carried on UAT — can no longer drop the turn to the 10B path.
  it('a stale tool-loop or critic switch never turns the native loop or its critic off', async () => {
    const nativeBodies: any[] = [];
    installNativeFetch({ plan: inventoryPlan(['inventory.list_low_stock']), nativeBodies,
      nativeTurns: [{ toolCalls: [{ name: 'inventory__list_low_stock' }] }, { text: 'done' }], criticAnswers: [COVERED] });
    const orchestrator = new OrchestratorAgent(trackingErpTools([]),
      makeConfig({ lineAiTooluseLoopEnabled: false, lineAiCoverageCriticEnabled: false }));
    const result = await orchestrator.run(makeReq('ของใกล้หมด'));
    assert.ok(nativeBodies.length > 0, 'the native tool wire is used whatever the stale switch says');
    assert.ok(result.coverage, 'the coverage critic still judged the turn');
  });

  it('falls back to the JSON loop when the provider fails before any facts', async () => {
    const calls: Array<{ name: string; input: any }> = [];
    installNativeFetch({
      plan: inventoryPlan(['inventory.list_low_stock']),
      nativeHttpErrorFirst: true,
      jsonLoopChoices: [{ callTool: 'inventory.list_low_stock' }, { done: true }],
    });
    const orchestrator = new OrchestratorAgent(trackingErpTools(calls), makeConfig());
    await orchestrator.run(makeReq('ของใกล้หมด'));
    assert.ok(calls.some((c) => c.name === 'inventory.list_low_stock'), 'JSON loop answered after native failure');
  });

  it('never invokes daily closing when the router planned only the monthly expense tool', async () => {
    const calls: Array<{ name: string; input: any }> = [];
    const nativeBodies: any[] = [];
    installNativeFetch({
      plan: MONTHLY_EXPENSE_PLAN,
      nativeBodies,
      nativeTurns: [
        { toolCalls: [{ name: 'expense__get_daily_closing' }] },
        { toolCalls: [{ name: 'expense__list_recent' }] },
        { text: 'done' },
      ],
      criticAnswers: [JSON.stringify([{ request: 'ยอดค่าใช้จ่ายเดือนนี้', verdict: 'covered' }])],
    });
    const req = makeReq('ช่วยคำนวณยอดค่าใช้จ่ายเดือนนี้ให้หน่อย');
    req.userContext.permissions = ['expense.read'];
    const result = await new OrchestratorAgent(trackingErpTools(calls), makeConfig()).run(req);

    assert.deepEqual(calls.map((call) => call.name), ['expense.list_recent']);
    assert.ok(!calls.some((call) => call.name === 'expense.get_daily_closing'));
    const subRequests = JSON.parse(nativeBodies[0]?.input?.[0]?.content?.[0]?.text ?? '{}').subRequests;
    assert.deepEqual(subRequests[0]?.requiredTools, ['expense.list_recent']);
    assert.ok(!result.replyText.includes('สรุปปิดร้าน'));
  });
});
