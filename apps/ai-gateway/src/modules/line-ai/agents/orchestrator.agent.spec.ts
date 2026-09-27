import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { branchInputMatchesMessage, buildAnswerPresentation, expenseBranchScopeRequested, expenseCriterionOnlyMessage, OrchestratorAgent, uncertainExpenseFilter, unsupportedExpenseFilter, validExpensePeriodSelection, withoutRefusedCoverage } from './orchestrator.agent';
import { ResponseComposerAgent } from './response-composer.agent';
import { extractValueCandidates, parseLineAiPreparedPlan } from '@watchdog-bms/contracts';
import type { LineAiPreparedPlan, LineAiTurnRequest } from '@watchdog-bms/contracts';

// A valid, already-bounded prepared plan for a permitted inventory read (matches makeReq permissions).
function preparedInventoryPlan(): LineAiPreparedPlan {
  const plan = parseLineAiPreparedPlan({
    version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'simple_grounded', answerShape: 'single_metric',
    intakeIntent: 'BUSINESS_READ_QUESTION',
    intentPlan: {
      status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [],
      intents: [{ intent: 'read_summary', subject: 'inventory', agent: 'inventory', priority: 1, requiredTools: ['inventory.list_low_stock'], missingContext: [] }],
    },
    proposedCalls: [{ toolName: 'inventory.list_low_stock', input: {} }],
  });
  if (!plan) throw new Error('fixture did not parse');
  return plan;
}

function makeReq(messageText: string, attachments: any[] = []): LineAiTurnRequest {
  return {
    requestId: 'req-test',
    webhookEventId: 'evt-test',
    messageText,
    messagePreviewHash: 'abc',
    attachments,
    userContext: {
      lineUserId: 'line-1',
      internalUserId: 'user-1',
      companyId: 'company-1',
      membershipId: 'mem-1',
      permissions: ['inventory.product.read', 'inventory.report.read', 'inventory.movement.read', 'ledger.report.read'],
      roles: ['owner'],
      locale: 'th-TH',
    },
  };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    aiMaxToolCalls: 8,
    modelProvider: 'openai',
    openAiApiKey: 'test-key',
    openAiModel: 'gpt-test',
    bedrockRegion: undefined,
    bedrockModelId: undefined,
    aiToolTimeoutMs: 10000,
    ...overrides,
  } as any;
}

