import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaProcurementRepository } from '../../infrastructure/prisma-procurement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { canTransitionPR } from '../../domain/logic/procurement.logic';
import { civilPeriodKey, PROCUREMENT_SEQUENCE_KEYS, todayCivilDate } from '@watchdog-bms/contracts';
import type { PurchaseRequestRecord } from '../../domain/models/procurement.model';
import { assertProcurementBranchScope, PROCUREMENT_RELATED_READ_PERMISSIONS, resolveProcurementCreateBranch } from './procurement-access';

@Injectable()
export class CreatePurchaseRequestUseCase {
  constructor(
    private readonly repo: PrismaProcurementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, dto: {
    branchId?: string; neededByDate?: Date; supplierId?: string; reason?: string; budgetCode?: string; currency?: string;
    subtotalAmount: string; discountAmount: string; taxableAmount: string; vatAmount: string; whtEstimateAmount?: string; grandTotalAmount: string;
    lines: { lineNumber: number; lineType?: string; productId?: string; description: string; unitName?: string; requestedQuantity: string; estimatedUnitPrice: string; discountAmount: string; vatMode: string; vatRate?: string; vatAmount: string; lineSubtotalAmount: string; lineTotalAmount: string; accountHint?: string; inventoryLocationId?: string }[];
  }): Promise<PurchaseRequestRecord> {
    if (!ctx.permissions.includes('procurement.purchase_request.create')) throw new ForbiddenException();
    const branchId = resolveProcurementCreateBranch(ctx, dto.branchId);
    if (branchId && !await this.repo.branchExists(ctx.companyId, branchId)) throw new BadRequestException('Branch does not exist in this company');
    const pr = await this.repo.createPurchaseRequest(ctx.companyId, { ...dto, branchId }, ctx.userId);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.purchase_request.create', targetType: 'purchase_request', targetId: pr.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
    return pr;
  }
}

@Injectable()
export class GetPurchaseRequestUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, id: string): Promise<PurchaseRequestRecord> {
    const canReadAll = ctx.permissions.includes('procurement.purchase_request.read');
    const canReadRelated = ctx.permissions.includes(PROCUREMENT_RELATED_READ_PERMISSIONS.PURCHASE_REQUEST);
    if (!canReadAll && !canReadRelated) throw new ForbiddenException();
    const pr = await this.repo.findPurchaseRequestById(ctx.companyId, id);
    if (!pr) throw new NotFoundException('Purchase request not found');
    assertProcurementBranchScope(ctx, pr.branchId, 'Purchase request');
    if (!canReadAll && !await this.repo.isProcurementDocumentRelatedToUser(ctx.companyId, 'PURCHASE_REQUEST', id, ctx.userId, ctx.scopes ?? {})) throw new ForbiddenException();
    return pr;
  }
}

@Injectable()
export class ListPurchaseRequestsUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, filter: { status?: string; requesterUserId?: string; supplierId?: string; branchId?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number }): Promise<{ data: PurchaseRequestRecord[]; total: number; page: number; pageSize: number }> {
    const canReadAll = ctx.permissions.includes('procurement.purchase_request.read');
    const canReadRelated = ctx.permissions.includes(PROCUREMENT_RELATED_READ_PERMISSIONS.PURCHASE_REQUEST);
    if (!canReadAll && !canReadRelated) throw new ForbiddenException();
    const { data, total } = await this.repo.listPurchaseRequests(ctx.companyId, {
      ...filter, ...(!canReadAll ? { relatedUserId: ctx.userId } : {}),
    }, ctx.scopes ?? {});
    return { data, total, page: filter.page ?? 1, pageSize: filter.pageSize ?? 20 };
  }
}

