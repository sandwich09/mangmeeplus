import { cardCollapsed, warningBucket, warningProgressPercent } from './plan-term.logic';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { planTermStateLabel } from '@watchdog-bms/contracts';
import {
  PLAN_LOCK_COPY,
  isLockedShellPath,
  isRenewalPath,
  planLockReason,
  planTermView,
  renewalPathFor,
} from './plan-term.logic';
import type { PlanTermNotice } from './plan-term.api';

const notice = (over: Partial<PlanTermNotice>): PlanTermNotice => ({
  derivedState: 'ACTIVE',
  termEndsAt: '2026-09-29T07:00:00.000Z',
  daysLeft: 30,
  isOwner: true,
  ...over,
});

describe('plan term view', () => {
  it('shows nothing for a company with no term row', () => {
    assert.equal(planTermView(null), 'none');
  });

  it('shows nothing while the term is active', () => {
    assert.equal(planTermView(notice({ derivedState: 'ACTIVE' })), 'none');
  });

  // Owner decision 2026-08-30: staff are not shown the package dates at all, only the owner is.
  it('warns the owner and stays silent for staff', () => {
    assert.equal(planTermView(notice({ derivedState: 'WARNING', daysLeft: 3 })), 'warning-banner');
    assert.equal(planTermView(notice({ derivedState: 'WARNING', daysLeft: 3, isOwner: false })), 'none');
  });

  it('sends everyone to the renewal page once the term has ended, staff included', () => {
    assert.equal(planTermView(notice({ derivedState: 'EXPIRED', daysLeft: 0 })), 'renewal-page');
    assert.equal(planTermView(notice({ derivedState: 'EXPIRED', daysLeft: 0, isOwner: false })), 'renewal-page');
  });

  it('does not bounce the renewal page onto itself', () => {
    assert.equal(planTermView(notice({ derivedState: 'EXPIRED' }), true), 'none');
  });
});

describe('renewal path', () => {
  it('derives the renewal page from the company in the path', () => {
    assert.equal(renewalPathFor('/companies/abc123/dashboard'), '/companies/abc123/renew');
    assert.equal(renewalPathFor('/companies/abc123'), '/companies/abc123/renew');
    assert.equal(renewalPathFor('/system/partners'), null);
  });

  it('recognises the renewal page itself, with or without a trailing slash', () => {
    assert.equal(isRenewalPath('/companies/abc123/renew'), true);
    assert.equal(isRenewalPath('/companies/abc123/renew/'), true);
    assert.equal(isRenewalPath('/companies/abc123/renewals'), false);
    assert.equal(isRenewalPath('/companies/abc123/dashboard'), false);
  });
});

describe('sidebar warning card', () => {
  it('maps days left onto the 7/3/1 ladder', () => {
    assert.equal(warningBucket(7), '7');
    assert.equal(warningBucket(4), '7');
    assert.equal(warningBucket(3), '3');
    assert.equal(warningBucket(2), '3');
    assert.equal(warningBucket(1), '1');
    assert.equal(warningBucket(0), '1');
  });

  it('stays collapsed only within the same ladder step, so each new step re-opens the card', () => {
    assert.equal(cardCollapsed('7', '7'), true);
    assert.equal(cardCollapsed('7', '3'), false);
    assert.equal(cardCollapsed(null, '7'), false);
    assert.equal(cardCollapsed('3', '1'), false);
  });

  it('keeps the time-left bar visible even on the last day', () => {
    assert.equal(warningProgressPercent(7), 100);
    assert.equal(warningProgressPercent(3), 43);
    assert.ok(warningProgressPercent(0) >= 6);
  });
});