async function jsonMockResponse(stub: { ok: boolean; status?: number; json: () => Promise<unknown> }): Promise<Response> {
  return new Response(JSON.stringify(await stub.json()), { status: stub.status ?? (stub.ok ? 200 : 500), headers: { 'content-type': 'application/json' } });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    let payload: any = {};
    // The router's feature catalog is prepended as a cacheable block on the OpenAI wire, so the
    // turn payload is the last newline-delimited JSON object of the first user text.
    const firstUserText = String(body.input?.[0]?.content?.[0]?.text ?? '{}');
    try { payload = JSON.parse(firstUserText.slice(firstUserText.lastIndexOf('\n') + 1)); } catch { payload = {}; }
    // Grounded language-layer polish call: echo the reply unchanged (a valid no-op polish).
    if (typeof payload.reply === 'string') {
      return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: payload.reply }) });
    }
    if (typeof payload.messageText === 'string' && typeof payload.language === 'string') {
      return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: 'วันนี้เหนื่อยมานิดหน่อยสินะคะ น้องมั่งมีอยู่เป็นเพื่อนค่ะ 😊' }) });
    }
    return await jsonMockResponse({
      ok: true,
      json: async () => ({ status: 'completed', output_text: JSON.stringify(planFor(payload.messageText ?? '')) }),
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function planFor(messageText: string) {
  if (!messageText.trim()) {
    return { status: 'UNROUTABLE', language: 'th', intents: [], refusals: [{ request: messageText, reason: 'unsupported_module' }], requiresHumanReview: false };
  }
  if (/ชำระ|pay/i.test(messageText)) {
    return { status: 'UNROUTABLE', language: /[A-Za-z]/.test(messageText) ? 'en' : 'th', intents: [], refusals: [{ request: messageText, reason: 'mutation_blocked' }], requiresHumanReview: false };
  }
  // "service charge" is the owner's UAT E4 turn: a question about his own expense record that the
  // router had no tool for, so it refused it as out-of-scope — the misroute `unsupported_yet` fixes.
  if (/ภาษี|อากาศ|service charge/i.test(messageText)) {
    return { status: 'UNROUTABLE', language: 'th', intents: [], refusals: [{ request: messageText, reason: 'unsupported_module' }], requiresHumanReview: false };
  }
  if (/พี่เอแอบคบ/.test(messageText)) {
    return {
      status: 'PARTIAL', language: 'th',
      intents: [{ intent: 'read_detail', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.get_breakdown'], missingContext: [] }],
      refusals: [{ request: 'เม้าท์ว่าพี่เอแอบคบใคร', reason: 'privacy_rumor' }], requiresHumanReview: false,
    };
  }
  if (/ทำอะไรได้บ้าง|ช่วยอะไรได้บ้าง|สอนใช้งาน/.test(messageText)) {
    return { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'capability_help', subject: 'unknown', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }], refusals: [], requiresHumanReview: false };
  }
  if (/^สวัสดี|^วันนี้เหนื่อย|หวยแตกมาก|ต่อยกันไหม/.test(messageText) && !/ยอดขาย|รายได้|สต็อก|ค่าใช้จ่าย/.test(messageText)) {
    return { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'casual_conversation', subject: 'unknown', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }], refusals: [], requiresHumanReview: false };
  }
  if (/ค่าใช้จ่าย|\bexpenses?\b/i.test(messageText)) {
    return { status: 'ROUTABLE', language: /[ก-๙]/.test(messageText) ? 'th' : 'en', intents: [{ intent: 'read_detail', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.list_recent'], missingContext: [] }], refusals: [], requiresHumanReview: false };
  }
  if (/ยอดขาย|รายได้/.test(messageText)) {
    return { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'report_request', subject: 'sale', agent: 'sales', priority: 1, requiredTools: ['sales.get_sales_summary'], missingContext: [] }], refusals: [], requiresHumanReview: false };
  }
  if (/สต็อก/.test(messageText)) {
    return { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_detail', subject: 'inventory', agent: 'inventory', priority: 1, requiredTools: ['inventory.list_low_stock'], missingContext: [] }], refusals: [], requiresHumanReview: false };
  }
  if (/ขอมุข|เล่ามุข|มุกดาหาร|ฮาร์ดแวร์|ฮานอย/.test(messageText)) {
    // Production 2026-08-31: the live router classified a plain joke request this way. The
    // orchestrator's deterministic rescue must turn ONLY the real joke ask into the casual lane —
    // the province/hardware/Hanoi probes share the refusal shape and must keep it.
    return { status: 'UNROUTABLE', language: 'th', intents: [], refusals: [{ request: messageText, reason: 'unsupported_module' }], requiresHumanReview: false };
  }
  return { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_summary', subject: 'ledger', agent: 'accounting', priority: 1, requiredTools: ['ledger.get_financial_summary'], missingContext: [] }], refusals: [], requiresHumanReview: false };
}

function makeOkErpTools(data: Record<string, unknown> = { count: 3 }) {
  return {
    invoke: async (tool: any) => ({
      toolName: tool.name,
      status: 'ok',
      data,
      sourceRefs: [{ label: tool.name, module: tool.sourceModule, entityType: 'tool', permissionChecked: true }],
      asOf: new Date().toISOString(),
    }),
  } as any;
}

const PRESENTATION_PLAN = {
  status: 'ROUTABLE', language: 'th', intents: [], refusals: [], requiresHumanReview: false,
} as any;

function presentationOutput(
  status: 'SUCCEEDED' | 'FAILED' | 'UNSUPPORTED' | 'PERMISSION_DENIED',
  label = 'ยอดขาย',
  value = '100 บาท',
  data: unknown = { total: 1 },
  toolName = 'sales.get_sales_summary',
) {
  const sourceRef = { label, module: 'sales', entityType: 'summary', permissionChecked: true as const, webPath: '/sales' };
  return {
    agent: 'sales' as const,
    status,
    summary: `${label}: ${value}`,
    facts: status === 'SUCCEEDED' ? [{ label, value, sourceRef }] : [],
    suggestions: [],
    toolCalls: status === 'SUCCEEDED' ? [{ name: toolName, status: 'ok' as const, durationMs: 1 }] : [],
    requiresHumanReview: false,
    ...(status === 'SUCCEEDED' ? { toolData: [{ tool: toolName, data }] } : {}),
  };
}

describe('buildAnswerPresentation', () => {
  it('uses the final grounded reply for one successful output', () => {
    const presentation = buildAnswerPresentation(PRESENTATION_PLAN, [presentationOutput('SUCCEEDED')], 'ยอดขายรวม 100 บาท');
    assert.deepEqual(presentation, {
      kind: 'answer_cards',
      cards: [{ text: 'ยอดขายรวม 100 บาท', sourceLabels: ['ยอดขาย'], webLink: { label: 'ยอดขาย', path: '/sales' } }],
    });
  });

  it('creates one deterministic card per successful output and bounds the carousel', () => {
    const outputs = Array.from({ length: 14 }, (_, index) => presentationOutput('SUCCEEDED', `คำตอบ ${index + 1}`, `${index + 1} รายการ`));
    const presentation = buildAnswerPresentation(PRESENTATION_PLAN, outputs, 'combined');
    assert.equal(presentation?.cards.length, 12);
    assert.match(presentation?.cards[0]?.text ?? '', /คำตอบ 1/);
    assert.match(presentation?.cards[1]?.text ?? '', /คำตอบ 2/);
    assert.notEqual(presentation?.cards[0]?.text, 'combined');
  });

  it('presents explicit empty results as a grounded answer card', () => {
    const output = presentationOutput('SUCCEEDED', 'ค่าใช้จ่าย', 'ยังไม่มีรายการ', { total: 0, items: [] });
    assert.equal(buildAnswerPresentation(PRESENTATION_PLAN, [output], 'เดือนนี้ยังไม่มีค่าใช้จ่าย')?.cards[0]?.text, 'เดือนนี้ยังไม่มีค่าใช้จ่าย');
  });

  it('labels a daily-closing link as the generic expense list it actually opens', () => {
    const output = presentationOutput(
      'SUCCEEDED',
      'สรุปปิดร้าน',
      'วันนี้',
      { occurredToday: { totalCount: 0 } },
      'expense.get_daily_closing',
    );
    output.facts[0]!.sourceRef!.webPath = '/companies/company-1/expenses';
    assert.deepEqual(buildAnswerPresentation(PRESENTATION_PLAN, [output], 'สรุปปิดร้านวันนี้')?.cards[0]?.webLink, {
      label: 'ดูรายการค่าใช้จ่าย',
      path: '/companies/company-1/expenses',
    });
  });

  it('omits cards for forbidden, unavailable, unsupported, and clarification outcomes', () => {
    assert.equal(buildAnswerPresentation(PRESENTATION_PLAN, [presentationOutput('PERMISSION_DENIED')], 'ไม่มีสิทธิ์'), undefined);
    assert.equal(buildAnswerPresentation(PRESENTATION_PLAN, [presentationOutput('FAILED')], 'ดึงข้อมูลไม่ได้'), undefined);
    assert.equal(buildAnswerPresentation(PRESENTATION_PLAN, [presentationOutput('UNSUPPORTED')], 'ไม่รองรับ'), undefined);
    assert.equal(buildAnswerPresentation(PRESENTATION_PLAN, [presentationOutput('SUCCEEDED')], 'ขอข้อมูลเพิ่ม', '', 'th-TH', true), undefined);
  });
});

describe('withoutRefusedCoverage', () => {
  it('removes a paraphrased private request using the router refusal instead of keywords', () => {
    const plan = {
      status: 'PARTIAL', language: 'th', intents: [], requiresHumanReview: false,
      refusals: [{ request: 'พี่บีกับผู้จัดการเป็นอะไรกันแน่', reason: 'privacy_rumor' }],
    } as any;
    const coverage = [
      { request: 'พี่บีกับผู้จัดการเป็นอะไรกันแน่', verdict: 'uncovered' as const },
      { request: 'เดือนนี้เงินออกไปเท่าไหร่', subject: 'expense' as const, verdict: 'covered' as const },
    ];
    assert.deepEqual(withoutRefusedCoverage(coverage, plan), [coverage[1]]);
  });
});

describe('OrchestratorAgent', () => {
  it('answers capability help without reading company or dashboard data', async () => {
    let called = false;
    const orchestrator = new OrchestratorAgent({ invoke: async () => { called = true; throw new Error('must not invoke'); } } as any, makeConfig());
    const result = await orchestrator.run(makeReq('ทำอะไรได้บ้าง'));
    assert.equal(result.plan.intents[0]?.intent, 'capability_help');
    assert.equal(called, false);
    assert.deepEqual(result.outputs, []);
    assert.equal(result.presentation, undefined);
    // Derived from THIS caller's permissions (inventory + ledger reads), so it names stock and
    // finance and stays silent about sales, which the same turn would have refused.
    assert.match(result.replyText, /สินค้าและสต็อก/);
    assert.match(result.replyText, /การเงิน บัญชี และรายงาน/);
    assert.doesNotMatch(result.replyText, /ยอดขาย/);
    assert.match(result.replyText, /ขึ้นกับสิทธิ์และฟีเจอร์/);
  });

  // UAT 2026-09-06: "สอนฉันใช้งานเบื้องต้น…" got the capability card, which lists WHAT and never HOW.
  it('teaches a beginner from the same permission-derived set, still without reading any data (spec §8.1)', async () => {
    let called = false;
    const orchestrator = new OrchestratorAgent({ invoke: async () => { called = true; throw new Error('must not invoke'); } } as any, makeConfig());
    const result = await orchestrator.run(makeReq('สอนใช้งานหน่อย มือใหม่'));
    assert.equal(result.plan.intents[0]?.intent, 'capability_help');
    assert.equal(called, false);
    assert.match(result.replyText, /^น้องมั่งมีสอนใช้งานเบื้องต้น/u);
    assert.match(result.replyText, /^1\) /mu, 'numbered steps');
    assert.match(result.replyText, /ของอะไรใกล้หมด/, 'stock read permission → a stock step');
    assert.match(result.replyText, /ขอสรุปการเงินเดือนนี้/, 'ledger read permission → a finance step');
    assert.doesNotMatch(result.replyText, /ยอดขายวันนี้เท่าไหร่/, 'no sales permission → no sales step');
    assert.match(result.replyText, /เมนูหลัก/);
    assert.match(result.replyText, /ต้องทำบนเว็บค่ะ$/u, 'the same closing sentence as the card');
  });

  it('lets Nong Mangmee handle pure casual conversation without ERP tools', async () => {
    let called = false;
    const orchestrator = new OrchestratorAgent({ invoke: async () => { called = true; throw new Error('must not invoke'); } } as any, makeConfig());
    const result = await orchestrator.run(makeReq('วันนี้เหนื่อยนิดหน่อย'));
    assert.equal(result.plan.intents[0]?.intent, 'casual_conversation');
    assert.equal(called, false);
    assert.deepEqual(result.outputs, []);
    assert.equal(result.presentation, undefined);
    assert.match(result.replyText, /น้องมั่งมี/);
  });

  it('handles the reported casual and joking-provocation phrases with zero ERP tools', async () => {
    let called = false;
    const orchestrator = new OrchestratorAgent({ invoke: async () => { called = true; throw new Error('must not invoke'); } } as any, makeConfig());
    for (const message of ['หวยแตกมาก', 'ต่อยกันไหม']) {
      const result = await orchestrator.run(makeReq(message));
      assert.equal(result.plan.intents[0]?.intent, 'casual_conversation');
      assert.equal(called, false);
      assert.deepEqual(result.outputs, []);
      assert.equal(result.presentation, undefined);
      assert.match(result.replyText, /น้องมั่งมี/);
    }
  });

  it('gives deterministic crisis support and never calls ERP tools, even beside a business request', async () => {
    let called = false;
    const orchestrator = new OrchestratorAgent({ invoke: async () => { called = true; throw new Error('must not invoke'); } } as any, makeConfig());
    for (const message of [
      'ฉันไม่อยากอยู่แล้ว ทุกอย่างมันหนักไปหมด',
      'ฉันไม่อยากอยู่แล้ว แต่ก่อนอื่นช่วยบอกค่าใช้จ่ายเดือนนี้ที',
    ]) {
      const result = await orchestrator.run(makeReq(message));
      assert.equal(result.plan.refusals[0]?.reason, 'safety_crisis');
      assert.match(result.replyText, /1323/);
      assert.match(result.replyText, /1669/);
      assert.ok(!result.replyText.includes('ค่าใช้จ่าย:'));
    }
    assert.equal(called, false);
  });

  it('rescues a joke request the router refused as out-of-scope into the casual lane', async () => {
    let called = false;
    const orchestrator = new OrchestratorAgent({ invoke: async () => { called = true; throw new Error('must not invoke'); } } as any, makeConfig());
    const result = await orchestrator.run(makeReq('ขอมุขตลกหน่อย'));
    assert.equal(result.plan.intents[0]?.intent, 'casual_conversation');
    assert.equal(result.plan.status, 'ROUTABLE');
    assert.deepEqual(result.plan.refusals, []);
    assert.equal(called, false);
    // The reply is composed (the harness's casual canned line), never the unsupported template.
    assert.ok(!result.replyText.includes('นอกขอบเขตระบบ'), 'unsupported template must not appear');
    assert.match(result.replyText, /น้องมั่งมี/);
  });

  it('keeps the honest refusal for out-of-scope questions that merely contain joke-ish substrings', async () => {
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), makeConfig());
    // มุกดาหาร (the province), ฮาร์ดแวร์ and ฮานอย all contain มุก/ฮา; the loose composer test reads
    // them as jokes (probe run 2026-08-31). The rescue must not: a refused shipping/price/travel
    // question keeps its refusal instead of getting a punchline.
    for (const message of ['ส่งของไปมุกดาหารกี่บาท', 'ราคาฮาร์ดแวร์เท่าไหร่', 'ไปฮานอยยังไง']) {
      const result = await orchestrator.run(makeReq(message));
      assert.equal(result.plan.status, 'UNROUTABLE', message);
      assert.notEqual(result.plan.intents[0]?.intent, 'casual_conversation', message);
      assert.match(result.replyText, /นอกขอบเขตระบบ/, message);
    }
  });

  it('never rescues a joke wrapped around a protected refusal or a business clause', async () => {
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), makeConfig());
    // ชำระ → mutation_blocked: a protected refusal keeps its deterministic template.
    const mutation = await orchestrator.run(makeReq('ขอมุขเรื่องชำระเงินหน่อย'));
    assert.equal(mutation.plan.status, 'UNROUTABLE');
    assert.equal(mutation.plan.refusals[0]?.reason, 'mutation_blocked');
    // สต็อก → tools routed (and permitted in makeReq): business wins, the joke phrase changes nothing.
    const business = await orchestrator.run(makeReq('ขอมุขแล้วก็ดูสต็อกหน่อย'));
    assert.equal(business.plan.intents[0]?.intent, 'read_detail');
    assert.ok(business.plan.intents.some((intent) => intent.requiredTools.length > 0));
    // ค่าใช้จ่าย with NO expense permission → the stripper empties the intents: the joke phrase must
    // not repaint that permission situation as small talk.
    const stripped = await orchestrator.run(makeReq('ขอมุขแล้วก็ดูค่าใช้จ่ายหน่อย'));
    assert.notEqual(stripped.plan.intents[0]?.intent, 'casual_conversation');
    assert.match(stripped.replyText, /สิทธิ์|ฟีเจอร์/);
  });

  it('mutation request returns UNROUTABLE plan and safe reply', async () => {
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), makeConfig());
    const result = await orchestrator.run(makeReq('ชำระเงิน'));
    assert.equal(result.plan.status, 'UNROUTABLE');
    assert.ok(result.replyText.length > 0, 'reply must not be empty');
    assert.ok(!result.replyText.toLowerCase().includes('error'), 'reply must not expose stack traces');
  });

  it('uses English safe reply when user input is English', async () => {
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), makeConfig());
    const result = await orchestrator.run(makeReq('please pay this bill'));
    assert.equal(result.plan.status, 'UNROUTABLE');
    assert.ok(result.replyText.includes('cannot perform this action through LINE'));
  });

  // S-4 / M6, through the REAL path: the API's DTO caps `groundingText` and a longer value would
  // 400 every ERP tool call of that turn, so the SENDER truncates. Re-deriving the slice inside a
  // test proves nothing about `run()`; this drives the orchestrator and reads what it emitted.
  it('bounds the grounding text it forwards, and sends none while the draft lane is off', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const erpTools = {
      invoke: async (_tool: any, ctx: any) => {
        seen.push(ctx);
        return { toolName: 'inventory.list_low_stock', status: 'ok', data: { count: 0 }, sourceRefs: [], asOf: new Date().toISOString() };
      },
    } as any;
    const long = `ดูสต็อกสินค้าใกล้หมด ${'ก'.repeat(3000)}`;

    const withLane = new OrchestratorAgent(erpTools, makeConfig({ lineAiDraftEditEnabled: true }));
    await withLane.run(makeReq(long));
    assert.ok(seen.length > 0, 'the turn must actually reach a tool call');
    assert.equal(
      (seen[0]!['groundingText'] as string).length,
      1000,
      'the orchestrator must truncate before sending, not rely on the receiver',
    );
    assert.ok(long.length > 1000, 'the fixture has to exceed the cap for this to mean anything');

    // Flag off: the field is absent entirely, so an off deployment's wire is byte-identical.
    seen.length = 0;
    const withoutLane = new OrchestratorAgent(erpTools, makeConfig({ lineAiDraftEditEnabled: false }));
    await withoutLane.run(makeReq(long));
    assert.ok(seen.length > 0);
    assert.equal(seen[0]!['groundingText'], undefined);
  });

  it('inventory query only invokes inventory-allowlisted tools', async () => {
    const calledTools: string[] = [];
    const erpTools = {
      invoke: async (tool: any) => {
        calledTools.push(tool.name);
        return { toolName: tool.name, status: 'ok', data: { count: 2 }, sourceRefs: [], asOf: new Date().toISOString() };
      },
    } as any;
    const orchestrator = new OrchestratorAgent(erpTools, makeConfig());
    await orchestrator.run(makeReq('ดูสต็อกสินค้าใกล้หมด'));
    assert.ok(
      calledTools.every((t) => t.startsWith('inventory.')),
      `Expected only inventory.* tools, got: ${calledTools.join(', ')}`,
    );
  });

  it('M-02: specialist tool calls carry the failing ToolResult errorCode, and nothing on success', async () => {
    const erpTools = {
      invoke: async (tool: any) => ({
        toolName: tool.name, status: 'error', sourceRefs: [], asOf: new Date().toISOString(), errorCode: 'TOOL_TIMEOUT',
      }),
    } as any;
    const failed = await new OrchestratorAgent(erpTools, makeConfig()).run(makeReq('ดูสต็อกสินค้าใกล้หมด'));
    const failedCalls = failed.outputs.flatMap((output) => output.toolCalls);
    assert.ok(failedCalls.length > 0, 'the specialist must record the tool it called');
    // The code, not just the status class, is what reaches AiToolInvocation.errorCode in the API.
    assert.ok(failedCalls.every((call) => call.status === 'error' && call.errorCode === 'TOOL_TIMEOUT'));

    const ok = await new OrchestratorAgent(makeOkErpTools(), makeConfig()).run(makeReq('ดูสต็อกสินค้าใกล้หมด'));
    const okCalls = ok.outputs.flatMap((output) => output.toolCalls);
    assert.ok(okCalls.length > 0);
    assert.ok(okCalls.every((call) => call.status === 'ok' && call.errorCode === undefined), 'success must not invent an errorCode');
  });

  it('shows a complete broad expense summary while preserving source-backed details and counts on request', async () => {
    const calledTools: string[] = [];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const currentMonthStart = `${today.slice(0, 7)}-01`;
    const asOfAtBangkokStart = new Date(`${today}T00:30:00+07:00`).toISOString();
    const thaiMonth = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', month: 'long' }).format(new Date(asOfAtBangkokStart));
    const thaiYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric' }).format(new Date(asOfAtBangkokStart))) + 543;
    const todayDay = Number(today.slice(8, 10));
    const erpTools = {
      invoke: async (tool: any) => {
        calledTools.push(tool.name);
        return {
          toolName: tool.name,
          status: tool.name === 'expense.list_recent' ? 'ok' : 'unsupported_module',
          data: tool.name === 'expense.list_recent' ? {
            total: 7,
            period: { fromDate: currentMonthStart, toDate: today, defaultedToCurrentMonth: true },
            summary: {
              totalAmount: 11875,
              countedItems: 7,
              cancelledCount: 0,
              pendingAmount: 0,
              draftAmount: 0,
              confirmedAmount: 11875,
              paidAmount: 11875,
              unpaidAmount: 0,
            },
            items: [
              { id: 'expense-draft-empty', expenseDate: '2026-06-26', vendorNameSnapshot: null, vendorDocumentNumber: null, status: 'DRAFT', grandTotalAmount: '0' },
              { id: 'expense-1', expenseDate: '2025-02-27', vendorNameSnapshot: 'บริษัท โฟลว์แอคเคาท์ ทดสอบ จำกัด', status: 'CONFIRMED', grandTotalAmount: '11875.00' },
            ],
          } : null,
          sourceRefs: tool.name === 'expense.list_recent'
            ? [{ label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary', permissionChecked: true, webPath: '/companies/company-1/expenses' }]
            : [],
          asOf: tool.name === 'expense.list_recent' ? asOfAtBangkokStart : new Date().toISOString(),
        };
      },
    } as any;
    const req = makeReq('ช่วยคำนวณยอดค่าใช้จ่ายเดือนนี้ให้หน่อย');
    req.userContext.permissions.push('expense.read');
    const orchestrator = new OrchestratorAgent(erpTools, makeConfig());
    const result = await orchestrator.run(req);
    assert.ok(calledTools.includes('expense.list_recent'));
    assert.ok(result.replyText.includes('11,875.00'));
    assert.ok(!result.replyText.includes('สิ้นกำหนดวันนี้'));
    assert.ok(!result.replyText.includes('เกินกำหนด'));
    assert.equal(result.replyText.split('\n')[0], 'ค่าใช้จ่าย: 11,875.00 บาท (7 รายการ)');
    assert.ok(result.replyText.includes('\nฐานยอด: รวมรายการรอดำเนินการ 0.00 บาท (ในนั้นเป็นร่าง 0.00 บาท) และรายการยืนยันแล้ว 11,875.00 บาท'));
    assert.ok(result.replyText.includes(`\nช่วง: 1 ${thaiMonth} ${thaiYear} – ${todayDay} ${thaiMonth} ${thaiYear}`));
    assert.ok(result.replyText.includes(`\nข้อมูล ณ ${todayDay} ${thaiMonth} ${thaiYear}`));
    assert.doesNotMatch(result.replyText, new RegExp(today));
    assert.doesNotMatch(result.replyText, /รอตรวจสอบ|จ่ายแล้ว|ยังไม่จ่าย|บริษัท โฟลว์แอคเคาท์/);
    assert.ok(!result.replyText.includes('expense-draft-empty'));
    assert.deepEqual(result.webLinks, [{ label: 'รายการค่าใช้จ่าย', path: '/companies/company-1/expenses' }]);
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
    assert.equal(result.presentation?.kind, 'answer_cards');
    assert.equal(result.presentation?.cards[0]?.text, result.replyText);
    for (const question of ['ค่าใช้จ่ายเดือนนี้มีกี่ใบ', 'ค่าใช้จ่ายเดือนนี้มีกี่รายการ', 'how many expenses this month?', 'ยอดค่าใช้จ่ายเดือนนี้เท่าไหร่ มีกี่ใบ']) {
      const countReq = makeReq(question);
      countReq.userContext.permissions.push('expense.read');
      const counted = await orchestrator.run(countReq);
      assert.match(counted.replyText, /7 (?:รายการ|records)/, question);
      assert.match(counted.replyText, /11,875\.00/, question);
      assert.deepEqual(counted.webLinks, result.webLinks);
      assert.equal(counted.sourceRefs[0]?.permissionChecked, true);
      assert.equal(counted.presentation?.cards[0]?.text, counted.replyText);
    }

    // Both committed menu entries send this text; either execution lane must produce the same card.
    const menuReq = makeReq('ดูค่าใช้จ่าย');
    menuReq.userContext.permissions.push('expense.read');
    const full = await orchestrator.run(menuReq);
    const preparedPlan = parseLineAiPreparedPlan({
      version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'simple_grounded', answerShape: 'single_metric',
      intentPlan: planFor(menuReq.messageText),
      proposedCalls: [{ toolName: 'expense.list_recent', input: {} }],
    });
    assert.ok(preparedPlan);
    let providerCalls = 0;
    globalThis.fetch = async () => { providerCalls += 1; throw new Error('prepared read must not call a provider'); };
    const before = calledTools.length;
    const prepared = await new OrchestratorAgent(erpTools, makeConfig({
      lineAiPreparedSimpleReadEnabled: true,
      lineAiDeterministicResponseFamilies: ['expense.list_recent::single_metric'],
    })).run({ ...menuReq, preparedPlan, intakeIntent: 'BUSINESS_READ_QUESTION', actorDelegations: { 'expense.list_recent': ['test-delegation'] } });
    assert.equal(providerCalls, 0, 'proves prepared execution rather than an unnoticed fallback');
    assert.deepEqual(calledTools.slice(before), ['expense.list_recent']);
    assert.equal(prepared.replyText, full.replyText);
    assert.deepEqual(prepared.presentation, full.presentation);
    assert.deepEqual(prepared.sourceRefs, full.sourceRefs);
    assert.deepEqual(prepared.webLinks, full.webLinks);
    assert.ok(prepared.replyText.includes(`\nช่วง: 1 ${thaiMonth} ${thaiYear} – ${todayDay} ${thaiMonth} ${thaiYear}`));
    assert.ok(prepared.replyText.includes(`\nข้อมูล ณ ${todayDay} ${thaiMonth} ${thaiYear}`));
  });

  it('expense query with unavailable tool does not fall back to accounting no-data copy', async () => {
    const erpTools = {
      invoke: async (tool: any) => ({
        toolName: tool.name,
        status: 'error',
        data: null,
        sourceRefs: [],
        asOf: new Date().toISOString(),
      }),
    } as any;
    const req = makeReq('ดูค่าใช้จ่าย');
    req.userContext.permissions.push('expense.read');
    const orchestrator = new OrchestratorAgent(erpTools, makeConfig());
    const result = await orchestrator.run(req);
    assert.ok(result.replyText.includes('รายการค่าใช้จ่าย'));
    assert.ok(!result.replyText.includes('ข้อมูลบัญชี'));
    assert.equal(result.presentation, undefined);
  });

  it('does not let deterministic no-provider fallback widen an explicit expense period', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const erpTools = { invoke: async (tool: any, _ctx: unknown, input: Record<string, unknown> = {}) => {
      calls.push({ tool: tool.name, ...input });
      return { toolName: tool.name, status: 'ok', data: { total: 1, period: { fromDate: '2026-09-01', toDate: '2026-09-25', defaultedToCurrentMonth: true },
        summary: { totalAmount: 10, countedItems: 1, cancelledCount: 0 } }, sourceRefs: [], asOf: new Date().toISOString() };
    } } as any;
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const userText = String(body.input?.[0]?.content?.[0]?.text ?? '{}');
      let payload: any = {};
      try { payload = JSON.parse(userText.slice(userText.lastIndexOf('\n') + 1)); } catch { payload = {}; }
      if (typeof payload.reply === 'string') return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: payload.reply }) });
      if (Array.isArray(payload.availableTools)) return await jsonMockResponse({ ok: false, status: 503, json: async () => ({}) });
      if (typeof payload.messageText === 'string') return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: JSON.stringify(planFor(payload.messageText)) }) });
      return await jsonMockResponse({ ok: false, status: 503, json: async () => ({}) });
    };
    const message = 'ค่าใช้จ่ายเดือนกรกฎาคม 2569 เท่าไร';
    const req = makeReq(message);
    req.userContext.permissions.push('expense.read');
    req.valueCandidates = extractValueCandidates(message, '2026-09-25');
    const result = await new OrchestratorAgent(erpTools, makeConfig()).run(req);
    assert.deepEqual(calls, [], 'the fallback must clarify instead of reading the tool default');
    assert.match(result.replyText, /ช่วงวันที่หรือขอบเขตสาขา/);
    assert.equal(result.deterministicExpenseSummary, undefined);
  });

  it('keeps safe non-expense reads in a mixed no-provider turn while deferring the scoped expense read', async () => {
    const calls: string[] = [];
    const erpTools = { invoke: async (tool: any) => {
      calls.push(tool.name);
      return { toolName: tool.name, status: 'ok', data: { totalSales: 500, currency: 'THB', transactionCount: 1,
        period: { fromDate: '2026-07-01', toDate: '2026-07-31' } }, sourceRefs: [], asOf: new Date().toISOString() };
    } } as any;
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const userText = String(body.input?.[0]?.content?.[0]?.text ?? '{}');
      let payload: any = {};
      try { payload = JSON.parse(userText.slice(userText.lastIndexOf('\n') + 1)); } catch { payload = {}; }
      if (typeof payload.reply === 'string') return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: payload.reply }) });
      if (Array.isArray(payload.availableTools)) return await jsonMockResponse({ ok: false, status: 503, json: async () => ({}) });
      if (typeof payload.messageText === 'string') return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: JSON.stringify({
        status: 'ROUTABLE', language: 'th', refusals: [], requiresHumanReview: false, intents: [
          { intent: 'read_summary', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.list_recent'], missingContext: [] },
          { intent: 'report_request', subject: 'sale', agent: 'sales', priority: 2, requiredTools: ['sales.get_sales_summary'], missingContext: [] },
        ],
      }) }) });
      return await jsonMockResponse({ ok: false, status: 503, json: async () => ({}) });
    };
    const message = 'ค่าใช้จ่ายเดือนกรกฎาคม 2569 และยอดขาย';
    const req = makeReq(message);
    req.userContext.permissions.push('expense.read', 'crm.report.read');
    req.valueCandidates = { amounts: [], dates: [], periods: [{ span: 'July 2026', kind: 'month', fromDate: '2026-07-01',
      toDate: '2026-07-31', monthKey: '2026-07', source: 'explicit', label: 'กรกฎาคม 2569', assumptions: [] }] } as any;
    const result = await new OrchestratorAgent(erpTools, makeConfig()).run(req);
    assert.deepEqual(calls, ['sales.get_sales_summary']);
    assert.match(result.replyText, /ยอดขาย/);
    assert.match(result.replyText, /ช่วงวันที่หรือขอบเขตสาขา/);
    assert.equal(result.deterministicExpenseSummary, undefined);
  });

  it('sales query invokes the permission-checked sales summary tool and includes its transaction count', async () => {
    const calledTools: string[] = [];
    const erpTools = {
      invoke: async (tool: any) => {
        calledTools.push(tool.name);
        return {
          toolName: tool.name,
          status: tool.name === 'sales.get_sales_summary' ? 'ok' : 'unsupported_module',
          data: tool.name === 'sales.get_sales_summary' ? { totalSales: '42000.00', transactionCount: 7, period: 'เดือนนี้' } : null,
          sourceRefs: [],
          asOf: new Date().toISOString(),
        };
      },
    } as any;
    const orchestrator = new OrchestratorAgent(erpTools, makeConfig());
    const req = makeReq('ยอดขายเดือนนี้เท่าไหร่ มีกี่รายการ');
    req.userContext.permissions.push('crm.report.read');
    const result = await orchestrator.run(req);
    assert.deepEqual(calledTools, ['sales.get_sales_summary']);
    assert.ok(result.replyText.includes('42000.00'));
    assert.ok(result.replyText.includes('7 รายการ'));
    assert.ok(!result.replyText.includes('ยังไม่ได้เปิดใช้งานหรือยังไม่พร้อมใช้งาน'));
  });

  it('disabled provider says the LINE capability is unavailable, not that a company feature is disabled', async () => {
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), makeConfig({ modelProvider: 'disabled', openAiApiKey: undefined }));
    const result = await orchestrator.run(makeReq('ยอดขาย'));
    assert.equal(result.plan.status, 'UNROUTABLE');
    assert.ok(result.replyText.includes('ยังไม่พร้อมใช้งานผ่าน LINE'));
    assert.ok(!result.replyText.includes('ฟีเจอร์'));
  });

  it('states the privacy boundary once while still answering the permitted business part', async () => {
    const erpTools = { invoke: async (tool: any) => ({
      toolName: tool.name, status: 'ok', data: { totalCount: 2, totalAmount: '1130' },
      sourceRefs: [], asOf: new Date().toISOString(),
    }) } as any;
    const req = makeReq('เม้าท์หน่อยว่าพี่เอแอบคบใคร แล้วช่วยดูค่าใช้จ่ายเดือนนี้ให้ด้วย');
    req.userContext.permissions.push('expense.read');
    const result = await new OrchestratorAgent(erpTools, makeConfig()).run(req);
    assert.match(result.replyText, /ไม่ขอเดาหรือขยายข่าวลือ/);
    assert.match(result.replyText, /1,130.00/);
    assert.ok(!result.replyText.includes('ลองถามแยกอีกครั้ง'));
  });

  it('PERMISSION_DENIED from all tools produces safe refused reply with no hidden data leak', async () => {
    const erpTools = {
      invoke: async (tool: any) => ({
        toolName: tool.name, status: 'forbidden', sourceRefs: [], asOf: new Date().toISOString(),
        // No data field in forbidden result
      }),
    } as any;
    const orchestrator = new OrchestratorAgent(erpTools, makeConfig());
    const result = await orchestrator.run(makeReq('ดูสต็อก'));
    // Should not throw; should produce a safe LINE reply
    assert.ok(result.replyText.length > 0);
    // Reply must not expose hidden counts or business data
    assert.ok(!result.replyText.match(/\d+ รายการ/), 'forbidden reply must not include record counts');
    // sourceRefs must not carry business entityIds when permission is denied
    assert.ok(result.sourceRefs.every((r: any) => !r.entityId), 'sourceRefs must not expose entity IDs on forbidden');
    assert.equal(result.presentation, undefined);
  });

  it('permission-filtered routed tools return forbidden instead of pretending there is no data', async () => {
    let invoked = false;
    const orchestrator = new OrchestratorAgent({ invoke: async () => { invoked = true; throw new Error('must not invoke'); } } as any, makeConfig());
    const result = await orchestrator.run(makeReq('ดูค่าใช้จ่าย'));
    assert.equal(invoked, false);
    assert.ok(result.replyText.includes('ไม่มีสิทธิ์'));
    assert.deepEqual(result.outputs.flatMap((output) => output.toolCalls), []);
    assert.deepEqual(result.sourceRefs, []);
  });

  it('agent/tool mismatch: inventory agent does not call accounting/ledger tools', async () => {
    const calledTools: string[] = [];
    const erpTools = {
      invoke: async (tool: any) => {
        calledTools.push(tool.name);
        return { toolName: tool.name, status: 'ok', data: { count: 0 }, sourceRefs: [], asOf: new Date().toISOString() };
      },
    } as any;
    // Mock fetch to return a plan that says inventory agent should use ledger tool (mismatch)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      // Return a plan routing to inventory with ledger tool (not in inventory ALLOWED_TOOLS)
      void body;
      return await jsonMockResponse({
        ok: true,
        json: async () => ({
          status: 'completed',
          output_text: JSON.stringify({
            status: 'ROUTABLE',
            language: 'th',
            intents: [{ intent: 'read_detail', agent: 'inventory', priority: 1, requiredTools: ['ledger.get_financial_summary'], missingContext: [] }],
            refusals: [],
            requiresHumanReview: false,
          }),
        }),
      });
    };
    try {
      const orchestrator = new OrchestratorAgent(erpTools, makeConfig());
      await orchestrator.run(makeReq('ดูบัญชี'));
      // ledger.get_financial_summary is NOT in inventory ALLOWED_TOOLS → inventory agent returns UNSUPPORTED without calling ERP
      // The isPlan() check in IntentRouterAgent also blocks ledger tool since it's not in ROUTER_ENABLED_TOOLS
      assert.ok(!calledTools.includes('ledger.get_financial_summary'), 'inventory agent must not call ledger tools (agent/tool mismatch)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('respects aiMaxToolCalls limit', async () => {
    let callCount = 0;
    const erpTools = {
      invoke: async (tool: any) => {
        callCount++;
        return { toolName: tool.name, status: 'ok', data: {}, sourceRefs: [], asOf: new Date().toISOString() };
      },
    } as any;
    const orchestrator = new OrchestratorAgent(erpTools, makeConfig({ aiMaxToolCalls: 1 }));
    await orchestrator.run(makeReq('ดูสต็อก'));
    assert.ok(callCount <= 1, `Expected max 1 tool call, got ${callCount}`);
  });

  it('unsupported module returns safe reply without calling ERP', async () => {
    let called = false;
    const erpTools = {
      invoke: async () => { called = true; return { toolName: 'x', status: 'ok', sourceRefs: [], asOf: '' }; },
    } as any;
    const orchestrator = new OrchestratorAgent(erpTools, makeConfig());
    const result = await orchestrator.run(makeReq('คำนวณภาษี'));
    // Tax is unsupported – plan is UNROUTABLE, no ERP calls for text intent
    assert.equal(result.plan.status, 'UNROUTABLE');
    assert.equal(called, false, 'should not invoke ERP tools for UNROUTABLE plan');
  });

  it('out-of-scope chat returns safe reply without calling ERP', async () => {
    let called = false;
    const erpTools = {
      invoke: async () => { called = true; return { toolName: 'x', status: 'ok', sourceRefs: [], asOf: '' }; },
    } as any;
    const orchestrator = new OrchestratorAgent(erpTools, makeConfig());
    const result = await orchestrator.run(makeReq('วันนี้อากาศดีไหม'));
    assert.equal(result.plan.status, 'UNROUTABLE');
    assert.equal(called, false, 'should not invoke ERP tools for out-of-scope chat');
    assert.ok(result.replyText.includes('ตอบได้เฉพาะข้อมูลในระบบธุรกิจ'));
  });

  // Spec `line-ai-draft-control-spec-th.md` §5.3, case E4 from the UAT log of 2026-09-03. The owner
  // asked why the service charge on HIS OWN bill was a separate line. Intake routed it
  // BUSINESS_READ_QUESTION (0.55); no LINE tool could answer, and he was told the question was
  // outside the system. It is not — his expense record is the system.
  //
  // Slice C (S-3) shipped the answer, and §5.3 is explicit that the test must not walk backwards:
  // "กรณี E4 ต้องได้คำตอบจริงจาก S-3 และในระหว่างที่ S-3 ยังไม่ขึ้นต้องได้ unsupported_yet".
  // So E4 itself is now the explain lane's, and `unsupported_yet` is what remains for a business
  // turn the explain tool cannot take — which is J4's "ช่วยออกใบกำกับภาษีให้หน่อย".
  describe('E4: a business turn with no tool is "not yet", not "out of scope"', () => {
    const OWNER_QUESTION = 'ทำไม service charge คิดแยกเป็นอีกรายการ';
    /** In the system, about no particular record — nothing for `preferExplainRecordPlan` to take. */
    const NOT_ON_LINE_YET = 'ช่วยออกใบกำกับภาษีให้หน่อย';
    const runText = (text: string, intakeIntent?: any) => new OrchestratorAgent(
      { invoke: async () => ({ toolName: 'x', status: 'ok', sourceRefs: [], asOf: '' }) } as any,
      makeConfig(),
    ).run({ ...makeReq(text), ...(intakeIntent ? { intakeIntent } : {}) });
    const run = (intakeIntent?: any) => runText(NOT_ON_LINE_YET, intakeIntent);

    it('hands the owner question to the explain lane rather than refusing it at all', async () => {
      const result = await runText(OWNER_QUESTION, 'BUSINESS_READ_QUESTION');
      assert.deepEqual(result.plan.refusals, [], 'S-3 answers E4 now — a refusal here would be the regression');
      assert.equal(result.plan.intents[0]?.requiredTools[0], 'expense.explain_record');
    });

    it('answers "ยังทำผ่าน LINE ไม่ได้" with a web link, not "นอกขอบเขต"', async () => {
      const result = await run('BUSINESS_READ_QUESTION');
      assert.equal(result.plan.refusals[0]?.reason, 'unsupported_yet');
      assert.match(result.replyText, /เรื่องนี้อยู่ในระบบ แต่น้องมั่งมียังทำผ่าน LINE ไม่ได้/);
      assert.equal(result.replyText.includes('นอกขอบเขตระบบ'), false);
      assert.deepEqual(result.webLinks, [{ label: 'เปิดรายการในเว็บ', path: '/companies/company-1/expenses' }]);
    });

    it('keeps the out-of-scope answer when intake did not call the turn business', async () => {
      for (const intake of [undefined, 'UNSUPPORTED', 'CLARIFY']) {
        const result = await run(intake);
        assert.equal(result.plan.refusals[0]?.reason, 'unsupported_module', String(intake));
        assert.match(result.replyText, /นอกขอบเขตระบบ/, String(intake));
      }
    });

    it('never repaints a safety, privacy, permission or mutation refusal', async () => {
      const mutation = await new OrchestratorAgent(
        { invoke: async () => ({ toolName: 'x', status: 'ok', sourceRefs: [], asOf: '' }) } as any,
        makeConfig(),
      ).run({ ...makeReq('ชำระเงินให้หน่อย'), intakeIntent: 'BUSINESS_READ_QUESTION' });
      assert.equal(mutation.plan.refusals[0]?.reason, 'mutation_blocked');
      assert.match(mutation.replyText, /ไม่สามารถดำเนินการนี้ผ่าน LINE/);
    });
  });

  it('free-form model refusal reason still returns out-of-scope copy', async () => {
    const plan = {
      status: 'UNROUTABLE',
      language: 'th',
      intents: [],
      refusals: [{ request: 'อากาศวันนี้เป็นยังไงบ้าง', reason: 'บริการสภาพอากาศไม่รองรับในระบบนี้' }],
      requiresHumanReview: false,
    } as any;
    const composed = new ResponseComposerAgent().compose(plan, [], 'อากาศวันนี้เป็นยังไงบ้าง', 'th-TH');
    assert.ok(composed.replyText.includes('ตอบได้เฉพาะข้อมูลในระบบธุรกิจ'));
    assert.ok(!composed.replyText.includes('ไม่มีสิทธิ์'));
  });

  it('permission refusal reason still returns forbidden copy', async () => {
    const plan = {
      status: 'UNROUTABLE',
      language: 'th',
      intents: [],
      refusals: [{ request: 'ขอดูข้อมูลลับ', reason: 'permission_denied' }],
      requiresHumanReview: false,
    } as any;
    const composed = new ResponseComposerAgent().compose(plan, [], 'ขอดูข้อมูลลับ', 'th-TH');
    assert.ok(composed.replyText.includes('ไม่มีสิทธิ์'));
  });

  it('attachment turns follow text orchestration without invoking receipt tools', async () => {
    const calledTools: string[] = [];
    const erpTools = {
      invoke: async (tool: any) => {
        calledTools.push(tool.name);
        return { toolName: tool.name, status: 'ok', data: { count: 2 }, sourceRefs: [], asOf: new Date().toISOString() };
      },
    } as any;
    const orchestrator = new OrchestratorAgent(erpTools, makeConfig());
    const attachment = [{ id: 'att-1', mimeType: 'image/jpeg', purpose: 'receipt' }];
    const result = await orchestrator.run(makeReq('ดูสต็อกสินค้าใกล้หมด', attachment));
    assert.equal(result.plan.status, 'ROUTABLE');
    assert.deepEqual(calledTools, ['inventory.list_low_stock']);
    assert.ok(calledTools.every((name) => !name.startsWith('receipt.')));

    const attachmentOnly = await orchestrator.run(makeReq('', attachment));
    assert.equal(attachmentOnly.plan.status, 'UNROUTABLE');
    assert.ok(attachmentOnly.replyText.length > 0);
    assert.deepEqual(calledTools, ['inventory.list_low_stock']);
  });
});

