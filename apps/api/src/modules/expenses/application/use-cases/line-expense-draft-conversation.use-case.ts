import { bindSourceDraftLines, refreshExpenseSourceDraft, sourceDraftFinancialLines, SOURCE_DRAFT_MUTABLE_STATUSES } from '../../domain/logic/expense-source-draft.logic';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ExpenseCategorySummary, LineExpenseDraftRouteContext, LineIntakeCaptureHints, ReceiptOcrFieldResult, RequestContext } from '@watchdog-bms/contracts';
import { withPurposeNote } from '../../domain/logic/line-correction.logic';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { UpdateExpenseDraftUseCase } from './expense-draft.use-case';
import {
  applyLineExpenseDraftAnswer,
  collectLineExpenseDraftQuestions,
  buildInitialLineExpenseDraftContinuation,
  formatLineExpenseDraftReply,
  lineExpenseDraftControl,
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
  source?: {
    records: Array<{ id: string; updatedAt: Date }>;
    categories: Array<{ id: string; name: string }>;
    choices?: LineExpenseDraftRouteContext[];
  };
};

function replySource(expense: { id: string; updatedAt: Date }, state: LineExpenseDraftContinuation,
  categories: ExpenseCategorySummary[]): NonNullable<LineExpenseDraftConversationResult['source']> {
  const ids = new Set(state.items.flatMap(item => [item.expenseCategoryId, item.suggestedCategoryId]));
  return { records: [{ id: expense.id, updatedAt: expense.updatedAt }],
    categories: categories.filter(category => ids.has(category.id)).map(({ id, name }) => ({ id, name })) };
}

function routeContexts(rows: ContinuationRow[]): LineExpenseDraftRouteContext[] {
  const openRows = rows.filter((row) => row.state.status === 'OPEN');
  const focusedExpenseId = rows.length === 1 ? rows[0]!.id : openRows.length === 1 ? openRows[0]!.id : undefined;
  return rows.map((row) => ({
    expenseId: row.id, label: label(row), status: row.state.status as LineExpenseDraftRouteContext['status'],
    questions: (row.id === focusedExpenseId && row.state.status === 'OPEN' ? row.state.unresolvedQuestions : []).map((question) => ({
      id: question.id, prompt: question.prompt.slice(0, 200), ...(question.itemRef ? { itemRef: question.itemRef } : {}),
    })),
  }));
}

function ordinal(text: string, count: number): number | null {
  const match = text.normalize('NFKC').trim().match(/^ร่าง\s*(\d{1,2})$/u);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < count ? index : null;
}

function label(row: ContinuationRow): string {
  const incomplete = row.state.items.some((item) => !item.lineId || !item.quantity || (!item.unitPrice && !item.totalAmount) || item.reviewRequired);
  const amount = incomplete ? ' · ยอดรายการยังไม่ครบ' : Number.isFinite(Number(row.grandTotalAmount)) ? ` · ยอดในร่าง ${Number(row.grandTotalAmount).toLocaleString('th-TH')} บาท` : '';
  const date = row.expenseDate ? ` · ${row.expenseDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' })}` : '';
  const subject = row.vendorNameSnapshot ?? row.state.header.vendorName;
  return `${subject?.slice(0, 60) || 'ใบเสร็จ'}${date}${amount}`;
}

function targetRequired(rows: ContinuationRow[]): LineExpenseDraftConversationResult {
  return {
    handled: true,
    status: 'TARGET_REQUIRED',
    source: { records: rows.map(({ id, updatedAt }) => ({ id, updatedAt })), categories: [], choices: routeContexts(rows) },
    acceptedFields: [],
    replyTexts: [[
      'มีร่างค่าใช้จ่ายมากกว่า 1 รายการ กรุณาเลือกก่อนเพื่อไม่ให้คำตอบไปผิดร่าง',
      ...rows.map((row, index) => `${index + 1}) ${label(row)}`),
      'ระบุชื่อร้านหรือเลือก “ร่าง 1” เพื่อให้แก้ถูกใบค่ะ',
    ].join('\n')],
  };
}

