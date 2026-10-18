import { test, expect } from '../harness/fixtures';
import { expectNoClientError } from '../harness/auth';
import { ATTEMPT, defaultState, installNoSetupRoutes, noSetupStatus } from '../billing-no-setup.fixture';
import { billingOffer, type BillingPurchaseMode, type BillingQuote } from '@watchdog-bms/contracts';
import type { Page } from '@playwright/test';
import { AFTER_PRESS, FIRST_SIGHT, expectInSight, thaiDate } from './journey-kit';

// Approved local proof: extend the existing provider-dependent stand-in. Session, membership,
// shell and other reads stay real. These assertions do not prove a persisted grant or real payment.
async function repeatShop(page: Page, companyId: string, mode: BillingPurchaseMode = 'PROMPTPAY_ONCE', interval: 'month' | 'year' = 'month', issuedBill = false) {
  const state = defaultState(), previous = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const added = interval === 'year' ? 365 : 30;
  const projected = new Date(Date.parse(previous) + added * 86_400_000).toISOString();
  const offer = billingOffer('STARTER_249', interval), originalBill = 'https://invoice.stripe.com/i/test_original_renewal';
  await installNoSetupRoutes(page, companyId, state);
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const base = `/api/v1/companies/${companyId}/billing`, applied = state.stage === 'applied';
    if (request.method() === 'GET' && path === '/api/v1/plan-term/notice') return route.fulfill({ json: {
      derivedState: applied ? 'ACTIVE' : 'WARNING', daysLeft: applied ? added + 3 : 3, termEndsAt: applied ? projected : previous, isOwner: true, canManagePlan: true,
    } });
    if (request.method() === 'GET' && path === base) return route.fulfill({ json: {
      ...noSetupStatus(companyId, state), accessState: 'ACTIVE', lockReason: undefined,
      purchaseSource: 'PAID_CURRENT_MODE', tierKey: 'STARTER_249', interval, renewalMode: mode,
      subscriptionState: mode === 'CARD_AUTO' || mode === 'PROMPTPAY_RENEW' ? 'active' : 'NONE',
      termEndsAt: applied ? projected : previous, paidThrough: applied ? projected : previous,
      nextChargeAt: mode === 'CARD_AUTO' || mode === 'PROMPTPAY_RENEW' ? applied ? projected : previous : null,
      ...(issuedBill ? { renewalInvoiceUrl: originalBill, renewalInvoiceDueAt: previous } : {}),
      usage: { used: 0, limit: applied ? 7 + offer.receiptAllowance : 7, remaining: applied ? 7 + offer.receiptAllowance : 7, cadence: 'PAID_GRANTS', resetsAt: null, expiresAt: applied ? projected : previous },
    } });
    if (request.method() === 'GET' && path === `${base}/history`) return route.fulfill({ json: { items: applied ? [{
      offer: { key: offer.offerKey, label: 'เริ่มต้น', interval }, method: mode.startsWith('CARD') ? 'CARD' : 'PROMPTPAY', id: '22222222-2222-4222-8222-222222222222', number: 'REPEAT-0001', currency: 'THB', amountSatang: offer.priceSatang,
      refundedSatang: 0, disputed: false, financialObservedAt: new Date().toISOString(), paymentState: 'PAID', applyState: 'APPLIED',
      periodStart: previous, periodEnd: projected, createdAt: new Date().toISOString(), hasDocuments: false,
    }] : [], nextCursor: null } });
    if (request.method() === 'POST' && path === `${base}/quote`) {
      const body = request.postDataJSON(); state.log.quotes.push(body);
      const chosen = billingOffer(body.offerKey, body.interval);
      const quote: BillingQuote = {
        quoteId: 'q-repeat', companyId, companyName: 'ร้านทดสอบต่ออายุ', policyRevision: 'policy-nosetup', expiresAt: new Date(Date.now() + 600_000).toISOString(),
        purchaseMode: body.purchaseMode, offer: { ...chosen, availability: 'AVAILABLE', reason: null }, subtotalSatang: chosen.priceSatang,
        taxSatang: 0, totalSatang: chosen.priceSatang, taxTreatment: 'NOT_VAT_REGISTERED', consentRevision: 'billing-v2', paidStart: 'IMMEDIATE', billingEmail: noSetupStatus(companyId, state).recipient?.email ?? null,
        trialEndsAt: null, usage: noSetupStatus(companyId, state).usage,
        purchase: { kind: 'REPEAT', previousInterval: interval, previousPaidThrough: previous, projectedPaidThrough: projected, receiptUnitsAdded: chosen.receiptAllowance, projectedRemainingReceipts: 7 + chosen.receiptAllowance },
      };
      return route.fulfill({ json: quote });
    }
    return route.fallback();
  });
  return { state, previous, projected, offer, originalBill };
}

