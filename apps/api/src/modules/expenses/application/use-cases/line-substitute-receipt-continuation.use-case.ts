import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { ExpensePaymentMethod, LineSubstituteReceiptPrefill, RequestContext, SubstituteReceiptReasonCode } from '@watchdog-bms/contracts';
import { extractValueCandidates, isAmbiguousDateCandidate } from '@watchdog-bms/contracts';
import type { ExpenseRecordWithRelations } from '../../domain/models/expense.model';
import { AuditService } from '../../../audit/application/audit.service';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { substituteWetSignedScanRejection } from '../../domain/logic/substitute-receipt-pdf.logic';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { collectSubstituteReceiptEligibilityIssues, PrepareSubstituteReceiptUseCase } from './substitute-receipt.use-case';
import { maySubmitSignature } from './signature-asset.use-case';
import { CreateDocumentDeliveryLinkUseCase, type DocumentDeliveryLinkKind } from './document-delivery-link.use-case';

const STATE_KEY = 'lineSubstituteReceiptContinuation';
/** One coded shape for “these bytes may not become this document's signed original”, shared by the
 *  repository's state guard and the composability gate so the web shows one Thai sentence. */
export const SCAN_NOT_LINKABLE = 'substitute_wet_signed_scan_not_linkable';
const ACTIVE_STATUSES = new Set(['OPEN', 'PAUSED']);
const MAX_VALUE_LENGTH = 500;
/** F7: the expense statuses the delivery-link reissue searches. Wider than the correction-candidate
 *  default because a document outlives its expense's editable window — a web confirm moves the
 *  expense to CONFIRMED while its issued/prepared document stays deliverable. */
const REISSUE_EXPENSE_STATUSES = ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION', 'CONFIRMED'] as const;

export type LineSubstituteReceiptValues = {
  reasonCode?: SubstituteReceiptReasonCode;
  missingReceiptReason?: string;
  businessPurpose?: string;
  payerUserId?: string;
  payeeName?: string;
  paymentDate?: string;
  paymentMethod?: ExpensePaymentMethod;
  itemDescription?: string;
  amount?: string;
  expenseCategoryId?: string;
  /** R5: the sender stated there is no file to attach. Asked once, then never blocking again. */
  evidenceNone?: boolean;
};

export type LineSubstituteReceiptContinuation = {
  workflowId: string;
  kind: 'SUBSTITUTE_RECEIPT';
  companyId: string;
  userId: string;
  expenseId: string;
  chatKeyHash: string;
  status: 'OPEN' | 'PAUSED' | 'CANCELLED' | 'CONSUMED';
  acceptedValues: LineSubstituteReceiptValues;
  provenance: Record<string, { source: 'LINE_USER_TEXT'; acceptedAt: string; messageHash: string }>;
  resolvedFields: string[];
  missingFields: string[];
  attachmentRefs: string[];
  pendingQuestion: string | null;
  /** R13: preflight is clean and the assistant has asked whether to issue. Additive — `parseState`
   *  accepts every state written before this existed, and its absence means "no decision pending". */
  pendingDecision?: 'ISSUE_CONFIRM';
  /** R10: this chat asked for a printable form, so a photo arriving later may be the signed sheet.
   *  Written by the prepare that consumes this state and never cleared — `awaitingScan` below reads
   *  the evidence itself for the part that can still change. Additive, like `pendingDecision`. */
  formRequested?: boolean;
  /** A3: the issue decision reached “yes, issue it” and stopped because this signer has no reusable
   *  signature. A photo arriving now may be that signature, so the media question must offer it as
   *  a choice. Additive exactly like `formRequested`, and read back the same way. */
  signatureRequested?: boolean;
  targetRevision: string;
  lastActivityAt: string;
};

export type LineSubstituteReceiptBlocker = { code: string; message: string; collectableInLine: boolean };

export type LineSubstituteReceiptContinuationResult = {
  handled: true;
  status: 'READY_FOR_WEB' | 'BLOCKED' | 'INELIGIBLE' | 'FORBIDDEN' | 'TARGET_REQUIRED' | 'PAUSED' | 'CANCELLED' | 'STALE';
  replyText: string;
  /** §13: the state badge the card renders above the body. Additive — absent means no badge row. */
  badge?: string;
  workflowId?: string;
  expenseId?: string;
  acceptedFields: string[];
  blockers: LineSubstituteReceiptBlocker[];
  pendingQuestion?: string;
  webPath?: string;
  policy?: { configured: boolean; ready: boolean; approvalMode: 'OWNER_SELF' | 'DESIGNATED_APPROVERS' };
  sideQuestionAnswered?: boolean;
  resumeCapsule?: string;
};

// NFC, never NFKC: NFKC decomposes ำ (U+0E33 → U+0E4D U+0E32), which both mangles echoed user text
// and stops every composed-ำ literal below (ทำใบรับรองต่อ, ไว้ทำทีหลัง, ไม่ทำแล้ว) from ever matching.
const SUBSTITUTE_VOCABULARY = /(ใบรับรองแทนใบเสร็จ(?:รับเงิน)?|ใบทดแทนใบเสร็จ|ใบแทนใบเสร็จ|ใบรับรองแทนเงินสด|ทำใบรับรองต่อ)/u;

/** §12.7 — the phrase that re-mints an expired delivery link, kept OUT of `SUBSTITUTE_VOCABULARY`
 *  so R1's capture-first slice can never read “ขอลิงก์ใหม่” as an expense description. */
const DELIVERY_LINK_REQUEST = /(ขอลิงก์ใหม่|ลิงก์หมดอายุ)/u;

export function isSubstituteReceiptConversationText(text: string): boolean {
  const normalized = text.normalize('NFC').toLocaleLowerCase('th-TH');
  return SUBSTITUTE_VOCABULARY.test(normalized) || DELIVERY_LINK_REQUEST.test(normalized);
}

export function isDeliveryLinkRequestText(text: string): boolean {
  return DELIVERY_LINK_REQUEST.test(text.normalize('NFC').toLocaleLowerCase('th-TH'));
}

/** Whole-message pause/cancel controls, anchored so answers like “ไม่มี”/“ไม่มีใบเสร็จ” stay out.
 *  Shared by `execute`'s turn routing and the short-answer capture guard in `extractValues`. */
const SUBSTITUTE_PAUSE = /^(พัก|พักไว้ก่อน|ไว้ทำทีหลัง|ไม่ทำต่อ|ไม่ต่อ|ไม่ทำ|ไม่เอา|ไม่ต้องทำ)$/u;
const SUBSTITUTE_CANCEL = /^(ยกเลิก|ยกเลิกงานนี้|ไม่ทำแล้ว)$/u;
/** The resume/acknowledgement/number replies the bot itself teaches (R15 “ทำต่อ”, a bare choice
 *  number, a yes). None is ever the value of a certified field, so the short-answer capture skips them. */
const SUBSTITUTE_CONTROL_REPLY = /^(ทำต่อ|ใช่|ตกลง|ครับ|ค่ะ|โอเค|โอเก|ok|\d{1,2})$/iu;

/** R1: the expense fact inside a combined “ออกใบทดแทนใบเสร็จ ค่าวินมอไซต์ … 50 บาท” message.
 *
 *  The capture gate (`isLineTextExpenseCaptureEligible`) only accepts a description it can find
 *  verbatim in the source text, so this returns ONE contiguous slice — the longer side of the
 *  message around the vocabulary phrase — never a stitched-together remainder.
 *
 *  Undefined when nothing but the amount is left: spec R1 requires amount PLUS purpose/category, so
 *  a bare “ทำใบทดแทนใบเสร็จ 50 บาท” — or one leaving only a request verb — must keep falling through
 *  to target selection.
 *  ponytail: a 4-character floor, not a verb denylist; it drops ทำ/ขอ/สร้าง-only leftovers and costs
 *  a one-word purpose shorter than that (น้ำ), which still gets answered by target selection. */
export function substituteRequestExpenseText(text: string): string | undefined {
  const normalized = text.normalize('NFC');
  const match = normalized.match(SUBSTITUTE_VOCABULARY);
  if (match?.index === undefined) return undefined;
  const before = normalized.slice(0, match.index).trim();
  const after = normalized.slice(match.index + match[0].length).trim();
  const description = normalizedText(after.length >= before.length ? after : before);
  return description.replace(/[\d,.\s]|บาท|thb|baht|฿/giu, '').length >= 4 ? description : undefined;
}

function normalizedText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function bounded(value: string | undefined, max = MAX_VALUE_LENGTH): string | undefined {
  const text = value && normalizedText(value);
  return text && text.length <= max ? text : undefined;
}

const LABELS = {
  missingReceiptReason: 'เหตุผล(?:ที่ไม่มีใบเสร็จ)?|สาเหตุ',
  businessPurpose: 'วัตถุประสงค์(?:ทางธุรกิจ)?|ใช้เพื่อ',
  payeeName: 'ผู้รับเงิน|ผู้ขาย|ร้านค้า',
  paymentMethod: 'วิธีชำระ(?:เงิน)?|ชำระด้วย|จ่ายด้วย',
  itemDescription: 'รายการ|รายละเอียดรายการ',
  amount: 'ยอด(?:รวม)?|จำนวนเงิน',
  expenseCategoryId: 'หมวด(?:ค่าใช้จ่าย)?',
} as const;
const ANY_LABEL = Object.values(LABELS).join('|');

/** The dispatcher's normalizeLineText collapses every newline to a space, so a multi-line LINE
 *  message arrives as ONE line: a label must be matchable mid-line, and its value must stop at the
 *  next label instead of swallowing it.
 *
 *  Mid-line a label is only a label when an explicit `:` follows it: without that,
 *  “เหตุผล: ผู้ขายรายย่อยไม่ออกเอกสาร” reads its own reason text as a payee name, and ordinary prose
 *  (“ค่าส่งของวันนี้ ผู้ขายเป็นคนจัดส่งเอง”) writes a legal field. คือ/เป็น stay valid only at the
 *  start of a line, unchanged, which is what makes a bare “ชำระด้วยเงินสด” line an answer.
 *
 *  The value-ending lookahead stays permissive on purpose: truncating at a คือ/เป็น phrase loses a
 *  value, while running past it would store the rest of the sentence in a certified field. */
function labeled(text: string, labels: string): string | undefined {
  const label = `(?:${labels})`;
  const sep = '(?::|คือ|เป็น)';
  const match = text.match(new RegExp(
    `(?:(?:^|\\n)\\s*${label}\\s*${sep}?|\\s+${label}\\s*:)\\s*(.+?)(?=\\s*(?:${ANY_LABEL})\\s*${sep}|[,;\\n]|$)`,
    'imu',
  ));
  return bounded(match?.[1]);
}

function paymentMethodOf(text: string): ExpensePaymentMethod | undefined {
  if (/(เงินสด|cash)/iu.test(text)) return 'CASH';
  if (/(โอน|bank\s*transfer|พร้อมเพย์)/iu.test(text)) return 'BANK_TRANSFER';
  if (/(บัตร|card)/iu.test(text)) return 'CARD';
  if (/(เช็ค|เช็ก|cheque|check)/iu.test(text)) return 'CHEQUE';
  return undefined;
}

function nonQuestionLines(text: string): string {
  return text.split(/\n+/u)
    .filter((line) => !/[?？]|ไหม|อย่างไร|ยังไง|ถ้า/u.test(line))
    .join('\n');
}

function reasonCodeOf(text: string): SubstituteReceiptReasonCode | undefined {
  if (/(ผู้ขาย|ผู้รับเงิน|ร้าน).*(ออก|ให้).*(ไม่ได้|ไม่ออก)|ไม่สามารถออก/u.test(text)) return 'PAYEE_CANNOT_ISSUE';
  if (/(ชำรุด|ไม่ครบ|ข้อมูลไม่ครบ|อ่านไม่ออก)/u.test(text)) return 'RECEIPT_MATERIALLY_INCOMPLETE';
  if (/(ไม่มีใบเสร็จ|ใบเสร็จหาย|ไม่ได้รับใบเสร็จ|หาใบเสร็จไม่เจอ)/u.test(text)) return 'RECEIPT_UNAVAILABLE';
  return undefined;
}

function firstPaymentDate(text: string): string | undefined {
  if (!/(วันที่จ่าย|วันที่ชำระ|ชำระเมื่อ|จ่ายเมื่อ)/u.test(text)) return undefined;
  return extractValueCandidates(text).dates.find((candidate) => !isAmbiguousDateCandidate(candidate))?.isoDate;
}

function messageHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function ordinalSelection(text: string, count: number): number | null {
  const match = normalizedText(text).match(/^(?:รายการ|ข้อ|อัน(?:ที่)?)?\s*(\d{1,2})$/u);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < count ? index : null;
}

