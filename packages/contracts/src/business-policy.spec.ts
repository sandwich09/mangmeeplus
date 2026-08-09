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
