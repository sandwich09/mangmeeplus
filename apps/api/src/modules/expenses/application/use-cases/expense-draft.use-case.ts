import { Injectable, ForbiddenException, Logger, NotFoundException, BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PAYMENT_IDEMPOTENCY_KEY_PATTERN } from '../../../accounting-documents/domain/logic/accounting-money-validation.logic';
import { PrismaExpenseRepository, requireExpenseBranchId } from '../../infrastructure/prisma-expense.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import {
  reconcileExpenseVat,
  validateExpenseVatSourceInput,
  vatSourceFromSnapshot,
} from '../../domain/logic/expense-vat-reconciliation.logic';
import { validateExpenseDraftAmounts, validateExpenseLineVatTreatments } from '../../domain/logic/expense-draft-amount-validation.logic';
import { applyExpenseWhtInput, expenseWhtLineRate } from '../../domain/logic/expense-wht-input.logic';
import { toSourceDocumentType } from '../../domain/logic/expense-document.logic';
import {
  validateStatusTransition,
  validateConfirm,
  derivePostingStatus,
  buildIdempotencyKey,
  hasBlockingNonExpenseClassification,
  NON_EXPENSE_CLASSIFICATION_REVIEW_REQUIRED,
  hasAiGrandTotalMismatch,
  hasAcknowledgedAiTotalMismatch,
  hasSelectedTaxCode,
  isDomesticInputTaxLine,
  validateDomesticInputVatEvidence,
  expenseTaxSourceChecksum,
  hasMissingClaimableVatTaxSnapshot,
  firstUnknownVatRateLineNumber,
  readAiCategorySuggestion,
} from '../../domain/logic/expense-status.logic';
import type { ExpenseLineInput, ExpenseRecord, ExpenseRecordWithRelations, PaginatedExpenses } from '../../domain/models/expense.model';
import type { RequestContext, CreateExpenseDraftInput, UpdateExpenseDraftInput, ListExpensesFilter, ExpenseStatus, ExpenseVatSourceOverrideInput, RecordExpensePaymentInput } from '@watchdog-bms/contracts';
import { expenseVatReconciliationMessage, isBlockingExpenseVatReconciliation, validateExpenseWhtInput } from '@watchdog-bms/contracts';
import { ExpenseTransactionTaxService, type ExpenseTaxLineSelection } from '../services/expense-transaction-tax.service';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { assertExpenseRootOpen } from '../expense-launch-gate';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { CancelDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/cancel-document-number.use-case';
import { CompanyVatRegistrationUseCase } from '../../../data-model-core/application/use-cases/company-vat-registration.use-case';
import { LEDGER_SEQUENCE_KEY, civilDateToUtcDate, coerceCivilDate, utcDateToCivilDate } from '@watchdog-bms/contracts';
import { civilPeriodKey, todayCivilDate } from '@watchdog-bms/contracts';
import type { AuditLogEntry } from '../../../audit/domain/models/audit-log.model';
import { observeCustomerJourney } from '../../../../common/observability/customer-journey-audit';

function hasPerm(ctx: RequestContext, perm: string): boolean {
  return ctx.permissions.includes(perm);
}

function requirePerm(ctx: RequestContext, perm: string, action: string) {
  if (!hasPerm(ctx, perm)) throw new ForbiddenException(`Missing permission: ${perm} for ${action}`);
}

// 10D branch ABAC: membership branch scope governs reads and writes; null branchId = company-central.
function assertBranchInScope(ctx: RequestContext, branchId: string | null | undefined) {
  if (!isBranchInScope(ctx.scopes ?? {}, branchId)) {
    throw new ForbiddenException('Branch is outside your assigned branch scope.');
  }
}

@Injectable()
export class CreateExpenseDraftUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService, private readonly transactionTax: ExpenseTransactionTaxService, private readonly launchGate: LaunchGateGuardService) {}

  async execute(ctx: RequestContext, input: CreateExpenseDraftInput): Promise<ExpenseRecord> {
    const canCreate = hasPerm(ctx, 'expense.create') || hasPerm(ctx, 'expense.receipt.upload') || hasPerm(ctx, 'expense.receipt.line_upload');
    if (!canCreate) throw new ForbiddenException('Missing permission: expense.create');
    // One of the two roots of the expenses journey — the manual draft. Guarded here rather than in
    // the controller so every caller of the use case is covered, LINE note capture included.
    await assertExpenseRootOpen(this.launchGate, this.audit, ctx, 'expense.create');
    assertBranchInScope(ctx, input.branchId);
    const branchId = await this.repo.resolveCreateBranchId(ctx.companyId, ctx.scopes ?? {}, input.branchId);

    // Compute totals from lines
    const lines = input.lines ?? [];
    const amountError = validateExpenseDraftAmounts({ vatMode: input.vatMode, lines });
    if (amountError) throw new BadRequestException(amountError);
    const whtInputError = validateExpenseWhtInput(input.whtInput);
    if (whtInputError) throw new BadRequestException(whtInputError);
    const vatSourceError = validateExpenseVatSourceInput(input.vatSource, input.vatMode, lines.map((line) => line.lineNumber));
    if (vatSourceError) throw new BadRequestException(vatSourceError);
    const vat = reconcileExpenseVat({
      vatMode: input.vatMode,
      lines,
      source: input.vatSource,
      sourceOrigin: 'REVIEWER',
    });
    const whtAmountError = applyExpenseWhtInput(vat, input.whtInput);
    if (whtAmountError) throw new BadRequestException(whtAmountError);
    const vatTreatmentError = validateExpenseLineVatTreatments(lines.map((line, index) => ({ ...line, vatRate: vat.lines[index]!.vatRate })));
    if (vatTreatmentError) throw new BadRequestException(vatTreatmentError);
    const totals = vat.totals;

    const record = await this.repo.createExpense({
      companyId: ctx.companyId,
      branchId: branchId ?? undefined,
      captureSource: input.captureSource,
      expenseDate: civilDateToUtcDate(coerceCivilDate(input.expenseDate)),
      currency: input.currency ?? 'THB',
      vatMode: input.vatMode,
      inputVatClaimStatus: input.inputVatClaimStatus,
      expenseCategoryId: input.expenseCategoryId,
      accountHintKey: input.accountHintKey,
      note: input.note,
      missingReceiptReason: input.missingReceiptReason,
      createdByUserId: ctx.userId,
      vendorCounterpartyId: input.vendorCounterpartyId,
      // An upload draft is created before OCR. Persisting a REVIEWER/NONE source here would make
      // the later OCR result incorrectly lose to a reviewer decision that never happened.
      ...(input.vatSource !== undefined && { vatCaptureSnapshotJson: vat.snapshot }),
      ...(input.whtInput !== undefined && { whtInputJson: { ...input.whtInput, origin: 'REVIEWER' as const } }),
      ...totals,
      outstandingAmount: totals.netPayableAmount,
    });

    if (lines.length > 0) {
      const prepared = lines.map((l, i) => {
        const reconciled = vat.lines[i]!;
        const t = reconciled.totals;
        return {
          expenseId: record.id, companyId: ctx.companyId, lineNumber: l.lineNumber,
          description: l.description, quantity: l.quantity, unitPrice: l.unitPrice,
          discountAmount: t.discountAmount, taxableAmount: t.taxableAmount,
          vatRate: reconciled.vatRate, vatTreatment: l.vatTreatment ?? null, vatAmount: t.vatAmount,
          whtRate: expenseWhtLineRate(input.whtInput, l.whtRate), whtAmount: t.whtAmount,
          lineSubtotalAmount: t.lineSubtotalAmount, lineTotalAmount: t.lineTotalAmount,
          expenseCategoryId: l.expenseCategoryId ?? null, accountHintKey: l.accountHintKey ?? null, taxCategory: l.taxCategory ?? null,
          ...taxSelection(l),
        };
      });
      try {
        const resolved = await this.transactionTax.resolveLines(ctx, {
          expenseId: record.id, branchId: branchId ?? undefined, expenseDate: input.expenseDate, currency: input.currency ?? 'THB',
        }, prepared);
        await this.repo.upsertLines(ctx.companyId, record.id, resolved);
      } catch (error) {
        await this.repo.deleteDraftExpense(ctx.companyId, record.id);
        throw error;
      }
    }

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.create', targetType: 'expense_record', targetId: record.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { captureSource: input.captureSource, grandTotalAmount: totals.grandTotalAmount } });
    return record;
  }
}

