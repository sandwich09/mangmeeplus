import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateState, aggregationIncomplete, appliedPeriod, expenseNameResolutionIssue, expenseNameResolutionReplyText,
  expensePeriodComparison, expensePeriodComparisonReplyText, expenseBreakdownShares,
  reimbursementApprovalNotPermittedReplyText, packageManagerRequiredReplyText, reimbursementPendingApprovalsTotal,
  withoutUnaskedPackagePurchaseLine } from './business-read-result-semantics';

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

  it('reports an out-of-scope branch as a terminal statement naming only the caller\'s own branches', () => {
    const issue = expenseNameResolutionIssue(output({ branchOutOfScope: 'บางนา', availableBranches: [{ name: 'สาธุประดิษฐ์' }] }));
    assert.deepEqual(issue, { kind: 'out_of_scope', field: 'branch', requested: 'บางนา', names: ['สาธุประดิษฐ์'] });
    const reply = expenseNameResolutionReplyText(issue!, false);
    assert.match(reply, /คุณดูข้อมูลได้เฉพาะสาขา สาธุประดิษฐ์ ค่ะ/);
    assert.doesNotMatch(reply, /บางนา/);
  });

  it('renders the out-of-scope reply in English too', () => {
    const issue = expenseNameResolutionIssue(output({ branchOutOfScope: 'บางนา', availableBranches: [{ name: 'Head Office' }] }));
    assert.match(expenseNameResolutionReplyText(issue!, true), /You can only view branch\(es\): Head Office/);
  });

  // F3 (tuning-6b): expense.get_daily_closing now resolves branchId the same way as list_recent/
  // get_breakdown (resolveExpenseBranchFilter), so its ambiguous/unresolved/out-of-scope result must
  // be recognized here too, not just the two original tools.
  it('also reads expense.get_daily_closing\'s branch resolution outcome (F3, tuning-6b)', () => {
    const dailyClosingOutput = [{ agent: 'accounting' as const, status: 'SUCCEEDED' as const, summary: '', suggestions: [], requiresHumanReview: false,
      facts: [], toolCalls: [], toolData: [{ tool: 'expense.get_daily_closing', data: { branchOutOfScope: 'สาขา 2', availableBranches: [{ name: 'สาขา 1' }] } }] }];
    const issue = expenseNameResolutionIssue(dailyClosingOutput);
    assert.deepEqual(issue, { kind: 'out_of_scope', field: 'branch', requested: 'สาขา 2', names: ['สาขา 1'] });
  });
});

describe('reimbursement.list_pending_approvals forbidden outcome (REIMBURSEMENT_APPROVAL_NOT_PERMITTED)', () => {
  it('names the role limit and the self-serve alternative, in Thai and English', () => {
    const th = reimbursementApprovalNotPermittedReplyText(false);
    assert.match(th, /บทบาทของคุณยังไม่มีสิทธิ์ดูหรืออนุมัติใบเบิกของคนอื่นค่ะ/);
    assert.match(th, /ใบเบิกของฉันถึงไหนแล้ว/);
    const en = reimbursementApprovalNotPermittedReplyText(true);
    assert.match(en, /does not have permission/);
    assert.match(en, /reimbursement claim/);
  });
});

