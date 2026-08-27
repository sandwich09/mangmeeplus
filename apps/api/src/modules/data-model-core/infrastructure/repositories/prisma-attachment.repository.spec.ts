import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { PrismaAttachmentRepository } from './prisma-attachment.repository';

function makeRepo(input?: { directEvidence?: object | null; snapshotEvidence?: object | null; linkedExpenseIds?: string[]; sourceEvidence?: object | null; wetSignedScan?: object | null }) {
  const expenseSubstituteReceiptEvidence = {
    findFirst: mock.fn(async (args: any) => {
      // R11's scan is looked up by its own column and over a wider status range than the rest.
      if ('wetSignedScanAttachmentId' in args.where) return input?.wetSignedScan ?? null;
      return args.where.OR.some((filter: object) => 'paymentEvidenceAttachmentIds' in filter)
        ? input?.snapshotEvidence ?? null
        : input?.directEvidence ?? null;
    }),
  };
  const attachmentLink = {
    findMany: mock.fn(async () => (input?.linkedExpenseIds ?? []).map((targetId) => ({ targetId }))),
  };
  const expenseRecord = {
    findFirst: mock.fn(async () => input?.sourceEvidence ?? null),
  };
  const client = { expenseSubstituteReceiptEvidence, attachmentLink, expenseRecord };
  return {
    repo: new PrismaAttachmentRepository({ client } as any),
    expenseSubstituteReceiptEvidence,
    attachmentLink,
    expenseRecord,
  };
}

/**
 * The lookup that closes the two-call signature leak. `isSubstituteRawSignature` beside it only
 * matches images a certificate already RECORDED, so the library link is what makes an asset that has
 * not signed anything yet visible to the download gate.
 */
describe('PrismaAttachmentRepository.findSignatureAssetOwner', () => {
  function setup(input: { link?: object | null; asset?: object | null } = {}) {
    const attachmentLink = { findFirst: mock.fn(async () => input.link ?? null) };
    const companySignatureAsset = { findFirst: mock.fn(async () => input.asset ?? null) };
    const client = { attachmentLink, companySignatureAsset };
    return { repo: new PrismaAttachmentRepository({ client } as any), attachmentLink, companySignatureAsset };
  }

  it('reads the owner through the signature-asset link, tenant-scoped', async () => {
    const { repo, attachmentLink, companySignatureAsset } = setup({
      link: { targetId: 'sig-1' }, asset: { submittedByUserId: 'payer-1' },
    });
    assert.deepEqual(await repo.findSignatureAssetOwner({ id: 'att-1', companyId: 'co-1' }), { ownerUserId: 'payer-1' });
    assert.deepEqual((attachmentLink.findFirst.mock.calls as any[])[0].arguments[0].where, {
      companyId: 'co-1', attachmentId: 'att-1', targetType: 'company.signature_asset',
    });
    // Deterministic, earliest-first: when the same bytes carry more than one link the original
    // owner wins, so a later link cannot make the D14 gate hand the image to whoever added it.
    assert.deepEqual((attachmentLink.findFirst.mock.calls as any[])[0].arguments[0].orderBy, [
      { createdAt: 'asc' }, { id: 'asc' },
    ]);
    assert.deepEqual((companySignatureAsset.findFirst.mock.calls as any[])[0].arguments[0].where, {
      id: 'sig-1', companyId: 'co-1',
    });
  });

  it('says "not a signature" only when no link exists, and fails closed on an orphaned one', async () => {
    const plain = setup();
    assert.equal(await plain.repo.findSignatureAssetOwner({ id: 'att-1', companyId: 'co-1' }), null);
    assert.equal(plain.companySignatureAsset.findFirst.mock.callCount(), 0, 'no link, no second query');

    const orphaned = setup({ link: { targetId: 'sig-gone' }, asset: null });
    assert.deepEqual(
      await orphaned.repo.findSignatureAssetOwner({ id: 'att-1', companyId: 'co-1' }),
      { ownerUserId: null },
      'a link with no asset is still a signature — it just belongs to nobody the gate can match',
    );
  });
});

