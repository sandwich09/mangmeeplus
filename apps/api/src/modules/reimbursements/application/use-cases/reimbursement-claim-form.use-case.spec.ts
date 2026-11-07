import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PreviewReimbursementClaimFormUseCase } from './reimbursement-claim-form.use-case';
import { RevealClaimPayoutUseCase } from './reimbursement-payout-reveal.use-case';
import { claimSignatureAckHash } from '../../domain/logic/reimbursement.logic';
import { sealPayoutDestination } from '../../domain/logic/payout-destination.logic';
import { fakePayoutTables } from '../../infrastructure/reimbursement-payout.fixture';
import {
  readClaimPayout, readClaimPayoutSecret, readMemberPayoutAccount, readMemberPayoutSecret, readPaymentPayoutDestinations,
} from '../../infrastructure/reimbursement-payout';

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
const VALID_PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR4nGNgYGD4D8UQBgAd9AP9yOH2qAAAAABJRU5ErkJggg==', 'base64');

function fakeRepo(row: any | null, slips: Record<string, { attachmentId: string; attachedAt: Date }[]> = {}) {
  const calls = { nameLookups: [] as string[][], signatureLookups: [] as any[], slipLookups: [] as string[][] };
  const repo = {
    findRequestById: async (_companyId: string, _id: string, _withRelations?: boolean) => row,
    listClaimProjections: async () => (row?.lines ?? []).map((line: any, index: number) => ({ id: `e${index}`, sourceReimbursementLineId: line.id, status: 'CONFIRMED', branchId: row.branchId })),
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

/**
 * A claim that carries no receiving account prints without an audit row and without the encryption
 * key (payout spec §15): every test below that does not hand these two in proves it, by not failing.
 */
const NO_AUDIT = {
  log: async () => { throw new Error('this print must not write an audit row'); },
  logOrThrow: async () => { throw new Error('this print must not write an audit row'); },
} as any;
const NO_KEY = { get credentialEncryptionKey(): Buffer { throw new Error('this print must not read the encryption key'); } } as any;

function previewUseCase(repo: any, storage: any = fakeStorage(), audit: any = NO_AUDIT, config: any = NO_KEY) {
  return new PreviewReimbursementClaimFormUseCase(repo, storage, audit, config);
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
    assert.match(svg, /ผู้เบิกและผู้อนุมัติเป็นบุคคลเดียวกัน ใบนี้ได้รับการอนุมัติโดยผู้เบิกเอง/);
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

// ---- Payout spec §17.1, AC36 and the print part of AC17 ----
//
// The printed form is the second and last way a claim's full account number leaves the system. The
// API decides for whoever asked for THIS print, with the function the "แสดงเลขบัญชี" command uses.
describe('the receiving account on the printed claim form', () => {
  const key = Buffer.alloc(32, 7);
  /** The number as the requester typed it, and as it is stored and printed. */
  const TYPED = '004-5-67123-4';
  const NUMBER = '0045671234';
  const sentAt = new Date('2026-07-20T00:00:00.000Z');
  const decidedAt = new Date('2026-07-21T00:00:00.000Z');
  const count = (text: string, needle: string) => text.split(needle).length - 1;
  /** Every image of an answer, decoded: the one tall image first, then each A4 page. */
  const imagesOf = (result: { svgDataUrl: string; pageSvgDataUrls?: string[] }) =>
    [result.svgDataUrl, ...(result.pageSvgDataUrls ?? [])].map((url) => svgOf({ svgDataUrl: url }));

  type Account = { payoutKind: 'BANK_ACCOUNT' | 'PROMPTPAY_PHONE'; bankName?: string; accountName: string; accountNumber: string };
  const KBANK: Account = { payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: TYPED };

  /**
   * One claim paid by transfer, approved and attested by mgr-1 and not paid yet, over the real payout
   * readers and an in-memory copy of the payout tables. No reader of a member's default account is
   * given to the print: reaching for one fails the test.
   */
  function world(overrides: Record<string, unknown> = {}, options: { account?: Account; attested?: boolean; slips?: Record<string, { attachmentId: string; attachedAt: Date }[]> } = {}) {
    const tables = fakePayoutTables();
    const sealed = sealPayoutDestination(options.account ?? KBANK, key)!;
    tables.destinations.push({
      id: 'destination-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', version: 1, ...sealed,
      source: 'DEFAULT_ACCOUNT', createdByUserId: 'staff-1', frozenAt: sentAt,
      ...(options.attested !== false && { verifiedByUserId: 'mgr-1', verifiedAt: decidedAt, verifiedVia: 'APPROVAL', approvalStepId: 'st-1' }),
    });
    const claim = request({
      status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', paymentTotalAmount: '0.0000', outstandingAmount: '750.0000',
      submittedAt: sentAt, financeReviewStatus: 'NOT_REQUIRED', financeReviewedByUserId: undefined, financeReviewedAt: undefined,
      approvalSteps: [{ id: 'st-1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'mgr-1', decidedAt, assignedAt: sentAt }],
      payments: [], claimSignatures: [],
      payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: sealed.fingerprint,
      ...overrides,
    });
    const { repo, calls } = fakeRepo(claim, options.slips);
    const reads = { payout: 0, secret: 0, paidInto: [] as number[][] };
    Object.assign(repo, {
      findRequestById: async (companyId: string, id: string) => (companyId === claim.companyId && id === claim.id ? claim : null),
      isUserRelatedToRequest: async (_companyId: string, _requestId: string, userId: string) => userId === 'related-1',
      findActiveApproverUserIds: async (_companyId: string, ids: string[]) => new Set(ids),
      findPolicy: async () => null,
      findClaimPayout: (row: any) => { reads.payout += 1; return readClaimPayout(tables.client, row); },
      findClaimPayoutSecret: (companyId: string, requestId: string, version: number) => { reads.secret += 1; return readClaimPayoutSecret(tables.client, companyId, requestId, version); },
      listPaymentPayoutDestinations: (companyId: string, requestId: string, versions: number[]) => {
        reads.paidInto.push([...versions]);
        return readPaymentPayoutDestinations(tables.client, companyId, requestId, versions);
      },
    });
    const audits: any[] = [];
    /** What happened, in order: the audit write, then the key read that precedes the decrypt. */
    const events: string[] = [];
    const audit = { log: async (entry: any) => { audits.push(entry); }, logOrThrow: async (entry: any) => { events.push('audit'); audits.push(entry); } } as any;
    const config = { get credentialEncryptionKey() { events.push('key'); return key; } } as any;
    return {
      claim, tables, repo, calls, reads, audits, events, sealed,
      print: (viewer: any) => new PreviewReimbursementClaimFormUseCase(repo, fakeStorage(), audit, config).execute(viewer, 'rb-1'),
      /** The "แสดงเลขบัญชี" command over the same claim: whether it answers, and the rows it writes on a trail of its own. */
      reveal: async (viewer: any) => {
        const rows: any[] = [];
        const trail = { log: async (entry: any) => { rows.push(entry); }, logOrThrow: async (entry: any) => { rows.push(entry); } } as any;
        const answered = await new RevealClaimPayoutUseCase(repo, trail, { credentialEncryptionKey: key } as any).execute(viewer, 'rb-1').then(() => true, () => false);
        return { answered, rows };
      },
    };
  }

  const viewer = (userId: string, permissions: string[], overrides: Partial<any> = {}) => ctx({ userId, authSubject: userId, permissions, ...overrides });
  const requester = viewer('staff-1', ['reimbursement.read_own', 'reimbursement.create']);

  it('multi payout 2b: every permitted print reader gets holder facts through the use case', async () => {
    const w = world();
    Object.assign(w.tables.destinations[0]!, { holderType: 'THIRD_PARTY', holderNote: '<คู่สมรสของผู้เบิก>', verifiedByUserId: 'staff-1' });
    for (const who of [requester, viewer('auditor-1', ['reimbursement.read', 'reimbursement.export'])]) {
      for (const printed of imagesOf(await w.print(who))) {
        assert.match(printed, /บัญชีของบุคคลอื่น: &lt;คู่สมรสของผู้เบิก&gt;/);
        assert.match(printed, /ผู้เบิกยืนยันบัญชีของบุคคลอื่นด้วยตนเอง/);
      }
    }
  });
  const approver = viewer('mgr-1', ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject']);
  const payer = viewer('payer-1', ['reimbursement.read', 'reimbursement.payment.record']);
  const inGroup: Array<[string, any]> = [['REQUESTER', requester], ['APPROVER', approver], ['PAYER', payer]];
  const financeReviewer = viewer('acct-1', ['reimbursement.read', 'reimbursement.finance_review']);
  const auditor = viewer('auditor-1', ['reimbursement.read', 'reimbursement.export']);
  const outsideGroup: Array<[string, any]> = [
    ['finance reviewer without the payment right', financeReviewer],
    ['auditor (read only)', auditor],
    ['another related reader', viewer('related-1', ['reimbursement.read_related'])],
    ['holder of the approval right who was never sent this claim', viewer('mgr-2', ['reimbursement.read', 'reimbursement.approve'], { roles: ['MANAGER'] })],
  ];
  const FULL = 'รับเงินคืนทาง: โอนเข้าบัญชี ธนาคารกสิกรไทย ชื่อบัญชี นาย สมชาย ใจดี เลขบัญชี 0045671234';
  const LAST4 = 'รับเงินคืนทาง: โอนเข้าบัญชี ธนาคารกสิกรไทย ชื่อบัญชี นาย สมชาย ใจดี เลขบัญชีลงท้าย 1234';

  it('prints the full number for the requester, the claim approver and a payment recorder, with one audit row each', async () => {
    for (const [group, who] of inGroup) {
      const { print, reveal, audits, events, reads } = world();
      for (const image of imagesOf(await print(who))) {
        assert.equal(count(image, `>${FULL}<`), 1, group);
        assert.equal(count(image, NUMBER), 1, `${group}: on that line and nowhere else`);
        assert.doesNotMatch(image, /ลงท้าย/, group);
      }
      // One row, the kind a reveal writes, saying the channel was the printed form. No number in it.
      assert.deepEqual(audits, [{
        companyId: 'co-1', actorUserId: who.userId, action: 'reimbursement.payout.reveal',
        targetType: 'reimbursement_request', targetId: 'rb-1', requestId: 'req-1', riskLevel: 'HIGH', result: 'SUCCESS',
        metadataJson: { group, channel: 'CLAIM_FORM_PRINT', version: 1, payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountLast4: '1234' },
      }], group);
      assert.ok(!JSON.stringify(audits).includes(NUMBER) && !JSON.stringify(audits).includes(TYPED), group);
      // Written before the key is read to decrypt, as the reveal does, and the secret is read once.
      assert.deepEqual([events, reads.secret], [['audit', 'key'], 1], group);
      // The command answers the same person, and its own row is this one without the channel.
      const command = await reveal(who);
      const { channel: _channel, ...asRevealed } = audits[0].metadataJson;
      assert.deepEqual([command.answered, command.rows], [true, [{ ...audits[0], metadataJson: asRevealed }]], group);
    }
  });

  it('prints the last 4 digits for anyone else who may open the claim: not refused, no audit row, nothing decrypted', async () => {
    for (const [name, who] of outsideGroup) {
      const { print, reveal, audits, events, reads } = world();
      for (const image of imagesOf(await print(who))) {
        assert.equal(count(image, `>${LAST4}<`), 1, name);
        assert.ok(!image.includes(NUMBER), name);
      }
      assert.deepEqual([audits, events, reads.secret], [[], [], 0], name);
      assert.equal((await reveal(who)).answered, false, `${name}: the reveal command refuses the same person`);
    }
    // Someone who may not open the claim is refused the print as before, and leaves no row either.
    const { print, audits } = world();
    await assert.rejects(print(viewer('stranger-1', ['reimbursement.read_related'])), /Cannot read this reimbursement/);
    await assert.rejects(print(viewer('payer-2', ['reimbursement.read', 'reimbursement.payment.record'], { companyId: 'co-2' })), /not found/i);
    assert.deepEqual(audits, []);
  });

  it('gives two readers with different rights each their own print of one claim, and keeps nothing between them', async () => {
    const { print, audits, claim } = world();
    const before = structuredClone(claim);
    const ackHash = claimSignatureAckHash(claim);
    const first = await print(requester);
    const second = await print(auditor);
    const third = await print(requester);

    // Who asks and which claim: the use case takes nothing else, so nothing a caller sends picks the variant.
    assert.equal(PreviewReimbursementClaimFormUseCase.prototype.execute.length, 2);
    assert.ok(imagesOf(first).every((image) => image.includes(NUMBER)));
    assert.ok(imagesOf(second).every((image) => !image.includes(NUMBER)), 'a print for one reader is never handed to another');
    assert.deepEqual(third, first, 'the same reader gets the same print again');
    assert.deepEqual(audits.map((row) => [row.actorUserId, row.metadataJson.channel]), [['staff-1', 'CLAIM_FORM_PRINT'], ['staff-1', 'CLAIM_FORM_PRINT']], 'a row for every full-number print, none for the other');
    // The two variants differ in how the number is shown and in nothing else.
    assert.deepEqual(imagesOf(first).map((image) => image.replace('เลขบัญชี 0045671234', 'เลขบัญชีลงท้าย 1234')), imagesOf(second));
    assert.notEqual(first.checksumSha256, second.checksumSha256);
    // What signers acknowledge is made from the claim's data, which no print changes: one value for both variants.
    assert.deepEqual(claim, before);
    assert.equal(claimSignatureAckHash(claim), ackHash);
  });

  // AC17: serialise the whole answer and look for the number as typed and as stored.
  it('carries the number only inside the rendered image of the full-number print, and never grouped', async () => {
    const { print } = world();
    const full = await print(payer);
    const masked = await print(financeReviewer);
    for (const [name, result] of [['full', full], ['last 4', masked]] as const) {
      assert.deepEqual(Object.keys(result), ['svgDataUrl', 'pageSvgDataUrls', 'checksumSha256'], `${name}: no field was added to the answer`);
      const serialised = JSON.stringify(result);
      assert.ok(!serialised.includes(NUMBER) && !serialised.includes(TYPED), `${name}: not in the serialised answer`);
      // What is not an image is the checksum of one, and nothing else.
      assert.match(result.checksumSha256, /^[0-9a-f]{64}$/, name);
      assert.doesNotMatch(serialised, /accountNumber|fingerprint/i, `${name}: no field is even named after the number`);
      assert.ok(imagesOf(result).every((image) => !image.includes(TYPED) && !/accountNumber|fingerprint/i.test(image)), `${name}: never as typed, never as a field`);
    }
    assert.deepEqual(imagesOf(full).map((image) => count(image, NUMBER)), imagesOf(full).map(() => 1));
    assert.deepEqual(imagesOf(masked).map((image) => count(image, NUMBER)), imagesOf(masked).map(() => 0));
    assert.ok(imagesOf(masked).every((image) => count(image, 'ลงท้าย 1234') === 1));
  });

  it('follows the same rule for a PromptPay number', async () => {
    const { print, audits } = world({}, { account: { payoutKind: 'PROMPTPAY_PHONE', accountName: 'นาย สมชาย ใจดี', accountNumber: '081-000-5678' } });
    assert.match(svgOf(await print(requester)), />รับเงินคืนทาง: พร้อมเพย์เบอร์ 0810005678 ชื่อบัญชี นาย สมชาย ใจดี</);
    assert.match(svgOf(await print(auditor)), />รับเงินคืนทาง: พร้อมเพย์เบอร์ลงท้าย 5678 ชื่อบัญชี นาย สมชาย ใจดี</);
    assert.deepEqual(audits.map((row) => row.metadataJson), [{ group: 'REQUESTER', channel: 'CLAIM_FORM_PRINT', version: 1, payoutKind: 'PROMPTPAY_PHONE', bankName: null, accountLast4: '5678' }]);
  });

  it('answers the approver a pending claim waits on, who has to check the account before approving', async () => {
    const pending = {
      status: 'PENDING_APPROVAL', currentApprovalStepId: 'st-1',
      approvalSteps: [{ id: 'st-1', sequenceNo: 1, approverRoleSnapshot: 'MANAGER', assignedApproverUserIds: ['mgr-1'], status: 'PENDING', assignedAt: sentAt }],
    };
    const { print, audits } = world(pending, { attested: false });
    const svg = svgOf(await print(approver));
    assert.equal(count(svg, `>${FULL}<`), 1);
    assert.doesNotMatch(svg, /ผู้ตรวจบัญชี/, 'nobody has attested the account yet');
    assert.equal((svg.match(/\(\s+\.{20}\s+\)/g) ?? []).length, 1, 'and the approver block is still blank');
    assert.deepEqual(audits.map((row) => row.metadataJson.group), ['APPROVER']);
    // Someone else with the approval right, whom this step does not wait on, gets the last 4 digits.
    const other = world(pending, { attested: false });
    assert.equal(count(svgOf(await other.print(viewer('mgr-2', ['reimbursement.read', 'reimbursement.approve'], { roles: ['SALES'] }))), `>${LAST4}<`), 1);
    assert.deepEqual(other.audits, []);
  });

  it('names whoever attested this account version, in the one name lookup', async () => {
    const attested = world();
    assert.match(svgOf(await attested.print(auditor)), />ผู้ตรวจบัญชี มานี ผู้จัดการ วันที่ 21 ก\.ค\. 2569</);
    assert.equal(attested.calls.nameLookups.length, 1);
    // The payer checked it because nobody but the requester had (spec §10.2): the row names the payer.
    const byPayer = world();
    Object.assign(byPayer.tables.destinations[0]!, { verifiedByUserId: 'fin-1', verifiedAt: new Date('2026-07-23T00:00:00.000Z'), verifiedVia: 'PAYMENT', approvalStepId: null });
    assert.match(svgOf(await byPayer.print(auditor)), />ผู้ตรวจบัญชี สุดา การเงิน วันที่ 23 ก\.ค\. 2569</);
    assert.doesNotMatch(svgOf(await world({}, { attested: false }).print(auditor)), /ผู้ตรวจบัญชี/);
  });

  // Spec §10.2: the requester approved their own claim, so the attestation on the account is their own.
  // The paper must not read as if someone else checked it: it prints the claim page's sentence.
  it('says the requester confirmed their own account when the attestation is theirs, to every reader', async () => {
    const ownApproval = { approvalSteps: [{ id: 'st-1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'staff-1', decidedAt, assignedAt: sentAt }] };
    for (const who of [requester, payer, auditor]) {
      const own = world(ownApproval);
      Object.assign(own.tables.destinations[0]!, { verifiedByUserId: 'staff-1' });
      for (const image of imagesOf(await own.print(who))) {
        assert.equal(count(image, '>ผู้เบิกยืนยันบัญชีของตนเอง วันที่ 21 ก.ค. 2569<'), 1, who.userId);
        assert.doesNotMatch(image, /ผู้ตรวจบัญชี/, who.userId);
      }
    }
    // The same account attested by anyone else is a check by that person, named as before.
    assert.match(svgOf(await world(ownApproval).print(auditor)), />ผู้ตรวจบัญชี มานี ผู้จัดการ วันที่ 21 ก\.ค\. 2569</);
  });

  it('prints the claim own frozen account, never the default account the requester has now', async () => {
    const { print, tables, repo } = world();
    // The requester changed their default after sending the claim.
    const now = sealPayoutDestination({ payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารไทยพาณิชย์', accountName: 'สมชาย บัญชีใหม่', accountNumber: '4090001112' }, key)!;
    tables.accounts.push({ id: 'account-1', companyId: 'co-1', userId: 'staff-1', payoutMethod: 'BANK_TRANSFER', ...now, version: 4, updatedByUserId: 'staff-1', updatedAt: decidedAt });
    assert.deepEqual([typeof repo.findMemberPayoutAccount, typeof repo.findMemberPayoutSecret], ['undefined', 'undefined'], 'the print has no reader of a default account');
    for (const who of [requester, payer, auditor]) {
      for (const image of imagesOf(await print(who))) {
        assert.match(image, /โอนเข้าบัญชี ธนาคารกสิกรไทย ชื่อบัญชี นาย สมชาย ใจดี/);
        assert.doesNotMatch(image, /ไทยพาณิชย์|บัญชีใหม่|4090001112|1112/);
      }
    }
  });

  describe('the payment line', () => {
    const paidAt = new Date('2026-07-23T00:00:00.000Z');
    const transfer = { id: 'pay-1', status: 'RECORDED', paidByUserId: 'fin-1', paidAt, paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-9', payoutDestinationVersion: 1, payoutConfirmedAt: paidAt };
    const paid = (payment: Record<string, unknown>) => ({ status: 'PAID', paymentStatus: 'PAID', payments: [{ id: 'pay-void', status: 'VOIDED', paidByUserId: 'ghost-1', paidAt: new Date('2026-07-24T00:00:00.000Z'), payoutDestinationVersion: 1 }, payment] });

    it('says which account a confirmed transfer went into with the last 4 digits, for every reader', async () => {
      for (const who of [requester, approver, payer, financeReviewer, auditor]) {
        const { print, reads } = world(paid(transfer), { slips: { 'pay-1': [{ attachmentId: 'att-slip', attachedAt: paidAt }] } });
        for (const image of imagesOf(await print(who))) {
          assert.match(image, /การจ่ายเงินคืน: จ่ายเมื่อ 23 ก\.ค\. 2569 วิธี โอนเงิน เข้าบัญชีลงท้าย 1234 เลขอ้างอิง TXN-9 บันทึกโดย สุดา การเงิน/, who.userId);
          assert.doesNotMatch(image.slice(image.indexOf('การจ่ายเงินคืน:')), new RegExp(NUMBER), 'the full number is never on the payment line');
          assert.equal(count(image, '<path d="M'), 2, 'the receipt and, for the slip, หลักฐานการชำระเงิน');
        }
        // Asked of the payment the form prints and of the version that payment stored, never of the voided one.
        assert.deepEqual(reads.paidInto, [[1]]);
      }
    });

    it('reads the version the payment stored, also when the claim has since moved to another account', async () => {
      const moved = sealPayoutDestination({ payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกรุงเทพ', accountName: 'นาย สมชาย ใจดี', accountNumber: '9998885555' }, key)!;
      const { print, tables } = world({ ...paid(transfer), payoutDestinationVersion: 2, payoutFingerprint: moved.fingerprint });
      tables.destinations.push({ id: 'destination-2', companyId: 'co-1', reimbursementRequestId: 'rb-1', version: 2, ...moved, source: 'REQUESTER', createdByUserId: 'staff-1', frozenAt: paidAt });
      const svg = svgOf(await print(auditor));
      assert.match(svg, />รับเงินคืนทาง: โอนเข้าบัญชี ธนาคารกรุงเทพ ชื่อบัญชี นาย สมชาย ใจดี เลขบัญชีลงท้าย 5555</);
      assert.match(svg, /วิธี โอนเงิน เข้าบัญชีลงท้าย 1234 เลขอ้างอิง TXN-9/);
    });

    it('says nothing of an account when none was confirmed: another method, or no payment yet', async () => {
      const cashPaid = world(paid({ ...transfer, paymentMethod: 'CASH', paymentReference: undefined, payoutDestinationVersion: undefined, payoutConfirmedAt: undefined, methodMismatchReason: 'ผู้เบิกขอรับเป็นเงินสดแทน' }));
      const svg = svgOf(await cashPaid.print(auditor));
      assert.match(svg, /การจ่ายเงินคืน: จ่ายเมื่อ 23 ก\.ค\. 2569 วิธี เงินสด เลขอ้างอิง - บันทึกโดย สุดา การเงิน/);
      assert.doesNotMatch(svg, /ผู้เบิกขอรับเป็นเงินสดแทน/, 'the payer reason is not a fact of the form');
      assert.deepEqual(cashPaid.reads.paidInto, []);
      assert.equal(count(svg, '<path d="M'), 1, 'no slip: the payment evidence box stays empty');

      const unpaid = world();
      assert.match(svgOf(await unpaid.print(auditor)), /การจ่ายเงินคืน: ยังไม่จ่าย/);
      assert.deepEqual(unpaid.reads.paidInto, []);
    });
  });

  describe('claims that have no account to print', () => {
    it('prints รับเป็นเงินสด for a cash claim, to everyone alike, and never decrypts or writes a row', async () => {
      for (const who of [requester, approver, payer, auditor]) {
        const { print, audits, events, reads, tables } = world({ payoutMethod: 'CASH', payoutDestinationVersion: undefined, payoutFingerprint: 'cash' });
        tables.destinations.splice(0);
        for (const image of imagesOf(await print(who))) {
          assert.equal(count(image, '>รับเงินคืนทาง: รับเป็นเงินสด<'), 1);
          assert.doesNotMatch(image, /ผู้ตรวจบัญชี|เลขบัญชี|ลงท้าย/);
        }
        assert.deepEqual([audits, events, reads.secret], [[], [], 0], who.userId);
      }
    });

    // Spec §15. The reveal command answers a legacy claim's payer with the requester's default account
    // as it is now; the printed form never does.
    it('prints a legacy claim as it always did, also for its payer and also when its payment kept a copy of the default', async () => {
      const paidAt = new Date('2026-07-23T00:00:00.000Z');
      const legacy = { payoutMethod: undefined, payoutDestinationVersion: undefined, payoutFingerprint: undefined };
      for (const state of [
        { status: 'READY_FOR_PAYMENT' },
        { status: 'PAID', paymentStatus: 'PAID', payments: [{ id: 'pay-1', status: 'RECORDED', paidByUserId: 'fin-1', paidAt, paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-9', payoutDestinationVersion: 1, payoutConfirmedAt: paidAt }] },
      ]) {
        for (const who of [requester, approver, payer]) {
          const w = world({ ...legacy, ...state });
          // The claim's own table holds only the copy a payment of the default made (§15), and the requester has a default.
          Object.assign(w.tables.destinations[0]!, { source: 'LEGACY_PAYMENT', verifiedByUserId: 'fin-1', verifiedVia: 'PAYMENT' });
          w.tables.accounts.push({ id: 'account-1', companyId: 'co-1', userId: 'staff-1', payoutMethod: 'BANK_TRANSFER', ...w.sealed, version: 4, updatedByUserId: 'staff-1', updatedAt: decidedAt });
          const defaultReads: string[] = [];
          Object.assign(w.repo, {
            findMemberPayoutAccount: (companyId: string, userId: string) => { defaultReads.push('account'); return readMemberPayoutAccount(w.tables.client, companyId, userId); },
            findMemberPayoutSecret: (companyId: string, userId: string) => { defaultReads.push('secret'); return readMemberPayoutSecret(w.tables.client, companyId, userId); },
          });
          const result = await w.print(who);
          for (const image of imagesOf(result)) {
            assert.doesNotMatch(image, /รับเงินคืนทาง|ผู้ตรวจบัญชี|ลงท้าย|กสิกรไทย/, who.userId);
            assert.ok(!image.includes(NUMBER), who.userId);
          }
          assert.deepEqual([w.audits, w.events, w.reads, defaultReads], [[], [], { payout: 0, secret: 0, paidInto: [] }, []], who.userId);
          // Exactly the bytes the same claim prints when nothing about payouts exists around it.
          const plain = await previewUseCase(fakeRepo(w.claim).repo).execute(who, 'rb-1');
          assert.deepEqual(result, plain, who.userId);
          // The command would have answered this claim's payer while it can still be paid: the print does not.
          if (who === payer && state.status === 'READY_FOR_PAYMENT') {
            assert.equal((await w.reveal(who)).answered, true);
            assert.deepEqual(defaultReads, ['account', 'secret']);
          }
        }
      }
    });

    // Payout spec §14, §17.1 (AC32): a claim sent back from the pay step prints no account and no approver until it is
    // approved again, whoever asks and in either phase. The line says what the claim waits for, in the words of the
    // claim page's badge: before, it read "อยู่ระหว่างแก้ไขบัญชีรับเงิน" of a claim with no account and of a cash claim too.
    it('prints what a claim in a round waits for on the รับเงินคืนทาง line and leaves the approver block blank, with no number, row or decrypt', async () => {
      const sentBackAt = new Date('2026-07-25T00:00:00.000Z');
      const givenAt = new Date('2026-07-26T00:00:00.000Z');
      const setAside = { id: 'st-1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'mgr-1', decidedAt, assignedAt: sentAt, invalidatedAt: sentBackAt, invalidatedReason: 'payout_account_correction' };
      const round = { status: 'PENDING_APPROVAL', paymentStatus: 'NOT_PAYABLE', payoutCorrectionRequestedAt: sentBackAt, payoutCorrectionReasonCode: 'ACCOUNT_NUMBER_WRONG' };
      // Phase A: no step is open, and the claim still points at what it was sent back with.
      const withRequester = { ...round, currentApprovalStepId: undefined, approvalSteps: [setAside] };
      // Phase B: the requester answered and a new step waits for mgr-1. The round's log says how it began and what was given.
      const withApprover = (answer: Record<string, unknown>, approved: Record<string, unknown> = { payoutMethod: 'BANK_TRANSFER', payoutVersion: 1 }) => ({
        ...round, payoutCorrectionSubmittedAt: givenAt, currentApprovalStepId: 'st-2', payoutDestinationVersion: 2,
        approvalSteps: [setAside, { id: 'st-2', sequenceNo: 1, status: 'PENDING', assignedApproverUserIds: ['mgr-1'], assignedAt: givenAt }],
        payoutCorrectionLog: [
          { kind: 'SENT_BACK', at: sentBackAt.toISOString(), byUserId: 'fin-1', reasonCode: 'ACCOUNT_NUMBER_WRONG', approved },
          { kind: 'ACCOUNT_SUBMITTED', at: givenAt.toISOString(), byUserId: 'staff-1', ...answer },
        ],
      });
      const asCash = { payoutMethod: 'CASH', payoutFingerprint: 'cash', payoutDestinationVersion: undefined };
      const phases: Array<[string, Record<string, unknown>, string]> = [
        ['with its requester, holding an account', withRequester, 'รอผู้เบิกแก้บัญชีรับเงิน'],
        ['with its requester, holding cash', { ...withRequester, ...asCash }, 'รอผู้เบิกเลือกวิธีรับเงินคืน'],
        ['with its requester, holding nothing', { ...withRequester, payoutMethod: undefined, payoutFingerprint: undefined, payoutDestinationVersion: undefined }, 'รอผู้เบิกเพิ่มบัญชีรับเงิน'],
        ['another account waits for approval', withApprover({ payoutMethod: 'BANK_TRANSFER', payoutVersion: 2 }), 'รออนุมัติบัญชีรับเงินใหม่'],
        ['the same account waits for approval', withApprover({ payoutMethod: 'BANK_TRANSFER', payoutVersion: 2, sameAsApproved: true }), 'รออนุมัติบัญชีรับเงินเดิม'],
        ['cash in place of the account waits for approval', { ...withApprover({ payoutMethod: 'CASH' }), ...asCash }, 'รออนุมัติการรับเป็นเงินสด'],
        ['a first account waits for approval', withApprover({ payoutMethod: 'BANK_TRANSFER', payoutVersion: 2 }, {}), 'รออนุมัติบัญชีรับเงิน'],
        // A round with no record of how it began: words that are true of every answer.
        ['an answer waits for approval, with no record of the round', { ...withApprover({}), payoutCorrectionLog: undefined }, 'รออนุมัติวิธีรับเงินคืน'],
      ];
      for (const [phase, state, waitsFor] of phases) {
        for (const [who, viewer] of [...inGroup, ...outsideGroup]) {
          const { print, audits, events, reads, tables, sealed } = world(state);
          tables.destinations.push({ ...tables.destinations[0], id: 'destination-2', version: 2, frozenAt: givenAt, verifiedByUserId: null, verifiedAt: null, verifiedVia: null, approvalStepId: null, fingerprint: sealed.fingerprint });
          const result = await print(viewer);
          for (const image of imagesOf(result)) {
            assert.equal(count(image, `>รับเงินคืนทาง: ${waitsFor}<`), 1, `${phase}, ${who}`);
            assert.equal(count(image, 'รับเงินคืนทาง'), 1, `${phase}, ${who}`);
            assert.doesNotMatch(image, /ผู้ตรวจบัญชี|ชื่อบัญชี|เลขบัญชี|ลงท้าย|กสิกรไทย|มานี ผู้จัดการ|อยู่ระหว่างแก้ไข/, `${phase}, ${who}`);
            assert.ok(!image.includes(NUMBER), `${phase}, ${who}`);
          }
          // Two ruled signing lines, and only the requester's carries a name.
          assert.equal(count(svgOf(result), '( สมชาย ใจดี )'), 1, `${phase}, ${who}`);
          assert.deepEqual([audits, events, reads.secret, reads.payout], [[], [], 0, 0], `${phase}, ${who}: nothing asked of the payout tables`);
        }
      }
    });

    it('reprints the four-block form without the account, a row or a decrypt, even for a claim that carries one', async () => {
      const signedByPayer = { claimSignatures: [signatureRow('REQUESTER', 'staff-1'), signatureRow('PAYER', 'fin-1')] };
      const { print, audits, events, reads, claim } = world(signedByPayer);
      const result = await print(requester);
      assert.equal((svgOf(result).match(/<line x1="\d+" y1="\d+" x2="\d+" y2="\d+" stroke="#222"/g) ?? []).length, 4);
      assert.ok(imagesOf(result).every((image) => !/รับเงินคืนทาง|ลงท้าย/.test(image) && !image.includes(NUMBER)));
      assert.deepEqual([audits, events, reads], [[], [], { payout: 0, secret: 0, paidInto: [] }]);
      const withoutPayout = { ...claim, payoutMethod: undefined, payoutDestinationVersion: undefined, payoutFingerprint: undefined };
      assert.deepEqual(result, await previewUseCase(fakeRepo(withoutPayout).repo).execute(requester, 'rb-1'));
    });
  });

  // The print lane's finding (reimbursement-payout-p4-print.md, "Noticed"): the block took the latest
  // APPROVED step of any round. A claim approved, returned to its requester by finance, corrected and
  // sent again printed the earlier approver in the ผู้อนุมัติ block while it waited for the new round,
  // and gave them the full-number print's place to sign. The block now asks the one rule for a
  // claim's approver (`isReimbursementClaimApprover`, through `claimApprovalStep`).
  it('names in the ผู้อนุมัติ block only whoever approved the round the claim was last sent in', async () => {
    const sentAgainAt = new Date('2026-07-25T00:00:00.000Z');
    const earlierRound = { id: 'st-1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'mgr-1', decidedAt, assignedAt: sentAt };
    const waitingAgain = {
      status: 'PENDING_APPROVAL', submittedAt: sentAgainAt, currentApprovalStepId: 'st-2',
      approvalSteps: [earlierRound, { id: 'st-2', sequenceNo: 1, status: 'PENDING', assignedApproverUserIds: ['mgr-2'], assignedAt: sentAgainAt }],
    };
    const { print } = world(waitingAgain, { attested: false });
    for (const image of imagesOf(await print(requester))) assert.doesNotMatch(image, /มานี ผู้จัดการ/, 'nobody has approved this round');
    // Approved again in the new round: that approval is the one printed.
    const approvedAgain = world({
      submittedAt: sentAgainAt,
      approvalSteps: [earlierRound, { id: 'st-2', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'acct-1', decidedAt: new Date('2026-07-26T00:00:00.000Z'), assignedAt: sentAgainAt }],
    }, { attested: false });
    const image = svgOf(await approvedAgain.print(requester));
    assert.match(image, /\( ปรีชา บัญชี \)/);
    assert.doesNotMatch(image, /มานี ผู้จัดการ/);
  });

  it('prints nothing when the audit row cannot be written, and reads no key', async () => {
    const { repo, events } = world();
    const config = { get credentialEncryptionKey() { events.push('key'); return key; } } as any;
    const failing = { log: async () => undefined, logOrThrow: async () => { throw new Error('audit store down'); } } as any;
    await assert.rejects(new PreviewReimbursementClaimFormUseCase(repo, fakeStorage(), failing, config).execute(requester, 'rb-1'), /audit store down/);
    assert.deepEqual(events, []);
    // Someone outside the group needs no row, so the same outage does not stop their print.
    const masked = await new PreviewReimbursementClaimFormUseCase(repo, fakeStorage(), failing, config).execute(auditor, 'rb-1');
    assert.equal(count(svgOf(masked), `>${LAST4}<`), 1);
  });

  it('refuses a draft that kept its document number, whoever asks, and writes no row', async () => {
    // Taken back to a draft after it was sent: the number stays with the claim, the frozen marker does not.
    const reopened = { status: 'DRAFT', submittedAt: undefined, payoutFingerprint: undefined, approvalSteps: [] };
    for (const who of [requester, payer]) {
      const { print, audits, events, reads } = world(reopened);
      await assert.rejects(print(who), /claim_form_requires_submitted/);
      assert.deepEqual([audits, events, reads], [[], [], { payout: 0, secret: 0, paidInto: [] }]);
    }
  });

  it('signed export preserves audited account reveal and signature failure ordering', async () => {
    const w = world({ claimSignatures: [signatureRow('REQUESTER', 'staff-1'), signatureRow('APPROVER', 'mgr-1')] });
    w.claim.lines.forEach((line: any, index: number) => line.linkedExpenseId = `original-${index}`);
    w.repo.listSignedClaimFormCopies = async () => [];
    const trail = { logOrThrow: async (entry: any) => { w.events.push('audit'); w.audits.push(entry); } } as any;
    const config = { get credentialEncryptionKey() { w.events.push('key'); return key; } } as any;
    const exporter = new PreviewReimbursementClaimFormUseCase(w.repo, fakeStorage(VALID_PNG_BYTES), trail, config);
    const result = await exporter.executeSignedForExport(requester, 'rb-1', ['e0', 'e1']);
    assert.ok('data' in result && result.data);
    assert.deepEqual(w.events, ['audit', 'key']);
    assert.equal(w.audits[0].metadataJson.channel, 'CLAIM_FORM_PRINT');
    await exporter.executeSignedForExport(auditor, 'rb-1', ['e0', 'e1']);
    assert.equal(w.audits.length, 1);
    w.events.length = 0;
    await assert.rejects(() => new PreviewReimbursementClaimFormUseCase(w.repo, fakeStorage(Buffer.from('broken signature')), trail, config).executeSignedForExport(requester, 'rb-1', ['e0', 'e1']));
    assert.deepEqual(w.events, []);
    await assert.rejects(() => new PreviewReimbursementClaimFormUseCase(w.repo, fakeStorage(PNG_BYTES), trail, config).executeSignedForExport(requester, 'rb-1', ['e0', 'e1']));
    assert.deepEqual(w.events, []);
  });

  it('writes no row for a print that fails before it is rendered', async () => {
    // A stored signature that cannot be read fails the print (422) for everyone, the requester included.
    const { repo, audits, events } = world({ claimSignatures: [signatureRow('REQUESTER', 'staff-1')] });
    const audit = { log: async (entry: any) => { audits.push(entry); }, logOrThrow: async (entry: any) => { audits.push(entry); } } as any;
    const config = { get credentialEncryptionKey() { events.push('key'); return key; } } as any;
    const error: any = await new PreviewReimbursementClaimFormUseCase(repo, fakeStorage(Buffer.from('%PDF-1.7 not a png')), audit, config)
      .execute(requester, 'rb-1').then(() => null, (e: unknown) => e);
    assert.equal(error.getStatus(), 422);
    assert.deepEqual([audits, events], [[], []]);
  });
});

describe('signed accountant claim export', () => {
  it('signed export reuses claim completeness scope and account reveal rules', async () => {
    const row = request(); row.lines.forEach((line: any, index: number) => line.linkedExpenseId = `original-${index}`);
    const { repo } = fakeRepo(row);
    repo.listSignedClaimFormCopies = async () => [];
    const useCase = previewUseCase(repo, fakeStorage(VALID_PNG_BYTES));
    assert.equal((await (useCase as any).executeSignedForExport(ctx(), row.id, ['e0', 'e1'])).problem.key, 'CLAIM_UNSIGNED');
    await assert.rejects(() => (useCase as any).executeSignedForExport(ctx({ scopes: { branchIds: ['other'] } }), row.id, ['e0', 'e1']));
    repo.listSignedClaimFormCopies = async () => [
      { attachmentId: 'old', acknowledged: false, uploadedAt: new Date('2026-11-02') },
      { attachmentId: 'current', acknowledged: true, uploadedAt: new Date('2026-11-01') },
    ];
    row.claimSignatures = [signatureRow('REQUESTER', 'staff-1')];
    const paper = await (useCase as any).executeSignedForExport(ctx(), row.id, ['e0', 'e1']);
    assert.equal(paper.attachmentId, 'current');
    assert.equal((await (useCase as any).executeSignedForExport(ctx(), row.id, ['e0'])).problem.message, 'ใบเบิกรวมรายการนอกชุดที่เลือก จึงไม่ได้รวมใบนี้');
    repo.listSignedClaimFormCopies = async () => [];
    row.approvalPolicySnapshotJson = { schemaVersion: 1, policyId: 'p', policyVersion: '1', approvalRequiredFromAmount: '1000.00', requiresApproval: false, route: null, allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: false, duplicatePolicy: 'WARN', financeReviewRequired: false };
    const digital = await (useCase as any).executeSignedForExport(ctx(), row.id, ['e0', 'e1']);
    assert.equal(digital.mimeType, 'application/pdf');
    assert.ok(digital.data.subarray(0, 4).equals(Buffer.from('%PDF')));
  });
});

it('signed export respects paper declarations and every existing digital layout', async () => {
  const row = request(); row.lines.forEach((line: any, index: number) => line.linkedExpenseId = `original-${index}`);
  const { repo } = fakeRepo(row);
  repo.listSignedClaimFormCopies = async () => [];
  const useCase = previewUseCase(repo);
  for (const [roles, finance, complete] of [
    [['REQUESTER'], 'NOT_REQUIRED', false],
    [['REQUESTER', 'APPROVER'], 'NOT_REQUIRED', true],
    [['REQUESTER', 'APPROVER', 'PAYER'], 'APPROVED_FOR_PAYMENT', false],
    [['REQUESTER', 'APPROVER', 'PAYER', 'FINANCE_REVIEW'], 'APPROVED_FOR_PAYMENT', true],
    [['REQUESTER', 'APPROVER', 'PAYER'], 'NOT_REQUIRED', true],
  ] as const) {
    row.claimSignatures = roles.map(role => signatureRow(role, 'staff-1')); row.financeReviewStatus = finance;
    const result = await useCase.executeSignedForExport(ctx(), row.id, ['e0', 'e1'], { render: false });
    assert.equal(!result.problem, complete, roles.join(','));
  }
  repo.listSignedClaimFormCopies = async () => [
    { attachmentId: 'b', acknowledged: true, uploadedAt: new Date('2026-11-01') },
    { attachmentId: 'a', acknowledged: true, uploadedAt: new Date('2026-11-01') },
    { attachmentId: 'superseded', acknowledged: true, beforePayoutCorrection: true, uploadedAt: new Date('2026-11-02') },
  ];
  const paper = await useCase.executeSignedForExport(ctx(), row.id, ['e0', 'e1']);
  assert.ok('attachmentId' in paper);
  assert.equal(paper.attachmentId, 'a');
  assert.equal((await useCase.executeSignedForExport(ctx(), row.id, ['e0', 'e1'], { sourceLineIds: new Map([['e0', 'wrong'], ['e1', 'l-1']]) })).problem?.key, 'CLAIM_UNAVAILABLE');
});
