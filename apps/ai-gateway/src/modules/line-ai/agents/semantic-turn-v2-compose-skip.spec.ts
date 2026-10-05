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
import { extractValueCandidates, type LineAiSemanticSubrequestV2, type LineAiTurnRequest, type ToolResult } from '@watchdog-bms/contracts';
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
  const calls: Array<{ usageTag: string; systemPrompt: string; messages: ProviderInput['messages'] }> = [];
  const provider: IModelProvider = {
    async generateText(input: ProviderInput): Promise<ProviderOutput> {
      calls.push({ usageTag: input.usageTag ?? '', systemPrompt: input.systemPrompt ?? '', messages: input.messages });
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

describe('cards-cmp: one deterministic answer for every comparable period', () => {
  const names = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน'];
  const row = (month: number, amount: string, count: number, toolName = 'expense.list_recent'): ToolResult => {
    const key = `2026-${String(month).padStart(2, '0')}`;
    return { toolName, status: 'ok', asOf: SOURCE_REF.asOf, sourceRefs: [{ ...SOURCE_REF, id: `expenses:month:${month}` }],
      data: { period: { fromDate: `${key}-01`, toDate: `${key}-${new Date(Date.UTC(2026, month, 0)).getUTCDate()}` },
        total: count, summary: { totalAmount: amount }, totalAmount: amount, totalCount: count,
        ...(toolName === 'expense.get_breakdown' ? { byCategory: [{ category: 'ค่าบริการ', totalAmount: amount }] } : {}) } };
  };
  async function runSeries(rows: ToolResult[], filters: Record<string, string>[] = [], options: { keyed?: boolean; extra?: boolean } = {}) {
    const periods = rows.map(result => (result.data as { period: { fromDate: string; toDate: string } }).period);
    const messageText = `เปรียบเทียบค่าใช้จ่าย ${periods.map(period => `${names[Number(period.fromDate.slice(5, 7)) - 1]} 2569`).join(' และ ')}`;
    const inputs = periods.map((period, index) => ({ ...(options.keyed ? { periodKey: period.fromDate.slice(0, 7) } : period), ...filters[index] }));
    const request: LineAiTurnRequest = { requestId: 'req-series', webhookEventId: 'event-series', messageText,
      messagePreviewHash: 'c'.repeat(16), valueCandidates: extractValueCandidates(messageText, '2026-10-05'),
      semanticSubrequests: periods.map((period, index) => ({ index, kind: 'read', goal: messageText,
        requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: inputs[index]! })),
      userContext: baseUserContext(['expense.read']) };
    if (options.extra) request.semanticSubrequests!.push({ index: rows.length, kind: 'general', goal: 'กำไรคืออะไร', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} });
    const { provider, calls } = recordingProvider([
      JSON.stringify({ calls: rows.map((result, index) => ({ index, toolName: result.toolName, input: inputs[index] })) }),
      JSON.stringify({ answers: [...rows.map((result, index) => ({ index, status: 'handled',
        text: result.status === 'ok' ? `ค่าใช้จ่าย ${periods[index]!.fromDate} ${(result.data as { totalAmount: string }).totalAmount} บาท`
          : 'ข้อมูลเดือนนี้อยู่ในสรุปด้านบนแล้วค่ะ', sourceRefIds: result.sourceRefs.map(ref => ref.id) })),
        ...(options.extra ? [{ index: rows.length, status: 'handled', topic: 'business', text: 'กำไรคือรายได้ที่เหลือหลังหักค่าใช้จ่ายค่ะ' }] : [])] }),
    ]);
    const result = await runSemanticTurnV2({ req: request, provider, draftEditEnabled: false,
      reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(_meta, _ctx, args) { const input = args as Record<string, unknown>;
        return rows[periods.findIndex(period => period.fromDate === input.fromDate || period.fromDate.slice(0, 7) === input.periodKey)]!; },
    });
    return { result, calls };
  }
  for (const count of [2, 3, 4, 8]) it(`${count} months, including the eight-call bound: one block, all figures, no compose`, async () => {
    // n*1000 -> (n+1)*1000: difference=1000, percentage=100/n%, multiple=2.0 only for the first change.
    const rows = Array.from({ length: count }, (_, i) => row(i + 1, String((i + 1) * 1000), i + 1)).reverse();
    const { result, calls } = await runSeries(rows);
    assert.deepEqual(calls.map(call => call.usageTag), ['line.loop']);
    assert.equal(result.replyText.match(/^เปรียบเทียบค่าใช้จ่าย/gmu)?.length, 1);
    assert.equal(result.replyText.match(/^• /gmu)?.length, count);
    assert.equal(result.replyText.match(/^  มากกว่า /gmu)?.length, count - 1);
    assert.doesNotMatch(result.replyText, /อยู่ในสรุปด้านบน|^\d+\. /mu);
    rows.forEach((resultRow, i) => {
      const data = resultRow.data as { totalAmount: string; total: number };
      assert.ok(result.replyText.includes(`${Number(data.totalAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })} บาท (${data.total} รายการ)`));
      assert.equal(result.semanticCoverage?.[i]?.status, 'handled');
      assert.ok(result.semanticCoverage?.[i]?.sourceRefIds?.includes(resultRow.sourceRefs[0]!.id!));
    });
  });
  it('owner July/August/September: the third month is read and answered, never referred to an absent summary', async () => {
    // +189751.77 /25147.80 = +754.5%, ratio 8.5; -116899.57 /214899.57 = -54.4%.
    const { result, calls } = await runSeries([row(7, '25147.80', 7), row(8, '214899.57', 25), row(9, '98000', 12)]);
    assert.deepEqual(calls.map(call => call.usageTag), ['line.loop']);
    assert.ok(result.replyText.includes('• ก.ย. 2569: 98,000.00 บาท (12 รายการ)'));
    assert.match(result.replyText, /754\.5% หรือราว 8\.5 เท่าของ ก\.ค\./u);
    assert.match(result.replyText, /116,899\.57 บาท \(ลดลง 54\.4%\)/u);
    assert.equal(result.replyText.match(/^• /gmu)?.length, 3);
    assert.doesNotMatch(result.replyText, /อยู่ในสรุปด้านบน|^\d+\. /mu);
  });
  it('a repeated period shares the comparison without a duplicate line or model answer', async () => {
    // August 200 - July 100=100; growth=100%, ratio=2.0. July was requested twice.
    const { result, calls } = await runSeries([row(7, '100', 1), row(8, '200', 2), row(7, '100', 1)]);
    assert.deepEqual(calls.map(call => call.usageTag), ['line.loop']);
    assert.equal(result.replyText.match(/^• /gmu)?.length, 2);
    assert.equal(result.semanticCoverage?.length, 3);
    assert.ok(result.semanticCoverage?.every(item => item.status === 'handled'));
  });
  it('three grouped reads preserve every total and both adjacent grouped changes', async () => {
    // 100 -> 200 = +100 (+100%, 2x); 200 -> 300 = +100 (+50%).
    const { result, calls } = await runSeries([row(7, '100', 1, 'expense.get_breakdown'), row(8, '200', 2, 'expense.get_breakdown'), row(9, '300', 3, 'expense.get_breakdown')]);
    assert.deepEqual(calls.map(call => call.usageTag), ['line.loop']);
    assert.equal(result.replyText.match(/^• /gmu)?.length, 3);
    assert.match(result.replyText, /ค่าบริการ\n  ก\.ค\. 2569: 100\.00 บาท\n  ส\.ค\. 2569: 200\.00 บาท\n  ต่างกัน 100\.00 บาท \(\+100\.0%\)/u);
    assert.match(result.replyText, /ค่าบริการ\n  ส\.ค\. 2569: 200\.00 บาท\n  ก\.ย\. 2569: 300\.00 บาท\n  ต่างกัน 100\.00 บาท \(\+50\.0%\)/u);
  });
  it('a compound turn keeps one comparison at its first item even when the model composes the independent answer', async () => {
    // +189751.77 /25147.80=754.5%, ratio=8.5; -116899.57 /214899.57=-54.4%.
    const { result, calls } = await runSeries([row(9, '98000', 12), row(7, '25147.80', 7), row(8, '214899.57', 25)], [], { extra: true });
    assert.equal(result.replyText.match(/เปรียบเทียบค่าใช้จ่าย/gu)?.length, 1);
    assert.match(result.replyText, /^1\. เปรียบเทียบค่าใช้จ่าย/u);
    assert.equal(result.replyText.match(/^• /gmu)?.length, 3);
    assert.match(result.replyText, /2\. กำไรคือรายได้/u);
    assert.doesNotMatch(result.replyText, /3\. |4\. |อยู่ในสรุปด้านบน/u);
    const compose = calls.find(call => call.usageTag === 'line.compose')!;
    const input = JSON.parse(compose.messages[0]!.text!) as { derivedFacts: { index: number; facts: string }[] };
    for (const index of [0, 1, 2]) assert.match(input.derivedFacts.find(fact => fact.index === index)!.facts, /754\.5% หรือราว 8\.5 เท่าของ ก\.ค\./u);
    assert.deepEqual(result.semanticCoverage?.[0]?.sourceRefIds?.sort(), ['expenses:month:7', 'expenses:month:8', 'expenses:month:9']);
  });
  it('a failed month-key read among three is named from the bound request, not the failed payload', async () => {
    const failed = { ...row(8, '999999', 99), status: 'error' as const, sourceRefs: [] };
    const { result } = await runSeries([row(7, '100', 1), failed, row(9, '300', 3)], [], { keyed: true });
    assert.doesNotMatch(result.replyText, /เปรียบเทียบค่าใช้จ่าย|999,?999|อยู่ในสรุปด้านบน/u);
    assert.match(result.replyText, /ข้อมูลค่าใช้จ่าย ส\.ค\. 2569 ยังไม่พร้อม/u);
  });
  for (const status of ['error', 'forbidden'] as const) it(`one ${status} read among three: no series, names the unavailable month, no invented figures`, async () => {
    const failed = { ...row(8, '999999', 99), status, sourceRefs: [] };
    const { result } = await runSeries([row(7, '100', 1), failed, row(9, '300', 3)]);
    assert.doesNotMatch(result.replyText, /เปรียบเทียบค่าใช้จ่าย|อยู่ในสรุปด้านบน|999,?999/u);
    assert.match(result.replyText, status === 'forbidden' ? /ไม่มีสิทธิ์ดูค่าใช้จ่าย ส\.ค\. 2569/u : /ข้อมูลค่าใช้จ่าย ส\.ค\. 2569 ยังไม่พร้อม/u);
    assert.ok(result.replyText.includes('100 บาท'));
    assert.ok(result.replyText.includes('300 บาท'));
  });
  it('one incomplete aggregate among three: no series and no subtotal passed off as the total', async () => {
    const incomplete = row(8, '999999', 99);
    incomplete.completeness = { aggregate: 'partial', rows: { returned: 0, hasMore: false, nextCursor: null },
      groups: { returned: 0, hasMore: false, nextCursor: null }, businessRecording: 'unknown' };
    const { result } = await runSeries([row(7, '100', 1), incomplete, row(9, '300', 3)]);
    assert.doesNotMatch(result.replyText, /เปรียบเทียบค่าใช้จ่าย|999,?999/u);
    assert.match(result.replyText, /ข้อมูลค่าใช้จ่าย ส\.ค\. 2569 ยังไม่ครบ/u);
  });
  it('different tools are answered separately', async () => {
    const { result } = await runSeries([row(7, '100', 1), row(8, '200', 2, 'expense.get_breakdown')]);
    assert.doesNotMatch(result.replyText, /เปรียบเทียบค่าใช้จ่าย/u);
    assert.ok(result.replyText.includes('100 บาท'));
    assert.ok(result.replyText.includes('200 บาท'));
  });
  for (const [name, query] of [
    ['filters', { filters: { vendorName: 'ร้านตัวอย่าง' } }],
    ['grouping', { filters: { groupBy: 'vendor' } }],
    ['scope', { accessScope: 'related' }],
    ['branch', { branch: { mode: 'selected', branchId: 'branch-one' } }],
  ] as const) it(`different applied ${name}: keep independent answers and no cross-period arithmetic`, async () => {
    const rows = [row(7, '100', 1, 'expense.get_breakdown'), row(8, '200', 2, 'expense.get_breakdown')];
    (rows[1]!.data as Record<string, unknown>).queryApplied = query;
    const { result } = await runSeries(rows);
    assert.doesNotMatch(result.replyText, /เปรียบเทียบค่าใช้จ่าย|ต่างกัน|มากกว่า|น้อยกว่า/u);
    for (const amount of ['100', '200']) assert.ok(result.replyText.includes(`${amount} บาท`));
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

// H6 (tuning-7): full-path p95 is 18.3s against a 15s target. When the router has already named a
// read tool for every clause (`toolHint`), `line.loop` (the CONTROL/planning round) is redundant —
// skip it like this file's other model-round skips above, this time for the PLANNING call rather
// than compose. `toolHint` is agent 7b's parallel contract addition (packages/contracts
// LineAiSemanticSubrequestV2), not yet in this branch's type — built via a typed helper so the
// object literal's declared return type (not the surrounding request literal) grants the extra
// field, with no unsafe cast.
function hintedReadItem(index: number, goal: string, toolHint: string): LineAiSemanticSubrequestV2 & { toolHint: string } {
  return { index, kind: 'read', goal, requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {}, toolHint };
}

describe('H6: a fully router-hinted read turn skips the line.loop planning round', () => {
  it('all-hinted reads: no line.loop call, and each hinted tool executes with the input bindRequestedReadFilters produces', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-h6-a', webhookEventId: 'event-h6-a', messageText: 'เดือนนี้ค่าใช้จ่ายเท่าไหร่ และแยกตามหมวดให้ดูหน่อยค่ะ',
      messagePreviewHash: '2'.repeat(16), valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [
        hintedReadItem(0, 'ยอดเดือนนี้', 'expense.list_recent'),
        hintedReadItem(1, 'แยกตามหมวดเดือนนี้', 'expense.get_breakdown'),
      ],
      userContext: baseUserContext(['expense.read']),
    };
    const listResult: ToolResult = { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-28T01:00:00.000Z', sourceRefs: [SOURCE_REF], facts: [], data: { total: 3 } };
    const breakdownResult: ToolResult = { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-28T01:00:00.000Z', sourceRefs: [SOURCE_REF], facts: [], data: { totalAmount: '1000' } };
    const { provider, calls } = recordingProvider([
      JSON.stringify({ answers: [
        { index: 0, status: 'handled', text: 'เดือนนี้มีค่าใช้จ่าย 3 รายการค่ะ', sourceRefIds: [SOURCE_REF.id] },
        { index: 1, status: 'handled', text: 'รวมค่าใช้จ่าย 1000 บาทค่ะ', sourceRefIds: [SOURCE_REF.id] },
      ] }),
    ]);
    const invoked: Array<{ tool: string; input: Record<string, unknown> }> = [];
    const result = await runSemanticTurnV2({
      req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(meta, _ctx, args): Promise<ToolResult> {
        invoked.push({ tool: meta.name, input: args });
        return meta.name === 'expense.list_recent' ? listResult : breakdownResult;
      },
    });
    assert.deepEqual(calls.map((call) => call.usageTag), ['line.compose'], 'line.loop must never be called when every read is hinted');
    assert.deepEqual(invoked, [{ tool: 'expense.list_recent', input: {} }, { tool: 'expense.get_breakdown', input: {} }]);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.equal(result.semanticCoverage?.[1]?.status, 'handled');
  });

  it('run 7 T-009-a: a hinted read whose requested periodKey is an alias still executes once bound (no self-conflict)', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-h6-alias', webhookEventId: 'event-h6-alias', messageText: 'เดือนนิจ่ายไปเทาไหร่แล้วค้า',
      messagePreviewHash: '6'.repeat(16), valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [{ ...hintedReadItem(0, 'ยอดรวมค่าใช้จ่ายเดือนนี้', 'expense.list_recent'), requestedFilters: { periodKey: 'this_month' } }],
      userContext: baseUserContext(['expense.read']),
    };
    const listResult: ToolResult = { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-28T01:00:00.000Z', sourceRefs: [SOURCE_REF], facts: [], data: { total: 14 } };
    const { provider, calls } = recordingProvider([
      JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'เดือนนี้มีค่าใช้จ่าย 14 รายการค่ะ', sourceRefIds: [SOURCE_REF.id] }] }),
    ]);
    const invoked: Array<Record<string, unknown>> = [];
    const result = await runSemanticTurnV2({
      req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(_meta, _ctx, args): Promise<ToolResult> { invoked.push(args); return listResult; },
    });
    assert.deepEqual(calls.map((call) => call.usageTag), ['line.compose']);
    assert.deepEqual(invoked, [{ periodKey: '2026-09' }]);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
  });

  it('one unhinted read alongside a hinted one: falls back to calling the planner exactly as today', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-h6-b', webhookEventId: 'event-h6-b', messageText: 'เดือนนี้ค่าใช้จ่ายเท่าไหร่ และแยกตามหมวดให้ดูหน่อยค่ะ',
      messagePreviewHash: '3'.repeat(16), valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [
        hintedReadItem(0, 'ยอดเดือนนี้', 'expense.list_recent'),
        // No toolHint on this second item — a single unhinted read must fall the WHOLE turn back
        // to the planner, never a partial/mixed skip.
        { index: 1, kind: 'read', goal: 'แยกตามหมวดเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} },
      ],
      userContext: baseUserContext(['expense.read']),
    };
    const someResult: ToolResult = { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-28T01:00:00.000Z', sourceRefs: [SOURCE_REF], facts: [], data: { total: 3 } };
    const { provider, calls } = recordingProvider([
      JSON.stringify({ calls: [
        { index: 0, toolName: 'expense.list_recent', input: {} },
        { index: 1, toolName: 'expense.get_breakdown', input: {} },
      ], questions: [] }),
      JSON.stringify({ answers: [
        { index: 0, status: 'handled', text: 'เดือนนี้มีค่าใช้จ่าย 3 รายการค่ะ', sourceRefIds: [SOURCE_REF.id] },
        { index: 1, status: 'handled', text: 'รวมค่าใช้จ่าย 3 รายการค่ะ', sourceRefIds: [SOURCE_REF.id] },
      ] }),
    ]);
    await runSemanticTurnV2({
      req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { return someResult; },
    });
    assert.deepEqual(calls.map((call) => call.usageTag), ['line.loop', 'line.compose'], 'a missing hint must still call the planner');
  });

  it('a hint naming a tool that is not offered: falls back to calling the planner exactly as today', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-h6-c', webhookEventId: 'event-h6-c', messageText: 'เดือนนี้ค่าใช้จ่ายเท่าไหร่คะ',
      messagePreviewHash: '4'.repeat(16), valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [hintedReadItem(0, 'ยอดเดือนนี้', 'expense.does_not_exist')],
      userContext: baseUserContext(['expense.read']),
    };
    const someResult: ToolResult = { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-28T01:00:00.000Z', sourceRefs: [SOURCE_REF], facts: [], data: { total: 3 } };
    const { provider, calls } = recordingProvider([
      JSON.stringify({ calls: [{ index: 0, toolName: 'expense.list_recent', input: {} }], questions: [] }),
      JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'เดือนนี้มีค่าใช้จ่าย 3 รายการค่ะ', sourceRefIds: [SOURCE_REF.id] }] }),
    ]);
    await runSemanticTurnV2({
      req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { return someResult; },
    });
    assert.deepEqual(calls.map((call) => call.usageTag), ['line.loop', 'line.compose'], 'an unoffered hint must still call the planner');
  });
});
