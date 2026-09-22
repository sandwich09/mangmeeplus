import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UpdateCompanyTaxSignatureUseCase } from './update-company-tax-signature.use-case';

const ctx: any = { companyId: 'company-1', userId: 'owner-1', requestId: 'req-1' };

function harness(options: { attachment?: any } = {}) {
  const profiles = new Map<string, any>();
  const links: any[] = [];
  const audits: any[] = [];
  const taxRepo: any = {
    prisma: { client: {
      companyTaxProfile: {
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
    findById: async () => (options.attachment !== undefined ? options.attachment : { id: 'att-1', status: 'ACTIVE', mimeType: 'image/png' }),
  };
  const audit: any = { log: async (entry: any) => { audits.push(entry); } };
  return { profiles, links, audits, useCase: new UpdateCompanyTaxSignatureUseCase(taxRepo, attachments, audit) };
}

describe('UpdateCompanyTaxSignatureUseCase', () => {
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
