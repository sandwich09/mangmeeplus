import { Injectable, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaBankingRepository } from '../../infrastructure/prisma-banking.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import type { RequestContext, BankCashPositionSummary } from '@watchdog-bms/contracts';
import type { BankReconciliationSessionRecord, CreateReconciliationSessionInput } from '../../domain/models/banking.model';
import { calculateInitialReconciliationSession, canCompleteReconciliation, sumDecimalAmounts } from '../../domain/logic/banking.logic';
import { requireBankAccountInScope } from './bank-branch-scope';
import { todayCivilDate } from '@watchdog-bms/contracts';

type CreateSessionInput = Omit<CreateReconciliationSessionInput, 'companyId' | 'createdByUserId' | 'sessionNumber'> & {
  sessionNumber?: string;
  closingStatementBalanceAmount: string;
};

@Injectable()
export class ListReconciliationSessionsUseCase {
  constructor(private readonly repo: PrismaBankingRepository) {}

  async execute(ctx: RequestContext, bankAccountId?: string): Promise<BankReconciliationSessionRecord[]> {
    if (!ctx.permissions.includes('bank.reconciliation.read')) throw new ForbiddenException('Missing permission: bank.reconciliation.read');
    if (bankAccountId) await requireBankAccountInScope(this.repo, ctx, bankAccountId);
    return this.repo.listReconciliationSessions(ctx.companyId, bankAccountId, ctx.scopes.branchIds);
  }
}

@Injectable()
export class GetReconciliationSessionUseCase {
  constructor(private readonly repo: PrismaBankingRepository) {}

  async execute(ctx: RequestContext, sessionId: string): Promise<BankReconciliationSessionRecord> {
    if (!ctx.permissions.includes('bank.reconciliation.read')) throw new ForbiddenException('Missing permission: bank.reconciliation.read');
    const result = await this.repo.findReconciliationSessionById(ctx.companyId, sessionId, ctx.scopes.branchIds);
    if (!result) throw new NotFoundException(`Reconciliation session ${sessionId} not found`);
    return result;
  }
}

@Injectable()
export class CreateReconciliationSessionUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, input: CreateSessionInput): Promise<BankReconciliationSessionRecord> {
    if (!ctx.permissions.includes('bank.reconciliation.create')) throw new ForbiddenException('Missing permission: bank.reconciliation.create');

    await requireBankAccountInScope(this.repo, ctx, input.bankAccountId);

    const balances = calculateInitialReconciliationSession({
      openingStatementBalance: input.openingStatementBalanceAmount,
      closingStatementBalance: input.closingStatementBalanceAmount,
    });

    const result = await this.repo.createReconciliationSession({
      companyId: ctx.companyId,
      bankAccountId: input.bankAccountId,
      sessionNumber: input.sessionNumber ?? `REC-${todayCivilDate().replace(/-/g, '')}-${Date.now().toString().slice(-6)}`,
      periodStartDate: input.periodStartDate,
      periodEndDate: input.periodEndDate,
      openingStatementBalanceAmount: input.openingStatementBalanceAmount,
      closingStatementBalanceAmount: input.closingStatementBalanceAmount,
      calculatedStatementMovementAmount: balances.calculatedStatementMovementAmount,
      calculatedBookMovementAmount: balances.calculatedBookMovementAmount,
      calculatedBookBalanceAmount: balances.calculatedBookBalanceAmount,
      differenceAmount: balances.differenceAmount,
      currency: input.currency,
      createdByUserId: ctx.userId,
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.reconciliation.create',
      targetType: 'bank_reconciliation_session', targetId: result.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { bankAccountId: input.bankAccountId, sessionNumber: input.sessionNumber },
    });

    return result;
  }
}

