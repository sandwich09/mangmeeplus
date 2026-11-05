/**
 * Focused specs for the C1 (numeric-grounding) and C2 (control-round `questions` omission) fixes
 * in semantic-turn-v2.ts. Fixture numbers are copied from the real-model eval evidence for scenario
 * `B-auditor-paraphrases` turn 1 ("ขอดู confirmed เดือนนี้หน่อยค่ะ" -> expense.list_recent CONFIRMED,
 * total 8, 8,703 บาท, paid 5,255.50, outstanding 3,447.50) — never read from /private/tmp.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractValueCandidates, type LineAiTurnRequest, type ToolResult } from '@watchdog-bms/contracts';
import type { IModelProvider, ProviderInput, ProviderOutput } from '../infrastructure/provider/provider.port';
import { runSemanticTurnV2 } from './semantic-turn-v2';
import { activeProductHelpPack } from './approved-product-help';
import { knowledgePackHash } from './approved-knowledge';

describe('PWS-FOLLOW-SIMPLER reviewed product help', () => {
  const pack = activeProductHelpPack();
  const card = (id: string) => pack.cards.find(card => card.id === id)!;
  async function follow(text = 'ไม่เข้าใจ', ids = ['expense.status'], answer = 'สถานะเอกสารบอกการตรวจ ส่วนสถานะการจ่ายบอกว่าจ่ายให้ผู้ขายหรือยังค่ะ',
    options: { memory?: boolean; version?: number; permissions?: string[]; features?: string[]; approved?: boolean } = {}) {
    const req = request();
    req.messageText = text;
    req.approvedKnowledge = options.approved ?? true;
    req.selectedKnowledgeCardIds = ['shop.open']; // The exact follow-up resolves the remembered answer instead.
    req.userContext.permissions = options.permissions ?? [...new Set(['line.ai.query', ...pack.cards.flatMap(card => [...card.permissionAnyOf, ...card.requiredPermissions])])];
    req.entitledFeatureKeys = options.features ?? [...new Set(pack.cards.flatMap(card => card.featureKeys))];
    req.semanticSubrequests = [{ index: 0, kind: 'general', goal: text, requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }];
    req.conversationContext = { windowMinutes: 15, maxTurns: 15, recentTurns: [],
      ...(options.memory === false ? {} : { lastKnowledgeCards: ids.map(id => ({ id, version: options.version ?? card(id).version })) }) };
    const calls: ProviderInput[] = [];
    const result = await runSemanticTurnV2({ req,
      provider: { generateText: async input => {
        calls.push(input);
        return { ok: true, text: JSON.stringify({ answers: ids.map((id, index) => ({ index, status: 'handled', text: answer,
          sourceRefIds: [`knowledge:approved_product_help:${pack.id}:${pack.version}:${id}:${card(id).version}`] })) }) };
      } }, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      invoke: async () => assert.fail('a help follow-up cannot read or prepare an action') });
    return { result, calls };
  }

  it('PWS-FOLLOW-SIMPLER card answer then ไม่เข้าใจ explains the same card with its title and one existing compose call', async () => {
    const first = await runSemanticTurnV2({ req: { ...request(), messageText: 'ยืนยันแล้วแปลว่าจ่ายแล้วไหม', approvedKnowledge: true,
      selectedKnowledgeCardIds: ['expense.status'], entitledFeatureKeys: ['expenses'],
      semanticSubrequests: [{ index: 0, kind: 'help', goal: 'สถานะเอกสาร', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }] },
      provider: { generateText: async () => assert.fail('the first reviewed answer is deterministic') },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      invoke: async () => assert.fail('the first reviewed answer needs no tool') });
    assert.equal(first.replyText, `${card('expense.status').title}\n${card('expense.status').body}`);
    const { result, calls } = await follow();
    assert.equal(result.replyText, `${card('expense.status').title}\nสถานะเอกสารบอกการตรวจ ส่วนสถานะการจ่ายบอกว่าจ่ายให้ผู้ขายหรือยังค่ะ`);
    assert.equal(result.presentation?.cards[0]?.title, card('expense.status').title);
    assert.equal(result.presentation?.cards[0]?.chatActionId, undefined);
    assert.equal(result.presentation?.cards[0]?.chatActionIds, undefined);
    assert.deepEqual(calls.map(call => call.usageTag), ['line.compose']);
    assert.equal(JSON.parse(calls[0]!.messages[0]!.text).approvedHelpFollowUp.style, 'simpler');
  });

  it('PWS-FOLLOW-SIMPLER matches only the seven whole follow-ups with spaces and polite endings', async () => {
    for (const text of ['ไม่เข้าใจ', 'หมายความว่าไง', 'งง ค่ะ', 'อธิบาย อีก ที ครับ', 'ง่าย กว่า นี้ นะคะ', 'แปลว่าอะไรคะ', 'ยกตัวอย่าง']) {
      const { result } = await follow(text);
      assert.ok(result.replyText.startsWith(`${card('expense.status').title}\n`), text);
    }
    for (const text of ['ไม่เข้าใจ แล้วค่าใช้จ่ายเดือนนี้เท่าไหร่', 'ช่วยยกตัวอย่างการลบข้อมูล', 'งงเรื่องอื่น']) {
      const { calls } = await follow(text);
      assert.equal(JSON.parse(calls[0]!.messages[0]!.text).approvedHelpFollowUp, undefined, text);
    }
  });

  it('PWS-FOLLOW-SIMPLER requires memory, exact current version, eligibility and API admission', async () => {
    for (const options of [{ memory: false }, { version: 999 }, { permissions: [] }, { features: [] }, { approved: false }]) {
      const { calls } = await follow('ไม่เข้าใจ', ['expense.status'], 'คำตอบทั่วไปค่ะ', options);
      assert.equal(JSON.parse(calls[0]!.messages[0]!.text).approvedHelpFollowUp, undefined, JSON.stringify(options));
    }
  });

  it('PWS-FOLLOW-SIMPLER drops a card retired before the render recheck from compose DATA', async () => {
    const original = structuredClone(pack);
    queueMicrotask(() => { pack.status = 'RETIRED'; pack.contentHash = knowledgePackHash(pack); });
    try {
      const { result, calls } = await follow();
      assert.equal(JSON.parse(calls[0]!.messages[0]!.text).approvedHelpFollowUp, undefined);
      assert.deepEqual(result.sourceRefs, []);
      assert.notEqual(result.semanticCoverage?.[0]?.status, 'handled');
    } finally { Object.assign(pack, original); }
  });

  it('PWS-FOLLOW-SIMPLER derives allowed numbers and dates only from the selected card text', async () => {
    const text = 'ค่าบริการที่จ่ายถึง 31 ธ.ค. 2570 หัก 1% ค่ะ';
    const { result, calls } = await follow('ยกตัวอย่างค่ะ', ['wht.e-wht'], text);
    assert.equal(result.replyText, `${card('wht.e-wht').title}\n${text}`);
    assert.equal(JSON.parse(calls[0]!.messages[0]!.text).approvedHelpFollowUp.style, 'example');
  });

  it('PWS-FOLLOW-SIMPLER an out-of-card number or date falls back to the summary as written', async () => {
    for (const text of ['หัก 999999 บาทค่ะ', 'หัก ๙๙๙๙๙๙ บาทค่ะ', 'หัก 2% ค่ะ', 'จ่ายถึง 31 ธ.ค. 2571 ค่ะ', 'จ่ายถึง 31 มกราคม 2570 ค่ะ']) {
      const { result, calls } = await follow('ง่ายกว่านี้', ['wht.e-wht'], text);
      assert.equal(result.replyText, `${card('wht.e-wht').title}\n${card('wht.e-wht').summary}`, text);
      assert.equal(calls.length, 1, 'failed rewriting never starts another model call');
    }
  });

  it('PWS-FOLLOW-SIMPLER new action, promise or completed write falls back to the summary', async () => {
    for (const text of ['กดปุ่มลบข้อมูลทั้งหมดค่ะ', 'ระบบคืนเงินให้แน่นอนค่ะ', 'บันทึกจ่ายให้แล้วค่ะ']) {
      const { result } = await follow('ไม่เข้าใจ', ['expense.status'], text);
      assert.equal(result.replyText, `${card('expense.status').title}\n${card('expense.status').summary}`, text);
      assert.deepEqual(result.outputs, []);
      assert.equal(result.presentation?.cards[0]?.chatActionId, undefined);
    }
  });

  it('PWS-FOLLOW-SIMPLER example without numbers preserves the body steps in their reviewed order with zero model calls', async () => {
    const { result, calls } = await follow('ยกตัวอย่างหน่อยค่ะ', ['voucher.create']);
    assert.equal(result.replyText, `${card('voucher.create').title}\n${card('voucher.create').body}`);
    assert.equal(calls.length, 0);
  });

  it('PWS-FOLLOW-SIMPLER multiple remembered cards are grounded independently', async () => {
    const { result } = await follow('ง่ายกว่านี้', ['expense.status', 'wht.e-wht'], 'หัก 1% ค่ะ');
    assert.equal(result.presentation?.cards[0]?.text, card('expense.status').summary);
    assert.equal(result.presentation?.cards[1]?.title, card('wht.e-wht').title);
    assert.equal(result.presentation?.cards[1]?.text, 'หัก 1% ค่ะ');
    assert.equal(result.semanticCoverage?.length, 1, 'several cards still answer the one accepted follow-up clause');
  });
});

const MESSAGE_TEXT = 'ขอดู confirmed เดือนนี้หน่อยค่ะ';
const TODAY = '2026-09-28';

const SOURCE_REF = {
  label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary',
  asOf: '2026-09-27T18:20:29.656Z', permissionChecked: true as const,
  webPath: '/companies/company/expenses',
};

/** The real tool result: `facts` carries ONLY the grand total (erp-tools.use-case.ts's own
 *  behavior) — everything else (count, per-item amounts/dates, the paid/unpaid split) lives only
 *  in `data`, which is exactly the gap C1(a)/(b) closes. */
