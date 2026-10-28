import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { coerceCivilDate, expenseDateIsReadable, type ExpenseCategorySummary, type ExpenseSourceDraft, type ExpenseSourceDraftInput, type CreateExpenseDraftInput } from '@watchdog-bms/contracts';
import type { ExpenseRecord, ExpenseRecordWithRelations } from '../models/expense.model';
import { LINE_NOTE_PURPOSE_PREFIX } from './line-correction.logic';
import { storedLineToInput } from './line-draft-update.logic';
import {
  buildInitialLineExpenseDraftContinuation, collectLineExpenseDraftQuestions,
  materializedLineExpenseDraftItems, parseLineExpenseDraftContinuation, nextLineExpenseDraftItemRef,
  expenseDraftItemLimit, type LineExpenseDraftContinuation, type LineExpenseDraftItem,
} from './line-expense-draft-conversation.logic';

export const EXPENSE_SOURCE_DRAFT_KEY = 'lineExpenseDraftContinuation';
export const SOURCE_DRAFT_MUTABLE_STATUSES = ['DRAFT', 'NEEDS_REVIEW'];
const ordinaryFields = ['description', 'quantity', 'unitPrice', 'expenseCategoryId'] as const;
type Expense = ExpenseRecord & Pick<ExpenseRecordWithRelations, 'lines'>;

function purpose(note: string | null): string | undefined {
  return note?.split(' · ').find((part) => part.startsWith(LINE_NOTE_PURPOSE_PREFIX))?.slice(LINE_NOTE_PURPOSE_PREFIX.length).trim() || undefined;
}
function facts(line: Expense['lines'][number]) {
  return { description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
    ...(line.expenseCategoryId ? { expenseCategoryId: line.expenseCategoryId } : {}) };
}

/** Resolve by persisted identity or an unambiguous source description. Never use row position. */
export function bindSourceDraftLines(state: LineExpenseDraftContinuation, expense: Expense, refresh = false): LineExpenseDraftContinuation {
  const next = structuredClone(state);
  const used = new Set<string>();
  for (const item of next.items) {
    let line = item.lineId ? expense.lines.find((candidate) => candidate.id === item.lineId) : undefined;
    if (!line && !item.lineId) {
      const matches = expense.lines.filter((candidate) => !candidate.chargeKind && candidate.description === item.description && !used.has(candidate.id));
      if (matches.length === 1) {
        const candidate = matches[0]!;
        const reconciliation = expense.aiVerificationSummaryJson?.['chargeReconciliation'];
        const reconciledItems = reconciliation !== null && typeof reconciliation === 'object'
          && !Array.isArray(reconciliation) && 'status' in reconciliation && reconciliation.status === 'RECONCILED_ITEM_LINES';
        const quantityProven = Boolean(item.quantity);
        const priceProven = Boolean(item.unitPrice || item.totalAmount);
        const numericMatch = quantityProven && priceProven && new Decimal(item.quantity!).eq(candidate.quantity)
          && (item.unitPrice ? new Decimal(item.unitPrice).eq(candidate.unitPrice) : new Decimal(item.totalAmount!).eq(new Decimal(candidate.quantity).mul(candidate.unitPrice)));
        if (reconciledItems || numericMatch) line = candidate;
        else item.reviewRequired = true;
      }
      else if (matches.length > 1) item.reviewRequired = true;
    }
    if (!line) {
      if (item.lineId || (!item.newItem && expense.lines.some((candidate) => !candidate.chargeKind))) item.reviewRequired = true;
      continue;
    }
    if (line.chargeKind) { item.reviewRequired = true; continue; }
    if (used.has(line.id)) { item.reviewRequired = true; continue; }
    used.add(line.id);
    const current = facts(line);
    if (refresh && item.materializedFacts) {
      for (const field of ordinaryFields) {
        if (current[field] !== item.materializedFacts[field]) {
          if (current[field] === undefined) delete item[field];
          else item[field] = current[field];
          if (field === 'unitPrice') delete item.totalAmount;
        }
      }
    } else if (!item.lineId) {
      // The persisted financial row is the authoritative projection, including accepted category.
      // Matching never promotes summary defaults into facts the source did not contain.
      if (item.quantity) item.quantity = current.quantity;
      if (item.unitPrice || item.totalAmount) { item.unitPrice = current.unitPrice; delete item.totalAmount; }
      if (line.expenseCategoryId) item.expenseCategoryId = line.expenseCategoryId;
    }
    item.lineId = line.id;
    item.materializedFacts = current;
    delete item.reviewRequired;
  }
  return next;
}

