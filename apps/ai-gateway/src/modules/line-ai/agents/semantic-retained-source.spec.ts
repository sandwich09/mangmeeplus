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
import { completeReimbursementDraftInput } from './reimbursement-draft-input';

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
    const payload = JSON.parse(accepted.prompts[0]!.cacheableContext!);
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

// NAT04 (2026-09-30): "งั้นช่วยทำร่างจากใบที่สอง ซื้อของใช้ในออฟฟิศ" echoed the conversation task id as the draft's
// taskId (INVALID_REIMBURSEMENT_AUTHORITY), and a preview needs the user's words at their exact UTF-16 span.
describe('reimbursement draft input completion', () => {
  const ACTION = '40000000-0000-4000-8000-0000000000aa', DRAFT_TASK = '40000000-0000-4000-8000-0000000000bb';
  const CONVERSATION = 'c'.repeat(64);
  async function turn(text: string) {
    const created = await createLineAiInputEvidence({ turnKey: 'claim-turn', parts: [{ partId: 'claim-part',
      eventIdHash: 'd'.repeat(64), acceptedAtMs: Date.parse('2026-09-30T03:00:00.000Z'), rawText: text }] });
    assert.ok(created);
    const candidates = await extractValueCandidatesV2(created.inputEvidence, '2026-09-30');
    assert.ok(candidates);
    const part = created.inputEvidence.parts[0]!;
    const req: LineAiTurnRequest = { requestId: 'request-claim', webhookEventId: 'event-claim', messageText: text,
      messagePreviewHash: 'e'.repeat(16), inputEvidence: created.inputEvidence, valueCandidates: candidates,
      taskProjection: { version: 2, stateVersion: 5, lifecycleEpoch: 0, expiresAtMs: Date.parse('2026-09-30T04:00:00.000Z'),
        tasks: [{ taskId: CONVERSATION, revision: 2, kind: 'write', state: 'active', userGoal: 'เบิก', subrequests: [{ index: 0, kind: 'write', goal: 'เบิก', status: 'pending' }],
          slots: { reimbursementActionId0: ACTION } }] },
      semanticSubrequests: [{ index: 0, kind: 'write', writeIntent: 'REIMBURSEMENT_REQUEST_START', goal: 'เบิกใบที่สอง', requiredEvidence: [],
        requestedFilters: {}, dependsOn: [], taskRef: { taskId: CONVERSATION, taskRevision: 1, subrequestIndex: 0 },
        evidenceRefs: [{ partId: part.partId, startUtf16: 0, endUtf16: text.length, rawSha256: part.rawSha256 }] }],
      userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
        permissions: ['ai.tool.invoke', 'reimbursement.create'], roles: ['owner'], branchIds: [], locationIds: [], locale: 'th-TH' } } as LineAiTurnRequest;
    return { req, part };
  }
  const options: ToolResult = { toolName: 'reimbursement.draft.get_options', status: 'ok', sourceRefs: [], asOf: '2026-09-30T03:00:00.000Z',
    data: { actionLocator: { actionId: ACTION, taskId: DRAFT_TASK, operation: 'CREATE' }, options: { taskRevision: 0, choices: [] } } };

  // NAT04 (2026-09-30): the planner asked "which bill?" before any bill had been listed.
  it('reads the claimable bills beside a claim question asked before any options', async () => {
    const { req } = await turn('บิลร้านเครื่องเขียนที่ส่งไว้สองใบอะ');
    const prompts: ProviderInput[] = [], invoked: Array<{ name: string; input: unknown }> = [];
    const provider: IModelProvider = { async generateText(input: ProviderInput): Promise<ProviderOutput> {
      prompts.push(input);
      return { ok: true, text: JSON.stringify({ calls: [], questions: [{ index: 0, text: 'จะเบิกใบไหนคะ' }] }) };
    } };
    const result = await runWithUsageContext({ companyId: 'company', budget: { status: 'active-v2', grant: { maxTurnSlots: 5 } as never,
      inputDigest: req.inputEvidence!.joinedSha256, sourceRoute: 'test', calls: 0, repairCount: 0 } }, () =>
      runSemanticTurnV2({ req, provider, draftEditEnabled: false, reimbursementDraftEnabled: true, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
        async invoke(meta, _context, args): Promise<ToolResult> {
          invoked.push({ name: meta.name, input: args });
          return { ...options, sourceRefs: [{ label: 'ร่างใบเบิก', module: 'reimbursements', entityType: 'reimbursement_draft_action', entityId: ACTION, permissionChecked: true }] };
        } }));
    assert.deepEqual(invoked, [{ name: 'reimbursement.draft.get_options', input: { operation: 'CREATE', subrequestIndex: 0 } }]);
    assert.deepEqual(prompts.map(prompt => prompt.usageTag), ['line.loop'], 'no second planning round and no compose');
    assert.equal(result.semanticCoverage?.[0]?.status, 'needs_user');
    assert.equal(result.semanticCoverage?.[0]?.question, 'จะเบิกใบไหนคะ');
    assert.ok(result.sourceRefs.some(ref => ref.entityType === 'reimbursement_draft_action'), 'the API prints the bills for this action');
  });

  it('keeps only API-issued draft locators on get_options', async () => {
    const { req } = await turn('งั้นช่วยทำร่างจากใบที่สอง ซื้อของใช้ในออฟฟิศ');
    assert.deepEqual(completeReimbursementDraftInput('reimbursement.draft.get_options',
      { operation: 'CREATE', subrequestIndex: 0, taskId: CONVERSATION, actionId: ACTION }, [], req), { operation: 'CREATE', subrequestIndex: 0, actionId: ACTION });
    assert.deepEqual(completeReimbursementDraftInput('reimbursement.draft.get_options',
      { operation: 'CREATE', subrequestIndex: 0, actionId: 'f'.repeat(64) }, [], req), { operation: 'CREATE', subrequestIndex: 0 });
    assert.deepEqual(completeReimbursementDraftInput('reimbursement.draft.get_options',
      { operation: 'CREATE', subrequestIndex: 0, taskId: DRAFT_TASK, actionId: ACTION }, [{ result: options }], req),
      { operation: 'CREATE', subrequestIndex: 0, taskId: DRAFT_TASK, actionId: ACTION });
  });

  it('gives a preview the issued locator and binds the user\'s words to their exact span', async () => {
    const text = 'งั้นช่วยทำร่างจากใบที่สอง ซื้อของใช้ในออฟฟิศ';
    const { req, part } = await turn(text);
    const completed = completeReimbursementDraftInput('reimbursement.draft.preview_create', { action: { actionId: ACTION, taskId: CONVERSATION },
      proposal: { lineChanges: [{ operation: 'ADD', values: { linkedExpenseChoiceId: 'a'.repeat(64) } }],
        fields: { reason: { value: 'ซื้อของใช้ในออฟฟิศ', proof: { kind: 'USER_TEXT', refs: [{ partId: part.partId, startUtf16: 3, endUtf16: 9, rawSha256: part.rawSha256 }] } } } } },
      [{ result: options }], req) as Record<string, any>;
    const start = text.indexOf('ซื้อของใช้ในออฟฟิศ');
    assert.deepEqual(completed.action, { actionId: ACTION, taskId: DRAFT_TASK, operation: 'CREATE' });
    assert.equal(completed.proposal.taskId, DRAFT_TASK);
    assert.equal(completed.proposal.taskRevision, 0);
    assert.equal(completed.proposal.schemaVersion, 1);
    assert.deepEqual(completed.proposal.fields.reason, { value: 'ซื้อของใช้ในออฟฟิศ', proof: { kind: 'USER_TEXT',
      refs: [{ partId: part.partId, startUtf16: start, endUtf16: start + 'ซื้อของใช้ในออฟฟิศ'.length, rawSha256: part.rawSha256 }] } });
    assert.deepEqual(completed.proposal.lineChanges, [{ operation: 'ADD', values: { linkedExpenseChoiceId: 'a'.repeat(64) } }]);
    // Words the user did not type exactly once stay as planned, for the API to refuse.
    const paraphrase = completeReimbursementDraftInput('reimbursement.draft.preview_create',
      { action: {}, proposal: { fields: { reason: 'ซื้อของใช้สำนักงาน' } } }, [{ result: options }], req) as Record<string, any>;
    assert.equal(paraphrase.proposal.fields.reason, 'ซื้อของใช้สำนักงาน');
    const { req: twice } = await turn('ค่ารถ ค่ารถ');
    assert.equal((completeReimbursementDraftInput('reimbursement.draft.preview_create',
      { action: {}, proposal: { fields: { reason: 'ค่ารถ' } } }, [{ result: options }], twice) as Record<string, any>).proposal.fields.reason, 'ค่ารถ');
    // Round 10 (fed4ddab): the planner copied the options `revision` into `action`; only the issued locator goes out.
    const extra = completeReimbursementDraftInput('reimbursement.draft.preview_create', { action: { actionId: ACTION, taskId: DRAFT_TASK,
      operation: 'CREATE', revision: 'b'.repeat(64) }, proposal: {} }, [{ result: options }], req) as Record<string, any>;
    assert.deepEqual(extra.action, { actionId: ACTION, taskId: DRAFT_TASK, operation: 'CREATE' });
    // No get_options result in this turn: nothing is filled in.
    const bare = { action: { actionId: ACTION, taskId: CONVERSATION }, proposal: {} };
    assert.equal(completeReimbursementDraftInput('reimbursement.draft.preview_create', bare, [], req), bare);
  });
});
