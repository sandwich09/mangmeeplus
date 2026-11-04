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
import { buildCapabilityHelp } from './response-composer.agent';

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
      req: request, provider: { async generateText(input) { assert.equal(input.usageTag, 'line.compose'); return { ok: true, text: JSON.stringify({ answers: [] }) }; } }, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      async invoke(): Promise<ToolResult> { throw new Error('a help item must never call a tool'); },
    });
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'unsupported');
    assert.notEqual(coverage?.status, 'needs_user');
    assert.equal(coverage?.reasonCode, 'SPECIFIC_PRODUCT_GUIDE_UNAVAILABLE');
    // Must still help: name that system setup is done on the web, not just list read capabilities.
    assert.match(result.replyText, /ยังไม่มีคู่มือที่ตรวจสอบแล้ว.*เว็บ/u);
  });

  it('same outcome in English, still naming the web app for setup', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-help-2', webhookEventId: 'event-help-2', messageText: 'How do I set up an approval signature?',
      messagePreviewHash: 'f'.repeat(16), responsePreferences: { language: 'en', detail: 'normal', presentation: 'prose' },
      semanticSubrequests: [{ index: 0, kind: 'help', goal: 'Explain how to set up an approval signature', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(),
    };
    const result = await runSemanticTurnV2({
      req: request, provider: { async generateText(input) { assert.equal(input.usageTag, 'line.compose'); return { ok: true, text: JSON.stringify({ answers: [] }) }; } }, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      async invoke(): Promise<ToolResult> { throw new Error('a help item must never call a tool'); },
    });
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'unsupported');
    assert.equal(coverage?.reasonCode, 'SPECIFIC_PRODUCT_GUIDE_UNAVAILABLE');
    assert.match(result.replyText, /reviewed guide.*not available.*web/u);
  });
});

