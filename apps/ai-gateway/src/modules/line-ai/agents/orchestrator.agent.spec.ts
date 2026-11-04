import { BILLING_PAID_TIERS as testPaidTiers, billingOffer as testBillingOffer } from '@watchdog-bms/contracts';
import '../domain/logic/line-ai-scope-policy.logic.spec';
import type { ProviderInput } from '../infrastructure/provider/provider.port';
import { scopePolicyOverride, featureLimitReplyText, permissionAlternative } from '../domain/logic/line-ai-scope-policy.logic';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { branchInputMatchesMessage, buildAnswerPresentation, expenseBranchScopeRequested, expenseCriterionOnlyMessage, ORCHESTRATOR_TOOL_LOOP_PROMPT, OrchestratorAgent, uncertainExpenseFilter, unsupportedExpenseFilter, validExpensePeriodSelection, withoutRefusedCoverage } from './orchestrator.agent';
import { ResponseComposerAgent, claimsCompletedWrite } from './response-composer.agent';
import { extractValueCandidates, parseLineAiAnswerCardLayout, parseLineAiPreparedPlan } from '@watchdog-bms/contracts';
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
    packageOffers: testPaidTiers.map(tier => testBillingOffer(tier, 'month')),
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

  // Design lock context 2: the open-work card is built from the ONE successful read, never from the sentence.
  it('carries the open-work layout of a single successful read of notices or assigned tasks', () => {
    const claim = { count: 1, hasMore: false, opens: 'claim', items: [{ id: 'n1', title: 'อนุมัติเบิกจ่าย: RB-202608-00002', kind: 'claim_approval', documentNo: 'RB-202608-00002' }] };
    const output = { ...presentationOutput('SUCCEEDED', 'อนุมัติเบิกจ่าย: RB-202608-00002', '1', claim, 'notifications.list_open_alerts'), asOf: '2026-09-17T10:00:00Z' };
    const card = buildAnswerPresentation(PRESENTATION_PLAN, [output], 'มีใบเบิกรออนุมัติ 1 รายการค่ะ')?.cards[0];
    assert.equal(card?.text, 'มีใบเบิกรออนุมัติ 1 รายการค่ะ');
    assert.deepEqual(card?.layout, {
      context: 'open_work', header: ['ใบเบิกรออนุมัติ', 'พบ 1 รายการ'],
      rows: [{ label: 'เลขที่ใบเบิก', value: 'RB-202608-00002' }, { label: 'ต้องทำ', value: 'ตรวจสอบและอนุมัติใบเบิก' }, { label: 'ข้อมูล ณ', value: '17 กันยายน 2569' }],
      notes: ['ตรวจเฉพาะแจ้งเตือนที่ยังไม่ปิด ตามสิทธิ์ของคุณ'], linkLabel: 'เปิดใบเบิกเพื่ออนุมัติ',
    });
    const tasks = { ...presentationOutput('SUCCEEDED', 'งานที่ได้รับมอบหมาย', '0', { total: 0, items: [] }, 'workflow.list_assigned_tasks'), asOf: '2026-09-17T10:00:00Z' };
    assert.deepEqual(buildAnswerPresentation(PRESENTATION_PLAN, [tasks], 'ไม่มีงานค้างค่ะ')?.cards[0]?.layout?.header, ['งานที่มอบหมาย', 'ไม่พบงานค้าง']);
  });

  it('has no layout when the answer is more than that one read, or the read did not succeed', () => {
    const data = { count: 0, hasMore: false, opens: 'list', items: [] };
    const read = () => ({ ...presentationOutput('SUCCEEDED', 'รายการแจ้งเตือน', '0', data, 'notifications.list_open_alerts'), asOf: '2026-09-17T10:00:00Z' });
    // Two reads: each is a sentence card, and neither claims to be the whole answer.
    const two = buildAnswerPresentation(PRESENTATION_PLAN, [read(), presentationOutput('SUCCEEDED')], 'รวม');
    assert.deepEqual(two?.cards.map((card) => card.layout), [undefined, undefined]);
    // One output that also carries a refused call: the card would hide the refusal.
    const mixed = read();
    mixed.toolCalls.push({ name: 'workflow.list_assigned_tasks', status: 'forbidden' as any, durationMs: 1 });
    assert.equal(buildAnswerPresentation(PRESENTATION_PLAN, [mixed], 'ไม่พบแจ้งเตือน')?.cards[0]?.layout, undefined);
    // One output with two results.
    const double = read();
    double.toolData!.push({ tool: 'workflow.list_assigned_tasks', data: { total: 0, items: [] } });
    assert.equal(buildAnswerPresentation(PRESENTATION_PLAN, [double], 'ไม่พบ')?.cards[0]?.layout, undefined);
    // A refused or failed read has no card at all — it can never be drawn as "nothing found".
    assert.equal(buildAnswerPresentation(PRESENTATION_PLAN, [presentationOutput('PERMISSION_DENIED', 'รายการแจ้งเตือน', '0', data, 'notifications.list_open_alerts')], 'ไม่มีสิทธิ์'), undefined);
    assert.equal(buildAnswerPresentation(PRESENTATION_PLAN, [presentationOutput('FAILED', 'รายการแจ้งเตือน', '0', data, 'notifications.list_open_alerts')], 'ดึงข้อมูลไม่ได้'), undefined);
    // A malformed result: the sentence card, no rows.
    const broken = { ...presentationOutput('SUCCEEDED', 'รายการแจ้งเตือน', '0', { items: [] }, 'notifications.list_open_alerts') };
    assert.equal(buildAnswerPresentation(PRESENTATION_PLAN, [broken], 'ไม่พบ')?.cards[0]?.layout, undefined);
  });

  // Design lock context 4: the edit-command header rides only the deterministic sentence of that same result.
  it('heads a draft-edit answer with the state its result reports, and only when the reply is that result\'s own sentence', () => {
    const blocked = { found: true, blocked: 'ambiguous_line' };
    const output = presentationOutput('SUCCEEDED', 'ร่างค่าใช้จ่าย', '-', blocked, 'expense.draft.set_line');
    const sentence = 'บิลนี้มีหลายบรรทัดค่ะ ขอทราบว่าต้องการแก้บรรทัดไหนนะคะ (เช่น "บรรทัด 2 เป็น 500")';
    assert.deepEqual(buildAnswerPresentation(PRESENTATION_PLAN, [output], sentence)?.cards[0]?.layout,
      { context: 'edit_command', header: ['แก้ไขค่าใช้จ่าย', 'ขอข้อมูลเพิ่ม'], rows: [] });
    assert.equal(buildAnswerPresentation(PRESENTATION_PLAN, [output], 'แก้ให้แล้วค่ะ')?.cards[0]?.layout, undefined);
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
  // Advisor S1 (spec §2.6): "sign it on the web" names the reason and links the page to sign on.
  it('refuses to sign a substitute receipt over LINE and links the substitute-receipt page', async () => {
    let called = false;
    const orchestrator = new OrchestratorAgent({ invoke: async () => { called = true; throw new Error('must not invoke'); } } as any, makeConfig());
    const req = makeReq('ช่วยเซ็นใบรับรองให้หน่อย');
    const result = await orchestrator.run({ ...req, userContext: { ...req.userContext, permissions: ['expense.read_own'] },
      semanticSubrequests: [{ index: 0, kind: 'write', goal: 'เซ็นใบรับรอง', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }] });
    assert.equal(called, false);
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'LINE_ACTION_NOT_SUPPORTED');
    assert.match(result.replyText, /ลงลายมือชื่อใบรับรองแทนใบเสร็จทำผ่าน LINE ไม่ได้/u);
    assert.deepEqual(result.webLinks, [{ label: 'ใบรับรองแทนใบเสร็จ', path: '/companies/company-1/expenses/substitute-receipts' }]);
  });

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
    assert.match(result.replyText, /เตรียมการ์ดให้กดยืนยันเองค่ะ/);
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
    assert.match(result.replyText, /เตรียมการ์ดให้กดยืนยันเองค่ะ$/u, 'the same closing sentence as the card');
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
  it('bounds the grounding text it forwards, and forwards it whatever a stale draft-lane switch says', async () => {
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

    // Owner 2026-09-29: draft edit is always on, so a stale `false` no longer strips the grounding text.
    seen.length = 0;
    const staleSwitch = new OrchestratorAgent(erpTools, makeConfig({ lineAiDraftEditEnabled: false }));
    await staleSwitch.run(makeReq(long));
    assert.ok(seen.length > 0);
    assert.equal((seen[0]!['groundingText'] as string).length, 1000);
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

  it('shows a complete broad expense summary while preserving source-backed details and counts on request', async (t) => {
    // Mid-month "now": on the 1st the current-month range is a single day and prints as one date.
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-15T05:00:00.000Z') });
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
    // Design lock context 1: the sentence's own figures as the summary card's rows, on this lane …
    const summaryLayout = result.presentation?.cards[0]?.layout;
    assert.equal(summaryLayout?.context, 'expense_summary');
    assert.equal(summaryLayout?.header[0], 'สรุปค่าใช้จ่าย');
    assert.deepEqual(summaryLayout?.rows.slice(0, 2), [{ label: 'ยอดรวม', value: '11,875.00 บาท', emphasis: 'total' }, { label: 'จำนวนรายการ', value: '7 รายการ' }]);
    assert.equal(summaryLayout?.linkLabel, 'ดูค่าใช้จ่ายในเว็บ');
    assert.deepEqual(parseLineAiAnswerCardLayout(JSON.parse(JSON.stringify(summaryLayout))), summaryLayout);
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
    // … and on the prepared lane: the same layout, not merely the same sentence.
    assert.equal(prepared.presentation?.cards[0]?.layout?.context, 'expense_summary');
    assert.deepEqual(prepared.sourceRefs, full.sourceRefs);
    assert.deepEqual(prepared.webLinks, full.webLinks);
    assert.ok(prepared.replyText.includes(`\nช่วง: 1 ${thaiMonth} ${thaiYear} – ${todayDay} ${thaiMonth} ${thaiYear}`));
    assert.ok(prepared.replyText.includes(`\nข้อมูล ณ ${todayDay} ${thaiMonth} ${thaiYear}`));
  });

  it('item 1 (spec §3 row 7): a list-shape prepared read serves the compiled numbered-list formatter, not the single-metric summary', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const currentMonthStart = `${today.slice(0, 7)}-01`;
    const erpTools = {
      invoke: async (tool: any) => ({
        toolName: tool.name,
        status: 'ok',
        data: {
          total: 2,
          period: { fromDate: currentMonthStart, toDate: today, defaultedToCurrentMonth: true },
          // Same summary shape the single-metric family reads (incl. the basis-line amounts), so a
          // real bug that reruns the single-metric formatter on a list-shape read would still show up.
          summary: { totalAmount: 1200, countedItems: 2, cancelledCount: 0, pendingAmount: 0, draftAmount: 0, confirmedAmount: 1200 },
          items: [
            { id: 'e1', expenseDate: '2026-08-05T10:00:00.000Z', vendorNameSnapshot: 'ร้านสมใจ', status: 'CONFIRMED', grandTotalAmount: '500.00' },
            { id: 'e2', expenseDate: '2026-08-02T10:00:00.000Z', vendorNameSnapshot: 'ร้านใจดี', status: 'READY_FOR_CONFIRMATION', grandTotalAmount: '700.00' },
          ],
        },
        sourceRefs: [{ label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary', permissionChecked: true, webPath: '/companies/company-1/expenses' }],
        asOf: new Date().toISOString(),
      }),
    } as any;
    const req = makeReq('ขอดูรายการล่าสุดหน่อยครับ');
    req.userContext.permissions.push('expense.read');
    const preparedPlan = parseLineAiPreparedPlan({
      version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'simple_grounded', answerShape: 'list',
      intentPlan: {
        status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [],
        intents: [{ intent: 'read_detail', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.list_recent'], missingContext: [] }],
      },
      proposedCalls: [{ toolName: 'expense.list_recent', input: {} }],
    });
    assert.ok(preparedPlan);
    const result = await new OrchestratorAgent(erpTools, makeConfig({
      lineAiPreparedSimpleReadEnabled: true,
      lineAiDeterministicResponseFamilies: ['expense.list_recent::list'],
    })).run({ ...req, preparedPlan, intakeIntent: 'BUSINESS_READ_QUESTION', actorDelegations: { 'expense.list_recent': ['test-delegation'] } });
    // The compiled expense.list_recent::list formatter's numbered rows must be served...
    // C6 (batch 5c): a short list-item date, year-free within the tool's own as-of year.
    assert.match(result.replyText, /\n1\. 5 ส\.ค\. ร้านสมใจ 500\.00 บาท \(ยืนยันแล้ว\)/);
    assert.match(result.replyText, /\n2\. 2 ส\.ค\. ร้านใจดี 700\.00 บาท \(พร้อมยืนยัน\)/);
    // ...never the single-metric "basis" line (R-A3 lists never carry it; R-A1 basis is single-metric only).
    assert.ok(!result.replyText.includes('ฐานยอด'), 'must not fall back to the single-metric summary reply');
    assert.equal(result.presentation?.cards[0]?.text, result.replyText);
    // deliveredExpenseSummary (R-M2) is a single-metric-only memory proof; a list reply must never set it.
    assert.equal(result.deterministicExpenseSummary, undefined);
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
  // Owner 2026-09-29: the prepared lane is always on — no config value keeps a forwarded plan out of its gate.
  it('Phase 4 always on: a forwarded prepared plan always reaches the lane gate, with no switch to turn it off', async () => {
    const logs: any[] = [];
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), makeConfig({ lineAiPreparedSimpleReadEnabled: false }));
    (orchestrator as any).logger = { log: (e: any) => logs.push(e), error: () => {}, warn: (e: any) => logs.push(e) };
    await orchestrator.run({ ...makeReq('ดูสต็อกสินค้าใกล้หมด'), intakeIntent: 'BUSINESS_READ_QUESTION', preparedPlan: preparedInventoryPlan() });
    const fallback = logs.find((e) => e.msg === 'line.ai.prepared_simple_read.fallback');
    assert.equal(fallback?.reason, 'formatter_family_not_allowed', 'the gate ran; inventory is compiled but not an approved family');
    assert.ok(!logs.some((e) => e.msg === 'line.ai.fused_plan.shadow'), 'no shadow when the shadow telemetry is off');
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

  // Owner 2026-09-29: there is no "lane off" any more (always on); a non-business turn still logs nothing.
  it('says nothing about the lane for a turn that is not a business read', async () => {
    const other = new OrchestratorAgent(makeOkErpTools(), laneConfig(['inventory.list_low_stock::list']));
    const otherLogs = sink(other);
    await other.run({ ...makeReq('สวัสดีค่ะ'), intakeIntent: 'ADVISOR_CONVERSATION' } as LineAiTurnRequest);
    assert.deepEqual(laneLogs(otherLogs), []);
  });

  // C4 (batch 5c, T-008-b "แล้วร้านกาแฟอเมซอนล่ะคะ"): expense.list_recent's own vendorUnresolved
  // result matches no compiled formatter, so the lane owns the turn as an honest terminal — which
  // used to mean the generic "ยังดึงข้อมูลส่วนนี้ไม่ได้" line instead of the tool's own catalog answer.
  it('renders the name-resolution reply (not the generic read-failure line) and drops the generic web link', async () => {
    const erp = {
      invoke: async (tool: any) => ({
        toolName: tool.name, status: 'ok',
        data: { vendorUnresolved: 'ร้านกาแฟอเมซอน', availableVendors: [{ id: 'v1', name: 'ร้านสมใจ' }] },
        sourceRefs: [{ label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary', permissionChecked: true, webPath: '/companies/company-1/expenses' }],
        asOf: new Date().toISOString(),
      }),
    } as any;
    const orchestrator = new OrchestratorAgent(erp, laneConfig(['expense.list_recent::single_metric']));
    const logs = sink(orchestrator);
    const req = makeReq('แล้วร้านกาแฟอเมซอนล่ะคะ');
    req.userContext.permissions.push('expense.read');
    // The sanitizer requires any date in the proposed call to be backed by a value candidate (P0) — a
    // plain August-2026 month candidate, same shape used elsewhere in this file, keeps that orthogonal
    // to what this test actually proves (vendor-name resolution in the fast lane).
    req.valueCandidates = { amounts: [], dates: [], periods: [
      { span: 'August 2026', kind: 'month', fromDate: '2026-08-01', toDate: '2026-08-31', monthKey: '2026-08', source: 'explicit', label: 'สิงหาคม 2569', assumptions: [] },
    ] } as any;
    const preparedPlan = parseLineAiPreparedPlan({
      version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'simple_grounded', answerShape: 'single_metric',
      intakeIntent: 'BUSINESS_READ_QUESTION',
      intentPlan: {
        status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [],
        intents: [{ intent: 'read_summary', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.list_recent'], missingContext: [] }],
      },
      proposedCalls: [{ toolName: 'expense.list_recent', input: { fromDate: '2026-08-01', toDate: '2026-08-31', vendorName: 'ร้านกาแฟอเมซอน' } }],
    });
    assert.ok(preparedPlan);
    const result = await orchestrator.run({
      ...req, preparedPlan, intakeIntent: 'BUSINESS_READ_QUESTION',
      actorDelegations: { 'expense.list_recent': ['test-delegation'] },
    });
    assert.match(result.replyText, /ไม่พบร้านชื่อ "ร้านกาแฟอเมซอน" ค่ะ/);
    assert.match(result.replyText, /ร้านสมใจ/);
    assert.doesNotMatch(result.replyText, /ยังดึงข้อมูลส่วนนี้ไม่ได้/);
    // The reply already lists the real catalog and asks for a name — a generic "Expenses page" link
    // would be redundant, and the classic path (expenseBranchResolutionReply) attaches none either.
    assert.deepEqual(result.webLinks, []);
    assert.ok(laneLogs(logs).some((e) => e.msg === 'line.ai.prepared_simple_read.honest_terminal'));
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
      // The served line names the family it answered from (wave 2 H2 telemetry).
      assert.deepEqual(laneLogs(logs).map((e) => [e.msg, e.periodSource, e.tool, e.answerShape]),
        [['line.ai.prepared_simple_read.served', 'relative', testCase.tool, 'single_metric']]);
      assert.match(result.replyText, testCase.expect);
    });
  }

  // Owner 2026-09-29 (production 23:08, "ดูรายจ่าย ให้หน่อย เดือน ตุลา" → an empty ต.ค. 2568 with no word why):
  // both served expense answers say the year was assumed and that this year's October has not started.
  it('says a bare month that fell back to last year was assumed, on the list and the summary answer', async () => {
    const message = 'ดูรายจ่าย ให้หน่อย เดือน ตุลา';
    const valueCandidates = extractValueCandidates(message, '2026-09-29');
    const october = valueCandidates.periods?.[0];
    assert.ok(october);
    const input = { fromDate: october.fromDate, toDate: october.toDate };
    const client = { invoke: async (tool: any) => ({
      toolName: tool.name, status: 'ok', asOf: '2026-09-29T16:08:00.000Z',
      data: { total: 0, items: [], summary: { totalAmount: '0.00', countedItems: 0, cancelledCount: 0 },
        period: { ...input, defaultedToCurrentMonth: false } },
      sourceRefs: [{ label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary', permissionChecked: true, webPath: '/e' }],
    }) } as any;
    for (const answerShape of ['list', 'single_metric'] as const) {
      const req = periodRequest(message, 'expense.list_recent', input);
      const preparedPlan = parseLineAiPreparedPlan({ ...req.preparedPlan, answerShape });
      assert.ok(preparedPlan);
      const result = await new OrchestratorAgent(client, laneConfig([`expense.list_recent::${answerShape}`]))
        .run({ ...req, valueCandidates, preparedPlan });
      assert.match(result.replyText,
        /\nช่วง: 1–31 ต\.ค\. 2568 \(ไม่ได้ระบุปี จึงดูตุลาคมที่ผ่านมาล่าสุด\)\nตุลาคมปีนี้ยังไม่ถึงค่ะ\nข้อมูล ณ /, answerShape);
    }
  });

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

  // Owner 2026-09-29: the served families are the approved code constant; an env/config list can neither
  // narrow it nor widen it to a compiled-but-unapproved family such as VAT (spec R-L4 blind-eval gate).
  it('never serves a compiled-but-unapproved family, whatever the configured list says', async () => {
    const message = 'VAT เดือนที่แล้วต้องยื่นเท่าไหร่';
    const resolved = period(message);
    const recorded = recordingErpTools(resolved.fromDate, resolved.toDate);
    const lane = new OrchestratorAgent(recorded.client, laneConfig(['tax.get_vat_summary::single_metric']));
    const logs = sink(lane);
    await lane.run(periodRequest(message, 'tax.get_vat_summary', { periodKey: resolved.monthKey! }));
    assert.deepEqual(laneLogs(logs).map((e) => [e.msg, e.reason]),
      [['line.ai.prepared_simple_read.fallback', 'formatter_family_not_allowed']]);
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
    // C4 (batch 5c): the old "กรุณาเลือกสาขาจากหน้าเว็บ" dead end is gone — same-name matches ask for
    // more context in the chat instead, still without printing a code or an internal id.
    assert.match(result.replyText, /ลองเพิ่มรายละเอียดอื่น/);
    assert.doesNotMatch(result.replyText, /uuid-secret|รหัส|\bA\b|\bB\b|0\.00|0 รายการ/);
    assert.equal(result.deterministicExpenseSummary, undefined);
  });

  // C4 (batch 5c): "secret-code" here is the branch text the CUSTOMER typed ("...สาขา secret-code"),
  // not a hidden internal id — echoing back what they asked for is the point of "ไม่พบ...ชื่อ "X" ค่ะ".
  it('explains an unresolved branch by naming what was searched, without claiming there are no expenses', async () => {
    configureLoopProvider(text => expensePlan(text), [{ callTool: 'expense.list_recent', input: { fromDate: '2026-08-01', toDate: '2026-08-31', branchId: 'secret-code' } }]);
    const req = makeReq('ค่าใช้จ่ายเดือนสิงหาคม 2569 สาขา secret-code');
    req.userContext.permissions.push('expense.read');
    req.valueCandidates = { amounts: [], dates: [], periods: [periods[1]!] };
    const erp = { invoke: async (tool: any) => ({ toolName: tool.name, status: 'ok', data: {
      branchUnresolved: 'secret-code', availableBranches: [{ id: 'uuid-secret', name: 'สาขากลาง' }],
    }, sourceRefs: [], asOf: new Date().toISOString() }) } as any;
    const result = await new OrchestratorAgent(erp, makeConfig()).run(req);
    assert.match(result.replyText, /ไม่พบสาขาชื่อ "secret-code" ค่ะ/);
    assert.match(result.replyText, /พิมพ์ชื่อที่ต้องการมาได้เลยค่ะ/);
    assert.doesNotMatch(result.replyText, /uuid-secret|0\.00|0 รายการ/);
  });

  it('explains an out-of-scope branch by naming only the caller\'s own branches, never the forbidden one', async () => {
    configureLoopProvider(text => expensePlan(text), [{ callTool: 'expense.list_recent', input: { fromDate: '2026-08-01', toDate: '2026-08-31', branchId: 'บางนา' } }]);
    const req = makeReq('ค่าใช้จ่ายเดือนสิงหาคม 2569 สาขา บางนา');
    req.userContext.permissions.push('expense.read');
    req.valueCandidates = { amounts: [], dates: [], periods: [periods[1]!] };
    const erp = { invoke: async (tool: any) => ({ toolName: tool.name, status: 'ok', data: {
      branchOutOfScope: 'บางนา', availableBranches: [{ id: 'uuid-own', name: 'สาธุประดิษฐ์' }],
    }, sourceRefs: [], asOf: new Date().toISOString() }) } as any;
    const result = await new OrchestratorAgent(erp, makeConfig()).run(req);
    assert.match(result.replyText, /คุณดูข้อมูลได้เฉพาะสาขา/);
    assert.match(result.replyText, /สาธุประดิษฐ์/);
    assert.doesNotMatch(result.replyText, /บางนา|uuid-own|0\.00|0 รายการ/);
  });

  it('item 2c: asks which vendor when a name resolves to several distinct vendors', async () => {
    configureLoopProvider(text => expensePlan(text), [{ callTool: 'expense.list_recent', input: { fromDate: '2026-08-01', toDate: '2026-08-31', vendorName: 'สมใจ' } }]);
    const req = makeReq('ร้านสมใจจ่ายไปเท่าไหร่เดือนสิงหาคม 2569');
    req.userContext.permissions.push('expense.read');
    req.valueCandidates = { amounts: [], dates: [], periods: [periods[1]!] };
    const erp = { invoke: async (tool: any) => ({ toolName: tool.name, status: 'ok', data: {
      vendorAmbiguous: 'สมใจ', availableVendors: [{ id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'ร้านสมใจการค้า' }],
    }, sourceRefs: [], asOf: new Date().toISOString() }) } as any;
    const result = await new OrchestratorAgent(erp, makeConfig()).run(req);
    assert.match(result.replyText, /หมายถึงร้านไหนคะ/, 'spec item 2c: the exact ambiguous-vendor question');
    assert.match(result.replyText, /ร้านสมใจการค้า/);
    assert.doesNotMatch(result.replyText, /\bv1\b|\bv2\b|0\.00|0 รายการ/);
  });

  it('item 2c: names the available categories when a breakdown category name is not found (widened to get_breakdown)', async () => {
    const breakdownPlan = (messageText: string) => ({ status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_detail', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.get_breakdown'], missingContext: [] }], refusals: [], requiresHumanReview: false });
    configureLoopProvider(text => breakdownPlan(text), [{ callTool: 'expense.get_breakdown', input: { fromDate: '2026-08-01', toDate: '2026-08-31', categoryName: 'ยานยนต์' } }]);
    const req = makeReq('แยกค่าใช้จ่ายหมวดยานยนต์เดือนสิงหาคม 2569');
    req.userContext.permissions.push('expense.read');
    req.valueCandidates = { amounts: [], dates: [], periods: [periods[1]!] };
    const erp = { invoke: async (tool: any) => ({ toolName: tool.name, status: 'ok', data: {
      categoryUnresolved: 'ยานยนต์', availableCategories: [{ id: 'c1', name: 'ค่าเดินทาง' }, { id: 'c2', name: 'ค่าน้ำมัน' }],
    }, sourceRefs: [], asOf: new Date().toISOString() }) } as any;
    const result = await new OrchestratorAgent(erp, makeConfig()).run(req);
    // C4 (batch 5c, T-064-a): "ยังระบุ...ไม่ได้" read as a system limitation — the eval wants an
    // honest "ไม่พบ" instead.
    assert.match(result.replyText, /ไม่พบหมวดชื่อ "ยานยนต์" ค่ะ/);
    assert.match(result.replyText, /ค่าเดินทาง/);
    assert.match(result.replyText, /ค่าน้ำมัน/);
    assert.doesNotMatch(result.replyText, /\bc1\b|\bc2\b|0\.00|0 รายการ/);
  });

  it('item 2b: drops an ungrounded categoryName from the classic-path tool call instead of inventing a filter', async () => {
    const inputs: Array<Record<string, unknown>> = [];
    // The message never says "เครื่องเขียน" — a model-invented category name must not reach the ERP
    // call. The rest of the call (fromDate/toDate) still proceeds; only the ungrounded field is dropped.
    configureLoopProvider(text => expensePlan(text), [{ callTool: 'expense.list_recent', input: { fromDate: '2026-08-01', toDate: '2026-08-31', categoryName: 'เครื่องเขียน' } }]);
    const req = makeReq('ค่าใช้จ่ายเดือนสิงหาคม 2569');
    req.userContext.permissions.push('expense.read');
    req.valueCandidates = { amounts: [], dates: [], periods: [periods[1]!] };
    const result = await new OrchestratorAgent(expenseErp(inputs), makeConfig()).run(req);
    assert.deepEqual(inputs, [{ tool: 'expense.list_recent', fromDate: '2026-08-01', toDate: '2026-08-31' }]);
    assert.equal(result.deterministicExpenseSummary, true);
  });

  it('spec §4 R-M5: keeps a categoryName the message never states when it matches conversationContext.recentReads', async () => {
    const inputs: Array<Record<string, unknown>> = [];
    configureLoopProvider(text => expensePlan(text), [{ callTool: 'expense.list_recent', input: { fromDate: '2026-08-01', toDate: '2026-08-31', categoryName: 'เครื่องเขียน' } }]);
    const req = makeReq('เดือนนี้เท่าไหร่');
    req.userContext.permissions.push('expense.read');
    req.valueCandidates = { amounts: [], dates: [], periods: [periods[1]!] };
    req.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [], recentReads: [{
      tool: 'expense.list_recent', answerShape: 'single_metric', asOf: '2026-08-25T09:00:00.000Z', categoryName: 'เครื่องเขียน',
    }] };
    await new OrchestratorAgent(expenseErp(inputs), makeConfig()).run(req);
    assert.deepEqual(inputs, [{ tool: 'expense.list_recent', fromDate: '2026-08-01', toDate: '2026-08-31', categoryName: 'เครื่องเขียน' }]);
  });

  it('spec §4 R-M5: expense.get_detail\'s expenseId is accepted only from conversationContext.recentReads shownItems', async () => {
    const detailPlan = (messageText: string) => ({ status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_detail', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.get_detail'], missingContext: [] }], refusals: [], requiresHumanReview: false });
    const inputs: Array<Record<string, unknown>> = [];
    const erp = { invoke: async (tool: any, _ctx: unknown, input: Record<string, unknown> = {}) => {
      inputs.push({ tool: tool.name, ...input });
      return { toolName: tool.name, status: 'ok', data: { id: 'e1', vendorName: 'ร้านสมใจ', expenseDate: '2026-08-05T10:00:00.000Z', grandTotalAmount: '500.00' },
        sourceRefs: [{ label: 'ค่าใช้จ่าย', module: 'expenses', entityType: 'expense', permissionChecked: true, webPath: '/companies/company-1/expenses/e1' }], asOf: new Date().toISOString() };
    } } as any;
    const recentReads = [{ tool: 'expense.list_recent', answerShape: 'list' as const, asOf: '2026-08-25T09:00:00.000Z',
      shownItems: [{ ordinal: 1, id: 'e1', label: 'ร้านสมใจ', date: '2026-08-05' }] }];

    configureLoopProvider(text => detailPlan(text), [{ callTool: 'expense.get_detail', input: { expenseId: 'e1' } }]);
    const grounded = makeReq('รายการแรกจ่ายหรือยัง');
    grounded.userContext.permissions.push('expense.read');
    grounded.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [], recentReads };
    await new OrchestratorAgent(erp, makeConfig()).run(grounded);
    assert.deepEqual(inputs, [{ tool: 'expense.get_detail', expenseId: 'e1' }], 'e1 is in shownItems, so the call proceeds with it');

    inputs.length = 0;
    configureLoopProvider(text => detailPlan(text), [{ callTool: 'expense.get_detail', input: { expenseId: 'e2' } }]);
    const guessed = makeReq('รายการแรกจ่ายหรือยัง');
    guessed.userContext.permissions.push('expense.read');
    guessed.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [], recentReads };
    await new OrchestratorAgent(erp, makeConfig()).run(guessed);
    assert.deepEqual(inputs, [{ tool: 'expense.get_detail' }], 'e2 was never shown this chat, so expenseId is dropped from the call like any other ungrounded field — the API itself then fails the now-missing-required-field call');
    for (const captureContext of [ { recentCapturedExpenses: [{ id: 'captured' }] }, { activeExpenseDrafts: [{ expenseId: 'captured' }] } ]) {
      inputs.length = 0;
      configureLoopProvider(text => detailPlan(text), [{ callTool: 'expense.get_detail', input: { expenseId: 'captured' } }]);
      const captured = makeReq('แสดงรายการนั้นให้ดูหน่อย');
      captured.userContext.permissions.push('expense.read');
      captured.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [], ...captureContext };
      await new OrchestratorAgent(erp, makeConfig()).run(captured);
      assert.deepEqual(inputs, [{ tool: 'expense.get_detail', expenseId: 'captured' }], 'a server-issued capture/draft reference grounds the exact id');
      inputs.length = 0;
      configureLoopProvider(text => detailPlan(text), [{ callTool: 'expense.get_detail', input: { expenseId: 'other-chat-id' } }]);
      await new OrchestratorAgent(erp, makeConfig()).run(captured);
      assert.deepEqual(inputs, [{ tool: 'expense.get_detail' }], 'capture context cannot authorize another id');
    }

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
    const { activeProductHelpPack } = await import('./approved-product-help');
    const { knowledgePackHash } = await import('./approved-knowledge');
    const pack = activeProductHelpPack();
    const original = structuredClone(pack);
    Object.assign(pack, {
      status: 'APPROVED', reviewers: ['synthetic-test-reviewer'],
      effectiveFrom: '2020-01-01T00:00:00Z', effectiveTo: '2100-01-01T00:00:00Z', reviewDueAt: '2100-01-01T00:00:00Z',
    });
    pack.contentHash = knowledgePackHash(pack);
    try { await run(); } finally { Object.assign(pack, original); }
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
    const { activeProductHelpPack } = await import('./approved-product-help');
    const card = activeProductHelpPack().cards.find((entry) => entry.id === 'expense.status')!;
    assert.equal(calls(), 1);
    assert.equal(result.replyText, `${card.title}\n${card.body}`);
    assert.equal(result.sourceRefs[0]?.entityType, 'approved_product_help');
    assert.match(result.sourceRefs[0]?.entityId ?? '', /:7:expense\.status:5$/);
    assert.equal(result.webLinks[0]?.path, '/companies/company-1/user-guide/expenses#overview');
    assert.deepEqual(result.outputs.flatMap((entry) => entry.toolCalls), []);
  }));
  // Owner 2026-09-29: the Gateway switch is gone (always on); only the API's trusted admission bit and the
  // caller's current rights decide, so a stale `lineAiApprovedKnowledgeEnabled: false` changes nothing.
  it('requires the trusted API admission bit and rechecks current rights, whatever a stale Gateway switch says', async () => withReviewedPack(async () => {
    for (const variant of ['api-off', 'permission-revoked', 'feature-off']) {
      helpProvider(); const req = knowledgeRequest();
      if (variant === 'api-off') req.approvedKnowledge = false;
      if (variant === 'permission-revoked') req.userContext.permissions = [];
      if (variant === 'feature-off') req.entitledFeatureKeys = [];
      const result = await new OrchestratorAgent(makeOkErpTools(), makeConfig({ lineAiApprovedKnowledgeEnabled: variant !== 'gateway-off' })).run(req);
      assert.ok(result.sourceRefs.every(source => source.entityType !== 'approved_product_help'), variant);
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

describe('item 3 (R-M4): the classic tool-loop prompt names recentReads inheritance', () => {
  it('tells the model to inherit period/filters from recentReads and resolve ordinals via shownItems', () => {
    assert.match(ORCHESTRATOR_TOOL_LOOP_PROMPT, /conversationContext\.recentReads/);
    assert.match(ORCHESTRATOR_TOOL_LOOP_PROMPT, /a value the CURRENT message states always overrides/);
    assert.match(ORCHESTRATOR_TOOL_LOOP_PROMPT, /resolves to the id at that ordinal/);
    assert.match(ORCHESTRATOR_TOOL_LOOP_PROMPT, /A clear change of subject inherits nothing from recentReads/);
  });
});

// Round 2 A: validate the current semantic path too (kept in a registered spec).
import { runSemanticTurnV2 } from './semantic-turn-v2';
import { LINE_TOOL_REGISTRY, createLineAiInputEvidence, extractValueCandidatesV2 } from '@watchdog-bms/contracts';

it('Round 2 A: semantic planner can only preview proven expense IDs; always on and no mutation claim', async () => {
  const messageText = 'ยกเลิกรายการนี้ เพราะซ้ำ';
  const built = await createLineAiInputEvidence({ turnKey: 'action-turn', parts: [{ partId: 'p0', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: messageText }] });
  assert.ok(built);
  const valueCandidates = await extractValueCandidatesV2(built.inputEvidence, '2026-10-15');
  assert.ok(valueCandidates);
  const tool = LINE_TOOL_REGISTRY.find(t => t.name === 'expense.action.preview')!;
  for (const source of ['shown', 'capture', 'draft', 'invented', 'category', 'other-module']) {
    const req = makeReq(messageText);
    req.userContext.permissions = ['expense.void'];
    req.valueCandidates = valueCandidates;
    req.inputEvidence = built.inputEvidence;
    req.semanticSubrequests = [{ index: 0, kind: 'write', goal: messageText, dependsOn: [], requiredEvidence: [], evidenceRefs: [], requestedFilters: {} }];
    req.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [],
      ...(source === 'shown' ? { recentReads: [{ tool: 'expense.get_detail', answerShape: 'single_metric' as const, asOf: new Date().toISOString(), shownItems: [{ ordinal: 1, id: 'expense-action-id', label: 'ร้านทดสอบ' }] }] } : {}),
      ...(source === 'category' ? { recentReads: [{ tool: 'expense.get_breakdown', answerShape: 'list' as const, asOf: new Date().toISOString(), shownItems: [{ ordinal: 1, id: 'expense-action-id', label: 'หมวด', kind: 'category' as const }] }] } : {}),
      ...(source === 'other-module' ? { recentReads: [{ tool: 'reimbursement.get_detail', answerShape: 'single_metric' as const, asOf: new Date().toISOString(), shownItems: [{ ordinal: 1, id: 'expense-action-id', label: 'ใบเบิก' }] }] } : {}),
      ...(source === 'capture' ? { recentCapturedExpenses: [{ id: 'expense-action-id' }] } : {}),
      ...(source === 'draft' ? { activeExpenseDrafts: [{ expenseId: 'expense-action-id' } as any] } : {}),
    };
    const calls: any[] = [], providerCalls: string[] = [];
    const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async (input: any) => {
        providerCalls.push(input.usageTag);
        if (input.usageTag === 'line.loop') {
          assert.match(JSON.stringify(input.messages), /expense.action.preview/u, 'preview is offered even when old draft flag is off');
          return { ok: true, text: JSON.stringify({ calls: [{ index: 0, toolName: tool.name, input: { expenseId: 'expense-action-id', action: 'VOID', reason: 'รายการซ้ำ' } }] }) };
        }
        return { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'ยกเลิกแล้วค่ะ', sourceRefIds: [] }] }) };
      } } as any,
      invoke: async (meta, ctx, input) => { calls.push({ meta, ctx, input }); return { toolName: meta.name, status: 'ok', asOf: new Date().toISOString(),
        sourceRefs: [{ module: 'expenses', entityType: 'expense_action_preview', label: 'คำขอค่าใช้จ่าย', permissionChecked: true }],
        data: { reply: 'กดยกเลิกรายการเพื่อดำเนินการค่ะ', preview: { action: 'VOID' } } }; },
    });
    const allowed = ['shown', 'capture', 'draft'].includes(source);
    assert.equal(calls.length, allowed ? 1 : 0, source);
    if (allowed) {
      assert.equal(result.replyText, 'กดยกเลิกรายการเพื่อดำเนินการค่ะ');
      assert.equal(result.semanticCoverage?.[0]?.status, 'needs_user');
      assert.equal(calls[0].input.action, 'VOID');
      assert.equal(providerCalls.includes('line.compose'), false, 'the preview reply is deterministic');
    }
  }
});