describe('PrismaAttachmentRepository substitute-evidence retention', () => {
  it('retains certified, issued, and superseded artifacts and signatures', async () => {
    const { repo, expenseSubstituteReceiptEvidence, attachmentLink } = makeRepo({ directEvidence: { id: 'evidence-1' } });

    assert.equal(await repo.findSubstituteEvidenceRetentionHold({ companyId: 'co-1', id: 'att-1' }), 'SUBSTITUTE_ARTIFACT');
    const where = (expenseSubstituteReceiptEvidence.findFirst.mock.calls as any[])
      .map((call) => call.arguments[0].where).find((item) => item.OR);
    assert.deepEqual(where.status.in, ['PAYER_CERTIFIED', 'ISSUED', 'SUPERSEDED']);
    assert.deepEqual(where.OR, [
      { certifiedArtifactAttachmentId: 'att-1' },
      { artifactAttachmentId: 'att-1' },
      { payerSignatureAttachmentId: 'att-1' },
      { approverSignatureAttachmentId: 'att-1' },
    ]);
    assert.equal((attachmentLink.findMany.mock.calls as any[]).length, 0);
  });

  it('retains original and supporting attachments linked to an expense with signed or issued evidence', async () => {
    const { repo, expenseRecord } = makeRepo({ linkedExpenseIds: ['expense-1', 'expense-1'], sourceEvidence: { id: 'expense-1' } });

    assert.equal(await repo.findSubstituteEvidenceRetentionHold({ companyId: 'co-1', id: 'att-source' }), 'SUBSTITUTE_SOURCE');
    const where = (expenseRecord.findFirst.mock.calls as any[])[0]?.arguments[0].where;
    assert.deepEqual(where.OR, [
      { primaryAttachmentId: 'att-source' },
      { id: { in: ['expense-1'] } },
    ]);
    assert.deepEqual(where.substituteReceiptEvidences.some.status.in, ['PAYER_CERTIFIED', 'ISSUED', 'SUPERSEDED']);
  });

  it('retains payment and supporting attachments captured in the immutable evidence snapshot', async () => {
    const { repo, expenseSubstituteReceiptEvidence, attachmentLink } = makeRepo({ snapshotEvidence: { id: 'evidence-1' } });

    assert.equal(await repo.findSubstituteEvidenceRetentionHold({ companyId: 'co-1', id: 'att-payment' }), 'SUBSTITUTE_SOURCE');
    const secondWhere = (expenseSubstituteReceiptEvidence.findFirst.mock.calls as any[])
      .map((call) => call.arguments[0].where).filter((item) => item.OR)[1];
    assert.deepEqual(secondWhere.OR, [
      { paymentEvidenceAttachmentIds: { array_contains: ['att-payment'] } },
      { supportingAttachmentIds: { array_contains: ['att-payment'] } },
    ]);
    assert.equal((attachmentLink.findMany.mock.calls as any[]).length, 0);
  });

  it('allows deletion when no retained substitute evidence references the attachment', async () => {
    const { repo } = makeRepo({ linkedExpenseIds: ['expense-1'] });

    assert.equal(await repo.findSubstituteEvidenceRetentionHold({ companyId: 'co-1', id: 'att-unrelated' }), null);
  });

  it('holds a signature image whose asset was retired by a replacement', async () => {
    // D14 retires the previous signature whenever a new one is saved, so most held signature images
    // belong to an ARCHIVED asset. The hold is computed from the EVIDENCE that recorded the bytes and
    // never reads CompanySignatureAsset — the fake client below has no such table, so a lookup that
    // started consulting the asset's status would fail this test rather than start allowing deletion.
    const { repo } = makeRepo({ directEvidence: { id: 'evidence-1' } });

    assert.equal(
      await repo.findSubstituteEvidenceRetentionHold({ companyId: 'co-1', id: 'att-retired-signature' }),
      'SUBSTITUTE_ARTIFACT',
    );
  });
});

