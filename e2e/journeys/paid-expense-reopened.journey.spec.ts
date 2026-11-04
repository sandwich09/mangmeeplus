import { inflateRawSync } from 'node:zlib';
/** A paid expense keeps its payment while its document and supporting evidence are corrected. */
import type { Locator, Page } from '@playwright/test';
import { QA_ACCOUNTS } from '../harness/roles';
import { test, expect } from '../harness/fixtures';
import { chooseThemedOption, json, unique } from '../harness/e2e-utils';
import { AFTER_PRESS, FIRST_SIGHT, fillShopIdentity, inOrder, picture, recordExpenseByHand, thaiDate, pressForDownload, pressForDownloadBuffer, pressMenu } from './journey-kit';

type ExpenseDetail = {
  status: string; paymentStatus: string; paidAmount: string; primaryAttachmentId: string | null;
  vendorEntityKindSnapshot: string; whtCategoryCode: string; whtRate: string;
  payments: Array<{ id: string; status: string; amount: string }>;
  attachments: Array<{ id: string; originalFileName: string; purpose: string }>;
};

/** The server's refusal (expense-upload.use-case.ts, code expense_receipt_replace_locked). */
const REPLACE_REFUSED = 'รายจ่ายนี้บันทึกจ่ายแล้ว เปลี่ยนใบเสร็จหลักไม่ได้ ให้แนบเป็นหลักฐานเพิ่ม';

/** The phone and wide layouts each carry a labelled input; use the label the person can see. */
const fileControl = (main: Locator, label: string) => main.locator('label').filter({ hasText: label }).filter({ visible: true }).locator('input[type="file"]');

/** แก้ไขเอกสาร with a reason → the correction marker → ถัดไป: the confirmed expense is open for review, on step 2. */
async function reopenToStepTwo(page: Page, expenseNumber: string) {
  const main = page.locator('main');
  await main.getByRole('button', { name: 'แก้ไขเอกสาร', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'แก้ไขเอกสาร', exact: true });
  await expect(dialog).toContainText(expenseNumber);
  await expect(dialog).toContainText('รายการจ่ายเดิมยังอยู่');
  await dialog.getByRole('textbox', { name: 'เหตุผลที่แก้ไข', exact: true }).fill(unique('เพิ่มหลักฐานและแก้ประเภทผู้รับเงิน'));
  await dialog.getByRole('button', { name: 'เปิดเอกสารกลับไปตรวจสอบ', exact: true }).click();
  await expect(main.getByRole('status').filter({ hasText: 'กำลังแก้ไขเอกสารที่ยืนยันแล้ว' })).toBeVisible(AFTER_PRESS);
  await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ภาษีและเอกสาร' })).toBeVisible(AFTER_PRESS);
}