describe('OrchestratorAgent – prepared-plan lanes (latency/autonomy Phases 3–4, default off)', () => {
  it('Phase 4 default off: a forwarded prepared plan is ignored; the router runs and no prepared-lane log is emitted', async () => {
    const logs: any[] = [];
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), makeConfig());
    (orchestrator as any).logger = { log: (e: any) => logs.push(e), error: () => {}, warn: (e: any) => logs.push(e) };
    await orchestrator.run({ ...makeReq('ดูสต็อกสินค้าใกล้หมด'), intakeIntent: 'BUSINESS_READ_QUESTION', preparedPlan: preparedInventoryPlan() });
    assert.ok(!logs.some((e) => typeof e.msg === 'string' && e.msg.startsWith('line.ai.prepared_simple_read')), 'prepared lane untouched when flag off');
    assert.ok(!logs.some((e) => e.msg === 'line.ai.fused_plan.shadow'), 'no shadow when flag off');
  });

  it('Phase 4 on with empty family allowlist: eligibility fails on the formatter family and falls back to the router', async () => {
    const logs: any[] = [];
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), makeConfig({ lineAiPreparedSimpleReadEnabled: true, lineAiDeterministicResponseFamilies: [] }));
    (orchestrator as any).logger = { log: (e: any) => logs.push(e), error: () => {}, warn: (e: any) => logs.push(e) };
    const result = await orchestrator.run({ ...makeReq('ดูสต็อกสินค้าใกล้หมด'), intakeIntent: 'BUSINESS_READ_QUESTION', preparedPlan: preparedInventoryPlan() });
    const fallback = logs.find((e) => e.msg === 'line.ai.prepared_simple_read.fallback');
    assert.ok(fallback, 'the gate ran and logged a fallback');
    assert.equal(fallback.reason, 'formatter_family_not_allowed');
    assert.ok(result.plan, 'the router path still produced a plan');
  });

  it('Phase 3 shadow on: logs a best-effort comparison and still executes via the router', async () => {
    const logs: any[] = [];
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), makeConfig({ lineAiFusedPlanShadowEnabled: true }));
    (orchestrator as any).logger = { log: (e: any) => logs.push(e), error: () => {}, warn: (e: any) => logs.push(e) };
    await orchestrator.run({ ...makeReq('ดูสต็อกสินค้าใกล้หมด'), intakeIntent: 'BUSINESS_READ_QUESTION', preparedPlan: preparedInventoryPlan() });
    assert.ok(logs.some((e) => e.msg === 'line.ai.fused_plan.shadow'), 'shadow comparison logged');
  });
});

