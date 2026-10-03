import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';
import { ATTEMPT, defaultState, installNoSetupRoutes } from './billing-no-setup.fixture';
import type { Page } from '@playwright/test';

const fits = async (page: Page, width: number) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

for (const width of [1280, 390]) {
  test(`NO-SETUP @p1 locked shop buys STARTER with no email and no address, then unlocks in place at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const s = defaultState();
    await installNoSetupRoutes(page, companyId, s);
    await page.goto(`/companies/${companyId}/billing`);
    await expect(page.getByRole('heading', { name: 'ยังไม่มีแพ็กเกจ', exact: true })).toBeVisible();
    // F22/F20: one header (the shell's), no recovery link that loops back to /renew, the locked sidebar.
    await expect(page.locator('header')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'กลับหน้าเลือกบริษัท' })).toHaveCount(0);
    await expect(page.locator(`aside a[href$="/companies/${companyId}/billing"]`)).toHaveCount(1);
    await expect(page.locator(`aside a[href$="/companies/${companyId}/settings"]`)).toHaveCount(1);
    await expect(page.getByText('ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้')).toBeVisible();
    // RV05/R-A9: nothing to set up first — no email gate, no company-profile popup or warning box.
    for (const gate of ['ยืนยันอีเมลบัญชีก่อนซื้อแพ็กเกจ', 'ตั้งค่าข้อมูลบริษัทก่อนซื้อแพ็กเกจ', 'กรอกข้อมูลบริษัทก่อนซื้อแพ็กเกจ']) await expect(page.getByText(gate)).toHaveCount(0);
    await expect(page.getByRole('note').filter({ hasText: 'เอกสารจะออกในชื่อ' })).toContainText('ที่อยู่กรอกได้ที่หน้าชำระเงิน');

    await page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).click();
    const plans = page.getByRole('region', { name: 'เลือกแพ็กเกจ', exact: true });
    // G24: card auto-renew on top; the other ways to pay wait under "วิธีชำระอื่น".
    await expect(plans.getByRole('radio', { name: 'บัตร · ต่ออายุอัตโนมัติ' })).toBeChecked();
    const otherModes = plans.getByRole('button', { name: 'วิธีชำระอื่น' });
    await expect(otherModes).toHaveAttribute('aria-expanded', 'false');
    await expect(plans.getByRole('radio', { name: 'พร้อมเพย์ QR · จ่ายครั้งเดียว' })).toBeHidden();
    await otherModes.click();
    await expect(plans.getByRole('radio', { name: 'พร้อมเพย์ QR · จ่ายครั้งเดียว' })).toBeVisible();
    await plans.getByRole('button', { name: 'รายปี', exact: true }).click();
    await expect(plans).toContainText('เฉลี่ยเดือนละ');
    await plans.getByRole('button', { name: 'รายเดือน', exact: true }).click();
    const starter = plans.locator('article').filter({ has: page.getByRole('heading', { name: 'เริ่มต้น (STARTER)', exact: true }) });
    await starter.getByRole('button', { name: 'เลือกแพ็กเกจนี้', exact: true }).click();

    // R-A11: what the documents will carry; the blanks are filled at Stripe Checkout.
    const review = page.getByRole('region', { name: 'ยืนยันซื้อแพ็กเกจ', exact: true });
    const documents = review.getByLabel('ข้อมูลออกเอกสาร', { exact: true });
    await expect(documents.getByText('จะกรอกที่หน้าชำระเงิน', { exact: true })).toHaveCount(2);
    expect(s.log.quotes[0]).not.toHaveProperty('billingEmail');
    await expect(documents.getByRole('link', { name: 'แก้ไขข้อมูลร้าน' })).toHaveAttribute('href', /returnTo=billing/);
    await expect(documents.getByRole('button', { name: 'แก้อีเมลรับเอกสาร' })).toHaveCount(0);
    await review.getByRole('checkbox').check();
    await review.getByRole('button', { name: 'ยืนยันและไปหน้าชำระเงิน', exact: true }).click();
    await page.waitForURL(/checkout\.stripe\.com/);
    await expect(page.getByRole('heading', { name: 'Stripe (จำลอง)' })).toBeVisible();

    // Review 2026-09-29: Stripe sends the owner back before the reconciler applies the payment, so the
    // attempt stays OPEN for a few polls. Meanwhile the page waits — it never offers to end, resume or
    // redo the payment, and the locked banner has no "เลือกแพ็กเกจ" of its own.
    await page.locator('#pay').click();
    await page.waitForURL(new RegExp(`/billing/return\\?attempt=${ATTEMPT}$`));
    const waiting = page.getByText('กำลังรอผลการชำระเงินจากผู้ให้บริการรับชำระเงิน', { exact: true });
    await expect(waiting).toBeVisible();
    const readsBefore = s.log.attempts;
    await expect.poll(() => s.log.attempts - readsBefore, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
    await expect(waiting).toBeVisible();
    await expect(page.getByRole('heading', { name: 'กำลังตรวจสอบรายการชำระเงิน', exact: true })).toBeVisible();
    for (const name of ['เลือกแพ็กเกจใหม่', 'กลับไปยังรายการเดิม', 'ยุติรายการที่ยังไม่ชำระ', 'เลือกแพ็กเกจ'])
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'เลือกแพ็กเกจ', exact: true })).toHaveCount(0);
    await expect(page.getByText('เลือกแพ็กเกจเพื่อเริ่มใช้งาน', { exact: true })).toHaveCount(0);
    await fits(page, width);

    s.stage = 'paid';
    await expect(page.getByRole('heading', { name: 'ชำระแล้ว กำลังตรวจสอบการเปิดสิทธิ์', exact: true })).toBeVisible();
    await expect(waiting).toHaveCount(0);
    // R-A8: said from PAID; the recipient column is written at apply, so Checkout's email stands in until then.
    const recipientLine = page.getByLabel('อีเมลรับเอกสาร', { exact: true });
    await expect(recipientLine).toContainText('อีเมลที่กรอกไว้ที่หน้าชำระเงิน');
    await expect(recipientLine.getByRole('button', { name: 'แก้อีเมลรับเอกสาร' })).toBeDisabled();

    // RV30: the shell unlocks in place when the payment applies — no page load.
    let loads = 0;
    page.on('load', () => { loads++; });
    s.stage = 'applied';
    await expect(page.getByRole('heading', { name: 'ชำระแล้ว เปิดใช้งานแล้ว', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('aside a[href$="/dashboard"]').first()).toBeAttached();
    await expect(page.getByText('ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้')).toHaveCount(0);
    await expect(page.locator('header')).toHaveCount(1);
    expect(loads).toBe(0);
    await expect(recipientLine).toContainText('ส่งเอกสารไปที่ buyer@example.test');
    await fits(page, width);
    await page.screenshot({ path: info.outputPath(`no-setup-return-${width}.png`), fullPage: true });

    // R-A8/R-D2: a new mailbox proven by a code, then the latest documents go there.
    await recipientLine.getByRole('button', { name: 'แก้อีเมลรับเอกสาร' }).click();
    await expect(page.getByRole('button', { name: 'การต่ออายุและชำระเงิน', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const panel = page.getByRole('region', { name: 'ผู้รับเอกสารของร้าน', exact: true });
    await expect(panel).toBeVisible();
    await panel.getByRole('radio', { name: 'ใช้อีเมลอื่น' }).check();
    await panel.getByLabel('อีเมลรับเอกสารใหม่').fill('new@example.test');
    await panel.getByRole('button', { name: 'ขอรหัสยืนยัน', exact: true }).click();
    await expect(panel).toContainText('รหัสยืนยัน 6 หลักสำหรับ new@example.test');
    await expect(panel.getByRole('status').filter({ hasText: 'ระบบส่งถึงเซิร์ฟเวอร์อีเมลแล้ว' })).toBeVisible();
    const code = panel.getByLabel('รหัสยืนยัน 6 หลัก');
    await code.fill('000000');
    await panel.getByRole('button', { name: 'ยืนยันรหัส', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('รหัสไม่ถูกต้อง');
    await code.fill('123456');
    await panel.getByRole('button', { name: 'ยืนยันรหัส', exact: true }).click();
    await expect(panel.getByText('จาก buyer@example.test เป็น new@example.test')).toBeVisible();
    await panel.getByRole('button', { name: 'ยืนยันเปลี่ยนผู้รับเอกสาร', exact: true }).click();
    await expect(panel.getByRole('status').filter({ hasText: 'เปลี่ยนผู้รับเอกสารเป็น new@example.test แล้ว' })).toBeVisible();
    await panel.getByRole('button', { name: 'ส่งเอกสารล่าสุดไปอีเมลใหม่', exact: true }).click();
    await expect(panel.getByRole('status').filter({ hasText: 'ส่งเอกสารไปที่ new@example.test แล้ว' })).toContainText('วันนี้ส่งซ้ำได้อีก');
    s.resendsLeft = 0;
    await panel.getByRole('button', { name: 'ส่งเอกสารล่าสุดไปอีเมลใหม่', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('วันนี้ส่งเอกสารใบนี้ซ้ำครบจำนวนที่กำหนดแล้ว');
    expect(s.log.checkouts).toHaveLength(1);
    await fits(page, width);
    await page.screenshot({ path: info.outputPath(`no-setup-recipient-${width}.png`), fullPage: true });
    await expectNoClientError(page);
  });

  test(`NO-SETUP cancel from Stripe offers a one-tap new choice and never reopens the chooser on a completed payment at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const s = defaultState();
    await installNoSetupRoutes(page, companyId, s);
    await page.goto(`/companies/${companyId}/billing`);
    await page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).click();
    const plans = page.getByRole('region', { name: 'เลือกแพ็กเกจ', exact: true });
    await plans.locator('article').filter({ has: page.getByRole('heading', { name: 'เริ่มต้น (STARTER)', exact: true }) })
      .getByRole('button', { name: 'เลือกแพ็กเกจนี้', exact: true }).click();
    const review = page.getByRole('region', { name: 'ยืนยันซื้อแพ็กเกจ', exact: true });
    await review.getByRole('checkbox').check();
    await review.getByRole('button', { name: 'ยืนยันและไปหน้าชำระเงิน', exact: true }).click();
    await page.waitForURL(/checkout\.stripe\.com/);
    await page.locator('#back').click();
    await page.waitForURL(/checkout=canceled/);

    // G12/F09/F10: back without paying — said plainly, and one tap ends that Checkout for a new choice.
    await expect(page.getByRole('heading', { name: 'ยังไม่ได้ชำระ', exact: true })).toBeVisible();
    const newChoice = page.getByRole('button', { name: 'เลือกแพ็กเกจใหม่', exact: true });
    await expect(newChoice).toBeVisible();
    await expect(page.getByRole('button', { name: 'ยุติรายการที่ยังไม่ชำระ' })).toHaveCount(0);
    await fits(page, width);
    await page.screenshot({ path: info.outputPath(`no-setup-canceled-${width}.png`), fullPage: true });
    await newChoice.click();
    await expect.poll(() => s.log.cancels).toBe(1);
    await expect(page.getByText('ยุติหน้าชำระเงินเดิมแล้ว เลือกแพ็กเกจใหม่ได้เลย', { exact: true })).toBeVisible();
    await expect(plans).toBeVisible();

    // The old Checkout turns out paid: no second purchase is offered.
    s.stage = 'checkout'; s.cancelResult = 'COMPLETED';
    await page.goto(`/companies/${companyId}/billing/return?attempt=${ATTEMPT}&checkout=canceled`);
    await page.getByRole('button', { name: 'เลือกแพ็กเกจใหม่', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'รายการเดิมชำระสำเร็จแล้ว' })).toBeVisible();
    await expect(plans).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'ชำระแล้ว กำลังตรวจสอบการเปิดสิทธิ์', exact: true })).toBeVisible();

    // The package page offers the same one tap (F09); Stripe still deciding keeps the chooser closed.
    s.stage = 'checkout'; s.cancelResult = 'PENDING';
    await page.goto(`/companies/${companyId}/billing`);
    await expect(newChoice).toBeVisible();
    await newChoice.click();
    await expect(page.getByRole('status').filter({ hasText: 'กำลังตรวจผลรายการเดิมกับผู้ให้บริการรับชำระเงิน' })).toBeVisible();
    await expect(plans).toHaveCount(0);
    expect(s.log.cancels).toBe(3);
    await expectNoClientError(page);
  });

  test(`NO-SETUP quote expiry re-quotes with the same choice; checkout FAILED returns to the chooser and UNKNOWN never retries at ${width}px`, async ({ authedPage: page, companyId }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = defaultState();
    s.quoteTtlMs = 1500;
    await installNoSetupRoutes(page, companyId, s);
    await page.goto(`/companies/${companyId}/billing`);
    await page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).click();
    const plans = page.getByRole('region', { name: 'เลือกแพ็กเกจ', exact: true });
    const starter = plans.locator('article').filter({ has: page.getByRole('heading', { name: 'เริ่มต้น (STARTER)', exact: true }) });
    await plans.getByRole('button', { name: 'วิธีชำระอื่น' }).click();
    await plans.getByRole('radio', { name: 'พร้อมเพย์ QR · จ่ายครั้งเดียว' }).check();
    await starter.getByRole('button', { name: 'เลือกแพ็กเกจนี้', exact: true }).click();
    const review = page.getByRole('region', { name: 'ยืนยันซื้อแพ็กเกจ', exact: true });
    const checkout = review.getByRole('button', { name: 'ยืนยันและไปหน้าชำระเงิน', exact: true });

    // G10/F16: an expired price says so, and re-quotes the same choice in one tap.
    await expect(review.getByRole('status').filter({ hasText: 'ราคานี้หมดอายุแล้ว กดตรวจสอบราคาใหม่' })).toBeVisible();
    await expect(checkout).toHaveCount(0);
    s.quoteTtlMs = 600_000;
    await review.getByRole('button', { name: 'ตรวจสอบราคาใหม่', exact: true }).click();
    await expect(checkout).toBeVisible();
    expect(s.log.quotes[1]).toMatchObject({ offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'PROMPTPAY_ONCE' });

    // G11/F17: Checkout refused (the quote is spent) → back to the chooser with a reason.
    s.checkoutResult = 'FAILED';
    await review.getByRole('checkbox').check();
    await checkout.click();
    await expect(page.getByRole('alert').filter({ hasText: 'ยังเปิดหน้าชำระเงินไม่ได้' })).toBeVisible();
    await expect(plans).toBeVisible();
    expect(s.log.checkouts).toHaveLength(1);

    // Outcome unknown → never a second attempt from here, only a look at the first.
    await starter.getByRole('button', { name: 'เลือกแพ็กเกจนี้', exact: true }).click();
    s.checkoutResult = 'UNKNOWN';
    await review.getByRole('checkbox').check();
    await checkout.click();
    await expect(page.getByRole('status').filter({ hasText: 'กำลังตรวจกับผู้ให้บริการรับชำระเงิน' })).toBeVisible();
    await expect(checkout).toHaveCount(0);
    await page.waitForTimeout(2500);
    expect(s.log.checkouts).toHaveLength(2);
    await expect(page.getByRole('button', { name: 'ตรวจผลการชำระเงินอีกครั้ง', exact: true })).toBeVisible();
    await fits(page, width);
    await expectNoClientError(page);
  });

  test(`NO-SETUP failed attempt keeps the shop locked and offers the chooser at ${width}px`, async ({ authedPage: page, companyId }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = defaultState();
    s.stage = 'failed';
    await installNoSetupRoutes(page, companyId, s);
    await page.goto(`/companies/${companyId}/billing/return?attempt=${ATTEMPT}`);
    await expect(page.getByRole('heading', { name: 'รายการชำระเงินนี้ไม่สำเร็จ', exact: true })).toBeVisible();
    // A shop that never had a package is not told its old package is unchanged.
    await expect(page.getByText('ไม่มีการเรียกเก็บเงินจากรายการนี้')).toBeVisible();
    await expect(page.getByText('สิทธิ์แพ็กเกจเดิม')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true })).toBeVisible();
    // G13: a FAILED answer ends the polling.
    const reads = s.log.attempts;
    await page.waitForTimeout(3000);
    expect(s.log.attempts - reads).toBeLessThanOrEqual(1);
    await fits(page, width);
    await expectNoClientError(page);
  });
}
