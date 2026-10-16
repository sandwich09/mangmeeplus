import { test, expect } from '../harness/fixtures';
import { expectNoClientError } from '../harness/auth';
import { ATTEMPT, defaultState, installNoSetupRoutes, noSetupStatus } from '../billing-no-setup.fixture';
import { AFTER_PRESS, FIRST_SIGHT, expectInSight } from './journey-kit';

// Billing/provider answers are local stand-ins, as approved in D0; no real charge, webhook or
// grant is proved here. The same attempt id is retained across every check/resume/end press.
for (const width of [390, 1556]) {
  test(`@journey D5 leave checkout, check and resume original, then end unpaid in one press at ${width}px`, async ({ authedPage: page, companyId }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const state = defaultState(); await installNoSetupRoutes(page, companyId, state);
    const base = `/api/v1/companies/${companyId}/billing`;
    let checks = 0, resumes = 0;
    await page.route('**/api/v1/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === `${base}/refresh` && request.method() === 'POST') { checks++; return route.fulfill({ status: 202, json: { queued: true } }); }
      if (path === `${base}/attempts/${ATTEMPT}/resume`) {
        resumes++; expect(request.postDataJSON()).toEqual({});
        return route.fulfill({ json: { attemptId: ATTEMPT, state: 'OPEN', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_nosetup' } });
      }
      return route.fallback();
    });
    await page.goto(`/companies/${companyId}/billing`);
    await expect(page.getByRole('heading', { name: 'ยังไม่มีแพ็กเกจ', exact: true })).toBeVisible(FIRST_SIGHT);
    await page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).click();
    await page.getByRole('radio', { name: 'เลือก เริ่มต้น', exact: true }).check();
    await page.getByRole('radio', { name: 'บัตร · จ่ายครั้งเดียว', exact: true }).check();
    await page.getByRole('button', { name: 'ดูยอดที่ต้องจ่าย', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ตรวจก่อนจ่าย', exact: true })).toBeVisible(AFTER_PRESS);
    await page.getByRole('button', { name: 'ยืนยันซื้อและไปจ่ายเงิน', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Stripe (จำลอง)', exact: true })).toBeVisible(AFTER_PRESS);
    await page.getByRole('link', { name: 'กลับโดยไม่จ่าย', exact: true }).click();
    const block = page.getByRole('region', { name: 'มีรายการจ่ายเงินที่ยังไม่เสร็จ', exact: true });
    await expectInSight(block.getByText('เปิดหน้าจ่ายเงินไว้แล้ว แต่ระบบยังไม่ได้รับผลการจ่ายเงิน', { exact: true }));
    await expectInSight(block.getByRole('button', { name: 'จ่ายต่อ', exact: true }));
    await expect(page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await block.getByRole('button', { name: 'จ่ายแล้ว ตรวจผลการจ่ายเงิน', exact: true }).click();
    await expect(block.getByRole('status')).toContainText('ส่งคำขอตรวจสอบแล้ว กดอัปเดตข้อมูลเพื่อดูผลล่าสุด'); expect(checks).toBeGreaterThan(0);
    await block.getByRole('button', { name: 'จ่ายต่อ', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Stripe (จำลอง)', exact: true })).toBeVisible(AFTER_PRESS); expect(resumes).toBe(1);
    await page.getByRole('link', { name: 'กลับโดยไม่จ่าย', exact: true }).click();
    await block.getByRole('button', { name: 'ยกเลิกรายการนี้', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'เลือกแพ็กเกจ', exact: true })).toBeVisible(AFTER_PRESS);
    expect(state.log.cancels).toBe(1); expect(state.log.checkouts).toHaveLength(1);
    const result = await page.evaluate(async id => (await fetch(`/api/v1/companies/${id}/billing`)).json(), companyId);
    expect(result).toMatchObject({ attemptId: null, paymentState: 'NONE', applyState: 'NONE' });
    await expectNoClientError(page);
  });

  for (const outcome of ['unknown', 'action-required', 'declined', 'applying', 'held'] as const) {
    test(`@journey D5 ${outcome} keeps one truthful state and original attempt at ${width}px`, async ({ authedPage: page, companyId }, info) => {
      test.setTimeout(300_000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const state = defaultState();
      state.stage = outcome === 'declined' ? 'failed' : outcome === 'applying' || outcome === 'held' ? 'paid' : 'unknown';
      await installNoSetupRoutes(page, companyId, state);
      const base = `/api/v1/companies/${companyId}/billing`;
      const readStatus = () => ({ ...noSetupStatus(companyId, state), billingProfile: null, reference: ATTEMPT,
        ...(state.stage === 'failed' ? { attemptId: null, paymentState: 'NONE' } : {}), ...(outcome === 'held' ? { applyState: 'HELD' } : {}), ...(outcome === 'action-required' && state.stage !== 'locked' ? { paymentState: 'ACTION_REQUIRED' } : {}) });
      let checks = 0;
      await page.route('**/api/v1/**', async route => {
        const req = route.request(), path = new URL(req.url()).pathname;
        if (path === base && req.method() === 'GET') return route.fulfill({ json: readStatus() });
        if (path === `${base}/refresh` && req.method() === 'POST') { checks++; return route.fulfill({ status: 202, json: { queued: true } }); }
        return route.fallback();
      });
      await page.goto(`/companies/${companyId}/billing${outcome === 'declined' ? `/return?attempt=${ATTEMPT}` : ''}`);
      const heading = outcome === 'unknown' ? 'ยังไม่ทราบผลการจ่ายเงิน' : outcome === 'action-required' ? 'มีรายการจ่ายเงินที่ยังไม่เสร็จ' : outcome === 'declined' ? 'จ่ายเงินไม่สำเร็จ' : outcome === 'held' ? 'ได้รับเงินแล้ว ทีมงานกำลังตรวจสอบ' : 'ได้รับเงินแล้ว กำลังเปิดแพ็กเกจ';
      await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeVisible(FIRST_SIGHT);
      const block = page.getByRole('region', { name: heading, exact: true });
      const check = block.getByRole('button', { name: 'ตรวจผลการจ่ายเงิน', exact: true });
      await expectInSight(outcome === 'declined' ? block.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }) : outcome === 'action-required' ? block.getByRole('button', { name: 'จ่ายต่อ', exact: true }) : check);
      if (outcome === 'unknown') await expectInSight(block.getByText('ตรวจผลรายการเดิมก่อน เพื่อไม่ให้จ่ายซ้ำ', { exact: true }));
      if (outcome === 'applying' || outcome === 'held') await expectInSight(block.getByText('ไม่ต้องจ่ายซ้ำ', { exact: true }));
      if (outcome !== 'declined') {
        await expect(page.getByRole('heading', { name: 'จ่ายเงินไม่สำเร็จ', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true })).toHaveCount(0);
      }
      if (outcome === 'held') { await expect(page.getByText('เลขอ้างอิง 1111-1111 ·', { exact: false })).toBeVisible(); await expect(page.getByRole('link', { name: 'ติดต่อทีมมั่งมี', exact: true }).first()).toHaveAttribute('href', /^mailto:/); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`unfinished-${outcome}-${width}.png`), fullPage: true });
      if (outcome === 'declined') {
        await expect(check).toHaveCount(0);
        await expectInSight(block.getByText('เลือกแพ็กเกจแล้วจ่ายอีกครั้งได้', { exact: true }));
        // The return page reads the outcome by itself on arrival; from the failed block on, nothing asks again.
        checks = 0;
        const ended = await page.evaluate(async id => (await fetch(`/api/v1/companies/${id}/billing`)).json(), companyId);
        expect(ended).toMatchObject({ attemptId: null, paymentState: 'NONE', applyState: 'NONE' });
        await block.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'เลือกแพ็กเกจ', exact: true })).toBeVisible(AFTER_PRESS);
        await page.getByRole('radio', { name: 'เลือก เริ่มต้น', exact: true }).check();
        await page.getByRole('radio', { name: 'บัตร · จ่ายครั้งเดียว', exact: true }).check();
        await page.getByRole('button', { name: 'ดูยอดที่ต้องจ่าย', exact: true }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'ตรวจก่อนจ่าย', exact: true })).toBeVisible(AFTER_PRESS);
        await expect(page.getByRole('region', { name: 'ตรวจก่อนจ่าย', exact: true })).toContainText('จ่ายครั้งเดียว ไม่มีการตัดเงินงวดถัดไป');
        await page.getByRole('button', { name: 'ยืนยันซื้อและไปจ่ายเงิน', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Stripe (จำลอง)', exact: true })).toBeVisible(AFTER_PRESS);
        expect(state.log.checkouts).toHaveLength(1);
        expect(state.log.checkoutBodies).toEqual([{ quoteId: 'q-1', consentRevision: 'billing-v2', accepted: true, channel: 'web' }]);
        expect(checks).toBe(0); await expectNoClientError(page);
        return;
      }
      await check.click(); await expect(block.getByRole('status')).toContainText('ส่งคำขอตรวจสอบแล้ว กดอัปเดตข้อมูลเพื่อดูผลล่าสุด'); expect(checks).toBeGreaterThan(0);
      if (outcome === 'unknown' || outcome === 'action-required') {
        await block.getByRole('button', { name: 'ยกเลิกรายการนี้', exact: true }).click();
        await expect(block.getByRole('heading', { name: 'ยกเลิกรายการจ่ายนี้?', exact: true })).toBeVisible();
        await expect(block).toContainText('ระบบตรวจผลรายการเดิมก่อน จึงเริ่มรายการใหม่ได้'); expect(state.log.cancels).toBe(0);
        await block.getByRole('button', { name: 'ไม่ยกเลิก', exact: true }).click(); expect(state.log.cancels).toBe(0);
        await block.getByRole('button', { name: 'ยกเลิกรายการนี้', exact: true }).click();
        await block.getByRole('button', { name: 'ยกเลิกรายการนี้', exact: true }).click();
        await expect(block).toHaveCount(0); expect(state.log.cancels).toBe(1);
      } else await expect(block.getByRole('button', { name: /^(จ่ายต่อ|ยกเลิกรายการนี้)$/ })).toHaveCount(0);
      const result = await page.evaluate(async id => (await fetch(`/api/v1/companies/${id}/billing`)).json(), companyId);
      expect(result).toMatchObject(outcome === 'unknown' || outcome === 'action-required' ? { attemptId: null, paymentState: 'NONE' } : { attemptId: ATTEMPT, paymentState: 'PAID', applyState: outcome === 'held' ? 'HELD' : outcome === 'applying' ? 'PENDING' : 'NONE' });
      expect(state.log.checkouts).toHaveLength(0); await expectNoClientError(page);
    });
  }
}
