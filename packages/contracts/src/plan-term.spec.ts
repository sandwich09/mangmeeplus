import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_TERM_STATE_LABEL_TH,
  PLAN_TIER_PRESETS,
  shopPlanTierLabel,
  planTermLockReason,
  planTermState,
  planTermStateLabel,
  type PlanTermState,
} from './plan-term.js';

const addDays = (from: Date, days: number): Date => new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

/**
 * Purchase-without-setup R-C7 (pr-b §2.1, §5.2): moved from apps/api plan-term.logic.spec.ts so the
 * web can classify a term row without depending on an API module. Same 4 cases, ported once for
 * `Date` rows (Prisma) and once for ISO-string rows (DTOs) — `planTermLockReason` must agree either
 * way because `timeOf()` normalizes both.
 */
describe('planTermLockReason', () => {
  const at = new Date('2026-09-20T03:00:00.000Z');

  it('is no_package for the zero-day term provisioning writes', () => {
    assert.equal(planTermLockReason({ termStartAt: at, termEndsAt: at, renewCount: 0 }), 'no_package');
  });

  it('is trial_ended for any term that actually ran', () => {
    assert.equal(planTermLockReason({ termStartAt: at, termEndsAt: addDays(at, 30), renewCount: 0 }), 'trial_ended');
    // One millisecond of term is still a term somebody was given.
    assert.equal(planTermLockReason({ termStartAt: at, termEndsAt: new Date(at.getTime() + 1), renewCount: 0 }), 'trial_ended');
  });

  it('is trial_ended once the shop has been renewed, whatever the dates say', () => {
    assert.equal(planTermLockReason({ termStartAt: at, termEndsAt: at, renewCount: 1 }), 'trial_ended');
  });

  it('never calls a backdated term no_package just because it ends before it starts', () => {
    assert.equal(planTermLockReason({ termStartAt: at, termEndsAt: addDays(at, -5), renewCount: 2 }), 'trial_ended');
  });

  it('agrees with the Date rows above when the same term arrives as ISO strings', () => {
    assert.equal(planTermLockReason({ termStartAt: at.toISOString(), termEndsAt: at.toISOString(), renewCount: 0 }), 'no_package');
    assert.equal(
      planTermLockReason({ termStartAt: at.toISOString(), termEndsAt: addDays(at, 30).toISOString(), renewCount: 0 }),
      'trial_ended',
    );
    assert.equal(planTermLockReason({ termStartAt: at.toISOString(), termEndsAt: at.toISOString(), renewCount: 1 }), 'trial_ended');
    assert.equal(
      planTermLockReason({ termStartAt: at.toISOString(), termEndsAt: addDays(at, -5).toISOString(), renewCount: 2 }),
      'trial_ended',
    );
  });
});

describe('planTermState', () => {
  const now = new Date('2026-09-28T07:00:00.000Z');

  it('is ACTIVE for a legacy/grandfathered company with no term row', () => {
    assert.equal(planTermState(null, now), 'ACTIVE');
    assert.equal(planTermState(undefined, now, 'ACTIVE'), 'ACTIVE');
  });

  it('is NO_PACKAGE for the zero-day term, even when companyStatus is DISABLED+termDisabledAt', () => {
    const term = { termStartAt: now, termEndsAt: now, renewCount: 0, termDisabledAt: now };
    assert.equal(planTermState(term, now), 'NO_PACKAGE');
    assert.equal(planTermState(term, now, 'DISABLED'), 'NO_PACKAGE');
  });

  it('is EXPIRED once termEndsAt <= now, for a term that actually ran', () => {
    const term = { termStartAt: addDays(now, -30), termEndsAt: now, renewCount: 0 };
    assert.equal(planTermState(term, now), 'EXPIRED');
  });

  it('is EXPIRED when termDisabledAt is set even if termEndsAt is still in the future', () => {
    const term = { termStartAt: addDays(now, -10), termEndsAt: addDays(now, 20), renewCount: 0, termDisabledAt: now };
    assert.equal(planTermState(term, now), 'EXPIRED');
  });

  it('is TRIAL for a running FREE_TRIAL_15 term', () => {
    const term = { tierKey: 'FREE_TRIAL_15', termStartAt: now, termEndsAt: addDays(now, 15), renewCount: 0 };
    assert.equal(planTermState(term, now), 'TRIAL');
  });

  it('is ACTIVE for any other running tier', () => {
    const term = { tierKey: 'STARTER_249', termStartAt: now, termEndsAt: addDays(now, 30), renewCount: 0 };
    assert.equal(planTermState(term, now), 'ACTIVE');
  });

  it('is ADMIN_HOLD for DISABLED with no termDisabledAt — a human, not the term, locked it', () => {
    const term = { termStartAt: addDays(now, -10), termEndsAt: addDays(now, 20), renewCount: 0 };
    assert.equal(planTermState(term, now, 'DISABLED'), 'ADMIN_HOLD');
  });

  it('is ADMIN_HOLD for SUSPENDED/ARCHIVED even when the term itself is locked (precedence)', () => {
    const term = { termStartAt: now, termEndsAt: now, renewCount: 0 };
    assert.equal(planTermState(term, now, 'SUSPENDED'), 'ADMIN_HOLD');
    assert.equal(planTermState(term, now, 'ARCHIVED'), 'ADMIN_HOLD');
  });
});

describe('planTermStateLabel / PLAN_TERM_STATE_LABEL_TH', () => {
  it('covers all 5 states with plain Thai copy — no machine tokens', () => {
    const states: PlanTermState[] = ['ADMIN_HOLD', 'NO_PACKAGE', 'EXPIRED', 'TRIAL', 'ACTIVE'];
    assert.equal(Object.keys(PLAN_TERM_STATE_LABEL_TH).length, 5);
    for (const state of states) {
      const label = planTermStateLabel(state);
      assert.ok(label.length > 0);
      assert.ok(!label.includes('+'));
      assert.ok(!/[a-z]/.test(label)); // no snake_case / raw enum leaking through
    }
  });

  it('NO_PACKAGE reads "ยังไม่มีแพ็กเกจ" — the label R-C7 forbids calling it "ทดลองใช้"', () => {
    assert.equal(PLAN_TERM_STATE_LABEL_TH.NO_PACKAGE, 'ยังไม่มีแพ็กเกจ');
    assert.equal(planTermStateLabel('NO_PACKAGE'), 'ยังไม่มีแพ็กเกจ');
  });
});


it('shop tier labels omit English brackets while billing presets stay unchanged', () => {
  assert.deepEqual(Object.keys(PLAN_TIER_PRESETS).map(key => shopPlanTierLabel(key as keyof typeof PLAN_TIER_PRESETS)), ['ทดลองใช้ฟรี', 'เริ่มต้น', 'เติบโต', 'มืออาชีพ', 'ธุรกิจ']);
  assert.equal(PLAN_TIER_PRESETS.STARTER_249.labelTh, 'เริ่มต้น (STARTER)');
});
