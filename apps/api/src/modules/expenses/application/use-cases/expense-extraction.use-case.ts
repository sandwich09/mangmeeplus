import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../audit/application/audit.service';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { ReceiptOcrClient } from '../../infrastructure/receipt-ocr.client';
import { isStaleOcrApply, ocrLineVatRateUnknown, ReceiptOcrApplyService } from '../services/receipt-ocr-apply.service';
import { deriveTaxEvidence, isExpenseExtractionEligible, sourceDocumentTypeFromClassification, toSourceDocumentType } from '../../domain/logic/expense-document.logic';
import type { AiModelLineage, BusinessDocumentClassification, ExpenseExtractionResult, RequestContext } from '@watchdog-bms/contracts';

const SUPPORTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const MAX_EXTRACTION_BYTES = 10_000_000;
// PDFs are read by a Bedrock Converse document block, which rejects payloads over ~4.5MB.
// Cap here so an oversized scan returns 'unsupported' instead of an opaque provider error.
const MAX_PDF_EXTRACTION_BYTES = 4_000_000;
const DEFAULT_MISSING_FIELDS = ['vendor', 'expenseDate', 'documentNumber', 'grandTotalAmount', 'vatAmount', 'category'];

function withEffectiveMissingFields(
  reported: string[] | undefined,
  categoryId: string | null | undefined,
  vatRateUnknown: boolean,
): string[] {
  const missing = new Set(reported ?? DEFAULT_MISSING_FIELDS);
  if (categoryId) missing.delete('category');
  else missing.add('category');
  // Spec §19g decision 1: a VAT-mode draft with no rate cannot record its own tax base, so the
  // reviewer is asked for it rather than a rate being assumed on their behalf.
  if (vatRateUnknown) missing.add('vatRate');
  else missing.delete('vatRate');
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
  ) {}

  async execute(ctx: RequestContext, expenseId: string): Promise<ExpenseExtractionResult> {
    const expense = await this.repo.findById(ctx.companyId, expenseId);
    if (!expense) {
      await this.auditOutcome(ctx, expenseId, 'not_found');
      throw new NotFoundException(`Expense ${expenseId} not found`);
    }

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

    const attachment = await this.repo.findReceiptExtractionAttachment(ctx.companyId, expenseId, expense.primaryAttachmentId);
    if (!attachment) return this.finish(ctx, expenseId, 'no_attachment');
    const maxBytes = attachment.mimeType === 'application/pdf' ? MAX_PDF_EXTRACTION_BYTES : MAX_EXTRACTION_BYTES;
    if (!SUPPORTED_MIME_TYPES.has(attachment.mimeType) || attachment.byteSize > maxBytes) {
      return this.finish(ctx, expenseId, 'unsupported', attachment.id);
    }

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
      });

      if (response.status !== 'ok') {
        const status = response.status === 'not_configured' ? 'not_configured' : 'failed';
        return this.finish(ctx, expenseId, status, attachment.id, response.modelLineage);
      }

      if (!response.classification) return this.finish(ctx, expenseId, 'failed', attachment.id, response.modelLineage);

      if (!isExpenseExtractionEligible(response.classification, response.fields?.grandTotalAmount, true)) {
        await this.repo.updateExpense({
          id: expenseId,
          companyId: ctx.companyId,
          updatedByUserId: ctx.userId,
          aiVerificationStatus: 'NEEDS_REVIEW',
          aiVerificationSummaryJson: {
            status: 'NOT_EXPENSE_DOCUMENT',
            classification: boundedClassification(response.classification),
            // Read but deliberately NOT applied: the gate refuses to mutate the draft, so these
            // stay a reviewer-facing suggestion they choose to accept, never a silent write.
            ...(response.fields ? { suggestedFields: response.fields } : {}),
            nextAction: 'review_attachment_or_upload_expense_evidence',
          },
        });
        await this.auditOutcome(ctx, expenseId, 'not_expense_document', attachment.id, 0, response.classification, response.modelLineage);
        return {
          status: 'not_expense_document',
          classification: response.classification,
          ...(response.fields ? { fields: response.fields } : {}),
        };
      }

      if (!response.fields) return this.finish(ctx, expenseId, 'failed', attachment.id, response.modelLineage);

      const applyOutcome = await this.applyService.apply(ctx, expenseId, response.fields, {
        ...(expense.updatedAt ? { expectedUpdatedAt: expense.updatedAt } : {}),
      });
      if (isStaleOcrApply(applyOutcome)) {
        // A correction landed while the model was thinking. Writing this result — header, lines,
        // duplicates OR the summary below — would undo it, so the whole write set is abandoned.
        await this.auditOutcome(ctx, expenseId, 'apply_skipped_stale');
        return this.finish(ctx, expenseId, 'failed', attachment.id, response.modelLineage);
      }
      const duplicateResult = applyOutcome;
      const missingFields = withEffectiveMissingFields(
        response.fields.missingFields,
        duplicateResult.categoryId ?? expense.expenseCategoryId,
        ocrLineVatRateUnknown(response.fields),
      );
      // AI classification defaults the review document type only while it is still
      // unclassified — a reviewer's explicit choice survives re-extraction.
      const suggestedDocType = toSourceDocumentType(sourceDocumentTypeFromClassification(response.classification));
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
        ...(taxEvidence ? {
          sourceDocumentType: suggestedDocType,
          taxEvidenceStatus: taxEvidence.taxEvidenceStatus,
          taxEvidenceReasonCode: taxEvidence.taxEvidenceReasonCode,
        } : {}),
        aiVerificationSummaryJson: {
          status: 'OCR_EXTRACTED_NEEDS_REVIEW',
          recognizedFields: response.fields,
          classification: boundedClassification(response.classification),
          missingFields,
          duplicateWarning: duplicateResult.candidatesCreated > 0,
          chargeReconciliation: {
            status: duplicateResult.chargeReconciliationStatus,
            chargesApplied: duplicateResult.chargesApplied,
          },
          nextAction: 'review_in_web',
        },
      });
      await this.auditOutcome(ctx, expenseId, 'ok', attachment.id, Object.keys(response.fields).length, response.classification, response.modelLineage);
      return { status: 'ok', fields: response.fields, missingFields, classification: response.classification };
    } catch (error) {
      this.logger.warn({ msg: 'Receipt OCR extraction failed', expenseId, error: (error as Error).message });
      return this.finish(ctx, expenseId, 'failed', attachment.id);
    }
  }

  private async finish(
    ctx: RequestContext,
    expenseId: string,
    status: Exclude<ExpenseExtractionResult['status'], 'ok'>,
    attachmentId?: string,
    modelLineage?: AiModelLineage[],
  ): Promise<ExpenseExtractionResult> {
    await this.auditOutcome(ctx, expenseId, status, attachmentId, 0, undefined, modelLineage);
    return { status };
  }

  private auditOutcome(
    ctx: RequestContext,
    expenseId: string,
    status: string,
    attachmentId?: string,
    recognizedFieldCount = 0,
    classification?: BusinessDocumentClassification,
    modelLineage?: AiModelLineage[],
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
        attachmentId: attachmentId ?? null,
        status,
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
