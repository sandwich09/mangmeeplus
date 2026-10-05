import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLineAiInputEvidence, extractValueCandidates, parseLineAiSemanticSubrequests, type LineIntakeRouteRequest } from '@watchdog-bms/contracts';
import { INTAKE_REPAIR_HINTS } from './line-intake-compact-decision';
import { IntentRouterAgent } from './intent-router.agent';
import { runWithUsageContext } from '../../../common/usage/usage-context';
import { evidenceRefsText } from './read-tool-input';

const open = { id: 'q1', text: 'สรุปค่าใช้จ่ายร้านสมใจเดือนสิงหาคม', question: 'ปีไหนคะ', askedAt: '2026-10-05T01:00:00Z', reasonCode: 'READ_FILTER_NOT_UNDERSTOOD' };
const clause = () => ({ kind: 'read', goal: 'สรุปค่าใช้จ่าย', sources: [{ part: 0, whole: true }], filters: {} });
const answer = (sub: any = clause()) => ({ intent: 'BUSINESS_READ_QUESTION', confidence: 1, language: 'th', decisionV1: { subrequests: [sub] } });
async function request(text = 'ปี 2569', overrides: any = {}): Promise<LineIntakeRouteRequest> {
  const built = await createLineAiInputEvidence({ turnKey: 'reply', parts: [{ partId: 'part-0', rawText: text, acceptedAtMs: 1, eventIdHash: 'a'.repeat(64) }] });
  return { requestId: 'reply', companyId: 'c', userId: 'u', locale: 'th', permissions: ['ai.tool.invoke', 'expense.read'], messageText: text,
    inputEvidence: built!.inputEvidence, openClarifications: [open], ...overrides };
}
async function route(req: LineIntakeRouteRequest, output: any) {
  const sent: any[] = [], logs: any[] = [];
  const router = new IntentRouterAgent({ generateText: async (input: any) => { sent.push(JSON.parse(input.messages[0].text)); return { ok: true, text: typeof output === 'string' ? output : JSON.stringify(output) }; } });
  (router as any).logger = { log: (v: any) => logs.push(v), warn: (v: any) => logs.push(v) };
  const plan = await runWithUsageContext({ budget: { status: 'active-v2', grant: { maxTurnSlots: 4, maxRepairs: 1 } as never,
    inputDigest: req.inputEvidence!.joinedSha256, sourceRoute: 'test', calls: 0, repairCount: 0 } }, () => router.routeIntake(req));
  return { plan, sent, logs };
}
const defects: Array<[string, (out: any) => any]> = [
  ['route_json_invalid', () => '{'], ['route_object_invalid', () => 'null'], ['route_intent_invalid', o => ({ ...o, intent: 'bad' })],
  ['route_mixed_formats', o => ({ ...o, semanticSubrequests: [] })],
  ['decision_keys_invalid', o => ({ ...o, decisionV1: { ...o.decisionV1, extra: 1 } })],
  ['decision_subrequests_invalid', o => ({ ...o, decisionV1: { subrequests: [] } })],
  ...Object.entries({ clause_keys_invalid: { extra: 1 }, clause_kind_invalid: { kind: 'bad' }, clause_goal_invalid: { goal: '' },
    sources_invalid: { sources: [] }, source_keys_invalid: { sources: [{ part: 0, extra: 1 }] }, source_part_invalid: { sources: [{ part: 'bad', whole: true }] },
    source_part_missing: { sources: [{ part: 9, whole: true }] }, source_selector_invalid: { sources: [{ part: 0, whole: true, quote: 'ปี' }] },
    source_quote_invalid: { sources: [{ part: 0, quote: '' }] }, source_quote_not_found: { sources: [{ part: 0, quote: 'หายไป' }] },
    source_quote_not_unique: { sources: [{ part: 0, quote: '6' }] }, filters_shape_invalid: { filters: [] }, filters_key_invalid: { filters: { constructor: 1 } },
    filter_unknown: { filters: { madeUp: 1 } }, filter_value_invalid: { filters: { fromDate: [] } }, required_evidence_invalid: { requiredEvidence: 'bad' },
    dependencies_invalid: { dependsOn: 'bad' }, entity_shape_invalid: { entity: 42 }, entity_not_in_text: { entity: 'หายไป' },
    taskref_malformed: { taskRef: 'task' }, semantic_contract_invalid: { requiredEvidence: ['!'] },
  }).map(([reason, patch]) => [reason, (o: any) => ({ ...o, decisionV1: { subrequests: [{ ...clause(), ...patch }] } })] as [string, (o: any) => any]),
  ['route_semantic_invalid', o => { delete o.decisionV1; return o; }],
  ['route_reimbursement_not_offered', o => ({ ...o, intent: 'REIMBURSEMENT_REQUEST_START' })],
  ['route_advisor_not_offered', o => ({ ...o, intent: 'ADVISOR_CONVERSATION' })],
  ['route_capture_hint_too_long', o => ({ ...o, intent: 'EXPENSE_DOCUMENT_CAPTURE', captureHints: { description: 'x'.repeat(5000) } })],
  ['route_capture_items_too_many', o => ({ ...o, intent: 'EXPENSE_DOCUMENT_CAPTURE', captureHints: { items: Array(21).fill({}) } })],
  ['route_capture_item_too_long', o => ({ ...o, intent: 'EXPENSE_DOCUMENT_CAPTURE', captureHints: { items: [{ description: 'x'.repeat(201) }] } })],
  ['route_document_invalid', o => ({ ...o, documentClassification: {} })],
  ['route_document_missing', o => ({ ...o, intent: 'BUSINESS_DOCUMENT_REFERENCE' })],
];
describe('reply routing defects', () => {
  for (const [reason, mutate] of defects) it(reason, async () => {
    const { plan, sent, logs } = await route(await request('ปี 2669'), mutate(answer()));
    assert.equal(plan.errorCode, 'ROUTER_SEMANTIC_SCHEMA_INVALID');
    assert.equal(sent.length, 2);
    assert.match(sent[1].schemaRepair, new RegExp(reason));
    assert.ok(sent[1].schemaRepair.includes(INTAKE_REPAIR_HINTS[reason as keyof typeof INTAKE_REPAIR_HINTS]));
    assert.deepEqual(logs.filter(l => l.msg === 'line.intake_route.compact_decode' && l.outcome === 'invalid').map(l => [l.rejection, l.attempt]), [[reason, 1], [reason, 2]]);
    assert.equal(logs.at(-1).rejection, reason); assert.equal(logs.at(-1).attempt, 2);
    assert.ok(!JSON.stringify(logs).includes('ปี 2669'));
  });
});
describe('original question evidence', () => {
  for (const kind of ['read', 'general', 'help', 'write', 'file', 'public']) it(`original quote and entity: ${kind}`, async () => {
    const req = await request();
    const { plan } = await route(req, { ...answer({ ...clause(), kind, sources: [{ part: 0, quote: 'สรุปค่าใช้จ่าย' }], entity: 'ร้านสมใจ' }), resolvedClarificationIds: ['q1'] });
    if (['write', 'file', 'public'].includes(kind)) { assert.equal(plan.status, 'UNAVAILABLE'); return; }
    assert.equal(plan.status, 'ROUTED'); assert.deepEqual(plan.resolvedClarificationIds, ['q1']);
    assert.equal(plan.semanticSubrequests![0].entityReference!.value, 'ร้านสมใจ');
    assert.equal(evidenceRefsText(plan.semanticSubrequests![0].evidenceRefs, req.inputEvidence, req.messageText), req.messageText);
    assert.ok(parseLineAiSemanticSubrequests(plan.semanticSubrequests, req.messageText, req.inputEvidence, [open] as never));
  });
  for (const ids of [undefined, ['q2'], ['not-offered']]) it(`two questions never use the unselected question: ${ids}`, async () => {
    const { plan } = await route(await request('ปี 2569', { openClarifications: [open, { ...open, id: 'q2', text: 'ยอดขาย' }] }),
      { ...answer({ ...clause(), sources: [{ part: 0, quote: 'สรุปค่าใช้จ่าย' }] }), resolvedClarificationIds: ids });
    assert.equal(plan.status, 'UNAVAILABLE');
  });
  it('two questions accept only the selected original', async () => {
    const { plan } = await route(await request('ปี 2569', { openClarifications: [open, { ...open, id: 'q2', text: 'ยอดขาย' }] }),
      { ...answer({ ...clause(), sources: [{ part: 0, quote: 'สรุปค่าใช้จ่าย' }] }), resolvedClarificationIds: ['q1'] });
    assert.equal(plan.status, 'ROUTED');
  });
});
function periods(spans: string[]) { return { amounts: [], dates: [], periods: spans.map((span, i) => ({ span, kind: 'month', fromDate: `2026-0${i + 8}-01`, toDate: `2026-0${i + 8}-28`, source: 'named_month', label: span, assumptions: [] })) }; }
describe('period-only reply', () => {
  // The owner's own two replies on LINE UAT (2026-10-05 15:05, 15:07), read by the REAL period reader: both were
  // answered with an apology after two model calls. They are one period each, so no model is asked at all.
  for (const [text, fromDate, toDate] of [['สิงหา ถึง ตค', '2026-08-01', '2026-10-05'], ['ปี 2569', '2026-01-01', '2026-10-05'],
    ['3 เดือนล่าสุด', '2026-07-01', '2026-09-30'], ['ปี 69', '2026-01-01', '2026-10-05']] as const) it(`the owner's reply, real reader: ${text}`, async () => {
    const { plan, sent } = await route(await request(text, { valueCandidates: extractValueCandidates(text, '2026-10-05') }), answer());
    assert.equal(sent.length, 0);
    assert.deepEqual(plan.resolvedClarificationIds, ['q1']);
    assert.deepEqual(plan.semanticSubrequests!.map(sub => [sub.kind, sub.requestedFilters]), [['read', { fromDate, toDate }]]);
  });
  for (const [text, spans] of [['ปี 2569', ['ปี 2569']], ['เดือนที่แล้วครับ', ['เดือนที่แล้ว']], ['ของเดือนสิงหาค่ะ', ['เดือนสิงหา']], ['ส.ค. 69', ['ส.ค. 69']], ['ส.ค. ก.ย.', ['ส.ค.', 'ก.ย.']]] as const) it(text, async () => {
    const { plan, sent } = await route(await request(text, { valueCandidates: periods([...spans]) }), answer());
    assert.equal(sent.length, 0); assert.equal(plan.intent, 'BUSINESS_READ_QUESTION'); assert.deepEqual(plan.resolvedClarificationIds, ['q1']);
    assert.equal(plan.semanticSubrequests!.length, spans.length);
    for (const [i, sub] of plan.semanticSubrequests!.entries()) { assert.equal(sub.kind, 'read'); assert.ok(sub.goal.includes(open.text)); assert.ok(sub.goal.includes(text)); assert.deepEqual(sub.requestedFilters, { fromDate: `2026-0${i+8}-01`, toDate: `2026-0${i+8}-28` }); }
  });
  for (const [label, text, extra] of [
    ['new read', 'ยอดขายเดือนนี้', {}], ['new request', 'สิงหาจ่ายค่าเช่าเท่าไหร่', {}], ['attachment', 'เดือนนี้', { attachments: [{ id: 'a', mimeType: 'image/png' }] }],
    ['intake clarify', 'เดือนนี้', { openClarifications: [{ ...open, clarifyForIntent: 'EXPENSE_DOCUMENT_CAPTURE' }] }],
    ['two questions', 'เดือนนี้', { openClarifications: [open, { ...open, id: 'q2' }] }], ['no question', 'เดือนนี้', { openClarifications: [] }],
    ['unmarked', 'เดือนนี้', { openClarifications: [{ ...open, reasonCode: undefined }] }], ['media question', 'เดือนนี้', { openClarifications: [{ ...open, pendingMedia: {} }] }],
    ['candidate question', 'เดือนนี้', { openClarifications: [{ ...open, candidateExpenseIds: [] }] }],
    ['range connector', 'เดือนนี้ถึงเดือนนี้', {}], ['list connector', 'เดือนนี้และเดือนนี้', {}], ['hyphen', 'เดือนนี้-เดือนนี้', {}],
    ['ambiguous', 'เดือนนี้', { valueCandidates: { ...periods(['เดือนนี้']), periods: [{ ...periods(['เดือนนี้']).periods[0], assumptions: ['ambiguous_two_digit_year'] }] } }],
  ] as const) it(`model fallback: ${label}`, async () => {
    const { sent } = await route(await request(text, { valueCandidates: periods(['เดือนนี้']), ...extra }), answer()); assert.equal(sent.length, 1);
  });
});