describe('current capability questions', () => {
  for (const kind of ['help', 'general'] as const) {
    for (const messageText of ['ทำอะไรได้บ้าง', 'ช่วยอะไรได้บ้าง', 'น้องทำอะไรได้', 'มีความสามารถอะไร',
      'น้องมั่งมีทำอะไรได้บ้างคะ', 'น้องมั่งมีช่วยอะไรฉันได้บ้าง', 'ทำไรได้บ้าง', 'มีฟีเจอร์อะไรบ้าง',
      'what can you do', 'What can you help me with?', 'What are your capabilities?']) {
      it(`${kind}: ${messageText} gets only the current list without a model`, async () => {
        const request: LineAiTurnRequest = {
          requestId: 'req-capability', webhookEventId: 'event-capability', messageText, messagePreviewHash: 'a'.repeat(16),
          semanticSubrequests: [{ index: 0, kind, goal: 'Describe current capabilities', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
          userContext: baseUserContext(),
        };
        const result = await runSemanticTurnV2({ req: request, provider: neverCalledProvider(),
          draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
          async invoke(): Promise<ToolResult> { throw new Error('capability help must not call a tool'); },
        });
        assert.match(result.replyText, /[ก-๙]/u.test(messageText) ? /เลือกงานที่ทำได้ตามแพ็กเกจและสิทธิ์/ : /current package and permissions/);
        assert.deepEqual(result.presentation?.cards[0]?.chatActionIds, ['expense_search']);
        assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
      });
    }
  }
});

it('answers a capability clause and still executes the independent monthly read', async () => {
  const help = 'ทำอะไรได้บ้าง', read = 'เดือนนี้ใช้ไปเท่าไหร่', messageText = `${help} แล้ว${read}`;
  const evidence = await createLineAiInputEvidence({ turnKey: 'cap-read',
    parts: [{ partId: 'text', rawText: messageText, eventIdHash: 'b'.repeat(64), acceptedAtMs: Date.now() }] });
  assert.ok(evidence);
  const part = evidence.inputEvidence.parts[0]!;
  const ref = (span: string) => [{ partId: part.partId, rawSha256: part.rawSha256,
    startUtf16: messageText.indexOf(span), endUtf16: messageText.indexOf(span) + span.length }];
  const invoked: string[] = [];
  const source = { id: 'expense-summary', label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary',
    permissionChecked: true as const, asOf: '2026-09-28T00:00:00.000Z' };
  const replies = [JSON.stringify({ calls: [{ index: 1, toolName: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-28' } }] }),
    JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'untrusted capability prose' },
      { index: 1, status: 'handled', text: 'ยอดรวม 1,000 บาทค่ะ', sourceRefIds: [source.id] }] })];
  const result = await runSemanticTurnV2({ req: {
    requestId: 'req-cap-read', webhookEventId: 'event-cap-read', messageText, messagePreviewHash: 'a'.repeat(16),
    inputEvidence: evidence.inputEvidence, valueCandidates: extractValueCandidates(messageText, '2026-09-28'),
    semanticSubrequests: [
      { index: 0, kind: 'help', goal: help, requiredEvidence: [], dependsOn: [], evidenceRefs: ref(help), requestedFilters: {} },
      { index: 1, kind: 'read', goal: read, requiredEvidence: [], dependsOn: [], evidenceRefs: ref(read),
        requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28' } },
    ], userContext: baseUserContext(),
  }, provider: { async generateText() { assert.ok(replies.length); return { ok: true, text: replies.shift()! }; } },
  draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
  async invoke(meta): Promise<ToolResult> { invoked.push(meta.name); return { toolName: meta.name, status: 'ok', sourceRefs: [source],
    asOf: source.asOf, facts: [], data: { total: 3, items: [], summary: { totalAmount: '1000' } } }; },
  });
  assert.deepEqual(invoked, ['expense.list_recent']);
  assert.deepEqual(result.semanticCoverage?.map(item => item.status), ['handled', 'handled']);
  assert.match(result.replyText, /เลือกงานที่ทำได้ตามแพ็กเกจและสิทธิ์/);
  assert.match(result.replyText, /1,000/);
  assert.doesNotMatch(result.replyText, /ยังไม่มีคู่มือ|untrusted capability prose/);
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
      // a claim-read permission; this fixture exercises the ERP tool's own deeper, authoritative
      // check (erp-reimbursement-tools.use-case.ts), which this caller's live grant can still fail —
      // see that use case's spec for the real permission check this reply text renders.
      userContext: baseUserContext(['reimbursement.read']),
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
    assert.ok(result.replyText.startsWith('คุณยังไม่มีสิทธิ์ดูใบเบิก'), result.replyText);
    assert.ok(result.replyText.includes('ดูแพ็กเกจ'), result.replyText);
    assert.ok(result.webLinks.some(link => link.path.includes('/billing')));
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
      assert.equal(result.replyText, 'เรื่องแพ็กเกจและเครดิตของร้าน ถามเจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจได้นะคะ');
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
    assert.match(compose.systemPrompt, /When receipts\.resetsOn is present, an answer about receipts says that day as the day the count starts again\./);
    assert.match(compose.systemPrompt, /add no line inviting them to upgrade, change, add to, buy or manage a package/);
    assert.match(compose.systemPrompt, /never write a web address yourself/);
    assert.match(compose.systemPrompt, /no closing line pointing to the package page/);
    assert.match(compose.systemPrompt, /Never write a field name, a code or an equation from the tool data/);
    assert.match(compose.systemPrompt, /in a Thai answer no English word such as reset or margin: say เริ่มนับใหม่ or เหลือเผื่อ\./);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.match(result.replyText, /ขาดประมาณ 50 ใบ/);
    assert.deepEqual(result.webLinks, [{ label: 'แพ็กเกจของร้าน', path: '/companies/company/billing' }]);
  });

  // Eval r11 P-02: the model gave the month's range but not the restart day the tool returned; code adds it.
  it('adds the restart day to a monthly receipt answer that leaves it out, once', async () => {
    const data = { package: { label: 'มืออาชีพ (PRO)', termEndsOn: '2026-11-10' },
      capacity: { branches: { used: 4, limit: 5, remaining: 1 }, members: { used: 4, limit: 10, remaining: 6 } },
      receipts: { used: 37, limit: 100, remaining: 63, cadence: 'รายเดือน เริ่มนับใหม่ทุกต้นเดือน', periodStartOn: '2026-10-01', periodEndsOn: '2026-10-31',
        resetsOn: '2026-11-01', expiresOn: null, additional: null, pace: null, paceNote: 'รอบนี้เพิ่งเริ่มไม่ถึง 7 วัน ยังเร็วเกินไปที่จะคาดการณ์' } };
    for (const [composed, expected] of [
      ['รอบเดือนนี้ (1–31 ต.ค. 2569) ใช้ไปแล้ว 37 ใบ เหลืออีก 63 ใบค่ะ', 'รอบเดือนนี้ (1–31 ต.ค. 2569) ใช้ไปแล้ว 37 ใบ เหลืออีก 63 ใบค่ะ\nใบเสร็จจะเริ่มนับใหม่ 1 พ.ย. 2569 ค่ะ'],
      ['เหลืออีก 63 ใบ เริ่มนับใหม่ 1 พ.ย. 2569 ค่ะ', 'เหลืออีก 63 ใบ เริ่มนับใหม่ 1 พ.ย. 2569 ค่ะ'],
    ] as const) {
      const provider: IModelProvider = { async generateText(input: ProviderInput): Promise<ProviderOutput> {
        return { ok: true, text: input.usageTag === 'line.compose' ? JSON.stringify({ answers: [{ index: 0, status: 'handled', text: composed,
          sourceRefIds: ['billing:package_usage:summary'] }] }) : CONTROL_CALL };
      } };
      const result = await runSemanticTurnV2({
        req: request('read', 'เหลือใบเสดอีกกี่ใบคะ', ['ai.tool.invoke', 'company.plan.manage']), provider, draftEditEnabled: false,
        reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
        async invoke(): Promise<ToolResult> {
          return { toolName: 'billing.get_package_usage', status: 'ok', data, asOf: '2026-10-01T03:00:00.000Z', sourceRefs: [{ label: 'แพ็กเกจของร้าน',
            module: 'billing', entityType: 'package_usage', permissionChecked: true, webPath: '/companies/company/billing' }] };
        },
      });
      assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
      assert.equal(result.replyText, expected);
    }
  });

  // Owner 2026-09-30 (~16:00, spec §5.1a): anyone may ask package prices and contents; they come only from
  // the catalog read, as selling prices with VAT per the billing policy, and never as a cost.
  it('answers a staff member\'s price question from billing.get_package_catalog, with no package page link', async () => {
    const control = JSON.stringify({ calls: [{ index: 0, toolName: 'billing.get_package_catalog', input: {} }] });
    const data = { packages: [{ name: 'เริ่มต้น (STARTER)', branches: 1, users: 2, monthly: { price: '249', vat: '17.43', payable: '266.43', receiptReads: 30 },
      yearly: { price: '2,490', vat: '174.30', payable: '2,664.30', receiptReads: 360, months: 12, averagePerMonth: '207.50', savingVersusMonthly: '498', pricedAsMonths: 10 },
      menus: ['ผู้ช่วย AI ทาง LINE', 'ค่าใช้จ่ายและใบเสร็จ'] }], vatNote: 'ราคานี้ยังไม่รวม VAT 7% ยอดที่ชำระสุทธิคือราคารวม VAT',
      usersNote: 'จำนวนผู้ใช้รวมเจ้าของกิจการ', yearlyReceiptsNote: 'แบบรายปีได้สิทธิ์อ่านใบเสร็จของทั้งปีทันทีเมื่อชำระสำเร็จ', aiCreditPerMonth: 80 };
    const calls: Array<{ usageTag: string; systemPrompt: string }> = [];
    const invoked: string[] = [];
    const provider: IModelProvider = { async generateText(input: ProviderInput): Promise<ProviderOutput> {
      calls.push({ usageTag: input.usageTag ?? '', systemPrompt: input.systemPrompt ?? '' });
      return { ok: true, text: input.usageTag === 'line.compose' ? JSON.stringify({ answers: [{ index: 0, status: 'handled',
        text: 'แพ็กเกจเริ่มต้น (STARTER) ราคา 249 บาท/เดือน บวก VAT 17.43 บาท รวมชำระ 266.43 บาทค่ะ\nหากต้องการซื้อแพ็กเกจ ทำได้บนเว็บค่ะ', sourceRefIds: ['billing:package_catalog:summary'] }] }) : control };
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
    assert.match(compose.systemPrompt, /Selling prices are the only money you may name: never state, estimate or hint at what anything costs to provide/);
    assert.match(compose.systemPrompt, /never turn credits or receipts into money or into a number of messages/);
    assert.match(compose.systemPrompt, /its savingVersusMonthly said as 'ประหยัด N บาท'.*never call a package or a payment term คุ้มกว่า or better value\./);
    assert.match(compose.systemPrompt, /never say how many packages there are or how many are bigger: list them, never 'มี 3 แบบ'/);
    assert.match(compose.systemPrompt, /Asking prices, contents or a comparison is not asking how to buy: end with what was asked, never with a line such as 'หากต้องการซื้อหรือเปลี่ยนแพ็กเกจ ทำได้ที่หน้าแพ็กเกจบนเว็บ'\./);
    assert.match(compose.systemPrompt, /say you can only share the prices packages are sold at, as a handled answer that still cites billing\.get_package_catalog's sourceRefIds when it ran\./);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.match(result.replyText, /266\.43/);
    assert.doesNotMatch(result.replyText, /หากต้องการซื้อแพ็กเกจ/, 'an unasked buy line is dropped');
    assert.deepEqual(result.webLinks, [], 'someone who cannot buy gets no package page link');
  });

  // Final-assembly run, P-32: a price answer closed with the plain "การซื้อหรือเปลี่ยนแพ็กเกจทำได้บนเว็บ …" statement.
  it('drops an unasked where-to-buy statement from a price answer and keeps it for a how-to-upgrade question', async () => {
    const control = JSON.stringify({ calls: [{ index: 0, toolName: 'billing.get_package_catalog', input: {} }] });
    const data = { packages: [{ name: 'เติบโต (BASIC)', branches: 2, users: 5, monthly: { price: '499', payable: '499', receiptReads: 50 } }], vatNote: 'ยังไม่มีข้อมูลว่าราคานี้มี VAT หรือไม่' };
    const composed = 'แพ็กเกจเติบโต รายเดือน 499 บาทค่ะ\n\nหมายเหตุ: ยังไม่มีข้อมูลว่าราคานี้มี VAT หรือไม่ค่ะ การซื้อหรือเปลี่ยนแพ็กเกจทำได้บนเว็บ ที่หน้าแพ็กเกจของร้านค่ะ';
    for (const [question, expected] of [
      ['แล้วแพ็กเกจที่ใหญ่กว่าราคาเท่าไหร่', 'แพ็กเกจเติบโต รายเดือน 499 บาทค่ะ\n\nหมายเหตุ: ยังไม่มีข้อมูลว่าราคานี้มี VAT หรือไม่ค่ะ'],
      ['อยากอัปเกรดแพ็กเกจต้องทำยังไง', composed],
    ] as const) {
      const provider: IModelProvider = { async generateText(input: ProviderInput): Promise<ProviderOutput> {
        return { ok: true, text: input.usageTag === 'line.compose' ? JSON.stringify({ answers: [{ index: 0, status: 'handled', text: composed,
          sourceRefIds: ['billing:package_catalog:summary'] }] }) : control };
      } };
      const result = await runSemanticTurnV2({
        req: request('read', question, ['ai.tool.invoke', 'company.plan.manage']), provider, draftEditEnabled: false,
        reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
        async invoke(): Promise<ToolResult> {
          return { toolName: 'billing.get_package_catalog', status: 'ok', data, asOf: '2026-10-01T03:00:00.000Z', sourceRefs: [{ label: 'แพ็กเกจที่เปิดขาย',
            module: 'billing', entityType: 'package_catalog', permissionChecked: true, webPath: '/companies/company/billing' }] };
        },
      });
      assert.equal(result.replyText, expected, question);
      // The page link is not text: whoever may manage the plan still gets it, asked or not.
      assert.deepEqual(result.webLinks, [{ label: 'แพ็กเกจที่เปิดขาย', path: '/companies/company/billing' }]);
    }
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
    assert.ok(result.replyText.startsWith('งานนี้ยังทำไม่ได้'), result.replyText);
    assert.equal(result.replyText, 'งานนี้ยังทำไม่ได้ พิมพ์ ‘เมนูหลัก’ เพื่อดูงานที่ใช้ได้ค่ะ');
    assert.doesNotMatch(result.replyText, /ยอดขาย|รายได้|รายจ่าย หลักฐานใบเสร็จ และใบเบิก/);
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
    assert.equal(result.replyText, 'งานนี้ยังทำไม่ได้ พิมพ์ ‘เมนูหลัก’ เพื่อดูงานที่ใช้ได้ค่ะ');
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
    assert.equal(result.replyText, 'งานนี้ยังทำไม่ได้ พิมพ์ ‘เมนูหลัก’ เพื่อดูงานที่ใช้ได้ค่ะ');
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
    assert.equal(result.replyText, 'งานนี้ยังทำไม่ได้ พิมพ์ ‘เมนูหลัก’ เพื่อดูงานที่ใช้ได้ค่ะ');
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
    assert.equal(result.replyText, 'งานนี้ยังทำไม่ได้ พิมพ์ ‘เมนูหลัก’ เพื่อดูงานที่ใช้ได้ค่ะ');
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
    assert.equal(result.replyText, 'งานนี้ยังทำไม่ได้ พิมพ์ ‘เมนูหลัก’ เพื่อดูงานที่ใช้ได้ค่ะ');
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
    assert.equal(result.replyText, 'งานนี้ยังทำไม่ได้ พิมพ์ ‘เมนูหลัก’ เพื่อดูงานที่ใช้ได้ค่ะ');
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
    assert.equal(result.replyText, 'งานนี้ยังทำไม่ได้ พิมพ์ ‘เมนูหลัก’ เพื่อดูงานที่ใช้ได้ค่ะ');
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
    assert.ok(result.replyText.includes('งานนี้ยังทำไม่ได้'), result.replyText);
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
    assert.match(result.replyText, /VAT คือภาษีมูลค่าเพิ่ม ยอดบนเอกสารยังไม่ได้แปลว่าใช้ตอนยื่นภาษีได้ค่ะ/);
    assert.doesNotMatch(result.replyText, /ทำได้เลย/);
  });
});

// Owner 2026-10-16 supersedes spec §11: LINE prepares a signed confirmation; only a human press writes.
describe('item 2: claim decisions and expense confirmation prepare human confirm cards', () => {
  const APPROVER_PERMISSIONS = ['reimbursement.approve', 'reimbursement.reject', 'reimbursement.payment.record', 'reimbursement.read_related'];
  const FINANCE_PERMISSIONS = ['expense.confirm', 'expense.void', 'expense.read_related'];
  for (const [name, messageText, action, permissions, allowed] of [
    ['approve a reimbursement claim with permission (eval T-144)', 'ช่วยอนุมัติใบเบิกของสมชายให้หน่อยค่ะ', 'REIMBURSEMENT_APPROVE', APPROVER_PERMISSIONS, true],
    ['approve a reimbursement claim WITHOUT permission (eval T-147)', 'ช่วยอนุมัติใบเบิกอันนี้ให้หน่อยค่ะ', 'REIMBURSEMENT_APPROVE', ['reimbursement.read_own'], false],
    ['reject a reimbursement claim', 'ปฏิเสธใบเบิกนี้หน่อยค่ะ', 'REIMBURSEMENT_REJECT', APPROVER_PERMISSIONS, true],
    ['pay a reimbursement claim', 'ช่วยจ่ายใบเบิกให้หน่อยค่ะ', 'REIMBURSEMENT_RECORD_PAYMENT', APPROVER_PERMISSIONS, true],
    ['confirm an expense record', 'ยืนยันรายการค่าใช้จ่ายนี้ให้หน่อยค่ะ', 'CONFIRM', FINANCE_PERMISSIONS, true],
    ['void a confirmed expense record without permission', 'ยกเลิกรายการค่าใช้จ่ายนี้หน่อยค่ะ', 'VOID', ['expense.read_related'], false],
  ] as const) it(name, async () => {
    const claim = action.startsWith('REIMBURSEMENT_');
    const calls: string[] = [];
    const result = await runSemanticTurnV2({
      req: { requestId: 'req-action', webhookEventId: 'event-action', messageText, messagePreviewHash: '5'.repeat(16),
        semanticSubrequests: [{ index: 0, kind: 'write', goal: messageText, requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
        userContext: baseUserContext([...permissions]),
        conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: [], recentReads: [{
          tool: claim ? 'reimbursement.get_detail' : 'expense.get_detail', answerShape: 'single_metric',
          asOf: new Date().toISOString(), shownItems: [{ ordinal: 1, id: 'shown-record', label: 'รายการที่เลือก' }],
        }] } },
      provider: { async generateText(input): Promise<ProviderOutput> {
        if (input.usageTag === 'line.compose') return { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'denied', text: 'บทบาทของคุณยังไม่มีสิทธิ์ทำรายการนี้ค่ะ' }] }) };
        assert.equal(input.usageTag, 'line.loop', 'the API owns the confirmation text');
        return { ok: true, text: JSON.stringify({ calls: [{ index: 0, toolName: 'expense.action.preview',
          input: { action, [claim ? 'reimbursementId' : 'expenseId']: 'shown-record' } }] }) };
      } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(meta): Promise<ToolResult> {
        calls.push(meta.name);
        assert.equal(meta.name, 'expense.action.preview', 'no final mutation before a human press');
        if (!allowed) return { toolName: meta.name, status: 'forbidden', sourceRefs: [], errorCode: 'FORBIDDEN', asOf: new Date().toISOString() };
        return { toolName: meta.name, status: 'ok', asOf: new Date().toISOString(),
          sourceRefs: [{ label: 'คำขอให้ตรวจ', module: 'expenses', entityType: 'expense_action_preview', permissionChecked: true }],
          data: { reply: 'ตรวจรายละเอียดแล้วกดยืนยันค่ะ', preview: { action, token: 'signed-confirm-token' } } };
      },
    });
    assert.deepEqual(calls, allowed ? ['expense.action.preview'] : []);
    if (allowed) {
      assert.equal(result.semanticCoverage?.[0]?.status, 'needs_user');
      assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'CONFIRMATION_REQUIRED');
      assert.equal(result.replyText, 'ตรวจรายละเอียดแล้วกดยืนยันค่ะ');
      assert.equal((result.outputs[0]?.toolData?.[0]?.data as any)?.preview.token, 'signed-confirm-token');
    } else {
      assert.equal(result.semanticCoverage?.[0]?.status, 'denied');
      assert.ok(result.outputs.every(output => !output.toolData?.length), 'a refused preview carries no confirm card');
    }
    assert.doesNotMatch(result.replyText, /อนุมัติแล้ว|จ่ายแล้ว|ยืนยันแล้ว|ยกเลิกแล้ว/u);
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
      req, provider: { async generateText(): Promise<ProviderOutput> { return { ok: true, text: JSON.stringify({ answers: [] }) }; } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      async invoke(): Promise<ToolResult> { throw new Error('must never call a tool for a read-only capture request'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'READONLY_ROLE_CANNOT_CREATE');
    // F4 (tuning-6b, T-145-a): readOnlyCaptureReplyText's copy changed to name "อ่านอย่างเดียว"/"ไม่มีสิทธิ์"
    // and a next step — see line-ai-scope-policy.logic.ts.
    assert.ok(result.replyText.startsWith('คุณไม่มีสิทธิ์บันทึกหรือส่งใบเสร็จเข้าระบบ'), result.replyText);
  });

  it('the same request is NOT blocked for a role that can create expenses', async () => {
    const req: LineAiTurnRequest = {
      requestId: 'req-can-create', webhookEventId: 'event-can-create', messageText: 'ถ่ายรูปใบเสร็จแล้วส่งเข้าระบบให้หน่อยค่ะ', messagePreviewHash: '7'.repeat(16),
      semanticSubrequests: [{ index: 0, kind: 'help', goal: 'ถามวิธีบันทึกใบเสร็จ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.receipt.line_upload']),
      approvedKnowledge: true,
    };
    const result = await runSemanticTurnV2({
      req, provider: { async generateText(): Promise<ProviderOutput> { return { ok: true, text: JSON.stringify({ answers: [] }) }; } },
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

// Advisor S0 (R1 integrated G run 2026-10-01): general-knowledge and non-business answers, and stock asked in a mixed
// message. Each case is one the real model produced in that run.
describe('advisor S0: general answers are shaped in code, and a stock clause is answered before any planning', () => {
  const STEER = 'ถ้ามีเรื่องร้านหรือรายจ่ายให้ช่วย บอกได้เลยค่ะ';
  const FIXED_STOCK = 'งานนี้ยังทำไม่ได้ พิมพ์ ‘เมนูหลัก’ เพื่อดูงานที่ใช้ได้ค่ะ';

  function recording(responses: string[]) {
    const queue = [...responses];
    const calls: Array<{ usageTag: string; systemPrompt: string }> = [];
    const provider: IModelProvider = { async generateText(input: ProviderInput): Promise<ProviderOutput> {
      calls.push({ usageTag: input.usageTag ?? '', systemPrompt: input.systemPrompt ?? '' });
      return { ok: true, text: queue.shift() ?? '{}' };
    } };
    return { provider, calls };
  }

  async function general(messageText: string, intakeIntent: LineAiTurnRequest['intakeIntent'], answer: Record<string, unknown>) {
    const { provider, calls } = recording([JSON.stringify({ answers: [{ index: 0, status: 'handled', sourceRefIds: [], ...answer }] })]);
    const result = await runSemanticTurnV2({
      req: { requestId: 'req-s0', webhookEventId: 'event-s0', messageText, messagePreviewHash: '5'.repeat(16), intakeIntent,
        entitledFeatureKeys: NO_UNSOLD_MODULES_ENTITLED,
        semanticSubrequests: [{ index: 0, kind: 'general', goal: messageText, requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
        userContext: baseUserContext(['expense.read_own', 'expense.create', 'reimbursement.read_own']) },
      provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('a general answer reads no tool'); },
    });
    assert.deepEqual(calls.map((call) => call.usageTag), ['line.compose'], 'the answer with "topic" is accepted on the first compose');
    assert.deepEqual(result.semanticCoverage, [{ index: 0, status: 'handled', sourceRefIds: [] }], 'topic never joins the coverage');
    return { replyText: result.replyText, prompt: calls[0]!.systemPrompt };
  }

  // G-06: five bullets for "แนะนำหนังสนุกๆ หน่อย"; G-15: a full recipe.
  it('a non-business answer stays two short lines and ends with the shop line from code', async () => {
    const films = await general('แนะนำหนังสนุกๆ หน่อย', 'UNSUPPORTED', { topic: 'other',
      text: 'มั่งมีแนะนำหนังสนุกๆ ได้บ้างนะคะ 😊\n\n• Interstellar ไซไฟอลังการ\n• Parasite ระทึก พลิกโผ\n• Coco — อบอุ่นมากค่ะ\n\nถ้ามีเรื่องร้านหรือค่าใช้จ่ายให้ช่วย บอกได้เลยนะคะ' });
    assert.equal(films.replyText, `Interstellar ไซไฟอลังการ\nParasite ระทึก พลิกโผ\n\n${STEER}`);
    // The router may file a food question under its social route; the composer's mark still decides.
    const recipe = await general('ขอสูตรต้มยำกุ้งหน่อย', 'ADVISOR_CONVERSATION', { topic: 'other', text: 'ต้มน้ำซุปกับตะไคร้ ข่า ใบมะกรูด ใส่กุ้งและเห็ด\nปรุงด้วยน้ำปลา น้ำมะนาว พริกตามชอบค่ะ' });
    assert.equal(recipe.replyText, `ต้มน้ำซุปกับตะไคร้ ข่า ใบมะกรูด ใส่กุ้งและเห็ด\nปรุงด้วยน้ำปลา น้ำมะนาว พริกตามชอบค่ะ\n\n${STEER}`);
    // No mark at all: her own shop line on a turn the router placed outside the product says the same.
    const unmarked = await general('เมืองหลวงของญี่ปุ่นคืออะไร', 'UNSUPPORTED', { text: 'โตเกียวค่ะ\n\nถ้ามีเรื่องร้านหรือค่าใช้จ่ายให้ช่วย บอกได้เลยนะคะ 😊' });
    assert.equal(unmarked.replyText, `โตเกียวค่ะ\n\n${STEER}`);
  });

  // Final-assembly run, P-31: the cost question went to the general lane and the refusal said "margin".
  it('a general answer says "margin" and "reset" in Thai unless the turn itself used the word', async () => {
    const refusal = 'มั่งมีบอกได้เฉพาะราคาที่แพ็กเกจถูกขายค่ะ ต้นทุน AI ต่อใบเสร็จ กำไรต่อแพ็กเกจ หรือ margin ใดๆ เป็นข้อมูลภายในค่ะ';
    const cost = await general('มั่งมีมีต้นทุน AI ต่อใบเสร็จเท่าไหร่ กำไรต่อแพ็กเกจเท่าไหร่', 'BUSINESS_READ_QUESTION', { topic: 'business', text: refusal });
    assert.equal(cost.replyText, 'มั่งมีบอกได้เฉพาะราคาที่แพ็กเกจถูกขายค่ะ ต้นทุน AI ต่อใบเสร็จ กำไรต่อแพ็กเกจ หรือกำไรส่วนต่างใดๆ เป็นข้อมูลภายในค่ะ');
    const asked = await general('margin คืออะไรคะ', 'BUSINESS_READ_QUESTION', { topic: 'business', text: 'margin คือส่วนต่างระหว่างราคาขายกับต้นทุนค่ะ' });
    assert.equal(asked.replyText, 'margin คือส่วนต่างระหว่างราคาขายกับต้นทุนค่ะ', 'the user said the word: it stays');
  });

  // G-04, G-11, G-23: business knowledge closed with the shop line; six answers gave an agency website from memory.
  it('a business-knowledge answer keeps its length and loses the shop line and any web address', async () => {
    const body = 'การตั้งราคาขายให้มีกำไร มีหลักคิดดังนี้ค่ะ\n\n• คำนวณต้นทุนให้ครบ\n• กำหนดกำไรที่ต้องการ\n• เทียบราคาตลาด\n\nแนะนำให้หารือกับนักบัญชีหรือกรมสรรพากร';
    const text = `${body} (rd.go.th) นะคะ\n\nถ้ามีเรื่องค่าใช้จ่ายหรือข้อมูลร้านให้ช่วย บอกได้เลยค่ะ 😊`;
    for (const [intent, topic] of [['ADVISOR_CONVERSATION', 'business'], ['BUSINESS_READ_QUESTION', 'business'],
      // The router's own business route outranks a composer that marked a business answer "other".
      ['BUSINESS_READ_QUESTION', 'other'], ['ADVISOR_CONVERSATION', undefined]] as const) {
      const answer = await general('ตั้งราคาขายยังไงให้มีกำไร', intent, { ...(topic ? { topic } : {}), text });
      assert.equal(answer.replyText, `${body} นะคะ`, `${intent} ${topic}`);
    }
  });

  it('greetings and small talk keep their own reply', async () => {
    const thanks = await general('ขอบคุณค่ะ', 'UNSUPPORTED', { topic: 'social', text: 'ยินดีค่ะ 😊 มีอะไรให้ช่วยอีกบอกได้เลยนะคะ' });
    assert.equal(thanks.replyText, 'ยินดีค่ะ 😊 มีอะไรให้ช่วยอีกบอกได้เลยนะคะ');
  });

  it('tells the composer the general rules: topic, rule before verdict, no re-announced figure, no web address, no list', async () => {
    const { prompt } = await general('ค่าแรงขั้นต่ำตอนนี้เท่าไหร่', 'BUSINESS_READ_QUESTION', { topic: 'business', text: 'ค่าแรงขั้นต่ำเปลี่ยนตามประกาศค่ะ' });
    assert.match(prompt, /The answer object of a general subrequest also carries "topic", written before "text"/);
    assert.match(prompt, /open with the rule and then say on which side of it their figure falls, so no sentence contradicts another/);
    assert.match(prompt, /A figure you would have to recall that is re-announced from time to time \(the minimum wage, a contribution or wage ceiling, an interest or exchange rate\) is never given as a number/);
    assert.match(prompt, /name an agency by its name only, never a web address, and never write a calendar date \(day, month and year\) from memory/);
    assert.match(prompt, /even when the user asks for a list, a recipe or instructions, give only the gist in those two lines/);
    assert.match(prompt, /a business knowledge answer never carries it/);
  });

  // G-16: "สต็อกคืออะไร แล้วร้านเรามีของเหลือเท่าไหร่" — the planner read company.get_current_context for the stock half and
  // the reply was "ยังดึงข้อมูลส่วนนี้ไม่ได้ค่ะ ดูได้ที่หน้ารายจ่ายบนเว็บ".
  it('a mixed message answers the knowledge half and gives the stock half the fixed reply, with no planning and no tool', async () => {
    const knowledgeSpan = 'สต็อกคืออะไร', stockSpan = 'ร้านเรามีของเหลือเท่าไหร่';
    const messageText = `${knowledgeSpan} แล้ว${stockSpan}`;
    const evidence = await createLineAiInputEvidence({ turnKey: 's0-mixed', parts: [{ partId: 'text', rawText: messageText, eventIdHash: 'b'.repeat(64), acceptedAtMs: Date.now() }] });
    assert.ok(evidence);
    const part = evidence.inputEvidence.parts[0]!;
    const ref = (span: string) => [{ partId: part.partId, rawSha256: part.rawSha256, startUtf16: messageText.indexOf(span), endUtf16: messageText.indexOf(span) + span.length }];
    const { provider, calls } = recording([JSON.stringify({ answers: [
      { index: 0, status: 'handled', topic: 'business', text: 'สต็อกคือสินค้าที่กิจการถือไว้เพื่อขายค่ะ', sourceRefIds: [] },
      { index: 1, status: 'handled', text: 'ignored — the scope policy already answered this clause', sourceRefIds: [] },
    ] })]);
    const result = await runSemanticTurnV2({
      req: { requestId: 'req-s0-mixed', webhookEventId: 'event-s0-mixed', messageText, messagePreviewHash: '6'.repeat(16),
        intakeIntent: 'BUSINESS_READ_QUESTION', entitledFeatureKeys: NO_UNSOLD_MODULES_ENTITLED, inputEvidence: evidence.inputEvidence,
        valueCandidates: extractValueCandidates(messageText, '2026-10-01'),
        semanticSubrequests: [
          { index: 0, kind: 'general', goal: 'อธิบายความหมายของสต็อก', requiredEvidence: [], dependsOn: [], requestedFilters: {}, evidenceRefs: ref(knowledgeSpan) },
          { index: 1, kind: 'read', goal: 'ดูยอดสินค้าคงเหลือของร้าน', requiredEvidence: [], dependsOn: [], requestedFilters: {}, evidenceRefs: ref(stockSpan) },
        ],
        userContext: baseUserContext(['expense.read']) },
      provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('no tool may run for the stock clause'); },
    });
    assert.deepEqual(calls.map((call) => call.usageTag), ['line.compose'], 'nothing is left to plan');
    // Owner 2026-10-16: preserve both answers without numbered text lists.
    assert.equal(result.replyText, `สต็อกคือสินค้าที่กิจการถือไว้เพื่อขายค่ะ\n\n${FIXED_STOCK}`);
    assert.deepEqual(result.semanticCoverage?.map((entry) => [entry.status, entry.reasonCode]), [['handled', undefined], ['unsupported', 'PACKAGE_FEATURE_NOT_ENABLED']]);
  });
});

// Design lock (2026-10-04): the v2 turn is the path every bound chat takes. It carries a card layout
// only when the whole reply is ONE item whose rows the trusted code built from a successful,
// permission-checked result — a read of the reader's open work, or the deterministic read sentence.
describe('design lock: the v2 turn attaches a card layout built from the tool result, never from model text', () => {
  const AS_OF = '2026-09-17T10:00:00.000Z';
  const NOTICE_REF = { id: 'dashboard-notifications:notification_event:n1', label: 'อนุมัติเบิกจ่าย: RB-202608-00002', module: 'dashboard-notifications',
    entityType: 'notification_event', entityId: 'n1', permissionChecked: true as const, asOf: AS_OF, webPath: '/companies/company/reimbursements/rb-1' };
  const claimResult = (): ToolResult => ({ toolName: 'notifications.list_open_alerts', status: 'ok', asOf: AS_OF, sourceRefs: [NOTICE_REF], facts: [],
    data: { count: 1, hasMore: false, opens: 'claim', items: [{ id: 'n1', title: 'อนุมัติเบิกจ่าย: RB-202608-00002', severity: 'ACTION', createdAt: AS_OF, kind: 'claim_approval', documentNo: 'RB-202608-00002' }] } });

  function openWorkRequest(permissions = ['notification.read', 'workflow.task.read']): LineAiTurnRequest {
    return {
      requestId: 'req-open-work', webhookEventId: 'event-open-work', messageText: 'มีงานค้างอะไรบ้างคะ', messagePreviewHash: 'b'.repeat(16),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'แจ้งเตือนที่ยังเปิด', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(permissions),
    };
  }

  async function run(request: LineAiTurnRequest, modelTexts: string[], invoke: (toolName: string) => ToolResult) {
    const queue = [...modelTexts];
    const provider: IModelProvider = { async generateText(_input: ProviderInput): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    return runSemanticTurnV2({
      req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      enabledDeterministicFamilies: new Set(['expense.list_recent::single_metric', 'expense.get_detail::single_metric']),
      async invoke(meta): Promise<ToolResult> { return invoke(meta.name); },
    });
  }
  const call = (toolName: string, input: Record<string, unknown> = {}) => JSON.stringify({ calls: [{ index: 0, toolName, input }] });
  const answer = (text: string, sourceRefIds: string[]) => JSON.stringify({ answers: [{ index: 0, status: 'handled', text, sourceRefIds }] });

  it('open work: the sentence is the model\'s, the rows and the claim button are the tool result\'s', async () => {
    const result = await run(openWorkRequest(), [call('notifications.list_open_alerts'), answer('มีใบเบิกรออนุมัติจากคุณอยู่ค่ะ', [NOTICE_REF.id])], claimResult);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.deepEqual(result.presentation, { kind: 'answer_cards', cards: [{
      text: result.replyText,
      layout: {
        context: 'open_work', header: ['ใบเบิกรออนุมัติ', 'พบ 1 รายการ'],
        rows: [{ label: 'เลขที่ใบเบิก', value: 'RB-202608-00002' }, { label: 'ต้องทำ', value: 'ตรวจสอบและอนุมัติใบเบิก' }, { label: 'ข้อมูล ณ', value: '17 กันยายน 2569' }],
        notes: ['ตรวจเฉพาะแจ้งเตือนที่ยังไม่ปิด ตามสิทธิ์ของคุณ'], linkLabel: 'เปิดใบเบิกเพื่ออนุมัติ',
      },
      sourceLabels: ['อนุมัติเบิกจ่าย: RB-202608-00002'],
      webLink: { label: 'อนุมัติเบิกจ่าย: RB-202608-00002', path: '/companies/company/reimbursements/rb-1' },
    }] });
  });

  it('a refused or failed read of open work has no card: it is never drawn as "nothing found"', async () => {
    for (const status of ['forbidden', 'unavailable'] as const) {
      const result = await run(openWorkRequest(), [call('notifications.list_open_alerts'), answer('ไม่พบแจ้งเตือนค่ะ', [NOTICE_REF.id])],
        () => ({ toolName: 'notifications.list_open_alerts', status, asOf: AS_OF, sourceRefs: [] }));
      assert.equal(result.presentation, undefined, status);
      assert.notEqual(result.semanticCoverage?.[0]?.status, 'handled', status);
      assert.doesNotMatch(result.replyText, /ไม่พบแจ้งเตือน|ไม่พบรายการ/, status);
    }
  });

  it('an answer that is more than that one item is not a card of it', async () => {
    const request = openWorkRequest();
    request.semanticSubrequests = [
      { index: 0, kind: 'read', goal: 'แจ้งเตือนที่ยังเปิด', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} },
      { index: 1, kind: 'general', goal: 'ทักทาย', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} },
    ];
    const result = await run(request, [call('notifications.list_open_alerts'), JSON.stringify({ answers: [
      { index: 0, status: 'handled', text: 'มีใบเบิกรออนุมัติจากคุณอยู่ค่ะ', sourceRefIds: [NOTICE_REF.id] },
      { index: 1, status: 'handled', topic: 'social', text: 'สวัสดีค่ะ' }] })], claimResult);
    assert.ok(result.replyText.includes('มีใบเบิกรออนุมัติจากคุณอยู่ค่ะ'), result.replyText);
    assert.equal(result.presentation, undefined);
  });

  // Owner 2026-10-05, real LINE: "มีงานค้างอะไรบ้าง" came back as three numbered parts on the card from
  // before the design. "อ่านยากมาก … พยายามเอาเข้า pattern นะ". One card of every read of that answer.
  describe('the reader\'s waiting work: every read of the answer on ONE card', () => {
    const NOW = '2026-10-05T07:41:00.000Z';
    const PERMISSIONS = ['expense.read', 'expense.confirm', 'expense.read_related', 'reimbursement.approve', 'reimbursement.read'];
    const ref = (label: string, entityType: string, webPath: string) => ({ id: `x:${entityType}:summary`, label, module: 'expenses', entityType, permissionChecked: true as const, asOf: NOW, webPath });
    const QUEUE_REF = ref('ใบรับรองแทนใบเสร็จ', 'substitute_receipt_queue', '/companies/company/expenses/substitute-receipts');
    const APPROVAL_REF = ref('รายการเบิกจ่ายรออนุมัติ', 'reimbursement_approval_queue', '/companies/company/reimbursements');
    const CLOSING_REF = ref('สรุปปิดร้าน 5 ต.ค. 2569', 'expense_daily_closing', '/companies/company/expenses');
    const section = (total: number, amount?: string) => ({ totals: amount ? [{ currency: 'THB', count: total, total: amount }] : [], items: { total, shown: 0, remaining: total, items: [] } });
    const counted = (count: number) => ({ count, items: { total: count, shown: 0, remaining: count, items: [] } });
    const READS: Record<string, () => ToolResult> = {
      'expense.list_substitute_receipts_to_sign': () => ({ toolName: 'expense.list_substitute_receipts_to_sign', status: 'ok', asOf: NOW, sourceRefs: [QUEUE_REF], facts: [],
        data: { accessScope: 'own', total: 0, asPayer: { count: 0, items: [] }, asApprover: { count: 0, items: [] } } }),
      'reimbursement.list_pending_approvals': () => ({ toolName: 'reimbursement.list_pending_approvals', status: 'ok', asOf: NOW, sourceRefs: [APPROVAL_REF], facts: [], data: { total: 0, items: [] } }),
      'expense.get_daily_closing': () => ({ toolName: 'expense.get_daily_closing', status: 'ok', asOf: NOW, sourceRefs: [CLOSING_REF], facts: [],
        data: { date: '2026-10-05', timezone: 'Asia/Bangkok', accessScope: 'company',
          occurredToday: { totals: [], paid: [], outstanding: [], items: { total: 0, shown: 0, remaining: 0, items: [] } },
          submittedToday: { count: 0 }, dueEndOfDay: section(0), overdue: section(0), unscheduledOutstanding: section(19, '26478.2400'),
          pendingReview: counted(21), evidenceBlockers: counted(9), duplicateRisks: counted(6) } }),
    };
    const items = (count: number) => Array.from({ length: count }, (_, index) => ({ index, kind: 'read' as const, goal: 'งานค้าง', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }));
    const request = (messageText: string, count: number): LineAiTurnRequest => ({ requestId: 'req-backlog', webhookEventId: 'event-backlog', messageText, messagePreviewHash: 'd'.repeat(16),
      semanticSubrequests: items(count), userContext: baseUserContext(PERMISSIONS) });
    const THREE_CALLS = JSON.stringify({ calls: [
      { index: 0, toolName: 'expense.list_substitute_receipts_to_sign', input: {} }, { index: 1, toolName: 'reimbursement.list_pending_approvals', input: {} },
      { index: 2, toolName: 'expense.get_daily_closing', input: {} }] });
    const THREE_ANSWERS = JSON.stringify({ answers: [
      { index: 0, status: 'handled', text: 'ใบรับรองแทนใบเสร็จที่รอให้เซ็นหรืออนุมัติ: ไม่มีค้างอยู่เลยค่ะ ✅', sourceRefIds: [QUEUE_REF.id] },
      { index: 1, status: 'handled', text: 'รายการเบิกจ่ายที่รอให้อนุมัติ: ไม่มีค้างเช่นกันค่ะ ✅', sourceRefIds: [APPROVAL_REF.id] },
      { index: 2, status: 'handled', text: 'งานค้างปิดวันมีที่ต้องจัดการบนเว็บดังนี้ค่ะ\n• ค่าใช้จ่ายยังไม่จ่าย 19 รายการ รวม 26,478.24 บาท\n• รอตรวจสอบ 21 รายการ', sourceRefIds: [CLOSING_REF.id] }] });
    const LAYOUT = {
      context: 'open_work', header: ['งานค้าง', 'ณ 5 ต.ค. 2569'],
      rows: [
        { label: 'รอตรวจสอบ', value: '21 รายการ' }, { label: 'ค้างจ่าย (ยังไม่กำหนดวันจ่าย)', value: '19 รายการ รวม 26,478.24 บาท' },
        { label: 'รอตรวจหลักฐาน', value: '9 รายการ' }, { label: 'อาจเป็นรายการซ้ำ', value: '6 รายการ' },
        { label: 'ใบรับรองแทนใบเสร็จ', value: 'ไม่มีค้าง' }, { label: 'เบิกจ่ายรอคุณอนุมัติ', value: 'ไม่มีค้าง' },
      ],
      notes: ['ไม่มีรายการครบกำหนดจ่ายวันนี้หรือเกินกำหนด', 'ตรวจเฉพาะงานที่รอคุณและรายการที่คุณมีสิทธิ์ดู'],
    };

    it('three questions the router split, three reads: one card whose text is the whole reply and whose rows are the reads\'', async () => {
      const result = await run(request('มีงานค้างอะไรบ้าง', 3), [THREE_CALLS, THREE_ANSWERS], (toolName) => READS[toolName]!());
      assert.deepEqual(result.semanticCoverage?.map((entry) => entry.status), ['handled', 'handled', 'handled']);
      // Owner 2026-10-16: preserve every answer and its scope without numbered text lists.
      assert.match(result.replyText, /^ใบรับรองแทนใบเสร็จที่รอให้เซ็นหรืออนุมัติ: ไม่มีค้างอยู่เลยค่ะ ✅\nขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ\n\nรายการเบิกจ่าย/u);
      assert.deepEqual(result.presentation, { kind: 'answer_cards', cards: [{
        text: result.replyText, layout: LAYOUT,
        sourceLabels: ['ใบรับรองแทนใบเสร็จ', 'รายการเบิกจ่ายรออนุมัติ', 'สรุปปิดร้าน 5 ต.ค. 2569'],
        webLink: { label: 'ใบรับรองแทนใบเสร็จ', path: '/companies/company/expenses/substitute-receipts' },
      }] });
      // Every page of the answer rides the reply, each under its own name: the card's buttons.
      assert.deepEqual(result.webLinks.map((link) => link.label), ['ใบรับรองแทนใบเสร็จ', 'รายการเบิกจ่ายรออนุมัติ', 'สรุปปิดร้าน 5 ต.ค. 2569']);
    });

    it('one question, the three reads the planner adds to it: the same card', async () => {
      const result = await run(request('งานค้างของฉันมีอะไรบ้าง', 1), [
        JSON.stringify({ calls: [{ index: 0, toolName: 'expense.get_daily_closing', input: {} }] }),
        JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'ไม่มีใบรับรองหรือใบเบิกรอคุณค่ะ ส่วนค่าใช้จ่ายมีรอตรวจสอบ 21 รายการ ทำต่อได้บนเว็บค่ะ', sourceRefIds: [CLOSING_REF.id, QUEUE_REF.id, APPROVAL_REF.id] }] }),
      ], (toolName) => READS[toolName]!());
      assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
      const card = result.presentation?.kind === 'answer_cards' ? result.presentation.cards : [];
      assert.equal(card.length, 1);
      assert.equal(card[0]!.text, result.replyText);
      assert.deepEqual(card[0]!.layout?.header, LAYOUT.header);
      assert.deepEqual(new Set(card[0]!.layout?.rows.map((row) => row.label)), new Set(LAYOUT.rows.map((row) => row.label)));
    });

    it('is not that card when a read was refused or failed, when the answer reads anything else, or when the day\'s checklist alone answers another question', async () => {
      // The approval queue refused: its honest sentence is the answer; no card dresses it as "nothing waiting".
      for (const status of ['forbidden', 'unavailable'] as const) {
        const refused = await run(request('มีงานค้างอะไรบ้าง', 3), [THREE_CALLS, THREE_ANSWERS], (toolName) => toolName === 'reimbursement.list_pending_approvals'
          ? { toolName, status, asOf: NOW, sourceRefs: [], ...(status === 'forbidden' ? { errorCode: 'REIMBURSEMENT_APPROVAL_NOT_PERMITTED' } : {}) } : READS[toolName]!());
        assert.equal(refused.presentation, undefined, status);
        assert.doesNotMatch(refused.replyText, /ไม่มีค้างเช่นกัน/u, status);
      }
      // "ค่าใช้จ่ายวันนี้เท่าไหร่" reads the same checklist and is not a question about waiting work.
      const today = await run(request('ค่าใช้จ่ายวันนี้เท่าไหร่', 1), [
        JSON.stringify({ calls: [{ index: 0, toolName: 'expense.get_daily_closing', input: {} }] }),
        JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'วันนี้ยังไม่มีรายการค่าใช้จ่ายค่ะ', sourceRefIds: [CLOSING_REF.id] }] }),
      ], (toolName) => READS[toolName]!());
      assert.equal(today.semanticCoverage?.[0]?.status, 'handled');
      assert.equal(today.presentation, undefined);
      // A result that is not its tool's shape: the sentences, no rows.
      const odd = await run(request('มีงานค้างอะไรบ้าง', 3), [THREE_CALLS, THREE_ANSWERS], (toolName) => toolName === 'expense.get_daily_closing'
        ? { ...READS[toolName]!(), data: { ...(READS[toolName]!().data as object), date: undefined } } : READS[toolName]!());
      assert.equal(odd.presentation, undefined);
    });
  });

  it('a deterministic read sentence brings its own card; a model-composed read sentence brings none', async () => {
    const detailRef = { id: 'expenses:expense:e1', label: 'EXP-2026-0009', module: 'expenses', entityType: 'expense', entityId: 'e1',
      permissionChecked: true as const, asOf: AS_OF, webPath: '/companies/company/expenses/e1' };
    const detail = (): ToolResult => ({ toolName: 'expense.get_detail', status: 'ok', asOf: AS_OF, sourceRefs: [detailRef], facts: [],
      data: { id: 'e1', expenseNumber: 'EXP-2026-0009', expenseDate: '2026-08-05T00:00:00.000Z', vendorName: 'ร้านสมใจ', status: 'CONFIRMED',
        paymentStatus: 'UNPAID', grandTotalAmount: '900.00', netPayableAmount: '900.00', paidAmount: '0.00', outstandingAmount: '900.00',
        payments: { count: 0, lastPaidOn: null, methods: [] } } });
    const request = (messageText: string): LineAiTurnRequest => ({
      requestId: 'req-detail', webhookEventId: 'event-detail', messageText, messagePreviewHash: 'c'.repeat(16),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'รายละเอียดรายการ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
      conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: [], recentReads: [{ tool: 'expense.list_recent', answerShape: 'list', asOf: AS_OF,
        shownItems: [{ ordinal: 1, id: 'e1', label: 'ร้านสมใจ' }] }] },
    });
    // The composer's number is not in the result: grounding refuses it and the verified formatter answers.
    const fallback = await run(request('รายการนี้จ่ายหรือยังคะ'), [call('expense.get_detail', { expenseId: 'e1' }), answer('ยอด 12,345 บาทค่ะ', [detailRef.id])], detail);
    assert.equal(fallback.semanticCoverage?.[0]?.reasonCode, 'DETERMINISTIC_FALLBACK_RENDERED');
    const card = fallback.presentation?.kind === 'answer_cards' ? fallback.presentation.cards[0] : undefined;
    assert.equal(card?.text, fallback.replyText);
    assert.deepEqual(card?.layout?.header, ['การชำระเงิน', 'รอชำระเงิน']);
    assert.deepEqual(card?.layout?.banner, { tone: 'pending', text: 'ยังไม่ชำระ · ยอดคงค้าง 900.00 บาท' });
    assert.ok(fallback.replyText.startsWith('การชำระเงิน: ร้านสมใจ ยอดสุทธิที่ต้องจ่าย 900.00 บาท'), fallback.replyText);
    // The composer's own grounded sentence: prose, no rows — model text never fills a card.
    const composed = await run(request('รายการนี้ร้านอะไรคะ'), [call('expense.get_detail', { expenseId: 'e1' }), answer('ร้านสมใจค่ะ', [detailRef.id])], detail);
    assert.equal(composed.semanticCoverage?.[0]?.status, 'handled');
    assert.equal(composed.replyText, 'ร้านสมใจค่ะ');
    assert.equal(composed.presentation, undefined);
  });
});
