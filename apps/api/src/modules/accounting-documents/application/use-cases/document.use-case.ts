import { Injectable, ForbiddenException, NotFoundException, UnprocessableEntityException, ConflictException } from '@nestjs/common';
import { PrismaAccountingRepository } from '../../infrastructure/prisma-accounting.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { CancelDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/cancel-document-number.use-case';
import {
  validateStatusTransition,
  validateIssuableLines,
  validateQuotationApproval,
  validateVoid,
  isDraftEditable,
  documentSequenceKey,
  deriveCompatibleOutputTaxCode,
  validateOutputTaxDocument,
  validateAdjustmentReason,
  isIssued,
} from '../../domain/logic/accounting-status.logic';
import type { DocumentRecord, CreateDocumentInput, UpdateDocumentInput, ListDocumentsFilter, PaginatedDocuments } from '../../domain/models/accounting.model';
import type { RequestContext, AccountingDocumentType } from '@watchdog-bms/contracts';
import type { ResolveTransactionTaxPreviewDto, TransactionTaxComponentPreview, TransactionTaxContext, TransactionTaxSnapshot } from '@watchdog-bms/contracts';
import { LEDGER_SEQUENCE_KEY } from '@watchdog-bms/contracts';
import { TransactionTaxConfigUseCase } from '../../../tax/application/use-cases/transaction-tax-config.use-case';
import { Decimal } from 'decimal.js';
import { createHash } from 'node:crypto';
import { formatTransactionTaxAmount } from '../../../tax/domain/logic/transaction-tax.logic';
import { validateAccountingDocumentMoneyInput } from '../../domain/logic/accounting-money-validation.logic';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { requireTransactionBranchId } from '../../../data-model-core/application/services/transaction-branch';
import { civilPeriodKey, coerceCivilDate, todayCivilDate } from '@watchdog-bms/contracts';
import { observeCustomerJourney } from '../../../../common/observability/customer-journey-audit';
import { CompanyVatRegistrationUseCase } from '../../../data-model-core/application/use-cases/company-vat-registration.use-case';
import { canonicalFingerprint } from '../../../../common/security/canonical-fingerprint';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import {
  assertSalesDocumentSourceMutationInTransaction,
  createsNewSalesRoot,
  rethrowSalesDocumentRootError,
} from '../sales-document-launch-gate';

function docPermission(documentType: AccountingDocumentType, action: 'read' | 'create' | 'update' | 'issue' | 'void'): string {
  const typeKey = documentType.toLowerCase();
  return `accounting.${typeKey}.${action}`;
}

const DOCUMENT_TYPES: AccountingDocumentType[] = ['QUOTATION', 'INVOICE', 'BILLING_NOTE', 'RECEIPT', 'TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'];

function hasDocumentPermission(ctx: RequestContext, documentType: AccountingDocumentType, action: 'read' | 'create' | 'update' | 'issue' | 'void'): boolean {
  return ctx.permissions.includes(`accounting.document.${action}`) || ctx.permissions.includes(docPermission(documentType, action));
}

/** Ledger spec F-LED-2: a line may only reference an ACTIVE revenue category of this company. */
async function assertRevenueCategoriesUsable(
  repo: PrismaAccountingRepository,
  companyId: string,
  lines: ReadonlyArray<{ revenueCategoryId?: string }>,
): Promise<void> {
  const ids = [...new Set(lines.map((line) => line.revenueCategoryId).filter((v): v is string => Boolean(v)))];
  if (ids.length === 0) return;
  const active = await repo.listRevenueCategories(companyId);
  const activeIds = new Set(active.map((category) => category.id));
  if (ids.some((id) => !activeIds.has(id))) {
    throw new UnprocessableEntityException('Line revenue category is unknown, archived, or belongs to another company');
  }
}

async function assertVatRegistrationAllowsDocument(
  vatRegistration: CompanyVatRegistrationUseCase,
  companyId: string,
  documentDate: string,
  vatMode: string,
): Promise<void> {
  const status = (await vatRegistration.get(companyId, documentDate)).status;
  if (status === 'UNKNOWN') {
    throw new UnprocessableEntityException('Company VAT registration status must be confirmed before creating or issuing an accounting document');
  }
  if (status === 'NOT_REGISTERED' && vatMode !== 'NO_VAT') {
    throw new UnprocessableEntityException('A company that is not VAT registered must use NO_VAT on accounting documents');
  }
}

@Injectable()
export class CreateDocumentUseCase {
  constructor(
    private readonly repo: PrismaAccountingRepository,
    private readonly audit: AuditService,
    private readonly transactionTax: TransactionTaxConfigUseCase,
    private readonly vatRegistration: CompanyVatRegistrationUseCase,
    private readonly launchGate: LaunchGateGuardService,
  ) {}

