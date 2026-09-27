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

  it('never leaves a compose failure (both attempts unparsable) as `needs_user`', async () => {
    const { result } = await run([CONTROL_CALL, 'this is not json', 'still not json']);
    const coverage = result.semanticCoverage?.[0];
    assert.equal(coverage?.status, 'unsupported');
    assert.equal(coverage?.reasonCode, 'SEMANTIC_ANSWER_UNAVAILABLE');
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
