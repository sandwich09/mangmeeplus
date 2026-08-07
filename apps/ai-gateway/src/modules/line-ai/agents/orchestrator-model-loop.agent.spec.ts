import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrchestratorAgent } from './orchestrator.agent';
import type { LineAiTurnRequest } from '@watchdog-bms/contracts';

// Exercises the model-driven tool loop: when a provider is available the model chooses which
// tool to call next (bounded by the routed agent's allowlist), with deterministic fact-shaping
// and a deterministic fallback. The mocked provider drives router/loop/polish calls.

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function makeReq(messageText: string): LineAiTurnRequest {
  return {
    requestId: 'req-loop', webhookEventId: 'evt', messageText, messagePreviewHash: 'h', attachments: [],
    userContext: {
      lineUserId: 'l1', internalUserId: 'u1', companyId: 'c1', membershipId: 'm1',
      permissions: ['inventory.product.read', 'inventory.report.read', 'inventory.movement.read'],
      roles: ['owner'], locale: 'th-TH',
    },
  } as LineAiTurnRequest;
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return { aiMaxToolCalls: 8, modelProvider: 'openai', openAiApiKey: 'k', openAiModel: 'gpt-test', bedrockRegion: undefined, bedrockModelId: undefined, aiToolTimeoutMs: 10000, ...overrides } as any;
}

// Inventory plan whose requiredTools (get_stock_balance) differ from the loop's chosen tool, so
// a call to the chosen tool proves the model loop — not deterministic fallback — drove selection.
const INVENTORY_PLAN = {
  status: 'ROUTABLE', language: 'th',
  intents: [{ intent: 'read_detail', subject: 'inventory', agent: 'inventory', priority: 1, requiredTools: ['inventory.get_stock_balance'], missingContext: [] }],
  refusals: [], requiresHumanReview: false,
};

// router call → plan; loop call (payload.availableTools) → next choice from queue; polish (payload.reply) → echo.
function installFetch(plan: unknown, loopChoices: unknown[], payloads: any[] = []) {
  let i = 0;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    let payload: any = {};
    // The router's feature catalog is prepended as a cacheable block on the OpenAI wire, so the
    // turn payload is the last newline-delimited JSON object of the first user text.
    const firstUserText = String(body.input?.[0]?.content?.[0]?.text ?? '{}');
    try { payload = JSON.parse(firstUserText.slice(firstUserText.lastIndexOf('\n') + 1)); } catch { payload = {}; }
    payloads.push(payload);
    if ('availableTools' in payload) {
      const choice = loopChoices[i++] ?? { done: true };
      return { ok: true, json: async () => ({ output_text: JSON.stringify(choice) }) } as Response;
    }
    if (typeof payload.reply === 'string') {
      return { ok: true, json: async () => ({ output_text: payload.reply }) } as Response;
    }
    return { ok: true, json: async () => ({ output_text: JSON.stringify(plan) }) } as Response;
  }) as typeof fetch;
}

function trackingErpTools(calledTools: string[]) {
  return {
    invoke: async (tool: any) => {
      calledTools.push(tool.name);
      return {
        toolName: tool.name, status: 'ok', data: { count: 4 },
        sourceRefs: [{ label: tool.name, module: tool.sourceModule, entityType: 'tool', permissionChecked: true }],
        asOf: new Date().toISOString(),
      };
    },
  } as any;
}

