import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaAccountingRepository } from '../../infrastructure/prisma-accounting.repository';
import type { RequestContext, AccountingSourcePostingInput, AccountingSourcePostingLine, LedgerSourcePostingInput } from '@watchdog-bms/contracts';
import { civilDate, civilPeriodKey, coerceCivilDate } from '@watchdog-bms/contracts';
import type { DocumentRecord, PaymentRecord } from '../../domain/models/accounting.model';

/**
 * Provides a deterministic, ledger-ready source posting input for finalized
 * accounting documents. Item 10 calls this endpoint to generate journal entries.
 */
@Injectable()
export class GetDocumentPostingSourceUseCase {
  constructor(private readonly repo: PrismaAccountingRepository) {}

  async execute(ctx: RequestContext, documentId: string): Promise<AccountingSourcePostingInput> {
    // Internal ledger access requires admin-level or explicit internal permission
    const hasAccess = ctx.permissions.includes('accounting.document.read') ||
      ctx.permissions.includes('admin.role.manage');
    if (!hasAccess) throw new ForbiddenException('Missing permission to read posting source');

    const doc = await this.repo.findDocumentById(ctx.companyId, documentId, ctx.scopes.branchIds);
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);

    return buildDocumentPostingInput(doc);
  }
}

export function buildDocumentPostingInput(doc: DocumentRecord): AccountingSourcePostingInput {
  // H-04: a voided document is never a posting source — its GL reversal is
  // created inside the void transaction. Without this guard, a posting rule
  // for the 'voided' event could book a fresh journal for a voided document.
  if (doc.status === 'VOIDED') {
    throw new BadRequestException(`Cannot post accounting document with status ${doc.status}`);
  }
  const lines: AccountingSourcePostingLine[] = (doc.lines ?? []).map((l) => ({
    lineNumber: l.lineNumber,
    productId: l.productId,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountAmount: l.discountAmount,
    taxableAmount: l.lineSubtotalAmount, // pre-VAT
    vatRate: l.vatRate,
    vatAmount: l.vatAmount,
    whtRate: l.whtRate,
    whtAmount: l.whtAmount,
    lineTotalAmount: l.lineTotalAmount,
    taxCategory: l.taxCategory,
    revenueCategory: l.revenueCategory,
    taxSnapshot: l.taxSnapshot,
    taxComponents: l.taxComponents,
  }));

  const idempotencyKey = `source:${doc.documentType}:${doc.id}:${doc.issuedAt?.toISOString() ?? 'draft'}`;

  return {
    companyId: doc.companyId,
    branchId: doc.branchId,
    sourceType: 'accounting_document',
    sourceId: doc.id,
    sourceEventType: 'issued',
    idempotencyKey,
    documentType: doc.documentType,
    documentId: doc.id,
    documentNumber: doc.documentNumber,
    documentDate: coerceCivilDate(doc.documentDate),
    counterpartyId: doc.counterpartyId,
    counterpartySnapshot: doc.counterpartySnapshotJson,
    currency: doc.currency,
    subtotalAmount: doc.subtotalAmount,
    discountAmount: doc.discountAmount,
    taxableAmount: doc.taxableAmount,
    vatAmount: doc.vatAmount,
    whtAmount: doc.whtAmount,
    grandTotalAmount: doc.grandTotalAmount,
    paidAmount: doc.paidAmount,
    outstandingAmount: doc.outstandingAmount,
    unappliedCreditAmount: doc.unappliedCreditAmount,
    taxInvoiceRef: doc.taxInvoiceId,
    outputTaxCode: doc.outputTaxCode,
    taxCodeSummary: doc.taxCodeSummary,
    reversalOf: doc.sourceDocumentId,
    postingStatus: doc.postingStatus,
    lines,
  };
}

export function buildAccountingPaymentPostingSource(payment: PaymentRecord): LedgerSourcePostingInput {
  if (payment.status !== 'RECORDED') throw new BadRequestException(`Cannot post accounting payment with status ${payment.status}`);
  const sourceDate = civilDate(payment.paidAt);
  return {
    companyId: payment.companyId,
    branchId: payment.branchId,
    sourceType: 'accounting.payment',
    sourceId: payment.id,
    sourceEventType: payment.direction === 'RECEIVED' ? 'accounting.payment.received' : 'accounting.payment.made',
    idempotencyKey: `accounting-payment:${payment.id}:recorded`,
    documentNumber: payment.paymentNumber,
    sourceDate,
    periodKey: civilPeriodKey(sourceDate),
    currency: payment.currency,
    counterpartyId: payment.counterpartyId,
    // Receivable settled, not cash banked: tax the customer withheld cleared the same debt and has
    // to relieve AR too, otherwise the invoice stays open by the withheld amount forever.
    // `whtTotal` is what lets the posting engine debit it as a tax credit instead of as cash.
    totalAmount: new Decimal(payment.amount).plus(payment.whtAmount ?? '0').toFixed(4),
    taxTotal: '0',
    whtTotal: payment.whtAmount ?? '0',
    lines: [{ sourceLineId: payment.id, description: payment.note ?? payment.paymentNumber ?? payment.id, netAmount: payment.amount }],
    payment: { paymentDate: sourceDate, method: payment.method, amount: payment.amount, reference: payment.externalReference },
  };
}
