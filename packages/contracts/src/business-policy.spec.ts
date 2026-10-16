import assert from 'node:assert/strict';
import test from 'node:test';
import { reimbursementDuplicateBlockNotice } from './reimbursements.js';
import * as payout from './reimbursements.js';
import * as reimbursementWords from './reimbursements.js';

test('saved payout holder facts validate type, trimmed note bounds and SELF absence', () => {
  for (const input of [null, undefined, {}, { holderType: 'OTHER' }, { holderType: 1 }]) {
    assert.equal(payout.invalidPayoutHolderField(input as never), 'holderType');
  }
  for (const holderNote of [undefined, '', ' ', ' ก ', 'ก'.repeat(201), 123]) {
    assert.equal(payout.invalidPayoutHolderField({ holderType: 'THIRD_PARTY', holderNote } as never), 'holderNote');
  }
  for (const holderNote of [' กก ', 'ก'.repeat(200), 'คู่สมรสของผู้เบิก']) {
    assert.equal(payout.invalidPayoutHolderField({ holderType: 'THIRD_PARTY', holderNote }), null);
  }
  for (const holderNote of [undefined, '', ' ']) assert.equal(payout.invalidPayoutHolderField({ holderType: 'SELF', holderNote }), null);
  for (const holderNote of ['คู่สมรส', 123, null]) {
    assert.equal(payout.invalidPayoutHolderField({ holderType: 'SELF', holderNote } as never), 'holderNote');
  }
});

test('saved payout notes and labels reject every account-number form the shared guard recognizes', () => {
  for (const text of ['เลขบัญชี 0123456789', '081 234 5678', '123-4-56789-0', '๑๒๓๔๕๖', '123.4.56789.0', '123/4/56789/0']) {
    assert.equal(payout.invalidPayoutHolderField({ holderType: 'THIRD_PARTY', holderNote: text }), 'holderNote', text);
    assert.equal(payout.invalidSavedPayoutAccountLabel(text), 'label', text);
  }
  for (const text of ['คู่สมรสของผู้เบิก', 'ใบ RB-202609-0003', 'ยอด 1500000 บาท']) {
    assert.equal(payout.invalidPayoutHolderField({ holderType: 'THIRD_PARTY', holderNote: text }), null, text);
    assert.equal(payout.invalidSavedPayoutAccountLabel(text), null, text);
  }
});

test('saved payout labels are optional, trimmed, bounded and never coerced', () => {
  for (const label of [undefined, '', ' ', ' ก ', ` ${'ก'.repeat(40)} `]) assert.equal(payout.invalidSavedPayoutAccountLabel(label), null);
  for (const label of ['ก'.repeat(41), null, 123, {}]) assert.equal(payout.invalidSavedPayoutAccountLabel(label), 'label');
  assert.equal(payout.PAYOUT_SAVED_ACCOUNT_LABEL_MAX_LENGTH, 40);
  assert.equal(payout.PAYOUT_HOLDER_NOTE_MIN_LENGTH, 2);
  assert.equal(payout.PAYOUT_HOLDER_NOTE_MAX_LENGTH, 200);
  assert.equal(payout.PAYOUT_SAVED_ACCOUNT_LIMIT, 20);
});

