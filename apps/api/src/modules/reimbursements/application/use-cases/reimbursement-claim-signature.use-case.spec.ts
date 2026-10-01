import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CompleteClaimSignatureUploadUseCase,
  InitClaimSignatureUploadUseCase,
  LinkSignedClaimFormCopyUseCase,
  SignClaimFormUseCase,
  eligibleClaimSignatureRoles,
} from './reimbursement-claim-signature.use-case';
import { claimSignatureAckHash } from '../../domain/logic/reimbursement.logic';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { detailWithFileNames } from '../dto/reimbursement.mapper';

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

function fakeRepo(row: any | null, options: {
  signatureAttachment?: any;
  savedSignatureAttachmentId?: string | null;
  uploadAttachment?: any;
  signedCopies?: any[];
} = {}) {
  const calls = { upserts: [] as any[], links: [] as any[], signatureLookups: [] as any[] };
  const repo = {
    findRequestById: async (_companyId: string, _id: string, _withRelations?: boolean) => row,
    findLatestActiveSavedSignatureAttachmentId: async () => (
      options.savedSignatureAttachmentId === undefined ? 'att-saved' : options.savedSignatureAttachmentId
    ),
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
    linkSignedClaimFormCopy: async (companyId: string, requestId: string, attachmentId: string, userId: string, ack?: any) => {
      calls.links.push({ companyId, requestId, attachmentId, userId, ...(ack && { ack }) });
    },
  } as any;
  return { repo, calls };
}

const storage = { getObject: async () => ({ bytes: PNG_BYTES, mimeType: 'image/png' }) } as any;
const noopAudit = { log: async () => undefined } as any;
const signatureRow = (role: string, userId: string) => ({
  id: `sig-${role}`, role, signatureAttachmentId: `att-${role}`, signedByUserId: userId, signedAt: new Date('2026-07-24T00:00:00.000Z'),
});

function signUseCase(repo: any) {
  return new SignClaimFormUseCase(repo, storage, noopAudit);
}