it('Round 3: reimbursement actions require shown reimbursement IDs; payment reuses grounded expense IDs with old switches off', async () => {
  const messageText = 'อนุมัติใบเบิกนี้';
  const built = await createLineAiInputEvidence({ turnKey: 'r3-action-turn', parts: [{ partId: 'p0', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: messageText }] }); assert.ok(built);
  const valueCandidates = await extractValueCandidatesV2(built.inputEvidence, '2026-10-15'); assert.ok(valueCandidates);
  for (const source of ['reimbursement.get_summary', 'reimbursement.get_detail', 'reimbursement.list_pending_approvals', 'expense.get_detail', 'expense.get_breakdown', 'capture', 'invented']) {
    const req = makeReq(messageText); req.userContext.permissions = ['reimbursement.approve']; req.inputEvidence = built.inputEvidence; req.valueCandidates = valueCandidates;
    req.semanticSubrequests = [{ index: 0, kind: 'write', goal: messageText, dependsOn: [], requiredEvidence: [], evidenceRefs: [], requestedFilters: {} }];
    req.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [],
      ...(source === 'capture' ? { recentCapturedExpenses: [{ id: 'claim-action-id' }] } : source === 'invented' ? {} : { recentReads: [{ tool: source, answerShape: 'list' as const, asOf: new Date().toISOString(), shownItems: [{ ordinal: 1, id: 'claim-action-id', label: 'ใบเบิก' }] }] }),
    };
    const calls: any[] = [];
    const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async (input: any) => input.usageTag === 'line.loop'
        ? { ok: true, text: JSON.stringify({ calls: [{ index: 0, toolName: 'expense.action.preview', input: { reimbursementId: 'claim-action-id', action: 'REIMBURSEMENT_APPROVE' } }] }) }
        : { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'อนุมัติแล้วค่ะ', sourceRefIds: [] }] }) } } as any,
      invoke: async (meta, ctx, input) => { calls.push({ ctx, input }); return { toolName: meta.name, status: 'ok', sourceRefs: [], asOf: new Date().toISOString(), data: { reply: 'กรุณาตรวจรายละเอียดแล้วกดอนุมัติค่ะ' } }; },
    });
    assert.equal(calls.length, source.startsWith('reimbursement.') ? 1 : 0, source);
    if (calls.length) { assert.equal(result.replyText, 'กรุณาตรวจรายละเอียดแล้วกดอนุมัติค่ะ'); assert.equal(result.semanticCoverage?.[0]?.status, 'needs_user'); }
  }
});
it('Fix-up 19: fresh claim reads bind approve/reject previews only with checked evidence on the same subrequest', async () => {
  const { runWithUsageContext } = await import('../../../common/usage/usage-context');
  for (const action of ['REIMBURSEMENT_APPROVE', 'REIMBURSEMENT_REJECT']) {
    for (const source of ['checked', 'unchecked', 'no-source', 'wrong-id', 'other-subrequest']) {
      const req = makeReq('อนุมัติใบเบิกนี้ หรือปฏิเสธเพราะไม่มีใบเสร็จ');
      req.userContext.permissions = ['reimbursement.read_related', 'reimbursement.approve', 'reimbursement.reject'];
      req.semanticSubrequests = [{ index: 0, kind: 'write', goal: req.messageText, dependsOn: [], requiredEvidence: [], evidenceRefs: [], requestedFilters: {} },
        { index: 1, kind: 'read', goal: 'ดูใบเบิก', dependsOn: [], requiredEvidence: [], evidenceRefs: [], requestedFilters: {} }];
      const calls: string[] = [];
      const budget: any = { status: 'active-v2', calls: 0, repairCount: 0, grant: { maxTurnSlots: 4 } };
      let round = 0;
      await runWithUsageContext({ budget }, () => runSemanticTurnV2({ req,
        draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
        provider: { generateText: async input => {
          budget.calls++;
          if (input.usageTag !== 'line.loop') return { ok: true, text: JSON.stringify({ answers: [0, 1].map(index => ({ index, status: 'needs_user', text: 'ตรวจรายละเอียดแล้วกดยืนยันค่ะ' })) }) };
          return { ok: true, text: JSON.stringify({ calls: [round++ === 0
            ? { index: source === 'other-subrequest' ? 1 : 0, toolName: 'reimbursement.list_pending_approvals', input: {} }
            : { index: 0, toolName: 'expense.action.preview', input: { action, reimbursementId: source === 'wrong-id' ? 'invented-claim' : 'shown-claim',
                ...(action === 'REIMBURSEMENT_REJECT' ? { reason: 'ไม่มีใบเสร็จ' } : {}) } }], questions: [] }) };
        } }, invoke: async (meta): Promise<any> => {
          calls.push(meta.name);
          return { toolName: meta.name, status: 'ok', asOf: new Date().toISOString(),
            sourceRefs: source === 'no-source' ? [] : [{ module: 'reimbursements', entityType: 'reimbursement_approval_queue', label: 'ใบเบิกรออนุมัติ', permissionChecked: source !== 'unchecked' }],
            data: meta.name === 'expense.action.preview' ? { reply: 'ตรวจรายละเอียดแล้วกดยืนยันค่ะ', preview: { action } } : { items: [{ id: 'shown-claim' }] } };
        } }));
      assert.deepEqual(calls, source === 'checked' ? ['reimbursement.list_pending_approvals', 'expense.action.preview'] : ['reimbursement.list_pending_approvals'], `${action}/${source}`);
    }
  }
});