// Owner 2026-09-20 (spec §12): no trial, so a shop is locked until it buys a package — and the
// locked web is exactly two destinations plus the pages that explain them.
describe('locked shell paths', () => {
  const companyId = 'co-1';

  it('opens the settings hub, the owner profile, the package pages and the renewal page', () => {
    for (const path of [
      '/companies/co-1/settings',
      '/companies/co-1/settings/profile',
      '/companies/co-1/billing',
      '/companies/co-1/billing/return',
      '/companies/co-1/billing/invoices/inv-1',
      '/companies/co-1/renew',
    ]) {
      assert.equal(isLockedShellPath(path, companyId), true, path);
    }
  });

  it('closes every business page, and the settings pages the term guard refuses', () => {
    for (const path of [
      '/companies/co-1/dashboard',
      '/companies/co-1/expenses',
      '/companies/co-1/settings/branches',
      '/companies/co-1/settings/line-oa',
      '/companies/co-1/settings/profile/extra',
      '/companies/co-1/billing/history',
    ]) {
      assert.equal(isLockedShellPath(path, companyId), false, path);
    }
  });

  it('never opens another company\'s pages', () => {
    assert.equal(isLockedShellPath('/companies/other/settings', companyId), false);
    assert.equal(isLockedShellPath('/companies/other/billing', companyId), false);
  });
});

describe('lock reason', () => {
  // The API answers `lockReason` only once the locked-signup change ships; before it does, and for
  // every shop locked the old way, the case it always described is a term that ran out.
  it('falls back to the term-ended case when the API does not say', () => {
    assert.equal(planLockReason(notice({ derivedState: 'EXPIRED' })), 'trial_ended');
    assert.equal(planLockReason(null), 'trial_ended');
    assert.equal(planLockReason(notice({ derivedState: 'EXPIRED', lockReason: 'no_package' })), 'no_package');
  });

  it('never tells a shop that never had a package that it ran out of one', () => {
    assert.match(PLAN_LOCK_COPY.no_package.banner, /ยังไม่มีแพ็กเกจ/);
    assert.match(PLAN_LOCK_COPY.no_package.title, /ยังไม่มีแพ็กเกจ/);
    // R-C7: the title matches the one shared label the picker/switcher/console/BillingPage all read.
    assert.equal(PLAN_LOCK_COPY.no_package.title, planTermStateLabel('NO_PACKAGE'));
    for (const line of Object.values(PLAN_LOCK_COPY.no_package)) assert.doesNotMatch(line, /ครบกำหนด|ต่ออายุ/);
    assert.match(PLAN_LOCK_COPY.trial_ended.banner, /แพ็กเกจของร้านหมดอายุแล้ว/);
    // Owner copy rule for every customer-facing string in this journey.
    for (const copy of Object.values(PLAN_LOCK_COPY)) {
      for (const line of Object.values(copy)) assert.doesNotMatch(line, /\+/);
    }
  });

  it('points both reasons at the same next step, which is choosing and not renewing', () => {
    for (const copy of Object.values(PLAN_LOCK_COPY)) assert.match(copy.banner, /เลือกแพ็กเกจ/);
  });

  // Review 2026-09-29: staff got "เลือกแพ็กเกจเพื่อเริ่มใช้งาน" with no button under it, and the locked
  // page told them the shop was "พักการใช้งานชั่วคราว" when it simply had no package.
  it('tells staff who can choose the package, in the words of the lock reason', () => {
    for (const copy of Object.values(PLAN_LOCK_COPY)) {
      assert.match(copy.staff, /ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจ/);
      assert.doesNotMatch(copy.staff, /พัก|ปิดใช้งาน|ต่ออายุ/);
    }
    assert.doesNotMatch(PLAN_LOCK_COPY.no_package.staff, /หมดอายุ/);
    assert.match(PLAN_LOCK_COPY.trial_ended.staff, /หมดอายุแล้ว/);
    const page = readFileSync(new URL('./CompanyTermExpiredPage.tsx', import.meta.url), 'utf8');
    const banner = readFileSync(new URL('./PlanTermBanner.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(page, /พักการใช้งาน/);
    assert.match(page, /\{copy\.staff\} ข้อมูลทั้งหมดยังอยู่ครบ/);
    assert.match(banner, /canManagePlan \? copy\.banner : copy\.staff/);
  });
});
