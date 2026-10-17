import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateState, aggregationIncomplete, appliedPeriod, expenseNameResolutionIssue, expenseNameResolutionReplyText,
  expensePeriodComparison, expensePeriodComparisonSeries, expensePeriodComparisonReplyText, expensePeriodComparisonCard, expenseBreakdownShares,
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
    assert.match(th, /คุณยังไม่มีสิทธิ์ดูใบเบิก/);
    assert.match(th, /ดูแพ็กเกจ/);
    const en = reimbursementApprovalNotPermittedReplyText(true);
    assert.match(en, /does not have permission/);
    assert.match(en, /view claims/);
  });
});

describe('billing.get_package_usage forbidden outcome (PACKAGE_MANAGER_REQUIRED, advisor spec P8)', () => {
  it('sends the asker to the owner or a package manager, with no figure and no link, in Thai and English', () => {
    assert.equal(packageManagerRequiredReplyText(false), 'เรื่องแพ็กเกจและเครดิตของร้าน ถามเจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจได้นะคะ');
    assert.match(packageManagerRequiredReplyText(true), /ask the shop owner or someone who manages the package/);
    for (const text of [packageManagerRequiredReplyText(false), packageManagerRequiredReplyText(true)]) assert.doesNotMatch(text, /\d|https?:|\/companies\//u);
  });
});

describe('package answers tell nobody how to buy or change a package unasked (owner 2026-09-30, eval r5/r6/r10 and final P-32)', () => {
  const prices = 'แพ็กเกจที่ใหญ่กว่ามีดังนี้ค่ะ\n\n• เติบโต — รายเดือน 499 บาท\n\nหมายเหตุ: ยังไม่มีข้อมูลว่าราคาเหล่านี้รวม VAT หรือไม่ค่ะ';
  const question = 'แล้วแพ็กเกจที่ใหญ่กว่าราคาเท่าไหร่';

  it('drops the "หาก/ถ้า" invitation, to the end of its sentence', () => {
    assert.equal(withoutUnaskedPackagePurchaseLine(`${prices}\n\nหากต้องการเปลี่ยนแพ็กเกจ ทำได้บนเว็บที่หน้าแพ็กเกจของร้านค่ะ`, question), prices);
    // r5: the invitation rode the end of the VAT note on the same line.
    assert.equal(withoutUnaskedPackagePurchaseLine('หมายเหตุ: ยังไม่มีข้อมูลว่าราคาข้างต้นรวม VAT หรือไม่ และหากต้องการเปลี่ยนหรือซื้อแพ็กเกจ สามารถทำได้บนเว็บที่หน้าแพ็กเกจของร้านค่ะ', question),
      'หมายเหตุ: ยังไม่มีข้อมูลว่าราคาข้างต้นรวม VAT หรือไม่');
    // Recorded forms: "เพิ่มหรือเปลี่ยน", "ซื้อเพิ่มหรือเปลี่ยน", an invitation behind a fact about this package, a trailing emoji.
    assert.equal(withoutUnaskedPackagePurchaseLine('ขาดประมาณ 8 ใบค่ะ ถ้าต้องการเพิ่มหรือเปลี่ยนแพ็กเกจ ทำได้บนเว็บที่หน้าแพ็กเกจของร้านค่ะ', 'แพคเกจพอมั้ยเดือนนี้'), 'ขาดประมาณ 8 ใบค่ะ');
    assert.equal(withoutUnaskedPackagePurchaseLine('รอบนี้สิ้นสุด 11 ต.ค. 2569 และยังไม่ได้ตั้งต่ออายุอัตโนมัติ หากต้องการซื้อหรือเปลี่ยนแพ็กเกจ ทำได้ที่หน้าแพ็กเกจบนเว็บค่ะ', 'แพ็กเกจพอไหม'),
      'รอบนี้สิ้นสุด 11 ต.ค. 2569 และยังไม่ได้ตั้งต่ออายุอัตโนมัติ');
    assert.equal(withoutUnaskedPackagePurchaseLine('ราคา 249 บาทค่ะ หากต้องการดูรายละเอียดราคาหรือเปลี่ยนแพ็กเกจ สามารถเข้าไปดูได้ที่หน้าแพ็กเกจบนเว็บได้เลยนะคะ 😊', 'แพ็กเกจเริ่มต้นราคาเท่าไหร่'),
      'ราคา 249 บาทค่ะ');
  });

  it('drops the plain statement of where or how, and keeps the sentence before it', () => {
    // Final-assembly run, P-32: the statement followed the VAT note on one line.
    assert.equal(withoutUnaskedPackagePurchaseLine(`${prices} การซื้อหรือเปลี่ยนแพ็กเกจทำได้บนเว็บ ที่หน้าแพ็กเกจของร้านค่ะ`, question), prices);
    assert.equal(withoutUnaskedPackagePurchaseLine(`${prices}\n\nการซื้อหรือเปลี่ยนแพ็กเกจต้องทำบนเว็บนะคะ`, question), prices);
    assert.equal(withoutUnaskedPackagePurchaseLine('เหลือ 63 ใบค่ะ ส่วนการอัปเกรดหรือเปลี่ยนแพ็กเกจต้องทำบนเว็บไซต์ ที่หน้าแพ็กเกจของร้านค่ะ', 'เหลือใบเสร็จกี่ใบ'), 'เหลือ 63 ใบค่ะ');
    assert.equal(withoutUnaskedPackagePurchaseLine('เหลือ 63 ใบค่ะ สามารถอัปเกรดได้ที่หน้าแพ็กเกจบนเว็บนะคะ', 'เหลือใบเสร็จกี่ใบ'), 'เหลือ 63 ใบค่ะ');
    // A label or a bullet with nothing left behind it goes with its sentence.
    assert.equal(withoutUnaskedPackagePurchaseLine('เหลือ 63 ใบค่ะ\nหมายเหตุ: การซื้อหรือเปลี่ยนแพ็กเกจทำได้บนเว็บค่ะ', 'เหลือใบเสร็จกี่ใบ'), 'เหลือ 63 ใบค่ะ');
    assert.equal(withoutUnaskedPackagePurchaseLine('63 receipts left. Buying or changing a package is done on the web, on the shop\'s package page.', 'How many receipts are left?'), '63 receipts left.');
    assert.equal(withoutUnaskedPackagePurchaseLine('You have 63 receipts left. If you would like to upgrade your package, you can do it on the web.', 'How many receipts are left?'), 'You have 63 receipts left.');
  });

  it('keeps the answer whole when the clause asks about buying, changing, upgrading or renewing', () => {
    const upgrade = 'การซื้อหรือเปลี่ยนแพ็กเกจทำได้บนเว็บ ที่หน้าแพ็กเกจของร้านค่ะ\nหากต้องการเปลี่ยนแพ็กเกจ กดลิงก์ด้านล่างได้เลยค่ะ';
    for (const asked of ['อยากอัปเกรดแพ็กเกจต้องทำยังไง', 'แล้วถ้าอัปเกรดล่ะ', 'ควรเปลี่ยนแพ็กเกจไหม', 'ซื้อยังไง', 'เปลี่ยนแพ็กเกจที่ไหน', 'ต่ออายุยังไง',
      'ซื้อแพ็กเกจยังไง ราคาเท่าไหร่', 'How do I upgrade?'])
      assert.equal(withoutUnaskedPackagePurchaseLine(`ราคา 499 บาทค่ะ\n${upgrade}`, asked), `ราคา 499 บาทค่ะ\n${upgrade}`, asked);
    // A price or contents question that only names buying did not ask how or where.
    for (const price of ['ถ้าซื้อรายปีราคาเท่าไหร่', 'อัปเกรดแล้วราคาเท่าไหร่', 'เปลี่ยนเป็นแพ็กเกจเติบโตได้อะไรบ้าง'])
      assert.equal(withoutUnaskedPackagePurchaseLine(`ราคา 499 บาทค่ะ\n${upgrade}`, price), 'ราคา 499 บาทค่ะ', price);
  });

  it('leaves everything that is not a how-or-where-to-buy sentence, and never empties an answer', () => {
    for (const kept of [
      'ถ้าอยากติดตามใกล้ชิด ดูรายละเอียดได้ที่หน้าแพ็กเกจของร้านนะคะ',            // a page pointer that invites no purchase
      'แพ็กเกจธุรกิจยังไม่เปิดให้ซื้อตอนนี้ค่ะ',                                   // not on sale yet
      'และแพ็กเกจนี้ยังไม่ได้ตั้งต่ออายุอัตโนมัติ และหมดอายุวันที่ 19 ต.ค. 2569 ด้วยค่ะ ดูได้ที่หน้าแพ็กเกจของร้านนะคะ', // a fact about this package
      'ถ้าซื้อแพ็กเกจรายปี จะได้สิทธิ์อ่านใบเสร็จ 600 ใบทันทีค่ะ',                   // what yearly gives
      '• เติบโต — รายเดือน 499 บาท / รายปี 4,990 บาท (ประหยัด 998 บาท เทียบเท่าจ่าย 10 เดือน)',
      prices,
    ]) assert.equal(withoutUnaskedPackagePurchaseLine(kept, question), kept);
    const only = 'การซื้อหรือเปลี่ยนแพ็กเกจทำได้บนเว็บ ที่หน้าแพ็กเกจของร้านค่ะ';
    assert.equal(withoutUnaskedPackagePurchaseLine(only, question), only, 'an answer that is only that sentence is not emptied');
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

  it('renders two periods as one summary, preserving totals, counts and the partial-month warning', () => {
    const augData = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, total: 14, summary: { totalAmount: '40453' } };
    const sepData = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, total: 14, summary: { totalAmount: '17765' } };
    const comparison = expensePeriodComparison('expense.list_recent', augData, sepData)!;
    const text = expensePeriodComparisonReplyText(comparison);
    // A8: Thai period labels (a whole month prints without a day range; month-to-date keeps one)
    // replace the raw ISO dates. Owner 2026-10-05: the later period against the earlier one in one
    // plain sentence, and no percentage ("เอา % ออกเถอะ งง") unless the reader asked for one.
    assert.equal(text, 'เปรียบเทียบค่าใช้จ่าย 1 ส.ค. – 28 ก.ย. 2569\n'
      + '• ส.ค. 2569: 40,453.00 บาท (14 รายการ)\n'
      + '• 1–28 ก.ย. 2569: 17,765.00 บาท (14 รายการ)\n'
      + '1–28 ก.ย. น้อยกว่า ส.ค. 22,688.00 บาท\n'
      + 'การเปรียบเทียบนี้มีทั้งเดือนเต็มและช่วงที่ไม่ครบเดือน');
    // (17,765 - 40,453) / 40,453 * 100 = -56.1% rounded: said only to a reader who asked for a percentage.
    assert.match(expensePeriodComparisonReplyText(comparison, true), /^1–28 ก\.ย\. น้อยกว่า ส\.ค\. 22,688\.00 บาท \(ลดลง 56\.1%\)$/mu);
  });

  it('also compares expense.list_recent by payment/document status amounts, but never in the deterministic reply (spec §3 row 9 is totals-only)', () => {
    const augData = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, total: 8, summary: { totalAmount: '20157', paidAmount: '0', unpaidAmount: '20157' } };
    const sepData = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, total: 8, summary: { totalAmount: '10621', paidAmount: '0', unpaidAmount: '10621' } };
    const comparison = expensePeriodComparison('expense.list_recent', augData, sepData);
    assert.ok(comparison);
    // factsText (compose's grounding context) still carries the status split...
    assert.match(comparison.factsText, /ยังไม่จ่าย.*-9,536\.00/su);
    // ...but the deterministic customer-facing reply includes only period totals and changes.
    assert.doesNotMatch(expensePeriodComparisonReplyText(comparison), /ยังไม่จ่าย/su);
  });

  it('owner 2026-10-05: a grouped comparison says what each period spent the most on — no percentage, no rank lines, no table of groups', () => {
    const comparison = expensePeriodComparison('expense.get_breakdown', LAST_MONTH, THIS_MONTH)!;
    const text = expensePeriodComparisonReplyText(comparison);
    assert.equal(text, [
      'เปรียบเทียบค่าใช้จ่าย 1 ส.ค. – 28 ก.ย. 2569',
      '• ส.ค. 2569: 40,453.00 บาท (14 รายการ)',
      '• 1–28 ก.ย. 2569: 17,765.00 บาท (14 รายการ)',
      '1–28 ก.ย. น้อยกว่า ส.ค. 22,688.00 บาท',
      'การเปรียบเทียบนี้มีทั้งเดือนเต็มและช่วงที่ไม่ครบเดือน',
      'ค่าใช้จ่ายที่น่าสนใจ',
      // Each period's own largest group: ค่าบริการ 10,764.50 in August, ค่าใช้จ่ายอื่นๆ 4,599.50 in September.
      '• ส.ค. จ่ายมากที่สุด: ค่าบริการ 10,764.50 บาท',
      '• 1–28 ก.ย. จ่ายมากที่สุด: ค่าใช้จ่ายอื่นๆ 4,599.50 บาท',
    ].join('\n'));
    assert.doesNotMatch(text, /%|อันดับ|ต่างกัน/u);
    // The per-group differences stay facts a composed sentence may cite; the reply no longer prints them.
    assert.match(comparison.factsText, /ค่าบริการ.*-6,576\.00.*-61\.1%/su);
  });

  it('a group only ONE period has is named as that period\'s largest; ranked by amount, not by the order the tool gave', () => {
    const augOnly = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, totalAmount: '10000', totalCount: 3,
      byCategory: [{ category: 'ค่าน้ำมัน', totalAmount: '1000' }, { category: 'ค่าเดินทางเท่านั้นเดือนสิงหา', totalAmount: '9000' }] };
    const sepOnly = { period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, totalAmount: '2000', totalCount: 2,
      byCategory: [{ category: 'ค่าน้ำมัน', totalAmount: '2000' }] };
    const comparison = expensePeriodComparison('expense.get_breakdown', augOnly, sepOnly)!;
    assert.deepEqual(comparison.periodA.top, { label: 'ค่าเดินทางเท่านั้นเดือนสิงหา', totalAmount: '9000' });
    assert.deepEqual(comparison.periodB.top, { label: 'ค่าน้ำมัน', totalAmount: '2000' });
    const text = expensePeriodComparisonReplyText(comparison);
    assert.match(text, /^• ส\.ค\. จ่ายมากที่สุด: ค่าเดินทางเท่านั้นเดือนสิงหา 9,000\.00 บาท$/mu);
    assert.match(text, /^• 1–28 ก\.ย\. จ่ายมากที่สุด: ค่าน้ำมัน 2,000\.00 บาท$/mu);
    // The matched facts never invent a group the other period did not return.
    assert.doesNotMatch(comparison.factsText, /ค่าเดินทางเท่านั้นเดือนสิงหา/);
  });

  it('names one group for each period however many groups there are, and none for a period with no group', () => {
    const rows = [500, 100, 900, 300, 1000, 700, 200, 800, 600, 400].map((totalAmount, i) => ({ category: `หมวด${i}`, totalAmount: String(totalAmount) }));
    const augMany = { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, totalAmount: '5500', totalCount: 10, byCategory: rows };
    const sepNone = { period: { fromDate: '2026-09-01', toDate: '2026-09-30' }, totalAmount: '0', totalCount: 0, byCategory: [] };
    const text = expensePeriodComparisonReplyText(expensePeriodComparison('expense.get_breakdown', augMany, sepNone)!);
    assert.deepEqual(text.split('\n').slice(3), ['ก.ย. น้อยกว่า ส.ค. 5,500.00 บาท', 'ค่าใช้จ่ายที่น่าสนใจ', '• ส.ค. จ่ายมากที่สุด: หมวด4 1,000.00 บาท']);
  });

  it('the same answer as card rows: a row for each period, each change and each largest group; a note for a partial period and the scope', () => {
    const scoped = { queryApplied: { accessScope: 'related' } };
    const card = expensePeriodComparisonCard(expensePeriodComparison('expense.get_breakdown', { ...LAST_MONTH, ...scoped }, { ...THIS_MONTH, ...scoped })!)!;
    assert.deepEqual(card, {
      header: ['เปรียบเทียบค่าใช้จ่าย', '1 ส.ค. – 28 ก.ย. 2569'],
      rows: [
        { label: 'ส.ค. 2569', value: '40,453.00 บาท' },
        { label: '1–28 ก.ย. 2569', value: '17,765.00 บาท' },
        { label: '1–28 ก.ย. น้อยกว่า ส.ค.', value: '22,688.00 บาท' },
        { label: 'ส.ค. จ่ายมากที่สุด', value: 'ค่าบริการ 10,764.50 บาท' },
        { label: '1–28 ก.ย. จ่ายมากที่สุด', value: 'ค่าใช้จ่ายอื่นๆ 4,599.50 บาท' },
      ],
      notes: ['การเปรียบเทียบนี้มีทั้งเดือนเต็มและช่วงที่ไม่ครบเดือน', 'แสดงเฉพาะรายการที่เกี่ยวข้องกับคุณ'],
    });
    // Equal totals have no amount to print: the row says so in words. English has no card.
    const same = expensePeriodComparison('expense.list_recent',
      { period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, total: 1, summary: { totalAmount: '100' } },
      { period: { fromDate: '2026-09-01', toDate: '2026-09-30' }, total: 1, summary: { totalAmount: '100' } })!;
    assert.deepEqual(expensePeriodComparisonCard(same)!.rows.at(-1), { label: 'ก.ย. เท่ากับ ส.ค.', value: 'ยอดเท่ากัน' });
    assert.deepEqual(expensePeriodComparisonCard(same)!.notes, []);
    assert.equal(expensePeriodComparisonCard(expensePeriodComparison('expense.get_breakdown', LAST_MONTH, THIS_MONTH, true)!), undefined);
    // A percentage on the card only when the reader asked: (17,765 - 40,453) / 40,453 = -56.1%.
    assert.equal(expensePeriodComparisonCard(expensePeriodComparison('expense.get_breakdown', LAST_MONTH, THIS_MONTH)!, true)!.rows[2]!.value, '22,688.00 บาท (ลดลง 56.1%)');
  });
});