  async execute(ctx: RequestContext, input: Omit<CreateDocumentInput, 'companyId' | 'createdByUserId' | 'payloadFingerprint'>): Promise<DocumentRecord> {
    const perm = docPermission(input.documentType, 'create');
    if (!hasDocumentPermission(ctx, input.documentType, 'create')) {
      throw new ForbiddenException(`Missing permission: ${perm}`);
    }
    if (ctx.scopes.branchIds?.length === 0 || !isBranchInScope(ctx.scopes, input.branchId)) {
      throw new ForbiddenException('Branch is outside your assigned branch scope.');
    }
    if (input.idempotencyKey && input.documentType !== 'INVOICE') {
      throw new UnprocessableEntityException('Create idempotency is supported only for invoice drafts');
    }
    const moneyError = validateAccountingDocumentMoneyInput(input);
    if (moneyError) throw new UnprocessableEntityException(moneyError);
    const reasonError = validateAdjustmentReason(input);
    if (reasonError) throw new UnprocessableEntityException(reasonError);
    const source = input.sourceDocumentId
      ? await this.repo.findDocumentById(ctx.companyId, input.sourceDocumentId, ctx.scopes.branchIds)
      : undefined;
    if (input.sourceDocumentId && !source) throw new NotFoundException('Referenced source document was not found');
    if (source && input.branchId !== undefined && input.branchId !== source.branchId) {
      throw new UnprocessableEntityException('A source-linked document must use the same branch as its source');
    }
    if (source && ctx.scopes.branchIds && !source.branchId) {
      throw new ForbiddenException('A branch-restricted user cannot create a company-central source-linked document');
    }
    const branchId = source
      ? requireTransactionBranchId(source.branchId)
      : await this.repo.resolveCreateBranchId(ctx.companyId, ctx.scopes, input.branchId);
    if (branchId && !(await this.repo.findActiveBranch(ctx.companyId, branchId))) {
      throw new NotFoundException('Branch was not found in the current company.');
    }
    const normalizedInput = {
      ...input,
      branchId,
      outputTaxCode: input.outputTaxCode ?? deriveCompatibleOutputTaxCode(input.lines),
    };
    await assertVatRegistrationAllowsDocument(
      this.vatRegistration, ctx.companyId, normalizedInput.documentDate, normalizedInput.vatMode,
    );
    const taxError = validateOutputTaxDocument(normalizedInput, source ?? undefined);
    if (taxError) throw new UnprocessableEntityException(taxError);
    const createsRoot = createsNewSalesRoot(normalizedInput, source ?? undefined);
    const taxNeutral = ['QUOTATION', 'INVOICE', 'BILLING_NOTE', 'RECEIPT'].includes(normalizedInput.documentType);
    if (taxNeutral && normalizedInput.lines.some((line) => line.taxCodeDefinitionId || line.externalTaxCode)) {
      throw new UnprocessableEntityException(`${normalizedInput.documentType} lines cannot carry a Tax Code`);
    }
    await assertRevenueCategoriesUsable(this.repo, ctx.companyId, normalizedInput.lines);
    const { idempotencyKey, ...fingerprintInput } = normalizedInput;
    const payloadFingerprint = idempotencyKey
      ? canonicalFingerprint({ version: 'invoice-draft-create-v1', companyId: ctx.companyId, actorUserId: ctx.userId, ...fingerprintInput })
      : undefined;
    let result: DocumentRecord;
    try {
      result = await this.repo.createDocument({
        ...normalizedInput,
        companyId: ctx.companyId,
        createdByUserId: ctx.userId,
        ...(payloadFingerprint ? { payloadFingerprint } : {}),
      }, async (db) => {
        if (createsRoot) {
          await this.launchGate.assertLaunchRouteOpenInTransaction(db, 'sales_documents', 'DEFAULT');
        }
        const currentSource = await assertSalesDocumentSourceMutationInTransaction(db, ctx.companyId, normalizedInput);
        // A source-linked runoff that loses eligibility must fail closed. Never
        // let future drift between eligibility and gate classification turn it
        // into an ungated new root while CLOSED.
        if (!createsRoot && createsNewSalesRoot(normalizedInput, currentSource)) {
          throw new UnprocessableEntityException('Referenced source document is no longer eligible for this linked document');
        }
      });
    } catch (error) {
      if (!createsRoot) throw error;
      return rethrowSalesDocumentRootError(error, this.audit, ctx, 'accounting.document.create');
    }
    let persisted: DocumentRecord;
    try {
      if ((normalizedInput.documentType === 'CREDIT_NOTE' || normalizedInput.documentType === 'DEBIT_NOTE')
        && source?.documentType === 'TAX_INVOICE') {
        const sign = normalizedInput.documentType === 'CREDIT_NOTE' ? -1 : 1;
        const context: TransactionTaxContext = sign === -1 ? 'RETURN_OR_CREDIT' : 'DEBIT_ADJUSTMENT';
        const inherited = (result.lines ?? []).map((line) => {
          const original = source.lines?.find((candidate) => candidate.lineNumber === line.lineNumber);
          if (!original?.taxSnapshot || !original.taxComponents?.length) {
            throw new UnprocessableEntityException(`Original line ${line.lineNumber} has no immutable Tax Code snapshot`);
          }
          const components = original.taxComponents.map((component) => signedComponent(component, sign, context, {
            taxBaseAmount: line.lineSubtotalAmount,
            taxAmount: line.vatAmount,
            grossAmount: line.lineTotalAmount,
          }));
          return { lineId: line.id, snapshot: components[0]!.snapshot, components };
        });
        await this.repo.saveInheritedLineTaxSnapshots(ctx.companyId, result.id, inherited);
      } else if (!taxNeutral) {
        const resolved = [];
        for (const line of result.lines ?? []) {
          const selected = normalizedInput.lines.find((candidate) => candidate.lineNumber === line.lineNumber);
          if (!selected?.taxCodeDefinitionId && !selected?.externalTaxCode) continue;
          resolved.push({
            lineId: line.id,
            preview: await this.transactionTax.resolveSourceTax(ctx, {
              branchId: normalizedInput.branchId,
              sourceType: 'accounting.document', sourceId: result.id, sourceLineId: line.id,
              transactionContext: selected.transactionContext ?? 'DOMESTIC_SALE',
              documentDate: normalizedInput.documentDate, currency: normalizedInput.currency ?? 'THB',
              taxCodeDefinitionId: selected.taxCodeDefinitionId, externalTaxCode: selected.externalTaxCode,
              netAmount: line.lineSubtotalAmount, grossAmount: line.lineTotalAmount,
              enteredTaxAmount: line.vatAmount, evidenceRefs: selected.evidenceRefs,
            }, 'DRAFT', undefined, 'OUTPUT', 'accounting'),
          });
        }
        if (resolved.length) await this.repo.saveLineTaxSnapshots(ctx.companyId, result.id, resolved);
      }
      persisted = await this.repo.findDocumentById(ctx.companyId, result.id) ?? result;
      const persistedTaxError = validateOutputTaxDocument(persisted, source ?? undefined);
      if (persistedTaxError) throw new UnprocessableEntityException(persistedTaxError);
    } catch (error) {
      await this.repo.deleteDraftDocument(ctx.companyId, result.id);
      throw error;
    }
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.document.create', targetType: 'accounting_document', targetId: persisted.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { documentType: normalizedInput.documentType } });
    return persisted;
  }
}

@Injectable()
export class UpdateDocumentUseCase {
  constructor(
    private readonly repo: PrismaAccountingRepository,
    private readonly audit: AuditService,
    private readonly transactionTax: TransactionTaxConfigUseCase,
    private readonly vatRegistration: CompanyVatRegistrationUseCase,
  ) {}