it('F3: both planner questions and free compose reject uncommitted write claims', async () => {
  const liveClaim = 'บันทึกค่าใช้จ่ายอินฟลู 500 บาท วันที่ 10 ตุลาคม 2569 จำนวน 1 คน — ช่วยบอกด้วยนะคะ ว่าจ่ายที่สาขาไหน และหมวดหมู่ค่าใช้จ่ายคืออะไรคะ (เช่น ค่าการตลาด, ค่าโฆษณา ฯลฯ)';
  for (const path of ['planner', 'compose']) {
    for (const text of [liveClaim, `**${liveClaim}**`, 'สร้างร่างแล้วค่ะ', 'เก็บข้อมูลเรียบร้อยค่ะ', 'บันทึกค่าใช้จ่ายให้แล้วค่ะ', 'รับทราบค่ะ บันทึกค่าใช้จ่าย 500.80 บาท วันที่ 13 ต.ค. 2569 แล้วค่ะ', 'Saved the expense.']) {
      const req = makeReq('เป็นค่าบริการ');
      req.semanticSubrequests = [{ index: 0, kind: 'write', writeIntent: 'EXPENSE_DRAFT_CONTINUATION', goal: 'แก้หมวดค่าใช้จ่าย',
        requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: [] }];
      const result = await runSemanticTurnV2({ req, draftEditEnabled: true, reimbursementDraftEnabled: false,
        publicLookupEnabled: false, approvedKnowledgeEnabled: false,
        provider: { generateText: async (input: any) => {
          if (input.usageTag === 'line.loop') return { ok: true, text: JSON.stringify({ calls: [], questions: path === 'planner' ? [{ index: 0, text }] : [] }) };
          assert.match(input.systemPrompt, /Only the server may acknowledge a successful write in this turn/u);
          return { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'needs_user', text, question: text }] }) };
        } } as any,
        invoke: async () => assert.fail('no tool call or write succeeded'),
      });
      assert.match(result.replyText, /ตรวจร่างหรือบอกข้อมูลที่ต้องการแก้ไขได้เลยค่ะ/u, `${path}: ${text}`);
      assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'WRITE_NOT_COMMITTED');
      assert.equal(result.semanticCoverage?.[0]?.question, result.replyText);
      if (text.includes('—')) assert.match(result.replyText, /ช่วยบอกด้วยนะคะ/);
      assert.deepEqual(result.outputs, []);
    }
  }
  for (const text of ['ยังไม่ได้บันทึกรายการค่ะ', 'ยังไม่สร้างรายการค่ะ', 'บันทึกค่าใช้จ่ายได้ที่เว็บค่ะ', 'ต้องการสร้างร่างไหมคะ', 'The expense has not been saved.']) {
    assert.equal(claimsCompletedWrite(text), false, text);
  }
});

it('F5: planner questions pass the existing LINE sanitizer before reply and coverage', async () => {
  const req = makeReq('เป็นค่าบริการ');
  req.semanticSubrequests = [{ index: 0, kind: 'write', writeIntent: 'EXPENSE_DRAFT_CONTINUATION', goal: 'แก้หมวดค่าใช้จ่าย',
    requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: [] }];
  const question = '  ## ข้อมูลเพิ่มเติม\n**หมวดหมู่ค่าใช้จ่าย** — อินฟลูจัดอยู่ในหมวดไหนคะ\n*ชื่อสาขา* และ _วิธีชำระเงิน_ คะ';
  const result = await runSemanticTurnV2({ req, draftEditEnabled: true, reimbursementDraftEnabled: false,
    publicLookupEnabled: false, approvedKnowledgeEnabled: false,
    provider: { generateText: async () => ({ ok: true, text: JSON.stringify({ calls: [], questions: [{ index: 0, text: question }] }) }) } as any,
    invoke: async () => assert.fail('a question must not call tools'),
  });
  assert.equal(result.replyText, 'ข้อมูลเพิ่มเติม\nหมวดหมู่ค่าใช้จ่าย อินฟลูจัดอยู่ในหมวดไหนคะ\nชื่อสาขา และ วิธีชำระเงิน คะ');
  assert.equal(result.semanticCoverage?.[0]?.question, result.replyText);
});

it('G2: a final-action missing-field answer remains exact and needs input without a confirm card or model paraphrase', async () => {
  const messageText = 'ยืนยันรายการนี้ให้หน่อย';
  const req = makeReq(messageText);
  const built = await createLineAiInputEvidence({ turnKey: 'g2-confirm', parts: [{ partId: 'p0', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: messageText }] }); assert.ok(built);
  req.inputEvidence = built.inputEvidence;
  req.valueCandidates = (await extractValueCandidatesV2(built.inputEvidence, '2026-10-15'))!;
  req.userContext.permissions = ['expense.confirm', 'expense.update'];
  req.semanticSubrequests = [{ index: 0, kind: 'write', goal: messageText, dependsOn: [], requiredEvidence: [], evidenceRefs: [], requestedFilters: {} }];
  req.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [], recentCapturedExpenses: [{ id: 'g2-expense' }] };
  const reply = 'ยังขาดหมวดค่าใช้จ่าย เลือกหมวดด้านล่างหรือพิมพ์ชื่อหมวดได้เลยค่ะ';
  const providerCalls: string[] = [];
  const result = await runSemanticTurnV2({ req, draftEditEnabled: true, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
    provider: { generateText: async (input: any) => {
      providerCalls.push(input.usageTag);
      return { ok: true, text: JSON.stringify({ calls: [{ index: 0, toolName: 'expense.action.preview', input: { expenseId: 'g2-expense', action: 'CONFIRM' } }] }) };
    } } as any,
    invoke: async meta => ({ toolName: meta.name, status: 'ok', asOf: new Date().toISOString(), data: { reply },
      sourceRefs: [{ module: 'expenses', entityType: 'expense_action_preview', label: 'คำขอยืนยันรายการ', permissionChecked: true }] }),
  });
  assert.equal(result.replyText, reply);
  assert.equal(result.semanticCoverage?.[0]?.status, 'needs_user');
  assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'DRAFT_INPUT_REQUIRED');
  assert.equal(providerCalls.includes('line.compose'), false);
});
it('Round 5: every voucher/certificate action reaches the existing preview tool only with shown voucher IDs', async () => {
  for (const action of ['VOUCHER_SUBMIT','VOUCHER_APPROVE','VOUCHER_RETURN','VOUCHER_PAY','VOUCHER_CANCEL','WHT_CERTIFICATE_ISSUE']) {
    for (const source of ['voucher.get_detail','voucher.future_read','expense.get_detail','reimbursement.get_detail','invented']) {
      const messageText = 'ทำใบสำคัญจ่ายรายการนี้';
      const built = await createLineAiInputEvidence({ turnKey: 'r5-action-turn', parts: [{ partId: 'p0', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: messageText }] }); assert.ok(built);
      const req = makeReq(messageText); req.inputEvidence = built.inputEvidence; req.valueCandidates = await extractValueCandidatesV2(built.inputEvidence, '2026-10-15') ?? undefined;
      req.userContext.permissions = ['expense.disbursement.prepare','expense.disbursement.approve','expense.disbursement.pay','wht.certificate.issue'];
      req.semanticSubrequests = [{ index: 0, kind: 'write', goal: messageText, dependsOn: [], requiredEvidence: [], evidenceRefs: [], requestedFilters: {} }];
      req.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [], recentReads: source === 'invented' ? [] : [{ tool: source, answerShape: 'list', asOf: new Date().toISOString(), shownItems: [{ ordinal: 1, id: 'voucher-action', label: 'ใบเตรียมจ่าย' }] }] };
      const calls: any[] = [];
      const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
        provider: { generateText: async (input: any) => input.usageTag === 'line.loop' ? { ok: true, text: JSON.stringify({ calls: [{ index: 0, toolName: 'expense.action.preview', input: { voucherId: 'voucher-action', action, ...(['VOUCHER_RETURN','VOUCHER_CANCEL'].includes(action) ? { reason: 'ข้อมูลผิด' } : {}) } }] }) } : { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'needs_user', text: 'ต้องการทำรายการไหนคะ', question: 'ต้องการทำรายการไหนคะ' }] }) } } as any,
        invoke: async (meta, ctx, input) => { calls.push({ input, ctx }); return { toolName: meta.name, status: 'ok', sourceRefs: [], asOf: new Date().toISOString(), data: { reply: 'กรุณาตรวจและกดยืนยันค่ะ' } }; },
      });
      assert.equal(calls.length, source.startsWith('voucher.') ? 1 : 0, `${action}/${source}`);
      if (calls.length) { assert.equal(calls[0].input.action, action); assert.equal(result.replyText, 'กรุณาตรวจและกดยืนยันค่ะ'); assert.equal(result.semanticCoverage?.[0]?.status, 'needs_user'); }
    }
  }
});
it('Round 5: multi-expense voucher create grounds every selected expense and rejects a single invented or wrong-kind source', async () => {
  for (const source of ['expense.list_recent','voucher.get_detail','invented']) {
    const messageText = 'สร้างใบเตรียมจ่ายจากสองรายการนี้';
    const built = await createLineAiInputEvidence({ turnKey: 'r5-create-turn', parts: [{ partId: 'p0', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: messageText }] }); assert.ok(built);
    const req = makeReq(messageText); req.inputEvidence = built.inputEvidence; req.valueCandidates = await extractValueCandidatesV2(built.inputEvidence, '2026-10-15') ?? undefined;
    req.userContext.permissions = ['expense.disbursement.prepare']; req.semanticSubrequests = [{ index: 0, kind: 'write', goal: messageText, dependsOn: [], requiredEvidence: [], evidenceRefs: [], requestedFilters: {} }];
    req.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [], recentReads: [{ tool: source === 'invented' ? 'expense.list_recent' : source, answerShape: 'list', asOf: new Date().toISOString(), shownItems: [{ ordinal: 1, id: 'expense-a', label: 'ร้าน ก' }, ...(source !== 'invented' ? [{ ordinal: 2, id: 'expense-b', label: 'ร้าน ก' }] : [])] }] };
    let calls = 0;
    await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async (input: any) => input.usageTag === 'line.loop' ? { ok: true, text: JSON.stringify({ calls: [{ index: 0, toolName: 'expense.action.preview', input: { expenseIds: 'expense-a,expense-b', action: 'VOUCHER_CREATE' } }] }) } : { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'needs_user', text: 'ต้องการเลือกรายการไหนคะ', question: 'ต้องการเลือกรายการไหนคะ' }] }) } } as any,
      invoke: async (meta) => { calls++; return { toolName: meta.name, status: 'ok', sourceRefs: [], asOf: new Date().toISOString(), data: { reply: 'กรุณาตรวจและกดยืนยันค่ะ' } }; },
    });
    assert.equal(calls, source === 'expense.list_recent' ? 1 : 0, source);
  }
});

describe('round 5A document advisor orchestrator', () => {
  it('preserves a catalog calculation ask-back verbatim through the full accounting read path', async () => {
    const plan = { status: 'ROUTABLE', language: 'th', refusals: [], requiresHumanReview: false,
      intents: [{ intent: 'read_summary', subject: 'tax', agent: 'tax', priority: 1, requiredTools: ['wht.calculate_withholding'], missingContext: [] }] };
    globalThis.fetch = async () => new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(plan) }), { status: 200, headers: { 'content-type': 'application/json' } });
    const message = 'จ่ายค่าอะไรคะ';
    let calls = 0;
    const orchestrator = new OrchestratorAgent({ invoke: async (tool: any, ctx: any) => {
      calls++; assert.equal(tool.name, 'wht.calculate_withholding'); assert.equal(ctx.companyId, 'company-1');
      return { toolName: tool.name, status: 'ok', data: { needsIncomeType: true, message },
        sourceRefs: [{ label: 'รายการที่จ่ายที่เลือกได้', module: 'tax', entityType: 'advisor_document_read', permissionChecked: true }], asOf: '2026-10-15T00:00:00Z' };
    } } as any, makeConfig());
    const req = makeReq('จ่ายค่าจ้าง 1000 บาท ต้องหักเท่าไหร่');
    req.userContext.permissions = ['expense.create']; req.userContext.entitledFeatureKeys = ['wht_50bis'];
    const r = await orchestrator.run(req); assert.equal(calls, 1); assert.equal(r.replyText, message);
    assert.doesNotMatch(r.replyText, /3%|30 บาท|CAT_/);
  });
  it('U2 Starter explains 50 ทวิ through the general composer without reading shop data', async () => {
    let calls = 0, modelCalls = 0;
    const explanation = '50 ทวิคือหนังสือรับรองยอดเงินที่จ่ายและภาษีที่หักไว้ ให้ผู้รับเงินใช้เป็นหลักฐานภาษีค่ะ';
    globalThis.fetch = async () => { modelCalls++; return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify({ answers: [{ index: 0, status: 'handled', topic: 'business', text: explanation }] }) }), { status: 200, headers: { 'content-type': 'application/json' } }); };
    const req = makeReq('50 ทวิ คืออะไร'); req.userContext.entitledFeatureKeys = ['expenses'];
    req.userContext.permissions = ['company.plan.manage', 'expense.read', 'wht.external_certificate.link'];
    req.semanticSubrequests = [{ index: 0, kind: 'help', goal: req.messageText, evidenceRefs: [], requiredEvidence: [], requestedFilters: {}, dependsOn: [] }];
    req.inputEvidence = (await createLineAiInputEvidence({ turnKey: 'u2', parts: [{ partId: 'text', rawText: req.messageText, eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now() }] }))!.inputEvidence;
    req.budgetGrantV2 = {} as any;
    const result = await new OrchestratorAgent({ invoke: async () => { calls++; throw new Error('must not read'); } } as any, makeConfig()).run(req);
    assert.equal(calls, 0); assert.equal(modelCalls, 1);
    assert.match(result.replyText, /หนังสือรับรอง 50 ทวิ.*ภาษีที่หักไว้.*จดเลขที่ใบ 50 ทวิ ที่ทำนอกระบบ.*ธุรกิจ 1,999 บาท/);
    assert.doesNotMatch(result.replyText, /ENTERPRISE|ทำได้เลย/);
    assert.deepEqual(result.webLinks, [{ label: 'ดูแพ็กเกจ', path: '/companies/company-1/billing?channel=line' }]);
  });
});

