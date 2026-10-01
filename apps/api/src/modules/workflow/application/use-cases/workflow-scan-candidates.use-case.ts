import { Injectable } from '@nestjs/common';
import { PrismaReimbursementRepository } from '../../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { ageHours, isSlaRisk } from '../../../reimbursements/domain/logic/reimbursement.logic';
import { effectivePolicy, effectivePolicyForRequest, parseReimbursementPolicySnapshot } from '../../../reimbursements/domain/reimbursement.constants';
import { ListReimbursementApproverOptionsUseCase } from '../../../reimbursements/application/use-cases/reimbursement-policy.use-case';
import { PrismaCrmRepository } from '../../../crm/infrastructure/prisma-crm.repository';
import { effectiveFollowUpStatus } from '../../../crm/domain/logic/crm.logic';
import { PrismaBankingRepository } from '../../../banking/infrastructure/prisma-banking.repository';
import { GetCitCalendarUseCase } from '../../../tax/application/use-cases/get-cit-calendar.use-case';
import { GetStockReportUseCase } from '../../../inventory/application/use-cases/movement-query.use-cases';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { systemWorkerContext } from '../../../auth/domain/logic/system-worker-context';
import type { ReimbursementRequestRecord } from '../../../reimbursements/domain/models/reimbursement.model';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';

export type ScanCandidate = {
  sourceType: string;
  sourceId: string;
  payload: Record<string, unknown>;
};

function systemCtx(companyId: string): RequestContext {
  // H-14: least-privilege system context — no synthesized OWNER role.
  return systemWorkerContext({
    requestId: `workflow-scan-${companyId}`,
    companyId,
    permissions: ['inventory.report.read'],
    authSubject: 'workflow-scan',
  });
}

function currentApprovalStep(request: ReimbursementRequestRecord) {
  return request.approvalSteps?.find((step) => step.id === request.currentApprovalStepId);
}

// One adapter per scannable template key. Each returns the current candidate items for a
// company — the caller (RunWorkflowScanUseCase) evaluates each rule's own condition against
// every candidate's payload, so thresholds stay admin-configurable rather than hardcoded here.
@Injectable()
export class WorkflowScanCandidatesProvider {
  constructor(
    private readonly reimbursementRepo: PrismaReimbursementRepository,
    private readonly crmRepo: PrismaCrmRepository,
    private readonly bankingRepo: PrismaBankingRepository,
    private readonly citCalendar: GetCitCalendarUseCase,
    private readonly stockReport: GetStockReportUseCase,
    private readonly approverRoutes: ListReimbursementApproverOptionsUseCase,
    private readonly workflowRepo: PrismaWorkflowRepository,
  ) {}

  async forTemplate(templateKey: string, companyId: string, now: Date): Promise<ScanCandidate[]> {
    switch (templateKey) {
      case 'low_stock_alert':
        return this.lowStockAlert(companyId);
      case 'approval_sla_breach':
        return this.approvalSlaBreach(companyId, now);
      case 'reimbursement_payment_sla_breach':
        return this.paymentSlaBreach(companyId, now);
      case 'tax_due_soon':
        return this.taxDueSoon(companyId);
      case 'bank_reconciliation_aging':
        return this.bankReconciliationAging(companyId, now);
      case 'crm_follow_up_due':
        return this.crmFollowUpDue(companyId, now);
      case 'crm_opportunity_stuck':
        return this.crmOpportunityStuck(companyId, now);
      default:
        return [];
    }
  }

  private async lowStockAlert(companyId: string): Promise<ScanCandidate[]> {
    const { items } = await this.stockReport.execute(systemCtx(companyId), { lowStockOnly: true });
    return items.map((b) => ({
      sourceType: 'stock_balance',
      sourceId: b.productId,
      payload: { productId: b.productId, productName: b.productId, quantity: b.quantity },
    }));
  }