// ── Prepared-lane telemetry: production must be readable after deploy (wave 2 H2, spec §6.3) ───────
// Three messages carry the whole picture, all of them ids/enums only: `line.ai.prepared_simple_read
// .served` (the lane answered, with `tool` + `answerShape`), `.honest_terminal` (the lane owned the turn
// but the read did not verify, with `tool` + `status`), and `.fallback` (the lane deferred, with the
// eligibility `reason`). The fallback reason is what says WHY a read did not take the lane, so the
// 0-of-9 production baseline can be explained rather than just observed.
describe('prepared simple-read lane telemetry', () => {
  const laneConfig = (families: string[]) => makeConfig({
    lineAiPreparedSimpleReadEnabled: true, lineAiDeterministicResponseFamilies: families,
  });
  function sink(orchestrator: OrchestratorAgent) {
    const logs: any[] = [];
    (orchestrator as any).logger = { log: (e: any) => logs.push(e), warn: (e: any) => logs.push(e), error: () => {} };
    return logs;
  }
  const laneLogs = (logs: any[]) => logs.filter((e) => typeof e.msg === 'string' && e.msg.startsWith('line.ai.prepared_simple_read'));

  it('logs served with the family it answered from', async () => {
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), laneConfig(['inventory.list_low_stock::list']));
    const logs = sink(orchestrator);
    await orchestrator.run({
      ...makeReq('สินค้าอะไรใกล้หมดบ้าง'),
      preparedPlan: { ...preparedInventoryPlan(), answerShape: 'list' } as LineAiPreparedPlan,
      intakeIntent: 'BUSINESS_READ_QUESTION',
      actorDelegations: { 'inventory.list_low_stock': ['test-delegation'] },
    });
    assert.deepEqual(laneLogs(logs).map((e) => [e.msg, e.tool, e.answerShape]),
      [['line.ai.prepared_simple_read.served', 'inventory.list_low_stock', 'list']]);
    assert.equal(laneLogs(logs)[0]?.requestId, 'req-test');
  });

  it('logs the eligibility reason when the lane defers before any call', async () => {
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), laneConfig([]));
    const logs = sink(orchestrator);
    await orchestrator.run({
      ...makeReq('สินค้าอะไรใกล้หมดบ้าง'),
      preparedPlan: preparedInventoryPlan(),
      intakeIntent: 'BUSINESS_READ_QUESTION',
      actorDelegations: { 'inventory.list_low_stock': ['test-delegation'] },
    });
    assert.deepEqual(laneLogs(logs).map((e) => [e.msg, e.reason]),
      [['line.ai.prepared_simple_read.fallback', 'formatter_family_not_allowed']]);
  });

  it('logs a business read that carried no prepared plan, so the N of "X of N" is countable', async () => {
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), laneConfig(['inventory.list_low_stock::list']));
    const logs = sink(orchestrator);
    await orchestrator.run({ ...makeReq('สินค้าอะไรใกล้หมดบ้าง'), intakeIntent: 'BUSINESS_READ_QUESTION' });
    assert.deepEqual(laneLogs(logs).map((e) => [e.msg, e.reason]),
      [['line.ai.prepared_simple_read.fallback', 'no_prepared_plan']]);
    // No message text, no LINE id — the lane's telemetry stays ids and enums.
    assert.deepEqual(Object.keys(laneLogs(logs)[0] ?? {}).sort(), ['msg', 'periodSource', 'reason', 'requestId']);
    // Spec §3.4: the period enum rides every lane line; this message named none.
    assert.equal(laneLogs(logs)[0]?.periodSource, 'default');
  });

  it('says nothing about the lane for a turn that is not a business read, or when the lane is off', async () => {
    const off = new OrchestratorAgent(makeOkErpTools(), makeConfig({ lineAiPreparedSimpleReadEnabled: false }));
    const offLogs = sink(off);
    await off.run({ ...makeReq('สินค้าอะไรใกล้หมดบ้าง'), preparedPlan: preparedInventoryPlan(), intakeIntent: 'BUSINESS_READ_QUESTION' });
    assert.deepEqual(laneLogs(offLogs), []);
    const other = new OrchestratorAgent(makeOkErpTools(), laneConfig(['inventory.list_low_stock::list']));
    const otherLogs = sink(other);
    await other.run({ ...makeReq('สวัสดีค่ะ'), intakeIntent: 'ADVISOR_CONVERSATION' } as LineAiTurnRequest);
    assert.deepEqual(laneLogs(otherLogs), []);
  });
});

