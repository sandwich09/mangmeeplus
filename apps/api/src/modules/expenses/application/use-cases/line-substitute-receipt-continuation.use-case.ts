import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { ExpensePaymentMethod, LineSubstituteReceiptPrefill, RequestContext, SubstituteReceiptReasonCode } from '@watchdog-bms/contracts';
import { extractValueCandidates, isAmbiguousDateCandidate } from '@watchdog-bms/contracts';
import type { ExpenseRecordWithRelations } from '../../domain/models/expense.model';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { collectSubstituteReceiptEligibilityIssues, PrepareSubstituteReceiptUseCase } from './substitute-receipt.use-case';

const STATE_KEY = 'lineSubstituteReceiptContinuation';
const ACTIVE_STATUSES = new Set(['OPEN', 'PAUSED']);
const MAX_VALUE_LENGTH = 500;

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
  targetRevision: string;
  lastActivityAt: string;
};

export type LineSubstituteReceiptBlocker = { code: string; message: string; collectableInLine: boolean };

export type LineSubstituteReceiptContinuationResult = {
  handled: true;
  status: 'READY_FOR_WEB' | 'BLOCKED' | 'INELIGIBLE' | 'FORBIDDEN' | 'TARGET_REQUIRED' | 'PAUSED' | 'CANCELLED' | 'STALE';
  replyText: string;
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

export function isSubstituteReceiptConversationText(text: string): boolean {
  return SUBSTITUTE_VOCABULARY.test(text.normalize('NFC').toLocaleLowerCase('th-TH'));
}

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

  // A short unlabeled answer is accepted only for the exact source-generated pending question.
  const plain = bounded(text, 200);
  if (plain && Object.keys(values).length === 0 && !/[?？]|ไหม|หรือไม่|อย่างไร|ยังไง/u.test(plain)) {
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
    result.push(blocker('supporting_evidence_required', 'แนบสลิป/รูปถ่ายประกอบในเว็บ หรือยืนยันว่าไม่มีหลักฐาน', true));
  }
  if (((paymentMethod && paymentMethod !== 'CASH') || policy.cashEvidencePolicy === 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE')
    && payments.length === 0) {
    result.push(blocker('payment_evidence_required', 'แนบหลักฐานการชำระเงินในเว็บ (ข้อความใช้แทนไฟล์ไม่ได้)'));
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
  supporting_evidence_required: 'มีสลิปหรือรูปถ่ายประกอบไหมคะ? ถ้ามี แนบไฟล์ในเว็บ ถ้าไม่มี ตอบ “ไม่มีหลักฐาน” ได้เลย',
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

/** Nest wraps a validation message in the exception body, so `.message` alone reports
 *  “Bad Request Exception” for the object form prepare throws. */
function exceptionText(error: unknown): string {
  const body = error instanceof HttpException ? error.getResponse() : null;
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string') {
    return (body as { message: string }).message;
  }
  return error instanceof Error ? error.message : String(error);
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
  else lines.push(`ยังมี ${state.missingFields.length} ช่องที่ตอบผ่าน LINE ได้; ส่วนไฟล์/การลงนาม/อนุมัติทำในเว็บ`);
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
    `ยอดปัจจุบัน: ${input.expense.grandTotalAmount} ${input.expense.currency}`,
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

@Injectable()
export class LineSubstituteReceiptContinuationUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly prepare: PrepareSubstituteReceiptUseCase,
  ) {}

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
  }): Promise<LineSubstituteReceiptContinuationResult> {
    // R3: the permission a link needs is checked before any target is discovered, so no link is offered.
    if (!ctx.permissions.includes('expense.review')) {
      return {
        handled: true, status: 'FORBIDDEN', acceptedFields: [],
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
      if (live && live.status !== 'SUPERSEDED') return this.existingEvidenceCard(ctx, input.webBaseUrl, expense, live);
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
    const pause = /^(พัก|พักไว้ก่อน|ไว้ทำทีหลัง|ไม่ทำต่อ|ไม่ต่อ|ไม่ทำ|ไม่เอา|ไม่ต้องทำ)$/u.test(lowered);
    const cancel = /^(ยกเลิก|ยกเลิกงานนี้|ไม่ทำแล้ว)$/u.test(lowered);
    if (pause || cancel) {
      const nextState = { ...selected.state, status: pause ? 'PAUSED' as const : 'CANCELLED' as const };
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
    return {
      handled: true, status, workflowId: state.workflowId, expenseId: expense.id,
      acceptedFields: Object.keys(acceptedNow), blockers, webPath: targetPath,
      policy: policyFacts,
      sideQuestionAnswered: Boolean(sideAnswer),
      resumeCapsule: resumeCapsule(expense, state, Object.keys(acceptedNow), targetPath),
      ...(state.pendingQuestion ? { pendingQuestion: state.pendingQuestion } : {}),
      replyText: formatResult({ status, expense, state, acceptedFields: Object.keys(acceptedNow), blockers, webPath: targetPath, policy: policyFacts, sideAnswer }),
    };
  }

  /** The evidence already exists, so the conversation reports it instead of starting over. Nothing
   *  is written: the consumed continuation keeps the provenance of every value it collected. */
  private existingEvidenceCard(
    ctx: RequestContext,
    webBaseUrl: string | undefined,
    expense: ExpenseRecordWithRelations,
    evidence: { id: string; documentNumber: string; status: string },
  ): LineSubstituteReceiptContinuationResult {
    const webPath = absoluteLink(webBaseUrl, `/companies/${ctx.companyId}/expenses/substitute-receipts/${evidence.id}`);
    const issued = evidence.status === 'ISSUED';
    return {
      handled: true, status: 'READY_FOR_WEB', expenseId: expense.id, acceptedFields: [], blockers: [], webPath,
      replyText: formatStandalone({
        headline: [
          `${issued ? '✅ ออกเอกสารแล้ว' : '🔵 รอยืนยัน'} — เลขที่ ${evidence.documentNumber}`,
          `รายการ ${expense.expenseNumber ?? expense.id} · ยอด ${expense.grandTotalAmount} ${expense.currency}`,
          issued
            ? 'เอกสารออกเรียบร้อยแล้ว เปิดดูและดาวน์โหลดได้ในเว็บ'
            : 'เตรียมและจองเลขที่ไว้แล้ว เหลือลงนามรับรองและอนุมัติในเว็บ',
        ].join('\n'),
        boundary: 'LINE ยังไม่ได้ลงนาม อนุมัติ หรือออกเอกสาร',
        question: issued
          ? 'เปิดลิงก์ด้านบนเพื่อดาวน์โหลดเอกสารได้เลยค่ะ'
          : 'เปิดลิงก์ด้านบนเพื่อลงนามรับรองและอนุมัติในเว็บได้เลยค่ะ',
        webPath,
      }),
    };
  }

  /** R13 answer handling. `undefined` means "not an answer to this question, but it does carry
   *  values" — the normal collect-and-re-ask path owns those, so a correction is never lost. */
  private async answerIssueDecision(
    ctx: RequestContext,
    input: { messageText: string; webBaseUrl?: string },
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

  /** Journey A step 5, and the loop it must not become. A LINE-uploaded signature is stored
   *  `PENDING_OWNER_APPROVAL`, which the ACTIVE-only reusable lookup cannot see — so asking for a
   *  photo again would repeat forever while the photo already sits in the owner's queue. The newest
   *  asset's status decides which of the three true situations the sender is actually in. */
  private async askForSignature(
    ctx: RequestContext,
    input: { webBaseUrl?: string },
    expense: ExpenseRecordWithRelations,
    state: LineSubstituteReceiptContinuation,
  ): Promise<LineSubstituteReceiptContinuationResult> {
    const latest = await this.repo.findLatestSignatureAssetStatus(ctx.companyId, ctx.userId);
    const sendPhoto = 'ส่งรูปลายเซ็นเข้ามาในแชทนี้ได้เลยค่ะ';
    const howTo = [
      'เซ็นบนกระดาษขาว ถ่ายให้เห็นเต็มลายเซ็น แล้วส่งรูปเข้ามาในแชทนี้',
      'ระบบจะเก็บเป็นลายเซ็นประจำตัว (รอเจ้าของกิจการอนุมัติก่อนใช้งาน) แล้วใช้ซ้ำได้ทุกใบ ไม่ต้องส่งอีก',
    ];
    const waiting = latest?.status === 'PENDING_OWNER_APPROVAL';
    const rejected = latest?.status === 'REJECTED';
    const question = waiting ? 'ระหว่างรออนุมัติ จะขอฟอร์มไปเซ็นเองก่อนไหมคะ (ตอบ 2)' : sendPhoto;
    return {
      handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: state.workflowId,
      acceptedFields: [],
      blockers: [blocker(
        waiting ? 'reusable_signature_pending_approval' : 'reusable_signature_required',
        waiting ? 'ลายเซ็นรอเจ้าของกิจการอนุมัติ' : 'ยังไม่มีลายเซ็นที่บันทึกไว้',
        true,
      )],
      // The decision stays pending and nothing is written, so “1” after the photo lands here again.
      pendingQuestion: question,
      webPath: workflowLink(input.webBaseUrl, ctx.companyId, expense.id, state.workflowId),
      replyText: formatStandalone({
        headline: (waiting
          ? [
            'ลายเซ็นของคุณส่งแล้ว รอเจ้าของบริษัทอนุมัติในเว็บค่ะ',
            'พออนุมัติแล้วจะใช้ลงนามได้ทันที ไม่ต้องส่งรูปใหม่',
            'ถ้าไม่อยากรอ ขอฟอร์มไปเซ็นด้วยมือก่อนได้',
          ]
          : rejected
            ? [
              `ลายเซ็นที่ส่งมาก่อนหน้านี้ไม่ผ่านการอนุมัติค่ะ${latest?.rejectReason ? ` (เหตุผล: ${latest.rejectReason})` : ''}`,
              ...howTo,
            ]
            : ['ยังไม่มีลายเซ็นที่บันทึกไว้ในระบบค่ะ', ...howTo]).join('\n'),
        ...(waiting ? { choices: ISSUE_DECISION_CHOICES } : {}),
        question,
      }),
    };
  }

  /** R7 from the conversation: prepare with the values the preflight already cleared, then hand the
   *  work to the one web page where certification and approval happen. */
  private async prepareFromLine(
    ctx: RequestContext,
    input: { webBaseUrl?: string },
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
        expectedExpenseUpdatedAt: state.targetRevision,
      });
      const webPath = absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/substitute-receipts/${evidence.id}`);
      const amount = `${expense.grandTotalAmount} ${expense.currency}`;
      return {
        handled: true, status: 'READY_FOR_WEB', expenseId: expense.id, workflowId: state.workflowId,
        acceptedFields: [], blockers: [], webPath,
        replyText: formatStandalone({
          headline: choice === 'ISSUE'
            ? [
              `🔵 รอยืนยัน — เตรียมเอกสารและจองเลขที่ ${evidence.documentNumber} ไว้แล้ว`,
              `ยอด ${amount} · ผู้จ่าย ${evidence.payerName}`,
              'ขั้นต่อไปทำในเว็บหน้าเดียว: ผู้จ่ายลงนามรับรอง แล้วผู้มีสิทธิ์อนุมัติ',
            ].join('\n')
            : [
              `🖊️ รอลงนาม — เตรียมเอกสารและจองเลขที่ ${evidence.documentNumber} ไว้แล้ว`,
              `ยอด ${amount} · ผู้จ่าย ${evidence.payerName}`,
              'แบบฟอร์มรอลงนามมีลายน้ำ UNSIGNED และยังไม่ใช่เอกสารที่ออกแล้ว',
            ].join('\n'),
          boundary: 'LINE ยังไม่ได้ลงนาม อนุมัติ หรือออกเอกสาร',
          question: choice === 'ISSUE'
            ? 'เปิดลิงก์ด้านบนเพื่อลงนามรับรองและอนุมัติในเว็บได้เลยค่ะ'
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
      const blockers = [blocker('substitute_prepare_failed', `ยังเตรียมเอกสารไม่ได้: ${exceptionText(error)}`)];
      return {
        handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: state.workflowId,
        acceptedFields: [], blockers, webPath,
        replyText: formatResult({ status: 'BLOCKED', expense, state, acceptedFields: [], blockers, webPath }),
      };
    }
  }
}