  async execute(ctx: RequestContext, input: Omit<UpdateDocumentInput, 'companyId' | 'updatedByUserId'>): Promise<DocumentRecord> {
    const current = await this.repo.findDocumentById(ctx.companyId, input.documentId, ctx.scopes.branchIds);
    if (!current) throw new NotFoundException(`Document ${input.documentId} not found`);

    const permission = docPermission(current.documentType, 'update');
    if (!hasDocumentPermission(ctx, current.documentType, 'update')) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
    const isRejectedQuotation = current.documentType === 'QUOTATION' && current.status === 'REJECTED';
    if (!isDraftEditable(current.status) && !isRejectedQuotation) {
      throw new UnprocessableEntityException(`Only DRAFT documents or REJECTED quotations can be edited; document is ${current.status}`);
    }
    if (Number.isNaN(input.expectedUpdatedAt.getTime())) {
      throw new UnprocessableEntityException('expectedUpdatedAt must be a valid timestamp');
    }

    const source = current.sourceDocumentId
      ? await this.repo.findDocumentById(ctx.companyId, current.sourceDocumentId, ctx.scopes.branchIds)
      : undefined;
    if (current.sourceDocumentId && !source) throw new NotFoundException('Referenced source document was not found');
    if (source && input.branchId !== undefined && (input.branchId ?? undefined) !== source.branchId) {
      throw new UnprocessableEntityException('A source-linked document must use the same branch as its source');
    }
    if (source && ctx.scopes.branchIds && !source.branchId) {
      throw new ForbiddenException('A branch-restricted user cannot update a company-central source-linked document');
    }
    const branchId = source
      ? source.branchId
      : input.branchId === undefined ? current.branchId : input.branchId ?? undefined;
    if (!isBranchInScope(ctx.scopes, branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    if (branchId && !(await this.repo.findActiveBranch(ctx.companyId, branchId))) {
      throw new NotFoundException('Branch was not found in the current company.');
    }

    const lines = input.lines ?? (current.lines ?? []).map((line) => ({
      lineNumber: line.lineNumber,
      productId: line.productId,
      skuSnapshot: line.skuSnapshot,
      description: line.description,
      unitName: line.unitName,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      vatRate: line.vatRate,
      whtRate: line.whtRate,
      taxCategory: line.taxCategory,
      revenueCategory: line.revenueCategory,
      revenueCategoryId: line.revenueCategoryId,
      taxCodeDefinitionId: line.taxSnapshot?.taxCodeDefinitionId ?? undefined,
      externalTaxCode: line.taxSnapshot?.externalTaxCode ?? undefined,
      transactionContext: line.taxSnapshot?.taxContext ?? undefined,
    }));
    if (new Set(lines.map((line) => line.lineNumber)).size !== lines.length) {
      throw new UnprocessableEntityException('Accounting document line numbers must be unique');
    }
    const outputTaxCode = input.outputTaxCode !== undefined
      ? input.outputTaxCode ?? undefined
      : input.lines ? deriveCompatibleOutputTaxCode(lines) : current.outputTaxCode;
    const replacement: CreateDocumentInput = {
      companyId: ctx.companyId,
      branchId,
      documentType: current.documentType,
      documentDate: input.documentDate ?? coerceCivilDate(current.documentDate),
      dueDate: input.dueDate !== undefined ? input.dueDate ?? undefined : current.dueDate ? coerceCivilDate(current.dueDate) : undefined,
      counterpartyId: input.counterpartyId !== undefined ? input.counterpartyId ?? undefined : current.counterpartyId,
      sourceDocumentId: current.sourceDocumentId,
      sourceDocumentType: current.sourceDocumentType,
      convertedFromDocumentId: current.convertedFromDocumentId,
      currency: input.currency ?? current.currency,
      vatMode: input.vatMode ?? current.vatMode,
      outputTaxCode,
      note: input.note !== undefined ? input.note ?? undefined : current.note,
      internalMemo: input.internalMemo !== undefined ? input.internalMemo ?? undefined : current.internalMemo,
      adjustmentReasonCode: input.adjustmentReasonCode !== undefined ? input.adjustmentReasonCode ?? undefined : current.adjustmentReasonCode,
      adjustmentReasonText: input.adjustmentReasonText !== undefined ? input.adjustmentReasonText ?? undefined : current.adjustmentReasonText,
      lines,
      createdByUserId: current.createdByUserId,
    };

    const moneyError = validateAccountingDocumentMoneyInput(replacement);
    if (moneyError) throw new UnprocessableEntityException(moneyError);
    const reasonError = validateAdjustmentReason(replacement);
    if (reasonError) throw new UnprocessableEntityException(reasonError);
    const taxError = validateOutputTaxDocument(replacement, source ?? undefined);
    if (taxError) throw new UnprocessableEntityException(taxError);
    await assertVatRegistrationAllowsDocument(
      this.vatRegistration, ctx.companyId, replacement.documentDate, replacement.vatMode,
    );
    const taxNeutral = ['QUOTATION', 'INVOICE', 'BILLING_NOTE', 'RECEIPT'].includes(replacement.documentType);
    await assertRevenueCategoriesUsable(this.repo, ctx.companyId, replacement.lines);

    const updated = await this.repo.updateDraftDocument(
      input.documentId,
      input.expectedUpdatedAt,
      replacement,
      ctx.userId,
      async (db, draft) => {
        if ((replacement.documentType === 'CREDIT_NOTE' || replacement.documentType === 'DEBIT_NOTE')
          && source?.documentType === 'TAX_INVOICE') {
          const sign = replacement.documentType === 'CREDIT_NOTE' ? -1 : 1;
          const context: TransactionTaxContext = sign === -1 ? 'RETURN_OR_CREDIT' : 'DEBIT_ADJUSTMENT';
          const inherited = (draft.lines ?? []).map((line) => {
            const original = source.lines?.find((candidate) => candidate.lineNumber === line.lineNumber);
            if (!original?.taxSnapshot || !original.taxComponents?.length) {
              throw new UnprocessableEntityException(`Original line ${line.lineNumber} has no immutable Tax Code snapshot`);
            }
            return {
              lineId: line.id,
              snapshot: original.taxSnapshot,
              components: original.taxComponents.map((component) => signedComponent(component, sign, context, {
                taxBaseAmount: line.lineSubtotalAmount,
                taxAmount: line.vatAmount,
                grossAmount: line.lineTotalAmount,
              })),
            };
          });
          await this.repo.saveInheritedLineTaxSnapshots(ctx.companyId, draft.id, inherited, db);
          return;
        }
        if (taxNeutral) return;

        const resolved = [];
        for (const line of draft.lines ?? []) {
          const selected = replacement.lines.find((candidate) => candidate.lineNumber === line.lineNumber);
          if (!selected?.taxCodeDefinitionId && !selected?.externalTaxCode) continue;
          resolved.push({
            lineId: line.id,
            preview: await this.transactionTax.resolveSourceTax(ctx, {
              branchId: replacement.branchId,
              sourceType: 'accounting.document', sourceId: draft.id, sourceLineId: line.id,
              transactionContext: selected.transactionContext ?? 'DOMESTIC_SALE',
              documentDate: replacement.documentDate, currency: replacement.currency ?? 'THB',
              taxCodeDefinitionId: selected.taxCodeDefinitionId, externalTaxCode: selected.externalTaxCode,
              netAmount: line.lineSubtotalAmount, grossAmount: line.lineTotalAmount,
              enteredTaxAmount: line.vatAmount, evidenceRefs: selected.evidenceRefs,
            }, 'DRAFT', db, 'OUTPUT', 'accounting'),
          });
        }
        if (resolved.length) await this.repo.saveLineTaxSnapshots(ctx.companyId, draft.id, resolved, db);
      },
    );
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'accounting.document.update',
      targetType: 'accounting_document',
      targetId: updated.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: {
        documentType: updated.documentType, priorUpdatedAt: input.expectedUpdatedAt.toISOString(),
        ...(isRejectedQuotation ? { priorStatus: current.status, status: updated.status, rejectionNote: current.approvalNote } : {}),
      },
    });
    return updated;
  }
}

