import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ExpenseCategorySummary, LineExpenseDraftRouteContext, LineIntakeCaptureHints, ReceiptOcrFieldResult, RequestContext } from '@watchdog-bms/contracts';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { UpdateExpenseDraftUseCase } from './expense-draft.use-case';
import {
  applyLineExpenseDraftAnswer,
  buildInitialLineExpenseDraftContinuation,
  formatLineExpenseDraftReply,
  lineExpenseDraftControl,
  materializedLineExpenseDraftItems,
  parseLineExpenseDraftContinuation,
  splitLineExpenseDraftReply,
  transitionLineExpenseDraft,
  type LineExpenseDraftContinuation,
  type LineExpenseDraftRejectedCandidate,
} from '../../domain/logic/line-expense-draft-conversation.logic';

const STATE_KEY = 'lineExpenseDraftContinuation';
const RESUMABLE = new Set(['OPEN', 'PAUSED', 'PAUSED_INTERRUPTED', 'INPUT_ENDED_COMPLETE', 'INPUT_ENDED_INCOMPLETE']);

type ContinuationRow = Awaited<ReturnType<PrismaExpenseRepository['listLineExpenseDraftContinuationRows']>>[number] & {
  state: LineExpenseDraftContinuation;
};

export type LineExpenseDraftConversationResult = {
  handled: boolean;
  status: 'UPDATED' | 'PAUSED' | 'ENDED' | 'CANCELLED' | 'TARGET_REQUIRED' | 'STALE' | 'NOT_FOUND';
  replyTexts: string[];
  expenseId?: string;
  workflowId?: string;
  acceptedFields: string[];
  resumeCapsule?: string;
};

function ordinal(text: string, count: number): number | null {
  const match = text.normalize('NFKC').trim().match(/^ร่าง\s*(\d{1,2})$/u);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < count ? index : null;
}

function label(row: ContinuationRow): string {
  const amount = Number(row.grandTotalAmount) > 0 ? ` · ${Number(row.grandTotalAmount).toLocaleString('th-TH')} บาท` : '';
  const date = row.expenseDate ? ` · ${row.expenseDate.toISOString().slice(0, 10)}` : '';
  const subject = row.vendorNameSnapshot ?? row.note;
  return `${row.expenseNumber ?? row.id}${date}${subject ? ` · ${subject.slice(0, 60)}` : ''}${amount}`;
}

function targetRequired(rows: ContinuationRow[]): LineExpenseDraftConversationResult {
  return {
    handled: true,
    status: 'TARGET_REQUIRED',
    acceptedFields: [],
    replyTexts: [[
      'มีร่างค่าใช้จ่ายมากกว่า 1 รายการ กรุณาเลือกก่อนเพื่อไม่ให้คำตอบไปผิดร่าง',
      ...rows.map((row, index) => `${index + 1}) ${label(row)}`),
      'ตอบ “ร่าง 1” หรือระบุเลขร่าง แล้วจึงตอบข้อมูลต่อได้ค่ะ',
    ].join('\n')],
  };
}

