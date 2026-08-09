import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { BankMatchCandidate } from '@watchdog-bms/contracts';
import { applyConfirmedAllocations, candidateAllocationKey, sumDecimalAmounts } from '../domain/logic/banking.logic';
import { branchScopeWhere } from '../../data-model-core/domain/logic/branch.logic';

type RawCandidate = Omit<BankMatchCandidate, 'remainingUnmatchedAmount'>;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Read-only cross-module query returning payment facts as match candidates.
 * Source modules (items 08/09/12/14) stay owners of the payment records;
 * this adapter only reads committed, non-voided facts.
 * ponytail: LEDGER_JOURNAL_LINE candidates deferred until a real need shows up.
 */
@Injectable()
export class PrismaMatchSourceQuery {
  constructor(private readonly prisma: PrismaService) {}

  async listCandidates(companyId: string, branchIds?: string[]): Promise<BankMatchCandidate[]> {
    const [customerPayments, expensePayments, supplierPayments, reimbursementPayments, adjustments, confirmedMatches] =
      await Promise.all([
        this.prisma.client.accountingPayment.findMany({
          where: { companyId, ...branchScopeWhere({ branchIds }), status: 'RECORDED', direction: 'RECEIVED' },
          orderBy: { paidAt: 'desc' },
        }),
        this.prisma.client.expensePayment.findMany({
          where: {
            companyId,
            status: 'RECORDED',
            expense: { is: { ...branchScopeWhere({ branchIds }), status: { not: 'VOIDED' }, sourceReimbursementRequestId: null } },
          },
          orderBy: { paidAt: 'desc' },
          include: { expense: { select: { expenseNumber: true, vendorNameSnapshot: true, vendorDocumentNumber: true } } },
        }),
        this.prisma.client.supplierPayment.findMany({
          where: { companyId, ...branchScopeWhere({ branchIds }), status: 'RECORDED' },
          orderBy: { paymentDate: 'desc' },
        }),
        this.prisma.client.reimbursementPayment.findMany({
          where: {
            companyId,
            status: 'RECORDED',
            ...(branchIds ? { request: branchScopeWhere({ branchIds }) } : {}),
          },
          orderBy: { paidAt: 'desc' },
          include: { request: { select: { requesterDisplayNameSnapshot: true } } },
        }),
        this.prisma.client.bankAdjustment.findMany({
          where: {
            companyId,
            status: { in: ['APPROVED', 'POSTED'] },
            ...(branchIds ? { bankAccount: branchScopeWhere({ branchIds }) } : {}),
          },
          orderBy: { adjustmentDate: 'desc' },
        }),
        this.prisma.client.bankReconciliationMatch.findMany({
          where: {
            companyId,
            status: 'CONFIRMED',
            ...(branchIds ? { bankAccount: branchScopeWhere({ branchIds }) } : {}),
          },
          select: { sourceType: true, sourceId: true, allocatedAmount: true },
        }),
      ]);

    const raw: RawCandidate[] = [
      ...customerPayments.map((p): RawCandidate => ({
        sourceType: 'CUSTOMER_PAYMENT',
        sourceId: p.id,
        sourceDisplayNumber: p.paymentNumber ?? undefined,
        companyId,
        direction: 'DEPOSIT',
        paymentDate: isoDate(p.paidAt),
        amount: p.amount.toString(),
        currency: p.currency,
        counterpartyName: (p.counterpartySnapshotJson as { displayName?: string } | null)?.displayName,
        reference: p.externalReference ?? undefined,
        status: p.status,
        webUrl: `/companies/${companyId}/accounting`,
      })),
      ...expensePayments.map((p): RawCandidate => ({
        sourceType: 'EXPENSE_PAYMENT',
        sourceId: p.id,
        sourceDisplayNumber: p.expense.expenseNumber ?? undefined,
        companyId,
        direction: 'WITHDRAWAL',
        paymentDate: isoDate(p.paidAt),
        amount: p.amount.toString(),
        currency: p.currency,
        counterpartyName: p.expense.vendorNameSnapshot ?? undefined,
        reference: p.bankAccountRef ?? p.expense.vendorDocumentNumber ?? undefined,
        status: p.status,
        webUrl: `/companies/${companyId}/expenses`,
      })),
      ...supplierPayments.map((p): RawCandidate => ({
        sourceType: 'SUPPLIER_PAYMENT',
        sourceId: p.id,
        sourceDisplayNumber: p.paymentNumber ?? undefined,
        companyId,
        direction: 'WITHDRAWAL',
        paymentDate: isoDate(p.paymentDate),
        amount: p.netPaidAmount.toString(),
        currency: p.currency,
        counterpartyName: (p.supplierSnapshotJson as { displayName?: string } | null)?.displayName,
        reference: p.externalReference ?? undefined,
        status: p.status,
        webUrl: `/companies/${companyId}/accounts-payable`,
      })),
      ...reimbursementPayments.map((p): RawCandidate => ({
        sourceType: 'REIMBURSEMENT_PAYMENT',
        sourceId: p.id,
        sourceDisplayNumber: p.paymentNo ?? undefined,
        companyId,
        direction: 'WITHDRAWAL',
        paymentDate: isoDate(p.paidAt),
        amount: p.paidAmount.toString(),
        currency: p.currency,
        counterpartyName: p.request?.requesterDisplayNameSnapshot ?? undefined,
        reference: p.paymentReference ?? undefined,
        status: p.status,
        webUrl: `/companies/${companyId}/reimbursements`,
      })),
      ...adjustments.map((a): RawCandidate => ({
        sourceType: 'BANK_ADJUSTMENT',
        sourceId: a.id,
        sourceDisplayNumber: a.adjustmentNumber ?? undefined,
        companyId,
        bankAccountId: a.bankAccountId,
        direction: Number(a.signedAmount) >= 0 ? 'DEPOSIT' : 'WITHDRAWAL',
        paymentDate: isoDate(a.adjustmentDate),
        amount: a.signedAmount.toString(),
        currency: a.currency,
        counterpartyName: a.counterpartyName ?? undefined,
        reference: undefined,
        status: a.status,
        webUrl: `/companies/${companyId}/banking`,
      })),
    ];

    const confirmedTotalsByKey: Record<string, string> = {};
    for (const m of confirmedMatches) {
      const key = candidateAllocationKey(m.sourceType, m.sourceId);
      confirmedTotalsByKey[key] = sumDecimalAmounts([confirmedTotalsByKey[key] ?? '0', m.allocatedAmount.toString()]);
    }

    return applyConfirmedAllocations(raw, confirmedTotalsByKey);
  }
}