function listRecentConfirmedResult(): ToolResult {
  return {
    toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-27T18:20:29.656Z',
    sourceRefs: [SOURCE_REF],
    queryApplied: {
      timezone: 'Asia/Bangkok', period: { startDate: '2026-09-01', endDate: '2026-09-28', timezone: 'Asia/Bangkok', defaulted: false },
      dateBasis: 'expense_incurred_date', statusBasis: 'CONFIRMED', dataset: 'operational_expense_records',
    },
    facts: [{
      id: 'expense.total.THB', metric: 'expense_total', value: '8703', unit: 'money', currency: 'THB',
      period: { startDate: '2026-09-01', endDate: '2026-09-28', timezone: 'Asia/Bangkok' },
      dateBasis: 'expense_incurred_date', statusBasis: 'CONFIRMED',
      sourceRefIds: ['expenses:expense_summary:summary'], asOf: '2026-09-27T18:20:29.656Z', state: 'known',
    }],
    data: {
      total: 8,
      period: { fromDate: '2026-09-01', toDate: '2026-09-28', defaultedToCurrentMonth: false },
      summary: {
        countedItems: 8, cancelledCount: 0, totalAmount: '8703', pendingAmount: '0', draftAmount: '0',
        confirmedAmount: '8703', paidAmount: '5255.5', unpaidAmount: '3447.5',
      },
      totalsByCurrency: [{ currency: 'THB', count: 8, totalAmount: '8703', paidAmount: '5255.5', outstandingAmount: '3447.5' }],
      items: [
        { id: 'e1', expenseDate: '2026-09-01T00:00:00.000Z', vendorNameSnapshot: 'ร้านสมใจ', status: 'CONFIRMED', paymentStatus: 'PAID', grandTotalAmount: '300.5' },
        { id: 'e2', expenseDate: '2026-09-02T00:00:00.000Z', vendorNameSnapshot: 'ร้านสมใจการค้า', status: 'CONFIRMED', paymentStatus: 'PARTIALLY_PAID', grandTotalAmount: '437' },
        { id: 'e3', expenseDate: '2026-09-03T00:00:00.000Z', vendorNameSnapshot: 'ปั๊มน้ำมัน ปตท.', status: 'CONFIRMED', paymentStatus: 'UNPAID', grandTotalAmount: '574' },
        { id: 'e4', expenseDate: '2026-09-06T00:00:00.000Z', vendorNameSnapshot: 'Grab', status: 'CONFIRMED', paymentStatus: 'UNPAID', grandTotalAmount: '985' },
        { id: 'e5', expenseDate: '2026-09-07T00:00:00.000Z', vendorNameSnapshot: null, status: 'CONFIRMED', paymentStatus: 'PAID', grandTotalAmount: '1122' },
        { id: 'e6', expenseDate: '2026-09-08T00:00:00.000Z', vendorNameSnapshot: 'ร้านสมใจ', status: 'CONFIRMED', paymentStatus: 'PARTIALLY_PAID', grandTotalAmount: '1259' },
        { id: 'e7', expenseDate: '2026-09-13T00:00:00.000Z', vendorNameSnapshot: 'Grab', status: 'CONFIRMED', paymentStatus: 'PAID', grandTotalAmount: '1944.5' },
        { id: 'e8', expenseDate: '2026-09-14T00:00:00.000Z', vendorNameSnapshot: null, status: 'CONFIRMED', paymentStatus: 'PARTIALLY_PAID', grandTotalAmount: '2081' },
      ],
    },
  };
}

function request(): LineAiTurnRequest {
  const valueCandidates = extractValueCandidates(MESSAGE_TEXT, TODAY);
  return {
    requestId: 'request-1', webhookEventId: 'event-1', messageText: MESSAGE_TEXT,
    messagePreviewHash: 'd'.repeat(16), valueCandidates,
    semanticSubrequests: [{
      index: 0, kind: 'read', goal: 'รายการค่าใช้จ่ายที่ยืนยันแล้วเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
      requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28', documentStatus: 'CONFIRMED' },
    }],
    userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
      permissions: ['expense.read'], roles: ['owner'], branchIds: [], locationIds: [], locale: 'th-TH' },
  };
}

