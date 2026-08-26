import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SourceRef, SpecialistOutput } from '@watchdog-bms/contracts';
import { activePreparedFamilies, COMPILED_PREPARED_FAMILY_KEYS, formatPreparedSimpleRead, preparedTerminalReply } from './prepared-simple-read-formatter';

const SALES = 'sales.get_sales_summary::single_metric';
const EXPENSE = 'expense.list_recent::single_metric';
const ACCOUNTING = 'accounting.get_summary::list';
const DAILY = 'expense.get_daily_closing::single_metric';
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
  it('exposes exactly the compiled families (sales, F1 expense, F2 accounting, F3 daily — compiled ≠ active)', () => {
    assert.deepEqual([...COMPILED_PREPARED_FAMILY_KEYS], [SALES, EXPENSE, ACCOUNTING, DAILY]);
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
      assert.match(r.replyText, /ที่มา: ยอดขายรวม/);
      assert.match(r.replyText, /ข้อมูล ณ 2026-07-15/);
      assert.equal(r.webLinks[0]?.path, '/sales');
    }
  });

  it('states the REQUESTED single date from the validated proposed input (Thai)', () => {
    const r = formatPreparedSimpleRead(SALES, salesOutput({ totalSales: '5,000', period: { fromDate: '2026-07-01', toDate: '2026-07-31' } }),
      { language: 'th', locale: 'th-TH', proposedInput: { fromDate: '2026-07-15', toDate: '2026-07-15' } });
    assert.equal(r.kind, 'answer');
    // The proposed input WINS over the echoed range: the answer names the requested single day.
    if (r.kind === 'answer') assert.match(r.replyText, /\nช่วง: 2026-07-15/);
  });

  it('states the REQUESTED date range from the validated proposed input (English)', () => {
    const r = formatPreparedSimpleRead(SALES, salesOutput({ totalSales: '9,000' }),
      { language: 'en', locale: 'en-US', proposedInput: { fromDate: '2026-07-01', toDate: '2026-07-31' } });
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /\nPeriod: 2026-07-01 – 2026-07-31/);
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
const expenseOutput = (data: Record<string, unknown>): SpecialistOutput => readOutput('expense.list_recent', data, EXPENSE_SOURCE);
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
    assert.match(r.replyText, /\nช่วง: 2026-08-01 – 2026-08-25/);
    assert.match(r.replyText, /\nที่มา: รายการค่าใช้จ่าย/);
    assert.match(r.replyText, /\nข้อมูล ณ 2026-08-25/);
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
    if (r.kind === 'answer') assert.match(r.replyText, /^ค่าใช้จ่าย: 0\.00 บาท \(0 รายการ\)/);
  });

  it('renders satang precision, not the float noise of a summed JS number', () => {
    // 33.33 + 66.67 sums to 100.00000000000001 in the tool; the answer must not show that.
    const r = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData({ total: 2, summary: expenseSummary({ countedItems: 2, totalAmount: 33.33 + 66.67 }) })), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /^ค่าใช้จ่าย: 100\.00 บาท \(2 รายการ\)/);
  });

  it('prefers the validated proposed input over the tool-echoed period, and never fabricates one', () => {
    const requested = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData()), { ...TH, proposedInput: { fromDate: '2026-07-01', toDate: '2026-07-31' } });
    if (requested.kind === 'answer') assert.match(requested.replyText, /\nช่วง: 2026-07-01 – 2026-07-31/);
    // No proposed dates (the tool's current-month default): the tool's own echoed window is stated.
    const echoed = formatPreparedSimpleRead(EXPENSE, expenseOutput(expenseData()), { ...TH, proposedInput: {} });
    if (echoed.kind === 'answer') assert.match(echoed.replyText, /\nช่วง: 2026-08-01 – 2026-08-25/);
    // Neither names a period → the line is omitted rather than assuming a default the tool may not have used.
    const noPeriod = expenseData();
    delete noPeriod['period'];
    const omitted = formatPreparedSimpleRead(EXPENSE, expenseOutput(noPeriod), TH);
    if (omitted.kind === 'answer') assert.doesNotMatch(omitted.replyText, /ช่วง:/);
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
    assert.match(r.replyText, /\nช่วง: 2026-08-01 – 2026-08-31/);
    assert.match(r.replyText, /\nที่มา: สรุปเอกสารบัญชี/);
    assert.match(r.replyText, /\nข้อมูล ณ 2026-08-25/);
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
    if (r.kind === 'answer') assert.match(r.replyText, /\nPeriod: 2026-08-01 – 2026-08-15/);
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
    assert.match(preparedTerminalReply(failed, EN), /not available right now/);
    assert.match(preparedTerminalReply({ ...failed, status: 'PERMISSION_DENIED' }, TH), /ไม่มีสิทธิ์/);
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
const DAILY_SOURCE: SourceRef = {
  label: 'สรุปปิดร้าน 2026-08-26', module: 'expenses', entityType: 'expense_daily_closing',
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
  pendingReview: { count: 0, items: bounded(0) },
  evidenceBlockers: { count: 0, items: bounded(0) },
});

