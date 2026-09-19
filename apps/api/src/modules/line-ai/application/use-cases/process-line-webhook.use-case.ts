import { LineMessagingCredentialsService } from '../../../../common/config/line-messaging-credentials.service';
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
import { HttpException, Inject, Injectable, Logger, Optional, ForbiddenException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { LineReadEvidenceService } from '../line-read-evidence.service';
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
import { LINE_RECENT_CAPTURE_WINDOW_MS, listRecentLineCaptureCandidates } from '../../../expenses/application/services/line-recent-capture';
import { receiptProgressLabel, receiptStatusQuestion } from '../../domain/logic/line-receipt-status.logic';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import type { ExpenseRecord } from '../../../expenses/domain/models/expense.model';
import { pickLineDefaultBranchId } from '../../../expenses/domain/logic/line-receipt-branch.logic';
import { CaptureLineExpenseNoteUseCase, LineTextExpenseCaptureIncompleteError } from '../../../expenses/application/use-cases/expense-document.use-case';
import { CorrectLineCapturedExpenseUseCase } from '../../../expenses/application/use-cases/line-correction.use-case';
import { LineDraftUpdateUseCase } from '../../../expenses/application/use-cases/line-draft-update.use-case';
import { detectLineDraftEditRequest } from '../../../expenses/domain/logic/line-draft-update.logic';
import { LINE_DRAFT_UPDATE_TOOLS, type LineDraftUpdateTool, type LineIntakeCorrectionHints } from '@watchdog-bms/contracts';
import {
  DRAFT_UPDATE_ALREADY_APPLIED_PREFIX,
  draftProposalAckReason,
  DRAFT_UPDATE_CANCELLED_REPLY,
  DRAFT_UPDATE_EXPIRED_REPLY,
  buildDraftUpdatePreviewCard,
  draftUpdateAppliedReply,
  draftUpdateBlockedReply,
  draftUpdateChangedReply,
  draftUpdateMoveSuggestionReply,
} from '../../domain/logic/line-draft-update-card.logic';
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
import { LineExpenseDraftConversationUseCase, type LineExpenseDraftConversationResult } from '../../../expenses/application/use-cases/line-expense-draft-conversation.use-case';
import { splitLineExpenseDraftReply, isDeterministicLineExpenseDraftInput } from '../../../expenses/domain/logic/line-expense-draft-conversation.logic';
import { InitSignatureUploadUseCase, CreateSignatureAssetUseCase, maySubmitSignature } from '../../../expenses/application/use-cases/signature-asset.use-case';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import { lockFundingEvidence } from '../../../expenses/infrastructure/substitute-funding.guard';
import type { ExpenseRecordWithRelations } from '../../../expenses/domain/models/expense.model';
import { CreateUploadIntentUseCase } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { CompleteAttachmentUploadUseCase } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  canonicalAttachmentExtension,
  inspectAttachmentBytes,
  normalizeAttachmentMimeType,
  validateAttachmentFileName,
  validateAttachmentMeta,
} from '../../../data-model-core/domain/logic/attachment.logic';
import { PrismaExpenseCaptureRepository, sanitizeAttemptFileName } from '../../../expenses/infrastructure/prisma-expense-capture.repository';
import {
  AddExpenseCaptureFileUseCase,
  CompleteExpenseCaptureFileUseCase,
  CreateExpenseCaptureGroupUseCase,
} from '../../../expenses/application/use-cases/expense-capture-group.use-case';
import { ExpenseCaptureLineUseCase, LINE_CAPTURE_NOTE_MAX_CHARS, LINE_CAPTURE_SAME_WORK_WINDOW_MS } from '../../../expenses/application/use-cases/expense-capture-line.use-case';
import {
  CAPTURE_READ_FAILED_REPLY,
  captureGroupStatusReply,
  classifyNonReceiptCase,
  NON_RECEIPT_PERSISTING_CASES,
  nonReceiptReply,
  type LineNonReceiptCase,
} from '../../domain/logic/line-non-receipt-reply.logic';
import {
  fileAttemptAnswer,
  fileAttemptChoiceList,
  FILE_ATTEMPT_LOOKUP_FAILED_REPLY,
  FILE_ATTEMPT_NONE_REPLY,
  type LineFileAttemptFacts,
} from '../../domain/logic/line-file-attempt-answer.logic';
import { AttachmentMalwareScanner } from '../../../data-model-core/infrastructure/attachment-malware-scanner';
import { deriveTaxEvidence, isExpenseExtractionEligible, isSuccessfulNonReceiptClassification, sourceDocumentTypeFromClassification, toSourceDocumentType } from '../../../expenses/domain/logic/expense-document.logic';
import { isStaleOcrApply, ReceiptOcrApplyService, toMoney4, type ReceiptCategorySuggestion, type ReceiptOcrApplyOutcome } from '../../../expenses/application/services/receipt-ocr-apply.service';
import { normalizeLineText, hashMessagePreview, parseBareCompanySelection, parseLineCompanyCommand } from '../../domain/logic/line-ai-classifier.logic';
import type { LineCompanyCommand } from '../../domain/logic/line-ai-classifier.logic';
import { formatRefusal } from '../../domain/logic/line-ai-formatter.logic';
import { absoluteWebLink } from '../../../../common/http/web-link';
import { FEATURE_TEMPORARILY_UNAVAILABLE, loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { ListApprovalQueueUseCase } from '../../../reimbursements/application/use-cases/reimbursement-approval.use-case';
import { ListPurchaseRequestsUseCase } from '../../../procurement/application/use-cases/purchase-request.use-case';
import { ListPurchaseOrdersUseCase } from '../../../procurement/application/use-cases/purchase-order.use-case';
import type { AiBudgetScope, BusinessDocumentClassification, ExpenseChargeSummary, LineExpenseDraftRouteContext, LineUserContext, LineAiTurnRequest, LineAiTurnResponse, LineAiConversationContext, LineAiOpenClarification, LineAiValueCandidates, LineIntakeCorrectionCandidate, LineIntakeRoutePlan, LineIntakeSubstituteContext, ReceiptOcrFieldResult, RequestContext } from '@watchdog-bms/contracts';
import { AI_BUDGET_REFUSAL_CODES, LINE_AI_CONTEXT_MAX_TURNS, LINE_AI_CONTEXT_WINDOW_MINUTES, LINE_AI_ERROR_CODES, LINE_CORRECTION_CANDIDATE_LIMIT, LINE_TOOL_REGISTRY, RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE, isAiBudgetPermanentRefusal, isAiBudgetRefusalCode, nextPlanTierKey, asIntakeRouteIntent, civilDateToUtcDate, extractValueCandidates, todayCivilDate, type ExpenseDocumentDateStatus } from '@watchdog-bms/contracts';
import { LineAiLedgerService, ledgerKey, LINE_CLARIFICATION_SOURCE_MAX_BYTES, type LedgerEntry, type LedgerSubRequestInput } from '../line-ai-ledger.service';
import { lineDeliveryRecipientHash, resolvedLineDeliveryAccessFingerprint } from '../line-delivery-access';
import { ConsumptionMarkerUnavailableError, markClarificationsConsumed, type ClarificationConsumption } from '../line-ai-consumption-marker';
import { isPublicPolicyFollowUp, isPublicPolicyTopic, resolvePublicPolicyAnswer, type PublicPolicyTopic } from '../../domain/logic/line-public-policy.logic';
import { availableApprovalSurfaceKeys, buildCapabilityCard, buildCompanyContextMessage, buildCompanyPickerMessage, buildContactCard, buildPendingApprovalCard, buildPromotionCard, buildReceiptCapturePrompt, buildServiceEntitlementMessage, buildStaffCompletionQuickReply, buildStaffMainMenu, buildStaffQueryMenu, companyPickerPage, isCapabilityQuestion, staffMenuCommand, PACKAGE_CHANGE_COMMAND, PENDING_APPROVAL_ITEM_LIMIT, RESUME_AI_COMMAND, type ApprovalSurfaceKey, type CompanyPickerItem, type PendingApprovalSnapshot, type StaffMenuContext } from '../../domain/logic/line-staff-menu.logic';
import { buildPublicPolicyCardMessage, buildAiBudgetExceededMessage, buildExpenseDraftCardMessage, buildLegalAcceptanceRequiredMessage, buildLineAssistantTextCardMessage, buildLineBusinessAnswerMessage, buildReceiptQuotaExceededMessage, buildReimbursementHandoffMessage, buildReimbursementPayerClarificationMessage, buildSignupDoorCard, buildSignupStatusCard, LIFF_ID_PATTERN, type LineExpenseDraftCardFacts } from '../../domain/logic/line-business-card.logic';
// P10-L: the LINE surface opens a package-change request and tells the operators about a support
// request; both live in the signup module, which owns those rules and their audit.
import { PackageChangeRequestUseCase } from '../../../external-signup/application/package-change-request.use-case';
import { LineSignupNotifyService } from '../../../external-signup/application/line-signup-notify.service';
import { AuthRateLimitService } from '../../../auth/application/auth-rate-limit.service';
import { isBusinessHours } from '../../../external-signup/domain/business-hours.logic';
import { SIGNUP_SOURCE_LINE_OA } from '../../../external-signup/domain/company-signup.logic';
import { advisorDirectAnswerText } from '../../domain/logic/line-advisor-direct-answer.logic';
import { capabilityFollowUpReply, capabilityHistoryIntent, isDeliveredCapabilityFollowUp, isNextStepQuestionText } from '../../domain/logic/line-ai-capability-follow-up.logic';
import { safeLineErrorDetails, parseOutcomeMessages, type LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { LINE_BUFFER_ORPHAN_REPROCESS_MS } from '../../domain/logic/line-message-buffer.logic';
import { resolveCompanyAiModelPolicy } from '../company-ai-model-policy';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../../common/logger/security-event';
import { LegalAcceptanceService } from '../../../auth/application/legal-acceptance.service';
import { expiredLineOwnerMessageTh } from '../../../system-partner-management/domain/logic/plan-term.logic';
import {
  displayReceiptQuotaLimit,
  receiptQuotaExceededShortTextTh,
  receiptQuotaExceededTextTh,
} from '../../../system-partner-management/domain/logic/receipt-quota.logic';
import { type CompanyOcrAdmissionIdentity, releaseCompanyOcrAdmission, LINE_RECEIPT_RETRY_LEASE_CODE, LINE_RECEIPT_RETRY_LEASE_MS, LINE_RECEIPT_RETRY_WAIT_CODE, claimReceiptQuotaNotice, receiptQuotaSnapshot, releaseReceiptQuotaNotice, RECEIPT_QUOTA_ERROR_CODE } from '../company-ocr-governance';
import { bangkokMonthKey } from '../company-ai-usage-meter';
import { LineHandoffLinkService } from '../line-handoff-link.service';
import { LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN } from '../../../auth/domain/logic/line-handoff.logic';
import {
  classifyLineAiGatewayFailure,
  classifyLineAiTerminalOutcome,
  emitLineAiTerminalOutcome,
  knownAiBudgetRefusal,
  terminalStatusForLineTurn,
  type LineAiTerminalMediaState,
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
  /** Set by the capture lanes only (appendix §3): the handoff surface this reply's link belongs to. */
  handoffSurface?: string;
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
// ── P10-L §7 copy. Owner-editable; no plus sign anywhere a customer reads (write "และ"). ──
/** The staff door of §3.1: the employee link is issued by the owner, never self-served. */
const EMPLOYEE_DOOR_REPLY = '👋 ยินดีต้อนรับค่ะ ถ้าคุณเป็นพนักงาน ให้เจ้าของร้านเปิดเมนู "พนักงาน" ในเว็บแอป '
  + 'แล้วส่งลิงก์เชื่อม LINE มาให้นะคะ กดลิงก์นั้นครั้งเดียวก็ใช้งานได้เลยค่ะ (ไม่ต้องสมัครร้านใหม่นะคะ)';
/** L-17: the greeting for someone the system already knows. Short on purpose — they came back. */
const WELCOME_BACK_REPLY = '👋 ยินดีต้อนรับกลับมานะคะ ส่งรูปใบเสร็จ หรือถามยอดขายในแชทนี้ได้เลยค่ะ '
  + 'ถ้าต้องการคุยกับทีมงาน พิมพ์ ติดต่อเจ้าหน้าที่ ได้เลยนะคะ';
/** The way out of a support pause, as every reply that offers one prints it: the tile's own words,
 *  tapped or typed (Owner 2026-09-06). Built from the command so the hint and the matcher cannot
 *  drift — and never "AI": the customer knows her as น้องมั่งมี. */
const RESUME_HINT = `· กดปุ่ม "${RESUME_AI_COMMAND}" หรือพิมพ์ "${RESUME_AI_COMMAND}" เมื่ออยากให้น้องมั่งมีตอบต่อ`;
/** line-support-request-spec-th §2.1.4. Carries the way out, because a 24h pause with no exit was
 *  the other half of the complaint. No plus sign anywhere a customer reads. */
const STAFF_CONTACT_REPLY = '📮 รับเรื่องแล้วค่ะ ทีมงานจะตอบในแชทนี้ในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) '
  + `หากรีบ โทร 098-256-5628 ได้เลยค่ะ ${RESUME_HINT}`;
/** §2.2.4: a second tap while the first request is still OPEN. Honest, and pages nobody twice. */
const SUPPORT_ALREADY_OPEN_REPLY = '📮 คำขอของคุณยังอยู่ในคิวค่ะ ทีมงานจะตอบในแชทนี้ในเวลาทำการ '
  + `(จันทร์–เสาร์ 9:00–18:00) นะคะ ${RESUME_HINT}`;
/** §2.4: the assistant is back, said in the assistant's own voice. */
const ASSISTANT_RESUMED_REPLY = '💚 น้องมั่งมีกลับมาแล้วค่ะ ถามได้เลยนะคะ';
/** The amplification floor's answer. Warm on purpose: whoever hits it may still genuinely need
 *  help, and the requests they already opened are in the operator inbox either way. */
const SUPPORT_DAILY_LIMIT_REPLY = '📮 วันนี้ยังเปิดคำขอคุยกับเจ้าหน้าที่เพิ่มไม่ได้ค่ะ '
  + 'หากยังต้องการความช่วยเหลือ โทร 098-256-5628 ได้เลยค่ะ';
/** Sent while a support pause is running and there is no live request to write to (§8). */
const SUPPORT_PAUSED_REPLY = '📮 ยังส่งข้อความนี้เข้าคิวทีมงานไม่สำเร็จค่ะ '
  + 'กรุณากด "ติดต่อเจ้าหน้าที่" อีกครั้ง หากยังไม่ได้ โทร 098-256-5628 ได้เลยค่ะ';
/**
 * UAT 2026-09-06. The reply above was told to a customer whose message had just been dropped on the
 * floor, which is the one thing it must never mean. This one is only ever sent once the message is
 * ON the request an operator reads, so "ส่งถึงทีมงานแล้ว" is a fact rather than a comfort.
 */
const SUPPORT_FOLLOW_UP_REPLY = '📮 ส่งข้อความถึงทีมงานแล้วค่ะ ทีมงานจะตอบกลับในแชทนี้นะคะ '
  + RESUME_HINT;
/**
 * UAT 2026-09-06 (§2.2 delta รอบ 6). The full confirmation is worth saying once; said to every line
 * of a burst it is the noise the Owner saw three times in one screen — and the menu hint least of
 * all, since the customer has just read it. The MESSAGE is still recorded every time; only the
 * speech is rationed, off the `lastMessageAt` the row already carries.
 */
const SUPPORT_FOLLOW_UP_REPEAT_REPLY = '📮 รับข้อความแล้วค่ะ';
const SUPPORT_FOLLOW_UP_REPLY_INTERVAL_MS = 10 * 60 * 1000;
const SUPPORT_FOLLOW_UP_REPLIES = {
  none: SUPPORT_PAUSED_REPLY,
  recorded: SUPPORT_FOLLOW_UP_REPLY,
  repeat: SUPPORT_FOLLOW_UP_REPEAT_REPLY,
} as const;
type SupportFollowUpOutcome = keyof typeof SUPPORT_FOLLOW_UP_REPLIES;
/** §3 PDPA: one line of context for the operator, never a transcript. */
const SUPPORT_LAST_MESSAGE_MAX_LENGTH = 200;
const PACKAGE_CHANGE_ACCEPTED_REPLY = '📦 รับคำขอแล้วค่ะ ทีมงานจะติดต่อกลับในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) นะคะ';
const PACKAGE_CHANGE_NOT_OWNER_REPLY = '📦 การเปลี่ยนแพ็กเกจต้องให้เจ้าของร้านเป็นคนขอนะคะ รบกวนแจ้งเจ้าของร้านให้พิมพ์ '
  + '"ขอเปลี่ยนแพ็กเกจ" ในแชทนี้ได้เลยค่ะ';
const PACKAGE_CHANGE_UNAVAILABLE_REPLY = '📦 ตอนนี้เปิดคำขอเปลี่ยนแพ็กเกจให้ไม่ได้ค่ะ รบกวนติดต่อทีมงานที่ 098-256-5628 นะคะ';
/** What the admin queue shows for a request that came from a chat button with no tier chosen. */
const PACKAGE_CHANGE_LINE_NOTE = 'ขอผ่าน LINE ยังไม่ได้เลือกแพ็กเกจ ทีมงานคุยกับร้านแล้วปรับได้';
const PROFILE_GUARD_ACCEPTED_REPLY = '🔐 ได้เลยค่ะ ใส่อีเมลหรือเบอร์ไว้ในหน้าตั้งค่าได้ที่ลิงก์นี้นะคะ';
const PROFILE_GUARD_LATER_REPLY = '👍 ได้ค่ะ ไว้พร้อมเมื่อไหร่พิมพ์ "ตั้งค่า" มาได้เลยนะคะ';
/** §8: 24 hours, self-expiring — nobody has to remember to switch the assistant back on. */
const SUPPORT_PAUSE_MS = 24 * 60 * 60 * 1000;
/** The states in which an application is still travelling, so the door shows status (§3.1/§5). */
const OPEN_LINE_SIGNUP_STATES = [
  'RECEIVED', 'VALIDATED', 'PENDING_REVIEW', 'PROVISIONING', 'PROVISIONING_FAILED', 'READY',
] as const;
// PDPA objection route (M-05 register §3.1): the user opted out of AI processing, so the
// turn stops here — before any model, tool, or gateway involvement. Deterministic text.
const AI_OPT_OUT_REPLY = 'คุณปิดการใช้งานผู้ช่วย AI ไว้ ข้อความนี้จึงไม่ถูกประมวลผลด้วย AI ค่ะ\nเปิดใช้งานอีกครั้งได้ที่ เว็บแอป → ตั้งค่า → ความปลอดภัย นะคะ';
export { LEGAL_ACCEPTANCE_REQUIRED_REPLY } from '../../domain/logic/line-business-card.logic';
const FORBIDDEN_REPLY = '🔒 คุณไม่มีสิทธิ์ใช้งาน LINE AI สำหรับบริษัทนี้ค่ะ';
const ERROR_REPLY = '⏳ ขออภัยค่ะ เกิดข้อผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ';
/** The bytes never arrived from LINE, so "nothing was saved" is provably true — say so, and name
 *  what to resend (a generic "ลองใหม่" left users unsure what failed). §17.1: the noun matches what
 *  the customer actually sent, so a PDF is never called a รูป (UXE-03). */
export const mediaDownloadFailedReply = (messageType: 'image' | 'file'): string => messageType === 'file'
  ? '📄 น้องยังรับไฟล์จาก LINE ไม่สำเร็จค่ะ ยังไม่ได้บันทึกรายการใด ๆ จากไฟล์นี้นะคะ รบกวนส่งไฟล์เดิมอีกครั้งค่ะ'
  : '📷 น้องยังรับรูปจาก LINE ไม่สำเร็จค่ะ ยังไม่ได้บันทึกรายการใด ๆ จากรูปนี้นะคะ รบกวนส่งรูปเดิมอีกครั้งค่ะ';
/** The media turn failed somewhere after the bytes arrived, so the record state is uncertain —
 *  no "nothing was saved" promise here; the duplicate-file warning covers an honest resend. */
class LineDeliveryError extends Error {
  constructor(result: LineDeliveryResult) { super(`LINE_DELIVERY_${result.toUpperCase()}`); }
}
const SAVED_LINE_RECEIPT = Symbol('saved-line-receipt');
type SavedLineReceipt = { expenseId: string; companyId: string; uploaded: boolean };
type LineReceiptAdmissionAttempt = { identity?: CompanyOcrAdmissionIdentity; companyId?: string; receiptRequested: boolean; usablePersisted: boolean };

export const mediaProcessingFailedReply = (messageType: 'image' | 'file'): string => messageType === 'file'
  ? '📄 ขออภัยค่ะ ระบบประมวลผลไฟล์นี้ไม่สำเร็จ รบกวนส่งไฟล์เดิมอีกครั้งนะคะ ถ้าไฟล์นี้เคยบันทึกไว้แล้ว ระบบจะแจ้งเตือนรายการซ้ำให้ค่ะ'
  : '📷 ขออภัยค่ะ ระบบประมวลผลรูปนี้ไม่สำเร็จ รบกวนส่งรูปเดิมอีกครั้งนะคะ ถ้ารูปนี้เคยบันทึกไว้แล้ว ระบบจะแจ้งเตือนรายการซ้ำให้ค่ะ';
const RATE_LIMIT_REPLY = '⏳ ระบบกำลังประมวลผลข้อความก่อนหน้า กรุณารอสักครู่แล้วลองใหม่อีกครั้งนะคะ';
/** Spec §9.1 `AI_BUDGET_UNAVAILABLE`: the meter could not be READ. It is not the budget card (we do
 *  not know that the budget is full) and not the generic error (nothing broke on the customer's
 *  side). Deterministic, no model call, no money figure, no company configuration. */
const AI_BUDGET_UNAVAILABLE_REPLY = '⏳ ตอนนี้ยังตรวจสอบเครดิต AI ของร้านไม่ได้ค่ะ น้องมั่งมีเลยยังไม่เริ่มงานให้ '
  + 'รบกวนลองใหม่อีกครั้งในอีกสักครู่นะคะ ระหว่างนี้ใช้งานผ่านเว็บแอปได้ตามปกติค่ะ';
/** Post-OCR branch ambiguity (multi-branch company, no defaultable head office): the read
 *  succeeded, only the branch decision is missing — send the user to the web picker honestly.
 *  Says "เอกสาร", not "ใบเสร็จ": the same refusal now answers the check-bill lane, where calling
 *  the document a receipt is exactly the claim the whole question exists to avoid. Cause and fix
 *  only — how to get back in differs by lane, so the caller appends one of the tails below. */
const RECEIPT_BRANCH_REQUIRED_REPLY = '🧾 อ่านเอกสารได้แล้วค่ะ แต่บริษัทมีหลายสาขาและน้องเลือกให้เองไม่ได้ '
  + 'จึงยังไม่ได้บันทึกรายการนะคะ\nรบกวนบันทึกผ่านเว็บแอปแล้วเลือกสาขา หรือให้ผู้ดูแลตั้งสาขาประจำตัวให้คุณ';
/** DIRECT photo lane: the refusal happens before any byte is stored, so re-sending the picture is
 *  genuinely the way back in. */
const BRANCH_RETRY_RESEND = '\nแล้วส่งรูปเดิมเข้ามาใหม่ได้เลยค่ะ';
/** PENDING-MEDIA lane: the bytes are still parked on a PENDING row, and `ensurePendingMedia` answers
 *  ANY new image with `{ created: false }` while that row lives (`PENDING_MEDIA_TTL_MINUTES`) — a
 *  re-send is silently swallowed and logged `duplicate_media_pending`. Telling this sender to send
 *  the photo again would be the same kind of lie the transient copy was: answering the open question
 *  a second time is what actually works. */
const BRANCH_RETRY_ANSWER = '\nไฟล์เดิมยังเก็บไว้ให้อยู่ แล้วตอบข้อความเดิมอีกครั้งได้เลยค่ะ';
/**
 * The deterministic half of a capture failure. These codes describe a DATA state — the company's
 * branches, or this member's assignment — so the next attempt reproduces them byte for byte, and
 * `ERROR_REPLY`'s "ชั่วคราว … ลองใหม่" is simply false (UAT 2026-09-05: the same check bill answered
 * "1" twice, the same refusal twice, both dressed as temporary). Anything not listed here stays
 * unknown, keeps the transient copy, and keeps its retry.
 *
 * One map for every LINE capture lane, so the pending-media answer and the direct photo cannot
 * disagree about what a branch refusal means or which terminal status it records. `tail` is required
 * rather than defaulted: the two lanes recover differently, and a forgotten tail would silently ship
 * the wrong instruction — the exact defect this argument exists to prevent.
 */
export function lineCaptureFailureReply(
  error: unknown,
  tail: string,
): { reply: string; status: string; errorCode: string } | undefined {
  const code = error instanceof HttpException
    ? (error.getResponse() as { code?: string } | undefined)?.code
    : undefined;
  if (code === 'TRANSACTION_BRANCH_REQUIRED' || code === 'TRANSACTION_BRANCH_INVALID') {
    return {
      reply: `${RECEIPT_BRANCH_REQUIRED_REPLY}${tail}`,
      status: 'clarification_required',
      errorCode: 'RECEIPT_BRANCH_SELECTION_REQUIRED',
    };
  }
  return undefined;
}
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
/**
 * Owner 2026-09-06: "ร้านที่ปิดฟีเจอร์ แล้วเอไอตอบ ฟีเจอร์ยังไม่เปิดใช้งาน โอเค อันนี้ได้ แต่ถ้าบอกให้
 * สอนวิธีใช้ ในขอบเขตที่เปิดใช้งานควรบอกได้" — closes the §8.2 residual PR #454 left open. When the AI
 * lane refuses (never bought, or the kill switch is pulled) a capability question is still owed the
 * scope the shop DOES have, so each gate KEEPS its own refusal line (spec CC1: a planned CLOSE must
 * never read as "not enabled") and appends the same deterministic card the "บริการของเรา" tile
 * renders from the same `entitledFeatureKeys`. Zero model calls, and it can name nothing this company
 * has not switched on. The note names only the two tiles that sit ABOVE the AI gate — `เมนูหลัก`
 * itself is below it and would answer `feature_disabled`.
 */
const CAPABILITY_ENTITLEMENT_NOTE = '💡 ปุ่ม “บริการของเรา” และ “ติดต่อเรา” ในแชทนี้ยังกดได้ตามปกตินะคะ';
/** `staff_menu_` prefix on purpose: `classifyLineAiTerminalOutcome` reads it as `delivered`, which
 *  this turn is — a distinct status so it can still be counted apart from a bare refusal. */
const CAPABILITY_ENTITLEMENT_STATUS = 'staff_menu_capability_entitlements';
const capabilityEntitlementReply = (lead: string, entitled: ReadonlySet<string> | null): LineReplyMessage[] =>
  [{ type: 'text', text: `${lead}\n${CAPABILITY_ENTITLEMENT_NOTE}` }, buildServiceEntitlementMessage(entitled)];
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
  // §9.2: the company's AI MONEY closed the read. The picture IS kept (this branch only runs once
  // `ensurePendingMedia` has a row), nothing was recorded, and no automatic retry is promised. The
  // old wording — "ระบบอ่านเอกสารขัดข้องชั่วคราว" — was a false outage story for a policy decision.
  const budgetReason = aiBudgetReasonTh(errorCode);
  if (budgetReason) {
    return `${isDocumentReadingCreditSpent(errorCode) ? '💚' : '⏳'} รับรูปไว้แล้วค่ะ แต่${budgetReason} `
      + `จึงยังไม่ได้อ่านและยังไม่ได้บันทึกรายการค่าใช้จ่ายนะคะ\n\n${MEDIA_CLARIFY_REPLY}`;
  }
  const notice = errorCode === 'OCR_FEATURE_DISABLED'
    ? 'บริษัทปิดการอ่านเอกสารด้วย AI ไว้ค่ะ ระบบยังเก็บไฟล์นี้ไว้ได้ แต่จะไม่อ่านข้อมูลให้อัตโนมัติ'
    : errorCode === 'OCR_REQUEST_ALREADY_ADMITTED'
      ? '✅ ระบบรับคำขออ่านเอกสารนี้ไว้แล้วค่ะ เพื่อป้องกันการนับซ้ำ จึงไม่ส่งอ่านซ้ำ'
      : readFailed
        ? '📷 น้องอ่านรูปนี้ไม่สำเร็จค่ะ ระบบอ่านเอกสารขัดข้องชั่วคราว รูปยังเก็บไว้ให้และยังไม่ได้บันทึกรายการนะคะ'
        : null;
  return notice ? `${notice}\n\n${MEDIA_CLARIFY_REPLY}` : MEDIA_CLARIFY_REPLY;
}
/**
 * The REASON half of a document-reading refusal on the image lane — and nothing else. Kept separate
 * from any claim about the picture so the "kept it" and the "could not keep it" replies can never
 * disagree about why the read stopped.
 *
 * Credit-wording spec §4 (owner decision 2, 2026-09-18): the customer gets ONE sentence for every
 * ceiling that stops a document read — the OCR money share, TOTAL money met on this lane, a
 * shortfall against this read's bound, and the monthly read COUNT. Splitting chat from OCR is what
 * made that honest: on this lane there is nothing left to read documents with, whichever ceiling
 * closed first, and the shop cannot act on the difference. What stays separate is the pair the shop
 * CAN act on: "we could not check" (retry) and "an earlier job is still running" (wait).
 *
 * Internally nothing merges — code, `budgetScope`, terminal class, the read-count refund
 * (`isOcrPreProviderRefusal`) and reservation behaviour are untouched (§9.1 of the ledger spec still
 * keeps exceeded/insufficient/busy/unavailable distinct end to end).
 */
function aiBudgetReasonTh(errorCode?: string): string | null {
  return errorCode === AI_BUDGET_REFUSAL_CODES.exceeded
      || errorCode === AI_BUDGET_REFUSAL_CODES.insufficient
      || errorCode === 'OCR_MONTHLY_LIMIT_EXCEEDED' ? 'เครดิตสำหรับการอ่านเอกสารไม่พอ'
    : errorCode === AI_BUDGET_REFUSAL_CODES.unavailable
      || errorCode === 'OCR_QUOTA_UNAVAILABLE' ? 'ตอนนี้ยังตรวจสอบเครดิต AI ของร้านไม่ได้'
    : errorCode === AI_BUDGET_REFUSAL_CODES.busy ? 'ระบบกำลังประมวลผลงานก่อนหน้าอยู่'
    : null;
}
/** 💚 ("not this month") vs ⏳ ("try again shortly") for the reasons above. The read COUNT ceiling is
 *  as permanent as the money ones, so it cannot ride `isAiBudgetPermanentRefusal`, which answers for
 *  the money codes only and must keep doing exactly that everywhere else. */
const isDocumentReadingCreditSpent = (errorCode?: string): boolean =>
  isAiBudgetPermanentRefusal(errorCode) || errorCode === 'OCR_MONTHLY_LIMIT_EXCEEDED';

/**
 * §9.2/B-04: the money gate closed the read AND this picture was NOT kept. Three different ways that
 * happens, one money reason, and never a retention claim or a retry promise:
 *
 * - `save_failed` — parking the bytes threw. Re-sending later is genuinely the way back in.
 * - `open_question` — the sender already has one picture waiting for its numbered answer, and
 *   `ensurePendingMedia` answers a DIFFERENT picture with that open row BEFORE storing anything
 *   (its one-question-at-a-time design). With the budget closed every photo lands there, so the
 *   silence that lane relies on would swallow a whole stack of receipts. Answering the open
 *   question is what actually works — re-sending is swallowed again.
 * - `no_permission` — a reference-only route reached the OCR hop without capture permission, so no
 *   file may be parked and "1) record as receipt" is not an offer this user can accept.
 */
export function formatBudgetMediaNotStoredReply(
  errorCode: string | undefined,
  kind: 'save_failed' | 'open_question' | 'no_permission',
): string {
  const reason = aiBudgetReasonTh(errorCode) ?? 'เครดิตสำหรับการอ่านเอกสารไม่พอ';
  const tail = kind === 'save_failed'
    ? 'และระบบยังเก็บรูปนี้ไว้ไม่สำเร็จค่ะ จึงยังไม่ได้บันทึกรายการใด ๆ นะคะ รบกวนบันทึกผ่านเว็บแอป หรือส่งรูปเข้ามาใหม่อีกครั้งภายหลังค่ะ'
    : kind === 'open_question'
      ? 'และยังมีรูปก่อนหน้าที่รอคำตอบอยู่ค่ะ รูปนี้จึงยังไม่ได้เก็บไว้และยังไม่ได้บันทึกรายการนะคะ '
        + 'รบกวนตอบคำถามของรูปก่อนหน้าให้เสร็จก่อน หรือบันทึกรายการผ่านเว็บแอปได้เลยค่ะ'
      : 'จึงยังไม่ได้อ่านรูปนี้ และยังไม่ได้เก็บหรือบันทึกรายการใด ๆ ค่ะ';
  return `⚠️ ${reason} ${tail}`;
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

/** The §17.5 ambiguity list, bound to the next turn through its own row (`targetId` = the refs). */
export const FILE_ATTEMPT_SELECT_REASON = 'file_attempt_select';

/**
 * §18.4 NR04/NR05 on the EXPENSE path: the record already exists, so this is a lead-in that names
 * the document kind — never a refusal, and never the "ยังไม่ได้สร้างรายการ" wording §18.4 reserves
 * for a lane with no expense. NR04's amount is printed only when the reader actually read one.
 */
export function expensePathNonReceiptLead(
  classification: BusinessDocumentClassification | null,
  grandTotalAmount?: string,
): string | null {
  const nr = classifyNonReceiptCase(classification);
  if (nr !== 'NR04' && nr !== 'NR05_SLIP' && nr !== 'NR05_ORDER') return null;
  const amount = Number(grandTotalAmount);
  return nonReceiptReply(nr, {
    classification,
    ...(nr === 'NR04' && grandTotalAmount && Number.isFinite(amount) && amount > 0 ? { amountLabel: moneyLabel(grandTotalAmount) } : {}),
  });
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
const LINE_MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000;

type ReceiptOcrPreflight = {
  status: 'OCR_EXTRACTED_NEEDS_REVIEW' | 'NOT_CONFIGURED' | 'OCR_FAILED' | 'NOT_REQUESTED';
  fields: ReceiptOcrFieldResult | null;
  classification: BusinessDocumentClassification | null;
  /** Gateway reason for a failed read (OCR_EMPTY_OUTPUT, PROVIDER_TIMEOUT, …). Absent when the
   *  gateway call itself threw AND the throw was not one of our own money refusals (spec §9.1). */
  errorCode?: string;
  /** Present only alongside a money `errorCode`, and only when the gate reported it. */
  budgetScope?: AiBudgetScope;
};

type DownloadedLineMedia = {
  fileName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256?: string;
  contentBase64?: string;
  bytes: Buffer;
};

/**
 * §17.5 / IG20: why the bytes never arrived, kept typed all the way to the `LineIntakeAttempt` row.
 * These strings ARE the attempt's `reasonCode` — no second vocabulary to drift out of sync with.
 */
export type LineMediaDownloadReason =
  | 'credentials_unavailable' | 'oversize_declared' | 'oversize_measured'
  | 'download_http' | 'download_timeout' | 'download_failed';

export type LineMediaDownloadResult =
  | { ok: true; media: DownloadedLineMedia }
  | {
    ok: false;
    reason: LineMediaDownloadReason;
    declaredFileSize?: number;
    measuredByteSize?: number;
    httpStatus?: number;
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

/**
 * Spec §18.4 NR01–NR08, with today's copy kept for the rows §18.4 does not describe.
 *
 * The NR table is consulted FIRST because its whole purpose is that the customer is told which
 * document they actually sent: the old merged "ใบเสนอราคา/ใบสั่งซื้อ/ใบส่งของ" line named three
 * kinds and confirmed none, and a courier parcel label — the most common shipping document there
 * is — had no sentence at all. `captureLink` is passed ONLY by a caller that has already persisted
 * the bytes, so the CTA can never appear over a file that was not kept (§18.4) — and since appendix
 * §25 that link is an expense DRAFT, which the sentence must say rather than contradict.
 */
export function formatBusinessDocumentReply(
  classification: BusinessDocumentClassification | null,
  webBaseUrl: string | undefined,
  companyId: string,
  options: { captureLink?: string; amountLabel?: string } = {},
): string {
  if (!classification) return MEDIA_CLARIFY_REPLY;
  if (classification.contentKind === 'MULTI_DOCUMENT') return '📄 พบเอกสารมากกว่า 1 ฉบับในภาพ กรุณาถ่ายแยกเอกสารละ 1 ภาพ เพื่อไม่ให้ยอดหรือร้านค้าถูกรวมผิดค่ะ';
  if (classification.contentKind === 'UNREADABLE') return '📷 ยังอ่านเอกสารนี้ได้ไม่ชัด กรุณาถ่ายใหม่ให้เห็นทั้งใบ ภาพตรง ไม่เบลอ และไม่มีแสงสะท้อนค่ะ';
  const nr = classifyNonReceiptCase(classification);
  // NR06 stays with the check-bill continuation, which owns its three payment choices.
  if (nr && nr !== 'NR06') {
    return nonReceiptReply(nr, {
      classification,
      ...(options.amountLabel ? { amountLabel: options.amountLabel } : {}),
      ...(options.captureLink && NON_RECEIPT_PERSISTING_CASES.includes(nr)
        ? { captureLink: options.captureLink, capturedDraft: true } : {}),
    });
  }
  switch (classification.documentKind) {
    case 'ORDER_OR_CHECK_BILL':
      return classification.missingRequiredSignals.includes('MISSING_MONETARY_AMOUNT')
        || classification.missingRequiredSignals.includes('MISSING_TRANSACTION_TOTAL')
        ? '🧾 เอกสารนี้เป็นรายการสั่งซื้อ/เช็กบิล แต่ยังไม่พบยอดเงินรวม จึงยังไม่บันทึกเป็นค่าใช้จ่าย กรุณาส่งบิลหรือใบเสร็จฉบับสุดท้ายที่มีจำนวนเงินค่ะ'
        : '🧾 เอกสารนี้เป็นรายการสั่งซื้อ/เช็กบิลที่ยังไม่ยืนยันการรับชำระ จึงไม่จัดเป็นใบเสร็จ กรุณาส่งใบเสร็จฉบับสุดท้าย หรือระบุให้บันทึกเป็นบิลค้างชำระค่ะ';
    case 'APPOINTMENT_CARD':
    case 'BOOKING_CONFIRMATION':
    case 'RESERVATION_CONFIRMATION':
      return `📅 พบเอกสารนัดหมาย/การจอง จึงไม่สร้างร่างค่าใช้จ่ายหรือยืนยันการจองอัตโนมัติ\nตรวจสอบการจองในเว็บ: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/bookings`)}`;
    // NON_FINANCIAL_IMAGE, the commercial kinds, the invoice, the slip and NEEDS_REVIEW are all
    // answered by the NR table above; only kinds §18.4 does not describe reach this switch.
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

/** Spec §5.1: `charges` are the rows the apply WROTE on this draft, listed by the same helper and the
 *  same label constant as the receipt capture card — a gratuity the check-bill lane recorded used to
 *  go unmentioned here because this reply never saw the apply outcome at all (F6). */
export function formatCheckBillDraftCreatedReply(
  continuation: Pick<LineSubstituteReceiptContinuationResult, 'status' | 'replyText' | 'pendingQuestion'>,
  charges: readonly ExpenseChargeSummary[] = [],
): string {
  const chargeBlock = chargeSummaryLines(charges);
  const hardFailure = ['FORBIDDEN', 'INELIGIBLE', 'STALE'].includes(continuation.status);
  if (hardFailure || !continuation.pendingQuestion) {
    return `✅ สร้างร่างค่าใช้จ่าย 1 รายการแล้วค่ะ\n\n${continuation.replyText}`;
  }
  return [
    '✅ สร้างร่างค่าใช้จ่าย 1 รายการแล้วค่ะ',
    'เก็บเช็กบิลใบเดิมเป็นหลักฐานประกอบ และไม่สร้างรายการซ้ำ',
    ...(chargeBlock.length > 0 ? ['', ...chargeBlock] : []),
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

/** Preserve the complete customer reply and action if LINE rejects a Flex body. */
export function toCanonicalTextMessages(messages: LineReplyMessage[]): LineReplyMessage[] {
  return messages.map((message) => (message.type === 'flex'
    ? {
        type: 'text' as const,
        text: message.canonicalText ?? message.altText,
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
    const url = absoluteWebLink(webBaseUrl, firstLink.path);
    // `absoluteWebLink` returns the path unchanged when no base URL is configured, and a bare
    // "/companies/…" in a LINE message is not a link — it is a string nobody can open. Say the
    // words instead; the reply is still true, it just stops pretending to be actionable.
    lines.push(/^https?:\/\//i.test(url) ? `เปิดดู: ${firstLink.label} ${url}` : `เปิดเว็บมั่งมีพลัส: ${firstLink.label}`);
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
  // `unsupported_yet` maps here too: the Prisma `AiTurnIntent` enum has no member for it, and the
  // split that matters — what the customer was told — lives on the refusal reason and the terminal
  // status, not on this analytics-side intent.
  if (refusalReason === 'feature_disabled' || refusalReason === 'unsupported_module' || refusalReason === 'unsupported_yet') return 'UNSUPPORTED_MODULE';
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

/**
 * The role KEY, never the label: `companyRoleLabels` above renders `role.name`, which a company can
 * rename to anything. `'OWNER'` is the same key the owner-only reads in this file already use
 * (`access.roles.includes('OWNER')`, and the `roles: { some: { role: { key: 'OWNER' } } }` filters),
 * and it is scoped to the ONE membership the card is about — being an owner elsewhere does not make
 * this an owner's view of this company.
 */
function isCompanyOwner(membership: LineCompanyMembership): boolean {
  return (membership.roles ?? []).some((item) => item.role?.key === 'OWNER');
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
  // `periods` counts too (period-resolution spec §3.1): "ยอดขายเดือนที่แล้ว" carries no amount and no
  // explicit date, so dropping the payload here would leave the gateway with nothing to select from and
  // the answer back on the tool default. A turn with none of the three still sends nothing.
  return candidates.amounts.length > 0 || candidates.dates.length > 0 || (candidates.periods?.length ?? 0) > 0
    ? candidates
    : undefined;
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

function moneyLabel(value: string): string {
  const amount = Number(toMoney4(value));
  return Number.isFinite(amount)
    ? amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value;
}

/** Spec §5.1: products and additional charges are two different things on a bill, and a card that
 *  prints "service charge 10%" among the food reads as if the shop sold a dish by that name (UAT
 *  2026-09-03). The charges are the rows the record actually CARRIES — `expenseLineCharges` over the
 *  persisted `chargeKind` column, the same derivation the web summary and the S-3 read tool use. */
function receiptItemLines(
  fields: ReceiptOcrFieldResult | null | undefined,
  charges: readonly ExpenseChargeSummary[] = [],
): string[] {
  const items = (fields?.lines ?? []).slice(0, 10)
    .map((line) => `• ${line.description} × ${line.quantity} – ${moneyLabel(line.amount)}`);
  return [...items, ...chargeSummaryLines(charges)];
}

/** Spec §5.1: the charge block, in one place, so the receipt card and the check-bill reply cannot
 *  drift apart. `label` already comes from `EXPENSE_LINE_CHARGE_KIND_LABELS` via `expenseLineCharges`
 *  — never from model prose. Empty for a record with no charge rows: no heading, no block. */
function chargeSummaryLines(charges: readonly ExpenseChargeSummary[]): string[] {
  if (charges.length === 0) return [];
  const additional = charges.filter((charge) => charge.kind !== 'ROUNDING');
  const rounding = charges.filter((charge) => charge.kind === 'ROUNDING');
  const total = additional.reduce((sum, charge) => sum + Number(toMoney4(charge.amount)), 0);
  return [
    ...(additional.length ? [
      `➕ ค่าใช้จ่ายเพิ่ม (${additional.length} รายการ รวม ${total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}):`,
      ...additional.slice(0, 10).map((charge) => `• ${charge.label} – ${moneyLabel(charge.amount)}`),
    ] : []),
    ...rounding.slice(0, 10).map((charge) => `• ปรับยอดปัดเศษ – ${moneyLabel(charge.amount)} บาท`),
  ];
}

/** The apply outcomes that really did fold the document's charges into one summary line. A rerun
 *  that PRESERVED reviewed lines, and one skipped as stale, wrote no lines at all — they report
 *  `SUMMARY_LINE`, and saying "ยังรวมอยู่ในยอดเดียว" for them describes an apply that never ran over
 *  a record that may well carry a real charge row (F5). */
const FOLDED_CHARGE_STATUSES = ['FOLDED_INTO_SUMMARY_NEEDS_REVIEW', 'ITEMS_DID_NOT_RECONCILE'];

/**
 * Spec §5.2. Four states, not two — and keying the copy on whether a date STRING is present (which
 * is what "ยังไม่ระบุ or the date" did) gets three of them wrong: the upload-day placeholder is a
 * present string, so is a misread 2019 date, and so is a reading that only works because the reader
 * chose the วัน/เดือน order. All three printed as plain fact. The status comes from the apply
 * service's own review, never from the presence of a value.
 */
export function receiptCardDateLine(
  expenseDate: string | undefined,
  status: ExpenseDocumentDateStatus,
): string {
  const printed = formatReplyDate(expenseDate);
  if (status === 'unverified' || !printed) {
    // Both halves: true about the reading AND about the record. UAT 2026-09-03 stored today's date
    // on a bill printing 03/09/69 and the sender had no way to know, nor to fix it from the chat.
    return 'ยังอ่านวันที่ไม่ได้ ใช้วันที่ส่งไว้ก่อน';
  }
  if (status === 'implausible') return `${printed} (ผิดปกติ ตรวจในเว็บ)`;
  if (status === 'assumed') return `${printed} (อ่านจากบิล แบบ วัน/เดือน)`;
  return printed;
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

export function formatPaypersReply(
  webBaseUrl: string | undefined,
  companyId: string,
  expenseId: string,
  options: { acceptedAmounts?: ReceiptOcrApplyOutcome['acceptedAmounts']; hasDuplicate?: boolean; textOnly?: boolean; compact?: boolean; amount?: string | null; fields?: ReceiptOcrFieldResult | null; charges?: readonly ExpenseChargeSummary[]; chargeReconciliation?: { status: string; chargesApplied: number }; categoryName?: string | null; sourceDocumentType?: string | null; questionText?: string; dateStatus?: ExpenseDocumentDateStatus } = {},
): string {
  const link = absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`);
  const amountValue = options.acceptedAmounts?.grandTotalAmount ?? options.fields?.grandTotalAmount ?? options.amount;
  const amount = amountValue && Number(toMoney4(amountValue)) > 0 ? Number(toMoney4(amountValue)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'ยังไม่ระบุ';
  const docType = options.sourceDocumentType ? SOURCE_DOC_TYPE_REPLY_LABELS[options.sourceDocumentType] : undefined;
  const moneyLabel = (value: string) => Number(toMoney4(value)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const vatValue = options.acceptedAmounts?.vatAmount ?? options.fields?.vatAmount;
  const vatMode = options.acceptedAmounts?.vatMode ?? options.fields?.vatMode;
  const whtValue = options.acceptedAmounts?.whtAmount ?? options.fields?.whtAmount;
  const parts = options.compact ? [
    '🧾 เก็บรูปและร่างแล้วค่ะ',
    ...(docType && options.sourceDocumentType !== 'RECEIPT' ? [`เอกสาร: ${docType}`] : []),
    ...(options.fields?.vendorName ? [`ร้าน: ${options.fields.vendorName}`] : []),
    `ยอดในใบเสร็จ: ${amount === 'ยังไม่ระบุ' ? 'ยังอ่านยอดไม่ได้' : `${amount}${options.fields?.currency && options.fields.currency !== 'THB' ? ` ${options.fields.currency}` : ' บาท'}`}`,
    `วันที่: ${!options.fields?.expenseDate ? 'ยังอ่านวันที่ไม่ได้ ใช้วันที่ส่งไว้ก่อน' : options.dateStatus === 'unverified' ? 'ยังรอตรวจสอบ' : receiptCardDateLine(options.fields.expenseDate, options.dateStatus ?? 'verified')}`,
    'ยังไม่ยืนยันรายการ',
  ] : [
    '🧾 บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว (รอตรวจสอบ)',
    '',
    '📋 ข้อมูลที่อ่านได้ตอนนี้:',
    `• ผู้ขาย/ผู้รับเงิน – ${options.fields?.vendorName ?? 'ยังไม่ระบุ'}`,
    `• ยอดรวม – ${amount}`,
    `• ประเภทเอกสาร – ${docType ?? 'รอตรวจสอบ'}`,
    `• วันที่เอกสาร – ${receiptCardDateLine(options.fields?.expenseDate, options.dateStatus ?? (options.fields?.expenseDate ? 'verified' : 'unverified'))}`,
    `• หมวดหมู่ค่าใช้จ่าย – ${options.categoryName ?? 'ยังไม่ระบุ'}`,
    ...(vatMode !== 'NO_VAT' && vatMode !== 'EXEMPT' && vatValue && Number(toMoney4(vatValue)) > 0
      ? [`• VAT – ${moneyLabel(vatValue)} บาท`] : []),
    ...(whtValue && Number(toMoney4(whtValue)) > 0 ? [`• WHT – ${moneyLabel(whtValue)} บาท`] : []),
  ];
  // Journey J1 step 1: additional charges belong on the DEFAULT card, not only when the sender
  // happens to ask what was on the bill. A service charge is money the shop added — the row a
  // reviewer questions first — and folding it into "ยอดรวม" is how the BHC 152.00 went unseen.
  //
  // UAT 2026-09-06: this read the OCR `additionalCharges` SUGGESTION, so three cards listed a
  // ค่าบริการ that the apply had folded away and the record never carried. One source of truth: the
  // rows the apply persisted. When it folded them, the card says exactly that instead.
  const charges = options.charges ?? [];
  // …and the fold is a claim about what THIS apply did with the lines it wrote, so it needs the
  // outcome that says so. Without one — a follow-up card, a redelivery — nothing is claimed (F5).
  const folded = options.chargeReconciliation?.chargesApplied === 0
    && FOLDED_CHARGE_STATUSES.includes(options.chargeReconciliation.status)
    ? options.fields?.additionalCharges ?? []
    : [];
  // Automatic summaries show one service-charge total. Rounding stays in the web review and
  // explicit item answers; it must not look like another purchase or reduce the service total.
  const additionalTotal = charges.filter((charge) => charge.kind !== 'ROUNDING')
    .reduce((sum, charge) => sum + Number(toMoney4(charge.amount)), 0);
  if (additionalTotal !== 0) parts.push(`• ค่าบริการอื่นๆ – ${moneyLabel(String(additionalTotal))} บาท`);
  else if (charges.length === 0) {
    const foldedAdditional = folded.filter((charge) => charge.kind !== 'ROUNDING');
    const foldedTotal = foldedAdditional.reduce((sum, charge) => sum + Number(toMoney4(charge.amount)), 0);
    if (foldedTotal !== 0) parts.push(`• ค่าบริการอื่นๆ – ${moneyLabel(String(foldedTotal))} บาท (รวมอยู่ในยอดเดียว รอตรวจสอบในเว็บ)`);
  }
  if (options.questionText && isReceiptItemQuestion(options.questionText)) {
    const itemLines = receiptItemLines(options.fields, charges);
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
  // The total printed above is the DOCUMENT's own figure and nothing converted it, so a non-baht
  // document must say so here too (UAT 2026-08-29: $200.00 USD was recorded as 200 บาท). THB and an
  // unread currency push nothing and keep this reply byte-identical.
  if (options.fields?.currency && options.fields.currency !== 'THB') {
    parts.push('', `⚠️ เอกสารนี้เป็นสกุลเงิน ${options.fields.currency} – ยอดที่อ่านได้อาจไม่ใช่จำนวนเงินบาท กรุณาตรวจและแก้ยอดเป็นเงินบาทก่อนบันทึก`);
  }
  parts.push('', `${options.compact ? 'เปิดดูรายการ' : '✅ ตรวจสอบและยืนยันในเว็บแอป'}:\n${link}`);
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
    // The stored record already carries its charge rows, derived once by `expenseLineCharges`.
    const items = receiptItemLines(fields, expense.charges);
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
/** Guidance reasons whose cause the customer can act on. Anything else keeps the generic copy —
 *  an internal reason string must never leak into a reply. */
const CORRECTION_GUIDANCE_REASON_LINES: Record<string, string> = {
  empty_note: '📝 ไม่พบข้อความหมายเหตุในข้อความนี้ค่ะ จึงยังไม่ได้บันทึกอะไรไว้',
};

export function formatCorrectionGuidanceReply(
  webBaseUrl: string | undefined,
  companyId: string,
  candidates: LineIntakeCorrectionCandidate[],
  canEdit: boolean,
  reason?: string,
): string {
  const listLink = absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses`);
  const action = canEdit ? 'เปิดแก้ไขในเว็บแอป' : 'เปิดตรวจสอบ และส่งต่อผู้มีสิทธิ์แก้ไข';
  const named = reason ? CORRECTION_GUIDANCE_REASON_LINES[reason] : undefined;
  if (named && candidates.length === 1) {
    return [named, '', `รายการล่าสุด: ${candidates[0].label}`, `${action}:`,
      absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${candidates[0].id}`)].join('\n');
  }
  if (named) return [named, `${action}: ${listLink}`].join('\n');
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

/**
 * Spec §5.3: money this lane cannot touch. A service charge, a VAT figure or the total of an
 * itemised bill needs the draft-edit tools (slice S-4). Until those exist the honest answer is that
 * the amounts were NOT changed, and where they can be — UAT 2026-09-03: "จากบิลเมื่อกี้มี service
 * charge 10% นะ แก้ไขได้ใช่ไหม" was answered "แก้ไขรายการเดิมให้แล้ว" after writing one sentence
 * into `note`, and the owner had every reason to believe the bill now carried the 152.00.
 */
export function mentionsUnchangeableMoney(text: string): boolean {
  return /ค่าบริการ|เซอร์วิส|service\s*charge|vat|ภาษี|ค่าส่ง|ค่าจัดส่ง|ค่าธรรมเนียม|ทิป|ส่วนลด|ยอด|ราคา|บาท/iu
    .test(normalizeLineText(text));
}

/** Confirmation names exactly what changed per field — and, for the note, that a note is all that
 *  changed. Nothing here may describe a write the lane did not make. */
export function formatCorrectionAppliedReply(
  webBaseUrl: string | undefined,
  companyId: string,
  expenseId: string,
  fields: Record<string, { from: string | null; to: string }>,
  messageText = '',
  noteOutcome?: 'truncated' | 'duplicate',
): string {
  const link = absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`);
  const changed = Object.keys(fields);
  const noteOnly = changed.length > 0 && changed.every((field) => field === 'note');
  const changes = Object.entries(fields).map(([field, change]) => {
    const label = CORRECTION_FIELD_LABELS[field] ?? field;
    if (field === 'note') {
      // Spec §5.3: say what the write DID. "บันทึกหมายเหตุไว้" over a note that filled up, or over
      // a sentence already sitting at the end of it, is the same class of lie the header was.
      if (noteOutcome === 'duplicate') return `• หมายเหตุนี้บันทึกไว้อยู่แล้ว: ${change.to}`;
      if (noteOutcome === 'truncated') return `• บันทึกหมายเหตุไว้ (ตัดบางส่วน): ${change.to}`;
      return `• บันทึกหมายเหตุไว้: ${change.to}`;
    }
    const from = field === 'expenseDate' ? formatReplyDate(change.from ?? undefined) : change.from;
    const to = field === 'expenseDate' ? formatReplyDate(change.to) : change.to;
    return `• เปลี่ยน${label} จาก ${from ?? 'ยังไม่ระบุ'} เป็น ${to}`;
  });
  return [
    noteOnly
      ? '📝 บันทึกหมายเหตุไว้ให้แล้วค่ะ (ยังไม่ได้แก้ตัวเลขในรายการ)'
      : '✅ แก้ไขรายการเดิมให้แล้ว (ไม่ได้สร้างรายการใหม่)',
    '',
    ...changes,
    // Only when the lane did not in fact change an amount — a message that asked for a total and got
    // one needs no caveat.
    ...(noteOutcome === 'truncated' ? ['', 'หมายเหตุใกล้เต็ม แก้เพิ่มในเว็บได้เลยค่ะ'] : []),
    ...(!fields['amount'] && mentionsUnchangeableMoney(messageText)
      ? ['', 'ยังไม่ได้แก้ยอด ค่าบริการ หรือ VAT ให้นะคะ — แก้ตัวเลขเหล่านี้ได้ในเว็บค่ะ']
      : []),
    '',
    `ตรวจสอบในเว็บแอป:\n${link}`,
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
// Exported so a signup spec can assert the chat lands on the NEW shop after a LINE identity is
// re-pointed, against this resolver rather than a copy of it.
export async function resolveCompanyForLineUser(
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

  // Expiry/revocation of selected B must never send the next message into the remaining ACTIVE A.
  const ctx = await prisma.client.lineCompanyContext.findUnique({
    where: { lineUserId },
    select: { companyId: true },
  });
  if (!ctx) return memberships.length === 1 ? { companyId: memberships[0].companyId } : { needsSelection: true };

  // Verify the selected company is still in the user's active memberships
  const isValid = memberships.some((m) => m.companyId === ctx.companyId);
  if (!isValid) return null;

  return { companyId: ctx.companyId };
}

/** P29: a company disabled by the plan-term sweep drops out of `resolveCompanyForLineUser` above —
 *  that query takes ACTIVE companies only — so everyone in it currently lands on the generic
 *  unlinked reply. Owner locked a better answer for the one person who can act on it (spec §renew:
 *  "ตอบสุภาพ ชวนติดต่อ ยืนยัน แจ้งเฉพาะ OWNER"); staff keep the generic reply and see no package
 *  detail, exactly as the web banner rule works.
 *
 *  Predicate is the same pair the company switcher uses (`auth.controller.ts`): company DISABLED
 *  AND `planTerm.termDisabledAt` set. The second half is what separates a term expiry from a
 *  disable an admin ordered by hand, which must keep the generic reply. Read live on every turn and
 *  never cached, so a renewed company — back to ACTIVE with `termDisabledAt` cleared — stops
 *  matching on the very next message with nothing to invalidate. */
async function ownsTermExpiredCompany(prisma: PrismaService, userId: string): Promise<boolean> {
  const owned = await prisma.client.companyMembership.findFirst({
    where: {
      userId,
      status: 'ACTIVE',
      company: { status: 'DISABLED', planTerm: { termDisabledAt: { not: null } } },
      roles: { some: { role: { key: 'OWNER' } } },
    },
    select: { companyId: true },
  });
  return owned !== null;
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

type LineClarificationSource = {
  v: 1; userId: string; companyId: string; fingerprint: string; chatKeyHash: string; recipientHash: string; contentHash: string;
  read?: { requestId: string; ids: string[] | null };
  receipt?: { records: Array<[string, string | null]>; categories: Array<[string, string | null]>; draftChoices?: LineExpenseDraftRouteContext[] };
  substitute?: Array<LineSubstituteReceiptContinuationResult['source'] | null>;
  candidates?: string;
  draft?: { requestId: string; previewId: string | null; phase: 'PENDING' | 'APPLIED' };
  draftRouting?: string;
};

export function lineClarificationContentHash(item: Pick<LedgerSubRequestInput, 'text' | 'subject' | 'clarifyForIntent' | 'candidateExpenseIds' | 'pendingMedia'> & { clarifyQuestion?: string; question?: string }): string {
  return hashMessagePreview(JSON.stringify([item.text, item.clarifyQuestion ?? item.question ?? null,
    item.subject ?? null, item.clarifyForIntent ?? null, item.candidateExpenseIds ?? [], item.pendingMedia ?? null]));
}

@Injectable()
export class ProcessLineWebhookUseCase {
  private readonly logger = new Logger(ProcessLineWebhookUseCase.name);
  private readonly deliveryAccess = new WeakMap<object, { userId: string; companyId: string; fingerprint: string; allowDuringSupportPause?: boolean }>();
  private readonly deliveryDenialNotified = new WeakSet<object>();
  private readonly deliverySources = new WeakMap<object, { requestId: string; ids: string[] | null }>();
  private readonly deliveryDraftPreviews = new WeakMap<object, { context: RequestContext; chatKeyHash: string; requestId: string; previewId: string | null; phase: 'PENDING' | 'APPLIED' }>();
  private readonly deliveryReceiptSources = new WeakMap<object, { context: RequestContext; chatKeyHash: string;
    records: Map<string, string | null>; categories: Map<string, string | null>; draftChoices?: LineExpenseDraftRouteContext[] }>();
  private readonly deliverySubstituteSources = new WeakMap<object, Array<{ context: RequestContext; source: LineSubstituteReceiptContinuationResult['source'] }>>();
  private readonly deliveryCandidates = new WeakMap<object, { context: RequestContext; chatKeyHash: string; snapshot: string; originalChoices?: boolean }>();
  private readonly deliveryWaitingSources = new WeakMap<object, { context: RequestContext; items: Array<LineAiOpenClarification & { entry: LedgerEntry }> }>();
  private readonly clarificationRouteSources = new WeakMap<object, { candidates: string; draftRouting?: string }>();
  private readonly deliveryDenialCode = new WeakMap<object, string>();
  private readonly publicPolicyTopics = new WeakMap<object, PublicPolicyTopic>();
  private readonly replayedOutcomes = new WeakMap<object, unknown>();
  private readonly intermediateDeliveries = new WeakSet<object>();
  @Inject(LineReadEvidenceService) private readonly readEvidence!: LineReadEvidenceService;

  constructor(private readonly lineCredentials: LineMessagingCredentialsService,
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
    // P10-L §3.7. Absent, "ขอเปลี่ยนแพ็กเกจ" answers that the request could not be opened rather
    // than pretending it was — the shop must never be told a queue row exists when none does.
    @Optional() private readonly packageChange?: PackageChangeRequestUseCase,
    // P10-L §7/§8. Absent, "ติดต่อเจ้าหน้าที่" still pauses the assistant and still answers the
    // customer; only the admin fan-out is lost, which is the part that already logs its failures.
    @Optional() private readonly signupNotify?: LineSignupNotifyService,
    // The amplification floor on "ติดต่อเจ้าหน้าที่". `@Optional()` like its neighbours, and the
    // absent case FAILS OPEN on purpose: this bounds cost, it does not protect anything, and a
    // missing Redis must never be the reason a customer in trouble cannot reach a person.
    @Optional() private readonly rateLimit?: AuthRateLimitService,
    // S-4 draft edit (draft-control spec §5.4). LAST on purpose, like the params above it: the
    // specs wire this constructor positionally, so a new dependency goes on the end where it
    // cannot shift anyone else's argument. `@Optional()` like every other expense lane here —
    // absent, `LINE_AI_DRAFT_EDIT_ENABLED` is effectively off: no preview card, no confirm
    // handling, and the correction lane keeps exactly today's honest behaviour.
    @Optional() private readonly draftUpdate?: LineDraftUpdateUseCase,
    // W02-LINE (capture appendix §3/§17.5). Same rule as above — appended, `@Optional()`. Absent,
    // the `file` lane and the pre-capture diagnostic are simply off and every existing lane keeps
    // today's behaviour byte for byte.
    @Optional() private readonly captureRepo?: PrismaExpenseCaptureRepository,
    @Optional() private readonly createCaptureGroup?: CreateExpenseCaptureGroupUseCase,
    @Optional() private readonly addCaptureFile?: AddExpenseCaptureFileUseCase,
    @Optional() private readonly completeCaptureFile?: CompleteExpenseCaptureFileUseCase,
    @Optional() private readonly captureLine?: ExpenseCaptureLineUseCase,
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
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; handoff?: LineHandoffRecipient },
    actorUserId: string,
    companyId: string,
    requestId: string,
    /** Owner 2026-09-06: a capability question keeps this gate's CLOSED-route copy and gains the
     *  entitlement card under it. Absent on the receipt-upload path, which carries no question. */
    capabilityHelp?: (lead: string) => LineReplyMessage[],
  ): Promise<boolean> {
    try {
      await this.launchGate.assertLaunchRouteOpen('ai_line_assistant');
      return false;
    } catch (error) {
      const body = (error as { getResponse?: () => unknown })?.getResponse?.() as { code?: string } | undefined;
      if (body?.code !== FEATURE_TEMPORARILY_UNAVAILABLE) throw error;
    }
    if (capabilityHelp) await this.deliverRequiredMessages(event, capabilityHelp(LAUNCH_ROUTE_CLOSED_REPLY));
    else await this.deliverReply(event, LAUNCH_ROUTE_CLOSED_REPLY);
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
    await this.updateEventLog(event.webhookEventId,
      capabilityHelp ? CAPABILITY_ENTITLEMENT_STATUS : 'launch_route_closed',
      LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE, companyId);
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
      this.logger.warn({ msg: 'LINE branch scope lookup failed', companyId, branchCount: branchIds.length, ...safeLineErrorDetails(error) });
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
      this.logger.warn({ msg: 'LINE pending approval queue unavailable', queue, companyId: ctx.companyId, ...safeLineErrorDetails(error) });
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
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; handoff?: LineHandoffRecipient },
    userId: string,
    companyId: string,
    membershipId: string,
  ): Promise<boolean> {
    if (!await this.legalAcceptance.isRequired({ userId, companyId, membershipId })) return false;
    // Card, not plain text: the button lands on the company home, and `event.handoff` is already
    // bound at both call sites, so the delivery seam turns it into a one-tap login link.
    await this.deliverRequiredMessages(event, [
      buildLegalAcceptanceRequiredMessage(this.config.webBaseUrl, companyId),
    ]);
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
    /** The original webhook event — the intake's money ATTEMPT identity (ADR 0013 §4). */
    webhookEventId?: string;
    retryWebhookEventId?: string;
    onAdmitted?: (identity: CompanyOcrAdmissionIdentity) => void;
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
        // Not part of the model payload — the intake router builds its prompt from an explicit
        // field allowlist — so this only reaches the budget attempt key.
        ...(input.webhookEventId ? { webhookEventId: input.webhookEventId } : {}),
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
      }, { busyWaitDeadlineMs: input.busyWaitDeadlineMs, retryWebhookEventId: input.retryWebhookEventId, onAdmitted: input.onAdmitted });
    } catch (err) {
      // Spec §9.1: our own money gate refused BEFORE any provider ran. Collapsing that into
      // `ROUTER_UNREACHABLE` is what lost the reason and sent the turn straight back into the same
      // closed gate (a second `ai.company_budget.exceeded` event per message, and a false
      // "the document reader is temporarily down" on the image lane). Only a 429 whose body code is
      // one WE emit is trusted here; every other error keeps the legacy handling verbatim.
      const budget = knownAiBudgetRefusal(err);
      this.logger.warn({ msg: 'LINE intake route unavailable', requestId: input.requestId,
        ...(budget ? { budgetErrorCode: budget.code } : {}), ...safeLineErrorDetails(err) });
      if (!budget) {
        return { status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0, errorCode: 'ROUTER_UNREACHABLE' };
      }
      return {
        status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0,
        errorCode: budget.code,
        budgetErrorCode: budget.code,
        ...(budget.budgetScope ? { budgetScope: budget.budgetScope } : {}),
        // `ocrErrorCode` is the existing carrier that makes `tryExtractReceiptFields` answer without
        // calling the provider again — reused here so a refused image turn costs zero further calls
        // and zero OCR reads (B-02). BUSY is deliberately left out: its lease frees between a media
        // turn's model calls, so the OCR attempt's own bounded busy-wait is still worth taking.
        ...(budget.code === 'AI_BUDGET_BUSY' ? {} : { ocrAdmission: 'denied' as const, ocrErrorCode: budget.code }),
      };
    }
  }

  /** Deliver via reply token; on an expired/used token fall back to push so a
   *  queued batch never ends in silence (spec §10). Push consumes OA quota —
   *  the fallback is counted via the `line_push_fallback_used` log line. */
  private async deliverReply(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; handoff?: LineHandoffRecipient },
    text: string,
    quickReply?: LineReplyMessage['quickReply'],
  ): Promise<void> {
    const result = await this.deliverMessages(event, [{
      ...this.lineReply.buildTextMessage(text),
      ...(quickReply ? { quickReply } : {}),
    }]);
    if (result !== 'ok') throw new LineDeliveryError(result);
  }

  /** P29: answer the OWNER of a term-expired company with the renewal invitation instead of the
   *  generic "we cannot find your company" reply. Returns true when it has answered the turn.
   *
   *  Every caller sits on the `no company resolved` branch, which is reached before the permission
   *  resolver, the entitlement read, the router and the model — so an expired company costs one
   *  indexed membership lookup and not a single token. */
  private async replyIfTermExpiredOwner(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; handoff?: LineHandoffRecipient },
    userId: string,
  ): Promise<boolean> {
    if (!await ownsTermExpiredCompany(this.prisma, userId)) return false;
    // §3.7: the expiry message gains the one button that leads somewhere. A quick reply rather than
    // a card, so the existing text reply keeps its exact words and only gains an action.
    await this.deliverReply(event, expiredLineOwnerMessageTh(), {
      items: [{ type: 'action', action: { type: 'message', label: PACKAGE_CHANGE_COMMAND, text: PACKAGE_CHANGE_COMMAND } }],
    });
    await this.updateEventLog(event.webhookEventId, 'plan_term_expired', LINE_AI_ERROR_CODES.FORBIDDEN);
    return true;
  }

  /**
   * P10-L §3.1. One card answers the door, and an application already travelling replaces it with
   * its status — so a customer who applied ten minutes ago is never invited to apply again.
   *
   * Read from the application table directly, like every other state this turn reads: the row is
   * keyed by the same (channel, LINE user) pair the identity lookup above uses.
   */
  private async entryDoorMessage(lineUserId: string): Promise<LineReplyMessage> {
    const pending = await this.findOpenLineSignup(lineUserId);
    if (!pending) return this.doorCard();
    return buildSignupStatusCard(pending.companyName, isBusinessHours(new Date(), {
      days: this.config.lineSignupBusinessDays,
      hours: this.config.lineSignupBusinessHours,
    }));
  }

  /**
   * A LINE user id only means anything WITHIN one messaging channel, so an unset channel id must
   * read as "no rows", never as "any channel" — an absent Prisma filter silently matches every row.
   */
  private async findOpenLineSignup(lineUserId: string): Promise<{ companyName: string } | null> {
    const lineChannelId = this.config.lineMessagingChannelId;
    if (!lineChannelId) return null;
    return this.prisma.client.companySignupRequest.findFirst({
      where: {
        source: SIGNUP_SOURCE_LINE_OA,
        lineProviderUserId: lineUserId,
        lineChannelId,
        state: { in: [...OPEN_LINE_SIGNUP_STATES] },
      },
      orderBy: { createdAt: 'desc' },
      select: { companyName: true },
    });
  }

  /**
   * The three doors, with the LIFF id checked once. An id that cannot be a LIFF id would silently
   * cost the card two of its three doors, so it says so at ERROR rather than degrading quietly —
   * the staff door still works, which is why the card is still worth sending.
   */
  private doorCard(): LineReplyMessage {
    const liffId = this.config.lineLiffId;
    if (!liffId || !LIFF_ID_PATTERN.test(liffId)) {
      this.logger.error({
        msg: 'line.signup.liff_id_unusable',
        riskLevel: 'HIGH',
        configured: Boolean(liffId),
      });
    }
    return buildSignupDoorCard(liffId, this.config.sesWebBaseUrl);
  }

  /**
   * The door card's "เปิดร้านใหม่ ทดลองฟรี" only ever reaches a stranger; a linked owner gets
   * WELCOME_BACK and had no way to open a second shop. The บริษัทของฉัน card carries the same
   * central LIFF page for them — same URL, built from this environment's config, with nothing about
   * the user or the company in it (LINE-ONBOARD-01).
   *
   * Both halves are required: an unusable LIFF id would send the owner to a broken page, and where
   * self-service signup is closed for the environment the LIFF form itself refuses, so the button
   * must not exist there either. `externalSignupEnabled` is the same switch the public signup route
   * answers with `external_signup_disabled`.
   */
  private newShopSignupUrl(): string | undefined {
    const liffId = this.config.lineLiffId;
    if (!this.config.externalSignupEnabled || !liffId || !LIFF_ID_PATTERN.test(liffId)) return undefined;
    return `https://liff.line.me/${liffId}/signup`;
  }

  /** §15.1: "ช่วงทดลอง" is only true of the trial tier; every other shop hears about its package. */
  private async isTrialTier(companyId: string): Promise<boolean> {
    const term = await this.prisma.client.companyPlanTerm.findUnique({
      where: { companyId },
      select: { tierKey: true },
    });
    return term?.tierKey === 'FREE_TRIAL_15';
  }

  /** True while a support pause set by `ติดต่อเจ้าหน้าที่` is still running (§8, 24h, self-expiring). */
  private async assistantPaused(lineUserId: string): Promise<boolean> {
    const context = await this.prisma.client.lineCompanyContext.findUnique({
      where: { lineUserId },
      select: { aiPausedUntil: true },
    });
    return !!context?.aiPausedUntil && context.aiPausedUntil.getTime() > Date.now();
  }

  /**
   * P10-L §7/§8, rewritten by line-support-request-spec-th §2.1.
   *
   * The OA has Chat switched off, so "a human will answer" has to mean something the system
   * enforces. What it used to enforce was almost nothing: the shop name came off the stale
   * `LineCompanyContext` row (UAT E2 — a shop the asker had unlinked from three days earlier), the
   * pause needed that same row to exist, and the notice was queued once per day whether or not
   * anyone was ever told. Now the tap writes a `LineSupportRequest` — the fact of the ask — and
   * everything else is re-derived from it.
   *
   * Public by design: someone whose account is broken enough to need a person may well not resolve
   * to one, and that is exactly the person the old shape dropped.
   */
  private async handleStaffContact(event: LineTextEvent, requestId: string): Promise<void> {
    const asker = await this.resolveSupportAsker(event);
    // Dedupe is per LIVE request, not per day (§2.2.4): while one is live the answer is "you are
    // still in the queue" and nobody is paged twice; once it closes, a new tap is a new request.
    // ANSWERED counts as live (review 2026-09-06): deduping on OPEN alone meant TAPPING the button
    // after an answer opened a second row, while TYPING the same thing reopened the first.
    const live = await this.findLiveSupportRequest(event.lineUserId);
    if (live) {
      // The tap is a message like any other, so it travels the one path that reopens an ANSWERED
      // request and re-arms the pause. It carries no text: "ติดต่อเจ้าหน้าที่" in the operator's
      // message column would replace whatever the customer actually last said.
      await this.recordSupportFollowUp(event.lineUserId, requestId, {});
      // Still waiting on us, so the assistant stays out of the thread: a repeat tap re-arms the
      // pause even though it opens nothing — including for someone whose request names no shop.
      if (asker?.companyId) await this.pauseAssistant(event.lineUserId, asker.companyId);
      await this.deliverReply(event, SUPPORT_ALREADY_OPEN_REPLY);
      await this.audit.log({
        action: 'signup.line.support_requested',
        ...(asker?.companyId ? { companyId: asker.companyId } : {}),
        targetType: 'line_support_request',
        targetId: live.id,
        requestId,
        result: 'SUCCESS',
        riskLevel: 'LOW',
        // A reopen is not a new request: it spends no daily slot and pages nobody a second time.
        metadataJson: { alreadyOpen: true, reopened: live.status === 'ANSWERED', paused: Boolean(asker?.companyId) },
      });
      await this.updateEventLog(event.webhookEventId, 'support_already_open');
      return;
    }

    // Amplification floor. Closing a request frees the dedupe above, so tap → resume → tap,
    // repeated, was an unbounded source of rows, letters and pushes from one unauthenticated
    // LINE account. Three genuine asks a day is more than a real customer makes; the fourth is
    // answered warmly and writes nothing. Checked HERE, not at dispatch: a repeat tap on an
    // already-open request costs nothing and must never be refused.
    const created = await this.prisma.client.$transaction(async (tx) => {
      const lockKey = `line-support:${hashMessagePreview(event.lineUserId)}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const raced = await tx.lineSupportRequest.findFirst({
        where: { lineUserId: event.lineUserId, status: { in: ['OPEN', 'ANSWERED'] } },
        orderBy: { requestedAt: 'desc' }, select: { id: true, status: true },
      });
      if (raced) {
        const touched = await tx.lineSupportRequest.updateMany({
          where: { id: raced.id, status: raced.status },
          data: { lastMessageAt: new Date(), ...(raced.status === 'ANSWERED'
            ? { status: 'OPEN', reopenedCount: { increment: 1 } } : {}) },
        });
        if (touched.count === 0) throw new ConflictException('line_support_state_changed');
        return raced;
      }
      if (this.rateLimit && !await this.rateLimit.consumeLineSupportRequestSlot(event.lineUserId)) return null;

      return tx.lineSupportRequest.create({
        data: {
          lineUserId: event.lineUserId,
          lineUserIdHash: hashMessagePreview(event.lineUserId),
          ...(asker?.companyId ? { companyId: asker.companyId } : {}),
          ...(asker?.signupRequestId ? { signupRequestId: asker.signupRequestId } : {}),
          // Both, from the same sentence: `requestText` is the question and never changes again,
          // `lastMessageText` is where the thread has got to and is rewritten by every follow-up.
          ...(asker?.lastMessageText
            ? { requestText: asker.lastMessageText, lastMessageText: asker.lastMessageText }
            : {}),
        },
        select: { id: true },
      });
    });
    if (!created) {
      await this.deliverReply(event, SUPPORT_DAILY_LIMIT_REPLY);
      await this.audit.log({
        action: 'signup.line.support_requested',
        ...(asker?.companyId ? { companyId: asker.companyId } : {}),
        targetType: 'line_user',
        requestId,
        result: 'DENIED',
        riskLevel: 'LOW',
        metadataJson: { reason: 'daily_limit', linked: Boolean(asker) },
      });
      await this.updateEventLog(event.webhookEventId, 'support_rate_limited');
      // Deliberately NOT paused. Silencing the assistant for 24 hours on the strength of a tap
      // that opened no request and paged nobody is the worst of both: the customer loses the bot
      // AND has nothing in the operator inbox to be answered from.
      return;
    }

    // Only a linked asker has an assistant to stop, and only now that a request actually exists:
    // someone who unlinked is talking to the door card, so there is nothing to pause — but they
    // still reach a human (§2.1.2).
    if (asker?.companyId) await this.pauseAssistant(event.lineUserId, asker.companyId);
    await this.deliverReply(event, STAFF_CONTACT_REPLY);
    await this.signupNotify?.enqueueSupportRequest(created.id);
    await this.audit.log({
      action: 'signup.line.support_requested',
      ...(asker?.companyId ? { companyId: asker.companyId } : {}),
      targetType: 'line_support_request',
      targetId: created.id,
      requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: {
        paused: Boolean(asker?.companyId),
        linked: Boolean(asker),
        hasPendingSignup: Boolean(asker?.signupRequestId),
      },
    });
    await this.updateEventLog(event.webhookEventId, 'support_requested');
  }

  /**
   * §2.1.1. Who is this, RIGHT NOW — re-derived on every tap from the ACTIVE identity, never read
   * off `LineCompanyContext`. That row survives an unlink (§2.5 fixes that going forward, but a
   * stale one may still exist), so trusting it is what named the wrong shop in the UAT evidence.
   *
   * `resolveCompanyForLineUser` already encodes the tie-breaker the spec asks for — the selected
   * company counts only while the caller is still a member of it. Its `needsSelection` answer is
   * for a chat that can ask a question; a support ticket cannot, so it falls back to the oldest
   * membership rather than filing the request against no shop at all.
   */
  private async resolveSupportAsker(event: { lineUserId: string; messagingChannelId?: string }): Promise<{
    companyId: string | null;
    signupRequestId?: string;
    lastMessageText?: string;
  } | null> {
    const { lineUserId } = event;
    const identity = await this.resolveLineIdentity(event);
    if (!identity || identity.user.status !== 'ACTIVE') {
      const pending = await this.pendingSignupFor(lineUserId);
      return pending ? { companyId: null, signupRequestId: pending } : null;
    }
    const resolved = await resolveCompanyForLineUser(this.prisma, identity.userId, lineUserId);
    const companyId = resolved && 'companyId' in resolved
      ? resolved.companyId
      : (await this.prisma.client.companyMembership.findFirst({
        where: { userId: identity.userId, status: 'ACTIVE', company: { status: 'ACTIVE' } },
        orderBy: { createdAt: 'asc' },
        select: { companyId: true },
      }))?.companyId ?? null;
    if (!companyId) {
      const pending = await this.pendingSignupFor(lineUserId);
      return { companyId: null, ...(pending ? { signupRequestId: pending } : {}) };
    }
    // §2.2.1: the one line of context an operator needs before opening the shop. `AiTurn` is the
    // only durable record of what a customer typed (the buffer is in-process and the webhook log
    // clears its payload at every terminal status), so an unlinked asker simply has none.
    const lastTurn = await this.prisma.client.aiTurn.findFirst({
      where: { companyId, userId: identity.userId, userMessagePreview: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { userMessagePreview: true },
    });
    const lastMessageText = lastTurn?.userMessagePreview?.trim().slice(0, SUPPORT_LAST_MESSAGE_MAX_LENGTH);
    return { companyId, ...(lastMessageText ? { lastMessageText } : {}) };
  }

  /** The application this asker is still travelling on, if any — the queue link of §2.1.1. Same
   *  non-terminal state set the door card reads, so the two entrances agree about "still open". */
  private async pendingSignupFor(lineUserId: string): Promise<string | undefined> {
    const pending = await this.prisma.client.companySignupRequest.findFirst({
      where: { lineProviderUserId: lineUserId, state: { in: [...OPEN_LINE_SIGNUP_STATES] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return pending?.id;
  }

  /**
   * Stamps the pause on the per-LINE-user context row, creating it when the caller has never used
   * the company switcher. Upsert rather than update (§2.1.2): the old code could only pause a user
   * who happened to already have a row, so a single-shop owner — the common case — kept getting
   * assistant answers on top of a human.
   *
   * `companyId` is only used to CREATE the row. An existing row keeps whatever it points at, which
   * for a multi-company user with a stale selection may NOT be the shop this request was filed
   * against — and that is fine here: the pause is keyed on `lineUserId`, so it silences the right
   * conversation either way, and the request row (not this one) is what names the shop.
   *
   * The ONLY creator of that row (review 2026-09-06 N2), which is why both call sites reach it
   * through `resolveSupportAsker`: the `companyId` it writes has just been re-derived from a live
   * ACTIVE membership. `recordSupportFollowUp` extends a running pause instead, because the id IT
   * holds is whatever the request remembered and may name a shop the person has since left.
   */
  private async pauseAssistant(lineUserId: string, companyId: string): Promise<void> {
    const aiPausedUntil = new Date(Date.now() + SUPPORT_PAUSE_MS);
    await this.prisma.client.lineCompanyContext.upsert({
      where: { lineUserId },
      create: { lineUserId, companyId, aiPausedUntil },
      update: { aiPausedUntil },
    });
  }

  /**
   * The request this person is still waiting on, whichever shop it names — a customer is one
   * person. CLOSED is excluded on purpose: that matter was settled by somebody deciding, and a
   * fresh "ติดต่อเจ้าหน้าที่" opens a new request (§2.2.4).
   */
  private async findLiveSupportRequest(lineUserId: string) {
    return this.prisma.client.lineSupportRequest.findFirst({
      where: { lineUserId, status: { in: ['OPEN', 'ANSWERED'] } },
      orderBy: { requestedAt: 'desc' },
      // `lastMessageAt` (NOT NULL, defaulted at creation) is the confirmation throttle's clock —
      // read here, before the follow-up write moves it.
      select: { id: true, status: true, companyId: true, lastMessageAt: true },
    });
  }

  /**
   * The customer wrote again while a human was supposed to be handling the thread (UAT 2026-09-06).
   *
   * Until this existed, `lastMessageText` was written exactly once — at the tap — and "ตอบแล้ว" put
   * the row on a tab nothing could bring it back from. So the conversation died silently: the
   * customer kept typing, the pause kept answering "we are looking into it", and no operator
   * surface changed. Their message now lands on the request itself, and an ANSWERED one returns to
   * รอตอบ (and to the header badge, which counts OPEN).
   *
   * CLOSED is deliberately excluded: that matter is settled by somebody deciding, and a fresh
   * "ติดต่อเจ้าหน้าที่" opens a new request — the behaviour §2.2.4 already describes. The lookup is
   * per LINE user and NOT per company: a customer is one person whatever shop the row names.
   *
   * `message` says what arrived, and the two shapes are deliberately different: text is the newest
   * thing worth showing an operator; an empty object is a tap on the button, which moves the clock
   * and says nothing. A PHOTO is neither — it goes through `stampSupportMedia`, because it is not
   * the customer asking again (review 2026-09-06 N1).
   *
   * Returns `none` when there was nothing to append to, when somebody else moved the row first, or
   * when the append itself failed — and the caller then keeps the reply it had. Best effort on
   * purpose: this is bookkeeping beside the turn, and a receipt must not be lost, nor a customer
   * left with no answer at all, because the support table could not be written. `repeat` means the
   * message WAS recorded and the customer has already been told so within the last ten minutes
   * (§2.2 delta รอบ 6), so the caller acknowledges in one line instead of repeating the card.
   */
  private async recordSupportFollowUp(
    lineUserId: string,
    requestId: string,
    message: { text?: string },
  ): Promise<SupportFollowUpOutcome> {
    try {
      const live = await this.findLiveSupportRequest(lineUserId);
      if (!live) return 'none';
      const reopened = live.status === 'ANSWERED';
      const text = message.text?.trim().slice(0, SUPPORT_LAST_MESSAGE_MAX_LENGTH);
      // Conditional on the status it just read, because reading and then writing is a race an
      // operator loses in public: "ตอบแล้ว" pressed in the gap left the row ANSWERED while the
      // customer was told their message had been delivered to a queue it was no longer in.
      const moved = await this.prisma.client.lineSupportRequest.updateMany({
        where: { id: live.id, status: live.status },
        data: {
          lastMessageAt: new Date(),
          ...(text ? { lastMessageText: text } : {}),
          // `answeredAt`/`answeredByUserId` are KEPT: they are the history of the last answer, and
          // the count is what lets the inbox say "ตอบแล้ว N ครั้ง · ลูกค้าตอบกลับ" rather than
          // pretending nobody ever replied.
          ...(reopened ? { status: 'OPEN' as const, reopenedCount: { increment: 1 } } : {}),
        },
      });
      if (moved.count === 0) return 'none';
      // EXTEND ONLY, never create (review 2026-09-06 N2). `live.companyId` is whatever the row
      // recorded when it was filed, checked against nobody since — and §2.5 DELETES this row on
      // unlink, so an upsert here rebuilt an ex-member's context pointing at the shop they left.
      // The tap's own `pauseAssistant`, which asks `resolveSupportAsker` for a live membership
      // first, stays the only thing allowed to open a pause.
      await this.prisma.client.lineCompanyContext.updateMany({
        where: { lineUserId, aiPausedUntil: { not: null } },
        data: { aiPausedUntil: new Date(Date.now() + SUPPORT_PAUSE_MS) },
      });
      await this.audit.log({
        action: 'signup.line.support_follow_up',
        ...(live.companyId ? { companyId: live.companyId } : {}),
        targetType: 'line_support_request',
        targetId: live.id,
        requestId,
        result: 'SUCCESS',
        riskLevel: 'LOW',
        // §3: whether they wrote something, never what — and never the LINE id.
        metadataJson: { reopened, hasText: Boolean(text) },
      });
      // The stamp read BEFORE the write above: how long since this customer last wrote. No new
      // column, and it is the same "when did they last write" the inbox clock and the sweep use.
      return Date.now() - live.lastMessageAt.getTime() < SUPPORT_FOLLOW_UP_REPLY_INTERVAL_MS
        ? 'repeat' : 'recorded';
    } catch (error) {
      this.logger.warn({ msg: 'line_support_follow_up_not_recorded', ...safeLineErrorDetails(error) });
      return 'none';
    }
  }

  /**
   * A photo or a file on a live thread is a MARKER, and nothing else (review 2026-09-06, N1).
   *
   * It used to travel the full follow-up path, which reopened an ANSWERED request, moved
   * `lastMessageAt` and re-armed the 24 h mute. But the commonest photo on a live thread is an
   * ordinary receipt with nothing to do with the request — so a shop that uploads one a day kept
   * its own assistant switched off and its inbox row alive for ever, on nothing but its bookkeeping.
   *
   * Only a TEXT follow-up under the pause, or a tap on "ติดต่อเจ้าหน้าที่", is the customer asking
   * again. `lastMediaAt` alone: the inbox still says "📷 ส่งรูปมา" beside whatever tab the row is in,
   * and §3 keeps the bytes out. Best effort, like the follow-up beside it — a receipt must never be
   * lost because the support table could not be written.
   */
  private async stampSupportMedia(lineUserId: string): Promise<void> {
    try {
      const live = await this.findLiveSupportRequest(lineUserId);
      if (!live) return;
      await this.prisma.client.lineSupportRequest.updateMany({
        where: { id: live.id, status: live.status },
        data: { lastMediaAt: new Date() },
      });
    } catch (error) {
      this.logger.warn({ msg: 'line_support_media_not_recorded', ...safeLineErrorDetails(error) });
    }
  }

  /** §2.4. Clear the assistant pause without treating that separate choice as support resolution. */
  private async handleAssistantResume(event: LineTextEvent, requestId: string): Promise<void> {
    const identity = await this.resolveLineIdentity(event);
    const cleared = await this.prisma.client.lineCompanyContext.updateMany({
      where: { lineUserId: event.lineUserId },
      data: { aiPausedUntil: null },
    });
    const available = Boolean(identity && identity.user.status === 'ACTIVE');
    await this.deliverRequiredMessages(event, [
      available ? { type: 'text', text: ASSISTANT_RESUMED_REPLY } : await this.entryDoorMessage(event.lineUserId),
    ]);
    await this.audit.log({
      action: 'signup.line.support_resumed',
      targetType: 'line_user',
      requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: { pauseCleared: cleared.count > 0, assistantAvailable: available },
    });
    await this.updateEventLog(event.webhookEventId, available ? 'support_resumed' : 'support_resume_unavailable');
  }

  /**
   * P10-L §3.7. Opens a package-change request for the shop this owner runs. Everything the request
   * depends on is re-derived here (SEC-04): the button carries an intent and no ids, so a forged
   * postback can only ever ask for what the sender could already ask for by typing.
   */
  private async handlePackageChangeRequest(
    event: LineTextEvent,
    userId: string,
    requestId: string,
  ): Promise<void> {
    const current = await this.prisma.client.lineCompanyContext.findUnique({
      where: { lineUserId: event.lineUserId }, select: { companyId: true },
    });
    const memberships = await this.prisma.client.companyMembership.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        company: { OR: [{ status: 'ACTIVE' }, { status: 'DISABLED', planTerm: { termDisabledAt: { not: null } } }] },
        roles: { some: { role: { key: 'OWNER', status: 'ACTIVE' } } },
      },
      orderBy: { createdAt: 'asc' },
      select: { companyId: true, company: { select: { name: true, planTerm: { select: { tierKey: true } } } } },
    });
    if (memberships.length === 0) {
      await this.deliverReply(event, PACKAGE_CHANGE_NOT_OWNER_REPLY);
      await this.updateEventLog(event.webhookEventId, 'package_change_denied', LINE_AI_ERROR_CODES.FORBIDDEN);
      return;
    }
    // A stale/non-owner selection cannot silently target a different shop, even if only one is
    // owned. The existing picker switches context; a second explicit request confirms the shop.
    const owned = current?.companyId
      ? memberships.find(row => row.companyId === current.companyId)
      : memberships.length === 1 ? memberships[0] : undefined;
    if (!owned) {
      await this.deliverRequiredMessages(event, [
        buildCompanyPickerMessage(memberships.map(row => ({ companyId: row.companyId, companyName: row.company.name }))),
        { type: 'text', text: 'เลือกร้านที่ต้องการก่อน แล้วกด “ขอเปลี่ยนแพ็กเกจ” อีกครั้งค่ะ',
          quickReply: { items: [{ type: 'action', action: { type: 'message', label: PACKAGE_CHANGE_COMMAND, text: PACKAGE_CHANGE_COMMAND } }] } },
      ]);
      await this.updateEventLog(event.webhookEventId, 'needs_company_selection', LINE_AI_ERROR_CODES.AMBIGUOUS_COMPANY);
      return;
    }
    if (['test', 'live'].includes(this.config.billingMode) && this.config.webBaseUrl) {
      // Old rich-menu/message commands converge here too. The card offers a review page, never
      // claims payment or changes rights; the existing delivery seam binds its handoff to this owner.
      event.handoff = { userId, companyId: owned.companyId };
      const url = new URL(`/companies/${encodeURIComponent(owned.companyId)}/billing?channel=line`, this.config.webBaseUrl).toString();
      await this.deliverReply(event, `📦 ${owned.company.name}\nดูแพ็กเกจ ตรวจสอบการชำระเงิน และเปิดใบเสร็จได้ที่\n${url}\nกรุณาตรวจสอบราคาและยืนยันบนเว็บก่อนชำระเงินค่ะ`);
      await this.updateEventLog(event.webhookEventId, 'billing_review_link', undefined, owned.companyId);
      return;
    }
    if (!this.packageChange) {
      await this.deliverReply(event, PACKAGE_CHANGE_UNAVAILABLE_REPLY);
      await this.updateEventLog(event.webhookEventId, 'package_change_unavailable');
      return;
    }
    // Nobody picked a tier in a chat button, so the request opens at the next step up from where the
    // shop is now and says so in the note — a starting point for the call, never a decision.
    await this.packageChange.create({
      companyId: owned.companyId,
      requestedByUserId: userId,
      requestedTierKey: nextPlanTierKey(owned.company.planTerm?.tierKey),
      note: PACKAGE_CHANGE_LINE_NOTE,
      requestId,
    });
    await this.deliverReply(event, PACKAGE_CHANGE_ACCEPTED_REPLY);
    await this.updateEventLog(event.webhookEventId, 'package_change_requested', undefined, owned.companyId);
  }

  /** §3.6 day-7 nudge. "ใส่เลย" gets the settings link (the delivery seam turns it into one tap). */
  private async handleProfileGuardAnswer(
    event: LineTextEvent,
    userId: string,
    accepted: boolean,
  ): Promise<void> {
    if (!accepted) {
      await this.deliverReply(event, PROFILE_GUARD_LATER_REPLY);
      await this.updateEventLog(event.webhookEventId, 'profile_guard_declined');
      return;
    }
    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { userId, status: 'ACTIVE', company: { status: 'ACTIVE' } },
      orderBy: { createdAt: 'asc' },
      select: { companyId: true },
    });
    if (!membership) {
      await this.deliverReply(event, UNLINKED_REPLY);
      await this.updateEventLog(event.webhookEventId, 'profile_guard_no_company', LINE_AI_ERROR_CODES.UNLINKED_USER);
      return;
    }
    // Setting `handoff` here is what lets the seam mint a one-tap link for the URL below; the
    // refusals above deliberately keep the plain link they always sent.
    event.handoff = { userId, companyId: membership.companyId };
    // The L-E profile page, anchored at the account section — the card asked for an email or a
    // phone, so it must land on the field, not on a dashboard the customer then has to search.
    // Inside `/companies/<id>/`, which is what makes the handoff mint accept it.
    // ponytail: literal until L-E exports the path constant from packages/contracts; swap at integration.
    const link = `${(this.config.webBaseUrl ?? '').replace(/\/+$/, '')}`
      + `/companies/${membership.companyId}/settings/profile#account`;
    await this.deliverReply(event, `${PROFILE_GUARD_ACCEPTED_REPLY}\n${link}`);
    await this.updateEventLog(event.webhookEventId, 'profile_guard_accepted', undefined, membership.companyId);
  }

  /**
   * S-4 beat two (spec §5.4, J3.2/J3.4). The button said "yes" or "no" and nothing else; which
   * record, which change and whether it is still applicable are all re-derived server-side from
   * the pending preview this chat holds.
   *
   * Every outcome is an honest sentence: applied names what changed and links the record, a moved
   * record says so and drops the proposal, a confirmed record gets the `mutation_blocked` copy
   * rather than "out of scope", and an expired or foreign preview is simply "not found".
   */
  private async handleDraftUpdatePostback(
    event: LineTextEvent,
    ctx: RequestContext,
    access: { permissions: string[]; roles: string[] },
    confirm: boolean,
  ): Promise<void> {
    const chatKeyHash = chatKeyHashOf(event);
    if (!this.draftUpdate?.enabled) {
      await this.deliverReply(event, DRAFT_UPDATE_EXPIRED_REPLY);
      await this.updateEventLog(event.webhookEventId, 'draft_update_disabled', undefined, ctx.companyId);
      return;
    }
    if (!confirm) {
      const cancelled = await this.draftUpdate.cancel(ctx, chatKeyHash);
      await this.deliverCompletedReply(
        event,
        cancelled === 'cancelled' ? DRAFT_UPDATE_CANCELLED_REPLY : DRAFT_UPDATE_EXPIRED_REPLY,
        ctx.companyId,
        access,
      );
      await this.updateEventLog(event.webhookEventId, 'draft_update_cancelled', undefined, ctx.companyId);
      return;
    }

    const outcome = await this.draftUpdate.apply(ctx, chatKeyHash, event.webhookEventId);
    let reply: string;
    let status = 'completed';
    if (outcome.status === 'applied') {
      this.deliveryDraftPreviews.set(event, { context: ctx, chatKeyHash, requestId: ctx.requestId, previewId: outcome.preview.previewId, phase: 'APPLIED' });
      const applied = draftUpdateAppliedReply(this.config.webBaseUrl, ctx.companyId, outcome.expenseId, outcome.preview);
      // A double tap is the commonest thing a person does to a slow button; saying "nothing is
      // pending" would deny an edit they really made.
      reply = outcome.replayed ? `${DRAFT_UPDATE_ALREADY_APPLIED_PREFIX} ${applied}` : applied;
    } else if (outcome.status === 'changed') {
      reply = draftUpdateChangedReply(this.config.webBaseUrl, ctx.companyId, outcome.expenseId);
      status = 'draft_update_stale';
    } else if (outcome.status === 'expired' || outcome.status === 'cancelled') {
      reply = DRAFT_UPDATE_EXPIRED_REPLY;
      status = 'draft_update_expired';
    } else {
      reply = draftUpdateBlockedReply(outcome.reason, this.config.webBaseUrl, ctx.companyId, outcome.expenseId);
      status = outcome.reason === 'forbidden' ? 'forbidden' : 'draft_update_blocked';
    }
    await this.deliverCompletedReply(event, reply, ctx.companyId, access);
    await this.persistIntakeTurn({
      userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: normalizeLineText(event.messageText), replyText: reply, intent: 'CORRECTION',
    });
    await this.updateEventLog(
      event.webhookEventId,
      status,
      outcome.status === 'blocked' && outcome.reason === 'forbidden' ? LINE_AI_ERROR_CODES.FORBIDDEN : undefined,
      ctx.companyId,
    );
  }

  /**
   * S-4 beat one. Turns one detected edit request into the confirm card, or into the honest line
   * that says why it could not. Returns false when the caller should fall through to its existing
   * lane — which is what keeps the flag-off and no-match paths byte-identical to today.
   */
  private async proposeDraftUpdate(
    event: LineTextEvent,
    ctx: RequestContext,
    access: { permissions: string[]; roles: string[] },
    request: { tool: LineDraftUpdateTool; input: Record<string, unknown> },
    evidence: Array<{ text: string; todayIso: string }>,
    expenseId: string | undefined,
  ): Promise<'proposed' | 'answered' | 'not_handled'> {
    if (!this.draftUpdate?.enabled) return 'not_handled';
    const outcome = await this.draftUpdate.preview(ctx, {
      tool: request.tool,
      input: request.input,
      chatKeyHash: chatKeyHashOf(event),
      requestId: ctx.requestId,
      evidence,
      ...(expenseId ? { expenseId } : {}),
    });
    if (outcome.status === 'preview') {
      this.deliveryDraftPreviews.set(event, { context: ctx, chatKeyHash: chatKeyHashOf(event), requestId: ctx.requestId, previewId: outcome.preview.previewId, phase: 'PENDING' });
      await this.deliverRequiredMessages(event, [buildDraftUpdatePreviewCard(outcome.preview)]);
      await this.persistIntakeTurn({
        userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizeLineText(event.messageText),
        replyText: outcome.preview.previewId, intent: 'CORRECTION',
      });
      await this.updateEventLog(event.webhookEventId, 'draft_update_preview', undefined, ctx.companyId);
      return 'proposed';
    }
    if (outcome.status === 'move_suggestion') {
      const reply = draftUpdateMoveSuggestionReply(outcome.lineNumber, outcome.chargeLabel);
      await this.deliverCompletedReply(event, reply, ctx.companyId, access);
      await this.persistIntakeTurn({
        userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizeLineText(event.messageText), replyText: reply, intent: 'CORRECTION',
      });
      await this.updateEventLog(event.webhookEventId, 'draft_update_move_suggested', undefined, ctx.companyId);
      return 'answered';
    }
    // `feature_disabled` means the flag flipped mid-turn or the shared preview store is gone; the
    // existing lane is the correct, unchanged answer. Everything else is a real fact about THIS
    // record and must be said rather than swallowed.
    if (outcome.reason === 'feature_disabled') return 'not_handled';
    const reply = draftUpdateBlockedReply(outcome.reason, this.config.webBaseUrl, ctx.companyId, outcome.expenseId);
    await this.deliverCompletedReply(event, reply, ctx.companyId, access);
    await this.persistIntakeTurn({
      userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: normalizeLineText(event.messageText), replyText: reply, intent: 'CORRECTION',
    });
    await this.updateEventLog(
      event.webhookEventId,
      outcome.reason === 'forbidden' ? 'forbidden' : 'draft_update_blocked',
      outcome.reason === 'forbidden' ? LINE_AI_ERROR_CODES.FORBIDDEN : undefined,
      ctx.companyId,
    );
    return 'answered';
  }

  /**
   * The router's `amount` correction hint, read as a draft edit (spec §5.4).
   *
   * `amount` never arrives as words this turn can parse — it is a bounded hint the model SELECTED
   * from grounded value candidates — so it needs its own translation. The line it lands on is
   * deliberately left unset: the use case fills it with the record's only line, or refuses with
   * `ambiguous_line`, which is the "บรรทัดไหน" clarify this lane already sends. `from` is not
   * carried: the direction guard belongs to the five-field lane, and a draft edit asks for
   * confirmation anyway.
   */
  private amountCorrectionAsDraftEdit(
    hints: LineIntakeCorrectionHints | undefined,
    candidates: LineIntakeCorrectionCandidate[],
  ): { tool: LineDraftUpdateTool; input: Record<string, unknown> } | null {
    if (!hints?.amount?.to || candidates.length !== 1) return null;
    return { tool: 'expense.draft.set_line', input: { amount: hints.amount.to } };
  }

  private async deliverRequiredMessages(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; handoff?: LineHandoffRecipient },
    messages: LineReplyMessage[],
  ): Promise<void> {
    const result = await this.deliverMessages(event, messages);
    if (result !== 'ok') throw new LineDeliveryError(result);
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
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; handoff?: LineHandoffRecipient },
    text: string,
    companyId: string,
    access: { permissions: string[]; roles: string[] },
    /** Spec §13: the state badge the reply's own use case chose. Absent renders exactly as before. */
    badge?: string,
  ): Promise<void> {
    if (Array.from(text).length > LINE_FLEX_CARD_BODY_MAX_CHARS) {
      return this.deliverCompletedReplies(event, splitLineExpenseDraftReply(text), companyId, access, undefined, true);
    }
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

  private withDraftWebLink(texts: string[], companyId: string, expenseId?: string): string[] {
    if (!expenseId) return texts;
    const link = absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`);
    if (texts.some((text) => text.includes(link))) return texts;
    const suffix = `
เปิดดูรายการ: ${link}`;
    const last = texts.length - 1;
    return texts.map((text, index) => index === last ? `${text}${suffix}` : text);
  }

  private async deliverCompletedReplies(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; handoff?: LineHandoffRecipient },
    texts: string[],
    companyId: string,
    access: { permissions: string[]; roles: string[] },
    expenseDraft?: LineExpenseDraftCardFacts,
    requestedDraftEdit = false,
  ): Promise<void> {
    if (texts.length === 0 || texts.length > LINE_MAX_MESSAGES_PER_REPLY) throw new Error('LINE_EXPENSE_DRAFT_REPLY_PARTS_INVALID');
    const messages = await this.timeStage(event.webhookEventId, 'render', async () => {
      const terminal = texts[texts.length - 1]!;
      // Default-off is the legacy shape exactly: every part a text message, completion quick reply on the
      // terminal one only.
      if (!this.config.lineAiMultipartTerminalFlexEnabled && !requestedDraftEdit) {
        const parts = texts.map((text) => this.buildLosslessTextMessage(text));
        parts[parts.length - 1] = await this.withCompletionMenu(parts[parts.length - 1]!, companyId, access);
        return parts;
      }
      // §10.1: an expense capture terminal that grounded a draft gets the DEDICATED ร่างค่าใช้จ่าย card;
      // the generic card stays the render for every terminal with no such draft behind it. Same gate
      // either way, so flag-off is still the byte-identical legacy all-text shape above.
      const terminalCard = (text: string): LineReplyMessage => expenseDraft && !/ข้อมูลที่ต้องใช้|ข้อมูลที่ยังต้องตอบ/u.test(text)
        ? buildExpenseDraftCardMessage(text, expenseDraft, this.config.webBaseUrl, companyId)
        : buildLineAssistantTextCardMessage(text, this.config.webBaseUrl, companyId);
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
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; beforeReply?: () => Promise<void>; handoff?: LineHandoffRecipient },
    messages: LineReplyMessage[],
  ): Promise<LineDeliveryResult> {
    return this.timeStage(event.webhookEventId, 'line_delivery', () => this.sendMessages(event, messages));
  }

  private async sendMessages(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; beforeReply?: () => Promise<void>; handoff?: LineHandoffRecipient },
    messages: LineReplyMessage[],
  ): Promise<LineDeliveryResult> {
    // Handoff is set only after company membership resolves. Bind tenant without advancing the
    // event or clearing its recovery envelope; delivery failures must remain tenant-visible.
    if (event.handoff) {
      const bound = await this.prisma.client.lineWebhookEventLog.updateMany({
        where: { webhookEventId: event.webhookEventId, OR: [{ companyId: null }, { companyId: event.handoff.companyId }] },
        data: { companyId: event.handoff.companyId },
      });
      if (bound.count !== 1) return 'failed_other';
    }
    try {
      await event.beforeReply?.();
    } catch (error) {
      // Waiting feedback is cosmetic; it must never block the actual answer.
      this.logger.warn({ msg: 'LINE waiting feedback settlement failed', ...safeLineErrorDetails(error) });
    }
    // Claim before storing an outcome: a queue winner must not acquire a competing live outcome
    // between its UNKNOWN send and reclaim, or that outcome would strand its exact-payload retry.
    if (this.deliverySources.has(event) && !this.intermediateDeliveries.has(event)) {
      const owner = await this.prisma.client.lineWebhookEventLog.updateMany({
        where: { webhookEventId: event.webhookEventId, ...(event.handoff ? { companyId: event.handoff.companyId } : {}),
          OR: [{ deliveryOwnerId: null }, { deliveryOwnerId: 'webhook' }] },
        data: { deliveryOwnerId: 'webhook' },
      });
      if (owner.count !== 1) return 'failed_other';
    }
    const persistentOutcome = this.config.lineAiTerminalOutcomeReplayEnabled && !this.intermediateDeliveries.has(event);
    if (persistentOutcome) {
      const outcome = await this.recordTurnOutcome(event, messages, presentationKindOf(messages));
      if (!outcome) {
        await this.updateEventLog(event.webhookEventId, 'delivery_pending', 'LINE_OUTCOME_NOT_RECORDED');
        return 'failed_other';
      }
      // First committed answer wins. A catch/fallback or restart cannot replace a saved result.
      messages = outcome.messages;
      if (outcome.accepted) {
        await this.completePendingDelivery(event.webhookEventId);
        return 'ok';
      }
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
      // recovery converts this same rejected representation without repeating business work.
      if (persistentOutcome) {
        const replacement = await this.recordTurnOutcome(event, textMessages, 'text_fallback', messages);
        if (!replacement) {
          await this.updateEventLog(event.webhookEventId, 'delivery_pending', 'LINE_OUTCOME_REPRESENTATION_PENDING');
          return 'failed_other';
        }
      }
      result = await this.attemptDelivery(event, textMessages);
    }
    if (result !== 'ok') {
      await this.updateEventLog(event.webhookEventId, result === 'failed_permanent' ? 'delivery_failed' : 'delivery_pending',
        this.deliveryDenialCode.get(event) ?? `LINE_DELIVERY_${result.toUpperCase()}`);
    } else {
      if (persistentOutcome) {
        // API acceptance is separate from rendering and device delivery. If its outcome stamp
        // fails, keep a durable event marker so recovery updates bookkeeping without another send.
        const acceptance = await this.prisma.client.lineTurnOutcome.updateMany({
          where: { webhookEventId: event.webhookEventId, deliveredAt: null },
          data: { deliveredAt: new Date() },
        }).catch(() => null);
        if (!acceptance) await this.updateEventLog(event.webhookEventId, 'delivery_pending', 'LINE_API_ACCEPTED');
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
          this.logger.warn({ msg: 'line_pending_media_resolution_failed', pendingMediaId: resolution.id, ...safeLineErrorDetails(error) });
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
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; handoff?: LineHandoffRecipient; handoffSurface?: string },
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
    const outgoing = this.handoffLinks && !this.config.lineAiTerminalOutcomeReplayEnabled
      ? await this.handoffLinks.wrapOutgoingLineContent(
        // `handoffSurface` labels the ONE lane whose link is not an assistant answer but a capture
        // intake receipt (appendix §3) — audit and adoption measurement only; the mint is identical.
        event.handoff ? { ...event.handoff, lineUserId: event.pushTargetId ?? event.lineUserId, surface: event.handoffSurface ?? 'line_ai_reply' } : null,
        messages,
      )
      : messages;
    if (!await this.mayDeliverBusinessReply(event)) return 'failed_permanent';
    let result: LineDeliveryResult;
    try {
      result = await this.lineReply.sendReply(event.replyToken, outgoing);
    } catch (error) {
      this.logger.warn({ msg: 'LINE reply adapter threw unexpectedly', ...safeLineErrorDetails(error) });
      result = 'failed_other';
    }
    if (result === 'failed_token' || (result === 'failed_flex' && !this.config.lineAiFlexTextFallbackEnabled)) {
      if (!await this.mayDeliverBusinessReply(event)) return 'failed_permanent';
      this.logger.warn({ msg: 'line_push_fallback_used' });
      try {
        result = await this.lineReply.sendPush(event.pushTargetId ?? event.lineUserId, outgoing, event.webhookEventId);
      } catch (error) {
        this.logger.warn({ msg: 'LINE push adapter threw unexpectedly', ...safeLineErrorDetails(error) });
        result = 'failed_other';
      }
    }
    return result;
  }

  private async mayDeliverBusinessReply(event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string }): Promise<boolean> {
    const original = this.deliveryAccess.get(event);
    if (this.replayedOutcomes.has(event)) {
      const current = await this.readEvidence.verifyDelivery(this.replayedOutcomes.get(event), {
        webhookEventId: event.webhookEventId, lineUserId: event.lineUserId, chatId: event.pushTargetId ?? event.lineUserId,
        channelId: event.messagingChannelId ?? '',
      }).catch(() => false);
      if (!current) { await this.denyBusinessDelivery(event, 'LINE_OUTCOME_REAUTHORIZATION_REQUIRED', original); return false; }
    }
    if (!original) return true; // Fresh public and dedicated account/billing recovery paths have their own gates.
    let allowed = false;
    let denialCode = 'LINE_DELIVERY_ACCESS_CHANGED';
    try {
      const sources = this.deliverySources.get(event);
      let sourcesCurrent = true;
      if (sources) {
        denialCode = 'LINE_DELIVERY_SOURCE_CHANGED';
        sourcesCurrent = sources.ids !== null && (!sources.ids.length
          || await this.readEvidence.verify(original.companyId, original.userId, sources.requestId, sources.ids));
        if (sourcesCurrent) denialCode = 'LINE_DELIVERY_ACCESS_CHANGED';
      }
      const draft = this.deliveryDraftPreviews.get(event);
      if (draft) {
        denialCode = 'LINE_DELIVERY_SOURCE_CHANGED';
        const applied = draft.phase === 'APPLIED' ? await this.draftUpdate?.appliedResult(draft.context, draft.chatKeyHash) : null;
        const current = draft.phase === 'APPLIED' ? (applied?.status === 'applied' ? applied.preview : null)
          : await this.draftUpdate?.pendingPreview(draft.context, draft.chatKeyHash, draft.requestId);
        sourcesCurrent = sourcesCurrent && Boolean(draft.previewId && current?.previewId === draft.previewId);
        if (sourcesCurrent) denialCode = 'LINE_DELIVERY_ACCESS_CHANGED';
      }
      if (this.deliveryReceiptSources.has(event)) {
        denialCode = 'LINE_DELIVERY_SOURCE_CHANGED';
        sourcesCurrent = sourcesCurrent && await this.receiptDeliverySourcesCurrent(event);
        if (sourcesCurrent) denialCode = 'LINE_DELIVERY_ACCESS_CHANGED';
      }
      const substitute = this.deliverySubstituteSources.get(event);
      if (substitute) {
        denialCode = 'LINE_DELIVERY_SOURCE_CHANGED';
        for (const proof of substitute) sourcesCurrent = sourcesCurrent
          && Boolean(await this.substituteReceiptContinuation?.replySourcesCurrent(proof.context, proof.source));
        if (sourcesCurrent) denialCode = 'LINE_DELIVERY_ACCESS_CHANGED';
      }
      const waiting = this.deliveryWaitingSources.get(event);
      if (waiting) {
        denialCode = 'LINE_DELIVERY_SOURCE_CHANGED';
        for (const item of waiting.items) sourcesCurrent = sourcesCurrent
          && await this.clarificationSourceCurrent(event as LineTextEvent, waiting.context, item);
        if (sourcesCurrent) denialCode = 'LINE_DELIVERY_ACCESS_CHANGED';
      }
      const candidates = this.deliveryCandidates.get(event);
      if (candidates) {
        denialCode = 'LINE_DELIVERY_SOURCE_CHANGED';
        sourcesCurrent = sourcesCurrent && await this.correctionCandidatesCurrent(candidates.context, candidates.chatKeyHash, candidates.snapshot, candidates.originalChoices);
        if (sourcesCurrent) denialCode = 'LINE_DELIVERY_ACCESS_CHANGED';
      }
      const identity = await this.resolveLineIdentity(event);
      if (sourcesCurrent && identity?.userId === original.userId && identity.user.status === 'ACTIVE' && !identity.user.aiAssistantOptOutAt
        && (!event.pushTargetId || event.pushTargetId === event.lineUserId)) {
        const access = await this.permissionResolver.resolveAccess(original.userId, original.companyId);
        const entitled = await loadEntitledFeatureKeys(this.prisma, original.companyId);
        const context = await this.prisma.client.lineCompanyContext.findUnique({
          where: { lineUserId: event.lineUserId }, select: { companyId: true, aiPausedUntil: true },
        });
        allowed = (!context?.companyId || context.companyId === original.companyId)
          && (original.allowDuringSupportPause || !context?.aiPausedUntil || context.aiPausedUntil.getTime() <= Date.now())
          && original.fingerprint === resolvedLineDeliveryAccessFingerprint(original.userId, original.companyId, access, entitled);
      }
    } catch (error) {
      this.logger.warn({ msg: 'line_delivery_access_unavailable', webhookEventId: event.webhookEventId, ...safeLineErrorDetails(error) });
    }
    if (!allowed) await this.denyBusinessDelivery(event, denialCode, original);
    return allowed;
  }

  private rememberReceiptDeliverySource(event: LineTextEvent | LineReceiptUploadEvent, context: RequestContext,
    expense: { id: string; updatedAt?: Date }, category?: { id: string; name: string }) {
    const proof = this.deliveryReceiptSources.get(event) ?? { context, chatKeyHash: chatKeyHashOf(event), records: new Map(), categories: new Map() };
    const revision = expense.updatedAt instanceof Date && Number.isFinite(expense.updatedAt.getTime()) ? expense.updatedAt.toISOString() : null;
    proof.records.set(expense.id, proof.records.has(expense.id) && proof.records.get(expense.id) !== revision ? null : revision);
    if (category) proof.categories.set(category.id, proof.categories.has(category.id) && proof.categories.get(category.id) !== category.name ? null : category.name);
    this.deliveryReceiptSources.set(event, proof);
  }

  private rememberContinuationDeliverySource(event: LineTextEvent, context: RequestContext, result: LineExpenseDraftConversationResult) {
    if (!result.handled || result.status === 'STALE' || result.status === 'NOT_FOUND') return;
    const source = result.source;
    if (!source?.records.length) {
      // A legacy/unproven success must not be blessed by reading a newer revision now.
      this.deliveryReceiptSources.set(event, { context, chatKeyHash: chatKeyHashOf(event),
        records: new Map([[result.expenseId ?? 'unproven-draft', null]]), categories: new Map() });
      return;
    }
    for (const record of source.records) {
      this.rememberReceiptDeliverySource(event, context, record);
      for (const category of source.categories) this.rememberReceiptDeliverySource(event, context, record, category);
    }
    if (source.choices) this.deliveryReceiptSources.get(event)!.draftChoices = source.choices;
  }

  private rememberSubstituteDeliverySource(event: LineTextEvent, context: RequestContext, result: LineSubstituteReceiptContinuationResult) {
    if (!result.source && !result.expenseId && !result.candidateExpenseIds?.length && !result.resumeCapsule) return;
    if (result.status === 'FORBIDDEN' && !result.source) return; // Static permission guidance only.
    const proofs = this.deliverySubstituteSources.get(event) ?? [];
    proofs.push({ context, source: result.source }); this.deliverySubstituteSources.set(event, proofs);
  }

  private rememberCandidateDeliverySources(event: LineTextEvent, context: RequestContext, candidates: LineIntakeCorrectionCandidate[], originalChoices = false) {
    this.deliveryCandidates.set(event, { context, chatKeyHash: chatKeyHashOf(event), snapshot: JSON.stringify(candidates), originalChoices });
  }

  private async correctionCandidatesCurrent(ctx: RequestContext, chatKeyHash: string, snapshot: string, originalChoices = false): Promise<boolean> {
    if (!this.expenseRepo || !RECEIPT_CAPTURE_PERMISSIONS.some(permission => ctx.permissions.includes(permission))) return false;
    try {
      // Compare the facts/ordering actually used, not unrelated questionnaire metadata writes.
      const original = JSON.parse(snapshot) as LineIntakeCorrectionCandidate[];
      if (!Array.isArray(original) || original.length > 5 || new Set(original.map(row => row.id)).size !== original.length) return false;
      const current = await this.loadCorrectionCandidates(ctx.companyId, ctx.userId, chatKeyHash, ctx.scopes ?? {},
        originalChoices ? original.map(row => row.id) : undefined);
      return current.length === original.length
        && JSON.stringify(originalChoices ? original.map(row => current.find(now => now.id === row.id)) : current) === snapshot;
    } catch { return false; }
  }

  /** Read only: never recapture an expense merely to validate a prepared receipt answer. */
  private async receiptDeliverySourcesCurrent(event: object): Promise<boolean> {
    const proof = this.deliveryReceiptSources.get(event);
    return this.receiptSourcesCurrent(proof);
  }

  private async receiptSourcesCurrent(proof: { context: RequestContext; chatKeyHash: string;
    records: Map<string, string | null>; categories: Map<string, string | null>; draftChoices?: LineExpenseDraftRouteContext[] } | undefined): Promise<boolean> {
    if (!proof || !this.expenseRepo || proof.records.size > 5) return false;
    const ctx = proof.context;
    if (!RECEIPT_CAPTURE_PERMISSIONS.some(permission => ctx.permissions.includes(permission))) return false;
    for (const [id, revision] of proof.records) {
      const current = await this.expenseRepo.findByIdWithRelations(ctx.companyId, id, undefined, ctx.scopes ?? {});
      if (!revision || !current || current.id !== id || current.companyId !== ctx.companyId || current.createdByUserId !== ctx.userId
        || current.captureSource !== 'LINE_UPLOAD' || current.sourceChannelMetadataJson?.chatKeyHash !== proof.chatKeyHash
        || !isBranchInScope(ctx.scopes ?? {}, current.branchId) || current.updatedAt?.toISOString() !== revision) return false;
    }
    if (proof.categories.size) {
      const categories = await this.expenseRepo.listCategories(ctx.companyId);
      for (const [id, name] of proof.categories) if (!name || !categories.some(category => category.id === id && category.name === name)) return false;
    }
    if (proof.draftChoices && (!this.expenseDraftConversation || JSON.stringify(proof.draftChoices)
      !== JSON.stringify(await this.expenseDraftConversation.routeContexts(ctx, proof.chatKeyHash)))) return false;
    return true;
  }

  private clarificationSourceContext(event: LineTextEvent | LineReceiptUploadEvent, item: LedgerSubRequestInput): string | undefined {
    const access = this.deliveryAccess.get(event);
    if (!access) return undefined;
    const receipt = this.deliveryReceiptSources.get(event), substitute = this.deliverySubstituteSources.get(event), draft = this.deliveryDraftPreviews.get(event);
    const routing = !receipt && !substitute && !draft ? this.clarificationRouteSources.get(event) : undefined;
    const source: LineClarificationSource = { v: 1, userId: access.userId, companyId: access.companyId,
      fingerprint: access.fingerprint, chatKeyHash: chatKeyHashOf(event),
      recipientHash: lineDeliveryRecipientHash(event.lineUserId, event.pushTargetId ?? event.lineUserId, event.messagingChannelId ?? ''), contentHash: lineClarificationContentHash(item),
      read: this.deliverySources.get(event),
      ...(receipt ? { receipt: { records: [...receipt.records], categories: [...receipt.categories], draftChoices: receipt.draftChoices } } : {}),
      ...(substitute ? { substitute: substitute.map(proof => proof.source ?? null) } : {}),
      ...(draft ? { draft: { requestId: draft.requestId, previewId: draft.previewId, phase: draft.phase } } : {}),
      candidates: this.deliveryCandidates.get(event)?.snapshot ?? routing?.candidates,
      draftRouting: routing?.draftRouting,
    };
    const serialized = JSON.stringify(source);
    return Buffer.byteLength(serialized, 'utf8') <= LINE_CLARIFICATION_SOURCE_MAX_BYTES ? serialized : undefined;
  }

  private async appendSourceBoundClarifications(event: LineTextEvent | LineReceiptUploadEvent, input: Parameters<LineAiLedgerService['appendSubRequests']>[0]) {
    await this.ledger?.appendSubRequests({ ...input, items: input.items.map(item => ({ ...item,
      sourceContext: this.clarificationSourceContext(event, item),
    })) });
  }

  /** Verify the old question itself, never relabel old wording with a newly read revision. */
  private async clarificationSourceCurrent(event: LineTextEvent, ctx: RequestContext, item: LineAiOpenClarification & { entry: LedgerEntry }): Promise<boolean> {
    try {
      const raw = item.entry.sourceContext, access = this.deliveryAccess.get(event);
      if (!raw || Buffer.byteLength(raw, 'utf8') > LINE_CLARIFICATION_SOURCE_MAX_BYTES || !access) return false;
      const source = JSON.parse(raw) as LineClarificationSource;
      if (source.v !== 1 || source.userId !== ctx.userId || source.companyId !== ctx.companyId
        || source.fingerprint !== access.fingerprint || source.chatKeyHash !== chatKeyHashOf(event)
        || source.recipientHash !== lineDeliveryRecipientHash(event.lineUserId, event.pushTargetId ?? event.lineUserId, event.messagingChannelId ?? '')
        || source.contentHash !== lineClarificationContentHash(item)) return false;
      if (source.read && (!Array.isArray(source.read.ids) || source.read.ids.length > 64 || source.read.ids.length > 0
        && !await this.readEvidence.verify(ctx.companyId, ctx.userId, source.read.requestId, source.read.ids))) return false;
      if (source.receipt && !await this.receiptSourcesCurrent({ context: ctx, chatKeyHash: source.chatKeyHash,
        records: new Map(source.receipt.records), categories: new Map(source.receipt.categories), draftChoices: source.receipt.draftChoices })) return false;
      if (source.substitute) {
        if (!source.substitute.length || source.substitute.length > 5) return false;
        for (const proof of source.substitute) if (!await this.substituteReceiptContinuation?.replySourcesCurrent(ctx, proof ?? undefined)) return false;
      }
      if (source.candidates && source.candidates !== '[]'
        && !await this.correctionCandidatesCurrent(ctx, source.chatKeyHash, source.candidates, true)) return false;
      if (source.draft) {
        const saved = source.draft.phase === 'APPLIED' ? await this.draftUpdate?.appliedResult(ctx, source.chatKeyHash) : null;
        const preview = source.draft.phase === 'APPLIED' ? saved?.status === 'applied' ? saved.preview : null
          : await this.draftUpdate?.pendingPreview(ctx, source.chatKeyHash, source.draft.requestId);
        if (!source.draft.previewId || preview?.previewId !== source.draft.previewId) return false;
      }
      if (source.draftRouting !== undefined && (!this.expenseDraftConversation
        || JSON.stringify(await this.expenseDraftConversation.routeContexts(ctx, source.chatKeyHash)) !== source.draftRouting)) return false;
      if (item.candidateExpenseIds?.length) {
        const ids = item.candidateExpenseIds;
        const provenIds = new Set([
          ...(source.substitute?.flatMap(proof => proof?.records.map(row => row.id) ?? []) ?? []),
          ...(source.receipt?.records.map(row => row[0]) ?? []),
          ...(source.candidates ? (JSON.parse(source.candidates) as LineIntakeCorrectionCandidate[]).map(row => row.id) : []),
        ]);
        if (ids.length > 5 || new Set(ids).size !== ids.length || ids.some(id => !provenIds.has(id))) return false;
      }
      if (item.pendingMedia) {
        const pending = await this.prisma.client.lineIntakePendingMedia.findFirst({ where: { id: item.pendingMedia.pendingMediaId,
          companyId: ctx.companyId, userId: ctx.userId, attachmentId: item.pendingMedia.attachmentId, mimeType: item.pendingMedia.mimeType,
          status: 'PENDING', expiresAt: { gt: new Date() } } });
        if (!pending || (pending.caption || MEDIA_PENDING_REQUEST_TEXT) !== item.text) return false;
        const attachment = await this.expenseRepo?.findActiveAttachmentObject(ctx.companyId, item.pendingMedia.attachmentId);
        if (!attachment) return false;
      }
      return true;
    } catch { return false; }
  }

  private async waitingSourcesCurrent(event: LineTextEvent, ctx: RequestContext, open: Array<LineAiOpenClarification & { entry: LedgerEntry }>): Promise<boolean> {
    const stale = [];
    for (const item of open) if (!await this.clarificationSourceCurrent(event, ctx, item)) stale.push(item.id);
    if (!stale.length) return true;
    // A durable refusal prevents this unsafe question from trapping every later fresh request.
    await this.consumeClarifications(ctx.companyId, event.pushTargetId ?? event.lineUserId, ctx.userId, open, stale, 'clarification_source_changed');
    await this.denyBusinessDelivery(event, 'LINE_DELIVERY_SOURCE_CHANGED', this.deliveryAccess.get(event));
    return false;
  }

  private async denyBusinessDelivery(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string },
    denialCode: string,
    original?: { userId: string; companyId: string },
  ): Promise<void> {
    this.deliveryDenialCode.set(event, denialCode);
    await this.audit.log({ companyId: original?.companyId, actorUserId: original?.userId,
      action: 'ai.line.delivery.denied', targetType: 'LineWebhookEvent', targetId: event.webhookEventId,
      requestId: event.webhookEventId, result: 'DENIED', riskLevel: 'HIGH', metadataJson: { reason: denialCode === 'LINE_DELIVERY_ACCESS_CHANGED' ? 'delivery_access_changed' : 'delivery_source_changed' } }).catch(error => {
      // An audit outage cannot turn denial into an exception that replays completed business work.
      this.logger.warn({ msg: 'line_delivery_denial_audit_unavailable', webhookEventId: event.webhookEventId, ...safeLineErrorDetails(error) });
    });
    await this.updateEventLog(event.webhookEventId, 'delivery_failed', denialCode, original?.companyId);
    if (!this.deliveryDenialNotified.has(event)) {
      this.deliveryDenialNotified.add(event);
      // This separate refusal contains no stored business facts, company link or handoff token.
      // Do not route it through the saved-outcome path, which retains the original private answer.
      const messages = [this.lineReply.buildTextMessage(event.pushTargetId && event.pushTargetId !== event.lineUserId
        ? 'เพื่อความเป็นส่วนตัว กรุณาเปิดแชตส่วนตัวกับมั่งมี หากส่งรายการไว้แล้วให้ตรวจในเว็บก่อนส่งซ้ำค่ะ'
        : denialCode !== 'LINE_DELIVERY_ACCESS_CHANGED'
          ? 'ข้อมูลต้นทางเปลี่ยนหรือยังตรวจสอบไม่ได้ กรุณาเปิดเว็บเพื่อตรวจรายการหรือถามใหม่ หากส่งรายการไว้แล้วให้ตรวจในเว็บก่อนส่งซ้ำค่ะ'
          : 'สิทธิ์หรือร้านที่เลือกเปลี่ยนระหว่างดำเนินการ กรุณาเลือกร้านแล้วถามใหม่ หากส่งรายการไว้แล้วให้ตรวจในเว็บก่อนส่งซ้ำค่ะ')];
      try {
        const result = await this.lineReply.sendReply(event.replyToken, messages);
        if (result === 'failed_token') await this.lineReply.sendPush(event.pushTargetId ?? event.lineUserId, messages, `${event.webhookEventId}:access-denied`);
      } catch (error) {
        this.logger.warn({ msg: 'line_delivery_refusal_unavailable', webhookEventId: event.webhookEventId, ...safeLineErrorDetails(error) });
      }
    }
  }

  private async completePendingDelivery(webhookEventId: string): Promise<void> {
    await this.prisma.client.lineWebhookEventLog.updateMany({
      where: { webhookEventId, status: 'delivery_pending' },
      data: { status: 'completed', errorCode: null, processedAt: new Date(), payloadJson: Prisma.DbNull },
    }).catch(() => null);
  }

  /** Only a provider-rejected representation can be replaced; ordinary fallback cannot rewrite facts. */
  private async recordTurnOutcome(
    event: { webhookEventId: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string },
    messages: LineReplyMessage[],
    presentationKind: string,
    rejectedMessages?: LineReplyMessage[],
  ): Promise<{ messages: LineReplyMessage[]; accepted: boolean } | null> {
    const { webhookEventId } = event;
    try {
      // Do not write an outcome that the replay reader cannot read back.
      if (!parseOutcomeMessages(messages)) return null;
      const log = await this.prisma.client.lineWebhookEventLog.findUnique({
        where: { webhookEventId }, select: { companyId: true },
      });
      const messagesJson = messages as unknown as Prisma.InputJsonValue;
      if (rejectedMessages) {
        const updated = await this.prisma.client.lineTurnOutcome.updateMany({
          where: { webhookEventId, deliveredAt: null, messagesJson: { equals: rejectedMessages as unknown as Prisma.InputJsonValue } },
          data: { messagesJson, presentationKind, attempts: { increment: 1 } },
        });
        if (updated.count !== 1) return null;
        return { messages, accepted: false };
      }
      const producerId = randomUUID(), access = this.deliveryAccess.get(event), sources = this.deliverySources.get(event);
      const topic = this.publicPolicyTopics.get(event);
      const authorizationJson = { v: 1, producerId,
        ...(topic ? { publicPolicy: { topic,
          recipientHash: lineDeliveryRecipientHash(event.lineUserId, event.pushTargetId ?? event.lineUserId, event.messagingChannelId ?? ''),
        } } : {}),
        ...(access && sources?.ids?.length && !this.deliveryDraftPreviews.has(event) && !this.deliveryReceiptSources.has(event) && !this.deliverySubstituteSources.has(event) && !this.deliveryCandidates.has(event) ? { read: {
          userId: access.userId, companyId: access.companyId, fingerprint: access.fingerprint,
          requestId: sources.requestId, ids: sources.ids, webhookEventId,
          recipientHash: lineDeliveryRecipientHash(event.lineUserId, event.pushTargetId ?? event.lineUserId, event.messagingChannelId ?? ''),
          channelId: event.messagingChannelId ?? '',
        } } : {}),
      };
      const outcome = await this.prisma.client.lineTurnOutcome.upsert({
        where: { webhookEventId },
        create: { webhookEventId, companyId: log?.companyId ?? null, messagesJson, authorizationJson, presentationKind, attempts: 1 },
        update: { attempts: { increment: 1 } },
      });
      if ((outcome.authorizationJson as { producerId?: string } | null)?.producerId !== producerId) {
        this.replayedOutcomes.set(event, outcome.authorizationJson);
      }
      const stored = parseOutcomeMessages(outcome.messagesJson);
      return stored ? { messages: stored, accepted: outcome.deliveredAt != null } : null;
    } catch (error) {
      this.logger.error({ msg: 'line_turn_outcome_not_recorded', webhookEventId, ...safeLineErrorDetails(error) });
      return null;
    }
  }

  /** LINE IDs are provider-scoped; the approved local binding uses the Messaging channel.
   * An explicit canonical unlink/disable is authoritative over any older legacy alias.
   * Legacy-only accounts retain their existing route until the Admin QR repair is complete.
   */
  private async resolveLineIdentity(event: { lineUserId: string; messagingChannelId?: string }) {
    const channelId = event.messagingChannelId ?? this.config.lineMessagingChannelId;
    const where = { providerUserId: event.lineUserId, provider: 'LINE' as const, status: 'ACTIVE' as const };
    if (!channelId && this.config.isProduction) {
      throw new ServiceUnavailableException('LINE channel configuration is missing.');
    }
    if (channelId) {
      const scoped = await this.prisma.client.externalIdentity.findFirst({
        where: { providerUserId: event.lineUserId, provider: 'LINE', providerChannelId: channelId },
        include: { user: true },
      });
      if (scoped) return scoped.status === 'ACTIVE' ? scoped : null;
    }
    const identity = await this.prisma.client.externalIdentity.findFirst({ where, include: { user: true } });
    if (identity && channelId) {
      this.logger.warn({ msg: 'line_identity_channel_agnostic_fallback', messagingChannelId: channelId });
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

  /** Reuse delivery evidence, not model history. An intervening event ends this public topic. */
  private async lastDeliveredPublicPolicy(event: LineTextEvent): Promise<PublicPolicyTopic | undefined> {
    if (!this.config.lineAiTerminalOutcomeReplayEnabled) return undefined;
    const previous = await this.prisma.client.lineWebhookEventLog.findFirst({
      where: { lineUserIdHash: hashMessagePreview(event.lineUserId), webhookEventId: { not: event.webhookEventId },
        createdAt: { gte: new Date(Date.now() - LINE_AI_CONTEXT_WINDOW_MINUTES * 60_000) } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { status: true, turnOutcome: { select: { deliveredAt: true, authorizationJson: true } } },
    });
    if (!previous || !['staff_menu_trial_pricing', 'staff_menu_promotion'].includes(previous.status)
      || !previous.turnOutcome?.deliveredAt) return undefined;
    const authorization = previous.turnOutcome.authorizationJson;
    if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization) || authorization.v !== 1) return undefined;
    const policy = authorization.publicPolicy;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return undefined;
    return isPublicPolicyTopic(policy.topic)
      && policy.recipientHash === lineDeliveryRecipientHash(event.lineUserId, event.pushTargetId ?? event.lineUserId, event.messagingChannelId ?? '')
      ? policy.topic : undefined;
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
    // The staff door (§3.1): closes the trap where an employee with no email signs their shop up a
    // second time. Public because nobody arriving here has an account yet by definition.
    if (publicCommand === 'employee') {
      await this.deliverReply(event, EMPLOYEE_DOOR_REPLY);
      await this.updateEventLog(event.webhookEventId, 'line_employee_door');
      return;
    }
    if (publicCommand === 'staff_contact') {
      await this.handleStaffContact(event, requestId);
      return;
    }
    // §2.4. Public for the same reason its twin is: the pause is keyed on the LINE user, not on an
    // account, so the words that lift it must reach as far as the words that set it. Handled ABOVE
    // the pause gate below, or the reply that lifts the pause would be swallowed by the pause.
    if (publicCommand === 'resume_ai') {
      await this.handleAssistantResume(event, requestId);
      return;
    }
    if (publicCommand === 'contact') {
      await this.deliverRequiredMessages(event, [buildContactCard()]);
      await this.updateEventLog(event.webhookEventId, 'staff_menu_contact');
      return;
    }
    if (publicCommand === 'talk') {
      // Owner 2026-09-06 (§2.2 delta รอบ 6 ข้อ 6): the tile's words ARE the way back from a support
      // pause, tapped or typed — under a pause they lift it exactly as the typed aliases do, and
      // nothing is filed for the operator. Otherwise the tile greets as it always has. One string,
      // one command, routed here by pause state, so the tile and the resume text never race.
      if (await this.assistantPaused(event.lineUserId)) {
        await this.handleAssistantResume(event, requestId);
        return;
      }
      await this.deliverReply(event, ASSISTANT_TALK_GREETING);
      await this.updateEventLog(event.webhookEventId, 'staff_menu_talk');
      return;
    }
    // Rich menu v2 ver2 Promotion tile (Owner design 2026-08-27). Public like `contact`: a
    // prospect exploring packages may well be unlinked, and the card carries no tenant data.
    if (publicCommand === 'promotion') {
      this.publicPolicyTopics.set(event, 'trial');
      await this.deliverRequiredMessages(event, [buildPromotionCard(this.config.webBaseUrl)]);
      await this.updateEventLog(event.webhookEventId, 'staff_menu_promotion');
      return;
    }
    // Public trial policy contains no account data and needs no AI. Ordinary support text still
    // belongs to the human handling the case; do not resume the assistant or swallow that reply.
    const previousPolicy = isPublicPolicyFollowUp(event.messageText) ? await this.lastDeliveredPublicPolicy(event) : undefined;
    const policyAnswer = resolvePublicPolicyAnswer(event.messageText, previousPolicy);
    if (policyAnswer && !await this.assistantPaused(event.lineUserId)) {
      this.publicPolicyTopics.set(event, policyAnswer.topic);
      await this.deliverRequiredMessages(event, [buildPublicPolicyCardMessage(policyAnswer)]);
      await this.updateEventLog(event.webhookEventId, 'staff_menu_trial_pricing');
      return;
    }
    // 3. Resolve LINE user → internal user via ExternalIdentity, scoped to the webhook's channel.
    const identity = await this.resolveLineIdentity(event);

    if (!identity || identity.user.status !== 'ACTIVE') {
      // "ทำอะไรได้บ้าง" (Owner 2026-08-27): a model-composed answer advertised features that do
      // not exist, so a short capability question is answered by the curated card — deterministic,
      // zero model calls, only the six real functions.
      //
      // For a STRANGER only (Owner 2026-09-06, "ควรสอนการใช้งาน user ได้ตามฟีเจอร์ที่เปิดอยู่ และตาม
      // ขอบเขตของผู้ถาม"). The card is public marketing copy and carries no tenant data, which is
      // exactly why it may be sent before an account exists — and exactly why it is the wrong
      // answer once one does: it names ยอดขาย and สรุปบัญชี to an expenses-only employee who can
      // use neither. A linked caller's question falls through to the ordinary turn, where
      // `capability_help` is composed from the caller's own permissions and this company's
      // entitlements (capability-help spec §8/§8.1) — including, below, the support pause, which
      // this lane used to jump ahead of.
      if (isCapabilityQuestion(event.messageText)) {
        await this.deliverRequiredMessages(event, [buildCapabilityCard()]);
        await this.updateEventLog(event.webhookEventId, 'staff_menu_capability');
        return;
      }
      // A REQUEST_INFO applicant or unlinked person may already be in a managed human-support
      // conversation even though they have no account/company context to pause. Ordinary text is
      // their answer to that case; public menu/signup/resume commands keep their explicit routes.
      if (publicCommand === null) {
        const recorded = await this.recordSupportFollowUp(event.lineUserId, requestId, { text: event.messageText });
        if (recorded !== 'none') {
          await this.deliverReply(event, SUPPORT_FOLLOW_UP_REPLIES[recorded]);
          await this.updateEventLog(event.webhookEventId, 'support_follow_up');
          return;
        }
      }
      // P10-L §3.1: the plain "link your account first" line was a dead end for the one person who
      // has no account to link. The same card the door sends, so both entrances agree — and a
      // `follow` from a stranger lands here too, which is what makes G-03 an answer.
      await this.deliverRequiredMessages(event, [await this.entryDoorMessage(event.lineUserId)]);
      // L-B follow-up (c): adding the OA as a friend is the INVITED first step of this flow, not an
      // attempt to reach anything. Recording it DENIED puts every prospect into a security signal
      // whose whole value is that it is rare — the door card is the correct, successful answer to
      // them. A message or a postback from an unlinked stranger is still a real access attempt and
      // keeps its DENIED row.
      const invitedEntry = publicCommand === 'follow';
      await this.audit.log({
        action: 'ai.line.unlinked_access', targetType: 'line_user', requestId,
        result: invitedEntry ? 'SUCCESS' : 'DENIED', riskLevel: 'LOW',
        metadataJson: { lineUserId: '[REDACTED]', ...(invitedEntry ? { entry: 'follow' } : {}) },
      });
      await this.updateEventLog(
        event.webhookEventId,
        invitedEntry ? 'line_follow' : 'unlinked',
        invitedEntry ? undefined : LINE_AI_ERROR_CODES.UNLINKED_USER,
      );
      return;
    }

    // L-17: a customer who already has a shop and re-adds the OA is not a prospect. Answering them
    // with "open a new shop / I am staff / link an existing account" reads as though the system has
    // forgotten them — and the second door invites a duplicate signup.
    if (publicCommand === 'follow') {
      await this.deliverReply(event, WELCOME_BACK_REPLY);
      await this.updateEventLog(event.webhookEventId, 'line_follow_known');
      return;
    }

    // P10-L §3.7. Needs an identity but NOT a resolvable active company: a shop whose trial expired
    // is DISABLED, and asking to change package is exactly what that shop is here to do.
    //
    // ABOVE the support pause on purpose. The pause exists to stop the ASSISTANT talking over a
    // human, and these are not assistant turns — they are the customer pressing a button we put in
    // front of them. Under the pause they were swallowed by the "we are looking into it" reply and
    // no request was ever created, so the one action an expired shop is in the chat to take
    // silently did nothing for 24 hours.
    if (publicCommand === 'package_change') {
      await this.handlePackageChangeRequest(event, identity.userId, requestId);
      return;
    }
    if (publicCommand === 'profile_guard' || publicCommand === 'profile_guard_later') {
      await this.handleProfileGuardAnswer(event, identity.userId, publicCommand === 'profile_guard');
      return;
    }

    // P10-L §8: while a human is handling this thread the assistant stays out of it. Everything
    // below is an assistant turn — free text, receipts, AI answers — which is exactly what the
    // pause is for. (`ติดต่อเจ้าหน้าที่` is handled further up, before identity resolution, so it
    // stays reachable too and simply re-arms the pause.)
    //
    // FREE TEXT only (UAT 2026-09-06, §2.2 delta รอบ 6). The pause silences the ASSISTANT, not the
    // product: `/companies`, `เมนูหลัก`, `ถ่ายใบเสร็จ`, `บริการของเรา` and the draft-edit answers
    // are cards this code builds itself — no model, no cost, and each one a button the customer was
    // shown. Swallowing them filed a button press as a sentence for an operator to read and gave
    // back a confirmation nobody asked for. S-4's two phrases only count while its lane is lit; with
    // the flag off they are ordinary text and stay under the pause like any other sentence.
    const deterministicCommand = publicCommand !== null
      && (this.draftUpdate?.enabled === true
        || (publicCommand !== 'draft_update_confirm' && publicCommand !== 'draft_update_cancel'));
    if (!deterministicCommand
      && !parseLineCompanyCommand(event.messageText)
      && await this.assistantPaused(event.lineUserId)
      // A bare number is an answer only while the previous turn asked for one (review 2026-09-06
      // M1): the picker `/companies` returns says "ตอบ N". Digits-only text is the precondition of
      // that one read, so a sentence never pays it; the same helper resolves the selection below.
      && !(await this.pendingCompanySelectionCommand(event))) {
      // Staying out of the thread is not the same as swallowing it (UAT 2026-09-06): what they just
      // wrote goes onto the request the operator answers from, and only then may the reply say so.
      const recorded = await this.recordSupportFollowUp(event.lineUserId, requestId, { text: event.messageText });
      await this.deliverReply(event, SUPPORT_FOLLOW_UP_REPLIES[recorded]);
      await this.updateEventLog(event.webhookEventId, 'support_paused');
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
      if (await this.replyIfTermExpiredOwner(event, identity.userId)) return;
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
    this.deliveryAccess.set(event, { userId: identity.userId, companyId,
      fingerprint: resolvedLineDeliveryAccessFingerprint(identity.userId, companyId, resolvedAccess, entitledFeatureKeys),
      allowDuringSupportPause: deterministicCommand });
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

    // S-4 (spec §5.4): the two buttons on a draft-edit confirm card. Handled HERE — after company,
    // membership and permissions are resolved, before any AI turn — because the postback carries an
    // intent and nothing else: everything it acts on is re-derived from this chat (SEC-04). A
    // customer who types the same two phrases lands in exactly the same place, which is the
    // property that makes a forged `data` value harmless.
    // Gated on the flag, not just on the handler: with S-4 off these two phrases must behave the
    // way any other text did before S-4 — they fall through to the ordinary AI turn. Recognising
    // them as commands while the lane is dark would be a behaviour change a rollback cannot undo.
    if (this.draftUpdate?.enabled && (menuCommand === 'draft_update_confirm' || menuCommand === 'draft_update_cancel')) {
      await this.handleDraftUpdatePostback(event, {
        requestId, authSubject: identity.userId, userId: identity.userId, companyId,
        membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles,
        permissions: resolvedAccess.permissions, scopes: resolvedAccess.scopes, authProvider: 'line',
      }, resolvedAccess, menuCommand === 'draft_update_confirm');
      return;
    }

    // Owner 2026-09-06 (§8.2 residual): a capability question survives a shut AI lane — both gates
    // below keep their own words and their DENIED audit row, and add the scoped entitlement card.
    const capabilityHelp = isCapabilityQuestion(event.messageText)
      ? (lead: string) => capabilityEntitlementReply(lead, entitledFeatureKeys)
      : undefined;
    await this.recordShadowTurn(companyId);
    if (await this.refuseWhenLaunchRouteClosed(event, identity.userId, companyId, requestId, capabilityHelp)) return;
    if (lineAssistantDisabledFor(entitledFeatureKeys)) {
      if (capabilityHelp) await this.deliverRequiredMessages(event, capabilityHelp(formatRefusal('feature_disabled')));
      else await this.deliverReply(event, formatRefusal('feature_disabled'));
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
      await this.updateEventLog(event.webhookEventId,
        capabilityHelp ? CAPABILITY_ENTITLEMENT_STATUS : 'feature_disabled',
        LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE, companyId);
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
        await this.replyPendingMediaFailure(event, companyId, requestId, error);
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
        try {
          await this.resolvePendingMediaAsReceipt(
            event, requestId, identity.userId, companyId, resolvedAccess, pendingMedia, normalizedText,
            splitReply?.remainder,
          );
        } catch (error) {
          // Same rule as the answer above: a data state the sender can fix gets its own sentence and
          // leaves the row PENDING; anything else is still a real fault and belongs to the dispatcher.
          if (!lineCaptureFailureReply(error, BRANCH_RETRY_ANSWER)) throw error;
          await this.replyPendingMediaFailure(event, companyId, requestId, error);
          return;
        }
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

    const conversationContext = canQuery ? await this.loadConversationContext(companyId, identity.userId) : undefined;
    const valueCandidates = computeValueCandidates(normalizedText);
    // Item 10F: chatKey = groupId ?? roomId ?? userId (same as the buffer); open waiting_user
    // ledger entries ride the turn as DATA so the model can complete the ORIGINAL request.
    const chatKey = event.pushTargetId ?? event.lineUserId;
    const expenseDraftCtx: RequestContext = {
      requestId, authSubject: identity.userId, userId: identity.userId, companyId,
      membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles,
      permissions: resolvedAccess.permissions, scopes: resolvedAccess.scopes, authProvider: 'line',
    };
    let openWaiting: Awaited<ReturnType<LineAiLedgerService['openWaitingUser']>>;
    try {
      openWaiting = this.ledger ? await this.ledger.openWaitingUser(companyId, chatKey, identity.userId) : [];
    } catch (err) {
      // Consumption-marker state is unreadable. Continuing with "no open clarifications" is NOT
      // fail-closed: a bare "590" answering an earlier question would be routed as a new capture.
      if (!(err instanceof ConsumptionMarkerUnavailableError)) throw err;
      // `reason` separates a missing consumer group, an unreadable Redis and an incomplete scan for
      // operators; the customer reply and the terminal status stay the same for all of them.
      this.logger.warn({ msg: 'line_ai_marker_unavailable', requestId, reason: err.reason });
      await this.deliverReply(event, ERROR_REPLY);
      await this.updateEventLog(event.webhookEventId, 'marker_unavailable', 'CONSUMPTION_MARKER_UNAVAILABLE', companyId);
      return;
    }
    if (!await this.waitingSourcesCurrent(event, expenseDraftCtx, openWaiting)) return;
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
    let activeExpenseDrafts = expenseDraftConversationEnabled && canCaptureExpense && this.expenseDraftConversation
      ? await this.expenseDraftConversation.routeContexts(expenseDraftCtx, chatKeyHashOf(event))
      : [];
    let draftRouteSnapshot = JSON.stringify(activeExpenseDrafts);
    const draftRouteCurrent = async () => {
      if (!expenseDraftConversationEnabled || !canCaptureExpense || !this.expenseDraftConversation) return true;
      try {
        if (JSON.stringify(await this.expenseDraftConversation.routeContexts(expenseDraftCtx, chatKeyHashOf(event))) === draftRouteSnapshot) return true;
      } catch { /* An unavailable source cannot authorize the retained route. */ }
      await this.denyBusinessDelivery(event, 'LINE_DELIVERY_SOURCE_CHANGED', this.deliveryAccess.get(event));
      return false;
    };
    const statusQuestion = receiptStatusQuestion(normalizedText);
    // §17.5, deterministic and BEFORE any model: a question about a file that may never have become
    // an expense cannot be answered from the expense list, and must still answer when AI is down.
    if (statusQuestion === 'file_attempt') {
      const answered = await this.answerFileAttemptQuestion(event, expenseDraftCtx, resolvedAccess, {
        userId: identity.userId, companyId, normalizedText,
      });
      if (answered) return;
    }
    if (statusQuestion === 'receipt' || (statusQuestion === 'contextual' && openWaiting.length === 0)) {
      const listLink = absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses`);
      let reply = `ตอนนี้ยังตรวจสอบสถานะใบเสร็จให้ไม่ได้ค่ะ เปิดดูรายการล่าสุดได้ที่ ${listLink}`;
      if (!canCaptureExpense) reply = receiptDeniedReply(resolvedAccess);
      else try {
        const rows = this.expenseRepo ? await listRecentLineCaptureCandidates(this.expenseRepo, {
          companyId, userId: identity.userId, chatKeyHash: chatKeyHashOf(event), scopes: resolvedAccess.scopes,
          take: 5, includeAllStatuses: true,
        }) : [];
        const lines: string[] = [];
        for (const row of rows) {
          const expense = await this.expenseRepo!.findByIdWithRelations(companyId, row.id, undefined, resolvedAccess.scopes);
          if (!expense || expense.id !== row.id || expense.companyId !== companyId || expense.createdByUserId !== identity.userId
            || expense.captureSource !== 'LINE_UPLOAD'
            || expense.sourceChannelMetadataJson?.chatKeyHash !== chatKeyHashOf(event)) continue;
          this.rememberReceiptDeliverySource(event, expenseDraftCtx, expense);
          const number = typeof expense.vendorDocumentNumber === 'string'
            ? expense.vendorDocumentNumber.replace(/[\r\n]/gu, ' ').slice(0, 60) : '';
          const verification = expense.aiVerificationSummaryJson?.status === 'OCR_FAILED' ? 'FAILED'
            : expense.sourceChannelMetadataJson?.receiptCapturePending === true ? 'VERIFYING' : expense.aiVerificationStatus;
          const amountValue = Number(expense.grandTotalAmount);
          const amount = expense.grandTotalAmount == null || !Number.isFinite(amountValue)
            || (amountValue === 0 && (verification === 'FAILED' || verification === 'VERIFYING' || expense.status === 'EXTRACTING'))
            ? 'ยังไม่ทราบยอด'
            : `${amountValue.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${expense.currency && expense.currency !== 'THB' ? expense.currency : 'บาท'}`;
          lines.push(`${lines.length + 1}) ${number ? `บิล ${number} · ` : ''}${amount}\n${receiptProgressLabel(expense.status, verification)}\nเปิดรายการที่ ${lines.length + 1}: ${absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${expense.id}`)}`);
        }
        // §17.5 / appendix §3: a LINE file that has not (yet) become an expense is still real work.
        // It lives in the capture aggregate, which the expense list above cannot see — so the same
        // question is answered from the group's own read state rather than with "ยังไม่พบรายการ".
        const openGroups = lines.length === 0 && this.captureLine
          ? await this.captureLine.listOpenChatGroupProgress({
            companyId, userId: identity.userId, lineChatKeyHash: chatKeyHashOf(event),
            windowMs: LINE_RECENT_CAPTURE_WINDOW_MS,
          }).catch(() => [])
          : [];
        reply = lines.length
          ? `ตรวจพบรายการล่าสุดจากแชทนี้ ${lines.length} ใบค่ะ\n\n${lines.join('\n\n')}\n\nถ้ายังมีรูปที่ไม่ปรากฏในรายการนี้ ระบบยังยืนยันผลของรูปนั้นไม่ได้ค่ะ\nดูรายการทั้งหมด: ${listLink}`
          : openGroups.length
            ? openGroups.map((group) => captureGroupStatusReply(
              absoluteWebLink(this.config.webBaseUrl, group.webPath), group.reading,
            )).join('\n\n')
            : `ยังไม่พบรายการจากแชทนี้ในช่วง 24 ชั่วโมงล่าสุด จึงยังยืนยันว่าอ่านเสร็จไม่ได้ค่ะ\nดูรายการในเว็บ: ${listLink}`;
      } catch (error) {
        this.logger.warn({ msg: 'line_receipt_status_unavailable', ...safeLineErrorDetails(error) });
      }
      await this.deliverCompletedReply(event, reply, companyId, resolvedAccess);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: reply, intent: 'UNKNOWN',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }
    const interruptExpenseDraft = async (excludeExpenseIds: string[] = []) => activeExpenseDrafts
      .some((draft) => draft.status === 'OPEN' && !excludeExpenseIds.includes(draft.expenseId))
      && this.expenseDraftConversation
      ? this.expenseDraftConversation.interruptOpen(expenseDraftCtx, chatKeyHashOf(event), excludeExpenseIds)
      : undefined;
    if (activeExpenseDrafts.length > 0 && this.expenseDraftConversation
      && isDeterministicLineExpenseDraftInput(normalizedText)) {
      if (!await draftRouteCurrent() || !await this.mayDeliverBusinessReply(event)) return;
      const result = await this.expenseDraftConversation.execute(expenseDraftCtx, {
        messageText: normalizedText,
        chatKeyHash: chatKeyHashOf(event),
        webhookEventId: event.webhookEventId,
      });
      if (result.handled) {
        this.rememberContinuationDeliverySource(event, expenseDraftCtx, result);
        await this.deliverCompletedReplies(event, this.withDraftWebLink(result.replyTexts, companyId, result.expenseId), companyId, resolvedAccess, undefined, true);
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
        this.rememberCandidateDeliverySources(event, expenseDraftCtx, recentCapturedExpenses);
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
          const interruption = await interruptExpenseDraft();
          // Pausing a questionnaire can itself update this record. Answer from the committed
          // current row after that write rather than rejecting our own metadata revision.
          const current = await this.expenseRepo.findByIdWithRelations(companyId, candidate.id, undefined, resolvedAccess.scopes);
          if (!current) {
            await this.denyBusinessDelivery(event, 'LINE_DELIVERY_SOURCE_CHANGED', this.deliveryAccess.get(event));
            return;
          }
          const category = current.expenseCategoryId
            ? (await this.expenseRepo.listCategories(companyId)).find((item) => item.id === current.expenseCategoryId)
            : undefined;
          this.rememberReceiptDeliverySource(event, expenseDraftCtx, current, category);
          const reply = `${formatGroundedReceiptFollowUp(this.config.webBaseUrl, companyId, current, category?.name, normalizedText)}${interruption ? `\n\n${interruption}` : ''}`;
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
      const waitingChoices = openWaiting.filter(item => item.clarifyForIntent === 'SUBSTITUTE_RECEIPT_CONTINUATION' && item.candidateExpenseIds?.length);
      if (waitingChoices.length > 1) {
        await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting, waitingChoices.map(item => item.id), 'clarification_ambiguous');
        await this.denyBusinessDelivery(event, 'LINE_DELIVERY_SOURCE_CHANGED', this.deliveryAccess.get(event));
        return;
      }
      const originalChoiceIds = waitingChoices[0]?.candidateExpenseIds;
      if (!await this.mayDeliverBusinessReply(event)) return;
      const captured = await this.captureBeforeSubstituteContinuation(
        event, continuationCtx, normalizedText, captureFirstAmount, carriedSubstituteIntent,
      );
      // Park older questionnaires before producing source-bound substitute facts. If this turns
      // out to be a side question, the later router must receive the resulting current context.
      const interruption = await interruptExpenseDraft(captured ? [captured.expense.id] : []);
      if (expenseDraftConversationEnabled && canCaptureExpense && this.expenseDraftConversation) {
        activeExpenseDrafts = await this.expenseDraftConversation.routeContexts(expenseDraftCtx, chatKeyHashOf(event));
        draftRouteSnapshot = JSON.stringify(activeExpenseDrafts);
      }
      let captureReply = captured
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
          ...(originalChoiceIds ? { boundCandidateExpenseIds: originalChoiceIds } : {}),
          recentCandidates: originalChoiceIds
            ? originalChoiceIds.map(id => ({ id, label: id }))
            : captured
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
        if (captured) this.rememberReceiptDeliverySource(event, continuationCtx, captured.expense);
        this.logger.warn({ msg: 'line_substitute_continuation_after_capture_failed', requestId, ...safeLineErrorDetails(error) });
        const degraded = `${captureReply}\n\n${SUBSTITUTE_ADDITIONAL_OUTCOME_LABEL}\n${SUBSTITUTE_ADDITIONAL_OUTCOME_DEGRADED}`;
        await this.deliverCompletedReply(event, degraded, companyId, resolvedAccess);
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: degraded, intent: 'EVIDENCE_CAPTURE',
        });
        await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
        return;
      }
      this.rememberSubstituteDeliverySource(event, continuationCtx, result);
      if (captured) captureReply = (await this.savedReceiptReplies(event, companyId, captured.expense.id)).join('\n');
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
          await this.appendSourceBoundClarifications(event, {
          messagingChannelId: event.messagingChannelId,
            companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
            userId: identity.userId,
            items: [{
              text: carriedIntentArmed ? SUBSTITUTE_TARGET_PENDING_TEXT : 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ',
              state: 'waiting_user',
              clarifyQuestion: result.pendingQuestion ?? SUBSTITUTE_TARGET_PENDING_QUESTION,
              intent: 'CLARIFY',
              clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION',
              ...(result.candidateExpenseIds?.length ? { candidateExpenseIds: result.candidateExpenseIds } : {}),
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
      this.rememberCandidateDeliverySources(event, expenseDraftCtx, recentCapturedExpenses);
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

    const routedWaiting = openWaiting.filter(item => aiOpenClarifications?.some(clarification => clarification.id === item.id));
    if (!await this.waitingSourcesCurrent(event, expenseDraftCtx, routedWaiting)) return;
    this.clarificationRouteSources.set(event, { candidates: JSON.stringify(recentCapturedExpenses),
      ...(expenseDraftConversationEnabled && canCaptureExpense ? { draftRouting: draftRouteSnapshot } : {}),
    });

    // 5.5 LINE Intake Router first: semantic route before any source-module dispatch.
    // Deterministic guards (identity, company, permissions) already ran above.
    // One busy-wait budget for the WHOLE live turn (intake + gateway turn share it), so a turn
    // queued behind an in-flight media turn waits for the lease instead of bouncing the user.
    const busyWaitDeadlineMs = Date.now() + LINE_AI_LIVE_BUSY_WAIT_MS;
    const routePlan = await this.timeStage(event.webhookEventId, 'intake_route', () => this.tryRouteIntake({
      requestId,
      webhookEventId: event.webhookEventId,
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

    if (!await this.mayDeliverBusinessReply(event) || !await this.waitingSourcesCurrent(event, expenseDraftCtx, routedWaiting)) return;
    if (!await draftRouteCurrent()) return;
    if (recentCapturedExpenses.length) {
      if (!await this.correctionCandidatesCurrent(expenseDraftCtx, chatKeyHashOf(event), JSON.stringify(recentCapturedExpenses))) {
        await this.denyBusinessDelivery(event, 'LINE_DELIVERY_SOURCE_CHANGED', this.deliveryAccess.get(event));
        return;
      }
    }

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
      // §8.2: the same matcher that keeps the fixed card for strangers keeps the shortcut off a
      // linked caller's capability question — the scoped composer owns that answer.
      capabilityQuestion: isCapabilityQuestion(normalizedText),
    });
    if (advisorDirectText) {
      this.logger.log({ msg: 'line.ai.advisor_direct_served', requestId, companyId, context: 'ProcessLineWebhookUseCase' });
      // Same ordering as the exact-greeting lane: record what was decided, then deliver.
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: advisorDirectText, intent: 'UNKNOWN',
        // The one model call that wrote this reply, as the route response already reports it — before
        // this the direct lane's AiTurn row carried no model id and no duration at all (UAT 2026-09-06).
        modelId: routePlan.usage?.[0]?.modelId,
        durationMs: routePlan.usage?.reduce((total, entry) => total + entry.durationMs, 0),
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
        if (modelResolved.length > 1) {
          await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting, modelResolved, 'clarification_ambiguous');
          await this.denyBusinessDelivery(event, 'LINE_DELIVERY_SOURCE_CHANGED', this.deliveryAccess.get(event));
          return;
        }
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
        const waitingChoices = substituteClarifications.filter(item => item.candidateExpenseIds?.length);
        const originalOrdinal = /^\s*[1-5]\s*$/u.test(normalizedText) && waitingChoices.length === 1 ? waitingChoices[0] : undefined;
        const effectiveClar = resolvedClar ?? deterministicStartConfirmClar ?? originalOrdinal;
        if (!effectiveClar && waitingChoices.length > 0) {
          if (waitingChoices.length > 1) await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting,
            waitingChoices.map(item => item.id), 'clarification_ambiguous');
          await this.denyBusinessDelivery(event, 'LINE_DELIVERY_SOURCE_CHANGED', this.deliveryAccess.get(event));
          return;
        }
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
        const interruption = await interruptExpenseDraft();
        const result = await this.substituteReceiptContinuation.execute(continuationCtx, {
          messageText: normalizedText,
          chatKeyHash: chatKeyHashOf(event),
          recentCandidates: executeCandidates,
          ...(boundCandidateIds.length ? { boundCandidateExpenseIds: boundCandidateIds } : {}),
          // PRIMARY is the model-only route: a FRESH start that matches no deterministic entry phrase must
          // CONFIRM before it writes (no auto-create on the router's confidence alone).
          requireStartConfirmation: true,
          confirmedStart,
        });
        this.rememberSubstituteDeliverySource(event, continuationCtx, result);
        // PRECEDENCE when BOTH a substitute workflow AND an expense draft are open: the substitute path
        // (semantic route, OR the narrow canonical fallback taken because the provider was UNAVAILABLE)
        // wins THIS turn, and any OPEN expense draft is INTERRUPTED — paused with a note appended to the
        // reply, never silently dropped. So even with the router unreachable, a canonical substitute
        // command deterministically handles the substitute and preserves the draft to resume later.
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
          await this.appendSourceBoundClarifications(event, {
          messagingChannelId: event.messagingChannelId,
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
        await this.deliverRequiredMessages(event, [await this.timeStage(event.webhookEventId, 'render',
          () => this.withCompletionMenu(buildReimbursementPayerClarificationMessage(), companyId, resolvedAccess))]);
        await this.appendSourceBoundClarifications(event, {
          messagingChannelId: event.messagingChannelId,
          companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
          userId: identity.userId,
          items: [{
            text: normalizedText, state: 'waiting_user', clarifyQuestion: REIMBURSEMENT_PAYER_CLARIFY_REPLY,
            intent: 'CLARIFY', clarifyForIntent: 'REIMBURSEMENT_REQUEST_START',
          }],
        });
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
      if (result.handled) {
        this.rememberContinuationDeliverySource(event, expenseDraftCtx, result);
        await this.deliverCompletedReplies(event, this.withDraftWebLink(result.replyTexts, companyId, result.expenseId), companyId, resolvedAccess, undefined, true);
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: result.replyTexts.join('\n'), intent: 'CLARIFY',
        });
        await this.updateEventLog(event.webhookEventId, result.status === 'UPDATED' ? 'clarification_required' : 'completed', undefined, companyId);
        return;
      }
      // No user-initiated draft edit: let the original message take the normal query path.
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
      // Resolved OUTSIDE `timeStage`: the stage measures the capture, not this lookup.
      const captureBranchId = await this.resolveLineCaptureBranchId(companyId, ctx.membershipId, ctx.scopes ?? {});
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
          // Same LINE branch rule the photo lanes use — a text note in a multi-branch company hit
          // the identical TRANSACTION_BRANCH_REQUIRED dead end.
          branchId: captureBranchId,
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
        await this.appendSourceBoundClarifications(event, {
          messagingChannelId: event.messagingChannelId,
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
      this.rememberReceiptDeliverySource(event, ctx, captured.expense,
        captured.categoryNameSourceId && captured.categoryName ? { id: captured.categoryNameSourceId, name: captured.categoryName } : undefined);
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
      const resolvedChoices = openWaiting.filter(item => item.clarifyForIntent === 'EXPENSE_CAPTURE_CORRECTION'
        && routePlan.resolvedClarificationIds?.includes(item.id) && item.candidateExpenseIds?.length);
      if (resolvedChoices.length > 1) {
        await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting, resolvedChoices.map(item => item.id), 'clarification_ambiguous');
        await this.denyBusinessDelivery(event, 'LINE_DELIVERY_SOURCE_CHANGED', this.deliveryAccess.get(event));
        return;
      }
      const originalIds = resolvedChoices[0]?.candidateExpenseIds;
      const originalCandidates = originalIds ? await this.loadCorrectionCandidates(companyId, identity.userId,
        chatKeyHashOf(event), resolvedAccess.scopes, originalIds) : recentCapturedExpenses;
      const correctionCandidates = originalIds ? originalIds.flatMap(id => originalCandidates.filter(item => item.id === id)) : originalCandidates;
      if (originalIds && correctionCandidates.length !== originalIds.length) {
        await this.denyBusinessDelivery(event, 'LINE_DELIVERY_SOURCE_CHANGED', this.deliveryAccess.get(event));
        return;
      }
      const correctionPlan = this.planConsumption(companyId, chatKey, identity.userId, openWaiting, routePlan.resolvedClarificationIds, 'correction_apply');
      const correctionCtx: RequestContext = {
        requestId, authSubject: identity.userId, userId: identity.userId, companyId,
        membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles,
        permissions: resolvedAccess.permissions, scopes: resolvedAccess.scopes, authProvider: 'line',
      };
      const correctionEvidence = buildCorrectionEvidence(normalizedText, openWaiting, routePlan.resolvedClarificationIds);
      // S-4 (spec §5.4/§5.5): money, charges, VAT and whole lines are NOT the five-field correction
      // lane's to write — it would have answered "ยังไม่ได้แก้ยอด" and pointed at the web. They now
      // route to the draft tools, which PREVIEW the change and wait for [ยืนยัน].
      //
      // The detector is an allowlist and runs only here, where the intake router has already
      // classified this turn as a correction of a record THIS user captured in THIS chat — the route
      // is the own-record marker, and the detector additionally refuses a message that names
      // somebody else's document. `amount` is handled below because it arrives as a router HINT
      // rather than as words this function can read.
      const draftRequest = detectLineDraftEditRequest(normalizedText)
        ?? this.amountCorrectionAsDraftEdit(routePlan.correctionHints, correctionCandidates);
      const draftOutcome = draftRequest && this.draftUpdate?.enabled
        ? await this.proposeDraftUpdate(event, correctionCtx, resolvedAccess, draftRequest, correctionEvidence,
          correctionCandidates.length === 1 ? correctionCandidates[0]!.id : undefined)
        : 'not_handled';
      if (draftOutcome !== 'not_handled') {
        await this.ackConsumed(correctionPlan, draftProposalAckReason(draftOutcome));
        return;
      }
      // Try to apply; every guard failure degrades to the guidance reply — never to a create.
      const applied = this.correctExpense
        ? await this.correctExpense.execute(correctionCtx, {
          lineMessageIdHash: hashMessagePreview(event.lineMessageId ?? event.webhookEventId),
          chatKeyHash: chatKeyHashOf(event),
          candidates: correctionCandidates,
          ...(routePlan.correctionHints ? { hints: routePlan.correctionHints } : {}),
          evidence: correctionEvidence,
          ...(correctionPlan ? { consumption: correctionPlan.consumption } : {}),
        })
        : { status: 'guidance' as const, reason: 'correction_module_unavailable' };

      let reply: string;
      if (applied.status === 'applied') {
        this.rememberReceiptDeliverySource(event, correctionCtx, { id: applied.expenseId,
          updatedAt: applied.source?.id === applied.expenseId ? applied.source.updatedAt : undefined });
        await this.ackConsumed(correctionPlan, 'correction_apply');
        reply = formatCorrectionAppliedReply(this.config.webBaseUrl, companyId, applied.expenseId, applied.fields, normalizedText, applied.noteOutcome);
      } else if (applied.status === 'clarify') {
        reply = CORRECTION_DIRECTION_CLARIFY_REPLY;
      } else {
        this.rememberCandidateDeliverySources(event, expenseDraftCtx, correctionCandidates, Boolean(originalIds));
        reply = formatCorrectionGuidanceReply(this.config.webBaseUrl, companyId, correctionCandidates, canEdit, applied.reason);
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
        targetType: correctionCandidates.length === 1 ? 'expense_record' : 'LineWebhookEvent',
        targetId: correctionCandidates.length === 1 ? correctionCandidates[0].id : event.webhookEventId,
        requestId, result: 'SUCCESS', riskLevel: 'LOW',
        metadataJson: { candidateCount: correctionCandidates.length, canEdit, outcome: applied.status },
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
      if (recentCapturedExpenses.length) this.rememberCandidateDeliverySources(event, expenseDraftCtx, recentCapturedExpenses);
      const clarifyReply = routePlan.clarifyQuestion ?? CLARIFY_REPLY;
      await this.deliverReply(event, clarifyReply);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: clarifyReply, intent: 'CLARIFY',
      });
      // Item 10F: the clarified request waits in the ledger; the next turn carries it and the
      // reclaim expires it silently (audited) when the user never answers.
      await this.appendSourceBoundClarifications(event, {
          messagingChannelId: event.messagingChannelId,
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

    // Read/composer turns retain their original input proof through the final reply and fallback.
    // Mutation lanes returned above and deliver from their own committed result source instead.
    if (!await this.waitingSourcesCurrent(event, expenseDraftCtx, routedWaiting)) return;
    if (routedWaiting.length) this.deliveryWaitingSources.set(event, { context: expenseDraftCtx, items: routedWaiting });

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
      // Chat provenance for read tools that resolve "บิลเมื่อกี้" (spec §5.5). Same hash the intake
      // lane stores on a LINE-captured record, so the tool sees the SAME chat the correction lane
      // does. Never the raw LINE id — that stays redacted above.
      chatKeyHash: chatKeyHashOf(event),
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
      // S-3: bind the TRUSTED outer intake route on EVERY turn, from the already-parsed
      // `LineIntakeRoutePlan.intent` (membership-validated, never from the untrusted wrapper).
      // It used to ride only when a prepared plan was forwarded, which meant a plain
      // BUSINESS_READ_QUESTION reached the gateway with no provenance at all and the orchestrator
      // could not tell an in-system business question from an out-of-scope one (evidence E4).
      // Binding it alone activates NO lane: the prepared simple-read lane additionally requires
      // `req.preparedPlan`, which is still forwarded only under its own flags below.
      ...(asIntakeRouteIntent(routePlan.intent) ? { intakeIntent: asIntakeRouteIntent(routePlan.intent) } : {}),
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

    // Spec §9.2 / B-02: the money gate already refused this turn at the intake router, so the model
    // call below would meet the SAME closed gate a second time — a second `ai.company_budget.exceeded`
    // security event for one message, and a ledger turn the drain then retries against a gate that
    // cannot open this month. Answered here, AFTER every deterministic fallback above has had its
    // chance (those cost nothing and must keep working while the money is out) and BEFORE the ledger
    // entry, so nothing is queued for a retry that cannot succeed. The reply is the same one the
    // gateway-failure branch below sends, because it is the same refusal.
    // BUSY is deliberately NOT short-circuited: its lease frees between calls, so the turn keeps its
    // existing bounded wait and its existing ledger follow-up.
    if (routePlan.budgetErrorCode && routePlan.budgetErrorCode !== AI_BUDGET_REFUSAL_CODES.busy) {
      const permanent = isAiBudgetPermanentRefusal(routePlan.budgetErrorCode);
      await (permanent
        ? this.deliverRequiredMessages(event, [buildAiBudgetExceededMessage(await this.isTrialTier(companyId), routePlan)])
        : this.deliverReply(event, AI_BUDGET_UNAVAILABLE_REPLY));
      await this.updateEventLog(
        event.webhookEventId,
        permanent
          ? (routePlan.budgetErrorCode === AI_BUDGET_REFUSAL_CODES.insufficient ? 'ai_budget_insufficient' : 'ai_budget_exceeded')
          : 'provider_unavailable',
        routePlan.budgetErrorCode,
        companyId,
        routePlan.budgetScope ? { budgetScope: routePlan.budgetScope } : undefined,
      );
      return;
    }

    // 7.5 Item 10F: durable `turn` entry BEFORE the gateway call — a crash mid-turn leaves it
    // unacked and the reclaim worker re-runs it (at-least-once is safe: read-only channel).
    const ledgerTurnId = this.ledger
      ? await this.ledger.appendTurn({
          messagingChannelId: event.messagingChannelId,
          companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
          userId: identity.userId, text: normalizedText,
          ...(valueCandidates && { valueCandidates }),
          // Carried so a reclaimed turn reaches the gateway with the SAME trusted provenance the
          // live turn had — otherwise a drained E4 turn is told it is out of scope (spec §5.3).
          ...(turnRequest.intakeIntent ? { intakeIntent: turnRequest.intakeIntent } : {}),
        })
      : null;

    // 8. Call AI Gateway
    let turnResponse: LineAiTurnResponse;
    try {
      turnResponse = await this.timeStage(event.webhookEventId, 'gateway_turn', () => this.aiGateway.requestLineTurn(turnRequest, { busyWaitDeadlineMs }));
    } catch (err) {
      this.logger.error({ msg: 'AI Gateway error', requestId, ...safeLineErrorDetails(err) });
      const failure = classifyLineAiGatewayFailure(err);
      // G-05: the month's AI budget is spent. Waiting cannot fix it, so this is the one gateway
      // failure that gets a card instead of a "try again" line — and the one that must NOT leave a
      // ledger entry for the reclaim worker to keep retrying against a closed admission.
      if (failure.replyKind === 'budget_exceeded') {
        await this.deliverRequiredMessages(event, [
          buildAiBudgetExceededMessage(await this.isTrialTier(companyId), { budgetErrorCode: failure.budgetCode, budgetScope: failure.budgetScope }),
        ]);
        if (ledgerTurnId && this.ledger) {
          await this.ledger.ack(
            { key: ledgerKey(companyId, chatKey), id: ledgerTurnId, companyId, turnId: requestId, kind: 'turn' },
            'refused',
            { reason: failure.budgetCode ?? 'ai_monthly_budget_exceeded' },
          );
        }
        await this.updateEventLog(event.webhookEventId, failure.status, failure.errorCode, companyId,
          failure.budgetScope ? { budgetScope: failure.budgetScope } : undefined);
        return;
      }
      if (ledgerTurnId) this.intermediateDeliveries.add(event);
      await this.deliverReply(
        event,
        failure.replyKind === 'timeout'
          ? formatRefusal('ai_timeout')
          // The meter could not be read — say that, rather than the generic "something broke".
          : failure.replyKind === 'budget_unavailable' ? AI_BUDGET_UNAVAILABLE_REPLY
          // With a ledger entry the reclaim drain WILL answer this turn — say so instead of
          // inviting a resend that would double-answer. No entry ⇒ the legacy resend copy.
          : failure.replyKind === 'rate_limited' ? (ledgerTurnId ? BUSY_FOLLOW_UP_REPLY : RATE_LIMIT_REPLY) : ERROR_REPLY,
      );
      await this.updateEventLog(event.webhookEventId, failure.status, failure.errorCode, companyId,
        failure.budgetScope ? { budgetScope: failure.budgetScope } : undefined);
      // The turn entry stays unacked on purpose: the reclaim worker retries it later and
      // pushes the answer, so a gateway outage cannot silently lose the request.
      return;
    }

    // The API's own read rows are authoritative even when gateway telemetry omits them.
    this.deliverySources.set(event, { requestId, ids: await this.readEvidence.forTurn(turnRequest, turnResponse).catch(() => null) });

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
    // S-4 (spec §5.4): when the gateway's plan reached one of the five `draft_update` tools, the
    // API has already computed and stored a preview for THIS turn — the tool call is the proposal,
    // the card is the question, and the write is still the confirm postback. The card is built
    // here rather than by the gateway because only the API may print the buttons whose postbacks
    // it will have to re-derive (SEC-04), and because every figure on it comes from the server's
    // own rolled-back run, never from model text.
    const hasDraftPreview = turnResponse.toolsInvoked.some((tool) => (LINE_DRAFT_UPDATE_TOOLS as readonly string[]).includes(tool));
    const draftPreview = hasDraftPreview
      ? await this.draftUpdate?.pendingPreview(expenseDraftCtx, chatKeyHashOf(event), requestId)
      : null;
    if (hasDraftPreview && (draftPreview || !turnResponse.refused)) this.deliveryDraftPreviews.set(event, {
      context: expenseDraftCtx, chatKeyHash: chatKeyHashOf(event), requestId, previewId: draftPreview?.previewId ?? null, phase: 'PENDING',
    });
    const delivery = await this.deliverMessages(
      event,
      draftPreview ? [completionMessage, buildDraftUpdatePreviewCard(draftPreview)] : [completionMessage],
    );
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
        await this.appendSourceBoundClarifications(event, {
          messagingChannelId: event.messagingChannelId,
          companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
          userId: identity.userId,
          items: [{
            text: 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ', state: 'waiting_user',
            clarifyQuestion: substituteInterruption.pendingQuestion, intent: 'CLARIFY',
            clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION',
            ...(substituteInterruption.candidateExpenseIds?.length ? { candidateExpenseIds: substituteInterruption.candidateExpenseIds } : {}),
          }],
        });
      }
    }

    // 10.5 Acknowledge work only after delivery. Clarifications and uncovered
    // sub-requests are now safe to advance because the employee saw this turn.
    if (this.ledger) {
      const subRequests = this.ledger.coverageToSubRequests(turnResponse.coverage);
      if (subRequests.length > 0) {
        await this.appendSourceBoundClarifications(event, {
          messagingChannelId: event.messagingChannelId,
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
      where: { userId, status: 'ACTIVE', company: {
        OR: [{ status: 'ACTIVE' }, { status: 'DISABLED', planTerm: { termDisabledAt: { not: null } } }],
      } },
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

  /**
   * บริษัทของฉัน bubbles, each carrying its OWN one-tap web link where one could be minted.
   *
   * Owner 2026-09-06: "มี 2 ปุ่ม … อีกปุ่มคือสลับบริษัทและพาไปเว็บไซต์ตามบริษัทนั้น". The delivery
   * seam cannot do this: it binds ONE recipient company to a whole message, and `isSafeHandoffPath`
   * refuses a path under any other company — which is exactly right, and exactly why a picker of N
   * companies mints N tokens here instead. Only the bubbles this page actually shows get one.
   *
   * `lineUserId` is the chat's own id — the same key `LineCompanyContext` is upserted under below —
   * so the exchange-time switch lands on the row this conversation reads.
   *
   * Absent seam (LINE_WEB_HANDOFF_ENABLED off) or a failed mint returns items with no `webUrl`, and
   * the picker then renders exactly what it rendered before this feature existed.
   */
  private async companyPickerItems(
    event: LineTextEvent,
    userId: string,
    memberships: LineCompanyMembership[],
    currentCompanyId: string | undefined,
    page: number | undefined,
  ): Promise<CompanyPickerItem[]> {
    const items: CompanyPickerItem[] = memberships.map((membership) => ({
      companyId: membership.companyId,
      companyName: companyLabel(membership),
    }));
    if (!this.handoffLinks) return items;
    const visible = new Set(companyPickerPage(items, currentCompanyId, page).visible.map((item) => item.companyId));
    return Promise.all(items.map(async (item) => (visible.has(item.companyId)
      ? {
        ...item,
        webUrl: await this.handoffLinks!.linkFor(
          { userId, companyId: item.companyId, lineUserId: event.lineUserId, surface: LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN },
          `/companies/${item.companyId}/dashboard`,
        ) ?? undefined,
      }
      : item)));
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
      const currentCompanyId = current?.companyId ?? (memberships.length === 1 ? memberships[0]!.companyId : undefined);
      const currentMembership = memberships.find((membership) => membership.companyId === currentCompanyId);
      if (!currentMembership) {
        await this.deliverRequiredMessages(event, [buildCompanyPickerMessage(
          await this.companyPickerItems(event, userId, memberships, undefined, command.page),
          undefined,
          command.page,
        )]);
        await this.updateEventLog(event.webhookEventId, 'needs_company_selection', LINE_AI_ERROR_CODES.AMBIGUOUS_COMPANY);
        return;
      }
      // UAT 2026-09-06 "สมัครแล้วแต่บริษัทหาย": the shop this owner applied for is not a membership
      // yet, so nothing on this screen mentioned it. Same read the door card does, so the two
      // entrances keep agreeing about "still open" — and while one IS open the card withholds the
      // button, because the LIFF form behind it can only answer `line_signup_already_pending`.
      const pendingSignup = await this.findOpenLineSignup(event.lineUserId);
      const messages: LineReplyMessage[] = [buildCompanyContextMessage({
        companyName: companyLabel(currentMembership),
        displayName,
        roleLabels: companyRoleLabels(currentMembership),
        isOwner: isCompanyOwner(currentMembership),
        newShopSignupUrl: this.newShopSignupUrl(),
        pendingSignupName: pendingSignup?.companyName,
        // Owner 2026-09-06: the picker below is only pushed to a multi-company member, so its
        // เปิดเว็บบริษัทนี้ button never reached the single-shop owner. Same mint, same surface — the
        // exchange-time switch simply re-selects the company the chat is already on. A multi-company
        // member gets a second token on the current company's bubble too; tokens are single-use, so
        // sharing one between the two cards would break whichever the reader tapped second.
        openWebUrl: await this.handoffLinks?.linkFor(
          { userId, companyId: currentMembership.companyId, lineUserId: event.lineUserId, surface: LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN },
          `/companies/${currentMembership.companyId}/dashboard`,
        ) ?? undefined,
      })];
      if (memberships.length > 1) {
        messages.push(buildCompanyPickerMessage(
          await this.companyPickerItems(event, userId, memberships, currentMembership.companyId, command.page),
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
      // `aiPausedUntil` is KEPT here on purpose, unlike the signup and link paths that clear it.
      // The same person is switching between their own shops mid-conversation; the §8 hold means a
      // human is handling this thread, and typing a shop name is not a request to hand it back.
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
    /** Lineage of an intake lane that answered from its own model call (advisor direct answer). */
    modelId?: string;
    durationMs?: number;
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
            ...(input.modelId !== undefined && { modelId: input.modelId }),
            ...(input.durationMs !== undefined && { durationMs: input.durationMs }),
          },
        });
      });
    } catch (err) {
      this.logger.warn({ msg: 'Intake turn memory persist failed', webhookEventId: input.webhookEventId, ...safeLineErrorDetails(err) });
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
  private async timeStage<T>(webhookEventId: string, stage: 'intake_route' | 'gateway_turn' | 'capture_execute' | 'render' | 'persistence' | 'line_delivery' | 'receipt_download' | 'receipt_upload' | 'receipt_upload_complete' | 'receipt_ocr' | 'receipt_ocr_apply', fn: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      return await fn();
    } catch (error) {
      this.logger.warn({ msg: 'line.ai.stage_failed', webhookEventId, stage, ...safeLineErrorDetails(error) });
      throw error;
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

  private async loadConversationContext(companyId: string, userId: string): Promise<LineAiConversationContext | undefined> {
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
      },
    });
    if (rows.length === 0) return undefined;
    // AP21: tool permission/feature checks cannot prove a historical record is still in scope.
    // Even an unchanged actor can lose access when a record moves. The existing sourceRefs carry
    // locators, not current authorization. Keep the user's questions for follow-ups, but never
    // send stored derived replies; current business facts must be read through ERP tools. The
    // bounded stored preview is inspected only to recognize a fixed capability-help routing hint.
    // Its contents never enter model input, and the help examples use current access again.
    const recentTurns = [...rows].reverse().map((row) => {
      return {
        at: row.createdAt.toISOString(),
        ...(row.userMessagePreview && { userMessagePreview: row.userMessagePreview }),
        ...(row.intent && { intent: capabilityHistoryIntent(row.replyPreview) ?? String(row.intent) }),
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
    // A committed-stage marker belongs to this attempt, even if the caller reuses its input object.
    event = { ...event };
    delete (event as typeof event & { [SAVED_LINE_RECEIPT]?: SavedLineReceipt })[SAVED_LINE_RECEIPT];
    const admissionAttempt: LineReceiptAdmissionAttempt = { receiptRequested: false, usablePersisted: false };
    try {
      return (await this.executeReceiptUploadInner(event, captionText, admissionAttempt)) ?? { outcome: 'done' };
    } catch (err) {
      let saved = (event as typeof event & { [SAVED_LINE_RECEIPT]?: SavedLineReceipt })[SAVED_LINE_RECEIPT];
      if (!saved && event.handoff) {
        // CompleteReceiptUpload can commit the primary before duplicate/audit bookkeeping fails.
        // Re-read that committed boundary rather than asking the customer to send the image again.
        const captured = await this.expenseRepo?.findByLineMessageId(event.handoff.companyId, event.lineMessageId).catch(() => null);
        if (captured?.primaryAttachmentId && captured.createdByUserId === event.handoff.userId
          && captured.sourceChannelMetadataJson?.chatKeyHash === chatKeyHashOf(event)) {
          saved = { expenseId: captured.id, companyId: event.handoff.companyId, uploaded: true };
        }
      }
      this.logger.error({ msg: 'line_receipt_stage_failed', webhookEventId: event.webhookEventId,
        stage: err instanceof LineDeliveryError ? 'line_delivery' : saved ? 'receipt_after_capture' : 'receipt_before_capture',
        ...(saved ? { expenseId: saved.expenseId, companyId: saved.companyId } : {}), ...safeLineErrorDetails(err) });
      if (err instanceof LineDeliveryError) return { outcome: 'done' };
      if (saved?.uploaded) {
        const texts = await this.savedReceiptReplies(event, saved.companyId, saved.expenseId);
        await this.deliverRequiredMessages(event, texts.map((text) => buildLineAssistantTextCardMessage(text, this.config.webBaseUrl, saved!.companyId))).catch(() => {});
        await this.updateEventLog(event.webhookEventId, 'completed', undefined, saved.companyId);
        return { outcome: 'done' };
      }
      // Branch ambiguity is a data-setup state, not a transient fault: say what to do instead of
      // the "ชั่วคราว ลองใหม่" copy that retries into the identical failure (Owner 2026-08-27).
      const deterministic = lineCaptureFailureReply(err, BRANCH_RETRY_RESEND);
      if (deterministic) {
        this.logger.warn({ msg: 'LINE receipt upload needs branch selection', webhookEventId: event.webhookEventId });
        await this.deliverReply(event, deterministic.reply).catch(() => {});
        await this.updateEventLog(event.webhookEventId, deterministic.status, deterministic.errorCode);
        return { outcome: 'done' };
      }
      this.logger.error({ msg: 'LINE receipt upload error', webhookEventId: event.webhookEventId, ...safeLineErrorDetails(err) });
      await this.deliverReply(event, mediaProcessingFailedReply(event.messageType)).catch(() => {});
      await this.releaseWebhookEvent(event.webhookEventId, 'RETRYABLE_RECEIPT_UPLOAD_ERROR');
      return { outcome: 'done' };
    } finally {
      if (admissionAttempt.receiptRequested && !admissionAttempt.usablePersisted && admissionAttempt.identity && admissionAttempt.companyId) {
        await releaseCompanyOcrAdmission(this.prisma, {
          companyId: admissionAttempt.companyId, sourceRoute: 'receipt-ocr-line', requestId: event.lineMessageId,
          eventId: admissionAttempt.identity.eventId, reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT',
        });
      }
    }
  }

  private async executeReceiptUploadInner(event: LineReceiptUploadEvent, captionText: string | undefined, admissionAttempt: LineReceiptAdmissionAttempt): Promise<LineMediaTurnOutcome | undefined> {
    const requestId = randomUUID();
    if (!await this.claimWebhookEvent(event.webhookEventId, event.lineUserId)) return { outcome: 'done' };

    // This lane has no pause gate of its own, so a customer answering a human WITH A PICTURE was
    // the one message that reached nobody at all. Stamped before anything else can refuse the
    // photo as a receipt: whether it is a valid receipt and whether a person is waiting for it are
    // different questions. ponytail: one indexed lookup per media event — cheap enough not to gate
    // it on the pause, which would miss an unlinked asker (who has no assistant to pause).
    //
    // A MARKER only, and a marker is not a follow-up: it moves no clock, reopens nothing and
    // re-arms no mute (N1). See `stampSupportMedia`.
    await this.stampSupportMedia(event.lineUserId);

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
        // A photo sent to an expired shop is still a message from its owner, and this branch is the
        // same "no company resolved" dead end the text turn hits.
        if (await this.replyIfTermExpiredOwner(event, identity.userId)) return;
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
    const entitledFeatureKeys = await loadEntitledFeatureKeys(this.prisma, companyId);
    this.deliveryAccess.set(event, { userId: identity.userId, companyId,
      fingerprint: resolvedLineDeliveryAccessFingerprint(identity.userId, companyId, access, entitledFeatureKeys) });
    if (lineAssistantDisabledFor(entitledFeatureKeys)) {
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
    if (this.config.lineAiTerminalOutcomeReplayEnabled) {
      const outcome = await this.prisma.client.lineTurnOutcome.findUnique({ where: { webhookEventId: event.webhookEventId } });
      if (outcome) {
        if (outcome.companyId && outcome.companyId !== companyId) throw new ForbiddenException('Receipt outcome belongs to another company.');
        const messages = parseOutcomeMessages(outcome.messagesJson);
        if (!messages) throw new LineDeliveryError('failed_permanent');
        await this.deliverRequiredMessages(event, messages);
        await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
        return;
      }
    }
    const existingCapture = canCaptureExpense
      ? await this.expenseRepo?.findByLineMessageId(companyId, event.lineMessageId) : null;
    if (existingCapture) {
      await this.resumeCapturedReceipt(event, ctx, access, existingCapture);
      return;
    }

    const downloaded = await this.timeStage(event.webhookEventId, 'receipt_download', () => this.downloadLineMedia(event.lineMessageId, event.messageType, event.fileName, event.fileSize));
    if (!downloaded.ok) {
      // §17.5: the reason is recorded BEFORE the payload scrub, so "ไฟล์เมื่อกี้ทำไมส่งไม่ได้" is
      // answerable after a restart from a row that never held the payload in the first place.
      await this.recordIntakeAttempt(event, {
        companyId, stage: 'DOWNLOAD', reasonCode: downloaded.reason, outcome: 'REJECTED',
        ...(downloaded.declaredFileSize !== undefined ? { declaredFileSize: downloaded.declaredFileSize } : {}),
        ...(downloaded.measuredByteSize !== undefined ? { measuredByteSize: downloaded.measuredByteSize } : {}),
      });
      await this.deliverReply(event, mediaDownloadFailedReply(event.messageType));
      await this.releaseWebhookEvent(event.webhookEventId, 'RETRYABLE_LINE_MEDIA_DOWNLOAD_FAILED', companyId);
      return;
    }
    const media = downloaded.media;
    const mediaRejectionReason = await this.lineMediaRejectionReason(media);
    if (mediaRejectionReason) {
      await this.recordIntakeAttempt(event, {
        companyId, stage: 'SECURITY', reasonCode: mediaRejectionReason, outcome: 'REJECTED',
        measuredByteSize: media.byteSize, fileName: media.fileName,
      });
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



    // A new provider message is distinct from transport retry. Only exact stored bytes prove
    // an existing capture; perceptual/OCR similarity keeps the normal duplicate review path.
    const exactIds = canCaptureExpense && media.checksumSha256
      ? await this.expenseRepo?.findExpenseIdsByAttachmentChecksum?.(companyId, '', media.checksumSha256, undefined, ctx.scopes ?? {}) : [];
    for (const expenseId of exactIds ?? []) {
      const exact = await this.expenseRepo!.findById(companyId, expenseId);
      if (!exact || exact.createdByUserId !== ctx.userId || exact.captureSource !== 'LINE_UPLOAD'
        || !isBranchInScope(ctx.scopes ?? {}, exact.branchId)
        || exact.sourceChannelMetadataJson?.chatKeyHash !== chatKeyHashOf(event)) continue;
      this.rememberReceiptDeliverySource(event, ctx, exact);
      await this.deliverCompletedReply(event, [
        '📷 รูปนี้ตรงกับบิลที่เก็บไว้แล้วค่ะ',
        ...(exact.vendorNameSnapshot ? [`ผู้ขาย – ${exact.vendorNameSnapshot}`] : []),
        `ยอดรวม – ${moneyLabel(exact.grandTotalAmount)} บาท`,
        `สถานะ – ${receiptProgressLabel(exact.status, exact.aiVerificationStatus)}`,
        `เปิดใบเสร็จเดิม: ${absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${exact.id}`)}`,
      ].join('\n'), companyId, access);
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    // ── Capture appendix §3, LINE column: a `file` is a DOCUMENT lane ──────────
    //
    // A LINE `file` never carried `contentBase64` (image-only at the download), so it reached the
    // router and OCR with nothing to look at and fell out as "clarify" with the bytes discarded
    // (IG20/E15). It now takes its own lane: download → security → capture group → async read →
    // result push. No OCR call, no `decideLineBusinessDocument`, and the bytes are persisted BEFORE
    // anything claims they were kept (§16.7 "ต้นฉบับต้อง persist ก่อนบอกเก็บไฟล์แล้ว").
    //
    // A chat with open substitute work keeps its existing arrival handler: a PDF scan of a signed
    // certificate belongs to THAT question, not to a new evidence group.
    if (event.messageType === 'file' && canCaptureExpense && this.captureLine && this.initReceiptUpload) {
      const substituteOpen = this.substituteReceiptContinuation && access.permissions.includes('expense.receipt.upload')
        ? await this.substituteReceiptContinuation.loadOpenMediaContext(ctx, chatKeyHashOf(event)).catch(() => null)
        : null;
      if (!substituteOpen) {
        return await this.captureLineFile({
          event, ctx, access, companyId, userId: identity.userId, media,
          caption: captionText?.trim() ?? '',
        });
      }
    }

    // LINE Intake Router: semantic classification of the media message
    // (expense evidence vs signature vs other) before any record is created.
    const conversationContext = access.permissions.includes('line.ai.query')
      ? await this.loadConversationContext(companyId, identity.userId)
      : undefined;
    const caption = captionText?.trim() ?? '';
    const captionSuffix = caption ? ` ${caption}` : '';
    const expenseDraftConversationEnabled = this.config.lineExpenseDraftConversationEnabled === true
      && (!event.pushTargetId || event.pushTargetId === event.lineUserId)
      && Boolean(this.expenseDraftConversation);
    const captionCandidates = computeValueCandidates(normalizeLineText(caption));
    const routePlan = await this.tryRouteIntake({
      requestId,
      webhookEventId: event.webhookEventId,
      retryWebhookEventId: event.webhookEventId,
      onAdmitted: (identity) => { admissionAttempt.identity = identity; admissionAttempt.companyId = companyId; },
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

    admissionAttempt.receiptRequested = routePlan.intent === 'EXPENSE_DOCUMENT_CAPTURE';
    if (!await this.mayDeliverBusinessReply(event)) { admissionAttempt.receiptRequested = true; return; }

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
      const ticketReply = await this.createLineSignatureAsset({ ctx, event, sourceEvent: event, companyId, media, steerToPendingDecision: await pendingIssueDecisionSteer() });
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
      const ticketReply = await this.createLineSignatureAsset({ ctx, event, sourceEvent: event, companyId, media, steerToPendingDecision: await pendingIssueDecisionSteer() });
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
          this.logger.warn({ msg: 'line_clarify_pending_media_failed', requestId, ...safeLineErrorDetails(error) });
        }
      }
      await this.deliverReply(event, clarifyReply);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: `${parked?.pending ? mediaPreviewLabel(parked.pending) : '[ผู้ใช้ส่งรูป/ไฟล์]'}${captionSuffix}`,
        replyText: clarifyReply, intent: 'CLARIFY',
      });
      if (parked?.created && parked.pending) {
        await this.appendMediaClarification(event, {
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
            await this.appendMediaClarification(event, {
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
        if (outcome) {
          // Successful substitute handling is the existing general-image work, not a failed receipt read.
          admissionAttempt.receiptRequested = false;
          return outcome;
        }
      } catch (error) {
        // Never let this branch sink a media turn: without it the photo is still capturable below.
        this.logger.warn({ msg: 'line_substitute_media_arrival_failed', requestId, ...safeLineErrorDetails(error) });
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

    if (routePlan.ocrErrorCode === 'OCR_REQUEST_ALREADY_ADMITTED') {
      // A crashed provider attempt may still own its lease. Keep the same durable input pending;
      // a transient waiting message must not become an immutable terminal result or a new draft.
      await this.prisma.client.lineWebhookEventLog.updateMany({
        where: { webhookEventId: event.webhookEventId, status: 'received' },
        data: { errorCode: LINE_RECEIPT_RETRY_WAIT_CODE, companyId, processedAt: new Date() },
      });
      return;
    }

    // JPEG/PNG classification runs once, before initReceiptUpload. PDF/unsupported media produces
    // NOT_REQUESTED and therefore fails closed unless a routed expense caption supplies purpose.
    admissionAttempt.receiptRequested = true;
    const ocr = await this.tryExtractReceiptFields(
      ctx,
      event.lineMessageId,
      media,
      routePlan.ocrAdmission === 'admitted',
      routePlan.ocrErrorCode,
      // The router already read this exact photo; forwarding that read keeps OCR from reading it
      // a second time (UAT 2026-08-28: a 16.6s duplicate read on every receipt).
      routePlan.documentText,
      admissionAttempt,
    );

    // P10-L §15.1 (review G-01): the shop's plan ran out of receipts. `admitCompanyOcr` is the one
    // place that decides this — for a LINE photo it decides at the intake router, whose refusal
    // `tryExtractReceiptFields` forwards here as the same code — so this branch only has to answer,
    // never to count. Answered before `decideLineBusinessDocument` because the generic OCR-governance
    // clarify ("what is this picture?") is the wrong reply to a shop that needs a bigger package.
    if (ocr.errorCode === RECEIPT_QUOTA_ERROR_CODE) {
      const refusal = await this.deliverReceiptQuotaRefusal(event, companyId, identity.userId);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: `[ผู้ใช้ส่งรูป/ไฟล์เอกสารค่าใช้จ่าย]${captionSuffix}`,
        replyText: refusal, intent: 'EVIDENCE_CAPTURE', refused: true,
      });
      await this.updateEventLog(event.webhookEventId, 'receipt_quota_exceeded', RECEIPT_QUOTA_ERROR_CODE, companyId);
      return;
    }

    if (!await this.mayDeliverBusinessReply(event)) { admissionAttempt.receiptRequested = true; return; }

    // §9.2 LINE image: the company's AI MONEY closed this read. `tryRouteIntake` refused before any
    // provider ran and forwarded the code, so nothing has been read, no usage row exists and no OCR
    // read was counted. Answered here, beside the receipt-quota branch and before
    // `decideLineBusinessDocument`, for the same reason: the generic "อ่านเอกสารขัดข้องชั่วคราว" is a
    // false outage story for a policy decision, and it invited a resend that spends nothing but the
    // customer's patience. Retention is claimed ONLY from a pending row that really exists (B-04).
    if (isAiBudgetRefusalCode(ocr.errorCode)) {
      const reply = formatOcrGovernanceClarifyReply(ocr.errorCode, true);
      const permanent = isAiBudgetPermanentRefusal(ocr.errorCode);
      // Whichever hop actually met the gate is the one that knows the scope.
      const budgetScope = routePlan.budgetScope ?? ocr.budgetScope;
      const terminal = permanent
        ? (ocr.errorCode === AI_BUDGET_REFUSAL_CODES.insufficient ? 'ai_budget_insufficient' : 'ai_budget_exceeded')
        : 'provider_unavailable';
      // A reference-only route (`BUSINESS_DOCUMENT_REFERENCE`) skips the capture denial above, so a
      // user WITHOUT capture permission can reach this branch when the money gate closes between the
      // admitted intake call and the OCR hop. Parking a file and offering "1) record as receipt"
      // would hand them a workflow they are not allowed to finish, so neither happens.
      if (!canCaptureExpense) {
        const denied = formatBudgetMediaNotStoredReply(ocr.errorCode, 'no_permission');
        await this.deliverReply(event, denied);
        await this.updateEventLog(event.webhookEventId, terminal, ocr.errorCode, companyId,
          { ...(budgetScope ? { budgetScope } : {}), mediaState: 'not_stored_no_permission' });
        return { outcome: 'done' };
      }
      let parked: Awaited<ReturnType<ProcessLineWebhookUseCase['ensurePendingMedia']>> | undefined;
      try {
        parked = await this.ensurePendingMedia(
          ctx, event, companyId, identity.userId, caption, media, receiptClarifyQuestion(event),
        );
      } catch (error) {
        // The bytes are NOT stored. Confirming retention from the webhook alone is exactly what
        // §9.2 forbids, so say what is true and keep the money reason.
        this.logger.warn({ msg: 'line_budget_pending_media_failed', requestId, ...safeLineErrorDetails(error) });
        await this.deliverReply(event, formatBudgetMediaNotStoredReply(ocr.errorCode, 'save_failed'));
        await this.updateEventLog(event.webhookEventId, terminal, ocr.errorCode, companyId,
          { ...(budgetScope ? { budgetScope } : {}), mediaState: 'save_failed' });
        return { outcome: 'done' };
      }
      // `created: false` means two very different things, and only the message id tells them apart.
      // A row for THIS message is a genuine redelivery, which every clarify lane answers with
      // silence. A row for a DIFFERENT message is the one-open-question rule declining to store
      // these bytes at all — with the money closed that is now the common case, and staying silent
      // would drop a whole stack of receipts while telling the shop nothing (B-04).
      const retained = parked.created
        || (!!parked.pending && parked.pending.lineMessageId === event.lineMessageId);
      const notStored = !parked.created && !retained
        ? formatBudgetMediaNotStoredReply(ocr.errorCode, 'open_question')
        : null;
      if (parked.created || notStored) {
        const text = notStored ?? reply;
        await this.deliverReply(event, text);
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: `${notStored ? '[ผู้ใช้ส่งรูป/ไฟล์]' : mediaPreviewLabel(parked.pending)}${captionSuffix}`,
          replyText: text, intent: 'CLARIFY', refused: true,
        });
        if (parked.created && parked.pending) {
          await this.appendMediaClarification(event, {
            companyId, chatKey: mediaChatKey(event), requestId, webhookEventId: event.webhookEventId,
            userId: identity.userId, caption, question: reply, pending: parked.pending,
          });
        }
      }
      // A question is open either way — the one these bytes opened, or the earlier one they were
      // turned away for — so the workflow state stays `clarification_required` and the money reason
      // rides on the errorCode (spec §9.3). Only a true redelivery is the silent duplicate.
      await this.updateEventLog(
        event.webhookEventId,
        parked.created || notStored ? 'clarification_required' : 'duplicate_media_pending',
        ocr.errorCode,
        companyId,
        {
          ...(budgetScope ? { budgetScope } : {}),
          mediaState: parked.created ? 'retained' : notStored ? 'not_stored_open_question' : 'redelivered',
        },
      );
      return { outcome: 'done' };
    }

    const decision = decideLineBusinessDocument(routePlan, ocr, caption.length > 0);
    if (ocr.status === 'OCR_EXTRACTED_NEEDS_REVIEW' && isSuccessfulNonReceiptClassification(ocr.classification)) {
      admissionAttempt.receiptRequested = false;
    }
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
            await this.appendMediaClarification(event, {
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
      // §18.4 "การเก็บและผูกงาน": NR01–NR03 and NR08 are SUCCESSFUL reads whose document is real
      // evidence the customer may still want. This branch used to answer and discard the bytes
      // (§18.4 "ของเดิมและช่องว่าง"), so the "กรอกข้อมูลต่อ" it now offers has somewhere to go:
      // persist first, and only offer the CTA when the persist actually confirmed.
      const nrCase = decision.outcome === 'reference' ? classifyNonReceiptCase(decision.classification) : null;
      const captureLink = nrCase && NON_RECEIPT_PERSISTING_CASES.includes(nrCase) && canCaptureExpense
        ? await this.persistNonReceiptEvidence(ctx, event, { media, caption }).catch((error) => {
          this.logger.warn({ msg: 'line_non_receipt_persist_failed', requestId, ...safeLineErrorDetails(error) });
          return undefined;
        })
        : undefined;
      const reply = decision.outcome === 'reference'
        ? formatBusinessDocumentReply(decision.classification, this.config.webBaseUrl, companyId,
          { ...(captureLink ? { captureLink } : {}) })
        : MEDIA_UNSUPPORTED_REPLY;
      await this.deliverCompletedReply(event, reply, companyId, access);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: `[ผู้ใช้ส่งรูป/ไฟล์]${captionSuffix}`, replyText: reply, intent: 'CLARIFY',
      });
      // Only a persist that CONFIRMED reports retention (§17.2); every other row keeps today's
      // silence rather than claiming a state nobody verified.
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId,
        captureLink ? { mediaState: 'retained' } : undefined);
      return;
    }
    if (decision.outcome === 'clarify') {
      // §17.6 (v0.11, owner decision): a PROVIDER failure on an image we can keep is no longer a
      // "รูปนี้เป็นอะไรคะ 1/2/3" question. The picture is persisted as its own capture group, its
      // read is closed FAILED so nothing re-reads it, and the customer is sent straight to the web
      // form. The clarify question stays for the cases it was written for: a router that could not
      // route, ambiguous content, and the governance refusals (feature off / already admitted),
      // which are policy states rather than a failed read.
      const readFailedOnStorableImage = decision.persistMedia && canCaptureExpense
        && ocr.status === 'OCR_FAILED'
        && ocr.errorCode !== 'OCR_FEATURE_DISABLED' && ocr.errorCode !== 'OCR_REQUEST_ALREADY_ADMITTED'
        && routePlan.status === 'ROUTED' && routePlan.intent === 'EXPENSE_DOCUMENT_CAPTURE'
        && Boolean(this.captureLine && this.initReceiptUpload);
      if (readFailedOnStorableImage) {
        const link = await this.persistNonReceiptEvidence(ctx, event, {
          media, caption, readFailedCode: ocr.errorCode ?? 'OCR_FAILED',
        }).catch((error) => {
          this.logger.warn({ msg: 'line_read_failed_capture_persist_failed', requestId, ...safeLineErrorDetails(error) });
          return undefined;
        });
        if (link) {
          const failedReply = CAPTURE_READ_FAILED_REPLY(link);
          await this.deliverCompletedReply(event, failedReply, companyId, access);
          await this.persistIntakeTurn({
            userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
            userMessagePreview: `[ผู้ใช้ส่งรูป/ไฟล์]${captionSuffix}`, replyText: failedReply, intent: 'EVIDENCE_CAPTURE',
          });
          await this.updateEventLog(event.webhookEventId, 'completed', ocr.errorCode, companyId, { mediaState: 'retained' });
          return { outcome: 'done' };
        }
        // Persist failed: fall through to the pending-media clarify, which keeps its own honest
        // copy — §17.6 forbids claiming "เก็บไฟล์ไว้แล้ว" without a persisted identity.
      }
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
            await this.appendMediaClarification(event, {
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

    const defaultBranchId = await this.resolveLineCaptureBranchId(ctx.companyId, ctx.membershipId, ctx.scopes ?? {});
    const intent = await this.initReceiptUpload.execute(ctx, {
      ...(defaultBranchId ? { branchId: defaultBranchId } : {}),
      originalFileName: media.fileName,
      mimeType: media.mimeType,
      byteSize: media.byteSize,
      // Let OCR or the user supply the document date.
      note: 'LINE receipt upload',
      captureSource: 'LINE_UPLOAD',
      lineCapture: { lineMessageId: event.lineMessageId, lineEventId: event.webhookEventId, chatKeyHash: chatKeyHashOf(event) },
    });
    if (intent.reusedCapture) {
      const captured = await this.expenseRepo!.findByLineMessageId(companyId, event.lineMessageId);
      if (!captured) throw new Error('LINE_RECEIPT_CAPTURE_NOT_FOUND');
      await this.resumeCapturedReceipt(event, ctx, access, captured);
      return;
    }
    if (intent.uploadRequired !== false) await this.timeStage(event.webhookEventId, 'receipt_upload', () => this.uploadLineMedia(intent, media));
    const completedExpense = await this.timeStage(event.webhookEventId, 'receipt_upload_complete', () => this.completeReceiptUpload!.execute(ctx, {
      expenseId: intent.expenseId,
      attachmentId: intent.attachmentId,
      checksumSha256: media.checksumSha256,
      byteSize: media.byteSize,
    }, { beforeCommit: async () => { if (!await this.mayDeliverBusinessReply(event)) throw new LineDeliveryError('failed_permanent'); } }));
    (event as typeof event & { [SAVED_LINE_RECEIPT]?: SavedLineReceipt })[SAVED_LINE_RECEIPT] = { expenseId: intent.expenseId, companyId, uploaded: true };
    const ocrFields = decision.manualReview ? null : ocr.fields;
    if (!completedExpense.updatedAt) throw new ConflictException('Receipt upload revision unavailable');
    const capturedRevision = await this.prisma.client.expenseRecord.update({
      where: { id: intent.expenseId, companyId, updatedAt: completedExpense.updatedAt },
      data: { aiVerificationStatus: 'NEEDS_REVIEW', aiVerificationSummaryJson: {
        status: ocr.status, recognizedFields: ocrFields ?? undefined,
        missingFields: ocrFields?.missingFields ?? ['vendor', 'expenseDate', 'grandTotalAmount', 'category'],
        nextAction: 'review_in_web',
      } },
    });


    // ponytail: web and LINE share upload and post-OCR duplicate detection.
    let sourceUpdatedAt = capturedRevision.updatedAt;
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
    // Spec §5.2: `expenseDate` was seeded with the upload day above because the column is NOT NULL.
    // Until the apply below says the document's own date was read and is plausible, that value is a
    // placeholder — and the card, the summary JSON and the review form all have to say so.
    let dateVerified = false;
    let dateStatus: ExpenseDocumentDateStatus = 'unverified';
    let dateAssumptions: string[] | undefined;
    let reviewReasons: string[] = [];
    let chargeReconciliation: { status: string; chargesApplied: number; itemsSumAmount?: string } | undefined;
    if (ocrFields) {
      const applyOutcome = await this.timeStage(event.webhookEventId, 'receipt_ocr_apply', () => this.receiptOcrApply.apply(ctx, intent.expenseId, ocrFields, {
        expectedUpdatedAt: sourceUpdatedAt,
        ...(hintedCategory
          ? {
              fallbackCategorySuggestion: {
                expenseCategoryId: hintedCategory.id,
                confidence: routePlan.captureHints?.confidence ?? 0,
              },
            }
          : {}),
      }));
      if (isStaleOcrApply(applyOutcome) || !applyOutcome.committedUpdatedAt) {
        throw new ConflictException('Receipt changed before OCR could be saved');
      }
      const duplicateResult = applyOutcome;
      sourceUpdatedAt = applyOutcome.committedUpdatedAt;
      admissionAttempt.usablePersisted = ocr.status === 'OCR_EXTRACTED_NEEDS_REVIEW'
        && isExpenseExtractionEligible(ocr.classification ?? undefined, ocrFields.grandTotalAmount);
      hasDuplicate ||= (duplicateResult?.candidatesCreated ?? 0) > 0;
      reviewReasons = duplicateResult?.reviewReasons ?? [];
      dateVerified = duplicateResult?.dateVerified ?? false;
      dateStatus = duplicateResult?.dateStatus ?? 'unverified';
      dateAssumptions = duplicateResult?.dateAssumptions;
      // Same shape the web upload path stores, so `ExpenseReviewPage`'s charge banners fire for a
      // LINE draft too — they were written for the web lane and a LINE draft never carried the key.
      chargeReconciliation = duplicateResult
        ? {
            status: duplicateResult.chargeReconciliationStatus,
            chargesApplied: duplicateResult.chargesApplied,
            ...(duplicateResult.itemsSumAmount ? { itemsSumAmount: duplicateResult.itemsSumAmount } : {}),
          }
        : undefined;
      categorySuggestion = duplicateResult?.categorySuggestion;
      effectiveCategory = duplicateResult?.categoryId
        ? {
            id: duplicateResult.categoryId,
            name: duplicateResult.categoryName
              ?? (hintedCategory?.id === duplicateResult.categoryId ? hintedCategory.name : ''),
          }
        : null;
    }
    const capturedFields: Record<string, unknown> = {
      vendor: ocrFields?.vendorName, expenseDate: ocrFields?.expenseDate,
      documentNumber: ocrFields?.documentNumber, grandTotalAmount: ocrFields?.grandTotalAmount,
      vatAmount: ocrFields?.vatAmount,
    };
    const missingFields = new Set(ocrFields?.missingFields
      ?? Object.entries(capturedFields).filter(([, value]) => value == null || value === '').map(([field]) => field));
    if (effectiveCategory?.id) missingFields.delete('category');
    else missingFields.add('category');
    // Spec §5.2: an unverified date is a missing one, whatever the column holds. This is the flag the
    // web review form already reads (`expenseAiMissingFields`), so no second mechanism is invented.
    if (!dateVerified) missingFields.add('expenseDate');

    await this.prisma.client.expenseRecord.update({
      where: { id: intent.expenseId, companyId, updatedAt: sourceUpdatedAt },
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
          // Spec §5.1/§5.2: the same readable reasons the web upload path stores, so a draft captured
          // over LINE and one uploaded in the browser explain themselves the same way.
          ...(reviewReasons.length > 0 ? { reviewReasons } : {}),
          ...(chargeReconciliation ? { chargeReconciliation } : {}),
          // Field-level evidence for the date: the four-state answer plus what the reader had to
          // infer to produce it (§5.2). `assumed` is NOT a review trigger — it is the label the
          // card, the review page, the list and the export all render.
          dateStatus,
          ...(dateAssumptions ? { expenseDateAssumptions: dateAssumptions } : {}),
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
    if (expenseDraftConversationEnabled) await this.expenseDraftConversation!.startFromReceipt(ctx, {
        expenseId: intent.expenseId,
        chatKeyHash: chatKeyHashOf(event),
        webhookEventId: event.webhookEventId,
        ocrFields,
        ...(groundedPurpose ? { businessPurpose: groundedPurpose } : {}),
        // Spec S1-R4: below the auto-fill bar nothing was written, so the draft conversation gets
        // the suggestion here — it lands as the item's `suggestedCategoryId`, which the reply asks
        // the user to confirm and never applies on its own.
        ...(draftSuggestedCategoryId ? { suggestedCategoryId: draftSuggestedCategoryId } : {}),
      });
    // Source facts remain durable and editable, but sending a photo never starts a questionnaire.
    const replyTexts = await this.savedReceiptReplies(event, companyId, intent.expenseId, caption);
    // §18.4 NR04/NR05: the document DID pass eligibility and a record exists, so the expense summary
    // is unchanged — only the one sentence naming what kind of document this is leads it. "ยังไม่ได้
    // สร้างรายการ" is impossible here by construction, which is exactly §18.4's rule.
    const nrOnExpense = expensePathNonReceiptLead(decision.classification, ocrFields?.grandTotalAmount);
    if (nrOnExpense) replyTexts[0] = `${nrOnExpense}\n\n${replyTexts[0]!}`;
    await this.deliverCompletedReply(event, replyTexts[0]!, companyId, access);
    await this.recordDeliveredReceiptContinuation(event, companyId, identity.userId, intent.expenseId, access.scopes);
    await this.persistIntakeTurn({
      userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: `[ผู้ใช้ส่งรูป/ไฟล์เอกสารค่าใช้จ่าย]${captionSuffix}`, replyText: replyTexts.join('\n'), intent: 'EVIDENCE_CAPTURE',
    });
    await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
  }

  /** Recovery reads the saved record; it never opens a questionnaire or reapplies money. */
  private async savedReceiptReplies(event: LineReceiptUploadEvent | LineTextEvent, companyId: string, expenseId: string, questionText?: string): Promise<string[]> {
    const link = absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`);
    const fallback = 'ยังตรวจสอบใบเสร็จเดิมไม่ได้ กรุณาเปิดเว็บเพื่อตรวจรายการก่อนส่งซ้ำค่ะ';
    try {
      if (!event.handoff || !this.expenseRepo?.findByIdWithRelations) return [fallback];
      const access = await this.permissionResolver.resolveAccess(event.handoff.userId, companyId);
      const expense = await this.expenseRepo.findByIdWithRelations(companyId, expenseId, undefined, access.scopes ?? {});
      if (!expense || expense.createdByUserId !== event.handoff.userId || expense.captureSource !== 'LINE_UPLOAD'
        || expense.sourceChannelMetadataJson?.chatKeyHash !== chatKeyHashOf(event)) return [fallback];
      const category = expense.expenseCategoryId ? (await this.expenseRepo.listCategories(companyId)).find(item => item.id === expense.expenseCategoryId) : undefined;
      this.rememberReceiptDeliverySource(event, { requestId: event.webhookEventId, authSubject: event.handoff.userId,
        userId: event.handoff.userId, companyId, membershipId: access.membershipId, roles: access.roles,
        permissions: access.permissions, scopes: access.scopes, authProvider: 'line' }, expense, category);
      if (!['DRAFT', 'NEEDS_REVIEW'].includes(expense.status)) return [`เก็บรายการนี้ไว้แล้วค่ะ\nเปิดดูรายการ: ${link}`];
      const summary = expense.aiVerificationSummaryJson;
      const reconciliation = summary?.chargeReconciliation as { status?: unknown; chargesApplied?: unknown } | undefined;
      return [formatPaypersReply(this.config.webBaseUrl, companyId, expenseId, {
        questionText,
        acceptedAmounts: { grandTotalAmount: expense.grandTotalAmount, vatAmount: expense.vatAmount, whtAmount: expense.whtAmount, netPayableAmount: expense.netPayableAmount, vatMode: expense.vatMode, discountAmount: expense.discountAmount },
        sourceDocumentType: expense.sourceDocumentType,
        categoryName: category?.name,
        fields: { ...(summary?.recognizedFields as ReceiptOcrFieldResult | undefined),
          vendorName: expense.vendorNameSnapshot ?? undefined, documentNumber: expense.vendorDocumentNumber ?? undefined,
          expenseDate: expense.expenseDate.toISOString().slice(0, 10),
          description: undefined, quantity: undefined, unitPrice: undefined,
          lines: expense.lines.filter(line => !line.chargeKind).map(line => ({ description: line.description, quantity: line.quantity,
            unitPrice: line.unitPrice, amount: line.lineTotalAmount, evidenceSignal: line.sourceLineText ?? line.description })) },
        charges: expense.charges,
        ...(reconciliation && typeof reconciliation.status === 'string' && typeof reconciliation.chargesApplied === 'number'
          ? { chargeReconciliation: { status: reconciliation.status, chargesApplied: reconciliation.chargesApplied } } : {}),
        hasDuplicate: Boolean(expense.duplicateOfExpenseId) || expense.duplicateStatus === 'POSSIBLE_DUPLICATE',
        dateStatus: (summary?.dateStatus as ExpenseDocumentDateStatus | undefined) ?? (expense.reviewedAt ? 'verified' : 'unverified'),
      })];
    } catch (error) {
      this.logger.warn({ msg: 'line_receipt_summary_unavailable', companyId, expenseId, ...safeLineErrorDetails(error) });
      return [fallback];
    }
  }

  /**
   * The web target of a captured document — the ONE place the LINE lanes build it (appendix §10).
   * Since 2026-09-19 that is always the expense page: there is no group screen to send anyone to.
   */
  private expenseCaptureLink(companyId: string, expenseId: string): string {
    return absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`);
  }

  /*
   * A45 ("งานเดิม / ใบใหม่") was withdrawn with the capture-group screens on 2026-09-19 (appendix
   * §25): every LINE file is its own expense draft now, exactly as every photo is, so there is no
   * grouping left for the chat to be asked about and no file to move between groups.
   */

  /**
   * §17.5 "ไฟล์เมื่อกี้ทำไมส่งไม่ได้" — deterministic, read-only, no OCR and no model.
   *
   * Returns false ONLY when this deployment has no attempt log at all, in which case the caller
   * keeps today's behaviour rather than inventing an answer. Everything else — including "we could
   * not look" and "no attempt found" — is answered here, because §17.5's whole point is that those
   * two are DIFFERENT answers and neither may be dressed up as a cause.
   */
  private async answerFileAttemptQuestion(
    event: LineTextEvent,
    ctx: RequestContext,
    access: { permissions: string[]; roles: string[] },
    input: { userId: string; companyId: string; normalizedText: string },
  ): Promise<boolean> {
    if (!this.captureRepo) return false;
    const chatKeyHash = chatKeyHashOf(event);
    const lineUserIdHash = hashMessagePreview(event.lineUserId);
    let reply: string;
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rows = await this.captureRepo.listLineIntakeAttempts({
        companyId: input.companyId, lineUserIdHash, chatKeyHash, since, take: 5,
      });
      // Bookkeeping rows (the A45 question, an earlier ambiguity list) are not files to report on.
      const attempts = rows.filter((row) => row.stage !== 'ROUTE');
      if (attempts.length === 0) {
        reply = FILE_ATTEMPT_NONE_REPLY;
      } else {
        // A numbered answer to an ambiguity list already shown wins over a fresh list (§17.5).
        const chosen = await this.resolveFileAttemptChoice(input, chatKeyHash, lineUserIdHash, input.normalizedText);
        const facts = await Promise.all(attempts.map((row) => this.toFileAttemptFacts(ctx, access, row)));
        const picked = chosen ? facts.find((fact) => fact.ref === chosen) : undefined;
        // Same lineMessageId twice = the same file, first rejected then stored: §17.5's last row.
        const byMessage = (ref: string) => rows.find((row) => row.id === ref)?.lineMessageId ?? null;
        if (picked || facts.length === 1) {
          const target = picked ?? facts[0]!;
          const messageId = byMessage(target.ref);
          const earlier = messageId
            ? facts.find((fact) => fact.ref !== target.ref && byMessage(fact.ref) === messageId && fact.outcome === 'REJECTED')
            : undefined;
          reply = fileAttemptAnswer(target, earlier);
        } else {
          reply = fileAttemptChoiceList(facts);
          await this.recordFileAttemptChoiceList(event, input.companyId, facts.map((fact) => fact.ref));
        }
      }
    } catch (error) {
      // §17.5: a lookup that failed is NEVER reported as "no file found".
      this.logger.warn({ msg: 'line_file_attempt_lookup_failed', ...safeLineErrorDetails(error) });
      reply = FILE_ATTEMPT_LOOKUP_FAILED_REPLY;
    }
    await this.deliverCompletedReply(event, reply, input.companyId, access);
    await this.persistIntakeTurn({
      userId: input.userId, companyId: input.companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: input.normalizedText, replyText: reply, intent: 'UNKNOWN',
    });
    await this.updateEventLog(event.webhookEventId, 'completed', undefined, input.companyId);
    return true;
  }

  /** One attempt row → the facts §17.5 may speak from, with the target's CURRENT state attached. */
  private async toFileAttemptFacts(
    ctx: RequestContext,
    access: { permissions: string[] },
    row: {
      id: string; messageType: string; fileNameSanitized: string | null; stage: string; reasonCode: string;
      outcome: string; declaredFileSize: number | null; measuredByteSize: number | null;
      capabilityJson: unknown; createdAt: Date; targetType: string | null; targetId: string | null;
    },
  ): Promise<LineFileAttemptFacts> {
    const facts: LineFileAttemptFacts = {
      ref: row.id,
      messageType: row.messageType === 'file' ? 'file' : 'image',
      fileNameSanitized: row.fileNameSanitized,
      stage: row.stage as LineFileAttemptFacts['stage'],
      reasonCode: row.reasonCode,
      outcome: row.outcome as LineFileAttemptFacts['outcome'],
      declaredFileSize: row.declaredFileSize,
      measuredByteSize: row.measuredByteSize,
      capability: (row.capabilityJson ?? {}) as LineFileAttemptFacts['capability'],
      createdAt: row.createdAt,
    };
    if (row.targetType === 'capture_group' && row.targetId && this.captureLine) {
      // Re-read the CURRENT state: an attempt row records the moment, never the outcome that
      // arrived minutes later (§17.5 "ไม่ตอบจาก error เก่า").
      const snapshot = await this.captureLine.readFinishedSnapshot(ctx.companyId, row.targetId).catch(() => null);
      if (snapshot && snapshot.group.createdByUserId === ctx.userId) {
        const statuses = snapshot.jobs.map((job) => job.status);
        facts.outcome = statuses.includes('FAILED') ? 'STORED_READ_FAILED'
          : statuses.includes('PARTIAL') || statuses.includes('PAUSED') ? 'STORED_READ_PARTIAL'
          : statuses.length > 0 && statuses.every((status) => status === 'DONE') ? 'STORED_READ_DONE'
          : statuses.length > 0 ? 'STORED_READING'
          : 'STORED';
        // A group from before 2026-09-19 has no page of its own any more (appendix §25), so the
        // recovery is the expense list — which is where its handed-off records live.
        facts.recoveryAction = { kind: 'open_web', url: absoluteWebLink(this.config.webBaseUrl, `/companies/${ctx.companyId}/expenses`) };
      }
    } else if (row.targetType === 'expense' && row.targetId && this.expenseRepo) {
      const expense = await this.expenseRepo.findById(ctx.companyId, row.targetId).catch(() => null);
      if (expense && expense.createdByUserId === ctx.userId && access.permissions.length > 0) {
        facts.currentStatus = receiptProgressLabel(expense.status, expense.aiVerificationStatus);
        facts.recoveryAction = { kind: 'open_web', url: absoluteWebLink(this.config.webBaseUrl, `/companies/${ctx.companyId}/expenses/${expense.id}`) };
      }
    }
    return facts;
  }

  /** The ambiguity list is bound to the NEXT turn through its own durable row (§17.5). */
  private async recordFileAttemptChoiceList(event: LineTextEvent, companyId: string, refs: string[]): Promise<void> {
    if (!this.captureRepo) return;
    await this.captureRepo.recordLineIntakeAttempt({
      companyId, lineUserIdHash: hashMessagePreview(event.lineUserId), chatKeyHash: chatKeyHashOf(event),
      webhookEventId: event.webhookEventId, messageType: 'file', capabilityJson: this.captureCapability(),
      stage: 'ROUTE', reasonCode: FILE_ATTEMPT_SELECT_REASON, outcome: 'UNKNOWN',
      targetType: 'attempt_list', targetId: refs.slice(0, 5).join(','),
    }).catch((error) => this.logger.warn({ msg: 'line_file_attempt_list_not_recorded', ...safeLineErrorDetails(error) }));
  }

  /** "2" after a numbered ambiguity list resolves to the attempt that list printed second. */
  private async resolveFileAttemptChoice(
    input: { companyId: string },
    chatKeyHash: string,
    lineUserIdHash: string,
    text: string,
  ): Promise<string | undefined> {
    const choice = numberedSelection(text, 5);
    if (!choice || !this.captureRepo) return undefined;
    const since = new Date(Date.now() - LINE_AI_CONTEXT_WINDOW_MINUTES * 60 * 1000);
    const rows = await this.captureRepo.listLineIntakeAttempts({
      companyId: input.companyId, lineUserIdHash, chatKeyHash, since, take: 10,
    }).catch(() => []);
    const list = rows.find((row) => row.stage === 'ROUTE' && row.reasonCode === FILE_ATTEMPT_SELECT_REASON);
    return list?.targetId?.split(',')[choice - 1];
  }

  /**
   * Bytes → an ORDINARY expense draft with the file on it (appendix §25, owner decision
   * 2026-09-19), in the order §16.7 requires: reserve, upload, complete, and only then say anything
   * about retention.
   *
   * Reuses `InitReceiptUploadUseCase` with the LINE identity, so `@@unique([companyId,
   * lineMessageId])` on `ExpenseRecord` gives redelivery for free, and the read is the same
   * `ownerType EXPENSE` job the web PDF lane queues — one lane, one auto-split, one set of copy.
   */
  private async persistLineFileExpense(
    ctx: RequestContext,
    event: LineReceiptUploadEvent,
    input: { media: DownloadedLineMedia; caption: string; branchId?: string },
  ): Promise<{ expenseId: string; attachmentId: string; readJobId: string | null; link: string }> {
    const intent = await this.initReceiptUpload!.execute(ctx, {
      ...(input.branchId ? { branchId: input.branchId } : {}),
      originalFileName: input.media.fileName,
      mimeType: input.media.mimeType,
      byteSize: input.media.byteSize,
      // A caption riding with the file is the customer's own note about this document — never a
      // manual-entry conversation (§17.6 forbids one as error recovery).
      note: input.caption ? input.caption.slice(0, LINE_CAPTURE_NOTE_MAX_CHARS) : 'LINE document upload',
      captureSource: 'LINE_UPLOAD',
      lineCapture: {
        lineMessageId: event.lineMessageId, lineEventId: event.webhookEventId,
        chatKeyHash: chatKeyHashOf(event),
        // The chat this file arrived in, so the result can be pushed back INTO it.
        pushTargetId: event.pushTargetId ?? event.lineUserId,
      },
    });
    if (intent.uploadRequired !== false) await this.uploadLineMedia(intent, input.media);
    const completed = await this.completeReceiptUpload!.execute(ctx, {
      expenseId: intent.expenseId,
      attachmentId: intent.attachmentId,
      ...(input.media.checksumSha256 ? { checksumSha256: input.media.checksumSha256 } : {}),
      byteSize: input.media.byteSize,
    });
    const readJobId = await this.captureLine!.queueExpenseRead({
      companyId: ctx.companyId, expenseId: intent.expenseId, attachmentId: intent.attachmentId,
      attachmentChecksum: input.media.checksumSha256 ?? null,
      expectedSourceUpdatedAt: completed.updatedAt ?? null,
    }).catch(() => null);
    return {
      expenseId: intent.expenseId, attachmentId: intent.attachmentId, readJobId,
      link: this.expenseCaptureLink(ctx.companyId, intent.expenseId),
    };
  }

  /**
   * The LINE `file` lane (appendix §25, §16.7, A68/A75/A81).
   *
   * Never loses bytes, and never asks a question it does not need to: each file is its own expense
   * draft, exactly as each photo is today, so the A45 "งานเดิม หรือ ใบใหม่" question is gone with
   * the groups it used to move files between.
   */
  private async captureLineFile(input: {
    event: LineReceiptUploadEvent;
    ctx: RequestContext;
    access: { permissions: string[]; roles: string[] };
    companyId: string;
    userId: string;
    media: DownloadedLineMedia;
    caption: string;
  }): Promise<LineMediaTurnOutcome> {
    const { event, ctx, access, companyId, media } = input;
    event.handoffSurface = 'line_capture_intake';
    // A caption riding with a file can be a QUESTION rather than a note about the work ("ไฟล์นี้
    // ลงค่าใช้จ่ายได้ไหม"). Storing it as the note answers nobody, so the file turn keeps its own
    // reply and the caption runs as its own text turn afterwards — the `defer_text` seam the buffer
    // already honours for the image lane (spec §8).
    const captionIsQuestion = Boolean(input.caption) && isInterveningQuestionText(input.caption);
    const caption = captionIsQuestion ? '' : input.caption;
    const finished = (): LineMediaTurnOutcome => ({ outcome: captionIsQuestion ? 'defer_text' : 'done' });

    // Redelivery (new webhookEventId, same lineMessageId): the unique index means this message
    // already produced a draft, so answer with THAT one instead of storing the bytes twice.
    const existing = await this.expenseRepo?.findByLineMessageId(companyId, event.lineMessageId);
    if (existing) {
      await this.deliverCompletedReply(
        event, this.fileStoredReply(this.expenseCaptureLink(companyId, existing.id)), companyId, access,
      );
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId, { mediaState: 'redelivered' });
      return finished();
    }

    const branchId = await this.resolveLineCaptureBranchId(companyId, ctx.membershipId, ctx.scopes ?? {});
    let persisted: Awaited<ReturnType<ProcessLineWebhookUseCase['persistLineFileExpense']>>;
    try {
      persisted = await this.persistLineFileExpense(ctx, event, {
        media, caption, ...(branchId ? { branchId } : {}),
      });
    } catch (error) {
      // §17.2/§17.6: a persist that failed may NEVER be reported as "เก็บไฟล์ไว้แล้ว". The typed
      // reason is recorded; a branch-selection refusal keeps its own deterministic copy.
      await this.recordIntakeAttempt(event, {
        companyId, stage: 'PERSIST', reasonCode: 'persist_failed', outcome: 'REJECTED',
        measuredByteSize: media.byteSize, fileName: media.fileName,
      });
      const deterministic = lineCaptureFailureReply(error, BRANCH_RETRY_RESEND);
      if (deterministic) {
        await this.deliverReply(event, deterministic.reply).catch(() => {});
        await this.updateEventLog(event.webhookEventId, deterministic.status, deterministic.errorCode, companyId);
        return { outcome: 'done' };
      }
      throw error;
    }

    await this.recordIntakeAttempt(event, {
      companyId, stage: 'PERSIST', reasonCode: 'stored', outcome: 'STORED_READING',
      measuredByteSize: media.byteSize, fileName: media.fileName,
      targetType: 'expense', targetId: persisted.expenseId,
    });

    await this.deliverCompletedReply(event, this.fileStoredReply(persisted.link), companyId, access);
    await this.persistIntakeTurn({
      userId: input.userId, companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: `[ผู้ใช้ส่งไฟล์เอกสาร #${persisted.attachmentId}]${caption ? ` ${caption}` : ''}`,
      replyText: this.fileStoredReply(persisted.link), intent: 'EVIDENCE_CAPTURE',
    });
    await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId, { mediaState: 'retained' });
    return finished();
  }

  /**
   * The image lane's persist (§17.6 and §18.4 NR01–NR03/NR08): the same ORDINARY draft the file
   * lane builds, minus the read. `readFailedCode` closes the job immediately — this image has
   * ALREADY been read once and failed, and §17.6 forbids offering a re-read as error recovery.
   *
   * Returns the link only when the persist confirmed; `undefined` means the caller must NOT say the
   * file was kept.
   */
  private async persistNonReceiptEvidence(
    ctx: RequestContext,
    event: LineReceiptUploadEvent,
    input: { media: DownloadedLineMedia; caption: string; readFailedCode?: string },
  ): Promise<string | undefined> {
    if (!this.captureLine || !this.initReceiptUpload || !this.completeReceiptUpload) return undefined;
    const existing = await this.expenseRepo?.findByLineMessageId(ctx.companyId, event.lineMessageId).catch(() => null);
    if (existing) return this.expenseCaptureLink(ctx.companyId, existing.id);
    const branchId = await this.resolveLineCaptureBranchId(ctx.companyId, ctx.membershipId, ctx.scopes ?? {});
    let persisted: Awaited<ReturnType<ProcessLineWebhookUseCase['persistLineFileExpense']>>;
    try {
      persisted = await this.persistLineFileExpense(ctx, event, {
        media: input.media, caption: input.caption, ...(branchId ? { branchId } : {}),
      });
    } catch (error) {
      await this.recordIntakeAttempt(event, {
        companyId: ctx.companyId, stage: 'PERSIST', reasonCode: 'persist_failed', outcome: 'REJECTED',
        measuredByteSize: input.media.byteSize, fileName: input.media.fileName,
      });
      throw error;
    }
    if (input.readFailedCode && persisted.readJobId) {
      await this.captureLine.markReadFailed(ctx.companyId, persisted.readJobId, input.readFailedCode).catch(() => false);
    }
    await this.recordIntakeAttempt(event, {
      companyId: ctx.companyId, stage: input.readFailedCode ? 'READ' : 'PERSIST',
      reasonCode: input.readFailedCode ?? 'stored',
      outcome: input.readFailedCode ? 'STORED_READ_FAILED' : 'STORED_READING',
      measuredByteSize: input.media.byteSize, fileName: input.media.fileName,
      targetType: 'expense', targetId: persisted.expenseId,
    });
    return persisted.link;
  }

  /** §16.7 UX: persisted, being read, and where to look while it is — nothing about a deadline. */
  private fileStoredReply(link: string): string {
    return '📄 เก็บไฟล์แล้วค่ะ กำลังอ่านเอกสาร เสร็จแล้วน้องจะสรุปให้ทางแชตนี้'
      + (link ? ` ระหว่างนี้เปิดดูได้ที่: ${link}` : '');
  }

  private async resumeCapturedReceipt(
    event: LineReceiptUploadEvent,
    ctx: RequestContext,
    access: { permissions: string[]; roles: string[] },
    expense: ExpenseRecord,
  ): Promise<void> {
    if (expense.createdByUserId !== ctx.userId || !isBranchInScope(ctx.scopes ?? {}, expense.branchId)
      || (expense.sourceChannelMetadataJson?.chatKeyHash && expense.sourceChannelMetadataJson.chatKeyHash !== chatKeyHashOf(event))) {
      throw new ForbiddenException('Receipt is outside your capture scope.');
    }
    if (!expense.primaryAttachmentId && expense.sourceChannelMetadataJson?.receiptCapturePending === true) {
      const upload = expense.sourceChannelMetadataJson.receiptUpload as { originalFileName: string; mimeType: string; byteSize: number };
      const intent = await this.initReceiptUpload!.execute(ctx, {
        ...upload, expenseDate: expense.expenseDate.toISOString(), branchId: expense.branchId ?? undefined,
        captureSource: 'LINE_UPLOAD',
        lineCapture: { lineMessageId: event.lineMessageId, lineEventId: event.webhookEventId, chatKeyHash: chatKeyHashOf(event) },
      });
      let media: DownloadedLineMedia | null = null;
      if (intent.uploadRequired !== false) {
        // Unchanged behaviour: this lane still throws. The typed reason is recorded on the way past
        // so a later "ไฟล์เมื่อกี้…" question is not blind to a resume that could not fetch bytes.
        const resumed = await this.downloadLineMedia(event.lineMessageId, event.messageType, event.fileName, event.fileSize);
        if (!resumed.ok) {
          await this.recordIntakeAttempt(event, {
            companyId: ctx.companyId, stage: 'DOWNLOAD', reasonCode: resumed.reason, outcome: 'REJECTED',
            ...(resumed.declaredFileSize !== undefined ? { declaredFileSize: resumed.declaredFileSize } : {}),
            targetType: 'expense', targetId: expense.id,
          });
          throw new Error('LINE_RECEIPT_MEDIA_UNAVAILABLE');
        }
        media = resumed.media;
        const rejection = await this.lineMediaRejectionReason(media);
        if (rejection) {
          await this.recordIntakeAttempt(event, {
            companyId: ctx.companyId, stage: 'SECURITY', reasonCode: rejection, outcome: 'REJECTED',
            measuredByteSize: media.byteSize, fileName: media.fileName, targetType: 'expense', targetId: expense.id,
          });
          throw new Error('LINE_RECEIPT_MEDIA_UNAVAILABLE');
        }
        await this.uploadLineMedia(intent, media);
      }
      expense = await this.completeReceiptUpload!.execute(ctx, {
        expenseId: expense.id, attachmentId: intent.attachmentId,
        ...(media ? { checksumSha256: media.checksumSha256, byteSize: media.byteSize } : {}),
      }, { beforeCommit: async () => { if (!await this.mayDeliverBusinessReply(event)) throw new LineDeliveryError('failed_permanent'); } });
    }
    (event as typeof event & { [SAVED_LINE_RECEIPT]?: SavedLineReceipt })[SAVED_LINE_RECEIPT] = {
      expenseId: expense.id, companyId: ctx.companyId, uploaded: Boolean(expense.primaryAttachmentId),
    };
    const canContinue = Boolean(expense.primaryAttachmentId) && this.config.lineExpenseDraftConversationEnabled === true
      && (!event.pushTargetId || event.pushTargetId === event.lineUserId)
      && (expense.status === 'DRAFT' || expense.status === 'NEEDS_REVIEW');
    if (canContinue) await this.expenseDraftConversation?.startFromReceipt(ctx, {
      expenseId: expense.id, chatKeyHash: chatKeyHashOf(event), webhookEventId: event.webhookEventId,
      ocrFields: expense.aiVerificationSummaryJson?.recognizedFields as ReceiptOcrFieldResult | undefined,
    });
    const link = absoluteWebLink(this.config.webBaseUrl, `/companies/${ctx.companyId}/expenses/${expense.id}`);
    if (!['DRAFT', 'NEEDS_REVIEW'].includes(expense.status) || !expense.primaryAttachmentId)
      this.rememberReceiptDeliverySource(event, ctx, expense);
    if (!['DRAFT', 'NEEDS_REVIEW'].includes(expense.status)) await this.deliverCompletedReply(event, `เก็บรายการนี้ไว้แล้วค่ะ เปิดตรวจสอบสถานะปัจจุบันได้ที่
${link}`, ctx.companyId, access);
    else if (!expense.primaryAttachmentId) await this.deliverCompletedReply(event, `เก็บร่างไว้แล้ว แต่ยังไม่มีรูปแนบที่ยืนยันการอัปโหลดค่ะ เปิดตรวจสอบร่างเดิมได้ที่
${link}`, ctx.companyId, access);
    else await this.deliverCompletedReply(event, (await this.savedReceiptReplies(event, ctx.companyId, expense.id)).join('\n'), ctx.companyId, access);
    await this.recordDeliveredReceiptContinuation(event, ctx.companyId, ctx.userId, expense.id, ctx.scopes);
    await this.updateEventLog(event.webhookEventId, 'completed', undefined, ctx.companyId);
  }

  /** RECEIPT-05: idempotent by (companyId, lineMessageId). Returns `created:false` for a
   *  redelivered media event (new webhookEventId, same lineMessageId) so the caller does NOT
   *  re-send the clarify question or persist a second turn (Fix #7). The unique pending row is
   *  CLAIMED before any media bytes are uploaded: a concurrent racer that loses the (companyId,
   *  lineMessageId) unique race skips the byte upload entirely, so it can never leave an orphaned
   *  attachment (Fix #8).
   *
   *  The loser's reserved upload intent is deliberately NOT handed to
   *  `ObjectVersionCleanupService`: that service deletes one stored object VERSION, and the loser
   *  skipped `uploadLineMedia` entirely, so no version was ever written — enqueuing one would ask
   *  the worker to delete an object that does not exist, under a producer prefix it does not allow.
   *  What is left is a `PENDING_UPLOAD` `AttachmentObject` row holding no bytes, and it ages out of
   *  the only thing that counts it (`sumPendingBytes`, a rolling `createdAfter` window). Accepted. */
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
  private async appendMediaClarification(event: LineTextEvent | LineReceiptUploadEvent, input: {
    companyId: string;
    chatKey: string;
    requestId: string;
    webhookEventId: string;
    userId: string;
    caption: string;
    question: string;
    pending: { id: string; attachmentId: string; mimeType: string };
  }): Promise<void> {
    await this.appendSourceBoundClarifications(event, {
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
      this.logger.warn({ msg: 'line_ai_media_clarify_ack_failed', pendingMediaId, ...safeLineErrorDetails(err) });
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
    sourceEvent: LineReceiptUploadEvent | LineTextEvent;
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
    }, { beforeCommit: async () => { if (!await this.mayDeliverBusinessReply(input.sourceEvent)) throw new LineDeliveryError('failed_permanent'); } });
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
    await this.appendMediaClarification(event, {
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
    if (!await this.mayDeliverBusinessReply(event)) return { outcome: 'done' };
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

  /** A pending-media answer that could not be honoured. The row is left PENDING either way — the
   *  sender still owns those bytes — but a KNOWN data state gets copy it can act on and the same
   *  terminal status the direct photo path records, instead of a "temporary" claim that the very
   *  next identical attempt disproves (UAT 2026-09-05). */
  private async replyPendingMediaFailure(
    event: LineTextEvent, companyId: string, requestId: string, error: unknown,
  ): Promise<void> {
    const deterministic = lineCaptureFailureReply(error, BRANCH_RETRY_ANSWER);
    this.logger.warn({
      msg: deterministic ? 'line_pending_media_answer_needs_setup' : 'line_substitute_media_answer_failed',
      requestId, ...(deterministic && { errorCode: deterministic.errorCode }), ...safeLineErrorDetails(error),
    });
    await this.deliverReply(event, deterministic?.reply ?? ERROR_REPLY);
    await this.updateEventLog(
      event.webhookEventId,
      deterministic?.status ?? 'substitute_media_answer_failed',
      deterministic?.errorCode,
      companyId,
    );
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
      if (!await this.mayDeliverBusinessReply(event)) return { outcome: 'handled' };
      await this.resolvePendingRow(pending.id, 'RESOLVED_SIGNATURE');
      const replyText = await this.createLineSignatureAsset({
        ctx,
        // The IMAGE's message id, not this answer's: that is what a redelivery of the photo would
        // collide with, and what the router-routed ticket would have de-duplicated on.
        event: { lineMessageId: pending.lineMessageId },
        sourceEvent: event,
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
      await this.completeReceiptDraft(existing.id, pending, ctx.companyId, ctx.userId, access.scopes, chatKeyHash);
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
        access.membershipId,
      ));
    }
    // Spec §5.1/§5.2: the SAME apply as the photo lane runs here, so it raises the same review
    // reasons and writes the same charge rows. Both used to be thrown away with the outcome — the
    // summary JSON below was composed from scratch and the reply never named the charge.
    const captured = await this.expenseRepo.findByIdWithRelations(ctx.companyId, expenseId, undefined, ctx.scopes ?? {});
    if (!captured || captured.createdByUserId !== ctx.userId || captured.captureSource !== 'LINE_UPLOAD'
      || captured.sourceChannelMetadataJson?.chatKeyHash !== chatKeyHash) throw new ForbiddenException('Receipt is outside your capture scope.');
    // A saved check bill may have been edited since the original answer. Resume it without
    // applying its old pending OCR or replacing its current review metadata a second time.
    const applied = !existing && asked.ocrFields
      ? await this.receiptOcrApply.apply(ctx, expenseId, asked.ocrFields, { expectedUpdatedAt: captured.updatedAt }) : undefined;
    if (applied && (isStaleOcrApply(applied) || !applied.committedUpdatedAt)) throw new ConflictException('Receipt changed before OCR could be saved');
    const appliedOutcome = applied;
    const classification = asked.classification ?? { documentKind: 'ORDER_OR_CHECK_BILL' };
    if (!existing) await this.expenseRepo.updateExpense({
      id: expenseId,
      companyId: ctx.companyId,
      updatedByUserId: ctx.userId,
      expectedUpdatedAt: appliedOutcome?.committedUpdatedAt ?? captured.updatedAt,
      sourceDocumentType: 'NEEDS_REVIEW',
      taxEvidenceStatus: 'NEEDS_REVIEW',
      inputVatClaimStatus: 'NEEDS_REVIEW',
      aiVerificationStatus: 'NEEDS_REVIEW',
      aiVerificationSummaryJson: {
        status: 'NOT_EXPENSE_DOCUMENT',
        recognizedFields: asked.ocrFields,
        classification,
        missingFields: asked.ocrFields?.missingFields ?? [],
        // Merged, never dropped: this write replaces the whole JSON, so a reason the apply raised
        // is gone from the record — and from the web review banners — unless it is carried here.
        // Read totally: a summary field can never be the thing that throws a user's turn away and
        // strands the pending row it was about.
        ...(appliedOutcome?.reviewReasons?.length ? { reviewReasons: appliedOutcome.reviewReasons } : {}),
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
    this.rememberSubstituteDeliverySource(event, ctx, continuation);
    const completed = await this.expenseRepo.findByIdWithRelations(ctx.companyId, expenseId, undefined, access.scopes);
    if (!completed) throw new ConflictException('Receipt changed before the reply.');
    this.rememberReceiptDeliverySource(event, ctx, completed);
    const reply = formatCheckBillDraftCreatedReply(continuation, completed.charges ?? []);
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
      await this.appendSourceBoundClarifications(event, {
          messagingChannelId: event.messagingChannelId,
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
    // Resolved OUTSIDE `timeStage`: the stage measures the capture, not this lookup.
    const branchId = await this.resolveLineCaptureBranchId(ctx.companyId, ctx.membershipId, ctx.scopes ?? {});
    try {
      return await this.timeStage(event.webhookEventId, 'capture_execute', () => this.captureExpenseNote!.execute(ctx, {
        messageText: normalizedText,
        captureHints: { amount, description },
        lineMessageId: event.lineMessageId ?? event.webhookEventId,
        lineEventId: event.webhookEventId,
        branchId,
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
    if (existing) {
      await this.completeReceiptDraft(existing.id, pending, companyId, userId, access.scopes, chatKeyHashOf(event));
      expenseId = existing.id;
    } else {
      ({ expenseId } = await this.createReceiptDraftFromPendingMedia(
        requestId,
        userId,
        companyId,
        event.webhookEventId,
        pending,
        access.scopes,
        chatKeyHashOf(event),
        access.membershipId,
      ));
    }
    let additionalReply: string | undefined;
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
        this.rememberSubstituteDeliverySource(event, { requestId, authSubject: userId, userId, companyId,
          membershipId: access.membershipId, roles: access.roles, permissions: access.permissions, scopes: access.scopes, authProvider: 'line' }, continuation);
        additionalReply = continuation.replyText;
        pendingQuestion = continuation.pendingQuestion;
      } catch (error) {
        this.logger.warn({ msg: 'line_substitute_continuation_additional_outcome_failed', requestId, ...safeLineErrorDetails(error) });
        additionalReply = SUBSTITUTE_ADDITIONAL_OUTCOME_DEGRADED;
      }
    }
    const receiptReply = (await this.savedReceiptReplies(event, companyId, expenseId)).join('\n');
    const reply = additionalReply ? `${receiptReply}\n\n${SUBSTITUTE_ADDITIONAL_OUTCOME_LABEL}\n${additionalReply}` : receiptReply;
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
      await this.appendSourceBoundClarifications(event, {
          messagingChannelId: event.messagingChannelId,
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
      this.logger.warn({ msg: 'line_receipt_continuation_record_failed', expenseId, ...safeLineErrorDetails(error) });
    }
  }

  /** Correction candidates for this turn (spec §8 candidate scope). Structured-only labels:
   *  vendor/category free text is deliberately excluded so the payload cannot carry injection. */
  private async loadCorrectionCandidates(
    companyId: string,
    userId: string,
    chatKeyHash: string,
    scopes: { branchIds?: string[] },
    expenseIds?: string[],
  ): Promise<LineIntakeCorrectionCandidate[]> {
    if (!this.expenseRepo) return [];
    // Recency window + chat provenance come from the ONE shared rule (spec §5.5), so the correction
    // lane and `expense.explain_record` can never disagree about what "this chat just captured" is.
    const rows = await listRecentLineCaptureCandidates(this.expenseRepo, {
      companyId, userId, chatKeyHash, scopes, take: LINE_CORRECTION_CANDIDATE_LIMIT,
      ...(expenseIds ? { expenseIds } : {}),
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

  /**
   * Owner 2026-08-27: never lose a successfully-read document to branch ambiguity. LINE has no
   * branch picker, so default the USER'S OWN branch (membership defaultBranchId — "สาขาที่ user
   * นั้นอยู่"), else the single in-scope branch, else the sole head office; the create path
   * re-validates scope and ACTIVE status, and the review lane keeps the branch editable.
   *
   * ONE rule for every LINE-originated record — the direct photo, the clarified pending media (the
   * check bill answered "จ่ายแล้ว ไม่ได้ใบเสร็จ") and the text note. The pending-media lane never
   * had it, which is exactly what killed the UAT check bill on 2026-09-05. `undefined` means still
   * ambiguous: the caller answers honestly instead of guessing a branch into an accounting record.
   */
  private async resolveLineCaptureBranchId(
    companyId: string,
    membershipId: string | undefined,
    scopes: { branchIds?: string[] },
  ): Promise<string | undefined> {
    const [branchCandidates, membership] = await Promise.all([
      this.prisma.client.branch.findMany({
        where: { companyId, status: 'ACTIVE', ...(scopes.branchIds ? { id: { in: scopes.branchIds } } : {}) },
        select: { id: true, type: true },
        take: 20,
      }),
      membershipId
        ? this.prisma.client.companyMembership.findUnique({ where: { id: membershipId }, select: { defaultBranchId: true } })
        : Promise.resolve(null),
    ]);
    return pickLineDefaultBranchId(branchCandidates, membership?.defaultBranchId);
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
    chatKeyHash: string,
    membershipId?: string,
  ): Promise<{ expenseId: string; hasDuplicate: boolean }> {
    const expense = await this.expenseRepo!.createExpense({
      companyId,
      // Same LINE branch rule the direct photo path uses; `resolveCreateBranchId` still re-validates
      // scope and ACTIVE status, and still refuses when the rule found nothing to pick.
      branchId: await this.expenseRepo!.resolveCreateBranchId(
        companyId, scopes, await this.resolveLineCaptureBranchId(companyId, membershipId, scopes),
      ),
      // Same placeholder rule as the direct-media path above: a CALENDAR day, not the instant the
      // photo arrived. A full timestamp in a date column hides the row from the list's day filter,
      // and the UTC day is yesterday for anyone sending a receipt before 07:00 Bangkok. This lane
      // already marks the draft NEEDS_REVIEW with `expenseDate` in `missingFields`, so the value
      // is honest about being a placeholder — it just was not the right placeholder.
      captureSource: 'LINE_UPLOAD', expenseDate: civilDateToUtcDate(todayCivilDate()), currency: 'THB',
      vatMode: 'NO_VAT', inputVatClaimStatus: 'NEEDS_REVIEW', note: 'LINE receipt (clarified)',
      createdByUserId: userId, lineMessageId: pending.lineMessageId, lineEventId,
      subtotalAmount: '0', discountAmount: '0', taxableAmount: '0', vatAmount: '0',
      whtAmount: '0', grandTotalAmount: '0', netPayableAmount: '0', outstandingAmount: '0',
      // Chat provenance for correction targeting — the pending-media path creates drafts too,
      // so omitting it here would make clarified receipts uncorrectable.
      ...(chatKeyHash ? { sourceChannelMetadataJson: { channel: 'LINE', kind: 'pending_media', chatKeyHash } } : {}),
    });
    const hasDuplicate = await this.completeReceiptDraft(expense.id, pending, companyId, userId, scopes, chatKeyHash);
    await this.audit.log({
      companyId, actorUserId: userId, action: 'expense.line_upload.receive', targetType: 'expense_record',
      targetId: expense.id, requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { lineMessageId: '[REDACTED]', mimeType: pending.mimeType, resolvedVia: 'line_clarify' },
    });
    return { expenseId: expense.id, hasDuplicate };
  }

  /** Repair only the original incomplete receipt. Retrying a completed upload never resets
   * human review; link, primary attachment, initial summary and duplicate facts commit together. */
  private async completeReceiptDraft(
    expenseId: string,
    pending: { attachmentId: string; lineMessageId: string },
    companyId: string,
    userId: string,
    scopes: { branchIds?: string[] },
    chatKeyHash: string,
  ): Promise<boolean> {
    const repo = this.expenseRepo!;
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:duplicate-reconciliation`}))`;
      // Match funding/substitute/retention writers before locking the attachment row.
      await lockFundingEvidence(tx, companyId, { expenseIds: [expenseId], attachmentIds: [pending.attachmentId] });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${expenseId}:substitute-receipt`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${pending.attachmentId}:attachment-retention`}))`;
      const current = await repo.findByIdWithRelations(companyId, expenseId, tx, scopes);
      if (!current || current.companyId !== companyId || current.createdByUserId !== userId
        || current.captureSource !== 'LINE_UPLOAD' || current.lineMessageId !== pending.lineMessageId
        || current.sourceChannelMetadataJson?.chatKeyHash !== chatKeyHash || !isBranchInScope(scopes, current.branchId)) {
        throw new ForbiddenException('Receipt is outside your capture scope.');
      }
      await tx.$executeRaw`SELECT id FROM "AttachmentObject" WHERE id = ${pending.attachmentId} AND "companyId" = ${companyId} FOR SHARE`;
      const attachment = await tx.attachmentObject.findFirst({ where: {
        id: pending.attachmentId, companyId, uploadedByUserId: userId, status: 'ACTIVE',
      }, select: { id: true } });
      if (!attachment) throw new ConflictException('The original receipt attachment is unavailable.');
      const linked = current.attachments.some(item => item.id === pending.attachmentId && item.purpose === 'expense.receipt.primary');
      if (current.primaryAttachmentId === pending.attachmentId && linked) {
        return current.duplicateStatus === 'POSSIBLE_DUPLICATE' || Boolean(current.duplicateOfExpenseId);
      }
      if (current.primaryAttachmentId && current.primaryAttachmentId !== pending.attachmentId
        || !['DRAFT', 'NEEDS_REVIEW'].includes(current.status) || current.reviewedAt) {
        throw new ConflictException('Receipt changed. Review the original record in the web app.');
      }
      await repo.linkAttachment(expenseId, pending.attachmentId, 'expense.receipt.primary', companyId, userId, tx);
      await repo.updateExpense({
        id: expenseId, companyId, updatedByUserId: userId, expectedUpdatedAt: current.updatedAt,
        primaryAttachmentId: pending.attachmentId,
        ...(!current.aiVerificationSummaryJson ? { status: 'NEEDS_REVIEW', aiVerificationStatus: 'NEEDS_REVIEW' } : {}),
      }, undefined, tx);
      const duplicate = await reconcileExpenseDuplicateCandidates(repo, companyId, expenseId, userId, scopes, tx);
      const saved = await repo.findByIdWithRelations(companyId, expenseId, tx, scopes);
      if (!saved) throw new ConflictException('Receipt changed during attachment repair.');
      await repo.updateExpense({
        id: expenseId, companyId, updatedByUserId: userId, expectedUpdatedAt: saved.updatedAt,
        aiVerificationSummaryJson: {
          ...(current.aiVerificationSummaryJson ?? {
            status: 'NOT_REQUESTED',
            missingFields: ['vendor', 'expenseDate', 'documentNumber', 'grandTotalAmount', 'vatAmount', 'category'],
            nextAction: 'review_in_web', resolvedVia: 'line_clarify_receipt',
          }),
          duplicateWarning: duplicate.openCandidates > 0,
        },
      }, undefined, tx);
      return duplicate.openCandidates > 0;
    });
  }

  /**
   * Spec §3.7: "ข้อความบริการ ส่ง 1 ครั้งตอนชนจริง — ไม่เตือนซ้ำรายวัน". The card with the two
   * buttons goes out once per Bangkok month, claimed on `CompanyPlanTerm.quotaNoticeSentMonthKey`;
   * every later receipt that meets the same wall gets one line, so a shop that keeps sending photos
   * is answered but not re-sold to. The ceiling in the copy is the shop's OWN — a warm-up trial
   * meets this at 10, not 15. Returns what was said, for the turn record.
   */
  private async deliverReceiptQuotaRefusal(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; handoff?: LineHandoffRecipient },
    companyId: string,
    userId: string,
  ): Promise<string> {
    const monthKey = bangkokMonthKey();
    // A snapshot failure must not lose the turn: the shop is owed an answer for the photo it just
    // sent, and the numberless copy below is a true sentence without it.
    const snapshot = await receiptQuotaSnapshot(this.prisma, companyId, monthKey).catch((error) => {
      this.logger.warn({ msg: 'receipt.quota.snapshot_failed', companyId, monthKey, ...safeLineErrorDetails(error) });
      return { usedCount: 0, planLimit: null, tierKey: null, cadence: undefined };
    });
    const { planLimit, tierKey, cadence } = snapshot;
    const limit = displayReceiptQuotaLimit(planLimit, tierKey, cadence);
    const first = await claimReceiptQuotaNotice(this.prisma, companyId, monthKey);
    const text = first
      ? receiptQuotaExceededTextTh(limit, tierKey, cadence, 'monthlyAllowance' in snapshot)
      : receiptQuotaExceededShortTextTh(limit, tierKey, cadence, 'monthlyAllowance' in snapshot);
    let delivered = true;
    try {
      if (first) await this.deliverRequiredMessages(event, [buildReceiptQuotaExceededMessage(text)]);
      else await this.deliverReply(event, text);
    } catch (error) {
      // The month is claimed BEFORE the send, which is what makes the card exactly-once. If the send
      // then fails — an expired reply token, a push 429 — the claim has spent the shop's only card of
      // the month on a message nobody received, and the next receipt would get the terse follow-up
      // for a card it never saw. Give the month back so the next one can carry it.
      delivered = false;
      if (first) await releaseReceiptQuotaNotice(this.prisma, companyId, monthKey);
      this.logger.warn({ msg: 'receipt.quota.card_delivery_failed', companyId, monthKey, ...safeLineErrorDetails(error) });
    }
    await this.audit.log({
      companyId, actorUserId: userId, action: 'plan.receipt_quota.blocked', targetType: 'LineWebhookEvent',
      targetId: event.webhookEventId, requestId: event.webhookEventId,
      result: delivered ? 'DENIED' : 'FAILED', riskLevel: 'LOW',
      metadataJson: { channel: 'line', monthKey, planLimit, tierKey, cardSent: first && delivered, delivered },
    });
    return text;
  }

  private async tryExtractReceiptFields(
    ctx: { requestId: string; userId: string; companyId: string },
    attachmentId: string,
    media: { mimeType: string; contentBase64?: string },
    ocrAlreadyAdmitted = false,
    routeOcrErrorCode?: string,
    intakeDocumentText?: string,
    admissionAttempt?: LineReceiptAdmissionAttempt,
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
      }, { ocrAlreadyAdmitted, admissionIdentity: admissionAttempt?.identity,
        onAdmitted: (identity) => { if (admissionAttempt) { admissionAttempt.identity = identity; admissionAttempt.companyId = ctx.companyId; } },
        busyWaitDeadlineMs: Date.now() + LINE_AI_LIVE_BUSY_WAIT_MS });
      if (result.status === 'not_configured') return { status: 'NOT_CONFIGURED', fields: null, classification: null };
      if (result.status !== 'ok') {
        // The SCOPE travels with the code (spec §9.1 / B-01). `ReceiptOcrResponse.budgetScope` is
        // set whenever `errorCode` is one of ours — which is how a chain the GATEWAY refused
        // mid-way (E1c `budget-step` said no at ordinal >= 1) reports which ceiling it hit. Only
        // the thrown-429 path below used to carry it, so a gateway-reported money refusal reached
        // the terminal row and `line.ai.terminal` with `budgetScope` absent and CHAT/OCR/TOTAL
        // indistinguishable.
        return { status: 'OCR_FAILED', fields: null, classification: null,
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
          ...(result.budgetScope ? { budgetScope: result.budgetScope } : {}) };
      }
      return {
        status: 'OCR_EXTRACTED_NEEDS_REVIEW',
        fields: result.fields ?? null,
        classification: result.classification ?? null,
      };
    } catch (err) {
      // §9.1: `requestReceiptOcr` throws OUR 429 when the money gate closes mid-turn (the intake
      // route may have been admitted, or carried no image at all). Dropping it here is the second
      // half of the production defect: the turn then answered "ระบบอ่านเอกสารขัดข้องชั่วคราว" for an
      // explicit budget decision. Any other throw keeps the code-less OCR_FAILED it always had.
      const budget = knownAiBudgetRefusal(err);
      this.logger.warn({ msg: 'Receipt OCR unavailable', ...(budget ? { budgetErrorCode: budget.code } : {}), ...safeLineErrorDetails(err) });
      return {
        status: 'OCR_FAILED', fields: null, classification: null,
        ...(budget ? { errorCode: budget.code, ...(budget.budgetScope ? { budgetScope: budget.budgetScope } : {}) } : {}),
      };
    }
  }

  private async uploadLineMedia(
    intent: { uploadUrl: string; uploadMethod: string; uploadHeaders?: Record<string, string> },
    media: { mimeType: string; bytes: Buffer },
  ): Promise<void> {
    await putLineMediaUpload(intent, media, this.config.publicApiBaseUrl);
  }

  /**
   * The capability the customer was judged against AT THIS MOMENT (appendix §2.2 `capabilityJson`).
   * Snapshotted with every attempt so a later answer quotes the limit that actually applied, not
   * whatever the config says by the time the question is asked (§17.5).
   */
  private captureCapability(): { maxBytes: number; allowedMimeTypes: string[]; pdfAutomaticRead: true } {
    return {
      maxBytes: this.config.uploadMaxBytes,
      allowedMimeTypes: [...ALLOWED_ATTACHMENT_MIME_TYPES],
      pdfAutomaticRead: true,
    };
  }

  /**
   * One `LineIntakeAttempt` row per media turn stage (§17.5 / A86–A88).
   *
   * Never throws and never blocks the turn: a diagnostic that can sink a customer's upload is worse
   * than no diagnostic. Never carries raw payload, reply tokens or the bytes — only the sanitised
   * name, the sizes, the capability of the moment and the stage/reason.
   */
  private async recordIntakeAttempt(
    event: LineReceiptUploadEvent,
    input: {
      companyId?: string;
      stage: 'DOWNLOAD' | 'SECURITY' | 'PERSIST' | 'READ' | 'ROUTE';
      reasonCode: string;
      outcome?: 'REJECTED' | 'STORED' | 'STORED_READING' | 'STORED_READ_FAILED' | 'STORED_READ_PARTIAL' | 'STORED_READ_DONE' | 'UNKNOWN';
      declaredFileSize?: number;
      measuredByteSize?: number;
      fileName?: string;
      targetType?: 'capture_group' | 'pending_media' | 'expense' | 'attempt_list';
      targetId?: string;
    },
  ): Promise<string | undefined> {
    if (!this.captureRepo) return undefined;
    try {
      const row = await this.captureRepo.recordLineIntakeAttempt({
        companyId: input.companyId ?? null,
        lineUserIdHash: hashMessagePreview(event.lineUserId),
        chatKeyHash: chatKeyHashOf(event),
        webhookEventId: event.webhookEventId,
        lineMessageId: event.lineMessageId,
        messageType: event.messageType,
        fileNameSanitized: sanitizeAttemptFileName(input.fileName ?? event.fileName),
        declaredFileSize: input.declaredFileSize ?? event.fileSize ?? null,
        measuredByteSize: input.measuredByteSize ?? null,
        capabilityJson: this.captureCapability(),
        stage: input.stage,
        reasonCode: input.reasonCode,
        ...(input.outcome ? { outcome: input.outcome } : {}),
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
      });
      return row.id;
    } catch (error) {
      this.logger.warn({ msg: 'line_intake_attempt_not_recorded', webhookEventId: event.webhookEventId, ...safeLineErrorDetails(error) });
      return undefined;
    }
  }

  /** Same rule as above: an outcome update that fails leaves the row at its earlier, honest state. */
  private async updateIntakeAttempt(
    attemptId: string | undefined,
    outcome: 'REJECTED' | 'STORED' | 'STORED_READING' | 'STORED_READ_FAILED' | 'STORED_READ_PARTIAL' | 'STORED_READ_DONE' | 'UNKNOWN',
    patch: { stage?: 'DOWNLOAD' | 'SECURITY' | 'PERSIST' | 'READ' | 'ROUTE'; reasonCode?: string; targetType?: string; targetId?: string } = {},
  ): Promise<void> {
    if (!attemptId || !this.captureRepo) return;
    await this.captureRepo.updateLineIntakeAttemptOutcome({ id: attemptId, outcome, ...patch })
      .catch((error) => this.logger.warn({ msg: 'line_intake_attempt_not_updated', ...safeLineErrorDetails(error) }));
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

  /**
   * §17.5 / IG20: this used to collapse SIX different failures into one `null`, and the caller then
   * stored a reason it never had. Every branch now names itself, so the intake attempt records what
   * actually happened and "ไฟล์เมื่อกี้ทำไมส่งไม่ได้" can be answered from a fact instead of a guess.
   *
   * Both callers keep their behaviour: a failure is still the download-failed reply and still the
   * retryable release; `resumeCapturedReceipt` still throws.
   */
  private async downloadLineMedia(lineMessageId: string, messageType: 'image' | 'file', fileName?: string, fileSize?: number): Promise<LineMediaDownloadResult> {
    const maxBytes = this.config.uploadMaxBytes;
    const accessToken = (await this.lineCredentials.get().catch(() => null))?.accessToken;
    if (!accessToken) return { ok: false, reason: 'credentials_unavailable' };
    // The webhook's own metadata, before a byte is fetched: §17.5 forbids downloading past the
    // limit just to have something to explain.
    if (fileSize !== undefined && (fileSize <= 0 || fileSize > maxBytes)) {
      return { ok: false, reason: 'oversize_declared', declaredFileSize: fileSize };
    }
    let response: Response | null = null;
    let timedOut = false;
    try {
      response = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(lineMessageId)}/content`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(LINE_MEDIA_DOWNLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      // `AbortSignal.timeout` rejects with a TimeoutError; anything else is a transport fault.
      timedOut = (error as { name?: string })?.name === 'TimeoutError';
    }
    if (!response) return { ok: false, reason: timedOut ? 'download_timeout' : 'download_failed' };
    if (!response.ok) return { ok: false, reason: 'download_http', httpStatus: response.status };
    const declaredSize = Number(response.headers.get('content-length') ?? 0);
    if (declaredSize > maxBytes) return { ok: false, reason: 'oversize_declared', declaredFileSize: declaredSize };
    if (!response.body) return { ok: false, reason: 'download_failed' };
    const bytes = await readResponseBodyLimited(response, maxBytes).catch(() => null);
    // The bounded reader returns null only after it has seen more than the limit, so this is the
    // MEASURED oversize — a chunked response whose Content-Length lied, or was absent.
    if (!bytes) return { ok: false, reason: 'oversize_measured', ...(declaredSize ? { declaredFileSize: declaredSize } : {}) };
    const mimeType = normalizeAttachmentMimeType(response.headers.get('content-type'), bytes);
    const extension = canonicalAttachmentExtension(mimeType) ?? 'bin';
    return {
      ok: true,
      media: {
        fileName: fileName ?? `line-receipt-${lineMessageId}.${extension}`,
        mimeType,
        byteSize: bytes.byteLength,
        checksumSha256: createHash('sha256').update(bytes).digest('hex'),
        contentBase64: messageType === 'image' ? bytes.toString('base64') : undefined,
        bytes,
      },
    };
  }

  private async updateEventLog(
    webhookEventId: string,
    status: string,
    errorCode?: string,
    companyId?: string,
    /** Structured telemetry only (spec §9.3) — the durable row already carries status + errorCode. */
    telemetry?: { budgetScope?: AiBudgetScope; mediaState?: LineAiTerminalMediaState },
  ) {
    const result = await this.prisma.client.lineWebhookEventLog.updateMany({
      where: {
        webhookEventId,
        OR: [{ deliveryOwnerId: null }, { deliveryOwnerId: 'webhook' }],
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
        errorCode: errorCode ?? null,
        companyId,
        processedAt: new Date(),
        ...(status === 'delivery_pending' ? {} : { payloadJson: Prisma.DbNull }),
      },
    }).catch(() => null);
    const terminalClass = classifyLineAiTerminalOutcome(status, errorCode);
    if (result?.count === 1) {
      emitLineAiTerminalOutcome(this.logger, { webhookEventId, companyId, status, errorCode, ...telemetry });
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
      if (existing.errorCode === LINE_RECEIPT_RETRY_LEASE_CODE && existing.processedAt
        && claimedAt.getTime() - existing.processedAt.getTime() < LINE_RECEIPT_RETRY_LEASE_MS) return false;
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
