import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UpdateCompanyTaxSignatureUseCase } from './update-company-tax-signature.use-case';

const ctx: any = { companyId: 'company-1', userId: 'owner-1', requestId: 'req-1', permissions: ['company.tax_signature.manage', 'attachment.read'] };

function harness(options: { attachment?: any } = {}) {
  const profiles = new Map<string, any>();
  const links: any[] = [];
  const audits: any[] = [];
  const taxRepo: any = {
    prisma: { client: {
      companyTaxProfile: {
        findUnique: async ({ where }: any) => profiles.get(where.companyId) ?? null,
        upsert: async ({ where, update, create }: any) => {
          const existing = profiles.get(where.companyId);
          const row = existing ? { ...existing, ...update } : { companyId: where.companyId, ...create };
          profiles.set(where.companyId, row);
          return row;
        },
      },
    } },
    linkAttachmentToTarget: async (attachmentId: string, targetType: string, targetId: string, purpose: string, companyId: string, actorUserId: string) => {
      links.push({ attachmentId, targetType, targetId, purpose, companyId, actorUserId });
    },
  };
  const attachments: any = {
    findById: async ({ companyId }: any) => {
      assert.equal(companyId, ctx.companyId);
      return options.attachment !== undefined ? options.attachment : { id: 'att-1', status: 'ACTIVE', mimeType: 'image/png', uploadedAt: new Date('2026-10-12T04:00:00Z') };
    },
  };
  const audit: any = { log: async (entry: any) => { audits.push(entry); } };
  const downloads: any[] = [];
  const download: any = { execute: async (caller: any, command: any) => {
    assert.equal(caller, ctx); downloads.push(command);
    return { downloadUrl: '/signed/signature', expiresAt: new Date('2026-10-13T04:00:00Z') };
  } };
  return { profiles, links, audits, downloads, useCase: new (UpdateCompanyTaxSignatureUseCase as any)(taxRepo, attachments, audit, download) as UpdateCompanyTaxSignatureUseCase };
}

describe('UpdateCompanyTaxSignatureUseCase', () => {
  it('reads the stored active image through the permission-checked inline download and its upload date', async () => {
    const h = harness();
    h.profiles.set(ctx.companyId, { signatureMode: 'AUTO_STAMP', signatureImageAttachmentId: 'att-1' });
    const result = await (h.useCase as any).read(ctx);
    assert.equal(result.signatureImageUrl, '/signed/signature');
    assert.equal(result.signatureStoredAt, '2026-10-12T04:00:00.000Z');
    assert.deepEqual(h.downloads, [{ attachmentId: 'att-1', disposition: 'inline' }]);
  });

  it('denies signature picture reads without the page permission before loading its profile', async () => {
    const h = harness();
    await assert.rejects(() => (h.useCase as any).read({ ...ctx, permissions: ['tax.profile.manage', 'attachment.read'] }), ForbiddenException);
    assert.equal(h.downloads.length, 0);
  });

  it('returns no picture for absent, missing or inactive signature attachments without downloading them', async () => {
    const absent = harness();
    assert.deepEqual(await (absent.useCase as any).read(ctx), { signatureMode: 'BLANK', signatureImageAttachmentId: null, signatureImageUrl: null, signatureStoredAt: null });
    for (const attachment of [null, { id: 'att-1', status: 'DELETED', mimeType: 'image/png' }]) {
      const h = harness({ attachment });
      h.profiles.set(ctx.companyId, { signatureMode: 'AUTO_STAMP', signatureImageAttachmentId: 'att-1' });
      assert.equal((await (h.useCase as any).read(ctx)).signatureImageUrl, null);
      assert.equal(h.downloads.length, 0);
    }
  });
  it('hand-sign saving removes the readable picture and never silently restores it', async () => {
    const h = harness();
    h.profiles.set(ctx.companyId, { signatureMode: 'AUTO_STAMP', signatureImageAttachmentId: 'att-1' });
    await h.useCase.execute(ctx, { signatureMode: 'BLANK' });
    assert.equal((await h.useCase.read(ctx)).signatureImageUrl, null);
    assert.equal(h.downloads.length, 0);
    await assert.rejects(() => h.useCase.execute(ctx, { signatureMode: 'AUTO_STAMP' }), BadRequestException);
  });

  it('requires signatureAttachmentId for AUTO_STAMP', async () => {
    const h = harness();
    await assert.rejects(() => h.useCase.execute(ctx, { signatureMode: 'AUTO_STAMP' }), BadRequestException);
    assert.equal(h.links.length, 0);
  });

  it('does not require an attachment for BLANK, and always clears any stored reference', async () => {
    const h = harness();
    h.profiles.set('company-1', { companyId: 'company-1', signatureMode: 'AUTO_STAMP', signatureImageAttachmentId: 'att-old' });
    const result = await h.useCase.execute(ctx, { signatureMode: 'BLANK', signatureAttachmentId: 'att-1' });
    assert.equal(result.signatureMode, 'BLANK');
    assert.equal(result.signatureImageAttachmentId, null, 'BLANK never keeps a stale reference');
    assert.equal(h.links.length, 0, 'BLANK never links anything');
  });

  it('links the attachment and persists AUTO_STAMP when given a valid PNG/JPEG attachment', async () => {
    const h = harness();
    const result = await h.useCase.execute(ctx, { signatureMode: 'AUTO_STAMP', signatureAttachmentId: 'att-1' });
    assert.equal(result.signatureMode, 'AUTO_STAMP');
    assert.equal(result.signatureImageAttachmentId, 'att-1');
    assert.equal(h.links.length, 1);
    assert.equal(h.links[0].targetType, 'company.tax_signature');
    assert.equal(h.links[0].targetId, 'company-1');
    assert.ok(h.audits.some((entry) => entry.action === 'company.tax_signature.manage' && entry.riskLevel === 'HIGH'));
  });

  it('refuses an attachment that is not ACTIVE', async () => {
    const h = harness({ attachment: { id: 'att-1', status: 'PENDING_UPLOAD', mimeType: 'image/png' } });
    await assert.rejects(() => h.useCase.execute(ctx, { signatureMode: 'AUTO_STAMP', signatureAttachmentId: 'att-1' }), NotFoundException);
  });

  it('refuses a missing attachment', async () => {
    const h = harness({ attachment: null });
    await assert.rejects(() => h.useCase.execute(ctx, { signatureMode: 'AUTO_STAMP', signatureAttachmentId: 'att-1' }), NotFoundException);
  });

  it('refuses a non-PNG/JPEG attachment — the PDF cannot embed anything else', async () => {
    const h = harness({ attachment: { id: 'att-1', status: 'ACTIVE', mimeType: 'application/pdf' } });
    await assert.rejects(() => h.useCase.execute(ctx, { signatureMode: 'AUTO_STAMP', signatureAttachmentId: 'att-1' }), BadRequestException);
    assert.equal(h.links.length, 0);
  });

  it('rejects an invalid signatureMode outright', async () => {
    const h = harness();
    await assert.rejects(() => h.useCase.execute(ctx, { signatureMode: 'STAMP' as any }), BadRequestException);
  });
});