const CONTROL_CALL = JSON.stringify({
  calls: [{ index: 0, toolName: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-28', documentStatus: 'CONFIRMED' } }],
  // deliberately no "questions" key — see C2 test below
});

function answerEnvelope(text: string, opts: { status?: string; sourceRefIds?: string[] } = {}) {
  return JSON.stringify({ answers: [{ index: 0, status: opts.status ?? 'handled', text, sourceRefIds: opts.sourceRefIds ?? ['expenses:expense_summary:summary'] }] });
}

async function run(controls: string[], invokeResult: ToolResult = listRecentConfirmedResult(), enabledDeterministicFamilies?: ReadonlySet<string>) {
  const queue = [...controls];
  const invoked: string[] = [];
  const provider: IModelProvider = { async generateText(_input: ProviderInput): Promise<ProviderOutput> {
    return { ok: true, text: queue.shift() ?? '{}' };
  } };
  const result = await runSemanticTurnV2({
    req: request(), provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
    publicLookupEnabled: false, approvedKnowledgeEnabled: false, enabledDeterministicFamilies,
    async invoke(meta): Promise<ToolResult> { invoked.push(meta.name); return invokeResult; },
  });
  return { result, invoked };
}

describe('semantic turn v2: C2 control round tolerates a missing "questions" key', () => {
  it('still executes the proposed call instead of forcing SEMANTIC_CONTROL_UNAVAILABLE with zero calls', async () => {
    const { result, invoked } = await run([CONTROL_CALL, answerEnvelope('ค่าใช้จ่ายยืนยันแล้วเดือนนี้ 8,703 บาท (8 รายการ) จ่ายแล้ว 5,255.50 บาท ค้างชำระ 3,447.50 บาท')]);
    assert.deepEqual(invoked, ['expense.list_recent']);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'SEMANTIC_CONTROL_UNAVAILABLE');
  });

  it('still rejects a genuinely malformed control round, and terminally (not needs_user)', async () => {
    const { result, invoked } = await run(['{"calls":"not-an-array"}']);
    assert.deepEqual(invoked, []);
    assert.equal(result.semanticCoverage?.[0]?.status, 'unsupported');
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'SEMANTIC_CONTROL_UNAVAILABLE');
  });
});

describe('semantic turn v2: C1(a)/(b) numbers derivable from the full tool result are grounded', () => {
  it('accepts the record count, per-item amounts, and the paid/unpaid split — none of which are in `facts`', async () => {
    const text = 'ค่าใช้จ่ายยืนยันแล้วเดือนนี้ 8,703 บาท (8 รายการ) จ่ายแล้ว 5,255.50 บาท ค้างชำระ 3,447.50 บาท เช่น 300.50, 437, 574, 985, 1,122, 1,259, 1,944.50, 2,081 บาท';
    const { result } = await run([CONTROL_CALL, answerEnvelope(text)]);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.ok(result.replyText.includes('8,703'));
    assert.ok(result.replyText.includes('5,255.50'));
    assert.ok(result.replyText.includes('3,447.50'));
  });

  it('accepts the Buddhist-era year (+543) for a date the tool only carries in CE', async () => {
    const text = 'ค่าใช้จ่ายยืนยันแล้วเดือนกันยายน 2569 รวม 8,703 บาท (8 รายการ)';
    const { result } = await run([CONTROL_CALL, answerEnvelope(text)]);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.ok(result.replyText.includes('2569'));
  });

  it('still rejects an invented/approximate number no tool result contains', async () => {
    const text = 'ค่าใช้จ่ายยืนยันแล้วเดือนนี้ 8,703 บาท ยังค้างชำระอีกเกือบ 3,500 บาทนะคะ';
    const { result } = await run([CONTROL_CALL, answerEnvelope(text)]);
    assert.notEqual(result.semanticCoverage?.[0]?.status, 'handled');
    assert.ok(!result.replyText.includes('3,500'));
    assert.ok(!result.replyText.includes('3500'));
  });
});

describe('semantic turn v2: C1(c)/(d) grounding-exhausted fallback is never a dead end', () => {
  const INVENTED = 'ค่าใช้จ่ายยืนยันแล้วเดือนนี้ ยังค้างชำระอีกเกือบ 3,500 บาทนะคะ';

  it('renders the verified deterministic formatter when its family is enabled, never `needs_user`', async () => {
    const { result } = await run([CONTROL_CALL, answerEnvelope(INVENTED)], listRecentConfirmedResult(),
      new Set(['expense.list_recent::single_metric', 'expense.list_recent::list']));
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'handled');
    assert.equal(coverage?.reasonCode, 'DETERMINISTIC_FALLBACK_RENDERED');
    assert.ok(result.replyText.includes('8,703'), result.replyText);
    assert.ok(!result.replyText.includes('3,500'));
  });

  it('falls back to the honest §8 terminal (not needs_user) when no deterministic family is enabled', async () => {
    const { result } = await run([CONTROL_CALL, answerEnvelope(INVENTED)]);
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'unsupported');
    assert.notEqual(coverage?.status, 'needs_user');
    assert.equal(coverage?.reasonCode, 'ANSWER_NUMBER_NOT_GROUNDED');
    assert.ok(result.replyText.includes('ดึงข้อมูลส่วนนี้ไม่ได้'));
  });

  // E3 (tuning-6a) changed this scenario's outcome on purpose: a single-subrequest read with good
  // results now RESCUES a non-JSON compose response as `handled` (run 5: 24/77 compose calls
  // answered in plain prose) rather than silently dropping it — it still runs the same grounding
  // check any composed answer gets, and a bare placeholder string has no numbers to reject, so it
  // grounds exactly as it would had the model wrapped this same text in valid JSON. The property
  // this test still guards (R-L2/R-L3) is unchanged: never a phantom `needs_user`.
  it('rescues a non-JSON compose response as `handled` rather than leaving it `needs_user`', async () => {
    const { result } = await run([CONTROL_CALL, 'this is not json', 'still not json']);
    const coverage = result.semanticCoverage?.[0];
    assert.notEqual(coverage?.status, 'needs_user');
    assert.equal(coverage?.status, 'handled');
    assert.ok(result.replyText.includes('this is not json'), result.replyText);
  });
});