it('Round 7A prepares counterparty cards with old draft switches off and forwards quoted expense IDs to tools', async () => {
  for (const variant of ['counterparty', 'quoted-draft']) {
    const messageText = variant === 'counterparty' ? 'แก้ที่อยู่ร้าน X เป็น 123 ถนนสุขุมวิท' : 'ลบร่างของอันนี้';
    const built = await createLineAiInputEvidence({ turnKey: `r7a-${variant}`, parts: [{ partId: 'p0', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: messageText }] }); assert.ok(built);
    const candidates = await extractValueCandidatesV2(built.inputEvidence, '2026-10-15'); assert.ok(candidates);
    const req = makeReq(messageText); req.userContext.permissions = variant === 'counterparty' ? ['accounting.counterparty.manage'] : ['expense.update'];
    req.userContext.entitledFeatureKeys = ['expenses']; req.entitledFeatureKeys = ['expenses']; req.inputEvidence = built.inputEvidence; req.valueCandidates = candidates;
    req.semanticSubrequests = [{ index: 0, kind: 'write', goal: messageText, dependsOn: [], requiredEvidence: [], evidenceRefs: [], requestedFilters: {} }];
    req.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [],
      quotedRecords: variant === 'quoted-draft' ? [{ tool: 'expense.get_detail', id: 'quoted-draft-id' }] : [],
      recentReads: [{ tool: variant === 'counterparty' ? 'counterparty.search' : 'expense.get_detail', answerShape: 'list', asOf: new Date().toISOString(),
        shownItems: [{ id: variant === 'counterparty' ? 'counterparty-id' : 'quoted-draft-id', ordinal: 1, label: 'รายการที่อ้างตอบ' }] }] };
    const calls: any[] = [];
    const toolName = variant === 'counterparty' ? 'counterparty.action.preview' : 'expense.action.preview';
    const input = variant === 'counterparty' ? { action: 'UPDATE', counterpartyId: 'counterparty-id', addressText: '123 ถนนสุขุมวิท' } : { action: 'DELETE_DRAFT', expenseId: 'quoted-draft-id' };
    const response = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async (request: any) => {
        assert.equal(request.usageTag, 'line.loop', 'confirm preview needs no composer'); assert.match(JSON.stringify(request.messages), new RegExp(toolName.replaceAll('.', '\\.')));
        return { ok: true, text: JSON.stringify({ calls: [{ index: 0, toolName, input }] }) };
      } } as any,
      invoke: async (meta, _ctx, input) => { calls.push({ name: meta.name, input }); return { toolName: meta.name, status: 'ok', asOf: new Date().toISOString(),
        sourceRefs: [], data: { reply: 'ตรวจข้อมูลแล้วกดยืนยันค่ะ', preview: { token: 'server-token' } } }; },
    });
    assert.equal(calls.length, 1, variant); assert.deepEqual(calls[0], { name: toolName, input }); assert.equal(response.semanticCoverage?.[0]?.status, 'needs_user');
  }
});
it('H4: exact live conversational save claim is rewritten as a draft on planner and compose replies', async () => {
  const live = 'ไม่ได้เงียบนะคะ มั่งมีอยู่ตรงนี้เสมอเลย 😊 เพิ่งช่วยบันทึกค่าใช้จ่ายอินฟลู 500 บาท วันที่ 10 ต.ค. 2569 ไปเมื่อกี้ค่ะ มีอะไรให้ช่วยต่อไหมคะ?';
  assert.equal(claimsCompletedWrite(live), true);
  assert.equal(claimsCompletedWrite('บันทึกค่าใช้จ่ายอินฟลู 500 บาทแล้วค่ะ'), true);
  const casual = await new ResponseComposerAgent().composeCasual('เงียบเลย', { generateText: async () => ({ ok: true, text: live }) } as any,
    { conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: [], activeExpenseDrafts: [{ expenseId: 'draft-influencer' }] } });
  assert.match(casual, /ยังเป็นร่างค่ะ/u);
  for (const path of ['planner', 'compose']) {
    const req = makeReq('เงียบเลย');
    req.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [], activeExpenseDrafts: [{ expenseId: 'draft-influencer' }] };
    req.semanticSubrequests = [{ index: 0, kind: 'general', goal: 'เงียบเลย', dependsOn: [], requiredEvidence: [], requestedFilters: {}, evidenceRefs: [] }];
    const result = await runSemanticTurnV2({ req, draftEditEnabled: true, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async (input: any) => {
        if (input.usageTag === 'line.loop') return { ok: true, text: JSON.stringify({ calls: [], questions: path === 'planner' ? [{ index: 0, text: live }] : [] }) };
        assert.match(input.systemPrompt, /unconfirmed expense.*ร่าง/u);
        return { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'handled', text: live, sourceRefIds: [] }] }) };
      } } as any, invoke: async () => assert.fail('no write is authorized by a conversational reply') });
    assert.match(result.replyText, /ยังเป็นร่างค่ะ/u, path);
    assert.doesNotMatch(result.replyText, /เพิ่งช่วยบันทึกค่าใช้จ่าย|บันทึกค่าใช้จ่าย.*แล้ว|ยังไม่ได้บันทึกรายการ/u, path);
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'WRITE_NOT_COMMITTED', path);
  }
});

it('Round 7 B: team/branch writes always prepare human cards and role reads remain permission-filtered', async () => {
  for (const action of ['EMPLOYEE_CREATE', 'EMPLOYEE_UPDATE', 'EMPLOYEE_DISABLE', 'EMPLOYEE_ENABLE', 'BRANCH_CREATE', 'BRANCH_UPDATE']) {
    const messageText = 'จัดการพนักงานสมใจและสาขาลาดพร้าว';
    const built = await createLineAiInputEvidence({ turnKey: `r7-${action}`, parts: [{ partId: 'p0', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: messageText }] }); assert.ok(built);
    const req = makeReq(messageText); req.inputEvidence = built.inputEvidence; req.valueCandidates = (await extractValueCandidatesV2(built.inputEvidence, '2026-10-15'))!;
    req.userContext.permissions = ['access.employee.create', 'access.employee.update', 'access.employee.disable', 'company.branch.manage']; req.userContext.entitledFeatureKeys = [];
    req.semanticSubrequests = [{ index: 0, kind: 'write', goal: messageText, dependsOn: [], requiredEvidence: [], evidenceRefs: [], requestedFilters: {} }];
    let calls = 0, composed = false;
    const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async (input: any) => {
        if (input.usageTag === 'line.loop') { assert.match(JSON.stringify(input.messages), /company.action.preview/u); return { ok: true, text: JSON.stringify({ calls: [{ index: 0, toolName: 'company.action.preview', input: { action, employeeName: 'สมใจ', branchName: 'ลาดพร้าว' } }] }) }; }
        composed = true; return { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'บันทึกแล้วค่ะ' }] }) };
      } } as any,
      invoke: async (meta, _ctx, input) => { calls++; assert.equal(meta.name, 'company.action.preview'); assert.equal(input.action, action); return { toolName: meta.name, status: 'ok', data: { reply: 'กรุณาตรวจรายละเอียดแล้วกดยืนยันค่ะ', preview: { action } }, sourceRefs: [{ module: 'employee-access', entityType: 'company_action_preview', label: 'คำขอ', permissionChecked: true, sourceType: 'ACTION' }], asOf: new Date().toISOString() }; },
    });
    assert.equal(calls, 1, action); assert.equal(composed, false, action); assert.equal(result.replyText, 'กรุณาตรวจรายละเอียดแล้วกดยืนยันค่ะ'); assert.equal(result.semanticCoverage?.[0]?.status, 'needs_user');
  }
  const read = LINE_TOOL_REGISTRY.find(t => t.name === 'company.get_roles')!;
  assert.ok(read.anyOfPermissions?.includes('access.role.read')); assert.equal(read.category, 'read_detail');
});

it('R10 Q4: social replies can refer to an earlier draft and keep useful text when a new save claim is blocked', async () => {
  const live = 'ไม่ได้เงียบเลยค่ะ มั่งมีอยู่ตรงนี้ตลอด 😊 เพิ่งช่วยสร้างร่างค่าอินฟลู 500 บาท วันที่ 10 ต.ค. 2569 ไว้ค่ะ มีอะไรให้ช่วยต่อไหมคะ?';
  for (const text of [live, 'ไม่ได้เงียบเลยค่ะ ตอนนี้บันทึกร่างค่าอินฟลู 500 บาท วันที่ 10 ต.ค. ไว้แล้วนะคะ มีอะไรให้ช่วยต่อไหมคะ?']) {
    assert.equal(claimsCompletedWrite(text), false);
    const req = makeReq('อ่าว ทำไมเงียบ');
    req.semanticSubrequests = [{ index: 0, kind: 'general', goal: req.messageText, dependsOn: [], requiredEvidence: [], requestedFilters: {}, evidenceRefs: [] }];
    const result = await runSemanticTurnV2({ req, draftEditEnabled: true, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async (input: any) => ({ ok: true, text: JSON.stringify(input.usageTag === 'line.loop'
        ? { calls: [], questions: [] } : { answers: [{ index: 0, status: 'handled', text, sourceRefIds: [] }] }) }) } as any,
      invoke: async () => assert.fail('social recall cannot write') });
    assert.match(result.replyText, /ไม่ได้เงียบเลยค่ะ/); assert.match(result.replyText, /ร่าง/);
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'WRITE_NOT_COMMITTED');
  }
  for (const text of ['สร้างร่างแล้วค่ะ', 'ยืนยันรายการแล้วค่ะ', 'สร้างร่างไว้และบันทึกจ่ายแล้วค่ะ', 'สร้างร่างไว้ก่อนหน้านี้ และบันทึกค่าใช้จ่ายใหม่แล้วค่ะ', 'บันทึกค่าใช้จ่าย 500 บาทแล้วค่ะ']) assert.equal(claimsCompletedWrite(text), true, text);
});


describe('U2 document explanations precede a package limit and keep the general composer', () => {
  for (const [question, explanation] of [
    ['50 ทวิ คืออะไร', '50 ทวิคือหนังสือรับรองยอดเงินที่จ่ายและภาษีที่หักไว้ ให้ผู้รับเงินใช้เป็นหลักฐานภาษีค่ะ'],
    ['ภงด.53 คืออะไร', 'ภงด.53 คือแบบนำส่งภาษีหัก ณ ที่จ่ายสำหรับการจ่ายเงินให้นิติบุคคลค่ะ'],
    ['ใบสำคัญจ่ายคืออะไร', 'ใบสำคัญจ่ายคือเอกสารบันทึกการจ่ายเงินพร้อมหลักฐาน เพื่อให้ตรวจสอบรายจ่ายได้ค่ะ'],
  ]) for (const kind of ['help', 'general', 'read'] as const) it(`${question} routed ${kind}`, async () => {
    const calls: ProviderInput[] = [];
    const result = await runSemanticTurnV2({
      req: { packageOffers: testPaidTiers.map(tier => testBillingOffer(tier, 'month')), requestId: 'u2', webhookEventId: 'u2', messageText: question, messagePreviewHash: 'a'.repeat(16),
        entitledFeatureKeys: [], intakeIntent: 'BUSINESS_READ_QUESTION',
        userContext: { ...makeReq(question).userContext, permissions: ['company.plan.manage'] },
        semanticSubrequests: [{ index: 0, kind, goal: question, evidenceRefs: [], requiredEvidence: [], requestedFilters: {}, dependsOn: [] }] },
      provider: { generateText: async (input: ProviderInput) => { calls.push(input); return { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'handled', topic: 'business', text: explanation }] }) }; } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      invoke: async () => { throw new Error('general explanation must not read shop documents'); },
    });
    assert.deepEqual(calls.map(call => call.usageTag), ['line.compose']);
    assert.match(JSON.stringify(calls[0]), /one or two sentences of general knowledge/);
    assert.match(result.replyText, /ภาษี|จ่ายเงินจริง/);
    assert.match(result.replyText, /แพ็กเกจ.*[0-9,]+ บาทต่อเดือนค่ะ$/);
    assert.doesNotMatch(result.replyText, /ENTERPRISE|STARTER|ทำได้เลย/);
    assert.deepEqual(result.sourceRefs, []);
    assert.deepEqual(result.webLinks, [{ label: 'ดูแพ็กเกจ', path: '/companies/company-1/billing?channel=line' }]);
    assert.equal(result.semanticCoverage?.[0].status, 'handled');
  });
});


it('U2 definitions are general knowledge, while Starter shop reads and issuance remain gated', () => {
  for (const question of ['50 ทวิ คืออะไร', 'ภงด.53 คืออะไร', 'ใบสำคัญจ่ายคืออะไร'])
    assert.equal(scopePolicyOverride(question, 'help', [], [], 'th'), undefined);
  for (const question of ['ออก 50 ทวิให้หน่อย', '50 ทวิของร้านเรามีกี่ใบ', 'ภงด.53 ของร้านเราเดือนนี้', '50 ทวิ คืออะไร แล้วของร้านเรามีกี่ใบ', '50 ทวิ คืออะไร ช่วยออกให้ด้วย', 'ช่วยออก 50 ทวิแล้วอธิบายว่าคืออะไร'])
    assert.equal(scopePolicyOverride(question, 'read', [], ['expenses'], 'th')?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED', question);
});

import { LINE_CAPABILITY_GROUPS, LINE_CHAT_ACTIONS, parseLineReimbursementDraftProposalV1 } from '@watchdog-bms/contracts';
import { productHelpAction } from './approved-product-help';
import { completeReimbursementDraftInput } from './reimbursement-draft-input';
import { readFileSync } from 'node:fs';
const fx17bRoutes = JSON.parse(readFileSync(require.resolve('../../../../../../docs/evidence/mangmee-advisor-fx17b-router-replays.json'), 'utf8')) as Array<{
  journey: string; turn: number; messageText: string; route: { semanticSubrequests: NonNullable<LineAiTurnRequest['semanticSubrequests']> };
}>;

describe('Fix-up 17B: uncovered how-to answers select a checked action in the existing answer call', () => {
  const recordedActions: Record<string, string> = { payment_voucher: 'C04', wht_certificate: 'C05', pnd53: 'C06', counterparty: 'C07', package_purchase: 'C10', payout_account: 'C11' };
  for (const action of LINE_CHAT_ACTIONS) for (const access of ['allowed', 'permission-denied', 'feature-denied'] as const) {
    it(`${action.group}/${action.id}/${access} without an approved help card or router action ID`, async () => {
      const recorded = fx17bRoutes.find(row => row.journey === recordedActions[action.id] && row.turn === 0);
      const messageText = recorded?.messageText ?? `${action.title}ทำยังไง`;
      const req = makeReq(messageText);
      req.semanticSubrequests = recorded?.route.semanticSubrequests ?? [{ index: 0, kind: 'help', goal: messageText, requiredEvidence: [], requestedFilters: {}, evidenceRefs: [], dependsOn: [] }];
      req.userContext.permissions = ['ai.tool.invoke', ...(access === 'permission-denied' ? [] : [action.permission, ...(action.id === 'approvals' ? ['reimbursement.read'] : [])])];
      req.entitledFeatureKeys = access === 'feature-denied' ? [] : [...LINE_CAPABILITY_GROUPS.flatMap(group => [...group.featureKeys]), 'expenses.upload'];
      req.userContext.entitledFeatureKeys = ['expenses']; // top-level entitlement is authoritative
      let calls = 0;
      const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: true, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
        provider: { generateText: async input => {
          calls++; assert.equal(input.usageTag, 'line.compose');
          assert.match(input.systemPrompt!, /helpActions/);
          const payload = JSON.parse(input.messages[0]!.text);
          assert.equal(payload.approvedHelp, undefined);
          assert.equal(payload.chatActions, undefined);
          assert.ok(input.systemPrompt!.includes(JSON.stringify({ id: action.id, title: action.title, group: action.group })));
          return { ok: true, text: JSON.stringify({ helpActions: [{ index: 0, actionId: action.id }] }) };
        } }, invoke: async () => assert.fail('help navigation never reads or mutates ERP') });
      // Feature-denied WHT is answered by the existing entitlement guard before composition.
      assert.equal(calls, 1);
      const allowed = access !== 'permission-denied' && (access !== 'feature-denied' || ['reimbursement_claim', 'payout_account', 'team_member', 'branch', 'branch_edit', 'package_purchase', 'approvals', 'team'].includes(action.id));
      assert.equal(result.semanticCoverage?.[0]?.status, allowed ? 'handled' : result.semanticCoverage?.[0]?.reasonCode === 'PACKAGE_FEATURE_NOT_ENABLED' ? 'unsupported' : 'denied');
      assert.doesNotMatch(result.replyText, /ยังไม่มีคู่มือ|ความสามารถปัจจุบัน|\n|^\d[.)]/);
      assert.match(result.replyText, /ค่ะ$/);
      if (allowed && 'webPath' in action) {
        assert.equal(result.presentation?.cards[0]?.chatActionId, undefined);
        assert.equal(result.presentation?.cards[0]?.webLink?.path, '/companies/company-1/reimbursements/payout-account');
      } else assert.equal(result.presentation?.cards[0]?.chatActionId, allowed ? action.id : undefined);
      if (!allowed) assert.match(result.replyText, /เจ้าของกิจการ|แพ็กเกจ|งานนี้ยังทำไม่ได้.*เมนูหลัก/);
      if (!allowed && access === 'feature-denied') assert.match(result.replyText, /แพ็กเกจ|งานนี้ยังทำไม่ได้.*เมนูหลัก/);
    });
  }
  it('C11 bank details continuing personal payout setup go straight to the web page without asking purpose', async () => {
    const recorded = fx17bRoutes.find(row => row.journey === 'C11' && row.turn === 1)!;
    const req = makeReq(recorded.messageText); req.semanticSubrequests = recorded.route.semanticSubrequests;
    req.userContext.permissions = ['reimbursement.create'];
    req.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [{ userMessage: 'เพิ่มบัญชีรับเงินคืนของฉันทำยังไง', replyPreview: 'เพิ่มบัญชีรับเงินคืนบนเว็บได้ค่ะ' } as any] };
    const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      provider: { generateText: async input => {
        assert.match(input.systemPrompt!, /never ask its purpose/);
        return { ok: true, text: JSON.stringify({ helpActions: [{ index: 0, actionId: 'payout_account' }] }) };
      } }, invoke: async () => assert.fail('bank details stay on the web') });
    assert.equal(result.replyText, 'เพิ่มบัญชีรับเงินคืนของคุณที่หน้าบัญชีรับเงินคืนบนเว็บได้เลยค่ะ');
    assert.match(result.presentation!.cards[0]!.webLink!.path, /reimbursements\/payout-account$/);
  });
});