  private async approvalSlaBreach(companyId: string, now: Date): Promise<ScanCandidate[]> {
    const currentPolicy = effectivePolicy(await this.reimbursementRepo.findPolicy(companyId, null));
    const rows = await this.reimbursementRepo.listRequests({ companyId, status: 'PENDING_APPROVAL' });
    const inputs = rows.map((request) => {
      const requestPolicy = effectivePolicyForRequest(request, currentPolicy);
      return {
        roleKey: requestPolicy.defaultApproverRole ?? 'MANAGER',
        ...(request.branchId && { branchId: request.branchId }),
        requesterUserId: request.requesterUserId,
        allowSelfApproval: requestPolicy.allowSelfApproval,
      };
    });
    const frozenIdsByBranch = new Map<string, string[]>();
    for (const request of rows) {
      const key = request.branchId ?? '';
      frozenIdsByBranch.set(key, [
        ...(frozenIdsByBranch.get(key) ?? []),
        ...(currentApprovalStep(request)?.assignedApproverUserIds ?? []),
      ]);
    }
    const activeFrozenByBranch = new Map(await Promise.all(
      [...frozenIdsByBranch].map(async ([key, userIds]) => [
        key,
        await this.reimbursementRepo.findActiveApproverUserIds(companyId, userIds, key || undefined),
      ] as const),
    ));
    const ownerRecipients = await this.approverRoutes.resolveOwnerRecipientUserIds(companyId, inputs);
    const legacyIndexes = rows.flatMap((request, index) => (
      currentApprovalStep(request)?.assignedApproverUserIds === undefined ? [index] : []
    ));
    const legacyRoutes = await this.approverRoutes.resolveSubmissionRoutesBestEffort(
      companyId,
      legacyIndexes.map((index) => inputs[index]!),
    );
    const legacyRouteByIndex = new Map(legacyIndexes.map((index, routeIndex) => [index, legacyRoutes[routeIndex]!]));
    return rows.map((r, index) => {
      const policy = effectivePolicyForRequest(r, currentPolicy);
      const step = currentApprovalStep(r);
      const activeFrozenAssignees = activeFrozenByBranch.get(r.branchId ?? '') ?? new Set<string>();
      const frozenRecipients = step?.assignedApproverUserIds?.filter((userId) => activeFrozenAssignees.has(userId));
      const legacyRoute = legacyRouteByIndex.get(index);
      const recipients = frozenRecipients === undefined
        ? legacyRoute?.recipientUserIds ?? []
        : frozenRecipients.length > 0 ? frozenRecipients : ownerRecipients[index]!;
      const snapshot = parseReimbursementPolicySnapshot(r.approvalPolicySnapshotJson);
      const taskRole = frozenRecipients === undefined
        ? legacyRoute?.effectiveTaskRole ?? step?.approverRoleSnapshot ?? inputs[index]!.roleKey
        : frozenRecipients.length > 0
          ? snapshot?.route?.effectiveTaskRole ?? step?.approverRoleSnapshot ?? inputs[index]!.roleKey
          : 'OWNER';
      const age = r.submittedAt ? ageHours(r.submittedAt, now) : 0;
      return {
        sourceType: 'reimbursement_request',
        sourceId: r.id,
        payload: {
          requestId: r.id, requestNo: r.requestNo, ageHours: age,
          slaRisk: isSlaRisk(age, policy.slaHours), amount: r.amount, currency: r.currency,
          approverRecipientUserIds: recipients,
          approverTaskUserId: recipients[0],
          ownerRecipientUserIds: ownerRecipients[index],
          approverTaskRole: taskRole,
          // One reminder per round the claim was sent in (review M1): the scan comes round every
          // window and must not nag, and a claim sent again and late again is reminded again.
          ...(r.submittedAt && { notificationPeriodKey: `round:${r.submittedAt.toISOString()}` }),
        },
      };
    });
  }