describe('PrismaAttachmentRepository.markDeleted', () => {
  it('uses the caller transaction for retention checks and soft-delete', async () => {
    const now = new Date('2026-07-29T00:00:00Z');
    const tx = {
      $executeRaw: mock.fn(async () => 1),
      expenseSubstituteReceiptEvidence: { findFirst: mock.fn(async () => null) },
      attachmentLink: { findMany: mock.fn(async () => []) },
      expenseRecord: { findFirst: mock.fn(async () => null) },
      attachmentObject: {
        updateMany: mock.fn(async () => ({ count: 1 })),
        findFirstOrThrow: mock.fn(async () => ({
          id: 'att-1',
          companyId: 'co-1',
          originalFileName: 'receipt.pdf',
          status: 'DELETED',
          createdAt: now,
          updatedAt: now,
        })),
      },
    };
    const client = {
      $transaction: mock.fn(async () => {
        throw new Error('must not open a nested transaction');
      }),
    };
    const repo = new PrismaAttachmentRepository({ client } as any);

    const result = await repo.markDeleted({ companyId: 'co-1', id: 'att-1' }, tx as any);

    assert.equal(client.$transaction.mock.callCount(), 0);
    assert.equal(tx.$executeRaw.mock.callCount(), 1);
    // wet-signed scan, then the artifact/signature hold, then the snapshot hold — all on the tx.
    assert.equal(tx.expenseSubstituteReceiptEvidence.findFirst.mock.callCount(), 3);
    assert.equal(tx.attachmentLink.findMany.mock.callCount(), 1);
    assert.deepEqual((tx.attachmentObject.updateMany.mock.calls as any[])[0]?.arguments[0].where, {
      id: 'att-1',
      companyId: 'co-1',
      status: { not: 'DELETED' },
    });
    assert.equal(result.status, 'DELETED');
  });
});

describe('PrismaAttachmentRepository.linkToTarget', () => {
  function setup(input: { attachment?: object | null; target?: object | null; conflictingLink?: object | null } = {}) {
    const attachmentObject = { findFirst: mock.fn(async () => input.attachment === undefined ? { id: 'att-1', branchId: 'branch-1' } : input.attachment) };
    const expenseRecord = { findFirst: mock.fn(async () => input.target === undefined ? { id: 'expense-1', branchId: 'branch-1' } : input.target) };
    const accountingDocument = { findFirst: mock.fn(async () => input.target === undefined ? { id: 'invoice-1', branchId: 'branch-1' } : input.target) };
    const attachmentLink = {
      findFirst: mock.fn(async () => input.conflictingLink ?? null),
      create: mock.fn(async ({ data }: any) => ({ id: 'link-1', ...data, createdAt: new Date('2026-07-28T00:00:00Z') })),
    };
    const tx = { attachmentObject, expenseRecord, accountingDocument, attachmentLink };
    const client = { $transaction: (fn: (value: typeof tx) => unknown) => fn(tx) };
    return { repo: new PrismaAttachmentRepository({ client } as any), attachmentObject, expenseRecord, accountingDocument, attachmentLink };
  }

  it('validates ACTIVE attachment, tenant target, and owner inside one transaction', async () => {
    const { repo, attachmentObject, expenseRecord, attachmentLink } = setup();
    await repo.linkToTarget({
      companyId: 'co-1',
      attachmentId: 'att-1',
      targetType: 'expense.record',
      targetId: 'expense-1',
      purpose: 'expense.receipt.supporting',
      linkedByUserId: 'user-1',
      targetOwnerUserId: 'user-1',
    });
    assert.deepEqual((attachmentObject.findFirst.mock.calls as any[])[0]?.arguments[0].where, {
      id: 'att-1', companyId: 'co-1', status: 'ACTIVE',
    });
    assert.deepEqual((expenseRecord.findFirst.mock.calls as any[])[0]?.arguments[0].where, {
      id: 'expense-1', companyId: 'co-1', createdByUserId: 'user-1',
    });
    assert.equal(attachmentLink.create.mock.callCount(), 1);
  });

  it('does not create a link when the target is outside the tenant or owner scope', async () => {
    const { repo, attachmentLink } = setup({ target: null });
    await assert.rejects(() => repo.linkToTarget({
      companyId: 'co-1',
      attachmentId: 'att-1',
      targetType: 'expense.record',
      targetId: 'expense-other',
      purpose: 'expense.receipt.supporting',
      linkedByUserId: 'user-1',
    }), /not found/i);
    assert.equal(attachmentLink.create.mock.callCount(), 0);
  });

  it('validates an accounting-document target in the same tenant and owner scope', async () => {
    const { repo, expenseRecord, accountingDocument, attachmentLink } = setup();
    await repo.linkToTarget({
      companyId: 'co-1', attachmentId: 'att-1', targetType: 'accounting.document',
      targetId: 'invoice-1', purpose: 'accounting.document.supporting',
      linkedByUserId: 'user-1', targetOwnerUserId: 'user-1', branchIds: ['branch-1'],
    });
    assert.equal(expenseRecord.findFirst.mock.callCount(), 0);
    assert.deepEqual((accountingDocument.findFirst.mock.calls as any[])[0]?.arguments[0].where, {
      id: 'invoice-1', companyId: 'co-1', createdByUserId: 'user-1',
      OR: [{ branchId: { in: ['branch-1'] } }, { branchId: null }],
    });
    assert.equal(attachmentLink.create.mock.callCount(), 1);
  });

  it('rejects an accounting attachment from a different branch', async () => {
    const { repo, attachmentLink } = setup({
      attachment: { id: 'att-1', branchId: 'branch-2' },
      target: { id: 'invoice-1', branchId: 'branch-1' },
    });
    await assert.rejects(() => repo.linkToTarget({
      companyId: 'co-1', attachmentId: 'att-1', targetType: 'accounting.document',
      targetId: 'invoice-1', purpose: 'accounting.document.supporting', linkedByUserId: 'user-1',
      branchIds: ['branch-1'],
    }), /same branch/i);
    assert.equal(attachmentLink.create.mock.callCount(), 0);
  });

  it('revalidates the target-purpose pair inside the authoritative transaction', async () => {
    const { repo, expenseRecord, attachmentLink } = setup();
    await assert.rejects(() => repo.linkToTarget({
      companyId: 'co-1',
      attachmentId: 'att-1',
      targetType: 'expense.record',
      targetId: 'expense-1',
      purpose: 'crm.profile.photo',
      linkedByUserId: 'user-1',
    }), /target or purpose/i);
    assert.equal(expenseRecord.findFirst.mock.callCount(), 0);
    assert.equal(attachmentLink.create.mock.callCount(), 0);
  });

  it('refuses to hang a signature-library image off an expense', async () => {
    // QA's repro: POST /attachments/:id/links with a signature attachment and an ordinary receipt
    // purpose returned 201, and from then on every reviewer of that expense got the owner-only 403
    // from the shared download path — a blank document viewer, not just a failed click. Loosening
    // that gate would instead let any `expense.review` holder read a colleague's signature, so the
    // state is refused where it is created.
    const { repo, expenseRecord, attachmentLink } = setup({ conflictingLink: { targetType: 'company.signature_asset' } });
    await assert.rejects(() => repo.linkToTarget({
      companyId: 'co-1',
      attachmentId: 'att-signature',
      targetType: 'expense.record',
      targetId: 'expense-1',
      purpose: 'expense.receipt.primary',
      linkedByUserId: 'user-1',
    }), /personal signature image cannot be attached/);
    assert.equal(expenseRecord.findFirst.mock.callCount(), 0);
    assert.equal(attachmentLink.create.mock.callCount(), 0);
  });
});