describe('item 3 (223-turn eval batch 2): a two-period comparison is answered with code-computed facts', () => {
  const CMP_SOURCE_REF = { label: 'สรุปค่าใช้จ่ายแยกกลุ่ม', module: 'expenses', entityType: 'expense_breakdown',
    asOf: '2026-09-27T18:20:29.656Z', permissionChecked: true as const, webPath: '/companies/company/expenses' };

  function breakdownResult(fromDate: string, toDate: string, totalAmount: string, totalCount: number): ToolResult {
    return { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [CMP_SOURCE_REF],
      data: { period: { fromDate, toDate, defaultedToCurrentMonth: false }, totalCount, totalAmount, currency: 'THB',
        totalsByCurrency: [{ currency: 'THB', count: totalCount, totalAmount }], mixedCurrency: false,
        byCategory: [{ categoryId: null, category: 'ค่าบริการ', currency: 'THB', count: 3, totalAmount }],
        byBranch: [], byVendor: [] } };
  }

  const THIS_MONTH = breakdownResult('2026-09-01', '2026-09-28', '17765', 14);
  const LAST_MONTH = breakdownResult('2026-08-01', '2026-08-31', '40453', 14);

  function cmpRequest(): LineAiTurnRequest {
    const text = 'เดือนนี้กับเดือนที่แล้ว อันไหนจ่ายเยอะกว่ากันครับ';
    return {
      requestId: 'req-cmp-1', webhookEventId: 'event-cmp-1', messageText: text, messagePreviewHash: 'f'.repeat(16),
      valueCandidates: extractValueCandidates(text, '2026-09-28'),
      semanticSubrequests: [
        { index: 0, kind: 'read', goal: 'ยอดรวมเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28' } },
        { index: 1, kind: 'read', goal: 'ยอดรวมเดือนที่แล้ว', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: { fromDate: '2026-08-01', toDate: '2026-08-31' } },
      ],
      userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
        permissions: ['expense.read'], roles: ['owner'], branchIds: [], locationIds: [], locale: 'th-TH' },
    };
  }

  const CMP_CONTROL_CALL = JSON.stringify({ calls: [
    { index: 0, toolName: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-28' } },
    { index: 1, toolName: 'expense.get_breakdown', input: { fromDate: '2026-08-01', toDate: '2026-08-31' } },
  ] });

  async function runCmp(composeQueue: string[]) {
    const queue = [CMP_CONTROL_CALL, ...composeQueue];
    const provider: IModelProvider = { async generateText(_input: ProviderInput): Promise<ProviderOutput> {
      return { ok: true, text: queue.shift() ?? '{}' };
    } };
    return runSemanticTurnV2({
      req: cmpRequest(), provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(_meta, _ctx, args): Promise<ToolResult> {
        return (args as { fromDate?: string }).fromDate === '2026-09-01' ? THIS_MONTH : LAST_MONTH;
      },
    });
  }

  it('a compose answer that cites the code-computed difference is grounded; the comparison itself stays the computed one, with no percentage', async () => {
    const answers = JSON.stringify({ answers: [
      { index: 0, status: 'handled', text: 'เดือนนี้ 17,765.00 บาท', sourceRefIds: ['expenses:expense_breakdown:summary'] },
      { index: 1, status: 'handled', text: 'เดือนที่แล้ว 40,453.00 บาท มากกว่าเดือนนี้ ต่างกัน -22,688.00 บาท (-56.1%)', sourceRefIds: ['expenses:expense_breakdown:summary'] },
    ] });
    const result = await runCmp([answers]);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.equal(result.semanticCoverage?.[1]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[1]?.reasonCode, 'ANSWER_NUMBER_NOT_GROUNDED');
    assert.match(result.replyText, /^1–28 ก\.ย\. น้อยกว่า ส\.ค\. 22,688\.00 บาท$/mu, result.replyText);
    // Owner 2026-10-05: no percentage in a comparison the reader did not ask one of.
    assert.doesNotMatch(result.replyText, /%/u, result.replyText);
  });

  it('falls to the deterministic comparison when compose invents an ungrounded difference', async () => {
    const answers = JSON.stringify({ answers: [
      { index: 0, status: 'handled', text: 'เดือนนี้ 17,765.00 บาท', sourceRefIds: ['expenses:expense_breakdown:summary'] },
      { index: 1, status: 'handled', text: 'ต่างกันประมาณ 99,999 บาท เยอะมากครับ', sourceRefIds: ['expenses:expense_breakdown:summary'] },
    ] });
    const result = await runCmp([answers]);
    assert.equal(result.semanticCoverage?.[1]?.reasonCode, 'DETERMINISTIC_FALLBACK_RENDERED');
    assert.ok(!result.replyText.includes('99,999'), 'the invented figure must not leak through');
    // A8: the bare signed "-22,688.00" line is a sentence naming both periods, and "ช่วง 2026-08-01"
    // is the Thai whole-month label "ส.ค. 2569".
    assert.match(result.replyText, /^1–28 ก\.ย\. น้อยกว่า ส\.ค\. 22,688\.00 บาท$/mu, result.replyText);
    assert.ok(result.replyText.includes('• ส.ค. 2569'), result.replyText);
  });

  it('falls to the deterministic comparison — never the generic terminal — when compose fails entirely', async () => {
    const result = await runCmp(['not json at all', 'still not json']);
    for (const index of [0, 1]) {
      const coverage = result.semanticCoverage?.[index];
      assert.equal(coverage?.status, 'handled');
      assert.equal(coverage?.reasonCode, 'DETERMINISTIC_FALLBACK_RENDERED');
      assert.notEqual(coverage?.reasonCode, 'SEMANTIC_ANSWER_UNAVAILABLE');
    }
    // A8: same sentence as above.
    assert.match(result.replyText, /^1–28 ก\.ย\. น้อยกว่า ส\.ค\. 22,688\.00 บาท$/mu, result.replyText);
    assert.ok(!result.replyText.includes('ดึงข้อมูลส่วนนี้ไม่ได้'), result.replyText);
    // A7: both indices render the SAME deterministic comparison block — printed once, unnumbered.
    assert.ok(!result.replyText.startsWith('1. '), result.replyText);
    assert.ok(!result.replyText.includes('\n\n2. '), result.replyText);
  });

  it('item 3(b): grounds a code-computed category share for a single-period breakdown "why" question', async () => {
    const text = 'ทำไมค่าบริการเดือนนี้เยอะจัง';
    const req: LineAiTurnRequest = {
      requestId: 'req-share-1', webhookEventId: 'event-share-1', messageText: text, messagePreviewHash: 'a'.repeat(16),
      valueCandidates: extractValueCandidates(text, '2026-09-28'),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ทำไมค่าบริการเยอะ', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28' } }],
      userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
        permissions: ['expense.read'], roles: ['owner'], branchIds: [], locationIds: [], locale: 'th-TH' },
    };
    const control = JSON.stringify({ calls: [{ index: 0, toolName: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-28' } }] });
    // ค่าบริการ 4,188.50 of a 17,765.00 total is a 23.6% share — code-computed, cited verbatim.
    const answer = JSON.stringify({ answers: [{ index: 0, status: 'handled',
      text: 'ค่าบริการเดือนนี้ 4,188.50 บาท คิดเป็นสัดส่วน 23.6% ของยอดรวม 17,765.00 บาท ซึ่งเป็นหมวดที่มีสัดส่วนสูงสุดค่ะ',
      sourceRefIds: ['expenses:expense_breakdown:summary'] }] });
    const queue = [control, answer];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    const shareResult: ToolResult = { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [CMP_SOURCE_REF],
      data: { period: { fromDate: '2026-09-01', toDate: '2026-09-28', defaultedToCurrentMonth: false }, totalCount: 14, totalAmount: '17765', currency: 'THB',
        totalsByCurrency: [{ currency: 'THB', count: 14, totalAmount: '17765' }], mixedCurrency: false,
        byCategory: [{ categoryId: null, category: 'ค่าบริการ', currency: 'THB', count: 3, totalAmount: '4188.5' },
          { categoryId: null, category: 'ค่าเดินทาง', currency: 'THB', count: 3, totalAmount: '3777.5' }],
        byBranch: [], byVendor: [] } };
    const result = await runSemanticTurnV2({
      req, provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { return shareResult; },
    });
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'ANSWER_NUMBER_NOT_GROUNDED');
    assert.ok(result.replyText.includes('23.6%'));
  });

  it('M1 (tuning-8, T-111-b): derived facts accumulate across two breakdown results for the same index, not just the first', async () => {
    const text = 'ทำไมจ่ายร้านสมใจการค้าเยอะจังเดือนนี้ครับ';
    const req: LineAiTurnRequest = {
      requestId: 'req-m1-1', webhookEventId: 'event-m1-1', messageText: text, messagePreviewHash: 'b'.repeat(16),
      valueCandidates: extractValueCandidates(text, '2026-09-28'),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ถามสาเหตุจ่ายร้านสมใจการค้าเยอะ', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28', vendorName: 'ร้านสมใจการค้า' } }],
      userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
        permissions: ['expense.read'], roles: ['owner'], branchIds: [], locationIds: [], locale: 'th-TH' },
    };
    const control = JSON.stringify({ calls: [
      { index: 0, toolName: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-28', vendorName: 'ร้านสมใจการค้า' } },
      { index: 0, toolName: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'vendor' } },
    ] });
    // Filtered (vendorName set): only this vendor's own spend, its own internal category split.
    const filteredResult: ToolResult = { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [CMP_SOURCE_REF],
      data: { period: { fromDate: '2026-09-01', toDate: '2026-09-28', defaultedToCurrentMonth: false }, totalCount: 3, totalAmount: '4188.5', currency: 'THB',
        totalsByCurrency: [{ currency: 'THB', count: 3, totalAmount: '4188.5' }], mixedCurrency: false,
        byCategory: [{ categoryId: null, category: 'ค่าน้ำมัน', currency: 'THB', count: 1, totalAmount: '2355' }],
        byBranch: [], byVendor: [{ vendorId: null, vendor: 'ร้านสมใจการค้า', currency: 'THB', count: 3, totalAmount: '4188.5' }] } };
    // Unfiltered (grouped by vendor): the whole month, every vendor — carries the 23.6% share, which
    // exists ONLY here, never in the filtered result above.
    const unfilteredResult: ToolResult = { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [CMP_SOURCE_REF],
      data: { period: { fromDate: '2026-09-01', toDate: '2026-09-28', defaultedToCurrentMonth: false }, totalCount: 14, totalAmount: '17765', currency: 'THB',
        totalsByCurrency: [{ currency: 'THB', count: 14, totalAmount: '17765' }], mixedCurrency: false,
        byCategory: [], byBranch: [],
        byVendor: [{ vendorId: null, vendor: 'ร้านสมใจการค้า', currency: 'THB', count: 3, totalAmount: '4188.5' },
          { vendorId: null, vendor: 'ปั๊มน้ำมัน ปตท.', currency: 'THB', count: 2, totalAmount: '3203' }] } };
    const answer = JSON.stringify({ answers: [{ index: 0, status: 'handled',
      text: 'ร้านสมใจการค้าเดือนนี้จ่ายไป 4,188.50 บาท คิดเป็น 23.6% ของค่าใช้จ่ายทั้งหมดในเดือนนี้ (17,765 บาท) อยู่อันดับ 1 ค่ะ',
      sourceRefIds: ['expenses:expense_breakdown:summary'] }] });
    const queue = [control, answer];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    const result = await runSemanticTurnV2({
      req, provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(_meta, _ctx, args): Promise<ToolResult> { return (args as { groupBy?: string }).groupBy === 'vendor' ? unfilteredResult : filteredResult; },
    });
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'ANSWER_NUMBER_NOT_GROUNDED');
    assert.ok(result.replyText.includes('23.6%'), result.replyText);
  });

  it('M1 (tuning-8, T-111-b): accumulates regardless of which of the two breakdown calls the control round lists first', async () => {
    // Same fixture as the test above, but the control round lists the UNFILTERED call first and the
    // vendor-filtered one second — the opposite order from E5's own augmentation. `derivedFactsByIndex`
    // must APPEND per index rather than keep only the LAST-processed entry's shares, or this ordering
    // would silently lose the 23.6% share again (this time to the filtered entry's own 100.0%/56.2%).
    const text = 'ทำไมจ่ายร้านสมใจการค้าเยอะจังเดือนนี้ครับ';
    const req: LineAiTurnRequest = {
      requestId: 'req-m1-2', webhookEventId: 'event-m1-2', messageText: text, messagePreviewHash: 'c'.repeat(16),
      valueCandidates: extractValueCandidates(text, '2026-09-28'),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ถามสาเหตุจ่ายร้านสมใจการค้าเยอะ', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28', vendorName: 'ร้านสมใจการค้า' } }],
      userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
        permissions: ['expense.read'], roles: ['owner'], branchIds: [], locationIds: [], locale: 'th-TH' },
    };
    const control = JSON.stringify({ calls: [
      { index: 0, toolName: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'vendor' } },
      { index: 0, toolName: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-28', vendorName: 'ร้านสมใจการค้า' } },
    ] });
    const filteredResult: ToolResult = { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [CMP_SOURCE_REF],
      data: { period: { fromDate: '2026-09-01', toDate: '2026-09-28', defaultedToCurrentMonth: false }, totalCount: 3, totalAmount: '4188.5', currency: 'THB',
        totalsByCurrency: [{ currency: 'THB', count: 3, totalAmount: '4188.5' }], mixedCurrency: false,
        byCategory: [{ categoryId: null, category: 'ค่าน้ำมัน', currency: 'THB', count: 1, totalAmount: '2355' }],
        byBranch: [], byVendor: [{ vendorId: null, vendor: 'ร้านสมใจการค้า', currency: 'THB', count: 3, totalAmount: '4188.5' }] } };
    const unfilteredResult: ToolResult = { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [CMP_SOURCE_REF],
      data: { period: { fromDate: '2026-09-01', toDate: '2026-09-28', defaultedToCurrentMonth: false }, totalCount: 14, totalAmount: '17765', currency: 'THB',
        totalsByCurrency: [{ currency: 'THB', count: 14, totalAmount: '17765' }], mixedCurrency: false,
        byCategory: [], byBranch: [],
        byVendor: [{ vendorId: null, vendor: 'ร้านสมใจการค้า', currency: 'THB', count: 3, totalAmount: '4188.5' },
          { vendorId: null, vendor: 'ปั๊มน้ำมัน ปตท.', currency: 'THB', count: 2, totalAmount: '3203' }] } };
    const answer = JSON.stringify({ answers: [{ index: 0, status: 'handled',
      text: 'ร้านสมใจการค้าเดือนนี้จ่ายไป 4,188.50 บาท คิดเป็น 23.6% ของค่าใช้จ่ายทั้งหมดในเดือนนี้ (17,765 บาท) อยู่อันดับ 1 ค่ะ',
      sourceRefIds: ['expenses:expense_breakdown:summary'] }] });
    const queue = [control, answer];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    const result = await runSemanticTurnV2({
      req, provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(_meta, _ctx, args): Promise<ToolResult> { return (args as { groupBy?: string }).groupBy === 'vendor' ? unfilteredResult : filteredResult; },
    });
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'ANSWER_NUMBER_NOT_GROUNDED');
    assert.ok(result.replyText.includes('23.6%'), result.replyText);
  });
});

