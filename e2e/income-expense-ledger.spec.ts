import { test, expect } from './harness/fixtures';
import { ensureVatRegistrationAnswered, firstActiveBranch, gotoCompany, json, unique } from './harness/e2e-utils';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client';

type DocumentRecord = {
  id: string;
  documentNumber?: string;
  status: string;
  grandTotalAmount: string;
  outstandingAmount: string;
};

type SimpleIncomeResult = {
  invoice: DocumentRecord;
  payment: { id: string; amount: string };
  receipt: DocumentRecord;
};

type LedgerSummary = {
  income: { receivableOutstanding: string };
};

type LedgerEntries = {
  data: Array<{ id: string; referenceNumber?: string; amount: string }>;
  total: number;
};

function bangkokToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function createInvoice(api: any, companyId: string, amount: string, label: string) {
  await ensureVatRegistrationAnswered(api, companyId);
  const branch = await firstActiveBranch(api, companyId);
  const draft = await json<DocumentRecord>(await api.post(`companies/${companyId}/accounting/documents`, {
    data: {
      documentType: 'INVOICE', documentDate: bangkokToday(), vatMode: 'NO_VAT', branchId: branch.id,
      lines: [{ lineNumber: 1, description: label, quantity: '1', unitPrice: amount }],
    },
  }));
  return json<DocumentRecord>(await api.post(`companies/${companyId}/accounting/documents/${draft.id}/issue`, { data: {} }));
}

async function closeSalesGateForBrowserEvidence(): Promise<() => Promise<void>> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the reversible CLOSED-state browser fixture');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const original = await client.featureLaunchGate.findUniqueOrThrow({
    where: { gateKey_routeKey: { gateKey: 'sales_documents', routeKey: 'DEFAULT' } },
    select: { state: true, generation: true, lastSeq: true, reason: true, updatedAt: true },
  });
  await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'launch_gate:sales_documents:DEFAULT'}))`;
    await tx.featureLaunchGate.update({
      where: { gateKey_routeKey: { gateKey: 'sales_documents', routeKey: 'DEFAULT' } },
      data: { state: 'CLOSED', reason: 'reversible local browser evidence' },
    });
  });
  return async () => {
    try {
      await client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'launch_gate:sales_documents:DEFAULT'}))`;
        await tx.featureLaunchGate.update({
          where: { gateKey_routeKey: { gateKey: 'sales_documents', routeKey: 'DEFAULT' } },
          data: original,
        });
      });
    } finally {
      await client.$disconnect();
    }
  };
}

