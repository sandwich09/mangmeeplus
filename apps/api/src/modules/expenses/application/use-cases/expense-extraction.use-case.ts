import { GetExpenseUseCase } from './expense-draft.use-case';
import { completeCompanyOcrAdmissionWithinTransaction, freeExpenseAllowanceSnapshot } from '../../../line-ai/application/free-expense-quota';
import { isFreeExpenseDraftCompany } from '../../../system-partner-management/application/free-expense-access';
import { freeExpenseQuotaNoticeTextTh, FREE_EXPENSE_IN_FLIGHT_TEXT_TH } from '../../../system-partner-management/domain/logic/receipt-quota.logic';
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../audit/application/audit.service';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { ReceiptOcrClient } from '../../infrastructure/receipt-ocr.client';
import { isStaleOcrApply, ocrLineVatRateUnknown, ReceiptOcrApplyService } from '../services/receipt-ocr-apply.service';
import { deriveTaxEvidence, isExpenseExtractionEligible, isSuccessfulNonReceiptClassification, sourceDocumentTypeFromClassification, toSourceDocumentType } from '../../domain/logic/expense-document.logic';
import type { AiModelLineage, BusinessDocumentClassification, ExpenseExtractionResult, FreeExpenseAllowance, RequestContext } from '@watchdog-bms/contracts';
import { emptyExpenseCaptureReadManifest, isAiBudgetRefusalCode } from '@watchdog-bms/contracts';
import { PrismaExpenseCaptureRepository } from '../../infrastructure/prisma-expense-capture.repository';
import { ExpenseCaptureReadRunnerService } from '../services/expense-capture-read-runner.service';
import { observeCustomerJourney } from '../../../../common/observability/customer-journey-audit';
import { PrismaService } from '../../../../common/database/prisma.service';
import { bangkokMonthKey } from '../../../line-ai/application/company-ai-usage-meter';
import { safeLineErrorDetails } from '../../../line-ai/infrastructure/line-reply.adapter';
import { type CompanyOcrAdmissionIdentity, releaseCompanyOcrAdmission, receiptQuotaSnapshot, RECEIPT_QUOTA_ERROR_CODE, settleCompanyOcrAdmission } from '../../../line-ai/application/company-ocr-governance';
import { displayReceiptQuotaLimit, receiptQuotaExceededTextTh } from '../../../system-partner-management/domain/logic/receipt-quota.logic';

const SUPPORTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const MAX_EXTRACTION_BYTES = 10_000_000;
// The PDF gate of 4,000,000 bytes is GONE (appendix §4.1): a PDF is no longer sent whole to a
// Bedrock document block, it is split by `expense-capture-preprocess.logic.ts` into chunks that
// already fit, so the customer's own upload limit is the only one that applies. Images keep
// `MAX_EXTRACTION_BYTES`, which is still a single synchronous provider call.
const DEFAULT_MISSING_FIELDS = ['vendor', 'expenseDate', 'documentNumber', 'grandTotalAmount', 'vatAmount', 'category'];

function withEffectiveMissingFields(
  reported: string[] | undefined,
  categoryId: string | null | undefined,
  vatRateUnknown: boolean,
  dateVerified = true,
): string[] {
  const missing = new Set(reported ?? DEFAULT_MISSING_FIELDS);
  if (categoryId) missing.delete('category');
  else missing.add('category');
  // Spec §19g decision 1: a VAT-mode draft with no rate cannot record its own tax base, so the
  // reviewer is asked for it rather than a rate being assumed on their behalf.
  if (vatRateUnknown) missing.add('vatRate');
  else missing.delete('vatRate');
  // Spec §5.2: the date column is NOT NULL, so an unread date still stores the upload day. Flagging
  // it here is what makes the review form say so — a stored placeholder passes every non-empty check.
  if (!dateVerified) missing.add('expenseDate');
  return [...missing].slice(0, 20);
}

function boundedClassification(classification: BusinessDocumentClassification): Record<string, unknown> {
  return {
    contentKind: classification.contentKind,
    documentFamily: classification.documentFamily,
    documentKind: classification.documentKind,
    businessDirection: classification.businessDirection,
    transactionState: classification.transactionState,
    evidenceRoles: classification.evidenceRoles,
    confidence: classification.confidence,
    missingRequiredSignals: classification.missingRequiredSignals,
    contradictionSignals: classification.contradictionSignals,
    requiresClarification: classification.requiresClarification,
  };
}

