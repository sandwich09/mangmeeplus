import { test, expect } from './harness/fixtures';
import { gotoCompany, json, unique } from './harness/e2e-utils';
import { addCivilDays, todayCivilDate } from '../packages/contracts/src/civil-date';

type Policy = {
  allowSelfApproval: boolean;
  allowMissingReceiptWithReason: boolean;
  requireReceipt: boolean;
  financeReviewRequired: boolean;
};
type ReimbursementLine = { lineNo: number; description: string; amount: string; categoryKey: string };
type Reimbursement = {
  id: string;
  status: string;
  paymentStatus?: string;
  amount: string;
  lineCount?: number;
  lines?: ReimbursementLine[];
  categoryLabelSnapshot?: string;
  approvalSnapshotHash?: string | null;
};
type ReimbursementPage = { items: Reimbursement[] };

const today = () => new Date().toISOString().slice(0, 10);

/** One claim, N rows. The server computes the total — no amount is ever posted at header level. */
async function createReimbursement(api: any, companyId: string, amounts: string[] = ['123.00']) {
  return json<Reimbursement>(await api.post(`companies/${companyId}/reimbursements`, {
    data: {
      reason: unique('E2E reimbursement'),
      currency: 'THB',
      missingReceiptReason: 'E2E local run without receipt upload',
      lines: amounts.map((amount, index) => ({
        lineNo: index + 1,
        incurredDate: today(),
        description: unique(`E2E line ${index + 1}`),
        categoryKey: index === 0 ? 'travel' : 'meals',
        amount,
      })),
    },
  }));
}

async function withPolicy(api: any, companyId: string, patch: Partial<Policy>, fn: () => Promise<void>) {
  const original = await json<Policy>(await api.get(`companies/${companyId}/reimbursement-policy`));
  await json<Policy>(await api.put(`companies/${companyId}/reimbursement-policy`, { data: { ...original, ...patch } }));
  try {
    await fn();
  } finally {
    await api.put(`companies/${companyId}/reimbursement-policy`, { data: original });
  }
}

test.describe('REIMB — reimbursements', () => {
  test('REIMB-06 @p1 incurred-date picker permits today but disables tomorrow', async ({ authedPage, companyId }) => {
    const today = todayCivilDate();
    const tomorrow = addCivilDays(today, 1);
    await gotoCompany(authedPage, companyId, '/reimbursements/new');
    await authedPage.getByRole('combobox', { name: 'วันที่', exact: true }).click();
    await authedPage.getByRole('button', { name: 'วันนี้', exact: true }).click();
    await authedPage.getByRole('combobox', { name: 'วันที่', exact: true }).click();
    const calendar = authedPage.getByRole('button', { name: 'วันนี้', exact: true }).locator('..').locator('..');
    await expect(calendar.getByRole('button', { name: String(Number(today.slice(-2))), exact: true })).toBeEnabled();
    if (today.slice(0, 7) !== tomorrow.slice(0, 7)) {
      await authedPage.getByRole('button', { name: 'เดือนถัดไป', exact: true }).click();
    }
    await expect(calendar.getByRole('button', { name: String(Number(tomorrow.slice(-2))), exact: true })).toBeDisabled();
  });

  test('REIMB-01 @smoke reimbursements list renders', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/reimbursements');
    await expect(authedPage.getByRole('heading', { name: /การเบิกจ่ายและอนุมัติ|Reimbursements/i })).toBeVisible();
    for (const tab of [/รายการที่เกี่ยวข้อง|Related/i, /คิวอนุมัติ|Approval/i, /คิวการเงิน|Finance/i]) {
      await expect(authedPage.getByRole('button', { name: tab })).toBeVisible();
    }
  });

  test('REIMB-02 @p1 creates and submits a reimbursement request', async ({ authedPage, api, companyId }) => {
    await withPolicy(api, companyId, { requireReceipt: false, allowMissingReceiptWithReason: true }, async () => {
      const draft = await createReimbursement(api, companyId);
      const submitted = await json<Reimbursement>(await api.post(`companies/${companyId}/reimbursements/${draft.id}/submit`, { data: {} }));
      expect(submitted.status).toBe('PENDING_APPROVAL');

      await gotoCompany(authedPage, companyId, '/reimbursements');
      await expect(authedPage.getByText(/รออนุมัติ|Pending/i).first()).toBeVisible();
    });
  });

  test('REIMB-04 @p1 rolls a multi-line claim up into the header total', async ({ api, companyId }) => {
    await withPolicy(api, companyId, { requireReceipt: false, allowMissingReceiptWithReason: true }, async () => {
      const draft = await createReimbursement(api, companyId, ['100.00', '49.50', '0.50']);
      // Decimal columns come back without trailing zeros, so compare numerically.
      expect(Number(draft.amount)).toBe(150);
      expect(draft.lineCount).toBe(3);
      // Mixed categories collapse to a "หลายหมวด" header label.
      expect(draft.categoryLabelSnapshot).toContain('หลายหมวด');

      const detail = await json<Reimbursement>(await api.get(`companies/${companyId}/reimbursements/${draft.id}`));
      expect(detail.lines?.length).toBe(3);
      expect(detail.lines?.map((line) => line.lineNo)).toEqual([1, 2, 3]);

      const submitted = await json<Reimbursement>(await api.post(`companies/${companyId}/reimbursements/${draft.id}/submit`, { data: {} }));
      expect(submitted.status).toBe('PENDING_APPROVAL');
      expect(Number(submitted.amount)).toBe(150);
    });
  });

  test('REIMB-05 @p2 rejects a claim with no lines', async ({ api, companyId }) => {
    const response = await api.post(`companies/${companyId}/reimbursements`, {
      data: { reason: unique('E2E empty claim'), currency: 'THB', lines: [] },
    });
    expect(response.status()).toBe(400);
  });

  test('REIMB-03 @p1 owner approves, finance-reviews, and pays throwaway request', async ({ api, companyId }) => {
    await withPolicy(api, companyId, { requireReceipt: false, allowSelfApproval: true, allowMissingReceiptWithReason: true, financeReviewRequired: true }, async () => {
      const draft = await createReimbursement(api, companyId, ['88.00']);
      const submitted = await json<Reimbursement>(await api.post(`companies/${companyId}/reimbursements/${draft.id}/submit`, { data: {} }));
      const approved = await json<Reimbursement>(await api.post(`companies/${companyId}/reimbursements/${draft.id}/approve`, {
        data: { approvalSnapshotHash: submitted.approvalSnapshotHash },
      }));
      expect(['FINANCE_REVIEW', 'READY_FOR_PAYMENT']).toContain(approved.status);

      const reviewed = await json<Reimbursement>(await api.post(`companies/${companyId}/reimbursements/${draft.id}/finance-review`, {
        data: { decision: 'APPROVED_FOR_PAYMENT', note: 'E2E finance review' },
      }));
      expect(reviewed.status).toBe('READY_FOR_PAYMENT');

      const paid = await json<Reimbursement>(await api.post(`companies/${companyId}/reimbursements/${draft.id}/payments`, {
        data: { paidAmount: '88.00', currency: 'THB', paymentMethod: 'CASH', paidAt: new Date().toISOString() },
      }));
      expect(paid.status).toBe('PAID');
      expect(paid.paymentStatus).toBe('PAID');

      const list = await json<ReimbursementPage>(await api.get(`companies/${companyId}/reimbursements?pageSize=100`));
      expect(list.items.some((item) => item.id === draft.id && item.status === 'PAID')).toBe(true);
    });
  });
});
