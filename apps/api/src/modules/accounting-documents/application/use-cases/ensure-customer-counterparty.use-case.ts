import { Injectable } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaAccountingRepository } from '../../infrastructure/prisma-accounting.repository';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { isSalesDocumentLaunchClosedError, rethrowSalesDocumentRootError } from '../sales-document-launch-gate';

@Injectable()
export class EnsureCustomerCounterpartyUseCase {
  constructor(
    private readonly repo: PrismaAccountingRepository,
    private readonly audit: AuditService,
    private readonly launchGate: LaunchGateGuardService,
  ) {}

  // Creates a CUSTOMER counterparty as a system side-effect of an already-authorized sales-document
  // flow. Intentionally NOT gated on accounting.counterparty.manage (owner-approved). Audited as a
  // system-initiated CRM auto-link. Caller guarantees the customer has no counterparty yet.
  async execute(ctx: RequestContext, input: { displayName: string; crmCustomerId: string }): Promise<{ id: string }> {
    let cp;
    try {
      cp = await this.repo.createCounterparty({
        companyId: ctx.companyId,
        type: 'CUSTOMER',
        displayName: input.displayName,
        createdByUserId: ctx.userId,
      }, (db) => this.launchGate.assertLaunchRouteOpenInTransaction(db, 'sales_documents', 'DEFAULT'));
    } catch (error) {
      if (isSalesDocumentLaunchClosedError(error)) {
        await rethrowSalesDocumentRootError(error, this.audit, ctx, 'accounting.counterparty.create');
      }
      throw error;
    }

    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'accounting.counterparty.create',
      targetType: 'accounting_counterparty',
      targetId: cp.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: { source: 'crm_auto_link', crmCustomerId: input.crmCustomerId },
    });

    return { id: cp.id };
  }
}
