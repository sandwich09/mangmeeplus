/**
 * Advisor Q1/Q2 (owner decision 2026-09-30, spec §4.2): "วันนี้มีอะไรต้องทำ" (Q1) stays the one-tool daily
 * closing; "มีอะไรค้างที่ฉันต้องทำ" (Q2) also reads the caller's OWN queues — substitute receipts to sign and,
 * when this caller is offered it, the reimbursement approval queue — whatever the router hinted or the
 * planner chose.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLineAiInputEvidence, extractValueCandidatesV2, type LineAiTurnRequest, type ToolResult } from '@watchdog-bms/contracts';
import type { IModelProvider, ProviderInput, ProviderOutput } from '../infrastructure/provider/provider.port';
import { runSemanticTurnV2 } from './semantic-turn-v2';

const TODAY = '2026-09-30';
const APPROVER = ['expense.read', 'expense.read_own', 'expense.confirm', 'reimbursement.approve'];
const STAFF = ['expense.read_related', 'expense.read_own'];

async function turn(messageText: string, permissions: string[], plannedTools: string[], split = false, filters: Record<number, Record<string, string | number | boolean | null>> = {}) {
  const built = await createLineAiInputEvidence({ turnKey: `turn-${messageText.length}`,
    parts: [{ partId: 'part-0', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.parse(`${TODAY}T02:00:00.000Z`), rawText: messageText }] });
  assert.ok(built);
  const valueCandidates = await extractValueCandidatesV2(built.inputEvidence, TODAY);
  assert.ok(valueCandidates);
  const request: LineAiTurnRequest = {
    requestId: 'req-q', webhookEventId: 'event-q', messageText, messagePreviewHash: 'c'.repeat(16), valueCandidates,
    semanticSubrequests: (split ? plannedTools : [plannedTools[0]]).map((_, index) => ({ index, kind: 'read' as const, goal: messageText, requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: filters[index] ?? {} })),
    userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
      permissions, roles: ['OWNER'], branchIds: [], locationIds: [], locale: 'th-TH' } as LineAiTurnRequest['userContext'],
  };
  const invoked: string[] = [];
  const control = JSON.stringify({ calls: plannedTools.map((toolName, index) => ({ index: split ? index : 0, toolName, input: filters[index] ?? {} })) });
  const provider: IModelProvider = { async generateText(input: ProviderInput): Promise<ProviderOutput> {
    return { ok: true, text: input.usageTag === 'line.loop' ? control
      : JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'สรุปงานที่รอคุณแล้วค่ะ', sourceRefIds: [`expenses:${invoked[0]}:summary`] }] }) };
  } };
  await runSemanticTurnV2({ req: request, provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
    async invoke(meta): Promise<ToolResult> {
      invoked.push(meta.name);
      return { toolName: meta.name, status: 'ok', asOf: `${TODAY}T02:00:00.000Z`, data: { total: 0 },
        sourceRefs: [{ id: `expenses:${meta.name}:summary`, label: meta.name, module: 'expenses', entityType: meta.name, permissionChecked: true }] };
    } });
  return invoked;
}

describe('advisor Q1/Q2: the day\'s checklist vs the caller\'s own pending work', () => {
  it('Q2 reads the caller\'s own queues too, even when only the daily closing was planned', async () => {
    const invoked = await turn('มีอะไรค้างที่ฉันต้องทำบ้างคะ', APPROVER, ['expense.get_daily_closing']);
    assert.deepEqual([...invoked].sort(), ['expense.get_daily_closing', 'expense.list_substitute_receipts_to_sign', 'reimbursement.list_pending_approvals']);
  });

  it('Q2 never reaches for a queue this caller is not offered (no reimbursement.approve)', async () => {
    const invoked = await turn('งานค้างของฉันมีอะไรบ้าง', STAFF, ['expense.get_daily_closing']);
    assert.deepEqual([...invoked].sort(), ['expense.get_daily_closing', 'expense.list_substitute_receipts_to_sign']);
  });

  it('Q2 split by the router into one read per queue reads each queue once', async () => {
    const invoked = await turn('มีอะไรค้างที่ฉันต้องทำบ้างคะ', APPROVER,
      ['expense.get_daily_closing', 'expense.list_substitute_receipts_to_sign', 'reimbursement.list_pending_approvals'], true);
    assert.deepEqual([...invoked].sort(), ['expense.get_daily_closing', 'expense.list_substitute_receipts_to_sign', 'reimbursement.list_pending_approvals']);
  });

  it('Q2 for a caller who approves no claims reads their own claims, never the approval queue it is not offered', async () => {
    const invoked = await turn('งานค้างของฉันมีอะไรบ้าง', [...STAFF, 'reimbursement.read_own'],
      ['expense.get_daily_closing', 'expense.list_substitute_receipts_to_sign', 'reimbursement.list_pending_approvals'], true);
    assert.deepEqual([...invoked].sort(), ['expense.get_daily_closing', 'expense.list_substitute_receipts_to_sign', 'reimbursement.get_summary']);
  });

  it('Q2 naming no day: the router\'s explicit today on the closing is the closing\'s own default, never an ungrounded date', async () => {
    const planned = ['expense.list_substitute_receipts_to_sign', 'reimbursement.list_pending_approvals', 'expense.get_daily_closing'];
    const invoked = await turn('มีงานอะไรค้างอยู่บ้าง', APPROVER, planned, true, { 2: { date: TODAY } });
    assert.deepEqual([...invoked].sort(), [...planned].sort());
    // A message that names another day keeps the grounding rule: today is not what it asked for.
    const yesterday = await turn('เมื่อวานมีงานอะไรค้างบ้าง', APPROVER, planned, true, { 2: { date: TODAY } });
    assert.ok(!yesterday.includes('expense.get_daily_closing'), yesterday.join(','));
  });

  it('Q1 stays the daily closing alone', async () => {
    const invoked = await turn('วันนี้มีอะไรต้องทำบ้างคะ', APPROVER, ['expense.get_daily_closing']);
    assert.deepEqual(invoked, ['expense.get_daily_closing']);
  });
});
