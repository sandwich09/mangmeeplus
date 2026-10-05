import assert from 'node:assert/strict';
import test from 'node:test';
import { reimbursementDuplicateBlockNotice } from './reimbursements.js';
import * as reimbursementWords from './reimbursements.js';

test('D2: payment-void notice follows the post-void state without promising payment through a duplicate block', () => {
  const notice = (claim: object) => (reimbursementWords as any).reimbursementPaymentVoidedNotice(claim);
  assert.equal(notice({ status: 'READY_FOR_PAYMENT', paymentDuplicateBlock: 'NONE', duplicateReasons: [] }),
    'การจ่ายเงินที่บันทึกไว้ถูกยกเลิก ใบเบิกกลับไปรอจ่าย');
  for (const [block, reasons] of [['UNRESOLVED', ['ATTACHMENT_CHECKSUM']], ['CONFIRMED', ['EXPENSE_CONFIRMED_DUPLICATE']]] as const) {
    for (const status of ['READY_FOR_PAYMENT', 'PARTIALLY_PAID']) {
      const text = notice({ status, paymentDuplicateBlock: block, duplicateReasons: reasons });
      assert.match(text, /^การจ่ายเงินที่บันทึกไว้ถูกยกเลิก /);
      assert.doesNotMatch(text, /กลับไปรอจ่าย|[A-Za-z_]/);
      assert.match(text, block === 'CONFIRMED' ? /ยกเลิก/ : /ปลดรายการซ้ำ/);
    }
  }
  assert.doesNotMatch(notice({ status: 'PAID', paymentDuplicateBlock: 'NONE' }), /กลับไปรอจ่าย/);
  assert.doesNotMatch(notice({ status: 'READY_FOR_PAYMENT', cancellationPending: true, paymentDuplicateBlock: 'NONE' }), /กลับไปรอจ่าย/);
});

test('confirmed receipt guidance gives the actual cancellation or payment-void path, never duplicate clearance', () => {
  const reasons = ['EXPENSE_CONFIRMED_DUPLICATE', 'ATTACHMENT_CHECKSUM'];
  const notice = (context: object) => (reimbursementDuplicateBlockNotice as any)(reasons, true, context) as string;
  const own = notice({ status: 'READY_FOR_PAYMENT', canCancel: true });
  assert.match(own, /ใบเสร็จของใบเบิกนี้ได้รับการยืนยันว่าซ้ำ/);
  assert.match(own, /กดยกเลิกคำขอในหน้าใบเบิก/);
  const other = notice({ status: 'FINANCE_REVIEW', canCancel: false });
  assert.match(other, /ผู้เบิกที่มีสิทธิ์ยกเลิกหรือผู้ตรวจการเงินที่ดูแลสาขา/);
  for (const status of ['PARTIALLY_PAID', 'PAID']) {
    const paid = notice({ status, canCancel: false, canVoidPayment: true });
    assert.match(paid, /มีรายการจ่ายอยู่ จึงยกเลิกคำขอไม่ได้/);
    assert.match(paid, /ผู้มีสิทธิ์ยกเลิกการจ่ายของสาขานี้/);
    assert.match(notice({ status, canVoidPayment: false }), /ผู้มีสิทธิ์ยกเลิกการจ่ายของสาขานี้/);
  }
  assert.match(notice({ status: 'READY_FOR_PAYMENT', cancellationPending: true, canResumeCancellation: true }), /ดำเนินการยกเลิกต่อ/);
  assert.match(notice({ status: 'REJECTED' }), /ถูกปฏิเสธแล้ว/);
  for (const context of [{ status: 'CANCELLED' }, { status: 'VOIDED' }, {}, { status: 'DRAFT', canCancel: true }, { status: 'PENDING_APPROVAL', canCancel: false }]) {
    const text = notice(context);
    assert.match(text, /ผู้เบิกส่งใบเบิกใหม่โดยไม่ใส่รายการซ้ำ/);
    assert.doesNotMatch(text, /ปลดรายการซ้ำ|อนุมัติจ่าย|[a-zA-Z_]/);
  }
});
import {
  MANDATORY_MARKETING_UNSUBSCRIBE_KEYWORDS,
  withMandatoryMarketingUnsubscribeKeywords,
} from './business-policy.js';

test('marketing opt-out always retains the public safety commands', () => {
  assert.deepEqual(
    withMandatoryMarketingUnsubscribeKeywords([]),
    MANDATORY_MARKETING_UNSUBSCRIBE_KEYWORDS,
  );
});

test('tenant aliases are normalized and cannot replace or duplicate safety commands', () => {
  assert.deepEqual(
    withMandatoryMarketingUnsubscribeKeywords([' stop ', 'คำสั่ง เพิ่ม', 'คำสั่ง  เพิ่ม', 'STOP']),
    [...MANDATORY_MARKETING_UNSUBSCRIBE_KEYWORDS, 'คำสั่ง เพิ่ม'],
  );
});

test('legacy missing keyword arrays still repair to the safety commands', () => {
  assert.deepEqual(
    withMandatoryMarketingUnsubscribeKeywords(undefined),
    MANDATORY_MARKETING_UNSUBSCRIBE_KEYWORDS,
  );
});


