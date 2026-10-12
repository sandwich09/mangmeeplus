import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { DISBURSEMENT_VOUCHER_WORDS, coerceCivilDate,
  type RequestContext, type DisbursementPayee, type DisbursementPayeePage, type DisbursementPayeeQuery,
  type DisbursementPayableExpense, type DisbursementPayableExpenseQuery,
} from '@watchdog-bms/contracts';
import { normalizeVendorName, toAsciiDigits, vendorMatchKey } from '../../../accounting-documents/domain/logic/vendor-counterparty-match.logic';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { ListExpensesUseCase } from './expense-draft.use-case';
import { disbursementExpenseSelectionReason as selectionReason } from '../../infrastructure/expense-void-blocker';

type Source = Awaited<ReturnType<PrismaExpenseRepository['readDisbursementPayableExpenses']>>[number];
// A batch sum can have more significant digits than a single DECIMAL(18,4) column.
const BatchAmount = Decimal.clone({ precision: 40 });

function payeeIdentity(expense: Source) {
  const key = vendorMatchKey({ name: expense.vendorNameSnapshot, taxId: expense.vendorTaxIdSnapshot });
  const identity = key?.kind === 'TAX_ID' ? `tax:${key.taxId}` : key?.kind === 'NAME' ? `name:${key.name}` : `expense:${expense.id}`;
  return { payeeKey: createHash('sha256').update(identity).digest('base64url'), payeeKeyKind: key?.kind ?? null, taxId: key?.kind === 'TAX_ID' ? key.taxId : null };
}

function matchesSearch(expense: Source, search: string | undefined, includeExpenseNumber = false): boolean {
  if (!search?.trim()) return true;
  const name = normalizeVendorName(search);
  const digits = toAsciiDigits(search);
  return Boolean(name && normalizeVendorName(expense.vendorNameSnapshot).includes(name)
    || digits && toAsciiDigits(expense.vendorTaxIdSnapshot).includes(digits)
    || includeExpenseNumber && name && normalizeVendorName(expense.expenseNumber).includes(name));
}

@Injectable()
export class ReadDisbursementVoucherSourcesUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly expenses: ListExpensesUseCase) {}

  private async sources(ctx: RequestContext, query: DisbursementPayableExpenseQuery) {
    if (ctx.authProvider === 'line') throw new ForbiddenException(DISBURSEMENT_VOUCHER_WORDS.webSignInRequired);
    if (!ctx.permissions.includes('expense.disbursement.prepare')) throw new ForbiddenException(DISBURSEMENT_VOUCHER_WORDS.preparePermissionRequired);
    for (const field of ['search', 'branchId', 'payeeKey'] as const) {
      if (query[field] !== undefined && typeof query[field] !== 'string') throw new BadRequestException(DISBURSEMENT_VOUCHER_WORDS.sourceQueryInvalid);
    }
    const { branchId } = query;
    const scope = this.expenses.readScope(ctx, branchId);
    return this.repo.readDisbursementPayableExpenses({ companyId: ctx.companyId, ...(branchId ? { branchId } : {}), ...scope.filter }, ctx.scopes, scope.scope.relatedUserId, ctx.permissions);
  }

  async payees(ctx: RequestContext, query: DisbursementPayeeQuery): Promise<DisbursementPayeePage> {
    const groups = new Map<string, { payee: DisbursementPayee; amount: Decimal; newest: Source; matches: boolean }>();
    for (const expense of await this.sources(ctx, query)) {
      const identity = payeeIdentity(expense);
      let group = groups.get(identity.payeeKey);
      if (!group) {
        group = { payee: { payeeKey: identity.payeeKey, taxId: identity.taxId, displayName: '', expenseCount: 0, totalOutstanding: '', selectableExpenseCount: 0 }, amount: new BatchAmount(0), newest: expense, matches: false };
        groups.set(identity.payeeKey, group);
      }
      if (expense.createdAt > group.newest.createdAt || expense.createdAt.getTime() === group.newest.createdAt.getTime() && expense.id > group.newest.id) group.newest = expense;
      group.payee.expenseCount++;
      group.payee.selectableExpenseCount += selectionReason(expense) === null ? 1 : 0;
      group.amount = group.amount.plus(String(expense.outstandingAmount));
      group.matches ||= matchesSearch(expense, query.search);
    }
    const matching = [...groups.values()].filter(g => g.matches).sort((a, b) => b.amount.cmp(a.amount) || a.payee.payeeKey.localeCompare(b.payee.payeeKey));
    const page = Number.isFinite(query.page) ? Math.max(1, Math.floor(query.page!)) : 1;
    const pageSize = Number.isFinite(query.pageSize) ? Math.min(200, Math.max(1, Math.floor(query.pageSize!))) : 20;
    return { data: matching.slice((page - 1) * pageSize, page * pageSize).map(g => ({ ...g.payee,
      displayName: g.newest.vendorNameSnapshot?.trim() || DISBURSEMENT_VOUCHER_WORDS.unnamedPayee, totalOutstanding: g.amount.toFixed(4),
    })), total: matching.length, page, pageSize };
  }

  async payableExpenses(ctx: RequestContext, query: DisbursementPayableExpenseQuery): Promise<DisbursementPayableExpense[]> {
    const rows = await this.sources(ctx, query);
    return rows.filter(e => (!query.payeeKey || payeeIdentity(e).payeeKey === query.payeeKey) && matchesSearch(e, query.search, true)).map(e => {
      const reasonCode = selectionReason(e);
      const identity = payeeIdentity(e);
      return { payeeKey: identity.payeeKey, payeeKeyKind: identity.payeeKeyKind, expenseId: e.id, expenseNumber: e.expenseNumber, expenseDate: coerceCivilDate(e.expenseDate),
        vendorName: e.vendorNameSnapshot, vendorTaxId: e.vendorTaxIdSnapshot, branchId: e.branchId,
        description: Array.from(e.lines?.[0]?.description?.trim() || '').slice(0, 80).join('') || null,
        vendorInvoiceNumber: e.vendorDocumentNumber ?? null, branchName: e.branchName ?? null,
        grandTotalAmount: new Decimal(String(e.grandTotalAmount)).toFixed(4), whtAmount: new Decimal(String(e.whtAmount)).toFixed(4),
        netPayableAmount: new Decimal(String(e.netPayableAmount)).toFixed(4), outstandingAmount: new Decimal(String(e.outstandingAmount)).toFixed(4),
        selectable: reasonCode === null, reasonCode, reservation: e.reservation,
      };
    });
  }
}