test.describe('P27 — income and expense ledger', () => {
  test('LED-01 @smoke received income creates invoice, payment and receipt and appears in the ledger', async ({ authedPage, api, companyId }) => {
    const label = unique('LED cash sale');
    await ensureVatRegistrationAnswered(api, companyId);
    const branch = await firstActiveBranch(api, companyId);
    const result = await json<SimpleIncomeResult>(await api.post(`companies/${companyId}/accounting/simple-income`, {
      data: {
        idempotencyKey: unique('led-income'), documentDate: bangkokToday(), vatMode: 'NO_VAT',
        paymentMethod: 'BANK_TRANSFER', branchId: branch.id,
        lines: [{ lineNumber: 1, description: label, quantity: '1', unitPrice: '246.80' }],
      },
    }));
    expect(result.invoice.status).toBe('ISSUED');
    expect(Number(result.payment.amount)).toBeCloseTo(246.80, 2);
    expect(result.receipt.status).toBe('ISSUED');

    const receipt = await json<DocumentRecord>(await api.get(`companies/${companyId}/accounting/documents/${result.receipt.id}`));
    expect(receipt.documentNumber).toBeTruthy();
    const entries = await json<LedgerEntries>(await api.get(
      `companies/${companyId}/income-expense-ledger/entries?type=INCOME&from=${bangkokToday()}&to=${bangkokToday()}&pageSize=100`,
    ));
    expect(entries.data.some((entry) => entry.id === result.invoice.id && Number(entry.amount) === 246.80)).toBe(true);

    await gotoCompany(authedPage, companyId, '/income-expense-ledger');
    await expect(authedPage.getByRole('link', { name: result.invoice.documentNumber!, exact: true })).toBeVisible();
  });

  test('LED-02 @smoke issuing then receiving an invoice raises and clears receivable', async ({ api, companyId }) => {
    const period = `from=${bangkokToday()}&to=${bangkokToday()}`;
    const before = await json<LedgerSummary>(await api.get(`companies/${companyId}/income-expense-ledger/summary?${period}`));
    const invoice = await createInvoice(api, companyId, '321.23', unique('LED receivable'));
    const issued = await json<LedgerSummary>(await api.get(`companies/${companyId}/income-expense-ledger/summary?${period}`));
    expect(Number(issued.income.receivableOutstanding) - Number(before.income.receivableOutstanding)).toBeCloseTo(321.23, 2);

    await json(await api.post(`companies/${companyId}/accounting/payments`, {
      data: {
        idempotencyKey: unique('led-payment'), direction: 'RECEIVED', method: 'BANK_TRANSFER',
        amount: '321.23', paidAt: `${bangkokToday()}T12:00:00+07:00`, allocateToDocumentId: invoice.id,
      },
    }));
    const paid = await json<LedgerSummary>(await api.get(`companies/${companyId}/income-expense-ledger/summary?${period}`));
    expect(Number(paid.income.receivableOutstanding)).toBeCloseTo(Number(before.income.receivableOutstanding), 2);
    const receivables = await json<LedgerEntries>(await api.get(
      `companies/${companyId}/income-expense-ledger/entries?type=RECEIVABLE&${period}&pageSize=100`,
    ));
    expect(receivables.data.some((entry) => entry.id === invoice.id)).toBe(false);
  });

  test('LED-03 @smoke archived revenue category stays in management but disappears from new-income picker', async ({ apiAs, pageAs, companyId }) => {
    const financeApi = await apiAs('FINANCE');
    const financePage = await pageAs('FINANCE');
    const name = unique('หมวดปิดใช้');
    const category = await json<{ id: string }>(await financeApi.post(`companies/${companyId}/revenue-categories`, {
      data: { name, accountHintKey: unique('revenue.e2e') },
    }));
    await json(await financeApi.patch(`companies/${companyId}/revenue-categories/${category.id}`, { data: { status: 'ARCHIVED' } }));
    const active = await json<Array<{ id: string }>>(await financeApi.get(`companies/${companyId}/revenue-categories`));
    expect(active.some((item) => item.id === category.id)).toBe(false);

    await gotoCompany(financePage, companyId, '/sales-documents/record-income?mode=invoice');
    const picker = financePage.getByRole('combobox', { name: 'หมวดรายรับของรายการที่ 1' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('option', { name, exact: true })).toHaveCount(0);
  });

  test('LED-04 @smoke CSV and XLSX export cover the same ledger rows', async ({ api, companyId }) => {
    const invoice = await createInvoice(api, companyId, '432.10', unique('LED export'));
    const result = await json<{ rowCount: number; csv: string; xlsxBase64: string }>(await api.get(
      `companies/${companyId}/income-expense-ledger/export?type=INCOME&from=${bangkokToday()}&to=${bangkokToday()}`,
    ));
    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.csv).toContain(invoice.documentNumber!);
    expect(result.csv).toContain('432.10');
    expect(Buffer.from(result.xlsxBase64, 'base64').subarray(0, 2).toString()).toBe('PK');
  });

  test('LED-05 @smoke read-only company role can read the ledger but cannot create income', async ({ apiAs, companyId }) => {
    const readOnly = await apiAs('COMPANY_VIEW');
    const summary = await readOnly.get(
      `companies/${companyId}/income-expense-ledger/summary?from=${bangkokToday()}&to=${bangkokToday()}`,
    );
    expect(summary.ok()).toBe(true);
    const create = await readOnly.post(`companies/${companyId}/accounting/simple-income`, {
      data: {
        idempotencyKey: unique('led-denied'), documentDate: bangkokToday(), vatMode: 'NO_VAT', paymentMethod: 'CASH',
        lines: [{ lineNumber: 1, description: 'must not persist', quantity: '1', unitPrice: '1.00' }],
      },
    });
    expect(create.status()).toBe(403);
  });

  test('LED-06 @smoke CLOSED hides sales root actions but allows counterparty registry and runoff', async ({ apiAs, pageAs, companyId }) => {
    test.skip(!process.env['DATABASE_URL'], 'DATABASE_URL is required for reversible launch-gate evidence');
    const financeApi = await apiAs('FINANCE');
    const financePage = await pageAs('FINANCE');
    await financePage.setViewportSize({ width: 1280, height: 900 });
    const errors: string[] = [];
    financePage.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await ensureVatRegistrationAnswered(await apiAs('OWNER'), companyId);
    const quotation = await json<DocumentRecord>(await financeApi.post(`companies/${companyId}/accounting/documents`, {
      data: {
        documentType: 'QUOTATION', documentDate: bangkokToday(), vatMode: 'NO_VAT',
        branchId: (await firstActiveBranch(financeApi, companyId)).id,
        lines: [{ lineNumber: 1, description: unique('LED close quotation'), quantity: '1', unitPrice: '500.00' }],
      },
    }));
    const invoice = await createInvoice(financeApi, companyId, '510.00', unique('LED close invoice'));
    const taxInvoiceSource = await createInvoice(financeApi, companyId, '220.00', unique('LED close tax source'));
    const correctionSource = await createInvoice(financeApi, companyId, '80.00', unique('LED close correction source'));

    const restore = await closeSalesGateForBrowserEvidence();
    try {
      await gotoCompany(financePage, companyId, `/sales-documents?documentId=${quotation.id}`);
      await expect(financePage.getByText('ยังสร้างรายการขายใหม่ไม่ได้ชั่วคราว')).toBeVisible();
      await expect(financePage.getByRole('button', { name: 'ส่งขออนุมัติ' })).toHaveCount(0);
      await expect(financePage.getByRole('button', { name: 'เพิ่มคู่ค้า' })).toHaveCount(0);
      await expect(financePage.getByRole('button', { name: 'แก้ไขร่าง' })).toBeVisible();

      const counterparty = await financeApi.post(`companies/${companyId}/accounting/counterparties`, {
        data: { displayName: unique('registry while sales closed') },
      });
      expect(counterparty.status()).toBe(201);
      const createdCounterparty = await json<{ id: string }>(counterparty);
      const registryEdit = await financeApi.patch(`companies/${companyId}/accounting/counterparties/${createdCounterparty.id}`, {
        data: { phone: '0812345678' },
      });
      expect(registryEdit.ok()).toBe(true);
      const submit = await financeApi.post(`companies/${companyId}/accounting/documents/${quotation.id}/submit-approval`, { data: {} });
      expect(submit.status()).toBe(403);

      await gotoCompany(financePage, companyId, `/sales-documents?documentId=${invoice.id}`);
      await expect(financePage.getByText('ยังสร้างรายการขายใหม่ไม่ได้ชั่วคราว')).toBeVisible();
      await expect(financePage.getByRole('button', { name: 'บันทึกรับชำระ' })).toBeVisible();
      await expect(financePage.getByRole('button', { name: 'สร้างใบกำกับภาษี' })).toBeVisible();
      await expect(financePage.getByRole('button', { name: 'ยกเลิกเอกสาร' })).toBeVisible();
      await expect(financePage.getByRole('button', { name: 'ใบลดหนี้ (ลดยอด)' })).toBeVisible();
      const desktopOverflow = await financePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(desktopOverflow).toBeLessThanOrEqual(1);
      await financePage.screenshot({ path: 'docs/evidence/p27-phase6/sales-close-desktop.png', fullPage: true });

      await financePage.setViewportSize({ width: 390, height: 844 });
      await financePage.reload();
      await expect(financePage.getByText('ยังสร้างรายการขายใหม่ไม่ได้ชั่วคราว')).toBeVisible();
      const mobileOverflow = await financePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(mobileOverflow).toBeLessThanOrEqual(1);
      await financePage.screenshot({ path: 'docs/evidence/p27-phase6/sales-close-mobile.png', fullPage: true });

      // Execute the preserved runoff path while CLOSED; visibility alone is not
      // enough evidence that the backend mutation boundary remains usable.
      const payment = await json<{ id: string; amount: string }>(await financeApi.post(`companies/${companyId}/accounting/payments`, {
        data: {
          idempotencyKey: unique('led-closed-payment'), direction: 'RECEIVED', method: 'BANK_TRANSFER',
          amount: '510.00', paidAt: `${bangkokToday()}T12:00:00+07:00`, allocateToDocumentId: invoice.id,
        },
      }));
      expect(Number(payment.amount)).toBeCloseTo(510, 2);
      const paidInvoice = await json<DocumentRecord>(await financeApi.get(`companies/${companyId}/accounting/documents/${invoice.id}`));
      expect(Number(paidInvoice.outstandingAmount)).toBe(0);

      const linkedTaxInvoice = await json<DocumentRecord>(await financeApi.post(`companies/${companyId}/accounting/documents`, {
        data: {
          documentType: 'TAX_INVOICE', sourceDocumentId: taxInvoiceSource.id, sourceDocumentType: 'INVOICE',
          documentDate: bangkokToday(), vatMode: 'NO_VAT', outputTaxCode: 'O0',
          lines: [{ lineNumber: 1, description: 'ใบกำกับภาษีจากรายการเดิม', quantity: '1', unitPrice: '220.00' }],
        },
      }));
      expect(linkedTaxInvoice.status).toBe('DRAFT');

      const creditNote = await json<DocumentRecord>(await financeApi.post(`companies/${companyId}/accounting/documents`, {
        data: {
          documentType: 'CREDIT_NOTE', sourceDocumentId: correctionSource.id, sourceDocumentType: 'INVOICE',
          adjustmentReasonCode: 'GOODS_RETURNED', documentDate: bangkokToday(), vatMode: 'NO_VAT',
          lines: [{ lineNumber: 1, description: 'คืนสินค้าจากรายการเดิม', quantity: '1', unitPrice: '10.00' }],
        },
      }));
      expect(creditNote.status).toBe('DRAFT');

      const receiptDraft = await json<DocumentRecord>(await financeApi.post(`companies/${companyId}/accounting/documents`, {
        data: {
          documentType: 'RECEIPT', sourceDocumentId: invoice.id, sourceDocumentType: 'INVOICE',
          documentDate: bangkokToday(), vatMode: 'NO_VAT',
          lines: [{ lineNumber: 1, description: 'รับจ่ายใบแจ้งหนี้เดิม', quantity: '1', unitPrice: '510.00' }],
        },
      }));
      const receipt = await json<DocumentRecord>(await financeApi.post(
        `companies/${companyId}/accounting/documents/${receiptDraft.id}/issue`,
        { data: {} },
      ));
      expect(receipt.status).toBe('ISSUED');
      expect(receipt.documentNumber).toBeTruthy();
      expect(errors).toEqual([]);
    } finally {
      await restore();
    }
  });
});
