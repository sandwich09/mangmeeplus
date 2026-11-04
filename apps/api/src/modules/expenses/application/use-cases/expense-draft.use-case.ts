import { assertEWhtPaymentMethod } from '../../infrastructure/prisma-expense.repository';
import { eWhtRemittanceAllowed, normalizeWhtRemittance } from '../../domain/logic/expense-status.logic';
import { expenseHistoryChanges, type ExpenseHistoryChanges } from '../../domain/logic/expense-history.logic';
import type { ExpenseDb } from '../../infrastructure/prisma-expense.repository';
import { PrismaDisbursementVoucherRepository } from '../../infrastructure/prisma-disbursement-voucher.repository';
import { E_WHT_WORDS, EXPENSE_REVIEW_REQUEST_WORDS } from '@watchdog-bms/contracts';
import { LinkAttachmentUseCase } from '../../../data-model-core/application/use-cases/link-attachment.use-case';
import { DisbursementVoucherNoticeService } from '../services/disbursement-voucher-notice.service';
import type { Prisma } from '../../../../generated/prisma/client';
import { EXPENSE_VOID_CERTIFICATE_WORDS } from '@watchdog-bms/contracts';
import { maskAccountNumber } from '../../../banking/domain/logic/banking.logic';
import { isCivilDate, EXPENSE_CORRECTION_WORDS } from '@watchdog-bms/contracts';
import { assertExpenseFinancialAccess, expenseDraftAccess } from '../expense-commercial-access';
import { canonicalFingerprint } from '../../../../common/security/canonical-fingerprint';
import { isSerializationFailure } from '../../../../common/database/prisma-error';
import { expenseDraftNumberingEnabled } from '../../infrastructure/expense-number';
import { expenseListReadScope } from '../expense-list-read-scope';
import { Optional, Injectable, ForbiddenException, Logger, NotFoundException, BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { expenseEvidenceAssessment, expenseEvidenceInputError, expenseEvidenceFingerprint, expenseEvidenceConfirmationError, hasCurrentExpenseEvidenceReview, type ExpenseEvidenceAssessment } from '@watchdog-bms/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { applyExpenseSourceDraftInput, sourceDraftState, projectExpenseSourceDraft, sourceDraftFinancialLines, sourceDraftSummary, bindSourceDraftLines, assertExpenseSourceDraftComplete, EXPENSE_SOURCE_DRAFT_KEY, SOURCE_DRAFT_MUTABLE_STATUSES } from '../../domain/logic/expense-source-draft.logic';
import { collectLineExpenseDraftQuestions, parseLineExpenseDraftContinuation, nextLineExpenseDraftItemRef } from '../../domain/logic/line-expense-draft-conversation.logic';
import { withPurposeNote } from '../../domain/logic/line-correction.logic';
import { PAYMENT_IDEMPOTENCY_KEY_PATTERN } from '../../../accounting-documents/domain/logic/accounting-money-validation.logic';
import { PrismaExpenseRepository, assertExpensePaymentSource, validateExpensePaymentInput, assertExpensePaymentOutstanding, requireExpenseBranchId, type ExpensePaymentResult, type ExpenseCertificateCancellation } from '../../infrastructure/prisma-expense.repository';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import { claimOwnsExpenseError } from '../../infrastructure/expense-void-blocker';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import {
  reconcileExpenseVat,
  validateExpenseVatSourceInput,
  vatSourceFromSnapshot,
} from '../../domain/logic/expense-vat-reconciliation.logic';
import { validateExpenseDraftAmounts, validateExpenseLineVatTreatments } from '../../domain/logic/expense-draft-amount-validation.logic';
import { expenseVendorIdentityFields } from '../../domain/logic/expense-vendor-identity.logic';
import { readBuyerAsPrinted, recheckBuyerAsPrinted, stampClaimStatusBeforeMark } from '../../domain/logic/buyer-as-printed.logic';
import { EnsureVendorCounterpartyFromExpenseUseCase } from '../../../accounting-documents/application/use-cases/ensure-vendor-counterparty-from-expense.use-case';
import { normalizeExpensePrecisionAdjustment } from '../../domain/logic/expense-precision-adjustment.logic';
import { calcPaymentAmounts, derivePaymentStatus, expenseTotalsIdentityError } from '../../domain/logic/expense-totals.logic';
import { applyExpenseWhtInput, expenseWhtLineRate, expenseWhtHeaderRate } from '../../domain/logic/expense-wht-input.logic';
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
  hasMissingClaimableVatTaxSnapshot,
  isDomesticInputTaxLine,
  validateDomesticInputVatEvidence,
  expenseTaxSourceChecksum,
  firstUnknownVatRateLineNumber,
  readAiCategorySuggestion,
} from '../../domain/logic/expense-status.logic';
import type { ExpenseLineInput, ExpenseRecord, ExpenseRecordWithRelations, PaginatedExpenses } from '../../domain/models/expense.model';
import type { RequestContext, CreateExpenseDraftInput, UpdateExpenseDraftInput, ListExpensesFilter, ExpenseStatus, ExpenseLineChargeKind, ExpenseVatMode, ExpenseVatSourceOverrideInput, RecordExpensePaymentInput } from '@watchdog-bms/contracts';
import { expenseDocumentReviewFieldsComplete, isCalculatedExpenseRounding, type ExpenseDraftTotalsPreview, expenseVatReconciliationMessage, isBlockingExpenseVatReconciliation, validateExpenseWhtInput } from '@watchdog-bms/contracts';
import { ExpenseTransactionTaxService, type ExpenseTaxLineSelection } from '../services/expense-transaction-tax.service';
import { RECEIPT_REVIEW_REASONS } from '../services/receipt-ocr-apply.service';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { assertExpenseRootOpen } from '../expense-launch-gate';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { CancelDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/cancel-document-number.use-case';
import { CompanyVatRegistrationUseCase } from '../../../data-model-core/application/use-cases/company-vat-registration.use-case';
import { LEDGER_SEQUENCE_KEY, civilDateToUtcDate, coerceCivilDate, utcDateToCivilDate } from '@watchdog-bms/contracts';
import { canVoidExpenseFinancialState, civilPeriodKey, isExpenseVoidReason, todayCivilDate } from '@watchdog-bms/contracts';
import type { AuditLogEntry } from '../../../audit/domain/models/audit-log.model';
import { observeCustomerJourney } from '../../../../common/observability/customer-journey-audit';

function hasPerm(ctx: RequestContext, perm: string): boolean {
  return ctx.permissions.includes(perm);
}

function requirePerm(ctx: RequestContext, perm: string, action: string, refusal?: { code: string; message: string }) {
  if (!hasPerm(ctx, perm)) throw new ForbiddenException(refusal ?? `Missing permission: ${perm} for ${action}`);
}

function sameDecimal(left: unknown, right: unknown): boolean {
  try { return new Decimal(String(left)).eq(String(right)); } catch { return false; }
}

function sameDecimalProduct(total: unknown, quantity: unknown, unitPrice: unknown): boolean {
  try { return new Decimal(String(total)).eq(new Decimal(String(quantity)).mul(String(unitPrice))); } catch { return false; }
}

// 10D branch ABAC: membership branch scope governs reads and writes; null branchId = company-central.
function assertBranchInScope(ctx: RequestContext, branchId: string | null | undefined, refusal?: { code: string; message: string }) {
  if (!isBranchInScope(ctx.scopes ?? {}, branchId)) {
    throw new ForbiddenException(refusal ?? 'Branch is outside your assigned branch scope.');
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
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== 'string' || !PAYMENT_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey))) {
      throw new BadRequestException('Invalid draft idempotency key');
    }
    const canCreate = hasPerm(ctx, 'expense.create') || hasPerm(ctx, 'expense.receipt.upload') || hasPerm(ctx, 'expense.receipt.line_upload');
    if (!canCreate) throw new ForbiddenException('Missing permission: expense.create');
    // One of the two roots of the expenses journey — the manual draft. Guarded here rather than in
    // the controller so every caller of the use case is covered, LINE note capture included.
    await assertExpenseRootOpen(this.launchGate, this.audit, ctx, 'expense.create');
    if (input.inputVatClaimStatus !== undefined) throw new ForbiddenException({ code: 'expense_input_vat_decision_required', message: 'สิทธิภาษีซื้อกำหนดโดยระบบ บันทึกข้อมูลรายจ่ายได้โดยไม่ต้องส่งสิทธิภาษีซื้อ' });
    assertBranchInScope(ctx, input.branchId);
    const branchId = await this.repo.resolveCreateBranchId(ctx.companyId, ctx.scopes ?? {}, input.branchId);

    const vendorIdentity = expenseVendorIdentityFields(input);
    if (vendorIdentity.error) throw new BadRequestException(vendorIdentity.error);

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
      draftIdempotencyKey: input.idempotencyKey ?? ctx.requestId ?? randomUUID(),
      draftReplayScopes: ctx.scopes ?? {},
      draftPayloadHash: canonicalFingerprint({ version: 1, ...input, idempotencyKey: null }),
      assignExpenseNumber: input.captureSource === 'WEB_MANUAL' && expenseDraftNumberingEnabled(),
      branchId: branchId ?? undefined,
      captureSource: input.captureSource,
      expenseDate: civilDateToUtcDate(coerceCivilDate(input.expenseDate)),
      currency: input.currency ?? 'THB',
      vatMode: input.vatMode,
      inputVatClaimStatus: 'NON_CLAIMABLE',
      expenseCategoryId: input.expenseCategoryId,
      accountHintKey: input.accountHintKey,
      note: input.note,
      missingReceiptReason: input.missingReceiptReason,
      createdByUserId: ctx.userId,
      vendorCounterpartyId: input.vendorCounterpartyId,
      ...(vendorIdentity.fields.vendorNameSnapshot && { vendorNameSnapshot: vendorIdentity.fields.vendorNameSnapshot }),
      // An upload draft is created before OCR. Persisting a REVIEWER/NONE source here would make
      // the later OCR result incorrectly lose to a reviewer decision that never happened.
      ...(input.vatSource !== undefined && { vatCaptureSnapshotJson: vat.snapshot }),
      ...(input.whtInput !== undefined && { whtInputJson: { ...input.whtInput, origin: 'REVIEWER' as const } }),
      ...totals,
      whtRemittance: normalizeWhtRemittance(input.whtRemittance, totals.whtAmount),
      outstandingAmount: totals.netPayableAmount,
    }, async (tx, record) => {
      if (lines.length > 0) {
        const prepared = lines.map((l, i) => {
          const reconciled = vat.lines[i]!;
          const t = reconciled.totals;
          return {
            expenseId: record.id, companyId: ctx.companyId, lineNumber: l.lineNumber,
            description: l.description, chargeKind: l.chargeKind ?? null, quantity: l.quantity, unitPrice: l.unitPrice,
            discountAmount: t.discountAmount, taxableAmount: t.taxableAmount,
            vatRate: reconciled.vatRate, vatTreatment: l.vatTreatment ?? null, vatAmount: t.vatAmount,
            whtCategoryCode: l.whtCategoryCode, whtRate: expenseWhtLineRate(input.whtInput, l.whtRate), whtAmount: t.whtAmount,
            lineSubtotalAmount: t.lineSubtotalAmount, lineTotalAmount: t.lineTotalAmount,
            expenseCategoryId: l.expenseCategoryId ?? null, accountHintKey: l.accountHintKey ?? null, taxCategory: l.taxCategory ?? null,
            ...taxSelection(l),
          };
        });
        const resolved = await this.transactionTax.resolveLines(ctx, {
          expenseId: record.id, branchId: branchId ?? undefined, expenseDate: input.expenseDate, currency: input.currency ?? 'THB',
        }, prepared, 'DRAFT', tx);
        assertExpenseTotalsIdentity(input.vatMode, resolved, totals);
        await this.repo.upsertLines(ctx.companyId, record.id, resolved, tx);
      }

      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.create', targetType: 'expense_record', targetId: record.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { captureSource: input.captureSource, grandTotalAmount: totals.grandTotalAmount } }, tx);
    }, undefined, input.whtRemittance === 'E_WHT' ? async (tx) => {
      const setting = await this.repo.getEWhtSetting(ctx.companyId, tx);
      if (!eWhtRemittanceAllowed({ requested: input.whtRemittance, shopUsesEWht: setting.used })) {
        throw new UnprocessableEntityException({ code: 'expense_e_wht_not_enabled', message: E_WHT_WORDS['S-8'] });
      }
    } : undefined);
    return record;
  }
}

