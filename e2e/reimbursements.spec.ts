import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './harness/fixtures';
import { chooseThemedOption, gotoCompany, json, unique } from './harness/e2e-utils';
import { addCivilDays, todayCivilDate } from '../packages/contracts/src/civil-date';

type Policy = {
  id?: string; updatedAt?: string;
  allowSelfApproval: boolean;
  allowMissingReceiptWithReason: boolean;
  requireReceipt: boolean;
  financeReviewRequired: boolean;
};
type ReimbursementLine = { lineNo: number; description: string; amount: string; categoryKey: string };
/** One payment as the claim detail reports it to whoever asked: the slip files only if they may open them. */
type ReimbursementPayment = {
  id: string; status: string; paymentMethod: string;
  slipCount: number; slips: { attachmentId: string }[]; viewerCanOpenSlips: boolean;
};
type Reimbursement = {
  id: string;
  status: string;
  paymentStatus?: string;
  amount: string;
  requestNo?: string;
  lineCount?: number;
  lines?: ReimbursementLine[];
  categoryLabelSnapshot?: string;
  approvalSnapshotHash?: string | null;
  payments?: ReimbursementPayment[];
  signedCopies?: { attachmentId: string }[];
  documentSignedVia?: string | null;
};
type ReimbursementPage = { items: Reimbursement[] };

const today = () => new Date().toISOString().slice(0, 10);

