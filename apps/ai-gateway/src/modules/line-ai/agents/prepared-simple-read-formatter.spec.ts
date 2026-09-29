import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePeriodCandidates, type SourceRef, type SpecialistOutput } from '@watchdog-bms/contracts';
import { activePreparedFamilies, assumedYearNote, COMPILED_PREPARED_FAMILY_KEYS, formatPreparedSimpleRead, preparedTerminalReply } from './prepared-simple-read-formatter';

const SALES = 'sales.get_sales_summary::single_metric';
const EXPENSE = 'expense.list_recent::single_metric';
// R-L4 (spec item 3): expense.list_recent's list shape, expense.get_breakdown's grouped list, and both
// reimbursement families.
const EXPENSE_LIST = 'expense.list_recent::list';
const BREAKDOWN = 'expense.get_breakdown::list';
const REIMBURSEMENT_APPROVALS = 'reimbursement.list_pending_approvals::list';
const REIMBURSEMENT_SUMMARY = 'reimbursement.get_summary::single_metric';
// Item 3 (spec §3 row 8): the two ordinal-follow-up detail families.
const EXPENSE_DETAIL = 'expense.get_detail::single_metric';
const REIMBURSEMENT_DETAIL = 'reimbursement.get_detail::single_metric';
const ACCOUNTING = 'accounting.get_summary::list';
const DAILY = 'expense.get_daily_closing::single_metric';
// Wave 2 R5 (spec §6.2): the four questions that used 6–7 model calls in the 2026-09-17 corpus run.
const VAT = 'tax.get_vat_summary::single_metric';
const LOW_STOCK = 'inventory.list_low_stock::list';
const AP = 'procurement.get_ap_outstanding::single_metric';
const AP_LIST = 'procurement.get_ap_outstanding::list';
const CRM = 'crm.get_customer_summary::single_metric';
const CRM_LIST = 'crm.get_customer_summary::list';
const TH = { language: 'th', locale: 'th-TH' };
const EN = { language: 'en', locale: 'en-US' };

function salesOutput(data: Record<string, unknown>): SpecialistOutput {
  return {
    agent: 'accounting', status: 'SUCCEEDED', summary: '',
    facts: [{ label: 'ยอดขาย', value: `${String(data['totalSales'])} บาท`, sourceRef: { label: 'ยอดขายรวม', module: 'sales', entityType: 'summary', permissionChecked: true, webPath: '/sales' } }],
    suggestions: [], toolCalls: [{ name: 'sales.get_sales_summary', status: 'ok', durationMs: 1 }], requiresHumanReview: false,
    toolData: [{ tool: 'sales.get_sales_summary', data }], asOf: '2026-07-15T00:00:00Z',
  };
}

describe('prepared-simple-read compiled formatter registry', () => {
  it('exposes exactly the compiled families (sales, F1 expense, R-L4 list/breakdown/reimbursement, F2 accounting, F3 daily, F4–F7 R5 — compiled ≠ active)', () => {
    assert.deepEqual([...COMPILED_PREPARED_FAMILY_KEYS],
      [SALES, EXPENSE, EXPENSE_LIST, EXPENSE_DETAIL, BREAKDOWN, REIMBURSEMENT_APPROVALS, REIMBURSEMENT_SUMMARY, REIMBURSEMENT_DETAIL,
        ACCOUNTING, DAILY, VAT, LOW_STOCK, AP, AP_LIST, CRM, CRM_LIST]);
    // Compiling a family does NOT enable it: the operator allowlist is empty by default, so the lane
    // stays dormant until each family passes its own blind pairwise eval (plan Phase 5 gate).
    assert.deepEqual([...activePreparedFamilies([])], []);
  });

  it('narrows by the operator allowlist: only a listed compiled key is active; unknown strings are ignored', () => {
    assert.deepEqual([...activePreparedFamilies([])], []);
    assert.deepEqual([...activePreparedFamilies(['evil::family', 'inventory.list_low_stock::single_metric'])], []);
    assert.deepEqual([...activePreparedFamilies([SALES, 'evil::family'])], [SALES]);
  });

  it('formats a sales single_metric answer with grounded number, source, as-of, and link', () => {
    const r = formatPreparedSimpleRead(SALES, salesOutput({ totalSales: '12,345', transactionCount: 42, basis: 'accrual' }), { language: 'th', locale: 'th-TH' });
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      assert.match(r.replyText, /ยอดขาย: 12,345 บาท \(42 รายการ\)/);
      // C6 (batch 5c): the reply text no longer states "ที่มา:" — the API appends "แหล่งข้อมูล:" from
      // sourceRefs already, so a line here doubled it. The label still rides sourceRefs/webLinks.
      assert.equal(r.sourceRefs[0]?.label, 'ยอดขายรวม');
      assert.doesNotMatch(r.replyText, /ที่มา:|Source:/);
      // C6 (batch 5c): "ข้อมูล ณ 2026-07-15" was a raw ISO date; always a Thai calendar date now.
      assert.match(r.replyText, /ข้อมูล ณ 15 ก\.ค\. 2569/);
      assert.equal(r.webLinks[0]?.path, '/sales');
    }
  });

  it('dates "ข้อมูล ณ" by the Bangkok day, not the UTC day, just after midnight (regression slice 2026-09-30)', () => {
    const output = { ...salesOutput({ totalSales: '5,000' }), asOf: '2026-09-29T17:22:00.000Z' };
    const r = formatPreparedSimpleRead(SALES, output, { language: 'th', locale: 'th-TH' });
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /ข้อมูล ณ 30 ก\.ย\. 2569/);
  });

  it('states the REQUESTED single date from the validated proposed input (Thai)', () => {
    const r = formatPreparedSimpleRead(SALES, salesOutput({ totalSales: '5,000', period: { fromDate: '2026-07-01', toDate: '2026-07-31' } }),
      { language: 'th', locale: 'th-TH', proposedInput: { fromDate: '2026-07-15', toDate: '2026-07-15' } });
    assert.equal(r.kind, 'answer');
    // The proposed input WINS over the echoed range: the answer names the requested single day.
    // C6 (batch 5c): the period line is now a Thai calendar date, never the raw ISO string.
    if (r.kind === 'answer') assert.match(r.replyText, /\nช่วง: 15 ก\.ค\. 2569/);
  });

  it('states the REQUESTED date range from the validated proposed input (English)', () => {
    const r = formatPreparedSimpleRead(SALES, salesOutput({ totalSales: '9,000' }),
      { language: 'en', locale: 'en-US', proposedInput: { fromDate: '2026-07-01', toDate: '2026-07-31' } });
    assert.equal(r.kind, 'answer');
    // C6 (batch 5c): the English period line is also a calendar date now, not the raw ISO range.
    if (r.kind === 'answer') assert.match(r.replyText, /\nPeriod: 1 Jul 2026 – 31 Jul 2026/);
  });

  it('falls back to the tool-echoed effective period when the proposed input names none (default period)', () => {
    const r = formatPreparedSimpleRead(SALES, salesOutput({ totalSales: '3,000', period: 'เดือนนี้' }),
      { language: 'th', locale: 'th-TH', proposedInput: {} });
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /\nช่วง: เดือนนี้/);
  });

  it('never fabricates a period: omits the line when neither the input nor the tool names one', () => {
    const r = formatPreparedSimpleRead(SALES, salesOutput({ totalSales: '1,000' }), { language: 'th', locale: 'th-TH' });
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      assert.match(r.replyText, /ยอดขาย: 1,000 บาท/);
      assert.doesNotMatch(r.replyText, /ช่วง:/, 'no fabricated period line');
    }
  });

  it('honestly renders an explicit-empty (zero) period, not a fabricated non-zero', () => {
    const r = formatPreparedSimpleRead(SALES, salesOutput({ totalSales: '0', transactionCount: 0 }), { language: 'th', locale: 'th-TH' });
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /ยอดขาย: 0 บาท/);
  });

  it('returns unverified when the total is absent (caller falls back to an honest terminal)', () => {
    assert.equal(formatPreparedSimpleRead(SALES, salesOutput({ transactionCount: 5 }), { language: 'th', locale: 'th-TH' }).kind, 'unverified');
  });

  it('returns unverified for a family key with no compiled formatter', () => {
    assert.equal(formatPreparedSimpleRead('inventory.list_low_stock::single_metric', salesOutput({ totalSales: '1' }), { language: 'th', locale: 'th-TH' }).kind, 'unverified');
  });
});

/** One SUCCEEDED specialist output carrying exactly the tool's own bounded data + its permission-checked
 *  source ref, the way `AccountingSummaryAgent` hands it to the prepared lane. */
function readOutput(tool: string, data: Record<string, unknown>, sourceRef: SourceRef, asOf = '2026-08-25T09:30:00Z'): SpecialistOutput {
  return {
    agent: 'accounting', status: 'SUCCEEDED', summary: '',
    facts: [{ label: 'สรุป', value: '-', sourceRef }],
    suggestions: [], toolCalls: [{ name: tool, status: 'ok', durationMs: 1 }], requiresHumanReview: false,
    toolData: [{ tool, data }], asOf,
  };
}

// ── F1 — expense.list_recent::single_metric ("สรุปค่าใช้จ่าย") ────────────────────────────────────
// Fixture shape copied from the real tool result (apps/api .../erp-tools.use-case.ts `ExpenseListRecentTool`):
// `total` = counted records (rejected/voided already excluded and counted in `summary.cancelledCount`),
// `summary.*` are JS numbers, `period` is the effective window, `items` is capped at five raw records,
// and `truncated` appears only when the page cap cut the period short.
const EXPENSE_SOURCE: SourceRef = {
  label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary',
  permissionChecked: true, webPath: '/companies/c1/expenses',
};
const expenseSummary = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  countedItems: 42, cancelledCount: 0, totalAmount: 1234567.5, pendingAmount: 0,
  draftAmount: 0, confirmedAmount: 1234567.5, paidAmount: 1234567.5, unpaidAmount: 0, ...over,
});
const expenseOutput = (data: Record<string, unknown>, asOf?: string): SpecialistOutput =>
  readOutput('expense.list_recent', data, EXPENSE_SOURCE, asOf);
const expenseData = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  total: 42,
  period: { fromDate: '2026-08-01', toDate: '2026-08-25', defaultedToCurrentMonth: true },
  summary: expenseSummary(),
  items: [{ id: 'e1', expenseNumber: 'EXP-2026-0001', grandTotalAmount: '180.0000' }],
  ...over,
});

