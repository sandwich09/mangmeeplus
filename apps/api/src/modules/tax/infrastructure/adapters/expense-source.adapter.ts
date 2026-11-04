import { Prisma } from '../../../../generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { civilDate, civilDateToUtcDate } from '@watchdog-bms/contracts';
import { allocateExpenseWithholding } from '../../domain/logic/expense-payment-withholding.logic';
import { expenseWhtHeaderRate, expenseWhtIncomeBase } from '../../../expenses/domain/logic/expense-wht-input.logic';
import type { ExpenseWhtCapture } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { counterpartyAddressText } from '../../../accounting-documents/domain/logic/vendor-counterparty-match.logic';
import type { ExpenseSourceRow, ExpenseWhtSourceRow, TransactionTaxSourceLineRow } from '../../domain/ports/source-reader.port';

@Injectable()
export class ExpenseSourceAdapter {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * §10 fallback (Phase 1 gap): `ExpenseRecord` has no Prisma relation to the counterparty, only
   * the scalar `vendorCounterpartyId` column, so rows whose own `vendorAddressSnapshot` is empty
   * are batched into ONE registry lookup here instead of a query per row. Precedence stays
   * snapshot → registry → null; a row with a snapshot never needs its id in the batch at all.
   */
  private async resolveVendorAddresses(
    companyId: string,
    rows: Array<{ vendorAddressSnapshot: string | null; vendorCounterpartyId: string | null }>,
  ): Promise<Map<string, string | null>> {
    const ids = [...new Set(
      rows.filter(r => !r.vendorAddressSnapshot && r.vendorCounterpartyId).map(r => r.vendorCounterpartyId as string),
    )];
    if (ids.length === 0) return new Map();
    const registry = await this.prisma.client.accountingCounterparty.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true, billingAddressJson: true },
    });
    return new Map(registry.map(c => [c.id, counterpartyAddressText(c.billingAddressJson ?? null)]));
  }

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
    const registryAddresses = await this.resolveVendorAddresses(companyId, rows);

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
      // §10 fallback: the document's own printed address wins; the registry only fills a gap.
      vendorAddress: r.vendorAddressSnapshot ?? (r.vendorCounterpartyId ? registryAddresses.get(r.vendorCounterpartyId) ?? null : null),
      currency: r.currency ?? 'THB',
      updatedAt: r.updatedAt, confirmedAt: r.confirmedAt,
    }));
  }

  async findConfirmedWithWhtByCompany(companyId: string, since?: Date, filter?: { expenseIds?: string[] }): Promise<ExpenseWhtSourceRow[]> {
    if (filter?.expenseIds?.length === 0) return [];
    const rows = await this.prisma.client.expenseRecord.findMany({
      where: {
        companyId,
        ...(filter?.expenseIds !== undefined ? { id: { in: filter.expenseIds } } : {}),
        status: 'CONFIRMED',
        whtAmount: { gt: 0 },
        // Read all payments: a void or late payment can change an older unfiled month.
      },
      include: { payments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, lines: { where: { whtAmount: { gt: 0 } }, select: { id: true, whtCategoryCode: true, whtRate: true, taxableAmount: true, whtAmount: true } } },
      orderBy: { expenseDate: 'asc' },
    });
    if (!rows.length) return [];
    const registryAddresses = await this.resolveVendorAddresses(companyId, rows);
    // A missing legacy snapshot can be completed in คู่ค้า; explicit foreign/other kinds stay unresolved.
    const unknownIds = [...new Set(rows.filter(row => row.vendorEntityKindSnapshot == null && row.vendorCounterpartyId)
      .map(row => row.vendorCounterpartyId!))];
    const counterparties = unknownIds.length ? await this.prisma.client.accountingCounterparty.findMany({
      where: { companyId, id: { in: unknownIds } }, select: { id: true, entityKind: true },
    }) : [];
    const kinds = new Map(counterparties.map(row => [row.id, row.entityKind]));

    const filedLines = await this.prisma.client.whtFilingLine.findMany({ where: { sourceType: 'expense.record', sourceId: { in: rows.map(r => r.id) }, filing: { companyId, status: 'FILED' } }, select: { lineJson: true } });
    const frozen = new Map<string, { grossAmount: string; whtAmount: string }>();
    for (const line of filedLines) {
      const facts = (line.lineJson as { payment?: (string | null)[] }).payment;
      if (facts?.[13]?.startsWith('payment:')) frozen.set(facts[13], { grossAmount: facts[6] ?? '0', whtAmount: facts[7] ?? '0' });
    }
    const company = await this.prisma.client.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    return rows.flatMap(r => {
      const input = r.whtInputJson as ExpenseWhtCapture | null;
      const rate = expenseWhtHeaderRate(input, r.lines, r.whtRate);
      const facts = { whtRate: rate === null ? null : new Prisma.Decimal(rate).toFixed(4), grossAmount: expenseWhtIncomeBase({ ...r, whtInputJson: input }) };
      // Whole-bill capture remains one line. Independently classified/rated legacy lines keep
      // their own base, rate and satang remainder instead of collapsing to an unknown rate.
      const split = !r.whtInputJson && (r.lines?.length ?? 0) > 1;
      const lines = split ? r.lines.map(l => ({ key: l.id, incomeCategoryCode: l.whtCategoryCode ?? r.whtCategoryCode,
        whtRate: l.whtRate == null ? null : new Prisma.Decimal(l.whtRate).mul(100).toFixed(4),
        grossAmount: String(l.taxableAmount), whtAmount: String(l.whtAmount) }))
        : [{ key: null, incomeCategoryCode: r.lines?.[0]?.whtCategoryCode ?? r.whtCategoryCode, ...facts, whtAmount: String(r.whtAmount) }];
      return lines.flatMap(line => allocateExpenseWithholding(r.payments, String(r.netPayableAmount), line.grossAmount, line.whtAmount,
        new Map(r.payments.flatMap(p => { const fixed = frozen.get(`payment:${p.id}${line.key ? `:line:${line.key}` : ''}`); return fixed ? [[p.id, fixed] as const] : []; })), new Prisma.Decimal(String(r.netPayableAmount)).add(String(r.whtAmount)).toString())
        .filter(payment => payment.paidAtConfirmed).map(payment => ({
      sourceLineKey: `payment:${payment.id}${line.key ? `:line:${line.key}` : ''}`,
      id: r.id,
      companyId: r.companyId,
      branchId: r.branchId ?? null,
      paymentId: payment.id,
      paymentAmount: String(payment.amount),
      documentDate: r.expenseDate,
      expenseDate: civilDateToUtcDate(civilDate(payment.paidAt, company?.timezone ?? 'Asia/Bangkok')),
      vendorName: r.vendorNameSnapshot ?? null,
      vendorTaxId: r.vendorTaxIdSnapshot ?? null,
      vendorBranchCode: r.vendorBranchCodeSnapshot ?? null,
      // §10 fallback (Phase 1 gap): the printed snapshot wins; the registry only fills a gap, and
      // is not part of `computeSourceHash` in sync-tax-events — no backfill, new amounts only.
      vendorAddress: r.vendorAddressSnapshot ?? (r.vendorCounterpartyId ? registryAddresses.get(r.vendorCounterpartyId) ?? null : null),
      payeeEntityKind: r.vendorEntityKindSnapshot ?? kinds.get(r.vendorCounterpartyId ?? '') ?? null,
      incomeCategoryCode: line.incomeCategoryCode ?? null,
      whtRate: line.whtRate,
      grossAmount: payment.grossAmount,
      whtAmount: payment.whtAmount,
      currency: r.currency ?? 'THB',
      updatedAt: r.updatedAt, confirmedAt: r.confirmedAt,
    })));
    });
  }

  async findFinalizedTransactionTaxLines(companyId: string, since?: Date): Promise<TransactionTaxSourceLineRow[]> {
    const db = this.prisma.client as any;
    const [expenses, bills] = await Promise.all([
      db.expenseRecord.findMany({ where: { companyId, status: 'CONFIRMED', lines: { some: { taxComponentsJson: { not: null } } }, ...(since ? { updatedAt: { gte: since } } : {}) }, include: { lines: { where: { taxComponentsJson: { not: null } }, orderBy: { lineNumber: 'asc' } } } }),
      db.vendorBill.findMany({ where: { companyId, status: { in: ['APPROVED', 'PARTIALLY_PAID', 'PAID', 'CREDITED'] }, lines: { some: { taxComponentsJson: { not: null } } }, ...(since ? { updatedAt: { gte: since } } : {}) }, include: { lines: { where: { taxComponentsJson: { not: null } }, orderBy: { lineNumber: 'asc' } } } }),
    ]);
    const expand = (rows: any[], sourceType: TransactionTaxSourceLineRow['sourceType'], dateKey: string, numberKey: string): TransactionTaxSourceLineRow[] => rows.flatMap((row: any) => row.lines.map((line: any) => ({
      inputVatClaimStatus: row.inputVatClaimStatus, taxEvidenceStatus: row.taxEvidenceStatus, sourceType, sourceId: row.id, sourceLineId: line.id, companyId: row.companyId, branchId: row.branchId ?? null,
      sourceEventType: row.status, eventDate: row[dateKey], currency: row.currency, vatMode: row.vatMode ?? null,
      taxInvoiceNumber: row[numberKey] ?? null, taxComponents: Array.isArray(line.taxComponentsJson) ? line.taxComponentsJson : [], updatedAt: row.updatedAt, confirmedAt: row.confirmedAt,
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
      inputVatClaimStatus: row.inputVatClaimStatus, taxEvidenceStatus: row.taxEvidenceStatus, sourceType, sourceId: row.id, sourceLineId: line.id, companyId: row.companyId, branchId: row.branchId ?? null, sourceEventType: 'VOIDED',
      eventDate: row[dateKey], currency: row.currency, vatMode: row.vatMode ?? null, taxInvoiceNumber: row.taxInvoiceNumber ?? null,
      taxComponents: Array.isArray(line.taxComponentsJson) ? line.taxComponentsJson : [], updatedAt: row.updatedAt, confirmedAt: row.confirmedAt,
    })));
    return [...expand(expenses, 'expense.record', 'expenseDate'), ...expand(bills, 'procurement.vendor_bill', 'billDate')];
  }
}
