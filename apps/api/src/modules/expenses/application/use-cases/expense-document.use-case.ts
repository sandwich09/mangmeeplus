import { Injectable, ForbiddenException, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { CreateExpenseDraftUseCase } from './expense-draft.use-case';
import { validateCaptureHints, deriveTaxEvidence, toSourceDocumentType } from '../../domain/logic/expense-document.logic';
import { consumptionWithinTx, type ClarificationConsumption } from '../../../line-ai/application/line-ai-consumption-marker';
import type { ExpenseRecord } from '../../domain/models/expense.model';
import type {
  RequestContext, LineIntakeCaptureHints, CreateExpenseCategoryInput, UpdateExpenseCategoryInput,
  ExpenseCategorySummary,
} from '@watchdog-bms/contracts';
import { todayCivilDate } from '@watchdog-bms/contracts';

function hasPerm(ctx: RequestContext, perm: string): boolean {
  return ctx.permissions.includes(perm);
}

/**
 * LINE text-only expense-note capture (Paypers parity): the intake router
 * detected EXPENSE_DOCUMENT_CAPTURE for a text message such as `ค่ากาแฟ 65 บาท`.
 * AI provides semantic hints; deterministic guards decide what is inserted.
 * Creates a reviewable no-receipt draft — never a confirmed expense.
 */
@Injectable()
export class CaptureLineExpenseNoteUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly createDraft: CreateExpenseDraftUseCase,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(
    ctx: RequestContext,
    cmd: {
      messageText: string;
      captureHints?: LineIntakeCaptureHints;
      lineMessageId: string;
      lineEventId: string;
      /** Bounded hash of the chat this was captured in — a later correction may only target
       *  records captured in the SAME chat. Hash, never the raw LINE/group id. */
      chatKeyHash?: string;
      /** Clarifications this turn answered. Recorded INSIDE the draft transaction: an
       *  after-commit append would leave the window where a failed reply lets the next
       *  message inherit the same request and capture it twice. */
      consumption?: ClarificationConsumption;
    },
  ): Promise<{ expense: ExpenseRecord; warnings: string[]; insertedAmount: string | null; categoryId: string | null; categoryName: string | null }> {
    if (!hasPerm(ctx, 'expense.receipt.line_upload') && !hasPerm(ctx, 'expense.receipt.upload') && !hasPerm(ctx, 'expense.create')) {
      throw new ForbiddenException('Missing permission: expense.receipt.line_upload');
    }

    // Idempotency by LINE message id: retried webhooks return the existing draft.
    const existing = await this.repo.findByLineMessageId(ctx.companyId, cmd.lineMessageId);
    if (existing) {
      return { expense: existing, warnings: ['duplicate_line_message'], insertedAmount: existing.grandTotalAmount, categoryId: existing.expenseCategoryId, categoryName: null };
    }

    const activeCategories = await this.repo.listCategories(ctx.companyId);
    const validated = validateCaptureHints(cmd.captureHints ?? {}, new Set(activeCategories.map((c) => c.id)));

    // Text notes are never receipts by themselves: force the note document type
    // unless the model classified it as a note already.
    const sourceDocumentType = validated.sourceDocumentType === 'NEEDS_REVIEW' ? 'EXPENSE_NOTE_TEXT' : validated.sourceDocumentType;
    const taxEvidence = deriveTaxEvidence({
      sourceDocumentType,
      vendorName: validated.vendorName,
      lowConfidence: (cmd.captureHints?.confidence ?? 1) < 0.5,
    });

    const description = validated.description ?? cmd.messageText.trim().slice(0, 120);
    const amount = validated.amount;

    const expense = await this.createDraft.execute(ctx, {
      captureSource: 'LINE_UPLOAD',
      expenseDate: validated.expenseDate ?? todayCivilDate(),
      vatMode: validated.vatMode,
      inputVatClaimStatus: 'NEEDS_REVIEW',
      expenseCategoryId: validated.expenseCategoryId ?? undefined,
      missingReceiptReason: 'LINE text-only expense note; evidence file not attached',
      note: description,
      lines: amount
        ? [{ lineNumber: 1, description, quantity: '1', unitPrice: amount, expenseCategoryId: validated.expenseCategoryId ?? undefined }]
        : [],
    });

    const updated = await this.repo.updateExpense({
      id: expense.id,
      companyId: ctx.companyId,
      updatedByUserId: ctx.userId,
      status: 'NEEDS_REVIEW',
      lineMessageId: cmd.lineMessageId,
      lineEventId: cmd.lineEventId,
      sourceDocumentType,
      ...(validated.sourceDocumentLanguage ? { sourceDocumentLanguage: validated.sourceDocumentLanguage } : {}),
      taxEvidenceStatus: taxEvidence.taxEvidenceStatus,
      taxEvidenceReasonCode: taxEvidence.taxEvidenceReasonCode,
      ...(validated.vendorName ? { vendorNameSnapshot: validated.vendorName } : {}),
      aiVerificationStatus: 'NEEDS_REVIEW',
      aiVerificationSummaryJson: {
        status: 'TEXT_NOTE_SEMANTIC_CAPTURE',
        insertedFields: {
          amount: amount ?? undefined,
          expenseDate: validated.expenseDate ?? undefined,
          expenseCategoryId: validated.expenseCategoryId ?? undefined,
          sourceDocumentType,
          vendorName: validated.vendorName ?? undefined,
        },
        warnings: validated.warnings,
        missingFields: ['receipt_evidence', ...(amount ? [] : ['amount']), ...(validated.expenseCategoryId ? [] : ['category'])],
        nextAction: 'review_in_web',
      },
      sourceChannelMetadataJson: {
        channel: 'LINE', kind: 'text_note', messagePreview: cmd.messageText.slice(0, 120),
        ...(cmd.chatKeyHash ? { chatKeyHash: cmd.chatKeyHash } : {}),
      },
    }, consumptionWithinTx(cmd.consumption));

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.line_upload.receive', targetType: 'expense_record', targetId: expense.id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { kind: 'text_note', insertedAmount: amount ?? null, categoryId: validated.expenseCategoryId ?? null, warnings: validated.warnings },
    });
    void this.outbox.append('expense.line_receipt_uploaded', 'expense_record', expense.id, {
      companyId: ctx.companyId, aggregateType: 'expense_record', aggregateId: expense.id, requestId: ctx.requestId,
      occurredAt: new Date().toISOString(), data: { expenseId: expense.id, kind: 'text_note' },
    });

    const categoryName = validated.expenseCategoryId
      ? activeCategories.find((c) => c.id === validated.expenseCategoryId)?.name ?? null
      : null;
    return { expense: updated, warnings: validated.warnings, insertedAmount: amount, categoryId: validated.expenseCategoryId, categoryName };
  }
}