// ── Item 2 (spec §3 row 8, "รายการที่ 3 คือร้านอะไรครับ") ────────────────────────────────────────
// A small reference ordinal the customer types THEMSELVES ("รายการที่ 3") is not a tool-derived
// number, but echoing it back is not fabrication either: userStatedReferenceNumbers in
// semantic-turn-v2.ts unions verbatim whole numbers 1-20 from the CURRENT message into the
// numeric-grounding allow-set. Fixture shape copied from the real tool result (ExpenseGetDetailTool's
// success path, erp-core-detail-tools.use-case.ts) — deliberately free of the digit "3" or "7"
// anywhere (id/dates/amounts) so passing tests are never accidental leakage from JSON.stringify(data).
const DETAIL_SOURCE_REF = {
  label: 'EXP-0009', module: 'expenses', entityType: 'expense', entityId: 'expense-detail-one',
  asOf: '2026-09-27T18:20:29.656Z', permissionChecked: true as const,
  webPath: '/companies/company/expenses/expense-detail-one',
};

function expenseGetDetailResult(): ToolResult {
  return {
    toolName: 'expense.get_detail', status: 'ok', asOf: '2026-09-27T18:20:29.656Z',
    sourceRefs: [DETAIL_SOURCE_REF],
    data: {
      id: 'expense-detail-one', expenseNumber: 'EXP-0009', status: 'CONFIRMED', captureSource: 'LINE_UPLOAD', branchId: null,
      vendorName: null, vendorDocumentNumber: null,
      expenseDate: '2026-09-14T00:00:00.000Z', dueDate: null,
      currency: 'THB', vatMode: 'NONE', inputVatClaimStatus: 'NOT_CLAIMED',
      subtotalAmount: '900.00', discountAmount: '0.00',
      taxableAmount: '900.00', vatAmount: '0.00', whtAmount: '0.00',
      grandTotalAmount: '900.00', netPayableAmount: '900.00',
      paidAmount: '0.00', outstandingAmount: '900.00',
      paymentStatus: 'UNPAID', duplicateStatus: 'NONE',
      taxEvidenceStatus: 'NONE', postingStatus: 'NOT_POSTED',
      lines: [], charges: [], attachmentCount: 0,
    },
  };
}

