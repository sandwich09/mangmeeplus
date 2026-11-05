import { createHash } from 'node:crypto';
import { lineUiLabel } from '../../../line-ai/domain/logic/line-language.logic';
import Decimal from 'decimal.js';
import {
  EXPENSE_MAX_ITEM_LINES,
  extractValueCandidates,
  todayCivilDate,
  isAmbiguousDateCandidate,
  type ExpenseCategorySummary,
  type LineExpenseAccountingClass,
  type LineExpenseItemBehavior,
  type LineIntakeCaptureHints,
  type LineIntakeExpenseItemHint,
} from '@watchdog-bms/contracts';
import { EXPENSE_VENDOR_ADDRESS_MAX_LENGTH } from './expense-vendor-identity.logic';

export const MAX_LINE_EXPENSE_DRAFT_ITEMS = EXPENSE_MAX_ITEM_LINES;
const MAX_ITEMS = MAX_LINE_EXPENSE_DRAFT_ITEMS;
export const MAX_CAPTURE_EXPENSE_DRAFT_ITEMS = EXPENSE_MAX_ITEM_LINES;
export const expenseDraftItemLimit = (state: { itemSource?: 'LINE_MEDIA_OCR' }) =>
  state.itemSource === 'LINE_MEDIA_OCR' ? MAX_CAPTURE_EXPENSE_DRAFT_ITEMS : MAX_ITEMS;
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
  itemSource?: 'LINE_MEDIA_OCR';
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
  const source = normalized(text).toLocaleLowerCase('th-TH');
  let cursor = 0;
  for (const token of candidate.toLocaleLowerCase('th-TH').split(' ')) {
    const index = source.indexOf(token, cursor);
    if (index < 0) return undefined;
    cursor = index + token.length;
  }
  return candidate;
}

function groundedDate(text: string, value: unknown, todayIso = todayCivilDate()): string | undefined {
  const candidates = extractValueCandidates(text, todayIso);
  const days = [...new Set([...candidates.dates.filter(candidate => !isAmbiguousDateCandidate(candidate)).map(candidate => candidate.isoDate),
    ...(candidates.periods ?? []).filter(period => period.kind === 'day' && period.fromDate === period.toDate).map(period => period.fromDate)])];
  if (days.length !== 1) return undefined;
  return typeof value === 'string' && days.includes(value) ? value : value === undefined && days.length === 1 ? days[0] : undefined;
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

/** Item names keep the purpose, while money and dates live in their own fields. */
export function lineExpenseItemDescription(text: string | undefined, fallback?: string, maxLength = 120): string | undefined {
  if (!text) return fallback ? lineExpenseItemDescription(fallback, undefined, maxLength) : undefined;
  const values = extractValueCandidates(text, todayCivilDate('Asia/Bangkok'));
  const ranges: Array<[number, number]> = [];
  for (const candidate of [...values.amounts, ...values.dates, ...(values.periods ?? []).filter(period => period.kind === 'day')]) {
    let offset = 0, start: number;
    while ((start = text.indexOf(candidate.span, offset)) !== -1) {
      let end = start + candidate.span.length;
      offset = end;
      if ('isoDate' in candidate) {
        const prefix = text.slice(0, start).match(/วันที่\s*$/u);
        if (prefix) start -= prefix[0].length;
      }
      // The extractor deliberately offers digit candidates inside product names such as A4.
      if ('value' in candidate && /[A-Za-z]/u.test(`${text[start - 1] ?? ''}${text[end] ?? ''}`)) continue;
      if ('value' in candidate && /^\s*%/u.test(text.slice(end))) continue;
      if ('value' in candidate && !candidate.currencyToken && /^\s*(?:คน|ชิ้น|เครื่อง|งาน|ครั้ง|ชุด|กล่อง|อัน|เมตร|กิโล)/u.test(text.slice(end))) continue;
      if ('currencyToken' in candidate && candidate.currencyToken) {
        const suffix = text.slice(end).match(/^\s*/u)![0].length;
        if (text.startsWith(candidate.currencyToken, end + suffix)) end += suffix + candidate.currencyToken.length;
        const prefix = text.slice(0, start).trimEnd();
        if (prefix.endsWith(candidate.currencyToken)) start = prefix.length - candidate.currencyToken.length;
      }
      ranges.push([start, end]);
    }
  }
  const cleaned = text.split('').map((char, index) => ranges.some(([start, end]) => index >= start && index < end) ? ' ' : char).join('');
  const result = cleaned.replace(/\s+/gu, ' ').replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/gu, '').trim();
  return result ? result.slice(0, maxLength) : fallback ? lineExpenseItemDescription(fallback, undefined, maxLength) : undefined;
}

