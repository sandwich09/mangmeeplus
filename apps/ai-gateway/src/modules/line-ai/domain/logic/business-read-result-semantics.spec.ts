import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateState, aggregationIncomplete, appliedPeriod, expenseNameResolutionIssue, expenseNameResolutionReplyText,
  expensePeriodComparison, expensePeriodComparisonReplyText, expenseBreakdownShares,
  reimbursementApprovalNotPermittedReplyText, packageManagerRequiredReplyText, reimbursementPendingApprovalsTotal,
  withoutUnaskedPackagePurchaseLine, withReceiptRestartDate, withAskedSubstituteQueueSideLead } from './business-read-result-semantics';
import type { ToolResult } from '@watchdog-bms/contracts';

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

describe('a monthly receipt answer names its restart day (advisor eval r11 P-02)', () => {
  const usage = (receipts: Record<string, unknown>): ToolResult => ({ toolName: 'billing.get_package_usage', status: 'ok', sourceRefs: [],
    asOf: '2026-10-01T03:00:00.000Z', data: { package: { label: 'มืออาชีพ (PRO)', termEndsOn: '2026-11-10' },
      receipts: { used: 37, limit: 100, remaining: 63, cadence: 'รายเดือน เริ่มนับใหม่ทุกต้นเดือน', periodStartOn: '2026-10-01', periodEndsOn: '2026-10-31', ...receipts } } });
  const monthly = [usage({ resetsOn: '2026-11-01' })];

  it('adds the day when the answer talks receipts without it', () => {
    const r11 = 'แพ็กเกจมืออาชีพ (PRO) รอบเดือนนี้ (1–31 ต.ค. 2569) ใช้ไปแล้ว 37 ใบ เหลืออีก 63 ใบค่ะ';
    assert.equal(withReceiptRestartDate(r11, monthly, false), `${r11}\nใบเสร็จจะเริ่มนับใหม่ 1 พ.ย. 2569 ค่ะ`);
    assert.equal(withReceiptRestartDate('You have 63 receipts left this month.', monthly, true),
      'You have 63 receipts left this month.\nReceipts start counting again on Nov 1, 2026.');
  });

  it('leaves an answer that already names the day, in any form', () => {
    for (const stated of ['เหลือ 63 ใบ เริ่มนับใหม่ 1 พ.ย. 2569 ค่ะ', 'เหลือ 63 ใบ เริ่มนับใหม่ 1 พ.ย.', 'เหลือ 63 ใบ รอบใหม่เริ่มวันที่ 1 พฤศจิกายน',
      'เหลือ ๖๓ ใบ เริ่มนับใหม่ ๑ พย', 'เหลือ 63 ใบ รีเซ็ต 1/11 ค่ะ']) assert.equal(withReceiptRestartDate(stated, monthly, false), stated);
    assert.equal(withReceiptRestartDate('63 receipts left; the count restarts on November 1.', monthly, true), '63 receipts left; the count restarts on November 1.');
  });

  it('adds nothing without a restart day, a receipt topic or the usage read', () => {
    const text = 'เหลืออีก 63 ใบค่ะ';
    assert.equal(withReceiptRestartDate(text, [usage({ resetsOn: null })], false), text, 'a paid allowance or a package that ends first');
    assert.equal(withReceiptRestartDate('เพิ่มสาขาได้อีก 1 สาขาค่ะ', monthly, false), 'เพิ่มสาขาได้อีก 1 สาขาค่ะ', 'a branch answer');
    assert.equal(withReceiptRestartDate(text, [{ ...monthly[0]!, status: 'forbidden', data: undefined }], false), text);
    assert.equal(withReceiptRestartDate(text, [], false), text);
    // "1–31 ต.ค." is not the restart day of a month that restarts on 1 Oct either: the 1 of a range is not "1 ต.ค.".
    assert.equal(withReceiptRestartDate('รอบ 1–31 ต.ค. เหลือ 63 ใบ', [usage({ resetsOn: '2026-10-01' })], false).endsWith('ใบเสร็จจะเริ่มนับใหม่ 1 ต.ค. 2569 ค่ะ'), true);
  });
});