/** A stale resume is a read of current facts, never just a new version on an old payload. */
export function refreshExpenseSourceDraft(state: LineExpenseDraftContinuation, expense: Expense, categories: ExpenseCategorySummary[]): LineExpenseDraftContinuation {
  const next = bindSourceDraftLines(state, expense, true);
  const prior = (state as LineExpenseDraftContinuation & { materializedHeader?: Record<string, string | null> }).materializedHeader;
  const header = { expenseDate: expense.expenseDate?.toISOString().slice(0, 10) ?? null, vendorName: expense.vendorNameSnapshot ?? null, businessPurpose: purpose(expense.note) ?? null };
  for (const field of ['expenseDate', 'vendorName', 'businessPurpose'] as const) {
    if (prior ? prior[field] !== header[field] : field !== 'expenseDate' || Boolean(state.header.expenseDate)) {
      if (header[field]) next.header[field] = header[field]!;
      else delete next.header[field];
    }
  }
  next.targetRevision = expense.updatedAt.toISOString();
  next.unresolvedQuestions = collectLineExpenseDraftQuestions(next, categories);
  return next;
}

export function sourceDraftState(expense: Expense, categories: ExpenseCategorySummary[]): LineExpenseDraftContinuation | null {
  const raw = expense.sourceChannelMetadataJson?.[EXPENSE_SOURCE_DRAFT_KEY];
  const existing = parseLineExpenseDraftContinuation(raw);
  if (raw && !existing) return null;
  if (existing) {
    if (existing.companyId !== expense.companyId || existing.expenseId !== expense.id || existing.userId !== expense.createdByUserId) return null;
    return existing.targetRevision === expense.updatedAt.toISOString()
      ? existing : refreshExpenseSourceDraft(existing, expense, categories);
  }
  if (!['LINE_UPLOAD', 'WEB_UPLOAD'].includes(expense.captureSource) || ![...SOURCE_DRAFT_MUTABLE_STATUSES, 'READY_FOR_CONFIRMATION'].includes(expense.status)) return null;
  const recognized = expense.aiVerificationSummaryJson?.['recognizedFields'] as Record<string, any> | undefined;
  const missing = new Set(Array.isArray(expense.aiVerificationSummaryJson?.['missingFields']) ? expense.aiVerificationSummaryJson!['missingFields'] as string[] : []);
  const ocrItems = Array.isArray(recognized?.lines) ? recognized.lines : [];
  const hints = ocrItems.length ? ocrItems.map((line: any) => ({
    sourceText: [line.description, line.quantity, line.unitPrice ?? line.amount].filter((value) => value !== undefined && value !== null).join(' '),
    description: line.description, quantity: line.quantity,
    ...(line.unitPrice !== undefined && line.unitPrice !== null ? { unitPrice: line.unitPrice } : { totalAmount: line.amount }),
  })) : recognized?.description ? [{ sourceText: [recognized.description, recognized.quantity, recognized.unitPrice ?? recognized.grandTotalAmount].filter((value) => value !== undefined && value !== null).join(' '), description: recognized.description, quantity: recognized.quantity, ...(recognized.unitPrice !== undefined ? { unitPrice: recognized.unitPrice } : { totalAmount: recognized.grandTotalAmount }) }] : expense.lines.filter((line) => !line.chargeKind && Boolean(expense.reviewedAt) && line.reviewStatus === 'REVIEWED').map((line) => ({ sourceText: `${line.description} ${line.quantity} ${line.unitPrice}`, ...facts(line) }));
  const date = recognized?.expenseDate ?? (expense.reviewedAt && !missing.has('expenseDate') ? expense.expenseDate?.toISOString().slice(0, 10) : undefined);
  const vendor = expense.vendorNameSnapshot ?? recognized?.vendorName;
  const businessPurpose = purpose(expense.note);
  const state = buildInitialLineExpenseDraftContinuation({
    itemSource: 'LINE_MEDIA_OCR',
    workflowId: randomUUID(), companyId: expense.companyId, userId: expense.createdByUserId, expenseId: expense.id,
    // Web staging must not invent a reachable LINE conversation or enable the feature flag.
    chatKeyHash: typeof expense.sourceChannelMetadataJson?.['chatKeyHash'] === 'string' ? expense.sourceChannelMetadataJson['chatKeyHash'] : '',
    targetRevision: expense.updatedAt.toISOString(), provisionalExpenseDate: expense.expenseDate.toISOString().slice(0, 10),
    messageText: [date, vendor, businessPurpose, ...hints.map((item) => item.sourceText)].filter(Boolean).join(' '),
    hints: { confidence: 1, expenseDate: date, vendorName: vendor, businessPurpose, items: hints }, categories,
  });
  state.status = 'PAUSED';
  // This value is already stored/reviewed, not a bounded LINE extraction hint.
  if (businessPurpose) state.header.businessPurpose = businessPurpose;
  if (!hints.length) state.items = [];
  const bound = bindSourceDraftLines(state, expense);
  bound.unresolvedQuestions = collectLineExpenseDraftQuestions(bound, categories);
  return bound;
}