function parseState(value: unknown): LineSubstituteReceiptContinuation | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Partial<LineSubstituteReceiptContinuation>;
  if (state.kind !== 'SUBSTITUTE_RECEIPT' || typeof state.workflowId !== 'string'
    || typeof state.companyId !== 'string' || typeof state.userId !== 'string'
    || typeof state.expenseId !== 'string' || typeof state.chatKeyHash !== 'string'
    || !state.status || !state.acceptedValues || !state.provenance
    || typeof state.targetRevision !== 'string') return null;
  return state as LineSubstituteReceiptContinuation;
}

function stateFromMetadata(metadata: Record<string, unknown> | null): LineSubstituteReceiptContinuation | null {
  return parseState(metadata?.[STATE_KEY]);
}

/** R1 guard for the dispatcher: `execute` resolves an existing OPEN/PAUSED workflow before it ever
 *  looks at `recentCandidates`, so capturing a new draft for this chat would orphan it. Takes the
 *  rows from `listLineSubstituteContinuationRows` so the state shape stays owned by this module. */
export function hasActiveSubstituteContinuation(
  rows: Array<{ sourceChannelMetadataJson: Record<string, unknown> | null }>,
): boolean {
  return rows.some((row) => {
    const state = stateFromMetadata(row.sourceChannelMetadataJson);
    return !!state && ACTIVE_STATUSES.has(state.status);
  });
}

function extractValues(
  text: string,
  pendingField: string | null,
  currentUserId: string,
  activeCategories: Array<{ id: string; name: string }>,
): LineSubstituteReceiptValues {
  const values: LineSubstituteReceiptValues = {};
  const declarative = nonQuestionLines(text);
  const reasonCode = reasonCodeOf(declarative);
  if (reasonCode) values.reasonCode = reasonCode;
  const missingReceiptReason = labeled(declarative, LABELS.missingReceiptReason);
  if (missingReceiptReason) values.missingReceiptReason = missingReceiptReason;
  const businessPurpose = labeled(declarative, LABELS.businessPurpose);
  if (businessPurpose) values.businessPurpose = businessPurpose;
  const payeeName = labeled(declarative, LABELS.payeeName);
  if (payeeName) values.payeeName = payeeName;
  if (/(ฉัน|ผม|ดิฉัน|หนู).*(เป็น|คือ).*(ผู้จ่าย|คนจ่าย)|ผู้จ่าย(?:เงิน)?\s*(?:คือ|เป็น)?\s*(ฉัน|ผม|ดิฉัน|หนู)/u.test(declarative)) {
    values.payerUserId = currentUserId;
  }
  const labeledPayment = labeled(declarative, LABELS.paymentMethod);
  const plainPayment = pendingField === 'paymentMethod' && normalizedText(declarative).length <= 40
    ? declarative
    : undefined;
  const paymentMethod = paymentMethodOf(labeledPayment ?? plainPayment ?? '');
  if (paymentMethod) values.paymentMethod = paymentMethod;
  const paymentDate = firstPaymentDate(declarative);
  if (paymentDate) values.paymentDate = paymentDate;
  const itemDescription = labeled(declarative, LABELS.itemDescription);
  if (itemDescription) values.itemDescription = itemDescription;
  const amountLabel = labeled(declarative, LABELS.amount);
  if (amountLabel) {
    const amount = extractValueCandidates(amountLabel).amounts[0]?.value;
    if (amount) values.amount = amount;
  }
  const categoryLabel = labeled(declarative, LABELS.expenseCategoryId);
  if (categoryLabel) {
    const wanted = normalizedText(categoryLabel).toLocaleLowerCase('th-TH');
    const category = activeCategories.find((item) => normalizedText(item.name).toLocaleLowerCase('th-TH') === wanted);
    if (category) values.expenseCategoryId = category.id;
  }
  // R5 ask-once: only the evidence question may be answered with “no evidence”. An unprompted
  // “ไม่มีใบเสร็จ” is a reason code, never a statement that no file exists. The natural answer to
  // “มีสลิปไหม” is a bare “ไม่มี”, so that short form counts too — but only while it is the question.
  if (pendingField === 'evidenceNone'
    && (/(ไม่มีหลักฐาน|ไม่มีสลิป|ไม่มีรูป|ไม่มีไฟล์)/u.test(declarative)
      || /^ไม่มี\S{0,4}$/u.test(normalizedText(declarative)))) {
    values.evidenceNone = true;
  }

  // A short unlabeled answer is accepted only for the exact source-generated pending question — but
  // never when it is a control phrase the bot itself taught the sender to type here: resume/pause/
  // cancel words, the delivery-link request, a bare choice number, a yes. Captured, any of these
  // would become e.g. missingReceiptReason on the issued legal document; skipped, it stays a blocker
  // and routes as the control it is.
  const plain = bounded(text, 200);
  const lowered = plain?.toLocaleLowerCase('th-TH') ?? '';
  const controlPhrase = !!plain && (
    isSubstituteReceiptConversationText(plain)
    || SUBSTITUTE_PAUSE.test(lowered)
    || SUBSTITUTE_CANCEL.test(lowered)
    || SUBSTITUTE_CONTROL_REPLY.test(plain)
  );
  if (plain && !controlPhrase && Object.keys(values).length === 0 && !/[?？]|ไหม|หรือไม่|อย่างไร|ยังไง/u.test(plain)) {
    if (pendingField === 'missingReceiptReason') values.missingReceiptReason = plain;
    if (pendingField === 'businessPurpose') values.businessPurpose = plain;
    if (pendingField === 'payeeName') values.payeeName = plain;
  }
  return values;
}

function groundedSideAnswer(expense: ExpenseRecordWithRelations, text: string): string | undefined {
  if (/(vat|ภาษีมูลค่าเพิ่ม|ภาษีซื้อ|เคลมภาษี|เครดิตภาษี)/iu.test(text)
    && /[?？]|ไหม|ได้หรือไม่|อย่างไร|ยังไง/u.test(text)) {
    return [
      `คำถามแทรก — VAT: รายการปัจจุบันมีสถานะหลักฐานภาษี ${expense.taxEvidenceStatus ?? 'รอตรวจสอบ'}`,
      'ใบรับรองแทนใบเสร็จรับเงินเป็นหลักฐานภายใน ไม่ใช่ใบกำกับภาษีจากผู้ขาย และไม่ทำให้ VAT ซื้อกลายเป็นเครดิตภาษีได้',
      'หากมีใบกำกับภาษีจากผู้ขาย ให้แนบในรายการและให้ผู้มีสิทธิ์ตรวจสอบในเว็บ',
    ].join('\n');
  }
  if (/(ใบนี้|เอกสารนี้).*(คืออะไร|ประเภทอะไร|เป็นอะไร)|ประเภทเอกสาร/u.test(text)
    && /[?？]|อะไร|ไหม/u.test(text)) {
    return `คำถามแทรก — ประเภทเอกสารในระบบตอนนี้: ${expense.sourceDocumentType ?? 'ยังไม่ระบุ'} (ต้องตรวจจากหลักฐานต้นทางในเว็บ)`;
  }
  return undefined;
}

function blocker(code: string, message: string, collectableInLine = false): LineSubstituteReceiptBlocker {
  return { code, message, collectableInLine };
}

function currentValue<T extends keyof LineSubstituteReceiptValues>(
  values: LineSubstituteReceiptValues,
  key: T,
  fallback: LineSubstituteReceiptValues[T],
): LineSubstituteReceiptValues[T] {
  return values[key] ?? fallback;
}

function preflight(
  ctx: RequestContext,
  expense: ExpenseRecordWithRelations,
  values: LineSubstituteReceiptValues,
  policy: { configured: boolean; approvalMode: 'OWNER_SELF' | 'DESIGNATED_APPROVERS'; approverUserIds: string[]; cashEvidencePolicy: string },
  eligibleApproverIds: Set<string>,
  payerActive: boolean,
): LineSubstituteReceiptBlocker[] {
  const result: LineSubstituteReceiptBlocker[] = [];
  if (!ctx.permissions.includes('expense.review')) result.push(blocker('expense_review_forbidden', 'ไม่มีสิทธิ์ตรวจทานเพื่อจัดทำใบรับรองแทนใบเสร็จรับเงิน'));
  result.push(...collectSubstituteReceiptEligibilityIssues(expense, values.reasonCode)
    .map((issue) => blocker(issue.code, issue.message)));
  if (expense.substituteReceiptEvidence && expense.substituteReceiptEvidence.status !== 'SUPERSEDED') {
    result.push(blocker('active_substitute_evidence_exists', 'รายการนี้มีใบรับรองแทนใบเสร็จที่ยังใช้งานอยู่แล้ว'));
  }
  if (!values.reasonCode) result.push(blocker('reason_code_required', 'ระบุกรณีที่ไม่มี/ใช้ใบเสร็จเดิมไม่ได้', true));
  if (!currentValue(values, 'missingReceiptReason', expense.missingReceiptReason ?? undefined)) {
    result.push(blocker('missing_receipt_reason_required', 'ระบุเหตุผลที่ไม่มีใบเสร็จ', true));
  }
  if (!values.businessPurpose) result.push(blocker('business_purpose_required', 'ระบุวัตถุประสงค์ทางธุรกิจ', true));
  if (!values.payerUserId) result.push(blocker('payer_required', 'ยืนยันผู้จ่ายเงินจริง (เช่น “ฉันเป็นผู้จ่าย”)', true));
  else if (!payerActive) result.push(blocker('payer_not_active_in_branch', 'ผู้จ่ายต้องเป็นสมาชิกที่ยังใช้งานและอยู่ในขอบเขตสาขานี้'));
  if (!currentValue(values, 'payeeName', expense.vendorNameSnapshot ?? undefined)) {
    result.push(blocker('payee_required', 'ระบุชื่อผู้รับเงิน/ผู้ขาย', true));
  }
  const paymentMethod = currentValue(values, 'paymentMethod', expense.paymentMethod ?? undefined);
  if (!paymentMethod) result.push(blocker('payment_method_required', 'ระบุวิธีชำระเงิน', true));
  if (!currentValue(values, 'paymentDate', expense.paidAt?.toISOString().slice(0, 10))) {
    result.push(blocker('payment_date_required', 'ระบุวันที่ชำระเงินจริง', true));
  }
  if (policy.approvalMode === 'DESIGNATED_APPROVERS') {
    const ready = policy.approverUserIds.some((id) => eligibleApproverIds.has(id) && id !== values.payerUserId);
    if (!ready) result.push(blocker('designated_approver_not_ready', 'ยังไม่มีผู้อนุมัติที่ตั้งค่าไว้และมีสิทธิ์ในสาขานี้'));
  } else if (eligibleApproverIds.size === 0) {
    result.push(blocker('owner_self_approver_not_ready', 'ยังไม่มีสมาชิกที่มีสิทธิ์อนุมัติค่าใช้จ่ายในสาขานี้'));
  }
  const activeAttachments = expense.attachments.filter((item) => item.status === 'ACTIVE');
  const payments = activeAttachments.filter((item) => item.purpose === 'expense.payment.evidence');
  // R5: evidence is required only when evidence exists. The assistant still asks — once — and a
  // stated “ไม่มีหลักฐาน” clears the blocker instead of dead-ending a legal no-attachment document.
  if (activeAttachments.length === 0 && !values.evidenceNone) {
    result.push(blocker('supporting_evidence_required', 'ส่งรูปสลิป/รูปถ่ายประกอบเข้ามาในแชทนี้ หรือแนบในเว็บ หรือยืนยันว่าไม่มีหลักฐาน', true));
  }
  if (((paymentMethod && paymentMethod !== 'CASH') || policy.cashEvidencePolicy === 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE')
    && payments.length === 0) {
    result.push(blocker('payment_evidence_required', 'ส่งรูปหลักฐานการชำระเงินเข้ามาในแชทนี้ หรือแนบในเว็บ (ข้อความใช้แทนไฟล์ไม่ได้)'));
  }
  return result;
}

const QUESTIONS: Record<string, string> = {
  reason_code_required: 'ใบเสร็จไม่มี/หาย ผู้ขายออกให้ไม่ได้ หรือเอกสารเดิมไม่ครบคะ?',
  missing_receipt_reason_required: 'เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?',
  business_purpose_required: 'ค่าใช้จ่ายนี้ใช้เพื่อธุรกิจเรื่องอะไรคะ?',
  payer_required: 'ใครเป็นผู้จ่ายเงินจริงคะ? ถ้าเป็นคุณ ตอบ “ฉันเป็นผู้จ่าย” ได้เลย',
  payee_required: 'ผู้รับเงินหรือผู้ขายชื่ออะไรคะ?',
  payment_method_required: 'ชำระด้วยเงินสด โอน บัตร หรือเช็คคะ?',
  payment_date_required: 'ชำระเงินจริงวันที่เท่าไรคะ?',
  supporting_evidence_required: 'มีสลิปหรือรูปถ่ายประกอบไหมคะ? ถ้ามี ส่งรูปเข้ามาในแชทนี้ หรือแนบในเว็บ ถ้าไม่มี ตอบ “ไม่มีหลักฐาน” ได้เลย',
};

const FIELD_BY_BLOCKER: Record<string, keyof LineSubstituteReceiptValues> = {
  reason_code_required: 'reasonCode',
  missing_receipt_reason_required: 'missingReceiptReason',
  business_purpose_required: 'businessPurpose',
  payer_required: 'payerUserId',
  payee_required: 'payeeName',
  payment_method_required: 'paymentMethod',
  payment_date_required: 'paymentDate',
  supporting_evidence_required: 'evidenceNone',
};

/** R13: the one question the assistant asks once nothing is missing. It never produces the document
 *  unasked, and the three answers are the three things a person can actually want here. */
const ISSUE_DECISION_QUESTION = 'ให้ออกเอกสารเลยไหมคะ';
const ISSUE_DECISION_CHOICES = [
  'ออกเอกสาร (ใช้ลายเซ็นที่บันทึกไว้)',
  'ขอฟอร์มไปเซ็นเอง',
  'แก้ข้อมูลก่อน',
];

/** A question is never a decision. “ออกเอกสารได้ไหม” asks what the assistant can do; answering it by
 *  reserving a document number is the single worst misread available here. */
const DECISION_QUESTION = /[?？]|ไหม|หรือเปล่า|รึเปล่า|หรือไม่|อะไร|ยังไง|อย่างไร|ต่างกัน/u;
/** Refusal or deferral ANYWHERE in the message, not only at its front: `normalizedText` has already
 *  collapsed newlines, so “ออกเอกสารเลย\nไม่ ๆ เดี๋ยวก่อน” arrives as one line and must still decline. */
const DECISION_DECLINE = /ไม่|ยัง|อย่า|ห้าม|ค่อย|ทีหลัง|เดี๋ยวก่อน|พอแค่นี้|ภายหลัง/u;
const DECISION_FORM = /ขอฟอร์ม|ฟอร์ม|เซ็นเอง|พิมพ์ออกมา/u;
const DECISION_EDIT = /แก้ข้อมูล|แก้ไข|ขอแก้/u;
const DECISION_ISSUE = /ออกเอกสาร|ใช้ลายเซ็น/u;

/** Deterministic in three passes, in this order because each one protects the next:
 *  1. a question is not an answer — it falls through to the side-answer/re-ask path;
 *  2. a bare number is the choice it names;
 *  3. otherwise the wanted action comes from the choice's own words — and any refusal or deferral
 *     token alongside it turns the whole message into an explicit DECLINE, which reserves nothing.
 *  The paper route is read before issuance so “ขอฟอร์มไปเซ็นเอง ไม่ต้องออกเอกสาร” is one decline of
 *  issuance, not two conflicting choices. */
function issueDecisionChoice(text: string): 'ISSUE' | 'FORM' | 'EDIT' | 'DECLINE' | undefined {
  const value = normalizedText(text);
  if (DECISION_QUESTION.test(value)) return undefined;
  const numbered = /^([123])[.)]?$/u.exec(value)?.[1];
  if (numbered) return numbered === '1' ? 'ISSUE' : numbered === '2' ? 'FORM' : 'EDIT';
  const wanted = DECISION_FORM.test(value) ? 'FORM' as const
    : DECISION_EDIT.test(value) ? 'EDIT' as const
    : DECISION_ISSUE.test(value) ? 'ISSUE' as const
    : undefined;
  if (!wanted) return undefined;
  return DECISION_DECLINE.test(value) ? 'DECLINE' : wanted;
}