@Injectable()
export class GetExpenseUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly people?: PrismaDisbursementVoucherRepository) {}

  inputVatRight(ctx: RequestContext, expenseId: string) { return this.repo.inputVatRight(ctx.companyId, expenseId); }

  async reviewRequest(ctx: RequestContext, expense: ExpenseRecord) {
    if (!expense.requestedReviewerUserId || !expense.submittedByUserId || !expense.submittedAt || !this.people) return null;
    const names = await this.people.memberNames(ctx.companyId, [expense.requestedReviewerUserId, expense.submittedByUserId]);
    return { requestedReviewerUserId: expense.requestedReviewerUserId, requestedReviewerName: names.get(expense.requestedReviewerUserId) ?? 'ผู้ตรวจ',
      submittedByUserId: expense.submittedByUserId, submittedByName: names.get(expense.submittedByUserId) ?? 'ผู้ส่ง', submittedAt: expense.submittedAt.toISOString() };
  }

  async execute(ctx: RequestContext, expenseId: string): Promise<ExpenseRecordWithRelations> {
    const freeExpenseDrafts = await expenseDraftAccess(ctx, this.repo.commercialAccessDb);
    const canRead = hasPerm(ctx, 'expense.read') || hasPerm(ctx, 'expense.review') || hasPerm(ctx, 'expense.confirm');
    const canReadOwn = hasPerm(ctx, 'expense.read_own');
    const canReadRelated = hasPerm(ctx, 'expense.read_related');
    const canReadCreated = hasPerm(ctx, 'expense.create') || hasPerm(ctx, 'expense.receipt.upload') || hasPerm(ctx, 'expense.receipt.line_upload');
    if (!canRead && !canReadOwn && !canReadRelated && !canReadCreated) throw new ForbiddenException('Missing permission to read expenses');
    const r = await this.repo.findByIdWithRelations(ctx.companyId, expenseId, undefined, ctx.scopes ?? {});
    if (!r) throw new NotFoundException(`Expense ${expenseId} not found`);
    assertBranchInScope(ctx, r.branchId);
    if (freeExpenseDrafts && !SOURCE_DRAFT_MUTABLE_STATUSES.includes(r.status)) throw new ForbiddenException('Free access is limited to source drafts.');
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

  /** The name of the category a record `execute` just let this caller read is filed under — what the
   *  web detail shows beside it. An archived category still names its expenses; none is null. */
  async categoryName(ctx: RequestContext, expense: Pick<ExpenseRecord, 'expenseCategoryId'>): Promise<string | null> {
    if (!expense.expenseCategoryId) return null;
    return (await this.repo.listCategoryNames(ctx.companyId, [expense.expenseCategoryId]))[0]?.name ?? null;
  }

  correctionCapabilities(ctx: RequestContext, expenseId: string) {
    const canRead = hasPerm(ctx, 'expense.read') || hasPerm(ctx, 'expense.review');
    return this.repo.expenseCorrectionCapabilities(ctx.companyId, expenseId, ctx.permissions, ctx.authProvider === 'line' ? undefined : {
      companyId: ctx.companyId, scopes: ctx.scopes ?? {},
      ...(!canRead && hasPerm(ctx, 'expense.read_related') ? { relatedUserId: ctx.userId } : !canRead ? { createdByUserId: ctx.userId } : {}),
    });
  }

  async correctionHistory(ctx: RequestContext, expense: ExpenseRecordWithRelations) {
    const history = await this.repo.findCorrectionHistory(ctx.companyId, expense.id, expense.payments.filter(p => p.status === 'VOIDED').map(p => p.id));
    const full = hasPerm(ctx, 'expense.read') || hasPerm(ctx, 'expense.review');
    const coverage = await this.repo.paymentDisbursements(expense, { companyId: ctx.companyId, scopes: ctx.scopes ?? {},
      ...(!full && hasPerm(ctx, 'expense.read_related') ? { relatedUserId: ctx.userId } : !full ? { createdByUserId: ctx.userId } : {}) }, ctx.authProvider === 'line' ? [] : ctx.permissions);
    return {
      correctionOpenedAt: ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status) ? history.reopenedAt?.toISOString() ?? null : null,
      payments: expense.payments.map(payment => ({ ...payment, ...coverage.get(payment.id), cancellationReason: history.cancellationReasons.get(payment.id) ?? null })),
    };
  }

  async sourceDraft(ctx: RequestContext, expense: ExpenseRecordWithRelations) {
    const freeExpenseDrafts = await expenseDraftAccess(ctx, this.repo.commercialAccessDb);
    if (expense.captureSource !== 'LINE_UPLOAD' && !(freeExpenseDrafts && expense.captureSource === 'WEB_UPLOAD')) return null;
    const state = sourceDraftState(expense, await this.repo.listCategories(ctx.companyId));
    if (!state) return null;
    // Keep legacy read responses aligned with the current collection rule without writing on GET.
    // In particular, a retired D-PURPOSE question must not survive in the AI summary beside the
    // normalized source projection and re-arm a client-side blocker.
    expense.aiVerificationSummaryJson = sourceDraftSummary(expense.aiVerificationSummaryJson, state);
    const permitted = (!freeExpenseDrafts && hasPerm(ctx, 'expense.review')) || (expense.createdByUserId === ctx.userId
      && ['expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload'].some((permission) => hasPerm(ctx, permission)));
    const active = permitted && await this.repo.findActiveMemberIdentity(ctx.companyId, ctx.userId, expense.branchId);
    return projectExpenseSourceDraft(state, Boolean(active) && SOURCE_DRAFT_MUTABLE_STATUSES.includes(expense.status));
  }
}

@Injectable()
export class GetExpenseHistoryUseCase {
  constructor(private readonly get: GetExpenseUseCase, private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, expenseId: string, page = 1): Promise<import('@watchdog-bms/contracts').ExpenseHistoryResult> {
    const expense = await this.get.execute(ctx, expenseId);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) {
      throw new BadRequestException('Invalid expense history page');
    }
    const [history, creatorDisplayName] = await Promise.all([
      this.repo.listExpenseHistory(ctx.companyId, expenseId, page),
      this.repo.findMemberDisplayName(ctx.companyId, expense.createdByUserId),
    ]);
    return { ...history, creatorDisplayName };
  }
}

