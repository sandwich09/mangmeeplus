import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

  // Browser check 2026-10-03: a tier with no approver read "Auto approve" and "อนุมัติอัตโนมัติ", and the demo began with
  // "พนักงาน", the name of one role, for whoever creates the order. The rule only says the tier needs no approval.
  it('builds the demo flow for a tier with no approver in the rule’s own words', () => {
    const demo = getPoApprovalDemo('100');

    assert.equal(demo.rule.id, 'auto');
    assert.equal(demo.statusLabel, 'ไม่ต้องอนุมัติ');
    assert.equal(demo.steps[0], 'สร้างใบสั่งซื้อ ฿100 — เข้าเงื่อนไขขั้นที่ 1');
    assert.equal(demo.steps[1], 'ขั้นนี้ไม่ต้องรอใครอนุมัติ');
  });

  it('names approver roles from the one list and joins several with "หรือ"', () => {
    const manager = getPoApprovalDemo('5000');
    assert.equal(manager.statusLabel, 'รอผู้จัดการอนุมัติ');
    assert.equal(manager.steps[1], 'ส่งให้ผู้จัดการอนุมัติ');
    const either = getPoApprovalDemo('20000');
    assert.equal(either.rule.approverLabel, 'ผู้จัดการ หรือ เจ้าของกิจการ');
    assert.equal(either.statusLabel, 'รอผู้จัดการ หรือ เจ้าของกิจการอนุมัติ');
    assert.equal(getPoApprovalDemo('100').rule.approverLabel, 'ไม่มี (ไม่ต้องอนุมัติ)');
    for (const rule of derivePoApprovalRules([{ id: 'x', approverRoleKeys: ['ACCOUNTANT', 'FINANCE'] }])) {
      assert.equal(rule.approverLabel, 'ฝ่ายบัญชี หรือ ฝ่ายการเงิน');
    }
    const page = readFileSync(new URL('./PoApprovalSettingsPage.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(page, /Auto approve|กดปุ่มเลือกผู้อนุมัติ/);
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
    assert.equal(poApprovalBadgeLabel([]), 'ไม่ต้องอนุมัติ');
    assert.equal(rules[1]!.badgeLabel, 'ผู้จัดการ');
    assert.equal(rules[2]!.badgeLabel, 'คนใดคนหนึ่งใน 2 บทบาท');
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
