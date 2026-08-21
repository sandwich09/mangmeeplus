/**
 * Protected Thai/English routing corpus for substitute-receipt semantic routing
 * (docs/specs/line-substitute-semantic-routing-spec.md §8). A FROZEN expectation manifest — the same
 * shape the latency/operator corpora use, consumed by the existing offline provider replay runner (no
 * second runner). Each row pins the expected intake route AND the dispatcher write/revision behavior, so
 * the structural spec can gate: 0 writes for questions/negatives/denied, 100% protected negatives, and
 * full category coverage. Live agreement (>=95%) is measured by the offline replay, evidence-blocked here.
 *
 * It ALSO carries the frozen expense-vs-reimbursement semantic dataset of
 * docs/specs/line-ai-uat-correctness-latency-spec.md §14.1 (>=48 rows: claim starts th/en, ordinary
 * expense negatives, claim reads, questions, negations, stock/advance/voucher/substitute negatives, and
 * mixed/typo/colloquial/multi-bubble noise). That subset is `LINE_AI_SEMANTIC_COVERAGE_CASES`, proven
 * mechanically against `SEMANTIC_COVERAGE_MINIMUMS`. Both datasets replay through the SAME runner.
 * Every negative here is a ROUTING expectation with zero substitute workflow write — no row is, or
 * claims to be, evidence about an actual reimbursement/expense domain mutation.
 */
import type { LineIntakeFundingSource, LineIntakeRouteIntent, LineIntakeSemanticOutcome } from '@watchdog-bms/contracts';

export type SubstituteRouteCategory =
  | 'uat_paraphrase' | 'start' | 'continue' | 'status' | 'pause' | 'cancel'
  | 'receipt_available' | 'receipt_unavailable' | 'ordinary_expense'
  | 'payment_voucher' | 'reimbursement' | 'definition' | 'negation'
  | 'side_question' | 'unrelated_expense' | 'multiple_targets'
  | 'low_confidence' | 'unavailable' | 'denied'
  // uat-correctness-latency §14.1 semantic categories. Each is a protected negative RELATIVE TO the
  // substitute receipt AND to a reimbursement/expense record: none of them may ever create anything.
  | 'reimbursement_read' | 'question_not_command' | 'claim_negation' | 'stock_withdrawal' | 'advance';

/** The §14.1 noise axis, orthogonal to the route: the SAME gold route must survive a greeting wrapper,
 *  a typo, colloquial phrasing, or two bubbles the buffer joined with a newline (joinGroupText). */
export type SubstituteRouteStyle = 'mixed_casual_business' | 'typo' | 'colloquial' | 'multi_bubble';

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
  /** Must NEVER be routed to the substitute continuation. The protection is relative to the SUBSTITUTE
   *  route ONLY — a negative may still own an exact route of its own (the reimbursement rows do). */
  protectedNegative: boolean;
  /** Bounded semantic advice the row also pins, present only under the trusted `reimbursementSemantic`
   *  capability. A bare/mixed claim pins the fail-closed pair; only a row that literally states the user
   *  advanced the money pins the strong claim pair; every EXPENSE_DOCUMENT_CAPTURE row pins
   *  BUSINESS_EXPENSE + COMPANY_PAID because that pair IS the server's capture route contract (an
   *  expense-room classification, not proof of who really paid). None licenses a mutation from this route. */
  expectedSemanticOutcome?: LineIntakeSemanticOutcome;
  expectedFundingSource?: LineIntakeFundingSource;
  /** Present only on a §14.1 noise row; the gold route is unchanged by it. */
  style?: SubstituteRouteStyle;
  note: string;
};