describe('F1 expense.list_recent::single_metric — สรุปค่าใช้จ่าย', () => {
  it('answers with the grounded total, record count, period, source, as-of and link (Thai)', () => {
    const r = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^ค่าใช้จ่าย: 1,234,567\.50 บาท \(42 รายการ\)/);
    assert.match(r.replyText, /\nช่วง: 1 สิงหาคม 2569 – 25 สิงหาคม 2569/);
    assert.equal(r.sourceRefs[0]?.label, 'รายการค่าใช้จ่าย');
    assert.doesNotMatch(r.replyText, /ที่มา:|Source:/);
    assert.match(r.replyText, /\nข้อมูล ณ 25 สิงหาคม 2569/);
    assert.equal(r.webLinks[0]?.path, '/companies/c1/expenses');
    assert.equal(r.sourceRefs[0]?.label, 'รายการค่าใช้จ่าย');
    // Invariant 7: Thai copy stays NFC (NFKC would decompose สระอำ and break anchored matching).
    assert.equal(r.replyText, r.replyText.normalize('NFC'));
    // Bounded answer: the five raw records the tool returns never reach the bubble.
    assert.doesNotMatch(r.replyText, /EXP-2026-0001/);
  });

  it('answers in English with the same grounded numbers', () => {
    const r = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData({ total: 8, summary: expenseSummary({ countedItems: 8, totalAmount: 9000 }) })), EN);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /^Expenses: 9,000\.00 THB \(8 records\)/);
  });

  it('states that the default total includes drafts instead of implying confirmed-only spend', () => {
    const data = expenseData({ total: 3, summary: expenseSummary({
      countedItems: 3, totalAmount: 27230.5, pendingAmount: 900, draftAmount: 900, confirmedAmount: 26330.5,
    }) });
    const th = formatPreparedSimpleRead(EXPENSE, expenseOutput(data), TH);
    const en = formatPreparedSimpleRead(EXPENSE, expenseOutput(data), EN);
    assert.equal(th.kind, 'answer');
    assert.equal(en.kind, 'answer');
    if (th.kind === 'answer') assert.match(th.replyText, /ฐานยอด: รวมรายการรอดำเนินการ 900\.00 บาท \(ในนั้นเป็นร่าง 900\.00 บาท\) และรายการยืนยันแล้ว 26,330\.50 บาท/);
    if (en.kind === 'answer') assert.match(en.replyText, /Amount basis: includes 900\.00 THB pending \(including 900\.00 THB draft\) and 26,330\.50 THB confirmed/);
  });

  it('derives the basis from returned summary values, not the requested status filter', () => {
    const filteredOutput = expenseOutput(expenseData({
      total: 2, summary: expenseSummary({ countedItems: 2, totalAmount: 400, pendingAmount: 0, draftAmount: 0, confirmedAmount: 400 }),
    }));
    filteredOutput.toolData![0]!.input = { documentStatus: 'CONFIRMED' };
    const filtered = formatPreparedSimpleRead(EXPENSE, filteredOutput, { ...TH, proposedInput: { documentStatus: 'CONFIRMED' } });
    assert.equal(filtered.kind, 'answer');
    if (filtered.kind === 'answer') {
      // toolData.input/proposedInput are the model's PROPOSED filter, not the tool's own confirmation
      // (queryApplied) — absent that, the basis line still shows and no filters line is invented.
      assert.match(filtered.replyText, /ฐานยอด: รวมรายการรอดำเนินการ 0\.00 บาท \(ในนั้นเป็นร่าง 0\.00 บาท\) และรายการยืนยันแล้ว 400\.00 บาท/);
      assert.doesNotMatch(filtered.replyText, /ฐานสถานะ:/);
      assert.doesNotMatch(filtered.replyText, /ตัวกรอง:/);
    }
    const allStatuses = expenseOutput(expenseData({
      total: 3, summary: expenseSummary({ countedItems: 3, totalAmount: 420, pendingAmount: 100, draftAmount: 20, confirmedAmount: 300 }),
    }));
    allStatuses.toolData![0]!.input = { documentStatus: 'CONFIRMED' };
    const mismatchedRequest = formatPreparedSimpleRead(EXPENSE, allStatuses,
      { ...TH, proposedInput: { documentStatus: 'CONFIRMED' } });
    assert.equal(mismatchedRequest.kind, 'answer');
    if (mismatchedRequest.kind === 'answer') {
      assert.match(mismatchedRequest.replyText, /ฐานยอด: รวมรายการรอดำเนินการ 100\.00 บาท \(ในนั้นเป็นร่าง 20\.00 บาท\) และรายการยืนยันแล้ว 300\.00 บาท/);
      assert.doesNotMatch(mismatchedRequest.replyText, /ฐานสถานะ:/);
      assert.doesNotMatch(mismatchedRequest.replyText, /ตัวกรอง:/);
    }
    const incompleteSummary = expenseSummary({ totalAmount: 900, draftAmount: 900, confirmedAmount: 0 });
    delete incompleteSummary['pendingAmount'];
    const incomplete = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData({ summary: incompleteSummary })), TH);
    assert.equal(incomplete.kind, 'answer');
    if (incomplete.kind === 'answer') assert.doesNotMatch(incomplete.replyText, /ฐานยอด:/);
  });

  it('states the applied filter and drops the now-misleading basis line (documentStatus=CONFIRMED)', () => {
    const data = expenseData({
      total: 2, summary: expenseSummary({ countedItems: 2, totalAmount: 400, pendingAmount: 0, draftAmount: 0, confirmedAmount: 400 }),
      queryApplied: { statusBasis: 'CONFIRMED', filters: {} },
    });
    const th = formatPreparedSimpleRead(EXPENSE, expenseOutput(data), TH);
    assert.equal(th.kind, 'answer');
    if (th.kind === 'answer') {
      assert.match(th.replyText, /\nตัวกรอง: เฉพาะที่ยืนยันแล้ว/);
      assert.doesNotMatch(th.replyText, /ฐานยอด:/);
    }
    const en = formatPreparedSimpleRead(EXPENSE, expenseOutput(data), EN);
    assert.equal(en.kind, 'answer');
    if (en.kind === 'answer') {
      assert.match(en.replyText, /\nFilters: only Confirmed/);
      assert.doesNotMatch(en.replyText, /Amount basis:/);
    }
  });

  // Item 1 (spec R-A1 row 18, eval: 15 turns): a STAFF/own-scoped caller got a correct total with
  // no statement that it covers only their own records. The scope line is read off the tool's own
  // TRUSTED queryApplied.accessScope, never inferred here.
  it('item 1: states "only your own records" when queryApplied.accessScope is own', () => {
    const data = expenseData({ queryApplied: { statusBasis: 'exclude_rejected_voided', accessScope: 'own' } });
    const th = formatPreparedSimpleRead(EXPENSE, expenseOutput(data), TH);
    assert.equal(th.kind, 'answer');
    if (th.kind === 'answer') assert.match(th.replyText, /\nขอบเขต: เฉพาะรายการของคุณ/);
    const en = formatPreparedSimpleRead(EXPENSE, expenseOutput(data), EN);
    assert.equal(en.kind, 'answer');
    if (en.kind === 'answer') assert.match(en.replyText, /\nScope: only your own records/);
  });

  it('item 1: states "related to you" when queryApplied.accessScope is related', () => {
    const data = expenseData({ queryApplied: { statusBasis: 'exclude_rejected_voided', accessScope: 'related' } });
    const r = formatPreparedSimpleRead(EXPENSE, expenseOutput(data), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /\nขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ/);
  });

  it('item 1: never states a scope line for a company-wide read (accessScope company or absent)', () => {
    const company = formatPreparedSimpleRead(EXPENSE,
      expenseOutput(expenseData({ queryApplied: { statusBasis: 'exclude_rejected_voided', accessScope: 'company' } })), TH);
    assert.equal(company.kind, 'answer');
    if (company.kind === 'answer') assert.doesNotMatch(company.replyText, /ขอบเขต:/);
    const absent = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData()), TH);
    assert.equal(absent.kind, 'answer');
    if (absent.kind === 'answer') assert.doesNotMatch(absent.replyText, /ขอบเขต:/);
  });

  it('states the applied payment-status filter and drops the basis line (paymentStatus=UNPAID)', () => {
    const data = expenseData({
      total: 1, summary: expenseSummary({ countedItems: 1, totalAmount: 900, pendingAmount: 900, draftAmount: 0, confirmedAmount: 0 }),
      queryApplied: { statusBasis: 'exclude_rejected_voided', filters: { paymentStatus: 'UNPAID' } },
    });
    const r = formatPreparedSimpleRead(EXPENSE, expenseOutput(data), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      assert.match(r.replyText, /\nตัวกรอง: เฉพาะที่ยังไม่ชำระ/);
      assert.doesNotMatch(r.replyText, /ฐานยอด:/);
    }
  });

  it('item 2d: names the resolved category and vendor in the filter line, and keeps the basis line', () => {
    const data = expenseData({
      summary: expenseSummary({ pendingAmount: 500, draftAmount: 0, confirmedAmount: 0, totalAmount: 500 }),
      queryApplied: { statusBasis: 'exclude_rejected_voided', filters: { categoryName: 'อาหาร', vendorName: 'ร้านสมใจ' } },
    });
    const th = formatPreparedSimpleRead(EXPENSE, expenseOutput(data), TH);
    assert.equal(th.kind, 'answer');
    if (th.kind === 'answer') {
      assert.match(th.replyText, /\nตัวกรอง: เฉพาะหมวดอาหาร, เฉพาะร้านร้านสมใจ/);
      // category/vendor alone never redefines what "pending" means, unlike documentStatus — the basis
      // breakdown line must stay.
      assert.match(th.replyText, /ฐานยอด:/);
    }
    const en = formatPreparedSimpleRead(EXPENSE, expenseOutput(data), EN);
    assert.equal(en.kind, 'answer');
    if (en.kind === 'answer') assert.match(en.replyText, /\nFilters: category อาหาร, vendor ร้านสมใจ/);
  });

  it('names the branch alongside a status filter, and keeps the basis line when only the branch is filtered', () => {
    const filteredByStatusAndBranch = expenseData({
      summary: expenseSummary({ pendingAmount: 0, draftAmount: 0, confirmedAmount: 1234567.5 }),
      queryApplied: { statusBasis: 'CONFIRMED', filters: {} },
    });
    const r = formatPreparedSimpleRead(EXPENSE, expenseOutput(filteredByStatusAndBranch), { ...TH, branchLabel: 'ลาดพร้าว' });
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /\nตัวกรอง: เฉพาะที่ยืนยันแล้ว, เฉพาะสาขาลาดพร้าว/);

    const branchOnly = expenseData({ summary: expenseSummary({ pendingAmount: 900, draftAmount: 900, confirmedAmount: 26330.5, totalAmount: 27230.5 }) });
    const branchResult = formatPreparedSimpleRead(EXPENSE, expenseOutput(branchOnly), { ...TH, branchLabel: 'ลาดพร้าว' });
    assert.equal(branchResult.kind, 'answer');
    if (branchResult.kind === 'answer') {
      assert.match(branchResult.replyText, /\nตัวกรอง: เฉพาะสาขาลาดพร้าว/);
      assert.match(branchResult.replyText, /ฐานยอด: รวมรายการรอดำเนินการ 900\.00 บาท/);
    }
  });

  it('renders an exact Decimal beyond Number safe precision without losing a satang', () => {
    const r = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData({
      total: 1,
      summary: expenseSummary({ countedItems: 1, totalAmount: '9007199254740993.01' }),
    })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /^ค่าใช้จ่าย: 9,007,199,254,740,993\.01 บาท/);
  });

  it('states the API-applied period when it differs from the proposed range', () => {
    const r = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData({
      queryApplied: { period: { startDate: '2026-02-01', endDate: '2026-02-28', timezone: 'Asia/Bangkok' } },
    })), { ...EN, proposedInput: { fromDate: '2026-01-01', toDate: '2026-01-31' } });
    assert.equal(r.kind, 'answer');
    // C6 (batch 5c): a calendar date, not the raw ISO range.
    if (r.kind === 'answer') assert.match(r.replyText, /\nPeriod: 1 Feb 2026 – 28 Feb 2026/);
  });

  it('accepts capped detail rows only when the aggregate declares itself complete', () => {
    const complete = expenseData({
      completeness: { aggregate: 'complete', rows: { returned: 5, hasMore: true, nextCursor: 'next' } },
    });
    assert.equal(formatPreparedSimpleRead(EXPENSE, expenseOutput(complete), TH).kind, 'answer');
    const partial = expenseData({ completeness: { aggregate: 'partial', rows: { returned: 5, hasMore: true, nextCursor: null } } });
    assert.equal(formatPreparedSimpleRead(EXPENSE, expenseOutput(partial), TH).kind, 'unverified');
  });

  it('states the excluded rejected/voided records as a condition, in both languages', () => {
    const data = expenseData({ total: 40, summary: expenseSummary({ countedItems: 40, cancelledCount: 3 }) });
    const th = formatPreparedSimpleRead(EXPENSE, expenseOutput(data), TH);
    const en = formatPreparedSimpleRead(EXPENSE, expenseOutput(data), EN);
    if (th.kind === 'answer') assert.match(th.replyText, /\nไม่รวมรายการที่ยกเลิกหรือถูกปฏิเสธ 3 รายการ/);
    if (en.kind === 'answer') assert.match(en.replyText, /\nExcludes 3 rejected or voided records/);
    // A period with nothing cancelled says nothing about cancellations.
    const clean = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData()), TH);
    if (clean.kind === 'answer') assert.doesNotMatch(clean.replyText, /ไม่รวมรายการ/);
  });

  it('renders an explicit-empty period as an honest zero', () => {
    const r = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData({
      total: 0, items: [], summary: expenseSummary({ countedItems: 0, totalAmount: 0, confirmedAmount: 0, paidAmount: 0 }),
    })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      assert.match(r.replyText, /^ค่าใช้จ่าย: 0\.00 บาท \(0 รายการ\)/);
      assert.match(r.replyText, /ฐานยอด: รวมรายการรอดำเนินการ 0\.00 บาท \(ในนั้นเป็นร่าง 0\.00 บาท\) และรายการยืนยันแล้ว 0\.00 บาท/);
    }
  });

  it('renders satang precision, not the float noise of a summed JS number', () => {
    // 33.33 + 66.67 sums to 100.00000000000001 in the tool; the answer must not show that.
    const r = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData({ total: 2, summary: expenseSummary({ countedItems: 2, totalAmount: 33.33 + 66.67 }) })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /^ค่าใช้จ่าย: 100\.00 บาท \(2 รายการ\)/);
  });

  it('uses the effective source period even for one-sided or conflicting proposed dates, and never fabricates one', () => {
    const requested = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData()), { ...TH, proposedInput: { fromDate: '2026-07-01', toDate: '2026-07-31' } });
    if (requested.kind === 'answer') assert.match(requested.replyText, /\nช่วง: 1 สิงหาคม 2569 – 25 สิงหาคม 2569/);
    const oneSided = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData()), { ...TH, proposedInput: { fromDate: '2026-08-01' } });
    if (oneSided.kind === 'answer') assert.match(oneSided.replyText, /\nช่วง: 1 สิงหาคม 2569 – 25 สิงหาคม 2569/);
    // No proposed dates (the tool's current-month default): the tool's own echoed window is stated.
    const echoed = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData()), { ...TH, proposedInput: {} });
    if (echoed.kind === 'answer') assert.match(echoed.replyText, /\nช่วง: 1 สิงหาคม 2569 – 25 สิงหาคม 2569/);
    // Neither names a period → the line is omitted rather than assuming a default the tool may not have used.
    const noPeriod = expenseData();
    delete noPeriod['period'];
    const omitted = formatPreparedSimpleRead(EXPENSE, expenseOutput(noPeriod), TH);
    if (omitted.kind === 'answer') assert.doesNotMatch(omitted.replyText, /ช่วง:/);
  });

  it('localizes the tool-defaulted month and uses the Bangkok date for an as-of instant near UTC midnight', () => {
    const output = expenseOutput(expenseData({
      period: { fromDate: '2026-08-01', toDate: '2026-08-31', defaultedToCurrentMonth: true },
    }), '2026-08-25T18:00:00.000Z');
    const r = formatPreparedSimpleRead(EXPENSE, output, { ...TH, proposedInput: {} });
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /\nช่วง: 1 สิงหาคม 2569 – 31 สิงหาคม 2569/);
    assert.match(r.replyText, /\nข้อมูล ณ 26 สิงหาคม 2569/);
    assert.doesNotMatch(r.replyText, /2026-08-(?:01|25|26|31)/);
  });

  it('returns unverified when the total is absent or the summary is missing', () => {
    const noTotal = expenseSummary();
    delete noTotal['totalAmount'];
    assert.equal(formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData({ summary: noTotal })), TH).kind, 'unverified');
    const noSummary = expenseData();
    delete noSummary['summary'];
    assert.equal(formatPreparedSimpleRead(EXPENSE, expenseOutput(noSummary), TH).kind, 'unverified');
    assert.equal(formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData({ summary: 'nope' })), TH).kind, 'unverified');
  });

  it('returns unverified when the tool admits its page cap truncated the period', () => {
    // `truncated` means the total covers only the first pages — answering with it would understate spend.
    const r = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData({ total: 1000, truncated: true })), TH);
    assert.equal(r.kind, 'unverified');
  });
});

// ── F2 — accounting.get_summary::list ("สรุปรายการเดือนนี้") ──────────────────────────────────────
// Fixture shape copied from the real tool result (apps/api .../erp-business-tools.use-case.ts
// `AccountingGetSummaryTool`): `total` = the period's document count, `byType[type] = {count, totalAmount}`,
// plus the effective `period`. The tool returns NO overall amount, so the answer prints none.
const ACCOUNTING_SOURCE: SourceRef = {
  label: 'สรุปเอกสารบัญชี', module: 'accounting-documents', entityType: 'accounting_document_summary',
  permissionChecked: true, webPath: '/companies/c1/accounting',
};
const accountingOutput = (data: Record<string, unknown>): SpecialistOutput => readOutput('accounting.get_summary', data, ACCOUNTING_SOURCE);
const accountingData = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  period: { fromDate: '2026-08-01', toDate: '2026-08-31', defaultedToCurrentMonth: true },
  total: 42,
  byType: { INVOICE: { count: 12, totalAmount: 120000 }, RECEIPT: { count: 30, totalAmount: 88000.5 } },
  ...over,
});