describe('billing.get_package_usage forbidden outcome (PACKAGE_MANAGER_REQUIRED, advisor spec P8)', () => {
  it('sends the asker to the owner or a package manager, with no figure and no link, in Thai and English', () => {
    assert.equal(packageManagerRequiredReplyText(false), 'เรื่องแพ็กเกจและเครดิตของร้าน ถามเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจได้นะคะ');
    assert.match(packageManagerRequiredReplyText(true), /ask the shop owner or someone who manages the package/);
    for (const text of [packageManagerRequiredReplyText(false), packageManagerRequiredReplyText(true)]) assert.doesNotMatch(text, /\d|https?:|\/companies\//u);
  });
});

describe('package answers invite no unasked purchase (owner 2026-09-30, advisor eval r5/r6/r10)', () => {
  it('drops the closing buy or change invitation unless the clause asked about buying, changing or upgrading', () => {
    const prices = 'แพ็กเกจที่ใหญ่กว่ามีดังนี้ค่ะ\n\n• เติบโต — รายเดือน 499 บาท\n\nหมายเหตุ: ยังไม่มีข้อมูลว่าราคาเหล่านี้รวม VAT หรือไม่ค่ะ';
    const question = 'แล้วแพ็กเกจที่ใหญ่กว่าราคาเท่าไหร่';
    assert.equal(withoutUnaskedPackagePurchaseLine(`${prices}\n\nหากต้องการเปลี่ยนแพ็กเกจ ทำได้บนเว็บที่หน้าแพ็กเกจของร้านค่ะ`, question), prices);
    // r5: the invitation rode the end of the VAT note on the same line.
    assert.equal(withoutUnaskedPackagePurchaseLine('หมายเหตุ: ยังไม่มีข้อมูลว่าราคาข้างต้นรวม VAT หรือไม่ และหากต้องการเปลี่ยนหรือซื้อแพ็กเกจ สามารถทำได้บนเว็บที่หน้าแพ็กเกจของร้านค่ะ', question),
      'หมายเหตุ: ยังไม่มีข้อมูลว่าราคาข้างต้นรวม VAT หรือไม่');
    // Asked how to upgrade: the web-page answer is the answer.
    const upgrade = 'การซื้อหรือเปลี่ยนแพ็กเกจทำได้บนเว็บ ที่หน้าแพ็กเกจของร้านค่ะ\nหากต้องการเปลี่ยนแพ็กเกจ กดลิงก์ด้านล่างได้เลยค่ะ';
    assert.equal(withoutUnaskedPackagePurchaseLine(upgrade, 'อยากอัปเกรดแพ็กเกจต้องทำยังไง'), upgrade);
    // A page pointer that invites no purchase, and "ยังไม่เปิดให้ซื้อ", stay.
    for (const kept of ['ถ้าอยากติดตามใกล้ชิด ดูรายละเอียดได้ที่หน้าแพ็กเกจของร้านนะคะ', 'แพ็กเกจธุรกิจยังไม่เปิดให้ซื้อตอนนี้ค่ะ'])
      assert.equal(withoutUnaskedPackagePurchaseLine(kept, question), kept);
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

  it('renders the exact spec shape ช่วง A / ช่วง B / direction sentence when the tool carries no matching sub-split (expense.list_recent)', () => {
    const augData = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, total: 14, summary: { totalAmount: '40453' } };
    const sepData = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, total: 14, summary: { totalAmount: '17765' } };
    const comparison = expensePeriodComparison('expense.list_recent', augData, sepData)!;
    const text = expensePeriodComparisonReplyText(comparison);
    // A8: Thai period labels (a whole month prints without a day range; month-to-date keeps one)
    // replace the raw ISO dates, and a direction sentence (from the LATER period's point of view)
    // replaces the bare signed "ต่างกัน" line — list_recent never gets rankLines (ungrouped).
    assert.equal(text, 'ช่วง ส.ค. 2569: 40,453.00 บาท (14 รายการ)\n'
      + 'ช่วง 1–28 ก.ย. 2569: 17,765.00 บาท (14 รายการ)\n'
      + '1–28 ก.ย. 2569 น้อยกว่า ส.ค. 2569 22,688.00 บาท (ลดลง 56.1%)');
  });

  it('also compares expense.list_recent by payment/document status amounts, but never in the deterministic reply (spec §3 row 9 is totals-only)', () => {
    const augData = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, total: 8, summary: { totalAmount: '20157', paidAmount: '0', unpaidAmount: '20157' } };
    const sepData = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, total: 8, summary: { totalAmount: '10621', paidAmount: '0', unpaidAmount: '10621' } };
    const comparison = expensePeriodComparison('expense.list_recent', augData, sepData);
    assert.ok(comparison);
    // factsText (compose's grounding context) still carries the status split...
    assert.match(comparison.factsText, /ยังไม่จ่าย.*-9,536\.00/su);
    // ...but the deterministic customer-facing reply stays the plain 3 lines for this tool.
    assert.doesNotMatch(expensePeriodComparisonReplyText(comparison), /ยังไม่จ่าย/su);
  });

  it('tuning-3 item 4 (T-016/T-082): a grouped (get_breakdown) comparison\'s deterministic reply also ranks in its matching category lines', () => {
    const comparison = expensePeriodComparison('expense.get_breakdown', LAST_MONTH, THIS_MONTH)!;
    const text = expensePeriodComparisonReplyText(comparison);
    // A8: Thai period labels, a direction sentence instead of the bare "ต่างกัน" line, PLUS the new
    // rankLines (independent top-3-per-period) appended after groupLines.
    assert.equal(text, [
      'ช่วง ส.ค. 2569: 40,453.00 บาท (14 รายการ)',
      'ช่วง 1–28 ก.ย. 2569: 17,765.00 บาท (14 รายการ)',
      comparison.directionLine,
      ...comparison.groupLines,
      ...comparison.rankLines,
    ].join('\n'), 'the reply is the 3 summary lines plus the ranked groupLines plus rankLines');
    assert.match(text, /ค่าบริการ.*-6,576\.00.*-61\.1%/su);
    assert.match(text, /ค่าใช้จ่ายอื่นๆ.*-2,576\.00/su);
    // ค่าบริการ (10,764.50 บาท, the larger of its two periods) ranks ahead of ค่าใช้จ่ายอื่นๆ (7,175.50).
    assert.ok(text.indexOf('ค่าบริการ') < text.indexOf('ค่าใช้จ่ายอื่นๆ'), 'groups rank by amount, largest first');
    // A8: rank 1 differs between the two periods (ค่าบริการ vs ค่าใช้จ่ายอื่นๆ) — stated explicitly.
    assert.match(text, /อันดับ 1 ส\.ค\. 2569: ค่าบริการ.*1–28 ก\.ย\. 2569: ค่าใช้จ่ายอื่นๆ.*ไม่ใช่หมวดเดียวกัน/su);
  });

  it('tuning-3 item 4: never a group either period did not actually return in groupLines, ranked by the larger side first', () => {
    const augOnly = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, totalAmount: '10000', totalCount: 3,
      byCategory: [{ category: 'ค่าน้ำมัน', totalAmount: '1000' }, { category: 'ค่าเดินทางเท่านั้นเดือนสิงหา', totalAmount: '9000' }] };
    const sepOnly = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, totalAmount: '2000', totalCount: 2,
      byCategory: [{ category: 'ค่าน้ำมัน', totalAmount: '2000' }] };
    const comparison = expensePeriodComparison('expense.get_breakdown', augOnly, sepOnly)!;
    assert.match(comparison.groupLines.join('\n'), /ค่าน้ำมัน/);
    assert.doesNotMatch(comparison.groupLines.join('\n'), /ค่าเดินทางเท่านั้นเดือนสิงหา/,
      'a category the OTHER period never returned must never be printed in the matched groupLines');
    // A8: rankLines are independent PER period — a period-exclusive top group legitimately appears
    // there (that is exactly what reveals "not the same category" to the customer).
    assert.match(comparison.rankLines.join('\n'), /ค่าเดินทางเท่านั้นเดือนสิงหา/);
  });

  it('tuning-3 item 4: ranks by amount (not input order) and caps at the same 8-group bound as the single-period formatter', () => {
    const category = (n: number) => `หมวด${n}`;
    // Deliberately NOT pre-sorted, so only a real sort-by-amount keeps the two smallest (idx 1, 6) out.
    const amounts = [500, 100, 900, 300, 1000, 700, 200, 800, 600, 400];
    const rows = amounts.map((totalAmount, i) => ({ category: category(i), totalAmount: String(totalAmount) }));
    const total = String(amounts.reduce((sum, value) => sum + value, 0));
    const augMany = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, totalAmount: total, totalCount: 10, byCategory: rows };
    const sepMany = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, totalAmount: total, totalCount: 10, byCategory: rows };
    const comparison = expensePeriodComparison('expense.get_breakdown', augMany, sepMany)!;
    const text = expensePeriodComparisonReplyText(comparison);
    for (const i of [0, 2, 3, 4, 5, 7, 8, 9]) assert.match(text, new RegExp(category(i)), `top-8 amount ${category(i)} must be shown`);
    for (const i of [1, 6]) assert.doesNotMatch(text, new RegExp(category(i)), `the two smallest amounts (${category(i)}) must be dropped by the cap`);
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

