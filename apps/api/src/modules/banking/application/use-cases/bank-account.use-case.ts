import { Injectable, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaBankingRepository } from '../../infrastructure/prisma-banking.repository';
import { AuditService } from '../../../audit/application/audit.service';
import type { RequestContext } from '@watchdog-bms/contracts';
import type { BankAccountRecord, CreateBankAccountInput, UpdateBankAccountInput } from '../../domain/models/banking.model';
import { isBankLedgerAccount } from '../../domain/logic/bank-ledger-account.logic.js';
import { assertBankBranchInput, requireBankAccountInScope } from './bank-branch-scope';

export { isBankLedgerAccount } from '../../domain/logic/bank-ledger-account.logic.js';

async function assertBankLedgerAccount(
  repo: PrismaBankingRepository,
  companyId: string,
  ledgerAccountId?: string | null,
): Promise<void> {
  if (!ledgerAccountId) return;
  const account = await repo.findLedgerAccountForBank(companyId, ledgerAccountId);
  if (!account || !isBankLedgerAccount(account)) {
    throw new UnprocessableEntityException({
      code: 'ledger_account_invalid_for_bank',
      message: 'Ledger account must be an active, posting-enabled cash or bank asset in the current company.',
    });
  }
}

@Injectable()
export class ListBankAccountsUseCase {
  constructor(private readonly repo: PrismaBankingRepository) {}

  async execute(ctx: RequestContext): Promise<BankAccountRecord[]> {
    if (!ctx.permissions.includes('bank.account.read')) throw new ForbiddenException('Missing permission: bank.account.read');
    return this.repo.listBankAccounts(ctx.companyId, ctx.scopes.branchIds);
  }
}

@Injectable()
export class GetBankAccountUseCase {
  constructor(private readonly repo: PrismaBankingRepository) {}

  async execute(ctx: RequestContext, bankAccountId: string): Promise<BankAccountRecord> {
    if (!ctx.permissions.includes('bank.account.read')) throw new ForbiddenException('Missing permission: bank.account.read');
    return requireBankAccountInScope(this.repo, ctx, bankAccountId);
  }
}

@Injectable()
export class CreateBankAccountUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, input: Omit<CreateBankAccountInput, 'companyId' | 'createdByUserId'>): Promise<BankAccountRecord> {
    if (!ctx.permissions.includes('bank.account.manage')) throw new ForbiddenException('Missing permission: bank.account.manage');
    await assertBankBranchInput(this.repo, ctx, input.branchId);
    await assertBankLedgerAccount(this.repo, ctx.companyId, input.ledgerAccountId);

    const existing = await this.repo.listBankAccounts(ctx.companyId, ctx.scopes.branchIds);
    if (existing.some((a) => a.displayName === input.displayName)) {
      throw new UnprocessableEntityException(`Bank account with displayName "${input.displayName}" already exists`);
    }

    const result = await this.repo.createBankAccount({ ...input, companyId: ctx.companyId, createdByUserId: ctx.userId });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.account.create',
      targetType: 'bank_account', targetId: result.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { displayName: result.displayName, accountType: result.accountType, currency: result.currency },
    });

    return result;
  }
}

@Injectable()
export class UpdateBankAccountUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, bankAccountId: string, update: Omit<UpdateBankAccountInput, 'companyId' | 'bankAccountId' | 'updatedByUserId'>): Promise<BankAccountRecord> {
    if (!ctx.permissions.includes('bank.account.manage')) throw new ForbiddenException('Missing permission: bank.account.manage');

    await requireBankAccountInScope(this.repo, ctx, bankAccountId);
    await assertBankLedgerAccount(this.repo, ctx.companyId, update.ledgerAccountId);

    const result = await this.repo.updateBankAccount(ctx.companyId, bankAccountId, { ...update, updatedByUserId: ctx.userId });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.account.update',
      targetType: 'bank_account', targetId: result.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { displayName: result.displayName },
    });

    return result;
  }
}

@Injectable()
export class DeactivateBankAccountUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, bankAccountId: string): Promise<BankAccountRecord> {
    if (!ctx.permissions.includes('bank.account.manage')) throw new ForbiddenException('Missing permission: bank.account.manage');

    const existing = await requireBankAccountInScope(this.repo, ctx, bankAccountId);
    if (existing.status === 'INACTIVE') throw new UnprocessableEntityException('Bank account is already inactive');
    if (await this.repo.hasOpenReconciliationSession(ctx.companyId, bankAccountId)) {
      throw new UnprocessableEntityException('Cannot deactivate bank account with open reconciliation sessions');
    }
    const lines = await this.repo.listStatementLines(ctx.companyId, bankAccountId);
    if (lines.some((line) => ['UNMATCHED', 'SUGGESTED', 'PARTIALLY_MATCHED'].includes(line.status))) {
      throw new UnprocessableEntityException('Cannot deactivate bank account with unreconciled statement lines');
    }

    const result = await this.repo.updateBankAccount(ctx.companyId, bankAccountId, { status: 'INACTIVE', updatedByUserId: ctx.userId });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.account.deactivate',
      targetType: 'bank_account', targetId: result.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { displayName: result.displayName },
    });

    return result;
  }
}
