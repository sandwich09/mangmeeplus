import { isLineWorkflowPutOff } from '@watchdog-bms/contracts';
import { lineWorkflowPickerText } from '../../../line-ai/domain/logic/line-ai-classifier.logic';
import { lineReplyLanguage } from '@watchdog-bms/contracts';
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { BusinessDocumentClassification, ExpensePaymentMethod, LineIntakeSubstituteContext, LineSubstituteReceiptPrefill, ReceiptOcrFieldResult, RequestContext, SubstituteReceiptCashEvidencePolicy, SubstituteReceiptReasonCode } from '@watchdog-bms/contracts';
import { extractValueCandidates, isAmbiguousDateCandidate, isCheckBillClassification, substituteReceiptRequiresPaymentEvidence } from '@watchdog-bms/contracts';
import type { ExpenseRecordWithRelations } from '../../domain/models/expense.model';
import { AuditService } from '../../../audit/application/audit.service';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { isAutoMissingReceiptReason } from '../../domain/logic/expense-document.logic';
import { substituteWetSignedScanRejection } from '../../domain/logic/substitute-receipt-pdf.logic';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { collectSubstituteReceiptEligibilityIssues, PrepareSubstituteReceiptUseCase } from './substitute-receipt.use-case';
import { UpdateExpenseDraftUseCase } from './expense-draft.use-case';
import { maySubmitSignature } from './signature-asset.use-case';
// LINE renders a bare `/companies/...` as plain text, so these sites shipped an untappable string.
// `webPath` itself stays a path — only the user-facing render is absolutised. `webLink` is a no-op
// when the caller already absolutised through `absoluteLink(input.webBaseUrl, …)`.
import { webLink } from '../../../../common/http/web-link';

const STATE_KEY = 'lineSubstituteReceiptContinuation';
/** One coded shape for “these bytes may not become this document's signed original”, shared by the
 *  repository's state guard and the composability gate so the web shows one Thai sentence. */
export const SCAN_NOT_LINKABLE = 'substitute_wet_signed_scan_not_linkable';
const ACTIVE_STATUSES = new Set(['OPEN', 'PAUSED']);
const MAX_VALUE_LENGTH = 500;
/** Hard-ineligible blocker codes: an expense carrying any of these can never advance OR be mutated. */
const INELIGIBLE_CODES = new Set(['expense_status_ineligible', 'source_type_ineligible', 'valid_receipt_normal_path', 'classification_ineligible', 'document_kind_ineligible', 'currency_not_supported', 'active_substitute_evidence_exists']);

export type LineSubstituteReceiptValues = {
  fundingSource?: 'COMPANY' | 'PERSONAL_ADVANCE';
  paidInFullAcknowledged?: boolean;
  reasonCode?: SubstituteReceiptReasonCode;
  missingReceiptReason?: string;
  businessPurpose?: string;
  payerUserId?: string;
  payeeName?: string;
  paymentDate?: string;
  /** null keeps an ambiguous correction unresolved instead of restoring the expense's old method. */
  paymentMethod?: ExpensePaymentMethod | null;
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
  pendingDecision?: 'ISSUE_CONFIRM' | 'CHECK_BILL_PAYMENT' | 'CHECK_BILL_FINAL_RECEIPT';
  /** The user entered this continuation from a paid check bill, not from the generic candidate list. */
  routeCheckBill?: true;
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

export type LineSubstituteReplySource = {
  records: Array<{ id: string; revision: string; evidenceHash: string; attachmentsHash: string }>;
  categoriesHash?: string;
  policy?: { branchId: string | null; payerUserId: string | null; hash: string };
  signatureAvailable?: boolean;
};

function sourceHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function attachmentSource(expense: ExpenseRecordWithRelations) {
  return expense.attachments.map(({ id, purpose, status }) => ({ id, purpose, status }))
    .sort((a, b) => a.id.localeCompare(b.id) || a.purpose.localeCompare(b.purpose));
}

export function substituteReplySource(expense: ExpenseRecordWithRelations, revision = expense.updatedAt): LineSubstituteReplySource {
  return { records: [{ id: expense.id, revision: revision.toISOString(),
    evidenceHash: sourceHash(expense.substituteReceiptEvidence), attachmentsHash: sourceHash(attachmentSource(expense)) }] };
}

export type LineSubstituteReceiptContinuationResult = {
  handled: true;
  source?: LineSubstituteReplySource;
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
  /** S1: the open issue decision could not read this message as an answer to itself. The turn is a
   *  re-ask, not a resolution — the dispatcher lets it fall through to the intake router so a new
   *  expense capture still works while the decision waits, and carries the re-ask along as the
   *  resume capsule. Absent means the continuation owns the turn. */
  decisionUnread?: boolean;
  decisionOffered?: 'ISSUE' | 'FORM';
  resumeCapsule?: string;
  /** The exact expense id(s) this reply is asking the user to pick from or confirm — a target-selection
   *  carries the offered shortlist, a start-confirm carries the ONE selected id. The webhook pins these on
   *  the clarification so the next ordinal/affirmative binds to the SAME id, never the shifting recency
   *  window. Wording snapshot only, never authorization (execute always re-checks the id). */
  candidateExpenseIds?: string[];
};

// NFC, never NFKC: NFKC decomposes ำ (U+0E33 → U+0E4D U+0E32), which both mangles echoed user text
// and stops every composed-ำ literal below (ทำใบรับรองต่อ, ไว้ทำทีหลัง, ไม่ทำแล้ว) from ever matching.
//
// Entry vocabulary. Deliberately a small deterministic list, not an attempt at every phrasing: the
// intake router's semantic read is the primary way an intent is understood, and this is the fallback
// (the off/legacy webhook path) that must still work when the router is unreachable. Two boundaries
// hold it in place —
//  * “ใบสำคัญรับเงิน” is a DIFFERENT, stronger document and must never enter here (R15 explains it);
//  * a bare “ไม่มีใบเสร็จ” beside an amount is an ordinary expense capture (and a reason code), so
//    the no-receipt phrasings are admitted only when the sender also asks what to do about it.
// The document word STANDS ALONE: “ใบทดแทนของค่าวินมอไซค์” is ordinary Thai (“the substitute
// document FOR the motorcycle-taxi fare”), and requiring ใบเสร็จ/เงินสด/บิล right behind it sent that
// UAT turn to plain expense capture. Neither boundary above moves — none of the standalone words is
// a substring of ใบสำคัญรับเงิน, and none appears in a bare “…ไม่มีใบเสร็จ” capture.
const SUBSTITUTE_VOCABULARY = new RegExp([
  // Longest form first at each starting position: `substituteRequestExpenseText` splits the message
  // on this match, so a short alternative winning would leave “ใบเสร็จ” glued to the expense text.
  'ใบรับรองแทนใบเสร็จ(?:รับเงิน)?', 'ใบรับรองแทนเงินสด', 'ใบรับรองแทนบิล', 'ใบรับรองแทน',
  'ใบทดแทนใบเสร็จ', 'ใบทดแทน',
  'ขอใบแทน(?:ใบเสร็จ)?', 'ใบแทนใบเสร็จ', 'ใบแทน',
  'เอกสารแทนใบเสร็จ',
  // The resume phrase the assistant itself teaches.
  'ทำใบรับรองต่อ',
  'ไม่มี(?:ใบเสร็จ|บิล|ใบกำกับภาษี|หลักฐาน)[^]{0,12}(?:ทำยังไง|ทำไง|ทำอย่างไร|ต้องทำอะไร|ต้องทำยังไง|ทำอะไรดี)',
].join('|'), 'u');

/** BROAD legacy matcher (canonical names + loose forms). The off/legacy webhook path uses this when the
 *  semantic intake router is unreachable; the router's semantic read is the primary way an intent is read. */
export function isSubstituteReceiptConversationText(text: string): boolean {
  return SUBSTITUTE_VOCABULARY.test(text.normalize('NFC').toLocaleLowerCase('th-TH'));
}

/** Advisor S1 (spec §5.2): "มีใบรับรองแทนใบเสร็จรอฉันเซ็นกี่ใบ" names the document but asks about the ones
 *  ALREADY waiting for a signature or an approval — a read, answered by the queue tool. Never an explicit
 *  start, even when the router misroutes it here. */
// `(?<!รับ)`: the document's own name ใบรับรอง already spells รอ.
const SUBSTITUTE_QUEUE_QUESTION = /(?:(?<!รับ)รอ|ต้อง|ค้าง)[^\n]{0,12}(?:เซ็น|ลงนาม|ลงชื่อ|ลายมือชื่อ|อนุมัติ)|กี่ใบ/u;
export function isSubstituteQueueQuestion(text: string): boolean {
  return SUBSTITUTE_QUEUE_QUESTION.test(text.normalize('NFC'));
}

/** Whole-message pause/cancel controls, anchored so answers like “ไม่มี”/“ไม่มีใบเสร็จ” stay out.
 *  Shared by `execute`'s turn routing and the short-answer capture guard in `extractValues`. */
const SUBSTITUTE_PAUSE = /^(พัก|พักไว้ก่อน|ไว้ทำทีหลัง|ไม่ทำต่อ|ไม่ต่อ|ไม่ทำ|ไม่เอา|ไม่ต้องทำ)$/u;
const SUBSTITUTE_CANCEL = /^(ยกเลิก|ยกเลิกงานนี้|ไม่ทำแล้ว)$/u;
/** The resume/acknowledgement/number replies the bot itself teaches (R15 “ทำต่อ”, a bare choice
 *  number, a yes). None is ever the value of a certified field, so the short-answer capture skips them. */
const SUBSTITUTE_CONTROL_REPLY = /^(ทำต่อ|ใช่|ตกลง|ครับ|ค่ะ|โอเค|โอเก|ok|\d{1,2})$/iu;

/** The preposition the request phrase leaves glued to the front of the expense text once the document
 *  word may stand alone: “ใบทดแทน|ของค่าวินมอไซค์…” would title the draft “ของค่าวินมอไซค์…”. Only the
 *  unambiguous ones are dropped — `ของ` solely in front of a cost/act noun (`ของขวัญ`, `ของใช้` are
 *  words of their own and must survive), and `สำหรับ`, which is never the head of a word. What is left
 *  is still ONE contiguous slice of the source text, which is what the capture gate matches against. */
const LEADING_PREPOSITION = /^(?:ของ(?=ค่า|การ)|สำหรับ)\s*/u;

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
  const description = normalizedText(after.length >= before.length ? after : before)
    .replace(LEADING_PREPOSITION, '');
  return description.replace(/[\d,.\s]|บาท|thb|baht|฿/giu, '').length >= 4 ? description : undefined;
}

/**
 * ANCHORED canonical explicit-start predicate: the message must be an explicit request to MAKE/ISSUE the
 * named substitute document (an action verb + the canonical name) or be the bare canonical name — never a
 * paraphrase, a passing mention, a definition question, or a negation. This is what proves a "start" is a
 * safe explicit command; a semantic paraphrase must be CONFIRMED (input.confirmedStart) instead.
 */
export function isCanonicalSubstituteStart(text: string): boolean {
  // NFC (not NFKC): NFKC decomposes precomposed Thai vowels like ทำ (SARA AM) into ท + ํ + า, which the
  // precomposed regex literals below would never match. NFC keeps them composed; we still fold whitespace.
  const t = text.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('th-TH');
  if (/(อะไร|คือ|ยังไง|ไหม|มั้ย|ไม่ทำ|ไม่เอา|ยังไม่|ไม่อยาก)/u.test(t)) return false;
  const canonicalName = 'ใบรับรองแทนใบเสร็จ(?:รับเงิน)?';
  return new RegExp(`(ทำ|ขอ|ออก|สร้าง|เริ่ม|จัดทำ)\\s*${canonicalName}`, 'u').test(t)
    || new RegExp(`^${canonicalName}$`, 'u').test(t);
}

// The substitute document name, shared by the anchored control predicates below.
const SUBSTITUTE_DOC_NAME = 'ใบรับรองแทนใบเสร็จ(?:รับเงิน)?';

/**
 * ANCHORED pause/cancel controls (NFC-safe, same reasoning as isCanonicalSubstituteStart). These fire only
 * when a message ALREADY routed into a substitute workflow is an explicit pause/cancel of that work: a bare
 * control word, OR the control verb applied to the named substitute document (Thai natural phrasing or
 * English). A question ("…ได้ไหม"), a field answer, or a passing mention NEVER triggers a control, so no
 * turn can silently mutate workflow state. Kept as predicates so the protected corpus phrases and the
 * safety negatives are unit-tested against the exact runtime controls.
 */
export function isSubstitutePauseControl(text: string): boolean {
  const t = text.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('th-TH');
  if (/(อะไร|คือ|ยังไง|ไหม|มั้ย|\?|？)/u.test(t)) return false;
  // Short forms + the plain refusals develop's SUBSTITUTE_PAUSE admits (R15 offers “ไม่ทำต่อ” as the way
  // out), then our natural “พัก + ใบรับรองแทนใบเสร็จ …” phrasings and the English opt-out. Anchored, so
  // “ยังไม่ทำ”/“ไม่เอาแล้ว” (a non-committal answer) stay OUT and route as a zero-write no-op instead.
  return isLineWorkflowPutOff(t)
    || new RegExp(`^พัก(?:${SUBSTITUTE_DOC_NAME})?(?:ไว้)?(?:ก่อน)?$`, 'u').test(t)
    || /^pause(?: the)?(?: substitute receipt)?(?: for now)?$/u.test(t);
}

export function isSubstituteCancelControl(text: string): boolean {
  const t = text.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('th-TH');
  if (/(อะไร|คือ|ยังไง|ไหม|มั้ย|\?|？)/u.test(t)) return false;
  return /^ไม่ทำแล้ว$/u.test(t)
    || new RegExp(`^ยกเลิก(?:${SUBSTITUTE_DOC_NAME})?(?:อันนี้|งานนี้|นี้)?$`, 'u').test(t)
    || /^cancel(?: this)?(?: substitute receipt)?$/u.test(t);
}

function normalizedText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export const CHECK_BILL_PAYMENT_QUESTION = 'จ่ายเงินแล้วหรือยังคะ เลือกคำตอบได้เลยค่ะ';
export const CHECK_BILL_PAYMENT_CHOICES = [
  'จ่ายแล้ว แต่ไม่ได้ใบเสร็จ',
  'ยังไม่ได้จ่าย',
  'มีใบเสร็จ จะส่งรูปใหม่',
];

export function checkBillPaymentChoice(text: string): 'PAID_NO_RECEIPT' | 'UNPAID' | 'FINAL_RECEIPT' | undefined {
  const value = normalizedText(text).toLocaleLowerCase('th-TH');
  if (/^(?:ข้อ\s*)?1$/u.test(value) || /(จ่ายแล้ว|ชำระแล้ว).*(ไม่มี|ไม่ได้รับ).*(ใบเสร็จ)/u.test(value)) return 'PAID_NO_RECEIPT';
  if (/^(?:ข้อ\s*)?2$/u.test(value) || /(ยังไม่ได้จ่าย|ยังไม่จ่าย|ยังไม่ได้ชำระ|ค้างชำระ)/u.test(value)) return 'UNPAID';
  if (/^(?:ข้อ\s*)?3$/u.test(value) || /(มี|ได้).*(ใบเสร็จฉบับสุดท้าย|ใบเสร็จจริง|ใบเสร็จแล้ว)/u.test(value)) return 'FINAL_RECEIPT';
  return undefined;
}

