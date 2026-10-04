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
  const labels = Object.values(words.EXECUTIVE_PERIOD_WORDS.presets) as string[];
  assert.ok(labels.every(label => !/[A-Za-z_]/.test(label)));
});