@Injectable()
export class GetExpenseUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, expenseId: string): Promise<ExpenseRecordWithRelations> {
    const canRead = hasPerm(ctx, 'expense.read') || hasPerm(ctx, 'expense.review') || hasPerm(ctx, 'expense.confirm');
    const canReadOwn = hasPerm(ctx, 'expense.read_own');
    const canReadRelated = hasPerm(ctx, 'expense.read_related');
    const canReadCreated = hasPerm(ctx, 'expense.create');
    if (!canRead && !canReadOwn && !canReadRelated && !canReadCreated) throw new ForbiddenException('Missing permission to read expenses');
    const r = await this.repo.findByIdWithRelations(ctx.companyId, expenseId, undefined, ctx.scopes ?? {});
    if (!r) throw new NotFoundException(`Expense ${expenseId} not found`);
    assertBranchInScope(ctx, r.branchId);
    const canReadThisRelated = !canRead && canReadRelated
      && await this.repo.isUserRelatedToExpense(ctx.companyId, expenseId, ctx.userId, ctx.scopes ?? {});
    const canReadThisOwn = canReadOwn
      && (r.createdByUserId === ctx.userId || r.substituteReceiptEvidence?.payerUserId === ctx.userId);
    const canReadThisCreated = canReadCreated && r.createdByUserId === ctx.userId;
    if (!canRead && !canReadThisOwn && !canReadThisRelated && !canReadThisCreated) {
      throw new ForbiddenException('Access denied');
    }
    return r;
  }
}

@Injectable()
export class ListExpensesUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, filter: Omit<ListExpensesFilter, 'companyId'>): Promise<PaginatedExpenses> {
    const canRead = hasPerm(ctx, 'expense.read') || hasPerm(ctx, 'expense.review');
    const canReadOwn = hasPerm(ctx, 'expense.read_own');
    const canReadRelated = hasPerm(ctx, 'expense.read_related');
    if (!canRead && !canReadOwn && !canReadRelated) throw new ForbiddenException('Missing permission to read expenses');
    if (filter.branchId) assertBranchInScope(ctx, filter.branchId);
    const page = Number.isFinite(filter.page) ? Math.max(1, Math.floor(filter.page!)) : 1;
    const pageSize = Number.isFinite(filter.pageSize) ? Math.min(200, Math.max(1, Math.floor(filter.pageSize!))) : 20;
    const resolved: ListExpensesFilter = { ...filter, companyId: ctx.companyId, page, pageSize };
    if (!canRead && canReadOwn && !canReadRelated) resolved.createdByUserId = ctx.userId;
    return this.repo.listExpenses(resolved, ctx.scopes, !canRead && canReadRelated ? ctx.userId : undefined);
  }
}