describe('Fix-up 17B: real router inventories reach voucher, counterparty and 50 ทวิ previews after lookup', () => {
  for (const [journey, turn, readTool, previewTool, action, idField] of [
    ['C04', 1, 'expense.list_recent', 'expense.action.preview', 'VOUCHER_CREATE', 'expenseId'],
    ['C07', 3, 'counterparty.search', 'counterparty.action.preview', 'UPDATE', 'counterpartyId'],
    ['C05', 0, 'voucher.list_recent', 'expense.action.preview', 'WHT_CERTIFICATE_ISSUE', 'voucherId'],
  ] as const) for (const invalidId of [false, true]) it(`${journey}/${action}: read then preview, inventedId=${invalidId}`, async () => {
    const { runWithUsageContext } = await import('../../../common/usage/usage-context');
    const recorded = fx17bRoutes.find(row => row.journey === journey && row.turn === turn)!;
    const req = makeReq(journey === 'C05' ? 'ช่วยออก 50 ทวิให้หน่อย' : recorded.messageText);
    req.semanticSubrequests = journey === 'C05' ? [{ ...recorded.route.semanticSubrequests[0]!, kind: 'write', goal: 'ออก 50 ทวิ', evidenceRefs: [] }] : recorded.route.semanticSubrequests;
    req.userContext.permissions = ['ai.tool.invoke', 'expense.read', 'expense.disbursement.prepare', 'expense.disbursement.read', 'wht.certificate.issue', 'accounting.counterparty.read', 'accounting.counterparty.manage'];
    req.entitledFeatureKeys = ['expenses', 'wht_50bis']; req.userContext.entitledFeatureKeys = ['expenses'];
    const state: any = { status: 'active-v2', calls: 1, repairCount: 0, grant: { maxTurnSlots: 4 } };
    let round = 0; const invoked: any[] = [];
    const result = await runWithUsageContext({ budget: state }, () => runSemanticTurnV2({ req,
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async input => {
        state.calls++;
        if (input.usageTag === 'line.compose') return { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'needs_user', text: 'เลือกรายการค่ะ', question: 'เลือกรายการค่ะ' }] }) };
        const second = round++ > 0;
        if (second) assert.equal(JSON.parse(input.messages[0]!.text).previousToolResults[0].result.toolName, readTool);
        return { ok: true, text: JSON.stringify({ calls: [{ index: 0, toolName: second ? previewTool : readTool,
          input: second ? { action, [idField]: invalidId ? 'invented' : 'read-record', ...(action === 'UPDATE' ? { addressText: '101 ถนนงามวงศ์วาน ตำบลบางกระสอ อำเภอเมืองนนทบุรี นนทบุรี 11000' } : {}) } : {} }] }) };
      } }, invoke: async (meta, ctx, input) => {
        invoked.push({ name: meta.name, input }); assert.equal(ctx.companyId, 'company-1');
        return { toolName: meta.name, status: 'ok', asOf: new Date().toISOString(),
          data: meta.name === readTool ? { items: [{ id: 'read-record', displayName: 'บริษัท ผักสดดี จำกัด' }] } : { reply: 'ตรวจรายละเอียดแล้วกดยืนยันค่ะ', preview: { token: 'server-owned' } },
          sourceRefs: [{ module: 'expenses', entityType: 'record', label: 'รายการที่ตรวจสิทธิ์แล้ว', permissionChecked: true }] };
      } }));
    assert.equal(round, 2);
    assert.deepEqual(invoked.map(call => call.name), invalidId ? [readTool] : [readTool, previewTool]);
    if (!invalidId) { assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'CONFIRMATION_REQUIRED'); assert.equal(result.replyText, 'ตรวจรายละเอียดแล้วกดยืนยันค่ะ'); }
  });
  it('C06 เดือนนี้ uses the current deterministic month with no month question', async () => {
    const recorded = fx17bRoutes.find(row => row.journey === 'C06' && row.turn === 1)!;
    const req = makeReq(recorded.messageText); req.semanticSubrequests = recorded.route.semanticSubrequests;
    const built = (await createLineAiInputEvidence({ turnKey: 'fx17b-month', parts: [{ partId: 'part-0', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: req.messageText }] }))!;
    req.inputEvidence = built.inputEvidence; req.valueCandidates = (await extractValueCandidatesV2(built.inputEvidence, '2026-10-16'))!;
    req.userContext.permissions = ['wht.pnd53.read']; req.entitledFeatureKeys = ['wht_pnd53'];
    let calls = 0;
    const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async input => { assert.equal(input.usageTag, 'line.compose'); return { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'needs_user', text: 'เดือนไหนคะ', question: 'เดือนไหนคะ' }] }) }; } },
      invoke: async (meta, _ctx, input) => { calls++; assert.equal(meta.name, 'wht.get_month_summary'); assert.equal(input.periodKey, '2026-10');
        return { toolName: meta.name, status: 'ok', asOf: new Date().toISOString(), data: { message: 'สรุปภาษีหัก ณ ที่จ่ายเดือนตุลาคมค่ะ' }, sourceRefs: [{ module: 'tax', entityType: 'period', label: 'สรุปภาษี', permissionChecked: true }] }; } });
    assert.equal(calls, 1); assert.equal(result.replyText, 'สรุปภาษีหัก ณ ที่จ่ายเดือนตุลาคมค่ะ');
  });
});
describe('Fix-up 15: one-sentence how-to action bridge', () => {
  for (const action of LINE_CHAT_ACTIONS) for (const permitted of [true, false]) it(`${action.group}/${action.id}, permitted=${permitted}`, async () => {
    const request = { ...makeReq(`ทำ${action.title}ยังไง`), howToActionId: action.id,
      entitledFeatureKeys: [...LINE_CAPABILITY_GROUPS.flatMap(group => [...group.featureKeys]), 'expenses.upload'],
      userContext: { ...makeReq('').userContext, permissions: ['ai.tool.invoke', ...(permitted ? [action.permission, ...(action.id === 'approvals' ? ['reimbursement.read'] : [])] : [])] },
      semanticSubrequests: [{ index: 0, kind: 'help' as const, goal: action.title, requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: [] }] };
    const result = await runSemanticTurnV2({ req: request, provider: { generateText: async () => { throw new Error('help must not plan a mutation'); } },
      draftEditEnabled: true, reimbursementDraftEnabled: true, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      invoke: async () => { throw new Error('how-to offers navigation only'); } });
    assert.equal(result.replyText.split('\n').length, 1);
    assert.match(result.replyText, /ค่ะ$/);
    assert.equal(result.semanticCoverage?.[0]?.status, permitted ? 'handled' : 'denied');
    assert.equal(result.presentation?.cards[0]?.chatActionId, permitted && !('webPath' in action) ? action.id : undefined);
    if (!permitted) assert.match(result.replyText, /ไม่มีสิทธิ์.*เจ้าของกิจการ.*คุณ.*ได้ค่ะ/u);
  });
  it('bridges the exact J7 approved-help selection and preserves reviewed secondary links', async () => {
    const req = { ...makeReq('สร้างใบเบิกยังไง'), approvedKnowledge: true, selectedKnowledgeCardIds: ['reimbursement.meaning', 'reimbursement.roles'],
      userContext: { ...makeReq('').userContext, permissions: ['reimbursement.create', 'reimbursement.read_own'] },
      semanticSubrequests: [{ index: 0, kind: 'help' as const, goal: 'สร้างใบเบิก', requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: [] }] };
    const result = await runSemanticTurnV2({ req, provider: { generateText: async () => { throw new Error('no extra model call'); } },
      draftEditEnabled: false, reimbursementDraftEnabled: true, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      invoke: async () => { throw new Error('no financial tool'); } });
    assert.equal(result.replyText, productHelpAction({ selectedKnowledgeCardIds: req.selectedKnowledgeCardIds, permissions: req.userContext.permissions, featureKeys: null })!.replyText);
    assert.equal(result.presentation?.cards[0]?.chatActionId, 'reimbursement_claim');
    assert.ok(result.webLinks.some(link => link.path.includes('/user-guide/reimbursements')));
  });
  it('binds the J7 amount and yesterday to deterministic evidence, never model offsets', async () => {
    const text = 'เบิกค่าน้ำมัน 350 บาท เมื่อวาน ให้หน่อย';
    const built = await createLineAiInputEvidence({ turnKey: 'fx15', parts: [{ partId: 'p', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: text }] });
    assert.ok(built);
    const candidates = await extractValueCandidatesV2(built.inputEvidence, '2026-10-16'); assert.ok(candidates);
    const id = '018fbad0-4d4e-7cc7-8e43-0123456789ac';
    const req = { ...makeReq(text), inputEvidence: built.inputEvidence, valueCandidates: candidates };
    const next: any = completeReimbursementDraftInput('reimbursement.draft.preview_create', { action: {}, proposal: { fields: {},
      lineChanges: [{ operation: 'ADD', values: { description: 'ค่าน้ำมัน', amount: candidates.amounts[0]!.value, incurredDate: '2026-10-15' } }] } },
    [{ result: { toolName: 'reimbursement.draft.get_options', status: 'ok', sourceRefs: [], asOf: new Date().toISOString(),
      data: { actionLocator: { taskId: id, actionId: id, operation: 'CREATE' }, options: { taskRevision: 1 } } } }], req);
    const values = Object.fromEntries([...candidates.amounts.map(item => [item.candidateId, item.value]), ...candidates.dates.map(item => [item.candidateId, item.isoDate]), ...candidates.periods.filter(item => item.fromDate === item.toDate).map(item => [item.candidateId, item.fromDate])]);
    const sources = Object.fromEntries([...candidates.amounts, ...candidates.dates, ...candidates.periods].map(item => [item.candidateId, item.source]));
    assert.ok(parseLineReimbursementDraftProposalV1(next.proposal, { evidence: built.inputEvidence, candidateValues: values, candidateSources: sources }));
    assert.equal(next.proposal.lineChanges[0].values.amount.value, candidates.amounts[0]!.value);
    assert.equal(next.proposal.lineChanges[0].values.incurredDate.value, '2026-10-15');
  });
});

it('Fix-up 15: the existing two-round planner retains J7 text facts without requiring a stored bill', async () => {
  const { runWithUsageContext } = await import('../../../common/usage/usage-context');
  const text = 'เบิกค่าน้ำมัน 350 บาท เมื่อวาน ให้หน่อย';
  const evidence = (await createLineAiInputEvidence({ turnKey: 'fx15-planner', parts: [{ partId: 'p', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: text }] }))!.inputEvidence;
  const candidates = (await extractValueCandidatesV2(evidence, '2026-10-16'))!;
  const actionId = '018fbad0-4d4e-7cc7-8e43-0123456789ac';
  const req = { ...makeReq(text), inputEvidence: evidence, valueCandidates: candidates,
    userContext: { ...makeReq('').userContext, permissions: ['ai.tool.invoke', 'reimbursement.create'] },
    semanticSubrequests: [{ index: 0, kind: 'write' as const, writeIntent: 'REIMBURSEMENT_REQUEST_START' as const, goal: text, requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: [] }] };
  const calls: any[] = [];
  let round = 0;
  const state: any = { status: 'active-v2', calls: 0, repairCount: 0, grant: { maxTurnSlots: 4 } };
  const result = await runWithUsageContext({ budget: state }, () => runSemanticTurnV2({ req,
    draftEditEnabled: false, reimbursementDraftEnabled: true, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
    provider: { generateText: async input => {
      assert.equal(input.usageTag, 'line.loop'); state.calls++;
      assert.match(input.systemPrompt!, /Never require an existing bill/);
      return { ok: true, text: JSON.stringify({ calls: [round++ === 0
        ? { index: 0, toolName: 'reimbursement.draft.get_options', input: { operation: 'CREATE', subrequestIndex: 0 } }
        : { index: 0, toolName: 'reimbursement.draft.preview_create', input: { action: {}, proposal: { fields: {}, lineChanges: [{ operation: 'ADD', values: { description: 'ค่าน้ำมัน', amount: '350', incurredDate: '2026-10-15' } }] } } }], questions: [] }) };
    } }, invoke: async (meta, _ctx, input: any) => {
      calls.push({ name: meta.name, input });
      return { toolName: meta.name, status: 'ok', asOf: new Date().toISOString(), sourceRefs: [{ module: 'reimbursements', entityType: 'reimbursement_draft_action', entityId: actionId, label: 'ร่างใบเบิก', permissionChecked: true }],
        data: { actionLocator: { taskId: actionId, actionId, operation: 'CREATE' }, options: { taskRevision: 1, choices: [] }, reimbursementDraft: { status: 'needs_fields' } } };
    } }));
  assert.deepEqual(calls.map(call => call.name), ['reimbursement.draft.get_options', 'reimbursement.draft.preview_create']);
  assert.equal(calls[1]!.input.proposal.lineChanges[0].values.amount.value, '350');
  assert.equal(calls[1]!.input.proposal.lineChanges[0].values.incurredDate.value, '2026-10-15');
  assert.equal(result.semanticCoverage?.[0]?.status, 'needs_user');
  assert.doesNotMatch(result.replyText, /จากรายการด้านล่าง|1\)/);
});

it('Fix-up 17A C12: exact live settings-router JSON links approval settings and never prepares a claim approval', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../../../api/src/modules/line-ai/application/use-cases/fixtures/fx17a-live-routes.json'), 'utf8'));
  for (const live of fixture.C12) {
    let invoked = false;
    const req = makeReq(live.text); req.semanticSubrequests = live.route.semanticSubrequests;
    req.userContext.permissions = ['reimbursement.policy.manage', 'reimbursement.approve'];
    const agent = new OrchestratorAgent({ invoke: async () => { invoked = true; throw new Error('settings must not approve a claim'); } } as any, {} as any);
    const result = await agent.run(req);
    assert.equal(invoked, false); assert.match(result.replyText, /ตั้งค่าการอนุมัติ/); assert.doesNotMatch(result.replyText, /อนุมัติใบเบิกทำผ่าน LINE ไม่ได้/);
    assert.deepEqual(result.webLinks, [{ label: 'ตั้งค่าการอนุมัติ', path: '/companies/company-1/reimbursements?tab=policy' }]);
  }
});

const fx20bRoutes = JSON.parse(readFileSync(require.resolve('../../../../../../docs/evidence/mangmee-advisor-fx20b-router-replays.json'), 'utf8')) as any[];
describe('Fix-up 20B: real router help omissions recover inside the existing composer budget', () => {
  for (const [journey, actionId] of [['C04', 'payment_voucher'], ['C08', 'team_member'], ['C09', 'branch'], ['E05', 'branch_edit'], ['C11', 'payout_account']] as const) {
    it(`${journey}: exact router JSON without howToActionId resolves its permitted action`, async () => {
      const { runWithUsageContext } = await import('../../../common/usage/usage-context');
      const replay = fx20bRoutes.find(row => row.journey === journey && row.turn === 0)!;
      assert.equal(replay.route.howToActionId, undefined, 'the live defect is a missing selector, before permission lookup');
      const action = LINE_CHAT_ACTIONS.find(row => row.id === actionId)!;
      const state: any = { status: 'active-v2', calls: 1, repairCount: 0, grant: { maxTurnSlots: 4, maxRepairs: 1 } };
      const req = { ...makeReq(replay.messageText), semanticSubrequests: replay.route.semanticSubrequests,
        userContext: { ...makeReq('').userContext, permissions: ['ai.tool.invoke', action.permission], roles: [journey === 'C11' ? 'STAFF' : 'OWNER'] } };
      let calls = 0;
      const result = await runWithUsageContext({ budget: state }, () => runSemanticTurnV2({ req,
        draftEditEnabled: true, reimbursementDraftEnabled: true, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
        provider: { generateText: async input => {
          assert.equal(input.usageTag, 'line.compose'); state.calls++; calls++;
          assert.match(input.systemPrompt!, /"helpActions":\[/);
          if (calls === 2) assert.match(JSON.parse(input.messages[0]!.text).repair, /helpActions/);
          return { ok: true, text: JSON.stringify({ ...(calls === 2 ? { helpActions: [{ index: 0, actionId }] } : {}),
            answers: [{ index: 0, status: 'handled', text: 'ให้ผู้ดูแลบริษัทช่วยตรวจการตั้งค่าส่วนนี้บนเว็บได้ค่ะ', sourceRefIds: [] }] }) };
        } }, invoke: async () => assert.fail('help never executes a business mutation') }));
      assert.equal(calls, 2, 'one existing compose call plus its allowed repair');
      assert.equal(result.replyText, action.sentence); assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
      if ('webPath' in action) assert.equal(result.presentation?.cards[0]?.webLink?.path, '/companies/company-1/reimbursements/payout-account');
      else assert.equal(result.presentation?.cards[0]?.chatActionId, actionId);
    });
  }
  it('a definition can explicitly decline action selection without consuming a repair', async () => {
    const result = await runSemanticTurnV2({ req: { ...makeReq('ฉบับร่างคืออะไร'), semanticSubrequests: [{ index: 0, kind: 'help', goal: 'definition', requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: [] }] },
      draftEditEnabled: true, reimbursementDraftEnabled: true, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async () => ({ ok: true, text: JSON.stringify({ helpActions: [{ index: 0, actionId: null }], answers: [{ index: 0, status: 'unsupported', text: 'คำอธิบายค่ะ' }] }) }) }, invoke: async () => assert.fail('no reads') });
    assert.equal(result.presentation?.cards[0]?.chatActionId, undefined);
  });
});

describe('Fix-up 20B: every missing-router action × allowed/denied composer selection', () => {
  for (const action of LINE_CHAT_ACTIONS) for (const allowed of [true, false]) it(`${action.id}/allowed=${allowed}`, async () => {
    const req = { ...makeReq(`ทำ${action.title}ยังไง`),
      entitledFeatureKeys: [...LINE_CAPABILITY_GROUPS.flatMap(group => [...group.featureKeys]), 'expenses.upload'],
      userContext: { ...makeReq('').userContext, permissions: ['ai.tool.invoke', ...(allowed ? [action.permission, ...(action.id === 'approvals' ? ['reimbursement.read'] : [])] : [])] },
      semanticSubrequests: [{ index: 0, kind: 'help' as const, goal: action.title, requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: [] }] };
    const result = await runSemanticTurnV2({ req, draftEditEnabled: true, reimbursementDraftEnabled: true, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async () => ({ ok: true, text: JSON.stringify({ helpActions: [{ index: 0, actionId: action.id }] }) }) },
      invoke: async () => assert.fail('navigation never calls a mutation') });
    assert.equal(result.semanticCoverage?.[0]?.status, allowed ? 'handled' : result.semanticCoverage?.[0]?.reasonCode === 'PACKAGE_FEATURE_NOT_ENABLED' ? 'unsupported' : 'denied');
    assert.equal(result.presentation?.cards[0]?.chatActionId, allowed && !('webPath' in action) ? action.id : undefined);
    assert.equal(Boolean(result.presentation?.cards[0]?.webLink || result.webLinks.length), !allowed || 'webPath' in action);
    assert.equal(result.replyText.split('\n').length, 1);
  });
});

it('Fix-up 21A E03: split descriptions retain exact ordered source spans and invented/reordered words remain unproved', async () => {
  const text = 'เบิกค่าแท็กซี่ 350 บาท เมื่อวาน ไปส่งของให้ลูกค้า';
  const evidence = (await createLineAiInputEvidence({ turnKey: 'fx21-e03', parts: [{ partId: 'p', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: text }] }))!.inputEvidence;
  const id = '018fbad0-4d4e-7cc7-8e43-0123456789ac';
  const results: any = [{ result: { toolName: 'reimbursement.draft.get_options', status: 'ok', data: { actionLocator: { taskId: id, actionId: id, operation: 'CREATE' }, options: { taskRevision: 0 } } } }];
  const complete = (description: string) => completeReimbursementDraftInput('reimbursement.draft.preview_create', { action: {}, proposal: { fields: {}, lineChanges: [{ operation: 'ADD', values: { description } }] } }, results, { ...makeReq(text), inputEvidence: evidence }) as any;
  const valid = complete('ค่าแท็กซี่ ไปส่งของให้ลูกค้า');
  assert.equal(valid.proposal.lineChanges[0].values.description.value, 'ค่าแท็กซี่\nไปส่งของให้ลูกค้า');
  assert.equal(valid.proposal.lineChanges[0].values.description.proof.refs.length, 2);
  assert.ok(parseLineReimbursementDraftProposalV1(valid.proposal, { evidence }));
  for (const description of ['ไปส่งของให้ลูกค้า ค่าแท็กซี่', 'ค่าแท็กซี่ ไปเที่ยว', 'ค่าแท็กซี่ ค่าแท็กซี่']) {
    assert.equal(parseLineReimbursementDraftProposalV1(complete(description).proposal, { evidence }), undefined);
  }
});