@Injectable()
export class RequestReceiptExtractionUseCase {
  private readonly logger = new Logger(RequestReceiptExtractionUseCase.name);

  constructor(
    private readonly repo: PrismaExpenseRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly client: ReceiptOcrClient,
    private readonly applyService: ReceiptOcrApplyService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly runner: ExpenseCaptureReadRunnerService,
    private readonly getExpense: GetExpenseUseCase,
  ) {}

  async execute(ctx: RequestContext, expenseId: string): Promise<ExpenseExtractionResult> {
    return observeCustomerJourney(
      this.audit,
      {
        key: 'receipt-ocr', requestId: ctx.requestId, targetType: 'expense_record', targetId: expenseId,
        companyId: ctx.companyId, actorUserId: ctx.userId,
      },
      () => this.extract(ctx, expenseId),
      (result) => result.status === 'ok' || result.status === 'not_expense_document'
        ? { outcome: result.status }
        : { outcome: result.status, failureClass: result.status },
    );
  }

  private async extract(ctx: RequestContext, expenseId: string): Promise<ExpenseExtractionResult> {
    const freeExpenseDrafts = await isFreeExpenseDraftCompany(this.prisma.client, ctx.companyId);
    const expense = await this.getExpense.execute(ctx, expenseId).catch(async (error: unknown) => {
      if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) throw error;
      await this.auditOutcome(ctx, expenseId, 'not_found');
      throw new NotFoundException(`Expense ${expenseId} not found`);
    });

    const canRequest = ctx.permissions.includes('expense.ocr.request') || ctx.permissions.includes('expense.review');
    const canRequestOwn = ctx.permissions.includes('expense.receipt.upload') && expense.createdByUserId === ctx.userId;
    if (!canRequest && !canRequestOwn) {
      await this.auditOutcome(ctx, expenseId, 'forbidden');
      throw new ForbiddenException('Missing permission: expense.ocr.request');
    }

    if (expense.status !== 'DRAFT' && expense.status !== 'NEEDS_REVIEW' && expense.status !== 'READY_FOR_CONFIRMATION') {
      await this.auditOutcome(ctx, expenseId, 'invalid_status');
      throw new ConflictException(`Cannot extract receipt for expense in ${expense.status} status`);
    }

    if (freeExpenseDrafts && (expense.createdByUserId !== ctx.userId || !['DRAFT', 'NEEDS_REVIEW'].includes(expense.status))) {
      throw new ForbiddenException('เปิดอ่านได้เฉพาะร่างที่คุณมีสิทธิ์ค่ะ');
    }
    const attachment = await this.repo.findReceiptExtractionAttachment(ctx.companyId, expenseId, expense.primaryAttachmentId);
    if (!attachment) return this.finish(ctx, expenseId, 'no_attachment');
    const isPdf = attachment.mimeType === 'application/pdf';
    if (!SUPPORTED_MIME_TYPES.has(attachment.mimeType) || (!isPdf && attachment.byteSize > MAX_EXTRACTION_BYTES)) {
      return this.finish(ctx, expenseId, 'unsupported', attachment.id);
    }
    // Appendix §3: a PDF is read by a durable job, page by page, and the HTTP request returns as
    // soon as that job exists. The image path below is untouched — it is one provider call and
    // the reviewer is already waiting for it.
    if (isPdf) return this.queueCaptureRead(ctx, expense, attachment);

