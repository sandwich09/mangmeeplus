/**
 * Processes a verified LINE text message event end-to-end:
 * 1. Dedup webhook event id
 * 2. Resolve LINE user → internal user + company context
 * 3. Classify intent (refuse mutations early)
 * 4. Build turn request with server-derived context
 * 5. Call AI Gateway
 * 6. Reply to LINE
 * 7. Persist turn
 */
import { HttpException, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditService } from '../../../audit/application/audit.service';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';
import { AiGatewayClient, type GovernedLineIntakeRoutePlan } from '../../infrastructure/ai-gateway.client';
import { LineReplyAdapter, type LineDeliveryResult } from '../../infrastructure/line-reply.adapter';
import { LineIntakeStateRepository } from '../../infrastructure/line-intake-state.repository';
import {
  InitReceiptUploadUseCase,
  CompleteReceiptUploadUseCase,
} from '../../../expenses/application/use-cases/expense-upload.use-case';
import { reconcileExpenseDuplicateCandidates } from '../../../expenses/application/services/expense-duplicate-detection';
import { pickLineDefaultBranchId } from '../../../expenses/domain/logic/line-receipt-branch.logic';
import { CaptureLineExpenseNoteUseCase, LineTextExpenseCaptureIncompleteError } from '../../../expenses/application/use-cases/expense-document.use-case';
import { CorrectLineCapturedExpenseUseCase } from '../../../expenses/application/use-cases/line-correction.use-case';
import {
  CHECK_BILL_PAYMENT_CHOICES,
  CHECK_BILL_PAYMENT_QUESTION,
  checkBillPaymentChoice,
  classifySubstituteMedia,
  hasActiveSubstituteContinuation,
  isSubstituteReceiptConversationText,
  LineSubstituteReceiptContinuationUseCase,
  numberedSelection,
  parseSubstituteMediaQuestion,
  isSignatureCaptionText,
  substituteMediaAnswer,
  substituteMediaChoices,
  substituteMediaQuestion,
  substituteRequestExpenseText,
  substituteScanConfirmAnswer,
  substituteScanConfirmQuestion,
  substituteScanPickQuestion,
  type LineSubstituteMediaContext,
  type LineSubstituteMediaQuestion,
  type LineSubstituteMediaScan,
  type LineSubstituteReceiptContinuationResult,
} from '../../../expenses/application/use-cases/line-substitute-receipt-continuation.use-case';
import { LineExpenseDraftConversationUseCase } from '../../../expenses/application/use-cases/line-expense-draft-conversation.use-case';
import { isDeterministicLineExpenseDraftInput } from '../../../expenses/domain/logic/line-expense-draft-conversation.logic';
import { InitSignatureUploadUseCase, CreateSignatureAssetUseCase, maySubmitSignature } from '../../../expenses/application/use-cases/signature-asset.use-case';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import type { ExpenseRecordWithRelations } from '../../../expenses/domain/models/expense.model';
import { CreateUploadIntentUseCase } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { CompleteAttachmentUploadUseCase } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import {
  canonicalAttachmentExtension,
  inspectAttachmentBytes,
  normalizeAttachmentMimeType,
  validateAttachmentFileName,
  validateAttachmentMeta,
} from '../../../data-model-core/domain/logic/attachment.logic';
import { AttachmentMalwareScanner } from '../../../data-model-core/infrastructure/attachment-malware-scanner';
import { deriveTaxEvidence, isExpenseExtractionEligible, sourceDocumentTypeFromClassification, toSourceDocumentType } from '../../../expenses/domain/logic/expense-document.logic';
import { isStaleOcrApply, ReceiptOcrApplyService, toMoney4, type ReceiptCategorySuggestion } from '../../../expenses/application/services/receipt-ocr-apply.service';
import { normalizeLineText, hashMessagePreview, parseBareCompanySelection, parseLineCompanyCommand } from '../../domain/logic/line-ai-classifier.logic';
import type { LineCompanyCommand } from '../../domain/logic/line-ai-classifier.logic';
import { formatRefusal } from '../../domain/logic/line-ai-formatter.logic';
import { absoluteWebLink } from '../../../../common/http/web-link';
import { FEATURE_TEMPORARILY_UNAVAILABLE, loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { ListApprovalQueueUseCase } from '../../../reimbursements/application/use-cases/reimbursement-approval.use-case';
import { ListPurchaseRequestsUseCase } from '../../../procurement/application/use-cases/purchase-request.use-case';
import { ListPurchaseOrdersUseCase } from '../../../procurement/application/use-cases/purchase-order.use-case';
import type { BusinessDocumentClassification, LineExpenseDraftRouteContext, LineUserContext, LineAiTurnRequest, LineAiTurnResponse, LineAiConversationContext, LineAiOpenClarification, LineAiValueCandidates, LineIntakeCorrectionCandidate, LineIntakeRoutePlan, LineIntakeSubstituteContext, ReceiptOcrFieldResult, RequestContext } from '@watchdog-bms/contracts';
import { LINE_AI_CONTEXT_MAX_TURNS, LINE_AI_CONTEXT_WINDOW_MINUTES, LINE_AI_ERROR_CODES, LINE_CORRECTION_CANDIDATE_LIMIT, LINE_TOOL_REGISTRY, RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE, asIntakeRouteIntent, extractValueCandidates, hasToolPermissions, todayCivilDate } from '@watchdog-bms/contracts';
import { LineAiLedgerService, ledgerKey, type LedgerEntry } from '../line-ai-ledger.service';
import { ConsumptionMarkerUnavailableError, markClarificationsConsumed, type ClarificationConsumption } from '../line-ai-consumption-marker';
import { availableApprovalSurfaceKeys, buildCapabilityCard, buildCompanyContextMessage, buildCompanyPickerMessage, buildContactCard, buildPendingApprovalCard, buildPromotionCard, buildReceiptCapturePrompt, buildServiceEntitlementMessage, buildStaffCompletionQuickReply, buildStaffMainMenu, buildStaffQueryMenu, isCapabilityQuestion, staffMenuCommand, PENDING_APPROVAL_ITEM_LIMIT, type ApprovalSurfaceKey, type PendingApprovalSnapshot, type StaffMenuContext } from '../../domain/logic/line-staff-menu.logic';
import { buildExpenseDraftCardMessage, buildLineAssistantTextCardMessage, buildLineBusinessAnswerMessage, buildReimbursementHandoffMessage, buildReimbursementPayerClarificationMessage, type LineExpenseDraftCardFacts } from '../../domain/logic/line-business-card.logic';
import { advisorDirectAnswerText } from '../../domain/logic/line-advisor-direct-answer.logic';
import { capabilityFollowUpReply, isDeliveredCapabilityFollowUp, isNextStepQuestionText } from '../../domain/logic/line-ai-capability-follow-up.logic';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { LINE_BUFFER_ORPHAN_REPROCESS_MS } from '../../domain/logic/line-message-buffer.logic';
import { resolveCompanyAiModelPolicy } from '../company-ai-model-policy';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../../common/logger/security-event';
import { LegalAcceptanceService } from '../../../auth/application/legal-acceptance.service';
import { LineHandoffLinkService } from '../line-handoff-link.service';
import {
  classifyLineAiGatewayFailure,
  classifyLineAiTerminalOutcome,
  emitLineAiTerminalOutcome,
  terminalStatusForLineTurn,
} from '../../domain/logic/line-ai-terminal-outcome.logic';

export type LineTextEvent = {
  webhookEventId: string;
  lineUserId: string;
  replyToken: string;
  messageText: string;
  messagingChannelId: string;
  lineMessageId?: string;
  /** Chat to push into when the reply token has expired (group id in group chats). */
  pushTargetId?: string;
  /** Internal buffer hook: settle any in-flight pre-reply feedback before the answer. */
  beforeReply?: () => Promise<void>;
  /** P12-3b: filled in once the turn has resolved WHO it is answering, so the send boundary can
   *  mint a deep-link handoff. Absent until then — an unlinked prompt has nobody to mint for. */
  handoff?: LineHandoffRecipient;
};

/** The identity an outgoing message is addressed to; the only thing a handoff token binds. */
export type LineHandoffRecipient = { userId: string; companyId: string };

export type LineReceiptUploadEvent = {
  webhookEventId: string;
  lineUserId: string;
  replyToken: string;
  lineMessageId: string;
  messageType: 'image' | 'file';
  fileName?: string;
  fileSize?: number;
  messagingChannelId: string;
  /** Chat to push into when the reply token has expired (group id in group chats). */
  pushTargetId?: string;
  /** Resolved at durable acceptance so a later company switch cannot move this receipt. */
  companyIdAtAcceptance?: string;
  /** P12-3b: see `LineTextEvent.handoff`. */
  handoff?: LineHandoffRecipient;
  /** Internal buffer hook: settle any in-flight pre-reply feedback before the answer. */
  beforeReply?: () => Promise<void>;
};

/** `defer_text` = the intake router judged the accompanying caption to be a
 *  standalone question (spec §8); the caller should run it as a text turn. */
export type LineMediaTurnOutcome = { outcome: 'done' | 'defer_text' };

/** Read-only gate used by the verified employee LINE webhook before it writes
 * the recoverable buffer payload. `continue` deliberately also covers users
 * whose company cannot yet be resolved (unlinked / selection / policy flows),
 * so this preflight never invents a default company. */
export type LineLegalAcceptancePreflight =
  // `companyId` on continue is present only when a single company resolved; the buffer uses it as the
  // stable debounce-cohort key. Unlinked/unresolved/multi-company continues omit it (no assignment).
  | { status: 'continue'; companyId?: string }
  | { status: 'required'; companyId: string };

const UNLINKED_REPLY = '🔗 กรุณาเชื่อมต่อบัญชี มั่งมีพลัส กับ LINE ก่อนใช้งานนะคะ\nเปิดเว็บแอปเพื่อเชื่อมต่อได้เลยค่ะ';
// PDPA objection route (M-05 register §3.1): the user opted out of AI processing, so the
// turn stops here — before any model, tool, or gateway involvement. Deterministic text.
const AI_OPT_OUT_REPLY = '🤖 คุณปิดการใช้งานผู้ช่วย AI ไว้ ข้อความนี้จึงไม่ถูกประมวลผลด้วย AI ค่ะ\nเปิดใช้งานอีกครั้งได้ที่ เว็บแอป → ตั้งค่า → ความปลอดภัย นะคะ';
export const LEGAL_ACCEPTANCE_REQUIRED_REPLY = '📄 กรุณาเข้าสู่เว็บแอป MangmeePlus เพื่อยอมรับข้อกำหนดการใช้งานและรับทราบนโยบายความเป็นส่วนตัวก่อนใช้งานบริการนี้นะคะ';
const FORBIDDEN_REPLY = '🔒 คุณไม่มีสิทธิ์ใช้งาน LINE AI สำหรับบริษัทนี้ค่ะ';
const ERROR_REPLY = '⏳ ขออภัยค่ะ เกิดข้อผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ';
/** The photo's bytes never arrived from LINE, so "nothing was saved" is provably true — say so,
 *  and name the photo as the thing to resend (a generic "ลองใหม่" left users unsure what failed). */
const MEDIA_DOWNLOAD_FAILED_REPLY = '📷 น้องยังรับรูปจาก LINE ไม่สำเร็จค่ะ ยังไม่ได้บันทึกรายการใด ๆ จากรูปนี้นะคะ รบกวนส่งรูปเดิมอีกครั้งค่ะ';
/** The media turn failed somewhere after the bytes arrived, so the record state is uncertain —
 *  no "nothing was saved" promise here; the duplicate-file warning covers an honest resend. */
const MEDIA_PROCESSING_FAILED_REPLY = '📷 ขออภัยค่ะ ระบบประมวลผลรูปนี้ไม่สำเร็จ รบกวนส่งรูปเดิมอีกครั้งนะคะ ถ้ารูปนี้เคยบันทึกไว้แล้ว ระบบจะแจ้งเตือนรายการซ้ำให้ค่ะ';
const RATE_LIMIT_REPLY = '⏳ ระบบกำลังประมวลผลข้อความก่อนหน้า กรุณารอสักครู่แล้วลองใหม่อีกครั้งนะคะ';
/** Post-OCR branch ambiguity (multi-branch company, no defaultable head office): the read
 *  succeeded, only the branch decision is missing — send the user to the web picker honestly. */
const RECEIPT_BRANCH_REQUIRED_REPLY = '🧾 อ่านใบเสร็จได้แล้วค่ะ แต่บริษัทมีหลายสาขาและน้องเลือกให้เองไม่ได้ รบกวนบันทึกผ่านเว็บแล้วเลือกสาขานะคะ';
/** Sent INSTEAD of RATE_LIMIT_REPLY when the turn's ledger entry exists: the reclaim drain WILL
 *  answer it, so telling the user to resend would produce a double answer (UAT 2026-08-27). */
const BUSY_FOLLOW_UP_REPLY = '⏳ น้องมั่งมีกำลังตอบข้อความก่อนหน้าอยู่ค่ะ ข้อความนี้รับไว้แล้ว เดี๋ยวตามมาตอบให้เองนะคะ ไม่ต้องส่งซ้ำค่ะ';
/** How long a live turn may wait for the per-company AI admission lease before giving up. The
 *  lease frees between a media turn's model calls, so a queued chat message usually slips into
 *  one of those gaps well inside this window; LINE's loading indicator covers the wait. */
const LINE_AI_LIVE_BUSY_WAIT_MS = 25_000;
const RECEIPT_LINK_REPLY = '🔗 กรุณาเชื่อมต่อบัญชี มั่งมีพลัส กับ LINE ก่อนส่งบิลหรือใบเสร็จนะคะ';
const RECEIPT_FORBIDDEN_REPLY = '🔒 คุณไม่มีสิทธิ์อัปโหลดบิลหรือใบเสร็จผ่าน LINE ค่ะ';
const EXPENSE_FEATURE_DISABLED_REPLY = '📋 บริษัทนี้ยังไม่ได้เปิดใช้งานระบบค่าใช้จ่ายและเอกสารค่ะ\nหากต้องการใช้ ให้เจ้าของหรือผู้ดูแลเปิดฟีเจอร์ในเว็บแอปก่อนนะคะ';
/**
 * The CLOSED-route copy the runbook left unwritten (`feature-launch-control.md` OPEN-9).
 *
 * Constraints it has to satisfy, from spec CC1 via runbook §2.3: it says *temporarily unavailable*,
 * never "not purchased" — that stays `EXPENSE_FEATURE_DISABLED_REPLY`'s wording. It names no route
 * key, gate, generation or environment (a customer surface may not see control-plane state), and it
 * points at the channel that still works so a closed AI lane does not read as a dead product.
 */
const LAUNCH_ROUTE_CLOSED_REPLY = '🔧 ตอนนี้ผู้ช่วยพักให้บริการชั่วคราวค่ะ\nระหว่างนี้ยังใช้งานผ่านเว็บแอปได้ตามปกติ และเราจะกลับมาให้บริการเร็ว ๆ นี้นะคะ';
const ASSISTANT_TALK_GREETING = 'สวัสดีค่ะ 😊 น้องมั่งมีมาแล้วนะคะ\nวันนี้มีอะไรให้น้องช่วยแบ่งเบาบ้าง บอกได้เลยค่ะ 💚';
const SIGNATURE_FORBIDDEN_REPLY = '🔒 คุณไม่มีสิทธิ์เก็บลายเซ็นประจำตัวผ่าน LINE ค่ะ';
const SIGNATURE_NEED_IMAGE_REPLY = '✍️ ต้องการอัปโหลดลายเซ็นใช่ไหมคะ กรุณาส่ง "รูปลายเซ็น" เข้ามาในแชทนี้ได้เลยนะคะ\nระบบจะเก็บเป็นลายเซ็นประจำตัวของคุณ ใช้ลงนามได้ทันทีค่ะ';
const CLARIFY_REPLY = '🤔 น้องมั่งมียังไม่แน่ใจว่าต้องการทำอะไรกับข้อความ/รูปนี้ค่ะ\n• ถ้าเป็นหลักฐานค่าใช้จ่าย (ใบเสร็จ/สลิป/บิล/สกรีนช็อต) ส่งรูปอีกครั้งพร้อมข้อความ เช่น "บันทึกค่าใช้จ่าย"\n• ถ้าต้องการเก็บลายเซ็นประจำตัว ส่งรูปอีกครั้งพร้อมข้อความ เช่น "อัปโหลดลายเซ็น"';
const MUTATION_REFUSAL_REPLY = '🔒 น้องมั่งมีไม่สามารถทำรายการอนุมัติ/จ่ายเงิน/ลงบัญชี หรือยื่นภาษีได้ค่ะ\nกรุณาทำรายการในเว็บแอป MangmeePlus นะคะ';
const MEDIA_UNSUPPORTED_REPLY = 'ℹ️ ระบบรองรับ: ส่งรูป/ไฟล์หลักฐานค่าใช้จ่ายเพื่อบันทึกร่าง หรือส่งรูปลายเซ็นเพื่อเก็บเป็นลายเซ็นประจำตัวค่ะ\nการยืนยัน/จ่ายเงิน/ลงบัญชีต้องทำในเว็บแอปนะคะ';
const MEDIA_SECURITY_REJECTED_REPLY = '⚠️ ไม่สามารถรับไฟล์นี้ได้ค่ะ กรุณาส่งไฟล์ PDF, PNG, JPG หรือ JPEG ที่ไฟล์ไม่เสียหายและผ่านการตรวจสอบความปลอดภัยนะคะ';
/** RECEIPT-05 (owner decision 2026-07-12): the ONE clarify question asked when media arrives
 *  with a business-question caption, instead of silently discarding the image. */
const MEDIA_CLARIFY_REPLY = [
  '🤔 รูปนี้เป็นอะไรคะ ตอบเลขข้อได้เลยนะคะ',
  '1) ใบเสร็จ/เอกสารค่าใช้จ่ายรายการเดียวที่ต้องการบันทึก',
  '2) ภาพประกอบคำถาม ไม่ต้องบันทึก',
  '3) สรุปหลายรายการ (เก็บไฟล์ไว้ตรวจ แต่ยังไม่สร้างค่าใช้จ่าย)',
].join('\n');

/** Keep a governed OCR refusal useful: the attachment remains recoverable and the same simple
 * numbered manual path stays available. Internal route/config names never reach the customer.
 * `readFailed` marks a transient read failure (timeout/empty/truncated output): the honest lead-in
 * is "the read failed", not the bare "what is this picture?" that reads as if the photo were the
 * problem (owner UX review 2026-08-29). */
export function formatOcrGovernanceClarifyReply(errorCode?: string, readFailed = false): string {
  const notice = errorCode === 'OCR_FEATURE_DISABLED'
    ? '🤖 บริษัทปิดการอ่านเอกสารด้วย AI ไว้ค่ะ ระบบยังเก็บไฟล์นี้ไว้ได้ แต่จะไม่อ่านข้อมูลให้อัตโนมัติ'
    : errorCode === 'OCR_MONTHLY_LIMIT_EXCEEDED'
      ? '📊 บริษัทใช้สิทธิ์อ่านเอกสารด้วย AI ครบเดือนนี้แล้วค่ะ ระบบยังเก็บไฟล์นี้ไว้ได้ แต่จะไม่อ่านข้อมูลให้อัตโนมัติ'
      : errorCode === 'OCR_QUOTA_UNAVAILABLE'
        ? '⏳ ระบบตรวจสอบสิทธิ์การอ่านเอกสารไม่ได้ชั่วคราวค่ะ ระบบยังเก็บไฟล์นี้ไว้ได้ แต่จะไม่อ่านข้อมูลให้อัตโนมัติ'
        : errorCode === 'OCR_REQUEST_ALREADY_ADMITTED'
          ? '✅ ระบบรับคำขออ่านเอกสารนี้ไว้แล้วค่ะ เพื่อป้องกันการนับซ้ำ จึงไม่ส่งอ่านซ้ำ'
          : readFailed
            ? '📷 น้องอ่านรูปนี้ไม่สำเร็จค่ะ ระบบอ่านเอกสารขัดข้องชั่วคราว รูปยังเก็บไว้ให้และยังไม่ได้บันทึกรายการนะคะ'
            : null;
  return notice ? `${notice}\n\n${MEDIA_CLARIFY_REPLY}` : MEDIA_CLARIFY_REPLY;
}
/** §11 escape: the picture answered a question and is not evidence of anything. Same outcome the
 *  receipt clarify's choice 2 has always had — the bytes stay stored, nothing is recorded. */
const MEDIA_NOT_RECORDED_REPLY = '🖼️ รับทราบค่ะ เก็บรูปไว้เฉยๆ ไม่ได้บันทึกเป็นหลักฐานของรายการไหน';
const TEXT_EXPENSE_CLARIFY_REPLY = '🧾 ยังไม่สร้างรายการนะคะ กรุณาระบุยอดเงินและวัตถุประสงค์หรือหมวดค่าใช้จ่ายให้ครบ เช่น “ค่าเดินทาง 200 บาท”';
/** Field-specific clarifications (spec §8.2): a field the gate ALREADY accepted is never asked again —
 *  that re-ask is the UAT defect where an accepted `60` was demanded a second time. */
const TEXT_EXPENSE_AMOUNT_ONLY_REPLY = '🧾 รับรายการแล้วค่ะ ขอทราบยอดเงินด้วยนะคะ เช่น “60 บาท”';
const TEXT_EXPENSE_PURPOSE_ONLY_REPLY = '🧾 รับยอดเงินแล้วค่ะ ขอทราบรายการหรือวัตถุประสงค์ด้วยนะคะ เช่น “ค่าวินไปพบลูกค้า”';
const TEXT_EXPENSE_AMOUNT_CONFLICT_REPLY = '🧾 ยังไม่สร้างรายการนะคะ ตอนนี้มียอดเงินมากกว่าหนึ่งจำนวนในบทสนทนา ถ้าต้องการเปลี่ยนยอด พิมพ์ว่า “แก้ยอดเป็น … บาท” ได้เลยค่ะ';
/** Spec §11.2: the deterministic Nong Mangmee answer to an exact standalone greeting — zero model calls. */
const EXACT_GREETING_REPLY = 'สวัสดีค่ะ 😊 วันนี้มีอะไรให้น้องมั่งมีช่วยไหมคะ?';
/** Reimbursement semantic intake: canonical server copy persisted/ledgered for each outcome. The Flex cards
 *  own their own wording; these are the previews recorded before delivery. LINE never creates the record. */
const REIMBURSEMENT_PAYER_CLARIFY_REPLY = 'รายการนี้ใครเป็นคนจ่ายคะ? ตอบกลับได้เลยว่า “เบิกคืน” หรือ “บริษัทจ่าย”';
const REIMBURSEMENT_CLARIFY_ONLY_REPLY = '🧾 เข้าใจว่าต้องการเบิกคืนค่าใช้จ่ายที่จ่ายส่วนตัวไปก่อนค่ะ\nน้องมั่งมียังไม่ได้สร้างรายการเบิกคืนให้ และการส่งต่อไปกรอกในเว็บยังไม่เปิดใช้งานในตอนนี้ค่ะ';
const REIMBURSEMENT_HANDOFF_REPLY = 'น้องมั่งมียังไม่ได้สร้างรายการเบิกคืนให้นะคะ กรุณาเปิดหน้าเว็บเพื่อตรวจสอบและกรอกรายละเอียดการเบิกคืนด้วยตนเอง ระบบจะสร้างรายการเมื่อกดบันทึกในเว็บเท่านั้นค่ะ';
const REIMBURSEMENT_HANDOFF_FORBIDDEN_REPLY = '🔒 ยังไม่สามารถส่งต่อการเบิกคืนค่าใช้จ่ายผ่าน LINE สำหรับบริษัทนี้ได้ค่ะ';
/** LINE hard limits: at most 5 messages per reply, at most 5000 characters in a text message. */
const LINE_MAX_MESSAGES_PER_REPLY = 5;
const LINE_TEXT_MESSAGE_MAX_CHARS = 5000;
/** What a Flex bubble body actually keeps (`bounded(card.text, 1_200)` in line-business-card.logic). */
const LINE_FLEX_CARD_BODY_MAX_CHARS = 1_200;
/** Spec §10.1: when the terminal reply is longer than a Flex body holds, the FULL text ships as text and
 *  this short server-owned card closes the turn after it. It deliberately does NOT restate or summarise
 *  the content — a second, shorter version of a financial answer is a second claim about the money. */
const MULTIPART_TERMINAL_FLEX_CLOSER = '✅ ส่งรายละเอียดครบแล้วค่ะ ข้อความเต็มอยู่ด้านบนนี้ค่ะ';
/** One turn that both captured an expense and ran the substitute continuation reports both outcomes
 *  under this separator; the capture stands on its own when the continuation cannot be evaluated. */
const SUBSTITUTE_ADDITIONAL_OUTCOME_LABEL = 'ผลคำขอเพิ่มเติม:';
const SUBSTITUTE_ADDITIONAL_OUTCOME_DEGRADED = '⏳ ส่วนใบรับรองแทนใบเสร็จรับเงินยังตรวจสอบไม่ได้ชั่วคราว รายการค่าใช้จ่ายด้านบนยังบันทึกสำเร็จและตรวจสอบได้ในเว็บ';
/** R2: the ledger marker for “this chat asked for a ใบรับรองแทนใบเสร็จรับเงิน before there was any
 *  expense to make it for”. It is deliberately a DIFFERENT request text from the resume entry above:
 *  that one has a target and must keep capture-first off, this one has none and is the reason
 *  capture-first has to run on the very next message. */
const SUBSTITUTE_TARGET_PENDING_TEXT = 'ทำใบรับรองแทนใบเสร็จรับเงิน (ยังไม่มีรายการค่าใช้จ่าย)';
const SUBSTITUTE_TARGET_PENDING_QUESTION = 'ค่าใช้จ่ายที่จะทำใบรับรองแทนใบเสร็จรับเงินให้คือรายการไหน ยอดเท่าไรคะ? เช่น “ค่าวินมอไซค์ 50 บาท”';
/** RECEIPT-05: how long a pending media-clarify row waits for the customer's answer. */
const PENDING_MEDIA_TTL_MINUTES = 30;
/** Stands in for the request when a picture arrives with no caption — the file IS the ask. */
const MEDIA_PENDING_REQUEST_TEXT = 'ไฟล์ที่ผู้ใช้ส่งมาโดยยังไม่ได้ระบุคำถาม';
const PENDING_MEDIA_RESOLUTION = Symbol('pendingMediaResolution');

/** Same chatKey the text path and the message buffer use: the group, else the person. */
function mediaChatKey(event: LineReceiptUploadEvent): string {
  return event.pushTargetId ?? event.lineUserId;
}

/** RECEIPT-05's own numbered question, recorded on the row it belongs to. The pending row is scoped
 *  per user while conversations are per chat, so the chat is part of the record: an answer typed in
 *  a different chat must not resolve bytes that were questioned in this one. */
function receiptClarifyQuestion(event: { lineUserId: string; pushTargetId?: string }): Record<string, unknown> {
  return { kind: 'RECEIPT_CLARIFY', chatKeyHash: chatKeyHashOf(event) };
}

/**
 * Multi-turn memory preview for a media turn. Naming the stored attachment is the difference
 * between the model knowing "a picture was mentioned" and knowing "this exact file is on the
 * server" — without the id it can only ask the customer to send it again.
 */
function mediaPreviewLabel(pending?: { attachmentId: string } | null): string {
  return pending ? `[ผู้ใช้ส่งรูป/ไฟล์ #${pending.attachmentId}]` : '[ผู้ใช้ส่งรูป/ไฟล์]';
}
/** Preview length stored per turn for multi-turn memory (columns are unbounded text). */
const PREVIEW_MAX_CHARS = 240;
const COMPANY_SELECTION_PENDING_STATUSES = new Set([
  'needs_company_selection',
  'company_context_listed',
  'company_context_selection_invalid',
]);
/** How far back a correction may reach. Older records are corrected in web. */
const CORRECTION_CANDIDATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const LINE_MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000;

type ReceiptOcrPreflight = {
  status: 'OCR_EXTRACTED_NEEDS_REVIEW' | 'NOT_CONFIGURED' | 'OCR_FAILED' | 'NOT_REQUESTED';
  fields: ReceiptOcrFieldResult | null;
  classification: BusinessDocumentClassification | null;
  /** Gateway reason for a failed read (OCR_EMPTY_OUTPUT, PROVIDER_TIMEOUT, …). Absent when the
   *  gateway call itself threw — that case is OCR_FAILED with no code. */
  errorCode?: string;
};

type DownloadedLineMedia = {
  fileName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256?: string;
  contentBase64?: string;
  bytes: Buffer;
};

/** Reads a fetch body without ever retaining more than `maxBytes`. This is the authoritative
 *  limit for chunked responses whose Content-Length is absent or dishonest. */
export async function readResponseBodyLimited(response: Pick<Response, 'body'>, maxBytes: number): Promise<Buffer | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } finally {
    reader.releaseLock();
  }
}

type LineBusinessDocumentDecision =
  | { outcome: 'expense'; manualReview: boolean; classification: BusinessDocumentClassification | null }
  | { outcome: 'reference' | 'unsupported'; classification: BusinessDocumentClassification | null }
  | { outcome: 'clarify'; persistMedia: boolean; classification: BusinessDocumentClassification | null };

/** Final API-side decision. The router and OCR are advisory; only this decision may reach
 * initReceiptUpload. A strong OCR result may recover an uncaptioned image when routing fails;
 * otherwise provider failure needs a routed expense caption and creates manual review only. */
function decideLineBusinessDocument(
  routePlan: LineIntakeRoutePlan,
  ocr: ReceiptOcrPreflight,
  hasCaption: boolean,
): LineBusinessDocumentDecision {
  const classification = ocr.classification ?? routePlan.documentClassification ?? null;
  if (routePlan.status !== 'ROUTED') {
    if (
      !hasCaption
      && ocr.status === 'OCR_EXTRACTED_NEEDS_REVIEW'
      && ocr.classification
      && isExpenseExtractionEligible(ocr.classification, ocr.fields?.grandTotalAmount)
    ) {
      return { outcome: 'expense', manualReview: false, classification: ocr.classification };
    }
    return { outcome: 'clarify', persistMedia: true, classification };
  }
  if (routePlan.intent === 'BUSINESS_DOCUMENT_REFERENCE') return { outcome: 'reference', classification };
  if (routePlan.intent !== 'EXPENSE_DOCUMENT_CAPTURE') return { outcome: 'unsupported', classification };

  if (classification?.contentKind === 'MULTI_DOCUMENT') {
    return { outcome: 'clarify', persistMedia: true, classification };
  }

  if (ocr.status !== 'OCR_EXTRACTED_NEEDS_REVIEW' || !ocr.classification) {
    return { outcome: 'clarify', persistMedia: true, classification };
  }
  if (isExpenseExtractionEligible(ocr.classification, ocr.fields?.grandTotalAmount)) {
    return { outcome: 'expense', manualReview: false, classification: ocr.classification };
  }
  if (ocr.classification.requiresClarification || ocr.classification.contentKind !== 'DOCUMENT') {
    return { outcome: 'clarify', persistMedia: false, classification: ocr.classification };
  }
  return { outcome: 'reference', classification: ocr.classification };
}

function formatBusinessDocumentReply(
  classification: BusinessDocumentClassification | null,
  webBaseUrl: string | undefined,
  companyId: string,
): string {
  if (!classification) return MEDIA_CLARIFY_REPLY;
  if (classification.contentKind === 'MULTI_DOCUMENT') return '📄 พบเอกสารมากกว่า 1 ฉบับในภาพ กรุณาถ่ายแยกเอกสารละ 1 ภาพ เพื่อไม่ให้ยอดหรือร้านค้าถูกรวมผิดค่ะ';
  if (classification.contentKind === 'UNREADABLE') return '📷 ยังอ่านเอกสารนี้ได้ไม่ชัด กรุณาถ่ายใหม่ให้เห็นทั้งใบ ภาพตรง ไม่เบลอ และไม่มีแสงสะท้อนค่ะ';
  switch (classification.documentKind) {
    case 'ORDER_OR_CHECK_BILL':
      return classification.missingRequiredSignals.includes('MISSING_MONETARY_AMOUNT')
        || classification.missingRequiredSignals.includes('MISSING_TRANSACTION_TOTAL')
        ? '🧾 เอกสารนี้เป็นรายการสั่งซื้อ/เช็กบิล แต่ยังไม่พบยอดเงินรวม จึงยังไม่บันทึกเป็นค่าใช้จ่าย กรุณาส่งบิลหรือใบเสร็จฉบับสุดท้ายที่มีจำนวนเงินค่ะ'
        : '🧾 เอกสารนี้เป็นรายการสั่งซื้อ/เช็กบิลที่ยังไม่ยืนยันการรับชำระ จึงไม่จัดเป็นใบเสร็จ กรุณาส่งใบเสร็จฉบับสุดท้าย หรือระบุให้บันทึกเป็นบิลค้างชำระค่ะ';
    case 'QUOTATION':
    case 'PURCHASE_ORDER':
    case 'DELIVERY_NOTE':
      return `📄 พบว่าเป็นใบเสนอราคา/ใบสั่งซื้อ/ใบส่งของ ซึ่งยังไม่ใช่หลักฐานค่าใช้จ่ายฉบับสุดท้าย ระบบจึงไม่สร้างร่างค่าใช้จ่าย\nตรวจสอบงานขาย/บัญชีในเว็บ: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/accounting`)}`;
    case 'APPOINTMENT_CARD':
    case 'BOOKING_CONFIRMATION':
    case 'RESERVATION_CONFIRMATION':
      return `📅 พบเอกสารนัดหมาย/การจอง จึงไม่สร้างร่างค่าใช้จ่ายหรือยืนยันการจองอัตโนมัติ\nตรวจสอบการจองในเว็บ: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/bookings`)}`;
    case 'NON_FINANCIAL_IMAGE':
      return '🖼️ รูปนี้ไม่ใช่เอกสารค่าใช้จ่ายหรือเอกสารธุรกิจ จึงไม่ได้สร้างรายการใดๆ ค่ะ';
    default:
      if (classification.missingRequiredSignals.includes('MISSING_MONETARY_AMOUNT') || classification.missingRequiredSignals.includes('MISSING_TRANSACTION_TOTAL')) {
        return '🧾 ยังไม่พบยอดเงินรวมที่เป็นบวก จึงยังไม่บันทึกเป็นค่าใช้จ่าย กรุณาส่งเอกสารฉบับที่เห็นยอดชำระชัดเจนค่ะ';
      }
      return 'ℹ️ เอกสารนี้ยังไม่ผ่านเกณฑ์หลักฐานค่าใช้จ่าย ระบบจึงยังไม่สร้างร่าง กรุณาส่งฉบับที่ชัดเจนหรือระบุวัตถุประสงค์ในข้อความค่ะ';
  }
}

function formatCheckBillDecisionReply(): string {
  return [
    '🧾 รูปนี้ยังไม่ใช่ใบเสร็จค่ะ',
    'ใบนี้บอกยอดที่ต้องจ่าย แต่ยังไม่ยืนยันว่าร้านรับเงินแล้ว',
    'ตอนนี้ยังไม่สร้างรายการค่าใช้จ่ายนะคะ',
    '',
    CHECK_BILL_PAYMENT_QUESTION,
    ...CHECK_BILL_PAYMENT_CHOICES.map((choice, index) => `${index + 1}) ${choice}`),
  ].join('\n');
}

export function buildCheckBillDecisionQuickReply(): NonNullable<LineReplyMessage['quickReply']> {
  return {
    items: [
      { type: 'action', action: { type: 'message', label: 'จ่ายแล้ว ไม่ได้ใบ', text: '1' } },
      { type: 'action', action: { type: 'message', label: 'ยังไม่ได้จ่าย', text: '2' } },
      { type: 'action', action: { type: 'message', label: 'มีใบเสร็จ ส่งใหม่', text: '3' } },
    ],
  };
}