function detailRequest(messageText: string): LineAiTurnRequest {
  return {
    requestId: 'request-detail', webhookEventId: 'event-detail', messageText,
    messagePreviewHash: 'e'.repeat(16),
    conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: [], recentReads: [{ tool: 'expense.list_recent', answerShape: 'list',
      asOf: DETAIL_SOURCE_REF.asOf, shownItems: [{ ordinal: 3, id: 'expense-detail-one', label: 'ไม่ระบุร้าน' }] }] },
    semanticSubrequests: [{
      index: 0, kind: 'read', goal: 'รายละเอียดรายการที่ 3', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
      requestedFilters: { expenseId: 'expense-detail-one' },
    }],
    userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
      permissions: ['expense.read'], roles: ['owner'], branchIds: [], locationIds: [], locale: 'th-TH' },
  };
}

const DETAIL_CONTROL_CALL = JSON.stringify({
  calls: [{ index: 0, toolName: 'expense.get_detail', input: { expenseId: 'expense-detail-one' } }],
  questions: [],
});

function detailAnswerEnvelope(text: string) {
  return JSON.stringify({ answers: [{ index: 0, status: 'handled', text, sourceRefIds: ['expenses:expense:expense-detail-one'] }] });
}

async function runDetail(controls: string[], messageText: string, enabledDeterministicFamilies?: ReadonlySet<string>) {
  const queue = [...controls];
  const provider: IModelProvider = { async generateText(_input: ProviderInput): Promise<ProviderOutput> {
    return { ok: true, text: queue.shift() ?? '{}' };
  } };
  return runSemanticTurnV2({
    req: detailRequest(messageText), provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
    publicLookupEnabled: false, approvedKnowledgeEnabled: false, enabledDeterministicFamilies,
    async invoke(): Promise<ToolResult> { return expenseGetDetailResult(); },
  });
}

describe('semantic turn v2: item 2 (spec §3 row 8) small user-typed ordinals are grounded', () => {
  it('accepts a reference ordinal ("3") copied verbatim from the current message, with no vendor to report', async () => {
    const text = 'รายการที่ 3 ไม่ได้ระบุชื่อร้านค้าไว้ค่ะ';
    const result = await runDetail([DETAIL_CONTROL_CALL, detailAnswerEnvelope(text)], 'รายการที่ 3 คือร้านอะไรครับ');
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'ANSWER_NUMBER_NOT_GROUNDED');
    assert.ok(result.replyText.includes('รายการที่ 3'));
  });

  it('still rejects a user-typed amount ("5,000") even though it was typed in the current message', async () => {
    const text = 'รายการที่ 3 ยอด 5,000 บาทใช่ไหมคะ';
    const result = await runDetail([DETAIL_CONTROL_CALL, detailAnswerEnvelope(text)], 'รายการที่ 3 คือ 5,000 บาทใช่ไหมครับ');
    assert.notEqual(result.semanticCoverage?.[0]?.status, 'handled');
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'ANSWER_NUMBER_NOT_GROUNDED');
  });

  it('still rejects a small reference number that never appears in the current message at all', async () => {
    const text = 'รายการที่ 7 ไม่ได้ระบุชื่อร้านค้าไว้ค่ะ';
    const result = await runDetail([DETAIL_CONTROL_CALL, detailAnswerEnvelope(text)], 'รายการที่ 3 คือร้านอะไรครับ');
    assert.notEqual(result.semanticCoverage?.[0]?.status, 'handled');
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'ANSWER_NUMBER_NOT_GROUNDED');
  });
});

// ── Item 3 (spec §3 row 8) — expense.get_detail::single_metric as the deterministic fallback ──────
// Same recovery C1(c)/(d) already proves for expense.list_recent: grounding-exhausted (or otherwise
// uncitable) composition never shows the raw rejection or lingers as `needs_user` — it renders the
// SAME verified, model-free formatter the prepared lane trusts, gated by the SAME operator allowlist.
describe('semantic turn v2: item 3 (spec §3 row 8) expense.get_detail as the deterministic fallback', () => {
  const INVENTED_DETAIL = 'รายการที่ 3 ยังค้างจ่ายอีกประมาณ 3,500 บาทค่ะ';

  it('renders expense.get_detail::single_metric when its family is enabled, never `needs_user`', async () => {
    const result = await runDetail([DETAIL_CONTROL_CALL, detailAnswerEnvelope(INVENTED_DETAIL)],
      'รายการที่ 3 คือร้านอะไรครับ', new Set(['expense.get_detail::single_metric']));
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'handled');
    assert.equal(coverage?.reasonCode, 'DETERMINISTIC_FALLBACK_RENDERED');
    assert.match(result.replyText, /ค่าใช้จ่าย: ไม่ระบุร้าน วันที่ 14 กันยายน 2569 ยอด 900\.00 บาท/);
    assert.ok(!result.replyText.includes('3,500'));
  });

  it('falls back to the honest §8 terminal (unsupported, not needs_user) when no family is enabled', async () => {
    const result = await runDetail([DETAIL_CONTROL_CALL, detailAnswerEnvelope(INVENTED_DETAIL)], 'รายการที่ 3 คือร้านอะไรครับ');
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'unsupported');
    assert.notEqual(coverage?.status, 'needs_user');
    assert.equal(coverage?.reasonCode, 'ANSWER_NUMBER_NOT_GROUNDED');
  });
});

// ── A1 (batch5, run 4): date-aware number tokenizer ────────────────────────────────────────────
// Root cause: `/-?\d[\d,]*(?:\.\d+)?/gu` read an ISO date "2026-09-15T04:00:00.000Z" as 2026, -9,
// -15 — the allow-set only ever carried the NEGATIVE form of a tool date's day, so a composed answer
// naming that day in plain positive prose was rejected 76/89 times in run 4. Fixture dates below are
// deliberately distinct from the C1 block above (day 15, not 14/28) so a pass here cannot be
// accidental leakage from another fixture's digits.
describe('semantic turn v2: A1 (batch5) date-aware number tokenizer', () => {
  const DATED_SOURCE_REF = { label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary',
    asOf: '2026-09-15T04:00:00.000Z', permissionChecked: true as const, webPath: '/companies/company/expenses' };

  function datedListRecentResult(): ToolResult {
    return {
      toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-15T04:00:00.000Z',
      sourceRefs: [DATED_SOURCE_REF],
      queryApplied: { timezone: 'Asia/Bangkok', period: { startDate: '2026-09-01', endDate: '2026-09-28', timezone: 'Asia/Bangkok', defaulted: false },
        dateBasis: 'expense_incurred_date', statusBasis: 'exclude_rejected_voided', dataset: 'operational_expense_records' },
      facts: [],
      data: {
        total: 1, period: { fromDate: '2026-09-01', toDate: '2026-09-28', defaultedToCurrentMonth: false },
        summary: { countedItems: 1, cancelledCount: 0, totalAmount: '300.50', pendingAmount: '0', draftAmount: '0', confirmedAmount: '300.50', paidAmount: '300.50', unpaidAmount: '0' },
        totalsByCurrency: [{ currency: 'THB', count: 1, totalAmount: '300.50' }],
        items: [{ id: 'e1', expenseDate: '2026-09-15T04:00:00.000Z', vendorNameSnapshot: 'ร้านสมใจ', status: 'CONFIRMED', paymentStatus: 'PAID', grandTotalAmount: '300.50' }],
      },
    };
  }

  it('grounds a day named in prose ("15 ก.ย.") from a tool ISO date, which the old regex could only ever read as negative', async () => {
    const text = 'ค่าใช้จ่ายวันที่ 15 ก.ย. รวม 300.50 บาทค่ะ';
    const { result } = await run([CONTROL_CALL, answerEnvelope(text)], datedListRecentResult());
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.ok(result.replyText.includes('15 ก.ย.'), result.replyText);
  });

  it('grounds a month-to-date range ("1–28 ก.ย. 2569") from the tool\'s own period', async () => {
    const text = 'ค่าใช้จ่ายช่วง 1–28 ก.ย. 2569 รวม 300.50 บาทค่ะ';
    const { result } = await run([CONTROL_CALL, answerEnvelope(text)], datedListRecentResult());
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.ok(result.replyText.includes('1–28 ก.ย. 2569'), result.replyText);
  });

  it('still rejects an invented approximate figure even with the date-aware tokenizer', async () => {
    const text = 'ค่าใช้จ่ายวันที่ 15 ก.ย. รวมประมาณ 7,312.50 บาทค่ะ';
    const { result } = await run([CONTROL_CALL, answerEnvelope(text)], datedListRecentResult());
    assert.notEqual(result.semanticCoverage?.[0]?.status, 'handled');
    assert.ok(!result.replyText.includes('7,312.50') && !result.replyText.includes('7312.50'), result.replyText);
  });
});

