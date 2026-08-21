/**
 * Protected Thai/English routing corpus for substitute-receipt semantic routing
 * (docs/specs/line-substitute-semantic-routing-spec.md §8). A FROZEN expectation manifest — the same
 * shape the latency/operator corpora use, consumed by the existing offline provider replay runner (no
 * second runner). Each row pins the expected intake route AND the dispatcher write/revision behavior, so
 * the structural spec can gate: 0 writes for questions/negatives/denied, 100% protected negatives, and
 * full category coverage. Live agreement (>=95%) is measured by the offline replay, evidence-blocked here.
 */
import type { LineIntakeRouteIntent } from '@watchdog-bms/contracts';

export type SubstituteRouteCategory =
  | 'uat_paraphrase' | 'start' | 'continue' | 'status' | 'pause' | 'cancel'
  | 'receipt_available' | 'receipt_unavailable' | 'ordinary_expense'
  | 'payment_voucher' | 'reimbursement' | 'definition' | 'negation'
  | 'side_question' | 'unrelated_expense' | 'multiple_targets'
  | 'low_confidence' | 'unavailable' | 'denied';

export type SubstituteRouteCase = {
  id: string;
  language: 'th' | 'en';
  message: string;
  category: SubstituteRouteCategory;
  /** Whether an OPEN substitute-receipt clarification exists for this user in this chat. */
  openSubstitute: boolean;
  /** The intake route the semantic router should return (or CLARIFY for a veto). */
  expectedIntent: LineIntakeRouteIntent;
  /** Whether the typed dispatcher should invoke the substitute continuation use case. */
  expectsSubstituteDispatch: boolean;
  /** Whether ANY substitute workflow save / expense-revision bump should occur (0 for reads/negatives/denied). */
  expectsWorkflowWrite: boolean;
  /** Must NEVER be routed to the substitute continuation (a protected negative). */
  protectedNegative: boolean;
  note: string;
};

const C = (
  id: string, language: 'th' | 'en', message: string, category: SubstituteRouteCategory,
  openSubstitute: boolean, expectedIntent: LineIntakeRouteIntent,
  expectsSubstituteDispatch: boolean, expectsWorkflowWrite: boolean, protectedNegative: boolean, note: string,
): SubstituteRouteCase => ({ id, language, message, category, openSubstitute, expectedIntent, expectsSubstituteDispatch, expectsWorkflowWrite, protectedNegative, note });

const SUB = 'SUBSTITUTE_RECEIPT_CONTINUATION' as const;

