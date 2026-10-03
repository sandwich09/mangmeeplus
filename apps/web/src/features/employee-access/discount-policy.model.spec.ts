import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCOUNT_POLICY_DEFAULTS,
  DISCOUNT_OVERRIDE_OPTIONS,
  saveDiscountPolicy,
  setDiscountOverrideRole,
  stepDiscountPolicy,
  toggleDiscountAllowAuto,
} from './discount-policy.model';

describe('discount policy model', () => {
  it('starts with the prototype defaults in saved state', () => {
    assert.deepEqual(DISCOUNT_POLICY_DEFAULTS, {
      allowAuto: true,
      defaultPct: 10,
      maxPct: 20,
      vipPct: 15,
      regularPct: 10,
      overrideRole: 'manager',
      saved: true,
    });
  });

  it('clamps default between 0 and the ceiling', () => {
    let state = { ...DISCOUNT_POLICY_DEFAULTS, defaultPct: 20 };
    state = stepDiscountPolicy(state, 'defaultPct', 1);
    assert.equal(state.defaultPct, 20);
    state = { ...DISCOUNT_POLICY_DEFAULTS, defaultPct: 0 };
    assert.equal(stepDiscountPolicy(state, 'defaultPct', -1).defaultPct, 0);
    assert.equal(stepDiscountPolicy(DISCOUNT_POLICY_DEFAULTS, 'defaultPct', 1).defaultPct, 11);
  });

  it('clamps the ceiling between default and 50', () => {
    assert.equal(stepDiscountPolicy(DISCOUNT_POLICY_DEFAULTS, 'maxPct', -1).maxPct, 19);
    const atDefault = { ...DISCOUNT_POLICY_DEFAULTS, maxPct: 10 };
    assert.equal(stepDiscountPolicy(atDefault, 'maxPct', -1).maxPct, 10);
    const atTop = { ...DISCOUNT_POLICY_DEFAULTS, maxPct: 50 };
    assert.equal(stepDiscountPolicy(atTop, 'maxPct', 1).maxPct, 50);
  });

  it('clamps tier percentages between 0 and the ceiling', () => {
    const vipAtMax = { ...DISCOUNT_POLICY_DEFAULTS, vipPct: 20 };
    assert.equal(stepDiscountPolicy(vipAtMax, 'vipPct', 1).vipPct, 20);
    const regAtZero = { ...DISCOUNT_POLICY_DEFAULTS, regularPct: 0 };
    assert.equal(stepDiscountPolicy(regAtZero, 'regularPct', -1).regularPct, 0);
    assert.equal(stepDiscountPolicy(DISCOUNT_POLICY_DEFAULTS, 'vipPct', 1).vipPct, 16);
  });

  it('marks state dirty on any change and clean on save', () => {
    assert.equal(stepDiscountPolicy(DISCOUNT_POLICY_DEFAULTS, 'vipPct', -1).saved, false);
    assert.equal(toggleDiscountAllowAuto(DISCOUNT_POLICY_DEFAULTS).saved, false);
    assert.equal(toggleDiscountAllowAuto(DISCOUNT_POLICY_DEFAULTS).allowAuto, false);
    const dirty = setDiscountOverrideRole(DISCOUNT_POLICY_DEFAULTS, 'owner');
    assert.equal(dirty.saved, false);
    assert.equal(dirty.overrideRole, 'owner');
    const saved = saveDiscountPolicy(dirty);
    assert.equal(saved.saved, true);
    assert.equal(saved.overrideRole, 'owner');
  });
});

it('discount override options name OWNER and MANAGER as the employee picker does', () => {
  assert.equal(DISCOUNT_OVERRIDE_OPTIONS.find((option) => option.id === 'owner')!.label, 'เจ้าของกิจการเท่านั้น');
  assert.equal(DISCOUNT_OVERRIDE_OPTIONS.find((option) => option.id === 'manager')!.label, 'เจ้าของกิจการและผู้จัดการ');
});

// Browser check 2026-10-03: the third option read "พนักงานขายขึ้นไป", a name outside the one list, and "ขึ้นไป" ranks roles
// the code never ranks. Its value is 'any', which keeps no role out, so the option names every role.
it('the third discount override option says every role, which is what its value means', () => {
  assert.equal(DISCOUNT_OVERRIDE_OPTIONS.find((option) => option.id === 'any')!.label, 'ทุกบทบาท');
});