describe('F2 accounting.get_summary::list — สรุปรายการเดือนนี้', () => {
  it('lists count and amount per document type with plain Thai labels, most documents first', () => {
    const r = formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^เอกสารบัญชี: 42 รายการ/);
    assert.match(r.replyText, /\n• ใบเสร็จรับเงิน 30 รายการ 88,000\.50 บาท\n• ใบแจ้งหนี้ 12 รายการ 120,000\.00 บาท/);
    // C6 (batch 5c): calendar dates, not raw ISO — for both the period line and "ข้อมูล ณ".
    assert.match(r.replyText, /\nช่วง: 1 ส\.ค\. 2569 – 31 ส\.ค\. 2569/);
    assert.equal(r.sourceRefs[0]?.label, 'สรุปเอกสารบัญชี');
    assert.doesNotMatch(r.replyText, /ที่มา:|Source:/);
    assert.match(r.replyText, /\nข้อมูล ณ 25 ส\.ค\. 2569/);
    assert.equal(r.webLinks[0]?.path, '/companies/c1/accounting');
    assert.equal(r.replyText, r.replyText.normalize('NFC'));
    // No overall amount is printed: the tool totals money per type only.
    assert.doesNotMatch(r.replyText, /208,000/);
  });

  it('answers in English with humanized type labels', () => {
    const r = formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData({
      total: 3, byType: { TAX_INVOICE: { count: 3, totalAmount: '4,500' } },
    })), EN);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      assert.match(r.replyText, /^Accounting documents: 3 records/);
      assert.match(r.replyText, /\n• Tax invoice 3 records, 4,500\.00 THB/);
    }
  });

  it('renders an exact Decimal-string aggregate UNCHANGED — no binary float at the last step (PR #238 R3)', () => {
    // 90071992547409.93 cannot round-trip a JS Number (Number(...).toFixed(2) says ...94): the API
    // keeps it as an exact string end-to-end, so the FINAL user-facing render must too — one satang
    // silently changed here would undo the whole Decimal pipeline.
    const r = formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData({
      total: 1, byType: { INVOICE: { count: 1, totalAmount: '90071992547409.93' } },
    })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      assert.match(r.replyText, /90,071,992,547,409\.93 บาท/);
      assert.doesNotMatch(r.replyText, /409\.94/);
    }
    // Half-satang strings round HALF-UP decimally (the float path used to round 1.005 down).
    const half = formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData({
      total: 1, byType: { INVOICE: { count: 1, totalAmount: '1.005' } },
    })), TH);
    if (half.kind === 'answer') assert.match(half.replyText, /1\.01 บาท/);
    // Carry across the decimal point and through 9s — pure string math must handle 999.995 → 1,000.00.
    const carry = formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData({
      total: 1, byType: { INVOICE: { count: 1, totalAmount: '999.995' } },
    })), TH);
    if (carry.kind === 'answer') assert.match(carry.replyText, /1,000\.00 บาท/);
  });

  it('keeps an unknown document type as its raw key instead of inventing a label', () => {
    const r = formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData({
      total: 2, byType: { DELIVERY_ORDER: { count: 2, totalAmount: 500 } },
    })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /\n• DELIVERY_ORDER 2 รายการ 500\.00 บาท/);
  });

  it('renders an explicit-empty month as an honest zero with no type lines', () => {
    const r = formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData({ total: 0, byType: {} })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      assert.match(r.replyText, /^เอกสารบัญชี: 0 รายการ/);
      assert.doesNotMatch(r.replyText, /•/);
    }
  });

  it('bounds the bubble at five types and admits how many types exist', () => {
    const byType: Record<string, unknown> = {};
    const types = ['QUOTATION', 'INVOICE', 'BILLING_NOTE', 'RECEIPT', 'TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'];
    types.forEach((type, index) => { byType[type] = { count: index + 1, totalAmount: (index + 1) * 100 }; });
    const r = formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData({ total: 28, byType })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      assert.equal(r.replyText.split('•').length - 1, 5);
      assert.match(r.replyText, /\nแสดง 5 จาก 7 ประเภท/);
      assert.match(r.replyText, /• ใบเพิ่มหนี้ 7 รายการ 700\.00 บาท/);
    }
  });

  it('states the REQUESTED period from the validated proposed input over the echoed one (English)', () => {
    const r = formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData()), { ...EN, proposedInput: { fromDate: '2026-08-01', toDate: '2026-08-15' } });
    // C6 (batch 5c): a calendar date, not the raw ISO range.
    if (r.kind === 'answer') assert.match(r.replyText, /\nPeriod: 1 Aug 2026 – 15 Aug 2026/);
    const noPeriod = accountingData();
    delete noPeriod['period'];
    const omitted = formatPreparedSimpleRead(ACCOUNTING, accountingOutput(noPeriod), EN);
    if (omitted.kind === 'answer') assert.doesNotMatch(omitted.replyText, /Period:/);
  });

  it('returns unverified when the per-type roll-up does not account for every counted document (G1)', () => {
    // The tool now refuses this itself (`unavailable` + SUMMARY_COUNT_MISMATCH / SUMMARY_PERIOD_TOO_LARGE
    // after its bounded page walk), so this is defense in depth: partial numbers must never be printed as
    // the month's answer, whatever produced them.
    const r = formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData({ total: 500 })), TH);
    assert.equal(r.kind, 'unverified');
  });

  it('renders a float per-type amount at satang precision (byType totals are JS numbers, not decimals)', () => {
    const r = formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData({
      total: 4, byType: { INVOICE: { count: 4, totalAmount: 1234.5 } },
    })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /\n• ใบแจ้งหนี้ 4 รายการ 1,234\.50 บาท/);
  });

  it('sends a non-success read to the authoritative terminal with no numbers (unavailable → FAILED)', () => {
    // `unavailable` (either G1 self-check code) reaches the specialist as a FAILED output with no
    // toolData, so the lane must answer with the honest terminal, never with a formatted number.
    const failed: SpecialistOutput = {
      agent: 'accounting', status: 'FAILED', summary: 'ไม่สามารถดึงข้อมูลได้ในขณะนี้',
      facts: [], suggestions: [], toolCalls: [{ name: 'accounting.get_summary', status: 'unavailable', durationMs: 1 }],
      requiresHumanReview: false, toolData: [], asOf: undefined,
    };
    assert.equal(formatPreparedSimpleRead(ACCOUNTING, failed, TH).kind, 'unverified');
    assert.match(preparedTerminalReply(failed, TH), /ยังดึงข้อมูลส่วนนี้ไม่ได้/);
    assert.match(preparedTerminalReply(failed, EN), /can't fetch this data right now/);
    assert.match(preparedTerminalReply({ ...failed, status: 'PERMISSION_DENIED' }, TH), /ไม่มีสิทธิ์/);
  });

  // C4 (batch 5c, T-008-b "แล้วร้านกาแฟอเมซอนล่ะคะ"): expense.list_recent's own vendorUnresolved/
  // branchUnresolved/branchAmbiguous/branchOutOfScope/categoryUnresolved/... result matches no
  // compiled formatter's shape (none of them know these keys), so it used to fall all the way to the
  // generic "system read failure" terminal below — burying the tool's own honest catalog answer.
  it('renders the name-resolution reply, not the generic read-failure line, for an unresolved vendor (C4)', () => {
    const vendorUnresolvedOutput: SpecialistOutput = {
      agent: 'accounting', status: 'SUCCEEDED', summary: '', facts: [], suggestions: [], requiresHumanReview: false,
      toolCalls: [{ name: 'expense.list_recent', status: 'ok', durationMs: 1 }],
      toolData: [{ tool: 'expense.list_recent', data: {
        vendorUnresolved: 'ร้านกาแฟอเมซอน',
        availableVendors: [{ id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'Grab' }],
      } }],
      asOf: '2026-09-28T00:00:00Z',
    };
    assert.equal(formatPreparedSimpleRead(EXPENSE, vendorUnresolvedOutput, TH).kind, 'unverified');
    const reply = preparedTerminalReply(vendorUnresolvedOutput, TH);
    assert.match(reply, /ไม่พบร้านชื่อ "ร้านกาแฟอเมซอน" ค่ะ/);
    assert.match(reply, /ร้านสมใจ/);
    assert.doesNotMatch(reply, /ยังดึงข้อมูลส่วนนี้ไม่ได้/);
  });

  it('returns unverified when the tool flags its aggregation as incomplete (additive G1 field)', () => {
    for (const flag of [{ truncated: true }, { byTypePartial: 1 }, { cappedPages: true }]) {
      assert.equal(formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData(flag)), TH).kind, 'unverified');
    }
    // A falsy flag is not an incompleteness claim — the verified answer still renders.
    assert.equal(formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData({ truncated: false })), TH).kind, 'answer');
  });

  it('returns unverified for an absent total or a malformed byType entry', () => {
    const noTotal = accountingData();
    delete noTotal['total'];
    assert.equal(formatPreparedSimpleRead(ACCOUNTING, accountingOutput(noTotal), TH).kind, 'unverified');
    assert.equal(formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData({ byType: { INVOICE: 12 } })), TH).kind, 'unverified');
    assert.equal(formatPreparedSimpleRead(ACCOUNTING, accountingOutput(accountingData({
      total: 12, byType: { INVOICE: { count: 12 } },
    })), TH).kind, 'unverified');
  });

  it('returns unverified when the answer would come from another tool\'s data', () => {
    assert.equal(formatPreparedSimpleRead(ACCOUNTING, expenseOutput(expenseData()), TH).kind, 'unverified');
    assert.equal(formatPreparedSimpleRead(EXPENSE, accountingOutput(accountingData()), TH).kind, 'unverified');
  });
});

// ── F3 — expense.get_daily_closing::single_metric ("ค่าใช้จ่ายวันนี้") ────────────────────────────
// Owner decision 2026-08-26: the "เงินเข้า–ออกวันนี้" question is narrowed to the EXPENSE side, served by
// the existing tool. Fixture shape copied from the real result (apps/api .../erp-expense-daily-closing
// .use-case.ts:272-323): `date` + `timezone`, `occurredToday.{totals,paid,outstanding}` as per-currency
// rows whose `total` is a 4-decimal STRING, `occurredToday.items.total` as the day's record count, the
// open review/evidence/duplicate counts, and `observability.truncated` for the DETAIL lists only.
// C6 (batch 5c): the real tool's label is now Thai-dated too (erp-expense-daily-closing.use-case.ts's
// thaiAbbrDateLabel), so this fixture matches what the formatter actually receives.
const DAILY_SOURCE: SourceRef = {
  label: 'สรุปปิดร้าน 26 ส.ค. 2569', module: 'expenses', entityType: 'expense_daily_closing',
  permissionChecked: true, webPath: '/companies/c1/expenses',
};
/** 07:30Z is 14:30 in Asia/Bangkok on the same civil day — the owner template's "ถึง 14:30". */
const DAILY_AS_OF = '2026-08-26T07:30:00Z';
const bounded = (total: number) => ({ total, shown: 0, remaining: total, items: [] });
const dailyOutput = (data: Record<string, unknown>, asOf = DAILY_AS_OF): SpecialistOutput =>
  readOutput('expense.get_daily_closing', data, DAILY_SOURCE, asOf);
const dailyData = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  date: '2026-08-26',
  timezone: 'Asia/Bangkok',
  scope: { kind: 'all_branches' },
  occurredToday: {
    totals: [{ currency: 'THB', count: 3, total: '2450.0000' }],
    paid: [{ currency: 'THB', count: 1, total: '1200.0000' }],
    outstanding: [{ currency: 'THB', count: 2, total: '1250.0000' }],
    items: { total: 3, shown: 3, remaining: 0, items: [{ id: 'e1', expenseNumber: 'EXP-2026-0009' }] },
  },
  submittedToday: { count: 3 },
  dueEndOfDay: { totals: [], items: bounded(0) },
  overdue: { totals: [], items: bounded(0) },
  unscheduledOutstanding: { totals: [], items: bounded(0) },
  pendingReview: { count: 1, items: bounded(1) },
  evidenceBlockers: { count: 1, items: bounded(1) },
  duplicateRisks: { count: 0, items: bounded(0) },
  excluded: { rejected: 0, voided: 0 },
  observability: { queryDurationMs: 12, queryCount: 16, truncated: false },
  limitations: { neverSubmittedDocumentsObservable: false },
  webUrl: '/companies/c1/expenses',
  ...over,
});
const emptyDay = (): Record<string, unknown> => dailyData({
  occurredToday: { totals: [], paid: [], outstanding: [], items: bounded(0) },
  submittedToday: { count: 0 },
  pendingReview: { count: 0, items: bounded(0) },
  evidenceBlockers: { count: 0, items: bounded(0) },
});

