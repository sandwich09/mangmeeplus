import { test, expect } from './harness/fixtures';
import { gotoCompany, chooseThemedOption } from './harness/e2e-utils';
import type { WithholdingMonthDto } from '@watchdog-bms/contracts';

// Deterministic screen regressions over the seeded owner session. Real tax rules are covered by
// the registered API specs; these responses isolate the exact refusal and layout seen in review.
for (const width of [390, 1280, 1556, 1680]) {
  test(`withholding refusal, fixing links, sync and paging at ${width}px`, async ({ authedPage: page, companyId }) => {
    await page.setViewportSize({ width, height: 900 });
    const sentence = 'ข้อมูลร้านยังขาด: ชื่อจดทะเบียน · เปิดข้อมูลร้านแล้วแก้ไข';
    const month: WithholdingMonthDto = {
      periodKey: '2026-10',
      undatedPayments: [{ paymentId: 'undated', expenseId: 'expense-undated', payeeName: 'ผู้รับที่ยังไม่รู้วันที่จ่าย', amount: '970.00', recordedAt: '2026-10-01', recordedByUserId: 'owner' }],
      forms: (['PND3', 'PND53'] as const).map(formType => ({ formType, periodId: formType, status: 'OPEN', paymentCount: 30,
        totalPaid: '30000', totalWithheld: '900', dueDate: '2026-11-07', issues: formType === 'PND3' ? [] : [
          { id: 'linked', issueCode: 'WHT_PAYEE_KIND_UNKNOWN', description: 'ยังไม่รู้ว่า สมชาย เป็นบริษัทหรือบุคคล เปิดคู่ค้าแล้วเลือกประเภทก่อน', severity: 'BLOCKING', sourceType: 'expense.record', sourceId: 'expense-linked', expenseId: 'expense-linked', counterpartyId: 'counterparty-linked' },
          { id: 'unlinked', issueCode: 'WHT_PAYEE_KIND_UNKNOWN', description: 'ยังไม่รู้ว่า สมศรี เป็นบริษัทหรือบุคคล เปิดรายจ่ายแล้วเลือกว่าผู้รับเงินเป็นบริษัทหรือบุคคล', severity: 'BLOCKING', sourceType: 'expense.record', sourceId: 'expense-unlinked', expenseId: 'expense-unlinked', counterpartyId: null },
        ] })),
      payments: Array.from({ length: 60 }, (_, i) => ({ id: String(i).padStart(2, '0'), paymentDate: '2026-10-01', payeeName: `ผู้รับเงิน ${i + 1}`, formType: i % 2 ? 'PND53' : 'PND3', incomeCategoryCode: i % 2 ? 'WHT_SERVICE_5' : 'WHT_SERVICE_3', sourceType: 'expense.record', sourceId: `expense-${i}`, incomeCategoryLabel: 'ค่าบริการ', rate: '3', paid: '1000', withheld: '30', expenseId: `expense-${i}`, certificate: null })),
    };
    let reads = 0, syncs = 0;
    await page.route(`**/api/v1/companies/${companyId}/tax/withholding/**`, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/months')) return route.fulfill({ json: { months: ['2026-10'] } });
      if (path.endsWith('/months/2026-10')) { reads++; return route.fulfill({ json: month }); }
      if (path.endsWith('/PND53/sync')) { syncs++; if (syncs > 1) month.forms[0].issues = []; expect(route.request().method()).toBe('POST'); return route.fulfill({ json: { synced: true } }); }
      if (path.endsWith('/PND3/periods/PND3/export')) {
        month.forms[0].issues = [{ id: 'payer', issueCode: 'PND3_FILING_PAYER', description: sentence, severity: 'BLOCKING', sourceType: null, sourceId: null, expenseId: null, counterpartyId: null }];
        return route.fulfill({ status: 409, json: { code: 'PND3_FILING_PAYER', message: sentence } });
      }
      return route.continue();
    });
    await gotoCompany(page, companyId, '/tax/withholding');
    const pnd3 = page.locator('.mangmee-card').filter({ has: page.getByRole('heading', { name: 'ภ.ง.ด.3 (จ่ายให้บุคคล)', exact: true }) });
    const pnd53 = page.locator('.mangmee-card').filter({ has: page.getByRole('heading', { name: 'ภ.ง.ด.53 (จ่ายให้บริษัท)', exact: true }) });
    const button3 = pnd3.getByRole('button', { name: 'ดาวน์โหลดแบบ ภ.ง.ด.3', exact: true });
    const button53 = pnd53.getByRole('button', { name: 'ดาวน์โหลดแบบ ภ.ง.ด.53', exact: true });
    await expect(button3).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const first = (await button3.boundingBox())!, second = (await button53.boundingBox())!;
    expect(Math.abs(first.width - second.width)).toBeLessThan(1);
    expect(first.height).toBe(second.height);
    if (width >= 1024) expect(Math.abs(first.y - second.y)).toBeLessThan(1);
    const unknown = page.locator('.mangmee-card').filter({ has: page.getByRole('heading', { name: 'ต้องแก้ก่อนยื่น', exact: true }) });
    await expect(unknown.getByRole('link', { name: /ผู้รับที่ยังไม่รู้วันที่จ่าย/ })).toHaveAttribute('href', `/companies/${companyId}/expenses/expense-undated?section=payment`);
    await expect(page.getByRole('button', { name: 'บันทึกวันที่จ่ายจริง', exact: true })).toHaveCount(0);
    await expect(page.locator('input[type=date]')).toHaveCount(0);
    await expect(unknown.getByRole('link', { name: 'เปิดคู่ค้า', exact: true })).toHaveAttribute('href', `/companies/${companyId}/counterparties/counterparty-linked`);
    await expect(unknown.getByRole('link', { name: 'เปิดรายจ่าย', exact: true })).toHaveAttribute('href', `/companies/${companyId}/expenses/expense-unlinked`);
    await button3.click();
    await expect(pnd3.getByText(sentence)).toBeVisible();
    await expect(button3).toBeEnabled();
    const refusedReads = reads;
    await button3.click();
    await expect(pnd3.getByText(sentence)).toBeVisible();
    expect(reads).toBe(refusedReads);
    await expect(pnd3.getByRole('link', { name: 'ตั้งค่าร้าน › ข้อมูลร้าน' })).toHaveAttribute('href', `/companies/${companyId}/settings/profile?from=withholding`);
    await expect(pnd3).not.toContainText('รายการนี้ทำต่อไม่ได้ในสถานะปัจจุบัน');
    await expect(button53).toBeEnabled();
    const before = reads;
    await page.getByRole('button', { name: 'ดึงรายการล่าสุด', exact: true }).click();
    await expect(page.getByText('ดึงรายการล่าสุดแล้ว', { exact: true })).toHaveCount(1);
    expect(syncs).toBe(2);
    await expect(button3).toBeEnabled();
    await expect(pnd3.getByText(sentence)).toHaveCount(0); expect(reads).toBeGreaterThan(before);
    const heading = page.getByRole('heading', { name: 'รายการที่หักภาษีของเดือนนี้' });
    const list = page.locator('.mangmee-card').filter({ has: heading });
    await expect(list.locator('tbody tr')).toHaveCount(10);
    await expect(list.getByRole('link', { name: 'เปิดรายจ่าย', exact: true })).toHaveCount(0);
    await expect(list).not.toContainText('฿');
    await list.getByRole('button', { name: 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่', exact: true }).click();
    const overflow = await list.locator('td:visible').evaluateAll(cells => cells.filter(cell => cell.scrollWidth > cell.clientWidth).map(cell => cell.textContent));
    expect(overflow).toEqual([]);
    await list.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(heading).toBeInViewport();
    await expect(list.getByText('ผู้รับเงิน 11', { exact: true }).filter({ visible: true })).toBeVisible();
    await list.getByRole('button', { name: /^ภ.ง.ด.3\s*30$/ }).click();
    await expect(list.getByText('ผู้รับเงิน 1', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(list.getByText('ผู้รับเงิน 2', { exact: true })).toHaveCount(0);
    const paymentFix = unknown.getByRole('link', { name: /ผู้รับที่ยังไม่รู้วันที่จ่าย/ });
    await paymentFix.focus(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/companies/${companyId}/expenses/expense-undated\\?section=payment$`));
  });

  test(`a changed return needs a new Thai-named download before filing at ${width}px`, async ({ authedPage: page, companyId }) => {
    await page.setViewportSize({ width, height: 900 });
    const month: WithholdingMonthDto = { periodKey: '2026-10', payments: [], forms: (['PND3', 'PND53'] as const).map(formType => ({
      formType, periodId: formType, status: 'OPEN', paymentCount: 1, totalPaid: '1000', totalWithheld: '30', dueDate: '2026-11-07', issues: [],
    })) };
    let changed = false;
    await page.route(`**/api/v1/companies/${companyId}/tax/withholding/**`, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/months')) return route.fulfill({ json: { months: ['2026-10'] } });
      if (path.endsWith('/months/2026-10')) return route.fulfill({ json: month });
      if (path.endsWith('/sync')) {
        if (changed) for (const form of month.forms) {
          form.paymentCount = 2; form.totalPaid = '2000'; form.totalWithheld = '60';
          form.issues = [{ id: 'changed', issueCode: 'WHT_FILING_CHANGED_AFTER_DOWNLOAD', severity: 'WARNING', description: 'ดาวน์โหลดแบบใหม่ก่อนยื่น', sourceType: null, sourceId: null, expenseId: null, counterpartyId: null }];
        }
        return route.fulfill({ json: {} });
      }
      const form = month.forms.find(form => path.includes(`/${form.formType}/periods/`));
      if (form && path.endsWith('/export')) {
        form.status = 'EXPORTED'; form.issues = [];
        return route.fulfill({ json: { artifact: { fileName: `ภ.ง.ด.${form.formType === 'PND3' ? '3' : '53'}-2026-10.pdf`, mimeType: 'application/pdf', contentBase64: Buffer.from('%PDF-1.4\n%%EOF').toString('base64') } } });
      }
      if (form && path.endsWith('/mark-filed')) { form.status = 'FILED'; return route.fulfill({ json: {} }); }
      return route.continue();
    });
    await gotoCompany(page, companyId, '/tax/withholding');
    for (const name of ['ภ.ง.ด.3', 'ภ.ง.ด.53']) {
      const card = page.locator('.mangmee-card').filter({ has: page.getByRole('heading', { name: `${name} (${name === 'ภ.ง.ด.3' ? 'จ่ายให้บุคคล' : 'จ่ายให้บริษัท'})`, exact: true }) });
      const download = card.getByRole('button', { name: `ดาวน์โหลดแบบ ${name}`, exact: true });
      const file = page.waitForEvent('download'); await download.click();
      expect((await file).suggestedFilename()).toBe(`${name}-2026-10.pdf`);
      await expect(page.getByText(`ดาวน์โหลดแบบ ${name} แล้ว`, { exact: true })).toBeVisible();
      const filed = card.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว', exact: true });
      await expect(filed).toBeVisible();
      const a = (await download.boundingBox())!, b = (await filed.boundingBox())!;
      expect(a.y).toBeLessThan(b.y);
      expect(a.width).toBe(b.width); expect(a.height).toBe(b.height);
    }
    changed = true;
    await page.getByRole('button', { name: 'ดึงรายการล่าสุด', exact: true }).click();
    await expect(page.getByText('มีรายการเปลี่ยนหลังดาวน์โหลดแบบ', { exact: true })).toHaveCount(2);
    await expect(page.getByText('ดาวน์โหลดแบบใหม่ก่อนยื่น', { exact: true })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว', exact: true })).toHaveCount(0);
    const card = page.locator('.mangmee-card').filter({ has: page.getByRole('heading', { name: 'ภ.ง.ด.3 (จ่ายให้บุคคล)', exact: true }) });
    const again = page.waitForEvent('download'); await card.getByRole('button', { name: 'ดาวน์โหลดแบบ ภ.ง.ด.3', exact: true }).click(); await again;
    await expect(card.getByText('ดาวน์โหลดแบบแล้ว', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('บันทึกว่ายื่น ภ.ง.ด.3 ยื่นปกติ เดือน ต.ค. 2569 แล้ว?', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว', exact: true }).click();
    await expect(card.getByText('ยื่นแล้ว', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'ดาวน์โหลดแบบที่ยื่น', exact: true })).toBeVisible();
  });

  test(`certificate month and form share controls at ${width}px`, async ({ authedPage: page, companyId }) => {
    await page.setViewportSize({ width, height: 900 });
    const queries: URLSearchParams[] = [];
    await page.route(`**/api/v1/companies/${companyId}/wht/payment-handoffs?**`, route => {
      queries.push(new URL(route.request().url()).searchParams);
      return route.fulfill({ json: {
      rows: [{ id: 'h', companyId, status: 'SYSTEM_ISSUED', sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1', expenseId: 'expense-1', expenseNumber: 'EX-01', payeeName: 'สมชาย', payeeTaxId: '1234567890123', documentDate: '2026-10-11', formType: 'PND3', withheldAmount: '3', missing: [], systemReplacementOpen: true, certificateId: 'cert', certificateNumber: 'WT-01', certificateIssuedAt: '2026-10-11', prefill: { grossAmount: '100', withheldAmount: '3' } }], total: 21, page: 1, pageSize: 10, counts: { REQUIRED: 0, SYSTEM_ISSUED: 21, EXTERNAL_LINKED: 0, CANCELLED: 0 }, sums: { withheld: '63.00' }, months: ['2026-10', '2026-07'],
    } }); });
    await gotoCompany(page, companyId, '/expenses/wht-certificates?tab=system');
    const month = page.getByRole('combobox', { name: 'เดือนที่จ่าย', exact: true });
    const form = page.getByRole('combobox', { name: 'แบบภาษี', exact: true });
    await expect(month).toBeVisible(); await expect(form).toBeVisible();
    await expect(page.locator('select')).toHaveCount(0);
    const monthBox = (await month.boundingBox())!, formBox = (await form.boundingBox())!;
    expect(monthBox.height).toBe(formBox.height);
    if (width >= 1024) {
      expect(monthBox.y).toBe(formBox.y);
      const searchBox = (await page.getByRole('searchbox').boundingBox())!;
      expect(searchBox.y).toBe(formBox.y);
    }
    const visibleRow = page.locator('tr, article[data-testid="wht-certificate-card"]').filter({ hasText: 'สมชาย', visible: true });
    await expect(visibleRow.getByRole('button')).toHaveCount(0);
    await expect(visibleRow.locator('summary')).toHaveCount(0);
    await expect(visibleRow.getByRole('button', { name: 'พิมพ์ใบแทน (เลขที่เดิม)', exact: true })).toHaveCount(0);
    await expect(visibleRow.getByText('เพิ่มเติม', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'หนังสือรับรอง', exact: true })).toHaveCount(0);
    await expect(visibleRow).toContainText(/WT-01\s*·\s*EX-01/);
    await expect(visibleRow).not.toContainText('ออกเมื่อ');
    await expect(visibleRow).not.toContainText('รายจ่ายเลขที่');
    await expect(visibleRow).not.toContainText('฿');
    expect(queries.at(-1)!.get('pageSize')).toBe('10');
    await expect(page.getByText('หน้า 1 จาก 3', { exact: true })).toBeVisible();
    const sort = width < 1280 ? page.getByRole('button', { name: 'เรียง: ใหม่ไปเก่า ↓', exact: true }) : page.getByRole('button', { name: 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่', exact: true });
    await sort.click();
    await expect(page).toHaveURL(/order=oldest/);
    await expect.poll(() => queries.at(-1)!.get('order')).toBe('oldest');
    if (width >= 1280) {
      const overflow = await page.getByTestId('wht-certificate-table').locator('td').evaluateAll(cells => cells.filter(cell => cell.scrollWidth > cell.clientWidth).map(cell => cell.textContent));
      expect(overflow).toEqual([]);
    }
    await chooseThemedOption(page, month, 'ต.ค. 2569');
    await expect(page).toHaveURL(/periodKey=2026-10/);
    await chooseThemedOption(page, form, 'ภ.ง.ด.3');
    await expect(page).toHaveURL(/formType=PND3/);
    // The expense number is no longer a second link; the full row is keyboard accessible.
    await expect(visibleRow.locator('a').filter({ hasText: 'EX-01' })).toHaveCount(0);
    await visibleRow.focus(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/companies/${companyId}/expenses/expense-1\\?section=certificate$`));
  });
  test(`certificate pending rows open their first missing section without menus at ${width}px`, async ({ authedPage: page, companyId }) => {
    await page.setViewportSize({ width, height: 900 });
    const base = { companyId, status: 'REQUIRED', sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1', expenseId: 'expense-1', expenseNumber: 'EXP-202610-00158', documentDate: '2026-10-11', formType: 'PND3', withheldAmount: '300.00', missing: [], systemIssuanceOpen: true, hasPayeeAddress: true,
      prefill: { grossAmount: '10000.00', withheldAmount: '300.00', paymentDate: '2026-10-11', payeeSnapshot: { name: 'ผู้รับเงินทดสอบ', taxId: '1234567890123', address: '99 ถนนทดสอบ' }, incomeCategoryName: 'ค่าบริการ' } };
    await page.route(`**/api/v1/companies/${companyId}/wht/payment-handoffs?**`, route => route.fulfill({ json: {
      rows: [{ ...base, id: 'ready', payeeName: 'พร้อมออกหนังสือรับรอง' }, { ...base, id: 'address', payeeName: 'ต้องเพิ่มที่อยู่', hasPayeeAddress: false, prefill: { ...base.prefill, payeeSnapshot: { ...base.prefill.payeeSnapshot, address: null } } },
        { ...base, id: 'unpaid', payeeName: 'ยังไม่ได้บันทึกจ่าย', payments: [] }],
      total: 3, page: 1, pageSize: 10, counts: { REQUIRED: 3, SYSTEM_ISSUED: 0, EXTERNAL_LINKED: 0, CANCELLED: 0 }, sums: { withheld: '900.00' }, months: ['2026-10'],
    } }));
    await gotoCompany(page, companyId, '/expenses/wht-certificates');
    const row = (name: string) => page.locator('tr, article[data-testid="wht-certificate-card"]').filter({ hasText: name, visible: true });
    for (const [name, section] of [['พร้อมออกหนังสือรับรอง', 'certificate'], ['ต้องเพิ่มที่อยู่', 'certificate'], ['ยังไม่ได้บันทึกจ่าย', 'payment']]) {
      await gotoCompany(page, companyId, '/expenses/wht-certificates');
      const target = row(name);
      await expect(target).toBeVisible();
      await expect(target.locator('summary')).toHaveCount(0);
      await expect(target.getByRole('button')).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      if (width >= 1280) {
        const overflow = await page.getByTestId('wht-certificate-table').locator('td').evaluateAll(cells => cells.filter(cell => cell.scrollWidth > cell.clientWidth).map(cell => cell.textContent));
        expect(overflow).toEqual([]);
      }
      await target.click();
      await expect(page).toHaveURL(new RegExp(`/companies/${companyId}/expenses/expense-1\\?section=${section}$`));
    }
  });

}