describe('OrchestratorAgent – model-driven tool loop', () => {
  it('offers and executes own-scope tools only when anyOfPermissions matches', async () => {
    const expensePlan = {
      status: 'ROUTABLE', language: 'th',
      intents: [{ intent: 'read_detail', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.get_detail'], missingContext: [] }],
      refusals: [], requiresHumanReview: false,
    };
    const allowedCalls: string[] = [];
    const allowedReq = makeReq('ดูค่าใช้จ่ายรายการนี้');
    allowedReq.userContext.permissions = ['expense.read_own'];
    installFetch(expensePlan, [{ callTool: 'expense.get_detail', input: { expenseId: 'e1' } }, { done: true }]);
    await new OrchestratorAgent(trackingErpTools(allowedCalls), makeConfig()).run(allowedReq);
    assert.deepEqual(allowedCalls, ['expense.get_detail']);

    const deniedCalls: string[] = [];
    const deniedReq = makeReq('ดูค่าใช้จ่ายรายการนี้');
    deniedReq.userContext.permissions = [];
    installFetch(expensePlan, [{ callTool: 'expense.get_detail', input: { expenseId: 'e1' } }]);
    await new OrchestratorAgent(trackingErpTools(deniedCalls), makeConfig()).run(deniedReq);
    assert.deepEqual(deniedCalls, []);
  });

  it('lets the model choose which tool to call (not the plan requiredTools)', async () => {
    const calledTools: string[] = [];
    installFetch(INVENTORY_PLAN, [{ callTool: 'inventory.list_low_stock' }, { done: true }]);
    const orchestrator = new OrchestratorAgent(trackingErpTools(calledTools), makeConfig());
    const result = await orchestrator.run(makeReq('ดูสต็อกสินค้าใกล้หมด'));
    assert.ok(calledTools.includes('inventory.list_low_stock'), 'model-chosen tool was called');
    assert.ok(!calledTools.includes('inventory.get_stock_balance'), 'plan requiredTools did NOT drive selection');
    assert.ok(result.replyText.includes('สินค้าใกล้หมด'), 'reply carries the grounded fact');
  });

  it('passes whitelisted model input to the tool and drops non-whitelisted or malformed fields', async () => {
    const calls: Array<{ name: string; input: any }> = [];
    const erpTools = {
      invoke: async (tool: any, _ctx: any, input: any) => {
        calls.push({ name: tool.name, input });
        return {
          toolName: tool.name, status: 'ok', data: { count: 4 },
          sourceRefs: [{ label: tool.name, module: tool.sourceModule, entityType: 'tool', permissionChecked: true }],
          asOf: new Date().toISOString(),
        };
      },
    } as any;
    installFetch(INVENTORY_PLAN, [{
      callTool: 'inventory.summarize_stock_movements',
      // fromDate valid; toDate malformed (dropped); productId whitelisted; hack not whitelisted
      input: { fromDate: '2026-06-01', toDate: 'yesterday', productId: 'p1', hack: 'x' },
    }, { done: true }]);
    const orchestrator = new OrchestratorAgent(erpTools, makeConfig());
    await orchestrator.run(makeReq('สรุปการเคลื่อนไหวสต็อกเดือนมิถุนายน'));
    const call = calls.find((c) => c.name === 'inventory.summarize_stock_movements');
    assert.ok(call, 'model-chosen tool was called');
    assert.deepEqual(call!.input, { fromDate: '2026-06-01', productId: 'p1' });
  });

  it('rejects a tool outside the routed domain allowlist and falls back to plan dispatch', async () => {
    const calledTools: string[] = [];
    installFetch(INVENTORY_PLAN, [{ callTool: 'ledger.get_financial_summary' }]);
    const orchestrator = new OrchestratorAgent(trackingErpTools(calledTools), makeConfig());
    await orchestrator.run(makeReq('ดูสต็อก'));
    assert.ok(!calledTools.includes('ledger.get_financial_summary'), 'out-of-domain tool never executed');
    assert.ok(calledTools.includes('inventory.get_stock_balance'), 'fell back to deterministic plan dispatch');
  });

	  it('falls back to deterministic dispatch when the model declines to call any tool', async () => {
	    const calledTools: string[] = [];
	    installFetch(INVENTORY_PLAN, [{ done: true }]);
	    const orchestrator = new OrchestratorAgent(trackingErpTools(calledTools), makeConfig());
	    await orchestrator.run(makeReq('ดูสต็อก'));
	    assert.ok(calledTools.includes('inventory.get_stock_balance'), 'deterministic fallback ran the plan tools');
	  });

	  it('passes conversation context through router, tool loop, and answer composer payloads', async () => {
	    const payloads: any[] = [];
	    const context = {
	      windowMinutes: 15,
	      maxTurns: 15,
	      lastTurnAt: '2026-07-05T10:00:00.000Z',
	      recentTurns: [{ at: '2026-07-05T10:00:00.000Z', userMessagePreview: 'ดูสต็อกสินค้าใกล้หมด', assistantReplyPreview: 'มี 4 รายการ', intent: 'READ_DETAIL', agent: 'inventory', refused: false }],
	    };
	    const req = makeReq('อันที่สองล่ะ');
	    req.conversationContext = context;
	    installFetch(INVENTORY_PLAN, [{ callTool: 'inventory.list_low_stock' }, { done: true }], payloads);
	    const orchestrator = new OrchestratorAgent(trackingErpTools([]), makeConfig());

	    await orchestrator.run(req);

	    // Router payload is now catalog-free; `hasAttachment` is its distinguishing key.
	    assert.deepEqual(payloads.find((p) => 'hasAttachment' in p)?.conversationContext, context);
	    assert.deepEqual(payloads.find((p) => p.availableTools)?.conversationContext, context);
	    assert.deepEqual(payloads.find((p) => p.systemData)?.conversationContext, context);
	  });

  it('asks one clarifying question instead of guessing when required input is ambiguous (discovery)', async () => {
    const calledTools: string[] = [];
    installFetch(INVENTORY_PLAN, [{ askUser: 'ต้องการดูสต็อกของสินค้าตัวไหนครับ' }]);
    const orchestrator = new OrchestratorAgent(trackingErpTools(calledTools), makeConfig());
    const result = await orchestrator.run(makeReq('ขอดูข้อมูลหน่อย'));
    assert.equal(result.replyText, 'ต้องการดูสต็อกของสินค้าตัวไหนครับ');
    assert.equal(calledTools.length, 0, 'no tool ran and the deterministic fallback did not fire');
    assert.deepEqual(result.coverage, [{ request: 'ขอดูข้อมูลหน่อย', subject: 'inventory', verdict: 'needs_user', question: 'ต้องการดูสต็อกของสินค้าตัวไหนครับ' }]);
  });

  it('ignores an oversized or JSON-shaped askUser and keeps the normal flow', async () => {
    const calledTools: string[] = [];
    installFetch(INVENTORY_PLAN, [{ askUser: `{"x":"${'ย'.repeat(600)}"}` }]);
    const orchestrator = new OrchestratorAgent(trackingErpTools(calledTools), makeConfig());
    const result = await orchestrator.run(makeReq('ดูสต็อก'));
    assert.ok(!result.replyText.startsWith('{'), 'malformed askUser never reaches the user');
    assert.ok(calledTools.includes('inventory.get_stock_balance'), 'treated as done → deterministic fallback');
  });
	});

// ── Item 10F: explicit-date membership guard on loop tool inputs ─────────────

import { extractValueCandidates } from '@watchdog-bms/contracts';

describe('OrchestratorAgent – loop date membership (item 10F)', () => {
  it('drops a self-converted (Buddhist-era) date and keeps candidate/current dates', async () => {
    const calls: Array<{ name: string; input: any }> = [];
    const erpTools = {
      invoke: async (tool: any, _ctx: any, input: any) => {
        calls.push({ name: tool.name, input });
        return {
          toolName: tool.name, status: 'ok', data: { count: 4 },
          sourceRefs: [{ label: tool.name, module: tool.sourceModule, entityType: 'tool', permissionChecked: true }],
          asOf: new Date().toISOString(),
        };
      },
    } as any;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    installFetch(INVENTORY_PLAN, [{
      callTool: 'inventory.summarize_stock_movements',
      // fromDate = BE year kept as CE (corruption) → dropped; toDate = today → allowed
      input: { fromDate: '2537-12-09', toDate: today },
    }, { done: true }]);
    const req = makeReq('การเคลื่อนไหวสต็อกตั้งแต่ 9/12/2537');
    req.valueCandidates = extractValueCandidates(req.messageText, today);
    const orchestrator = new OrchestratorAgent(erpTools, makeConfig());
    await orchestrator.run(req);
    const call = calls.find((c) => c.name === 'inventory.summarize_stock_movements');
    assert.ok(call, 'tool was called');
    assert.equal(call!.input.fromDate, undefined, 'corrupted BE-as-CE date never reaches the tool');
    assert.equal(call!.input.toDate, today, 'currentDate stays allowed');
  });

  it('passes a date that selects a candidate isoDate', async () => {
    const calls: Array<{ name: string; input: any }> = [];
    const erpTools = {
      invoke: async (tool: any, _ctx: any, input: any) => {
        calls.push({ name: tool.name, input });
        return {
          toolName: tool.name, status: 'ok', data: { count: 4 },
          sourceRefs: [{ label: tool.name, module: tool.sourceModule, entityType: 'tool', permissionChecked: true }],
          asOf: new Date().toISOString(),
        };
      },
    } as any;
    installFetch(INVENTORY_PLAN, [{
      callTool: 'inventory.summarize_stock_movements',
      input: { fromDate: '1994-12-09' },
    }, { done: true }]);
    const req = makeReq('การเคลื่อนไหวสต็อกตั้งแต่ 9/12/2537');
    req.valueCandidates = extractValueCandidates(req.messageText, '2026-07-07');
    const orchestrator = new OrchestratorAgent(erpTools, makeConfig());
    await orchestrator.run(req);
    assert.equal(calls.find((c) => c.name === 'inventory.summarize_stock_movements')!.input.fromDate, '1994-12-09');
  });

  it('leaves relative-period dates untouched when the text has no explicit date candidates', async () => {
    const calls: Array<{ name: string; input: any }> = [];
    const erpTools = {
      invoke: async (tool: any, _ctx: any, input: any) => {
        calls.push({ name: tool.name, input });
        return {
          toolName: tool.name, status: 'ok', data: { count: 4 },
          sourceRefs: [{ label: tool.name, module: tool.sourceModule, entityType: 'tool', permissionChecked: true }],
          asOf: new Date().toISOString(),
        };
      },
    } as any;
    installFetch(INVENTORY_PLAN, [{
      callTool: 'inventory.summarize_stock_movements',
      input: { fromDate: '2026-06-01', toDate: '2026-06-30' },
    }, { done: true }]);
    const orchestrator = new OrchestratorAgent(erpTools, makeConfig());
    await orchestrator.run(makeReq('สรุปการเคลื่อนไหวสต็อกเดือนที่แล้ว'));
    const call = calls.find((c) => c.name === 'inventory.summarize_stock_movements');
    assert.deepEqual({ fromDate: call!.input.fromDate, toDate: call!.input.toDate }, { fromDate: '2026-06-01', toDate: '2026-06-30' });
  });

  it('exposes valueCandidates to the loop payload as DATA', async () => {
    const payloads: any[] = [];
    installFetch(INVENTORY_PLAN, [{ callTool: 'inventory.list_low_stock' }, { done: true }], payloads);
    const req = makeReq('บิล ๖๐ กับของใกล้หมด');
    req.valueCandidates = extractValueCandidates(req.messageText, '2026-07-07');
    const orchestrator = new OrchestratorAgent(trackingErpTools([]), makeConfig());
    await orchestrator.run(req);
    assert.deepEqual(payloads.find((p) => p.availableTools)?.valueCandidates, req.valueCandidates);
  });
});