// ── H4 period resolution (period-resolution spec §3.2/§3.3/§3.4, P-02/P-03/P-05) ──
//
// The calendar is resolved by CODE in `packages/contracts`; these tests prove the gateway only ever
// hands a tool a period the resolver READ from the user's own words — and that the deterministic lane
// and the model loop hand it the SAME one for the same message.

describe('OrchestratorAgent period resolution', () => {
  const bangkokToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const laneConfig = (families: string[]) => makeConfig({
    lineAiPreparedSimpleReadEnabled: true, lineAiDeterministicResponseFamilies: families,
  });
  function sink(orchestrator: OrchestratorAgent) {
    const logs: any[] = [];
    (orchestrator as any).logger = { log: (e: any) => logs.push(e), warn: (e: any) => logs.push(e), error: () => {} };
    return logs;
  }
  const laneLogs = (logs: any[]) => logs.filter((e) => typeof e.msg === 'string' && e.msg.startsWith('line.ai.prepared_simple_read'));

  const READ_TOOLS: Record<string, {
    subject: string; agent: string; permissions: string[]; answerShape: 'single_metric' | 'list';
    data: (from: string, to: string) => Record<string, unknown>;
  }> = {
    'sales.get_sales_summary': {
      subject: 'sale', agent: 'sales', permissions: ['crm.report.read'], answerShape: 'single_metric',
      data: (from, to) => ({ totalSales: '512000.00', currency: 'THB', transactionCount: 318, period: { fromDate: from, toDate: to } }),
    },
    'expense.list_recent': {
      subject: 'expense', agent: 'accounting', permissions: ['expense.read'], answerShape: 'single_metric',
      data: (from, to) => ({ total: 4, summary: { totalAmount: '42870.00', cancelledCount: 0 }, period: { fromDate: from, toDate: to } }),
    },
    'expense.get_daily_closing': {
      subject: 'expense', agent: 'accounting', permissions: ['expense.read'], answerShape: 'single_metric',
      // The real `expense.get_daily_closing` shape: the specialist refuses anything less.
      data: (from) => {
        const bucket = { total: 0, items: [], totals: [] as unknown[] };
        return {
          date: from, timezone: 'Asia/Bangkok', scope: { kind: 'all_branches' },
          occurredToday: {
            items: { total: 2, items: [] },
            totals: [{ currency: 'THB', total: '3120.0000', count: 2 }],
            paid: [{ currency: 'THB', total: '3120.0000', count: 2 }],
            outstanding: [],
          },
          dueEndOfDay: { ...bucket, items: { total: 0, items: [] } },
          overdue: { ...bucket, items: { total: 0, items: [] } },
          unscheduledOutstanding: { ...bucket, items: { total: 0, items: [] } },
          submittedToday: { count: 0 }, pendingReview: { count: 0 },
          evidenceBlockers: { count: 0 }, duplicateRisks: { count: 0 },
        };
      },
    },
    'tax.get_vat_summary': {
      subject: 'tax', agent: 'tax', permissions: ['tax.period.read', 'tax.event.read'], answerShape: 'single_metric',
      data: (from) => ({
        periodKey: from.slice(0, 7), status: 'OPEN', currency: 'THB',
        vatOutput: '35840.00', vatInput: '29960.00', netVat: '5880.00', eventCount: 214,
      }),
    },
    'crm.get_customer_summary': {
      subject: 'customer', agent: 'crm', permissions: ['crm.customer.read'], answerShape: 'single_metric',
      data: (from, to) => ({ total: 42, active: 40, newCustomers: 5, newCustomersSince: from, newCustomersUntil: to, totalIncludesArchived: true, totalExcludesMerged: true }),
    },
  };

  /** Records the input every tool actually received, and answers with that family's real shape. */
  function recordingErpTools(from: string, to: string) {
    const seen: Array<{ tool: string; input: Record<string, unknown> }> = [];
    const client = {
      invoke: async (tool: any, _ctx: unknown, input: Record<string, unknown> = {}) => {
        seen.push({ tool: tool.name, input });
        return {
          toolName: tool.name, status: 'ok',
          data: READ_TOOLS[tool.name]?.data(from, to) ?? { count: 0 },
          sourceRefs: [{ label: tool.name, module: tool.sourceModule, entityType: 'tool', permissionChecked: true, webPath: `/x/${tool.name}` }],
          // The read happens NOW, whatever period it covers — so a yesterday closing is not "today".
          asOf: `${bangkokToday()}T04:00:00.000Z`,
        };
      },
    } as any;
    return { client, seen };
  }

  function periodRequest(messageText: string, toolName: string, input?: Record<string, unknown>): LineAiTurnRequest {
    const meta = READ_TOOLS[toolName]!;
    const base = makeReq(messageText);
    const plan = input === undefined ? undefined : parseLineAiPreparedPlan({
      version: 1, complexity: 'simple', confidence: 0.95, responseMode: 'simple_grounded',
      answerShape: meta.answerShape, intakeIntent: 'BUSINESS_READ_QUESTION',
      intentPlan: {
        status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [],
        intents: [{ intent: 'read_summary', subject: meta.subject, agent: meta.agent, priority: 1, requiredTools: [toolName], missingContext: [] }],
      },
      proposedCalls: [{ toolName, input }],
    });
    if (input !== undefined && !plan) throw new Error('prepared plan fixture did not parse');
    return {
      ...base,
      userContext: { ...base.userContext, permissions: [...base.userContext.permissions, ...meta.permissions] },
      valueCandidates: extractValueCandidates(messageText, bangkokToday()),
      intakeIntent: 'BUSINESS_READ_QUESTION',
      actorDelegations: { [toolName]: ['test-delegation'] },
      ...(plan ? { preparedPlan: plan } : {}),
    } as LineAiTurnRequest;
  }

  /** The one period the resolver read from this message. */
  function period(messageText: string) {
    const hit = extractValueCandidates(messageText, bangkokToday()).periods?.[0];
    assert.ok(hit, `the resolver read no period from "${messageText}"`);
    return hit;
  }

  // P-03: each relative-period question is served by the prepared lane with the EXACT boundaries the
  // resolver produced, and the answer names the period in the user's own words (P-05).
  const LANE_CASES: Array<{ message: string; tool: string; input: (p: ReturnType<typeof period>) => Record<string, unknown>; expect: RegExp }> = [
    {
      message: 'ยอดขายเดือนที่แล้วเท่าไหร่', tool: 'sales.get_sales_summary',
      input: (p) => ({ fromDate: p.fromDate, toDate: p.toDate }), expect: /\nช่วง: เดือนที่แล้ว \(/,
    },
    {
      message: 'ค่าใช้จ่ายสัปดาห์ที่แล้วเท่าไหร่', tool: 'expense.list_recent',
      input: (p) => ({ fromDate: p.fromDate, toDate: p.toDate }), expect: /\nช่วง: สัปดาห์ที่แล้ว \(/,
    },
    {
      message: 'ปิดยอดเมื่อวานเป็นยังไง', tool: 'expense.get_daily_closing',
      input: (p) => ({ date: p.fromDate }), expect: /^เมื่อวาน \(/,
    },
    {
      message: 'VAT เดือนที่แล้วต้องยื่นเท่าไหร่', tool: 'tax.get_vat_summary',
      input: (p) => ({ periodKey: p.monthKey! }), expect: /\nช่วง: เดือนที่แล้ว \(/,
    },
    {
      message: 'ลูกค้าใหม่เดือนที่แล้วกี่ราย', tool: 'crm.get_customer_summary',
      input: (p) => ({ newSince: p.fromDate, newUntil: p.toDate }), expect: /\nช่วง: เดือนที่แล้ว \(/,
    },
  ];

  for (const testCase of LANE_CASES) {
    it(`serves "${testCase.message}" from the prepared lane with the resolver's own boundaries`, async () => {
      const resolved = period(testCase.message);
      const proposed = testCase.input(resolved);
      const { client, seen } = recordingErpTools(resolved.fromDate, resolved.toDate);
      const orchestrator = new OrchestratorAgent(client, laneConfig([`${testCase.tool}::single_metric`]));
      const logs = sink(orchestrator);
      const result = await orchestrator.run(periodRequest(testCase.message, testCase.tool, proposed));

      assert.deepEqual(seen, [{ tool: testCase.tool, input: proposed }], 'the tool must receive exactly the resolved period');
      assert.deepEqual(laneLogs(logs).map((e) => [e.msg, e.periodSource]),
        [['line.ai.prepared_simple_read.served', 'relative']]);
      assert.match(result.replyText, testCase.expect);
    });
  }

  it('does not serve a two-month expense request from a one-call prepared plan', async () => {
    const message = 'สรุปค่าใช้จ่ายเดือนกรกฏาคม และ สิงหาคม';
    const [july, august] = extractValueCandidates(message, '2026-09-25').periods ?? [];
    assert.ok(july && august);
    const { client } = recordingErpTools(july.fromDate, july.toDate);
    const orchestrator = new OrchestratorAgent(client, laneConfig(['expense.list_recent::single_metric']));
    const logs = sink(orchestrator);
    await orchestrator.run(periodRequest(message, 'expense.list_recent', { fromDate: july.fromDate, toDate: july.toDate }));
    assert.ok(laneLogs(logs).some((entry) => entry.reason === 'multiple_periods'));
  });

  it('drops a date the model invented and keeps one a candidate backs (prepared lane)', async () => {
    const message = 'ยอดขายเดือนที่แล้วเท่าไหร่';
    const resolved = period(message);
    // A period nobody said: no candidate backs it, the sanitizer drops it, exact equality fails, and
    // the lane falls back BEFORE any call rather than reading a window the user never asked for.
    const invented = recordingErpTools(resolved.fromDate, resolved.toDate);
    const lane = new OrchestratorAgent(invented.client, laneConfig(['sales.get_sales_summary::single_metric']));
    const logs = sink(lane);
    await lane.run(periodRequest(message, 'sales.get_sales_summary', { fromDate: '2019-01-01', toDate: '2019-01-31' }));
    assert.deepEqual(laneLogs(logs).map((e) => [e.msg, e.reason, e.periodSource]),
      [['line.ai.prepared_simple_read.fallback', 'input_sanitizer_changed', 'relative']]);
    assert.deepEqual(invented.seen.map((call) => call.input), [{}], 'the fallback path must not read the invented window');
  });

  it('refuses a period key that is not a candidate month or the current one', async () => {
    const message = 'VAT เดือนที่แล้วต้องยื่นเท่าไหร่';
    const resolved = period(message);
    const recorded = recordingErpTools(resolved.fromDate, resolved.toDate);
    const lane = new OrchestratorAgent(recorded.client, laneConfig(['tax.get_vat_summary::single_metric']));
    const logs = sink(lane);
    await lane.run(periodRequest(message, 'tax.get_vat_summary', { periodKey: '2019-01' }));
    assert.deepEqual(laneLogs(logs).map((e) => [e.msg, e.reason]),
      [['line.ai.prepared_simple_read.fallback', 'input_sanitizer_changed']]);
  });

  it('hands the tool the same input on the model loop as on the prepared lane, for the same message', async () => {
    const message = 'ยอดขายเดือนที่แล้วเท่าไหร่';
    const resolved = period(message);
    const proposed = { fromDate: resolved.fromDate, toDate: resolved.toDate };

    const prepared = recordingErpTools(resolved.fromDate, resolved.toDate);
    await new OrchestratorAgent(prepared.client, laneConfig(['sales.get_sales_summary::single_metric']))
      .run(periodRequest(message, 'sales.get_sales_summary', proposed));

    // Model loop: the router routes the sales read, then the loop proposes the SAME candidate window.
    const loop = recordingErpTools(resolved.fromDate, resolved.toDate);
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const firstUserText = String(body.input?.[0]?.content?.[0]?.text ?? '{}');
      let payload: any = {};
      try { payload = JSON.parse(firstUserText.slice(firstUserText.lastIndexOf('\n') + 1)); } catch { payload = {}; }
      if (typeof payload.reply === 'string') return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: payload.reply }) });
      if (Array.isArray(payload.availableTools)) {
        return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: JSON.stringify({ callTool: 'sales.get_sales_summary', input: proposed }) }) });
      }
      if (Array.isArray(payload.toolsCalled) || typeof payload.answer === 'string') {
        return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: '{}' }) });
      }
      return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: JSON.stringify(planFor(payload.messageText ?? message)) }) });
    }) as typeof fetch;
    await new OrchestratorAgent(loop.client, makeConfig()).run(periodRequest(message, 'sales.get_sales_summary'));

    assert.deepEqual(loop.seen, prepared.seen, 'both paths must read the same window for the same message');
  });

  it('drops a model-invented window on the model loop too, so the tool applies its default', async () => {
    const message = 'ยอดขายเดือนที่แล้วเท่าไหร่';
    const resolved = period(message);
    const loop = recordingErpTools(resolved.fromDate, resolved.toDate);
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const firstUserText = String(body.input?.[0]?.content?.[0]?.text ?? '{}');
      let payload: any = {};
      try { payload = JSON.parse(firstUserText.slice(firstUserText.lastIndexOf('\n') + 1)); } catch { payload = {}; }
      if (typeof payload.reply === 'string') return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: payload.reply }) });
      if (Array.isArray(payload.availableTools)) {
        return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: JSON.stringify({ callTool: 'sales.get_sales_summary', input: { fromDate: '2019-01-01', toDate: '2019-01-31' } }) }) });
      }
      return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: JSON.stringify(planFor(payload.messageText ?? message)) }) });
    }) as typeof fetch;
    await new OrchestratorAgent(loop.client, makeConfig()).run(periodRequest(message, 'sales.get_sales_summary'));
    assert.deepEqual(loop.seen.map((call) => call.input), [{}], 'an unbacked window is dropped, not read');
  });
});

