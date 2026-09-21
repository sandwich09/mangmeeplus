import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { AccountingDocumentSourceRow, TransactionTaxSourceLineRow } from '../../domain/ports/source-reader.port';

/** `BuyerSnapshotV1.addressText` when the frozen snapshot has one. Legacy snapshots hold only
 *  `{id, displayName, taxId, legalName}`, so anything else answers null rather than throwing.
 *  Not the counterparty registry's `billingAddressJson` (that is `counterpartyAddressText`): this
 *  reads the document's OWN frozen snapshot, which is what was printed on the paper. */
function buyerSnapshotAddressText(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const addressText = (value as Record<string, unknown>)['addressText'];
  return typeof addressText === 'string' && addressText.trim() ? addressText : null;
}

@Injectable()
export class AccountingDocumentSourceAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async findIssuedWithVatByCompany(companyId: string, since?: Date): Promise<AccountingDocumentSourceRow[]> {
    const rows = await this.prisma.client.accountingDocument.findMany({
      where: {
        companyId,
        status: 'ISSUED',
        documentType: { in: ['TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] },
        outputTaxCode: { not: null },
        lines: { none: { taxComponentsJson: { not: null } } },
        ...(since ? { updatedAt: { gte: since } } : {}),
      } as any,
      include: { counterparty: true },
      orderBy: { documentDate: 'asc' },
    });

    return rows.map(r => ({
      id: r.id,
      companyId: r.companyId,
      documentType: r.documentType,
      documentNumber: r.documentNumber ?? null,
      documentDate: r.documentDate,
      vatMode: r.vatMode,
      outputTaxCode: r.outputTaxCode!,
      vatAmount: String(r.vatAmount ?? '0'),
      taxableAmount: String(r.taxableAmount ?? '0'),
      grandTotalAmount: String(r.grandTotalAmount ?? '0'),
      taxInvoiceType: r.taxInvoiceType ?? null,
      taxInvoiceId: r.taxInvoiceId ?? null,
      counterpartyName: (r.counterparty as any)?.displayName ?? null,
      counterpartyTaxId: (r.counterparty as any)?.taxId ?? null,
      // GAP-2: the frozen buyer snapshot already rides on this row (no extra query); its
      // `addressText` is the address that was printed on the document we issued. Read defensively —
      // snapshots frozen before BuyerSnapshotV1 carry no address at all.
      counterpartyAddress: buyerSnapshotAddressText(r.counterpartySnapshotJson),
      branchCode: null,
      currency: r.currency,
      updatedAt: r.updatedAt,
    }));
  }

  async findFinalizedTransactionTaxLines(companyId: string, since?: Date): Promise<TransactionTaxSourceLineRow[]> {
    const rows = await (this.prisma.client as any).accountingDocument.findMany({ where: {
      companyId, status: { in: ['ISSUED', 'CREDITED', 'DEBITED', 'CLOSED'] }, documentType: { not: 'RECEIPT' },
      lines: { some: { taxComponentsJson: { not: null } } }, ...(since ? { updatedAt: { gte: since } } : {}),
    }, include: { lines: { where: { taxComponentsJson: { not: null } }, orderBy: { lineNumber: 'asc' } } } });
    return rows.flatMap((row: any) => row.lines.map((line: any) => ({
      sourceType: 'accounting.document' as const, sourceId: row.id, sourceLineId: line.id, companyId: row.companyId,
      branchId: row.branchId ?? null, sourceEventType: row.documentType, eventDate: row.documentDate,
      currency: row.currency, vatMode: row.vatMode, taxInvoiceNumber: row.documentNumber ?? row.taxInvoiceId ?? null,
      taxComponents: Array.isArray(line.taxComponentsJson) ? line.taxComponentsJson : [], updatedAt: row.updatedAt,
    })));
  }

  async findVoidedTransactionTaxLines(companyId: string, since?: Date): Promise<TransactionTaxSourceLineRow[]> {
    const rows = await (this.prisma.client as any).accountingDocument.findMany({ where: { companyId, status: 'VOIDED', lines: { some: { taxComponentsJson: { not: null } } }, ...(since ? { updatedAt: { gte: since } } : {}) }, include: { lines: { where: { taxComponentsJson: { not: null } } } } });
    return rows.flatMap((row: any) => row.lines.map((line: any) => ({
      sourceType: 'accounting.document' as const, sourceId: row.id, sourceLineId: line.id, companyId: row.companyId, branchId: row.branchId ?? null,
      sourceEventType: 'VOIDED', eventDate: row.documentDate, currency: row.currency, vatMode: row.vatMode,
      taxInvoiceNumber: row.documentNumber ?? null, taxComponents: Array.isArray(line.taxComponentsJson) ? line.taxComponentsJson : [], updatedAt: row.updatedAt,
    })));
  }
}
