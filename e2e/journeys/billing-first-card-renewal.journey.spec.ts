import { test, expect } from '../harness/fixtures';
import { expectNoClientError } from '../harness/auth';
import { ATTEMPT, defaultState, installNoSetupRoutes, chooseBillingMethod } from '../billing-no-setup.fixture';
import { AFTER_PRESS, FIRST_SIGHT, expectInSight, inOrder } from './journey-kit';

// D0-approved local proof: the no-setup fixture supplies billing/plan-term/provider answers;
// session, membership and shell still use the app. This cannot prove a real payment, stored
// consent, webhook, grant or next-cycle collection. Those provider tests remain owed on UAT.
for (const width of [390, 1556]) for (const [mode, label, consent, explanation] of [
  ['CARD_AUTO', 'บัตร · ต่ออายุอัตโนมัติ', 'ยอมรับการตัดบัตรอัตโนมัติทุกเดือน', 'เลือกบัตรที่หน้าจ่ายเงิน บัตรใบนั้นจะใช้ต่ออายุอัตโนมัติทุกเดือน'],
  ['PROMPTPAY_RENEW', 'พร้อมเพย์ QR · สแกนบิลทุกงวด', 'ยอมรับการออกบิลพร้อมเพย์ทุกเดือน', 'ระบบออกบิลทุกเดือน ต้องสแกนจ่ายเอง ไม่มีการหักเงินอัตโนมัติ'],
] as const) {
  test(`@journey D2 first renewing purchase ${mode} at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: 900 });
    const state = defaultState();
    await installNoSetupRoutes(page, companyId, state);
    if (mode === 'PROMPTPAY_RENEW') {
      // A provider-owned bill stand-in, not an invented Mangmee result or a completed payment.
      // The newest route is asked first: API paths are handed on to the fixture, or the read at the end gets this page.
      await page.route('https://checkout.stripe.com/**', route => new URL(route.request().url()).pathname.startsWith('/api/v1/') ? route.fallback() : route.fulfill({ contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html lang="th"><meta name="viewport" content="width=device-width, initial-scale=1"><h1>บิลพร้อมเพย์ (จำลอง)</h1><p>ยอดที่ต้องจ่าย ฿249.00</p><p>ต้องสแกนจ่ายเอง ไม่มีการหักเงินอัตโนมัติ</p></html>' }));
    }
    const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.goto(`/companies/${companyId}/billing`);
    await expect(page.getByRole('heading', { name: 'ยังไม่มีแพ็กเกจ', exact: true })).toBeVisible(FIRST_SIGHT);
    await page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'แพ็กเกจ', exact: true })).toBeVisible(AFTER_PRESS);
    const chooser = page.getByRole('region', { name: 'เลือกแพ็กเกจ', exact: true });
    await expect(chooser.getByRole('button', { name: 'รายเดือน', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(chooser.getByRole('radio', { name: 'เลือก เริ่มต้น', exact: true })).not.toBeChecked();
    await fits();
    await chooser.getByRole('radio', { name: 'เลือก เริ่มต้น', exact: true }).check();
    await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await chooseBillingMethod(page, mode);
    await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    const methods = page.getByRole('region', { name: 'วิธีจ่าย', exact: true });
    const tick = methods.getByRole('checkbox', { name: consent, exact: true });
    const next = page.getByRole('button', { name: 'ถัดไป', exact: true });
    await expect(tick).not.toBeChecked(); await expect(next).toBeEnabled();
    await expect(methods.getByRole('alert')).toHaveCount(0); await expectInSight(tick);
    expect(state.log.checkoutBodies).toHaveLength(0);
    await next.click();
    await expect(methods.getByRole('alert')).toHaveText('ติ๊กยอมรับการต่ออายุก่อน');
    await expect(tick).toBeFocused(); expect(state.log.checkoutBodies).toHaveLength(0);
    await tick.check(); await expect(methods.getByRole('alert')).toHaveCount(0); await next.click();
    await expect(page.getByRole('heading', { level: 2, name: 'ตรวจก่อนจ่าย', exact: true })).toBeVisible(AFTER_PRESS);
    const review = page.getByRole('region', { name: 'ตรวจก่อนจ่าย', exact: true });
    await expect(review).toContainText('เริ่มต้น · รายเดือน');
    await expect(review.getByText(explanation, { exact: true })).toBeVisible();
    const nextDate = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
    await expect(review).toContainText(inOrder(mode === 'CARD_AUTO' ? 'ตัดบัตรครั้งถัดไปโดยประมาณ' : 'ออกบิลครั้งถัดไปโดยประมาณ', nextDate));
    await expect(review.locator('.mangmee-unit')).toHaveText(/249\.00\s*บาท/);
    await expect(review.getByText('ยอดที่จ่ายวันนี้', { exact: true })).toHaveCount(1);
    const buy = page.getByRole('button', { name: 'จ่าย 249.00 บาท', exact: true });
    await expect(buy).toBeEnabled();
    if (mode === 'PROMPTPAY_RENEW') await expect(review).not.toContainText(/ยอมรับการตัดบัตร|บัตรใบนั้นจะใช้/);
    expect(state.log.quotes).toEqual([{ offerKey: 'STARTER_249', interval: 'month', purchaseMode: mode }]);
    await fits(); await page.screenshot({ path: info.outputPath(`renewal-review-${mode}-${width}.png`), fullPage: true });
    await buy.click();
    await expect(page.getByRole('heading', { name: mode === 'CARD_AUTO' ? 'Stripe (จำลอง)' : 'บิลพร้อมเพย์ (จำลอง)', exact: true })).toBeVisible(AFTER_PRESS);
    expect(state.log.checkoutBodies).toEqual([{ quoteId: 'q-1', consentRevision: 'billing-v2', accepted: true, channel: 'web' }]);
    expect(state.log.checkouts).toHaveLength(1); expect(state.log.checkouts[0]).not.toBe('');
    if (mode === 'PROMPTPAY_RENEW') {
      await expect(page.getByRole('heading', { name: 'บิลพร้อมเพย์ (จำลอง)', exact: true })).toBeVisible(AFTER_PRESS);
      await expect(page.getByText('ยอดที่ต้องจ่าย ฿249.00', { exact: true })).toBeVisible();
      await expect(page.getByText('ต้องสแกนจ่ายเอง ไม่มีการหักเงินอัตโนมัติ', { exact: true })).toBeVisible();
      // The fixture intercepts this relative API path on the stand-in origin too; this asserts
      // its unpaid contract, never a provider bill persisted in the database.
      const status = await page.evaluate(async id => (await fetch(`/api/v1/companies/${id}/billing`)).json(), companyId);
      expect(status).toMatchObject({ attemptId: ATTEMPT, paymentState: 'PENDING', applyState: 'NONE', accessState: 'EXPIRED', subscriptionState: 'NONE', nextChargeAt: null });
      await fits(); return;
    }
    await expect(page.getByRole('heading', { name: 'Stripe (จำลอง)', exact: true })).toBeVisible(AFTER_PRESS);
    await page.getByRole('link', { name: 'จ่ายจำลอง', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'กำลังรอผลการจ่ายเงิน', exact: true })).toBeVisible(AFTER_PRESS);
    state.stage = 'paid';
    await expect(page.getByRole('heading', { name: 'ได้รับเงินแล้ว กำลังเปิดแพ็กเกจ', exact: true })).toBeVisible(AFTER_PRESS);
    let reloads = 0; page.on('load', () => { reloads++; }); state.stage = 'applied';
    await expect(page.getByRole('heading', { name: /^จ่าย [\d,]+\.\d{2} บาทแล้ว$/, exact: true })).toBeVisible(AFTER_PRESS);
    await expect(page.getByText('ผลการจ่ายเงินล่าสุด', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'ตรวจผลการจ่ายเงิน', exact: true })).toHaveCount(0);
    expect(reloads).toBe(0); await fits(); await expectNoClientError(page);
    const status = await page.evaluate(async id => (await fetch(`/api/v1/companies/${id}/billing`)).json(), companyId);
    expect(status).toMatchObject({ paymentState: 'PAID', applyState: 'APPLIED', accessState: 'ACTIVE', renewalMode: 'CARD_AUTO', subscriptionState: 'active', usage: { remaining: 30 } });
    expect(status.nextChargeAt).not.toBeNull();
    const history = await page.evaluate(async id => (await fetch(`/api/v1/companies/${id}/billing/history`)).json(), companyId);
    expect(history.items).toHaveLength(1); expect(history.items[0].amountSatang).toBe(24900);
    await page.screenshot({ path: info.outputPath(`renewal-paid-${width}.png`), fullPage: true });
  });
}

// Regression: an early press reveals both the consent box and the field error above the bar.
for (const [width, height] of [[390, 844], [1280, 800], [1556, 900]]) {
test(`@journey D2 early press at ${width}px: the box and ติ๊กยอมรับการต่ออายุก่อน are in sight`, async ({ authedPage: page, companyId }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width, height });
  await installNoSetupRoutes(page, companyId, defaultState());
  await page.goto(`/companies/${companyId}/billing`);
  await expect(page.getByRole('heading', { name: 'ยังไม่มีแพ็กเกจ', exact: true })).toBeVisible(FIRST_SIGHT);
  await page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).click();
  const chooser = page.getByRole('region', { name: 'เลือกแพ็กเกจ', exact: true });
  await chooser.getByRole('radio', { name: 'เลือก เริ่มต้น', exact: true }).check();
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await chooseBillingMethod(page, 'CARD_AUTO');
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  const methods = page.getByRole('region', { name: 'วิธีจ่าย', exact: true });
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(methods.getByRole('alert')).toHaveText('ติ๊กยอมรับการต่ออายุก่อน');
  await expectInSight(methods.getByRole('checkbox'));
  await expectInSight(methods.getByRole('alert'));
});
}