describe('F3 expense.get_daily_closing::single_metric — ค่าใช้จ่ายวันนี้', () => {
  it('answers the owner template: day, count, total, paid/unpaid, to-do checklist, source honesty (Thai)', () => {
    const r = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^วันนี้ \(26 ส\.ค\.\) มีค่าใช้จ่าย 3 รายการ รวม 2,450\.00 บาท/);
    assert.match(r.replyText, /\nจ่ายแล้ว 1,200\.00 บาท · ยังไม่ได้จ่าย 1,250\.00 บาท/);
    // C5 (batch 5c, T-102-a): "มีอะไรต้องทำบ้าง" checklist — one bullet per non-empty section, fixed
    // order. dueEndOfDay/overdue are empty in this fixture, so only these three bullets appear.
    assert.match(r.replyText, /\n• ส่งเข้ามาวันนี้ 3 รายการ\n• รอตรวจสอบ 1 รายการ\n• รอตรวจหลักฐาน 1 รายการ\n/);
    assert.equal(r.sourceRefs[0]?.label, 'สรุปปิดร้าน 26 ส.ค. 2569');
    assert.doesNotMatch(r.replyText, /ที่มา:|Source:/);
    // C6 (batch 5c): a Thai calendar date, not the raw ISO string.
    assert.match(r.replyText, /\nข้อมูล ณ 26 ส\.ค\. 2569/);
    // REQUIRED source honesty (spec G5): recorded entries with the wall-clock cut-off, not bank movement.
    assert.match(r.replyText, /\n\(จากรายการที่บันทึกในระบบ ถึง 14:30 — ไม่ใช่ยอดเงินเข้าออกธนาคาร\)$/);
    // Expense side only (owner decision 2026-08-26): no profit, and the ONLY "เงินเข้า" in the answer is
    // the honesty line's denial of it — the numbers above it never claim money in.
    assert.doesNotMatch(r.replyText.split('\n(จากรายการ')[0]!, /กำไร|เงินเข้า/);
    assert.doesNotMatch(r.replyText, /EXP-2026-0009/, 'bounded: raw records stay out of the bubble');
    assert.equal(r.webLinks[0]?.path, '/companies/c1/expenses');
    assert.equal(r.replyText, r.replyText.normalize('NFC'));
  });

  it('answers in English with the same grounded numbers, checklist, and the same honesty line', () => {
    const r = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData()), EN);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    // C6 (batch 5c): "Today" stays year-free, like the Thai side.
    assert.match(r.replyText, /^Today \(26 Aug\): 3 expense records, total 2,450\.00 THB/);
    assert.match(r.replyText, /\nPaid 1,200\.00 THB · Unpaid 1,250\.00 THB/);
    assert.match(r.replyText, /\n• Submitted today: 3 records\n• Pending review: 1 record\n• Awaiting evidence review: 1 record\n/);
    assert.match(r.replyText, /\n\(From entries recorded in the system, up to 14:30 — not bank money in\/out\)$/);
  });

  // C5 (batch 5c, T-102-a exact fixture): all six checklist sections populated, including the two money
  // ones (dueEndOfDay/overdue) this default fixture leaves empty, and the exact numbers the eval checks.
  it('renders every non-empty checklist section, including the two due/overdue money bullets', () => {
    const r = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData({
      submittedToday: { count: 32 },
      pendingReview: { count: 12, items: bounded(12) },
      dueEndOfDay: { totals: [{ currency: 'THB', count: 2, total: '900.0000' }], items: bounded(2) },
      overdue: { totals: [{ currency: 'THB', count: 3, total: '1500.0000' }], items: bounded(3) },
      unscheduledOutstanding: { totals: [{ currency: 'THB', count: 22, total: '37843.0000' }], items: bounded(22) },
      evidenceBlockers: { count: 28, items: bounded(28) },
    })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, new RegExp([
      '• ส่งเข้ามาวันนี้ 32 รายการ',
      '• รอตรวจสอบ 12 รายการ',
      '• ครบกำหนดจ่ายวันนี้ 2 รายการ รวม 900\\.00 บาท',
      '• เกินกำหนดจ่าย 3 รายการ รวม 1,500\\.00 บาท',
      '• ค้างจ่าย \\(ยังไม่กำหนดวันจ่าย\\) 22 รายการ รวม 37,843\\.00 บาท',
      '• รอตรวจหลักฐาน 28 รายการ',
    ].join('\\n')));
  });

  it('renders an explicit-empty day as an honest zero and states no amount the tool did not return', () => {
    const r = formatPreparedSimpleRead(DAILY, dailyOutput(emptyDay()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    // F5 (tuning-6b, T-102-a/T-017-a): "มีค่าใช้จ่าย 0 รายการ" read as "nothing happened today" — say
    // explicitly that this counts expenses DATED today, never what was submitted.
    assert.match(r.replyText, /^วันนี้ \(26 ส\.ค\.\) ยังไม่มีรายการค่าใช้จ่ายที่ลงวันที่วันนี้\n/);
    assert.doesNotMatch(r.replyText, /มีค่าใช้จ่าย 0 รายการ/);
    assert.doesNotMatch(r.replyText, /รวม |จ่ายแล้ว|ยังไม่ได้จ่าย|รอตรวจหลักฐาน/);
    // C5: every checklist section is zero on this fixture, so no bullet (•) renders at all.
    assert.doesNotMatch(r.replyText, /•|ส่งเข้ามาวันนี้|รอตรวจสอบ|ครบกำหนดจ่าย|เกินกำหนดจ่าย|ค้างจ่าย/);
    assert.match(r.replyText, /ไม่ใช่ยอดเงินเข้าออกธนาคาร\)$/, 'the honesty line is required even on an empty day');
  });

  // F5 (tuning-6b, T-102-a exact fixture): zero expenses DATED today must not read as "nothing
  // happened today" when the checklist right below it shows real same-day activity.
  it('states the zero headline as "no records dated today", not a bare zero, even when the checklist below has real counts', () => {
    const r = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData({
      occurredToday: { totals: [], paid: [], outstanding: [], items: bounded(0) },
      submittedToday: { count: 32 },
      pendingReview: { count: 12, items: bounded(12) },
      unscheduledOutstanding: { totals: [{ currency: 'THB', count: 22, total: '37843.0000' }], items: bounded(22) },
      evidenceBlockers: { count: 28, items: bounded(28) },
    })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^วันนี้ \(26 ส\.ค\.\) ยังไม่มีรายการค่าใช้จ่ายที่ลงวันที่วันนี้\n/);
    assert.doesNotMatch(r.replyText, /มีค่าใช้จ่าย 0 รายการ/);
    assert.match(r.replyText, /• ส่งเข้ามาวันนี้ 32 รายการ/);
  });

  it('states each currency the tool returned and never adds currencies together', () => {
    const r = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData({
      occurredToday: {
        totals: [{ currency: 'THB', count: 2, total: '2450.0000' }, { currency: 'USD', count: 1, total: '100.5000' }],
        paid: [], outstanding: [{ currency: 'USD', count: 1, total: '100.5000' }],
        items: bounded(3),
      },
    })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /รวม 2,450\.00 บาท · 100\.50 USD/);
    assert.match(r.replyText, /\nยังไม่ได้จ่าย 100\.50 USD/);
    assert.doesNotMatch(r.replyText, /จ่ายแล้ว/, 'a bucket the tool reported empty is not printed');
    assert.doesNotMatch(r.replyText, /2,550|2550/, 'currencies are never summed');
  });

  it('says "วันนี้" only when the tool\'s own as-of day is the day it answered for', () => {
    // Explicit past day (the lane may pass a backed `date`): the answer names that day, never "today".
    const past = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData({ date: '2026-08-25' })), TH);
    if (past.kind === 'answer') {
      // C6 (batch 5c): a Thai calendar date, not the raw ISO string — always with its year (spec §3.4).
      assert.match(past.replyText, /^วันที่ 25 ส\.ค\. 2569 มีค่าใช้จ่าย 3 รายการ/);
      assert.doesNotMatch(past.replyText, /วันนี้/);
    }
    const pastEn = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData({ date: '2026-08-25' })), EN);
    if (pastEn.kind === 'answer') assert.match(pastEn.replyText, /^On 25 Aug 2026: /);
    // No usable as-of → no "today" claim and no invented cut-off time, but the honesty line stays.
    const noAsOf = formatPreparedSimpleRead(DAILY, { ...dailyOutput(dailyData()), asOf: undefined }, TH);
    if (noAsOf.kind === 'answer') {
      assert.match(noAsOf.replyText, /^วันที่ 26 ส\.ค\. 2569 /);
      assert.match(noAsOf.replyText, /\n\(จากรายการที่บันทึกในระบบ — ไม่ใช่ยอดเงินเข้าออกธนาคาร\)$/);
    }
  });

  it('answers for the day named by the validated proposed input, and refuses a day it disagrees with', () => {
    const agreeing = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData()), { ...TH, proposedInput: { date: '2026-08-26' } });
    assert.equal(agreeing.kind, 'answer');
    const disagreeing = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData()), { ...TH, proposedInput: { date: '2026-08-25' } });
    assert.equal(disagreeing.kind, 'unverified', 'requested day and answered day must be the same day');
  });

  it('still answers when only the DETAIL lists were capped (the money rows are complete aggregates)', () => {
    const r = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData({
      observability: { queryDurationMs: 12, queryCount: 16, truncated: true },
    })), TH);
    assert.equal(r.kind, 'answer');
    // A TOP-LEVEL incompleteness flag is a different claim and does block the answer.
    assert.equal(formatPreparedSimpleRead(DAILY, dailyOutput(dailyData({ truncated: true })), TH).kind, 'unverified');
  });

  it('returns unverified for a missing day, a missing occurred bucket, or malformed money rows', () => {
    for (const broken of [
      dailyData({ date: 'today' }),
      dailyData({ date: undefined }),
      dailyData({ occurredToday: undefined }),
      dailyData({ occurredToday: { totals: [], paid: [], outstanding: [], items: { total: 'many', items: [] } } }),
      dailyData({ occurredToday: { totals: [{ currency: 'THB' }], paid: [], outstanding: [], items: bounded(1) } }),
      dailyData({ occurredToday: { totals: 'none', paid: [], outstanding: [], items: bounded(1) } }),
    ]) {
      assert.equal(formatPreparedSimpleRead(DAILY, dailyOutput(broken), TH).kind, 'unverified');
    }
  });

  it('sends a non-success daily read to the authoritative terminal with no numbers', () => {
    const failed: SpecialistOutput = {
      agent: 'accounting', status: 'FAILED', summary: 'ไม่สามารถดึงรายการค่าใช้จ่ายได้ในขณะนี้',
      facts: [], suggestions: [], toolCalls: [{ name: 'expense.get_daily_closing', status: 'error', durationMs: 1 }],
      requiresHumanReview: false, toolData: [], asOf: undefined,
    };
    assert.equal(formatPreparedSimpleRead(DAILY, failed, TH).kind, 'unverified');
    assert.match(preparedTerminalReply(failed, TH), /ยังดึงข้อมูลส่วนนี้ไม่ได้/);
    assert.match(preparedTerminalReply(failed, EN), /can't fetch this data right now/);
    // Another family's data can never be answered as this one.
    assert.equal(formatPreparedSimpleRead(DAILY, expenseOutput(expenseData()), TH).kind, 'unverified');
    assert.equal(formatPreparedSimpleRead(EXPENSE, dailyOutput(dailyData()), TH).kind, 'unverified');
  });

  // Item 1 (spec R-A1 row 18, eval: 15 turns): this tool has no queryApplied wrapper, so its own
  // accessScope rides `data.accessScope` directly (see erp-expense-daily-closing.use-case.ts).
  it('item 1: states the own-scope line when data.accessScope is own, omits it for company', () => {
    const own = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData({ accessScope: 'own' })), TH);
    assert.equal(own.kind, 'answer');
    if (own.kind === 'answer') assert.match(own.replyText, /\nขอบเขต: เฉพาะรายการของคุณ/);
    const company = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData({ accessScope: 'company' })), TH);
    assert.equal(company.kind, 'answer');
    if (company.kind === 'answer') assert.doesNotMatch(company.replyText, /ขอบเขต:/);
  });
});

// ── F4 — tax.get_vat_summary::single_metric ("ภาษีมูลค่าเพิ่มงวดนี้ต้องยื่นเท่าไหร่") ─────────────────
// Fixture shape copied from the real tool result (apps/api .../erp-tax-tools.use-case.ts
// `TaxGetVatSummaryTool`): the period key it read, the period `status`, `vatOutput` / `vatInput` /
// `netVat` as 2-decimal STRINGS (`displayMoney`), the ACTIVE `eventCount`, `currency`, and a disclaimer.
const VAT_SOURCE: SourceRef = {
  label: 'งวดภาษี 2026-08', module: 'tax', entityType: 'tax_period',
  permissionChecked: true, webPath: '/companies/c1/tax',
};
const vatOutput = (data: Record<string, unknown>): SpecialistOutput => readOutput('tax.get_vat_summary', data, VAT_SOURCE);
const vatData = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  periodKey: '2026-08', status: 'OPEN',
  vatOutput: '10000.00', vatInput: '6500.00', netVat: '3500.00',
  eventCount: 12, currency: 'THB',
  disclaimer: 'ข้อมูลสรุปนี้ยังไม่ผ่านการรับรองจากนักบัญชี กรุณาตรวจสอบและยืนยันก่อนยื่นแบบ',
  ...over,
});