@Injectable()
export class LineExpenseDraftConversationUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly updateDraft: UpdateExpenseDraftUseCase,
  ) {}

  private async rows(ctx: RequestContext, chatKeyHash: string): Promise<ContinuationRow[]> {
    const rows = await this.repo.listLineExpenseDraftContinuationRows({
      companyId: ctx.companyId,
      userId: ctx.userId,
      chatKeyHash,
      scopes: ctx.scopes ?? {},
      take: 5,
    });
    return rows.flatMap((row) => {
      const state = parseLineExpenseDraftContinuation(row.sourceChannelMetadataJson?.[STATE_KEY]);
      return state && state.companyId === ctx.companyId && state.userId === ctx.userId
        && state.chatKeyHash === chatKeyHash && RESUMABLE.has(state.status)
        ? [{ ...row, state }]
        : [];
    });
  }

  async routeContexts(ctx: RequestContext, chatKeyHash: string): Promise<LineExpenseDraftRouteContext[]> {
    const rows = await this.rows(ctx, chatKeyHash);
    const openRows = rows.filter((row) => row.state.status === 'OPEN');
    const focusedExpenseId = rows.length === 1 ? rows[0]!.id : openRows.length === 1 ? openRows[0]!.id : undefined;
    return rows.map((row) => ({
      expenseId: row.id,
      label: label(row),
      status: row.state.status as LineExpenseDraftRouteContext['status'],
      questions: (row.id === focusedExpenseId ? row.state.unresolvedQuestions : []).slice(0, 64).map((question) => ({
        id: question.id,
        prompt: question.prompt.slice(0, 200),
        ...(question.itemRef ? { itemRef: question.itemRef } : {}),
      })),
    }));
  }

  async startFromReceipt(ctx: RequestContext, input: {
    expenseId: string;
    chatKeyHash: string;
    webhookEventId: string;
    ocrFields?: ReceiptOcrFieldResult | null;
    businessPurpose?: string;
    suggestedCategoryId?: string;
  }): Promise<LineExpenseDraftConversationResult> {
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, input.expenseId, undefined, ctx.scopes ?? {});
    if (!expense || expense.createdByUserId !== ctx.userId || expense.captureSource !== 'LINE_UPLOAD') {
      return { handled: true, status: 'NOT_FOUND', replyTexts: ['ไม่พบร่างนี้ในสิทธิ์หรือสาขาปัจจุบันค่ะ'], acceptedFields: [] };
    }
    if (expense.status !== 'DRAFT') {
      // An idempotent redelivery may find a legacy or already-progressed expense. Let the caller
      // use the proven receipt summary instead of attaching a collection workflow to a closed row.
      return { handled: false, status: 'NOT_FOUND', replyTexts: [], acceptedFields: [] };
    }
    const categories = await this.repo.listCategories(ctx.companyId);
    const existing = parseLineExpenseDraftContinuation(expense.sourceChannelMetadataJson?.[STATE_KEY]);
    if (existing && existing.userId === ctx.userId && existing.chatKeyHash === input.chatKeyHash) {
      return {
        handled: true,
        status: 'UPDATED',
        expenseId: expense.id,
        workflowId: existing.workflowId,
        acceptedFields: [],
        replyTexts: splitLineExpenseDraftReply(formatLineExpenseDraftReply({
          state: { ...existing, targetRevision: expense.updatedAt.toISOString() },
          categories,
          label: expense.expenseNumber ?? expense.id,
        })),
      };
    }

    const storedOcr = expense.aiVerificationSummaryJson?.['recognizedFields'];
    const ocr = input.ocrFields
      ?? (storedOcr && typeof storedOcr === 'object' && !Array.isArray(storedOcr)
        ? storedOcr as ReceiptOcrFieldResult
        : undefined);
    const sourceParts = [ocr?.expenseDate, ocr?.vendorName, input.businessPurpose];
    const itemHints = (ocr?.lines?.length
      ? ocr.lines.map((line) => ({
        sourceText: [line.description, line.quantity, line.unitPrice ?? line.amount].filter(Boolean).join(' '),
        description: line.description,
        quantity: line.quantity,
        ...(line.unitPrice ? { unitPrice: line.unitPrice } : { totalAmount: line.amount }),
        ...(input.suggestedCategoryId ? { expenseCategoryId: input.suggestedCategoryId } : {}),
        ...(typeof line.confidence === 'number' ? { confidence: line.confidence } : {}),
      }))
      : ocr?.description ? [{
        sourceText: [ocr.description, ocr.quantity, ocr.unitPrice ?? ocr.grandTotalAmount].filter(Boolean).join(' '),
        description: ocr.description,
        ...(ocr.quantity ? { quantity: ocr.quantity } : {}),
        ...(ocr.unitPrice ? { unitPrice: ocr.unitPrice } : ocr.grandTotalAmount ? { totalAmount: ocr.grandTotalAmount } : {}),
        ...(input.suggestedCategoryId ? { expenseCategoryId: input.suggestedCategoryId } : {}),
        ...(typeof ocr.confidence === 'number' ? { confidence: ocr.confidence } : {}),
      }] : expense.lines?.map((line) => ({
        sourceText: [line.description, line.quantity, line.unitPrice].filter(Boolean).join(' '),
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        ...(line.expenseCategoryId ? { expenseCategoryId: line.expenseCategoryId } : input.suggestedCategoryId ? { expenseCategoryId: input.suggestedCategoryId } : {}),
      })) ?? []);
    sourceParts.push(...itemHints.map((item) => item.sourceText));
    const state = buildInitialLineExpenseDraftContinuation({
      workflowId: randomUUID(),
      companyId: ctx.companyId,
      userId: ctx.userId,
      expenseId: expense.id,
      chatKeyHash: input.chatKeyHash,
      targetRevision: expense.updatedAt.toISOString(),
      provisionalExpenseDate: expense.expenseDate.toISOString().slice(0, 10),
      messageText: sourceParts.filter(Boolean).join(' '),
      webhookEventId: input.webhookEventId,
      hints: {
        confidence: ocr?.confidence ?? 1,
        ...(ocr?.expenseDate ? { expenseDate: ocr.expenseDate } : {}),
        ...(ocr?.vendorName ? { vendorName: ocr.vendorName } : {}),
        ...(input.businessPurpose ? { businessPurpose: input.businessPurpose } : {}),
        items: itemHints,
      },
      categories,
    });
    for (const provenance of Object.values(state.provenance)) provenance.source = 'LINE_MEDIA_OCR';
    const updated = await this.persist(ctx, expense, state, categories, [], [], false);
    const saved = { ...state, targetRevision: updated.updatedAt.toISOString() };
    return {
      handled: true,
      status: 'UPDATED',
      expenseId: expense.id,
      workflowId: state.workflowId,
      acceptedFields: [],
      replyTexts: splitLineExpenseDraftReply(formatLineExpenseDraftReply({ state: saved, categories, label: expense.expenseNumber ?? expense.id })),
    };
  }

  async execute(ctx: RequestContext, input: {
    messageText: string;
    chatKeyHash: string;
    webhookEventId?: string;
    captureHints?: LineIntakeCaptureHints;
  }): Promise<LineExpenseDraftConversationResult> {
    const rows = await this.rows(ctx, input.chatKeyHash);
    if (rows.length === 0) return { handled: false, status: 'NOT_FOUND', replyTexts: [], acceptedFields: [] };
    const requestedId = input.captureHints?.targetExpenseId;
    const selectedIndex = ordinal(input.messageText, rows.length);
    const openRows = rows.filter((row) => row.state.status === 'OPEN');
    const selected = requestedId
      ? rows.find((row) => row.id === requestedId)
      : selectedIndex !== null ? rows[selectedIndex]
        : rows.length === 1 ? rows[0]
          : openRows.length === 1 ? openRows[0]
            : undefined;
    if (!selected) return targetRequired(rows);

    const expense = await this.repo.findByIdWithRelations(ctx.companyId, selected.id, undefined, ctx.scopes ?? {});
    if (!expense || expense.createdByUserId !== ctx.userId || expense.captureSource !== 'LINE_UPLOAD' || expense.status !== 'DRAFT') {
      return { handled: true, status: 'NOT_FOUND', replyTexts: ['ไม่พบร่างนี้ในสิทธิ์หรือสาขาปัจจุบันค่ะ'], acceptedFields: [] };
    }
    const categories = await this.repo.listCategories(ctx.companyId);
    const control = lineExpenseDraftControl(input.messageText);
    if (['INPUT_ENDED_COMPLETE', 'INPUT_ENDED_INCOMPLETE'].includes(selected.state.status) && control !== 'resume') {
      const text = `${formatLineExpenseDraftReply({ state: selected.state, categories, label: label(selected) })}\n\nพิมพ์ “ต่อ” ก่อนหากต้องการแก้หรือเติมร่างนี้`;
      return { handled: true, status: 'ENDED', replyTexts: splitLineExpenseDraftReply(text), expenseId: expense.id, workflowId: selected.state.workflowId, acceptedFields: [] };
    }

    const changed = control
      ? { state: transitionLineExpenseDraft(selected.state, control), acceptedFields: [] as string[], rejectedCandidates: [] as LineExpenseDraftRejectedCandidate[] }
      : selectedIndex !== null
        ? { state: transitionLineExpenseDraft(selected.state, 'resume'), acceptedFields: [] as string[], rejectedCandidates: [] as LineExpenseDraftRejectedCandidate[] }
        : applyLineExpenseDraftAnswer({
          state: selected.state,
          messageText: input.messageText,
          hints: input.captureHints,
          categories,
          webhookEventId: input.webhookEventId,
        });

    try {
      if ((requestedId || selectedIndex !== null) && rows.length > 1) {
        const categories = await this.repo.listCategories(ctx.companyId);
        for (const row of rows) {
          if (row.id === selected.id || row.state.status !== 'OPEN') continue;
          const other = await this.repo.findByIdWithRelations(ctx.companyId, row.id, undefined, ctx.scopes ?? {});
          if (!other || other.createdByUserId !== ctx.userId || other.captureSource !== 'LINE_UPLOAD') continue;
          await this.persist(ctx, other, transitionLineExpenseDraft(row.state, 'interrupt'), categories, [], [], false, row.state.targetRevision);
        }
      }
      const updated = await this.persist(
        ctx, expense, changed.state, categories, changed.acceptedFields, changed.rejectedCandidates,
        !control && selectedIndex === null, selected.state.targetRevision,
      );
      const savedState = { ...changed.state, targetRevision: updated.updatedAt.toISOString() };
      const reply = formatLineExpenseDraftReply({ state: savedState, categories, acceptedFields: changed.acceptedFields, label: label(selected) });
      const status = savedState.status === 'PAUSED' || savedState.status === 'PAUSED_INTERRUPTED' ? 'PAUSED'
        : savedState.status === 'CANCELLED' ? 'CANCELLED'
          : savedState.status.startsWith('INPUT_ENDED_') ? 'ENDED'
            : 'UPDATED';
      return {
        handled: true,
        status,
        replyTexts: splitLineExpenseDraftReply(reply),
        expenseId: expense.id,
        workflowId: savedState.workflowId,
        acceptedFields: changed.acceptedFields,
        ...(status === 'PAUSED' ? { resumeCapsule: `↩️ ร่างค่าใช้จ่าย ${label(selected)} ยังอยู่ พิมพ์ “ต่อ” เมื่อต้องการทำต่อ` } : {}),
      };
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      return {
        handled: true,
        status: 'STALE',
        expenseId: expense.id,
        workflowId: selected.state.workflowId,
        acceptedFields: [],
        replyTexts: ['ร่างนี้ถูกแก้ไขจากเว็บหรืออีกข้อความแล้ว จึงไม่เขียนทับค่ะ กรุณาพิมพ์ “ต่อ” เพื่อโหลดข้อมูลล่าสุด'],
      };
    }
  }

  async interruptOpen(ctx: RequestContext, chatKeyHash: string, excludeExpenseIds: string[] = []): Promise<string | undefined> {
    const excluded = new Set(excludeExpenseIds);
    const rows = (await this.rows(ctx, chatKeyHash))
      .filter((row) => row.state.status === 'OPEN' && !excluded.has(row.id));
    if (rows.length === 0) return undefined;
    const categories = await this.repo.listCategories(ctx.companyId);
    const pausedRows: ContinuationRow[] = [];
    for (const row of rows) {
      const expense = await this.repo.findByIdWithRelations(ctx.companyId, row.id, undefined, ctx.scopes ?? {});
      if (!expense || expense.createdByUserId !== ctx.userId || expense.captureSource !== 'LINE_UPLOAD') continue;
      const state = transitionLineExpenseDraft(row.state, 'interrupt');
      try {
        await this.persist(ctx, expense, state, categories, [], [], false, row.state.targetRevision);
        pausedRows.push(row);
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    if (pausedRows.length === 0) return undefined;
    return pausedRows.length === 1
      ? `↩️ พักร่างค่าใช้จ่าย ${label(pausedRows[0]!)} ไว้แล้ว พิมพ์ “ต่อ” เมื่อต้องการกลับมาทำ`
      : `↩️ พักร่างค่าใช้จ่าย ${pausedRows.length} รายการไว้แล้ว พิมพ์ “ต่อ” เพื่อเลือกทำต่อ`;
  }

  private async persist(
    ctx: RequestContext,
    expense: Awaited<ReturnType<PrismaExpenseRepository['findByIdWithRelations']>> & {},
    state: LineExpenseDraftContinuation,
    categories: ExpenseCategorySummary[],
    acceptedFields: string[],
    rejectedCandidates: LineExpenseDraftRejectedCandidate[],
    materialize: boolean,
    expectedRevision = expense!.updatedAt.toISOString(),
  ) {
    const expected = new Date(expectedRevision);
    const nextUpdatedAt = new Date(Math.max(Date.now(), expected.getTime() + 1));
    state.targetRevision = nextUpdatedAt.toISOString();
    const acceptedProvenance = (acceptedFields.length > 0
      ? acceptedFields.map((field) => state.provenance[field])
      : state.version === 1 ? Object.values(state.provenance) : [])
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
    const metadata = {
      ...(expense!.sourceChannelMetadataJson ?? {}),
      [STATE_KEY]: state as unknown as Record<string, unknown>,
    };
    const collectionFields = new Set(['expenseDate', 'vendorName', 'businessPurpose', 'items', 'description', 'quantity', 'price', 'expenseCategoryId']);
    const existingMissing = Array.isArray(expense!.aiVerificationSummaryJson?.['missingFields'])
      ? expense!.aiVerificationSummaryJson!['missingFields'].filter((field): field is string => typeof field === 'string')
      : [];
    const missingFields = [...new Set([
      ...existingMissing.filter((field) => !collectionFields.has(field)),
      ...state.unresolvedQuestions.map((question) => question.field),
    ])];
    const lines = materializedLineExpenseDraftItems(state).map((line) => {
      const category = line.expenseCategoryId ? categories.find((candidate) => candidate.id === line.expenseCategoryId) : undefined;
      return { ...line, ...(category ? { accountHintKey: category.accountHintKey } : {}) };
    });
    return this.updateDraft.execute(ctx, expense!.id, {
      expectedUpdatedAt: expectedRevision,
      ...(state.header.expenseDate ? { expenseDate: state.header.expenseDate } : {}),
      ...(state.header.vendorName ? { vendorNameSnapshot: state.header.vendorName } : {}),
      ...(state.header.businessPurpose ? { note: state.header.businessPurpose } : {}),
      ...(materialize ? { lines } : {}),
    }, {
      requireExpectedUpdatedAt: true,
      suppressGenericAudit: true,
      lineDraftCollection: {
        sourceChannelMetadataJson: metadata,
        nextUpdatedAt,
        aiVerificationSummaryJson: {
          ...(expense!.aiVerificationSummaryJson ?? {}),
          status: 'LINE_DRAFT_COLLECTION',
          missingFields,
          lineDraftQuestionIds: state.unresolvedQuestions.map((question) => question.id),
          collectionState: state.status,
          collectionVersion: state.version,
          lastAcceptedFields: acceptedFields,
          lastRejectedCandidates: rejectedCandidates,
          nextAction: 'review_in_web',
        },
      },
      transactionalAudit: {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: acceptedFields.length > 0 || rejectedCandidates.length > 0
          ? 'expense.line_draft.answer'
          : state.version === 1 ? 'expense.line_draft.start' : 'expense.line_draft.transition',
        targetType: 'expense_record',
        targetId: expense!.id,
        requestId: ctx.requestId,
        result: 'SUCCESS',
        riskLevel: 'MEDIUM',
        metadataJson: {
          workflowId: state.workflowId,
          chatKeyHash: state.chatKeyHash,
          state: state.status,
          previousVersion: Math.max(0, state.version - 1),
          nextVersion: state.version,
          acceptedFields,
          rejectedCandidates,
          messageHashes: [...new Set(acceptedProvenance.map((value) => value.messageHash))],
          webhookEventIds: [...new Set(acceptedProvenance.flatMap((value) => value.webhookEventId ? [value.webhookEventId] : []))],
          remainingQuestionIds: state.unresolvedQuestions.map((question) => question.id),
        },
      },
    });
  }
}
