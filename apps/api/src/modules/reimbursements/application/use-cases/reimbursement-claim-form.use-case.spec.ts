import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PreviewReimbursementClaimFormUseCase } from './reimbursement-claim-form.use-case';

// Lane D: snapshot building + guards. The rendered bytes are asserted in
// claim-form.logic.spec.ts; here we care about who may print, when, and that
// the ids on the record become real names in exactly one batched lookup.

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'staff-1', companyId: 'co-1',
    membershipId: 'm', roles: ['STAFF'], permissions: ['reimbursement.read_own'],
    scopes: {}, authProvider: 'dev', ...overrides,
  } as any;
}

function request(overrides: Partial<any> = {}) {
  return {
    id: 'rb-1', companyId: 'co-1', branchId: 'br-1', requestNo: 'RB-202607-000012',
    requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'สมชาย ใจดี',
    reason: 'ค่าเดินทางไปพบลูกค้า', categoryKey: 'travel', amount: '750.0000', currency: 'THB',
    incurredDate: new Date('2026-07-15T00:00:00.000Z'), submittedAt: new Date('2026-07-20T00:00:00.000Z'),
    status: 'PAID', financeReviewStatus: 'APPROVED_FOR_PAYMENT',
    financeReviewedByUserId: 'acct-1', financeReviewedAt: new Date('2026-07-22T00:00:00.000Z'),
    paymentStatus: 'PAID', duplicateStatus: 'NO_MATCH', receiptRequirementStatus: 'ATTACHED',
    postingStatus: 'not_required', paymentTotalAmount: '750.0000', outstandingAmount: '0.0000',
    createdByUserId: 'staff-1', createdAt: new Date('2026-07-19T00:00:00.000Z'), updatedAt: new Date('2026-07-23T00:00:00.000Z'),
    lines: [
      { id: 'l-2', lineNo: 2, incurredDate: new Date('2026-07-16T00:00:00.000Z'), description: 'ค่าอาหาร', purpose: undefined, categoryKey: 'meals', amount: '450.0000', attachmentId: undefined, linkedExpenseId: undefined },
      { id: 'l-1', lineNo: 1, incurredDate: new Date('2026-07-15T00:00:00.000Z'), description: 'ค่าแท็กซี่', purpose: 'พบลูกค้า', categoryKey: 'travel', amount: '300.0000', attachmentId: 'att-1', linkedExpenseId: undefined },
    ],
    approvalSteps: [
      { id: 'st-1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'mgr-1', decidedAt: new Date('2026-07-21T00:00:00.000Z') },
    ],
    payments: [
      { id: 'pay-void', status: 'VOIDED', paidByUserId: 'ghost-1', paidAt: new Date('2026-07-24T00:00:00.000Z') },
      { id: 'pay-1', status: 'RECORDED', paidByUserId: 'fin-1', paidAt: new Date('2026-07-23T00:00:00.000Z'), paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-9' },
    ],
    ...overrides,
  } as any;
}

const signatureRow = (role: string, userId: string, id = `sig-${role}`) => ({
  id, role, signatureAttachmentId: `att-${id}`, signedByUserId: userId, signedAt: new Date('2026-07-24T01:00:00.000Z'),
});

/** Smallest bytes that pass the PNG magic-byte check. */
const PNG_BYTES = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('signature')]);

function fakeRepo(row: any | null, slips: Record<string, { attachmentId: string; attachedAt: Date }[]> = {}) {
  const calls = { nameLookups: [] as string[][], signatureLookups: [] as any[], slipLookups: [] as string[][] };
  const repo = {
    findRequestById: async (_companyId: string, _id: string, _withRelations?: boolean) => row,
    // No signed-copy reader on purpose: the printed form never depends on the scans attached back.
    listPaymentSlips: async (_companyId: string, paymentIds: string[]) => {
      calls.slipLookups.push(paymentIds);
      return Object.fromEntries(paymentIds.filter((id) => slips[id]).map((id) => [id, slips[id]]));
    },
    getClaimFormCompanyContext: async () => ({ name: 'บริษัท ทดสอบ จำกัด', taxId: '0100000000000', branchName: 'สาขาลาดพร้าว' }),
    getUserDisplayNames: async (_companyId: string, userIds: string[]) => {
      calls.nameLookups.push(userIds);
      return { 'mgr-1': 'มานี ผู้จัดการ', 'acct-1': 'ปรีชา บัญชี', 'fin-1': 'สุดา การเงิน' } as Record<string, string>;
    },
    findClaimSignatureAttachment: async (companyId: string, attachmentId: string, userId: string, requestId: string, role: string) => {
      calls.signatureLookups.push({ companyId, attachmentId, userId, requestId, role });
      return { id: attachmentId, bucket: 'b', objectKey: `k/${attachmentId}`, mimeType: 'image/png', byteSize: PNG_BYTES.length, checksumSha256: null };
    },
  } as any;
  return { repo, calls };
}