test('payout holder words use the form actor, hide legacy lines and flag masked notices without the note', () => {
  assert.equal(payout.REIMBURSEMENT_PAYOUT_HOLDER_WORDS.noteContainsAccountNumber,
    'อย่าพิมพ์เลขบัญชีในช่องนี้ เพราะเมื่อใช้บัญชีนี้ในใบเบิก ทุกคนที่เปิดใบเบิกจะเห็นข้อความนี้');
  assert.equal(payout.payoutHolderChoiceLabel('SELF', true), 'บัญชีของฉันเอง');
  assert.equal(payout.payoutHolderChoiceLabel('SELF', false), 'บัญชีของผู้เบิกเอง');
  assert.equal(payout.payoutHolderChoiceLabel('THIRD_PARTY', true), 'บัญชีของบุคคลอื่น');
  assert.equal(payout.payoutHolderChoiceLabel('THIRD_PARTY', false), 'บัญชีของบุคคลอื่น');
  assert.equal(payout.payoutHolderLine({}), null);
  assert.equal(payout.payoutHolderLine({ holderType: 'SELF' }), null);
  const thirdParty = { payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารกสิกรไทย', accountLast4: '6789', holderType: 'THIRD_PARTY' as const, holderNote: 'คู่สมรสของผู้เบิก' };
  assert.equal(payout.payoutHolderLine(thirdParty), 'บัญชีของบุคคลอื่น: คู่สมรสของผู้เบิก');
  assert.equal(payout.maskedPayoutAccountWithHolder(thirdParty), `${payout.maskedPayoutAccount(thirdParty)} (บัญชีของบุคคลอื่น)`);
  assert.equal(payout.maskedPayoutAccountWithHolder({ ...thirdParty, holderType: 'SELF' }), payout.maskedPayoutAccount(thirdParty));
  assert.equal(payout.maskedPayoutAccountWithHolder({ payoutKind: 'PROMPTPAY_PHONE', accountLast4: '5678' }), 'พร้อมเพย์เบอร์ลงท้าย 5678');
  assert.doesNotMatch(payout.maskedPayoutAccountWithHolder(thirdParty), /คู่สมรส|0123456789/);
  for (const word of Object.values(payout.REIMBURSEMENT_PAYOUT_HOLDER_WORDS)) assert.doesNotMatch(word, /[a-zA-Z_]/);
});


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
  assert.match(notice({ status: 'REJECTED' }), /ใบนี้ถูกส่งกลับให้แก้ ให้ผู้เบิกส่งใบเบิกใหม่โดยไม่ใส่รายการซ้ำ$/);
  assert.doesNotMatch(notice({ status: 'REJECTED' }), /ยกเลิกคำขอในสถานะนี้ไม่ได้/);
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
test('multi payout 2a: preparer draft notice flags another holder without the private note', () => {
  const notice = payout.reimbursementPayoutAnsweredForRequesterNotice(undefined, 'วิภา', { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountLast4: '6789', holderType: 'THIRD_PARTY', holderNote: 'คู่สมรสของผู้เบิก' } as any, { draft: true });
  assert.match(notice.body, /\(บัญชีของบุคคลอื่น\)/);
  assert.doesNotMatch(notice.body, /คู่สมรส/);
});

test('multi payout 2b: paid notices flag the holder while retaining the existing digit budget', () => {
  const paid = { paymentMethod: 'BANK_TRANSFER', paidAmount: '500', currency: 'THB', slipCount: 1, payoutDestination: { payoutKind: 'BANK_ACCOUNT', accountLast4: '6789', holderType: 'THIRD_PARTY', holderNote: 'คู่สมรสของผู้เบิก' } };
  assert.match(payout.reimbursementPaidNotice(paid as any), /บัญชีลงท้าย 6789 \(บัญชีของบุคคลอื่น\)/);
  assert.doesNotMatch(payout.reimbursementPaidNotice(paid as any), /คู่สมรส|0123456789/);
  assert.equal(payout.reimbursementPaymentHowText({ ...paid, payoutDestination: { ...paid.payoutDestination, holderType: 'SELF' } } as any), 'โอนเข้าบัญชีลงท้าย 6789');
});

test('multi payout 2b: correction notice titles and bodies flag the account without its note', () => {
  const holder = { holderType: 'THIRD_PARTY', holderNote: 'คู่สมรสของผู้เบิก' };
  for (const notice of [(payout.reimbursementPayoutAnswerNotice as any)('NEW_ACCOUNT', holder), (payout.reimbursementPayoutSentBackNotice as any)('ACCOUNT', 'ACCOUNT_NUMBER_WRONG', undefined, holder)]) {
    assert.match(notice.title, /\(บัญชีของบุคคลอื่น\)/);
    assert.match(notice.body, /\(บัญชีของบุคคลอื่น\)/);
    assert.doesNotMatch(JSON.stringify(notice), /คู่สมรส|0123456789/);
  }
});

test('multi payout 2b: a requester deliberately using another holder is told to correct mistakes', () => {
  const notice = payout.reimbursementPayoutAnsweredForRequesterNotice('NEW_ACCOUNT', 'วิภา', { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', accountLast4: '6789', holderType: 'THIRD_PARTY' });
  assert.match(notice.title, /\(บัญชีของบุคคลอื่น\)/);
  assert.match(notice.body, /ถ้าไม่ถูกต้อง แก้ได้ทันที/);
  assert.doesNotMatch(notice.body, /ถ้าไม่ใช่บัญชีของคุณ/);
  assert.equal(payout.REIMBURSEMENT_PAYOUT_TYPING_ON_BEHALF_NOTE, 'กรอกบัญชีรับเงินคืนของใบนี้ หลังบันทึกคุณจะเห็นเฉพาะ 4 ตัวท้าย');
});

test('D3: expense waiting for a confirmed-blocked claim says duplicate block, clear and paid retain their labels', async () => {
  const { expenseReimbursementProgressLabel } = await import('./expenses.js');
  assert.equal(expenseReimbursementProgressLabel({ status: 'READY_FOR_PAYMENT', hasConfirmedDuplicate: true } as any), 'ติดรายการซ้ำ');
  assert.equal(expenseReimbursementProgressLabel({ status: 'READY_FOR_PAYMENT' }), 'รอจ่ายคืน');
  assert.equal(expenseReimbursementProgressLabel({ status: 'PAID', hasConfirmedDuplicate: true } as any), 'จ่ายคืนแล้ว');
});

test('saved default swap tells where the previous account remains, in shared Thai words', () => {
  assert.equal((payout.REIMBURSEMENT_SAVED_PAYOUT_WORDS as any).madeDefaultWithPrevious,
    'ตั้งเป็นบัญชีประจำแล้ว บัญชีประจำเดิมอยู่ในรายการบัญชีที่บันทึกไว้');
});

test('W4 third-party send-back reasons exclude name mismatch, including PromptPay; SELF and legacy stay unchanged', () => {
  for (const kind of ['BANK_ACCOUNT', 'PROMPTPAY_PHONE'] as const) {
    const own = payout.reimbursementPayoutCorrectionReasons('ACCOUNT', kind);
    assert.deepEqual((payout.reimbursementPayoutCorrectionReasons as any)('ACCOUNT', kind, 'THIRD_PARTY'), own.filter(code => code !== 'ACCOUNT_NAME_MISMATCH'));
    assert.deepEqual((payout.reimbursementPayoutCorrectionReasons as any)('ACCOUNT', kind, 'SELF'), own);
  }
});

test('confirmed-duplicate guidance calls a rejected claim returned for correction', () => {
  const note = reimbursementDuplicateBlockNotice(['EXPENSE_CONFIRMED_DUPLICATE'], false, { status: 'REJECTED' });
  assert.match(note, /ใบนี้ถูกส่งกลับให้แก้/u);
  assert.doesNotMatch(note, /ไม่อนุมัติ|ปฏิเสธ/u);
});
