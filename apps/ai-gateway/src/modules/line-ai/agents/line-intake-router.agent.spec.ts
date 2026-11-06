import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveIntakeToolNames, IntentRouterAgent, LINE_INTAKE_ROUTER_SYSTEM_PROMPT, intakeRouterSystemPrompt } from './intent-router.agent';
import { DisabledProvider } from '../infrastructure/provider/disabled.provider';
import { createLineAiInputEvidence, parseLineAiSemanticSubrequests, verifyLineAiRetainedTaskSource, type BusinessDocumentClassification, type LineIntakeRouteRequest } from '@watchdog-bms/contracts';
import type { ProviderInput } from '../infrastructure/provider/provider.port';
import { runWithUsageContext } from '../../../common/usage/usage-context';

const EXPENSE_LIST_PREPARED_FAMILY = 'expense.list_recent::single_metric';
const EXPENSE_LIST_PREPARED_FAMILIES = new Set([EXPENSE_LIST_PREPARED_FAMILY]);
const SALES_SUMMARY_PREPARED_FAMILY = 'sales.get_sales_summary::single_metric';

function baseRequest(overrides: Partial<LineIntakeRouteRequest> = {}): LineIntakeRouteRequest {
  return {
    requestId: 'req-1',
    companyId: 'company-1',
    userId: 'user-1',
    locale: 'th',
    messageText: '',
    permissions: ['ai.tool.invoke', 'expense.read', 'expense.receipt.line_upload', 'expense.signature.manage', 'line.ai.query'],
    enabledFeatures: ['expenses', 'expenses.list'],
    offeredToolNames: ['expense.list_recent'],
    activeCategories: [{ id: 'cat-travel', name: 'ค่าเดินทาง' }, { id: 'cat-meals', name: 'ค่าอาหาร' }],
    ...overrides,
  };
}

function modelAnswer(answer: unknown, capture?: { input?: ProviderInput }) {
  return {
    generateText: async (input: ProviderInput) => {
      if (capture) capture.input = input;
      return { ok: true as const, text: JSON.stringify(answer) };
    },
  };
}

function documentClassification(overrides: Partial<BusinessDocumentClassification> = {}): BusinessDocumentClassification {
  return {
    contentKind: 'DOCUMENT', documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'QUOTATION',
    businessDirection: 'CUSTOMER_INBOUND', transactionState: 'PROPOSED', evidenceRoles: ['COMMERCIAL_PROPOSAL'],
    confidence: 0.95, evidenceSignals: [], amountSignals: [], settlementSignals: [],
    missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
    ...overrides,
  };
}