describe('Fix-up 29: forbidden tools always name the permission owner without leaking results', () => {
  it('also handles an authoritative approval denial during the lookup phase of a permitted write', async () => {
    const req = { ...makeReq('ช่วยอนุมัติใบเบิกใบนี้ค่ะ'), userContext: { ...makeReq('').userContext, permissions: ['reimbursement.approve'] },
      semanticSubrequests: [{ index: 0, kind: 'write' as const, goal: 'อนุมัติใบเบิก', requestedFilters: {}, requiredEvidence: [], dependsOn: [], evidenceRefs: [] }] };
    const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async input => {
        assert.equal(input.usageTag, 'line.loop');
        return { ok: true, text: JSON.stringify({ calls: [{ index: 0, toolName: 'reimbursement.list_pending_approvals', input: {} }] }) };
      } }, invoke: async meta => ({ toolName: meta.name, status: 'forbidden', errorCode: 'REIMBURSEMENT_APPROVAL_NOT_PERMITTED',
        sourceRefs: [], asOf: new Date().toISOString() }) });
    assert.equal(result.semanticCoverage?.[0]?.status, 'denied');
    assert.match(result.replyText, /ไม่มีสิทธิ์.*เจ้าของกิจการ.*ผู้จัดการ/u);
    assert.doesNotMatch(result.replyText, /ดึงข้อมูลส่วนนี้ไม่ได้/u);
  });
  it('repairs only the ambiguous expense status and keeps explicit drafts, confirmed records and other tool enums', async () => {
    const { canonicalizeReadToolEnums } = await import('./read-tool-input');
    const expense = LINE_TOOL_REGISTRY.find(tool => tool.name === 'expense.list_recent')!;
    assert.equal(canonicalizeReadToolEnums(expense, { documentStatus: 'DRAFT' }, 'มีรายการที่ยังไม่ยืนยันบ้างป่าวครับ')?.documentStatus, 'NEEDS_REVIEW');
    assert.equal(canonicalizeReadToolEnums(expense, { documentStatus: 'CONFIRMED' }, 'ไม่เอาที่ยังไม่ยืนยัน เอาเฉพาะยืนยันแล้วค่ะ')?.documentStatus, 'CONFIRMED');
    assert.equal(canonicalizeReadToolEnums(expense, { documentStatus: 'DRAFT' }, 'มีร่างที่ยังไม่ยืนยันไหมคะ')?.documentStatus, 'DRAFT');
    assert.equal(canonicalizeReadToolEnums({ inputEnumValues: { documentStatus: ['DRAFT', 'SUBMITTED'] } }, { documentStatus: 'DRAFT' }, 'ยังไม่ยืนยัน')?.documentStatus, 'DRAFT');
  });
  for (const [status, errorCode] of [['forbidden', undefined], ['forbidden', 'FORBIDDEN'], ['error', 'TOOL_INPUT_NOT_AUTHORIZED']] as const) {
    it(`${status}/${errorCode ?? 'no code'} in semantic and prepared reads`, async () => {
      const question = 'ดูค่าใช้จ่ายเดือนนี้ค่ะ';
      const req = { ...makeReq(question), semanticSubrequests: [{ index: 0, kind: 'read' as const, goal: question,
        requestedFilters: {}, requiredEvidence: [], dependsOn: [], evidenceRefs: [], toolHint: 'expense.list_recent' }],
        userContext: { ...makeReq(question).userContext, permissions: ['expense.read'] } };
      const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
        provider: { generateText: async () => assert.fail('a forbidden read cannot be composed into a business answer') },
        invoke: async meta => ({ toolName: meta.name, status, errorCode, asOf: new Date().toISOString(), sourceRefs: [], data: { private: 'secret-record', total: 987654321 } }) });
      assert.equal(result.semanticCoverage?.[0]?.status, 'denied');
      assert.match(result.replyText, /ไม่มีสิทธิ์.*เจ้าของกิจการ.*คุณ.*ได้ค่ะ/u);
      assert.doesNotMatch(result.replyText, /ดึงข้อมูลไม่ได้|secret-record|987654321/u);
      assert.deepEqual(result.sourceRefs, []);
      const { preparedTerminalReply } = await import('./prepared-simple-read-formatter');
      const prepared = preparedTerminalReply({ agent: 'accounting', status: status === 'forbidden' ? 'PERMISSION_DENIED' : 'FAILED',
        facts: [], suggestions: [], requiresHumanReview: false, summary: '', toolCalls: [{ name: 'expense.list_recent', status, errorCode, durationMs: 0 }] },
        { messageText: question, language: 'th', locale: 'th-TH' });
      assert.match(prepared, /ไม่มีสิทธิ์.*เจ้าของกิจการ/u);
    });
  }
  it('never sends a breakdown counterparty id to expense.get_detail, even when the planner repeats it', async () => {
    const req = { ...makeReq('ดูรายละเอียดค่ะ'), userContext: { ...makeReq('').userContext, permissions: ['expense.read'] },
      semanticSubrequests: [{ index: 0, kind: 'read' as const, goal: 'รายละเอียด', requestedFilters: {}, requiredEvidence: [], dependsOn: [], evidenceRefs: [] }],
      conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: [], recentReads: [{ tool: 'expense.get_breakdown', answerShape: 'list' as const,
        asOf: new Date().toISOString(), shownItems: [{ ordinal: 1, id: 'counterparty-id', label: 'ร้านสมใจ', kind: 'vendor' as const }] }] } };
    const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async () => ({ ok: true, text: JSON.stringify({ calls: [{ index: 0, toolName: 'expense.get_detail', input: { expenseId: 'counterparty-id' } }] }) }) },
      invoke: async () => assert.fail('a group id is not an expense reference') });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
    assert.equal(result.semanticCoverage?.[0]?.status, 'unsupported');
    assert.doesNotMatch(result.replyText, /ไม่มีสิทธิ์/u);
    assert.match(result.replyText, /ลองส่งข้อความเดิมอีกครั้งค่ะ/u);
  });
});


// Lane C verifies the real registry/catalog rather than the exam's role/package assumptions.
import { ROLE_GRANTS } from '../../../../../api/src/modules/auth/permission-registry';
import { BILLING_PAID_TIERS, billingOffer, TIER_FEATURE_PRESETS, LINE_RECEIPT_CAPTURE_PERMISSIONS, toolFeatureKeys } from '@watchdog-bms/contracts';
import { ADVISOR_TAX_GUIDANCE, ADVISOR_CONVERSATION_GUIDANCE } from './advisor-domain-guidance';

const examCReplays = JSON.parse(readFileSync(require.resolve('../../../../../../docs/evidence/advisor-exam-c-router-replays.json'), 'utf8')) as Array<{
  id: string; role: string; intent: string; tier: typeof BILLING_PAID_TIERS[number]; messageText: string;
  semanticSubrequests: NonNullable<LineAiTurnRequest['semanticSubrequests']>; howToActionId?: LineAiTurnRequest['howToActionId'];
}>;

describe('Exam C1: canonical role × every chat action', () => {
  for (const role of ['OWNER', 'MANAGER', 'FINANCE', 'ACCOUNTANT', 'STAFF', 'AUDITOR_READONLY']) for (const action of LINE_CHAT_ACTIONS) {
    it(`${role}/${action.id} offers only a permitted action, otherwise names the owner and links permitted work`, () => {
      const permissions = ROLE_GRANTS[role]!;
      const tool = LINE_TOOL_REGISTRY.find(tool => tool.name === action.tool);
      const mayUseTool = !tool || tool.requiredPermissions.every(key => permissions.includes(key))
        && (!tool.anyOfPermissions?.length || tool.anyOfPermissions.some(key => permissions.includes(key)));
      const expected = action.id === 'expense_capture' ? LINE_RECEIPT_CAPTURE_PERMISSIONS.some(key => permissions.includes(key))
        : (action.id === 'expense_search' || permissions.includes(action.permission)) && mayUseTool;
      const result = productHelpAction({ actionId: action.id, permissions, featureKeys: null, companyId: 'shop' })!;
      assert.equal(result.allowed, expected);
      assert.equal(result.presentation.cards[0]?.chatActionId, expected && !('webPath' in action) ? action.id : undefined);
      assert.doesNotMatch(result.replyText, /\n|^\d+[.)]|บันทึกแล้ว|อนุมัติแล้ว/u);
      if (!expected) {
        assert.match(result.replyText, /ไม่มีสิทธิ์.*เจ้าของกิจการ.*คุณ.*ได้ค่ะ$/u);
        assert.ok(ROLE_GRANTS.OWNER!.includes(action.permission), 'the named owner really holds the operation permission');
        const alternate = permissionAlternative(permissions, 'th');
        assert.ok(result.presentation.cards[0]?.webLink?.path.includes(alternate.page === 'packages' ? '/billing' : `/${alternate.page}`));
      }
    });
  }
  it('staff may read own expenses and the existing use-case decides ownership when deleting a draft', () => {
    const permissions = ROLE_GRANTS.STAFF!;
    assert.ok(permissions.includes('expense.read_own'));
    assert.equal(scopePolicyOverride('ดูรายจ่ายของฉันหน่อย', 'read', permissions, [...TIER_FEATURE_PRESETS.STARTER_249], 'th', 'expense.list_recent'), undefined);
    assert.equal(scopePolicyOverride('ช่วยลบร่างค่าใช้จ่ายของฉัน', 'write', permissions, [...TIER_FEATURE_PRESETS.STARTER_249], 'th'), undefined);
  });
});

describe('Exam C2/C3: every sold pack × feature, from the real billing catalog', () => {
  for (const tier of BILLING_PAID_TIERS) for (const [feature, question, hint] of [
    ['wht_50bis', 'ขอออก 50 ทวิให้ผู้รับเงิน', 'expense.action.preview'],
    ['wht_pnd53', 'ภ.ง.ด.3 เดือนนี้มียอดเท่าไหร่', 'wht.get_month_summary'],
    ['inventory', 'ดูสินค้าคงเหลือ', 'inventory.list_low_stock'],
    ['procurement', 'ขอใบสั่งซื้อของเดือนก่อน', 'procurement.get_summary'],
    ['double_entry_ledger', 'ขอดูบัญชีแยกประเภท', 'ledger.get_financial_summary'],
    ['crm', 'มี CRM ให้ใช้ไหม', 'crm.search_customers'],
    ['reports', 'ขอรายงานกำไรขาดทุน', 'ledger.get_financial_summary'],
  ] as const) it(`${tier}/${feature}`, () => {
    const pack = billingOffer(tier, 'month');
    const override = scopePolicyOverride(question, 'read', ROLE_GRANTS.OWNER!, pack.featureKeys, 'th', hint, testPaidTiers.map(tier => testBillingOffer(tier, 'month')));
    if (pack.featureKeys.includes(feature)) assert.equal(override, undefined);
    else {
      assert.equal(override?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
      const containing = BILLING_PAID_TIERS.map(tier => billingOffer(tier, 'month')).find(offer => offer.featureKeys.includes(feature));
      if (containing) {
        assert.ok(override!.text.includes(containing.label.replace(/ \(.+\)$/u, '')));
        assert.ok(override!.text.includes((containing.priceSatang / 100).toLocaleString('en-US')));
        assert.equal(override!.webPage, 'packages');
        assert.doesNotMatch(override!.text, /ไม่มีสิทธิ์/u);
      } else {
        assert.match(override!.text, /งานนี้ยังทำไม่ได้.*เมนูหลัก.*งานที่ใช้ได้/u);
        assert.doesNotMatch(override!.text, /บาท|อัปเกรด|เร็ว.*นี้|บนเว็บ/u);
      }
    }
  });
  it('definitions are available to every pack and role', () => {
    for (const tier of BILLING_PAID_TIERS) for (const role of ['OWNER', 'STAFF', 'AUDITOR_READONLY']) for (const text of [
      'ภ.ง.ด.3 ต่างกันกับ ภ.ง.ด.53 อย่างไร', 'What is a 50 Tawi certificate?', 'VAT คืออะไร', 'ใบรับรองแทนใบเสร็จใช้ตอนไหน',
      'ช่วยอธิบายหลักการหัก ณ ที่จ่ายให้หน่อยค่ะ', 'Please explain the purpose of a 50 Tawi certificate',
    ]) assert.equal(scopePolicyOverride(text, 'help', ROLE_GRANTS[role]!, [...TIER_FEATURE_PRESETS[tier]], 'th'), undefined, `${tier}/${role}/${text}`);
  });
});

describe('Exam C: independent exam router conversation replays', () => {
  const actions: Record<string, string> = { 'H036-A': 'payment_voucher', 'H038-A': 'counterparty', 'H040-A': 'team_member', 'H054-A': 'package_purchase' };
  for (const replay of examCReplays) it(`${replay.id}/${replay.intent}`, async () => {
    const req = makeReq(replay.messageText);
    req.semanticSubrequests = structuredClone(replay.semanticSubrequests);
    // Same original spans; only the new turn's server evidence hashes change.
    const evidence = (await createLineAiInputEvidence({ turnKey: `exam-c-${replay.id}`, parts: [{ partId: 'part-0', rawText: replay.messageText, eventIdHash: 'c'.repeat(64), acceptedAtMs: Date.now() }] }))!.inputEvidence;
    req.inputEvidence = evidence;
    for (const item of req.semanticSubrequests) for (const ref of item.evidenceRefs ?? []) ref.rawSha256 = evidence.parts[0]!.rawSha256;
    req.userContext.permissions = ROLE_GRANTS[replay.role]!;
    req.userContext.roles = [replay.role];
    req.entitledFeatureKeys = [...TIER_FEATURE_PRESETS[replay.tier]];
    req.howToActionId = replay.howToActionId;
    let modelCalls = 0;
    const result = await runSemanticTurnV2({ req, draftEditEnabled: true, reimbursementDraftEnabled: true, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      provider: { generateText: async input => {
        modelCalls++; assert.equal(input.usageTag, 'line.compose');
        const payload = JSON.parse(input.messages[0]!.text);
        assert.equal(payload.conversationGuidance, undefined);
        assert.ok(input.systemPrompt!.includes(JSON.stringify(ADVISOR_CONVERSATION_GUIDANCE)));
        if (replay.id === 'V055-A') {
          const prefix = JSON.parse(input.systemPrompt!.split('\n').at(-1)!);
          assert.equal(payload.taxGuidance, undefined);
          assert.equal(prefix.taxGuidance, ADVISOR_TAX_GUIDANCE);
          assert.match(prefix.taxGuidance, /interest and dividends belong to ภ.ง.ด.2.*NOT PND3/);
        }
        const text = replay.id === 'V055-A' ? 'ดอกเบี้ยที่จ่ายให้บุคคลธรรมดาใช้ ภ.ง.ด.2 ให้ผู้ทำบัญชีจัดทำแยกค่ะ'
          : replay.id === 'C013-A' ? 'ยิ้มด้วยเลยค่ะ ถ้ามีรายจ่ายหรือใบเบิกให้น้องช่วยก็บอกได้เลยค่ะ'
            : 'น้องช่วยเรื่องรายจ่ายหรือใบเบิกต่อได้ค่ะ';
        return { ok: true, text: JSON.stringify({ helpActions: actions[replay.id] ? [{ index: 0, actionId: actions[replay.id] }] : [],
          answers: [{ index: 0, status: 'handled', text, topic: replay.intent === 'chitchat' ? 'social' : replay.intent === 'out_of_scope' ? 'other' : 'business' }] }) };
      } }, invoke: async () => assert.fail('a limit, how-to or conceptual reply must not read/mutate ERP') });
    assert.doesNotMatch(result.replyText, /ยังไม่มีคู่มือ|ข้อความของคุณ|^\d+[.)]|บันทึกแล้ว|อนุมัติแล้ว/u);
    if (replay.intent === 'permission') {
      assert.match(result.replyText, /[ก-๙]/u.test(replay.messageText) ? /ไม่มีสิทธิ์.*เจ้าของกิจการ.*คุณ.*ได้ค่ะ/u : /cannot.*shop owner.*you can/); assert.ok(result.webLinks.length);
    } else if (replay.intent === 'package_limit') {
      assert.match(result.replyText, /ธุรกิจ.*1,999.*บาท/u); assert.ok(result.webLinks.some(link => link.path.includes('/billing')));
    } else if (replay.intent === 'unsold') {
      assert.match(result.replyText, /งานนี้ยังทำไม่ได้.*เมนูหลัก/u); assert.doesNotMatch(result.replyText, /อัปเกรด/u);
    } else if (actions[replay.id]) {
      assert.equal(result.presentation?.cards[0]?.chatActionId, actions[replay.id]); assert.equal(modelCalls, 1);
    } else if (replay.id === 'V055-A') {
      assert.match(result.replyText, /ภ.ง.ด.2.*จัดทำแยก/); assert.equal(modelCalls, 1);
    } else if (replay.intent === 'chitchat') {
      assert.doesNotMatch(result.replyText, /555|\n|ไหม|มั้ย/u); assert.equal(modelCalls, 1);
    }
  });
});

it('Exam C4: tax guidance agrees with active service categories and the later exceptional-income correction', () => {
  const read = (name: string) => readFileSync(require.resolve(`../../../../../api/prisma/migrations/${name}/migration.sql`), 'utf8');
  const original = read('20261004120000_open_wht_income_categories');
  for (const [code, form, rate] of [['WHT_SERVICE_3', 'PND3', '3'], ['WHT_SERVICE_5', 'PND53', '3'], ['WHT_RENT_IND', 'PND3', '5'], ['WHT_TRANSPORT_IND', 'PND3', '1']]) {
    assert.match(original.split('\n').find(line => line.includes(`'${code}'`))!, new RegExp(`'${form}', ${rate}\\.0000, 'ACTIVE'`));
  }
  const corrected = read('20261013120100_wht_income_routes_catalog');
  for (const code of ['WHT_INTEREST', 'WHT_DIVIDEND_IND']) assert.match(corrected.split('\n').find(line => line.includes(`'${code}'`))!, /'PND2', 'SEPARATE_PND2'.*'DRAFT'/);
  assert.match(ADVISOR_TAX_GUIDANCE, /PAYEE, not the payer/);
  assert.match(ADVISOR_TAX_GUIDANCE, /base BEFORE VAT/);
  assert.match(ADVISOR_TAX_GUIDANCE, /does NOT submit e-filing/);
  assert.match(ADVISOR_TAX_GUIDANCE, /WEB only/);
});

it('Exam C2/C4: a polite explanation cannot become action help even when both model selectors propose an action', async () => {
  const req = makeReq('ช่วยอธิบายว่า 50 ทวิใช้ทำอะไรให้หน่อยค่ะ');
  req.howToActionId = 'wht_certificate';
  req.entitledFeatureKeys = [...TIER_FEATURE_PRESETS.STARTER_249];
  req.userContext.permissions = ROLE_GRANTS.OWNER!;
  req.semanticSubrequests = [{ index: 0, kind: 'help', goal: 'explain withholding certificate purpose', requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: [] }];
  let calls = 0;
  const result = await runSemanticTurnV2({ req, draftEditEnabled: true, reimbursementDraftEnabled: true, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
    provider: { generateText: async () => { calls++; return { ok: true, text: JSON.stringify({ helpActions: [{ index: 0, actionId: 'wht_certificate' }],
      answers: [{ index: 0, status: 'handled', text: '50 ทวิรับรองยอดที่จ่ายและภาษีที่หักไว้ให้ผู้รับเงินใช้เป็นหลักฐานค่ะ' }] }) }; } },
    invoke: async () => assert.fail('a concept must not invoke ERP or start an action') });
  assert.equal(calls, 1);
  assert.match(result.replyText, /หนังสือรับรอง 50 ทวิ.*ยอดที่จ่ายและภาษีที่หักไว้/u);
  assert.match(result.replyText, /ธุรกิจ.*1,999/u);
  assert.equal(result.presentation?.cards[0]?.chatActionId, undefined);
  assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
});


describe('Owner 2026-10-17: differently worded pending-claim reads stay reads for every shop role', () => {
  for (const role of ['OWNER', 'MANAGER', 'FINANCE', 'ACCOUNTANT', 'STAFF', 'AUDITOR_READONLY']) {
    for (const messageText of [
      'ช่วยเช็กใบเบิกที่ค้างอนุมัติให้ทีค่ะ', 'ขอดูใบเบิกที่รอการอนุมัติหน่อย',
      'ช่วยสรุปใบเบิกที่ยังไม่ได้อนุมัติให้หน่อยค่ะ', 'ใบเบิกที่ยังไม่ถูกอนุมัติมีอะไรบ้าง',
      'ช่วยดูใบเบิกที่รอผู้อนุมัติคนไหนอยู่ค่ะ', 'สรุปใบเบิกที่ค้างอยู่แยกตามผู้อนุมัติหน่อย',
      'ใบเบิกของร้านรออนุมัติกี่ใบ', 'ใบเบิกที่รออนุมัติอยู่ที่ใครคะ',
    ]) it(`${role}: ${messageText}`, async () => {
      const permissions = ROLE_GRANTS[role]!;
      const req = makeReq(messageText);
      req.userContext.permissions = permissions;
      req.userContext.roles = [role];
      req.semanticSubrequests = [{ index: 0, kind: 'read', goal: messageText, requiredEvidence: [], requestedFilters: {}, evidenceRefs: [], dependsOn: [] }];
      let reads = 0;
      const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
        provider: { generateText: async input => ({ ok: true, text: JSON.stringify(input.usageTag === 'line.loop'
          ? { calls: [{ index: 0, toolName: 'reimbursement.list_pending_approvals', input: {} }] }
          : { answers: [{ index: 0, status: 'handled', text: 'มีใบเบิกของร้านรอคุณอนุมัติ 1 ใบค่ะ', sourceRefIds: ['pending'] }] }) }) },
        invoke: async meta => { reads++;
          return { toolName: meta.name, status: 'ok', asOf: '2026-10-17T03:00:00.000Z',
            sourceRefs: [{ id: 'pending', module: 'reimbursements', entityType: 'requests', label: 'ใบเบิกที่รออนุมัติ', permissionChecked: true }],
            data: { accessScope: permissions.includes('reimbursement.read') ? 'company' : permissions.includes('reimbursement.read_related') ? 'related' : 'own', total: 1,
              items: [{ id: 'claim', requesterDisplayName: 'สมหญิง', amount: '100.00', currency: 'THB', waitingOn: 'สมศรี' }] } };
        },
      });
      assert.equal(reads, 1);
      assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
      assert.doesNotMatch(result.replyText, /ไม่มีสิทธิ์ดู|รอคุณอนุมัติ/);
    });
  }
});

