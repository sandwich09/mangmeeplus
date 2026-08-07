import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { ExpenseSourceRow, ExpenseWhtSourceRow, TransactionTaxSourceLineRow } from '../../domain/ports/source-reader.port';

/** RA-19: rate and base live on the withholding lines, and the header WHT event can only carry one
 *  of each. Two unit/base translations are mandatory here:
 *  - `ExpenseLine.whtRate` is a fraction (`calcLineTotals` does `taxable * whtRate`) while every tax
 *    consumer means a percent (`WhtIncomeCategory.defaultRate` '3.0000' = 3%, `vendor-bill.use-case`
 *    divides by 100), so the fraction is scaled to percent.
 *  - gross must be the base the rate applies to, so only withholding lines count; the header
 *    `taxableAmount` also sums non-WHT lines and would make gross x rate != withheld on the ใบแนบ.
 *  The ใบแนบ groups by payee + income category + rate, so a document mixing rates has no header rate
 *  to report — leave it null for review instead of picking one line's rate. */
function whtLineFacts(lines: Array<{ whtRate: unknown; taxableAmount: unknown }> | undefined, headerBase: string) {
  const rates = new Set((lines ?? []).map(l => (l.whtRate === null || l.whtRate === undefined ? '' : String(l.whtRate))).filter(Boolean));
  const lineBase = (lines ?? []).reduce((sum, l) => sum + (Number(l.taxableAmount) || 0), 0);
  return {
    whtRate: rates.size === 1 ? (Number([...rates][0]) * 100).toFixed(4) : null,
    grossAmount: lineBase > 0 ? lineBase.toFixed(4) : headerBase,
  };
}

@Injectable()
export class ExpenseSourceAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async findConfirmedWithVatByCompany(companyId: string, since?: Date): Promise<ExpenseSourceRow[]> {
    const rows = await this.prisma.client.expenseRecord.findMany({
      where: {
        companyId,
        status: 'CONFIRMED',
        vatMode: { not: 'NO_VAT' },
        lines: { none: { taxComponentsJson: { not: null } } },
        ...(since ? { updatedAt: { gte: since } } : {}),
      } as any,
      orderBy: { expenseDate: 'asc' },
    });