@Injectable()
export class ListExpensesUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, filter: Omit<ListExpensesFilter, 'companyId'>): Promise<PaginatedExpenses> {
    const freeExpenseDrafts = await expenseDraftAccess(ctx, this.repo.commercialAccessDb);
    const scope = this.readScope(ctx, filter.branchId);
    const page = Number.isFinite(filter.page) ? Math.max(1, Math.floor(filter.page!)) : 1;
    const pageSize = Number.isFinite(filter.pageSize) ? Math.min(200, Math.max(1, Math.floor(filter.pageSize!))) : 20;
    const resolved: ListExpensesFilter = { ...filter, companyId: ctx.companyId, page, pageSize, ...scope.filter };
    return this.repo.listExpenses(resolved, ctx.scopes, scope.scope.relatedUserId, freeExpenseDrafts);
  }

  async readReportSummary(ctx: RequestContext, filter: { fromDate?: string; toDate?: string; branchId?: string }) {
    const scope = this.readScope(ctx, filter.branchId);
    return this.repo.readReportSummary({ ...filter, companyId: ctx.companyId, ...scope.filter }, scope.scope);
  }

  async readAiSummary(
    ctx: RequestContext,
    filter: Omit<import('../../infrastructure/prisma-expense.repository').AiExpenseReadFilter, 'companyId'>,
    limit: number,
    cursor?: { expenseDate: Date; id: string },
  ) {
    const scope = this.readScope(ctx, filter.branchId);
    const snapshot = await this.repo.readAiExpenseSummary({ ...filter, companyId: ctx.companyId, ...scope.filter }, scope.scope, limit, cursor);
    // Item 1 (spec R-A1 row 18): echo the scope this read already applied, so the caller can state
    // it instead of leaving a correctly-narrowed own/related total looking like the whole company's.
    return { ...snapshot, accessScope: scope.accessScope };
  }

  async readAiBreakdown(
    ctx: RequestContext,
    filter: Omit<import('../../infrastructure/prisma-expense.repository').AiExpenseReadFilter, 'companyId'>,
  ) {
    const scope = this.readScope(ctx, filter.branchId);
    const snapshot = await this.repo.readAiExpenseBreakdown({ ...filter, companyId: ctx.companyId, ...scope.filter }, scope.scope);
    return { ...snapshot, accessScope: scope.accessScope };
  }

  async readAiGroups(
    ctx: RequestContext,
    filter: Omit<import('../../infrastructure/prisma-expense.repository').AiExpenseReadFilter, 'companyId'>,
    groupBy: import('../../infrastructure/prisma-expense.repository').AiExpenseGroupBy,
    limit: number,
    offset: number,
  ) {
    const scope = this.readScope(ctx, filter.branchId);
    return this.repo.readAiExpenseGroups({ ...filter, companyId: ctx.companyId, ...scope.filter }, scope.scope, groupBy, limit, offset);
  }

  /** Company-wide, ACTIVE-only category candidates for `categoryName` resolution (spec §3 row 6) —
   *  categories carry no ABAC beyond the tenant boundary the caller's own permission check already
   *  enforced above. */
  async listCategoryCandidates(companyId: string): Promise<Array<{ id: string; name: string }>> {
    const categories = await this.repo.listCategories(companyId);
    return categories.map((category) => ({ id: category.id, name: category.name }));
  }

  /** The names of the categories expenses were filed under, archived ones included (reports, exports). */
  listCategoryNames(companyId: string, ids: string[]): Promise<Array<{ id: string; name: string }>> {
    return this.repo.listCategoryNames(companyId, ids);
  }

  /** Vendor candidates for `vendorName` resolution, scoped exactly like every other AI read here:
   *  read_own sees only its own createdByUserId, read_related only its actor relation. */
  async readAiVendorCandidates(ctx: RequestContext, branchId?: string): Promise<Array<{ id: string; name: string }>> {
    const scope = this.readScope(ctx, branchId);
    return this.repo.readAiVendorCandidates({ companyId: ctx.companyId, ...(branchId ? { branchId } : {}), ...scope.filter }, scope.scope);
  }

  readScope(ctx: RequestContext, branchId?: string) {
    const accessScope = expenseListReadScope(ctx);
    if (!accessScope) throw new ForbiddenException('Missing permission to read expenses');
    if (branchId) assertBranchInScope(ctx, branchId);
    return {
      filter: accessScope === 'own' ? { createdByUserId: ctx.userId } : {},
      scope: {
        branchIds: ctx.scopes?.branchIds,
        ...(accessScope === 'related' ? { relatedUserId: ctx.userId } : {}),
      },
      accessScope,
    };
  }
}

