import { test, expect } from './harness/fixtures';
import { chooseBillingMethod } from './billing-no-setup.fixture';

const startsAt = '2030-03-05T12:00:00.000Z';
const firstCycleEndsAt = '2030-04-05T12:00:00.000Z';
const offerExpiresAt = '2030-02-01T00:00:00.000Z';

for (const purchaseMode of ['CARD_AUTO', 'PROMPTPAY_RENEW'] as const) {
  test(`BILLING-ADVANCE @p1 one-time customer pays ${purchaseMode} deal now and activates it at the old term boundary`, async ({ authedPage: page, companyId }) => {
    const base = `/api/v1/companies/${encodeURIComponent(companyId)}/billing`;
    const quotes: Array<{ dealId?: string; purchaseMode?: string }> = [];
    const checkoutKeys: string[] = [];
    const providerChargeKeys = new Set<string>();
    let quoteCount = 0;
    let stage: 'idle' | 'paid' | 'binding' | 'active' = 'idle';

    const makeStatus = () => {
      const oldTerm = {
        companyId, companyName: 'ร้านตัวอย่าง', mode: 'TEST', policyRevision: 'policy-advance',
        paymentState: 'PAID', applyState: 'APPLIED', purchaseEligibility: 'ELIGIBLE', purchaseSource: 'PAID_CURRENT_MODE',
        renewalMode: 'CARD_ONCE', enabledPurchaseModes: ['CARD_ONCE', 'PROMPTPAY_ONCE'], availablePurchaseModes: ['CARD_ONCE', 'PROMPTPAY_ONCE'],
        accessState: 'ACTIVE', subscriptionState: 'NONE', documentState: 'NONE', attemptId: null, reference: null, observedAt: null,
        tierKey: 'BASIC_499', interval: 'month', termEndsAt: startsAt, paidThrough: startsAt, nextChargeAt: null,
        cancelAtPeriodEnd: false, graceEndsAt: null, allowedActions: ['new_sales'],
        usage: { used: 12, limit: 100, remaining: 88, cadence: 'PAID_GRANTS', resetsAt: null, expiresAt: startsAt },
        billingProfile: { name: 'ร้านตัวอย่าง', nameSource: 'SHOP', missingFields: [], address: {
          line1: '1 ถนนสุขุมวิท', line2: null, subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110',
        } },
        deal: { dealId: 'deal-advance-1', base: 'PRO_999', baseLabel: 'มืออาชีพ (PRO) · ข้อเสนอพิเศษ', priceSatang: 59900,
          months: 1, offerExpiresAt, purchaseModes: ['CARD_AUTO', 'PROMPTPAY_RENEW'], branchLimit: 5, employeeLimit: 10,
          monthlySlipLimit: 100, featureKeys: ['expenses'], aiMonthlyBudgetSatang: 80000, creditScope: 'CHAT', description: 'ราคาพิเศษ',
          autoRenew: true, cadence: 'month', cycles: 3 },
      };

      if (stage === 'idle') return oldTerm;
      if (stage === 'paid' || stage === 'binding') return {
        ...oldTerm, paymentState: 'PAID', applyState: 'PENDING', attemptId: 'advance-attempt-1', reference: 'ADVANCE-001',
        allowedActions: [], deal: undefined,
        pendingDeal: { dealId: 'deal-advance-1', purchaseMode, state: stage === 'paid' ? 'PAID' : 'PENDING_BINDING', startsAt, firstCycleEndsAt, nextChargeAt: firstCycleEndsAt },
      };
      return {
        ...oldTerm, renewalMode: purchaseMode, enabledPurchaseModes: [purchaseMode], availablePurchaseModes: [purchaseMode],
        paymentState: 'PAID', applyState: 'APPLIED', attemptId: 'advance-attempt-1', reference: 'ADVANCE-001',
        tierKey: 'PRO_999', termEndsAt: firstCycleEndsAt, paidThrough: firstCycleEndsAt, nextChargeAt: firstCycleEndsAt,
        subscriptionState: purchaseMode === 'CARD_AUTO' ? 'active' : 'NONE', allowedActions: ['new_sales'], deal: undefined, pendingDeal: undefined,
      };
    };

    const quote = (mode: string) => ({
      quoteId: 'quote-advance-1', companyId, companyName: 'ร้านตัวอย่าง', policyRevision: 'policy-advance',
      expiresAt: '2030-01-01T00:00:00.000Z', purchaseMode: mode,
      offer: { offerKey: 'PRO_999', interval: 'month', intervalCount: 1, label: 'มืออาชีพ (PRO)', priceSatang: 59900,
        currency: 'THB', branchLimit: 5, employeeLimit: 10, monthlySlipLimit: 100, receiptAllowance: 100,
        receiptAllowanceCadence: 'PAID_PERIOD', featureKeys: ['expenses'], availability: 'AVAILABLE', reason: null },
      subtotalSatang: 59900, taxSatang: 0, totalSatang: 59900, taxTreatment: 'NOT_VAT_REGISTERED', consentRevision: 'billing-v2',
      paidStart: 'IMMEDIATE', billingEmail: 'owner@example.test', trialEndsAt: null,
      usage: { used: 12, limit: 100, remaining: 88, cadence: 'PAID_GRANTS', resetsAt: null, expiresAt: startsAt },
      previousSource: 'PAID_CURRENT_MODE', previousTermEndsAt: startsAt,
      deal: { dealId: 'deal-advance-1', months: 1, description: 'ราคาพิเศษ', baseLabel: 'มืออาชีพ (PRO) · ข้อเสนอพิเศษ' },
      advanceDeal: { startsAt, firstCycleEndsAt, nextChargeAt: firstCycleEndsAt },
      featureImpact: { removed: [], added: [{ featureKey: 'inventory', labelTh: 'สินค้าและสต๊อก' }], preservedAdmin: 0 },
    });

    await page.route('**/api/v1/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === base && request.method() === 'GET') return route.fulfill({ json: makeStatus() });
      if (url.pathname === '/api/v1/billing/catalog' && request.method() === 'GET') return route.fulfill({ json: {
        schemaVersion: 1, mode: 'TEST', policyRevision: 'policy-advance', catalogRevision: 'catalog-advance',
        generatedAt: '2030-01-01T00:00:00.000Z', validUntil: '2030-12-31T00:00:00.000Z', taxTreatment: 'NOT_VAT_REGISTERED',
        offers: [], aiMonthlyBudgetSatang: 80000,
      } });
      if (url.pathname === `${base}/history` && request.method() === 'GET') return route.fulfill({ json: { items: [], nextCursor: null } });
      if (url.pathname === `${base}/recipient` && request.method() === 'GET') return route.fulfill({ json: { email: null, hasCustomer: false, operation: null } });
      if (url.pathname === `${base}/quote` && request.method() === 'POST') {
        const body = request.postDataJSON();
        quotes.push({ dealId: body.dealId, purchaseMode: body.purchaseMode });
        if (++quoteCount === 1) return route.fulfill({ status: 409, json: { code: 'BILLING_QUOTE_STALE', message: 'source changed' } });
        return route.fulfill({ json: quote(body.purchaseMode) });
      }
      if (url.pathname === `${base}/checkout` && request.method() === 'POST') {
        const key = request.headers()['idempotency-key'] ?? '';
        checkoutKeys.push(key);
        if (key) providerChargeKeys.add(key); // provider accepted the first request, though its reply is lost
        if (checkoutKeys.length === 1) return route.fulfill({ status: 503, json: { code: 'BILLING_PROVIDER_UNAVAILABLE', message: 'temporary provider outage' } });
        stage = 'paid';
        return route.fulfill({ json: { attemptId: 'advance-attempt-1', state: 'PENDING', checkoutUrl: null } });
      }
      return route.continue();
    });

    await page.goto(`/companies/${companyId}/billing`);
    await expect(page.getByRole('region', { name: 'สถานะแพ็กเกจ' })).toContainText('เติบโต');
    await page.getByRole('button', { name: 'เปลี่ยนแพ็กเกจ', exact: true }).click();
    const dealCard = page.getByRole('region', { name: 'ข้อเสนอพิเศษสำหรับร้านคุณ', exact: true });
    await expect(dealCard).toBeVisible();
    await dealCard.getByRole('button', { name: 'เลือกข้อเสนอนี้', exact: true }).click();
    await chooseBillingMethod(page, purchaseMode);
    await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'รายการหมดอายุหรือข้อมูลเปลี่ยน' })).toBeVisible();
    await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    const methods = page.getByRole('region', { name: 'วิธีจ่าย', exact: true });
    await methods.getByRole('checkbox', { name: purchaseMode === 'CARD_AUTO' ? 'ยอมรับการตัดบัตรอัตโนมัติทุกเดือน' : 'ยอมรับการออกบิลพร้อมเพย์ทุกเดือน', exact: true }).check();
    await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    const review = page.getByRole('region', { name: 'ตรวจก่อนจ่าย', exact: true });
    await expect(review.getByRole('region', { name: 'กำหนดการเริ่มดีลล่วงหน้า', exact: true })).toBeVisible();
    // R-A11: the quote names the address the documents already go to.
    await expect(review.getByLabel('ข้อมูลออกเอกสาร')).toContainText('owner@example.test');
    const shownStart = await page.evaluate(value => new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }), startsAt);
    const shownEnd = await page.evaluate(value => new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }), firstCycleEndsAt);
    await expect(review).toContainText(`จ่ายดีลงวดแรกวันนี้ · สิทธิ์แพ็กเกจปัจจุบันยังใช้ได้ถึง ${shownStart}`);
    await expect(review).toContainText(shownEnd);
    await expect(review).toContainText(purchaseMode === 'PROMPTPAY_RENEW' ? 'ออกบิล QR รอบถัดไป' : 'เก็บเงินรอบถัดไป');
    await expect(review).toContainText('สิทธิ์และจำนวนใบเสร็จของดีลจะเริ่มในวันเริ่มสิทธิ์ดีล');
    await expect(review).not.toContainText('สิทธิ์หลังจ่ายสำเร็จ');
    expect(quotes).toEqual([
      { dealId: 'deal-advance-1', purchaseMode },
      { dealId: 'deal-advance-1', purchaseMode },
    ]);

    const checkout = page.getByRole('button', { name: 'จ่าย 599.00 บาท', exact: true });
    await checkout.click();
    await expect(page.getByRole('alert').filter({ hasText: 'บริการที่จำเป็นยังไม่พร้อมใช้งาน' })).toBeVisible();
    await expect(checkout).toBeEnabled();
    await checkout.click();

    const pendingDeal = page.getByRole('status', { name: 'สถานะดีลล่วงหน้า', exact: true });
    await expect(pendingDeal).toBeVisible();
    await expect(pendingDeal).toContainText('จ่ายดีลแล้ว รอเริ่มสิทธิ์');
    await expect(pendingDeal).toContainText(`สิทธิ์แพ็กเกจปัจจุบันยังใช้ได้ถึง ${shownStart}`);
    await expect(pendingDeal).toContainText(`งวดแรกสิ้นสุด ${shownEnd}`);
    await expect(pendingDeal).toContainText(purchaseMode === 'PROMPTPAY_RENEW' ? 'ออกบิล QR รอบถัดไป' : 'ตัดบัตรรอบถัดไป');
    let current = page.getByRole('region', { name: 'สถานะแพ็กเกจ', exact: true });
    await expect(current).toContainText('เติบโต');
    await expect(current).toContainText(shownStart);

    expect(checkoutKeys).toHaveLength(2);
    expect(checkoutKeys[0]).toBeTruthy();
    expect(checkoutKeys[1]).toBe(checkoutKeys[0]);
    expect(providerChargeKeys.size).toBe(1);

    stage = 'binding';
    await page.reload();
    await expect(page.getByRole('status', { name: 'สถานะดีลล่วงหน้า', exact: true })).toContainText('กำลังยืนยันการต่ออายุ');
    current = page.getByRole('region', { name: 'สถานะแพ็กเกจ', exact: true });
    await expect(current).toContainText('เติบโต');
    await expect(current).toContainText(shownStart);

    stage = 'active';
    await page.reload();
    await expect(page.getByRole('region', { name: 'สถานะแพ็กเกจ', exact: true })).toContainText('มืออาชีพ');
    await expect(page.getByRole('status', { name: 'สถานะดีลล่วงหน้า', exact: true })).toHaveCount(0);
    await expect(page.getByText(purchaseMode === 'PROMPTPAY_RENEW' ? `ระบบจะออกบิล QR วันที่ ${shownEnd}` : `ตัดบัตรอัตโนมัติ ${shownEnd}`, { exact: true })).toHaveCount(1);
    expect(checkoutKeys).toHaveLength(2); // page refreshes only read the paid attempt; they never submit it again
  });
}
