import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import {
  extractValueCandidates,
  isAmbiguousDateCandidate,
  type ExpenseCategorySummary,
  type LineExpenseAccountingClass,
  type LineExpenseItemBehavior,
  type LineIntakeCaptureHints,
  type LineIntakeExpenseItemHint,
} from '@watchdog-bms/contracts';
import { EXPENSE_VENDOR_ADDRESS_MAX_LENGTH } from './expense-vendor-identity.logic';

export const MAX_LINE_EXPENSE_DRAFT_ITEMS = 40;
const MAX_ITEMS = MAX_LINE_EXPENSE_DRAFT_ITEMS;
const MAX_TEXT = 200;
/** Vendor-address §11.3: the ONE question a receipt capture may ask, worded by the spec. */
export const LINE_VENDOR_ADDRESS_PROMPT = 'อ่านที่อยู่ร้านจากใบไม่ได้ พิมพ์ที่อยู่ตามใบได้เลย หรือพิมพ์ ข้าม';
/** "ข้าม" and the two ways people actually decline it. Declining is an answer, not a failure. */
const VENDOR_ADDRESS_DECLINED_RE = /^(?:ข้าม|ไม่มี|ไม่ทราบ)$/u;
/**
 * The reply counts as the address only when it READS like one — a house number, one of the address
 * words §7's own normalizer knows, or a postal code. The question invites a plain sentence, so a
 * turn that is really about something else ("ยอดรวมเท่าไรนะ") must move on instead of being filed
 * as the shop's address: this value auto-saves into the counterparty registry.
 */
const VENDOR_ADDRESS_ANSWER_RE = /^\d+[\d/\-]*\s|ถนน|ถ\.|ซอย|ซ\.|หมู่|ตำบล|ต\.|แขวง|อำเภอ|อ\.|เขต|จังหวัด|จ\.|\d{5}/u;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/u;

export type LineExpenseDraftStatus =
  | 'OPEN'
  | 'PAUSED'
  | 'PAUSED_INTERRUPTED'
  | 'INPUT_ENDED_COMPLETE'
  | 'INPUT_ENDED_INCOMPLETE'
  | 'CANCELLED';

export type LineExpenseDraftQuestion = {
  id: string;
  scope: 'DOCUMENT' | 'ITEM';
  itemRef?: string;
  field: string;
  prompt: string;
};

export type LineExpenseDraftItem = {
  itemRef: string;
  sourceText: string;
  lineId?: string;
  materializedFacts?: { description: string; quantity: string; unitPrice: string; expenseCategoryId?: string };
  reviewRequired?: boolean;
  newItem?: boolean;
  description?: string;
  quantity?: string;
  unit?: string;
  unitPrice?: string;
  totalAmount?: string;
  expenseCategoryId?: string;
  suggestedCategoryId?: string;
  accountingClass?: LineExpenseAccountingClass;
  itemBehavior?: LineExpenseItemBehavior;
  taxTreatment?: string;
  confidence?: number;
  advisorySource?: 'AI_GATEWAY';
  advisoryRuleVersion?: 'line-expense-draft-v1';
};

export type LineExpenseDraftContinuation = {
  schemaVersion: 1;
  workflowId: string;
  kind: 'EXPENSE_DRAFT_COLLECTION';
  companyId: string;
  userId: string;
  expenseId: string;
  chatKeyHash: string;
  status: LineExpenseDraftStatus;
  version: number;
  targetRevision: string;
  header: {
    expenseDate?: string;
    provisionalExpenseDate: string;
    vendorName?: string;
    businessPurpose?: string;
    /** The seller address this draft collected over LINE; `persist` writes it to the record. */
    vendorAddress?: string;
    /**
     * Vendor-address §11.3: set once, on a full tax invoice whose seller address could not be read.
     * It is what makes the capture card ask, and the next answering turn clears it — so the question
     * is asked exactly once, an answer, a "ข้าม" and silence all end it, and it never blocks (§8).
     * Deliberately NOT a `collectLineExpenseDraftQuestions` entry: those are completeness gates.
     */
    vendorAddressAsk?: true;
  };
  items: LineExpenseDraftItem[];
  provenance: Record<string, {
    source: 'LINE_USER_TEXT' | 'LINE_AI_SOURCE_GROUNDED' | 'LINE_MEDIA_OCR' | 'WEB_USER';
    acceptedAt: string;
    messageHash: string;
    webhookEventId?: string;
  }>;
  unresolvedQuestions: LineExpenseDraftQuestion[];
  lastActivityAt: string;
  inputEndedAt?: string;
};

export type LineExpenseDraftControl = 'pause' | 'resume' | 'end' | 'cancel';

export type LineExpenseDraftRejectedCandidate = {
  field: string;
  reason: 'NOT_GROUNDED_OR_INVALID' | 'UNKNOWN_ITEM' | 'UNKNOWN_OR_UNCONFIRMED_CATEGORY' | 'ITEM_LIMIT_REACHED';
};

