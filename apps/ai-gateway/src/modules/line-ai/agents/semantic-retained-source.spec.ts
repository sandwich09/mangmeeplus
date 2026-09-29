import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLineAiInputEvidence,
  extractValueCandidatesV2,
  type LineAiRetainedTaskSourceV2,
  type LineAiTurnRequest,
  type ToolResult,
} from '@watchdog-bms/contracts';
import { runWithUsageContext } from '../../../common/usage/usage-context';
import type { IModelProvider, ProviderInput, ProviderOutput } from '../infrastructure/provider/provider.port';
import { runSemanticTurnV2 } from './semantic-turn-v2';

const TASK = '40000000-0000-4000-8000-000000000001';

async function fixture() {
  const originalText = 'เบิกค่ารถ 420 บาท เมื่อวาน และเบิกค่าอาหาร 999 บาท วันนี้';
  const selectedText = 'เบิกค่ารถ 420 บาท เมื่อวาน';
  const original = await createLineAiInputEvidence({ turnKey: 'original-turn', parts: [{ partId: 'original-part',
    eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.parse('2026-09-26T03:00:00.000Z'), rawText: originalText }] });
  const current = await createLineAiInputEvidence({ turnKey: 'selection-turn', parts: [{ partId: 'selection-part',
    eventIdHash: 'b'.repeat(64), acceptedAtMs: Date.parse('2026-09-27T03:00:00.000Z'), rawText: 'ทำข้อ 1 ก่อน' }] });
  assert.ok(original && current);
  const part = original.inputEvidence.parts[0]!;
  const evidenceRefs = [{ partId: part.partId, startUtf16: 0, endUtf16: selectedText.length, rawSha256: part.rawSha256 }];
  const retainedTaskSource: LineAiRetainedTaskSourceV2 = { taskRef: { taskId: TASK, taskRevision: 3, subrequestIndex: 0 },
    inputEvidence: original.inputEvidence, semanticSubrequest: { index: 0, kind: 'write', writeIntent: 'REIMBURSEMENT_REQUEST_START',
      goal: selectedText, requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs } };
  const historical = await extractValueCandidatesV2(original.inputEvidence, '2026-09-26');
  const currentCandidates = await extractValueCandidatesV2(current.inputEvidence, '2026-09-27');
  assert.ok(historical && currentCandidates);
  return { current, retainedTaskSource, selectedText,
    selectedId: historical.amounts.find(candidate => candidate.value === '420')!.candidateId,
    siblingId: historical.amounts.find(candidate => candidate.value === '999')!.candidateId,
    currentCandidates };
}

function request(source: Awaited<ReturnType<typeof fixture>>): LineAiTurnRequest {
  return { requestId: 'request-selection', webhookEventId: 'event-selection', messageText: source.current.messageText,
    messagePreviewHash: 'c'.repeat(16), inputEvidence: source.current.inputEvidence, valueCandidates: source.currentCandidates,
    retainedTaskSource: source.retainedTaskSource,
    semanticSubrequests: [{ index: 0, kind: 'write', writeIntent: 'REIMBURSEMENT_REQUEST_START', goal: source.selectedText,
      requiredEvidence: [], requestedFilters: {}, dependsOn: [], taskRef: source.retainedTaskSource.taskRef,
      evidenceRefs: [{ partId: source.current.inputEvidence.parts[0]!.partId, startUtf16: 0,
        endUtf16: source.current.messageText.length, rawSha256: source.current.inputEvidence.parts[0]!.rawSha256 }] }],
    userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
      permissions: ['ai.tool.invoke', 'reimbursement.create'], roles: ['owner'], branchIds: [], locationIds: [], locale: 'th-TH' },
  };
}

