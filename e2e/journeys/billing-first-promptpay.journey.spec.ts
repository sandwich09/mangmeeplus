import { test, expect } from '../harness/fixtures';
import { expectNoClientError } from '../harness/auth';
import { ATTEMPT, INVOICE, defaultState, installNoSetupRoutes, chooseBillingMethod } from '../billing-no-setup.fixture';
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
    await expectInSight(page.getByRole('heading', { level: 1, name: 'แพ็กเกจ', exact: true }));
    const chooser = page.getByRole('region', { name: 'เลือกแพ็กเกจ', exact: true });
    await expect(chooser.getByRole('button', { name: 'รายเดือน', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(chooser.getByRole('radio', { name: 'เลือก เริ่มต้น', exact: true })).not.toBeChecked();
    await fits();
    await page.screenshot({ path: info.outputPath(`chooser-${mode}-${width}.png`), fullPage: true });
    await chooser.getByRole('radio', { name: 'เลือก เริ่มต้น', exact: true }).check();
    await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    const methods = page.getByRole('region', { name: 'วิธีจ่าย', exact: true });
    for (const name of ['ต่ออายุอัตโนมัติ', 'จ่ายครั้งเดียว', 'QR พร้อมเพย์', 'บัตร']) { const radio = methods.getByRole('radio', { name, exact: true }); await expect(radio).toBeVisible(); await expect(radio).toHaveAttribute('aria-label', name); await expect(radio).toBeEnabled(); await expect(radio).not.toBeChecked(); }
    await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(methods.getByRole('alert')).toHaveText('เลือกวิธีจ่ายก่อน');
    expect(state.log.quotes).toHaveLength(0); expect(state.log.checkoutBodies).toHaveLength(0);
    await chooseBillingMethod(page, mode);
    await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'ตรวจก่อนจ่าย', exact: true })).toBeVisible(AFTER_PRESS);
    const review = page.getByRole('region', { name: 'ตรวจก่อนจ่าย', exact: true });
    await expect(review).toContainText('เริ่มต้น · รายเดือน');
    await expect(review).toContainText(label);
    await expect(review.getByRole('checkbox')).toHaveCount(0);
    await expect(review.getByText('จ่ายครั้งเดียว ไม่มีการตัดเงินงวดถัดไป', { exact: true })).toBeVisible();
    await expect(page.getByText('กดจ่าย คือยอมรับแพ็กเกจ ยอดเงิน และเงื่อนไขที่แสดง', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ข้อกำหนดการใช้งาน', exact: true })).toHaveAttribute('href', '/terms');
    await expect(page.getByRole('link', { name: 'ข้อกำหนดการใช้งาน', exact: true })).toHaveCSS('white-space', 'nowrap');
    await expect(review.locator('.mangmee-unit')).toHaveText(/249\.00\s*บาท/);
    await expect(review.getByText('ยอดที่จ่ายวันนี้', { exact: true })).toHaveCount(1);
    expect(state.log.quotes).toEqual([{ offerKey: 'STARTER_249', interval: 'month', purchaseMode: mode }]);
    expect(state.log.checkoutBodies).toHaveLength(0);
    const buy = page.getByRole('button', { name: /^จ่าย [\d,]+\.\d{2} บาท$/, exact: true });
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
    await expect(page.getByRole('heading', { name: /^จ่าย [\d,]+\.\d{2} บาทแล้ว$/, exact: true })).toBeVisible(AFTER_PRESS);
    await expect(page.getByText('ผลการจ่ายเงินล่าสุด', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'ตรวจผลการจ่ายเงิน', exact: true })).toHaveCount(0);
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
    await page.getByRole('button', { name: 'ดูใบเสร็จรับเงิน', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/billing/invoices/${INVOICE}$`));
    await expect(page.getByRole('heading', { name: /^เริ่มต้น · / })).toBeVisible(AFTER_PRESS);
    await page.route(`**/api/v1/companies/${companyId}/billing/documents/${INVOICE}/open`, route =>
      route.fulfill({ json: { url: `https://invoice.stripe.com/journey-${route.request().postDataJSON().kind}` } }));
    await page.context().route('https://invoice.stripe.com/journey-*', route => route.fulfill({ contentType: 'text/html', body: '<p>เอกสารการจ่ายเงิน</p>' }));
    for (const [name, kind] of [['ใบเสร็จรับเงิน', 'receipt'], ['ใบแจ้งหนี้', 'pdf']]) {
      await page.evaluate(() => { const originalOpen = window.open; window.open = () => { window.open = originalOpen; return null; }; });
      await page.getByRole('button', { name, exact: true }).click();
      const blocked = page.getByRole('alert').filter({ hasText: 'เปิดแท็บเอกสารไม่ได้' });
      await expect(blocked).toContainText('เปิดแท็บเอกสารไม่ได้ อนุญาตหน้าต่างใหม่แล้วกดเอกสารอีกครั้ง');
      await expect(blocked.getByRole('link', { name: 'ติดต่อทีมงานมั่งมี', exact: true })).toHaveCount(0);
      const opened = page.waitForEvent('popup');
      await blocked.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
      const document = await opened;
      await expect(document).toHaveURL(`https://invoice.stripe.com/journey-${kind}`);
      expect(await document.evaluate(() => window.opener === null)).toBe(true);
      await expect(page).toHaveURL(new RegExp(`/billing/invoices/${INVOICE}$`));
      await expect(blocked).toHaveCount(0);
      await document.close();
    }
    await page.getByRole('link', { name: 'กลับไปแพ็กเกจ', exact: true }).click();
    await expectInSight(page.getByRole('heading', { name: 'ประวัติและเอกสารการจ่ายเงิน', exact: true }));
    const paidRow = page.locator('#billing-history').getByRole('link', { name: /^เปิดรายการจ่ายเงิน NOSETUP-0001 · เริ่มต้น · รายเดือน · 249\.00 บาท · .+ · จ่ายแล้ว$/ });
    await expect(paidRow).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'ตรวจผลการจ่ายเงิน', exact: true })).toHaveCount(0);
    await paidRow.focus(); await paidRow.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/billing/invoices/${INVOICE}$`));
    expect(state.log.checkouts).toHaveLength(1);

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
  await expectInSight(page.getByRole('heading', { level: 1, name: 'แพ็กเกจ', exact: true }));
  return { state, chooser: page.getByRole('region', { name: 'เลือกแพ็กเกจ', exact: true }) };
}

// On a phone the sentence is drawn under the fourth package card: below the window and behind the bottom bar.
test('@journey D1 nothing chosen at 390px: เลือกแพ็กเกจก่อน is in sight after the press', async ({ authedPage: page, companyId }) => {
  const { chooser } = await chooserAt(page, companyId, 390, 844);
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expectInSight(chooser.getByRole('alert').filter({ hasText: 'เลือกแพ็กเกจก่อน' }));
  await expectInSight(chooser.getByRole('heading', { name: 'แพ็กเกจ', exact: true }));
});

// Read from the top of a 1556x900 window, the sentence under the four ways lands below the window.
test('@journey D1 a package but no way to pay, from the top at 1556px: เลือกวิธีจ่ายก่อน is in sight after the press', async ({ authedPage: page, companyId }) => {
  const { chooser } = await chooserAt(page, companyId, 1556, 900);
  await page.mouse.move(900, 450); await page.mouse.wheel(0, -4000);
  await chooser.getByRole('radio', { name: 'เลือก เริ่มต้น', exact: true }).check();
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  const methods = page.getByRole('region', { name: 'วิธีจ่าย', exact: true });
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expectInSight(methods.getByRole('alert').filter({ hasText: 'เลือกวิธีจ่ายก่อน' }));
  await expectInSight(methods.locator('legend').filter({ hasText: 'จ่ายแบบไหน' }));
});

// รายเดือน is on and รายปี is off, and the two buttons look the same.
test('@journey D1 chooser at 390px: the cadence that is on can be told from the one that is off', async ({ authedPage: page, companyId }) => {
  const { chooser } = await chooserAt(page, companyId, 390, 844);
  await page.mouse.move(195, 300);
  const look = (name: string) => chooser.getByRole('button', { name, exact: true }).evaluate(el => { const s = getComputedStyle(el); return [s.backgroundColor, s.borderColor, s.color, s.fontWeight, s.boxShadow].join(' | '); });
  await expect(chooser.getByRole('button', { name: 'รายเดือน', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await look('รายเดือน')).not.toBe(await look('รายปี · ฟรี 2 เดือน'));
});

// Regression: the result keeps the same Thai package name as the chooser and review.
test('@journey D1 paid result at 390px: the package keeps the name the chooser gave it', async ({ authedPage: page, companyId }) => {
  const { state, chooser } = await chooserAt(page, companyId, 390, 844);
  await chooser.getByRole('radio', { name: 'เลือก เริ่มต้น', exact: true }).check();
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await chooseBillingMethod(page, 'PROMPTPAY_ONCE');
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await page.getByRole('button', { name: /^จ่าย [\d,]+\.\d{2} บาท$/, exact: true }).click();
  await page.getByRole('link', { name: 'จ่ายจำลอง', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'กำลังรอผลการจ่ายเงิน', exact: true })).toBeVisible(AFTER_PRESS);
  state.stage = 'applied';
  await expect(page.getByRole('heading', { name: /^จ่าย [\d,]+\.\d{2} บาทแล้ว$/, exact: true })).toBeVisible(AFTER_PRESS);
  const result = page.getByRole('region', { name: 'สถานะแพ็กเกจ', exact: true });
  await expect(result).toContainText('เริ่มต้น ใช้ได้ถึง');
  await expect(result.getByRole('link', { name: 'กลับหน้าแรก', exact: true })).toHaveAttribute('href', `/companies/${companyId}/dashboard`);
});

for (const width of [390, 1556]) test(`@journey D1 payment history shows ten rows, truthful states and cursor navigation at ${width}px`, async ({ authedPage: page, companyId }) => {
  test.setTimeout(300_000); await page.setViewportSize({ width, height: 900 });
  const state = defaultState(); state.stage = 'applied'; await installNoSetupRoutes(page, companyId, state);
  const invoices = Array.from({ length: 21 }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, number: `บิล-${index + 1}`, currency: 'THB', amountSatang: 49900,
    offer: { key: 'BASIC_499', label: 'เติบโต', interval: 'month' }, method: 'CARD',
    refundedSatang: index === 3 ? 49900 : index === 4 ? 100 : 0, disputed: index === 5, financialObservedAt: '2026-10-18T00:00:00Z',
    paymentState: index === 6 ? 'open' : 'paid', applyState: index === 1 ? 'PENDING' : index === 2 ? 'HELD' : 'APPLIED',
    periodStart: '2026-10-18T00:00:00Z', periodEnd: '2026-11-18T00:00:00Z', createdAt: new Date(Date.UTC(2026, 9, 18 - index)).toISOString(), hasDocuments: true,
  }));
  const reads: { cursor: string | null; limit: string | null }[] = [];
  await page.route(`**/api/v1/companies/${companyId}/billing/history*`, route => {
    const query = new URL(route.request().url()).searchParams, cursor = query.get('cursor'), limit = query.get('limit'); reads.push({ cursor, limit });
    const start = cursor ? invoices.findIndex(invoice => invoice.id === cursor) + 1 : 0, end = start + Number(limit ?? 20);
    return route.fulfill({ json: { items: invoices.slice(start, end), nextCursor: end < invoices.length ? invoices[end - 1].id : null } });
  });
  await page.goto(`/companies/${companyId}/billing#billing-history`);
  const history = page.getByRole('region', { name: 'ประวัติการจ่ายเงิน', exact: true });
  await expect(history.getByRole('link')).toHaveCount(10);
  if (width === 1556) await expect(history.getByRole('columnheader')).toHaveText(['วันที่', 'แพ็กเกจ', 'ยอด (บาท)', 'สถานะ']);
  for (const text of ['จ่ายแล้ว', 'รอผล', 'คืนเงินแล้ว', 'คืนบางส่วน', 'มีข้อโต้แย้ง', 'กำลังเปิดแพ็กเกจ', 'ทีมงานกำลังตรวจสอบแพ็กเกจ']) await expect(history.getByRole('link').filter({ hasText: text }).first().getByText(text, { exact: true })).toBeVisible();
  await history.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(history.getByText('หน้า 2', { exact: true })).toBeVisible(); await expect(history.getByRole('link')).toHaveCount(10); expect(reads).toEqual([{ cursor: null, limit: '10' }, { cursor: invoices[9].id, limit: '10' }]);
  await history.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(history.getByText('หน้า 3', { exact: true })).toBeVisible(); await expect(history.getByRole('link')).toHaveCount(1);
  await expect(history.getByRole('button', { name: 'ถัดไป', exact: true })).toBeDisabled();
  await history.getByRole('button', { name: 'ก่อนหน้า', exact: true }).click();
  await expect(history.getByText('หน้า 2', { exact: true })).toBeVisible(); await expect(history.getByRole('link')).toHaveCount(10);
  await history.getByRole('button', { name: 'ก่อนหน้า', exact: true }).click();
  await expect(history.getByText('หน้า 1', { exact: true })).toBeVisible(); await expect(history.getByRole('button', { name: 'ก่อนหน้า', exact: true })).toBeDisabled();
  expect(reads).toEqual([null, invoices[9].id, invoices[19].id, invoices[9].id, null].map(cursor => ({ cursor, limit: '10' }))); expect(state.log.checkouts).toHaveLength(0); await expectNoClientError(page);
});