  // Audit B9: claims waiting for payment, held to the same policy deadline as approvals. The clock
  // starts when the claim became payable: the finance decision when there was one, else the
  // approval, and again when a recorded payment is taken back.
  private async paymentSlaBreach(companyId: string, now: Date): Promise<ScanCandidate[]> {
    const currentPolicy = effectivePolicy(await this.reimbursementRepo.findPolicy(companyId, null));
    const waiting = await this.reimbursementRepo.listRequests({ companyId, statuses: ['READY_FOR_PAYMENT', 'PARTIALLY_PAID'] });
    // Only claims that have a deadline are looked at, and only those past it are offered. Offering
    // every waiting claim wrote a skipped run row per claim per hour in every company, deadline or
    // not; a company that set none now costs one query and nothing else.
    const rows = waiting.flatMap((r) => {
      const slaHours = effectivePolicyForRequest(r, currentPolicy).slaHours;
      return slaHours && slaHours > 0 ? [{ ...r, slaHours }] : [];
    });
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const approvers = await this.workflowRepo.findClaimApprovers(companyId, ids);
    const lastVoids = await this.workflowRepo.findClaimLastPaymentVoids(companyId, ids);
    return rows.flatMap((r) => {
      const becamePayable = r.financeReviewedAt ?? r.approvedAt ?? r.submittedAt;
      const lastVoid = lastVoids.get(r.id);
      const payableSince = lastVoid && (!becamePayable || lastVoid > becamePayable) ? lastVoid : becamePayable;
      const age = payableSince ? ageHours(payableSince, now) : 0;
      if (!isSlaRisk(age, r.slaHours)) return [];
      const approver = approvers.get(r.id);
      return [{
        sourceType: 'reimbursement_request',
        sourceId: r.id,
        payload: {
          requestId: r.id, requestNo: r.requestNo, ageHours: age,
          slaRisk: true,
          // What is left to pay: the whole claim unless a legacy part payment was recorded.
          amount: r.outstandingAmount, currency: r.currency,
          // Whose turn it is to pay, for the notice to prefer (owner rule 2026-10-01): the finance
          // reviewer who passed the claim, else whoever approved it in the round it was last sent
          // in. A claim that needed no approval names nobody, and the notice goes to everyone able.
          requesterUserId: r.requesterUserId,
          ...(r.financeReviewStatus === 'APPROVED_FOR_PAYMENT' && r.financeReviewedByUserId && { financeReviewerUserId: r.financeReviewedByUserId }),
          ...(approver && (!r.submittedAt || approver.decidedAt >= r.submittedAt) && { approvedByUserId: approver.userId }),
          // One reminder per time the claim became payable (review M1), not one per scan window.
          ...(payableSince && { notificationPeriodKey: `payable:${payableSince.toISOString()}` }),
        },
      }];
    });
  }

  private async taxDueSoon(companyId: string): Promise<ScanCandidate[]> {
    const entries = await this.citCalendar.execute(companyId);
    return entries
      .filter((e) => e.dueDate != null)
      .map((e) => ({
        sourceType: 'tax_period',
        sourceId: e.accountingPeriodId ?? e.periodKey,
        payload: { periodKey: e.periodKey, formType: e.formType, dueDate: e.dueDate, status: e.status },
      }));
  }

  private async bankReconciliationAging(companyId: string, now: Date): Promise<ScanCandidate[]> {
    const accounts = await this.bankingRepo.listBankAccounts(companyId);
    const candidates: ScanCandidate[] = [];
    for (const account of accounts) {
      const lines = await this.bankingRepo.listStatementLines(companyId, account.id, 'UNMATCHED');
      for (const line of lines) {
        const ageDays = Math.floor((now.getTime() - line.postedDate.getTime()) / 86_400_000);
        candidates.push({ sourceType: 'bank_statement_line', sourceId: line.id, payload: { lineId: line.id, bankAccountId: account.id, ageDays, description: line.description } });
      }
    }
    return candidates;
  }

  private async crmFollowUpDue(companyId: string, now: Date): Promise<ScanCandidate[]> {
    const rows = await this.crmRepo.listFollowUps({ companyId, status: 'OPEN' });
    return rows.map((f) => ({
      sourceType: 'crm_follow_up',
      sourceId: f.id,
      payload: { followUpId: f.id, title: f.title, customerId: f.customerId, dueAt: f.dueAt.toISOString(), status: effectiveFollowUpStatus(f.status, f.dueAt, now) },
    }));
  }

  private async crmOpportunityStuck(companyId: string, now: Date): Promise<ScanCandidate[]> {
    const rows = await this.crmRepo.listOpportunities({ companyId, status: 'OPEN' });
    return rows.map((o) => {
      const reference = o.lastActivityAt ?? o.updatedAt;
      const daysSinceStageChange = Math.floor((now.getTime() - reference.getTime()) / 86_400_000);
      return {
        sourceType: 'crm_opportunity',
        sourceId: o.id,
        payload: { opportunityId: o.id, opportunityName: o.title, customerId: o.customerId, daysSinceStageChange },
      };
    });
  }
}