test('executive period contracts provide every preset, reason and Thai range word from one source', async () => {
  const contract: any = await import('./executive-business.js');
  const words: any = await import('./executive-report-words.js');
  assert.deepEqual(contract.EXECUTIVE_PERIOD_PRESETS, ['THIS_MONTH', 'LAST_MONTH', 'THIS_QUARTER', 'THIS_YEAR', 'LAST_12_MONTHS', 'ALL']);
  assert.ok(contract.EXECUTIVE_REASON_CODES.includes('RANGE_MONTH_NOT_BUILT'));
  assert.ok(contract.EXECUTIVE_REASON_CODES.includes('DISTINCT_USERS_NOT_AVAILABLE'));
  assert.equal(words.EXECUTIVE_PERIOD_WORDS.distinctUsersUnavailable, 'ยังสรุปจำนวนผู้ใช้ไม่ซ้ำตลอดหลายเดือนไม่ได้');
  assert.equal(words.executivePeriodLabel('2026-07', '2026-09'), 'ช่วงเดือน ก.ค. 2569 ถึง ก.ย. 2569');
  assert.equal(words.executivePeriodLabel('2026-09', '2026-09'), 'ช่วงเดือน ก.ย. 2569');
  assert.equal(words.EXECUTIVE_PERIOD_WORDS.invalid, 'กรุณาเลือกเดือนเริ่มต้นและเดือนสิ้นสุดให้ถูกต้อง');
  assert.equal(words.executivePeriodReportWords().net, words.EXECUTIVE_PERIOD_WORDS.net);
  assert.equal(words.executivePeriodReportWords().tableReceipts, words.EXECUTIVE_PERIOD_WORDS.tableReceipts);
  assert.equal(words.executivePeriodReportLabels().usageGroup.INACTIVE, words.EXECUTIVE_PERIOD_WORDS.inactive);
  const labels = Object.values(words.EXECUTIVE_PERIOD_WORDS.presets) as string[];
  assert.ok(labels.every(label => !/[A-Za-z_]/.test(label)));
});

test('executive owner sheet uses one Thai churn definition and shared column/filter words', async () => {
  const { spawnSync } = await import('node:child_process');
  const standalone = spawnSync(process.execPath, ['--import', 'tsx', '-e', 'require("./src/executive-report-words.ts")'], { encoding: 'utf8' });
  assert.equal(standalone.status, 0, standalone.stderr);
  const words: any = await import('./executive-report-words.js');
  const contracts: any = await import('./executive-business.js');
  assert.equal(contracts.EXECUTIVE_SORT_OPTIONS[0].sortBy, 'joinedAt');
  assert.equal(words.EXECUTIVE_SHEET_WORDS.churn, 'เลิกใช้ (ไม่ได้ใช้ติดต่อกันเกิน 1 เดือน)');
  assert.equal(contracts.EXECUTIVE_FLAG_LABELS.churned.true, words.EXECUTIVE_SHEET_WORDS.churn);
  assert.equal(contracts.EXECUTIVE_REPORT_LABELS.packageLabel.ALL, words.EXECUTIVE_SHEET_WORDS.allPackages);
  assert.equal(words.EXECUTIVE_COMPANY_SHEET_COLUMNS.find((c: any) => c.key === 'churned').label, words.EXECUTIVE_SHEET_WORDS.churn);
  assert.deepEqual(words.EXECUTIVE_COMPANY_SHEET_COLUMNS.slice(0, 9).map((c: any) => c.key), ['company', 'businessType', 'plan', 'receiptsLifetime', 'lastReceiptAt', 'planEndsAt', 'email', 'phone', 'note']);
  assert.ok(words.EXECUTIVE_COMPANY_SHEET_COLUMNS.every((c: any) => !/[A-Za-z_]/.test(c.label)));
  assert.ok(words.executiveSourceReasonText('RANGE_MONTH_NOT_BUILT', ['2026-08']).includes('ส.ค.'));
  assert.ok(words.executiveSourceReasonText('MONTH_SUMMARY_INCOMPLETE', ['2026-08']));
  for (const reason of contracts.EXECUTIVE_REASON_CODES) assert.notEqual(words.executiveSourceReasonText(reason, ['2026-08']), words.EXECUTIVE_WORDS.unavailableFigure, reason);
  assert.equal(words.executiveSourceReasonText('HISTORY_BEFORE_COLLECTION', [], 'partial'), words.EXECUTIVE_WORDS.historyBeforeCollectionPartial);
  assert.equal(words.executiveSourceReasonText('HISTORY_BEFORE_COLLECTION', [], 'unavailable'), words.EXECUTIVE_WORDS.historyBeforeCollection);
  assert.equal(words.executiveSourceReasonText('SOURCE_STALE'), 'ข้อมูลรายงานอาจยังไม่เป็นปัจจุบัน');
  assert.ok(!words.EXECUTIVE_WORDS.export.bucketsDefinition.includes('ไม่มีบนหน้าจอ'));
  const { PLAN_TIER_PRESETS } = await import('./plan-term.js');
  for (const key of Object.keys(PLAN_TIER_PRESETS)) assert.doesNotMatch(words.executivePlanLabel(key), /[A-Za-z_]/);
});