for (const width of [390, 1280, 1556]) test(`@journey an owner reopens a paid company expense, keeps its payment, the issuer receives the concerned notice, and accountant facts are exported at ${width}px`, async ({ pageAs, api, apiAs, companyId }) => {
  test.setTimeout(300_000);
  const page = await pageAs('OWNER');
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width, height: 1000 });
  const main = page.locator('main');
  const next = main.getByRole('button', { name: 'ถัดไป', exact: true });
  const seller = unique('ผู้รับค่าบริการตรวจอุปกรณ์');
  const supporting = picture(`${unique('หลักฐานเพิ่มเติม')}.png`);
  const replacement = picture(`${unique('ใบเสร็จที่เปลี่ยนไม่ได้')}.png`);
  await page.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);

  const expense = await test.step('owner: a picture, company service withholding at 3%, confirm and pay', () => recordExpenseByHand(page, {
    branch: 'Head Office (สำนักงานใหญ่)', item: unique('ค่าบริการตรวจอุปกรณ์'), seller,
    price: '1000', total: '1,000.00 บาท', toPay: '970.00 บาท', pay: true,
    withholding: {
      payeeKind: 'บริษัท / ห้างหุ้นส่วน', incomeType: 'ค่าบริการ (นิติบุคคล) · หัก 3%', rate: '3', withheld: '30.00 บาท',
      // Enter the certificate address through its own dialog below.
      taxId: '0105564000128', address: '',
    },
  }));
  const readExpense = async () => json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${expense.expenseId}`));
  const paid = await readExpense();
  await expect(main.getByText('จ่ายแล้วพิมพ์ใบสำคัญจ่ายได้จากประวัติการจ่าย', { exact: true })).toHaveCount(0);
  await expect(main.getByTestId('expense-payment-history').getByRole('button', { name: 'ออกใบสำคัญจ่าย', exact: true })).toBeVisible();
  await expect(main.getByText('หลักฐานว่าบันทึกจ่ายแล้ว', { exact: true })).toHaveCount(0);
  expect(paid.status).toBe('CONFIRMED');
  expect(paid.paymentStatus).toBe('PAID');
  expect(Number(paid.paidAmount)).toBe(970);
  expect(paid.payments).toHaveLength(1);
  expect(paid.primaryAttachmentId).toBeTruthy();
  expect(paid.whtCategoryCode).toBe('WHT_SERVICE_5');
  // Action capabilities change while reopened; the payment's stored identity, status and amount do not.
  const payments = paid.payments.map(({ id, status, amount }) => expect.objectContaining({ id, status, amount }));

  await test.step('owner fills missing shop identity before the issuer opens the certificate', async () => {
    const { identity: payer } = await json<{ identity: { masked: boolean; registeredName: string | null; taxId: string | null; addressJson: unknown } }>(await api.get(`companies/${companyId}/identity`));
    expect(payer.masked, 'The owner must be able to read the full shop identity').toBe(false);
    if (!payer.registeredName || !payer.taxId || !payer.addressJson) await fillShopIdentity(page, companyId);
    await page.goto(`/companies/${companyId}/expenses/${expense.expenseId}`, FIRST_SIGHT);
    await expect(main.getByRole('heading', { level: 1, name: seller, exact: true })).toBeVisible(FIRST_SIGHT);
  });

  const issuer = await pageAs('FINANCE');
  await issuer.setViewportSize({ width, height: 1000 });
  const issuerMain = issuer.locator('main');
  let certificateNumber = '';
  await test.step('finance issues the paid expense certificate before another person corrects it', async () => {
    await issuer.goto(`/companies/${companyId}/expenses/${expense.expenseId}#wht-certificate`, FIRST_SIGHT);
    const certificate = issuerMain.locator('.mangmee-card').filter({ has: issuer.locator('h2#wht-certificate') });
    await expect(certificate).toBeVisible(AFTER_PRESS);
    const addAddress = certificate.getByRole('button', { name: 'เพิ่มที่อยู่', exact: true });
    await expect(addAddress).toBeVisible(AFTER_PRESS);
    await addAddress.click();
    const addressDialog = issuer.getByRole('dialog', { name: 'เพิ่มที่อยู่ผู้รับเงิน', exact: true });
    const payeeAddress = '45 ถนนสีลม แขวงสีลม เขตบางรัก กรุงเทพมหานคร 10500';
    await addressDialog.getByRole('textbox', { name: 'ที่อยู่ผู้รับเงินบนหนังสือรับรอง', exact: true }).fill(payeeAddress);
    await addressDialog.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(addressDialog).toBeHidden(AFTER_PRESS);
    await expect(certificate.getByText(payeeAddress, { exact: true })).toBeVisible(AFTER_PRESS);
    const issue = certificate.getByRole('button', { name: 'ออกเลขที่และดาวน์โหลด', exact: true });
    await expect(issue, 'Complete shop identity, confirmed payment and payee address must allow certificate issue').toBeVisible(AFTER_PRESS);
    await issue.click();
    const dialog = issuer.getByRole('dialog', { name: 'ออกหนังสือรับรอง 50 ทวิ ให้ผู้รับเงิน', exact: true });
    await expect(dialog.getByRole('term').filter({ hasText: /^จ่ายค่าอะไร$/ })).toBeVisible();
    await expect(dialog.getByRole('definition')).toContainText(['1,000.00 บาท', '30.00 บาท']);
    const file = await pressForDownload(issuer, () => dialog.getByRole('button', { name: 'ออกเลขที่และดาวน์โหลด', exact: true }).click());
    expect(file.head).toBe('%PDF-');
    certificateNumber = file.name.match(/WHT-\d{4}-\d{5}/)![0];
    expect(certificateNumber).toBeTruthy();
  });
  // The expense already isolates this notice; a timestamp would be masked as sensitive digits.
  const correctionReason = 'เพิ่มหลักฐานและแก้ประเภทผู้รับเงิน';
  await test.step('owner attests before cancelling the issuer’s certificate and reopening the same paid expense', async () => {
    await page.reload();
    await main.getByRole('button', { name: 'แก้ไขเอกสาร', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'แก้ไขเอกสาร', exact: true });
    await expect(dialog).toContainText(certificateNumber);
    await dialog.getByRole('textbox', { name: 'เหตุผลที่แก้ไข', exact: true }).fill(correctionReason);
    const reopen = dialog.getByRole('button', { name: 'ยกเลิกหนังสือรับรองและแก้ไขเอกสาร', exact: true });
    await expect(reopen).toBeDisabled();
    await dialog.getByRole('radio', { name: 'ยังไม่ได้ยื่นภาษีหัก ณ ที่จ่ายของรายการนี้', exact: true }).check();
    await reopen.click();
    await expect(dialog).toBeHidden(AFTER_PRESS);
    await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ภาษีและเอกสาร' })).toBeVisible(AFTER_PRESS);
  });
  await test.step('the original issuer receives the cancellation notice and its link opens this expense', async () => {
    const financeApi = await apiAs('FINANCE');
    const managerApi = await apiAs('MANAGER');
    type Notices = { items: Array<{ deepLinkHref: string; triggerKey: string; title: string; body: string }> };
    const notices = await json<Notices>(await financeApi.get(`companies/${companyId}/notifications?pageSize=100`));
    const concerned = notices.items.filter(notice => notice.deepLinkHref === `/companies/${companyId}/expenses/${expense.expenseId}#wht-certificate` && notice.triggerKey === 'expense.wht_certificate_cancelled');
    expect(concerned).toHaveLength(1);
    expect(concerned[0]!.title).toContain(certificateNumber);
    expect(concerned[0]!.body).toContain(`${QA_ACCOUNTS.OWNER.displayName} แก้ไขเอกสารรายจ่ายนี้ ระบบจึงยกเลิกหนังสือรับรองใบเดิม`);
    expect(concerned[0]!.body).toContain(correctionReason);
    const unrelated = await json<Notices>(await managerApi.get(`companies/${companyId}/notifications?pageSize=100`));
    expect(unrelated.items.filter(notice => notice.deepLinkHref === `/companies/${companyId}/expenses/${expense.expenseId}#wht-certificate` && notice.triggerKey === 'expense.wht_certificate_cancelled')).toHaveLength(0);
    await issuer.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);
    const header = issuer.locator('header');
    await header.getByRole('button', { name: /^การแจ้งเตือน/ }).click();
    await header.getByRole('group', { name: 'สถานะการแจ้งเตือน' }).getByRole('button', { name: 'ทั้งหมด', exact: true }).click();
    const notice = header.getByRole('link').filter({ hasText: certificateNumber });
    await expect(notice).toHaveCount(1, AFTER_PRESS);
    await expect(notice).toContainText('ระบบจึงยกเลิกหนังสือรับรองใบเดิม');
    await notice.click();
    await expect(issuer).toHaveURL(new RegExp(`/expenses/${expense.expenseId}#wht-certificate$`), AFTER_PRESS);
  });

  await test.step('แนบหลักฐานเพิ่ม keeps the payment; replacing the main receipt is refused', async () => {
    await main.locator('summary').filter({ hasText: /^ตัวเลือกไฟล์$/ }).filter({ visible: true }).first().click();
    await fileControl(main, 'แนบหลักฐานเพิ่ม').setInputFiles(supporting);
    await expect(page.getByRole('status').filter({ hasText: 'แนบไฟล์ใบเสร็จแล้ว' }).first()).toBeVisible(AFTER_PRESS);
    const supportingRow = main.getByTestId('expense-attachment-list').locator(':scope > div').filter({ hasText: supporting.name });
    // Phone lists files under the page; a wide screen shows them beside the form.
    // The named file list is the phone layout (lg:hidden); a wide screen shows the files as a preview beside the form.
    if (width < 1024) {
      await expect(supportingRow.getByText(supporting.name, { exact: true })).toBeVisible(AFTER_PRESS);
      await expect(supportingRow.getByRole('button', { name: 'ดูไฟล์', exact: true })).toBeEnabled();
    }
    const appended = await readExpense();
    expect(appended.attachments).toContainEqual(expect.objectContaining({ originalFileName: supporting.name, purpose: 'expense.receipt.supporting' }));
    expect(appended.paidAmount).toBe(paid.paidAmount);
    expect(appended.payments).toEqual(payments);
    expect(appended.primaryAttachmentId).toBe(paid.primaryAttachmentId);

    await fileControl(main, 'เปลี่ยนไฟล์ใบเสร็จ').setInputFiles(replacement);
    // At the press the refusal is said in a toast (outside main, gone after a few seconds). What stays
    // on the page is checked separately below.
    await expect(page.getByRole('alert').filter({ hasText: REPLACE_REFUSED }).first()).toBeVisible(AFTER_PRESS);
    const refused = await readExpense();
    expect(refused.primaryAttachmentId).toBe(paid.primaryAttachmentId);
    expect(refused.attachments).toEqual(appended.attachments);
    expect(refused.payments).toEqual(payments);
  });

  await test.step('กลับ → person clears จ่ายค่าอะไร → choose the person service type → ถัดไป saves it', async () => {
    await main.getByRole('button', { name: 'กลับ', exact: true }).click();
    await expect(main.getByRole('combobox', { name: 'ผู้รับเงินเป็นใคร', exact: true })).toHaveText('บริษัท / ห้างหุ้นส่วน');
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'ผู้รับเงินเป็นใคร', exact: true }), 'บุคคลธรรมดา');
    const income = main.getByRole('combobox', { name: 'จ่ายค่าอะไร', exact: true });
    await expect(income).toHaveText('ยังไม่ระบุ');
    await chooseThemedOption(page, income, 'ค่าบริการ (บุคคลธรรมดา) · หัก 3%');
    await expect(main.getByRole('textbox', { name: /^อัตราหัก ณ ที่จ่าย/ })).toHaveValue('3');
    const taxId = main.getByRole('textbox', { name: 'เลขประจำตัวผู้เสียภาษีผู้ขาย', exact: true });
    await expect(taxId).toBeVisible();
    await taxId.fill('3101200456789');
    await next.click();
    await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ภาษีและเอกสาร' })).toBeVisible(AFTER_PRESS);
    const person = await readExpense();
    expect(person.vendorEntityKindSnapshot).toBe('INDIVIDUAL');
    expect(person.whtCategoryCode).toBe('WHT_SERVICE_3');
    expect(Number(person.whtRate)).toBe(3);
  });

  await test.step('ยืนยันเอกสาร again, with the same payment and main receipt', async () => {
    await next.click();
    await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ตรวจสรุป' })).toBeVisible(AFTER_PRESS);
    await main.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true }).click();
    await expect(page.getByText('ยืนยันเอกสารแล้ว', { exact: true }).first()).toBeVisible(AFTER_PRESS);
    await expect(main.locator('.mangmee-page-header').getByText('จ่ายแล้ว', { exact: true })).toBeVisible();
    // With tax withheld and no 50 ทวิ yet the page has no "จ่ายครบแล้ว" line; it shows nothing left to pay and the same payment.
    await expect(main.getByText(/^ต้องจ่าย /)).toHaveCount(0);
    await expect(main).toContainText(inOrder('ประวัติการจ่าย', `${thaiDate()} · โอนเงิน`, '970.00 บาท'));
    await expect(main.getByTestId('expense-detail-totals')).toContainText(inOrder('จ่ายแล้ว', '970.00', 'บาท'));
    await expect(main.getByText('ยอดที่ต้องจ่าย (หลังหัก ณ ที่จ่าย)', { exact: true })).toHaveCount(0);
  });

  const confirmed = await readExpense();
  expect(confirmed.status).toBe('CONFIRMED');
  expect(confirmed.paymentStatus).toBe('PAID');
  expect(confirmed.paidAmount).toBe(paid.paidAmount);
  expect(confirmed.payments).toEqual(payments);
  expect(confirmed.primaryAttachmentId).toBe(paid.primaryAttachmentId);
  expect(confirmed.attachments).toHaveLength(paid.attachments.length + 1);
  expect(confirmed.vendorEntityKindSnapshot).toBe('INDIVIDUAL');
  expect(confirmed.whtCategoryCode).toBe('WHT_SERVICE_3');
  await test.step('the paid human history keeps action, actor and time and closes safely', async () => {
    await main.locator('summary').filter({ hasText: /^เพิ่มเติม$/ }).click();
    await main.getByRole('button', { name: 'ดูประวัติ', exact: true }).click();
    const history = page.getByRole('dialog', { name: /ประวัติรายการจ่าย/ });
    for (const action of ['บันทึกการจ่ายเงิน', 'เปิดรายการจ่ายให้ตรวจใหม่']) {
      const row = history.getByRole('listitem').filter({ hasText: action });
      await expect(row).toHaveCount(1, AFTER_PRESS);
      await expect(row).toContainText(QA_ACCOUNTS.OWNER.displayName);
      await expect(row.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
    }
    await history.getByRole('button', { name: 'ปิด', exact: true }).last().click();
    await expect(history).toHaveCount(0);
  });
  await test.step('the accounting-office download retains its statutory columns and the same paid amounts', async () => {
    await pressMenu(page, 'หลักฐานทางบัญชี', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(main.getByRole('link').filter({ hasText: seller }).filter({ visible: true })).toBeVisible(AFTER_PRESS);
    const file = await pressForDownloadBuffer(page, () => main.getByRole('button', { name: 'ดาวน์โหลด Excel', exact: true }).click());
    expect(file.name).toMatch(/\.xlsx$/);
    const sheet = new Map<string, Buffer>();
    for (let offset = 0; file.buffer.readUInt32LE(offset) === 0x04034b50;) {
      const size = file.buffer.readUInt32LE(offset + 18), length = file.buffer.readUInt16LE(offset + 26);
      const name = file.buffer.subarray(offset + 30, offset + 30 + length).toString();
      const start = offset + 30 + length + file.buffer.readUInt16LE(offset + 28);
      const bytes = file.buffer.subarray(start, start + size);
      sheet.set(name, file.buffer.readUInt16LE(offset + 8) === 8 ? inflateRawSync(bytes) : bytes);
      offset = start + size;
    }
    const rows = [...sheet.get('xl/worksheets/sheet1.xml')!.toString().matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row =>
      [...row[1]!.matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)].map(cell => cell[1]!.match(/<t\b[^>]*>([\s\S]*?)<\/t>|<v>([^<]*)<\/v>/)?.slice(1).find(value => value !== undefined) ?? ''));
    const [headers, ...data] = rows;
    for (const statutory of ['สิทธิภาษีซื้อ', 'มูลค่าก่อน VAT', 'หัก ณ ที่จ่าย (ทั้งเอกสาร)']) expect(headers).toContain(statutory);
    const row = data.find(row => row[headers!.indexOf('เลขที่รายการ')] === expense.expenseNumber)!;
    expect(row).toBeDefined();
    expect(row[headers!.indexOf('ผู้ขาย/ผู้รับเงิน')]).toBe(seller);
    for (const [label, value] of [['ยอดรวมตามเอกสาร', 1000], ['หัก ณ ที่จ่าย (ทั้งเอกสาร)', 30], ['จ่ายแล้ว', 970], ['ค้างจ่าย', 0]] as const)
      expect(Number(row[headers!.indexOf(label)])).toBe(value);
  });
});