const C = (
  id: string, language: 'th' | 'en', message: string, category: SubstituteRouteCategory,
  openSubstitute: boolean, expectedIntent: LineIntakeRouteIntent,
  expectsSubstituteDispatch: boolean, expectsWorkflowWrite: boolean, protectedNegative: boolean, note: string,
  semantic?: { outcome: LineIntakeSemanticOutcome; funding: LineIntakeFundingSource },
  style?: SubstituteRouteStyle,
): SubstituteRouteCase => ({
  id, language, message, category, openSubstitute, expectedIntent, expectsSubstituteDispatch,
  expectsWorkflowWrite, protectedNegative,
  ...(semantic ? { expectedSemanticOutcome: semantic.outcome, expectedFundingSource: semantic.funding } : {}),
  ...(style ? { style } : {}),
  note,
});

const SUB = 'SUBSTITUTE_RECEIPT_CONTINUATION' as const;
const REIMBURSE = 'REIMBURSEMENT_REQUEST_START' as const;
const CAPTURE = 'EXPENSE_DOCUMENT_CAPTURE' as const;
const READ = 'BUSINESS_READ_QUESTION' as const;
/** A bare "เบิก…" never says who paid, so the fail-closed pair is the only safe expectation: both members
 *  veto every mutation, which is what keeps a claim out of expense capture. */
const BARE_CLAIM = { outcome: 'AMBIGUOUS', funding: 'UNKNOWN' } as const;
/** The other side of the same gate: a message that literally says the user advanced the money
 *  ("สำรองจ่าย…ขอเบิกคืน") MUST NOT collapse to the fail-closed pair — an all-AMBIGUOUS corpus would pass a
 *  router that never reads the payer at all. Still 0 writes: the pair is advice, not a mutation licence. */
const STRONG_EMPLOYEE_PAID_CLAIM = { outcome: 'REIMBURSEMENT_CLAIM', funding: 'EMPLOYEE_PAID' } as const;
/**
 * The mirror on the expense side, and it is the OPERATIONAL ROUTE CONTRACT, not a claim about the world.
 *
 * Under the trusted `reimbursementSemantic` capability the server's own `isSemanticContradiction` vetoes
 * ANY EXPENSE_DOCUMENT_CAPTURE whose pair is not exactly BUSINESS_EXPENSE + COMPANY_PAID: such a route is
 * rewritten to CLARIFY with the hints stripped. So every row that expects capture must pin this pair —
 * pinning "no pair" would let a replay report agreement for an answer (capture + UNKNOWN) the dispatcher
 * actually turns into a question.
 *
 * Read it as the EXPENSE-ROOM CLASSIFICATION it is: "this belongs in expense capture, and nobody is
 * asking to be paid back". It is NOT evidence about who really handed over the cash — a company spend
 * note rarely states that, and this pair never licenses a reimbursement decision or an approver routing.
 */
const STRONG_COMPANY_PAID_EXPENSE = { outcome: 'BUSINESS_EXPENSE', funding: 'COMPANY_PAID' } as const;
/** The literal self-payment spans that license the strong claim pair. A row may pin
 *  REIMBURSEMENT_CLAIM/EMPLOYEE_PAID only when its own text contains one (proven in the integrity spec).
 *  There is deliberately NO mirror list on the expense side: COMPANY_PAID there is the route contract
 *  above, which the server enforces on every capture row whether or not the text names a payer. */
