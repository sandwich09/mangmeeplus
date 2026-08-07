import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CompleteClaimSignatureUploadUseCase,
  InitClaimSignatureUploadUseCase,
  LinkSignedClaimFormCopyUseCase,
  SignClaimFormUseCase,
  eligibleClaimSignatureRoles,
} from './reimbursement-claim-signature.use-case';
import { claimSignatureAckHash } from './reimbursement-request.use-case';

// Lane F. The business rule under test is WHO may sign WHICH role: eligibility is
// the real actor of that step, never a permission a role happens to hold.

const PNG_BYTES = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('signature')]);

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'http-1', authSubject: 's', userId: 'staff-1', companyId: 'co-1',
    membershipId: 'm', roles: ['STAFF'], permissions: ['reimbursement.read_own'],
    scopes: {}, authProvider: 'dev', ...overrides,
  } as any;
}

function request(overrides: Partial<any> = {}) {
  return {
    id: 'rb-1', companyId: 'co-1', branchId: 'br-1', requestNo: 'RB-202607-00001',
    requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'สมชาย ใจดี',
    reason: 'ค่าเดินทาง', categoryKey: 'travel', amount: '300.0000', currency: 'THB',
    incurredDate: new Date('2026-07-15T00:00:00.000Z'), submittedAt: new Date('2026-07-20T00:00:00.000Z'),
    status: 'PAID', financeReviewStatus: 'APPROVED_FOR_PAYMENT',
    financeReviewedByUserId: 'acct-1', financeReviewedAt: new Date('2026-07-22T00:00:00.000Z'),
    paymentStatus: 'PAID', duplicateStatus: 'NO_MATCH', receiptRequirementStatus: 'ATTACHED',
    postingStatus: 'not_required', paymentTotalAmount: '300.0000', outstandingAmount: '0.0000',
    createdByUserId: 'staff-1', createdAt: new Date('2026-07-19T00:00:00.000Z'), updatedAt: new Date('2026-07-23T00:00:00.000Z'),
    lines: [{ id: 'l-1', lineNo: 1, incurredDate: new Date('2026-07-15T00:00:00.000Z'), description: 'ค่าแท็กซี่', categoryKey: 'travel', amount: '300.0000', attachmentId: 'att-1' }],
    approvalSteps: [{ id: 'st-1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'mgr-1', decidedAt: new Date('2026-07-21T00:00:00.000Z') }],
    payments: [
      { id: 'pay-void', status: 'VOIDED', paidByUserId: 'ghost-1', paidAt: new Date('2026-07-24T00:00:00.000Z') },
      { id: 'pay-1', status: 'RECORDED', paidByUserId: 'fin-1', paidAt: new Date('2026-07-23T00:00:00.000Z') },
    ],
    ...overrides,
  } as any;
}

function fakeRepo(row: any | null, options: { signatureAttachment?: any; uploadAttachment?: any; signedCopies?: any[] } = {}) {
  const calls = { upserts: [] as any[], links: [] as any[], signatureLookups: [] as any[] };
  const repo = {
    findRequestById: async (_companyId: string, _id: string, _withRelations?: boolean) => row,
    findClaimSignatureAttachment: async (companyId: string, attachmentId: string, userId: string, requestId: string, role: string) => {
      calls.signatureLookups.push({ companyId, attachmentId, userId, requestId, role });
      return options.signatureAttachment === undefined
        ? { id: attachmentId, bucket: 'b', objectKey: 'k', mimeType: 'image/png', byteSize: PNG_BYTES.length, checksumSha256: null }
        : options.signatureAttachment;
    },
    findClaimSignatureUploadAttachment: async () => (options.uploadAttachment === undefined
      ? { id: 'att-sig', status: 'PENDING_UPLOAD', mimeType: 'image/png' }
      : options.uploadAttachment),
    upsertClaimSignature: async (data: any) => {
      calls.upserts.push(data);
      return { ...data, id: `sig-${calls.upserts.length}`, createdAt: data.signedAt, updatedAt: data.signedAt };
    },
    listSignedClaimFormCopies: async () => (options.signedCopies ?? []),
    linkSignedClaimFormCopy: async (companyId: string, requestId: string, attachmentId: string, userId: string) => {
      calls.links.push({ companyId, requestId, attachmentId, userId });
    },
  } as any;
  return { repo, calls };
}

const storage = { getObject: async () => ({ bytes: PNG_BYTES, mimeType: 'image/png' }) } as any;
const noopAudit = { log: async () => undefined } as any;

function signUseCase(repo: any) {
  return new SignClaimFormUseCase(repo, storage, noopAudit);
}

describe('eligibleClaimSignatureRoles', () => {
  it('maps every role to the actor that really performed the step', () => {
    const req = request();
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'staff-1'), ['REQUESTER']);
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'mgr-1'), ['APPROVER']);
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'acct-1'), ['FINANCE_REVIEW']);
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'fin-1'), ['PAYER']);
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'stranger-1'), [], 'a bystander signs nothing');
    // The voided payment's payer is not the payer of record.
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'ghost-1'), []);
  });

  it('gives a one-person company every role it actually performed', () => {
    const req = request({
      requesterUserId: 'owner-1',
      approvalSteps: [{ id: 'st-1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'owner-1', decidedAt: new Date('2026-07-21T00:00:00.000Z') }],
      financeReviewedByUserId: 'owner-1',
      payments: [{ id: 'pay-1', status: 'RECORDED', paidByUserId: 'owner-1', paidAt: new Date('2026-07-23T00:00:00.000Z') }],
    });
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'owner-1'), ['REQUESTER', 'APPROVER', 'FINANCE_REVIEW', 'PAYER']);
  });

  it('has no eligible signer for a step that has not happened', () => {
    const pending = request({
      status: 'PENDING_APPROVAL',
      approvalSteps: [{ id: 'st-1', sequenceNo: 1, status: 'PENDING' }],
      financeReviewStatus: 'PENDING', financeReviewedByUserId: undefined, financeReviewedAt: undefined,
      payments: [],
    });
    assert.deepEqual(eligibleClaimSignatureRoles(pending, 'mgr-1'), []);
    assert.deepEqual(eligibleClaimSignatureRoles(pending, 'acct-1'), []);
    assert.deepEqual(eligibleClaimSignatureRoles(pending, 'staff-1'), ['REQUESTER']);
  });

  it('does not treat a rejection or a blocked review as a signature-worthy decision', () => {
    const rejected = request({
      approvalSteps: [{ id: 'st-1', sequenceNo: 1, status: 'REJECTED', decisionByUserId: 'mgr-1', decidedAt: new Date('2026-07-21T00:00:00.000Z') }],
      financeReviewStatus: 'BLOCKED',
    });
    assert.deepEqual(eligibleClaimSignatureRoles(rejected, 'mgr-1'), []);
    assert.deepEqual(eligibleClaimSignatureRoles(rejected, 'acct-1'), []);
  });

  it('cannot sign a draft: there is no document yet', () => {
    const draft = request({ status: 'DRAFT', requestNo: undefined, submittedAt: undefined });
    assert.deepEqual(eligibleClaimSignatureRoles(draft, 'staff-1'), []);
  });
});

