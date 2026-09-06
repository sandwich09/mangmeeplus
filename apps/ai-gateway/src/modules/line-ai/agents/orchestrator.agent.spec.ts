import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswerPresentation, OrchestratorAgent, withoutRefusedCoverage } from './orchestrator.agent';
import { ResponseComposerAgent } from './response-composer.agent';
import { parseLineAiPreparedPlan } from '@watchdog-bms/contracts';
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
      return { ok: true, json: async () => ({ output_text: payload.reply }) } as Response;
    }
    if (typeof payload.messageText === 'string' && typeof payload.language === 'string') {
      return { ok: true, json: async () => ({ output_text: 'วันนี้เหนื่อยมานิดหน่อยสินะคะ น้องมั่งมีอยู่เป็นเพื่อนค่ะ 😊' }) } as Response;
    }
    return {
      ok: true,
      json: async () => ({ output_text: JSON.stringify(planFor(payload.messageText ?? '')) }),
    } as Response;
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

  it('keeps broad expense amounts concise while preserving source-backed details and counts on request', async () => {
    const calledTools: string[] = [];
    const erpTools = {
      invoke: async (tool: any) => {
        calledTools.push(tool.name);
        return {
          toolName: tool.name,
          status: tool.name === 'expense.list_recent' ? 'ok' : 'unsupported_module',
          data: tool.name === 'expense.list_recent' ? {
            total: 7,
            summary: {
              totalAmount: 11875,
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
          asOf: new Date().toISOString(),
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
    assert.equal(result.replyText, '• ยอดรวม: 11,875.00 บาท');
    assert.doesNotMatch(result.replyText, /รอตรวจสอบ|ยืนยันแล้ว|จ่ายแล้ว|ยังไม่จ่าย|บริษัท โฟลว์แอคเคาท์/);
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
      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            status: 'ROUTABLE',
            language: 'th',
            intents: [{ intent: 'read_detail', agent: 'inventory', priority: 1, requiredTools: ['ledger.get_financial_summary'], missingContext: [] }],
            refusals: [],
            requiresHumanReview: false,
          }),
        }),
      } as Response;
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
    (orchestrator as any).logger = { log: (e: any) => logs.push(e), error: () => {}, warn: () => {} };
    await orchestrator.run({ ...makeReq('ดูสต็อกสินค้าใกล้หมด'), intakeIntent: 'BUSINESS_READ_QUESTION', preparedPlan: preparedInventoryPlan() });
    assert.ok(!logs.some((e) => typeof e.msg === 'string' && e.msg.startsWith('line.ai.prepared_simple_read')), 'prepared lane untouched when flag off');
    assert.ok(!logs.some((e) => e.msg === 'line.ai.fused_plan.shadow'), 'no shadow when flag off');
  });

  it('Phase 4 on with empty family allowlist: eligibility fails on the formatter family and falls back to the router', async () => {
    const logs: any[] = [];
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), makeConfig({ lineAiPreparedSimpleReadEnabled: true, lineAiDeterministicResponseFamilies: [] }));
    (orchestrator as any).logger = { log: (e: any) => logs.push(e), error: () => {}, warn: () => {} };
    const result = await orchestrator.run({ ...makeReq('ดูสต็อกสินค้าใกล้หมด'), intakeIntent: 'BUSINESS_READ_QUESTION', preparedPlan: preparedInventoryPlan() });
    const fallback = logs.find((e) => e.msg === 'line.ai.prepared_simple_read.fallback');
    assert.ok(fallback, 'the gate ran and logged a fallback');
    assert.equal(fallback.reason, 'formatter_family_not_allowed');
    assert.ok(result.plan, 'the router path still produced a plan');
  });

  it('Phase 3 shadow on: logs a best-effort comparison and still executes via the router', async () => {
    const logs: any[] = [];
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), makeConfig({ lineAiFusedPlanShadowEnabled: true }));
    (orchestrator as any).logger = { log: (e: any) => logs.push(e), error: () => {}, warn: () => {} };
    await orchestrator.run({ ...makeReq('ดูสต็อกสินค้าใกล้หมด'), intakeIntent: 'BUSINESS_READ_QUESTION', preparedPlan: preparedInventoryPlan() });
    assert.ok(logs.some((e) => e.msg === 'line.ai.fused_plan.shadow'), 'shadow comparison logged');
  });
});