describe('A8 (batch5, T-082-a): comparison follows the applied groupBy, not always byCategory', () => {
  // Real numbers from the eval evidence (t082a-compare-topvendor.json): "จ่ายร้านไหนเยอะสุดเดือนนี้
  // กับเดือนที่แล้ว เหมือนกันไหมครับ" called get_breakdown groupBy vendor twice; the old code always
  // read byCategory, so the comparison silently answered with category rows instead.
  const AUGUST_VENDOR = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, totalAmount: '40453', totalCount: 14,
    queryApplied: { accessScope: 'company', filters: { groupBy: 'vendor' } },
    byCategory: [{ category: 'ควรไม่ถูกใช้', totalAmount: '999' }],
    byVendor: [
      { vendor: 'ไม่ระบุร้าน', totalAmount: '7587.0000' }, { vendor: 'Grab', totalAmount: '7313.5000' },
      { vendor: 'ร้านสมใจการค้า', totalAmount: '6764.5000' },
    ] };
  const SEPTEMBER_VENDOR = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, totalAmount: '17765', totalCount: 14,
    queryApplied: { accessScope: 'company', filters: { groupBy: 'vendor' } },
    byCategory: [{ category: 'ควรไม่ถูกใช้', totalAmount: '999' }],
    byVendor: [
      { vendor: 'ร้านสมใจการค้า', totalAmount: '4188.5000' }, { vendor: 'ร้านสมใจ', totalAmount: '3777.5000' },
      { vendor: 'ไม่ระบุร้าน', totalAmount: '3203.0000' },
    ] };

  it('reads byVendor (never byCategory) when queryApplied.filters.groupBy is "vendor"', () => {
    const comparison = expensePeriodComparison('expense.get_breakdown', AUGUST_VENDOR, SEPTEMBER_VENDOR)!;
    assert.ok(comparison);
    assert.doesNotMatch(comparison.factsText, /ควรไม่ถูกใช้/, 'byCategory rows must never leak in when groupBy is vendor');
    assert.match(comparison.factsText, /ร้านสมใจการค้า/);
  });

  it('exact real-world rank-1 line: T-082-a\'s "อันดับ 1" wording, numbers, and "not the same vendor"', () => {
    const comparison = expensePeriodComparison('expense.get_breakdown', AUGUST_VENDOR, SEPTEMBER_VENDOR)!;
    assert.equal(comparison.rankLines[0],
      'อันดับ 1 ส.ค. 2569: ไม่ระบุร้าน 7,587.00 บาท · 1–28 ก.ย. 2569: ร้านสมใจการค้า 4,188.50 บาท — ไม่ใช่ร้านเดียวกัน');
  });

  it('defaults to category (unchanged behavior) when queryApplied is absent or names no recognized groupBy', () => {
    const noQueryApplied = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, totalAmount: '100', totalCount: 1,
      byCategory: [{ category: 'ค่าน้ำมัน', totalAmount: '100' }] };
    const other = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, totalAmount: '200', totalCount: 1,
      byCategory: [{ category: 'ค่าน้ำมัน', totalAmount: '200' }] };
    const comparison = expensePeriodComparison('expense.get_breakdown', noQueryApplied, other)!;
    assert.match(comparison.factsText, /ค่าน้ำมัน/);
  });
});

