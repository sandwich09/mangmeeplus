import { Injectable, BadRequestException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  RequestContext,
  CreateCrmQuotationDraftInput,
  CrmQuotationLinkSummary,
  CrmQuotationLinkStatus,
} from '@watchdog-bms/contracts';
import { PrismaCrmRepository } from '../../infrastructure/prisma-crm.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { CreateDocumentUseCase, GetDocumentUseCase } from '../../../accounting-documents/application/use-cases/document.use-case';
import { EnsureCustomerCounterpartyUseCase } from '../../../accounting-documents/application/use-cases/ensure-customer-counterparty.use-case';
import { toQuotationLinkSummary } from '../dto/crm.mapper';
import { requirePermission, assertCanManageOwned, assertCanReadOwned, ownerScopeForList } from '../crm-access';
import { crmCanManageAll } from '../../domain/logic/crm.logic';
import type { AccountingDocumentStatus } from '@watchdog-bms/contracts';

/** Maps an accounting document status onto a CRM quotation-link status. */
export function mapAccountingStatus(status: AccountingDocumentStatus): CrmQuotationLinkStatus {
  switch (status) {
    case 'DRAFT': return 'DRAFT';
    case 'PENDING_APPROVAL': return 'PENDING_APPROVAL';
    case 'APPROVED': return 'APPROVED';
    case 'REJECTED': return 'REJECTED';
    case 'ISSUED': return 'ISSUED';
    case 'VOIDED': return 'VOIDED';
    case 'CLOSED': return 'CONVERTED';
    default: return 'UNKNOWN';
  }
}

@Injectable()
export class ListCrmQuotationLinksUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}

  async execute(ctx: RequestContext, opportunityId: string): Promise<CrmQuotationLinkSummary[]> {
    requirePermission(ctx, 'crm.opportunity.read');
    const o = await this.repo.findOpportunityById(ctx.companyId, opportunityId);
    if (!o) throw new NotFoundException('Opportunity not found');
    assertCanReadOwned(ctx, o.ownerUserId);
    const links = await this.repo.listQuotationLinks(ctx.companyId, opportunityId);
    return links.map(toQuotationLinkSummary);
  }

  /** Customer-360 aggregate, retaining the caller's opportunity owner scope. */
  async executeForCustomer(ctx: RequestContext, customerId: string): Promise<CrmQuotationLinkSummary[]> {
    requirePermission(ctx, 'crm.opportunity.read');
    const links = await this.repo.listQuotationLinksByCustomer(
      ctx.companyId,
      customerId,
      ownerScopeForList(ctx),
    );
    return links.map(toQuotationLinkSummary);
  }
}

@Injectable()
export class CreateCrmQuotationDraftUseCase {
  constructor(
    private readonly repo: PrismaCrmRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly _createDocument: CreateDocumentUseCase,
    private readonly _ensureCounterparty: EnsureCustomerCounterpartyUseCase,
  ) {}

  async execute(ctx: RequestContext, opportunityId: string, input: CreateCrmQuotationDraftInput): Promise<CrmQuotationLinkSummary> {
    // Requires both the CRM link permission and the accounting quotation-create permission.
    requirePermission(ctx, 'crm.quotation.link');
    // spec:333 — a missing capability is 403, never 400.
    if (!ctx.permissions.includes('accounting.quotation.create') && !ctx.permissions.includes('accounting.document.create')) {
      throw new ForbiddenException('Missing permission: accounting.quotation.create');
    }
    const idempotencyKey = input?.idempotencyKey?.trim();
    if (input?.idempotencyKey !== undefined && (!idempotencyKey || idempotencyKey.length > 200)) {
      throw new BadRequestException('invalid_idempotencyKey');
    }
    const o = await this.repo.findOpportunityById(ctx.companyId, opportunityId);
    if (!o) throw new NotFoundException('Opportunity not found');
    assertCanManageOwned(ctx, o.ownerUserId);
    if (o.status !== 'OPEN') throw new UnprocessableEntityException('Only open opportunities can request a quotation');

    // One active quotation draft/link per opportunity unless a revision reason is given.
    const active = await this.repo.findActiveQuotationLink(ctx.companyId, opportunityId);
    if (active) {
      if (!input?.revisionReason || input.revisionReason.trim() === '') {
        return toQuotationLinkSummary(active); // reuse existing active link
      }
    }

    let link;
    try {
      link = await this.repo.createQuotationDraftBundle({
        companyId: ctx.companyId,
        opportunityId,
        expectedCustomerId: o.customerId,
        scope: { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles) },
        userId: ctx.userId,
        requestId: ctx.requestId,
        requestKey: idempotencyKey ?? ctx.requestId,
        allowRevision: Boolean(input?.revisionReason?.trim()),
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code === 'opportunity_not_found') throw new NotFoundException('Opportunity not found');
      if (code === 'opportunity_out_of_scope') throw new UnprocessableEntityException('Opportunity is out of scope');
      if (['opportunity_customer_changed', 'opportunity_status_changed', 'customer_not_active', 'customer_counterparty_changed'].includes(code)) throw new UnprocessableEntityException({ code });
      throw error;
    }

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.quotation.link', targetType: 'crm_quotation_link', targetId: link.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { accountingDocumentId: link.accountingDocumentId, revision: !!input?.revisionReason } });
    void this.outbox.append('crm.opportunity.quotation_linked', 'crm_opportunity', opportunityId, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'crm_opportunity', aggregateId: opportunityId, occurredAt: new Date().toISOString(), data: { accountingDocumentId: link.accountingDocumentId } });
    return toQuotationLinkSummary(link);
  }
}

@Injectable()
export class RefreshCrmQuotationLinkUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly getDocument: GetDocumentUseCase) {}
  async execute(ctx: RequestContext, opportunityId: string, linkId: string): Promise<CrmQuotationLinkSummary> {
    requirePermission(ctx, 'crm.opportunity.read');
    // spec:333 — a missing capability is 403, never 400.
    if (!ctx.permissions.includes('accounting.document.read') && !ctx.permissions.includes('accounting.quotation.read')) {
      throw new ForbiddenException('Missing permission: accounting.quotation.read');
    }
    const o = await this.repo.findOpportunityById(ctx.companyId, opportunityId);
    if (!o) throw new NotFoundException('Opportunity not found');
    assertCanReadOwned(ctx, o.ownerUserId);
    const links = await this.repo.listQuotationLinks(ctx.companyId, opportunityId);
    const link = links.find((l) => l.id === linkId);
    if (!link) throw new NotFoundException('Quotation link not found');

    const doc = await this.getDocument.execute(ctx, link.accountingDocumentId);
    const updated = await this.repo.updateQuotationLink(ctx.companyId, linkId, {
      status: mapAccountingStatus(doc.status),
      accountingDocumentNumber: doc.documentNumber,
      grandTotalAmount: doc.grandTotalAmount,
    });
    return toQuotationLinkSummary(updated);
  }
}