// ── A2 (batch5): rounded derived percentages ────────────────────────────────────────────────────
describe('semantic turn v2: A2 (batch5) a rounded derived percentage is grounded, an arbitrary one is not', () => {
  const SHARE_SOURCE_REF = { label: 'สรุปค่าใช้จ่ายแยกกลุ่ม', module: 'expenses', entityType: 'expense_breakdown',
    asOf: '2026-09-27T18:20:29.656Z', permissionChecked: true as const, webPath: '/companies/company/expenses' };

  function shareRequest(): LineAiTurnRequest {
    const text = 'ค่าเดินทางเดือนนี้คิดเป็นสัดส่วนเท่าไหร่คะ';
    return {
      requestId: 'req-share-pct', webhookEventId: 'event-share-pct', messageText: text, messagePreviewHash: 'a'.repeat(16),
      valueCandidates: extractValueCandidates(text, '2026-09-28'),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'สัดส่วนค่าเดินทาง', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
        requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28' } }],
      userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
        permissions: ['expense.read'], roles: ['owner'], branchIds: [], locationIds: [], locale: 'th-TH' },
    };
  }
  const SHARE_CONTROL_CALL = JSON.stringify({ calls: [{ index: 0, toolName: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-28' } }] });
  // ค่าเดินทาง 562 of a 1000 total is a 56.2% share, computed by expenseBreakdownShares.
  const SHARE_RESULT: ToolResult = { toolName: 'expense.get_breakdown', status: 'ok', asOf: '2026-09-27T18:20:29.656Z', sourceRefs: [SHARE_SOURCE_REF],
    data: { period: { fromDate: '2026-09-01', toDate: '2026-09-28', defaultedToCurrentMonth: false }, totalCount: 3, totalAmount: '1000', currency: 'THB',
      totalsByCurrency: [{ currency: 'THB', count: 3, totalAmount: '1000' }], mixedCurrency: false,
      byCategory: [{ categoryId: null, category: 'ค่าเดินทาง', currency: 'THB', count: 1, totalAmount: '562' }], byBranch: [], byVendor: [] } };

  async function runShare(answerText: string) {
    const queue = [SHARE_CONTROL_CALL, JSON.stringify({ answers: [{ index: 0, status: 'handled', text: answerText, sourceRefIds: ['expenses:expense_breakdown:summary'] }] })];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    return runSemanticTurnV2({ req: shareRequest(), provider, draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false, async invoke(): Promise<ToolResult> { return SHARE_RESULT; } });
  }

  it('accepts the model rounding a code-derived 56.2% share to "56%"', async () => {
    const result = await runShare('ค่าเดินทางเดือนนี้คิดเป็น 56% ของยอดรวมค่ะ');
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'ANSWER_NUMBER_NOT_GROUNDED');
  });

  it('still rejects an arbitrary whole percent that is not the rounded derived share', async () => {
    const result = await runShare('ค่าเดินทางเดือนนี้คิดเป็น 75% ของยอดรวมค่ะ');
    assert.notEqual(result.semanticCoverage?.[0]?.status, 'handled');
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'ANSWER_NUMBER_NOT_GROUNDED');
  });
});

// ── A4 (batch5): raw facts are never appended to the customer-visible reply ────────────────────
describe('semantic turn v2: A4 (batch5) grounded compose text is never followed by raw fact lines', () => {
  it('a grounded answer stays exactly the model\'s own text', async () => {
    const text = 'ค่าใช้จ่ายยืนยันแล้วเดือนนี้ 8,703 บาท (8 รายการ) ค่ะ';
    const { result } = await run([CONTROL_CALL, answerEnvelope(text)]);
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.equal(result.replyText, text, result.replyText);
    assert.ok(!result.replyText.includes('expense_total:'), result.replyText);
    assert.ok(!result.replyText.includes('|'), result.replyText);
  });
});

// ── A9 (batch5, T-070-a/T-074-a): the fallback list shape follows a "list" request ──────────────
describe('semantic turn v2: A9 (batch5) a "list"-asking message prefers the list deterministic shape', () => {
  const LIST_MESSAGE = 'ขอ list รายการล่าสุดหน่อยค่ะ';

  function listRequest(): LineAiTurnRequest {
    return {
      requestId: 'request-list', webhookEventId: 'event-list', messageText: LIST_MESSAGE, messagePreviewHash: 'c'.repeat(16),
      valueCandidates: extractValueCandidates(LIST_MESSAGE, TODAY),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'รายการล่าสุด', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
        permissions: ['expense.read'], roles: ['owner'], branchIds: [], locationIds: [], locale: 'th-TH' },
    };
  }
  const LIST_CONTROL_CALL = JSON.stringify({ calls: [{ index: 0, toolName: 'expense.list_recent', input: {} }], questions: [] });

  it('renders the list shape (names an item\'s vendor), not the total-only shape, when the user asked to see a list', async () => {
    const queue = [LIST_CONTROL_CALL, answerEnvelope('ค่าใช้จ่ายรวมประมาณ 99,000 บาทนะคะ')];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    const result = await runSemanticTurnV2({
      req: listRequest(), provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      enabledDeterministicFamilies: new Set(['expense.list_recent::single_metric', 'expense.list_recent::list']),
      async invoke(): Promise<ToolResult> { return listRecentConfirmedResult(); },
    });
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'DETERMINISTIC_FALLBACK_RENDERED');
    assert.ok(result.replyText.includes('ร้านสมใจ'), result.replyText);
  });
});

