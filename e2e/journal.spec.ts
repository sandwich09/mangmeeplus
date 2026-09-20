import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';
import { firstActiveBranch, gotoCompany, json, unique } from './harness/e2e-utils';
import { ACCOUNTING_UI_HIDDEN } from '../apps/web/src/features/web-core-workspace/web-core-workspace.constants';

test('JRNL-00 @smoke hidden ledger UI redirects while background posting stays enabled', async ({ authedPage, companyId }) => {
  test.skip(!ACCOUNTING_UI_HIDDEN, 'Ledger UI is open; the journal journey below is the active contract.');
  await gotoCompany(authedPage, companyId, '/journal');
  await expect(authedPage).toHaveURL(new RegExp(`/companies/${companyId}/dashboard(?:\\?.*)?$`));
});

test.describe('JRNL — journal / ledger', () => {
  test.skip(ACCOUNTING_UI_HIDDEN, 'Ledger UI is intentionally closed for this launch.');

  test('JRNL-01 @smoke journal page renders', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/journal');
    await expect(authedPage.getByRole('heading', { name: /สมุดรายวัน|Journal/i })).toBeVisible();
    // ThemedDate replaced the native <input type="month"> with a themed button+grid
    // popover (see apps/web/src/common/components/field/ThemedDate.tsx); it exposes
    // an aria-label instead of a fillable input.
    await expect(authedPage.getByLabel('งวด')).toBeVisible();
  });

  test('JRNL-02 @p1 ledger report tiles render values', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/journal');
    for (const label of [/ผลต่างงบทดลอง|Trial balance/i, /กำไรสุทธิ|Net profit/i, /สินทรัพย์รวม|Assets/i]) {
      await expect(authedPage.getByText(label).first()).toBeVisible();
    }
  });

  test('JRNL-03 @p1 period selector reloads without client error', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/journal');
    // Drive the ThemedDate button+grid popover: open it, then pick June from the
    // month grid (the panel opens on the currently selected period's year, so no
    // year navigation is needed to reach a same-year month).
    await authedPage.getByLabel('งวด').click();
    await authedPage.getByRole('button', { name: 'มิ.ย.', exact: true }).click();
    await authedPage.getByRole('button', { name: /รีเฟรช|Refresh/i }).click();
    await expectNoClientError(authedPage);
    await expect(authedPage.getByText(/งวด|Period/i).first()).toBeVisible();
  });
});

// Close-guard regression — docs/specs/date-time-correctness-spec.md §5.1, §10.
//
// The guard bounded every blocker count with `lte: period.endDate`, the last day at UTC
// midnight, while the columns it counts are almost entirely timestamped (14/14 vendor bills).
// A finalized-but-unposted document dated the LAST DAY of a period was therefore invisible,
// and the period could be closed with it outstanding — a financial control failing open.
//
// Vendor bills are the vehicle on purpose: billDate still stores whatever instant the caller
// sends, so this reproduces the condition. (The expense write path now normalises to a date,
// so an expense could not reproduce it.)
test('JRNL-20 @p1 close checks see a blocker dated the last day of the period', async ({ api, companyId }) => {
  const periodKey = '2026-05';
  const lastDayWithTime = '2026-05-31T14:00:00.000Z';

  const period = await json<{ id: string }>(
    await api.post(`companies/${companyId}/periods/ensure/${periodKey}`, { data: {} }),
  );

  const supplier = await json<{ id: string }>(await api.post(`companies/${companyId}/procurement/suppliers`, {
    data: { displayName: unique('E2E close-guard supplier'), supplierType: 'JURISTIC_PERSON', defaultCurrency: 'THB' },
  }));
  const bill = await json<{ id: string }>(await api.post(`companies/${companyId}/accounts-payable/vendor-bills`, {
    data: {
      supplierId: supplier.id,
      branchId: (await firstActiveBranch(api, companyId)).id,
      billDate: lastDayWithTime,
      dueDate: '2026-06-30T00:00:00.000Z',
      currency: 'THB', vatMode: 'NO_VAT',
      supplierDocumentNumber: unique('E2E-CLOSE'),
      subtotalAmount: '100.00', discountAmount: '0.00', taxableAmount: '100.00', vatAmount: '0.00',
      inputVatClaimStatus: 'NON_CLAIMABLE', whtAmount: '0.00',
      grandTotalAmount: '100.00', netPayableAmount: '100.00', matchingMode: 'NONE',
      lines: [{
        lineNumber: 1, lineType: 'SERVICE', description: unique('E2E close-guard line'),
        unitName: 'each', quantity: '1', unitPrice: '100.00', discountAmount: '0.00',
        vatMode: 'NO_VAT', vatAmount: '0.00', inputVatClaimStatus: 'NON_CLAIMABLE',
        whtAmount: '0.00', lineSubtotalAmount: '100.00', lineTotalAmount: '100.00',
      }],
    },
  }));

  // Finalize it: only APPROVED/PARTIALLY_PAID/PAID bills count as posting blockers.
  await api.post(`companies/${companyId}/accounts-payable/vendor-bills/${bill.id}/submit`, { data: {} });
  await api.post(`companies/${companyId}/accounts-payable/vendor-bills/${bill.id}/approve`, { data: {} });

  // Pay it on the period's LAST DAY, with a time. A RECORDED supplier payment whose posting is
  // still outstanding is a close blocker (countSupplierPaymentPostingBlockers counts both
  // 'pending' and 'not_required'), and paymentDate stores the instant as sent.
  await api.post(`companies/${companyId}/accounts-payable/payments`, {
    data: {
      supplierId: supplier.id,
      paymentDate: lastDayWithTime,
      method: 'BANK_TRANSFER',
      currency: 'THB',
      grossAmount: '100.00',
      netPaidAmount: '100.00',
      allocations: [{ vendorBillId: bill.id, amount: '100.00' }],
    },
  });

  const run = await json<{ checks: Array<{ checkKey: string; status: string; count?: number }> }>(
    await api.post(`companies/${companyId}/periods/${period.id}/close-checks`, { data: {} }),
  );

  const sources = run.checks.find((c) => c.checkKey === 'source_postings_complete');
  expect(sources, 'source_postings_complete check must be present').toBeTruthy();
  expect(
    (sources?.count ?? 0) > 0 && sources?.status === 'FAILED',
    'a finalized-but-unposted record dated the period last day must block the close',
  ).toBe(true);
});