describe('F4 tax.get_vat_summary::single_metric — VAT งวดนี้', () => {
  it('answers with the net payable, both sides, the raw period status, source, as-of and the not-certified line (Thai)', () => {
    const r = formatPreparedSimpleRead(VAT, vatOutput(vatData()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^VAT งวด 2026-08: ต้องนำส่ง 3,500\.00 บาท/);
    assert.match(r.replyText, /\nภาษีขาย 10,000\.00 บาท · ภาษีซื้อ 6,500\.00 บาท \(12 รายการ\)/);
    assert.match(r.replyText, /\nสถานะงวด: OPEN/);
    assert.equal(r.sourceRefs[0]?.label, 'งวดภาษี 2026-08');
    assert.doesNotMatch(r.replyText, /ที่มา:|Source:/);
    // C6 (batch 5c): a Thai calendar date, not the raw ISO string.
    assert.match(r.replyText, /\nข้อมูล ณ 25 ส\.ค\. 2569/);
    // REQUIRED: a read summary is never presented as a certified/filed return.
    assert.match(r.replyText, /\n\(ยังไม่ผ่านการรับรองจากนักบัญชี กรุณาตรวจสอบก่อนยื่นแบบ\)$/);
    assert.equal(r.webLinks[0]?.path, '/companies/c1/tax');
    assert.equal(r.replyText, r.replyText.normalize('NFC'));
  });

  it('answers in English with the same grounded numbers', () => {
    const r = formatPreparedSimpleRead(VAT, vatOutput(vatData()), EN);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^VAT 2026-08: 3,500\.00 THB to remit/);
    assert.match(r.replyText, /\nOutput VAT 10,000\.00 THB · Input VAT 6,500\.00 THB \(12 records\)/);
    assert.match(r.replyText, /\nPeriod status: OPEN/);
    assert.match(r.replyText, /\n\(Not certified by an accountant — check before filing\)$/);
  });

  it('never states a negative amount to remit: an input-heavy period says which side is bigger', () => {
    for (const net of ['-1200.00', -1200]) {
      const th = formatPreparedSimpleRead(VAT, vatOutput(vatData({ netVat: net, vatOutput: '5000.00', vatInput: '6200.00' })), TH);
      assert.equal(th.kind, 'answer');
      if (th.kind === 'answer') {
        assert.match(th.replyText, /^VAT งวด 2026-08: ภาษีซื้อมากกว่าภาษีขาย 1,200\.00 บาท/);
        assert.doesNotMatch(th.replyText, /ต้องนำส่ง|-1,200/);
      }
      const en = formatPreparedSimpleRead(VAT, vatOutput(vatData({ netVat: net, vatOutput: '5000.00', vatInput: '6200.00' })), EN);
      if (en.kind === 'answer') assert.match(en.replyText, /^VAT 2026-08: input VAT exceeds output VAT by 1,200\.00 THB/);
    }
  });

  it('renders an explicit-empty period as an honest zero', () => {
    const r = formatPreparedSimpleRead(VAT, vatOutput(vatData({ vatOutput: '0.00', vatInput: '0.00', netVat: '0.00', eventCount: 0 })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /^VAT งวด 2026-08: ต้องนำส่ง 0\.00 บาท\nภาษีขาย 0\.00 บาท · ภาษีซื้อ 0\.00 บาท \(0 รายการ\)/);
  });

  it('states the currency the tool reported and never assumes baht', () => {
    const r = formatPreparedSimpleRead(VAT, vatOutput(vatData({ currency: 'USD' })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      assert.match(r.replyText, /ต้องนำส่ง 3,500\.00 USD/);
      assert.doesNotMatch(r.replyText, /บาท/);
    }
    // No currency at all → the unit cannot be stated, so nothing is.
    const noCurrency = vatData();
    delete noCurrency['currency'];
    assert.equal(formatPreparedSimpleRead(VAT, vatOutput(noCurrency), TH).kind, 'unverified');
  });

  it('returns unverified for the tool\'s no-data branch and for any missing/typeless amount', () => {
    // The real "ยังไม่มีข้อมูล VAT งวดนี้" result carries a message instead of amounts — never a zero.
    assert.equal(formatPreparedSimpleRead(VAT, vatOutput({
      periodKey: '2026-08', message: 'ยังไม่มีข้อมูล VAT งวดนี้', disclaimer: 'ซิงค์ข้อมูลก่อนหรือตรวจสอบกับนักบัญชี',
    }), TH).kind, 'unverified');
    for (const broken of [
      vatData({ netVat: null }), vatData({ netVat: 'สามพัน' }), vatData({ vatInput: undefined }),
      vatData({ eventCount: '12' }), vatData({ eventCount: 1.5 }), vatData({ periodKey: '' }),
      vatData({ truncated: true }),
    ]) {
      assert.equal(formatPreparedSimpleRead(VAT, vatOutput(broken), TH).kind, 'unverified');
    }
    // Omits the status line rather than inventing one; the rest of the answer still renders.
    const noStatus = vatData();
    delete noStatus['status'];
    const r = formatPreparedSimpleRead(VAT, vatOutput(noStatus), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.doesNotMatch(r.replyText, /สถานะงวด/);
  });
});

// ── F5 — inventory.list_low_stock::list ("สินค้าอะไรใกล้หมดบ้าง") ──────────────────────────────────
// Fixture shape copied from the real tool result (apps/api .../erp-tools.use-case.ts
// `InventoryListLowStockTool`): the COMPLETE `count` of at-or-below-reorder-point items plus a ten-row
// preview of `{productId, quantity, locationId}` — no name, sku or unit anywhere in the result.
const LOW_STOCK_SOURCE: SourceRef = {
  label: 'สินค้าใกล้หมด', module: 'inventory', entityType: 'low_stock_report',
  permissionChecked: true, webPath: '/companies/c1/inventory',
};
const lowStockOutput = (data: Record<string, unknown>): SpecialistOutput =>
  ({ ...readOutput('inventory.list_low_stock', data, LOW_STOCK_SOURCE), agent: 'inventory' });
const lowStockData = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  count: 3,
  items: [
    { productId: '11111111-1111-4111-8111-111111111111', quantity: '2.0000', locationId: 'loc-1' },
    { productId: '22222222-2222-4222-8222-222222222222', quantity: '0.0000', locationId: 'loc-1' },
    { productId: '33333333-3333-4333-8333-333333333333', quantity: '1.5000', locationId: 'loc-2' },
  ],
  ...over,
});

describe('F5 inventory.list_low_stock::list — สินค้าใกล้หมด', () => {
  it('answers with the grounded count, the low-stock report as source, as-of and link (Thai)', () => {
    const r = formatPreparedSimpleRead(LOW_STOCK, lowStockOutput(lowStockData()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^สินค้าใกล้หมด \(ถึงหรือต่ำกว่าจุดสั่งซื้อ\): 3 รายการ/);
    assert.equal(r.sourceRefs[0]?.label, 'สินค้าใกล้หมด');
    assert.doesNotMatch(r.replyText, /ที่มา:|Source:/);
    // C6 (batch 5c): a Thai calendar date, not the raw ISO string.
    assert.match(r.replyText, /\nข้อมูล ณ 25 ส\.ค\. 2569/);
    assert.equal(r.webLinks[0]?.path, '/companies/c1/inventory');
    assert.equal(r.replyText, r.replyText.normalize('NFC'));
    // The result carries no product name, so none is claimed — and no raw id reaches the bubble.
    assert.doesNotMatch(r.replyText, /11111111|loc-1|2\.0000/);
  });

  it('answers in English and renders an explicit-empty result as an honest zero', () => {
    const en = formatPreparedSimpleRead(LOW_STOCK, lowStockOutput(lowStockData({ count: 1, items: [lowStockData()['items'] as never].flat().slice(0, 1) })), EN);
    if (en.kind === 'answer') assert.match(en.replyText, /^Low stock: 1 item at or below the reorder point/);
    const zero = formatPreparedSimpleRead(LOW_STOCK, lowStockOutput({ count: 0, items: [] }), TH);
    assert.equal(zero.kind, 'answer');
    if (zero.kind === 'answer') assert.match(zero.replyText, /^สินค้าใกล้หมด \(ถึงหรือต่ำกว่าจุดสั่งซื้อ\): 0 รายการ/);
    const zeroEn = formatPreparedSimpleRead(LOW_STOCK, lowStockOutput({ count: 0, items: [] }), EN);
    if (zeroEn.kind === 'answer') assert.match(zeroEn.replyText, /^Low stock: 0 items at or below the reorder point/);
  });

  it('returns unverified for a missing/typeless count, an incompleteness flag, or another tool\'s data', () => {
    for (const broken of [{ items: [] }, { count: '3' }, { count: -1 }, { count: 2.5 }, lowStockData({ truncated: true })]) {
      assert.equal(formatPreparedSimpleRead(LOW_STOCK, lowStockOutput(broken), TH).kind, 'unverified');
    }
    assert.equal(formatPreparedSimpleRead(LOW_STOCK, expenseOutput(expenseData()), TH).kind, 'unverified');
  });
});

// ── F6 — procurement.get_ap_outstanding::single_metric / ::list ("ยอดค้างจ่ายซัพพลายเออร์") ────────
// Fixture shape copied from the real tool result (apps/api .../erp-business-tools.use-case.ts
// `ProcurementApOutstandingTool`): the aging cut-off day, the complete outstanding total as a Decimal
// STRING, the supplier count, and a five-row preview whose `supplier` is the supplier ID.
const AP_SOURCE: SourceRef = {
  label: 'เจ้าหนี้ค้างจ่าย', module: 'procurement', entityType: 'ap_aging',
  permissionChecked: true, webPath: '/companies/c1/procurement',
};
const apOutput = (data: Record<string, unknown>): SpecialistOutput => readOutput('procurement.get_ap_outstanding', data, AP_SOURCE);
const apData = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  asOfDate: '2026-08-25',
  totalOutstanding: '125400.0000',
  supplierCount: 8,
  topSuppliers: [{ supplier: '44444444-4444-4444-8444-444444444444', totalOutstanding: '50000.0000' }],
  ...over,
});

describe('F6 procurement.get_ap_outstanding — ยอดค้างจ่ายเจ้าหนี้', () => {
  it('answers with the total for the tool\'s own cut-off day, the supplier count, source, as-of and link', () => {
    const r = formatPreparedSimpleRead(AP, apOutput(apData()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    // C6 (batch 5c): a Thai calendar date, not the raw ISO string.
    assert.match(r.replyText, /^ยอดค้างจ่ายเจ้าหนี้ ณ 25 ส\.ค\. 2569: 125,400\.00 บาท \(เจ้าหนี้ 8 ราย\)/);
    assert.equal(r.sourceRefs[0]?.label, 'เจ้าหนี้ค้างจ่าย');
    assert.doesNotMatch(r.replyText, /ที่มา:|Source:/);
    // C6 (batch 5c): a Thai calendar date, not the raw ISO string.
    assert.match(r.replyText, /\nข้อมูล ณ 25 ส\.ค\. 2569/);
    assert.equal(r.webLinks[0]?.path, '/companies/c1/procurement');
    assert.equal(r.replyText, r.replyText.normalize('NFC'));
    // `supplier` is the supplier ID, not a display name — so no supplier is named.
    assert.doesNotMatch(r.replyText, /44444444|50,000/);
  });

  it('serves the same deterministic answer for the list shape (the advice picks the renderer only)', () => {
    const metric = formatPreparedSimpleRead(AP, apOutput(apData()), TH);
    const list = formatPreparedSimpleRead(AP_LIST, apOutput(apData()), TH);
    assert.equal(list.kind, 'answer');
    if (metric.kind === 'answer' && list.kind === 'answer') assert.equal(list.replyText, metric.replyText);
  });

  it('answers in English and renders a fully-paid day as an honest zero', () => {
    const en = formatPreparedSimpleRead(AP, apOutput(apData()), EN);
    if (en.kind === 'answer') assert.match(en.replyText, /^Unpaid supplier bills as of 25 Aug 2026: 125,400\.00 THB \(8 suppliers\)/);
    const zero = formatPreparedSimpleRead(AP, apOutput(apData({ totalOutstanding: '0.0000', supplierCount: 0, topSuppliers: [] })), TH);
    assert.equal(zero.kind, 'answer');
    if (zero.kind === 'answer') assert.match(zero.replyText, /^ยอดค้างจ่ายเจ้าหนี้ ณ 25 ส\.ค\. 2569: 0\.00 บาท \(เจ้าหนี้ 0 ราย\)/);
  });

  it('renders an exact Decimal-string total unchanged and rounds satang half-up', () => {
    const exact = formatPreparedSimpleRead(AP, apOutput(apData({ totalOutstanding: '90071992547409.93' })), TH);
    if (exact.kind === 'answer') {
      assert.match(exact.replyText, /90,071,992,547,409\.93 บาท/);
      assert.doesNotMatch(exact.replyText, /409\.94/);
    }
    const half = formatPreparedSimpleRead(AP, apOutput(apData({ totalOutstanding: '1.005' })), TH);
    if (half.kind === 'answer') assert.match(half.replyText, /1\.01 บาท/);
  });

  it('returns unverified for a missing/unparseable cut-off day, total or supplier count', () => {
    for (const broken of [
      apData({ asOfDate: 'today' }), apData({ asOfDate: undefined }),
      apData({ totalOutstanding: null }), apData({ totalOutstanding: '125,400 บาท' }),
      apData({ supplierCount: '8' }), apData({ truncated: true }),
    ]) {
      assert.equal(formatPreparedSimpleRead(AP, apOutput(broken), TH).kind, 'unverified');
    }
    assert.equal(formatPreparedSimpleRead(AP, dailyOutput(dailyData()), TH).kind, 'unverified');
  });
});

// ── F7 — crm.get_customer_summary::single_metric / ::list ("เดือนนี้มีลูกค้าใหม่กี่ราย") ─────────────
// Fixture shape copied from the real tool result (apps/api .../erp-crm-tools.use-case.ts
// `CrmGetCustomerSummaryTool` + `summarizeCustomers`): the new/total/active/inactive/archived counts,
// the validated `newCustomersSince` day, and the two basis flags that give `total` its meaning.
const CRM_SOURCE: SourceRef = {
  label: 'ลูกค้า', module: 'crm', entityType: 'customer_summary',
  permissionChecked: true, webPath: '/companies/c1/customers',
};
const crmOutput = (data: Record<string, unknown>): SpecialistOutput =>
  ({ ...readOutput('crm.get_customer_summary', data, CRM_SOURCE), agent: 'crm' });
const crmData = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  total: 42, active: 40, inactive: 0, archived: 2, newCustomers: 3,
  // The tool closes the new-customer window since the period resolver (spec §3.3), so the real shape
  // carries both ends. `newCustomersUntil: undefined` in an override reproduces the older open one.
  newCustomersSince: '2026-08-01', newCustomersUntil: '2026-08-31',
  totalIncludesArchived: true, totalExcludesMerged: true,
  ...over,
});

describe('F7 crm.get_customer_summary — ลูกค้าใหม่', () => {
  it('answers with the new count for the tool\'s own window, the total with its basis, source and as-of', () => {
    const r = formatPreparedSimpleRead(CRM, crmOutput(crmData()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    // C6 (batch 5c): the window is a Thai calendar range, not raw ISO dates.
    assert.match(r.replyText, /^ลูกค้าใหม่ 1 ส\.ค\. 2569 – 31 ส\.ค\. 2569: 3 ราย/);
    assert.match(r.replyText, /\nลูกค้าทั้งหมด 42 ราย \(ใช้งานอยู่ 40 ราย\)/);
    assert.match(r.replyText, /\n\(ยอดรวม: นับรวมลูกค้าที่เก็บเข้าคลัง · ไม่รวมรายการที่ถูกรวมบัญชี\)/);
    assert.equal(r.sourceRefs[0]?.label, 'ลูกค้า');
    assert.doesNotMatch(r.replyText, /ที่มา:|Source:/);
    // C6 (batch 5c): a Thai calendar date, not the raw ISO string.
    assert.match(r.replyText, /\nข้อมูล ณ 25 ส\.ค\. 2569/);
    assert.equal(r.webLinks[0]?.path, '/companies/c1/customers');
    assert.equal(r.replyText, r.replyText.normalize('NFC'));
  });

  it('serves the same deterministic answer for the single_metric and list shapes', () => {
    const metric = formatPreparedSimpleRead(CRM, crmOutput(crmData()), TH);
    const list = formatPreparedSimpleRead(CRM_LIST, crmOutput(crmData()), TH);
    assert.equal(list.kind, 'answer');
    if (metric.kind === 'answer' && list.kind === 'answer') assert.equal(list.replyText, metric.replyText);
  });

  it('answers in English and renders a month with no new customer as an honest zero', () => {
    const en = formatPreparedSimpleRead(CRM, crmOutput(crmData()), EN);
    if (en.kind === 'answer') {
      assert.match(en.replyText, /^New customers 1 Aug 2026 – 31 Aug 2026: 3 customers/);
      assert.match(en.replyText, /\nTotal 42 customers \(40 active\)/);
      assert.match(en.replyText, /\n\(Total: includes archived · excludes merged records\)/);
    }
    const zero = formatPreparedSimpleRead(CRM, crmOutput(crmData({ newCustomers: 0 })), TH);
    assert.equal(zero.kind, 'answer');
    if (zero.kind === 'answer') assert.match(zero.replyText, /^ลูกค้าใหม่ 1 ส\.ค\. 2569 – 31 ส\.ค\. 2569: 0 ราย/);
    const one = formatPreparedSimpleRead(CRM, crmOutput(crmData({ newCustomers: 1 })), EN);
    if (one.kind === 'answer') assert.match(one.replyText, /^New customers 1 Aug 2026 – 31 Aug 2026: 1 customer\n/);
  });

  it('states the basis the tool actually reported, and omits the line when it reports none', () => {
    const flipped = formatPreparedSimpleRead(CRM, crmOutput(crmData({ totalIncludesArchived: false, totalExcludesMerged: false })), TH);
    if (flipped.kind === 'answer') assert.match(flipped.replyText, /\n\(ยอดรวม: ไม่รวมลูกค้าที่เก็บเข้าคลัง · นับรวมรายการที่ถูกรวมบัญชี\)/);
    const silent = crmData();
    delete silent['totalIncludesArchived'];
    delete silent['totalExcludesMerged'];
    const r = formatPreparedSimpleRead(CRM, crmOutput(silent), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.doesNotMatch(r.replyText, /ยอดรวม:/);
  });

  it('keeps the open "since" phrasing when the tool reports no window end (spec §3.3 rollout)', () => {
    const open = formatPreparedSimpleRead(CRM, crmOutput(crmData({ newCustomersUntil: undefined })), TH);
    assert.equal(open.kind, 'answer');
    // C6 (batch 5c): a Thai calendar date, not the raw ISO string.
    if (open.kind === 'answer') assert.match(open.replyText, /^ลูกค้าใหม่ตั้งแต่ 1 ส\.ค\. 2569: 3 ราย/);
  });

  it('names the period the user asked for, in their words and its dates (spec §3.4)', () => {
    const labelled = formatPreparedSimpleRead(CRM, crmOutput(crmData()),
      { ...TH, periodLabel: 'เดือนที่แล้ว (1–31 ส.ค. 2569)' });
    assert.equal(labelled.kind, 'answer');
    if (labelled.kind === 'answer') assert.match(labelled.replyText, /\nช่วง: เดือนที่แล้ว \(1–31 ส\.ค\. 2569\)/);
    // An English answer keeps the ISO dates it has always printed rather than a Thai phrase.
    const en = formatPreparedSimpleRead(CRM, crmOutput(crmData()),
      { ...EN, periodLabel: 'เดือนที่แล้ว (1–31 ส.ค. 2569)' });
    if (en.kind === 'answer') assert.doesNotMatch(en.replyText, /เดือนที่แล้ว/);
  });

  it('returns unverified for a missing window day or any non-count figure, and never names a customer', () => {
    for (const broken of [
      crmData({ newCustomersSince: 'เดือนนี้' }), crmData({ newCustomersSince: undefined }),
      crmData({ newCustomers: '3' }), crmData({ total: null }), crmData({ active: 2.5 }),
      crmData({ truncated: true }),
    ]) {
      assert.equal(formatPreparedSimpleRead(CRM, crmOutput(broken), TH).kind, 'unverified');
    }
    // A summary that somehow carried rows would still print counts only.
    const withRows = formatPreparedSimpleRead(CRM, crmOutput(crmData({ items: [{ displayName: 'ร้านลุงมี' }] })), TH);
    if (withRows.kind === 'answer') assert.doesNotMatch(withRows.replyText, /ลุงมี/);
  });
});

// ── R-L4 F8 — expense.list_recent::list ("ค่าใช้จ่ายล่าสุด 10 รายการ") ────────────────────────────
// Fixture shape copied from the real tool result (ExpenseListRecentTool's success path): `items[]`
// carries `expenseDate` (ISO datetime), `vendorNameSnapshot`, `status` (ExpenseStatus), `grandTotalAmount`.
const expenseListItem = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'e1', expenseNumber: 'EXP-2026-0001', expenseDate: '2026-08-05T10:00:00.000Z',
  vendorNameSnapshot: 'ร้านสมใจ', status: 'CONFIRMED', paymentStatus: 'UNPAID', grandTotalAmount: '500.00', ...over,
});
const expenseListData = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  total: 2, period: { fromDate: '2026-08-01', toDate: '2026-08-31', defaultedToCurrentMonth: false },
  // Item 2: the same summary the single-metric family reads — a list answer states the filtered
  // set's own total (500.00 + 700.00), not only its items.
  summary: { totalAmount: '1200.00' },
  items: [expenseListItem(), expenseListItem({
    id: 'e2', expenseNumber: 'EXP-2026-0002', expenseDate: '2026-08-02T10:00:00.000Z',
    vendorNameSnapshot: 'ร้านใจดี', grandTotalAmount: '700.00', status: 'READY_FOR_CONFIRMATION',
  })],
  ...over,
});