function normalized(value: string): string {
  // NFC, not NFKC: NFKC decomposes สระอำ (U+0E33 → U+0E4D U+0E32) and NFC cannot recompose it,
  // so NFKC-normalized text can never match the precomposed Thai phrase regexes in this file.
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function bounded(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = normalized(value);
  return result ? result.slice(0, max) : undefined;
}

function decimal(value: unknown, positive = false): string | undefined {
  if (typeof value !== 'string') return undefined;
  const candidate = value.replace(/,/gu, '').trim();
  if (!DECIMAL_PATTERN.test(candidate)) return undefined;
  try {
    const parsed = new Decimal(candidate);
    if (!parsed.isFinite() || parsed.isNegative() || (positive && !parsed.gt(0))) return undefined;
    return parsed.toDecimalPlaces(4).toString();
  } catch {
    return undefined;
  }
}

function numericValues(text: string): Decimal[] {
  return text.match(/\d[\d,]*(?:\.\d{1,4})?/gu)?.flatMap((value) => {
    try { return [new Decimal(value.replace(/,/gu, ''))]; } catch { return []; }
  }) ?? [];
}

function groundedNumber(text: string, value: string | undefined, positive = false): string | undefined {
  const parsed = decimal(value, positive);
  if (!parsed) return undefined;
  const wanted = new Decimal(parsed);
  // A spoken amount ("สามร้อยบาท", NAT-12) is the same evidence as its digits.
  const spoken = () => extractValueCandidates(text).amounts.some((amount) => {
    try { return new Decimal(amount.value).eq(wanted); } catch { return false; }
  });
  return numericValues(text).some((candidate) => candidate.eq(wanted)) || spoken() ? parsed : undefined;
}

function groundedText(text: string, value: unknown): string | undefined {
  const candidate = bounded(value);
  if (!candidate) return undefined;
  return normalized(text).toLocaleLowerCase('th-TH').includes(candidate.toLocaleLowerCase('th-TH'))
    ? candidate
    : undefined;
}

function groundedDate(text: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  return extractValueCandidates(text).dates.some((candidate) =>
    candidate.isoDate === value && !isAmbiguousDateCandidate(candidate)) ? value : undefined;
}

function messageHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function categoryMap(categories: readonly ExpenseCategorySummary[]): Map<string, ExpenseCategorySummary> {
  return new Map(categories.map((category) => [category.id, category]));
}

function activeCategoryId(value: unknown, categories: Map<string, ExpenseCategorySummary>): string | undefined {
  return typeof value === 'string' && categories.has(value) ? value : undefined;
}

function initialItem(
  hint: LineIntakeExpenseItemHint,
  index: number,
  messageText: string,
  categories: Map<string, ExpenseCategorySummary>,
): LineExpenseDraftItem | null {
  const sourceText = groundedText(messageText, hint.sourceText)
    ?? groundedText(messageText, hint.description);
  if (!sourceText) return null;
  const description = bounded(hint.description, 120) ?? sourceText.slice(0, 120);
  const unit = groundedText(messageText, hint.unit)?.slice(0, 30);
  // Numeric evidence must occur inside this item's own bounded source span. A number belonging to
  // a laptop elsewhere in the message must never become the paper quantity merely because the
  // model returned it on the wrong item.
  const quantity = groundedNumber(sourceText, hint.quantity, true);
  const unitPrice = groundedNumber(sourceText, hint.unitPrice);
  const totalAmount = groundedNumber(sourceText, hint.totalAmount);
  const hasAdvisory = Boolean(hint.accountingClass || hint.itemBehavior || bounded(hint.taxTreatment, 80));
  return {
    itemRef: `I${String(index + 1).padStart(2, '0')}`,
    sourceText,
    description,
    ...(quantity ? { quantity } : {}),
    ...(unit ? { unit } : {}),
    // When both representations are present, retain the source total and derive a safe unit price
    // during materialization. Keeping both lets a later correction appear accepted while the old
    // unit price silently wins.
    ...(totalAmount ? { totalAmount } : unitPrice ? { unitPrice } : {}),
    ...(activeCategoryId(hint.expenseCategoryId, categories) ? { suggestedCategoryId: hint.expenseCategoryId } : {}),
    ...(hint.accountingClass ? { accountingClass: hint.accountingClass } : {}),
    ...(hint.itemBehavior ? { itemBehavior: hint.itemBehavior } : {}),
    ...(bounded(hint.taxTreatment, 80) ? { taxTreatment: bounded(hint.taxTreatment, 80) } : {}),
    ...(typeof hint.confidence === 'number' && hint.confidence >= 0 && hint.confidence <= 1 ? { confidence: hint.confidence } : {}),
    ...(hasAdvisory ? { advisorySource: 'AI_GATEWAY' as const, advisoryRuleVersion: 'line-expense-draft-v1' as const } : {}),
  };
}

export function collectLineExpenseDraftQuestions(
  state: Pick<LineExpenseDraftContinuation, 'header' | 'items'>,
  categories: readonly ExpenseCategorySummary[],
): LineExpenseDraftQuestion[] {
  const result: LineExpenseDraftQuestion[] = [];
  if (!state.header.expenseDate) result.push({ id: 'D-DATE', scope: 'DOCUMENT', field: 'expenseDate', prompt: 'วันที่ซื้อหรือวันที่จ่ายคือวันไหน?' });
  if (!state.header.vendorName) result.push({ id: 'D-VENDOR', scope: 'DOCUMENT', field: 'vendorName', prompt: 'ซื้อจากร้านหรือผู้ขายชื่ออะไร?' });
  if (state.items.length === 0) result.push({ id: 'D-ITEMS', scope: 'DOCUMENT', field: 'items', prompt: 'มีสินค้าหรือบริการอะไรบ้าง?' });
  const names = new Map(categories.map((category) => [category.id, category.name]));
  for (const item of state.items) {
    if (!item.description) result.push({ id: `${item.itemRef}-DESC`, scope: 'ITEM', itemRef: item.itemRef, field: 'description', prompt: `${item.itemRef} รายการนี้คือสินค้า/บริการอะไร?` });
    if (!item.quantity) result.push({ id: `${item.itemRef}-QTY`, scope: 'ITEM', itemRef: item.itemRef, field: 'quantity', prompt: `${item.itemRef} ${item.description ?? 'รายการนี้'} จำนวนเท่าไร และหน่วยอะไร?` });
    if (!item.unitPrice && !item.totalAmount) result.push({ id: `${item.itemRef}-PRICE`, scope: 'ITEM', itemRef: item.itemRef, field: 'price', prompt: `${item.itemRef} ${item.description ?? 'รายการนี้'} ราคาต่อหน่วยหรือยอดรวมเท่าไร?` });
    if (item.reviewRequired) result.push({ id: `${item.itemRef}-REVIEW`, scope: 'ITEM', itemRef: item.itemRef, field: 'review', prompt: `${item.itemRef} ตรวจรายการนี้ในเว็บก่อน เพื่อเก็บรายการและภาษีเดิมให้ครบ` });
    if (!item.expenseCategoryId) {
      const suggestion = item.suggestedCategoryId ? names.get(item.suggestedCategoryId) : undefined;
      result.push({
        id: `${item.itemRef}-CATEGORY`, scope: 'ITEM', itemRef: item.itemRef, field: 'expenseCategoryId',
        prompt: suggestion
          ? `${item.itemRef} ยืนยันหมวด “${suggestion}” หรือระบุหมวดอื่น`
          : `${item.itemRef} ต้องการจัดอยู่ในหมวดค่าใช้จ่ายใด?`,
      });
    }
  }
  return result;
}

export function isLineExpenseDraftStartEligible(messageText: string, hints?: LineIntakeCaptureHints): boolean {
  if ((hints?.confidence ?? 0) < 0.6) return false;
  if (isClearlyNonExpenseDirection(messageText)) return false;
  if (!/(ซื้อ|จ่าย|ชำระ|ค่า(?:ใช้จ่าย)?|บิล|ใบเสร็จ|expense|paid|purchase)/iu.test(messageText)) return false;
  return Boolean(hints?.items?.length
    || groundedText(messageText, hints?.description)
    || groundedText(messageText, hints?.businessPurpose));
}

/** Deterministic fail-closed guard for common directions that must never be forced into ExpenseRecord. */
export function isClearlyNonExpenseDirection(messageText: string): boolean {
  const text = normalized(messageText).toLocaleLowerCase('th-TH');
  return /(?:รายรับ|รับเงิน|เงินเข้า|ลูกค้าจ่าย|ขาย.+(?:ได้เงิน|รับชำระ)|เงินฝาก|ฝากเงิน|โอนระหว่าง|เงินกู้|กู้เงิน|ยืมเงิน|revenue|income|deposit|loan|transfer between)/iu.test(text);
}

export function buildInitialLineExpenseDraftContinuation(input: {
  workflowId: string;
  companyId: string;
  userId: string;
  expenseId: string;
  chatKeyHash: string;
  targetRevision: string;
  provisionalExpenseDate: string;
  messageText: string;
  webhookEventId?: string;
  hints?: LineIntakeCaptureHints;
  categories: readonly ExpenseCategorySummary[];
  now?: string;
}): LineExpenseDraftContinuation {
  const now = input.now ?? new Date().toISOString();
  const categories = categoryMap(input.categories);
  if ((input.hints?.items?.length ?? 0) > MAX_ITEMS) throw new RangeError('Expense source draft supports at most 40 items.');
  const hintedItems = (input.hints?.items ?? [])
    .map((hint, index) => initialItem(hint, index, input.messageText, categories))
    .filter((item): item is LineExpenseDraftItem => Boolean(item));
  const fallbackDescription = groundedText(input.messageText, input.hints?.description)
    ?? bounded(input.messageText, 120);
  const items = hintedItems.length > 0 ? hintedItems : fallbackDescription ? [{
    itemRef: 'I01', sourceText: fallbackDescription, description: fallbackDescription,
    ...(groundedNumber(input.messageText, input.hints?.amount) ? { totalAmount: groundedNumber(input.messageText, input.hints?.amount) } : {}),
    ...(activeCategoryId(input.hints?.expenseCategoryId, categories) ? { suggestedCategoryId: input.hints?.expenseCategoryId } : {}),
  }] : [];
  const expenseDate = groundedDate(input.messageText, input.hints?.expenseDate);
  const header = {
    provisionalExpenseDate: input.provisionalExpenseDate,
    ...(expenseDate ? { expenseDate } : {}),
    ...(groundedText(input.messageText, input.hints?.vendorName) ? { vendorName: bounded(input.hints?.vendorName) } : {}),
    ...(groundedText(input.messageText, input.hints?.businessPurpose) ? { businessPurpose: bounded(input.hints?.businessPurpose) } : {}),
  };
  const state: LineExpenseDraftContinuation = {
    schemaVersion: 1,
    workflowId: input.workflowId,
    kind: 'EXPENSE_DRAFT_COLLECTION',
    companyId: input.companyId,
    userId: input.userId,
    expenseId: input.expenseId,
    chatKeyHash: input.chatKeyHash,
    status: 'OPEN',
    version: 1,
    targetRevision: input.targetRevision,
    header,
    items,
    provenance: {},
    unresolvedQuestions: [],
    lastActivityAt: now,
  };
  state.unresolvedQuestions = collectLineExpenseDraftQuestions(state, input.categories);
  const hash = messageHash(input.messageText);
  for (const [field, questionId] of [
    ['expenseDate', 'D-DATE'], ['vendorName', 'D-VENDOR'], ['businessPurpose', 'D-PURPOSE'],
  ] as const) {
    if (state.header[field]) state.provenance[questionId] = { source: 'LINE_AI_SOURCE_GROUNDED', acceptedAt: now, messageHash: hash, ...(input.webhookEventId ? { webhookEventId: input.webhookEventId } : {}) };
  }
  for (const item of state.items) {
    for (const [field, suffix] of [
      ['description', 'DESC'], ['quantity', 'QTY'], ['unitPrice', 'PRICE'], ['totalAmount', 'PRICE'],
    ] as const) {
      if (item[field]) state.provenance[`${item.itemRef}-${suffix}`] = { source: 'LINE_AI_SOURCE_GROUNDED', acceptedAt: now, messageHash: hash, ...(input.webhookEventId ? { webhookEventId: input.webhookEventId } : {}) };
    }
  }
  return state;
}

export function nextLineExpenseDraftItemRef(items: LineExpenseDraftItem[]): string {
  for (let index = 1; index <= MAX_ITEMS; index++) {
    const ref = `I${String(index).padStart(2, '0')}`;
    if (!items.some((item) => item.itemRef === ref)) return ref;
  }
  throw new RangeError('Expense source draft supports at most 40 items.');
}

export function parseLineExpenseDraftContinuation(value: unknown): LineExpenseDraftContinuation | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Partial<LineExpenseDraftContinuation>;
  if (state.schemaVersion !== 1 || state.kind !== 'EXPENSE_DRAFT_COLLECTION'
    || typeof state.workflowId !== 'string' || typeof state.companyId !== 'string'
    || typeof state.userId !== 'string' || typeof state.expenseId !== 'string'
    || typeof state.chatKeyHash !== 'string' || typeof state.targetRevision !== 'string'
    || Number.isNaN(new Date(state.targetRevision).getTime())
    || !state.header || !Array.isArray(state.items) || !Array.isArray(state.unresolvedQuestions)
    || !state.provenance || !Number.isSafeInteger(state.version) || state.version! < 1
    || !['OPEN', 'PAUSED', 'PAUSED_INTERRUPTED', 'INPUT_ENDED_COMPLETE', 'INPUT_ENDED_INCOMPLETE', 'CANCELLED'].includes(String(state.status))) return null;
  if (state.items.length > MAX_ITEMS || new Set(state.items.map((item) => item?.itemRef)).size !== state.items.length) return null;
  if (state.items.some((item) => !item || typeof item !== 'object'
    || !/^I\d{2}$/u.test(String(item.itemRef))
    || typeof item.sourceText !== 'string' || item.sourceText.length > MAX_TEXT)) return null;
  if (state.unresolvedQuestions.length > 204 || state.unresolvedQuestions.some((question) =>
    !question || typeof question !== 'object' || typeof question.id !== 'string'
    || typeof question.field !== 'string' || typeof question.prompt !== 'string'
    || question.prompt.length > 300)) return null;
  const current = state as LineExpenseDraftContinuation;
  if (!current.unresolvedQuestions.some((question) => question.id === 'D-PURPOSE')) return current;
  const normalized = structuredClone(current);
  normalized.unresolvedQuestions = normalized.unresolvedQuestions.filter((question) => question.id !== 'D-PURPOSE');
  if (normalized.status.startsWith('INPUT_ENDED_')) {
    normalized.status = normalized.unresolvedQuestions.length ? 'INPUT_ENDED_INCOMPLETE' : 'INPUT_ENDED_COMPLETE';
  }
  return normalized;
}

