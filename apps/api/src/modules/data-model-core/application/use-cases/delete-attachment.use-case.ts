import { isBranchInScope } from '../../domain/logic/branch.logic';
import { WHT_EXTERNAL_FILE } from '@watchdog-bms/contracts';
import { Injectable, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaAttachmentRepository } from '../../infrastructure/repositories/prisma-attachment.repository';
import type { AttachmentRecord } from '../../domain/models/attachment.model';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { AuditService } from '../../../audit/application/audit.service';
import { disbursementVoucherError } from '@watchdog-bms/contracts';

export type DeleteAttachmentCommand = { attachmentId: string };

@Injectable()
export class DeleteAttachmentUseCase {
  constructor(
    private readonly attachments: PrismaAttachmentRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, cmd: DeleteAttachmentCommand): Promise<AttachmentRecord> {
    if (!ctx.permissions.includes('attachment.delete')) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'attachment.delete', targetType: 'attachment', targetId: cmd.attachmentId,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'HIGH',
      });
      throw new ForbiddenException();
    }

    const existing = await this.attachments.findById({ id: cmd.attachmentId, companyId: ctx.companyId });
    if (!existing) throw new NotFoundException('Attachment not found.');
    if (!isBranchInScope(ctx.scopes ?? {}, existing.branchId)) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'attachment.delete', targetType: 'attachment', targetId: cmd.attachmentId,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'HIGH',
      });
      throw new ForbiddenException();
    }
    if (existing.metadataJson?.['generatedFor'] === WHT_EXTERNAL_FILE.target) throw new ForbiddenException({ code: 'wht_external_file_retained', message: WHT_EXTERNAL_FILE.retained });
    if (await this.attachments.isDisbursementVoucherFile({ id: existing.id, companyId: ctx.companyId })) {
      void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'attachment.delete', targetType: 'attachment', targetId: existing.id,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'HIGH', metadataJson: { reason: 'disbursement_voucher_file_retained' } });
      throw new ConflictException(disbursementVoucherError('disbursement_file_retained'));
    }

    const retentionHold = await this.attachments.findSubstituteEvidenceRetentionHold({
      id: cmd.attachmentId,
      companyId: ctx.companyId,
    });
    if (retentionHold) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'attachment.delete', targetType: 'attachment', targetId: cmd.attachmentId,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'HIGH',
        metadataJson: { reason: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED', retentionHold },
      });
      throw new ConflictException({
        code: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED',
        message: 'Attachment is retained as substitute-receipt evidence.',
      });
    }

    // Payment evidence is add-only (spec §12.5). The repository repeats this inside its transaction;
    // refusing here first puts the attempt on the audit trail.
    if (await this.attachments.isReimbursementPaymentSlip({ id: cmd.attachmentId, companyId: ctx.companyId })) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'attachment.delete', targetType: 'attachment', targetId: cmd.attachmentId,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'HIGH',
        metadataJson: { reason: 'reimbursement_payment_slip_retained' },
      });
      throw new ConflictException({
        code: 'reimbursement_payment_slip_retained',
        message: 'Attachment is retained as reimbursement payment evidence.',
      });
    }

    const record = await this.attachments.markDeleted({ id: cmd.attachmentId, companyId: ctx.companyId });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'attachment.delete', targetType: 'attachment', targetId: record.id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
    });

    return record;
  }
}
