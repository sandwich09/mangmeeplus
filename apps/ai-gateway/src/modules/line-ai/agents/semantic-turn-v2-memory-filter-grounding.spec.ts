/**
 * tuning-3 eval (real-model evidence, `TOOL_INPUT_NOT_AUTHORIZED` with zero tool calls): six
 * follow-ups where `conversationContext.recentReads` already carried the period/filter the router
 * correctly copied into `requestedFilters` and the control round correctly echoed into its tool
 * `input` — but `bindRequestedReadFilters`/`validInput` rejected the whole call anyway, because
 * their ONLY period-grounding source was `conversationReadCandidates`, which RE-EXTRACTS a
 * date/period phrase from recent raw USER TEXT. That re-extraction has nothing to find when the
 * prior turn's own wording had a typo ("เดือนนิ") or named no date at all ("มีร่างค้างอยู่ไหมคะ") —
 * even though `recentReads[].period` (the API's own record of what a prior tool call actually
 * applied, spec R-M5) already proves the exact same range. Reproduces, from the captured evidence:
 * T-009-a-owner-typo-slang-chain#1 ("เอาแต่ที่จ่ายแล้วอ่ะ"), T-012-b-owner-drafts-explain-ordinal#2/#3
 * ("อันแรกที่รอตรวจคือรายการไหนคะ" / "ทำไมรอตรวจเยอะจังคะ"), T-015-a-staff-draft-explain-howto-return#3
 * ("งั้นกลับไปที่ร่างค้างอ่ะค่ะ มีกี่รายการนะ"), and T-019-a-owner-lastmonth-compare#1
 * ("แล้วเทียบกับกันยายนเป็นไงบ้างคะ", where only the August leg was ungrounded — September named
 * itself in this turn's own text). Fixed by also trusting `req.conversationContext.recentReads` in
 * both grounding checks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LineAiConversationContext, LineAiTurnRequest, ToolResult } from '@watchdog-bms/contracts';
import type { IModelProvider, ProviderInput, ProviderOutput } from '../infrastructure/provider/provider.port';
import { runSemanticTurnV2 } from './semantic-turn-v2';

const EMPTY_CANDIDATES: LineAiTurnRequest['valueCandidates'] = {
  version: 2, inputDigest: 'a'.repeat(64), extractorVersion: 'value-v2', todayIso: '2026-09-28',
  completeness: 'complete', counts: { amounts: 0, dates: 0, periods: 0 }, amounts: [], dates: [], periods: [],
};

function baseUserContext(permissions: string[]) {
  return { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
    permissions, roles: ['owner'], branchIds: [], locationIds: [], locale: 'th-TH' } as LineAiTurnRequest['userContext'];
}

function recentTurns(...previews: string[]): LineAiConversationContext['recentTurns'] {
  return previews.map((userMessagePreview, index) => ({ at: `2026-09-27T23:0${index}:00.000Z`,
    userMessagePreview, userMessagePreviewComplete: true, intent: 'UNKNOWN', agent: 'general', refused: false }));
}

async function run(input: { request: LineAiTurnRequest; controlCall: Record<string, unknown>; invokeResult: ToolResult }) {
  const queue = [JSON.stringify(input.controlCall),
    JSON.stringify({ answers: input.request.semanticSubrequests!.map(item => ({ index: item.index, status: 'handled',
      text: 'เรียบร้อยค่ะ', sourceRefIds: input.invokeResult.sourceRefs.map(ref => ref.id) })) })];
  const invokedInputs: Array<{ tool: string; input: Record<string, unknown> }> = [];
  const provider: IModelProvider = { async generateText(_i: ProviderInput): Promise<ProviderOutput> {
    return { ok: true, text: queue.shift() ?? '{}' };
  } };
  const result = await runSemanticTurnV2({
    req: input.request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
    publicLookupEnabled: false, approvedKnowledgeEnabled: false,
    async invoke(meta, _ctx, args): Promise<ToolResult> { invokedInputs.push({ tool: meta.name, input: args }); return input.invokeResult; },
  });
  return { result, invokedInputs };
}

const OK_RESULT = (toolName: string, data: Record<string, unknown>): ToolResult => ({ toolName, status: 'ok', asOf: '2026-09-28T01:00:00.000Z',
  sourceRefs: [{ id: 'expenses:expense_summary:summary', label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary', permissionChecked: true, asOf: '2026-09-28T01:00:00.000Z' }],
  facts: [], data });

describe('tuning-3 item 1: recentReads grounds a follow-up its own text never restates', () => {
  it('T-009#1: "เอาแต่ที่จ่ายแล้วอ่ะ" inherits the prior breakdown\'s period from recentReads, not from the typo\'d prior turn text', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-1', webhookEventId: 'event-1', messageText: 'เอาแต่ที่จ่ายแล้วอ่ะ',
      messagePreviewHash: 'a'.repeat(16), valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ยอดจ่ายแล้วเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-30', paymentStatus: 'PAID', groupBy: 'category' } }],
      userContext: baseUserContext(['expense.read']),
      conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: recentTurns('เดือนนิจ่ายไปเทาไหร่แล้วค้า'),
        recentReads: [{ tool: 'expense.get_breakdown', period: { fromDate: '2026-09-01', toDate: '2026-09-30' }, groupBy: 'category',
          answerShape: 'list', asOf: '2026-09-27T23:00:00.000Z' }] },
    };
    const { result, invokedInputs } = await run({
      request, invokeResult: OK_RESULT('expense.get_breakdown', { totalAmount: '3367.00', totalCount: 3 }),
      controlCall: { calls: [{ index: 0, toolName: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-30', paymentStatus: 'PAID', groupBy: 'category' } }] },
    });
    assert.deepEqual(invokedInputs, [{ tool: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-30', paymentStatus: 'PAID', groupBy: 'category' } }]);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
  });

  it('T-012#2/#3: "อันแรกที่รอตรวจคือรายการไหนคะ" inherits the NEEDS_REVIEW period from recentReads across two prior turns naming no date', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-2', webhookEventId: 'event-2', messageText: 'อันแรกที่รอตรวจคือรายการไหนคะ',
      messagePreviewHash: 'b'.repeat(16), valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'รายการแรกที่รอตรวจ', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28', documentStatus: 'NEEDS_REVIEW', limit: 1 } }],
      userContext: baseUserContext(['expense.read']),
      conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: recentTurns('มีร่างค้างอยู่ไหมคะ', 'แล้วที่รอตรวจอยู่มีกี่รายการคะ'),
        recentReads: [{ tool: 'expense.list_recent', period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, documentStatus: 'NEEDS_REVIEW',
          answerShape: 'list', asOf: '2026-09-27T23:00:00.000Z',
          shownItems: [{ ordinal: 1, id: 'expense-company-b-15', label: 'ร้านสมใจการค้า', date: '2026-09-16' }] }] },
    };
    const { result, invokedInputs } = await run({
      request, invokeResult: OK_RESULT('expense.list_recent', { total: 1, items: [] }),
      controlCall: { calls: [{ index: 0, toolName: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-28', documentStatus: 'NEEDS_REVIEW', limit: 1 } }] },
    });
    assert.deepEqual(invokedInputs, [{ tool: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-28', documentStatus: 'NEEDS_REVIEW', limit: 1 } }]);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
  });

  it('T-015#3: "งั้นกลับไปที่ร่างค้างอ่ะค่ะ มีกี่รายการนะ" inherits the DRAFT period from recentReads', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-3', webhookEventId: 'event-3', messageText: 'งั้นกลับไปที่ร่างค้างอ่ะค่ะ มีกี่รายการนะ',
      messagePreviewHash: 'c'.repeat(16), valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'นับร่างค้าง', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { documentStatus: 'DRAFT', fromDate: '2026-09-01', toDate: '2026-09-28' } }],
      userContext: baseUserContext(['expense.read_own']),
      conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: recentTurns('มีร่างของฉันค้างอยู่ไหมคะ', 'ทำไมมีร่างค้างเยอะจังคะ'),
        recentReads: [{ tool: 'expense.list_recent', period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, documentStatus: 'DRAFT',
          answerShape: 'list', asOf: '2026-09-27T23:00:00.000Z' }] },
    };
    const { result, invokedInputs } = await run({
      request, invokeResult: OK_RESULT('expense.list_recent', { total: 1, items: [] }),
      controlCall: { calls: [{ index: 0, toolName: 'expense.list_recent', input: { documentStatus: 'DRAFT', fromDate: '2026-09-01', toDate: '2026-09-28' } }] },
    });
    assert.deepEqual(invokedInputs, [{ tool: 'expense.list_recent', input: { documentStatus: 'DRAFT', fromDate: '2026-09-01', toDate: '2026-09-28' } }]);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
  });

  it('T-019#1: "แล้วเทียบกับกันยายนเป็นไงบ้างคะ" grounds the August leg from recentReads while September grounds from this turn\'s own text', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-4', webhookEventId: 'event-4', messageText: 'แล้วเทียบกับกันยายนเป็นไงบ้างคะ',
      messagePreviewHash: 'd'.repeat(16),
      valueCandidates: { ...EMPTY_CANDIDATES, counts: { amounts: 0, dates: 0, periods: 1 },
        periods: [{ span: 'กันยายน', kind: 'month', fromDate: '2026-09-01', toDate: '2026-09-28', monthKey: '2026-09',
          source: { partId: 'part-0', startUtf16: 12, endUtf16: 19, rawSha256: 'b'.repeat(64) }, label: '1–28 ก.ย. 2569',
          assumptions: ['year_assumed_latest_past', 'period_clamped_to_today'], periodSource: 'named_month', candidateId: 'c'.repeat(64) }] },
      semanticSubrequests: [
        { index: 0, kind: 'read', goal: 'ยอดรวมเดือนสิงหาคมเพื่อเทียบ', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
          requestedFilters: { fromDate: '2026-08-01', toDate: '2026-08-31', groupBy: 'category' } },
        { index: 1, kind: 'read', goal: 'ยอดรวมเดือนกันยายนเพื่อเทียบ', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
          requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'category' } },
      ],
      userContext: baseUserContext(['expense.read']),
      conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: recentTurns('เดือนสิงหาคมที่ผ่านมาใช้จ่ายไปเท่าไหร่คะ'),
        recentReads: [{ tool: 'expense.get_breakdown', period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, groupBy: 'category',
          answerShape: 'list', asOf: '2026-09-27T23:18:28.307Z' }] },
    };
    const { result, invokedInputs } = await run({
      request, invokeResult: OK_RESULT('expense.get_breakdown', { totalAmount: '40453.00', totalCount: 14, period: { fromDate: '2026-08-01', toDate: '2026-08-31' } }),
      controlCall: { calls: [
        { index: 0, toolName: 'expense.get_breakdown', input: { fromDate: '2026-08-01', toDate: '2026-08-31', groupBy: 'category' } },
        { index: 1, toolName: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'category' } },
      ] },
    });
    assert.equal(invokedInputs.length, 2, `both periods should be invoked, got ${JSON.stringify(invokedInputs)}`);
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
    assert.notEqual(result.semanticCoverage?.[1]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
  });
});