export function lineExpenseDraftControl(text: string): LineExpenseDraftControl | null {
  const value = normalized(text).toLocaleLowerCase('th-TH');
  if (/^(พัก|พักไว้ก่อน|หยุด|ไว้ก่อน|บันทึกไปก่อน|บันทึกไว้ก่อน|เดี๋ยวไปแก้ในเว็บ)$/u.test(value)) return 'pause';
  if (/^(ต่อ|ทำต่อ|กรอกต่อ|ทำรายการต่อ)$/u.test(value)) return 'resume';
  if (/^(หมด|จบ|ไม่มีแล้ว)$/u.test(value)) return 'end';
  if (/^(ยกเลิก|ยกเลิกรายการนี้|ไม่เอาแล้ว)$/u.test(value)) return 'cancel';
  return null;
}

export function isDeterministicLineExpenseDraftInput(text: string): boolean {
  return Boolean(lineExpenseDraftControl(text)
    || /^ร่าง\s*\d{1,2}$/u.test(normalized(text))
    || /(?:^|[,;\n])\s*(?:D-(?:DATE|VENDOR|PURPOSE|ITEMS)|I\d{2}-(?:DESC|QTY|PRICE|CATEGORY))\b/iu.test(text));
}

function categoryByAnswer(value: string, categories: readonly ExpenseCategorySummary[]): string | undefined {
  const wanted = normalized(value).toLocaleLowerCase('th-TH');
  const exact = categories.find((category) => wanted === normalized(category.name).toLocaleLowerCase('th-TH'));
  if (exact) return exact.id;
  const matches = categories.filter((category) => {
    const name = normalized(category.name).toLocaleLowerCase('th-TH');
    const index = wanted.indexOf(name);
    if (index < 0) return false;
    const prefix = wanted.slice(Math.max(0, index - 12), index);
    return !/(?:ไม่ใช่|ไม่เอา|อย่า|ไม่ต้อง)\s*$/u.test(prefix);
  });
  return matches.length === 1 ? matches[0]!.id : undefined;
}