describe('A8 (batch5, T-080-a): the fast lane\'s own scope sentence on an own/related-scoped comparison', () => {
  const AUG_OWN = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, total: 5, summary: { totalAmount: '17255.5' },
    queryApplied: { accessScope: 'related' } };
  const SEP_OWN = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, total: 5, summary: { totalAmount: '6295.5' },
    queryApplied: { accessScope: 'related' } };

  it('adds "ขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ" when either period is own/related-scoped (T-080-a: a STAFF user)', () => {
    const comparison = expensePeriodComparison('expense.list_recent', AUG_OWN, SEP_OWN)!;
    assert.equal(comparison.scopeLine, 'ขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ');
    // Exact T-080-a numbers: 17,255.50 บาท (5 รายการ) vs 6,295.50 บาท (5 รายการ), diff 10,960.00 (63.5%).
    assert.equal(comparison.directionLine, '1–28 ก.ย. 2569 น้อยกว่า ส.ค. 2569 10,960.00 บาท (ลดลง 63.5%)');
    assert.ok(expensePeriodComparisonReplyText(comparison).endsWith(comparison.scopeLine));
  });

  it('leaves scopeLine empty for a company-wide (or unscoped) comparison', () => {
    const companyWide = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, total: 5, summary: { totalAmount: '100' } };
    const companyWide2 = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, total: 5, summary: { totalAmount: '200' } };
    const comparison = expensePeriodComparison('expense.list_recent', companyWide, companyWide2)!;
    assert.equal(comparison.scopeLine, '');
    assert.ok(!expensePeriodComparisonReplyText(comparison).includes('ขอบเขต'));
  });
});