it('Exam D2: each expense and claim operation overrides a broad create guide with its own help button', async () => {
  const examples = [
    ['อนุมัติใบเบิกของพนักงานทำยังไง', 'approvals'], ['ไม่อนุมัติใบเบิกทำยังไง', 'reimbursement_reject'],
    ['จ่ายคืนใบเบิกทำยังไง', 'reimbursement_pay'], ['ส่งใบเบิกอนุมัติทำยังไง', 'reimbursement_submit'],
    ['ยกเลิกใบเบิกทำยังไง', 'reimbursement_cancel'], ['ส่งตรวจค่าใช้จ่ายทำยังไง', 'expense_submit'],
    ['ยืนยันค่าใช้จ่ายทำยังไง', 'expense_confirm'], ['ลบร่างค่าใช้จ่ายทำยังไง', 'expense_delete'],
    ['ยกเลิกค่าใช้จ่ายทำยังไง', 'expense_void'], ['บันทึกจ่ายค่าใช้จ่ายทำยังไง', 'expense_pay'],
  ] as const;
  for (const [messageText, actionId] of examples) {
    const action = LINE_CHAT_ACTIONS.find(row => row.id === actionId)!;
    const req = { ...makeReq(messageText), howToActionId: 'reimbursement_claim' as const,
      selectedKnowledgeCardIds: ['reimbursement.meaning', 'reimbursement.roles'],
      userContext: { ...makeReq('').userContext, permissions: [action.permission, 'reimbursement.read_own'] },
      entitledFeatureKeys: ['expenses', 'reimbursement'],
      semanticSubrequests: [{ index: 0, kind: 'help' as const, goal: messageText, requiredEvidence: [], requestedFilters: {}, evidenceRefs: [], dependsOn: [] }] };
    const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: true, publicLookupEnabled: false,
      approvedKnowledgeEnabled: true, provider: { generateText: async () => assert.fail('the existing action guide needs no further model call') },
      invoke: async () => assert.fail('a guide cannot execute an action') });
    assert.equal(result.presentation?.cards[0]?.chatActionId, actionId, messageText);
    assert.equal(result.replyText, action.sentence);
  }
});

for (const role of ['STAFF', 'MANAGER', 'ACCOUNTANT']) for (const [text, actionId] of [
  ['สร้างใบเบิกยังไง', 'reimbursement_claim'],
  ['ช่วยสร้างใบเบิกค่าใช้จ่ายทำยังไง', 'reimbursement_claim'],
  ['ส่งใบเบิกอนุมัติทำยังไง', 'reimbursement_submit'],
  ['ช่วยส่งใบเบิกอนุมัติทำยังไง', 'reimbursement_submit'],
  ['ยกเลิกใบเบิกทำยังไง', 'reimbursement_cancel'],
  ['อนุมัติใบเบิกทำยังไง', 'approvals'],
  ['ไม่อนุมัติใบเบิกทำยังไง', 'reimbursement_reject'],
  ['จ่ายคืนใบเบิกทำยังไง', 'reimbursement_pay'],
] as const) it(`Exam E2a: ${role} ${actionId} help follows the user's verb despite a wrong approval hint`, async () => {
  const action = LINE_CHAT_ACTIONS.find(row => row.id === actionId)!;
  const req = { ...makeReq(text), howToActionId: 'approvals' as const,
    selectedKnowledgeCardIds: ['reimbursement.meaning'],
    userContext: { ...makeReq('').userContext, permissions: ROLE_GRANTS[role]! },
    entitledFeatureKeys: ['expenses', 'reimbursement'],
    semanticSubrequests: [{ index: 0, kind: 'help' as const, goal: text, toolHint: 'reimbursement.list_pending_approvals',
      requiredEvidence: [], requestedFilters: {}, evidenceRefs: [], dependsOn: [] }] };
  const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: true,
    publicLookupEnabled: false, approvedKnowledgeEnabled: true,
    provider: { generateText: async () => assert.fail('existing how-to guide needs no extra model call') },
    invoke: async () => assert.fail('help never executes an operation') });
  if (ROLE_GRANTS[role]!.includes(action.permission)) {
    assert.equal(result.presentation?.cards[0]?.chatActionId, actionId, result.replyText);
    assert.equal(result.replyText, action.sentence);
    assert.doesNotMatch(result.replyText, /ไม่มีสิทธิ์/);
  } else {
    assert.match(result.replyText, new RegExp(`ไม่มีสิทธิ์${actionId === 'reimbursement_reject' ? '(?:ปฏิเสธ|ไม่อนุมัติ)ใบเบิก' : action.title}`));
    assert.ok(!result.presentation?.cards.some(card => card.chatActionId));
  }
});

it('Exam E2a: multiple how-to answers cannot replace create/submit with the composer approval selection', async () => {
  const texts = ['สร้างใบเบิกยังไง', 'ส่งใบเบิกอนุมัติทำยังไง'];
  const messageText = texts.join('\n');
  const built = (await createLineAiInputEvidence({ turnKey: 'exam-e-help', parts: [{ partId: 'p', eventIdHash: 'a'.repeat(64),
    acceptedAtMs: Date.now(), rawText: messageText }] }))!.inputEvidence;
  const req = { ...makeReq(messageText), inputEvidence: built,
    userContext: { ...makeReq('').userContext, permissions: ROLE_GRANTS.STAFF! }, entitledFeatureKeys: ['expenses', 'reimbursement'],
    semanticSubrequests: texts.map((text, index) => ({ index, kind: 'help' as const, goal: text, toolHint: 'reimbursement.list_pending_approvals',
      requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: [{ partId: 'p', rawSha256: built.parts[0]!.rawSha256,
        startUtf16: messageText.indexOf(text), endUtf16: messageText.indexOf(text) + text.length }] })) };
  const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: true,
    publicLookupEnabled: false, approvedKnowledgeEnabled: true,
    provider: { generateText: async () => ({ ok: true, text: JSON.stringify({ helpActions: texts.map((_text, index) => ({ index, actionId: 'approvals' })) }) }) },
    invoke: async () => assert.fail('how-to cannot execute an operation') });
  assert.deepEqual(result.presentation?.cards.map(card => card.chatActionId), ['reimbursement_claim', 'reimbursement_submit']);
  assert.doesNotMatch(result.replyText, /ไม่มีสิทธิ์/);
});


describe('U2/U3/U4 exact-input advisor corrections in the semantic turn', () => {
  async function answer(text: string, kind: 'help' | 'general' | 'read', features: string[], permissions: string[]) {
    const req = makeReq(text); req.entitledFeatureKeys = features; req.userContext.permissions = permissions;
    req.semanticSubrequests = [{ index: 0, kind, goal: text, dependsOn: [], requiredEvidence: [], evidenceRefs: [], requestedFilters: {} }];
    return runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      provider: { generateText: async () => ({ ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'หากต้องการออก 50 ทวิ ทำได้เลยนะคะ', sourceRefIds: [] }] }) }) },
      invoke: async () => assert.fail('these product facts must never read shop records') });
  }
  it('U2 definition cannot repeat a model offer outside Starter entitlement', async () => {
    const result = await answer('แล้วทวิ 50 คืออะไร', 'general', ['expenses'], ['expense.read', 'wht.external_certificate.link']);
    assert.match(result.replyText, /จดเลขที่ใบ 50 ทวิ ที่ทำนอกระบบ.*เว็บ/);
    assert.match(result.replyText, /ออกหนังสือรับรองในระบบ.*ธุรกิจ 1,999 บาท/);
    assert.doesNotMatch(result.replyText, /ทำได้เลย|ENTERPRISE/);
  });
  for (const text of ['แล้วทำอะไรได้บ้าง', 'ทำไรได้บ้าง', 'what can you do?', 'what can u do', 'help', 'features']) it(`U3 ${text}`, async () => {
    const result = await answer(text, 'help', ['expenses', 'ai_line_assistant', 'reimbursement'], ['ai.tool.invoke', 'expense.read', 'expense.create', 'expense.receipt.line_upload', 'reimbursement.create']);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.doesNotMatch(result.replyText, /ไม่มีคู่มือ|50 ทวิ|ENTERPRISE|—/);
    assert.ok(result.presentation?.cards[0]?.chatActionIds?.includes('expense_search'));
    assert.ok(!result.presentation?.cards[0]?.chatActionIds?.includes('wht_certificate'));
  });
  for (const text of ['ถ้าหมดแพ็กเกจแล้วเป็นยังไงต่อ', 'แพ็กเกจหมดอายุแล้วจะเกิดอะไรขึ้น', 'what happens when my package expires?']) it(`U4 ${text}`, async () => {
    const result = await answer(text, 'read', ['expenses'], ['line.ai.query']);
    assert.match(result.replyText, /พักใช้งาน|paused/); assert.match(result.replyText, /ข้อมูลเดิมยังอยู่|records are kept/);
    assert.ok(result.webLinks.some(link => link.path.endsWith('/billing?channel=line')));
    assert.doesNotMatch(result.replyText, /ไม่มีรายละเอียด|8 of 90|8 จาก 90/);
  });
  it('U4 receipt allowance exhausted still permits manual entry during the active period', async () => {
    const result = await answer('ถ้าใช้โควตาใบเสร็จหมดแล้วจะเป็นยังไง', 'read', ['expenses'], ['line.ai.query']);
    assert.match(result.replyText, /หยุดอ่านใบใหม่.*แพ็กเกจยังไม่หมดอายุ.*กรอกรายจ่ายเอง/);
    assert.doesNotMatch(result.replyText, /พักใช้งาน/);
  });
});


it('U2 exact follow-up ทำได้เลยหรอ inherits the document topic, then checks current entitlement and permission', async () => {
  for (const entitled of [false, true]) {
    const req = makeReq('ทำได้เลยหรอ'); req.entitledFeatureKeys = entitled ? ['expenses', 'wht_50bis'] : ['expenses'];
    req.userContext.permissions = ['wht.certificate.issue', 'ai.tool.invoke', 'expense.read', 'wht.external_certificate.link'];
    req.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [{ at: new Date().toISOString(), userMessagePreview: 'แล้วทวิ 50 คืออะไร',
      assistantReplyPreview: 'หากต้องการออก 50 ทวิ สำหรับค่าใช้จ่ายในระบบ ทำได้เลยนะคะ' }] };
    req.semanticSubrequests = [{ index: 0, kind: 'general', goal: req.messageText, requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: [] }];
    const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      provider: { generateText: async () => assert.fail('the existing metered intake already resolved the follow-up; reuse the checked action facts') }, invoke: async () => assert.fail('no financial mutation from a capability question') });
    if (!entitled) { assert.match(result.replyText, /จดเลขที่ใบ 50 ทวิ ที่ทำนอกระบบ.*ธุรกิจ 1,999 บาท/); assert.equal(result.presentation?.cards[0]?.chatActionId, undefined); }
    else { assert.match(result.replyText, /ตรวจชื่อ.*ที่อยู่.*กดยืนยัน/); assert.equal(result.presentation?.cards[0]?.chatActionId, 'wht_certificate'); }
    assert.doesNotMatch(result.replyText, /ENTERPRISE|—/);
  }
});


it('U3 capability buttons cover a permitted specialist and a caller with no available actions', async () => {
  for (const specialist of [false, true]) {
    const req = makeReq('แล้วทำอะไรได้บ้าง'); req.entitledFeatureKeys = specialist ? ['inventory', 'product_catalog'] : [];
    req.userContext.permissions = specialist ? ['ai.tool.invoke', 'inventory.product.read', 'inventory.report.read'] : [];
    req.semanticSubrequests = [{ index: 0, kind: 'help', goal: req.messageText, requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: [] }];
    const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      provider: { generateText: async () => assert.fail('existing capability facts need no additional compose call') }, invoke: async () => assert.fail('no record read for capabilities') });
    if (specialist) assert.ok(result.presentation?.cards[0]?.chatActionIds?.includes('inventory'));
    else { assert.match(result.replyText, /ยังไม่มีงาน.*เจ้าของกิจการ/); assert.ok(result.presentation?.cards[0]?.webLink); assert.deepEqual(result.presentation?.cards[0]?.chatActionIds, []); }
  }
});

it('credit X2: semantic cached prefix is identical across tenants while the last four user turns remain per-turn', async () => {
  const captured: ProviderInput[] = [];
  for (const companyId of ['credit-company-a', 'credit-company-b']) {
    const req = makeReq('ทำไมท้องฟ้าถึงเป็นสีฟ้า');
    req.userContext.companyId = companyId;
    req.semanticSubrequests = [{ index: 0, kind: 'general', goal: req.messageText, requiredEvidence: [], requestedFilters: {}, dependsOn: [] }];
    req.conversationContext = { windowMinutes: 15, maxTurns: 15,
      recentTurns: Array.from({ length: 15 }, (_, n) => ({ at: new Date(1792397000000 + n * 1000).toISOString(),
        userMessagePreview: `${companyId} ข้อความ ${n}`, userMessagePreviewComplete: true })) };
    await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async input => { captured.push(input);
        return { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'แสงสีฟ้ากระเจิงในอากาศค่ะ', sourceRefIds: [] }] }) }; } },
      invoke: async () => assert.fail('general question needs no ERP') });
    assert.equal(req.conversationContext.recentTurns.length, 15, 'source context remains complete');
  }
  assert.equal(captured.length, 2);
  assert.equal(captured[0]!.systemPrompt, captured[1]!.systemPrompt);
  assert.ok(captured[0]!.systemPrompt!.length >= 4000, 'the actual Bedrock system-prefix cache checkpoint applies');
  for (const input of captured) {
    assert.equal(input.systemPrompt!.includes('credit-company-'), false);
    assert.ok(input.systemPrompt!.includes('"chatActions":'));
    const payload = JSON.parse(input.messages[0]!.text);
    assert.equal(payload.chatActions, undefined);
    assert.equal(payload.conversationContext.recentTurns.length, 4);
    assert.equal(payload.conversationContext.recentTurns[0].userMessagePreview.endsWith('11'), true);
  }
});


describe('PWS-PND53-DUE selected help card', () => {
  for (const access of ['allowed', 'permission-denied', 'feature-denied', 'free-drafts'] as const) it(`answers the date or preserves the refusal without a model call: ${access}`, async () => {
    const req = { ...makeReq('ภงด.53 ต้องยื่นเมื่อไหร่'), approvedKnowledge: true, selectedKnowledgeCardIds: ['wht.pnd53-due'],
      semanticSubrequests: [{ index: 0, kind: 'help' as const, goal: 'ภงด.53 ต้องยื่นเมื่อไหร่', requiredEvidence: [], requestedFilters: {}, evidenceRefs: [], dependsOn: [] }] };
    req.userContext.permissions = access === 'permission-denied' ? ['ai.tool.invoke', 'wht.certificate.read'] : access === 'free-drafts' ? ['expense.read_own'] : ['ai.tool.invoke', 'wht.pnd53.read'];
    req.entitledFeatureKeys = access === 'feature-denied' ? ['wht_50bis'] : access === 'free-drafts' ? ['expenses'] : ['wht_pnd53'];
    const expected = productHelpAction({ selectedKnowledgeCardIds: req.selectedKnowledgeCardIds, permissions: req.userContext.permissions,
      featureKeys: req.entitledFeatureKeys, companyId: req.userContext.companyId, packageOffers: req.packageOffers })!;
    const message = 'ภ.ง.ด.53 ของเดือนตุลาคม 2569 ต้องยื่นภายใน 9 พ.ย. 2569 ค่ะ';
    let reads = 0;
    const result = await runSemanticTurnV2({ req, approvedKnowledgeEnabled: true, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false,
      provider: { generateText: async () => assert.fail('selected due-date card needs no model call') },
      invoke: async (meta, ctx, args) => {
        reads++; assert.equal(meta.name, 'wht.get_month_summary'); assert.deepEqual(args, { dueDateOnly: true });
        assert.equal(ctx.companyId, req.userContext.companyId); assert.equal(ctx.groundingText, req.messageText);
        return { toolName: meta.name, status: 'ok', asOf: '2026-11-04T00:00:00Z', data: { periodKey: '2026-10', dueDate: '2026-11-09', message },
          sourceRefs: [{ module: 'tax', entityType: 'advisor_document_read', label: 'ภ.ง.ด.53', permissionChecked: true, webPath: '/companies/company-1/tax/pnd53' }] };
      } });
    assert.equal(reads, access === 'allowed' ? 1 : 0);
    const override = scopePolicyOverride(req.messageText, 'help', req.userContext.permissions, req.entitledFeatureKeys, 'th', undefined, req.packageOffers);
    assert.equal(result.replyText, access === 'allowed' ? message : override?.text ?? expected.replyText);
    if (override) assert.ok(result.webLinks.length, 'the unchanged scope refusal retains its way out');
    else {
      assert.equal(result.presentation?.cards[0]?.text, result.replyText);
      if (access !== 'allowed') assert.deepEqual(result.presentation, expected.presentation);
      else assert.equal(result.sourceRefs[0]?.permissionChecked, true);
    }
  });
});


it('PWS-PND53-DUE legacy help route reads the date without adding a composition call', async () => {
  const req = { ...makeReq('ภงด.53 ต้องยื่นเมื่อไหร่'), approvedKnowledge: true, selectedKnowledgeCardIds: ['wht.pnd53-due'], entitledFeatureKeys: ['wht_pnd53'] };
  req.userContext.permissions = ['wht.pnd53.read'];
  let modelCalls = 0, reads = 0;
  globalThis.fetch = async () => {
    modelCalls++; assert.equal(modelCalls, 1, 'only the existing route selection call');
    return jsonMockResponse({ ok: true, json: async () => ({ status: 'completed', output_text: JSON.stringify({
      status: 'ROUTABLE', language: 'th', selectedKnowledgeCardIds: ['wht.pnd53-due'], refusals: [], requiresHumanReview: false,
      intents: [{ intent: 'capability_help', subject: 'unknown', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }],
    }) }) });
  };
  const message = 'ภ.ง.ด.53 ของเดือนตุลาคม 2569 ต้องยื่นภายใน 7 พ.ย. 2569 ค่ะ';
  const result = await new OrchestratorAgent({ invoke: async (meta: any, ctx: any, args: any) => {
    reads++; assert.equal(meta.name, 'wht.get_month_summary'); assert.deepEqual(args, { dueDateOnly: true });
    assert.equal(ctx.groundingText, req.messageText);
    return { toolName: meta.name, status: 'ok', asOf: '2026-11-04T00:00:00Z', data: { message },
      sourceRefs: [{ module: 'tax', entityType: 'advisor_document_read', label: 'ภ.ง.ด.53', permissionChecked: true }] };
  } } as any, makeConfig()).run(req);
  assert.equal(modelCalls, 1); assert.equal(reads, 1); assert.equal(result.replyText, message);
  assert.equal(result.presentation?.cards[0]?.text, message); assert.equal(result.sourceRefs[0]?.permissionChecked, true);
});

for (const outcome of ['forbidden', 'unsupported_module', 'unavailable', 'throw'] as const) it(`PWS-PND53-DUE rechecks ERP access and gives a way out when the date read fails: ${outcome}`, async () => {
  const req = { ...makeReq('ภงด.53 ต้องยื่นเมื่อไหร่'), approvedKnowledge: true, selectedKnowledgeCardIds: ['wht.pnd53-due'], entitledFeatureKeys: ['wht_pnd53'],
    semanticSubrequests: [{ index: 0, kind: 'help' as const, goal: 'ภงด.53 ต้องยื่นเมื่อไหร่', requiredEvidence: [], requestedFilters: {}, evidenceRefs: [], dependsOn: [] }] };
  req.userContext.permissions = ['wht.pnd53.read'];
  const result = await runSemanticTurnV2({ req, approvedKnowledgeEnabled: true, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false,
    provider: { generateText: async () => assert.fail('no model retry') },
    invoke: async meta => {
      if (outcome === 'throw') throw new Error('offline');
      return { toolName: meta.name, status: outcome, asOf: '2026-11-04T00:00:00Z', sourceRefs: [] };
    } });
  assert.doesNotMatch(result.replyText, /ต้องยื่นภายใน|2569|2026/);
  assert.match(result.replyText, /ไม่มีสิทธิ์|แพ็กเกจ|ลองอีกครั้ง/);
  const card = result.presentation?.cards[0];
  assert.ok(card?.webLink || card?.chatActionId, 'the refusal or retry retains an action');
});