describe('R-L4 F8 expense.list_recent::list — ค่าใช้จ่ายล่าสุด', () => {
  it('answers with the grounded count, numbered records, period, source, as-of and link (Thai)', () => {
    const r = formatPreparedSimpleRead(EXPENSE_LIST, expenseOutput(expenseListData()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    // Item 2: the headline now states the filtered set's own total amount, not only its count.
    assert.match(r.replyText, /^ค่าใช้จ่าย: 1,200\.00 บาท \(2 รายการ\)/);
    // C6 (batch 5c): a short list-item date, year-free within the tool's own as-of year.
    assert.match(r.replyText, /\n1\. 5 ส\.ค\. ร้านสมใจ 500\.00 บาท \(ยืนยันแล้ว\)/);
    assert.match(r.replyText, /\n2\. 2 ส\.ค\. ร้านใจดี 700\.00 บาท \(พร้อมยืนยัน\)/);
    assert.match(r.replyText, /\nช่วง: /);
    assert.doesNotMatch(r.replyText, /ที่มา:|Source:/);
    assert.match(r.replyText, /\nข้อมูล ณ /);
    assert.deepEqual(r.webLinks, [{ label: 'รายการค่าใช้จ่าย', path: '/companies/c1/expenses' }]);
  });

  it('answers in English with the same grounded numbers', () => {
    const r = formatPreparedSimpleRead(EXPENSE_LIST, expenseOutput(expenseListData()), EN);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^Expenses: 1,200\.00 THB \(2 records\)/);
    assert.match(r.replyText, /\n1\. 5 Aug ร้านสมใจ 500\.00 THB \(Confirmed\)/);
  });

  it('states the applied filter line the same way the single-metric family does (spec item 2d)', () => {
    const data = expenseListData({ queryApplied: { statusBasis: 'exclude_rejected_voided', filters: { categoryName: 'อาหาร' } } });
    const r = formatPreparedSimpleRead(EXPENSE_LIST, expenseOutput(data), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /\nตัวกรอง: เฉพาะหมวดอาหาร/);
  });

  it('item 1: states the own/related scope the same way the single-metric family does', () => {
    const own = expenseListData({ queryApplied: { statusBasis: 'exclude_rejected_voided', accessScope: 'own' } });
    const r = formatPreparedSimpleRead(EXPENSE_LIST, expenseOutput(own), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /\nขอบเขต: เฉพาะรายการของคุณ/);
    const company = expenseListData({ queryApplied: { statusBasis: 'exclude_rejected_voided', accessScope: 'company' } });
    const companyResult = formatPreparedSimpleRead(EXPENSE_LIST, expenseOutput(company), TH);
    assert.equal(companyResult.kind, 'answer');
    if (companyResult.kind === 'answer') assert.doesNotMatch(companyResult.replyText, /ขอบเขต:/);
  });

  it('names an unnamed vendor instead of leaving it blank, and never fabricates for a malformed row', () => {
    const noVendor = expenseListData({ items: [expenseListItem({ vendorNameSnapshot: undefined })] });
    const r = formatPreparedSimpleRead(EXPENSE_LIST, expenseOutput(noVendor), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /ไม่ระบุร้าน/);

    for (const broken of [
      expenseListData({ total: '2' }), expenseListData({ items: 'not-an-array' }),
      expenseListData({ items: [expenseListItem({ grandTotalAmount: null })] }),
      expenseListData({ items: [expenseListItem({ status: 42 })] }),
      expenseListData({ truncated: true }),
      // Item 2: no verified single-currency total for the filtered set (e.g. mixed currency) means
      // no verified list answer either — the same requirement formatExpenseSummary already has.
      expenseListData({ summary: undefined }), expenseListData({ summary: { totalAmount: null } }),
      expenseListData({ summary: { totalAmount: 'not-a-number' } }),
    ]) {
      assert.equal(formatPreparedSimpleRead(EXPENSE_LIST, expenseOutput(broken), TH).kind, 'unverified');
    }
  });

  it('caps the numbered list at 10 and states how many more exist (R-A3)', () => {
    const items = Array.from({ length: 12 }, (_, i) => expenseListItem({
      id: `e${i}`, expenseNumber: `EXP-${i}`, expenseDate: `2026-08-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`,
    }));
    const r = formatPreparedSimpleRead(EXPENSE_LIST, expenseOutput(expenseListData({ total: 12, items })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /\nแสดง 10 จาก 12 รายการ/);
    assert.doesNotMatch(r.replyText, /\n11\. /);
  });

  // Item 2 (eval: "ขอดูรายการ 5 อันล่าสุดเดือนที่แล้วครับ" — an explicit limit=5 against a 14-record
  // month — answered with only the FULL month's total and none of the 5 requested records). The
  // headline states the FILTERED set's own total (all 14, matching the tool's own `summary`), not a
  // guess from the 5 shown rows, and the "showing N of M" line still names the bounded page.
  it('states the filtered set\'s own total amount and count, distinct from the shown-page size', () => {
    const items = Array.from({ length: 5 }, (_, i) => expenseListItem({ id: `e${i}`, expenseNumber: `EXP-${i}` }));
    const data = expenseListData({ total: 14, items, summary: { totalAmount: '40453.00' } });
    const r = formatPreparedSimpleRead(EXPENSE_LIST, expenseOutput(data), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^ค่าใช้จ่าย: 40,453\.00 บาท \(14 รายการ\)/);
    assert.match(r.replyText, /\nแสดง 5 จาก 14 รายการ/);
  });
});

// ── Owner 2026-09-29: a bare month the resolver moved to last year says so ─────────────────────────────
// Production 29 Sep 2026 23:08, "ดูรายจ่าย ให้หน่อย เดือน ตุลา" answered "ช่วง: 1–31 ต.ค. 2568" with no word why.
// Same chain as the orchestrator's prepared lane: the resolver's candidate → its label and note → the formatter.
describe('assumed-year note on the period line (owner 2026-09-29)', () => {
  const answer = (text: string, todayIso: string, lang: typeof TH = TH): string => {
    const [period] = resolvePeriodCandidates(text, todayIso);
    assert.ok(period, `the resolver read no period from "${text}"`);
    const asOf = `${todayIso}T16:08:00.000Z`; // 23:08 in Bangkok
    const data = expenseListData({ total: 0, items: [], summary: { totalAmount: '0.00' },
      period: { fromDate: period.fromDate, toDate: period.toDate, defaultedToCurrentMonth: false } });
    const r = formatPreparedSimpleRead(EXPENSE_LIST, expenseOutput(data, asOf), {
      ...lang, proposedInput: { fromDate: period.fromDate, toDate: period.toDate }, periodLabel: period.label,
      periodNote: assumedYearNote(period, asOf, lang.language === 'en'),
    });
    assert.equal(r.kind, 'answer');
    return r.kind === 'answer' ? r.replyText : '';
  };

  it('"ตุลา" on 29 Sep: says the year was assumed and that this October has not started', () => {
    assert.equal(answer('ดูรายจ่าย ให้หน่อย เดือน ตุลา', '2026-09-29'), 'ค่าใช้จ่าย: 0.00 บาท (0 รายการ)'
      + '\nช่วง: 1–31 ต.ค. 2568 (ไม่ได้ระบุปี จึงดูตุลาคมที่ผ่านมาล่าสุด)\nตุลาคมปีนี้ยังไม่ถึงค่ะ\nข้อมูล ณ 29 ก.ย. 2569');
    assert.equal(answer('show expenses for October', '2026-09-29', EN), 'Expenses: 0.00 THB (0 records)'
      + '\nPeriod: 1 Oct 2025 – 31 Oct 2025 (no year given, so this is the most recent October)'
      + "\nThis year's October hasn't started yet.\nData as of 29 Sep 2026");
  });

  it('"สิงหา" on 29 Sep is this year\'s August: no note', () => {
    assert.equal(answer('ดูรายจ่าย ให้หน่อย เดือน สิงหา', '2026-09-29'),
      'ค่าใช้จ่าย: 0.00 บาท (0 รายการ)\nช่วง: 1–31 ส.ค. 2569\nข้อมูล ณ 29 ก.ย. 2569');
  });

  it('a written year and a relative month: no note', () => {
    assert.equal(answer('ดูรายจ่าย เดือนตุลาคม 2568', '2026-09-29'),
      'ค่าใช้จ่าย: 0.00 บาท (0 รายการ)\nช่วง: 1–31 ต.ค. 2568\nข้อมูล ณ 29 ก.ย. 2569');
    assert.equal(answer('ดูรายจ่าย เดือนนี้', '2026-09-29'),
      'ค่าใช้จ่าย: 0.00 บาท (0 รายการ)\nช่วง: เดือนนี้ (1–29 ก.ย. 2569)\nข้อมูล ณ 29 ก.ย. 2569');
  });

  it('"ตุลา" on 15 Oct is this October: no note, so the note can never loop', () => {
    assert.equal(answer('ดูรายจ่าย ให้หน่อย เดือน ตุลา', '2026-10-15'),
      'ค่าใช้จ่าย: 0.00 บาท (0 รายการ)\nช่วง: 1–15 ต.ค. 2569\nข้อมูล ณ 15 ต.ค. 2569');
  });

  it('names a quarter, keeps a range generic, and says nothing without an as-of', () => {
    const asOf = '2026-09-29T16:08:00.000Z';
    const [quarter] = resolvePeriodCandidates('ดูรายจ่าย ไตรมาส 4', '2026-09-29');
    assert.equal(assumedYearNote(quarter, asOf, false), ' (ไม่ได้ระบุปี จึงดูไตรมาส 4 ที่ผ่านมาล่าสุด)\nไตรมาส 4 ปีนี้ยังไม่ถึงค่ะ');
    const [range] = resolvePeriodCandidates('ดูรายจ่าย 1-15 ต.ค.', '2026-09-29');
    assert.equal(assumedYearNote(range, asOf, false), ' (ไม่ได้ระบุปี จึงดูช่วงที่ผ่านมาล่าสุด)');
    assert.equal(assumedYearNote(quarter, undefined, false), '');
  });
});

// ── R-L4 F9 — expense.get_breakdown::list ("แยกค่าใช้จ่ายตามหมวด/สาขา/ร้าน") ─────────────────────────
const BREAKDOWN_SOURCE: SourceRef = {
  label: 'สรุปค่าใช้จ่ายแยกกลุ่ม', module: 'expenses', entityType: 'expense_breakdown',
  permissionChecked: true, webPath: '/companies/c1/expenses',
};
const breakdownOutput = (data: Record<string, unknown>, asOf?: string): SpecialistOutput =>
  readOutput('expense.get_breakdown', data, BREAKDOWN_SOURCE, asOf);
const breakdownData = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  totalCount: 10, totalAmount: '5000.00',
  byCategory: [
    { categoryId: 'c1', category: 'อาหาร', currency: 'THB', count: 6, totalAmount: '3000.00' },
    { categoryId: 'c2', category: 'เดินทาง', currency: 'THB', count: 3, totalAmount: '1500.00' },
    { categoryId: 'c3', category: 'ค่าน้ำ', currency: 'THB', count: 1, totalAmount: '500.00' },
  ],
  byBranch: [{ branchId: null, branch: 'ส่วนกลาง (ไม่ระบุสาขา)', currency: 'THB', count: 10, totalAmount: '5000.00' }],
  byVendor: [{ vendorId: 'v1', vendor: 'ร้านสมใจ', currency: 'THB', count: 4, totalAmount: '2000.00', linked: true }],
  ...over,
});