function itemForHint(items: LineExpenseDraftItem[], hint: LineIntakeExpenseItemHint, messageText: string): LineExpenseDraftItem | undefined {
  if (hint.itemRef) return items.find((item) => item.itemRef.toLocaleUpperCase('en-US') === hint.itemRef!.toLocaleUpperCase('en-US'));
  const description = groundedText(messageText, hint.description) ?? groundedText(messageText, hint.sourceText);
  if (!description) return undefined;
  const matches = items.filter((item) => normalized(description).toLocaleLowerCase('th-TH').includes(normalized(item.description ?? item.sourceText).toLocaleLowerCase('th-TH'))
    || normalized(item.description ?? item.sourceText).toLocaleLowerCase('th-TH').includes(normalized(description).toLocaleLowerCase('th-TH')));
  return matches.length === 1 ? matches[0] : undefined;
}

function questionSegments(text: string): Array<{ id: string; value: string }> {
  return text.split(/[,;\n]+/u).flatMap((segment) => {
    const match = normalized(segment).match(/^((?:D-(?:DATE|VENDOR|PURPOSE|ITEMS)|I\d{2}-(?:DESC|QTY|PRICE|CATEGORY)))\s*(?::|=)?\s*(.+)$/iu);
    return match ? [{ id: match[1]!.toLocaleUpperCase('en-US'), value: match[2]! }] : [];
  });
}

