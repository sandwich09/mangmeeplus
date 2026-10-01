import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrchestratorAgent } from './orchestrator.agent';
import { extractValueCandidates, parseLineAiPreparedPlan, type LineAiTurnRequest } from '@watchdog-bms/contracts';

// Exercises the model-driven tool loop: when a provider is available the model chooses which
// planned tool to call next (bounded by requiredTools and the routed agent's allowlist), with deterministic fact-shaping
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
      return Response.json({ status: 'completed', output_text: JSON.stringify(choice) });
    }
    if (typeof payload.reply === 'string') {
      return Response.json({ status: 'completed', output_text: payload.reply });
    }
    return Response.json({ status: 'completed', output_text: JSON.stringify(plan) });
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
  it('completes both Production expense months in the same resolved branch after one model call', async (t) => {
    // The day the candidates below are extracted for: "เดือน 12 ปี 2569" must still be a future month.
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-25T04:00:00.000Z') });
    const text = 'มั่งมี ช่วยสรุปค่าใช้จ่าย ของเดือนกรกฏาคม และ สิงหาคม ให้หน่อย';
    const req = makeReq(text);
    req.userContext.permissions = ['expense.read'];
    req.valueCandidates = extractValueCandidates(text, '2026-09-25');
    const [july, august] = req.valueCandidates.periods!;
    const calls: Array<{ fromDate: string; toDate: string; branchId?: string }> = [];
    const erpTools = { invoke: async (_tool: any, _ctx: any, input: any) => {
      calls.push(input);
      const julyCall = input.fromDate === july!.fromDate;
      return {
        toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-25T03:50:00.000Z',
        sourceRefs: [{ label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary', permissionChecked: true,
          webPath: '/companies/c1/expenses?branchId=branch-1' }],
        data: { total: julyCall ? 7 : 25, branchId: 'branch-1', truncated: false,
          period: { fromDate: input.fromDate, toDate: input.toDate, defaultedToCurrentMonth: false },
          summary: { totalAmount: julyCall ? 25147.80 : 214899.57, countedItems: julyCall ? 7 : 25,
            cancelledCount: 0, pendingAmount: 0, confirmedAmount: 0, paidAmount: 0, unpaidAmount: 0 }, items: [] },
      };
    } } as any;
    const plan = { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_summary',
      subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.list_recent'], missingContext: [] }],
      refusals: [], requiresHumanReview: false };
    const oneJulyCall = [
      { callTool: 'expense.list_recent', input: { fromDate: july!.fromDate, toDate: july!.toDate } },
      { done: true },
    ];
    installFetch(plan, oneJulyCall);
    const result = await new OrchestratorAgent(erpTools, makeConfig()).run(req);
    assert.deepEqual(calls, [
      { fromDate: july!.fromDate, toDate: july!.toDate },
      { fromDate: august!.fromDate, toDate: august!.toDate },
    ]);
    assert.match(result.replyText, /25,147\.80 บาท \(7 รายการ\)[\s\S]*ก\.ค\. 2569/);
    assert.match(result.replyText, /214,899\.57 บาท \(25 รายการ\)[\s\S]*ส\.ค\. 2569/);
    assert.equal(result.presentation?.cards.length, 1);
    assert.equal(result.presentation?.cards[0]?.text, result.replyText);
    assert.equal(result.presentation?.cards[0]?.webLink?.label, 'เลือกเดือนในรายการค่าใช้จ่าย');

    calls.length = 0;
    installFetch(plan, oneJulyCall);
    const shortText = 'ค่าใช้จ่ายเดือนกคและสค';
    const shortReq = { ...req, messageText: shortText, valueCandidates: extractValueCandidates(shortText, '2026-09-25') };
    const shortResult = await new OrchestratorAgent(erpTools, makeConfig()).run(shortReq);
    assert.deepEqual(calls.map((call) => call.fromDate), [july!.fromDate, august!.fromDate]);
    assert.match(shortResult.replyText, /25,147\.80 บาท[\s\S]*214,899\.57 บาท/);

    calls.length = 0;
    const numericText = 'สรุปค่าใช้จ่ายเดือน 1 2 3 ปี 2569';
    const numericReq = { ...req, messageText: numericText,
      valueCandidates: extractValueCandidates(numericText, '2026-09-25') } as LineAiTurnRequest;
    installFetch(plan, [{ callTool: 'expense.list_recent', input: {
      fromDate: '2026-01-01', toDate: '2026-01-31',
    } }, { done: true }]);
    await new OrchestratorAgent(erpTools, makeConfig()).run(numericReq);
    assert.deepEqual(calls.map((call) => call.fromDate), ['2026-01-01', '2026-02-01', '2026-03-01']);

    calls.length = 0;
    const allMonthsText = `สรุปค่าใช้จ่ายเดือน ${Array.from({ length: 12 }, (_, index) => index + 1).join(' ')} ปี 2568`;
    const allMonthsReq = { ...req, messageText: allMonthsText,
      valueCandidates: extractValueCandidates(allMonthsText, '2026-09-25') } as LineAiTurnRequest;
    installFetch(plan, [{ callTool: 'expense.list_recent', input: {
      fromDate: '2025-01-01', toDate: '2025-01-31',
    } }, { done: true }]);
    const allMonthsResult = await new OrchestratorAgent(erpTools, makeConfig({ aiMaxToolCalls: 8 })).run(allMonthsReq);
    assert.equal(calls.length, 8, 'the twelve-month request stays within the existing tool budget');
    assert.match(allMonthsResult.replyText, /ธ\.ค\..*ยังดึงข้อมูลได้ไม่ครบ/);
    assert.equal(allMonthsResult.coverage?.[0]?.verdict, 'uncovered');

    calls.length = 0;
    const typoText = 'สรุปค่าใช้จ่ายเดือนกรกดาคม และ สิงหาคม';
    const typoReq = { ...req, intakeIntent: 'BUSINESS_READ_QUESTION', messageText: typoText,
      valueCandidates: extractValueCandidates(typoText, '2026-09-25') } as LineAiTurnRequest;
    installFetch(plan, oneJulyCall);
    const typoResult = await new OrchestratorAgent(erpTools, makeConfig()).run(typoReq);
    assert.deepEqual(calls.map((call) => call.fromDate), [july!.fromDate, august!.fromDate]);
    assert.match(typoResult.replyText, /25,147\.80 บาท[\s\S]*ตีความ "กรกดาคม" เป็น/);

    calls.length = 0;
    const unclearText = 'สรุปค่าใช้จ่ายเดือนกรกดาคน และ สิงหาคม';
    const unclearReq = { ...req, intakeIntent: 'BUSINESS_READ_QUESTION', messageText: unclearText,
      valueCandidates: extractValueCandidates(unclearText, '2026-09-25') } as LineAiTurnRequest;
    unclearReq.preparedPlan = parseLineAiPreparedPlan({
      version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'simple_grounded', answerShape: 'single_metric',
      intentPlan: plan, proposedCalls: [{ toolName: 'expense.list_recent', input: {
        fromDate: august!.fromDate, toDate: august!.toDate,
      } }],
    });
    assert.ok(unclearReq.preparedPlan);
    installFetch(plan, oneJulyCall);
    const unclearResult = await new OrchestratorAgent(erpTools, makeConfig({
      lineAiPreparedSimpleReadEnabled: true,
      lineAiDeterministicResponseFamilies: ['expense.list_recent::single_metric'],
    })).run(unclearReq);
    assert.equal(calls.length, 0, 'unclear month must not read August alone or default to September');
    assert.match(unclearResult.replyText, /กรกดาคน.*หมายถึงเดือนใด/);
    assert.equal(unclearResult.coverage?.[0]?.verdict, 'needs_user');

    calls.length = 0;
    const unclearSecondText = 'สรุปค่าใช้จ่ายเดือนกรกฎาคม และ สิงหาตน';
    const unclearSecondReq = { ...req, intakeIntent: 'BUSINESS_READ_QUESTION', messageText: unclearSecondText,
      valueCandidates: extractValueCandidates(unclearSecondText, '2026-09-25') } as LineAiTurnRequest;
    installFetch(plan, oneJulyCall);
    const unclearSecondResult = await new OrchestratorAgent(erpTools, makeConfig()).run(unclearSecondReq);
    assert.equal(calls.length, 0, 'a misspelled second month must not yield a July-only answer');
    assert.match(unclearSecondResult.replyText, /สิงหาตน.*หมายถึงเดือนใด/);

    calls.length = 0;
    const bareTypoText = 'สรุปค่าใช้จ่าย กรกดาคน และ สิงหาคม';
    const bareTypoReq = { ...req, intakeIntent: 'BUSINESS_READ_QUESTION', messageText: bareTypoText,
      valueCandidates: extractValueCandidates(bareTypoText, '2026-09-25') } as LineAiTurnRequest;
    installFetch(plan, oneJulyCall);
    const bareTypoResult = await new OrchestratorAgent(erpTools, makeConfig()).run(bareTypoReq);
    assert.equal(calls.length, 0, 'a separated misspelling must not default to September');
    assert.match(bareTypoResult.replyText, /กรกดาคน.*หมายถึงเดือนใด/);

    calls.length = 0;
    const invalidMonthText = 'สรุปค่าใช้จ่ายเดือน 13';
    const invalidMonthReq = { ...req, intakeIntent: 'BUSINESS_READ_QUESTION', messageText: invalidMonthText,
      valueCandidates: extractValueCandidates(invalidMonthText, '2026-09-25') } as LineAiTurnRequest;
    installFetch(plan, oneJulyCall);
    const invalidMonthResult = await new OrchestratorAgent(erpTools, makeConfig()).run(invalidMonthReq);
    assert.equal(calls.length, 0, 'an invalid numbered month must not use the current month');
    assert.match(invalidMonthResult.replyText, /"13".*1–12/);

    calls.length = 0;
    const futureText = 'สรุปค่าใช้จ่ายเดือน 12 ปี 2569';
    const futureReq = { ...req, intakeIntent: 'BUSINESS_READ_QUESTION', messageText: futureText,
      valueCandidates: extractValueCandidates(futureText, '2026-09-25') } as LineAiTurnRequest;
    installFetch(plan, oneJulyCall);
    const futureResult = await new OrchestratorAgent(erpTools, makeConfig()).run(futureReq);
    assert.equal(calls.length, 0, 'an explicit future month must not read the current month');
    assert.match(futureResult.replyText, /"12".*ตรวจเดือนและปี/);

    calls.length = 0;
    installFetch(plan, oneJulyCall);
    const failedAugust = { invoke: async (tool: any, ctx: any, input: any) => input.fromDate === august!.fromDate
      ? { toolName: tool.name, status: 'unavailable', asOf: '2026-09-25T03:50:00.000Z', sourceRefs: [] }
      : erpTools.invoke(tool, ctx, input) } as any;
    const partial = await new OrchestratorAgent(failedAugust, makeConfig()).run(req);
    assert.match(partial.replyText, /ก\.ค\. 2569: 25,147\.80 บาท/);
    assert.match(partial.replyText, /ส\.ค\. 2569: ยังดึงข้อมูลได้ไม่ครบ/);
    assert.doesNotMatch(partial.replyText, /214,899\.57/);
    assert.equal(partial.coverage?.[0]?.verdict, 'uncovered');

    calls.length = 0;
    installFetch(plan, oneJulyCall);
    const bounded = await new OrchestratorAgent(erpTools, makeConfig({ aiMaxToolCalls: 1 })).run(req);
    assert.equal(calls.length, 1, 'the missing month does not exceed the configured tool budget');
    assert.match(bounded.replyText, /ส\.ค\..*ยังดึงข้อมูลได้ไม่ครบ/);

    installFetch(plan, oneJulyCall);
    let unresolvedCalls = 0;
    const unresolved = await new OrchestratorAgent({ invoke: async () => {
      unresolvedCalls += 1;
      return { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-25T03:50:00.000Z', sourceRefs: [],
        data: { branchUnresolved: 'Unknown', availableBranches: [{ id: 'branch-1', name: 'Head Office' }] } };
    } } as any, makeConfig()).run(req);
    assert.equal(unresolvedCalls, 1, 'an unresolved branch never triggers an all-branch second read');
    assert.match(unresolved.replyText, /ไม่พบสาขาที่ระบุ/);
  });
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

  it('rejects a nearby tool outside requiredTools and falls back to the planned tool', async () => {
    const calledTools: string[] = [];
    installFetch(INVENTORY_PLAN, [{ callTool: 'inventory.list_low_stock' }, { done: true }]);
    const orchestrator = new OrchestratorAgent(trackingErpTools(calledTools), makeConfig());
    await orchestrator.run(makeReq('ดูสต็อก'));
    assert.ok(!calledTools.includes('inventory.list_low_stock'), 'unplanned nearby tool never executed');
    assert.deepEqual(calledTools, ['inventory.get_stock_balance'], 'deterministic fallback kept the plan boundary');
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
    installFetch(inventoryPlan(['inventory.summarize_stock_movements']), [{
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
	    installFetch(inventoryPlan(['inventory.list_low_stock']), [{ callTool: 'inventory.list_low_stock' }, { done: true }], payloads);
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
    installFetch(inventoryPlan(['inventory.summarize_stock_movements']), [{
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
    installFetch(inventoryPlan(['inventory.summarize_stock_movements']), [{
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
    installFetch(inventoryPlan(['inventory.summarize_stock_movements']), [{
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
    installFetch(inventoryPlan(['inventory.list_low_stock']), [{ callTool: 'inventory.list_low_stock' }, { done: true }], payloads);
    const req = makeReq('บิล ๖๐ กับของใกล้หมด');
    req.valueCandidates = extractValueCandidates(req.messageText, '2026-07-07');
    const orchestrator = new OrchestratorAgent(trackingErpTools([]), makeConfig());
    await orchestrator.run(req);
    assert.deepEqual(payloads.find((p) => p.availableTools)?.valueCandidates, req.valueCandidates);
  });
});