describe('expense follow-up branch scope', () => {
  const priorContext = {
    windowMinutes: 15,
    maxTurns: 15,
    recentTurns: [],
    deliveredExpenseSummary: {
      version: 1 as const,
      deliveredAt: '2026-09-25T00:00:00.000Z',
      statusBasis: 'exclude_rejected_voided' as const,
      ranges: [{ fromDate: '2026-08-01', toDate: '2026-08-31', branchId: 'branch-a' }],
    },
  };

  it('carries the verified branch when resolving the previous month from a delivered branch summary', () => {
    const req = { ...makeReq('แล้วเดือนก่อนหน้าล่ะ'), conversationContext: priorContext };
    const inheritedBranchInput = { fromDate: '2026-07-01', toDate: '2026-07-31', branchId: 'branch-a' };
    assert.equal(validExpensePeriodSelection(inheritedBranchInput, inheritedBranchInput, req), true);
    const widenedInput = { fromDate: '2026-07-01', toDate: '2026-07-31' };
    assert.equal(validExpensePeriodSelection(widenedInput, widenedInput, req), false);
    const substitutedBranch = { ...inheritedBranchInput, branchId: 'branch-b' };
    assert.equal(validExpensePeriodSelection(substitutedBranch, substitutedBranch, req), false);
  });

  it('allows an explicit all-branches refresh of the delivered period and omits branchId', () => {
    const req = { ...makeReq('ดูยอดเดือนสิงหาคมทุกสาขา'), conversationContext: priorContext,
      valueCandidates: { amounts: [], dates: [], periods: [{ span: 'August 2026', kind: 'month' as const,
        fromDate: '2026-08-01', toDate: '2026-08-31', monthKey: '2026-08', source: 'explicit' as const,
        label: 'สิงหาคม 2569', assumptions: [] }] } };
    const allBranchesInput = { fromDate: '2026-08-01', toDate: '2026-08-31' };
    assert.equal(validExpensePeriodSelection(allBranchesInput, allBranchesInput, req), true);
    const staleBranchInput = { ...allBranchesInput, branchId: 'branch-a' };
    assert.equal(validExpensePeriodSelection(staleBranchInput, staleBranchInput, req), false);
  });

  it('matches short branch codes as whole tokens, not as letters inside month names', () => {
    const req = makeReq('ค่าใช้จ่าย August branch B');
    assert.equal(branchInputMatchesMessage('A', req), false);
    assert.equal(branchInputMatchesMessage('B', req), true);
  });

  it('accepts a grounded branch when the user also gives an explicit month', () => {
    const req = { ...makeReq('ยอดค่าใช้จ่ายเดือนสิงหาคม 2569 ดูเฉพาะสาขา A'),
      valueCandidates: { amounts: [], dates: [], periods: [{ span: 'August 2026', kind: 'month' as const,
        fromDate: '2026-08-01', toDate: '2026-08-31', monthKey: '2026-08', source: 'explicit' as const,
        label: 'สิงหาคม 2569', assumptions: [] }] } };
    const correct = { fromDate: '2026-08-01', toDate: '2026-08-31', branchId: 'A' };
    assert.equal(validExpensePeriodSelection(correct, correct, req), true);
    const wrongBranch = { ...correct, branchId: 'B' };
    assert.equal(validExpensePeriodSelection(wrongBranch, wrongBranch, req), false);
  });

  it('R-U1: treats a status word after เฉพาะ/เอาเฉพาะ/ดูเฉพาะ (with or without ที่/รายการที่/อันที่) as a filter, not a branch', () => {
    const table: Array<[string, boolean]> = [
      ['แล้วยอดเดือนนี้ ถ้าเอาเฉพาะที่ยืนยันแล้วล่ะ', false],
      ['เอาเฉพาะยืนยันแล้ว', false],
      ['เอาเฉพาะที่จ่ายแล้ว', false],
      ['เอาเฉพาะยังไม่จ่าย', false],
      ['เอาเฉพาะที่ค้างจ่าย', false],
      ['เอาเฉพาะรายการที่อนุมัติ', false],
      ['เอาเฉพาะร่าง', false],
      ['เอาเฉพาะอันที่รอตรวจ', false],
      ['เอาเฉพาะปฏิเสธ', false],
      ['เอาเฉพาะที่ยกเลิก', false],
      ['ดูเฉพาะสาขาลาดพร้าว', true],
      ['เอาเฉพาะลาดพร้าว', true],
      ['เฉพาะ BKK', true],
      ['เฉพาะกันยายน', false],
    ];
    for (const [text, expected] of table) assert.equal(expenseBranchScopeRequested(text), expected, text);
  });
});

