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
  assert.match(page, /const awaitingStripe = currentReturn && !checkoutCanceled && !returnError && !timedOut && \(!returnAttempt \|\| returnAttempt\.paymentState === 'PENDING'\);/);
  // Every way to end or redo the Checkout hangs off the one gate.
  assert.match(page, /const canEndCheckout = !awaitingStripe && !paidNotApplied && !\(currentReturn && returnComplete\) && !returnFailed && Boolean\(status\?\.canCancelCheckout && status\.attemptId\);/);
  assert.match(page, /const canResumePayment = canEndCheckout && /);
  assert.match(page, /const oneTapCancel = canEndCheckout && /);
  // The block of choices is drawn from those same flags (billing-pending-payment.ts decides what is shown; while the page waits for Stripe it offers neither resume nor end),
  // and the two-step end keeps its confirmation for every attempt that is not a plain unpaid page.
  assert.match(page, /canEnd: canEndCheckout, canResume: canResumePayment, oneTap: oneTapCancel,/);
  assert.match(page, /confirmCheckoutCancel && !oneTapCancel && block\.steps\.some\(step => step\.key === 'cancel'\)/);
  // The no-package box ("เลือกแพ็กเกจเพื่อเริ่มใช้งาน") gives way to the waiting line: that line is now the card's heading (billing-pending-payment.ts, PENDING_TEXT.headingWaiting), said once, and the
  // gray waiting box is gone. A box with nothing but the badge's words gives way too; an expired shop keeps the date its package ended.
  assert.doesNotMatch(page, /noPackage && awaitingStripe/);
  assert.match(page, /\{noPackage \? \(pendingShown && !\(lockReason === 'trial_ended' && status\.termEndsAt\) \? null : <dl/);
  // The locked banner's own "เลือกแพ็กเกจ" stays off the return page, and off the package page it leads to (plan-term.logic.spec.ts runs `bannerPlace`).
  assert.match(banner, /const place = bannerPlace\(pathname, companyId\);/);
  assert.match(banner, /\{canManagePlan && place === 'elsewhere' && \(/);
});

test('paid but not applied: a held payment says the team is checking and shows the reference openly', () => {
  assert.match(page, /const applyHeld = !!status && !status\.capacityRepair && !status\.pendingDeal && \(currentReturn \? returnAttempt\?\.applyState : status\.applyState\) === 'HELD';/);
  assert.match(page, /\{applyHeld && <p className="break-all">\{supportReference && `เลขอ้างอิง \$\{supportReference\} · `\}/);
  assert.match(page, /href=\{`mailto:\$\{PLAN_TERM_CONTACT_EMAIL\}`\}>ติดต่อทีมมั่งมี/);
  // The collapsed reference is for every other unconfirmed state, never a second copy.
  assert.match(page, /\{supportReference && !confirmed && !applyHeld && <details/);
  assert.doesNotMatch(page, /อีกสักครู่/);
});

test('a paid advance deal ends the polling and is never told to contact the team', () => {
  assert.match(polling, /if \(!returning \|\| !returnAttemptId \|\| returnError \|\| pendingDeal\) return;/);
  assert.match(polling, /\[api, returning, returnAttemptId, returnComplete, returnError, returnAttempt\?\.paymentState, returnAttempt\?\.applyState, checkoutCanceled, pendingDeal\]/);
  // The old "ยังยืนยันผลไม่ได้ … ติดต่อทีมงานพร้อมเลขอ้างอิง" paragraph repeated the block and, beside "ระบบได้รับเงินแล้ว", contradicted it. Its one sentence of its own lives in the block of an
  // UNPAID payment (billing-pending-payment.ts, `CONTACT`), so a paid deal never gets it.
  assert.doesNotMatch(page, /timedOut && !status\.pendingDeal && <p role="status">ยังยืนยันผลไม่ได้/);
  assert.doesNotMatch(page, /ยังยืนยันผลไม่ได้ กรุณาตรวจสอบรายการเดิมก่อนจ่ายใหม่/);
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

// D1: these source pins guard the mounted page; the browser journey presses the same controls.
test('D1 chooser has four visible methods, no first-purchase default, and validates missing choices beside their controls', () => {
  assert.match(page, /useState<BillingPurchaseMode \| undefined>\(undefined\)/);
  assert.doesNotMatch(page, /otherModesExpanded|วิธีจ่ายอื่น/);
  assert.match(page, /billingPurchaseChoices\(status\)\.map/);
  assert.match(page, /disabled=\{choice\.disabled \|\| busy\}/);
  assert.match(page, /choice\.reason/);
  assert.match(page, /เลือกแพ็กเกจก่อน/);
  assert.match(page, /เลือกวิธีจ่ายก่อน/);
  assert.match(page, /ดูยอดที่ต้องจ่าย/);
  assert.ok(page.indexOf('aria-label="เลือกแพ็กเกจ"') < page.indexOf('<legend className="font-semibold">วิธีจ่าย</legend>'));
});

test('D1 one-time acceptance is the purchase press; renewing methods still require their unchecked consent', () => {
  assert.match(page, /!oneTimeQuote && <div/);
  assert.match(page, /useState\(false\)/);
  assert.match(page, /\(!oneTimeQuote && !accepted\)/);
  assert.match(page, /กดยืนยันซื้อ คือยอมรับแพ็กเกจ ยอดเงิน และเงื่อนไขที่แสดง/);
  assert.match(page, /href="\/terms"/);
  assert.match(page, /จ่ายครั้งเดียว ไม่มีการตัดเงินงวดถัดไป<\/p>/);
  assert.equal((page.match(/await api\.checkout\(/g) ?? []).length, 1);
  const press = page.slice(page.lastIndexOf('onClick={() => {', page.indexOf('await api.checkout(')), page.indexOf('await api.checkout(') + 260);
  assert.match(press, /if \(quoteExpired \|\| Date\.parse\(quote\.expiresAt\) <= Date\.now\(\)\) return/);
  assert.match(press, /quoteId: quote\.quoteId, consentRevision: quote\.consentRevision, accepted: true/);
});

test('D1 changed quotes require another review and never trigger checkout themselves', () => {
  const request = page.slice(page.indexOf('async function requestQuote('), page.indexOf('const annualConversion'));
  assert.match(request, /setAccepted\(false\); setQuote\(result\)/);
  assert.doesNotMatch(request, /api\.checkout/);
  assert.match(page, /setPurchaseMode\(mode\); setQuote\(null\)/);
  assert.match(page, /setInterval\(value\); setQuote\(null\)/);
  assert.match(page, /setBenefitPick\('NORMAL'\); setQuote\(null\)/);
  assert.match(page, /quoteExpired \? <div role="status"/);
});

test('D1 review is flat, the total is not duplicated, and the action group ends the page form', () => {
  assert.match(page, /flatReview/);
  assert.match(page, /if \(!quote \|\| !quoteHeading\.current\) window\.scrollTo\(\{ top: 0 \}\)/);
  assert.match(page, /ตรวจก่อนจ่าย/);
  assert.match(page, /ออกเอกสารในชื่อ/);
  assert.match(page, /ใช้ได้ถึงโดยประมาณ/);
  assert.match(page, /<FormActionBar/);
  assert.match(page, /<ActionGroup>[\s\S]*>กลับ<\/button>[\s\S]*ยืนยันซื้อและไปจ่ายเงิน/);
  assert.match(page, /!flatReview && <p>ราคาก่อนภาษี/);
  assert.match(page, /จ่ายแล้ว เปิดแพ็กเกจแล้ว/);
});

test('D2b field errors lead their groups and are revealed after render above the action bar', () => {
  assert.match(page, /<FieldError>เลือกแพ็กเกจก่อน<\/FieldError>/);
  assert.ok(page.indexOf('<FieldError>เลือกแพ็กเกจก่อน') < page.indexOf('aria-label="แพ็กเกจ"'));
  assert.ok(page.indexOf('<FieldError>เลือกวิธีจ่ายก่อน') < page.indexOf('billingPurchaseChoices(status).map(modeRadio)'));
  assert.match(page, /consentGroup\.current\?\.scrollIntoView\(\{ block: 'center' \}\)/);
  assert.match(page, /pb-64 sm:pb-32/);
  assert.match(page, /\[choiceError, consentError\]/);
});

test('D2b landing, cadence, promotion and acceptance stay visible without duplicate first-purchase facts', () => {
  assert.match(page, /!quote \|\| !quoteHeading.current/);
  assert.match(page, /mangmee-segmented/); assert.match(page, /mangmee-tab-active/);
  assert.ok(page.indexOf('aria-label="โปรโมชั่นที่ใช้ในรายการนี้"') < page.indexOf('flatReview && <dl'));
  assert.doesNotMatch(page, /ไม่มีวันแพ็กเกจเดิมให้ทบ/);
  assert.match(page, /quote.taxTreatment !== 'NOT_VAT_REGISTERED'/);
  assert.match(page, /whitespace-nowrap[^\n]*href="\/terms"/);
});

test('D2b paid tiers use shop names, dates use the shared formatter and the completed purchase leads home', () => {
  assert.doesNotMatch(page, /\{PLAN_TIER_PRESETS\[[^\n]*\.labelTh\}/);
  assert.match(page, /const date = formatThaiDate/);
  assert.match(page, /confirmed && returning[^\n]*กลับไปหน้าแรก/);
  assert.doesNotMatch(page, /ชำระ/);
});

test('D3 explicit reminder entry waits for the reads and cannot bypass an unfinished payment or an issued bill', () => {
  assert.match(page, /get\('purchase'\) !== 'repeat'/);
  assert.match(page, /status\.renewalMode === 'PROMPTPAY_RENEW' && status\.renewalInvoiceUrl\) \{ setSection\('payment'\); return; \}/);
  assert.match(page, /status\.allowedActions\.includes\('new_sales'\) && !pending\?\.inFlight && !status\.capacityRepair/);
  assert.match(page, /choice\.mode === status\?\.renewalMode && !choice\.disabled/);
  assert.match(page, /navigate\(status\.renewalInvoiceUrl!, 'document'\)/);
});


test('billing review fixes use one customer document name, shared controls, and no duplicate choice', () => {
  const documents = readFileSync(new URL('./BillingAdjustmentsPage.tsx', import.meta.url), 'utf8');
  assert.match(documents, /title="เอกสารการจ่ายเงิน"/);
  assert.match(documents, /backLabel="กลับไปประวัติการจ่ายเงิน"/);
  assert.doesNotMatch(page, />ลองใหม่<|บิล พร้อมเพย์/);
  assert.match(page, /fullPackageUpgrade && !selectableChooser && !upgradeNote/);
  assert.match(page, /className="whitespace-nowrap">แพ็กเกจ<\/span>/);
  assert.match(page, /className=\{billingPrimaryControl\} disabled=\{busy\} aria-busy=\{busy\} onClick=\{\(\) => action\(async navigate => navigate\(status\.renewalInvoiceUrl/);
});