    let admission: CompanyOcrAdmissionIdentity | undefined;
    let freeAllowance: FreeExpenseAllowance | undefined;
    let usablePersisted = false;
    let noReceipt = false;
    try {
      const object = await this.storage.getObject({
        bucket: attachment.bucket,
        objectKey: attachment.objectKey,
        ...(attachment.objectVersionId ? { objectVersionId: attachment.objectVersionId } : {}),
      });
      const activeCategories = (await this.repo.listCategories(ctx.companyId))
        .map((category) => ({ id: category.id, name: category.name }));
      const response = await this.client.extract({
        requestId: ctx.requestId,
        companyId: ctx.companyId,
        userId: ctx.userId,
        activeCategories,
        attachment: {
          id: attachment.id,
          mimeType: attachment.mimeType as 'image/jpeg' | 'image/png' | 'application/pdf',
          purpose: 'receipt',
          contentBase64: object.bytes.toString('base64'),
        },
      }, { onAdmitted: (identity) => { admission = identity; } });

      // P10-L §15.1 (review G-01): the shop's plan ran out of receipts. `admitCompanyOcr` refused
      // before any provider ran, so nothing was spent and nothing needs releasing — this only has to
      // answer. A 409 with a code, not one of the `failed` outcomes: those all render as
      // "the read failed, try again", and trying again is the one thing that cannot work here.
      if (response.errorCode === RECEIPT_QUOTA_ERROR_CODE) {
        await this.auditOutcome(ctx, expenseId, 'receipt_quota_exceeded', attachment.id, 0, undefined, undefined, response.errorCode);
        const { usedCount, planLimit, tierKey, cadence, expiresAt, monthlyAllowance } = await receiptQuotaSnapshot(this.prisma, ctx.companyId);
        const shownLimit = displayReceiptQuotaLimit(planLimit, tierKey, cadence);
        throw new ConflictException({
          code: 'receipt_quota_exceeded',
          // `tierKey` decides the sentence: a FREE_TRIAL_15 shop hears about its trial, a paying
          // tier hears about its package. Dropping it gave every shop the paying-tier wording.
          message: receiptQuotaExceededTextTh(shownLimit, tierKey, cadence, Boolean(monthlyAllowance)),
          count: usedCount,
          limit: planLimit,
          tierKey,
          ...(cadence ? { cadence, expiresAt } : { monthKey: bangkokMonthKey() }),
        });
      }

      if (response.errorCode === 'FREE_DOCUMENT_LIMIT_REACHED' || response.errorCode === 'FREE_DOCUMENTS_IN_FLIGHT') {
        const allowance = await freeExpenseAllowanceSnapshot(this.prisma, ctx.companyId);
        throw new ConflictException({ code: response.errorCode, message: response.errorCode === 'FREE_DOCUMENTS_IN_FLIGHT'
          ? FREE_EXPENSE_IN_FLIGHT_TEXT_TH : freeExpenseQuotaNoticeTextTh(allowance.resetAt), freeAllowance: allowance });
      }
      if (response.status !== 'ok') {
        const status = response.status === 'not_configured' ? 'not_configured' : 'failed';
        // Spec §9.1: the money reason must survive a reload. It is written BESIDE whatever a previous
        // read left on the summary — never replacing it — so the file, the draft and everything the
        // reviewer already typed stay exactly as they were, and a resumed attempt replays THIS
        // attempt's reason instead of asking the gate again under today's budget.
        if (isAiBudgetRefusalCode(response.errorCode)) {
          await this.persistBudgetRefusal(ctx, expense, attachment.id, response.errorCode, response.budgetScope);
        }
        return this.finish(ctx, expenseId, status, attachment.id, response.modelLineage, response.errorCode, response.budgetScope);
      }

      if (!response.classification) return this.finish(ctx, expenseId, 'failed', attachment.id, response.modelLineage);
      if (freeExpenseDrafts && response.classification.contentKind === 'MULTI_DOCUMENT') {
        return this.finish(ctx, expenseId, 'failed', attachment.id, response.modelLineage, 'FREE_MULTI_DOCUMENT_UNSUPPORTED');
      }

      // Keep the user's evidence choice/history recoverable. The new extraction request
      // changes its fingerprint, so this does not approve the newly read facts.
      const priorSummary = expense.aiVerificationSummaryJson ?? {};
      const evidenceReviewMetadata = {
        ...(priorSummary['dateStatus'] ? { dateStatus: priorSummary['dateStatus'] } : {}),
        ...(priorSummary['dateResolution'] ? { dateResolution: priorSummary['dateResolution'] } : {}),
        ...(priorSummary['documentEvidenceDraft'] ? { documentEvidenceDraft: priorSummary['documentEvidenceDraft'] } : {}),
        ...(priorSummary['documentReview'] ? { documentReview: priorSummary['documentReview'] } : {}),
      };

      if (!isExpenseExtractionEligible(response.classification, response.fields?.grandTotalAmount, true)) {
        const nonReceipt = isSuccessfulNonReceiptClassification(response.classification);
        await this.repo.updateExpense({
          id: expenseId,
          companyId: ctx.companyId,
          updatedByUserId: ctx.userId,
          expectedUpdatedAt: expense.updatedAt,
          aiVerificationStatus: 'NEEDS_REVIEW',
          aiVerificationSummaryJson: {
            ...evidenceReviewMetadata,
            status: nonReceipt ? 'NOT_EXPENSE_DOCUMENT' : 'OCR_FAILED',
            ...(!nonReceipt ? { recognizedFields: response.fields ?? {}, missingFields: response.fields?.missingFields ?? DEFAULT_MISSING_FIELDS } : {}),
            extractionRequestId: ctx.requestId, extractionAttachmentId: attachment.id,
            classification: boundedClassification(response.classification),
            // Read but deliberately NOT applied: the gate refuses to mutate the draft, so these
            // stay a reviewer-facing suggestion they choose to accept, never a silent write.
            ...(response.fields ? { suggestedFields: response.fields } : {}),
            nextAction: 'review_attachment_or_upload_expense_evidence',
          },
        });
        if (!nonReceipt) return this.finish(ctx, expenseId, 'failed', attachment.id, response.modelLineage, 'OCR_UNUSABLE_RESULT');
        usablePersisted = !freeExpenseDrafts && admission?.quotaSource !== 'FREE_MONTHLY_3';
        noReceipt = true;
        await this.auditOutcome(ctx, expenseId, 'not_expense_document', attachment.id, 0, response.classification, response.modelLineage);
        return {
          status: 'not_expense_document',
          classification: response.classification,
          ...(response.fields ? { fields: response.fields } : {}),
        };
      }

      if (!response.fields) return this.finish(ctx, expenseId, 'failed', attachment.id, response.modelLineage);

      const suggestedDocType = toSourceDocumentType(sourceDocumentTypeFromClassification(response.classification));
      const applyOutcome = await this.applyService.apply(ctx, expenseId, response.fields, {
        ocrDocumentType: suggestedDocType,
        ...(expense.sourceDocumentType === 'NEEDS_REVIEW' && suggestedDocType === 'TRANSFER_SLIP' ? { sourceDocumentType: suggestedDocType } : {}),
        ...(expense.updatedAt ? { expectedUpdatedAt: expense.updatedAt } : {}),
        ...((freeExpenseDrafts || admission?.quotaSource === 'FREE_MONTHLY_3') ? { sourceOnly: true } : {}),
        ...(admission?.quotaSource === 'FREE_MONTHLY_3' ? { onUsablePersisted: async (tx) => {
          const completed = await completeCompanyOcrAdmissionWithinTransaction(tx, {
            companyId: ctx.companyId, sourceRoute: 'receipt-ocr-web', requestId: ctx.requestId, eventId: admission!.eventId,
          });
          freeAllowance = completed.freeAllowance;
        } } : {}),
      });
      if (isStaleOcrApply(applyOutcome) || !applyOutcome.committedUpdatedAt) {
        // A correction landed while the model was thinking. Writing this result — header, lines,
        // duplicates OR the summary below — would undo it, so the whole write set is abandoned.
        await this.auditOutcome(ctx, expenseId, 'apply_skipped_stale');
        return this.finish(ctx, expenseId, 'failed', attachment.id, response.modelLineage);
      }
      const duplicateResult = applyOutcome;
      // The usable header/lines already committed, even if a later human edit refuses this summary.
      usablePersisted = true;
      const missingFields = withEffectiveMissingFields(
        [...(duplicateResult.missingFields ?? []), ...(response.fields.missingFields ?? DEFAULT_MISSING_FIELDS)],
        duplicateResult.categoryId ?? expense.expenseCategoryId,
        ocrLineVatRateUnknown(response.fields),
        duplicateResult.dateVerified,
      );
      // AI classification defaults the review document type only while it is still
      // unclassified — a reviewer's explicit choice survives re-extraction.
      const defaultDocType = toSourceDocumentType(expense.sourceDocumentType) === 'NEEDS_REVIEW' && suggestedDocType !== 'NEEDS_REVIEW';
      const taxEvidence = defaultDocType
        ? deriveTaxEvidence({
            sourceDocumentType: suggestedDocType,
            grandTotalAmount: response.fields.grandTotalAmount,
            vendorTaxId: response.fields.vendorTaxId,
            vendorName: response.fields.vendorName,
            documentNumber: response.fields.documentNumber,
            lowConfidence: (response.fields.confidence ?? 1) < 0.5,
          })
        : null;
      await this.repo.updateExpense({
        id: expenseId,
        companyId: ctx.companyId,
        updatedByUserId: ctx.userId,
        expectedUpdatedAt: duplicateResult.committedUpdatedAt,
        ...(taxEvidence ? {
          sourceDocumentType: suggestedDocType,
          taxEvidenceStatus: taxEvidence.taxEvidenceStatus,
          taxEvidenceReasonCode: taxEvidence.taxEvidenceReasonCode,
        } : {}),
        aiVerificationSummaryJson: {
          ...evidenceReviewMetadata,
          status: 'OCR_EXTRACTED_NEEDS_REVIEW',
          extractionRequestId: ctx.requestId, extractionAttachmentId: attachment.id,
          recognizedFields: response.fields,
          classification: boundedClassification(response.classification),
          // Spec S1-R4: the resolved category suggestion, carried whether or not it was auto-filled,
          // so the review form can offer a below-threshold one as a recommendation to accept.
          ...(duplicateResult.categorySuggestion ? { categorySuggestion: duplicateResult.categorySuggestion } : {}),
          missingFields,
          duplicateWarning: duplicateResult.candidatesCreated > 0,
          chargeReconciliation: {
            status: duplicateResult.chargeReconciliationStatus,
            chargesApplied: duplicateResult.chargesApplied,
            // Shown to the reviewer beside the printed total when the two disagree.
            ...(duplicateResult.itemsSumAmount ? { itemsSumAmount: duplicateResult.itemsSumAmount } : {}),
          },
          // Spec §5.1/§5.2: the reasons in the reviewer's own words, beside the field flags above,
          // and the four-state answer for the document date the whole UI renders from.
          ...(duplicateResult.reviewReasons.length > 0 ? { reviewReasons: duplicateResult.reviewReasons } : {}),
          ...(duplicateResult.dateStatus ? { dateStatus: duplicateResult.dateStatus } : {}),
          ...(duplicateResult.dateAssumptions ? { expenseDateAssumptions: duplicateResult.dateAssumptions } : {}),
          nextAction: 'review_in_web',
        },
      });
      usablePersisted = true;
      await this.auditOutcome(ctx, expenseId, 'ok', attachment.id, Object.keys(response.fields).length, response.classification, response.modelLineage);
      return { status: 'ok', fields: response.fields, missingFields, classification: response.classification,
        ...(freeAllowance?.monthKey === bangkokMonthKey() ? { freeAllowance } : {}) };
    } catch (error) {
      // The quota answer is a decision, not a failure: letting it fall into `failed` below would
      // turn a 409 the upload screen acts on into "the read failed, try again".
      if (error instanceof ConflictException) throw error;
      this.logger.warn({ msg: 'Receipt OCR extraction failed', expenseId, ...safeLineErrorDetails(error) });
      return this.finish(ctx, expenseId, 'failed', attachment.id);
    } finally {
      if (admission && !usablePersisted) await releaseCompanyOcrAdmission(this.prisma, {
        companyId: ctx.companyId, sourceRoute: 'receipt-ocr-web', requestId: ctx.requestId,
        eventId: admission.eventId, reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT',
      });
      // Add-on plan PR B: the persisted result settles the reserved unit; D4/Q4 decides a non-receipt.
      if (admission && usablePersisted) await settleCompanyOcrAdmission(this.prisma, {
        companyId: ctx.companyId, sourceRoute: 'receipt-ocr-web', requestId: ctx.requestId, eventId: admission.eventId, noReceipt,
      });
    }
  }

  /**
   * Create (or re-answer) the read job for a PDF primary (§3, §4.5).
   *
   * Idempotent on (expense, attachment, bytes): the upload screen retrying a lost response, or a
   * reviewer pressing "อ่านใหม่", must not buy a second OCR read for the same file. A job whose
   * attachment or checksum changed is a DIFFERENT document and does get its own job.
   *
   * The kick is fire-and-forget: the request answers "เก็บไฟล์แล้ว กำลังอ่านเอกสาร" and the scan
   * worker picks the job up anyway if this process never gets to it.
   */
  private async queueCaptureRead(
    ctx: RequestContext,
    expense: { id: string; updatedAt?: Date | null },
    attachment: { id: string; objectVersionId?: string; checksumSha256?: string },
  ): Promise<ExpenseExtractionResult> {
    const existing = await this.capture.findLiveJobForAttachment(this.capture.client, {
      companyId: ctx.companyId, expenseId: expense.id,
      attachmentId: attachment.id, attachmentChecksum: attachment.checksumSha256 ?? '',
    });
    const job = existing ?? await this.capture.createReadJob(this.capture.client, {
      companyId: ctx.companyId, ownerType: 'EXPENSE', expenseId: expense.id,
      attachmentId: attachment.id, attachmentChecksum: attachment.checksumSha256 ?? '',
      objectVersionId: attachment.objectVersionId ?? null,
      ocrAdmissionRequestId: randomUUID(),
      manifestJson: emptyExpenseCaptureReadManifest(),
      ...(expense.updatedAt ? { expectedSourceUpdatedAt: expense.updatedAt } : {}),
    });
    this.runner.kick(job.id);
    await this.auditOutcome(ctx, expense.id, 'read_job_queued', attachment.id);
    return { status: 'ok', readJobId: job.id, readStatus: job.status as ExpenseExtractionResult['readStatus'] };
  }

  /**
   * Stamp this attempt's money refusal onto the saved summary (spec §9.1 "durable result").
   * Nested under its own key with its own request/attachment ids: the top-level extraction fields
   * belong to whichever read last SUCCEEDED, and moving them here would make a later recovery
   * replay that old success against this refused attempt's id.
   *
   * Best effort. A concurrent edit (optimistic-lock miss) must not turn a refusal into a 500 —
   * the refusal itself is already the answer, and the audit row above records it either way.
   */
  private async persistBudgetRefusal(
    ctx: RequestContext,
    expense: { id: string; updatedAt?: Date | null; aiVerificationSummaryJson?: Record<string, unknown> | null },
    attachmentId: string,
    errorCode: string,
    budgetScope?: string,
  ): Promise<void> {
    try {
      await this.repo.updateExpense({
        id: expense.id,
        companyId: ctx.companyId,
        updatedByUserId: ctx.userId,
        ...(expense.updatedAt ? { expectedUpdatedAt: expense.updatedAt } : {}),
        aiVerificationSummaryJson: {
          ...(expense.aiVerificationSummaryJson ?? {}),
          aiBudgetRefusal: {
            errorCode,
            ...(budgetScope ? { budgetScope } : {}),
            extractionRequestId: ctx.requestId,
            extractionAttachmentId: attachmentId,
            at: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      this.logger.warn({ msg: 'ai.budget.refusal_not_persisted', expenseId: expense.id, ...safeLineErrorDetails(error) });
    }
  }

  private async finish(
    ctx: RequestContext,
    expenseId: string,
    status: Exclude<ExpenseExtractionResult['status'], 'ok'>,
    attachmentId?: string,
    modelLineage?: AiModelLineage[],
    errorCode?: string,
    budgetScope?: ExpenseExtractionResult['budgetScope'],
  ): Promise<ExpenseExtractionResult> {
    await this.auditOutcome(ctx, expenseId, status, attachmentId, 0, undefined, modelLineage, errorCode);
    return { status, ...(errorCode ? { errorCode } : {}), ...(budgetScope ? { budgetScope } : {}) };
  }

  private auditOutcome(
    ctx: RequestContext,
    expenseId: string,
    status: string,
    attachmentId?: string,
    recognizedFieldCount = 0,
    classification?: BusinessDocumentClassification,
    modelLineage?: AiModelLineage[],
    errorCode?: string,
  ): Promise<void> {
    return this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'expense.ocr.request',
      targetType: 'expense_record',
      targetId: expenseId,
      requestId: ctx.requestId,
      result: status === 'ok' || status === 'not_expense_document' ? 'SUCCESS' : 'FAILED',
      riskLevel: 'MEDIUM',
      metadataJson: {
        channel: 'web',
        attachmentId: attachmentId ?? null,
        status,
        ...(errorCode ? { errorCode } : {}),
        recognizedFieldCount,
        documentKind: classification?.documentKind ?? null,
        modelLineage: modelLineage?.slice(0, 4) ?? [],
        reasonCodes: classification
          ? [...classification.missingRequiredSignals, ...classification.contradictionSignals].slice(0, 10)
          : [],
      },
    });
  }
}
