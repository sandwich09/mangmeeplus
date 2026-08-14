import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswerPresentation, OrchestratorAgent, withoutRefusedCoverage } from './orchestrator.agent';
import { ResponseComposerAgent } from './response-composer.agent';
import type { LineAiTurnRequest } from '@watchdog-bms/contracts';

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
  if (/ภาษี|อากาศ/.test(messageText)) {
    return { status: 'UNROUTABLE', language: 'th', intents: [], refusals: [{ request: messageText, reason: 'unsupported_module' }], requiresHumanReview: false };
  }
  if (/พี่เอแอบคบ/.test(messageText)) {
    return {
      status: 'PARTIAL', language: 'th',
      intents: [{ intent: 'read_detail', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.get_breakdown'], missingContext: [] }],
      refusals: [{ request: 'เม้าท์ว่าพี่เอแอบคบใคร', reason: 'privacy_rumor' }], requiresHumanReview: false,
    };
  }
  if (/ทำอะไรได้บ้าง|ช่วยอะไรได้บ้าง/.test(messageText)) {
    return { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'capability_help', subject: 'unknown', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }], refusals: [], requiresHumanReview: false };
  }
  if (/^สวัสดี|^วันนี้เหนื่อย/.test(messageText) && !/ยอดขาย|รายได้|สต็อก|ค่าใช้จ่าย/.test(messageText)) {
    return { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'casual_conversation', subject: 'unknown', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }], refusals: [], requiresHumanReview: false };
  }
  if (/ค่าใช้จ่าย/.test(messageText)) {
    return { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_detail', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.list_recent'], missingContext: [] }], refusals: [], requiresHumanReview: false };
  }
  if (/ยอดขาย|รายได้/.test(messageText)) {
    return { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'report_request', subject: 'sale', agent: 'sales', priority: 1, requiredTools: ['sales.get_sales_summary'], missingContext: [] }], refusals: [], requiresHumanReview: false };
  }
  if (/สต็อก/.test(messageText)) {
    return { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_detail', subject: 'inventory', agent: 'inventory', priority: 1, requiredTools: ['inventory.list_low_stock'], missingContext: [] }], refusals: [], requiresHumanReview: false };
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
) {
  const sourceRef = { label, module: 'sales', entityType: 'summary', permissionChecked: true as const, webPath: '/sales' };
  return {
    agent: 'sales' as const,
    status,
    summary: `${label}: ${value}`,
    facts: status === 'SUCCEEDED' ? [{ label, value, sourceRef }] : [],
    suggestions: [], toolCalls: [], requiresHumanReview: false,
    ...(status === 'SUCCEEDED' ? { toolData: [{ tool: 'sales.get_sales_summary', data }] } : {}),
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
    assert.match(result.replyText, /ยอดขาย/);
    assert.match(result.replyText, /ขึ้นกับสิทธิ์และฟีเจอร์/);
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

  it('expense query invokes expense read tool and preserves source-backed item names and amounts', async () => {
    const calledTools: string[] = [];
    const erpTools = {
      invoke: async (tool: any) => {
        calledTools.push(tool.name);
        return {
          toolName: tool.name,
          status: tool.name === 'expense.list_recent' ? 'ok' : 'unsupported_module',
          data: tool.name === 'expense.list_recent' ? {
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
    const req = makeReq('ดูค่าใช้จ่าย');
    req.userContext.permissions.push('expense.read');
    const orchestrator = new OrchestratorAgent(erpTools, makeConfig());
    const result = await orchestrator.run(req);
    assert.ok(calledTools.includes('expense.list_recent'));
    assert.ok(result.replyText.includes('11,875.00'));
    assert.ok(result.replyText.includes('ยอดทั้งหมด'));
    // Work in progress is the whole pending set, not drafts alone.
    assert.ok(result.replyText.includes('รอตรวจสอบ'));
    assert.ok(result.replyText.includes('ยืนยันแล้ว'));
    assert.ok(result.replyText.includes('จ่ายแล้ว'));
    assert.ok(result.replyText.includes('ยังไม่จ่าย'));
    assert.ok(result.replyText.includes('บริษัท โฟลว์แอคเคาท์ ทดสอบ จำกัด'));
    assert.ok(result.replyText.includes('11,875.00'));
    assert.ok(!result.replyText.includes('expense-draft-empty'));
    assert.deepEqual(result.webLinks, [{ label: 'รายการค่าใช้จ่าย', path: '/companies/company-1/expenses' }]);
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
    assert.equal(result.presentation?.kind, 'answer_cards');
    assert.equal(result.presentation?.cards[0]?.text, result.replyText);
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

  it('disabled provider says the assistant is temporarily unavailable, not that a feature is disabled', async () => {
    const orchestrator = new OrchestratorAgent(makeOkErpTools(), makeConfig({ modelProvider: 'disabled', openAiApiKey: undefined }));
    const result = await orchestrator.run(makeReq('ยอดขาย'));
    assert.equal(result.plan.status, 'UNROUTABLE');
    assert.ok(result.replyText.includes('ชั่วคราว'));
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