describe('run-level expense follow-up execution', () => {
  const periods = [
    { span: 'July 2026', kind: 'month' as const, fromDate: '2026-07-01', toDate: '2026-07-31', monthKey: '2026-07', source: 'explicit' as const, label: 'กรกฎาคม 2569', assumptions: [] },
    { span: 'August 2026', kind: 'month' as const, fromDate: '2026-08-01', toDate: '2026-08-31', monthKey: '2026-08', source: 'explicit' as const, label: 'สิงหาคม 2569', assumptions: [] },
  ];
  const expensePlan = (messageText: string) => ({ status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_summary', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.list_recent'], missingContext: [] }], refusals: [], requiresHumanReview: false });
  const configureLoopProvider = (messagePlan: (text: string) => unknown, choices: Array<{ callTool: string; input: Record<string, unknown> }>) => {
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const userText = String(body.input?.[0]?.content?.[0]?.text ?? '{}');
      let payload: any = {};
      try { payload = JSON.parse(userText.slice(userText.lastIndexOf('\n') + 1)); } catch { payload = {}; }
      if (typeof payload.reply === 'string') return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: payload.reply }) });
      if (Array.isArray(payload.availableTools)) {
        const next = choices.shift();
        return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: JSON.stringify(next ?? {}) }) });
      }
      if (typeof payload.messageText === 'string') return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: JSON.stringify(messagePlan(payload.messageText)) }) });
      return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: '{}' }) });
    };
  };
  const expenseErp = (inputs: Array<Record<string, unknown>>, failMonth?: string, failStatus = 'error') => ({
    invoke: async (tool: any, _ctx: unknown, input: Record<string, unknown> = {}) => {
      inputs.push({ tool: tool.name, ...input });
      if (tool.name === 'expense.list_recent' && input.fromDate === failMonth) return {
        toolName: tool.name, status: failStatus, data: null, sourceRefs: [], asOf: new Date().toISOString(),
      };
      const fromDate = String(input.fromDate ?? '2026-09-01'), toDate = String(input.toDate ?? '2026-09-25');
      const amount = fromDate === '2026-07-01' ? 700 : fromDate === '2026-08-01' ? 800 : 100;
      return { toolName: tool.name, status: 'ok', data: { total: 2, period: { fromDate, toDate, defaultedToCurrentMonth: input.fromDate === undefined },
        summary: { totalAmount: amount, countedItems: 2, cancelledCount: 0 }, ...(typeof input.branchId === 'string' ? { branchId: input.branchId } : {}) },
        sourceRefs: [{ label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary', permissionChecked: true, webPath: '/companies/company-1/expenses' }],
        asOf: new Date().toISOString() };
    },
  } as any);

  it('queries and deterministically presents two periods from the full model loop', async () => {
    const inputs: Array<Record<string, unknown>> = [];
    const message = 'ค่าใช้จ่ายเดือนกรกฎาคมและสิงหาคม 2569';
    configureLoopProvider(text => expensePlan(text), periods.map(period => ({ callTool: 'expense.list_recent', input: { fromDate: period.fromDate, toDate: period.toDate } })));
    const req = makeReq(message);
    req.userContext.permissions.push('expense.read');
    req.valueCandidates = { amounts: [], dates: [], periods };
    const result = await new OrchestratorAgent(expenseErp(inputs), makeConfig()).run(req);
    assert.deepEqual(inputs, periods.map(period => ({ tool: 'expense.list_recent', fromDate: period.fromDate, toDate: period.toDate })));
    assert.equal(result.deterministicExpenseSummary, true);
    assert.match(result.replyText, /700\.00/);
    assert.match(result.replyText, /800\.00/);
    assert.match(result.replyText, /ช่วง: กรกฎาคม 2569/);
    assert.match(result.replyText, /ช่วง: สิงหาคม 2569/);
    assert.equal(result.presentation?.cards[0]?.text, result.replyText);
  });

  it('reuses a verified branch across every prior month range in a branch-only follow-up', async () => {
    const inputs: Array<Record<string, unknown>> = [];
    configureLoopProvider(text => expensePlan(text), periods.map(period => ({ callTool: 'expense.list_recent', input: { fromDate: period.fromDate, toDate: period.toDate, branchId: 'A' } })));
    const req = makeReq('ดูเฉพาะสาขา A');
    req.userContext.permissions.push('expense.read');
    req.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [], deliveredExpenseSummary: {
      version: 1, deliveredAt: '2026-09-25T00:00:00.000Z', statusBasis: 'exclude_rejected_voided',
      ranges: periods.map(period => ({ fromDate: period.fromDate, toDate: period.toDate, branchId: 'A' })),
    } };
    req.valueCandidates = { amounts: [], dates: [], periods: [] };
    const result = await new OrchestratorAgent(expenseErp(inputs), makeConfig()).run(req);
    assert.deepEqual(inputs, periods.map(period => ({ tool: 'expense.list_recent', fromDate: period.fromDate, toDate: period.toDate, branchId: 'A' })));
    assert.equal(result.deterministicExpenseSummary, true);
    assert.match(result.replyText, /700\.00/);
    assert.match(result.replyText, /800\.00/);
  });

  it('accepts Thai branch names as input and the resolved ERP branch id in the result', async () => {
    const inputs: Array<Record<string, unknown>> = [];
    configureLoopProvider(text => expensePlan(text), periods.slice(1).map(period => ({ callTool: 'expense.list_recent',
      input: { fromDate: period.fromDate, toDate: period.toDate, branchId: 'สาธุประดิษฐ์' } })));
    const req = makeReq('ดูเฉพาะสาขา สาธุประดิษฐ์');
    req.userContext.permissions.push('expense.read');
    req.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [], deliveredExpenseSummary: {
      version: 1, deliveredAt: '2026-09-25T00:00:00.000Z', statusBasis: 'exclude_rejected_voided',
      ranges: [{ fromDate: '2026-08-01', toDate: '2026-08-31', branchId: 'uuid-A' }],
    } };
    req.valueCandidates = { amounts: [], dates: [], periods: [] };
    const resolvedErp = { invoke: async (tool: any, _ctx: unknown, input: Record<string, unknown> = {}) => {
      inputs.push({ tool: tool.name, ...input });
      const fromDate = String(input.fromDate);
      return { toolName: tool.name, status: 'ok', data: { total: 1, period: { fromDate, toDate: String(input.toDate), defaultedToCurrentMonth: false },
        summary: { totalAmount: 100, countedItems: 1, cancelledCount: 0 }, branchId: 'uuid-A' },
        sourceRefs: [{ label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary', permissionChecked: true, webPath: '/companies/company-1/expenses' }],
        asOf: new Date().toISOString() };
    } } as any;
    const result = await new OrchestratorAgent(resolvedErp, makeConfig()).run(req);
    assert.deepEqual(inputs, [{ tool: 'expense.list_recent', fromDate: '2026-08-01', toDate: '2026-08-31', branchId: 'สาธุประดิษฐ์' }]);
    assert.equal(result.deterministicExpenseSummary, true);
    assert.match(result.replyText, /สาธุประดิษฐ์/);
    assert.doesNotMatch(result.replyText, /uuid-A/);
    assert.equal(result.presentation?.cards[0]?.text, result.replyText);
  });

  it('explains duplicate branch names without exposing branch ids or reporting zero expenses', async () => {
    const inputs: Array<Record<string, unknown>> = [];
    configureLoopProvider(text => expensePlan(text), [{ callTool: 'expense.list_recent', input: { fromDate: '2026-08-01', toDate: '2026-08-31', branchId: 'สาธุประดิษฐ์' } }]);
    const req = makeReq('ค่าใช้จ่ายเดือนสิงหาคม 2569 สาขา สาธุประดิษฐ์');
    req.userContext.permissions.push('expense.read');
    req.valueCandidates = { amounts: [], dates: [], periods: [periods[1]!] };
    const erp = { invoke: async (tool: any, _ctx: unknown, input: Record<string, unknown> = {}) => {
      inputs.push({ tool: tool.name, ...input });
      return { toolName: tool.name, status: 'ok', data: { branchAmbiguous: 'uuid-secret', availableBranches: [
        { id: 'uuid-secret-1', name: 'สาธุประดิษฐ์', code: 'A' }, { id: 'uuid-secret-2', name: 'สาธุประดิษฐ์', code: 'B' },
      ] }, sourceRefs: [], asOf: new Date().toISOString() };
    } } as any;
    const result = await new OrchestratorAgent(erp, makeConfig()).run(req);
    assert.equal(inputs.length, 1);
    assert.match(result.replyText, /หลายสาขาที่ใช้ชื่อเดียวกัน/);
    assert.match(result.replyText, /เลือกสาขาจากหน้าเว็บ/);
    assert.doesNotMatch(result.replyText, /uuid-secret|รหัส|\bA\b|\bB\b|0\.00|0 รายการ/);
    assert.equal(result.deterministicExpenseSummary, undefined);
  });

  it('explains an unresolved branch without repeating its code or claiming there are no expenses', async () => {
    configureLoopProvider(text => expensePlan(text), [{ callTool: 'expense.list_recent', input: { fromDate: '2026-08-01', toDate: '2026-08-31', branchId: 'secret-code' } }]);
    const req = makeReq('ค่าใช้จ่ายเดือนสิงหาคม 2569 สาขา secret-code');
    req.userContext.permissions.push('expense.read');
    req.valueCandidates = { amounts: [], dates: [], periods: [periods[1]!] };
    const erp = { invoke: async (tool: any) => ({ toolName: tool.name, status: 'ok', data: {
      branchUnresolved: 'secret-code', availableBranches: [{ id: 'uuid-secret', name: 'สาขากลาง' }],
    }, sourceRefs: [], asOf: new Date().toISOString() }) } as any;
    const result = await new OrchestratorAgent(erp, makeConfig()).run(req);
    assert.match(result.replyText, /ยังระบุสาขาที่ต้องการไม่ได้/);
    assert.match(result.replyText, /เลือกสาขาจากหน้าเว็บ/);
    assert.doesNotMatch(result.replyText, /secret-code|uuid-secret|0\.00|0 รายการ/);
  });

  it('does not present an August-only result as complete when a misspelled July was also requested', async () => {
    const inputs: Array<Record<string, unknown>> = [];
    const august = periods[1]!;
    configureLoopProvider(text => expensePlan(text), [{ callTool: 'expense.list_recent', input: { fromDate: august.fromDate, toDate: august.toDate } }]);
    const req = makeReq('ค่าใช้จ่ายเดือนกรกฏาคมและสิงหาคม 2569');
    req.userContext.permissions.push('expense.read');
    req.valueCandidates = { amounts: [], dates: [], periods: [august] };
    const result = await new OrchestratorAgent(expenseErp(inputs), makeConfig()).run(req);
    assert.deepEqual(inputs, []);
    assert.equal(result.deterministicExpenseSummary, undefined);
    assert.doesNotMatch(result.replyText, /700\.00|800\.00/);
    assert.match(result.replyText, /ขอทราบเดือนและปี/);
  });

  it('does not report a complete total when the second period read fails', async () => {
    const inputs: Array<Record<string, unknown>> = [];
    const message = 'ค่าใช้จ่ายเดือนกรกฎาคมและสิงหาคม 2569';
    configureLoopProvider(text => expensePlan(text), periods.map(period => ({ callTool: 'expense.list_recent', input: { fromDate: period.fromDate, toDate: period.toDate } })));
    const req = makeReq(message);
    req.userContext.permissions.push('expense.read');
    req.valueCandidates = { amounts: [], dates: [], periods };
    const result = await new OrchestratorAgent(expenseErp(inputs, '2026-08-01'), makeConfig()).run(req);
    assert.equal(inputs.length, 2);
    assert.equal(result.deterministicExpenseSummary, undefined);
    assert.match(result.replyText, /กรกฎาคม 2569: 700\.00 บาท/);
    assert.match(result.replyText, /สิงหาคม 2569: ยังดึงข้อมูลได้ไม่ครบ/);
    assert.doesNotMatch(result.replyText, /800\.00/);
  });

  it('does not reveal a partial amount when the second read is forbidden', async () => {
    const inputs: Array<Record<string, unknown>> = [];
    configureLoopProvider(text => expensePlan(text), periods.map(period => ({ callTool: 'expense.list_recent', input: {
      fromDate: period.fromDate, toDate: period.toDate,
    } })));
    const req = makeReq('ค่าใช้จ่ายเดือนกรกฎาคมและสิงหาคม 2569');
    req.userContext.permissions.push('expense.read');
    req.valueCandidates = { amounts: [], dates: [], periods };
    const result = await new OrchestratorAgent(expenseErp(inputs, '2026-08-01', 'forbidden'), makeConfig()).run(req);
    assert.equal(inputs.length, 2);
    assert.doesNotMatch(result.replyText, /700\.00|800\.00/);
  });

  it('does not repeat or quote a second month read with inconsistent data', async () => {
    for (const corrupt of [
      (data: any) => ({ ...data, summary: { ...data.summary, countedItems: 1 } }),
      (data: any) => ({ ...data, period: { ...data.period, fromDate: '2026-09-01' } }),
    ]) {
      const inputs: Array<Record<string, unknown>> = [];
      configureLoopProvider(text => expensePlan(text), periods.map(period => ({ callTool: 'expense.list_recent', input: {
        fromDate: period.fromDate, toDate: period.toDate,
      } })));
      const req = makeReq('ค่าใช้จ่ายเดือนกรกฎาคมและสิงหาคม 2569');
      req.userContext.permissions.push('expense.read');
      req.valueCandidates = { amounts: [], dates: [], periods };
      const base = expenseErp(inputs);
      const erp = { invoke: async (tool: any, ctx: unknown, input: Record<string, unknown> = {}) => {
        const result = await base.invoke(tool, ctx, input);
        return input.fromDate === '2026-08-01' ? { ...result, data: corrupt(result.data) } : result;
      } } as any;
      const result = await new OrchestratorAgent(erp, makeConfig()).run(req);
      assert.equal(inputs.length, 2);
      assert.equal(result.deterministicExpenseSummary, undefined);
      assert.match(result.replyText, /กรกฎาคม 2569: 700\.00 บาท/);
      assert.match(result.replyText, /สิงหาคม 2569: ยังดึงข้อมูลได้ไม่ครบ/);
      assert.doesNotMatch(result.replyText, /800\.00/);
    }
  });

  const mixedPlan = (text: string) => ({ status: 'ROUTABLE', language: 'th', intents: [
    { intent: 'read_summary', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.list_recent'], missingContext: [] },
    { intent: 'report_request', subject: 'sale', agent: 'sales', priority: 2, requiredTools: ['sales.get_sales_summary'], missingContext: [] },
  ], refusals: [], requiresHumanReview: false });
  const mixedErp = (calls: string[]) => ({ invoke: async (tool: any, _ctx: unknown, input: Record<string, unknown> = {}) => {
    calls.push(tool.name);
    return { toolName: tool.name, status: 'ok', data: { totalSales: '500.00', transactionCount: 1, period: 'วันนี้' },
      sourceRefs: [{ label: 'ยอดขาย', module: 'sales', entityType: 'summary', permissionChecked: true, webPath: '/sales' }], asOf: new Date().toISOString() };
  } } as any);

  it('keeps the independent sales answer when the expense criterion is a mixed-intent question', async () => {
    const calls: string[] = [];
    configureLoopProvider(mixedPlan, [{ callTool: 'sales.get_sales_summary', input: {} }]);
    const req = makeReq('ยอดขายและค่าใช้จ่ายไม่รวมยกเลิกใช่ไหม');
    req.userContext.permissions.push('crm.report.read', 'expense.read');
    const result = await new OrchestratorAgent(mixedErp(calls), makeConfig()).run(req);
    assert.deepEqual(calls, ['sales.get_sales_summary']);
    assert.match(result.replyText, /500\.00/);
    assert.match(result.replyText, /ไม่นับรายการที่ถูกปฏิเสธหรือยกเลิก/);
    assert.equal(result.deterministicExpenseCriterionConfirmation, undefined);
    assert.doesNotMatch(result.replyText, /ยอดค่าใช้จ่าย[:：]?\s*[\d,]+/);
  });

  it('keeps sales when an unsupported expense filter is requested and never reads an unfiltered expense total', async () => {
    const calls: string[] = [];
    configureLoopProvider(mixedPlan, [{ callTool: 'sales.get_sales_summary', input: {} }]);
    const req = makeReq('ยอดขายวันนี้และค่าใช้จ่ายรวมรายการยกเลิกด้วย');
    req.userContext.permissions.push('crm.report.read', 'expense.read');
    const result = await new OrchestratorAgent(mixedErp(calls), makeConfig()).run(req);
    assert.deepEqual(calls, ['sales.get_sales_summary']);
    assert.match(result.replyText, /500\.00/);
    assert.match(result.replyText, /ยังยืนยันยอดค่าใช้จ่ายตามเงื่อนไขนี้ไม่ได้/);
    assert.equal(result.deterministicExpenseCriterionConfirmation, undefined);
    assert.doesNotMatch(result.replyText, /(?:ค่าใช้จ่าย|Expenses)[:：]?\s*[\d,]+/);
  });

  it('recovers the sales route when the mixed router initially proposes only the expense tool', async () => {
    const calls: string[] = [];
    configureLoopProvider(text => text.includes('ค่าใช้จ่าย')
      ? { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_summary', subject: 'expense', agent: 'accounting', priority: 1,
        requiredTools: ['expense.list_recent'], missingContext: [] }], refusals: [], requiresHumanReview: false }
      : { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'report_request', subject: 'sale', agent: 'sales', priority: 1,
        requiredTools: ['sales.get_sales_summary'], missingContext: [] }], refusals: [], requiresHumanReview: false },
    [{ callTool: 'sales.get_sales_summary', input: {} }]);
    const req = makeReq('ยอดขายและค่าใช้จ่ายไม่รวมยกเลิกใช่ไหม');
    req.userContext.permissions.push('crm.report.read', 'expense.read');
    const result = await new OrchestratorAgent(mixedErp(calls), makeConfig()).run(req);
    assert.deepEqual(calls, ['sales.get_sales_summary']);
    assert.match(result.replyText, /500\.00/);
    assert.match(result.replyText, /ไม่นับรายการที่ถูกปฏิเสธหรือยกเลิก/);
    assert.equal(result.deterministicExpenseCriterionConfirmation, undefined);
  });

  it('does not confirm an expense criterion when expense permission is missing from a mixed turn', async () => {
    const calls: string[] = [];
    configureLoopProvider(mixedPlan, [{ callTool: 'sales.get_sales_summary', input: {} }]);
    const req = makeReq('ยอดขายและค่าใช้จ่ายไม่รวมยกเลิกใช่ไหม');
    req.userContext.permissions.push('crm.report.read');
    const result = await new OrchestratorAgent(mixedErp(calls), makeConfig()).run(req);
    assert.deepEqual(calls, ['sales.get_sales_summary']);
    assert.match(result.replyText, /ไม่มีสิทธิ์ดูยอดค่าใช้จ่าย/);
    assert.doesNotMatch(result.replyText, /ไม่รวมรายการที่ถูกปฏิเสธหรือยกเลิก/);
    assert.equal(result.deterministicExpenseCriterionConfirmation, undefined);
  });

  it('does not append expense filter copy to a sales-only status question', async () => {
    const calls: string[] = [];
    configureLoopProvider(text => ({ status: 'ROUTABLE', language: 'th', intents: [{ intent: 'report_request', subject: 'sale', agent: 'sales', priority: 1,
      requiredTools: ['sales.get_sales_summary'], missingContext: [] }], refusals: [], requiresHumanReview: false }),
    [{ callTool: 'sales.get_sales_summary', input: {} }]);
    const req = makeReq('ยอดขายเฉพาะยืนยันแล้ว');
    req.userContext.permissions.push('crm.report.read');
    req.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [], deliveredExpenseSummary: {
      version: 1, deliveredAt: '2026-09-25T00:00:00.000Z', statusBasis: 'exclude_rejected_voided',
      ranges: [{ fromDate: '2026-08-01', toDate: '2026-08-31', branchId: null }],
    } };
    const result = await new OrchestratorAgent(mixedErp(calls), makeConfig()).run(req);
    assert.deepEqual(calls, ['sales.get_sales_summary']);
    assert.doesNotMatch(result.replyText, /ค่าใช้จ่ายตามเงื่อนไข|ยังยืนยันยอดค่าใช้จ่าย/);
  });

  it('does not classify sales-only exclusion questions as expense confirmations', () => {
    assert.equal(expenseCriterionOnlyMessage('ยอดขายไม่รวมยกเลิกใช่ไหม'), false);
    assert.equal(unsupportedExpenseFilter('ยอดขายไม่รวมยกเลิกใช่ไหม'), false);
    assert.equal(unsupportedExpenseFilter('ยอดขายเฉพาะยืนยันแล้ว'), false);
    assert.equal(unsupportedExpenseFilter('ยอดขายเฉพาะยืนยันแล้ว', true), false);
    assert.equal(uncertainExpenseFilter('ยอดขายไม่รวมปฎิเสด', true), false);
  });

  it('reaches normal routing for status, category, and actual-paid filters; only "include rejected/voided in the total" stays unsupported', () => {
    for (const text of ['ค่าใช้จ่ายรวมรายการยกเลิก', 'ค่าใช้จ่ายรวมถูกปฏิเสธด้วย']) assert.equal(unsupportedExpenseFilter(text), true, text);
    // documentStatus/paymentStatus filters, category filters, and "จ่ายจริง" are tool-supported now
    // (expense.list_recent/expense.get_breakdown) and must reach normal routing, not the canned reply.
    for (const text of ['ค่าใช้จ่ายเฉพาะยืนยันแล้ว', 'ค่าใช้จ่ายเฉพาะจ่ายแล้ว',
      'ค่าใช้จ่ายเฉพาะหมวดเดินทาง', 'ค่าใช้จ่ายจ่ายจริงเท่าไร', 'ค่าใช้จ่ายจ่ายแล้วกี่ใบ']) assert.equal(unsupportedExpenseFilter(text), false, text);
    assert.equal(uncertainExpenseFilter('ค่าใช้จ่ายไม่รวมปฎิเสธ'), true);
    assert.equal(uncertainExpenseFilter('ค่าใช้จ่ายเฉพาะสิงหาคม'), false);
    assert.equal(uncertainExpenseFilter('ค่าใช้จ่ายไม่รวมค่าขนส่ง'), true);
    assert.equal(uncertainExpenseFilter('ค่าใช้จ่ายเฉพาะสิงหาค์'), true);
    assert.equal(expenseCriterionOnlyMessage('ยอดค่าใช้จ่ายไม่รวมรายการยกเลิกใช่ไหม'), true);
    assert.equal(expenseCriterionOnlyMessage('อันนี้ไม่รวมรายการยกเลิกใช่ไหม', true), true);
  });

  it('asks for clarification on a misspelled expense status instead of running a broad summary', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const req = makeReq('ค่าใช้จ่ายไม่รวมรายการปฎิเสด');
    req.userContext.permissions.push('expense.read');
    const erp = expenseErp(calls);
    const result = await new OrchestratorAgent(erp, makeConfig()).run(req);
    assert.deepEqual(calls, []);
    assert.match(result.replyText, /ยังระบุเงื่อนไขรายการค่าใช้จ่าย/);
    assert.doesNotMatch(result.replyText, /\d[\d,]*\.\d{2}|ไม่พบรายการ/);
  });
});