@Injectable()
export class GetDocumentUseCase {
  constructor(private readonly repo: PrismaAccountingRepository) {}

  async execute(ctx: RequestContext, documentId: string): Promise<DocumentRecord> {
    const result = await this.repo.findDocumentById(ctx.companyId, documentId, ctx.scopes.branchIds);
    if (!result) throw new NotFoundException(`Document ${documentId} not found`);
    const related = ctx.permissions.includes('accounting.document.read_related')
      && await this.repo.isDocumentRelatedToUser(ctx.companyId, result.id, ctx.userId, ctx.scopes.branchIds);
    if (!hasDocumentPermission(ctx, result.documentType, 'read') && !related) {
      throw new ForbiddenException(`Missing permission: ${docPermission(result.documentType, 'read')}`);
    }
    if (!['TAX_INVOICE', 'INVOICE'].includes(result.documentType)
      || !['ISSUED', 'CREDITED', 'DEBITED'].includes(result.status)) return result;
    const corrections = await this.repo.listIssuedCorrectionLines(ctx.companyId, result.id);
    const basis = (line: { lineSubtotalAmount: string; lineTotalAmount: string; discountAmount?: string }) => (
      result.vatMode === 'VAT_INCLUDED'
        ? new Decimal(line.lineTotalAmount)
        : new Decimal(line.lineSubtotalAmount).sub(line.discountAmount ?? 0)
    );
    return {
      ...result,
      lines: result.lines?.map((line) => {
        let remaining = basis(line);
        for (const correction of corrections) {
          const prior = correction.lines.find((candidate) => candidate.lineNumber === line.lineNumber);
          if (!prior) continue;
          const amount = basis(prior).abs();
          remaining = correction.documentType === 'DEBIT_NOTE' ? remaining.add(amount) : remaining.sub(amount);
        }
        return { ...line, correctionBasisAmount: Decimal.max(remaining, 0).toDecimalPlaces(2).toFixed(2) };
      }),
    };
  }
}

@Injectable()
export class ListDocumentsUseCase {
  constructor(private readonly repo: PrismaAccountingRepository) {}

  /** Permission narrowing shared by list and aggregate — both must see exactly the same rows. */
  private scopedFilter<T extends { documentType?: AccountingDocumentType; branchId?: string }>(
    ctx: RequestContext,
    filter: T,
  ): T & { companyId: string; documentTypes?: AccountingDocumentType[]; relatedUserId?: string } {
    const readableTypes = DOCUMENT_TYPES.filter((documentType) => hasDocumentPermission(ctx, documentType, 'read'));
    const canReadRelated = ctx.permissions.includes('accounting.document.read_related');
    const canReadAll = ctx.permissions.includes('accounting.document.read');
    if (!readableTypes.length && !canReadRelated) throw new ForbiddenException('Missing accounting document read permission');
    if (filter.documentType && !readableTypes.includes(filter.documentType) && !canReadRelated) {
      throw new ForbiddenException(`Missing permission: ${docPermission(filter.documentType, 'read')}`);
    }
    // Explicit out-of-scope branch filter is a 403, never a silent empty list (spec R6). Written out
    // rather than via isBranchInScope, which answers true for an absent branchId (spec §4.2).
    if (ctx.scopes.branchIds && filter.branchId && !ctx.scopes.branchIds.includes(filter.branchId)) throw new ForbiddenException('Branch is out of scope');
    return {
      ...filter,
      companyId: ctx.companyId,
      ...(!canReadAll ? { documentTypes: readableTypes } : {}),
      ...(canReadRelated && !canReadAll ? { relatedUserId: ctx.userId } : {}),
    };
  }

  async execute(ctx: RequestContext, filter: Omit<ListDocumentsFilter, 'companyId'>): Promise<PaginatedDocuments> {
    return this.repo.listDocuments(this.scopedFilter(ctx, filter), ctx.scopes.branchIds);
  }

  /**
   * PR #238 review T2: snapshot-consistent period aggregate for accounting.get_summary — one
   * permission-scoped groupBy instead of an OFFSET page walk. Same narrowing as execute().
   */
  async aggregateByType(
    ctx: RequestContext,
    filter: { fromDate?: string; toDate?: string; branchId?: string; documentType?: AccountingDocumentType; status?: ListDocumentsFilter['status'] },
  ): Promise<{ total: number; byType: Record<string, { count: number; totalAmount: string | null; currency: string | null; totalsByCurrency: Array<{ currency: string; totalAmount: string; count: number }> }> }> {
    return this.repo.aggregateDocumentsByType(this.scopedFilter(ctx, filter), ctx.scopes.branchIds);
  }