@Injectable()
export class SubmitPurchaseRequestUseCase {
  constructor(
    private readonly repo: PrismaProcurementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<PurchaseRequestRecord> {
    if (!ctx.permissions.includes('procurement.purchase_request.create')) throw new ForbiddenException();
    const pr = await this.repo.findPurchaseRequestById(ctx.companyId, id);
    if (!pr) throw new NotFoundException('Purchase request not found');
    assertProcurementBranchScope(ctx, pr.branchId, 'Purchase request');
    if (!canTransitionPR(pr.status, 'PENDING_APPROVAL')) throw new BadRequestException(`Cannot submit from status ${pr.status}`);

    const now = new Date();
    const periodKey = civilPeriodKey(todayCivilDate(undefined, now));
    const reserved = await this.reserveNumber.execute({ companyId: ctx.companyId, documentType: PROCUREMENT_SEQUENCE_KEYS.PURCHASE_REQUEST, periodKey, reservedByUserId: ctx.userId, idempotencyKey: `submit:${id}` });

    const updated = await this.repo.updatePurchaseRequestStatus(ctx.companyId, id, 'PENDING_APPROVAL', { requestNumber: reserved.documentNumber, submittedAt: now, updatedByUserId: ctx.userId });
    await this.commitNumber.execute({ id: reserved.id, companyId: ctx.companyId, ownerType: 'purchase_request', ownerId: id }, ctx.userId);

    await this.repo.appendPurchaseApprovalEvent(ctx.companyId, 'PURCHASE_REQUEST', id, 'SUBMITTED', ctx.userId);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.purchase_request.submit', targetType: 'purchase_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
    void this.outbox.append('purchase_request.submitted', 'purchase_request', id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'purchase_request', aggregateId: id, occurredAt: now.toISOString(), data: { status: 'PENDING_APPROVAL', requestNumber: reserved.documentNumber, grandTotalAmount: pr.grandTotalAmount } });
    return updated;
  }
}

@Injectable()
export class ApprovePurchaseRequestUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}

  async execute(ctx: RequestContext, id: string, note?: string): Promise<PurchaseRequestRecord> {
    if (!ctx.permissions.includes('procurement.purchase_request.approve')) throw new ForbiddenException();
    const pr = await this.repo.findPurchaseRequestById(ctx.companyId, id);
    if (!pr) throw new NotFoundException('Purchase request not found');
    assertProcurementBranchScope(ctx, pr.branchId, 'Purchase request');
    if (!canTransitionPR(pr.status, 'APPROVED')) throw new BadRequestException(`Cannot approve from status ${pr.status}`);
    const now = new Date();
    const updated = await this.repo.updatePurchaseRequestStatus(ctx.companyId, id, 'APPROVED', { approvedByUserId: ctx.userId, approvedAt: now, approvalNote: note, updatedByUserId: ctx.userId });
    await this.repo.appendPurchaseApprovalEvent(ctx.companyId, 'PURCHASE_REQUEST', id, 'APPROVED', ctx.userId, note);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.purchase_request.approve', targetType: 'purchase_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });
    void this.outbox.append('purchase_request.approved', 'purchase_request', id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'purchase_request', aggregateId: id, occurredAt: now.toISOString(), data: { status: 'APPROVED' } });
    return updated;
  }
}

@Injectable()
export class RejectPurchaseRequestUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string, note: string): Promise<PurchaseRequestRecord> {
    if (!ctx.permissions.includes('procurement.purchase_request.approve')) throw new ForbiddenException();
    const pr = await this.repo.findPurchaseRequestById(ctx.companyId, id);
    if (!pr) throw new NotFoundException('Purchase request not found');
    assertProcurementBranchScope(ctx, pr.branchId, 'Purchase request');
    if (!canTransitionPR(pr.status, 'REJECTED')) throw new BadRequestException(`Cannot reject from status ${pr.status}`);
    const updated = await this.repo.updatePurchaseRequestStatus(ctx.companyId, id, 'REJECTED', { rejectedByUserId: ctx.userId, rejectedAt: new Date(), approvalNote: note, updatedByUserId: ctx.userId });
    await this.repo.appendPurchaseApprovalEvent(ctx.companyId, 'PURCHASE_REQUEST', id, 'REJECTED', ctx.userId, note);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.purchase_request.reject', targetType: 'purchase_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { note } });
    return updated;
  }
}

@Injectable()
export class CancelPurchaseRequestUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string, reason?: string): Promise<PurchaseRequestRecord> {
    if (!ctx.permissions.includes('procurement.purchase_request.create')) throw new ForbiddenException();
    const pr = await this.repo.findPurchaseRequestById(ctx.companyId, id);
    if (!pr) throw new NotFoundException('Purchase request not found');
    assertProcurementBranchScope(ctx, pr.branchId, 'Purchase request');
    if (!canTransitionPR(pr.status, 'CANCELLED')) throw new BadRequestException(`Cannot cancel from status ${pr.status}`);
    const updated = await this.repo.updatePurchaseRequestStatus(ctx.companyId, id, 'CANCELLED', { updatedByUserId: ctx.userId });
    await this.repo.appendPurchaseApprovalEvent(ctx.companyId, 'PURCHASE_REQUEST', id, 'CANCELLED', ctx.userId, reason);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.purchase_request.cancel', targetType: 'purchase_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { reason } });
    return updated;
  }
}
