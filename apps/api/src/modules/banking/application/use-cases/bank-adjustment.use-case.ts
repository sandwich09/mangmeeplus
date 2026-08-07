import { Injectable, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaBankingRepository } from '../../infrastructure/prisma-banking.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import type { RequestContext } from '@watchdog-bms/contracts';
import type { BankAdjustmentRecord, CreateBankAdjustmentInput } from '../../domain/models/banking.model';
import { buildAdjustmentPostingInput } from '../../domain/logic/banking.logic';
import { requireBankAccountInScope } from './bank-branch-scope';

@Injectable()
export class ListBankAdjustmentsUseCase {
  constructor(private readonly repo: PrismaBankingRepository) {}

  async execute(ctx: RequestContext, bankAccountId?: string): Promise<BankAdjustmentRecord[]> {
    if (!ctx.permissions.includes('bank.adjustment.read')) throw new ForbiddenException('Missing permission: bank.adjustment.read');
    if (bankAccountId) await requireBankAccountInScope(this.repo, ctx, bankAccountId);
    return this.repo.listBankAdjustments(ctx.companyId, bankAccountId, ctx.scopes.branchIds);
  }
}

@Injectable()
export class GetBankAdjustmentUseCase {
  constructor(private readonly repo: PrismaBankingRepository) {}

  async execute(ctx: RequestContext, id: string): Promise<BankAdjustmentRecord> {
    if (!ctx.permissions.includes('bank.adjustment.read')) throw new ForbiddenException('Missing permission: bank.adjustment.read');
    const result = await this.repo.findBankAdjustmentById(ctx.companyId, id, ctx.scopes.branchIds);
    if (!result) throw new NotFoundException(`Bank adjustment ${id} not found`);
    return result;
  }
}

@Injectable()
export class CreateBankAdjustmentUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, input: Omit<CreateBankAdjustmentInput, 'companyId' | 'createdByUserId'>): Promise<BankAdjustmentRecord> {
    if (!ctx.permissions.includes('bank.adjustment.create')) throw new ForbiddenException('Missing permission: bank.adjustment.create');
    await requireBankAccountInScope(this.repo, ctx, input.bankAccountId);

    const result = await this.repo.createBankAdjustment({ ...input, companyId: ctx.companyId, createdByUserId: ctx.userId });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.adjustment.create',
      targetType: 'bank_adjustment', targetId: result.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { bankAccountId: input.bankAccountId, category: input.category, signedAmount: input.signedAmount },
    });

    return result;
  }
}

@Injectable()
export class SubmitBankAdjustmentUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<BankAdjustmentRecord> {
    if (!ctx.permissions.includes('bank.adjustment.create')) throw new ForbiddenException('Missing permission: bank.adjustment.create');

    const existing = await this.repo.findBankAdjustmentById(ctx.companyId, id, ctx.scopes.branchIds);
    if (!existing) throw new NotFoundException(`Bank adjustment ${id} not found`);
    if (existing.status !== 'DRAFT') throw new UnprocessableEntityException('Only DRAFT adjustments can be submitted');

    const result = await this.repo.updateBankAdjustmentStatus(ctx.companyId, id, { status: 'PENDING_APPROVAL' });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.adjustment.submit',
      targetType: 'bank_adjustment', targetId: id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { bankAccountId: existing.bankAccountId },
    });

    return result;
  }
}

@Injectable()
export class ApproveBankAdjustmentUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(
    ctx: RequestContext,
    id: string,
    input: { ledgerDebitAccountId: string; ledgerCreditAccountId: string },
  ): Promise<BankAdjustmentRecord> {
    if (!ctx.permissions.includes('bank.adjustment.approve')) throw new ForbiddenException('Missing permission: bank.adjustment.approve');

    const existing = await this.repo.findBankAdjustmentById(ctx.companyId, id, ctx.scopes.branchIds);
    if (!existing) throw new NotFoundException(`Bank adjustment ${id} not found`);
    if (existing.status !== 'PENDING_APPROVAL') throw new UnprocessableEntityException('Only PENDING_APPROVAL adjustments can be approved');
    if (!input.ledgerDebitAccountId || !input.ledgerCreditAccountId) {
      throw new UnprocessableEntityException('ledgerDebitAccountId and ledgerCreditAccountId are required for approval');
    }

    const postingInput = buildAdjustmentPostingInput({
      id: existing.id,
      companyId: existing.companyId,
      adjustmentNumber: existing.adjustmentNumber ?? existing.id,
      category: existing.category,
      adjustmentDate: existing.adjustmentDate.toISOString().split('T')[0],
      description: existing.description,
      signedAmount: existing.signedAmount,
      currency: existing.currency,
      ledgerDebitAccountId: input.ledgerDebitAccountId,
      ledgerCreditAccountId: input.ledgerCreditAccountId,
    });

    if (postingInput.error) {
      throw new UnprocessableEntityException(postingInput.error);
    }

    const result = await this.repo.updateBankAdjustmentStatus(ctx.companyId, id, {
      status: 'APPROVED',
      approvedByUserId: ctx.userId,
      postingStatus: 'pending',
    });

    void this.outbox.append('banking.adjustment.approved', 'bank_adjustment', id, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'bank_adjustment', aggregateId: id, occurredAt: new Date().toISOString(),
      data: { adjustmentId: id, postingInput },
    });

    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.adjustment.approve',
      targetType: 'bank_adjustment', targetId: id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'CRITICAL',
      metadataJson: { bankAccountId: existing.bankAccountId, signedAmount: existing.signedAmount },
    });

    return result;
  }
}

@Injectable()
export class VoidBankAdjustmentUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, id: string, reason: string): Promise<BankAdjustmentRecord> {
    if (!ctx.permissions.includes('bank.adjustment.void')) throw new ForbiddenException('Missing permission: bank.adjustment.void');
    if (!reason || reason.trim().length < 3) throw new UnprocessableEntityException('Void reason must be at least 3 characters');

    const existing = await this.repo.findBankAdjustmentById(ctx.companyId, id, ctx.scopes.branchIds);
    if (!existing) throw new NotFoundException(`Bank adjustment ${id} not found`);
    if (existing.status === 'POSTED') throw new UnprocessableEntityException('Posted adjustments cannot be voided');
    if (existing.status === 'VOIDED') throw new UnprocessableEntityException('Adjustment is already voided');

    const result = await this.repo.updateBankAdjustmentStatus(ctx.companyId, id, { status: 'VOIDED', voidedByUserId: ctx.userId, voidReason: reason });

    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.adjustment.void',
      targetType: 'bank_adjustment', targetId: id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { reason },
    });

    return result;
  }
}
