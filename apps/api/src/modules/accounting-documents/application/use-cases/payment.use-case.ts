import { Injectable, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaAccountingRepository } from '../../infrastructure/prisma-accounting.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { CancelDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/cancel-document-number.use-case';
import type { RequestContext } from '@watchdog-bms/contracts';
import { LEDGER_SEQUENCE_KEY } from '@watchdog-bms/contracts';
import type { CreatePaymentInput, PaymentRecord, ListPaymentsFilter, PaginatedPayments } from '../../domain/models/accounting.model';
import {
  validateAccountingPaymentAllocation,
  validateAccountingPaymentMoneyInput,
} from '../../domain/logic/accounting-money-validation.logic';
import { isBranchInScope, resolveCreateBranchId } from '../../../data-model-core/domain/logic/branch.logic';
import { civilPeriodKey, todayCivilDate } from '@watchdog-bms/contracts';

@Injectable()
export class CreatePaymentUseCase {
  constructor(
    private readonly repo: PrismaAccountingRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, input: Omit<CreatePaymentInput, 'companyId' | 'createdByUserId'>): Promise<PaymentRecord> {
    if (!ctx.permissions.includes('accounting.payment.create')) {
      throw new ForbiddenException('Missing permission: accounting.payment.create');
    }
    const moneyError = validateAccountingPaymentMoneyInput(input);
    if (moneyError) throw new UnprocessableEntityException(moneyError);
    let target: Awaited<ReturnType<PrismaAccountingRepository['findDocumentById']>> = null;
    if (input.allocateToDocumentId) {
      target = await this.repo.findDocumentById(ctx.companyId, input.allocateToDocumentId, ctx.scopes.branchIds);
      if (!target) throw new NotFoundException('Payment allocation target was not found');
      if (input.branchId !== undefined && input.branchId !== target.branchId) {
        throw new UnprocessableEntityException('Payment and allocation target must use the same branch');
      }
      if (ctx.scopes.branchIds && !target.branchId) {
        throw new ForbiddenException('A branch-restricted user cannot pay a company-central document');
      }
      if (input.counterpartyId !== undefined && input.counterpartyId !== target.counterpartyId) {
        throw new UnprocessableEntityException('Payment and allocation target must use the same counterparty');
      }
    }
    if (ctx.scopes.branchIds?.length === 0) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    const branchId = target?.branchId ?? resolveCreateBranchId(ctx.scopes, input.branchId) ?? undefined;
    if (!isBranchInScope(ctx.scopes, branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    if (branchId && !(await this.repo.findActiveBranch(ctx.companyId, branchId))) {
      throw new NotFoundException('Branch was not found in the current company.');
    }
    const resolvedInput = {
      ...input,
      branchId,
      ...(target ? { counterpartyId: target.counterpartyId } : {}),
    };
    if (target) {
      const allocationError = validateAccountingPaymentAllocation(resolvedInput, target);
      if (allocationError) throw new UnprocessableEntityException(allocationError);
    }

    const result = await this.repo.createPayment({ ...resolvedInput, companyId: ctx.companyId, createdByUserId: ctx.userId });

    const unapplied = parseFloat(result.unappliedAmount);
    if (unapplied > 0) {
      void this.outbox.append('accounting.payment.unapplied_credit_created', 'accounting_payment', result.id, {
        companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
        aggregateType: 'accounting_payment', aggregateId: result.id, occurredAt: new Date().toISOString(),
        data: { paymentId: result.id, unappliedAmount: result.unappliedAmount, currency: result.currency },
      });
    }

    void this.outbox.append('accounting.payment.recorded', 'accounting_payment', result.id, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'accounting_payment', aggregateId: result.id, occurredAt: new Date().toISOString(),
      data: { paymentId: result.id, amount: result.amount, whtAmount: result.whtAmount, method: result.method, direction: result.direction },
    });

    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.payment.create',
      targetType: 'accounting_payment', targetId: result.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { amount: result.amount, whtAmount: result.whtAmount, method: result.method, direction: result.direction },
    });

    return result;
  }
}

@Injectable()
export class GetPaymentUseCase {
  constructor(private readonly repo: PrismaAccountingRepository) {}

