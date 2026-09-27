import { Injectable } from '@nestjs/common';
import type { RequestContext, SourceRef, ToolResult } from '@watchdog-bms/contracts';
import { ListBankAccountsUseCase } from '../../../banking/application/use-cases/bank-account.use-case';
import { GetCashPositionUseCase, GetReconciliationStatusUseCase } from '../../../banking/application/use-cases/reconciliation.use-case';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import {
  BUSINESS_READ_BASIS_VERSION,
  appliedQuery,
  completeResult,
  fact,
  sourceRefId,
} from '../../domain/logic/business-read-source.logic';

function toCtx(ctx: ErpToolContext): RequestContext {
  return {
    requestId: ctx.requestId ?? '', authSubject: ctx.userId, userId: ctx.userId,
    companyId: ctx.companyId, membershipId: ctx.membershipId ?? '', roles: ctx.roles ?? [],
    permissions: ctx.permissions, scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds }, authProvider: 'watchdog',
  };
}

function accountRef(ctx: ErpToolContext, asOf: string, id: string, label: string): SourceRef {
  return {
    id: `banking:bank_account:${id}`, label, module: 'banking', entityType: 'bank_account', entityId: id,
    asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/banking/accounts/${id}`,
  };
}

@Injectable()
export class BankGetAccountBalancesTool implements ErpReadToolPort {
  readonly toolName = 'bank.get_account_balances';
  constructor(
    private readonly listAccounts: ListBankAccountsUseCase,
    private readonly getCashPosition: GetCashPositionUseCase,
  ) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = new Date().toISOString();
    if (!ctx.permissions.includes('bank.account.read') || !ctx.permissions.includes('bank.cash.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const requestContext = toCtx(ctx);
    const [accounts, positions] = await Promise.all([
      this.listAccounts.execute(requestContext),
      this.getCashPosition.execute(requestContext),
    ]);
    const positionsById = new Map(positions.map((position) => [position.bankAccountId, position]));
    const sourceRefs = accounts.map((account) => accountRef(ctx, asOf, account.id, account.displayName));
    const queryApplied = appliedQuery(undefined, {
      branch: { mode: 'all_authorized', branchId: null }, dateBasis: 'last_completed_reconciliation',
      statusBasis: 'completed_reconciliation_only', dataset: 'bank_last_reconciled_balances',
    });
    const completeness = completeResult(accounts.length, false, 0, false);
    return {
      toolName: this.toolName, status: 'ok', asOf, sourceRefs,
      data: {
        basis: 'last_completed_reconciliation_not_live_bank_feed',
        accounts: accounts.map((account) => {
          const position = positionsById.get(account.id);
          return {
            bankAccountId: account.id, displayName: account.displayName, currency: account.currency,
            lastReconciledBalance: position?.lastReconciledBalance ?? null,
            lastReconciledDate: position?.lastReconciledDate ?? null,
            balanceState: position?.lastReconciledBalance == null ? 'unknown' : 'known',
          };
        }),
        queryApplied, completeness,
      },
      queryApplied, basisVersion: BUSINESS_READ_BASIS_VERSION,
      facts: accounts.map((account) => {
        const position = positionsById.get(account.id);
        return fact({
          id: `bank.balance.${account.id}`, metric: 'last_reconciled_balance',
          value: position?.lastReconciledBalance ?? null, unit: 'money', currency: account.currency, period: null,
          dateBasis: queryApplied.dateBasis, statusBasis: queryApplied.statusBasis,
          sourceRefIds: [sourceRefId(accountRef(ctx, asOf, account.id, account.displayName))], asOf,
          state: position?.lastReconciledBalance == null ? 'unknown' : 'known',
        });
      }),
      completeness,
    };
  }
}

@Injectable()
export class BankGetReconciliationStatusTool implements ErpReadToolPort {
  readonly toolName = 'bank.get_reconciliation_status';
  constructor(private readonly getStatus: GetReconciliationStatusUseCase) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const initialAsOf = new Date().toISOString();
    if (!ctx.permissions.includes('bank.reconciliation.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf: initialAsOf };
    }
    const snapshot = await this.getStatus.execute(toCtx(ctx));
    const asOf = snapshot.asOf.toISOString();
    const sourceRefs = snapshot.accounts.map((account) => accountRef(ctx, asOf, account.bankAccountId, account.bankAccountDisplayName));
    const queryApplied = appliedQuery(undefined, {
      branch: { mode: 'all_authorized', branchId: null }, dateBasis: 'current_reconciliation_snapshot',
      statusBasis: 'current_statement_and_adjustment_status_plus_last_completed_session',
      dataset: 'bank_reconciliation_status',
    });
    const completeness = completeResult(snapshot.accounts.length, false, 0, false);
    return {
      toolName: this.toolName, status: 'ok', asOf, sourceRefs,
      data: {
        basis: 'current_pending_counts_and_last_completed_reconciliation',
        accounts: snapshot.accounts.map((account) => ({
          bankAccountId: account.bankAccountId, displayName: account.bankAccountDisplayName, currency: account.currency,
          lastCompletedReconciliationDate: account.lastReconciledDate ?? null,
          lastCompletedClosingBalance: account.lastReconciledBalance ?? null,
          unmatchedLineCount: account.unmatchedLineCount,
          unreconciledLineCount: account.unreconciledLineCount,
          pendingAdjustmentCount: account.pendingAdjustmentCount,
          lastStatementDate: account.lastStatementDate ?? null,
        })),
        queryApplied, completeness,
      },
      queryApplied, basisVersion: BUSINESS_READ_BASIS_VERSION,
      facts: snapshot.accounts.flatMap((account) => [
        fact({
          id: `bank.reconciliation.unmatched.${account.bankAccountId}`, metric: 'unmatched_statement_line_count',
          value: String(account.unmatchedLineCount), unit: 'count', currency: null, period: null,
          dateBasis: queryApplied.dateBasis, statusBasis: queryApplied.statusBasis,
          sourceRefIds: [sourceRefId(accountRef(ctx, asOf, account.bankAccountId, account.bankAccountDisplayName))], asOf,
          state: account.unmatchedLineCount === 0 ? 'empty' : 'known',
        }),
        fact({
          id: `bank.reconciliation.pending_adjustments.${account.bankAccountId}`, metric: 'pending_bank_adjustment_count',
          value: String(account.pendingAdjustmentCount), unit: 'count', currency: null, period: null,
          dateBasis: queryApplied.dateBasis, statusBasis: queryApplied.statusBasis,
          sourceRefIds: [sourceRefId(accountRef(ctx, asOf, account.bankAccountId, account.bankAccountDisplayName))], asOf,
          state: account.pendingAdjustmentCount === 0 ? 'empty' : 'known',
        }),
      ]),
      completeness,
    };
  }
}