@Injectable()
export class LineExpenseDraftConversationUseCase {
  private readonly logger = new Logger(LineExpenseDraftConversationUseCase.name);

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
      return state && state.expenseId === row.id && state.companyId === ctx.companyId && state.userId === ctx.userId
        && state.chatKeyHash === chatKeyHash && RESUMABLE.has(state.status)
        ? [{ ...row, state }]
        : [];
    });
  }

  async routeContexts(ctx: RequestContext, chatKeyHash: string): Promise<LineExpenseDraftRouteContext[]> {
    return routeContexts(await this.rows(ctx, chatKeyHash));
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
    if (!SOURCE_DRAFT_MUTABLE_STATUSES.includes(expense.status)) {
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
        source: replySource(expense, existing, categories),
        workflowId: existing.workflowId,
        acceptedFields: [],
        replyTexts: splitLineExpenseDraftReply(formatLineExpenseDraftReply({
          state: refreshExpenseSourceDraft(existing, expense, categories),
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
    let state = buildInitialLineExpenseDraftContinuation({
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
    state = refreshExpenseSourceDraft(bindSourceDraftLines(state, expense), expense, categories);
    // The caption is the user's current instruction; only OCR-derived facts yield to saved data.
    if (input.businessPurpose) state.header.businessPurpose = input.businessPurpose;
    // Vendor-address §11.3/§8: the FULL tax invoice is the only kind that must print the seller's
    // address, so it is the only kind that may ask for one — and only when neither the reader nor a
    // human has produced it. `applyLineExpenseDraftAnswer` clears the marker on the next turn.
    if (expense.sourceDocumentType === 'TAX_INVOICE' && !ocr?.vendorAddress && !expense.vendorAddressSnapshot) {
      state.header.vendorAddressAsk = true;
    }
    // Capturing an image preserves editable facts; only the user can start the conversation.
    state.status = 'PAUSED';
    state.unresolvedQuestions = collectLineExpenseDraftQuestions(state, categories);
    for (const provenance of Object.values(state.provenance)) provenance.source = 'LINE_MEDIA_OCR';
    const updated = await this.persist(ctx, expense, state, categories, input.businessPurpose ? ['D-PURPOSE'] : [], [], false);
    const saved = { ...state, targetRevision: updated.updatedAt.toISOString() };
    return {
      handled: true,
      status: 'UPDATED',
      expenseId: expense.id,
      source: replySource(updated, saved, categories),
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
    const requestedId = input.captureHints?.targetExpenseId;
    const selectedIndex = ordinal(input.messageText, rows.length);
    const openRows = rows.filter((row) => row.state.status === 'OPEN');
    // Explicit identity is a scoped lookup, independent of the recent-five discovery list.
    const requestedExpense = requestedId ? await this.repo.findByIdWithRelations(ctx.companyId, requestedId, undefined, ctx.scopes ?? {}) : null;
    const requestedState = parseLineExpenseDraftContinuation(requestedExpense?.sourceChannelMetadataJson?.[STATE_KEY]);
    const requested = requestedExpense && requestedState && requestedExpense.createdByUserId === ctx.userId
      && requestedState.expenseId === requestedExpense.id && requestedState.companyId === ctx.companyId && requestedState.userId === ctx.userId
      && requestedState.chatKeyHash === input.chatKeyHash && RESUMABLE.has(requestedState.status)
      ? { ...requestedExpense, state: requestedState } : undefined;
    if (!rows.length && !requested) return { handled: Boolean(requestedId), status: 'NOT_FOUND', replyTexts: requestedId ? ['ไม่พบร่างนี้ในสิทธิ์หรือสาขาปัจจุบันค่ะ'] : [], acceptedFields: [] };
    const selected = requestedId
      ? requested
      : selectedIndex !== null ? rows[selectedIndex]
        : rows.length === 1 ? rows[0]
          : openRows.length === 1 ? openRows[0]
            : undefined;
    if (!selected) return requestedId ? { handled: true, status: 'NOT_FOUND', replyTexts: ['ไม่พบร่างนี้ในสิทธิ์หรือสาขาปัจจุบันค่ะ'], acceptedFields: [] } : targetRequired(rows);

    const expense = await this.repo.findByIdWithRelations(ctx.companyId, selected.id, undefined, ctx.scopes ?? {});
    if (!expense || expense.createdByUserId !== ctx.userId || expense.captureSource !== 'LINE_UPLOAD' || !SOURCE_DRAFT_MUTABLE_STATUSES.includes(expense.status)) {
      return { handled: true, status: 'NOT_FOUND', replyTexts: ['ไม่พบร่างนี้ในสิทธิ์หรือสาขาปัจจุบันค่ะ'], acceptedFields: [] };
    }
    const categories = await this.repo.listCategories(ctx.companyId);
    const control = lineExpenseDraftControl(input.messageText);
    // A model-supplied target is not consent to restart a passive receipt draft.
    const explicitEdit = /แก้|เปลี่ยน|เติม|กรอก|ปรับ|ใช้เพื่อ|ใช้สำหรับ|^วันที่\s*[0-9๐-๙]|^(?:ผู้ขาย|ยอดรวม)\s*[:=]/u.test(input.messageText);
    // A paused receipt draft that asked the one address question is waiting for a plain sentence —
    // the spec's wording invites an address, not a keyword — so that single turn is let through.
    const addressAsked = selected.state.header.vendorAddressAsk === true;
    if (selected.state.status.startsWith('PAUSED') && !control && selectedIndex === null && !explicitEdit && !addressAsked) {
      return { handled: false, status: 'NOT_FOUND', replyTexts: [], acceptedFields: [] };
    }
    selected.state = control === 'resume' || selectedIndex !== null
      ? refreshExpenseSourceDraft(selected.state, expense, categories)
      : bindSourceDraftLines(selected.state, expense);
    if (['INPUT_ENDED_COMPLETE', 'INPUT_ENDED_INCOMPLETE'].includes(selected.state.status) && control !== 'resume' && !control) {
      return { handled: false, status: 'NOT_FOUND', replyTexts: [], acceptedFields: [] };
    }
    if (['INPUT_ENDED_COMPLETE', 'INPUT_ENDED_INCOMPLETE'].includes(selected.state.status) && control === 'end') {
      const currentState = refreshExpenseSourceDraft(selected.state, expense, categories);
      const text = `${formatLineExpenseDraftReply({ state: currentState, categories, label: label(selected) })}\n\nพิมพ์ “ต่อ” ก่อนหากต้องการแก้หรือเติมร่างนี้`;
      return { handled: true, status: 'ENDED', replyTexts: splitLineExpenseDraftReply(text), expenseId: expense.id,
        source: replySource(expense, currentState, categories), workflowId: selected.state.workflowId, acceptedFields: [] };
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

    changed.state = bindSourceDraftLines(changed.state, expense);
    changed.state.unresolvedQuestions = collectLineExpenseDraftQuestions(changed.state, categories);
    // §11.3: answering the one address question — or ignoring it — is not "resume the
    // questionnaire". A paused receipt draft stays paused, and the retired ask is persisted even
    // when the turn belonged to something else, so the card can never ask a second time.
    const addressTurnOnly = addressAsked && !control && selectedIndex === null
      && changed.acceptedFields.every((field) => field === 'D-ADDRESS');
    if (addressTurnOnly) changed.state.status = selected.state.status;
    if (!control && selectedIndex === null && changed.acceptedFields.length === 0 && changed.rejectedCandidates.length === 0) {
      if (addressAsked) {
        try { await this.persist(ctx, expense, changed.state, categories, [], [], false, selected.state.targetRevision); }
        catch (error) { if (!(error instanceof ConflictException)) throw error; }
      }
      return { handled: false, status: 'NOT_FOUND', replyTexts: [], acceptedFields: [] };
    }
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
      // Spec S1-R5: same override semantics as the web confirm path, on the mobile journey that
      // carries most of the traffic. Emitted only for a category answer that was actually stored,
      // and only when it is not the one AI proposed. Ids and booleans only.
      for (const item of savedState.items) {
        if (!changed.acceptedFields.includes(`${item.itemRef}-CATEGORY`)) continue;
        if (!item.expenseCategoryId || item.expenseCategoryId === item.suggestedCategoryId) continue;
        this.logger.log({
          msg: 'expense_category_overridden',
          companyId: ctx.companyId,
          expenseId: expense.id,
          surface: 'line',
          fromSuggested: Boolean(item.suggestedCategoryId),
        });
      }
      const reply = formatLineExpenseDraftReply({
        state: savedState, categories, acceptedFields: changed.acceptedFields, label: label(selected),
        includeQuestions: control === 'resume' || selectedIndex !== null || changed.acceptedFields.length === 0,
      });
      const status = savedState.status === 'PAUSED' || savedState.status === 'PAUSED_INTERRUPTED' ? 'PAUSED'
        : savedState.status === 'CANCELLED' ? 'CANCELLED'
          : savedState.status.startsWith('INPUT_ENDED_') ? 'ENDED'
            : 'UPDATED';
      return {
        handled: true,
        status,
        replyTexts: splitLineExpenseDraftReply(reply),
        expenseId: expense.id,
        source: replySource(updated, savedState, categories),
        workflowId: savedState.workflowId,
        acceptedFields: changed.acceptedFields,
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
    for (const row of rows) {
      const expense = await this.repo.findByIdWithRelations(ctx.companyId, row.id, undefined, ctx.scopes ?? {});
      if (!expense || expense.createdByUserId !== ctx.userId || expense.captureSource !== 'LINE_UPLOAD') continue;
      const state = transitionLineExpenseDraft(row.state, 'interrupt');
      try {
        await this.persist(ctx, expense, state, categories, [], [], false, row.state.targetRevision);
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    // A topic change parks the work silently; the user decides whether to resume.
    return undefined;
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
      // An answered address is no longer a gap: the OCR reading put `vendorAddress` here (§8's
      // warning), and leaving it would make the review form keep saying nobody read one.
      ...existingMissing.filter((field) => !collectionFields.has(field)
        && !(field === 'vendorAddress' && acceptedFields.includes('D-ADDRESS'))),
      ...state.unresolvedQuestions.map((question) => question.field),
    ])];
    const lines = materialize ? sourceDraftFinancialLines(state, expense, acceptedFields, categories) : undefined;
    return this.updateDraft.execute(ctx, expense!.id, {
      expectedUpdatedAt: expectedRevision,
      ...(acceptedFields.includes('D-DATE') && state.header.expenseDate ? { expenseDate: state.header.expenseDate } : {}),
      ...(acceptedFields.includes('D-VENDOR') && state.header.vendorName ? { vendorNameSnapshot: state.header.vendorName } : {}),
      // Vendor-address §11.3: the LINE answer goes to the SAME column the review form writes, so
      // the counterparty auto-save and the 50 ทวิ prefill see it exactly as if it had been typed there.
      ...(acceptedFields.includes('D-ADDRESS') && state.header.vendorAddress ? { vendorAddressSnapshot: state.header.vendorAddress } : {}),
      // Spec §5.3: the purpose gets its OWN segment and replaces the previous one, so refining the
      // answer never stacks and never takes the provenance note ("LINE receipt upload") with it.
      ...(acceptedFields.includes('D-PURPOSE') && state.header.businessPurpose ? { note: withPurposeNote(expense!.note, state.header.businessPurpose) } : {}),
      ...(lines ? { lines } : {}),
    }, {
      requireExpectedUpdatedAt: true,
      suppressGenericAudit: true,
      sourceExpense: expense,
      lineDraftCollection: {
        sourceChannelMetadataJson: metadata,
        nextUpdatedAt,
        aiVerificationSummaryJson: {
          ...(expense!.aiVerificationSummaryJson ?? {}),
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