/** One claim, N rows. The server computes the total — no amount is ever posted at header level. */
async function createReimbursement(api: any, companyId: string, amounts: string[] = ['123.00']) {
  const branches = await json<any>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
  const branchId = (branches.data ?? branches.items ?? branches)[0].id;
  return json<Reimbursement>(await api.post(`companies/${companyId}/reimbursements`, {
    data: {
      reason: unique('E2E reimbursement'), branchId,
      currency: 'THB',
      missingReceiptReason: 'E2E local run without receipt upload',
      // A claim says how it is paid back before it can be sent; cash needs no account and no attestation.
      payout: { mode: 'CASH' },
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
  const body = (p: Policy) => ({ allowSelfApproval: p.allowSelfApproval, allowMissingReceiptWithReason: p.allowMissingReceiptWithReason, requireReceipt: p.requireReceipt, financeReviewRequired: p.financeReviewRequired });
  await json<Policy>(await api.put(`companies/${companyId}/reimbursement-policy`, { data: { ...body(original), ...patch, ...(original.id !== 'default' && { expectedUpdatedAt: original.updatedAt }) } }));
  try {
    await fn();
  } finally {
    const latest = await json<Policy>(await api.get(`companies/${companyId}/reimbursement-policy`));
    await json(await api.put(`companies/${companyId}/reimbursement-policy`, { data: { ...body(original), expectedUpdatedAt: latest.updatedAt } }));
  }
}

// ---- Payment slips (claim payout Phase 2) ----

/** A claim can be filed without a receipt, approved by its owner and paid straight after approval. */
const PAYABLE = { requireReceipt: false, allowSelfApproval: true, allowMissingReceiptWithReason: true, financeReviewRequired: false };
/** A valid 1x1 PNG: the smallest thing the upload check accepts as an image. */
const SLIP_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
type UploadIntent = { attachmentId: string; uploadUrl: string; uploadHeaders: Record<string, string> };

const claimUrl = (companyId: string, id: string) => `companies/${companyId}/reimbursements/${id}`;
const slipUrl = (companyId: string, id: string, paymentId: string, attachmentId: string) =>
  `${claimUrl(companyId, id)}/payments/${paymentId}/slips/${attachmentId}/download-url?disposition=inline`;

/** A claim approved and waiting for its payment: `requester` files and submits it, `approver` approves it. */
async function payableClaim(requester: APIRequestContext, approver: APIRequestContext, companyId: string, amount: string) {
  const draft = await createReimbursement(requester, companyId, [amount]);
  const submitted = await json<Reimbursement>(await requester.post(`${claimUrl(companyId, draft.id)}/submit`, { data: {} }));
  const approved = await json<Reimbursement>(await approver.post(`${claimUrl(companyId, draft.id)}/approve`, {
    data: { approvalSnapshotHash: submitted.approvalSnapshotHash },
  }));
  expect(approved.status).toBe('READY_FOR_PAYMENT');
  return approved;
}

async function putFile(request: APIRequestContext, intent: UploadIntent) {
  const uploaded = await request.put(intent.uploadUrl, { data: SLIP_PNG, headers: { ...intent.uploadHeaders, 'Content-Type': 'image/png' } });
  expect(uploaded.status()).toBe(200);
}

/** A slip uploaded through the claim's own slip endpoints, the way the payment form does it. */
async function uploadSlip(payer: APIRequestContext, request: APIRequestContext, companyId: string, claimId: string) {
  const intent = await json<UploadIntent>(await payer.post(`${claimUrl(companyId, claimId)}/payments/slip-upload-intent`, {
    data: { originalFileName: `${unique('e2e-slip')}.png`, mimeType: 'image/png', byteSize: SLIP_PNG.length },
  }));
  await putFile(request, intent);
  const done = await json<{ attachmentId: string }>(await payer.post(`${claimUrl(companyId, claimId)}/payments/slip-uploads/${intent.attachmentId}/complete`, {
    data: { byteSize: SLIP_PNG.length },
  }));
  return done.attachmentId;
}

/** An ordinary file upload, the way the "ใบเบิกที่เซ็นแล้ว" uploader does it. */
async function uploadPlainFile(uploader: APIRequestContext, request: APIRequestContext, companyId: string) {
  const intent = await json<UploadIntent>(await uploader.post(`companies/${companyId}/attachments/upload-intent`, {
    data: { originalFileName: `${unique('e2e-misfiled-slip')}.png`, mimeType: 'image/png', byteSize: SLIP_PNG.length, visibility: 'INTERNAL' },
  }));
  await putFile(request, intent);
  await json(await uploader.post(`companies/${companyId}/attachments/${intent.attachmentId}/complete`, { data: { byteSize: SLIP_PNG.length } }));
  return intent.attachmentId;
}

/** Records the claim's full payment as a bank transfer carrying that slip. */
async function payByTransfer(payer: APIRequestContext, companyId: string, claim: Reimbursement, slipAttachmentId: string) {
  const paid = await json<Reimbursement>(await payer.post(`${claimUrl(companyId, claim.id)}/payments`, {
    data: {
      idempotencyKey: `e2e-transfer-${claim.id}`, paidAmount: Number(claim.amount).toFixed(2), currency: 'THB',
      paymentMethod: 'BANK_TRANSFER', paymentReference: unique('E2E-TXN'), paidAt: new Date().toISOString(), slipAttachmentId,
    },
  }));
  expect(paid.status).toBe('PAID');
  return paid.payments!.find((payment) => payment.status === 'RECORDED')!;
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

  test('REIMB-03 @p1 manager approves, owner finance-reviews, and pays throwaway request', async ({ api, apiAs, companyId }) => {
    const manager = await apiAs('MANAGER');
    await withPolicy(api, companyId, { requireReceipt: false, allowSelfApproval: true, allowMissingReceiptWithReason: true, financeReviewRequired: true }, async () => {
      const draft = await createReimbursement(api, companyId, ['88.00']);
      const submitted = await json<Reimbursement>(await api.post(`companies/${companyId}/reimbursements/${draft.id}/submit`, { data: {} }));
      const approved = await json<Reimbursement>(await manager.post(`companies/${companyId}/reimbursements/${draft.id}/approve`, {
        data: { approvalSnapshotHash: submitted.approvalSnapshotHash },
      }));
      expect(['FINANCE_REVIEW', 'READY_FOR_PAYMENT']).toContain(approved.status);

      const reviewed = await json<Reimbursement>(await api.post(`companies/${companyId}/reimbursements/${draft.id}/finance-review`, {
        data: { decision: 'APPROVED_FOR_PAYMENT', note: 'E2E finance review' },
      }));
      expect(reviewed.status).toBe('READY_FOR_PAYMENT');

      const paid = await json<Reimbursement>(await api.post(`companies/${companyId}/reimbursements/${draft.id}/payments`, {
        data: { idempotencyKey: `e2e-pay-${draft.id}`, paidAmount: '88.00', currency: 'THB', paymentMethod: 'CASH', paidAt: new Date().toISOString() },
      }));
      expect(paid.status).toBe('PAID');
      expect(paid.paymentStatus).toBe('PAID');

      const list = await json<ReimbursementPage>(await api.get(`companies/${companyId}/reimbursements?pageSize=100`));
      expect(list.items.some((item) => item.id === draft.id && item.status === 'PAID')).toBe(true);
    });
  });

  // AC02: the solo owner walks ส่งอนุมัติ → อนุมัติ → บันทึกจ่าย on the one journey page, never leaving it.
  test('REIMB-07 @p1 owner submits, approves, and pays a claim on the journey page without leaving it', async ({ authedPage, api, companyId }) => {
    await withPolicy(api, companyId, { requireReceipt: false, allowMissingReceiptWithReason: true, financeReviewRequired: false }, async () => {
      const draft = await createReimbursement(api, companyId, ['77.00']);
      await gotoCompany(authedPage, companyId, `/reimbursements/${draft.id}`);
      const url = new RegExp(`/reimbursements/${draft.id}$`);
      await expect(authedPage).toHaveURL(url);

      await authedPage.getByRole('button', { name: 'ส่งอนุมัติ', exact: true }).click();
      await expect(authedPage.getByRole('button', { name: 'อนุมัติ', exact: true })).toBeVisible();

      // authedPage is the seeded OWNER, exempt from the self-approval switch; approving own
      // request opens the inline payment form automatically (AC03) with the outstanding
      // amount and today's date filled in. The method is the payer's to choose (owner
      // 2026-10-01): nothing is pre-selected, and saving without one is refused on the form.
      await authedPage.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
      await expect(authedPage.getByText('จ่ายเต็มจำนวนคงค้าง')).toBeVisible();
      const method = authedPage.getByRole('combobox', { name: 'วิธีจ่าย', exact: true });
      await expect(method).toHaveText('เลือกวิธีจ่าย');
      await authedPage.getByRole('button', { name: 'บันทึกจ่าย', exact: true }).click();
      await expect(authedPage.getByText('กรุณาเลือกวิธีจ่าย')).toBeVisible();
      await method.click();
      await authedPage.getByRole('option', { name: 'เงินสด', exact: true }).click();
      await authedPage.getByRole('button', { name: 'บันทึกจ่าย', exact: true }).click();

      await expect(authedPage.getByText('จ่ายแล้ว').first()).toBeVisible();
      await expect(authedPage).toHaveURL(url);
    });
  });

  // Owner decision 2026-10-01: a payment recorded as a bank transfer carries its slip. The form asks
  // for it, and the API refuses the same payment when it is posted straight to it.
  test('REIMB-08 @p1 a transfer is refused without its slip, on the form and by the API, and recorded with one', async ({ authedPage, api, request, companyId }) => {
    await withPolicy(api, companyId, PAYABLE, async () => {
      const claim = await payableClaim(api, api, companyId, '64.00');

      await gotoCompany(authedPage, companyId, `/reimbursements/${claim.id}`);
      await authedPage.getByRole('button', { name: 'บันทึกจ่าย', exact: true }).click();
      await expect(authedPage.getByText('จ่ายเต็มจำนวนคงค้าง')).toBeVisible();
      await chooseThemedOption(authedPage, authedPage.getByRole('combobox', { name: 'วิธีจ่าย', exact: true }), 'โอนเงิน');
      await authedPage.getByRole('textbox', { name: 'เลขอ้างอิง', exact: true }).fill('E2E-TXN-FORM');
      await authedPage.getByRole('button', { name: 'บันทึกจ่าย', exact: true }).click();
      await expect(authedPage.getByRole('alert').filter({ hasText: 'จ่ายด้วยการโอนต้องแนบสลิป' })).toBeVisible();

      const transfer = { paidAmount: '64.00', currency: 'THB', paymentMethod: 'BANK_TRANSFER', paymentReference: 'E2E-TXN-API', paidAt: new Date().toISOString() };
      const refused = await api.post(`${claimUrl(companyId, claim.id)}/payments`, { data: { ...transfer, idempotencyKey: `e2e-slipless-${claim.id}` } });
      expect(refused.status()).toBe(422);
      expect(await refused.text()).toContain('payment_slip_required');
      const unpaid = await json<Reimbursement>(await api.get(claimUrl(companyId, claim.id)));
      expect([unpaid.status, unpaid.payments?.length]).toEqual(['READY_FOR_PAYMENT', 0]);

      const slipAttachmentId = await uploadSlip(api, request, companyId, claim.id);
      const payment = await payByTransfer(api, companyId, claim, slipAttachmentId);
      expect([payment.paymentMethod, payment.slipCount, payment.viewerCanOpenSlips]).toEqual(['BANK_TRANSFER', 1, true]);

      await authedPage.reload();
      await expect(authedPage.getByText('มีสลิปแนบ 1 ไฟล์')).toBeVisible();
      await expect(authedPage.getByRole('button', { name: 'ดูสลิป', exact: true })).toBeVisible();
    });
  });

  // The slip's readers are the requester, the claim's approver, payment-record holders and finance
  // reviewers. Everyone else who reads the claim is told a slip exists, and is not given the file.
  test('REIMB-09 @p1 the requester opens the slip of their own claim, and a reader outside its group only learns that one exists', async ({ api, apiAs, pageAs, request, companyId }) => {
    const staff = await apiAs('STAFF');
    // Reads every claim of the company; holds neither the payment-record right nor finance review.
    const reader = await apiAs('COMPANY_VIEW');
    await withPolicy(api, companyId, PAYABLE, async () => {
      const claim = await payableClaim(staff, api, companyId, '52.00');
      const slipAttachmentId = await uploadSlip(api, request, companyId, claim.id);
      const payment = await payByTransfer(api, companyId, claim, slipAttachmentId);
      const slip = slipUrl(companyId, claim.id, payment.id, slipAttachmentId);

      const own = await json<Reimbursement>(await staff.get(claimUrl(companyId, claim.id)));
      expect(own.payments?.[0]).toMatchObject({ slipCount: 1, viewerCanOpenSlips: true, slips: [{ attachmentId: slipAttachmentId }] });
      expect((await json<{ downloadUrl: string }>(await staff.get(slip))).downloadUrl).toBeTruthy();
      const staffPage = await pageAs('STAFF');
      await gotoCompany(staffPage, companyId, `/reimbursements/${claim.id}`);
      await expect(staffPage.getByRole('button', { name: 'ดูสลิป', exact: true })).toBeVisible();

      const seen = await json<Reimbursement>(await reader.get(claimUrl(companyId, claim.id)));
      expect(seen.payments?.[0]).toMatchObject({ slipCount: 1, viewerCanOpenSlips: false, slips: [] });
      expect(JSON.stringify(seen)).not.toContain(slipAttachmentId);
      const refused = await reader.get(slip);
      expect(refused.status()).toBe(403);
      expect(await refused.text()).toContain('payment_slip_access_denied');
      const readerPage = await pageAs('COMPANY_VIEW');
      await gotoCompany(readerPage, companyId, `/reimbursements/${claim.id}`);
      await expect(readerPage.getByText('มีสลิปแนบ 1 ไฟล์')).toBeVisible();
      await expect(readerPage.getByRole('button', { name: 'ดูสลิป', exact: true })).toHaveCount(0);
    });
  });

  // Owner answer 2026-10-01: a finance reviewer who cannot record payments may still open the slip.
  // The generic attachment download is not a way to it for anyone, the payer included.
  test('REIMB-10 @p1 an accountant who reviews but cannot pay opens the slip, and the generic file download serves it to nobody', async ({ api, apiAs, request, companyId }) => {
    const accountant = await apiAs('ACCOUNTANT');
    await withPolicy(api, companyId, PAYABLE, async () => {
      const claim = await payableClaim(api, api, companyId, '47.00');
      const slipAttachmentId = await uploadSlip(api, request, companyId, claim.id);
      const payment = await payByTransfer(api, companyId, claim, slipAttachmentId);

      const reviewed = await json<Reimbursement>(await accountant.get(claimUrl(companyId, claim.id)));
      expect(reviewed.payments?.[0]).toMatchObject({ slipCount: 1, viewerCanOpenSlips: true, slips: [{ attachmentId: slipAttachmentId }] });
      expect((await json<{ downloadUrl: string }>(await accountant.get(slipUrl(companyId, claim.id, payment.id, slipAttachmentId)))).downloadUrl).toBeTruthy();
      // Opening is all the review right gives: adding a slip stays with whoever may record payments.
      const attach = await accountant.post(`${claimUrl(companyId, claim.id)}/payments/${payment.id}/slips`, { data: { attachmentId: slipAttachmentId } });
      expect(attach.status()).toBe(403);

      for (const client of [api, accountant]) {
        const generic = await client.get(`companies/${companyId}/attachments/${slipAttachmentId}/download-url`);
        expect(generic.status()).toBe(403);
      }
    });
  });

  // The production incident of 1 October: slips went into "ใบเบิกที่เซ็นแล้ว" with the signed-on-paper
  // declaration, because the payment step had nowhere to put one. The file is moved, not uploaded again.
  test('REIMB-11 @p1 a slip attached as a signed copy by mistake becomes the slip of the payment, and the paper declaration goes with it', async ({ api, request, companyId }) => {
    await withPolicy(api, companyId, PAYABLE, async () => {
      const claim = await payableClaim(api, api, companyId, '41.00');
      const paid = await json<Reimbursement>(await api.post(`${claimUrl(companyId, claim.id)}/payments`, {
        data: { idempotencyKey: `e2e-cash-${claim.id}`, paidAmount: '41.00', currency: 'THB', paymentMethod: 'CASH', paidAt: new Date().toISOString() },
      }));
      const payment = paid.payments!.find((row) => row.status === 'RECORDED')!;
      expect(payment.slipCount).toBe(0);

      const misfiled = await uploadPlainFile(api, request, companyId);
      const copies = await json<{ attachmentId: string }[]>(await api.post(`${claimUrl(companyId, claim.id)}/claim-form/signed-copies`, {
        data: { attachmentId: misfiled, acknowledgedComplete: true, confirmedRequestNo: paid.requestNo },
      }));
      expect(copies.map((copy) => copy.attachmentId)).toEqual([misfiled]);
      expect((await json<Reimbursement>(await api.get(claimUrl(companyId, claim.id)))).documentSignedVia).toBe('PAPER');

      const moved = await json<Reimbursement>(await api.post(`${claimUrl(companyId, claim.id)}/payments/${payment.id}/slips`, { data: { attachmentId: misfiled } }));
      expect(moved.payments?.find((row) => row.id === payment.id)).toMatchObject({ slipCount: 1, slips: [{ attachmentId: misfiled }] });
      const after = await json<Reimbursement>(await api.get(claimUrl(companyId, claim.id)));
      expect(after.signedCopies).toEqual([]);
      expect(after.documentSignedVia ?? null).toBeNull();
      expect(after.status).toBe('PAID');

      // Payment evidence now: opened through the claim, not the generic download, and never a signed copy again.
      expect((await json<{ downloadUrl: string }>(await api.get(slipUrl(companyId, claim.id, payment.id, misfiled)))).downloadUrl).toBeTruthy();
      expect((await api.get(`companies/${companyId}/attachments/${misfiled}/download-url`)).status()).toBe(403);
      const again = await api.post(`${claimUrl(companyId, claim.id)}/claim-form/signed-copies`, { data: { attachmentId: misfiled } });
      expect(again.status()).toBe(400);
    });
  });
});

for (const width of [1280, 390]) {
  test(`REIMB-HEADER keeps the primary action separate from work navigation at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoCompany(page, companyId, '/reimbursements');
    const create = page.getByRole('link', { name: '+ สร้างคำขอเบิก', exact: true });
    const nav = page.getByRole('navigation', { name: 'งานเบิกจ่าย' });
    await expect(create).toHaveCount(1);
    await expect(create).toBeVisible();
    await expect(nav).toBeVisible();
    const actionBox = await create.boundingBox(), navBox = await nav.boundingBox();
    expect(navBox!.y).toBeGreaterThanOrEqual(actionBox!.y + actionBox!.height);
    await nav.getByRole('button', { name: 'คิวอนุมัติ', exact: true }).click();
    await expect(create).toBeHidden();
    await expect(nav.getByRole('button', { name: 'คิวอนุมัติ', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await nav.getByRole('button', { name: 'รายการที่เกี่ยวข้อง', exact: true }).click();
    await expect(create).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`reimbursement-header-${width}.png`), fullPage: true });
  });
}
