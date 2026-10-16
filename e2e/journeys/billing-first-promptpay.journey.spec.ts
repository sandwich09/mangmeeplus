import { test, expect } from '../harness/fixtures';
import { expectNoClientError } from '../harness/auth';
import { ATTEMPT, defaultState, installNoSetupRoutes } from '../billing-no-setup.fixture';
import type { Page } from '@playwright/test';
import { AFTER_PRESS, FIRST_SIGHT, expectInSight } from './journey-kit';

// Approved D0 local proof: billing/plan-term/provider answers are simulated by the existing
// no-setup fixture; session, membership, shell and unrelated reads use the app. This does NOT
// prove a provider payment, persisted acceptance, a webhook or a real grant (owed on UAT).
for (const width of [390, 1556]) for (const [mode, label] of [
  ['PROMPTPAY_ONCE', 'พร้อมเพย์ QR · จ่ายครั้งเดียว'], ['CARD_ONCE', 'บัตร · จ่ายครั้งเดียว'],
] as const) {
  test(`@journey D1 first purchase ${mode} at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: 900 });
    const state = defaultState();
    await installNoSetupRoutes(page, companyId, state);
    const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.goto(`/companies/${companyId}/billing`);
    await expect(page.getByRole('heading', { name: 'ยังไม่มีแพ็กเกจ', exact: true })).toBeVisible(FIRST_SIGHT);
    await page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).click();
    await expectInSight(page.getByRole('heading', { level: 1, name: 'เลือกแพ็กเกจ', exact: true }));
    const chooser = page.getByRole('region', { name: 'เลือกแพ็กเกจ', exact: true });
    await expect(chooser.getByRole('button', { name: 'รายเดือน', exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['พร้อมเพย์ QR · จ่ายครั้งเดียว', 'บัตร · จ่ายครั้งเดียว', 'บัตร · ต่ออายุอัตโนมัติ', 'พร้อมเพย์ QR · สแกนบิลทุกงวด']) {
      const radio = chooser.getByRole('radio', { name, exact: true });
      await expect(radio).toBeVisible(); await expect(radio).toBeEnabled(); await expect(radio).not.toBeChecked();
    }
    await fits();
    await page.screenshot({ path: info.outputPath(`chooser-${mode}-${width}.png`), fullPage: true });
    await chooser.getByRole('radio', { name: 'เลือก เริ่มต้น', exact: true }).check();
    await page.getByRole('button', { name: 'ดูยอดที่ต้องจ่าย', exact: true }).click();
    await expect(chooser.getByRole('alert')).toHaveText('เลือกวิธีจ่ายก่อน');
    expect(state.log.quotes).toHaveLength(0); expect(state.log.checkoutBodies).toHaveLength(0);
    await chooser.getByRole('radio', { name: label, exact: true }).check();
    await page.getByRole('button', { name: 'ดูยอดที่ต้องจ่าย', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ตรวจก่อนจ่าย', exact: true })).toBeVisible(AFTER_PRESS);
    const review = page.getByRole('region', { name: 'ตรวจก่อนจ่าย', exact: true });
    await expect(review).toContainText('เริ่มต้น · รายเดือน');
    await expect(review).toContainText(label);
    await expect(review.getByRole('checkbox')).toHaveCount(0);
    await expect(review.getByText('จ่ายครั้งเดียว ไม่มีการตัดเงินงวดถัดไป', { exact: true })).toBeVisible();
    await expect(page.getByText('กดยืนยันซื้อ คือยอมรับแพ็กเกจ ยอดเงิน และเงื่อนไขที่แสดง', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ข้อกำหนดการใช้งาน', exact: true })).toHaveAttribute('href', '/terms');
    await expect(page.getByRole('link', { name: 'ข้อกำหนดการใช้งาน', exact: true })).toHaveCSS('white-space', 'nowrap');
    await expect(page.getByText('จ่ายวันนี้', { exact: false })).toContainText('฿249.00');
    await expect(page.getByText('฿249.00', { exact: true })).toHaveCount(1);
    expect(state.log.quotes).toEqual([{ offerKey: 'STARTER_249', interval: 'month', purchaseMode: mode }]);
    expect(state.log.checkoutBodies).toHaveLength(0);
    const buy = page.getByRole('button', { name: 'ยืนยันซื้อและไปจ่ายเงิน', exact: true });
    await expect(buy).toBeEnabled(); await fits();
    await page.screenshot({ path: info.outputPath(`review-${mode}-${width}.png`), fullPage: true });
    await buy.click();
    await expect(page.getByRole('heading', { name: 'Stripe (จำลอง)', exact: true })).toBeVisible(AFTER_PRESS);
    expect(state.log.checkoutBodies).toEqual([{ quoteId: 'q-1', consentRevision: 'billing-v2', accepted: true, channel: 'web' }]);
    expect(state.log.checkouts).toHaveLength(1); expect(state.log.checkouts[0]).not.toBe('');
    await page.getByRole('link', { name: 'จ่ายจำลอง', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'กำลังรอผลการจ่ายเงิน', exact: true })).toBeVisible(AFTER_PRESS);
    state.stage = 'paid';
    await expect(page.getByRole('heading', { name: 'ได้รับเงินแล้ว กำลังเปิดแพ็กเกจ', exact: true })).toBeVisible(AFTER_PRESS);
    let reloads = 0; page.on('load', () => { reloads++; });
    state.stage = 'applied';
    await expect(page.getByRole('heading', { name: 'จ่ายแล้ว เปิดแพ็กเกจแล้ว', exact: true })).toBeVisible(AFTER_PRESS);
    expect(reloads).toBe(0);
    await expect(page.locator('aside a[href$="/dashboard"]').first()).toBeAttached();
    await fits(); await expectNoClientError(page);
    await page.screenshot({ path: info.outputPath(`paid-${mode}-${width}.png`), fullPage: true });
    // Read the final fixture-backed endpoint through the browser so the same route interception
    // applies. It asserts the screen's contract, never pretends to inspect a database grant.
    const status = await page.evaluate(async id => (await fetch(`/api/v1/companies/${id}/billing`)).json(), companyId);
    expect(status).toMatchObject({ attemptId: ATTEMPT, paymentState: 'PAID', applyState: 'APPLIED', accessState: 'ACTIVE', renewalMode: mode, subscriptionState: 'NONE', nextChargeAt: null, usage: { remaining: 30 } });
    const history = await page.evaluate(async id => (await fetch(`/api/v1/companies/${id}/billing/history`)).json(), companyId);
    expect(history.items).toHaveLength(1); expect(history.items[0].amountSatang).toBe(24900);
  });
}

// Regressions found on the proof stack (2026-10-14): each press must reveal its next choice or result.
async function chooserAt(page: Page, companyId: string, width: number, height: number) {
  test.setTimeout(300_000);
  await page.setViewportSize({ width, height });
  const state = defaultState();
  await installNoSetupRoutes(page, companyId, state);
  await page.goto(`/companies/${companyId}/billing`);
  await expect(page.getByRole('heading', { name: 'ยังไม่มีแพ็กเกจ', exact: true })).toBeVisible(FIRST_SIGHT);
  await page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).click();
  await expectInSight(page.getByRole('heading', { level: 1, name: 'เลือกแพ็กเกจ', exact: true }));
  return { state, chooser: page.getByRole('region', { name: 'เลือกแพ็กเกจ', exact: true }) };
}

// On a phone the sentence is drawn under the fourth package card: below the window and behind the bottom bar.
test('@journey D1 nothing chosen at 390px: เลือกแพ็กเกจก่อน is in sight after the press', async ({ authedPage: page, companyId }) => {
  const { chooser } = await chooserAt(page, companyId, 390, 844);
  await page.getByRole('button', { name: 'ดูยอดที่ต้องจ่าย', exact: true }).click();
  await expectInSight(chooser.getByRole('alert').filter({ hasText: 'เลือกแพ็กเกจก่อน' }));
  await expectInSight(chooser.getByRole('heading', { name: 'แพ็กเกจ', exact: true }));
});

// Read from the top of a 1556x900 window, the sentence under the four ways lands below the window.
test('@journey D1 a package but no way to pay, from the top at 1556px: เลือกวิธีจ่ายก่อน is in sight after the press', async ({ authedPage: page, companyId }) => {
  const { chooser } = await chooserAt(page, companyId, 1556, 900);
  await page.mouse.move(900, 450); await page.mouse.wheel(0, -4000);
  await chooser.getByRole('radio', { name: 'เลือก เริ่มต้น', exact: true }).check();
  await page.getByRole('button', { name: 'ดูยอดที่ต้องจ่าย', exact: true }).click();
  await expectInSight(chooser.getByRole('alert').filter({ hasText: 'เลือกวิธีจ่ายก่อน' }));
  await expectInSight(chooser.locator('legend').filter({ hasText: 'วิธีจ่าย' }));
});

// รายเดือน is on and รายปี is off, and the two buttons look the same.
test('@journey D1 chooser at 390px: the cadence that is on can be told from the one that is off', async ({ authedPage: page, companyId }) => {
  const { chooser } = await chooserAt(page, companyId, 390, 844);
  await page.mouse.move(195, 300);
  const look = (name: string) => chooser.getByRole('button', { name, exact: true }).evaluate(el => { const s = getComputedStyle(el); return [s.backgroundColor, s.borderColor, s.color, s.fontWeight, s.boxShadow].join(' | '); });
  await expect(chooser.getByRole('button', { name: 'รายเดือน', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await look('รายเดือน')).not.toBe(await look('รายปี'));
});

// Regression: the result keeps the same Thai package name as the chooser and review.
test('@journey D1 paid result at 390px: the package keeps the name the chooser gave it', async ({ authedPage: page, companyId }) => {
  const { state, chooser } = await chooserAt(page, companyId, 390, 844);
  await chooser.getByRole('radio', { name: 'เลือก เริ่มต้น', exact: true }).check();
  await chooser.getByRole('radio', { name: 'พร้อมเพย์ QR · จ่ายครั้งเดียว', exact: true }).check();
  await page.getByRole('button', { name: 'ดูยอดที่ต้องจ่าย', exact: true }).click();
  await page.getByRole('button', { name: 'ยืนยันซื้อและไปจ่ายเงิน', exact: true }).click();
  await page.getByRole('link', { name: 'จ่ายจำลอง', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'กำลังรอผลการจ่ายเงิน', exact: true })).toBeVisible(AFTER_PRESS);
  state.stage = 'applied';
  await expect(page.getByRole('heading', { name: 'จ่ายแล้ว เปิดแพ็กเกจแล้ว', exact: true })).toBeVisible(AFTER_PRESS);
  const result = page.getByRole('region', { name: 'สถานะแพ็กเกจ', exact: true });
  await expect(result.locator('dd').first()).toHaveText('เริ่มต้น');
  await expect(result.getByRole('link', { name: 'กลับไปหน้าแรก', exact: true })).toHaveAttribute('href', `/companies/${companyId}/dashboard`);
});
