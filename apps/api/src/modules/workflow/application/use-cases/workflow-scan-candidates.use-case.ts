import { Injectable } from '@nestjs/common';
import { PrismaReimbursementRepository } from '../../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { ageHours, approvalWaitStartedAt, claimPaymentDuplicateBlock, canTransition, isSlaRisk, payoutCorrectionPhase } from '../../../reimbursements/domain/logic/reimbursement.logic';
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
      case 'reimbursement_duplicate_sla_breach':
        return this.duplicateSlaBreach(companyId, now);
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
    // Not a claim sent back to have its payout account corrected and still with its requester (payout
    // spec §14.7): it is PENDING_APPROVAL with no step open, and no approver is late with it. Nor a
    // claim being cancelled: the approve and reject calls refuse it until that is finished or withdrawn.
    const rows = (await this.reimbursementRepo.listRequests({ companyId, status: 'PENDING_APPROVAL' }))
      .filter((request) => payoutCorrectionPhase(request) !== 'AWAITING_REQUESTER' && !request.cancellationPendingAt);
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
      // The claim's approvers who can still act: the people frozen on its step or, for a step from before
      // they were, today's route of its role. The shop owner only when there is none of them (owner
      // decision 2026-10-02): the reminder names these people and nobody else.
      const approvers = frozenRecipients ?? legacyRoute?.recipientUserIds ?? [];
      const recipients = approvers.length > 0 ? approvers : ownerRecipients[index]!;
      const snapshot = parseReimbursementPolicySnapshot(r.approvalPolicySnapshotJson);
      const taskRole = frozenRecipients === undefined
        ? legacyRoute?.effectiveTaskRole ?? step?.approverRoleSnapshot ?? inputs[index]!.roleKey
        : frozenRecipients.length > 0
          ? snapshot?.route?.effectiveTaskRole ?? step?.approverRoleSnapshot ?? inputs[index]!.roleKey
          : 'OWNER';
      // Since the claim was sent; for a corrected payout account, since that account was given.
      const waitingSince = approvalWaitStartedAt(r);
      const age = waitingSince ? ageHours(waitingSince, now) : 0;
      return {
        sourceType: 'reimbursement_request',
        sourceId: r.id,
        payload: {
          requestId: r.id, requestNo: r.requestNo, ageHours: age,
          slaRisk: isSlaRisk(age, policy.slaHours), amount: r.amount, currency: r.currency,
          approverRecipientUserIds: recipients,
          approverTaskUserId: recipients[0],
          // Not read by the notice any more. Kept for a rule pinned before, or edited to name the owner.
          ownerRecipientUserIds: ownerRecipients[index],
          approverTaskRole: taskRole,
          // One reminder per round the claim was sent in (review M1): the scan comes round every
          // window and must not nag, and a claim sent again and late again is reminded again. A
          // corrected payout account waiting too long is a round of its own.
          ...(waitingSince && { notificationPeriodKey: `round:${waitingSince.toISOString()}` }),
        },
      };
    });
  }

  // One reminder per confirmed-block period, starting at its first own receipt confirmation.
  private async duplicateSlaBreach(companyId: string, now: Date): Promise<ScanCandidate[]> {
    const currentPolicy = effectivePolicy(await this.reimbursementRepo.findPolicy(companyId, null));
    const claims = await this.reimbursementRepo.listRequests({ companyId, statuses: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT'] });
    const items: ScanCandidate[] = [];
    // ponytail: one shared facts read per open claim in the company; batch the same reader if this ceiling grows.
    for (const claim of claims) {
      if (claim.cancellationPendingAt || !canTransition(claim.status, 'CANCELLED')) continue;
      try {
        const policy = effectivePolicyForRequest(claim, currentPolicy);
        if (!policy.slaHours || policy.slaHours <= 0) continue;
        const facts = await this.reimbursementRepo.paymentNoticeFactsForRequest(companyId, claim.id);
        if (facts.paymentDuplicateBlock !== 'CONFIRMED' || !facts.confirmedDuplicateAt || ageHours(facts.confirmedDuplicateAt, now) < policy.slaHours) continue;
        items.push({ sourceType: 'reimbursement_request', sourceId: claim.id, payload: {
          requestId: claim.id, requestNo: claim.requestNo, requesterUserId: claim.requesterUserId, status: claim.status, financeReviewerUserId: claim.financeReviewedByUserId,
          actorUserId: facts.confirmedDuplicateActorUserId, slaRisk: true, notificationPeriodKey: facts.confirmedDuplicateAt.toISOString(),
        } });
      } catch {
        // An unreadable legacy snapshot must not stop reminders for the company's other claims.
        continue;
      }
    }
    return items;
  }

  // Audit B9: claims waiting for payment, held to the same policy deadline as approvals. The clock
  // starts when the claim became payable: the finance decision when there was one, else the
  // approval; again when a recorded payment is taken back; and again when a corrected payout
  // account is approved, which is the later of the two dates.
  private async paymentSlaBreach(companyId: string, now: Date): Promise<ScanCandidate[]> {
    const currentPolicy = effectivePolicy(await this.reimbursementRepo.findPolicy(companyId, null));
    const waiting = await this.reimbursementRepo.listRequests({ companyId, statuses: ['READY_FOR_PAYMENT', 'PARTIALLY_PAID'], withDuplicateCandidates: true });
    // Only claims that have a deadline are looked at, and only those past it are offered. Offering
    // every waiting claim wrote a skipped run row per claim per hour in every company, deadline or
    // not; a company that set none now costs one query and nothing else.
    const rows = waiting.flatMap((r) => {
      // A claim being cancelled takes no payment until that is finished or withdrawn: nobody is late with it.
      if (r.cancellationPendingAt) return [];
      try {
        const slaHours = effectivePolicyForRequest(r, currentPolicy).slaHours;
        const paymentDuplicateBlock = claimPaymentDuplicateBlock(r, currentPolicy);
        return paymentDuplicateBlock !== 'CONFIRMED' && slaHours && slaHours > 0 ? [{ ...r, slaHours, paymentDuplicateBlock }] : [];
      } catch {
        // A policy snapshot that cannot be read costs this one claim its reminder. Left to throw,
        // it stopped the reminders of every other claim in the company, every scan.
        return [];
      }
    });
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const approvers = await this.workflowRepo.findClaimApprovers(companyId, ids);
    const lastVoids = await this.workflowRepo.findClaimLastPaymentVoids(companyId, ids);
    const candidates: ScanCandidate[] = [];
    for (const r of rows) {
      const becamePayable = [r.financeReviewedAt, r.approvedAt].filter((at): at is Date => !!at)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? r.submittedAt;
      const lastVoid = lastVoids.get(r.id);
      const payableSince = lastVoid && (!becamePayable || lastVoid > becamePayable) ? lastVoid : becamePayable;
      const age = payableSince ? ageHours(payableSince, now) : 0;
      if (!isSlaRisk(age, r.slaHours)) continue;
      const approver = approvers.get(r.id);
      // The round test of `isReimbursementClaimApprover` (contracts), over the steps that
      // `findClaimApprovers` already held to its step conditions: no submission in force, no approver.
      const approvedByUserId = approver && r.submittedAt && approver.decidedAt >= r.submittedAt ? approver.userId : undefined;
      const financeReviewerUserId = r.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? r.financeReviewedByUserId : undefined;
      // Nobody passed or approved this claim: it needed no approval. Its ready-to-pay notice asked
      // the people who would have approved it, so its reminder asks the same people, not everyone.
      // ponytail: one route lookup per such overdue claim; batch it if a company ever has many.
      const wouldApprove = financeReviewerUserId || approvedByUserId ? []
        : await this.approverRoutes.resolveWouldBeApproverUserIds(companyId, currentPolicy, r).catch(() => []);
      candidates.push({
        sourceType: 'reimbursement_request',
        sourceId: r.id,
        payload: {
          requestId: r.id, requestNo: r.requestNo, ageHours: age,
          slaRisk: true,
          paymentDuplicateBlock: r.paymentDuplicateBlock,
          // What is left to pay: the whole claim unless a legacy part payment was recorded.
          amount: r.outstandingAmount, currency: r.currency,
          // Whose turn it is to pay, for the notice to prefer (owner rule 2026-10-01): the finance
          // reviewer who passed the claim, else whoever approved it in the round it was last sent
          // in, else the people who would have approved a claim that needed no approval.
          requesterUserId: r.requesterUserId,
          ...(financeReviewerUserId && { financeReviewerUserId }),
          ...(approvedByUserId && { approvedByUserId }),
          ...(wouldApprove.length > 0 && { approverRecipientUserIds: wouldApprove }),
          // One reminder per time the claim became payable (review M1), not one per scan window.
          ...(payableSince && { notificationPeriodKey: `payable:${payableSince.toISOString()}` }),
        },
      });
    }
    return candidates;
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