@Injectable()
export class UpdateExpenseDraftUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService, private readonly transactionTax: ExpenseTransactionTaxService) {}

  /**
   * `options.db` lets a caller that already owns a transaction (LINE correction apply) run this
   *  whole update inside it — the repository writes then join that transaction instead of opening
   *  their own, which would deadlock on this method's own advisory lock and could not roll back
   *  together. `options.suppressGenericAudit` is for callers that write their own, richer audit
   *  row in the same transaction: the generic `expense.review.update` here is a post-commit
   *  `void` log, so leaving it on would emit a success row for a mutation that later rolled back.
   */
  async execute(
    ctx: RequestContext,
    expenseId: string,
    input: UpdateExpenseDraftInput,
    options: {
      db?: any;
      suppressGenericAudit?: boolean;
      requireExpectedUpdatedAt?: boolean;
      /** Internal-only authority for the originating LINE user to fill source facts on their own
       * LINE draft. HTTP callers cannot set this option; final/reviewer-only mutations stay closed. */
      lineDraftCollection?: {
        sourceChannelMetadataJson: Record<string, unknown>;
        aiVerificationSummaryJson: Record<string, unknown>;
        /** Exact next row revision, also embedded in the continuation in the same transaction. */
        nextUpdatedAt: Date;
      };
      /** Written in the same transaction as the LINE continuation CAS and replacement lines. */
      transactionalAudit?: AuditLogEntry;
    } = {},
  ): Promise<ExpenseRecord> {
    const r = await this.repo.findById(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException(`Expense ${expenseId} not found`);
    assertBranchInScope(ctx, r.branchId);
    if (input.branchId !== undefined) assertBranchInScope(ctx, input.branchId);

    const canReview = hasPerm(ctx, 'expense.review');
    const isOwner = r.createdByUserId === ctx.userId;
    const canCollectOwnLineDraft = Boolean(options.lineDraftCollection)
      && ctx.authProvider === 'line'
      && r.captureSource === 'LINE_UPLOAD'
      && r.status === 'DRAFT'
      && isOwner
      && (hasPerm(ctx, 'expense.receipt.line_upload') || hasPerm(ctx, 'expense.receipt.upload') || hasPerm(ctx, 'expense.create'));
    if (options.lineDraftCollection && !canCollectOwnLineDraft) {
      throw new ForbiddenException('LINE draft collection is limited to the originating user and chat-authorized expense capability.');
    }
    if (options.transactionalAudit && !canCollectOwnLineDraft) {
      throw new ForbiddenException('Transactional LINE draft audit requires LINE draft collection authority.');
    }
    if (!canReview && !(hasPerm(ctx, 'expense.update') && isOwner) && !canCollectOwnLineDraft) {
      throw new ForbiddenException('Missing permission: expense.update');
    }
    if (canCollectOwnLineDraft) {
      const allowed = new Set<keyof UpdateExpenseDraftInput>([
        'expectedUpdatedAt', 'expenseDate', 'vendorNameSnapshot', 'note', 'lines',
      ]);
      const forbidden = (Object.keys(input) as Array<keyof UpdateExpenseDraftInput>).find((field) => !allowed.has(field));
      if (forbidden) throw new ForbiddenException(`LINE draft collection cannot update ${String(forbidden)}.`);
    }
    const financeOnlyFields: Array<keyof UpdateExpenseDraftInput> = [
      'sourceDocumentType', 'sourceDocumentLanguage', 'taxEvidenceStatus', 'taxEvidenceReasonCode',
      'expenseCategoryId', 'accountHintKey', 'taxCategory', 'nonExpenseClassificationOverride',
    ];
    if (!canReview && !canCollectOwnLineDraft && financeOnlyFields.some((field) => input[field] !== undefined)) {
      throw new ForbiddenException('Missing permission: expense.review for document, tax, or accounting classification fields.');
    }
    if (!['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(r.status)) {
      throw new BadRequestException(`Cannot update expense in status ${r.status}`);
    }
    if (options.requireExpectedUpdatedAt && !input.expectedUpdatedAt) {
      throw new BadRequestException({
        code: 'EXPENSE_UPDATE_VERSION_REQUIRED',
        message: 'expectedUpdatedAt is required. Reload the expense before saving.',
      });
    }
    const expectedUpdatedAt = input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt) : undefined;
    if (expectedUpdatedAt && Number.isNaN(expectedUpdatedAt.getTime())) {
      throw new BadRequestException({ code: 'EXPENSE_UPDATE_VERSION_INVALID', message: 'expectedUpdatedAt must be a valid timestamp.' });
    }

    const lines = input.lines;
    const whtInputError = validateExpenseWhtInput(input.whtInput);
    if (whtInputError) throw new BadRequestException(whtInputError);
    const whtInput = input.whtInput ?? r.whtInputJson;
    let resolvedLines: ExpenseLineInput[] | undefined;
    const nextSourceDocumentType = input.sourceDocumentType ?? r.sourceDocumentType;
    const nextTaxEvidenceStatus = input.taxEvidenceStatus ?? r.taxEvidenceStatus;
    const disallowsTaxCode = isReceiptOrSupportingOnly(nextSourceDocumentType, nextTaxEvidenceStatus);
    if (disallowsTaxCode && input.inputVatClaimStatus === 'CLAIMABLE') {
      throw new BadRequestException('A receipt, substitute receipt, or supporting-only document cannot claim input VAT.');
    }
    if (disallowsTaxCode && lines?.some((line) => hasSelectedTaxCode(taxSelection(line)))) {
      throw new BadRequestException('A receipt, substitute receipt, or supporting-only document cannot retain a Tax Code.');
    }
    let totals: ReturnType<typeof reconcileExpenseVat>['totals'] | undefined;
    let vatCaptureSnapshotJson: ReturnType<typeof reconcileExpenseVat>['snapshot'] | undefined;
    if (lines) {
      // Spec §19c: VAT mode describes the document arithmetic; claimability is the separate axis below.
      const vatMode = input.vatMode ?? r.vatMode;
      const amountError = validateExpenseDraftAmounts({ vatMode, lines });
      if (amountError) throw new BadRequestException(amountError);
      const source = input.vatSource ?? vatSourceFromSnapshot(r.vatCaptureSnapshotJson);
      const vatSourceError = validateExpenseVatSourceInput(source, vatMode, lines.map((line) => line.lineNumber));
      if (vatSourceError) throw new BadRequestException(vatSourceError);
      const vat = reconcileExpenseVat({
        vatMode,
        lines,
        source,
        sourceOrigin: input.vatSource ? 'REVIEWER' : r.vatCaptureSnapshotJson?.source.origin ?? 'REVIEWER',
        sourceTaxableAmount: input.vatSource ? null : r.vatCaptureSnapshotJson?.source.taxableAmount,
        sourceGrossAmount: input.vatSource ? null : r.vatCaptureSnapshotJson?.source.grossAmount,
        sourceEvidenceRefs: input.vatSource ? undefined : r.vatCaptureSnapshotJson?.source.evidenceRefs,
        capturedAt: input.vatSource ? undefined : r.vatCaptureSnapshotJson?.source.capturedAt,
      });
      const whtAmountError = applyExpenseWhtInput(vat, whtInput);
      if (whtAmountError) throw new BadRequestException(whtAmountError);
      const vatTreatmentError = validateExpenseLineVatTreatments(lines.map((line, index) => ({ ...line, vatRate: vat.lines[index]!.vatRate })));
      if (vatTreatmentError) throw new BadRequestException(vatTreatmentError);
      totals = vat.totals;
      vatCaptureSnapshotJson = vat.snapshot;
      const prepared = lines.map((l, i) => {
        const reconciled = vat.lines[i]!;
        const t = reconciled.totals;
        return {
          expenseId, companyId: ctx.companyId, lineNumber: l.lineNumber, description: l.description,
          quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: t.discountAmount,
          taxableAmount: t.taxableAmount, vatRate: reconciled.vatRate, vatTreatment: l.vatTreatment ?? null, vatAmount: t.vatAmount,
          whtRate: expenseWhtLineRate(whtInput, l.whtRate), whtAmount: t.whtAmount, lineSubtotalAmount: t.lineSubtotalAmount,
          lineTotalAmount: t.lineTotalAmount, expenseCategoryId: l.expenseCategoryId ?? null,
          accountHintKey: l.accountHintKey ?? null, taxCategory: l.taxCategory ?? null,
          ...taxSelection(l),
        };
      });
      resolvedLines = await this.transactionTax.resolveLines(ctx, {
        expenseId, branchId: input.branchId ?? r.branchId ?? undefined,
        expenseDate: input.expenseDate ?? r.expenseDate.toISOString(), currency: r.currency,
      }, prepared, 'DRAFT', options.db);
    } else if (input.vatSource !== undefined || input.whtInput !== undefined
      || (whtInput && input.vatMode !== undefined && input.vatMode !== r.vatMode)) {
      throw new BadRequestException('lines are required when updating vatSource or whtInput.');
    }

    const reviewedAt = canReview ? new Date() : undefined;
    const reviewedByUserId = canReview ? ctx.userId : undefined;
    const classificationOverrideRequest = input.nonExpenseClassificationOverride;
    if (classificationOverrideRequest && !canReview) {
      throw new ForbiddenException('Missing permission: expense.review for non-expense classification override');
    }
    if (classificationOverrideRequest && !hasBlockingNonExpenseClassification(r.aiVerificationSummaryJson)) {
      throw new BadRequestException('No unresolved non-expense classification to override.');
    }
    const overrideSourceDocumentType = classificationOverrideRequest
      ? toSourceDocumentType(input.sourceDocumentType)
      : input.sourceDocumentType ?? r.sourceDocumentType;
    if (classificationOverrideRequest && overrideSourceDocumentType === 'NEEDS_REVIEW') {
      throw new BadRequestException('Select a reviewed expense source document type before overriding the classification.');
    }
    const classificationOverrideReason = typeof classificationOverrideRequest?.reason === 'string'
      ? classificationOverrideRequest.reason.trim()
      : '';
    if (classificationOverrideRequest && classificationOverrideRequest.acknowledged !== true) {
      throw new BadRequestException('Classification override acknowledgement is required.');
    }
    if (classificationOverrideRequest && (!classificationOverrideReason || classificationOverrideReason.length > 500)) {
      throw new BadRequestException('Classification override reason is required and must not exceed 500 characters.');
    }
    const classificationOverride = classificationOverrideRequest !== undefined;
    const classification = r.aiVerificationSummaryJson?.['classification'];
    const detectedDocumentKind = classification && typeof classification === 'object'
      && typeof (classification as Record<string, unknown>)['documentKind'] === 'string'
      ? (classification as Record<string, unknown>)['documentKind']
      : null;
    if (classificationOverride && !detectedDocumentKind) {
      throw new BadRequestException('Re-run document classification before overriding this expense.');
    }
    // Finance accepting a total that disagrees with the receipt OCR read. Bound to the accepted
    // figure so a later amount edit re-arms the confirm gate; validated against the total this very
    // patch leaves behind, not the one it started with.
    const ocrAcknowledgement = input.ocrTotalAcknowledgement;
    const acknowledgedGrandTotal = totals?.grandTotalAmount ?? r.grandTotalAmount;
    if (ocrAcknowledgement && !canReview) {
      throw new ForbiddenException('Missing permission: expense.review for OCR total acknowledgement');
    }
    if (ocrAcknowledgement && ocrAcknowledgement.acknowledged !== true) {
      throw new BadRequestException('OCR total acknowledgement is required.');
    }
    if (ocrAcknowledgement && !hasAiGrandTotalMismatch(r.aiVerifiedFieldsJson, acknowledgedGrandTotal)) {
      throw new BadRequestException('No OCR grand total difference to acknowledge.');
    }
    const ocrAcknowledgementReason = typeof ocrAcknowledgement?.reason === 'string' ? ocrAcknowledgement.reason.trim() : '';
    if (ocrAcknowledgement && (!ocrAcknowledgementReason || ocrAcknowledgementReason.length > 500)) {
      throw new BadRequestException('OCR total acknowledgement reason is required and must not exceed 500 characters.');
    }
    if (ocrAcknowledgement && !hasAcknowledgedAiTotalMismatch(
      { totalMismatchResolution: { acknowledged: true, acknowledgedTotalAmount: ocrAcknowledgement.acknowledgedTotalAmount } },
      acknowledgedGrandTotal,
    )) {
      throw new BadRequestException('The acknowledged amount no longer matches this expense. Reload and review the total again.');
    }
    if (disallowsTaxCode && !lines && (input.sourceDocumentType !== undefined || input.taxEvidenceStatus !== undefined)) {
      const existing = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
      if (existing?.lines.some(hasSelectedTaxCode)) {
        throw new BadRequestException('Remove the existing Tax Code lines before classifying this document as a receipt, substitute receipt, or supporting-only evidence.');
      }
    }

    // Extraction-time `missingFields` flags mean "a human must supply/confirm this value". A review
    // save that provides the value IS that confirmation, so the flag is cleared here — the guided
    // stepper and the per-field "AI อ่านไม่ได้" hints derive from these flags and would otherwise
    // nag forever. `receipt_evidence` is evidence-flow territory and is never cleared by this update.
    const priorMissingFields = Array.isArray(r.aiVerificationSummaryJson?.['missingFields'])
      ? r.aiVerificationSummaryJson['missingFields'].filter((field): field is string => typeof field === 'string')
      : [];
    const resolvedMissingFields = new Set<string>();
    if (input.vendorNameSnapshot?.trim()) { resolvedMissingFields.add('vendor'); resolvedMissingFields.add('vendorName'); }
    if (input.vendorTaxIdSnapshot?.trim()) resolvedMissingFields.add('vendorTaxId');
    if (input.vendorDocumentNumber?.trim()) resolvedMissingFields.add('documentNumber');
    if (input.expenseDate) resolvedMissingFields.add('expenseDate');
    if (totals) {
      resolvedMissingFields.add('vatAmount');
      if (Number(totals.grandTotalAmount) > 0) { resolvedMissingFields.add('grandTotalAmount'); resolvedMissingFields.add('amount'); }
    }
    if (lines?.some((line) => line.expenseCategoryId) || input.expenseCategoryId) resolvedMissingFields.add('category');
    const nextMissingFields = priorMissingFields.filter((field) => !resolvedMissingFields.has(field));

    let nextSummaryJson: Record<string, unknown> | undefined;
    if (classificationOverride) {
      nextSummaryJson = {
        ...r.aiVerificationSummaryJson,
        status: 'NOT_EXPENSE_DOCUMENT',
        classificationResolution: {
          outcome: 'FINANCE_OVERRIDDEN_AS_EXPENSE',
          acknowledged: true,
          resolvedByUserId: ctx.userId,
          resolvedAt: reviewedAt?.toISOString() ?? new Date().toISOString(),
          sourceDocumentType: overrideSourceDocumentType,
          reason: classificationOverrideReason,
        },
      };
    }
    if (ocrAcknowledgement) {
      nextSummaryJson = {
        ...(nextSummaryJson ?? r.aiVerificationSummaryJson),
        totalMismatchResolution: {
          acknowledged: true,
          acknowledgedTotalAmount: acknowledgedGrandTotal,
          resolvedByUserId: ctx.userId,
          resolvedAt: reviewedAt?.toISOString() ?? new Date().toISOString(),
          reason: ocrAcknowledgementReason,
        },
      };
    }
    if (nextMissingFields.length !== priorMissingFields.length) {
      nextSummaryJson = { ...(nextSummaryJson ?? r.aiVerificationSummaryJson), missingFields: nextMissingFields };
    }

    const updated = await this.repo.updateExpense({
      id: expenseId, companyId: ctx.companyId, updatedByUserId: ctx.userId,
      ...(expectedUpdatedAt && { expectedUpdatedAt }),
      ...(input.branchId !== undefined && { branchId: input.branchId }),
      ...(input.expenseDate && { expenseDate: civilDateToUtcDate(coerceCivilDate(input.expenseDate)) }),
      ...(input.vatMode && { vatMode: input.vatMode }),
      ...((disallowsTaxCode || input.inputVatClaimStatus) && { inputVatClaimStatus: disallowsTaxCode ? 'NON_CLAIMABLE' : input.inputVatClaimStatus }),
      ...(input.vendorCounterpartyId !== undefined && { vendorCounterpartyId: input.vendorCounterpartyId }),
      ...(input.vendorNameSnapshot !== undefined && { vendorNameSnapshot: input.vendorNameSnapshot }),
      ...(input.vendorTaxIdSnapshot !== undefined && { vendorTaxIdSnapshot: input.vendorTaxIdSnapshot }),
      ...(input.vendorBranchCodeSnapshot !== undefined && { vendorBranchCodeSnapshot: input.vendorBranchCodeSnapshot }),
      ...(input.vendorEntityKindSnapshot !== undefined && { vendorEntityKindSnapshot: input.vendorEntityKindSnapshot }),
      ...(input.vendorDocumentNumber !== undefined && { vendorDocumentNumber: input.vendorDocumentNumber }),
      ...(input.note !== undefined && { note: input.note }),
      // The substitute-receipt panel saves its in-progress reason here so leaving the review page no
      // longer discards it; blank clears the field, taking the expense back off the substitute path.
      ...(input.missingReceiptReason !== undefined && { missingReceiptReason: input.missingReceiptReason.trim() || null }),
      // Same dropped-field class: the contract has always accepted these three and the columns feed
      // live readers (the overdue KPI reads dueDate, the evidence pack reports internalMemo as
      // `notes`), so a create-only write path left them permanently null. Blank clears the dates
      // rather than persisting an Invalid Date.
      ...(input.receivedAt !== undefined && { receivedAt: input.receivedAt.trim() ? new Date(input.receivedAt) : null }),
      ...(input.dueDate !== undefined && { dueDate: input.dueDate.trim() ? new Date(input.dueDate) : null }),
      ...(input.internalMemo !== undefined && { internalMemo: input.internalMemo }),
      ...(input.expenseCategoryId !== undefined && { expenseCategoryId: input.expenseCategoryId }),
      ...(input.accountHintKey !== undefined && { accountHintKey: input.accountHintKey }),
      ...(input.taxCategory !== undefined && { taxCategory: input.taxCategory }),
      ...(input.sourceDocumentType !== undefined && { sourceDocumentType: input.sourceDocumentType }),
      ...(input.sourceDocumentLanguage !== undefined && { sourceDocumentLanguage: input.sourceDocumentLanguage }),
      ...(input.taxEvidenceStatus !== undefined && { taxEvidenceStatus: input.taxEvidenceStatus, ...(input.taxEvidenceReasonCode === undefined && canReview ? { taxEvidenceReasonCode: 'MANUAL_OVERRIDE' } : {}) }),
      ...(input.taxEvidenceReasonCode !== undefined && { taxEvidenceReasonCode: input.taxEvidenceReasonCode }),
      ...(nextSummaryJson && { aiVerificationSummaryJson: nextSummaryJson }),
      ...(vatCaptureSnapshotJson && { vatCaptureSnapshotJson }),
      ...(input.whtInput !== undefined && { whtInputJson: { ...input.whtInput, origin: 'REVIEWER' as const } }),
      ...(options.lineDraftCollection && {
        sourceChannelMetadataJson: options.lineDraftCollection.sourceChannelMetadataJson,
        aiVerificationSummaryJson: options.lineDraftCollection.aiVerificationSummaryJson,
        updatedAt: options.lineDraftCollection.nextUpdatedAt,
      }),
      ...(reviewedByUserId && { reviewedByUserId, reviewedAt }),
      ...(totals ?? {}),
      ...(totals ? { outstandingAmount: totals.netPayableAmount } : {}),
    }, resolvedLines || options.transactionalAudit
      ? async (tx) => {
        if (resolvedLines) await this.repo.upsertLines(ctx.companyId, expenseId, resolvedLines, tx);
        if (options.transactionalAudit) await this.audit.log(options.transactionalAudit, tx);
      }
      : undefined, options.db);
    if (options.suppressGenericAudit) return updated;
    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: classificationOverride ? 'expense.classification.override' : 'expense.review.update',
      targetType: 'expense_record',
      targetId: expenseId,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: classificationOverride ? 'HIGH' : 'MEDIUM',
      ...((classificationOverride || input.vatSource || input.whtInput) && {
        metadataJson: {
          ...(input.whtInput && {
            whtInput: { before: r.whtInputJson ?? null, after: { ...input.whtInput, origin: 'REVIEWER' } },
          }),
          ...(input.vatSource && {
            vatSource: {
              before: r.vatCaptureSnapshotJson ? {
                origin: r.vatCaptureSnapshotJson.source.origin,
                inputType: r.vatCaptureSnapshotJson.source.inputType,
                vatRatePercent: r.vatCaptureSnapshotJson.source.vatRatePercent,
                vatAmount: r.vatCaptureSnapshotJson.source.vatAmount,
                lineSourceCount: r.vatCaptureSnapshotJson.source.lineSources?.length ?? 0,
                reconciliationStatus: r.vatCaptureSnapshotJson.reconciliation.status,
              } : null,
              after: vatCaptureSnapshotJson ? {
                origin: vatCaptureSnapshotJson.source.origin,
                inputType: vatCaptureSnapshotJson.source.inputType,
                vatRatePercent: vatCaptureSnapshotJson.source.vatRatePercent,
                vatAmount: vatCaptureSnapshotJson.source.vatAmount,
                lineSourceCount: vatCaptureSnapshotJson.source.lineSources?.length ?? 0,
                reconciliationStatus: vatCaptureSnapshotJson.reconciliation.status,
              } : null,
            },
          }),
          ...(classificationOverride && {
            classificationOverride: {
              detectedDocumentKind,
              sourceDocumentType: overrideSourceDocumentType,
              reason: classificationOverrideReason,
            },
          }),
        },
      }),
    });
    return updated;
  }
}