    return rows.map(r => ({
      id: r.id,
      companyId: r.companyId,
      expenseDate: r.expenseDate,
      vatAmount: String(r.vatAmount ?? '0'),
      whtAmount: String(r.whtAmount ?? '0'),
      taxableAmount: String(r.taxableAmount ?? '0'),
      grandTotalAmount: String(r.grandTotalAmount ?? '0'),
      inputVatClaimStatus: r.inputVatClaimStatus,
      taxEvidenceStatus: r.taxEvidenceStatus,
      vatMode: r.vatMode,
      vendorName: r.vendorNameSnapshot ?? null,
      vendorTaxId: r.vendorTaxIdSnapshot ?? null,
      vendorBranchCode: r.vendorBranchCodeSnapshot ?? null,
      currency: r.currency ?? 'THB',
      updatedAt: r.updatedAt,
    }));
  }

  async findConfirmedWithWhtByCompany(companyId: string, since?: Date): Promise<ExpenseWhtSourceRow[]> {
    const rows = await this.prisma.client.expenseRecord.findMany({
      where: {
        companyId,
        status: 'CONFIRMED',
        whtAmount: { gt: 0 },
        ...(since ? { updatedAt: { gte: since } } : {}),
      },
      include: { lines: { where: { whtAmount: { gt: 0 } }, select: { whtRate: true, taxableAmount: true } } },
      orderBy: { expenseDate: 'asc' },
    });

    return rows.map(r => ({
      id: r.id,
      companyId: r.companyId,
      expenseDate: r.expenseDate,
      whtAmount: String(r.whtAmount ?? '0'),
      vendorName: r.vendorNameSnapshot ?? null,
      vendorTaxId: r.vendorTaxIdSnapshot ?? null,
      vendorBranchCode: r.vendorBranchCodeSnapshot ?? null,
      payeeEntityKind: r.vendorEntityKindSnapshot ?? null,
      incomeCategoryCode: r.taxCategory ?? null,
      ...whtLineFacts(r.lines, String(r.taxableAmount ?? '0')),
      currency: r.currency ?? 'THB',
      updatedAt: r.updatedAt,
    }));
  }

  async findFinalizedTransactionTaxLines(companyId: string, since?: Date): Promise<TransactionTaxSourceLineRow[]> {
    const db = this.prisma.client as any;
    const [expenses, bills] = await Promise.all([
      db.expenseRecord.findMany({ where: { companyId, status: 'CONFIRMED', lines: { some: { taxComponentsJson: { not: null } } }, ...(since ? { updatedAt: { gte: since } } : {}) }, include: { lines: { where: { taxComponentsJson: { not: null } }, orderBy: { lineNumber: 'asc' } } } }),
      db.vendorBill.findMany({ where: { companyId, status: { in: ['APPROVED', 'PARTIALLY_PAID', 'PAID', 'CREDITED'] }, lines: { some: { taxComponentsJson: { not: null } } }, ...(since ? { updatedAt: { gte: since } } : {}) }, include: { lines: { where: { taxComponentsJson: { not: null } }, orderBy: { lineNumber: 'asc' } } } }),
    ]);
    const expand = (rows: any[], sourceType: TransactionTaxSourceLineRow['sourceType'], dateKey: string, numberKey: string): TransactionTaxSourceLineRow[] => rows.flatMap((row: any) => row.lines.map((line: any) => ({
      sourceType, sourceId: row.id, sourceLineId: line.id, companyId: row.companyId, branchId: row.branchId ?? null,
      sourceEventType: row.status, eventDate: row[dateKey], currency: row.currency, vatMode: row.vatMode ?? null,
      taxInvoiceNumber: row[numberKey] ?? null, taxComponents: Array.isArray(line.taxComponentsJson) ? line.taxComponentsJson : [], updatedAt: row.updatedAt,
    })));
    return [...expand(expenses, 'expense.record', 'expenseDate', 'vendorDocumentNumber'), ...expand(bills, 'procurement.vendor_bill', 'billDate', 'taxInvoiceNumber')];
  }

  async findVoidedTransactionTaxLines(companyId: string, since?: Date): Promise<TransactionTaxSourceLineRow[]> {
    const db = this.prisma.client as any;
    const [expenses, bills] = await Promise.all([
      db.expenseRecord.findMany({ where: { companyId, status: 'VOIDED', lines: { some: { taxComponentsJson: { not: null } } }, ...(since ? { updatedAt: { gte: since } } : {}) }, include: { lines: { where: { taxComponentsJson: { not: null } } } } }),
      db.vendorBill.findMany({ where: { companyId, status: 'VOIDED', lines: { some: { taxComponentsJson: { not: null } } }, ...(since ? { updatedAt: { gte: since } } : {}) }, include: { lines: { where: { taxComponentsJson: { not: null } } } } }),
    ]);
    const expand = (rows: any[], sourceType: TransactionTaxSourceLineRow['sourceType'], dateKey: string): TransactionTaxSourceLineRow[] => rows.flatMap((row: any) => row.lines.map((line: any) => ({
      sourceType, sourceId: row.id, sourceLineId: line.id, companyId: row.companyId, branchId: row.branchId ?? null, sourceEventType: 'VOIDED',
      eventDate: row[dateKey], currency: row.currency, vatMode: row.vatMode ?? null, taxInvoiceNumber: row.taxInvoiceNumber ?? null,
      taxComponents: Array.isArray(line.taxComponentsJson) ? line.taxComponentsJson : [], updatedAt: row.updatedAt,
    })));
    return [...expand(expenses, 'expense.record', 'expenseDate'), ...expand(bills, 'procurement.vendor_bill', 'billDate')];
  }
}
