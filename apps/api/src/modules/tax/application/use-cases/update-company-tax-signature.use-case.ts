import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { CreateDownloadUrlUseCase } from '../../../data-model-core/application/use-cases/create-download-url.use-case';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';

export type UpdateCompanyTaxSignatureInput = {
  signatureMode: 'BLANK' | 'AUTO_STAMP';
  signatureAttachmentId?: string;
};

export type CompanyTaxSignatureSetting = { signatureMode: 'BLANK' | 'AUTO_STAMP'; signatureImageAttachmentId: string | null };

const TARGET_TYPE = 'company.tax_signature';
const PURPOSE = 'company.tax_signature.image';

/**
 * WHT certificate system issuance plan §3.3 (Decision B): a company's authorized-signatory
 * signature for the 50 ทวิ PDF. Gated at the controller by `company.tax_signature.manage`
 * (OWNER-only) — a different, narrower permission than `wht.certificate.issue` (issuing a
 * certificate). Upload/complete themselves reuse the existing generic
 * `companies/:companyId/attachments/{upload-intent,:id/complete}` endpoints — no new upload
 * plumbing needed here, only the linking + the company-setting write.
 */
@Injectable()
export class UpdateCompanyTaxSignatureUseCase {
  constructor(
    private readonly taxRepo: PrismaTaxRepository,
    private readonly attachments: PrismaAttachmentRepository,
    private readonly audit: AuditService,
    private readonly downloads: CreateDownloadUrlUseCase,
  ) {}

  async read(ctx: RequestContext): Promise<CompanyTaxSignatureSetting & { signatureImageUrl: string | null; signatureStoredAt: string | null }> {
    if (!ctx.permissions.includes('company.tax_signature.manage')) throw new ForbiddenException();
    const profile = await this.taxRepo.prisma.client.companyTaxProfile.findUnique({
      where: { companyId: ctx.companyId }, select: { signatureMode: true, signatureImageAttachmentId: true },
    });
    const setting: CompanyTaxSignatureSetting = { signatureMode: profile?.signatureMode as 'BLANK' | 'AUTO_STAMP' ?? 'BLANK', signatureImageAttachmentId: profile?.signatureImageAttachmentId ?? null };
    const attachment = setting.signatureImageAttachmentId ? await this.attachments.findById({ id: setting.signatureImageAttachmentId, companyId: ctx.companyId }) : null;
    if (!attachment || attachment.status !== 'ACTIVE' || !['image/png', 'image/jpeg'].includes(attachment.mimeType)) return { ...setting, signatureImageUrl: null, signatureStoredAt: null };
    const download = await this.downloads.execute(ctx, { attachmentId: attachment.id, disposition: 'inline' });
    return { ...setting, signatureImageUrl: download.downloadUrl, signatureStoredAt: (attachment.uploadedAt ?? attachment.createdAt).toISOString() };
  }

  async execute(ctx: RequestContext, input: UpdateCompanyTaxSignatureInput): Promise<CompanyTaxSignatureSetting> {
    if (input.signatureMode !== 'BLANK' && input.signatureMode !== 'AUTO_STAMP') {
      throw new BadRequestException('signatureMode must be BLANK or AUTO_STAMP.');
    }
    if (input.signatureMode === 'AUTO_STAMP' && !input.signatureAttachmentId) {
      throw new BadRequestException({ code: 'wht_signature_attachment_required', message: 'ยังไม่มีรูปลายเซ็น อัปโหลดรูปลายเซ็นก่อนเปิดใช้การประทับอัตโนมัติ' });
    }

    // BLANK always clears the reference — never a stale image a later re-enable would silently
    // reuse without the operator picking it again.
    let signatureImageAttachmentId: string | null = null;
    if (input.signatureMode === 'AUTO_STAMP') {
      const attachment = await this.attachments.findById({ id: input.signatureAttachmentId!, companyId: ctx.companyId });
      if (!attachment || attachment.status !== 'ACTIVE') throw new NotFoundException('Signature attachment not found.');
      // Same two formats the personal signature library already accepts (`InitSignatureUploadUseCase`)
      // — the only two the PDF's `<image>` can embed without a re-encode.
      if (attachment.mimeType !== 'image/png' && attachment.mimeType !== 'image/jpeg') {
        throw new BadRequestException('Signature image must be a PNG or JPEG file.');
      }
      await this.taxRepo.linkAttachmentToTarget(attachment.id, TARGET_TYPE, ctx.companyId, PURPOSE, ctx.companyId, ctx.userId);
      signatureImageAttachmentId = attachment.id;
    }

    const row = await this.taxRepo.prisma.client.companyTaxProfile.upsert({
      where: { companyId: ctx.companyId },
      update: { signatureMode: input.signatureMode, signatureImageAttachmentId, updatedByUserId: ctx.userId },
      create: { companyId: ctx.companyId, signatureMode: input.signatureMode, signatureImageAttachmentId, updatedByUserId: ctx.userId },
    });

    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'company.tax_signature.manage',
      targetType: 'company_tax_profile',
      targetId: ctx.companyId,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: { signatureMode: input.signatureMode, hasAttachment: Boolean(signatureImageAttachmentId) },
    });

    return { signatureMode: row.signatureMode as 'BLANK' | 'AUTO_STAMP', signatureImageAttachmentId: row.signatureImageAttachmentId ?? null };
  }
}