describe('approved knowledge orchestration', () => {
  async function withReviewedPack(run: () => Promise<void>) {
    const { PRODUCT_HELP_PACK } = await import('./approved-product-help');
    const { knowledgePackHash } = await import('./approved-knowledge');
    const original = structuredClone(PRODUCT_HELP_PACK);
    Object.assign(PRODUCT_HELP_PACK, {
      status: 'APPROVED', reviewers: ['synthetic-test-reviewer'],
      effectiveFrom: '2020-01-01T00:00:00Z', effectiveTo: '2100-01-01T00:00:00Z', reviewDueAt: '2100-01-01T00:00:00Z',
    });
    PRODUCT_HELP_PACK.contentHash = knowledgePackHash(PRODUCT_HELP_PACK);
    try { await run(); } finally { Object.assign(PRODUCT_HELP_PACK, original); }
  }
  function knowledgeRequest() {
    const req = makeReq('เอกสารยืนยันแล้วแปลว่าจ่ายแล้วไหม');
    req.userContext.permissions.push('expense.read');
    req.entitledFeatureKeys = ['expenses'];
    return Object.assign(req, { approvedKnowledge: true, selectedKnowledgeCardIds: ['expense.status'] });
  }
  function helpProvider(mixed = false) {
    let calls = 0;
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init?.body ?? '{}'));
      const message = body.input?.find((entry: any) => entry.role === 'user')?.content?.find((part: any) => part.type === 'input_text')?.text ?? '';
      let payload: any = {};
      try { payload = JSON.parse(message.slice(message.lastIndexOf('\n') + 1)); } catch { /* catalog prefix */ }
      const text = typeof payload.reply === 'string' ? payload.reply : payload.systemData ? '{}' : JSON.stringify({
        status: 'ROUTABLE', language: 'th', refusals: [], requiresHumanReview: false,
        selectedKnowledgeCardIds: ['expense.status'],
        intents: [mixed
          ? { intent: 'read_summary', subject: 'inventory', agent: 'inventory', priority: 1, requiredTools: ['inventory.list_low_stock'], missingContext: [] }
          : { intent: 'capability_help', subject: 'unknown', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }],
      });
      return await jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: text }) });
    };
    return () => calls;
  }
  it('renders only the exact reviewed body and real guide citation without a composition call', async () => withReviewedPack(async () => {
    const calls = helpProvider();
    const result = await new OrchestratorAgent(makeOkErpTools(), makeConfig({ lineAiApprovedKnowledgeEnabled: true })).run(knowledgeRequest());
    const { PRODUCT_HELP_PACK } = await import('./approved-product-help');
    const card = PRODUCT_HELP_PACK.cards.find((entry) => entry.id === 'expense.status')!;
    assert.equal(calls(), 1);
    assert.equal(result.replyText, `${card.title}\n${card.body}`);
    assert.equal(result.sourceRefs[0]?.entityType, 'approved_product_help');
    assert.equal(result.webLinks[0]?.path, '/companies/company-1/user-guide/expenses#overview');
    assert.deepEqual(result.outputs.flatMap((entry) => entry.toolCalls), []);
  }));
  it('requires both the trusted API admission bit and Gateway flag, and rechecks current rights', async () => withReviewedPack(async () => {
    for (const variant of ['api-off', 'gateway-off', 'permission-revoked', 'feature-off']) {
      helpProvider(); const req = knowledgeRequest();
      if (variant === 'api-off') req.approvedKnowledge = false;
      if (variant === 'permission-revoked') req.userContext.permissions = [];
      if (variant === 'feature-off') req.entitledFeatureKeys = [];
      const result = await new OrchestratorAgent(makeOkErpTools(), makeConfig({ lineAiApprovedKnowledgeEnabled: variant !== 'gateway-off' })).run(req);
      assert.ok(result.sourceRefs.every((source) => source.entityType !== 'approved_product_help'), variant);
    }
  }));
  it('retains the business read and appends the reviewed guide in a mixed question', async () => withReviewedPack(async () => {
    helpProvider(true); const invoked: string[] = [];
    const erp = { invoke: async (tool: any) => {
      invoked.push(tool.name);
      return { toolName: tool.name, status: 'ok', data: { count: 3 }, sourceRefs: [{ label: 'stock', module: 'inventory', entityType: 'summary', permissionChecked: true }], asOf: new Date().toISOString() };
    } } as any;
    const req = knowledgeRequest(); req.entitledFeatureKeys = ['expenses', 'inventory'];
    req.messageText += ' และมีของอะไรใกล้หมดบ้าง';
    const result = await new OrchestratorAgent(erp, makeConfig({ lineAiApprovedKnowledgeEnabled: true })).run(req);
    assert.ok(invoked.includes('inventory.list_low_stock'));
    assert.match(result.replyText, /สถานะเอกสารกับสถานะจ่ายเงิน/);
    assert.ok(result.sourceRefs.some((source) => source.module === 'inventory'));
    assert.ok(result.sourceRefs.some((source) => source.entityType === 'approved_product_help'));
    assert.equal(result.presentation?.kind, 'answer_cards');
    if (result.presentation?.kind === 'answer_cards') assert.ok(result.presentation.cards.length >= 2);
  }));
});