/** Called only after semantic intake admitted an expense/claim: keep the user's item words when a
 * translated or paraphrased hint cannot be grounded. This never decides intent or invents a label. */
export function lineExpenseNoteDescription(text: string): string | undefined {
  const values = extractValueCandidates(text, todayCivilDate('Asia/Bangkok'));
  let source = text;
  for (const value of [...values.amounts, ...values.dates, ...(values.periods ?? [])]) source = source.replace(value.span, '\n');
  return source.split('\n').map(part => part
    .replace(/^(?:(?:ช่วย|ขอ|รบกวน|จด|บันทึก|บันทก|ลง|เพิ่ม|ทำ|สร้าง|เบิก|สำรองจ่าย|ค่าใช้จ่าย|คชจ|บิล|รายการ|ให้)\s*|(?:please|record|recrod|log|add|claim|an?|expense|of|for|paid)\b\s*)+/iu, '')
    .replace(/(?:ให้หน่อย|ให้ที|หน่อย|ด้วย|นะคะ|นะ|ค่ะ|ครับ|คะ|บาท|บ\.|baht|bath|for)\s*$/giu, '').trim())
    .find(part => part.length > 1)?.slice(0, 120);
}

function initialItem(
  hint: LineIntakeExpenseItemHint,
  index: number,
  messageText: string,
  categories: Map<string, ExpenseCategorySummary>,
  fallback?: string,
  capture = false,
): LineExpenseDraftItem | null {
  const sourceText = groundedText(messageText, hint.sourceText)
    ?? groundedText(messageText, hint.description);
  if (!sourceText) return null;
  const description = capture ? bounded(hint.description, 200)
    : lineExpenseItemDescription(groundedText(messageText, hint.description) ?? sourceText, fallback);
  const numericSource = capture ? hint.sourceText ?? sourceText : sourceText;
  const unit = groundedText(messageText, hint.unit)?.slice(0, 30);
  // Numeric evidence must occur inside this item's own bounded source span. A number belonging to
  // a laptop elsewhere in the message must never become the paper quantity merely because the
  // model returned it on the wrong item.
  const quantity = groundedNumber(numericSource, hint.quantity, true);
  const unitPrice = groundedNumber(numericSource, hint.unitPrice);
  const totalAmount = groundedNumber(numericSource, hint.totalAmount);
  const hasAdvisory = Boolean(hint.accountingClass || hint.itemBehavior || bounded(hint.taxTreatment, 80));
  return {
    itemRef: `I${String(index + 1).padStart(2, '0')}`,
    sourceText,
    description,
    ...(quantity || totalAmount ? { quantity: quantity ?? '1' } : {}),
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
  state: Pick<LineExpenseDraftContinuation, 'header' | 'items' | 'itemSource'> & Partial<Pick<LineExpenseDraftContinuation, 'provenance'>>,
  categories: readonly ExpenseCategorySummary[],
): LineExpenseDraftQuestion[] {
  const result: LineExpenseDraftQuestion[] = [];
  const media = state.itemSource === 'LINE_MEDIA_OCR' || Object.values(state.provenance ?? {}).some(value => value.source === 'LINE_MEDIA_OCR');
  if (!state.header.expenseDate) result.push({ id: 'D-DATE', scope: 'DOCUMENT', field: 'expenseDate', prompt: 'วันที่ซื้อหรือวันที่จ่ายคือวันไหน?' });
  if (media && !state.header.vendorName) result.push({ id: 'D-VENDOR', scope: 'DOCUMENT', field: 'vendorName', prompt: 'ซื้อจากร้านหรือผู้ขายชื่ออะไรคะ' });
  if (state.items.length === 0) result.push({ id: 'D-ITEMS', scope: 'DOCUMENT', field: 'items', prompt: 'มีสินค้าหรือบริการอะไรบ้าง?' });
  const names = new Map(categories.map((category) => [category.id, category.name]));
  for (const item of state.items) {
    if (!item.description) result.push({ id: `${item.itemRef}-DESC`, scope: 'ITEM', itemRef: item.itemRef, field: 'description', prompt: `${item.itemRef} รายการนี้คือสินค้า/บริการอะไร?` });
    if (media && !item.quantity && !item.totalAmount) result.push({ id: `${item.itemRef}-QTY`, scope: 'ITEM', itemRef: item.itemRef, field: 'quantity', prompt: `${item.itemRef} ${item.description ?? 'รายการนี้'} จำนวนเท่าไร และหน่วยอะไร?` });
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

export function isLineExpenseDraftStartEligible(messageText: string, hints?: LineIntakeCaptureHints, semanticBusinessExpenseConfirmed = false): boolean {
  if ((hints?.confidence ?? 0) < 0.6) return false;
  if (isClearlyNonExpenseDirection(messageText)) return false;
  const source = extractValueCandidates(messageText, todayCivilDate('Asia/Bangkok'));
  if (!source.amounts.length && !source.dates.length && !source.periods?.some(period => period.kind === 'day')) return false;
  if (semanticBusinessExpenseConfirmed && groundedNumber(messageText, hints?.amount, true)) return true;
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
  /** Owner 2026-09-29, spec §13: a TEXT note's AI category is applied, not only suggested, exactly as
   *  the single-turn text capture has always applied it; the router names one only when it clearly
   *  fits. Photo callers leave this off — the receipt reader's own auto-fill rule decides theirs. */
  itemSource?: 'LINE_MEDIA_OCR';
  applyCategoryHints?: boolean;
}): LineExpenseDraftContinuation {
  const now = input.now ?? new Date().toISOString();
  const categories = categoryMap(input.categories);
  if ((input.hints?.items?.length ?? 0) > expenseDraftItemLimit(input)) throw new RangeError(`Expense source draft supports at most ${expenseDraftItemLimit(input)} items.`);
  const purpose = groundedText(input.messageText, input.hints?.businessPurpose);
  const vendor = groundedText(input.messageText, input.hints?.vendorName);
  const descriptionFallback = purpose ?? (vendor ? `ค่าใช้จ่าย ${vendor}` : undefined);
  const hintedItems = (input.hints?.items ?? [])
    .map((hint, index) => initialItem(hint, index, input.messageText, categories, descriptionFallback, input.itemSource === 'LINE_MEDIA_OCR'))
    .filter((item): item is LineExpenseDraftItem => Boolean(item));
  // The note's own category covers every item that names none of its own; it never replaces one.
  const noteCategoryId = activeCategoryId(input.hints?.expenseCategoryId, categories);
  for (const item of hintedItems) if (!item.suggestedCategoryId && noteCategoryId) item.suggestedCategoryId = noteCategoryId;
  const statedAmounts = [...new Set(extractValueCandidates(input.messageText).amounts.filter(candidate => candidate.currencyToken && !candidate.assumptions?.length).map(candidate => candidate.value))];
  const totalAmount = groundedNumber(input.messageText, input.hints?.amount)
    ?? (statedAmounts.length === 1 ? decimal(statedAmounts[0]) : undefined);
  const fallbackDescription = lineExpenseItemDescription(groundedText(input.messageText, input.hints?.description),
    purpose ?? (totalAmount && vendor ? `${input.applyCategoryHints && noteCategoryId ? categories.get(noteCategoryId)!.name : 'ค่าใช้จ่าย'} ${vendor}` : undefined)
      ?? (!input.itemSource ? lineExpenseNoteDescription(input.messageText) : undefined));
  const items: LineExpenseDraftItem[] = hintedItems.length > 0 ? hintedItems : [{
    itemRef: 'I01', sourceText: fallbackDescription ?? 'รายการค่าใช้จ่าย',
    ...(fallbackDescription ? { description: fallbackDescription.slice(0, 120) } : {}),
    ...(totalAmount ? { totalAmount, quantity: '1', unit: 'งาน' } : {}),
    ...(noteCategoryId ? { suggestedCategoryId: noteCategoryId } : {}),
  }];
  // A one-item note's grounded document total belongs to that item even when the model's
  // item span contains only its name. Never distribute a document total across several items.
  if (!input.itemSource && items.length === 1 && totalAmount && !items[0]!.totalAmount && !items[0]!.unitPrice) {
    items[0]!.totalAmount = totalAmount;
    items[0]!.quantity ??= '1';
  }
  if (input.applyCategoryHints) for (const item of items) if (item.suggestedCategoryId) item.expenseCategoryId = item.suggestedCategoryId;
  const dates = extractValueCandidates(input.messageText).dates.filter(candidate => !isAmbiguousDateCandidate(candidate));
  const expenseDate = groundedDate(input.messageText, input.hints?.expenseDate, input.provisionalExpenseDate)
    ?? groundedDate(input.messageText, undefined, input.provisionalExpenseDate)
    ?? (new Set(dates.map(candidate => candidate.isoDate)).size === 1 ? dates[0]!.isoDate : undefined);
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
    ...(input.itemSource ? { itemSource: input.itemSource } : {}),
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
      ['description', 'DESC'], ['quantity', 'QTY'], ['unitPrice', 'PRICE'], ['totalAmount', 'PRICE'], ['expenseCategoryId', 'CATEGORY'],
    ] as const) {
      if (item[field]) state.provenance[`${item.itemRef}-${suffix}`] = { source: 'LINE_AI_SOURCE_GROUNDED', acceptedAt: now, messageHash: hash, ...(input.webhookEventId ? { webhookEventId: input.webhookEventId } : {}) };
    }
  }
  return state;
}