type UpdateExpenseDraftOptions = {
      db?: any;
      suppressGenericAudit?: boolean;
      /** Internal caller-owned transactional audits receive the same persisted field diff. */
      onHistoryChanges?: (changes: ExpenseHistoryChanges) => void;
      requireExpectedUpdatedAt?: boolean;
      /** Internal authority, after the certificate use case checks creator and exact review-only payload. */
      ownSubstituteReceiptReview?: boolean;
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
  // `ensureVendorCounterparty` is optional so the many bare-constructed unit tests in this module
  // keep working: an expense save must not depend on the registry being wired (§8 — the registry
  // never fails the expense).
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService, private readonly transactionTax: ExpenseTransactionTaxService,
    private readonly ensureVendorCounterparty?: EnsureVendorCounterpartyFromExpenseUseCase) {}

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
    const freeExpenseDrafts = await expenseDraftAccess(ctx, this.repo.commercialAccessDb);
    // Capture explicit intent before source/financial synchronization can supply stored values.
    const dateReviewInput = input.sourceDraft?.expenseDate !== undefined ? input.sourceDraft.expenseDate : input.expenseDate || undefined;
    const r = await this.repo.findById(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException(`Expense ${expenseId} not found`);
    assertBranchInScope(ctx, r.branchId);
    if (input.branchId !== undefined) assertBranchInScope(ctx, input.branchId);

    const canReview = !freeExpenseDrafts && (hasPerm(ctx, 'expense.review') || options.ownSubstituteReceiptReview === true);
    const isOwner = r.createdByUserId === ctx.userId;
    if (freeExpenseDrafts) {
      const allowed = new Set(['expectedUpdatedAt', 'sourceDraft', 'expenseDate', 'vendorNameSnapshot', 'vendorTaxIdSnapshot',
        'vendorBranchCodeSnapshot', 'vendorBranchNameSnapshot', 'vendorAddressSnapshot', 'note', 'lines', 'vatMode', 'vatSource', 'whtInput', 'receiptNumber']);
      if (!isOwner || !SOURCE_DRAFT_MUTABLE_STATUSES.includes(r.status)
        || !['LINE_UPLOAD', 'WEB_UPLOAD'].includes(r.captureSource)
        || Object.keys(input).some((field) => !allowed.has(field))
        || !await this.repo.findActiveMemberIdentity(ctx.companyId, ctx.userId, r.branchId)) {
        throw new ForbiddenException({ code: 'FREE_EXPENSE_DRAFTS_ONLY', message: 'แก้ไขได้เฉพาะข้อมูลร่างรายจ่ายของตนเอง' });
      }
      if (input.lines?.some(line => hasSelectedTaxCode(taxSelection(line)))) {
        throw new ForbiddenException('Free source drafts cannot select tax codes.');
      }
      options = { ...options, requireExpectedUpdatedAt: true };
    }
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
      if (!(r.captureSource === 'LINE_UPLOAD' || freeExpenseDrafts && r.captureSource === 'WEB_UPLOAD') || !sourceStatusMutable
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
      && (r.captureSource === 'LINE_UPLOAD' || freeExpenseDrafts && r.captureSource === 'WEB_UPLOAD')
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
    // The LINE certificate continuation supplies this fixed value itself, never from chat input.
    // Discard it: the evidence route below and repository own this system answer.
    if (ctx.authProvider === 'line' && input.evidenceAssessment?.route === 'SUBSTITUTE_RECEIPT'
      && input.inputVatClaimStatus === 'NON_CLAIMABLE') {
      const { inputVatClaimStatus: _systemRight, ...reviewInput } = input;
      input = reviewInput;
    }
    const financeOnlyFields: Array<keyof UpdateExpenseDraftInput> = [
      'sourceDocumentType', 'sourceDocumentLanguage', 'taxEvidenceStatus', 'taxEvidenceReasonCode', 'inputVatClaimStatus',
      'whtRemittance', 'expenseCategoryId', 'accountHintKey', 'taxCategory', 'nonExpenseClassificationOverride', 'documentReviewAcknowledged', 'evidenceAssessment',
    ];
    if (!canReview && !canCollectOwnLineDraft && financeOnlyFields.some((field) => input[field] !== undefined)) {
      throw new ForbiddenException('Missing permission: expense.review for document, tax, or accounting classification fields.');
    }
    if (input.inputVatClaimStatus !== undefined) {
      const buyer = readBuyerAsPrinted(r.buyerAsPrintedJson);
      const isMark = input.inputVatClaimStatus === 'NON_CLAIMABLE' && buyer?.matchStatus === 'MISMATCH';
      const isUndo = buyer?.claimStatusBeforeMark === input.inputVatClaimStatus;
      if (!canReview || (!isMark && !isUndo)) throw new ForbiddenException({ code: 'expense_input_vat_decision_required', message: 'สิทธิภาษีซื้อกำหนดโดยระบบ บันทึกข้อมูลรายจ่ายได้โดยไม่ต้องส่งสิทธิภาษีซื้อ' });
    }
    if (!['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(r.status)) {
      throw new BadRequestException(`Cannot update expense in status ${r.status}`);
    }
    // CON-11 puts the address under exactly this status gate and, in the repository, the same
    // material-field funding lock as the other vendor columns — no rule of its own.
    const vendorIdentity = expenseVendorIdentityFields(input);
    if (vendorIdentity.error) throw new BadRequestException(vendorIdentity.error);
    if (vendorIdentity.fields.vendorNameSnapshot !== undefined) input = { ...input, vendorNameSnapshot: vendorIdentity.fields.vendorNameSnapshot };
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
    let nextSourceDocumentType = input.sourceDocumentType ?? r.sourceDocumentType;
    let nextTaxEvidenceStatus = input.taxEvidenceStatus ?? r.taxEvidenceStatus;
    if (input.evidenceAssessment !== undefined || input.documentReviewAcknowledged) {
      const source = await this.repo.findByIdWithRelations(ctx.companyId, expenseId, options.db, ctx.scopes ?? {});
      if (!source) throw new NotFoundException();
      const assessment = input.evidenceAssessment ?? expenseEvidenceAssessment(source);
      if ((assessment?.receiptProblem === 'NOT_AVAILABLE' || assessment?.receiptProblem === 'LOST')
        && !(ctx.authProvider === 'line' && assessment.route === 'SUBSTITUTE_RECEIPT' && nextSourceDocumentType !== 'NEEDS_REVIEW')) {
        nextSourceDocumentType = 'EXPENSE_NOTE_TEXT';
        nextTaxEvidenceStatus = 'SUPPORTING_ONLY';
        input = { ...input, sourceDocumentType: nextSourceDocumentType, taxEvidenceStatus: nextTaxEvidenceStatus };
      }
      const error = expenseEvidenceInputError(assessment, { ...source, sourceDocumentType: nextSourceDocumentType,
        taxEvidenceStatus: nextTaxEvidenceStatus, inputVatClaimStatus: assessment?.route === 'SUBSTITUTE_RECEIPT' || assessment?.route === 'ALTERNATIVE_EVIDENCE' ? 'NON_CLAIMABLE' : input.inputVatClaimStatus ?? source.inputVatClaimStatus }, Boolean(input.documentReviewAcknowledged));
      if (error) throw new BadRequestException({ code: 'EXPENSE_EVIDENCE_REVIEW_REQUIRED', message: error });
    }
    if (input.documentReviewAcknowledged !== undefined) {
      if (input.documentReviewAcknowledged !== true || !expenseDocumentReviewFieldsComplete({
        sourceDocumentType: nextSourceDocumentType, taxEvidenceStatus: nextTaxEvidenceStatus,
      })) throw new BadRequestException({ code: 'EXPENSE_DOCUMENT_REVIEW_INCOMPLETE', message: 'เลือกประเภทเอกสารและสถานะหลักฐานภาษีให้ครบก่อนบันทึกการตรวจ' });
      if (!expectedUpdatedAt) throw new BadRequestException({ code: 'EXPENSE_UPDATE_VERSION_REQUIRED', message: 'expectedUpdatedAt is required.' });
    }
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
          whtCategoryCode: l.whtCategoryCode ?? stored?.whtCategoryCode, whtRate: expenseWhtLineRate(whtInput, l.whtRate), whtAmount: t.whtAmount, lineSubtotalAmount: t.lineSubtotalAmount,
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

    const whtRemittance = input.whtRemittance !== undefined || totals ? normalizeWhtRemittance(
      input.whtRemittance === undefined ? r.whtRemittance : input.whtRemittance, totals?.whtAmount ?? r.whtAmount,
    ) : undefined;
    const nextWhtRemittance = whtRemittance === undefined ? r.whtRemittance : whtRemittance;
    if (nextWhtRemittance === 'E_WHT') await this.repo.assertEWhtRemittancePayments(ctx.companyId, expenseId, nextWhtRemittance, options.db);
    if (input.whtRemittance === 'E_WHT') {
      const setting = await this.repo.getEWhtSetting(ctx.companyId, options.db);
      if (!eWhtRemittanceAllowed({ requested: input.whtRemittance, stored: r.whtRemittance, shopUsesEWht: setting.used })) {
        throw new UnprocessableEntityException({ code: 'expense_e_wht_not_enabled', message: E_WHT_WORDS['S-8'] });
      }
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
      ? (classification as Record<string, unknown>)['documentKind'] as string
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

    // Spec §16.4: `sourceStale` says "these values were read from the file that was replaced —
    // check them against the new one". A review save IS that check, by the person the flag was
    // addressed to, so it is dropped here rather than warning forever over confirmed values.
    if (r.aiVerificationSummaryJson?.['sourceStale'] === true) {
      const { sourceStale: _stale, ...checked } = (nextSummaryJson ?? r.aiVerificationSummaryJson) as Record<string, unknown>;
      nextSummaryJson = checked;
    }

    if (input.evidenceAssessment) {
      nextSummaryJson = { ...(nextSummaryJson ?? r.aiVerificationSummaryJson), documentEvidenceDraft: input.evidenceAssessment };
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
    /**
     * D4/§7: the registry grows from the save the reviewer just made, so this runs BEFORE the write
     * and folds its two answers into the same statement — no second round trip, and the record the
     * caller gets back already carries the link.
     *
     * Skipped when `options.db` is set: that caller owns the transaction and `line-draft-update`
     * deliberately ROLLS IT BACK for its preview. A counterparty written on this separate
     * connection would survive that rollback and leave a shop nobody saved. That lane only patches
     * line amounts, never vendor identity, so nothing is lost by sitting it out.
     */
    const vendorRegistry = freeExpenseDrafts || [r.sourceDocumentType, nextSourceDocumentType, detectedDocumentKind].includes('TRANSFER_SLIP')
      ? undefined : this.ensureVendorCounterparty;
    const receiptUploaderUserId = !options.db && vendorRegistry && r.primaryAttachmentId
      ? await this.repo.findPrimaryReceiptUploader(ctx.companyId, expenseId, r.primaryAttachmentId)
      : null;
    const autoSave = options.db || !vendorRegistry
      ? undefined
      : await vendorRegistry.execute(ctx, {
        expenseId,
        sourceDocumentType: nextSourceDocumentType,
        ocrDocumentType: detectedDocumentKind,
        captureSource: r.captureSource,
        sourceReimbursementRequestId: r.sourceReimbursementRequestId,
        vendorCounterpartyId: input.vendorCounterpartyId !== undefined ? input.vendorCounterpartyId : r.vendorCounterpartyId,
        vendorName: input.vendorNameSnapshot ?? r.vendorNameSnapshot,
        vendorTaxId: input.vendorTaxIdSnapshot ?? r.vendorTaxIdSnapshot,
        vendorBranchCode: vendorIdentity.fields.vendorBranchCodeSnapshot !== undefined
          ? vendorIdentity.fields.vendorBranchCodeSnapshot : r.vendorBranchCodeSnapshot,
        vendorAddressText: vendorIdentity.fields.vendorAddressSnapshot !== undefined
          ? vendorIdentity.fields.vendorAddressSnapshot : r.vendorAddressSnapshot,
        vendorEntityKind: input.vendorEntityKindSnapshot ?? r.vendorEntityKindSnapshot,
        ...(receiptUploaderUserId ? { receiptUploaderUserId } : {}),
      });
    /**
     * Slice 2 (§5 row 2): re-check the printed buyer block against the company registry and the
     * expense branch AS THEY ARE NOW, on every save that has a block to check. A draft read before the
     * column existed still carries the block in `aiVerifiedFieldsJson`, which is how it gets checked
     * without a backfill script. Never touches claimability (E11) — the column is all this writes.
     */
    const claimStatusWrite = !options.lineDraftCollection ? input.inputVatClaimStatus : undefined;
    const buyerSource = r.buyerAsPrintedJson ?? r.aiVerifiedFieldsJson?.['buyerAsPrinted'];
    const buyerAsPrintedJson = buyerSource ? stampClaimStatusBeforeMark(await recheckBuyerAsPrinted({
      printed: buyerSource,
      previous: r.buyerAsPrintedJson,
      readRegistry: () => this.repo.getSubstituteCompanyContext(ctx.companyId, input.branchId !== undefined ? input.branchId : r.branchId),
      checkedAt: new Date().toISOString(),
    }), {
      // Review fix 2: the mark is the person's explicit NON_CLAIMABLE on a claim-capable document;
      // the status it replaces rides the same write so the banner can offer it back.
      previous: readBuyerAsPrinted(r.buyerAsPrintedJson),
      previousClaimStatus: r.inputVatClaimStatus,
      nextClaimStatus: claimStatusWrite ?? r.inputVatClaimStatus,
      marked: input.inputVatClaimStatus === 'NON_CLAIMABLE' && !disallowsTaxCode,
    }) : undefined;

    let historyChanges: ExpenseHistoryChanges = {};
    const updated = await this.repo.updateExpense({
      id: expenseId, companyId: ctx.companyId, updatedByUserId: ctx.userId,
      assignExpenseNumber: Boolean(dateReviewInput) && expenseDraftNumberingEnabled()
        && (ctx.authProvider !== 'line' || (options.lineDraftCollection?.sourceChannelMetadataJson[EXPENSE_SOURCE_DRAFT_KEY] as { provenance?: Record<string, { source: string }> } | undefined)?.provenance?.['D-DATE']?.source === 'LINE_USER_TEXT'),
      ...(ctx.authProvider !== 'line' ? { refreshSubstituteEvidence: { requestId: ctx.requestId } } : {}),
      ...(reopenSourceReview && { status: 'NEEDS_REVIEW' }),
      ...(expectedUpdatedAt && { expectedUpdatedAt }),
      ...(input.branchId !== undefined && { branchId: input.branchId }),
      ...(input.expenseDate && { expenseDate: civilDateToUtcDate(coerceCivilDate(input.expenseDate)) }),
      ...(input.vatMode && { vatMode: input.vatMode }),
      ...(claimStatusWrite && { inputVatClaimStatus: claimStatusWrite }),
      ...(input.vendorCounterpartyId !== undefined && { vendorCounterpartyId: input.vendorCounterpartyId }),
      ...(input.vendorNameSnapshot !== undefined && { vendorNameSnapshot: input.vendorNameSnapshot }),
      ...(input.vendorTaxIdSnapshot !== undefined && { vendorTaxIdSnapshot: input.vendorTaxIdSnapshot }),
      // CON-8/§6: these two normalize before they persist — blank is NULL, a branch code is five
      // digits. Everything else on this list is stored exactly as it arrived.
      ...vendorIdentity.fields,
      ...(input.vendorEntityKindSnapshot !== undefined && { vendorEntityKindSnapshot: input.vendorEntityKindSnapshot }),
      // WHT certificate system issuance plan §1.2 (S2/S3): the income-category classification a 50
      // ทวิ certificate needs, same "captured at review" treatment as vendorEntityKindSnapshot above.
      ...(input.whtCategoryCode !== undefined && { whtCategoryCode: input.whtCategoryCode }),
      ...((resolvedLines || input.whtInput !== undefined || input.whtRate !== undefined) && {
        whtRate: expenseWhtHeaderRate(whtInput, resolvedLines, input.whtRate ?? r.whtRate),
      }),
      // GAP-4: the first thing in this codebase that ever fills `vendorCounterpartyId` from web or
      // LINE. CON-7: the registry's taxpayer class fills an empty field, which is what lets a WHT
      // expense be confirmed at all (`expense-status.logic.ts` refuses without it).
      ...(autoSave?.linkCounterpartyId && { vendorCounterpartyId: autoSave.linkCounterpartyId }),
      ...(autoSave?.fillEntityKind && input.vendorEntityKindSnapshot === undefined && { vendorEntityKindSnapshot: autoSave.fillEntityKind }),
      ...(buyerAsPrintedJson && { buyerAsPrintedJson }),
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
      ...(whtRemittance !== undefined && { whtRemittance }),
      ...(totals ? { ...calcPaymentAmounts(totals.netPayableAmount, r.paidAmount ?? '0'), paymentStatus: derivePaymentStatus(totals.netPayableAmount, r.paidAmount ?? '0') } : {}),
    }, resolvedLines || options.transactionalAudit || hasSourceDraft || input.evidenceAssessment || input.documentReviewAcknowledged
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
        if (input.evidenceAssessment || input.documentReviewAcknowledged) {
          const saved = await this.repo.findByIdWithRelations(ctx.companyId, expenseId, tx, ctx.scopes ?? {});
          if (!saved) throw new NotFoundException();
          const assessment = input.evidenceAssessment ?? expenseEvidenceAssessment(saved);
          const error = expenseEvidenceInputError(assessment, saved, Boolean(input.documentReviewAcknowledged));
          if (error) throw new BadRequestException({ code: 'EXPENSE_EVIDENCE_REVIEW_REQUIRED', message: error });
          if (input.documentReviewAcknowledged) {
            nextSummaryJson = { ...saved.aiVerificationSummaryJson, documentEvidenceDraft: assessment, documentReview: {
              version: 2, reviewedAt: reviewedAt!.toISOString(), reviewedByUserId: ctx.userId,
              assessment, fingerprint: expenseEvidenceFingerprint(saved, assessment!),
            } };
            await this.repo.updateExpense({ id: expenseId, companyId: ctx.companyId, updatedByUserId: ctx.userId,
              aiVerificationSummaryJson: nextSummaryJson, updatedAt: saved.updatedAt }, undefined, tx);
            await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId,
              action: 'expense.evidence.review', targetType: 'expense_record', targetId: expenseId,
              requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
              metadataJson: { documentReview: nextSummaryJson.documentReview } }, tx);
          }
        }
      }
      : undefined, options.db, !options.suppressGenericAudit || options.transactionalAudit || options.onHistoryChanges
        ? async (tx, before, after) => {
          historyChanges = expenseHistoryChanges(before, after);
          options.onHistoryChanges?.(historyChanges);
          if (options.transactionalAudit) await this.audit.log({ ...options.transactionalAudit,
            metadataJson: { ...options.transactionalAudit.metadataJson, expenseHistoryChanges: historyChanges } }, tx);
        } : undefined);
    if (nextSummaryJson) updated.aiVerificationSummaryJson = nextSummaryJson;
    // Before the `suppressGenericAudit` early return, so the LINE lanes carry it too. §8: when the
    // registry write failed the expense still saved, and the caller has to be able to say so.
    if (autoSave && autoSave.result.case !== 'SKIPPED') updated.vendorCounterpartyAutoSave = autoSave.result;
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
      metadataJson: {
        expenseHistoryChanges: historyChanges,
        ...(input.documentReviewAcknowledged && { documentReview: nextSummaryJson?.documentReview }),
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
      receiptWaivedByPolicy?: boolean;
      systemReconcile?: boolean;
    },
    db?: ExpenseDb,
  ): Promise<ExpenseRecord> {
    return this.confirm(ctx, expenseId, authority, undefined, db);
  }

  private async confirm(
    ctx: RequestContext,
    expenseId: string,
    authority?: {
      reimbursementRequestId: string;
      reimbursementLineId: string;
      branchId?: string;
      allowMissingReceiptWithReason: boolean;
      receiptWaivedByPolicy?: boolean;
      systemReconcile?: boolean;
    },
    vatSourceOverride?: ExpenseVatSourceOverrideInput,
    db?: ExpenseDb,
  ): Promise<ExpenseRecord> {
    return observeCustomerJourney(
      this.audit,
      {
        key: 'expense-confirmation', requestId: ctx.requestId ?? `expense:${expenseId}:confirm`,
        targetType: 'expense_record', targetId: expenseId, companyId: ctx.companyId, actorUserId: ctx.userId,
      },
      () => this.confirmMutation(ctx, expenseId, authority, vatSourceOverride, db),
      () => ({ outcome: 'confirmed' }),
    );
  }

  /** Only the signed LINE postback calls this entry; ordinary LINE execute remains refused. */
  async executeLineConfirmed(ctx: RequestContext, expenseId: string, expectedUpdatedAt: Date): Promise<ExpenseRecord> {
    return this.confirmMutation(ctx, expenseId, undefined, undefined, undefined, { expectedUpdatedAt });
  }

  /** Same validators as execution, stopping before numbering, tax writes, audit and outbox. */
  async previewLineAction(ctx: RequestContext, expenseId: string, evidenceReview?: ExpenseEvidenceAssessment, markReady = false, previewSource?: ExpenseRecordWithRelations): Promise<ExpenseRecord> {
    const ready = markReady ? await new MarkExpenseReadyUseCase(this.repo).previewLineAction(ctx, expenseId, previewSource) : undefined;
    return this.confirmMutation(ctx, expenseId, undefined, undefined, undefined, { previewOnly: true, evidenceReview,
      previewSource,
      ...(ready?.target === 'READY_FOR_CONFIRMATION' ? { readyRevision: ready.record.updatedAt } : {}) });
  }

  private async confirmMutation(
    ctx: RequestContext,
    expenseId: string,
    authority?: {
      reimbursementRequestId: string;
      reimbursementLineId: string;
      branchId?: string;
      allowMissingReceiptWithReason: boolean;
      receiptWaivedByPolicy?: boolean;
      systemReconcile?: boolean;
    },
    vatSourceOverride?: ExpenseVatSourceOverrideInput,
    db?: ExpenseDb,
    lineConfirmation?: { previewOnly?: boolean; expectedUpdatedAt?: Date; evidenceReview?: ExpenseEvidenceAssessment; readyRevision?: Date; previewSource?: ExpenseRecordWithRelations },
  ): Promise<ExpenseRecord> {
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    if (!authority) {
      requirePerm(ctx, 'expense.confirm', 'confirm expense');
      if (ctx.authProvider === 'line' && !lineConfirmation) throw new ForbiddenException('Expense confirmation is available on the authenticated web only.');
    }
    const source = await this.repo.findByIdWithRelations(ctx.companyId, expenseId, db);
    if (!source) throw new NotFoundException(`Expense ${expenseId} not found`);
    let r = source;
    // Internal composition only: a rolled-back UpdateExpenseDraftUseCase result, never HTTP input.
    if (lineConfirmation?.previewOnly && lineConfirmation.previewSource) {
      const projected = lineConfirmation.previewSource;
      if (projected.id !== source.id || projected.companyId !== source.companyId || projected.updatedAt.getTime() !== source.updatedAt.getTime()) throw new ConflictException('expense_confirmation_source_version_changed');
      r = projected;
    }
    if (lineConfirmation?.previewOnly && lineConfirmation.readyRevision) {
      if (r.updatedAt.getTime() !== lineConfirmation.readyRevision.getTime()) throw new ConflictException('expense_confirmation_source_version_changed');
      r = { ...r, status: 'READY_FOR_CONFIRMATION' };
    }
    if (lineConfirmation?.expectedUpdatedAt && r.updatedAt.getTime() !== lineConfirmation.expectedUpdatedAt.getTime()) throw new ConflictException('expense_confirmation_source_version_changed');
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
    if (r.status === 'CONFIRMED') return r;
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
    // Claim projections use the approved claim's evidence through the exact authority checked above.
    // Finance materialization has no separate expense-review screen. Source snapshots are checked
    // again inside the transaction; missing-receipt permission remains a separate validation below.
    // An expense that entered the substitute-receipt flow still needs its own artifact.
    const evidenceCoveredByClaimForm = Boolean(authority)
      && !r.substituteReceiptGeneratedAt && r.sourceDocumentType !== 'SUBSTITUTE_RECEIPT';
    if (lineConfirmation?.previewOnly && lineConfirmation.evidenceReview) {
      requirePerm(ctx, 'expense.review', 'review expense evidence');
      const assessment = lineConfirmation.evidenceReview;
      const error = expenseEvidenceInputError(assessment, r, true);
      if (error) throw new BadRequestException({ code: 'EXPENSE_EVIDENCE_REVIEW_REQUIRED', message: error });
      // Read-only simulation: the button still saves through UpdateExpenseDraftUseCase before confirming.
      r = { ...r, aiVerificationSummaryJson: { ...r.aiVerificationSummaryJson, documentEvidenceDraft: assessment,
        documentReview: { version: 2, reviewedAt: new Date().toISOString(), reviewedByUserId: ctx.userId,
          assessment, fingerprint: expenseEvidenceFingerprint(r, assessment) } } };
    }
    const evidenceError = expenseEvidenceConfirmationError(r, evidenceCoveredByClaimForm);
    if (evidenceError) throw new BadRequestException({ code: 'EXPENSE_EVIDENCE_REVIEW_REQUIRED', message: evidenceError });
    const reviewedEvidence = hasCurrentExpenseEvidenceReview(r);
    const reviewedAttachmentId = reviewedEvidence ? expenseEvidenceAssessment(r)?.attachmentIds[0] ?? r.primaryAttachmentId : r.primaryAttachmentId;
    if (r.substituteReceiptEvidence?.status === 'ISSUED'
      && (r.taxEvidenceStatus !== 'SUPPORTING_ONLY' || r.inputVatClaimStatus === 'CLAIMABLE')) {
      throw new BadRequestException('Internal substitute evidence must remain supporting-only and non-claimable for input VAT.');
    }

    const validationErr = validateConfirm({
      status: r.status,
      duplicateStatus: r.duplicateStatus,
      primaryAttachmentId: reviewedAttachmentId,
      missingReceiptReason: r.missingReceiptReason,
      vendorNameSnapshot: r.vendorNameSnapshot,
      vendorDocumentNumber: r.vendorDocumentNumber,
      expenseDate: r.expenseDate?.toISOString() ?? null,
      grandTotalAmount: r.grandTotalAmount,
      whtAmount: r.whtAmount,
      vendorEntityKindSnapshot: r.vendorEntityKindSnapshot,
      whtCategoryCode: r.whtCategoryCode,
      vatMode: r.vatMode,
      inputVatClaimStatus: r.inputVatClaimStatus,
      hasMissingReceiptPermission: authority?.allowMissingReceiptWithReason ?? hasPerm(ctx, 'expense.review'),
      hasReviewedEvidence: reviewedEvidence,
      hasLinkedClaimEvidence: Boolean(authority && (authority.receiptWaivedByPolicy || r.sourceChannelMetadataJson?.reimbursementSource)),
      aiVerifiedFieldsJson: r.aiVerifiedFieldsJson,
      aiVerificationSummaryJson: r.aiVerificationSummaryJson,
    });
    if (validationErr) throw new BadRequestException(validationErr);

    const taxEvidenceErr = validateDomesticInputVatEvidence({ aiVerificationSummaryJson: r.aiVerificationSummaryJson, sourceDocumentType: r.sourceDocumentType,
      taxEvidenceStatus: r.taxEvidenceStatus, inputVatClaimStatus: r.inputVatClaimStatus,
      ...(r.inputVatClaimStatus === 'CLAIMABLE' && { vatStatus: r.expenseDate ? (await this.vatRegistration.get(ctx.companyId, utcDateToCivilDate(r.expenseDate))).status : 'UNKNOWN' as const }),
      primaryAttachmentId: reviewedAttachmentId, vendorTaxIdSnapshot: r.vendorTaxIdSnapshot,
      vendorDocumentNumber: r.vendorDocumentNumber, lines: r.lines ?? [] });
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

    if (lineConfirmation?.previewOnly) return r;
    const postingStatus = derivePostingStatus('CONFIRMED', r.duplicateStatus);
    // §6: the frozen snapshot now carries the branch and the printed address too, so a confirmed
    // expense still says which shop and which address it was, whatever the registry does later.
    const vendorSnapshotJson = r.vendorCounterpartyId ? { id: r.vendorCounterpartyId, name: r.vendorNameSnapshot, taxId: r.vendorTaxIdSnapshot, branchCode: r.vendorBranchCodeSnapshot, addressText: r.vendorAddressSnapshot } : null;
    const occurredAt = new Date().toISOString();
    const eventRequestId = authority
      ? `reimbursement:${authority.reimbursementRequestId}:${authority.reimbursementLineId}`
      : ctx.requestId ?? buildIdempotencyKey(expenseId, 'confirmed');
    let updated: ExpenseRecord;
    let finalized: ExpenseLineInput[];
    ({ expense: updated, finalized } = await this.repo.finalizeAndConfirmExpenseCas({
      id: expenseId, companyId: ctx.companyId, expectedUpdatedAt: r.updatedAt, actorUserId: ctx.userId,
      expectedSourceChecksum: expenseTaxSourceChecksum(r),
      substituteCoveredByClaimForm: Boolean(authority?.allowMissingReceiptWithReason || authority?.receiptWaivedByPolicy) && evidenceCoveredByClaimForm,
      reimbursementReview: authority ? { requestId: authority.reimbursementRequestId, lineId: authority.reimbursementLineId } : undefined,
      vatSourceOverride,
      postingStatus, vendorSnapshotJson,
      confirmationAudit: { requestId: ctx.requestId ?? eventRequestId, ...(authority && { authority: {
        authority: 'REIMBURSEMENT_APPROVAL', reimbursementRequestId: authority.reimbursementRequestId,
        reimbursementLineId: authority.reimbursementLineId, systemReconcile: Boolean(authority.systemReconcile),
      } }) },
      outboxEvent: {
        eventKey: `expense.confirmed:expense_record:${expenseId}:${eventRequestId}`,
        payloadJson: {
          companyId: ctx.companyId, aggregateType: 'expense_record', aggregateId: expenseId,
          requestId: eventRequestId, occurredAt, data: { expenseId, expenseNumber: r.expenseNumber, postingStatus },
        },
      },
    }, async ({ db, expense: current }) => {
      const selectedLines = (current.lines ?? []).filter(hasSelectedTaxCode).map((line) => ({
        expenseId: current.id, companyId: ctx.companyId, lineNumber: line.lineNumber, sourceLineId: line.id,
        description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
        discountAmount: line.discountAmount, taxableAmount: line.taxableAmount,
        vatRate: line.vatRate, vatTreatment: line.vatTreatment ?? null, vatAmount: line.vatAmount, whtCategoryCode: line.whtCategoryCode, whtRate: line.whtRate, whtAmount: line.whtAmount,
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
    }, db));
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
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    requirePerm(ctx, 'expense.reject', 'reject expense');
    const r = await this.repo.findById(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException(`Expense ${expenseId} not found`);
    assertBranchInScope(ctx, r.branchId);
    // A claim's expense record ends with its claim, never on its own: rejected here, the claim could be neither paid nor carried out.
    const claim = r.sourceReimbursementRequestId ? await this.repo.findLiveClaimOf(ctx.companyId, r) : null;
    if (claim) throw claimOwnsExpenseError(claim);
    const err = validateStatusTransition(r.status, 'REJECTED');
    if (err) throw new BadRequestException(err);
    const updated = await this.repo.updateExpense({ id: expenseId, companyId: ctx.companyId, expectedUpdatedAt: r.updatedAt, updatedByUserId: ctx.userId, status: 'REJECTED', rejectedByUserId: ctx.userId, rejectedAt: new Date(), rejectReason: reason, postingStatus: 'not_required' });
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
    private readonly notify?: CreateOrUpdateNotificationEventUseCase,
    @Optional() private readonly disbursementNotices?: DisbursementVoucherNoticeService,
  ) {}

  async execute(ctx: RequestContext, expenseId: string, reason: string, taxFilingAttested?: boolean, expectedUpdatedAt?: Date): Promise<ExpenseRecord> {
    requirePerm(ctx, 'expense.void', 'void expense', { code: 'expense_void_permission_missing', message: EXPENSE_VOID_CERTIFICATE_WORDS.permissionDenied });
    return this.voidExpense(ctx, expenseId, reason, undefined, taxFilingAttested, { expectedUpdatedAt });
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
      cancellationCertificateAttestedAt?: Date;
      cancellationPendingByUserId?: string;
      /**
       * Runs first inside the void transaction. The claim's cancellation checks there that it still
       * holds its intent, so a void never lands on a claim whose cancellation was withdrawn meanwhile.
       */
      beforeVoid?: (tx: any) => Promise<void>;
    },
  ): Promise<ExpenseRecord> {
    return this.voidExpense(ctx, expenseId, reason, authority, !!authority.cancellationCertificateAttestedAt);
  }

  async previewLineAction(ctx: RequestContext, expenseId: string, reason: string): Promise<ExpenseRecord> {
    requirePerm(ctx, 'expense.void', 'void expense');
    return this.voidExpense(ctx, expenseId, reason, undefined, undefined, { previewOnly: true });
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
      cancellationCertificateAttestedAt?: Date;
      cancellationPendingByUserId?: string;
      beforeVoid?: (tx: any) => Promise<void>;
    },
    taxFilingAttested?: boolean,
    lineAction?: { previewOnly?: boolean; expectedUpdatedAt?: Date },
  ): Promise<ExpenseRecord> {
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    if (!isExpenseVoidReason(reason)) throw new BadRequestException({ code: 'expense_void_reason_required', message: EXPENSE_VOID_CERTIFICATE_WORDS.reasonRequired });
    const r = await this.repo.findById(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException({ code: 'expense_correction_not_found', message: EXPENSE_CORRECTION_WORDS.notFound });
    if (authority) {
      if (r.sourceReimbursementRequestId !== authority.reimbursementRequestId
        || r.sourceReimbursementLineId !== authority.reimbursementLineId
        || (r.branchId ?? undefined) !== authority.branchId) {
        throw new ForbiddenException('reimbursement_projection_authority_mismatch');
      }
      if (!authority.systemReconcile) assertBranchInScope(ctx, r.branchId, { code: 'expense_correction_branch_forbidden', message: EXPENSE_CORRECTION_WORDS.branchForbidden });
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
          beforeVoid: authority.beforeVoid,
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
      assertBranchInScope(ctx, r.branchId, { code: 'expense_correction_branch_forbidden', message: EXPENSE_CORRECTION_WORDS.branchForbidden });
      // A claim's expense record is voided by its claim alone: cancelling the claim voids every record of
      // it, checks what would stop that before it starts, and closes the claim with them. Voided from
      // here, the record would leave a claim that can be neither paid nor carried out.
      const claim = r.sourceReimbursementRequestId ? await this.repo.findLiveClaimOf(ctx.companyId, r) : null;
      if (claim) throw claimOwnsExpenseError(claim);
    }
    if (lineAction?.expectedUpdatedAt && r.updatedAt.getTime() !== lineAction.expectedUpdatedAt.getTime()) throw new ConflictException('expense_source_version_changed');
    if (!canVoidExpenseFinancialState(r)) throw new BadRequestException({ code: 'expense_changed', message: EXPENSE_VOID_CERTIFICATE_WORDS.statusChanged });
    if (lineAction?.previewOnly) {
      const capabilities = await this.repo.expenseCorrectionCapabilities(ctx.companyId, expenseId, ctx.permissions);
      if (capabilities.disbursementReservation) throw new BadRequestException({ code: 'expense_disbursement_reserved', message: 'Expense is reserved.' });
      const blocker = await this.repo.lineVoidBlocker(ctx.companyId, expenseId);
      if (blocker) throw new BadRequestException({ code: blocker.code, message: 'Expense cannot be voided yet.' });
      if (capabilities.certificateOnExpense) throw new BadRequestException({ code: 'expense_certificate_attestation_required', message: EXPENSE_VOID_CERTIFICATE_WORDS.attestationRequired });
      return r;
    }

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
    let reserved: Awaited<ReturnType<ReserveDocumentNumberUseCase['execute']>> | null = null;
    const paymentReservations: Array<{ paymentId: string; reservation: Awaited<ReturnType<ReserveDocumentNumberUseCase['execute']>> }> = [];
    try {
      reserved = accrualJournalId
        ? await this.reserveNumber.execute({
            companyId: ctx.companyId, documentType: LEDGER_SEQUENCE_KEY, periodKey,
            idempotencyKey: `void-reversal:expense.record:${expenseId}:${Date.now()}`,
            reservedByUserId: ctx.userId,
          })
        : null;
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
    } catch (error) {
      if (error instanceof UnprocessableEntityException && error.message === 'Document sequence is disabled or missing.') {
        throw new UnprocessableEntityException({ code: 'expense_void_number_unavailable', message: EXPENSE_VOID_CERTIFICATE_WORDS.numberUnavailable });
      }
      throw error;
    }

    const viewerReadScope = reservationViewerScope(this.repo, ctx);
    let result: Awaited<ReturnType<PrismaExpenseRepository['voidExpenseTrueReversal']>>;
    try {
      result = await this.repo.voidExpenseTrueReversal(
        ctx.companyId,
        expenseId,
        ctx.userId,
        reason,
        reserved?.documentNumber,
        paymentReservations.map(({ paymentId, reservation }) => ({ paymentId, reversalEntryNumber: reservation.documentNumber })),
        authority?.beforeVoid,
        { permissions: ctx.permissions, ...(viewerReadScope ? { viewerReadScope } : {}), taxFilingAttested, requestId: ctx.requestId, ...(lineAction?.expectedUpdatedAt && { expectedUpdatedAt: lineAction.expectedUpdatedAt, scopes: ctx.scopes }),
          ...(authority?.cancellationCertificateAttestedAt && { authorisedByClaimCancellation: true }) },
      );
    } catch (err) {
      // The reservations are still RESERVED here (commit happens only after a
      // successful reversal), so they must be cancelled — voidNumber accepts
      // COMMITTED numbers only and would mask the real error.
      if (reserved) await this.cancelNumber.execute({ id: reserved.id, companyId: ctx.companyId }, ctx.userId);
      for (const { reservation } of paymentReservations) {
        await this.cancelNumber.execute({ id: reservation.id, companyId: ctx.companyId }, ctx.userId);
      }
      if (isSerializationFailure(err)) throw new ConflictException({
        code: 'expense_changed_retry', message: EXPENSE_VOID_CERTIFICATE_WORDS.changedRetry,
      });
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
    await notifyExpenseCertificateCancelled(this.notify, this.repo,
      { ...ctx, userId: authority?.cancellationPendingByUserId ?? ctx.userId }, expenseId, reason, 'void', result.cancelledCertificate);
    await this.disbursementNotices?.cancelled({ ...ctx, userId: authority?.cancellationPendingByUserId ?? ctx.userId }, result.cancelledDisbursementVoucherIds ?? []);
    return { ...result.expense, ...(result.cancelledCertificate && { cancelledCertificate: {
      kind: result.cancelledCertificate.isExternal ? 'EXTERNAL' as const : 'SYSTEM' as const, number: result.cancelledCertificate.certificateNumber,
    } }) };
  }
}

@Injectable()
export class MarkExpenseReadyUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly people?: PrismaDisbursementVoucherRepository, private readonly notify?: CreateOrUpdateNotificationEventUseCase) {}

  async reviewers(ctx: RequestContext, expenseId: string) {
    const r = await this.repo.findById(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException();
    assertBranchInScope(ctx, r.branchId);
    if (!hasPerm(ctx, 'expense.review') && !(hasPerm(ctx, 'expense.update') && r.createdByUserId === ctx.userId)) throw new ForbiddenException('Missing permission');
    if (!r.branchId || !this.people) return [];
    return (await this.people.membersWithPermission(ctx.companyId, r.branchId, 'expense.confirm')).filter(person => person.userId !== ctx.userId);
  }

  async execute(ctx: RequestContext, expenseId: string, requestedReviewerUserId?: string, expectedUpdatedAt?: Date): Promise<ExpenseRecord> {
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    const { record: r, target } = await this.previewLineAction(ctx, expenseId, undefined, requestedReviewerUserId);
    if (expectedUpdatedAt && r.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ConflictException('expense_source_version_changed');
    if (requestedReviewerUserId && r.status === 'READY_FOR_CONFIRMATION' && r.requestedReviewerUserId === requestedReviewerUserId && r.submittedByUserId === ctx.userId) return r;
    const submittedAt = new Date();
    const names = requestedReviewerUserId && this.people ? await this.people.memberNames(ctx.companyId, [ctx.userId]) : null;
    return this.repo.updateExpense({ id: expenseId, companyId: ctx.companyId, updatedByUserId: ctx.userId, status: target, expectedUpdatedAt: r.updatedAt,
      ...(requestedReviewerUserId && { requestedReviewerUserId, submittedByUserId: ctx.userId, submittedAt }) }, requestedReviewerUserId && this.notify ? async tx => {
        await this.notify!.executeInTransaction({ companyId: ctx.companyId, triggerKey: 'expense.review_requested', sourceModule: 'expenses', sourceType: 'expense_record', sourceId: expenseId,
          severity: 'action', title: EXPENSE_REVIEW_REQUEST_WORDS.title,
          body: EXPENSE_REVIEW_REQUEST_WORDS.body.replace('{sender}', names?.get(ctx.userId) ?? 'ผู้ส่ง').replace('{number}', r.expenseNumber ?? 'ที่ยังไม่มีเลขที่'),
          deepLinkHref: `/companies/${ctx.companyId}/expenses/${expenseId}`, recipientUserIds: [requestedReviewerUserId], webOnlyRecipientUserIds: [requestedReviewerUserId], periodKey: submittedAt.toISOString(), sourceRefs: [{ submittedAt: submittedAt.toISOString() }], supersedeEarlier: true }, tx);
      } : undefined);
  }

  async previewLineAction(ctx: RequestContext, expenseId: string, previewSource?: ExpenseRecordWithRelations, requestedReviewerUserId?: string) {
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    let r = await this.repo.findById(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException();
    if (previewSource) {
      if (previewSource.id !== r.id || previewSource.companyId !== r.companyId || previewSource.updatedAt.getTime() !== r.updatedAt.getTime()) throw new ConflictException('expense_source_version_changed');
      r = previewSource;
    }
    assertBranchInScope(ctx, r.branchId);
    const canReview = hasPerm(ctx, 'expense.review');
    const canUpdateOwn = hasPerm(ctx, 'expense.update') && r.createdByUserId === ctx.userId;
    if (!canReview && !canUpdateOwn) throw new ForbiddenException('Missing permission');
    if (requestedReviewerUserId) {
      if (!(await this.reviewers(ctx, expenseId)).some(person => person.userId === requestedReviewerUserId)) throw new BadRequestException({ code: 'expense_reviewer_ineligible', message: 'คนนี้ยืนยันรายจ่ายของสาขานี้ไม่ได้ เลือกคนอื่น' });
      if (r.status === 'READY_FOR_CONFIRMATION' && r.requestedReviewerUserId === requestedReviewerUserId && r.submittedByUserId === ctx.userId) return { record: r, target: 'READY_FOR_CONFIRMATION' as const };
    }
    if (hasBlockingNonExpenseClassification(r.aiVerificationSummaryJson)) {
      throw new BadRequestException(NON_EXPENSE_CLASSIFICATION_REVIEW_REQUIRED);
    }
    // Same endpoint serves the web "เริ่มตรวจใหม่" action on a rejected record: reopening puts it back
    // in NEEDS_REVIEW to be corrected and re-submitted, never straight into the confirmable state.
    const target: 'NEEDS_REVIEW' | 'READY_FOR_CONFIRMATION' = !requestedReviewerUserId && r.status === 'REJECTED' ? 'NEEDS_REVIEW' : 'READY_FOR_CONFIRMATION';
    if (target === 'READY_FOR_CONFIRMATION') {
      const source = r.captureSource === 'LINE_UPLOAD' && !r.sourceChannelMetadataJson?.[EXPENSE_SOURCE_DRAFT_KEY]
        ? await this.repo.findByIdWithRelations(ctx.companyId, expenseId) : undefined;
      assertExpenseSourceDraftComplete(r.sourceChannelMetadataJson, source ?? undefined);
    }
    const err = validateStatusTransition(r.status, target);
    if (err) throw new BadRequestException(err);
    return { record: r, target };
  }
}

export async function recordExpensePaymentEffects(audit: AuditService, ctx: RequestContext, expenseId: string, tx: Prisma.TransactionClient, created: ExpensePaymentResult) {
  const data = { ...(created.payment.slipAttachmentId ? { slipAttachmentId: created.payment.slipAttachmentId } : {}), expenseId, paymentId: created.payment.id, paidAmount: created.payment.amount, cumulativePaidAmount: created.expense.paidAmount, paymentStatus: created.expense.paymentStatus };
  await audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.payment.record', targetType: 'expense_payment', targetId: created.payment.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: data }, tx);
  await tx.outboxEvent.create({ data: {
    companyId: ctx.companyId, eventType: 'expense.payment_recorded', aggregateType: 'expense_payment', aggregateId: created.payment.id,
    eventKey: `expense.payment_recorded:expense_payment:${created.payment.id}`,
    payloadJson: { companyId: ctx.companyId, aggregateType: 'expense_payment', aggregateId: created.payment.id, requestId: ctx.requestId ?? `expense:paid:${created.payment.id}`, occurredAt: new Date().toISOString(), data },
    priority: 'NORMAL', status: 'PENDING',
  } });
}

/** Reuse the expense list's actual read scope for reservation remedies; missing read authority stays closed. */
function reservationViewerScope(repo: PrismaExpenseRepository, ctx: RequestContext) {
  if (ctx.authProvider === 'line') return undefined;
  try {
    const read = new ListExpensesUseCase(repo).readScope(ctx);
    return { companyId: ctx.companyId, scopes: ctx.scopes ?? {}, ...read.filter, relatedUserId: read.scope.relatedUserId };
  } catch (error) { if (error instanceof ForbiddenException) return undefined; throw error; }
}

@Injectable()
export class RecordExpensePaymentUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService, @Optional() private readonly linkAttachment?: LinkAttachmentUseCase) {}

  async confirmDate(ctx: RequestContext, expenseId: string, paymentId: string, paidAt: string) {
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    requirePerm(ctx, 'expense.payment.record', 'confirm expense payment date');
    const expense = await this.repo.findById(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException();
    assertBranchInScope(ctx, expense.branchId);
    if (!isCivilDate(paidAt)) throw new BadRequestException({ code: 'expense_payment_invalid_date', message: 'ระบุวันที่จ่ายเงินจริงจากหลักฐาน' });
    assertExpensePaymentSource(expense, paidAt);
    return this.repo.confirmPaymentDateAtomic({ companyId: ctx.companyId, expenseId, paymentId, paidAt, actorUserId: ctx.userId, scopes: ctx.scopes ?? {} },
      tx => this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.payment_date_confirmed', targetType: 'expense_payment', targetId: paymentId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { paidAt } }, tx));
  }


  async execute(
    ctx: RequestContext,
    expenseId: string,
    input: RecordExpensePaymentInput,
    line?: { expectedUpdatedAt?: Date; evidenceAttachmentId?: string; beforeEvidence?: (tx: Prisma.TransactionClient) => Promise<void> },
  ): Promise<ExpenseRecord> {
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    requirePerm(ctx, 'expense.payment.record', 'record expense payment');
    const r = await this.repo.findById(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException(`Expense ${expenseId} not found`);
    assertBranchInScope(ctx, r.branchId);
    assertExpensePaymentSource(r);
    if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== 'string' || !PAYMENT_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey))) {
      throw new BadRequestException({ code: 'expense_payment_invalid_key', message: 'Payment key must contain 8–64 letters, numbers, underscores or hyphens.' });
    }
    assertExpensePaymentSource(r, input.paidAt);
    // Separate caller keys from legacy transport IDs; hash the whole ID, never a prefix.
    const idempotencyKey = input.idempotencyKey === undefined
      ? `request:${createHash('sha256').update(ctx.requestId || randomUUID()).digest('hex')}`
      : `client:${input.idempotencyKey}`;
    const result = await this.repo.recordPaymentAtomic({
      companyId: ctx.companyId,
      expenseId,
      actorUserId: ctx.userId,
      scopes: ctx.scopes ?? {},
      permissions: ctx.permissions, viewerReadScope: reservationViewerScope(this.repo, ctx),
      idempotencyKey,
      amount: input.paidAmount,
      expectedUpdatedAt: line?.expectedUpdatedAt,
      paymentMethod: input.paymentMethod,
      paidAt: input.paidAt,
      bankAccountRef: input.bankAccountRef,
      slipAttachmentId: input.slipAttachmentId,
    }, async (tx, created) => {
      if (line?.evidenceAttachmentId) {
        await line.beforeEvidence?.(tx);
        if (!this.linkAttachment) throw new ConflictException('Payment evidence linking unavailable.');
        const existing = await tx.attachmentLink.findFirst({ where: { companyId: ctx.companyId, attachmentId: line.evidenceAttachmentId, targetType: 'expense.record', targetId: expenseId, purpose: 'expense.payment.evidence' } });
        if (!existing) await this.linkAttachment.execute(ctx, { attachmentId: line.evidenceAttachmentId, targetType: 'expense.record', targetId: expenseId, purpose: 'expense.payment.evidence' }, tx);
      }
      await recordExpensePaymentEffects(this.audit, ctx, expenseId, tx, created);
    });
    if (result.replayed && result.payment?.status === 'VOIDED') throw new ConflictException({ code: 'expense_payment_cancelled_replay', message: EXPENSE_CORRECTION_WORDS.paymentReplayCancelled });
    return result.expense;
  }
  async previewLineAction(ctx: RequestContext, expenseId: string, input: RecordExpensePaymentInput): Promise<ExpenseRecord> {
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    requirePerm(ctx, 'expense.payment.record', 'record expense payment');
    const r = await this.repo.findById(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException();
    assertBranchInScope(ctx, r.branchId);
    assertExpensePaymentSource(r, input.paidAt);
    const { amount } = validateExpensePaymentInput({ amount: input.paidAmount, paidAt: input.paidAt, paymentMethod: input.paymentMethod, bankAccountRef: input.bankAccountRef });
    assertEWhtPaymentMethod(r, input.paymentMethod);
    assertExpensePaymentOutstanding(r, amount);
    return r;
  }

}


function correctionReason(reason: string): string {
  if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500) {
    throw new BadRequestException(EXPENSE_CORRECTION_WORDS.reasonRequired);
  }
  return reason.trim().replace(/\d(?:[ -]?\d){7,}/g, maskAccountNumber);
}

@Injectable()
export class ReopenExpenseUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService,
    private readonly notify?: CreateOrUpdateNotificationEventUseCase) {}

  async execute(ctx: RequestContext, expenseId: string, reason: string, taxFilingAttested?: boolean): Promise<ExpenseRecord> {
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    requirePerm(ctx, 'expense.confirm', 'reopen expense', { code: 'expense_correction_permission_missing', message: EXPENSE_CORRECTION_WORDS.permissionDenied });
    if (ctx.authProvider === 'line') throw new ForbiddenException({ code: 'expense_correction_web_required', message: EXPENSE_CORRECTION_WORDS.webRequired });
    const cleanReason = correctionReason(reason);
    const expense = await this.repo.findById(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException({ code: 'expense_correction_not_found', message: EXPENSE_CORRECTION_WORDS.notFound });
    assertBranchInScope(ctx, expense.branchId, { code: 'expense_correction_branch_forbidden', message: EXPENSE_CORRECTION_WORDS.branchForbidden });
    const result = await this.repo.reopenExpenseAtomic({ companyId: ctx.companyId, expenseId, actorUserId: ctx.userId, scopes: ctx.scopes ?? {}, reason: cleanReason, permissions: ctx.permissions, viewerReadScope: reservationViewerScope(this.repo, ctx), taxFilingAttested, requestId: ctx.requestId },
      (tx) => this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.reopen', targetType: 'expense_record', targetId: expenseId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { reason: cleanReason } }, tx));
    await notifyExpenseCertificateCancelled(this.notify, this.repo, ctx, expenseId, cleanReason, 'reopen', result.cancelledCertificate);
    return { ...result.expense, ...(result.cancelledCertificate && { cancelledCertificate: {
      kind: result.cancelledCertificate.isExternal ? 'EXTERNAL' as const : 'SYSTEM' as const, number: result.cancelledCertificate.certificateNumber,
    } }) };
  }
}

async function notifyExpenseCertificateCancelled(
  notify: CreateOrUpdateNotificationEventUseCase | undefined,
  repo: PrismaExpenseRepository, ctx: RequestContext, expenseId: string, reason: string,
  action: 'reopen' | 'void', certificate: ExpenseCertificateCancellation | null,
): Promise<void> {
  // Nest injects the existing provider; optional construction preserves certificate-free unit callers.
  if (!certificate?.issuerUserId || certificate.issuerUserId === ctx.userId) return;
  try {
    const actorName = await repo.findMemberDisplayName(ctx.companyId, ctx.userId) ?? 'ผู้ทำรายการ';
    const number = certificate.certificateNumber ? ` เลขที่ ${certificate.certificateNumber}` : '';
    const title = certificate.isExternal ? 'ยกเลิกการบันทึกแล้ว: ใบ 50 ทวิ ที่ทำนอกระบบ' : 'ยกเลิกแล้ว: หนังสือรับรอง 50 ทวิ';
    const cancellation = certificate.isExternal
      ? 'ระบบจึงยกเลิกการบันทึกนี้ กรุณายกเลิกใบ 50 ทวิ ที่ทำนอกระบบด้วย'
      : action === 'reopen' ? 'ระบบจึงยกเลิกหนังสือรับรองใบเดิม' : 'ระบบจึงยกเลิกหนังสือรับรองด้วย';
    await notify!.execute({
      companyId: ctx.companyId, triggerKey: 'expense.wht_certificate_cancelled', sourceModule: 'expenses',
      sourceType: 'expense_record', sourceId: expenseId, periodKey: String(certificate.certificateRound), severity: 'info',
      title: `${title}${number}`,
      body: `${actorName} ${action === 'reopen' ? 'แก้ไขเอกสารรายจ่ายนี้' : 'ยกเลิกเอกสารรายจ่ายนี้'} ${cancellation} เหตุผล: ${reason}${action === 'reopen' ? ` ${E_WHT_WORDS['N-1']}` : ''}`,
      deepLinkHref: `/companies/${ctx.companyId}/expenses/${expenseId}#wht-certificate`, recipientUserIds: [certificate.issuerUserId],
    });
  } catch (error) {
    Logger.warn({ msg: 'expense.wht_certificate_cancelled.notify_failed', companyId: ctx.companyId, expenseId,
      action, error: error instanceof Error ? error.message : String(error) }, 'ExpenseCertificateCancellation');
  }
}

@Injectable()
export class CancelExpensePaymentUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService, @Optional() private readonly disbursementNotices?: DisbursementVoucherNoticeService) {}

  async execute(ctx: RequestContext, expenseId: string, paymentId: string, reason: string): Promise<ExpenseRecord> {
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    requirePerm(ctx, 'expense.payment.record', 'cancel expense payment');
    if (ctx.authProvider === 'line') throw new ForbiddenException('Expense payment correction requires authenticated web authority.');
    const cleanReason = correctionReason(reason);
    const expense = await this.repo.findById(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException();
    assertBranchInScope(ctx, expense.branchId);
    let cancelledIds: string[] = [];
    const result = await this.repo.cancelPaymentAtomic({ companyId: ctx.companyId, expenseId, paymentId, actorUserId: ctx.userId, scopes: ctx.scopes ?? {}, reason: cleanReason },
      async (tx, ids) => {
        cancelledIds = ids ?? [];
        await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.payment.cancel', targetType: 'expense_payment', targetId: paymentId,
          requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { expenseId, reason: cleanReason } }, tx);
      });
    await this.disbursementNotices?.cancelled(ctx, cancelledIds);
    return result;
  }
}


@Injectable()
export class DecideExpenseInputVatUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}
  async execute(ctx: RequestContext, expenseId: string, input: import('@watchdog-bms/contracts').DecideExpenseInputVatInput) {
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    requirePerm(ctx, 'expense.review', 'decide input VAT');
    return this.repo.decideInputVat(ctx, expenseId, input);
  }
}