export const LINE_AI_SUBSTITUTE_ROUTING_CORPUS: SubstituteRouteCase[] = [
  // UAT paraphrase (the dead-end): a semantic substitute request the old regex missed. A non-canonical
  // start must CONFIRM first — dispatch=true (execute returns the confirm), workflow write=FALSE (only an
  // intake-ledger clarification is persisted); the next affirmative inherits and safely starts.
  C('uat-win-fare', 'th', 'ขอทำใบทดแทนของค่าวินหน่อย', 'uat_paraphrase', false, SUB, true, false, false, 'UAT paraphrase → confirm first, ledger-only, no workflow write.'),
  C('uat-win-fare-2', 'th', 'ค่าวินมอเตอร์ไซค์ไม่มีบิล อยากออกใบรับรองแทน', 'uat_paraphrase', false, SUB, true, false, false, 'Paraphrase → confirm first, no workflow write.'),
  C('uat-taxi-en', 'en', 'need a substitute receipt for the taxi fare, there was no bill', 'uat_paraphrase', false, SUB, true, false, false, 'English UAT paraphrase → confirm first, no workflow write.'),
  // Start. Only an EXACT canonical command writes directly; a paraphrase/loose/English start confirms first.
  C('start-th', 'th', 'ขอออกใบรับรองแทนใบเสร็จรับเงิน', 'start', false, SUB, true, true, false, 'Canonical explicit start (exact legal name) → opens directly.'),
  C('start-th-2', 'th', 'อยากทำใบแทนใบเสร็จค่ากาแฟที่ไม่มีใบเสร็จ', 'start', false, SUB, true, false, false, 'Loose form + sentence → confirm first, no workflow write.'),
  C('start-en', 'en', 'I want to make a substitute receipt for a cash expense', 'start', false, SUB, true, false, false, 'English start → confirm first, no workflow write.'),
  // Continue (answering the open pending question).
  C('continue-th', 'th', 'จ่ายให้ร้านลุงวินหน้าปากซอย', 'continue', true, SUB, true, true, false, 'Answers the open substitute question (payee).'),
  C('continue-th-2', 'th', 'ค่าเดินทางไปหาลูกค้า', 'continue', true, SUB, true, true, false, 'Answers the business-purpose question.'),
  C('continue-en', 'en', 'the purpose was a client visit', 'continue', true, SUB, true, true, false, 'English continue answer.'),
  // Status.
  C('status-th', 'th', 'ใบรับรองแทนใบเสร็จอันนี้ถึงไหนแล้ว', 'status', true, SUB, true, false, false, 'Status query — reads state, no write.'),
  C('status-en', 'en', "what's the status of my substitute receipt", 'status', true, SUB, true, false, false, 'English status — no write.'),
  // Pause (explicit stateful control — deterministic + audited).
  C('pause-th', 'th', 'พักใบรับรองแทนใบเสร็จไว้ก่อน', 'pause', true, SUB, true, true, false, 'Explicit pause control.'),
  C('pause-en', 'en', 'pause the substitute receipt for now', 'pause', true, SUB, true, true, false, 'English pause.'),
  // Cancel.
  C('cancel-th', 'th', 'ยกเลิกใบรับรองแทนใบเสร็จอันนี้', 'cancel', true, SUB, true, true, false, 'Explicit cancel control.'),
  C('cancel-en', 'en', 'cancel this substitute receipt', 'cancel', true, SUB, true, true, false, 'English cancel.'),
  // Receipt available / unavailable framing.
  C('receipt-unavailable-th', 'th', 'ไม่มีใบเสร็จเลย ขอทำใบรับรองแทน', 'receipt_unavailable', false, SUB, true, false, false, 'No receipt, non-canonical sentence → confirm first, no workflow write.'),
  C('receipt-available-th', 'th', 'มีใบเสร็จแล้วแต่อยากทำใบรับรองแทนด้วย', 'receipt_available', false, SUB, true, false, false, 'Has a receipt, non-canonical sentence → confirm first, no workflow write.'),
  // Ordinary expense note (NOT substitute even while a workflow is open) — protected negative.
  C('ordinary-coffee-open', 'th', 'ค่ากาแฟ 65 บาท', 'ordinary_expense', true, 'EXPENSE_DOCUMENT_CAPTURE', false, false, true, 'The pinned negative: a new expense note during an open substitute stays capture.'),
  C('ordinary-paper', 'th', 'ค่ากระดาษ A4 250 บาท', 'ordinary_expense', true, 'EXPENSE_DOCUMENT_CAPTURE', false, false, true, 'New unrelated expense keeps substitute open.'),
  C('ordinary-en', 'en', 'coffee 65 baht', 'ordinary_expense', true, 'EXPENSE_DOCUMENT_CAPTURE', false, false, true, 'English ordinary expense during open substitute.'),
  // Payment voucher / ใบสำคัญรับเงิน / reimbursement — protected negatives (different documents).
  C('payment-voucher-th', 'th', 'ขอทำใบสำคัญรับเงิน', 'payment_voucher', false, 'CLARIFY', false, false, true, 'ใบสำคัญรับเงิน is a different document — never substitute.'),
  C('payment-voucher-2', 'th', 'ออกใบสำคัญจ่ายให้พนักงาน', 'payment_voucher', false, 'CLARIFY', false, false, true, 'Payment voucher — protected negative.'),
  C('payment-voucher-en', 'en', 'issue a payment voucher', 'payment_voucher', false, 'CLARIFY', false, false, true, 'English payment voucher.'),
  C('reimbursement-th', 'th', 'ขอเบิกเงินสดย่อยค่าเดินทาง', 'reimbursement', false, 'BUSINESS_READ_QUESTION', false, false, true, 'Petty-cash reimbursement — never substitute.'),
  C('reimbursement-2', 'th', 'ทำเรื่องเบิกค่าเดินทางให้หน่อย', 'reimbursement', false, 'CLARIFY', false, false, true, 'Reimbursement request — protected negative.'),
  C('reimbursement-en', 'en', 'file a petty cash reimbursement', 'reimbursement', false, 'CLARIFY', false, false, true, 'English reimbursement.'),
  // Definition / VAT / help questions — never a workflow write.
  C('definition-th', 'th', 'ใบรับรองแทนใบเสร็จรับเงินคืออะไร', 'definition', false, 'BUSINESS_READ_QUESTION', false, false, true, 'Definition question — a mention is not a start.'),
  C('definition-open', 'th', 'ใบรับรองแทนใบเสร็จใช้ตอนไหน', 'definition', true, 'BUSINESS_READ_QUESTION', false, false, true, 'Definition during open substitute keeps it open, no write.'),
  C('vat-th', 'th', 'ใบรับรองแทนใบเสร็จมี VAT ไหม', 'definition', false, 'BUSINESS_READ_QUESTION', false, false, true, 'VAT question about the document — no write.'),
  C('help-en', 'en', 'how does a substitute receipt work', 'definition', false, 'BUSINESS_READ_QUESTION', false, false, true, 'English help question.'),
  // Negation / no-op — cannot start.
  C('negation-th', 'th', 'ยังไม่ทำใบรับรองแทนตอนนี้', 'negation', true, 'CLARIFY', false, false, true, 'Negation — must not start/continue, no write.'),
  C('negation-2', 'th', 'ไม่เอาแล้วเดี๋ยวค่อยทำ', 'negation', true, 'CLARIFY', false, false, true, 'No-op negation keeps state, no write.'),
  C('negation-en', 'en', "not now, I don't want to make it yet", 'negation', true, 'CLARIFY', false, false, true, 'English negation.'),
  // Side question during an open substitute — routes normally, keeps substitute open.
  C('side-question-th', 'th', 'เดือนนี้ยอดขายเท่าไหร่', 'side_question', true, 'BUSINESS_READ_QUESTION', false, false, true, 'A business read during open substitute — no substitute write.'),
  C('side-question-en', 'en', 'what were sales this month', 'side_question', true, 'BUSINESS_READ_QUESTION', false, false, true, 'English side question.'),
  // Unrelated new expense during an open substitute.
  C('unrelated-expense-th', 'th', 'ค่าน้ำมันรถ 800 บาท', 'unrelated_expense', true, 'EXPENSE_DOCUMENT_CAPTURE', false, false, true, 'Unrelated expense keeps substitute open.'),
  // Multiple targets.
  C('multiple-th', 'th', 'ทำใบรับรองแทนใบเสร็จต่อ', 'multiple_targets', true, SUB, true, false, false, 'Ambiguous which of several — use case returns TARGET_REQUIRED, no write yet.'),
  C('multiple-en', 'en', 'continue the substitute receipt', 'multiple_targets', true, SUB, true, false, false, 'English multiple-target continue.'),
  // Low confidence — CLARIFY (veto-only), no write.
  C('low-conf-th', 'th', 'อันนั้นทำต่อได้ป่าว', 'low_confidence', true, 'CLARIFY', false, false, false, 'Ambiguous continue — CLARIFY, no start.'),
  C('low-conf-en', 'en', 'can we keep going with that thing', 'low_confidence', true, 'CLARIFY', false, false, false, 'English ambiguous — CLARIFY.'),
  // Provider UNAVAILABLE — narrow regex fallback only for canonical names; a paraphrase cannot start.
  C('unavailable-canonical', 'th', 'ทำใบรับรองแทนใบเสร็จรับเงิน', 'unavailable', false, 'UNSUPPORTED', true, true, false, 'On UNAVAILABLE the narrow regex still catches the canonical name.'),
  C('unavailable-paraphrase', 'th', 'ทำใบทดแทนของค่าวิน', 'unavailable', false, 'UNSUPPORTED', false, false, true, 'On UNAVAILABLE a paraphrase the regex misses cannot start (safe).'),
  // Permission / feature / policy / payer / approver denied — 0 writes.
  C('denied-permission', 'th', 'ขอทำใบรับรองแทนใบเสร็จ', 'denied', false, SUB, true, false, false, 'User lacks the expense-capture permission — dispatch runs, use case denies BEFORE any save.'),
  C('denied-feature', 'th', 'ออกใบรับรองแทนใบเสร็จ', 'denied', false, SUB, true, false, false, 'Company feature off — denied before save.'),
  C('denied-policy', 'th', 'ทำใบรับรองแทนใบเสร็จให้หน่อย', 'denied', false, SUB, true, false, false, 'Company policy ineligible — no write.'),
  C('denied-payer', 'th', 'ทำใบรับรองแทนใบเสร็จ (ไม่ใช่ผู้จ่าย)', 'denied', false, SUB, true, false, false, 'Actor is not the payer/eligible — denied before save.'),
  C('denied-approver', 'th', 'ทำใบรับรองแทนใบเสร็จ (ไม่มีสิทธิ์อนุมัติ)', 'denied', false, SUB, true, false, false, 'No approver right — no workflow write from routing.'),
];

/** Minimum rows per category the corpus must always keep (frozen coverage, no post-hoc trimming). */
export const SUBSTITUTE_ROUTING_CATEGORY_MINIMUMS: Record<SubstituteRouteCategory, number> = {
  uat_paraphrase: 3, start: 3, continue: 3, status: 2, pause: 2, cancel: 2,
  receipt_available: 1, receipt_unavailable: 1, ordinary_expense: 3, payment_voucher: 3,
  reimbursement: 3, definition: 4, negation: 3, side_question: 2, unrelated_expense: 1,
  multiple_targets: 2, low_confidence: 2, unavailable: 2, denied: 5,
};