export function applyLineExpenseDraftAnswer(input: {
  state: LineExpenseDraftContinuation;
  messageText: string;
  hints?: LineIntakeCaptureHints;
  categories: readonly ExpenseCategorySummary[];
  webhookEventId?: string;
  now?: string;
}): { state: LineExpenseDraftContinuation; acceptedFields: string[]; rejectedCandidates: LineExpenseDraftRejectedCandidate[] } {
  const now = input.now ?? new Date().toISOString();
  const next: LineExpenseDraftContinuation = {
    ...input.state,
    status: 'OPEN',
    version: input.state.version + 1,
    header: { ...input.state.header },
    items: input.state.items.map((item) => ({ ...item })),
    provenance: { ...input.state.provenance },
    lastActivityAt: now,
  };
  delete next.inputEndedAt;
  const accepted = new Set<string>();
  const rejected = new Map<string, LineExpenseDraftRejectedCandidate>();
  const reject = (field: string, reason: LineExpenseDraftRejectedCandidate['reason']) => {
    rejected.set(`${field}:${reason}`, { field, reason });
  };
  const record = (key: string) => {
    accepted.add(key);
    next.provenance[key] = {
      source: 'LINE_USER_TEXT', acceptedAt: now, messageHash: messageHash(input.messageText),
      ...(input.webhookEventId ? { webhookEventId: input.webhookEventId } : {}),
    };
  };

  const hints = input.hints;
  const hintedDate = groundedDate(input.messageText, hints?.expenseDate);
  if (hintedDate) { next.header.expenseDate = hintedDate; record('D-DATE'); }
  else if (hints?.expenseDate !== undefined) reject('D-DATE', 'NOT_GROUNDED_OR_INVALID');
  const vendor = groundedText(input.messageText, hints?.vendorName);
  if (vendor) { next.header.vendorName = vendor; record('D-VENDOR'); }
  else if (hints?.vendorName !== undefined) reject('D-VENDOR', 'NOT_GROUNDED_OR_INVALID');
  const purpose = groundedText(input.messageText, hints?.businessPurpose);
  if (purpose) { next.header.businessPurpose = purpose; record('D-PURPOSE'); }
  else if (hints?.businessPurpose !== undefined) reject('D-PURPOSE', 'NOT_GROUNDED_OR_INVALID');

  const categories = categoryMap(input.categories);
  for (const [hintIndex, hint] of (hints?.items ?? []).entries()) {
    let item = itemForHint(next.items, hint, input.messageText);
    if (!item) {
      const candidateRef = hint.itemRef ?? `ITEM-${hintIndex + 1}`;
      if (hint.itemRef) {
        reject(candidateRef, 'UNKNOWN_ITEM');
        continue;
      }
      const added = initialItem(hint, next.items.length, input.messageText, categories);
      if (next.items.length >= MAX_ITEMS) {
        reject(candidateRef, 'ITEM_LIMIT_REACHED');
        continue;
      }
      if (!added) {
        reject(candidateRef, hint.itemRef ? 'UNKNOWN_ITEM' : 'NOT_GROUNDED_OR_INVALID');
        continue;
      }
      item = { ...added, itemRef: nextLineExpenseDraftItemRef(next.items), newItem: true };
      next.items.push(item);
      record(`${item.itemRef}-DESC`);
      if (item.quantity) record(`${item.itemRef}-QTY`);
      if (item.unitPrice || item.totalAmount) record(`${item.itemRef}-PRICE`);
    }
    const description = groundedText(input.messageText, hint.description);
    if (description) { item.description = description.slice(0, 120); record(`${item.itemRef}-DESC`); }
    else if (hint.description !== undefined) reject(`${item.itemRef}-DESC`, 'NOT_GROUNDED_OR_INVALID');
    const itemEvidence = groundedText(input.messageText, hint.sourceText)
      ?? (hint.itemRef && new RegExp(`(?:^|\\s|[,;])${hint.itemRef}(?:\\s|$|[,;:-])`, 'iu').test(input.messageText)
        ? input.messageText
        : undefined);
    const quantity = itemEvidence ? groundedNumber(itemEvidence, hint.quantity, true) : undefined;
    if (quantity) {
      item.quantity = quantity;
      const unit = groundedText(input.messageText, hint.unit)?.slice(0, 30);
      if (unit) item.unit = unit;
      record(`${item.itemRef}-QTY`);
    }
    else if (hint.quantity !== undefined) reject(`${item.itemRef}-QTY`, 'NOT_GROUNDED_OR_INVALID');
    const unitPrice = itemEvidence ? groundedNumber(itemEvidence, hint.unitPrice) : undefined;
    if (unitPrice) { item.unitPrice = unitPrice; delete item.totalAmount; record(`${item.itemRef}-PRICE`); }
    else if (hint.unitPrice !== undefined) reject(`${item.itemRef}-PRICE`, 'NOT_GROUNDED_OR_INVALID');
    const totalAmount = itemEvidence ? groundedNumber(itemEvidence, hint.totalAmount) : undefined;
    if (totalAmount) { item.totalAmount = totalAmount; delete item.unitPrice; record(`${item.itemRef}-PRICE`); }
    else if (hint.totalAmount !== undefined) reject(`${item.itemRef}-PRICE`, 'NOT_GROUNDED_OR_INVALID');
    const categoryId = activeCategoryId(hint.expenseCategoryId, categories);
    const categoryEvidence = groundedText(input.messageText, hint.sourceText) ?? input.messageText;
    const namedCategoryId = categoryByAnswer(categoryEvidence, input.categories);
    const acceptedSuggestion = /(ตามที่แนะนำ|หมวดแนะนำ|แนะนำได้เลย)/u.test(categoryEvidence)
      && categoryId === item.suggestedCategoryId;
    if (categoryId && (namedCategoryId === categoryId || acceptedSuggestion)) {
      item.expenseCategoryId = categoryId;
      record(`${item.itemRef}-CATEGORY`);
    }
    else if (hint.expenseCategoryId !== undefined) reject(`${item.itemRef}-CATEGORY`, 'UNKNOWN_OR_UNCONFIRMED_CATEGORY');
    if (hint.accountingClass) item.accountingClass = hint.accountingClass;
    if (hint.itemBehavior) item.itemBehavior = hint.itemBehavior;
    if (bounded(hint.taxTreatment, 80)) item.taxTreatment = bounded(hint.taxTreatment, 80);
    if (hint.accountingClass || hint.itemBehavior || bounded(hint.taxTreatment, 80)) {
      item.advisorySource = 'AI_GATEWAY';
      item.advisoryRuleVersion = 'line-expense-draft-v1';
      if (typeof hint.confidence === 'number' && hint.confidence >= 0 && hint.confidence <= 1) item.confidence = hint.confidence;
    }
  }

  for (const segment of questionSegments(input.messageText)) {
    if (segment.id === 'D-DATE') {
      const date = extractValueCandidates(segment.value).dates.find((candidate) => !isAmbiguousDateCandidate(candidate));
      if (date) { next.header.expenseDate = date.isoDate; record(segment.id); }
      else reject(segment.id, 'NOT_GROUNDED_OR_INVALID');
      continue;
    }
    if (segment.id === 'D-VENDOR') { next.header.vendorName = bounded(segment.value)!; record(segment.id); continue; }
    if (segment.id === 'D-PURPOSE') { next.header.businessPurpose = bounded(segment.value)!; record(segment.id); continue; }
    if (segment.id === 'D-ITEMS') {
      for (const description of segment.value.split(/\s+(?:กับ|และ)\s+|[,;]+/u).map((value) => bounded(value, 120)).filter((value): value is string => Boolean(value))) {
        if (next.items.length >= MAX_ITEMS) { reject(segment.id, 'ITEM_LIMIT_REACHED'); break; }
        if (next.items.some((item) => normalized(item.description ?? item.sourceText) === normalized(description))) continue;
        const itemRef = nextLineExpenseDraftItemRef(next.items);
        next.items.push({ itemRef, sourceText: description, description, newItem: true });
        record(`${itemRef}-DESC`);
      }
      continue;
    }
    const itemRef = segment.id.match(/^(I\d{2})-/u)?.[1];
    const item = itemRef ? next.items.find((candidate) => candidate.itemRef === itemRef) : undefined;
    if (!item) { reject(segment.id, 'UNKNOWN_ITEM'); continue; }
    if (segment.id.endsWith('-DESC')) {
      const description = bounded(segment.value, 120);
      if (description) { item.description = description; record(segment.id); }
      else reject(segment.id, 'NOT_GROUNDED_OR_INVALID');
    }
    if (segment.id.endsWith('-QTY')) {
      const quantity = decimal(segment.value.match(/\d[\d,]*(?:\.\d{1,4})?/u)?.[0]?.replace(/,/gu, ''), true);
      if (quantity) {
        item.quantity = quantity;
        item.unit = bounded(segment.value.replace(/.*?\d[\d,]*(?:\.\d{1,4})?\s*/u, ''), 30) ?? item.unit;
        record(segment.id);
      }
      else reject(segment.id, 'NOT_GROUNDED_OR_INVALID');
    }
    if (segment.id.endsWith('-PRICE')) {
      const amount = extractValueCandidates(segment.value).amounts[0]?.value
        ?? decimal(segment.value.match(/\d[\d,]*(?:\.\d{1,4})?/u)?.[0]?.replace(/,/gu, ''));
      if (amount) {
        if (/(รวม|ยอดรวม)/u.test(segment.value)) {
          item.totalAmount = decimal(amount);
          delete item.unitPrice;
        } else {
          item.unitPrice = decimal(amount);
          delete item.totalAmount;
        }
        record(segment.id);
      }
      else reject(segment.id, 'NOT_GROUNDED_OR_INVALID');
    }
    if (segment.id.endsWith('-CATEGORY')) {
      const categoryId = categoryByAnswer(segment.value, input.categories)
        ?? (/(ตามที่แนะนำ|หมวดแนะนำ|แนะนำได้เลย)/u.test(segment.value) ? item.suggestedCategoryId : undefined);
      if (categoryId && categories.has(categoryId)) { item.expenseCategoryId = categoryId; record(segment.id); }
      else reject(segment.id, 'UNKNOWN_OR_UNCONFIRMED_CATEGORY');
    }
  }

  // Thai has no word boundaries; scan explicit ids independently so the last category answer in
  // a multi-answer sentence cannot be lost by punctuation/token segmentation.
  for (const match of input.messageText.matchAll(/(I\d{2})-CATEGORY\s*(?:ตามที่แนะนำ|หมวดแนะนำ|แนะนำได้เลย)/giu)) {
    const item = next.items.find((candidate) => candidate.itemRef === match[1]!.toLocaleUpperCase('en-US'));
    if (item?.suggestedCategoryId && categories.has(item.suggestedCategoryId)) {
      item.expenseCategoryId = item.suggestedCategoryId;
      record(`${item.itemRef}-CATEGORY`);
    }
  }

  if (/(หมวดที่แนะนำ|ตามที่แนะนำ).*(ได้เลย|ทั้งหมด)|ใช้หมวดแนะนำทั้งหมด/u.test(input.messageText)) {
    for (const item of next.items) {
      if (!item.expenseCategoryId && item.suggestedCategoryId && categories.has(item.suggestedCategoryId)) {
        item.expenseCategoryId = item.suggestedCategoryId;
        record(`${item.itemRef}-CATEGORY`);
      }
    }
  }

  // Vendor-address §11.3, asked once by the capture card. This turn ends it whatever it says, so
  // the draft moves on after "ข้าม", after silence, and after a change of subject — and the answer
  // lands in the same field the review form and the counterparty auto-save read.
  if (input.state.header.vendorAddressAsk) {
    delete next.header.vendorAddressAsk;
    const answer = bounded(input.messageText, EXPENSE_VENDOR_ADDRESS_MAX_LENGTH);
    if (accepted.size === 0 && answer && answer.length >= 6
      && !VENDOR_ADDRESS_DECLINED_RE.test(answer) && VENDOR_ADDRESS_ANSWER_RE.test(answer)
      && !lineExpenseDraftControl(input.messageText)) {
      next.header.vendorAddress = answer;
      record('D-ADDRESS');
    }
  }

  next.unresolvedQuestions = collectLineExpenseDraftQuestions(next, input.categories);
  return {
    state: next,
    acceptedFields: [...accepted],
    rejectedCandidates: [...rejected.values()].filter((candidate) => !accepted.has(candidate.field)),
  };
}