export function projectExpenseSourceDraft(state: LineExpenseDraftContinuation, canEdit: boolean): ExpenseSourceDraft {
  return {
    status: state.status, canEdit,
    header: { expenseDate: state.header.expenseDate ?? null, vendorName: state.header.vendorName ?? null, businessPurpose: state.header.businessPurpose ?? null },
    items: state.items.map((item) => ({ itemRef: item.itemRef, lineId: item.lineId ?? null, description: item.description ?? null,
      ...(item.newItem && { newItem: true }),
      quantity: item.quantity ?? null, unitPrice: item.unitPrice ?? null, totalAmount: item.totalAmount ?? null, expenseCategoryId: item.expenseCategoryId ?? null })),
    missingFields: state.unresolvedQuestions.map(({ id, scope, itemRef, field, prompt }) => ({ id, scope, ...(itemRef ? { itemRef } : {}), field, prompt })),
  };
}

function invalid(message: string): never { throw new BadRequestException({ code: 'EXPENSE_SOURCE_DRAFT_INVALID', message }); }
function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Source facts must be an object.');
  if (Object.keys(value).some((key) => !allowed.includes(key))) return invalid('Unknown or restricted source field.');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string | undefined {
  if (value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > max) return invalid('Source text is invalid or too long.');
  return value.trim() || undefined;
}
function decimal(value: unknown, positive: boolean): string | undefined {
  const raw = text(value, 24);
  if (!raw) return undefined;
  if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/u.test(raw)) return invalid('Source quantity or price is invalid.');
  const result = new Decimal(raw);
  if (!result.isFinite() || result.isNegative() || (positive && !result.gt(0))) return invalid('Source quantity must be positive and price non-negative.');
  return result.toString();
}