// ── A3 (batch5, T-084-b): reimbursement.list_pending_approvals total joins the grounding allow-set ──
describe('semantic turn v2: A3 (batch5) the code-computed pending-approvals total is grounded', () => {
  const PENDING_SOURCE_REF = { label: 'รายการเบิกจ่ายรออนุมัติ', module: 'reimbursements', entityType: 'reimbursement_approval_queue',
    asOf: '2026-09-28T02:00:00.000Z', permissionChecked: true as const, webPath: '/companies/company/reimbursements' };
  const PENDING_RESULT: ToolResult = { toolName: 'reimbursement.list_pending_approvals', status: 'ok', asOf: '2026-09-28T02:00:00.000Z',
    sourceRefs: [PENDING_SOURCE_REF], facts: [], data: { total: 2, items: [
      { id: 'r1', documentNumber: 'REQ-1', requesterDisplayName: 'สมชาย', amount: '1200.00', currency: 'THB', submittedAt: '2026-09-20T00:00:00.000Z', status: 'PENDING_APPROVAL', branch: null },
      { id: 'r2', documentNumber: 'REQ-2', requesterDisplayName: 'สมหญิง', amount: '866.00', currency: 'THB', submittedAt: '2026-09-21T00:00:00.000Z', status: 'PENDING_APPROVAL', branch: null },
    ] } };

  function pendingRequest(): LineAiTurnRequest {
    // Deliberately NOT T-084-b's own "...หน่อยครับ" wording: that phrase also trips the unrelated
    // (out-of-scope for this task) LINE-action-boundary classifier in line-ai-scope-policy.logic.ts,
    // whose REQUEST_MARKERS_TH+verb match fires on "รออนุมัติ"'s "อนุมัติ" substring before this
    // subrequest ever reaches a tool call. This test isolates the A3 grounding fix only.
    const text = 'มีใบเบิกรออนุมัติกี่ใบคะ';
    return {
      requestId: 'req-pending', webhookEventId: 'event-pending', messageText: text, messagePreviewHash: 'e'.repeat(16),
      valueCandidates: extractValueCandidates(text, '2026-09-28'),
      semanticSubrequests: [{ index: 0, kind: 'read', goal: 'ใบเบิกรออนุมัติ', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }],
      userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
        permissions: ['reimbursement.read', 'reimbursement.approve'], roles: ['manager'], branchIds: [], locationIds: [], locale: 'th-TH' },
    };
  }
  const PENDING_CONTROL_CALL = JSON.stringify({ calls: [{ index: 0, toolName: 'reimbursement.list_pending_approvals', input: {} }], questions: [] });

  it('grounds a composed answer citing the code-computed 2,066.00 total (run 4 rejected this 7 times)', async () => {
    const answer = JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'ใบเบิกรออนุมัติตอนนี้มี 2 รายการ รวม 2,066.00 บาทค่ะ', sourceRefIds: ['reimbursements:reimbursement_approval_queue:summary'] }] });
    const queue = [PENDING_CONTROL_CALL, answer];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    const result = await runSemanticTurnV2({
      req: pendingRequest(), provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { return PENDING_RESULT; },
    });
    assert.equal(result.semanticCoverage?.[0]?.status, 'handled');
    assert.notEqual(result.semanticCoverage?.[0]?.reasonCode, 'ANSWER_NUMBER_NOT_GROUNDED');
    assert.ok(result.replyText.includes('2,066.00'), result.replyText);
  });

  it('still rejects an invented pending-approvals total', async () => {
    const answer = JSON.stringify({ answers: [{ index: 0, status: 'handled', text: 'ใบเบิกรออนุมัติตอนนี้รวมประมาณ 9,999.00 บาทค่ะ', sourceRefIds: ['reimbursements:reimbursement_approval_queue:summary'] }] });
    const queue = [PENDING_CONTROL_CALL, answer];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    const result = await runSemanticTurnV2({
      req: pendingRequest(), provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      async invoke(): Promise<ToolResult> { return PENDING_RESULT; },
    });
    assert.notEqual(result.semanticCoverage?.[0]?.status, 'handled');
    assert.ok(!result.replyText.includes('9,999.00'), result.replyText);
  });
});

// Owner 2026-09-29 (production "ดูรายจ่าย ให้หน่อย เดือน ตุลา" on 29 Sep): a composed read answer about a bare month the
// resolver moved to last year ends with the same period line the fast lane prints; the deterministic fallback carries it too.
describe('semantic turn v2: a bare month that fell back to last year says so (owner 2026-09-29)', () => {
  function monthResult(fromDate: string, toDate: string): ToolResult {
    return { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-29T16:08:00.000Z', sourceRefs: [SOURCE_REF],
      queryApplied: { timezone: 'Asia/Bangkok', period: { startDate: fromDate, endDate: toDate, timezone: 'Asia/Bangkok', defaulted: false },
        dateBasis: 'expense_incurred_date', statusBasis: 'exclude_rejected_voided', dataset: 'operational_expense_records' },
      data: { total: 0, period: { fromDate, toDate, defaultedToCurrentMonth: false }, items: [],
        summary: { countedItems: 0, cancelledCount: 0, totalAmount: '0', pendingAmount: '0', draftAmount: '0', confirmedAmount: '0' } } };
  }
  async function turn(text: string, composed: string, families?: ReadonlySet<string>) {
    const valueCandidates = extractValueCandidates(text, '2026-09-29');
    const { fromDate, toDate } = valueCandidates.periods![0]!;
    const queue = [JSON.stringify({ calls: [{ index: 0, toolName: 'expense.list_recent', input: { fromDate, toDate } }] }), composed];
    const provider: IModelProvider = { async generateText(): Promise<ProviderOutput> { return { ok: true, text: queue.shift() ?? '{}' }; } };
    return runSemanticTurnV2({
      req: { ...request(), messageText: text, valueCandidates, semanticSubrequests: [{ index: 0, kind: 'read', goal: 'รายจ่ายเดือนที่ถาม',
        requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: { fromDate, toDate } }] },
      provider, draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      enabledDeterministicFamilies: families,
      async invoke(): Promise<ToolResult> { return monthResult(fromDate, toDate); },
    });
  }
  const COMPOSED = 'เดือนตุลาคม 2568 ยังไม่มีรายจ่ายที่บันทึกไว้ค่ะ รวม 0 บาท';

  it('appends the period line to a grounded composed answer, unless the answer already says so', async () => {
    const result = await turn('ดูรายจ่าย ให้หน่อย เดือน ตุลา', answerEnvelope(COMPOSED));
    assert.equal(result.replyText,
      `${COMPOSED}\nช่วง: 1–31 ต.ค. 2568 (ไม่ได้ระบุปี จึงดูตุลาคมที่ผ่านมาล่าสุด)\nตุลาคมปีนี้ยังไม่ถึงค่ะ`);
    const stated = await turn('ดูรายจ่าย ให้หน่อย เดือน ตุลา', answerEnvelope(`${COMPOSED} ส่วนตุลาคม 2569 ยังไม่ถึงค่ะ`));
    assert.equal(stated.replyText, `${COMPOSED} ส่วนตุลาคม 2569 ยังไม่ถึงค่ะ`);
    const unrelated = await turn('ดูรายจ่าย ให้หน่อย เดือน ตุลา', answerEnvelope(`${COMPOSED} ยังไม่ถึงงบที่ตั้งไว้ค่ะ`));
    assert.match(unrelated.replyText, /\nช่วง: 1–31 ต\.ค\. 2568 \(ไม่ได้ระบุปี/);
  });

  it('leaves an answer about a written year alone', async () => {
    assert.equal((await turn('ดูรายจ่าย เดือนตุลาคม 2568', answerEnvelope(COMPOSED))).replyText, COMPOSED);
  });

  it('carries the note into the deterministic fallback when the composed answer is not grounded', async () => {
    const result = await turn('ดูรายจ่าย ให้หน่อย เดือน ตุลา', answerEnvelope('เดือนตุลาคมมีรายจ่ายประมาณ 3,500 บาทค่ะ'),
      new Set(['expense.list_recent::single_metric']));
    assert.equal(result.semanticCoverage?.[0]?.reasonCode, 'DETERMINISTIC_FALLBACK_RENDERED');
    assert.match(result.replyText,
      /\nช่วง: 1 ตุลาคม 2568 – 31 ตุลาคม 2568 \(ไม่ได้ระบุปี จึงดูตุลาคมที่ผ่านมาล่าสุด\)\nตุลาคมปีนี้ยังไม่ถึงค่ะ\n/);
  });
});