export function transitionLineExpenseDraft(
  state: LineExpenseDraftContinuation,
  control: LineExpenseDraftControl | 'interrupt',
  now = new Date().toISOString(),
): LineExpenseDraftContinuation {
  const complete = state.unresolvedQuestions.length === 0;
  const status: LineExpenseDraftStatus = control === 'pause' ? 'PAUSED'
    : control === 'resume' ? 'OPEN'
      : control === 'end' ? (complete ? 'INPUT_ENDED_COMPLETE' : 'INPUT_ENDED_INCOMPLETE')
        : control === 'cancel' ? 'CANCELLED'
          : 'PAUSED_INTERRUPTED';
  const next: LineExpenseDraftContinuation = {
    ...state,
    status,
    version: state.version + 1,
    lastActivityAt: now,
    ...(['INPUT_ENDED_COMPLETE', 'INPUT_ENDED_INCOMPLETE'].includes(status) ? { inputEndedAt: now } : {}),
  };
  if (!['INPUT_ENDED_COMPLETE', 'INPUT_ENDED_INCOMPLETE'].includes(status)) delete next.inputEndedAt;
  return next;
}

/** Every item this lane collects is something the user said they bought, never an additional charge
 *  (expense spec §5.1) — and `chargeKind` is stated rather than omitted, because an absent kind means
 *  "keep what line N had" and these line numbers are positional. */
