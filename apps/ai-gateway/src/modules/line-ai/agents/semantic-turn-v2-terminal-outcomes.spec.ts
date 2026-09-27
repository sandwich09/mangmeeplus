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
import { extractValueCandidates, type LineAiTurnRequest, type ToolResult } from '@watchdog-bms/contracts';
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
      messagePreviewHash: 'f'.repeat(16), responsePreferences: { language: 'en' },
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
  // trigger (`answer.sourceRefIds.some(id => !allowed.has(id))`).
  const UNCITABLE_ANSWER = JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'ยอดรวม 1,000 บาทค่ะ', sourceRefIds: ['not-a-real-source'] }] });

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
    assert.ok(!result.replyText.includes('1,000'), 'the uncited model total must not leak through');
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
