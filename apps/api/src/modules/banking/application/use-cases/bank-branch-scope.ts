import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import type { BankAccountRecord } from '../../domain/models/banking.model';
import type { PrismaBankingRepository } from '../../infrastructure/prisma-banking.repository';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';

export async function requireBankAccountInScope(
  repo: PrismaBankingRepository,
  ctx: RequestContext,
  bankAccountId: string,
): Promise<BankAccountRecord> {
  const account = await repo.findBankAccountById(ctx.companyId, bankAccountId, ctx.scopes.branchIds);
  if (!account) throw new NotFoundException(`Bank account ${bankAccountId} not found`);
  return account;
}

export async function assertBankBranchInput(
  repo: PrismaBankingRepository,
  ctx: RequestContext,
  branchId: string | undefined,
): Promise<void> {
  if (!isBranchInScope(ctx.scopes, branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
  if (branchId && !(await repo.findActiveBranch(ctx.companyId, branchId))) {
    throw new NotFoundException('Branch was not found in the current company.');
  }
}
