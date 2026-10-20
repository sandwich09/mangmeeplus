import { WHT_EXTERNAL_FILE } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../../generated/prisma/client';
import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaAttachmentRepository } from '../../infrastructure/repositories/prisma-attachment.repository';
import type { AttachmentLinkRecord } from '../../domain/models/attachment.model';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { AuditService } from '../../../audit/application/audit.service';
import { isAllowedAttachmentTarget } from '../../domain/logic/attachment.logic';

export type LinkAttachmentCommand = {
  attachmentId: string;
  targetType: string;
  targetId: string;
  purpose: string;
};

function canLinkExpense(ctx: RequestContext): boolean {
  return ['expense.update', 'expense.review', 'expense.receipt.upload', 'expense.payment.record']
    .some((permission) => ctx.permissions.includes(permission));
}

function canLinkAccountingDocument(ctx: RequestContext): boolean {
  const allowed = new Set([
    'accounting.document.create', 'accounting.document.update',
    'accounting.quotation.create', 'accounting.quotation.update',
    'accounting.invoice.create', 'accounting.invoice.update',
    'accounting.billing_note.create', 'accounting.billing_note.update',
    'accounting.receipt.create', 'accounting.receipt.update',
    'accounting.credit_note.create', 'accounting.credit_note.update',
    'accounting.debit_note.create', 'accounting.debit_note.update',
  ]);
  return ctx.permissions.some((permission) => allowed.has(permission));
}

@Injectable()
export class LinkAttachmentUseCase {
  constructor(
    private readonly attachments: PrismaAttachmentRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, cmd: LinkAttachmentCommand, tx?: Prisma.TransactionClient): Promise<AttachmentLinkRecord> {
    const validTarget = isAllowedAttachmentTarget(cmd.targetType, cmd.purpose)
      && typeof cmd.targetId === 'string'
      && cmd.targetId.length > 0
      && cmd.targetId.length <= 200;
    const canMutateTarget = cmd.targetType === 'expense.record'
      ? canLinkExpense(ctx)
      : cmd.targetType === 'accounting.document' && canLinkAccountingDocument(ctx);
    if (!ctx.permissions.includes('attachment.create') || !validTarget || !canMutateTarget) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'attachment.link.create', targetType: 'attachment', targetId: cmd.attachmentId,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'MEDIUM',
        metadataJson: { requestedTargetType: cmd.targetType, requestedPurpose: cmd.purpose },
      });
      throw new ForbiddenException('Attachment target or purpose is not permitted.');
    }

    const existing = await this.attachments.findById({ id: cmd.attachmentId, companyId: ctx.companyId }, tx);
    if (!existing) throw new NotFoundException('Attachment not found.');
    if (existing.metadataJson?.['generatedFor'] === WHT_EXTERNAL_FILE.target) throw new ForbiddenException({ code: 'wht_external_file_retained', message: WHT_EXTERNAL_FILE.retained });
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException('Attachment must be ACTIVE to link.');
    }

    const link = await this.attachments.linkToTarget({
      companyId: ctx.companyId,
      branchIds: ctx.scopes.branchIds,
      attachmentId: cmd.attachmentId,
      targetType: cmd.targetType,
      targetId: cmd.targetId,
      purpose: cmd.purpose,
      linkedByUserId: ctx.userId,
      targetOwnerUserId: cmd.targetType === 'expense.record'
        && ctx.permissions.some((permission) => ['expense.review', 'expense.payment.record'].includes(permission))
        ? undefined
        : ctx.userId,
    }, tx);

    const logged = this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'attachment.link.create', targetType: 'attachment', targetId: cmd.attachmentId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    }, tx);
    if (tx) await logged;

    return link;
  }
}