export const EXPLICIT_EMPLOYEE_PAID_PHRASES = ['สำรองจ่าย', 'จ่ายเองไปก่อน', 'ออกเงินเอง', 'out of my own pocket'] as const;

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
  // Ordinary expense note (NOT substitute even while a workflow is open) — protected negative. Every
  // capture row pins STRONG_COMPANY_PAID_EXPENSE because that pair IS the server's capture route contract.
  C('ordinary-coffee-open', 'th', 'ค่ากาแฟ 65 บาท', 'ordinary_expense', true, 'EXPENSE_DOCUMENT_CAPTURE', false, false, true, 'The pinned negative: a new expense note during an open substitute stays capture.', STRONG_COMPANY_PAID_EXPENSE),
  C('ordinary-paper', 'th', 'ค่ากระดาษ A4 250 บาท', 'ordinary_expense', true, 'EXPENSE_DOCUMENT_CAPTURE', false, false, true, 'New unrelated expense keeps substitute open.', STRONG_COMPANY_PAID_EXPENSE),
  C('ordinary-en', 'en', 'coffee 65 baht', 'ordinary_expense', true, 'EXPENSE_DOCUMENT_CAPTURE', false, false, true, 'English ordinary expense during open substitute.', STRONG_COMPANY_PAID_EXPENSE),
  // Payment voucher / ใบสำคัญรับเงิน / reimbursement — protected negatives (different documents).
  C('payment-voucher-th', 'th', 'ขอทำใบสำคัญรับเงิน', 'payment_voucher', false, 'CLARIFY', false, false, true, 'ใบสำคัญรับเงิน is a different document — never substitute.'),
  C('payment-voucher-2', 'th', 'ออกใบสำคัญจ่ายให้พนักงาน', 'payment_voucher', false, 'CLARIFY', false, false, true, 'Payment voucher — protected negative.'),
  C('payment-voucher-en', 'en', 'issue a payment voucher', 'payment_voucher', false, 'CLARIFY', false, false, true, 'English payment voucher.'),
  // Reimbursement now OWNS a route (uat-correctness-latency spec §7): it is still a protected negative
  // relative to the substitute receipt, but "anything but substitute" is no longer enough — each row pins
  // REIMBURSEMENT_REQUEST_START plus the semantic pair its own text supports, and still writes nothing.
  C('reimbursement-th', 'th', 'ขอเบิกค่าเดินทาง 60 บาท', 'reimbursement', false, REIMBURSE, false, false, true, 'Bare travel claim, no payer stated — its own route, never substitute, never a write.', BARE_CLAIM),
  C('reimbursement-2', 'th', 'ทำเรื่องเบิกค่าเดินทางให้หน่อย', 'reimbursement', false, REIMBURSE, false, false, true, 'Reimbursement request — claim route, no payer stated.', BARE_CLAIM),
  C('reimbursement-en', 'en', 'file a petty cash reimbursement', 'reimbursement', false, REIMBURSE, false, false, true, 'English reimbursement claim.', BARE_CLAIM),
  C('reimbursement-greeting-uat', 'th', 'สวัสดีเบิกค่าโดยสารหน่อย', 'reimbursement', false, REIMBURSE, false, false, true, 'The exact UAT mixed row: business wins over the greeting — never the 0-call greeting lane, never UNSUPPORTED.', BARE_CLAIM, 'mixed_casual_business'),
  C('reimbursement-employee-paid', 'th', 'สำรองจ่ายค่ารถ 120 บาท ขอเบิกคืน', 'reimbursement', false, REIMBURSE, false, false, true, 'The unambiguous other side: the user says they advanced the money, so the strong pair is required — still 0 substitute dispatch and 0 workflow write.', STRONG_EMPLOYEE_PAID_CLAIM),
  // §14.1 reimbursement start, Thai >= 10. Every row owns REIMBURSEMENT_REQUEST_START and writes NOTHING
  // in this release; the pinned pair is the gold label the deterministic payer question is derived from.
  C('reimb-uat-win-purpose', 'th', 'ขอเบิกค่ารถวิน 60 บาท ไปพบลูกค้า', 'reimbursement', false, REIMBURSE, false, false, true, 'Spec §16 acceptance text — a claim, never an ExpenseRecord. No payer stated, so fail-closed.', BARE_CLAIM),
  C('reimb-uat-trace-win', 'th', 'เบิกค่ารถวินมอไซต์ 60 บาท ไปพบลูกค้า', 'reimbursement', false, REIMBURSE, false, false, true, 'The exact UAT trace text that the legacy router answered EXPENSE_DOCUMENT_CAPTURE at 0.97 — the defect frozen.', BARE_CLAIM),
  C('reimb-bare-win-fare', 'th', 'เบิกค่าวิน 60 บาท ไปพบลูกค้า', 'reimbursement', false, REIMBURSE, false, false, true, 'Spec §7.2 bare row: claim route plus payer clarify, zero write until the user confirms.', BARE_CLAIM),
  C('reimb-advanced-win', 'th', 'สำรองจ่ายค่าวินไป 60 บาท ขอเบิกคืน', 'reimbursement', false, REIMBURSE, false, false, true, 'Spec §7.2 strong row: the text states outright that the user advanced the money.', STRONG_EMPLOYEE_PAID_CLAIM),
  C('reimb-advanced-taxi', 'th', 'จ่ายเองไปก่อน 350 บาท ค่าแท็กซี่ไปส่งของ ขอเบิกคืนด้วยครับ', 'reimbursement', false, REIMBURSE, false, false, true, 'A second explicit advance ("จ่ายเองไปก่อน") so the strong pair is not one memorised sentence.', STRONG_EMPLOYEE_PAID_CLAIM),
  C('reimb-client-lunch', 'th', 'ขอเบิกค่าอาหารกลางวันเลี้ยงลูกค้า 480 บาท', 'reimbursement', false, REIMBURSE, false, false, true, 'Claim with a purpose but no payer — purpose completeness must not upgrade the pair.', BARE_CLAIM),
  C('reimb-fuel-delivery', 'th', 'เบิกค่าน้ำมันรถไปส่งของ 300 บาท', 'reimbursement', false, REIMBURSE, false, false, true, 'Bare claim that must not collapse into the ordinary fuel spend note it resembles.', BARE_CLAIM),
  C('reimb-daily-allowance', 'th', 'ขอเบิกค่าที่พักไปต่างจังหวัด 1,200 บาท', 'reimbursement', false, REIMBURSE, false, false, true, 'Bare claim with a grouped-digit amount.', BARE_CLAIM),
  C('reimb-colloquial-fare', 'th', 'เบิกค่าโดยสารหน่อยครับ ประมาณ 90 บาท', 'reimbursement', false, REIMBURSE, false, false, true, 'Colloquial phrasing with a hedged amount — still the claim route.', BARE_CLAIM, 'colloquial'),
  C('reimb-typo-taxi', 'th', 'ขอเบิกค่าแทกซี่ 120 บาท', 'reimbursement', false, REIMBURSE, false, false, true, 'A real Thai typo (แทกซี่ for แท็กซี่) must not drop the claim route.', BARE_CLAIM, 'typo'),
  C('reimb-multibubble-advance', 'th', 'ผมสำรองจ่ายค่าแท็กซี่ไปก่อน 250 บาท\nขอเบิกคืนด้วยนะครับ', 'reimbursement', false, REIMBURSE, false, false, true, 'Two bubbles joined by the buffer newline; the payer is stated across them, so the strong pair holds.', STRONG_EMPLOYEE_PAID_CLAIM, 'multi_bubble'),
  // §14.1 reimbursement start, English >= 4.
  C('reimb-en-taxi-claim', 'en', 'I need to claim 250 baht for a taxi to the client site', 'reimbursement', false, REIMBURSE, false, false, true, 'English bare claim — no payer stated.', BARE_CLAIM),
  C('reimb-en-own-pocket', 'en', 'I paid 800 baht for the client dinner out of my own pocket and want it reimbursed', 'reimbursement', false, REIMBURSE, false, false, true, 'English explicit advance — the strong pair, still zero write.', STRONG_EMPLOYEE_PAID_CLAIM),
  C('reimb-en-travel', 'en', 'claim travel expenses 300 baht for the client visit', 'reimbursement', false, REIMBURSE, false, false, true, 'English bare claim.', BARE_CLAIM),
  C('reimb-en-greeting-mixed', 'en', 'hello, please start a reimbursement claim for my 180 baht grab ride', 'reimbursement', false, REIMBURSE, false, false, true, 'English greeting wrapped around a claim — business wins, never the casual lane.', BARE_CLAIM, 'mixed_casual_business'),
  // §14.1 ordinary expense negatives >= 8 (with unrelated_expense below). The complement of the claim
  // rows: if the router over-triggers on "ค่า… บาท" these break, so they are scored by their EXACT route.
  C('ordinary-win-purpose', 'th', 'ค่าวินไปพบลูกค้า 60 บาท', 'ordinary_expense', false, CAPTURE, false, false, true, 'Spec §7.2/§16: a spend note with no claim wording still captures.', STRONG_COMPANY_PAID_EXPENSE),
  C('ordinary-record-win', 'th', 'ช่วยบันทึกค่าวินไปพบลูกค้า 60 บาท', 'ordinary_expense', false, CAPTURE, false, false, true, 'Explicit "บันทึก" is recording a company spend, not asking to be paid back.', STRONG_COMPANY_PAID_EXPENSE),
  C('ordinary-travel-purpose', 'th', 'ค่าเดินทาง 200 บาท\nวัตถุประสงค์ไปพบลูกค้า', 'ordinary_expense', false, CAPTURE, false, false, true, 'The UAT trace that correctly captured, split across two bubbles.', STRONG_COMPANY_PAID_EXPENSE, 'multi_bubble'),
  C('ordinary-company-paid-parking', 'th', 'บริษัทจ่ายค่าที่จอดรถ 40 บาท', 'ordinary_expense', false, CAPTURE, false, false, true, 'The row whose text ALSO says outright that the company paid — the pair is the route contract everywhere here, but this one is unambiguous on the wording too.', STRONG_COMPANY_PAID_EXPENSE),
  C('ordinary-company-expense-post', 'th', 'ลงค่าใช้จ่ายบริษัท ค่าไปรษณีย์ 85 บาท', 'ordinary_expense', false, CAPTURE, false, false, true, 'Posting a company expense — capture, never a claim.', STRONG_COMPANY_PAID_EXPENSE),
  C('ordinary-en-client-lunch', 'en', 'record the client lunch 450 baht', 'ordinary_expense', false, CAPTURE, false, false, true, 'English ordinary spend note.', STRONG_COMPANY_PAID_EXPENSE),
  // §14.1 reimbursement read/status >= 4 — §7.2 pins BUSINESS_READ_QUESTION, so these are exact-scored.
  C('reimb-read-pending', 'th', 'ขอดูใบเบิกที่ค้าง', 'reimbursement_read', false, READ, false, false, true, 'Spec §7.2: a status read owns BUSINESS_READ_QUESTION and writes nothing.'),
  C('reimb-read-approved', 'th', 'ใบเบิกของฉันอนุมัติหรือยัง', 'reimbursement_read', false, READ, false, false, true, 'Approval status read — never starts a claim.'),
  C('reimb-read-month-total', 'th', 'สรุปยอดเบิกเดือนนี้เท่าไหร่', 'reimbursement_read', false, READ, false, false, true, 'Aggregate read over claims.'),
  C('reimb-read-colloquial', 'th', 'เบิกที่ยื่นไปเมื่อวานถึงไหนแล้ว', 'reimbursement_read', false, READ, false, false, true, 'Colloquial status read — the word เบิก alone is not a command.', undefined, 'colloquial'),
  C('reimb-read-en', 'en', 'what is the status of my reimbursement request', 'reimbursement_read', false, READ, false, false, true, 'English status read.'),
  // §14.1 question vs command >= 4. §7.2 pins only "help/clarify" (more than one safe route is correct),
  // so these are scored by "never a command route", which is strictly less than an exact pin.
  C('question-may-claim', 'th', 'ขอเบิกได้ไหม', 'question_not_command', false, 'CLARIFY', false, false, true, 'Spec §7.2: asking whether one MAY claim is help/clarify, never a claim command.'),
  C('question-receipt-required', 'th', 'ต้องแนบใบเสร็จตอนขอเบิกไหม', 'question_not_command', false, 'CLARIFY', false, false, true, 'A policy question about claiming creates nothing.'),
  C('question-claim-limit', 'th', 'เบิกค่าเดินทางได้สูงสุดเท่าไหร่', 'question_not_command', false, 'CLARIFY', false, false, true, 'A limit question carrying claim words, but it asks rather than commands.'),
  C('question-en-can-i-claim', 'en', 'can I claim my taxi fare', 'question_not_command', false, 'CLARIFY', false, false, true, 'English question form — help/clarify, never a claim.'),
  // §14.1 negation/cancel >= 4 (of a CLAIM — distinct from the substitute-workflow `cancel` control rows,
  // which are an explicit audited stateful command and do write).
  C('claimneg-not-needed', 'th', 'ไม่ต้องเบิกค่าวินแล้ว', 'claim_negation', false, 'CLARIFY', false, false, true, 'Spec §7.2 negation: guidance only, never creates.'),
  C('claimneg-cancel-request', 'th', 'ยกเลิกคำขอเบิกที่เพิ่งบอกไป', 'claim_negation', false, 'CLARIFY', false, false, true, 'Cancelling the claim just mentioned must not start one.'),
  C('claimneg-later', 'th', 'ยังไม่ขอเบิกนะ เดี๋ยวค่อยทำ', 'claim_negation', false, 'CLARIFY', false, false, true, 'Deferral is not a command.'),
  C('claimneg-colloquial', 'th', 'ไม่เอาแล้วค่ะ ไม่ต้องทำเรื่องเบิก', 'claim_negation', false, 'CLARIFY', false, false, true, 'Colloquial refusal.', undefined, 'colloquial'),
  C('claimneg-en', 'en', "never mind, don't file that reimbursement", 'claim_negation', false, 'CLARIFY', false, false, true, 'English negation.'),
  // §14.1 stock withdrawal 3–4 — เบิก of GOODS, never of money (§17 non-goal).
  C('stock-boxes', 'th', 'เบิกของจากสต็อก 2 กล่อง', 'stock_withdrawal', false, 'CLARIFY', false, false, true, 'Spec §7.2: inventory withdrawal is never reimbursement or expense capture.'),
  C('stock-paper-reams', 'th', 'ขอเบิกกระดาษ A4 จากคลัง 5 รีม', 'stock_withdrawal', false, 'CLARIFY', false, false, true, 'An ขอเบิก prefix over a quantity of goods — still stock, not money.'),
  C('stock-to-storefront', 'th', 'เบิกสินค้าออกจากคลังไปหน้าร้าน', 'stock_withdrawal', false, 'CLARIFY', false, false, true, 'Goods movement with no amount at all.'),
  C('stock-en', 'en', 'withdraw 3 boxes of stock from the warehouse', 'stock_withdrawal', false, 'CLARIFY', false, false, true, 'English stock withdrawal.'),
  // §14.1 advance 3–4 — money BEFORE the spend; §17 non-goal, so it has no contract to route into.
  C('advance-cash', 'th', 'ขอเบิกเงินล่วงหน้า', 'advance', false, 'CLARIFY', false, false, true, 'Spec §7.2: an advance has no contract — clarify, never create.'),
  C('advance-petty-cash', 'th', 'ขอเบิกเงินสดย่อยไปใช้ก่อน 2000 บาท', 'advance', false, 'CLARIFY', false, false, true, 'Petty-cash advance is a §17 non-goal even with an amount present.'),
  C('advance-borrow', 'th', 'ขอยืมเงินบริษัทไปจ่ายค่าเดินทางก่อน', 'advance', false, 'CLARIFY', false, false, true, 'Borrowing before the spend is not a reimbursement claim.'),
  C('advance-en', 'en', "request a cash advance for next week's trip", 'advance', false, 'CLARIFY', false, false, true, 'English cash advance.'),
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
  C('unrelated-expense-th', 'th', 'ค่าน้ำมันรถ 800 บาท', 'unrelated_expense', true, 'EXPENSE_DOCUMENT_CAPTURE', false, false, true, 'Unrelated expense keeps substitute open.', STRONG_COMPANY_PAID_EXPENSE),
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
  receipt_available: 1, receipt_unavailable: 1, ordinary_expense: 9, payment_voucher: 3,
  reimbursement: 20, definition: 4, negation: 3, side_question: 2, unrelated_expense: 1,
  multiple_targets: 2, low_confidence: 2, unavailable: 2, denied: 5,
  reimbursement_read: 5, question_not_command: 4, claim_negation: 5, stock_withdrawal: 4, advance: 4,
};