@Injectable()
export class ConfirmExpenseUseCase {
  private readonly logger = new Logger(ConfirmExpenseUseCase.name);

  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly audit: AuditService,
    private readonly transactionTax: ExpenseTransactionTaxService,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
    private readonly cancelNumber: CancelDocumentNumberUseCase,
    private readonly vatRegistration: CompanyVatRegistrationUseCase,
  ) {}

  async execute(
    ctx: RequestContext,
    expenseId: string,
    vatSourceOverride?: ExpenseVatSourceOverrideInput,
  ): Promise<ExpenseRecord> {
    return this.confirm(ctx, expenseId, undefined, vatSourceOverride);
  }

  /**
   * Reimbursement owns this authority; it is not an `expense.*` permission and
   * is valid only for the exact tenant/request/line projection named here.
   * The normal expense validation, tax/period locks, numbering and transactional
   * outbox remain unchanged.
   */
  async executeForReimbursement(
    ctx: RequestContext,
    expenseId: string,
    authority: {
      reimbursementRequestId: string;
      reimbursementLineId: string;
      branchId?: string;
      allowMissingReceiptWithReason: boolean;
      systemReconcile?: boolean;
    },
  ): Promise<ExpenseRecord> {
    return this.confirm(ctx, expenseId, authority);
  }

  private async confirm(
    ctx: RequestContext,
    expenseId: string,
    authority?: {
      reimbursementRequestId: string;
      reimbursementLineId: string;
      branchId?: string;
      allowMissingReceiptWithReason: boolean;
      systemReconcile?: boolean;
    },
    vatSourceOverride?: ExpenseVatSourceOverrideInput,
  ): Promise<ExpenseRecord> {
    return observeCustomerJourney(
      this.audit,
      {
        key: 'expense-confirmation', requestId: ctx.requestId ?? `expense:${expenseId}:confirm`,
        targetType: 'expense_record', targetId: expenseId, companyId: ctx.companyId, actorUserId: ctx.userId,
      },
      () => this.confirmMutation(ctx, expenseId, authority, vatSourceOverride),
      () => ({ outcome: 'confirmed' }),
    );
  }

  private async confirmMutation(
    ctx: RequestContext,
    expenseId: string,
    authority?: {
      reimbursementRequestId: string;
      reimbursementLineId: string;
      branchId?: string;
      allowMissingReceiptWithReason: boolean;
      systemReconcile?: boolean;
    },
    vatSourceOverride?: ExpenseVatSourceOverrideInput,
  ): Promise<ExpenseRecord> {
    if (!authority) {
      requirePerm(ctx, 'expense.confirm', 'confirm expense');
      if (ctx.authProvider === 'line') throw new ForbiddenException('Expense confirmation is available on the authenticated web only.');
    }
    const r = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException(`Expense ${expenseId} not found`);
    if (authority) {
      if (r.sourceReimbursementRequestId !== authority.reimbursementRequestId
        || r.sourceReimbursementLineId !== authority.reimbursementLineId
        || (r.branchId ?? undefined) !== authority.branchId) {
        throw new ForbiddenException('reimbursement_projection_authority_mismatch');
      }
      if (!authority.systemReconcile) assertBranchInScope(ctx, r.branchId);
      if (r.status === 'CONFIRMED') return r;
    } else {
      assertBranchInScope(ctx, r.branchId);
    }
    requireExpenseBranchId(r.branchId);
    if (hasBlockingNonExpenseClassification(r.aiVerificationSummaryJson)) {
      throw new BadRequestException(NON_EXPENSE_CLASSIFICATION_REVIEW_REQUIRED);
    }
    // Plan 13.11.B: a real mismatch still blocks, but it now says which line to open. Over tolerance
    // the only way through is the named reviewer decision "ใช้ยอดตามเอกสาร" — `expense.review`, a
    // written reason and the VAT line that carries the difference. The CAS transaction applies
    // accepted amounts and writes the audit together; captured/calculated evidence stays intact.
    const snapshot = r.vatCaptureSnapshotJson;
    if (vatSourceOverride && !isBlockingExpenseVatReconciliation(snapshot)) {
      throw new BadRequestException({ code: 'EXPENSE_VAT_OVERRIDE_INVALID', message: 'Review the current VAT source before accepting a difference.' });
    }
    if (snapshot && isBlockingExpenseVatReconciliation(snapshot)) {
      if (!vatSourceOverride) {
        throw new BadRequestException({
          code: 'EXPENSE_VAT_RECONCILIATION_REQUIRED',
          message: expenseVatReconciliationMessage(snapshot),
          reconciliationStatus: snapshot.reconciliation.status,
          documentVatAmount: snapshot.source.vatAmount,
          calculatedVatAmount: snapshot.calculation.vatAmount,
          differenceAmount: snapshot.reconciliation.differenceAmount,
          attentionLines: (snapshot.reconciliation.attentionLineNumbers ?? []).map((lineNumber) => ({
            lineNumber,
            description: (r.lines ?? []).find((line) => line.lineNumber === lineNumber)?.description ?? null,
          })),
        });
      }
      // Owner decision 2026-08-28: the named way through is no longer a second permission. Gating it
      // on `expense.review` on top of the `expense.confirm` this method already required meant that
      // whoever could not review had NO path at all — the save was refused, the override button was
      // not rendered for them, and the receipt simply could not be filed. Blocking someone from
      // recording a real expense is a worse outcome than an accepted difference, which is still
      // deliberate here: it needs a written reason, the VAT line that carries it, a fresh
      // expectedUpdatedAt, and it lands in the audit trail with the decider's name.
      if (typeof vatSourceOverride.expectedUpdatedAt !== 'string'
        || new Date(vatSourceOverride.expectedUpdatedAt).getTime() !== r.updatedAt.getTime()) {
        throw new ConflictException({ code: 'EXPENSE_VAT_OVERRIDE_STALE', message: 'Reload and review the current VAT amounts before accepting them.' });
      }
      const reason = typeof vatSourceOverride.reason === 'string' ? vatSourceOverride.reason.trim() : '';
      const carrier = (r.lines ?? []).find((line) => line.lineNumber === vatSourceOverride.vatLineNumber);
      // The difference has to land on a line that actually bears VAT — never on ผัก/ผลไม้.
      if (!reason || !carrier || !(Number(carrier.vatRate ?? 0) > 0)) {
        throw new BadRequestException({
          code: 'EXPENSE_VAT_OVERRIDE_INVALID',
          message: 'ใช้ยอดตามเอกสาร requires a written reason and a VAT-bearing line to carry the difference.',
        });
      }
    }
    const reliesOnSubstitute = Boolean(r.missingReceiptReason || r.substituteReceiptGeneratedAt || r.sourceDocumentType === 'SUBSTITUTE_RECEIPT');
    // A claim-born projection carries the CLAIM's missing-receipt reason, and its legal instrument
    // is the signed ใบเบิกค่าใช้จ่าย — that is what `allowMissingReceiptWithReason` on the authority
    // means. Demanding an expense-side substitute receipt here dead-ends the claim: this confirm
    // runs inside the finance-review projection, where no substitute artifact can be issued. An
    // expense that actually entered the substitute-receipt flow still needs its artifact.
    const reasonCoveredByClaimForm = Boolean(authority?.allowMissingReceiptWithReason)
      && !r.substituteReceiptGeneratedAt && r.sourceDocumentType !== 'SUBSTITUTE_RECEIPT';
    if (reliesOnSubstitute && !reasonCoveredByClaimForm
      && (r.substituteReceiptEvidence?.status !== 'ISSUED' || !r.substituteReceiptEvidence.artifactAttachmentId)) {
      throw new BadRequestException('A current issued ใบรับรองแทนใบเสร็จรับเงิน artifact is required; a text reason or legacy timestamp is not sufficient.');
    }
    if (r.substituteReceiptEvidence?.status === 'ISSUED'
      && (r.taxEvidenceStatus !== 'SUPPORTING_ONLY' || r.inputVatClaimStatus !== 'NON_CLAIMABLE')) {
      throw new BadRequestException('Internal substitute evidence must remain supporting-only and non-claimable for input VAT.');
    }

    const validationErr = validateConfirm({
      status: r.status,
      duplicateStatus: r.duplicateStatus,
      primaryAttachmentId: r.primaryAttachmentId,
      missingReceiptReason: r.missingReceiptReason,
      vendorNameSnapshot: r.vendorNameSnapshot,
      vendorDocumentNumber: r.vendorDocumentNumber,
      expenseDate: r.expenseDate?.toISOString() ?? null,
      grandTotalAmount: r.grandTotalAmount,
      whtAmount: r.whtAmount,
      vendorEntityKindSnapshot: r.vendorEntityKindSnapshot,
      vatMode: r.vatMode,
      inputVatClaimStatus: r.inputVatClaimStatus,
      hasMissingReceiptPermission: authority?.allowMissingReceiptWithReason ?? hasPerm(ctx, 'expense.review'),
      aiVerifiedFieldsJson: r.aiVerifiedFieldsJson,
      aiVerificationSummaryJson: r.aiVerificationSummaryJson,
    });
    if (validationErr) throw new BadRequestException(validationErr);

    const taxEvidenceErr = validateDomesticInputVatEvidence({
      sourceDocumentType: r.sourceDocumentType,
      taxEvidenceStatus: r.taxEvidenceStatus,
      inputVatClaimStatus: r.inputVatClaimStatus,
      primaryAttachmentId: r.primaryAttachmentId,
      vendorTaxIdSnapshot: r.vendorTaxIdSnapshot,
      vendorDocumentNumber: r.vendorDocumentNumber,
      lines: r.lines ?? [],
      // Read on the expense's own date: a company registered mid-year could not claim on a
      // document dated before it registered. `validateConfirm` above already required the date.
      // Only asked for when a claim is actually at stake, so the ordinary path adds no query.
      ...(r.inputVatClaimStatus === 'CLAIMABLE' && r.expenseDate && {
        vatStatus: (await this.vatRegistration.get(ctx.companyId, utcDateToCivilDate(r.expenseDate))).status,
      }),
    });
    if (taxEvidenceErr) throw new BadRequestException(taxEvidenceErr);

    if (hasMissingClaimableVatTaxSnapshot(r.inputVatClaimStatus, r.lines ?? [])) {
      throw new BadRequestException('Every VAT-bearing expense line requires a server-resolved Tax Code snapshot before confirmation.');
    }

    // Plan 13.11.B: "ยังไม่แน่ใจ" saves as a draft but never confirms, and the block names the line
    // instead of the rule — an override cannot buy past it, because guessing 0% or 7% is forbidden.
    const unknownRateLineNumber = firstUnknownVatRateLineNumber(r.vatMode, r.lines ?? []);
    if (unknownRateLineNumber !== null) {
      throw new BadRequestException(`The VAT mode says VAT applies but line ${unknownRateLineNumber} has no VAT rate. Enter the printed rate or VAT amount before confirmation.`);
    }

    const postingStatus = derivePostingStatus('CONFIRMED', r.duplicateStatus);
    const vendorSnapshotJson = r.vendorCounterpartyId ? { id: r.vendorCounterpartyId, name: r.vendorNameSnapshot, taxId: r.vendorTaxIdSnapshot } : null;
    const occurredAt = new Date().toISOString();
    const eventRequestId = authority
      ? `reimbursement:${authority.reimbursementRequestId}:${authority.reimbursementLineId}`
      : ctx.requestId ?? buildIdempotencyKey(expenseId, 'confirmed');
    const reserved = await this.reserveNumber.execute({
      companyId: ctx.companyId,
      documentType: 'expense.record',
      periodKey: occurredAt.slice(0, 7),
      idempotencyKey: `confirm:${expenseId}:${eventRequestId}`,
      reservedByUserId: ctx.userId,
    });
    let updated: ExpenseRecord;
    let finalized: ExpenseLineInput[];
    try {
      ({ expense: updated, finalized } = await this.repo.finalizeAndConfirmExpenseCas({
        id: expenseId, companyId: ctx.companyId, expectedUpdatedAt: r.updatedAt, actorUserId: ctx.userId,
        expectedSourceChecksum: expenseTaxSourceChecksum(r),
        substituteCoveredByClaimForm: reasonCoveredByClaimForm,
        vatSourceOverride,
        postingStatus, vendorSnapshotJson, expenseNumber: reserved.documentNumber,
        outboxEvent: {
          eventKey: `expense.confirmed:expense_record:${expenseId}:${eventRequestId}`,
          payloadJson: {
            companyId: ctx.companyId, aggregateType: 'expense_record', aggregateId: expenseId,
            requestId: eventRequestId, occurredAt, data: { expenseId, expenseNumber: reserved.documentNumber, postingStatus },
          },
        },
      }, async ({ db, expense: current }) => {
        const selectedLines = (current.lines ?? []).filter(hasSelectedTaxCode).map((line) => ({
          expenseId: current.id, companyId: ctx.companyId, lineNumber: line.lineNumber, sourceLineId: line.id,
          description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
          discountAmount: line.discountAmount, taxableAmount: line.taxableAmount,
          vatRate: line.vatRate, vatTreatment: line.vatTreatment ?? null, vatAmount: line.vatAmount, whtRate: line.whtRate, whtAmount: line.whtAmount,
          lineSubtotalAmount: line.lineSubtotalAmount, lineTotalAmount: line.lineTotalAmount,
          expenseCategoryId: line.expenseCategoryId, accountHintKey: line.accountHintKey, taxCategory: line.taxCategory,
          taxCodeDefinitionId: line.taxSnapshot?.taxCodeDefinitionId ?? undefined,
          externalTaxCode: line.taxSnapshot?.externalTaxCode ?? undefined,
          transactionContext: line.taxSnapshot?.taxContext ?? undefined,
        }));
        const lines = selectedLines.length ? await this.transactionTax.resolveLines(ctx, {
          expenseId: current.id, branchId: current.branchId ?? undefined,
          expenseDate: current.expenseDate.toISOString(), currency: current.currency,
          preserveAcceptedVat: current.vatCaptureSnapshotJson?.reconciliation.acceptedSource === 'SOURCE_AMOUNT',
        }, selectedLines, 'FINAL', db) : [];
        if (vatSourceOverride && snapshot) {
          await this.audit.log({
            companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.vat.source_override',
            targetType: 'expense_record', targetId: expenseId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
            metadataJson: {
              reason: vatSourceOverride.reason.trim(), vatLineNumber: vatSourceOverride.vatLineNumber,
              reconciliationStatus: snapshot.reconciliation.status,
              documentVatAmount: snapshot.source.vatAmount, calculatedVatAmount: snapshot.calculation.vatAmount,
              differenceAmount: snapshot.reconciliation.differenceAmount, toleranceAmount: snapshot.reconciliation.toleranceAmount,
              acceptedVatAmount: current.vatAmount, acceptedPreVatAmount: current.taxableAmount,
              acceptedGrossAmount: current.grandTotalAmount, acceptedWhtAmount: current.whtAmount,
              acceptedNetPayableAmount: current.netPayableAmount,
            },
          }, db);
        }
        return lines;
      }));
      await this.commitNumber.execute({
        id: reserved.id, companyId: ctx.companyId, ownerType: 'expense_record', ownerId: expenseId,
      }, ctx.userId);
    } catch (cause) {
      // The reservation is still RESERVED here (commit happens only after a
      // successful finalize), so it must be cancelled — voidNumber accepts
      // COMMITTED numbers only and would mask the real error.
      await this.cancelNumber.execute({ id: reserved.id, companyId: ctx.companyId }, ctx.userId);
      throw cause;
    }

    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'expense.confirm',
      targetType: 'expense_record',
      targetId: expenseId,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: {
        expenseNumber: updated.expenseNumber,
        grandTotalAmount: updated.grandTotalAmount,
        ...(authority && {
          authority: 'REIMBURSEMENT_APPROVAL',
          reimbursementRequestId: authority.reimbursementRequestId,
          reimbursementLineId: authority.reimbursementLineId,
          systemReconcile: Boolean(authority.systemReconcile),
        }),
      },
    });
    // Spec S1-R5: the reviewer confirmed a category that is not the AI's. `fromSuggested` says
    // whether AI had a usable suggestion at all, so override rate = these events with
    // `fromSuggested: true` over `expense_category_suggested`. Ids and booleans only — no category
    // names, no document content. A reimbursement projection is excluded: its category came from
    // the claim form, not from a reviewer looking at an AI suggestion, and counting it would
    // inflate the "no suggestion" side of the rate.
    if (!authority && r.expenseCategoryId) {
      const suggestion = readAiCategorySuggestion(r.aiVerificationSummaryJson);
      if (r.expenseCategoryId !== suggestion?.expenseCategoryId) {
        this.logger.log({
          msg: 'expense_category_overridden',
          companyId: ctx.companyId,
          expenseId,
          surface: 'web',
          fromSuggested: Boolean(suggestion),
        });
      }
    }
    const finalizedTaxLines = finalized.filter(hasSelectedTaxCode);
    if (finalizedTaxLines.length > 0) {
      void this.audit.log({
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: 'tax.document_tax.finalize',
        targetType: 'expense_record',
        targetId: expenseId,
        requestId: ctx.requestId,
        result: 'SUCCESS',
        riskLevel: 'HIGH',
        metadataJson: {
          sourceType: 'expense.record',
          sourceId: expenseId,
          sourceDocumentType: r.sourceDocumentType,
          taxEvidenceStatus: r.taxEvidenceStatus,
          inputVatClaimStatus: r.inputVatClaimStatus,
          lines: finalizedTaxLines.map((line) => ({
            sourceLineId: line.sourceLineId,
            lineNumber: line.lineNumber,
            taxCodeDefinitionId: line.taxSnapshot?.taxCodeDefinitionId ?? null,
            externalTaxCode: line.taxSnapshot?.externalTaxCode ?? null,
            taxProfileKey: line.taxSnapshot?.taxProfileKey ?? null,
            taxProfileVersion: line.taxSnapshot?.taxProfileVersion ?? null,
            taxContext: line.taxSnapshot?.taxContext ?? null,
            taxTreatment: line.taxSnapshot?.taxTreatment ?? null,
            claimability: line.taxSnapshot?.claimability ?? null,
            evidenceStatus: line.taxSnapshot?.evidenceStatus ?? null,
            accountRuleVersion: line.taxSnapshot?.accountRuleVersion ?? null,
            reportRuleVersion: line.taxSnapshot?.reportRuleVersion ?? null,
          })),
        },
      });
    }
    return updated;
  }
}

