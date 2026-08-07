import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePoApprovalRules,
  getPoApprovalDemo,
  getPoApprovalRuleForAmount,
  parseApprovalAmount,
  poApprovalBadgeLabel,
  poApprovalConditionLabel,
  removePoApprovalRule,
  splitOpenEndedPoApprovalRule,
} from './po-approval-settings.model';

describe('po approval settings model', () => {
  it('keeps boundary amounts mapped to the right approval rule', () => {
    assert.equal(getPoApprovalRuleForAmount(100).id, 'auto');
    assert.equal(getPoApprovalRuleForAmount(1000).id, 'auto');
    assert.equal(getPoApprovalRuleForAmount(1001).id, 'manager');
    assert.equal(getPoApprovalRuleForAmount(10000).id, 'manager');
    assert.equal(getPoApprovalRuleForAmount(10001).id, 'owner-or-manager');
  });

  it('builds the design demo flow for auto approve amount', () => {
    const demo = getPoApprovalDemo('100');

    assert.equal(demo.rule.id, 'auto');
    assert.equal(demo.statusLabel, 'Auto approve ทันที');
    assert.equal(demo.steps[0], 'พนักงานสร้างใบสั่งซื้อ ฿100 — เข้าเงื่อนไขขั้นที่ 1');
    assert.equal(demo.steps[1], 'อนุมัติอัตโนมัติ — ไม่ต้องรอใคร');
  });

  it('normalizes formatted input before simulation', () => {
    assert.equal(parseApprovalAmount('฿10,001'), 10001);
    assert.equal(getPoApprovalDemo('฿10,001').rule.id, 'owner-or-manager');
  });

  it('derives row metadata from rule bounds and approver roles', () => {
    const rules = derivePoApprovalRules([
      { id: 'auto', maxInclusive: 1000, approverRoleKeys: [] },
      { id: 'manager', minExclusive: 1000, maxInclusive: 10000, approverRoleKeys: ['MANAGER'] },
      { id: 'final', minExclusive: 10000, approverRoleKeys: ['MANAGER', 'OWNER'] },
    ]);

    assert.equal(poApprovalConditionLabel(rules[0]!), 'ยอดไม่เกิน');
    assert.equal(rules[1]!.conditionLabel, 'มากกว่า ฿1,000 ถึง');
    assert.equal(rules[2]!.conditionLabel, 'มากกว่า ฿10,000');
    assert.equal(rules[1]!.inputValue, '10000');
    assert.equal(poApprovalBadgeLabel([]), 'Auto approve');
    assert.equal(rules[1]!.badgeLabel, 'MANAGER');
    assert.equal(rules[2]!.badgeLabel, 'คนใดคนหนึ่งใน 2');
  });

  it('splits and removes tiers while re-stitching contiguous bounds', () => {
    const initial = derivePoApprovalRules([
      { id: 'first', maxInclusive: 1000, approverRoleKeys: [] },
      { id: 'open', minExclusive: 1000, approverRoleKeys: ['OWNER'] },
    ]);
    const split = splitOpenEndedPoApprovalRule(initial, 5000, 'inserted');

    assert.ok(split);
    assert.deepEqual(split.map((rule) => [rule.id, rule.step, rule.minExclusive, rule.maxInclusive]), [
      ['first', 1, undefined, 1000],
      ['inserted', 2, 1000, 5000],
      ['open', 3, 5000, undefined],
    ]);
    assert.deepEqual(split[1]!.approverRoleKeys, ['OWNER']);
    assert.equal(getPoApprovalDemo(4000, split).rule.id, 'inserted');

    const withoutMiddle = removePoApprovalRule(split, 'inserted');
    assert.deepEqual(withoutMiddle.map((rule) => [rule.id, rule.step, rule.minExclusive, rule.maxInclusive]), [
      ['first', 1, undefined, 1000],
      ['open', 2, 1000, undefined],
    ]);

    const withoutLast = removePoApprovalRule(split, 'open');
    assert.deepEqual(withoutLast.map((rule) => [rule.id, rule.step, rule.minExclusive, rule.maxInclusive]), [
      ['first', 1, undefined, 1000],
      ['inserted', 2, 1000, undefined],
    ]);
  });
});