/**
 * The expense-vs-reimbursement semantic dataset of uat-correctness-latency spec §14.1, expressed as
 * buckets over the SAME corpus rows (no second dataset, no second runner). Language is part of the
 * contract for claim starts, so those are two buckets; the noise axis (`style`) is one bucket a row
 * joins IN ADDITION to its route bucket, because §14.1 asks for mixed/typo/colloquial/multi-bubble
 * coverage across routes rather than as routes of their own.
 */
export type SemanticCoverageBucket =
  | 'reimbursement_start_th' | 'reimbursement_start_en' | 'ordinary_expense_negative'
  | 'reimbursement_read' | 'question_not_command' | 'claim_negation'
  | 'stock_withdrawal' | 'advance' | 'payment_voucher' | 'substitute_receipt' | 'mixed_or_noisy';

/** The §14.1 floor, verbatim. Ranges ("3–4") are pinned at their minimum; the per-category record above
 *  separately freezes the ACTUAL sizes so a row can never be trimmed back down to this floor. */
export const SEMANTIC_COVERAGE_MINIMUMS: Record<SemanticCoverageBucket, number> = {
  reimbursement_start_th: 10, reimbursement_start_en: 4, ordinary_expense_negative: 8,
  reimbursement_read: 4, question_not_command: 4, claim_negation: 4,
  stock_withdrawal: 3, advance: 3, payment_voucher: 3, substitute_receipt: 3, mixed_or_noisy: 6,
};

