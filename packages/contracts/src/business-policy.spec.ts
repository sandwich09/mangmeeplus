import assert from 'node:assert/strict';
import test from 'node:test';
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
