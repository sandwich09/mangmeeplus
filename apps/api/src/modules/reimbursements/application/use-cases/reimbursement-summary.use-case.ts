import { Injectable, ForbiddenException } from '@nestjs/common';
import type { RequestContext, ReimbursementAiSummary } from '@watchdog-bms/contracts';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { effectivePolicy } from '../../domain/reimbursement.constants';
import { ageHours, isSlaRisk, d, decStr } from '../../domain/logic/reimbursement.logic';

/**
 * Read-only summary for LINE/AI. Enforces the same permissions as web and can never
 * mutate. Callers with only reimbursement.read_own are scoped to their own requests.
 */
@Injectable()
export class GetReimbursementAiSummaryUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext): Promise<ReimbursementAiSummary> {
    const canReadAll = ctx.permissions.includes('reimbursement.read');
    const canReadOwn = ctx.permissions.includes('reimbursement.read_own');
    const canReadRelated = ctx.permissions.includes('reimbursement.read_related');
    if (!canReadAll && !canReadOwn && !canReadRelated) throw new ForbiddenException('Missing permission to read reimbursements');

    const requesterUserId = canReadAll || canReadRelated ? undefined : ctx.userId;
    const relatedUserId = !canReadAll && canReadRelated ? ctx.userId : undefined;
    const policy = effectivePolicy(await this.repo.findPolicy(ctx.companyId, null));
    const all = await this.repo.listRequests({
      companyId: ctx.companyId,
      requesterUserId,
      relatedUserId,
      scopes: ctx.scopes ?? {},
    });
    const now = new Date();

    let pendingApproval = 0;
    let overdueApproval = 0;
    let unpaidApproved = 0;
    let totalUnpaid = d('0');

    for (const r of all) {
      if (r.status === 'PENDING_APPROVAL') {
        pendingApproval++;
        const age = r.submittedAt ? ageHours(r.submittedAt, now) : 0;
        if (isSlaRisk(age, policy.slaHours)) overdueApproval++;
      }
      if ((r.status === 'FINANCE_REVIEW' || r.status === 'READY_FOR_PAYMENT' || r.status === 'PARTIALLY_PAID') && r.paymentStatus !== 'PAID') {
        unpaidApproved++;
        totalUnpaid = totalUnpaid.add(d(r.outstandingAmount));
      }
    }

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.ai_tool.read',
      targetType: 'reimbursement_summary', requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    });

    return {
      pendingApprovalCount: pendingApproval,
      unpaidApprovedCount: unpaidApproved,
      overdueApprovalCount: overdueApproval,
      totalUnpaidAmount: decStr(totalUnpaid),
    };
  }
}