async function openSidebar(page: Page) {
  const aside = page.locator('aside'), opener = page.locator('header').getByRole('button', { name: 'สลับเมนู', exact: true });
  // Wide: the menu shows once the page is drawn; phone: the three-line button instead. Wait for either:
  // an instant isVisible() right after goto raced the first paint at 1556 and then waited forever on a button that is lg:hidden.
  await expect(async () => { expect((await aside.isVisible()) || (await opener.isVisible())).toBe(true); }).toPass(FIRST_SIGHT);
  if (!await aside.isVisible()) await opener.click();
  await expect(aside).toBeVisible(FIRST_SIGHT);
}
const noSidewaysScroll = async (page: Page, width: number) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

for (const width of [390, 1556]) for (const interval of ['month', 'year'] as const) {
  test(`@journey D3 reminder to one same-package extension, ${interval} at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const { state, previous, projected, offer } = await repeatShop(page, companyId, 'PROMPTPAY_ONCE', interval);
    await page.goto(`/companies/${companyId}/settings`);
    await openSidebar(page);
    const reminder = page.locator('[data-plan-term="warning"]');
    await expect(reminder.locator('span')).toHaveText('เหลืออีก 3 วัน');
    await expect(reminder.getByRole('link')).toHaveCount(1);
    await expect(reminder.locator('[aria-expanded], [role="progressbar"]')).toHaveCount(0);
    await reminder.getByRole('link', { name: 'ต่ออายุ', exact: true }).click();
    await expectInSight(page.getByRole('heading', { level: 2, name: 'ตรวจก่อนจ่าย', exact: true }));
    await expect(page.getByRole('region', { name: 'เลือกแพ็กเกจ', exact: true })).toHaveCount(0);
    expect(state.log.quotes).toHaveLength(1);
    expect(state.log.quotes[0]).toMatchObject({ offerKey: 'STARTER_249', interval, purchaseMode: 'PROMPTPAY_ONCE' });
    await noSidewaysScroll(page, width);
    const review = page.getByRole('region', { name: 'ตรวจก่อนจ่าย', exact: true });
    const fact = (name: string) => review.locator('dl > div').filter({ has: page.locator('dt', { hasText: name }) }).locator('dd');
    await expect(fact('อ่านใบเสร็จได้เพิ่ม')).toHaveText(`${offer.receiptAllowance} ใบ`);
    await expect(fact('ใช้ได้ถึง')).toHaveText(`${thaiDate(new Date(previous))} → ${thaiDate(new Date(projected))}`);
    await expectInSight(fact('อ่านใบเสร็จได้เพิ่ม')); await expectInSight(fact('ใช้ได้ถึง'));
    await expect(review.getByRole('checkbox')).toHaveCount(0);
    await expect(review).not.toContainText('ตัดบัตรครั้งถัดไป'); await expect(review).not.toContainText('ออกบิลครั้งถัดไป');
    await expect(page.locator('[data-form-action-bar]')).toContainText('กดจ่าย คือยอมรับแพ็กเกจ ยอดเงิน และเงื่อนไขที่แสดง');
    await noSidewaysScroll(page, width);
    await page.screenshot({ path: info.outputPath(`repeat-${interval}-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: /^จ่าย [\d,]+\.\d{2} บาท$/, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Stripe (จำลอง)', exact: true })).toBeVisible(AFTER_PRESS);
    expect(state.log.checkoutBodies).toEqual([{ quoteId: 'q-repeat', consentRevision: 'billing-v2', accepted: true, channel: 'web' }]);
    await page.getByRole('link', { name: 'จ่ายจำลอง', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'กำลังรอผลการจ่ายเงิน', exact: true })).toBeVisible(AFTER_PRESS);
    state.stage = 'applied';
    await expect(page.getByRole('heading', { name: /^จ่าย [\d,]+\.\d{2} บาทแล้ว$/, exact: true })).toBeVisible(AFTER_PRESS);
    const status = await page.evaluate(async id => (await fetch(`/api/v1/companies/${id}/billing`)).json(), companyId);
    expect(status).toMatchObject({ attemptId: ATTEMPT, applyState: 'APPLIED', paidThrough: projected, usage: { remaining: 7 + offer.receiptAllowance } });
    expect(state.log.checkouts).toHaveLength(1); expect(state.log.quotes).toHaveLength(1);
    const history = await page.evaluate(async id => (await fetch(`/api/v1/companies/${id}/billing/history`)).json(), companyId);
    expect(history.items).toHaveLength(1); expect(history.items[0]).toMatchObject({ amountSatang: offer.priceSatang, periodStart: previous, periodEnd: projected });
    await expect(page.getByRole('region', { name: 'สถานะแพ็กเกจ', exact: true })).toContainText(thaiDate(new Date(projected)));
    await noSidewaysScroll(page, width); await expectNoClientError(page);
  });

  test(`@journey D3 original QR renewal bill in one press at ${width}px (${interval})`, async ({ authedPage: page, companyId }) => {
    test.setTimeout(300_000); await page.setViewportSize({ width, height: 900 });
    const { state, originalBill } = await repeatShop(page, companyId, 'PROMPTPAY_RENEW', interval, true);
    await page.route(originalBill, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>บิลพร้อมเพย์เดิม (จำลอง)</h1>' }));
    await page.goto(`/companies/${companyId}/billing`);
    await expect(page.getByText('มีบิลต่ออายุรอจ่าย', { exact: false }).first()).toBeVisible(FIRST_SIGHT);
    await expect(page.getByRole('button', { name: /^ต่ออายุ .*บาท$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'จ่ายบิลงวดนี้', exact: true })).toBeVisible();
    await noSidewaysScroll(page, width);
    await page.getByRole('button', { name: 'จ่ายบิลงวดนี้', exact: true }).click();
    await expect(page).toHaveURL(originalBill);
    await expect(page.getByRole('heading', { name: 'บิลพร้อมเพย์เดิม (จำลอง)', exact: true })).toBeVisible();
    expect(state.log.quotes).toHaveLength(0); expect(state.log.checkouts).toHaveLength(0);
  });
}