describe('R-L4 F9 expense.get_breakdown::list — แยกค่าใช้จ่าย', () => {
  it('groups by category by default: descending amount, percentage share, overall total, source, as-of, link (Thai)', () => {
    const r = formatPreparedSimpleRead(BREAKDOWN, breakdownOutput(breakdownData()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^ค่าใช้จ่ายแยกตามหมวด/);
    assert.match(r.replyText, /\n• อาหาร: 3,000\.00 บาท \(60\.0%, 6 รายการ\)/);
    assert.match(r.replyText, /\n• เดินทาง: 1,500\.00 บาท \(30\.0%, 3 รายการ\)/);
    assert.match(r.replyText, /\n• ค่าน้ำ: 500\.00 บาท \(10\.0%, 1 รายการ\)/);
    assert.match(r.replyText, /\nรวมทั้งหมด: 5,000\.00 บาท \(10 รายการ\)/);
    assert.doesNotMatch(r.replyText, /ที่มา:|Source:/);
    assert.deepEqual(r.webLinks, [{ label: 'สรุปค่าใช้จ่ายแยกกลุ่ม', path: '/companies/c1/expenses' }]);
  });

  // C7 (batch 5c, T-019-a "เดือนสิงหาคมที่ผ่านมาใช้จ่ายไปเท่าไหร่คะ"): the model's proposed call carried
  // no groupBy at all ({fromDate, toDate} only); the eval recorded the deterministic fallback unable to
  // render this exact tool result. Reproduced verbatim from the real evidence (t019a-lastmonth-
  // breakdown.json) — this already renders correctly (defaults to the category axis, same as the test
  // above), so this pins that behavior against the real shape rather than the simplified fixture.
  it('renders the real T-019-a tool result as the category grouping with no groupBy in context at all', () => {
    const realData = {
      period: { fromDate: '2026-08-01', toDate: '2026-08-31', defaultedToCurrentMonth: false },
      totalCount: 14, totalAmount: '40453', currency: 'THB',
      totalsByCurrency: [{ currency: 'THB', count: 14, totalAmount: '40453' }],
      mixedCurrency: false,
      byCategory: [
        { categoryId: 'category-a-service', category: 'ค่าบริการ', currency: 'THB', count: 3, totalAmount: '10764.5' },
        { categoryId: 'category-a-travel', category: 'ค่าเดินทาง', currency: 'THB', count: 3, totalAmount: '10353.5' },
        { categoryId: 'category-a-other', category: 'ค่าใช้จ่ายอื่นๆ', currency: 'THB', count: 3, totalAmount: '7175.5' },
        { categoryId: 'category-a-fuel', category: 'ค่าน้ำมัน', currency: 'THB', count: 3, totalAmount: '6216.5' },
        { categoryId: 'category-a-office', category: 'ค่าออฟฟิศ', currency: 'THB', count: 2, totalAmount: '5943' },
      ],
      byBranch: [{ branchId: 'branch-a-1', branch: 'สำนักงานใหญ่', currency: 'THB', count: 14, totalAmount: '40453' }],
      byVendor: [{ vendorId: 'counterparty-company-a-5', vendor: 'Grab', linked: true, currency: 'THB', count: 2, totalAmount: '7313.5000' }],
      vendorHasMore: false,
      queryApplied: {
        timezone: 'Asia/Bangkok',
        period: { startDate: '2026-08-01', endDate: '2026-08-31', timezone: 'Asia/Bangkok', defaulted: false },
        branch: { mode: 'all_authorized', branchId: null },
        dateBasis: 'expense_incurred_date', statusBasis: 'exclude_rejected_voided',
        dataset: 'operational_expense_records', accessScope: 'company', filters: { groupBy: 'category' },
      },
      completeness: {
        aggregate: 'complete', rows: { returned: 0, hasMore: false, nextCursor: null },
        groups: { returned: 13, hasMore: false, nextCursor: null }, businessRecording: 'unknown',
      },
    };
    // No proposedInput at all — the exact shape `deterministicReadFallback` (semantic-turn-v2.ts) uses.
    const r = formatPreparedSimpleRead(BREAKDOWN, breakdownOutput(realData, '2026-09-28T02:04:02.165Z'), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^ค่าใช้จ่ายแยกตามหมวด/);
    assert.match(r.replyText, /\n• ค่าบริการ: 10,764\.50 บาท/);
    assert.match(r.replyText, /\nรวมทั้งหมด: 40,453\.00 บาท \(14 รายการ\)/);
  });

  it('groups by vendor or branch when the validated proposedInput asked for it (groupBy presentation hint)', () => {
    const byVendor = formatPreparedSimpleRead(BREAKDOWN, breakdownOutput(breakdownData()), { ...TH, proposedInput: { groupBy: 'vendor' } });
    assert.equal(byVendor.kind, 'answer');
    if (byVendor.kind === 'answer') {
      assert.match(byVendor.replyText, /^ค่าใช้จ่ายแยกตามร้าน/);
      assert.match(byVendor.replyText, /\n• ร้านสมใจ: 2,000\.00 บาท \(40\.0%, 4 รายการ\)/);
    }
    const byBranch = formatPreparedSimpleRead(BREAKDOWN, breakdownOutput(breakdownData()), { ...TH, proposedInput: { groupBy: 'branch' } });
    assert.equal(byBranch.kind, 'answer');
    if (byBranch.kind === 'answer') assert.match(byBranch.replyText, /^ค่าใช้จ่ายแยกตามสาขา/);
  });

  // M2 (tuning-8, T-057-a): the full path's deterministic fallback (semantic-turn-v2.ts's
  // deterministicReadFallback) calls this formatter with NO proposedInput at all — the applied
  // grouping must still come from the tool's own queryApplied.filters.groupBy, or a vendor/branch
  // breakdown mislabels itself "แยกตามหมวด" (run 8 T-057-a: "ของฉันจ่ายร้านไหนเยอะสุดคะ" called
  // get_breakdown groupBy vendor, but the fallback rendered the category headline).
  it('reads the applied groupBy from queryApplied.filters when proposedInput carries none (deterministic-fallback shape)', () => {
    const byVendor = formatPreparedSimpleRead(BREAKDOWN,
      breakdownOutput(breakdownData({ queryApplied: { filters: { groupBy: 'vendor' } } })), TH);
    assert.equal(byVendor.kind, 'answer');
    if (byVendor.kind === 'answer') {
      assert.match(byVendor.replyText, /^ค่าใช้จ่ายแยกตามร้าน/);
      assert.match(byVendor.replyText, /\n• ร้านสมใจ: 2,000\.00 บาท \(40\.0%, 4 รายการ\)/);
    }
    const byBranchApplied = formatPreparedSimpleRead(BREAKDOWN,
      breakdownOutput(breakdownData({ queryApplied: { filters: { groupBy: 'branch' } } })), TH);
    assert.equal(byBranchApplied.kind, 'answer');
    if (byBranchApplied.kind === 'answer') assert.match(byBranchApplied.replyText, /^ค่าใช้จ่ายแยกตามสาขา/);
    // proposedInput still wins over the applied echo when both are present.
    const overridden = formatPreparedSimpleRead(BREAKDOWN,
      breakdownOutput(breakdownData({ queryApplied: { filters: { groupBy: 'vendor' } } })),
      { ...TH, proposedInput: { groupBy: 'branch' } });
    assert.equal(overridden.kind, 'answer');
    if (overridden.kind === 'answer') assert.match(overridden.replyText, /^ค่าใช้จ่ายแยกตามสาขา/);
  });

  it('folds groups beyond the top 8 into one "อื่นๆ" row with an exact summed amount and count (R-A2)', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ categoryId: `c${i}`, category: `หมวด${i}`, currency: 'THB', count: 1, totalAmount: '100.00' }));
    const r = formatPreparedSimpleRead(BREAKDOWN, breakdownOutput(breakdownData({ totalCount: 10, totalAmount: '1000.00', byCategory: many })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /\n• อื่นๆ \(2\): 200\.00 บาท \(20\.0%, 2 รายการ\)/);
    assert.doesNotMatch(r.replyText, /หมวด8|หมวด9/);
  });

  it('answers in English with the same grounded numbers', () => {
    const r = formatPreparedSimpleRead(BREAKDOWN, breakdownOutput(breakdownData()), EN);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^Expenses by category/);
    assert.match(r.replyText, /\n• อาหาร: 3,000\.00 THB \(60\.0%, 6 records\)/);
    assert.match(r.replyText, /\nTotal: 5,000\.00 THB \(10 records\)/);
  });

  it('item 1: states the own/related scope the same way the single-metric family does', () => {
    const r = formatPreparedSimpleRead(BREAKDOWN,
      breakdownOutput(breakdownData({ queryApplied: { statusBasis: 'exclude_rejected_voided', accessScope: 'related' } })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /\nขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ/);
  });

  it('never fabricates for a malformed or incomplete shape, and falls back to category on an invalid groupBy', () => {
    for (const broken of [
      breakdownData({ totalCount: '10' }), breakdownData({ totalAmount: null }),
      breakdownData({ byCategory: 'not-an-array' }),
      breakdownData({ byCategory: [{ categoryId: 'c1', category: '', currency: 'THB', count: 1, totalAmount: '1.00' }] }),
      breakdownData({ byCategory: [{ categoryId: 'c1', category: 'อาหาร', currency: 'THB', count: '1', totalAmount: '1.00' }] }),
      breakdownData({ completeness: { aggregate: 'partial' } }),
    ]) {
      assert.equal(formatPreparedSimpleRead(BREAKDOWN, breakdownOutput(broken), TH).kind, 'unverified');
    }
    const fallback = formatPreparedSimpleRead(BREAKDOWN, breakdownOutput(breakdownData()), { ...TH, proposedInput: { groupBy: 'nonsense' } });
    assert.equal(fallback.kind, 'answer');
    if (fallback.kind === 'answer') assert.match(fallback.replyText, /^ค่าใช้จ่ายแยกตามหมวด/);
  });
});

// ── R-L4 F10 — reimbursement.list_pending_approvals::list ("เบิกจ่ายรออนุมัติ") ────────────────────
// Fixture shape copied from the real tool result (ReimbursementListPendingApprovalsTool): `total` is
// the TRUE count computed before the tool's own 10-row page cap on `items`.
const REIMBURSEMENT_APPROVALS_SOURCE: SourceRef = {
  label: 'รายการเบิกจ่ายรออนุมัติ', module: 'reimbursements', entityType: 'reimbursement_approval_queue',
  permissionChecked: true, webPath: '/companies/c1/reimbursements',
};
const approvalsOutput = (data: Record<string, unknown>, asOf?: string): SpecialistOutput =>
  readOutput('reimbursement.list_pending_approvals', data, REIMBURSEMENT_APPROVALS_SOURCE, asOf);
const approvalItem = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'r1', documentNumber: 'REQ-0001', requesterDisplayName: 'สมชาย', amount: '1500.00', currency: 'THB',
  submittedAt: '2026-08-05T10:00:00.000Z', status: 'PENDING_APPROVAL', branch: null, ...over,
});

describe('R-L4 F10 reimbursement.list_pending_approvals::list — เบิกจ่ายรออนุมัติ', () => {
  it('states the grounded count and total when nothing was truncated, plus the first 5 requesters (Thai)', () => {
    const items = [approvalItem(), approvalItem({
      id: 'r2', requesterDisplayName: 'สมหญิง', amount: '2500.00', submittedAt: '2026-08-06T10:00:00.000Z',
    })];
    const r = formatPreparedSimpleRead(REIMBURSEMENT_APPROVALS, approvalsOutput({ total: 2, items }), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^เบิกจ่ายรออนุมัติ: 2 รายการ รวม 4,000\.00 บาท/);
    // C6 (batch 5c): a short list-item date, year-free within the tool's own as-of year.
    assert.match(r.replyText, /\n1\. สมชาย \(5 ส\.ค\.\): 1,500\.00 บาท/);
    assert.match(r.replyText, /\n2\. สมหญิง \(6 ส\.ค\.\): 2,500\.00 บาท/);
    assert.doesNotMatch(r.replyText, /ที่มา:|Source:/);
    assert.deepEqual(r.webLinks, [{ label: 'รายการเบิกจ่ายรออนุมัติ', path: '/companies/c1/reimbursements' }]);
  });

  it('answers in English with the same grounded numbers', () => {
    const r = formatPreparedSimpleRead(REIMBURSEMENT_APPROVALS, approvalsOutput({ total: 1, items: [approvalItem()] }), EN);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /^Pending approvals: 1 request, totaling 1,500\.00 THB/);
  });

  it('states the count alone, without a summed total, when the tool truncated the returned rows', () => {
    const items = Array.from({ length: 10 }, (_, i) => approvalItem({ id: `r${i}`, requesterDisplayName: `ผู้ขอ${i}` }));
    const r = formatPreparedSimpleRead(REIMBURSEMENT_APPROVALS, approvalsOutput({ total: 15, items }), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^เบิกจ่ายรออนุมัติ: 15 รายการ$/m);
    assert.doesNotMatch(r.replyText, /รวม \d/);
    assert.match(r.replyText, /\nแสดง 5 จาก 15 รายการ/);
  });

  it('does not sum mixed currencies, and never fabricates for a malformed shape', () => {
    const mixed = [approvalItem({ currency: 'THB' }), approvalItem({ id: 'r2', currency: 'USD' })];
    const r = formatPreparedSimpleRead(REIMBURSEMENT_APPROVALS, approvalsOutput({ total: 2, items: mixed }), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.doesNotMatch(r.replyText, /รวม \d/);

    for (const broken of [
      { total: '2', items: [] }, { total: 2, items: 'nope' },
      { total: 2, items: [approvalItem({ amount: null })] },
      { total: 2, items: [approvalItem({ currency: 42 })] },
    ]) {
      assert.equal(formatPreparedSimpleRead(REIMBURSEMENT_APPROVALS, approvalsOutput(broken), TH).kind, 'unverified');
    }
  });

  it('names an unnamed requester instead of leaving it blank', () => {
    const r = formatPreparedSimpleRead(REIMBURSEMENT_APPROVALS,
      approvalsOutput({ total: 1, items: [approvalItem({ requesterDisplayName: undefined })] }), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /ไม่ระบุผู้ขอ/);
  });

  // erp-reimbursement-tools.use-case.ts's ReimbursementListPendingApprovalsTool returns 'forbidden'
  // with this errorCode for a caller without reimbursement.approve — preparedTerminalReply must name
  // the self-serve alternative instead of the generic 🔒 permission line.
  it('a caller without reimbursement.approve gets the role-limit reply, not the generic permission line', () => {
    const denied: SpecialistOutput = {
      agent: 'accounting', status: 'PERMISSION_DENIED', summary: 'ไม่มีสิทธิ์เข้าถึงข้อมูลบัญชี',
      facts: [], suggestions: [], requiresHumanReview: false, toolData: [], asOf: undefined,
      toolCalls: [{ name: 'reimbursement.list_pending_approvals', status: 'forbidden', durationMs: 1, errorCode: 'REIMBURSEMENT_APPROVAL_NOT_PERMITTED' }],
    };
    assert.equal(formatPreparedSimpleRead(REIMBURSEMENT_APPROVALS, denied, TH).kind, 'unverified');
    const th = preparedTerminalReply(denied, TH);
    assert.match(th, /บทบาทของคุณยังไม่มีสิทธิ์ดูหรืออนุมัติใบเบิกของคนอื่นค่ะ/);
    assert.match(th, /ใบเบิกของฉันถึงไหนแล้ว/);
    assert.doesNotMatch(th, /🔒/);
    assert.match(preparedTerminalReply(denied, EN), /does not have permission/);
  });

  it('a DIFFERENT permission denial still gets the generic 🔒 line', () => {
    const denied: SpecialistOutput = {
      agent: 'accounting', status: 'PERMISSION_DENIED', summary: 'ไม่มีสิทธิ์เข้าถึงข้อมูลบัญชี',
      facts: [], suggestions: [], requiresHumanReview: false, toolData: [], asOf: undefined,
      toolCalls: [{ name: 'reimbursement.list_pending_approvals', status: 'forbidden', durationMs: 1 }],
    };
    assert.match(preparedTerminalReply(denied, TH), /🔒 คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้ค่ะ/);
  });
});

