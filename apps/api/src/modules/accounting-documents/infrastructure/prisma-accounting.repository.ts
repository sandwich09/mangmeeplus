import { Injectable, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../common/database/prisma.service';
import type {
  CounterpartyRecord,
  DocumentRecord,
  DocumentLineRecord,
  PaymentRecord,
  PaymentAllocationRecord,
  CreateCounterpartyInput,
  UpdateCounterpartyInput,
  CreateDocumentInput,
  CreatePaymentInput,
  ListDocumentsFilter,
  PaginatedDocuments,
  ListPaymentsFilter,
  PaginatedPayments,
} from '../domain/models/accounting.model';
import {
  calculateLine,
  calculateDocumentTotals,
  calculateOutstandingAmount,
  calculatePaymentStatus,
  calculateUnappliedCredit,
} from '../domain/logic/accounting-totals.logic';
import { initialPostingStatus, validateCumulativeCreditNote, validateOutputTaxDocument } from '../domain/logic/accounting-status.logic';
import { buildReversalLines } from '../../ledger/domain/logic/journal-balance.logic';
import type { AccountingDocumentType, AccountingDocumentStatus, AccountingQuotationApprovalStatus, ResolveTransactionTaxPreviewDto } from '@watchdog-bms/contracts';
import { branchScopeWhere } from '../../data-model-core/domain/logic/branch.logic';
import { civilPeriodKey, coerceCivilDate, exclusiveEndOfDay } from '@watchdog-bms/contracts';

export type AccountingDocumentTaxFinalizer = (input: {
  db: any;
  document: DocumentRecord;
  source?: DocumentRecord;
}) => Promise<Array<{ lineId: string; preview: ResolveTransactionTaxPreviewDto }>>;

export type VoidReleasedAllocation = { allocationId: string; paymentId: string; documentId: string; amount: string };
export type VoidPaymentResult = {
  payment: PaymentRecord;
  releasedAllocations: VoidReleasedAllocation[];
  reversalEntryId: string | null;
};
export type VoidDocumentResult = {
  document: DocumentRecord;
  releasedAllocations: VoidReleasedAllocation[];
  unappliedCredits: Array<{ paymentId: string; unappliedAmount: string; currency: string }>;
  reversalEntryId: string | null;
};
export type ConvertQuotationResult = { document: DocumentRecord; didConvert: boolean };

@Injectable()
export class PrismaAccountingRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Counterparty ----
  async createCounterparty(input: CreateCounterpartyInput): Promise<CounterpartyRecord> {
    const row = await this.prisma.client.accountingCounterparty.create({
      data: {
        companyId: input.companyId,
        type: input.type as any,
        displayName: input.displayName,
        legalName: input.legalName,
        taxId: input.taxId,
        branchCode: input.branchCode,
        email: input.email,
        phone: input.phone,
        billingAddressJson: input.billingAddressJson as any,
        shippingAddressJson: input.shippingAddressJson as any,
        createdByUserId: input.createdByUserId,
      },
    });
    return this.toCounterpartyRecord(row);
  }

  async updateCounterparty(input: UpdateCounterpartyInput): Promise<CounterpartyRecord> {
    const row = await this.prisma.client.accountingCounterparty.update({
      where: { id: input.counterpartyId },
      data: {
        displayName: input.displayName,
        legalName: input.legalName,
        taxId: input.taxId,
        branchCode: input.branchCode,
        email: input.email,
        phone: input.phone,
        billingAddressJson: input.billingAddressJson as any,
        shippingAddressJson: input.shippingAddressJson as any,
        status: input.status as any,
        updatedByUserId: input.updatedByUserId,
      },
    });
    return this.toCounterpartyRecord(row);
  }

  async findCounterpartyById(companyId: string, id: string): Promise<CounterpartyRecord | null> {
    const row = await this.prisma.client.accountingCounterparty.findFirst({ where: { id, companyId } });
    return row ? this.toCounterpartyRecord(row) : null;
  }

  async listCounterparties(companyId: string, page = 1, pageSize = 20): Promise<{ data: CounterpartyRecord[]; total: number }> {
    const skip = (page - 1) * pageSize;
    const [data, total] = await Promise.all([
      this.prisma.client.accountingCounterparty.findMany({ where: { companyId }, skip, take: pageSize, orderBy: { displayName: 'asc' } }),
      this.prisma.client.accountingCounterparty.count({ where: { companyId } }),
    ]);
    return { data: data.map(this.toCounterpartyRecord), total };
  }

  // ---- Document ----
  async createDocument(input: CreateDocumentInput): Promise<DocumentRecord> {
    return this.createDocumentWithClient(this.prisma.client, input);
  }

  private async createDocumentWithClient(db: any, input: CreateDocumentInput): Promise<DocumentRecord> {
    const computedLines = input.lines.map((l) => calculateLine({ ...l, vatMode: input.vatMode, discountAmount: l.discountAmount ?? '0' }));
    const totals = calculateDocumentTotals(input.lines.map((l, i) => ({
      lineSubtotalAmount: computedLines[i].lineSubtotalAmount,
      discountAmount: computedLines[i].discountAmount,
      taxableAmount: computedLines[i].taxableAmount,
      vatAmount: computedLines[i].vatAmount,
      whtAmount: computedLines[i].whtAmount,
      lineTotalAmount: computedLines[i].lineTotalAmount,
    })));

    const row = await db.accountingDocument.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId,
        documentType: input.documentType as any,
        documentDate: new Date(input.documentDate),
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        counterpartyId: input.counterpartyId,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentType: input.sourceDocumentType,
        convertedFromDocumentId: input.convertedFromDocumentId,
        currency: input.currency ?? 'THB',
        vatMode: input.vatMode as any,
        outputTaxCode: input.outputTaxCode as any,
        subtotalAmount: totals.subtotalAmount,
        discountAmount: totals.discountAmount,
        taxableAmount: totals.taxableAmount,
        vatAmount: totals.vatAmount,
        whtAmount: totals.whtAmount,
        grandTotalAmount: totals.grandTotalAmount,
        outstandingAmount: totals.grandTotalAmount,
        paymentStatus: 'UNPAID' as any,
        note: input.note,
        internalMemo: input.internalMemo,
        createdByUserId: input.createdByUserId,
        lines: {
          // companyId is inherited through the compound document relation —
          // Prisma 7 rejects it as an explicit scalar in this nested create.
          create: input.lines.map((l, i) => ({
            lineNumber: l.lineNumber,
            productId: l.productId,
            skuSnapshot: l.skuSnapshot,
            description: l.description,
            unitName: l.unitName,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountAmount: computedLines[i].discountAmount,
            vatRate: l.vatRate,
            vatAmount: computedLines[i].vatAmount,
            whtRate: l.whtRate,
            whtAmount: computedLines[i].whtAmount,
            lineSubtotalAmount: computedLines[i].lineSubtotalAmount,
            lineTotalAmount: computedLines[i].lineTotalAmount,
            taxCategory: l.taxCategory,
            revenueCategory: l.revenueCategory,
          })),
        },
      },
      include: { lines: true },
    });
    return this.toDocumentRecord(row);
  }

  async convertQuotation(
    sourceDocumentId: string,
    expectedSourceUpdatedAt: Date,
    input: CreateDocumentInput,
    actorUserId: string,
  ): Promise<ConvertQuotationResult> {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${sourceDocumentId}:accounting-document-lifecycle`}))`;
      const source = await tx.accountingDocument.findFirst({
        where: { id: sourceDocumentId, companyId: input.companyId },
      });
      if (!source) throw new NotFoundException(`Source document ${sourceDocumentId} not found`);

      const existing = await tx.accountingDocument.findMany({
        where: { companyId: input.companyId, convertedFromDocumentId: sourceDocumentId },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
        orderBy: { createdAt: 'asc' },
        take: 2,
      });
      if (existing.length > 1 || (existing[0] && existing[0].documentType !== input.documentType)) {
        throw new ConflictException({
          code: 'accounting_document_already_converted',
          message: 'Quotation already has a different or duplicate converted document.',
        });
      }
      if (source.status === 'CLOSED' && existing[0]) {
        return { document: this.toDocumentRecord(existing[0]), didConvert: false };
      }
      if (source.documentType !== 'QUOTATION' || source.status !== 'ISSUED'
        || source.updatedAt.getTime() !== expectedSourceUpdatedAt.getTime()) {
        throw new ConflictException({
          code: 'accounting_document_changed',
          message: 'Quotation changed before conversion. Reload and retry.',
        });
      }

      const claimed = await tx.accountingDocument.updateMany({
        where: {
          id: sourceDocumentId,
          companyId: input.companyId,
          documentType: 'QUOTATION',
          status: 'ISSUED',
          updatedAt: expectedSourceUpdatedAt,
        },
        data: { status: 'CLOSED', updatedByUserId: actorUserId },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: 'accounting_document_changed',
          message: 'Quotation changed before conversion. Reload and retry.',
        });
      }

      if (existing[0]) {
        return { document: this.toDocumentRecord(existing[0]), didConvert: true };
      }
      return {
        document: await this.createDocumentWithClient(tx, input),
        didConvert: true,
      };
    }, { isolationLevel: 'Serializable' });
  }

  async deleteDraftDocument(companyId: string, id: string): Promise<void> {
    await this.prisma.client.accountingDocument.deleteMany({ where: { id, companyId, status: 'DRAFT' as any } });
  }

  async updateDraftDocument(
    documentId: string,
    expectedUpdatedAt: Date,
    input: CreateDocumentInput,
    updatedByUserId: string,
    withinTransaction?: (db: any, document: DocumentRecord) => Promise<void>,
  ): Promise<DocumentRecord> {
    const computedLines = input.lines.map((line) => calculateLine({
      ...line,
      vatMode: input.vatMode,
      discountAmount: line.discountAmount ?? '0',
    }));
    const totals = calculateDocumentTotals(input.lines.map((_line, index) => ({
      lineSubtotalAmount: computedLines[index].lineSubtotalAmount,
      discountAmount: computedLines[index].discountAmount,
      taxableAmount: computedLines[index].taxableAmount,
      vatAmount: computedLines[index].vatAmount,
      whtAmount: computedLines[index].whtAmount,
      lineTotalAmount: computedLines[index].lineTotalAmount,
    })));

    return (this.prisma.client as any).$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${documentId}:accounting-document-lifecycle`}))`;
      const changed = await tx.accountingDocument.updateMany({
        where: {
          id: documentId,
          companyId: input.companyId,
          status: 'DRAFT',
          updatedAt: expectedUpdatedAt,
        },
        data: {
          branchId: input.branchId ?? null,
          documentDate: new Date(input.documentDate),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          counterpartyId: input.counterpartyId ?? null,
          currency: input.currency ?? 'THB',
          vatMode: input.vatMode,
          outputTaxCode: input.outputTaxCode ?? null,
          subtotalAmount: totals.subtotalAmount,
          discountAmount: totals.discountAmount,
          taxableAmount: totals.taxableAmount,
          vatAmount: totals.vatAmount,
          whtAmount: totals.whtAmount,
          grandTotalAmount: totals.grandTotalAmount,
          outstandingAmount: totals.grandTotalAmount,
          note: input.note ?? null,
          internalMemo: input.internalMemo ?? null,
          updatedByUserId,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException({
          code: 'accounting_document_changed',
          message: 'Document changed after it was loaded. Reload and review before saving.',
        });
      }

      await tx.accountingDocumentLine.deleteMany({ where: { companyId: input.companyId, documentId } });
      if (input.lines.length) {
        await tx.accountingDocumentLine.createMany({
          data: input.lines.map((line, index) => ({
            companyId: input.companyId,
            documentId,
            lineNumber: line.lineNumber,
            productId: line.productId,
            skuSnapshot: line.skuSnapshot,
            description: line.description,
            unitName: line.unitName,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountAmount: computedLines[index].discountAmount,
            vatRate: line.vatRate,
            vatAmount: computedLines[index].vatAmount,
            whtRate: line.whtRate,
            whtAmount: computedLines[index].whtAmount,
            lineSubtotalAmount: computedLines[index].lineSubtotalAmount,
            lineTotalAmount: computedLines[index].lineTotalAmount,
            taxCategory: line.taxCategory,
            revenueCategory: line.revenueCategory,
          })),
        });
      }

      const draft = await tx.accountingDocument.findFirstOrThrow({
        where: { id: documentId, companyId: input.companyId },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      await withinTransaction?.(tx, this.toDocumentRecord(draft));
      const final = await tx.accountingDocument.findFirstOrThrow({
        where: { id: documentId, companyId: input.companyId },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      return this.toDocumentRecord(final);
    }, { isolationLevel: 'Serializable' });
  }

  async saveLineTaxSnapshots(
    companyId: string,
    documentId: string,
    snapshots: Array<{ lineId: string; preview: import('@watchdog-bms/contracts').ResolveTransactionTaxPreviewDto }>,
    db?: any,
  ): Promise<void> {
    const client = db ?? this.prisma.client;
    const writes = snapshots.map(({ lineId, preview }) => {
      const snapshot = preview.snapshot;
      return client.accountingDocumentLine.updateMany({
        where: { id: lineId, companyId, documentId },
        data: {
          taxCodeDefinitionId: snapshot.taxCodeDefinitionId,
          externalTaxCodeSnapshot: snapshot.externalTaxCode,
          taxProfileKeySnapshot: snapshot.taxProfileKey,
          taxProfileVersionSnapshot: snapshot.taxProfileVersion,
          roundingModeSnapshot: snapshot.roundingMode ?? null,
          roundingScaleSnapshot: snapshot.roundingScale ?? null,
          taxAmountToleranceSnapshot: snapshot.taxAmountTolerance ?? null,
          taxRegimeSnapshot: snapshot.taxRegime as any,
          taxDirectionSnapshot: snapshot.taxDirection as any,
          taxTreatmentSnapshot: snapshot.taxTreatment as any,
          taxContextSnapshot: snapshot.taxContext as any,
          taxRateSnapshot: snapshot.taxRate,
          sourceCurrencySnapshot: snapshot.sourceCurrency,
          taxCurrencySnapshot: snapshot.taxCurrency,
          exchangeRateSnapshot: snapshot.exchangeRate,
          exchangeRateSourceSnapshot: snapshot.exchangeRateSource,
          exchangeRateDateSnapshot: snapshot.exchangeRateDate ? new Date(snapshot.exchangeRateDate) : null,
          vatRate: snapshot.taxRegime === 'VAT' ? snapshot.taxRate : null,
          taxBaseAmount: snapshot.taxBaseAmount,
          transactionTaxAmount: snapshot.taxAmount,
          claimabilitySnapshot: snapshot.claimability as any,
          accountRuleVersionSnapshot: snapshot.accountRuleVersion,
          reportRuleVersionSnapshot: snapshot.reportRuleVersion,
          taxEvidenceReviewStatus: snapshot.evidenceStatus as any,
          taxComponentsJson: preview.components as any,
          accountAssignmentsJson: preview.components.flatMap((component) => component.accountAssignments) as any,
        } as any,
      });
    });
    if (db) await Promise.all(writes);
    else await this.prisma.client.$transaction(writes);
  }

  async saveInheritedLineTaxSnapshots(
    companyId: string,
    documentId: string,
    snapshots: Array<{ lineId: string; snapshot: import('@watchdog-bms/contracts').TransactionTaxSnapshot; components: import('@watchdog-bms/contracts').TransactionTaxComponentPreview[] }>,
    db?: any,
  ): Promise<void> {
    const client = db ?? this.prisma.client;
    const writes = snapshots.map(({ lineId, snapshot, components }) => client.accountingDocumentLine.updateMany({
      where: { id: lineId, companyId, documentId },
      data: {
        taxCodeDefinitionId: snapshot.taxCodeDefinitionId,
        externalTaxCodeSnapshot: snapshot.externalTaxCode,
        taxProfileKeySnapshot: snapshot.taxProfileKey,
        taxProfileVersionSnapshot: snapshot.taxProfileVersion,
        roundingModeSnapshot: snapshot.roundingMode ?? null,
        roundingScaleSnapshot: snapshot.roundingScale ?? null,
        taxAmountToleranceSnapshot: snapshot.taxAmountTolerance ?? null,
        taxRegimeSnapshot: snapshot.taxRegime as any,
        taxDirectionSnapshot: snapshot.taxDirection as any,
        taxTreatmentSnapshot: snapshot.taxTreatment as any,
        taxContextSnapshot: snapshot.taxContext as any,
        taxRateSnapshot: snapshot.taxRate,
        sourceCurrencySnapshot: snapshot.sourceCurrency,
        taxCurrencySnapshot: snapshot.taxCurrency,
        exchangeRateSnapshot: snapshot.exchangeRate,
        exchangeRateSourceSnapshot: snapshot.exchangeRateSource,
        exchangeRateDateSnapshot: snapshot.exchangeRateDate ? new Date(snapshot.exchangeRateDate) : null,
        vatRate: snapshot.taxRegime === 'VAT' ? snapshot.taxRate : null,
        taxBaseAmount: snapshot.taxBaseAmount,
        transactionTaxAmount: snapshot.taxAmount,
        claimabilitySnapshot: snapshot.claimability as any,
        accountRuleVersionSnapshot: snapshot.accountRuleVersion,
        reportRuleVersionSnapshot: snapshot.reportRuleVersion,
        taxEvidenceReviewStatus: snapshot.evidenceStatus as any,
        taxComponentsJson: components as any,
        accountAssignmentsJson: components.flatMap((component) => component.accountAssignments) as any,
      } as any,
    }));
    if (db) await Promise.all(writes);
    else await this.prisma.client.$transaction(writes);
  }

  async findActiveBranch(companyId: string, id: string): Promise<{ id: string } | null> {
    return this.prisma.client.branch.findFirst({ where: { id, companyId, status: 'ACTIVE' }, select: { id: true } });
  }

  private async relatedDocumentIds(companyId: string, userId: string, branchIds?: string[]): Promise<string[]> {
    const actor = [
      { createdByUserId: userId }, { updatedByUserId: userId }, { issuedByUserId: userId },
      { voidedByUserId: userId }, { submittedByUserId: userId }, { approvedByUserId: userId },
      { rejectedByUserId: userId },
    ];
    const allocations = await this.prisma.client.accountingPaymentAllocation.findMany({
      where: {
        companyId,
        OR: [
          { createdByUserId: userId },
          { payment: { is: { OR: [{ createdByUserId: userId }, { updatedByUserId: userId }, { voidedByUserId: userId }] } } },
        ],
      } as any,
      select: { documentId: true },
    });
    const direct = await this.prisma.client.accountingDocument.findMany({
      where: {
        companyId,
        AND: [
          branchScopeWhere({ branchIds }),
          { OR: [...actor, ...(allocations.length ? [{ id: { in: allocations.map((row) => row.documentId) } }] : [])] },
        ],
      } as any,
      select: { id: true, sourceDocumentId: true, convertedFromDocumentId: true },
    });
    const authorized = new Set(direct.map((row) => row.id));
    let frontier = direct;
    const visitedPayments = new Set<string>();

    // Walk the persisted graph to closure. `authorized` makes cycles finite; branch scope is
    // reapplied when candidate ids become documents, including ids reached through a payment.
    while (frontier.length) {
      const frontierIds = frontier.map((row) => row.id);
      const paymentLinks = await this.prisma.client.accountingPaymentAllocation.findMany({
        where: { companyId, documentId: { in: frontierIds } },
        select: { paymentId: true },
      });
      const paymentIds = [...new Set(paymentLinks.map((row) => row.paymentId))]
        .filter((paymentId) => !visitedPayments.has(paymentId));
      for (const paymentId of paymentIds) visitedPayments.add(paymentId);
      const siblingAllocations = paymentIds.length
        ? await this.prisma.client.accountingPaymentAllocation.findMany({
          where: { companyId, paymentId: { in: paymentIds } },
          select: { documentId: true },
        })
        : [];
      const targetIds = [...new Set([
        ...frontier.flatMap((row) => [row.sourceDocumentId, row.convertedFromDocumentId]),
        ...siblingAllocations.map((row) => row.documentId),
      ].filter((id): id is string => Boolean(id)))];
      const rows = await this.prisma.client.accountingDocument.findMany({
        where: {
          companyId,
          AND: [
            branchScopeWhere({ branchIds }),
            { OR: [
              { id: { in: targetIds } },
              { sourceDocumentId: { in: frontierIds } },
              { convertedFromDocumentId: { in: frontierIds } },
            ] },
          ],
        },
        select: { id: true, sourceDocumentId: true, convertedFromDocumentId: true },
      });
      frontier = rows.filter((row) => !authorized.has(row.id));
      for (const row of frontier) authorized.add(row.id);
    }
    return [...authorized];
  }

  async isDocumentRelatedToUser(companyId: string, documentId: string, userId: string, branchIds?: string[]): Promise<boolean> {
    return (await this.relatedDocumentIds(companyId, userId, branchIds)).includes(documentId);
  }

  async findDocumentById(companyId: string, id: string, branchIds?: string[]): Promise<DocumentRecord | null> {
    const row = await this.prisma.client.accountingDocument.findFirst({
      where: { id, companyId, ...branchScopeWhere({ branchIds }) },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    return row ? this.toDocumentRecord(row) : null;
  }

  async listDocuments(filter: ListDocumentsFilter, branchIds?: string[]): Promise<PaginatedDocuments> {
    const page = filter.page ?? 1;
    const pageSize = Math.min(filter.pageSize ?? 20, 100);
    const skip = (page - 1) * pageSize;
    const where: Record<string, unknown> = { companyId: filter.companyId };
    const and: Record<string, unknown>[] = [branchScopeWhere({ branchIds })];
    // Explicit selection narrows to that branch alone; the scope predicate above stays as defence
    // in depth (spec R6). The use case has already 403'd an out-of-scope value.
    if (filter.branchId) and.push({ branchId: filter.branchId });
    const relatedIds = filter.relatedUserId
      ? await this.relatedDocumentIds(filter.companyId, filter.relatedUserId, branchIds)
      : [];
    if (filter.documentType) {
      where.documentType = filter.documentType;
      if (filter.documentTypes && !filter.documentTypes.includes(filter.documentType)) where.id = { in: relatedIds };
    } else if (filter.documentTypes && filter.relatedUserId) {
      and.push({ OR: [{ documentType: { in: filter.documentTypes } }, { id: { in: relatedIds } }] });
    } else if (filter.documentTypes) where.documentType = { in: filter.documentTypes };
    else if (filter.relatedUserId) where.id = { in: relatedIds };
    where.AND = and;
    if (filter.status) where.status = filter.status;
    if (filter.paymentStatus) where.paymentStatus = filter.paymentStatus;
    if (filter.postingStatus) where.postingStatus = filter.postingStatus;
    if (filter.counterpartyId) where.counterpartyId = filter.counterpartyId;
    if (filter.fromDate || filter.toDate) {
      where.documentDate = {
        ...(filter.fromDate ? { gte: new Date(filter.fromDate) } : {}),
        ...(filter.toDate ? { lt: exclusiveEndOfDay(new Date(filter.toDate.slice(0, 10))) } : {}),
      };
    }
    const [data, total] = await Promise.all([
      this.prisma.client.accountingDocument.findMany({ where, skip, take: pageSize, orderBy: { documentDate: 'desc' } }),
      this.prisma.client.accountingDocument.count({ where }),
    ]);
    return { data: data.map((r) => this.toDocumentRecord(r)), total, page, pageSize };
  }

  async issueDocument(
    companyId: string,
    id: string,
    documentNumber: string,
    issuedByUserId: string,
    documentType: AccountingDocumentType,
    counterpartySnapshot?: Record<string, unknown>,
    expectedStatus: AccountingDocumentStatus = 'DRAFT',
    expectedUpdatedAt?: Date,
    finalizeTax?: AccountingDocumentTaxFinalizer,
  ): Promise<{ document: DocumentRecord; taxPreviews: ResolveTransactionTaxPreviewDto[] }> {
    const posting = initialPostingStatus(documentType, 'ISSUED');
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${id}:accounting-document-lifecycle`}))`;
      const currentRow = await tx.accountingDocument.findFirst({ where: { id, companyId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
      if (!currentRow) throw new NotFoundException(`Document ${id} not found`);
      if (currentRow.documentType !== documentType || currentRow.status !== expectedStatus
        || (expectedUpdatedAt && currentRow.updatedAt.getTime() !== expectedUpdatedAt.getTime())) {
        throw new ConflictException({ code: 'accounting_document_changed', message: 'Document changed after final tax review. Reload before issuing.' });
      }
      const current = this.toDocumentRecord(currentRow);
      const sourceRow = currentRow.sourceDocumentId
        ? await tx.accountingDocument.findFirst({ where: { id: currentRow.sourceDocumentId, companyId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } })
        : null;
      const source = sourceRow ? this.toDocumentRecord(sourceRow) : undefined;
      const taxError = validateOutputTaxDocument(current, source);
      if (taxError) throw new UnprocessableEntityException(taxError);

      const taxRelevant = ['TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(documentType);
      let taxPreviews: ResolveTransactionTaxPreviewDto[] = [];
      if (taxRelevant) {
        const periodKey = civilPeriodKey(coerceCivilDate(current.documentDate));
        const [accountingPeriod, lockedTaxPeriod] = await Promise.all([
          tx.accountingPeriod.findUnique({ where: { companyId_periodKey: { companyId, periodKey } }, select: { status: true } }),
          tx.taxPeriod.findFirst({ where: { companyId, formType: 'PP30', periodKey, status: { in: ['FILED', 'PAID', 'CLOSED'] } }, select: { status: true } }),
        ]);
        if (accountingPeriod && !['OPEN', 'REOPENED'].includes(accountingPeriod.status)) {
          throw new ConflictException({ code: 'accounting_period_locked', message: `Accounting period ${periodKey} is not open.` });
        }
        if (lockedTaxPeriod) {
          throw new ConflictException({ code: 'tax_period_locked', message: `PP30/${periodKey} is locked; use an adjustment or amended filing workflow.` });
        }
        if (!finalizeTax) throw new UnprocessableEntityException('Final server tax resolution is required before issuing a tax document');
        const finalized = await finalizeTax({ db: tx, document: current, source });
        if (finalized.length !== current.lines?.length || new Set(finalized.map((item) => item.lineId)).size !== finalized.length) {
          throw new UnprocessableEntityException('Every tax document line requires one final server-resolved Tax Code preview');
        }
        const currentLines = new Map((current.lines ?? []).map((line) => [line.id, line]));
        for (const { lineId, preview } of finalized) {
          const line = currentLines.get(lineId);
          if (!line || preview.errors.length || !preview.components.length || !preview.sourceChecksum || !preview.configurationChecksum) {
            throw new UnprocessableEntityException('Final Tax Code preview is incomplete or stale');
          }
          const snapshot = preview.snapshot;
          const changed = await tx.accountingDocumentLine.updateMany({
            where: { id: lineId, companyId, documentId: id, updatedAt: line.updatedAt },
            data: {
              taxCodeDefinitionId: snapshot.taxCodeDefinitionId,
              externalTaxCodeSnapshot: snapshot.externalTaxCode,
              taxProfileKeySnapshot: snapshot.taxProfileKey,
              taxProfileVersionSnapshot: snapshot.taxProfileVersion,
              roundingModeSnapshot: snapshot.roundingMode ?? null,
              roundingScaleSnapshot: snapshot.roundingScale ?? null,
              taxAmountToleranceSnapshot: snapshot.taxAmountTolerance ?? null,
              taxRegimeSnapshot: snapshot.taxRegime as any,
              taxDirectionSnapshot: snapshot.taxDirection as any,
              taxTreatmentSnapshot: snapshot.taxTreatment as any,
              taxContextSnapshot: snapshot.taxContext as any,
              taxRateSnapshot: snapshot.taxRate,
              sourceCurrencySnapshot: snapshot.sourceCurrency,
              taxCurrencySnapshot: snapshot.taxCurrency,
              exchangeRateSnapshot: snapshot.exchangeRate,
              exchangeRateSourceSnapshot: snapshot.exchangeRateSource,
              exchangeRateDateSnapshot: snapshot.exchangeRateDate ? new Date(snapshot.exchangeRateDate) : null,
              vatRate: snapshot.taxRegime === 'VAT' ? snapshot.taxRate : null,
              taxBaseAmount: snapshot.taxBaseAmount,
              transactionTaxAmount: snapshot.taxAmount,
              claimabilitySnapshot: snapshot.claimability as any,
              accountRuleVersionSnapshot: snapshot.accountRuleVersion,
              reportRuleVersionSnapshot: snapshot.reportRuleVersion,
              taxEvidenceReviewStatus: snapshot.evidenceStatus as any,
              taxComponentsJson: preview.components as any,
              accountAssignmentsJson: preview.components.flatMap((component) => component.accountAssignments) as any,
            } as any,
          });
          if (changed.count !== 1) throw new ConflictException({ code: 'accounting_document_changed', message: 'Document line changed during final tax review.' });
        }
        taxPreviews = finalized.map((item) => item.preview);
      }

      if (documentType === 'CREDIT_NOTE') {
        if (!sourceRow || sourceRow.documentType !== 'TAX_INVOICE') throw new UnprocessableEntityException('Credit note original TAX_INVOICE was not found');
        const issuedCorrections = await tx.accountingDocument.findMany({ where: {
          companyId, sourceDocumentId: sourceRow.id, id: { not: id }, documentType: { in: ['CREDIT_NOTE', 'DEBIT_NOTE'] },
          status: { in: ['ISSUED', 'CREDITED', 'DEBITED', 'CLOSED'] },
        }, select: { documentType: true, lines: { select: { lineNumber: true, taxBaseAmount: true, taxableAmount: true, transactionTaxAmount: true, vatAmount: true } } } });
        const error = validateCumulativeCreditNote(sourceRow.lines, currentRow.lines, issuedCorrections);
        if (error) throw new UnprocessableEntityException(error);
      }

      const issuedAt = new Date();
      const updated = await tx.accountingDocument.updateMany({
        where: { id, companyId, status: expectedStatus, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
        data: {
          status: 'ISSUED' as any, documentNumber, issuedByUserId, issuedAt,
          counterpartySnapshotJson: counterpartySnapshot as any, postingStatus: posting as any,
          paymentStatus: 'UNPAID' as any, updatedByUserId: issuedByUserId,
        },
      });
      if (updated.count !== 1) throw new ConflictException({ code: 'accounting_document_changed', message: 'Document changed during final issue.' });
      const issued = await tx.accountingDocument.findFirstOrThrow({ where: { id, companyId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
      return { document: this.toDocumentRecord(issued), taxPreviews };
    }, { isolationLevel: 'Serializable' });
  }

  async updateDocumentStatus(
    companyId: string,
    id: string,
    status: AccountingDocumentStatus,
    actorUserId: string,
    extra?: {
      approvalStatus?: AccountingQuotationApprovalStatus;
      approvalNote?: string;
    },
  ): Promise<DocumentRecord> {
    const data: Record<string, unknown> = { status, updatedByUserId: actorUserId };
    // H-04: VOIDED is intentionally not handled here — voids must go through
    // voidDocumentTrueReversal so side effects and status change stay atomic.
    if (status === 'VOIDED') {
      throw new UnprocessableEntityException('Use voidDocumentTrueReversal for voids');
    }
    if (status === 'PENDING_APPROVAL') {
      data.approvalStatus = 'PENDING';
      data.submittedByUserId = actorUserId;
      data.submittedAt = new Date();
    }
    if (status === 'APPROVED') {
      data.approvalStatus = 'APPROVED';
      data.approvedByUserId = actorUserId;
      data.approvedAt = new Date();
      if (extra?.approvalNote) data.approvalNote = extra.approvalNote;
    }
    if (status === 'REJECTED') {
      data.approvalStatus = 'REJECTED';
      data.rejectedByUserId = actorUserId;
      data.rejectedAt = new Date();
      if (extra?.approvalNote) data.approvalNote = extra.approvalNote;
    }
    const row = await this.prisma.client.accountingDocument.update({ where: { id }, data });
    return this.toDocumentRecord(row);
  }

  // ---- Payment ----
  async createPayment(input: CreatePaymentInput): Promise<PaymentRecord> {
    const counterpartySnapshot = input.counterpartyId
      ? await this.prisma.client.accountingCounterparty.findFirst({ where: { id: input.counterpartyId, companyId: input.companyId } }).then((c) => c ? { id: c.id, displayName: c.displayName, taxId: c.taxId } : undefined)
      : undefined;

    return await this.prisma.client.$transaction(async (tx) => {
      const payment = await tx.accountingPayment.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId,
          direction: input.direction as any,
          status: 'RECORDED' as any,
          counterpartyId: input.counterpartyId,
          counterpartySnapshotJson: counterpartySnapshot as any,
          method: input.method as any,
          amount: input.amount,
          whtAmount: input.whtAmount ?? '0',
          currency: input.currency ?? 'THB',
          paidAt: new Date(input.paidAt),
          bankAccountRef: input.bankAccountRef,
          externalReference: input.externalReference,
          note: input.note,
          postingStatus: 'pending' as any,
          createdByUserId: input.createdByUserId,
        },
      });

      let allocatedAmount = '0.00';
      if (input.allocateToDocumentId) {
        const doc = await tx.accountingDocument.findFirst({ where: { id: input.allocateToDocumentId, companyId: input.companyId } });
        if (doc) {
          const outstanding = parseFloat(doc.outstandingAmount.toString());
          const payAmt = parseFloat(input.amount);
          const withheld = parseFloat(input.whtAmount ?? '0');
          // Cash clamps to the outstanding and the surplus becomes an unapplied credit. Withheld
          // tax cannot clamp — it is not money we hold — so the pair is re-checked here against the
          // balance READ IN THIS TRANSACTION. The use case validated against a read taken outside
          // it, which two concurrent receipts would both pass while over-settling the document.
          const allocAmt = Math.min(payAmt, Math.max(0, outstanding - withheld)).toFixed(2);
          if (withheld > 0 && parseFloat(allocAmt) + withheld > outstanding + 1e-9) {
            throw new UnprocessableEntityException('Payment and withheld tax together exceed the document outstanding amount');
          }
          allocatedAmount = allocAmt;
          const settled = parseFloat(allocAmt) + withheld;
          const newPaid = (parseFloat(doc.paidAmount.toString()) + settled).toFixed(2);
          const newOutstanding = calculateOutstandingAmount(doc.grandTotalAmount.toString(), newPaid);
          const payStatus = parseFloat(newOutstanding) <= 0 ? 'PAID' : 'PARTIALLY_PAID';
          await tx.accountingDocument.update({
            where: { id: input.allocateToDocumentId },
            data: { paidAmount: newPaid, outstandingAmount: newOutstanding, paymentStatus: payStatus as any },
          });
          await tx.accountingPaymentAllocation.create({
            data: { companyId: input.companyId, paymentId: payment.id, documentId: input.allocateToDocumentId, amount: allocAmt, whtAmount: input.whtAmount ?? null, createdByUserId: input.createdByUserId },
          });
        }
      }

      const unapplied = calculateUnappliedCredit(input.amount, allocatedAmount);
      const updated = await tx.accountingPayment.update({
        where: { id: payment.id },
        data: { allocatedAmount, unappliedAmount: unapplied },
      });
      return this.toPaymentRecord(updated);
    });
  }

  async findPaymentById(companyId: string, id: string, branchIds?: string[]): Promise<PaymentRecord | null> {
    const row = await this.prisma.client.accountingPayment.findFirst({ where: { id, companyId, ...branchScopeWhere({ branchIds }) } });
    return row ? this.toPaymentRecord(row) : null;
  }

  /**
   * H-04: the ledger journal table is the source of truth for whether a void
   * needs a reversing entry — the postingStatus/journalEntryId pointers on the
   * payment/document row can lag or be corrupted and must not gate the reversal.
   */
  async findPostedGeneratedJournalId(companyId: string, sourceType: string, sourceId: string): Promise<string | null> {
    const row = await this.prisma.client.journalEntry.findFirst({
      where: { companyId, sourceType, sourceId, entryType: 'GENERATED' as any, status: 'POSTED' as any },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  // H-04: reverse the GENERATED journal of a voided source inside the same
  // transaction. Fail closed: an unresolved posting state, a closed accounting
  // period, or a locked PP30 period blocks the whole void.
  private async reverseSourceJournalInTx(tx: any, opts: {
    companyId: string;
    sourceType: 'accounting.payment' | 'accounting.document';
    sourceId: string;
    reversalEntryNumber?: string;
    actorUserId: string;
    memo: string;
    taxPeriodMustBeOpen: boolean;
  }): Promise<{ reversalEntryId: string | null; reversed: boolean }> {
    // A REVERSAL row for this source is the authoritative "already reversed"
    // signal (one per source by unique constraint) — original.status is not,
    // because reports count POSTED entries only.
    const existingReversal = await tx.journalEntry.findFirst({
      where: { companyId: opts.companyId, sourceType: opts.sourceType, sourceId: opts.sourceId, entryType: 'REVERSAL' },
      select: { id: true },
    });
    if (existingReversal) return { reversalEntryId: null, reversed: true };
    const original = await tx.journalEntry.findFirst({
      where: { companyId: opts.companyId, sourceType: opts.sourceType, sourceId: opts.sourceId, entryType: 'GENERATED' },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!original) return { reversalEntryId: null, reversed: false };
    if (original.status !== 'POSTED') {
      throw new UnprocessableEntityException(`Generated journal ${original.entryNumber} is ${original.status}; resolve its posting state before voiding`);
    }
    if (!opts.reversalEntryNumber) {
      throw new ConflictException({ code: 'posting_state_changed', message: 'Posting state changed while voiding. Retry the void.' });
    }
    // Fail closed on a missing period row: the FK guarantees it exists, but a
    // dangling id must block the void rather than skip the period/tax locks.
    const period = await tx.accountingPeriod.findFirst({ where: { companyId: opts.companyId, id: original.periodId } });
    if (!period) {
      throw new UnprocessableEntityException(`Accounting period for journal ${original.entryNumber} was not found; cannot void`);
    }
    if (!['OPEN', 'REOPENED'].includes(period.status)) {
      throw new ConflictException({ code: 'accounting_period_locked', message: `Accounting period ${period.periodKey} is not open; reopen it before voiding.` });
    }
    if (opts.taxPeriodMustBeOpen) {
      const lockedTaxPeriod = await tx.taxPeriod.findFirst({
        where: { companyId: opts.companyId, formType: 'PP30', periodKey: period.periodKey, status: { in: ['FILED', 'PAID', 'CLOSED'] } },
        select: { id: true },
      });
      if (lockedTaxPeriod) {
        throw new ConflictException({ code: 'tax_period_locked', message: `PP30/${period.periodKey} is locked; use an adjustment or amended filing workflow.` });
      }
    }
    const reversalLines = buildReversalLines((original.lines ?? []).map((l: any) => ({
      accountId: l.accountId, branchId: l.branchId, description: l.description,
      debitAmount: l.debitAmount.toString(), creditAmount: l.creditAmount.toString(),
      currency: l.currency, taxCode: l.taxCode,
    })));
    const now = new Date();
    // @@unique([companyId, sourceType, sourceId, entryType]) makes a second
    // REVERSAL for this source abort the transaction — DB-level idempotency.
    const reversal = await tx.journalEntry.create({
      data: {
        companyId: opts.companyId, periodId: original.periodId, entryNumber: opts.reversalEntryNumber,
        entryType: 'REVERSAL', sourceType: opts.sourceType, sourceId: opts.sourceId,
        reversalOfJournalEntryId: original.id, status: 'POSTED', entryDate: now, postedAt: now,
        postedByUserId: opts.actorUserId, memo: opts.memo, createdByUserId: opts.actorUserId,
        lines: {
          // companyId is inherited through the compound journalEntry relation —
          // Prisma 7 rejects it as an explicit scalar in this nested create.
          create: reversalLines.map((l, idx) => ({
            accountId: l.accountId, branchId: l.branchId ?? null,
            lineNumber: idx + 1, description: l.description,
            debitAmount: parseFloat(l.debitAmount ?? '0') || 0,
            creditAmount: parseFloat(l.creditAmount ?? '0') || 0,
            currency: l.currency ?? 'THB', taxCode: l.taxCode ?? null,
          })),
        },
      },
    });
    // The original stays POSTED: GL/report queries count POSTED entries only,
    // so original + reversal net to zero. Flipping it to REVERSED would drop
    // it from reports and make the reversal double-subtract.
    return { reversalEntryId: reversal.id, reversed: true };
  }

  // H-04: void is a true reversal — status claim, allocation release, document
  // balance restore, and GL reversal commit or roll back together.
  async voidPaymentTrueReversal(
    companyId: string,
    paymentId: string,
    actorUserId: string,
    reason: string,
    reversalEntryNumber?: string,
  ): Promise<VoidPaymentResult> {
    return await (this.prisma.client as any).$transaction(async (tx: any) => {
      const claimed = await tx.accountingPayment.updateMany({
        where: { id: paymentId, companyId, status: { not: 'VOIDED' } },
        data: {
          status: 'VOIDED', voidedByUserId: actorUserId, voidedAt: new Date(), voidReason: reason,
          updatedByUserId: actorUserId, allocatedAmount: '0.00', unappliedAmount: '0.00',
        },
      });
      if (claimed.count !== 1) throw new ConflictException('Payment is already voided');

      const allocations = await tx.accountingPaymentAllocation.findMany({ where: { paymentId, companyId } });
      for (const alloc of allocations) {
        const doc = await tx.accountingDocument.findFirst({ where: { id: alloc.documentId, companyId } });
        if (!doc || doc.status === 'VOIDED') continue;
        // Both shares come back: the document was settled by cash AND withheld tax, so restoring
        // only the cash would leave it looking part-paid by tax that no longer applies.
        const settled = parseFloat(alloc.amount.toString()) + parseFloat((alloc.whtAmount ?? 0).toString());
        const restoredPaid = Math.max(0, parseFloat(doc.paidAmount.toString()) - settled).toFixed(2);
        await tx.accountingDocument.update({
          where: { id: doc.id },
          data: {
            paidAmount: restoredPaid,
            outstandingAmount: calculateOutstandingAmount(doc.grandTotalAmount.toString(), restoredPaid),
            paymentStatus: calculatePaymentStatus(doc.grandTotalAmount.toString(), restoredPaid) as any,
          },
        });
      }
      if (allocations.length) await tx.accountingPaymentAllocation.deleteMany({ where: { paymentId, companyId } });

      const reversal = await this.reverseSourceJournalInTx(tx, {
        companyId, sourceType: 'accounting.payment', sourceId: paymentId,
        reversalEntryNumber, actorUserId, memo: `[VOID] accounting.payment ${paymentId}`, taxPeriodMustBeOpen: false,
      });
      if (reversal.reversed) {
        await tx.accountingPayment.update({ where: { id: paymentId }, data: { postingStatus: 'reversed' } });
      }
      const row = await tx.accountingPayment.findFirstOrThrow({ where: { id: paymentId, companyId } });
      return {
        payment: this.toPaymentRecord(row),
        releasedAllocations: allocations.map((a: any) => ({ allocationId: a.id, paymentId: a.paymentId, documentId: a.documentId, amount: a.amount.toString() })),
        reversalEntryId: reversal.reversalEntryId,
      };
    }, { isolationLevel: 'Serializable' });
  }

  // H-04: document void releases payment allocations back to unapplied credit,
  // zeroes collectible balances, and reverses the posted GL entry atomically.
  async voidDocumentTrueReversal(
    companyId: string,
    documentId: string,
    actorUserId: string,
    reason: string,
    expectedStatus: AccountingDocumentStatus,
    reversalEntryNumber?: string,
  ): Promise<VoidDocumentResult> {
    return await (this.prisma.client as any).$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${documentId}:accounting-document-lifecycle`}))`;
      const claimed = await tx.accountingDocument.updateMany({
        where: { id: documentId, companyId, status: expectedStatus },
        data: {
          status: 'VOIDED', voidedByUserId: actorUserId, voidedAt: new Date(), voidReason: reason,
          updatedByUserId: actorUserId, paidAmount: '0.00', outstandingAmount: '0.00', paymentStatus: 'VOIDED',
        },
      });
      if (claimed.count !== 1) throw new ConflictException({ code: 'accounting_document_changed', message: 'Document changed before void. Reload and retry.' });
      const doc = await tx.accountingDocument.findFirstOrThrow({ where: { id: documentId, companyId } });

      if (doc.documentType === 'TAX_INVOICE') {
        const correction = await tx.accountingDocument.findFirst({
          where: {
            companyId, sourceDocumentId: documentId, documentType: { in: ['CREDIT_NOTE', 'DEBIT_NOTE'] },
            status: { in: ['ISSUED', 'CREDITED', 'DEBITED', 'CLOSED'] },
          },
          select: { documentNumber: true },
        });
        if (correction) {
          throw new UnprocessableEntityException(`Credit/debit note ${correction.documentNumber ?? ''} still references this tax invoice; void the corrections first`);
        }
      }

      const allocations = await tx.accountingPaymentAllocation.findMany({ where: { documentId, companyId } });
      const unappliedCredits: Array<{ paymentId: string; unappliedAmount: string; currency: string }> = [];
      for (const alloc of allocations) {
        const payment = await tx.accountingPayment.findFirst({ where: { id: alloc.paymentId, companyId } });
        if (!payment || payment.status === 'VOIDED') continue;
        const newAllocated = Math.max(0, parseFloat(payment.allocatedAmount.toString()) - parseFloat(alloc.amount.toString())).toFixed(2);
        const newUnapplied = calculateUnappliedCredit(payment.amount.toString(), newAllocated);
        await tx.accountingPayment.update({
          where: { id: payment.id },
          data: { allocatedAmount: newAllocated, unappliedAmount: newUnapplied, updatedByUserId: actorUserId },
        });
        unappliedCredits.push({ paymentId: payment.id, unappliedAmount: newUnapplied, currency: payment.currency });
      }
      if (allocations.length) await tx.accountingPaymentAllocation.deleteMany({ where: { documentId, companyId } });

      const taxRelevant = ['TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(doc.documentType);
      const reversal = await this.reverseSourceJournalInTx(tx, {
        companyId, sourceType: 'accounting.document', sourceId: documentId,
        reversalEntryNumber, actorUserId,
        memo: `[VOID] ${doc.documentNumber ?? documentId}`, taxPeriodMustBeOpen: taxRelevant,
      });
      if (reversal.reversed) {
        await tx.accountingDocument.update({ where: { id: documentId }, data: { postingStatus: 'reversed', postingError: null } });
      }
      const row = await tx.accountingDocument.findFirstOrThrow({ where: { id: documentId, companyId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
      return {
        document: this.toDocumentRecord(row),
        releasedAllocations: allocations.map((a: any) => ({ allocationId: a.id, paymentId: a.paymentId, documentId: a.documentId, amount: a.amount.toString() })),
        unappliedCredits,
        reversalEntryId: reversal.reversalEntryId,
      };
    }, { isolationLevel: 'Serializable' });
  }

  async updateDocumentPostingStatus(
    companyId: string,
    id: string,
    data: { postingStatus: 'pending' | 'posted' | 'posting_error' | 'reversed'; journalEntryId?: string | null; postingError?: string | null },
  ): Promise<void> {
    await this.prisma.client.accountingDocument.updateMany({
      where: { id, companyId },
      data: {
        postingStatus: data.postingStatus as any,
        journalEntryId: data.journalEntryId,
        postingError: data.postingError,
      },
    });
  }

  async updatePaymentPostingStatus(
    companyId: string,
    id: string,
    data: { postingStatus: 'pending' | 'posted' | 'posting_error' | 'reversed'; journalEntryId?: string | null },
  ): Promise<void> {
    await this.prisma.client.accountingPayment.updateMany({
      where: { id, companyId },
      data: {
        postingStatus: data.postingStatus as any,
        journalEntryId: data.journalEntryId,
      },
    });
  }

  async countPostingBlockers(companyId: string, fromDate: Date, toDate: Date): Promise<{ pending: number; errors: number }> {
    const where = {
      companyId,
      documentDate: { gte: fromDate, lt: exclusiveEndOfDay(toDate) },
      status: { in: ['ISSUED', 'CREDITED', 'DEBITED'] as any[] },
    };
    const [pending, errors] = await Promise.all([
      this.prisma.client.accountingDocument.count({ where: { ...where, postingStatus: 'pending' as any } }),
      this.prisma.client.accountingDocument.count({ where: { ...where, postingStatus: 'posting_error' as any } }),
    ]);
    return { pending, errors };
  }

  async countPaymentPostingBlockers(companyId: string, fromDate: Date, toDate: Date): Promise<{ pending: number; errors: number }> {
    const where = { companyId, paidAt: { gte: fromDate, lt: exclusiveEndOfDay(toDate) }, status: 'RECORDED' as any };
    const [pending, errors] = await Promise.all([
      this.prisma.client.accountingPayment.count({ where: { ...where, postingStatus: { in: ['pending', 'not_required'] as any[] } } }),
      this.prisma.client.accountingPayment.count({ where: { ...where, postingStatus: 'posting_error' as any } }),
    ]);
    return { pending, errors };
  }

  async listPayments(filter: ListPaymentsFilter, branchIds?: string[]): Promise<PaginatedPayments> {
    const page = filter.page ?? 1;
    const pageSize = Math.min(filter.pageSize ?? 20, 100);
    const skip = (page - 1) * pageSize;
    const where: Record<string, unknown> = { companyId: filter.companyId, ...branchScopeWhere({ branchIds }) };
    if (filter.direction) where.direction = filter.direction;
    if (filter.status) where.status = filter.status;
    if (filter.counterpartyId) where.counterpartyId = filter.counterpartyId;
    if (filter.fromDate || filter.toDate) {
      where.paidAt = {
        ...(filter.fromDate ? { gte: new Date(filter.fromDate) } : {}),
        ...(filter.toDate ? { lt: exclusiveEndOfDay(new Date(filter.toDate.slice(0, 10))) } : {}),
      };
    }
    const [data, total] = await Promise.all([
      this.prisma.client.accountingPayment.findMany({ where, skip, take: pageSize, orderBy: { paidAt: 'desc' } }),
      this.prisma.client.accountingPayment.count({ where }),
    ]);
    return { data: data.map(this.toPaymentRecord), total, page, pageSize };
  }

  async sumReceivedPaymentsByCounterparty(
    companyId: string,
    counterpartyIds: string[],
  ): Promise<{ counterpartyId: string; amount: string; paymentCount: number; latestPaidAt: Date }[]> {
    if (counterpartyIds.length === 0) return [];
    const grouped = await this.prisma.client.accountingPayment.groupBy({
      by: ['counterpartyId'],
      where: {
        companyId,
        counterpartyId: { in: counterpartyIds },
        direction: 'RECEIVED' as any,
        status: 'RECORDED' as any,
      },
      _sum: { amount: true, whtAmount: true },
      _count: { _all: true },
      _max: { paidAt: true },
    });
    return grouped
      .filter((g) => g.counterpartyId)
      .map((g) => ({
        counterpartyId: g.counterpartyId!,
        // Customer lifetime value, so it counts what the customer SETTLED, not what reached our
        // bank. Tax they withheld is still their spend — it went to the RD on our behalf, and
        // dropping it would understate every customer who withholds.
        amount: new Decimal(String(g._sum.amount ?? '0')).plus(String(g._sum.whtAmount ?? '0')).toFixed(2),
        paymentCount: g._count._all,
        latestPaidAt: g._max.paidAt!,
      }));
  }

  // ---- Mappers ----
  private toCounterpartyRecord(row: any): CounterpartyRecord {
    return {
      id: row.id, companyId: row.companyId, type: row.type, displayName: row.displayName,
      legalName: row.legalName ?? undefined, taxId: row.taxId ?? undefined,
      branchCode: row.branchCode ?? undefined, email: row.email ?? undefined, phone: row.phone ?? undefined,
      billingAddressJson: row.billingAddressJson ?? undefined, shippingAddressJson: row.shippingAddressJson ?? undefined,
      status: row.status, createdByUserId: row.createdByUserId, updatedByUserId: row.updatedByUserId ?? undefined,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private toDocumentRecord(row: any): DocumentRecord {
    const taxKeys = new Set<string>((row.lines ?? []).map((line: any) => line.taxCodeDefinitionId ?? line.externalTaxCodeSnapshot).filter(Boolean));
    return {
      id: row.id, companyId: row.companyId, branchId: row.branchId ?? undefined,
      documentType: row.documentType, documentNumber: row.documentNumber ?? undefined,
      status: row.status, documentDate: row.documentDate, dueDate: row.dueDate ?? undefined,
      counterpartyId: row.counterpartyId ?? undefined, counterpartySnapshotJson: row.counterpartySnapshotJson ?? undefined,
      sourceDocumentId: row.sourceDocumentId ?? undefined, sourceDocumentType: row.sourceDocumentType ?? undefined,
      convertedFromDocumentId: row.convertedFromDocumentId ?? undefined,
      currency: row.currency, vatMode: row.vatMode, outputTaxCode: row.outputTaxCode ?? undefined,
      taxCodeSummary: taxKeys.size === 0 ? 'NONE' : taxKeys.size === 1 ? 'SINGLE' : 'MIXED',
      subtotalAmount: row.subtotalAmount.toString(), discountAmount: row.discountAmount.toString(),
      taxableAmount: row.taxableAmount.toString(), vatAmount: row.vatAmount.toString(),
      whtAmount: row.whtAmount.toString(), grandTotalAmount: row.grandTotalAmount.toString(),
      paidAmount: row.paidAmount.toString(), outstandingAmount: row.outstandingAmount.toString(),
      unappliedCreditAmount: row.unappliedCreditAmount?.toString() ?? undefined,
      paymentStatus: row.paymentStatus ?? undefined, taxStatus: row.taxStatus ?? undefined,
      taxInvoiceType: row.taxInvoiceType ?? undefined, taxInvoiceId: row.taxInvoiceId ?? undefined,
      postingStatus: row.postingStatus, journalEntryId: row.journalEntryId ?? undefined,
      postingError: row.postingError ?? undefined, note: row.note ?? undefined, internalMemo: row.internalMemo ?? undefined,
      issuedByUserId: row.issuedByUserId ?? undefined, issuedAt: row.issuedAt ?? undefined,
      voidedByUserId: row.voidedByUserId ?? undefined, voidedAt: row.voidedAt ?? undefined, voidReason: row.voidReason ?? undefined,
      approvalStatus: row.approvalStatus ?? undefined, submittedByUserId: row.submittedByUserId ?? undefined,
      submittedAt: row.submittedAt ?? undefined, approvedByUserId: row.approvedByUserId ?? undefined,
      approvedAt: row.approvedAt ?? undefined, rejectedByUserId: row.rejectedByUserId ?? undefined,
      rejectedAt: row.rejectedAt ?? undefined, approvalNote: row.approvalNote ?? undefined,
      createdByUserId: row.createdByUserId, updatedByUserId: row.updatedByUserId ?? undefined,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
      lines: row.lines?.map(this.toLineRecord) ?? undefined,
    };
  }

  private toLineRecord(row: any): DocumentLineRecord {
    const taxSnapshot = row.taxCodeDefinitionId || row.externalTaxCodeSnapshot ? {
      taxCodeDefinitionId: row.taxCodeDefinitionId ?? null,
      externalTaxCode: row.externalTaxCodeSnapshot ?? null,
      taxProfileKey: row.taxProfileKeySnapshot ?? null,
      taxProfileVersion: row.taxProfileVersionSnapshot ?? null,
      roundingMode: row.roundingModeSnapshot ?? undefined,
      roundingScale: row.roundingScaleSnapshot ?? undefined,
      taxAmountTolerance: row.taxAmountToleranceSnapshot?.toString(),
      taxRegime: row.taxRegimeSnapshot ?? null,
      taxDirection: row.taxDirectionSnapshot ?? null,
      taxTreatment: row.taxTreatmentSnapshot ?? null,
      taxContext: row.taxContextSnapshot ?? null,
      taxRate: row.taxRateSnapshot?.toString() ?? '0',
      sourceCurrency: row.sourceCurrencySnapshot ?? 'THB',
      taxCurrency: row.taxCurrencySnapshot ?? 'THB',
      exchangeRate: row.exchangeRateSnapshot?.toString() ?? '1',
      exchangeRateSource: row.exchangeRateSourceSnapshot ?? 'FUNCTIONAL_CURRENCY',
      exchangeRateDate: row.exchangeRateDateSnapshot?.toISOString?.().slice(0, 10) ?? '',
      taxBaseAmount: row.taxBaseAmount?.toString() ?? '0',
      taxAmount: row.transactionTaxAmount?.toString() ?? '0',
      claimability: row.claimabilitySnapshot ?? 'NOT_APPLICABLE',
      evidenceStatus: row.taxEvidenceReviewStatus ?? 'REVIEW_REQUIRED',
      accountRuleVersion: row.accountRuleVersionSnapshot ?? null,
      reportRuleVersion: row.reportRuleVersionSnapshot ?? null,
    } : undefined;
    return {
      id: row.id, companyId: row.companyId, documentId: row.documentId, lineNumber: row.lineNumber,
      productId: row.productId ?? undefined, skuSnapshot: row.skuSnapshot ?? undefined,
      description: row.description, unitName: row.unitName ?? undefined,
      quantity: row.quantity.toString(), unitPrice: row.unitPrice.toString(),
      discountAmount: row.discountAmount.toString(), vatRate: row.vatRate?.toString() ?? undefined,
      vatAmount: row.vatAmount.toString(), whtRate: row.whtRate?.toString() ?? undefined,
      whtAmount: row.whtAmount.toString(), lineSubtotalAmount: row.lineSubtotalAmount.toString(),
      lineTotalAmount: row.lineTotalAmount.toString(), taxCategory: row.taxCategory ?? undefined,
      revenueCategory: row.revenueCategory ?? undefined,
      taxSnapshot,
      taxComponents: Array.isArray(row.taxComponentsJson) ? row.taxComponentsJson : undefined,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private toPaymentRecord(row: any): PaymentRecord {
    return {
      id: row.id, companyId: row.companyId, branchId: row.branchId ?? undefined,
      paymentNumber: row.paymentNumber ?? undefined, direction: row.direction, status: row.status,
      counterpartyId: row.counterpartyId ?? undefined, counterpartySnapshotJson: row.counterpartySnapshotJson ?? undefined,
      method: row.method, amount: row.amount.toString(), whtAmount: (row.whtAmount ?? 0).toString(),
      allocatedAmount: row.allocatedAmount.toString(),
      unappliedAmount: row.unappliedAmount.toString(), currency: row.currency, paidAt: row.paidAt,
      bankAccountRef: row.bankAccountRef ?? undefined, externalReference: row.externalReference ?? undefined,
      note: row.note ?? undefined, postingStatus: row.postingStatus, journalEntryId: row.journalEntryId ?? undefined,
      createdByUserId: row.createdByUserId, updatedByUserId: row.updatedByUserId ?? undefined,
      voidedByUserId: row.voidedByUserId ?? undefined, voidedAt: row.voidedAt ?? undefined,
      voidReason: row.voidReason ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }
}
