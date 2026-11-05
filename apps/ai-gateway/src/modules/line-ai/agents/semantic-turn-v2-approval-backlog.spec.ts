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
import { fixMangmeeSelfReference, sanitizeMangmeeComposedText } from './mangmee-persona';
import { approvalBacklogStageWording, emptyApprovalBacklogReplyText } from '../domain/logic/business-read-result-semantics';

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
  const calls: Array<{ usageTag: string; systemPrompt: string; text: string; cacheableContext: string }> = [];
  const provider: IModelProvider = {
    async generateText(input: ProviderInput): Promise<ProviderOutput> {
      calls.push({ usageTag: input.usageTag ?? '', systemPrompt: input.systemPrompt ?? '', text: input.messages?.[0]?.text ?? '', cacheableContext: input.cacheableContext ?? '' });
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
    assert.deepEqual([...offered], [TOOL, 'reimbursement.list_pending_approvals']);
  });

  it('routes who/where questions to the backlog, "me" only for the user\'s own claims, and never as a simple read', () => {
    const prompt = intakeRouterSystemPrompt({ fusedPlan: true }, false, true, false, new Set(['reimbursement.get_summary::single_metric']));
    assert.match(prompt, /whether reimbursement claims are stuck, or WHO or WHERE they are waiting — ใบเบิกค้างไหม, มีใบเบิกค้างอยู่บ้าง, ค้างที่ใคร, อยู่ที่ใคร, กองอยู่ที่ใคร, ใครยังไม่อนุมัติ, ใบไหนรอนานที่สุด — is a read with tool reimbursement\.get_approval_backlog/);
    assert.match(prompt, /claims waiting for the user themself to approve \(รอฉันอนุมัติ\) stay reimbursement\.list_pending_approvals/);
    // Run 1 (R-18 t2) sent "ที่รอสมศรี" as vendorName; runs 2-5 sent "อนุมัติแล้วยังไม่จ่าย" to get_summary with
    // paymentStatus/documentStatus it cannot take (G-03, which develop answers). Neither read may carry a state or a name.
    assert.match(prompt, /reimbursement\.get_summary, reimbursement\.list_pending_approvals and reimbursement\.get_approval_backlog take no status, payment or name filter/);
    assert.match(prompt, /a state or a person in the question \(อนุมัติแล้ว, ยังไม่จ่าย, รอจ่าย, ที่รอสมศรี\) is never a filter on them/);
    assert.match(prompt, /their only filter is requester "me" on reimbursement\.get_approval_backlog, when the user asks about their OWN claims/);
    assert.doesNotMatch(prompt, /an amount still unpaid/);
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
    assert.ok(JSON.parse(control.cacheableContext).tools.some((tool: { name: string }) => tool.name === TOOL));
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
    const question = 'การอนุมัติใบเบิกต้องทำบนเว็บค่ะ น้องมั่งมีช่วยดูรายการที่รออนุมัติให้ก่อนได้ อยากให้น้องมั่งมีสรุปให้ดูไหมคะ';
    // Runs 3 and 7 (R-06): the planner wrote "หนูมั่งมี" and "หนูช่วยดู…"; her name is the only self-reference.
    const written = question.replace('น้องมั่งมีช่วยดู', 'หนูช่วยดู').replace('ให้น้องมั่งมีสรุป', 'ให้หนูมั่งมีสรุป');
    const { provider, calls } = recordingProvider([JSON.stringify({ questions: [{ index: 0, text: written }] })]);
    const result = await runSemanticTurnV2({ req: request('อนุมัติให้หมดเลย', ['ai.tool.invoke', 'reimbursement.approve'], {}, 'write'),
      provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('no tool may run'); } });
    assert.equal(result.semanticCoverage?.[0]?.status, 'needs_user');
    assert.equal(result.replyText, question);
    // Code cannot tell a Thai statement from a question, so the ค่ะ/คะ rule lives in the planner's prompt.
    assert.match(calls[0]!.systemPrompt, /in Thai a statement ends with ค่ะ and only a question ends with คะ \(นะคะ softens a request\), never ครับ, ผม or หนู/);
  });

  it('rewrites only her own-voice "หนู", never a rat, a child, a shop or the customer\'s quoted words', () => {
    assert.equal(fixMangmeeSelfReference('หากต้องการ หนูช่วยดูรายการให้ได้เลยค่ะ'), 'หากต้องการ น้องมั่งมีช่วยดูรายการให้ได้เลยค่ะ');
    assert.equal(fixMangmeeSelfReference('ถ้าอยากให้หนูสรุปให้ บอกได้เลยค่ะ'), 'ถ้าอยากให้น้องมั่งมีสรุปให้ บอกได้เลยค่ะ');
    assert.equal(fixMangmeeSelfReference('หนูมั่งมีช่วยเช็คให้ได้ค่ะ'), 'น้องมั่งมีช่วยเช็คให้ได้ค่ะ');
    for (const kept of ['ค่ากำจัดหนูได้รับอนุมัติแล้ว 1,500 บาท', 'ยาเบื่อหนูจะหมดเดือนนี้', 'ร้านหนูนา 350 บาท',
      'น้องหนูจะมารับของพรุ่งนี้', 'ร้านไม่มีหนูไม่ต้องห่วงค่ะ', 'คุณหมายถึง “หนูขอเบิกค่าน้ำมัน” ใช่ไหมคะ']) {
      assert.equal(fixMangmeeSelfReference(kept), kept);
    }
    // The composed-answer backstop applies it too.
    assert.equal(sanitizeMangmeeComposedText('หนูขอสรุปให้นะคะ'), 'น้องมั่งมีขอสรุปให้นะคะ');
    // With the bare form off, only her name is fixed.
    assert.equal(fixMangmeeSelfReference('หนูช่วยดูให้ได้ค่ะ', false), 'หนูช่วยดูให้ได้ค่ะ');
    assert.equal(fixMangmeeSelfReference('หนูมั่งมีช่วยดูให้ได้ค่ะ', false), 'น้องมั่งมีช่วยดูให้ได้ค่ะ');
  });

  // A staff member often calls herself หนู, and หนู is a common nickname, so a bare "หนู" is hers only when nothing
  // else in the turn says it.
  it('keeps a bare "หนู" that the user or a tool result brought in, and still fixes her name', async () => {
    const asked = recordingProvider([JSON.stringify({ questions: [{ index: 0, text: 'หนูมั่งมีช่วยดูใบที่หนูขอไว้ให้ก่อนได้ อยากให้ดูไหมคะ' }] })]);
    const question = await runSemanticTurnV2({ req: request('หนูขออนุมัติใบเบิกของหนูเองได้ไหมคะ', ['ai.tool.invoke', 'reimbursement.approve'], {}, 'write'),
      provider: asked.provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { throw new Error('no tool may run'); } });
    assert.equal(question.replyText, 'น้องมั่งมีช่วยดูใบที่หนูขอไว้ให้ก่อนได้ อยากให้ดูไหมคะ');

    const nickname: ToolResult = { ...BACKLOG, data: { ...(BACKLOG.data as object), byApprover: [{ name: 'หนู', count: 1,
      totalsByCurrency: [{ currency: 'THB', amount: '500.00' }], oldestSubmittedOn: '2026-09-23', longestWaitDays: 7 }] } };
    const composed = recordingProvider([
      JSON.stringify({ calls: [{ index: 0, toolName: TOOL, input: { requester: 'me' } }], questions: [] }),
      JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'หนูยังไม่อนุมัติ 1 ใบ รอมา 7 วันค่ะ', sourceRefIds: [SOURCE_ID] }] }),
    ]);
    const answer = await runSemanticTurnV2({ req: request('ใบเบิกของฉันค้างที่ใคร', ['ai.tool.invoke', 'reimbursement.read']),
      provider: composed.provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { return nickname; } });
    assert.match(answer.replyText, /^หนูยังไม่อนุมัติ 1 ใบ รอมา 7 วันค่ะ/);
  });

  // Runs 4-7 (R-01, R-12): "ใบเบิกค้างอนุมัติรวม 8 ใบ" when 2 of the 8 were already approved and waiting for money.
  it('never calls the whole backlog total ค้างอนุมัติ when part of it is past approval', () => {
    const data = { total: 8, awaitingApprovalCount: 6 };
    assert.equal(approvalBacklogStageWording('ใบเบิกค้างอนุมัติรวม 8 ใบ (7,980 บาท) ค่ะ', data), 'ใบเบิกค้างอยู่รวม 8 ใบ (7,980 บาท) ค่ะ');
    assert.equal(approvalBacklogStageWording('ตอนนี้มีใบเบิกค้างอนุมัติทั้งหมด 8 ใบ', data), 'ตอนนี้มีใบเบิกค้างอยู่ทั้งหมด 8 ใบ');
    assert.equal(approvalBacklogStageWording('ใบเบิกรออนุมัติอยู่ 8 รายการ', data), 'ใบเบิกรออยู่ 8 รายการ');
    // A group's own count, a total that really is all awaiting approval, and a different number are left alone.
    assert.equal(approvalBacklogStageWording('ค้างอนุมัติที่สมศรี 2 ใบ', data), 'ค้างอนุมัติที่สมศรี 2 ใบ');
    assert.equal(approvalBacklogStageWording('รออนุมัติ 6 ใบ · ค้างอนุมัติ 18 ใบ', data), 'รออนุมัติ 6 ใบ · ค้างอนุมัติ 18 ใบ');
    assert.equal(approvalBacklogStageWording('ค้างอนุมัติรวม 6 ใบ', { total: 6, awaitingApprovalCount: 6 }), 'ค้างอนุมัติรวม 6 ใบ');
    assert.equal(approvalBacklogStageWording('ค้างอนุมัติรวม 1,024 ใบ', { total: 1024, awaitingApprovalCount: 1000 }), 'ค้างอยู่รวม 1,024 ใบ');
  });

  it('says "none of yours" or "none on record" for an empty backlog, by scope', () => {
    assert.equal(emptyApprovalBacklogReplyText({ total: 0, accessScope: 'own', hasOwnClaims: false }, false), 'คุณยังไม่มีใบเบิกในระบบค่ะ');
    assert.equal(emptyApprovalBacklogReplyText({ total: 0, accessScope: 'own', hasOwnClaims: true }, false), 'ตอนนี้ไม่มีใบเบิกของคุณที่รออยู่ค่ะ');
    assert.equal(emptyApprovalBacklogReplyText({ total: 0, accessScope: 'related' }, false), 'ตอนนี้ไม่มีใบเบิกที่เกี่ยวข้องกับคุณที่รออยู่ค่ะ');
    assert.equal(emptyApprovalBacklogReplyText({ total: 0, accessScope: 'company' }, false), 'ตอนนี้ไม่มีใบเบิกที่รออยู่ค่ะ');
    assert.equal(emptyApprovalBacklogReplyText({ total: 0, accessScope: 'own', hasOwnClaims: false }, true), 'You have no reimbursement claims yet.');
    assert.equal(emptyApprovalBacklogReplyText({ total: 3, accessScope: 'company' }, false), undefined);
  });

  // Run 4-7 (R-20): a manager with no claims was told "all of yours were processed"; the empty answer is never composed.
  it('answers an empty backlog without composing, and re-words a composed total that spans every stage', async () => {
    const empty: ToolResult = { ...BACKLOG, data: { accessScope: 'own', total: 0, awaitingApprovalCount: 0, totalsByCurrency: [],
      byApprover: [], sharedPile: null, desks: [], items: [], hasOwnClaims: false } };
    const quiet = recordingProvider([JSON.stringify({ calls: [{ index: 0, toolName: TOOL, input: { requester: 'me' } }], questions: [] })]);
    const none = await runSemanticTurnV2({ req: request('ใบเบิกที่ฉันยื่นไปค้างอยู่ที่ใคร', ['ai.tool.invoke', 'reimbursement.read']),
      provider: quiet.provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { return empty; } });
    assert.equal(none.replyText, 'คุณยังไม่มีใบเบิกในระบบค่ะ');
    assert.deepEqual(quiet.calls.map((call) => call.usageTag), ['line.loop']);
    assert.deepEqual(none.semanticCoverage?.[0]?.sourceRefIds, [SOURCE_ID]);

    const wide: ToolResult = { ...BACKLOG, queryApplied: { ...BACKLOG.queryApplied!, accessScope: 'company', filters: {} },
      data: { ...(BACKLOG.data as object), accessScope: 'company', total: 3, awaitingApprovalCount: 2 } };
    const composed = recordingProvider([
      JSON.stringify({ calls: [{ index: 0, toolName: TOOL, input: {} }], questions: [] }),
      JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'ใบเบิกค้างอนุมัติรวม 3 ใบ รวม 1,750 บาทค่ะ', sourceRefIds: [SOURCE_ID] }] }),
    ]);
    const result = await runSemanticTurnV2({ req: request('ใบเบิกค้างที่ใครบ้าง', ['ai.tool.invoke', 'reimbursement.read']),
      provider: composed.provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { return wide; } });
    assert.equal(result.replyText, 'ใบเบิกค้างอยู่รวม 3 ใบ รวม 1,750 บาทค่ะ');
    assert.match(composed.calls[1]!.systemPrompt, /the total spans every stage, so never call it ค้างอนุมัติ — awaitingApprovalCount is the part still waiting for an approver/);
  });
});