  async aggregateOpenReceivables(ctx: RequestContext) {
    return this.repo.aggregateOpenReceivables(this.scopedFilter(ctx, {}), ctx.scopes.branchIds);
  }
}

@Injectable()
export class IssueDocumentUseCase {
  constructor(
    private readonly repo: PrismaAccountingRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
    private readonly cancelNumber: CancelDocumentNumberUseCase,
    private readonly transactionTax: TransactionTaxConfigUseCase,
    private readonly vatRegistration: CompanyVatRegistrationUseCase,
  ) {}

  async execute(ctx: RequestContext, documentId: string): Promise<DocumentRecord> {
    return observeCustomerJourney(
      this.audit,
      {
        key: 'sales-confirmation', requestId: ctx.requestId, targetType: 'accounting_document', targetId: documentId,
        companyId: ctx.companyId, actorUserId: ctx.userId,
      },
      () => this.issue(ctx, documentId),
      () => ({ outcome: 'issued' }),
    );
  }

  private async issue(ctx: RequestContext, documentId: string): Promise<DocumentRecord> {
    const doc = await this.repo.findDocumentById(ctx.companyId, documentId, ctx.scopes.branchIds);
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    const perm = docPermission(doc.documentType, 'issue');
    if (!hasDocumentPermission(ctx, doc.documentType, 'issue')) throw new ForbiddenException(`Missing permission: ${perm}`);
    // The document lifecycle itself is the idempotency fence. If the response was lost after a
    // committed issue, a retry returns the immutable issued document without reserving a second
    // number, emitting another event, or writing another audit row.
    if (isIssued(doc.status) && doc.documentNumber && doc.issuedAt) return doc;

    const transitionError = validateStatusTransition(doc.status, 'ISSUED', doc.documentType);
    if (transitionError) throw new UnprocessableEntityException(transitionError);

    const lineError = validateIssuableLines(doc.lines?.length ?? 0);
    if (lineError) throw new UnprocessableEntityException(lineError);

    await assertVatRegistrationAllowsDocument(
      this.vatRegistration, ctx.companyId, coerceCivilDate(doc.documentDate), doc.vatMode,
    );

    const source = doc.sourceDocumentId
      ? await this.repo.findDocumentById(ctx.companyId, doc.sourceDocumentId, ctx.scopes.branchIds)
      : undefined;
    const taxError = validateOutputTaxDocument(doc, source ?? undefined);
    if (taxError) throw new UnprocessableEntityException(taxError);
    const taxRelevant = doc.documentType === 'TAX_INVOICE'
      || (['CREDIT_NOTE', 'DEBIT_NOTE'].includes(doc.documentType) && source?.documentType === 'TAX_INVOICE');
    if (taxRelevant && (doc.lines ?? []).some((line) => !line.taxSnapshot || !line.taxComponents?.length)) {
      throw new UnprocessableEntityException('Every tax document line requires a server-resolved Tax Code snapshot before issue');
    }
    if (doc.documentType === 'RECEIPT' && (doc.lines ?? []).some((line) => line.taxSnapshot || line.taxComponents?.length)) {
      throw new UnprocessableEntityException('RECEIPT is payment evidence only and cannot carry transaction-tax lines');
    }
    // Reserve document number
    const seqKey = documentSequenceKey(doc.documentType);
    const periodKey = civilPeriodKey(todayCivilDate());
    const reserved = await this.reserveNumber.execute({
      companyId: ctx.companyId,
      branchId: doc.branchId,
      documentType: seqKey,
      periodKey,
      idempotencyKey: `issue:${documentId}`,
      reservedByUserId: ctx.userId,
    });

    // Get counterparty snapshot
    let cpSnapshot: Record<string, unknown> | undefined;
    if (doc.counterpartyId) {
      const cp = await this.repo.findCounterpartyById(ctx.companyId, doc.counterpartyId);
      if (cp) cpSnapshot = { id: cp.id, displayName: cp.displayName, taxId: cp.taxId, legalName: cp.legalName };
    }

    let issued: DocumentRecord;
    let taxPreviews: ResolveTransactionTaxPreviewDto[] = [];
    try {
      const result = await this.repo.issueDocument(
        ctx.companyId,
        documentId,
        reserved.documentNumber,
        ctx.userId,
        doc.documentType,
        cpSnapshot,
        doc.status,
        doc.updatedAt,
        taxRelevant ? async ({ db, document: current, source: currentSource }) => {
          if (current.documentType === 'TAX_INVOICE') {
            return Promise.all((current.lines ?? []).map(async (line) => {
              const context = line.taxSnapshot?.taxContext ?? 'DOMESTIC_SALE';
              const evidenceRefs = await this.transactionTax.listVerifiedEvidenceIdsForSource(ctx, {
                sourceType: 'accounting.document', sourceId: current.id, sourceLineId: line.id,
                transactionContext: context, branchId: current.branchId,
              }, db);
              return {
                lineId: line.id,
                preview: await this.transactionTax.resolveSourceTaxInTransaction(ctx, {
                  branchId: current.branchId, sourceType: 'accounting.document', sourceId: current.id, sourceLineId: line.id,
                  transactionContext: context, documentDate: current.documentDate.toISOString(), currency: current.currency,
                  taxCodeDefinitionId: line.taxSnapshot?.taxCodeDefinitionId ?? undefined,
                  externalTaxCode: line.taxSnapshot?.externalTaxCode ?? undefined,
                  netAmount: line.lineSubtotalAmount, grossAmount: line.lineTotalAmount,
                  enteredTaxAmount: line.vatAmount, evidenceRefs,
                }, 'FINAL', db, undefined, 'OUTPUT', 'accounting'),
              };
            }));
          }
          if (!currentSource || currentSource.documentType !== 'TAX_INVOICE') {
            throw new UnprocessableEntityException(`${current.documentType} requires an original TAX_INVOICE for tax finalization`);
          }
          const sign = current.documentType === 'CREDIT_NOTE' ? -1 : 1;
          const context: TransactionTaxContext = sign === -1 ? 'RETURN_OR_CREDIT' : 'DEBIT_ADJUSTMENT';
          return (current.lines ?? []).map((line) => {
            const original = currentSource.lines?.find((candidate) => candidate.lineNumber === line.lineNumber);
            if (!original?.taxSnapshot || !original.taxComponents?.length) {
              throw new UnprocessableEntityException(`Original line ${line.lineNumber} has no immutable Tax Code snapshot`);
            }
            const components = original.taxComponents.map((component) => signedComponent(component, sign, context, {
              taxBaseAmount: line.lineSubtotalAmount, taxAmount: line.vatAmount, grossAmount: line.lineTotalAmount,
            }));
            return { lineId: line.id, preview: correctionPreview(current, currentSource, line.id, components) };
          });
        } : undefined,
      );
      issued = result.document;
      taxPreviews = result.taxPreviews;
      await this.commitNumber.execute({ id: reserved.id, companyId: ctx.companyId, ownerType: 'accounting_document', ownerId: documentId }, ctx.userId);
    } catch (err) {
      // The reservation is still RESERVED here (commit happens only after a
      // successful issue), so it must be cancelled — voidNumber accepts
      // COMMITTED numbers only and would mask the real error.
      await this.cancelNumber.execute({ id: reserved.id, companyId: ctx.companyId }, ctx.userId);
      throw err;
    }

    const docType = doc.documentType.toLowerCase().replace('_', '.');
    void this.outbox.append(`accounting.${docType}.issued`, 'accounting_document', documentId, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'accounting_document', aggregateId: documentId, occurredAt: new Date().toISOString(),
      data: { documentId, documentNumber: issued.documentNumber, documentType: doc.documentType, grandTotalAmount: doc.grandTotalAmount, outputTaxCode: doc.outputTaxCode },
    });

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.document.issue', targetType: 'accounting_document', targetId: documentId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { documentNumber: issued.documentNumber, documentType: doc.documentType } });

