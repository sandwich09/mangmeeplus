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

// E3 (tuning-6a, run 5 nonJsonCompose: 24/77 compose calls): a real model sometimes answers a
// SIMPLE (single-subrequest) turn in plain prose instead of the required JSON envelope even after a
// repair attempt. Real fixtures from run 5's nonJsonCompose evidence.
describe('E3: a non-JSON but non-empty compose response is rescued for a single subrequest, never bypassing grounding', () => {
  it('real read sample ("ไม่เอาตัวกรองแล้วครับ ดูรวมทุกสถานะเลย"): grounded prose is shown verbatim with its own sources', async () => {
    const messageText = 'ไม่เอาตัวกรองแล้วครับ ดูรวมทุกสถานะเลย';
    const request: LineAiTurnRequest = {
      requestId: 'req-e3-read', webhookEventId: 'event-e3-read', messageText, messagePreviewHash: '1'.repeat(16),
      valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ยอดรวมทุกสถานะเดือนนี้ แยกตามหมวด', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
    };
    const breakdown = {
      period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, totalAmount: '17765.00', totalCount: 14,
      byCategory: [
        { category: 'ค่าใช้จ่ายอื่นๆ', totalAmount: '4599.50' }, { category: 'ค่าบริการ', totalAmount: '4188.50' },
        { category: 'ค่าเดินทาง', totalAmount: '3777.50' }, { category: 'ค่าน้ำมัน', totalAmount: '3640.50' },
        { category: 'ค่าออฟฟิศ', totalAmount: '1559.00' },
      ],
    };
    const toolResult: ToolResult = { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-28T01:00:00.000Z', sourceRefs: [SOURCE_REF], facts: [], data: breakdown };
    // The real raw model output for this exact turn (run 5 nonJsonCompose evidence): plain LINE
    // text, not the required {"answers":[…]} JSON.
    const realProse = "ยอดรวมทุกสถานะ (ยกเว้นที่ถูกปฏิเสธและยกเลิก) เดือนกันยายน 2569 รวม 17,765 บาท จาก 14 รายการค่ะ\n\nแยกตามหมวด:\n• ค่าใช้จ่ายอื่นๆ — 4,599.50 บาท (25.9%)\n• ค่าบริการ — 4,188.50 บาท (23.6%)\n• ค่าเดินทาง — 3,777.50 บาท (21.3%)\n• ค่าน้ำมัน — 3,640.50 บาท (20.5%)\n• ค่าออฟฟิศ — 1,559.00 บาท (8.8%)";
    const { provider, calls } = recordingProvider([
      JSON.stringify({ calls: [{ index: 0, toolName: 'expense.get_breakdown', input: {} }], questions: [] }),
      realProse,
    ]);
    const result = await runSemanticTurnV2({
      req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { return toolResult; },
    });
    assert.equal(calls.filter((call) => call.usageTag === 'line.compose').length, 1, 'no repair attempt for a genuinely empty budget-less test context');
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'handled');
    assert.deepEqual(coverage?.sourceRefIds, [SOURCE_REF.id], 'a rescued READ answer carries its own good sourceRefIds');
    assert.ok(result.replyText.includes('17,765'), result.replyText);
    assert.ok(result.replyText.includes('25.9%'), result.replyText);
  });

  it('real thanks sample ("ขอบคุณค่ะ"): a GENERAL item is rescued with no sources attached', async () => {
    const messageText = 'ขอบคุณค่ะ';
    const request: LineAiTurnRequest = {
      requestId: 'req-e3-thanks', webhookEventId: 'event-e3-thanks', messageText, messagePreviewHash: '2'.repeat(16),
      valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [{ index: 0, kind: 'general', goal: 'ขอบคุณ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
    };
    // The real raw model output for this exact turn (run 5 nonJsonCompose evidence).
    const realProse = 'ยินดีเลยค่ะ 😊 มีอะไรให้ช่วยเพิ่มเติมบอกได้นะคะ';
    const { provider } = recordingProvider([realProse]);
    const result = await runSemanticTurnV2({
      req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('a GENERAL item never calls a tool'); },
    });
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'handled');
    assert.deepEqual(coverage?.sourceRefIds, [], 'a rescued GENERAL answer attaches no sources');
    assert.ok(result.replyText.includes('ยินดี'), result.replyText);
  });

  it('never rescues when the inventory has more than one subrequest — both fall to the honest terminal instead', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-e3-multi', webhookEventId: 'event-e3-multi', messageText: 'ขอบคุณค่ะ แล้วพบกันใหม่นะคะ', messagePreviewHash: '3'.repeat(16),
      valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [
        { index: 0, kind: 'general', goal: 'ขอบคุณ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} },
        { index: 1, kind: 'general', goal: 'กล่าวลา', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} },
      ],
      userContext: baseUserContext(['expense.read']),
    };
    const { provider } = recordingProvider(['ยินดีเลยค่ะ แล้วพบกันใหม่นะคะ']);
    const result = await runSemanticTurnV2({
      req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('a GENERAL item never calls a tool'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'SEMANTIC_ANSWER_UNAVAILABLE');
    assert.equal(result.semanticCoverage?.[1]?.reasonCode, 'SEMANTIC_ANSWER_UNAVAILABLE');
    assert.ok(!result.replyText.includes('ยินดีเลยค่ะ แล้วพบกันใหม่นะคะ'), result.replyText);
  });

  it('never rescues a truncated JSON envelope as prose — raw JSON must not reach the customer', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-e3-truncated', webhookEventId: 'event-e3-truncated', messageText: 'ขอบคุณค่ะ', messagePreviewHash: '5'.repeat(16),
      valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [{ index: 0, kind: 'general', goal: 'ขอบคุณ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
    };
    // A compose response cut off mid-envelope (e.g. at maxTokens): unparseable, but not prose.
    const { provider } = recordingProvider(['{"answers":[{"index":0,"status":"handled","text":"ยินดีเลยค่ะ มีอะไร']);
    const result = await runSemanticTurnV2({
      req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('a GENERAL item never calls a tool'); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'SEMANTIC_ANSWER_UNAVAILABLE');
    assert.ok(!result.replyText.includes('"answers"'), result.replyText);
    assert.ok(!result.replyText.includes('{'), result.replyText);
  });

  it('still rejects a rescued READ answer whose numbers do not match the actual tool result (grounding is never bypassed)', async () => {
    const messageText = 'ไม่เอาตัวกรองแล้วครับ ดูรวมทุกสถานะเลย';
    const request: LineAiTurnRequest = {
      requestId: 'req-e3-ungrounded', webhookEventId: 'event-e3-ungrounded', messageText, messagePreviewHash: '4'.repeat(16),
      valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ยอดรวมทุกสถานะเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read']),
    };
    // A real, but UNRELATED, tool result — nothing in it grounds the rescued prose's 17,765/14 figures.
    const toolResult: ToolResult = { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-28T01:00:00.000Z', sourceRefs: [SOURCE_REF], facts: [],
      data: { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, totalAmount: '500.00', totalCount: 2, byCategory: [{ category: 'ทดสอบ', totalAmount: '500.00' }] } };
    const realProse = 'ยอดรวมทุกสถานะเดือนนี้ 17,765 บาท จาก 14 รายการค่ะ';
    const { provider } = recordingProvider([
      JSON.stringify({ calls: [{ index: 0, toolName: 'expense.get_breakdown', input: {} }], questions: [] }),
      realProse,
    ]);
    const result = await runSemanticTurnV2({
      req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { return toolResult; },
    });
    assert.ok(!result.replyText.includes('17,765'), result.replyText);
    assert.ok(!result.replyText.includes('จาก 14 รายการ'), result.replyText);
  });
});