/** Route bucket per corpus category. Categories absent here are substitute-workflow mechanics (continue,
 *  pause, status, denied, outage…) that belong to the substitute spec, not to the §14.1 semantic set. */
const SEMANTIC_BUCKET_BY_CATEGORY: Partial<Record<SubstituteRouteCategory, SemanticCoverageBucket>> = {
  ordinary_expense: 'ordinary_expense_negative', unrelated_expense: 'ordinary_expense_negative',
  reimbursement_read: 'reimbursement_read', question_not_command: 'question_not_command',
  claim_negation: 'claim_negation', stock_withdrawal: 'stock_withdrawal', advance: 'advance',
  payment_voucher: 'payment_voucher', uat_paraphrase: 'substitute_receipt', start: 'substitute_receipt',
};

/** Every §14.1 bucket one row satisfies (a claim start also counts as noise when it carries a `style`). */
export function semanticCoverageBuckets(row: SubstituteRouteCase): SemanticCoverageBucket[] {
  const buckets: SemanticCoverageBucket[] = [];
  if (row.category === 'reimbursement') {
    buckets.push(row.language === 'en' ? 'reimbursement_start_en' : 'reimbursement_start_th');
  }
  const routeBucket = SEMANTIC_BUCKET_BY_CATEGORY[row.category];
  if (routeBucket) buckets.push(routeBucket);
  if (row.style) buckets.push('mixed_or_noisy');
  return buckets;
}

/** The §14.1 semantic subset (>= 48 rows) of the same frozen corpus. */
export const LINE_AI_SEMANTIC_COVERAGE_CASES: SubstituteRouteCase[] =
  LINE_AI_SUBSTITUTE_ROUTING_CORPUS.filter((row) => semanticCoverageBuckets(row).length > 0);
