/**
 * Journey: a purchase with no receipt, from the menu row to a confirmed expense.
 *
 * The defect this walks over sat between two pages that each looked right: the certificate was
 * issued, then the expense could neither be confirmed (no seller name) nor be given a name (locked
 * after issue). And in a shop with two owners, a certificate made by one owner waited for the other.
 */
import { test, expect } from '../harness/fixtures';
import { chooseThemedOption, json, unique } from '../harness/e2e-utils';
import { QA_ACCOUNTS } from '../harness/roles';
import { AFTER_PRESS, FIRST_SIGHT, idFromUrl, inOrder, picture, pressMenu, signOnScreen, thaiDate, whole } from './journey-kit';

type ExpenseDetail = {
  status: string; expenseNumber: string; vendorNameSnapshot: string | null; paymentStatus: string;
  expenseCategoryId: string | null;
  lines: Array<{ expenseCategoryId: string | null }>;
  substituteReceiptEvidence: { status: string; payeeName: string; documentNumber: string } | null;
};

test.describe('no-receipt certificate', () => {
  test('@journey a second owner certifies a purchase with no receipt and confirms the expense without retyping the payee', async ({ pageAs, api, companyId }) => {
    test.setTimeout(300_000);
    const page = await pageAs('OWNER');
    page.setDefaultTimeout(30_000);
    const owner = QA_ACCOUNTS.OWNER.displayName;
    const payee = unique('ร้านน้ำแข็งลุงชัย');
    const item = unique('ค่าน้ำแข็งหลอด');
    const today = thaiDate();
    const main = page.locator('main');
    const next = main.getByRole('button', { name: 'ถัดไป', exact: true });
    const wizardNav = main.getByRole('navigation', { name: 'การนำทางใบรับรอง' });

    // The one page opened by address.
    await page.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);

    await test.step('menu → ใบรับรองแทนใบเสร็จ → สร้างใบรับรอง', async () => {
      await pressMenu(page, 'ใบรับรองแทนใบเสร็จ', 'ค่าใช้จ่ายและใบเสร็จ');
      await expect(main.getByRole('heading', { level: 1, name: 'ใบรับรองแทนใบเสร็จ', exact: true })).toBeVisible(FIRST_SIGHT);
      await main.getByRole('link', { name: 'สร้างใบรับรอง', exact: true }).click();
      await expect(main.getByRole('heading', { level: 1, name: 'สร้างใบรับรองแทนใบเสร็จ', exact: true })).toBeVisible(FIRST_SIGHT);
      const steps = main.getByRole('navigation', { name: 'เส้นทางการจัดทำเอกสาร' }).getByRole('listitem');
      await expect(steps).toHaveText([/^1\s*ค่าใช้จ่าย$/, /^2\s*รายละเอียด$/, /^3\s*เซ็น$/, /^4\s*เสร็จ$/]);
      await expect(main.getByText('⚠ ใบรับรองแทนใบเสร็จใช้ VAT ตอนยื่นภาษีไม่ได้ และยังต้องตรวจหัก ณ ที่จ่ายตามรายการ', { exact: true })).toBeVisible();
      await expect(main.getByRole('group', { name: 'ค่าใช้จ่ายนี้บันทึกไว้หรือยัง' })).toBeVisible();
    });

    let expenseNumber = '';
    await test.step('ยังไม่ได้บันทึก → the short record', async () => {
      await main.getByRole('radio', { name: /^ยังไม่ได้บันทึก/ }).check();
      await expect(main.getByRole('heading', { name: 'บันทึกค่าใช้จ่ายนี้ก่อน', exact: true })).toBeVisible();
      await expect(main.getByRole('combobox', { name: 'วันที่ซื้อ', exact: true })).toHaveText(today);
      await chooseThemedOption(page, main.getByRole('combobox', { name: 'สาขา', exact: true }), 'Head Office (สำนักงานใหญ่)');
      await main.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true }).fill(item);
      await chooseThemedOption(page, main.getByRole('combobox', { name: 'รายการที่ 1: หมวดหมู่ค่าใช้จ่าย', exact: true }), 'ค่าอาหารและเครื่องดื่ม');
      await main.getByRole('spinbutton', { name: 'จำนวน', exact: true }).fill('1');
      await main.getByRole('textbox', { name: 'ราคาต่อหน่วย บาท', exact: true }).fill('1.005');
      await expect(main.getByText(whole('รวมรายการนี้ 1.01 บาท'))).toBeVisible();
      await main.getByRole('spinbutton', { name: 'จำนวน', exact: true }).fill('3');
      await main.getByRole('textbox', { name: 'ราคาต่อหน่วย บาท', exact: true }).fill('40');
      await expect(main.getByText(whole('รวมรายการนี้ 120.00 บาท'))).toBeVisible();

      await main.getByRole('button', { name: 'บันทึกร่างค่าใช้จ่ายและไปต่อ', exact: true }).click();
      const saved = main.getByText(/^บันทึกร่างค่าใช้จ่าย EXP-\d{6}-\d{5} แล้ว$/);
      await expect(saved).toBeVisible(AFTER_PRESS);
      expenseNumber = (await saved.innerText()).match(/EXP-\d{6}-\d{5}/)![0];
      await expect(main.getByText(whole(`${expenseNumber} · ${item} · 120.00 บาท`))).toBeVisible();
      // Off, and the reason is on the screen.
      await expect(next).toBeDisabled();
      await expect(main.getByRole('status').filter({ hasText: 'ยังขาด:' })).toContainText('ติ๊กว่าเข้าใจแล้ว');
      await main.getByRole('checkbox', { name: 'เข้าใจแล้วว่าใบรับรองแทนใบเสร็จใช้ VAT ตอนยื่นภาษีไม่ได้', exact: true }).check();
      await expect(next).toBeEnabled();
      await next.click();
    });

    await test.step('details: payee, reason, purpose, whose money', async () => {
      await expect(main.getByRole('heading', { name: 'ผู้รับเงิน', exact: true })).toBeVisible(AFTER_PRESS);
      await expect(main.getByRole('heading', { name: 'การจ่าย', exact: true })).toBeVisible();
      await expect(next).toBeDisabled();
      await expect(wizardNav.getByRole('status')).toHaveText('ยังขาด: ชื่อผู้รับเงิน · เหตุผลที่ไม่มีใบเสร็จรับเงิน · ซื้อไปใช้ทำอะไร · เงินที่ใช้จ่าย และติ๊กว่าจ่ายครบ');
      await main.getByRole('textbox', { name: /^ชื่อผู้รับเงิน/ }).fill(payee);
      await main.getByRole('textbox', { name: 'เหตุผลที่ไม่มีใบเสร็จรับเงิน', exact: true }).fill('ร้านรถเข็นไม่มีใบเสร็จให้');
      await main.getByRole('textbox', { name: 'ซื้อไปใช้ทำอะไร', exact: true }).fill('ใช้แช่เครื่องดื่มขายหน้าร้าน');
      await main.getByRole('radio', { name: 'เงินของร้าน', exact: true }).check();
      await expect(wizardNav.getByRole('status')).toHaveText('ยังขาด: ติ๊กว่าจ่ายครบ');
      await main.getByRole('checkbox', { name: 'จ่ายครบ 120.00 บาท แล้ว ไม่ได้แบ่งจ่าย', exact: true }).check();
      await expect(main.getByText(whole('เมื่อออกใบรับรอง ระบบจะบันทึกว่าร้านจ่าย 120.00 บาท แล้ว'))).toBeVisible();
      await expect(main.getByRole('combobox', { name: 'วิธีจ่าย', exact: true })).toHaveText('โอนเงิน');
      await expect(main.getByRole('combobox', { name: 'วันที่จ่าย', exact: true })).toHaveText(today);
      await expect(wizardNav.getByRole('status')).toHaveCount(0);
      await next.click();
    });

    await test.step('payment evidence', async () => {
      await expect(main.getByRole('heading', { name: 'หลักฐานการจ่าย', exact: true })).toBeVisible(AFTER_PRESS);
      await expect(next).toBeDisabled();
      await expect(wizardNav.getByRole('status')).toHaveText('ยังขาด: หลักฐานการจ่าย');
      await main.getByLabel('หลักฐานการจ่าย', { exact: true }).setInputFiles(picture('สลิปโอนค่าน้ำแข็ง.png'));
      await expect(main.getByText('เพิ่มไฟล์หลักฐานแล้ว', { exact: true })).toBeVisible(AFTER_PRESS);
      await expect(main.getByText(whole('ไฟล์ที่มีในค่าใช้จ่ายนี้ · เลือกแล้ว 1 ไฟล์'))).toBeVisible();
      await expect(main.getByRole('checkbox', { name: 'สลิปโอนค่าน้ำแข็ง.png', exact: true })).toBeChecked();
      await next.click();
    });

    let certificateNumber = '';
    await test.step('เซ็นออนไลน์: the certifier preset is this person', async () => {
      const create = main.getByRole('button', { name: 'สร้างใบรับรองและไปเซ็น', exact: true });
      await expect(main.getByRole('group', { name: 'เลือกวิธีเซ็น' })).toBeVisible(AFTER_PRESS);
      await expect(create).toBeDisabled();
      await expect(main.getByRole('status').filter({ hasText: 'ยังขาด:' })).toHaveText('ยังขาด: เลือกวิธีเซ็น');
      await main.getByRole('radio', { name: /^เซ็นออนไลน์/ }).check();
      // Two owners in the shop: the one who is making the certificate signs it, nobody else is waited for.
      await expect(main.getByRole('combobox', { name: 'ผู้รับรองการจ่าย', exact: true })).toHaveText(owner);
      await expect(main.getByText('คุณเซ็นด้วยบัญชีที่ใช้อยู่', { exact: true })).toBeVisible();
      await expect(main.getByRole('definition')).toHaveText([payee, '120.00 บาท', today]);
      await expect(create).toBeEnabled();
      const expenseId = new URL(page.url()).searchParams.get('expenseId');
      expect(expenseId, 'the selected expense stays in the wizard address').toBeTruthy();
      await create.click();
      const heading = main.getByRole('heading', { level: 1, name: /^ใบรับรองแทนใบเสร็จ SRC-\d{6}-\d{5}$/ });
      await expect(heading).toBeVisible(AFTER_PRESS);
      certificateNumber = (await heading.innerText()).match(/SRC-\d{6}-\d{5}/)![0];
      const preparedExpense = await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${expenseId}`));
      expect(preparedExpense.substituteReceiptEvidence?.status).toBe('PREPARED');
      expect(preparedExpense.vendorNameSnapshot).toBe(payee);
    });

    await test.step('read, sign, tick → เซ็นและออกใบรับรอง', async () => {
      const issue = main.getByRole('button', { name: 'เซ็นและออกใบรับรอง', exact: true });
      await expect(issue).toBeEnabled();
      await issue.click();
      await expect(main.getByRole('status').filter({ hasText: 'ยังขาด:' })).toHaveText('ยังขาด: อ่านเอกสาร · ลายเซ็น · ติ๊กคำยืนยัน');

      await expect(main.getByRole('button', { name: 'อ่านเอกสาร', exact: true })).toBeFocused();
      await expect(main.getByText('อ่านเอกสารก่อนเซ็น', { exact: true })).toBeVisible();
      const reader = page.getByRole('dialog', { name: `ใบรับรองแทนใบเสร็จ ${certificateNumber}` });
      await main.getByRole('button', { name: 'อ่านเอกสาร', exact: true }).click();
      await expect(reader.getByRole('img', { name: `ใบรับรองแทนใบเสร็จ ${certificateNumber}` })).toBeVisible(AFTER_PRESS);
      await reader.getByRole('button', { name: 'ปิด', exact: true }).click();
      await expect(reader).toHaveCount(0);
      await expect(main.getByText('อ่านแล้ว', { exact: true })).toBeVisible();
      await expect(main.getByRole('status').filter({ hasText: 'ยังขาด:' })).toHaveText('ยังขาด: ลายเซ็น · ติ๊กคำยืนยัน');

      await expect(main.getByText('เซ็นเหนือเส้นด้วยนิ้วหรือเมาส์', { exact: true })).toBeVisible();
      await signOnScreen(page);
      await expect(main.getByRole('img', { name: 'ลายเซ็นที่จะใช้ในใบนี้' })).toBeVisible(AFTER_PRESS);
      await expect(main.getByRole('button', { name: 'เซ็นใหม่', exact: true })).toBeVisible();
      await expect(issue).toBeEnabled();
      await issue.click();
      await expect(main.getByRole('status').filter({ hasText: 'ยังขาด:' })).toHaveText('ยังขาด: ติ๊กคำยืนยัน');

      await main.getByRole('checkbox', { name: 'รับรองว่าจ่ายจริงเพื่อร้านและใช้ใบเสร็จประกอบไม่ได้ ตรวจเอกสารและหลักฐานแล้ว และอนุมัติให้ออกใบรับรอง', exact: true }).check();
      await expect(issue).toBeEnabled();
      await issue.click();

      await expect(main.getByText('✓ ออกใบรับรองแล้ว เหลือยืนยันค่าใช้จ่ายนี้')).toBeVisible(AFTER_PRESS);
      await expect(main.locator('.mangmee-page-header').getByText('ออกแล้ว', { exact: true })).toBeVisible();
      // `has:` takes a page-level locator; a `main.` one is looked up inside the card itself and never matches.
      const facts = main.locator('section.mangmee-card').filter({ has: page.getByText('จำนวนเงิน', { exact: true }) });
      await expect(facts).toContainText(inOrder('จำนวนเงิน', '120.00', 'บาท', 'ผู้รับเงิน', payee, 'วันที่จ่าย', today, 'จ่ายจาก', 'เงินของร้าน', 'ค่าใช้จ่าย', expenseNumber));
      await expect(main.getByRole('link', { name: 'กลับไปรายการ', exact: true })).toBeVisible();
      await expect(main.getByRole('button', { name: 'ดาวน์โหลด PDF', exact: true })).toBeEnabled();
      await main.getByText('เพิ่มเติม', { exact: true }).click();
      await expect(main.getByRole('button', { name: 'เปิดดูเอกสาร', exact: true })).toBeEnabled();
      await main.getByText('เพิ่มเติม', { exact: true }).click();
    });

    await test.step('hub tabs → whole certificate row → document actions', async () => {
      await pressMenu(page, 'ใบรับรองแทนใบเสร็จ', 'ค่าใช้จ่ายและใบเสร็จ');
      await expect(main.getByRole('heading', { level: 1, name: 'ใบรับรองแทนใบเสร็จ', exact: true })).toBeVisible(FIRST_SIGHT);
      const tabs = main.getByRole('group', { name: 'สถานะใบรับรอง', exact: true });
      await expect(tabs.getByRole('button')).toHaveCount(5);
      const issuedRead = page.waitForResponse(r => r.url().includes('/substitute-receipts?') && new URL(r.url()).searchParams.get('status') === 'ISSUED' && r.status() === 200);
      await tabs.getByRole('button', { name: /^ออกแล้ว/ }).click(); await issuedRead;
      await expect(tabs.getByRole('button', { name: /^ออกแล้ว/ })).toBeEnabled(AFTER_PRESS);
      await expect(page).toHaveURL(/status=ISSUED/);
      await expect(main.getByRole('combobox', { name: 'สถานะ', exact: true })).toHaveCount(0);
      await expect(main.getByRole('button', { name: /^ดูเอกสาร/ })).toHaveCount(0);
      const row = main.getByRole('link', { name: `เปิดใบรับรอง ${certificateNumber} ${payee}`, exact: true });
      // This list is now paged; do not assume the receipt is among the first ten.
      while (await row.count() === 0 && await main.getByRole('button', { name: /ถัดไป/, exact: false }).isEnabled().catch(() => false)) {
        const response = page.waitForResponse(r => r.url().includes('/substitute-receipts?') && r.status() === 200);
        await main.getByRole('button', { name: /ถัดไป/ }).click(); await response;
        await expect(main.getByRole('button', { name: /ก่อนหน้า/ })).toBeEnabled(AFTER_PRESS);
      }
      await expect(row).toBeVisible(AFTER_PRESS);
      await expect(row).toContainText('120.00');
      await expect(row).not.toContainText('฿');
      await expect(row.getByRole('button')).toHaveCount(0);
      await row.focus(); await row.press('Enter');
      await expect(main.getByRole('heading', { level: 1, name: `ใบรับรองแทนใบเสร็จ ${certificateNumber}`, exact: true })).toBeVisible(AFTER_PRESS);
      await expect(main.getByRole('button', { name: 'ดาวน์โหลด PDF', exact: true })).toBeEnabled();
      // Viewing the paper sits in the header's เพิ่มเติม menu.
      await main.getByText('เพิ่มเติม', { exact: true }).click();
      await expect(main.getByRole('button', { name: 'เปิดดูเอกสาร', exact: true })).toBeEnabled();
      await main.getByText('เพิ่มเติม', { exact: true }).click();
    });

    await test.step('ไปยืนยันค่าใช้จ่าย: headed by the payee, the seller field holds it', async () => {
      await main.getByRole('link', { name: 'ไปยืนยันค่าใช้จ่าย', exact: true }).click();
      await expect(main.getByRole('heading', { level: 1, name: payee, exact: true })).toBeVisible(FIRST_SIGHT);
      await expect(main.getByRole('button', { name: 'ลบรายจ่าย', exact: true })).toHaveCount(0);
      const more = main.locator('summary').filter({ hasText: /^เพิ่มเติม$/ });
      await more.click();
      await expect(main.getByRole('button', { name: 'ยกเลิกเอกสาร', exact: true })).toBeVisible();
      await more.click();
      await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ตรวจข้อมูล' })).toBeVisible();
      await expect(main.getByText(whole(`ใบรับรองแทนใบเสร็จ ${certificateNumber} · ออกแล้ว`)).first()).toBeVisible();
      await expect(main.getByText(expenseNumber, { exact: true })).toBeVisible();
      await expect(main.getByRole('textbox', { name: 'ชื่อผู้ขาย', exact: true })).toHaveValue(payee);
      await expect(main.getByRole('textbox', { name: 'ซื้อไปใช้ทำอะไร', exact: true })).toHaveValue('ใช้แช่เครื่องดื่มขายหน้าร้าน');
    });

    await test.step('ถัดไป (no refusal) → ถัดไป → the summary has the certificate and no warning', async () => {
      await next.click();
      await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ภาษีและเอกสาร' })).toBeVisible(AFTER_PRESS);
      await expect(main.getByRole('combobox', { name: 'จะใช้อะไรแทน', exact: true })).toHaveText('ทำใบรับรองแทนใบเสร็จ');
      await expect(main.getByText(whole(`ผู้รับรองการจ่าย: ${owner}`))).toBeVisible();
      await next.click();
      await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ตรวจสรุป' })).toBeVisible(AFTER_PRESS);
      const summary = main.locator('section.mangmee-card').filter({ has: page.getByRole('heading', { name: 'สรุปการตรวจ', exact: true }) });
      await expect(summary).toContainText('ผ่าน 3 รายการ · ต้องตรวจ 0 รายการ');
      await expect(summary).toContainText(inOrder(
        '✓ ไม่มีใบเสร็จ', `ใบรับรองแทนใบเสร็จ ${certificateNumber} · ออกแล้ว`,
        '✓ ระบุชื่อผู้ขาย/ผู้รับเงินแล้ว', '✓ มีวันที่เอกสาร',
      ));
      await expect(summary).not.toContainText('⚠');
    });

    await test.step('ยืนยันเอกสาร → ยืนยันแล้ว', async () => {
      const confirm = main.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true });
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect(page.getByText('ยืนยันเอกสารแล้ว', { exact: true }).first()).toBeVisible(AFTER_PRESS);
      await expect(main.locator('.mangmee-page-header').getByText('จ่ายแล้ว', { exact: true })).toBeVisible();
      await expect(main.getByRole('heading', { name: 'รายละเอียดเอกสาร', exact: true })).toBeVisible();
      await expect(main.getByText('ยังไม่จัดหมวด', { exact: true })).toHaveCount(0);
      await expect(main.getByText('ข้อมูลจาก AI (ต้องตรวจสอบก่อนยืนยัน)', { exact: true })).toHaveCount(0);
      const files = main.getByTestId('expense-attachment-list');
      await expect(files.getByText(`ใบรับรองแทนใบเสร็จ ${certificateNumber}`, { exact: true })).toHaveCount(1);
      await expect(files).toContainText('ไฟล์เอกสาร');
      await expect(files).not.toContainText('.svg');
      await expect(main.getByRole('link', { name: 'เปิดดูเอกสาร', exact: true })).toBeVisible();
      await expect(main).toContainText(inOrder('ประวัติการจ่าย', `${today} · โอนเงิน`, '120.00 บาท'));
      await main.getByTestId('expense-payment-history').getByRole('button', { name: 'ดูหลักฐานการจ่าย', exact: true }).click();
      const proofReader = page.getByRole('dialog', { name: 'สลิปโอนค่าน้ำแข็ง.png', exact: true });
      await expect(proofReader).toBeVisible(AFTER_PRESS);
      await proofReader.getByRole('button', { name: 'ปิด', exact: true }).click();

      await expect(main.getByRole('heading', { level: 1, name: payee, exact: true })).toBeVisible();
    });

    // The truth on the server.
    const expense = await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${idFromUrl(page)}`));
    expect(expense.expenseNumber).toBe(expenseNumber);
    expect(expense.status).toBe('CONFIRMED');
    expect(expense.vendorNameSnapshot).toBe(payee);
    expect(expense.paymentStatus).toBe('PAID');
    expect(expense.substituteReceiptEvidence?.status).toBe('ISSUED');
    expect(expense.substituteReceiptEvidence?.payeeName).toBe(payee);
    expect(expense.substituteReceiptEvidence?.documentNumber).toBe(certificateNumber);
  });

  test('@journey staff with an uncategorised expense is stopped at the first step and told who can fix it', async ({ pageAs, api, companyId }) => {
    test.setTimeout(300_000);
    const page = await pageAs('STAFF');
    page.setDefaultTimeout(30_000);
    const item = unique('ค่าถ่านไฟฉาย');
    const main = page.locator('main');
    const next = main.getByRole('button', { name: 'ถัดไป', exact: true });

    await page.goto(`/companies/${companyId}/expenses`, FIRST_SIGHT);

    let expenseId = '';
    let expenseNumber = '';
    await test.step('บันทึกด้วยมือ: an expense of her own, no category asked', async () => {
      await pressMenu(page, 'บันทึกด้วยมือ', 'ค่าใช้จ่ายและใบเสร็จ');
      await expect(main.getByRole('heading', { level: 1, name: 'บันทึกด้วยมือ', exact: true })).toBeVisible(FIRST_SIGHT);
      const save = main.getByRole('button', { name: 'บันทึกร่าง', exact: true });
      const branch = main.getByRole('combobox', { name: 'สาขา', exact: true });
      await expect(branch).toBeVisible(AFTER_PRESS);
      if ((await branch.innerText()).trim() !== 'Head Office (สำนักงานใหญ่)') {
        // Off until a branch is chosen, and the page says so.
        await expect(save).toBeDisabled();
        await expect(main.getByText('เลือกสาขาก่อนบันทึก', { exact: true })).toBeVisible();
        await chooseThemedOption(page, branch, 'Head Office (สำนักงานใหญ่)');
      }
      await main.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true }).fill(item);
      await main.getByRole('spinbutton', { name: 'ราคาต่อหน่วย', exact: true }).fill('60');
      await expect(main.getByText(whole('ยอดรวม 60.00 บาท'))).toBeVisible();
      await save.click();
      await expect(main.getByRole('heading', { level: 1, name: '(รอระบุผู้ขาย)', exact: true })).toBeVisible(FIRST_SIGHT);
      const number = main.getByText(/^EXP-\d{6}-\d{5}$/);
      await expect(number).toBeVisible();
      expenseNumber = (await number.innerText()).trim();
      expenseId = idFromUrl(page);
    });

    await test.step('ใบรับรองแทนใบเสร็จ → create → her expense: ถัดไป stays off, the category is named with who fixes it', async () => {
      await pressMenu(page, 'ใบรับรองแทนใบเสร็จ', 'ค่าใช้จ่ายและใบเสร็จ');
      await expect(main.getByRole('heading', { level: 1, name: 'ใบรับรองแทนใบเสร็จ', exact: true })).toBeVisible(FIRST_SIGHT);
      // With no certificate yet the page offers "สร้างใบรับรองแทนใบเสร็จ"; with some, "สร้างใบรับรอง".
      await main.getByRole('link', { name: /^สร้างใบรับรอง(แทนใบเสร็จ)?$/ }).first().click();
      await expect(main.getByRole('heading', { level: 1, name: 'สร้างใบรับรองแทนใบเสร็จ', exact: true })).toBeVisible(FIRST_SIGHT);
      await main.getByRole('textbox', { name: 'ค้นหาเลขที่ ผู้ขาย หรือรายการ', exact: true }).fill(item);
      await main.getByRole('button', { name: new RegExp(expenseNumber) }).click();

      await expect(main.getByText(whole(`${expenseNumber} · ${item} · 60.00 บาท`))).toBeVisible(AFTER_PRESS);
      const fault = main.getByRole('status').filter({ hasText: 'ยังไม่ได้เลือกหมวดหมู่' });
      await expect(fault).toContainText('⚠ ยังไม่ได้เลือกหมวดหมู่ เปิดค่าใช้จ่ายแล้วเลือกให้ทุกรายการ ให้เจ้าของกิจการหรือผู้ตรวจค่าใช้จ่ายเติมข้อมูลนี้');
      await expect(next).toBeDisabled();
      const missing = main.getByRole('status').filter({ hasText: 'ยังขาด:' });
      await expect(missing).toContainText('ยังขาด: หมวดหมู่ของรายการ');

      // Ticking what she can tick does not open the step: she is not let through to be refused later.
      await main.getByRole('checkbox', { name: 'เข้าใจแล้วว่าใบรับรองแทนใบเสร็จใช้ VAT ตอนยื่นภาษีไม่ได้', exact: true }).check();
      await expect(missing).toHaveText('ยังขาด: หมวดหมู่ของรายการ');
      await expect(next).toBeDisabled();
    });

    await test.step('the way out: เปิดค่าใช้จ่าย lands on her expense', async () => {
      await main.getByRole('status').filter({ hasText: 'ยังไม่ได้เลือกหมวดหมู่' }).getByRole('link', { name: 'เปิดค่าใช้จ่าย', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/expenses/${expenseId}$`), FIRST_SIGHT);
      await expect(main.getByText(expenseNumber, { exact: true })).toBeVisible(FIRST_SIGHT);
    });

    const expense = await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${expenseId}`));
    expect(expense.status).toBe('DRAFT');
    expect(expense.lines.map((line) => line.expenseCategoryId)).toEqual([null]);
    expect(expense.substituteReceiptEvidence).toBeNull();
  });
});