    if (taxRelevant) {
      const taxFacts = (issued.lines ?? []).map((line, index) => ({
        sourceLineId: line.id,
        externalTaxCode: line.taxSnapshot?.externalTaxCode ?? null,
        profileKey: line.taxSnapshot?.taxProfileKey ?? null,
        profileVersion: line.taxSnapshot?.taxProfileVersion ?? null,
        treatment: line.taxSnapshot?.taxTreatment ?? null,
        roundingMode: line.taxSnapshot?.roundingMode ?? null,
        roundingScale: line.taxSnapshot?.roundingScale ?? null,
        taxAmountTolerance: line.taxSnapshot?.taxAmountTolerance ?? null,
        taxBaseAmount: line.taxSnapshot?.taxBaseAmount ?? line.lineSubtotalAmount,
        taxAmount: line.taxSnapshot?.taxAmount ?? line.vatAmount,
        evidenceStatus: line.taxSnapshot?.evidenceStatus ?? null,
        accountRuleVersion: line.taxSnapshot?.accountRuleVersion ?? null,
        reportRuleVersion: line.taxSnapshot?.reportRuleVersion ?? null,
        sourceChecksum: taxPreviews[index]?.sourceChecksum ?? null,
        configurationChecksum: taxPreviews[index]?.configurationChecksum ?? null,
      }));
      const checksum = createHash('sha256').update(JSON.stringify(taxFacts)).digest('hex');
      await this.audit.log({
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: 'tax.document_tax.finalize',
        targetType: 'accounting_document',
        targetId: documentId,
        requestId: ctx.requestId,
        result: 'SUCCESS',
        riskLevel: 'CRITICAL',
        metadataJson: { sourceType: 'accounting.document', documentType: doc.documentType, status: 'FINAL', periodKey: civilPeriodKey(coerceCivilDate(doc.documentDate)), checksum, lines: taxFacts },
      });
      await this.outbox.append('tax.document_tax.finalized', 'accounting_document', documentId, {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        requestId: ctx.requestId,
        aggregateType: 'accounting_document',
        aggregateId: documentId,
        occurredAt: new Date().toISOString(),
        data: { sourceType: 'accounting.document', documentType: doc.documentType, periodKey: civilPeriodKey(coerceCivilDate(doc.documentDate)), checksum },
      });
    }

    return issued;
  }
}

@Injectable()
export class VoidDocumentUseCase {
  constructor(
    private readonly repo: PrismaAccountingRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
    private readonly cancelNumber: CancelDocumentNumberUseCase,
  ) {}

  async execute(ctx: RequestContext, documentId: string, reason: string): Promise<DocumentRecord> {
    const doc = await this.repo.findDocumentById(ctx.companyId, documentId, ctx.scopes.branchIds);
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    const perm = docPermission(doc.documentType, 'void');
    if (!hasDocumentPermission(ctx, doc.documentType, 'void')) throw new ForbiddenException(`Missing permission: ${perm}`);

    const voidError = validateVoid(doc.status, reason);
    if (voidError) throw new UnprocessableEntityException(voidError);

    // H-04: reserve the reversal entry number outside the void transaction;
    // the transaction re-verifies posting state and fails closed on change.
    const postedJournalId = await this.repo.findPostedGeneratedJournalId(ctx.companyId, 'accounting.document', documentId);
    const reserved = postedJournalId
      ? await this.reserveNumber.execute({
          companyId: ctx.companyId, documentType: LEDGER_SEQUENCE_KEY,
          periodKey: civilPeriodKey(todayCivilDate()),
          // Date.now() is deliberate: reserveNumber returns a matching-key row
          // regardless of its status, so a deterministic key would hand a
          // retried void the CANCELLED reservation from the failed attempt.
          idempotencyKey: `void-reversal:accounting.document:${documentId}:${Date.now()}`,
          reservedByUserId: ctx.userId,
        })
      : null;

    let result;
    try {
      result = await this.repo.voidDocumentTrueReversal(ctx.companyId, documentId, ctx.userId, reason, doc.status, reserved?.documentNumber);
    } catch (err) {
      // The reservation is still RESERVED here (commit happens only after a
      // successful reversal), so it must be cancelled — voidNumber accepts
      // COMMITTED numbers only and would mask the real error.
      if (reserved) await this.cancelNumber.execute({ id: reserved.id, companyId: ctx.companyId }, ctx.userId);
      throw err;
    }
    if (reserved) {
      if (result.reversalEntryId) {
        await this.commitNumber.execute({ id: reserved.id, companyId: ctx.companyId, ownerType: 'journal_entry', ownerId: result.reversalEntryId }, ctx.userId);
      } else {
        await this.cancelNumber.execute({ id: reserved.id, companyId: ctx.companyId }, ctx.userId);
      }
    }

    const docType = doc.documentType.toLowerCase().replace('_', '.');
    void this.outbox.append(`accounting.${docType}.voided`, 'accounting_document', documentId, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'accounting_document', aggregateId: documentId, occurredAt: new Date().toISOString(),
      data: {
        documentId, documentNumber: doc.documentNumber, documentType: doc.documentType, reason,
        reversalEntryId: result.reversalEntryId, releasedAllocations: result.releasedAllocations,
      },
    });
    for (const credit of result.unappliedCredits) {
      void this.outbox.append('accounting.payment.unapplied_credit_created', 'accounting_payment', credit.paymentId, {
        companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
        aggregateType: 'accounting_payment', aggregateId: credit.paymentId, occurredAt: new Date().toISOString(),
        data: { paymentId: credit.paymentId, unappliedAmount: credit.unappliedAmount, currency: credit.currency, releasedFromDocumentId: documentId },
      });
    }

    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.document.void',
      targetType: 'accounting_document', targetId: documentId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'CRITICAL',
      metadataJson: { documentNumber: doc.documentNumber, reason, reversalEntryId: result.reversalEntryId, releasedAllocations: result.releasedAllocations },
    });

    return result.document;
  }
}