// ─── Category management (expense.category.manage) ──────────────────────────
// LINE/AI can never call these: they are web/API admin actions only.

@Injectable()
export class CreateExpenseCategoryUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, input: CreateExpenseCategoryInput): Promise<ExpenseCategorySummary> {
    if (!hasPerm(ctx, 'expense.category.manage')) throw new ForbiddenException('Missing permission: expense.category.manage');
    if (!input.name?.trim()) throw new BadRequestException('Category name is required');
    if (!input.accountHintKey?.trim()) throw new BadRequestException('accountHintKey is required');
    try {
      const category = await this.repo.createCategory(ctx.companyId, { ...input, name: input.name.trim() });
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'expense.category.create', targetType: 'expense_category', targetId: category.id,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { name: category.name },
      });
      return category;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new ConflictException(`Category name already exists: ${input.name}`);
      throw err;
    }
  }
}

@Injectable()
export class UpdateExpenseCategoryUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, categoryId: string, input: UpdateExpenseCategoryInput): Promise<ExpenseCategorySummary> {
    if (!hasPerm(ctx, 'expense.category.manage')) throw new ForbiddenException('Missing permission: expense.category.manage');
    const existing = await this.repo.findCategoryById(ctx.companyId, categoryId);
    if (!existing) throw new NotFoundException('Category not found or is a read-only system default');
    if (input.name !== undefined && !input.name.trim()) throw new BadRequestException('Category name cannot be empty');
    try {
      const updated = await this.repo.updateCategory(ctx.companyId, categoryId, {
        ...input,
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      });
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'expense.category.update', targetType: 'expense_category', targetId: categoryId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: { name: updated.name, status: updated.status },
      });
      return updated;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new ConflictException(`Category name already exists: ${input.name}`);
      throw err;
    }
  }
}

@Injectable()
export class ListAllExpenseCategoriesUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext): Promise<ExpenseCategorySummary[]> {
    if (!hasPerm(ctx, 'expense.category.manage')) throw new ForbiddenException('Missing permission: expense.category.manage');
    return this.repo.listAllCategories(ctx.companyId);
  }
}