for (const width of [390, 1556]) test(`@journey D3 active card renewal has no buy-days reminder at ${width}px`, async ({ authedPage: page, companyId }) => {
  test.setTimeout(300_000); await page.setViewportSize({ width, height: 900 });
  await repeatShop(page, companyId, 'CARD_AUTO');
  const read = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/companies/${companyId}/billing`, AFTER_PRESS);
  // On a phone the reminder (and its billing read) is drawn only once the menu is open: open it first, then wait for the read.
  await page.goto(`/companies/${companyId}/settings`); await openSidebar(page); await read;
  await expect(page.locator('[data-plan-term="warning"]')).toHaveCount(0);
  await noSidewaysScroll(page, width); await expectNoClientError(page);
});

for (const width of [390, 1556]) test(`@journey D3 yearly card shop explicitly changes with current choices prefilled at ${width}px`, async ({ authedPage: page, companyId }) => {
  test.setTimeout(300_000); await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const { state, previous } = await repeatShop(page, companyId, 'CARD_AUTO', 'year');
  await page.goto(`/companies/${companyId}/billing`);
  await page.getByRole('button', { name: 'เปลี่ยนแพ็กเกจ', exact: true }).click();
  await expectInSight(page.getByRole('heading', { level: 1, name: 'แพ็กเกจ', exact: true }));
  const chooser = page.getByRole('region', { name: 'เลือกแพ็กเกจ', exact: true });
  await expect(chooser.getByRole('button', { name: 'รายปี · ฟรี 2 เดือน', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await chooser.getByRole('button', { name: 'รายเดือน', exact: true }).click();
  await expect(chooser.getByRole('button', { name: 'รายเดือน', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await chooser.getByRole('radio', { name: 'เลือก เริ่มต้น', exact: true }).check();
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  const methods = page.getByRole('region', { name: 'วิธีจ่าย', exact: true });
  await expect(methods.getByRole('radio', { name: 'ต่ออายุอัตโนมัติ', exact: true })).toBeChecked();
  await expect(methods.getByRole('radio', { name: 'บัตร', exact: true })).toBeChecked();
  await noSidewaysScroll(page, width);
  expect(state.log.quotes).toHaveLength(0); expect(state.log.checkouts).toHaveLength(0);
  const status = await page.evaluate(async id => (await fetch(`/api/v1/companies/${id}/billing`)).json(), companyId);
  expect(status).toMatchObject({ interval: 'year', renewalMode: 'CARD_AUTO', paidThrough: previous });
  await expectNoClientError(page);
});

for (const width of [390, 1556]) test(`@journey PAY-1 existing payment, history and recipient hashes scroll the one page at ${width}px`, async ({ authedPage: page, companyId }) => {
  test.setTimeout(300_000); await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const { state } = await repeatShop(page, companyId, 'PROMPTPAY_ONCE'); state.stage = 'applied';
  await page.goto(`/companies/${companyId}/billing#billing-payment`);
  const renewal = page.getByRole('region', { name: 'การต่ออายุ', exact: true });
  await expectInSight(renewal.getByRole('heading', { name: 'การต่ออายุ', exact: true }));
  await expect(page.getByRole('region', { name: 'สถานะแพ็กเกจ', exact: true })).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'ประวัติการจ่ายเงิน', exact: true })).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'หมวดแพ็กเกจและการจ่ายเงิน', exact: true })).toHaveCount(0);
  await page.evaluate(() => { window.location.hash = 'billing-history'; });
  await expectInSight(page.getByRole('heading', { name: 'ประวัติและเอกสารการจ่ายเงิน', exact: true }));
  await page.evaluate(() => { window.location.hash = 'billing-recipient'; });
  const recipient = page.getByRole('region', { name: 'ผู้รับเอกสารของร้าน', exact: true });
  await expectInSight(recipient.getByRole('heading', { name: 'อีเมลรับเอกสาร', exact: true }));
  await expect(recipient.getByRole('radio', { name: 'ใช้อีเมลอื่น', exact: true })).toBeVisible();
  expect(state.log.quotes).toHaveLength(0); expect(state.log.checkouts).toHaveLength(0);
  await recipient.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await page.getByRole('button', { name: 'ต่ออายุ 249.00 บาท', exact: true }).click();
  const review = page.getByRole('region', { name: 'ตรวจก่อนจ่าย', exact: true });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'แก้อีเมลรับเอกสาร', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(recipient.getByRole('radio', { name: 'ใช้อีเมลอื่น', exact: true })).toBeVisible();
  await recipient.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await page.getByRole('button', { name: 'กลับไปจ่าย', exact: true }).click();
  await expectInSight(review.getByRole('heading', { name: 'ตรวจก่อนจ่าย', exact: true }));
  expect(state.log.quotes).toHaveLength(1); expect(state.log.checkouts).toHaveLength(0);
  await noSidewaysScroll(page, width); await expectNoClientError(page);
});

