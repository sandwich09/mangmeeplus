import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateState, aggregationIncomplete, appliedPeriod, expenseNameResolutionIssue, expenseNameResolutionReplyText,
  expensePeriodComparison, expensePeriodComparisonReplyText, expenseBreakdownShares } from './business-read-result-semantics';

describe('business read result semantics', () => {
  it('uses the API-applied period instead of the requested proposal', () => {
    assert.deepEqual(appliedPeriod({ queryApplied: { period: { startDate: '2026-02-01', endDate: '2026-02-28' } } }), {
      fromDate: '2026-02-01', toDate: '2026-02-28',
    });
  });

  it('treats bounded rows as compatible with a complete aggregate', () => {
    assert.equal(aggregationIncomplete({
      completeness: {
        aggregate: 'complete',
        rows: { returned: 5, hasMore: true, nextCursor: 'next' },
      },
    }), false);
  });

  it('rejects partial/unknown aggregates and legacy truthy incomplete flags', () => {
    assert.equal(aggregationIncomplete({ completeness: { aggregate: 'partial' } }), true);
    assert.equal(aggregationIncomplete({ completeness: { aggregate: 'unknown' } }), true);
    assert.equal(aggregationIncomplete({ cappedPages: true }), true);
  });

  it('distinguishes mixed-currency conflict from an explicit empty aggregate', () => {
    assert.equal(aggregateState({ mixedCurrency: true, totalAmount: '123.00' }), 'conflict');
    assert.equal(aggregateState({ facts: [{ state: 'empty' }], completeness: { aggregate: 'complete' } }), 'empty');
  });
});

describe('item 2: expense name resolution (ambiguous/not-found)', () => {
  function output(data: Record<string, unknown>) {
    return [{ agent: 'accounting' as const, status: 'SUCCEEDED' as const, summary: '', suggestions: [], requiresHumanReview: false,
      facts: [], toolCalls: [], toolData: [{ tool: 'expense.list_recent', data }] }];
  }

  it('reports an ambiguous vendor with its distinct display names', () => {
    const issue = expenseNameResolutionIssue(output({ vendorAmbiguous: 'สมใจ', availableVendors: [{ name: 'ร้านสมใจ' }, { name: 'ร้านสมใจการค้า' }] }));
    assert.deepEqual(issue, { kind: 'ambiguous', field: 'vendor', requested: 'สมใจ', names: ['ร้านสมใจ', 'ร้านสมใจการค้า'] });
    assert.match(expenseNameResolutionReplyText(issue!, false), /ร้านสมใจ.*ร้านสมใจการค้า|ร้านสมใจการค้า.*ร้านสมใจ/su);
  });

  it('reports a not-found category as a terminal statement, not a question', () => {
    const issue = expenseNameResolutionIssue(output({ categoryUnresolved: 'ค่าเช่า', availableCategories: [{ name: 'ค่าน้ำมัน' }] }));
    assert.equal(issue?.kind, 'not_found');
    assert.match(expenseNameResolutionReplyText(issue!, false), /ค่าน้ำมัน/);
  });

  it('finds nothing in an ordinary successful result', () => {
    assert.equal(expenseNameResolutionIssue(output({ total: 3 })), undefined);
  });
});

describe('item 3(a)/(c): expense period comparison', () => {
  const THIS_MONTH = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, totalAmount: '17765', totalCount: 14,
    byCategory: [{ category: 'ค่าใช้จ่ายอื่นๆ', totalAmount: '4599.5' }, { category: 'ค่าบริการ', totalAmount: '4188.5' }] };
  const LAST_MONTH = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, totalAmount: '40453', totalCount: 14,
    byCategory: [{ category: 'ค่าใช้จ่ายอื่นๆ', totalAmount: '7175.5' }, { category: 'ค่าบริการ', totalAmount: '10764.5' }] };

  it('computes each period total, the difference, and the percent change to one decimal', () => {
    const comparison = expensePeriodComparison('expense.get_breakdown', LAST_MONTH, THIS_MONTH);
    assert.ok(comparison);
    assert.equal(comparison.periodA.totalAmount, '40453');
    assert.equal(comparison.periodB.totalAmount, '17765');
    assert.equal(comparison.diffAmount, '-22,688.00');
    assert.equal(comparison.percent, '-56.1%');
    assert.match(comparison.factsText, /-22,688\.00/);
  });

  it('computes the same difference and percent per matching category', () => {
    const comparison = expensePeriodComparison('expense.get_breakdown', LAST_MONTH, THIS_MONTH);
    // ค่าบริการ: 10,764.50 -> 4,188.50, difference -6,576.00, -61.1%
    assert.match(comparison!.factsText, /ค่าบริการ.*-6,576\.00.*-61\.1%/su);
  });

  it('returns undefined for the same period, or a shape neither tool produces', () => {
    assert.equal(expensePeriodComparison('expense.get_breakdown', THIS_MONTH, THIS_MONTH), undefined);
    assert.equal(expensePeriodComparison('expense.get_breakdown', {}, THIS_MONTH), undefined);
  });

  it('renders the exact spec shape: ช่วง A / ช่วง B / ต่างกัน', () => {
    const comparison = expensePeriodComparison('expense.get_breakdown', LAST_MONTH, THIS_MONTH)!;
    const text = expensePeriodComparisonReplyText(comparison);
    assert.equal(text, 'ช่วง 2026-08-01 – 2026-08-31: 40,453.00 บาท (14 รายการ)\n'
      + 'ช่วง 2026-09-01 – 2026-09-28: 17,765.00 บาท (14 รายการ)\n'
      + 'ต่างกัน -22,688.00 บาท (-56.1%)');
  });

  it('also compares expense.list_recent by payment/document status amounts', () => {
    const augData = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, total: 8, summary: { totalAmount: '20157', paidAmount: '0', unpaidAmount: '20157' } };
    const sepData = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, total: 8, summary: { totalAmount: '10621', paidAmount: '0', unpaidAmount: '10621' } };
    const comparison = expensePeriodComparison('expense.list_recent', augData, sepData);
    assert.ok(comparison);
    assert.match(comparison.factsText, /ยังไม่จ่าย.*-9,536\.00/su);
  });
});

describe('item 3(b): expense breakdown shares', () => {
  it('computes each category\'s share of the period total to one decimal', () => {
    const shares = expenseBreakdownShares({ totalAmount: '17765', byCategory: [
      { category: 'ค่าใช้จ่ายอื่นๆ', totalAmount: '4599.5' }, { category: 'ค่าบริการ', totalAmount: '4188.5' },
    ] });
    assert.match(shares, /ค่าใช้จ่ายอื่นๆ: สัดส่วน 25\.9%/);
    assert.match(shares, /ค่าบริการ: สัดส่วน 23\.6%/);
  });

  it('returns empty text for a zero or missing total, never a division by zero artifact', () => {
    assert.equal(expenseBreakdownShares({ totalAmount: '0', byCategory: [{ category: 'x', totalAmount: '0' }] }), '');
    assert.equal(expenseBreakdownShares({}), '');
  });
});