function buildCheckBillReceiptUploadQuickReply(): NonNullable<LineReplyMessage['quickReply']> {
  return {
    items: [
      { type: 'action', action: { type: 'cameraRoll', label: 'เลือกรูปใบเสร็จ' } },
      { type: 'action', action: { type: 'camera', label: 'ถ่ายรูปใบเสร็จ' } },
    ],
  };
}

export function formatCheckBillDraftCreatedReply(
  continuation: Pick<LineSubstituteReceiptContinuationResult, 'status' | 'replyText' | 'pendingQuestion'>,
): string {
  const hardFailure = ['FORBIDDEN', 'INELIGIBLE', 'STALE'].includes(continuation.status);
  if (hardFailure || !continuation.pendingQuestion) {
    return `✅ สร้างร่างค่าใช้จ่าย 1 รายการแล้วค่ะ\n\n${continuation.replyText}`;
  }
  return [
    '✅ สร้างร่างค่าใช้จ่าย 1 รายการแล้วค่ะ',
    'เก็บเช็กบิลใบเดิมเป็นหลักฐานประกอบ และไม่สร้างรายการซ้ำ',
    '',
    'ต่อไปถามทีละข้อนะคะ',
    continuation.pendingQuestion,
  ].join('\n');
}

/**
 * A signature is personal and usable the moment it is saved (owner decision 2026-08-20), so there
 * is one reply, not two. `steerToPendingDecision` is set when the photo answered the substitute
 * flow's own ask: that chat has a decision waiting, and leaving the sender at "saved!" would strand
 * Journey A one keystroke from the document it was about.
 */
function formatSignatureTicketReply(
  webBaseUrl: string | undefined,
  companyId: string,
  signatureId: string,
  steerToPendingDecision = false,
): string {
  const link = absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/signatures?signatureId=${signatureId}`);
  return [
    '✍️ รับรูปลายเซ็นแล้ว และบันทึกเป็นลายเซ็นประจำตัวให้แล้ว',
    'สถานะ: ใช้ลงนามเอกสารได้ทันที ไม่ต้องรออนุมัติ',
    ...(steerToPendingDecision ? ['', 'ตอบ 1 เพื่อออกเอกสารต่อได้เลยค่ะ'] : []),
    '',
    `เปิดดูลายเซ็น:\n${link}`,
  ].join('\n');
}

type LineCompanyMembership = {
  companyId: string;
  company?: { name: string; brandName?: string | null } | null;
  roles?: Array<{ role?: { key: string; name?: string } | null }>;
};

export async function putLineMediaUpload(
  intent: { uploadUrl: string; uploadMethod: string; uploadHeaders?: Record<string, string> },
  media: { mimeType: string; bytes: Buffer },
  publicApiBaseUrl?: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (intent.uploadMethod !== 'PUT') throw new Error('LINE_MEDIA_UPLOAD_METHOD_UNSUPPORTED');
  const uploadUrl = absoluteWebLink(publicApiBaseUrl, intent.uploadUrl);
  if (!/^https?:\/\//i.test(uploadUrl)) throw new Error('LINE_MEDIA_UPLOAD_URL_INVALID');
  const response = await fetcher(uploadUrl, {
    method: 'PUT',
    headers: { ...intent.uploadHeaders, 'Content-Type': media.mimeType },
    body: new Uint8Array(media.bytes),
  });
  if (!response.ok) throw new Error(`LINE_MEDIA_STORAGE_UPLOAD_FAILED_${response.status}`);
}

/** Bounded hash of the chat a capture happened in (group id when present, else the user).
 *  Corrections may only target records captured in the SAME chat, and the raw LINE/group id
 *  must never reach the expense row — only this hash. */
/**
 * NARROW substitute matcher for the PRIMARY-mode fallback ONLY (never the broad legacy matcher): a
 * canonical substitute-receipt document NAME, or an exact stateful control when real open state permits.
 * A question or negation can never match, so it can only continue/control an intent that is already
 * canonical — it can never START from a paraphrase.
 */
export function isCanonicalSubstituteCommand(text: string, hasOpenState: boolean): boolean {
  // NFC (not NFKC) so precomposed Thai action verbs (ทำ etc.) still match the precomposed regex literals.
  const t = text.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('th-TH');
  const isQuestionOrNegation = /(อะไร|คือ|ยังไง|ไหม|มั้ย|ไม่ทำ|ไม่เอา|ยังไม่|ไม่อยาก)/u.test(t);
  if (isQuestionOrNegation) return false;
  // The narrow UNAVAILABLE fallback matches ONLY an EXACT command shape — an optional action verb plus the
  // EXACT legal document name plus an optional polite suffix, ANCHORED to the whole message. An arbitrary
  // sentence that merely MENTIONS the name (or a loose form ใบทดแทน/ใบแทน/ใบรับรองแทนเงินสด) never matches
  // and must go through semantic confirmation instead. Plus exact stateful controls when open state permits.
  const exactCommand = /^(ทำ|ขอ|ออก|สร้าง|เริ่ม|จัดทำ|ขอทำ|ขอออก)?\s*ใบรับรองแทนใบเสร็จ(?:รับเงิน)?\s*(ต่อ|ให้|ให้หน่อย|หน่อย|ค่ะ|ครับ)?$/u.test(t);
  const stateControl = hasOpenState && /^(พัก|พักไว้ก่อน|ยกเลิก|ยกเลิกงานนี้|ทำต่อ|ทำใบรับรองต่อ)$/u.test(t);
  return exactCommand || stateControl;
}

/**
 * Spec §11.2 / plan Phase 6B: the VERSIONED exact standalone greeting allowlist. Membership is
 * whole-message equality against `normalizeLineText` output (trimmed, whitespace-collapsed, lowercased) —
 * never a substring or a regex, so “สวัสดีเบิกค่าโดยสารหน่อย” and a greeting whose second line is business
 * text both stay on the normal semantic route (a newline collapses to a space, so it cannot match either).
 * Adding an entry is a deliberate version bump; this lane must never grow into a synonym engine that tries
 * to understand business language.
 */
const EXACT_STANDALONE_GREETINGS_V1: readonly string[] = ['สวัสดี', 'สวัสดีค่ะ', 'สวัสดีครับ'];

/** NFC (not NFKC) for the same reason as the substitute matcher: NFKC decomposes precomposed Thai vowels. */
export function isExactStandaloneGreeting(normalizedText: string): boolean {
  return EXACT_STANDALONE_GREETINGS_V1.includes(normalizedText.normalize('NFC'));
}

/**
 * Spec §8.2: ONE short question built from the typed incomplete result, never a fixed catch-all.
 * Enum-driven, so the question can never echo conversation text or a financial value. A conflict wins
 * over a missing field (an unresolved 60-vs-200 makes every other answer premature), and a legacy
 * fieldless error still falls back to the exact previous copy.
 */
export function formatTextExpenseClarifyReply(error: LineTextExpenseCaptureIncompleteError): string {
  if (error.conflictingFields.includes('amount')) return TEXT_EXPENSE_AMOUNT_CONFLICT_REPLY;
  const needsAmount = error.missingFields.includes('amount');
  const needsPurpose = error.missingFields.includes('description') || error.missingFields.includes('purpose');
  if (needsAmount && !needsPurpose) return TEXT_EXPENSE_AMOUNT_ONLY_REPLY;
  if (needsPurpose && !needsAmount) return TEXT_EXPENSE_PURPOSE_ONLY_REPLY;
  return TEXT_EXPENSE_CLARIFY_REPLY;
}

/** Bounded affirmative confirmation to a pending substitute-start question (never a negation). */
export function isAffirmativeText(text: string): boolean {
  const t = text.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('th-TH');
  // Negative guard FIRST: any negation/cancel token vetoes, so "ไม่ใช่", "ยังไม่เอา", "ไม่ทำ" never affirm.
  if (/(ไม่|ยกเลิก|ยังไม่)/u.test(t)) return false;
  // Bounded set of natural Thai/English affirmatives (polite particles allowed). Anchored — a longer
  // sentence that merely contains "ใช่" is NOT a bare confirmation.
  return /^(ใช่|ใช่ค่ะ|ใช่ครับ|ใช่จ้า|ใช่เลย|ทำเลย|เริ่มเลย|เริ่ม|ได้เลย|ได้|ทำ|เอา|เอาเลย|ตกลง|ยืนยัน|โอเค|โอเคค่ะ|โอเคครับ|ok|okay|yes|y)$/u.test(t);
}

export function chatKeyHashOf(event: { lineUserId: string; pushTargetId?: string }): string {
  return hashMessagePreview(event.pushTargetId ?? event.lineUserId);
}

/** Shape label recorded on the durable outcome, using the same vocabulary the presentation manifest
 *  in `scripts/line-ai-latency-autonomy.corpus.ts` pins, so an ops row and a corpus row read alike. */
export function presentationKindOf(messages: LineReplyMessage[]): string {
  const hasFlex = messages.some((message) => message.type === 'flex');
  if (!hasFlex) return 'text';
  return messages.some((message) => message.type === 'text') ? 'text_parts_then_flex' : 'flex';
}

/** The canonical text of a Flex message is its own `altText` — LINE's designated plain-text
 *  equivalent, written by the SAME builder that wrote the bubble. Nothing is invented here and no
 *  model is called: a card LINE refused to render is re-sent as the words it already declared, with
 *  its quick reply intact so the completion menu survives the downgrade.
 *
 *  ponytail: `altText` is `preview(text, 400)` in line-business-card.logic.ts, so a card body longer
 *  than 400 characters falls back to its VISIBLY marked ("…") preview rather than the full body —
 *  short of §10.2's lossless bar, but strictly more than the silence it replaces, and on the
 *  multi-part lane the long text already shipped as text before the card. Give the card builders a
 *  canonical-text field the day a fallback delivery is observed losing content. */
export function toCanonicalTextMessages(messages: LineReplyMessage[]): LineReplyMessage[] {
  return messages.map((message) => (message.type === 'flex'
    ? {
        type: 'text' as const,
        text: message.altText,
        ...(message.quickReply ? { quickReply: message.quickReply } : {}),
      }
    : message));
}

export function formatLineReply(response: LineAiTurnResponse, webBaseUrl: string | undefined): string {
  const lines = [response.replyText];
  if (response.sourceLabels.length > 0) {
    // Same Thai label the Flex answer cards use, so the plain-text fallback reads consistently.
    lines.push(`แหล่งข้อมูล: ${response.sourceLabels.slice(0, 5).join(', ')}`);
  }
  const firstLink = response.webLinks[0];
  if (firstLink) {
    lines.push(`เปิดดู: ${firstLink.label} ${absoluteWebLink(webBaseUrl, firstLink.path)}`);
  }
  return lines.join('\n');
}

// The AI Gateway returns a free-form intent string — the model may phrase it (e.g.
// "list_all_products" or Thai text), especially on the item-10B model-driven path. AiTurn.intent
// is a fixed enum, so normalize to a known value (using the refusal signal, else UNKNOWN) so
// persistence never rejects a real turn.
export const AI_TURN_INTENTS = ['READ_SUMMARY', 'READ_DETAIL', 'MUTATION_REQUEST', 'UNSUPPORTED_MODULE', 'FORBIDDEN', 'UNKNOWN'] as const;
export function toAiTurnIntent(rawIntent: string, refusalReason?: string): (typeof AI_TURN_INTENTS)[number] {
  const up = (rawIntent ?? '').toUpperCase();
  if ((AI_TURN_INTENTS as readonly string[]).includes(up)) return up as (typeof AI_TURN_INTENTS)[number];
  if (refusalReason === 'mutation_blocked') return 'MUTATION_REQUEST';
  if (refusalReason === 'feature_disabled' || refusalReason === 'unsupported_module') return 'UNSUPPORTED_MODULE';
  if (refusalReason && /forbidden|permission/i.test(refusalReason)) return 'FORBIDDEN';
  return 'UNKNOWN';
}

/** RECEIPT-05: deterministic resolver for the media-clarify follow-up reply. `receipt` → the
 *  buffered photo was a real expense document; `illustration` → just a picture attached to a
 *  question; `ambiguous` → neither/both matched, so keep the row PENDING and route the reply
 *  normally (never consume the pending row on a guess).
 *  ponytail: substring match over a fixed keyword set — enough for the short yes/no follow-up;
 *  swap for the intake router only if free-form replies start slipping through. */
export function classifyPendingMediaReply(text: string): 'receipt' | 'illustration' | 'multiple' | 'ambiguous' {
  const t = (text ?? '').toLowerCase().trim();
  // The question is numbered, so a lone choice is unambiguous. Anchored to the whole reply on
  // purpose: a bare '1' is an answer, but '1500' or 'จ่ายไป 2 ใบ' is not.
  const numbered = /^(?:(?:อัน|ข้อ|ตัว)?\s*(?:ที่)?\s*)?([123])[.)]?$/.exec(t);
  if (numbered) return numbered[1] === '1' ? 'receipt' : numbered[1] === '2' ? 'illustration' : 'multiple';
  // Thai ordinals are the same answer spelled out, and just as unambiguous against a numbered list.
  if (/^(?:อัน|ข้อ|ตัว)?(?:ที่\s*)?(?:แรก|หนึ่ง)$/.test(t)) return 'receipt';
  if (/^(?:อัน|ข้อ|ตัว)?(?:ที่\s*)?(?:สอง|ที่สอง)$/.test(t)) return 'illustration';
  if (/^(?:อัน|ข้อ|ตัว)?(?:ที่\s*)?(?:สาม|ที่สาม)$/.test(t)) return 'multiple';
  // A substitute-receipt request is a NEW request, never an answer to this question — and every name
  // of that document contains ‘ใบเสร็จ’, which the keyword scan below reads as “yes, it's a receipt”.
  // Claimed, it builds a draft from the PHOTO, drops the amount the sender just typed, and leaves the
  // substitute request with no outcome. Checked after the numbered/ordinal answers so a genuine short
  // reply — ‘1’, ‘ใบเสร็จ’ — still decides the question it was asked.
  if (isSubstituteReceiptConversationText(t)) return 'ambiguous';
  // Detect a refusal FIRST: receipt keywords like 'บันทึก' are substrings of refusals such as
  // 'ไม่ต้องบันทึก' ("no need to save"), so a plain keyword scan would build a draft from an
  // explicit "no". Thai negation is 'ไม่' (NOT the yes/no question particle 'ไหม'); English
  // negations match on word boundaries so 'no' never fires inside 'note'. A refusal is never a
  // receipt — treat it as an illustration and answer the original caption instead.
  const negation = /ไม่|ยกเลิก|\b(?:no|don't|do not|cancel)\b/.test(t);
  const illustration = negation || ['ภาพประกอบ', 'แค่ถาม', 'illustration'].some((k) => t.includes(k));
  const multiple = !negation && ['สรุปหลายรายการ', 'หลายรายการ', 'multiple entries'].some((k) => t.includes(k));
  const receipt = !negation && [
    'ใบเสร็จ', 'บันทึก', 'ใช่', 'receipt', 'บิล', 'สลิป',
    // Named documents. 'เอกสารค่าใช้จ่าย' and 'ค่าใช้จ่าย' are the words the question itself uses —
    // echoing them back used to read as ambiguous, which is how the loop began.
    'ใบกำกับภาษี', 'ใบแจ้งหนี้', 'ใบส่งของ', 'ใบวางบิล', 'เอกสารค่าใช้จ่าย', 'ค่าใช้จ่าย',
    'invoice', 'bill', 'slip', 'tax invoice',
  ].some((k) => t.includes(k));
  if (receipt && !illustration && !multiple) return 'receipt';
  if (illustration && !receipt && !multiple) return 'illustration';
  if (multiple && !receipt && !illustration) return 'multiple';
  return 'ambiguous';
}

export function splitPendingMediaReply(text: string): { decision: 'receipt' | 'illustration' | 'multiple'; remainder: string } | null {
  const match = normalizeLineText(text).match(/^(?:(?:อัน|ข้อ|ตัว)?\s*(?:ที่)?\s*)?([123])[.)]?\s*(?:และ|พร้อม(?:กับ)?|แล้ว)\s*(.+)$/u);
  if (!match?.[2]) return null;
  return { decision: match[1] === '1' ? 'receipt' : match[1] === '2' ? 'illustration' : 'multiple', remainder: match[2].trim() };
}

function canUseAssistantPreview(toolNames: string[] | undefined, permissions: string[]): boolean {
  if (!toolNames || toolNames.length === 0) return true;
  return toolNames.every((toolName) => {
    const meta = LINE_TOOL_REGISTRY.find((tool) => tool.name === toolName);
    return !!meta && hasToolPermissions(meta, permissions);
  });
}

function companyLabel(membership: LineCompanyMembership): string {
  return membership.company?.brandName ?? membership.company?.name ?? 'ไม่ระบุบริษัท';
}

function companyRoleLabels(membership: LineCompanyMembership): string[] {
  return [...new Set((membership.roles ?? [])
    .filter((item): item is { role: { key: string; name?: string } } => !!item.role)
    .sort((a, b) => a.role.key.localeCompare(b.role.key))
    .map(({ role }) => role.name?.trim())
    .filter((name): name is string => !!name))];
}

function findCompanySelection(memberships: LineCompanyMembership[], value: string): LineCompanyMembership | undefined {
  const index = Number(value);
  if (Number.isInteger(index) && index >= 1 && index <= memberships.length) return memberships[index - 1];
  return memberships.find((membership) => membership.companyId === value);
}

/** Item 10F: deterministic amount/date candidates, computed ONCE per turn from the same
 *  normalized text both the intake route and the AI turn will see. Annotation-only – the
 *  text is never rewritten. Returns undefined when the text carries no value tokens so
 *  payloads stay unchanged for value-free messages. */
function computeValueCandidates(normalizedText: string): LineAiValueCandidates | undefined {
  if (!normalizedText) return undefined;
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const candidates = extractValueCandidates(normalizedText, todayIso);
  return candidates.amounts.length > 0 || candidates.dates.length > 0 ? candidates : undefined;
}

const SOURCE_DOC_TYPE_REPLY_LABELS: Record<string, string> = {
  RECEIPT: 'ใบเสร็จรับเงิน',
  TAX_INVOICE: 'ใบกำกับภาษี',
  TRANSFER_SLIP: 'สลิปโอนเงิน',
  HANDWRITTEN_CASH_BILL: 'บิลเงินสดเขียนมือ',
  SUPPLIER_BILL: 'บิลผู้ขาย',
  MARKETPLACE_ORDER_SCREENSHOT: 'สกรีนช็อตคำสั่งซื้อ',
  EXPENSE_NOTE_TEXT: 'โน้ตค่าใช้จ่าย (ข้อความ)',
  SUBSTITUTE_RECEIPT: 'ใบแทนใบเสร็จ',
  OTHER_EXPENSE_DOCUMENT: 'เอกสารค่าใช้จ่ายอื่น',
};

const RECEIPT_CAPTURE_PERMISSIONS = ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.create'] as const;

function receiptFeatureDisabled(access: { permissions: string[]; entitlementDeniedPermissions?: Record<string, string> }): boolean {
  return RECEIPT_CAPTURE_PERMISSIONS.some((permission) => access.entitlementDeniedPermissions?.[permission]);
}

function receiptDeniedReply(access: { permissions: string[]; entitlementDeniedPermissions?: Record<string, string> }): string {
  return receiptFeatureDisabled(access)
    ? EXPENSE_FEATURE_DISABLED_REPLY
    : RECEIPT_FORBIDDEN_REPLY;
}

// `ของ` only counts as goods when it LEADS the phrase (`ซื้อของอะไรบ้าง`). Trailing, it is the
// possessive of a policy question — `…เป็นค่าใช้จ่ายของบริษัทอย่างไร` asks how to book the expense,
// not what was bought, and must keep reaching the vendor/VAT summary.
function isReceiptItemQuestion(text: string): boolean {
  return /(?:ซื้อ|จ่าย|ค่า|มี|รายการ).{0,12}(?:สินค้า|อะไร|รายการ)|(?:สินค้า|ของ|รายการ).{0,12}(?:อะไร|บ้าง|ไหน)|what\s+(?:items?|products?).*(?:bill|receipt)|what.*(?:bill|receipt).*(?:for|contain)/iu.test(text);
}

function receiptItemLines(fields: ReceiptOcrFieldResult | null | undefined): string[] {
  return (fields?.lines ?? []).slice(0, 10).map((line) => {
    const amount = Number(toMoney4(line.amount));
    const amountLabel = Number.isFinite(amount)
      ? amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : line.amount;
    return `• ${line.description} × ${line.quantity} – ${amountLabel}`;
  });
}

/** Same user-facing date shape as the web app, e.g. 25 ก.ค. 2569. */
const THAI_DATE_REPLY_FORMATTER = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
});
function formatReplyDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : THAI_DATE_REPLY_FORMATTER.format(date);
}

function formatPaypersReply(
  webBaseUrl: string | undefined,
  companyId: string,
  expenseId: string,
  options: { hasDuplicate?: boolean; textOnly?: boolean; amount?: string | null; fields?: ReceiptOcrFieldResult | null; categoryName?: string | null; sourceDocumentType?: string | null; questionText?: string } = {},
): string {
  const link = absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`);
  const amountValue = options.fields?.grandTotalAmount ?? options.amount;
  const amount = amountValue && Number(toMoney4(amountValue)) > 0 ? Number(toMoney4(amountValue)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'ยังไม่ระบุ';
  const docType = options.sourceDocumentType ? SOURCE_DOC_TYPE_REPLY_LABELS[options.sourceDocumentType] : undefined;
  const parts = [
    '🧾 บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว (รอตรวจสอบ)',
    '',
    '📋 ข้อมูลที่อ่านได้ตอนนี้:',
    `• ประเภทเอกสาร – ${docType ?? 'รอตรวจสอบ'}`,
    `• ยอดรวม – ${amount}`,
    `• ผู้ขาย/ผู้รับเงิน – ${options.fields?.vendorName ?? 'ยังไม่ระบุ'}`,
    `• วันที่เอกสาร – ${formatReplyDate(options.fields?.expenseDate) ?? 'ยังไม่ระบุ'}`,
    `• เลขที่เอกสาร – ${options.fields?.documentNumber ?? 'ยังไม่ระบุ'}`,
    `• VAT / WHT / ภาษีซื้อ – ${options.fields?.vatAmount ? `VAT ${Number(toMoney4(options.fields.vatAmount)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'รอตรวจสอบ'}`,
    `• หมวดหมู่ค่าใช้จ่าย – ${options.categoryName ?? 'ยังไม่ระบุ'}`,
  ];
  if (options.questionText && isReceiptItemQuestion(options.questionText)) {
    const itemLines = receiptItemLines(options.fields);
    parts.push('', '🛒 รายการที่อ่านได้จากบิล:', ...(itemLines.length > 0
      ? itemLines
      : ['• ยังอ่านรายการสินค้าจากหลักฐานนี้ไม่ได้ชัดเจนค่ะ']));
  }
  if (options.textOnly) {
    parts.push('', '📎 ยังไม่มีไฟล์แนบ – กรุณาแนบรูป/PDF ในเว็บก่อนยืนยันถ้าต้องใช้หลักฐาน');
  }
  if (options.hasDuplicate) {
    parts.push('', '⚠️ พบไฟล์ที่อาจซ้ำกับรายการที่มีอยู่ – กรุณาตรวจสอบก่อนยืนยัน');
  }
  parts.push('', `✅ ตรวจสอบและยืนยันในเว็บแอป:\n${link}`);
  return parts.join('\n');
}

/** §10.1 status row. The record EXISTS but is unconfirmed — the same state the canonical reply's header
 *  prints ("บันทึก…เบื้องต้นแล้ว (รอตรวจสอบ)"), said once, here, and never by a model. */
const EXPENSE_DRAFT_CARD_STATUS = 'ร่าง – รอตรวจสอบและยืนยันในเว็บ';

/** The §10.1 card rows reuse the SAME grounded values `formatPaypersReply` prints, with the same money
 *  rule. A value the capture did not ground is OMITTED — the card leaves the row out rather than
 *  repeating the text reply's 'ยังไม่ระบุ' placeholder as if it were a fact. */
function expenseDraftCardFacts(
  expenseId: string,
  options: { amount?: string | null; fields?: ReceiptOcrFieldResult | null; categoryName?: string | null; item?: string | null } = {},
): LineExpenseDraftCardFacts {
  const amountValue = options.fields?.grandTotalAmount ?? options.amount;
  const amount = amountValue && Number(toMoney4(amountValue)) > 0
    ? `${Number(toMoney4(amountValue)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`
    : undefined;
  const item = options.item ?? options.fields?.vendorName;
  return {
    expenseId,
    ...(amount ? { amount } : {}),
    ...(item ? { item } : {}),
    ...(options.categoryName ? { category: options.categoryName } : {}),
    status: EXPENSE_DRAFT_CARD_STATUS,
  };
}

export function isGroundedReceiptFollowUp(text: string): boolean {
  const normalized = normalizeLineText(text).toLocaleLowerCase('th-TH');
  const currentReference = /(บิลนี้|ใบนี้|ใบเสร็จนี้|เอกสารนี้|รายการนี้|อันนี้|เมื่อกี้)/u.test(normalized);
  const receiptQuestion = /(คืออะไร|ประเภท(?:ไหน|อะไร)|เป็นค่าใช้จ่าย|ลงค่าใช้จ่าย|ใช้กับบริษัท|บันทึก.*บริษัท|vat|ภาษี|เคลม)/iu.test(normalized) || isReceiptItemQuestion(normalized);
  return currentReference && receiptQuestion;
}

export function isInterveningQuestionText(text: string): boolean {
  return /[?？]|ไหม|หรือไม่|อะไร|อย่างไร|ยังไง|เท่าไหร่|กี่/u.test(normalizeLineText(text));
}

function receiptSummaryFields(expense: ExpenseRecordWithRelations): ReceiptOcrFieldResult {
  const summary = expense.aiVerificationSummaryJson;
  const recognized = summary && typeof summary === 'object' ? summary['recognizedFields'] : undefined;
  return recognized && typeof recognized === 'object' ? recognized as ReceiptOcrFieldResult : {};
}

export function formatGroundedReceiptFollowUp(
  webBaseUrl: string | undefined,
  companyId: string,
  expense: ExpenseRecordWithRelations,
  categoryName?: string,
  questionText = '',
): string {
  const fields = receiptSummaryFields(expense);
  const missing = expense.aiVerificationSummaryJson?.['missingFields'];
  const missingFields = Array.isArray(missing) ? missing.filter((item): item is string => typeof item === 'string').slice(0, 10) : [];
  const sourceType = SOURCE_DOC_TYPE_REPLY_LABELS[expense.sourceDocumentType] ?? expense.sourceDocumentType;
  const amount = Number(expense.grandTotalAmount) > 0
    ? Number(expense.grandTotalAmount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : 'ยังไม่ระบุ';
  if (isReceiptItemQuestion(questionText)) {
    const items = receiptItemLines(fields);
    return [
      '🧾 ตอบจากบิลล่าสุดที่บันทึกไว้ในแชทนี้ (ยังรอตรวจสอบ)',
      '',
      ...(items.length > 0 ? items : ['ยังอ่านรายการสินค้าจากหลักฐานนี้ไม่ได้ชัดเจนค่ะ']),
      '',
      `เปิดตรวจสอบรายการ: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expense.id}`)}`,
    ].join('\n');
  }
  const printed = [
    `• ผู้ขาย/ผู้รับเงิน – ${fields.vendorName ?? 'ยังอ่านยืนยันไม่ได้'}`,
    `• วันที่พิมพ์บนเอกสาร – ${formatReplyDate(fields.expenseDate) ?? 'ยังอ่านยืนยันไม่ได้'}`,
    `• เลขที่เอกสาร – ${fields.documentNumber ?? 'ยังอ่านยืนยันไม่ได้'}`,
    `• ยอดจากการอ่านเอกสาร – ${fields.grandTotalAmount ? Number(fields.grandTotalAmount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'ยังอ่านยืนยันไม่ได้'}`,
    `• VAT ที่อ่านได้ – ${fields.vatAmount ? Number(fields.vatAmount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'ยังอ่านยืนยันไม่ได้'}`,
  ];
  return [
    '🧾 ตอบจากรายการที่บันทึกไว้ล่าสุดในแชทนี้',
    '',
    'ข้อมูลที่อ่านจากหลักฐาน (ยังรอตรวจสอบ):',
    ...printed,
    '',
    'สถานะในระบบตอนนี้:',
    `• ประเภทเอกสาร – ${sourceType}`,
    `• ยอดรายการปัจจุบัน – ${amount} ${expense.currency}`,
    `• หมวดค่าใช้จ่าย – ${categoryName ?? expense.expenseCategoryId ?? expense.accountHintKey ?? 'ยังไม่ระบุ'}`,
    `• สถานะหลักฐานภาษี – ${expense.taxEvidenceStatus}`,
    ...(missingFields.length ? ['', `ยังต้องตรวจ: ${missingFields.join(', ')}`] : []),
    '',
    'การนำไปเป็นค่าใช้จ่ายบริษัท: ระบุวัตถุประสงค์/หมวด ตรวจยอดและหลักฐาน แล้วให้ผู้มีสิทธิ์ยืนยันในเว็บ',
    'ข้อมูลบนใบเสร็จเพียงอย่างเดียวไม่ยืนยันนโยบายบริษัทหรือสิทธิเครดิต VAT; ใบรับรองแทนใบเสร็จภายในก็ไม่ใช่ใบกำกับภาษี',
    `เปิดตรวจสอบรายการ: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expense.id}`)}`,
  ].join('\n');
}

/** GAP C tier 2: “ต้องทำยังไงต่อ” with no substitute document in flight, but with an expense this
 *  chat captured. Names the three things that actually exist for THAT record — evidence, review,
 *  ใบรับรองแทนใบเสร็จรับเงิน — instead of the model's “ส่วนนี้ยังไม่พร้อมใช้งานผ่าน LINE”. Each option
 *  is a route the sender can take from this chat, and the substitute one prints the exact words the
 *  deterministic vocabulary listens for. */
export function formatNextStepGuidanceReply(
  webBaseUrl: string | undefined,
  companyId: string,
  candidate: LineIntakeCorrectionCandidate,
): string {
  return [
    '🧭 รายการล่าสุดที่บันทึกไว้ในแชทนี้ยังรอตรวจสอบอยู่ค่ะ',
    '',
    `รายการ: ${candidate.label}`,
    '',
    'ทำต่อได้ 3 ทางค่ะ',
    '1) ส่งรูปใบเสร็จ/สลิปเข้าแชทนี้ หรือแนบไฟล์ในเว็บ เพื่อเก็บเป็นหลักฐาน',
    '2) เปิดในเว็บเพื่อตรวจยอด หมวดค่าใช้จ่าย แล้วให้ผู้มีสิทธิ์ยืนยัน',
    '3) ถ้าไม่มีใบเสร็จ พิมพ์ “ทำใบรับรองแทนใบเสร็จ” เพื่อจัดทำใบรับรองแทนใบเสร็จรับเงินให้รายการนี้',
    '',
    'LINE ยังไม่ได้อนุมัติ จ่ายเงิน หรือลงบัญชีขั้นสุดท้ายให้นะคะ',
    `เปิดรายการนี้: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${candidate.id}`)}`,
  ].join('\n');
}

/** Phase 1 correction outcome: point at the right record, create nothing. Copy depends on what
 *  the caller may actually do in web — ACCOUNTANT/MARKETING can capture via LINE but hold no
 *  `expense.update`, so promising them an edit would be a lie. */
export function formatCorrectionGuidanceReply(
  webBaseUrl: string | undefined,
  companyId: string,
  candidates: LineIntakeCorrectionCandidate[],
  canEdit: boolean,
): string {
  const listLink = absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses`);
  const action = canEdit ? 'เปิดแก้ไขในเว็บแอป' : 'เปิดตรวจสอบ และส่งต่อผู้มีสิทธิ์แก้ไข';
  if (candidates.length === 0) {
    return [
      '📝 ยังไม่พบรายการที่บันทึกไว้ล่าสุดในแชทนี้ที่แก้ไขได้',
      `${action}: ${listLink}`,
    ].join('\n');
  }
  if (candidates.length === 1) {
    const target = candidates[0];
    return [
      '📝 การแก้ไขต้องทำกับรายการเดิม ระบบจึงไม่สร้างรายการใหม่ให้',
      '',
      `รายการล่าสุด: ${target.label}`,
      `${action}:`,
      absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${target.id}`),
    ].join('\n');
  }
  return [
    '📝 การแก้ไขต้องทำกับรายการเดิม ระบบจึงไม่สร้างรายการใหม่ให้',
    '',
    'พบหลายรายการที่แก้ไขได้:',
    ...candidates.map((candidate) => `• ${candidate.label}`),
    '',
    `${action}: ${listLink}`,
  ].join('\n');
}

/** One clarify template for the direction case: the message named a value the record already
 *  holds, so writing either reading would be a guess. */
const CORRECTION_DIRECTION_CLARIFY_REPLY = '🤔 ข้อความมีทั้งค่าเดิมและค่าใหม่ กรุณาระบุให้ชัดว่าต้องการแก้เป็นค่าใดนะคะ (เช่น "แก้เป็น 590")';

const CORRECTION_FIELD_LABELS: Record<string, string> = {
  expenseDate: 'วันที่เอกสาร', amount: 'ยอดรวม', vendorName: 'ผู้ขาย/ผู้รับเงิน',
  documentNumber: 'เลขที่เอกสาร', note: 'รายละเอียด',
};

