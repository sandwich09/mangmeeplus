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
});