async function run(candidateId: string, draftResult?: Record<string, unknown>) {
  const source = await fixture(), prompts: ProviderInput[] = [], invoked: string[] = [];
  const controls = [
    JSON.stringify({ calls: [{ index: 0, toolName: 'reimbursement.draft.get_options', input: { operation: 'CREATE', subrequestIndex: 0 } }], questions: [] }),
    JSON.stringify({ calls: [{ index: 0, toolName: 'reimbursement.draft.preview_create', input: { action: { taskId: TASK, actionId: 'action-1' },
      proposal: { schemaVersion: 1, taskId: TASK, taskRevision: 3, operation: 'CREATE', fields: {}, lineChanges: [{ operation: 'ADD',
        values: { amount: { value: '420', proof: { kind: 'USER_TEXT', refs: source.retainedTaskSource.semanticSubrequest.evidenceRefs,
          candidateId } } } }] } } }], questions: [] }),
  ];
  const provider: IModelProvider = { async generateText(input: ProviderInput): Promise<ProviderOutput> {
    prompts.push(input);
    return { ok: true, text: controls.shift() ?? '{"answers":[{"index":0,"status":"needs_user","text":"ตรวจสอบแล้ว","sourceRefIds":[]}]}' };
  } };
  const result = await runWithUsageContext({ companyId: 'company', budget: { status: 'active-v2', grant: { maxTurnSlots: 5 } as never,
    inputDigest: source.current.inputEvidence.joinedSha256, sourceRoute: 'test', calls: 0, repairCount: 0 } }, () =>
    runSemanticTurnV2({ req: request(source), provider, draftEditEnabled: false, reimbursementDraftEnabled: true,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(meta): Promise<ToolResult> { invoked.push(meta.name); const draft = meta.name.endsWith('preview_create') && draftResult;
        return { toolName: meta.name, status: 'ok',
        sourceRefs: draft ? [{ label: 'ร่างใบเบิก', module: 'reimbursements', entityType: 'reimbursement_draft_action', entityId: 'action-1', permissionChecked: true }] : [],
        asOf: '2026-09-27T00:00:00.000Z',
        data: meta.name.endsWith('get_options') ? { actionLocator: { taskId: TASK, actionId: 'action-1' } } : draft ? { reimbursementDraft: draftResult } : {} }; } }));
  return { source, prompts, invoked, result };
}

describe('semantic turn retained task source', () => {
  it('exposes only the selected historical clause/candidates and rejects a sibling candidate id', async () => {
    const accepted = await run((await fixture()).selectedId);
    const payload = JSON.parse(accepted.prompts[0]!.messages[0]!.text);
    assert.equal(payload.messageText, 'ทำข้อ 1 ก่อน');
    assert.deepEqual(payload.inputEvidence, accepted.source.current.inputEvidence);
    assert.equal(payload.retainedTaskSource.selectedClause.text, accepted.source.selectedText);
    assert.deepEqual(payload.retainedTaskSource.selectedClause.valueCandidates.amounts.map((item: { value: string }) => item.value), ['420']);
    assert.deepEqual(payload.retainedTaskSource.selectedClause.valueCandidates.periods
      .map((item: { fromDate: string }) => item.fromDate), ['2026-09-25']);
    assert.equal(JSON.stringify(payload.retainedTaskSource).includes('999'), false);
    assert.deepEqual(accepted.invoked, ['reimbursement.draft.get_options', 'reimbursement.draft.preview_create']);

    const rejected = await run((await fixture()).siblingId);
    assert.deepEqual(rejected.invoked, ['reimbursement.draft.get_options']);
  });

  // NAT-04 (2026-09-29): get_options, preview_create and then compose ran past the 20 s runtime deadline,
  // though a draft write's answer is the fixed draft text plus the API's own card whatever compose says.
  it('answers a reimbursement draft write from its tool result without a compose call', async () => {
    const done = await run((await fixture()).selectedId, { status: 'preview' });
    assert.deepEqual(done.prompts.map(prompt => prompt.usageTag), ['line.loop', 'line.loop']);
    assert.equal(done.result.semanticCoverage?.[0]?.status, 'needs_user');
    assert.equal(done.result.semanticCoverage?.[0]?.reasonCode, 'CONFIRMATION_REQUIRED');
    assert.match(done.result.replyText, /ยังไม่ได้บันทึกหรือยื่นใบเบิก/u);
  });
});
