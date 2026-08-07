import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';

type EvidenceRef = {
  attachmentId?: string | null;
  linkedExpenseId?: string | null;
};

@Injectable()
export class ReimbursementEvidenceService {
  constructor(
    private readonly attachments: PrismaAttachmentRepository,
    private readonly expenses: PrismaExpenseRepository,
  ) {}

  // Evidence must belong to the request's REQUESTER, not the caller — finance may
  // update/submit on the requester's behalf without owning the receipt. Applied
  // per line: one bad row fails the whole claim.
  async validate(ctx: RequestContext, requesterUserId: string, refs: readonly EvidenceRef[]): Promise<void> {
    for (const ref of refs) {
      if (ref.attachmentId !== undefined && ref.attachmentId !== null) {
        const attachment = await this.attachments.findById({ id: ref.attachmentId, companyId: ctx.companyId });
        if (
          !attachment
          || attachment.companyId !== ctx.companyId
          || attachment.status !== 'ACTIVE'
          || attachment.uploadedByUserId !== requesterUserId
        ) {
          throw new UnprocessableEntityException('invalid_primary_attachment');
        }
      }

      if (ref.linkedExpenseId !== undefined && ref.linkedExpenseId !== null) {
        const expense = await this.expenses.findById(ctx.companyId, ref.linkedExpenseId);
        if (!expense || expense.companyId !== ctx.companyId || expense.createdByUserId !== requesterUserId) {
          throw new UnprocessableEntityException('invalid_linked_expense');
        }
      }
    }
  }

  async getAttachmentFileName(companyId: string, attachmentId?: string): Promise<string | undefined> {
    if (!attachmentId) return undefined;
    return (await this.attachments.findById({ id: attachmentId, companyId }))?.originalFileName;
  }

  /** File names for the lines of one claim (≤50 ids) in a single query. */
  async getAttachmentFileNames(companyId: string, attachmentIds: readonly string[]): Promise<Record<string, string>> {
    const ids = [...new Set(attachmentIds.filter(Boolean))];
    if (ids.length === 0) return {};
    const rows = await this.attachments.findManyByIds({ companyId, ids });
    return Object.fromEntries(rows.map((row) => [row.id, row.originalFileName]));
  }
}