function checkBillPaymentReply(expenseId: string, webBaseUrl: string | undefined, companyId: string, language: 'th' | 'en' = 'th'): string {
  return formatStandalone({ language,
    headline: [
      (language === 'en' ? 'This document is not a receipt yet.' : '🧾 เอกสารนี้ยังไม่ใช่ใบเสร็จค่ะ'),
      (language === 'en' ? 'The bill shows an amount due without proof of payment, so it remains an unconfirmed draft.' : 'เห็นยอดที่ต้องจ่าย แต่ยังไม่เห็นหลักฐานว่าร้านรับเงินแล้ว ระบบจึงเก็บไว้เป็นร่างและยังไม่ยืนยันค่าใช้จ่าย'),
    ].join('\n'),
    choices: language === 'en' ? ['Paid, no final receipt', 'Not paid yet', 'A final receipt is available'] : CHECK_BILL_PAYMENT_CHOICES,
    question: language === 'en' ? 'Has this bill been paid, and is a final receipt available?' : CHECK_BILL_PAYMENT_QUESTION,
    webPath: absoluteLink(webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`),
  });
}

function bounded(value: string | undefined, max = MAX_VALUE_LENGTH): string | undefined {
  const text = value && normalizedText(value);
  return text && text.length <= max ? text : undefined;
}

const LABELS = {
  missingReceiptReason: 'เหตุผล(?:ที่ไม่มีใบเสร็จ)?|สาเหตุ|(?:reason|missing receipt reason)(?=\\s*:)',
  businessPurpose: 'วัตถุประสงค์(?:ทางธุรกิจ)?|ใช้เพื่อ|เพื่อ|(?:purpose|business purpose)(?=\\s*:)',
  payeeName: 'ผู้รับเงิน|ผู้ขาย|ร้านค้า|(?:payee|seller)(?=\\s*:)',
  paymentMethod: 'วิธีชำระ(?:เงิน)?|วิธีจ่าย|ชำระด้วย|จ่ายด้วย|จ่ายโดย|(?:payment method|paid by)(?=\\s*:)',
  paymentDate: 'วันที่จ่าย|วันที่ชำระ|ชำระเมื่อ|จ่ายเมื่อ|วันที่|(?:payment date|paid on)(?=\\s*:)',
  payer: '(?:ฉัน|ผม|ดิฉัน|หนู)เป็นผู้จ่าย|ผู้จ่าย(?:เงิน)?|(?:payer)(?=\\s*:)',
  funding: 'บริษัทจ่าย(?:เต็ม(?:จำนวน)?)?|พนักงานสำรองจ่ายเต็ม(?:จำนวน)?',
  itemDescription: 'รายการ|รายละเอียดรายการ|(?:item|description)(?=\\s*:)',
  amount: 'ยอด(?:รวม)?|จำนวนเงิน|(?:amount|total)(?=\\s*:)',
  expenseCategoryId: 'หมวด(?:ค่าใช้จ่าย)?|(?:category|expense category)(?=\\s*:)',
} as const;
const ANY_LABEL = Object.values(LABELS).join('|');
const LABEL_END = '(?=\\s|[:：]|$)';
const METHOD_TOKEN = /จ่ายโอน|เงินสด|โอน(?:เงิน)?|พร้อมเพย์|bank\s*transfer|cash|บัตร(?:เครดิต)?|card|เช็ค|เช็ก|cheque/iu;

/** LINE can collapse newlines. The same label boundary starts AND ends a field, with an optional
 * colon. Continuous Thai prose such as ผู้รับเงินไม่ออกใบเสร็จ is a value, not a second label. */
function labeled(text: string, labels: string): string | undefined {
  const matches = [...text.matchAll(new RegExp(
    `(?:^\\s*(?:${labels})(?=\\s|[:：]|คือ|เป็น|$)|[\\s,;](?:${labels})${LABEL_END})\\s*(?:[:：]|คือ|เป็น)?\\s*(.*?)(?=\\s*(?:${ANY_LABEL})${LABEL_END}|,(?![\\d๐-๙])|[;\\n]|$)`, 'gimu',
  ))];
  const values = [...new Set(matches.map(match => bounded(match[1])))];
  return values.length === 1 ? values[0] : undefined;
}

/** Legal free text stops before facts owned by the value extractors. Empty/conflicting values stay
 * missing; they never fall back to the entire message. */
function freeTextOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const candidates = extractValueCandidates(value);
  const ends = [value.search(new RegExp(`(?:${ANY_LABEL})${LABEL_END}`, 'iu')), value.search(METHOD_TOKEN),
    value.search(/บริษัทจ่าย|พนักงานสำรองจ่าย/u),
    ...[...candidates.dates, ...candidates.amounts].map(candidate => value.indexOf(candidate.span))].filter(index => index >= 0);
  return bounded(value.slice(0, ends.length ? Math.min(...ends) : value.length));
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
    .filter((line) => !lineWorkflowPickerText(line).question && !/[?？]|ไหม|อย่างไร|ยังไง|ถ้า/u.test(line))
    .join('\n');
}

function reasonCodeOf(text: string): SubstituteReceiptReasonCode | undefined {
  if (/(ผู้ขาย|ผู้รับเงิน|ร้าน).*(?:ไม่ออก|ไม่ให้|ออก.*ไม่ได้|ให้.*ไม่ได้)|ไม่สามารถออก/u.test(text)) return 'PAYEE_CANNOT_ISSUE';
  if (/(ชำรุด|ไม่ครบ|ข้อมูลไม่ครบ|อ่านไม่ออก)/u.test(text)) return 'RECEIPT_MATERIALLY_INCOMPLETE';
  if (/no receipt|receipt (?:is )?(?:lost|unavailable)|lost receipt/iu.test(text) || /(ไม่มีใบเสร็จ|ใบเสร็จหาย|ไม่ได้รับใบเสร็จ|หาใบเสร็จไม่เจอ)/u.test(text)) return 'RECEIPT_UNAVAILABLE';
  return undefined;
}

function firstPaymentDate(text: string): string | undefined {
  const dates = extractValueCandidates(text).dates;
  const unique = new Set(dates.map(candidate => candidate.isoDate));
  return unique.size === 1 && dates.every(candidate => !isAmbiguousDateCandidate(candidate)) ? dates[0]?.isoDate : undefined;
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

/** A category answer, in the three shapes a person actually sends: the number the question printed,
 *  the exact name, or a sentence containing exactly one of the names. Anything else returns
 *  undefined, which leaves the blocker in place so the question is asked again WITH the list — a
 *  wrong category on a legal document is worse than one extra turn. */
function resolveCategoryId(
  text: string | undefined,
  activeCategories: Array<{ id: string; name: string }>,
): string | undefined {
  const value = text && normalizedText(text);
  if (!value) return undefined;
  const numbered = /^(\d{1,2})[.)]?$/u.exec(value)?.[1];
  if (numbered) return activeCategories[Number(numbered) - 1]?.id;
  const wanted = value.toLocaleLowerCase('th-TH');
  const named = activeCategories.map((item) => ({ id: item.id, name: normalizedText(item.name).toLocaleLowerCase('th-TH') }));
  const exact = named.find((item) => item.name === wanted);
  if (exact) return exact.id;
  const contained = named.filter((item) => item.name && wanted.includes(item.name));
  return contained.length === 1 ? contained[0]!.id : undefined;
}

function extractValues(
  text: string,
  pendingField: string | null,
  currentUserId: string,
  activeCategories: Array<{ id: string; name: string }>,
  missingFields: string[] = [],
): LineSubstituteReceiptValues {
  const values: LineSubstituteReceiptValues = {};
  const declarative = nonQuestionLines(text).replace(/ไม่มีใบเสร็จเพราะ\s*/gu, 'เหตุผล: ');
  const payerLabel = labeled(declarative, LABELS.payer);
  const companyFull = /บริษัทจ่าย(?:เต็ม(?:จำนวน)?)?/u.test(declarative)
    || /(?:shop|company) paid (?:the )?full(?: amount)?/iu.test(declarative) || payerLabel === 'บริษัท' || payerLabel === 'บริษัทจ่าย';
  const personalFull = /(?:personal|employee) advance(?:d)? (?:the )?full(?: amount)?/iu.test(declarative) || /(?:พนักงาน|ฉัน|ผม|ดิฉัน|หนู)(?:ใช้เงินส่วนตัว)?(?:สำรอง)?จ่ายเต็ม(?:จำนวน)?/u.test(declarative);
  const unsupportedFunding = /part(?:ly|ial)|split payment/iu.test(declarative) || /บางส่วน|ทยอย|แบ่งจ่าย|หารจ่าย|เงินผสม/u.test(declarative) || (companyFull && personalFull);
  if (!unsupportedFunding && companyFull) { values.fundingSource = 'COMPANY'; values.paidInFullAcknowledged = true; }
  if (!unsupportedFunding && personalFull) { values.fundingSource = 'PERSONAL_ADVANCE'; values.paidInFullAcknowledged = true; }
  if (unsupportedFunding) values.paidInFullAcknowledged = false;
  const reasonCode = reasonCodeOf(declarative);
  if (reasonCode) values.reasonCode = reasonCode;
  const missingReceiptReason = freeTextOf(labeled(declarative, LABELS.missingReceiptReason));
  if (missingReceiptReason) {
    values.missingReceiptReason = missingReceiptReason;
    values.reasonCode ??= reasonCodeOf(text) ?? 'OTHER';
  }
  for (const field of ['missingReceiptReason', 'businessPurpose', 'payeeName', 'itemDescription'] as const) {
    if (new RegExp(`(?:^\\s*(?:${LABELS[field]})(?=\\s|[:：]|คือ|เป็น|$)|[\\s,;](?:${LABELS[field]})${LABEL_END})`, 'imu').test(declarative)) {
      // Empty strings survive JSON storage and block fallback to an old expense fact.
      values[field] = freeTextOf(labeled(declarative, LABELS[field])) ?? '';
    }
  }
  if (/\bI am the payer\b|\bpayer\s*:\s*me\b/iu.test(declarative) || /(ฉัน|ผม|ดิฉัน|หนู).*(เป็น|คือ).*(ผู้จ่าย|คนจ่าย)|ผู้จ่าย(?:เงิน)?\s*(?:คือ|เป็น)?\s*(ฉัน|ผม|ดิฉัน|หนู)/u.test(declarative)) {
    values.payerUserId = currentUserId;
  }
  const labeledPayment = labeled(declarative, LABELS.paymentMethod);
  const plainPayment = pendingField === 'paymentMethod' && normalizedText(declarative).length <= 40
    ? declarative
    : undefined;
  const methodText = labeledPayment ?? plainPayment ?? declarative.match(METHOD_TOKEN)?.[0] ?? '';
  const methods = new Set([...declarative.matchAll(new RegExp(METHOD_TOKEN.source, 'giu'))].map(match => paymentMethodOf(match[0])));
  const paymentMethod = methods.size <= 1 ? paymentMethodOf(methodText) : undefined;
  if (paymentMethod || methods.size > 1) values.paymentMethod = paymentMethod ?? null;
  const paymentDate = firstPaymentDate(declarative);
  if (paymentDate || extractValueCandidates(declarative).dates.length) values.paymentDate = paymentDate ?? '';
  const amountLabel = labeled(declarative, LABELS.amount);
  if (amountLabel) {
    const amount = extractValueCandidates(amountLabel).amounts[0]?.value;
    if (amount) values.amount = amount;
  }
  // B1: the category is a collectable field, so its own question's answer counts too — the number the
  // question printed, or the name typed plainly. Both resolve against the company's ACTIVE categories,
  // so nothing outside this company can ever be written.
  // The unlabelled form is bounded by length, like `plainPayment` above: a short reply to the
  // category question is an answer to it, while a long message that merely happens to contain a
  // category name is prose, and reading a certified field out of prose is what `labeled` exists to
  // prevent.
  const plainCategory = pendingField === 'expenseCategoryId' && normalizedText(declarative).length <= 40
    ? declarative
    : undefined;
  const categoryId = resolveCategoryId(labeled(declarative, LABELS.expenseCategoryId) ?? plainCategory, activeCategories);
  if (categoryId) values.expenseCategoryId = categoryId;
  // R5 ask-once: only the evidence question may be answered with “no evidence”. An unprompted
  // “ไม่มีใบเสร็จ” is a reason code, never a statement that no file exists. The natural answer to
  // “มีสลิปไหม” is a bare “ไม่มี”, so that short form counts too — but only while it is the question.
  if ((pendingField === 'evidenceNone' || missingFields.includes('evidenceNone'))
    && (/^no (?:evidence|supporting evidence|file|photo|slip)[.!]?$/iu.test(declarative.trim()) || /(ไม่มีหลักฐาน|ไม่มีสลิป|ไม่มีรูป|ไม่มีไฟล์)/u.test(declarative)
      || /^ไม่มี\S{0,4}$/u.test(normalizedText(declarative)))) {
    values.evidenceNone = true;
  }

  // A short unlabeled answer is accepted only for the exact source-generated pending question — but
  // never when it is a control phrase the bot itself taught the sender to type here: resume/pause/
  // cancel words, a bare choice number, a yes. Captured, any of these
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
  if (plain && !controlPhrase && Object.keys(values).length === 0 && !lineWorkflowPickerText(plain).question && !/[?？]|ไหม|หรือไม่|อย่างไร|ยังไง/u.test(plain)
    && !new RegExp(`(?:^|\\s)(?:${ANY_LABEL})${LABEL_END}`, 'u').test(plain)) {
    if (pendingField === 'missingReceiptReason') values.missingReceiptReason = freeTextOf(plain);
    if (pendingField === 'businessPurpose') values.businessPurpose = freeTextOf(plain);
    if (pendingField === 'payeeName') values.payeeName = freeTextOf(plain);
  }
  return values;
}

function groundedSideAnswer(expense: ExpenseRecordWithRelations, text: string, language: 'th' | 'en' = 'th'): string | undefined {
  if (language === 'en' && /vat|tax/iu.test(text) && /[?？]|can|does|what|how/iu.test(text)) return 'A substitute receipt is internal evidence, not a seller tax invoice, and does not make input VAT claimable; attach a valid tax invoice for review on the web.';
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

/** B2: the LINE text capture stamps a marker on `missingReceiptReason` so the evidence-gap rules read
 *  “no file, reason recorded”. It is not the payer's answer, so the substitute flow must not treat it
 *  as one — otherwise the real question is never asked and the marker prints on the certificate. */
function storedMissingReceiptReason(expense: ExpenseRecordWithRelations): string | undefined {
  return isAutoMissingReceiptReason(expense.missingReceiptReason) ? undefined : expense.missingReceiptReason ?? undefined;
}

function currentValue<T extends keyof LineSubstituteReceiptValues>(
  values: LineSubstituteReceiptValues,
  key: T,
  fallback: LineSubstituteReceiptValues[T],
): LineSubstituteReceiptValues[T] {
  return values[key] !== undefined ? values[key] : fallback;
}

function preflight(
  ctx: RequestContext,
  expense: ExpenseRecordWithRelations,
  values: LineSubstituteReceiptValues,
  policy: { configured: boolean; approvalMode: 'OWNER_SELF' | 'DESIGNATED_APPROVERS'; approverUserIds: string[]; cashEvidencePolicy: SubstituteReceiptCashEvidencePolicy },
  eligibleApproverIds: Set<string>,
  payerActive: boolean,
  routeCheckBill = false,
): LineSubstituteReceiptBlocker[] {
  const result: LineSubstituteReceiptBlocker[] = [];
  if (!ctx.permissions.includes('expense.review')) result.push(blocker('expense_review_forbidden', 'ไม่มีสิทธิ์ตรวจทานเพื่อจัดทำใบรับรองแทนใบเสร็จรับเงิน'));
  // Eligibility reads an effective expense containing the validated category proposal.
  result.push(...collectSubstituteReceiptEligibilityIssues(expense, values.reasonCode, { routeCheckBill })
    .map((issue) => blocker(issue.code, issue.message, issue.code === CATEGORY_BLOCKER)));
  if (expense.substituteReceiptEvidence && expense.substituteReceiptEvidence.status !== 'SUPERSEDED') {
    result.push(blocker('active_substitute_evidence_exists', 'รายการนี้มีใบรับรองแทนใบเสร็จที่ยังใช้งานอยู่แล้ว'));
  }
  if (!values.fundingSource || values.paidInFullAcknowledged !== true) result.push(blocker('funding_source_required', 'เลือกบริษัทจ่ายเต็มจำนวน หรือพนักงานสำรองจ่ายเต็มจำนวน (ไม่รองรับแบ่งจ่าย)', true));
  if (!values.reasonCode) result.push(blocker('reason_code_required', 'ระบุกรณีที่ไม่มี/ใช้ใบเสร็จเดิมไม่ได้', true));
  if (!currentValue(values, 'missingReceiptReason', storedMissingReceiptReason(expense))) {
    result.push(blocker('missing_receipt_reason_required', 'ระบุเหตุผลที่ไม่มีใบเสร็จ', true));
  }
  if (!values.businessPurpose) result.push(blocker('business_purpose_required', 'ระบุวัตถุประสงค์ทางธุรกิจ', true));
  if (!values.payerUserId) result.push(blocker('payer_required', 'เลือกผู้ดำเนินการจ่ายและรับรองค่ะ', true));
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
  const payments = activeAttachments.filter((item) => item.purpose === 'expense.payment.evidence'
    && item.id !== expense.primaryAttachmentId
    && !expense.attachments.some((source) => source.id === item.id && source.purpose !== 'expense.payment.evidence')
    && (item.mimeType?.startsWith('image/') || item.mimeType === 'application/pdf'));
  // R5: evidence is required only when evidence exists. The assistant still asks — once — and a
  // stated “ไม่มีหลักฐาน” clears the blocker instead of dead-ending a legal no-attachment document.
  if (activeAttachments.length === 0 && !values.evidenceNone) {
    result.push(blocker('supporting_evidence_required', 'ส่งรูปสลิป/รูปถ่ายประกอบเข้ามาในแชทนี้ หรือแนบในเว็บ หรือยืนยันว่าไม่มีหลักฐาน', true));
  }
  if (substituteReceiptRequiresPaymentEvidence(expense.aiVerificationSummaryJson, paymentMethod, policy.cashEvidencePolicy)
    && payments.length === 0) {
    result.push(blocker('payment_evidence_required', 'ส่งรูปหลักฐานการชำระเงินเข้ามาในแชทนี้ค่ะ ข้อความใช้แทนไฟล์ไม่ได้'));
  }
  return result;
}

/** The one eligibility code the conversation can clear on its own. Its machine code is shared with the
 *  web (which has its own Thai for it), so it stays exactly as `collectSubstituteReceiptEligibilityIssues`
 *  emits it — only its collectability and its question are new. */
const CATEGORY_BLOCKER = 'reviewed_category_required';

const QUESTIONS: Record<string, string> = {
  funding_source_required: 'ใช้เงินของบริษัทหรือเงินส่วนตัวคะ? ตอบ “บริษัทจ่ายเต็มจำนวน” หรือ “พนักงานสำรองจ่ายเต็มจำนวน” ค่ะ',
  reason_code_required: 'ใบเสร็จไม่มี/หาย ผู้ขายออกให้ไม่ได้ หรือเอกสารเดิมไม่ครบคะ?',
  missing_receipt_reason_required: 'เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?',
  business_purpose_required: 'ค่าใช้จ่ายนี้ใช้เพื่อธุรกิจเรื่องอะไรคะ?',
  payer_required: 'เลือกผู้รับรองการจ่ายจากปุ่มด้านล่างค่ะ ผู้ที่เลือกต้องลงนามด้วยบัญชีของตนเอง',
  payee_required: 'ผู้รับเงินหรือผู้ขายชื่ออะไรคะ?',
  payment_method_required: 'ชำระด้วยเงินสด โอน บัตร หรือเช็คคะ?',
  payment_date_required: 'ชำระเงินจริงวันที่เท่าไรคะ?',
  payment_evidence_required: 'ส่งรูปสลิปหรือหลักฐานการชำระเงินของรายการนี้เข้ามาในแชทได้เลยค่ะ',
  supporting_evidence_required: 'มีสลิปหรือรูปถ่ายประกอบไหมคะ? ถ้ามี ส่งรูปเข้ามาในแชทนี้ หรือแนบในเว็บ ถ้าไม่มี ตอบ “ไม่มีหลักฐาน” ได้เลย',
};

const EN_QUESTIONS: Record<string, string> = {
  "funding_source_required": "Was the full amount paid by the shop or advanced personally by an employee?",
  "reason_code_required": "Was the receipt lost, unavailable from the seller, or incomplete?",
  "missing_receipt_reason_required": "Why is there no usable receipt?",
  "business_purpose_required": "What business purpose was this expense for?",
  "payer_required": "Choose the payer below; that person must sign in with their own account.",
  "payee_required": "What is the payee or seller’s name?",
  "payment_method_required": "Was payment made by cash, bank transfer, card, or cheque?",
  "payment_date_required": "What date was the payment made?",
  "payment_evidence_required": "Please send a photo or file proving payment for this expense.",
  "supporting_evidence_required": "Please send supporting evidence here or attach it on the web; if none exists, say “no evidence”."
};

function collectionQuestion(blockers: LineSubstituteReceiptBlocker[], categories: Array<{ id: string; name: string }>, language: 'th' | 'en' = 'th'): string | undefined {
  const questions = blockers.filter(item => item.collectableInLine && questionFor(item.code, categories, language));
  if (questions.length > 1) return `${language === 'en' ? 'You can provide the missing details in one message.' : 'ตอบข้อมูลที่ยังขาดรวมในข้อความเดียวได้เลยค่ะ'}\n${questions.map(item => `• ${questionFor(item.code, categories, language)}`).join('\n')}`;
  return questions.length ? questionFor(questions[0]!.code, categories, language)
    : blockers.some(item => item.code === 'payment_evidence_required') ? (language === 'en' ? EN_QUESTIONS : QUESTIONS).payment_evidence_required : undefined;
}

/** `listCategories` returns the company's own rows AND the global defaults, so the same name can
 *  appear twice — and “1) ค่าเดินทาง 2) ค่าเดินทาง” is a choice whose label cannot say what picking it
 *  does. Offer one row per name, preferring the company's own, and read the SAME list back when the
 *  answer arrives so a number always means what it showed. */
function offeredCategories(
  categories: Array<{ id: string; name: string; companyId?: string | null }>,
): Array<{ id: string; name: string }> {
  const byName = new Map<string, { id: string; name: string; companyId?: string | null }>();
  for (const item of categories) {
    const key = normalizedText(item.name).toLocaleLowerCase('th-TH');
    const seen = byName.get(key);
    if (!seen || (!seen.companyId && item.companyId)) byName.set(key, item);
  }
  return [...byName.values()].map((item) => ({ id: item.id, name: item.name }));
}

/** The only question whose text depends on the company, so it is built per turn instead of sitting in
 *  QUESTIONS. Numbered because a one-digit reply is the fastest correct answer on a phone; the name
 *  works too, and `resolveCategoryId` reads this exact list back. */
function categoryQuestion(categories: Array<{ id: string; name: string }>, language: 'th' | 'en' = 'th'): string {
  return categories.length
    ? [
      (language === 'en' ? 'Which expense category applies? Reply with its name.' : 'ค่าใช้จ่ายนี้อยู่หมวดไหนคะ? ตอบเลขข้อหรือพิมพ์ชื่อหมวดได้เลย'),
      ...categories.map((item, index) => `• ${item.name}`),
    ].join('\n')
    : (language === 'en' ? 'No expense categories are active; please set them up on the web first.' : 'บริษัทนี้ยังไม่มีหมวดค่าใช้จ่ายที่เปิดใช้งานค่ะ ตั้งหมวดค่าใช้จ่ายในเว็บก่อนได้ไหมคะ?');
}

function questionFor(code: string, categories: Array<{ id: string; name: string }>, language: 'th' | 'en' = 'th'): string | undefined {
  return code === CATEGORY_BLOCKER ? categoryQuestion(categories, language) : (language === 'en' ? EN_QUESTIONS : QUESTIONS)[code];
}

/** M3: the fields a message can actually change once everything is answered, each with the shape of an
 *  answer that works. Derived by hand rather than from FIELD_BY_BLOCKER on purpose — `evidenceNone` is
 *  in that map but is only ever read while the evidence question is the pending one, so listing it
 *  here would offer an edit that quietly does nothing. */
const EDITABLE_FIELD_HINTS: ReadonlyArray<readonly [keyof LineSubstituteReceiptValues, string]> = [
  ['fundingSource', 'บริษัทจ่ายเต็มจำนวน หรือ พนักงานสำรองจ่ายเต็มจำนวน'],
  ['reasonCode', 'ใบเสร็จหาย'],
  ['missingReceiptReason', 'เหตุผล: ผู้ขายไม่ออกใบเสร็จ'],
  ['businessPurpose', 'วัตถุประสงค์: ไปพบลูกค้า'],
  ['payerUserId', 'ฉันเป็นผู้จ่าย'],
  ['payeeName', 'ผู้รับเงิน: ร้านกาแฟหน้าปากซอย'],
  ['paymentMethod', 'วิธีชำระ: เงินสด'],
  ['paymentDate', 'วันที่จ่าย: 5 ส.ค. 2569'],
  ['expenseCategoryId', 'หมวด: ค่าเดินทาง'],
];

const FIELD_BY_BLOCKER: Record<string, keyof LineSubstituteReceiptValues> = {
  [CATEGORY_BLOCKER]: 'expenseCategoryId',
  reason_code_required: 'reasonCode',
  missing_receipt_reason_required: 'missingReceiptReason',
  business_purpose_required: 'businessPurpose',
  payer_required: 'payerUserId',
  payee_required: 'payeeName',
  payment_method_required: 'paymentMethod',
  funding_source_required: 'fundingSource',
  payment_date_required: 'paymentDate',
  supporting_evidence_required: 'evidenceNone',
};

/** R13: the one question the assistant asks once nothing is missing. It never produces the document
 *  unasked, and the three answers are the three things a person can actually want here. */
const ISSUE_DECISION_QUESTION = 'ให้ออกเอกสารเลยไหมคะ';

/** The three choices AS THIS STATE ALLOWS THEM. Choice 1 used to promise “ใช้ลายเซ็นที่บันทึกไว้”
 *  unconditionally — and then, one step later, the signature lookup found nothing and the assistant
 *  had to turn around and ask for a photo. An offered choice must describe what actually happens when
 *  it is taken, so the label states which of the two it is.
 *
 *  The positions never move: `issueDecisionChoice` maps 1/2/3 by position, so dropping a choice would
 *  silently redefine what “2” means. Every position here is takeable — `expense.review` is required to
 *  reach this question at all and is itself a SIGNATURE_OWNER_PERMISSION, so “send a signature photo”
 *  is always open to whoever is being asked. */
function issueDecisionChoices(hasReusableSignature: boolean, language: 'th' | 'en' = 'th'): string[] {
  if (language === 'en') return [hasReusableSignature ? 'Prepare with your saved signature' : 'Prepare after providing your signature photo', 'Get a form to sign on paper', 'Edit the details first'];
  return [
    hasReusableSignature
      ? 'ออกเอกสาร (ใช้ลายเซ็นที่บันทึกไว้)'
      : 'ออกเอกสาร (ยังไม่มีลายเซ็นที่บันทึกไว้ ระบบจะขอรูปลายเซ็นก่อน 1 ครั้ง แล้วใช้ซ้ำได้ทุกใบ)',
    'ขอฟอร์มไปเซ็นเอง',
    'แก้ข้อมูลก่อน',
  ];
}

/** A question is never a decision. “ออกเอกสารได้ไหม” asks what the assistant can do; answering it by
 *  reserving a document number is the single worst misread available here. */
const DECISION_QUESTION = /[?？]|ไหม|หรือเปล่า|รึเปล่า|หรือไม่|อะไร|ยังไง|อย่างไร|ต่างกัน/u;
/** Refusal or deferral ANYWHERE in the message, not only at its front: `normalizedText` has already
 *  collapsed newlines, so “ออกเอกสารเลย\nไม่ ๆ เดี๋ยวก่อน” arrives as one line and must still decline.
 *
 *  Thai is unspaced, so bare particles cannot be used as tokens here — they match inside unrelated
 *  words and turn ordinary conversation into a refusal of the pending document. “ไม่/ยัง” alone
 *  declined “ยังไม่ได้ถ่ายรูปเลย”, “ร้านยังไม่เปิด”, “ยอดนี้ยังไม่รวม vat” and “ไม่เป็นไรค่ะ”; “อย่า”
 *  matched inside “อย่างอื่นไม่มีแล้ว”; “ค่อย” inside “ค่อยๆ ทำนะ”. Every alternative below is a
 *  complete refusal or deferral PHRASE — it says no to doing a thing, rather than merely containing
 *  a negative — which is the word boundary an unspaced script actually gives you. */
const DECISION_DECLINE = new RegExp([
  'ไม่ต้อง', 'ไม่เอา', 'ไม่ออก', 'ยังไม่พร้อม',
  'อย่าเพิ่ง', 'อย่าพึ่ง', 'ห้าม',
  'เดี๋ยวก่อน', 'รอก่อน', 'ไว้ก่อน', 'ค่อยออก',
  'ทีหลัง', 'ภายหลัง', 'วันหลัง', 'พอแค่นี้',
].join('|'), 'u');

/** ── R13 decision vocabulary ────────────────────────────────────────────────────────────────────
 *  A deterministic FALLBACK, not the primary intent mechanism: the intake router reads the sender's
 *  meaning, and this list is what keeps the one question that reserves a document number answerable
 *  when the router is unreachable. It is therefore deliberately short and kept in one place — an
 *  answer none of it matches re-asks with the three numbered choices visible, so a missing word costs
 *  one turn and never a dead end, and never the wrong document.
 *  Substring matches; FORM is read before ISSUE so “ขอฟอร์มไปเซ็นเอง ไม่ต้องออกเอกสาร” is one
 *  decline of issuance rather than two conflicting choices. */
const DECISION_WORDS: ReadonlyArray<readonly ['FORM' | 'EDIT' | 'ISSUE', readonly string[]]> = [
  ['FORM', ['ฟอร์ม', 'แบบฟอร์ม', 'เซ็นเอง', 'จะเซ็น', 'ลงนามเอง', 'เซ็นด้วยมือ', 'พิมพ์ออกมา', 'กระดาษ', 'ปริ้น']],
  ['EDIT', ['แก้ข้อมูล', 'แก้ไข', 'ขอแก้', 'แก้ก่อน', 'แก้หน่อย', 'เปลี่ยนข้อมูล', 'ขอเปลี่ยน', 'ผิด']],
  ['ISSUE', [
    'ออกเอกสาร', 'ออกใบ', 'ออกให้', 'ออกได้', 'ออกเลย', 'ออกมา', 'ใช้ลายเซ็น',
    'ทำเลย', 'ทำให้เลย', 'ทำต่อเลย', 'จัดไป', 'จัดการเลย', 'จัดให้', 'สร้างเอกสาร', 'พิมพ์เอกสาร', 'ดำเนินการ',
  ]],
];

/** Answers to “ให้ออกเอกสารเลยไหมคะ” that name no action at all. Read as YES only for THIS question,
 *  only when no action word matched, and only as the WHOLE message once its polite tail is stripped —
 *  a bare “ครับ/ค่ะ” is an acknowledgement, not an instruction to reserve a document number. */
const DECISION_AFFIRM = new Set([
  'ใช่', 'ใช่แล้ว', 'ถูกต้อง', 'ตกลง', 'โอเค', 'โอเก', 'ok', 'okay', 'เอา', 'เอาสิ', 'ได้', 'ยืนยัน', 'ลุย', 'จัดมา', 'ยินดี',
]);
const POLITE_TAIL = /(?:\s|[!.…ๆๅ]|ค่ะ|คะ|ครับ|คับ|นะ|น่ะ|จ้า|จ้ะ|เลย|แล้ว|ด้วย|ก็ได้)+$/u;

function isAffirmative(value: string): boolean {
  return DECISION_AFFIRM.has(value.toLocaleLowerCase('th-TH').replace(POLITE_TAIL, '').trim());
}

/** Deterministic in four passes, in this order because each one protects the next:
 *  1. a question is not an answer — it falls through to the side-answer/re-ask path;
 *  2. a bare number is the choice it names;
 *  3. an action word decides — and any refusal or deferral token alongside it turns the whole
 *     message into an explicit DECLINE, which reserves nothing;
 *  4. with no action word, a refusal on its own is still a decline (“ยังไม่ต้องออก”), and only then
 *     is a bare yes read as “issue it”. */
function issueDecisionChoice(text: string): 'ISSUE' | 'FORM' | 'EDIT' | 'DECLINE' | undefined {
  const value = normalizedText(text);
  if (DECISION_QUESTION.test(value)) return undefined;
  const numbered = /^([123])[.)]?$/u.exec(value)?.[1];
  if (numbered) return numbered === '1' ? 'ISSUE' : numbered === '2' ? 'FORM' : 'EDIT';
  if (/^(?:prepare (?:the )?document|prepare with (?:my|your) saved signature)$/iu.test(value)) return 'ISSUE';
  if (/^(?:get a form to sign on paper|paper form)$/iu.test(value)) return 'FORM';
  if (/^(?:edit (?:the )?details(?: first)?|edit)$/iu.test(value)) return 'EDIT';
  if (/^(?:not now|decline|no)$/iu.test(value)) return 'DECLINE';
  const declined = DECISION_DECLINE.test(value);
  const wanted = DECISION_WORDS.find(([, words]) => words.some((word) => value.includes(word)))?.[0];
  if (wanted) return declined ? 'DECLINE' : wanted;
  if (declined) return 'DECLINE';
  return isAffirmative(value) ? 'ISSUE' : undefined;
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

function payeeCouldSignHeadline(text: string, language: 'th' | 'en' = 'th'): string | undefined {
  const normalized = text.normalize('NFC');
  const match = PAYEE_COULD_SIGN.exec(normalized);
  if (!match) return undefined;
  if (PAYEE_REFUSED.test(normalized.slice(Math.max(0, match.index - 6), match.index + match[0].length))) return undefined;
  if (language === 'en') return 'If the payee can sign, a payee-signed payment receipt is stronger evidence; issuing that document is not supported here, so continue the substitute receipt or pause this work.';
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
  /** The sender chose “มีใบเสร็จฉบับสุดท้าย”; the next eligible receipt replaces the primary file
   *  on this same expense instead of opening another expense. */
  finalReceiptExpected?: boolean;
  /** When the chat was last asked for a signature / a check bill's final receipt (the asking state's
   *  `lastActivityAt`), so a caption-less photo is claimed only right after that ask. */
  signatureRequestedAt?: string;
  finalReceiptRequestedAt?: string;
  paymentEvidenceRequestedAt?: string;
};

/** How long after the chat asked for a signed form's scan, a signature or a final receipt a caption-less
 *  photo is still taken as that picture (coordinator 2026-09-30, "about 30 minutes"). */
export const SUBSTITUTE_PHOTO_ASK_WINDOW_MS = 30 * 60_000;

/** UAT round 10 (2026-09-30, Owner "ถ้าอ่านรูปได้แล้วต้องสร้างเลย จะวนกลับมาถามทำไม"): a week-old OPEN substitute
 *  state with no ask at all turned every caption-less receipt photo into the numbered "ยังไม่แน่ใจว่าเป็นอะไร" question.
 *  A caption-less photo belongs to open substitute work only when this chat was just asked for exactly that
 *  picture — a printed form's signed scan, a signature, or a check bill's final receipt — within the window. An ask
 *  with no reliable time never claims one. Every other caption-less photo is read and drafted as a new expense. */
export function substituteAwaitsCaptionlessPhoto(context: LineSubstituteMediaContext, now = new Date()): boolean {
  const recent = (at: string | undefined) => {
    const time = at ? Date.parse(at) : Number.NaN;
    return Number.isFinite(time) && time <= now.getTime() + 60_000 && now.getTime() - time <= SUBSTITUTE_PHOTO_ASK_WINDOW_MS;
  };
  return context.awaitingScans.some((scan) => recent(scan.preparedAt))
    || (context.signatureRequested && recent(context.signatureRequestedAt))
    || (context.finalReceiptExpected === true && recent(context.finalReceiptRequestedAt))
    || recent(context.paymentEvidenceRequestedAt);
}

export type LineSubstituteMediaChoice =
  | 'WET_SIGNED_SCAN' | 'SIGNATURE' | 'PAYMENT_EVIDENCE' | 'SUPPORTING_EVIDENCE' | 'NEW_EXPENSE' | 'NO_RECORD';

/** The question a set of pending bytes is waiting on, recorded WITH them. A numbered answer is
 *  resolved against this record, never against what the current state would ask now: the two lists
 *  differ, and reading “2” off the wrong one inverts what the sender said. */
export type LineSubstituteMediaQuestion =
  | { kind: 'CHECK_BILL_ACTION'; chatKeyHash: string; ocrFields?: ReceiptOcrFieldResult; classification?: BusinessDocumentClassification }
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
  if (record.kind === 'CHECK_BILL_ACTION') {
    const checkBill = record as { ocrFields?: ReceiptOcrFieldResult; classification?: BusinessDocumentClassification };
    return {
      kind: 'CHECK_BILL_ACTION', chatKeyHash,
      ...(checkBill.ocrFields ? { ocrFields: checkBill.ocrFields } : {}),
      ...(checkBill.classification ? { classification: checkBill.classification } : {}),
    };
  }
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
export function substituteScanConfirmQuestion(scan: { documentNumber: string; amountLabel: string }, language: 'th' | 'en' = 'th'): string {
  if (language === 'en') return `Is this the signed form for ${scan.documentNumber}, amount ${scan.amountLabel}? Reply “yes” or “no”.`;
  return [
    `ได้รับรูปเข้ามาค่ะ — ใบนี้คือฟอร์ม ${scan.documentNumber} ยอด ${scan.amountLabel} ที่เซ็นแล้วใช่ไหมคะ`,
    '• ใช่',
    '• ไม่ใช่ เป็นหลักฐานอื่น',
  ].join('\n');
}

export function substituteScanConfirmAnswer(text: string): 'YES' | 'NO' | undefined {
  const value = normalizedText(text);
  if (/^yes[.!]?$/iu.test(value)) return 'YES';
  if (/^no[.!]?$/iu.test(value)) return 'NO';
  if (/^1[.)]?$/u.test(value) || /^(ใช่|ใช่ค่ะ|ใช่ครับ|ถูกต้อง)$/u.test(value)) return 'YES';
  if (/^2[.)]?$/u.test(value) || /^ไม่ใช่/u.test(value)) return 'NO';
  return undefined;
}

/** §15: “ไม่ใช่ ใบอื่น” lists the other forms awaiting a scan instead of dropping the photo. */
export function substituteScanPickQuestion(scans: LineSubstituteMediaScan[], language: 'th' | 'en' = 'th'): string {
  if (language === 'en') return ['Which signed form is this? Reply with its position or document number.', ...scans.map(scan => `• ${scan.documentNumber} · ${scan.amountLabel}`)].join('\n');
  return [
    'ได้ค่ะ แล้วเป็นฟอร์มใบไหนคะ ตอบเลขข้อได้เลย',
    ...scans.map((scan, index) => `• ${scan.documentNumber} ยอด ${scan.amountLabel}`),
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

export function substituteMediaQuestion(choices: LineSubstituteMediaChoice[], language: 'th' | 'en' = 'th'): string {
  if (language === 'en') {
    const labels: Record<LineSubstituteMediaChoice, string> = { WET_SIGNED_SCAN: 'Signed form', SIGNATURE: 'My reusable signature', PAYMENT_EVIDENCE: 'Payment evidence for this expense', SUPPORTING_EVIDENCE: 'Supporting evidence for this expense', NEW_EXPENSE: 'New expense', NO_RECORD: 'Question only; do not record' };
    return ['What is this photo for? Reply with the option name or position.', ...choices.map(choice => `• ${labels[choice]}`)].join('\n');
  }
  return [
    'ได้รับรูปเข้ามาค่ะ ยังไม่แน่ใจว่าเป็นอะไร ตอบเลขข้อได้เลยนะคะ',
    ...choices.map((choice, index) => `• ${MEDIA_CHOICE_LABELS[choice]}`),
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
  fundingSource: 'แหล่งเงิน (จ่ายเต็มจำนวน)',
  paidInFullAcknowledged: 'ยืนยันจ่ายเต็มจำนวน',
  payerUserId: 'ผู้ดำเนินการจ่ายและรับรอง',
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
function bahtAmount(expense: { grandTotalAmount: string; currency: string }, language: 'th' | 'en' = 'th'): string {
  const amount = Number(expense.grandTotalAmount);
  return Number.isFinite(amount) && expense.currency === 'THB'
    ? `${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${language === 'en' ? 'THB' : 'บาท'}`
    : `${expense.grandTotalAmount} ${expense.currency}`;
}

/** M4: a LINE-captured draft has no `expenseNumber` yet, and a cuid tells the sender nothing they can
 *  match against the web list. Name it the way a person would — date · payee · amount — and keep the
 *  id out of the chat entirely; the card already carries the web link for anything more precise. */
function expenseLabel(expense: ExpenseRecordWithRelations, language: 'th' | 'en' = 'th'): string {
  if (expense.expenseNumber) return expense.expenseNumber;
  const date = expense.expenseDate instanceof Date
    ? expense.expenseDate.toLocaleDateString(language === 'en' ? 'en-GB' : 'th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    : undefined;
  const state = expense.sourceChannelMetadataJson?.lineSubstituteReceiptContinuation as LineSubstituteReceiptContinuation | undefined;
  const payeeName = expense.substituteReceiptEvidence?.status !== 'SUPERSEDED' && expense.substituteReceiptEvidence?.payeeName
    || state?.acceptedValues.payeeName || expense.vendorNameSnapshot;
  return [date, payeeName ?? undefined, bahtAmount(expense, language)].filter(Boolean).join(' · ');
}

/** Every echoed bullet shows a value the sender can recognise: no ids, no enum codes, no ISO dates. */
export function substituteReceiptFactLines(values: LineSubstituteReceiptValues, categories: Array<{ id: string; name: string }> = [], language: 'th' | 'en' = 'th'): string[] {
  if (language === 'en') {
    const labels: Record<string, string> = { fundingSource: 'Funding', paidInFullAcknowledged: 'Paid in full', reasonCode: 'Missing receipt reason', missingReceiptReason: 'Missing receipt details', businessPurpose: 'Purpose', payerUserId: 'Payer', payeeName: 'Payee', paymentDate: 'Payment date', paymentMethod: 'Payment method', itemDescription: 'Item', amount: 'Amount', expenseCategoryId: 'Expense category', evidenceNone: 'Evidence' };
    return Object.entries(values).filter(([, value]) => value != null && value !== '').map(([field, value]) => {
      const shown = field === 'fundingSource' ? value === 'COMPANY' ? 'Shop funds, paid in full' : 'Personal advance, paid in full'
        : field === 'paidInFullAcknowledged' ? value === true ? 'Acknowledged' : 'Not acknowledged'
          : field === 'payerUserId' ? 'You, the message sender' : field === 'evidenceNone' ? 'No supporting file'
            : field === 'expenseCategoryId' ? categories.find(item => item.id === value)?.name ?? 'Not selected'
              : field === 'paymentMethod' ? ({ CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', CARD: 'Card', CHEQUE: 'Cheque', OTHER: 'Other' } as Record<string, string>)[String(value)] ?? 'Not specified'
                : field === 'reasonCode' ? 'No receipt available; review the stated reason on the web'
                  : field === 'paymentDate' ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : String(value);
      return `${labels[field] ?? 'Detail'}: ${shown}`;
    });
  }
  return Object.entries(values).filter(([, value]) => value != null && value !== '').map(([field, value]) => {
    const shown = field === 'reasonCode' ? REASON_CODE_LABELS[value as SubstituteReceiptReasonCode]
      : field === 'fundingSource' ? (value === 'COMPANY' ? 'บริษัทจ่ายเต็มจำนวน' : 'พนักงานสำรองจ่ายเต็มจำนวน')
      : field === 'paidInFullAcknowledged' ? (value === true ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยันจ่ายเต็มจากแหล่งเดียว')
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
  needsWeb: '🌐 ต้องจัดการในเว็บ',
} as const;

/** §13: “รอไฟล์หลักฐาน” is only honest for a blocker a FILE clears. Every other non-collectable
 *  blocker — no eligible approver, tax evidence unreviewed, a zero total — is a setup problem the web
 *  owns, and sending the sender to hunt for a photo that does not exist is the wrong instruction. */
const FILE_BLOCKER_CODES = new Set(['supporting_evidence_required', 'payment_evidence_required']);

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
  language?: 'th' | 'en';
}): string | undefined {
  if (input.language === 'en') {
    if (input.status === 'FORBIDDEN') return 'Access required';
    if (input.status === 'INELIGIBLE') return 'Not eligible';
    if (['ISSUED', 'SUPERSEDED'].includes(input.evidenceStatus ?? '')) return 'Issued';
    if (input.evidenceStatus === 'PREPARED') return input.awaitingPaperSignature ? 'Awaiting signature' : 'Awaiting confirmation';
    if (input.evidenceStatus === 'PAYER_CERTIFIED') return 'Awaiting confirmation';
    if (['PAUSED', 'CANCELLED', 'STALE', 'TARGET_REQUIRED'].includes(input.status)) return undefined;
    return input.blockers?.length ? 'More information needed' : 'Ready to prepare';
  }
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
  if (blockers.some((item) => item.collectableInLine)) return `🟡 ยังขาดข้อมูล ${blockers.length} อย่าง`;
  return blockers.some((item) => FILE_BLOCKER_CODES.has(item.code))
    ? SUBSTITUTE_BADGES.awaitingFile
    : SUBSTITUTE_BADGES.needsWeb;
}

/** Replies emitted before a target exists (or without permission) keep formatResult's shape:
 *  what is understood → what is missing → boundary → VAT caveat → link → exactly one question. */
function formatStandalone(input: {
  language?: 'th' | 'en';
  echoed?: LineSubstituteReceiptValues;
  categories?: Array<{ id: string; name: string }>;
  headline: string;
  choices?: string[];
  question: string;
  webPath?: string;
  /** After a LINE prepare the default line is no longer true: LINE did prepare — and only prepare. */
  boundary?: string;
}): string {
  const language = input.language ?? 'th';
  const lines = [language === 'en' ? 'Substitute receipt' : '📄 ใบรับรองแทนใบเสร็จรับเงิน'];
  const echo = substituteReceiptFactLines(input.echoed ?? {}, input.categories ?? [], language);
  if (echo.length) lines.push(language === 'en' ? 'From your message (not saved yet):' : 'รับทราบจากข้อความนี้ (ยังไม่บันทึก):', ...echo);
  lines.push(input.headline);
  (input.choices ?? []).forEach((choice, index) => lines.push(`• ${choice}`));
  lines.push(input.boundary ?? (language === 'en' ? 'Sign and approve on the web; I will provide the link once the document is prepared.' : 'ลงนามและอนุมัติทำในเว็บค่ะ เตรียมใบรับรองเสร็จแล้วน้องจะส่งลิงก์ให้'));
  lines.push((language === 'en' ? 'This internal document is not a tax invoice and does not make input VAT claimable.' : 'เอกสารภายในนี้ไม่ใช่ใบกำกับภาษีและไม่ทำให้ VAT ซื้อเครดิตได้'));
  if (input.webPath) lines.push(`${language === 'en' ? 'Open on web' : 'เปิดในเว็บ'}: ${webLink(input.webPath)}`);
  lines.push('', `${language === 'en' ? 'Next' : 'ทำต่อ'}: ${input.question}`);
  return lines.join('\n');
}

/** The target exists but is not readable under the current permissions/branch scope: no workflow link,
 *  no pending question (nothing here is answerable in chat), just the expense list to check scope. */
function targetOutOfScope(companyId: string, webBaseUrl: string | undefined, headline: string, language: 'th' | 'en' = 'th'): LineSubstituteReceiptContinuationResult {
  return {
    handled: true, status: 'TARGET_REQUIRED', acceptedFields: [], blockers: [],
    replyText: formatStandalone({ language,
      headline,
      question: (language === 'en' ? 'Please open the expense list on the web to check your access and branch.' : 'เปิดรายการค่าใช้จ่ายในเว็บเพื่อตรวจสอบสิทธิ์และสาขาก่อนได้ไหมคะ?'),
      webPath: absoluteLink(webBaseUrl, `/companies/${companyId}/expenses`),
    }),
  };
}

function resumeCapsule(
  expense: ExpenseRecordWithRelations,
  state: LineSubstituteReceiptContinuation,
  acceptedFields: string[],
  webPath?: string,
  language: 'th' | 'en' = 'th',
): string {
  if (language === 'en') return [`Your substitute receipt for ${expenseLabel(expense, language)} is still open.`, ...(acceptedFields.length ? ['The details already collected are retained.'] : []), ...(webPath ? [`Open on web: ${webLink(webPath)}`] : [])].join('\n');
  const lines = [`↩️ งานใบรับรองแทนใบเสร็จรับเงินของรายการ ${expenseLabel(expense)} ยังอยู่`];
  if (acceptedFields.length) lines.push(`รับเพิ่มแล้ว: ${acceptedFields.map((field) => VALUE_LABELS[field] ?? field).join(', ')}`);
  if (state.pendingQuestion) lines.push(`ทำต่อ: ${state.pendingQuestion}`);
  else lines.push(`ยังมี ${state.missingFields.length} ช่องที่ตอบผ่าน LINE ได้; ส่งไฟล์หลักฐานเข้ามาในแชทนี้หรือแนบในเว็บก็ได้ ส่วนการลงนามและอนุมัติให้กดการ์ดยืนยันค่ะ`);
  if (webPath) lines.push(`เปิดในเว็บ: ${webLink(webPath)}`);
  return lines.join('\n');
}

function formatResult(input: {
  language?: 'th' | 'en';
  status: LineSubstituteReceiptContinuationResult['status'];
  expense: ExpenseRecordWithRelations;
  state: LineSubstituteReceiptContinuation;
  acceptedFields: string[];
  blockers: LineSubstituteReceiptBlocker[];
  webPath?: string;
  policy?: { configured: boolean; ready: boolean; approvalMode: 'OWNER_SELF' | 'DESIGNATED_APPROVERS' };
  sideAnswer?: string;
  /** Only the category question needs them; every other caller can leave this out. */
  categories?: Array<{ id: string; name: string }>;
  /** Decides choice 1's wording. Only looked up on a clean-preflight turn, so `false` here is also
   *  what every blocked turn passes — those never print the choices. */
  hasReusableSignature?: boolean;
}): string {
  const categories = input.categories ?? [];
  if (input.language === 'en') return formatEnglishResult(input);
  const lines = [
    '📄 ใบรับรองแทนใบเสร็จรับเงิน',
    `รายการ: ${expenseLabel(input.expense)}`,
    `ยอดปัจจุบัน: ${bahtAmount(input.expense)}`,
  ];
  if (input.acceptedFields.length) {
    if (input.acceptedFields.includes('expenseCategoryId')) {
      lines.push('เก็บหมวดไว้ในร่างแล้วค่ะ ตรวจข้อมูลก่อนกดเตรียมใบรับรอง', 'หมวดในรายการค่าใช้จ่ายยังไม่เปลี่ยนค่ะ');
    } else {
      lines.push(`✅ รับข้อมูลเข้าร่างแล้ว (ยังไม่แก้รายการ): ${input.acceptedFields.map((field) => VALUE_LABELS[field] ?? field).join(', ')}`);
    }
  }
  const facts = substituteReceiptFactLines(input.state.acceptedValues, categories);
  if (facts.length) lines.push('ตรวจข้อมูลสำหรับใบรับรองค่ะ:', ...facts);
  if (input.sideAnswer) lines.push('', input.sideAnswer);
  if (input.status === 'PAUSED') return [...lines, '⏸️ พักงานนี้ไว้แล้ว ข้อมูลที่รับไว้ยังอยู่', 'พิมพ์ “ทำใบรับรองต่อ” เพื่อกลับมาทำต่อ'].join('\n');
  if (input.status === 'CANCELLED') {
    return [...lines,
      '🛑 ยกเลิกเฉพาะขั้นตอนสนทนานี้แล้ว รายการค่าใช้จ่ายและไฟล์หลักฐานไม่ได้ถูกลบ',
      'ข้อมูลที่ตอบไว้ยังเก็บอยู่กับรายการนี้ พิมพ์ “ทำใบรับรองต่อ” เพื่อเริ่มใหม่โดยไม่ต้องตอบซ้ำได้ค่ะ'].join('\n');
  }
  // `webPath` is optional (FORBIDDEN results carry none), and the old template interpolated it
  // unguarded — a stale forbidden result printed "…ในเว็บ: undefined".
  if (input.status === 'STALE') {
    return [...lines, '⚠️ รายการถูกแก้ไขจากเว็บหรือผู้ใช้อื่น จึงไม่ได้นำข้อความล่าสุดไปทับข้อมูล',
      ...(input.webPath ? [`ตรวจสอบสถานะปัจจุบันในเว็บ: ${webLink(input.webPath)}`] : [])].join('\n');
  }
  if (input.blockers.length) {
    lines.push('', 'สิ่งที่ยังต้องทำทั้งหมด:');
    input.blockers.forEach((item) => lines.push(`• ${item.message}`));
  } else {
    lines.push('', '✅ ข้อมูลครบแล้ว พร้อมออกเอกสาร');
  }
  if (input.policy) {
    const source = input.policy.configured ? 'ตั้งค่าเฉพาะบริษัทแล้ว' : 'ใช้ค่าเริ่มต้นของระบบ';
    lines.push(`นโยบายอนุมัติ: ${input.policy.approvalMode === 'OWNER_SELF' ? 'เจ้าของอนุมัติเองได้' : 'ผู้อนุมัติที่บริษัทกำหนด'} · ${source} · ${input.policy.ready ? 'พร้อม' : 'ยังไม่พร้อม'}`);
  }
  lines.push('', 'ลงนามและอนุมัติทำในเว็บค่ะ เตรียมใบรับรองเสร็จแล้วน้องจะส่งลิงก์ให้');
  lines.push('เอกสารภายในนี้ไม่ใช่ใบกำกับภาษีและไม่ทำให้ VAT ซื้อเครดิตได้');
  if (input.webPath) lines.push(`เปิดตรวจสอบในเว็บ: ${webLink(input.webPath)}`);
  const nextQuestion = collectionQuestion(input.blockers, categories);
  if (nextQuestion) lines.push('', `ทำต่อ: ${nextQuestion}`);
  // R13: nothing is missing, so the single next question is whether to issue — and it is a question,
  // never an action already taken.
  else if (input.state.pendingDecision === 'ISSUE_CONFIRM') {
    lines.push('', `ทำต่อ: ${ISSUE_DECISION_QUESTION}`,
      ...issueDecisionChoices(input.hasReusableSignature === true).map((choice, index) => `• ${choice}`));
  }
  if (input.sideAnswer && input.state.status === 'OPEN') {
    lines.push(`กลับมาทำรายการ ${expenseLabel(input.expense)} ต่อได้เลย งานเดิมยังอยู่และยังขาด ${input.state.missingFields.length} ช่องที่ตอบผ่าน LINE ได้`);
  }
  return lines.join('\n');
}


function formatEnglishResult(input: Parameters<typeof formatResult>[0]): string {
  const lines = [`Substitute receipt: ${expenseLabel(input.expense, 'en')} · ${bahtAmount(input.expense, 'en')}`];
  if (input.acceptedFields.length) lines.push(input.acceptedFields.includes('expenseCategoryId')
    ? 'The category is held in the draft. Review the details before preparing the receipt. The expense category has not changed.'
    : 'Your details are held in the document draft; the expense itself has not been changed.');
  lines.push(...substituteReceiptFactLines(input.state.acceptedValues, input.categories ?? [], 'en'));
  if (input.sideAnswer) lines.push(input.sideAnswer);
  if (input.status === 'PAUSED') lines.push('This work is paused and the collected details are retained; say “resume substitute receipt” to continue.');
  else if (input.status === 'CANCELLED') lines.push('This conversation step was cancelled; your expense, files and collected details are retained.');
  else if (input.status === 'STALE') lines.push('The expense changed; your latest message was not applied over the newer details.');
  else {
    const descriptions: Record<string, string> = {
      expense_review_forbidden: 'Ask an authorized expense reviewer to continue.',
      expense_status_ineligible: 'This expense status does not allow a substitute receipt.',
      source_type_ineligible: 'This document type needs a different evidence route.',
      valid_receipt_normal_path: 'Use the existing valid receipt instead.',
      classification_ineligible: 'Review the source document classification on the web.',
      document_kind_ineligible: 'This document cannot use the substitute-receipt route.',
      currency_not_supported: 'This currency is not supported for substitute receipts.',
      active_substitute_evidence_exists: 'An active substitute receipt already exists.',
      payer_not_active_in_branch: 'The payer must be an active member of the expense branch.',
      designated_approver_not_ready: 'Set up an eligible approver for this branch on the web.',
      owner_self_approver_not_ready: 'An authorized expense approver is required for this branch.',
      substitute_prepare_failed: 'The document could not be prepared; review it on the web before trying again.',
      reusable_signature_required: 'Please send your signature photo here.',
    };
    for (const item of input.blockers) lines.push(questionFor(item.code, input.categories ?? [], 'en')
      ?? descriptions[item.code] ?? 'Review this expense and its evidence on the web before preparing the document.');
    if (!input.blockers.length) lines.push('The required details are complete; the document has not been issued.');
    if (input.policy) lines.push(`Approval: ${input.policy.approvalMode === 'OWNER_SELF' ? 'owner approval' : 'designated approvers'} · ${input.policy.ready ? 'ready' : 'setup required'}.`);
    if (!input.blockers.length && input.state.pendingDecision === 'ISSUE_CONFIRM')
      lines.push('Would you like to prepare the document now?', ...issueDecisionChoices(input.hasReusableSignature === true, 'en').map(choice => `• ${choice}`));
    lines.push('Sign and approve on the web; this internal document is not a tax invoice and does not make input VAT claimable.');
  }
  if (input.webPath) lines.push(`Open on web: ${webLink(input.webPath)}`);
  return lines.join('\n');
}

@Injectable()
export class LineSubstituteReceiptContinuationUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly prepare: PrepareSubstituteReceiptUseCase,
    private readonly audit: AuditService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly review: UpdateExpenseDraftUseCase,
  ) {}

  /** Re-read only the sources used by this reply; never run a workflow again to validate it. */
  async replySourcesCurrent(ctx: RequestContext, source: LineSubstituteReplySource | undefined): Promise<boolean> {
    if (!source || source.records.length > 5 || !ctx.permissions.includes('expense.review')) return false;
    for (const proof of source.records) {
      const expense = await this.repo.findByIdWithRelations(ctx.companyId, proof.id, undefined, ctx.scopes ?? {});
      if (!expense || expense.id !== proof.id || expense.companyId !== ctx.companyId || expense.updatedAt.toISOString() !== proof.revision
        || sourceHash(expense.substituteReceiptEvidence) !== proof.evidenceHash
        || sourceHash(attachmentSource(expense)) !== proof.attachmentsHash) return false;
    }
    if (source.categoriesHash && sourceHash(offeredCategories(await this.repo.listCategories(ctx.companyId))) !== source.categoriesHash) return false;
    if (source.signatureAvailable !== undefined
      && Boolean(await this.repo.findReusableSignatureAsset(ctx.companyId, ctx.userId)) !== source.signatureAvailable) return false;
    if (source.policy) {
      const { branchId, payerUserId, hash } = source.policy;
      const facts = await Promise.all([
        this.repo.getSubstituteReceiptPolicy(ctx.companyId),
        this.repo.listEligibleSubstituteReceiptApprovers(ctx.companyId, branchId),
        payerUserId ? this.repo.findActiveMemberIdentity(ctx.companyId, payerUserId, branchId) : Promise.resolve(null),
      ]);
      if (sourceHash(facts) !== hash) return false;
    }
    return true;
  }

  /** Starts the plain-language three-way decision immediately after LINE captures a check bill. */
  async startFromCheckBill(ctx: RequestContext, input: {
    expenseId: string;
    chatKeyHash: string;
    webBaseUrl?: string;
    language?: 'th' | 'en';
  }): Promise<LineSubstituteReceiptContinuationResult> {
    const language = input.language ?? ('messageText' in input && typeof input.messageText === 'string' ? lineReplyLanguage(input.messageText) : 'th');
    input = { ...input, language };
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, input.expenseId, undefined, ctx.scopes ?? {});
    if (!expense) throw new NotFoundException('Check-bill expense not found.');
    if (!ctx.permissions.includes('expense.review')) {
      return {
        handled: true, status: 'FORBIDDEN', expenseId: expense.id, acceptedFields: [], blockers: [],
        replyText: formatStandalone({ language,
          headline: (language === 'en' ? 'The bill was saved as a draft; ask an authorized expense reviewer to prepare a substitute receipt.' : '🧾 บันทึกเช็กบิลไว้เป็นร่างแล้ว แต่บัญชีนี้ยังไม่มีสิทธิ์จัดทำใบรับรองแทนใบเสร็จค่ะ'),
          question: (language === 'en' ? 'Please send the final receipt, or ask accounting to review this expense on the web.' : 'ส่งใบเสร็จฉบับสุดท้ายเข้ามา หรือให้ฝ่ายบัญชีเปิดรายการนี้เพื่อตรวจต่อได้เลยค่ะ'),
          webPath: absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/${expense.id}`),
        }),
      };
    }
    if (!isCheckBillClassification(expense.aiVerificationSummaryJson)) {
      throw new ConflictException('The expense is no longer classified as a check bill.');
    }
    const now = new Date().toISOString();
    const state: LineSubstituteReceiptContinuation = {
      workflowId: randomUUID(), kind: 'SUBSTITUTE_RECEIPT', companyId: ctx.companyId, userId: ctx.userId,
      expenseId: expense.id, chatKeyHash: input.chatKeyHash, status: 'OPEN', routeCheckBill: true,
      acceptedValues: {}, provenance: {}, resolvedFields: [], missingFields: [],
      attachmentRefs: expense.attachments.filter((item) => item.status === 'ACTIVE').map((item) => item.id).slice(0, 20),
      pendingQuestion: (language === 'en' ? 'Has this bill been paid, and is a final receipt available?' : CHECK_BILL_PAYMENT_QUESTION), pendingDecision: 'CHECK_BILL_PAYMENT',
      targetRevision: expense.updatedAt.toISOString(), lastActivityAt: now,
    };
    const saved = await this.repo.saveLineSubstituteContinuation({
      companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
      expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {}, continuation: state as unknown as Record<string, unknown>,
    });
    const next = saved.continuation as unknown as LineSubstituteReceiptContinuation;
    return {
      handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: next.workflowId, source: substituteReplySource(expense, saved.updatedAt),
      acceptedFields: [], blockers: [], pendingQuestion: (language === 'en' ? 'Has this bill been paid, and is a final receipt available?' : CHECK_BILL_PAYMENT_QUESTION),
      webPath: workflowLink(input.webBaseUrl, ctx.companyId, expense.id, next.workflowId),
      replyText: checkBillPaymentReply(expense.id, input.webBaseUrl, ctx.companyId, language),
    };
  }

  /** R14/§11: the open substitute work an arriving photo could belong to. `undefined` means this
   *  chat has none, and the media turn must behave exactly as it did before this existed. */
  async loadOpenMediaContext(ctx: RequestContext, chatKeyHash: string, language: 'th' | 'en' = 'th'): Promise<LineSubstituteMediaContext | undefined> {
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
        amountLabel: bahtAmount(expense, language),
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
    const finalReceiptExpected = states.some((state) => ACTIVE_STATUSES.has(state.status)
      && state.pendingDecision === 'CHECK_BILL_FINAL_RECEIPT');
    const newestActivity = (matches: (state: LineSubstituteReceiptContinuation) => boolean) => states
      .filter((state) => ACTIVE_STATUSES.has(state.status) && matches(state)).map((state) => state.lastActivityAt)
      .filter((at) => typeof at === 'string').sort().at(-1);
    const signatureRequestedAt = signatureRequested ? newestActivity((state) => state.signatureRequested === true) : undefined;
    const finalReceiptRequestedAt = finalReceiptExpected ? newestActivity((state) => state.pendingDecision === 'CHECK_BILL_FINAL_RECEIPT') : undefined;
    const paymentEvidenceRequestedAt = states.filter(state => state.status === 'OPEN').length === 1
      ? newestActivity(state => state.status === 'OPEN' && state.expenseId === expenseId && !state.signatureRequested
      && !state.pendingDecision && (state.missingFields.includes('evidenceNone')
        || state.pendingQuestion === QUESTIONS.payment_evidence_required)) : undefined;
    return { expenseId, awaitingScans, signatureRequested, finalReceiptExpected,
      ...(paymentEvidenceRequestedAt ? { paymentEvidenceRequestedAt } : {}),
      ...(signatureRequestedAt ? { signatureRequestedAt } : {}), ...(finalReceiptRequestedAt ? { finalReceiptRequestedAt } : {}) };
  }

  /** Closes the check-bill question after the webhook has attached and re-read a valid final receipt. */
  async completeCheckBillFinalReceipt(ctx: RequestContext, input: {
    expenseId: string;
    webBaseUrl?: string;
    language?: 'th' | 'en';
  }): Promise<{ replyText: string }> {
    const language = input.language ?? ('messageText' in input && typeof input.messageText === 'string' ? lineReplyLanguage(input.messageText) : 'th');
    input = { ...input, language };
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, input.expenseId, undefined, ctx.scopes ?? {});
    const state = expense && stateFromMetadata(expense.sourceChannelMetadataJson);
    if (!expense || !state || state.pendingDecision !== 'CHECK_BILL_FINAL_RECEIPT'
      || state.userId !== ctx.userId || state.companyId !== ctx.companyId) {
      throw new ConflictException('The check-bill final-receipt request is no longer open.');
    }
    await this.repo.saveLineSubstituteContinuation({
      companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
      expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {},
      continuation: {
        ...state, status: 'CONSUMED', pendingDecision: undefined, pendingQuestion: null,
      } as unknown as Record<string, unknown>,
    });
    return {
      replyText: formatStandalone({ language,
        headline: (language === 'en' ? 'The final receipt was attached to the existing expense without creating a duplicate.' : '✅ รับใบเสร็จฉบับสุดท้ายไว้ในรายการเดิมแล้วค่ะ ไม่ได้สร้างรายการซ้ำ'),
        question: (language === 'en' ? 'Please review the extracted details on the web and confirm when correct.' : 'เปิดตรวจข้อมูลที่ระบบอ่านได้ แล้วกดยืนยันเมื่อข้อมูลถูกต้องค่ะ'),
        webPath: absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/${expense.id}`),
      }),
    };
  }

  /** Resolve the pending workflow in this chat through the same scoped repository as continuation. */
  async pendingIssueDecisionExpenseId(ctx: RequestContext, chatKeyHash: string): Promise<string | undefined> {
    if (!ctx.permissions.includes('expense.review')) return undefined;
    const rows = await this.repo.listLineSubstituteContinuationRows({
      companyId: ctx.companyId, userId: ctx.userId, chatKeyHash, scopes: ctx.scopes ?? {}, take: 5,
    });
    return rows.find((row) => {
      const state = stateFromMetadata(row.sourceChannelMetadataJson);
      return !!state && ACTIVE_STATUSES.has(state.status) && state.pendingDecision === 'ISSUE_CONFIRM';
    })?.id;
  }

  async hasPendingIssueDecision(ctx: RequestContext, chatKeyHash: string): Promise<boolean> {
    return Boolean(await this.pendingIssueDecisionExpenseId(ctx, chatKeyHash));
  }

  /** §11/§14: a file the sender offered as evidence for the open work, attached under the purpose
   *  their caption or their numbered answer chose. Never called on a guess. */
  async attachMedia(ctx: RequestContext, input: {
    expenseId: string;
    attachmentId: string;
    purpose: 'expense.payment.evidence' | 'expense.receipt.supporting';
    webBaseUrl?: string;
    language?: 'th' | 'en';
  }): Promise<{ replyText: string; badge?: string }> {
    const language = input.language ?? ('messageText' in input && typeof input.messageText === 'string' ? lineReplyLanguage(input.messageText) : 'th');
    input = { ...input, language };
    if (!ctx.permissions.includes('expense.receipt.upload')) {
      throw new ForbiddenException('Missing permission: expense.receipt.upload');
    }
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, input.expenseId, undefined, ctx.scopes ?? {});
    const state = expense && stateFromMetadata(expense.sourceChannelMetadataJson);
    if (!expense || !state || state.userId !== ctx.userId || state.companyId !== ctx.companyId
      || state.expenseId !== input.expenseId || state.status !== 'OPEN'
      || expense.substituteReceiptEvidence && expense.substituteReceiptEvidence.status !== 'SUPERSEDED') throw new ForbiddenException();
    await this.repo.linkAttachment(input.expenseId, input.attachmentId, input.purpose, ctx.companyId, ctx.userId);
    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'attachment.upload',
      targetType: 'expense_record', targetId: input.expenseId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { source: 'LINE', purpose: input.purpose, attachmentId: input.attachmentId },
    });
    const payment = input.purpose === 'expense.payment.evidence';
    return {
      replyText: formatStandalone({ language,
        headline: payment
          ? (language === 'en' ? 'The file was attached as payment evidence for this expense.' : '📎 แนบเป็นหลักฐานการจ่ายเงินของรายการนี้แล้วค่ะ')
          : (language === 'en' ? 'The file was attached as supporting evidence for this expense.' : '📎 แนบเป็นหลักฐานประกอบของรายการนี้แล้วค่ะ'),
        boundary: (language === 'en' ? 'No signature, approval or document issuance was performed in LINE.' : 'LINE ยังไม่ได้ลงนาม อนุมัติ หรือออกเอกสาร'),
        question: (language === 'en' ? 'Say “resume substitute receipt” to check the current progress.' : 'พิมพ์ “ทำใบรับรองต่อ” เพื่อดูสถานะงานล่าสุดได้เลยค่ะ'),
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
    language?: 'th' | 'en';
  }): Promise<{ replyText: string; badge?: string }> {
    const language = input.language ?? ('messageText' in input && typeof input.messageText === 'string' ? lineReplyLanguage(input.messageText) : 'th');
    input = { ...input, language };
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
      badge: language === 'en' ? 'Awaiting confirmation' : SUBSTITUTE_BADGES.awaitingConfirmation,
      replyText: formatStandalone({ language,
        headline: [
          (language === 'en' ? `The signed form for ${linked.documentNumber} was attached as the paper original.` : `🔵 รอยืนยัน — รับฟอร์มที่เซ็นแล้วของเลขที่ ${linked.documentNumber} ไว้เป็นต้นฉบับลายเซ็นสดแล้วค่ะ`),
          (language === 'en' ? 'This photo does not issue the document; certify and approve on the web, and retain the original paper.' : 'รูปนี้ยังไม่ทำให้เอกสารออกค่ะ ต้องรับรองและอนุมัติในเว็บ และเก็บต้นฉบับกระดาษไว้'),
        ].join('\n'),
        boundary: (language === 'en' ? 'No signature, approval or document issuance was performed in LINE.' : 'LINE ยังไม่ได้ลงนาม อนุมัติ หรือออกเอกสาร'),
        question: (language === 'en' ? 'Open the link above to certify and approve on the web.' : 'เปิดลิงก์ด้านบนเพื่อรับรองและอนุมัติในเว็บได้เลยค่ะ'),
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
      ...(state.routeCheckBill ? { routeCheckBill: true as const } : {}),
      acceptedValues: { ...state.acceptedValues, paymentMethod: state.acceptedValues.paymentMethod ?? undefined },
    };
  }

  /**
   * Bounded READ-ONLY substitute context for the semantic router (substitute-semantic-routing spec §4).
   * Derived from the authoritative continuation rows; it performs NO write and grants NO authority —
   * `execute` re-reads the same rows authoritatively before any action. DATA only.
   */
  async substituteContext(ctx: RequestContext, input: { chatKeyHash: string; recentCandidateCount: number }): Promise<LineIntakeSubstituteContext> {
    const rows = await this.repo.listLineSubstituteContinuationRows({
      companyId: ctx.companyId, userId: ctx.userId, chatKeyHash: input.chatKeyHash, scopes: ctx.scopes ?? {}, take: 5,
    });
    const active = rows
      .map((row) => stateFromMetadata(row.sourceChannelMetadataJson))
      .filter((state): state is LineSubstituteReceiptContinuation => !!state && ACTIVE_STATUSES.has(state.status));
    const workflowState: LineIntakeSubstituteContext['workflowState'] =
      active.length === 0 ? 'none' : active.length > 1 ? 'multiple' : active[0].status === 'PAUSED' ? 'paused' : 'open';
    return {
      workflowState,
      hasPendingQuestion: active.some((state) => !!state.pendingQuestion),
      preparedState: active.length === 0 ? 'none' : 'in_progress',
      recentCandidateCount: Math.max(0, Math.min(input.recentCandidateCount, 5)),
    };
  }

  async execute(ctx: RequestContext, input: {
    messageText: string;
    chatKeyHash: string;
    recentCandidates: Array<{ id: string; label: string }>;
    /** Original ordered shortlist from a source-verified waiting question. */
    boundCandidateExpenseIds?: string[];
    webBaseUrl?: string;
    language?: 'th' | 'en';
    /** The PRIMARY semantic dispatcher sets this so a FRESH start driven by the model's route ALONE (a
     *  paraphrase matching none of the deterministic entry phrases) asks ONE bounded confirmation before it
     *  creates anything. Deterministic entries (canonical / vocabulary) and the OFF/legacy path leave it
     *  unset and open directly — preserving develop's start-on-entry behavior. */
    requireStartConfirmation?: boolean;
    /** The webhook sets this when the user AFFIRMATIVELY confirmed a pending substitute-start
     *  clarification, so a paraphrase-started workflow may now be created without the canonical phrase. */
    confirmedStart?: boolean;
    /** Supplied only by the verified signed action. */
    confirmedDecision?: 'ISSUE' | 'FORM';
  }): Promise<LineSubstituteReceiptContinuationResult> {
    const language = input.language ?? ('messageText' in input && typeof input.messageText === 'string' ? lineReplyLanguage(input.messageText) : 'th');
    input = { ...input, language };
    // R3: the permission a link needs is checked before any target is discovered, so no link is offered.
    if (!ctx.permissions.includes('expense.review')) {
      return {
        handled: true, status: 'FORBIDDEN', acceptedFields: [],
        badge: substituteReceiptBadge({ language, status: 'FORBIDDEN' }),
        blockers: [blocker('expense_review_forbidden', 'ไม่มีสิทธิ์ตรวจทานเพื่อจัดทำใบรับรองแทนใบเสร็จรับเงิน')],
        replyText: formatStandalone({ language,
          headline: (language === 'en' ? 'Ask an authorized expense reviewer to prepare the substitute receipt.' : 'จัดทำใบรับรองแทนใบเสร็จรับเงินต้องมีสิทธิ์ตรวจทานค่าใช้จ่าย (expense.review) ซึ่งบัญชีนี้ยังไม่มีค่ะ'),
          question: (language === 'en' ? 'Please ask your shop administrator for expense-review access.' : 'ขอสิทธิ์ตรวจทานค่าใช้จ่ายจากผู้ดูแลบริษัทก่อนได้ไหมคะ?'),
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
    let selection = ordinalSelection(input.messageText, Math.max(states.length, input.recentCandidates.length));
    const typedPick = lineWorkflowPickerText(input.messageText);
    if (selection === null && !typedPick.question && typedPick.documents.length) {
      const offered = await Promise.all(input.recentCandidates.slice(0, 5).map(candidate => this.repo.findByIdWithRelations(ctx.companyId, candidate.id, undefined, ctx.scopes ?? {})));
      const normalize = (text: string) => text.toLocaleLowerCase().replace(/\s+/gu, '');
      const matches = offered.flatMap((expense, index) => expense && typedPick.documents.every(document => [expense.expenseNumber, expense.vendorDocumentNumber]
        .some(number => number && normalize(number).includes(normalize(document)))) ? [index] : []);
      if (matches.length === 1) selection = matches[0]!;
    }
    const boundIds = input.boundCandidateExpenseIds;
    if (boundIds && (boundIds.length === 0 || boundIds.length > 5 || new Set(boundIds).size !== boundIds.length
      || JSON.stringify(boundIds) !== JSON.stringify(input.recentCandidates.map(item => item.id)))) {
      return targetOutOfScope(ctx.companyId, input.webBaseUrl, (language === 'en' ? 'The offered expenses changed; please check the current list on the web.' : 'รายการที่เคยให้เลือกเปลี่ยนแล้ว กรุณาเปิดตรวจรายการในเว็บค่ะ'), language);
    }
    const chosenId = boundIds?.[selection ?? (boundIds.length === 1 ? 0 : -1)]
      ?? (selection === null && states.length === 1 && boundIds?.includes(states[0]!.state.expenseId) ? states[0]!.state.expenseId : undefined);
    let selected = boundIds ? states.find(item => item.state.expenseId === chosenId)
      : states.length === 1 ? states[0] : selection !== null ? states[selection] : undefined;
    // A brand-new OPEN workflow (none → OPEN) is a real state transition that may persist even without an
    // accepted field value; an EXISTING workflow writes ONLY on an actual accepted change (below).
    let startedNew = false;

    if (!selected && states.length > 1 && !boundIds) {
      // The question is pending so the dispatcher keeps the clarification open and routes “1” back here.
      // candidateExpenseIds pins the offered shortlist so the ordinal binds to the SAME id next turn.
      const question = (language === 'en' ? 'Which pending expense would you like to continue? Reply with its position or name.' : 'ตอบหมายเลขงานที่ต้องการทำต่อค่ะ (เช่น “1”)');
      const choices = await Promise.all(states.map(item => this.repo.findByIdWithRelations(ctx.companyId, item.state.expenseId, undefined, ctx.scopes ?? {})));
      if (choices.some(item => !item)) return targetOutOfScope(ctx.companyId, input.webBaseUrl, (language === 'en' ? 'The pending work changed; please check it on the web.' : 'รายการงานที่ค้างเปลี่ยนแล้ว กรุณาเปิดตรวจรายการในเว็บค่ะ'), language);
      return {
        handled: true, status: 'TARGET_REQUIRED', acceptedFields: [], blockers: [], pendingQuestion: question,
        candidateExpenseIds: states.map((item) => item.state.expenseId),
        source: { records: choices.flatMap(item => substituteReplySource(item!).records) },
        replyText: formatStandalone({ language,
          headline: (language === 'en' ? 'More than one substitute receipt is pending; please choose the expense to continue.' : 'มีงานใบรับรองที่ยังค้างมากกว่า 1 รายการ ยังไม่ทราบว่าจะทำงานไหนต่อค่ะ'),
          choices: choices.map(item => `${expenseLabel(item!, language)}${item!.expenseNumber ? ` · ${bahtAmount(item!, language)}` : ''}`),
          question,
        }),
      };
    }

    if (!selected) {
      const candidateIndex = selection ?? (input.recentCandidates.length === 1 ? 0 : null);
      if (candidateIndex === null || !input.recentCandidates[candidateIndex]) {
        const hasChoices = input.recentCandidates.length > 0;
        // With no candidate the sender is not being sent away: the dispatcher carries this request
        // one turn, so the expense fact they type NEXT becomes the target. The web link on the card
        // below stays the other exit.
        const question = hasChoices
          ? (language === 'en' ? 'Which expense would you like? Reply with its position or name.' : 'ตอบหมายเลขรายการที่ต้องการค่ะ (เช่น “1”)')
          : (language === 'en' ? 'Please send the amount and expense details here, for example “taxi fare 50 baht”.' : 'พิมพ์ยอดและรายละเอียดค่าใช้จ่ายในแชทนี้ได้เลยค่ะ เช่น “ค่าวินมอไซค์ 50 บาท”');
        const categories = offeredCategories(await this.repo.listCategories(ctx.companyId));
        const choices = await Promise.all(input.recentCandidates.map(item => this.repo.findByIdWithRelations(ctx.companyId, item.id, undefined, ctx.scopes ?? {})));
        if (choices.some(item => !item)) return targetOutOfScope(ctx.companyId, input.webBaseUrl, (language === 'en' ? 'The selected expense changed; please check it on the web.' : 'รายการที่เลือกเปลี่ยนแล้ว กรุณาเปิดตรวจรายการในเว็บค่ะ'), language);
        return {
          handled: true,
          status: 'TARGET_REQUIRED',
          source: { records: choices.flatMap(item => substituteReplySource(item!).records), categoriesHash: sourceHash(categories) },
          // Nothing is persisted without a target, so the values are echoed back instead of dropped.
          replyText: formatStandalone({ language,
            echoed: extractValues(input.messageText, null, ctx.userId, categories),
            categories,
            headline: hasChoices
              ? (language === 'en' ? 'Please choose the expense for the substitute receipt.' : 'ยังไม่ทราบว่าจะทำใบรับรองให้รายการค่าใช้จ่ายไหนค่ะ')
              : (language === 'en' ? 'There is no matching expense in this chat yet; please send its amount and details.' : 'ยังไม่พบรายการค่าใช้จ่ายในแชทนี้ที่จะทำใบรับรองให้ค่ะ'),
            choices: choices.map(item => `${expenseLabel(item!, language)}${item!.expenseNumber ? ` · ${bahtAmount(item!, language)}` : ''}`),
            question,
            webPath: absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/substitute-receipts/new`),
          }),
          // Only a numbered choice stays pending; with no candidate the web link is the exit, so the
          // next unrelated message must not be captured as an answer.
          ...(hasChoices ? { pendingQuestion: question } : {}),
          acceptedFields: [], blockers: [],
          ...(input.recentCandidates.length > 0 ? { candidateExpenseIds: input.recentCandidates.map((item) => item.id) } : {}),
        };
      }
      const expenseId = input.recentCandidates[candidateIndex].id;
      const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId, undefined, ctx.scopes ?? {});
      if (!expense) return targetOutOfScope(ctx.companyId, input.webBaseUrl, (language === 'en' ? 'The selected expense is outside your current access or branch.' : 'รายการที่เลือกไม่อยู่ในสิทธิ์หรือสาขาปัจจุบันของคุณค่ะ'), language);
      // A prepared expense has a document number, a status and a page of its own; minting a fresh
      // OPEN state over it would wipe the provenance the consumed continuation still holds and ask
      // three questions that are already answered. Report the document instead, and write nothing.
      const live = expense.substituteReceiptEvidence;
      if (live && live.status !== 'SUPERSEDED') return this.existingEvidenceCard(ctx, input, expense, live);
      const now = new Date().toISOString();
      // A brand-new OPEN workflow (none → OPEN). The save gate below persists it whenever the start is
      // CONFIRMED (see startConfirmed): the deterministic OFF/legacy path opens DIRECTLY on selection — an
      // explicit canonical/vocabulary command, a webhook-confirmed affirmative, or any caller that is not
      // the PRIMARY model-only dispatcher (requireStartConfirmation !== true), exactly as parent develop
      // did. ONLY a PRIMARY model-only route that matches no deterministic entry must confirm first and
      // writes nothing until it does — never opening from the model's route confidence alone.
      startedNew = true;
      // M1: “ยกเลิก” ends the conversation step, not the answers — and the reply says so. The
      // cancelled state still holds them, so a fresh start on the same expense in the same chat picks
      // them back up instead of asking a shop owner eight questions they already answered.
      const cancelled = stateFromMetadata(expense.sourceChannelMetadataJson);
      const carried = cancelled?.status === 'CANCELLED' && cancelled.userId === ctx.userId
        && cancelled.chatKeyHash === input.chatKeyHash && cancelled.expenseId === expense.id
        ? cancelled
        : undefined;
      selected = {
        row: { id: expense.id, updatedAt: expense.updatedAt, sourceChannelMetadataJson: expense.sourceChannelMetadataJson },
        state: {
          workflowId: randomUUID(), kind: 'SUBSTITUTE_RECEIPT', companyId: ctx.companyId, userId: ctx.userId,
          expenseId: expense.id, chatKeyHash: input.chatKeyHash, status: 'OPEN',
          acceptedValues: carried?.acceptedValues ?? {}, provenance: carried?.provenance ?? {},
          resolvedFields: [], missingFields: [], attachmentRefs: [], pendingQuestion: null,
          targetRevision: expense.updatedAt.toISOString(), lastActivityAt: now,
        },
      };
    }

    const expense = await this.repo.findByIdWithRelations(ctx.companyId, selected.state.expenseId, undefined, ctx.scopes ?? {});
    if (!expense) return targetOutOfScope(ctx.companyId, input.webBaseUrl, (language === 'en' ? 'This expense is no longer within your current access or branch.' : 'รายการของงานนี้ไม่อยู่ในสิทธิ์หรือสาขาปัจจุบันของคุณแล้วค่ะ'), language);
    const webPath = workflowLink(input.webBaseUrl, ctx.companyId, expense.id, selected.state.workflowId);
    // A brand-new workflow (none → OPEN) may be CREATED only by an EXPLICIT start: a canonical command, a
    // DETERMINISTIC entry phrase develop's vocabulary already recognises (isSubstituteReceiptConversationText
    // — the “understand it as people phrase it” fix), OR a webhook-confirmed affirmative to a prior
    // substitute-start clarification. What it must NEVER open from is the SEMANTIC route's confidence alone:
    // a model-only paraphrase that matches none of those asks ONE bounded confirmation and writes NOTHING
    // (the webhook persists only an intake-ledger clarification). Permission is already gated at the top of
    // execute; an existing workflow needs no re-confirmation to continue.
    const explicitStart = isCanonicalSubstituteStart(input.messageText)
      || (isSubstituteReceiptConversationText(input.messageText) && !isSubstituteQueueQuestion(input.messageText))
      || input.confirmedStart === true;
    // A fresh start is CONFIRMED (safe to open AND to save) when it is explicit, OR when the caller is not
    // the PRIMARY model-only dispatcher (requireStartConfirmation !== true) — the OFF/legacy path and every
    // deterministic caller open on selection, exactly as parent develop did. ONLY the PRIMARY model-only
    // route (requireStartConfirmation === true) that is not otherwise explicit must confirm first. This is
    // the single source of truth for both the confirm-gate below and the save gate: an ordinal “1” selecting
    // a legacy candidate is a real start and must persist, not be re-asked forever.
    const startConfirmed = explicitStart || input.requireStartConfirmation !== true;
    if (startedNew && !startConfirmed) {
      const confirmQuestion = (language === 'en' ? 'Start preparing a substitute receipt for this expense? Reply “yes” to start or “no” to cancel.' : 'จะเริ่มทำใบรับรองแทนใบเสร็จรับเงินสำหรับรายการนี้ใช่ไหมคะ พิมพ์ “ใช่” เพื่อเริ่ม หรือ “ไม่” เพื่อยกเลิกค่ะ');
      return {
        handled: true, status: 'TARGET_REQUIRED', acceptedFields: [], blockers: [],
        replyText: confirmQuestion, pendingQuestion: confirmQuestion,
        expenseId: expense.id, candidateExpenseIds: [expense.id], source: substituteReplySource(expense),
      };
    }
    // Anchored NFC-safe controls: our natural “พัก … ใบรับรองแทนใบเสร็จ …”/English forms PLUS develop's
    // short forms and plain refusals (R15's “ไม่ทำต่อ” way out) — “ยังไม่ทำ”/“ไม่เอาแล้ว” stay out (no-op).
    const pause = isSubstitutePauseControl(input.messageText);
    const cancel = isSubstituteCancelControl(input.messageText);
    if (pause || cancel) {
      // Authoritative ELIGIBILITY ahead of the control save too (permission already gated above): a
      // hard-ineligible expense cannot have its substitute workflow mutated from LINE. This reuses the
      // same authoritative eligibility source the accept/save path uses, so no control bypasses it.
      const controlIssues = collectSubstituteReceiptEligibilityIssues(
        expense,
        selected.state.acceptedValues.reasonCode,
        { routeCheckBill: selected.state.routeCheckBill === true },
      );
      if (controlIssues.some((issue) => INELIGIBLE_CODES.has(issue.code))) {
        return {
          handled: true, status: 'INELIGIBLE', expenseId: expense.id, workflowId: selected.state.workflowId, source: substituteReplySource(expense),
          acceptedFields: [], blockers: controlIssues.map((issue) => blocker(issue.code, issue.message)), webPath,
          replyText: formatResult({ language, status: 'INELIGIBLE', expense, state: selected.state, acceptedFields: [], blockers: controlIssues.map((issue) => blocker(issue.code, issue.message)), webPath }),
        };
      }
      // Clear the decision: otherwise a paused “ready” workflow keeps pendingDecision, the taught resume
      // phrase falls into answerIssueDecision's non-answer branch, and a later “1” prepares straight out
      // of a PAUSED workflow. Resuming re-derives it cleanly. (DECLINE and EDIT keep it on purpose.)
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
      return { handled: true, status, expenseId: expense.id, workflowId: state.workflowId, source: substituteReplySource(expense, saved.updatedAt), acceptedFields: [], blockers: [], webPath,
        replyText: formatResult({ language, status, expense, state, acceptedFields: [], blockers: [], webPath }) };
    }
    if (selected.state.targetRevision !== expense.updatedAt.toISOString()) {
      return {
        handled: true, status: 'STALE', expenseId: expense.id, workflowId: selected.state.workflowId, source: substituteReplySource(expense),
        replyText: formatResult({ language, status: 'STALE', expense, state: selected.state, acceptedFields: [], blockers: [], webPath }),
        acceptedFields: [], blockers: [], webPath,
      };
    }

    // R15 (D6) short-circuits the whole turn: the sender may be describing a situation that calls
    // for a different document, so nothing is merged, nothing is decided, nothing is prepared, and
    // the stored state is left exactly as it was. The reply is the explanation and its one question;
    // “ทำต่อ” resumes with whatever was already pending, “ไม่ทำต่อ” pauses through the branch above.
    // It never reaches FORBIDDEN, PAUSED, CANCELLED or STALE turns — those all returned already.
    const wrongDocument = payeeCouldSignHeadline(input.messageText, language);
    if (wrongDocument) {
      return {
        handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: selected.state.workflowId, source: substituteReplySource(expense),
        acceptedFields: [], blockers: [], webPath, pendingQuestion: (language === 'en' ? 'Continue preparing the substitute receipt, or pause this work?' : PAYEE_COULD_SIGN_QUESTION),
        resumeCapsule: resumeCapsule(expense, selected.state, [], webPath, language),
        replyText: formatStandalone({ language, headline: wrongDocument, question: (language === 'en' ? 'Continue preparing the substitute receipt, or pause this work?' : PAYEE_COULD_SIGN_QUESTION), webPath }),
      };
    }

    const categories = offeredCategories(await this.repo.listCategories(ctx.companyId));
    if (selected.state.pendingDecision === 'CHECK_BILL_PAYMENT'
      || selected.state.pendingDecision === 'CHECK_BILL_FINAL_RECEIPT') {
      return this.answerCheckBillDecision(ctx, input, expense, selected.state);
    }
    // R13: the assistant asked whether to issue, so this turn is that answer. It runs before value
    // extraction, otherwise a bare “1” would be read as a stray value instead of a choice.
    const storedFactsChanged = (['missingReceiptReason', 'businessPurpose', 'payeeName', 'itemDescription'] as const)
      .some(field => selected.state.acceptedValues[field]
        && selected.state.acceptedValues[field] !== (freeTextOf(selected.state.acceptedValues[field]) ?? ''));
    // Old continuations may contain swallowed facts. Re-present the split text before any prepare.
    if (selected.state.pendingDecision === 'ISSUE_CONFIRM' && !storedFactsChanged) {
      const decided = await this.answerIssueDecision(ctx, input, expense, selected.state, categories);
      if (decided) return decided;
    }
    const pendingField = selected.state.missingFields[0] ?? null;
    const acceptedNow = extractValues(input.messageText, pendingField, ctx.userId, categories, selected.state.missingFields);
    const sideAnswer = groundedSideAnswer(expense, input.messageText, language);
    const acceptedValues = { ...selected.state.acceptedValues, ...acceptedNow };
    for (const field of ['missingReceiptReason', 'businessPurpose', 'payeeName', 'itemDescription'] as const) {
      if (acceptedValues[field]) acceptedValues[field] = freeTextOf(acceptedValues[field]) ?? '';
    }
    const acceptedFields = Object.keys(acceptedNow).filter(field => acceptedNow[field as keyof LineSubstituteReceiptValues] != null && acceptedNow[field as keyof LineSubstituteReceiptValues] !== '');
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
    const proposedCategory = acceptedValues.expenseCategoryId
      ? await this.repo.findCategoryById(ctx.companyId, acceptedValues.expenseCategoryId) : null;
    const categoryActive = proposedCategory?.companyId === ctx.companyId && proposedCategory.status === 'ACTIVE';
    const effectiveExpense = categoryActive ? { ...expense, expenseCategoryId: proposedCategory.id } : expense;
    const blockers = preflight(
      ctx,
      effectiveExpense,
      acceptedValues,
      policy,
      new Set(eligibleApprovers.map((item) => item.userId)),
      Boolean(payer),
      selected.state.routeCheckBill === true,
    );
    if (acceptedValues.expenseCategoryId && !categoryActive && !blockers.some(item => item.code === CATEGORY_BLOCKER)) {
      blockers.unshift(blocker(CATEGORY_BLOCKER, 'หมวดนี้ใช้ไม่ได้แล้วค่ะ เลือกหมวดที่ใช้งานอีกครั้ง', true));
    }
    const missingFields = blockers
      .filter((item) => item.collectableInLine)
      .map((item) => FIELD_BY_BLOCKER[item.code])
      .filter((field): field is keyof LineSubstituteReceiptValues => Boolean(field));
    const nextState: LineSubstituteReceiptContinuation = {
      ...selected.state,
      status: 'OPEN',
      acceptedValues,
      provenance,
      resolvedFields: Object.keys(acceptedValues).filter(field => acceptedValues[field as keyof LineSubstituteReceiptValues] != null && acceptedValues[field as keyof LineSubstituteReceiptValues] !== '').sort(),
      missingFields,
      attachmentRefs: expense.attachments.filter((item) => item.status === 'ACTIVE').map((item) => item.id).slice(0, 20),
      pendingQuestion: collectionQuestion(blockers, categories, language) ?? (blockers.length ? null : (language === 'en' ? 'Would you like to prepare the document now?' : ISSUE_DECISION_QUESTION)),
      // Set only while the preflight is clean: a value the user changes later reopens a blocker and
      // takes the decision back off the table until everything is answered again.
      pendingDecision: blockers.length ? undefined : 'ISSUE_CONFIRM',
      targetRevision: expense.updatedAt.toISOString(),
      lastActivityAt: acceptedAt,
    };
    const ineligible = blockers.some((item) => INELIGIBLE_CODES.has(item.code));
    const forbidden = blockers.some((item) => item.code === 'expense_review_forbidden');
    const hasAcceptedChange = Object.keys(acceptedNow).length > 0 || storedFactsChanged;
    // Permission/feature/eligibility/preflight rejection happens BEFORE any save: a FORBIDDEN or
    // INELIGIBLE turn writes nothing. A fresh OPEN is created whenever the start is CONFIRMED (see
    // startConfirmed — canonical/vocabulary/affirmative, or any non-PRIMARY-model-only caller such as the
    // OFF/legacy ordinal “1”); a PRIMARY model-only paraphrase already returned to confirm above and never
    // reaches here. An existing active workflow writes on an actual accepted change, a real STATUS
    // transition (a taught-phrase RESUME reopens PAUSED → OPEN — develop's F6), OR a pendingDecision
    // transition (the issue decision comes on/off the table). A pure question/negation/no-op on an
    // already-OPEN workflow changes none of these, so it leaves state untouched (zero save, zero revision).
    const statusChanged = selected.state.status !== nextState.status;
    const decisionChanged = selected.state.pendingDecision !== nextState.pendingDecision;
    let state = nextState;
    let producedRevision = expense.updatedAt;
    if (!forbidden && !ineligible && ((startedNew && startConfirmed) || hasAcceptedChange || statusChanged || decisionChanged)) {
      const saved = await this.repo.saveLineSubstituteContinuation({
        companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
        expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {}, continuation: nextState as unknown as Record<string, unknown>,
      });
      state = saved.continuation as unknown as LineSubstituteReceiptContinuation;
      producedRevision = saved.updatedAt;
    }
    const status = forbidden ? 'FORBIDDEN' as const : ineligible ? 'INELIGIBLE' as const : blockers.length ? 'BLOCKED' as const : 'READY_FOR_WEB' as const;
    const targetPath = forbidden
      ? undefined
      : ineligible
        ? absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/${expense.id}`)
        : workflowLink(input.webBaseUrl, ctx.companyId, expense.id, state.workflowId);
    const badge = substituteReceiptBadge({ language, status, blockers });
    // Only when the decision is about to be printed: choice 1 has to say whether it is one step or
    // two, and a blocked turn never shows the choices, so it pays for no lookup.
    const hasReusableSignature = state.pendingDecision === 'ISSUE_CONFIRM'
      && Boolean(await this.repo.findReusableSignatureAsset(ctx.companyId, ctx.userId));
    return {
      handled: true, status, workflowId: state.workflowId, expenseId: expense.id,
      source: { ...substituteReplySource(expense, producedRevision), categoriesHash: sourceHash(categories),
        policy: { branchId: expense.branchId ?? null, payerUserId: acceptedValues.payerUserId ?? null, hash: sourceHash([policyRow, eligibleApprovers, payer]) },
        ...(state.pendingDecision === 'ISSUE_CONFIRM' ? { signatureAvailable: hasReusableSignature } : {}),
      },
      acceptedFields, blockers, webPath: targetPath,
      ...(badge ? { badge } : {}),
      policy: policyFacts,
      sideQuestionAnswered: Boolean(sideAnswer),
      resumeCapsule: resumeCapsule(expense, state, acceptedFields, targetPath, language),
      ...(state.pendingQuestion ? { pendingQuestion: state.pendingQuestion } : {}),
      replyText: formatResult({ language, status, expense, state, acceptedFields, blockers, webPath: targetPath, policy: policyFacts, sideAnswer, categories, hasReusableSignature }),
    };
  }

  /**
   * The evidence already exists, so the conversation reports it instead of starting over. Nothing is
   * written to the continuation: the consumed state keeps the provenance of every value it collected.
   * The finished document and the unsigned form are downloaded from the web page this card points
   * at, never pushed into LINE.
   */
  private async existingEvidenceCard(
    ctx: RequestContext,
    input: { webBaseUrl?: string; language?: 'th' | 'en' },
    expense: ExpenseRecordWithRelations,
    evidence: { id: string; documentNumber: string; status: string; signatureMode: 'DIGITAL' | 'PAPER'; wetSignedScanAttachmentId: string | null },
  ): Promise<LineSubstituteReceiptContinuationResult> {
    const language = input.language ?? ('messageText' in input && typeof input.messageText === 'string' ? lineReplyLanguage(input.messageText) : 'th');
    input = { ...input, language };
    const webPath = absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/substitute-receipts/${evidence.id}`);
    const issued = evidence.status === 'ISSUED';
    // R10/§16: a PREPARED paper-route form with no signed scan yet is waiting for INK, not a web
    // sign-off. Reporting it as “🔵 รอยืนยัน · sign in web” sends a paper user to sign digitally (D9).
    //
    // `signatureMode` cannot answer that on its own: PAPER is written only when the wet-signed scan
    // is linked, so for the whole window between “ขอฟอร์มไปเซ็นเอง” and the photo arriving — exactly
    // the window this card is read in — it still says DIGITAL. What records the choice is the chat's
    // own `formRequested`, written by the prepare that consumed the continuation and never cleared;
    // `loadOpenMediaContext` already reads it the same way.
    const awaitingPaperSignature = evidence.status === 'PREPARED'
      && !evidence.wetSignedScanAttachmentId
      && (evidence.signatureMode === 'PAPER' || stateFromMetadata(expense.sourceChannelMetadataJson)?.formRequested === true);
    const badge = substituteReceiptBadge({ language, status: 'READY_FOR_WEB', evidenceStatus: evidence.status, awaitingPaperSignature });
    const amount = bahtAmount(expense, language);
    const headline = [
      `${language === 'en' ? (issued ? 'Issued' : awaitingPaperSignature ? 'Awaiting signature' : 'Awaiting confirmation') : issued ? '✅ ออกเอกสารแล้ว' : awaitingPaperSignature ? '🖊️ รอลงนาม' : '🔵 รอยืนยัน'} — ${evidence.documentNumber}`,
      `${language === 'en' ? 'Expense' : 'รายการ'} ${expenseLabel(expense, language)} · ${language === 'en' ? 'Amount' : 'ยอด'} ${amount}`,
      issued
        ? (language === 'en' ? 'The document has been issued.' : 'เอกสารออกเรียบร้อยแล้ว')
        : awaitingPaperSignature
          ? (language === 'en' ? 'The unsigned form has a watermark; print and sign it, then send a photo here.' : 'แบบฟอร์มรอลงนามมีลายน้ำ UNSIGNED — พิมพ์แล้วเซ็นด้วยมือ แล้วถ่ายส่งกลับมาในแชทนี้')
          : (language === 'en' ? 'The document has been prepared and numbered; certification and approval remain on the web.' : 'เตรียมและจองเลขที่ไว้แล้วค่ะ เหลือลงนามรับรองและอนุมัติในเว็บ'),
    ];
    return {
      handled: true, status: 'READY_FOR_WEB', expenseId: expense.id, acceptedFields: [], blockers: [], webPath, source: substituteReplySource(expense),
      ...(badge ? { badge } : {}),
      replyText: formatStandalone({ language,
        headline: headline.join('\n'),
        boundary: issued ? (language === 'en' ? 'The document has been issued.' : 'เอกสารออกเรียบร้อยแล้วค่ะ') : (language === 'en' ? 'Signature and approval are still required on the web.' : 'ยังรอลงนามและอนุมัติค่ะ'),
        question: issued
          ? (language === 'en' ? 'Open the link above to download the issued document.' : 'เปิดหน้าเว็บด้านบนเพื่อดาวน์โหลดเอกสารที่ออกแล้วได้เลยค่ะ')
          : awaitingPaperSignature
            ? (language === 'en' ? 'Open the link above to download the unsigned form, print and sign it, then send a photo here.' : 'เปิดหน้าเว็บด้านบน กดดาวน์โหลด “แบบฟอร์มรอลงนาม” พิมพ์แล้วเซ็นด้วยมือ แล้วถ่ายส่งกลับมาในแชทนี้ได้เลยค่ะ')
            : (language === 'en' ? 'Open the link above to sign, certify and approve on the web.' : 'เปิดลิงก์ด้านบนเพื่อลงนามรับรองและอนุมัติในเว็บได้เลยค่ะ'),
        webPath,
      }),
    };
  }

  private async answerCheckBillDecision(
    ctx: RequestContext,
    input: {
      messageText: string;
      chatKeyHash: string;
      recentCandidates: Array<{ id: string; label: string }>;
      webBaseUrl?: string;
    language?: 'th' | 'en';
      requireStartConfirmation?: boolean;
      confirmedStart?: boolean;
      confirmedDecision?: 'ISSUE' | 'FORM';
    },
    expense: ExpenseRecordWithRelations,
    state: LineSubstituteReceiptContinuation,
  ): Promise<LineSubstituteReceiptContinuationResult> {
    const language = input.language ?? ('messageText' in input && typeof input.messageText === 'string' ? lineReplyLanguage(input.messageText) : 'th');
    input = { ...input, language };
    const choice = checkBillPaymentChoice(input.messageText);
    const webPath = workflowLink(input.webBaseUrl, ctx.companyId, expense.id, state.workflowId);
    if (!choice) {
      const waitingForPhoto = state.pendingDecision === 'CHECK_BILL_FINAL_RECEIPT';
      return {
        handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: state.workflowId, source: substituteReplySource(expense),
        acceptedFields: [], blockers: [],
        pendingQuestion: waitingForPhoto ? (language === 'en' ? 'Please send the final receipt photo here.' : 'ส่งรูปใบเสร็จฉบับสุดท้ายเข้ามาในแชทนี้ได้เลยค่ะ') : (language === 'en' ? 'Has this bill been paid, and is a final receipt available?' : CHECK_BILL_PAYMENT_QUESTION),
        webPath,
        replyText: waitingForPhoto
          ? formatStandalone({ language,
              headline: (language === 'en' ? 'I am waiting for the final receipt photo for this expense.' : '📷 รอรูปใบเสร็จฉบับสุดท้ายของรายการนี้อยู่ค่ะ'),
              question: (language === 'en' ? 'Send the photo here, or reply “1” to prepare a substitute receipt if no receipt is available.' : 'ส่งรูปเข้ามาได้เลย หรือถ้าไม่มีใบเสร็จแล้ว ตอบ 1 เพื่อทำใบรับรองแทนใบเสร็จค่ะ'),
              webPath,
            })
          : checkBillPaymentReply(expense.id, input.webBaseUrl, ctx.companyId, language),
      };
    }
    if (choice === 'UNPAID') {
      const saved = await this.repo.saveLineSubstituteContinuation({
        companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
        expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {},
        continuation: {
          ...state, status: 'CONSUMED', pendingDecision: undefined, pendingQuestion: null,
        } as unknown as Record<string, unknown>,
      });
      return {
        handled: true, status: 'PAUSED', expenseId: expense.id, workflowId: state.workflowId, source: substituteReplySource(expense, saved.updatedAt),
        acceptedFields: [], blockers: [],
        replyText: formatStandalone({ language,
          headline: (language === 'en' ? 'The expense remains a draft and has not been marked paid.' : '⏸️ เก็บรายการนี้เป็นฉบับร่างไว้แล้วค่ะ ยังไม่บันทึกว่าเป็นค่าใช้จ่ายที่จ่ายแล้ว'),
          question: (language === 'en' ? 'After payment, send the final receipt or mark the expense paid on the web.' : 'หลังจ่ายเงิน ส่งใบเสร็จฉบับสุดท้ายเข้ามา หรือเปิดรายการนี้แล้วเลือก “จ่ายแล้ว” ได้ค่ะ'),
          webPath: absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/${expense.id}`),
        }),
      };
    }
    if (choice === 'FINAL_RECEIPT') {
      const saved = await this.repo.saveLineSubstituteContinuation({
        companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
        expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {},
        continuation: {
          ...state, status: 'OPEN', pendingDecision: 'CHECK_BILL_FINAL_RECEIPT',
          pendingQuestion: (language === 'en' ? 'Please send the final receipt photo here.' : 'ส่งรูปใบเสร็จฉบับสุดท้ายเข้ามาในแชทนี้ได้เลยค่ะ'),
        } as unknown as Record<string, unknown>,
      });
      const next = saved.continuation as unknown as LineSubstituteReceiptContinuation;
      return {
        handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: next.workflowId, source: substituteReplySource(expense, saved.updatedAt),
        acceptedFields: [], blockers: [], pendingQuestion: next.pendingQuestion ?? undefined, webPath,
        replyText: formatStandalone({ language,
          headline: (language === 'en' ? 'The final receipt will replace the primary evidence on the existing expense.' : '📷 ได้เลยค่ะ ระบบจะใช้ใบเสร็จฉบับสุดท้ายแทนหลักฐานหลักในรายการเดิม'),
          question: (language === 'en' ? 'Please send the final receipt photo here.' : 'ส่งรูปใบเสร็จฉบับสุดท้ายเข้ามาในแชทนี้ได้เลยค่ะ'),
          webPath,
        }),
      };
    }
    const acceptedAt = new Date().toISOString();
    const acceptedValues: LineSubstituteReceiptValues = {
      ...state.acceptedValues,
      reasonCode: 'RECEIPT_UNAVAILABLE',
      missingReceiptReason: (language === 'en' ? 'Paid, but the seller did not provide a final receipt' : 'ชำระแล้วแต่ร้านไม่ออกใบเสร็จฉบับสุดท้าย'),
    };
    await this.repo.saveLineSubstituteContinuation({
      companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
      expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {},
      continuation: {
        ...state,
        status: 'OPEN', acceptedValues,
        provenance: {
          ...state.provenance,
          reasonCode: { source: 'LINE_USER_TEXT', acceptedAt, messageHash: messageHash(input.messageText) },
          missingReceiptReason: { source: 'LINE_USER_TEXT', acceptedAt, messageHash: messageHash(input.messageText) },
        },
        resolvedFields: [...new Set([...state.resolvedFields, 'reasonCode', 'missingReceiptReason'])].sort(),
        pendingDecision: undefined, pendingQuestion: null,
      } as unknown as Record<string, unknown>,
    });
    return this.execute(ctx, {
      ...input,
      messageText: 'ทำใบรับรองต่อ',
      requireStartConfirmation: false,
      confirmedStart: true,
    });
  }

  /** R13 answer handling. `undefined` means "not an answer to this question, but it does carry
   *  values" — the normal collect-and-re-ask path owns those, so a correction is never lost. */
  private async answerIssueDecision(
    ctx: RequestContext,
    input: { messageText: string; webBaseUrl?: string; language?: 'th' | 'en'; confirmedDecision?: 'ISSUE' | 'FORM' },
    expense: ExpenseRecordWithRelations,
    state: LineSubstituteReceiptContinuation,
    categories: Array<{ id: string; name: string }>,
  ): Promise<LineSubstituteReceiptContinuationResult | undefined> {
    const language = input.language ?? lineReplyLanguage(input.messageText);
    // A message carrying values is a correction, not a decision — even when it also contains an
    // action word (“แก้วัตถุประสงค์: ไปพบลูกค้า” names both). Read first so the collect path owns it
    // and nothing the sender typed is dropped for the sake of a word match.
    if (Object.keys(extractValues(input.messageText, null, ctx.userId, categories)).length > 0) return undefined;
    const choice = input.confirmedDecision ?? issueDecisionChoice(input.messageText);
    const webPath = workflowLink(input.webBaseUrl, ctx.companyId, expense.id, state.workflowId);
    if (!choice) {
      // §15: a question asked while the decision is open is still answered from source state, and the
      // capsule reminds the sender what is waiting — otherwise the dispatcher deflects to a general
      // AI turn and this work drops out of the conversation.
      const sideAnswer = groundedSideAnswer(expense, input.messageText, language);
      // No word list covers every way a person says yes, so the unmatched case has to be USEFUL: show
      // the three choices again — re-derived from the CURRENT state, never a fixed list — and ask for
      // a number. That, not a longer list, is what keeps an unexpected phrasing from dead-ending.
      const signature = await this.repo.findReusableSignatureAsset(ctx.companyId, ctx.userId);
      return {
        handled: true, status: 'READY_FOR_WEB', expenseId: expense.id, workflowId: state.workflowId,
        source: { ...substituteReplySource(expense), signatureAvailable: Boolean(signature) },
        acceptedFields: [], blockers: [], pendingQuestion: (language === 'en' ? 'Would you like to prepare the document now?' : ISSUE_DECISION_QUESTION), webPath,
        ...(sideAnswer ? { sideQuestionAnswered: true } : {}),
        // S1: nothing in this message answers the open decision. The dispatcher needs that fact —
        // an open decision must not swallow the sender's next unrelated sentence.
        decisionUnread: true,
        resumeCapsule: resumeCapsule(expense, state, [], webPath, language),
        replyText: formatStandalone({ language,
          headline: sideAnswer
            ? `${sideAnswer}\n\n${language === 'en' ? 'The details are complete; choose the next step.' : 'ข้อมูลครบแล้ว รอเลือกว่าจะทำอะไรต่อค่ะ'}`
            // The pause escape is repeated here, not only in the first decline reply: this is the
            // reply a sender sees over and over when their phrasing keeps missing the word list, and
            // "how do I stop being asked" must be answerable from the message doing the asking.
            : (language === 'en' ? 'Choose an option below, or say “pause” to pause this work.' : 'ยังไม่แน่ใจว่าจะให้ทำอะไรต่อค่ะ เลือกจาก 3 ข้อนี้ ตอบเลขข้อได้เลย หรือพิมพ์ “พัก” เพื่อพักงานนี้ไว้'),
          choices: issueDecisionChoices(Boolean(signature), language),
          question: (language === 'en' ? 'Would you like to prepare the document now?' : ISSUE_DECISION_QUESTION),
        }),
      };
    }
    if (choice === 'DECLINE') {
      // M5: “บอกได้ตลอดเมื่อพร้อม” is only true while the next “ออกเอกสารเลย” is still heard, so the
      // decision stays pending — it reserves nothing — and the invitation IS the pending question,
      // which is what keeps this chat's clarification open for that answer to land in.
      const question = (language === 'en' ? 'Say “prepare the document” when ready, or “pause” to pause this work.' : 'พร้อมเมื่อไหร่ พิมพ์ “ออกเอกสารเลย” ได้ตลอดค่ะ หรือพิมพ์ “พัก” เพื่อพักงานนี้ไว้');
      const saved = await this.repo.saveLineSubstituteContinuation({
        companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
        expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {},
        continuation: { ...state, pendingQuestion: question } as unknown as Record<string, unknown>,
      });
      const next = saved.continuation as unknown as LineSubstituteReceiptContinuation;
      return {
        handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: next.workflowId, source: substituteReplySource(expense, saved.updatedAt),
        acceptedFields: [], blockers: [], pendingQuestion: question,
        webPath: workflowLink(input.webBaseUrl, ctx.companyId, expense.id, next.workflowId),
        resumeCapsule: resumeCapsule(expense, next, [], workflowLink(input.webBaseUrl, ctx.companyId, expense.id, next.workflowId), language),
        replyText: formatStandalone({ language,
          headline: (language === 'en' ? 'The document has not been issued or numbered; your work remains open and the collected details are retained.' : 'รับทราบค่ะ ยังไม่ออกเอกสารและยังไม่ได้จองเลขที่ งานนี้ยังเปิดอยู่ ข้อมูลที่รับไว้ยังอยู่ครบ'),
          question,
          webPath: workflowLink(input.webBaseUrl, ctx.companyId, expense.id, next.workflowId),
        }),
      };
    }
    if (choice === 'EDIT') {
      // M3: the field list used to be NUMBERED and the numbers did nothing — answering “3” bounced
      // straight back to the issue question. There is nothing to number here (a field is edited by
      // naming it), so the labels are listed plainly and the example shows the shape of an answer.
      // The decision deliberately stays pending: 1/2/3 keep working as the way out, and a labelled
      // value still reaches the collect path through the values-first check above.
      const question = (language === 'en' ? 'Which detail would you like to change? Send its label and new value, such as “purpose: customer visit”.' : 'จะแก้ช่องไหนคะ? พิมพ์ชื่อช่องแล้วตามด้วยค่าใหม่ เช่น “วัตถุประสงค์: ไปพบลูกค้า”');
      const saved = await this.repo.saveLineSubstituteContinuation({
        companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
        expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {},
        continuation: { ...state, pendingQuestion: question } as unknown as Record<string, unknown>,
      });
      const next = saved.continuation as unknown as LineSubstituteReceiptContinuation;
      return {
        handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: next.workflowId, source: substituteReplySource(expense, saved.updatedAt),
        acceptedFields: [], blockers: [], pendingQuestion: question,
        webPath: workflowLink(input.webBaseUrl, ctx.companyId, expense.id, next.workflowId),
        replyText: formatStandalone({ language,
          headline: language === 'en' ? 'Send the field label and new value for the funding source, receipt reason, purpose, payer, payee, payment method, payment date or category.' : [
            'แก้ได้เลยค่ะ ช่องที่แก้ผ่าน LINE ได้:',
            ...EDITABLE_FIELD_HINTS.map(([field, hint]) => `• ${VALUE_LABELS[field] ?? field} — เช่น “${hint}”`),
            'ถ้าเปลี่ยนใจ ตอบ 1 เพื่อออกเอกสาร หรือ 2 เพื่อขอฟอร์มไปเซ็นเองได้เลย',
          ].join('\n'),
          question,
          webPath: workflowLink(input.webBaseUrl, ctx.companyId, expense.id, next.workflowId),
        }),
      };
    }
    if (!input.confirmedDecision) {
      return {
        handled: true, status: 'READY_FOR_WEB', expenseId: expense.id, workflowId: state.workflowId,
        source: substituteReplySource(expense), decisionOffered: choice,
        acceptedFields: [], blockers: [], webPath,
        replyText: language === 'en' ? 'Review the details and press the preparation button.' : 'ตรวจข้อมูลแล้วกดปุ่มเตรียมเอกสารได้ค่ะ',
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
    input: { webBaseUrl?: string; language?: 'th' | 'en' },
    expense: ExpenseRecordWithRelations,
    state: LineSubstituteReceiptContinuation,
  ): Promise<LineSubstituteReceiptContinuationResult> {
    const language = input.language ?? ('messageText' in input && typeof input.messageText === 'string' ? lineReplyLanguage(input.messageText) : 'th');
    input = { ...input, language };
    // A3: written once, so the photo that arrives next has a numbered choice that can become a
    // signature. Best-effort by design — a stale-revision refusal here must not swallow the ask
    // itself, and `loadOpenMediaContext` re-checks the live signature anyway.
    let producedRevision = expense.updatedAt;
    if (state.signatureRequested !== true) {
      try {
        const saved = await this.repo.saveLineSubstituteContinuation({
          companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
          expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {},
          continuation: { ...state, signatureRequested: true } as unknown as Record<string, unknown>,
        });
        producedRevision = saved.updatedAt;
      } catch {
        // Left unrecorded: the sender still gets the ask, and the caption route still works.
      }
    }
    const question = (language === 'en' ? 'Please send your signature photo here.' : 'ส่งรูปลายเซ็นเข้ามาในแชทนี้ได้เลยค่ะ');
    const signatureBlocker = blocker('reusable_signature_required', 'ยังไม่มีลายเซ็นที่บันทึกไว้', true);
    return {
      handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: state.workflowId,
      source: { ...substituteReplySource(expense, producedRevision), signatureAvailable: false },
      acceptedFields: [],
      badge: substituteReceiptBadge({ language, status: 'BLOCKED', blockers: [signatureBlocker] }),
      blockers: [signatureBlocker],
      // The decision stays pending and nothing is written, so “1” after the photo lands here again.
      pendingQuestion: question,
      webPath: workflowLink(input.webBaseUrl, ctx.companyId, expense.id, state.workflowId),
      replyText: formatStandalone({ language,
        headline: [
          (language === 'en' ? 'No saved signature is available yet.' : 'ยังไม่มีลายเซ็นที่บันทึกไว้ในระบบค่ะ'),
          (language === 'en' ? 'Sign on white paper and send a clear photo of the whole signature here.' : 'เซ็นบนกระดาษขาว ถ่ายให้เห็นเต็มลายเซ็น แล้วส่งรูปเข้ามาในแชทนี้'),
          (language === 'en' ? 'Your signature can be saved for reuse without uploading it for every document.' : 'ระบบจะเก็บเป็นลายเซ็นประจำตัว ใช้ได้ทันทีและใช้ซ้ำได้ทุกใบ ไม่ต้องส่งอีก'),
        ].join('\n'),
        question,
      }),
    };
  }

  /** R7 from the conversation: prepare with the values the preflight already cleared, then hand the
   *  work to the one web page where certification and approval happen. */
  private async prepareFromLine(
    ctx: RequestContext,
    input: { webBaseUrl?: string; language?: 'th' | 'en' },
    expense: ExpenseRecordWithRelations,
    state: LineSubstituteReceiptContinuation,
    choice: 'ISSUE' | 'FORM',
  ): Promise<LineSubstituteReceiptContinuationResult> {
    const language = input.language ?? ('messageText' in input && typeof input.messageText === 'string' ? lineReplyLanguage(input.messageText) : 'th');
    input = { ...input, language };
    const values = state.acceptedValues;
    const active = expense.attachments.filter((item) => item.status === 'ACTIVE');
    const paymentEvidenceAttachmentIds = active.filter((item) => item.purpose === 'expense.payment.evidence').map((item) => item.id);
    // Same split the web wizard uses. `expense.review.evidence` is the system's own output — the
    // certified/issued SVG of a superseded version and its signature renders — so linking it back in
    // would print the previous certificate as supporting evidence for its own replacement.
    const supportingAttachmentIds = active
      .filter((item) => item.purpose !== 'expense.payment.evidence' && item.purpose !== 'expense.review.evidence')
      .map((item) => item.id);
    let categoryCommitted = false;
    try {
      if (values.expenseCategoryId) {
        const category = await this.repo.findCategoryById(ctx.companyId, values.expenseCategoryId);
        if (!category || category.companyId !== ctx.companyId || category.status !== 'ACTIVE') {
          const webPath = absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/${expense.id}`);
          return { handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: state.workflowId,
            source: substituteReplySource(expense), acceptedFields: [],
            blockers: [blocker(CATEGORY_BLOCKER, 'หมวดนี้ใช้ไม่ได้แล้วค่ะ เปิดค่าใช้จ่ายเพื่อเลือกหมวดที่ใช้งานแล้วลองอีกครั้ง')], webPath,
            replyText: `${language === 'en' ? 'This category is no longer available. Open the expense to choose an active category and try again.' : 'หมวดนี้ใช้ไม่ได้แล้วค่ะ เปิดค่าใช้จ่ายเพื่อเลือกหมวดที่ใช้งานแล้วลองอีกครั้ง'}\n${webLink(webPath)}` };
        }
        const saved = await this.repo.saveLineSubstituteContinuation({
          companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
          expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {},
          continuation: state as unknown as Record<string, unknown>, expenseCategoryId: category.id,
        });
        categoryCommitted = true;
        state = saved.continuation as unknown as LineSubstituteReceiptContinuation;
        const updated = await this.repo.findByIdWithRelations(ctx.companyId, expense.id);
        if (!updated || updated.updatedAt.getTime() !== saved.updatedAt.getTime()) throw new ConflictException('Expense changed after category confirmation');
        expense = updated;
      }
      // This path is reached only after an explicit, revision-bound ISSUE/FORM answer.
      // Use the same permission-checked review use case as the web; a chat capture is not a review.
      const reviewResult = await this.review.execute(ctx, expense.id, {
        expectedUpdatedAt: expense.updatedAt.toISOString(),
        // Paid check-bill continuation is an explicit user decision, still requiring
        // separate payment proof in preflight/prepare. OCR alone cannot take this route.
        sourceDocumentType: state.routeCheckBill && expense.sourceDocumentType === 'NEEDS_REVIEW'
          ? 'OTHER_EXPENSE_DOCUMENT' : expense.sourceDocumentType,
        taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE',
        evidenceAssessment: { route: 'SUBSTITUTE_RECEIPT',
          receiptProblem: values.reasonCode === 'RECEIPT_MATERIALLY_INCOMPLETE' ? 'MATERIAL_INCOMPLETE'
            : values.reasonCode === 'RECEIPT_UNAVAILABLE' ? 'LOST' : 'NOT_AVAILABLE',
          attachmentIds: [...paymentEvidenceAttachmentIds, ...supportingAttachmentIds],
          reason: values.missingReceiptReason ?? storedMissingReceiptReason(expense) ?? '',
        },
        documentReviewAcknowledged: true,
      }, { requireExpectedUpdatedAt: true });
      const reviewed = await this.repo.findByIdWithRelations(ctx.companyId, expense.id);
      if (!reviewed) throw new NotFoundException();
      if (reviewed.updatedAt.getTime() !== reviewResult.updatedAt.getTime()) throw new ConflictException('Expense changed after review');
      // Rebind only the decision we just reviewed. A concurrent edit fails this CAS instead of
      // silently applying the older chat answers to a newer expense.
      const rebound = await this.repo.saveLineSubstituteContinuation({
        companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
        expectedUpdatedAt: reviewed.updatedAt, scopes: ctx.scopes ?? {},
        continuation: state as unknown as Record<string, unknown>,
      });
      state = rebound.continuation as unknown as LineSubstituteReceiptContinuation;
      expense = { ...reviewed, updatedAt: rebound.updatedAt };
      const evidence = await this.prepare.execute(ctx, expense.id, {
        // The preflight was clean, so every required value is present; prepare re-validates anyway
        // and any gap comes back as the degraded reply below rather than an exception.
        reasonCode: values.reasonCode!,
        // B2: never the capture-time marker. The preflight already refuses to treat it as an answer,
        // so this fallback only ever sees a reason a person wrote — in the web or in this chat.
        missingReceiptReason: values.missingReceiptReason ?? storedMissingReceiptReason(expense) ?? '',
        businessPurpose: values.businessPurpose!,
        payerUserId: values.payerUserId!,
        fundingSource: values.fundingSource!, paidInFullAcknowledged: true,
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
        ...(state.routeCheckBill ? { routeCheckBill: true as const } : {}),
      }, true);
      const webPath = absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/substitute-receipts/${evidence.id}`);
      const badge = substituteReceiptBadge({ language,
        status: 'READY_FOR_WEB', evidenceStatus: evidence.status, awaitingPaperSignature: choice === 'FORM',
      });
      return {
        handled: true, status: 'READY_FOR_WEB', expenseId: expense.id, workflowId: state.workflowId,
        source: substituteReplySource({ ...expense, substituteReceiptEvidence: evidence }, new Date(evidence.expenseUpdatedAtAtPreparation)),
        acceptedFields: [], blockers: [], webPath,
        ...(badge ? { badge } : {}),
        replyText: `${choice === 'ISSUE'
          ? language === 'en' ? 'The substitute receipt is prepared. Open the web app to sign.' : 'เตรียมใบรับรองแล้วค่ะ เปิดเว็บเพื่อเซ็น'
          : language === 'en' ? 'The paper form is prepared. Open the web app to download and sign it.' : 'เตรียมแบบแล้วค่ะ เปิดเว็บเพื่อดาวน์โหลดไปเซ็น'}\n${language === 'en' ? 'Document' : 'เลขที่'} ${evidence.documentNumber} · ${bahtAmount(expense, language)}\n${webLink(webPath)}`,
      };
    } catch (error) {
      // A prepare that cannot happen is a state the sender can act on, not a stack trace.
      const webPath = workflowLink(input.webBaseUrl, ctx.companyId, expense.id, state.workflowId);
      if (categoryCommitted) {
        const expensePath = absoluteLink(input.webBaseUrl, `/companies/${ctx.companyId}/expenses/${expense.id}`);
        return { handled: true, status: error instanceof ConflictException ? 'STALE' : 'BLOCKED',
          expenseId: expense.id, workflowId: state.workflowId, source: substituteReplySource(expense), acceptedFields: [],
          blockers: [blocker('substitute_prepare_failed', 'บันทึกหมวดค่าใช้จ่ายแล้ว แต่ยังเตรียมใบรับรองไม่ได้ค่ะ เปิดค่าใช้จ่ายเพื่อตรวจข้อมูลแล้วลองอีกครั้ง')],
          webPath: expensePath,
          replyText: `${language === 'en' ? 'The expense category was saved, but the substitute receipt could not be prepared. Open the expense to check the latest details and try again.' : 'บันทึกหมวดค่าใช้จ่ายแล้ว แต่ยังเตรียมใบรับรองไม่ได้ค่ะ เปิดค่าใช้จ่ายเพื่อตรวจข้อมูลแล้วลองอีกครั้ง'}\n${webLink(expensePath)}` };
      }
      if (error instanceof ConflictException) {
        return {
          handled: true, status: 'STALE', expenseId: expense.id, workflowId: state.workflowId, source: substituteReplySource(expense),
          acceptedFields: [], blockers: [], webPath,
          replyText: formatResult({ language, status: 'STALE', expense, state, acceptedFields: [], blockers: [], webPath }),
        };
      }
      // Generic Thai only — the raw API error is often English and never belongs in a customer chat.
      const blockers = [blocker('substitute_prepare_failed', 'ยังเตรียมเอกสารไม่ได้ในตอนนี้ค่ะ ตรวจสอบและดำเนินการต่อในเว็บได้เลย')];
      return {
        handled: true, status: 'BLOCKED', expenseId: expense.id, workflowId: state.workflowId, source: substituteReplySource(expense),
        acceptedFields: [], blockers, webPath,
        // A structural failure means the same “1) ออกเอกสาร” would fail again, so the decision is
        // cleared for this reply rather than re-offered as a one-tap retry; the web page is the way on.
        replyText: formatResult({ language, status: 'BLOCKED', expense, state: { ...state, pendingDecision: undefined }, acceptedFields: [], blockers, webPath }),
      };
    }
  }
}