describe('F3 expense.get_daily_closing::single_metric — ค่าใช้จ่ายวันนี้', () => {
  it('answers the owner template: day, count, total, paid/unpaid, evidence backlog, source honesty (Thai)', () => {
    const r = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^วันนี้ \(26 ส\.ค\.\) มีค่าใช้จ่าย 3 รายการ รวม 2,450\.00 บาท/);
    assert.match(r.replyText, /\nจ่ายแล้ว 1,200\.00 บาท · ยังไม่ได้จ่าย 1,250\.00 บาท/);
    assert.match(r.replyText, /\nรอตรวจหลักฐานทั้งหมด 1 รายการ/);
    assert.match(r.replyText, /\nที่มา: สรุปปิดร้าน 2026-08-26/);
    assert.match(r.replyText, /\nข้อมูล ณ 2026-08-26/);
    // REQUIRED source honesty (spec G5): recorded entries with the wall-clock cut-off, not bank movement.
    assert.match(r.replyText, /\n\(จากรายการที่บันทึกในระบบ ถึง 14:30 — ไม่ใช่ยอดเงินเข้าออกธนาคาร\)$/);
    // Expense side only (owner decision 2026-08-26): no profit, and the ONLY "เงินเข้า" in the answer is
    // the honesty line's denial of it — the numbers above it never claim money in.
    assert.doesNotMatch(r.replyText.split('\n(จากรายการ')[0]!, /กำไร|เงินเข้า/);
    assert.doesNotMatch(r.replyText, /EXP-2026-0009/, 'bounded: raw records stay out of the bubble');
    assert.equal(r.webLinks[0]?.path, '/companies/c1/expenses');
    assert.equal(r.replyText, r.replyText.normalize('NFC'));
  });

  it('answers in English with the same grounded numbers and the same honesty line', () => {
    const r = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData()), EN);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^Today \(2026-08-26\): 3 expense records, total 2,450\.00 THB/);
    assert.match(r.replyText, /\nPaid 1,200\.00 THB · Unpaid 1,250\.00 THB/);
    assert.match(r.replyText, /\n1 record awaiting evidence review in total/);
    assert.match(r.replyText, /\n\(From entries recorded in the system, up to 14:30 — not bank money in\/out\)$/);
  });

  it('renders an explicit-empty day as an honest zero and states no amount the tool did not return', () => {
    const r = formatPreparedSimpleRead(DAILY, dailyOutput(emptyDay()), TH);
    assert.equal(r.kind, 'answer');
    if (r.kind !== 'answer') return;
    assert.match(r.replyText, /^วันนี้ \(26 ส\.ค\.\) มีค่าใช้จ่าย 0 รายการ\n/);
    assert.doesNotMatch(r.replyText, /รวม |จ่ายแล้ว|ยังไม่ได้จ่าย|รอตรวจหลักฐาน/);
    assert.match(r.replyText, /ไม่ใช่ยอดเงินเข้าออกธนาคาร\)$/, 'the honesty line is required even on an empty day');
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
      assert.match(past.replyText, /^วันที่ 2026-08-25 มีค่าใช้จ่าย 3 รายการ/);
      assert.doesNotMatch(past.replyText, /วันนี้/);
    }
    const pastEn = formatPreparedSimpleRead(DAILY, dailyOutput(dailyData({ date: '2026-08-25' })), EN);
    if (pastEn.kind === 'answer') assert.match(pastEn.replyText, /^On 2026-08-25: /);
    // No usable as-of → no "today" claim and no invented cut-off time, but the honesty line stays.
    const noAsOf = formatPreparedSimpleRead(DAILY, { ...dailyOutput(dailyData()), asOf: undefined }, TH);
    if (noAsOf.kind === 'answer') {
      assert.match(noAsOf.replyText, /^วันที่ 2026-08-26 /);
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
    assert.match(preparedTerminalReply(failed, EN), /not available right now/);
    // Another family's data can never be answered as this one.
    assert.equal(formatPreparedSimpleRead(DAILY, expenseOutput(expenseData()), TH).kind, 'unverified');
    assert.equal(formatPreparedSimpleRead(EXPENSE, dailyOutput(dailyData()), TH).kind, 'unverified');
  });
});
