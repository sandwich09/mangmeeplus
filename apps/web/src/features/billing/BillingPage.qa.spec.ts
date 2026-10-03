import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Review 2026-09-29 (purchase without setup). The return page's waiting, polling and held states live
// behind effects and a live Stripe round trip, so — like workspace-layout.qa.spec.ts — they are pinned
// from source here; e2e/billing-no-setup.spec.ts drives the same journey in a browser.
const page = readFileSync(new URL('./BillingPage.tsx', import.meta.url), 'utf8');
const banner = readFileSync(new URL('../plan-term/PlanTermBanner.tsx', import.meta.url), 'utf8');
const polling = page.slice(page.indexOf('const pendingDeal = !!data?.status.pendingDeal;'), page.indexOf('async function action('));

test('a success return waits for Stripe: no cancel, resume, new choice or banner CTA while the attempt is open', () => {
  assert.match(page, /const awaitingStripe = returning && !checkoutCanceled && !returnError && !timedOut && \(!returnAttempt \|\| returnAttempt\.paymentState === 'PENDING'\);/);
  // Every way to end or redo the Checkout hangs off the one gate.
  assert.match(page, /const canEndCheckout = !awaitingStripe && Boolean\(status\?\.canCancelCheckout && status\.attemptId\);/);
  assert.match(page, /const canResumePayment = canEndCheckout && /);
  assert.match(page, /const oneTapCancel = canEndCheckout && /);
  assert.match(page, /\{canEndCheckout && !oneTapCancel && \(confirmCheckoutCancel \?/);
  // The no-package box ("เลือกแพ็กเกจเพื่อเริ่มใช้งาน") gives way to the waiting line.
  assert.match(page, /\{noPackage && awaitingStripe \? <div[^>]*>\s*<p[^>]*>กำลังรอผลการชำระเงินจากผู้ให้บริการรับชำระเงิน<\/p>/);
  // The locked banner's own "เลือกแพ็กเกจ" stays off the return page.
  assert.match(banner, /const onReturnPage = pathname === `\/companies\/\$\{encodeURIComponent\(companyId\)\}\/billing\/return`;/);
  assert.match(banner, /\{canManagePlan && !onReturnPage && \(/);
});

test('paid but not applied: a held payment says the team is checking and shows the reference openly', () => {
  assert.match(page, /const applyHeld = !!status && !status\.capacityRepair && !status\.pendingDeal && \(returning \? returnAttempt\?\.applyState : status\.applyState\) === 'HELD';/);
  assert.match(page, /\{applyHeld && <p role="status"[^>]*>ทีมงานกำลังตรวจสอบก่อนเปิดสิทธิ์\{supportReference && ` · เลขอ้างอิง \$\{supportReference\}`\}<\/p>\}/);
  // The collapsed reference is for every other unconfirmed state, never a second copy.
  assert.match(page, /\{supportReference && !confirmed && !applyHeld && <details/);
  assert.doesNotMatch(page, /อีกสักครู่/);
});

test('a paid advance deal ends the polling and is never told to contact the team', () => {
  assert.match(polling, /if \(!returning \|\| !returnAttemptId \|\| returnError \|\| pendingDeal\) return;/);
  assert.match(polling, /\[api, returning, returnAttemptId, returnComplete, returnError, returnAttempt\?\.paymentState, returnAttempt\?\.applyState, checkoutCanceled, pendingDeal\]/);
  assert.match(page, /\{returning && !confirmed && timedOut && !status\.pendingDeal && <p role="status">ยังยืนยันผลไม่ได้/);
});

// A browser runs a timer longer than 2^31-1 ms (about 24.8 days) at once: a quote valid that long
// (or a device clock that far behind) read as expired the moment it was shown, so it could never be paid.
test('the quote clock is clamped like the other deadline timers, so a valid quote never shows as expired', () => {
  assert.match(page, /window\.setTimeout\(\(\) => setQuoteExpired\(true\), Math\.min\(2_147_483_647, remaining\)\)/);
});

test('a canceled return does not poll, unless the old Checkout turned out paid', () => {
  assert.match(polling, /if \(checkoutCanceled && returnAttempt\?\.paymentState !== 'PAID'\) return;/);
});

test('a failed read retries; only 403/404 end the polling, and the 3 minutes are judged after a read', () => {
  assert.match(polling, /if \(code === 403 \|\| code === 404\) \{ if \(active\) setReturnError\(code === 404 \? RETURN_NOT_FOUND : errorText\(e\)\); return; \}/);
  const read = polling.indexOf('await api.attempt(returnAttemptId)');
  const giveUp = polling.indexOf('setTimedOut(true)');
  assert.ok(read > 0 && giveUp > read, 'a tab hidden past 3 minutes reads once more before it says it could not confirm');
  assert.ok(polling.indexOf('schedule();', giveUp) > giveUp, 'and otherwise keeps polling');
});
