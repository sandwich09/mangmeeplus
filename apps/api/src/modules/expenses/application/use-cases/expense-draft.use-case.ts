import { Injectable, ForbiddenException, Logger, NotFoundException, BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { createHash, randomUUID } from 'node:crypto';
import { applyExpenseSourceDraftInput, sourceDraftState, projectExpenseSourceDraft, sourceDraftFinancialLines, sourceDraftSummary, bindSourceDraftLines, assertExpenseSourceDraftComplete, EXPENSE_SOURCE_DRAFT_KEY, SOURCE_DRAFT_MUTABLE_STATUSES } from '../../domain/logic/expense-source-draft.logic';
import { collectLineExpenseDraftQuestions, parseLineExpenseDraftContinuation, nextLineExpenseDraftItemRef } from '../../domain/logic/line-expense-draft-conversation.logic';
import { withPurposeNote } from '../../domain/logic/line-correction.logic';
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
import { normalizeExpensePrecisionAdjustment } from '../../domain/logic/expense-precision-adjustment.logic';
import { expenseTotalsIdentityError } from '../../domain/logic/expense-totals.logic';
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
import type { RequestContext, CreateExpenseDraftInput, UpdateExpenseDraftInput, ListExpensesFilter, ExpenseStatus, ExpenseLineChargeKind, ExpenseVatMode, ExpenseVatSourceOverrideInput, RecordExpensePaymentInput } from '@watchdog-bms/contracts';
import { isCalculatedExpenseRounding, type ExpenseDraftTotalsPreview, expenseVatReconciliationMessage, isBlockingExpenseVatReconciliation, validateExpenseWhtInput } from '@watchdog-bms/contracts';
import { ExpenseTransactionTaxService, type ExpenseTaxLineSelection } from '../services/expense-transaction-tax.service';
import { RECEIPT_REVIEW_REASONS } from '../services/receipt-ocr-apply.service';
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

function sameDecimal(left: unknown, right: unknown): boolean {
  try { return new Decimal(String(left)).eq(String(right)); } catch { return false; }
}

function sameDecimalProduct(total: unknown, quantity: unknown, unitPrice: unknown): boolean {
  try { return new Decimal(String(total)).eq(new Decimal(String(quantity)).mul(String(unitPrice))); } catch { return false; }
}

// 10D branch ABAC: membership branch scope governs reads and writes; null branchId = company-central.
function assertBranchInScope(ctx: RequestContext, branchId: string | null | undefined) {
  if (!isBranchInScope(ctx.scopes ?? {}, branchId)) {
    throw new ForbiddenException('Branch is outside your assigned branch scope.');
  }
}

/**
 * Spec §5.1, at the one point where the header and the lines genuinely come from different places:
 * the header totals are `reconcileExpenseVat`'s, and the lines are whatever
 * `TransactionTaxService.resolveLines` handed back after resolving Tax Codes. Nothing downstream
 * re-derives one from the other, so if the two ever disagree the record is written self-contradicting
 * — a grand total whose own rows do not add up to it. Refuse instead.
 */
function assertExpenseTotalsIdentity(
  vatMode: ExpenseVatMode,
  lines: readonly ExpenseLineInput[],
  totals: Parameters<typeof expenseTotalsIdentityError>[0]['totals'],
): void {
  const error = expenseTotalsIdentityError({ vatMode, totals, lines: lines.map((line) => ({
    lineSubtotalAmount: line.lineSubtotalAmount, discountAmount: line.discountAmount,
    taxableAmount: line.taxableAmount, vatAmount: line.vatAmount, whtAmount: line.whtAmount,
    lineTotalAmount: line.lineTotalAmount, chargeKind: line.chargeKind ?? null,
  })) });
  if (error) throw new BadRequestException(error);
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
          description: l.description, chargeKind: l.chargeKind ?? null, quantity: l.quantity, unitPrice: l.unitPrice,
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
        assertExpenseTotalsIdentity(input.vatMode, resolved, totals);
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
    const canReadCreated = hasPerm(ctx, 'expense.create') || hasPerm(ctx, 'expense.receipt.upload') || hasPerm(ctx, 'expense.receipt.line_upload');
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

  async sourceDraft(ctx: RequestContext, expense: ExpenseRecordWithRelations) {
    if (expense.captureSource !== 'LINE_UPLOAD') return null;
    const state = sourceDraftState(expense, await this.repo.listCategories(ctx.companyId));
    if (!state) return null;
    // Keep legacy read responses aligned with the current collection rule without writing on GET.
    // In particular, a retired D-PURPOSE question must not survive in the AI summary beside the
    // normalized source projection and re-arm a client-side blocker.
    expense.aiVerificationSummaryJson = sourceDraftSummary(expense.aiVerificationSummaryJson, state);
    const permitted = hasPerm(ctx, 'expense.review') || (expense.createdByUserId === ctx.userId
      && ['expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload'].some((permission) => hasPerm(ctx, permission)));
    const active = permitted && await this.repo.findActiveMemberIdentity(ctx.companyId, ctx.userId, expense.branchId);
    return projectExpenseSourceDraft(state, Boolean(active) && SOURCE_DRAFT_MUTABLE_STATUSES.includes(expense.status));
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

type UpdateExpenseDraftOptions = {
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
      /** Validated web source payload; never exposed as an HTTP option. */
      webSourceDraft?: boolean;
      sourceExpense?: ExpenseRecordWithRelations;
  previewOnly?: boolean;
};

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
  async execute(ctx: RequestContext, expenseId: string, input: UpdateExpenseDraftInput,
    options: UpdateExpenseDraftOptions & { previewOnly: true }): Promise<ExpenseDraftTotalsPreview>;
  async execute(ctx: RequestContext, expenseId: string, input: UpdateExpenseDraftInput,
    options?: UpdateExpenseDraftOptions): Promise<ExpenseRecord>;
  async execute(
    ctx: RequestContext,
    expenseId: string,
    input: UpdateExpenseDraftInput,
    options: UpdateExpenseDraftOptions = {},
  ): Promise<ExpenseRecord | ExpenseDraftTotalsPreview> {
    // Capture explicit intent before source/financial synchronization can supply stored values.
    const dateReviewInput = input.sourceDraft?.expenseDate !== undefined ? input.sourceDraft.expenseDate : input.expenseDate || undefined;
    const r = await this.repo.findById(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException(`Expense ${expenseId} not found`);
    assertBranchInScope(ctx, r.branchId);
    if (input.branchId !== undefined) assertBranchInScope(ctx, input.branchId);

    const canReview = hasPerm(ctx, 'expense.review');
    const isOwner = r.createdByUserId === ctx.userId;
    let combinedReviewSourceState: ReturnType<typeof sourceDraftState> = null;
    let combinedReviewSourceExpense: ExpenseRecordWithRelations | undefined;
    let combinedReviewSourceInput: UpdateExpenseDraftInput['sourceDraft'];
    if (input.sourceDraft !== undefined) {
      const sourceOnly = !Object.keys(input).some((key) => !['expectedUpdatedAt', 'sourceDraft'].includes(key));
      if (!sourceOnly && !canReview) {
        throw new BadRequestException('sourceDraft must be sent alone with expectedUpdatedAt.');
      }
      const sourceStatusMutable = SOURCE_DRAFT_MUTABLE_STATUSES.includes(r.status)
        || (!sourceOnly && canReview && r.status === 'READY_FOR_CONFIRMATION');
      if (r.captureSource !== 'LINE_UPLOAD' || !sourceStatusMutable
        || (!canReview && !(isOwner && ['expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload'].some((permission) => hasPerm(ctx, permission))))
        || !await this.repo.findActiveMemberIdentity(ctx.companyId, ctx.userId, r.branchId)) {
        throw new ForbiddenException('Source draft editing requires an active originating uploader or reviewer.');
      }
      if (!input.expectedUpdatedAt) throw new BadRequestException({ code: 'EXPENSE_UPDATE_VERSION_REQUIRED', message: 'expectedUpdatedAt is required.' });
      const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId, options.db, ctx.scopes ?? {});
      if (!expense) throw new NotFoundException();
      const categories = await this.repo.listCategories(ctx.companyId);
      const initial = sourceDraftState(expense, categories);
      if (!initial) throw new BadRequestException('Source draft cannot be read safely.');
      const source = input.sourceDraft;
      const changed = applyExpenseSourceDraftInput(initial, source, categories);
      if (!sourceOnly) {
        const sourcePurpose = changed.state.header.businessPurpose ?? '';
        const financialPurpose = input.note?.split(' · ').find((part) => part.startsWith('วัตถุประสงค์: '))?.slice('วัตถุประสงค์: '.length).trim() ?? '';
        if ((source.expenseDate !== undefined && input.expenseDate !== undefined && (changed.state.header.expenseDate ?? '') !== input.expenseDate)
          || (source.vendorName !== undefined && input.vendorNameSnapshot !== undefined && (changed.state.header.vendorName ?? '') !== input.vendorNameSnapshot.trim())
          || (source.businessPurpose !== undefined && input.note !== undefined && sourcePurpose !== financialPurpose)) {
          throw new BadRequestException({ code: 'EXPENSE_SOURCE_DRAFT_RELOAD_REQUIRED', message: 'Source and financial header facts disagree.' });
        }
        if (source.expenseDate === undefined && input.expenseDate !== undefined) changed.state.header.expenseDate = input.expenseDate;
        else if (source.expenseDate !== undefined && input.expenseDate === undefined && changed.state.header.expenseDate) input = { ...input, expenseDate: changed.state.header.expenseDate };
        if (source.vendorName === undefined && input.vendorNameSnapshot !== undefined) {
          if (input.vendorNameSnapshot.trim()) changed.state.header.vendorName = input.vendorNameSnapshot.trim(); else delete changed.state.header.vendorName;
        } else if (source.vendorName !== undefined && input.vendorNameSnapshot === undefined) input = { ...input, vendorNameSnapshot: changed.state.header.vendorName ?? '' };
        if (source.businessPurpose === undefined && input.note !== undefined) {
          if (financialPurpose) changed.state.header.businessPurpose = financialPurpose; else delete changed.state.header.businessPurpose;
        } else if (source.businessPurpose !== undefined && input.note === undefined) input = { ...input, note: withPurposeNote(expense.note, sourcePurpose, Number.POSITIVE_INFINITY) };
      }
      changed.state = bindSourceDraftLines(changed.state, expense);
      changed.state.unresolvedQuestions = collectLineExpenseDraftQuestions(changed.state, categories);
      if (sourceOnly) {
        const lines = sourceDraftFinancialLines(changed.state, expense, changed.acceptedFields, categories);
        const nextUpdatedAt = new Date(Math.max(Date.now(), expense.updatedAt.getTime() + 1));
        changed.state.targetRevision = nextUpdatedAt.toISOString();
        const note = source.businessPurpose !== undefined ? withPurposeNote(expense.note, changed.state.header.businessPurpose ?? '', Number.POSITIVE_INFINITY) : undefined;
        options = { ...options, requireExpectedUpdatedAt: true, webSourceDraft: true, sourceExpense: expense,
          lineDraftCollection: { nextUpdatedAt, sourceChannelMetadataJson: { ...expense.sourceChannelMetadataJson, [EXPENSE_SOURCE_DRAFT_KEY]: changed.state },
            aiVerificationSummaryJson: sourceDraftSummary(expense.aiVerificationSummaryJson, changed.state) } };
        input = { expectedUpdatedAt: input.expectedUpdatedAt,
          ...(source.expenseDate !== undefined && changed.state.header.expenseDate ? { expenseDate: changed.state.header.expenseDate } : {}),
          ...(source.vendorName !== undefined ? { vendorNameSnapshot: changed.state.header.vendorName ?? '' } : {}),
          ...(note !== undefined ? { note } : {}), ...(lines ? { lines } : {}) };
      } else {
        combinedReviewSourceState = changed.state;
        combinedReviewSourceExpense = expense;
        combinedReviewSourceInput = source;
      }
    }
    const canCollectOwnLineDraft = Boolean(options.lineDraftCollection)
      && (ctx.authProvider === 'line' || options.webSourceDraft)
      && r.captureSource === 'LINE_UPLOAD'
      && SOURCE_DRAFT_MUTABLE_STATUSES.includes(r.status)
      && (isOwner || (options.webSourceDraft && canReview))
      && ((options.webSourceDraft && canReview) || hasPerm(ctx, 'expense.receipt.line_upload') || hasPerm(ctx, 'expense.receipt.upload') || hasPerm(ctx, 'expense.create'));
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

    // A receipt can reach the web without a LINE continuation (OCR failure or collection off).
    // Preserve that same source projection through review, and reopen incomplete legacy READY
    // records so the existing source form provides the correction path.
    const reviewSourceExpense = combinedReviewSourceState ? combinedReviewSourceExpense
      : !canCollectOwnLineDraft && canReview && r.captureSource === 'LINE_UPLOAD' && !r.sourceChannelMetadataJson?.[EXPENSE_SOURCE_DRAFT_KEY]
      ? await this.repo.findByIdWithRelations(ctx.companyId, expenseId, options.db, ctx.scopes ?? {}) : undefined;
    const reviewSourceState = combinedReviewSourceState
      ?? (reviewSourceExpense ? sourceDraftState(reviewSourceExpense, await this.repo.listCategories(ctx.companyId)) : null);
    const hasSourceDraft = Boolean(r.sourceChannelMetadataJson?.[EXPENSE_SOURCE_DRAFT_KEY] || reviewSourceState);
    const persistedSourceState = parseLineExpenseDraftContinuation(r.sourceChannelMetadataJson?.[EXPENSE_SOURCE_DRAFT_KEY]);
    const reopenSourceReview = !canCollectOwnLineDraft && canReview && r.status === 'READY_FOR_CONFIRMATION'
      && (reviewSourceState ? reviewSourceState.unresolvedQuestions.length > 0
        : hasSourceDraft && (!persistedSourceState || collectLineExpenseDraftQuestions(persistedSourceState, []).length > 0));
    const removedSourceItems = input.removedSourceItemRefs ?? [];
    if (removedSourceItems.length || input.removedSourceItemRefs !== undefined) {
      const state = persistedSourceState ?? reviewSourceState;
      if (!canReview || !state || !input.lines) throw new ForbiddenException('Only a reviewer may remove staged receipt rows.');
      if (!Array.isArray(removedSourceItems) || removedSourceItems.length > 40
        || new Set(removedSourceItems).size !== removedSourceItems.length
        || removedSourceItems.some((ref) => !state.items.some((item) => item.itemRef === ref)
          || input.lines!.some((line) => line.sourceItemRef === ref || (state.items.find((item) => item.itemRef === ref)?.lineId === line.id && line.id !== undefined)))) {
        throw new BadRequestException({ code: 'EXPENSE_SOURCE_DRAFT_RELOAD_REQUIRED', message: 'Unknown, repeated or retained staged receipt row.' });
      }
    }
    const sourceRows = input.lines?.filter((line) => line.sourceItemRef !== undefined) ?? [];
    if (sourceRows.length) {
      const state = persistedSourceState ?? reviewSourceState;
      if (!canReview || !state) throw new ForbiddenException('Only a reviewer may resolve staged receipt rows.');
      const seen = new Set<string>();
      for (const line of sourceRows) {
        const item = state.items.find((item) => item.itemRef === line.sourceItemRef);
        if (!item || seen.has(item.itemRef) || (item.lineId && line.id !== item.lineId)
          || !Number.isInteger(line.lineNumber) || input.lines!.filter((entry) => entry.lineNumber === line.lineNumber).length !== 1) {
          throw new BadRequestException({ code: 'EXPENSE_SOURCE_DRAFT_RELOAD_REQUIRED', message: 'Unknown, repeated or mismatched staged receipt row.' });
        }
        seen.add(item.itemRef);
      }
      for (const patch of combinedReviewSourceInput?.items ?? []) {
        if (!patch.itemRef) continue;
        const line = sourceRows.find((candidate) => candidate.sourceItemRef === patch.itemRef);
        if (!line) continue;
        const contradicts = (patch.description != null && patch.description.trim() !== '' && patch.description.trim() !== line.description.trim())
          || (patch.quantity != null && patch.quantity !== '' && !sameDecimal(patch.quantity, line.quantity))
          || (patch.unitPrice != null && patch.unitPrice !== '' && !sameDecimal(patch.unitPrice, line.unitPrice))
          || (patch.totalAmount != null && patch.totalAmount !== '' && !sameDecimalProduct(patch.totalAmount, line.quantity, line.unitPrice))
          || (patch.expenseCategoryId != null && patch.expenseCategoryId !== '' && patch.expenseCategoryId !== line.expenseCategoryId);
        if (contradicts) throw new BadRequestException({ code: 'EXPENSE_SOURCE_DRAFT_RELOAD_REQUIRED', message: 'Source facts and reviewed financial row disagree.' });
      }
    }
    let lines = input.lines;
    const identityMode = Boolean(lines && (lines.some((line) => line.id !== undefined)
      || (!canCollectOwnLineDraft && canReview && hasSourceDraft)));
    let identityExpense = identityMode ? reviewSourceExpense ?? await this.repo.findByIdWithRelations(ctx.companyId, expenseId, options.db, ctx.scopes ?? {}) : undefined;
    if (identityMode && !identityExpense) throw new NotFoundException();
    if (identityMode && lines) {
      const used = new Set<string>();
      lines = lines.map((line) => {
        let id = line.id;
        if (id !== undefined && (typeof id !== 'string' || !identityExpense!.lines.some((stored) => stored.id === id))) {
          throw new BadRequestException('Expense line identity is outside this draft.');
        }
        if (!id) {
          const matches = identityExpense!.lines.filter((stored) => stored.description === line.description && !used.has(stored.id));
          if (matches.length > 1) throw new BadRequestException('Ambiguous expense row. Reload the draft to retain its row identity.');
          if (matches.length === 1) id = matches[0]!.id;
        }
        if (id && used.has(id)) throw new BadRequestException('Repeated expense line identity.');
        if (id) used.add(id);
        return { ...line, ...(id ? { id } : {}) };
      });
    }
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
      // §5.1 PATCH semantics for `chargeKind`. `lines` is a full replacement, so a client that
      // echoed a line back without this field used to CLEAR it — a service charge quietly became a
      // product row, the goods subtotal grew by its amount, and the request still answered 200.
      // Absent means "leave this row's kind alone"; only an explicit null clears one.
      //
      // Matched by DESCRIPTION, not by `lineNumber`. A line number is a position: inserting a goods
      // row renumbers everything under it, so the row arriving as line 2 is usually not the row that
      // was line 2. Resolving by number handed a newly typed ของหวาน the service charge's kind and
      // answered 200 — and the totals identity agreed, because it is derived from those same wrong
      // kinds. A description that matches exactly one stored row is the row; anything else (a new
      // row, a renamed one, or a duplicate description) resolves to null rather than a guess.
      //
      // ONE COLLISION SURVIVES, deliberately: a caller that omits the field AND gives a product the
      // exact description of a stored charge row inherits that row's kind. Nothing distinguishes
      // that from "this IS the charge row, renamed nowhere" without an identity the wire format does
      // not carry. It is far narrower than the line-number version — it needs a byte-exact
      // description collision rather than any insert — and no first-party caller can reach it: the
      // web form, the LINE draft-collection lane and the OCR apply all state `chargeKind` on every
      // row. The fix is to make the field required once no caller omits it (see
      // `docs/agent-memory/line-ai-draft-control.md`); until then this is the legacy/third-party
      // fallback, and `expense-draft-amount-validation.use-case.spec.ts` pins the behaviour so it
      // cannot widen unnoticed.
      //
      // Read here, before validation so the shape rules and the totals see what will be stored,
      // after the cheap guards above so a rejected request never pays for it, and on the caller's
      // transaction so a concurrent edit cannot slip between this read and the write.
      const storedLines = await this.repo.listLineChargeKinds(ctx.companyId, expenseId, options.db);
      const storedKindsByDescription = new Map<string, ExpenseLineChargeKind | null | 'ambiguous'>();
      for (const stored of storedLines.values()) {
        storedKindsByDescription.set(
          stored.description,
          storedKindsByDescription.has(stored.description) ? 'ambiguous' : stored.chargeKind,
        );
      }
      let withChargeKinds = lines.map((line) => {
        if (line.chargeKind !== undefined) return { ...line, chargeKind: line.chargeKind };
        const stored = storedKindsByDescription.get(line.description);
        return { ...line, chargeKind: stored === undefined || stored === 'ambiguous' ? null : stored };
      });
      // Spec §19c: VAT mode describes the document arithmetic; claimability is the separate axis below.
      const vatMode = input.vatMode ?? r.vatMode;
      // Validate client shape before removing/remapping a system-owned row.
      const rawVatSourceError = validateExpenseVatSourceInput(input.vatSource, vatMode, withChargeKinds.map((line) => line.lineNumber));
      if (rawVatSourceError) throw new BadRequestException(rawVatSourceError);
      let source = input.vatSource ?? vatSourceFromSnapshot(r.vatCaptureSnapshotJson) ?? { inputType: 'NONE' as const };
      // Read provenance from this tenant's stored rows. HTTP cannot claim an adjustment is automatic.
      if ([...storedLines.values()].some((line) => line.chargeKind === 'ROUNDING')) {
        identityExpense ??= await this.repo.findByIdWithRelations(ctx.companyId, expenseId, options.db, ctx.scopes ?? {});
        if (!identityExpense) throw new NotFoundException();
        const normalized = normalizeExpensePrecisionAdjustment(withChargeKinds, source, identityExpense, vatMode);
        withChargeKinds = normalized.lines.map((line) => ({ ...line, chargeKind: line.chargeKind ?? null }));
        source = normalized.source;
      }
      const amountError = validateExpenseDraftAmounts({ vatMode, lines: withChargeKinds });
      if (amountError) throw new BadRequestException(amountError);
      const vatSourceError = validateExpenseVatSourceInput(source, vatMode, withChargeKinds.map((line) => line.lineNumber));
      if (vatSourceError) throw new BadRequestException(vatSourceError);
      const vat = reconcileExpenseVat({
        vatMode,
        lines: withChargeKinds,
        source,
        sourceOrigin: input.vatSource ? 'REVIEWER' : r.vatCaptureSnapshotJson?.source.origin ?? 'REVIEWER',
        sourceTaxableAmount: input.vatSource ? null : r.vatCaptureSnapshotJson?.source.taxableAmount,
        sourceGrossAmount: input.vatSource ? null : r.vatCaptureSnapshotJson?.source.grossAmount,
        sourceEvidenceRefs: input.vatSource ? undefined : r.vatCaptureSnapshotJson?.source.evidenceRefs,
        capturedAt: input.vatSource ? undefined : r.vatCaptureSnapshotJson?.source.capturedAt,
      });
      const whtAmountError = applyExpenseWhtInput(vat, whtInput);
      if (whtAmountError) throw new BadRequestException(whtAmountError);
      const vatTreatmentError = validateExpenseLineVatTreatments(withChargeKinds.map((line, index) => ({ ...line, vatRate: vat.lines[index]!.vatRate })));
      if (vatTreatmentError) throw new BadRequestException(vatTreatmentError);
      totals = vat.totals;
      vatCaptureSnapshotJson = vat.snapshot;
      const preservedSourceLines = new Set<number>();
      const prepared = withChargeKinds.map((l, i) => {
        const reconciled = vat.lines[i]!;
        const t = reconciled.totals;
        const sourceLineId = canCollectOwnLineDraft ? (l as typeof l & { sourceLineId?: string }).sourceLineId : l.id;
        const stored = sourceLineId ? (canCollectOwnLineDraft ? options.sourceExpense : identityExpense)?.lines.find((line) => line.id === sourceLineId) : undefined;
        if (sourceLineId && !stored) throw new BadRequestException('Source line identity changed; reload before editing.');
        const unchangedMoney = stored && ['quantity', 'unitPrice', 'discountAmount', 'vatRate', 'whtRate'].every((key) => {
          const a = (stored as unknown as Record<string, unknown>)[key];
          const b = (l as unknown as Record<string, unknown>)[key];
          return a == null && b == null || a != null && b != null && new Decimal(String(a)).eq(String(b));
        });
        if (canCollectOwnLineDraft && stored && unchangedMoney) {
          preservedSourceLines.add(i);
          return { ...stored, expenseId, companyId: ctx.companyId, lineNumber: l.lineNumber, description: l.description,
            expenseCategoryId: l.expenseCategoryId ?? null, accountHintKey: l.accountHintKey ?? null,
            taxSnapshot: stored.taxSnapshot ?? undefined, taxComponents: stored.taxComponents ?? undefined,
            preserveLineId: stored.id, sourceLineId: stored.id };
        }
        return {
          ...(stored ? { sourceLineText: stored.sourceLineText, aiLineConfidence: stored.aiLineConfidence, reviewStatus: stored.reviewStatus, preserveLineId: stored.id, sourceLineId: stored.id } : {}),
          expenseId, companyId: ctx.companyId, lineNumber: l.lineNumber, description: l.description,
          chargeKind: l.chargeKind ?? null, quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: t.discountAmount,
          taxableAmount: t.taxableAmount, vatRate: reconciled.vatRate, vatTreatment: l.vatTreatment ?? null, vatAmount: t.vatAmount,
          whtRate: expenseWhtLineRate(whtInput, l.whtRate), whtAmount: t.whtAmount, lineSubtotalAmount: t.lineSubtotalAmount,
          lineTotalAmount: t.lineTotalAmount, expenseCategoryId: l.expenseCategoryId ?? null,
          accountHintKey: l.accountHintKey ?? null, taxCategory: l.taxCategory ?? null,
          ...taxSelection(l),
        };
      });
      const taxHeader = { expenseId, branchId: input.branchId ?? r.branchId ?? undefined,
        expenseDate: input.expenseDate ?? r.expenseDate.toISOString(), currency: r.currency };
      if (canCollectOwnLineDraft) {
        resolvedLines = await Promise.all(prepared.map(async (line, index) => preservedSourceLines.has(index)
          ? line : (await this.transactionTax.resolveLines(ctx, taxHeader, [line], 'DRAFT', options.db))[0]!));
        if (preservedSourceLines.size === prepared.length && prepared.length === options.sourceExpense?.lines.length) {
          totals = { subtotalAmount: r.subtotalAmount, discountAmount: r.discountAmount, taxableAmount: r.taxableAmount,
            vatAmount: r.vatAmount, whtAmount: r.whtAmount, grandTotalAmount: r.grandTotalAmount, netPayableAmount: r.netPayableAmount };
          vatCaptureSnapshotJson = undefined;
        }
      } else resolvedLines = await this.transactionTax.resolveLines(ctx, taxHeader, prepared, 'DRAFT', options.db);
      assertExpenseTotalsIdentity(vatMode, resolvedLines, totals);
    } else if (input.vatSource !== undefined || input.whtInput !== undefined
      || (whtInput && input.vatMode !== undefined && input.vatMode !== r.vatMode)) {
      throw new BadRequestException('lines are required when updating vatSource or whtInput.');
    }

    // Read-only preview shares all calculation/permission guards above and exits BEFORE any write,
    // review marking, source continuation update or audit. Save still repeats calculation and CAS.
    if (options.previewOnly) {
      if (!expectedUpdatedAt || expectedUpdatedAt.getTime() !== r.updatedAt.getTime()) {
        throw new ConflictException({ code: 'EXPENSE_UPDATE_CONFLICT', message: 'Expense changed; reload before reviewing totals.' });
      }
      if (!totals || !resolvedLines) throw new BadRequestException('lines are required to preview receipt totals.');
      const sum = (predicate: (line: ExpenseLineInput) => boolean) => resolvedLines!
        .filter(predicate).reduce((value, line) => value.plus(line.lineSubtotalAmount), new Decimal(0)).toFixed(4);
      return { ...totals, outstandingAmount: Decimal.max(new Decimal(totals.netPayableAmount).minus(r.paidAmount), 0).toFixed(4),
        chargesTotalAmount: sum((line) => !!line.chargeKind && line.chargeKind !== 'ROUNDING'),
        calculatedAdjustmentAmount: sum(isCalculatedExpenseRounding),
        printedRoundingAmount: sum((line) => line.chargeKind === 'ROUNDING' && !isCalculatedExpenseRounding(line)),
        vatCaptureSnapshotJson: vatCaptureSnapshotJson ?? null };
    }

    const reviewedAt = canReview && !options.lineDraftCollection ? new Date() : undefined;
    const reviewedByUserId = canReview && !options.lineDraftCollection ? ctx.userId : undefined;
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
      if (new Decimal(totals.grandTotalAmount).gt(0) || (options.lineDraftCollection && lines?.length)) {
        resolvedMissingFields.add('grandTotalAmount'); resolvedMissingFields.add('amount');
      }
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

    if (options.lineDraftCollection) {
      const summary = options.lineDraftCollection.aiVerificationSummaryJson;
      if (Array.isArray(summary['missingFields'])) summary['missingFields'] = summary['missingFields'].filter((field) =>
        typeof field === 'string' && !resolvedMissingFields.has(field));
      const state = options.lineDraftCollection.sourceChannelMetadataJson[EXPENSE_SOURCE_DRAFT_KEY] as Record<string, unknown>;
      state['materializedHeader'] = { expenseDate: input.expenseDate ?? r.expenseDate?.toISOString().slice(0, 10) ?? null,
        vendorName: input.vendorNameSnapshot ?? r.vendorNameSnapshot,
        businessPurpose: (input.note ?? r.note)?.split(' · ').find((part) => part.startsWith('วัตถุประสงค์: '))?.slice('วัตถุประสงค์: '.length).trim() || null };
    }
    if (dateReviewInput !== undefined) {
      const expenseDate = dateReviewInput ? coerceCivilDate(dateReviewInput) : null;
      const summary = options.lineDraftCollection?.aiVerificationSummaryJson ?? nextSummaryJson ?? r.aiVerificationSummaryJson ?? {};
      const missing = Array.isArray(summary['missingFields']) ? summary['missingFields'].filter((field) => field !== 'expenseDate') : [];
      const reasons = Array.isArray(summary['reviewReasons']) ? summary['reviewReasons'].filter((reason) =>
        reason !== RECEIPT_REVIEW_REASONS.dateUnverified && reason !== RECEIPT_REVIEW_REASONS.dateImplausible) : [];
      const resolved = { ...summary, dateStatus: expenseDate ? 'verified' : 'unverified',
        missingFields: expenseDate ? missing : [...missing, 'expenseDate'],
        reviewReasons: expenseDate ? reasons : [...reasons, RECEIPT_REVIEW_REASONS.dateUnverified],
        dateResolution: { expenseDate, resolvedByUserId: ctx.userId, resolvedAt: new Date().toISOString() },
      };
      // Both routes write this with the date under the same CAS transaction. OCR evidence remains intact.
      if (options.lineDraftCollection) options.lineDraftCollection.aiVerificationSummaryJson = resolved;
      else nextSummaryJson = resolved;
    }
    const updated = await this.repo.updateExpense({
      id: expenseId, companyId: ctx.companyId, updatedByUserId: ctx.userId,
      ...(ctx.authProvider !== 'line' ? { refreshSubstituteEvidence: { requestId: ctx.requestId } } : {}),
      ...(reopenSourceReview && { status: 'NEEDS_REVIEW' }),
      ...(expectedUpdatedAt && { expectedUpdatedAt }),
      ...(input.branchId !== undefined && { branchId: input.branchId }),
      ...(input.expenseDate && { expenseDate: civilDateToUtcDate(coerceCivilDate(input.expenseDate)) }),
      ...(input.vatMode && { vatMode: input.vatMode }),
      ...((!options.lineDraftCollection && (disallowsTaxCode || input.inputVatClaimStatus)) && { inputVatClaimStatus: disallowsTaxCode ? 'NON_CLAIMABLE' : input.inputVatClaimStatus }),
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
    }, resolvedLines || options.transactionalAudit || hasSourceDraft
      ? async (tx) => {
        if (resolvedLines) {
          await this.repo.upsertLines(ctx.companyId, expenseId, resolvedLines, tx, canCollectOwnLineDraft || identityMode);
          if (options.lineDraftCollection) {
            const saved = await this.repo.findByIdWithRelations(ctx.companyId, expenseId, tx, ctx.scopes ?? {});
            if (!saved) throw new NotFoundException();
            const metadata = options.lineDraftCollection.sourceChannelMetadataJson;
            const state = metadata[EXPENSE_SOURCE_DRAFT_KEY] as import('../../domain/logic/line-expense-draft-conversation.logic').LineExpenseDraftContinuation;
            const bound = bindSourceDraftLines(state, saved);
            await this.repo.updateExpense({ id: expenseId, companyId: ctx.companyId, updatedByUserId: ctx.userId,
              sourceChannelMetadataJson: { ...metadata, [EXPENSE_SOURCE_DRAFT_KEY]: bound }, updatedAt: options.lineDraftCollection.nextUpdatedAt }, undefined, tx);
          }
        }
        if (!options.lineDraftCollection && hasSourceDraft) {
          const saved = await this.repo.findByIdWithRelations(ctx.companyId, expenseId, tx, ctx.scopes ?? {});
          if (!saved) throw new NotFoundException();
          const categories = await this.repo.listCategories(ctx.companyId);
          if (combinedReviewSourceState) combinedReviewSourceState.targetRevision = saved.updatedAt.toISOString();
          let state = sourceDraftState(reviewSourceState
            ? { ...saved, sourceChannelMetadataJson: { ...saved.sourceChannelMetadataJson, [EXPENSE_SOURCE_DRAFT_KEY]: reviewSourceState } } : saved, categories);
          if (!state) throw new BadRequestException('Source draft cannot be read safely.');
          if (input.expenseDate && combinedReviewSourceInput?.expenseDate === undefined) state.header.expenseDate = input.expenseDate;
          if (canReview && identityMode && lines) {
            // A reviewer explicitly replaced the financial row set. Only its proven bound source
            // items may disappear; unresolved source items without a line id remain staged.
            const prior = reviewSourceState ?? parseLineExpenseDraftContinuation(r.sourceChannelMetadataJson?.[EXPENSE_SOURCE_DRAFT_KEY]);
            if (!prior) throw new BadRequestException('Source draft cannot be read safely.');
            state.items = state.items.filter((item) => !removedSourceItems.includes(item.itemRef));
            // A full financial review replaces the unaccepted OCR breakdown with the submitted
            // rows. Keep original OCR in recognizedFields; do not leave hidden source questions
            // or count those source rows a second time. Partial/source-only saves retain them.
            if (!combinedReviewSourceInput && lines.some((line) => !line.chargeKind)) {
              state.items = state.items.filter((item) => item.lineId || item.newItem
                || sourceRows.some((line) => line.sourceItemRef === item.itemRef));
            }
            // This is the explicit full review just submitted, not an OCR/position guess. Bind each
            // scoped source reference to the row written in this SAME transaction, including new rows
            // and duplicate descriptions. Later partial edits retain that persisted financial identity.
            for (const reviewed of sourceRows) {
              const item = state.items.find((item) => item.itemRef === reviewed.sourceItemRef);
              const line = saved.lines.find((line) => line.lineNumber === reviewed.lineNumber);
              if (!item || !line || line.chargeKind) throw new BadRequestException({ code: 'EXPENSE_SOURCE_DRAFT_RELOAD_REQUIRED', message: 'Reviewed source row is unavailable.' });
              item.lineId = line.id;
              if (!combinedReviewSourceInput) {
                item.description = line.description; item.quantity = line.quantity; item.unitPrice = line.unitPrice;
                if (line.expenseCategoryId) item.expenseCategoryId = line.expenseCategoryId; else delete item.expenseCategoryId;
                delete item.totalAmount;
              } else if (!item.expenseCategoryId && line.expenseCategoryId) {
                // Category is the reviewer's accounting decision on this explicitly scoped row.
                // Unknown receipt quantity/price remain unknown, but that accepted category is final.
                item.expenseCategoryId = line.expenseCategoryId;
              }
              delete item.reviewRequired;
            }
            const deleted = new Set(prior.items.filter((item) => item.lineId && !saved.lines.some((line) => line.id === item.lineId)).map((item) => item.itemRef));
            state.items = state.items.filter((item) => !deleted.has(item.itemRef));
            for (const item of state.items.filter((item) => !item.lineId)) {
              const matches = saved.lines.filter((line) => !line.chargeKind && line.description === item.description);
              if (matches.length !== 1) continue;
              const line = matches[0]!;
              // The full review explicitly supplies these facts, including correcting a summary
              // row whose OCR quantity/price were missing. Unmatched source items stay staged.
              item.lineId = line.id; item.quantity = line.quantity; item.unitPrice = line.unitPrice;
              delete item.totalAmount;
              if (line.expenseCategoryId) item.expenseCategoryId = line.expenseCategoryId;
            }
            for (const line of saved.lines.filter((line) => !line.chargeKind)) {
              if (state.items.some((item) => item.lineId === line.id || (!item.lineId && item.description === line.description))) continue;
              state.items.push({ itemRef: nextLineExpenseDraftItemRef(state.items), sourceText: line.description.slice(0, 200),
                lineId: line.id, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
                ...(line.expenseCategoryId ? { expenseCategoryId: line.expenseCategoryId } : {}) });
            }
            state = bindSourceDraftLines(state, saved);
          }
          if (combinedReviewSourceInput) {
            (state as typeof state & { materializedHeader?: Record<string, string | null> }).materializedHeader = {
              expenseDate: saved.expenseDate?.toISOString().slice(0, 10) ?? null,
              vendorName: saved.vendorNameSnapshot ?? null,
              businessPurpose: saved.note?.split(' · ').find((part) => part.startsWith('วัตถุประสงค์: '))?.slice('วัตถุประสงค์: '.length).trim() || null,
            };
          }
          state.unresolvedQuestions = collectLineExpenseDraftQuestions(state, categories);
          await this.repo.updateExpense({ id: expenseId, companyId: ctx.companyId, updatedByUserId: ctx.userId,
            sourceChannelMetadataJson: { ...saved.sourceChannelMetadataJson, [EXPENSE_SOURCE_DRAFT_KEY]: state },
            aiVerificationSummaryJson: sourceDraftSummary(saved.aiVerificationSummaryJson, state), updatedAt: saved.updatedAt }, undefined, tx);
        }
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
    assertExpenseSourceDraftComplete(r.sourceChannelMetadataJson, r);
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
      hasLinkedClaimEvidence: Boolean(authority && r.sourceChannelMetadataJson?.reimbursementSource),
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
    if (target === 'READY_FOR_CONFIRMATION') {
      const source = r.captureSource === 'LINE_UPLOAD' && !r.sourceChannelMetadataJson?.[EXPENSE_SOURCE_DRAFT_KEY]
        ? await this.repo.findByIdWithRelations(ctx.companyId, expenseId) : undefined;
      assertExpenseSourceDraftComplete(r.sourceChannelMetadataJson, source ?? undefined);
    }
    const err = validateStatusTransition(r.status, target);
    if (err) throw new BadRequestException(err);
    return this.repo.updateExpense({ id: expenseId, companyId: ctx.companyId, updatedByUserId: ctx.userId, status: target, expectedUpdatedAt: r.updatedAt });
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