describe('continued read downstream contracts', () => {
  for (const lane of ['strands-local', 'agentcore']) it(`keeps original entity and selected question through ${lane}`, async () => {
    const { AI_BUDGET_PROFILE_TABLE_DIGEST_V2 } = await import('@watchdog-bms/contracts');
    const { LineAiTurnUseCase } = await import('../application/use-cases/line-ai-turn.use-case');
    const { validatePayload, payloadToTurnRequest } = await import('../../../agentcore/runtime');
    const req = await request();
    const { plan } = await route(req, { ...answer({ ...clause(), sources: [{ part: 0, quote: 'สรุปค่าใช้จ่าย' }], entity: 'ร้านสมใจ' }), resolvedClarificationIds: ['q1'] });
    const grant = { version: 2, turnKey: req.inputEvidence!.turnKey, authorityKind: 'webhook_event', authorityId: 'event', channelOwnerDigest: 'b'.repeat(64),
      attemptKey: 'attempt', monthKey: '2026-10', payerCompanyId: 'c', model: { provider: 'bedrock', modelId: 'apac.anthropic.claude-3-haiku-20240307-v1:0', region: 'ap-southeast-1' },
      allowedProfileIds: ['line-intake-text/2'], profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2, maxTurnSlots: 4, maxRepairs: 1,
      admittedAtMs: 1, workDeadlineAtMs: 10000, finalDeadlineAtMs: 20000, nonce: 'nonce', issuerVersion: 'api-1', signature: 'c'.repeat(64) } as const;
    let received: any;
    const check = (turn: any) => { received = turn; assert.equal(turn.semanticSubrequests[0].entityReference.value, 'ร้านสมใจ');
      assert.deepEqual(turn.resolvedClarificationIds, ['q1']); assert.equal(turn.openClarifications[0].reasonCode, 'READ_FILTER_NOT_UNDERSTOOD'); };
    const result = { plan: { status: 'ROUTABLE', language: 'th', intents: [], refusals: [], requiresHumanReview: false }, outputs: [],
      replyText: 'อ่านค่าใช้จ่ายแล้วค่ะ', sourceRefs: [], webLinks: [], durationMs: 1, semanticCoverage: [{ index: 0, status: 'handled' }] };
    const useCase = new LineAiTurnUseCase({} as any, { run: async (turn: any) => { check(turn); return result; } } as any,
      { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: lane } as any, { invoke: async (payload: any) => {
        const parsed = validatePayload(payload); assert.ok(parsed); check(payloadToTurnRequest(parsed));
        return { ...result, toolsInvoked: [], refused: false };
      } } as any);
    const response = await runWithUsageContext({ budget: { status: 'active-v2', grant: grant as any, inputDigest: req.inputEvidence!.joinedSha256,
      sourceRoute: 'test', calls: 0, repairCount: 0 } }, () => useCase.execute({
        requestId: req.requestId, webhookEventId: 'event', messageText: req.messageText, messagePreviewHash: '', inputEvidence: req.inputEvidence,
        contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'], budgetGrantV2: grant as any,
        userContext: { lineUserId: '', internalUserId: 'u', companyId: 'c', membershipId: 'm', locale: 'th', roles: [], permissions: [] },
        openClarifications: req.openClarifications, resolvedClarificationIds: plan.resolvedClarificationIds, semanticSubrequests: plan.semanticSubrequests,
      }));
    assert.equal(response.errorCode, undefined); assert.ok(received);
    assert.equal(evidenceRefsText(received.semanticSubrequests[0].evidenceRefs, received.inputEvidence, received.messageText), 'ปี 2569');
  });
});

