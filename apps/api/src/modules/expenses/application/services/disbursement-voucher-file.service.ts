import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DISBURSEMENT_VOUCHER_PDF_PURPOSE, disbursementVoucherError } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort, type PutObjectResult } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { renderDisbursementVoucherSvg, type DisbursementVoucherPrintSnapshot } from '../../domain/logic/disbursement-voucher-pdf.logic';
import { renderSubstituteReceiptPdf } from '../../domain/logic/substitute-receipt-pdf.logic';

@Injectable()
export class DisbursementVoucherFileService {
  constructor(private readonly prisma: PrismaService, @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort) {}

  async render(snapshot: DisbursementVoucherPrintSnapshot) {
    return renderSubstituteReceiptPdf(renderDisbursementVoucherSvg(snapshot, true), snapshot.documentNumber ?? undefined, { omitPageFooter: true });
  }

  /** Called only after the financial transaction commits. A separate file lock serializes
   * rendering and storage across workers/downloads; it never takes an expense or lifecycle lock. */
  async ensure(companyId: string, id: string): Promise<{ data: Buffer; fileName: string }> {
    let stored: PutObjectResult | undefined;
    try {
      return await this.prisma.client.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${id}:disbursement-voucher-file`}))`;
        const voucher = await tx.disbursementVoucher.findFirst({ where: { companyId, id } });
        if (!voucher || !(voucher.status === 'PAID' || voucher.status === 'CANCELLED' && voucher.cancelledAfterPaid) || !voucher.paidSnapshotJson) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
        const fileName = `${voucher.documentNumber}.pdf`;
        if (voucher.pdfAttachmentId) {
          const attachment = await tx.attachmentObject.findFirstOrThrow({ where: { companyId, id: voucher.pdfAttachmentId, status: 'ACTIVE' } });
          const object = await this.storage.getObject({ bucket: attachment.bucket, objectKey: attachment.objectKey, objectVersionId: attachment.objectVersionId ?? undefined });
          if (createHash('sha256').update(object.bytes).digest('hex') !== attachment.checksumSha256) throw new Error('Disbursement voucher file checksum mismatch');
          return { data: object.bytes, fileName };
        }
        const data = await this.render({ ...(voucher.paidSnapshotJson as unknown as DisbursementVoucherPrintSnapshot), snapshotHash: voucher.paidSnapshotHash ?? undefined });
        stored = await this.storage.putObject({ objectKey: `${companyId}/disbursement-vouchers/${id}/${randomUUID()}.pdf`, mimeType: 'application/pdf', bytes: data });
        const attachment = await tx.attachmentObject.create({ data: {
          companyId, branchId: voucher.branchId, storageProvider: stored.storageProvider, bucket: stored.bucket, objectKey: stored.objectKey, objectVersionId: stored.objectVersionId,
          originalFileName: fileName, mimeType: 'application/pdf', byteSize: data.length, checksumSha256: createHash('sha256').update(data).digest('hex'),
          visibility: 'INTERNAL', status: 'ACTIVE', uploadedByUserId: voucher.paidByUserId!, uploadedAt: new Date(),
          metadataJson: { generatedBy: 'disbursement_voucher', snapshotHash: voucher.paidSnapshotHash, templateVersion: voucher.templateVersion },
        } });
        await tx.attachmentLink.create({ data: { companyId, attachmentId: attachment.id, targetType: 'disbursement_voucher', targetId: id,
          purpose: DISBURSEMENT_VOUCHER_PDF_PURPOSE, linkedByUserId: voucher.paidByUserId! } });
        const changed = await tx.disbursementVoucher.updateMany({ where: { companyId, id, pdfAttachmentId: null }, data: { pdfAttachmentId: attachment.id } });
        if (changed.count !== 1) throw new Error('Disbursement voucher file changed');
        return { data, fileName };
      }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 60000 });
    } catch (error) {
      // Delete only this failed attempt's unique object/version; a winner's file is never touched.
      if (stored) await this.storage.deleteObject({ bucket: stored.bucket, objectKey: stored.objectKey, objectVersionId: stored.objectVersionId }).catch(() => undefined);
      throw error;
    }
  }
}
