import { Injectable, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaBankingRepository } from '../../infrastructure/prisma-banking.repository';
import { PrismaMatchSourceQuery } from '../../infrastructure/prisma-match-source.query';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import type { RequestContext, BankMatchCandidate } from '@watchdog-bms/contracts';
import type { BankStatementLineRecord, BankReconciliationMatchRecord } from '../../domain/models/banking.model';
import { calculateStatementLineMatchStatus, sumDecimalAmounts, validateMatchAllocation } from '../../domain/logic/banking.logic';
import { requireBankAccountInScope } from './bank-branch-scope';

type ConfirmMatchInput = {
  statementLineId: string;
  sourceType: string;
  sourceId: string;
  sourceDisplayNumber?: string;
  allocatedAmount: string;
  currency: string;
  overrideReason?: string;
};

function expectedDirectionForSource(sourceType: string, fallback: 'DEPOSIT' | 'WITHDRAWAL'): 'DEPOSIT' | 'WITHDRAWAL' {
  if (sourceType === 'CUSTOMER_PAYMENT') return 'DEPOSIT';
  if (sourceType === 'SUPPLIER_PAYMENT' || sourceType === 'EXPENSE_PAYMENT' || sourceType === 'REIMBURSEMENT_PAYMENT') {
    return 'WITHDRAWAL';
  }
  return fallback;
}

@Injectable()
export class ListMatchCandidatesUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly sourceQuery: PrismaMatchSourceQuery,
  ) {}

  async execute(
    ctx: RequestContext,
    bankAccountId: string,
  ): Promise<{
    lines: BankStatementLineRecord[];
    matchesByLine: Record<string, BankReconciliationMatchRecord[]>;
    candidates: BankMatchCandidate[];
  }> {
    if (!ctx.permissions.includes('bank.match.read')) throw new ForbiddenException('Missing permission: bank.match.read');
    await requireBankAccountInScope(this.repo, ctx, bankAccountId);

    const [unmatched, suggested, partial, candidates] = await Promise.all([
      this.repo.listStatementLines(ctx.companyId, bankAccountId, 'UNMATCHED'),
      this.repo.listStatementLines(ctx.companyId, bankAccountId, 'SUGGESTED'),
      this.repo.listStatementLines(ctx.companyId, bankAccountId, 'PARTIALLY_MATCHED'),
      this.sourceQuery.listCandidates(ctx.companyId, ctx.scopes.branchIds),
    ]);
    const lines = [...unmatched, ...suggested, ...partial];

    const matchesByLine: Record<string, BankReconciliationMatchRecord[]> = {};
    await Promise.all(
      lines.map(async (l) => {
        matchesByLine[l.id] = await this.repo.listMatchesByLine(ctx.companyId, l.id);
      }),
    );

    return { lines, matchesByLine, candidates };
  }
}

@Injectable()
export class ConfirmMatchUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, input: ConfirmMatchInput): Promise<BankReconciliationMatchRecord> {
    if (!ctx.permissions.includes('bank.match.confirm')) throw new ForbiddenException('Missing permission: bank.match.confirm');
    if (input.overrideReason && !ctx.permissions.includes('bank.match.override')) {
      throw new ForbiddenException('Missing permission: bank.match.override');
    }

    const line = await this.repo.findStatementLineById(ctx.companyId, input.statementLineId, ctx.scopes.branchIds);
    if (!line) throw new NotFoundException(`Statement line ${input.statementLineId} not found`);

    const existingMatches = await this.repo.listMatchesByLine(ctx.companyId, input.statementLineId);
    const confirmedMatches = existingMatches.filter((m) => m.status === 'CONFIRMED');
    const alreadyAllocated = sumDecimalAmounts(confirmedMatches.map((m) => m.allocatedAmount));

    const lineDirection = line.direction === 'DEPOSIT' ? 'DEPOSIT' : 'WITHDRAWAL';
    const validation = validateMatchAllocation({
      statementLineAmount: line.signedAmount,
      alreadyAllocated,
      newAllocation: input.allocatedAmount,
      direction: line.direction,
      candidateDirection: expectedDirectionForSource(input.sourceType, lineDirection),
    });

    if (!validation.valid) {
      const isOverAllocation = validation.error?.includes('Over-allocation');
      if (!isOverAllocation || !input.overrideReason) {
        throw new UnprocessableEntityException(validation.error);
      }
    }

    const match = await this.repo.createMatch({
      companyId: ctx.companyId,
      bankAccountId: line.bankAccountId,
      statementLineId: input.statementLineId,
      sourceType: input.sourceType as any,
      sourceId: input.sourceId,
      sourceDisplayNumber: input.sourceDisplayNumber,
      allocatedAmount: input.allocatedAmount,
      currency: input.currency,
      overrideReason: input.overrideReason,
    });