function isReceiptOrSupportingOnly(sourceDocumentType: string, taxEvidenceStatus: string): boolean {
  return sourceDocumentType === 'RECEIPT'
    || sourceDocumentType === 'SUBSTITUTE_RECEIPT'
    // Spec §19h: named explicitly, not left to the SUPPORTING_ONLY clause. A reviewer may move
    // taxEvidenceStatus, and no status makes s.82/5 input VAT creditable on an abbreviated invoice.
    || sourceDocumentType === 'ABBREVIATED_TAX_INVOICE'
    || taxEvidenceStatus === 'SUPPORTING_ONLY';
}

function taxSelection(line: CreateExpenseDraftInput['lines'][number]): ExpenseTaxLineSelection {
  const selected = line as CreateExpenseDraftInput['lines'][number] & ExpenseTaxLineSelection;
  return {
    taxCodeDefinitionId: selected.taxCodeDefinitionId,
    externalTaxCode: selected.externalTaxCode,
    transactionContext: selected.transactionContext,
    evidenceRefs: selected.evidenceRefs,
    authoritativeCustomsValue: selected.authoritativeCustomsValue,
    authoritativeDutyAmount: selected.authoritativeDutyAmount,
    authoritativeExciseAmount: selected.authoritativeExciseAmount,
    authoritativeOtherTaxAmount: selected.authoritativeOtherTaxAmount,
    authoritativeImportVatAmount: selected.authoritativeImportVatAmount,
  };
}