it('PWS-PND53-DUE English selected card keeps the language and single-use delegation path', async () => {
  const text = 'when is PND53 for October 2026 due?';
  const req = { ...makeReq(text), approvedKnowledge: true, selectedKnowledgeCardIds: ['wht.pnd53-due'], entitledFeatureKeys: ['wht_pnd53'],
    actorDelegations: { 'wht.get_month_summary': ['single-use-pnd53'] },
    semanticSubrequests: [{ index: 0, kind: 'help' as const, goal: text, requiredEvidence: [], requestedFilters: {}, evidenceRefs: [], dependsOn: [] }] };
  req.userContext.permissions = ['ai.tool.invoke', 'wht.pnd53.read'];
  const message = 'PND53 for October 2026 is due by 7 Nov 2026.';
  const result = await runSemanticTurnV2({ req, approvedKnowledgeEnabled: true, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false,
    provider: { generateText: async () => assert.fail('no model translation call') },
    invoke: async (meta, ctx, args) => {
      assert.equal(meta.name, 'wht.get_month_summary'); assert.deepEqual(args, { dueDateOnly: true });
      assert.equal(ctx.locale, 'en-GB'); assert.equal(ctx.groundingText, text); assert.equal(ctx.actorDelegations, req.actorDelegations);
      return { toolName: meta.name, status: 'ok', asOf: '2026-11-04T00:00:00Z', data: { message },
        sourceRefs: [{ module: 'tax', entityType: 'advisor_document_read', label: 'PND53', permissionChecked: true }] };
    } });
  assert.equal(result.replyText, message); assert.equal(result.presentation?.cards[0]?.text, message);
});

// Q4 keeps reviewed explanations separate from the action the reader may choose next.
describe('PWS-LINE-HELP-ANSWER Q4', () => {
  const card = (id: string) => require('./approved-product-help').activeProductHelpPack().cards.find((c: any) => c.id === id)!;
  const permissions = [...new Set(['ai.tool.invoke', 'company.plan.manage', 'reimbursement.approve', ...LINE_TOOL_REGISTRY.flatMap(t => [...t.requiredPermissions, ...(t.anyOfPermissions ?? [])]), ...LINE_CHAT_ACTIONS.map(a => a.permission)])];
  const features = ['expenses', 'expenses.upload', 'reimbursement', 'reports', 'dashboard_notifications', 'wht_pnd53', 'wht_50bis', ...LINE_CAPABILITY_GROUPS.flatMap(g => [...g.featureKeys])];
  function request(id: string, text = card(id).questions[0]) {
    const req = { ...makeReq(text), approvedKnowledge: true, selectedKnowledgeCardIds: [id], entitledFeatureKeys: features,
      semanticSubrequests: [{ index: 0, kind: 'help' as const, goal: text, requiredEvidence: [], requestedFilters: {}, evidenceRefs: [], dependsOn: [] }] };
    req.userContext.permissions = permissions;
    return req;
  }
  const run = (req: LineAiTurnRequest, invoke: any = async () => assert.fail('general help does not read ERP')) => runSemanticTurnV2({ req,
    draftEditEnabled: true, reimbursementDraftEnabled: true, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
    provider: { generateText: async () => assert.fail('selected help needs no model call') }, invoke });
  for (const [id, actionId, questions] of [
    ['reimbursement.meaning', 'reimbursement_claim', ['ใบเบิกคืออะไร', 'คำขอเบิกกับใบเบิกต่างกันยังไง', 'ฉันสำรองเงินเองแล้วต้องใช้เมนูไหน']],
    ['reimbursement.roles', 'reimbursement_claim', ['ทำไมเห็นแท็บเบิกจ่ายไม่เหมือนกัน', 'เพื่อนเห็นแท็บแต่ฉันไม่เห็น', 'หาเมนูเบิกจ่ายไม่เจอ']],
    ['report.access', 'finance', ['รายงานที่แต่ละคนเรียกดูได้', 'ทำไมฉันเห็นรายงานน้อยกว่าเจ้าของ', 'ส่งออกแล้วตรวจสิทธิ์อีกไหม']],
    ['expense.start', 'expense_capture', ['เริ่มลงค่าใช้จ่ายยังไง', 'รายจ่ายเข้าระบบแล้วทำอะไรต่อ']],
    ['expense.find', 'expense_search', ['หาบิลร้านเดิมยังไง', 'ดูรายการตามสถานะที่ไหน']],
  ] as const) {
    for (const question of questions) it(`table A ${id}: ${question}`, async () => {
      const result = await run(request(id, question));
      assert.ok(result.replyText.includes(card(id).body));
      assert.equal(result.presentation?.cards[0]?.text, card(id).body);
      assert.equal(result.presentation?.cards[0]?.chatActionId, actionId);
      assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    });
    for (const text of [LINE_CHAT_ACTIONS.find(a => a.id === actionId)!.command, `ช่วย${LINE_CHAT_ACTIONS.find(a => a.id === actionId)!.title}ให้หน่อย`])
      it(`table A do-request ${id}: ${text}`, async () => {
        const result = await run(request(id, text));
        assert.equal(result.replyText, LINE_CHAT_ACTIONS.find(a => a.id === actionId)!.sentence);
        assert.equal(result.presentation?.cards[0]?.chatActionId, actionId);
      });
  }
  const fixtures: Record<string, { tool: string; args: object; data: object; zero: object; permission: string; feature?: string; sentence: RegExp; empty: RegExp }> = {
    'package.quota': { tool: 'billing.get_package_usage', args: {}, permission: 'company.plan.manage',
      data: { package: { termEndsOn: '2026-12-31' }, receipts: { limit: 30, remaining: 12, resetsOn: '2026-12-01' } },
      zero: { package: { termEndsOn: '2026-12-31' }, receipts: { limit: 30, remaining: 0, resetsOn: '2026-12-01' } }, sentence: /เหลือ.*12.*1 ธ.ค. 2569/, empty: /เหลือ.*0.*1 ธ.ค. 2569/ },
    'package.renew': { tool: 'billing.get_package_usage', args: {}, permission: 'company.plan.manage', data: { package: { termEndsOn: '2026-12-31' } }, zero: { package: { termEndsOn: null } }, sentence: /31 ธ.ค. 2569/, empty: /ยังไม่มีแพ็กเกจ/ },
    'package.expiry': { tool: 'billing.get_package_usage', args: {}, permission: 'company.plan.manage', data: { package: { termEndsOn: '2026-12-31' } }, zero: { package: { termEndsOn: null } }, sentence: /31 ธ.ค. 2569/, empty: /ยังไม่มีแพ็กเกจ/ },
    'claim.approve': { tool: 'reimbursement.list_pending_approvals', args: { approver: 'me' }, permission: 'reimbursement.approve', feature: 'reimbursement', data: { accessScope: 'approver', total: 3 }, zero: { accessScope: 'approver', total: 0 }, sentence: /มีใบเบิกรอคุณอนุมัติ 3 ใบค่ะ/, empty: /ไม่มีใบเบิกรอคุณอนุมัติค่ะ/ },
    'voucher.approve': { tool: '', args: {}, permission: 'expense.disbursement.approve', feature: 'expenses', data: {}, zero: {}, sentence: /ผู้อนุมัติเปิดใบที่รอตนเอง/, empty: /ผู้อนุมัติเปิดใบที่รอตนเอง/ },
    'notifications.read': { tool: 'notifications.list_open_alerts', args: {}, permission: 'notification.read', feature: 'dashboard_notifications', data: { count: 3, hasMore: false }, zero: { count: 0, hasMore: false }, sentence: /3 รายการค่ะ/, empty: /ไม่มี.*แจ้งเตือน.*ค่ะ/ },
    'pnd53.prepare': { tool: 'wht.get_month_summary', args: { periodKey: '2026-11' }, permission: 'wht.pnd53.read', feature: 'wht_pnd53', data: { periodKey: '2026-11', dueDate: '2026-12-07', remittance: { status: 'OPEN' } }, zero: { periodKey: '2026-11', dueDate: '2026-12-07', remittance: null }, sentence: /ภ.ง.ด.53.*พฤศจิกายน 2569.*ยังไม่ได้ยื่น.*7 ธ.ค. 2569/, empty: /ยังไม่มีรายการ.*7 ธ.ค. 2569/ },
  };
  for (const [id, fixture] of Object.entries(fixtures)) for (const access of ['data', 'zero', 'no-permission', 'no-feature', 'unavailable'] as const)
    it(`table B ${id}, ${access}`, async t => {
      t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 4) });
      const req = request(id);
      if (access === 'no-permission') req.userContext.permissions = permissions.filter(p => p !== fixture.permission);
      if (access === 'no-feature') req.entitledFeatureKeys = [];
      let reads = 0;
      const result = await run(req, async (meta: any, ctx: any, args: any) => {
        reads++; assert.equal(meta.name, fixture.tool); assert.equal(ctx.userId, req.userContext.internalUserId); assert.deepEqual(args, fixture.args);
        return { toolName: meta.name, status: access === 'unavailable' ? 'unavailable' : 'ok', asOf: '2026-11-04T00:00:00Z',
          data: access === 'zero' ? fixture.zero : fixture.data, sourceRefs: [{ module: 'help', entityType: 'read', label: 'ข้อมูลของร้าน', permissionChecked: true }] };
      });
      const knowledge = require('./approved-knowledge');
      const eligible = knowledge.eligibleKnowledgeCards(require('./approved-product-help').activeProductHelpPack(),
        knowledge.productKnowledgeAccess(req.userContext.permissions, req.entitledFeatureKeys, true, 'th')).some((candidate: any) => candidate.id === id);
      const readable = eligible && !!fixture.tool && access !== 'no-permission' && !(access === 'no-feature' && fixture.feature);
      assert.equal(reads, readable ? 1 : 0);
      if (!eligible) {
        assert.match(result.replyText, /สิทธิ์|แพ็กเกจ/);
        assert.ok(result.webLinks.length || result.presentation?.cards.some(card => card.webLink), 'ineligible card retains its way out');
        assert.ok(!result.replyText.includes(card(id).body));
      } else if (!readable || access === 'unavailable') assert.ok(result.replyText.includes(card(id).body));
      else {
        assert.match(result.replyText, access === 'zero' ? fixture.empty : fixture.sentence);
        if (id === 'package.renew' || id === 'package.expiry') assert.ok(result.replyText.includes(card(id).body), 'date then the card rule');
      }
      if (eligible) assert.equal(result.semanticCoverage?.[0]?.status, 'handled', 'an eligible card answers when its figures cannot be read');
      else assert.notEqual(result.semanticCoverage?.[0]?.status, 'handled', 'card eligibility remains enforced');
    });
  it('does not turn a company claim count or a malformed result into the reader approval queue', async () => {
    const result = await run(request('claim.approve'), async (meta: any) => ({ toolName: meta.name, status: 'ok', asOf: '2026-11-04T00:00:00Z', data: { accessScope: 'company', total: 23 }, sourceRefs: [] }));
    assert.ok(result.replyText.includes(card('claim.approve').body)); assert.doesNotMatch(result.replyText, /23/);
  });
  it('states a lower bound for a notification page with more results', async () => {
    const req = request('notifications.read');
    const result = await run(req, async (meta: any) => ({ toolName: meta.name, status: 'ok', asOf: '2026-11-04T00:00:00Z', data: { count: 10, hasMore: true },
      sourceRefs: Array.from({ length: 10 }, (_, i) => ({ module: 'notifications', entityType: 'notice', entityId: `notice-${i}`, label: 'แจ้งเตือน', permissionChecked: true })) }));
    assert.match(result.replyText, /อย่างน้อย 10 รายการ/);
    assert.ok(require('@watchdog-bms/contracts').parseLineAiSemanticCoverage(result.semanticCoverage, req.semanticSubrequests));
  });
  for (const [data, expected] of [
    [{ package: { termEndsOn: '2026-12-31' }, receipts: { limit: null, remaining: null, resetsOn: null } }, /ไม่จำกัดจำนวน/],
    [{ package: { termEndsOn: '2026-12-31' }, receipts: { limit: 30, remaining: 7, resetsOn: null } }, /เหลือ.*7.*ยังไม่มีวันเริ่มนับใหม่/],
    [{ package: { termEndsOn: null }, receipts: { limit: 0, remaining: 0, resetsOn: null } }, /ยังไม่มีแพ็กเกจ/],
  ] as const) it(`quota handles its actual allowance shape: ${JSON.stringify(data)}`, async () => {
    const result = await run(request('package.quota'), async (meta: any) => ({ toolName: meta.name, status: 'ok', asOf: '2026-11-04T00:00:00Z', data, sourceRefs: [] }));
    assert.match(result.replyText, expected);
  });
  for (const [id, fixture] of Object.entries(fixtures)) it(`table B English data sentence uses tool facts: ${id}`, t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 4) });
    const { helpDataSentence } = require('./document-advisor-read');
    for (const data of [fixture.data, fixture.zero]) {
      const sentence = helpDataSentence(id, data, 'en');
      if (id === 'voucher.approve') assert.equal(sentence, undefined, 'the tool has no reader queue filter');
      else { assert.ok(sentence); assert.doesNotMatch(sentence, /[\u0E00-\u0E7F]/); }
    }
  });
});


it('PWS-LINE-HELP-ANSWER combines quota and renewal from one permission-checked snapshot', async () => {
  const req = { ...makeReq('ใช้สิทธิ์ไปกี่ใบ ต่ออายุยังไง'), approvedKnowledge: true, selectedKnowledgeCardIds: ['package.quota', 'package.renew'],
    semanticSubrequests: [{ index: 0, kind: 'help' as const, goal: 'แพ็กเกจของร้าน', requiredEvidence: [], requestedFilters: {}, evidenceRefs: [], dependsOn: [] }] };
  req.userContext.permissions = ['ai.tool.invoke', 'company.plan.manage'];
  let calls = 0;
  const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
    provider: { generateText: async () => assert.fail('no extra model call') }, invoke: async meta => {
      calls++; return { toolName: meta.name, status: 'ok', asOf: '2026-11-04T00:00:00Z', sourceRefs: [],
        data: { package: { termEndsOn: '2026-12-31' }, receipts: { remaining: 12, limit: 30, resetsOn: '2026-12-01' } } };
    } });
  assert.equal(calls, 1); assert.match(result.replyText, /เหลือใบเสร็จ 12 ใบ/); assert.match(result.replyText, /31 ธ.ค. 2569/);
  assert.equal(new Set(result.semanticCoverage?.[0]?.sourceRefIds).size, result.semanticCoverage?.[0]?.sourceRefIds?.length);
});

for (const language of ['th', 'en'] as const) it(`PWS-LINE-HELP-ANSWER expiry states remain factual in ${language}`, async () => {
  const req = { ...makeReq(language === 'th' ? 'ต่ออายุยังไง' : 'renew a package'), approvedKnowledge: true, selectedKnowledgeCardIds: ['package.renew'],
    semanticSubrequests: [{ index: 0, kind: 'help' as const, goal: 'package renewal', requiredEvidence: [], requestedFilters: {}, evidenceRefs: [], dependsOn: [] }] };
  req.userContext.permissions = ['ai.tool.invoke', 'company.plan.manage'];
  if (language === 'en') {
    assert.match(require('./document-advisor-read').helpDataSentence('package.renew', { package: { termEndsOn: '2026-09-30' } }, 'en'), /package end date is 30 Sept 2026/);
    return;
  }
  const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
    provider: { generateText: async () => assert.fail('no model call') }, invoke: async meta => ({ toolName: meta.name, status: 'ok', asOf: '2026-11-04T00:00:00Z',
      sourceRefs: [], data: { package: { termEndsOn: '2026-09-30' } } }) });
  assert.match(result.replyText, language === 'th' ? /วันสิ้นสุดแพ็กเกจของร้านคือ 30 ก.ย. 2569/ : /package end date is 30 Sept 2026/);
});

for (const id of ['package.quota', 'package.renew', 'package.expiry', 'claim.approve', 'voucher.approve', 'notifications.read', 'pnd53.prepare'])
  it(`PWS-LINE-HELP-ANSWER a free-source-draft permission snapshot cannot read ${id}`, async () => {
    const card = require('./approved-product-help').activeProductHelpPack().cards.find((c: any) => c.id === id)!;
    const req = { ...makeReq(card.questions[0]), approvedKnowledge: true, selectedKnowledgeCardIds: [id], entitledFeatureKeys: ['expenses'],
      semanticSubrequests: [{ index: 0, kind: 'help' as const, goal: card.title, requiredEvidence: [], requestedFilters: {}, evidenceRefs: [], dependsOn: [] }] };
    req.userContext.permissions = ['company.plan.manage', 'expense.read_own', 'expense.receipt.line_upload'];
    const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      provider: { generateText: async () => assert.fail('no model call') }, invoke: async () => assert.fail('free snapshot must not read business figures') });
    const knowledge = require('./approved-knowledge');
    const eligible = knowledge.eligibleKnowledgeCards(require('./approved-product-help').activeProductHelpPack(),
      knowledge.productKnowledgeAccess(req.userContext.permissions, req.entitledFeatureKeys, true, 'th')).some((candidate: any) => candidate.id === id);
    if (eligible) assert.ok(result.replyText.includes(card.body));
    else { assert.match(result.replyText, /สิทธิ์|แพ็กเกจ/); assert.ok(!result.replyText.includes(card.body)); }
  });

it('PWS-LINE-HELP-ANSWER a malformed reset date keeps the general card', async () => {
  const req = { ...makeReq('ใช้สิทธิ์ไปกี่ใบ'), approvedKnowledge: true, selectedKnowledgeCardIds: ['package.quota'],
    semanticSubrequests: [{ index: 0, kind: 'help' as const, goal: 'ใบเสร็จที่เหลือ', requiredEvidence: [], requestedFilters: {}, evidenceRefs: [], dependsOn: [] }] };
  req.userContext.permissions = ['ai.tool.invoke', 'company.plan.manage'];
  const result = await runSemanticTurnV2({ req, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
    provider: { generateText: async () => assert.fail('no repair model call') }, invoke: async meta => ({ toolName: meta.name, status: 'ok', asOf: '2026-11-04T00:00:00Z',
      sourceRefs: [], data: { package: { termEndsOn: '2026-12-31' }, receipts: { limit: 30, remaining: 12, resetsOn: 'invalid-date' } } }) });
  assert.ok(result.replyText.includes(require('./approved-product-help').activeProductHelpPack().cards.find((c: any) => c.id === 'package.quota').body));
});


describe('PWS-LINE-HELP-ANSWER Q4 card eligibility', () => {
  const pack = () => require('./approved-product-help').activeProductHelpPack();
  function request(id: string, permissions: string[], features: string[]) {
    const card = pack().cards.find((card: any) => card.id === id)!;
    return { ...makeReq(card.questions[0]), approvedKnowledge: true, selectedKnowledgeCardIds: [id], entitledFeatureKeys: features,
      userContext: { ...makeReq('').userContext, permissions },
      semanticSubrequests: [{ index: 0, kind: 'help' as const, goal: card.title, requiredEvidence: [], requestedFilters: {}, evidenceRefs: [], dependsOn: [] }] };
  }
  const run = (req: LineAiTurnRequest) => runSemanticTurnV2({ req, draftEditEnabled: true, reimbursementDraftEnabled: true,
    publicLookupEnabled: false, approvedKnowledgeEnabled: true,
    provider: { generateText: async () => assert.fail('selected card eligibility is deterministic') },
    invoke: async () => assert.fail('ineligible cards and missing data permission never read ERP') });
  for (const id of ['wht.pnd53-due', 'pnd53.prepare']) it(`a lower-pack WHT question keeps the package-limit reply and way out: ${id}`, async () => {
    const result = await run(request(id, ['ai.tool.invoke', 'wht.pnd53.read'], ['expenses']));
    assert.match(result.replyText, /แพ็กเกจ/);
    assert.ok(result.webLinks.length || result.presentation?.cards.some(card => card.webLink));
    assert.doesNotMatch(result.replyText, /ต้องยื่นภายใน|เปิดงวด/);
  });
  it('staff outside the card permission keeps the existing refusal and way out', async () => {
    const req = request('reimbursement.meaning', ['ai.tool.invoke'], ['reimbursement']);
    const result = await run(req);
    const expected = require('../domain/logic/line-ai-scope-policy.logic').permissionLimitReplyText('th', 'สร้างใบเบิก', req.userContext.permissions);
    assert.equal(result.replyText, expected);
    assert.ok(result.webLinks.length || result.presentation?.cards.some(card => card.webLink));
  });
  it('an eligible quota card without package-data permission keeps its reviewed answer', async () => {
    const result = await run(request('package.quota', ['ai.tool.invoke'], []));
    const card = pack().cards.find((card: any) => card.id === 'package.quota')!;
    assert.ok(result.replyText.includes(card.body)); assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
  });
});