@Injectable()
export class CompleteReconciliationSessionUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(
    ctx: RequestContext,
    sessionId: string,
    _snapshotLines?: Array<{ statementLineId: string; statusAtCompletion: string; matchedAmountAtCompletion: string; ignoredReasonAtCompletion?: string }>,
  ): Promise<BankReconciliationSessionRecord> {
    if (!ctx.permissions.includes('bank.reconciliation.complete')) throw new ForbiddenException('Missing permission: bank.reconciliation.complete');

    const session = await this.repo.findReconciliationSessionById(ctx.companyId, sessionId, ctx.scopes.branchIds);
    if (!session) throw new NotFoundException(`Reconciliation session ${sessionId} not found`);
    if (session.status !== 'DRAFT' && session.status !== 'IN_REVIEW' && session.status !== 'REOPENED') {
      throw new UnprocessableEntityException('Session cannot be completed in its current status');
    }

    const account = await requireBankAccountInScope(this.repo, ctx, session.bankAccountId);
    const statementLines = await this.repo.listStatementLinesForPeriod(
      ctx.companyId,
      session.bankAccountId,
      session.periodStartDate,
      session.periodEndDate,
    );
    const snapshotLines = await Promise.all(
      statementLines.map(async (line) => {
        const matches = await this.repo.listMatchesByLine(ctx.companyId, line.id);
        const matchedAmountAtCompletion = sumDecimalAmounts(
          matches.filter((match) => match.status === 'CONFIRMED').map((match) => match.allocatedAmount),
        );
        return {
          statementLineId: line.id,
          statusAtCompletion: line.status,
          matchedAmountAtCompletion,
          ignoredReasonAtCompletion: line.ignoredReason,
        };
      }),
    );
    const unmatchedCount = snapshotLines.filter((l) =>
      ['UNMATCHED', 'SUGGESTED', 'PARTIALLY_MATCHED'].includes(l.statusAtCompletion),
    ).length;
    const ignoredWithoutReviewCount = snapshotLines.filter((l) =>
      l.statusAtCompletion === 'IGNORED' && !l.ignoredReasonAtCompletion?.trim(),
    ).length;
    const isPeriodClosed = await this.repo.hasClosedAccountingPeriodInRange(
      ctx.companyId,
      session.periodStartDate,
      session.periodEndDate,
    );

    const guard = canCompleteReconciliation({
      unmatchedRequiredLinesCount: unmatchedCount,
      ignoredWithoutReviewCount,
      differenceAmount: session.differenceAmount,
      hasLedgerLink: !!account?.ledgerAccountId,
      isPeriodClosed,
    });

    if (!guard.canComplete) {
      throw new UnprocessableEntityException(guard.blockers.join('; '));
    }

    const result = await this.repo.completeReconciliationSession(ctx.companyId, sessionId, ctx.userId, snapshotLines);

    void this.outbox.append('banking.reconciliation.completed', 'bank_reconciliation_session', sessionId, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'bank_reconciliation_session', aggregateId: sessionId, occurredAt: new Date().toISOString(),
      data: { sessionId, bankAccountId: session.bankAccountId, sessionNumber: session.sessionNumber },
    });

    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.reconciliation.complete',
      targetType: 'bank_reconciliation_session', targetId: sessionId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'CRITICAL',
      metadataJson: { sessionNumber: session.sessionNumber, snapshotLineCount: snapshotLines.length },
    });

    return result;
  }
}

@Injectable()
export class ReopenReconciliationSessionUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, sessionId: string, reason: string): Promise<BankReconciliationSessionRecord> {
    if (!ctx.permissions.includes('bank.reconciliation.reopen')) throw new ForbiddenException('Missing permission: bank.reconciliation.reopen');
    if (!reason || reason.trim().length < 3) throw new UnprocessableEntityException('Reopen reason must be at least 3 characters');

    const session = await this.repo.findReconciliationSessionById(ctx.companyId, sessionId, ctx.scopes.branchIds);
    if (!session) throw new NotFoundException(`Reconciliation session ${sessionId} not found`);
    if (session.status !== 'COMPLETED') throw new UnprocessableEntityException('Only COMPLETED sessions can be reopened');

    const result = await this.repo.updateReconciliationSessionStatus(ctx.companyId, sessionId, {
      status: 'REOPENED',
      reopenedByUserId: ctx.userId,
      reopenReason: reason,
    });

    void this.outbox.append('banking.reconciliation.reopened', 'bank_reconciliation_session', sessionId, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'bank_reconciliation_session', aggregateId: sessionId, occurredAt: new Date().toISOString(),
      data: { sessionId, reason },
    });

    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.reconciliation.reopen',
      targetType: 'bank_reconciliation_session', targetId: sessionId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'CRITICAL',
      metadataJson: { reason },
    });

    return result;
  }
}

@Injectable()
export class GetCashPositionUseCase {
  constructor(private readonly repo: PrismaBankingRepository) {}

  async execute(ctx: RequestContext): Promise<BankCashPositionSummary[]> {
    if (!ctx.permissions.includes('bank.cash.read')) throw new ForbiddenException('Missing permission: bank.cash.read');
    return (await this.repo.readCashPositionSnapshot(ctx.companyId, ctx.scopes.branchIds)).accounts;
  }
}

@Injectable()
export class GetReconciliationStatusUseCase {
  constructor(private readonly repo: PrismaBankingRepository) {}

  async execute(ctx: RequestContext): Promise<{ asOf: Date; accounts: BankCashPositionSummary[] }> {
    if (!ctx.permissions.includes('bank.reconciliation.read')) throw new ForbiddenException('Missing permission: bank.reconciliation.read');
    return this.repo.readCashPositionSnapshot(ctx.companyId, ctx.scopes.branchIds);
  }
}
