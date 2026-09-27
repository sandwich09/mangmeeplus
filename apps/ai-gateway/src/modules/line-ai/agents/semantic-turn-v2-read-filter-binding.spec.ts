/**
 * Item 3 (223-turn eval, `TOOL_INPUT_NOT_AUTHORIZED` on ordinary questions): specs reproducing the
 * exact real-model failures from the eval evidence.
 *
 * - T-009-a-owner-typo-slang-chain#0 ("เดือนนิจ่ายไปเทาไหร่แล้วค้า") and T-052-a-owner-breakdown-plain#0
 *   ("แยกตามหมวดของเดือนนิให้หน่อยครับ"): the router sent `requestedFilters: {"periodKey":"this_month"}`
 *   (confirmed from the raw `requestLineIntakeRoute` response in the eval evidence), which never
 *   matched any extracted candidate — least of all here, since the "เดือนนิ" typo means the deterministic
 *   extractor found no period candidate at all. `bindRequestedReadFilters` dead-ended the whole call as
 *   `TOOL_INPUT_NOT_AUTHORIZED` even though "this_month" names an exact, computable calendar month.
 * - T-089-a-manager-pending-thismonth#0 ("ใบเบิกรออนุมัติเดือนนี้มีกี่รายการครับ"): the router sent a
 *   grounded `{"fromDate":"2026-09-01","toDate":"2026-09-28"}`, but the correct tool for "ใบเบิกรออนุมัติ"
 *   (`reimbursement.list_pending_approvals`) takes no input fields at all — a business-level period
 *   hint decided before any tool is chosen can simply be a window a tool never had. The same shape hit
 *   T-026-b-staff-today-then-needsreview#0 ("วันนี้จ่ายไปเท่าไหร่แล้วคะ") against
 *   `expense.get_daily_closing`, which takes only a single `date`, never fromDate/toDate.
 *
 * All three used to answer "ต้องตรวจข้อมูลหรือสิทธิ์ของส่วนนี้ก่อน..." — a permission-flavored dead end for
 * something that was never a permission problem. Whatever still cannot be bound must stay honest and
 * terminal (never `needs_user`, never permission wording) — the last describe block below.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLineAiInputEvidence, extractValueCandidatesV2, type LineAiTurnRequest, type ToolResult } from '@watchdog-bms/contracts';
import type { IModelProvider, ProviderInput, ProviderOutput } from '../infrastructure/provider/provider.port';
import { runSemanticTurnV2 } from './semantic-turn-v2';

const TODAY = '2026-09-28';

/** The real request shape for this code path: `semanticV2`'s router always hands `runSemanticTurnV2`
 *  V2 candidates (with `todayIso`), never the legacy V1 shape — the alias fix below depends on it. */
async function candidatesV2(messageText: string, turnKey: string) {
  const built = await createLineAiInputEvidence({ turnKey,
    parts: [{ partId: 'part-0', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.parse(`${TODAY}T02:00:00.000Z`), rawText: messageText }] });
  assert.ok(built);
  const candidates = await extractValueCandidatesV2(built.inputEvidence, TODAY);
  assert.ok(candidates);
  return candidates;
}

function baseUserContext(permissions: string[]) {
  return { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
    permissions, roles: ['owner'], branchIds: [], locationIds: [], locale: 'th-TH' } as LineAiTurnRequest['userContext'];
}

