import { assertExpenseFinancialAccess } from '../expense-commercial-access';
import type { SetExpenseCategoryAccountantAccountInput } from '@watchdog-bms/contracts';
import { Injectable, ForbiddenException, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { CreateExpenseDraftUseCase } from './expense-draft.use-case';
import {
  validateCaptureHints, deriveTaxEvidence, assessLineTextExpenseCapture, toSourceDocumentType,
  LINE_TEXT_NOTE_MISSING_RECEIPT_MARKER,
} from '../../domain/logic/expense-document.logic';
import { consumptionWithinTx, type ClarificationConsumption } from '../../../line-ai/application/line-ai-consumption-marker';
import type { ExpenseRecord } from '../../domain/models/expense.model';
import type {
  RequestContext, LineIntakeCaptureHints, LineIntakeClarificationField, CreateExpenseCategoryInput,
  UpdateExpenseCategoryInput, ExpenseCategorySummary,
} from '@watchdog-bms/contracts';
import { extractValueCandidates, todayCivilDate, lineReplyLanguage } from '@watchdog-bms/contracts';
import { refreshExpenseSourceDraft } from '../../domain/logic/expense-source-draft.logic';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { resolveNameCandidate } from '../../../line-ai/domain/logic/business-read-source.logic';
import {
  buildInitialLineExpenseDraftContinuation,
  formatLineExpenseDraftReply,
  isClearlyNonExpenseDirection,
  isLineExpenseDraftStartEligible,
  materializedLineExpenseDraftItems,
  lineExpenseNoteDescription,
  parseLineExpenseDraftContinuation,
  splitLineExpenseDraftReply,
} from '../../domain/logic/line-expense-draft-conversation.logic';

function hasPerm(ctx: RequestContext, perm: string): boolean {
  return ctx.permissions.includes(perm);
}

/** NAT12 (2026-09-29): `line-draft:<event>` never matched the draft key rule `[A-Za-z0-9_-]{8,64}`, so every
 *  LINE text expense note since 3d7379ef failed as "Invalid draft idempotency key" and the chat got the generic
 *  temporary-error reply. A LINE event/message id is used as is; anything else (a 64-hex task operation id) is
 *  hashed to fit. */
export function lineDraftIdempotencyKey(sourceId: string): string {
  return `line-draft-${/^[A-Za-z0-9_-]{1,53}$/u.test(sourceId) ? sourceId : createHash('sha256').update(sourceId).digest('hex').slice(0, 53)}`;
}

/** Typed incomplete result (spec §8.2). The three field lists are BOUNDED ENUM members only — never raw
 *  conversation, values or PII — so the dispatcher can ask for exactly what is missing and never re-ask
 *  for a field the gate already accepted. Defaults keep every legacy `new ...()` call site valid. */
export class LineTextExpenseCaptureIncompleteError extends BadRequestException {
  constructor(
    readonly acceptedFields: LineIntakeClarificationField[] = [],
    readonly missingFields: LineIntakeClarificationField[] = [],
    readonly conflictingFields: LineIntakeClarificationField[] = [],
  ) {
    super('LINE text expense capture requires a source-grounded expense purpose or item');
  }
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
      counterparty?: { id: string; name: string; taxId: string | null; address: string | null; entityKind: import('@watchdog-bms/contracts').BuyerEntityKind | null };
      captureHints?: LineIntakeCaptureHints;
      /** Exact original clarification requests resolved by this turn; never general chat history. */
      groundingTexts?: string[];
      lineMessageId: string;
      lineEventId: string;
      /** LINE has no branch picker: the dispatcher resolves the same default the photo lane uses
       *  (`pickLineDefaultBranchId`) and hands it in. Scope and ACTIVE status are still re-validated
       *  by `CreateExpenseDraftUseCase`; absent means "the rule found nothing" — unchanged behaviour. */
      branchId?: string;
      /** Default-off rollout gate. False preserves the proven single-turn capture behavior. */
      draftConversationEnabled?: boolean;
      /** Phase 1B (spec §8.1): true ONLY when the route the server verified said
       *  `BUSINESS_EXPENSE` + `COMPANY_PAID`. It is the single switch that lets a grounded
       *  `businessPurpose` satisfy completeness; default false keeps the exact legacy gate. */
      semanticBusinessExpenseConfirmed?: boolean;
      /** Bounded hash of the chat this was captured in — a later correction may only target
       *  records captured in the SAME chat. Hash, never the raw LINE/group id. */
      chatKeyHash?: string;
      /** Clarifications this turn answered. Recorded INSIDE the draft transaction: an
       *  after-commit append would leave the window where a failed reply lets the next
       *  message inherit the same request and capture it twice. */
      consumption?: ClarificationConsumption;
    },
  ): Promise<{
    expense: ExpenseRecord;
    warnings: string[];
    insertedAmount: string | null;
    categoryId: string | null;
    categoryName: string | null;
    categoryNameSourceId: string | null;
    replyTexts: string[];
  }> {
    if (!hasPerm(ctx, 'expense.receipt.line_upload') && !hasPerm(ctx, 'expense.receipt.upload') && !hasPerm(ctx, 'expense.create')) {
      throw new ForbiddenException('Missing permission: expense.receipt.line_upload');
    }
    const draftConversationEnabled = cmd.draftConversationEnabled === true;
    if (cmd.semanticBusinessExpenseConfirmed) {
      const candidates = extractValueCandidates(cmd.messageText, todayCivilDate('Asia/Bangkok'));
      const monetary = candidates.amounts.filter(value => value.currencyToken);
      const amounts = [...new Set((monetary.length ? monetary : candidates.amounts).map(value => value.value))];
      // Intake already admitted the action; recover omitted slots from its exact source, never a new route.
      cmd = { ...cmd, captureHints: { ...cmd.captureHints,
        ...(!cmd.captureHints?.amount && amounts.length === 1 ? { amount: amounts[0] } : {}),
        ...(!cmd.captureHints?.description ? { description: lineExpenseNoteDescription(cmd.messageText) } : {}),
      } };
    }

    // Idempotency by LINE message id: retried webhooks return the existing draft.
    const duplicate = await this.repo.findByLineMessageId(ctx.companyId, cmd.lineMessageId);
    if (duplicate) {
      const existing = await this.repo.findByIdWithRelations(ctx.companyId, duplicate.id, undefined, ctx.scopes ?? {});
      if (!existing || existing.companyId !== ctx.companyId || existing.createdByUserId !== ctx.userId || existing.captureSource !== 'LINE_UPLOAD'
        || !isBranchInScope(ctx.scopes ?? {}, existing.branchId)
        || (cmd.chatKeyHash && existing.sourceChannelMetadataJson?.chatKeyHash !== cmd.chatKeyHash)) {
        throw new ForbiddenException('Original LINE capture is outside current ownership or chat');
      }
      const categories = await this.repo.listCategories(ctx.companyId);
      const state = parseLineExpenseDraftContinuation(existing.sourceChannelMetadataJson?.['lineExpenseDraftContinuation']);
      const replyTexts = draftConversationEnabled && existing.status === 'DRAFT' && state
        && state.userId === ctx.userId && state.companyId === ctx.companyId && state.expenseId === existing.id
        && (!cmd.chatKeyHash || state.chatKeyHash === cmd.chatKeyHash)
        ? splitLineExpenseDraftReply(formatLineExpenseDraftReply({ language: lineReplyLanguage(cmd.messageText), state: refreshExpenseSourceDraft(state, existing, categories), categories, label: existing.expenseNumber ?? existing.id }))
        : [];
      return {
        expense: existing,
        warnings: ['duplicate_line_message'],
        insertedAmount: Number(existing.grandTotalAmount) > 0 ? existing.grandTotalAmount : null,
        categoryId: existing.expenseCategoryId,
        categoryName: null,
        categoryNameSourceId: null,
        replyTexts,
      };
    }

    // A description alone is not an expense; keep it in the open task instead of creating a zero-value record.
    const sourceValues = extractValueCandidates(cmd.messageText, todayCivilDate('Asia/Bangkok'));
    if (!sourceValues.amounts.length && !sourceValues.dates.length && !sourceValues.periods?.some(period => period.kind === 'day')) {
      throw new LineTextExpenseCaptureIncompleteError();
    }
    const activeCategories = await this.repo.listCategories(ctx.companyId);
    if (cmd.semanticBusinessExpenseConfirmed && !cmd.captureHints?.expenseCategoryId) {
      const description = lineExpenseNoteDescription(cmd.messageText);
      const category = description && resolveNameCandidate(description, activeCategories);
      if (category && category.kind === 'resolved') cmd = { ...cmd, captureHints: { ...cmd.captureHints, expenseCategoryId: category.id } };
    }
    const assessment = assessLineTextExpenseCapture(
      cmd.messageText,
      cmd.captureHints ?? {},
      new Map(activeCategories.map((category) => [category.id, category.name])),
      cmd.groundingTexts,
      { semanticBusinessExpenseConfirmed: cmd.semanticBusinessExpenseConfirmed === true },
    );
    if (draftConversationEnabled && isClearlyNonExpenseDirection(cmd.messageText)) {
      // Wrong direction, not a missing field: the generic clarification is the honest answer here.
      throw new LineTextExpenseCaptureIncompleteError();
    }
    const conversationEligible = draftConversationEnabled && isLineExpenseDraftStartEligible(cmd.messageText, cmd.captureHints, cmd.semanticBusinessExpenseConfirmed);
    // A conflict is zero-write on BOTH lanes (§8.3 rule 3): the draft conversation would otherwise open a
    // draft on one of two competing amounts, which is exactly the silent pick the user must resolve. Only
    // the semantic lane ever reports one, so without `semanticBusinessExpenseConfirmed` this condition is
    // byte-for-byte the legacy `!eligible && !conversationEligible`.
    if (assessment.conflictingFields.length > 0 || (!assessment.eligible && !conversationEligible)) {
      throw new LineTextExpenseCaptureIncompleteError(
        assessment.acceptedFields, assessment.missingFields, assessment.conflictingFields,
      );
    }
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
    const provisionalDate = todayCivilDate();
    const initialState = conversationEligible ? buildInitialLineExpenseDraftContinuation({
      workflowId: randomUUID(),
      companyId: ctx.companyId,
      userId: ctx.userId,
      expenseId: 'pending',
      chatKeyHash: cmd.chatKeyHash ?? createHash('sha256').update(cmd.lineMessageId).digest('hex').slice(0, 24),
      targetRevision: new Date().toISOString(),
      provisionalExpenseDate: provisionalDate,
      messageText: cmd.messageText,
      webhookEventId: cmd.lineEventId,
      hints: {
        ...(cmd.captureHints ?? {}),
        sourceDocumentType: validated.sourceDocumentType,
        vatMode: validated.vatMode,
        ...(validated.sourceDocumentLanguage ? { sourceDocumentLanguage: validated.sourceDocumentLanguage } : {}),
        ...(validated.vendorName ? { vendorName: validated.vendorName } : {}),
        ...(validated.description ? { description: validated.description } : {}),
        ...(validated.expenseDate ? { expenseDate: validated.expenseDate } : {}),
        ...(validated.amount ? { amount: validated.amount } : {}),
        ...(validated.expenseCategoryId ? { expenseCategoryId: validated.expenseCategoryId } : {}),
      },
      categories: activeCategories,
      applyCategoryHints: true,
    }) : undefined;
    const draftLines = initialState
      ? materializedLineExpenseDraftItems(initialState)
      : amount
        ? [{ lineNumber: 1, description, quantity: '1', unitPrice: amount, expenseCategoryId: validated.expenseCategoryId ?? undefined }]
        : [];
    // The document carries a category only when every item shares one (as the photo path writes it);
    // differing item categories stay on their own lines.
    const itemCategoryIds = new Set(initialState?.items.map((item) => item.expenseCategoryId));
    const documentCategoryId = initialState
      ? (itemCategoryIds.size === 1 ? initialState.items[0]?.expenseCategoryId : undefined)
      : validated.expenseCategoryId;

    const rates = [...cmd.messageText.matchAll(/(?:หัก\s*ณ\s*ที่จ่าย|WHT)\s*(\d+(?:\.\d+)?)\s*%/giu)];
    const rateValues = [...new Set(rates.map(rate => rate[1]!))];
    if (rateValues.length > 1) throw new BadRequestException('กรุณาระบุอัตราหัก ณ ที่จ่ายเดียวสำหรับรายการนี้ค่ะ');
    const whtInput = rateValues.length === 1 && !/(?:ไม่|งด|ยกเว้น)\s*(?:หัก\s*ณ\s*ที่จ่าย|WHT)/iu.test(cmd.messageText)
      ? { inputType: 'RATE' as const, value: rateValues[0]! } : undefined;
    const expense = await this.createDraft.execute(ctx, {
      captureSource: 'LINE_UPLOAD',
      ...(whtInput ? { whtInput } : {}),
      ...(cmd.counterparty ? { vendorCounterpartyId: cmd.counterparty.id } : {}),
      idempotencyKey: lineDraftIdempotencyKey(cmd.lineEventId ?? cmd.lineMessageId),
      // The LINE branch default the dispatcher resolved (Owner 2026-08-27). Absent — no caller, or
      // a company where the rule found nothing to pick — leaves the create resolver's own rule in
      // charge exactly as before.
      ...(cmd.branchId ? { branchId: cmd.branchId } : {}),
      expenseDate: initialState?.header.expenseDate ?? validated.expenseDate ?? provisionalDate,
      vatMode: validated.vatMode,
      ...(documentCategoryId ? { expenseCategoryId: documentCategoryId } : {}),
      missingReceiptReason: LINE_TEXT_NOTE_MISSING_RECEIPT_MARKER,
      note: initialState?.header.businessPurpose ?? description,
      lines: draftLines,
    });

    const state = initialState ? {
      ...initialState,
      expenseId: expense.id,
      targetRevision: expense.updatedAt?.toISOString?.() ?? initialState.targetRevision,
    } : undefined;

    // Pin the row and continuation to one exact revision. Without this explicit timestamp Prisma's
    // @updatedAt would advance the row while metadata kept the previous value, making every later
    // answer look current (or every honest stale check fail).
    const priorRevision = expense.updatedAt instanceof Date
      ? expense.updatedAt
      : new Date(state?.targetRevision ?? Date.now());
    const continuationRevision = state
      ? new Date(Math.max(Date.now(), priorRevision.getTime() + 1))
      : undefined;
    if (state && continuationRevision) state.targetRevision = continuationRevision.toISOString();

    const lineDraftAudit = state ? {
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.line_draft.start', targetType: 'expense_record', targetId: expense.id,
      requestId: ctx.requestId, result: 'SUCCESS' as const, riskLevel: 'MEDIUM' as const,
      metadataJson: {
        workflowId: state.workflowId,
        chatKeyHash: state.chatKeyHash,
        previousVersion: 0,
        nextVersion: state.version,
        webhookEventIds: [cmd.lineEventId],
        questionIds: state.unresolvedQuestions.map((question) => question.id),
      },
    } : undefined;
    const consumeWithinTx = consumptionWithinTx(cmd.consumption);

    let updated: ExpenseRecord;
    try {
      updated = await this.repo.updateExpense({
        id: expense.id,
        companyId: ctx.companyId,
        updatedByUserId: ctx.userId,
        ...(state ? { expectedUpdatedAt: priorRevision, updatedAt: continuationRevision } : {}),
        status: state ? 'DRAFT' : 'NEEDS_REVIEW',
        lineMessageId: cmd.lineMessageId,
        lineEventId: cmd.lineEventId,
        sourceDocumentType,
        ...(validated.sourceDocumentLanguage ? { sourceDocumentLanguage: validated.sourceDocumentLanguage } : {}),
        taxEvidenceStatus: taxEvidence.taxEvidenceStatus,
        taxEvidenceReasonCode: taxEvidence.taxEvidenceReasonCode,
        ...(validated.vendorName ? { vendorNameSnapshot: validated.vendorName } : {}),
        ...(cmd.counterparty ? { vendorNameSnapshot: cmd.counterparty.name, ...(cmd.counterparty.taxId ? { vendorTaxIdSnapshot: cmd.counterparty.taxId } : {}),
          vendorAddressSnapshot: cmd.counterparty.address, ...(cmd.counterparty.entityKind ? { vendorEntityKindSnapshot: cmd.counterparty.entityKind } : {}) } : {}),
        aiVerificationStatus: 'NEEDS_REVIEW',
        aiVerificationSummaryJson: state ? {
          status: 'TEXT_NOTE_SEMANTIC_CAPTURE',
          insertedFields: {
            amount: draftLines.length ? validated.amount ?? undefined : undefined,
            expenseDate: validated.expenseDate ?? undefined,
            sourceDocumentType,
            vendorName: validated.vendorName ?? undefined,
          },
          categorySuggestions: state.items.flatMap((item) => item.suggestedCategoryId
            ? [{ itemRef: item.itemRef, expenseCategoryId: item.suggestedCategoryId }]
            : []),
          warnings: validated.warnings,
          missingFields: [...new Set(['receipt_evidence', ...state.unresolvedQuestions.map((question) => question.field)])],
          lineDraftQuestionIds: state.unresolvedQuestions.map((question) => question.id),
          collectionState: state.status,
          collectionVersion: state.version,
          nextAction: 'review_in_web',
        } : {
          status: 'TEXT_NOTE_SEMANTIC_CAPTURE',
          insertedFields: {
            amount: amount ?? undefined,
            expenseDate: validated.expenseDate ?? undefined,
            expenseCategoryId: validated.expenseCategoryId ?? undefined,
            sourceDocumentType,
            vendorName: validated.vendorName ?? undefined,
          },
          warnings: validated.warnings,
          // Spec §5.2: `expenseDate` fell back to `provisionalDate` (today) a few lines above and
          // nothing said so — the same silent placeholder the receipt path had. The collection
          // branch above already asks for the date through `unresolvedQuestions`; this branch has
          // no conversation to ask, so the flag is the only thing that tells the reviewer.
          missingFields: ['receipt_evidence', ...(amount ? [] : ['amount']), ...(validated.expenseCategoryId ? [] : ['category']), ...(validated.expenseDate ? [] : ['expenseDate'])],
          nextAction: 'review_in_web',
        },
        sourceChannelMetadataJson: {
          channel: 'LINE', kind: 'text_note', messagePreview: cmd.messageText.slice(0, 120),
          ...(cmd.chatKeyHash ? { chatKeyHash: cmd.chatKeyHash } : {}),
          ...(state ? { lineExpenseDraftContinuation: state as unknown as Record<string, unknown> } : {}),
        },
      }, consumeWithinTx || lineDraftAudit
        ? async (tx) => {
          await consumeWithinTx?.(tx);
          if (lineDraftAudit) await this.audit.log(lineDraftAudit, tx);
        }
        : undefined);
    } catch (error) {
      // The line idempotency key is attached by the update above. If that transaction rolls back,
      // remove only the untouched row we just created; otherwise a retry could create a second
      // orphan that findByLineMessageId cannot discover.
      if (state) await this.repo.deleteDraftExpense(ctx.companyId, expense.id, priorRevision);
      throw error;
    }

    if (!state) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'expense.line_upload.receive', targetType: 'expense_record', targetId: expense.id,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: {
          kind: 'text_note', insertedAmount: amount ?? null,
          categoryId: validated.expenseCategoryId ?? null, warnings: validated.warnings,
        },
      });
    }
    void this.outbox.append('expense.line_receipt_uploaded', 'expense_record', expense.id, {
      companyId: ctx.companyId, aggregateType: 'expense_record', aggregateId: expense.id, requestId: ctx.requestId,
      occurredAt: new Date().toISOString(), data: { expenseId: expense.id, kind: 'text_note' },
    });

    const suggestedCategoryId = state?.items.find((item) => item.suggestedCategoryId)?.suggestedCategoryId
      ?? validated.expenseCategoryId;
    const categoryName = suggestedCategoryId
      ? activeCategories.find((c) => c.id === suggestedCategoryId)?.name ?? null
      : null;
    const replyTexts = state
      ? splitLineExpenseDraftReply(formatLineExpenseDraftReply({ language: lineReplyLanguage(cmd.messageText), state, categories: activeCategories, label: updated.expenseNumber ?? updated.id }))
      : [];
    return {
      expense: updated,
      warnings: validated.warnings,
      insertedAmount: state ? (draftLines.length ? updated.grandTotalAmount : null) : amount,
      categoryId: state ? updated.expenseCategoryId ?? null : validated.expenseCategoryId,
      categoryName,
      categoryNameSourceId: categoryName ? suggestedCategoryId ?? null : null,
      replyTexts,
    };
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
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    return this.repo.listAllCategories(ctx.companyId);
  }
}

@Injectable()
export class SetExpenseCategoryAccountantAccountUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, categoryId: string, input: SetExpenseCategoryAccountantAccountInput) {
    if (!hasPerm(ctx, 'expense.category.manage')) throw new ForbiddenException('Missing permission: expense.category.manage');
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    const account = await this.repo.upsertCategoryAccountantAccount(ctx.companyId, categoryId, input, ctx.userId);
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      action: 'expense.category.accountant_account.set', targetType: 'expense_category', targetId: categoryId,
      result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { ...account },
    });
    return account;
  }
}

@Injectable()
export class ClearExpenseCategoryAccountantAccountUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, categoryId: string): Promise<void> {
    if (!hasPerm(ctx, 'expense.category.manage')) throw new ForbiddenException('Missing permission: expense.category.manage');
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    await this.repo.deleteCategoryAccountantAccount(ctx.companyId, categoryId);
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      action: 'expense.category.accountant_account.clear', targetType: 'expense_category', targetId: categoryId,
      result: 'SUCCESS', riskLevel: 'LOW',
    });
  }
}