test('@journey the notice left on the page after a refused receipt replacement on a paid expense says why and what to do instead', async ({ pageAs, companyId }) => {
  test.setTimeout(300_000);
  const page = await pageAs('OWNER');
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const main = page.locator('main');
  await page.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);
  const expense = await recordExpenseByHand(page, {
    branch: 'Head Office (สำนักงานใหญ่)', item: unique('ค่าซ่อมเครื่องพิมพ์'), seller: unique('ร้านซ่อมเครื่องพิมพ์'),
    price: '800', total: '800.00 บาท', toPay: '800.00 บาท', pay: true,
  });
  await reopenToStepTwo(page, expense.expenseNumber);

  await fileControl(main, 'เปลี่ยนไฟล์ใบเสร็จ').setInputFiles(picture(`${unique('ใบเสร็จที่เปลี่ยนไม่ได้')}.png`));
  // The one notice of the page carries the server's own sentence, which names the way out (แนบหลักฐานเพิ่ม)…
  await expect(main.getByRole('alert')).toHaveText(`⚠ ${REPLACE_REFUSED}`, AFTER_PRESS);
  // …and nothing on the page says that attaching is impossible here: แนบหลักฐานเพิ่ม works on this very step.
  await expect(main.getByText(/เปลี่ยนหรือแนบไฟล์ตรงนี้ไม่ได้/)).toHaveCount(0);
});
