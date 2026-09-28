/**
 * Item 6 (223-turn eval): `SOURCE_COVERAGE_MISSING` and `SPECIFIC_PRODUCT_GUIDE_UNAVAILABLE` were the
 * last two `needs_user` outcomes in semantic-turn-v2.ts with no real question behind them — a
 * system-side planning/coverage gap, not something the customer can answer, must close as R-L2/R-L3's
 * `unsupported` like every other fixed case in this file (SEMANTIC_CONTROL_UNAVAILABLE,
 * ANSWER_NUMBER_NOT_GROUNDED, SEMANTIC_ANSWER_UNAVAILABLE, TOOL_INPUT_NOT_AUTHORIZED).
 *
 * T-116-a-owner-howto-category ("เพิ่ม category ค่าใช้จ่ายใหม่ทำยังไงครับ") and
 * T-118-a-manager-howto-signature ("ลายเซ็นอนุมัติต้องตั้งค่ายังไงครับ") both hit
 * `SPECIFIC_PRODUCT_GUIDE_UNAVAILABLE` in the eval evidence with zero provider calls
 * (`durationMs: 0-1`) — the deterministic help-card lookup correctly found no match, since neither
 * topic (a new expense category; setting up an approval signature — real features at
 * apps/web/.../expenses/categories and .../expenses/signatures) is covered by any of the 12 approved
 * cards. Four sibling "howto" scenarios in the SAME run (photo capture, approve, reimburse, export)
 * DID match a card and succeeded, which rules out a lookup bug — this is a genuine content gap, so
 * the fix is an honest, still-useful fallback (never inventing an unapproved card), not a lookup fix.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLineAiInputEvidence, extractValueCandidates, type LineAiTurnRequest, type ToolResult } from '@watchdog-bms/contracts';
import type { IModelProvider, ProviderInput, ProviderOutput } from '../infrastructure/provider/provider.port';
import { runSemanticTurnV2 } from './semantic-turn-v2';

function baseUserContext(permissions: string[] = ['expense.read']) {
  return { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
    permissions, roles: ['owner'], branchIds: [], locationIds: [], locale: 'th-TH' } as LineAiTurnRequest['userContext'];
}

function neverCalledProvider(): IModelProvider {
  return { async generateText(_input: ProviderInput): Promise<ProviderOutput> {
    throw new Error('a pure help-card lookup must never call the model');
  } };
}

describe('item 6: an uncovered product-help question is terminal, and still helps', () => {
  it('reports SPECIFIC_PRODUCT_GUIDE_UNAVAILABLE as `unsupported`, never `needs_user` (eval T-116/T-118)', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-help-1', webhookEventId: 'event-help-1', messageText: 'เพิ่ม category ค่าใช้จ่ายใหม่ทำยังไงครับ',
      messagePreviewHash: 'e'.repeat(16),
      semanticSubrequests: [{ index: 0, kind: 'help', goal: 'อธิบายวิธีเพิ่ม category ค่าใช้จ่ายใหม่', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(),
      // No `approvedKnowledge`/`selectedKnowledgeCardIds` — exactly what the router sent for both
      // failing eval turns, since no card matches either topic.
    };
    const result = await runSemanticTurnV2({
      req: request, provider: neverCalledProvider(), draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      async invoke(): Promise<ToolResult> { throw new Error('a help item must never call a tool'); },
    });
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'unsupported');
    assert.notEqual(coverage?.status, 'needs_user');
    assert.equal(coverage?.reasonCode, 'SPECIFIC_PRODUCT_GUIDE_UNAVAILABLE');
    // Must still help: name that system setup is done on the web, not just list read capabilities.
    assert.ok(result.replyText.includes('หน้าเว็บ'), result.replyText);
    assert.ok(result.replyText.includes('การตั้งค่าระบบ'), result.replyText);
  });

  it('same outcome in English, still naming the web app for setup', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-help-2', webhookEventId: 'event-help-2', messageText: 'How do I set up an approval signature?',
      messagePreviewHash: 'f'.repeat(16), responsePreferences: { language: 'en', detail: 'normal', presentation: 'prose' },
      semanticSubrequests: [{ index: 0, kind: 'help', goal: 'Explain how to set up an approval signature', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(),
    };
    const result = await runSemanticTurnV2({
      req: request, provider: neverCalledProvider(), draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      async invoke(): Promise<ToolResult> { throw new Error('a help item must never call a tool'); },
    });
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'unsupported');
    assert.equal(coverage?.reasonCode, 'SPECIFIC_PRODUCT_GUIDE_UNAVAILABLE');
    assert.ok(result.replyText.includes('web app'), result.replyText);
  });
});

describe('item 6: an uncitable read answer is terminal, and tries the deterministic fallback first', () => {
  const MESSAGE_TEXT = 'เดือนนี้จ่ายไปเท่าไหร่คะ';
  const TODAY = '2026-09-28';
  const SOURCE_REF = { id: 'expenses:expense_summary:summary', label: 'รายการค่าใช้จ่าย', module: 'expenses',
    entityType: 'expense_summary', permissionChecked: true as const, asOf: '2026-09-27T18:20:29.656Z' };

  function goodResult(): ToolResult {
    return { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [SOURCE_REF],
      facts: [], data: { total: 3, items: [], summary: { totalAmount: '1000' } } };
  }

  function request(): LineAiTurnRequest {
    return {
      requestId: 'req-source-1', webhookEventId: 'event-source-1', messageText: MESSAGE_TEXT, messagePreviewHash: 'a'.repeat(16),
      valueCandidates: extractValueCandidates(MESSAGE_TEXT, TODAY),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ยอดเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28' } }],
      userContext: baseUserContext(),
    };
  }

  const CONTROL_CALL = JSON.stringify({ calls: [{ index: 0, toolName: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-28' } }] });
  // The composer cites a source id nothing in `good` produced — exactly SOURCE_COVERAGE_MISSING's
  // trigger (`answer.sourceRefIds.some(id => !allowed.has(id))`). The claimed amount (9,999) is
  // deliberately different from the tool's own grounded total (1,000, `goodResult`'s summary) so the
  // test can tell "the model's uncited number leaked" apart from "the deterministic fallback
  // correctly renders the tool's real total" (item 2 now prints that total on the list shape too).
  const UNCITABLE_ANSWER = JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'ยอดรวม 9,999 บาทค่ะ', sourceRefIds: ['not-a-real-source'] }] });

  async function run(enabledDeterministicFamilies?: ReadonlySet<string>) {
    const queue = [CONTROL_CALL, UNCITABLE_ANSWER];
    const provider: IModelProvider = { async generateText(_input: ProviderInput): Promise<ProviderOutput> {
      return { ok: true, text: queue.shift() ?? '{}' };
    } };
    return runSemanticTurnV2({
      req: request(), provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false, enabledDeterministicFamilies,
      async invoke(): Promise<ToolResult> { return goodResult(); },
    });
  }

  it('renders the verified deterministic formatter when its family is enabled, never `needs_user`', async () => {
    const result = await run(new Set(['expense.list_recent::single_metric', 'expense.list_recent::list']));
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'handled');
    assert.equal(coverage?.reasonCode, 'DETERMINISTIC_FALLBACK_RENDERED');
    assert.ok(!result.replyText.includes('9,999'), 'the uncited model total must not leak through');
    assert.ok(result.replyText.includes('1,000'), 'the tool\'s own grounded total still renders');
  });

  it('falls back to the honest §8 terminal (unsupported, not needs_user) when no family is enabled', async () => {
    const result = await run();
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'unsupported');
    assert.notEqual(coverage?.status, 'needs_user');
    assert.equal(coverage?.reasonCode, 'SOURCE_COVERAGE_MISSING');
    assert.ok(result.replyText.includes('ดึงข้อมูลส่วนนี้ไม่ได้'), result.replyText);
  });
});

describe('item 2 (223-turn eval batch 2): a name-resolution result is answered deterministically, never composed', () => {
  const MESSAGE_TEXT = 'สมใจจ่ายไปทั้งหมดเท่าไหร่ครับเดือนนี้';
  const TODAY = '2026-09-28';
  const SOURCE_REF = { label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary',
    permissionChecked: true as const, asOf: '2026-09-27T18:20:29.656Z', webPath: '/companies/company/expenses' };

  function ambiguousResult(): ToolResult {
    return { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [SOURCE_REF],
      data: { vendorAmbiguous: 'สมใจ', availableVendors: [{ id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'ร้านสมใจการค้า' }] } };
  }

  function notFoundResult(): ToolResult {
    return { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [SOURCE_REF],
      data: { vendorUnresolved: 'ร้านกาแฟอเมซอน', availableVendors: [{ id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'ร้านสมใจการค้า' }] } };
  }

  // erp-tools.use-case.ts's ExpenseListRecentTool: a branch that exists in the company but outside
  // this caller's own branch scope. Status stays 'ok' (a real, permission-checked answer), same as
  // ambiguous/not-found above.
  function branchOutOfScopeResult(): ToolResult {
    return { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [SOURCE_REF],
      data: { branchOutOfScope: 'บางนา', availableBranches: [{ id: 'b1', name: 'สาธุประดิษฐ์' }] } };
  }

  function request(): LineAiTurnRequest {
    return {
      requestId: 'req-name-1', webhookEventId: 'event-name-1', messageText: MESSAGE_TEXT, messagePreviewHash: 'c'.repeat(16),
      valueCandidates: extractValueCandidates(MESSAGE_TEXT, TODAY),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ยอดรวมที่จ่ายให้สมใจเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { vendorName: 'สมใจ' } }],
      userContext: baseUserContext(),
    };
  }

  const CONTROL_CALL = JSON.stringify({ calls: [{ index: 0, toolName: 'expense.list_recent', input: { vendorName: 'สมใจ' } }] });

  async function run(invokeResult: ToolResult) {
    let calls = 0;
    const provider: IModelProvider = { async generateText(_input: ProviderInput): Promise<ProviderOutput> {
      calls++; return { ok: true, text: CONTROL_CALL };
    } };
    const result = await runSemanticTurnV2({
      req: request(), provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { return invokeResult; },
    });
    return { result, calls };
  }

  it('ambiguous vendor: a real clarification question listing the options, needs_user (eval T-011#2/T-062#0)', async () => {
    const { result, calls } = await run(ambiguousResult());
    // Only the control round's generateText call runs — never a second (compose) call around this
    // deterministic data, and never the raw TOOL_RESULT_NO_SOURCE code the eval saw leak through.
    assert.equal(calls, 1, 'only the control round runs — never a compose call around this data');
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'needs_user');
    assert.equal(coverage?.reasonCode, 'EXPENSE_NAME_AMBIGUOUS');
    assert.ok(result.replyText.includes('ร้านสมใจ'));
    assert.ok(result.replyText.includes('ร้านสมใจการค้า'));
    assert.ok(!result.replyText.includes('TOOL_RESULT_NO_SOURCE'));
  });

  it('vendor not found: a terminal answer naming it and listing available names, never needs_user (eval T-008#3)', async () => {
    const { result, calls } = await run(notFoundResult());
    assert.equal(calls, 1, 'only the control round runs — never a compose call around this data');
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'handled');
    assert.notEqual(coverage?.status, 'needs_user');
    assert.equal(coverage?.reasonCode, 'EXPENSE_NAME_UNRESOLVED');
    assert.ok(result.replyText.includes('ร้านสมใจ'));
    assert.ok(result.replyText.includes('ร้านสมใจการค้า'));
    assert.ok(!result.replyText.includes('TOOL_RESULT_NO_SOURCE'));
  });

  it('branch out of scope: a terminal answer naming only the caller\'s own branches, never needs_user', async () => {
    const { result, calls } = await run(branchOutOfScopeResult());
    assert.equal(calls, 1, 'only the control round runs — never a compose call around this data');
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'handled');
    assert.notEqual(coverage?.status, 'needs_user');
    assert.equal(coverage?.reasonCode, 'EXPENSE_BRANCH_OUT_OF_SCOPE');
    assert.ok(result.replyText.includes('คุณดูข้อมูลได้เฉพาะสาขา'));
    assert.ok(result.replyText.includes('สาธุประดิษฐ์'));
    assert.ok(!result.replyText.includes('บางนา'));
    assert.ok(!result.replyText.includes('TOOL_RESULT_NO_SOURCE'));
  });
});

describe('reimbursement.list_pending_approvals forbidden outcome: a terminal permission answer, never composed', () => {
  function forbiddenResult(): ToolResult {
    return { toolName: 'reimbursement.list_pending_approvals', status: 'forbidden', sourceRefs: [],
      asOf: '2026-09-27T18:20:29.656Z', errorCode: 'REIMBURSEMENT_APPROVAL_NOT_PERMITTED' };
  }

  function request(): LineAiTurnRequest {
    const messageText = 'เบิกจ่ายรออนุมัติมีอะไรบ้าง';
    return {
      requestId: 'req-approval-1', webhookEventId: 'event-approval-1', messageText, messagePreviewHash: 'd'.repeat(16),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'เบิกจ่ายที่รออนุมัติ', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: {} }],
      // The gateway-level tool eligibility check (hasToolPermissions) also requires
      // reimbursement.approve; this fixture exercises the ERP tool's own deeper, authoritative
      // check (erp-reimbursement-tools.use-case.ts), which this caller's live grant can still fail —
      // see that use case's spec for the real permission check this reply text renders.
      userContext: baseUserContext(['reimbursement.approve']),
    };
  }

  const CONTROL_CALL = JSON.stringify({ calls: [{ index: 0, toolName: 'reimbursement.list_pending_approvals', input: {} }] });

  it('renders the role-limit reply naming the self-serve alternative, not the generic read-unavailable text (eval T-143)', async () => {
    let calls = 0;
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> {
      calls++; return { ok: true, text: CONTROL_CALL };
    } };
    const result = await runSemanticTurnV2({
      req: request(), provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { return forbiddenResult(); },
    });
    assert.equal(calls, 1, 'only the control round runs — never a compose call around a forbidden result');
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'handled');
    assert.notEqual(coverage?.status, 'needs_user');
    assert.equal(coverage?.reasonCode, 'REIMBURSEMENT_APPROVAL_NOT_PERMITTED');
    assert.ok(result.replyText.startsWith('บทบาทของคุณยังไม่มีสิทธิ์ดูหรืออนุมัติใบเบิกของคนอื่นค่ะ'), result.replyText);
    assert.ok(result.replyText.includes('ใบเบิกของฉันถึงไหนแล้ว'), result.replyText);
    assert.ok(!result.replyText.includes('ยังดึงข้อมูลส่วนนี้ไม่ได้'), result.replyText);
  });
});

// Items 1-4 (docs/specs/mangmee-ai-expense-advisor-spec-th.md §2, §3 rows 17-18, §8, §11): real-model
// eval evidence (tuning-3) showed sales/P&L/receivables answered with an expense or reimbursement
// substitute, model-written refusals with jargon or a wrong reason, "cannot fetch data" instead of a
// permission answer for approvals, a how-to card for a read-only role, and two tool-routing
// misfires. Every case below proves the fix at the one place ALL tool calls in this lane route
// through: no unsold/misrouted/unpermitted tool is EVER invoked, even when the model tries one.

function wrongToolControlProvider(toolName: string, input: Record<string, unknown> = {}): IModelProvider {
  return { async generateText(): Promise<ProviderOutput> {
    return { ok: true, text: JSON.stringify({ calls: [{ index: 0, toolName, input }], questions: [] }) };
  } };
}

// STARTER_249/BASIC_499/PRO_999 (spec §2/§10): entitled to expenses/reimbursement only, none of
// the unsold modules under test below.
const NO_UNSOLD_MODULES_ENTITLED = ['expenses', 'reimbursement', 'ai_line_assistant', 'employee_access', 'company_settings', 'dashboard_notifications'];

describe('item 1: a question about an unsold module never gets an expense/reimbursement substitute', () => {
  it('sales/revenue: no tool call, exact spec §8 copy naming the topic (eval T-132)', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-unsold-sales', webhookEventId: 'event-unsold-sales', messageText: 'ขอดูยอดขายเดือนนี้หน่อยจ้ะ',
      messagePreviewHash: 'a'.repeat(16),
      entitledFeatureKeys: NO_UNSOLD_MODULES_ENTITLED,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ถามยอดขายเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28' } }],
      userContext: baseUserContext(['expense.read']),
    };
    const result = await runSemanticTurnV2({
      req, provider: wrongToolControlProvider('expense.get_breakdown', { fromDate: '2026-09-01', toDate: '2026-09-28' }),
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('must never call a tool for an unsold-module clause'); },
    });
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'unsupported');
    assert.equal(coverage?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
    assert.ok(result.replyText.startsWith('แพ็กเกจที่ใช้อยู่ยังไม่มีเรื่อง'), result.replyText);
    assert.ok(result.replyText.includes('ยอดขาย') || result.replyText.includes('รายได้'), result.replyText);
    assert.ok(result.replyText.includes('รายจ่ายและใบเบิก'), result.replyText);
  });

  it('P&L/profit: no tool call, even via reimbursement.get_summary (eval T-136)', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-unsold-pl', webhookEventId: 'event-unsold-pl', messageText: 'ขอรายงานกำไรขาดทุนเดือนนี้หน่อยค่ะ',
      messagePreviewHash: 'b'.repeat(16),
      entitledFeatureKeys: NO_UNSOLD_MODULES_ENTITLED,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ถามกำไรขาดทุนเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['reimbursement.read']),
    };
    const result = await runSemanticTurnV2({
      req, provider: wrongToolControlProvider('reimbursement.get_summary'),
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('must never call a tool for an unsold-module clause'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
    assert.ok(result.replyText.includes('กำไรขาดทุน'), result.replyText);
  });

  it('receivables: no tool call (eval T-138)', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-unsold-ar', webhookEventId: 'event-unsold-ar', messageText: 'ดูลูกค้าที่ค้างชำระให้หน่อยคับ',
      messagePreviewHash: 'c'.repeat(16),
      entitledFeatureKeys: NO_UNSOLD_MODULES_ENTITLED,
      semanticSubrequests: [{ index: 0, kind: 'general', goal: 'ถามลูกค้าค้างชำระ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['reimbursement.read']),
    };
    const result = await runSemanticTurnV2({
      req, provider: { async generateText(): Promise<ProviderOutput> { throw new Error('a fully forced general-kind clause must never need the model'); } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('must never call a tool for an unsold-module clause'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
    assert.ok(result.replyText.includes('ลูกหนี้') || result.replyText.includes('ลูกค้าค้างชำระ'), result.replyText);
  });

  it('payroll: no tool call, regardless of entitlement (no such feature exists)', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-unsold-payroll', webhookEventId: 'event-unsold-payroll', messageText: 'คำนวณเงินเดือนพนักงานให้หน่อยครับ',
      messagePreviewHash: 'd'.repeat(16),
      entitledFeatureKeys: ['expenses', 'reimbursement', 'employee_access', 'sales_documents', 'reports', 'inventory', 'bank_reconciliation', 'procurement'],
      semanticSubrequests: [{ index: 0, kind: 'general', goal: 'ถามคำนวณเงินเดือน', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['access.employee.read']),
    };
    const result = await runSemanticTurnV2({
      req, provider: { async generateText(): Promise<ProviderOutput> { throw new Error('must never need the model'); } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('must never call a tool for payroll'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
    assert.ok(result.replyText.includes('เงินเดือน'), result.replyText);
  });

  it('invoice/issuing: no tool call (eval T-130)', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-unsold-invoice', webhookEventId: 'event-unsold-invoice', messageText: 'ช่วยออกใบแจ้งหนี้ให้ลูกค้าหน่อยครับ',
      messagePreviewHash: 'e'.repeat(16),
      entitledFeatureKeys: NO_UNSOLD_MODULES_ENTITLED,
      semanticSubrequests: [{ index: 0, kind: 'general', goal: 'ขอออกใบแจ้งหนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
    };
    const result = await runSemanticTurnV2({
      req, provider: { async generateText(): Promise<ProviderOutput> { throw new Error('must never need the model'); } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('must never call a tool'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
    assert.ok(result.replyText.includes('ใบแจ้งหนี้'), result.replyText);
  });

  it('bank balance: no tool call (eval T-137)', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-unsold-bank', webhookEventId: 'event-unsold-bank', messageText: 'เช็คยอดคงเหลือบัญชีธนาคารหน่อยค่ะ',
      messagePreviewHash: 'f'.repeat(16),
      entitledFeatureKeys: NO_UNSOLD_MODULES_ENTITLED,
      semanticSubrequests: [{ index: 0, kind: 'general', goal: 'ถามยอดบัญชีธนาคาร', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
    };
    const result = await runSemanticTurnV2({
      req, provider: { async generateText(): Promise<ProviderOutput> { throw new Error('must never need the model'); } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('must never call a tool'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
    assert.ok(result.replyText.includes('บัญชีธนาคาร'), result.replyText);
  });

  it('stock/inventory: no tool call (eval T-131)', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-unsold-stock', webhookEventId: 'event-unsold-stock', messageText: 'เช็ค stock สินค้าคงเหลือให้หน่อยครับ',
      messagePreviewHash: '1'.repeat(16),
      entitledFeatureKeys: NO_UNSOLD_MODULES_ENTITLED,
      semanticSubrequests: [{ index: 0, kind: 'general', goal: 'ถามสต็อกสินค้า', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
    };
    const result = await runSemanticTurnV2({
      req, provider: { async generateText(): Promise<ProviderOutput> { throw new Error('must never need the model'); } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('must never call a tool'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
    assert.ok(result.replyText.includes('สต็อก'), result.replyText);
  });

  it('purchase orders: no tool call', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-unsold-po', webhookEventId: 'event-unsold-po', messageText: 'ขอดูใบสั่งซื้อค้างอยู่กี่ใบคะ',
      messagePreviewHash: '2'.repeat(16),
      entitledFeatureKeys: NO_UNSOLD_MODULES_ENTITLED,
      semanticSubrequests: [{ index: 0, kind: 'general', goal: 'ถามใบสั่งซื้อ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
    };
    const result = await runSemanticTurnV2({
      req, provider: { async generateText(): Promise<ProviderOutput> { throw new Error('must never need the model'); } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('must never call a tool'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
    assert.ok(result.replyText.includes('ใบสั่งซื้อ'), result.replyText);
  });

  it('mixed message: answers the expense part and states the limit for the unsold part, in one reply', async () => {
    const salesSpan = 'ยอดขายเดือนนี้';
    const expenseSpan = 'ค่าใช้จ่ายเดือนนี้';
    const messageText = `ขอดู${salesSpan} กับ${expenseSpan}ด้วยค่ะ`;
    const evidence = await createLineAiInputEvidence({ turnKey: 'mixed-turn', parts: [{ partId: 'text', rawText: messageText, eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now() }] });
    assert.ok(evidence);
    const part = evidence.inputEvidence.parts[0]!;
    const salesStart = messageText.indexOf(salesSpan), expenseStart = messageText.indexOf(expenseSpan);
    const req: LineAiTurnRequest = {
      requestId: 'req-mixed', webhookEventId: 'event-mixed', messageText, messagePreviewHash: '3'.repeat(16),
      entitledFeatureKeys: NO_UNSOLD_MODULES_ENTITLED,
      inputEvidence: evidence.inputEvidence,
      valueCandidates: extractValueCandidates(messageText, '2026-09-28'),
      semanticSubrequests: [
        { index: 0, kind: 'read', goal: 'ถามยอดขายเดือนนี้', requiredEvidence: [], dependsOn: [], requestedFilters: {},
          evidenceRefs: [{ partId: part.partId, rawSha256: part.rawSha256, startUtf16: salesStart, endUtf16: salesStart + salesSpan.length }] },
        { index: 1, kind: 'read', goal: 'ถามค่าใช้จ่ายเดือนนี้', requiredEvidence: [], dependsOn: [], requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28' },
          evidenceRefs: [{ partId: part.partId, rawSha256: part.rawSha256, startUtf16: expenseStart, endUtf16: expenseStart + expenseSpan.length }] },
      ],
      userContext: baseUserContext(['expense.read']),
    };
    const queue = [
      JSON.stringify({ calls: [
        { index: 0, toolName: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-28' } },
        { index: 1, toolName: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-28' } },
      ], questions: [] }),
      JSON.stringify({ answers: [
        { index: 0, status: 'handled', text: 'ignored — overridden by the forced scope-policy answer', sourceRefIds: [] },
        { index: 1, status: 'handled', text: 'ค่าใช้จ่ายเดือนนี้ 1,000 บาทค่ะ', sourceRefIds: ['expenses:list:summary'] },
      ] }),
    ];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    const invoked: string[] = [];
    const result = await runSemanticTurnV2({
      req, provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(meta): Promise<ToolResult> {
        if (meta.name === 'expense.get_breakdown') throw new Error('must never call an unsold-module tool for the sales clause');
        invoked.push(meta.name);
        return { toolName: meta.name, status: 'ok', asOf: '2026-09-27T18:20:29.656Z',
          sourceRefs: [{ id: 'expenses:list:summary', label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary', permissionChecked: true }],
          data: { total: 3, items: [], summary: { totalAmount: '1000' } }, facts: [] };
      },
    });
    assert.deepEqual(invoked, ['expense.list_recent'], 'only the expense clause ever reaches a tool call');
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
    assert.equal(result.semanticCoverage?.[1]?.status, 'handled');
    assert.ok(result.replyText.includes('แพ็กเกจที่ใช้อยู่ยังไม่มีเรื่อง'), result.replyText);
    assert.ok(result.replyText.includes('1,000'), result.replyText);
  });

  it('a company where sales_documents IS entitled is never blocked (uses the real sales tool)', async () => {
    const messageText = 'ขอดูยอดขายเดือนนี้หน่อยจ้ะ';
    const req: LineAiTurnRequest = {
      requestId: 'req-entitled', webhookEventId: 'event-entitled', messageText, messagePreviewHash: '4'.repeat(16),
      entitledFeatureKeys: ['expenses', 'sales_documents'],
      valueCandidates: extractValueCandidates(messageText, '2026-09-28'),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ถามยอดขายเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28' } }],
      userContext: baseUserContext(['crm.report.read']),
    };
    const queue = [
      JSON.stringify({ calls: [{ index: 0, toolName: 'sales.get_sales_summary', input: { fromDate: '2026-09-01', toDate: '2026-09-28' } }], questions: [] }),
      JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'ยอดขายเดือนนี้ 12,345 บาทค่ะ', sourceRefIds: ['sales:summary:summary'] }] }),
    ];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    let invoked = 0;
    const result = await runSemanticTurnV2({
      req, provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(meta): Promise<ToolResult> {
        invoked += 1;
        return { toolName: meta.name, status: 'ok', asOf: '2026-09-27T18:20:29.656Z',
          sourceRefs: [{ id: 'sales:summary:summary', label: 'ยอดขายรวม', module: 'sales', entityType: 'summary', permissionChecked: true }],
          data: { totalSales: '12345', transactionCount: 9 }, facts: [] };
      },
    });
    assert.equal(invoked, 1, 'the real sales tool is called once the feature is entitled');
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.ok(result.replyText.includes('12,345'), result.replyText);
  });
});

describe('item 2: approve/reject/pay a reimbursement or confirm/void an expense never runs on LINE (spec §11)', () => {
  const APPROVER_PERMISSIONS = ['reimbursement.approve', 'reimbursement.reject', 'reimbursement.payment.record', 'reimbursement.read_related'];
  const FINANCE_PERMISSIONS = ['expense.confirm', 'expense.void', 'expense.read_related'];

  function forcedActionRequest(messageText: string, permissions: string[]): LineAiTurnRequest {
    return {
      requestId: 'req-action', webhookEventId: 'event-action', messageText, messagePreviewHash: '5'.repeat(16),
      semanticSubrequests: [{ index: 0, kind: 'general', goal: messageText, requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(permissions),
    };
  }

  async function runForced(messageText: string, permissions: string[]) {
    return runSemanticTurnV2({
      req: forcedActionRequest(messageText, permissions),
      provider: { async generateText(): Promise<ProviderOutput> { throw new Error('a fully forced general-kind clause must never need the model'); } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('must never call a tool for an approve/reject/pay/confirm/void request'); },
    });
  }

  it('approve a reimbursement claim with permission: do it on the web (eval T-144)', async () => {
    const result = await runForced('ช่วยอนุมัติใบเบิกของสมชายให้หน่อยค่ะ', APPROVER_PERMISSIONS);
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'LINE_ACTION_NOT_SUPPORTED');
    assert.ok(result.replyText.includes('LINE ไม่ได้'), result.replyText);
    assert.ok(!result.replyText.includes('ดึงข้อมูล'), result.replyText);
  });

  it('approve a reimbursement claim WITHOUT permission: names the role limit (eval T-147)', async () => {
    const result = await runForced('ช่วยอนุมัติใบเบิกอันนี้ให้หน่อยค่ะ', ['reimbursement.read_own']);
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'LINE_ACTION_NOT_SUPPORTED');
    assert.ok(result.replyText.startsWith('บทบาทของคุณยังไม่มีสิทธิ์'), result.replyText);
  });

  it('reject a reimbursement claim', async () => {
    const result = await runForced('ปฏิเสธใบเบิกนี้หน่อยค่ะ', APPROVER_PERMISSIONS);
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'LINE_ACTION_NOT_SUPPORTED');
    assert.ok(result.replyText.includes('เว็บ'), result.replyText);
  });

  it('pay a reimbursement claim', async () => {
    const result = await runForced('ช่วยจ่ายใบเบิกให้หน่อยค่ะ', APPROVER_PERMISSIONS);
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'LINE_ACTION_NOT_SUPPORTED');
    assert.ok(result.replyText.includes('เว็บ'), result.replyText);
  });

  it('confirm an expense record', async () => {
    const result = await runForced('ยืนยันรายการค่าใช้จ่ายนี้ให้หน่อยค่ะ', FINANCE_PERMISSIONS);
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'LINE_ACTION_NOT_SUPPORTED');
    assert.ok(result.replyText.includes('เว็บ'), result.replyText);
  });

  it('void a confirmed expense record without permission', async () => {
    const result = await runForced('ยกเลิกรายการค่าใช้จ่ายนี้หน่อยค่ะ', ['expense.read_related']);
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'LINE_ACTION_NOT_SUPPORTED');
    assert.ok(result.replyText.startsWith('บทบาทของคุณยังไม่มีสิทธิ์'), result.replyText);
  });
});

describe('item 3: a read-only role asking to record, upload, or capture (spec §8 "นอกสิทธิ์")', () => {
  // Real AUDITOR_READONLY grant (permission-registry.ts): read/export everywhere, no expense-create.
  const AUDITOR_READONLY_PERMISSIONS = ['expense.read', 'expense.read_related', 'expense.evidence.read', 'expense.read_own', 'expense.export', 'reimbursement.read', 'reimbursement.read_related', 'reimbursement.create'];

  it('a receipt-capture request gets the read-only answer, never the how-to card (eval T-146)', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-readonly', webhookEventId: 'event-readonly', messageText: 'ถ่ายรูปใบเสร็จแล้วส่งเข้าระบบให้หน่อยค่ะ', messagePreviewHash: '6'.repeat(16),
      semanticSubrequests: [{ index: 0, kind: 'help', goal: 'ถามวิธีบันทึกใบเสร็จ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(AUDITOR_READONLY_PERMISSIONS),
    };
    const result = await runSemanticTurnV2({
      req, provider: { async generateText(): Promise<ProviderOutput> { throw new Error('a fully forced help-kind clause must never need the model'); } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      async invoke(): Promise<ToolResult> { throw new Error('must never call a tool for a read-only capture request'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'READONLY_ROLE_CANNOT_CREATE');
    assert.ok(result.replyText.startsWith('บทบาทของคุณดูข้อมูลได้อย่างเดียวค่ะ'), result.replyText);
  });

  it('the same request is NOT blocked for a role that can create expenses', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-can-create', webhookEventId: 'event-can-create', messageText: 'ถ่ายรูปใบเสร็จแล้วส่งเข้าระบบให้หน่อยค่ะ', messagePreviewHash: '7'.repeat(16),
      semanticSubrequests: [{ index: 0, kind: 'help', goal: 'ถามวิธีบันทึกใบเสร็จ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.receipt.line_upload']),
      approvedKnowledge: true,
    };
    const result = await runSemanticTurnV2({
      req, provider: { async generateText(): Promise<ProviderOutput> { throw new Error('a help-kind product-help lookup must never call the model'); } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      async invoke(): Promise<ToolResult> { throw new Error('a help item must never call a tool'); },
    });
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'READONLY_ROLE_CANNOT_CREATE');
  });
});

describe('item 4: routing guards — the model still tries a misrouted tool, the guard blocks it', () => {
  it('a reimbursement claim status question never calls expense.list_recent (eval T-093-b)', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-route-claim', webhookEventId: 'event-route-claim', messageText: 'ใบเบิกที่ฉันขอไปยังไม่จ่ายใช่ป่ะคะ', messagePreviewHash: '8'.repeat(16),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ถามสถานะใบเบิก', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: { paymentStatus: 'UNPAID' } }],
      userContext: baseUserContext(['expense.read', 'reimbursement.read_own']),
    };
    const result = await runSemanticTurnV2({
      req, provider: wrongToolControlProvider('expense.list_recent', { paymentStatus: 'UNPAID' }),
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('must never answer a reimbursement claim question with the expense ledger'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
    assert.equal(result.semanticCoverage?.[0]?.status, 'unsupported');
  });

  it('a "ทำไม" category-spending question never routes to line.explain_file_attempt (eval T-107-b)', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-route-file', webhookEventId: 'event-route-file', messageText: 'ทำไมค่าเดินทางเดือนนี้พุ่งขนาดนี้คะ', messagePreviewHash: '9'.repeat(16),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ถามทำไมค่าเดินทางพุ่ง', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read', 'expense.receipt.line_upload', 'expense.create']),
    };
    const result = await runSemanticTurnV2({
      req, provider: wrongToolControlProvider('line.explain_file_attempt'),
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('must never explain a file attempt with no file/photo referenced'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
    assert.ok(!result.replyText.includes('ยังไม่พบไฟล์ที่จะอ่าน'), result.replyText);
  });

  it('line.explain_file_attempt still runs when a file/photo is actually named', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-route-file-ok', webhookEventId: 'event-route-file-ok', messageText: 'ไฟล์เมื่อกี้ส่งไม่ได้เพราะอะไรคะ', messagePreviewHash: '0'.repeat(16),
      semanticSubrequests: [{ index: 0, kind: 'file', goal: 'ถามไฟล์เมื่อกี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.receipt.line_upload', 'expense.create']),
    };
    let invoked = 0;
    const queue = [
      JSON.stringify({ calls: [{ index: 0, toolName: 'line.explain_file_attempt', input: {} }], questions: [] }),
      JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'เก็บไฟล์ไว้แล้วค่ะ', sourceRefIds: ['line-ai:file_attempt:summary'] }] }),
    ];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    const result = await runSemanticTurnV2({
      req, provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(meta): Promise<ToolResult> {
        invoked += 1;
        return { toolName: meta.name, status: 'ok', asOf: '2026-09-27T18:20:29.656Z',
          sourceRefs: [{ id: 'line-ai:file_attempt:summary', label: 'ไฟล์ที่ส่งมา', module: 'line-ai', entityType: 'file_attempt', permissionChecked: true }],
          data: {}, facts: [] };
      },
    });
    assert.equal(invoked, 1, 'a genuinely file-referencing question still reaches the tool');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
  });
});