/** R15 (D6): the sender's words say the payee could sign, which is the `ใบสำคัญรับเงิน` situation —
 *  a different, stronger document this system does not produce. Explain it, say so, and ask; never
 *  hand over the weaker document as if it were the same thing.
 *
 *  A refusal is the case `ใบรับรองแทนใบเสร็จรับเงิน` exists FOR, so “ผู้ขายไม่ยอมเซ็น” must never
 *  trigger this. Two guards keep it out: the gap inside the pattern cannot cross a negation, and the
 *  few characters before the match are checked as well (which is what catches the ID-copy phrase in
 *  “ไม่มีสำเนาบัตรของผู้รับเงิน”).
 *
 *  OWNER-REVIEW-PENDING: the wording below is a draft. Spec §19 keeps the exact copy open until the
 *  owner reviews it against a real conversation. The behaviour — explain, refuse to substitute
 *  silently, ask one question — is settled; only these sentences are provisional. */
const PAYEE_COULD_SIGN = /(?:ผู้รับเงิน|ผู้ขาย|เขา|ร้าน)(?:(?!ไม่|มิได้|ปฏิเสธ).){0,12}(?:เซ็นให้ได้|เซ็นแล้ว|ยอมเซ็น)|สำเนาบัตร(?:ประชาชน)?ของผู้รับเงิน/u;
const PAYEE_REFUSED = /ไม่|มิได้|ปฏิเสธ/u;
const PAYEE_COULD_SIGN_QUESTION = 'จะทำใบรับรองแทนใบเสร็จรับเงินต่อไหมคะ';

function payeeCouldSignHeadline(text: string): string | undefined {
  const normalized = text.normalize('NFC');
  const match = PAYEE_COULD_SIGN.exec(normalized);
  if (!match) return undefined;
  if (PAYEE_REFUSED.test(normalized.slice(Math.max(0, match.index - 6), match.index + match[0].length))) return undefined;
  return [
    '📌 ถ้าผู้รับเงินลงนามให้ได้ เอกสารที่ตรงกับกรณีนี้คือ “ใบสำคัญรับเงิน” ซึ่งผู้รับเงินเป็นผู้ลงนามเอง มักแนบสำเนาบัตรประชาชนของผู้รับเงิน และเป็นหลักฐานที่หนักแน่นกว่า “ใบรับรองแทนใบเสร็จรับเงิน” ที่พนักงานผู้จ่ายรับรองตัวเอง',
    'ระบบยังไม่รองรับการออกใบสำคัญรับเงินค่ะ',
    'ตอบ “ทำต่อ” เพื่อทำใบรับรองแทนใบเสร็จรับเงินต่อ หรือ “ไม่ทำต่อ” เพื่อพักงานนี้ไว้',
  ].join('\n');
}

/** R14/§11. What this chat's open substitute work is, as far as an arriving photo is concerned.
 *  Built from the continuation states in this chat plus the evidence rows they point at — nothing
 *  here is inferred from the picture, which the API never looks at. */
export type LineSubstituteMediaScan = {
  expenseId: string;
  evidenceId: string;
  documentNumber: string;
  amountLabel: string;
  /** When the form was prepared, so `loadOpenMediaContext` can offer the awaiting scans newest-first. */
  preparedAt: string;
};

export type LineSubstituteMediaContext = {
  /** Where a slip or a supporting photo belongs. */
  expenseId: string;
  /** R10/§15: every form printed from this chat that is still waiting for its signed photo,
   *  newest first. D9 names the newest; “ไม่ใช่” lists the rest instead of dead-ending. */
  awaitingScans: LineSubstituteMediaScan[];
  /** A3: this chat's open work stopped at “send me your signature”, so an untitled photo is very
   *  plausibly it and the numbered question has to say so. */
  signatureRequested: boolean;
};

export type LineSubstituteMediaChoice =
  | 'WET_SIGNED_SCAN' | 'SIGNATURE' | 'PAYMENT_EVIDENCE' | 'SUPPORTING_EVIDENCE' | 'NEW_EXPENSE' | 'NO_RECORD';

/** The question a set of pending bytes is waiting on, recorded WITH them. A numbered answer is
 *  resolved against this record, never against what the current state would ask now: the two lists
 *  differ, and reading “2” off the wrong one inverts what the sender said. */
export type LineSubstituteMediaQuestion =
  | { kind: 'SUBSTITUTE_SCAN_CONFIRM'; chatKeyHash: string; evidenceId: string }
  | { kind: 'SUBSTITUTE_SCAN_PICK'; chatKeyHash: string; evidenceIds: string[] }
  | { kind: 'SUBSTITUTE_MEDIA_CLASS'; chatKeyHash: string; choices: LineSubstituteMediaChoice[] };

const MEDIA_CHOICES = new Set<LineSubstituteMediaChoice>([
  'WET_SIGNED_SCAN', 'SIGNATURE', 'PAYMENT_EVIDENCE', 'SUPPORTING_EVIDENCE', 'NEW_EXPENSE', 'NO_RECORD',
]);

/** Reads back a recorded question, and only ours: an unrecognised shape, a row written before this
 *  existed, or a row from ANOTHER chat all return undefined, which leaves the turn to the receipt
 *  clarify exactly as before. Chat identity is checked here because the pending row is scoped per
 *  user while substitute work is scoped per chat. */
export function parseSubstituteMediaQuestion(value: unknown, chatKeyHash: string): LineSubstituteMediaQuestion | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<LineSubstituteMediaQuestion> & { kind?: string; chatKeyHash?: string };
  if (record.chatKeyHash !== chatKeyHash) return undefined;
  if (record.kind === 'SUBSTITUTE_SCAN_CONFIRM' && typeof (record as { evidenceId?: unknown }).evidenceId === 'string') {
    return { kind: 'SUBSTITUTE_SCAN_CONFIRM', chatKeyHash, evidenceId: (record as { evidenceId: string }).evidenceId };
  }
  const ids = (record as { evidenceIds?: unknown }).evidenceIds;
  if (record.kind === 'SUBSTITUTE_SCAN_PICK' && Array.isArray(ids) && ids.every((id) => typeof id === 'string')) {
    return { kind: 'SUBSTITUTE_SCAN_PICK', chatKeyHash, evidenceIds: ids as string[] };
  }
  const choices = (record as { choices?: unknown }).choices;
  if (record.kind === 'SUBSTITUTE_MEDIA_CLASS' && Array.isArray(choices)
    && choices.every((choice) => MEDIA_CHOICES.has(choice as LineSubstituteMediaChoice))) {
    return { kind: 'SUBSTITUTE_MEDIA_CLASS', chatKeyHash, choices: choices as LineSubstituteMediaChoice[] };
  }
  return undefined;
}

/** A signature is a different route with a different destination, and the router already owns it.
 *  Read here as well so a DEGRADED router cannot let a signature photo reach the D9 confirm, where
 *  one “ใช่” would file a signature crop as the wet-signed original of a legal document. */
const SIGNATURE_CAPTION = /(ลายเซ็น|ลายมือชื่อ|signature)/iu;
const PAYMENT_CAPTION = /(สลิป|โอน|จ่ายแล้ว|หลักฐานการจ่าย)/u;
const PROOF_CAPTION = /(หลักฐาน|ใบเสร็จ|รูปประกอบ)/u;

/** A4: the same deterministic read, for the intake route that must not depend on the AI router
 *  being reachable. The caption is the sender's stated intent; the picture is never inspected. */
export function isSignatureCaptionText(caption: string): boolean {
  return SIGNATURE_CAPTION.test(normalizedText(caption));
}

/** §11: the caption is authoritative over the picture, because it is the sender's stated intent —
 *  so every caption class is read BEFORE the awaiting-scan state. Only a caption-silent photo can
 *  become the D9 confirm. `ASK` means two classes stay plausible: keep the bytes, ask once. */
export function classifySubstituteMedia(
  caption: string,
  awaitingScan: boolean,
): 'SIGNATURE' | 'PAYMENT_EVIDENCE' | 'SUPPORTING_EVIDENCE' | 'AWAITING_SCAN_CONFIRM' | 'ASK' {
  const text = normalizedText(caption);
  if (SIGNATURE_CAPTION.test(text)) return 'SIGNATURE';
  if (PAYMENT_CAPTION.test(text)) return 'PAYMENT_EVIDENCE';
  if (PROOF_CAPTION.test(text)) return 'SUPPORTING_EVIDENCE';
  if (awaitingScan) return 'AWAITING_SCAN_CONFIRM';
  return 'ASK';
}

/** D9: name the document back and ask for a yes. No OCR, no QR — the number is printed large on
 *  the form, so the answer takes one glance. */
export function substituteScanConfirmQuestion(scan: { documentNumber: string; amountLabel: string }): string {
  return [
    `ได้รับรูปเข้ามาค่ะ — ใบนี้คือฟอร์ม ${scan.documentNumber} ยอด ${scan.amountLabel} ที่เซ็นแล้วใช่ไหมคะ`,
    '1) ใช่',
    '2) ไม่ใช่ เป็นหลักฐานอื่น',
  ].join('\n');
}

export function substituteScanConfirmAnswer(text: string): 'YES' | 'NO' | undefined {
  const value = normalizedText(text);
  if (/^1[.)]?$/u.test(value) || /^(ใช่|ใช่ค่ะ|ใช่ครับ|ถูกต้อง)$/u.test(value)) return 'YES';
  if (/^2[.)]?$/u.test(value) || /^ไม่ใช่/u.test(value)) return 'NO';
  return undefined;
}

