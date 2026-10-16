import { deflateSync, crc32 } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { test, expect } from './harness/fixtures';
import { firstActiveBranch, gotoCompany, json, unique } from './harness/e2e-utils';

type Counterparty = {
  id: string;
  displayName: string;
  email?: string | null;
  phone: string | null;
  billingAddressJson: { addressText?: string; postalCode?: string; locked?: boolean } | null;
};

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function uniqueReceiptPng(): Buffer {
  const size = 4;
  const rows = Buffer.concat(Array.from({ length: size }, () => Buffer.concat([Buffer.from([0]), randomBytes(size * 3)])));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test.describe('CP — counterparty registry permissions', () => {
  test('CP-01 @p1 Finance can create and edit; Accountant can read but not edit', async ({ pageAs, apiAs, companyId }) => {
    const financeApi = await apiAs('FINANCE');
    const financePage = await pageAs('FINANCE');
    const originalName = unique('E2E counterparty');
    const updatedName = `${originalName} edited`;

    await gotoCompany(financePage, companyId, '/counterparties');
    await expect(financePage.getByRole('button', { name: 'เพิ่มคู่ค้า', exact: true })).toBeVisible();
    await expect(financePage.locator('.mangmee-page')).toHaveClass(/mangmee-flat/);
    await expect(financePage.locator('.mangmee-page-description')).toHaveCount(0);
    await expect(financePage.getByText(/^ทั้งหมด \d+ ราย$/)).toHaveCount(0);
    await expect(financePage.getByRole('group', { name: 'คู่ค้า', exact: true }).getByRole('button', { name: /^ทั้งหมด/ })).toBeVisible();
    await financePage.getByRole('button', { name: 'เพิ่มคู่ค้า', exact: true }).click();
    const dialog = financePage.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'ชื่อ', exact: true }).fill(originalName);
    const createResponsePromise = financePage.waitForResponse((response) =>
      response.url().includes(`/companies/${companyId}/accounting/counterparties`)
      && response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'เพิ่มคู่ค้า', exact: true }).click();
    const created = await json<Counterparty>(await createResponsePromise);
    await expect(financePage.getByRole('heading', { name: originalName, exact: true })).toBeVisible();

    const displayName = financePage.getByRole('textbox', { name: 'ชื่อ', exact: true });
    await expect(displayName).toBeEnabled();
    await displayName.fill(updatedName);
    await financePage.getByRole('textbox', { name: 'ที่อยู่ตามเอกสาร', exact: false }).fill('123 ถนนสุขุมวิท กรุงเทพฯ');
    await financePage.getByRole('textbox', { name: 'รหัสไปรษณีย์', exact: true }).fill('10110');
    await financePage.getByRole('textbox', { name: 'อีเมล', exact: true }).fill('counterparty@example.test');
    await financePage.getByRole('textbox', { name: 'เบอร์โทร', exact: true }).fill('0812345678');
    await financePage.getByRole('checkbox', { name: 'ล็อกที่อยู่หลัก', exact: false }).check();
    await expect(financePage.getByText('พิมพ์ตามที่ใบระบุ', { exact: true })).toHaveCount(1);
    await expect(financePage.getByText('ที่อยู่นี้จะพิมพ์ลงเอกสาร พิมพ์ตามที่ใบระบุ', { exact: true })).toHaveCount(0);
    await financePage.locator('[data-form-action-bar]').getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(financePage.getByText('บันทึกข้อมูลคู่ค้าแล้ว', { exact: true }).first()).toBeVisible();

    const saved = await json<Counterparty>(await financeApi.get(`companies/${companyId}/accounting/counterparties/${created.id}`));
    expect(saved.displayName).toBe(updatedName);
    expect(saved.email).toBe('counterparty@example.test');
    expect(saved.phone).toBe('0812345678');
    expect(saved.billingAddressJson).toMatchObject({ addressText: '123 ถนนสุขุมวิท กรุงเทพฯ', postalCode: '10110', locked: true });

    await financePage.getByRole('textbox', { name: 'อีเมล', exact: true }).fill('');
    await financePage.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(financePage.getByText('บันทึกข้อมูลคู่ค้าแล้ว', { exact: true }).first()).toBeVisible();
    const cleared = await json<Counterparty>(await financeApi.get(`companies/${companyId}/accounting/counterparties/${created.id}`));
    expect(cleared.email ?? null).toBeNull();

    const accountantApi = await apiAs('ACCOUNTANT');
    const accountantPage = await pageAs('ACCOUNTANT');
    await gotoCompany(accountantPage, companyId, `/counterparties/${created.id}`);
    await expect(accountantPage.getByText('ดูอย่างเดียว ขอสิทธิ์จัดการคู่ค้าจากเจ้าของกิจการหรือผู้มีสิทธิ์จัดการบทบาทจึงจะแก้ไขได้', { exact: true })).toBeVisible();
    await expect(accountantPage.getByRole('textbox', { name: 'ชื่อ', exact: true })).toBeDisabled();
    await expect(accountantPage.getByRole('button', { name: 'บันทึก', exact: true })).toHaveCount(0);

    const deniedUpdate = await accountantApi.patch(`companies/${companyId}/accounting/counterparties/${created.id}`, {
      data: { displayName: 'should be denied' },
    });
    expect(deniedUpdate.status()).toBe(403);
  });

  test('CP-02 @p1 receipt uploader can open and edit only the counterparty their receipt created', async ({ pageAs, apiAs, request, companyId }) => {
    const staffApi = await apiAs('STAFF');
    const staffPage = await pageAs('STAFF');
    const branch = await firstActiveBranch(staffApi, companyId);
    const vendor = unique('E2E receipt vendor');
    const expense = await json<{ id: string; updatedAt: string }>(await staffApi.post(`companies/${companyId}/expenses`, {
      data: {
        captureSource: 'WEB_MANUAL', branchId: branch.id, expenseDate: new Date().toISOString(),
        vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE', missingReceiptReason: 'E2E receipt uploaded',
        note: unique('E2E receipt expense'), lines: [{ lineNumber: 1, description: 'Receipt uploader scope', quantity: '1', unitPrice: '10' }],
      },
    }));
    const receipt = uniqueReceiptPng();
    const intent = await json<{ attachmentId: string; uploadUrl: string; uploadHeaders: Record<string, string> }>(
      await staffApi.post(`companies/${companyId}/attachments/upload-intent`, {
        data: { originalFileName: unique('counterparty-receipt') + '.png', mimeType: 'image/png', byteSize: receipt.length, visibility: 'INTERNAL' },
      }),
    );
    const upload = await request.put(intent.uploadUrl, { data: receipt, headers: { ...intent.uploadHeaders, 'Content-Type': 'image/png' } });
    expect(upload.status()).toBe(200);
    const uploaded = await json<{ id: string; updatedAt: string }>(await staffApi.post(
      `companies/${companyId}/expenses/${expense.id}/receipt-uploads/${intent.attachmentId}/complete`,
      { data: { byteSize: receipt.length, purpose: 'expense.receipt.primary' } },
    ));
    const financeApi = await apiAs('FINANCE');
    const saved = await json<{ vendorCounterpartyAutoSave?: { counterpartyId?: string; canOpenCounterparty?: true } }>(
      await financeApi.patch(`companies/${companyId}/expenses/${uploaded.id}/review-fields`, {
        data: { expectedUpdatedAt: uploaded.updatedAt, vendorNameSnapshot: vendor },
      }),
    );
    const counterpartyId = saved.vendorCounterpartyAutoSave?.counterpartyId;
    expect(counterpartyId).toBeTruthy();
    expect(saved.vendorCounterpartyAutoSave?.canOpenCounterparty).toBe(true);

    await gotoCompany(staffPage, companyId, `/expenses/${expense.id}`);
    await expect(staffPage.getByRole('textbox', { name: /^ชื่อผู้ขาย/ })).toHaveValue(vendor);
    await staffPage.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    const scopedLink = staffPage.getByRole('link', { name: 'ดู', exact: true });
    await expect(scopedLink).toHaveAttribute('href', new RegExp(`/counterparties/${counterpartyId}$`));
    await scopedLink.click();
    const name = staffPage.getByRole('textbox', { name: 'ชื่อ', exact: true });
    await expect(name).toBeEnabled();
    await expect(staffPage.getByRole('button', { name: 'บันทึก', exact: true })).toBeVisible();
    await name.fill(`${vendor} แก้แล้ว`);
    await staffPage.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(staffPage.getByText('บันทึกข้อมูลคู่ค้าแล้ว', { exact: true }).first()).toBeVisible();

    const accountantApi = await apiAs('ACCOUNTANT');
    const denied = await accountantApi.patch(`companies/${companyId}/accounting/counterparties/${counterpartyId}`, {
      data: { displayName: 'should be denied' },
    });
    expect(denied.status()).toBe(403);
  });
});