function fakeStorage(bytes: Buffer = PNG_BYTES) {
  return { getObject: async () => ({ bytes, mimeType: 'image/png' }) } as any;
}

function previewUseCase(repo: any, storage: any = fakeStorage()) {
  return new PreviewReimbursementClaimFormUseCase(repo, storage);
}

function svgOf(result: { svgDataUrl: string }): string {
  const [, base64] = result.svgDataUrl.split('base64,');
  return Buffer.from(base64!, 'base64').toString('utf8');
}

describe('PreviewReimbursementClaimFormUseCase', () => {
  // Payout spec §15, §17.1: a claim sent before claims carried a receiving account prints as it
  // always did, on either layout. The digests are of the answer BEFORE the payout line was added
  // (committed on their own, against the untouched use case), so they pin the old print.
  it('answers a legacy claim with the same bytes as before the payout line, on both layouts', async () => {
    const answer = async (row: any) => {
      const result = await previewUseCase(fakeRepo(row).repo).execute(ctx(), 'rb-1');
      // The endpoint's answer keeps its shape: two renderings of the form and the checksum of the first.
      assert.deepEqual(Object.keys(result), ['svgDataUrl', 'pageSvgDataUrls', 'checksumSha256']);
      assert.equal(result.checksumSha256, createHash('sha256').update(svgOf(result)).digest('hex'));
      return [result.checksumSha256, createHash('sha256').update(result.pageSvgDataUrls!.join('\n')).digest('hex')];
    };
    assert.deepEqual(await answer(request()), ['02422d0511230c547357f416f85bdf4c36336544b56d2b158f4a9c55139c0d3c', '619a3e83bfae529daecaef1c831f432b7be5098aded35d6cf067af19155c1112']);
    // Signed in the payer block: the four-block form, with both stored signatures drawn.
    assert.deepEqual(await answer(request({ claimSignatures: [signatureRow('REQUESTER', 'staff-1'), signatureRow('PAYER', 'fin-1')] })), ['63993c6c49e5c0aeed166eeb3959e06a42f973c5b652a14a897fc54a7b3bda0d', '09341ab7212936d7cfea723e83d5041a7e426ebbe6b4afa24fcbb53f59fe1ba8']);
  });

  // The payment line and the payment-evidence box are read from the same recorded payment the
  // claim page shows, so paper and screen cannot disagree about the method, the reference or the slip.
  it('ticks หลักฐานการชำระเงิน for a slip on the recorded payment, and not for one left on a voided payment', async () => {
    const attachedAt = new Date('2026-07-23T01:00:00.000Z');
    const ticks = async (slips: Record<string, { attachmentId: string; attachedAt: Date }[]>, row = request()) =>
      (svgOf(await previewUseCase(fakeRepo(row, slips).repo).execute(ctx(), 'rb-1')).match(/<path d="M/g) ?? []).length;

    assert.equal(await ticks({}), 1, 'the receipt box only');
    assert.equal(await ticks({ 'pay-1': [{ attachmentId: 'att-slip', attachedAt }] }), 2);
    assert.equal(await ticks({ 'pay-void': [{ attachmentId: 'att-old-slip', attachedAt }] }), 1, 'a voided payment\'s slip is history, not evidence of this payment');

    // Voided and not paid again: no payment is printed, so nothing is asked and nothing is ticked.
    const voidedOnly = request({ status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', payments: [request().payments[0]] });
    const { repo, calls } = fakeRepo(voidedOnly, { 'pay-void': [{ attachmentId: 'att-old-slip', attachedAt }] });
    const svg = svgOf(await previewUseCase(repo).execute(ctx(), 'rb-1'));
    assert.equal((svg.match(/<path d="M/g) ?? []).length, 1);
    assert.match(svg, /การจ่ายเงินคืน: ยังไม่จ่าย/);
    assert.deepEqual(calls.slipLookups, []);
  });

  it('uses the recorded cancellation reason only after cancellation completes', async () => {
    const cancellation = { rejectionReason: 'เบิกซ้ำกับรายการเดือนก่อน', cancelledAt: new Date('2026-09-10T01:00:00Z') };
    const { repo } = fakeRepo(request({ status: 'CANCELLED', ...cancellation }));
    const cancelled = svgOf(await previewUseCase(repo).execute(ctx(), 'rb-1'));
    assert.match(cancelled, /CANCELLED/);
    assert.match(cancelled, /เบิกซ้ำกับรายการเดือนก่อน/);
    for (const status of ['REJECTED', 'SUBMITTED', 'APPROVED']) {
      const active = fakeRepo(request({ status, rejectionReason: cancellation.rejectionReason, cancellationPendingAt: cancellation.cancelledAt }));
      assert.doesNotMatch(svgOf(await previewUseCase(active.repo).execute(ctx(), 'rb-1')), /CANCELLED|เหตุผลการยกเลิกเอกสาร/);
    }
  });

  it('renders a signed form with resolved names in one batched lookup', async () => {
    const { repo, calls } = fakeRepo(request());
    const result = await previewUseCase(repo).execute(ctx(), 'rb-1');

    assert.ok(result.svgDataUrl.startsWith('data:image/svg+xml;base64,'));
    assert.ok(result.pageSvgDataUrls?.length);
    assert.ok(result.pageSvgDataUrls.every((url) => url.startsWith('data:image/svg+xml;base64,')));
    assert.match(result.checksumSha256, /^[0-9a-f]{64}$/);

    const svg = svgOf(result);
    assert.match(svg, /RB-202607-000012/);
    assert.match(svg, /บริษัท ทดสอบ จำกัด/);
    assert.match(svg, /สาขา: สาขาลาดพร้าว/);
    assert.match(svg, /\( สมชาย ใจดี \)/);
    assert.match(svg, /\( มานี ผู้จัดการ \)/);
    // Two-signer form: the payer is named on the repayment line, finance review has no block.
    assert.match(svg, /การจ่ายเงินคืน: จ่ายเมื่อ 23 ก\.ค\. 2569 วิธี โอนเงิน เลขอ้างอิง TXN-9 บันทึกโดย สุดา การเงิน/);
    assert.doesNotMatch(svg, /ปรีชา บัญชี|ฝ่ายบัญชี|ฝ่ายการเงิน/);
    // Lines print in lineNo order, not repository order.
    assert.ok(svg.indexOf('ค่าแท็กซี่') < svg.indexOf('ค่าอาหาร'));
    // One line carries a receipt → the ใบเสร็จรับเงิน box is ticked.
    assert.equal((svg.match(/<path d="M/g) ?? []).length, 1);
    // The voided payment never signs; the recorded one does.
    assert.doesNotMatch(svg, /ghost-1/);

    assert.equal(calls.nameLookups.length, 1, 'names resolve in a single batch query');
    assert.deepEqual(calls.nameLookups[0], ['mgr-1', 'acct-1', 'fin-1']);
    // The slip is asked of the one payment the form prints, never of the voided one.
    assert.deepEqual(calls.slipLookups, [['pay-1']]);
  });

  it('rejects a draft: there is no document number to print yet', async () => {
    const { repo } = fakeRepo(request({ status: 'DRAFT', requestNo: undefined, submittedAt: undefined }));
    await assert.rejects(
      () => previewUseCase(repo).execute(ctx(), 'rb-1'),
      /claim_form_requires_submitted/,
    );
  });

  it('rejects a claim cancelled straight out of DRAFT: it never got a document number', async () => {
    const { repo } = fakeRepo(request({ status: 'CANCELLED', requestNo: undefined, submittedAt: undefined }));
    await assert.rejects(
      () => previewUseCase(repo).execute(ctx(), 'rb-1'),
      /claim_form_requires_submitted/,
    );
  });

  it('prints the waiver reason for a claim with no line evidence', async () => {
    const { repo } = fakeRepo(request({
      receiptRequirementStatus: 'MISSING_WITH_REASON',
      missingReceiptReason: 'ร้านค้าไม่ออกใบเสร็จ',
      lines: [{ id: 'l-1', lineNo: 1, incurredDate: new Date('2026-07-15T00:00:00.000Z'), description: 'ค่าแท็กซี่', categoryKey: 'travel', amount: '300.0000' }],
    }));
    const svg = svgOf(await previewUseCase(repo).execute(ctx(), 'rb-1'));
    assert.match(svg, /เหตุผลที่ไม่มีใบเสร็จ: ร้านค้าไม่ออกใบเสร็จ/);
  });

  it('rejects a missing claim', async () => {
    const { repo } = fakeRepo(null);
    await assert.rejects(
      () => previewUseCase(repo).execute(ctx(), 'rb-nope'),
      /not found/i,
    );
  });

  it('applies the same read guard as the detail endpoint', async () => {
    const { repo } = fakeRepo(request({ requesterUserId: 'other-1' }));
    await assert.rejects(
      () => previewUseCase(repo).execute(ctx(), 'rb-1'),
      /Cannot read this reimbursement/,
    );
    // A reader with the company-wide permission may print anyone's claim.
    const wide = await previewUseCase(repo)
      .execute(ctx({ permissions: ['reimbursement.read'] }), 'rb-1');
    assert.ok(wide.svgDataUrl.length > 0);
  });

  it('leaves the approver block blank and says ยังไม่จ่าย until those steps happen', async () => {
    const { repo, calls } = fakeRepo(request({
      status: 'PENDING_APPROVAL',
      financeReviewStatus: 'PENDING', financeReviewedByUserId: undefined, financeReviewedAt: undefined,
      approvalSteps: [{ id: 'st-1', sequenceNo: 1, status: 'PENDING' }],
      payments: [],
      lines: [{ id: 'l-1', lineNo: 1, incurredDate: new Date('2026-07-15T00:00:00.000Z'), description: 'ค่าแท็กซี่', categoryKey: 'travel', amount: '300.0000' }],
    }));
    const svg = svgOf(await previewUseCase(repo).execute(ctx(), 'rb-1'));

    assert.match(svg, /\( สมชาย ใจดี \)/);
    assert.equal((svg.match(/\(\s+\.{20}\s+\)/g) ?? []).length, 1);
    assert.match(svg, /การจ่ายเงินคืน: ยังไม่จ่าย/);
    // No evidence on any line → the receipt box stays unticked.
    assert.equal((svg.match(/<path d="M/g) ?? []).length, 0);
    assert.deepEqual(calls.nameLookups[0], []);
  });

  it('does not print an accounting signature for a blocked finance review on a legacy form', async () => {
    // A payer signature row keeps the four-block form even after that payment was voided.
    const { repo } = fakeRepo(request({ financeReviewStatus: 'BLOCKED', payments: [], claimSignatures: [signatureRow('PAYER', 'fin-1')] }));
    const svg = svgOf(await previewUseCase(repo).execute(ctx(), 'rb-1'));
    assert.doesNotMatch(svg, /ปรีชา บัญชี/);
    assert.equal((svg.match(/\(\s+\.{20}\s+\)/g) ?? []).length, 2, 'accounting and finance stay blank');
  });

  it('keeps a rejected claim printable with a blank approver block', async () => {
    const { repo } = fakeRepo(request({
      status: 'REJECTED', rejectionReason: 'เอกสารไม่ครบ',
      approvalSteps: [{ id: 'st-1', sequenceNo: 1, status: 'REJECTED', decisionByUserId: 'mgr-1', decidedAt: new Date('2026-07-21T00:00:00.000Z') }],
      financeReviewStatus: 'NOT_REQUIRED', financeReviewedByUserId: undefined, financeReviewedAt: undefined,
      payments: [],
    }));
    const svg = svgOf(await previewUseCase(repo).execute(ctx(), 'rb-1'));
    assert.doesNotMatch(svg, /มานี ผู้จัดการ/, 'a rejection is not an approval signature');
    assert.equal((svg.match(/\(\s+\.{20}\s+\)/g) ?? []).length, 1);
  });

  // ---- Lane F: stored signatures ----

  it('embeds each stored signature in its own block, loaded as that signer', async () => {
    const { repo, calls } = fakeRepo(request({
      claimSignatures: [
        { id: 'sig-1', role: 'REQUESTER', signatureAttachmentId: 'att-sig-1', signedByUserId: 'staff-1', signedAt: new Date('2026-07-20T01:00:00.000Z') },
        { id: 'sig-2', role: 'APPROVER', signatureAttachmentId: 'att-sig-2', signedByUserId: 'mgr-1', signedAt: new Date('2026-07-21T01:00:00.000Z') },
      ],
    }));
    const svg = svgOf(await previewUseCase(repo).execute(ctx(), 'rb-1'));

    const images = svg.match(/<image href="data:image\/png;base64,[^"]+" x="(\d+)"/g) ?? [];
    assert.equal(images.length, 2, 'only signed roles get an image');
    // Two half-page blocks centred at 235 and 615; image x = centre - 40.
    assert.match(svg, /<image href="data:image\/png;base64,[^"]+" x="195"/);
    assert.match(svg, /<image href="data:image\/png;base64,[^"]+" x="575"/);
    // Names and ruled lines stay — the image sits above the ลงชื่อ line.
    assert.match(svg, /\( สมชาย ใจดี \)/);
    assert.match(svg, /\( มานี ผู้จัดการ \)/);
    // Each signature is loaded as the user who signed it, scoped to this claim+role.
    assert.deepEqual(calls.signatureLookups, [
      { companyId: 'co-1', attachmentId: 'att-sig-1', userId: 'staff-1', requestId: 'rb-1', role: 'REQUESTER' },
      { companyId: 'co-1', attachmentId: 'att-sig-2', userId: 'mgr-1', requestId: 'rb-1', role: 'APPROVER' },
    ]);
  });

  it('refuses to print a signature whose bytes are not the declared image', async () => {
    const { repo } = fakeRepo(request({
      claimSignatures: [
        { id: 'sig-1', role: 'REQUESTER', signatureAttachmentId: 'att-sig-1', signedByUserId: 'staff-1', signedAt: new Date('2026-07-20T01:00:00.000Z') },
      ],
    }));
    const error: any = await previewUseCase(repo, fakeStorage(Buffer.from('%PDF-1.7 not a png')))
      .execute(ctx(), 'rb-1').then(() => null, (e: unknown) => e);

    assert.equal(error.getStatus(), 422);
    assert.deepEqual(error.getResponse(), {
      message: ['claim_signature_unreadable', 'REQUESTER'],
      code: 'claim_signature_unreadable',
      role: 'REQUESTER',
      reason: 'claim_signature_bytes_mismatch',
    });
  });

  // ---- Step journey (D3, AC06, AC07, A4) ----

  it('reprints a claim signed in the payer block on the legacy four-block form, verifying each checksum as before (AC07)', async () => {
    const claimSignatures = [signatureRow('REQUESTER', 'staff-1'), signatureRow('PAYER', 'fin-1')];
    const goodChecksum = createHash('sha256').update(PNG_BYTES).digest('hex');
    const { repo } = fakeRepo(request({ claimSignatures }));
    repo.findClaimSignatureAttachment = async (_c: string, attachmentId: string) => ({
      id: attachmentId, bucket: 'b', objectKey: `k/${attachmentId}`, mimeType: 'image/png', byteSize: PNG_BYTES.length, checksumSha256: goodChecksum,
    });
    const svg = svgOf(await previewUseCase(repo).execute(ctx(), 'rb-1'));
    assert.equal((svg.match(/<line x1="\d+" y1="\d+" x2="\d+" y2="\d+" stroke="#222"/g) ?? []).length, 4);
    for (const name of ['สมชาย ใจดี', 'มานี ผู้จัดการ', 'ปรีชา บัญชี', 'สุดา การเงิน']) assert.match(svg, new RegExp(`\\( ${name} \\)`));
    // Block 0 (ผู้เบิก) and block 3 (ฝ่ายการเงิน) carry their images; image x = block + 55.
    assert.match(svg, /<image href="data:image\/png;base64,[^"]+" x="100"/);
    assert.match(svg, /<image href="data:image\/png;base64,[^"]+" x="670"/);
    assert.doesNotMatch(svg, /การจ่ายเงินคืน/, 'the legacy form states payment through its payer block, as it did when signed');

    repo.findClaimSignatureAttachment = async (_c: string, attachmentId: string) => ({
      id: attachmentId, bucket: 'b', objectKey: `k/${attachmentId}`, mimeType: 'image/png', byteSize: PNG_BYTES.length, checksumSha256: 'f'.repeat(64),
    });
    const error: any = await previewUseCase(repo).execute(ctx(), 'rb-1').then(() => null, (e: unknown) => e);
    assert.equal(error.getStatus(), 422);
    assert.equal(error.getResponse().reason, 'claim_signature_checksum_mismatch');
  });

  it('prints the self-approval line under the two blocks for a one-person claim (AC06)', async () => {
    const { repo } = fakeRepo(request({
      requesterUserId: 'mgr-1', requesterDisplayNameSnapshot: 'มานี ผู้จัดการ',
      financeReviewStatus: 'NOT_REQUIRED', financeReviewedByUserId: undefined, financeReviewedAt: undefined,
      payments: [{ id: 'pay-1', status: 'RECORDED', paidByUserId: 'mgr-1', paidAt: new Date('2026-07-23T00:00:00.000Z'), paymentMethod: 'CASH' }],
      claimSignatures: [signatureRow('REQUESTER', 'mgr-1'), signatureRow('APPROVER', 'mgr-1')],
    }));
    const svg = svgOf(await previewUseCase(repo).execute(ctx({ userId: 'mgr-1', permissions: ['reimbursement.read'] }), 'rb-1'));
    assert.match(svg, /ผู้เบิกและผู้อนุมัติเป็นบุคคลเดียวกัน อนุมัติรายการของตนเองตามนโยบายบริษัท/);
    assert.equal((svg.match(/<image href=/g) ?? []).length, 2);
    assert.match(svg, /วิธี เงินสด เลขอ้างอิง - บันทึกโดย มานี ผู้จัดการ/);
  });

  it('prints the policy note in the approver block of an auto-approved claim', async () => {
    const { repo } = fakeRepo(request({
      approvalSteps: [],
      approvalPolicySnapshotJson: {
        schemaVersion: 1, policyId: 'p-1', policyVersion: 'v1', approvalRequiredFromAmount: '1000.00', requiresApproval: false,
        route: null, allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: false,
        duplicatePolicy: 'WARN', financeReviewRequired: false,
      },
    }));
    const svg = svgOf(await previewUseCase(repo).execute(ctx(), 'rb-1'));
    assert.match(svg, /ผู้อนุมัติ<\/text>\s*<text x="615" y="\d+" text-anchor="middle" font-size="13">ไม่ต้องอนุมัติตามนโยบาย<\/text>/);
    assert.equal((svg.match(/\(\s+\.{20}\s+\)/g) ?? []).length, 0);
  });

  it('never draws a signature from a paper copy: only signature rows reach the form (A4)', async () => {
    const { repo } = fakeRepo(request({ claimSignatures: [] }));
    repo.listSignedClaimFormCopies = async () => { throw new Error('the renderer must not read signed copies'); };
    const result = await previewUseCase(repo).execute(ctx(), 'rb-1');
    assert.ok(result.pageSvgDataUrls?.length);
    for (const svg of [svgOf(result), ...result.pageSvgDataUrls.map((url) => svgOf({ svgDataUrl: url }))]) {
      assert.doesNotMatch(svg, /<image /);
    }
  });

  it('turns a storage outage into a 422 naming the block, not a 500', async () => {
    const { repo } = fakeRepo(request({
      claimSignatures: [
        { id: 'sig-1', role: 'REQUESTER', signatureAttachmentId: 'att-sig-1', signedByUserId: 'staff-1', signedAt: new Date('2026-07-20T01:00:00.000Z') },
        { id: 'sig-2', role: 'APPROVER', signatureAttachmentId: 'att-sig-2', signedByUserId: 'mgr-1', signedAt: new Date('2026-07-21T01:00:00.000Z') },
      ],
    }));
    // What a stale attachment row against MinIO looks like: the object/version is gone.
    const brokenStorage = {
      getObject: async () => { throw Object.assign(new Error('Invalid version id specified'), { name: 'InvalidArgument' }); },
    } as any;

    const error: any = await previewUseCase(repo, brokenStorage).execute(ctx(), 'rb-1').then(() => null, (e: unknown) => e);

    assert.equal(error.getStatus(), 422, 'a broken signature file is a document problem, not a server fault');
    assert.deepEqual(error.getResponse(), {
      message: ['claim_signature_unreadable', 'REQUESTER'],
      code: 'claim_signature_unreadable',
      role: 'REQUESTER',
      // Storage internals (bucket, key, version) never reach the client.
      reason: 'storage_unreadable',
    });
    assert.equal(JSON.stringify(error.getResponse()).includes('Invalid version id'), false);
  });
});