export function applyExpenseSourceDraftInput(state: LineExpenseDraftContinuation, input: ExpenseSourceDraftInput, categories: ExpenseCategorySummary[]): { state: LineExpenseDraftContinuation; acceptedFields: string[] } {
  const raw = record(input, ['expenseDate', 'vendorName', 'businessPurpose', 'items']);
  const next = structuredClone(state);
  const acceptedFields: string[] = [];
  const itemLimit = expenseDraftItemLimit(state);
  for (const [field, suffix] of [['expenseDate', 'DATE'], ['vendorName', 'VENDOR'], ['businessPurpose', 'PURPOSE']] as const) {
    if (raw[field] === undefined) continue;
    const value = text(raw[field], field === 'expenseDate' ? 10 : field === 'businessPurpose' ? 500 : 200);
    if (value && field === 'expenseDate') {
      try { if (coerceCivilDate(value) !== value) invalid('Source date must be YYYY-MM-DD.'); } catch { invalid('Source date must be a real YYYY-MM-DD date.'); }
    }
    if (value && field === 'businessPurpose' && value.includes(' · ')) throw new BadRequestException({
      code: 'EXPENSE_PURPOSE_TEXT_INVALID', message: 'Source purpose cannot contain the note separator “ · ”.',
    });
    if (value) next.header[field] = value; else delete next.header[field];
    acceptedFields.push(`D-${suffix}`);
  }
  if (raw.items !== undefined) {
    if (!Array.isArray(raw.items) || raw.items.length > itemLimit) invalid(`Source draft supports at most ${itemLimit} items.`);
    const seen = new Set<string>();
    for (const candidate of raw.items) {
      const patch = record(candidate, ['itemRef', 'description', 'quantity', 'unitPrice', 'totalAmount', 'expenseCategoryId']);
      let item: LineExpenseDraftItem | undefined;
      if (patch.itemRef !== undefined) {
        if (typeof patch.itemRef !== 'string' || seen.has(patch.itemRef)) invalid('Unknown or repeated source item reference.');
        seen.add(patch.itemRef);
        item = next.items.find((item) => item.itemRef === patch.itemRef);
        if (!item) invalid('Unknown source item reference.');
      } else {
        if (next.items.length >= itemLimit) invalid(`Source draft supports at most ${itemLimit} items.`);
        item = { itemRef: nextLineExpenseDraftItemRef(next.items, itemLimit), sourceText: '', newItem: true };
        next.items.push(item);
      }
      if (patch.unitPrice != null && patch.unitPrice !== '' && patch.totalAmount != null && patch.totalAmount !== '') invalid('Supply either unit price or total amount.');
      for (const [field, suffix] of [['description', 'DESC'], ['quantity', 'QTY'], ['unitPrice', 'PRICE'], ['totalAmount', 'PRICE'], ['expenseCategoryId', 'CATEGORY']] as const) {
        if (patch[field] === undefined) continue;
        const value = field === 'quantity' || field === 'unitPrice' || field === 'totalAmount'
          ? decimal(patch[field], field === 'quantity') : text(patch[field], field === 'description' ? 120 : 100);
        if (field === 'expenseCategoryId' && value && !categories.some((category) => category.id === value && category.status === 'ACTIVE')) invalid('Source category is inactive or outside this company.');
        if (value) item[field] = value; else delete item[field];
        if (field === 'unitPrice' && value !== undefined) delete item.totalAmount;
        if (field === 'totalAmount' && value !== undefined) delete item.unitPrice;
        acceptedFields.push(`${item.itemRef}-${suffix}`);
      }
    }
  }
  next.version += 1;
  next.lastActivityAt = new Date().toISOString();
  next.unresolvedQuestions = collectLineExpenseDraftQuestions(next, categories);
  if (next.status.startsWith('INPUT_ENDED_')) next.status = next.unresolvedQuestions.length ? 'INPUT_ENDED_INCOMPLETE' : 'INPUT_ENDED_COMPLETE';
  return { state: next, acceptedFields: [...new Set(acceptedFields)] };
}

