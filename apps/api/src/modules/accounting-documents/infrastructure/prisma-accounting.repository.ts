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
  RecordSimpleIncomeInput,
  RecordSimpleIncomeResult,
} from '../domain/models/accounting.model';
import {
  calculateLine,
  calculateDocumentTotals,
  calculateOutstandingAmount,
  calculatePaymentStatus,
  calculateUnappliedCredit,
} from '../domain/logic/accounting-totals.logic';
import { initialPostingStatus, validateCumulativeCreditNote, validateOutputTaxDocument } from '../domain/logic/accounting-status.logic';
import { validateAccountingPaymentAllocation } from '../domain/logic/accounting-money-validation.logic';
import { buildReversalLines } from '../../ledger/domain/logic/journal-balance.logic';
import type { AccountingDocumentType, AccountingDocumentStatus, AccountingQuotationApprovalStatus, ResolveTransactionTaxPreviewDto, RevenueCategorySummary, CreateRevenueCategoryInput, UpdateRevenueCategoryInput } from '@watchdog-bms/contracts';
import { branchScopeWhere, type BranchScopes } from '../../data-model-core/domain/logic/branch.logic';
import { resolveTransactionBranchId, requireTransactionBranchId } from '../../data-model-core/application/services/transaction-branch';
import { civilDate, civilDateToUtcDate, civilPeriodKey, coerceCivilDate, exclusiveEndOfDay } from '@watchdog-bms/contracts';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';

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
export type CreatePaymentResult = { payment: PaymentRecord; replayed: boolean };
type BeforeAccountingMutation = (db: any) => Promise<void>;

@Injectable()
export class PrismaAccountingRepository {
  async resolveCreateBranchId(companyId: string, scopes: BranchScopes, selectedBranchId?: string | null): Promise<string> {
    return resolveTransactionBranchId(this.prisma.client, companyId, scopes, selectedBranchId);
  }

