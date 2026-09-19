import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import { requireTransactionBranchId } from '../../../data-model-core/application/services/transaction-branch';

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
  async validate(ctx: RequestContext, requesterUserId: string, refs: readonly EvidenceRef[], branchId: string | null | undefined, retainedAttachmentOwners: ReadonlyMap<string, string> = new Map()): Promise<void> {
    const sourceBranchId = requireTransactionBranchId(branchId);
    for (const ref of refs) {
      if (ref.attachmentId !== undefined && ref.attachmentId !== null) {
        const attachment = await this.attachments.findById({ id: ref.attachmentId, companyId: ctx.companyId });
        if (
          !attachment
          || attachment.companyId !== ctx.companyId
          || attachment.status !== 'ACTIVE'
          || (attachment.uploadedByUserId !== requesterUserId && !ref.linkedExpenseId && retainedAttachmentOwners.get(ref.attachmentId) !== attachment.uploadedByUserId && !(ctx.permissions.includes('reimbursement.finance_review') && attachment.uploadedByUserId === ctx.userId))
        ) {
          throw new UnprocessableEntityException('invalid_primary_attachment');
        }
        this.assertEvidenceBranch(attachment.branchId, sourceBranchId);
      }

      if (ref.linkedExpenseId !== undefined && ref.linkedExpenseId !== null) {
        const expense = await this.expenses.findById(ctx.companyId, ref.linkedExpenseId);
        // `payerUserId` is the server's own record of who paid (capture appendix §5), so it needs
        // no certificate lookup — and the certificate remains the authority when it disagrees.
        const isPayer = expense?.payerUserId === requesterUserId;
        const certificate = expense && !isPayer && expense.createdByUserId !== requesterUserId
          ? await this.expenses.findSubstituteEvidence(ctx.companyId, expense.id) : null;
        if (!expense || expense.companyId !== ctx.companyId
          || (expense.createdByUserId !== requesterUserId && !isPayer && certificate?.payerUserId !== requesterUserId)) {
          throw new UnprocessableEntityException('invalid_linked_expense');
        }
        this.assertEvidenceBranch(expense.branchId, sourceBranchId);
      }
    }
  }

  private assertEvidenceBranch(branchId: string | null | undefined, sourceBranchId: string): void {
    if (branchId !== sourceBranchId) {
      throw new UnprocessableEntityException({
        code: 'REIMBURSEMENT_EVIDENCE_BRANCH_MISMATCH',
        message: 'ใบเสร็จหรือค่าใช้จ่ายต้องระบุสาขาเดียวกับคำขอเบิก',
      });
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