/** Patch only accepted item facts, preserving the complete stored row and all unrelated charges. */
export function sourceDraftFinancialLines(state: LineExpenseDraftContinuation, expense: Expense, acceptedFields: string[], categories: ExpenseCategorySummary[]): CreateExpenseDraftInput['lines'] | undefined {
  const accepted = new Set(acceptedFields);
  const lines = expense.lines.map((line) => ({ ...storedLineToInput(line), sourceLineId: line.id }));
  let changed = false;
  for (const item of state.items) {
    if (!acceptedFields.some((field) => field.startsWith(`${item.itemRef}-`)) || item.reviewRequired) continue;
    const materialized = materializedLineExpenseDraftItems({ ...state, items: [item] })[0];
    if (!materialized) continue; // Incomplete edits remain staged; financial rows are never fabricated/deleted.
    const index = item.lineId ? expense.lines.findIndex((line) => line.id === item.lineId) : -1;
    if (item.lineId && index < 0) continue;
    const original = index >= 0 ? lines[index]! : undefined;
    const patch = original ? { ...original } : { ...materialized };
    // Earlier partial turns may have staged an edit while quantity/price was still missing.
    // Apply those differences when the row becomes complete, using its last stored facts.
    const pending = (field: keyof NonNullable<LineExpenseDraftItem['materializedFacts']>) => item.materializedFacts
      && (field === 'unitPrice' ? materialized.unitPrice : item[field]) !== item.materializedFacts[field];
    if (!original || accepted.has(`${item.itemRef}-DESC`) || pending('description')) patch.description = materialized.description;
    if (!original || accepted.has(`${item.itemRef}-QTY`) || pending('quantity')) patch.quantity = materialized.quantity;
    if (!original || accepted.has(`${item.itemRef}-PRICE`) || pending('unitPrice') || (item.totalAmount && accepted.has(`${item.itemRef}-QTY`))) patch.unitPrice = materialized.unitPrice;
    if (!original || accepted.has(`${item.itemRef}-CATEGORY`) || pending('expenseCategoryId')) {
      patch.expenseCategoryId = item.expenseCategoryId;
      if (!original) patch.accountHintKey = categories.find((category) => category.id === item.expenseCategoryId)?.accountHintKey;
    }
    if (original && JSON.stringify(original) === JSON.stringify(patch)) continue;
    if (index >= 0) lines[index] = patch as typeof lines[number]; else lines.push(patch as typeof lines[number]);
    changed = true;
  }
  if (!changed) return undefined;
  return [...lines.filter((line) => !line.chargeKind), ...lines.filter((line) => line.chargeKind)]
    .map((line, index) => ({ ...line, lineNumber: index + 1 }));
}

export function sourceDraftSummary(summary: Record<string, unknown> | null, state: LineExpenseDraftContinuation): Record<string, unknown> {
  const fields = new Set(['expenseDate', 'vendor', 'vendorName', 'businessPurpose', 'items', 'description', 'quantity', 'price', 'category', 'expenseCategoryId', 'review']);
  const old = Array.isArray(summary?.['missingFields']) ? summary!['missingFields'].filter((field): field is string => typeof field === 'string' && !fields.has(field)) : [];
  return { ...summary, missingFields: [...new Set([...old, ...state.unresolvedQuestions.map((question) => question.field)])],
    lineDraftQuestionIds: state.unresolvedQuestions.map((question) => question.id), collectionState: state.status, collectionVersion: state.version };
}

export function assertExpenseSourceDraftComplete(metadata: Record<string, unknown> | null | undefined, expense?: Expense): void {
  // OCR failure and disabled conversation collection still expose staged facts on GET. Enforce
  // those same facts before the first partial save, including legacy READY records.
  if (metadata?.[EXPENSE_SOURCE_DRAFT_KEY] || expense?.captureSource === 'LINE_UPLOAD') {
    const state = metadata?.[EXPENSE_SOURCE_DRAFT_KEY]
      ? parseLineExpenseDraftContinuation(metadata[EXPENSE_SOURCE_DRAFT_KEY]) : expense ? sourceDraftState(expense, []) : null;
    const missingFields = state ? [...new Set(collectLineExpenseDraftQuestions(state, []).map(question => question.field))] : ['items'];
    if (missingFields.length > 0) throw new BadRequestException({
      code: 'EXPENSE_SOURCE_DRAFT_INCOMPLETE', message: 'Complete the saved source draft before submitting or confirming this expense.',
      missingFields,
    });
  }
  if (expense && !expenseDateIsReadable(expense.aiVerificationSummaryJson)) throw new BadRequestException({
    code: 'EXPENSE_DOCUMENT_DATE_REVIEW_REQUIRED', message: 'ตรวจวันที่ในใบเสร็จที่ขั้นตรวจข้อมูล แล้วบันทึกก่อนส่งให้ตรวจหรือยืนยันค่ะ',
  });
}