/** §15: “ไม่ใช่ ใบอื่น” lists the other forms awaiting a scan instead of dropping the photo. */
export function substituteScanPickQuestion(scans: LineSubstituteMediaScan[]): string {
  return [
    'ได้ค่ะ แล้วเป็นฟอร์มใบไหนคะ ตอบเลขข้อได้เลย',
    ...scans.map((scan, index) => `${index + 1}) ${scan.documentNumber} ยอด ${scan.amountLabel}`),
  ].join('\n');
}

const MEDIA_CHOICE_LABELS: Record<LineSubstituteMediaChoice, string> = {
  WET_SIGNED_SCAN: 'ฟอร์มที่เซ็นแล้ว',
  SIGNATURE: 'ลายเซ็นของฉัน (เก็บเป็นลายเซ็นประจำตัว)',
  PAYMENT_EVIDENCE: 'สลิป/หลักฐานการจ่ายของรายการนี้',
  SUPPORTING_EVIDENCE: 'หลักฐานประกอบของรายการนี้',
  NEW_EXPENSE: 'ค่าใช้จ่ายใหม่ (เส้นทางเดิม)',
  NO_RECORD: 'ภาพประกอบคำถาม ไม่ต้องบันทึก',
};

/** §11: exactly one numbered question, and only the choices this chat can actually honour — the
 *  signed-form choice is offered only while a form is awaiting its scan (§15). The last choice is
 *  the escape the receipt clarify has always had: a picture that answers a question and is not
 *  evidence of anything must still be storable as “do not record”. */
export function substituteMediaChoices(context: LineSubstituteMediaContext): LineSubstituteMediaChoice[] {
  return [
    ...(context.awaitingScans.length ? ['WET_SIGNED_SCAN' as const] : []),
    // A3: offered only while the work is actually blocked on a signature. Before this, a photo sent
    // straight after “ส่งรูปลายเซ็นเข้ามาได้เลย” had no answer on the list that could become one.
    ...(context.signatureRequested ? ['SIGNATURE' as const] : []),
    'PAYMENT_EVIDENCE' as const,
    'SUPPORTING_EVIDENCE' as const,
    'NEW_EXPENSE' as const,
    'NO_RECORD' as const,
  ];
}

export function substituteMediaQuestion(choices: LineSubstituteMediaChoice[]): string {
  return [
    'ได้รับรูปเข้ามาค่ะ ยังไม่แน่ใจว่าเป็นอะไร ตอบเลขข้อได้เลยนะคะ',
    ...choices.map((choice, index) => `${index + 1}) ${MEDIA_CHOICE_LABELS[choice]}`),
  ].join('\n');
}

/** One-based selection out of a numbered list of `count` items, or undefined when the message is
 *  not a bare choice number for THAT list. */
export function numberedSelection(text: string, count: number): number | undefined {
  const numbered = /^([1-9])[.)]?$/u.exec(normalizedText(text))?.[1];
  const index = numbered ? Number(numbered) - 1 : -1;
  return index >= 0 && index < count ? index : undefined;
}

/** The answer to the recorded question. `undefined` = not an answer to it, so the bytes stay
 *  pending and the turn is routed exactly as it would have been without an open substitute
 *  context. The list comes from the record, never from today's state. */
export function substituteMediaAnswer(
  text: string,
  choices: LineSubstituteMediaChoice[],
): LineSubstituteMediaChoice | undefined {
  const index = numberedSelection(text, choices.length);
  if (index !== undefined) return choices[index];
  const value = normalizedText(text);
  const matched = choices.filter((choice) => value.includes(MEDIA_CHOICE_LABELS[choice]));
  return matched.length === 1 ? matched[0] : undefined;
}

const VALUE_LABELS: Record<string, string> = {
  reasonCode: 'กรณีที่ใช้ใบเสร็จเดิมไม่ได้',
  missingReceiptReason: 'เหตุผลที่ไม่มีใบเสร็จ',
  businessPurpose: 'วัตถุประสงค์ทางธุรกิจ',
  payerUserId: 'ผู้จ่ายเงินจริง',
  payeeName: 'ผู้รับเงิน/ผู้ขาย',
  paymentMethod: 'วิธีชำระเงิน',
  paymentDate: 'วันที่ชำระเงินจริง',
  itemDescription: 'รายการ',
  amount: 'ยอดเงิน',
  expenseCategoryId: 'หมวดค่าใช้จ่าย',
  evidenceNone: 'หลักฐานประกอบ',
};

/** Resolves the path against the base ORIGIN (any path in webBaseUrl is dropped), matching
 *  safeTenantLink in line-business-card.logic.ts so the card lifts the result into a button.
 *  An absent or unparseable base degrades to the relative path instead of throwing. */
function absoluteLink(webBaseUrl: string | undefined, path: string): string {
  try {
    return webBaseUrl ? new URL(path, webBaseUrl).toString() : path;
  } catch {
    return path;
  }
}

function workflowLink(webBaseUrl: string | undefined, companyId: string, expenseId: string, workflowId: string): string {
  return absoluteLink(webBaseUrl, `/companies/${companyId}/expenses/substitute-receipts/new?expenseId=${encodeURIComponent(expenseId)}&workflow=${encodeURIComponent(workflowId)}`);
}

const PAYMENT_METHOD_LABELS: Record<ExpensePaymentMethod, string> = {
  CASH: 'เงินสด', BANK_TRANSFER: 'โอนเงิน', CARD: 'บัตร', CHEQUE: 'เช็ค', OTHER: 'วิธีอื่น',
};

const REASON_CODE_LABELS: Record<SubstituteReceiptReasonCode, string> = {
  PAYEE_CANNOT_ISSUE: 'ผู้ขายออกใบเสร็จให้ไม่ได้',
  RECEIPT_MATERIALLY_INCOMPLETE: 'เอกสารเดิมไม่สมบูรณ์',
  RECEIPT_UNAVAILABLE: 'ไม่มีใบเสร็จ/ใบเสร็จหาย',
  OTHER: 'กรณีอื่น',
};

/** The 2-decimal + บาท form every other LINE reply uses, so “200.00 บาท” matches the printed form
 *  D9 asks the sender to confirm against — never the stored decimal's “200.0000 THB”. Non-finite or
 *  non-THB degrades to the raw pair rather than mislabelling another currency as บาท. */
function bahtAmount(expense: { grandTotalAmount: string; currency: string }): string {
  const amount = Number(expense.grandTotalAmount);
  return Number.isFinite(amount) && expense.currency === 'THB'
    ? `${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`
    : `${expense.grandTotalAmount} ${expense.currency}`;
}