export function materializedLineExpenseDraftItems(state: LineExpenseDraftContinuation): Array<{
  lineNumber: number;
  description: string;
  quantity: string;
  unitPrice: string;
  chargeKind: null;
  expenseCategoryId?: string;
  accountHintKey?: string;
}> {
  return state.items.flatMap((item, index) => {
    if (!item.description || !item.quantity || (!item.unitPrice && !item.totalAmount)) return [];
    let price = item.unitPrice;
    if (!price && item.totalAmount) {
      try { price = new Decimal(item.totalAmount).div(item.quantity).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(); } catch { return []; }
    }
    if (!price) return [];
    return [{ lineNumber: index + 1, description: item.description, quantity: item.quantity, unitPrice: price,
      chargeKind: null,
      ...(item.expenseCategoryId ? { expenseCategoryId: item.expenseCategoryId } : {}) }];
  });
}

function acceptedFieldText(
  field: string,
  state: LineExpenseDraftContinuation,
  categoryNames: ReadonlyMap<string, string>,
): string {
  if (field === 'D-DATE') return `วันที่ ${state.header.expenseDate}`;
  if (field === 'D-VENDOR') return `ผู้ขาย ${state.header.vendorName}`;
  if (field === 'D-ADDRESS') return `ที่อยู่ร้าน ${state.header.vendorAddress}`;
  if (field === 'D-PURPOSE') return `วัตถุประสงค์ ${state.header.businessPurpose}`;
  const item = state.items.find((candidate) => field.startsWith(`${candidate.itemRef}-`));
  if (!item) return 'ข้อมูลรายการ';
  const subject = item.description ?? `รายการที่ ${state.items.indexOf(item) + 1}`;
  if (field.endsWith('-DESC')) return subject;
  if (field.endsWith('-QTY')) return `${subject} จำนวน ${item.quantity}${item.unit ? ` ${item.unit}` : ''}`;
  if (field.endsWith('-PRICE')) return `${subject} ${item.unitPrice ? `ราคา ${item.unitPrice} บาท/หน่วย` : `ยอดรวม ${item.totalAmount} บาท`}`;
  if (field.endsWith('-CATEGORY')) return `${subject} หมวด ${categoryNames.get(item.expenseCategoryId ?? '') ?? 'รอตรวจ'}`;
  return subject;
}