async function run(input: {
  request: LineAiTurnRequest;
  controlCall: Record<string, unknown>;
  answerText?: string;
  invokeResult: ToolResult;
}) {
  const queue = [JSON.stringify(input.controlCall),
    ...(input.answerText !== undefined ? [JSON.stringify({ answers: [{ index: 0, status: 'handled', text: input.answerText,
      sourceRefIds: input.invokeResult.sourceRefs.map(ref => ref.id) }] })] : [])];
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

describe('item 3: a model-invented periodKey alias is resolved, not rejected', () => {
  it('grounds "this_month" to the real calendar month even when the typo left zero extracted candidates', async () => {
    const MESSAGE_TEXT = 'เดือนนิจ่ายไปเทาไหร่แล้วค้า';
    const valueCandidates = await candidatesV2(MESSAGE_TEXT, 'turn-1');
    assert.deepEqual(valueCandidates.periods, [], 'sanity: the typo must leave no period candidate');
    const request: LineAiTurnRequest = {
      requestId: 'req-1', webhookEventId: 'event-1', messageText: MESSAGE_TEXT,
      messagePreviewHash: 'a'.repeat(16), valueCandidates,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ยอดค่าใช้จ่ายเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { periodKey: 'this_month' } }],
      userContext: baseUserContext(['expense.read']),
    };
    const toolResult: ToolResult = { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-28T01:42:00.000Z',
      sourceRefs: [{ id: 'expenses:expense_summary:summary', label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary', permissionChecked: true, asOf: '2026-09-28T01:42:00.000Z' }],
      facts: [], data: { total: 14 } };
    const { result, invokedInputs } = await run({
      request, invokeResult: toolResult, answerText: 'เดือนนี้จ่ายไปแล้วค่ะ',
      controlCall: { calls: [{ index: 0, toolName: 'expense.list_recent', input: { periodKey: 'this_month' } }] },
    });
    assert.deepEqual(invokedInputs, [{ tool: 'expense.list_recent', input: { periodKey: '2026-09' } }]);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
  });
});

describe('item 3: a chosen tool that cannot express the requested window keeps its own honest scope', () => {
  it('drops fromDate/toDate for a tool with no input fields at all (T-089 reimbursement.list_pending_approvals)', async () => {
    const MESSAGE_TEXT = 'ใบเบิกรออนุมัติเดือนนี้มีกี่รายการครับ';
    const valueCandidates = await candidatesV2(MESSAGE_TEXT, 'turn-2');
    assert.ok(valueCandidates.periods.some(p => p.fromDate === '2026-09-01' && p.toDate === '2026-09-28'), 'sanity: this-month is grounded');
    const request: LineAiTurnRequest = {
      requestId: 'req-2', webhookEventId: 'event-2', messageText: MESSAGE_TEXT,
      messagePreviewHash: 'b'.repeat(16), valueCandidates,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'นับใบเบิกรออนุมัติเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28' } }],
      userContext: baseUserContext(['reimbursement.approve']),
    };
    const toolResult: ToolResult = { toolName: 'reimbursement.list_pending_approvals', status: 'ok', asOf: '2026-09-28T01:59:00.000Z',
      sourceRefs: [{ id: 'reimbursements:pending:summary', label: 'รายการเบิกจ่ายรออนุมัติ', module: 'reimbursements', entityType: 'pending', permissionChecked: true, asOf: '2026-09-28T01:59:00.000Z' }],
      facts: [], data: { total: 2 } };
    const { result, invokedInputs } = await run({
      request, invokeResult: toolResult, answerText: 'มีใบเบิกรออนุมัติอยู่ค่ะ',
      controlCall: { calls: [{ index: 0, toolName: 'reimbursement.list_pending_approvals', input: {} }] },
    });
    assert.deepEqual(invokedInputs, [{ tool: 'reimbursement.list_pending_approvals', input: {} }]);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
  });

  it('drops fromDate/toDate for a tool that only takes a single `date` (T-026 expense.get_daily_closing)', async () => {
    const MESSAGE_TEXT = 'วันนี้จ่ายไปเท่าไหร่แล้วคะ';
    const valueCandidates = await candidatesV2(MESSAGE_TEXT, 'turn-3');
    const request: LineAiTurnRequest = {
      requestId: 'req-3', webhookEventId: 'event-3', messageText: MESSAGE_TEXT,
      messagePreviewHash: 'c'.repeat(16), valueCandidates,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ยอดจ่ายวันนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { fromDate: '2026-09-28', toDate: '2026-09-28' } }],
      userContext: baseUserContext(['expense.read_own']),
    };
    const toolResult: ToolResult = { toolName: 'expense.get_daily_closing', status: 'ok', asOf: '2026-09-28T01:48:00.000Z',
      sourceRefs: [{ id: 'expenses:daily_closing:summary', label: 'สรุปรายวัน', module: 'expenses', entityType: 'daily_closing', permissionChecked: true, asOf: '2026-09-28T01:48:00.000Z' }],
      facts: [], data: { paidTotal: '0' } };
    const { result, invokedInputs } = await run({
      request, invokeResult: toolResult, answerText: 'วันนี้ยังไม่มีรายการจ่ายค่ะ',
      controlCall: { calls: [{ index: 0, toolName: 'expense.get_daily_closing', input: { date: '2026-09-28' } }] },
    });
    assert.deepEqual(invokedInputs, [{ tool: 'expense.get_daily_closing', input: { date: '2026-09-28' } }]);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
  });
});

describe('item 3: whatever still cannot be bound stays honest, never a permission dead end', () => {
  it('reports an unresolvable filter mismatch as terminal `unsupported`, not `needs_user`, and never mentions permission', async () => {
    const MESSAGE_TEXT = 'วันนี้เฉพาะที่ยืนยันแล้วจ่ายไปเท่าไหร่คะ';
    const valueCandidates = await candidatesV2(MESSAGE_TEXT, 'turn-4');
    const request: LineAiTurnRequest = {
      requestId: 'req-4', webhookEventId: 'event-4', messageText: MESSAGE_TEXT,
      messagePreviewHash: 'd'.repeat(16), valueCandidates,
      // documentStatus is a real business filter, not a period window — expense.get_daily_closing
      // cannot express it, and dropping it would silently show ALL statuses, so this must still fail.
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ยอดยืนยันแล้ววันนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { documentStatus: 'CONFIRMED' } }],
      userContext: baseUserContext(['expense.read_own']),
    };
    const toolResult: ToolResult = { toolName: 'expense.get_daily_closing', status: 'ok', asOf: '2026-09-28T01:48:00.000Z', sourceRefs: [], facts: [], data: {} };
    const { result, invokedInputs } = await run({
      request, invokeResult: toolResult,
      controlCall: { calls: [{ index: 0, toolName: 'expense.get_daily_closing', input: { date: '2026-09-28' } }] },
    });
    assert.deepEqual(invokedInputs, []);
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'unsupported');
    assert.notEqual(coverage?.status, 'needs_user');
    assert.equal(coverage?.reasonCode, 'TOOL_INPUT_NOT_AUTHORIZED');
    assert.ok(!result.replyText.includes('สิทธิ์'), result.replyText);
    assert.ok(result.replyText.includes('ดึงข้อมูลส่วนนี้ไม่ได้'), result.replyText);
  });
});