// ── R-L4 F11 — reimbursement.get_summary::single_metric ("ยอดเบิกจ่ายที่ยังไม่จ่าย") ────────────────
// Fixture shape copied from the real tool result (ReimbursementAiSummary, contracts/src/reimbursements.ts).
const REIMBURSEMENT_SUMMARY_SOURCE: SourceRef = {
  label: 'สรุปเบิกจ่าย', module: 'reimbursements', entityType: 'reimbursement_summary',
  permissionChecked: true, webPath: '/companies/c1/reimbursements',
};
const summaryOutput = (data: Record<string, unknown>, asOf?: string): SpecialistOutput =>
  readOutput('reimbursement.get_summary', data, REIMBURSEMENT_SUMMARY_SOURCE, asOf);
const reimbursementSummaryData = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  pendingApprovalCount: 3, unpaidApprovedCount: 5, overdueApprovalCount: 2, totalUnpaidAmount: '12500.00', ...over,
});

describe('R-L4 F11 reimbursement.get_summary::single_metric — สรุปเบิกจ่าย', () => {
  // C8 (batch 5c, T-143-a): leads with the status counts, not the unpaid total — see the formatter's
  // own docstring for why. The unpaid-approved amount rides its own clause, only when count > 0.
  it('states the status counts, with the unpaid-approved amount attached, source, as-of and link (Thai)', () => {
    const r = formatPreparedSimpleRead(REIMBURSEMENT_SUMMARY, summaryOutput(reimbursementSummaryData()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^ใบเบิก: รออนุมัติ 3 รายการ · อนุมัติแล้วรอจ่าย 5 รายการ รวม 12,500\.00 บาท · เกินกำหนด 2 รายการ/);
    assert.doesNotMatch(r.replyText, /ที่มา:|Source:/);
    assert.deepEqual(r.webLinks, [{ label: 'สรุปเบิกจ่าย', path: '/companies/c1/reimbursements' }]);
  });

  it('answers in English with the same grounded numbers', () => {
    const r = formatPreparedSimpleRead(REIMBURSEMENT_SUMMARY, summaryOutput(reimbursementSummaryData()), EN);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      assert.match(r.replyText, /^Reimbursements: 3 requests pending approval · 5 requests approved, unpaid, totaling 12,500\.00 THB · 2 requests overdue/);
    }
  });

  it('omits the overdue clause entirely when nothing is overdue', () => {
    const r = formatPreparedSimpleRead(REIMBURSEMENT_SUMMARY, summaryOutput(reimbursementSummaryData({ overdueApprovalCount: 0 })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      assert.match(r.replyText, /^ใบเบิก: รออนุมัติ 3 รายการ · อนุมัติแล้วรอจ่าย 5 รายการ รวม 12,500\.00 บาท$/m);
      assert.doesNotMatch(r.replyText, /เกินกำหนด/);
    }
  });

  // C8 exact evidence (T-143-a "มีใบเบิกรออนุมัติกี่ใบคะ"): unpaidApprovedCount and overdueApprovalCount
  // are both 0, so neither the amount nor the overdue clause appears — only the two status counts.
  it('omits the unpaid-approved amount and the overdue clause when both counts are zero (T-143-a)', () => {
    const r = formatPreparedSimpleRead(REIMBURSEMENT_SUMMARY, summaryOutput({
      pendingApprovalCount: 2, unpaidApprovedCount: 0, overdueApprovalCount: 0, totalUnpaidAmount: '0.0000', accessScope: 'related',
    }), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^ใบเบิก: รออนุมัติ 2 รายการ · อนุมัติแล้วรอจ่าย 0 รายการ\n/);
    assert.doesNotMatch(r.replyText, /0\.00 บาท|เกินกำหนด/);
    assert.match(r.replyText, /\nขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ/);
  });

  // Item 1 (spec R-A1 row 18, eval: 15 turns): this tool has no queryApplied wrapper either, so its
  // accessScope also rides `data.accessScope` directly (ReimbursementAiSummary's own new field).
  it('item 1: states "related to you" when accessScope is related, omits it for company', () => {
    const related = formatPreparedSimpleRead(REIMBURSEMENT_SUMMARY,
      summaryOutput(reimbursementSummaryData({ accessScope: 'related' })), TH);
    assert.equal(related.kind, 'answer');
    if (related.kind === 'answer') assert.match(related.replyText, /\nขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ/);
    const company = formatPreparedSimpleRead(REIMBURSEMENT_SUMMARY,
      summaryOutput(reimbursementSummaryData({ accessScope: 'company' })), TH);
    assert.equal(company.kind, 'answer');
    if (company.kind === 'answer') assert.doesNotMatch(company.replyText, /ขอบเขต:/);
  });

  it('never fabricates for a malformed or incomplete shape', () => {
    for (const broken of [
      reimbursementSummaryData({ pendingApprovalCount: '3' }), reimbursementSummaryData({ unpaidApprovedCount: -1 }),
      reimbursementSummaryData({ overdueApprovalCount: 2.5 }), reimbursementSummaryData({ totalUnpaidAmount: null }),
      reimbursementSummaryData({ completeness: { aggregate: 'partial' } }),
    ]) {
      assert.equal(formatPreparedSimpleRead(REIMBURSEMENT_SUMMARY, summaryOutput(broken), TH).kind, 'unverified');
    }
  });
});

// ── R-L4 F12 — expense.get_detail::single_metric ("รายการที่ 3 คือร้านอะไรครับ") ──────────────────
// Fixture shape copied from the real tool result (ExpenseGetDetailTool's success path,
// erp-core-detail-tools.use-case.ts): ONE already-permission-checked record, never a page — so
// (unlike F1/F8) there is no `truncated`/`completeness` case to guard against here.
const EXPENSE_DETAIL_SOURCE: SourceRef = {
  label: 'EXP-2026-0009', module: 'expenses', entityType: 'expense',
  permissionChecked: true, webPath: '/companies/c1/expenses/e1',
};
const expenseDetailOutput = (data: Record<string, unknown>, asOf?: string): SpecialistOutput =>
  readOutput('expense.get_detail', data, EXPENSE_DETAIL_SOURCE, asOf);
const expenseDetailData = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  expenseDate: '2026-08-05T10:00:00.000Z', vendorName: 'ร้านสมใจ', status: 'CONFIRMED',
  paymentStatus: 'PAID', grandTotalAmount: '900.00', ...over,
});

describe('R-L4 F12 expense.get_detail::single_metric — รายละเอียดค่าใช้จ่าย', () => {
  it('states the Thai date, vendor, amount, document/payment status, source, as-of and link (Thai)', () => {
    const r = formatPreparedSimpleRead(EXPENSE_DETAIL, expenseDetailOutput(expenseDetailData()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^ค่าใช้จ่าย: ร้านสมใจ วันที่ 5 สิงหาคม 2569 ยอด 900\.00 บาท/);
    assert.match(r.replyText, /\nสถานะเอกสาร: ยืนยันแล้ว · สถานะการจ่าย: ชำระแล้ว/);
    assert.doesNotMatch(r.replyText, /ที่มา:|Source:/);
    assert.deepEqual(r.webLinks, [{ label: 'EXP-2026-0009', path: '/companies/c1/expenses/e1' }]);
  });

  it('answers in English with the same grounded values', () => {
    const r = formatPreparedSimpleRead(EXPENSE_DETAIL, expenseDetailOutput(expenseDetailData()), EN);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      // C6 (batch 5c): the English headline now uses a calendar date too, matching the Thai side.
      assert.match(r.replyText, /^Expense: ร้านสมใจ, 5 Aug 2026, 900\.00 THB/);
      assert.match(r.replyText, /\nDocument status: Confirmed · Payment status: Paid/);
    }
  });

  it('names an unnamed vendor instead of leaving it blank', () => {
    const r = formatPreparedSimpleRead(EXPENSE_DETAIL, expenseDetailOutput(expenseDetailData({ vendorName: null })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /^ค่าใช้จ่าย: ไม่ระบุร้าน/);
  });

  it('states the category only when the tool names one', () => {
    const withCategory = formatPreparedSimpleRead(EXPENSE_DETAIL,
      expenseDetailOutput(expenseDetailData({ categoryName: 'อาหาร' })), TH);
    assert.equal(withCategory.kind, 'answer');
    if (withCategory.kind === 'answer') assert.match(withCategory.replyText, /\nหมวด: อาหาร/);
    const without = formatPreparedSimpleRead(EXPENSE_DETAIL, expenseDetailOutput(expenseDetailData()), TH);
    assert.equal(without.kind, 'answer');
    if (without.kind === 'answer') assert.doesNotMatch(without.replyText, /\nหมวด:/);
  });

  it('item 1: states the own/related scope the same way the single-metric family does', () => {
    const own = formatPreparedSimpleRead(EXPENSE_DETAIL, expenseDetailOutput(expenseDetailData({ accessScope: 'own' })), TH);
    assert.equal(own.kind, 'answer');
    if (own.kind === 'answer') assert.match(own.replyText, /\nขอบเขต: เฉพาะรายการของคุณ/);
    const company = formatPreparedSimpleRead(EXPENSE_DETAIL, expenseDetailOutput(expenseDetailData({ accessScope: 'company' })), TH);
    assert.equal(company.kind, 'answer');
    if (company.kind === 'answer') assert.doesNotMatch(company.replyText, /ขอบเขต:/);
  });

  it('never fabricates for a malformed or incomplete shape', () => {
    for (const broken of [
      expenseDetailData({ expenseDate: undefined }), expenseDetailData({ expenseDate: 'not-a-date' }),
      expenseDetailData({ grandTotalAmount: null }), expenseDetailData({ status: '' }),
      expenseDetailData({ status: 42 }), expenseDetailData({ paymentStatus: undefined }),
    ]) {
      assert.equal(formatPreparedSimpleRead(EXPENSE_DETAIL, expenseDetailOutput(broken), TH).kind, 'unverified');
    }
  });
});

// ── R-L4 F13 — reimbursement.get_detail::single_metric ("ใบเบิกที่ 2 สถานะอะไร") ────────────────────
// Fixture shape copied from the real tool result (ReimbursementGetDetailTool's success path,
// erp-core-detail-tools.use-case.ts): ONE permission-scoped record, never a page.
const REIMBURSEMENT_DETAIL_SOURCE: SourceRef = {
  label: 'REQ-0002', module: 'reimbursements', entityType: 'reimbursement',
  permissionChecked: true, webPath: '/companies/c1/reimbursements/r2',
};
const reimbursementDetailOutput = (data: Record<string, unknown>, asOf?: string): SpecialistOutput =>
  readOutput('reimbursement.get_detail', data, REIMBURSEMENT_DETAIL_SOURCE, asOf);
const reimbursementDetailData = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  requesterDisplayName: 'สมชาย', incurredDate: '2026-08-06', amount: '1500.00', status: 'PENDING_APPROVAL', ...over,
});

describe('R-L4 F13 reimbursement.get_detail::single_metric — รายละเอียดใบเบิก', () => {
  it('states the requester, Thai date, amount, status, source, as-of and link (Thai)', () => {
    const r = formatPreparedSimpleRead(REIMBURSEMENT_DETAIL, reimbursementDetailOutput(reimbursementDetailData()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^ใบเบิกจ่าย: สมชาย วันที่ 6 สิงหาคม 2569 ยอด 1,500\.00 บาท/);
    assert.match(r.replyText, /\nสถานะ: รออนุมัติ/);
    assert.doesNotMatch(r.replyText, /ที่มา:|Source:/);
    assert.deepEqual(r.webLinks, [{ label: 'REQ-0002', path: '/companies/c1/reimbursements/r2' }]);
  });

  it('answers in English with the same grounded values', () => {
    const r = formatPreparedSimpleRead(REIMBURSEMENT_DETAIL, reimbursementDetailOutput(reimbursementDetailData()), EN);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      // C6 (batch 5c): the English headline now uses a calendar date too, matching the Thai side.
      assert.match(r.replyText, /^Reimbursement: สมชาย, 6 Aug 2026, 1,500\.00 THB/);
      assert.match(r.replyText, /\nStatus: Pending approval/);
    }
  });

  it('names an unnamed requester instead of leaving it blank', () => {
    const r = formatPreparedSimpleRead(REIMBURSEMENT_DETAIL,
      reimbursementDetailOutput(reimbursementDetailData({ requesterDisplayName: undefined })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /^ใบเบิกจ่าย: ไม่ระบุผู้ขอ/);
  });

  it('renders every known status in the same Thai wording the web app already uses', () => {
    const labels: Record<string, string> = {
      DRAFT: 'ร่าง', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ปฏิเสธ',
      CANCELLED: 'ยกเลิก', FINANCE_REVIEW: 'รอตรวจสอบการเงิน', READY_FOR_PAYMENT: 'พร้อมจ่าย',
      PARTIALLY_PAID: 'จ่ายบางส่วน', PAID: 'จ่ายแล้ว', VOIDED: 'เพิกถอน',
    };
    for (const [status, label] of Object.entries(labels)) {
      const r = formatPreparedSimpleRead(REIMBURSEMENT_DETAIL, reimbursementDetailOutput(reimbursementDetailData({ status })), TH);
      assert.equal(r.kind, 'answer', status);
      if (r.kind === 'answer') assert.match(r.replyText, new RegExp(`\\nสถานะ: ${label}$`, 'm'), status);
    }
  });

  it('never fabricates for a malformed or incomplete shape', () => {
    for (const broken of [
      reimbursementDetailData({ incurredDate: undefined }), reimbursementDetailData({ incurredDate: 'bad-date' }),
      reimbursementDetailData({ amount: null }), reimbursementDetailData({ status: '' }),
      reimbursementDetailData({ status: 7 }),
    ]) {
      assert.equal(formatPreparedSimpleRead(REIMBURSEMENT_DETAIL, reimbursementDetailOutput(broken), TH).kind, 'unverified');
    }
  });
});