for (const width of [390, 1280, 1556]) for (const [code, sentence] of [
  ['BILLING_NOT_READY', 'ยังไม่เปิดรับเงินใหม่ ติดต่อทีมงาน'],
  ['BILLING_COMPANY_SALES_CLOSED', 'ร้านนี้ยังซื้อหรือเปลี่ยนแพ็กเกจผ่านเว็บไม่ได้ ติดต่อทีมงาน'],
  ['BILLING_MODE_NOT_READY', 'วิธีจ่ายที่เลือกยังใช้ไม่ได้ เลือกวิธีอื่นหรือติดต่อทีมงาน'],
] as const) test(`@journey PAY-3 ${code} gives contact exits and one refusal at ${width}px`, async ({ authedPage: page, companyId }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width, height: 900 });
  const state = defaultState();
  await installNoSetupRoutes(page, companyId, state);
  await page.route(`**/api/v1/companies/${companyId}/billing`, route => route.request().method() !== 'GET' ? route.fallback() : route.fulfill({ json: {
    ...noSetupStatus(companyId, state), purchaseBlockCode: code, allowedActions: [], attemptId: null,
    purchaseEligibility: code === 'BILLING_COMPANY_SALES_CLOSED' ? 'COMPANY_SALES_CLOSED' : 'ELIGIBLE',
  } }));
  await page.goto(`/companies/${companyId}/billing`);
  const refusal = page.getByRole('alert').filter({ hasText: sentence });
  await expect(refusal).toHaveCount(1, FIRST_SIGHT);
  await expect(page.getByText(sentence, { exact: true })).toHaveCount(1);
  const phone = refusal.getByRole('link', { name: '098-256-5628', exact: true });
  const email = refusal.getByRole('link', { name: 'contact@mangmeeplus.com', exact: true });
  await expectInSight(phone); await expect(phone).toHaveAttribute('href', 'tel:0982565628');
  await expectInSight(email); await expect(email).toHaveAttribute('href', 'mailto:contact@mangmeeplus.com');
  await expect(refusal).not.toContainText('กรุณา');
  await refusal.getByRole('button', { name: 'ตรวจสถานะล่าสุด', exact: true }).click();
  await expect(refusal).toBeVisible(AFTER_PRESS);
  await expect(page.getByText(sentence, { exact: true })).toHaveCount(1);
  expect(state.log.quotes).toHaveLength(0); expect(state.log.checkouts).toHaveLength(0);
  await noSidewaysScroll(page, width);
  await expectNoClientError(page);
});
