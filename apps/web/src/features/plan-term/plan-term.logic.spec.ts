import { planTermReminderText, cardRenewalRunning } from './plan-term.logic';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { planTermStateLabel } from '@watchdog-bms/contracts';
import {
  PLAN_LOCK_COPY,
  claimUnlockReload,
  isLockedShellPath,
  isRenewalPath,
  planLockReason,
  planTermView,
  renewalPathFor,
  shouldUseLockedWorkspace,
} from './plan-term.logic';
import type { PlanTermNotice } from './plan-term.api';
import { bannerPlace, bannerSentence } from './PlanTermBanner';

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

  it('keeps explicitly eligible free shops out of the locked shell and renewal redirect', () => {
    const expiredPaid = notice({ derivedState: 'EXPIRED', daysLeft: 0 });
    const expiredFree = notice({ derivedState: 'EXPIRED', daysLeft: 0, freeExpenseDrafts: true });
    assert.equal(shouldUseLockedWorkspace(expiredPaid), true);
    assert.equal(shouldUseLockedWorkspace(expiredFree, true), false);
    assert.equal(planTermView(expiredPaid), 'renewal-page');
    assert.equal(planTermView(expiredFree, false, true), 'none');
    assert.equal(planTermView(expiredFree), 'renewal-page', 'notice alone does not bypass the lock');
    assert.equal(shouldUseLockedWorkspace(notice({ derivedState: 'EXPIRED' })), true, 'missing server flag fails closed');
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

describe('one-row reminder', () => {
  it('names days, today and expiry without zero or negative days', () => {
    assert.equal(planTermReminderText(7), 'เหลืออีก 7 วัน');
    assert.equal(planTermReminderText(1), 'เหลืออีก 1 วัน');
    assert.equal(planTermReminderText(0), 'แพ็กเกจหมดอายุวันนี้');
    assert.equal(planTermReminderText(-1), 'แพ็กเกจหมดอายุแล้ว');
  });
  it('suppresses only active card renewal that has not been stopped', () => {
    assert.equal(cardRenewalRunning({ renewalMode: 'CARD_AUTO', subscriptionState: 'active', cancelAtPeriodEnd: false }), true);
    for (const value of [{ renewalMode: 'PROMPTPAY_RENEW' }, { subscriptionState: 'past_due' }, { cancelAtPeriodEnd: true }])
      assert.equal(cardRenewalRunning({ renewalMode: 'CARD_AUTO', subscriptionState: 'active', cancelAtPeriodEnd: false, ...value } as any), false);
  });
  it('has one quiet action, no collapse, progress or contact links, and directs an issued bill to payment', () => {
    const source = readFileSync(new URL('./PlanTermSidebarCard.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|aria-expanded|warningProgressPercent|tel:|mailto:/);
    assert.match(source, /mangmee-btn-quiet/);
    assert.match(source, /#billing-payment/); assert.match(source, /\?purchase=repeat/);
    assert.match(source, /มีบิลรอจ่าย/);
    assert.match(source, /loaded\?\.invoice \? 'ดูการจ่ายเงิน'/);
    assert.match(source, /whitespace-nowrap/);
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
      '/companies/co-1/account',
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
      assert.match(copy.staff, /ให้เจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจ/);
      assert.doesNotMatch(copy.staff, /พัก|ปิดใช้งาน|ต่ออายุ/);
    }
    assert.doesNotMatch(PLAN_LOCK_COPY.no_package.staff, /หมดอายุ/);
    assert.match(PLAN_LOCK_COPY.trial_ended.staff, /หมดอายุแล้ว/);
    const page = readFileSync(new URL('./CompanyTermExpiredPage.tsx', import.meta.url), 'utf8');
    const banner = readFileSync(new URL('./PlanTermBanner.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(page, /พักการใช้งาน/);
    // The renewal page says who can act once, in its card: the title above it has said what is the matter.
    assert.match(page, /\{copy\.staffNext\} ข้อมูลทั้งหมดยังอยู่ครบ/);
    for (const copy of Object.values(PLAN_LOCK_COPY)) assert.ok(copy.staff.endsWith(copy.staffNext), copy.staff);
    assert.match(banner, /canManagePlan \|\| place === 'renewal' \? bannerSentence\(copy\.banner, place\) : copy\.staff/);
  });
});

// Round 4 (promotion work): the shell's banner offered "เลือกแพ็กเกจ" on the package page itself — the page that button links to — so at 390px the first and biggest green control of the
// screen sat above "ชำระเงินต่อ", even while a payment was open or its money was received. UAT 2026-10-10: the return page still said "… · เลือกแพ็กเกจเพื่อใช้งานต่อ" above a page that
// offers "ชำระเงินต่อ", so every page of the billing area now gets the same treatment: only what is the matter, and no button.
describe('the locked banner on the billing pages', () => {
  const ID = 'company-1', base = `/companies/${ID}/billing`;

  it('is "billing" for the package page, the return page and every page under them (with or without a trailing slash or a query), and "elsewhere" for the rest', () => {
    for (const billing of [base, `${base}/`, `${base}?interval=year`, `${base}/#billing-history`, `${base}?collection=op-1`, `${base}/return`, `${base}/return/`, `${base}/return?attempt=a1&checkout=canceled`,
      `${base}/return?attempt=a1#top`, `${base}/invoices/inv-1`, `${base}/invoices/inv-1/`, `${base}/preview`])
      assert.equal(bannerPlace(billing, ID), 'billing', billing);
    // the renewal page carries the button and the who-can-act line in its own card
    for (const renewal of [`/companies/${ID}/renew`, `/companies/${ID}/renew/`, `/companies/${ID}/renew?from=menu`]) assert.equal(bannerPlace(renewal, ID), 'renewal', renewal);
    assert.equal(bannerPlace('/companies/company-2/renew', ID), 'elsewhere');
    for (const elsewhere of [`/companies/${ID}/dashboard`, `/companies/${ID}/settings`, `/companies/${ID}/settings/billing`, `/companies/${ID}/renewal`, `${base}-other`, `/companies/${ID}/billing2`, `/companies/${ID}/billing2/return`, '/billing', '/', ''])
      assert.equal(bannerPlace(elsewhere, ID), 'elsewhere', elsewhere);
    // another company's billing area is not this company's
    assert.equal(bannerPlace('/companies/company-2/billing', ID), 'elsewhere');
    assert.equal(bannerPlace('/companies/company-2/billing/return', ID), 'elsewhere');
  });

  it('on a billing page the sentence keeps what is the matter and drops the invitation, in every case of the table: reason x place; every other page keeps the whole sentence', () => {
    const cases: [keyof typeof PLAN_LOCK_COPY, string][] = [['no_package', 'ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้'], ['trial_ended', 'แพ็กเกจของร้านหมดอายุแล้ว']];
    for (const [reason, matter] of cases) {
      const copy = PLAN_LOCK_COPY[reason];
      // the sentence is "<the matter> · <what to do>": the split in `bannerSentence` is only safe while that holds
      assert.equal(copy.banner.split(' · ').length, 2, copy.banner);
      assert.equal(bannerSentence(copy.banner, bannerPlace(base, ID)), matter, `${reason}: package page`);
      assert.equal(bannerSentence(copy.banner, bannerPlace(`${base}/return?attempt=a1`, ID)), matter, `${reason}: return page`);
      assert.equal(bannerSentence(copy.banner, bannerPlace(`${base}/invoices/inv-1`, ID)), matter, `${reason}: invoice page`);
      assert.doesNotMatch(bannerSentence(copy.banner, 'billing'), /เลือกแพ็กเกจ|เพื่อ/);
      assert.equal(bannerSentence(copy.banner, bannerPlace(`/companies/${ID}/renew`, ID)), matter, `${reason}: renewal page`);
      assert.equal(bannerSentence(copy.banner, bannerPlace(`/companies/${ID}/dashboard`, ID)), copy.banner, `${reason}: everywhere else`);
      assert.equal(bannerSentence(copy.banner, 'elsewhere'), copy.banner);
    }
  });

  it('draws the button only where the place says so, and staff are never given one', () => {
    const banner = readFileSync(new URL('./PlanTermBanner.tsx', import.meta.url), 'utf8');
    assert.match(banner, /\{canManagePlan && place === 'elsewhere' && \(\s*<Link className="mangmee-btn mangmee-btn-primary w-full sm:w-auto" href=\{`\/companies\/\$\{companyId\}\/billing`\}>\s*\{PLAN_LOCK_CTA\}/);
    assert.equal(banner.split('PLAN_LOCK_CTA').length - 1, 2, 'imported once, drawn once');
    assert.match(banner, /canManagePlan \|\| place === 'renewal' \? bannerSentence\(copy\.banner, place\) : copy\.staff/);
  });
});

// Review 2026-09-29: the unlock fallback reloaded on every page load while the notice still lagged.
describe('unlock reload fallback', () => {
  const memory = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
  };

  it('reloads once per attempt, and the claim survives into the next page load', () => {
    const store = memory();
    assert.equal(claimUnlockReload(() => store, 'attempt-1'), true);
    assert.equal(store.values.get('unlock-reload:attempt-1'), '1');
    // Same session storage after the reload: the second page load must not reload again.
    assert.equal(claimUnlockReload(() => store, 'attempt-1'), false);
    // A different purchase earns its own single reload.
    assert.equal(claimUnlockReload(() => store, 'attempt-2'), true);
  });

  it('never reloads when storage is blocked, rather than risk a loop', () => {
    assert.equal(claimUnlockReload(() => { throw new Error('SecurityError'); }, 'attempt-1'), false);
    assert.equal(claimUnlockReload(() => ({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } }), 'attempt-1'), false);
  });
});

// Render the mounted sidebar row after its read has settled; permission/window rules stay in planTermView.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanTermSidebarCard } from './PlanTermSidebarCard';

it('renders one reminder row for one day/today and the issued bill, and none outside its audience/window', () => {
  (globalThis as any).React = React;
  const runtime = require('react') as typeof React, original = runtime.useState;
  const render = (value: PlanTermNotice | null, invoice = false) => {
    Reflect.set(runtime, 'useState', () => original({ companyId: 'shop', notice: value, invoice }));
    return renderToStaticMarkup(React.createElement(PlanTermSidebarCard, { companyId: 'shop' }));
  };
  try {
    for (const [daysLeft, text] of [[7, 'เหลืออีก 7 วัน'], [1, 'เหลืออีก 1 วัน'], [0, 'แพ็กเกจหมดอายุวันนี้']] as const) {
      const html = render(notice({ derivedState: 'WARNING', daysLeft }));
      assert.ok(html.includes(text)); assert.match(html, /mangmee-btn-quiet/);
      assert.equal((html.match(/<a /g) ?? []).length, 1); assert.match(html, /purchase=repeat/);
    }
    const bill = render(notice({ derivedState: 'WARNING' }), true);
    assert.match(bill, /มีบิลรอจ่าย/); assert.match(bill, /ดูการจ่ายเงิน/); assert.match(bill, /#billing-payment/);
    assert.doesNotMatch(bill, /purchase=repeat/);
    for (const value of [null, notice({ derivedState: 'ACTIVE' }), notice({ derivedState: 'EXPIRED', daysLeft: -1 }), notice({ derivedState: 'WARNING', isOwner: false })]) assert.equal(render(value), '');
    assert.match(render(notice({ derivedState: 'WARNING', isOwner: false, canManagePlan: true })), /ต่ออายุ/);
    assert.equal(render(notice({ derivedState: 'WARNING', isOwner: true, canManagePlan: false })), '');
    const recovery = readFileSync(new URL('./CompanyTermExpiredPage.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(recovery, /max-w-/); assert.match(recovery, /copy\.staffNext/); assert.match(recovery, /PLAN_LOCK_CTA/);
  } finally { Reflect.set(runtime, 'useState', original); }
});
