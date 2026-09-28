/**
 * tuning-3 item 4 (T-016 "เดือนนี้กับเดือนที่แล้ว แยกตามหมวดต่างกันยังไงบ้างคะ" hit the 30s turn
 * deadline; T-082 "จ่ายร้านไหนเยอะสุดเดือนนี้ กับเดือนที่แล้ว..." gave totals only): a two-period
 * comparison already has a full, exact deterministic answer (comparisonByIndex) before compose ever
 * runs, so `needsComposition` must skip the (slow, and here unnecessary) `line.compose` call
 * entirely — see `expensePeriodComparisonReplyText` in business-read-result-semantics.ts for the
 * ranked group lines the deterministic answer now carries.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LineAiTurnRequest, ToolResult } from '@watchdog-bms/contracts';
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

const SOURCE_REF = { id: 'expenses:expense_summary:summary', label: 'รายการค่าใช้จ่าย', module: 'expenses',
  entityType: 'expense_summary', permissionChecked: true as const, asOf: '2026-09-28T01:00:00.000Z' };

/** Records every `generateText` call (by usageTag) and answers from a queue, one JSON string per call. */
function recordingProvider(responses: string[]) {
  const queue = [...responses];
  const calls: Array<{ usageTag: string; systemPrompt: string }> = [];
  const provider: IModelProvider = {
    async generateText(input: ProviderInput): Promise<ProviderOutput> {
      calls.push({ usageTag: input.usageTag ?? '', systemPrompt: input.systemPrompt ?? '' });
      return { ok: true, text: queue.shift() ?? '{}' };
    },
  };
  return { provider, calls };
}

describe('tuning-3 item 4: a two-period comparison skips the compose call entirely', () => {
  const AUGUST = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, totalAmount: '40453.00', totalCount: 14,
    byCategory: [{ category: 'ค่าใช้จ่ายอื่นๆ', totalAmount: '7175.50' }, { category: 'ค่าบริการ', totalAmount: '10764.50' }] };
  const SEPTEMBER = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, totalAmount: '17765.00', totalCount: 14,
    byCategory: [{ category: 'ค่าใช้จ่ายอื่นๆ', totalAmount: '4599.50' }, { category: 'ค่าบริการ', totalAmount: '4188.50' }] };

  it('T-016-style grouped compare: never calls line.compose, and the reply carries the ranked category lines', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-2', webhookEventId: 'event-2', messageText: 'เดือนนี้กับเดือนที่แล้ว แยกตามหมวดต่างกันยังไงบ้างคะ',
      messagePreviewHash: 'b'.repeat(16),
      semanticSubrequests: [
        { index: 0, kind: 'read', goal: 'แยกตามหมวดเดือนสิงหาคม', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
          requestedFilters: { fromDate: '2026-08-01', toDate: '2026-08-31', groupBy: 'category' } },
        { index: 1, kind: 'read', goal: 'แยกตามหมวดเดือนกันยายน', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
          requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'category' } },
      ],
      userContext: baseUserContext(['expense.read']),
      valueCandidates: { ...EMPTY_CANDIDATES, counts: { amounts: 0, dates: 0, periods: 2 }, periods: [
        { span: 'เดือนที่แล้ว', kind: 'month', fromDate: '2026-08-01', toDate: '2026-08-31', monthKey: '2026-08',
          source: { partId: 'part-0', startUtf16: 0, endUtf16: 5, rawSha256: 'b'.repeat(64) }, label: '1-31 ส.ค. 2569', assumptions: [], periodSource: 'named_month', candidateId: 'c'.repeat(64) },
        { span: 'เดือนนี้', kind: 'month', fromDate: '2026-09-01', toDate: '2026-09-28', monthKey: '2026-09',
          source: { partId: 'part-0', startUtf16: 6, endUtf16: 10, rawSha256: 'b'.repeat(64) }, label: '1-28 ก.ย. 2569', assumptions: [], periodSource: 'named_month', candidateId: 'd'.repeat(64) },
      ] },
    };
    const results = new Map<string, ToolResult>([
      ['2026-08-01', { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-28T01:00:00.000Z', sourceRefs: [SOURCE_REF], facts: [], data: AUGUST }],
      ['2026-09-01', { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-28T01:00:00.000Z', sourceRefs: [SOURCE_REF], facts: [], data: SEPTEMBER }],
    ]);
    const { provider, calls } = recordingProvider([
      JSON.stringify({ calls: [
        { index: 0, toolName: 'expense.get_breakdown', input: { fromDate: '2026-08-01', toDate: '2026-08-31', groupBy: 'category' } },
        { index: 1, toolName: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'category' } },
      ], questions: [] }),
      // If compose ran anyway, it would be consumed here — asserted below that it never is.
      JSON.stringify({ answers: [] }),
    ]);
    const result = await runSemanticTurnV2({
      req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(_meta, _ctx, args): Promise<ToolResult> { return results.get(String((args as Record<string, unknown>)['fromDate']))!; },
    });
    assert.deepEqual(calls.map((call) => call.usageTag), ['line.loop'], 'line.compose must never be called for a fully-covered comparison');
    assert.ok(result.replyText.includes('ค่าบริการ'), result.replyText);
    assert.ok(result.replyText.includes('ต่างกัน'), result.replyText);
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'DETERMINISTIC_FALLBACK_RENDERED');
    assert.equal(result.semanticCoverage?.[1]?.reasonCode, 'DETERMINISTIC_FALLBACK_RENDERED');
  });
});