describe('remaining route rejection diagnostics', () => {
  it('route_retained_source_mismatch', async () => {
    const req = await request();
    const part = req.inputEvidence!.parts[0]!;
    req.retainedTaskSource = { taskRef: { taskId: 'task-1', taskRevision: 1, subrequestIndex: 0 }, inputEvidence: req.inputEvidence!,
      semanticSubrequest: { index: 0, kind: 'write', writeIntent: 'EXPENSE_DOCUMENT_CAPTURE', goal: 'บันทึกค่าใช้จ่าย', requiredEvidence: [], requestedFilters: {}, dependsOn: [],
        evidenceRefs: [{ partId: part.partId, startUtf16: 0, endUtf16: part.rawText.length, rawSha256: part.rawSha256 }] } };
    req.taskProjection = { version: 2, stateVersion: 1, lifecycleEpoch: 0, expiresAtMs: Date.now() + 60000,
      tasks: [{ taskId: 'task-1', revision: 1, kind: 'write', state: 'paused', userGoal: 'บันทึกค่าใช้จ่าย', subrequests: [{ index: 0, kind: 'write', goal: 'บันทึกค่าใช้จ่าย', status: 'pending' }] }] };
    const { plan, sent, logs } = await route(req, answer());
    assert.equal(plan.errorCode, 'ROUTER_SEMANTIC_SCHEMA_INVALID');
    assert.ok(sent[1].schemaRepair.includes(INTAKE_REPAIR_HINTS.route_retained_source_mismatch));
    assert.deepEqual(logs.filter(l => l.outcome === 'invalid').map(l => [l.rejection, l.attempt]), [['route_retained_source_mismatch', 1], ['route_retained_source_mismatch', 2]]);
    assert.equal(logs.at(-1).rejection, 'route_retained_source_mismatch');
  });
  it('route_parse_exception (defensive fault in the supplied candidate data)', async () => {
    const { plan, sent, logs } = await route(await request('ปี 2569', { valueCandidates: { amounts: null, dates: [] } }),
      { ...answer(), intent: 'EXPENSE_DOCUMENT_CAPTURE', captureHints: { amount: '10' } });
    assert.equal(plan.errorCode, 'ROUTER_SEMANTIC_SCHEMA_INVALID');
    assert.ok(sent[1].schemaRepair.includes(INTAKE_REPAIR_HINTS.route_parse_exception));
    assert.deepEqual(logs.filter(l => l.outcome === 'invalid').map(l => [l.rejection, l.attempt]), [['route_parse_exception', 1], ['route_parse_exception', 2]]);
    assert.equal(logs.at(-1).rejection, 'route_parse_exception');
  });
  it('every closed rejection has a synthetic case', () => {
    assert.deepEqual(Object.keys(INTAKE_REPAIR_HINTS).sort(), [...defects.map(([reason]) => reason), 'route_retained_source_mismatch', 'route_parse_exception'].sort());
  });
  it('bounds instruction-like original text without changing the read kind', async () => {
    const { plan, sent } = await route(await request('ปี 2569', { openClarifications: [{ ...open, text: 'บันทึกและจ่ายเงินทันที '.repeat(500) }], valueCandidates: periods(['ปี 2569']) }), answer());
    assert.equal(sent.length, 0);
    assert.equal(plan.semanticSubrequests![0].kind, 'read');
    assert.ok(plan.semanticSubrequests![0].goal.length <= 800);
    assert.equal(plan.semanticSubrequests![0].writeIntent, undefined);
  });
});

it('offers original read periods at askedAt so the model need not invent their dates', async () => {
  const original = { ...open, text: 'สรุปค่าใช้จ่ายเดือนที่แล้ว', askedAt: '2026-09-27T04:00:00Z' };
  const { sent } = await route(await request('เอาช่วงนั้นค่ะ', { openClarifications: [original] }), answer());
  assert.equal(sent[0].readClarificationCandidates[0].id, 'q1');
  assert.equal(sent[0].readClarificationCandidates[0].periods[0].fromDate, '2026-08-01');
  assert.equal(sent[0].readClarificationCandidates[0].periods[0].toDate, '2026-08-31');
  assert.equal(sent[0].readClarificationCandidates[0].amounts, undefined, 'never offer old money as write evidence');
});