describe('eligibleClaimSignatureRoles', () => {
  it('offers only ผู้เบิก and ผู้อนุมัติ on the two-signer form (D3)', () => {
    const req = request();
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'staff-1'), ['REQUESTER']);
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'mgr-1'), ['APPROVER']);
    // The reviewer and the payer did their steps, but the new form has no block for them.
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'acct-1'), []);
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'fin-1'), []);
    // Requester/approver rows do not make a claim legacy.
    const signed = request({ claimSignatures: [signatureRow('REQUESTER', 'staff-1'), signatureRow('APPROVER', 'mgr-1')] });
    assert.deepEqual(eligibleClaimSignatureRoles(signed, 'fin-1'), []);
  });

  it('maps every role to the actor that really performed the step on a legacy four-block claim', () => {
    const req = request({ claimSignatures: [signatureRow('PAYER', 'fin-1')] });
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'staff-1'), ['REQUESTER']);
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'mgr-1'), ['APPROVER']);
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'acct-1'), ['FINANCE_REVIEW']);
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'fin-1'), ['PAYER']);
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'stranger-1'), [], 'a bystander signs nothing');
    // The voided payment's payer is not the payer of record.
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'ghost-1'), []);
  });

  it('gives a one-person company both blocks, and every role it performed on a legacy claim', () => {
    const req = request({
      requesterUserId: 'owner-1',
      approvalSteps: [{ id: 'st-1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'owner-1', decidedAt: new Date('2026-07-21T00:00:00.000Z') }],
      financeReviewedByUserId: 'owner-1',
      payments: [{ id: 'pay-1', status: 'RECORDED', paidByUserId: 'owner-1', paidAt: new Date('2026-07-23T00:00:00.000Z') }],
    });
    assert.deepEqual(eligibleClaimSignatureRoles(req, 'owner-1'), ['REQUESTER', 'APPROVER']);
    req.claimSignatures = [signatureRow('FINANCE_REVIEW', 'owner-1')];
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

  it('uses the eligible actor\'s latest active saved signature when no attachment is supplied', async () => {
    const req = request();
    const { repo, calls } = fakeRepo(req, { savedSignatureAttachmentId: 'att-my-active-signature' });
    await signUseCase(repo).execute(ctx(), 'rb-1', {
      role: 'REQUESTER', snapshotHash: claimSignatureAckHash(req),
    });

    assert.equal(calls.upserts[0].signatureAttachmentId, 'att-my-active-signature');
    assert.equal(calls.signatureLookups[0].userId, 'staff-1');
  });

  it('returns a stable blocker when the eligible actor has no active saved signature', async () => {
    const req = request();
    const { repo, calls } = fakeRepo(req, { savedSignatureAttachmentId: null });
    await assert.rejects(
      () => signUseCase(repo).execute(ctx(), 'rb-1', {
        role: 'REQUESTER', snapshotHash: claimSignatureAckHash(req),
      }),
      /claim_saved_signature_required/,
    );
    assert.equal(calls.upserts.length, 0);
  });

  it('lets one person sign both blocks with one saved signature: one call per role, same ack hash (D3)', async () => {
    const req = request({
      requesterUserId: 'owner-1',
      approvalSteps: [{ id: 'st-1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'owner-1', decidedAt: new Date('2026-07-21T00:00:00.000Z') }],
      financeReviewStatus: 'NOT_REQUIRED', financeReviewedByUserId: undefined, financeReviewedAt: undefined,
      payments: [{ id: 'pay-1', status: 'RECORDED', paidByUserId: 'owner-1', paidAt: new Date('2026-07-23T00:00:00.000Z') }],
      claimSignatures: [],
    });
    const { repo, calls } = fakeRepo(req);
    const owner = ctx({ userId: 'owner-1', roles: ['OWNER'], permissions: ['reimbursement.read'] });
    const hash = claimSignatureAckHash(req);
    await signUseCase(repo).execute(owner, 'rb-1', { role: 'REQUESTER', snapshotHash: hash });
    req.claimSignatures.push(signatureRow('REQUESTER', 'owner-1'));
    // Signing folds nothing into the ack hash, so the second call acknowledges the same one.
    assert.equal(claimSignatureAckHash(req), hash);
    await signUseCase(repo).execute(owner, 'rb-1', { role: 'APPROVER', snapshotHash: hash });

    assert.deepEqual(calls.upserts.map((row: any) => [row.role, row.signatureAttachmentId, row.signedByUserId]), [
      ['REQUESTER', 'att-saved', 'owner-1'],
      ['APPROVER', 'att-saved', 'owner-1'],
    ]);
    await assert.rejects(
      () => signUseCase(repo).execute(owner, 'rb-1', { role: 'PAYER', snapshotHash: hash }),
      /claim_signature_role_not_eligible/,
      'the payer block is gone from the two-signer form',
    );
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
  function attachments(overrides: Partial<any> = {}, linkedAsPaymentSlip = false) {
    return {
      findById: async () => ({
        id: 'att-scan', companyId: 'co-1', status: 'ACTIVE', mimeType: 'application/pdf',
        uploadedByUserId: 'staff-1', originalFileName: 'signed.pdf', ...overrides,
      }),
      isReimbursementPaymentSlip: async () => linkedAsPaymentSlip,
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

  it('archives without the declaration exactly as before: no acknowledgement stored or audited', async () => {
    const audits: any[] = [];
    const { repo, calls } = fakeRepo(request(), { signedCopies: copies });
    await new LinkSignedClaimFormCopyUseCase(repo, attachments(), { log: async (entry: any) => { audits.push(entry); } } as any)
      .execute(ctx(), 'rb-1', { attachmentId: 'att-scan' });
    assert.equal(calls.links[0].ack, undefined);
    assert.deepEqual(audits[0].metadataJson, { attachmentId: 'att-scan' });
  });

  it('counts a declared scan as paper-signed: acknowledgement, attacher, time and checksum in the audit, status untouched (A4)', async () => {
    const req = request();
    const audits: any[] = [];
    const { repo, calls } = fakeRepo(req, { signedCopies: copies });
    const result = await new LinkSignedClaimFormCopyUseCase(repo, attachments({ checksumSha256: 'c'.repeat(64) }), { log: async (entry: any) => { audits.push(entry); } } as any)
      .execute(ctx(), 'rb-1', { attachmentId: 'att-scan', acknowledgedComplete: true, confirmedRequestNo: 'RB-202607-00001' });

    const ack = calls.links[0].ack;
    assert.deepEqual({ ...ack, acknowledgedAt: undefined }, {
      requestId: 'rb-1', requestNo: 'RB-202607-00001', acknowledgedByUserId: 'staff-1',
      acknowledgedAt: undefined, checksumSha256: 'c'.repeat(64),
    });
    assert.match(ack.acknowledgedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(audits[0].metadataJson, { attachmentId: 'att-scan', acknowledgedComplete: true, ...ack });
    assert.equal(audits[0].actorUserId, 'staff-1');
    // Older copies stay listed; the claim itself is not written.
    assert.deepEqual(result.map((row) => row.attachmentId), ['att-scan', 'att-old']);
    assert.equal(req.status, 'PAID');
    assert.equal(calls.upserts.length, 0);
  });

  it('refuses a declaration that does not name this claim\'s number', async () => {
    for (const confirmedRequestNo of ['RB-202607-00002', undefined]) {
      const { repo, calls } = fakeRepo(request(), { signedCopies: copies });
      await assert.rejects(
        () => new LinkSignedClaimFormCopyUseCase(repo, attachments(), noopAudit)
          .execute(ctx(), 'rb-1', { attachmentId: 'att-scan', acknowledgedComplete: true, confirmedRequestNo }),
        /stale_claim_snapshot/,
      );
      assert.equal(calls.links.length, 0);
    }
  });

  it('refuses to declare a system-tagged file, such as a signature image, as the signed scan', async () => {
    const { repo, calls } = fakeRepo(request(), { signedCopies: copies });
    const signatureImage = attachments({ mimeType: 'image/png', metadataJson: { generatedFor: 'reimbursement_claim_signature', requestId: 'rb-1', role: 'REQUESTER' } });
    await assert.rejects(
      () => new LinkSignedClaimFormCopyUseCase(repo, signatureImage, noopAudit)
        .execute(ctx(), 'rb-1', { attachmentId: 'att-scan', acknowledgedComplete: true, confirmedRequestNo: 'RB-202607-00001' }),
      /claim_form_signed_copy_attachment_invalid/,
    );
    assert.equal(calls.links.length, 0);
  });

  // Owner 2026-10-01: a slip is payment evidence and never counts as a signed claim copy. This list is
  // open to everyone who can read the claim, the slip is not.
  it('refuses a payment slip as a signed copy, declared or not', async () => {
    const slipUpload = () => attachments({ mimeType: 'image/jpeg', metadataJson: { generatedFor: 'reimbursement_payment_slip', requestId: 'rb-1' } });
    const linkedSlip = () => attachments({}, true);
    for (const files of [slipUpload, linkedSlip]) {
      for (const input of [{ attachmentId: 'att-scan' }, { attachmentId: 'att-scan', acknowledgedComplete: true as const, confirmedRequestNo: 'RB-202607-00001' }]) {
        const { repo, calls } = fakeRepo(request(), { signedCopies: copies });
        await assert.rejects(
          () => new LinkSignedClaimFormCopyUseCase(repo, files(), noopAudit).execute(ctx(), 'rb-1', input),
          /claim_form_signed_copy_attachment_invalid/,
        );
        assert.equal(calls.links.length, 0);
      }
    }
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

describe('PrismaReimbursementRepository saved claim signatures', () => {
  const attachment = {
    id: 'att-saved', bucket: 'private', objectKey: 'signatures/att-saved', objectVersionId: null,
    mimeType: 'image/png', byteSize: 123, checksumSha256: null,
  };

  it('resolves only the latest ACTIVE signature submitted by the signer', async () => {
    const client = {
      companySignatureAsset: {
        findFirst: async (args: any) => {
          assert.deepEqual(args.where, {
            companyId: 'co-1', submittedByUserId: 'staff-1', status: 'ACTIVE',
          });
          assert.deepEqual(args.orderBy, { createdAt: 'desc' });
          return { originalAttachmentId: 'att-original', derivedAttachmentId: 'att-derived' };
        },
      },
    };
    const repo = new PrismaReimbursementRepository({ client } as any, {} as any);
    assert.equal(await repo.findLatestActiveSavedSignatureAttachmentId('co-1', 'staff-1'), 'att-derived');
  });

  it('loads a saved attachment only when its asset belongs to the signer', async () => {
    let attachmentLookup = 0;
    const client = {
      companySignatureAsset: {
        findFirst: async ({ where }: any) => {
          assert.equal(where.companyId, 'co-1');
          assert.equal(where.submittedByUserId, 'staff-1');
          assert.deepEqual(where.OR, [
            { originalAttachmentId: 'att-saved' }, { derivedAttachmentId: 'att-saved' },
          ]);
          return { id: 'sig-own' };
        },
      },
      attachmentObject: {
        findFirst: async ({ where }: any) => {
          attachmentLookup += 1;
          if (attachmentLookup === 1) return null;
          assert.equal(where.uploadedByUserId, 'staff-1');
          assert.equal(where.companyId, 'co-1');
          assert.equal(where.id, 'att-saved');
          return attachment;
        },
      },
    };
    const repo = new PrismaReimbursementRepository({ client } as any, {} as any);
    assert.equal(
      (await repo.findClaimSignatureAttachment('co-1', 'att-saved', 'staff-1', 'rb-1', 'REQUESTER'))?.id,
      'att-saved',
    );
  });

  it('does not load an attachment when the saved asset belongs to somebody else', async () => {
    let attachmentLookup = 0;
    const client = {
      companySignatureAsset: { findFirst: async () => null },
      attachmentObject: {
        findFirst: async () => { attachmentLookup += 1; return null; },
      },
    };
    const repo = new PrismaReimbursementRepository({ client } as any, {} as any);
    assert.equal(
      await repo.findClaimSignatureAttachment('co-1', 'att-other', 'staff-1', 'rb-1', 'REQUESTER'),
      null,
    );
    assert.equal(attachmentLookup, 1, 'a foreign asset never reaches the reusable attachment lookup');
  });
});

describe('PrismaReimbursementRepository signed-copy acknowledgement (A4)', () => {
  const ack = { requestId: 'rb-1', requestNo: 'RB-202607-00001', acknowledgedByUserId: 'staff-1', acknowledgedAt: '2026-07-26T10:00:00.000Z', checksumSha256: 'c'.repeat(64) };

  function linkClient(metadataJson: unknown = { source: 'web' }) {
    const writes: any[] = [];
    const tx = {
      attachmentLink: { upsert: async (args: any) => { writes.push(['upsert', args]); return { id: 'link-1' }; } },
      attachmentObject: {
        findFirstOrThrow: async (args: any) => { writes.push(['read', args]); return { metadataJson }; },
        update: async (args: any) => { writes.push(['update', args]); return {}; },
      },
    };
    const client = { attachmentLink: { findFirst: async () => null }, $transaction: async (fn: any) => fn(tx) };
    return { repo: new PrismaReimbursementRepository({ client } as any, {} as any), writes };
  }

  it('stores the declaration in the scan metadata, bound to its link id, keeping existing keys', async () => {
    const { repo, writes } = linkClient();
    await repo.linkSignedClaimFormCopy('co-1', 'rb-1', 'att-scan', 'staff-1', ack);
    const update = writes.find(([kind]) => kind === 'update')![1];
    assert.deepEqual(update.where, { id: 'att-scan' });
    assert.deepEqual(update.data.metadataJson, { source: 'web', reimbursementSignedCopyAck: { ...ack, linkId: 'link-1' } });
    assert.deepEqual(writes.find(([kind]) => kind === 'read')![1].where, { id: 'att-scan', companyId: 'co-1' });
  });

  it('writes only the link for an archive-only copy', async () => {
    const { repo, writes } = linkClient();
    await repo.linkSignedClaimFormCopy('co-1', 'rb-1', 'att-scan', 'staff-1');
    assert.deepEqual(writes.map(([kind]) => kind), ['upsert']);
  });

  it('counts a copy as acknowledged only when the stored declaration names its own link', async () => {
    const at = new Date('2026-07-26T10:00:00.000Z');
    const client = {
      attachmentLink: {
        findMany: async () => [
          { id: 'link-3', attachmentId: 'att-declared', createdAt: at, attachment: { originalFileName: 'signed.pdf', metadataJson: { reimbursementSignedCopyAck: { ...ack, linkId: 'link-3' } } } },
          // Pre-filled by a client at upload, or left from a link deleted by a reopen: another link's id.
          { id: 'link-2', attachmentId: 'att-forged', createdAt: at, attachment: { originalFileName: 'forged.pdf', metadataJson: { reimbursementSignedCopyAck: { ...ack, linkId: 'link-guess' } } } },
          { id: 'link-1', attachmentId: 'att-archive', createdAt: at, attachment: { originalFileName: 'scan.jpg', metadataJson: null } },
        ],
      },
    };
    const repo = new PrismaReimbursementRepository({ client } as any, {} as any);
    const rows = await repo.listSignedClaimFormCopies('co-1', 'rb-1');
    // Only the declaration bound to its own link names who made it and when.
    assert.deepEqual(rows.map((row) => [row.attachmentId, row.acknowledged, row.acknowledgedByUserId, row.acknowledgedAt]), [
      ['att-declared', true, 'staff-1', '2026-07-26T10:00:00.000Z'],
      ['att-forged', false, undefined, undefined],
      ['att-archive', false, undefined, undefined],
    ]);
  });
});

describe('claim detail: form layout and documentSignedVia', () => {
  const uploadedAt = new Date('2026-07-26T10:00:00.000Z');
  async function detailOf(req: any, copies: any[] = [], storedPolicy: any = null, names: Record<string, string> = {}) {
    // Resolves only the ids it is asked for, so a name on screen proves the id was in the batch.
    const getUserDisplayNames = async (_companyId: string, ids: string[]) => Object.fromEntries(ids.filter((id) => names[id]).map((id) => [id, names[id]]));
    const repo = { getUserDisplayNames, listSignedClaimFormCopies: async () => copies, findPolicy: async () => storedPolicy, listPaymentSlips: async () => ({}) } as any;
    const evidence = { getAttachmentFileName: async () => undefined, getAttachmentFileNames: async () => ({}) } as any;
    // The detail maps every step, so the steps need the assignment time the shared fixture leaves out.
    const approvalSteps = req.approvalSteps.map((step: any) => ({ ...step, assignedAt: new Date('2026-07-20T00:00:00.000Z') }));
    return detailWithFileNames(repo, evidence, 'co-1', { ...req, approvalSteps });
  }
  const declared = { attachmentId: 'att-paper', fileName: 'signed.pdf', uploadedAt, acknowledged: true };
  const archived = { attachmentId: 'att-archive', fileName: 'scan.jpg', uploadedAt, acknowledged: false };

  it('reports the layout and how the document was signed', async () => {
    const both = [signatureRow('REQUESTER', 'staff-1'), signatureRow('APPROVER', 'mgr-1')];
    const cases: [any[], any[], string, string | null][] = [
      [both, [], 'TWO_SIGNERS', 'DIGITAL'],
      [[], [declared], 'TWO_SIGNERS', 'PAPER'],
      [[signatureRow('REQUESTER', 'staff-1')], [archived, declared], 'TWO_SIGNERS', 'BOTH'],
      [[signatureRow('REQUESTER', 'staff-1')], [archived], 'TWO_SIGNERS', null],
      [[], [], 'TWO_SIGNERS', null],
      [[...both, signatureRow('PAYER', 'fin-1')], [], 'LEGACY_FOUR_SIGNERS', null],
    ];
    for (const [claimSignatures, copies, layout, via] of cases) {
      const detail = await detailOf(request({ claimSignatures }), copies);
      assert.equal(detail.claimFormLayout, layout);
      assert.equal(detail.documentSignedVia, via, JSON.stringify({ claimSignatures: claimSignatures.map((row) => row.role), copies: copies.map((copy) => copy.attachmentId) }));
    }
  });

  it('reports financeReviewRequired from the frozen snapshot once submitted and the current policy for a draft', async () => {
    const stored = (financeReviewRequired: boolean) => ({
      currency: 'THB', approvalRequiredFromAmount: '1.00', approverMode: 'MANAGER_ROLE', defaultApproverRole: 'MANAGER',
      allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: false, duplicatePolicy: 'WARN',
      financeReviewRequired, status: 'ACTIVE',
    });
    const frozen = {
      schemaVersion: 1, policyId: 'p-1', policyVersion: 'v1', approvalRequiredFromAmount: '1.00', requiresApproval: true,
      route: { mode: 'MANAGER_ROLE', roleKey: 'MANAGER', effectiveTaskRole: 'MANAGER', ownerFallbackUsedAtSubmission: false },
      allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: false, duplicatePolicy: 'WARN',
      financeReviewRequired: false,
    };
    const submitted = await detailOf(request({ approvalPolicySnapshotJson: frozen }), [], stored(true));
    assert.equal(submitted.financeReviewRequired, false, 'a later policy change does not reach a submitted claim');
    const draft = request({ status: 'DRAFT', requestNo: undefined, submittedAt: undefined });
    assert.equal((await detailOf(draft, [], stored(true))).financeReviewRequired, true);
    assert.equal((await detailOf(draft, [], stored(false))).financeReviewRequired, false);
  });

  it('omits layout and signed-via when signature rows were not loaded', async () => {
    const detail = await detailOf(request({ claimSignatures: undefined }), [declared]);
    assert.equal(detail.claimFormLayout, undefined);
    assert.equal(detail.documentSignedVia, undefined);
    assert.deepEqual(detail.signedCopies, [{ attachmentId: 'att-paper', fileName: 'signed.pdf', uploadedAt: uploadedAt.toISOString() }]);
  });

  it('marks the declared scan with when and by whom, for the ลงนามบนกระดาษ line (A4)', async () => {
    const paper = { ...declared, acknowledgedByUserId: 'fin-9', acknowledgedAt: '2026-07-26T10:05:00.000Z' };
    const detail = await detailOf(request({ claimSignatures: [] }), [archived, paper], null, { 'fin-9': 'คุณการเงิน' });
    assert.equal(detail.documentSignedVia, 'PAPER');
    assert.deepEqual(detail.signedCopies, [
      { attachmentId: 'att-archive', fileName: 'scan.jpg', uploadedAt: uploadedAt.toISOString() },
      { attachmentId: 'att-paper', fileName: 'signed.pdf', uploadedAt: uploadedAt.toISOString(), acknowledgedAt: '2026-07-26T10:05:00.000Z', acknowledgedByName: 'คุณการเงิน' },
    ]);
    // A name that does not resolve is left out — never replaced by the user id.
    const nameless = await detailOf(request({ claimSignatures: [] }), [paper]);
    assert.deepEqual(nameless.signedCopies, [
      { attachmentId: 'att-paper', fileName: 'signed.pdf', uploadedAt: uploadedAt.toISOString(), acknowledgedAt: '2026-07-26T10:05:00.000Z' },
    ]);
  });
});

// Spec §16: a slip attached through the "ใบเบิกที่เซ็นแล้ว" uploader declared a paper signature that
// was never there. Moving it to be the payment slip must leave the claim's signature state as what
// is really on the claim. Real repository, on rows held in memory, so the move itself is exercised.
describe('moving a misfiled slip recomputes how the document was signed', () => {
  const declaredAt = new Date('2026-07-26T10:00:00.000Z');
  const ack = (linkId: string) => ({
    requestId: 'rb-1', requestNo: 'RB-202607-00001', acknowledgedByUserId: 'mgr-1',
    acknowledgedAt: '2026-07-26T10:05:00.000Z', checksumSha256: 'c'.repeat(64), linkId,
  });
  const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((alternative: any) => matches(row, alternative));
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    return row[key] === value;
  });

  function world(claimSignatures: any[], otherCopies: { id: string; declared: boolean }[] = []) {
    const copyLink = (linkId: string, attachmentId: string, createdAt = declaredAt) => ({
      id: linkId, companyId: 'co-1', attachmentId, targetType: 'reimbursement_request', targetId: 'rb-1',
      purpose: 'reimbursement.claim_form.signed', linkedByUserId: 'mgr-1', createdAt,
    });
    const file = (id: string, originalFileName: string, metadataJson: unknown) => ({
      id, companyId: 'co-1', status: 'ACTIVE', mimeType: 'image/jpeg', byteSize: 900_000,
      checksumSha256: 'c'.repeat(64), uploadedByUserId: 'mgr-1', originalFileName, metadataJson,
    });
    const files: any[] = [
      file('att-misfiled', 'สลิปโอนเงิน.jpg', { reimbursementSignedCopyAck: ack('link-misfiled') }),
      ...otherCopies.map(({ id, declared }) => file(id, 'ใบเบิกเซ็นแล้ว.pdf', declared ? { reimbursementSignedCopyAck: ack(`link-${id}`) } : null)),
    ];
    let links: any[] = [
      copyLink('link-misfiled', 'att-misfiled'),
      ...otherCopies.map(({ id }) => copyLink(`link-${id}`, id, new Date('2026-07-25T10:00:00.000Z'))),
    ];
    const payments = [{ id: 'pay-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', status: 'RECORDED' }];
    const linkRows = (where: any) => {
      const { attachment, ...rest } = where;
      return links
        .map((link) => ({ ...link, attachment: files.find((row) => row.id === link.attachmentId) }))
        .filter((link) => matches(link, rest) && (!attachment || matches(link.attachment, attachment)));
    };
    const tables = {
      attachmentObject: {
        findFirst: async ({ where }: any) => files.find((row) => matches(row, where)) ?? null,
        update: async ({ where, data }: any) => Object.assign(files.find((row) => row.id === where.id), data),
      },
      attachmentLink: {
        findMany: async ({ where, orderBy }: any) => {
          const newestFirst = orderBy?.createdAt === 'desc';
          return linkRows(where).sort((a, b) => (newestFirst ? -1 : 1) * (a.createdAt.getTime() - b.createdAt.getTime()));
        },
        create: async ({ data }: any) => { links.push({ id: `link-slip-${links.length}`, createdAt: new Date('2026-07-27T10:00:00.000Z'), ...data }); },
        deleteMany: async ({ where }: any) => { links = links.filter((link) => !matches(link, where)); },
      },
      reimbursementPayment: {
        findFirst: async ({ where }: any) => payments.find((row) => matches(row, where)) ?? null,
        count: async ({ where }: any) => payments.filter((row) => matches(row, where)).length,
      },
    };
    const client = { ...tables, $transaction: async (work: (tx: any) => Promise<unknown>) => work({ ...tables, $executeRaw: async () => 1 }) };
    const repository = new PrismaReimbursementRepository({ client } as any, {} as any);
    // Names and policy are not what this is about; everything about copies and slips is the real repository.
    const repo = Object.assign(Object.create(repository), { getUserDisplayNames: async () => ({ 'mgr-1': 'มานี ผู้จัดการ' }), findPolicy: async () => null });
    const evidence = { getAttachmentFileName: async () => undefined, getAttachmentFileNames: async () => ({}) } as any;
    const claim = request({ claimSignatures });
    const approvalSteps = claim.approvalSteps.map((step: any) => ({ ...step, assignedAt: new Date('2026-07-20T00:00:00.000Z') }));
    return {
      detail: () => detailWithFileNames(repo, evidence, 'co-1', { ...claim, approvalSteps }),
      move: () => repository.attachPaymentSlipAtomic({ companyId: 'co-1', requestId: 'rb-1', paymentId: 'pay-1', attachmentId: 'att-misfiled', actorUserId: 'fin-1' }),
      misfiled: files[0],
      links: () => links,
    };
  }
  const shape = (detail: any) => ({
    via: detail.documentSignedVia,
    copies: detail.signedCopies.map((copy: any) => [copy.attachmentId, Boolean(copy.acknowledgedAt)]),
    signed: detail.signatures.map((row: any) => row.role),
    slips: detail.payments.find((payment: any) => payment.id === 'pay-1').slips.map((slip: any) => slip.attachmentId),
  });

  it('leaves a claim that had only that file as its paper proof unsigned, with no declaration left behind', async () => {
    const w = world([]);
    assert.deepEqual(shape(await w.detail()), { via: 'PAPER', copies: [['att-misfiled', true]], signed: [], slips: [] });

    assert.deepEqual(await w.move(), { created: true, slip: { attachmentId: 'att-misfiled', source: 'SIGNED_COPY', uploadedByUserId: 'mgr-1', declarationWithdrawn: true } });

    assert.deepEqual(shape(await w.detail()), { via: null, copies: [], signed: [], slips: ['att-misfiled'] });
    assert.deepEqual(w.misfiled.metadataJson, {}, 'the stored declaration is gone, not merely unlinked');
    assert.equal(w.misfiled.status, 'ACTIVE', 'the file itself stays: nothing was uploaded again or deleted');
    assert.deepEqual(w.links().map((link) => [link.attachmentId, link.targetType, link.purpose]), [['att-misfiled', 'reimbursement_payment', 'reimbursement.payment.slip']]);
  });

  it('leaves a claim that also had both digital signatures signed in the system, and no longer on paper', async () => {
    const w = world([signatureRow('REQUESTER', 'staff-1'), signatureRow('APPROVER', 'mgr-1')]);
    assert.deepEqual(shape(await w.detail()), { via: 'BOTH', copies: [['att-misfiled', true]], signed: ['REQUESTER', 'APPROVER'], slips: [] });

    await w.move();

    assert.deepEqual(shape(await w.detail()), { via: 'DIGITAL', copies: [], signed: ['REQUESTER', 'APPROVER'], slips: ['att-misfiled'] });
  });

  it('does not let one digital signature stand in for the withdrawn paper declaration', async () => {
    const w = world([signatureRow('REQUESTER', 'staff-1')]);
    assert.equal((await w.detail()).documentSignedVia, 'BOTH');
    await w.move();
    assert.deepEqual(shape(await w.detail()), { via: null, copies: [], signed: ['REQUESTER'], slips: ['att-misfiled'] });
  });

  it('keeps the claim signed on paper when a real declared copy remains, and unsigned when the rest are archive copies', async () => {
    const real = world([], [{ id: 'att-real', declared: true }]);
    await real.move();
    assert.deepEqual(shape(await real.detail()), { via: 'PAPER', copies: [['att-real', true]], signed: [], slips: ['att-misfiled'] });

    const archiveOnly = world([], [{ id: 'att-archive', declared: false }]);
    assert.equal((await archiveOnly.detail()).documentSignedVia, 'PAPER');
    await archiveOnly.move();
    assert.deepEqual(shape(await archiveOnly.detail()), { via: null, copies: [['att-archive', false]], signed: [], slips: ['att-misfiled'] });
  });
});