@Injectable()
export class RejectExpenseUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, expenseId: string, reason: string): Promise<ExpenseRecord> {
    requirePerm(ctx, 'expense.reject', 'reject expense');
    const r = await this.repo.findById(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException(`Expense ${expenseId} not found`);
    assertBranchInScope(ctx, r.branchId);
    const err = validateStatusTransition(r.status, 'REJECTED');
    if (err) throw new BadRequestException(err);
    const updated = await this.repo.updateExpense({ id: expenseId, companyId: ctx.companyId, updatedByUserId: ctx.userId, status: 'REJECTED', rejectedByUserId: ctx.userId, rejectedAt: new Date(), rejectReason: reason, postingStatus: 'not_required' });
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.reject', targetType: 'expense_record', targetId: expenseId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH' });
    return updated;
  }
}

@Injectable()
export class VoidExpenseUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
    private readonly cancelNumber: CancelDocumentNumberUseCase,
  ) {}

  async execute(ctx: RequestContext, expenseId: string, reason: string): Promise<ExpenseRecord> {
    requirePerm(ctx, 'expense.void', 'void expense');
    return this.voidExpense(ctx, expenseId, reason);
  }

  async executeForReimbursement(
    ctx: RequestContext,
    expenseId: string,
    reason: string,
    authority: {
      reimbursementRequestId: string;
      reimbursementLineId: string;
      branchId?: string;
      systemReconcile?: boolean;
    },
  ): Promise<ExpenseRecord> {
    return this.voidExpense(ctx, expenseId, reason, authority);
  }

  private async voidExpense(
    ctx: RequestContext,
    expenseId: string,
    reason: string,
    authority?: {
      reimbursementRequestId: string;
      reimbursementLineId: string;
      branchId?: string;
      systemReconcile?: boolean;
    },
  ): Promise<ExpenseRecord> {
    if (!reason || reason.trim().length < 3) throw new BadRequestException('Void reason must be at least 3 characters');
    const r = await this.repo.findById(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException(`Expense ${expenseId} not found`);
    if (authority) {
      if (r.sourceReimbursementRequestId !== authority.reimbursementRequestId
        || r.sourceReimbursementLineId !== authority.reimbursementLineId
        || (r.branchId ?? undefined) !== authority.branchId) {
        throw new ForbiddenException('reimbursement_projection_authority_mismatch');
      }
      if (!authority.systemReconcile) assertBranchInScope(ctx, r.branchId);
      if (r.status === 'VOIDED') return r;
      if (r.status === 'READY_FOR_CONFIRMATION') {
        const occurredAt = new Date().toISOString();
        const terminalized = await this.repo.terminalizeUnconfirmedClaimProjection({
          companyId: ctx.companyId,
          expenseId,
          reimbursementRequestId: authority.reimbursementRequestId,
          reimbursementLineId: authority.reimbursementLineId,
          actorUserId: ctx.userId,
          reason,
          eventKey: `expense.voided:expense_record:${expenseId}:reimbursement-cancel`,
          payloadJson: {
            companyId: ctx.companyId,
            actorUserId: ctx.userId,
            requestId: ctx.requestId,
            aggregateType: 'expense_record',
            aggregateId: expenseId,
            occurredAt,
            data: { expenseId, voidReason: reason, reimbursementRequestId: authority.reimbursementRequestId },
          },
        });
        await this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'expense.void',
          targetType: 'expense_record',
          targetId: expenseId,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            reason,
            authority: 'REIMBURSEMENT_CANCELLATION',
            reimbursementRequestId: authority.reimbursementRequestId,
            reimbursementLineId: authority.reimbursementLineId,
          },
        });
        return terminalized;
      }
    } else {
      assertBranchInScope(ctx, r.branchId);
    }
    if (r.status !== 'CONFIRMED') throw new BadRequestException(`Can only void CONFIRMED expenses (current: ${r.status})`);

    // H-04 / GAP-07: reserve a reversal entry number for each posted leg outside
    // the void transaction (sequence rows commit independently) — the accrual
    // (expense.record) and, when the expense was paid, the settlement
    // (expense.payment). The transaction re-verifies each posting state and fails
    // closed if it changed in between.
    const periodKey = civilPeriodKey(todayCivilDate());
    const [accrualJournalId, paymentJournals] = await Promise.all([
      this.repo.findPostedGeneratedJournalId(ctx.companyId, expenseId),
      this.repo.findPostedExpensePaymentJournals(ctx.companyId, expenseId),
    ]);
    // Date.now() is deliberate: reserveNumber returns a matching-key row
    // regardless of its status, so a deterministic key would hand a retried void
    // the CANCELLED reservation from the failed attempt.
    const reserved = accrualJournalId
      ? await this.reserveNumber.execute({
          companyId: ctx.companyId, documentType: LEDGER_SEQUENCE_KEY, periodKey,
          idempotencyKey: `void-reversal:expense.record:${expenseId}:${Date.now()}`,
          reservedByUserId: ctx.userId,
        })
      : null;
    const paymentReservations: Array<{ paymentId: string; reservation: Awaited<ReturnType<ReserveDocumentNumberUseCase['execute']>> }> = [];
    for (const payment of paymentJournals) {
      paymentReservations.push({
        paymentId: payment.paymentId,
        reservation: await this.reserveNumber.execute({
          companyId: ctx.companyId, documentType: LEDGER_SEQUENCE_KEY, periodKey,
          idempotencyKey: `void-reversal:expense.payment:${payment.paymentId}:${Date.now()}`,
          reservedByUserId: ctx.userId,
        }),
      });
    }

    let result: { expense: ExpenseRecord; reversalEntryId: string | null; paymentReversalEntryId: string | null; paymentReversalEntryIds: Array<{ paymentId: string; reversalEntryId: string }> };
    try {
      result = await this.repo.voidExpenseTrueReversal(
        ctx.companyId,
        expenseId,
        ctx.userId,
        reason,
        reserved?.documentNumber,
        paymentReservations.map(({ paymentId, reservation }) => ({ paymentId, reversalEntryNumber: reservation.documentNumber })),
      );
    } catch (err) {
      // The reservations are still RESERVED here (commit happens only after a
      // successful reversal), so they must be cancelled — voidNumber accepts
      // COMMITTED numbers only and would mask the real error.
      if (reserved) await this.cancelNumber.execute({ id: reserved.id, companyId: ctx.companyId }, ctx.userId);
      for (const { reservation } of paymentReservations) {
        await this.cancelNumber.execute({ id: reservation.id, companyId: ctx.companyId }, ctx.userId);
      }
      throw err;
    }
    // Commit each reserved number to its reversal; release any that produced no
    // reversal (already reversed elsewhere, or the leg was never posted).
    if (reserved) {
      if (result.reversalEntryId) {
        await this.commitNumber.execute({ id: reserved.id, companyId: ctx.companyId, ownerType: 'journal_entry', ownerId: result.reversalEntryId }, ctx.userId);
      } else {
        await this.cancelNumber.execute({ id: reserved.id, companyId: ctx.companyId }, ctx.userId);
      }
    }
    for (const { paymentId, reservation } of paymentReservations) {
      const reversed = result.paymentReversalEntryIds.find((candidate) => candidate.paymentId === paymentId);
      if (reversed) {
        await this.commitNumber.execute({ id: reservation.id, companyId: ctx.companyId, ownerType: 'journal_entry', ownerId: reversed.reversalEntryId }, ctx.userId);
      } else {
        await this.cancelNumber.execute({ id: reservation.id, companyId: ctx.companyId }, ctx.userId);
      }
    }

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.void', targetType: 'expense_record', targetId: expenseId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { reason, reversalEntryId: result.reversalEntryId, paymentReversalEntryIds: result.paymentReversalEntryIds, grandTotalAmount: r.grandTotalAmount, ...(authority && { authority: 'REIMBURSEMENT_CANCELLATION', reimbursementRequestId: authority.reimbursementRequestId, reimbursementLineId: authority.reimbursementLineId }) } });
    void this.outbox.append('expense.voided', 'expense_record', expenseId, { companyId: ctx.companyId, aggregateType: 'expense_record', aggregateId: expenseId, requestId: ctx.requestId ?? buildIdempotencyKey(expenseId, 'voided'), occurredAt: new Date().toISOString(), data: { expenseId, voidReason: reason, reversalEntryId: result.reversalEntryId, paymentReversalEntryIds: result.paymentReversalEntryIds } });
    return result.expense;
  }
}