/** Every echoed bullet shows a value the sender can recognise: no ids, no enum codes, no ISO dates. */
function echoLines(values: LineSubstituteReceiptValues, categories: Array<{ id: string; name: string }>): string[] {
  return Object.entries(values).map(([field, value]) => {
    const shown = field === 'reasonCode' ? REASON_CODE_LABELS[value as SubstituteReceiptReasonCode]
      : field === 'paymentMethod' ? PAYMENT_METHOD_LABELS[value as ExpensePaymentMethod]
      : field === 'payerUserId' ? 'คุณ (ผู้ส่งข้อความ)'
      : field === 'evidenceNone' ? 'ไม่มีไฟล์ประกอบ'
      : field === 'expenseCategoryId' ? categories.find((item) => item.id === value)?.name
      // UTC keeps a date-only value on its own calendar day regardless of server timezone.
      : field === 'paymentDate' ? new Date(`${value}T00:00:00Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      : String(value);
    return `• ${VALUE_LABELS[field] ?? field}: ${shown ?? value}`;
  });
}

export const SUBSTITUTE_BADGES = {
  forbidden: '🔒 ไม่มีสิทธิ์',
  ineligible: '⛔ ทำไม่ได้',
  issued: '✅ ออกเอกสารแล้ว',
  awaitingSignature: '🖊️ รอลงนาม',
  awaitingConfirmation: '🔵 รอยืนยัน',
  ready: '🟢 ข้อมูลครบ',
  awaitingFile: '🟠 รอไฟล์หลักฐาน',
} as const;

/**
 * Spec §13's table, as one function. The order matters: a refusal outranks any progress, an existing
 * document outranks the conversation that produced it, and only when neither applies do the blockers
 * decide. `undefined` for the states §13 names no badge for — pause, cancel, stale, target selection
 * — because inventing one there would state a status the card cannot back up.
 */
export function substituteReceiptBadge(input: {
  status: LineSubstituteReceiptContinuationResult['status'];
  blockers?: LineSubstituteReceiptBlocker[];
  evidenceStatus?: string;
  /** R10: a PREPARED evidence whose chat asked for a printable sheet is waiting for ink, not a click. */
  awaitingPaperSignature?: boolean;
}): string | undefined {
  if (input.status === 'FORBIDDEN') return SUBSTITUTE_BADGES.forbidden;
  if (input.status === 'INELIGIBLE') return SUBSTITUTE_BADGES.ineligible;
  if (input.evidenceStatus === 'ISSUED' || input.evidenceStatus === 'SUPERSEDED') return SUBSTITUTE_BADGES.issued;
  if (input.evidenceStatus === 'PREPARED') {
    return input.awaitingPaperSignature ? SUBSTITUTE_BADGES.awaitingSignature : SUBSTITUTE_BADGES.awaitingConfirmation;
  }
  if (input.evidenceStatus === 'PAYER_CERTIFIED') return SUBSTITUTE_BADGES.awaitingConfirmation;
  if (input.status === 'PAUSED' || input.status === 'CANCELLED' || input.status === 'STALE'
    || input.status === 'TARGET_REQUIRED') return undefined;
  const blockers = input.blockers ?? [];
  if (!blockers.length) return SUBSTITUTE_BADGES.ready;
  return blockers.some((item) => item.collectableInLine)
    ? `🟡 ยังขาดข้อมูล ${blockers.length} อย่าง`
    : SUBSTITUTE_BADGES.awaitingFile;
}

/** Replies emitted before a target exists (or without permission) keep formatResult's shape:
 *  what is understood → what is missing → boundary → VAT caveat → link → exactly one question. */
function formatStandalone(input: {
  echoed?: LineSubstituteReceiptValues;
  categories?: Array<{ id: string; name: string }>;
  headline: string;
  choices?: string[];
  question: string;
  webPath?: string;
  /** After a LINE prepare the default line is no longer true: LINE did prepare — and only prepare. */
  boundary?: string;
}): string {
  const lines = ['📄 ใบรับรองแทนใบเสร็จรับเงิน'];
  const echo = echoLines(input.echoed ?? {}, input.categories ?? []);
  if (echo.length) lines.push('รับทราบจากข้อความนี้ (ยังไม่บันทึก):', ...echo);
  lines.push(input.headline);
  (input.choices ?? []).forEach((choice, index) => lines.push(`${index + 1}) ${choice}`));
  lines.push(input.boundary ?? 'LINE ยังไม่ได้เตรียม ลงนาม อนุมัติ หรือออกเอกสาร');
  lines.push('เอกสารภายในนี้ไม่ใช่ใบกำกับภาษีและไม่ทำให้ VAT ซื้อเครดิตได้');
  if (input.webPath) lines.push(`เปิดในเว็บ: ${input.webPath}`);
  lines.push('', `ทำต่อ: ${input.question}`);
  return lines.join('\n');
}

/** The target exists but is not readable under the current permissions/branch scope: no workflow link,
 *  no pending question (nothing here is answerable in chat), just the expense list to check scope. */
function targetOutOfScope(companyId: string, webBaseUrl: string | undefined, headline: string): LineSubstituteReceiptContinuationResult {
  return {
    handled: true, status: 'TARGET_REQUIRED', acceptedFields: [], blockers: [],
    replyText: formatStandalone({
      headline,
      question: 'เปิดรายการค่าใช้จ่ายในเว็บเพื่อตรวจสอบสิทธิ์และสาขาก่อนได้ไหมคะ?',
      webPath: absoluteLink(webBaseUrl, `/companies/${companyId}/expenses`),
    }),
  };
}

function resumeCapsule(
  expense: ExpenseRecordWithRelations,
  state: LineSubstituteReceiptContinuation,
  acceptedFields: string[],
  webPath?: string,
): string {
  const lines = [`↩️ งานใบรับรองแทนใบเสร็จรับเงินของรายการ ${expense.expenseNumber ?? expense.id} ยังอยู่`];
  if (acceptedFields.length) lines.push(`รับเพิ่มแล้ว: ${acceptedFields.map((field) => VALUE_LABELS[field] ?? field).join(', ')}`);
  if (state.pendingQuestion) lines.push(`ทำต่อ: ${state.pendingQuestion}`);
  else lines.push(`ยังมี ${state.missingFields.length} ช่องที่ตอบผ่าน LINE ได้; ส่งไฟล์หลักฐานเข้ามาในแชทนี้หรือแนบในเว็บก็ได้ ส่วนการลงนาม/อนุมัติทำในเว็บ`);
  if (webPath) lines.push(`เปิดในเว็บ: ${webPath}`);
  return lines.join('\n');
}

function formatResult(input: {
  status: LineSubstituteReceiptContinuationResult['status'];
  expense: ExpenseRecordWithRelations;
  state: LineSubstituteReceiptContinuation;
  acceptedFields: string[];
  blockers: LineSubstituteReceiptBlocker[];
  webPath?: string;
  policy?: { configured: boolean; ready: boolean; approvalMode: 'OWNER_SELF' | 'DESIGNATED_APPROVERS' };
  sideAnswer?: string;
}): string {
  const lines = [
    '📄 ใบรับรองแทนใบเสร็จรับเงิน',
    `รายการ: ${input.expense.expenseNumber ?? input.expense.id}`,
    `ยอดปัจจุบัน: ${bahtAmount(input.expense)}`,
  ];
  if (input.acceptedFields.length) lines.push(`✅ รับข้อมูลเข้าร่างแล้ว (ยังไม่แก้รายการ): ${input.acceptedFields.map((field) => VALUE_LABELS[field] ?? field).join(', ')}`);
  if (input.sideAnswer) lines.push('', input.sideAnswer);
  if (input.status === 'PAUSED') return [...lines, '⏸️ พักงานนี้ไว้แล้ว ข้อมูลที่รับไว้ยังอยู่', 'พิมพ์ “ทำใบรับรองต่อ” เพื่อกลับมาทำต่อ'].join('\n');
  if (input.status === 'CANCELLED') return [...lines, '🛑 ยกเลิกเฉพาะขั้นตอนสนทนานี้แล้ว รายการค่าใช้จ่ายและไฟล์หลักฐานไม่ได้ถูกลบ'].join('\n');
  if (input.status === 'STALE') return [...lines, '⚠️ รายการถูกแก้ไขจากเว็บหรือผู้ใช้อื่น จึงไม่ได้นำข้อความล่าสุดไปทับข้อมูล', `ตรวจสอบสถานะปัจจุบันในเว็บ: ${input.webPath}`].join('\n');
  if (input.blockers.length) {
    lines.push('', 'สิ่งที่ยังต้องทำทั้งหมด:');
    input.blockers.forEach((item) => lines.push(`• ${item.message}`));
  } else {
    lines.push('', '✅ ข้อมูลครบแล้ว พร้อมออกเอกสาร');
  }
  if (input.policy) {
    const source = input.policy.configured ? 'ตั้งค่าเฉพาะบริษัทแล้ว' : 'ใช้ค่าเริ่มต้นของระบบ';
    lines.push(`นโยบายอนุมัติ: ${input.policy.approvalMode} · ${source} · ${input.policy.ready ? 'พร้อม' : 'ยังไม่พร้อม'}`);
  }
  lines.push('', 'LINE ยังไม่ได้เตรียม ลงนาม อนุมัติ หรือออกเอกสาร');
  lines.push('เอกสารภายในนี้ไม่ใช่ใบกำกับภาษีและไม่ทำให้ VAT ซื้อเครดิตได้');
  if (input.webPath) lines.push(`เปิดตรวจสอบในเว็บ: ${input.webPath}`);
  const next = input.blockers.find((item) => item.collectableInLine && QUESTIONS[item.code]);
  if (next) lines.push('', `ทำต่อ: ${QUESTIONS[next.code]}`);
  // R13: nothing is missing, so the single next question is whether to issue — and it is a question,
  // never an action already taken.
  else if (input.state.pendingDecision === 'ISSUE_CONFIRM') {
    lines.push('', `ทำต่อ: ${ISSUE_DECISION_QUESTION}`, ...ISSUE_DECISION_CHOICES.map((choice, index) => `${index + 1}) ${choice}`));
  }
  if (input.sideAnswer && input.state.status === 'OPEN') {
    lines.push(`กลับมาทำรายการ ${input.expense.expenseNumber ?? input.expense.id} ต่อได้เลย งานเดิมยังอยู่และยังขาด ${input.state.missingFields.length} ช่องที่ตอบผ่าน LINE ได้`);
  }
  return lines.join('\n');
}

/** Journey A step 8's button wording. It sits on the URL's own line so the card renderer lifts it
 *  into the button label instead of numbering it `เปิดลิงก์ 1` and stranding the colon in the body. */
const DOWNLOAD_LABEL = { ISSUED_PDF: 'ดาวน์โหลดเอกสาร', UNSIGNED_FORM_PDF: 'ดาวน์โหลดแบบฟอร์ม' } as const;

function deliveryLinkLine(kind: DocumentDeliveryLinkKind, url: string): string {
  return `${DOWNLOAD_LABEL[kind]} (ลิงก์หมดอายุใน 3 วัน): ${url}`;
}

/** §12.7's expiry line, in the sender's own calendar. */
function deliveryExpiryLine(expiresAt: Date): string {
  const shown = expiresAt.toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
  });
  return `ลิงก์นี้เปิดได้ถึง ${shown} แล้วจะหมดอายุ ขอใหม่ได้ตลอด`;
}

/** §12.8/PDPA — the document carries a payee name and an amount, so a link is never posted where
 *  people who are not its recipient can read it. A group chat gets the status and the instruction. */
const GROUP_CHAT_NO_LINK = 'ลิงก์ดาวน์โหลดเป็นข้อมูลส่วนบุคคล จึงไม่ส่งในแชทกลุ่มค่ะ ทักแชทส่วนตัวกับน้องมั่งมีแล้วพิมพ์ “ขอลิงก์ใหม่” เพื่อรับลิงก์';

/** Every mint copies a whole PDF to a new opaque key, so a reader who simply asks about the same
 *  document again must not create another one. §12.7's "ขอใหม่ได้ตลอด" is a deliberate act. */
const LINK_ALREADY_SENT = 'ส่งลิงก์ดาวน์โหลดให้แล้วก่อนหน้านี้ และยังเปิดได้อยู่ค่ะ ถ้าลิงก์หมดอายุหรือเปิดไม่ได้ พิมพ์ “ขอลิงก์ใหม่” ได้เลย';

@Injectable()
export class LineSubstituteReceiptContinuationUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly prepare: PrepareSubstituteReceiptUseCase,
    private readonly audit: AuditService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly deliveryLink: CreateDocumentDeliveryLinkUseCase,
  ) {}

  /**
   * §12 — a delivery link, or the reason there is none. Never throws into a reply path: a chat that
   * cannot be handed a link still gets its status, and the web page remains the way to the document.
   */
  private async deliver(
    ctx: RequestContext,
    input: { groupChat?: boolean | undefined },
    expenseId: string,
    evidenceId: string,
    kind: DocumentDeliveryLinkKind,
    /** False on an incidental turn: mint only when this recipient has no live link for this
     *  document. True when the sender asked in so many words — §12.7 lets a second token exist. */
    explicitRequest = true,
  ): Promise<{ url: string; expiryLine: string } | { refusal: string } | undefined> {
    if (input.groupChat) return { refusal: GROUP_CHAT_NO_LINK };
    try {
      if (!explicitRequest && await this.deliveryLink.hasLiveLink(ctx, evidenceId, kind)) {
        return { refusal: LINK_ALREADY_SENT };
      }
      const link = await this.deliveryLink.execute(ctx, { expenseId, evidenceId, kind });
      return { url: link.url, expiryLine: deliveryExpiryLine(link.expiresAt) };
    } catch {
      return undefined;
    }
  }

  /** R14/§11: the open substitute work an arriving photo could belong to. `undefined` means this
   *  chat has none, and the media turn must behave exactly as it did before this existed. */
  async loadOpenMediaContext(ctx: RequestContext, chatKeyHash: string): Promise<LineSubstituteMediaContext | undefined> {
    if (!ctx.permissions.includes('expense.review')) return undefined;
    const rows = await this.repo.listLineSubstituteContinuationRows({
      companyId: ctx.companyId, userId: ctx.userId, chatKeyHash, scopes: ctx.scopes ?? {}, take: 5,
    });
    const states = rows.map((row) => stateFromMetadata(row.sourceChannelMetadataJson))
      .filter((state): state is LineSubstituteReceiptContinuation => !!state);
    if (!states.length) return undefined;
    // The state that asked for a form is CONSUMED by the prepare, so every status is read here —
    // what still decides is the evidence: PREPARED, no scan yet, still on the digital default.
    // §15 needs ALL of them, not just the newest: “ไม่ใช่ ใบอื่น” has to list the others.
    const awaitingScans: LineSubstituteMediaScan[] = [];
    for (const state of states.filter((item) => item.formRequested)) {
      const expense = await this.repo.findByIdWithRelations(ctx.companyId, state.expenseId, undefined, ctx.scopes ?? {});
      const evidence = expense?.substituteReceiptEvidence;
      if (!expense || !evidence || evidence.status !== 'PREPARED'
        || evidence.signatureMode !== 'DIGITAL' || evidence.wetSignedScanAttachmentId) continue;
      awaitingScans.push({
        expenseId: expense.id,
        evidenceId: evidence.id,
        documentNumber: evidence.documentNumber,
        amountLabel: bahtAmount(expense),
        preparedAt: evidence.preparedAt,
      });
    }
    awaitingScans.sort((left, right) => right.preparedAt.localeCompare(left.preparedAt));
    const expenseId = states.find((state) => ACTIVE_STATUSES.has(state.status))?.expenseId ?? awaitingScans[0]?.expenseId;
    if (!expenseId) return undefined;
    // A3: the flag records that the ask happened; the live lookup decides whether it is still true.
    // Reading both means no write is needed to clear it — and no write is what keeps
    // `expectedExpenseUpdatedAt` valid for the prepare that follows the very next answer.
    // F8: and only for someone who may actually submit one — offering the choice to anyone else
    // ends in a refusal reply after they have already picked it. The permission can also be lost
    // between the ask and the photo, so it is re-read here rather than trusted from the flag.
    const asked = maySubmitSignature(ctx.permissions)
      && states.some((state) => ACTIVE_STATUSES.has(state.status) && state.signatureRequested === true);
    const signatureRequested = asked && !await this.repo.findReusableSignatureAsset(ctx.companyId, ctx.userId);
    return { expenseId, awaitingScans, signatureRequested };
  }

  /** F8: is a substitute workflow in this chat parked at the issue decision? A signature photo filed
   *  on ANY route (router ticket, caption, numbered answer) should steer the sender back to “ตอบ 1”
   *  exactly when this is true — and never otherwise, so the steer is computed from the live decision
   *  rather than hard-coded per route. */
  async hasPendingIssueDecision(ctx: RequestContext, chatKeyHash: string): Promise<boolean> {
    if (!ctx.permissions.includes('expense.review')) return false;
    const rows = await this.repo.listLineSubstituteContinuationRows({
      companyId: ctx.companyId, userId: ctx.userId, chatKeyHash, scopes: ctx.scopes ?? {}, take: 5,
    });
    return rows.some((row) => {
      const state = stateFromMetadata(row.sourceChannelMetadataJson);
      return !!state && ACTIVE_STATUSES.has(state.status) && state.pendingDecision === 'ISSUE_CONFIRM';
    });
  }

  /** §11/§14: a file the sender offered as evidence for the open work, attached under the purpose
   *  their caption or their numbered answer chose. Never called on a guess. */
  async attachMedia(ctx: RequestContext, input: {
    expenseId: string;
    attachmentId: string;
    purpose: 'expense.payment.evidence' | 'expense.receipt.supporting';
    webBaseUrl?: string;
  }): Promise<{ replyText: string; badge?: string }> {
    if (!ctx.permissions.includes('expense.receipt.upload')) {
      throw new ForbiddenException('Missing permission: expense.receipt.upload');
    }
    await this.repo.linkAttachment(input.expenseId, input.attachmentId, input.purpose, ctx.companyId, ctx.userId);
    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'attachment.upload',
      targetType: 'expense_record', targetId: input.expenseId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { source: 'LINE', purpose: input.purpose, attachmentId: input.attachmentId },
    });
    const payment = input.purpose === 'expense.payment.evidence';
    return {
      replyText: formatStandalone({
        headline: payment
          ? '📎 แนบเป็นหลักฐานการจ่ายเงินของรายการนี้แล้วค่ะ'
          : '📎 แนบเป็นหลักฐานประกอบของรายการนี้แล้วค่ะ',
        boundary: 'LINE ยังไม่ได้ลงนาม อนุมัติ หรือออกเอกสาร',
        question: 'พิมพ์ “ทำใบรับรองต่อ” เพื่อดูสถานะงานล่าสุดได้เลยค่ะ',
        webPath: absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/${input.expenseId}`),
      }),
    };
  }

  /** R10 + D9: the sender confirmed this photo is the signed form, so it becomes the wet-signed
   *  original and the evidence switches to the paper route. Linking issues nothing (§16): the two
   *  web acknowledgements still have to happen. */
  async linkWetSignedScan(ctx: RequestContext, input: {
    expenseId: string;
    evidenceId: string;
    attachmentId: string;
    checksumSha256: string;
    webBaseUrl?: string;
  }): Promise<{ replyText: string; badge?: string }> {
    if (!ctx.permissions.includes('expense.review')) {
      throw new ForbiddenException('Missing permission: expense.review');
    }
    // R11: an artifact that cannot be composed must be refused HERE. Linked, it certifies and
    // issues without complaint, and then every download of the finished document fails forever.
    const attachment = await this.repo.findActiveAttachmentObject(ctx.companyId, input.attachmentId);
    if (!attachment) throw new ConflictException({ code: SCAN_NOT_LINKABLE, message: 'The scanned form attachment is not ACTIVE.' });
    const object = await this.storage.getObject({
      bucket: attachment.bucket,
      objectKey: attachment.objectKey,
      ...(attachment.objectVersionId ? { objectVersionId: attachment.objectVersionId } : {}),
    });
    const rejection = await substituteWetSignedScanRejection({ bytes: object.bytes, mimeType: attachment.mimeType });
    if (rejection) throw new ConflictException({ code: SCAN_NOT_LINKABLE, message: rejection });
    const linked = await this.repo.linkSubstituteWetSignedScan({
      companyId: ctx.companyId,
      expenseId: input.expenseId,
      evidenceId: input.evidenceId,
      attachmentId: input.attachmentId,
      checksumSha256: input.checksumSha256,
      actorUserId: ctx.userId,
    });
    if (linked.linked) {
      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.substitute_receipt.wet_signed_scan.link',
        targetType: 'expense_substitute_receipt', targetId: input.evidenceId, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: {
          source: 'LINE', expenseId: input.expenseId, attachmentId: input.attachmentId,
          checksumSha256: input.checksumSha256, signatureMode: 'PAPER',
        },
      });
    }
    const webPath = absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/substitute-receipts/${input.evidenceId}`);
    return {
      badge: SUBSTITUTE_BADGES.awaitingConfirmation,
      replyText: formatStandalone({
        headline: [
          `🔵 รอยืนยัน — รับฟอร์มที่เซ็นแล้วของเลขที่ ${linked.documentNumber} ไว้เป็นต้นฉบับลายเซ็นสดแล้วค่ะ`,
          'รูปนี้ยังไม่ทำให้เอกสารออก ต้องรับรองและอนุมัติในเว็บอีก 2 ขั้นตอน',
        ].join('\n'),
        boundary: 'LINE ยังไม่ได้ลงนาม อนุมัติ หรือออกเอกสาร',
        question: 'เปิดลิงก์ด้านบนเพื่อรับรองและอนุมัติในเว็บได้เลยค่ะ',
        webPath,
      }),
    };
  }

  async loadForWeb(ctx: RequestContext, expenseId: string, workflowId: string): Promise<LineSubstituteReceiptPrefill> {
    if (ctx.authProvider === 'line') throw new ForbiddenException('Open this continuation in the authenticated web app.');
    if (!ctx.permissions.includes('expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId, undefined, ctx.scopes ?? {});
    if (!expense) throw new NotFoundException('Substitute-receipt continuation not found.');
    const state = stateFromMetadata(expense.sourceChannelMetadataJson);
    if (!state || state.workflowId !== workflowId || state.expenseId !== expense.id
      || state.companyId !== ctx.companyId || state.userId !== ctx.userId
      || !ACTIVE_STATUSES.has(state.status)) {
      throw new NotFoundException('Substitute-receipt continuation not found.');
    }
    if (state.targetRevision !== expense.updatedAt.toISOString()) {
      throw new ConflictException({ code: 'LINE_SUBSTITUTE_CONTINUATION_STALE', message: 'Expense changed. Reload the current expense before continuing.' });
    }
    return {
      workflowId: state.workflowId,
      expenseId: state.expenseId,
      targetRevision: state.targetRevision,
      status: state.status as 'OPEN' | 'PAUSED',
      acceptedValues: state.acceptedValues,
    };
  }

  async execute(ctx: RequestContext, input: {
    messageText: string;
    chatKeyHash: string;
    recentCandidates: Array<{ id: string; label: string }>;
    webBaseUrl?: string;
    /** §12.8: this turn is happening in a group or room, so no delivery link may be emitted. */
    groupChat?: boolean;
  }): Promise<LineSubstituteReceiptContinuationResult> {
    // R3: the permission a link needs is checked before any target is discovered, so no link is offered.
    if (!ctx.permissions.includes('expense.review')) {
      return {
        handled: true, status: 'FORBIDDEN', acceptedFields: [],
        badge: substituteReceiptBadge({ status: 'FORBIDDEN' }),
        blockers: [blocker('expense_review_forbidden', 'ไม่มีสิทธิ์ตรวจทานเพื่อจัดทำใบรับรองแทนใบเสร็จรับเงิน')],
        replyText: formatStandalone({
          headline: 'จัดทำใบรับรองแทนใบเสร็จรับเงินต้องมีสิทธิ์ตรวจทานค่าใช้จ่าย (expense.review) ซึ่งบัญชีนี้ยังไม่มีค่ะ',
          question: 'ขอสิทธิ์ตรวจทานค่าใช้จ่ายจากผู้ดูแลบริษัทก่อนได้ไหมคะ?',
        }),
      };
    }
    const rows = await this.repo.listLineSubstituteContinuationRows({
      companyId: ctx.companyId, userId: ctx.userId, chatKeyHash: input.chatKeyHash, scopes: ctx.scopes ?? {}, take: 5,
    });
    // §12.7: “ขอลิงก์ใหม่” is answered from the documents this chat already issued — the state that
    // produced the document was CONSUMED by its own prepare, and the expense may since have been
    // confirmed, so the reissue runs its own wider lookup. When this chat has issued nothing, the
    // phrase means nothing and the ordinary flow continues.
    if (isDeliveryLinkRequestText(input.messageText)) {
      const reissued = await this.reissueDeliveryLink(ctx, input);
      if (reissued) return reissued;
    }
    const states = rows
      .map((row) => ({ row, state: stateFromMetadata(row.sourceChannelMetadataJson) }))
      .filter((item): item is { row: typeof rows[number]; state: LineSubstituteReceiptContinuation } =>
        !!item.state && ACTIVE_STATUSES.has(item.state.status));
    const selection = ordinalSelection(input.messageText, Math.max(states.length, input.recentCandidates.length));
    let selected = states.length === 1 ? states[0] : selection !== null ? states[selection] : undefined;

    if (!selected && states.length > 1) {
      // The question is pending so the dispatcher keeps the clarification open and routes “1” back here.
      const question = 'ตอบหมายเลขงานที่ต้องการทำต่อค่ะ (เช่น “1”)';
      return {
        handled: true, status: 'TARGET_REQUIRED', acceptedFields: [], blockers: [], pendingQuestion: question,
        replyText: formatStandalone({
          headline: 'มีงานใบรับรองที่ยังค้างมากกว่า 1 รายการ ยังไม่ทราบว่าจะทำงานไหนต่อค่ะ',
          choices: states.map((item) => item.state.expenseId),
          question,
        }),
      };
    }

    if (!selected) {
      const candidateIndex = selection ?? (input.recentCandidates.length === 1 ? 0 : null);
      if (candidateIndex === null || !input.recentCandidates[candidateIndex]) {
        const hasChoices = input.recentCandidates.length > 0;
        const question = hasChoices
          ? 'ตอบหมายเลขรายการที่ต้องการค่ะ (เช่น “1”)'
          : 'เปิดในเว็บเพื่อเลือกรายการค่าใช้จ่ายก่อนได้ไหมคะ?';
        const categories = await this.repo.listCategories(ctx.companyId);
        return {
          handled: true,
          status: 'TARGET_REQUIRED',
          // Nothing is persisted without a target, so the values are echoed back instead of dropped.
          replyText: formatStandalone({
            echoed: extractValues(input.messageText, null, ctx.userId, categories),
            categories,
            headline: hasChoices
              ? 'ยังไม่ทราบว่าจะทำใบรับรองให้รายการค่าใช้จ่ายไหนค่ะ'
              : 'ยังไม่พบรายการค่าใช้จ่ายในแชทนี้ที่จะทำใบรับรองให้ค่ะ',
            choices: input.recentCandidates.map((item) => item.label),
            question,
            webPath: absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/substitute-receipts/new`),
          }),
          // Only a numbered choice stays pending; with no candidate the web link is the exit, so the
          // next unrelated message must not be captured as an answer.
          ...(hasChoices ? { pendingQuestion: question } : {}),
          acceptedFields: [], blockers: [],
        };
      }
      const expenseId = input.recentCandidates[candidateIndex].id;
      const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId, undefined, ctx.scopes ?? {});
      if (!expense) return targetOutOfScope(ctx.companyId, input.webBaseUrl, 'รายการที่เลือกไม่อยู่ในสิทธิ์หรือสาขาปัจจุบันของคุณค่ะ');
      // A prepared expense has a document number, a status and a page of its own; minting a fresh
      // OPEN state over it would wipe the provenance the consumed continuation still holds and ask
      // three questions that are already answered. Report the document instead, and write nothing.
      const live = expense.substituteReceiptEvidence;
      if (live && live.status !== 'SUPERSEDED') return this.existingEvidenceCard(ctx, input, expense, live);
      const now = new Date().toISOString();
      selected = {
        row: { id: expense.id, updatedAt: expense.updatedAt, sourceChannelMetadataJson: expense.sourceChannelMetadataJson },
        state: {
          workflowId: randomUUID(), kind: 'SUBSTITUTE_RECEIPT', companyId: ctx.companyId, userId: ctx.userId,
          expenseId: expense.id, chatKeyHash: input.chatKeyHash, status: 'OPEN', acceptedValues: {}, provenance: {},
          resolvedFields: [], missingFields: [], attachmentRefs: [], pendingQuestion: null,
          targetRevision: expense.updatedAt.toISOString(), lastActivityAt: now,
        },
      };
    }

    const expense = await this.repo.findByIdWithRelations(ctx.companyId, selected.state.expenseId, undefined, ctx.scopes ?? {});
    if (!expense) return targetOutOfScope(ctx.companyId, input.webBaseUrl, 'รายการของงานนี้ไม่อยู่ในสิทธิ์หรือสาขาปัจจุบันของคุณแล้วค่ะ');
    const webPath = workflowLink(input.webBaseUrl, ctx.companyId, expense.id, selected.state.workflowId);
    const lowered = normalizedText(input.messageText).toLocaleLowerCase('th-TH');
    // R15's question offers “ไม่ทำต่อ” as the way out, so the plain refusals join the pause set. They
    // stay whole-message anchored, which is what keeps “ไม่มี” (the evidence answer) and “ไม่มีใบเสร็จ”
    // (a reason code) out of it.
    const pause = SUBSTITUTE_PAUSE.test(lowered);
    const cancel = SUBSTITUTE_CANCEL.test(lowered);
    if (pause || cancel) {
      // Clear the decision (as DECLINE/EDIT do): otherwise a paused “ready” workflow keeps
      // pendingDecision, the taught resume phrase falls into answerIssueDecision's non-answer branch,
      // and a later “1” prepares straight out of a PAUSED workflow. Resuming re-derives it cleanly.
      const nextState = {
        ...selected.state,
        status: pause ? 'PAUSED' as const : 'CANCELLED' as const,
        pendingDecision: undefined, pendingQuestion: null,
      };
      const saved = await this.repo.saveLineSubstituteContinuation({
        companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
        expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {}, continuation: nextState as unknown as Record<string, unknown>,
      });
      const state = saved.continuation as unknown as LineSubstituteReceiptContinuation;
      const status = pause ? 'PAUSED' as const : 'CANCELLED' as const;
      return { handled: true, status, expenseId: expense.id, workflowId: state.workflowId, acceptedFields: [], blockers: [], webPath,
        replyText: formatResult({ status, expense, state, acceptedFields: [], blockers: [], webPath }) };
    }
    if (selected.state.targetRevision !== expense.updatedAt.toISOString()) {
      return {
        handled: true, status: 'STALE', expenseId: expense.id, workflowId: selected.state.workflowId,
        replyText: formatResult({ status: 'STALE', expense, state: selected.state, acceptedFields: [], blockers: [], webPath }),
        acceptedFields: [], blockers: [], webPath,
      };
    }

    // R15 (D6) short-circuits the whole turn: the sender may be describing a situation that calls
    // for a different document, so nothing is merged, nothing is decided, nothing is prepared, and
    // the stored state is left exactly as it was. The reply is the explanation and its one question;
    // “ทำต่อ” resumes with whatever was already pending, “ไม่ทำต่อ” pauses through the branch above.
    // It never reaches FORBIDDEN, PAUSED, CANCELLED or STALE turns — those all returned already.
    const wrongDocument = payeeCouldSignHeadline(input.messageText);
    if (wrongDocument) {
      return {
        handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: selected.state.workflowId,
        acceptedFields: [], blockers: [], webPath, pendingQuestion: PAYEE_COULD_SIGN_QUESTION,
        resumeCapsule: resumeCapsule(expense, selected.state, [], webPath),
        replyText: formatStandalone({ headline: wrongDocument, question: PAYEE_COULD_SIGN_QUESTION, webPath }),
      };
    }

    const categories = await this.repo.listCategories(ctx.companyId);
    // R13: the assistant asked whether to issue, so this turn is that answer. It runs before value
    // extraction, otherwise a bare “1” would be read as a stray value instead of a choice.
    if (selected.state.pendingDecision === 'ISSUE_CONFIRM') {
      const decided = await this.answerIssueDecision(ctx, input, expense, selected.state, categories);
      if (decided) return decided;
    }
    const pendingField = selected.state.missingFields[0] ?? null;
    const acceptedNow = extractValues(input.messageText, pendingField, ctx.userId, categories);
    const sideAnswer = groundedSideAnswer(expense, input.messageText);
    const acceptedValues = { ...selected.state.acceptedValues, ...acceptedNow };
    const acceptedAt = new Date().toISOString();
    const provenance = { ...selected.state.provenance };
    for (const field of Object.keys(acceptedNow)) provenance[field] = { source: 'LINE_USER_TEXT', acceptedAt, messageHash: messageHash(input.messageText) };
    const [policyRow, eligibleApprovers, payer] = await Promise.all([
      this.repo.getSubstituteReceiptPolicy(ctx.companyId),
      this.repo.listEligibleSubstituteReceiptApprovers(ctx.companyId, expense.branchId),
      acceptedValues.payerUserId
        ? this.repo.findActiveMemberIdentity(ctx.companyId, acceptedValues.payerUserId, expense.branchId)
        : Promise.resolve(null),
    ]);
    const policy = {
      configured: Boolean(policyRow),
      approvalMode: policyRow?.approvalMode ?? 'OWNER_SELF' as const,
      approverUserIds: policyRow?.approverUserIds ?? [],
      cashEvidencePolicy: policyRow?.cashEvidencePolicy ?? 'ALLOW_SUPPORTING_EVIDENCE_ONLY',
    };
    const policyReady = policy.approvalMode === 'DESIGNATED_APPROVERS'
      ? policy.approverUserIds.some((id) => eligibleApprovers.some((item) => item.userId === id) && id !== acceptedValues.payerUserId)
      : eligibleApprovers.length > 0;
    const policyFacts = { configured: policy.configured, ready: policyReady, approvalMode: policy.approvalMode };
    const blockers = preflight(ctx, expense, acceptedValues, policy, new Set(eligibleApprovers.map((item) => item.userId)), Boolean(payer));
    const missingFields = blockers
      .filter((item) => item.collectableInLine)
      .map((item) => FIELD_BY_BLOCKER[item.code])
      .filter((field): field is keyof LineSubstituteReceiptValues => Boolean(field));
    const pending = blockers.find((item) => item.collectableInLine && QUESTIONS[item.code]);
    const nextState: LineSubstituteReceiptContinuation = {
      ...selected.state,
      status: 'OPEN',
      acceptedValues,
      provenance,
      resolvedFields: Object.keys(acceptedValues).sort(),
      missingFields,
      attachmentRefs: expense.attachments.filter((item) => item.status === 'ACTIVE').map((item) => item.id).slice(0, 20),
      pendingQuestion: pending ? QUESTIONS[pending.code] : blockers.length ? null : ISSUE_DECISION_QUESTION,
      // Set only while the preflight is clean: a value the user changes later reopens a blocker and
      // takes the decision back off the table until everything is answered again.
      pendingDecision: blockers.length ? undefined : 'ISSUE_CONFIRM',
      targetRevision: expense.updatedAt.toISOString(),
      lastActivityAt: acceptedAt,
    };
    const saved = await this.repo.saveLineSubstituteContinuation({
      companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
      expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {}, continuation: nextState as unknown as Record<string, unknown>,
    });
    const state = saved.continuation as unknown as LineSubstituteReceiptContinuation;
    const ineligible = blockers.some((item) => ['expense_status_ineligible', 'source_type_ineligible', 'valid_receipt_normal_path', 'classification_ineligible', 'document_kind_ineligible', 'currency_not_supported', 'active_substitute_evidence_exists'].includes(item.code));
    const forbidden = blockers.some((item) => item.code === 'expense_review_forbidden');
    const status = forbidden ? 'FORBIDDEN' as const : ineligible ? 'INELIGIBLE' as const : blockers.length ? 'BLOCKED' as const : 'READY_FOR_WEB' as const;
    const targetPath = forbidden
      ? undefined
      : ineligible
        ? absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/${expense.id}`)
        : workflowLink(input.webBaseUrl, ctx.companyId, expense.id, state.workflowId);
    const badge = substituteReceiptBadge({ status, blockers });
    return {
      handled: true, status, workflowId: state.workflowId, expenseId: expense.id,
      acceptedFields: Object.keys(acceptedNow), blockers, webPath: targetPath,
      ...(badge ? { badge } : {}),
      policy: policyFacts,
      sideQuestionAnswered: Boolean(sideAnswer),
      resumeCapsule: resumeCapsule(expense, state, Object.keys(acceptedNow), targetPath),
      ...(state.pendingQuestion ? { pendingQuestion: state.pendingQuestion } : {}),
      replyText: formatResult({ status, expense, state, acceptedFields: Object.keys(acceptedNow), blockers, webPath: targetPath, policy: policyFacts, sideAnswer }),
    };
  }

  /**
   * The evidence already exists, so the conversation reports it instead of starting over. Nothing is
   * written to the continuation: the consumed state keeps the provenance of every value it collected.
   *
   * This is also where an ISSUED document is DELIVERED. There is a `sendPush` primitive, but nothing
   * durable holds the raw chat id to push to — the continuation stores only a one-way `chatKeyHash`
   * — so the ✅ card rides the sender's next turn here (and “ขอลิงก์ใหม่” makes that turn happen on
   * demand) rather than inventing a chat-address store on the approve path.
   */
  private async existingEvidenceCard(
    ctx: RequestContext,
    input: { webBaseUrl?: string; groupChat?: boolean },
    expense: ExpenseRecordWithRelations,
    evidence: { id: string; documentNumber: string; status: string; signatureMode: 'DIGITAL' | 'PAPER'; wetSignedScanAttachmentId: string | null },
    /** §12.7: the sender typed “ขอลิงก์ใหม่”, so a fresh token is minted even beside a live one.
     *  On an ordinary turn only the FIRST card mints — otherwise repeating the substitute vocabulary
     *  would copy the whole PDF to a new key every time. */
    explicitRequest = false,
  ): Promise<LineSubstituteReceiptContinuationResult> {
    const webPath = absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/substitute-receipts/${evidence.id}`);
    const issued = evidence.status === 'ISSUED';
    // R10/§16: a PREPARED paper-route form with no signed scan yet is waiting for INK, not a web
    // click. Reporting it as “🔵 รอยืนยัน · sign in web” sends a paper user to sign digitally (D9);
    // it must lead with the form link and the paper wording even on a plain resume turn.
    const awaitingPaperSignature = evidence.status === 'PREPARED'
      && evidence.signatureMode === 'PAPER' && !evidence.wetSignedScanAttachmentId;
    // Journey A gets exactly one link with its ISSUED card: nothing is live yet, so the first card
    // mints. Journey B's sheet is delivered by the prepare, so PREPARED only re-mints when asked —
    // or, for the paper route still waiting for ink, on any resume so the sender can reach the form.
    const kind: DocumentDeliveryLinkKind | undefined = issued ? 'ISSUED_PDF'
      : evidence.status === 'PREPARED' && (explicitRequest || awaitingPaperSignature) ? 'UNSIGNED_FORM_PDF'
      : undefined;
    const delivery = kind
      ? await this.deliver(ctx, input, expense.id, evidence.id, kind, explicitRequest)
      : undefined;
    const badge = substituteReceiptBadge({ status: 'READY_FOR_WEB', evidenceStatus: evidence.status, awaitingPaperSignature });
    const amount = bahtAmount(expense);
    const headline = [
      `${issued ? '✅ ออกเอกสารแล้ว' : awaitingPaperSignature ? '🖊️ รอลงนาม' : '🔵 รอยืนยัน'} — เลขที่ ${evidence.documentNumber}`,
      `รายการ ${expense.expenseNumber ?? expense.id} · ยอด ${amount}`,
      issued
        ? 'เอกสารออกเรียบร้อยแล้ว'
        : awaitingPaperSignature
          ? 'แบบฟอร์มรอลงนามมีลายน้ำ UNSIGNED — พิมพ์แล้วเซ็นด้วยมือ แล้วถ่ายส่งกลับมาในแชทนี้'
          : 'เตรียมและจองเลขที่ไว้แล้ว เหลือลงนามรับรองและอนุมัติในเว็บ',
    ];
    if (delivery && 'url' in delivery) {
      headline.push(deliveryLinkLine(kind!, delivery.url), delivery.expiryLine);
    } else if (delivery) headline.push(delivery.refusal);
    else if (issued) headline.push('ยังสร้างลิงก์ดาวน์โหลดให้ไม่ได้ตอนนี้ เปิดดาวน์โหลดในเว็บได้ค่ะ');
    return {
      handled: true, status: 'READY_FOR_WEB', expenseId: expense.id, acceptedFields: [], blockers: [], webPath,
      ...(badge ? { badge } : {}),
      replyText: formatStandalone({
        headline: headline.join('\n'),
        boundary: 'LINE ยังไม่ได้ลงนาม อนุมัติ หรือออกเอกสาร',
        question: issued
          ? 'กดลิงก์ดาวน์โหลดด้านบนได้เลยค่ะ ถ้าลิงก์หมดอายุ พิมพ์ “ขอลิงก์ใหม่” ได้ตลอด'
          : awaitingPaperSignature
            ? (delivery && 'url' in delivery
              ? 'กดลิงก์ดาวน์โหลดแบบฟอร์มด้านบน พิมพ์แล้วเซ็นด้วยมือ แล้วถ่ายส่งกลับมาได้เลยค่ะ'
              : 'พิมพ์ “ขอลิงก์ใหม่” เพื่อรับลิงก์แบบฟอร์ม พิมพ์แล้วเซ็นด้วยมือ แล้วถ่ายส่งกลับมาได้เลยค่ะ')
          : delivery && 'url' in delivery
            ? 'กดลิงก์ดาวน์โหลดแบบฟอร์มด้านบน พิมพ์แล้วเซ็นด้วยมือได้เลยค่ะ'
            : 'เปิดลิงก์ด้านบนเพื่อลงนามรับรองและอนุมัติในเว็บได้เลยค่ะ',
        webPath,
      }),
    };
  }

  /** §12.7 — “ขอลิงก์ใหม่” finds the newest document this chat produced and mints a fresh link for
   *  it: the issued certificate, or the unsigned sheet while Journey B is still waiting for ink.
   *  `undefined` means this chat has neither, and the turn continues as normal.
   *
   *  F7: keyed off the DOCUMENT, not the correction-candidate window. Issuing does not move the
   *  expense, but a later web confirm moves it to CONFIRMED, at which point the shared narrow-status
   *  query would drop the row and this would fall through to “ยังไม่พบรายการ”. The reissue therefore
   *  runs its own wider-status lookup; the shared correction-candidate query is left untouched. */
  private async reissueDeliveryLink(
    ctx: RequestContext,
    input: { webBaseUrl?: string; groupChat?: boolean; chatKeyHash: string },
  ): Promise<LineSubstituteReceiptContinuationResult | undefined> {
    const rows = await this.repo.listLineSubstituteContinuationRows({
      companyId: ctx.companyId, userId: ctx.userId, chatKeyHash: input.chatKeyHash,
      scopes: ctx.scopes ?? {}, take: 5, statuses: REISSUE_EXPENSE_STATUSES,
    });
    for (const row of rows) {
      const state = stateFromMetadata(row.sourceChannelMetadataJson);
      if (!state) continue;
      const expense = await this.repo.findByIdWithRelations(ctx.companyId, state.expenseId, undefined, ctx.scopes ?? {});
      const evidence = expense?.substituteReceiptEvidence;
      if (!expense || (evidence?.status !== 'ISSUED' && evidence?.status !== 'PREPARED')) continue;
      return this.existingEvidenceCard(ctx, input, expense, evidence, true);
    }
    return undefined;
  }

  /** R13 answer handling. `undefined` means "not an answer to this question, but it does carry
   *  values" — the normal collect-and-re-ask path owns those, so a correction is never lost. */
  private async answerIssueDecision(
    ctx: RequestContext,
    input: { messageText: string; webBaseUrl?: string; groupChat?: boolean },
    expense: ExpenseRecordWithRelations,
    state: LineSubstituteReceiptContinuation,
    categories: Array<{ id: string; name: string }>,
  ): Promise<LineSubstituteReceiptContinuationResult | undefined> {
    const choice = issueDecisionChoice(input.messageText);
    const webPath = workflowLink(input.webBaseUrl, ctx.companyId, expense.id, state.workflowId);
    if (!choice) {
      // §15: a question asked while the decision is open is still answered from source state, and the
      // capsule reminds the sender what is waiting — otherwise the dispatcher deflects to a general
      // AI turn and this work drops out of the conversation.
      const sideAnswer = groundedSideAnswer(expense, input.messageText);
      if (Object.keys(extractValues(input.messageText, null, ctx.userId, categories)).length > 0) return undefined;
      // Re-ask the one question rather than replaying the whole status card at someone who already read it.
      return {
        handled: true, status: 'READY_FOR_WEB', expenseId: expense.id, workflowId: state.workflowId,
        acceptedFields: [], blockers: [], pendingQuestion: ISSUE_DECISION_QUESTION, webPath,
        ...(sideAnswer ? { sideQuestionAnswered: true } : {}),
        resumeCapsule: resumeCapsule(expense, state, [], webPath),
        replyText: formatStandalone({
          headline: sideAnswer
            ? `${sideAnswer}\n\nข้อมูลครบแล้ว รอเลือกว่าจะทำอะไรต่อค่ะ`
            : 'ยังไม่แน่ใจว่าจะให้ทำอะไรต่อค่ะ ตอบเป็นหมายเลข 1-3 ได้เลย',
          choices: ISSUE_DECISION_CHOICES,
          question: ISSUE_DECISION_QUESTION,
        }),
      };
    }
    if (choice === 'DECLINE') {
      // An explicit "not now" reserves nothing and loses nothing. The decision marker is cleared so
      // the next turn re-derives it from a fresh preflight instead of replaying a stale question.
      const saved = await this.repo.saveLineSubstituteContinuation({
        companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
        expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {},
        continuation: { ...state, pendingDecision: undefined, pendingQuestion: null } as unknown as Record<string, unknown>,
      });
      const next = saved.continuation as unknown as LineSubstituteReceiptContinuation;
      return {
        handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: next.workflowId,
        acceptedFields: [], blockers: [],
        webPath: workflowLink(input.webBaseUrl, ctx.companyId, expense.id, next.workflowId),
        resumeCapsule: resumeCapsule(expense, next, [], workflowLink(input.webBaseUrl, ctx.companyId, expense.id, next.workflowId)),
        replyText: formatStandalone({
          headline: 'รับทราบค่ะ ยังไม่ออกเอกสารและยังไม่ได้จองเลขที่ งานนี้ยังเปิดอยู่ ข้อมูลที่รับไว้ยังอยู่ครบ',
          question: 'บอกได้ตลอดเมื่อพร้อมให้ออกเอกสารค่ะ',
          webPath: workflowLink(input.webBaseUrl, ctx.companyId, expense.id, next.workflowId),
        }),
      };
    }
    if (choice === 'EDIT') {
      const question = 'จะแก้ช่องไหนคะ? ตอบแบบมีป้ายกำกับได้เลย เช่น “วัตถุประสงค์: ไปพบลูกค้า”';
      const saved = await this.repo.saveLineSubstituteContinuation({
        companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
        expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {},
        // The decision is off the table until the edit lands, so the next labelled answer merges as usual.
        continuation: { ...state, pendingDecision: undefined, pendingQuestion: question } as unknown as Record<string, unknown>,
      });
      const next = saved.continuation as unknown as LineSubstituteReceiptContinuation;
      return {
        handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: next.workflowId,
        acceptedFields: [], blockers: [], pendingQuestion: question,
        webPath: workflowLink(input.webBaseUrl, ctx.companyId, expense.id, next.workflowId),
        replyText: formatStandalone({
          headline: 'แก้ได้เลยค่ะ ช่องที่แก้ผ่าน LINE ได้:',
          choices: [...new Set(Object.values(FIELD_BY_BLOCKER))].map((field) => VALUE_LABELS[field] ?? field),
          question,
          webPath: workflowLink(input.webBaseUrl, ctx.companyId, expense.id, next.workflowId),
        }),
      };
    }
    if (choice === 'ISSUE') {
      // Unpinned: ACTIVE only, because this signature is about to sign something new (R9).
      const signature = await this.repo.findReusableSignatureAsset(ctx.companyId, ctx.userId);
      if (!signature) return this.askForSignature(ctx, input, expense, state);
    }
    return this.prepareFromLine(ctx, input, expense, state, choice);
  }

  /**
   * Journey A step 5, and no longer a loop: a signature saved from LINE is ACTIVE immediately
   * (owner decision 2026-08-20), so the only two states left are "you have one" — handled by the
   * caller, which never gets here — and "you have none", which asks for the photo. Nothing waits on
   * anyone, so there is no pending or rejected script to write.
   */
  private async askForSignature(
    ctx: RequestContext,
    input: { webBaseUrl?: string; groupChat?: boolean },
    expense: ExpenseRecordWithRelations,
    state: LineSubstituteReceiptContinuation,
  ): Promise<LineSubstituteReceiptContinuationResult> {
    // A3: written once, so the photo that arrives next has a numbered choice that can become a
    // signature. Best-effort by design — a stale-revision refusal here must not swallow the ask
    // itself, and `loadOpenMediaContext` re-checks the live signature anyway.
    if (state.signatureRequested !== true) {
      try {
        await this.repo.saveLineSubstituteContinuation({
          companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
          expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {},
          continuation: { ...state, signatureRequested: true } as unknown as Record<string, unknown>,
        });
      } catch {
        // Left unrecorded: the sender still gets the ask, and the caption route still works.
      }
    }
    const question = 'ส่งรูปลายเซ็นเข้ามาในแชทนี้ได้เลยค่ะ';
    const signatureBlocker = blocker('reusable_signature_required', 'ยังไม่มีลายเซ็นที่บันทึกไว้', true);
    return {
      handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: state.workflowId,
      acceptedFields: [],
      badge: substituteReceiptBadge({ status: 'BLOCKED', blockers: [signatureBlocker] }),
      blockers: [signatureBlocker],
      // The decision stays pending and nothing is written, so “1” after the photo lands here again.
      pendingQuestion: question,
      webPath: workflowLink(input.webBaseUrl, ctx.companyId, expense.id, state.workflowId),
      replyText: formatStandalone({
        headline: [
          'ยังไม่มีลายเซ็นที่บันทึกไว้ในระบบค่ะ',
          'เซ็นบนกระดาษขาว ถ่ายให้เห็นเต็มลายเซ็น แล้วส่งรูปเข้ามาในแชทนี้',
          'ระบบจะเก็บเป็นลายเซ็นประจำตัว ใช้ได้ทันทีและใช้ซ้ำได้ทุกใบ ไม่ต้องส่งอีก',
        ].join('\n'),
        question,
      }),
    };
  }

  /** R7 from the conversation: prepare with the values the preflight already cleared, then hand the
   *  work to the one web page where certification and approval happen. */
  private async prepareFromLine(
    ctx: RequestContext,
    input: { webBaseUrl?: string; groupChat?: boolean },
    expense: ExpenseRecordWithRelations,
    state: LineSubstituteReceiptContinuation,
    choice: 'ISSUE' | 'FORM',
  ): Promise<LineSubstituteReceiptContinuationResult> {
    const values = state.acceptedValues;
    const active = expense.attachments.filter((item) => item.status === 'ACTIVE');
    const paymentEvidenceAttachmentIds = active.filter((item) => item.purpose === 'expense.payment.evidence').map((item) => item.id);
    // Same split the web wizard uses. `expense.review.evidence` is the system's own output — the
    // certified/issued SVG of a superseded version and its signature renders — so linking it back in
    // would print the previous certificate as supporting evidence for its own replacement.
    const supportingAttachmentIds = active
      .filter((item) => item.purpose !== 'expense.payment.evidence' && item.purpose !== 'expense.review.evidence')
      .map((item) => item.id);
    try {
      const evidence = await this.prepare.execute(ctx, expense.id, {
        // The preflight was clean, so every required value is present; prepare re-validates anyway
        // and any gap comes back as the degraded reply below rather than an exception.
        reasonCode: values.reasonCode!,
        missingReceiptReason: values.missingReceiptReason ?? expense.missingReceiptReason ?? '',
        businessPurpose: values.businessPurpose!,
        payerUserId: values.payerUserId!,
        ...(values.payeeName ? { payeeName: values.payeeName } : {}),
        ...(values.paymentMethod ? { paymentMethod: values.paymentMethod } : {}),
        ...(values.paymentDate ? { paymentDate: values.paymentDate } : {}),
        paymentEvidenceAttachmentIds,
        supportingAttachmentIds,
        // One prepare per continuation: a repeated “1” returns the same reserved document number.
        idempotencyKey: state.workflowId,
        continuationId: state.workflowId,
        // R10: only the paper route leaves this chat waiting for a photo of a signed sheet.
        formRequested: choice === 'FORM',
        expectedExpenseUpdatedAt: state.targetRevision,
      });
      const webPath = absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/substitute-receipts/${evidence.id}`);
      const amount = bahtAmount(expense);
      // §12: Journey B must reach the printable sheet without a web session, so the FORM route leads
      // with a delivery link. The web page stays as the secondary line — it is where certification
      // and approval happen anyway.
      const delivery = choice === 'FORM'
        ? await this.deliver(ctx, input, expense.id, evidence.id, 'UNSIGNED_FORM_PDF')
        : undefined;
      const formLines = [
        `🖊️ รอลงนาม — เตรียมเอกสารและจองเลขที่ ${evidence.documentNumber} ไว้แล้ว`,
        `ยอด ${amount} · ผู้จ่าย ${evidence.payerName}`,
        'แบบฟอร์มรอลงนามมีลายน้ำ UNSIGNED และยังไม่ใช่เอกสารที่ออกแล้ว',
      ];
      if (delivery && 'url' in delivery) formLines.push(deliveryLinkLine('UNSIGNED_FORM_PDF', delivery.url), delivery.expiryLine);
      else if (delivery) formLines.push(delivery.refusal);
      const badge = substituteReceiptBadge({
        status: 'READY_FOR_WEB', evidenceStatus: evidence.status, awaitingPaperSignature: choice === 'FORM',
      });
      return {
        handled: true, status: 'READY_FOR_WEB', expenseId: expense.id, workflowId: state.workflowId,
        acceptedFields: [], blockers: [], webPath,
        ...(badge ? { badge } : {}),
        replyText: formatStandalone({
          headline: choice === 'ISSUE'
            ? [
              `🔵 รอยืนยัน — เตรียมเอกสารและจองเลขที่ ${evidence.documentNumber} ไว้แล้ว`,
              `ยอด ${amount} · ผู้จ่าย ${evidence.payerName}`,
              'ขั้นต่อไปทำในเว็บหน้าเดียว: ผู้จ่ายลงนามรับรอง แล้วผู้มีสิทธิ์อนุมัติ',
            ].join('\n')
            : formLines.join('\n'),
          boundary: 'LINE ยังไม่ได้ลงนาม อนุมัติ หรือออกเอกสาร',
          question: choice === 'ISSUE'
            ? 'เปิดลิงก์ด้านบนเพื่อลงนามรับรองและอนุมัติในเว็บได้เลยค่ะ'
            : delivery && 'url' in delivery
              ? 'กดลิงก์ดาวน์โหลดแบบฟอร์มด้านบน พิมพ์แล้วเซ็นด้วยมือได้เลยค่ะ'
              : 'เปิดลิงก์ด้านบน กดดาวน์โหลด “แบบฟอร์มรอลงนาม” พิมพ์แล้วเซ็นด้วยมือได้เลยค่ะ',
          webPath,
        }),
      };
    } catch (error) {
      // A prepare that cannot happen is a state the sender can act on, not a stack trace.
      const webPath = workflowLink(input.webBaseUrl, ctx.companyId, expense.id, state.workflowId);
      if (error instanceof ConflictException) {
        return {
          handled: true, status: 'STALE', expenseId: expense.id, workflowId: state.workflowId,
          acceptedFields: [], blockers: [], webPath,
          replyText: formatResult({ status: 'STALE', expense, state, acceptedFields: [], blockers: [], webPath }),
        };
      }
      // Generic Thai only — the raw API error is often English and never belongs in a customer chat.
      const blockers = [blocker('substitute_prepare_failed', 'ยังเตรียมเอกสารไม่ได้ในตอนนี้ค่ะ ตรวจสอบและดำเนินการต่อในเว็บได้เลย')];
      return {
        handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: state.workflowId,
        acceptedFields: [], blockers, webPath,
        // A structural failure means the same “1) ออกเอกสาร” would fail again, so the decision is
        // cleared for this reply rather than re-offered as a one-tap retry; the web page is the way on.
        replyText: formatResult({ status: 'BLOCKED', expense, state: { ...state, pendingDecision: undefined }, acceptedFields: [], blockers, webPath }),
      };
    }
  }
}