@Injectable()
export class SubmitQuotationApprovalUseCase {
  constructor(
    private readonly repo: PrismaAccountingRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly launchGate: LaunchGateGuardService,
  ) {}

  async execute(ctx: RequestContext, documentId: string): Promise<DocumentRecord> {
    if (!ctx.permissions.includes('accounting.quotation.submit_approval')) throw new ForbiddenException('Missing permission: accounting.quotation.submit_approval');

    const doc = await this.repo.findDocumentById(ctx.companyId, documentId, ctx.scopes.branchIds);
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    if (doc.documentType !== 'QUOTATION') throw new UnprocessableEntityException('Only quotations can be submitted for approval');

    const transitionError = validateStatusTransition(doc.status, 'PENDING_APPROVAL', 'QUOTATION');
    if (transitionError) throw new UnprocessableEntityException(transitionError);

    let updated: DocumentRecord;
    try {
      updated = await this.repo.submitQuotationForApproval(
        ctx.companyId,
        documentId,
        ctx.userId,
        (db) => this.launchGate.assertLaunchRouteOpenInTransaction(db, 'sales_documents', 'DEFAULT'),
      );
    } catch (error) {
      return rethrowSalesDocumentRootError(error, this.audit, ctx, 'accounting.quotation.submit_approval');
    }

    void this.outbox.append('accounting.quotation.submitted_for_approval', 'accounting_document', documentId, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'accounting_document', aggregateId: documentId, occurredAt: new Date().toISOString(),
      data: { documentId, submittedByUserId: ctx.userId },
    });

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.quotation.submit_approval', targetType: 'accounting_document', targetId: documentId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });

    return updated;
  }
}

@Injectable()
export class ApproveQuotationUseCase {
  constructor(private readonly repo: PrismaAccountingRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}

  async execute(ctx: RequestContext, documentId: string, note?: string): Promise<DocumentRecord> {
    if (!ctx.permissions.includes('accounting.quotation.approve')) throw new ForbiddenException('Missing permission: accounting.quotation.approve');

    const doc = await this.repo.findDocumentById(ctx.companyId, documentId, ctx.scopes.branchIds);
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    if (doc.documentType !== 'QUOTATION') throw new UnprocessableEntityException('Only quotations can be approved');

    // Enforce: approver cannot be the same person who submitted
    const selfApprovalError = doc.submittedByUserId ? validateQuotationApproval(doc.submittedByUserId, ctx.userId) : null;
    if (selfApprovalError) {
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.quotation.approve', targetType: 'accounting_document', targetId: documentId, requestId: ctx.requestId, result: 'DENIED', riskLevel: 'HIGH', metadataJson: { reason: selfApprovalError } });
      throw new ForbiddenException(selfApprovalError);
    }

    const transitionError = validateStatusTransition(doc.status, 'APPROVED', 'QUOTATION');
    if (transitionError) throw new UnprocessableEntityException(transitionError);

    const updated = await this.repo.updateDocumentStatus(ctx.companyId, documentId, 'APPROVED', ctx.userId, {
      approvalNote: note, expectedStatus: doc.status, expectedUpdatedAt: doc.updatedAt,
    });

    void this.outbox.append('accounting.quotation.approved', 'accounting_document', documentId, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'accounting_document', aggregateId: documentId, occurredAt: new Date().toISOString(),
      data: { documentId, approvedByUserId: ctx.userId },
    });

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.quotation.approve', targetType: 'accounting_document', targetId: documentId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { note } });

    return updated;
  }
}

@Injectable()
export class RejectQuotationUseCase {
  constructor(private readonly repo: PrismaAccountingRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}

  async execute(ctx: RequestContext, documentId: string, note: string): Promise<DocumentRecord> {
    if (!ctx.permissions.includes('accounting.quotation.approve')) throw new ForbiddenException('Missing permission: accounting.quotation.approve');

    const doc = await this.repo.findDocumentById(ctx.companyId, documentId, ctx.scopes.branchIds);
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    if (doc.documentType !== 'QUOTATION') throw new UnprocessableEntityException('Only quotations can be rejected');

    const transitionError = validateStatusTransition(doc.status, 'REJECTED', 'QUOTATION');
    if (transitionError) throw new UnprocessableEntityException(transitionError);

    const updated = await this.repo.updateDocumentStatus(ctx.companyId, documentId, 'REJECTED', ctx.userId, {
      approvalNote: note, expectedStatus: doc.status, expectedUpdatedAt: doc.updatedAt,
    });

    void this.outbox.append('accounting.quotation.rejected', 'accounting_document', documentId, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'accounting_document', aggregateId: documentId, occurredAt: new Date().toISOString(),
      data: { documentId, rejectedByUserId: ctx.userId, note },
    });

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.quotation.reject', targetType: 'accounting_document', targetId: documentId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { note } });