/** Confirmation names old → new per field, so the user can see exactly what changed. */
export function formatCorrectionAppliedReply(
  webBaseUrl: string | undefined,
  companyId: string,
  expenseId: string,
  fields: Record<string, { from: string | null; to: string }>,
): string {
  const changes = Object.entries(fields).map(([field, change]) => {
    const label = CORRECTION_FIELD_LABELS[field] ?? field;
    const from = field === 'expenseDate' ? formatReplyDate(change.from ?? undefined) : change.from;
    const to = field === 'expenseDate' ? formatReplyDate(change.to) : change.to;
    return `• ${label}: ${from ?? 'ยังไม่ระบุ'} → ${to}`;
  });
  return [
    '✅ แก้ไขรายการเดิมให้แล้ว (ไม่ได้สร้างรายการใหม่)',
    '',
    ...changes,
    '',
    `ตรวจสอบในเว็บแอป:\n${absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`)}`,
  ].join('\n');
}

/** Evidence for the value guards: this message plus the ORIGINAL text of exactly the
 *  clarifications this turn resolved, each replayed with the day it was asked so a relative
 *  reading answered after midnight still resolves the way the user meant. */
export function buildCorrectionEvidence(
  messageText: string,
  openWaiting: Array<LineAiOpenClarification & { entry: LedgerEntry }>,
  resolvedIds: string[] | undefined,
): Array<{ text: string; todayIso: string }> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const resolved = openWaiting
    .filter((item) => resolvedIds?.includes(item.id))
    .map((item) => ({
      text: item.text,
      todayIso: new Date(item.askedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
    }));
  return [{ text: messageText, todayIso: today }, ...resolved];
}

/** Resolve company for a LINE user using ExternalIdentity + LineCompanyContext (shared-OA flow).
 *  Returns companyId or null if the user has no active membership or needs to select company.
 *
 *  Owner decision 2026-08-29: a multi-company user of ANY role may hold LINE company context —
 *  being employee of one company and owner of another used to lock the assistant out entirely.
 *  The selection is still verified against this user's own ACTIVE memberships below, and
 *  per-company authorization stays with the permission resolver and branch ABAC downstream. */
async function resolveCompanyForLineUser(
  prisma: PrismaService,
  userId: string,
  lineUserId: string,
): Promise<{ companyId: string } | { needsSelection: true } | null> {
  const memberships = await prisma.client.companyMembership.findMany({
    where: { userId, status: 'ACTIVE', company: { status: 'ACTIVE' } },
    select: { companyId: true, roles: { select: { role: { select: { key: true } } } } },
    orderBy: { createdAt: 'asc' },
  });

  if (memberships.length === 0) return null;
  if (memberships.length === 1) return { companyId: memberships[0].companyId };

  // Multi-company user: check for selected context
  const ctx = await prisma.client.lineCompanyContext.findUnique({
    where: { lineUserId },
    select: { companyId: true },
  });
  if (!ctx) return { needsSelection: true };

  // Verify the selected company is still in the user's active memberships
  const isValid = memberships.some((m) => m.companyId === ctx.companyId);
  if (!isValid) return { needsSelection: true };

  return { companyId: ctx.companyId };
}

/** ai_line_assistant entitlement gate — the partner-detail feature toggle. Companies with no
 *  entitlement rows at all are legacy fail-open, same convention as loadEntitledFeatureKeys. */
export async function lineAssistantDisabled(prisma: PrismaService, companyId: string): Promise<boolean> {
  return lineAssistantDisabledFor(await loadEntitledFeatureKeys(prisma, companyId));
}

/** Same gate over an already-loaded entitlement set, so a turn that needs the set for other reasons
 *  (capability copy, the completion menu) reads the rows once instead of per consumer. */
export function lineAssistantDisabledFor(entitled: ReadonlySet<string> | null): boolean {
  return entitled !== null && !entitled.has('ai_line_assistant');
}

export const branchScopeFallbackLabel = (branchIds?: string[]) =>
  branchIds?.length ? `${branchIds.length} สาขา` : 'ทุกสาขา';

const bahtText = (amount: string) => {
  const value = Number(amount);
  return Number.isFinite(value)
    ? `${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`
    : `${amount} บาท`;
};

@Injectable()
export class ProcessLineWebhookUseCase {
  private readonly logger = new Logger(ProcessLineWebhookUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly permissionResolver: PermissionResolverService,
    private readonly audit: AuditService,
    private readonly aiGateway: AiGatewayClient,
    private readonly lineReply: LineReplyAdapter,
    private readonly receiptOcrApply: ReceiptOcrApplyService,
    private readonly malwareScanner: AttachmentMalwareScanner,
    private readonly legalAcceptance: LegalAcceptanceService,
    // REQUIRED, and deliberately the last non-optional parameter: an `@Optional()` probe that failed
    // to wire would report zero would_block observations, which R1 cannot distinguish from a route
    // that was measured and never blocked. Absent evidence must fail loudly at boot, not quietly.
    private readonly shadow: LaunchShadowProbe,
    // REQUIRED for the same reason the probe above is: this is the AI lane's kill switch, and an
    // `@Optional()` switch that failed to wire would look exactly like an open route.
    private readonly launchGate: LaunchGateGuardService,
    @Optional() private readonly initReceiptUpload?: InitReceiptUploadUseCase,
    @Optional() private readonly completeReceiptUpload?: CompleteReceiptUploadUseCase,
    @Optional() private readonly captureExpenseNote?: CaptureLineExpenseNoteUseCase,
    @Optional() private readonly initSignatureUpload?: InitSignatureUploadUseCase,
    @Optional() private readonly createSignatureAsset?: CreateSignatureAssetUseCase,
    @Optional() private readonly expenseRepo?: PrismaExpenseRepository,
    @Optional() private readonly ledger?: LineAiLedgerService,
    // RECEIPT-05: generic attachment persistence (bytes without an expense draft) for the
    // media-clarify path. Coordinator must add DataModelCoreModule to LineAiModule.imports.
    @Optional() private readonly createUploadIntent?: CreateUploadIntentUseCase,
    @Optional() private readonly completeAttachmentUpload?: CompleteAttachmentUploadUseCase,
    // Phase 2: applies a correction to the record the user meant. Absent → guidance only.
    @Optional() private readonly correctExpense?: CorrectLineCapturedExpenseUseCase,
    // Receipt continuity: read/preflight and typed web-prefill only; no prepare/issue mutation.
    @Optional() private readonly substituteReceiptContinuation?: LineSubstituteReceiptContinuationUseCase,
    @Optional() private readonly expenseDraftConversation?: LineExpenseDraftConversationUseCase,
    // Counts for the รายการรออนุมัติ card, read through the same permission-checked use cases the
    // web approval screens use. Absent → the card links out without counts.
    @Optional() private readonly reimbursementApprovalQueue?: ListApprovalQueueUseCase,
    @Optional() private readonly listPurchaseRequests?: ListPurchaseRequestsUseCase,
    @Optional() private readonly listPurchaseOrders?: ListPurchaseOrdersUseCase,
    // §8.3 DB-backed neutral intake state. `@Optional()` like the ledger, but it fails CLOSED where
    // the ledger fails open: an absent repository is only ever safe because the flag it is gated on
    // defaults to 'off'. LAST parameter on purpose — the specs wire these positionally.
    @Optional() private readonly intakeState?: LineIntakeStateRepository,
    // P12-3b: the LINE→web handoff seam at the send boundary. `@Optional()` because it is inert
    // whenever LINE_WEB_HANDOFF_ENABLED is off, and absent it every link keeps today's plain URL —
    // the same degrade-to-current-behaviour rule minting failure already follows.
    @Optional() private readonly handoffLinks?: LineHandoffLinkService,
  ) {}

  /**
   * SHADOW ONLY (plan §3 F1) — the employee LINE OA webhook row of the F0 async inventory, plus the
   * `lineAssistantDisabled` gate row it fans into.
   *
   * ONE method with two callers rather than two inline probes: the webhook has two entry paths that
   * both resolve a company (the AI-query turn and the receipt-capture turn), and instrumenting only
   * the one a ticket names would leave the sibling permanently unmeasured.
   *
   * Called UPSTREAM of `lineAssistantDisabled`. Instrumenting after an existing filter produces
   * evidence that reads perfect and means nothing — a probe inside the surviving branch could only
   * ever record `available`, so `wouldBlock` would be 0 by construction and R1 would be satisfied by
   * a measurement that could not have failed. Nothing branches on the result; every existing
   * refusal below is unchanged.
   */
  private async recordShadowTurn(companyId: string): Promise<void> {
    const sweep = this.shadow.startSweep(SHADOW_SURFACES.lineWebhookEmployee);
    try {
      await sweep.record(companyId, 'ai_line_assistant');
    } finally {
      // Uniform `finally` (piece 3 / codex r15 fix 11): redundant while this sweep holds one
      // observation, and NOT redundant the moment a second `record` is added here.
      await sweep.flush();
    }
  }

  /**
   * THE AI-LANE KILL SWITCH (plan §P3 item 1). `ai_line_assistant/DEFAULT` is the root launch route
   * of a LINE turn; this runs at the same seam `recordShadowTurn` measures, which is the last point
   * before a turn can reach the model, a tool, OCR, or any attachment write. Both entry paths (the
   * text turn and the receipt-upload turn) call it, so closing the route cannot be half-effective.
   *
   * Refuses exactly like the entitlement gate below it — reply, DENIED audit row, terminal event
   * log — but with the CLOSED-route copy, never the "not enabled" copy (spec CC1 / runbook §2.3).
   *
   * FAIL MODE, deliberately not fail-open: only the control-plane refusal
   * (`feature_temporarily_unavailable`) becomes a user-facing close. Anything else — the guard's own
   * database read failing — rethrows, exactly as the WHT callers do (`isLaunchRouteOpen`,
   * `wht-certificate-handoff.use-case.ts:22`): "the route is closed" and "we could not tell" are not
   * the same answer. The rethrow lands in this lane's existing catch (`executeReceiptUpload`, or the
   * buffer's `dispatchBatch` → `deliverDispatchFailure`), which sends a retryable "try again" reply
   * and releases the event — so an unreadable gate degrades toward CLOSED with no model call, per
   * runbook R8 rule 2: "availability problems therefore degrade toward closed, never toward open".
   */
  private async refuseWhenLaunchRouteClosed(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; handoff?: LineHandoffRecipient },
    actorUserId: string,
    companyId: string,
    requestId: string,
  ): Promise<boolean> {
    try {
      await this.launchGate.assertLaunchRouteOpen('ai_line_assistant');
      return false;
    } catch (error) {
      const body = (error as { getResponse?: () => unknown })?.getResponse?.() as { code?: string } | undefined;
      if (body?.code !== FEATURE_TEMPORARILY_UNAVAILABLE) throw error;
    }
    await this.deliverReply(event, LAUNCH_ROUTE_CLOSED_REPLY);
    await this.audit.log({
      companyId,
      actorUserId,
      action: 'ai.line.query.denied',
      targetType: 'LineWebhookEvent',
      targetId: event.webhookEventId,
      requestId,
      result: 'DENIED',
      riskLevel: 'LOW',
      // Tenant-anonymous and route-anonymous: the operator reads WHICH gate from the control plane,
      // not from a customer-turn audit row.
      metadataJson: { reason: 'launch_route_closed' },
    });
    // Its own status, not `feature_disabled`: a planned CLOSE and a company that never bought the
    // feature are different incidents, and R3 verification counts the fallback served under the
    // first. It classifies as `feature_disabled` so the AI-failure alarm stays quiet during a drill.
    await this.updateEventLog(event.webhookEventId, 'launch_route_closed', LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE, companyId);
    return true;
  }

  private async resolveBranchScopeLabel(companyId: string, branchIds?: string[]): Promise<string> {
    const fallback = branchScopeFallbackLabel(branchIds);
    if (!branchIds?.length) return fallback;
    try {
      const branches = await this.prisma.client.branch.findMany({
        where: { companyId, id: { in: branchIds } },
        select: { name: true },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      const names = branches.map(({ name }) => name.trim().slice(0, 80)).filter(Boolean);
      if (names.length === 0) {
        this.logger.warn({ msg: 'LINE branch scope names unavailable', companyId, branchCount: branchIds.length });
        return fallback;
      }
      const shown = names.slice(0, 2);
      const rest = branchIds.length - shown.length;
      return `${shown.join(' · ')}${rest > 0 ? ` และอีก ${rest} สาขา` : ''}`;
    } catch (error) {
      this.logger.warn({ msg: 'LINE branch scope lookup failed', companyId, branchCount: branchIds.length, error: (error as Error).message });
      return fallback;
    }
  }

  /**
   * Counts and a shortlist for the รายการรออนุมัติ card, read through the same permission-checked
   * use cases the web approval screens use — never the repositories — so LINE can never list a row
   * the same person cannot see on the web.
   *
   * A queue that is unwired or refuses (an approver without the matching read permission) is left
   * out of the snapshot rather than reported as zero: "ไม่มีรายการ" and "อ่านไม่ได้" must not look
   * the same to someone deciding whether to open the web app.
   */
  private async loadPendingApprovals(ctx: RequestContext, keys: ApprovalSurfaceKey[]): Promise<PendingApprovalSnapshot> {
    const pending: PendingApprovalSnapshot = {};
    const failed = (queue: string) => (error: unknown) => {
      this.logger.warn({ msg: 'LINE pending approval queue unavailable', queue, companyId: ctx.companyId, error: (error as Error).message });
      return null;
    };

    if (keys.includes('reimbursement') && this.reimbursementApprovalQueue) {
      const rows = await this.reimbursementApprovalQueue.execute(ctx).catch(failed('reimbursement'));
      if (rows) {
        pending.reimbursement = {
          total: rows.length,
          items: rows.slice(0, PENDING_APPROVAL_ITEM_LIMIT).map((row) => [
            row.requestNo ?? 'คำขอเบิกเงิน',
            row.requesterDisplayNameSnapshot,
            bahtText(row.amount),
          ].filter(Boolean).join(' · ')),
        };
      }
    }

    if (keys.includes('procurement') && (this.listPurchaseRequests || this.listPurchaseOrders)) {
      const filter = { status: 'PENDING_APPROVAL', page: 1, pageSize: PENDING_APPROVAL_ITEM_LIMIT };
      const [requests, orders] = await Promise.all([
        this.listPurchaseRequests?.execute(ctx, filter).catch(failed('purchase_request')) ?? null,
        this.listPurchaseOrders?.execute(ctx, filter).catch(failed('purchase_order')) ?? null,
      ]);
      if (requests || orders) {
        pending.procurement = {
          total: (requests?.total ?? 0) + (orders?.total ?? 0),
          items: [
            ...(requests?.data ?? []).map((row) => `${row.requestNumber ?? 'ใบขอซื้อ'} · ${bahtText(row.grandTotalAmount)}`),
            ...(orders?.data ?? []).map((row) => `${row.purchaseOrderNumber ?? 'ใบสั่งซื้อ'} · ${bahtText(row.grandTotalAmount)}`),
          ].slice(0, PENDING_APPROVAL_ITEM_LIMIT),
        };
      }
    }

    return pending;
  }

  private async refusePendingLegalAcceptance(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; handoff?: LineHandoffRecipient },
    userId: string,
    companyId: string,
    membershipId: string,
  ): Promise<boolean> {
    if (!await this.legalAcceptance.isRequired({ userId, companyId, membershipId })) return false;
    await this.deliverReply(event, LEGAL_ACCEPTANCE_REQUIRED_REPLY);
    await this.updateEventLog(
      event.webhookEventId,
      'legal_acceptance_required',
      LINE_AI_ERROR_CODES.FORBIDDEN,
      companyId,
    );
    return true;
  }

  /**
   * Bounded substitute-routing telemetry (substitute-semantic-routing spec §7): message hash, route +
   * status, confidence bucket, regex-match, open-state bucket, agreement (regex-vs-semantic on "is
   * substitute"; null when unavailable/no semantic route), and decision source. NO raw text or PII.
   */
  private logSubstituteRoute(
    event: { webhookEventId: string; messageText: string },
    messageText: string,
    d: { source: string; routePlan?: LineIntakeRoutePlan; regexMatch: boolean; workflowState: LineIntakeSubstituteContext['workflowState']; pendingQuestion: boolean },
  ): void {
    const rp = d.routePlan;
    const semantic = rp?.status === 'ROUTED' && rp.intent === 'SUBSTITUTE_RECEIPT_CONTINUATION';
    const confidence = rp?.confidence;
    this.logger.log({
      msg: 'line.substitute.route',
      webhookEventId: event.webhookEventId,
      messageHash: hashMessagePreview(messageText),
      routeIntent: rp?.intent ?? null,
      routeStatus: rp?.status ?? null,
      confidenceBucket: typeof confidence === 'number' ? (confidence < 0.6 ? 'low' : confidence < 0.85 ? 'mid' : 'high') : null,
      regexMatch: d.regexMatch,
      openStateBucket: d.workflowState,
      agreement: !rp || rp.status === 'UNAVAILABLE' ? null : d.regexMatch === semantic,
      decisionSource: d.source,
      pendingQuestion: d.pendingQuestion,
    });
  }

  /**
   * LINE Intake Router call (item 10B front stage). Returns a typed
   * UNAVAILABLE plan when the gateway/provider is unreachable so callers
   * fall back to safe legacy behavior — never keyword routing.
   */
  private async tryRouteIntake(input: {
    requestId: string;
    companyId: string;
    userId: string;
    permissions: string[];
    messageText: string;
    attachment?: { id: string; mimeType: string; contentBase64?: string };
    conversationContext?: LineAiConversationContext;
    valueCandidates?: LineAiValueCandidates;
    openClarifications?: LineAiOpenClarification[];
    recentCapturedExpenses?: LineIntakeCorrectionCandidate[];
    activeExpenseDrafts?: LineExpenseDraftRouteContext[];
    substituteContext?: LineIntakeSubstituteContext;
    busyWaitDeadlineMs?: number;
  }): Promise<GovernedLineIntakeRoutePlan> {
    try {
      const activeCategories = this.expenseRepo
        ? (await this.expenseRepo.listCategories(input.companyId)).map((c) => ({ id: c.id, name: c.name }))
        : [];
      return await this.aiGateway.requestLineIntakeRoute({
        requestId: input.requestId,
        companyId: input.companyId,
        userId: input.userId,
        locale: 'th-TH',
        messageText: input.messageText,
        ...(input.conversationContext && { conversationContext: input.conversationContext }),
        ...(input.valueCandidates && { valueCandidates: input.valueCandidates }),
        ...(input.openClarifications && { openClarifications: input.openClarifications }),
        ...(input.recentCapturedExpenses?.length ? { recentCapturedExpenses: input.recentCapturedExpenses } : {}),
        ...(input.activeExpenseDrafts?.length ? { activeExpenseDrafts: input.activeExpenseDrafts } : {}),
        ...(input.substituteContext ? { substituteContext: input.substituteContext } : {}),
        // TRUSTED capability flags from server config. All off ⇒ the gateway uses the exact legacy
        // intake prompt/catalog/cost. fusedPlan gates the fused-plan section + ~21KB catalog; substitute
        // gates the substitute semantic instructions.
        capabilities: {
          fusedPlan: this.config.lineAiFusedPlanShadowEnabled || this.config.lineAiPreparedSimpleReadEnabled,
          // PRIMARY only — 'shadow' is an inert NO-GO that must stay byte-identical to 'off' (no substitute
          // capability, so the router is never even offered the semantic route it could not safely act on).
          substituteSemantic: this.config.lineAiSubstituteSemanticRoutingMode === 'primary',
          // clarify_only/handoff only — 'shadow' is inert like 'off' (the router is never offered the route).
          reimbursementSemantic: this.config.lineAiReimbursementSemanticMode === 'clarify_only'
            || this.config.lineAiReimbursementSemanticMode === 'handoff',
          // Advisor staged capability (advisor spec §17): taken ONLY from server config, never from a
          // message, a client field or a user-supplied company id. The stages are cumulative, so each
          // one that offers the route is listed POSITIVELY — an absent or unrecognised value therefore
          // fails closed to legacy rather than switching the route on. Slice A builds 'social'.
          advisor: this.config.lineAiAdvisorMode === 'social'
            || this.config.lineAiAdvisorMode === 'knowledge'
            || this.config.lineAiAdvisorMode === 'company',
        },
        permissions: input.permissions,
        activeCategories,
        ...(input.attachment
          ? {
              attachments: [{
                id: input.attachment.id,
                mimeType: input.attachment.mimeType as 'image/jpeg' | 'image/png' | 'application/pdf',
                purpose: 'unknown' as const,
                ...(input.attachment.contentBase64 ? { contentBase64: input.attachment.contentBase64 } : {}),
              }],
            }
          : {}),
      }, { busyWaitDeadlineMs: input.busyWaitDeadlineMs });
    } catch (err) {
      this.logger.warn({ msg: 'LINE intake route unavailable', requestId: input.requestId, error: (err as Error).message });
      return { status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0, errorCode: 'ROUTER_UNREACHABLE' };
    }
  }

  /** Deliver via reply token; on an expired/used token fall back to push so a
   *  queued batch never ends in silence (spec §10). Push consumes OA quota —
   *  the fallback is counted via the `line_push_fallback_used` log line. */
  private async deliverReply(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; handoff?: LineHandoffRecipient },
    text: string,
    quickReply?: LineReplyMessage['quickReply'],
  ): Promise<void> {
    const result = await this.deliverMessages(event, [{
      ...this.lineReply.buildTextMessage(text),
      ...(quickReply ? { quickReply } : {}),
    }]);
    if (result !== 'ok') throw new Error(`LINE_DELIVERY_${result.toUpperCase()}`);
  }

  private async deliverRequiredMessages(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; handoff?: LineHandoffRecipient },
    messages: LineReplyMessage[],
  ): Promise<void> {
    const result = await this.deliverMessages(event, messages);
    if (result !== 'ok') throw new Error(`LINE_DELIVERY_${result.toUpperCase()}`);
  }

  private async withCompletionMenu(
    message: LineReplyMessage,
    companyId: string,
    access: { permissions: string[]; roles: string[] },
  ): Promise<LineReplyMessage> {
    return {
      ...message,
      quickReply: buildStaffCompletionQuickReply({
        permissions: access.permissions,
        entitledFeatureKeys: await loadEntitledFeatureKeys(this.prisma, companyId),
        isOwner: access.roles.includes('OWNER'),
      }),
    };
  }

  private async deliverCompletedReply(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; handoff?: LineHandoffRecipient },
    text: string,
    companyId: string,
    access: { permissions: string[]; roles: string[] },
    /** Spec §13: the state badge the reply's own use case chose. Absent renders exactly as before. */
    badge?: string,
  ): Promise<void> {
    const message = await this.timeStage(event.webhookEventId, 'render', () => this.withCompletionMenu(
      buildLineAssistantTextCardMessage(text, this.config.webBaseUrl, companyId, badge),
      companyId,
      access,
    ));
    await this.deliverRequiredMessages(event, [message]);
  }

  /** `buildTextMessage` SLICES at LINE's 5000-character cap, so an over-long part would be delivered
   *  silently truncated. Every producer here already bounds its parts (the expense splitter emits <= 4800),
   *  so exceeding this is a producer bug — and losing part of a financial reply is worse than failing the
   *  turn, which the caller already treats as an undelivered reply. */
  private buildLosslessTextMessage(text: string): LineReplyMessage {
    if (text.length > LINE_TEXT_MESSAGE_MAX_CHARS) throw new Error('LINE_REPLY_TEXT_PART_TOO_LONG');
    return this.lineReply.buildTextMessage(text);
  }

  private async deliverCompletedReplies(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; handoff?: LineHandoffRecipient },
    texts: string[],
    companyId: string,
    access: { permissions: string[]; roles: string[] },
    expenseDraft?: LineExpenseDraftCardFacts,
  ): Promise<void> {
    if (texts.length === 0 || texts.length > LINE_MAX_MESSAGES_PER_REPLY) throw new Error('LINE_EXPENSE_DRAFT_REPLY_PARTS_INVALID');
    const messages = await this.timeStage(event.webhookEventId, 'render', async () => {
      const terminal = texts[texts.length - 1]!;
      // Default-off is the legacy shape exactly: every part a text message, completion quick reply on the
      // terminal one only.
      if (!this.config.lineAiMultipartTerminalFlexEnabled) {
        const parts = texts.map((text) => this.buildLosslessTextMessage(text));
        parts[parts.length - 1] = await this.withCompletionMenu(parts[parts.length - 1]!, companyId, access);
        return parts;
      }
      // §10.1: an expense capture terminal that grounded a draft gets the DEDICATED ร่างค่าใช้จ่าย card;
      // the generic card stays the render for every terminal with no such draft behind it. Same gate
      // either way, so flag-off is still the byte-identical legacy all-text shape above.
      const terminalCard = (text: string): LineReplyMessage => (expenseDraft
        ? buildExpenseDraftCardMessage(text, expenseDraft, this.config.webBaseUrl, companyId)
        : buildLineAssistantTextCardMessage(text, this.config.webBaseUrl, companyId));
      // Spec §10.1: earlier parts stay lossless text; the terminal part becomes the same Flex card a
      // single completed reply gets, so a multi-part journey never ends in plain text.
      if (Array.from(terminal).length <= LINE_FLEX_CARD_BODY_MAX_CHARS) {
        const parts = texts.slice(0, -1).map((text) => this.buildLosslessTextMessage(text));
        parts.push(await this.withCompletionMenu(terminalCard(terminal), companyId, access));
        return parts;
      }
      // The terminal text is longer than a Flex body holds. Feeding it to the card would drop everything
      // past the limit, so the canonical text ships INTACT as text and the card is appended after it —
      // and only when a message slot is left. At the cap, five lossless text parts beat a card.
      const parts = texts.map((text) => this.buildLosslessTextMessage(text));
      if (parts.length >= LINE_MAX_MESSAGES_PER_REPLY) {
        parts[parts.length - 1] = await this.withCompletionMenu(parts[parts.length - 1]!, companyId, access);
        return parts;
      }
      parts.push(await this.withCompletionMenu(terminalCard(MULTIPART_TERMINAL_FLEX_CLOSER), companyId, access));
      return parts;
    });
    await this.deliverRequiredMessages(event, messages);
  }

  /** The single delivery seam: every reply/push in this use case goes through here, so `line_delivery`
   *  is timed once here rather than at one call site — and it stays the NETWORK send (plus its own
   *  delivery bookkeeping), never the message construction, which is the separate `render` stage. */
  private async deliverMessages(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; beforeReply?: () => Promise<void>; handoff?: LineHandoffRecipient },
    messages: LineReplyMessage[],
  ): Promise<LineDeliveryResult> {
    return this.timeStage(event.webhookEventId, 'line_delivery', () => this.sendMessages(event, messages));
  }

  private async sendMessages(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; beforeReply?: () => Promise<void>; handoff?: LineHandoffRecipient },
    messages: LineReplyMessage[],
  ): Promise<LineDeliveryResult> {
    try {
      await event.beforeReply?.();
    } catch (error) {
      // Waiting feedback is cosmetic; it must never block the actual answer.
      this.logger.warn({ msg: 'LINE waiting feedback settlement failed', error: (error as Error).message });
    }
    // §8.3: the canonical terminal outcome becomes durable BEFORE the first send attempt, and it is
    // the RENDERED payload — not AiTurn's 240-character preview, which cannot be delivered. FAIL
    // CLOSED: a send we could not record is the one case a later retry could contradict, so an
    // unrecordable outcome is parked as `delivery_pending` instead of being sent unrecorded. The
    // legacy input replay still covers that row (no outcome exists to replay, so recomputing is the
    // only honest option) and nothing reached the user, so nothing can be duplicated.
    if (this.config.lineAiTerminalOutcomeReplayEnabled
      && !(await this.recordTurnOutcome(event.webhookEventId, messages, presentationKindOf(messages)))) {
      await this.updateEventLog(event.webhookEventId, 'delivery_pending', 'LINE_OUTCOME_NOT_RECORDED');
      return 'failed_other';
    }
    let result = await this.attemptDelivery(event, messages);
    // §14.3 / R4: LINE rejected the message BODY, so pushing the same bytes cannot help. Re-send ONCE
    // as the canonical text the cards already declare. Only reachable with the flag on — with it off
    // `attemptDelivery` has already taken the legacy push path for this result.
    if (result === 'failed_flex') {
      const textMessages = toCanonicalTextMessages(messages);
      this.logger.warn({ msg: 'line_flex_text_fallback_used', webhookEventId: event.webhookEventId });
      // Same fail-closed rule as the first send: the text replaces the rejected Flex as the payload
      // of record, and it may reach LINE only once that replacement is durable. Sending anyway
      // would either mark the stale Flex outcome delivered (send ok) or leave replay pushing the
      // very payload LINE just rejected (send fails). Nothing has reached the user this turn, so
      // parking cannot duplicate — the legacy input replay recomputes the row honestly.
      if (this.config.lineAiTerminalOutcomeReplayEnabled
        && !(await this.recordTurnOutcome(event.webhookEventId, textMessages, 'text_fallback'))) {
        await this.updateEventLog(event.webhookEventId, 'delivery_pending', 'LINE_OUTCOME_NOT_RECORDED');
        return 'failed_other';
      }
      result = await this.attemptDelivery(event, textMessages);
    }
    if (result !== 'ok') {
      await this.updateEventLog(event.webhookEventId, 'delivery_pending', `LINE_DELIVERY_${result.toUpperCase()}`);
    } else {
      if (this.config.lineAiTerminalOutcomeReplayEnabled) {
        // Delivery status, kept separate from the outcome itself. Best-effort on purpose: the answer
        // is already on the user's screen, and failing here must not turn it into an error.
        await this.prisma.client.lineTurnOutcome.updateMany({
          where: { webhookEventId: event.webhookEventId, deliveredAt: null },
          data: { deliveredAt: new Date() },
        }).catch(() => null);
      }
      const resolution = (event as typeof event & {
        [PENDING_MEDIA_RESOLUTION]?: { id: string; companyId: string; userId: string; status: 'RESOLVED_ILLUSTRATION' | 'RESOLVED_MULTI_ENTRY_REVIEW' };
      })[PENDING_MEDIA_RESOLUTION];
      if (resolution) {
        try {
          await this.prisma.client.lineIntakePendingMedia.updateMany({
            where: { id: resolution.id, status: 'PENDING' },
            data: { status: resolution.status },
          });
          await this.ackMediaClarification(resolution.companyId, event, resolution.userId, resolution.id, 'acked');
          delete (event as typeof event & {
            [PENDING_MEDIA_RESOLUTION]?: { id: string; companyId: string; userId: string; status: 'RESOLVED_ILLUSTRATION' | 'RESOLVED_MULTI_ENTRY_REVIEW' };
          })[PENDING_MEDIA_RESOLUTION];
        } catch (error) {
          // Delivery is already customer-visible. Keep the row idempotently retryable and surface
          // the storage failure instead of converting a successful answer into another reply.
          this.logger.warn({ msg: 'line_pending_media_resolution_failed', pendingMediaId: resolution.id, error: (error as Error).message });
        }
      }
    }
    return result;
  }

  /** One reply attempt plus the expired-reply-token push fallback (E4).
   *
   *  `failed_flex` is returned to the caller ONLY when the Flex→text fallback is on; with it off this
   *  takes the same push path `failed_token` has always taken, with the same messages and the same
   *  `line_push_fallback_used` line, and the push result overwrites it — so the value never escapes
   *  and every observable byte of the legacy path is unchanged. */
  private async attemptDelivery(
    event: { replyToken: string; lineUserId: string; pushTargetId?: string; handoff?: LineHandoffRecipient },
    messages: LineReplyMessage[],
  ): Promise<LineDeliveryResult> {
    // P12-3b: the ONE place every reply and its push fallback pass through, so wrapping here covers
    // every current link-emitting surface and every future one. Inert with the flag off — the same
    // `messages` array comes back — and a mint failure keeps the plain URL, so nothing here can
    // cost the user their link. Both sends below use the SAME wrapped payload: re-wrapping for the
    // fallback would burn a second token for a message the user sees once.
    //
    // Deliberately AFTER `recordTurnOutcome`, so the stored payload of record keeps plain links: an
    // orphan replay lands minutes to hours later, by which time a 15-minute token would be dead and
    // the replayed answer would carry a link that cannot open. Plain is the honest bytes to store.
    const outgoing = this.handoffLinks
      ? await this.handoffLinks.wrapOutgoingLineContent(
        event.handoff ? { ...event.handoff, lineUserId: event.pushTargetId ?? event.lineUserId, surface: 'line_ai_reply' } : null,
        messages,
      )
      : messages;
    let result: LineDeliveryResult;
    try {
      result = await this.lineReply.sendReply(event.replyToken, outgoing);
    } catch (error) {
      this.logger.warn({ msg: 'LINE reply adapter threw unexpectedly', error: (error as Error).message });
      result = 'failed_other';
    }
    if (result === 'failed_token' || (result === 'failed_flex' && !this.config.lineAiFlexTextFallbackEnabled)) {
      this.logger.warn({ msg: 'line_push_fallback_used' });
      try {
        result = await this.lineReply.sendPush(event.pushTargetId ?? event.lineUserId, outgoing);
      } catch (error) {
        this.logger.warn({ msg: 'LINE push adapter threw unexpectedly', error: (error as Error).message });
        result = 'failed_other';
      }
    }
    return result;
  }

  /** §8.3: persist the canonical terminal outcome and its replay reference before the send. Upsert,
   *  because the same event may be re-rendered by a retry — one question keeps ONE answer of record.
   *  Returns false when the outcome is not durable, and the caller must then not send. */
  private async recordTurnOutcome(
    webhookEventId: string,
    messages: LineReplyMessage[],
    presentationKind: string,
  ): Promise<boolean> {
    try {
      const log = await this.prisma.client.lineWebhookEventLog.findUnique({
        where: { webhookEventId },
        select: { companyId: true },
      });
      const messagesJson = messages as unknown as Prisma.InputJsonValue;
      await this.prisma.client.lineTurnOutcome.upsert({
        where: { webhookEventId },
        create: { webhookEventId, companyId: log?.companyId ?? null, messagesJson, presentationKind, attempts: 1 },
        // A re-render supersedes the previous payload AND clears `deliveredAt`: these are different
        // bytes, so an earlier delivery does not vouch for them.
        update: { messagesJson, presentationKind, attempts: { increment: 1 }, deliveredAt: null },
      });
      return true;
    } catch (error) {
      this.logger.error({ msg: 'line_turn_outcome_not_recorded', webhookEventId, error: (error as Error).message });
      return false;
    }
  }

  /**
   * LINE userIds are channel-scoped: the same person has a different `providerUserId` per
   * messaging channel, so an unfiltered `providerUserId` lookup can resolve a webhook from one OA
   * against an identity linked on another. The webhook carries its own channel, so match on it
   * first. Identities linked before `providerChannelId` was recorded (or under a legacy channel)
   * still fall back to the channel-agnostic query with a warn — the same shape the notification
   * delivery path uses, so relinking is not required to keep chatting.
   */
  private async resolveLineIdentity(event: { lineUserId: string; messagingChannelId?: string }) {
    const where = { providerUserId: event.lineUserId, provider: 'LINE' as const, status: 'ACTIVE' as const };
    if (event.messagingChannelId) {
      const scoped = await this.prisma.client.externalIdentity.findFirst({
        where: { ...where, providerChannelId: event.messagingChannelId },
        include: { user: true },
      });
      if (scoped) return scoped;
    }
    const identity = await this.prisma.client.externalIdentity.findFirst({ where, include: { user: true } });
    if (identity && event.messagingChannelId) {
      this.logger.warn({ msg: 'line_identity_channel_agnostic_fallback', messagingChannelId: event.messagingChannelId });
    }
    return identity;
  }

  /**
   * Resolve the same employee/company/membership scope as the turn pipeline,
   * but before the message buffer stores its crash-recovery payload. This
   * method is intentionally read-only and receives no message text, reply
   * token, or media id.
   *
   * Unlinked users and unresolved multi-company users continue into the
   * existing pipeline so they keep receiving the link/company-picker reply.
   * Once a company is resolvable, infrastructure failures propagate: the
   * webhook returns non-2xx rather than persisting a possibly forbidden raw
   * message under a fail-open decision.
   */
  async preflightLegalAcceptance(
    event: { lineUserId: string; messagingChannelId?: string; companyIdAtAcceptance?: string },
  ): Promise<LineLegalAcceptancePreflight> {
    const identity = await this.resolveLineIdentity(event);
    if (!identity || identity.user.status !== 'ACTIVE') return { status: 'continue' };

    const resolved = event.companyIdAtAcceptance
      ? { companyId: event.companyIdAtAcceptance }
      : await resolveCompanyForLineUser(this.prisma, identity.userId, event.lineUserId);
    if (!resolved || 'needsSelection' in resolved) {
      return { status: 'continue' };
    }

    const access = await this.permissionResolver.resolveAccess(identity.userId, resolved.companyId);
    const required = await this.legalAcceptance.isRequired({
      userId: identity.userId,
      companyId: resolved.companyId,
      membershipId: access.membershipId,
    });
    return required
      ? { status: 'required', companyId: resolved.companyId }
      : { status: 'continue', companyId: resolved.companyId };
  }

  async execute(event: LineTextEvent): Promise<void> {
    const requestId = randomUUID();

    // 1. Atomically claim the event. The message buffer may have created the
    //    `received` row already; processedAt is the compare-and-set claim marker.
    if (!await this.claimWebhookEvent(event.webhookEventId, event.lineUserId)) {
      this.logger.log({ msg: 'Duplicate webhook event skipped', webhookEventId: event.webhookEventId });
      return;
    }

    // Public deterministic command: the verified controller and event claim already ran, but no
    // identity, company, acceptance, permission, entitlement, or model read is needed.
    const publicCommand = staffMenuCommand(event.messageText);
    if (publicCommand === 'contact') {
      await this.deliverRequiredMessages(event, [buildContactCard()]);
      await this.updateEventLog(event.webhookEventId, 'staff_menu_contact');
      return;
    }
    if (publicCommand === 'talk') {
      await this.deliverReply(event, ASSISTANT_TALK_GREETING);
      await this.updateEventLog(event.webhookEventId, 'staff_menu_talk');
      return;
    }
    // Rich menu v2 ver2 Promotion tile (Owner design 2026-08-27). Public like `contact`: a
    // prospect exploring packages may well be unlinked, and the card carries no tenant data.
    if (publicCommand === 'promotion') {
      await this.deliverRequiredMessages(event, [buildPromotionCard(this.config.webBaseUrl)]);
      await this.updateEventLog(event.webhookEventId, 'staff_menu_promotion');
      return;
    }
    // "ทำอะไรได้บ้าง" (Owner 2026-08-27): a model-composed answer advertised features that do
    // not exist, so a short capability question is answered by the curated card — deterministic,
    // zero model calls, only the six real functions.
    if (isCapabilityQuestion(event.messageText)) {
      await this.deliverRequiredMessages(event, [buildCapabilityCard()]);
      await this.updateEventLog(event.webhookEventId, 'staff_menu_capability');
      return;
    }

    // 3. Resolve LINE user → internal user via ExternalIdentity, scoped to the webhook's channel.
    const identity = await this.resolveLineIdentity(event);

    if (!identity || identity.user.status !== 'ACTIVE') {
      await this.deliverReply(event, UNLINKED_REPLY);
      await this.audit.log({ action: 'ai.line.unlinked_access', targetType: 'line_user', requestId, result: 'DENIED', riskLevel: 'LOW', metadataJson: { lineUserId: '[REDACTED]' } });
      await this.updateEventLog(event.webhookEventId, 'unlinked', LINE_AI_ERROR_CODES.UNLINKED_USER);
      return;
    }

    // PDPA opt-out gate (M-05 §3.1). `user` is already loaded by the identity include, so
    // this costs no extra query; the status string is the discriminator in the event log.
    if (identity.user.aiAssistantOptOutAt) {
      await this.deliverReply(event, AI_OPT_OUT_REPLY);
      await this.updateEventLog(event.webhookEventId, 'ai_opt_out', LINE_AI_ERROR_CODES.FORBIDDEN);
      return;
    }

    const companyCommand = parseLineCompanyCommand(event.messageText)
      ?? await this.pendingCompanySelectionCommand(event);
    if (companyCommand) {
      await this.handleCompanyCommand(event, requestId, identity.userId, identity.user.displayName, companyCommand);
      return;
    }

    // 4. Resolve company from membership + LineCompanyContext (NOT channel binding)
    const resolved = await resolveCompanyForLineUser(this.prisma, identity.userId, event.lineUserId);
    if (!resolved) {
      await this.deliverReply(event, UNLINKED_REPLY);
      await this.updateEventLog(event.webhookEventId, 'no_membership', LINE_AI_ERROR_CODES.UNLINKED_USER);
      return;
    }
    if ('needsSelection' in resolved) {
      const memberships = await this.listLineCompanies(identity.userId);
      await this.deliverRequiredMessages(event, [buildCompanyPickerMessage(
        memberships.map((membership) => ({ companyId: membership.companyId, companyName: companyLabel(membership) })),
      )]);
      await this.updateEventLog(event.webhookEventId, 'needs_company_selection', LINE_AI_ERROR_CODES.UNLINKED_USER);
      return;
    }
    const companyId = resolved.companyId;

    // 5. Resolve membership + permissions via existing permission resolver
    let resolvedAccess: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>;
    try {
      resolvedAccess = await this.permissionResolver.resolveAccess(identity.userId, companyId);
    } catch {
      await this.deliverReply(event, UNLINKED_REPLY);
      await this.updateEventLog(event.webhookEventId, 'no_membership', LINE_AI_ERROR_CODES.FORBIDDEN);
      return;
    }

    // P12-3b: from here the turn knows WHO it is answering and in which company, so every message
    // it delivers can carry a deep-link handoff. Set after the permission resolver, never before:
    // the refusals above (unlinked, opted out, no membership, company picker) have no recipient to
    // bind and must keep the plain links they send today.
    event.handoff = { userId: identity.userId, companyId };

    // This check is after server-side company/membership resolution and before feature probes,
    // model routing, ERP tools, conversation persistence, or attachment storage.
    if (await this.refusePendingLegalAcceptance(
      event, identity.userId, companyId, resolvedAccess.membershipId,
    )) return;

    // Read once for the whole turn: the AI gate, the capability copy, and the gateway turn request
    // all need the same entitlement set. `null` stays the legacy fail-open sentinel.
    const entitledFeatureKeys = await loadEntitledFeatureKeys(this.prisma, companyId);
    const menuCommand = staffMenuCommand(event.messageText);
    const canCaptureExpense = RECEIPT_CAPTURE_PERMISSIONS
      .some((permission) => resolvedAccess.permissions.includes(permission));

    // These two cards are deterministic product entry points, not AI turns. They keep their own
    // feature/permission gates and remain available when the model provider or AI feature is off.
    if (menuCommand === 'services') {
      await this.deliverRequiredMessages(event, [buildServiceEntitlementMessage(entitledFeatureKeys)]);
      await this.updateEventLog(event.webhookEventId, 'staff_menu_services', undefined, companyId);
      return;
    }
    if (menuCommand === 'receipt') {
      const receiptFeatureEnabled = entitledFeatureKeys === null || entitledFeatureKeys.has('expenses.upload');
      if (!receiptFeatureEnabled || !canCaptureExpense) {
        const featureDisabled = !receiptFeatureEnabled;
        await this.deliverReply(event, featureDisabled ? EXPENSE_FEATURE_DISABLED_REPLY : RECEIPT_FORBIDDEN_REPLY);
        await this.audit.log({
          companyId,
          actorUserId: identity.userId,
          action: 'expense.line_upload.reject',
          targetType: 'LineWebhookEvent',
          targetId: event.webhookEventId,
          requestId,
          result: 'DENIED',
          riskLevel: 'MEDIUM',
          metadataJson: { reason: featureDisabled ? 'feature_disabled' : 'missing_expense_receipt_line_upload', route: 'rich_menu' },
        });
        await this.updateEventLog(event.webhookEventId,
          featureDisabled ? 'feature_disabled' : 'forbidden',
          featureDisabled ? LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE : LINE_AI_ERROR_CODES.FORBIDDEN,
          companyId);
        return;
      }
      await this.deliverRequiredMessages(event, [buildReceiptCapturePrompt({
        displayName: identity.user.displayName,
        roleLabel: resolvedAccess.roles.join(' · ') || 'พนักงาน',
        branchScopeLabel: branchScopeFallbackLabel(resolvedAccess.scopes.branchIds),
        permissions: resolvedAccess.permissions,
        entitledFeatureKeys,
        webBaseUrl: this.config.webBaseUrl,
        companyId,
        isOwner: resolvedAccess.roles.includes('OWNER'),
      })]);
      await this.updateEventLog(event.webhookEventId, 'staff_menu_receipt', undefined, companyId);
      return;
    }

    await this.recordShadowTurn(companyId);
    if (await this.refuseWhenLaunchRouteClosed(event, identity.userId, companyId, requestId)) return;
    if (lineAssistantDisabledFor(entitledFeatureKeys)) {
      await this.deliverReply(event, formatRefusal('feature_disabled'));
      await this.audit.log({
        companyId,
        actorUserId: identity.userId,
        action: 'ai.line.query.denied',
        targetType: 'LineWebhookEvent',
        targetId: event.webhookEventId,
        requestId,
        result: 'DENIED',
        riskLevel: 'LOW',
        metadataJson: { reason: 'feature_disabled' },
      });
      await this.updateEventLog(event.webhookEventId, 'feature_disabled', LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE, companyId);
      return;
    }

    const canQuery = resolvedAccess.permissions.includes('line.ai.query');
    const canSubmitSignature = maySubmitSignature(resolvedAccess.permissions);
    // Phase 1 is personal-chat only. Group/room capture retains the proven single-turn path.
    const expenseDraftConversationEnabled = this.config.lineExpenseDraftConversationEnabled === true
      && (!event.pushTargetId || event.pushTargetId === event.lineUserId)
      && Boolean(this.expenseDraftConversation);
    if (!canQuery && !canCaptureExpense && !canSubmitSignature) {
      await this.deliverReply(event, FORBIDDEN_REPLY);
      await this.audit.log({
        companyId,
        actorUserId: identity.userId,
        action: 'ai.line.query.denied',
        targetType: 'LineWebhookEvent',
        targetId: event.webhookEventId,
        requestId,
        result: 'DENIED',
        riskLevel: 'LOW',
        metadataJson: { reason: 'missing_line_ai_query_permission' },
      });
      await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
      return;
    }

    if (menuCommand === 'main' || menuCommand === 'query' || menuCommand === 'approval') {
      const menuContext: StaffMenuContext = {
        displayName: identity.user.displayName,
        roleLabel: resolvedAccess.roles.join(' · ') || 'พนักงาน',
        branchScopeLabel: menuCommand === 'main'
          ? await this.resolveBranchScopeLabel(companyId, resolvedAccess.scopes.branchIds)
          : branchScopeFallbackLabel(resolvedAccess.scopes.branchIds),
        permissions: resolvedAccess.permissions,
        entitledFeatureKeys,
        webBaseUrl: this.config.webBaseUrl,
        companyId,
        isOwner: resolvedAccess.roles.includes('OWNER'),
      };
      const message = menuCommand === 'main'
        ? buildStaffMainMenu(menuContext)
        : menuCommand === 'query'
          ? buildStaffQueryMenu(menuContext)
          : buildPendingApprovalCard(menuContext, await this.loadPendingApprovals({
              requestId,
              authSubject: identity.userId,
              userId: identity.userId,
              companyId,
              membershipId: resolvedAccess.membershipId,
              roles: resolvedAccess.roles,
              permissions: resolvedAccess.permissions,
              scopes: resolvedAccess.scopes,
              authProvider: 'line',
            }, availableApprovalSurfaceKeys(menuContext)));
      await this.deliverRequiredMessages(event, [message]);
      await this.updateEventLog(event.webhookEventId, `staff_menu_${menuCommand}`, undefined, companyId);
      return;
    }

    let normalizedText = normalizeLineText(event.messageText);
    let mediaResumeCapsule: string | undefined;

    // RECEIPT-05 (owner decision 2026-07-12): if this user has an unresolved media-clarify
    // question, their reply decides it deterministically BEFORE any AI routing — receipt →
    // build the draft from the stored attachment; illustration → answer the original caption;
    // multiple → retain for review without collapsing rows; ambiguous → leave it PENDING.
    const pendingMedia = await this.prisma.client.lineIntakePendingMedia.findFirst({
      where: { companyId, userId: identity.userId, status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (pendingMedia) {
      // §11: these bytes may be waiting on a question the substitute work asked. That question is
      // recorded ON the row, so its answer is resolved against the list that was actually printed —
      // reading a “2” off today's list instead would invert what the sender said. Rows carrying the
      // receipt clarify's own question, or asked in another chat, fall through untouched.
      let substituteAnswer: Awaited<ReturnType<ProcessLineWebhookUseCase['resolveSubstituteMediaAnswer']>>;
      try {
        substituteAnswer = await this.resolveSubstituteMediaAnswer(
          event,
          {
            requestId, authSubject: identity.userId, userId: identity.userId, companyId,
            membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles,
            permissions: resolvedAccess.permissions, scopes: resolvedAccess.scopes, authProvider: 'line',
          },
          resolvedAccess, pendingMedia, normalizedText,
        );
      } catch (error) {
        // Nothing here may reach the dispatcher's generic failure reply: the sender would lose both
        // their answer and the explanation. Keep the bytes, say it plainly, end the turn.
        this.logger.warn({ msg: 'line_substitute_media_answer_failed', requestId, error: (error as Error).message });
        await this.deliverReply(event, ERROR_REPLY);
        await this.updateEventLog(event.webhookEventId, 'substitute_media_answer_failed', undefined, companyId);
        return;
      }
      if (substituteAnswer?.outcome === 'handled') {
        await this.ackMediaClarification(companyId, event, identity.userId, pendingMedia.id, 'acked');
        return;
      }
      if (substituteAnswer?.outcome === 'not_answered') {
        // Ours, but not an answer to it. The row stays PENDING and the reminder rides the turn, so
        // no other classifier can act on bytes that are waiting on a different question.
        mediaResumeCapsule = `↩️ รูปที่รอจำแนกยังเก็บไว้อยู่ค่ะ\n${substituteAnswer.question}`;
      }
      const splitReply = substituteAnswer ? null : splitPendingMediaReply(normalizedText);
      const decision = substituteAnswer?.outcome === 'new_expense'
        ? 'receipt' as const
        : substituteAnswer
          ? 'ambiguous' as const
          : splitReply?.decision ?? classifyPendingMediaReply(normalizedText);
      if (decision === 'receipt') {
        await this.resolvePendingMediaAsReceipt(
          event, requestId, identity.userId, companyId, resolvedAccess, pendingMedia, normalizedText,
          splitReply?.remainder,
        );
        await this.ackMediaClarification(companyId, event, identity.userId, pendingMedia.id, 'acked');
        return;
      }
      if (decision === 'illustration') {
        // Settle only after LINE receives the deferred outcome. Until then the stored file remains
        // retryable and cannot disappear behind a failed reply.
        (event as LineTextEvent & {
          [PENDING_MEDIA_RESOLUTION]?: { id: string; companyId: string; userId: string; status: 'RESOLVED_ILLUSTRATION' | 'RESOLVED_MULTI_ENTRY_REVIEW' };
        })[PENDING_MEDIA_RESOLUTION] = { id: pendingMedia.id, companyId, userId: identity.userId, status: 'RESOLVED_ILLUSTRATION' };
        // Route on the stored caption instead of the yes/no reply — the deferred question is answered now.
        normalizedText = normalizeLineText(pendingMedia.caption ?? normalizedText);
      }
      if (decision === 'multiple') {
        (event as LineTextEvent & {
          [PENDING_MEDIA_RESOLUTION]?: { id: string; companyId: string; userId: string; status: 'RESOLVED_ILLUSTRATION' | 'RESOLVED_MULTI_ENTRY_REVIEW' };
        })[PENDING_MEDIA_RESOLUTION] = { id: pendingMedia.id, companyId, userId: identity.userId, status: 'RESOLVED_MULTI_ENTRY_REVIEW' };
        const reply = [
          '📋 เก็บไฟล์สรุปหลายรายการไว้ตรวจแล้ว และยังไม่ได้สร้างค่าใช้จ่ายรายการเดียวจากยอดรวมค่ะ',
          'ระบบ LINE ยังไม่รองรับการแยกหลายรายการอัตโนมัติ กรุณาส่งเอกสารแยกรายการ หรือบันทึก/ตรวจในเว็บแอป:',
          absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses`),
        ].join('\n');
        await this.deliverCompletedReply(event, reply, companyId, resolvedAccess);
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: reply, intent: 'CLARIFY',
        });
        await this.updateEventLog(event.webhookEventId, 'multi_entry_review', undefined, companyId);
        return;
      }
      if (decision === 'ambiguous' && isInterveningQuestionText(normalizedText)) {
        mediaResumeCapsule = `↩️ รูปที่รอจำแนกยังเก็บไว้อยู่ค่ะ\n${MEDIA_CLARIFY_REPLY}`;
      }
      // ambiguous → fall through with the original reply; the row stays PENDING. Unlike before, the
      // ledger now carries this question as an open clarification WITH the stored file, so the turn
      // below reaches the model knowing the picture is already on the server — it can answer or
      // re-ask about THAT file instead of asking the customer to send one.
    }

    const conversationContext = canQuery ? await this.loadConversationContext(companyId, identity.userId, resolvedAccess.permissions) : undefined;
    const valueCandidates = computeValueCandidates(normalizedText);
    // Item 10F: chatKey = groupId ?? roomId ?? userId (same as the buffer); open waiting_user
    // ledger entries ride the turn as DATA so the model can complete the ORIGINAL request.
    const chatKey = event.pushTargetId ?? event.lineUserId;
    let openWaiting: Awaited<ReturnType<LineAiLedgerService['openWaitingUser']>>;
    try {
      openWaiting = this.ledger ? await this.ledger.openWaitingUser(companyId, chatKey, identity.userId) : [];
    } catch (err) {
      // Consumption-marker state is unreadable. Continuing with "no open clarifications" is NOT
      // fail-closed: a bare "590" answering an earlier question would be routed as a new capture.
      if (!(err instanceof ConsumptionMarkerUnavailableError)) throw err;
      this.logger.warn({ msg: 'line_ai_marker_unavailable', requestId });
      await this.deliverReply(event, ERROR_REPLY);
      await this.updateEventLog(event.webhookEventId, 'marker_unavailable', 'CONSUMPTION_MARKER_UNAVAILABLE', companyId);
      return;
    }
    const openClarifications: LineAiOpenClarification[] | undefined = openWaiting.length > 0
      ? openWaiting.map(({ id, question, text, subject, askedAt, clarifyForIntent, candidateExpenseIds, pendingMedia }) => ({
        id, question, text, ...(subject && { subject }), askedAt,
        ...(clarifyForIntent && { clarifyForIntent }),
        ...(candidateExpenseIds?.length && { candidateExpenseIds }),
        ...(pendingMedia && { pendingMedia }),
      }))
      : undefined;

    // Correction targets: this user's recent captures in THIS chat, inside branch scope.
    const recentCapturedExpenses = canCaptureExpense
      ? await this.loadCorrectionCandidates(companyId, identity.userId, chatKeyHashOf(event), resolvedAccess.scopes)
      : [];
    const expenseDraftCtx: RequestContext = {
      requestId, authSubject: identity.userId, userId: identity.userId, companyId,
      membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles,
      permissions: resolvedAccess.permissions, scopes: resolvedAccess.scopes, authProvider: 'line',
    };
    const activeExpenseDrafts = expenseDraftConversationEnabled && canCaptureExpense && this.expenseDraftConversation
      ? await this.expenseDraftConversation.routeContexts(expenseDraftCtx, chatKeyHashOf(event))
      : [];
    const interruptExpenseDraft = async (excludeExpenseIds: string[] = []) => activeExpenseDrafts
      .some((draft) => draft.status === 'OPEN' && !excludeExpenseIds.includes(draft.expenseId))
      && this.expenseDraftConversation
      ? this.expenseDraftConversation.interruptOpen(expenseDraftCtx, chatKeyHashOf(event), excludeExpenseIds)
      : undefined;
    if (activeExpenseDrafts.length > 0 && this.expenseDraftConversation
      && isDeterministicLineExpenseDraftInput(normalizedText)) {
      const result = await this.expenseDraftConversation.execute(expenseDraftCtx, {
        messageText: normalizedText,
        chatKeyHash: chatKeyHashOf(event),
        webhookEventId: event.webhookEventId,
      });
      if (result.handled) {
        await this.deliverCompletedReplies(event, result.replyTexts, companyId, resolvedAccess);
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: result.replyTexts.join('\n'), intent: 'CLARIFY',
        });
        await this.updateEventLog(event.webhookEventId, result.status === 'UPDATED' ? 'clarification_required' : 'completed', undefined, companyId);
        return;
      }
    }

    if (isDeliveredCapabilityFollowUp(normalizedText, conversationContext)) {
      const interruption = await interruptExpenseDraft();
      const reply = `${capabilityFollowUpReply(normalizedText, {
        permissions: resolvedAccess.permissions,
        ...(entitledFeatureKeys && { entitledFeatureKeys: [...entitledFeatureKeys] }),
      })}${interruption ? `\n\n${interruption}` : ''}`;
      await this.deliverCompletedReply(event, reply, companyId, resolvedAccess);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: reply, intent: 'UNKNOWN',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    if (this.expenseRepo && isGroundedReceiptFollowUp(normalizedText) && !isSubstituteReceiptConversationText(normalizedText)) {
      if (recentCapturedExpenses.length > 1) {
        const reply = ['พบรายการล่าสุดมากกว่า 1 รายการ กรุณาระบุรายการก่อนค่ะ', ...recentCapturedExpenses.map((item, index) => `${index + 1}) ${item.label}`)].join('\n');
        await this.deliverCompletedReply(event, reply, companyId, resolvedAccess);
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: reply, intent: 'CLARIFY',
        });
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      const candidate = recentCapturedExpenses[0];
      if (candidate) {
        const expense = await this.expenseRepo.findByIdWithRelations(companyId, candidate.id, undefined, resolvedAccess.scopes);
        const receiptContinuation = expense?.sourceChannelMetadataJson?.['lineReceiptContinuation'];
        const hasDeliveredContinuation = receiptContinuation && typeof receiptContinuation === 'object'
          && (receiptContinuation as any).expenseId === candidate.id
          && (receiptContinuation as any).userId === identity.userId
          && (receiptContinuation as any).chatKeyHash === chatKeyHashOf(event)
          && typeof (receiptContinuation as any).deliveredOutcomeId === 'string';
        if (expense && expense.createdByUserId === identity.userId && hasDeliveredContinuation) {
          const category = expense.expenseCategoryId
            ? (await this.expenseRepo.listCategories(companyId)).find((item) => item.id === expense.expenseCategoryId)
            : undefined;
          const interruption = await interruptExpenseDraft();
          const reply = `${formatGroundedReceiptFollowUp(this.config.webBaseUrl, companyId, expense, category?.name, normalizedText)}${interruption ? `\n\n${interruption}` : ''}`;
          await this.deliverCompletedReply(event, reply, companyId, resolvedAccess);
          await this.persistIntakeTurn({
            userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
            userMessagePreview: normalizedText, replyText: reply, intent: 'READ_SUMMARY',
          });
          await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
          return;
        }
      }
    }

    const hasSubstituteClarification = openWaiting.some((item) => item.clarifyForIntent === 'SUBSTITUTE_RECEIPT_CONTINUATION');
    const substituteMode = this.config.lineAiSubstituteSemanticRoutingMode;
    const continuationCtx: RequestContext = {
      requestId, authSubject: identity.userId, userId: identity.userId, companyId,
      membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles,
      permissions: resolvedAccess.permissions, scopes: resolvedAccess.scopes, authProvider: 'line',
    };
    // Bounded substitute context for the semantic router (DATA only, never authority). In PRIMARY the
    // AUTHORITATIVE workflowState (none/open/paused/multiple) is read from the continuation rows (execute
    // re-reads them before any action); OFF/SHADOW keep the cheap signal so the legacy path adds NO query.
    // `workflowState` is NEVER rewritten from a ledger clarification — a pending paraphrase-start
    // confirmation (which has no workflow row yet) is encoded ONLY via hasPendingQuestion, so the next
    // affirmative still inherits the substitute route without faking an OPEN workflow.
    const substituteContextBase: LineIntakeSubstituteContext = substituteMode === 'primary' && this.substituteReceiptContinuation
      ? await this.substituteReceiptContinuation.substituteContext(continuationCtx, { chatKeyHash: chatKeyHashOf(event), recentCandidateCount: recentCapturedExpenses.length })
      : {
          workflowState: 'none', hasPendingQuestion: false, preparedState: 'none',
          recentCandidateCount: Math.min(recentCapturedExpenses.length, 5),
        };
    const substituteContext: LineIntakeSubstituteContext = {
      ...substituteContextBase,
      hasPendingQuestion: substituteContextBase.hasPendingQuestion || hasSubstituteClarification,
    };
    // OFF (default) and SHADOW keep develop's EXACT legacy regex-first interception before the router
    // (R1/R2 capture-first, GAP-C next-step). PRIMARY skips it and dispatches the semantic route AFTER
    // routePlan (below), so the two paths never both run.
    // R2: the request phrase arrived a turn ago with nothing to point it at, so it was parked as a
    // clarification. THIS message is the expense fact it was waiting for — the sender must not have
    // to type “ใบทดแทน” again to get what they already asked for. Only this marker means “no target
    // yet”: the numbered-choice and open-workflow substitute clarifications already have one, which
    // is exactly why capture-first still stands down for those.
    const carriedSubstituteIntent = !isSubstituteReceiptConversationText(normalizedText)
      && openWaiting.some((item) => item.clarifyForIntent === 'SUBSTITUTE_RECEIPT_CONTINUATION'
        && item.text === SUBSTITUTE_TARGET_PENDING_TEXT);
    const nextStepQuestion = isNextStepQuestionText(normalizedText);
    // GAP C tier 1: a “what do I do next?” with substitute work in flight is a question ABOUT that
    // work, so the continuation's own status card answers it. The lookup is paid for only by that
    // message. The AI owns this intent whenever the gateway is reachable; this is the floor under it.
    const nextStepSubstituteTarget = substituteMode !== 'primary' && nextStepQuestion && !hasSubstituteClarification
      && this.substituteReceiptContinuation && resolvedAccess.permissions.includes('expense.review')
      ? await this.substituteWorkInFlight(companyId, identity.userId, chatKeyHashOf(event), resolvedAccess.scopes)
      : undefined;
    let substituteInterruption: LineSubstituteReceiptContinuationResult | undefined;
    if (substituteMode !== 'primary'
      && this.substituteReceiptContinuation
      && (isSubstituteReceiptConversationText(normalizedText) || hasSubstituteClarification || nextStepSubstituteTarget)) {
      // R1: one message can be both a capture and a substitute request. Capture-first exists for the
      // dead-end it removes — a requester with NO candidate to target — so it stays off whenever the
      // existing target-selection flow can still do its job: a recent capture to point at, a
      // substitute question already pending, or a capture clarification still waiting on this chat
      // (that one owns the message's expense facts and its own ledger entry).
      const captureFirstAmount = (carriedSubstituteIntent
        || (isSubstituteReceiptConversationText(normalizedText) && !hasSubstituteClarification))
        && canCaptureExpense
        && recentCapturedExpenses.length === 0
        && !openWaiting.some((item) => item.clarifyForIntent === 'EXPENSE_DOCUMENT_CAPTURE')
        ? valueCandidates?.amounts[0]?.value
        : undefined;
      const captured = await this.captureBeforeSubstituteContinuation(
        event, continuationCtx, normalizedText, captureFirstAmount, carriedSubstituteIntent,
      );
      const captureReply = captured
        ? formatPaypersReply(this.config.webBaseUrl, companyId, captured.expense.id, {
          textOnly: true,
          amount: captured.insertedAmount,
          categoryName: captured.categoryName,
          sourceDocumentType: captured.expense.sourceDocumentType,
          fields: {
            ...(captured.expense.expenseDate ? { expenseDate: new Date(captured.expense.expenseDate).toISOString() } : {}),
            ...(captured.expense.vendorNameSnapshot ? { vendorName: captured.expense.vendorNameSnapshot } : {}),
          } as ReceiptOcrFieldResult,
        })
        : undefined;
      let result: LineSubstituteReceiptContinuationResult;
      try {
        result = await this.substituteReceiptContinuation.execute(continuationCtx, {
          messageText: normalizedText,
          chatKeyHash: chatKeyHashOf(event),
          recentCandidates: captured
            ? [{ id: captured.expense.id, label: `รายการที่เพิ่งบันทึก ${captured.expense.expenseNumber ?? captured.expense.id}` }]
            // GAP C tier 1: the one document this chat is in the middle of, so the card reports IT
            // instead of asking which of several recent captures the question was about.
            : nextStepSubstituteTarget
              ? [{ id: nextStepSubstituteTarget, label: 'งานใบรับรองแทนใบเสร็จรับเงินล่าสุดในแชทนี้' }]
              : recentCapturedExpenses.map((candidate) => ({ id: candidate.id, label: candidate.label })),
          webBaseUrl: this.config.webBaseUrl,
          // OFF/SHADOW legacy: a legacy-positive (the broad matcher fired) is itself the authoritative
          // start command, so it opens directly with NO confirmation step — preserving default-OFF behavior.
          confirmedStart: isSubstituteReceiptConversationText(normalizedText),
        });
      } catch (error) {
        // The draft is already committed; a continuation failure degrades, it never sinks the capture.
        if (!captureReply) throw error;
        this.logger.warn({ msg: 'line_substitute_continuation_after_capture_failed', requestId, error: (error as Error).message });
        const degraded = `${captureReply}\n\n${SUBSTITUTE_ADDITIONAL_OUTCOME_LABEL}\n${SUBSTITUTE_ADDITIONAL_OUTCOME_DEGRADED}`;
        await this.deliverCompletedReply(event, degraded, companyId, resolvedAccess);
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: degraded, intent: 'EVIDENCE_CAPTURE',
        });
        await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
        return;
      }
      // A FORBIDDEN outcome answers nothing and carries no resume capsule, so it must be delivered
      // through the normal branch instead of being reduced to a side-question interruption.
      //
      // S1: an open substitute clarification re-enters this branch on EVERY message in the chat, so
      // whatever it cannot read as an answer it must hand back rather than reply to. A question
      // already did that. A declarative sentence did not — so after a decline (which deliberately
      // leaves the decision listening) “ค่าแท็กซี่ 200 บาท” was answered by the substitute re-ask and
      // returned before the intake router ever saw it: the sender could not record another expense
      // until they finished this document. `decisionUnread` is the continuation saying the same
      // thing about a non-question, and the resume capsule still travels with the router's reply, so
      // the pending decision stays visible and “ออกเอกสารเลย” still lands on it next turn.
      //
      // GAP C: “ต้องทำยังไงต่อ” is not a question BESIDE this work, it is a question about it, and
      // handing it to the model is what produced the “ยังไม่พร้อมใช้งานผ่าน LINE” dead end. The card
      // already says what is done, what is missing and what to answer next, so it is the answer.
      const routeSideQuestion = hasSubstituteClarification
        && !isSubstituteReceiptConversationText(normalizedText)
        && !nextStepQuestion
        && (isInterveningQuestionText(normalizedText) || result.decisionUnread === true)
        && !result.sideQuestionAnswered
        && result.status !== 'FORBIDDEN';
      if (routeSideQuestion) {
        substituteInterruption = result;
      } else {
        const interruption = await interruptExpenseDraft(captured ? [captured.expense.id] : []);
        const merged = `${captureReply ? `${captureReply}\n\n${SUBSTITUTE_ADDITIONAL_OUTCOME_LABEL}\n` : ''}${result.replyText}`;
        const replyText = `${merged}${interruption ? `\n\n${interruption}` : ''}`;
        await this.deliverCompletedReply(event, replyText, companyId, resolvedAccess, result.badge);
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText, intent: captured ? 'EVIDENCE_CAPTURE' : 'CLARIFY',
        });
        await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting,
          openWaiting
            .filter((item) => item.clarifyForIntent === 'SUBSTITUTE_RECEIPT_CONTINUATION')
            .map((item) => item.id),
          'business_answer');
        // R2: this turn asked for the document and there was nothing in the chat to make it for, so
        // the request itself is parked for the ONE turn that supplies the expense fact. Bounded like
        // every other clarification — same chat, same asker, the ledger's context window — and the
        // very next turn through this branch consumes it, so an unrelated later message inherits
        // nothing. `!captured` keeps a turn that already produced a target from re-arming.
        const carriedIntentArmed = !result.pendingQuestion && !captured
          && result.status === 'TARGET_REQUIRED'
          && canCaptureExpense && recentCapturedExpenses.length === 0
          && isSubstituteReceiptConversationText(normalizedText);
        if (result.pendingQuestion || carriedIntentArmed) {
          await this.ledger?.appendSubRequests({
            companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
            userId: identity.userId,
            items: [{
              text: carriedIntentArmed ? SUBSTITUTE_TARGET_PENDING_TEXT : 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ',
              state: 'waiting_user',
              clarifyQuestion: result.pendingQuestion ?? SUBSTITUTE_TARGET_PENDING_QUESTION,
              intent: 'CLARIFY',
              clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION',
            }],
          });
        }
        await this.updateEventLog(
          event.webhookEventId,
          result.pendingQuestion || carriedIntentArmed ? 'clarification_required' : 'completed',
          undefined,
          companyId,
        );
        return;
      }
    }

    // GAP C tier 2: no substitute document in flight, but this chat did capture an expense — so
    // “ต้องทำยังไงต่อ” has a real answer and the model's “ส่วนนี้ยังไม่พร้อมใช้งานผ่าน LINE ค่ะ” was
    // both wrong and a dead end. With no capture to name, the question falls through untouched: the
    // AI owns intent whenever it is reachable, and this is only the floor under it.
    if (nextStepQuestion && !nextStepSubstituteTarget && recentCapturedExpenses.length > 0) {
      const reply = formatNextStepGuidanceReply(this.config.webBaseUrl, companyId, recentCapturedExpenses[0]);
      await this.deliverCompletedReply(event, reply, companyId, resolvedAccess);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: reply, intent: 'READ_SUMMARY',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    // Phase 6B (§11.2, budget §11.4): an exact standalone greeting is answered here with ZERO model calls —
    // no intake router, no gateway turn, no composer. It sits at the very END of the deterministic gates on
    // purpose: identity/company/access/legal/feature already ran, the parked picture was already resolved,
    // the ledger and the active-draft/substitute contexts were already read. It therefore fires only for a
    // turn carrying no state at all — no open clarification, no draft in flight, no pending media capsule,
    // no substitute workflow and no pending substitute question. Anything else falls through untouched, so
    // a greeting that arrives beside business text or beside open work still gets the full semantic route.
    if (this.config.lineAiExactGreetingEnabled
      && isExactStandaloneGreeting(normalizedText)
      && openWaiting.length === 0
      && activeExpenseDrafts.length === 0
      && !mediaResumeCapsule
      && substituteContext.workflowState === 'none'
      && !substituteContext.hasPendingQuestion) {
      // Ordering only: the outcome is recorded before delivery so a failed send leaves a record of what
      // was decided. This is NOT the §8.3 durable replay — `persistIntakeTurn` is best-effort memory
      // (it swallows its own failure) and no seam re-sends a persisted outcome on a later retry.
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: EXACT_GREETING_REPLY, intent: 'UNKNOWN',
      });
      await this.deliverCompletedReply(event, EXACT_GREETING_REPLY, companyId, resolvedAccess);
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    const aiOpenClarifications = openClarifications?.filter((item) =>
      !(substituteInterruption && item.clarifyForIntent === 'SUBSTITUTE_RECEIPT_CONTINUATION')
      && !(mediaResumeCapsule && item.pendingMedia));

    // 5.5 LINE Intake Router first: semantic route before any source-module dispatch.
    // Deterministic guards (identity, company, permissions) already ran above.
    // One busy-wait budget for the WHOLE live turn (intake + gateway turn share it), so a turn
    // queued behind an in-flight media turn waits for the lease instead of bouncing the user.
    const busyWaitDeadlineMs = Date.now() + LINE_AI_LIVE_BUSY_WAIT_MS;
    const routePlan = await this.timeStage(event.webhookEventId, 'intake_route', () => this.tryRouteIntake({
      requestId,
      companyId,
      userId: identity.userId,
      permissions: resolvedAccess.permissions,
      messageText: normalizedText,
      conversationContext,
      ...(valueCandidates && { valueCandidates }),
      ...(aiOpenClarifications?.length && { openClarifications: aiOpenClarifications }),
      ...(recentCapturedExpenses.length > 0 && { recentCapturedExpenses }),
      ...(activeExpenseDrafts.length > 0 && { activeExpenseDrafts }),
      // PRIMARY only — off AND the inert 'shadow' NO-GO never send substituteContext, so their intake DATA
      // payload stays byte-equivalent to legacy (shadow must not diverge from off in any observable way).
      ...(substituteMode === 'primary' ? { substituteContext } : {}),
      busyWaitDeadlineMs,
    }));

    // Advisor Slice A (spec §9.1 row 7 / §9.2): a routed ADVISOR_CONVERSATION whose bounded social
    // draft passes every delivery-time gate is answered HERE from the single intake call — no
    // gateway turn, no second model call. Any declined gate falls through UNCHANGED: the turn
    // request below carries intakeIntent='ADVISOR_CONVERSATION' and the full path treats it like
    // UNSUPPORTED, reusing no authority from the discarded payload.
    const advisorDirectText = advisorDirectAnswerText(routePlan.advisorAnswer, {
      advisorEnabled: this.config.lineAiAdvisorMode !== 'off',
      routedAdvisor: routePlan.status === 'ROUTED' && routePlan.intent === 'ADVISOR_CONVERSATION',
      hasAttachment: false, // text path — the media path routes documents, never ADVISOR_CONVERSATION
      hasOpenClarifications: openWaiting.length > 0,
      hasActiveExpenseDrafts: activeExpenseDrafts.length > 0,
      hasPendingMediaCapsule: !!mediaResumeCapsule,
      hasSubstituteState: substituteContext.workflowState !== 'none' || substituteContext.hasPendingQuestion,
    });
    if (advisorDirectText) {
      this.logger.log({ msg: 'line.ai.advisor_direct_served', requestId, companyId, context: 'ProcessLineWebhookUseCase' });
      // Same ordering as the exact-greeting lane: record what was decided, then deliver.
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: advisorDirectText, intent: 'UNKNOWN',
      });
      await this.deliverCompletedReply(event, advisorDirectText, companyId, resolvedAccess);
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    // PRIMARY substitute semantic dispatch — a TYPED branch AFTER routePlan (OFF/SHADOW ran the legacy
    // regex path above; the two never both execute). It reuses the existing continuation use case
    // verbatim (feature/permission/scope/preflight/ledger/audit unchanged), consumes ONLY the substitute
    // clarifications, and only falls back to the narrow regex when the semantic route was UNAVAILABLE.
    if (substituteMode === 'primary' && this.substituteReceiptContinuation) {
      const semanticSubstitute = routePlan.status === 'ROUTED' && routePlan.intent === 'SUBSTITUTE_RECEIPT_CONTINUATION';
      // NARROW primary fallback — canonical document names + exact state controls ONLY, and only when the
      // semantic route is UNAVAILABLE. Never the broad legacy matcher, so a question/negation cannot
      // start; pause/cancel controls only when the AUTHORITATIVE workflowState proves real open state.
      const narrowMatch = isCanonicalSubstituteCommand(normalizedText, substituteContext.workflowState !== 'none');
      const fallbackSubstitute = routePlan.status === 'UNAVAILABLE' && narrowMatch;
      if (semanticSubstitute || fallbackSubstitute) {
        const substituteClarifications = openWaiting.filter((item) => item.clarifyForIntent === 'SUBSTITUTE_RECEIPT_CONTINUATION');
        const substituteClarificationIds = substituteClarifications.map((item) => item.id);
        // Compute the resolved-intersection BEFORE execute so the confirmation binds to a REAL, currently
        // active clarification — never a stale/historical substitute clarification. The model may only
        // resolve an id we actually surfaced this turn (openClarifications carries the ids + shortlist).
        const modelResolved = (routePlan.resolvedClarificationIds ?? []).filter((id) => substituteClarificationIds.includes(id));
        const resolvedClar = substituteClarifications.find((item) => modelResolved.includes(item.id));
        // A START-CONFIRM clarification carries EXACTLY ONE candidate id (the single expense a paraphrase
        // pinned to confirm). A target-selection carries the offered shortlist (>= 2); a field-continuation
        // carries none.
        const startConfirmClars = substituteClarifications.filter((item) => item.candidateExpenseIds?.length === 1);
        const affirmative = isAffirmativeText(normalizedText);
        // REPETITIVE-CONFIRMATION GUARD: when the provider ROUTES substitute but OMITS the resolved
        // clarification id (resolvedClar undefined), an affirmative would otherwise never confirm and the
        // user is re-asked forever. Recover DETERMINISTICALLY — but ONLY when there is EXACTLY ONE active
        // start-confirm clarification with EXACTLY ONE candidate id, so no ambiguous (>= 2 pending confirms)
        // or missing (0) state can ever auto-bind; those stay zero-write and re-clarify/fall back. Gated on
        // an affirmative, so a non-confirming message never changes the candidate universe.
        const deterministicStartConfirmClar = !resolvedClar && affirmative && startConfirmClars.length === 1
          ? startConfirmClars[0]
          : undefined;
        // Provenance FIRST (current-active ∩ model-resolved); the deterministic single-target recovery only
        // fills in when the model omitted the id. Either way the target rides the RESOLVED clarification's
        // typed shortlist, so the ordinal/affirmative binds to the SAME id the previous turn offered — never
        // the shifting recency window. A start-confirm carries exactly ONE id; a target-selection the shortlist.
        const effectiveClar = resolvedClar ?? deterministicStartConfirmClar;
        const boundCandidateIds = effectiveClar?.candidateExpenseIds ?? [];
        const startConfirmId = boundCandidateIds.length === 1 ? boundCandidateIds[0] : undefined;
        // confirmedStart requires an affirmative AND a currently active, single-target start-confirm
        // clarification — resolved by the model OR recovered by the deterministic single-target guard. A
        // stale/unresolved multi-target or absent clarification can never confirm a start (no write).
        const confirmedStart = affirmative && startConfirmId !== undefined;
        // The bound target(s) are the FROZEN candidate universe (labels re-hydrated from the recency window
        // when still present); otherwise the recent captures. execute re-checks every id authoritatively.
        const executeCandidates = boundCandidateIds.length > 0
          ? boundCandidateIds.map((id) => ({ id, label: recentCapturedExpenses.find((candidate) => candidate.id === id)?.label ?? id }))
          : recentCapturedExpenses.map((candidate) => ({ id: candidate.id, label: candidate.label }));
        // The continuation use case re-reads authoritative state and rejects on permission/feature/
        // eligibility BEFORE any save; a question/negation/denied result writes nothing. An affirmative
        // to a pending start clarification confirms the paraphrase start for that ONE bound expense.
        const result = await this.substituteReceiptContinuation.execute(continuationCtx, {
          messageText: normalizedText,
          chatKeyHash: chatKeyHashOf(event),
          recentCandidates: executeCandidates,
          // PRIMARY is the model-only route: a FRESH start that matches no deterministic entry phrase must
          // CONFIRM before it writes (no auto-create on the router's confidence alone).
          requireStartConfirmation: true,
          confirmedStart,
        });
        // PRECEDENCE when BOTH a substitute workflow AND an expense draft are open: the substitute path
        // (semantic route, OR the narrow canonical fallback taken because the provider was UNAVAILABLE)
        // wins THIS turn, and any OPEN expense draft is INTERRUPTED — paused with a note appended to the
        // reply, never silently dropped. So even with the router unreachable, a canonical substitute
        // command deterministically handles the substitute and preserves the draft to resume later.
        const interruption = await interruptExpenseDraft();
        const replyText = `${result.replyText}${interruption ? `\n\n${interruption}` : ''}`;
        await this.deliverCompletedReply(event, replyText, companyId, resolvedAccess);
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText, intent: 'CLARIFY',
        });
        // Consume ONLY the substitute clarifications actually acted on: the model-resolved intersection,
        // plus a deterministically-recovered single start-confirm (so a confirmed start is never re-asked
        // next turn). NEVER fall back to consuming all substitute-owned ids (no clarification hijack).
        const consumedClarIds = deterministicStartConfirmClar ? [...modelResolved, deterministicStartConfirmClar.id] : modelResolved;
        if (consumedClarIds.length > 0) {
          await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting, consumedClarIds, 'business_answer');
        }
        // A pending question (start-confirm / field ask) OR an unresolved target-selection shortlist both
        // keep the turn waiting: open ONE substitute clarification pinned to the exact target(s), so the
        // next ordinal ("1") or affirmative ("ใช่") binds to the SAME id — not the shifting recency window.
        const awaitingUser = !!result.pendingQuestion || !!result.candidateExpenseIds?.length;
        if (awaitingUser) {
          await this.ledger?.appendSubRequests({
            companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
            userId: identity.userId,
            items: [{
              text: 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ', state: 'waiting_user',
              clarifyQuestion: result.pendingQuestion ?? result.replyText, intent: 'CLARIFY',
              clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION',
              // Pin the exact target(s) so the next ordinal/affirmative binds to the SAME id (P1-2).
              ...(result.candidateExpenseIds?.length ? { candidateExpenseIds: result.candidateExpenseIds } : {}),
            }],
          });
        }
        this.logSubstituteRoute(event, normalizedText, {
          source: semanticSubstitute ? 'semantic' : 'narrow_fallback', routePlan,
          regexMatch: narrowMatch, workflowState: substituteContext.workflowState, pendingQuestion: awaitingUser,
        });
        await this.updateEventLog(event.webhookEventId,
          awaitingUser ? 'clarification_required' : 'completed', undefined, companyId);
        return;
      }
      // Not substitute-routed: a side question / new unrelated expense keeps any open substitute
      // clarification OPEN (no consumption here) and routes normally below.
      this.logSubstituteRoute(event, normalizedText, {
        source: 'semantic_nonsubstitute', routePlan, regexMatch: narrowMatch,
        workflowState: substituteContext.workflowState, pendingQuestion: false,
      });
    }

    // SHADOW is a truthful NO-GO: this short-circuit architecture cannot compute a real semantic-vs-legacy
    // comparison for a turn the legacy path already handled without either adding user latency or firing a
    // background route. Rather than emit FAKE agreement, `shadow` behaves EXACTLY like `off` (legacy) and
    // logs nothing new — it is intentionally impossible to activate a meaningful shadow until a bounded
    // nonblocking compare exists. Offline provider replay measures agreement instead.

    // Reimbursement semantic intake — a TYPED branch AFTER routePlan, gated on the same trusted mode the
    // capability flag came from ('shadow' is inert and behaves exactly like 'off'). LINE never writes a
    // reimbursement or an expense here: the payer question, the clarify-only acknowledgement and the web
    // handoff are the only outcomes, and every recorded reply text is canonical server copy.
    const reimbursementMode = this.config.lineAiReimbursementSemanticMode;
    if (
      (reimbursementMode === 'clarify_only' || reimbursementMode === 'handoff')
      && routePlan.status === 'ROUTED' && routePlan.intent === 'REIMBURSEMENT_REQUEST_START'
    ) {
      // Exactly the reimbursement questions THIS turn answered — the model's resolved ids narrowed to the
      // entries this user was asked for THIS intent. Consuming anything wider would silently close another
      // intent's (or another user's) open question on the strength of an answer about who paid.
      // A provider that reports NO id consumes nothing: the open question stays open and the next turn
      // inherits it. A stale re-ask is the accepted cost of never closing a financial question on a guess.
      const resolvedReimbursementIds = openWaiting
        .filter((item) => item.clarifyForIntent === 'REIMBURSEMENT_REQUEST_START'
          && routePlan.resolvedClarificationIds?.includes(item.id))
        .map((item) => item.id);

      // Authority is decided BEFORE the payer question, not after it: asking who paid and only then
      // refusing spends the user's answer on a lane they were never able to reach. The gate is the web
      // form's own — feature entitlement (legacy null = fail-open), reimbursement.create, and a branch
      // scope that can reach at least one branch (an explicitly empty scope reaches none).
      const handoffAllowed = (entitledFeatureKeys === null || entitledFeatureKeys.has('reimbursement'))
        && resolvedAccess.permissions.includes('reimbursement.create')
        && (resolvedAccess.scopes.branchIds === undefined || resolvedAccess.scopes.branchIds.length > 0);
      if (reimbursementMode === 'handoff' && !handoffAllowed) {
        // Canonical outcome first, then the resolved question is closed, then delivery. No CTA, no new
        // ledger question, zero writes — a denied user is never left waiting on an answer we cannot use.
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: REIMBURSEMENT_HANDOFF_FORBIDDEN_REPLY,
          intent: 'MUTATION_REQUEST', refused: true,
        });
        await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting,
          resolvedReimbursementIds, 'reimbursement_forbidden');
        await this.deliverReply(event, REIMBURSEMENT_HANDOFF_FORBIDDEN_REPLY);
        await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
        return;
      }
      // Fail-closed: anything short of a strong EMPLOYEE_PAID claim asks who paid before anything else.
      if (routePlan.semanticOutcome !== 'REIMBURSEMENT_CLAIM' || routePlan.fundingSource !== 'EMPLOYEE_PAID') {
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: REIMBURSEMENT_PAYER_CLARIFY_REPLY, intent: 'CLARIFY',
        });
        // An answer that did not settle the payer closes the question it answered and opens the NEXT one,
        // in that order — otherwise the stale entry outlives the reply and the next message inherits it.
        await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting,
          resolvedReimbursementIds, 'reimbursement_payer_reclarify');
        await this.ledger?.appendSubRequests({
          companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
          userId: identity.userId,
          items: [{
            text: normalizedText, state: 'waiting_user', clarifyQuestion: REIMBURSEMENT_PAYER_CLARIFY_REPLY,
            intent: 'CLARIFY', clarifyForIntent: 'REIMBURSEMENT_REQUEST_START',
          }],
        });
        await this.deliverRequiredMessages(event, [await this.timeStage(event.webhookEventId, 'render',
          () => this.withCompletionMenu(buildReimbursementPayerClarificationMessage(), companyId, resolvedAccess))]);
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      if (reimbursementMode === 'clarify_only') {
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: REIMBURSEMENT_CLARIFY_ONLY_REPLY, intent: 'MUTATION_REQUEST',
        });
        await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting,
          resolvedReimbursementIds, 'reimbursement_clarify_only');
        // Server card with no CTA: the text carries no link, so the card renders no button.
        await this.deliverRequiredMessages(event, [await this.timeStage(event.webhookEventId, 'render',
          async () => buildLineAssistantTextCardMessage(REIMBURSEMENT_CLARIFY_ONLY_REPLY, this.config.webBaseUrl, companyId))]);
        await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
        return;
      }
      // handoff, allowed: the web form is still the only place the record is created.
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: REIMBURSEMENT_HANDOFF_REPLY, intent: 'MUTATION_REQUEST',
      });
      await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting,
        resolvedReimbursementIds, 'reimbursement_handoff');
      await this.deliverRequiredMessages(event, [await this.timeStage(event.webhookEventId, 'render',
        () => this.withCompletionMenu(buildReimbursementHandoffMessage(this.config.webBaseUrl, companyId), companyId, resolvedAccess))]);
      await this.audit.log({
        companyId, actorUserId: identity.userId, action: 'reimbursement.line_handoff',
        targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'SUCCESS', riskLevel: 'LOW',
        metadataJson: { semanticOutcome: routePlan.semanticOutcome, fundingSource: routePlan.fundingSource, confidence: routePlan.confidence },
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    if (routePlan.status === 'ROUTED' && routePlan.intent === 'EXPENSE_DRAFT_CONTINUATION') {
      if (!expenseDraftConversationEnabled) {
        await this.deliverReply(event, TEXT_EXPENSE_CLARIFY_REPLY);
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      if (!canCaptureExpense || !this.expenseDraftConversation) {
        await this.deliverReply(event, receiptDeniedReply(resolvedAccess));
        await this.updateEventLog(event.webhookEventId,
          receiptFeatureDisabled(resolvedAccess) ? 'feature_disabled' : 'forbidden',
          receiptFeatureDisabled(resolvedAccess) ? LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE : LINE_AI_ERROR_CODES.FORBIDDEN,
          companyId);
        return;
      }
      const result = await this.expenseDraftConversation.execute(expenseDraftCtx, {
        messageText: normalizedText,
        chatKeyHash: chatKeyHashOf(event),
        webhookEventId: event.webhookEventId,
        captureHints: routePlan.captureHints,
      });
      if (!result.handled) {
        await this.deliverReply(event, TEXT_EXPENSE_CLARIFY_REPLY);
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      await this.deliverCompletedReplies(event, result.replyTexts, companyId, resolvedAccess);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: result.replyTexts.join('\n'), intent: 'CLARIFY',
      });
      await this.updateEventLog(event.webhookEventId, result.status === 'UPDATED' ? 'clarification_required' : 'completed', undefined, companyId);
      return;
    }

    if (routePlan.status === 'ROUTED' && routePlan.intent === 'EXPENSE_DOCUMENT_CAPTURE') {
      if (!canCaptureExpense) {
        await this.deliverReply(event, receiptDeniedReply(resolvedAccess));
        await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.reject', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'MEDIUM', metadataJson: { reason: 'missing_expense_receipt_line_upload', route: 'text_note' } });
        await this.updateEventLog(event.webhookEventId,
          receiptFeatureDisabled(resolvedAccess) ? 'feature_disabled' : 'forbidden',
          receiptFeatureDisabled(resolvedAccess) ? LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE : LINE_AI_ERROR_CODES.FORBIDDEN,
          companyId);
        return;
      }
      if (!this.captureExpenseNote) {
        await this.deliverReply(event, ERROR_REPLY);
        await this.updateEventLog(event.webhookEventId, 'expense_module_unavailable', 'EXPENSE_MODULE_UNAVAILABLE', companyId);
        return;
      }
      const ctx: RequestContext = {
        requestId,
        authSubject: identity.userId,
        userId: identity.userId,
        companyId,
        membershipId: resolvedAccess.membershipId,
        roles: resolvedAccess.roles,
        permissions: resolvedAccess.permissions,
        scopes: resolvedAccess.scopes,
        authProvider: 'line',
      };
      const capturePlan = this.planConsumption(companyId, chatKey, identity.userId, openWaiting, routePlan.resolvedClarificationIds, 'evidence_capture');

      // §8.3 durable-state gate. This turn CONTINUES an earlier financial question exactly when the
      // router says it resolved one; that is also the only turn where a wrong answer can carry a
      // wrong amount into a real record, so it is the only turn gated here. A first-contact capture
      // is unchanged in every mode.
      //
      // The gate runs BEFORE `captureExpenseNote.execute`, which is what makes every refusal a
      // ZERO-write refusal: nothing downstream has run, so there is nothing to undo. Ordering it
      // after the capture would leave a created expense behind on a state we then rejected.
      const intakeStateMode = this.config.lineAiIntakeStateMode;
      // Positive membership, per the fail-open lesson: only these two literals activate anything.
      // An unset flag, or a value the schema somehow let through, stays 'off' and touches nothing.
      if ((intakeStateMode === 'shadow' || intakeStateMode === 'on')
        && this.intakeState && (routePlan.resolvedClarificationIds?.length ?? 0) > 0) {
        const stateOwner = { companyId, userId: identity.userId, chatKeyHash: chatKeyHashOf(event) };
        // Read then CAS-consume. The owner triple is inside BOTH queries, so a different member,
        // chat or company selects no row and lands on the same refusal as an outage would.
        const open = await this.intakeState.readOpenState(stateOwner);
        const consumed = open.ok
          ? await this.intakeState.resolveState(stateOwner, { id: open.value.id, version: open.value.version })
          : open;
        if (intakeStateMode === 'shadow') {
          // MEASUREMENT ONLY. The ledger already decided this turn continues; we record whether the
          // durable state agreed, and then fall through to the byte-identical 'off' behavior. No
          // reply, no write and no consumption changes on this branch — a shadow lane that could
          // refuse a turn would be a behavior lane wearing a measurement label.
          this.logger.log(JSON.stringify({
            event: 'line_ai_intake_state_shadow_divergence',
            webhookEventId: event.webhookEventId,
            companyId,
            ledgerContinuation: true,
            durableStateAgreed: consumed.ok,
            ...(consumed.ok ? {} : { refusal: consumed.reason }),
          }));
        } else if (!consumed.ok) {
          // 'on', and the durable state refused: outage, stale/expired version, or an owner this
          // state does not belong to. FAIL CLOSED — no capture call, no consumption marker, no
          // ledger ack, so the open question survives and the customer is re-asked with the same
          // canonical copy instead of having a guessed amount written for them.
          await this.deliverReply(event, TEXT_EXPENSE_CLARIFY_REPLY);
          await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
          return;
        }
      }

      let captured: Awaited<ReturnType<CaptureLineExpenseNoteUseCase['execute']>>;
      try {
        captured = await this.timeStage(event.webhookEventId, 'capture_execute', () => this.captureExpenseNote!.execute(ctx, {
          messageText: normalizedText,
          captureHints: {
            ...(routePlan.captureHints ?? {}),
            confidence: routePlan.captureHints?.confidence ?? routePlan.confidence,
          },
          groundingTexts: openWaiting
            .filter((item) => routePlan.resolvedClarificationIds?.includes(item.id)
              && item.clarifyForIntent === 'EXPENSE_DOCUMENT_CAPTURE')
            .map((item) => item.text),
          lineMessageId: event.lineMessageId ?? event.webhookEventId,
          lineEventId: event.webhookEventId,
          draftConversationEnabled: expenseDraftConversationEnabled,
          // Phase 1B (§8.1): grounded `businessPurpose` may satisfy completeness ONLY behind the semantic
          // primary guard. 'off'/'shadow' never sets it, so the completeness expansion cannot ship alone —
          // and a route the server did not verify as company-paid business spend never unlocks it.
          semanticBusinessExpenseConfirmed: (reimbursementMode === 'clarify_only' || reimbursementMode === 'handoff')
            && routePlan.semanticOutcome === 'BUSINESS_EXPENSE' && routePlan.fundingSource === 'COMPANY_PAID',
          chatKeyHash: chatKeyHashOf(event),
          ...(capturePlan ? { consumption: capturePlan.consumption } : {}),
        }));
      } catch (error) {
        if (!(error instanceof LineTextExpenseCaptureIncompleteError)) throw error;
        // One canonical question for the fields that are actually missing — the same string is delivered,
        // persisted and ledgered, so a later turn resolves exactly what the user was asked.
        const clarifyReply = formatTextExpenseClarifyReply(error);
        await this.deliverReply(event, clarifyReply);
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: clarifyReply, intent: 'CLARIFY',
        });
        await this.ledger?.appendSubRequests({
          companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
          userId: identity.userId,
          items: [{
            text: normalizedText,
            state: 'waiting_user',
            clarifyQuestion: clarifyReply,
            intent: 'CLARIFY',
            clarifyForIntent: 'EXPENSE_DOCUMENT_CAPTURE',
          }],
        });
        // §8.3: the durable half of the question the ledger entry above only REFERENCES. The ledger
        // fails open, so on a Redis outage that entry can vanish; the accepted facts, the missing
        // field list and the CAS version live here instead, where an outage refuses rather than
        // forgets. Opening supersedes whatever this owner had open, so the customer never has two
        // live questions competing for the same answer.
        //
        // Best-effort by design, and safe: a failed open leaves NO state, and a later continuation
        // with no state is exactly the refusal path above. The failure mode is a re-ask, never a
        // write on a question we did not durably record.
        if ((intakeStateMode === 'shadow' || intakeStateMode === 'on') && this.intakeState) {
          await this.intakeState.openState({
            companyId, userId: identity.userId, chatKeyHash: chatKeyHashOf(event),
            targetIntent: 'EXPENSE_DOCUMENT_CAPTURE',
            semanticOutcome: routePlan.semanticOutcome ?? null,
            // Only what the capture already ACCEPTED (merge rule 1 keeps these until an explicit
            // correction) plus the field lists the typed error carries. Bounded labels and
            // already-grounded hints only — no raw conversation, no PII (§8.2).
            acceptedHints: routePlan.captureHints ?? null,
            missingFields: error.missingFields,
            conflictingFields: error.conflictingFields,
            provenance: { acceptedFields: error.acceptedFields, origin: 'original_turn' },
            sourceEventHash: hashMessagePreview(event.webhookEventId),
            ttlMinutes: LINE_AI_CONTEXT_WINDOW_MINUTES,
          });
        }
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      const replyTexts = captured.replyTexts.length
        ? captured.replyTexts
        : [formatPaypersReply(this.config.webBaseUrl, companyId, captured.expense.id, {
          textOnly: true,
          amount: captured.insertedAmount,
          categoryName: captured.categoryName,
          sourceDocumentType: captured.expense.sourceDocumentType,
          fields: {
            ...(captured.expense.expenseDate ? { expenseDate: new Date(captured.expense.expenseDate).toISOString() } : {}),
            ...(captured.expense.vendorNameSnapshot ? { vendorName: captured.expense.vendorNameSnapshot } : {}),
          } as ReceiptOcrFieldResult,
        })];
      const expenseDraftInterruption = await interruptExpenseDraft([captured.expense.id]);
      if (expenseDraftInterruption) replyTexts[replyTexts.length - 1] = `${replyTexts.at(-1)}\n\n${expenseDraftInterruption}`;
      await this.deliverCompletedReplies(event, replyTexts, companyId, resolvedAccess,
        expenseDraftCardFacts(captured.expense.id, {
          amount: captured.insertedAmount,
          categoryName: captured.categoryName,
          item: captured.expense.vendorNameSnapshot ?? captured.expense.note,
        }));
      await this.ackConsumed(capturePlan, 'evidence_capture');
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: replyTexts.join('\n'), intent: 'EVIDENCE_CAPTURE',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    if (routePlan.status === 'ROUTED' && routePlan.intent === 'EXPENSE_CAPTURE_CORRECTION') {
      if (!canCaptureExpense) {
        await this.deliverReply(event, receiptDeniedReply(resolvedAccess));
        await this.updateEventLog(event.webhookEventId,
          receiptFeatureDisabled(resolvedAccess) ? 'feature_disabled' : 'forbidden',
          receiptFeatureDisabled(resolvedAccess) ? LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE : LINE_AI_ERROR_CODES.FORBIDDEN,
          companyId);
        return;
      }
      const canEdit = resolvedAccess.permissions.includes('expense.update') || resolvedAccess.permissions.includes('expense.review');
      const correctionPlan = this.planConsumption(companyId, chatKey, identity.userId, openWaiting, routePlan.resolvedClarificationIds, 'correction_apply');
      const correctionCtx: RequestContext = {
        requestId, authSubject: identity.userId, userId: identity.userId, companyId,
        membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles,
        permissions: resolvedAccess.permissions, scopes: resolvedAccess.scopes, authProvider: 'line',
      };
      // Try to apply; every guard failure degrades to the guidance reply — never to a create.
      const applied = this.correctExpense
        ? await this.correctExpense.execute(correctionCtx, {
          lineMessageIdHash: hashMessagePreview(event.lineMessageId ?? event.webhookEventId),
          candidates: recentCapturedExpenses,
          ...(routePlan.correctionHints ? { hints: routePlan.correctionHints } : {}),
          evidence: buildCorrectionEvidence(normalizedText, openWaiting, routePlan.resolvedClarificationIds),
          ...(correctionPlan ? { consumption: correctionPlan.consumption } : {}),
        })
        : { status: 'guidance' as const, reason: 'correction_module_unavailable' };

      let reply: string;
      if (applied.status === 'applied') {
        await this.ackConsumed(correctionPlan, 'correction_apply');
        reply = formatCorrectionAppliedReply(this.config.webBaseUrl, companyId, applied.expenseId, applied.fields);
      } else if (applied.status === 'clarify') {
        reply = CORRECTION_DIRECTION_CLARIFY_REPLY;
      } else {
        reply = formatCorrectionGuidanceReply(this.config.webBaseUrl, companyId, recentCapturedExpenses, canEdit);
        await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting, routePlan.resolvedClarificationIds, 'correction_guidance');
      }
      const expenseDraftInterruption = applied.status === 'clarify' ? undefined : await interruptExpenseDraft();
      if (expenseDraftInterruption) reply = `${reply}\n\n${expenseDraftInterruption}`;
      if (applied.status === 'clarify') await this.deliverReply(event, reply);
      else await this.deliverCompletedReply(event, reply, companyId, resolvedAccess);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: reply, intent: 'CORRECTION',
      });
      await this.audit.log({
        companyId, actorUserId: identity.userId, action: 'expense.line_correction.guide',
        targetType: recentCapturedExpenses.length === 1 ? 'expense_record' : 'LineWebhookEvent',
        targetId: recentCapturedExpenses.length === 1 ? recentCapturedExpenses[0].id : event.webhookEventId,
        requestId, result: 'SUCCESS', riskLevel: 'LOW',
        metadataJson: { candidateCount: recentCapturedExpenses.length, canEdit, outcome: applied.status },
      });
      await this.updateEventLog(
        event.webhookEventId,
        applied.status === 'clarify' ? 'clarification_required' : 'completed',
        undefined,
        companyId,
      );
      return;
    }

    if (routePlan.status === 'ROUTED' && routePlan.intent === 'SIGNATURE_UPLOAD_TICKET') {
      if (!canSubmitSignature) {
        await this.deliverReply(event, SIGNATURE_FORBIDDEN_REPLY);
        await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
        return;
      }
      // Text asked for a signature upload but no image came with it: ask for the image only.
      await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting, routePlan.resolvedClarificationIds, 'signature_request');
      const expenseDraftInterruption = await interruptExpenseDraft();
      const reply = `${SIGNATURE_NEED_IMAGE_REPLY}${expenseDraftInterruption ? `\n\n${expenseDraftInterruption}` : ''}`;
      await this.deliverReply(event, reply);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: reply, intent: 'SIGNATURE_REQUEST',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    if (routePlan.status === 'ROUTED' && routePlan.intent === 'CLARIFY') {
      // Discovery: prefer the router's own clarifying question (bounded at parse) over the template.
      const clarifyReply = routePlan.clarifyQuestion ?? CLARIFY_REPLY;
      await this.deliverReply(event, clarifyReply);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: clarifyReply, intent: 'CLARIFY',
      });
      // Item 10F: the clarified request waits in the ledger; the next turn carries it and the
      // reclaim expires it silently (audited) when the user never answers.
      await this.ledger?.appendSubRequests({
        companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
        userId: identity.userId,
        items: [{
          text: normalizedText, state: 'waiting_user', clarifyQuestion: clarifyReply, intent: 'CLARIFY',
          // Deterministic inheritance: the ANSWER to this question resumes the original route.
          ...(routePlan.clarifyForIntent ? { clarifyForIntent: routePlan.clarifyForIntent } : {}),
          ...(routePlan.clarifyForIntent === 'EXPENSE_CAPTURE_CORRECTION' && recentCapturedExpenses.length > 0
            ? { candidateExpenseIds: recentCapturedExpenses.map((candidate) => candidate.id) }
            : {}),
        }],
      });
      await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
      return;
    }

    // BUSINESS_READ_QUESTION, MUTATION_REQUEST_REFUSAL, UNSUPPORTED, or router
    // UNAVAILABLE: continue through the normal permission-checked AI turn path.
    if (!canQuery) {
      await this.deliverReply(event, FORBIDDEN_REPLY);
      await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
      return;
    }

    // 6. Build user context (server-derived only)
    const userCtx: LineUserContext = {
      lineUserId: '[REDACTED]', // Never pass raw LINE user id to AI Gateway
      internalUserId: identity.userId,
      companyId,
      membershipId: resolvedAccess.membershipId,
      permissions: resolvedAccess.permissions,
      entitlementDeniedPermissions: resolvedAccess.entitlementDeniedPermissions,
      entitledFeatureKeys: resolvedAccess.entitledFeatureKeys,
      roles: resolvedAccess.roles,
      branchIds: resolvedAccess.scopes.branchIds,
      locale: 'th-TH',
    };

    // 7. Build turn request
    const modelPolicy = await resolveCompanyAiModelPolicy(this.prisma, companyId, this.config.approvedAiModelIds);
    const turnRequest: LineAiTurnRequest = {
      requestId,
      webhookEventId: event.webhookEventId,
      userContext: userCtx,
      ...(modelPolicy && { modelPolicy }),
      messageText: normalizedText,
      ...(conversationContext && { conversationContext }),
      ...(valueCandidates && { valueCandidates }),
      ...(aiOpenClarifications?.length && { openClarifications: aiOpenClarifications }),
      messagePreviewHash: hashMessagePreview(event.messageText),
      ...(entitledFeatureKeys && { entitledFeatureKeys: [...entitledFeatureKeys] }),
      // Phase 3/4 (default OFF): forward ONLY the intake route's already-parsed prepared plan when a
      // downstream gateway lane wants it — shadow comparison (Phase 3) or one-call simple read
      // (Phase 4). OR-gated so the lanes stay independent. The wrapper carries no authority; the
      // TRUSTED intake provenance is bound SEPARATELY here from the already-parsed OUTER route intent
      // (validated by explicit membership, never from the wrapper), so the gateway lane gates on real
      // provenance. The gateway re-parses the wrapper and re-validates intakeIntent; nothing executes
      // unless its own prepared-simple-read flag is on.
      ...((this.config.lineAiFusedPlanShadowEnabled || this.config.lineAiPreparedSimpleReadEnabled) && routePlan.preparedPlan
        ? {
            preparedPlan: routePlan.preparedPlan,
            ...(asIntakeRouteIntent(routePlan.intent) ? { intakeIntent: asIntakeRouteIntent(routePlan.intent) } : {}),
          }
        : {}),
      // Advisor spec §9.1: an ADVISOR_CONVERSATION route whose direct answer is off, discarded or
      // never proposed falls through to the SAME gateway turn every UNSUPPORTED turn already takes —
      // it just carries the trusted outer provenance so each receiver (gateway turn, AgentCore
      // runtime) validates membership and can tell the lane apart in telemetry. The social envelope
      // carries no preparedPlan, so this binding is what makes the provenance survive. Unreachable
      // while LINE_AI_ADVISOR_MODE='off': the router is never offered the route.
      ...(routePlan.status === 'ROUTED' && routePlan.intent === 'ADVISOR_CONVERSATION'
        ? { intakeIntent: 'ADVISOR_CONVERSATION' as const }
        : {}),
    };

    // 7.5 Item 10F: durable `turn` entry BEFORE the gateway call — a crash mid-turn leaves it
    // unacked and the reclaim worker re-runs it (at-least-once is safe: read-only channel).
    const ledgerTurnId = this.ledger
      ? await this.ledger.appendTurn({
          companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
          userId: identity.userId, text: normalizedText,
          ...(valueCandidates && { valueCandidates }),
        })
      : null;

    // 8. Call AI Gateway
    let turnResponse: LineAiTurnResponse;
    try {
      turnResponse = await this.timeStage(event.webhookEventId, 'gateway_turn', () => this.aiGateway.requestLineTurn(turnRequest, { busyWaitDeadlineMs }));
    } catch (err) {
      this.logger.error({ msg: 'AI Gateway error', requestId, error: (err as Error).message });
      const failure = classifyLineAiGatewayFailure(err);
      await this.deliverReply(
        event,
        failure.replyKind === 'timeout'
          ? formatRefusal('ai_timeout')
          // With a ledger entry the reclaim drain WILL answer this turn — say so instead of
          // inviting a resend that would double-answer. No entry ⇒ the legacy resend copy.
          : failure.replyKind === 'rate_limited' ? (ledgerTurnId ? BUSY_FOLLOW_UP_REPLY : RATE_LIMIT_REPLY) : ERROR_REPLY,
      );
      await this.updateEventLog(event.webhookEventId, failure.status, failure.errorCode, companyId);
      // The turn entry stays unacked on purpose: the reclaim worker retries it later and
      // pushes the answer, so a gateway outage cannot silently lose the request.
      return;
    }

    // 9. Persist the turn + audit FIRST, so a LINE delivery failure can never lose the record.
    if (turnResponse.refusalReason === 'mutation_blocked') {
      await this.audit.log({
        companyId,
        actorUserId: identity.userId,
        action: 'ai.line.mutation_blocked',
        targetType: 'LineWebhookEvent',
        targetId: event.webhookEventId,
        requestId,
        result: 'DENIED',
        riskLevel: 'MEDIUM',
        metadataJson: { intent: turnResponse.intent },
      });
    }
    const expenseDraftInterruption = await interruptExpenseDraft();
    const resumeCapsules = [substituteInterruption?.resumeCapsule, mediaResumeCapsule, expenseDraftInterruption].filter((item): item is string => !!item);
    if (resumeCapsules.length > 0) {
      const resumeText = resumeCapsules.length === 1
        ? resumeCapsules[0]
        : `↩️ ยังมีงานค้าง ${resumeCapsules.length} งาน กรุณาเลือกงานที่จะทำต่อค่ะ\n${resumeCapsules.map((item, index) => `${index + 1}) ${item.replace(/^↩️\s*/, '')}`).join('\n')}`;
      turnResponse = {
        ...turnResponse,
        replyText: `${turnResponse.replyText}\n\n${resumeText}`,
        presentation: undefined,
      };
    }
    const turnId = await this.timeStage(event.webhookEventId, 'persistence', () => this.persistTurn(
      identity.userId,
      companyId,
      event.webhookEventId,
      turnRequest.messagePreviewHash,
      turnRequest.messageText.slice(0, PREVIEW_MAX_CHARS),
      turnResponse,
    ));
    await this.updateEventLog(event.webhookEventId, 'response_ready', undefined, companyId);

    // 10. Customer-visible completion requires a confirmed LINE reply/push.
    const completionMessage = await this.timeStage(event.webhookEventId, 'render', () => this.withCompletionMenu(
      buildLineBusinessAnswerMessage(turnResponse, formatLineReply(turnResponse, this.config.webBaseUrl), this.config.webBaseUrl, companyId),
      companyId,
      resolvedAccess,
    ));
    const delivery = await this.deliverMessages(event, [completionMessage]);
    this.emitTurnSummary({ webhookEventId: event.webhookEventId, requestId, request: turnRequest, response: turnResponse, delivery });
    if (delivery !== 'ok') {
      await this.prisma.client.aiTurn.update({
        where: { id: turnId },
        data: { status: 'ERROR', errorCode: `LINE_DELIVERY_${delivery.toUpperCase()}` },
      });
      // deliverMessages already performed the single received/response_ready → delivery_pending CAS.
      // Keep the turn and any waiting clarification open in Redis for push retry.
      return;
    }

    await this.prisma.client.aiTurn.update({
      where: { id: turnId },
      data: {
        status: turnResponse.refused ? 'REFUSED' : 'COMPLETED',
        errorCode: turnResponse.errorCode,
      },
    });
    await this.updateEventLog(
      event.webhookEventId,
      terminalStatusForLineTurn(turnResponse),
      turnResponse.errorCode,
      companyId,
    );

    if (substituteInterruption) {
      await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting,
        openWaiting.filter((item) => item.clarifyForIntent === 'SUBSTITUTE_RECEIPT_CONTINUATION').map((item) => item.id),
        'business_answer');
      if (substituteInterruption.pendingQuestion) {
        await this.ledger?.appendSubRequests({
          companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
          userId: identity.userId,
          items: [{
            text: 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ', state: 'waiting_user',
            clarifyQuestion: substituteInterruption.pendingQuestion, intent: 'CLARIFY',
            clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION',
          }],
        });
      }
    }

    // 10.5 Acknowledge work only after delivery. Clarifications and uncovered
    // sub-requests are now safe to advance because the employee saw this turn.
    if (this.ledger) {
      const subRequests = this.ledger.coverageToSubRequests(turnResponse.coverage);
      if (subRequests.length > 0) {
        await this.ledger.appendSubRequests({
          companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
          userId: identity.userId, items: subRequests,
        });
      }
      // Only the entries this turn actually answered — a blanket sweep silently closed
      // questions the user never replied to, and in a group chat other members' questions too.
      await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting, routePlan.resolvedClarificationIds, 'business_answer');
      if (ledgerTurnId) {
        await this.ledger.ack(
          { key: ledgerKey(companyId, chatKey), id: ledgerTurnId, companyId, turnId: requestId, kind: 'turn' },
          'acked',
          { refused: turnResponse.refused },
        );
      }
    }
  }

  private async listLineCompanies(userId: string): Promise<LineCompanyMembership[]> {
    return this.prisma.client.companyMembership.findMany({
      where: { userId, status: 'ACTIVE', company: { status: 'ACTIVE' } },
      select: {
        companyId: true,
        company: { select: { name: true, brandName: true } },
        roles: { select: { role: { select: { key: true, name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    }) as Promise<LineCompanyMembership[]>;
  }

  private async pendingCompanySelectionCommand(event: LineTextEvent): Promise<LineCompanyCommand | null> {
    const candidate = parseBareCompanySelection(event.messageText);
    if (!candidate) return null;
    const previous = await this.prisma.client.lineWebhookEventLog.findFirst({
      where: {
        webhookEventId: { not: event.webhookEventId },
        lineUserIdHash: hashMessagePreview(event.lineUserId),
        createdAt: { gte: new Date(Date.now() - LINE_AI_CONTEXT_WINDOW_MINUTES * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    return previous && COMPANY_SELECTION_PENDING_STATUSES.has(previous.status) ? candidate : null;
  }

  private async handleCompanyCommand(event: LineTextEvent, requestId: string, userId: string, displayName: string, command: LineCompanyCommand): Promise<void> {
    const memberships = await this.listLineCompanies(userId);
    if (memberships.length === 0) {
      await this.deliverReply(event, UNLINKED_REPLY);
      await this.updateEventLog(event.webhookEventId, 'no_membership', LINE_AI_ERROR_CODES.UNLINKED_USER);
      return;
    }

    const current = await this.prisma.client.lineCompanyContext.findUnique({
      where: { lineUserId: event.lineUserId },
      select: { companyId: true },
    });

    if (command.kind === 'list') {
      const currentCompanyId = memberships.length === 1 ? memberships[0]!.companyId : current?.companyId;
      const currentMembership = memberships.find((membership) => membership.companyId === currentCompanyId);
      if (!currentMembership) {
        await this.deliverRequiredMessages(event, [buildCompanyPickerMessage(
          memberships.map((membership) => ({ companyId: membership.companyId, companyName: companyLabel(membership) })),
          undefined,
          command.page,
        )]);
        await this.updateEventLog(event.webhookEventId, 'needs_company_selection', LINE_AI_ERROR_CODES.AMBIGUOUS_COMPANY);
        return;
      }
      const messages: LineReplyMessage[] = [buildCompanyContextMessage({
        companyName: companyLabel(currentMembership),
        displayName,
        roleLabels: companyRoleLabels(currentMembership),
      })];
      if (memberships.length > 1) {
        messages.push(buildCompanyPickerMessage(
          memberships.map((membership) => ({ companyId: membership.companyId, companyName: companyLabel(membership) })),
          currentMembership.companyId,
          command.page,
        ));
      }
      await this.deliverRequiredMessages(event, messages);
      await this.updateEventLog(event.webhookEventId, 'company_context_listed', undefined, currentMembership.companyId);
      return;
    }

    // `findCompanySelection` only ever returns one of this user's own ACTIVE memberships, so an
    // index or companyId that is not theirs falls through to the picker below.
    const selected = findCompanySelection(memberships, command.value);
    if (!selected) {
      await this.deliverRequiredMessages(event, [buildCompanyPickerMessage(
        memberships.map((membership) => ({ companyId: membership.companyId, companyName: companyLabel(membership) })),
        current?.companyId,
      )]);
      await this.updateEventLog(event.webhookEventId, 'company_context_selection_invalid', LINE_AI_ERROR_CODES.AMBIGUOUS_COMPANY, current?.companyId);
      return;
    }

    await this.prisma.client.lineCompanyContext.upsert({
      where: { lineUserId: event.lineUserId },
      create: { lineUserId: event.lineUserId, companyId: selected.companyId, selectedAt: new Date() },
      update: { companyId: selected.companyId, selectedAt: new Date() },
    });
    await this.audit.log({
      companyId: selected.companyId,
      actorUserId: userId,
      action: 'ai.line.company_context.switch',
      targetType: 'LineCompanyContext',
      requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: { lineUserId: '[REDACTED]' },
    });
    await this.deliverReply(event, `🏢 เปลี่ยนบริษัทเป็น ${companyLabel(selected)} แล้ว`);
    await this.updateEventLog(event.webhookEventId, 'company_context_switched', undefined, selected.companyId);
  }

  /** Intake-routed turns (evidence capture, signature request, clarify, media mutation refusal)
   *  are remembered for multi-turn follow-ups. Drafts/requests only — never a final mutation.
   *  Best-effort: memory persistence must never break an already-sent intake reply.
   *
   *  The two writes are wrapped in the `persistence` stage so an intake turn (greeting, reimbursement,
   *  clarify, capture) reports the database time it actually spent — before this, only the full AI-turn
   *  path emitted `persistence` and every intake turn looked as if it persisted nothing. Timing only:
   *  this is still best-effort memory, NOT the durable intake replay the spec asks for. */
  private async persistIntakeTurn(input: {
    userId: string;
    companyId: string;
    webhookEventId: string;
    userMessagePreview: string;
    replyText: string;
    intent: 'READ_SUMMARY' | 'EVIDENCE_CAPTURE' | 'SIGNATURE_REQUEST' | 'CLARIFY' | 'MUTATION_REQUEST' | 'CORRECTION' | 'UNKNOWN';
    refused?: boolean;
  }): Promise<void> {
    try {
      await this.timeStage(input.webhookEventId, 'persistence', async () => {
        const conversationId = `line-${input.companyId}-${input.userId}`;
        await this.prisma.client.aiConversation.upsert({
          where: { id: conversationId },
          create: { id: conversationId, companyId: input.companyId, userId: input.userId, channel: 'line' },
          update: {},
        });
        await this.prisma.client.aiTurn.create({
          data: {
            conversationId,
            companyId: input.companyId,
            userId: input.userId,
            webhookEventId: input.webhookEventId,
            userMessagePreview: input.userMessagePreview.slice(0, PREVIEW_MAX_CHARS),
            messagePreviewHash: hashMessagePreview(input.userMessagePreview || input.webhookEventId),
            status: input.refused ? 'REFUSED' : 'COMPLETED',
            intent: input.intent,
            agent: 'intake',
            refused: input.refused ?? false,
            replyPreview: input.replyText.slice(0, PREVIEW_MAX_CHARS),
          },
        });
      });
    } catch (err) {
      this.logger.warn({ msg: 'Intake turn memory persist failed', webhookEventId: input.webhookEventId, error: (err as Error).message });
    }
  }

  private async persistTurn(
    userId: string,
    companyId: string,
    webhookEventId: string,
    messagePreviewHash: string,
    userMessagePreview: string,
    response: LineAiTurnResponse,
  ): Promise<string> {
    const conv = await this.prisma.client.aiConversation.upsert({
      where: { id: `line-${companyId}-${userId}` },
      create: { id: `line-${companyId}-${userId}`, companyId, userId, channel: 'line' },
      update: {},
    });
    const turn = await this.prisma.client.aiTurn.create({
      data: {
        conversationId: conv.id,
        companyId,
        userId,
        webhookEventId,
        userMessagePreview,
        messagePreviewHash,
        status: 'PROCESSING',
        intent: toAiTurnIntent(response.intent, response.refusalReason) as any,
        agent: response.agent,
        refused: response.refused,
        refusalReason: response.refusalReason,
        replyPreview: response.replyText.slice(0, PREVIEW_MAX_CHARS),
        sourceRefsJson: response.sourceRefs as any,
        durationMs: response.durationMs,
          errorCode: response.errorCode,
          modelProvider: response.modelLineage?.[0]?.provider,
          modelId: response.modelLineage?.[0]?.modelId,
          modelRegion: response.modelLineage?.[0]?.region,
          modelPurpose: response.modelLineage?.[0]?.purpose,
          modelLineageJson: response.modelLineage as any,
          observabilityJson: {
            ...(response.runtimeIdentity ? { runtimeIdentity: response.runtimeIdentity } : {}),
            ...(response.expectedRuntimeIdentity ? { expectedRuntimeIdentity: response.expectedRuntimeIdentity } : {}),
            ...(response.runtimeBinding ? { runtimeBinding: response.runtimeBinding } : {}),
            ...(response.stageDurationsMs ? { stageDurationsMs: response.stageDurationsMs } : {}),
            ...(response.modelCallCount !== undefined ? { modelCallCount: response.modelCallCount } : {}),
          } as any,
        },
    });
    // M-02 G4: real per-tool status/duration/errorCode when the gateway measured them; older
    // AgentCore artifacts send only `toolsInvoked`, so keep deriving those from the turn.
    const outcomes: Array<{ toolName: string; status: string; durationMs: number; errorCode: string | null }> =
      response.toolCalls && response.toolCalls.length > 0
        ? response.toolCalls.map((call) => ({
            toolName: call.name,
            status: call.status,
            durationMs: call.durationMs,
            errorCode: call.errorCode ?? null,
          }))
        : response.toolsInvoked.map((toolName) => ({
            toolName,
            status: response.errorCode ? 'error' : 'ok',
            durationMs: response.durationMs,
            errorCode: response.errorCode ?? null,
          }));
    if (outcomes.length > 0) {
      await this.prisma.client.aiToolInvocation.createMany({
        data: outcomes.map((outcome) => {
          const meta = LINE_TOOL_REGISTRY.find((tool) => tool.name === outcome.toolName);
          return {
            ...outcome,
            turnId: turn.id,
            companyId,
            userId,
            toolCategory: meta?.category ?? 'read_summary',
            inputHash: messagePreviewHash,
            sourceRefsJson: response.sourceRefs.filter((source) => source.module === meta?.sourceModule) as any,
          };
        }),
      });
    }
    return turn.id;
  }

  /**
   * Phase-0 end-to-end trace: emit ONE distinct `line.ai.stage` duration for a seam this API process
   * actually observes (intake route, gateway turn, capture execute, render, persistence, LINE
   * delivery). These are the precise downstream durations; the buffer's `line.ai.api_trace` carries
   * only ingress/buffer/queue and no lumped dispatch. Correlated by webhookEventId, no raw message
   * text or LINE user id; guarded so telemetry can never change the turn. Runtime-owned
   * `stageDurationsMs` stay separate on the response.
   *
   * Spec §11.1 asks for a `reimbursement_execute` stage too. It is deliberately NOT in this union:
   * this release creates no reimbursement — the payer question, the clarify-only acknowledgement and
   * the web handoff are canonical server copy with no use case or mutation behind them — so emitting
   * one would report a duration for work that never ran. It arrives with the execution it measures.
   * `capture_execute` wraps only the real `CaptureLineExpenseNoteUseCase.execute`; `render` wraps only
   * trusted message construction (never the network send, which stays `line_delivery`) and fires once
   * per delivered reply.
   */
  private async timeStage<T>(webhookEventId: string, stage: 'intake_route' | 'gateway_turn' | 'capture_execute' | 'render' | 'persistence' | 'line_delivery', fn: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      return await fn();
    } finally {
      try {
        this.logger.log({ msg: 'line.ai.stage', surface: 'employee_oa', webhookEventId, stage, durationMs: Date.now() - startedAt });
      } catch { /* telemetry cannot change the outcome it observes */ }
    }
  }

  /**
   * Phase-0 correlated turn summary after response/delivery. Every field is the ACTUAL observed value
   * or an explicit `null` — nothing invented: prepared-plan version is the forwarded request's (Phase 2,
   * usually null); `lane` is null NOT because lanes are unimplemented (the prepared simple-read lane is
   * live behind LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES) but because the gateway RESPONSE does not carry
   * which internal lane (prepared simple-read vs full agentic) served the turn — that is observable only
   * in the gateway's own `line.ai.prepared_simple_read.*` logs, so the API summary cannot truthfully
   * populate it here; model provider and ids are derived from the response's `modelLineage` and usage
   * entries; usage token totals appear only when the gateway reported them; cost is null (metered
   * elsewhere in recordCompanyAiUsage, not on the response). `fallbackReason` is a DISTINCT field and is
   * always null here for the SAME reason — a prepared-plan → full-agentic downgrade is not exposed on the
   * response, and it is deliberately NOT conflated with `refused`/`refusalReason`/`errorCode`.
   */
  private emitTurnSummary(input: {
    webhookEventId: string;
    requestId: string;
    request: LineAiTurnRequest;
    response: LineAiTurnResponse;
    delivery: LineDeliveryResult;
  }): void {
    try {
      const { response } = input;
      const usage = Array.isArray(response.usage) ? response.usage : undefined;
      const usageSum = (key: 'inputTokens' | 'outputTokens'): number | null =>
        usage ? usage.reduce((total, entry) => total + (typeof entry[key] === 'number' ? entry[key] : 0), 0) : null;
      const lineage = Array.isArray(response.modelLineage) ? response.modelLineage : undefined;
      const modelIdSet = new Set<string>();
      for (const entry of lineage ?? []) if (entry?.modelId) modelIdSet.add(entry.modelId);
      for (const entry of usage ?? []) if (entry?.modelId) modelIdSet.add(entry.modelId);
      const modelIds = modelIdSet.size > 0 ? [...modelIdSet] : null;
      const modelProvider = lineage?.[0]?.provider ?? null;
      this.logger.log({
        msg: 'line.ai.turn_summary',
        surface: 'employee_oa',
        webhookEventId: input.webhookEventId,
        requestId: input.requestId,
        preparedPlanVersion: input.request.preparedPlan?.version ?? null,
        lane: null,
        intent: response.intent,
        refused: response.refused,
        refusalReason: response.refusalReason ?? null,
        errorCode: response.errorCode ?? null,
        fallbackReason: null,
        modelProvider,
        modelIds,
        modelCallCount: response.modelCallCount ?? null,
        toolCallCount: response.toolCalls?.length ?? response.toolsInvoked?.length ?? null,
        deliveryResult: input.delivery,
        usageInputTokens: usageSum('inputTokens'),
        usageOutputTokens: usageSum('outputTokens'),
        costSatang: null,
      });
    } catch { /* telemetry cannot change the outcome it observes */ }
  }

  private async loadConversationContext(companyId: string, userId: string, permissions: string[]): Promise<LineAiConversationContext | undefined> {
    const since = new Date(Date.now() - LINE_AI_CONTEXT_WINDOW_MINUTES * 60 * 1000);
    const rows = await this.prisma.client.aiTurn.findMany({
      where: {
        companyId,
        userId,
        createdAt: { gte: since },
        status: { in: ['COMPLETED', 'REFUSED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: LINE_AI_CONTEXT_MAX_TURNS,
      select: {
        createdAt: true,
        userMessagePreview: true,
        replyPreview: true,
        intent: true,
        agent: true,
        refused: true,
        toolInvocations: { select: { toolName: true } },
      },
    });
    if (rows.length === 0) return undefined;
    const recentTurns = [...rows].reverse().map((row) => {
      const canUseReply = canUseAssistantPreview(row.toolInvocations?.map((tool) => tool.toolName), permissions);
      return {
        at: row.createdAt.toISOString(),
        ...(row.userMessagePreview && { userMessagePreview: row.userMessagePreview }),
        ...(canUseReply && row.replyPreview && { assistantReplyPreview: row.replyPreview }),
        ...(row.intent && { intent: String(row.intent) }),
        ...(row.agent && { agent: row.agent }),
        refused: row.refused,
      };
    });
    return {
      windowMinutes: LINE_AI_CONTEXT_WINDOW_MINUTES,
      maxTurns: LINE_AI_CONTEXT_MAX_TURNS,
      lastTurnAt: recentTurns.at(-1)?.at,
      recentTurns,
    };
  }

  /** `captionText` is the joined text of bubbles buffered together with this
   *  media message (spec §8); it feeds the intake route as the user's words. */
  async executeReceiptUpload(event: LineReceiptUploadEvent, captionText?: string): Promise<LineMediaTurnOutcome> {
    try {
      return (await this.executeReceiptUploadInner(event, captionText)) ?? { outcome: 'done' };
    } catch (err) {
      // Branch ambiguity is a data-setup state, not a transient fault: say what to do instead of
      // the "ชั่วคราว ลองใหม่" copy that retries into the identical failure (Owner 2026-08-27).
      const response = (err as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
      if (response?.code === 'TRANSACTION_BRANCH_REQUIRED' || response?.code === 'TRANSACTION_BRANCH_INVALID') {
        this.logger.warn({ msg: 'LINE receipt upload needs branch selection', webhookEventId: event.webhookEventId });
        await this.deliverReply(event, RECEIPT_BRANCH_REQUIRED_REPLY).catch(() => {});
        await this.updateEventLog(event.webhookEventId, 'clarification_required', 'RECEIPT_BRANCH_SELECTION_REQUIRED');
        return { outcome: 'done' };
      }
      this.logger.error({ msg: 'LINE receipt upload error', webhookEventId: event.webhookEventId, error: (err as Error).message });
      await this.deliverReply(event, MEDIA_PROCESSING_FAILED_REPLY).catch(() => {});
      await this.releaseWebhookEvent(event.webhookEventId, 'RETRYABLE_RECEIPT_UPLOAD_ERROR');
      return { outcome: 'done' };
    }
  }

  private async executeReceiptUploadInner(event: LineReceiptUploadEvent, captionText?: string): Promise<LineMediaTurnOutcome | undefined> {
    const requestId = randomUUID();
    if (!await this.claimWebhookEvent(event.webhookEventId, event.lineUserId)) return { outcome: 'done' };

    const identity = await this.resolveLineIdentity(event);
    if (!identity || identity.user.status !== 'ACTIVE') {
      await this.deliverReply(event, RECEIPT_LINK_REPLY);
      await this.updateEventLog(event.webhookEventId, 'unlinked', LINE_AI_ERROR_CODES.UNLINKED_USER);
      return;
    }

    // PDPA opt-out gate (M-05 §3.1) — media intake is part of the LINE assistant, so the
    // same refusal applies; web receipt upload (P2, legal-obligation basis) is unaffected.
    if (identity.user.aiAssistantOptOutAt) {
      await this.deliverReply(event, AI_OPT_OUT_REPLY);
      await this.updateEventLog(event.webhookEventId, 'ai_opt_out', LINE_AI_ERROR_CODES.FORBIDDEN);
      return;
    }

    const resolved = event.companyIdAtAcceptance
      ? { companyId: event.companyIdAtAcceptance }
      : await resolveCompanyForLineUser(this.prisma, identity.userId, event.lineUserId);
    if (!resolved || 'needsSelection' in resolved) {
      if (!resolved) {
        await this.deliverReply(event, RECEIPT_LINK_REPLY);
      } else {
        const memberships = await this.listLineCompanies(identity.userId);
        await this.deliverRequiredMessages(event, [buildCompanyPickerMessage(
          memberships.map((membership) => ({ companyId: membership.companyId, companyName: companyLabel(membership) })),
        )]);
      }
      await this.updateEventLog(event.webhookEventId, !resolved ? 'unlinked' : 'needs_company_selection', LINE_AI_ERROR_CODES.UNLINKED_USER);
      return;
    }
    const companyId = resolved.companyId;

    let access: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>;
    try {
      access = await this.permissionResolver.resolveAccess(identity.userId, companyId);
    } catch {
      await this.deliverReply(event, RECEIPT_LINK_REPLY);
      await this.updateEventLog(event.webhookEventId, 'no_membership', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
      return;
    }

    // P12-3b: same rule as the text lane — the recipient is bound only once the resolver has
    // confirmed this user's access to this company. Refusals above keep today's plain links.
    event.handoff = { userId: identity.userId, companyId };

    // Refuse before downloading bytes, invoking intake/OCR, or creating any attachment/expense.
    if (await this.refusePendingLegalAcceptance(
      event, identity.userId, companyId, access.membershipId,
    )) return;

    await this.recordShadowTurn(companyId);
    if (await this.refuseWhenLaunchRouteClosed(event, identity.userId, companyId, requestId)) return;
    if (await lineAssistantDisabled(this.prisma, companyId)) {
      await this.deliverReply(event, formatRefusal('feature_disabled'));
      await this.audit.log({ companyId, actorUserId: identity.userId, action: 'ai.line.query.denied', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'LOW', metadataJson: { reason: 'feature_disabled' } });
      await this.updateEventLog(event.webhookEventId, 'feature_disabled', LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE, companyId);
      return;
    }

    const canCaptureExpense = access.permissions.includes('expense.receipt.line_upload') || access.permissions.includes('expense.receipt.upload');
    const canSubmitSignature = maySubmitSignature(access.permissions);
    if (!canCaptureExpense && !canSubmitSignature) {
      await this.deliverReply(event, receiptDeniedReply(access));
      await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.reject', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'MEDIUM', metadataJson: { reason: 'missing_expense_receipt_line_upload' } });
      await this.updateEventLog(event.webhookEventId,
        receiptFeatureDisabled(access) ? 'feature_disabled' : 'forbidden',
        receiptFeatureDisabled(access) ? LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE : LINE_AI_ERROR_CODES.FORBIDDEN,
        companyId);
      return;
    }
    if (!this.initReceiptUpload || !this.completeReceiptUpload) {
      await this.deliverReply(event, ERROR_REPLY);
      await this.updateEventLog(event.webhookEventId, 'expense_module_unavailable', 'EXPENSE_MODULE_UNAVAILABLE', companyId);
      return;
    }

    const media = await this.downloadLineMedia(event.lineMessageId, event.messageType, event.fileName, event.fileSize);
    if (!media) {
      await this.deliverReply(event, MEDIA_DOWNLOAD_FAILED_REPLY);
      await this.releaseWebhookEvent(event.webhookEventId, 'RETRYABLE_LINE_MEDIA_DOWNLOAD_FAILED', companyId);
      return;
    }
    const mediaRejectionReason = await this.lineMediaRejectionReason(media);
    if (mediaRejectionReason) {
      await this.deliverReply(event, MEDIA_SECURITY_REJECTED_REPLY);
      await this.audit.log({
        companyId,
        actorUserId: identity.userId,
        action: 'attachment.upload.rejected',
        targetType: 'LineWebhookEvent',
        targetId: event.webhookEventId,
        requestId,
        result: 'DENIED',
        riskLevel: 'HIGH',
        metadataJson: {
          source: 'LINE_AI',
          reason: mediaRejectionReason,
          mimeType: media.mimeType,
          byteSize: media.byteSize,
        },
      });
      emitSecurityEvent(this.logger, SECURITY_EVENT.attachmentUploadRejected, 'HIGH', {
        companyId,
        source: 'LINE_AI',
        reason: mediaRejectionReason,
        requestId,
      });
      await this.updateEventLog(event.webhookEventId, 'media_security_rejected', 'LINE_MEDIA_SECURITY_REJECTED', companyId);
      return;
    }

    const ctx: RequestContext = {
      requestId,
      authSubject: identity.userId,
      userId: identity.userId,
      companyId,
      membershipId: access.membershipId,
      roles: access.roles,
      permissions: access.permissions,
      scopes: access.scopes,
      authProvider: 'line' as const,
    };

    // LINE Intake Router: semantic classification of the media message
    // (expense evidence vs signature vs other) before any record is created.
    const conversationContext = access.permissions.includes('line.ai.query')
      ? await this.loadConversationContext(companyId, identity.userId, access.permissions)
      : undefined;
    const caption = captionText?.trim() ?? '';
    const captionSuffix = caption ? ` ${caption}` : '';
    const expenseDraftConversationEnabled = this.config.lineExpenseDraftConversationEnabled === true
      && (!event.pushTargetId || event.pushTargetId === event.lineUserId)
      && Boolean(this.expenseDraftConversation);
    const captionCandidates = computeValueCandidates(normalizeLineText(caption));
    const routePlan = await this.tryRouteIntake({
      requestId,
      companyId,
      userId: identity.userId,
      permissions: access.permissions,
      messageText: caption,
      attachment: { id: event.lineMessageId, mimeType: media.mimeType, contentBase64: media.contentBase64 },
      conversationContext,
      ...(captionCandidates && { valueCandidates: captionCandidates }),
      // A media turn queued behind another in-flight turn waits for the admission lease the same
      // way a text turn does, instead of failing the upload with a busy error.
      busyWaitDeadlineMs: Date.now() + LINE_AI_LIVE_BUSY_WAIT_MS,
    });

    // F8: a signature photo filed on ANY route should steer the sender back to “ตอบ 1” exactly when a
    // substitute workflow in this chat is parked at the issue decision — not only on the numbered
    // route. Computed lazily at each signature site so non-signature uploads pay for no extra query.
    const pendingIssueDecisionSteer = () => this.substituteReceiptContinuation
      ? this.substituteReceiptContinuation.hasPendingIssueDecision(ctx, chatKeyHashOf(event))
      : Promise.resolve(false);

    if (routePlan.status === 'ROUTED' && routePlan.intent === 'SIGNATURE_UPLOAD_TICKET') {
      if (!canSubmitSignature) {
        await this.deliverReply(event, SIGNATURE_FORBIDDEN_REPLY);
        await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.reject', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'MEDIUM', metadataJson: { reason: 'missing_signature_owner_permission', route: 'signature' } });
        await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
        return;
      }
      if (event.messageType !== 'image' || !this.initSignatureUpload || !this.createSignatureAsset) {
        await this.deliverReply(event, SIGNATURE_NEED_IMAGE_REPLY);
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      const ticketReply = await this.createLineSignatureAsset({ ctx, event, companyId, media, steerToPendingDecision: await pendingIssueDecisionSteer() });
      await this.deliverCompletedReply(event, ticketReply, companyId, access);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: `[ผู้ใช้ส่งรูปลายเซ็น]${captionSuffix}`, replyText: ticketReply, intent: 'SIGNATURE_REQUEST',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    // A4: a signature photo must still reach the library when the router cannot answer. It is one
    // AI call away from UNAVAILABLE, and a degraded turn used to send the crop down expense capture
    // (or, with substitute work open, one “ใช่” away from being a certificate's wet-signed original).
    //
    // ONLY when nothing was routed, the same guard the substitute branch below uses. `ลายเซ็น` is a
    // substring test, and a real routed receipt says things like “ค่าทำป้ายลายเซ็น 500 บาท”: reading
    // that as intent would file the receipt as the newest signature for legal documents AND lose the
    // expense. A reachable router that looked at both the caption and the picture outranks a regex.
    if (routePlan.status !== 'ROUTED'
      && canSubmitSignature && event.messageType === 'image' && isSignatureCaptionText(caption)
      && this.initSignatureUpload && this.createSignatureAsset) {
      const ticketReply = await this.createLineSignatureAsset({ ctx, event, companyId, media, steerToPendingDecision: await pendingIssueDecisionSteer() });
      await this.deliverCompletedReply(event, ticketReply, companyId, access);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: `[ผู้ใช้ส่งรูปลายเซ็น]${captionSuffix}`, replyText: ticketReply, intent: 'SIGNATURE_REQUEST',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    if (routePlan.status === 'ROUTED' && routePlan.intent === 'CLARIFY') {
      const clarifyReply = routePlan.clarifyQuestion ?? CLARIFY_REPLY;
      // A4: this branch asked a question about a photo and then threw the photo away. Whatever the
      // customer answered — “ใบเสร็จ”, “ลายเซ็น”, “หลักฐานการจ่าย” — there were no bytes left to act
      // on. Park them on the same pending row every other clarify uses; the reply is unchanged, and
      // a failure to park must not swallow the question the customer is waiting for.
      let parked: Awaited<ReturnType<ProcessLineWebhookUseCase['ensurePendingMedia']>> | undefined;
      if (canCaptureExpense) {
        try {
          parked = await this.ensurePendingMedia(
            ctx, event, companyId, identity.userId, caption, media, receiptClarifyQuestion(event),
          );
        } catch (error) {
          this.logger.warn({ msg: 'line_clarify_pending_media_failed', requestId, error: (error as Error).message });
        }
      }
      await this.deliverReply(event, clarifyReply);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: `${parked?.pending ? mediaPreviewLabel(parked.pending) : '[ผู้ใช้ส่งรูป/ไฟล์]'}${captionSuffix}`,
        replyText: clarifyReply, intent: 'CLARIFY',
      });
      if (parked?.created && parked.pending) {
        await this.appendMediaClarification({
          companyId, chatKey: mediaChatKey(event), requestId, webhookEventId: event.webhookEventId,
          userId: identity.userId, caption, question: clarifyReply, pending: parked.pending,
        });
      }
      await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
      return;
    }

    if (routePlan.status === 'ROUTED' && routePlan.intent === 'MUTATION_REQUEST_REFUSAL') {
      await this.deliverCompletedReply(event, MUTATION_REFUSAL_REPLY, companyId, access);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: `[ผู้ใช้ส่งรูป/ไฟล์]${captionSuffix}`, replyText: MUTATION_REFUSAL_REPLY, intent: 'MUTATION_REQUEST', refused: true,
      });
      await this.updateEventLog(event.webhookEventId, 'forbidden', undefined, companyId);
      return;
    }

    if (routePlan.status === 'ROUTED' && (routePlan.intent === 'BUSINESS_READ_QUESTION' || routePlan.intent === 'UNSUPPORTED')) {
      // RECEIPT-05 (owner decision 2026-07-12): a business-question caption on media no longer
      // discards the image. Persist the bytes + a PENDING clarify row and ask ONE question; the
      // customer's next text reply decides receipt vs illustration (no auto-draft, no guessing here).
      if (caption && canCaptureExpense) {
        // Only the delivery that CREATES the pending row asks the clarify question. A redelivery
        // (new webhookEventId, same lineMessageId) reuses the row and stays silent — idempotent.
        const { created, pending } = await this.ensurePendingMedia(
          ctx, event, companyId, identity.userId, caption, media, receiptClarifyQuestion(event),
        );
        if (created) {
          await this.deliverReply(event, MEDIA_CLARIFY_REPLY);
          await this.persistIntakeTurn({
            userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
            userMessagePreview: `${mediaPreviewLabel(pending)}${captionSuffix}`, replyText: MEDIA_CLARIFY_REPLY, intent: 'CLARIFY',
          });
          if (pending) {
            await this.appendMediaClarification({
              companyId, chatKey: mediaChatKey(event), requestId, webhookEventId: event.webhookEventId,
              userId: identity.userId, caption, question: MEDIA_CLARIFY_REPLY, pending,
            });
          }
        }
        await this.updateEventLog(
          event.webhookEventId,
          created ? 'clarification_required' : 'duplicate_media_pending',
          undefined,
          companyId,
        );
        return { outcome: 'done' };
      }
      await this.deliverCompletedReply(event, MEDIA_UNSUPPORTED_REPLY, companyId, access);
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    // R14/§11: this chat has open substitute work, so the photo is classified against THAT work
    // instead of being read as a new expense. Deterministic signals only — the caption first, then
    // awaiting-scan state, never the picture — and anything still ambiguous keeps the bytes pending
    // behind one numbered question.
    //
    // It owns exactly one route: the generic capture/fallthrough. Signature tickets, clarifies,
    // mutation refusals, business questions and reference documents were all answered above and
    // keep their behaviour — a substitute continuation must not swallow the reply a different
    // intent already earned.
    if (this.substituteReceiptContinuation && canCaptureExpense
      && access.permissions.includes('expense.receipt.upload')
      && (routePlan.status !== 'ROUTED' || routePlan.intent === 'EXPENSE_DOCUMENT_CAPTURE')) {
      try {
        const context = await this.substituteReceiptContinuation.loadOpenMediaContext(ctx, chatKeyHashOf(event));
        const outcome = context
          ? await this.handleSubstituteMediaArrival({
            event, ctx, access, companyId, userId: identity.userId, requestId, caption, captionSuffix, media, context,
          })
          : undefined;
        if (outcome) return outcome;
      } catch (error) {
        // Never let this branch sink a media turn: without it the photo is still capturable below.
        this.logger.warn({ msg: 'line_substitute_media_arrival_failed', requestId, error: (error as Error).message });
      }
    }

    // Reference-only routes may receive bounded guidance without expense permission, but must
    // never read an existing expense. Every possible capture/fallback branch is denied here.
    const isReferenceOnlyRoute = routePlan.status === 'ROUTED' && routePlan.intent === 'BUSINESS_DOCUMENT_REFERENCE';
    if (!canCaptureExpense && !isReferenceOnlyRoute) {
      await this.deliverReply(event, receiptDeniedReply(access));
      await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.reject', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'MEDIUM', metadataJson: { reason: 'missing_expense_receipt_line_upload', route: 'capture' } });
      await this.updateEventLog(event.webhookEventId,
        receiptFeatureDisabled(access) ? 'feature_disabled' : 'forbidden',
        receiptFeatureDisabled(access) ? LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE : LINE_AI_ERROR_CODES.FORBIDDEN,
        companyId);
      return;
    }

    // Redelivery after an accepted decision reuses the one existing expense even if a later
    // provider call is unavailable; never OCR or initialize a second record for the same media.
    const existingExpense = canCaptureExpense
      ? await this.expenseRepo?.findByLineMessageId(companyId, event.lineMessageId)
      : null;
    if (existingExpense) {
      const receiptDraft = expenseDraftConversationEnabled
        ? await this.expenseDraftConversation!.startFromReceipt(ctx, {
          expenseId: existingExpense.id,
          chatKeyHash: chatKeyHashOf(event),
          webhookEventId: event.webhookEventId,
        })
        : undefined;
      const replyTexts = receiptDraft?.replyTexts.length ? receiptDraft.replyTexts : [formatPaypersReply(this.config.webBaseUrl, companyId, existingExpense.id, {
        sourceDocumentType: existingExpense.sourceDocumentType !== 'NEEDS_REVIEW' ? existingExpense.sourceDocumentType : undefined,
        questionText: caption,
      })];
      if (receiptDraft?.replyTexts.length) await this.deliverCompletedReplies(event, replyTexts, companyId, access);
      else await this.deliverCompletedReply(event, replyTexts[0]!, companyId, access);
      await this.recordDeliveredReceiptContinuation(event, companyId, identity.userId, existingExpense.id, access.scopes);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: `[ผู้ใช้ส่งรูป/ไฟล์เอกสารค่าใช้จ่าย]${captionSuffix}`, replyText: replyTexts.join('\n'), intent: 'EVIDENCE_CAPTURE',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    // JPEG/PNG classification runs once, before initReceiptUpload. PDF/unsupported media produces
    // NOT_REQUESTED and therefore fails closed unless a routed expense caption supplies purpose.
    const ocr = await this.tryExtractReceiptFields(
      ctx,
      event.lineMessageId,
      media,
      routePlan.ocrAdmission === 'admitted',
      routePlan.ocrErrorCode,
      // The router already read this exact photo; forwarding that read keeps OCR from reading it
      // a second time (UAT 2026-08-28: a 16.6s duplicate read on every receipt).
      routePlan.documentText,
    );
    const decision = decideLineBusinessDocument(routePlan, ocr, caption.length > 0);
    // Every LINE OCR attempt is recorded here, before the outcome branches. A failed read routes to
    // `clarify` and returns below without ever creating an expense, so auditing further down (as this
    // once did, guarded on OCR_EXTRACTED_NEEDS_REVIEW) recorded successes only and left every
    // unreadable image — the whole "อ่านไม่ออก" signal — absent from the log. Keyed to the webhook
    // event because no expense exists yet; the expense-linked row shares this `requestId`.
    await this.audit.log({
      companyId, actorUserId: identity.userId, action: 'expense.ocr.request', targetType: 'line_webhook_event',
      targetId: event.webhookEventId, requestId,
      result: ocr.status === 'OCR_EXTRACTED_NEEDS_REVIEW' ? 'SUCCESS' : 'FAILED', riskLevel: 'MEDIUM',
      metadataJson: {
        channel: 'line',
        status: ocr.status,
        ...(ocr.errorCode ? { errorCode: ocr.errorCode } : {}),
        documentKind: decision.classification?.documentKind ?? null,
        recognizedFieldCount: ocr.fields ? Object.keys(ocr.fields).length : 0,
        mimeType: media.mimeType,
        byteSize: media.byteSize,
      },
    });
    if (decision.outcome === 'reference' || decision.outcome === 'unsupported') {
      const checkBillAwaitingDecision = decision.outcome === 'reference'
        && decision.classification?.contentKind === 'DOCUMENT'
        && decision.classification.documentKind === 'ORDER_OR_CHECK_BILL'
        && Number.isFinite(Number(ocr.fields?.grandTotalAmount))
        && Number(ocr.fields?.grandTotalAmount) > 0;
      if (checkBillAwaitingDecision && canCaptureExpense && this.substituteReceiptContinuation) {
        const reply = formatCheckBillDecisionReply();
        const { created, pending } = await this.ensurePendingMedia(
          ctx, event, companyId, identity.userId, caption, media,
          {
            kind: 'CHECK_BILL_ACTION', chatKeyHash: chatKeyHashOf(event),
            ...(ocr.fields ? { ocrFields: ocr.fields } : {}),
            ...(decision.classification ? { classification: decision.classification } : {}),
          },
        );
        if (created) {
          await this.deliverReply(event, reply, buildCheckBillDecisionQuickReply());
          await this.persistIntakeTurn({
            userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
            userMessagePreview: `[ผู้ใช้ส่งเช็กบิล]${captionSuffix}`, replyText: reply, intent: 'CLARIFY',
          });
          if (pending) {
            await this.appendMediaClarification({
              companyId, chatKey: mediaChatKey(event), requestId, webhookEventId: event.webhookEventId,
              userId: identity.userId, caption, question: reply, pending,
            });
          }
        }
        await this.updateEventLog(
          event.webhookEventId,
          created ? 'clarification_required' : 'duplicate_media_pending',
          undefined,
          companyId,
        );
        return { outcome: 'done' };
      }
      const reply = decision.outcome === 'reference'
        ? formatBusinessDocumentReply(decision.classification, this.config.webBaseUrl, companyId)
        : MEDIA_UNSUPPORTED_REPLY;
      await this.deliverCompletedReply(event, reply, companyId, access);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: `[ผู้ใช้ส่งรูป/ไฟล์]${captionSuffix}`, replyText: reply, intent: 'CLARIFY',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }
    if (decision.outcome === 'clarify') {
      const reply = decision.persistMedia
        ? formatOcrGovernanceClarifyReply(ocr.errorCode, ocr.status === 'OCR_FAILED')
        : formatBusinessDocumentReply(decision.classification, this.config.webBaseUrl, companyId);
      let terminalStatus = 'clarification_required';
      if (decision.persistMedia && canCaptureExpense) {
        const { created, pending } = await this.ensurePendingMedia(
          ctx, event, companyId, identity.userId, caption, media, receiptClarifyQuestion(event),
        );
        if (created) {
          await this.deliverReply(event, reply);
          await this.persistIntakeTurn({
            userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
            userMessagePreview: `${mediaPreviewLabel(pending)}${captionSuffix}`, replyText: reply, intent: 'CLARIFY',
          });
          if (pending) {
            await this.appendMediaClarification({
              companyId, chatKey: mediaChatKey(event), requestId, webhookEventId: event.webhookEventId,
              userId: identity.userId, caption, question: reply, pending,
            });
          }
        }
        if (!created) terminalStatus = 'duplicate_media_pending';
      } else {
        await this.deliverReply(event, decision.persistMedia ? MEDIA_UNSUPPORTED_REPLY : reply);
      }
      await this.updateEventLog(event.webhookEventId, terminalStatus, undefined, companyId);
      return;
    }
    if (decision.outcome !== 'expense') return;

    // Owner 2026-08-27: never lose a successfully-read receipt to branch ambiguity. LINE has no
    // branch picker, so default the USER'S OWN branch (membership defaultBranchId — "สาขาที่ user
    // นั้นอยู่"), else the single in-scope branch, else the sole head office; the init use case
    // re-validates scope and ACTIVE status, and the review lane keeps the branch editable.
    const [branchCandidates, membership] = await Promise.all([
      this.prisma.client.branch.findMany({
        where: { companyId: ctx.companyId, status: 'ACTIVE', ...(ctx.scopes?.branchIds ? { id: { in: ctx.scopes.branchIds } } : {}) },
        select: { id: true, type: true },
        take: 20,
      }),
      ctx.membershipId
        ? this.prisma.client.companyMembership.findUnique({ where: { id: ctx.membershipId }, select: { defaultBranchId: true } })
        : Promise.resolve(null),
    ]);
    const defaultBranchId = pickLineDefaultBranchId(branchCandidates, membership?.defaultBranchId);
    const intent = await this.initReceiptUpload.execute(ctx, {
      ...(defaultBranchId ? { branchId: defaultBranchId } : {}),
      originalFileName: media.fileName,
      mimeType: media.mimeType,
      byteSize: media.byteSize,
      // A calendar date, not the instant the photo arrived: a full timestamp in a date column
      // made the row invisible to the list's day filter, and the UTC day is yesterday for
      // anyone sending a receipt before 07:00 Bangkok.
      expenseDate: todayCivilDate(),
      note: 'LINE receipt upload',
      captureSource: 'LINE_UPLOAD',
    });
    await this.uploadLineMedia(intent, media);
    const completedExpense = await this.completeReceiptUpload.execute(ctx, {
      expenseId: intent.expenseId,
      attachmentId: intent.attachmentId,
      checksumSha256: media.checksumSha256,
      byteSize: media.byteSize,
    });
    const ocrFields = decision.manualReview ? null : ocr.fields;

    // ponytail: web and LINE share upload and post-OCR duplicate detection.
    let hasDuplicate = completedExpense.duplicateStatus === 'POSSIBLE_DUPLICATE';

    // Route hints are AI suggestions; deterministic guards decide what is stored.
    const hintedDocType = toSourceDocumentType(
      sourceDocumentTypeFromClassification(decision.classification) ?? routePlan.captureHints?.sourceDocumentType,
    );
    const languageHint = routePlan.captureHints?.sourceDocumentLanguage?.trim().slice(0, 20);
    const taxEvidence = deriveTaxEvidence({
      sourceDocumentType: hintedDocType,
      grandTotalAmount: ocrFields?.grandTotalAmount,
      vendorTaxId: ocrFields?.vendorTaxId,
      vendorName: ocrFields?.vendorName,
      documentNumber: ocrFields?.documentNumber,
      lowConfidence: (routePlan.captureHints?.confidence ?? ocrFields?.confidence ?? 1) < 0.5,
    });
    let hintedCategory: { id: string; name: string } | null = null;
    const hintedCategoryId = routePlan.captureHints?.expenseCategoryId;
    if (
      hintedCategoryId
      && (routePlan.captureHints?.confidence ?? 0) >= RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE
      && this.expenseRepo
    ) {
      const active = await this.expenseRepo.listCategories(companyId);
      hintedCategory = active.find((c) => c.id === hintedCategoryId) ?? null;
    }
    let effectiveCategory = hintedCategory;
    let categorySuggestion: ReceiptCategorySuggestion | undefined;
    if (ocrFields) {
      const applyOutcome = await this.receiptOcrApply.apply(ctx, intent.expenseId, ocrFields, {
        ...(hintedCategory
          ? {
              fallbackCategorySuggestion: {
                expenseCategoryId: hintedCategory.id,
                confidence: routePlan.captureHints?.confidence ?? 0,
              },
            }
          : {}),
      });
      // Stale means a correction landed during the OCR round trip; keep the draft as captured.
      const duplicateResult = isStaleOcrApply(applyOutcome) ? null : applyOutcome;
      hasDuplicate ||= (duplicateResult?.candidatesCreated ?? 0) > 0;
      categorySuggestion = duplicateResult?.categorySuggestion;
      effectiveCategory = duplicateResult?.categoryId
        ? {
            id: duplicateResult.categoryId,
            name: duplicateResult.categoryName
              ?? (hintedCategory?.id === duplicateResult.categoryId ? hintedCategory.name : ''),
          }
        : null;
    }
    const missingFields = new Set(ocrFields?.missingFields
      ?? ['vendor', 'expenseDate', 'documentNumber', 'grandTotalAmount', 'vatAmount', 'category']);
    if (effectiveCategory?.id) missingFields.delete('category');
    else missingFields.add('category');

    await this.prisma.client.expenseRecord.update({
      where: { id: intent.expenseId },
      data: {
        captureSource: 'LINE_UPLOAD',
        ...(expenseDraftConversationEnabled ? { status: 'DRAFT' } : {}),
        lineMessageId: event.lineMessageId,
        lineEventId: event.webhookEventId,
        aiVerificationStatus: 'NEEDS_REVIEW',
        // Chat provenance: a later correction may only target records captured in this chat.
        sourceChannelMetadataJson: { channel: 'LINE', kind: 'media', chatKeyHash: chatKeyHashOf(event) },
        sourceDocumentType: hintedDocType,
        ...(languageHint ? { sourceDocumentLanguage: languageHint } : {}),
        taxEvidenceStatus: taxEvidence.taxEvidenceStatus,
        taxEvidenceReasonCode: taxEvidence.taxEvidenceReasonCode,
        ...(effectiveCategory ? { expenseCategoryId: effectiveCategory.id } : {}),
        aiVerificationSummaryJson: {
          status: ocr.status,
          recognizedFields: ocrFields ?? undefined,
          classification: decision.classification ? {
            contentKind: decision.classification.contentKind,
            documentFamily: decision.classification.documentFamily,
            documentKind: decision.classification.documentKind,
            businessDirection: decision.classification.businessDirection,
            transactionState: decision.classification.transactionState,
            missingRequiredSignals: decision.classification.missingRequiredSignals,
            contradictionSignals: decision.classification.contradictionSignals,
            requiresClarification: decision.classification.requiresClarification,
          } : undefined,
          routeHints: routePlan.status === 'ROUTED' ? {
            sourceDocumentType: hintedDocType,
            sourceDocumentLanguage: languageHint ?? undefined,
            expenseCategoryId: hintedCategory?.id,
            confidence: routePlan.captureHints?.confidence,
          } : undefined,
          // Spec S1-R4: same resolved suggestion the web review form reads, so a below-threshold
          // category survives the LINE intake instead of being dropped after apply.
          ...(categorySuggestion ? { categorySuggestion } : {}),
          missingFields: [...missingFields].slice(0, 20),
          duplicateWarning: hasDuplicate,
          nextAction: 'review_in_web',
        },
      },
    });
    await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.receive', targetType: 'expense_record', targetId: intent.expenseId, requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { lineMessageId: '[REDACTED]', mimeType: media.mimeType, byteSize: media.byteSize, sourceDocumentType: hintedDocType } });
    const purposeHint = routePlan.captureHints?.businessPurpose?.trim();
    const groundedPurpose = purposeHint && normalizeLineText(caption).toLocaleLowerCase('th-TH')
      .includes(normalizeLineText(purposeHint).toLocaleLowerCase('th-TH')) ? purposeHint : undefined;
    const draftSuggestedCategoryId = effectiveCategory?.id ?? categorySuggestion?.expenseCategoryId;
    const receiptDraft = expenseDraftConversationEnabled
      ? await this.expenseDraftConversation!.startFromReceipt(ctx, {
        expenseId: intent.expenseId,
        chatKeyHash: chatKeyHashOf(event),
        webhookEventId: event.webhookEventId,
        ocrFields,
        ...(groundedPurpose ? { businessPurpose: groundedPurpose } : {}),
        // Spec S1-R4: below the auto-fill bar nothing was written, so the draft conversation gets
        // the suggestion here — it lands as the item's `suggestedCategoryId`, which the reply asks
        // the user to confirm and never applies on its own.
        ...(draftSuggestedCategoryId ? { suggestedCategoryId: draftSuggestedCategoryId } : {}),
      })
      : undefined;
    const replyTexts = receiptDraft?.replyTexts.length ? receiptDraft.replyTexts : [formatPaypersReply(this.config.webBaseUrl, companyId, intent.expenseId, {
      hasDuplicate,
      fields: ocrFields,
      sourceDocumentType: hintedDocType !== 'NEEDS_REVIEW' ? hintedDocType : undefined,
      categoryName: effectiveCategory?.name || null,
      questionText: caption,
    })];
    if (receiptDraft?.replyTexts.length) {
      await this.deliverCompletedReplies(event, replyTexts, companyId, access,
        expenseDraftCardFacts(intent.expenseId, {
          fields: ocrFields,
          categoryName: effectiveCategory?.name || null,
          ...(groundedPurpose ? { item: groundedPurpose } : {}),
        }));
    } else await this.deliverCompletedReply(event, replyTexts[0]!, companyId, access);
    await this.recordDeliveredReceiptContinuation(event, companyId, identity.userId, intent.expenseId, access.scopes);
    await this.persistIntakeTurn({
      userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: `[ผู้ใช้ส่งรูป/ไฟล์เอกสารค่าใช้จ่าย]${captionSuffix}`, replyText: replyTexts.join('\n'), intent: 'EVIDENCE_CAPTURE',
    });
    await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
  }

  /** RECEIPT-05: idempotent by (companyId, lineMessageId). Returns `created:false` for a
   *  redelivered media event (new webhookEventId, same lineMessageId) so the caller does NOT
   *  re-send the clarify question or persist a second turn (Fix #7). The unique pending row is
   *  CLAIMED before any media bytes are uploaded: a concurrent racer that loses the (companyId,
   *  lineMessageId) unique race skips the byte upload entirely, so it can never leave an orphaned
   *  attachment (Fix #8). ponytail: the loser's reserved (never-completed) upload intent is left
   *  for storage GC — same convention as the capture path's incomplete intents. */
  private async ensurePendingMedia(
    ctx: RequestContext,
    event: LineReceiptUploadEvent,
    companyId: string,
    userId: string,
    caption: string,
    media: { fileName: string; mimeType: string; byteSize: number; checksumSha256?: string; bytes: Buffer },
    /** The question these bytes will be asked about, recorded WITH them so the answer is resolved
     *  against it and never against whatever question the state would ask by the time it arrives. */
    askedQuestion: Record<string, unknown>,
  ): Promise<{ created: boolean; pending?: { id: string; attachmentId: string; mimeType: string; lineMessageId: string; createdAt: Date; askedQuestionJson?: unknown } }> {
    const key = { companyId_lineMessageId: { companyId, lineMessageId: event.lineMessageId } };
    const redelivered = await this.prisma.client.lineIntakePendingMedia.findUnique({ where: key });
    // Redelivery of the SAME message: stay silent, exactly as before.
    if (redelivered) return { created: false, pending: redelivered };
    // A DIFFERENT picture while one question is still open. Before, this opened a second row and
    // asked again — which is what turned an unrecognised answer into an endless loop, storing one
    // more copy of the image every round. Answer the open question about the newest file instead:
    // repoint the existing row at this upload and stay silent.
    const open = await this.prisma.client.lineIntakePendingMedia.findFirst({
      where: { companyId, userId, status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (open) return { created: false, pending: open };
    if (!this.createUploadIntent || !this.completeAttachmentUpload) throw new Error('LINE_ATTACHMENT_MODULE_UNAVAILABLE');
    // Reserve an attachment id (cheap DB intent, no bytes yet), then CLAIM the unique pending row
    // BEFORE transferring bytes. Only the race winner uploads + completes the attachment.
    const intent = await this.createUploadIntent.execute(ctx, {
      originalFileName: media.fileName, mimeType: media.mimeType, byteSize: media.byteSize,
    });
    try {
      await this.prisma.client.lineIntakePendingMedia.create({
        data: {
          companyId, userId, lineMessageId: event.lineMessageId, attachmentId: intent.attachmentId,
          caption, mimeType: media.mimeType, status: 'PENDING', askedQuestionJson: askedQuestion as any,
          expiresAt: new Date(Date.now() + PENDING_MEDIA_TTL_MINUTES * 60 * 1000),
        },
      });
    } catch (err) {
      // Lost the unique race — another delivery already claimed the row. Skip the byte upload so
      // no second copy is stored; the reserved intent stays incomplete for storage GC.
      if ((err as { code?: string }).code === 'P2002') {
        const winner = await this.prisma.client.lineIntakePendingMedia.findUnique({ where: key });
        return { created: false, ...(winner ? { pending: winner } : {}) };
      }
      throw err;
    }
    await this.uploadLineMedia(intent, media);
    await this.completeAttachmentUpload.execute(ctx, {
      attachmentId: intent.attachmentId, checksumSha256: media.checksumSha256, byteSize: media.byteSize,
    });
    const pending = await this.prisma.client.lineIntakePendingMedia.findUnique({ where: key });
    return { created: true, ...(pending ? { pending } : {}) };
  }

  /** Carry the open media question into the ledger so the NEXT turn arrives knowing a file is
   *  already stored — the text path has always done this for its own clarifies, and the media path
   *  not doing it is what left the follow-up answer with no context to attach to. Ledger writes
   *  fail open (§13); LineIntakePendingMedia in Postgres stays the source of truth either way. */
  private async appendMediaClarification(input: {
    companyId: string;
    chatKey: string;
    requestId: string;
    webhookEventId: string;
    userId: string;
    caption: string;
    question: string;
    pending: { id: string; attachmentId: string; mimeType: string };
  }): Promise<void> {
    await this.ledger?.appendSubRequests({
      companyId: input.companyId, chatKey: input.chatKey, turnId: input.requestId,
      webhookEventId: input.webhookEventId, userId: input.userId,
      items: [{
        // The caption is the request the question defers, mirroring the text path. With no caption
        // the file itself is the request, so name it rather than storing an empty ask.
        text: input.caption || MEDIA_PENDING_REQUEST_TEXT,
        state: 'waiting_user',
        clarifyQuestion: input.question,
        intent: 'CLARIFY',
        clarifyForIntent: 'EXPENSE_DOCUMENT_CAPTURE',
        pendingMedia: {
          pendingMediaId: input.pending.id,
          attachmentId: input.pending.attachmentId,
          mimeType: input.pending.mimeType,
        },
      }],
    });
  }

  /** Close the ledger copy of a media question once its Postgres row is resolved, so the next turn
   *  does not carry a question the customer has already answered. Best-effort by design: the ledger
   *  is a carrier, `LineIntakePendingMedia` is the source of truth, and Redis fails open (§13). */
  private async ackMediaClarification(
    companyId: string,
    event: Pick<LineTextEvent, 'lineUserId' | 'pushTargetId'>,
    userId: string,
    pendingMediaId: string,
    outcome: 'acked' | 'followed_up',
  ): Promise<void> {
    if (!this.ledger) return;
    try {
      const chatKey = event.pushTargetId ?? event.lineUserId;
      const open = await this.ledger.openWaitingUser(companyId, chatKey, userId);
      for (const clarification of open) {
        if (clarification.pendingMedia?.pendingMediaId !== pendingMediaId) continue;
        await this.ledger.ack(clarification.entry, outcome, { pendingMediaId });
      }
    } catch (err) {
      // Includes ConsumptionMarkerUnavailableError: failing to tidy up must never sink a reply the
      // customer is waiting for. A stale entry expires on its own via the reclaim path.
      this.logger.warn({ msg: 'line_ai_media_clarify_ack_failed', pendingMediaId, error: (err as Error).message });
    }
  }

  /**
   * A3/A4: the one way a LINE photo becomes a signature asset, shared by every route that can
   * decide it is one — the router's ticket, an explicit ลายเซ็น caption while the router is
   * degraded, and the numbered answer to the substitute media question. `attachmentId` names bytes
   * that are already stored and completed (the pending-media row); without it the media is uploaded
   * here. Everything downstream — de-duplication on `lineMessageId`, the activation, the background
   * removal and the size fix — lives in `CreateSignatureAssetUseCase`, once.
   */
  private async createLineSignatureAsset(input: {
    ctx: RequestContext;
    event: Pick<LineReceiptUploadEvent, 'lineMessageId'>;
    companyId: string;
    /** Omitted only when `attachmentId` names bytes that are already stored. */
    media?: { fileName: string; mimeType: string; byteSize: number; checksumSha256?: string; bytes: Buffer };
    attachmentId?: string;
    /** Only the substitute media answer sets this: that chat has an issue decision waiting. */
    steerToPendingDecision?: boolean;
  }): Promise<string> {
    let attachmentId = input.attachmentId;
    if (!attachmentId) {
      const uploadIntent = await this.initSignatureUpload!.execute(input.ctx, {
        originalFileName: input.media!.fileName,
        mimeType: input.media!.mimeType,
        byteSize: input.media!.byteSize,
      });
      await this.uploadLineMedia(uploadIntent, input.media!);
      attachmentId = uploadIntent.attachmentId;
    }
    const asset = await this.createSignatureAsset!.execute(input.ctx, {
      attachmentId,
      checksumSha256: input.media?.checksumSha256,
      byteSize: input.media?.byteSize,
      submittedFromChannel: 'LINE',
      lineMessageId: input.event.lineMessageId,
      ...(input.attachmentId ? { attachmentAlreadyActive: true } : {}),
    });
    return formatSignatureTicketReply(this.config.webBaseUrl, input.companyId, asset.id, input.steerToPendingDecision);
  }

  /** §11 arrival half. The bytes are held by the SAME pending-media row the receipt clarify uses,
   *  which is what makes this idempotent on redelivery and what keeps a second photo from opening a
   *  second question — and the question they are waiting on is recorded WITH them, so the answer can
   *  never be read off a different list. `undefined` hands the turn back to the existing branches
   *  unchanged: a signature caption, an already-captured photo, or a pending slot owned by another
   *  question. */
  private async handleSubstituteMediaArrival(input: {
    event: LineReceiptUploadEvent;
    ctx: RequestContext;
    access: { membershipId: string; roles: string[]; permissions: string[]; entitlementDeniedPermissions?: Record<string, string>; scopes: { branchIds?: string[] } };
    companyId: string;
    userId: string;
    requestId: string;
    caption: string;
    captionSuffix: string;
    media: { fileName: string; mimeType: string; byteSize: number; checksumSha256?: string; bytes: Buffer };
    context: LineSubstituteMediaContext;
  }): Promise<LineMediaTurnOutcome | undefined> {
    const { event, ctx, companyId, context } = input;
    const chatKeyHash = chatKeyHashOf(event);
    const classified = classifySubstituteMedia(input.caption, context.awaitingScans.length > 0);
    // A signature belongs to the signature library, not inside a certificate. The router's ticket
    // and the A4 caption route above claim the turns they can; what still reaches here with a
    // signature caption is a sender who may not keep a signature at all, or a routed capture whose
    // caption merely mentions ลายเซ็น. Either way it must not become the D9 confirm, where one
    // “ใช่” would file it as a legal document's wet-signed original.
    if (classified === 'SIGNATURE') return undefined;
    // These bytes already became an expense on an earlier delivery — the substitute context opened
    // afterwards. Redelivery reuses that one record below; it must not also store a second copy here.
    if (await this.expenseRepo?.findByLineMessageId(companyId, event.lineMessageId)) return undefined;
    const scan = context.awaitingScans[0];
    const choices = substituteMediaChoices(context);
    const question: LineSubstituteMediaQuestion | undefined = classified === 'AWAITING_SCAN_CONFIRM' && scan
      ? { kind: 'SUBSTITUTE_SCAN_CONFIRM', chatKeyHash, evidenceId: scan.evidenceId }
      : classified === 'ASK'
        ? { kind: 'SUBSTITUTE_MEDIA_CLASS', chatKeyHash, choices }
        : undefined;
    const { created, pending } = await this.ensurePendingMedia(
      ctx, event, companyId, input.userId, input.caption, input.media,
      question ?? { kind: 'SUBSTITUTE_ATTACH', chatKeyHash },
    );
    if (!pending || pending.lineMessageId !== event.lineMessageId) return undefined;
    if (!created) {
      await this.updateEventLog(event.webhookEventId, 'duplicate_media_pending', undefined, companyId);
      return { outcome: 'done' };
    }
    if (!question) {
      return this.attachSubstituteMedia({
        ...input,
        pending,
        purpose: classified === 'PAYMENT_EVIDENCE' ? 'expense.payment.evidence' : 'expense.receipt.supporting',
      });
    }
    // §11: two classes stay plausible, so exactly one question is asked and the file waits.
    const text = question.kind === 'SUBSTITUTE_SCAN_CONFIRM' ? substituteScanConfirmQuestion(scan!) : substituteMediaQuestion(choices);
    await this.deliverReply(event, text);
    await this.persistIntakeTurn({
      userId: input.userId, companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: `${mediaPreviewLabel(pending)}${input.captionSuffix}`, replyText: text, intent: 'CLARIFY',
    });
    await this.appendMediaClarification({
      companyId, chatKey: mediaChatKey(event), requestId: input.requestId, webhookEventId: event.webhookEventId,
      userId: input.userId, caption: input.caption, question: text, pending,
    });
    await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
    return { outcome: 'done' };
  }

  /** §11/§14: the caption already said what this file is, so it is attached to the open work under
   *  that purpose — permission-checked and audited inside the expenses use case. */
  private async attachSubstituteMedia(input: {
    event: LineReceiptUploadEvent;
    ctx: RequestContext;
    access: { membershipId: string; roles: string[]; permissions: string[]; entitlementDeniedPermissions?: Record<string, string>; scopes: { branchIds?: string[] } };
    companyId: string;
    userId: string;
    captionSuffix: string;
    context: LineSubstituteMediaContext;
    pending: { id: string; attachmentId: string };
    purpose: 'expense.payment.evidence' | 'expense.receipt.supporting';
  }): Promise<LineMediaTurnOutcome> {
    const { event, companyId } = input;
    const { replyText } = await this.substituteReceiptContinuation!.attachMedia(input.ctx, {
      expenseId: input.context.expenseId,
      attachmentId: input.pending.attachmentId,
      purpose: input.purpose,
      webBaseUrl: this.config.webBaseUrl,
    });
    await this.deliverCompletedReply(event, replyText, companyId, input.access);
    await this.resolvePendingRow(input.pending.id, 'RESOLVED_RECEIPT');
    await this.persistIntakeTurn({
      userId: input.userId, companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: `[ผู้ใช้ส่งหลักฐานของงานใบรับรอง]${input.captionSuffix}`, replyText, intent: 'EVIDENCE_CAPTURE',
    });
    await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
    return { outcome: 'done' };
  }

  private async resolvePendingRow(id: string, status: 'RESOLVED_RECEIPT' | 'RESOLVED_ILLUSTRATION' | 'RESOLVED_SIGNATURE'): Promise<void> {
    await this.prisma.client.lineIntakePendingMedia.updateMany({ where: { id, status: 'PENDING' }, data: { status } });
  }

  /** §11 answer half. It claims the turn ONLY for a row whose recorded question is one of ours and
   *  was asked in THIS chat — the receipt clarify's own rows, and rows from another chat, route
   *  exactly as they did before. Within our own rows the answer is read off the recorded list, so
   *  “2” always means what it meant when it was printed.
   *
   *  `not_answered` means "ours, but this message is not an answer to it": the bytes stay pending
   *  and the caller re-states the question instead of letting a different classifier act on them. */
  private async resolveSubstituteMediaAnswer(
    event: LineTextEvent,
    ctx: RequestContext,
    access: { membershipId: string; roles: string[]; permissions: string[]; entitlementDeniedPermissions?: Record<string, string>; scopes: { branchIds?: string[] } },
    pending: { id: string; attachmentId: string; lineMessageId: string; mimeType: string; askedQuestionJson?: unknown },
    text: string,
  ): Promise<{ outcome: 'handled' | 'new_expense' } | { outcome: 'not_answered'; question: string } | undefined> {
    if (!this.substituteReceiptContinuation) return undefined;
    const chatKeyHash = chatKeyHashOf(event);
    const asked = parseSubstituteMediaQuestion(pending.askedQuestionJson, chatKeyHash);
    if (!asked) return undefined;
    if (asked.kind === 'CHECK_BILL_ACTION') {
      return this.resolvePendingCheckBillAction(event, ctx, access, pending, text, asked);
    }
    // §14 keeps `expense.receipt.upload` as the attach gate. Someone who lost it between question
    // and answer gets the truth, not a generic failure that also loses what they typed.
    if (!ctx.permissions.includes('expense.receipt.upload')) {
      return this.refuseSubstituteMediaAnswer(event, ctx, access, text, receiptDeniedReply(access));
    }
    const context = await this.substituteReceiptContinuation.loadOpenMediaContext(ctx, chatKeyHash);
    if (!context) {
      return this.refuseSubstituteMediaAnswer(event, ctx, access, text,
        '📄 งานใบรับรองแทนใบเสร็จรับเงินในแชทนี้ไม่ได้เปิดค้างไว้แล้วค่ะ ไฟล์ที่ส่งมายังเก็บไว้ ยังไม่ได้บันทึกเป็นหลักฐานของรายการใด');
    }
    // The list to fall back on once no form is awaiting a scan. Derived from the live context
    // rather than a fixed const, so A3's signature choice survives every re-ask: this chat can be
    // blocked on a signature while a scan question is open, and a hardcoded list dropped it.
    const withoutScanChoices = substituteMediaChoices({ ...context, awaitingScans: [] });
    if (asked.kind === 'SUBSTITUTE_SCAN_CONFIRM') {
      const scan = context.awaitingScans.find((item) => item.evidenceId === asked.evidenceId);
      const confirmed = scan ? substituteScanConfirmAnswer(text) : undefined;
      if (scan && confirmed === 'YES') return this.linkSubstituteScan(event, ctx, access, pending, text, scan);
      // §15: “ไม่ใช่” refuses one identification, not the file. Other forms awaiting a scan are
      // listed; with none left the photo is ordinary evidence and the class question decides.
      if (scan && confirmed === 'NO') {
        const others = context.awaitingScans.filter((item) => item.evidenceId !== asked.evidenceId);
        return others.length
          ? this.askSubstituteMediaQuestion(event, ctx, access, pending, text, substituteScanPickQuestion(others),
            { kind: 'SUBSTITUTE_SCAN_PICK', chatKeyHash, evidenceIds: others.map((item) => item.evidenceId) })
          : this.askSubstituteMediaQuestion(event, ctx, access, pending, text,
            substituteMediaQuestion(withoutScanChoices),
            { kind: 'SUBSTITUTE_MEDIA_CLASS', chatKeyHash, choices: withoutScanChoices });
      }
      // The form stopped awaiting a scan while the question was open: never link, ask again.
      if (!scan) {
        return this.askSubstituteMediaQuestion(event, ctx, access, pending, text,
          substituteMediaQuestion(withoutScanChoices),
          { kind: 'SUBSTITUTE_MEDIA_CLASS', chatKeyHash, choices: withoutScanChoices });
      }
      return { outcome: 'not_answered', question: substituteScanConfirmQuestion(scan) };
    }
    if (asked.kind === 'SUBSTITUTE_SCAN_PICK') {
      const offered = asked.evidenceIds
        .map((id) => context.awaitingScans.find((item) => item.evidenceId === id))
        .filter((item): item is LineSubstituteMediaScan => !!item);
      const index = numberedSelection(text, offered.length);
      if (index === undefined) return { outcome: 'not_answered', question: substituteScanPickQuestion(offered) };
      return this.linkSubstituteScan(event, ctx, access, pending, text, offered[index]!);
    }
    const answer = substituteMediaAnswer(text, asked.choices);
    if (!answer) return { outcome: 'not_answered', question: substituteMediaQuestion(asked.choices) };
    if (answer === 'NEW_EXPENSE') return { outcome: 'new_expense' };
    if (answer === 'NO_RECORD') {
      await this.deliverCompletedReply(event, MEDIA_NOT_RECORDED_REPLY, ctx.companyId, access);
      await this.resolvePendingRow(pending.id, 'RESOLVED_ILLUSTRATION');
      await this.persistIntakeTurn({
        userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: text, replyText: MEDIA_NOT_RECORDED_REPLY, intent: 'CLARIFY',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, ctx.companyId);
      return { outcome: 'handled' };
    }
    if (answer === 'SIGNATURE') {
      // A3: the photo the assistant asked for, finally reaching the library. §14's rule stands —
      // the answer is checked against the permission the action needs, not the one that parked it.
      if (!maySubmitSignature(ctx.permissions) || !this.initSignatureUpload || !this.createSignatureAsset) {
        return this.refuseSubstituteMediaAnswer(event, ctx, access, text, SIGNATURE_FORBIDDEN_REPLY);
      }
      // F9: certification resolves signatures through a PNG/JPEG-only lookup, so a PDF answered as
      // "my signature" would become an ACTIVE asset that can never sign anything — a dead end from
      // the first turn now that nothing is held for review. Refuse it while the sender is still here.
      if (pending.mimeType !== 'image/png' && pending.mimeType !== 'image/jpeg') {
        return this.refuseSubstituteMediaAnswer(event, ctx, access, text, SIGNATURE_NEED_IMAGE_REPLY);
      }
      // W1: consume the row BEFORE the bytes are claimed as a signature asset. The link is
      // irreversible and the LINE delivery between them can throw; with the resolve last, that throw
      // left the row PENDING holding an attachment id that is already a company signature asset —
      // and the very next answer could file the same id as this expense's receipt or substitute
      // evidence, producing an artifact that is both. A failure after this point costs the sender one
      // re-send; the alternative costs a reviewer a document that cannot be trusted.
      await this.resolvePendingRow(pending.id, 'RESOLVED_SIGNATURE');
      const replyText = await this.createLineSignatureAsset({
        ctx,
        // The IMAGE's message id, not this answer's: that is what a redelivery of the photo would
        // collide with, and what the router-routed ticket would have de-duplicated on.
        event: { lineMessageId: pending.lineMessageId },
        companyId: ctx.companyId,
        attachmentId: pending.attachmentId,
        // F8: steer to “ตอบ 1” only when a workflow is actually parked at the issue decision — read
        // from the live continuation, since this route can also be reached with no decision pending.
        steerToPendingDecision: await this.substituteReceiptContinuation.hasPendingIssueDecision(ctx, chatKeyHash),
      });
      await this.deliverCompletedReply(event, replyText, ctx.companyId, access);
      await this.persistIntakeTurn({
        userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: text, replyText, intent: 'SIGNATURE_REQUEST',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, ctx.companyId);
      return { outcome: 'handled' };
    }
    if (answer === 'WET_SIGNED_SCAN') {
      const scan = context.awaitingScans[0];
      if (!scan) {
        return this.askSubstituteMediaQuestion(event, ctx, access, pending, text,
          substituteMediaQuestion(withoutScanChoices),
          { kind: 'SUBSTITUTE_MEDIA_CLASS', chatKeyHash, choices: withoutScanChoices });
      }
      return this.linkSubstituteScan(event, ctx, access, pending, text, scan);
    }
    const { replyText } = await this.substituteReceiptContinuation.attachMedia(ctx, {
      expenseId: context.expenseId,
      attachmentId: pending.attachmentId,
      purpose: answer === 'PAYMENT_EVIDENCE' ? 'expense.payment.evidence' : 'expense.receipt.supporting',
      webBaseUrl: this.config.webBaseUrl,
    });
    return this.deliverSubstituteMediaOutcome(event, ctx, access, pending, text, replyText);
  }

  private async resolvePendingCheckBillAction(
    event: LineTextEvent,
    ctx: RequestContext,
    access: { membershipId: string; roles: string[]; permissions: string[]; entitlementDeniedPermissions?: Record<string, string>; scopes: { branchIds?: string[] } },
    pending: { id: string; attachmentId: string; lineMessageId: string; mimeType: string },
    text: string,
    asked: Extract<LineSubstituteMediaQuestion, { kind: 'CHECK_BILL_ACTION' }>,
  ): Promise<{ outcome: 'handled' } | { outcome: 'not_answered'; question: string }> {
    const chatKeyHash = chatKeyHashOf(event);
    const choice = checkBillPaymentChoice(text);
    if (!choice) return { outcome: 'not_answered', question: formatCheckBillDecisionReply() };

    if (choice === 'UNPAID' || choice === 'FINAL_RECEIPT') {
      const reply = choice === 'UNPAID'
        ? [
            '⏸️ ยังไม่สร้างรายการค่าใช้จ่ายค่ะ',
            'เพราะเช็กบิลใบนี้แสดงเพียงยอดที่ต้องจ่าย แต่ยังไม่มีหลักฐานว่าร้านรับเงินแล้ว',
            'หลังจ่ายเงิน ส่งใบเสร็จฉบับสุดท้ายเข้ามาได้เลยค่ะ',
          ].join('\n')
        : [
            '📷 ได้เลยค่ะ ยังไม่สร้างรายการจากเช็กบิลใบนี้',
            'ส่งรูปใบเสร็จฉบับสุดท้ายเข้ามา ระบบจะอ่านและสร้างรายการจากใบเสร็จจริงค่ะ',
          ].join('\n');
      await this.deliverReply(
        event,
        reply,
        choice === 'FINAL_RECEIPT' ? buildCheckBillReceiptUploadQuickReply() : undefined,
      );
      await this.resolvePendingRow(pending.id, 'RESOLVED_ILLUSTRATION');
      await this.persistIntakeTurn({
        userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: text, replyText: reply, intent: 'CLARIFY',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, ctx.companyId);
      return { outcome: 'handled' };
    }

    const canCaptureExpense = ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.create']
      .some((permission) => access.permissions.includes(permission));
    if (!canCaptureExpense || !this.expenseRepo || !this.substituteReceiptContinuation) {
      return this.refuseSubstituteMediaAnswer(event, ctx, access, text, receiptDeniedReply(access));
    }
    const existing = await this.expenseRepo.findByLineMessageId(ctx.companyId, pending.lineMessageId);
    let expenseId: string;
    if (existing) {
      await this.completeReceiptDraft(existing.id, pending, ctx.companyId, ctx.userId, access.scopes);
      expenseId = existing.id;
    } else {
      ({ expenseId } = await this.createReceiptDraftFromPendingMedia(
        ctx.requestId,
        ctx.userId,
        ctx.companyId,
        event.webhookEventId,
        pending,
        access.scopes,
        chatKeyHashOf(event),
      ));
    }
    if (asked.ocrFields) await this.receiptOcrApply.apply(ctx, expenseId, asked.ocrFields);
    const classification = asked.classification ?? { documentKind: 'ORDER_OR_CHECK_BILL' };
    await this.expenseRepo.updateExpense({
      id: expenseId,
      companyId: ctx.companyId,
      updatedByUserId: ctx.userId,
      sourceDocumentType: 'NEEDS_REVIEW',
      taxEvidenceStatus: 'NEEDS_REVIEW',
      inputVatClaimStatus: 'NEEDS_REVIEW',
      aiVerificationStatus: 'NEEDS_REVIEW',
      aiVerificationSummaryJson: {
        status: 'NOT_EXPENSE_DOCUMENT',
        recognizedFields: asked.ocrFields,
        classification,
        missingFields: asked.ocrFields?.missingFields ?? [],
        duplicateWarning: false,
        nextAction: 'check_bill_payment_decision_confirmed',
      },
    });
    const started = await this.substituteReceiptContinuation.startFromCheckBill(ctx, {
      expenseId,
      chatKeyHash,
      webBaseUrl: this.config.webBaseUrl,
    });
    const continuation = started.status === 'FORBIDDEN'
      ? started
      : await this.substituteReceiptContinuation.execute(ctx, {
          messageText: '1',
          chatKeyHash,
          recentCandidates: [{ id: expenseId, label: `เช็กบิลที่ยืนยันว่าจ่ายแล้ว ${expenseId}` }],
          webBaseUrl: this.config.webBaseUrl,
          confirmedStart: true,
        });
    const reply = formatCheckBillDraftCreatedReply(continuation);
    if (continuation.pendingQuestion && !['FORBIDDEN', 'INELIGIBLE', 'STALE'].includes(continuation.status)) {
      await this.deliverReply(event, reply);
    } else {
      await this.deliverCompletedReply(event, reply, ctx.companyId, access, continuation.badge);
    }
    await this.resolvePendingRow(pending.id, 'RESOLVED_RECEIPT');
    await this.recordDeliveredReceiptContinuation(event, ctx.companyId, ctx.userId, expenseId, access.scopes);
    await this.persistIntakeTurn({
      userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: text, replyText: reply, intent: 'EVIDENCE_CAPTURE',
    });
    if (continuation.pendingQuestion) {
      await this.ledger?.appendSubRequests({
        companyId: ctx.companyId, chatKey: event.pushTargetId ?? event.lineUserId,
        turnId: ctx.requestId, webhookEventId: event.webhookEventId, userId: ctx.userId,
        items: [{
          text: 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ', state: 'waiting_user',
          clarifyQuestion: continuation.pendingQuestion, intent: 'CLARIFY',
          clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION', candidateExpenseIds: [expenseId],
        }],
      });
    }
    await this.updateEventLog(
      event.webhookEventId,
      continuation.pendingQuestion ? 'clarification_required' : 'completed',
      undefined,
      ctx.companyId,
    );
    return { outcome: 'handled' };
  }

  /** R10 + D9: the confirmed photo becomes the wet-signed original. A refusal from the link (an
   *  unreadable scan, a state that moved) is a sentence the sender can act on, never a stack trace. */
  private async linkSubstituteScan(
    event: LineTextEvent,
    ctx: RequestContext,
    access: { membershipId: string; roles: string[]; permissions: string[]; entitlementDeniedPermissions?: Record<string, string>; scopes: { branchIds?: string[] } },
    pending: { id: string; attachmentId: string },
    text: string,
    scan: LineSubstituteMediaScan,
  ): Promise<{ outcome: 'handled' }> {
    try {
      const { replyText, badge } = await this.substituteReceiptContinuation!.linkWetSignedScan(ctx, {
        expenseId: scan.expenseId,
        evidenceId: scan.evidenceId,
        attachmentId: pending.attachmentId,
        checksumSha256: await this.pendingMediaChecksum(ctx.companyId, pending.attachmentId),
        webBaseUrl: this.config.webBaseUrl,
      });
      return this.deliverSubstituteMediaOutcome(event, ctx, access, pending, text, replyText, badge);
    } catch (error: unknown) {
      if (!(error instanceof HttpException)) throw error;
      const body = error.getResponse();
      const detail = typeof body === 'object' && body && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : error.message;
      return this.refuseSubstituteMediaAnswer(event, ctx, access, text,
        `📄 ยังรับรูปนี้เป็นฟอร์มที่เซ็นแล้วของ ${scan.documentNumber} ไม่ได้ค่ะ\n${detail}\nส่งรูปใหม่ที่ชัดเจน หรือแนบไฟล์ในเว็บได้เลย`);
    }
  }

  /** Re-ask, keeping the bytes and REPLACING the recorded question so the next answer is read off
   *  the list that was actually printed this time. */
  private async askSubstituteMediaQuestion(
    event: LineTextEvent,
    ctx: RequestContext,
    access: { permissions: string[]; roles: string[]; entitlementDeniedPermissions?: Record<string, string> },
    pending: { id: string },
    text: string,
    question: string,
    asked: LineSubstituteMediaQuestion,
  ): Promise<{ outcome: 'handled' }> {
    await this.prisma.client.lineIntakePendingMedia.updateMany({
      where: { id: pending.id, status: 'PENDING' }, data: { askedQuestionJson: asked as any },
    });
    // A question is not a finished turn: same plain delivery the arrival question uses, so a
    // completion menu cannot appear next to a numbered list and be read as more choices.
    await this.deliverReply(event, question);
    await this.persistIntakeTurn({
      userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: text, replyText: question, intent: 'CLARIFY',
    });
    await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, ctx.companyId);
    return { outcome: 'handled' };
  }

  /** The turn is ours and the answer cannot be honoured: say why, keep the bytes, write nothing. */
  private async refuseSubstituteMediaAnswer(
    event: LineTextEvent,
    ctx: RequestContext,
    access: { permissions: string[]; roles: string[]; entitlementDeniedPermissions?: Record<string, string> },
    text: string,
    reply: string,
  ): Promise<{ outcome: 'handled' }> {
    await this.deliverCompletedReply(event, reply, ctx.companyId, access);
    await this.persistIntakeTurn({
      userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: text, replyText: reply, intent: 'CLARIFY',
    });
    await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, ctx.companyId);
    return { outcome: 'handled' };
  }

  /** The checksum recorded when the bytes were stored. R11 keeps the scan's own checksum on the
   *  evidence row, so it is read from the attachment rather than recomputed from a second download. */
  private async pendingMediaChecksum(companyId: string, attachmentId: string): Promise<string> {
    const attachment = await this.prisma.client.attachmentObject.findFirst({
      where: { id: attachmentId, companyId, status: 'ACTIVE' }, select: { checksumSha256: true },
    });
    if (!attachment?.checksumSha256) throw new Error('LINE_PENDING_MEDIA_CHECKSUM_MISSING');
    return attachment.checksumSha256;
  }

  private async deliverSubstituteMediaOutcome(
    event: LineTextEvent,
    ctx: RequestContext,
    access: { permissions: string[]; roles: string[]; entitlementDeniedPermissions?: Record<string, string> },
    pending: { id: string },
    text: string,
    replyText: string,
    badge?: string,
  ): Promise<{ outcome: 'handled' }> {
    // W1, same rule as the signature branch: every caller reaches here with the attachment ALREADY
    // linked (payment/supporting evidence, or a wet-signed original). A throw in the delivery below
    // must not leave the row PENDING, or the same bytes can be answered a second time and end up
    // linked to a second, incompatible target.
    await this.resolvePendingRow(pending.id, 'RESOLVED_RECEIPT');
    await this.deliverCompletedReply(event, replyText, ctx.companyId, access, badge);
    await this.persistIntakeTurn({
      userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: text, replyText, intent: 'EVIDENCE_CAPTURE',
    });
    await this.updateEventLog(event.webhookEventId, 'completed', undefined, ctx.companyId);
    return { outcome: 'handled' };
  }

  /** GAP C tier 1: the substitute work this chat can be told the next step for — an OPEN/PAUSED
   *  workflow, or a document already PREPARED/PAYER_CERTIFIED/ISSUED on the newest continuation this
   *  chat opened (that state is CONSUMED by the prepare, so only the evidence still says so).
   *  Returns the expense to report on; the continuation's own card does the reporting. Read only for
   *  a “what next?” message, so no other turn pays for the lookup. */
  private async substituteWorkInFlight(
    companyId: string,
    userId: string,
    chatKeyHash: string,
    scopes: { branchIds?: string[] },
  ): Promise<string | undefined> {
    if (!this.expenseRepo) return undefined;
    const rows = await this.expenseRepo.listLineSubstituteContinuationRows({ companyId, userId, chatKeyHash, scopes, take: 5 });
    const active = rows.find((row) => hasActiveSubstituteContinuation([row]));
    if (active) return active.id;
    const newest = rows[0];
    if (!newest) return undefined;
    const status = (await this.expenseRepo.findByIdWithRelations(companyId, newest.id, undefined, scopes))
      ?.substituteReceiptEvidence?.status;
    return status === 'PREPARED' || status === 'PAYER_CERTIFIED' || status === 'ISSUED' ? newest.id : undefined;
  }

  /** R1 capture-first: create the expense draft the substitute request describes, so the
   *  continuation opens on a real target instead of dead-ending in target selection.
   *
   *  The capture gate is deterministic and unchanged (`isLineTextExpenseCaptureEligible` — this path
   *  never sets the semantic guard): it needs
   *  an `amount` that occurs in the source text plus a `description` copied verbatim from it. No
   *  model runs on this path, so both hints are synthesized here from the amount candidate the turn
   *  already extracted and the non-vocabulary part of the message.
   *
   *  Returns undefined — and the turn falls through to the existing continuation dispatch — when
   *  there is no amount, no purpose beside it, no capture permission, or this chat already has an
   *  OPEN/PAUSED workflow (`execute` resolves that workflow before it looks at `recentCandidates`,
   *  so a new draft would be orphaned). */
  private async captureBeforeSubstituteContinuation(
    event: LineTextEvent,
    ctx: RequestContext,
    normalizedText: string,
    amount: string | undefined,
    /** R2: the request phrase was already said a turn ago, so THIS message is nothing but the expense
     *  fact and the whole of it is the description — still verbatim source text for the gate. When the
     *  phrase is in the message, `substituteRequestExpenseText`'s "amount PLUS purpose" floor decides
     *  exactly as before (a carried turn never carries the phrase, so the two cannot overlap). */
    carriedIntent = false,
  ): Promise<Awaited<ReturnType<CaptureLineExpenseNoteUseCase['execute']>> | undefined> {
    if (!amount || !this.captureExpenseNote || !this.expenseRepo) return undefined;
    const description = substituteRequestExpenseText(normalizedText) ?? (carriedIntent ? normalizedText : undefined);
    if (!description) return undefined;
    const openRows = await this.expenseRepo.listLineSubstituteContinuationRows({
      companyId: ctx.companyId, userId: ctx.userId, chatKeyHash: chatKeyHashOf(event), scopes: ctx.scopes ?? {},
    });
    if (hasActiveSubstituteContinuation(openRows)) return undefined;
    try {
      return await this.timeStage(event.webhookEventId, 'capture_execute', () => this.captureExpenseNote!.execute(ctx, {
        messageText: normalizedText,
        captureHints: { amount, description },
        lineMessageId: event.lineMessageId ?? event.webhookEventId,
        lineEventId: event.webhookEventId,
        // The substitute continuation owns this conversation's next question; a second draft-
        // conversation thread would ask the same user two different ones in the same reply.
        draftConversationEnabled: false,
        chatKeyHash: chatKeyHashOf(event),
      }));
    } catch (error) {
      if (!(error instanceof LineTextExpenseCaptureIncompleteError)) throw error;
      return undefined;
    }
  }

  /** RECEIPT-05: the customer confirmed the pending media is an expense document. Build the
   *  reviewable draft from the ALREADY-persisted attachment and mark the row resolved. */
  private async resolvePendingMediaAsReceipt(
    event: LineTextEvent,
    requestId: string,
    userId: string,
    companyId: string,
    access: { membershipId: string; roles: string[]; permissions: string[]; entitlementDeniedPermissions?: Record<string, string>; scopes: { branchIds?: string[] } },
    pending: { id: string; attachmentId: string; lineMessageId: string; mimeType: string },
    userMessagePreview: string,
    additionalText?: string,
  ): Promise<void> {
    const canCaptureExpense = ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.create'].some((p) => access.permissions.includes(p));
    if (!canCaptureExpense || !this.expenseRepo) {
      await this.deliverReply(event, receiptDeniedReply(access));
      await this.updateEventLog(event.webhookEventId,
        receiptFeatureDisabled(access) ? 'feature_disabled' : 'forbidden',
        receiptFeatureDisabled(access) ? LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE : LINE_AI_ERROR_CODES.FORBIDDEN,
        companyId);
      return;
    }
    // Idempotent by the ORIGINAL media message id (the text reply carries a different id): a
    // reclaim after a crash finds the draft already created and never makes a second one. But
    // "found" is not "complete" — create, attachment-link and the primaryAttachmentId update are
    // separate ops, so a first resolve that failed AFTER create left the receipt detached. Always
    // run the (idempotent) attachment completion before marking the row resolved, so a retry
    // REPAIRS a partial draft instead of rubber-stamping it (Fix #5).
    const existing = await this.expenseRepo.findByLineMessageId(companyId, pending.lineMessageId);
    let expenseId: string;
    let hasDuplicate: boolean;
    if (existing) {
      hasDuplicate = await this.completeReceiptDraft(existing.id, pending, companyId, userId, access.scopes);
      expenseId = existing.id;
    } else {
      ({ expenseId, hasDuplicate } = await this.createReceiptDraftFromPendingMedia(
        requestId,
        userId,
        companyId,
        event.webhookEventId,
        pending,
        access.scopes,
        chatKeyHashOf(event),
      ));
    }
    let reply = formatPaypersReply(this.config.webBaseUrl, companyId, expenseId, { hasDuplicate });
    let pendingQuestion: string | undefined;
    if (additionalText && this.substituteReceiptContinuation && isSubstituteReceiptConversationText(additionalText)) {
      try {
        const continuation = await this.substituteReceiptContinuation.execute({
          requestId, authSubject: userId, userId, companyId,
          membershipId: access.membershipId, roles: access.roles, permissions: access.permissions,
          scopes: access.scopes, authProvider: 'line',
        }, {
          messageText: additionalText,
          chatKeyHash: chatKeyHashOf(event),
          recentCandidates: [{ id: expenseId, label: `รายการที่เพิ่งบันทึก ${expenseId}` }],
          webBaseUrl: this.config.webBaseUrl,
        });
        reply = `${reply}\n\n${SUBSTITUTE_ADDITIONAL_OUTCOME_LABEL}\n${continuation.replyText}`;
        pendingQuestion = continuation.pendingQuestion;
      } catch (error) {
        this.logger.warn({ msg: 'line_substitute_continuation_additional_outcome_failed', requestId, error: (error as Error).message });
        reply = `${reply}\n\n${SUBSTITUTE_ADDITIONAL_OUTCOME_LABEL}\n${SUBSTITUTE_ADDITIONAL_OUTCOME_DEGRADED}`;
      }
    }
    await this.deliverCompletedReply(event, reply, companyId, access);
    await this.prisma.client.lineIntakePendingMedia.updateMany({
      where: { id: pending.id, status: 'PENDING' },
      data: { status: 'RESOLVED_RECEIPT' },
    });
    await this.recordDeliveredReceiptContinuation(event, companyId, userId, expenseId, access.scopes);
    await this.persistIntakeTurn({
      userId, companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: `[ยืนยันบันทึกใบเสร็จ] ${userMessagePreview}`, replyText: reply, intent: 'EVIDENCE_CAPTURE',
    });
    if (pendingQuestion) {
      await this.ledger?.appendSubRequests({
        companyId, chatKey: event.pushTargetId ?? event.lineUserId, turnId: requestId,
        webhookEventId: event.webhookEventId, userId,
        items: [{
          text: 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ', state: 'waiting_user',
          clarifyQuestion: pendingQuestion, intent: 'CLARIFY',
          clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION',
        }],
      });
    }
    await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
  }

  private async recordDeliveredReceiptContinuation(
    event: { webhookEventId: string; lineUserId: string; pushTargetId?: string },
    companyId: string,
    userId: string,
    expenseId: string,
    scopes: { branchIds?: string[] },
  ): Promise<void> {
    if (!this.expenseRepo) return;
    try {
      await this.expenseRepo.recordDeliveredLineReceiptContinuation({
        companyId, expenseId, userId, scopes,
        chatKeyHash: chatKeyHashOf(event),
        deliveredOutcomeId: hashMessagePreview(event.webhookEventId),
      });
    } catch (error) {
      // The reply is already delivered and the source expense remains authoritative. A later
      // source read may fall back to the normal flow, but must not turn a successful capture into
      // a customer-visible failure or duplicate mutation.
      this.logger.warn({ msg: 'line_receipt_continuation_record_failed', expenseId, error: (error as Error).message });
    }
  }

  /** Correction candidates for this turn (spec §8 candidate scope). Structured-only labels:
   *  vendor/category free text is deliberately excluded so the payload cannot carry injection. */
  private async loadCorrectionCandidates(
    companyId: string,
    userId: string,
    chatKeyHash: string,
    scopes: { branchIds?: string[] },
  ): Promise<LineIntakeCorrectionCandidate[]> {
    if (!this.expenseRepo) return [];
    const since = new Date(Date.now() - CORRECTION_CANDIDATE_WINDOW_MS);
    const rows = await this.expenseRepo.listRecentLineCaptures({
      companyId, createdByUserId: userId, chatKeyHash, since, scopes, take: LINE_CORRECTION_CANDIDATE_LIMIT,
    });
    return rows.map((row) => {
      const amount = row.grandTotalAmount && Number(row.grandTotalAmount) > 0
        ? Number(row.grandTotalAmount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : undefined;
      const docType = row.sourceDocumentType ? SOURCE_DOC_TYPE_REPLY_LABELS[row.sourceDocumentType] ?? row.sourceDocumentType : 'เอกสารค่าใช้จ่าย';
      const dateLabel = formatReplyDate(row.expenseDate?.toISOString());
      return {
        id: row.id,
        label: [docType, dateLabel, amount].filter(Boolean).join(' · '),
        ...(amount ? { amount } : {}),
        ...(row.expenseDate ? { expenseDate: row.expenseDate.toISOString() } : {}),
        ...(row.sourceDocumentType ? { sourceDocumentType: row.sourceDocumentType } : {}),
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  /** Durably record which clarifications this terminal turn consumed, then let Redis catch up.
   *  Guidance has no business transaction of its own, so the markers commit in one short
   *  transaction BEFORE delivery — an ack gated on a successful reply is exactly the hole that
   *  let the next message inherit the old request. */
  private async consumeClarifications(
    companyId: string,
    chatKey: string,
    userId: string,
    openWaiting: Array<LineAiOpenClarification & { entry: LedgerEntry }>,
    resolvedIds: string[] | undefined,
    outcome: string,
  ): Promise<void> {
    const plan = this.planConsumption(companyId, chatKey, userId, openWaiting, resolvedIds, outcome);
    if (!plan) return;
    await this.prisma.client.$transaction(async (tx: any) => { await markClarificationsConsumed(tx, plan.consumption); });
    await this.ackConsumed(plan, outcome);
  }

  /** What this turn consumed: the model's resolved ids, narrowed to entries this user was
   *  actually asked. Handed to whichever finalizer owns the business transaction. */
  private planConsumption(
    companyId: string,
    chatKey: string,
    userId: string,
    openWaiting: Array<LineAiOpenClarification & { entry: LedgerEntry }>,
    resolvedIds: string[] | undefined,
    outcome: string,
  ): { consumption: ClarificationConsumption; entries: LedgerEntry[] } | undefined {
    const consumed = openWaiting.filter((item) => resolvedIds?.includes(item.id) && item.entry.userId === userId);
    if (consumed.length === 0) return undefined;
    return {
      consumption: {
        companyId, ledgerStreamKey: ledgerKey(companyId, chatKey), entryIds: consumed.map((item) => item.id), outcome,
      },
      entries: consumed.map((item) => item.entry),
    };
  }

  /** Redis cleanup AFTER the durable marker committed — a swallowed XACK is then harmless. */
  private async ackConsumed(plan: { entries: LedgerEntry[] } | undefined, outcome: string): Promise<void> {
    for (const entry of plan?.entries ?? []) await this.ledger?.ack(entry, 'acked', { outcome });
  }

  /** RECEIPT-05: build the reviewable expense draft from the attachment persisted at clarify
   *  time. OCR still waits for web review; byte and visual dedupe use attachment metadata. */
  private async createReceiptDraftFromPendingMedia(
    requestId: string,
    userId: string,
    companyId: string,
    lineEventId: string,
    pending: { attachmentId: string; lineMessageId: string; mimeType: string },
    scopes: { branchIds?: string[] },
    chatKeyHash?: string,
  ): Promise<{ expenseId: string; hasDuplicate: boolean }> {
    const expense = await this.expenseRepo!.createExpense({
      companyId, branchId: await this.expenseRepo!.resolveCreateBranchId(companyId, scopes),
      captureSource: 'LINE_UPLOAD', expenseDate: new Date(), currency: 'THB',
      vatMode: 'NO_VAT', inputVatClaimStatus: 'NEEDS_REVIEW', note: 'LINE receipt (clarified)',
      createdByUserId: userId, lineMessageId: pending.lineMessageId, lineEventId,
      subtotalAmount: '0', discountAmount: '0', taxableAmount: '0', vatAmount: '0',
      whtAmount: '0', grandTotalAmount: '0', netPayableAmount: '0', outstandingAmount: '0',
      // Chat provenance for correction targeting — the pending-media path creates drafts too,
      // so omitting it here would make clarified receipts uncorrectable.
      ...(chatKeyHash ? { sourceChannelMetadataJson: { channel: 'LINE', kind: 'pending_media', chatKeyHash } } : {}),
    });
    const hasDuplicate = await this.completeReceiptDraft(expense.id, pending, companyId, userId, scopes);
    await this.audit.log({
      companyId, actorUserId: userId, action: 'expense.line_upload.receive', targetType: 'expense_record',
      targetId: expense.id, requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { lineMessageId: '[REDACTED]', mimeType: pending.mimeType, resolvedVia: 'line_clarify' },
    });
    return { expenseId: expense.id, hasDuplicate };
  }

  /** RECEIPT-05 (Fix #5): idempotently link the persisted attachment to the draft and set
   *  primaryAttachmentId. Shared by first-time create and the partial-failure repair path — the
   *  attachment link tolerates its unique-constraint replay and the update is a plain set, so a
   *  retry always converges the draft to "complete with its attachment" before the pending row is
   *  marked RESOLVED_RECEIPT. */
  private async completeReceiptDraft(
    expenseId: string,
    pending: { attachmentId: string },
    companyId: string,
    userId: string,
    scopes: { branchIds?: string[] },
  ): Promise<boolean> {
    const repo = this.expenseRepo!;
    try {
      await repo.linkAttachment(expenseId, pending.attachmentId, 'expense.receipt.primary', companyId, userId);
    } catch (err) {
      // Link already exists from a partial first resolve — repair is idempotent, keep going.
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
    await repo.updateExpense({
      id: expenseId, companyId, updatedByUserId: userId,
      primaryAttachmentId: pending.attachmentId, status: 'NEEDS_REVIEW', aiVerificationStatus: 'NEEDS_REVIEW',
    });
    const duplicateResult = await reconcileExpenseDuplicateCandidates(repo, companyId, expenseId, userId, scopes);
    const hasDuplicate = duplicateResult.openCandidates > 0;
    await repo.updateExpense({
      id: expenseId, companyId, updatedByUserId: userId,
      aiVerificationSummaryJson: {
        status: 'NOT_REQUESTED',
        missingFields: ['vendor', 'expenseDate', 'documentNumber', 'grandTotalAmount', 'vatAmount', 'category'],
        duplicateWarning: hasDuplicate,
        nextAction: 'review_in_web',
        resolvedVia: 'line_clarify_receipt',
      },
    });
    return hasDuplicate;
  }

  private async tryExtractReceiptFields(
    ctx: { requestId: string; userId: string; companyId: string },
    attachmentId: string,
    media: { mimeType: string; contentBase64?: string },
    ocrAlreadyAdmitted = false,
    routeOcrErrorCode?: string,
    intakeDocumentText?: string,
  ): Promise<ReceiptOcrPreflight> {
    if (!media.contentBase64 || (media.mimeType !== 'image/jpeg' && media.mimeType !== 'image/png' && media.mimeType !== 'application/pdf')) {
      return { status: 'NOT_REQUESTED', fields: null, classification: null };
    }
    if (routeOcrErrorCode) {
      return { status: 'OCR_FAILED', fields: null, classification: null, errorCode: routeOcrErrorCode };
    }
    try {
      const activeCategories = this.expenseRepo
        ? (await this.expenseRepo.listCategories(ctx.companyId)).map((category) => ({ id: category.id, name: category.name }))
        : [];
      const result = await this.aiGateway.requestReceiptOcr({
        requestId: ctx.requestId,
        companyId: ctx.companyId,
        userId: ctx.userId,
        activeCategories,
        attachment: { id: attachmentId, mimeType: media.mimeType, purpose: 'receipt', contentBase64: media.contentBase64 },
        ...(intakeDocumentText ? { documentText: intakeDocumentText } : {}),
        // The lease can now be held briefly by a chat turn that slipped into a gap between this
        // media turn's model calls (busy-wait lane) — wait it out instead of failing the OCR.
      }, { ocrAlreadyAdmitted, busyWaitDeadlineMs: Date.now() + LINE_AI_LIVE_BUSY_WAIT_MS });
      if (result.status === 'not_configured') return { status: 'NOT_CONFIGURED', fields: null, classification: null };
      if (result.status !== 'ok') {
        return { status: 'OCR_FAILED', fields: null, classification: null, ...(result.errorCode ? { errorCode: result.errorCode } : {}) };
      }
      return {
        status: 'OCR_EXTRACTED_NEEDS_REVIEW',
        fields: result.fields ?? null,
        classification: result.classification ?? null,
      };
    } catch (err) {
      this.logger.warn({ msg: 'Receipt OCR unavailable', error: (err as Error).message });
      return { status: 'OCR_FAILED', fields: null, classification: null };
    }
  }

  private async uploadLineMedia(
    intent: { uploadUrl: string; uploadMethod: string; uploadHeaders?: Record<string, string> },
    media: { mimeType: string; bytes: Buffer },
  ): Promise<void> {
    await putLineMediaUpload(intent, media, this.config.publicApiBaseUrl);
  }

  private async lineMediaRejectionReason(media: DownloadedLineMedia): Promise<string | null> {
    if (validateAttachmentMeta(media.mimeType, media.byteSize, this.config.uploadMaxBytes)) return 'METADATA_REJECTED';
    if (validateAttachmentFileName(media.fileName, media.mimeType)) return 'EXTENSION_MIME_MISMATCH';
    if (inspectAttachmentBytes(media.mimeType, media.bytes)) return 'CONTENT_REJECTED';
    try {
      await this.malwareScanner.assertClean(media.bytes);
      return null;
    } catch (error) {
      return (error as Error).message === 'MALWARE_DETECTED' ? 'MALWARE_DETECTED' : 'MALWARE_SCAN_FAILED';
    }
  }

  private async downloadLineMedia(lineMessageId: string, messageType: 'image' | 'file', fileName?: string, fileSize?: number): Promise<DownloadedLineMedia | null> {
    const accessToken = this.config.lineMessagingChannelAccessToken;
    if (!accessToken) return null;
    if (fileSize !== undefined && (fileSize <= 0 || fileSize > this.config.uploadMaxBytes)) return null;
    const response = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(lineMessageId)}/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(LINE_MEDIA_DOWNLOAD_TIMEOUT_MS),
    }).catch(() => null);
    if (!response?.ok) return null;
    const declaredSize = Number(response.headers.get('content-length') ?? 0);
    if (declaredSize > this.config.uploadMaxBytes) return null;
    const bytes = await readResponseBodyLimited(response, this.config.uploadMaxBytes);
    if (!bytes) return null;
    const mimeType = normalizeAttachmentMimeType(response.headers.get('content-type'), bytes);
    const extension = canonicalAttachmentExtension(mimeType) ?? 'bin';
    return {
      fileName: fileName ?? `line-receipt-${lineMessageId}.${extension}`,
      mimeType,
      byteSize: bytes.byteLength,
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      contentBase64: messageType === 'image' ? bytes.toString('base64') : undefined,
      bytes,
    };
  }

  private async updateEventLog(webhookEventId: string, status: string, errorCode?: string, companyId?: string) {
    const result = await this.prisma.client.lineWebhookEventLog.updateMany({
      where: {
        webhookEventId,
        // Once delivery is pending, only the delivery path itself may advance
        // the event. Callers that continue after deliverMessages must not turn
        // an unsent response into a false "completed" record.
        status: { not: 'delivery_pending' },
      },
      // The turn reached an outcome, so the replay payload is no longer needed: dropping it here
      // is what keeps raw LINE chat ids out of the table in steady state. `delivery_pending` is
      // the exception — that row still owes the user a message, so the sweep may replay it.
      data: {
        status,
        errorCode,
        companyId,
        processedAt: new Date(),
        ...(status === 'delivery_pending' ? {} : { payloadJson: Prisma.DbNull }),
      },
    }).catch(() => null);
    const terminalClass = classifyLineAiTerminalOutcome(status, errorCode);
    if (result?.count === 1) {
      emitLineAiTerminalOutcome(this.logger, { webhookEventId, companyId, status, errorCode });
    } else if (terminalClass) {
      this.logger.warn({
        msg: 'line.ai.terminal.persistence_not_advanced',
        webhookEventId,
        companyId: companyId ?? null,
        intendedStatus: status,
        terminalClass,
      });
    }
  }

  private async claimWebhookEvent(webhookEventId: string, lineUserId: string): Promise<boolean> {
    const claimedAt = new Date();
    const existing = await this.prisma.client.lineWebhookEventLog.findUnique({ where: { webhookEventId } });
    if (existing) {
      if (existing.status !== 'received') return false;
      const claimed = await this.prisma.client.lineWebhookEventLog.updateMany({
        where: {
          webhookEventId,
          status: 'received',
          OR: [
            { processedAt: null },
            { processedAt: { lte: new Date(claimedAt.getTime() - LINE_BUFFER_ORPHAN_REPROCESS_MS) } },
          ],
        },
        data: { processedAt: claimedAt, errorCode: null },
      });
      if (claimed.count === 1) return true;
      return false;
    }

    try {
      await this.prisma.client.lineWebhookEventLog.create({
        data: {
          webhookEventId,
          lineUserIdHash: hashMessagePreview(lineUserId),
          eventType: 'message',
          status: 'received',
          processedAt: claimedAt,
        },
      });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return false;
      throw error;
    }
  }

  private async releaseWebhookEvent(webhookEventId: string, errorCode: string, companyId?: string): Promise<void> {
    await this.prisma.client.lineWebhookEventLog.updateMany({
      where: { webhookEventId, status: 'received' },
      // Both callers already answered the user, so the orphan sweep deliberately skips a row
      // carrying an errorCode — nothing will replay this payload, so it must not be kept. A LINE
      // redelivery re-supplies it through acceptEvent.
      data: { errorCode, companyId, processedAt: null, payloadJson: Prisma.DbNull },
    }).catch(() => {});
  }
}