@Injectable()
export class MarkExpenseReadyUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, expenseId: string): Promise<ExpenseRecord> {
    const r = await this.repo.findById(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException();
    assertBranchInScope(ctx, r.branchId);
    const canReview = hasPerm(ctx, 'expense.review');
    const canUpdateOwn = hasPerm(ctx, 'expense.update') && r.createdByUserId === ctx.userId;
    if (!canReview && !canUpdateOwn) throw new ForbiddenException('Missing permission');
    if (hasBlockingNonExpenseClassification(r.aiVerificationSummaryJson)) {
      throw new BadRequestException(NON_EXPENSE_CLASSIFICATION_REVIEW_REQUIRED);
    }
    // Same endpoint serves the web "เริ่มตรวจใหม่" action on a rejected record: reopening puts it back
    // in NEEDS_REVIEW to be corrected and re-submitted, never straight into the confirmable state.
    const target = r.status === 'REJECTED' ? 'NEEDS_REVIEW' : 'READY_FOR_CONFIRMATION';
    const err = validateStatusTransition(r.status, target);
    if (err) throw new BadRequestException(err);
    return this.repo.updateExpense({ id: expenseId, companyId: ctx.companyId, updatedByUserId: ctx.userId, status: target });
  }
}

@Injectable()
export class RecordExpensePaymentUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(
    ctx: RequestContext,
    expenseId: string,
    input: RecordExpensePaymentInput,
  ): Promise<ExpenseRecord> {
    requirePerm(ctx, 'expense.payment.record', 'record expense payment');
    const r = await this.repo.findById(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException(`Expense ${expenseId} not found`);
    assertBranchInScope(ctx, r.branchId);
    // A claim projection is settled by its reimbursement payout (RBPAY), which mirrors PAID
    // onto this record in the same transaction. Accepting a manual payment here would pay the
    // same cash twice and strand an ExpensePayment no posting source ever drains.
    if (r.sourceReimbursementRequestId) {
      throw new UnprocessableEntityException({
        code: 'expense_settled_via_reimbursement',
        message: 'Claim-projected expenses are settled by their reimbursement payout, not a manual expense payment.',
      });
    }
    requireExpenseBranchId(r.branchId);
    if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== 'string' || !PAYMENT_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey))) {
      throw new BadRequestException({ code: 'expense_payment_invalid_key', message: 'Payment key must contain 8–64 letters, numbers, underscores or hyphens.' });
    }
    // Separate caller keys from legacy transport IDs; hash the whole ID, never a prefix.
    const idempotencyKey = input.idempotencyKey === undefined
      ? `request:${createHash('sha256').update(ctx.requestId || randomUUID()).digest('hex')}`
      : `client:${input.idempotencyKey}`;
    const result = await this.repo.recordPaymentAtomic({
      companyId: ctx.companyId,
      expenseId,
      actorUserId: ctx.userId,
      scopes: ctx.scopes ?? {},
      idempotencyKey,
      amount: input.paidAmount,
      paymentMethod: input.paymentMethod,
      paidAt: input.paidAt,
      bankAccountRef: input.bankAccountRef,
    }, async (tx, created) => {
      const data = { expenseId, paymentId: created.payment.id, paidAmount: created.payment.amount, cumulativePaidAmount: created.expense.paidAmount, paymentStatus: created.expense.paymentStatus };
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.payment.record', targetType: 'expense_payment', targetId: created.payment.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: data }, tx);
      await tx.outboxEvent.create({ data: {
        companyId: ctx.companyId, eventType: 'expense.payment_recorded', aggregateType: 'expense_payment', aggregateId: created.payment.id,
        eventKey: `expense.payment_recorded:expense_payment:${created.payment.id}`,
        payloadJson: { companyId: ctx.companyId, aggregateType: 'expense_payment', aggregateId: created.payment.id, requestId: ctx.requestId ?? `expense:paid:${created.payment.id}`, occurredAt: new Date().toISOString(), data },
        priority: 'NORMAL', status: 'PENDING',
      } });
    });
    return result.expense;
  }
}
