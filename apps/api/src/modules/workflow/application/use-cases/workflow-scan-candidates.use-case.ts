import { Injectable } from '@nestjs/common';
import { PrismaReimbursementRepository } from '../../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { ageHours, isSlaRisk } from '../../../reimbursements/domain/logic/reimbursement.logic';
import { effectivePolicy } from '../../../reimbursements/domain/reimbursement.constants';
import { PrismaCrmRepository } from '../../../crm/infrastructure/prisma-crm.repository';
import { effectiveFollowUpStatus } from '../../../crm/domain/logic/crm.logic';
import { PrismaBankingRepository } from '../../../banking/infrastructure/prisma-banking.repository';
import { GetCitCalendarUseCase } from '../../../tax/application/use-cases/get-cit-calendar.use-case';
import { GetStockReportUseCase } from '../../../inventory/application/use-cases/movement-query.use-cases';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { systemWorkerContext } from '../../../auth/domain/logic/system-worker-context';

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
  ) {}

  async forTemplate(templateKey: string, companyId: string, now: Date): Promise<ScanCandidate[]> {
    switch (templateKey) {
      case 'low_stock_alert':
        return this.lowStockAlert(companyId);
      case 'approval_sla_breach':
        return this.approvalSlaBreach(companyId, now);
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
    const policy = effectivePolicy(await this.reimbursementRepo.findPolicy(companyId, null));
    const rows = await this.reimbursementRepo.listRequests({ companyId, status: 'PENDING_APPROVAL' });
    return rows.map((r) => {
      const age = r.submittedAt ? ageHours(r.submittedAt, now) : 0;
      return {
        sourceType: 'reimbursement_request',
        sourceId: r.id,
        payload: { requestId: r.id, requestNo: r.requestNo, ageHours: age, slaRisk: isSlaRisk(age, policy.slaHours), amount: r.amount, currency: r.currency },
      };
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