describe('A8 (batch5): Thai/English period labels on the comparison', () => {
  const wholeAug = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, total: 1, summary: { totalAmount: '1' } };
  const monthToDateSep = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, total: 1, summary: { totalAmount: '2' } };
  const singleDay27 = { period: { fromDate: '2026-09-27', toDate: '2026-09-27' }, total: 1, summary: { totalAmount: '1' } };
  const singleDay28 = { period: { fromDate: '2026-09-28', toDate: '2026-09-28' }, total: 1, summary: { totalAmount: '2' } };

  it('a whole month prints as just the month, Thai and English', () => {
    const th = expensePeriodComparison('expense.list_recent', wholeAug, monthToDateSep)!;
    assert.equal(th.periodA.label, 'ส.ค. 2569');
    const en = expensePeriodComparison('expense.list_recent', wholeAug, monthToDateSep, true)!;
    assert.equal(en.periodA.label, 'Aug 2026');
  });

  it('a month-to-date range keeps its day span, Thai and English', () => {
    const th = expensePeriodComparison('expense.list_recent', wholeAug, monthToDateSep)!;
    assert.equal(th.periodB.label, '1–28 ก.ย. 2569');
    const en = expensePeriodComparison('expense.list_recent', wholeAug, monthToDateSep, true)!;
    assert.equal(en.periodB.label, '1–28 Sep 2026');
  });

  it('a single day prints once, Thai', () => {
    const comparison = expensePeriodComparison('expense.list_recent', singleDay27, singleDay28)!;
    assert.equal(comparison.periodA.label, '27 ก.ย. 2569');
    assert.equal(comparison.periodB.label, '28 ก.ย. 2569');
  });
});

describe('A3 (batch5, T-084-b): reimbursement.list_pending_approvals code-computed total', () => {
  it('sums complete, single-currency items into the exact spec label', () => {
    const text = reimbursementPendingApprovalsTotal({ total: 2, items: [
      { amount: '1200.00', currency: 'THB' }, { amount: '866.00', currency: 'THB' },
    ] });
    assert.equal(text, 'ใบเบิกรออนุมัติทั้งหมด: 2 รายการ รวม 2,066.00 บาท');
  });

  it('returns undefined when the list is truncated (items shorter than total)', () => {
    assert.equal(reimbursementPendingApprovalsTotal({ total: 3, items: [
      { amount: '1200.00', currency: 'THB' }, { amount: '866.00', currency: 'THB' },
    ] }), undefined);
  });

  it('returns undefined for mixed currencies — never a meaningless cross-currency sum', () => {
    assert.equal(reimbursementPendingApprovalsTotal({ total: 2, items: [
      { amount: '1200.00', currency: 'THB' }, { amount: '866.00', currency: 'USD' },
    ] }), undefined);
  });

  it('returns undefined for an empty (zero-pending) queue', () => {
    assert.equal(reimbursementPendingApprovalsTotal({ total: 0, items: [] }), undefined);
  });
});

