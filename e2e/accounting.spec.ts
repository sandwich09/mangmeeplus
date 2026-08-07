import { test, expect } from './harness/fixtures';
import { gotoCompany, json, unique } from './harness/e2e-utils';

type AccountingDocument = {
  id: string;
  documentNumber?: string | null;
  status: string;
  grandTotalAmount: string;
  vatAmount: string;
  lines?: Array<{ description: string; lineTotalAmount: string }>;
};
type DocumentPage = { data: AccountingDocument[] };

async function createDocument(api: any, companyId: string, description = unique('E2E accounting line')) {
  return json<AccountingDocument>(await api.post(`companies/${companyId}/accounting/documents`, {
    data: {
      documentType: 'INVOICE',
      documentDate: new Date().toISOString().slice(0, 10),
      vatMode: 'NO_VAT',
      lines: [{ lineNumber: 1, description, quantity: '2', unitPrice: '125.00' }],
    },
  }));
}

test.describe('ACCT — accounting documents', () => {
  test('ACCT-01 @smoke accounting workspace renders document list and draft form', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/accounting');
    await expect(authedPage.getByRole('heading', { name: /Accounting documents/i })).toBeVisible();
    await expect(authedPage.getByRole('heading', { name: /New document/i })).toBeVisible();
  });

  test('ACCT-02 @p1 creates a document through the UI form', async ({ authedPage, companyId }) => {
    const line = unique('E2E UI accounting');
    await gotoCompany(authedPage, companyId, '/accounting');
    await authedPage.getByPlaceholder(/Line description/i).fill(line);
    await authedPage.getByPlaceholder(/Qty/i).fill('2');
    await authedPage.getByPlaceholder(/Unit price/i).fill('125');
    await authedPage.getByRole('button', { name: /Save draft/i }).click();
    await expect(authedPage.getByText(line)).toBeVisible();
    await expect(authedPage.getByText(/250\.00|250/).first()).toBeVisible();
  });

  test('ACCT-03 @p1 document detail totals match line math', async ({ authedPage, api, companyId }) => {
    const doc = await createDocument(api, companyId);
    await gotoCompany(authedPage, companyId, '/accounting');
    await expect(authedPage.getByRole('cell', { name: doc.id.slice(0, 8) })).toBeVisible();

    const detail = await json<AccountingDocument>(await api.get(`companies/${companyId}/accounting/documents/${doc.id}`));
    expect(detail.status).toBe('DRAFT');
    expect(Number(detail.grandTotalAmount)).toBe(250);
    expect(Number(detail.vatAmount)).toBe(0);
  });

  test('ACCT-04 @p1 issues a draft and verifies API list truth', async ({ api, companyId }) => {
    const doc = await createDocument(api, companyId);
    const issued = await json<AccountingDocument>(await api.post(`companies/${companyId}/accounting/documents/${doc.id}/issue`, { data: {} }));
    expect(issued.status).toBe('ISSUED');
    expect(issued.documentNumber).toBeTruthy();

    const list = await json<DocumentPage>(await api.get(`companies/${companyId}/accounting/documents?pageSize=100`));
    expect(list.data.some((item) => item.id === doc.id && item.status === 'ISSUED')).toBe(true);
  });

  test('ACCT-05 @p2 zero-line document is rejected by API validation', async ({ api, companyId }) => {
    const created = await json<AccountingDocument>(await api.post(`companies/${companyId}/accounting/documents`, {
      data: { documentType: 'INVOICE', documentDate: new Date().toISOString().slice(0, 10), vatMode: 'NO_VAT', lines: [] },
    }));
    const res = await api.post(`companies/${companyId}/accounting/documents/${created.id}/issue`, { data: {} });
    expect(res.ok()).toBe(false);
    expect([400, 422]).toContain(res.status());
  });
});
