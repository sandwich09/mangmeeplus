import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
      { id: 'pay-1', status: 'RECORDED', paidByUserId: 'fin-1', paidAt: new Date('2026-07-23T00:00:00.000Z') },
    ],
    ...overrides,
  } as any;
}

/** Smallest bytes that pass the PNG magic-byte check. */
const PNG_BYTES = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('signature')]);

function fakeRepo(row: any | null) {
  const calls = { nameLookups: [] as string[][], signatureLookups: [] as any[] };
  const repo = {
    findRequestById: async (_companyId: string, _id: string, _withRelations?: boolean) => row,
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
    assert.match(svg, /\( ปรีชา บัญชี \)/);
    assert.match(svg, /\( สุดา การเงิน \)/);
    // Lines print in lineNo order, not repository order.
    assert.ok(svg.indexOf('ค่าแท็กซี่') < svg.indexOf('ค่าอาหาร'));
    // One line carries a receipt → the ใบเสร็จรับเงิน box is ticked.
    assert.equal((svg.match(/<path d="M/g) ?? []).length, 1);
    // The voided payment never signs; the recorded one does.
    assert.doesNotMatch(svg, /ghost-1/);

    assert.equal(calls.nameLookups.length, 1, 'names resolve in a single batch query');
    assert.deepEqual(calls.nameLookups[0], ['mgr-1', 'acct-1', 'fin-1']);
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

  it('leaves the approver/accounting/finance blocks blank until those steps happen', async () => {
    const { repo, calls } = fakeRepo(request({
      status: 'PENDING_APPROVAL',
      financeReviewStatus: 'PENDING', financeReviewedByUserId: undefined, financeReviewedAt: undefined,
      approvalSteps: [{ id: 'st-1', sequenceNo: 1, status: 'PENDING' }],
      payments: [],
      lines: [{ id: 'l-1', lineNo: 1, incurredDate: new Date('2026-07-15T00:00:00.000Z'), description: 'ค่าแท็กซี่', categoryKey: 'travel', amount: '300.0000' }],
    }));
    const svg = svgOf(await previewUseCase(repo).execute(ctx(), 'rb-1'));

    assert.match(svg, /\( สมชาย ใจดี \)/);
    assert.equal((svg.match(/\(\s+\.{20}\s+\)/g) ?? []).length, 3);
    // No evidence on any line → the receipt box stays unticked.
    assert.equal((svg.match(/<path d="M/g) ?? []).length, 0);
    assert.deepEqual(calls.nameLookups[0], []);
  });

  it('does not print an accounting signature for a blocked finance review', async () => {
    const { repo } = fakeRepo(request({ financeReviewStatus: 'BLOCKED', payments: [] }));
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
    assert.equal((svg.match(/\(\s+\.{20}\s+\)/g) ?? []).length, 3);
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
    // Block 0 (ผู้เบิก) starts at x=45, block 1 (ผู้อนุมัติ) at x=235; image x = block + 55.
    assert.match(svg, /<image href="data:image\/png;base64,[^"]+" x="100"/);
    assert.match(svg, /<image href="data:image\/png;base64,[^"]+" x="290"/);
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