export function formatLineExpenseDraftReply(input: {
  state: LineExpenseDraftContinuation;
  categories: readonly ExpenseCategorySummary[];
  acceptedFields?: string[];
  label?: string;
  /** Questions are shown only during work the user explicitly asked to continue. */
  includeQuestions?: boolean;
}): string {
  const state = input.state;
  const names = new Map(input.categories.map((category) => [category.id, category.name]));
  const fieldLabels: Record<string, string> = { description: 'ชื่อสินค้า/บริการ', quantity: 'จำนวนและหน่วย', price: 'ราคาต่อหน่วยหรือยอดรวม', expenseCategoryId: 'หมวดค่าใช้จ่าย', review: 'ตรวจรายการเดิมในเว็บ' };
  const lines: string[] = [];
  if (input.acceptedFields?.length) {
    lines.push(state.items.length > 10 ? `บันทึกข้อมูลแล้ว ${input.acceptedFields.length} ข้อ — ดูข้อมูลปัจจุบันด้านล่าง` : `บันทึกแล้ว: ${input.acceptedFields.map((field) => acceptedFieldText(field, state, names)).join(' • ')}`);
  }
  lines.push('🧾 เก็บร่างค่าใช้จ่ายแล้วค่ะ');
  if (state.header.vendorName) lines.push(`ร้าน: ${state.header.vendorName}`);
  if (state.header.expenseDate) lines.push(`วันที่: ${new Date(`${state.header.expenseDate}T00:00:00Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`);
  if (state.header.businessPurpose) lines.push(`ใช้เพื่อ: ${state.header.businessPurpose}`);
  lines.push('ยังไม่ยืนยันรายการ');
  if (state.status === 'PAUSED' || state.status === 'PAUSED_INTERRUPTED') {
    return lines.join('\n');
  } else if (state.status === 'CANCELLED') {
    lines.push('', 'ยกเลิกการสนทนาร่างนี้แล้ว หลักฐานและร่างเดิมไม่ได้ถูกลบ');
  } else if (state.status === 'INPUT_ENDED_COMPLETE') {
    lines.push('', 'จบการกรอกแล้ว ร่างพร้อมให้ผู้มีสิทธิ์ตรวจสอบ (ยังไม่ลงบัญชี)');
  } else if (state.status === 'INPUT_ENDED_INCOMPLETE') {
    lines.push('', 'เก็บข้อมูลที่กรอกไว้แล้วค่ะ');
  } else if (input.includeQuestions !== false && state.unresolvedQuestions.length) {
    lines.push('', 'ข้อมูลที่ต้องใช้สำหรับทำรายการนี้ต่อ');
    for (const question of state.unresolvedQuestions.filter((question) => question.scope === 'DOCUMENT')) lines.push(`• ${question.prompt}`);
    for (const item of state.items) {
      const questions = state.unresolvedQuestions.filter((question) => question.itemRef === item.itemRef);
      if (questions.length) lines.push(`• ${(item.description ?? 'รายการนี้').slice(0, 60)}: ${questions.map((question) => fieldLabels[question.field] ?? 'ข้อมูลรายการ').join(' และ ')}`);
    }
    lines.push('', 'ตอบรวมในข้อความเดียวได้ค่ะ');
  }
  return lines.join('\n');
}

export function splitLineExpenseDraftReply(text: string, maxChars = 4800): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let offset = 0;
  while (text.length - offset > maxChars) {
    const limit = offset + maxChars;
    const newline = text.lastIndexOf('\n', limit - 1);
    const end = newline >= offset ? newline + 1 : limit;
    parts.push(text.slice(offset, end));
    offset = end;
  }
  if (offset < text.length) parts.push(text.slice(offset));
  return parts;
}