  // `documentNumbers` is annotated, not merely defaulted: Nest reads design:paramtypes to inject
  // the DI-managed instance; the default keeps the class constructible in bare unit tests.
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentNumbers: PrismaDocumentSequenceRepository = new PrismaDocumentSequenceRepository(prisma),
  ) {}

  // ---- Counterparty ----
  async createCounterparty(input: CreateCounterpartyInput, beforeMutation?: BeforeAccountingMutation): Promise<CounterpartyRecord> {
    const create = async (db: any) => {
      await beforeMutation?.(db);
      const row = await db.accountingCounterparty.create({
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
    };
    return beforeMutation ? this.prisma.client.$transaction(create) : create(this.prisma.client);
  }

  async updateCounterparty(input: UpdateCounterpartyInput, beforeMutation?: BeforeAccountingMutation): Promise<CounterpartyRecord> {
    const update = async (db: any) => {
      await beforeMutation?.(db);
      const row = await db.accountingCounterparty.update({
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
    };
    return beforeMutation ? this.prisma.client.$transaction(update) : update(this.prisma.client);
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
  async createDocument(input: CreateDocumentInput, beforeMutation?: BeforeAccountingMutation): Promise<DocumentRecord> {
    if (input.idempotencyKey) {
      if (!input.payloadFingerprint) throw new Error('Server payload fingerprint is required for idempotent document create');
      return this.prisma.client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.idempotencyKey}:accounting-document-create`}))`;
        const existing = await (tx.accountingDocument as any).findUnique({
          where: { companyId_createIdempotencyKey: { companyId: input.companyId, createIdempotencyKey: input.idempotencyKey } },
          include: { lines: { orderBy: { lineNumber: 'asc' } } },
        });
        if (existing) {
          if (existing.createPayloadFingerprint !== input.payloadFingerprint) {
            throw new ConflictException({
              code: 'accounting_document_create_idempotency_conflict',
              message: 'This invoice retry key was already used with different details. Reload before creating another invoice.',
            });
          }
          return this.toDocumentRecord(existing);
        }
        await beforeMutation?.(tx);
        return this.createDocumentWithClient(tx, input);
      });
    }
    if (beforeMutation) {
      return this.prisma.client.$transaction(async (tx) => {
        await beforeMutation(tx);
        return this.createDocumentWithClient(tx, input);
      });
    }
    return this.createDocumentWithClient(this.prisma.client, input);
  }

  private async createDocumentWithClient(db: any, input: CreateDocumentInput): Promise<DocumentRecord> {
    requireTransactionBranchId(input.branchId);
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
        createIdempotencyKey: input.idempotencyKey,
        createPayloadFingerprint: input.payloadFingerprint,
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
        adjustmentReasonCode: input.adjustmentReasonCode,
        adjustmentReasonText: input.adjustmentReasonText,
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
            revenueCategoryId: l.revenueCategoryId,
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
    beforeMutation?: BeforeAccountingMutation,
  ): Promise<ConvertQuotationResult> {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      const optimisticSource = await tx.accountingDocument.findFirst({
        where: { id: sourceDocumentId, companyId: input.companyId },
      });
      if (!optimisticSource) throw new NotFoundException(`Source document ${sourceDocumentId} not found`);

      const optimisticExisting = await tx.accountingDocument.findMany({
        where: { companyId: input.companyId, convertedFromDocumentId: sourceDocumentId },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
        orderBy: { createdAt: 'asc' },
        take: 2,
      });
      if (optimisticExisting.length > 1 || (optimisticExisting[0] && optimisticExisting[0].documentType !== input.documentType)) {
        throw new ConflictException({
          code: 'accounting_document_already_converted',
          message: 'Quotation already has a different or duplicate converted document.',
        });
      }
      if (optimisticSource.status === 'CLOSED' && optimisticExisting[0]) {
        return { document: this.toDocumentRecord(optimisticExisting[0]), didConvert: false };
      }
      if (optimisticSource.documentType !== 'QUOTATION' || optimisticSource.status !== 'ISSUED'
        || optimisticSource.updatedAt.getTime() !== expectedSourceUpdatedAt.getTime()) {
        throw new ConflictException({
          code: 'accounting_document_changed',
          message: 'Quotation changed before conversion. Reload and retry.',
        });
      }

      await beforeMutation?.(tx);
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
      if (existing[0]) return { document: this.toDocumentRecord(existing[0]), didConvert: false };
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

      return {
        document: await this.createDocumentWithClient(tx, input),
        didConvert: true,
      };
    // The launch lock is intentionally acquired after the replay preflight. READ COMMITTED lets
    // the gate check observe a CLOSE that committed after those reads; SERIALIZABLE would keep the
    // stale preflight snapshot and could admit a root after CLOSE.
    }, { isolationLevel: 'ReadCommitted' });
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
          adjustmentReasonCode: input.adjustmentReasonCode ?? null,
          adjustmentReasonText: input.adjustmentReasonText ?? null,
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
            revenueCategoryId: line.revenueCategoryId,
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

  async listIssuedCorrectionLines(companyId: string, sourceDocumentId: string): Promise<Array<{
    documentType: 'CREDIT_NOTE' | 'DEBIT_NOTE';
    lines: Array<{ lineNumber: number; discountAmount: string; lineSubtotalAmount: string; lineTotalAmount: string }>;
  }>> {
    const rows = await this.prisma.client.accountingDocument.findMany({
      where: {
        companyId,
        sourceDocumentId,
        documentType: { in: ['CREDIT_NOTE', 'DEBIT_NOTE'] },
        status: { in: ['ISSUED', 'CREDITED', 'DEBITED', 'CLOSED'] },
      },
      select: {
        documentType: true,
        lines: { select: { lineNumber: true, discountAmount: true, lineSubtotalAmount: true, lineTotalAmount: true } },
      },
    });
    return rows.map((row: any) => ({
      documentType: row.documentType,
      lines: row.lines.map((line: any) => ({
        lineNumber: line.lineNumber,
        discountAmount: line.discountAmount.toString(),
        lineSubtotalAmount: line.lineSubtotalAmount.toString(),
        lineTotalAmount: line.lineTotalAmount.toString(),
      })),
    }));
  }

  /** Shared visibility predicate for list + aggregate: both must see exactly the same rows. */
  private async buildDocumentsWhere(filter: ListDocumentsFilter, branchIds?: string[]): Promise<Record<string, unknown>> {
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
    return where;
  }

  async listDocuments(filter: ListDocumentsFilter, branchIds?: string[]): Promise<PaginatedDocuments> {
    const page = filter.page ?? 1;
    const pageSize = Math.min(filter.pageSize ?? 20, 100);
    const skip = (page - 1) * pageSize;
    const where = await this.buildDocumentsWhere(filter, branchIds);
    const [data, total] = await Promise.all([
      // id tiebreaker: documentDate is non-unique, and OFFSET paging over an unstable order can
      // repeat/skip rows across pages (breaks multi-page aggregation in accounting.get_summary)
      this.prisma.client.accountingDocument.findMany({ where, skip, take: pageSize, orderBy: [{ documentDate: 'desc' }, { id: 'asc' }] }),
      this.prisma.client.accountingDocument.count({ where }),
    ]);
    return { data: data.map((r) => this.toDocumentRecord(r)), total, page, pageSize };
  }

  /**
   * PR #238 review T2: one snapshot-consistent database operation for accounting.get_summary —
   * a single groupBy sees one consistent row set, so a concurrent insert/move can never duplicate
   * one document and omit another the way an OFFSET page walk could, and the worst case is one
   * query instead of fifty. Sums stay exact: the database aggregates the Decimal column and the
   * result is formatted to a 2dp string, never JS float math.
   */
  async aggregateDocumentsByType(
    filter: Omit<ListDocumentsFilter, 'page' | 'pageSize'>,
    branchIds?: string[],
  ): Promise<{ total: number; byType: Record<string, { count: number; totalAmount: string }> }> {
    const where = await this.buildDocumentsWhere(filter, branchIds);
    const groups = await (this.prisma.client.accountingDocument as any).groupBy({
      by: ['documentType'],
      where,
      _count: { _all: true },
      _sum: { grandTotalAmount: true },
    });
    const byType: Record<string, { count: number; totalAmount: string }> = {};
    let total = 0;
    for (const group of groups as Array<{ documentType: string; _count: { _all: number }; _sum: { grandTotalAmount: unknown } }>) {
      total += group._count._all;
      byType[group.documentType] = {
        count: group._count._all,
        totalAmount: new Decimal(String(group._sum.grandTotalAmount ?? 0)).toFixed(2),
      };
    }
    return { total, byType };
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
      const initialDocument = await tx.accountingDocument.findFirst({
        where: { id, companyId },
        select: { sourceDocumentId: true },
      });
      if (!initialDocument) throw new NotFoundException(`Document ${id} not found`);
      const initialSource = initialDocument.sourceDocumentId
        ? await tx.accountingDocument.findFirst({
            where: { id: initialDocument.sourceDocumentId, companyId },
            select: { id: true, documentType: true, sourceDocumentId: true },
          })
        : null;
      const upstreamSource = initialSource?.documentType === 'RECEIPT' && initialSource.sourceDocumentId
        ? await tx.accountingDocument.findFirst({
            where: { id: initialSource.sourceDocumentId, companyId },
            select: { id: true, documentType: true },
          })
        : null;
      const lifecycleSourceId = upstreamSource?.documentType === 'INVOICE'
        ? upstreamSource.id
        : initialSource?.id;
      if (lifecycleSourceId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${lifecycleSourceId}:accounting-document-lifecycle`}))`;
      }
      if (initialSource?.id && initialSource.id !== lifecycleSourceId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${initialSource.id}:accounting-document-lifecycle`}))`;
      }
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
      if (sourceRow && currentRow.branchId !== sourceRow.branchId) {
        throw new UnprocessableEntityException('A source-linked document must use the same branch as its source');
      }
      const taxError = validateOutputTaxDocument(current, source);
      if (taxError) throw new UnprocessableEntityException(taxError);

      const taxRelevant = documentType === 'TAX_INVOICE'
        || (['CREDIT_NOTE', 'DEBIT_NOTE'].includes(documentType) && sourceRow?.documentType === 'TAX_INVOICE');
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
        if (!sourceRow || !['TAX_INVOICE', 'INVOICE'].includes(sourceRow.documentType)) {
          throw new UnprocessableEntityException('Credit note original TAX_INVOICE or non-VAT INVOICE was not found');
        }
        const issuedCorrections = await tx.accountingDocument.findMany({ where: {
          companyId, sourceDocumentId: sourceRow.id, id: { not: id }, documentType: { in: ['CREDIT_NOTE', 'DEBIT_NOTE'] },
          status: { in: ['ISSUED', 'CREDITED', 'DEBITED', 'CLOSED'] },
        }, select: { documentType: true, lines: { select: { lineNumber: true, discountAmount: true, taxBaseAmount: true, lineSubtotalAmount: true, transactionTaxAmount: true, vatAmount: true } } } });
        const error = validateCumulativeCreditNote(sourceRow.lines, currentRow.lines, issuedCorrections);
        if (error) throw new UnprocessableEntityException(error);
      }

      // Ledger spec F-LED-2: freeze the revenue-category NAME onto each line at issue time. The
      // free-text `revenueCategory` column is the immutable snapshot the ledger reads
      // (journal.use-case categoryKey); the FK keeps pointing at the live master for reports.
      const revenueCategoryIds = [...new Set((currentRow.lines ?? []).map((l: any) => l.revenueCategoryId).filter(Boolean))] as string[];
      if (revenueCategoryIds.length > 0) {
        const categories = await tx.revenueCategory.findMany({ where: { id: { in: revenueCategoryIds }, companyId }, select: { id: true, name: true } });
        const revenueNameById = new Map(categories.map((c: any) => [c.id, c.name] as const));
        for (const line of currentRow.lines ?? []) {
          if (!line.revenueCategoryId) continue;
          const revenueName = revenueNameById.get(line.revenueCategoryId);
          if (!revenueName) throw new UnprocessableEntityException('Line revenue category was not found for this company');
          await tx.accountingDocumentLine.update({ where: { id: line.id }, data: { revenueCategory: revenueName } });
        }
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
    // Source-linked issue and source void share the source lifecycle lock. READ COMMITTED is
    // required so a waiter validates against the source/corrections committed by the lock winner.
    }, { isolationLevel: 'ReadCommitted' });
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
    const row = await this.prisma.client.accountingDocument.update({ where: { id }, data: data as any });
    return this.toDocumentRecord(row);
  }

  async submitQuotationForApproval(
    companyId: string,
    id: string,
    actorUserId: string,
    beforeMutation: BeforeAccountingMutation,
  ): Promise<DocumentRecord> {
    return this.prisma.client.$transaction(async (tx) => {
      await beforeMutation(tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${id}:accounting-document-lifecycle`}))`;
      const updated = await tx.accountingDocument.updateMany({
        where: { id, companyId, documentType: 'QUOTATION', status: 'DRAFT' },
        data: {
          status: 'PENDING_APPROVAL', approvalStatus: 'PENDING', submittedByUserId: actorUserId,
          submittedAt: new Date(), updatedByUserId: actorUserId,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'accounting_document_changed',
          message: 'Quotation changed before approval submission. Reload and retry.',
        });
      }
      const row = await tx.accountingDocument.findFirstOrThrow({ where: { id, companyId } });
      return this.toDocumentRecord(row);
    });
  }

  // ---- Payment ----
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    requireTransactionBranchId(input.branchId);
    const run = () => this.prisma.client.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        if (!input.payloadFingerprint) {
          throw new UnprocessableEntityException('A server payment fingerprint is required with a retry key');
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.idempotencyKey}:accounting-payment-command`}))`;
        const prior = await tx.accountingPayment.findUnique({
          where: { companyId_idempotencyKey: { companyId: input.companyId, idempotencyKey: input.idempotencyKey } },
        });
        if (prior) {
          if (prior.payloadFingerprint !== input.payloadFingerprint) {
            throw new ConflictException({
              code: 'accounting_payment_idempotency_conflict',
              message: 'This retry key was already used with different payment details.',
            });
          }
          return { payment: this.toPaymentRecord(prior), replayed: true };
        }
      }

      let allocationTarget: any = null;
      if (input.allocateToDocumentId) {
        if (!input.idempotencyKey) {
          throw new UnprocessableEntityException('A retry key is required when allocating a payment to a document');
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.allocateToDocumentId}:accounting-document-lifecycle`}))`;
        allocationTarget = await tx.accountingDocument.findFirst({
          where: { id: input.allocateToDocumentId, companyId: input.companyId },
        });
        if (!allocationTarget) throw new NotFoundException('Payment allocation target was not found');
        if ((allocationTarget.branchId ?? undefined) !== input.branchId) {
          throw new UnprocessableEntityException('Payment branch must match the target document');
        }
        if ((allocationTarget.counterpartyId ?? undefined) !== input.counterpartyId) {
          throw new UnprocessableEntityException('Payment counterparty must match the target document');
        }
        const allocationError = validateAccountingPaymentAllocation(input, {
          documentType: allocationTarget.documentType,
          status: allocationTarget.status,
          currency: allocationTarget.currency,
          counterpartyId: allocationTarget.counterpartyId ?? undefined,
          outstandingAmount: allocationTarget.outstandingAmount.toString(),
        });
        if (allocationError) throw new UnprocessableEntityException(allocationError);
      }

      if (input.branchId) {
        const activeBranch = await tx.branch.findFirst({
          where: { id: input.branchId, companyId: input.companyId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!activeBranch) throw new UnprocessableEntityException('The payment branch is inactive');
      }

      const liveCounterparty = input.counterpartyId && !allocationTarget?.counterpartySnapshotJson
        ? await tx.accountingCounterparty.findFirst({ where: { id: input.counterpartyId, companyId: input.companyId } })
        : null;
      const counterpartySnapshot = allocationTarget?.counterpartySnapshotJson
        ?? (liveCounterparty ? { id: liveCounterparty.id, displayName: liveCounterparty.displayName, taxId: liveCounterparty.taxId } : undefined);
      const payment = await tx.accountingPayment.create({
        data: {
          companyId: input.companyId,
          idempotencyKey: input.idempotencyKey,
          payloadFingerprint: input.payloadFingerprint,
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

      // The number and the payment remain one transaction; a failed CAS cannot burn either.
      const reservedNumber = await this.documentNumbers.reserveNumberInTransaction(tx, {
        companyId: input.companyId,
        branchId: input.branchId ?? undefined,
        documentType: 'accounting.payment',
        periodKey: civilPeriodKey(civilDate(new Date(input.paidAt))),
        idempotencyKey: `accounting-payment:${payment.id}`,
        reservedByUserId: input.createdByUserId,
      });

      let allocatedAmount = '0.00';
      if (allocationTarget) {
        const outstanding = new Decimal(allocationTarget.outstandingAmount.toString());
        const withheld = new Decimal(input.whtAmount ?? '0');
        const alloc = Decimal.min(new Decimal(input.amount), Decimal.max(0, outstanding.minus(withheld)))
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        allocatedAmount = alloc.toFixed(2);
        const settled = alloc.plus(withheld);
        const newPaid = new Decimal(allocationTarget.paidAmount.toString()).plus(settled).toFixed(2);
        const newOutstanding = calculateOutstandingAmount(allocationTarget.grandTotalAmount.toString(), newPaid);
        const changed = await tx.accountingDocument.updateMany({
          where: {
            id: allocationTarget.id,
            companyId: input.companyId,
            updatedAt: allocationTarget.updatedAt,
            status: 'ISSUED',
            branchId: allocationTarget.branchId,
            counterpartyId: allocationTarget.counterpartyId,
            outstandingAmount: allocationTarget.outstandingAmount,
          },
          data: {
            paidAmount: newPaid,
            outstandingAmount: newOutstanding,
            paymentStatus: new Decimal(newOutstanding).lte(0) ? 'PAID' : 'PARTIALLY_PAID',
            updatedByUserId: input.createdByUserId,
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException({
            code: 'accounting_payment_state_changed',
            message: 'The document balance changed while recording this payment. Reload and try again.',
          });
        }
        await tx.accountingPaymentAllocation.create({
          data: {
            companyId: input.companyId,
            paymentId: payment.id,
            documentId: allocationTarget.id,
            amount: allocatedAmount,
            whtAmount: input.whtAmount ?? null,
            createdByUserId: input.createdByUserId,
          },
        });
      }

      const updated = await tx.accountingPayment.update({
        where: { id: payment.id },
        data: {
          paymentNumber: reservedNumber.documentNumber,
          allocatedAmount,
          unappliedAmount: calculateUnappliedCredit(input.amount, allocatedAmount),
        },
      });
      await this.documentNumbers.commitNumberInTransaction(tx, {
        id: reservedNumber.id,
        companyId: input.companyId,
        ownerType: 'accounting_payment',
        ownerId: payment.id,
      });
      return { payment: this.toPaymentRecord(updated), replayed: false };
    // Allocation, receipt creation, and payment/document void all share the document lifecycle
    // lock. READ COMMITTED makes a waiter calculate from the balance committed by the winner.
    }, { isolationLevel: 'ReadCommitted' });

    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        lastError = error;
        if ((error as { code?: string }).code !== 'P2034') throw error;
      }
    }
    throw lastError;
  }

  async recordSimpleIncomeBundle(
    input: RecordSimpleIncomeInput,
    withinTransaction: (db: any, result: Omit<RecordSimpleIncomeResult, 'replayed'>) => Promise<void>,
    beforeMutation?: BeforeAccountingMutation,
  ): Promise<RecordSimpleIncomeResult> {
    requireTransactionBranchId(input.branchId);
    const run = () => (this.prisma.client as any).$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.idempotencyKey}:simple-income`}))`;

      const prior = await tx.accountingSimpleIncomeCommand.findUnique({
        where: { companyId_idempotencyKey: { companyId: input.companyId, idempotencyKey: input.idempotencyKey } },
      });
      if (prior) {
        if (prior.payloadFingerprint !== input.payloadFingerprint) {
          throw new ConflictException({
            code: 'simple_income_idempotency_conflict',
            message: 'This retry key was already used with different income details.',
          });
        }
        const [invoice, payment, receipt] = await Promise.all([
          tx.accountingDocument.findFirstOrThrow({ where: { companyId: input.companyId, id: prior.invoiceId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } }),
          tx.accountingPayment.findFirstOrThrow({ where: { companyId: input.companyId, id: prior.paymentId } }),
          tx.accountingDocument.findFirstOrThrow({ where: { companyId: input.companyId, id: prior.receiptId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } }),
        ]);
        return {
          invoice: this.toDocumentRecord(invoice),
          payment: this.toPaymentRecord(payment),
          receipt: this.toDocumentRecord(receipt),
          replayed: true,
        };
      }

      await beforeMutation?.(tx);

      if (input.branchId) {
        const branch = await tx.branch.findFirst({ where: { id: input.branchId, companyId: input.companyId, status: 'ACTIVE' }, select: { id: true } });
        if (!branch) throw new NotFoundException('Branch was not found in the current company.');
      }
      const counterparty = input.counterpartyId
        ? await tx.accountingCounterparty.findFirst({ where: { id: input.counterpartyId, companyId: input.companyId, status: 'ACTIVE' } })
        : null;
      if (input.counterpartyId && !counterparty) throw new NotFoundException('Customer was not found in the current company.');

      const revenueCategoryIds = [...new Set(input.lines.map((line) => line.revenueCategoryId).filter(Boolean))] as string[];
      const categories = revenueCategoryIds.length
        ? await tx.revenueCategory.findMany({ where: { id: { in: revenueCategoryIds }, companyId: input.companyId, status: 'ACTIVE' }, select: { id: true, name: true } })
        : [];
      if (categories.length !== revenueCategoryIds.length) {
        throw new UnprocessableEntityException('Line revenue category is unknown, archived, or belongs to another company');
      }
      const revenueNameById = new Map(categories.map((category: any) => [category.id, category.name] as const));
      const periodKey = civilPeriodKey(coerceCivilDate(input.documentDate));
      const counterpartySnapshot = counterparty
        ? { id: counterparty.id, displayName: counterparty.displayName, taxId: counterparty.taxId, legalName: counterparty.legalName }
        : undefined;

      const invoice = await this.createDocumentWithClient(tx, {
        companyId: input.companyId,
        branchId: input.branchId,
        documentType: 'INVOICE',
        documentDate: input.documentDate,
        counterpartyId: input.counterpartyId,
        currency: 'THB',
        vatMode: input.vatMode,
        note: input.note,
        lines: input.lines,
        createdByUserId: input.createdByUserId,
      });
      const invoiceNumber = await this.documentNumbers.reserveNumberInTransaction(tx, {
        companyId: input.companyId,
        branchId: input.branchId,
        documentType: 'accounting.invoice',
        periodKey,
        idempotencyKey: `simple-income:${input.idempotencyKey}:invoice`,
        reservedByUserId: input.createdByUserId,
      });
      for (const line of invoice.lines ?? []) {
        if (!line.revenueCategoryId) continue;
        await tx.accountingDocumentLine.update({
          where: { id: line.id },
          data: { revenueCategory: revenueNameById.get(line.revenueCategoryId) },
        });
      }
      const issuedAt = new Date();
      await tx.accountingDocument.update({
        where: { id: invoice.id },
        data: {
          status: 'ISSUED', documentNumber: invoiceNumber.documentNumber,
          issuedByUserId: input.createdByUserId, issuedAt,
          counterpartySnapshotJson: counterpartySnapshot as any,
          postingStatus: 'pending', paymentStatus: 'UNPAID', updatedByUserId: input.createdByUserId,
        },
      });
      await this.documentNumbers.commitNumberInTransaction(tx, {
        id: invoiceNumber.id, companyId: input.companyId, ownerType: 'accounting_document', ownerId: invoice.id,
      });

      const invoiceTotal = new Decimal(invoice.grandTotalAmount);
      const withheld = new Decimal(invoice.whtAmount);
      const cashReceived = invoiceTotal.minus(withheld).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      if (cashReceived.lte(0)) {
        throw new UnprocessableEntityException('Withheld tax must be less than the income total');
      }
      const payment = await tx.accountingPayment.create({
        data: {
          companyId: input.companyId, branchId: input.branchId, direction: 'RECEIVED', status: 'RECORDED',
          counterpartyId: input.counterpartyId, counterpartySnapshotJson: counterpartySnapshot as any,
          method: input.paymentMethod, amount: cashReceived.toFixed(2), whtAmount: withheld.toFixed(2),
          allocatedAmount: cashReceived.toFixed(2), unappliedAmount: '0', currency: 'THB',
          paidAt: civilDateToUtcDate(coerceCivilDate(input.documentDate)), note: input.note,
          postingStatus: 'pending', createdByUserId: input.createdByUserId,
        },
      });
      const paymentNumber = await this.documentNumbers.reserveNumberInTransaction(tx, {
        companyId: input.companyId, branchId: input.branchId, documentType: 'accounting.payment', periodKey,
        idempotencyKey: `simple-income:${input.idempotencyKey}:payment`, reservedByUserId: input.createdByUserId,
      });
      await tx.accountingPayment.update({ where: { id: payment.id }, data: { paymentNumber: paymentNumber.documentNumber } });
      await tx.accountingPaymentAllocation.create({
        data: {
          companyId: input.companyId, paymentId: payment.id, documentId: invoice.id,
          amount: cashReceived.toFixed(2), whtAmount: withheld.gt(0) ? withheld.toFixed(2) : null,
          createdByUserId: input.createdByUserId,
        },
      });
      await this.documentNumbers.commitNumberInTransaction(tx, {
        id: paymentNumber.id, companyId: input.companyId, ownerType: 'accounting_payment', ownerId: payment.id,
      });
      await tx.accountingDocument.update({
        where: { id: invoice.id },
        data: {
          paidAmount: invoiceTotal.toFixed(2), outstandingAmount: '0', paymentStatus: 'PAID',
          updatedByUserId: input.createdByUserId,
        },
      });

      const receipt = await this.createDocumentWithClient(tx, {
        companyId: input.companyId,
        branchId: input.branchId,
        documentType: 'RECEIPT',
        documentDate: input.documentDate,
        counterpartyId: input.counterpartyId,
        sourceDocumentId: invoice.id,
        sourceDocumentType: 'INVOICE',
        currency: 'THB',
        vatMode: input.vatMode,
        note: input.note,
        lines: input.lines,
        createdByUserId: input.createdByUserId,
      });
      const receiptNumber = await this.documentNumbers.reserveNumberInTransaction(tx, {
        companyId: input.companyId, branchId: input.branchId, documentType: 'accounting.receipt', periodKey,
        idempotencyKey: `simple-income:${input.idempotencyKey}:receipt`, reservedByUserId: input.createdByUserId,
      });
      for (const line of receipt.lines ?? []) {
        if (!line.revenueCategoryId) continue;
        await tx.accountingDocumentLine.update({ where: { id: line.id }, data: { revenueCategory: revenueNameById.get(line.revenueCategoryId) } });
      }
      await tx.accountingDocument.update({
        where: { id: receipt.id },
        data: {
          status: 'ISSUED', documentNumber: receiptNumber.documentNumber,
          issuedByUserId: input.createdByUserId, issuedAt,
          counterpartySnapshotJson: counterpartySnapshot as any,
          // The AccountingPayment above is the canonical settlement posting source. Auto-receipt
          // is evidence only; marking it pending would post cash/AR a second time.
          postingStatus: 'not_required', paidAmount: invoiceTotal.toFixed(2), outstandingAmount: '0',
          paymentStatus: 'PAID', updatedByUserId: input.createdByUserId,
        },
      });
      await this.documentNumbers.commitNumberInTransaction(tx, {
        id: receiptNumber.id, companyId: input.companyId, ownerType: 'accounting_document', ownerId: receipt.id,
      });

      const [persistedInvoice, persistedPayment, persistedReceipt] = await Promise.all([
        tx.accountingDocument.findFirstOrThrow({ where: { companyId: input.companyId, id: invoice.id }, include: { lines: { orderBy: { lineNumber: 'asc' } } } }),
        tx.accountingPayment.findFirstOrThrow({ where: { companyId: input.companyId, id: payment.id } }),
        tx.accountingDocument.findFirstOrThrow({ where: { companyId: input.companyId, id: receipt.id }, include: { lines: { orderBy: { lineNumber: 'asc' } } } }),
      ]);
      const result = {
        invoice: this.toDocumentRecord(persistedInvoice),
        payment: this.toPaymentRecord(persistedPayment),
        receipt: this.toDocumentRecord(persistedReceipt),
      };
      await withinTransaction(tx, result);
      await tx.accountingSimpleIncomeCommand.create({
        data: {
          companyId: input.companyId, idempotencyKey: input.idempotencyKey,
          payloadFingerprint: input.payloadFingerprint,
          invoiceId: invoice.id, paymentId: payment.id, receiptId: receipt.id,
        },
      });
      return { ...result, replayed: false };
    // Idempotency is serialized by the command advisory lock. READ COMMITTED is required because
    // the shared launch lock follows the replay read and must see a CLOSE committed in that gap.
    }, { isolationLevel: 'ReadCommitted' });
    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        lastError = error;
        if ((error as { code?: string }).code !== 'P2034') throw error;
      }
    }
    throw lastError;
  }

  // ---- Revenue categories (ledger spec F-LED-2) ----
  // Company-scoped only — no `companyId: null` union like the expense picker: global default rows
  // are exactly the duplication trap this master was designed without (LED-FIN-03).

  async listRevenueCategories(companyId: string): Promise<RevenueCategorySummary[]> {
    const rows = await this.prisma.client.revenueCategory.findMany({
      where: { companyId, status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => this.toRevenueCategorySummary(row));
  }

  /** Management view including archived rows. */
  async listAllRevenueCategories(companyId: string): Promise<RevenueCategorySummary[]> {
    const rows = await this.prisma.client.revenueCategory.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => this.toRevenueCategorySummary(row));
  }

  async findRevenueCategoryById(companyId: string, categoryId: string): Promise<RevenueCategorySummary | null> {
    const row = await this.prisma.client.revenueCategory.findFirst({ where: { id: categoryId, companyId } });
    return row ? this.toRevenueCategorySummary(row) : null;
  }

  async createRevenueCategory(companyId: string, input: CreateRevenueCategoryInput): Promise<RevenueCategorySummary> {
    const row = await this.prisma.client.revenueCategory.create({
      data: {
        companyId,
        name: input.name,
        accountHintKey: input.accountHintKey,
        defaultOutputTaxCode: input.defaultOutputTaxCode ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return this.toRevenueCategorySummary(row);
  }

  async updateRevenueCategory(companyId: string, categoryId: string, input: UpdateRevenueCategoryInput): Promise<RevenueCategorySummary> {
    await this.prisma.client.revenueCategory.updateMany({
      where: { id: categoryId, companyId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.accountHintKey !== undefined ? { accountHintKey: input.accountHintKey } : {}),
        ...(input.defaultOutputTaxCode !== undefined ? { defaultOutputTaxCode: input.defaultOutputTaxCode } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.status !== undefined ? { status: input.status as any } : {}),
      },
    });
    const row = await this.prisma.client.revenueCategory.findFirst({ where: { id: categoryId, companyId } });
    if (!row) throw new NotFoundException('Revenue category not found');
    return this.toRevenueCategorySummary(row);
  }

  private toRevenueCategorySummary(row: any): RevenueCategorySummary {
    return {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      accountHintKey: row.accountHintKey,
      defaultOutputTaxCode: row.defaultOutputTaxCode ?? null,
      status: row.status,
      sortOrder: row.sortOrder,
    };
  }

  async findPaymentById(companyId: string, id: string, branchIds?: string[]): Promise<PaymentRecord | null> {
    const row = await this.prisma.client.accountingPayment.findFirst({ where: { id, companyId, ...branchScopeWhere({ branchIds }) } });
    return row ? this.toPaymentRecord(row) : null;
  }

  async findPaymentByIdempotencyKey(
    companyId: string,
    idempotencyKey: string,
    branchIds?: string[],
  ): Promise<{ payment: PaymentRecord; payloadFingerprint?: string } | null> {
    const row = await this.prisma.client.accountingPayment.findFirst({
      where: { companyId, idempotencyKey, ...branchScopeWhere({ branchIds }) },
    });
    return row ? {
      payment: this.toPaymentRecord(row),
      payloadFingerprint: row.payloadFingerprint ?? undefined,
    } : null;
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
      const allocations = await tx.accountingPaymentAllocation.findMany({ where: { paymentId, companyId } });
      const documentIds = [...new Set(allocations.map((allocation: any) => String(allocation.documentId)))].sort();
      for (const documentId of documentIds) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${documentId}:accounting-document-lifecycle`}))`;
      }
      const activeReceipt = documentIds.length
        ? await tx.accountingDocument.findFirst({
            where: {
              companyId,
              sourceDocumentId: { in: documentIds },
              documentType: 'RECEIPT',
              status: { not: 'VOIDED' },
            },
            select: { documentNumber: true },
          })
        : null;
      if (activeReceipt) {
        throw new UnprocessableEntityException({
          code: 'accounting_active_receipt_must_be_voided',
          message: 'Void the active receipt before voiding its payment.',
        });
      }

      const claimed = await tx.accountingPayment.updateMany({
        where: { id: paymentId, companyId, status: { not: 'VOIDED' } },
        data: {
          status: 'VOIDED', voidedByUserId: actorUserId, voidedAt: new Date(), voidReason: reason,
          updatedByUserId: actorUserId, allocatedAmount: '0.00', unappliedAmount: '0.00',
        },
      });
      if (claimed.count !== 1) throw new ConflictException('Payment is already voided');

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
    // READ COMMITTED is intentional here: allocation ids identify the lifecycle
    // locks, and after waiting for a concurrent receipt creator the next statement
    // must see that newly committed receipt. A SERIALIZABLE snapshot taken by the
    // pre-lock allocation read can stay stale and incorrectly void the payment.
    // The explicit lifecycle locks plus the payment CAS still serialize every write.
    }, { isolationLevel: 'ReadCommitted' });
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
      const initialDocument = await tx.accountingDocument.findFirst({
        where: { id: documentId, companyId },
        select: { documentType: true, sourceDocumentId: true },
      });
      const upstreamSource = initialDocument?.documentType === 'RECEIPT' && initialDocument.sourceDocumentId
        ? await tx.accountingDocument.findFirst({
            where: { id: initialDocument.sourceDocumentId, companyId },
            select: { id: true, documentType: true },
          })
        : null;
      const lifecycleSourceId = upstreamSource?.documentType === 'INVOICE' ? upstreamSource.id : documentId;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${lifecycleSourceId}:accounting-document-lifecycle`}))`;
      if (lifecycleSourceId !== documentId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${documentId}:accounting-document-lifecycle`}))`;
      }
      const receiptChildren = await tx.accountingDocument.findMany({
        where: { companyId, sourceDocumentId: documentId, documentType: 'RECEIPT' },
        select: { id: true },
      });
      const activeChild = await tx.accountingDocument.findFirst({
        where: {
          companyId,
          sourceDocumentId: { in: [documentId, ...receiptChildren.map((row: { id: string }) => row.id)] },
          documentType: { in: ['RECEIPT', 'TAX_INVOICE'] },
          status: { not: 'VOIDED' },
        },
        select: { documentType: true, documentNumber: true },
      });
      if (activeChild) {
        throw new UnprocessableEntityException({
          code: 'accounting_active_child_document_must_be_voided',
          message: 'Void the active receipt or tax invoice before voiding its source document.',
        });
      }
      const claimed = await tx.accountingDocument.updateMany({
        where: { id: documentId, companyId, status: expectedStatus },
        data: {
          status: 'VOIDED', voidedByUserId: actorUserId, voidedAt: new Date(), voidReason: reason,
          updatedByUserId: actorUserId, paidAmount: '0.00', outstandingAmount: '0.00', paymentStatus: 'VOIDED',
        },
      });
      if (claimed.count !== 1) throw new ConflictException({ code: 'accounting_document_changed', message: 'Document changed before void. Reload and retry.' });
      const doc = await tx.accountingDocument.findFirstOrThrow({ where: { id: documentId, companyId } });

      if (doc.documentType === 'TAX_INVOICE' || doc.documentType === 'INVOICE') {
        const correction = await tx.accountingDocument.findFirst({
          where: {
            companyId, sourceDocumentId: documentId, documentType: { in: ['CREDIT_NOTE', 'DEBIT_NOTE'] },
            status: { in: ['ISSUED', 'CREDITED', 'DEBITED', 'CLOSED'] },
          },
          select: { documentNumber: true },
        });
        if (correction) {
          throw new UnprocessableEntityException(`Credit/debit note ${correction.documentNumber ?? ''} still references this source document; void the corrections first`);
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

      const correctionSource = ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(doc.documentType) && doc.sourceDocumentId
        ? await tx.accountingDocument.findFirst({ where: { id: doc.sourceDocumentId, companyId }, select: { documentType: true } })
        : null;
      const taxRelevant = doc.documentType === 'TAX_INVOICE' || correctionSource?.documentType === 'TAX_INVOICE';
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
    // The lifecycle lock may wait for a linked receipt/tax-invoice creator. READ COMMITTED makes
    // the child lookup see that commit before allowing the source to be voided.
    }, { isolationLevel: 'ReadCommitted' });
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
      adjustmentReasonCode: row.adjustmentReasonCode ?? undefined,
      adjustmentReasonText: row.adjustmentReasonText ?? undefined,
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
      revenueCategoryId: row.revenueCategoryId ?? undefined,
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