describe('PrismaAttachmentRepository wet-signed scan retention (R11)', () => {
  it('holds the hand-signed scan from the moment it is linked, while the evidence is still PREPARED', async () => {
    const { repo, expenseSubstituteReceiptEvidence } = makeRepo({ wetSignedScan: { id: 'evidence-1' } });

    // PREPARED is the only state a scan can be linked in, and it is exactly where the old hold had
    // a hole: deleting the photograph there erases the only copy of the ink and strands a document
    // that can then never be certified.
    assert.equal(await repo.findSubstituteEvidenceRetentionHold({ companyId: 'co-1', id: 'att-scan' }), 'SUBSTITUTE_ARTIFACT');
    const where = (expenseSubstituteReceiptEvidence.findFirst.mock.calls as any[])[0]?.arguments[0].where;
    assert.equal(where.wetSignedScanAttachmentId, 'att-scan');
    assert.deepEqual(where.status.in, ['PREPARED', 'PAYER_CERTIFIED', 'ISSUED', 'SUPERSEDED']);
  });

  it('leaves every other attachment to the existing holds', async () => {
    const { repo } = makeRepo({ wetSignedScan: null });
    assert.equal(await repo.findSubstituteEvidenceRetentionHold({ companyId: 'co-1', id: 'att-other' }), null);
  });
});
