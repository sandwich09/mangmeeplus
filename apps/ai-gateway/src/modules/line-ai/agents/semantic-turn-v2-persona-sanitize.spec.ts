/**
 * tuning-3 item 3 (spec R-A5; eval T-007 "ขอโทษครับ ผม...", T-052 "...มีดังนี้ครับ"): a real model
 * still mirrors the customer's own "ครับ"/"ผม" into its OWN composed answer even with
 * MANGMEE_PERSONA_PROMPT now included in ANSWER_PROMPT — `sanitizeMangmeePersonaText` is the
 * deterministic backstop, wired into `runSemanticTurnV2`'s compose step.
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

describe('tuning-3 item 3: compose output is persona-sanitized end to end', () => {
  it('T-007-style: rewrites a compose answer\'s ครับ/ผม before it reaches semanticCoverage/replyText', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-1', webhookEventId: 'event-1', messageText: 'แล้วใบเบิกของผมเองถึงไหนแล้วครับ',
      messagePreviewHash: 'a'.repeat(16), valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'สถานะใบเบิกของผู้ใช้', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['reimbursement.read_own']),
    };
    const toolResult: ToolResult = { toolName: 'reimbursement.get_summary', status: 'ok', asOf: '2026-09-28T01:00:00.000Z',
      sourceRefs: [SOURCE_REF], facts: [], data: { pendingApprovalCount: 2 } };
    const { provider, calls } = recordingProvider([
      JSON.stringify({ calls: [{ index: 0, toolName: 'reimbursement.get_summary', input: {} }], questions: [] }),
      JSON.stringify({ answers: [{ index: 0, status: 'handled',
        text: 'ขอโทษครับ ผมยังไม่มีข้อมูลใบเบิกของคุณโดยเฉพาะครับ', sourceRefIds: [SOURCE_REF.id] }] }),
    ]);
    const result = await runSemanticTurnV2({
      req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { return toolResult; },
    });
    assert.ok(!result.replyText.includes('ครับ'), result.replyText);
    assert.ok(!result.replyText.includes('ผม'), result.replyText);
    assert.ok(result.replyText.includes('ค่ะ'), result.replyText);
    assert.ok(result.replyText.includes('น้องมั่งมี'), result.replyText);
    assert.ok(calls.some((call) => call.usageTag === 'line.compose' && call.systemPrompt.includes('never the male ครับ')),
      'ANSWER_PROMPT must include the shared persona prompt');
  });

  // tuning-6a (E2, run 5: 24/77 compose calls answered in plain prose instead of the required
  // JSON): ANSWER_PROMPT restates the format requirement AFTER the persona block, so it is the
  // last thing the model reads before answering.
  it('E2: ANSWER_PROMPT restates the JSON-only format requirement after the persona block', async () => {
    const request: LineAiTurnRequest = {
      requestId: 'req-2', webhookEventId: 'event-2', messageText: 'ขอบคุณค่ะ',
      messagePreviewHash: 'b'.repeat(16), valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [{ index: 0, kind: 'general', goal: 'ขอบคุณ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['reimbursement.read_own']),
    };
    const { provider, calls } = recordingProvider([
      JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'ยินดีค่ะ' }] }),
    ]);
    await runSemanticTurnV2({
      req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('no tool call expected for a general item'); },
    });
    const compose = calls.find((call) => call.usageTag === 'line.compose');
    assert.ok(compose, 'expected a compose call');
    const personaIndex = compose!.systemPrompt.indexOf('never the male ครับ');
    const restatementIndex = compose!.systemPrompt.indexOf('Output format is unchanged: return only the JSON object described above.');
    assert.ok(personaIndex >= 0 && restatementIndex > personaIndex, compose!.systemPrompt);
  });
});

// E6 (tuning-6a, run 5 T-148-b, STAFF "ขอดูค่าใช้จ่ายของสาขา 2 ทั้งหมดเลยค่ะ"): compose wrote
// "(ข้อมูลเฉพาะรายการที่เกี่ยวข้องกับสาขานี้)", which misstates an own/related access scope as a
// branch scope. The guard appends the fast lane's own scope line whenever a good result is
// own/related-scoped and the composed text does not already say so in either language.
describe('E6: a composed answer built from an own/related-scoped result always states the scope', () => {
  const TOOL_RESULT_BASE = { toolName: 'expense.list_recent', status: 'ok' as const, asOf: '2026-09-28T01:00:00.000Z',
    sourceRefs: [SOURCE_REF], facts: [], data: { total: 1, items: [], summary: { totalAmount: '1000' } } };

  function request(messageText: string): LineAiTurnRequest {
    return {
      requestId: 'req-e6', webhookEventId: 'event-e6', messageText, messagePreviewHash: 'c'.repeat(16), valueCandidates: EMPTY_CANDIDATES,
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ดูค่าใช้จ่ายสาขา 2', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: baseUserContext(['expense.read_related']),
    };
  }

  async function run(toolResult: ToolResult, composedText: string) {
    const { provider } = recordingProvider([
      JSON.stringify({ calls: [{ index: 0, toolName: 'expense.list_recent', input: {} }], questions: [] }),
      JSON.stringify({ answers: [{ index: 0, status: 'handled', text: composedText, sourceRefIds: [SOURCE_REF.id] }] }),
    ]);
    return runSemanticTurnV2({
      req: request('ขอดูค่าใช้จ่ายของสาขา 2 ทั้งหมดเลยค่ะ'), provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { return toolResult; },
    });
  }

  it('appends the scope line when the result is "related"-scoped and the model never said so', async () => {
    const toolResult: ToolResult = { ...TOOL_RESULT_BASE,
      queryApplied: { timezone: 'Asia/Bangkok', dateBasis: 'incurredDate', statusBasis: 'documentStatus', dataset: 'expenses', accessScope: 'related' } };
    const result = await run(toolResult, '(ข้อมูลเฉพาะรายการที่เกี่ยวข้องกับสาขานี้) ยอดรวม 1,000 บาทค่ะ');
    assert.ok(result.replyText.includes('ขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ'), result.replyText);
  });

  it('appends the scope line when accessScope rides `data` instead of `queryApplied` (legacy shape)', async () => {
    const toolResult: ToolResult = { ...TOOL_RESULT_BASE, data: { ...TOOL_RESULT_BASE.data, accessScope: 'own' } };
    const result = await run(toolResult, 'ยอดรวม 1,000 บาทค่ะ');
    assert.ok(result.replyText.includes('ขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ'), result.replyText);
  });

  it('never double-states the scope when the model already said "ของคุณ"', async () => {
    const toolResult: ToolResult = { ...TOOL_RESULT_BASE,
      queryApplied: { timezone: 'Asia/Bangkok', dateBasis: 'incurredDate', statusBasis: 'documentStatus', dataset: 'expenses', accessScope: 'related' } };
    const result = await run(toolResult, 'ยอดรวม 1,000 บาทค่ะ (เฉพาะรายการของคุณ)');
    assert.ok(!result.replyText.includes('ขอบเขต:'), result.replyText);
  });

  it('never appends the scope line for a company-wide result', async () => {
    const toolResult: ToolResult = { ...TOOL_RESULT_BASE,
      queryApplied: { timezone: 'Asia/Bangkok', dateBasis: 'incurredDate', statusBasis: 'documentStatus', dataset: 'expenses', accessScope: 'company' } };
    const result = await run(toolResult, 'ยอดรวม 1,000 บาทค่ะ');
    assert.ok(!result.replyText.includes('ขอบเขต:'), result.replyText);
  });
});