  async execute(ctx: RequestContext, paymentId: string): Promise<PaymentRecord> {
    if (!ctx.permissions.includes('accounting.payment.read')) throw new ForbiddenException('Missing permission: accounting.payment.read');
    const result = await this.repo.findPaymentById(ctx.companyId, paymentId, ctx.scopes.branchIds);
    if (!result) throw new NotFoundException(`Payment ${paymentId} not found`);
    return result;
  }
}

@Injectable()
export class ListPaymentsUseCase {
  constructor(private readonly repo: PrismaAccountingRepository) {}

  async execute(ctx: RequestContext, filter: Omit<ListPaymentsFilter, 'companyId'>): Promise<PaginatedPayments> {
    if (!ctx.permissions.includes('accounting.payment.read')) throw new ForbiddenException('Missing permission: accounting.payment.read');
    return this.repo.listPayments({ ...filter, companyId: ctx.companyId }, ctx.scopes.branchIds);
  }
}

@Injectable()
export class VoidPaymentUseCase {
  constructor(
    private readonly repo: PrismaAccountingRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
    private readonly cancelNumber: CancelDocumentNumberUseCase,
  ) {}

  async execute(ctx: RequestContext, paymentId: string, reason: string): Promise<PaymentRecord> {
    if (!ctx.permissions.includes('accounting.payment.void')) throw new ForbiddenException('Missing permission: accounting.payment.void');
    if (!reason || reason.trim().length < 3) throw new UnprocessableEntityException('Void reason must be at least 3 characters');

    const payment = await this.repo.findPaymentById(ctx.companyId, paymentId, ctx.scopes.branchIds);
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);
    if (payment.status === 'VOIDED') throw new UnprocessableEntityException('Payment is already voided');

    // H-04: reserve the reversal entry number outside the void transaction
    // (sequence rows commit independently); the transaction re-verifies the
    // posting state and fails closed if it changed in between.
    const postedJournalId = await this.repo.findPostedGeneratedJournalId(ctx.companyId, 'accounting.payment', paymentId);
    const reserved = postedJournalId
      ? await this.reserveNumber.execute({
          companyId: ctx.companyId, documentType: LEDGER_SEQUENCE_KEY,
          periodKey: civilPeriodKey(todayCivilDate()),
          // Date.now() is deliberate: reserveNumber returns a matching-key row
          // regardless of its status, so a deterministic key would hand a
          // retried void the CANCELLED reservation from the failed attempt.
          idempotencyKey: `void-reversal:accounting.payment:${paymentId}:${Date.now()}`,
          reservedByUserId: ctx.userId,
        })
      : null;

    let result;
    try {
      result = await this.repo.voidPaymentTrueReversal(ctx.companyId, paymentId, ctx.userId, reason, reserved?.documentNumber);
    } catch (err) {
      // The reservation is still RESERVED here (commit happens only after a
      // successful reversal), so it must be cancelled — voidNumber accepts
      // COMMITTED numbers only and would mask the real error.
      if (reserved) await this.cancelNumber.execute({ id: reserved.id, companyId: ctx.companyId }, ctx.userId);
      throw err;
    }
    if (reserved) {
      if (result.reversalEntryId) {
        await this.commitNumber.execute({ id: reserved.id, companyId: ctx.companyId, ownerType: 'journal_entry', ownerId: result.reversalEntryId }, ctx.userId);
      } else {
        await this.cancelNumber.execute({ id: reserved.id, companyId: ctx.companyId }, ctx.userId);
      }
    }

    void this.outbox.append('accounting.payment.voided', 'accounting_payment', paymentId, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'accounting_payment', aggregateId: paymentId, occurredAt: new Date().toISOString(),
      data: { paymentId, amount: payment.amount, reason, reversalEntryId: result.reversalEntryId, releasedAllocations: result.releasedAllocations },
    });

    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.payment.void',
      targetType: 'accounting_payment', targetId: paymentId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'CRITICAL',
      metadataJson: { amount: payment.amount, reason, reversalEntryId: result.reversalEntryId, releasedAllocations: result.releasedAllocations },
    });

    return result.payment;
  }
}
