/**
 * Advisor S3 (spec §5.3, plan S3): "ใบเบิกค้างที่ใคร" reaches reimbursement.get_approval_backlog through
 * the router, the planner and compose, and the shared pile stays its own line (Owner 2026-09-30).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LineAiTurnRequest, ToolResult } from '@watchdog-bms/contracts';
import type { IModelProvider, ProviderInput, ProviderOutput } from '../infrastructure/provider/provider.port';
import { runSemanticTurnV2 } from './semantic-turn-v2';
import { ROUTER_ENABLED_TOOLS, effectiveIntakeToolNames, intakeRouterSystemPrompt } from './intent-router.agent';
import { ALLOWED_TOOLS } from './accounting-summary.agent';

const TOOL = 'reimbursement.get_approval_backlog';
const SOURCE_REF = { label: 'ใบเบิกที่ยังรออยู่', module: 'reimbursements', entityType: 'reimbursement_approval_backlog',
  permissionChecked: true as const, asOf: '2026-09-30T03:00:00.000Z', webPath: '/companies/company/reimbursements' };
const SOURCE_ID = 'reimbursements:reimbursement_approval_backlog:summary';

function request(messageText: string, permissions: string[], requestedFilters: Record<string, string> = {}, kind: 'read' | 'write' = 'read'): LineAiTurnRequest {
  return {
    requestId: 'req-s3', webhookEventId: 'event-s3', messageText, messagePreviewHash: 'e'.repeat(16),
    valueCandidates: { version: 2, inputDigest: 'a'.repeat(64), extractorVersion: 'value-v2', todayIso: '2026-09-30',
      completeness: 'complete', counts: { amounts: 0, dates: 0, periods: 0 }, amounts: [], dates: [], periods: [] },
    semanticSubrequests: [{ index: 0, kind, goal: 'ใบเบิกค้างที่ใคร', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters }],
    userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
      permissions, roles: ['STAFF'], branchIds: [], locationIds: [], locale: 'th-TH' } as LineAiTurnRequest['userContext'],
  };
}

function recordingProvider(responses: string[]) {
  const queue = [...responses];
  const calls: Array<{ usageTag: string; systemPrompt: string; text: string }> = [];
  const provider: IModelProvider = {
    async generateText(input: ProviderInput): Promise<ProviderOutput> {
      calls.push({ usageTag: input.usageTag ?? '', systemPrompt: input.systemPrompt ?? '', text: input.messages?.[0]?.text ?? '' });
      return { ok: true, text: queue.shift() ?? '{}' };
    },
  };
  return { provider, calls };
}

const BACKLOG: ToolResult = {
  toolName: TOOL, status: 'ok', asOf: '2026-09-30T03:00:00.000Z', sourceRefs: [SOURCE_REF],
  queryApplied: { timezone: 'Asia/Bangkok', dateBasis: 'submitted_or_approved_thai_day', statusBasis: 'waiting_claims',
    dataset: 'reimbursement_requests', accessScope: 'own', filters: { requester: 'me' } },
  data: { accessScope: 'own', total: 3, totalsByCurrency: [{ currency: 'THB', amount: '1750.00' }],
    byApprover: [{ name: 'สมศรี', count: 1, totalsByCurrency: [{ currency: 'THB', amount: '500.00' }], oldestSubmittedOn: '2026-09-23', longestWaitDays: 7 }],
    sharedPile: { label: 'กองกลาง (อนุมัติได้หลายคน)', count: 2, totalsByCurrency: [{ currency: 'THB', amount: '1250.00' }], oldestSubmittedOn: '2026-09-26', longestWaitDays: 4 },
    desks: [], items: [] },
};

describe('advisor S3: reimbursement.get_approval_backlog wiring and prompt rules', () => {
  it('is router-enabled, specialist-reachable and offered to a staff member who can read their own claims', () => {
    assert.ok(ROUTER_ENABLED_TOOLS.has(TOOL));
    assert.ok(ALLOWED_TOOLS.has(TOOL));
    const offered = effectiveIntakeToolNames([TOOL, 'reimbursement.list_pending_approvals'], ROUTER_ENABLED_TOOLS,
      ['ai.tool.invoke', 'reimbursement.read_own'], ['reimbursement']);
    assert.deepEqual([...offered], [TOOL]);
  });

  it('routes who/where questions to the backlog, "me" only for the user\'s own claims, and never as a simple read', () => {
    const prompt = intakeRouterSystemPrompt({ fusedPlan: true }, false, true, false, new Set(['reimbursement.get_summary::single_metric']));
    assert.match(prompt, /whether reimbursement claims are stuck, or WHO or WHERE they are waiting — ใบเบิกค้างไหม, มีใบเบิกค้างอยู่บ้าง, ค้างที่ใคร, อยู่ที่ใคร, กองอยู่ที่ใคร, ใครยังไม่อนุมัติ, ใบไหนรอนานที่สุด — is a read with tool reimbursement\.get_approval_backlog/);
    assert.match(prompt, /Its only filter is requester "me", and only when the user asks about their OWN claims/);
    // Run 1 (R-18 t2): "ที่รอสมศรี" came back as vendorName, which the backlog cannot take, so the read failed closed.
    assert.match(prompt, /a person named in the question \(ที่รอสมศรี\) is never a filter — no vendorName or any other key/);
    assert.match(prompt, /Claims waiting for the user themself to approve \(รอฉันอนุมัติ\) stay reimbursement\.list_pending_approvals/);
    assert.match(prompt, /\(ใบเบิกค้างไหม, ค้างที่ใคร, อยู่ที่ใคร, ใครยังไม่อนุมัติ, รอนานที่สุด\), is not a simple read: omit simpleRead so normal planning uses reimbursement\.get_approval_backlog/);
  });

  it('plans the backlog with requester "me", keeps the pile out of any person\'s count, and says the scope', async () => {
    const answer = 'ใบเบิกของคุณที่ยังรออยู่ 3 ใบค่ะ\n• คุณสมศรี 1 ใบ รอ 7 วัน\n• กองกลาง (อนุมัติได้หลายคน) 2 ใบ รอนานสุด 4 วัน';
    const { provider, calls } = recordingProvider([
      JSON.stringify({ calls: [{ index: 0, toolName: TOOL, input: { requester: 'me' } }], questions: [] }),
      JSON.stringify({ answers: [{ index: 0, status: 'handled', text: answer, sourceRefIds: [SOURCE_ID] }] }),
    ]);
    const invoked: Array<Record<string, unknown>> = [];
    const result = await runSemanticTurnV2({
      req: request('ใบเบิกของฉันค้างอยู่ที่ใครคะ', ['ai.tool.invoke', 'reimbursement.read_related', 'reimbursement.read_own']),
      provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(meta, _ctx, args): Promise<ToolResult> { assert.equal(meta.name, TOOL); invoked.push(args); return BACKLOG; },
    });

    const control = calls.find((call) => call.usageTag === 'line.loop')!;
    assert.match(control.systemPrompt, /For whether reimbursement claims are stuck or who or where they are waiting .* call reimbursement\.get_approval_backlog, with input requester "me" only when the user asks about their own claims .* and never a person's name as input/);
    assert.ok(JSON.parse(control.text).tools.some((tool: { name: string }) => tool.name === TOOL));
    assert.deepEqual(invoked, [{ requester: 'me' }]);
    const compose = calls.find((call) => call.usageTag === 'line.compose')!;
    assert.match(compose.systemPrompt, /the sharedPile is its own line \(claims several people can approve\) and is never added to, split among or named after any person/);
    assert.match(compose.systemPrompt, /the first line answers exactly the group asked about .* opens with the grand total only when the question is about all claims/);
    assert.match(compose.systemPrompt, /for what to do next use only a group's note, never a guessed cause or fix/);
    // Every number is the tool's own, so the grounded answer is kept; the own-scope line is added.
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.ok(result.replyText.startsWith(answer), result.replyText);
    assert.match(result.replyText, /ขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ|ของคุณ/);
    assert.deepEqual(result.webLinks, [{ label: SOURCE_REF.label, path: SOURCE_REF.webPath }]);
  });

  // Run 2 (R-13, "ใบเบิกที่รอจ่ายอยู่ที่ใคร"): the router attached paymentStatus UNPAID, which the backlog cannot take,
  // and the read failed closed into "ยังดึงข้อมูลไม่ได้". Its groups already answer a stage or a person; a branch it
  // cannot narrow to still fails closed, since that answer would silently be the whole shop.
  it('answers a stage or a person from the backlog\'s own groups, but never silently widens a branch', async () => {
    const run = async (filters: Record<string, string>) => {
      const invoked: Array<Record<string, unknown>> = [];
      const { provider } = recordingProvider([
        JSON.stringify({ calls: [{ index: 0, toolName: TOOL, input: {} }], questions: [] }),
        JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'รอจ่าย 1 ใบค่ะ', sourceRefIds: [SOURCE_ID] }] }),
      ]);
      await runSemanticTurnV2({ req: request('ใบเบิกที่รอจ่ายอยู่ที่ใคร', ['ai.tool.invoke', 'reimbursement.read'], filters),
        provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
        async invoke(_meta, _ctx, args): Promise<ToolResult> { invoked.push(args); return { ...BACKLOG, data: { ...(BACKLOG.data as object), total: 1 } }; } });
      return invoked;
    };
    assert.deepEqual(await run({ paymentStatus: 'UNPAID', vendorName: 'สมศรี', documentStatus: 'APPROVED' }), [{}]);
    assert.deepEqual(await run({ branchId: 'สาขา 2' }), []);
  });

  // Run 2 (R-06, "อนุมัติให้หมดเลย"): the planner answered with only a question for the user and no "calls" key; that
  // was read as a broken round and the user got "ยังดึงข้อมูลไม่ได้" instead of the question.
  it('treats a planning round that only asks the user a question as that question', async () => {
    const question = 'การอนุมัติใบเบิกต้องทำบนเว็บค่ะ อยากให้น้องมั่งมีสรุปใบที่รออนุมัติให้ดูก่อนไหมคะ';
    // Run 3 (R-06): the planner wrote "หนูมั่งมี"; her name is the only self-reference.
    const { provider } = recordingProvider([JSON.stringify({ questions: [{ index: 0, text: question.replace('น้องมั่งมี', 'หนูมั่งมี') }] })]);
    const result = await runSemanticTurnV2({ req: request('อนุมัติให้หมดเลย', ['ai.tool.invoke', 'reimbursement.approve'], {}, 'write'),
      provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('no tool may run'); } });
    assert.equal(result.semanticCoverage?.[0]?.status, 'needs_user');
    assert.equal(result.replyText, question);
  });
});