describe('a substitute-receipt queue answer leads with the side the question names (advisor R1 integrated eval S-09)', () => {
  const queue = (data: Record<string, unknown>): ToolResult => ({ toolName: 'expense.list_substitute_receipts_to_sign', status: 'ok', sourceRefs: [],
    asOf: '2026-10-01T03:00:00.000Z', data: { accessScope: 'own', ...data } });
  // S-09: shop B's owner — 1 to sign as the payer, 3 to approve (2 certified + 1 paper copy to accept).
  const both = [queue({ total: 4, asPayer: { count: 1, items: [] },
    asApprover: { count: 3, byStep: [{ stepLabel: 'รอคุณอนุมัติ', count: 2 }, { stepLabel: 'ฉบับกระดาษรอคุณตรวจรับ', count: 1 }], items: [] } })];
  const s09 = 'มีใบรับรองแทนใบเสร็จรอคุณดำเนินการทั้งหมด 4 ฉบับค่ะ\n\nรอลงลายมือชื่อในฐานะผู้จ่ายเงิน (1 ฉบับ)\n• SRC-202610-00035 — ร้านถ่ายเอกสาร 420 บาท\n\n'
    + 'รอคุณอนุมัติ (2 ฉบับ)\n• SRC-202610-00031 — ร้านวัสดุก่อสร้าง 1,500 บาท\n• SRC-202610-00032 — ร้านอะไหล่ 900 บาท\n\nฉบับกระดาษรอคุณตรวจรับ (1 ฉบับ)\n• SRC-202610-00033 — ร้านน้ำดื่ม 640 บาท';

  it('S-09: both sides came back and the question names approval — the reply leads with the approval count and keeps the rest', () => {
    for (const question of ['มีใบรับรองรอฉันอนุมัติไหม', 'มีใบรับรองให้ฉันอนุมัติไหมคะ', 'ใบรับรองแทนใบเสร็จที่รอฉันตรวจรับมีกี่ใบ']) {
      assert.equal(withAskedSubstituteQueueSideLead(s09, both, question, false), `ใบรับรองแทนใบเสร็จที่รอคุณอนุมัติมี 3 ใบค่ะ\n${s09}`, question);
    }
    assert.equal(withAskedSubstituteQueueSideLead('4 substitute receipts are waiting for you.', both, 'Any substitute receipts waiting for my approval?', true),
      '3 substitute receipts are waiting for your approval.\n4 substitute receipts are waiting for you.');
  });

  it('only a question that says ผู้จ่าย leads with the payer count', () => {
    for (const question of ['มีใบรับรองที่ฉันต้องเซ็นในฐานะผู้จ่ายเงินไหม', 'ใบรับรองที่รอฉันในฐานะผู้จ่ายมีกี่ใบ', 'มีใบรับรองที่ฉันต้องลงนามในฐานะผู้จ่ายเงินไหม']) {
      assert.equal(withAskedSubstituteQueueSideLead(s09, both, question, false), `ใบรับรองแทนใบเสร็จที่รอคุณลงลายมือชื่อในฐานะผู้จ่ายเงินมี 1 ใบค่ะ\n${s09}`, question);
    }
    assert.equal(withAskedSubstituteQueueSideLead('4 substitute receipts are waiting for you.', both, 'Which ones wait for me as the payer?', true),
      '1 substitute receipt is waiting for your signature as the payer.\n4 substitute receipts are waiting for you.');
  });

  // People say เซ็น for approving too, so a sign verb names no side — S-04 "ต้องเซ็นอะไรบ้าง" keeps its both-sides answer.
  it('a bare sign verb names no side: เซ็น, ลงนาม, ลงลายมือชื่อ and ลงชื่อ keep today\'s answer', () => {
    for (const question of ['ต้องเซ็นอะไรบ้าง', 'ใบรับรองใบเสร็จกี่ใบที่ฉันต้องเซ็น', 'มีใบรับรองแทนใบเสร็จรอฉันเซ็นกี่ใบ', 'มีใบรับรองรอฉันลงนามไหม',
      'ใบรับรองที่รอฉันลงลายมือชื่อมีกี่ใบ', 'มีใบรับรองให้ฉันลงชื่อไหม', 'Any substitute receipts for me to sign?']) {
      assert.equal(withAskedSubstituteQueueSideLead(s09, both, question, question.startsWith('Any')), s09, question);
    }
  });

  it('says so when nothing waits on the side asked about, even though the other side has some', () => {
    const payerOnly = [queue({ total: 2, asPayer: { count: 2, items: [] }, asApprover: { count: 0, items: [] } })];
    const text = 'มีใบรับรองแทนใบเสร็จรอคุณเซ็น 2 ใบค่ะ';
    assert.equal(withAskedSubstituteQueueSideLead(text, payerOnly, 'มีใบรับรองรอฉันอนุมัติไหม', false), `ไม่มีใบรับรองแทนใบเสร็จที่รอคุณอนุมัติค่ะ\n${text}`);
    const none = 'ตอนนี้ไม่มีใบรับรองแทนใบเสร็จที่รอคุณอนุมัติเลยค่ะ';
    assert.equal(withAskedSubstituteQueueSideLead(none, payerOnly, 'มีใบรับรองรอฉันอนุมัติไหม', false), none, 'already says none first');
  });

  it('leaves a reply whose first line already states that side\'s count, in any unit or Thai digits', () => {
    for (const stated of ['มีใบรับรองแทนใบเสร็จรอคุณอนุมัติ 3 ฉบับค่ะ\n• …', 'รอคุณอนุมัติอยู่ 3 ใบ และรอคุณเซ็น 1 ใบค่ะ', 'รอคุณอนุมัติ ๓ รายการค่ะ']) {
      assert.equal(withAskedSubstituteQueueSideLead(stated, both, 'มีใบรับรองรอฉันอนุมัติไหม', false), stated);
    }
    // A 3 inside another number or a date is not the count: "13 ใบ", "3 ต.ค.".
    assert.ok(withAskedSubstituteQueueSideLead('รวม 13 ใบ ณ 3 ต.ค. 2569', both, 'มีใบรับรองรอฉันอนุมัติไหม', false).startsWith('ใบรับรองแทนใบเสร็จที่รอคุณอนุมัติมี 3 ใบค่ะ\n'));
  });

  it('keeps today\'s answer when the question names neither side or both, the read carried a role, or another tool is in the answer', () => {
    for (const question of ['ใบรับรองรอฉันกี่ใบ', 'มีอะไรค้างที่ฉันต้องทำบ้าง', 'คิดเป็นกี่เปอร์เซ็นต์ของทั้งหมด',
      // Both sides named; and a sign verb beside อนุมัติ may be the payer's step, so the side is not clear.
      'ใบรับรองที่รอฉันในฐานะผู้จ่ายหรือผู้อนุมัติมีกี่ใบ', 'มีใบรับรองที่ฉันต้องเซ็นหรืออนุมัติไหม', 'มีใบรับรองรอฉันเซ็นอนุมัติไหม']) {
      assert.equal(withAskedSubstituteQueueSideLead(s09, both, question, false), s09, question);
    }
    const approverOnly = [queue({ total: 3, asApprover: { count: 3, items: [] } })];
    assert.equal(withAskedSubstituteQueueSideLead(s09, approverOnly, 'มีใบรับรองรอฉันอนุมัติไหม', false), s09, 'the router already passed role approver');
    const closing: ToolResult = { toolName: 'expense.get_daily_closing', status: 'ok', sourceRefs: [], asOf: '2026-10-01T03:00:00.000Z', data: {} };
    assert.equal(withAskedSubstituteQueueSideLead(s09, [...both, closing], 'มีใบรับรองรอฉันอนุมัติไหม', false), s09);
    assert.equal(withAskedSubstituteQueueSideLead(s09, [{ ...both[0]!, status: 'forbidden', data: undefined }], 'มีใบรับรองรอฉันอนุมัติไหม', false), s09);
    assert.equal(withAskedSubstituteQueueSideLead(s09, [], 'มีใบรับรองรอฉันอนุมัติไหม', false), s09);
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