describe('SignClaimFormUseCase', () => {
  it('stores the signature for the eligible actor after the ack hash matches', async () => {
    const req = request();
    const { repo, calls } = fakeRepo(req);
    const result = await signUseCase(repo).execute(ctx(), 'rb-1', {
      role: 'REQUESTER', signatureAttachmentId: 'att-sig', snapshotHash: claimSignatureAckHash(req),
    });

    assert.equal(result.role, 'REQUESTER');
    assert.equal(result.signedByUserId, 'staff-1');
    assert.match(result.signedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(calls.upserts.length, 1);
    assert.equal(calls.upserts[0].reimbursementRequestId, 'rb-1');
    assert.equal(calls.upserts[0].signatureAttachmentId, 'att-sig');
    // The image is only ever loaded as the signer's own file for this claim+role.
    assert.deepEqual(calls.signatureLookups, [
      { companyId: 'co-1', attachmentId: 'att-sig', userId: 'staff-1', requestId: 'rb-1', role: 'REQUESTER' },
    ]);
  });

  it('re-signing replaces the signer\'s own row through the unique upsert', async () => {
    const req = request();
    const { repo, calls } = fakeRepo(req);
    const hash = claimSignatureAckHash(req);
    await signUseCase(repo).execute(ctx(), 'rb-1', { role: 'REQUESTER', signatureAttachmentId: 'att-sig-1', snapshotHash: hash });
    await signUseCase(repo).execute(ctx(), 'rb-1', { role: 'REQUESTER', signatureAttachmentId: 'att-sig-2', snapshotHash: hash });

    assert.deepEqual(calls.upserts.map((row: any) => row.signatureAttachmentId), ['att-sig-1', 'att-sig-2']);
    assert.deepEqual([...new Set(calls.upserts.map((row: any) => row.role))], ['REQUESTER']);
  });

  it('refuses a role the caller did not perform, even with a valid hash', async () => {
    const req = request();
    const { repo, calls } = fakeRepo(req);
    await assert.rejects(
      () => signUseCase(repo).execute(ctx(), 'rb-1', { role: 'APPROVER', signatureAttachmentId: 'att-sig', snapshotHash: claimSignatureAckHash(req) }),
      /claim_signature_role_not_eligible/,
    );
    assert.equal(calls.upserts.length, 0);
  });

  it('rejects a stale acknowledgement: you sign what you previewed', async () => {
    const req = request();
    const { repo, calls } = fakeRepo(req);
    const previewed = claimSignatureAckHash(req);
    // A line edit after the preview changes the hash, exactly like the approval snapshot.
    req.lines = [{ ...req.lines[0], amount: '900.0000' }];
    assert.notEqual(claimSignatureAckHash(req), previewed, 'lines are folded into the ack hash');

    await assert.rejects(
      () => signUseCase(repo).execute(ctx(), 'rb-1', { role: 'REQUESTER', signatureAttachmentId: 'att-sig', snapshotHash: previewed }),
      /stale_claim_snapshot/,
    );
    assert.equal(calls.upserts.length, 0);
  });

  it('rejects a signature image that is not the signer\'s own', async () => {
    const req = request();
    const { repo, calls } = fakeRepo(req, { signatureAttachment: null });
    await assert.rejects(
      () => signUseCase(repo).execute(ctx(), 'rb-1', { role: 'REQUESTER', signatureAttachmentId: 'att-somebody-else', snapshotHash: claimSignatureAckHash(req) }),
      /claim_signature_attachment_invalid/,
    );
    assert.equal(calls.upserts.length, 0);
  });

  it('rejects signature bytes that do not match the declared image type', async () => {
    const req = request();
    const { repo } = fakeRepo(req);
    const pdfStorage = { getObject: async () => ({ bytes: Buffer.from('%PDF-1.7'), mimeType: 'image/png' }) } as any;
    await assert.rejects(
      () => new SignClaimFormUseCase(repo, pdfStorage, noopAudit).execute(ctx(), 'rb-1', {
        role: 'REQUESTER', signatureAttachmentId: 'att-sig', snapshotHash: claimSignatureAckHash(req),
      }),
      /claim_signature_bytes_mismatch/,
    );
  });

  it('applies the same read guard as the detail endpoint', async () => {
    const req = request({ requesterUserId: 'other-1' });
    const { repo } = fakeRepo(req);
    await assert.rejects(
      () => signUseCase(repo).execute(ctx(), 'rb-1', { role: 'REQUESTER', signatureAttachmentId: 'att-sig', snapshotHash: claimSignatureAckHash(req) }),
      /Cannot read this reimbursement/,
    );
  });
});

describe('Claim signature uploads', () => {
  function uploadSpy() {
    const seen: any[] = [];
    return { spy: seen, useCase: { execute: async (uploadCtx: any, cmd: any) => { seen.push({ uploadCtx, cmd }); return { attachmentId: 'att-new' }; } } as any };
  }

  it('tags the upload for this claim and role and lends the attachment grant', async () => {
    const { repo } = fakeRepo(request());
    const { spy, useCase } = uploadSpy();
    const result = await new InitClaimSignatureUploadUseCase(repo, useCase).execute(ctx(), 'rb-1', {
      role: 'REQUESTER', originalFileName: 'sig.png', mimeType: 'image/png', byteSize: 12_000,
    });

    assert.equal(result.attachmentId, 'att-new');
    assert.deepEqual(spy[0].cmd.metadataJson, { generatedFor: 'reimbursement_claim_signature', requestId: 'rb-1', role: 'REQUESTER' });
    assert.equal(spy[0].cmd.branchId, 'br-1');
    assert.ok(spy[0].uploadCtx.permissions.includes('attachment.create'), 'the grant is lent for the signer\'s own file');
    assert.ok(!ctx().permissions.includes('attachment.create'), 'and not held by the caller');
  });

  it('accepts PNG/JPEG up to 2 MB only', async () => {
    const { repo } = fakeRepo(request());
    const { useCase } = uploadSpy();
    const init = new InitClaimSignatureUploadUseCase(repo, useCase);
    await assert.rejects(
      () => init.execute(ctx(), 'rb-1', { role: 'REQUESTER', originalFileName: 'sig.pdf', mimeType: 'application/pdf', byteSize: 1000 }),
      /claim_signature_must_be_png_or_jpeg_max_2mb/,
    );
    await assert.rejects(
      () => init.execute(ctx(), 'rb-1', { role: 'REQUESTER', originalFileName: 'sig.png', mimeType: 'image/png', byteSize: 2_000_001 }),
      /claim_signature_must_be_png_or_jpeg_max_2mb/,
    );
  });

  it('refuses an upload for a role the caller cannot sign', async () => {
    const { repo } = fakeRepo(request());
    const { useCase } = uploadSpy();
    await assert.rejects(
      () => new InitClaimSignatureUploadUseCase(repo, useCase).execute(ctx(), 'rb-1', {
        role: 'PAYER', originalFileName: 'sig.png', mimeType: 'image/png', byteSize: 1000,
      }),
      /claim_signature_role_not_eligible/,
    );
  });

  it('completes only the signer\'s own pending upload', async () => {
    const { repo } = fakeRepo(request());
    const { spy, useCase } = uploadSpy();
    await new CompleteClaimSignatureUploadUseCase(repo, useCase).execute(ctx(), 'rb-1', 'att-sig', { role: 'REQUESTER', byteSize: 12_000 });
    assert.deepEqual(spy[0].cmd, { attachmentId: 'att-sig', byteSize: 12_000 });

    const { repo: alreadyActive } = fakeRepo(request(), { uploadAttachment: { id: 'att-sig', status: 'ACTIVE', mimeType: 'image/png' } });
    await assert.rejects(
      () => new CompleteClaimSignatureUploadUseCase(alreadyActive, useCase).execute(ctx(), 'rb-1', 'att-sig', { role: 'REQUESTER' }),
      /claim_signature_upload_not_found/,
    );
  });
});

describe('LinkSignedClaimFormCopyUseCase', () => {
  function attachments(overrides: Partial<any> = {}) {
    return {
      findById: async () => ({
        id: 'att-scan', companyId: 'co-1', status: 'ACTIVE', mimeType: 'application/pdf',
        uploadedByUserId: 'staff-1', originalFileName: 'signed.pdf', ...overrides,
      }),
    } as any;
  }

  const copies = [
    { attachmentId: 'att-scan', fileName: 'signed.pdf', uploadedAt: new Date('2026-07-26T10:00:00.000Z') },
    { attachmentId: 'att-old', fileName: 'old.jpg', uploadedAt: new Date('2026-07-25T10:00:00.000Z') },
  ];

  it('lets the requester attach a scan and lists every copy newest first', async () => {
    const { repo, calls } = fakeRepo(request(), { signedCopies: copies });
    const result = await new LinkSignedClaimFormCopyUseCase(repo, attachments(), noopAudit)
      .execute(ctx(), 'rb-1', { attachmentId: 'att-scan' });

    assert.deepEqual(calls.links, [{ companyId: 'co-1', requestId: 'rb-1', attachmentId: 'att-scan', userId: 'staff-1' }]);
    assert.deepEqual(result.map((row) => row.attachmentId), ['att-scan', 'att-old']);
    assert.equal(result[0]!.uploadedAt, '2026-07-26T10:00:00.000Z');
  });

  it('also lets finance and payment holders attach someone else\'s claim scan', async () => {
    const req = request({ requesterUserId: 'other-1' });
    for (const permission of ['reimbursement.finance_review', 'reimbursement.payment.record']) {
      const { repo, calls } = fakeRepo(req, { signedCopies: copies });
      await new LinkSignedClaimFormCopyUseCase(repo, attachments({ uploadedByUserId: 'fin-1' }), noopAudit)
        .execute(ctx({ userId: 'fin-1', permissions: ['reimbursement.read', permission] }), 'rb-1', { attachmentId: 'att-scan' });
      assert.equal(calls.links.length, 1, `${permission} may attach`);
    }
  });

  it('refuses a reader who is neither the requester nor finance', async () => {
    const { repo, calls } = fakeRepo(request({ requesterUserId: 'other-1' }), { signedCopies: copies });
    await assert.rejects(
      () => new LinkSignedClaimFormCopyUseCase(repo, attachments({ uploadedByUserId: 'auditor-1' }), noopAudit)
        .execute(ctx({ userId: 'auditor-1', permissions: ['reimbursement.read'] }), 'rb-1', { attachmentId: 'att-scan' }),
      /claim_form_signed_copy_denied/,
    );
    assert.equal(calls.links.length, 0);
  });

  it('has nothing to attach before the claim has a document number', async () => {
    const { repo } = fakeRepo(request({ status: 'DRAFT', requestNo: undefined }));
    await assert.rejects(
      () => new LinkSignedClaimFormCopyUseCase(repo, attachments(), noopAudit).execute(ctx(), 'rb-1', { attachmentId: 'att-scan' }),
      /claim_form_requires_submitted/,
    );
  });

  it('rejects an attachment that is not the actor\'s own ACTIVE PDF/image', async () => {
    const cases: [Partial<any>, RegExp][] = [
      [{ status: 'PENDING_UPLOAD' }, /claim_form_signed_copy_attachment_invalid/],
      [{ uploadedByUserId: 'someone-else' }, /claim_form_signed_copy_attachment_invalid/],
      [{ mimeType: 'text/csv' }, /claim_form_signed_copy_must_be_pdf_or_image/],
    ];
    for (const [overrides, expected] of cases) {
      const { repo, calls } = fakeRepo(request());
      await assert.rejects(
        () => new LinkSignedClaimFormCopyUseCase(repo, attachments(overrides), noopAudit).execute(ctx(), 'rb-1', { attachmentId: 'att-scan' }),
        expected,
      );
      assert.equal(calls.links.length, 0);
    }
  });
});
