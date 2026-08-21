import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PrismaReimbursementRepository } from './prisma-reimbursement.repository';

const attachment = {
  id: 'att-saved', bucket: 'private', objectKey: 'signatures/att-saved', objectVersionId: null,
  mimeType: 'image/png', byteSize: 123, checksumSha256: null,
};

describe('PrismaReimbursementRepository saved claim signatures', () => {
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
