import { test, expect } from '../harness/fixtures';
import { expectNoClientError } from '../harness/auth';
import { defaultState, installNoSetupRoutes, noSetupStatus } from '../billing-no-setup.fixture';
import { AFTER_PRESS, FIRST_SIGHT, expectInSight, thaiDate } from './journey-kit';

// Approved local proof: billing/provider answers are stood in; session, membership and shell
// stay real. This proves the screen's original-operation commands, not Stripe collection stops.
for (const width of [390, 1556]) for (const mode of ['CARD_AUTO', 'PROMPTPAY_RENEW'] as const) {
  test(`@journey D4 safe close then stop ${mode} at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const state = defaultState(); state.stage = 'applied';
    state.log.quotes.push({ purchaseMode: mode });
    await installNoSetupRoutes(page, companyId, state);
    const base = `/api/v1/companies/${companyId}/billing`;
    const until = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const bill = 'https://invoice.stripe.com/i/test_original_renewal';
    const status: ReturnType<typeof noSetupStatus> = { ...noSetupStatus(companyId, state), termEndsAt: until, paidThrough: until, nextChargeAt: until,
      attemptId: null, renewalInvoiceUrl: mode === 'PROMPTPAY_RENEW' ? bill : null, billingProfile: null };
    let sequence = 0, submits = 0, withdrawals = 0;
    let operation: null | { id: string; companyId: string; action: string; state: string; version: number; previewHash: string; effectiveAt: string; nextRenewalTotalSatang: number; expiresAt: string; observedAt: string | null; errorCode: null; allowedActions: string[] } = null;
    await page.route('**/api/v1/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === base && req.method() === 'GET') return route.fulfill({ json: status });
      if (path === `${base}/collection/preview`) {
        expect(req.postDataJSON()).toEqual({ action: 'CANCEL_RENEWAL' });
        operation = { id: `stop-${++sequence}`, companyId, action: 'CANCEL_RENEWAL', state: 'PREVIEW', version: 1,
          previewHash: 'same-preview-hash', effectiveAt: until, nextRenewalTotalSatang: 24900, expiresAt: new Date(Date.now() + 600_000).toISOString(), observedAt: null, errorCode: null, allowedActions: ['submit', 'withdraw'] };
        return route.fulfill({ json: operation });
      }
      if (operation && path === `${base}/collection/${operation.id}/withdraw`) {
        expect(req.postDataJSON()).toEqual({ expectedVersion: 1 }); withdrawals++;
        operation = { ...operation, state: 'CANCELLED', allowedActions: [] }; return route.fulfill({ json: operation });
      }
      if (operation && path === `${base}/collection/${operation.id}/submit`) {
        expect(req.postDataJSON()).toEqual({ expectedVersion: 1, previewHash: operation.previewHash, accepted: true });
        expect(req.headers()['idempotency-key']).toBe(`billing-collection-${operation.id}`); submits++;
        operation = { ...operation, state: 'QUEUED', allowedActions: [] }; return route.fulfill({ json: operation });
      }
      if (operation && path === `${base}/collection/${operation.id}`) {
        if (operation.state === 'QUEUED') {
          operation = { ...operation, state: 'SUCCEEDED', observedAt: new Date().toISOString() };
          status.cancelAtPeriodEnd = true; status.nextChargeAt = null; status.observedAt = operation.observedAt;
        }
        return route.fulfill({ json: operation });
      }
      return route.fallback();
    });
    await page.route(bill, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>บิลพร้อมเพย์เดิม (จำลอง)</h1>' }));
    const read = () => page.evaluate(async id => (await fetch(`/api/v1/companies/${id}/billing`)).json(), companyId);
    const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.goto(`/companies/${companyId}/billing`);
    await expect(page.getByRole('heading', { name: 'แพ็กเกจปัจจุบัน', exact: true })).toBeVisible(FIRST_SIGHT);
    const before = await read();
    await page.getByRole('button', { name: 'การต่ออายุและจ่ายเงิน', exact: true }).click();
    const panel = page.getByRole('region', { name: 'จัดการการต่ออายุ', exact: true });
    const entry = mode === 'CARD_AUTO' ? 'หยุดต่ออายุอัตโนมัติ' : 'หยุดออกบิล';
    await panel.getByRole('button', { name: entry, exact: true }).click();
    const question = panel.getByRole('status').filter({ hasText: mode === 'CARD_AUTO' ? 'หยุดต่ออายุอัตโนมัติ?' : 'หยุดออกบิลพร้อมเพย์ทุกงวด?' });
    await expect(question).toBeVisible(AFTER_PRESS);
    await expect(panel).toContainText(`ใช้แพ็กเกจที่จ่ายไว้ได้ถึง ${thaiDate(new Date(until))} การหยุดต่ออายุไม่คืนเงิน`);
    await panel.getByRole('button', { name: 'ปิด', exact: true }).click();
    await expect(panel.getByRole('status')).toHaveCount(0);
    await expect(panel).not.toContainText('ไม่คืนเงิน');
    await expect(panel).not.toContainText('ถอนคำขอ');
    expect(withdrawals).toBe(1); expect(submits).toBe(0); expect(await read()).toEqual(before);
    await panel.getByRole('button', { name: entry, exact: true }).click();
    await panel.getByRole('button', { name: mode === 'CARD_AUTO' ? 'หยุดต่ออายุ' : 'หยุดออกบิล', exact: true }).click();
    await expect(panel.getByRole('status')).toHaveText(mode === 'CARD_AUTO' ? 'กำลังตรวจผลการหยุดต่ออายุ' : 'กำลังตรวจผลการหยุดออกบิล');
    await panel.getByRole('button', { name: mode === 'CARD_AUTO' ? 'ตรวจผลการต่ออายุ' : 'ตรวจผลการออกบิล', exact: true }).click();
    await expect(panel.getByRole('status')).toHaveText(mode === 'CARD_AUTO' ? 'หยุดต่ออายุแล้ว' : 'หยุดออกบิลแล้ว', AFTER_PRESS);
    const after = await read();
    expect(after).toMatchObject({ cancelAtPeriodEnd: true, nextChargeAt: null, paidThrough: before.paidThrough, termEndsAt: before.termEndsAt, usage: before.usage, renewalInvoiceUrl: before.renewalInvoiceUrl });
    expect(submits).toBe(1); expect(state.log.checkouts).toHaveLength(0);
    await fits(); await page.screenshot({ path: info.outputPath(`stop-${mode}-${width}.png`), fullPage: true });
    if (mode === 'PROMPTPAY_RENEW') {
      await expect(panel).toContainText('หยุดเฉพาะบิลรอบถัดไป บิลที่ออกแล้วเปิดจ่ายได้ที่ เปิดบิลพร้อมเพย์');
      await page.getByRole('button', { name: 'เปิดบิลพร้อมเพย์', exact: true }).click();
      await expect(page).toHaveURL(bill); await expectInSight(page.getByRole('heading', { name: 'บิลพร้อมเพย์เดิม (จำลอง)' }));
    }
    await expectNoClientError(page);
  });
}