export function nextLineExpenseDraftItemRef(items: LineExpenseDraftItem[], limit = MAX_ITEMS): string {
  for (let index = 1; index <= limit; index++) {
    const ref = `I${String(index).padStart(2, '0')}`;
    if (!items.some((item) => item.itemRef === ref)) return ref;
  }
  throw new RangeError(`Expense source draft supports at most ${limit} items.`);
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
  if (state.itemSource !== undefined && state.itemSource !== 'LINE_MEDIA_OCR') return null;
  if (state.items.length > expenseDraftItemLimit(state) || new Set(state.items.map((item) => item?.itemRef)).size !== state.items.length) return null;
  if (state.items.some((item) => !item || typeof item !== 'object'
    || !/^I\d{2,3}$/u.test(String(item.itemRef))
    || typeof item.sourceText !== 'string' || item.sourceText.length > MAX_TEXT)) return null;
  if (state.unresolvedQuestions.length > expenseDraftItemLimit(state) * 5 + 4 || state.unresolvedQuestions.some((question) =>
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
  if (/^(พัก|พักไว้ก่อน|หยุด|pause|save for later|stop|ไว้ก่อน|บันทึกไปก่อน|บันทึกไว้ก่อน|เดี๋ยวไปแก้ในเว็บ)$/u.test(value)) return 'pause';
  if (/^(ต่อ|ทำต่อ|กรอกต่อ|ทำรายการต่อ|continue|resume)$/u.test(value)) return 'resume';
  if (/^(หมด|จบ|ไม่มีแล้ว|done|finish|no more)$/u.test(value)) return 'end';
  if (/^(ยกเลิก|ยกเลิกรายการนี้|ไม่เอาแล้ว|cancel|discard this draft)$/u.test(value)) return 'cancel';
  return null;
}

export function isDeterministicLineExpenseDraftInput(text: string): boolean {
  return Boolean(lineExpenseDraftControl(text)
    || /^ร่าง\s*\d{1,2}$/u.test(normalized(text))
    || /(?:^|[,;\n])\s*(?:D-(?:DATE|VENDOR|PURPOSE|ITEMS)|I\d{2,3}-(?:DESC|QTY|PRICE|CATEGORY))\b/iu.test(text));
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
    const match = normalized(segment).match(/^((?:D-(?:DATE|VENDOR|PURPOSE|ITEMS)|I\d{2,3}-(?:DESC|QTY|PRICE|CATEGORY)))\s*(?::|=)?\s*(.+)$/iu);
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
  const hintedDate = groundedDate(input.messageText, hints?.expenseDate, new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }));
  if (hintedDate) { next.header.expenseDate = hintedDate; record('D-DATE'); }
  else if (hints?.expenseDate !== undefined) reject('D-DATE', 'NOT_GROUNDED_OR_INVALID');
  const vendor = groundedText(input.messageText, hints?.vendorName);
  if (vendor) { next.header.vendorName = vendor; record('D-VENDOR'); }
  else if (hints?.vendorName !== undefined) reject('D-VENDOR', 'NOT_GROUNDED_OR_INVALID');
  else if (/^(?:ร้าน|ผู้ขาย)\s*[:=]?\s+\S/u.test(input.messageText.trim())) {
    next.header.vendorName = bounded(input.messageText.trim())!; record('D-VENDOR');
  }
  const purpose = groundedText(input.messageText, hints?.businessPurpose);
  if (purpose) { next.header.businessPurpose = purpose; record('D-PURPOSE'); }
  else if (hints?.businessPurpose !== undefined) reject('D-PURPOSE', 'NOT_GROUNDED_OR_INVALID');

  // Plain answers use the same validated question-segment path as optional printed question ids.
  const plainSegments: Array<{ id: string; value: string }> = [];
  if (!isDeterministicLineExpenseDraftInput(input.messageText)) {
    const dates = extractValueCandidates(input.messageText).dates.filter(candidate => !isAmbiguousDateCandidate(candidate));
    if (new Set(dates.map(candidate => candidate.isoDate)).size === 1) plainSegments.push({ id: 'D-DATE', value: dates[0]!.span });
    const vendor = input.messageText.match(/^(?:ผู้ขาย|ร้าน)\s*[:=]?\s*(.+)$/u)?.[1];
    if (vendor && input.state.unresolvedQuestions.some(question => question.id === 'D-VENDOR')) plainSegments.push({ id: 'D-VENDOR', value: vendor });
    const soleItem = next.items.length === 1 ? next.items[0] : undefined;
    if (soleItem) {
      const quantity = input.messageText.match(/จำนวน\s*[:=]?\s*(\d[\d,]*(?:\.\d{1,4})?(?:\s*[^\d\s,;]+)?)/u)?.[1];
      const price = input.messageText.match(/(?:ยอดรวม|ราคา)\s*[:=]?\s*(\d[\d,]*(?:\.\d{1,4})?)/u)?.[0];
      if (quantity) plainSegments.push({ id: `${soleItem.itemRef}-QTY`, value: quantity });
      if (price) plainSegments.push({ id: `${soleItem.itemRef}-PRICE`, value: price });
      if (!price && input.state.unresolvedQuestions.some(question => question.id === `${soleItem.itemRef}-PRICE`)
        && /^\s*\d[\d,]*(?:\.\d{1,4})?\s*(?:บาท|THB)\s*$/iu.test(input.messageText)) {
        plainSegments.push({ id: `${soleItem.itemRef}-PRICE`, value: `ยอดรวม ${input.messageText}` });
      }
    }
    const categoryQuestions = input.state.unresolvedQuestions.filter(question => question.field === 'expenseCategoryId');
    if (categoryQuestions.length === 1 && categoryByAnswer(input.messageText, input.categories)) plainSegments.push({ id: categoryQuestions[0]!.id, value: input.messageText });
  }

  const categories = categoryMap(input.categories);
  if (next.items.length === 1 && !hints?.items?.length) {
    const amount = groundedNumber(input.messageText, hints?.amount);
    if (amount) { next.items[0]!.totalAmount = amount; delete next.items[0]!.unitPrice; record(`${next.items[0]!.itemRef}-PRICE`); }
  }
  for (const [hintIndex, hint] of (hints?.items ?? []).entries()) {
    let item = itemForHint(next.items, hint, input.messageText);
    if (!item) {
      const candidateRef = hint.itemRef ?? `ITEM-${hintIndex + 1}`;
      if (hint.itemRef) {
        reject(candidateRef, 'UNKNOWN_ITEM');
        continue;
      }
      const added = initialItem(hint, next.items.length, input.messageText, categories,
        next.header.businessPurpose ?? (next.header.vendorName ? `ค่าใช้จ่าย ${next.header.vendorName}` : undefined));
      if (next.items.length >= expenseDraftItemLimit(next)) {
        reject(candidateRef, 'ITEM_LIMIT_REACHED');
        continue;
      }
      if (!added) {
        reject(candidateRef, hint.itemRef ? 'UNKNOWN_ITEM' : 'NOT_GROUNDED_OR_INVALID');
        continue;
      }
      item = { ...added, itemRef: nextLineExpenseDraftItemRef(next.items, expenseDraftItemLimit(next)), newItem: true };
      next.items.push(item);
      record(`${item.itemRef}-DESC`);
      if (item.quantity) record(`${item.itemRef}-QTY`);
      if (item.unitPrice || item.totalAmount) record(`${item.itemRef}-PRICE`);
    }
    const rawDescription = groundedText(input.messageText, hint.description);
    const description = rawDescription ? lineExpenseItemDescription(rawDescription,
      next.header.businessPurpose ?? (next.header.vendorName ? `ค่าใช้จ่าย ${next.header.vendorName}` : undefined)) : undefined;
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

  for (const segment of [...plainSegments, ...questionSegments(input.messageText)]) {
    if (segment.id === 'D-DATE') {
      const date = extractValueCandidates(segment.value).dates.find((candidate) => !isAmbiguousDateCandidate(candidate));
      if (date) { next.header.expenseDate = date.isoDate; record(segment.id); }
      else reject(segment.id, 'NOT_GROUNDED_OR_INVALID');
      continue;
    }
    if (segment.id === 'D-VENDOR') { next.header.vendorName = bounded(segment.value)!; record(segment.id); continue; }
    if (segment.id === 'D-PURPOSE') { next.header.businessPurpose = bounded(segment.value)!; record(segment.id); continue; }
    if (segment.id === 'D-ITEMS') {
      for (const description of segment.value.split(/\s+(?:กับ|และ)\s+|[,;]+/u).map((value) => lineExpenseItemDescription(value,
        next.header.businessPurpose ?? (next.header.vendorName ? `ค่าใช้จ่าย ${next.header.vendorName}` : undefined))).filter((value): value is string => Boolean(value))) {
        if (next.items.length >= expenseDraftItemLimit(next)) { reject(segment.id, 'ITEM_LIMIT_REACHED'); break; }
        if (next.items.some((item) => normalized(item.description ?? item.sourceText) === normalized(description))) continue;
        const itemRef = nextLineExpenseDraftItemRef(next.items, expenseDraftItemLimit(next));
        next.items.push({ itemRef, sourceText: description, description, newItem: true });
        record(`${itemRef}-DESC`);
      }
      continue;
    }
    const itemRef = segment.id.match(/^(I\d{2,3})-/u)?.[1];
    const item = itemRef ? next.items.find((candidate) => candidate.itemRef === itemRef) : undefined;
    if (!item) { reject(segment.id, 'UNKNOWN_ITEM'); continue; }
    if (segment.id.endsWith('-DESC')) {
      const description = lineExpenseItemDescription(segment.value, next.header.businessPurpose ?? (next.header.vendorName ? `ค่าใช้จ่าย ${next.header.vendorName}` : undefined));
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
  for (const match of input.messageText.matchAll(/(I\d{2,3})-CATEGORY\s*(?:ตามที่แนะนำ|หมวดแนะนำ|แนะนำได้เลย)/giu)) {
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

  for (const item of next.items) {
    if (!item.quantity && item.totalAmount) item.quantity = '1';
    if (accepted.size && next.items.length === 1 && !item.description && (item.totalAmount || item.unitPrice) && next.header.vendorName) {
      item.description = lineExpenseItemDescription(`${categories.get(item.expenseCategoryId ?? '')?.name ?? 'ค่าใช้จ่าย'} ${next.header.vendorName}`);
      record(`${item.itemRef}-DESC`);
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
    const quantity = item.quantity ?? (item.totalAmount ? '1' : undefined);
    if (!item.description || !quantity || (!item.unitPrice && !item.totalAmount)) return [];
    let price = item.unitPrice;
    if (!price && item.totalAmount) {
      try { price = new Decimal(item.totalAmount).div(quantity).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(); } catch { return []; }
    }
    if (!price) return [];
    return [{ lineNumber: index + 1, description: item.description, quantity, unitPrice: price,
      chargeKind: null,
      ...(item.expenseCategoryId ? { expenseCategoryId: item.expenseCategoryId } : {}) }];
  });
}

function acceptedFieldText(
  field: string,
  state: LineExpenseDraftContinuation,
  categoryNames: ReadonlyMap<string, string>,
): string {
  if (field === 'D-DATE') return `วันที่ ${new Date(`${state.header.expenseDate}T00:00:00Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
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
  language?: 'th' | 'en';
  state: LineExpenseDraftContinuation;
  categories: readonly ExpenseCategorySummary[];
  acceptedFields?: string[];
  label?: string;
  /** Questions are shown only during work the user explicitly asked to continue. */
  includeQuestions?: boolean;
}): string {
  const state = input.state;
  const names = new Map(input.categories.map((category) => [category.id, category.name]));
  const printableItems = state.items.filter(item => item.description && (item.quantity || item.totalAmount) && (item.unitPrice || item.totalAmount));
  if (input.language === 'en') {
    const fields: Record<string, string> = { vendorName: 'seller name', expenseDate: 'expense date', businessPurpose: 'business purpose',
      description: 'item or service', quantity: 'quantity and unit', price: 'unit price or total', expenseCategoryId: 'expense category', review: 'review the existing item on the web' };
    const lines = ['🧾 Expense draft saved, awaiting your confirmation.'];
    if (input.acceptedFields?.length) lines.push('Draft updated; the current details are below.');
    if (state.header.vendorName) lines.push(`Seller: ${state.header.vendorName}`);
    lines.push(`Date: ${state.header.expenseDate ? new Date(`${state.header.expenseDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Not provided'}`);
    if (state.header.businessPurpose) lines.push(`Purpose: ${state.header.businessPurpose}`);
    for (const item of printableItems.slice(0, 30))
      lines.push(`Item: ${item.description} · ${item.quantity ?? '1'}${item.unit ? ` ${lineUiLabel(item.unit, 'en')}` : ''} · ${item.unitPrice ? `${item.unitPrice} THB per unit` : `${item.totalAmount} THB`}`);
    if (printableItems.length > 30) lines.push(`And ${printableItems.length - 30} more items`);
    if (state.status === 'CANCELLED') lines.push('Draft conversation cancelled; the existing draft and evidence are kept.');
    else if (state.status === 'INPUT_ENDED_COMPLETE') lines.push('Ready for an authorized reviewer; nothing has been posted.');
    else if (state.status === 'INPUT_ENDED_INCOMPLETE') lines.push('The details you provided are kept.');
    else if (state.status === 'OPEN' && input.includeQuestions !== false && state.unresolvedQuestions.length) {
      const question = state.unresolvedQuestions[0]!;
      lines.push(`Please add the ${fields[question.field] ?? 'item details'}.`);
    }
    return lines.join('\n');
  }
  const lines: string[] = [];
  if (input.acceptedFields?.length) {
    lines.push(state.items.length > 10 ? `แก้ร่างแล้ว ${input.acceptedFields.length} ข้อ — ดูข้อมูลปัจจุบันด้านล่าง` : `แก้ร่างแล้ว: ${input.acceptedFields.map((field) => acceptedFieldText(field, state, names)).join(' • ')}`);
  }
  lines.push('🧾 เก็บร่างค่าใช้จ่ายแล้วค่ะ');
  if (state.header.vendorName) lines.push(`ร้าน: ${state.header.vendorName}`);
  if (state.header.expenseDate) lines.push(`วันที่: ${new Date(`${state.header.expenseDate}T00:00:00Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`);
  else lines.push('วันที่: ยังไม่มีวันที่');
  if (state.header.businessPurpose) lines.push(`ใช้เพื่อ: ${state.header.businessPurpose}`);
  for (const item of printableItems.slice(0, 30)) {
    lines.push(`รายการ: ${item.description} ${item.quantity ?? '1'}${item.unit ? ` ${item.unit}` : ''} ${item.unitPrice ? `ราคา ${item.unitPrice} บาท/หน่วย` : `${item.totalAmount} บาท`}`);
  }
  if (printableItems.length > 30) lines.push(`และอีก ${printableItems.length - 30} รายการ`);
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
    const question = state.unresolvedQuestions[0]!;
    lines.push('', question.prompt.replace(/^I\d+\s*/u, '').replace(/\?$/u, 'คะ'));
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