describe('LINE intake router – routeIntake', () => {
  it('D3: a batched facts reply accepts absent document classification and a matching redundant clause index', async () => {
    const text = 'ผู้จ่าย บริษัท ผู้รับเงิน คุณเอ อินฟลู เหตุผล ผู้รับเงินไม่ออกใบเสร็จ วัตถุประสงค์ ค่าโปรโมทร้าน จ่ายโอน วันที่ 10 ต.ค. 2569';
    const built = (await createLineAiInputEvidence({ turnKey: 'fx8b-router', parts: [{ partId: 'part-0', eventIdHash: 'b'.repeat(64), acceptedAtMs: 1, rawText: text }] }))!;
    const request = baseRequest({ messageText: text, inputEvidence: built.inputEvidence, capabilities: { substituteSemantic: true },
      openClarifications: [{ id: 'question', question: 'ใครจ่ายและจ่ายเพื่ออะไรคะ', text: 'ทำใบรับรองแทนใบเสร็จ', askedAt: '2026-10-15T20:41:00Z', clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION' }] });
    const output = { intent: 'SUBSTITUTE_RECEIPT_CONTINUATION', language: 'th', confidence: 0.95, documentClassification: null,
      resolvedClarificationIds: ['question'], decisionV1: { subrequests: [{ index: 0, kind: 'write', goal: text,
        sources: [{ part: 0, whole: true }], filters: {}, writeIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION' }] } };
    const plan = await new IntentRouterAgent(modelAnswer(output)).routeIntake(request);
    assert.equal(plan.status, 'ROUTED'); assert.equal(plan.documentClassification, undefined);
    assert.equal(plan.semanticSubrequests?.[0]?.writeIntent, 'SUBSTITUTE_RECEIPT_CONTINUATION');
    assert.deepEqual(plan.resolvedClarificationIds, ['question']);
    assert.equal(plan.semanticSubrequests?.[0]?.evidenceRefs?.[0]?.endUtf16, text.length);
    for (const index of [1, '0']) {
      const wrong = structuredClone(output); (wrong.decisionV1.subrequests[0] as any).index = index;
      assert.equal((await new IntentRouterAgent(modelAnswer(wrong)).routeIntake(request)).status, 'UNAVAILABLE');
    }
  });
  it('X2: payment preview is a valid write clause without an invented writeIntent', async () => {
    const text = 'จ่ายแล้ว';
    const built = (await createLineAiInputEvidence({ turnKey: 'fx5-router-payment', parts: [{ partId: 'part-0', eventIdHash: 'a'.repeat(64), acceptedAtMs: 1, rawText: text }] }))!;
    const capture: { input?: ProviderInput } = {};
    const plan = await new IntentRouterAgent(modelAnswer({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.98,
      decisionV1: { subrequests: [{ kind: 'write', goal: text, sources: [{ part: 0, whole: true }], filters: {} }] } }, capture))
      .routeIntake(baseRequest({ messageText: text, inputEvidence: built.inputEvidence, offeredToolNames: ['expense.action.preview'],
        permissions: ['ai.tool.invoke', 'line.ai.query', 'expense.payment.record'] }));
    assert.equal(plan.status, 'ROUTED'); assert.equal(plan.intent, 'BUSINESS_READ_QUESTION');
    assert.equal(plan.semanticSubrequests?.[0]?.writeIntent, undefined);
    assert.ok(parseLineAiSemanticSubrequests(plan.semanticSubrequests, text, built.inputEvidence));
    assert.match(capture.input!.systemPrompt!, /expense\.action\.preview \(including RECORD_PAYMENT\) uses kind write with no writeIntent/u);
    assert.match(capture.input!.systemPrompt!, /จ่ายแล้ว \/ โอนแล้ว \/ บันทึกจ่าย/u);
  });
  it('fails closed on malformed authority and preserves only configured, permitted, entitled tools', () => {
    const configured = new Set(['expense.list_recent', 'sales.get_sales_summary']);
    const permissions = ['ai.tool.invoke', 'expense.read'];
    const features = ['expenses', 'expenses.list'];
    assert.deepEqual([...effectiveIntakeToolNames(
      ['unknown.from.newer.api', 'sales.get_sales_summary', 'expense.list_recent', 'expense.list_recent'],
      configured, permissions, features,
    )], ['expense.list_recent']);
    for (const malformed of [undefined, 'expense.list_recent', [1], Array.from({ length: 129 }, () => 'expense.list_recent')]) {
      assert.deepEqual([...effectiveIntakeToolNames(malformed, configured, permissions, features)], []);
    }
    assert.deepEqual([...effectiveIntakeToolNames(['expense.list_recent'], configured, ['expense.read'], features)], [], 'ai.tool.invoke revoked');
    assert.deepEqual([...effectiveIntakeToolNames(['expense.list_recent'], configured, permissions, undefined)], [], 'missing entitlement snapshot');
    assert.deepEqual([...effectiveIntakeToolNames(['expense.list_recent'], configured, permissions, null)], ['expense.list_recent'], 'legacy null is fail-open');
  });

  it('requires consistent canonical simple-read filters and preserves candidate month-to-date bounds', () => {
    const prompt = intakeRouterSystemPrompt({ fusedPlan: true }, false, true, false, EXPENSE_LIST_PREPARED_FAMILIES);
    assert.match(prompt, /decisionV1 is the provider-only compact form/);
    assert.match(prompt, /Put each business filter only in subrequests\[0\]\.filters; the server copies it to the canonical tool input/);
    assert.match(prompt, /EITHER periodKey OR the complete fromDate\/toDate pair, never both/);
    assert.match(prompt, /month-to-date\/spending-so-far/);
    assert.match(prompt, /copy the candidate's clamped fromDate\/toDate/);
    assert.match(prompt, /Omit simpleRead for compound, ambiguous, dependent, entity\/task-referenced/);
    assert.match(prompt, /simpleRead never grants permission/);
    assert.match(prompt, /only an exact tool and answerShape pair listed in preparedSimpleReadFamilies/);
    // Item 2 (eval: "ขอดูรายการล่าสุด"/"ขอ list รายการล่าสุด"/"รายการเดือนนี้มีอะไรบ้าง" all answered as
    // a single total): the prompt must name the record-listing keywords and force "list" for them.
    assert.match(prompt, /choose answerShape "list" whenever the message asks to see, list, or enumerate the records themselves/);
    assert.match(prompt, /"รายการ", "list"/);
    assert.match(prompt, /"มีอะไรบ้าง"/);
    assert.match(prompt, /"ขอดู N รายการ", "ขอดูรายการล่าสุด"/);
    assert.match(prompt, /choose "single_metric" only for a total, sum, count, or aggregate question with no request to see the individual records/);
    assert.match(prompt, /Use kind "help" for the meaning or workflow of MangmeePlus itself/);
    assert.match(prompt, /Use kind "general" for a business-domain concept or definition independent of this product/);
    assert.match(prompt, /Use kind "read" only for an actual company figure, record, or current status/);
    assert.doesNotMatch(prompt, /semanticSubrequests\[0\]\.requestedFilters and preparedPlan/);
    assert.doesNotMatch(intakeRouterSystemPrompt({ fusedPlan: true }, false, true), /simpleRead/,
      'an empty executable family set must not invite an unusable fast plan');

    const imageCompatibilityPrompt = intakeRouterSystemPrompt({ fusedPlan: true }, true, true);
    assert.match(imageCompatibilityPrompt, /semanticSubrequests\[0\]\.requestedFilters and preparedPlan\.proposedCalls\[0\]\.input MUST carry the same canonical business filter keys and exact scalar values/);
    assert.match(imageCompatibilityPrompt, /COPY that fullPartRef object verbatim/);
    assert.doesNotMatch(intakeRouterSystemPrompt({ fusedPlan: true }, false, false), /same canonical business filter/);
  });

  it('never exposes compact prepared execution when fused planning is off', async () => {
    const text = 'ดูค่าใช้จ่าย';
    const built = await createLineAiInputEvidence({ turnKey: 'compact-cap-off', parts: [{ partId: 'part-0',
      eventIdHash: 'a'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const capture: { input?: ProviderInput } = {};
    const plan = await new IntentRouterAgent(modelAnswer({
      intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.97,
      decisionV1: {
        subrequests: [{ kind: 'read', goal: text, sources: [{ part: 0, whole: true }], filters: {} }],
        simpleRead: { subrequest: 0, tool: 'expense.list_recent', subject: 'expense', agent: 'accounting', answerShape: 'single_metric', confidence: 0.96 },
      },
    }, capture)).routeIntake(baseRequest({ messageText: text, inputEvidence: built.inputEvidence }));
    assert.equal(plan.status, 'ROUTED');
    assert.equal(plan.preparedPlan, undefined);
    assert.equal(plan.semanticSubrequests?.length, 1);
    assert.doesNotMatch(capture.input!.systemPrompt ?? '', /simpleRead/);
    assert.equal(capture.input!.cacheableContext, undefined);
  });

  it('keeps compact semantics but strips prepared execution from an outer CLARIFY route', async () => {
    const text = 'ดูค่าใช้จ่ายของสาขานั้น';
    const built = await createLineAiInputEvidence({ turnKey: 'compact-clarify', parts: [{ partId: 'part-0',
      eventIdHash: 'b'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const plan = await new IntentRouterAgent(modelAnswer({
      intent: 'CLARIFY', language: 'th', confidence: 0.7, clarifyQuestion: 'หมายถึงสาขาใดคะ',
      decisionV1: {
        subrequests: [{ kind: 'read', goal: text, sources: [{ part: 0, whole: true }], filters: {} }],
        simpleRead: { subrequest: 0, tool: 'expense.list_recent', subject: 'expense', agent: 'accounting', answerShape: 'single_metric', confidence: 0.96 },
      },
    }), false, {}, false, [EXPENSE_LIST_PREPARED_FAMILY]).routeIntake(baseRequest({
      messageText: text, inputEvidence: built.inputEvidence, capabilities: { fusedPlan: true },
    }));
    assert.equal(plan.intent, 'CLARIFY');
    assert.equal(plan.preparedPlan, undefined);
    assert.equal(plan.clarifyQuestion, 'หมายถึงสาขาใดคะ');
  });

  it('uses the same request-scoped catalog for the provider and compact decoder', async () => {
    const text = 'ยอดขายเดือนนี้เท่าไหร่';
    const built = await createLineAiInputEvidence({ turnKey: 'scoped-catalog', parts: [{ partId: 'part-0',
      eventIdHash: '9'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const capture: { input?: ProviderInput } = {};
    const plan = await new IntentRouterAgent(modelAnswer({
      intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.97,
      decisionV1: {
        subrequests: [{ kind: 'read', goal: text, sources: [{ part: 0, whole: true }], filters: {} }],
        simpleRead: { subrequest: 0, tool: 'sales.get_sales_summary', subject: 'sale', agent: 'sales', answerShape: 'single_metric', confidence: 0.96 },
      },
    }, capture), false, {}, false, [SALES_SUMMARY_PREPARED_FAMILY]).routeIntake(baseRequest({ messageText: text, inputEvidence: built.inputEvidence, capabilities: { fusedPlan: true },
      offeredToolNames: ['expense.list_recent', 'sales.get_sales_summary', 'unknown.from.newer.api'] }));
    const catalog = JSON.parse(capture.input!.cacheableContext ?? '{}');
    assert.deepEqual(catalog.enabledFeatures.map((feature: { toolName: string }) => feature.toolName), ['expense.list_recent']);
    assert.deepEqual(catalog.disabledFeatures, []);
    assert.equal(plan.status, 'ROUTED');
    assert.equal(plan.preparedPlan, undefined, 'the decoder cannot use a tool omitted from the provider catalog');
    assert.equal(plan.semanticSubrequests?.[0]?.goal, text, 'the canonical request survives for safe full-path handling');
  });

  it('keeps ordinary tools visible but prepares only an exact configured formatter family', async () => {
    const text = 'เดือนนี้ค่าไช้จ่ายไปเท่าไหร่แล้ว';
    const built = await createLineAiInputEvidence({ turnKey: 'prepared-family-scope', parts: [{ partId: 'part-0',
      eventIdHash: '6'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const answer = (tool: string) => ({
      intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.97,
      decisionV1: {
        subrequests: [{ kind: 'read', goal: text, sources: [{ part: 0, whole: true }], filters: {} }],
        simpleRead: { subrequest: 0, tool, subject: 'expense', agent: 'accounting', answerShape: 'single_metric', confidence: 0.96 },
      },
    });
    const request = baseRequest({ messageText: text, inputEvidence: built.inputEvidence, capabilities: { fusedPlan: true },
      offeredToolNames: ['expense.get_breakdown', 'expense.list_recent'] });
    const capture: { input?: ProviderInput } = {};
    const unsupported = await new IntentRouterAgent(modelAnswer(answer('expense.get_breakdown'), capture), false, {}, false,
      [EXPENSE_LIST_PREPARED_FAMILY, 'sales.get_sales_summary::single_metric']).routeIntake(request);
    const catalog = JSON.parse(capture.input!.cacheableContext ?? '{}');
    assert.deepEqual(catalog.enabledFeatures.map((feature: { toolName: string }) => feature.toolName),
      ['expense.get_breakdown', 'expense.list_recent'], 'normal semantic routing retains both authorized tools');
    assert.deepEqual(catalog.preparedSimpleReadFamilies, [EXPENSE_LIST_PREPARED_FAMILY]);
    assert.equal(unsupported.preparedPlan, undefined);
    assert.equal(unsupported.semanticSubrequests?.[0]?.goal, text);

    const runtimeOff = await new IntentRouterAgent(modelAnswer(answer('expense.list_recent')), false, {}, false, [])
      .routeIntake(request);
    assert.equal(runtimeOff.preparedPlan, undefined, 'prepared runtime off keeps canonical semantics without an executable plan');
    assert.equal(runtimeOff.semanticSubrequests?.[0]?.goal, text);

    const supported = await new IntentRouterAgent(modelAnswer(answer('expense.list_recent')), false, {}, false,
      [EXPENSE_LIST_PREPARED_FAMILY]).routeIntake(request);
    assert.equal(supported.preparedPlan?.proposedCalls[0]?.toolName, 'expense.list_recent');
  });

  it('discards a legacy prepared plan that names an unoffered tool while preserving canonical semantics', async () => {
    const text = 'ยอดขายเดือนนี้เท่าไหร่';
    const built = await createLineAiInputEvidence({ turnKey: 'legacy-prepared-scope', parts: [{ partId: 'part-0',
      eventIdHash: '8'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const ref = { partId: 'part-0', startUtf16: 0, endUtf16: text.length, rawSha256: built.inputEvidence.parts[0]!.rawSha256 };
    const plan = await new IntentRouterAgent(modelAnswer({
      intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.97,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: text, requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: [ref] }],
      preparedPlan: { version: 1, complexity: 'simple', confidence: 0.96, responseMode: 'simple_grounded', answerShape: 'single_metric',
        intentPlan: { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_summary', subject: 'sale', agent: 'sales', priority: 1,
          requiredTools: ['sales.get_sales_summary'], missingContext: [] }], refusals: [], requiresHumanReview: false },
        proposedCalls: [{ toolName: 'sales.get_sales_summary', input: {} }] },
    }), false, {}, false, [SALES_SUMMARY_PREPARED_FAMILY]).routeIntake(baseRequest({
      messageText: text, inputEvidence: built.inputEvidence, capabilities: { fusedPlan: true },
    }));
    assert.equal(plan.status, 'ROUTED');
    assert.equal(plan.preparedPlan, undefined);
    assert.equal(plan.semanticSubrequests?.[0]?.goal, text);
  });

  it('keeps native expense capture available when the bound ERP read catalog is empty', async () => {
    const text = 'บันทึกค่ากาแฟ 120 บาท';
    const built = await createLineAiInputEvidence({ turnKey: 'native-capture-empty-catalog', parts: [{ partId: 'part-0',
      eventIdHash: '7'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const capture: { input?: ProviderInput } = {};
    const plan = await new IntentRouterAgent(modelAnswer({
      intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.97,
      captureHints: { amount: '120', description: 'ค่ากาแฟ' },
      decisionV1: { subrequests: [{ kind: 'write', goal: text, sources: [{ part: 0, whole: true }], filters: {},
        writeIntent: 'EXPENSE_DOCUMENT_CAPTURE' }] },
    }, capture)).routeIntake(baseRequest({
      messageText: text, inputEvidence: built.inputEvidence, capabilities: { fusedPlan: true },
      permissions: ['line.ai.query', 'expense.receipt.line_upload'], enabledFeatures: ['expenses.upload'],
      offeredToolNames: undefined,
    }));
    const catalog = JSON.parse(capture.input!.cacheableContext ?? '{}');
    assert.deepEqual(catalog.enabledFeatures, []);
    assert.equal(plan.status, 'ROUTED');
    assert.equal(plan.intent, 'EXPENSE_DOCUMENT_CAPTURE');
    assert.equal(plan.semanticSubrequests?.[0]?.writeIntent, 'EXPENSE_DOCUMENT_CAPTURE');
    assert.equal(plan.preparedPlan, undefined);
  });

  it('UAT 2026-09-29: a draft answer routed as continuation keeps its one clause as that write, not a general question', async () => {
    const text = 'ค่าเครื่องเขียนและวัสดุสำนักงาน';
    const built = await createLineAiInputEvidence({ turnKey: 'draft-answer-kind', parts: [{ partId: 'part-0',
      eventIdHash: 'e'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const draft = { expenseId: 'expense-1', label: 'ร่าง 1', status: 'OPEN' as const,
      questions: [{ id: 'I01-CATEGORY', itemRef: 'I01', prompt: 'เป็นค่าใช้จ่ายหมวดไหนคะ' }] };
    // The observed real answer: the intent, target and hints say "continue this draft"; the clause says general.
    const answer = { intent: 'EXPENSE_DRAFT_CONTINUATION', language: 'th', confidence: 0.9, resolvedClarificationIds: ['I01-CATEGORY'],
      captureHints: { targetExpenseId: 'expense-1', description: text, items: [{ itemRef: 'I01', sourceText: text, description: text, confidence: 0.88, missingFields: [] }], confidence: 0.9, missingFields: [] },
      decisionV1: { subrequests: [{ kind: 'general', goal: 'ตอบคำถามหมวดค่าใช้จ่าย', sources: [{ part: 0, whole: true }], filters: {} }] } };
    const routed = await new IntentRouterAgent(modelAnswer(answer)).routeIntake(baseRequest({ messageText: text,
      inputEvidence: built.inputEvidence, capabilities: { fusedPlan: true }, activeExpenseDrafts: [draft] }));
    assert.equal(routed.status, 'ROUTED');
    assert.equal(routed.semanticSubrequests?.[0]?.kind, 'write');
    assert.equal(routed.semanticSubrequests?.[0]?.writeIntent, 'EXPENSE_DRAFT_CONTINUATION');
    // Without an open draft on offer there is nothing to continue: the clause stays exactly as the model filed it.
    const unoffered = await new IntentRouterAgent(modelAnswer(answer)).routeIntake(baseRequest({ messageText: text,
      inputEvidence: built.inputEvidence, capabilities: { fusedPlan: true } }));
    assert.equal(unoffered.semanticSubrequests?.[0]?.kind, 'general');
    assert.equal(unoffered.semanticSubrequests?.[0]?.writeIntent, undefined);
  });

  it('rejects compact output that also carries either legacy planning field', async () => {
    const text = 'ดูค่าใช้จ่าย';
    const built = await createLineAiInputEvidence({ turnKey: 'compact-conflict', parts: [{ partId: 'part-0',
      eventIdHash: 'c'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const compact = { subrequests: [{ kind: 'read', goal: text, sources: [{ part: 0, whole: true }], filters: {} }] };
    for (const legacy of [
      { semanticSubrequests: [] },
      { preparedPlan: { version: 1 } },
    ]) {
      const plan = await new IntentRouterAgent(modelAnswer({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.97,
        decisionV1: compact, ...legacy })).routeIntake(baseRequest({ messageText: text, inputEvidence: built.inputEvidence,
          capabilities: { fusedPlan: true } }));
      assert.equal(plan.status, 'UNAVAILABLE');
      assert.equal(plan.errorCode, 'ROUTER_SEMANTIC_SCHEMA_INVALID');
    }
  });

  it('item 4: drops (not rejects) a compact taskRef that does not match the current task revision', async () => {
    // Old behavior failed the WHOLE route here (ROUTER_SEMANTIC_SCHEMA_INVALID) even though a taskRef
    // grants no authority by itself — it only selects which pending question a clause continues. A
    // stale/unverifiable one is now dropped from just that clause so the message still routes, exactly
    // as the eval's T-105-b branch-follow-up needed (see intent-router.agent.ts's parseIntakePlan).
    const text = 'ทำต่อเลย';
    const built = await createLineAiInputEvidence({ turnKey: 'compact-stale-task', parts: [{ partId: 'part-0',
      eventIdHash: 'd'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const taskProjection = { version: 2 as const, stateVersion: 1, lifecycleEpoch: 0, expiresAtMs: Date.now() + 60_000,
      tasks: [{ taskId: 'task-1', revision: 5, kind: 'write' as const, state: 'paused' as const, userGoal: 'บันทึกค่าใช้จ่าย',
        subrequests: [{ index: 0, kind: 'write' as const, goal: 'บันทึกค่าใช้จ่าย', status: 'pending' as const }] }] };
    const plan = await new IntentRouterAgent(modelAnswer({
      intent: 'EXPENSE_DRAFT_CONTINUATION', language: 'th', confidence: 0.97,
      decisionV1: { subrequests: [{ kind: 'write', goal: text, sources: [{ part: 0, whole: true }], filters: {},
        writeIntent: 'EXPENSE_DRAFT_CONTINUATION', taskRef: { taskId: 'task-1', taskRevision: 4, subrequestIndex: 0 } }] },
    })).routeIntake(baseRequest({ messageText: text, inputEvidence: built.inputEvidence, taskProjection }));
    assert.equal(plan.status, 'ROUTED');
    assert.notEqual(plan.errorCode, 'ROUTER_SEMANTIC_SCHEMA_INVALID');
    assert.equal(plan.semanticSubrequests?.[0]?.taskRef, undefined);
    assert.equal(plan.semanticSubrequests?.[0]?.writeIntent, 'EXPENSE_DRAFT_CONTINUATION');
  });

  it('item 4 (eval T-105-b): "แล้วที่สาขา 2 ล่ะครับ" after a completed daily-closing turn routes instead of schema-invalid', async () => {
    // The prior daily-closing question was already fully answered, so it is no longer waiting_user/
    // paused in taskProjection — but a real model attached its taskRef to this brand-new branch
    // follow-up anyway, despite the router prompt saying a new read question carries none at all.
    const text = 'แล้วที่สาขา 2 ล่ะครับ';
    const built = await createLineAiInputEvidence({ turnKey: 'branch-followup-stale-task', parts: [{ partId: 'part-0',
      eventIdHash: '1'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const taskProjection = { version: 2 as const, stateVersion: 1, lifecycleEpoch: 0, expiresAtMs: Date.now() + 60_000, tasks: [] };
    const plan = await new IntentRouterAgent(modelAnswer({
      intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9,
      decisionV1: { subrequests: [{ kind: 'read', goal: 'สรุปรายวันสาขา 2', sources: [{ part: 0, whole: true }],
        filters: { branchId: 'สาขา 2' }, taskRef: { taskId: 'stale-daily-closing-task', taskRevision: 1, subrequestIndex: 0 } }] },
    })).routeIntake(baseRequest({ messageText: text, inputEvidence: built.inputEvidence, taskProjection,
      offeredToolNames: ['expense.get_daily_closing'] }));
    assert.equal(plan.status, 'ROUTED');
    assert.notEqual(plan.errorCode, 'ROUTER_SEMANTIC_SCHEMA_INVALID');
    assert.equal(plan.semanticSubrequests?.[0]?.taskRef, undefined);
    assert.equal(plan.semanticSubrequests?.[0]?.kind, 'read');
  });

  // tuning-7b (K1): the router MAY name the single best read tool for a clause so the gateway can
  // skip its own tool-planning call (~1.8s avg, up to 4s). Only an ENABLED read-category tool survives
  // as toolHint; an unoffered/disabled/wrong-category tool is dropped silently, never fails the clause.
  it('K1: a compact "tool" hint on a read clause becomes toolHint when the tool is offered and read-category', async () => {
    const text = 'ค่าใช้จ่ายเดือนนี้แยกตามหมวดหมู่เป็นยังไงบ้างคะ';
    const built = await createLineAiInputEvidence({ turnKey: 'compact-tool-hint-valid', parts: [{ partId: 'part-0',
      eventIdHash: '2'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const plan = await new IntentRouterAgent(modelAnswer({
      intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.92,
      decisionV1: { subrequests: [{ kind: 'read', goal: 'ค่าใช้จ่ายเดือนนี้แยกตามหมวดหมู่', sources: [{ part: 0, whole: true }],
        filters: {}, tool: 'expense.get_breakdown' }] },
    })).routeIntake(baseRequest({ messageText: text, inputEvidence: built.inputEvidence, offeredToolNames: ['expense.get_breakdown'] }));
    assert.equal(plan.status, 'ROUTED');
    assert.equal(plan.semanticSubrequests?.[0]?.toolHint, 'expense.get_breakdown');
  });

  it('K1: a "tool" hint naming a tool not offered this turn is dropped, never fails the clause', async () => {
    const text = 'ค่าใช้จ่ายเดือนนี้แยกตามหมวดหมู่เป็นยังไงบ้างคะ';
    const built = await createLineAiInputEvidence({ turnKey: 'compact-tool-hint-not-offered', parts: [{ partId: 'part-0',
      eventIdHash: '3'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const plan = await new IntentRouterAgent(modelAnswer({
      intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.92,
      decisionV1: { subrequests: [{ kind: 'read', goal: 'ค่าใช้จ่ายเดือนนี้แยกตามหมวดหมู่', sources: [{ part: 0, whole: true }],
        filters: {}, tool: 'expense.get_breakdown' }] },
    })).routeIntake(baseRequest({ messageText: text, inputEvidence: built.inputEvidence, offeredToolNames: ['expense.list_recent'] }));
    assert.equal(plan.status, 'ROUTED', 'the whole clause still routes; only the hint is dropped');
    assert.equal(plan.semanticSubrequests?.[0]?.toolHint, undefined);
  });

  it('resumes a pending task from a valid compact taskRef object', async () => {
    const text = 'ทำต่อเลย';
    const built = await createLineAiInputEvidence({ turnKey: 'compact-valid-task', parts: [{ partId: 'part-0',
      eventIdHash: 'e'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const taskProjection = { version: 2 as const, stateVersion: 1, lifecycleEpoch: 0, expiresAtMs: Date.now() + 60_000,
      tasks: [{ taskId: 'task-1', revision: 5, kind: 'write' as const, state: 'paused' as const, userGoal: 'บันทึกค่าใช้จ่าย',
        subrequests: [{ index: 0, kind: 'write' as const, goal: 'บันทึกค่าใช้จ่าย', status: 'pending' as const }] }] };
    const plan = await new IntentRouterAgent(modelAnswer({
      intent: 'EXPENSE_DRAFT_CONTINUATION', language: 'th', confidence: 0.97,
      decisionV1: { subrequests: [{ kind: 'write', goal: text, sources: [{ part: 0, whole: true }], filters: {},
        writeIntent: 'EXPENSE_DRAFT_CONTINUATION', taskRef: { taskId: 'task-1', taskRevision: 5, subrequestIndex: 0 } }] },
    })).routeIntake(baseRequest({ messageText: text, inputEvidence: built.inputEvidence, taskProjection }));
    assert.equal(plan.status, 'ROUTED');
    assert.deepEqual(plan.semanticSubrequests?.[0]?.taskRef, { taskId: 'task-1', taskRevision: 5, subrequestIndex: 0 });
  });

  it('names the taskRef defect in the repair prompt for a bare id string, and still ends in a typed failure', async () => {
    const text = 'ทำต่อเลย';
    const built = await createLineAiInputEvidence({ turnKey: 'compact-string-task', parts: [{ partId: 'part-0',
      eventIdHash: 'f'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const taskProjection = { version: 2 as const, stateVersion: 1, lifecycleEpoch: 0, expiresAtMs: Date.now() + 60_000,
      tasks: [{ taskId: 'task-1', revision: 5, kind: 'write' as const, state: 'paused' as const, userGoal: 'บันทึกค่าใช้จ่าย',
        subrequests: [{ index: 0, kind: 'write' as const, goal: 'บันทึกค่าใช้จ่าย', status: 'pending' as const }] }] };
    const sentTexts: string[] = [];
    const provider = { generateText: async (input: ProviderInput) => {
      sentTexts.push(String((input.messages?.[0] as { text?: string } | undefined)?.text ?? ''));
      // The model repeats its own mistake (a bare taskId string) on the repair attempt too — the decoder
      // must reject it again, not crash or silently accept a weaker shape.
      return { ok: true as const, text: JSON.stringify({
        intent: 'EXPENSE_DRAFT_CONTINUATION', language: 'th', confidence: 0.97,
        decisionV1: { subrequests: [{ kind: 'write', goal: text, sources: [{ part: 0, whole: true }], filters: {},
          writeIntent: 'EXPENSE_DRAFT_CONTINUATION', taskRef: 'task-1' }] },
      }) };
    } };
    // A repair attempt only fires inside an active-v2 budget (spare slot + repair not yet spent).
    const plan = await runWithUsageContext({ budget: { status: 'active-v2', grant: { maxTurnSlots: 2, maxRepairs: 1 } as never,
      inputDigest: built.inputEvidence.joinedSha256, sourceRoute: 'test', calls: 0, repairCount: 0 } }, () =>
      new IntentRouterAgent(provider).routeIntake(baseRequest({ messageText: text, inputEvidence: built.inputEvidence, taskProjection })));
    assert.equal(sentTexts.length, 2, 'a malformed taskRef must spend exactly one repair attempt');
    assert.doesNotMatch(sentTexts[0]!, /schemaRepair/, 'the first attempt carries no repair hint yet');
    assert.match(sentTexts[1]!, /previous taskRef was invalid/, 'the repair attempt names the actual defect');
    assert.equal(plan.status, 'UNAVAILABLE');
    assert.equal(plan.errorCode, 'ROUTER_SEMANTIC_SCHEMA_INVALID');
  });

  // UAT 2026-09-29 ("สวัสดีจ้า"): the router's first output for pure social talk reported NO request — the
  // recorded real-model output below (Sonnet 4.6, local AgentCore replica, "ขอบคุณค่ะ") — and the decoder's
  // `subrequests.length < 1` rule sent it to a repair, whose call then spent the general lane's only answer slot.
  it('accepts an empty ADVISOR_CONVERSATION decision as one general clause in ONE router call', async () => {
    const text = 'ขอบคุณค่ะ';
    const built = await createLineAiInputEvidence({ turnKey: 'social-empty-decision', parts: [{ partId: 'part-0',
      eventIdHash: 'a'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const recorded = '{"intent":"ADVISOR_CONVERSATION","language":"th","confidence":0.97,"semanticOutcome":"AMBIGUOUS","fundingSource":"UNKNOWN","decisionV1":{"subrequests":[]},"advisorAnswer":{"version":1,"mode":"SOCIAL_CHAT","confidence":0.97,"needsTools":false,"answerText":"ยินดีเลยค่ะ 😊 มีอะไรให้ช่วยอีกบอกได้เสมอนะคะ"}}';
    let calls = 0;
    const provider = { generateText: async () => { calls += 1; return { ok: true as const, text: recorded }; } };
    const plan = await runWithUsageContext({ budget: { status: 'active-v2', grant: { maxTurnSlots: 4, maxRepairs: 1 } as never,
      inputDigest: built.inputEvidence.joinedSha256, sourceRoute: 'test', calls: 0, repairCount: 0 } }, () =>
      new IntentRouterAgent(provider).routeIntake(baseRequest({ messageText: text, inputEvidence: built.inputEvidence,
        capabilities: { advisor: true, reimbursementSemantic: true } })));
    assert.equal(calls, 1, 'a legitimate social decision spends no repair call');
    assert.equal(plan.status, 'ROUTED');
    assert.equal(plan.intent, 'ADVISOR_CONVERSATION');
    assert.deepEqual(plan.semanticSubrequests?.map((item) => [item.kind, item.evidenceRefs?.[0]?.startUtf16, item.evidenceRefs?.[0]?.endUtf16]),
      [['general', 0, text.length]]);
    assert.equal(plan.advisorAnswer?.answerText, 'ยินดีเลยค่ะ 😊 มีอะไรให้ช่วยอีกบอกได้เสมอนะคะ');
  });

  // NAT11 (2026-09-30): natural "จำไว้" wording never reached the preference commands, so the chat promised to remember
  // and stored nothing. The router now names the request; only a bound private chat is offered the field.
  it('names an explicit answer-preference request only under the bound-chat capability, re-validated', async () => {
    const text = 'ต่อไปตอบสั้น ๆ แบบนี้นะ จำไว้ได้มั้ย';
    const built = await createLineAiInputEvidence({ turnKey: 'preference-remember', parts: [{ partId: 'part-0',
      eventIdHash: 'c'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const route = (preference: unknown, capabilities: Record<string, boolean>) => {
      const prompts: string[] = [];
      const provider = { generateText: async (input: { systemPrompt?: string }) => { prompts.push(input.systemPrompt ?? '');
        return { ok: true as const, text: JSON.stringify({ intent: 'ADVISOR_CONVERSATION', language: 'th', confidence: 0.95, semanticOutcome: 'AMBIGUOUS',
          fundingSource: 'UNKNOWN', decisionV1: { subrequests: [] }, responsePreference: preference }) }; } };
      return runWithUsageContext({ budget: { status: 'active-v2', grant: { maxTurnSlots: 4, maxRepairs: 1 } as never,
        inputDigest: built.inputEvidence.joinedSha256, sourceRoute: 'test', calls: 0, repairCount: 0 } }, async () => ({ prompts,
        plan: await new IntentRouterAgent(provider).routeIntake(baseRequest({ messageText: text, inputEvidence: built.inputEvidence,
          capabilities: { advisor: true, reimbursementSemantic: true, ...capabilities } })) }));
    };
    const offered = await route({ kind: 'set', values: { detail: 'short' } }, { responsePreference: true });
    assert.deepEqual(offered.plan.responsePreference, { kind: 'set', values: { detail: 'short' } });
    assert.match(offered.prompts[0]!, /Answer preferences \(OPTIONAL "responsePreference"\)/u);
    assert.deepEqual(offered.plan.semanticSubrequests?.map(item => item.kind), ['general']);
    const notOffered = await route({ kind: 'set', values: { detail: 'short' } }, {});
    assert.equal(notOffered.plan.responsePreference, undefined, 'a group chat or an older API never gets one');
    assert.doesNotMatch(notOffered.prompts[0]!, /responsePreference/u);
    for (const invalid of [{ kind: 'set', values: { detail: 'tiny' } }, { kind: 'set', values: {} }, { kind: 'set', values: { memo: 'ชอบกาแฟ' } },
      { kind: 'delete', keys: ['detail', 'detail'] }, { kind: 'list', extra: true }, 'list']) {
      assert.equal((await route(invalid, { responsePreference: true })).plan.responsePreference, undefined, JSON.stringify(invalid));
    }
    assert.deepEqual((await route({ kind: 'delete', keys: ['detail'] }, { responsePreference: true })).plan.responsePreference, { kind: 'delete', keys: ['detail'] });
    assert.deepEqual((await route({ kind: 'list' }, { responsePreference: true })).plan.responsePreference, { kind: 'list' });
  });

  it('keeps an empty decision on any other route invalid: it still spends the one repair and fails typed', async () => {
    const text = 'ค่าใช้จ่ายเดือนนี้เท่าไหร่';
    const built = await createLineAiInputEvidence({ turnKey: 'business-empty-decision', parts: [{ partId: 'part-0',
      eventIdHash: 'b'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    let calls = 0;
    const provider = { generateText: async () => { calls += 1; return { ok: true as const, text: JSON.stringify({
      intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95, decisionV1: { subrequests: [] } }) }; } };
    const plan = await runWithUsageContext({ budget: { status: 'active-v2', grant: { maxTurnSlots: 4, maxRepairs: 1 } as never,
      inputDigest: built.inputEvidence.joinedSha256, sourceRoute: 'test', calls: 0, repairCount: 0 } }, () =>
      new IntentRouterAgent(provider).routeIntake(baseRequest({ messageText: text, inputEvidence: built.inputEvidence,
        capabilities: { advisor: true } })));
    assert.equal(calls, 2);
    assert.equal(plan.status, 'UNAVAILABLE');
    assert.equal(plan.errorCode, 'ROUTER_SEMANTIC_SCHEMA_INVALID');
  });

  it('shows the taskRef object shape, never a bare id, in the compact prompt', () => {
    const prompt = intakeRouterSystemPrompt({}, false, true);
    assert.ok(prompt.includes('"taskRef": {"taskId":"...","taskRevision":1,"subrequestIndex":0}'),
      'the compact JSON skeleton spells out the object shape with an example');
    assert.match(prompt, /resumableTaskRefs/, 'the rule points the model at the ready-to-copy entries');
    assert.match(prompt, /NEW read question.*independent side question/, 'a new question is distinguished from answering the pending one');
  });

  // tuning-7b (K1): the compact JSON skeleton offers an OPTIONAL "tool" field so the model can name
  // the single best read tool for a clause, letting the gateway skip its own tool-planner call.
  it('shows the OPTIONAL "tool" hint field in the compact prompt, for a read clause only', () => {
    const prompt = intakeRouterSystemPrompt({}, false, true);
    assert.ok(prompt.includes('"tool": "exact catalog read tool name"'),
      'the compact JSON skeleton spells out the optional tool-hint field');
    assert.match(prompt, /"tool" is an OPTIONAL string, the single best read tool for THIS clause/);
    assert.match(prompt, /For a read clause, "tool" MAY name the single best read tool from the offered catalog for that clause — omit it when unsure/);
    assert.match(prompt, /why\/compare clause whose tool is expense\.get_breakdown/);
  });

  it('R-L1: never proposes complexity=simple for a plan that fails the shared pre-call check', async () => {
    const text = 'เดือนนี้จ่ายไปเท่าไหร่';
    const built = await createLineAiInputEvidence({ turnKey: 'precall-multi-period', parts: [{ partId: 'part-0',
      eventIdHash: '1'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    // Two offered period candidates alone fails the shared check (multiple_periods) regardless of
    // what the compact decision itself would otherwise accept.
    const periods = [
      { span: 'เดือนนี้', kind: 'month' as const, fromDate: '2026-09-01', toDate: '2026-09-27', monthKey: '2026-09', source: 'relative' as const, label: 'เดือนนี้', assumptions: [] },
      { span: 'เดือนที่แล้ว', kind: 'month' as const, fromDate: '2026-08-01', toDate: '2026-08-31', monthKey: '2026-08', source: 'relative' as const, label: 'เดือนที่แล้ว', assumptions: [] },
    ];
    const plan = await new IntentRouterAgent(modelAnswer({
      intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.97,
      decisionV1: {
        subrequests: [{ kind: 'read', goal: text, sources: [{ part: 0, whole: true }], filters: { fromDate: '2026-09-01', toDate: '2026-09-27' } }],
        simpleRead: { subrequest: 0, tool: 'expense.list_recent', subject: 'expense', agent: 'accounting', answerShape: 'single_metric', confidence: 0.96 },
      },
    }), false, {}, false, [...EXPENSE_LIST_PREPARED_FAMILIES]).routeIntake(baseRequest({
      messageText: text, inputEvidence: built.inputEvidence, capabilities: { fusedPlan: true },
      valueCandidates: { amounts: [], dates: [], periods },
    }));
    assert.equal(plan.status, 'ROUTED');
    assert.equal(plan.preparedPlan, undefined, 'a plan that fails the shared pre-call check is never locked to the fast lane');
    assert.equal(plan.semanticSubrequests?.[0]?.goal, text, 'the full request survives for normal planning instead');
  });

  it('R-L1: a status-filter follow-up after a delivered this-month total now passes the check and stays in the fast lane', async () => {
    const text = 'แล้วยอดเดือนนี้ ถ้าเอาเฉพาะที่ยืนยันแล้วล่ะ';
    const built = await createLineAiInputEvidence({ turnKey: 'precall-status-followup', parts: [{ partId: 'part-0',
      eventIdHash: '2'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(built);
    const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const monthStart = `${todayIso.slice(0, 7)}-01`;
    const period = { span: 'เดือนนี้', kind: 'month' as const, fromDate: monthStart, toDate: todayIso, monthKey: todayIso.slice(0, 7), source: 'relative' as const, label: 'เดือนนี้', assumptions: [] };
    const conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [], deliveredExpenseSummary: {
      version: 1 as const, deliveredAt: new Date().toISOString(), statusBasis: 'exclude_rejected_voided' as const,
      ranges: [{ fromDate: monthStart, toDate: todayIso, branchId: null }],
    } };
    const plan = await new IntentRouterAgent(modelAnswer({
      intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.97,
      decisionV1: {
        subrequests: [{ kind: 'read', goal: text, sources: [{ part: 0, whole: true }], filters: { fromDate: monthStart, toDate: todayIso, documentStatus: 'CONFIRMED' } }],
        simpleRead: { subrequest: 0, tool: 'expense.list_recent', subject: 'expense', agent: 'accounting', answerShape: 'single_metric', confidence: 0.96 },
      },
    }), false, {}, false, [...EXPENSE_LIST_PREPARED_FAMILIES]).routeIntake(baseRequest({
      messageText: text, inputEvidence: built.inputEvidence, capabilities: { fusedPlan: true },
      valueCandidates: { amounts: [], dates: [], periods: [period] }, conversationContext,
    }));
    assert.equal(plan.status, 'ROUTED');
    assert.equal(plan.preparedPlan?.proposedCalls[0]?.toolName, 'expense.list_recent');
    assert.equal(plan.preparedPlan?.proposedCalls[0]?.input['documentStatus'], 'CONFIRMED',
      'R-U1 (item 1): a document-status word after เฉพาะที่ is a filter, not a branch scope request that would fail the check');
  });

  it('offers exact full-part refs for Thai text and surrogate pairs without repairing invalid model evidence', async () => {
    // Real Sonnet NAT-01 failed twice with endUtf16=34 although this exact typo-preserving input is 32.
    for (const rawText of ['เดือนนี้ค่าไช้จ่ายไปเท่าไหร่แล้ว', '😀 เดือนนี้ค่าไช้จ่ายไปเท่าไหร่แล้ว']) {
      const built = await createLineAiInputEvidence({ turnKey: 'nat-evidence', parts: [{ partId: 'part-0',
        eventIdHash: 'a'.repeat(64), acceptedAtMs: 1, rawText }] });
      assert.ok(built);
      const expectedRef = { partId: 'part-0', startUtf16: 0, endUtf16: rawText.length,
        rawSha256: built.inputEvidence.parts[0]!.rawSha256 };
      const answer = (ref: unknown) => ({ intent: 'BUSINESS_READ_QUESTION', confidence: 0.97, language: 'th',
        semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ดูยอดรายจ่ายเดือนนี้', requiredEvidence: [],
          requestedFilters: {}, dependsOn: [], evidenceRefs: [ref] }] });
      const request = baseRequest({ messageText: rawText, inputEvidence: built.inputEvidence });
      const accepted = await new IntentRouterAgent({ generateText: async (input) => {
        const payload = JSON.parse(input.messages[0]!.text);
        assert.equal(payload.messageText, rawText);
        assert.equal(payload.inputEvidenceParts[0].rawText, rawText);
        assert.deepEqual(payload.inputEvidenceParts[0].fullPartRef, expectedRef);
        assert.ok(input.systemPrompt);
        assert.match(input.systemPrompt, /Never write hashes or offsets; the server derives them from current inputEvidenceParts/);
        return { ok: true as const, text: JSON.stringify(answer(payload.inputEvidenceParts[0].fullPartRef)) };
      } }).routeIntake(request);
      assert.equal(accepted.status, 'ROUTED');
      assert.deepEqual(accepted.semanticSubrequests?.[0]?.evidenceRefs, [expectedRef]);
      for (const invalid of [
        { ...expectedRef, endUtf16: rawText.length + 2 },
        { ...expectedRef, rawSha256: 'b'.repeat(64) },
        { ...expectedRef, partId: 'another-part' },
        ...(rawText.startsWith('😀') ? [{ ...expectedRef, endUtf16: 1 }] : []),
      ]) {
        const rejected = await new IntentRouterAgent(modelAnswer(answer(invalid))).routeIntake(request);
        assert.equal(rejected.errorCode, 'ROUTER_SEMANTIC_SCHEMA_INVALID', 'no clamping, rebinding or hash repair');
      }
    }
  });

  it('offers separate source refs for buffered parts and leaves empty parts and legacy prompts unchanged', async () => {
    const built = await createLineAiInputEvidence({ turnKey: 'parts-turn', parts: ['ดูรายจ่าย', '', 'เฉพาะที่ยืนยันแล้ว'].map((rawText, index) => ({
      partId: `part-${index}`, eventIdHash: String(index + 1).repeat(64), acceptedAtMs: index, rawText,
    })) });
    assert.ok(built);
    const refs = built.inputEvidence.parts.filter(part => part.rawText.length).map(part => ({ partId: part.partId,
      startUtf16: 0, endUtf16: part.rawText.length, rawSha256: part.rawSha256 }));
    const capture: { input?: ProviderInput } = {};
    const plan = await new IntentRouterAgent(modelAnswer({ intent: 'BUSINESS_READ_QUESTION', confidence: 0.95,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'รายจ่ายยืนยันแล้ว', requiredEvidence: [], requestedFilters: {},
        dependsOn: [], evidenceRefs: refs }] }, capture)).routeIntake(baseRequest({ ...built }));
    assert.equal(plan.status, 'ROUTED');
    const payload = JSON.parse(capture.input!.messages[0]!.text);
    assert.equal(payload.inputEvidenceParts[1].fullPartRef, undefined, 'empty input cannot provide a nonempty evidence span');
    assert.deepEqual(payload.inputEvidenceParts.filter((part: { rawText: string }) => part.rawText).map((part: { fullPartRef: unknown }) => part.fullPartRef), refs);
    assert.doesNotMatch(intakeRouterSystemPrompt({}, false, false), /fullPartRef/);
  });

  it('uses only the selected retained write clause while keeping the live selection input unchanged', async () => {
    const oldText = 'บันทึกค่ากาแฟ 120 บาท วันที่ 26/9/2569\nบันทึกค่าเดินทาง 999 บาท';
    const old = await createLineAiInputEvidence({ turnKey: 'old-turn', parts: [{ partId: 'old-part', eventIdHash: 'a'.repeat(64),
      acceptedAtMs: Date.parse('2026-09-27T01:00:00Z'), rawText: oldText }] });
    const current = await createLineAiInputEvidence({ turnKey: 'current-turn', parts: [{ partId: 'current-part', eventIdHash: 'b'.repeat(64),
      acceptedAtMs: Date.parse('2026-09-27T02:00:00Z'), rawText: 'ทำข้อ1ก่อน' }] });
    assert.ok(old && current);
    const retainedTaskSource = await verifyLineAiRetainedTaskSource({
      taskRef: { taskId: 'task-1', taskRevision: 3, subrequestIndex: 0 }, inputEvidence: old.inputEvidence,
      semanticSubrequest: { index: 1, kind: 'write', writeIntent: 'EXPENSE_DOCUMENT_CAPTURE', goal: 'บันทึกค่ากาแฟ',
        requiredEvidence: [], requestedFilters: {}, dependsOn: [0], evidenceRefs: [{ partId: 'old-part', startUtf16: 0,
          endUtf16: oldText.indexOf('\n'), rawSha256: old.inputEvidence.parts[0]!.rawSha256 }] },
    });
    assert.ok(retainedTaskSource);
    const taskProjection = { version: 2 as const, stateVersion: 1, lifecycleEpoch: 0, expiresAtMs: Date.now() + 60_000,
      tasks: [{ taskId: 'task-1', revision: 3, kind: 'write' as const, state: 'paused' as const, userGoal: 'เลือกงาน',
        subrequests: [{ index: 0, kind: 'write' as const, goal: 'บันทึกค่ากาแฟ', status: 'pending' as const }] }] };
    const semanticSubrequests = [{ index: 0, kind: 'write', writeIntent: 'EXPENSE_DOCUMENT_CAPTURE', goal: 'บันทึกค่ากาแฟ',
      requiredEvidence: [], requestedFilters: {}, dependsOn: [], taskRef: retainedTaskSource.taskRef,
      evidenceRefs: [{ partId: 'current-part', startUtf16: 0, endUtf16: current.messageText.length,
        rawSha256: current.inputEvidence.parts[0]!.rawSha256 }] }];

    const capture: { input?: ProviderInput } = {};
    const accepted = await new IntentRouterAgent(modelAnswer({ intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95,
      captureHints: { amount: '120', description: 'ค่ากาแฟ', expenseDate: '2026-09-26' }, semanticSubrequests }, capture)).routeIntake(baseRequest({
        messageText: current.messageText, inputEvidence: current.inputEvidence, taskProjection, retainedTaskSource,
      }));
    assert.equal(accepted.captureHints?.amount, '120');
    assert.equal(accepted.captureHints?.description, 'ค่ากาแฟ');
    assert.equal(accepted.captureHints?.expenseDate, '2026-09-26');
    const payload = JSON.parse(capture.input?.messages[0]?.text ?? '{}');
    assert.equal(payload.messageText, 'ทำข้อ1ก่อน');
    assert.equal(payload.inputEvidenceParts[0].rawText, 'ทำข้อ1ก่อน');
    assert.match(payload.retainedTaskSource.selectedClause.text, /ค่ากาแฟ 120/);
    assert.doesNotMatch(payload.retainedTaskSource.selectedClause.text, /999|ค่าเดินทาง/);
    assert.deepEqual(payload.retainedTaskSource.selectedClause.valueCandidates.amounts.map((item: { value: string }) => item.value), ['120']);

    const forbidden = await new IntentRouterAgent(modelAnswer({ intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95,
      captureHints: { amount: '999', description: 'ค่าเดินทาง' }, semanticSubrequests })).routeIntake(baseRequest({
        messageText: current.messageText, inputEvidence: current.inputEvidence, taskProjection, retainedTaskSource,
      }));
    assert.equal(forbidden.captureHints?.amount, undefined);
    assert.equal(forbidden.captureHints?.description, undefined);

    let paidCalls = 0;
    const tampered = structuredClone(retainedTaskSource);
    tampered.inputEvidence.parts[0]!.rawText = oldText.replace('120', '121');
    const rejected = await new IntentRouterAgent({ generateText: async () => {
      paidCalls += 1;
      return { ok: true as const, text: '{}' };
    } }).routeIntake(baseRequest({
      messageText: current.messageText, inputEvidence: current.inputEvidence, taskProjection, retainedTaskSource: tampered,
    }));
    assert.equal(rejected.errorCode, 'AI_CONTRACT_UNSUPPORTED');
    assert.equal(paidCalls, 0, 'tampered historical evidence is rejected before the provider');
  });

  it('routes a standalone signature-like image to SIGNATURE_UPLOAD_TICKET and passes the image to the model', async () => {
    const capture: { input?: ProviderInput } = {};
    const router = new IntentRouterAgent(modelAnswer(
      { intent: 'SIGNATURE_UPLOAD_TICKET', language: 'th', confidence: 0.93, reason: 'handwritten signature strokes on blank background' },
      capture,
    ));
    const plan = await router.routeIntake(baseRequest({
      messageText: '',
      attachments: [{ id: 'att-1', mimeType: 'image/png', purpose: 'unknown', contentBase64: 'aW1n' }],
    }));
    assert.equal(plan.status, 'ROUTED');
    assert.equal(plan.intent, 'SIGNATURE_UPLOAD_TICKET');
    assert.equal(capture.input?.images?.length, 1);
    // Cost benchmark R3 (2026-09-17): an attachment turn is asked for the DOCUMENT capture-hint
    // schema, so the expected prompt is the image variant of the same legacy prompt. Everything else
    // about it — routes, classification, documentText — is byte-identical to the text one.
    assert.equal(capture.input?.systemPrompt, intakeRouterSystemPrompt({}, true));
    assert.match(LINE_INTAKE_ROUTER_SYSTEM_PROMPT, /multiple independent expense transactions/);
    // R3 invariants: the document schema drops the fields the media path discards, and never touches
    // the transcription contract.
    const imagePrompt = intakeRouterSystemPrompt({}, true);
    assert.ok(!imagePrompt.includes('"items": [{'), 'a document turn is not asked to itemise twice');
    assert.match(imagePrompt, /Do NOT return vendorName, description, amount, expenseDate, vatMode, items or missingFields/);
    assert.match(imagePrompt, /"documentText": "images only: the page transcribed verbatim as markdown/);
    assert.ok(LINE_INTAKE_ROUTER_SYSTEM_PROMPT.includes('"items": [{'), 'a text capture still returns every item');
    const payload = JSON.parse(capture.input?.messages[0]?.text ?? '{}');
    assert.equal(payload.attachments[0]?.hasImageContent, true);
    assert.ok(!capture.input?.messages[0]?.text.includes('aW1n'), 'image bytes must not leak into the text payload');
  });

  it('routes natural signature wording with image to SIGNATURE_UPLOAD_TICKET without any keyword gate in code', async () => {
    // Unseen phrasing: the router must rely on the model, so arbitrary new wording flows through unchanged.
    const capture: { input?: ProviderInput } = {};
    const router = new IntentRouterAgent(modelAnswer(
      { intent: 'SIGNATURE_UPLOAD_TICKET', language: 'th', confidence: 0.88 },
      capture,
    ));
    const novelWording = 'ฝากเก็บตัวเซ็นชื่อของเฮียไว้ใช้แปะเอกสารทีนะ';
    const plan = await router.routeIntake(baseRequest({
      messageText: novelWording,
      attachments: [{ id: 'att-2', mimeType: 'image/jpeg', purpose: 'unknown', contentBase64: 'aW1n' }],
    }));
    assert.equal(plan.intent, 'SIGNATURE_UPLOAD_TICKET');
    const payload = JSON.parse(capture.input?.messages[0]?.text ?? '{}');
    assert.equal(payload.messageText, novelWording);
  });

  it('routes receipt/slip/marketplace images to EXPENSE_DOCUMENT_CAPTURE with bounded capture hints', async () => {
    const router = new IntentRouterAgent(modelAnswer({
      intent: 'EXPENSE_DOCUMENT_CAPTURE',
      language: 'th',
      confidence: 0.95,
      captureHints: {
        sourceDocumentType: 'MARKETPLACE_ORDER_SCREENSHOT',
        sourceDocumentLanguage: 'th',
        vendorName: 'ร้านค้า Shopee',
        amount: '350.00',
        expenseCategoryId: 'cat-meals',
        confidence: 0.9,
        missingFields: ['vendorTaxId'],
        ignoredField: 'must not pass through',
      },
    }));
    const plan = await router.routeIntake(baseRequest({
      messageText: 'ซื้อของ Shopee',
      attachments: [{ id: 'att-3', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'aW1n' }],
    }));
    assert.equal(plan.intent, 'EXPENSE_DOCUMENT_CAPTURE');
    assert.equal(plan.captureHints?.sourceDocumentType, 'MARKETPLACE_ORDER_SCREENSHOT');
    assert.equal(plan.captureHints?.amount, '350.00');
    assert.equal(plan.captureHints?.expenseCategoryId, 'cat-meals');
    assert.ok(!('ignoredField' in (plan.captureHints ?? {})));
  });

  it('maps a free-text answer to a durable expense draft and preserves every bounded item hint', async () => {
    const capture: { input?: ProviderInput } = {};
    const router = new IntentRouterAgent(modelAnswer({
      intent: 'EXPENSE_DRAFT_CONTINUATION', language: 'th', confidence: 0.96,
      captureHints: {
        targetExpenseId: 'expense-1',
        items: [
          { itemRef: 'I01', sourceText: 'กระดาษ 5 รีม รวม 650 บาท', description: 'กระดาษ', quantity: '5', unit: 'รีม', totalAmount: '650', expenseCategoryId: 'cat-travel', accountingClass: 'OPEX' },
          { itemRef: 'I02', sourceText: 'โน้ตบุ๊ก', description: 'โน้ตบุ๊ก', itemBehavior: 'NON_STOCK', missingFields: ['category'] },
        ],
      },
    }, capture));
    const plan = await router.routeIntake(baseRequest({
      messageText: 'I01 กระดาษ 5 รีม รวม 650 บาท ส่วนโน้ตบุ๊กยังเหมือนเดิม',
      activeExpenseDrafts: [{
        expenseId: 'expense-1', label: 'ร่าง expense-1', status: 'PAUSED',
        questions: [
          { id: 'I01-QTY', itemRef: 'I01', prompt: 'กระดาษจำนวนเท่าไร?' },
          { id: 'I01-PRICE', itemRef: 'I01', prompt: 'กระดาษราคาเท่าไร?' },
        ],
      }],
    }));
    assert.equal(plan.intent, 'EXPENSE_DRAFT_CONTINUATION');
    assert.equal(plan.captureHints?.targetExpenseId, 'expense-1');
    assert.equal(plan.captureHints?.items?.length, 2);
    assert.equal(plan.captureHints?.items?.[0]?.quantity, '5');
    assert.equal(plan.captureHints?.items?.[1]?.itemBehavior, 'NON_STOCK');
    const payload = JSON.parse(capture.input?.messages[0]?.text ?? '{}');
    assert.equal(payload.activeExpenseDrafts[0].questions[0].id, 'I01-QTY');
  });

  it('strips a continuation target the API never offered', async () => {
    const router = new IntentRouterAgent(modelAnswer({
      intent: 'EXPENSE_DRAFT_CONTINUATION', language: 'th', confidence: 0.9,
      captureHints: { targetExpenseId: 'expense-other', items: [{ itemRef: 'I01', quantity: '5' }] },
    }));
    const plan = await router.routeIntake(baseRequest({
      messageText: '5 ชิ้น',
      activeExpenseDrafts: [{ expenseId: 'expense-1', label: 'ร่าง 1', status: 'OPEN', questions: [] }],
    }));
    assert.equal(plan.intent, 'EXPENSE_DRAFT_CONTINUATION');
    assert.equal(plan.captureHints?.targetExpenseId, undefined);
  });

  it('routes a PDF attachment via metadata to EXPENSE_DOCUMENT_CAPTURE without inline bytes', async () => {
    const capture: { input?: ProviderInput } = {};
    const router = new IntentRouterAgent(modelAnswer(
      {
        intent: 'EXPENSE_DOCUMENT_CAPTURE',
        language: 'th',
        confidence: 0.85,
        captureHints: { sourceDocumentType: 'TAX_INVOICE', sourceDocumentLanguage: 'th' },
      },
      capture,
    ));
    const plan = await router.routeIntake(baseRequest({
      messageText: 'ใบกำกับภาษีจากซัพพลายเออร์ครับ',
      attachments: [{ id: 'att-pdf', mimeType: 'application/pdf', purpose: 'receipt' }],
    }));
    assert.equal(plan.status, 'ROUTED');
    assert.equal(plan.intent, 'EXPENSE_DOCUMENT_CAPTURE');
    // PDFs cannot be sent as image blocks; the model must still see their metadata.
    assert.equal(capture.input?.images, undefined);
    const payload = JSON.parse(capture.input?.messages[0]?.text ?? '{}');
    assert.equal(payload.attachments[0]?.mimeType, 'application/pdf');
    assert.equal(payload.attachments[0]?.purpose, 'receipt');
    assert.equal(payload.attachments[0]?.hasImageContent, false);
  });

  it('routes quotations and scheduling documents to BUSINESS_DOCUMENT_REFERENCE with strict classification', async () => {
    const router = new IntentRouterAgent(modelAnswer({
      intent: 'BUSINESS_DOCUMENT_REFERENCE',
      language: 'th',
      confidence: 0.94,
      documentClassification: documentClassification(),
    }));
    const plan = await router.routeIntake(baseRequest({
      messageText: 'ช่วยดูใบเสนอราคานี้',
      attachments: [{ id: 'quotation', mimeType: 'image/jpeg', purpose: 'unknown', contentBase64: 'aW1n' }],
    }));
    assert.equal(plan.intent, 'BUSINESS_DOCUMENT_REFERENCE');
    assert.equal(plan.documentClassification?.documentKind, 'QUOTATION');
    assert.equal(plan.captureHints, undefined);
  });

  it('fails closed for unknown classification enums and clarifies low-confidence references', async () => {
    const unknown = new IntentRouterAgent(modelAnswer({
      intent: 'BUSINESS_DOCUMENT_REFERENCE', language: 'th', confidence: 0.9,
      documentClassification: { ...documentClassification(), documentKind: 'MAGIC_DOCUMENT' },
    }));
    const badPlan = await unknown.routeIntake(baseRequest({ messageText: 'เอกสารนี้คืออะไร' }));
    assert.equal(badPlan.status, 'UNAVAILABLE');
    assert.equal(badPlan.errorCode, 'ROUTER_JSON_PARSE_FAILED');

    const lowConfidence = new IntentRouterAgent(modelAnswer({
      intent: 'BUSINESS_DOCUMENT_REFERENCE', language: 'th', confidence: 0.9,
      documentClassification: documentClassification({ confidence: 0.3 }),
    }));
    const clarifyPlan = await lowConfidence.routeIntake(baseRequest({ messageText: 'เอกสารนี้คืออะไร' }));
    assert.equal(clarifyPlan.intent, 'CLARIFY');
    assert.equal(clarifyPlan.documentClassification?.requiresClarification, true);
  });

  it('routes text-only spend notes to EXPENSE_DOCUMENT_CAPTURE with semantic hints', async () => {
    const router = new IntentRouterAgent(modelAnswer({
      intent: 'EXPENSE_DOCUMENT_CAPTURE',
      language: 'th',
      confidence: 0.9,
      captureHints: { sourceDocumentType: 'EXPENSE_NOTE_TEXT', description: 'ค่ากาแฟ', amount: '65', expenseCategoryId: 'cat-meals' },
    }));
    const plan = await router.routeIntake(baseRequest({ messageText: 'ค่ากาแฟ 65 บาท' }));
    assert.equal(plan.intent, 'EXPENSE_DOCUMENT_CAPTURE');
    assert.equal(plan.captureHints?.amount, '65');
  });

  it('downgrades low-confidence draft/ticket routes to CLARIFY instead of acting', async () => {
    const router = new IntentRouterAgent(modelAnswer({
      intent: 'SIGNATURE_UPLOAD_TICKET', language: 'th', confidence: 0.35, reason: 'unclear image',
    }));
    const plan = await router.routeIntake(baseRequest({
      messageText: '',
      attachments: [{ id: 'att-4', mimeType: 'image/jpeg', purpose: 'unknown', contentBase64: 'aW1n' }],
    }));
    assert.equal(plan.intent, 'CLARIFY');
    assert.equal(plan.captureHints, undefined);
  });

  it('routes a correction of an already-captured record away from capture', async () => {
    const capture: { input?: ProviderInput } = {};
    const router = new IntentRouterAgent(modelAnswer({
      intent: 'EXPENSE_CAPTURE_CORRECTION', language: 'th', confidence: 0.93, reason: 'fixes the document date',
    }, capture));

    const plan = await router.routeIntake(baseRequest({
      messageText: 'วันที่ออกสารผิดนะ ต้องเป็นวันที่ 20 กรกฎาคม 2569',
      recentCapturedExpenses: [
        { id: 'expense-1', label: 'บิลเงินสดเขียนมือ · 17 มิ.ย. 2569 · 59.00', amount: '59.00', expenseDate: '2026-06-17', createdAt: '2026-08-03T13:01:00.000Z' },
      ],
    }));

    assert.equal(plan.intent, 'EXPENSE_CAPTURE_CORRECTION');
    assert.equal(plan.captureHints, undefined);
    // The candidate list must reach the model as data, so it can recognise the target.
    assert.match(capture.input?.messages[0]?.text ?? '', /recentCapturedExpenses/);
  });

  it('keeps correction hints only for a target it was actually offered', async () => {
    const router = new IntentRouterAgent(modelAnswer({
      intent: 'EXPENSE_CAPTURE_CORRECTION', language: 'th', confidence: 0.92,
      correctionHints: {
        targetExpenseId: 'expense-never-offered',
        expenseDate: { to: '2026-07-20', from: '2026-06-17' },
        amount: { to: '' },
        expenseCategoryId: 'cat-meals',
      },
    }));

    const plan = await router.routeIntake(baseRequest({
      messageText: 'วันที่ผิด ต้องเป็น 20 ก.ค. 2569',
      recentCapturedExpenses: [{ id: 'expense-1', label: 'บิลเงินสดเขียนมือ · 17 มิ.ย. 2569', createdAt: '2026-08-03T13:01:00.000Z' }],
    }));

    assert.equal(plan.correctionHints?.targetExpenseId, undefined, 'a target we never offered is not a target');
    assert.ok(plan.correctionHints?.missingFields?.includes('targetExpenseId'));
    assert.deepEqual(plan.correctionHints?.expenseDate, { to: '2026-07-20', from: '2026-06-17' });
    assert.equal(plan.correctionHints?.amount, undefined, 'an empty value is not a correction');
    assert.ok(plan.correctionHints?.missingFields?.includes('amount'));
    assert.equal((plan.correctionHints as Record<string, unknown>)?.['expenseCategoryId'], undefined, 'deferred fields never reach the API');
  });

  it('drops correction hints entirely when the route is not a correction', async () => {
    const router = new IntentRouterAgent(modelAnswer({
      intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.9,
      correctionHints: { targetExpenseId: 'expense-1', amount: { to: '590' } },
    }));

    const plan = await router.routeIntake(baseRequest({
      messageText: 'ค่ากาแฟ 65 บาท',
      recentCapturedExpenses: [{ id: 'expense-1', label: 'x', createdAt: '2026-08-03T13:01:00.000Z' }],
    }));

    assert.equal(plan.correctionHints, undefined);
  });

  it('downgrades a low-confidence correction to CLARIFY with correction copy, not the resend-evidence template', async () => {
    const router = new IntentRouterAgent(modelAnswer({
      intent: 'EXPENSE_CAPTURE_CORRECTION', language: 'th', confidence: 0.4, reason: 'unsure which record',
    }));

    const plan = await router.routeIntake(baseRequest({ messageText: 'แก้ให้หน่อย' }));

    assert.equal(plan.intent, 'CLARIFY');
    assert.equal(plan.captureHints, undefined);
    assert.match(plan.clarifyQuestion ?? '', /แก้ไขรายการไหน/);
  });

  it('keeps only clarification ids that this request actually offered', async () => {
    const router = new IntentRouterAgent(modelAnswer({
      intent: 'EXPENSE_CAPTURE_CORRECTION', language: 'th', confidence: 0.9,
      resolvedClarificationIds: ['entry-1', 'entry-forged', 'entry-1'],
    }));

    const plan = await router.routeIntake(baseRequest({
      messageText: '20 กรกฎาคม 2569',
      openClarifications: [{
        id: 'entry-1', question: 'วันที่ 20 หมายถึงเดือนและปีใด', text: 'วันที่ออกสารผิดนะ ต้องเป็นวันที่20',
        askedAt: '2026-08-03T13:03:00.000Z', clarifyForIntent: 'EXPENSE_CAPTURE_CORRECTION', candidateExpenseIds: ['expense-1'],
      }],
    }));

    assert.deepEqual(plan.resolvedClarificationIds, ['entry-1']);
  });

  it('drops resolved clarification ids when the request carried none', async () => {
    const router = new IntentRouterAgent(modelAnswer({
      intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9, resolvedClarificationIds: ['entry-1'],
    }));

    const plan = await router.routeIntake(baseRequest({ messageText: 'ยอดขายวันนี้เท่าไหร่' }));

    assert.equal(plan.resolvedClarificationIds, undefined);
  });

  it('keeps model-declared CLARIFY for ambiguous image/text', async () => {
    const router = new IntentRouterAgent(modelAnswer({ intent: 'CLARIFY', language: 'th', confidence: 0.9 }));
    const plan = await router.routeIntake(baseRequest({ messageText: 'อันนี้', attachments: [{ id: 'a', mimeType: 'image/png', purpose: 'unknown', contentBase64: 'aW1n' }] }));
    assert.equal(plan.intent, 'CLARIFY');
  });

  it('routes final mutation requests to MUTATION_REQUEST_REFUSAL', async () => {
    const router = new IntentRouterAgent(modelAnswer({ intent: 'MUTATION_REQUEST_REFUSAL', language: 'th', confidence: 0.97 }));
    const plan = await router.routeIntake(baseRequest({ messageText: 'อนุมัติจ่ายเงินบิลนี้เลย' }));
    assert.equal(plan.intent, 'MUTATION_REQUEST_REFUSAL');
  });

  it('returns typed UNAVAILABLE when provider is disabled – no keyword fallback', async () => {
    const router = new IntentRouterAgent(new DisabledProvider());
    const plan = await router.routeIntake(baseRequest({ messageText: 'ใบเสร็จค่าน้ำมัน 500 บาท' }));
    assert.equal(plan.status, 'UNAVAILABLE');
    assert.equal(plan.errorCode, 'PROVIDER_DISABLED');
    assert.equal(plan.confidence, 0);
  });

  it('returns typed UNAVAILABLE when the model emits an unknown intent or broken JSON', async () => {
    const badIntent = new IntentRouterAgent(modelAnswer({ intent: 'DO_EVERYTHING', language: 'th', confidence: 1 }));
    const badJson = new IntentRouterAgent({ generateText: async () => ({ ok: true as const, text: 'not json at all' }) });
    for (const router of [badIntent, badJson]) {
      const plan = await router.routeIntake(baseRequest({ messageText: 'x' }));
      assert.equal(plan.status, 'UNAVAILABLE');
      assert.equal(plan.errorCode, 'ROUTER_JSON_PARSE_FAILED');
    }
  });

  it('routes business questions to BUSINESS_READ_QUESTION so the normal turn path answers', async () => {
    const router = new IntentRouterAgent(modelAnswer({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.92 }));
    const plan = await router.routeIntake(baseRequest({ messageText: 'เดือนนี้ใช้เงินไปเท่าไหร่' }));
    assert.equal(plan.intent, 'BUSINESS_READ_QUESTION');
  });
});

// ── Item 10F: input-side value membership guards ─────────────────────────────
// The mirror of the composer's output number guard: when deterministic candidates exist for
// the turn text, model-written amount/expenseDate hints must SELECT one of them.

import { extractValueCandidates } from '@watchdog-bms/contracts';

const TODAY = '2026-07-07';

function captureAnswer(hints: Record<string, unknown>) {
  return {
    intent: 'EXPENSE_DOCUMENT_CAPTURE',
    language: 'th',
    confidence: 0.95,
    captureHints: { sourceDocumentType: 'EXPENSE_NOTE_TEXT', ...hints },
  };
}

describe('LINE intake router – value candidate guards (item 10F)', () => {
  it('strips a corrupted amount (600 for หกสิบ) to missingFields – draft stays NEEDS_REVIEW-safe', async () => {
    const text = 'บันทึกเงินหกสิบบาท';
    const router = new IntentRouterAgent(modelAnswer(captureAnswer({ amount: '600.00' })));
    const plan = await router.routeIntake(baseRequest({ messageText: text, valueCandidates: extractValueCandidates(text, TODAY) }));
    assert.equal(plan.intent, 'EXPENSE_DOCUMENT_CAPTURE');
    assert.equal(plan.captureHints?.amount, undefined);
    assert.ok(plan.captureHints?.missingFields?.includes('amount'));
  });

  it('keeps an amount that selects a candidate, including honest reformatting (60.00 = หกสิบ)', async () => {
    const text = 'บันทึกเงินหกสิบบาท';
    const router = new IntentRouterAgent(modelAnswer(captureAnswer({ amount: '60.00' })));
    const plan = await router.routeIntake(baseRequest({ messageText: text, valueCandidates: extractValueCandidates(text, TODAY) }));
    assert.equal(plan.captureHints?.amount, '60.00');
  });

  it('strips a Buddhist-era-corrupted expenseDate (2537-12-09) and keeps the selected amount', async () => {
    const text = 'บันทึกบิล 9/12/2537 หกสิบบาท';
    const router = new IntentRouterAgent(modelAnswer(captureAnswer({ amount: '60', expenseDate: '2537-12-09' })));
    const plan = await router.routeIntake(baseRequest({ messageText: text, valueCandidates: extractValueCandidates(text, TODAY) }));
    assert.equal(plan.intent, 'EXPENSE_DOCUMENT_CAPTURE');
    assert.equal(plan.captureHints?.expenseDate, undefined);
    assert.ok(plan.captureHints?.missingFields?.includes('expenseDate'));
    assert.equal(plan.captureHints?.amount, '60');
  });

  it('keeps an expenseDate that selects the candidate ISO reading (9/12/2537 → 1994-12-09)', async () => {
    const text = 'บันทึกบิล 9/12/2537 หกสิบบาท';
    const router = new IntentRouterAgent(modelAnswer(captureAnswer({ amount: '60', expenseDate: '1994-12-09' })));
    const plan = await router.routeIntake(baseRequest({ messageText: text, valueCandidates: extractValueCandidates(text, TODAY) }));
    assert.equal(plan.captureHints?.expenseDate, '1994-12-09');
  });

  it('downgrades an ambiguous two-digit-year date (9/11/37) to ONE clarify naming the readings', async () => {
    const text = 'บันทึกบิล 9/11/37 หกสิบบาท';
    const router = new IntentRouterAgent(modelAnswer(captureAnswer({ amount: '60', expenseDate: '1994-11-09' })));
    const plan = await router.routeIntake(baseRequest({ messageText: text, valueCandidates: extractValueCandidates(text, TODAY) }));
    assert.equal(plan.intent, 'CLARIFY');
    assert.equal(plan.captureHints, undefined);
    assert.ok(plan.clarifyQuestion?.includes('2537'), 'clarify names the พ.ศ. 2537 reading');
    assert.ok(plan.clarifyQuestion?.includes('2580'), 'clarify names the พ.ศ. 2580 reading');
  });

  it('leaves hints unguarded when the request carries no candidates (image-only path unchanged)', async () => {
    const router = new IntentRouterAgent(modelAnswer(captureAnswer({ amount: '350.00', expenseDate: '2026-07-01' })));
    const plan = await router.routeIntake(baseRequest({ messageText: '' }));
    assert.equal(plan.captureHints?.amount, '350.00');
    assert.equal(plan.captureHints?.expenseDate, '2026-07-01');
  });

  it('passes valueCandidates through to the model payload as DATA', async () => {
    const text = 'บันทึกเงินหกสิบบาท';
    const capture: { input?: ProviderInput } = {};
    const router = new IntentRouterAgent(modelAnswer(captureAnswer({ amount: '60' }), capture));
    const candidates = extractValueCandidates(text, TODAY);
    await router.routeIntake(baseRequest({ messageText: text, valueCandidates: candidates }));
    const payload = JSON.parse(capture.input?.messages[0]?.text ?? '{}');
    assert.deepEqual(payload.valueCandidates, candidates);
    assert.ok(LINE_INTAKE_ROUTER_SYSTEM_PROMPT.includes('valueCandidates'), 'prompt explains candidate selection');
  });
});

it('preserves full correction field proposals for API field-specific validation', async () => {
  const note = 'ก'.repeat(500);
  const vendor = 'ข'.repeat(201);
  const router = new IntentRouterAgent(modelAnswer({ intent: 'EXPENSE_CAPTURE_CORRECTION', language: 'th', confidence: 0.95,
    correctionHints: { note: { to: note }, vendorName: { to: vendor } } }));
  const plan = await router.routeIntake(baseRequest({ messageText: `${note} ${vendor}` }));
  assert.equal(plan.correctionHints?.note?.to, note);
  assert.equal(plan.correctionHints?.vendorName?.to, vendor);
});

it('preserves evidence association in the compact write inventory rather than creating another capture', async () => {
  const text = 'สลิปโอนเงินเป็นหลักฐานของค่าใช้จ่ายเมื่อกี้';
  const created = await createLineAiInputEvidence({ turnKey: 'evidence-link-compact', parts: [
    { partId: 'p0', eventIdHash: 'c'.repeat(64), acceptedAtMs: Date.now(), rawText: text },
  ] });
  assert.ok(created);
  const router = new IntentRouterAgent(modelAnswer({ intent: 'EXPENSE_PAYMENT_EVIDENCE_LINK', language: 'th', confidence: 0.98,
    decisionV1: { subrequests: [{ kind: 'write', goal: text, sources: [{ part: 0, whole: true }], filters: {}, writeIntent: 'EXPENSE_PAYMENT_EVIDENCE_LINK' }] } }));
  const result = await router.routeIntake(baseRequest({ messageText: text, inputEvidence: created.inputEvidence,
    capabilities: { fusedPlan: true } }));
  assert.equal(result.intent, 'EXPENSE_PAYMENT_EVIDENCE_LINK');
  assert.equal(result.semanticSubrequests?.[0]?.writeIntent, 'EXPENSE_PAYMENT_EVIDENCE_LINK');
});

it('R10 J6: capabilities → vendor command makes a fresh model intake with write registry guidance', async () => {
  const capture: { input?: ProviderInput } = {};
  let calls = 0;
  const provider = { generateText: async (input: ProviderInput) => {
    capture.input = input; calls += 1;
    return { ok: true as const, text: JSON.stringify(calls === 1
      ? { intent: 'UNSUPPORTED', language: 'th', confidence: 0.98, decisionV1: { subrequests: [{ kind: 'help', goal: 'ช่วยอะไรได้บ้าง', sources: [{ part: 0, whole: true }], filters: {} }] } }
      : { intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.98, decisionV1: { subrequests: [{ kind: 'write', goal: 'เพิ่มผู้ขาย บริษัท ทดสอบ จำกัด', sources: [{ part: 0, whole: true }], filters: {} }] } }) };
  } };
  const router = new IntentRouterAgent(provider);
  for (const [index, text] of ['น้องมั่งมีทำอะไรได้บ้าง', 'เพิ่มผู้ขาย บริษัท ทดสอบ จำกัด เลขผู้เสียภาษี 0105556000011'].entries()) {
    const built = (await createLineAiInputEvidence({ turnKey: `r10-j6-${index}`, parts: [{ partId: 'part-0', eventIdHash: 'a'.repeat(64), acceptedAtMs: 1, rawText: text }] }))!;
    const plan = await router.routeIntake(baseRequest({ messageText: text, inputEvidence: built.inputEvidence,
      capabilities: { fusedPlan: true, advisor: true }, offeredToolNames: ['counterparty.action.preview'],
      permissions: ['ai.tool.invoke', 'line.ai.query', 'accounting.counterparty.manage'],
      ...(index ? { conversationContext: { recentTurns: [{ userMessagePreview: 'น้องมั่งมีทำอะไรได้บ้าง', replyPreview: 'เพิ่มผู้ขายได้ค่ะ', createdAt: new Date().toISOString() }] } as any } : {}) }));
    assert.equal(plan.status, 'ROUTED'); assert.equal(plan.semanticSubrequests?.[0]?.kind, index ? 'write' : 'help');
    if (index) {
      assert.equal(plan.intent, 'BUSINESS_READ_QUESTION'); assert.equal(plan.semanticSubrequests?.[0]?.writeIntent, undefined);
      assert.match(capture.input!.systemPrompt!, /regardless of previous help, social, expense or clarification turns/);
      assert.match(JSON.stringify(capture.input), /counterparty.action.preview/);
    }
  }
  assert.equal(calls, 2);
});

// B3 uses the real acceptance/settlement decorator with a provider and money seam made of stubs.
import { AI_BUDGET_PROFILE_TABLE_DIGEST_V2, extractValueCandidatesV2, parseAiBudgetEnvelopeV2,
  type AiUsageEntry, type LineWorkflowClassifyRequest } from '@watchdog-bms/contracts';
import { appendUsage } from '../../../common/usage/usage-context';
import { v2RenderedInput, withAiBudgetEnvelope } from '../../../common/usage/ai-budget-provider';
import { WorkflowClassifierAgent, WORKFLOW_CLASSIFIER_LABELS, WORKFLOW_CLASSIFIER_SCHEMA,
  WORKFLOW_CLASSIFIER_SYSTEM_PROMPT } from './workflow-classifier.agent';
import { LINE_AI_THAI_BUSINESS_GLOSSARY } from './intent-router.agent';
import { scopePolicyOverride } from '../domain/logic/line-ai-scope-policy.logic';
import type { ProviderOutput } from '../infrastructure/provider/provider.port';

async function workflowClassifyRequest(messageText = 'ส่งใบเบิกของฉันให้อนุมัติหน่อย'): Promise<LineWorkflowClassifyRequest> {
  const admittedAtMs = Date.now();
  const built = await createLineAiInputEvidence({ turnKey: 'workflow-turn', parts: [{ partId: 'part-0',
    eventIdHash: 'a'.repeat(64), acceptedAtMs: admittedAtMs, rawText: messageText }] });
  assert.ok(built);
  return { requestId: 'workflow-request', companyId: 'private-company-data', userId: 'private-user-data', locale: 'th-TH',
    messageText, inputEvidence: built.inputEvidence, contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'],
    budgetGrantV2: { version: 2, turnKey: 'workflow-turn', authorityKind: 'webhook_classify', authorityId: 'event-1',
      channelOwnerDigest: 'b'.repeat(64), attemptKey: 'classify-attempt', monthKey: '2026-11', payerCompanyId: 'private-company-data',
      model: { provider: 'bedrock', modelId: 'test-model', region: 'ap-southeast-1' }, allowedProfileIds: ['line-classify/2'],
      profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2, maxTurnSlots: 2, maxRepairs: 1, admittedAtMs,
      workDeadlineAtMs: admittedAtMs + 5000, finalDeadlineAtMs: admittedAtMs + 8000, nonce: 'nonce', issuerVersion: 'test:1', nextOrdinal: 0, signature: 'c'.repeat(64) } };
}

function workflowAnswer(overrides: Record<string, unknown> = {}) {
  return { label: 'reimbursement_submit', second_label: 'none', confidence: 0.99, second_confidence: 0,
    reference: 'this', ordinal: 0, person_name: '', vendor_name: '', description_text: '', amount_text: '',
    date_text: '', reason_text: '', category_text: '', ...overrides };
}

async function runWorkflowClassifier(request: LineWorkflowClassifyRequest,
  answer: (input: ProviderInput) => Promise<ProviderOutput>, afterSettle?: () => void) {
  const inputs: ProviderInput[] = [], settled: AiUsageEntry[] = [];
  const provider = withAiBudgetEnvelope({ generateText: async input => {
    inputs.push(input);
    appendUsage({ tag: 'line.workflow-classify', modelId: 'test-model', ok: true, inputTokens: 100, outputTokens: 50,
      cacheReadInputTokens: 0, cacheWriteInputTokens: 0, durationMs: 1, usageBasis: 'PROVIDER_REPORTED' });
    return answer(input);
  } }, { modelId: 'test-model', companyId: request.companyId, log() {}, seam: {
    step: async () => { throw new Error('legacy seam must not run'); },
    stepV2: async invocation => {
      const envelope = parseAiBudgetEnvelopeV2({ ...invocation, version: 2, reservationId: 'reservation-1',
        invocationKey: `${request.companyId}#classify-attempt#provider-v2#${invocation.ordinal}`, tariffVersion: 'test:1' });
      assert.ok(envelope);
      return { ok: true, envelope };
    },
    settle: async input => { settled.push(structuredClone(input.entry)); afterSettle?.(); return 'recorded'; },
  } });
  const response = await runWithUsageContext({ companyId: request.companyId, budget: { status: 'active-v2',
    grant: request.budgetGrantV2, inputDigest: request.inputEvidence.joinedSha256, sourceRoute: 'line-workflow-classify',
    calls: 0, repairCount: 0 } }, () => new WorkflowClassifierAgent(provider).classify(request));
  return { response, inputs, settled };
}

const workflowOutput = (answer = workflowAnswer()): ProviderOutput => ({ ok: true, text: JSON.stringify(answer),
  completion: 'complete', schemaEnforcement: 'output_config' });

describe('B3 one-call workflow classifier', () => {
  it('uses a stable cacheable prompt with no shop data and a rendered bound within the classify profile', async () => {
    assert.ok(WORKFLOW_CLASSIFIER_SYSTEM_PROMPT.length >= 4000);
    assert.ok(Buffer.byteLength(WORKFLOW_CLASSIFIER_SYSTEM_PROMPT, 'utf8') <= 8000);
    assert.ok(WORKFLOW_CLASSIFIER_SYSTEM_PROMPT.includes(JSON.stringify(LINE_AI_THAI_BUSINESS_GLOSSARY)));
    const request = await workflowClassifyRequest();
    const first = await runWorkflowClassifier(request, async () => workflowOutput());
    const second = await runWorkflowClassifier(await workflowClassifyRequest('ค่าใช้จ่ายของร้านลับ'), async () => workflowOutput());
    assert.equal(first.response.status, 'CLASSIFIED', JSON.stringify(first.response));
    assert.equal(first.inputs.length, 1);
    const input = first.inputs[0]!;
    assert.equal(input.systemPrompt, second.inputs[0]!.systemPrompt);
    assert.doesNotMatch(input.systemPrompt!, /private-company-data|private-user-data|ร้านลับ|workflow-request/);
    assert.equal(input.messages[0]!.text, request.messageText);
    assert.equal(input.maxTokens, 256);
    assert.equal(input.usageTag, 'line.workflow-classify');
    assert.deepEqual(input.outputSchema, { name: 'line_workflow_classifier', schema: WORKFLOW_CLASSIFIER_SCHEMA });
    assert.ok(input.deadlineAt! <= Date.now() + 4000);
    assert.ok(input.signal instanceof AbortSignal);
    assert.ok(v2RenderedInput({ ...input, messages: [{ role: 'user', text: 'ก'.repeat(1000) }] }).inputTokenBound <= 24576);
    assert.deepEqual(first.response.usage.map(entry => entry.ok), [true]);
  });

  it('pins the exact required schema and the closed label enum', () => {
    assert.deepEqual(WORKFLOW_CLASSIFIER_LABELS, ['reimbursement_claim', 'reimbursement_submit', 'reimbursement_cancel', 'approvals',
      'reimbursement_reject', 'reimbursement_pay', 'expense_submit', 'expense_confirm', 'expense_delete', 'expense_void',
      'expense_pay', 'payment_voucher', 'wht_certificate', 'substitute_receipt', 'read', 'howto', 'open', 'smalltalk', 'multi', 'unclear']);
    assert.equal(WORKFLOW_CLASSIFIER_SCHEMA.additionalProperties, false);
    assert.deepEqual(WORKFLOW_CLASSIFIER_SCHEMA.required, Object.keys(WORKFLOW_CLASSIFIER_SCHEMA.properties));
    assert.deepEqual(WORKFLOW_CLASSIFIER_SCHEMA.properties.confidence, { type: 'number' });
    assert.deepEqual(WORKFLOW_CLASSIFIER_SCHEMA.properties.ordinal, { type: 'integer' });
  });

  it('normalizes only exact message and candidate spans and retains the raw decision', async () => {
    const request = await workflowClassifyRequest('ทำใบเบิก ค่าแท็กซี่ 250 บาท วันนี้ ไปส่งเอกสารให้ร้าน หมวดค่าเดินทาง');
    const candidates = await extractValueCandidatesV2(request.inputEvidence, '2026-11-05');
    assert.ok(candidates?.amounts.length);
    assert.ok(candidates?.periods.some(candidate => candidate.kind === 'day'));
    const raw = workflowAnswer({ label: 'reimbursement_claim', amount_text: candidates.amounts[0]!.span,
      date_text: candidates.periods.find(candidate => candidate.kind === 'day')!.span, description_text: 'ค่าแท็กซี่', reason_text: 'ไปส่งเอกสารให้ร้าน', category_text: 'ค่าเดินทาง', person_name: 'ชื่อที่ไม่ได้พิมพ์' });
    const { response, settled } = await runWorkflowClassifier(request, async () => workflowOutput(raw));
    assert.equal(response.status, 'CLASSIFIED');
    if (response.status !== 'CLASSIFIED') return;
    assert.equal(response.slots.amountText, raw.amount_text);
    assert.equal(response.slots.dateText, raw.date_text);
    assert.equal(response.slots.descriptionText, 'ค่าแท็กซี่');
    assert.equal(response.slots.reasonText, 'ไปส่งเอกสารให้ร้าน');
    assert.equal(response.slots.categoryText, 'ค่าเดินทาง');
    assert.equal(response.slots.personName, '');
    assert.deepEqual(response.rawDecision, raw);
    assert.equal(settled[0]!.ok, true);
    const rejectedSpans = await runWorkflowClassifier(request, async () => workflowOutput(workflowAnswer({
      amount_text: '25', date_text: 'วันนี้ ไปส่งเอกสารให้ร้าน', description_text: 'ค่าแท็กซี่ที่แต่งเพิ่ม' })));
    assert.equal(rejectedSpans.response.status, 'CLASSIFIED');
    if (rejectedSpans.response.status === 'CLASSIFIED') {
      assert.equal(rejectedSpans.response.slots.amountText, '');
      assert.equal(rejectedSpans.response.slots.dateText, '');
      assert.equal(rejectedSpans.response.slots.descriptionText, '');
    }
  });

  it('normalizes a duplicate second label before consumers compare confidence', async () => {
    const raw = workflowAnswer({ second_label: 'reimbursement_submit', second_confidence: 0.98 });
    const { response } = await runWorkflowClassifier(await workflowClassifyRequest(), async () => workflowOutput(raw));
    assert.equal(response.status, 'CLASSIFIED');
    if (response.status === 'CLASSIFIED') {
      assert.equal(response.secondLabel, 'none');
      assert.equal(response.secondConfidence, 0);
      assert.equal(response.rawDecision.second_label, 'reimbursement_submit');
      assert.equal(response.rawDecision.second_confidence, 0.98);
    }
  });

  it('refuses invalid confidence, ordinal, labels or schema before settlement with no repair', async () => {
    for (const invalid of [{ confidence: 1.1 }, { confidence: -0.1 }, { second_confidence: -0.1 },
      { confidence: 0.5, second_confidence: 0.6 }, { ordinal: -1 }, { ordinal: 10 }, { ordinal: 1.5 },
      { label: 'sales' }, { second_label: 'invented' }, { extra: 'not in schema' }, { person_name: null }]) {
      const { response, inputs, settled } = await runWorkflowClassifier(await workflowClassifyRequest(), async () => workflowOutput(workflowAnswer(invalid)));
      assert.equal(response.status, 'UNAVAILABLE', JSON.stringify(invalid));
      assert.equal(inputs.length, 1);
      assert.equal(settled[0]!.ok, false, 'failure is visible before the money seam settles');
      assert.equal(response.usage[0]!.ok, false);
    }
  });

  it('absorbs provider failure, timeout, malformed JSON and a slow response', async () => {
    for (const code of ['PROVIDER_UNKNOWN', 'PROVIDER_TIMEOUT'] as const) {
      const { response, settled } = await runWorkflowClassifier(await workflowClassifyRequest(), async () =>
        ({ ok: false, error: { code, message: 'stub failure', retryable: false } }));
      assert.equal(response.status, 'UNAVAILABLE');
      assert.equal(response.usage[0]!.ok, false);
      assert.equal(settled[0]!.ok, false);
    }
    const malformed = await runWorkflowClassifier(await workflowClassifyRequest(), async () => ({ ok: true, text: '{', schemaEnforcement: 'output_config' }));
    assert.equal(malformed.response.status, 'UNAVAILABLE');
    assert.equal(malformed.settled[0]!.ok, false);
    const realNow = Date.now;
    try {
      const request = await workflowClassifyRequest();
      const slow = await runWorkflowClassifier(request, async () => {
        Date.now = () => realNow() + 4001;
        return workflowOutput();
      });
      assert.equal(slow.response.status, 'UNAVAILABLE');
      assert.equal(slow.response.usage[0]!.ok, false);
      assert.equal(slow.settled[0]!.ok, false);
    } finally { Date.now = realNow; }
  });

  it('keeps an accepted output successful when settlement consumes the remaining response time', async () => {
    const realNow = Date.now;
    try {
      const request = await workflowClassifyRequest();
      const { response, settled } = await runWorkflowClassifier(request, async () => workflowOutput(),
        () => { Date.now = () => realNow() + 4001; });
      assert.equal(settled[0]!.ok, true);
      assert.equal(response.status, 'CLASSIFIED', 'a result accepted before settlement cannot become a charged failure afterwards');
      assert.equal(response.usage[0]!.ok, true);
    } finally { Date.now = realNow; }
  });

  it('aborts at the shorter remaining grant deadline', async () => {
    const request = await workflowClassifyRequest();
    request.budgetGrantV2.workDeadlineAtMs = Date.now() + 100;
    const { response, settled, inputs } = await runWorkflowClassifier(request, input => new Promise(resolve => {
      const hold = setTimeout(() => resolve(workflowOutput()), 1000);
      input.signal!.addEventListener('abort', () => { clearTimeout(hold);
        resolve({ ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'aborted', retryable: false } }); }, { once: true });
    }));
    assert.ok(inputs[0]!.deadlineAt! <= request.budgetGrantV2.workDeadlineAtMs);
    assert.equal(response.status, 'UNAVAILABLE');
    assert.equal(response.usage[0]!.ok, false);
    assert.equal(settled[0]!.ok, false);
  });

  it('R26 non-workflow labels preserve knowledge and package replies', async () => {
    const knowledge = 'VAT 7% คิดยังไงคะ ถ้าราคาสินค้ารวมภาษีแล้ว';
    const data = 'ขอดูยอดขายของร้านเดือนนี้';
    const wht = 'ออกหนังสือรับรอง 50 ทวิให้หน่อย';
    const permissions = ['ai.tool.invoke', 'line.ai.query', 'expense.read', 'wht.certificate.issue'];
    const features = ['expenses', 'expenses.list'];
    for (const label of ['read', 'howto', 'open', 'smalltalk', 'multi', 'unclear']) {
      const text = `${knowledge} และ ${data}`;
      const { response } = await runWorkflowClassifier(await workflowClassifyRequest(text), async () => workflowOutput(workflowAnswer({ label })));
      assert.equal(response.status, 'CLASSIFIED');
      if (response.status === 'CLASSIFIED') assert.equal(response.label, label);
      assert.equal(scopePolicyOverride(knowledge, 'general', permissions, features, 'th'), undefined);
      assert.equal(scopePolicyOverride(data, 'read', permissions, features, 'th')?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
      assert.equal(scopePolicyOverride(wht, 'write', permissions, features, 'th', 'wht.get_certificate')?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
      assert.equal(scopePolicyOverride(knowledge, 'general', permissions, features, 'th'), undefined, 'mixed knowledge clause remains answerable');
    }
  });
});

it('R8 workflow classifier treats เปิดใบเบิก as create while เปิดดู stays a read or open', () => {
  const claim = WORKFLOW_CLASSIFIER_SYSTEM_PROMPT.split('reimbursement_claim:')[1]!.split('reimbursement_submit:')[0]!;
  assert.match(claim, /เปิดใบเบิก/); assert.match(claim, /ขอเปิดใบเบิก/); assert.match(claim, /เปิดบิลเบิก/);
  assert.match(claim, /เปิดใบเบิกค่าแท็กซี่ 250 บาทให้ที/);
  assert.match(claim, /เปิดดูใบเบิก.*open.*read/);
});

it('R9 classifier distinguishes paying a service expense from reimbursing a claimant', () => {
  const pay = WORKFLOW_CLASSIFIER_SYSTEM_PROMPT.split('expense_pay:')[1]!.split('payment_voucher:')[0]!;
  assert.match(pay, /บันทึกจ่ายค่าบริการค้างจ่าย/);
  for (const words of ['บันทึกจ่าย', 'จ่ายเงิน', 'ค่า', 'ใบเบิก', 'คืน', 'ผู้เบิก', 'จ่ายคืนใบเบิก', 'โอนคืนผู้เบิก', 'reimbursement_pay']) assert.ok(pay.includes(words), words);
});