    const newStatus = calculateStatementLineMatchStatus({
      statementLineAmount: line.signedAmount,
      confirmedAllocations: [...confirmedMatches.map((m) => m.allocatedAmount), input.allocatedAmount],
    });
    await this.repo.updateStatementLineStatus(ctx.companyId, input.statementLineId, newStatus);

    void this.outbox.append('banking.statement_line.matched', 'bank_statement_line', input.statementLineId, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'bank_statement_line', aggregateId: input.statementLineId, occurredAt: new Date().toISOString(),
      data: { matchId: match.id, statementLineId: input.statementLineId, sourceType: input.sourceType, sourceId: input.sourceId, allocatedAmount: input.allocatedAmount },
    });

    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.match.confirm',
      targetType: 'bank_reconciliation_match', targetId: match.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { statementLineId: input.statementLineId, sourceType: input.sourceType, sourceId: input.sourceId, allocatedAmount: input.allocatedAmount },
    });

    return match;
  }
}

@Injectable()
export class RejectMatchUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, matchId: string, reason: string): Promise<BankReconciliationMatchRecord> {
    if (!ctx.permissions.includes('bank.match.confirm')) throw new ForbiddenException('Missing permission: bank.match.confirm');

    const match = await this.repo.findMatchById(ctx.companyId, matchId, ctx.scopes.branchIds);
    if (!match) throw new NotFoundException(`Match ${matchId} not found`);
    if (match.status !== 'CONFIRMED' && match.status !== 'SUGGESTED') {
      throw new UnprocessableEntityException('Match cannot be rejected in its current status');
    }

    const result = await this.repo.updateMatchStatus(ctx.companyId, matchId, {
      status: 'REJECTED',
      rejectedByUserId: ctx.userId,
      rejectionReason: reason,
    });

    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.match.reject',
      targetType: 'bank_reconciliation_match', targetId: matchId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { reason },
    });

    return result;
  }
}

@Injectable()
export class VoidMatchUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, matchId: string): Promise<BankReconciliationMatchRecord> {
    if (!ctx.permissions.includes('bank.match.unmatch')) throw new ForbiddenException('Missing permission: bank.match.unmatch');

    const match = await this.repo.findMatchById(ctx.companyId, matchId, ctx.scopes.branchIds);
    if (!match) throw new NotFoundException(`Match ${matchId} not found`);
    if (match.status === 'VOIDED') throw new UnprocessableEntityException('Match is already voided');
    if (await this.repo.isStatementLineLockedByCompletedReconciliation(ctx.companyId, match.statementLineId)) {
      throw new UnprocessableEntityException('Cannot unmatch a line locked by completed reconciliation; reopen the session first');
    }

    const result = await this.repo.updateMatchStatus(ctx.companyId, matchId, { status: 'VOIDED' });

    // Recalculate line status
    const remaining = await this.repo.listMatchesByLine(ctx.companyId, match.statementLineId);
    const activeMatches = remaining.filter((m) => m.id !== matchId && m.status === 'CONFIRMED');
    const line = await this.repo.findStatementLineById(ctx.companyId, match.statementLineId, ctx.scopes.branchIds);
    if (line) {
      const newStatus = calculateStatementLineMatchStatus({
        statementLineAmount: line.signedAmount,
        confirmedAllocations: activeMatches.map((m) => m.allocatedAmount),
      });
      await this.repo.updateStatementLineStatus(ctx.companyId, match.statementLineId, newStatus);
    }

    void this.outbox.append('banking.statement_line.unmatched', 'bank_statement_line', match.statementLineId, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'bank_statement_line', aggregateId: match.statementLineId, occurredAt: new Date().toISOString(),
      data: { matchId, statementLineId: match.statementLineId },
    });

    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.match.void',
      targetType: 'bank_reconciliation_match', targetId: matchId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { statementLineId: match.statementLineId },
    });

    return result;
  }
}

@Injectable()
export class IgnoreStatementLineUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, statementLineId: string, reason: string): Promise<BankStatementLineRecord> {
    if (!ctx.permissions.includes('bank.match.override')) throw new ForbiddenException('Missing permission: bank.match.override');
    if (!reason || reason.trim().length < 3) throw new UnprocessableEntityException('Ignore reason must be at least 3 characters');

    const line = await this.repo.findStatementLineById(ctx.companyId, statementLineId, ctx.scopes.branchIds);
    if (!line) throw new NotFoundException(`Statement line ${statementLineId} not found`);

    const result = await this.repo.updateStatementLineStatus(ctx.companyId, statementLineId, 'IGNORED', reason);

    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.statement.line.ignore',
      targetType: 'bank_statement_line', targetId: statementLineId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'CRITICAL',
      metadataJson: { reason },
    });

    return result;
  }
}