describe('cards-cmp: expense comparison series and arithmetic', () => {
  const month = (key: string, totalAmount: string, count = 1) => {
    const [year, m] = key.split('-').map(Number);
    return { period: { fromDate: `${key}-01`, toDate: `${key}-${new Date(Date.UTC(year!, m!, 0)).getUTCDate()}` },
      total: count, summary: { totalAmount } };
  };
  it('owner case: every month once, chronological, then each month against the one before it', () => {
    // 214899.57 - 25147.80 = 189751.77; /25147.80 = 754.5%; 214899.57/25147.80 = 8.5x.
    // 98000 - 214899.57 = -116899.57; /214899.57 = -54.4%.
    const series = expensePeriodComparisonSeries('expense.list_recent', [
      month('2026-09', '98000', 12), month('2026-07', '25147.80', 7), month('2026-08', '214899.57', 25),
    ])!;
    assert.equal(expensePeriodComparisonReplyText(series), [
      'เปรียบเทียบค่าใช้จ่าย ก.ค. – ก.ย. 2569',
      '• ก.ค. 2569: 25,147.80 บาท (7 รายการ)',
      '• ส.ค. 2569: 214,899.57 บาท (25 รายการ)',
      '• ก.ย. 2569: 98,000.00 บาท (12 รายการ)',
      'ส.ค. มากกว่า ก.ค. 189,751.77 บาท',
      'ก.ย. น้อยกว่า ส.ค. 116,899.57 บาท',
    ].join('\n'));
    // A reader who asked for a percentage gets it, with the multiple from double up.
    assert.deepEqual(expensePeriodComparisonReplyText(series, true).split('\n').slice(4), [
      'ส.ค. มากกว่า ก.ค. 189,751.77 บาท (เพิ่มขึ้น 754.5% หรือราว 8.5 เท่าของ ก.ค.)',
      'ก.ย. น้อยกว่า ส.ค. 116,899.57 บาท (ลดลง 54.4%)',
    ]);
    assert.deepEqual(expensePeriodComparisonCard(series)!.rows, [
      { label: 'ก.ค. 2569', value: '25,147.80 บาท' }, { label: 'ส.ค. 2569', value: '214,899.57 บาท' }, { label: 'ก.ย. 2569', value: '98,000.00 บาท' },
      { label: 'ส.ค. มากกว่า ก.ค.', value: '189,751.77 บาท' }, { label: 'ก.ย. น้อยกว่า ส.ค.', value: '116,899.57 บาท' },
    ]);
    assert.match(series.factsText, /8\.5 เท่าของ ก\.ค\./u, 'the multiple is a grounded fact too');
    assert.equal(series.periods.length, 3);
    assert.equal(series.comparisons.length, 2);
  });
  for (const [name, earlier, later, expected] of [
    ['exactly 100%: (2000-1000)/1000=100%; 2000/1000=2.0', '1000', '2000', 'มากกว่า ส.ค. 1,000.00 บาท (เพิ่มขึ้น 100.0% หรือราว 2.0 เท่าของ ส.ค.)'],
    ['99.9%: (1999-1000)/1000=99.9%, no multiple', '1000', '1999', 'มากกว่า ส.ค. 999.00 บาท (เพิ่มขึ้น 99.9%)'],
    ['decrease: (500-1000)/1000=-50%, no multiple', '1000', '500', 'น้อยกว่า ส.ค. 500.00 บาท (ลดลง 50.0%)'],
    ['equal: 1000-1000=0', '1000', '1000', 'เท่ากับ ส.ค.'],
    ['zero earlier: 1000-0=1000, percentage undefined', '0', '1000', 'มากกว่า ส.ค. 1,000.00 บาท'],
  ]) it(name!, () => {
    const comparison = expensePeriodComparison('expense.list_recent', month('2026-08', earlier!), month('2026-09', later!))!;
    assert.equal(comparison.directionLine, expected);
    assert.ok(comparison.factsText.includes(expected!));
    // The reply says the same change with both periods named and no percentage.
    assert.equal(expensePeriodComparisonReplyText(comparison).split('\n')[3], `ก.ย. ${expected!.replace(/ \(.*$/u, '')}`);
  });
  it('year end: every amount and direction identifies its year', () => {
    // (200-100)/100=100%, 200/100=2.0.
    const series = expensePeriodComparisonSeries('expense.list_recent', [month('2027-01', '200'), month('2026-12', '100')])!;
    assert.equal(series.headerLine, 'เปรียบเทียบค่าใช้จ่าย ธ.ค. 2569 – ม.ค. 2570');
    assert.match(expensePeriodComparisonReplyText(series), /^ม\.ค\. 2570 มากกว่า ธ\.ค\. 2569 100\.00 บาท$/mu);
    assert.match(expensePeriodComparisonReplyText(series, true), /^ม\.ค\. 2570 มากกว่า ธ\.ค\. 2569 100\.00 บาท \(เพิ่มขึ้น 100\.0% หรือราว 2\.0 เท่าของ ธ\.ค\. 2569\)$/mu);
  });
  it('English keeps the same header, bullets, day range, arithmetic and partial-period warning', () => {
    // (200-100)/100=100%, 200/100=2.0.
    const partial = { ...month('2026-09', '200'), period: { fromDate: '2026-09-01', toDate: '2026-09-28' } };
    const series = expensePeriodComparisonSeries('expense.list_recent', [month('2026-08', '100'), partial], true)!;
    assert.equal(expensePeriodComparisonReplyText(series), [
      'Expense comparison Aug 1 – Sep 28, 2026',
      '• Aug 2026: 100.00 THB (1 item)',
      '• 1–28 Sep 2026: 200.00 THB (1 item)',
      '1–28 Sep is 100.00 THB more than Aug',
      'This comparison includes both full months and partial periods.',
    ].join('\n'));
    assert.match(expensePeriodComparisonReplyText(series, true), /^1–28 Sep is 100\.00 THB more than Aug \(up 100\.0% or about 2\.0 times Aug\)$/mu);
  });
  it('a range of whole calendar months is not falsely called a partial month', () => {
    // April 200 - Jan–Mar 100=100; growth=100%, ratio=2.0. Jan–Mar covers three complete months.
    const quarter = { ...month('2026-01', '100'), period: { fromDate: '2026-01-01', toDate: '2026-03-31' } };
    const series = expensePeriodComparisonSeries('expense.list_recent', [quarter, month('2026-04', '200')])!;
    assert.equal(series.partialPeriodLine, '');
    assert.equal(series.headerLine, 'เปรียบเทียบค่าใช้จ่าย 1 ม.ค. – 30 เม.ย. 2569');
  });
  for (const count of [4, 8]) it(`${count} periods: all totals and ${count - 1} adjacent changes at the planner bound`, () => {
    // For period n: total n*100; every difference=100; change=100/(n-1)*100%, multiple=2.0 only at n=2.
    const series = expensePeriodComparisonSeries('expense.list_recent', Array.from({ length: count }, (_, i) => month(`2026-0${i + 1}`, String((i + 1) * 100), i + 1)).reverse())!;
    assert.equal(series.periods.length, count);
    assert.equal(series.comparisons.length, count - 1);
    assert.equal(expensePeriodComparisonReplyText(series).match(/^• /gmu)?.length, count);
    series.comparisons.forEach((comparison, i) => {
      assert.equal(comparison.diffAmount, '100.00');
      assert.equal(comparison.percent, `+${(100 / (i + 1)).toFixed(1)}%`);
    });
  });
  for (const [name, change] of [
    ['overlap', { period: { fromDate: '2026-08-15', toDate: '2026-09-30' } }],
    ['different filters', { queryApplied: { filters: { paymentStatus: 'PAID' } } }],
    ['incomplete aggregate', { completeness: { aggregate: 'partial' } }],
    ['mixed currencies', { mixedCurrency: true }],
    ['invalid amount', { summary: { totalAmount: 'unknown' } }],
    ['negative count', { total: -1 }],
    ['fractional count', { total: 1.5 }],
  ] as const) it(`does not compare ${name}`, () => {
    assert.equal(expensePeriodComparison('expense.list_recent', month('2026-08', '100'), { ...month('2026-09', '200'), ...change }), undefined);
  });
  it('does not compare different applied groupings', () => {
    const a = { ...month('2026-08', '100'), totalAmount: '100', totalCount: 1, queryApplied: { filters: { groupBy: 'category' } } };
    const b = { ...month('2026-09', '200'), totalAmount: '200', totalCount: 1, queryApplied: { filters: { groupBy: 'vendor' } } };
    assert.equal(expensePeriodComparison('expense.get_breakdown', a, b), undefined);
  });
  it('a missing group amount is unknown, never manufactured as zero', () => {
    const a = { ...month('2026-08', '100'), totalAmount: '100', totalCount: 1, byCategory: [{ category: 'ค่าบริการ' }] };
    const b = { ...month('2026-09', '200'), totalAmount: '200', totalCount: 1, byCategory: [{ category: 'ค่าบริการ', totalAmount: '200' }] };
    assert.equal(expensePeriodComparison('expense.get_breakdown', a, b), undefined);
  });
  it('a non-baht aggregate is not labelled as baht even when both periods use that currency', () => {
    const a = { ...month('2026-08', '100'), currency: 'USD' };
    const b = { ...month('2026-09', '200'), currency: 'USD' };
    assert.equal(expensePeriodComparison('expense.list_recent', a, b), undefined);
  });
  it('list_recent currency comes from its sole totalsByCurrency row too', () => {
    const a = { ...month('2026-08', '100'), totalsByCurrency: [{ currency: 'USD', totalAmount: '100', count: 1 }] };
    const b = { ...month('2026-09', '200'), totalsByCurrency: [{ currency: 'USD', totalAmount: '200', count: 1 }] };
    assert.equal(expensePeriodComparison('expense.list_recent', a, b), undefined);
  });
  it('legacy own-scoped periods retain the same truthful scope sentence', () => {
    // (200-100)/100=100%, 200/100=2.0; both periods cover only related records.
    const series = expensePeriodComparisonSeries('expense.list_recent', [{ ...month('2026-08', '100'), accessScope: 'related' }, { ...month('2026-09', '200'), accessScope: 'related' }])!;
    assert.ok(expensePeriodComparisonReplyText(series).endsWith('ขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ'));
  });
  it('English grouped comparisons name each period\'s largest group in English units', () => {
    const a = { ...month('2026-08', '100'), totalAmount: '100', totalCount: 1, byCategory: [{ category: 'Services', totalAmount: '100' }] };
    const b = { ...month('2026-09', '200'), totalAmount: '200', totalCount: 1, byCategory: [{ category: 'Services', totalAmount: '200' }] };
    const comparison = expensePeriodComparison('expense.get_breakdown', a, b, true)!;
    assert.deepEqual(expensePeriodComparisonReplyText(comparison).split('\n').slice(3), [
      'Sep is 100.00 THB more than Aug', 'Notable expenses', '• Aug spent the most on: Services 100.00 THB', '• Sep spent the most on: Services 200.00 THB']);
    assert.doesNotMatch(expensePeriodComparisonReplyText(comparison), /[\u0E00-\u0E7F]|%/u);
  });
  it('nine periods are refused as a series, never truncated to the eight-period limit', () => {
    assert.equal(expensePeriodComparisonSeries('expense.list_recent', Array.from({ length: 9 }, (_, i) => month(`2026-0${i + 1}`, String(i + 1)))), undefined);
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

  it('T-082-a\'s real numbers: each period\'s largest vendor is named, so the reader sees they are not the same', () => {
    const comparison = expensePeriodComparison('expense.get_breakdown', AUGUST_VENDOR, SEPTEMBER_VENDOR)!;
    assert.deepEqual(expensePeriodComparisonReplyText(comparison).split('\n').slice(-3), [
      'ค่าใช้จ่ายที่น่าสนใจ',
      '• ส.ค. จ่ายมากที่สุด: ไม่ระบุร้าน 7,587.00 บาท',
      '• 1–28 ก.ย. จ่ายมากที่สุด: ร้านสมใจการค้า 4,188.50 บาท',
    ]);
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
    assert.equal(comparison.directionLine, 'น้อยกว่า ส.ค. 10,960.00 บาท (ลดลง 63.5%)');
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
