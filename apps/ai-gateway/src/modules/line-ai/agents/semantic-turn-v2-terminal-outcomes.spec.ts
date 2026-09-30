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

// Advisor S2a (docs/specs/mangmee-advisor-system-knowledge-2026-09-29-th.md §5.1, owner 2026-09-30 §10
// items 2 and 4): billing.get_package_usage is offered to every assistant user; a caller who does not
// manage the package gets one fixed P8 line whatever the clause kind, and a manager's answer is composed
// under the no-price / no-other-package / projection-only rules.
describe('billing.get_package_usage: P8 for a non-manager, composed rules for a manager', () => {
  const CONTROL_CALL = JSON.stringify({ calls: [{ index: 0, toolName: 'billing.get_package_usage', input: {} }] });
  function request(kind: 'read' | 'write', messageText: string, permissions: string[]): LineAiTurnRequest {
    return { requestId: `req-package-${kind}`, webhookEventId: `event-package-${kind}`, messageText, messagePreviewHash: 'f'.repeat(16),
      semanticSubrequests: [{ index: 0, kind, goal: 'แพ็กเกจของร้าน', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(permissions) };
  }

  for (const [kind, text] of [['read', 'เหลือใบเสร็จกี่ใบ'], ['write', 'ขอเปลี่ยนแพ็กเกจได้ไหม']] as const) {
    it(`answers a ${kind} clause with the fixed ask-the-owner line, no link, never "the package lacks this"`, async () => {
      const prompts: string[] = [];
      const provider: IModelProvider = { async generateText(input: ProviderInput): Promise<ProviderOutput> {
        prompts.push(input.systemPrompt ?? ''); return { ok: true, text: CONTROL_CALL };
      } };
      const result = await runSemanticTurnV2({
        req: request(kind, text, ['ai.tool.invoke', 'expense.read']), provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
        publicLookupEnabled: false, approvedKnowledgeEnabled: false,
        async invoke(): Promise<ToolResult> {
          return { toolName: 'billing.get_package_usage', status: 'forbidden', sourceRefs: [], asOf: '2026-09-30T03:00:00.000Z', errorCode: 'PACKAGE_MANAGER_REQUIRED' };
        },
      });
      assert.equal(prompts.length, 1, 'only the control round runs — never a compose call around a refusal');
      assert.match(prompts[0]!, /call billing\.get_package_usage whatever the clause kind/);
      const coverage = result.semanticCoverage?.[0];
      assert.equal(coverage?.status, 'handled');
      assert.equal(coverage?.reasonCode, 'PACKAGE_MANAGER_REQUIRED');
      assert.equal(result.replyText, 'เรื่องแพ็กเกจและเครดิตของร้าน ถามเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจได้นะคะ');
      assert.deepEqual(result.webLinks, []);
    });
  }

  it('composes a manager\'s answer under the package rules and links the package page', async () => {
    const data = { package: { label: 'มืออาชีพ (PRO)', termEndsOn: '2026-10-15' },
      capacity: { branches: { used: 4, limit: 5, remaining: 1 }, members: { used: 3, limit: 10, remaining: 7 } },
      receipts: { used: 70, limit: 100, remaining: 30, cadence: 'ตามรอบที่ชำระ', periodStartOn: '2026-09-15', periodEndsOn: '2026-10-15',
        resetsOn: null, expiresOn: null, additional: null, paceNote: null,
        pace: { projectedUsed: 150, projectedShortfall: 50, daysElapsed: 14, daysLeft: 16, daysInPeriod: 30 } } };
    const calls: Array<{ usageTag: string; systemPrompt: string }> = [];
    const provider: IModelProvider = { async generateText(input: ProviderInput): Promise<ProviderOutput> {
      calls.push({ usageTag: input.usageTag ?? '', systemPrompt: input.systemPrompt ?? '' });
      return { ok: true, text: input.usageTag === 'line.compose' ? JSON.stringify({ answers: [{ index: 0, status: 'handled',
        text: 'ใบเสร็จรอบนี้ใช้ไป 70 จาก 100 ใบ เหลือ 30 ใบค่ะ คาดการณ์จากการใช้ 14 วันที่ผ่านมา ขาดประมาณ 50 ใบ',
        sourceRefIds: ['billing:package_usage:summary'] }] }) : CONTROL_CALL };
    } };
    const result = await runSemanticTurnV2({
      req: request('read', 'ใบเสร็จจะพอถึงสิ้นรอบไหม', ['ai.tool.invoke', 'company.plan.manage']), provider, draftEditEnabled: false,
      reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> {
        return { toolName: 'billing.get_package_usage', status: 'ok', data, asOf: '2026-09-28T03:00:00.000Z', sourceRefs: [{ label: 'แพ็กเกจของร้าน',
          module: 'billing', entityType: 'package_usage', permissionChecked: true, webPath: '/companies/company/billing' }] };
      },
    });
    const compose = calls.find((call) => call.usageTag === 'line.compose');
    assert.ok(compose);
    assert.match(compose.systemPrompt, /an answer about whether this shop's package is enough names no package other than its own package\.label/);
    assert.match(compose.systemPrompt, /Never recommend a package/);
    assert.match(compose.systemPrompt, /never suggest upgrading, a bigger package or buying more/);
    assert.match(compose.systemPrompt, /'ขาดประมาณ N ใบ' with N = projectedShortfall/);
    assert.match(compose.systemPrompt, /add no line inviting them to upgrade, change, add to, buy or manage a package/);
    assert.match(compose.systemPrompt, /never write a web address yourself/);
    assert.match(compose.systemPrompt, /no closing line pointing to the package page/);
    assert.match(compose.systemPrompt, /Never write a field name, a code or an equation from the tool data/);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.match(result.replyText, /ขาดประมาณ 50 ใบ/);
    assert.deepEqual(result.webLinks, [{ label: 'แพ็กเกจของร้าน', path: '/companies/company/billing' }]);
  });

  // Owner 2026-09-30 (~16:00, spec §5.1a): anyone may ask package prices and contents; they come only from
  // the catalog read, as selling prices with VAT per the billing policy, and never as a cost.
  it('answers a staff member\'s price question from billing.get_package_catalog, with no package page link', async () => {
    const control = JSON.stringify({ calls: [{ index: 0, toolName: 'billing.get_package_catalog', input: {} }] });
    const data = { packages: [{ name: 'เริ่มต้น (STARTER)', branches: 1, users: 2, monthly: { price: '249', vat: '17.43', payable: '266.43', receiptReads: 30 },
      yearly: { price: '2,490', vat: '174.30', payable: '2,664.30', receiptReads: 360, months: 12, averagePerMonth: '207.50', savingVersusMonthly: '498', pricedAsMonths: 10 },
      menus: ['ผู้ช่วย AI ทาง LINE', 'ค่าใช้จ่ายและใบเสร็จ'] }], vatNote: 'ราคานี้ยังไม่รวม VAT 7% ยอดที่ชำระสุทธิคือราคารวม VAT',
      usersNote: 'จำนวนผู้ใช้รวมเจ้าของร้าน', yearlyReceiptsNote: 'แบบรายปีได้สิทธิ์อ่านใบเสร็จของทั้งปีทันทีเมื่อชำระสำเร็จ', aiCreditPerMonth: 80 };
    const calls: Array<{ usageTag: string; systemPrompt: string }> = [];
    const invoked: string[] = [];
    const provider: IModelProvider = { async generateText(input: ProviderInput): Promise<ProviderOutput> {
      calls.push({ usageTag: input.usageTag ?? '', systemPrompt: input.systemPrompt ?? '' });
      return { ok: true, text: input.usageTag === 'line.compose' ? JSON.stringify({ answers: [{ index: 0, status: 'handled',
        text: 'แพ็กเกจเริ่มต้น (STARTER) ราคา 249 บาท/เดือน บวก VAT 17.43 บาท รวมชำระ 266.43 บาทค่ะ', sourceRefIds: ['billing:package_catalog:summary'] }] }) : control };
    } };
    const result = await runSemanticTurnV2({
      req: request('read', 'แพ็กเกจเริ่มต้นราคาเท่าไหร่', ['ai.tool.invoke', 'expense.read']), provider, draftEditEnabled: false,
      reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(meta: { name: string }): Promise<ToolResult> {
        invoked.push(meta.name);
        return { toolName: 'billing.get_package_catalog', status: 'ok', data, asOf: '2026-09-30T09:00:00.000Z',
          sourceRefs: [{ label: 'แพ็กเกจที่เปิดขาย', module: 'billing', entityType: 'package_catalog', permissionChecked: true }] };
      },
    });
    assert.deepEqual(invoked, ['billing.get_package_catalog']);
    assert.match(calls[0]!.systemPrompt, /call billing\.get_package_catalog with input \{\} whatever the clause kind/);
    const compose = calls.find((call) => call.usageTag === 'line.compose');
    assert.ok(compose);
    assert.match(compose.systemPrompt, /comes only from billing\.get_package_catalog in this turn — this shop's own usage and room come from billing\.get_package_usage — never from memory, a guess or your own arithmetic/);
    assert.match(compose.systemPrompt, /a price with vat is said as the price plus that VAT and its payable total; about VAT say only what vatNote says/);
    assert.match(compose.systemPrompt, /Selling prices are the only money you may name: never state, estimate or hint at what anything costs MangmeePlus/);
    assert.match(compose.systemPrompt, /never turn credits or receipts into money or into a number of messages/);
    assert.match(compose.systemPrompt, /never say how many packages there are or how many are bigger: list them, never 'มี 3 แบบ'/);
    assert.match(compose.systemPrompt, /Asking prices, contents or a comparison is not asking how to buy: end with what was asked, never with a line such as 'หากต้องการซื้อหรือเปลี่ยนแพ็กเกจ ทำได้ที่หน้าแพ็กเกจบนเว็บ'\./);
    assert.match(compose.systemPrompt, /say you can only share the prices packages are sold at, as a handled answer that still cites billing\.get_package_catalog's sourceRefIds when it ran\./);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.match(result.replyText, /266\.43/);
    assert.deepEqual(result.webLinks, [], 'someone who cannot buy gets no package page link');
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
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ถามลูกค้าค้างชำระ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['reimbursement.read']),
    };
    const result = await runSemanticTurnV2({
      req, provider: wrongToolControlProvider('reimbursement.get_summary'),
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
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ถามคำนวณเงินเดือน', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['access.employee.read']),
    };
    const result = await runSemanticTurnV2({
      req, provider: wrongToolControlProvider('expense.list_recent'),
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
      semanticSubrequests: [{ index: 0, kind: 'write', goal: 'ขอออกใบแจ้งหนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
    };
    const result = await runSemanticTurnV2({
      req, provider: wrongToolControlProvider('expense.list_recent'),
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
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ถามยอดบัญชีธนาคาร', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
    };
    const result = await runSemanticTurnV2({
      req, provider: wrongToolControlProvider('expense.list_recent'),
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
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ถามสต็อกสินค้า', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
    };
    const result = await runSemanticTurnV2({
      req, provider: wrongToolControlProvider('expense.list_recent'),
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
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ถามใบสั่งซื้อ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
    };
    const result = await runSemanticTurnV2({
      req, provider: wrongToolControlProvider('expense.list_recent'),
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

  // Owner 2026-09-29 ("ต้องคุยได้ เป็นความรู้ทั่วไป"): a concept question on an unsold topic is general
  // business knowledge — the composer answers it, never the package-limit copy.
  it('a general concept question on an unsold topic is composed, never the package copy', async () => {
    const answer = 'กำไรขั้นต้นคือยอดขายหักต้นทุนขายค่ะ';
    const result = await runSemanticTurnV2({
      req: { requestId: 'req-general-profit', webhookEventId: 'event-general-profit', messageText: 'กำไรขั้นต้นคืออะไร',
        messagePreviewHash: '6'.repeat(16), entitledFeatureKeys: NO_UNSOLD_MODULES_ENTITLED,
        semanticSubrequests: [{ index: 0, kind: 'general', goal: 'อธิบายกำไรขั้นต้น', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
        userContext: baseUserContext(['expense.read']) },
      provider: { async generateText(): Promise<ProviderOutput> {
        return { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'handled', text: answer }] }) };
      } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('a general clause never calls a tool'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.equal(result.replyText, answer);
  });

  // Owner eval 2026-09-29: "VAT คืออะไร" was answered correctly and still reached the customer as "ยังตอบข้อนี้
  // ไม่ได้" — the model's optional reasonCode "general_knowledge" failed the coverage contract's UPPER_SNAKE shape.
  it('keeps a composed answer whose optional reasonCode the coverage contract would reject', async () => {
    const answer = 'VAT คือภาษีมูลค่าเพิ่ม อัตราปกติ 7% ค่ะ';
    const result = await runSemanticTurnV2({
      req: { requestId: 'req-general-vat', webhookEventId: 'event-general-vat', messageText: 'VAT คืออะไร',
        messagePreviewHash: '7'.repeat(16), entitledFeatureKeys: NO_UNSOLD_MODULES_ENTITLED,
        semanticSubrequests: [{ index: 0, kind: 'general', goal: 'อธิบาย VAT', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
        userContext: baseUserContext(['expense.read']) },
      provider: { async generateText(): Promise<ProviderOutput> {
        return { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'handled', text: answer, sourceRefIds: [], reasonCode: 'general_knowledge' }] }) };
      } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('a general clause never calls a tool'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, undefined);
    assert.equal(result.replyText, answer);
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
    // F4 (tuning-6b, T-145-a): readOnlyCaptureReplyText's copy changed to name "อ่านอย่างเดียว"/"ไม่มีสิทธิ์"
    // and a next step — see line-ai-scope-policy.logic.ts.
    assert.ok(result.replyText.startsWith('บัญชีของคุณเป็นสิทธิ์แบบอ่านอย่างเดียวค่ะ'), result.replyText);
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

// E4 (tuning-6a, run 5 dead ends): previously only a two-period comparison got a deterministic
// rescue when compose produced no usable answer (SEMANTIC_ANSWER_UNAVAILABLE) — every other read
// with good tool results, and every GENERAL/social item, still dead-ended into the generic §8
// terminal. `'{}'` stands in for "compose produced nothing usable": valid JSON, so it is never
// mistaken for E3's plain-text rescue, but the wrong shape (no `answers` array), so `parsed` stays
// undefined exactly like a repair-exhausted or structurally invalid response would.
describe('E4: a read with good results, or a GENERAL item, never dead-ends when compose gives nothing usable', () => {
  const EMPTY_CANDIDATES: LineAiTurnRequest['valueCandidates'] = {
    version: 2, inputDigest: 'a'.repeat(64), extractorVersion: 'value-v2', todayIso: '2026-09-28',
    completeness: 'complete', counts: { amounts: 0, dates: 0, periods: 0 }, amounts: [], dates: [], periods: [],
  };
  const SOURCE_REF = { id: 'expenses:expense_summary:summary', label: 'รายการค่าใช้จ่าย', module: 'expenses',
    entityType: 'expense_summary', permissionChecked: true as const, asOf: '2026-09-27T18:20:29.656Z' };

  function goodResult(): ToolResult {
    return { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [SOURCE_REF],
      facts: [], data: { total: 1, items: [], summary: { totalAmount: '1000' } } };
  }

  async function runWithEmptyCompose(kind: 'read' | 'general', enabledDeterministicFamilies?: ReadonlySet<string>) {
    const req: LineAiTurnRequest = {
      requestId: 'req-e4-1', webhookEventId: 'event-e4-1',
      messageText: kind === 'read' ? 'ทำไมเดือนนี้ค้างจ่ายเยอะจังคะ' : 'ขอบคุณค่ะ',
      messagePreviewHash: 'f'.repeat(16), valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [{ index: 0, kind, goal: kind === 'read' ? 'ถามค้างจ่าย' : 'ขอบคุณ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(),
    };
    const queue = kind === 'read'
      ? [JSON.stringify({ calls: [{ index: 0, toolName: 'expense.list_recent', input: {} }], questions: [] }), '{}']
      : ['{}'];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    return runSemanticTurnV2({
      req, provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      enabledDeterministicFamilies,
      async invoke(): Promise<ToolResult> { return goodResult(); },
    });
  }

  it('T-015-a/T-057-a-style: routes a read with good results through the deterministic fallback instead of the honest terminal', async () => {
    const result = await runWithEmptyCompose('read', new Set(['expense.list_recent::single_metric', 'expense.list_recent::list']));
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'handled');
    assert.equal(coverage?.reasonCode, 'DETERMINISTIC_FALLBACK_RENDERED');
    assert.ok(result.replyText.includes('1,000'), result.replyText);
  });

  it('run 7 T-015-a: a why-question fallback renders the breakdown, not the bare list total', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-e4-why', webhookEventId: 'event-e4-why', messageText: 'ทำไมมีร่างค้างเยอะจังคะ',
      messagePreviewHash: 'e'.repeat(16), valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'อธิบายว่าทำไมมีร่างค้างเยอะ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(),
    };
    const queue = [JSON.stringify({ calls: [
      { index: 0, toolName: 'expense.list_recent', input: {} },
      { index: 0, toolName: 'expense.get_breakdown', input: { groupBy: 'category' } },
    ], questions: [] }), '{}'];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    const breakdown: ToolResult = { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [SOURCE_REF], facts: [],
      data: { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, totalAmount: '1396.5', totalCount: 1, currency: 'THB',
        byCategory: [{ category: 'ค่าบริการ', currency: 'THB', count: 1, totalAmount: '1396.5' }], byBranch: [], byVendor: [],
        queryApplied: { filters: { groupBy: 'category' } } } };
    const result = await runSemanticTurnV2({
      req, provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      enabledDeterministicFamilies: new Set(['expense.list_recent::single_metric', 'expense.list_recent::list', 'expense.get_breakdown::list']),
      async invoke(meta): Promise<ToolResult> { return meta.name === 'expense.get_breakdown' ? breakdown : goodResult(); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'DETERMINISTIC_FALLBACK_RENDERED');
    assert.ok(result.replyText.includes('ค่าบริการ'), result.replyText);
  });

  it('M3 (tuning-8, T-111-b): a why-question fallback with two breakdowns renders the UNFILTERED ranking, not the name-filtered split', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-e4-m3', webhookEventId: 'event-e4-m3', messageText: 'ทำไมจ่ายร้านสมใจการค้าเยอะจังเดือนนี้ครับ',
      messagePreviewHash: 'd'.repeat(16), valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ถามสาเหตุจ่ายร้านสมใจการค้าเยอะ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(),
    };
    const queue = [JSON.stringify({ calls: [
      { index: 0, toolName: 'expense.get_breakdown', input: { vendorName: 'ร้านสมใจการค้า' } },
      { index: 0, toolName: 'expense.get_breakdown', input: { groupBy: 'vendor' } },
    ], questions: [] }), '{}'];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    const appliedBase = { timezone: 'Asia/Bangkok', dateBasis: 'expense_incurred_date', statusBasis: 'exclude_rejected_voided', dataset: 'operational_expense_records' } as const;
    const filtered: ToolResult = { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [SOURCE_REF], facts: [],
      queryApplied: { ...appliedBase, filters: { vendorName: 'ร้านสมใจการค้า' } },
      data: { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, totalAmount: '4188.5', totalCount: 3, currency: 'THB',
        byCategory: [{ category: 'ค่าน้ำมัน', currency: 'THB', count: 1, totalAmount: '2355' }], byBranch: [],
        byVendor: [{ vendor: 'ร้านสมใจการค้า', currency: 'THB', count: 3, totalAmount: '4188.5' }],
        queryApplied: { filters: { vendorName: 'ร้านสมใจการค้า' } } } };
    const unfiltered: ToolResult = { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [SOURCE_REF], facts: [],
      queryApplied: { ...appliedBase, filters: { groupBy: 'vendor' } },
      data: { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, totalAmount: '17765', totalCount: 14, currency: 'THB',
        byCategory: [], byBranch: [],
        byVendor: [{ vendor: 'ร้านสมใจการค้า', currency: 'THB', count: 3, totalAmount: '4188.5' },
          { vendor: 'ปั๊มน้ำมัน ปตท.', currency: 'THB', count: 2, totalAmount: '3203' }],
        queryApplied: { filters: { groupBy: 'vendor' } } } };
    const result = await runSemanticTurnV2({
      req, provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      enabledDeterministicFamilies: new Set(['expense.get_breakdown::list']),
      async invoke(_meta, _ctx, args): Promise<ToolResult> { return (args as { groupBy?: string }).groupBy === 'vendor' ? unfiltered : filtered; },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'DETERMINISTIC_FALLBACK_RENDERED');
    assert.ok(result.replyText.includes('17,765'), result.replyText);
    assert.ok(result.replyText.includes('ร้านสมใจการค้า'), result.replyText);
    assert.ok(!result.replyText.includes('ตัวกรอง'), result.replyText);
  });

  it('still falls back to the honest §8 terminal, unchanged, when no deterministic family is enabled', async () => {
    const result = await runWithEmptyCompose('read');
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'unsupported');
    assert.equal(coverage?.reasonCode, 'SEMANTIC_ANSWER_UNAVAILABLE');
    assert.ok(result.replyText.includes('ดึงข้อมูลส่วนนี้ไม่ได้'), result.replyText);
  });

  it('T-010-b/T-151-b-style: a GENERAL item with no compose answer gets a friendly line, never the Expenses-page pointer', async () => {
    const result = await runWithEmptyCompose('general');
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'unsupported');
    assert.equal(coverage?.reasonCode, 'SEMANTIC_ANSWER_UNAVAILABLE');
    assert.ok(!result.replyText.includes('หน้ารายจ่ายบนเว็บ'), result.replyText);
    assert.ok(result.replyText.includes('ลองพิมพ์ถามอีกครั้ง'), result.replyText);
  });
});

// H3 (tuning-7, T-107-b/T-111-b root cause): a call that fails binding/routing used to force its
// WHOLE index to TOOL_INPUT_NOT_AUTHORIZED immediately — even when a SIBLING call for that same
// index (same control round) had already produced a good result, which is exactly what happened for
// both real-model eval turns once the planner correctly returned two expense.get_breakdown calls.
// Isolated here from H1/H2 with a deliberately unrelated second call (an unoffered tool name), so
// this specifically exercises the "defer until every call has had its chance" mechanism rather than
// the groupBy/name-filter fixes.
describe('H3: one call failing to bind never sinks an index a sibling call already answered', () => {
  it('a bogus second call for the same index is dropped silently once the first call already succeeded', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-h3-a', webhookEventId: 'event-h3-a', messageText: 'ยอดค่าใช้จ่ายเดือนนี้เท่าไหร่คะ',
      messagePreviewHash: 'f'.repeat(16),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ยอดค่าใช้จ่ายเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
    };
    const sourceRef = { id: 'expenses:expense_summary:summary', label: 'รายการค่าใช้จ่าย', module: 'expenses',
      entityType: 'expense_summary', permissionChecked: true as const, asOf: '2026-09-28T01:00:00.000Z' };
    const toolResult: ToolResult = { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-28T01:00:00.000Z',
      sourceRefs: [sourceRef], facts: [], data: { total: 3 } };
    const queue = [
      JSON.stringify({ calls: [
        { index: 0, toolName: 'expense.list_recent', input: {} },
        // Not a real offered tool — `meta` resolves to undefined, so this fails binding the same
        // way a genuinely misrouted or ungrounded call would (item 3/R-L2's `TOOL_INPUT_NOT_AUTHORIZED`
        // branch), independent of anything H1/H2 changed.
        { index: 0, toolName: 'expense.does_not_exist', input: {} },
      ], questions: [] }),
      JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'เดือนนี้มีค่าใช้จ่าย 3 รายการค่ะ', sourceRefIds: [sourceRef.id] }] }),
    ];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    let invoked = 0;
    const result = await runSemanticTurnV2({
      req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { invoked += 1; return toolResult; },
    });
    assert.equal(invoked, 1, 'only the real tool ever executes — the bogus one is never invoked');
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
    assert.ok(!result.replyText.includes('ยังดึงข้อมูลส่วนนี้ไม่ได้'), result.replyText);
  });

  it('still forces TOOL_INPUT_NOT_AUTHORIZED when EVERY call for the index fails to bind (no regression)', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-h3-b', webhookEventId: 'event-h3-b', messageText: 'ยอดค่าใช้จ่ายเดือนนี้เท่าไหร่คะ',
      messagePreviewHash: '1'.repeat(16),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ยอดค่าใช้จ่ายเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
    };
    const result = await runSemanticTurnV2({
      req: request, provider: wrongToolControlProvider('expense.does_not_exist'),
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('a nonexistent tool must never be invoked'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.status, 'unsupported');
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
  });
});