    return updated;
  }
}

@Injectable()
export class ConvertDocumentUseCase {
  constructor(
    private readonly repo: PrismaAccountingRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly launchGate: LaunchGateGuardService,
  ) {}

  async execute(ctx: RequestContext, sourceDocumentId: string, targetType: AccountingDocumentType): Promise<DocumentRecord> {
    const source = await this.repo.findDocumentById(ctx.companyId, sourceDocumentId, ctx.scopes.branchIds);
    if (!source) throw new NotFoundException(`Source document ${sourceDocumentId} not found`);
    const related = ctx.permissions.includes('accounting.document.read_related')
      && await this.repo.isDocumentRelatedToUser(ctx.companyId, source.id, ctx.userId, ctx.scopes.branchIds);
    if (!hasDocumentPermission(ctx, source.documentType, 'read') && !related) {
      throw new ForbiddenException(`Missing permission: ${docPermission(source.documentType, 'read')}`);
    }
    if (source.status !== 'ISSUED' && source.status !== 'CLOSED') throw new UnprocessableEntityException('Only issued documents can be converted');
    if (source.documentType !== 'QUOTATION') throw new UnprocessableEntityException('Only quotations can be converted');
    if (targetType !== 'INVOICE' && targetType !== 'BILLING_NOTE') throw new UnprocessableEntityException('Quotations can only convert to INVOICE or BILLING_NOTE');
    if (!hasDocumentPermission(ctx, targetType, 'create')) {
      throw new ForbiddenException(`Missing permission: ${docPermission(targetType, 'create')}`);
    }
    const lines = (source.lines ?? []).map((l) => ({
      lineNumber: l.lineNumber,
      productId: l.productId,
      skuSnapshot: l.skuSnapshot,
      description: l.description,
      unitName: l.unitName,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountAmount: l.discountAmount,
      vatRate: l.vatRate,
      whtRate: l.whtRate,
      taxCategory: l.taxCategory,
      revenueCategory: l.revenueCategory,
      revenueCategoryId: l.revenueCategoryId,
    }));

    let result;
    try {
      result = await this.repo.convertQuotation(source.id, source.updatedAt, {
        companyId: ctx.companyId,
        branchId: source.branchId,
        documentType: targetType,
        documentDate: source.documentDate.toISOString().split('T')[0],
        dueDate: source.dueDate?.toISOString().split('T')[0],
        counterpartyId: source.counterpartyId,
        convertedFromDocumentId: source.id,
        currency: source.currency,
        vatMode: source.vatMode,
        outputTaxCode: undefined,
        note: source.note,
        createdByUserId: ctx.userId,
        lines,
      }, ctx.userId, (db) => this.launchGate.assertLaunchRouteOpenInTransaction(db, 'sales_documents', 'DEFAULT'));
    } catch (error) {
      return rethrowSalesDocumentRootError(error, this.audit, ctx, 'accounting.document.convert');
    }
    const converted = result.document;

    if (result.didConvert) {
      void this.outbox.append('accounting.document.converted', 'accounting_document', sourceDocumentId, {
        companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
        aggregateType: 'accounting_document', aggregateId: sourceDocumentId, occurredAt: new Date().toISOString(),
        data: { sourceDocumentId, targetDocumentId: converted.id, targetType },
      });

      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.document.convert', targetType: 'accounting_document', targetId: sourceDocumentId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { targetType, targetDocumentId: converted.id } });
    }

    return converted;
  }
}

function correctionPreview(
  document: DocumentRecord,
  source: DocumentRecord,
  lineId: string,
  components: TransactionTaxComponentPreview[],
): ResolveTransactionTaxPreviewDto {
  const first = components[0]!;
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    components,
    snapshot: first.snapshot,
    accountRole: first.accountRole,
    accountId: first.accountId,
    reportContributions: components.flatMap((component) => component.reportContributions),
    warnings: [],
    errors: [],
    sourceChecksum: digest({ documentId: document.id, documentUpdatedAt: document.updatedAt, sourceId: source.id, sourceUpdatedAt: source.updatedAt, lineId }),
    configurationChecksum: digest(components.map((component) => ({
      componentKey: component.componentKey,
      taxCodeDefinitionId: component.snapshot.taxCodeDefinitionId,
      taxProfileKey: component.snapshot.taxProfileKey,
      taxProfileVersion: component.snapshot.taxProfileVersion,
      roundingMode: component.snapshot.roundingMode,
      roundingScale: component.snapshot.roundingScale,
      taxAmountTolerance: component.snapshot.taxAmountTolerance,
      accountAssignments: component.accountAssignments,
      reportMappings: component.reportContributions.map(({ formType, boxKey, amountSource }) => ({ formType, boxKey, amountSource })),
    }))),
  };
}

export function signedComponent(
  component: TransactionTaxComponentPreview,
  sign: 1 | -1,
  context: TransactionTaxContext,
  correction?: { taxBaseAmount: string; taxAmount: string; grossAmount: string },
): TransactionTaxComponentPreview {
  const signed = (value: string) => formatTransactionTaxAmount(new Decimal(value).abs().mul(sign), {
    roundingMode: component.snapshot.roundingMode,
    roundingScale: component.snapshot.roundingScale,
    taxAmountTolerance: component.snapshot.taxAmountTolerance,
  });
  const base = correction?.taxBaseAmount ?? component.snapshot.taxBaseAmount;
  const tax = correction?.taxAmount ?? component.snapshot.taxAmount;
  const snapshot: TransactionTaxSnapshot = {
    ...component.snapshot,
    taxContext: context,
    taxBaseAmount: signed(base),
    taxAmount: signed(tax),
  };
  return {
    ...component,
    snapshot,
    accountAssignments: component.accountAssignments.map((assignment) => ({
      ...assignment,
      postingSide: sign === -1 ? (assignment.postingSide === 'DEBIT' ? 'CREDIT' : 'DEBIT') : assignment.postingSide,
    })),
    reportContributions: component.reportContributions.map((entry) => ({
      ...entry,
      amount: signed(entry.amountSource === 'TAX_BASE' ? base
        : entry.amountSource === 'TAX_AMOUNT' ? tax
          : entry.amountSource === 'GROSS' ? correction?.grossAmount ?? entry.amount
            : entry.amount),
    })),
  };
}
