import { lineDisplayDate, lineUiLabel, lineSourceLabel } from '../../domain/logic/line-language.logic';
import { lineReplyLanguage } from '@watchdog-bms/contracts';
import { LineSubstituteReceiptActionService, buildSubstituteReceiptActionCard, buildSubstituteReceiptFactsCard, type SubstituteActionPreview } from '../line-substitute-receipt-action.service';
import { LineQuotedMessageService, quoteReadMemory, quoteRecordsFromReads, validQuoteRecords, type LineQuotedRecord, type LineQuoteOwner } from '../line-quoted-message.service';
import { LineCounterpartyService, buildCounterpartyCard, isLineCounterpartyCommand, type CounterpartyPreview } from '../line-counterparty.service';
import { LinePackagePurchaseService, buildPackagePurchaseCard, isPackagePurchaseIntent, isPackagePurchaseAnswer, type PackagePurchaseView } from '../line-package-purchase.service';
import { reimbursementApprovalButtons } from '../../domain/logic/line-reimbursement-approval-control.logic';
import { LineExpenseActionService, expenseActionNextStepChoices, paidExpenseReply, type ExpenseActionPreview } from '../line-expense-action.service';
import { buildExpenseActionCard } from '../../domain/logic/line-expense-action-card.logic';
import { LinkLinePaymentEvidenceUseCase, type LinePaymentEvidenceResult } from '../../../expenses/application/use-cases/link-line-payment-evidence.use-case';
import { GetExpenseUseCase, ListExpensesUseCase, VoidExpenseUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import { ListReimbursementsUseCase } from '../../../reimbursements/application/use-cases/reimbursement-request.use-case';
import { GetCounterpartyUseCase, ListCounterpartiesUseCase } from '../../../accounting-documents/application/use-cases/counterparty.use-case';
import { isRecentPaymentEvidenceLinkText } from '../../../expenses/domain/logic/line-payment-evidence.logic';
import { linePaymentEvidenceReply, parseLinePaymentEvidenceControl, paymentEvidencePage } from '../../domain/logic/line-payment-evidence-reply.logic';
import { THAI_SYSTEM_ROLE_NAMES, LINE_FEATURE_DISABLED_HELP_TH, SIGNATURE_FILE_TYPES_LABEL, SOURCE_DOCUMENT_TYPE_LABELS, expenseReopenBlockerMessages, scrubRecordText } from '@watchdog-bms/contracts';
import { isLineAiRolloutAllowed } from '@watchdog-bms/config';
import { validateLineAiSourceRefV2, parseLineAiSemanticCoverage, parseLineAiSemanticSubrequests, lineAiReplyClarifications, type LineIntakeRouteRequest } from '@watchdog-bms/contracts';
import { PDFDocument } from 'pdf-lib';
import { LineDocumentQaError, LineDocumentQaService, type LineDocumentQaJobRow, type LineDocumentQaOwner } from '../line-document-qa.service';
import { LineDocumentQaWorker } from '../line-document-qa.worker';
import { parseLineAiResponsePreferenceCommand, parseLineDocumentQaQuestions, parseLineDocumentQaResult } from '@watchdog-bms/contracts';
import { LineReimbursementDraftService } from '../line-reimbursement-draft.service';
import type { LineReimbursementDraftResult } from '../../../reimbursements/application/use-cases/line-reimbursement-draft.use-case';
import { LineReimbursementDraftAdapterService } from '../line-reimbursement-draft-adapter.service';
import { buildReimbursementDraftMessages, buildReimbursementOptionsMessages } from '../../domain/logic/line-reimbursement-draft-card.logic';
import { reimbursementApprovalOpenToken } from '../../domain/logic/line-reimbursement-approval-control.logic';
import { DrainLineLedgerUseCase } from './drain-line-ledger.use-case';
import { LineCaptureResultNotifierUseCase } from './line-capture-result-notifier.use-case';
import { parseLinePreferenceCommand, formatLinePreferences, linePreferenceChangedText, linePreferenceForgetsNothing, LINE_PREFERENCE_NOTHING_TO_FORGET, LINE_PREFERENCE_NOTICE, type LinePreferenceCommand } from '../../domain/logic/line-preference-command.logic';
import { createLineAiInputEvidence, verifyLineAiInputEvidence, type AiBudgetGrantV2, type AiBudgetProfileIdV2 } from '@watchdog-bms/contracts';
import { LineLedgerDeliveryService } from '../line-ledger-delivery.service';
import { buildLineDeliveryPlan, deliveryHash, lineDeliveryPlanId, parseLineDeliveryPlan, parseDeliveryBatchStates, type DeliveryAuthorizationV2, type DeliveryPlanV2 } from '../../domain/logic/line-delivery-plan.logic';
import { parseAcceptedLedgerRequest } from '../line-ledger-accepted-request';
import { LineConversationContextService, lineConversationId, type LineConversationOwner } from '../line-conversation-context.service';
import { isFreeExpenseDraftCompany } from '../../../system-partner-management/application/free-expense-access';
import { FREE_EXPENSE_CHAT_REPLY, FREE_EXPENSE_TEXT_EDIT_REPLY, freeExpenseMenuReply, isExplicitFinalFinancialRequest, isExplicitSourceEditRequest } from '../../domain/logic/free-expense-line.logic';
import { completeCompanyOcrAdmissionWithinTransaction, freeExpenseAllowanceSnapshot, claimFreeExpenseQuotaNotice, releaseFreeExpenseQuotaNotice } from '../free-expense-quota';
import { freeExpenseQuotaNoticeTextTh, FREE_EXPENSE_IN_FLIGHT_TEXT_TH, FREE_EXPENSE_MULTI_DOCUMENT_TEXT_TH } from '../../../system-partner-management/domain/logic/receipt-quota.logic';
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
import { HttpException, Inject, forwardRef, Injectable, Logger, Optional, NotFoundException, ForbiddenException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { LINE_READ_EVIDENCE_MAX, LineReadEvidenceService } from '../line-read-evidence.service';
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
import { aiSelectableExpenseCategories } from '../../../expenses/application/services/expense-category-bootstrap.service';
import { LINE_RECENT_CAPTURE_WINDOW_MS, listRecentLineCaptureCandidates } from '../../../expenses/application/services/line-recent-capture';
import { namesLineMedia, receiptProgress, receiptProgressLabel, receiptStatusQuestion } from '../../domain/logic/line-receipt-status.logic';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import type { ExpenseRecord } from '../../../expenses/domain/models/expense.model';
import { pickLineDefaultBranchId } from '../../../expenses/domain/logic/line-receipt-branch.logic';
import { assertExpenseRootOpen } from '../../../expenses/application/expense-launch-gate';
import { CaptureLineExpenseNoteUseCase, LineTextExpenseCaptureIncompleteError } from '../../../expenses/application/use-cases/expense-document.use-case';
import { CorrectLineCapturedExpenseUseCase } from '../../../expenses/application/use-cases/line-correction.use-case';
import { LineDraftUpdateUseCase } from '../../../expenses/application/use-cases/line-draft-update.use-case';
import { detectLineDraftEditRequest } from '../../../expenses/domain/logic/line-draft-update.logic';
import { evaluateCorrectionHints, isExpenseEditCapabilityQuestion } from '../../../expenses/domain/logic/line-correction.logic';
import { LINE_DRAFT_UPDATE_TOOLS, type LineDraftUpdateTool } from '@watchdog-bms/contracts';
import {
  DRAFT_UPDATE_ALREADY_APPLIED_PREFIX,
  draftProposalAckReason,
  DRAFT_UPDATE_CANCELLED_REPLY,
  DRAFT_UPDATE_EXPIRED_REPLY,
  buildDraftUpdateOutcomeCard,
  buildDraftUpdatePreviewCard,
  draftUpdateBlockedState,
  draftUpdateAppliedReply,
  draftUpdateBlockedReply,
  draftUpdateChangedReply,
  draftUpdateMoveSuggestionReply,
  draftUpdateCanonicalDiff,
  formatRecordLabel,
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
  substituteAwaitsCaptionlessPhoto,
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
import { formatLineExpenseDraftReply, splitLineExpenseDraftReply, isDeterministicLineExpenseDraftInput, isLineExpenseDraftStartEligible, parseLineExpenseDraftContinuation, LINE_VENDOR_ADDRESS_PROMPT } from '../../../expenses/domain/logic/line-expense-draft-conversation.logic';
import { normalizeVendorName } from '../../../accounting-documents/domain/logic/vendor-counterparty-match.logic';
import { resolveNameCandidate, VENDOR_NAME_STRIP_PREFIXES } from '../../domain/logic/business-read-source.logic';
import { EXPENSE_SOURCE_DRAFT_KEY } from '../../../expenses/domain/logic/expense-source-draft.logic';
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
  attachmentInspectionFailureCode,
  type AttachmentInspectionPolicy,
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
  fileInspectionRefusalReply,
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
import type { AiBudgetScope, BusinessDocumentClassification, ExpenseChargeSummary, LineExpenseDraftRouteContext, LineUserContext, PlanTermLockReason, LineAiReadMemory, LineAiTurnRequest, LineAiTurnResponse, LineAiConversationContext, LineAiOpenClarification, LineAiValueCandidates, LineIntakeCorrectionCandidate, LineIntakeRoutePlan, LineIntakeSubstituteContext, ReceiptOcrFallbackReason, ReceiptOcrFieldResult, ReceiptOcrResponse, RequestContext } from '@watchdog-bms/contracts';
import { AI_BUDGET_REFUSAL_CODES, EXPENSE_STATUS_LABELS, scrubRecordIdentifier, LINE_AI_CONTEXT_MAX_TURNS, LINE_AI_CONTEXT_WINDOW_MINUTES, LINE_AI_ERROR_CODES, LINE_CORRECTION_CANDIDATE_LIMIT, LINE_TOOL_REGISTRY, RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE, isAiBudgetPermanentRefusal, isAiBudgetRefusalCode, nextPlanTierKey, asIntakeRouteIntent, civilDateToUtcDate, extractValueCandidates, extractValueCandidatesV2, mapThaiDigits, todayCivilDate, hasToolFeature, hasToolPermissions, lineToolRegistryFor, type ExpenseDocumentDateStatus } from '@watchdog-bms/contracts';
import { LineAiLedgerService, ledgerKey, LINE_CLARIFICATION_SOURCE_MAX_BYTES, type LedgerEntry, type LedgerSubRequestInput } from '../line-ai-ledger.service';
import { LineAiBudgetDeadlineExceededError } from '../line-ai-budget-authority.service';
import { lineDeliveryRecipientHash, resolvedLineDeliveryAccessFingerprint } from '../line-delivery-access';
import { ConsumptionMarkerUnavailableError, markClarificationsConsumed, type ClarificationConsumption } from '../line-ai-consumption-marker';
import { isOpenShopHelpQuestion, OPEN_SHOP_HELP_ANSWER, isPublicPolicyFollowUp, isPublicPolicyTopic, resolvePublicPolicyAnswer, type PublicPolicyTopic, type PublicPolicyAnswer } from '../../domain/logic/line-public-policy.logic';
import { buildEventDiscountCard, EVENT_DISCOUNT_MEMBER_REPLY, isMangmeeDiscountQuestion } from '../../domain/logic/line-event-discount.logic';
import { BillingService } from '../../../billing/application/billing.service';
import { availableApprovalSurfaceKeys, buildCapabilityCard, buildCompanyContextMessage, buildCompanyPickerMessage, buildContactCard, buildPackagePosterMessage, buildPackageReviewCard, buildPendingApprovalCard, buildPromotionCard, buildReceiptCapturePrompt, buildWelcomeReceiptCapturePrompt, WELCOME_RECEIPT_COMMAND, buildServiceEntitlementMessage, buildStaffCompletionQuickReply, buildStaffMainMenu, buildStaffQueryMenu, companyPickerPage, isCapabilityQuestion, staffMenuCommand, PACKAGE_CHANGE_COMMAND, PENDING_APPROVAL_ITEM_LIMIT, RESUME_AI_COMMAND, type ApprovalSurfaceKey, type CompanyPickerItem, type PendingApprovalSnapshot, type StaffMenuContext } from '../../domain/logic/line-staff-menu.logic';
import { lineSystemCardTexts } from '../../domain/logic/line-system-card.logic';
import { lineChoiceQuickReply, productHelpQuickReply, asCompleteLineCard, buildPublicPolicyCardMessage, buildAiBudgetExceededMessage, buildExpenseDraftCardMessage, buildExpenseDraftReviewCard, buildKeptReceiptCard, expenseDraftCardFactsFrom, expenseDraftCardSubject, buildPackageRequiredMessage, buildLegalAcceptanceRequiredMessage, buildLineAssistantTextCardMessage, buildLineBusinessAnswerMessage, buildDesignedLineAnswerMessage, buildLineSystemTextCardMessage, buildReceiptQuotaExceededMessage, buildReimbursementHandoffMessage, buildReimbursementPayerClarificationMessage, buildSignupDoorCard, buildSignupStatusCard, inheritCompleteLineBusinessAnswerPresentation, lineAnswerCardHeader, LIFF_ID_PATTERN, LINE_SENT_DOCUMENT_CARD_CONTEXT, LINE_SENT_DOCUMENT_OUTCOMES, type LineExpenseDraftCardFacts, type LineSentDocumentOutcome } from '../../domain/logic/line-business-card.logic';
// P10-L: the LINE surface opens a package-change request and tells the operators about a support
// request; both live in the signup module, which owns those rules and their audit.
import { PackageChangeRequestUseCase } from '../../../external-signup/application/package-change-request.use-case';
import { LineSignupNotifyService } from '../../../external-signup/application/line-signup-notify.service';
import { AuthRateLimitService } from '../../../auth/application/auth-rate-limit.service';
import { isBusinessHours } from '../../../external-signup/domain/business-hours.logic';
import { SIGNUP_SOURCE_LINE_OA } from '../../../external-signup/domain/company-signup.logic';
import { SUPPORT_ASSISTANT_PAUSE_MS } from '../../../external-signup/domain/support-request.constants';
import { advisorDirectAnswerText } from '../../domain/logic/line-advisor-direct-answer.logic';
import { capabilityFollowUpReply, capabilityHistoryIntent, isDeliveredCapabilityFollowUp, isNextStepQuestionText } from '../../domain/logic/line-ai-capability-follow-up.logic';
import { safeLineErrorDetails, parseOutcomeMessages, type LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { LINE_BUFFER_ORPHAN_REPROCESS_MS } from '../../domain/logic/line-message-buffer.logic';
import { resolveCompanyAiModelPolicy } from '../company-ai-model-policy';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../../common/logger/security-event';
import { LegalAcceptanceService } from '../../../auth/application/legal-acceptance.service';
import { expiredLineOwnerMessageTh, planTermLockReason } from '../../../system-partner-management/domain/logic/plan-term.logic';
import {
  displayReceiptQuotaLimit,
  receiptQuotaExceededShortTextTh,
  receiptQuotaExceededTextTh,
} from '../../../system-partner-management/domain/logic/receipt-quota.logic';
import { type CompanyOcrAdmissionIdentity, releaseCompanyOcrAdmission, LINE_RECEIPT_RETRY_LEASE_CODE, LINE_RECEIPT_RETRY_LEASE_MS, LINE_RECEIPT_RETRY_WAIT_CODE, claimReceiptQuotaNotice, receiptQuotaSnapshot, releaseReceiptQuotaNotice, RECEIPT_QUOTA_ERROR_CODE, settleCompanyOcrAdmission } from '../company-ocr-governance';
import { bangkokMonthKey } from '../company-ai-usage-meter';
import { LineHandoffLinkService } from '../line-handoff-link.service';
import { isLineGroupChatKey, LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN } from '../../../auth/domain/logic/line-handoff.logic';
import { canManagePlan, planManagerRoleFilter, PLAN_MANAGE_PERMISSION_KEY } from '../../../access-control/domain/logic/plan-manager.logic';
import {
  classifyLineAiGatewayFailure,
  classifyLineAiTerminalOutcome,
  emitLineAiTerminalOutcome,
  knownAiBudgetRefusal,
  knownAiBudgetResponse,
  terminalStatusForLineTurn,
  type LineAiTerminalMediaState,
} from '../../domain/logic/line-ai-terminal-outcome.logic';

export type LineTextEvent = {
  webhookEventId: string;
  lineUserId: string;
  replyToken: string;
  messageText: string;
  language?: 'th' | 'en';
  inputEvidence?: import('@watchdog-bms/contracts').LineAiInputEvidenceV2;
  messagingChannelId: string;
  channelKind?: 'USER' | 'GROUP' | 'ROOM';
  lineMessageId?: string;
  /** Chat to push into when the reply token has expired (group id in group chats). */
  pushTargetId?: string;
  /** Exact preview bound to a validated draft confirm/cancel postback; typed commands lack this. */
  packagePurchaseControl?: import('../line-package-purchase.service').PackagePurchaseControl;
  counterpartyControl?: import('../line-counterparty.service').CounterpartyControl;
  quotedMessageId?: string;
  expenseActionControl?: import('../line-expense-action.service').ExpenseActionControl;
  draftUpdatePreviewId?: string;
  reimbursementChoiceControl?: import('../line-reimbursement-draft.service').LineReimbursementChoiceControl;
  reimbursementDraftControl?: import('../line-reimbursement-draft.service').LineReimbursementDraftControl;
  answerDeliveryControl?: import('../../domain/logic/line-delivery-plan.logic').LineAnswerDeliveryControl;
  /** Internal buffer hook: settle any in-flight pre-reply feedback before the answer. */
  beforeReply?: () => Promise<void>;
  /** P12-3b: filled in once the turn has resolved WHO it is answering, so the send boundary can
   *  mint a deep-link handoff. Absent until then — an unlinked prompt has nobody to mint for. */
  handoff?: LineHandoffRecipient;
  /** Owner 2026-09-30 ("ทุกกรณีที่ระบบรับไว้ก่อน"): this message was accepted before the AI credit ran out
   *  — an orphan replay (set by the buffer), a parked photo's resumed answer, or the one re-ask after a
   *  failed answer — so its admissions may pass the cap. Server-set only, never from LINE JSON. */
  admitOverCap?: true;
};

/** The identity an outgoing message is addressed to; the only thing a handoff token binds. */
function replyLanguage(event: object): 'th' | 'en' {
  const turn = event as Partial<LineTextEvent>;
  return turn.language ?? lineReplyLanguage(turn.messageText ?? '');
}

export type LineHandoffRecipient = { userId: string; companyId: string };

export type LineReceiptUploadEvent = {
  language?: 'th' | 'en';
  webhookEventId: string;
  lineUserId: string;
  replyToken: string;
  lineMessageId: string;
  messageType: 'image' | 'file';
  fileName?: string;
  fileSize?: number;
  messagingChannelId: string;
  channelKind?: 'USER'|'GROUP'|'ROOM';
  /** Chat to push into when the reply token has expired (group id in group chats). */
  pushTargetId?: string;
  /** Resolved at durable acceptance so a later company switch cannot move this receipt. */
  companyIdAtAcceptance?: string;
  /** Snapshot/current support pause resolved by the durable buffer before any wait feedback. */
  assistantPaused?: boolean;
  /** P12-3b: see `LineTextEvent.handoff`. */
  handoff?: LineHandoffRecipient;
  /** Internal buffer hook: settle any in-flight pre-reply feedback before the answer. */
  beforeReply?: () => Promise<void>;
  /** Set by the capture lanes only (appendix §3): the handoff surface this reply's link belongs to. */
  handoffSurface?: string;
  /** See `LineTextEvent.admitOverCap`: set by the buffer for an orphan replay of this photo. */
  admitOverCap?: true;
};

/** `defer_text` = the intake router judged the accompanying caption to be a
 *  standalone question (spec §8); the caller should run it as a text turn.
 *  `locked` = the shop is locked and was sent the lock reply, which answers the rest of the batch. */
export type LineMediaTurnOutcome = { outcome: 'done' | 'defer_text' | 'locked' };

/** Read-only gate used by the verified employee LINE webhook before it writes
 * the recoverable buffer payload. `continue` deliberately also covers users
 * whose company cannot yet be resolved (unlinked / selection / policy flows),
 * so this preflight never invents a default company. */
export type LineLegalAcceptancePreflight =
  // `companyId` on continue is present only when a single company resolved; the buffer uses it as the
  // stable debounce-cohort key. Unlinked/unresolved/multi-company continues omit it (no assignment).
  | { status: 'continue'; companyId?: string; assistantPaused?: true }
  | { status: 'required'; companyId: string };

const UNLINKED_REPLY = { th: '🔗 กรุณาเชื่อมต่อบัญชี มั่งมีพลัส กับ LINE ก่อนใช้งานนะคะ\nเปิดเว็บแอปเพื่อเชื่อมต่อได้เลยค่ะ', en: "Please link your MangmeePlus account to LINE through the web app." };
// ── P10-L §7 copy. Owner-editable; no plus sign anywhere a customer reads (write "และ"). ──
/** The staff door of §3.1: the employee link is issued by the owner, never self-served. */
const EMPLOYEE_DOOR_REPLY = { th: `👋 ยินดีต้อนรับค่ะ ถ้าคุณเป็นพนักงาน ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}เปิดเมนู "พนักงาน" ในเว็บแอป `
  + 'แล้วส่งลิงก์เชื่อม LINE มาให้นะคะ กดลิงก์นั้นครั้งเดียวก็ใช้งานได้เลยค่ะ (ไม่ต้องสมัครร้านใหม่นะคะ)', en: "Ask the shop owner to open Employees on the web and send you a LINE linking code." };
/** L-17: the greeting for someone the system already knows. Short on purpose — they came back. */
const WELCOME_BACK_REPLY = { th: 'ยินดีต้อนรับกลับมาค่ะ เลือกเมนูที่ต้องการใช้งานได้เลยค่ะ หากต้องการคุยกับทีมงาน พิมพ์ ติดต่อเจ้าหน้าที่ ได้ค่ะ', en: 'Welcome back; choose a menu to continue, or contact staff for help.' };
/**
 * Owner copy 2026-09-21: the first hello, sent IN FRONT of the door card to someone who has just
 * added the OA. The card alone answered "which door" without ever answering "what is this and what
 * does it cost", so a follower had to guess both. Verbatim Owner wording — edit only on their word.
 * The business-package line follows the Owner's sign-off of 2026-09-27 (purchase-without-setup G20:
 * the 1,999 package has the same menus as the others and adds ภ.ง.ด.53 and 50 ทวิ).
 */
const FOLLOW_WELCOME_REPLY = { th: 'สวัสดีค่ะ ขอบคุณที่เพิ่มมั่งมีพลัสเป็นเพื่อนนะคะ\nเลือกเปิดร้านใหม่ หรือเชื่อมบัญชีที่มีอยู่ในการ์ดด้านล่างได้ค่ะ หากเป็นพนักงาน ให้ใช้ลิงก์เชื่อม LINE จากเจ้าของกิจการค่ะ', en: 'Welcome to MangmeePlus; link your account or register your shop to get started.' };
/** The way out of a support pause, as every reply that offers one prints it: the tile's own words,
 *  tapped or typed (Owner 2026-09-06). Built from the command so the hint and the matcher cannot
 *  drift — and never "AI": the customer knows her as น้องมั่งมี. */
const RESUME_HINT = `· กดปุ่ม "${RESUME_AI_COMMAND}" หรือพิมพ์ "${RESUME_AI_COMMAND}" เมื่ออยากให้น้องมั่งมีตอบต่อ`;
/** line-support-request-spec-th §2.1.4. Carries the way out, because a 24h pause with no exit was
 *  the other half of the complaint. No plus sign anywhere a customer reads. */
const STAFF_CONTACT_REPLY = { th: '📮 รับเรื่องแล้วค่ะ ทีมงานจะตอบในแชทนี้ในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) '
  + `หากรีบ โทร 098-256-5628 ได้เลยค่ะ ${RESUME_HINT}`, en: "Your request was received; our team will reply here during business hours, Monday–Saturday, 9:00–18:00." };
/** §2.2.4: a second tap while the first request is still OPEN. Honest, and pages nobody twice. */
const SUPPORT_ALREADY_OPEN_REPLY = { th: '📮 คำขอของคุณยังอยู่ในคิวค่ะ ทีมงานจะตอบในแชทนี้ในเวลาทำการ '
  + `(จันทร์–เสาร์ 9:00–18:00) นะคะ ${RESUME_HINT}`, en: "Your request is still queued; our team will reply here during business hours, Monday–Saturday, 9:00–18:00." };
/** §2.4: the assistant is back, said in the assistant's own voice. */
const ASSISTANT_RESUMED_REPLY = { th: '💚 น้องมั่งมีกลับมาแล้วค่ะ ถามได้เลยนะคะ', en: "Nong Mangmee is back; how can I help?" };
/** The amplification floor's answer. Warm on purpose: whoever hits it may still genuinely need
 *  help, and the requests they already opened are in the operator inbox either way. */
const SUPPORT_DAILY_LIMIT_REPLY = { th: '📮 วันนี้ยังเปิดคำขอคุยกับเจ้าหน้าที่เพิ่มไม่ได้ค่ะ '
  + 'หากยังต้องการความช่วยเหลือ โทร 098-256-5628 ได้เลยค่ะ', en: "You cannot open another support request today; please continue your existing request or try tomorrow." };
/** G19: what the inbox shows for a callback request (requestText/lastMessageText + thread line). */
const PACKAGE_CALLBACK_NOTE = 'ขอให้ทีมงานติดต่อกลับเรื่องแพ็กเกจ';
/** G19: no pause — the assistant keeps answering while the team calls back (RV32). */
const PACKAGE_CALLBACK_REPLY = { th: '📮 รับเรื่องแล้วค่ะ ทีมงานจะติดต่อกลับเรื่องแพ็กเกจในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) '
  + 'ระหว่างนี้ถามน้องมั่งมีต่อได้เลยนะคะ', en: "Your package enquiry was received; our team will contact you during business hours, Monday–Saturday, 9:00–18:00." };
/** …except where no ACTIVE shop resolves: the assistant cannot answer there, so it is not offered. */
const PACKAGE_CALLBACK_NO_ASSISTANT_REPLY = { th: '📮 รับเรื่องแล้วค่ะ ทีมงานจะติดต่อกลับเรื่องแพ็กเกจในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) นะคะ', en: "Your package enquiry was received; our team will contact you during business hours, Monday–Saturday, 9:00–18:00." };
const PACKAGE_CALLBACK_ALREADY_OPEN_REPLY = { th: '📮 คำขอของคุณยังอยู่ในคิวค่ะ ทีมงานจะติดต่อกลับในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) นะคะ', en: "Your package enquiry is still queued; our team will contact you during business hours, Monday–Saturday, 9:00–18:00." };
/** Sent while a support pause is running and there is no live request to write to (§8). */
const SUPPORT_PAUSED_REPLY = { th: '📮 ยังส่งข้อความนี้เข้าคิวทีมงานไม่สำเร็จค่ะ '
  + 'กรุณากด "ติดต่อเจ้าหน้าที่" อีกครั้ง หากยังไม่ได้ โทร 098-256-5628 ได้เลยค่ะ', en: "Your message could not be queued for the team; please try again." };
/**
 * UAT 2026-09-06. The reply above was told to a customer whose message had just been dropped on the
 * floor, which is the one thing it must never mean. This one is only ever sent once the message is
 * ON the request an operator reads, so "ส่งถึงทีมงานแล้ว" is a fact rather than a comfort.
 */
const SUPPORT_FOLLOW_UP_REPLY = { th: '📮 ส่งข้อความถึงทีมงานแล้วค่ะ ทีมงานจะตอบกลับในแชทนี้นะคะ '
  + RESUME_HINT, en: "Your message was sent to the team; they will reply here." };
/**
 * UAT 2026-09-06 (§2.2 delta รอบ 6). The full confirmation is worth saying once; said to every line
 * of a burst it is the noise the Owner saw three times in one screen — and the menu hint least of
 * all, since the customer has just read it. The MESSAGE is still recorded every time; only the
 * speech is rationed, off the `lastMessageAt` the row already carries.
 */
const SUPPORT_FOLLOW_UP_REPEAT_REPLY = { th: '📮 รับข้อความแล้วค่ะ', en: "Message received." };
const SUPPORT_MEDIA_RECEIVED_REPLIES = {
  image: '📎 รับรูปแล้วค่ะ ส่งให้ทีมงานแล้ว',
  file: '📎 รับไฟล์แล้วค่ะ ส่งให้ทีมงานแล้ว',
} as const;
const SUPPORT_FOLLOW_UP_REPLY_INTERVAL_MS = 10 * 60 * 1000;
const SUPPORT_FOLLOW_UP_REPLIES = {
  none: SUPPORT_PAUSED_REPLY['th'],
  recorded: SUPPORT_FOLLOW_UP_REPLY['th'],
  repeat: SUPPORT_FOLLOW_UP_REPEAT_REPLY['th'],
} as const;
type SupportFollowUpOutcome = keyof typeof SUPPORT_FOLLOW_UP_REPLIES;
/** §3 PDPA: one line of context for the operator, never a transcript. */
const SUPPORT_LAST_MESSAGE_MAX_LENGTH = 200;
/** สัญญา v3 ข้อ 9: the thread keeps the customer's whole sentence, the row keeps its 200-char summary. */
const SUPPORT_THREAD_TEXT_MAX_LENGTH = 2000;
/**
 * สัญญา v3 ข้อ 10/12: what one live request may accumulate. An UNLINKED stranger can open a request
 * (three a day) and then write to it for as long as it stays live, so without a ceiling one LINE
 * account could fill Postgres with photos. Fifty stored files and five hundred bubbles is more than
 * any real conversation has needed; past that the row is kept and marked, never the bytes.
 */
const SUPPORT_THREAD_MAX_MESSAGES = 500;
const SUPPORT_THREAD_MAX_MEDIA = 50;
const PACKAGE_CHANGE_ACCEPTED_REPLY = { th: '📦 รับคำขอแล้วค่ะ ทีมงานจะติดต่อกลับในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) นะคะ', en: "Your request was received; our team will contact you during business hours, Monday–Saturday, 9:00–18:00." };
const PACKAGE_CHANGE_NOT_OWNER_REPLY = { th: `📦 หากต้องการเปลี่ยนแพ็กเกจ รบกวนแจ้ง${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้มีสิทธิ์จัดการแพ็กเกจให้พิมพ์ `
  + '"ขอเปลี่ยนแพ็กเกจ" ในแชทนี้ได้เลยค่ะ', en: "Ask the shop owner or an authorized package manager to request the package change." };
const PACKAGE_CHANGE_UNAVAILABLE_REPLY = { th: '📦 ตอนนี้เปิดคำขอเปลี่ยนแพ็กเกจให้ไม่ได้ค่ะ รบกวนติดต่อทีมงานที่ 098-256-5628 นะคะ', en: "The package request could not be opened; please contact the team at 098-256-5628." };
/** What the admin queue shows for a request that came from a chat button with no tier chosen. */
const PACKAGE_CHANGE_LINE_NOTE = 'ขอผ่าน LINE ยังไม่ได้เลือกแพ็กเกจ ทีมงานคุยกับร้านแล้วปรับได้';
const PROFILE_GUARD_ACCEPTED_REPLY = { th: '🔐 ได้เลยค่ะ ใส่อีเมลหรือเบอร์ไว้ในหน้าตั้งค่าได้ที่ลิงก์นี้นะคะ', en: "Add your email or phone number through this settings link." };
const PROFILE_GUARD_LATER_REPLY = { th: '👍 ได้ค่ะ ไว้พร้อมเมื่อไหร่พิมพ์ "ตั้งค่า" มาได้เลยนะคะ', en: "When ready, send “settings” here." };
/** The states in which an application is still travelling, so the door shows status (§3.1/§5). */
const OPEN_LINE_SIGNUP_STATES = [
  'RECEIVED', 'VALIDATED', 'PENDING_REVIEW', 'PROVISIONING', 'PROVISIONING_FAILED', 'READY',
] as const;
// PDPA objection route (M-05 register §3.1): the user opted out of AI processing, so the
// turn stops here — before any model, tool, or gateway involvement. Deterministic text.
const AI_OPT_OUT_REPLY = { th: 'คุณปิดการใช้งานผู้ช่วย AI ไว้ ข้อความนี้จึงไม่ถูกประมวลผลด้วย AI ค่ะ\nเปิดใช้งานอีกครั้งได้ที่ เว็บแอป → ตั้งค่า → ความปลอดภัย นะคะ', en: "AI assistance is off, so this message was not processed by AI; enable it in the web app under Settings → Security." };
export { LEGAL_ACCEPTANCE_REQUIRED_REPLY } from '../../domain/logic/line-business-card.logic';
const FORBIDDEN_REPLY = { th: '🔒 คุณไม่มีสิทธิ์ใช้งาน LINE AI สำหรับบริษัทนี้ค่ะ', en: "You cannot use LINE AI for this shop; ask the owner or an authorized administrator." };
const ERROR_REPLY = { th: '⏳ ขออภัยค่ะ เกิดข้อผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ', en: "A temporary error occurred; please try again shortly." };
/** The bytes never arrived from LINE, so "nothing was saved" is provably true — say so, and name
 *  what to resend (a generic "ลองใหม่" left users unsure what failed). §17.1: the noun matches what
 *  the customer actually sent, so a PDF is never called a รูป (UXE-03). */
export const mediaDownloadFailedReply = (messageType: 'image' | 'file', language: 'th' | 'en' = 'th'): string => language === 'en' ? `The ${messageType === 'file' ? 'file' : 'photo'} could not be downloaded; nothing was saved from it, so please resend it.` : messageType === 'file'
  ? '📄 น้องยังรับไฟล์จาก LINE ไม่สำเร็จค่ะ ยังไม่ได้บันทึกรายการใด ๆ จากไฟล์นี้นะคะ รบกวนส่งไฟล์เดิมอีกครั้งค่ะ'
  : '📷 น้องยังรับรูปจาก LINE ไม่สำเร็จค่ะ ยังไม่ได้บันทึกรายการใด ๆ จากรูปนี้นะคะ รบกวนส่งรูปเดิมอีกครั้งค่ะ';
/** The media turn failed somewhere after the bytes arrived, so the record state is uncertain —
 *  no "nothing was saved" promise here; the duplicate-file warning covers an honest resend. */
class LineDeliveryError extends Error {
  constructor(result: LineDeliveryResult) { super(`LINE_DELIVERY_${result.toUpperCase()}`); }
}
const SAVED_LINE_RECEIPT = Symbol('saved-line-receipt');
/** สัญญา v3: the bytes the support thread already fetched for this event, so the receipt lane does not fetch them again. */
const SUPPORT_MEDIA_DOWNLOAD = Symbol('support-media-download');
type SupportMediaDownloadCarrier = LineReceiptUploadEvent & { [SUPPORT_MEDIA_DOWNLOAD]?: LineMediaDownloadResult };
type SavedLineReceipt = { expenseId: string; companyId: string; uploaded: boolean };
type LineReceiptAdmissionAttempt = { identity?: CompanyOcrAdmissionIdentity; companyId?: string; receiptRequested: boolean; usablePersisted: boolean; noReceipt?: boolean };

export const mediaProcessingFailedReply = (messageType: 'image' | 'file', language: 'th' | 'en' = 'th'): string => language === 'en' ? `The ${messageType === 'file' ? 'file' : 'photo'} could not be processed; please resend it and I’ll flag any duplicate already saved.` : messageType === 'file'
  ? '📄 ขออภัยค่ะ ระบบประมวลผลไฟล์นี้ไม่สำเร็จ รบกวนส่งไฟล์เดิมอีกครั้งนะคะ ถ้าไฟล์นี้เคยบันทึกไว้แล้ว ระบบจะแจ้งเตือนรายการซ้ำให้ค่ะ'
  : '📷 ขออภัยค่ะ ระบบประมวลผลรูปนี้ไม่สำเร็จ รบกวนส่งรูปเดิมอีกครั้งนะคะ ถ้ารูปนี้เคยบันทึกไว้แล้ว ระบบจะแจ้งเตือนรายการซ้ำให้ค่ะ';
const RATE_LIMIT_REPLY = { th: '⏳ ระบบกำลังประมวลผลข้อความก่อนหน้า กรุณารอสักครู่แล้วลองใหม่อีกครั้งนะคะ', en: "A previous message is still being processed; please wait a moment and try again." };
/** Spec §9.1 `AI_BUDGET_UNAVAILABLE`: the meter could not be READ. It is not the budget card (we do
 *  not know that the budget is full) and not the generic error (nothing broke on the customer's
 *  side). Deterministic, no model call, no money figure, no company configuration. */
const AI_BUDGET_UNAVAILABLE_REPLY = { th: '⏳ ตอนนี้ยังตรวจสอบเครดิต AI ของร้านไม่ได้ค่ะ น้องมั่งมีเลยยังไม่เริ่มงานให้ '
  + 'รบกวนลองใหม่อีกครั้งในอีกสักครู่นะคะ ระหว่างนี้ใช้งานผ่านเว็บแอปได้ตามปกติค่ะ', en: "Your shop’s AI credit could not be checked, so this task has not started; try again shortly or use the web app." };
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
  tail: string, language: 'th' | 'en' = 'th',
): { reply: string; status: string; errorCode: string } | undefined {
  const code = error instanceof HttpException
    ? (error.getResponse() as { code?: string } | undefined)?.code
    : undefined;
  const inspectionReply = code && fileInspectionRefusalReply(code, language);
  if (inspectionReply) return { reply: inspectionReply, status: 'media_security_rejected', errorCode: code! };
  if (code === 'TRANSACTION_BRANCH_REQUIRED' || code === 'TRANSACTION_BRANCH_INVALID') {
    return {
      reply: language === 'en' ? LEGACY_LINE_COPY_EN.RECEIPT_BRANCH_REQUIRED_REPLY + (tail === BRANCH_RETRY_RESEND ? ' Then resend the photo.' : ' The earlier file is retained; repeat your answer after choosing the branch.') : `${RECEIPT_BRANCH_REQUIRED_REPLY}${tail}`,
      status: 'clarification_required',
      errorCode: 'RECEIPT_BRANCH_SELECTION_REQUIRED',
    };
  }
  return undefined;
}
/** Sent INSTEAD of RATE_LIMIT_REPLY when the turn's ledger entry exists: the reclaim drain WILL
 *  answer it, so telling the user to resend would produce a double answer (UAT 2026-08-27). */
const BUSY_FOLLOW_UP_REPLY = { th: '⏳ น้องมั่งมีกำลังตอบข้อความก่อนหน้าอยู่ค่ะ ข้อความนี้รับไว้แล้ว เดี๋ยวตามมาตอบให้เองนะคะ ไม่ต้องส่งซ้ำค่ะ', en: "Your message is queued while I answer the previous one; I’ll reply here, so there is no need to resend." };
/** How long a live turn may wait for the per-company AI admission lease before giving up. The
 *  lease frees between a media turn's model calls, so a queued chat message usually slips into
 *  one of those gaps well inside this window; LINE's loading indicator covers the wait. */
const LINE_AI_LIVE_BUSY_WAIT_MS = 25_000;

/** Request-scoped ERP catalog upper bound from the same authority snapshot used downstream. */
export function lineIntakeOfferedToolNames(input: {
  permissions: readonly string[];
  entitledFeatureKeys: ReadonlySet<string> | null | undefined;
  draftEditEnabled?: boolean;
  publicLookupEnabled?: boolean;
  reimbursementDraftWriteEnabled?: boolean;
}): string[] {
  const entitled = input.entitledFeatureKeys;
  if (!input.permissions.includes('ai.tool.invoke') || entitled === undefined) return [];
  return lineToolRegistryFor(input)
    .filter((tool) => hasToolPermissions(tool, input.permissions) && hasToolFeature(tool, entitled))
    .map((tool) => tool.name)
    .sort();
}
const RECEIPT_LINK_REPLY = { th: '🔗 กรุณาเชื่อมต่อบัญชี มั่งมีพลัส กับ LINE ก่อนส่งบิลหรือใบเสร็จนะคะ', en: "Please link your MangmeePlus account to LINE before sending receipts." };
/** C3: what someone who is NOT the owner of a locked shop hears. No tier, no date, no price — the
 *  same "ask the shop owner" rule the web banner follows — but it no longer tells a connected
 *  employee to connect an account they already connected. */
export const PACKAGE_REQUIRED_MEMBER_REPLY = `ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้ค่ะ ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจก่อน แล้วน้องมั่งมีจะกลับมาช่วยได้เต็มที่นะคะ`;
const RECEIPT_FORBIDDEN_REPLY = { th: '🔒 คุณไม่มีสิทธิ์อัปโหลดบิลหรือใบเสร็จผ่าน LINE ค่ะ', en: "You cannot capture expenses; ask the shop owner or an authorized administrator." };
const EXPENSE_FEATURE_DISABLED_REPLY = { th: `📋 บริษัทนี้ยังไม่ได้เปิดใช้งานระบบค่าใช้จ่ายและเอกสารค่ะ\n${LINE_FEATURE_DISABLED_HELP_TH}`, en: "Your package does not include expenses; ask the shop owner for help." };
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
const capabilityEntitlementReply = (lead: string, entitled: ReadonlySet<string> | null, language: 'th' | 'en' = 'th'): LineReplyMessage[] =>
  [{ type: 'text', text: `${lead}\n${language === 'en' ? LEGACY_LINE_COPY_EN.CAPABILITY_ENTITLEMENT_NOTE : CAPABILITY_ENTITLEMENT_NOTE}` }, buildServiceEntitlementMessage(entitled, language)];
const ASSISTANT_TALK_GREETING = 'น้องมั่งมีมาแล้วค่ะ เลือกเมนูที่ต้องการใช้งานได้เลยค่ะ';
const SIGNATURE_FORBIDDEN_REPLY = { th: '🔒 คุณไม่มีสิทธิ์เก็บลายเซ็นประจำตัวผ่าน LINE ค่ะ', en: "You cannot manage signatures; ask the shop owner or an authorized administrator." };
const SIGNATURE_NEED_IMAGE_REPLY = { th: '✍️ ต้องการอัปโหลดลายเซ็นใช่ไหมคะ กรุณาส่ง "รูปลายเซ็น" เข้ามาในแชทนี้ได้เลยนะคะ\nระบบจะเก็บเป็นลายเซ็นประจำตัวของคุณ ใช้ลงนามได้ทันทีค่ะ', en: "Please send a clear photo of your signature on a plain background." };
const CLARIFY_REPLY = { th: '🤔 น้องมั่งมียังไม่แน่ใจว่าต้องการทำอะไรกับข้อความ/รูปนี้ค่ะ\n• ถ้าเป็นหลักฐานค่าใช้จ่าย (ใบเสร็จ/สลิป/บิล/สกรีนช็อต) ส่งรูปอีกครั้งพร้อมข้อความ เช่น "บันทึกค่าใช้จ่าย"\n• ถ้าต้องการเก็บลายเซ็นประจำตัว ส่งรูปอีกครั้งพร้อมข้อความ เช่น "อัปโหลดลายเซ็น"', en: "What would you like help with?" };
const MUTATION_REFUSAL_REPLY = '🔒 น้องมั่งมีไม่สามารถทำรายการอนุมัติ/จ่ายเงิน/ลงบัญชี หรือยื่นภาษีได้ค่ะ\nกรุณาทำรายการในเว็บมั่งมีนะคะ';
const MEDIA_UNSUPPORTED_REPLY = 'ℹ️ ระบบรองรับ: ส่งรูป/ไฟล์หลักฐานค่าใช้จ่ายเพื่อบันทึกร่าง หรือส่งรูปลายเซ็นเพื่อเก็บเป็นลายเซ็นประจำตัวค่ะ\nการยืนยัน/จ่ายเงิน/ลงบัญชีต้องทำในเว็บแอปนะคะ';
const MEDIA_SECURITY_REJECTED_REPLY = `⚠️ ไม่สามารถรับไฟล์นี้ได้ค่ะ กรุณาส่งไฟล์ PDF หรือ${SIGNATURE_FILE_TYPES_LABEL} ที่ไฟล์ไม่เสียหายและผ่านการตรวจสอบความปลอดภัยนะคะ`;
/** RECEIPT-05 (owner decision 2026-07-12): the ONE clarify question asked when media arrives
 *  with a business-question caption, instead of silently discarding the image. */
const MEDIA_CLARIFY_REPLY = { th: '🤔 รูปนี้เป็นอะไรคะ เลือกบันทึกใบเสร็จ ภาพประกอบ หรือสรุปหลายรายการได้เลยค่ะ', en: "Is this an expense receipt, a signature, or an illustration?" };
const MEDIA_REVIEW_CHOICE = 'เลือกเก็บรูปไว้ตรวจโดยไม่สร้างค่าใช้จ่าย แล้วส่งเอกสารแยกทีละภาพได้ค่ะ';
const MULTI_DOCUMENT_CLARIFY_REPLY = { th: [
  '📄 พบเอกสารมากกว่า 1 ฉบับในภาพ จึงยังไม่ดึงยอดไปบันทึกเป็นค่าใช้จ่ายรายการเดียวค่ะ',
  MEDIA_REVIEW_CHOICE,
].join('\n'), en: "This image contains several documents; please send each document separately." };
function mediaChoiceQuickReply(text: string, language: 'th' | 'en' = 'th'): LineReplyMessage['quickReply'] | undefined {
  if (language === 'en' && text.includes(MEDIA_CLARIFY_REPLY.en)) { return lineChoiceQuickReply([{ label: 'Record receipt', text: 'Record receipt' }, { label: 'Question only', text: 'Question only; do not record' }, { label: 'Several documents', text: 'Summarize several documents' }]); }

  if (text.includes(MEDIA_CLARIFY_REPLY['th'])) return lineChoiceQuickReply([
    { label: 'บันทึกใบเสร็จ', text: 'บันทึกใบเสร็จ' }, { label: 'ภาพประกอบคำถาม', text: 'ภาพประกอบคำถาม' }, { label: 'สรุปหลายรายการ', text: 'สรุปหลายรายการ' },
  ]);
  return text.includes(MEDIA_REVIEW_CHOICE) ? lineChoiceQuickReply([{ label: 'สรุปหลายรายการ', text: 'สรุปหลายรายการ' }]) : undefined;
}
function formatUtilityDocumentsReply(parts: NonNullable<ReceiptOcrResponse['utilityDocuments']>, language: 'th' | 'en' = 'th'): string {
  if (language === 'en') { return [`Found ${parts.length} utility-document sections in this image:`, ...parts.slice(0, 4).map(part => `• ${part.role === 'BILL_DUE' ? 'Bill due' : 'Receipt'} · ${part.period} · ${part.amount} THB`), 'Please send each document separately to review it without combining amounts.'].join('\n'); }

  return [
    `📄 อ่านเอกสารค่าน้ำ/ค่าไฟได้ ${parts.length} ส่วนจากภาพเดียว:`,
    ...parts.slice(0, 4).map((part) => {
      const label = part.role === 'BILL_DUE' ? 'ใบแจ้ง' : 'ใบเสร็จ';
      const state = part.role === 'BILL_DUE' ? 'ยอดเรียกเก็บ ยังไม่ยืนยันว่าชำระ' : 'หลักฐานรับเงินของงวดนี้';
      return `• ${label} งวด ${part.period.replace(/\s+/g, ' ').slice(0, 60)}: ${part.amount} บาท (${state})`;
    }),
    MEDIA_REVIEW_CHOICE,
  ].join('\n');
}

const UTILITY_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

function utilityMonthIndex(period: string): number | null {
  const value = mapThaiDigits(period.trim().replace(/^(?:งวด|เดือน|ประจำเดือน)\s*/u, ''));
  const numeric = value.match(/^(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})$/u);
  const named = value.match(/^([ก-๙]+)\s+(\d{2}|\d{4})$/u);
  const month = numeric ? Number(numeric[1]) : named ? UTILITY_MONTHS.indexOf(named[1]!) + 1 : 0;
  const rawYear = Number(numeric?.[2] ?? named?.[2]);
  if (month < 1 || month > 12 || !Number.isInteger(rawYear)) return null;
  const beYear = rawYear < 100 ? 2500 + rawYear : rawYear < 2400 ? rawYear + 543 : rawYear;
  if (beYear < 2500 || beYear > 2700) return null;
  return beYear * 12 + month;
}

/** One normal utility sheet has one current invoice and last month's receipt. The paid receipt
 * enters the existing single-expense draft path; the new invoice remains read-only here. */
function priorUtilityReceipt(ocr: ReceiptOcrPreflight): {
  bill: NonNullable<ReceiptOcrResponse['utilityDocuments']>[number];
  receipt: NonNullable<ReceiptOcrResponse['utilityDocuments']>[number];
  fields: ReceiptOcrFieldResult;
  classification: BusinessDocumentClassification;
} | null {
  const parts = ocr.utilityDocuments;
  const source = ocr.classification;
  if (ocr.status !== 'OCR_EXTRACTED_NEEDS_REVIEW' || source?.contentKind !== 'MULTI_DOCUMENT'
    || source.businessDirection === 'SALES_RECEIVABLE' || source.businessDirection === 'CUSTOMER_INBOUND'
    || source.contradictionSignals.length || parts?.length !== 2) return null;
  const bill = parts.find((part) => part.role === 'BILL_DUE');
  const receipt = parts.find((part) => part.role === 'RECEIPT_PAID');
  if (!bill || !receipt || !/(?:ค่าน้ำ|ประปา|ค่าไฟ|ไฟฟ้า)/u.test(bill.titleEvidence)
    || !/(?:ใบเสร็จ|ใบรับเงิน|ใบสรุปรับเงิน)/u.test(receipt.titleEvidence)) return null;
  const billMonth = utilityMonthIndex(bill.period);
  const receiptMonth = utilityMonthIndex(receipt.period);
  const amount = mapThaiDigits(receipt.amount).replace(/,/g, '');
  if (billMonth === null || receiptMonth !== billMonth - 1 || !/^\d+(?:\.\d{1,2})?$/u.test(amount)
    || Number(amount) <= 0 || !Number.isFinite(Number(amount))) return null;
  const classification: BusinessDocumentClassification = {
    contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT', 'PAYMENT_PROOF'],
    confidence: source.confidence, evidenceSignals: [receipt.titleEvidence, receipt.period, receipt.amountEvidence],
    amountSignals: [receipt.amountEvidence], settlementSignals: [receipt.titleEvidence], missingRequiredSignals: [],
    contradictionSignals: [], requiresClarification: false,
  };
  const fields: ReceiptOcrFieldResult = {
    description: `${receipt.titleEvidence} งวด ${receipt.period}`, grandTotalAmount: amount,
    missingFields: ['vendor', 'expenseDate', 'documentNumber', 'vatAmount', 'category'],
  };
  return isExpenseExtractionEligible(classification, amount) ? { bill, receipt, fields, classification } : null;
}

/** A request for the supplier's current utility notice in the photo just discussed. */
export function isUtilityBillSaveRequest(text: string): boolean {
  const value = normalizeLineText(text).toLocaleLowerCase('th-TH');
  return /(บันทึก|สร้าง|เก็บ|ลงรายการ)/u.test(value)
    && /(ใบแจ้ง(?:หนี้|ค่าน้ำ|ค่าไฟ)?|บิล(?:ค่าน้ำ|ค่าไฟ)?)/u.test(value)
    && /(ค่าน้ำ|ค่าไฟ|ประปา|ไฟฟ้า|งวด(?:นี้|ปัจจุบัน)|ด้วย|รูป(?:นี้|เดิม))/u.test(value)
    && !/(ออกใบแจ้งหนี้|ให้ลูกค้า|ขาย|(?:อย่า|ไม่ต้อง|ห้าม)\s*(?:บันทึก|สร้าง|เก็บ|ลงรายการ)|ไหม|หรือเปล่า|[?？])/u.test(value);
}

function savedUtilityBill(expense: ExpenseRecordWithRelations): NonNullable<ReceiptOcrResponse['utilityDocuments']>[number] | null {
  const parts = expense.aiVerificationSummaryJson?.utilityDocuments;
  if (expense.sourceDocumentType !== 'RECEIPT' || !Array.isArray(parts) || parts.length !== 2) return null;
  const bill = parts.find((part) => part?.role === 'BILL_DUE');
  const receipt = parts.find((part) => part?.role === 'RECEIPT_PAID');
  if (!bill || !receipt || typeof bill.period !== 'string' || typeof receipt.period !== 'string'
    || typeof bill.titleEvidence !== 'string' || typeof receipt.titleEvidence !== 'string'
    || typeof bill.amount !== 'string' || typeof receipt.amount !== 'string'
    || !/(?:ค่าน้ำ|ประปา|ค่าไฟ|ไฟฟ้า)/u.test(bill.titleEvidence)
    || !/(?:ใบเสร็จ|ใบรับเงิน|ใบสรุปรับเงิน)/u.test(receipt.titleEvidence)
    || utilityMonthIndex(bill.period) === null
    || utilityMonthIndex(receipt.period) !== utilityMonthIndex(bill.period)! - 1
    || !/^\d{1,14}(?:\.\d{1,2})?$/u.test(mapThaiDigits(bill.amount).replace(/,/gu, ''))
    || Number(mapThaiDigits(bill.amount).replace(/,/gu, '')) <= 0
    || Number(mapThaiDigits(receipt.amount).replace(/,/gu, '')) !== Number(expense.grandTotalAmount)) return null;
  return bill;
}

/** Keep a governed OCR refusal useful: the attachment remains recoverable and the same simple
 * numbered manual path stays available. Internal route/config names never reach the customer.
 * `readFailed` marks a transient read failure (timeout/empty/truncated output): the honest lead-in
 * is "the read failed", not the bare "what is this picture?" that reads as if the photo were the
 * problem (owner UX review 2026-08-29). */
export function formatOcrGovernanceClarifyReply(errorCode?: string, readFailed = false, language: 'th' | 'en' = 'th'): string {
  if (language === 'en') { return aiBudgetReasonTh(errorCode) ? 'The photo is kept, but the shop’s AI allowance currently prevents document reading; no expense was created, so review it on the web or choose how to handle the photo.' : errorCode === 'AI_DOCUMENT_READING_DISABLED' ? 'Automatic document reading is disabled for this shop; the file can be kept for manual review.' : readFailed ? 'The photo could not be read; it is kept and no expense was created, so resend a clearer copy or review it on the web.' : 'The photo is kept; please choose whether to record a receipt or use it for a question.'; }

  // §9.2: the company's AI MONEY closed the read. The picture IS kept (this branch only runs once
  // `ensurePendingMedia` has a row), nothing was recorded, and no automatic retry is promised. The
  // old wording — "ระบบอ่านเอกสารขัดข้องชั่วคราว" — was a false outage story for a policy decision.
  const budgetReason = aiBudgetReasonTh(errorCode);
  if (budgetReason) {
    return `${isDocumentReadingCreditSpent(errorCode) ? '💚' : '⏳'} รับรูปไว้แล้วค่ะ แต่${budgetReason} `
      + `จึงยังไม่ได้อ่านและยังไม่ได้บันทึกรายการค่าใช้จ่ายนะคะ\n\n${MEDIA_CLARIFY_REPLY['th']}`;
  }
  const notice = errorCode === 'OCR_FEATURE_DISABLED'
    ? 'บริษัทปิดการอ่านเอกสารด้วย AI ไว้ค่ะ ระบบยังเก็บไฟล์นี้ไว้ได้ แต่จะไม่อ่านข้อมูลให้อัตโนมัติ'
    : errorCode === 'OCR_REQUEST_ALREADY_ADMITTED'
      ? '✅ ระบบรับคำขออ่านเอกสารนี้ไว้แล้วค่ะ เพื่อป้องกันการนับซ้ำ จึงไม่ส่งอ่านซ้ำ'
      : readFailed
        ? '📷 น้องอ่านรูปนี้ไม่สำเร็จค่ะ ระบบอ่านเอกสารขัดข้องชั่วคราว รูปยังเก็บไว้ให้และยังไม่ได้บันทึกรายการนะคะ'
        : null;
  return notice ? `${notice}\n\n${MEDIA_CLARIFY_REPLY['th']}` : MEDIA_CLARIFY_REPLY['th'];
}
/** The outcome that same reply reports, for its card's heading: the picture is kept but was not read
 *  (no credit, reading switched off, a failed read), or the reply is the question alone. */
export function ocrGovernanceClarifyOutcome(errorCode?: string, readFailed = false): LineSentDocumentOutcome {
  return aiBudgetReasonTh(errorCode) || errorCode === 'OCR_FEATURE_DISABLED'
    || (readFailed && errorCode !== 'OCR_REQUEST_ALREADY_ADMITTED') ? 'unread' : 'question';
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
 * Spec §8: an intake route that never reached the model — the gateway call itself did not complete
 * (`ROUTER_UNREACHABLE`, tryRouteIntake's own catch block), the provider itself could not be reached
 * or failed (`PROVIDER_*`, including unknown failures whose HTTP status is logged by the provider),
 * or our AI budget gate could not run — reads to the customer as "the system is slow right
 * now", never "I don't understand you". A credit that is spent or too small for the call is answered
 * before this choice, by `answerAiCreditRefusal`. Invalid router output is also a system failure:
 * ask the customer to retry the same input, not to rephrase a valid request.
 */
const isTransientLineAiRouteFailure = (errorCode?: string): boolean =>
  errorCode === 'ROUTER_UNREACHABLE' || errorCode?.startsWith('PROVIDER_') === true
  || errorCode === 'ROUTER_SEMANTIC_SCHEMA_INVALID' || errorCode === 'ROUTER_JSON_PARSE_FAILED'
  || isAiBudgetRefusalCode(errorCode);
const LINE_AI_ROUTE_TRANSIENT_REPLY = 'ขอโทษค่ะ ระบบตอบช้ากว่าปกติ ลองส่งข้อความเดิมอีกครั้งได้เลยค่ะ';
const LINE_AI_ROUTE_UNCLEAR_REPLY = 'ขอโทษค่ะ น้องมั่งมียังไม่แน่ใจว่าหมายถึงอะไร ช่วยพิมพ์อีกแบบได้ไหมคะ เช่น "เดือนนี้จ่ายไปเท่าไหร่" หรือ "แยกค่าใช้จ่ายตามหมวด"';

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
  kind: 'save_failed' | 'open_question' | 'no_permission', language: 'th' | 'en' = 'th'
): string {
  if (language === 'en') { return kind === 'open_question' ? 'A previous photo is waiting for your answer; this photo has not been stored or recorded, so finish that question or use the web app.' : kind === 'save_failed' ? 'Document reading is unavailable and this photo could not be kept; no expense was created, so use the web app or resend it later.' : 'Document reading is unavailable; this photo was not read, stored or recorded as an expense.'; }

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
const TEXT_EXPENSE_CLARIFY_REPLY = { th: '🧾 ยังไม่สร้างรายการนะคะ กรุณาระบุยอดเงินและวัตถุประสงค์หรือหมวดค่าใช้จ่ายให้ครบ เช่น “ค่าเดินทาง 200 บาท”', en: "Is this a shop expense or a personal payment you want to claim back?" };
/** Field-specific clarifications (spec §8.2): a field the gate ALREADY accepted is never asked again —
 *  that re-ask is the UAT defect where an accepted `60` was demanded a second time. */
const TEXT_EXPENSE_AMOUNT_ONLY_REPLY = '🧾 รับรายการแล้วค่ะ ขอทราบยอดเงินด้วยนะคะ เช่น “60 บาท”';
const TEXT_EXPENSE_PURPOSE_ONLY_REPLY = '🧾 รับยอดเงินแล้วค่ะ ขอทราบรายการหรือวัตถุประสงค์ด้วยนะคะ เช่น “ค่าวินไปพบลูกค้า”';
const TEXT_EXPENSE_AMOUNT_CONFLICT_REPLY = '🧾 ยังไม่สร้างรายการนะคะ ตอนนี้มียอดเงินมากกว่าหนึ่งจำนวนในบทสนทนา ถ้าต้องการเปลี่ยนยอด พิมพ์ว่า “แก้ยอดเป็น … บาท” ได้เลยค่ะ';
/** Spec §11.2: the deterministic Nong Mangmee answer to an exact standalone greeting — zero model calls. */
const EXACT_GREETING_REPLY = 'สวัสดีค่ะ 😊 วันนี้มีอะไรให้น้องมั่งมีช่วยไหมคะ?';
/** Reimbursement semantic intake: canonical server copy persisted/ledgered for each outcome. The Flex cards
 *  own their own wording; these are the previews recorded before delivery. LINE never creates the record. */
const REIMBURSEMENT_PAYER_CLARIFY_REPLY = { th: 'รายการนี้ใครเป็นคนจ่ายคะ? ตอบกลับได้เลยว่า “เบิกคืน” หรือ “บริษัทจ่าย”', en: "Was this paid with shop funds or your own money?" };
const REIMBURSEMENT_CLARIFY_ONLY_REPLY = '🧾 เข้าใจว่าต้องการเบิกคืนค่าใช้จ่ายที่จ่ายส่วนตัวไปก่อนค่ะ\nน้องมั่งมียังไม่ได้สร้างรายการเบิกคืนให้ และการส่งต่อไปกรอกในเว็บยังไม่เปิดใช้งานในตอนนี้ค่ะ';
const REIMBURSEMENT_HANDOFF_REPLY = 'น้องมั่งมียังไม่ได้สร้างรายการเบิกคืนให้นะคะ กรุณาเปิดหน้าเว็บเพื่อตรวจสอบและกรอกรายละเอียดการเบิกคืนด้วยตนเอง ระบบจะสร้างรายการเมื่อกดบันทึกในเว็บเท่านั้นค่ะ';
const REIMBURSEMENT_HANDOFF_FORBIDDEN_REPLY = { th: '🔒 ยังไม่สามารถส่งต่อการเบิกคืนค่าใช้จ่ายผ่าน LINE สำหรับบริษัทนี้ได้ค่ะ', en: "You cannot create a claim; ask the shop owner or an authorized administrator." };
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
/** The words on the pending-file buttons, which are also what the customer's tap sends (no ids, ever). */
const MEDIA_REPLACE_COMMAND = 'ไฟล์ใหม่แทนเดิม';
const MEDIA_SUPPLEMENT_COMMAND = 'เก็บทั้งสองไฟล์';
const MEDIA_SELECT_COMMAND_PATTERN = /^เลือก(?:รูป|ไฟล์)ที่ ?([1-6])$/u;
const DOCUMENT_QA_CANCEL_COMMAND = 'ยกเลิกอ่านไฟล์';

const THAI_ORDINAL_WORDS: Readonly<Record<string, number>> = { หนึ่ง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6 };

/** "รูปแรก" / "ไฟล์ที่ 2" / "ภาพที่สอง" / "อันล่าสุด" → that file in arrival order; any other text → undefined. */
function pendingMediaByOrderWords<T>(text: string, ordered: readonly T[]): T | undefined {
  const match = /(?:รูป|ภาพ|ไฟล์|อัน)(?:(แรก|ล่าสุด|สุดท้าย)|ที่\s*([1-6]|หนึ่ง|สอง|สาม|สี่|ห้า|หก)(?![0-9]))/u.exec(text);
  if (!match || !ordered.length) return undefined;
  const index = match[1] === 'แรก' ? 0 : match[1] ? ordered.length - 1 : (Number(match[2]) || THAI_ORDINAL_WORDS[match[2]!]!) - 1;
  return ordered[index];
}

/** "รูปที่ 2" / "ไฟล์ที่ 1", optionally with its arrival time — how a pending file is named to the customer. */
function pendingMediaOrderLabel(row: { mimeType?: string | null; createdAt?: Date }, index: number, withTime = false, language: 'th' | 'en' = 'th'): string {
  if (language === 'en') { return `${row.mimeType?.startsWith('image/') ? 'Photo' : 'File'} ${index + 1}${withTime && row.createdAt ? ` (sent at ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }).format(row.createdAt)} Bangkok time)` : ''}`; }

  const label = `${row.mimeType?.startsWith('image/') ? 'รูป' : 'ไฟล์'}ที่ ${index + 1}`;
  return withTime && row.createdAt instanceof Date
    ? `${label} (ส่งเมื่อ ${new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }).format(row.createdAt)} น.)`
    : label;
}
/** A pending file clause is named by the customer's own words, never the router's internal goal (NAT06 2026-09-29:
 *  "Replace the previously sent file…" reached the chat in English). */
function documentQaAskedWords(job: { questionsJson?: unknown; questionText: string }): (item: { index: number; goal: string }) => string {
  const questions = job.questionsJson == null ? undefined : parseLineDocumentQaQuestions(job.questionsJson, job.questionText);
  return item => questions?.find(question => question.subrequestIndex === item.index)?.question ?? item.goal;
}
/** Stands in for the request when a picture arrives with no caption — the file IS the ask. */
const MEDIA_PENDING_REQUEST_TEXT = 'ไฟล์ที่ผู้ใช้ส่งมาโดยยังไม่ได้ระบุคำถาม';
const PENDING_MEDIA_RESOLUTION = Symbol('pendingMediaResolution');

/** Same chatKey the text path and the message buffer use: the group, else the person. */
function mediaChatKey(event: { lineUserId: string; pushTargetId?: string }): string {
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
function receiptClarifyQuestion(event: { lineUserId: string; pushTargetId?: string }, detectedMultiDocument = false): Record<string, unknown> {
  return { kind: 'RECEIPT_CLARIFY', chatKeyHash: chatKeyHashOf(event), ...(detectedMultiDocument ? { detectedMultiDocument: true } : {}) };
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
  /** Bounded recovery causes; safe to persist because they contain no document text. */
  fallbackReasons?: ReceiptOcrFallbackReason[];
  utilityDocuments?: ReceiptOcrResponse['utilityDocuments'];
  processingPath?: 'one_pass' | 'receipt_ocr';
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

/** Why a LINE photo still goes through the intake router; `null` sends it straight to the receipt
 *  reader (UAT 2026-09-29, Owner "ง + ค"). On every caption-less UAT photo that day the router only
 *  re-transcribed the page for 15–35 s and answered EXPENSE_DOCUMENT_CAPTURE, before the reader read the
 *  page again. The router stays wherever it decides something the reader cannot:
 *  1. `file` — not a photo: files keep their own lanes;
 *  2. `caption` — the sender's words need routing (a question, a correction, a document question);
 *  3. `no_capture_permission` — without expense capture, a signature or reference route is all this
 *     sender can use, and only the router tells those apart;
 *  4. `substitute_work_open` — this chat has open substitute-receipt work: a requested signature, an
 *     awaited signed scan, a check-bill's final receipt or the issue decision (`loadOpenMediaContext`).
 *  Checked in this order, so the substitute lookup runs only for a caption-less photo it could change. */
export async function lineIntakeRouterReason(input: {
  messageType: 'image' | 'file';
  caption: string;
  canCaptureExpense: boolean;
  substituteWorkOpen: () => Promise<boolean>;
}): Promise<'file' | 'caption' | 'no_capture_permission' | 'substitute_work_open' | null> {
  if (input.messageType !== 'image') return 'file';
  if (input.caption.trim()) return 'caption';
  if (!input.canCaptureExpense) return 'no_capture_permission';
  if (await input.substituteWorkOpen()) return 'substitute_work_open';
  return null;
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
  if (isExpenseExtractionEligible(ocr.classification, ocr.fields?.grandTotalAmount, ocr.classification.documentKind === 'TRANSFER_SLIP')) {
    return { outcome: 'expense', manualReview: false, classification: ocr.classification };
  }
  if (ocr.classification.requiresClarification || ocr.classification.contentKind !== 'DOCUMENT') {
    return { outcome: 'clarify', persistMedia: false, classification: ocr.classification };
  }
  return { outcome: 'reference', classification: ocr.classification };
}

/**
 * What `formatBusinessDocumentReply` reports about the same classification, for its card's heading.
 * "Not a document of an expense" is said only where the reader found exactly that and nothing was
 * kept: a picture that is no business document, an appointment or booking, and a parcel label, a
 * deposit slip, a quotation, an order or a delivery note that was NOT kept as a draft. Kept as a
 * draft, or any other read (an invoice, a slip, a check bill, a kind nobody is sure of), it is the
 * result of the read — §18.4: those are successful reads and never borrow the failure wording.
 */
export function businessDocumentOutcome(classification: BusinessDocumentClassification | null, keptAsDraft = false): LineSentDocumentOutcome {
  if (!classification) return 'question';
  if (classification.contentKind === 'MULTI_DOCUMENT') return 'notTaken';
  if (classification.contentKind === 'UNREADABLE') return 'unread';
  const nr = classifyNonReceiptCase(classification);
  if (nr === 'NR07') return 'notExpense';
  if (nr === 'NR01' || nr === 'NR02' || nr === 'NR03') return keptAsDraft ? 'result' : 'notExpense';
  if (nr) return 'result';
  return ['APPOINTMENT_CARD', 'BOOKING_CONFIRMATION', 'RESERVATION_CONFIRMATION'].includes(classification.documentKind) ? 'notExpense' : 'result';
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
  options: { captureLink?: string; amountLabel?: string } = {}, language: 'th' | 'en' = 'th'
): string {
  if (language === 'en') { if (!classification) return MEDIA_CLARIFY_REPLY.en;
if (classification.contentKind === 'MULTI_DOCUMENT') return 'This image contains several documents; please send each separately to avoid combining their amounts.';
if (classification.contentKind === 'UNREADABLE') return 'Please send a clear photo of the whole document without blur or glare.';
if (options.captureLink) return `The document is kept as a draft for review: ${options.captureLink}`;
return 'This document is not yet verified as expense evidence; please send the final receipt or explain its business purpose before recording it.'; }

  if (!classification) return MEDIA_CLARIFY_REPLY['th'];
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

function formatCheckBillDecisionReply(language: 'th' | 'en' = 'th'): string {
  if (language === 'en') { return 'This bill shows an amount due, without proof of payment; no expense has been created yet, so choose its payment status below.'; }

  return [
    '🧾 รูปนี้ยังไม่ใช่ใบเสร็จค่ะ',
    'ใบนี้บอกยอดที่ต้องจ่าย แต่ยังไม่ยืนยันว่าร้านรับเงินแล้ว',
    'ตอนนี้ยังไม่สร้างรายการค่าใช้จ่ายนะคะ',
    '',
    CHECK_BILL_PAYMENT_QUESTION,
  ].join('\n');
}

export function buildCheckBillDecisionQuickReply(language: 'th' | 'en' = 'th'): NonNullable<LineReplyMessage['quickReply']> {
  if (language === 'en') { return { items: [{ type: 'action', action: { type: 'message', label: 'Paid, no receipt', text: '1' } }, { type: 'action', action: { type: 'message', label: 'Not paid yet', text: '2' } }, { type: 'action', action: { type: 'message', label: 'Have final receipt', text: '3' } }] }; }

  return {
    items: [
      { type: 'action', action: { type: 'message', label: 'จ่ายแล้ว ไม่ได้ใบ', text: 'จ่ายแล้ว แต่ไม่มีใบเสร็จ' } },
      { type: 'action', action: { type: 'message', label: 'ยังไม่ได้จ่าย', text: 'ยังไม่ได้จ่าย' } },
      { type: 'action', action: { type: 'message', label: 'มีใบเสร็จ ส่งใหม่', text: 'มีใบเสร็จแล้ว จะส่งรูปใหม่' } },
    ],
  };
}

function buildCheckBillReceiptUploadQuickReply(language: 'th' | 'en' = 'th'): NonNullable<LineReplyMessage['quickReply']> {
  if (language === 'en') { return { items: [{ type: 'action', action: { type: 'cameraRoll', label: 'Choose receipt photo' } }, { type: 'action', action: { type: 'camera', label: 'Take receipt photo' } }] }; }

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
  charges: readonly ExpenseChargeSummary[] = [], language: 'th' | 'en' = 'th'
): string {
  if (language === 'en') { return ['One expense draft was created; the original bill is retained as evidence without creating a duplicate.', continuation.replyText, ...chargeSummaryLines(charges, 'en')].filter(Boolean).join('\n\n'); }

  const chargeBlock = chargeSummaryLines(charges, language);
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
  steerToPendingDecision = false, language: 'th' | 'en' = 'th'
): string {
  if (language === 'en') { return [ 'Your signature photo was saved as your reusable signature and is available immediately.', ...(steerToPendingDecision ? ['Select Prepare document to continue with signing on the web.'] : []), `View signature: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/signatures?signatureId=${signatureId}`)}` ].join('\n'); }

  const link = absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/signatures?signatureId=${signatureId}`);
  return [
    '✍️ รับรูปลายเซ็นแล้ว และบันทึกเป็นลายเซ็นประจำตัวให้แล้ว',
    'สถานะ: ใช้ลงนามเอกสารได้ทันที ไม่ต้องรออนุมัติ',
    ...(steerToPendingDecision ? ['', 'กดเตรียมใบรับรอง แล้วน้องจะส่งลิงก์ลงนามในเว็บค่ะ'] : []),
    '',
    `เปิดดูลายเซ็น:\n${link}`,
  ].join('\n');
}

type LineCompanyMembership = {
  companyId: string;
  company?: {
    name: string;
    brandName?: string | null;
    status?: string;
    planTerm?: { termStartAt: Date; termEndsAt: Date; renewCount: number; termDisabledAt?: Date | null } | null;
  } | null;
  roles?: Array<{ role?: { key: string; name?: string; status?: string; permissions?: Array<{ permission: { key: string } }> } | null }>;
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
export function formatTextExpenseClarifyReply(error: LineTextExpenseCaptureIncompleteError, language: 'th' | 'en' = 'th'): string {
  if (language === 'en') return error.conflictingFields.includes('amount') ? LEGACY_LINE_COPY_EN.TEXT_EXPENSE_AMOUNT_CONFLICT_REPLY : error.missingFields.includes('amount') ? LEGACY_LINE_COPY_EN.TEXT_EXPENSE_AMOUNT_ONLY_REPLY : LEGACY_LINE_COPY_EN.TEXT_EXPENSE_PURPOSE_ONLY_REPLY;
  if (error.conflictingFields.includes('amount')) return TEXT_EXPENSE_AMOUNT_CONFLICT_REPLY;
  const needsAmount = error.missingFields.includes('amount');
  const needsPurpose = error.missingFields.includes('description') || error.missingFields.includes('purpose');
  if (needsAmount && !needsPurpose) return TEXT_EXPENSE_AMOUNT_ONLY_REPLY;
  if (needsPurpose && !needsAmount) return TEXT_EXPENSE_PURPOSE_ONLY_REPLY;
  return TEXT_EXPENSE_CLARIFY_REPLY['th'];
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

const READ_MEMORY_SHOWN_ITEM_KEYS = new Set(['ordinal', 'id', 'label', 'date', 'kind']);
function validLineAiReadMemoryShownItem(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item['ordinal'] === 'number' && Number.isSafeInteger(item['ordinal']) && item['ordinal'] >= 1
    && typeof item['id'] === 'string' && item['id'].length > 0 && item['id'].length <= 200
    && typeof item['label'] === 'string' && item['label'].length > 0 && item['label'].length <= 200
    && (item['date'] === undefined || typeof item['date'] === 'string')
    && (item['kind'] === undefined || item['kind'] === 'category' || item['kind'] === 'branch' || item['kind'] === 'vendor')
    && Object.keys(item).every(key => READ_MEMORY_SHOWN_ITEM_KEYS.has(key));
}

const READ_MEMORY_STRING_FIELDS = ['documentStatus', 'paymentStatus', 'categoryId', 'categoryName', 'vendorId', 'vendorName', 'branchId', 'branchName'] as const;
const READ_MEMORY_ENTRY_KEYS = new Set(['tool', 'period', ...READ_MEMORY_STRING_FIELDS, 'groupBy', 'answerShape', 'shownItems', 'asOf']);

/** Spec §4 R-M2: defense in depth on `readMemory` this same service wrote into `lineTurnOutcome` — a
 *  malformed entry, or one carrying any field outside LineAiReadMemory's own known list (an `amount`
 *  would already fail here, R-M6), drops the WHOLE stored batch for that turn rather than admit a
 *  half-trusted one into the model's prompt. */
export function validLineAiReadMemoryEntries(raw: readonly unknown[]): LineAiReadMemory[] | undefined {
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const entry = value as Record<string, unknown>;
    if (typeof entry['tool'] !== 'string' || !entry['tool']
      || (entry['answerShape'] !== 'single_metric' && entry['answerShape'] !== 'list')
      || typeof entry['asOf'] !== 'string' || !Number.isFinite(Date.parse(entry['asOf']))) return undefined;
    const period = entry['period'];
    if (period !== undefined && (!period || typeof period !== 'object' || Array.isArray(period)
      || typeof (period as Record<string, unknown>)['fromDate'] !== 'string' || typeof (period as Record<string, unknown>)['toDate'] !== 'string')) return undefined;
    if (READ_MEMORY_STRING_FIELDS.some(key => entry[key] !== undefined && typeof entry[key] !== 'string')) return undefined;
    if (entry['groupBy'] !== undefined && entry['groupBy'] !== 'category' && entry['groupBy'] !== 'branch' && entry['groupBy'] !== 'vendor') return undefined;
    const shownItems = entry['shownItems'];
    if (shownItems !== undefined && (!Array.isArray(shownItems) || shownItems.length > 10 || !shownItems.every(validLineAiReadMemoryShownItem))) return undefined;
    if (!Object.keys(entry).every(key => READ_MEMORY_ENTRY_KEYS.has(key))) return undefined;
  }
  return raw as LineAiReadMemory[];
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

export function formatLineReply(response: LineAiTurnResponse, webBaseUrl: string | undefined, language: 'th' | 'en' = lineReplyLanguage(response.replyText)): string {
  const lines = [response.replyText];
  if (response.sourceLabels.length > 0) {
    // Same Thai label the Flex answer cards use, so the plain-text fallback reads consistently.
    lines.push(`${language === 'en' ? 'Sources' : 'แหล่งข้อมูล'}: ${response.sourceLabels.slice(0, 5).map(label => lineSourceLabel(label, response.sourceRefs.find(ref => ref.label === label)?.module, language)).join(', ')}`);
  }
  const firstLink = response.webLinks[0];
  if (firstLink) {
    const url = absoluteWebLink(webBaseUrl, firstLink.path);
    // `absoluteWebLink` returns the path unchanged when no base URL is configured, and a bare
    // "/companies/…" in a LINE message is not a link — it is a string nobody can open. Say the
    // words instead; the reply is still true, it just stops pretending to be actionable.
    const label = lineSourceLabel(firstLink.label, response.sourceRefs.find(ref => ref.webPath === firstLink.path)?.module, language);
    lines.push(/^https?:\/\//i.test(url) ? `${language === 'en' ? 'View' : 'เปิดดู'}: ${label} ${url}` : `${language === 'en' ? 'Open MangmeePlus' : 'เปิดเว็บมั่งมีพลัส'}: ${label}`);
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
/** NAT04/NAT12 (2026-09-29): the two answers a person types to the one unconfirmed piece of work this chat
 *  holds (an expense-edit preview or a reimbursement draft) — drop it, or look at it again without saving.
 *  Production answers open work with its own matchers before routing (RECEIPT-05); without this the cancel went
 *  to a general answer that said "ยกเลิกแล้ว" while the preview and its task stayed open. Anything else, or any
 *  number in the text (a new value), is an ordinary turn. */
export function pendingWorkReply(text: string): 'cancel' | 'review' | null {
  const t = normalizeLineText(text).trim();
  if (!t || t.length > 80 || /[0-9๐-๙]/u.test(t) || /(?:ไม่|อย่า)ยกเลิก/u.test(t)) return null;
  if (/ยกเลิก|ไม่เอาแล้ว|ไม่ต้องแล้ว|ไม่ทำแล้ว|\bcancel\b/iu.test(t)) return 'cancel';
  if (/(?:ยังไม่ต้อง|อย่าเพิ่ง|ยังไม่|ไม่ต้อง)(?:บันทึก|ยืนยัน|เซฟ|save)/iu.test(t)) return 'review';
  return null;
}

export function classifyPendingMediaReply(text: string): 'receipt' | 'illustration' | 'multiple' | 'ambiguous' {
  const t = (text ?? '').toLowerCase().trim();
  if (/^(?:record receipt|record expense|use this as expense evidence)$/u.test(t)) return 'receipt';
  if (/^(?:question only(?:; do not record)?|illustration)$/u.test(t)) return 'illustration';
  if (/^(?:summarize )?several documents$/u.test(t)) return 'multiple';
  // The question is numbered, so a lone choice is unambiguous. Anchored to the whole reply on
  // purpose: a bare '1' is an answer, but '1500' or 'จ่ายไป 2 ใบ' is not.
  const numbered = /^(?:(?:อัน|ข้อ|ตัว)?\s*(?:ที่)?\s*)?([123])[.)]?$/.exec(t);
  if (numbered) return numbered[1] === '1' ? 'receipt' : numbered[1] === '2' ? 'illustration' : 'multiple';
  // ponytail: a choice plus a short expense label is still choice 1; amounts are not.
  if (/^1[.)]?\s+ค่า[ก-๙]+$/u.test(t)) return 'receipt';
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

function companyLabel(membership: LineCompanyMembership, language: 'th' | 'en' = 'th'): string {
  return membership.company?.brandName ?? membership.company?.name ?? (language === 'en' ? 'Unnamed shop' : 'ไม่ระบุบริษัท');
}

/** R-C8: the same wording as LIFF (R-C2) for a locked shop in the picker and the context card. */
function companyStateLabel(membership: LineCompanyMembership, now = new Date()): string | undefined {
  const term = membership.company?.planTerm;
  const locked = (membership.company?.status === 'DISABLED' && !!term?.termDisabledAt)
    || (membership.company?.status === 'ACTIVE' && !!term && term.termEndsAt <= now);
  if (!locked) return undefined;
  return term && planTermLockReason(term) === 'no_package' ? 'ยังไม่มีแพ็กเกจ' : 'หมดอายุ';
}

/** One picker row; the lock label only on a locked shop, so an ACTIVE row keeps its exact bytes. */
function companyPickerItem(membership: LineCompanyMembership, language: 'th' | 'en' = 'th'): CompanyPickerItem {
  const stateLabel = companyStateLabel(membership);
  return { companyId: membership.companyId, companyName: companyLabel(membership, language), ...(stateLabel ? { stateLabel: lineUiLabel(stateLabel, language) } : {}) };
}

/** Where บริษัทของฉัน's web button lands: a locked shop's plan manager goes straight to the package
 *  page (the dashboard would only bounce to /renew); everyone else keeps the dashboard. */
function companyWebPath(membership: LineCompanyMembership): string {
  return companyStateLabel(membership) && canManagePlan(membership.roles)
    ? `/companies/${membership.companyId}/billing?channel=line`
    : `/companies/${membership.companyId}/dashboard`;
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
 * (`access.roles.includes('OWNER')`), and it is scoped to the ONE membership the card is about —
 * being an owner elsewhere does not make this an owner's view of this company. Opening another
 * shop stays an OWNER action; who may manage a PACKAGE is `canManagePlan` (R-C11), not this.
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
  ...SOURCE_DOCUMENT_TYPE_LABELS,
  RECEIPT: 'ใบเสร็จรับเงิน',
  CUSTOMS_VAT_RECEIPT: 'ใบเสร็จรับเงินกรมศุลกากร (VAT นำเข้า)',
  PP36_RECEIPT: 'ใบเสร็จรับเงิน ภ.พ.36',
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

function receiptDeniedReply(access: { permissions: string[]; entitlementDeniedPermissions?: Record<string, string> }, language: 'th' | 'en' = 'th'): string {
  return receiptFeatureDisabled(access)
    ? EXPENSE_FEATURE_DISABLED_REPLY[language]
    : RECEIPT_FORBIDDEN_REPLY[language];
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
function chargeSummaryLines(charges: readonly ExpenseChargeSummary[], language: 'th' | 'en' = 'th'): string[] {
  if (language === 'en') { return charges.map(charge => `• ${({ SERVICE_CHARGE: 'Service charge', SHIPPING: 'Shipping', ROUNDING: 'Rounding', OTHER: 'Other charge' } as Record<string, string>)[charge.kind] ?? 'Additional charge'}: ${moneyLabel(charge.amount)} THB`); }

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
    return 'ยังไม่มีวันที่';
  }
  if (status === 'implausible') return `${printed} (ผิดปกติ ตรวจในเว็บ)`;
  if (status === 'assumed') return `${printed} (อ่านจากบิล แบบ วัน/เดือน)`;
  return printed;
}

/** Same user-facing date shape as the web app, e.g. 25 ก.ค. 2569. */
const THAI_DATE_REPLY_FORMATTER = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
});
function formatReplyDate(value: string | undefined, language: 'th' | 'en' = 'th'): string | undefined {
  if (language === 'en') return value ? lineDisplayDate(value, language) : undefined;
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : THAI_DATE_REPLY_FORMATTER.format(date);
}

type PaypersReplyOptions = { language?: 'th' | 'en'; acceptedAmounts?: ReceiptOcrApplyOutcome['acceptedAmounts']; hasDuplicate?: boolean; textOnly?: boolean; compact?: boolean; amount?: string | null; fields?: ReceiptOcrFieldResult | null; charges?: readonly ExpenseChargeSummary[]; chargeReconciliation?: { status: string; chargesApplied: number }; categoryName?: string | null; sourceDocumentType?: string | null; questionText?: string; dateStatus?: ExpenseDocumentDateStatus; askVendorAddress?: boolean };

/** ONE reading of what the capture grounded, for the reply text and for the review card alike: a
 *  figure that is `undefined` here was not grounded, and neither of them may state it. */
function paypersReplyFacts(options: PaypersReplyOptions) {
  const en = options.language === 'en';
  const money = (value: string) => Number(toMoney4(value)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const amountValue = options.acceptedAmounts?.grandTotalAmount ?? options.fields?.grandTotalAmount ?? options.amount;
  const vatValue = options.acceptedAmounts?.vatAmount ?? options.fields?.vatAmount;
  const vatMode = options.acceptedAmounts?.vatMode ?? options.fields?.vatMode;
  const whtValue = options.acceptedAmounts?.whtAmount ?? options.fields?.whtAmount;
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
  const foldedTotal = additionalTotal === 0 && charges.length === 0
    ? folded.filter((charge) => charge.kind !== 'ROUNDING').reduce((sum, charge) => sum + Number(toMoney4(charge.amount)), 0)
    : 0;
  const itemLines = options.questionText && isReceiptItemQuestion(options.questionText) ? receiptItemLines(options.fields, charges) : undefined;
  // The total printed is the DOCUMENT's own figure and nothing converted it, so a non-baht
  // document must say so (UAT 2026-08-29: $200.00 USD was recorded as 200 บาท).
  const foreignCurrency = options.fields?.currency && options.fields.currency !== 'THB' ? options.fields.currency : undefined;
  return {
    amount: amountValue && Number(toMoney4(amountValue)) > 0 ? money(amountValue) : undefined,
    docType: options.sourceDocumentType ? lineUiLabel(SOURCE_DOC_TYPE_REPLY_LABELS[options.sourceDocumentType] ?? '', options.language ?? 'th') : undefined,
    vat: vatMode !== 'NO_VAT' && vatMode !== 'EXEMPT' && vatValue && Number(toMoney4(vatValue)) > 0 ? money(vatValue) : undefined,
    wht: whtValue && Number(toMoney4(whtValue)) > 0 ? money(whtValue) : undefined,
    otherCharges: additionalTotal !== 0 ? `${money(String(additionalTotal))} ${en ? 'THB' : 'บาท'}`
      : foldedTotal !== 0 ? en ? `${money(String(foldedTotal))} THB (included in the total; review on web)` : `${money(String(foldedTotal))} บาท (รวมอยู่ในยอดเดียว รอตรวจสอบในเว็บ)` : undefined,
    dateLine: en ? options.fields?.expenseDate && options.dateStatus !== 'unverified' ? lineDisplayDate(options.fields.expenseDate, 'en') : 'Awaiting date review' : receiptCardDateLine(options.fields?.expenseDate, options.dateStatus ?? (options.fields?.expenseDate ? 'verified' : 'unverified')),
    itemBlock: itemLines && ['🛒 รายการที่อ่านได้จากบิล:', ...(itemLines.length > 0
      ? itemLines
      : ['• ยังอ่านรายการสินค้าจากหลักฐานนี้ไม่ได้ชัดเจนค่ะ'])],
    textOnlyNote: options.textOnly ? en ? 'No attachment; attach the required photo or PDF on the web before confirming.' : '📎 ยังไม่มีไฟล์แนบ – กรุณาแนบรูป/PDF ในเว็บก่อนยืนยันถ้าต้องใช้หลักฐาน' : undefined,
    duplicateNote: options.hasDuplicate ? en ? 'This file may duplicate an existing expense; review before confirming.' : '⚠️ พบไฟล์ที่อาจซ้ำกับรายการที่มีอยู่ – กรุณาตรวจสอบก่อนยืนยัน' : undefined,
    // Vendor-address §11.3: the one question this card may ask, and only when the draft conversation
    // has an unretired ask on it — so a full tax invoice whose address could not be read is asked
    // exactly once, and every other document (and every later card) says nothing about addresses.
    addressAsk: options.askVendorAddress ? en ? 'What is the seller’s address as printed on the tax invoice?' : LINE_VENDOR_ADDRESS_PROMPT : undefined,
    foreignCurrency,
    currencyNote: foreignCurrency
      ? en ? `This document uses ${foreignCurrency}; review and convert its amounts to THB before saving.` : `⚠️ เอกสารนี้เป็นสกุลเงิน ${foreignCurrency} – ยอดที่อ่านได้อาจไม่ใช่จำนวนเงินบาท กรุณาตรวจและแก้ยอดเป็นเงินบาทก่อนบันทึก` : undefined,
  };
}

export function formatPaypersReply(
  webBaseUrl: string | undefined,
  companyId: string,
  expenseId: string,
  options: PaypersReplyOptions = {},
): string {
  const link = absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`);
  const facts = paypersReplyFacts(options);
  const amount = facts.amount ?? 'ยังไม่ระบุ';
  const docType = facts.docType;
  if (options.language === 'en') {
    return ['Expense draft saved, awaiting review and your confirmation.',
      ...(options.fields?.vendorName ? [`Seller: ${options.fields.vendorName}`] : []),
      `Total: ${facts.amount ? `${facts.amount} ${facts.foreignCurrency ?? 'THB'}` : 'Not yet read'}`,
      `Date: ${facts.dateLine}`, ...(facts.docType ? [`Document: ${facts.docType}`] : []),
      ...(options.categoryName ? [`Category: ${options.categoryName}`] : []),
      ...(facts.vat ? [`VAT: ${facts.vat} THB`] : []), ...(facts.wht ? [`Withholding tax: ${facts.wht} THB`] : []),
      ...(facts.otherCharges ? [`Other charges: ${facts.otherCharges}`] : []),
      facts.textOnlyNote, facts.duplicateNote, facts.addressAsk, facts.currencyNote, `Review expense: ${link}`].filter(Boolean).join('\n');
  }
  const parts = options.compact ? [
    '🧾 เก็บรูปและร่างแล้วค่ะ',
    ...(docType && options.sourceDocumentType !== 'RECEIPT' ? [`เอกสาร: ${docType}`] : []),
    ...(options.fields?.vendorName ? [`ร้าน: ${options.fields.vendorName}`] : []),
    `ยอดในใบเสร็จ: ${amount === 'ยังไม่ระบุ' ? 'ยังอ่านยอดไม่ได้' : `${amount}${options.fields?.currency && options.fields.currency !== 'THB' ? ` ${options.fields.currency}` : ' บาท'}`}`,
    `วันที่: ${!options.fields?.expenseDate ? 'ยังไม่มีวันที่' : options.dateStatus === 'unverified' ? 'ยังรอตรวจสอบ' : receiptCardDateLine(options.fields.expenseDate, options.dateStatus ?? 'verified')}`,
    'ยังไม่ยืนยันรายการ',
  ] : [
    '🧾 บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว (รอตรวจสอบ)',
    '',
    '📋 ข้อมูลที่อ่านได้ตอนนี้:',
    `• ผู้ขาย/ผู้รับเงิน – ${options.fields?.vendorName ?? 'ยังไม่ระบุ'}`,
    `• ยอดรวม – ${amount}`,
    `• ประเภทเอกสาร – ${docType ?? 'รอตรวจสอบ'}`,
    `• วันที่เอกสาร – ${facts.dateLine}`,
    `• หมวดหมู่ค่าใช้จ่าย – ${options.categoryName ?? 'ยังไม่ระบุ'}`,
    ...(facts.vat ? [`• VAT – ${facts.vat} บาท`] : []),
    ...(facts.wht ? [`• WHT – ${facts.wht} บาท`] : []),
  ];
  if (facts.otherCharges) parts.push(`• ค่าบริการอื่นๆ – ${facts.otherCharges}`);
  if (facts.itemBlock) parts.push('', ...facts.itemBlock);
  if (facts.textOnlyNote) parts.push('', facts.textOnlyNote);
  if (facts.duplicateNote) parts.push('', facts.duplicateNote);
  if (facts.addressAsk) parts.push('', facts.addressAsk);
  // THB and an unread currency push nothing and keep this reply byte-identical.
  if (facts.currencyNote) parts.push('', facts.currencyNote);
  parts.push('', `${options.compact ? 'เปิดดูรายการ' : '✅ ตรวจสอบและยืนยันในเว็บแอป'}:\n${link}`);
  return parts.join('\n');
}

/** The §10.1 review card states the SAME grounded values `formatPaypersReply` prints, read once by
 *  `paypersReplyFacts`, in the locked design's order. A value the capture did not ground is OMITTED —
 *  the card leaves the row out rather than repeating the text reply's 'ยังไม่ระบุ' placeholder as if it
 *  were a fact — and everything else the reply says below its facts is a note, word for word.
 *  `lead` and `tail` are what a caller put in front of the reply and after it; they are its first and last notes. */
function expenseDraftCardFacts(
  expenseId: string,
  options: PaypersReplyOptions & { status?: string | null; item?: string | null; lead?: string; tail?: string } = {},
): LineExpenseDraftCardFacts {
  const facts = paypersReplyFacts(options);
  return expenseDraftCardFactsFrom({
    expenseId,
    subject: expenseDraftCardSubject(options.sourceDocumentType, options.textOnly),
    vendor: options.fields?.vendorName,
    item: options.item,
    date: facts.dateLine,
    documentNumber: scrubRecordIdentifier(options.fields?.documentNumber ?? null, 40),
    documentType: facts.docType,
    category: options.categoryName,
    total: facts.amount && `${facts.amount} ${facts.foreignCurrency ?? (options.language === 'en' ? 'THB' : 'บาท')}`,
    vat: facts.vat && `${facts.vat} ${options.language === 'en' ? 'THB' : 'บาท'}`,
    withholdingTax: facts.wht && `${facts.wht} ${options.language === 'en' ? 'THB' : 'บาท'}`,
    otherCharges: facts.otherCharges,
    status: (EXPENSE_STATUS_LABELS as Record<string, string>)[options.status ?? ''] ?? EXPENSE_STATUS_LABELS.NEEDS_REVIEW,
    notesBefore: [options.lead],
    notesAfter: [options.language === 'en' ? undefined : facts.itemBlock?.join('\n'), facts.textOnlyNote, facts.duplicateNote, facts.addressAsk, facts.currencyNote, options.tail],
  });
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
  questionText = '', language: 'th' | 'en' = 'th'
): string {
  if (language === 'en') { const fields = receiptSummaryFields(expense);
return [ 'Details from the latest expense in this chat:', `Seller: ${fields.vendorName ?? expense.vendorNameSnapshot ?? 'Not specified'}`, `Document date: ${fields.expenseDate ? lineDisplayDate(fields.expenseDate, language) : 'Not verified'}`, `Document number: ${fields.documentNumber ?? 'Not verified'}`, `Amount read: ${fields.grandTotalAmount ?? 'Not verified'}`, `Current amount: ${moneyLabel(expense.grandTotalAmount)} ${expense.currency}`, `Category: ${categoryName ?? 'Not specified'}`, 'Review the source evidence and business purpose on the web before confirmation; a substitute receipt is not a tax invoice.', `View expense: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expense.id}`)}` ].join('\n'); }

  const fields = receiptSummaryFields(expense);
  const missing = expense.aiVerificationSummaryJson?.['missingFields'];
  const missingFields = Array.isArray(missing) ? missing.filter((item): item is string => typeof item === 'string').slice(0, 10) : [];
  const sourceType = SOURCE_DOC_TYPE_REPLY_LABELS[expense.sourceDocumentType] ?? 'เอกสารค่าใช้จ่าย';
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
    `• วันที่พิมพ์บนเอกสาร – ${formatReplyDate(fields.expenseDate, language) ?? 'ยังอ่านยืนยันไม่ได้'}`,
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
    `• หมวดค่าใช้จ่าย – ${categoryName ?? 'ยังไม่ระบุ'}`,
    `• สถานะหลักฐานภาษี – ${expense.taxEvidenceStatus}`,
    ...(missingFields.length ? ['', `ยังต้องตรวจ: ${missingFields.join(', ')}`] : []),
    '',
    'การนำไปเป็นค่าใช้จ่ายบริษัท: ระบุวัตถุประสงค์/หมวด ตรวจยอดและหลักฐาน แล้วให้ผู้มีสิทธิ์ยืนยันในเว็บ',
    'ข้อมูลบนใบเสร็จเพียงอย่างเดียวไม่ยืนยันนโยบายบริษัทหรือสิทธิเครดิต VAT; ใบรับรองแทนใบเสร็จภายในก็ไม่ใช่ใบกำกับภาษี',
    `เปิดตรวจสอบรายการ: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expense.id}`)}`,
  ].join('\n');
}

function correctionCandidateLabel(candidate: LineIntakeCorrectionCandidate, language: 'th' | 'en'): string {
  if (language !== 'en' || !candidate.sourceDocumentType) return candidate.label;
  return [lineUiLabel(SOURCE_DOC_TYPE_REPLY_LABELS[candidate.sourceDocumentType] ?? 'เอกสารค่าใช้จ่าย', language),
    formatReplyDate(candidate.expenseDate, language), candidate.amount].filter(Boolean).join(' · ');
}

/** GAP C tier 2: “ต้องทำยังไงต่อ” with no substitute document in flight, but with an expense this
 *  chat captured. Names the three things that actually exist for THAT record — evidence, review,
 *  ใบรับรองแทนใบเสร็จรับเงิน — instead of the model's “ส่วนนี้ยังไม่พร้อมใช้งานผ่าน LINE”. Each option
 *  is a route the sender can take from this chat, and the substitute one prints the exact words the
 *  deterministic vocabulary listens for. */
export function formatNextStepGuidanceReply(
  webBaseUrl: string | undefined,
  companyId: string,
  candidate: LineIntakeCorrectionCandidate, language: 'th' | 'en' = 'th'
): string {
  if (language === 'en') { return [ `The latest expense, ${correctionCandidateLabel(candidate, language)}, needs review.`, 'Send supporting evidence here, review the expense on the web, or ask to prepare a substitute receipt if no receipt is available.', 'No approval, payment or final accounting entry was performed in LINE.', `View expense: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${candidate.id}`)}` ].join('\n'); }

  return [
    '🧭 รายการล่าสุดที่บันทึกไว้ในแชทนี้ยังรอตรวจสอบอยู่ค่ะ',
    '',
    `รายการ: ${candidate.label}`,
    '',
    'ทำต่อได้ 3 ทางค่ะ',
    '• ส่งรูปใบเสร็จ/สลิปเข้าแชทนี้ หรือแนบไฟล์ในเว็บ เพื่อเก็บเป็นหลักฐาน',
    '• เปิดในเว็บเพื่อตรวจยอด หมวดค่าใช้จ่าย แล้วให้ผู้มีสิทธิ์ยืนยัน',
    '• ถ้าไม่มีใบเสร็จ พิมพ์ “ทำใบรับรองแทนใบเสร็จ” เพื่อจัดทำใบรับรองแทนใบเสร็จรับเงินให้รายการนี้',
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
  reason?: string, language: 'th' | 'en' = 'th'
): string {
  if (language === 'en') { const action = canEdit ? 'Edit on web' : 'Open on web for an authorized reviewer';
return [ reason === 'empty_note' ? 'No note text was found, so nothing was saved.' : candidates.length ? 'Edit the existing expense; no new expense was created.' : 'No recent editable expense was found in this chat.', ...candidates.map(candidate => `• ${correctionCandidateLabel(candidate, language)}`), `${action}: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses${candidates.length === 1 ? `/${candidates[0]!.id}` : ''}`)}` ].join('\n'); }

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
const CORRECTION_DIRECTION_CLARIFY_REPLY = { th: '🤔 ข้อความมีทั้งค่าเดิมและค่าใหม่ กรุณาระบุให้ชัดว่าต้องการแก้เป็นค่าใดนะคะ (เช่น "แก้เป็น 590")', en: "Please specify the new value you want to use." };

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
  noteOutcome?: 'truncated' | 'duplicate', language: 'th' | 'en' = 'th'
): string {
  if (language === 'en') { const labels: Record<string, string> = { note: 'Note', documentNumber: 'Document number', expenseDate: 'Expense date', vendorName: 'Seller', grandTotalAmount: 'Total' };
return [Object.keys(fields).every(field => field === 'note') ? 'The note was retained; expense amounts were not changed.' : 'The existing expense was updated without creating a new one.', ...Object.entries(fields).map(([field, change]) => `• ${labels[field] ?? 'Detail'}: ${field === 'expenseDate' ? lineDisplayDate(change.to, language) : change.to}${field === 'note' && noteOutcome === 'duplicate' ? ' (already present)' : field === 'note' && noteOutcome === 'truncated' ? ' (partly saved; note limit reached)' : ''}`), `View expense: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`)}`].join('\n'); }

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
    const from = field === 'expenseDate' ? formatReplyDate(change.from ?? undefined, language) : change.from;
    const to = field === 'expenseDate' ? formatReplyDate(change.to, language) : change.to;
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
    where: {
      userId,
      status: 'ACTIVE',
      company: {
        status: 'ACTIVE',
        // S05: the sweep flips an ended term to DISABLED every ~5 minutes, and for those minutes a
        // shop that has not paid used to get full assistant turns. A company with no term row at
        // all is the grandfathered "unlimited" case and stays resolvable, exactly as before.
        OR: [{ planTerm: null }, { planTerm: { termEndsAt: { gt: new Date() } } }],
      },
    },
    select: { companyId: true, roles: { select: { role: { select: { key: true } } } } },
    orderBy: { createdAt: 'asc' },
  });

  const freeCandidates = await prisma.client.companyMembership.findMany({
    where: { userId, status: 'ACTIVE', company: {
      status: { in: ['ACTIVE', 'DISABLED'] },
      planTerm: { tierKey: 'FREE_TRIAL_15', termEndsAt: { lte: new Date() } },
    } },
    select: { companyId: true, roles: { select: { role: { select: { key: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  for (const candidate of freeCandidates) {
    if (!memberships.some((member) => member.companyId === candidate.companyId)
      && await isFreeExpenseDraftCompany(prisma.client, candidate.companyId)) memberships.push(candidate);
  }
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

/** P29 + J1: a locked company never resolves as chat context — it is either DISABLED, or ACTIVE
 *  with an ended term the resolver above now filters out — so everyone in it lands on the generic
 *  unlinked reply, which tells an owner to connect an account that is already connected.
 *
 *  Two shapes count as locked, and only these two: company DISABLED AND `planTerm.termDisabledAt`
 *  set (the sweep, or provisioning's own no-package lock), or company still ACTIVE with a term that
 *  has already ended (the ≤5-minute window before the sweep catches up). `termDisabledAt` is what
 *  separates either from a disable an admin ordered by hand, which keeps the generic reply.
 *
 *  Read live on every turn and never cached, so a shop that buys a package — back to ACTIVE with a
 *  running term — stops matching on the very next message with nothing to invalidate.
 *
 *  WHICH shop, for someone with several: the one this chat is on, else the newest locked membership
 *  (review 2026-09-29 — an unordered `findFirst` answered for an arbitrary shop). The lock replies and
 *  the support request share this one rule, so the card and the ticket always name the same shop.
 *  Whether the reader may buy (`company.plan.manage`, R-C11) is read for THAT shop only. */
async function lockedCompanyFor(
  prisma: PrismaService,
  userId: string,
  /** The chat's own id: the company it has selected is preferred when it is one of these shops. */
  lineUserId: string,
): Promise<{ companyId: string; lockReason: PlanTermLockReason; canManagePlan: boolean; companyName: string } | null> {
  const now = new Date();
  const where = {
    userId,
    status: 'ACTIVE' as const,
    company: {
      OR: [
        { status: 'DISABLED' as const, planTerm: { termDisabledAt: { not: null } } },
        { status: 'ACTIVE' as const, planTerm: { termEndsAt: { lte: now } } },
      ],
    },
  };
  const select = {
    companyId: true,
    company: { select: { name: true, brandName: true, planTerm: { select: { termStartAt: true, termEndsAt: true, renewCount: true } } } },
    roles: { select: { role: { select: { status: true, permissions: { select: { permission: { select: { key: true } } } } } } } },
  } as const;
  const context = await prisma.client.lineCompanyContext.findUnique({ where: { lineUserId }, select: { companyId: true } });
  const locked = (context
    ? await prisma.client.companyMembership.findFirst({ where: { ...where, companyId: context.companyId }, select })
    : null)
    ?? await prisma.client.companyMembership.findFirst({ where, select, orderBy: { createdAt: 'desc' } });
  if (!locked) return null;
  const term = locked.company?.planTerm;
  // No term row cannot reach the predicate above, so this fallback is defensive only: a lock we
  // cannot explain is described as an ended term, never as "you never bought anything".
  return {
    companyId: locked.companyId,
    lockReason: term ? planTermLockReason(term) : 'trial_ended',
    canManagePlan: canManagePlan(locked.roles),
    companyName: locked.company?.brandName ?? locked.company?.name ?? '',
  };
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

const bahtText = (amount: string, language: 'th' | 'en' = 'th') => {
  const value = Number(amount);
  return Number.isFinite(value)
    ? `${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${language === 'en' ? 'THB' : 'บาท'}`
    : `${amount} ${language === 'en' ? 'THB' : 'บาท'}`;
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

export function lineClarificationContentHash(item: Pick<LedgerSubRequestInput, 'text' | 'subject' | 'clarifyForIntent' | 'candidateExpenseIds' | 'pendingMedia' | 'reasonCode'> & { clarifyQuestion?: string; question?: string }): string {
  return hashMessagePreview(JSON.stringify([item.text, item.clarifyQuestion ?? item.question ?? null,
    item.subject ?? null, item.clarifyForIntent ?? null, item.candidateExpenseIds ?? [], item.pendingMedia ?? null, ...(item.reasonCode ? [item.reasonCode] : [])]));
}

/** What this chat left open, read the way production a2b926c6 read it before routing a text turn. */
type LineOpenWorkContext = {
  openWaiting: Awaited<ReturnType<LineAiLedgerService['openWaitingUser']>>;
  openClarifications?: LineAiOpenClarification[];
  recentCapturedExpenses: LineIntakeCorrectionCandidate[];
  activeExpenseDrafts: LineExpenseDraftRouteContext[];
  substituteContext: LineIntakeSubstituteContext;
};

function draftRoutingRevisions(drafts: readonly LineExpenseDraftRouteContext[]): string {
  return JSON.stringify(drafts.map(({ expenseId, revision }) => ({ expenseId, revision })).sort((a, b) => a.expenseId.localeCompare(b.expenseId)));
}

@Injectable()
export class ProcessLineWebhookUseCase {
  private readonly logger = new Logger(ProcessLineWebhookUseCase.name);
  private readonly documentQaDelivery = new WeakMap<object, LineDocumentQaJobRow>();
  @Inject(LineDocumentQaService) private readonly documentQa!: LineDocumentQaService;
  @Inject(LineDocumentQaWorker) private readonly documentQaWorker!: LineDocumentQaWorker;
  private readonly semanticDelivery = new WeakMap<object, NonNullable<LineAiTurnResponse['semanticCoverage']>>();
  @Inject(LinePackagePurchaseService) private readonly packagePurchases!: LinePackagePurchaseService;
  private readonly deliveryPackagePurchases = new WeakMap<object, { context: RequestContext; view: PackagePurchaseView }>();
  @Inject(LineQuotedMessageService) private readonly quotedMessages!: LineQuotedMessageService;
  private readonly quotedRecords = new WeakMap<object, LineQuotedRecord[]>();
  @Inject(LineCounterpartyService) private readonly counterparties!: LineCounterpartyService;
  private readonly deliveryCounterparties = new WeakMap<object, { context: RequestContext; preview: CounterpartyPreview }>();
  @Optional() @Inject(LineSubstituteReceiptActionService) private readonly substituteActions?: LineSubstituteReceiptActionService;
  @Inject(LineExpenseActionService) private readonly expenseActions!: LineExpenseActionService;
  private readonly deliveryExpenseActions = new WeakMap<object, { context: RequestContext; chat: string; requestId: string; preview: ExpenseActionPreview; applied?: boolean }>();
  private readonly deliveryReimbursements = new WeakMap<object, { context: RequestContext; result: LineReimbursementDraftResult }>();
  @Inject(LineReimbursementDraftService) private readonly reimbursementDrafts!: LineReimbursementDraftService;
  @Inject(LineReimbursementDraftAdapterService) private readonly reimbursementAdapter!: LineReimbursementDraftAdapterService;
  private readonly intakePlansV2 = new WeakMap<LineTextEvent, GovernedLineIntakeRoutePlan>();
  private readonly semanticTaskMappings = new WeakMap<object, Array<{ index: number; taskId: string; subrequestIndex: number }>>();
  private readonly pendingMediaNotices = new WeakMap<object, LineReplyMessage>();
  private readonly retainedTaskSources = new WeakMap<object, { source: NonNullable<LineIntakeRouteRequest['retainedTaskSource']>; sourceText: string; operationId: string }>();
  private readonly mixedBusinessQuestions = new WeakMap<object, { requestId: string; ledgerId?: string | null;
    businessIndexes: number[]; businessStatus: 'handled' | 'needs_user' | 'denied'; selectionRequired: boolean;
    orderedWrites?: NonNullable<LineAiTurnRequest['semanticSubrequests']>;
    readChoices?: Array<{ label: string; text: string; uri?: string }>;
    dependentQuestions: Array<{ index: number; goal: string; dependsOn: number[] }>;
    response: LineAiTurnResponse; coverage: NonNullable<LineAiTurnResponse['semanticCoverage']> }>();
  private readonly mediaTextContinuations = new WeakMap<LineTextEvent, { route: GovernedLineIntakeRoutePlan; requestId: string }>();
  private readonly reimbursementOptionsDelivery = new WeakMap<object, { actionId: string; options: NonNullable<Awaited<ReturnType<LineReimbursementDraftAdapterService['readDisplayOptions']>>> }>();
  private readonly budgetGrantsV2 = new WeakMap<object, AiBudgetGrantV2>();
  private readonly deliveryAccess = new WeakMap<object, { userId: string; companyId: string; membershipId: string; fingerprint: string; allowDuringSupportPause?: boolean }>();
  private readonly deliveryDenialNotified = new WeakSet<object>();
  private readonly deliverySources = new WeakMap<object, { requestId: string; ids: string[] | null; expenseSummary?: LineAiConversationContext['deliveredExpenseSummary']; expenseCriterionConfirmation?: boolean; recentReads?: LineAiConversationContext['recentReads'] }>();
  private readonly deliveryDraftPreviews = new WeakMap<object, { context: RequestContext; chatKeyHash: string; requestId: string; previewId: string | null; phase: 'PENDING' | 'APPLIED' }>();
  private readonly deliveryReceiptSources = new WeakMap<object, { context: RequestContext; chatKeyHash: string;
    records: Map<string, string | null>; categories: Map<string, string | null>; draftChoices?: LineExpenseDraftRouteContext[] }>();
  private readonly deliverySubstituteActions = new WeakMap<object, { context: RequestContext; preview: SubstituteActionPreview; applied?: boolean }>();
  private readonly deliverySubstituteSources = new WeakMap<object, Array<{ context: RequestContext; source: LineSubstituteReceiptContinuationResult['source'] }>>();
  private readonly deliverySubstituteContinuations = new WeakMap<object, LineSubstituteReceiptContinuationResult>();
  private readonly deliveryCandidates = new WeakMap<object, { context: RequestContext; chatKeyHash: string; snapshot: string; originalChoices?: boolean }>();
  private readonly deliveryWaitingSources = new WeakMap<object, { context: RequestContext; items: Array<LineAiOpenClarification & { entry: Pick<LedgerEntry, 'sourceContext'> }> }>();
  private readonly clarificationRouteSources = new WeakMap<object, { candidates: string; draftRouting?: string }>();
  private readonly deliveryDenialCode = new WeakMap<object, string>();
  private readonly publicPolicyTopics = new WeakMap<object, PublicPolicyTopic>();
  private readonly replayedOutcomes = new WeakMap<object, unknown>();
  private readonly intermediateDeliveries = new WeakSet<object>();
  private readonly deliveredTextTurns = new WeakSet<object>();
  private readonly intentionalNoReplyTurns = new WeakSet<object>();
  private readonly boundConversations = new WeakMap<object, { owner: LineConversationOwner; id: string; epoch: number }>();
  @Inject(forwardRef(() => DrainLineLedgerUseCase)) private readonly ledgerDrain!: Pick<DrainLineLedgerUseCase, 'verifyLedgerDeliveryPlan'>;
  @Inject(LineCaptureResultNotifierUseCase) private readonly captureNotifier!: LineCaptureResultNotifierUseCase;
  @Inject(LineLedgerDeliveryService) private readonly deliveryPlans!: LineLedgerDeliveryService;
  @Inject(LineConversationContextService) private readonly contextV2!: LineConversationContextService;
  @Inject(LineReadEvidenceService) private readonly readEvidence!: LineReadEvidenceService;

  @Inject(LinkLinePaymentEvidenceUseCase) private readonly paymentEvidence!: LinkLinePaymentEvidenceUseCase;
  @Inject(GetExpenseUseCase) private readonly getLinkedExpense!: GetExpenseUseCase;
  @Inject(ListExpensesUseCase) private readonly editableExpenses!: ListExpensesUseCase;
  @Inject(VoidExpenseUseCase) private readonly previewEditVoid!: VoidExpenseUseCase;
  @Inject(ListReimbursementsUseCase) private readonly editableClaims!: ListReimbursementsUseCase;
  @Inject(ListCounterpartiesUseCase) private readonly editableCounterparties!: ListCounterpartiesUseCase;
  @Inject(GetCounterpartyUseCase) private readonly getEditableCounterparty!: GetCounterpartyUseCase;

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
    // LINE "ฉันมีส่วนลดไหม" (sales-event spec §8.1). Appended like the rest; absent, the question
    // takes the ordinary turn it took before.
    @Optional() private readonly billing?: BillingService,
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
    if (capabilityHelp) await this.deliverRequiredMessages(event, capabilityHelp((replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.LAUNCH_ROUTE_CLOSED_REPLY : LAUNCH_ROUTE_CLOSED_REPLY)));
    else await this.deliverReply(event, (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.LAUNCH_ROUTE_CLOSED_REPLY : LAUNCH_ROUTE_CLOSED_REPLY));
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
  private async loadPendingApprovals(ctx: RequestContext, keys: ApprovalSurfaceKey[], language: 'th' | 'en' = 'th'): Promise<PendingApprovalSnapshot> {
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
          items: rows.slice(0, PENDING_APPROVAL_ITEM_LIMIT).map((row) => ({
            title: row.requestNo ?? (language === 'en' ? 'Claim' : 'คำขอเบิกเงิน'),
            ...(this.config.aiGatewayInternalSecret ? { buttons: reimbursementApprovalButtons(this.config.aiGatewayInternalSecret, ctx.companyId, ctx.userId, row.id, language) } : {}),
            detail: [row.requesterDisplayNameSnapshot, bahtText(row.amount, language)].filter(Boolean).join(' · '),
          })),
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
            ...(requests?.data ?? []).map((row) => ({ title: row.requestNumber ?? (language === 'en' ? 'Purchase request' : 'ใบขอซื้อ'), detail: bahtText(row.grandTotalAmount, language) })),
            ...(orders?.data ?? []).map((row) => ({ title: row.purchaseOrderNumber ?? (language === 'en' ? 'Purchase order' : 'ใบสั่งซื้อ'), detail: bahtText(row.grandTotalAmount, language) })),
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
      buildLegalAcceptanceRequiredMessage(this.config.webBaseUrl, companyId, replyLanguage(event)),
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
    event?: LineTextEvent;
    enabledFeatures?: string[] | null;
    /** Current server-resolved company entitlements; undefined means authority snapshot missing. */
    entitledFeatureKeys?: ReadonlySet<string> | null;
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
    /** A photo accepted before the AI credit ran out (`LineReceiptUploadEvent.admitOverCap`). */
    admitOverCap?: boolean;
  }): Promise<GovernedLineIntakeRoutePlan> {
    const continuation = input.event && this.mediaTextContinuations.get(input.event);
    if (continuation) return continuation.route;
    const cached = input.event && this.intakePlansV2.get(input.event);
    if (cached) return cached;
    // Owner 2026-09-30: the first AI turn after "the previous answer did not complete" passes the cap once.
    const bound = input.event && this.boundConversations.get(input.event);
    if (input.event && bound && !input.event.admitOverCap && await this.deliveryPlans?.consumeReaskPass?.(
      { companyId: bound.owner.companyId, userId: bound.owner.userId, conversationId: bound.id }).catch(() => false)) input.event.admitOverCap = true;
    const admitOverCap = input.admitOverCap || !!input.event?.admitOverCap;
    try {
      const hasImageContent = !!input.attachment?.contentBase64
        && (input.attachment.mimeType === 'image/png' || input.attachment.mimeType === 'image/jpeg');
      // Owner 2026-10-05 ("อ่านช้ามาก"): about two of a turn's seconds passed inside this stage before the
      // model was asked. One line says which step took them; it carries durations only.
      const timing = { startedAt: Date.now(), grantMs: 0, contextMs: 0, categoriesMs: 0 };
      const budgetGrantV2 = input.event ? await this.prepareTextGrantV2(input.event, input.requestId, hasImageContent) : undefined;
      timing.grantMs = Date.now() - timing.startedAt;
      const reliabilityContext = input.event ? await this.reliabilityContext(input.event) : {};
      timing.contextMs = Date.now() - timing.startedAt - timing.grantMs;
      // Bound private turns get the catalogue too: without it the capture hint below can never name a
      // category, and every LINE draft was saved uncategorised (UAT 2026-09-29, "ค่าส่งของ 300 บาท").
      // Only an actor who may create an expense draft needs it; question-only turns read no expense data.
      const activeCategories = this.expenseRepo && RECEIPT_CAPTURE_PERMISSIONS.some((permission) => input.permissions.includes(permission))
        ? aiSelectableExpenseCategories(await this.expenseRepo.listCategories(input.companyId)).map((c) => ({ id: c.id, name: c.name }))
        : [];
      timing.categoriesMs = Date.now() - timing.startedAt - timing.grantMs - timing.contextMs;
      const gatewayStartedAt = Date.now();
      const offeredToolNames = lineIntakeOfferedToolNames({
        permissions: input.permissions,
        entitledFeatureKeys: input.entitledFeatureKeys,
        draftEditEnabled: this.config.lineAiDraftEditEnabled,
        publicLookupEnabled: this.config.lineAiPublicLookupEnabled,
        reimbursementDraftWriteEnabled: this.config.lineAiReimbursementDraftWriteEnabled,
      });
      const routed = await this.aiGateway.requestLineIntakeRoute({
        requestId: input.requestId,
        // Not part of the model payload — the intake router builds its prompt from an explicit
        // field allowlist — so this only reaches the budget attempt key.
        ...(input.webhookEventId ? { webhookEventId: input.webhookEventId } : {}),
        companyId: input.companyId,
        userId: input.userId,
        locale: (input.event ? replyLanguage(input.event) : lineReplyLanguage(input.messageText)) === 'en' ? 'en-GB' : 'th-TH',
        messageText: input.messageText,
        ...reliabilityContext,
        ...(input.event && this.retainedTaskSources?.get(input.event) ? { retainedTaskSource: this.retainedTaskSources.get(input.event)!.source } : {}),
        ...(budgetGrantV2 && input.event?.inputEvidence ? { inputEvidence: input.event.inputEvidence, budgetGrantV2, contractCapabilities: ['input-evidence-v2' as const, 'budget-envelope-v2' as const] } : {}),
        ...(input.enabledFeatures !== undefined ? { enabledFeatures: input.enabledFeatures } : {}),
        offeredToolNames,
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
          approvedKnowledge: !!input.event && this.boundConversations.has(input.event) && this.config.lineAiApprovedKnowledgeEnabled,
          // Only a bound private chat stores answer preferences (core contract §9), exactly like the command words.
          responsePreference: !!input.event && this.boundConversations.has(input.event) && this.config.lineAiPreferencesEnabled,
          fusedPlan: this.config.lineAiFusedPlanShadowEnabled || this.config.lineAiPreparedSimpleReadEnabled,
          // Bound v2 uses semantic substitute routing; legacy shadow/off remain inert.
          substituteSemantic: (!!input.event && this.boundConversations.has(input.event))
            || this.config.lineAiSubstituteSemanticRoutingMode === 'primary',
          // clarify_only/handoff only — 'shadow' is inert like 'off' (the router is never offered the route).
          reimbursementSemantic: (!!input.event && this.boundConversations.has(input.event) && this.config.lineAiReimbursementDraftWriteEnabled)
            || this.config.lineAiReimbursementSemanticMode === 'clarify_only'
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
      }, { busyWaitDeadlineMs: input.busyWaitDeadlineMs, retryWebhookEventId: input.retryWebhookEventId, onAdmitted: input.onAdmitted,
        ...(admitOverCap ? { admitOverCap: true } : {}) });
      try {
        this.logger.log({ msg: 'line.ai.intake_timing', surface: 'employee_oa', requestId: input.requestId, webhookEventId: input.webhookEventId,
          grantMs: timing.grantMs, contextMs: timing.contextMs, categoriesMs: timing.categoriesMs, gatewayMs: Date.now() - gatewayStartedAt });
      } catch { /* telemetry cannot change the outcome it observes */ }
      const bodyRefusal = knownAiBudgetResponse(routed);
      if (bodyRefusal) throw new HttpException(bodyRefusal, 429);
      const question = input.openClarifications?.length === 1 ? input.openClarifications[0] : undefined;
      const intent = question?.clarifyForIntent;
      const evidence = input.event?.inputEvidence;
      if (routed.status === 'UNAVAILABLE' && routed.errorCode === 'ROUTER_SEMANTIC_SCHEMA_INVALID'
        && !input.attachment && !this.retainedTaskSources?.has(input.event!) && evidence && intent
        && ['SUBSTITUTE_RECEIPT_CONTINUATION', 'EXPENSE_DRAFT_CONTINUATION', 'EXPENSE_CAPTURE_CORRECTION'].includes(intent)) {
        // The live answer is DATA for the existing question's handler, never repaired model facts.
        // The normal dispatcher still rechecks the question source, permissions and current state.
        const semanticSubrequests = parseLineAiSemanticSubrequests([{ index: 0, kind: 'write', goal: input.messageText,
          writeIntent: intent, requestedFilters: {}, requiredEvidence: [], dependsOn: [],
          evidenceRefs: evidence.parts.filter(part => part.rawText.length).map(part => ({ partId: part.partId,
            startUtf16: 0, endUtf16: part.rawText.length, rawSha256: part.rawSha256 })) }], input.messageText, evidence);
        if (semanticSubrequests) return { status: 'ROUTED', intent, language: 'th', confidence: 0,
          resolvedClarificationIds: [question!.id], semanticSubrequests, usage: routed.usage };
      }
      return routed;
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
    /** This same reply as a card of the locked System OA design, when its builder could draw it whole.
     *  The card carries `text` as its canonical text, so `text` is still what is stored and what falls back. */
    designed?: LineReplyMessage,
    /** For a reply to a photo or a file: what became of that document (its card's second header line). */
    outcome?: LineSentDocumentOutcome,
  ): Promise<void> {
    quickReply ??= mediaChoiceQuickReply(text, replyLanguage(event));
    const substituteAction = this.deliverySubstituteActions.get(event);
    designed ??= substituteAction ? buildSubstituteReceiptActionCard(substituteAction.preview, substituteAction.applied || text.includes(substituteAction.preview.summary) ? text : `${text}\n\n${substituteAction.preview.summary}`, substituteAction.applied, replyLanguage(event)) : undefined;
    const facts = this.deliverySubstituteContinuations.get(event);
    designed ??= facts ? buildSubstituteReceiptFactsCard(facts, text, replyLanguage(event)) : undefined;
    if (designed && quickReply) designed = inheritCompleteLineBusinessAnswerPresentation(designed, { ...designed, quickReply });
    const card = designed ? undefined : this.boundReplyCard(event, text, undefined, outcome);
    const result = await this.deliverMessages(event, [designed
      ?? (card ? inheritCompleteLineBusinessAnswerPresentation(card, { ...card, ...(quickReply ? { quickReply } : {}) }) : {
        ...(this.boundConversations.has(event) ? { type: 'text' as const, text } : this.lineReply.buildTextMessage(text)),
        ...(quickReply ? { quickReply } : {}),
      })]);
    if (result !== 'ok') throw new LineDeliveryError(result);
  }

  /**
   * A bound chat's short reply — an apology, a question, a notice — on the locked design, under the
   * reader's own words (owner 2026-10-05, when "ขอโทษค่ะ น้องมั่งมียังไม่แน่ใจว่าหมายถึงอะไร…" came back as
   * a bare text bubble between cards: "การ์ดหลุดด้วย"). The card carries `text` as its canonical text, so
   * the delivery plan stores the same words and sends them if LINE refuses the card.
   *
   * A photo or a file carries no words. Its reply stands under "เอกสารที่ส่งมา" and the fixed phrase for
   * what became of the document (owner 2026-10-05, a reply to a photo still on the green card): the
   * sender of the reply names the outcome; one that names none is a result of the read.
   *
   * `undefined` — the reply stays what it was — for a chat that is not bound; for a reply to a button
   * tap (no typed words, no document); for a web base that is not https; and for a reply with a link
   * that cannot be made a button of this company, which only a text message keeps tappable.
   */
  private boundReplyCard(event: object, text: string, badge?: string, outcome?: LineSentDocumentOutcome): LineReplyMessage | undefined {
    const bound = this.boundConversations.get(event);
    // A typed message has LINE's own message id; a tap or a follow is carried here as words the reader never typed.
    const typed = 'messageText' in event && typeof event.messageText === 'string' && 'lineMessageId' in event && event.lineMessageId ? event.messageText : undefined;
    const sentDocument = !('messageText' in event) && 'messageType' in event;
    const header = !bound ? undefined : sentDocument
      ? { lines: [LINE_SENT_DOCUMENT_CARD_CONTEXT, LINE_SENT_DOCUMENT_OUTCOMES[outcome ?? 'result']] as const }
      : lineAnswerCardHeader(typed);
    if (!bound || !header) return undefined;
    const card = buildLineSystemTextCardMessage({ ...({ text, ...(badge?.trim() ? { paper: `${badge.trim()}\n${text}` } : {}), header,
      webBaseUrl: this.config.webBaseUrl, companyId: bound.owner.companyId, textStyle: 'answer', icon: 'file' }), language: replyLanguage(event) });
    return card?.type === 'flex' && !lineSystemCardTexts(card.contents).some((line) => /https?:\/\//iu.test(line)) ? card : undefined;
  }

  /** P29 + J1: answer a locked company with the package invitation instead of the generic "we
   *  cannot find your company" reply. Returns true when it has answered the turn.
   *
   *  Every caller sits on the `no company resolved` branch, which is reached before the permission
   *  resolver, the entitlement read, the router and the model — so a locked company costs a few
   *  indexed lookups (`lockedCompanyFor`) and not a single token.
   *
   *  Members whose role grants `company.plan.manage` (R-C11) in the shop `lockedCompanyFor` picked
   *  are the only ones who can act, so only they get the package card. Everyone else in that shop
   *  gets one neutral sentence with no package, date or price in it (C3, the same rule the web
   *  banner follows), and someone with no membership at all still gets `UNLINKED_REPLY` from the
   *  caller. */
  private async replyIfCompanyLocked(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; handoff?: LineHandoffRecipient },
    userId: string,
  ): Promise<boolean> {
    const locked = await lockedCompanyFor(this.prisma, userId, event.lineUserId);
    if (!locked) return false;
    if (!locked.canManagePlan) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.PACKAGE_REQUIRED_MEMBER_REPLY : PACKAGE_REQUIRED_MEMBER_REPLY));
    } else if (['test', 'live'].includes(this.config.billingMode) && this.config.webBaseUrl) {
      // R-B2 (b): the link is minted here, before the outcome is recorded, so the card is one tap
      // into the package page whether or not the delivery seam wraps (it does not with the replay
      // flag on — production). `event.handoff` still binds the turn's tenant for bookkeeping.
      event.handoff = { userId, companyId: locked.companyId };
      const packageUrl = await this.oneTapPackageUrl(event, userId, locked.companyId, 'locked_card_packages');
      await this.deliverRequiredMessages(event, [buildPackageRequiredMessage({ ...({
        lockReason: locked.lockReason, companyId: locked.companyId, webBaseUrl: this.config.webBaseUrl,
        companyName: locked.companyName, ...(packageUrl ? { packageUrl } : {}),
      }), language: replyLanguage(event) })]);
    } else {
      // Billing closed (or no web base): there is no package page to send anyone to, so the reply
      // stays the text and quick reply it has always been — worded for the shop's own lock reason.
      await this.deliverReply(event, expiredLineOwnerMessageTh(locked.lockReason), {
        items: [{ type: 'action', action: { type: 'message', label: PACKAGE_CHANGE_COMMAND, text: PACKAGE_CHANGE_COMMAND } }],
      });
    }
    // A status, not an error code: we said no on purpose and the customer received the answer.
    await this.updateEventLog(event.webhookEventId, 'package_required', undefined, locked.companyId);
    return true;
  }

  /**
   * P10-L §3.1. One card answers the door, and an application already travelling replaces it with
   * its status — so a customer who applied ten minutes ago is never invited to apply again.
   *
   * Read from the application table directly, like every other state this turn reads: the row is
   * keyed by the same (channel, LINE user) pair the identity lookup above uses.
   *
   * `welcome` (Owner 2026-09-21) puts the first hello in front of the DOOR card, and only there: a
   * stranger who merely typed is answered by the card alone, and an application already travelling
   * gets its status card — whose footer has no "เปิดร้านใหม่" for the greeting's step 1 to name.
   */
  private async entryDoorMessages(lineUserId: string, welcome = false, language: 'th' | 'en' = 'th'): Promise<LineReplyMessage[]> {
    const pending = await this.findOpenLineSignup(lineUserId);
    if (!pending) {
      if (!welcome) return [this.doorCard(language)];
      // R-C4 (§18.2): the how-to picture showed no "choose a package" step, and a locked shop cannot
      // take the steps it did show. Withdrawn until a new asset under a NEW file name exists (LINE
      // caches by URL; apps/web/public is a Release Contracts trigger — the old PNG stays untouched).
      return [{ type: 'text', text: FOLLOW_WELCOME_REPLY[language] }, this.doorCard(language)];
    }
    return [buildSignupStatusCard(pending.companyName, isBusinessHours(new Date(), {
      days: this.config.lineSignupBusinessDays,
      hours: this.config.lineSignupBusinessHours,
    }), language)];
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
  private doorCard(language: 'th' | 'en' = 'th'): LineReplyMessage {
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

  /**
   * The โปรโมชั่น card for whoever tapped the tile (Owner 2026-09-21). A stranger is sent to the
   * same LIFF form the door card offers; an owner is sent to their own package page, one tap, bound
   * to them by the same mint the บริษัทของฉัน buttons use — and with the seam absent or a mint
   * refused, to the plain package page, which is what that link degraded to before it existed.
   * Anyone else in a shop cannot choose the package, so they get the card without that button.
   */
  private async promotionCard(event: LineTextEvent): Promise<LineReplyMessage> {
    const identity = await this.resolveLineIdentity(event);
    if (!identity || identity.user.status !== 'ACTIVE') return buildPromotionCard('stranger', this.newShopSignupUrl(), replyLanguage(event));
    // R-C11: whoever may buy for the shop gets the button, owner or custom role alike.
    const owners = (await this.listLineCompanies(identity.userId)).filter((membership) => canManagePlan(membership.roles));
    if (owners.length === 0) return buildPromotionCard('employee', undefined, replyLanguage(event));
    // Which shop: the one this chat is already on, else the oldest owned. ponytail: a picker in
    // front of a card whose whole point is one tap costs more than it saves, and an owner who
    // meant the other shop switches with บริษัทของฉัน exactly as they do for every other link.
    const context = await this.prisma.client.lineCompanyContext.findUnique({
      where: { lineUserId: event.lineUserId }, select: { companyId: true },
    });
    const companyId = (owners.find((row) => row.companyId === context?.companyId) ?? owners[0]!).companyId;
    if (!this.config.webBaseUrl) return buildPromotionCard('owner', undefined, replyLanguage(event));
    const targetPath = `/companies/${encodeURIComponent(companyId)}/billing?channel=line`;
    // Same mint as the lock card; in a group/room the button stays the plain package page (RV08).
    return buildPromotionCard('owner', await this.oneTapPackageUrl(event, identity.userId, companyId, 'promotion_card_packages')
      ?? new URL(targetPath, this.config.webBaseUrl).toString(), replyLanguage(event));
  }

  /**
   * The ส่วนลดจากงาน answer (sales-event spec §8.1). The billing read is owner/plan-manager only; anyone
   * else is told who asks. The package button is the promotion card's own one-tap link, and only on
   * the answer that says this shop can use the discount now.
   */
  private async eventDiscountCard(event: LineTextEvent, context: RequestContext): Promise<LineReplyMessage> {
    let facts: Awaited<ReturnType<BillingService['lineEventDiscount']>>;
    try {
      facts = await this.billing!.lineEventDiscount(context);
    } catch (error) {
      if (error instanceof ForbiddenException) return { type: 'text', text: EVENT_DISCOUNT_MEMBER_REPLY };
      throw error;
    }
    const packageUrl = this.config.webBaseUrl ? await this.oneTapPackageUrl(event, context.userId, context.companyId, 'promotion_card_packages')
      ?? new URL(`/companies/${encodeURIComponent(context.companyId)}/billing?channel=line`, this.config.webBaseUrl).toString() : undefined;
    return buildEventDiscountCard(facts, packageUrl);
  }

  /**
   * R-B2 (b): mint the one-tap package link IN the lane, before `recordTurnOutcome` stores the
   * payload, so the stored bytes and the sent bytes carry the same token and LINE's retry key stays
   * one identity (RV07). Never in a group/room: anyone there could exchange it into the owner's
   * session (RV08) — a plain tenant URL (external-browser param added at the exit) is the answer.
   * Absent seam or a refused mint → `undefined`, and the caller renders the plain link it always sent.
   */
  private async oneTapPackageUrl(
    event: { lineUserId: string; pushTargetId?: string },
    userId: string,
    companyId: string,
    surface: 'locked_card_packages' | 'package_change_reply' | 'promotion_card_packages',
  ): Promise<string | undefined> {
    const chatKey = event.pushTargetId ?? event.lineUserId;
    if (!this.handoffLinks || isLineGroupChatKey(chatKey)) return undefined;
    return await this.handoffLinks.linkFor(
      { userId, companyId, lineUserId: chatKey, surface },
      `/companies/${encodeURIComponent(companyId)}/billing?channel=line`,
    ) ?? undefined;
  }

  /** §15.1: "ช่วงทดลอง" is only true of the trial tier; every other shop hears about its package. */
  private async isTrialTier(companyId: string): Promise<boolean> {
    const term = await this.prisma.client.companyPlanTerm.findUnique({
      where: { companyId },
      select: { tierKey: true },
    });
    return term?.tierKey === 'FREE_TRIAL_15';
  }

  /**
   * The AI credit refused this call for good — spent, or too little left for it (spec §9.1). One answer
   * wherever that refusal surfaces: the credit card, and a durable budget status rather than "provider
   * unavailable" (§9.3). Returns false for anything else — busy and "could not check" included — so the
   * caller keeps its own reply. It only words a refusal already made; it admits and refuses nothing.
   */
  private async answerAiCreditRefusal(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; handoff?: LineHandoffRecipient },
    companyId: string,
    refusal: { budgetErrorCode?: string; budgetScope?: AiBudgetScope },
    /** Advisor spec §2.2: the reader holds `company.plan.manage`; only they get the package buttons. */
    canManagePlan: boolean,
  ): Promise<boolean> {
    if (!isAiBudgetPermanentRefusal(refusal.budgetErrorCode)) return false;
    await this.deliverRequiredMessages(event, [buildAiBudgetExceededMessage(await this.isTrialTier(companyId), refusal, canManagePlan, replyLanguage(event), this.config.webBaseUrl)]);
    await this.updateEventLog(
      event.webhookEventId,
      refusal.budgetErrorCode === AI_BUDGET_REFUSAL_CODES.insufficient ? 'ai_budget_insufficient' : 'ai_budget_exceeded',
      refusal.budgetErrorCode,
      companyId,
      refusal.budgetScope ? { budgetScope: refusal.budgetScope } : undefined,
    );
    return true;
  }

  /** True while a support pause set by `ติดต่อเจ้าหน้าที่` is still running (§8, 24h, self-expiring). */
  async assistantPaused(lineUserId: string): Promise<boolean> {
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
      await this.deliverReply(event, SUPPORT_ALREADY_OPEN_REPLY[replyLanguage(event)]);
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

    const created = await this.openSupportRequest(event.lineUserId, asker, asker?.lastMessageText);
    if (!created) {
      await this.deliverReply(event, SUPPORT_DAILY_LIMIT_REPLY[replyLanguage(event)]);
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
    await this.deliverReply(event, STAFF_CONTACT_REPLY[replyLanguage(event)]);
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
   * The ONE creator of a `LineSupportRequest` row (§2.1). Returns the live row when one raced ahead,
   * `null` when the daily amplification floor refused, else the created id. `text` is what the
   * operator reads first (requestText/lastMessageText and the opening thread line).
   *
   * Amplification floor. Closing a request frees the dedupe of the callers, so tap → resume → tap,
   * repeated, was an unbounded source of rows, letters and pushes from one unauthenticated
   * LINE account. Three genuine asks a day is more than a real customer makes; the fourth is
   * answered warmly and writes nothing. Checked HERE, not at dispatch: a repeat tap on an
   * already-open request costs nothing and must never be refused.
   */
  private async openSupportRequest(
    lineUserId: string,
    asker: { companyId: string | null; signupRequestId?: string } | null,
    text: string | undefined,
    /** PR E (R-E5): where the ask started, derived server-side (deriveSupportBillingReference) —
     *  never taken from the client. Written on both the create and the raced-live-row update. */
    reference?: { kind: 'attempt' | 'invoice'; id: string },
  ): Promise<{ id: string; status?: string } | null> {
    return this.prisma.client.$transaction(async (tx) => {
      const lockKey = `line-support:${hashMessagePreview(lineUserId)}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const raced = await tx.lineSupportRequest.findFirst({
        where: { lineUserId, status: { in: ['OPEN', 'ANSWERED'] } },
        orderBy: { requestedAt: 'desc' }, select: { id: true, status: true },
      });
      if (raced) {
        const touched = await tx.lineSupportRequest.updateMany({
          where: { id: raced.id, status: raced.status },
          data: { lastMessageAt: new Date(), ...(raced.status === 'ANSWERED'
            ? { status: 'OPEN', reopenedCount: { increment: 1 } } : {}),
            ...(reference ? { referenceKind: reference.kind, referenceId: reference.id } : {}) },
        });
        if (touched.count === 0) throw new ConflictException('line_support_state_changed');
        return raced;
      }
      if (this.rateLimit && !await this.rateLimit.consumeLineSupportRequestSlot(lineUserId)) return null;

      return tx.lineSupportRequest.create({
        data: {
          lineUserId,
          lineUserIdHash: hashMessagePreview(lineUserId),
          ...(asker?.companyId ? { companyId: asker.companyId } : {}),
          ...(asker?.signupRequestId ? { signupRequestId: asker.signupRequestId } : {}),
          ...(reference ? { referenceKind: reference.kind, referenceId: reference.id } : {}),
          // Both, from the same sentence: `requestText` is the question and never changes again,
          // `lastMessageText` is where the thread has got to and is rewritten by every follow-up.
          ...(text ? { requestText: text, lastMessageText: text } : {}),
          // สัญญา v3 ข้อ 9: the same sentence opens the chat an operator reads, so the thread starts
          // where the question does rather than at the first follow-up.
          ...(text ? { messages: { create: { direction: 'CUSTOMER', kind: 'TEXT', text } } } : {}),
        },
        select: { id: true },
      });
    });
  }

  /**
   * G19 / RV32. "ให้ทีมงานติดต่อกลับ" on the promotion card files a callback request in the same inbox
   * as ติดต่อเจ้าหน้าที่ — same dedupe, same daily floor, same operator notice — but it NEVER pauses
   * the assistant: the customer asked for a call, not for the bot to go quiet. Public like its twin.
   */
  private async handlePackageCallback(event: LineTextEvent, requestId: string): Promise<void> {
    const asker = await this.resolveSupportAsker(event);
    // R-E5/A13: the postback carries no id (SEC-04) — the reference is derived here, server-side,
    // from the sender's own company, never from the button.
    const reference = await this.deriveSupportBillingReference(asker);
    const live = await this.findLiveSupportRequest(event.lineUserId);
    if (live) {
      await this.recordSupportFollowUp(event.lineUserId, requestId, { text: PACKAGE_CALLBACK_NOTE }, { extendPause: false }, reference);
      await this.deliverReply(event, PACKAGE_CALLBACK_ALREADY_OPEN_REPLY[replyLanguage(event)]);
      await this.audit.log({
        action: 'signup.line.support_requested',
        ...(asker?.companyId ? { companyId: asker.companyId } : {}),
        targetType: 'line_support_request', targetId: live.id, requestId, result: 'SUCCESS', riskLevel: 'LOW',
        metadataJson: { kind: 'package_callback', alreadyOpen: true, reopened: live.status === 'ANSWERED', paused: false,
          referenceKind: reference?.kind ?? null, hasReference: Boolean(reference) },
      });
      await this.updateEventLog(event.webhookEventId, 'support_already_open');
      return;
    }
    const created = await this.openSupportRequest(event.lineUserId, asker, PACKAGE_CALLBACK_NOTE, reference);
    if (!created) {
      await this.deliverReply(event, SUPPORT_DAILY_LIMIT_REPLY[replyLanguage(event)]);
      await this.audit.log({
        action: 'signup.line.support_requested',
        ...(asker?.companyId ? { companyId: asker.companyId } : {}),
        targetType: 'line_user', requestId, result: 'DENIED', riskLevel: 'LOW',
        metadataJson: { kind: 'package_callback', reason: 'daily_limit', linked: Boolean(asker) },
      });
      await this.updateEventLog(event.webhookEventId, 'support_rate_limited');
      return;
    }
    // Deliberately NO pauseAssistant here (the one difference from handleStaffContact).
    await this.deliverReply(event, asker?.assistantAnswers ? PACKAGE_CALLBACK_REPLY[replyLanguage(event)] : PACKAGE_CALLBACK_NO_ASSISTANT_REPLY[replyLanguage(event)]);
    await this.signupNotify?.enqueueSupportRequest(created.id);
    await this.audit.log({
      action: 'signup.line.support_requested',
      ...(asker?.companyId ? { companyId: asker.companyId } : {}),
      targetType: 'line_support_request', targetId: created.id, requestId, result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { kind: 'package_callback', paused: false, linked: Boolean(asker), hasPendingSignup: Boolean(asker?.signupRequestId),
        referenceKind: reference?.kind ?? null, hasReference: Boolean(reference) },
    });
    await this.updateEventLog(event.webhookEventId, 'package_callback_requested');
  }

  /**
   * PR E (R-E5, A13): the sender's own billing reference — the latest attempt still in flight, else
   * the latest invoice, else none. Read-only; never asserts membership beyond what
   * resolveSupportAsker already picked (it scopes to the sender, locked shops included).
   */
  private async deriveSupportBillingReference(
    asker: { companyId: string | null } | null,
  ): Promise<{ kind: 'attempt' | 'invoice'; id: string } | undefined> {
    const stripeAccountId = this.config.stripeAccountId;
    if (!stripeAccountId || !['test', 'live'].includes(this.config.billingMode)) return undefined;
    const companyId = asker?.companyId ?? null;
    if (!companyId) return undefined;
    const account = await this.prisma.client.billingAccount.findUnique({ where: { companyId_stripeAccountId_livemode: {
      companyId, stripeAccountId, livemode: this.config.billingMode === 'live' } } });
    if (!account) return undefined;
    const attempt = await this.prisma.client.billingAttempt.findFirst({
      where: { billingAccountId: account.id, status: { in: ['CREATING', 'REQUESTING', 'OPEN', 'UNKNOWN'] } },
      orderBy: { updatedAt: 'desc' }, select: { id: true } });
    if (attempt) return { kind: 'attempt', id: attempt.id };
    const invoice = await this.prisma.client.billingInvoice.findFirst({
      where: { billingAccountId: account.id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    return invoice ? { kind: 'invoice', id: invoice.id } : undefined;
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
   *
   * With no ACTIVE shop at all (review 2026-09-29), a LOCKED one is still the shop an operator has
   * to call — the ticket used to read "ผู้ที่ยังไม่ได้เปิดร้าน" with no company. It is picked by
   * `lockedCompanyFor`, the same rule the lock reply uses, so the ticket names the shop the chat did.
   */
  private async resolveSupportAsker(event: { lineUserId: string; messagingChannelId?: string }): Promise<{
    companyId: string | null;
    signupRequestId?: string;
    lastMessageText?: string;
    /** The chat resolves to a usable shop, so the assistant can still answer it (G19 says so). */
    assistantAnswers?: true;
  } | null> {
    const { lineUserId } = event;
    const identity = await this.resolveLineIdentity(event);
    if (!identity || identity.user.status !== 'ACTIVE') {
      const pending = await this.pendingSignupFor(lineUserId);
      return pending ? { companyId: null, signupRequestId: pending } : null;
    }
    const resolved = await resolveCompanyForLineUser(this.prisma, identity.userId, lineUserId);
    let companyId = resolved && 'companyId' in resolved ? resolved.companyId : null;
    if (!resolved) companyId = (await lockedCompanyFor(this.prisma, identity.userId, lineUserId))?.companyId ?? null;
    companyId ??= (await this.prisma.client.companyMembership.findFirst({
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
    return { companyId, ...(resolved ? { assistantAnswers: true as const } : {}), ...(lastMessageText ? { lastMessageText } : {}) };
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
    const aiPausedUntil = new Date(Date.now() + SUPPORT_ASSISTANT_PAUSE_MS);
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
    message: { text?: string; lineMessageId?: string },
    /** `extendPause: false` (G19 callback) records the message without re-arming a running pause. */
    options: { extendPause?: boolean } = {},
    /** PR E (R-E5): where the ask started, derived server-side. Newest context wins on a repeat call. */
    reference?: { kind: 'attempt' | 'invoice'; id: string },
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
          ...(reference ? { referenceKind: reference.kind, referenceId: reference.id } : {}),
        },
      });
      if (moved.count === 0) return 'none';
      // สัญญา v3 ข้อ 9: the WHOLE sentence goes on the thread; the row above keeps its summary.
      // Best effort inside this best effort: the request is recorded already, and a thread hiccup
      // must not turn "recorded" into "none" and tell the customer nobody got their message.
      if (text) {
        await this.appendSupportMessage(live.id, {
          direction: 'CUSTOMER', kind: 'TEXT',
          text: message.text!.trim().slice(0, SUPPORT_THREAD_TEXT_MAX_LENGTH),
          ...(message.lineMessageId ? { lineMessageId: message.lineMessageId } : {}),
        });
      }
      // EXTEND ONLY, never create (review 2026-09-06 N2). `live.companyId` is whatever the row
      // recorded when it was filed, checked against nobody since — and §2.5 DELETES this row on
      // unlink, so an upsert here rebuilt an ex-member's context pointing at the shop they left.
      // The tap's own `pauseAssistant`, which asks `resolveSupportAsker` for a live membership
      // first, stays the only thing allowed to open a pause.
      if (options.extendPause !== false) {
        await this.prisma.client.lineCompanyContext.updateMany({
          where: { lineUserId, aiPausedUntil: { not: null } },
          data: { aiPausedUntil: new Date(Date.now() + SUPPORT_ASSISTANT_PAUSE_MS) },
        });
      }
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
   * while v3 stores the checked bytes in the support thread. Best effort, like the follow-up beside
   * it — a receipt must never be lost because the support table could not be written.
   */
  private async stampSupportMedia(event: LineReceiptUploadEvent): Promise<boolean> {
    const live = await this.findLiveSupportRequest(event.lineUserId).catch((error: unknown) => {
      this.logger.warn({ msg: 'line_support_media_not_recorded', ...safeLineErrorDetails(error) });
      return null;
    });
    if (!live) return false;
    try {
      const stamped = await this.prisma.client.lineSupportRequest.updateMany({
        where: { id: live.id, status: live.status },
        data: { lastMediaAt: new Date() },
      });
      if (stamped.count === 0) return false;
    } catch (error) {
      this.logger.warn({ msg: 'line_support_media_not_recorded', ...safeLineErrorDetails(error) });
      return false;
    }
    await this.storeSupportMedia(live.id, event);
    return true;
  }

  /**
   * สัญญา v3 ข้อ 10 (Owner 2026-09-20): the picture itself, for the operator's chat. The marker above
   * already said "a photo arrived"; this keeps the bytes so they can see WHICH — through the same
   * checks the receipt lane applies (type, size, signature, malware), and with the same honesty when
   * they fail: a row carrying `mediaError` rather than a bubble that pretends.
   *
   * The row is CLAIMED before any byte moves (unique on `lineMessageId`, like `ensurePendingMedia`):
   * a redelivered webhook loses that race and never downloads or stores a second copy. Still best
   * effort, like the marker — a receipt must never be lost because a support table could not be
   * written. ponytail: a live support thread plus a linked receipt downloads the bytes twice (once
   * here, once for the draft); share the download when that ever shows up in a timing.
   */
  private async storeSupportMedia(requestId: string, event: LineReceiptUploadEvent): Promise<void> {
    const claimed = await this.appendSupportMessage(requestId, {
      direction: 'CUSTOMER', kind: event.messageType === 'image' ? 'IMAGE' : 'FILE',
      lineMessageId: event.lineMessageId,
      ...(event.fileName ? { mediaFileName: event.fileName } : {}),
    });
    if (!claimed) return;
    let outcome: { mediaError: string } | { media: DownloadedLineMedia };
    try {
      // Counted AFTER the claim and INCLUDING it — every claimed photo/file that has not been
      // refused — so a burst of concurrent photos cannot all squeeze under the ceiling: the ones
      // past it see themselves in the count and stop before a byte moves.
      const claimedMedia = await this.prisma.client.lineSupportMessage.count({
        where: { requestId, kind: { in: ['IMAGE', 'FILE'] }, mediaError: null },
      });
      if (claimedMedia > SUPPORT_THREAD_MAX_MEDIA) {
        await this.prisma.client.lineSupportMessage.update({ where: { id: claimed.id }, data: { mediaError: 'media_limit_reached' } });
        return;
      }
      const downloaded = await this.downloadLineMedia(event.lineMessageId, event.messageType, event.fileName, event.fileSize);
      // Handed to the receipt lane on the event (the `SAVED_LINE_RECEIPT` pattern), so a photo on a
      // live case costs LINE and the clock one download, not two. Only a success travels: a failed
      // fetch here must not decide the receipt lane's own retry.
      if (downloaded.ok) (event as SupportMediaDownloadCarrier)[SUPPORT_MEDIA_DOWNLOAD] = downloaded;
      const rejection = downloaded.ok ? await this.lineMediaRejectionReason(downloaded.media) : null;
      // Every download reason (no token, oversize, HTTP, timeout) is the same fact to an operator:
      // the bytes are not here. The receipt lane keeps the typed reason on its own attempt row.
      outcome = !downloaded.ok
        ? { mediaError: 'media_fetch_failed' }
        : rejection
          ? { mediaError: rejection === 'MALWARE_SCAN_FAILED' ? 'media_scan_failed' : 'media_security_rejected' }
          : { media: downloaded.media };
    } catch (error) {
      this.logger.warn({ msg: 'line_support_media_not_stored', ...safeLineErrorDetails(error) });
      outcome = { mediaError: 'media_fetch_failed' };
    }
    try {
      await this.prisma.client.lineSupportMessage.update({
        where: { id: claimed.id },
        data: 'media' in outcome
          ? {
            // Not `media.fileName`: the lane's default name carries the LINE message id, which §3
            // keeps off the contract. A customer-supplied file name was recorded at the claim.
            mediaMimeType: outcome.media.mimeType, mediaByteSize: outcome.media.byteSize,
            // new Uint8Array(...) copies into a plain ArrayBuffer — Prisma's Bytes type.
            blob: { create: { data: new Uint8Array(outcome.media.bytes) } },
          }
          : { mediaError: outcome.mediaError },
      });
    } catch (error) {
      this.logger.warn({ msg: 'line_support_media_not_stored', ...safeLineErrorDetails(error) });
    }
  }

  /**
   * สัญญา v3 ข้อ 9: one bubble on the case's chat. Best effort like every support write beside a
   * turn — a customer must never lose an answer because the thread table was unavailable — and
   * silent on P2002, which is a redelivered webhook re-sending a `lineMessageId` already recorded.
   */
  private async appendSupportMessage(requestId: string, data: {
    direction: 'CUSTOMER' | 'STAFF'; kind: 'TEXT' | 'IMAGE' | 'FILE';
    text?: string; lineMessageId?: string; mediaFileName?: string;
  }): Promise<{ id: string } | null> {
    try {
      // One writer per request at a time — the tap's own advisory-lock pattern — so the ceiling is
      // exact: the count and the insert commit together, and a concurrent burst queues behind them.
      return await this.prisma.client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`line-support-thread:${requestId}`}, 0))`;
        if (await tx.lineSupportMessage.count({ where: { requestId } }) >= SUPPORT_THREAD_MAX_MESSAGES) {
          this.logger.warn({ msg: 'line_support_thread_full', requestId });
          return null;
        }
        return tx.lineSupportMessage.create({ data: { requestId, ...data }, select: { id: true } });
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') {
        this.logger.warn({ msg: 'line_support_message_not_recorded', ...safeLineErrorDetails(error) });
      }
      return null;
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
    await this.deliverRequiredMessages(event, available
      ? [{ type: 'text', text: ASSISTANT_RESUMED_REPLY[replyLanguage(event)] }]
      : await this.entryDoorMessages(event.lineUserId, false, replyLanguage(event)));
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
   * P10-L §3.7. Opens a package-change request for the shop this owner runs. This button is
   * intent-only: it carries no record identifiers, and the owned shop is re-derived here, so a
   * forged postback can only ask for what the sender could already ask for by typing.
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
        // R-C11: the same people the web lets buy (`company.plan.manage`), owner or custom role alike.
        ...planManagerRoleFilter(),
      },
      orderBy: { createdAt: 'asc' },
      // Status + term too, so the picker below carries the same lock chips บริษัทของฉัน does (R-C8).
      select: { companyId: true, company: { select: { name: true, brandName: true, status: true, planTerm: {
        select: { tierKey: true, termStartAt: true, termEndsAt: true, renewCount: true, termDisabledAt: true } } } } },
    });
    if (memberships.length === 0) {
      await this.deliverReply(event, PACKAGE_CHANGE_NOT_OWNER_REPLY[replyLanguage(event)]);
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
        buildCompanyPickerMessage(memberships.map(membership => companyPickerItem(membership, replyLanguage(event))), undefined, undefined, replyLanguage(event)),
        { type: 'text', text: (replyLanguage(event) === 'en' ? "Choose your shop, then request the package change again." : 'เลือกร้านที่ต้องการก่อน แล้วกด “ขอเปลี่ยนแพ็กเกจ” อีกครั้งค่ะ'),
          quickReply: { items: [{ type: 'action', action: { type: 'message', label: PACKAGE_CHANGE_COMMAND, text: PACKAGE_CHANGE_COMMAND } }] } },
      ]);
      await this.updateEventLog(event.webhookEventId, 'needs_company_selection', LINE_AI_ERROR_CODES.AMBIGUOUS_COMPANY);
      return;
    }
    if (['test', 'live'].includes(this.config.billingMode) && this.config.webBaseUrl) {
      // Old rich-menu/message commands converge here too. The reply offers a review page, never
      // claims payment or changes rights. R-B2 (b): the one-tap link is minted here, before the
      // outcome is recorded; a refused mint or a group chat keeps the plain tenant URL.
      event.handoff = { userId, companyId: owned.companyId };
      const plainUrl = new URL(`/companies/${encodeURIComponent(owned.companyId)}/billing?channel=line`, this.config.webBaseUrl).toString();
      const url = await this.oneTapPackageUrl(event, userId, owned.companyId, 'package_change_reply') ?? plainUrl;
      await this.deliverRequiredMessages(event, [buildPackageReviewCard(companyLabel(owned, replyLanguage(event)), url, replyLanguage(event))]);
      await this.updateEventLog(event.webhookEventId, 'billing_review_link', undefined, owned.companyId);
      return;
    }
    if (!this.packageChange) {
      await this.deliverReply(event, PACKAGE_CHANGE_UNAVAILABLE_REPLY[replyLanguage(event)]);
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
    await this.deliverReply(event, PACKAGE_CHANGE_ACCEPTED_REPLY[replyLanguage(event)]);
    await this.updateEventLog(event.webhookEventId, 'package_change_requested', undefined, owned.companyId);
  }

  /** §3.6 day-7 nudge. "ใส่เลย" gets the settings link (the delivery seam turns it into one tap). */
  private async handleProfileGuardAnswer(
    event: LineTextEvent,
    userId: string,
    accepted: boolean,
  ): Promise<void> {
    if (!accepted) {
      await this.deliverReply(event, PROFILE_GUARD_LATER_REPLY[replyLanguage(event)]);
      await this.updateEventLog(event.webhookEventId, 'profile_guard_declined');
      return;
    }
    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { userId, status: 'ACTIVE', company: { status: 'ACTIVE' } },
      orderBy: { createdAt: 'asc' },
      select: { companyId: true },
    });
    if (!membership) {
      await this.deliverReply(event, UNLINKED_REPLY[replyLanguage(event)]);
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
    await this.deliverReply(event, `${PROFILE_GUARD_ACCEPTED_REPLY[replyLanguage(event)]}\n${link}`);
    await this.updateEventLog(event.webhookEventId, 'profile_guard_accepted', undefined, membership.companyId);
  }

  /**
   * S-4 beat two (spec §5.4, J3.2/J3.4). The button carries its action and opaque previewId. The
   * server loads that exact chat-bound proposal, then rechecks its record, permissions and current
   * revision before confirming or cancelling it.
   *
   * Every outcome is an honest sentence: applied names what changed and links the record, a moved
   * record says so and drops the proposal, a confirmed record gets the `mutation_blocked` copy
   * rather than "out of scope", and an expired or foreign preview is simply "not found".
   */
  private async handlePackagePurchase(event: LineTextEvent, userId: string, requestId: string): Promise<boolean> {
    if (!this.packagePurchases) return false;
    const explicit = isPackagePurchaseIntent(event.messageText), control = event.packagePurchaseControl;
    const continuation = isPackagePurchaseAnswer(event.messageText);
    if (!explicit && !control && !continuation) return false;
    if (event.channelKind === 'GROUP' || event.channelKind === 'ROOM' || event.pushTargetId && event.pushTargetId !== event.lineUserId) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "Please continue in a private chat." : 'กรุณาทำรายการในแชตส่วนตัวค่ะ')); return true;
    }
    const current = await this.prisma.client.lineCompanyContext.findUnique({ where: { lineUserId: event.lineUserId }, select: { companyId: true } });
    const memberships = await this.listLineCompanies(userId);
    const selected = current?.companyId ? memberships.find(m => m.companyId === current.companyId) : memberships.length === 1 ? memberships[0] : undefined;
    if (!selected) {
      if (!explicit && !control) return false;
      await this.deliverRequiredMessages(event, memberships.length ? [buildCompanyPickerMessage(memberships.map(membership => companyPickerItem(membership, replyLanguage(event))), undefined, undefined, replyLanguage(event)),
        { type: 'text', text: (replyLanguage(event) === 'en' ? "Choose your shop, then tell me the package you want." : 'เลือกร้านแล้วบอกแพ็กเกจที่ต้องการอีกครั้งค่ะ') }] : [{ type: 'text', text: (replyLanguage(event) === 'en' ? `Ask ${'shop owner'} or ${'administrator'} with package-management access to buy the package.` : `ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือ${THAI_SYSTEM_ROLE_NAMES.ADMIN}ที่มีสิทธิ์จัดการแพ็กเกจเป็นผู้ซื้อค่ะ`) }]);
      await this.updateEventLog(event.webhookEventId, memberships.length ? 'needs_company_selection' : 'package_purchase_denied');
      return true;
    }
    let access: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>;
    try { access = await this.permissionResolver.resolveAccess(userId, selected.companyId); }
    catch { await this.deliverReply(event, (replyLanguage(event) === 'en' ? `Ask ${'shop owner'} or ${'administrator'} with package-management access to buy the package.` : `ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือ${THAI_SYSTEM_ROLE_NAMES.ADMIN}ที่มีสิทธิ์จัดการแพ็กเกจเป็นผู้ซื้อค่ะ`)); return true; }
    const ctx: RequestContext = { requestId, authSubject: userId, authProvider: 'line', userId, companyId: selected.companyId,
      membershipId: access.membershipId, roles: access.roles, permissions: access.permissions, scopes: access.scopes };
    if (!explicit && !control && !await this.packagePurchases.accepts(ctx, chatKeyHashOf(event), event.messageText)) return false;
    event.handoff = { userId, companyId: ctx.companyId };
    if (await this.refusePendingLegalAcceptance(event, userId, ctx.companyId, ctx.membershipId)) return true;
    const entitled = await loadEntitledFeatureKeys(this.prisma, ctx.companyId);
    this.deliveryAccess.set(event, { userId, companyId: ctx.companyId, membershipId: ctx.membershipId,
      fingerprint: resolvedLineDeliveryAccessFingerprint(userId, ctx.companyId, access, entitled), allowDuringSupportPause: !!control || staffMenuCommand(event.messageText) === 'package_change' });
    await this.bindConversation(event);
    if (control?.action === 'package_purchase_confirm') {
      const plan = await this.prisma.client.lineDeliveryPlan.findFirst({ where: { companyId: ctx.companyId, userId,
        planJson: { path: ['control', 'token'], equals: control.token } }, select: { status: true, planJson: true } });
      if (plan && (plan.status !== 'ACCEPTED' || !parseLineDeliveryPlan(plan.planJson))) {
        await this.deliverReply(event, (replyLanguage(event) === 'en' ? "Please read the full proposal before creating the payment link." : 'ยังสร้างลิงก์ไม่ได้ค่ะ กรุณาอ่านรายละเอียดการ์ดให้ครบก่อน')); return true;
      }
    }
    const result: Awaited<ReturnType<LinePackagePurchaseService['prepare']>> = control ? await this.packagePurchases.apply(ctx, chatKeyHashOf(event), control, replyLanguage(event))
      : await this.packagePurchases.prepare(ctx, chatKeyHashOf(event), event.messageText, replyLanguage(event));
    if (result.view) this.deliveryPackagePurchases.set(event, { context: ctx, view: result.view });
    const purchaseMessage: LineReplyMessage = result.view ? buildPackagePurchaseCard(result.view, replyLanguage(event)) : result.choices?.length
      ? buildLineAssistantTextCardMessage(result.reply, this.config.webBaseUrl, ctx.companyId, undefined, undefined, replyLanguage(event)) : { type: 'text', text: result.reply };
    if (result.choices?.length) purchaseMessage.quickReply = lineChoiceQuickReply(result.choices);
    await this.deliverRequiredMessages(event, [purchaseMessage]);
    await this.updateEventLog(event.webhookEventId, result.view?.payment ? 'package_purchase_link' : result.view ? 'package_purchase_preview' : 'package_purchase_answer', undefined, ctx.companyId);
    return true;
  }

  private async handleExpenseActionPostback(event: LineTextEvent, ctx: RequestContext, features: Set<string> | null): Promise<void> {
    if (!event.expenseActionControl || event.channelKind === 'GROUP' || event.channelKind === 'ROOM'
      || event.pushTargetId && event.pushTargetId !== event.lineUserId) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "Please continue in a private chat." : 'กรุณาทำรายการในแชตส่วนตัวค่ะ')); return;
    }
    if (!event.expenseActionControl.token.startsWith('team_') && features !== null && !features.has('expenses')) { await this.deliverReply(event, (replyLanguage(event) === 'en' ? "This feature is not included in your current package." : 'แพ็กเกจที่ใช้อยู่ยังไม่มีเรื่องนี้ค่ะ')); return; }
    const control = event.expenseActionControl;
    if (control.action === 'expense_action_confirm') {
      const plan = await this.prisma.client.lineDeliveryPlan.findFirst({ where: { companyId: ctx.companyId, userId: ctx.userId,
        planJson: { path: ['control', 'token'], equals: control.token } }, select: { status: true, planJson: true } });
      if (plan && (plan.status !== 'ACCEPTED' || !parseLineDeliveryPlan(plan.planJson))) {
        if (control.token.startsWith('sub_') && this.substituteActions) {
          await this.deliverRequiredMessages(event, [buildSubstituteReceiptActionCard(this.substituteActions.webHandoff(ctx, replyLanguage(event)), undefined, undefined, replyLanguage(event))]); return;
        }
        await this.deliverReply(event, (replyLanguage(event) === 'en' ? "Please read the full proposal before confirming." : 'ยังยืนยันไม่ได้ค่ะ กรุณาอ่านรายละเอียดการ์ดให้ครบก่อน')); return;
      }
    }
    if (control.token.startsWith('sub_')) {
      const result = await this.substituteActions?.apply(ctx, chatKeyHashOf(event), control, replyLanguage(event));
      let reply = result?.reply ?? (replyLanguage(event) === 'en' ? "This step could not be completed; please try again." : 'ยังดำเนินการไม่ได้ค่ะ กรุณาลองใหม่อีกครั้ง');
      if (result?.expenseId) {
        if (result.preview) this.deliverySubstituteActions.set(event, { context: ctx, preview: result.preview, applied: true });
        const next = await this.substituteActions?.prepare(ctx, chatKeyHashOf(event), result.expenseId, replyLanguage(event));
        if (next?.preview) {
          this.deliverySubstituteActions.set(event, { context: ctx, preview: next.preview });
          if (next.preview.webOnly) reply = next.preview.summary;
        }
        else if (next?.reply && !reply.includes(next.reply)) reply += `\n${next.reply}`;
        const waiting = await this.ledger?.openWaitingUser(ctx.companyId, mediaChatKey(event), ctx.userId) ?? [];
        const resolved = waiting.filter(item => {
          if (item.clarifyForIntent !== 'SUBSTITUTE_RECEIPT_CONTINUATION') return false;
          if (item.candidateExpenseIds?.includes(result.expenseId!)) return true;
          try { return (JSON.parse(item.entry.sourceContext ?? '{}') as LineClarificationSource).substitute
            ?.some(proof => proof?.records.some(record => record.id === result.expenseId)); } catch { return false; }
        }).map(item => item.id);
        await this.consumeClarifications(ctx.companyId, mediaChatKey(event), ctx.userId, waiting, resolved, 'business_answer');
      }
      if (result?.expenseId) await this.deliverCompletedReply(event, reply, ctx.companyId, ctx);
      else if (result?.preview?.webOnly) await this.deliverRequiredMessages(event, [buildSubstituteReceiptActionCard(result.preview, undefined, undefined, replyLanguage(event))]);
      else await this.deliverReply(event, reply);
      await this.updateEventLog(event.webhookEventId, 'substitute_action_result', undefined, ctx.companyId);
      return;
    }
    const result = await this.expenseActions.apply(ctx, chatKeyHashOf(event), control, replyLanguage(event));
    // LINE can issue distinct events for the same action. Business idempotency already rechecked
    // permission/revision; skip its second card only when LINE accepted this recipient's exact result.
    if (control.action === 'expense_action_confirm' && result.status === 'replayed') {
      const accepted = await this.prisma.client.lineDeliveryPlan.findFirst({ where: {
        companyId: ctx.companyId, userId: ctx.userId, status: 'ACCEPTED', acceptedAt: { not: null },
        AND: [
          { planJson: { path: ['authorization', 'actor', 'chatKeyHash'], equals: chatKeyHashOf(event) } },
          { planJson: { path: ['authorization', 'actor', 'channelId'], equals: event.messagingChannelId ?? '' } },
          { planJson: { path: ['authorization', 'actor', 'recipientHash'], equals: lineDeliveryRecipientHash(event.lineUserId, event.pushTargetId ?? event.lineUserId, event.messagingChannelId ?? '') } },
          { planJson: { path: ['authorization', 'proofs'], array_contains: [{ kind: 'EXPENSE_ACTION_PREVIEW', applied: true,
            token: result.preview.token, previewHash: deliveryHash(result.preview) }] } },
        ],
      }, select: { id: true } });
      if (accepted) {
        await this.updateEventLog(event.webhookEventId, 'expense_action_duplicate', undefined, ctx.companyId);
        this.intentionalNoReplyTurns.add(event);
        return;
      }
    }
    if ('preview' in result) this.deliveryExpenseActions.set(event, { context: ctx, chat: chatKeyHashOf(event), requestId: ctx.requestId, preview: result.preview, applied: result.status !== 'prepared' });
    if ((result.status === 'applied' || result.status === 'replayed') && result.expenseIds?.length)
      await this.expenseSequenceTask(event, result.expenseIds, result.preview.action);
    const choices = await this.expenseActions.repairChoices?.(ctx, chatKeyHashOf(event), undefined, replyLanguage(event)) ?? expenseActionNextStepChoices(result.reply);
    let nextCard: LineReplyMessage | undefined;
    const nextItems = lineChoiceQuickReply(choices).items;
    if (result.status === 'blocked' && result.webPath && result.webLabel) {
      const uri = absoluteWebLink(this.config.webBaseUrl, result.webPath);
      if (uri.startsWith('https://')) nextCard = { type: 'text', text: result.reply,
        quickReply: { items: [{ type: 'action', action: { type: 'uri', label: result.webLabel, uri } }] } };
    }
    if (result.status === 'blocked' && !nextItems.length && !nextCard) {
      const records = await this.expenseActions.quoteRecords?.(ctx, chatKeyHashOf(event), control.token);
      const record = records?.length === 1 && records[0]?.tool === 'expense.get_detail' ? records[0] : undefined;
      const uri = record ? absoluteWebLink(this.config.webBaseUrl, `/companies/${ctx.companyId}/expenses/${record.id}`) : '';
      if (uri.startsWith('https://')) nextCard = buildLineSystemTextCardMessage({ ...({ text: `${result.reply}\n${uri}`,
        header: { lines: [(replyLanguage(event) === 'en' ? "Expense" : 'รายการค่าใช้จ่าย'), (replyLanguage(event) === 'en' ? "Next step" : 'ขั้นตอนถัดไป')] }, webBaseUrl: this.config.webBaseUrl, companyId: ctx.companyId, linkLabel: (replyLanguage(event) === 'en' ? "Review record" : 'เปิดตรวจรายการ') }), language: replyLanguage(event) })
        ?? buildLineAssistantTextCardMessage(`${result.reply}\n${uri}`, this.config.webBaseUrl, ctx.companyId, undefined, undefined, replyLanguage(event));
    }
    await this.deliverRequiredMessages(event, ['preview' in result ? buildExpenseActionCard(result.preview, result.status === 'prepared' ? undefined : result.reply, replyLanguage(event), this.config?.webBaseUrl) : nextCard ?? { type: 'text', text: result.reply,
      ...(nextItems.length ? { quickReply: { items: nextItems } } : {}) }]);
    await this.updateEventLog(event.webhookEventId, `expense_action_${result.status}`, undefined, ctx.companyId);
  }

  private async handleExpensePaymentText(event: LineTextEvent, ctx: RequestContext, features: Set<string> | null,
    conversation?: LineAiConversationContext): Promise<boolean> {
    const text = event.messageText.trim();
    const amountOnly = /^[\d๐-๙]+(?:,[\d๐-๙]{3})*(?:\.[\d๐-๙]{1,2})?(?:\s*บาท)?$/u.test(text);
    if (!this.expenseRepo || (!amountOnly && !/^(?:จ่ายแล้ว|โอนแล้ว|บันทึกจ่าย)(?:\s*(?:ค่ะ|ครับ|คะ|ให้หน่อย|รายการนี้))*$/u.test(text))) return false;
    if (features && !features.has('expenses')) { await this.deliverReply(event, EXPENSE_FEATURE_DISABLED_REPLY[replyLanguage(event)]); return true; }
    const expenseTools = ['expense.get_detail', 'expense.list_recent', 'expense.list_substitute_receipts_to_sign'];
    const quoted = conversation?.quotedRecords;
    const shown = conversation?.recentReads?.find(read => expenseTools.includes(read.tool))?.shownItems?.filter(item => !item.kind);
    const targets = quoted?.length ? quoted.filter(record => expenseTools.includes(record.tool))
      : shown?.length ? shown : (await this.expenseRepo.listRecentLineCaptures({ companyId: ctx.companyId, createdByUserId: ctx.userId,
        chatKeyHash: chatKeyHashOf(event), since: new Date(Date.now() - 2 * 60 * 60_000), scopes: ctx.scopes ?? {}, take: 5, includeAllStatuses: true }))
        .filter(record => record.sourceDocumentType !== 'TRANSFER_SLIP');
    const ids = [...new Set(targets.map(record => record.id))];
    if (amountOnly) {
      if (ids.length !== 1) return false;
      const expense = await new GetExpenseUseCase(this.expenseRepo).execute(ctx, ids[0]!).catch(error => {
        if (error instanceof HttpException) return null;
        throw error;
      });
      const reply = expense && paidExpenseReply(expense);
      if (!reply) return false;
      this.rememberReceiptDeliverySource(event, ctx, expense);
      await this.deliverRequiredMessages(event, [{ type: 'text', text: reply }]);
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, ctx.companyId);
      return true;
    }
    const result = ids.length === 1 ? await this.expenseActions.preview(ctx, chatKeyHashOf(event), { action: 'RECORD_PAYMENT', expenseId: ids[0] }, undefined, undefined, replyLanguage(event))
      : { reply: (replyLanguage(event) === 'en' ? "Which expense would you like to record payment for?" : 'ต้องการบันทึกจ่ายรายการไหนคะ') };
    if (result.preview) this.deliveryExpenseActions.set(event, { context: ctx, chat: chatKeyHashOf(event), requestId: ctx.requestId, preview: result.preview });
    const choices = await this.expenseActions.repairChoices(ctx, chatKeyHashOf(event), ctx.requestId, replyLanguage(event)) ?? expenseActionNextStepChoices(result.reply);
    await this.deliverRequiredMessages(event, [result.preview ? buildExpenseActionCard(result.preview, undefined, replyLanguage(event), this.config?.webBaseUrl) : { type: 'text', text: result.reply,
      ...(choices.length ? { quickReply: lineChoiceQuickReply(choices) } : {}) }]);
    await this.updateEventLog(event.webhookEventId, result.preview ? 'expense_action_prepared' : 'clarification_required', undefined, ctx.companyId);
    return true;
  }

  /** Short follow-ups bind to server-proved chat locators after the existing metered intake. */
  private async handleClaimSubmitText(event: LineTextEvent, ctx: RequestContext, features: Set<string> | null,
    conversation?: LineAiConversationContext): Promise<boolean> {
    if (!/^(?:ส่งอนุมัติ|ส่งเลย|ยื่นเลย|ส่งใบเบิกนี้|submit\s+it)(?:\s*(?:ค่ะ|คะ|ครับ|ให้หน่อย))*[.!]?$/iu.test(event.messageText.trim())) return false;
    const tools = ['reimbursement.get_summary', 'reimbursement.get_detail', 'reimbursement.list_pending_approvals', 'reimbursement.get_approval_backlog'];
    const quoted = conversation?.quotedRecords;
    const latest = conversation?.recentReads?.[0];
    const targets = quoted?.length ? quoted.filter(record => tools.includes(record.tool))
      : latest && tools.includes(latest.tool) ? latest.shownItems ?? [] : [];
    if (!targets.length) return false;
    const language = replyLanguage(event), en = language === 'en';
    if (features && !features.has('expenses')) { await this.deliverReply(event, EXPENSE_FEATURE_DISABLED_REPLY[language]); return true; }
    const ids = [...new Set(targets.map(record => record.id))];
    const result = ids.length === 1 ? await this.expenseActions.preview(ctx, chatKeyHashOf(event),
      { action: 'REIMBURSEMENT_SUBMIT', reimbursementId: ids[0] }, true, undefined, language)
      : { reply: en ? 'Which claim would you like to submit?' : 'ต้องการส่งอนุมัติใบเบิกไหนคะ' };
    if (result.preview) this.deliveryExpenseActions.set(event, { context: ctx, chat: chatKeyHashOf(event), requestId: ctx.requestId, preview: result.preview });
    const web = ids.length === 1 ? absoluteWebLink(this.config.webBaseUrl, result.webPath ?? `/companies/${ctx.companyId}/reimbursements/${ids[0]}`) : undefined;
    await this.deliverRequiredMessages(event, [result.preview ? buildExpenseActionCard(result.preview, undefined, language, this.config.webBaseUrl)
      : { type: 'text', text: result.reply, ...(web?.startsWith('https://') ? { quickReply: { items: [{ type: 'action', action: { type: 'uri', label: result.webLabel ?? (en ? 'Open claim' : 'เปิดใบเบิก'), uri: web } }] } } : {}) }]);
    await this.updateEventLog(event.webhookEventId, result.preview ? 'expense_action_prepared' : 'clarification_required', undefined, ctx.companyId);
    return true;
  }

  private async handleDraftUpdatePostback(
    event: LineTextEvent,
    ctx: RequestContext,
    access: { permissions: string[]; roles: string[] },
    confirm: boolean,
  ): Promise<void> {
    const chatKeyHash = chatKeyHashOf(event);
    // A tap on a proposal's button carries no typed words to head a reply, and needs none: every
    // answer to it is the edit's own card (design lock context 4), here "nothing was changed".
    const unchanged = (reply: string) => buildDraftUpdateOutcomeCard('unchanged', reply, this.config.webBaseUrl, ctx.companyId);
    if (!this.draftUpdate?.enabled) {
      await this.deliverReply(event, DRAFT_UPDATE_EXPIRED_REPLY, undefined, unchanged(DRAFT_UPDATE_EXPIRED_REPLY));
      await this.updateEventLog(event.webhookEventId, 'draft_update_disabled', undefined, ctx.companyId);
      return;
    }
    if (!event.draftUpdatePreviewId) {
      await this.deliverReply(event, DRAFT_UPDATE_EXPIRED_REPLY, undefined, unchanged(DRAFT_UPDATE_EXPIRED_REPLY));
      await this.updateEventLog(event.webhookEventId, 'draft_update_expired', undefined, ctx.companyId);
      return;
    }
    if (!confirm) {
      const cancelled = await this.draftUpdate.cancel(ctx, chatKeyHash, event.draftUpdatePreviewId) === 'cancelled';
      const cancelReply = cancelled ? DRAFT_UPDATE_CANCELLED_REPLY : DRAFT_UPDATE_EXPIRED_REPLY;
      await this.deliverCompletedReply(event, cancelReply, ctx.companyId, access, undefined,
        buildDraftUpdateOutcomeCard(cancelled ? 'cancelled' : 'unchanged', cancelReply, this.config.webBaseUrl, ctx.companyId));
      await this.updateEventLog(event.webhookEventId, 'draft_update_cancelled', undefined, ctx.companyId);
      return;
    }

    const v2Preview = await this.prisma.client.lineDeliveryPlan.findFirst({ where: { companyId: ctx.companyId, userId: ctx.userId,
      planJson: { path: ['control', 'previewId'], equals: event.draftUpdatePreviewId } }, select: { status: true, planJson: true } });
    if (v2Preview && (v2Preview.status !== 'ACCEPTED' || !parseLineDeliveryPlan(v2Preview.planJson))) {
      const pending = (replyLanguage(event) === 'en' ? "Please read the rest of the proposed changes before confirming." : 'ยังยืนยันไม่ได้ค่ะ รายละเอียดคำขอแก้ไขยังส่งไม่ครบ กรุณารอหรืออ่านส่วนที่เหลือก่อน');
      await this.deliverReply(event, pending, undefined, unchanged(pending));
      await this.updateEventLog(event.webhookEventId, 'draft_update_blocked', 'PREVIEW_NOT_FULLY_DELIVERED', ctx.companyId);
      return;
    }
    const outcome = await this.draftUpdate.apply(ctx, chatKeyHash, event.webhookEventId, event.draftUpdatePreviewId);
    let reply: string;
    let status = 'completed';
    // The header of the reply's card says what really became of the edit.
    const cardState = outcome.status === 'applied' ? 'applied' as const : outcome.status === 'blocked' ? draftUpdateBlockedState(outcome.reason) : 'unchanged' as const;
    if (outcome.status === 'applied') {
      this.deliveryDraftPreviews.set(event, { context: ctx, chatKeyHash, requestId: ctx.requestId, previewId: outcome.preview.previewId, phase: 'APPLIED' });
      const applied = draftUpdateAppliedReply(this.config.webBaseUrl, ctx.companyId, outcome.expenseId, outcome.preview, outcome.vendorCounterpartyAutoSave, replyLanguage(event));
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
      reply = draftUpdateBlockedReply(outcome.reason, this.config.webBaseUrl, ctx.companyId, outcome.expenseId, replyLanguage(event));
      status = outcome.reason === 'forbidden' ? 'forbidden' : 'draft_update_blocked';
    }
    const repaired = outcome.status === 'applied'
      ? await this.expenseActions?.afterRepairEdit?.(ctx, chatKeyHash, outcome.preview.previewId, outcome.expenseId) : null;
    if (!repaired && outcome.status === 'applied') {
      const confirmation = await this.expenseActions?.preview(ctx, chatKeyHash, { action: 'CONFIRM', expenseId: outcome.expenseId }, true, undefined, replyLanguage(event));
      if (confirmation?.preview) {
        this.deliveryExpenseActions.set(event, { context: ctx, chat: chatKeyHash, requestId: ctx.requestId, preview: confirmation.preview });
        await this.deliverRequiredMessages(event, [buildDraftUpdateOutcomeCard(cardState, reply, this.config.webBaseUrl, ctx.companyId, confirmation.preview) ?? { type: 'text', text: reply }]);
      } else await this.deliverCompletedReply(event, reply, ctx.companyId, access, undefined, buildDraftUpdateOutcomeCard(cardState, reply, this.config.webBaseUrl, ctx.companyId));
    } else if (repaired?.preview) {
      this.deliveryExpenseActions.set(event, { context: ctx, chat: chatKeyHash, requestId: ctx.requestId, preview: repaired.preview });
      const outcomeCard = buildDraftUpdateOutcomeCard(cardState, reply, this.config.webBaseUrl, ctx.companyId);
      await this.deliverRequiredMessages(event, [outcomeCard ?? { type: 'text', text: reply }, buildExpenseActionCard(repaired.preview, undefined, replyLanguage(event), this.config?.webBaseUrl)]);
    } else {
      if (repaired) reply = `${reply}\n${repaired.reply}`;
      const choices = repaired ? await this.expenseActions.repairChoices(ctx, chatKeyHash, undefined, replyLanguage(event)) : null;
      if (choices?.length) await this.deliverReply(event, reply, lineChoiceQuickReply(choices));
      else await this.deliverCompletedReply(event, reply, ctx.companyId, access, undefined,
        buildDraftUpdateOutcomeCard(cardState, reply, this.config.webBaseUrl, ctx.companyId));
    }
    await this.persistIntakeTurn({ event,
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
      try {
        await this.deliverRequiredMessages(event, [buildDraftUpdatePreviewCard(outcome.preview, this.config.webBaseUrl, replyLanguage(event))]);
      } catch (error) {
        const savedPlan = this.boundConversations.has(event) && await this.prisma.client.lineTurnOutcome.findUnique({ where: { webhookEventId: event.webhookEventId }, select: { presentationKind: true } });
        if (!savedPlan || savedPlan.presentationKind !== 'delivery_plan_v2') await this.draftUpdate.discardUndeliveredPreview(ctx, chatKeyHashOf(event), outcome.preview.previewId);
        throw error;
      }
      await this.persistIntakeTurn({ event,
        userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizeLineText(event.messageText),
        replyText: outcome.preview.previewId, intent: 'CORRECTION',
      });
      await this.settleWriteLane(event, 'needs_user', (replyLanguage(event) === 'en' ? "Confirm the card to apply the changes, or reply “cancel”." : 'กดยืนยันในบัตรเพื่อแก้รายการ หรือพิมพ์ยกเลิก'));
      await this.updateEventLog(event.webhookEventId, 'draft_update_preview', undefined, ctx.companyId);
      return 'proposed';
    }
    if (outcome.status === 'move_suggestion') {
      const reply = draftUpdateMoveSuggestionReply(outcome.lineNumber, outcome.chargeLabel);
      await this.deliverCompletedReply(event, reply, ctx.companyId, access, undefined,
        buildDraftUpdateOutcomeCard('unchanged', reply, this.config.webBaseUrl, ctx.companyId));
      await this.persistIntakeTurn({ event,
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
    const reply = draftUpdateBlockedReply(outcome.reason, this.config.webBaseUrl, ctx.companyId, outcome.expenseId, replyLanguage(event));
    await this.deliverCompletedReply(event, reply, ctx.companyId, access, undefined,
      buildDraftUpdateOutcomeCard(draftUpdateBlockedState(outcome.reason), reply, this.config.webBaseUrl, ctx.companyId));
    await this.persistIntakeTurn({ event,
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
    language: 'th' | 'en' = lineReplyLanguage(message.type === 'text' ? message.text : message.type === 'flex' ? message.canonicalText ?? message.altText : ''),
  ): Promise<LineReplyMessage> {
    return inheritCompleteLineBusinessAnswerPresentation(message, {
      ...message,
      quickReply: message.quickReply ?? mediaChoiceQuickReply(message.type === 'text' ? message.text : message.type === 'flex' ? message.canonicalText ?? message.altText : '', language) ?? buildStaffCompletionQuickReply({
        permissions: access.permissions,
        entitledFeatureKeys: await loadEntitledFeatureKeys(this.prisma, companyId),
        isOwner: access.roles.includes('OWNER'),
      }, language),
    });
  }

  private async deliverCompletedReply(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; handoff?: LineHandoffRecipient },
    text: string,
    companyId: string,
    access: { permissions: string[]; roles: string[] },
    /** Spec §13: the state badge the reply's own use case chose. Absent renders exactly as before. */
    badge?: string,
    /** This same reply as a card of the locked System OA design, when its builder could draw it whole.
     *  It carries `text` as its canonical text, so the text is still what is stored and what falls back. */
    designed?: LineReplyMessage,
    /** For a reply to a photo or a file: what became of that document (its card's second header line). */
    outcome?: LineSentDocumentOutcome,
  ): Promise<void> {
    const substituteAction = this.deliverySubstituteActions.get(event);
    designed ??= substituteAction ? buildSubstituteReceiptActionCard(substituteAction.preview, substituteAction.applied || text.includes(substituteAction.preview.summary) ? text : `${text}\n\n${substituteAction.preview.summary}`, substituteAction.applied, replyLanguage(event)) : undefined;
    const facts = this.deliverySubstituteContinuations.get(event);
    designed ??= facts ? buildSubstituteReceiptFactsCard(facts, text, replyLanguage(event)) : undefined;
    // Bound chats render the same card production sends (UAT 2026-09-29: the receipt draft reply had
    // become plain text ending in a raw link with ids). A lossless card is a complete presentation, so
    // the delivery plan sends the card itself with this text as its fallback.
    if (!designed && Array.from(text).length > LINE_FLEX_CARD_BODY_MAX_CHARS) {
      return this.deliverCompletedReplies(event, splitLineExpenseDraftReply(text), companyId, access, undefined, outcome);
    }
    // In a bound chat the reply stands on the locked design under the reader's own words; the card from
    // before the design is what a chat that is not bound, or a reply to a photo or a tap, still gets.
    const message = await this.timeStage(event.webhookEventId, 'render', () => this.withCompletionMenu(
      designed ?? this.boundReplyCard(event, text, badge, outcome) ?? buildLineAssistantTextCardMessage(text, this.config.webBaseUrl, companyId, badge, undefined, replyLanguage(event)),
      companyId,
      access, replyLanguage(event)));
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

  private withDraftWebLink(texts: string[], companyId: string, expenseId?: string, language: 'th' | 'en' = 'th'): string[] {
    if (!expenseId) return texts;
    const link = absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`);
    if (texts.some((text) => text.includes(link))) return texts;
    const suffix = `
${language === 'en' ? 'View record' : 'เปิดดูรายการ'}: ${link}`;
    const last = texts.length - 1;
    return texts.map((text, index) => index === last ? `${text}${suffix}` : text);
  }

  private async deliverCompletedReplies(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string; handoff?: LineHandoffRecipient },
    texts: string[],
    companyId: string,
    access: { permissions: string[]; roles: string[] },
    expenseDraft?: LineExpenseDraftCardFacts,
    outcome?: LineSentDocumentOutcome,
  ): Promise<void> {
    if (texts.length === 0 || texts.length > (this.boundConversations.has(event) ? 15 : LINE_MAX_MESSAGES_PER_REPLY)) throw new Error('LINE_EXPENSE_DRAFT_REPLY_PARTS_INVALID');
    const source = this.deliveryReceiptSources.get(event);
    if (!expenseDraft && source?.records.size === 1 && this.expenseRepo) {
      const [id, revision] = [...source.records][0]!;
      const record = await this.expenseRepo.findByIdWithRelations(companyId, id, undefined, source.context.scopes);
      const state = parseLineExpenseDraftContinuation(record?.sourceChannelMetadataJson?.lineExpenseDraftContinuation);
      if (record?.updatedAt?.toISOString() === revision && state?.status === 'OPEN') {
        expenseDraft = expenseDraftCardFacts(id, { textOnly: true, status: record.status, amount: record.grandTotalAmount,
          item: state.items.map(item => item.description).filter(Boolean).join(' · '), sourceDocumentType: record.sourceDocumentType,
          fields: { expenseDate: state.header.expenseDate, vendorName: record.vendorNameSnapshot ?? undefined }, language: replyLanguage(event) });
        if (state.header.businessPurpose?.trim()) expenseDraft.rows.push({ label: replyLanguage(event) === 'en' ? 'Purpose' : 'วัตถุประสงค์', value: state.header.businessPurpose });
        if (state.unresolvedQuestions.length) expenseDraft.notes.push(formatLineExpenseDraftReply({ state, categories: [], language: replyLanguage(event) }).split('\n').at(-1)!);
      }
    }
    // Production's render handles up to one LINE reply's worth of parts; a longer bound answer is
    // split across the plan's batches as lossless text.
    if (this.boundConversations.has(event) && texts.length > LINE_MAX_MESSAGES_PER_REPLY) {
      return this.deliverRequiredMessages(event, texts.map(text => ({ type: 'text' as const, text })));
    }
    const messages = await this.timeStage(event.webhookEventId, 'render', async () => {
      const terminal = texts[texts.length - 1]!;
      const confirmation = expenseDraft && source && this.boundConversations.has(event)
        ? await this.expenseActions?.preview(source.context, chatKeyHashOf(event), { action: 'CONFIRM', expenseId: expenseDraft.expenseId }, true, undefined, replyLanguage(event)) : undefined;
      if (confirmation?.preview) this.deliveryExpenseActions.set(event, { context: source!.context, chat: chatKeyHashOf(event), requestId: source!.context.requestId, preview: confirmation.preview });
      // §10.1: an expense capture terminal that grounded a draft gets the DEDICATED review card; the
      // generic card stays the render for every terminal with no such draft behind it. No switch
      // decides this (owner 2026-09-29): what keeps a reply whole is the rule below — a card is the
      // terminal message only where it holds the whole terminal text, and a longer text is sent as text.
      const terminalCard = (text: string): LineReplyMessage => expenseDraft
        ? buildExpenseDraftReviewCard(text, expenseDraft, this.config.webBaseUrl, companyId, confirmation?.preview, undefined, replyLanguage(event))
          ?? buildExpenseDraftCardMessage(text, expenseDraft, this.config.webBaseUrl, companyId, replyLanguage(event))
        : this.boundReplyCard(event, text, undefined, outcome) ?? buildLineAssistantTextCardMessage(text, this.config.webBaseUrl, companyId, undefined, undefined, replyLanguage(event));
      // Spec §10.1: earlier parts stay lossless text; the terminal part becomes the same Flex card a
      // single completed reply gets, so a multi-part journey never ends in plain text.
      if (Array.from(terminal).length <= LINE_FLEX_CARD_BODY_MAX_CHARS) {
        const parts = texts.slice(0, -1).map((text) => this.buildLosslessTextMessage(text));
        parts.push(await this.withCompletionMenu(terminalCard(terminal), companyId, access, replyLanguage(event)));
        return parts;
      }
      // The terminal text is longer than a Flex body holds. Feeding it to the card would drop everything
      // past the limit, so the canonical text ships INTACT as text and the card is appended after it —
      // and only when a message slot is left. At the cap, five lossless text parts beat a card.
      const parts = texts.map((text) => this.buildLosslessTextMessage(text));
      if (parts.length >= LINE_MAX_MESSAGES_PER_REPLY) {
        parts[parts.length - 1] = await this.withCompletionMenu(parts[parts.length - 1]!, companyId, access, replyLanguage(event));
        return parts;
      }
      parts.push(await this.withCompletionMenu(buildLineSystemTextCardMessage({ ...({ text: MULTIPART_TERMINAL_FLEX_CLOSER,
        header: { lines: [(replyLanguage(event) === 'en' ? "Nong Mangmee" : 'น้องมั่งมี'), (replyLanguage(event) === 'en' ? "Next step" : 'ขั้นตอนถัดไป')] }, webBaseUrl: this.config.webBaseUrl, companyId }), language: replyLanguage(event) })
        ?? buildLineAssistantTextCardMessage(MULTIPART_TERMINAL_FLEX_CLOSER, this.config.webBaseUrl, companyId, undefined, undefined, replyLanguage(event)), companyId, access, replyLanguage(event)));
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
    const mediaNotice = this.pendingMediaNotices?.get(event);
    if (mediaNotice) messages = [...messages, mediaNotice];
    const mixed = this.mixedBusinessQuestions?.get(event);
    if (!mixed || this.intermediateDeliveries.has(event)) {
      const result = await this.timeStage(event.webhookEventId, 'line_delivery', () => this.sendMessages(event, messages));
      if (result === 'ok') this.deliveredTextTurns.add(event);
      return result;
    }
    const businessText = messages.map(message => message.type === 'text' ? message.text : message.type === 'flex' ? message.canonicalText ?? '' : '').join('\n');
    const businessCoverage: NonNullable<LineAiTurnResponse['semanticCoverage']> = mixed.businessIndexes.map(index => ({ index,
      status: mixed.selectionRequired ? 'needs_user' : mixed.businessStatus,
      ...(mixed.selectionRequired ? { question: businessText, reasonCode: 'FINANCIAL_ACTION_SELECTION_REQUIRED' }
        : mixed.businessStatus === 'needs_user' ? { question: businessText.length <= 500 && businessText.trim() ? businessText : (replyLanguage(event) === 'en' ? "Please provide the missing details for this request." : 'กรุณาตอบข้อมูลที่รายการนี้ถามให้ครบ'), reasonCode: 'BUSINESS_INPUT_REQUIRED' } : {}) }));
    const unresolvedDependencies = (item: { dependsOn: number[] }) => item.dependsOn.filter(index =>
      mixed.selectionRequired || mixed.businessStatus !== 'handled' || !mixed.businessIndexes.includes(index));
    const dependentCoverage: NonNullable<LineAiTurnResponse['semanticCoverage']> = mixed.dependentQuestions.map(item => ({ index: item.index,
      status: 'needs_user', reasonCode: 'DEPENDENCY_SOURCE_PENDING',
      question: unresolvedDependencies(item).length === 0
        ? (replyLanguage(event) === 'en' ? `Please ask part ${item.index + 1} again using the newly saved record.` : `กรุณาถามข้อ ${item.index + 1} ต่อโดยอ้างรายการที่เพิ่งบันทึก`)
        : (replyLanguage(event) === 'en' ? `Please finish part ${unresolvedDependencies(item).map(index => index + 1).join(', ')} first, then ask part ${item.index + 1} to continue.` : `กรุณาทำข้อ ${unresolvedDependencies(item).map(index => index + 1).join(', ')} ให้เสร็จก่อน แล้วถามข้อ ${item.index + 1} ต่อ`) }));
    const coverage: NonNullable<LineAiTurnResponse['semanticCoverage']> = [...mixed.coverage, ...businessCoverage, ...dependentCoverage]
      .sort((a, b) => a.index - b.index);
    this.semanticDelivery.set(event, coverage);
    const dependentText = mixed.dependentQuestions.map(item => unresolvedDependencies(item).length === 0
      ? (replyLanguage(event) === 'en' ? `Part ${item.index + 1} “${item.goal}” is waiting for the saved result; ask again using the newly saved record.` : `⏳ ข้อ ${item.index + 1} “${item.goal}” ยังรออ่านจากผลจริงค่ะ กรุณาถามข้อนี้อีกครั้งโดยอ้าง “รายการที่เพิ่งบันทึก”`)
      : (replyLanguage(event) === 'en' ? `Part ${item.index + 1} “${item.goal}” must wait for part ${unresolvedDependencies(item).map(index => index + 1).join(', ')} to finish; this answer has not been generated from unsaved data.` : `⏳ ข้อ ${item.index + 1} “${item.goal}” ต้องรอให้ข้อ ${unresolvedDependencies(item).map(index => index + 1).join(', ')} เสร็จก่อน ระบบยังไม่ได้ตอบข้อนี้จากข้อมูลที่ยังไม่บันทึก`)).join('\n');
    const sideText = [mixed.response.replyText.trim() ? formatLineReply(mixed.response, this.config.webBaseUrl, replyLanguage(event)) : '', dependentText].filter(Boolean).join('\n\n');
    const nextWrite = mixed.orderedWrites?.[1];
    const remainingChoices: LineReplyMessage[] = nextWrite && mixed.businessStatus === 'handled'
      ? [{ type: 'text', text: (replyLanguage(event) === 'en' ? "Continue to the next step when the first record is ready." : 'กดทำขั้นตอนถัดไปเมื่อรายการแรกพร้อมค่ะ'), quickReply: lineChoiceQuickReply([
        { label: replyLanguage(event) === 'en' ? 'Next step' : 'ทำขั้นตอนถัดไป', text: (replyLanguage(event) === 'en' ? `Do part ${nextWrite.index + 1} first` : `ทำข้อ ${nextWrite.index + 1} ก่อน`) },
      ]) }]
      : this.retainedTaskSources?.has(event) && mixed.businessStatus === 'handled' ? await this.remainingTaskChoiceMessages(event) : [];
    const sideMessages: LineReplyMessage[] = splitLineExpenseDraftReply(sideText).filter(Boolean).map(text => ({ type: 'text' as const, text }));
    if (mixed.readChoices?.length && sideMessages.length) sideMessages.at(-1)!.quickReply = lineChoiceQuickReply(mixed.readChoices);
    const combined = [...messages, ...sideMessages, ...remainingChoices];
    const result = await this.timeStage(event.webhookEventId, 'line_delivery', () => this.sendMessages(event, combined));
    if (result === 'ok') this.deliveredTextTurns.add(event);
    if (result === 'ok') {
      await this.settleSemanticTask(event as LineTextEvent, coverage);
      const bound = this.boundConversations.get(event);
      if (bound && mixed.ledgerId) await this.ledger?.ack({ key: ledgerKey(bound.owner.companyId, mediaChatKey(event)), id: mixed.ledgerId,
        companyId: bound.owner.companyId, turnId: mixed.requestId, kind: 'turn' }, 'acked');
    }
    return result;
  }

  /** Cancel or review the one unconfirmed piece of work this chat holds; see `pendingWorkReply`. A cancel is real
   *  (the preview or draft is dropped and its waiting task closed) and the reply says what stays recorded; a
   *  review restates the pending work from the server's own snapshot and writes nothing. */
  private async handlePendingWorkControl(event: LineTextEvent, ctx: RequestContext): Promise<boolean> {
    const bound = this.boundConversations.get(event), reply = pendingWorkReply(event.messageText);
    if (!bound || !reply) return false;
    const chatKeyHash = chatKeyHashOf(event);
    const edit = await this.draftUpdate?.pendingPreview(ctx, chatKeyHash).catch(() => null) ?? null;
    const action = await this.reimbursementDrafts?.active({ ctx, owner: bound.owner, ownerEpoch: bound.epoch }).catch(() => null) ?? null;
    // An expense draft still collecting answers in this chat is pending work too (NAT-12: "เดี๋ยว ๆ
    // ยกเลิกก่อน" after a text-note draft must not be answered "nothing was saved").
    const openDrafts = reply === 'cancel' && this.expenseDraftConversation
      ? (await this.expenseDraftConversation.routeContexts(ctx, chatKeyHash, replyLanguage(event)).catch(() => [])).filter(draft => draft.status === 'OPEN')
      : [];
    // Nothing pending is an ordinary turn; two pending things are the router's to ask about.
    if ([edit, action, ...openDrafts].filter(Boolean).length !== 1) return false;
    let text: string;
    // The pending edit's own states are cards of the locked design; the other pending work keeps its text.
    let editState: Parameters<typeof buildDraftUpdateOutcomeCard>[0] | undefined;
    if (openDrafts.length) {
      const result = await this.expenseDraftConversation!.execute(ctx, { language: replyLanguage(event), messageText: 'ยกเลิก', chatKeyHash,
        webhookEventId: event.webhookEventId, captureHints: { targetExpenseId: openDrafts[0]!.expenseId } });
      if (!result.handled || result.status !== 'CANCELLED') return false;
      await this.closeWaitingWriteTask(bound);
      text = [...result.replyTexts, (replyLanguage(event) === 'en' ? 'The expense draft is retained, unconfirmed and unpaid; delete it on the web if no longer needed.' : 'ร่างนี้ยังบันทึกไว้ (ยังไม่ยืนยัน ยังไม่จ่าย) ถ้าไม่ใช้แล้วลบได้ในเว็บค่ะ'),
        absoluteWebLink(this.config.webBaseUrl, `/companies/${ctx.companyId}/expenses/${openDrafts[0]!.expenseId}`)].join('\n');
    } else if (edit) {
      const link = absoluteWebLink(this.config.webBaseUrl, `/companies/${ctx.companyId}/expenses/${edit.expenseId}`);
      editState = 'unchanged';
      if (reply === 'review') {
        editState = 'preview';
        text = `${draftUpdateCanonicalDiff(edit, replyLanguage(event))}\n\n${replyLanguage(event) === 'en' ? 'No changes have been made; confirm on the card when ready, or cancel.' : 'ยังไม่ได้แก้รายการค่ะ กดยืนยันในบัตรเมื่อพร้อม หรือพิมพ์ยกเลิกได้เลย'}`;
      } else if (await this.draftUpdate!.cancel(ctx, chatKeyHash, edit.previewId) === 'cancelled') {
        await this.closeWaitingWriteTask(bound);
        editState = 'cancelled';
        text = [(replyLanguage(event) === 'en' ? `The edit was cancelled and the existing expense was retained: ${edit.record.vendorName ?? 'This expense'} · Total ${moneyLabel(edit.totalsBefore.grandTotalAmount)} THB` : `ยกเลิกการแก้ไขแล้วค่ะ รายการเดิมไม่เปลี่ยน: ${formatRecordLabel(edit.record)} · ยอดรวม ${moneyLabel(edit.totalsBefore.grandTotalAmount)} บาท`),
          (replyLanguage(event) === 'en' ? 'The expense draft is retained, unconfirmed and unpaid; delete it on the web if no longer needed.' : 'รายการนี้ยังบันทึกเป็นร่างไว้ (ยังไม่ยืนยัน ยังไม่จ่าย) ถ้าไม่ใช้แล้วลบได้ในเว็บค่ะ'), link].join('\n');
      } else text = (replyLanguage(event) === 'en' ? 'This edit expired or the record changed; no edit was applied.' : 'คำขอแก้ไขนี้หมดอายุหรือรายการเปลี่ยนไปแล้วค่ะ ยังไม่ได้แก้ไขรายการ');
    } else {
      const current = await this.reimbursementDrafts.get({ ctx, owner: bound.owner, ownerEpoch: bound.epoch, actionId: action!.id });
      if (reply === 'review') text = current.status === 'preview'
        ? (replyLanguage(event) === 'en' ? `${await this.reimbursementReviewText(ctx, current.preview, replyLanguage(event))}

The claim has not been saved; confirm the card when ready, or reply “cancel”.` : `${await this.reimbursementReviewText(ctx, current.preview, replyLanguage(event))}\n\nยังไม่ได้บันทึกใบเบิกค่ะ กดบันทึกในบัตรเมื่อพร้อม หรือพิมพ์ยกเลิกได้เลย`)
        : (replyLanguage(event) === 'en' ? "The claim draft is incomplete and nothing was saved; send the expense details to continue, or reply “cancel”." : 'ร่างใบเบิกนี้ยังไม่ครบค่ะ ยังไม่ได้บันทึกอะไร บอกบิลหรือข้อมูลที่ต้องการเบิกต่อได้เลย หรือพิมพ์ยกเลิก');
      else {
        const result = current.status === 'preview'
          ? await this.reimbursementDrafts.cancel({ ctx, owner: bound.owner, ownerEpoch: bound.epoch, control: { action: 'reimbursement_draft_cancel',
            actionId: current.preview.actionId, previewRevision: current.preview.previewRevision, confirmationDigest: current.preview.confirmationDigest } })
          : await this.reimbursementDrafts.cancelCollection({ ctx, owner: bound.owner, ownerEpoch: bound.epoch, actionId: action!.id });
        if (result.status === 'cancelled') {
          await this.finishReimbursementTask(bound.owner, bound.epoch, action!.id, false);
          await this.closeWaitingWriteTask(bound);
          text = (replyLanguage(event) === 'en' ? "The claim draft was cancelled without creating a claim or changing records; start again when ready." : 'ยกเลิกร่างใบเบิกนี้แล้วค่ะ ยังไม่ได้สร้างใบเบิกหรือเปลี่ยนรายการใด ถ้าพร้อมแล้วเริ่มใหม่ได้เลย');
        } else text = result.status === 'applied' ? (replyLanguage(event) === 'en' ? "This claim was already saved; review or cancel it on the web." : 'ร่างใบเบิกนี้บันทึกไปแล้วค่ะ จึงยกเลิกจากแชตไม่ได้ ตรวจหรือยกเลิกได้ในเว็บ')
          : (replyLanguage(event) === 'en' ? "This claim draft expired or changed; no claim was created." : 'ร่างใบเบิกนี้หมดอายุหรือเปลี่ยนไปแล้วค่ะ ยังไม่ได้สร้างใบเบิก');
      }
    }
    await this.deliverReply(event, text, undefined, editState && buildDraftUpdateOutcomeCard(editState, text, this.config.webBaseUrl, ctx.companyId));
    await this.persistIntakeTurn({ event, userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: normalizeLineText(event.messageText), replyText: text, intent: reply === 'cancel' ? 'CORRECTION' : 'CLARIFY' });
    await this.updateEventLog(event.webhookEventId, reply === 'cancel' ? 'pending_work_cancelled' : 'pending_work_reviewed', undefined, ctx.companyId);
    return true;
  }

  /** The pending reimbursement preview in words, with each source bill's own shop and document number. */
  private async reimbursementReviewText(ctx: RequestContext, preview: import('../../../reimbursements/application/use-cases/line-reimbursement-draft.use-case').LineReimbursementDraftPreview, language: 'th' | 'en' = 'th'): Promise<string> {
  if (language === 'en') { return ['Claim draft awaiting your confirmation:', ...preview.after.lines.map(line => `• ${line.description} · ${lineDisplayDate(line.incurredDate, language)} · ${moneyLabel(line.amount)} THB`), `Total: ${moneyLabel(preview.after.amount)} THB`, `Reason: ${preview.after.reason}`].join('\n'); }

    const lines = await Promise.all(preview.after.lines.map(async line => {
      const source = line.linkedExpenseId ? await this.expenseRepo?.findById(ctx.companyId, line.linkedExpenseId).catch(() => null) : null;
      return [`• ${source?.vendorNameSnapshot ?? line.description}${source?.vendorDocumentNumber ? ` (${source.vendorDocumentNumber})` : ''}`,
        `  ${line.description} · ${formatReplyDate(line.incurredDate, language) ?? line.incurredDate} · ${moneyLabel(line.amount)} บาท`,
        ...(line.purpose ? [`  วัตถุประสงค์: ${line.purpose}`] : [])].join('\n');
    }));
    return ['ร่างใบเบิกที่รอยืนยัน:', ...lines, `ยอดรวม ${moneyLabel(preview.after.amount)} บาท`, `เหตุผล: ${preview.after.reason}`].join('\n');
  }

  /** Close the one task still waiting on unconfirmed work after that work was cancelled. */
  private async closeWaitingWriteTask(bound: { owner: LineConversationOwner; epoch: number }): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const projection = await this.contextV2.projection(bound.owner);
      if (!projection || projection.lifecycleEpoch !== bound.epoch) return;
      const waiting = projection.tasks.filter(task => ['active', 'waiting_user', 'paused'].includes(task.state)
        && task.subrequests.some(sub => sub.kind === 'write' && ['pending', 'needs_user'].includes(sub.status)));
      if (waiting.length !== 1) return;
      const tasks = projection.tasks.map(task => task !== waiting[0] ? task : { ...task, revision: task.revision + 1, state: 'canceled' as const,
        subrequests: task.subrequests.map(sub => sub.kind === 'write' && ['pending', 'needs_user'].includes(sub.status) ? { ...sub, status: 'unsupported' as const } : sub) });
      if (await this.contextV2.save(bound.owner, projection.stateVersion, bound.epoch, { version: 2, tasks })) return;
    }
  }

  private async handleDocumentQaControl(event: LineTextEvent): Promise<boolean> {
    const text = event.messageText.trim();
    const match = /^\/qa cancel ([A-Za-z0-9_-]{1,128})$/u.exec(text);
    const bound = this.boundConversations.get(event); if ((!match && text !== DOCUMENT_QA_CANCEL_COMMAND && text !== 'Cancel file reading') || !bound) return false;
    // The button words name no job: take this chat's latest read that is still pending. None means the
    // words were ordinary chat, so the turn continues normally.
    const jobId = match ? match[1]! : (await this.prisma.client.lineIntakePendingMedia.findFirst({ where: { companyId: bound.owner.companyId,
      userId: bound.owner.userId, status: 'PENDING', readJobId: { not: null }, ...this.pendingMediaBinding(event) },
      orderBy: { createdAt: 'desc' }, select: { readJobId: true } }))?.readJobId;
    if (!jobId) return false;
    const owner = { ...bound.owner, ownerEpoch: bound.epoch }, job = await this.documentQa.getById(jobId).catch(() => null);
    if (!job || job.companyId !== owner.companyId || job.userId !== owner.userId || job.ownerMembershipId !== owner.membershipId
      || job.ownerEpoch !== owner.ownerEpoch || job.messagingChannelId !== owner.messagingChannelId || job.chatKeyHash !== owner.chatKeyHash) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "This file-reading task is not available in the current chat." : 'ไม่พบงานอ่านไฟล์นี้ในแชตปัจจุบันค่ะ')); return true;
    }
    const canceled = await this.documentQa.cancel(job.id, owner);
    const pending = await this.prisma.client.lineIntakePendingMedia.findMany({ where: { companyId: owner.companyId, userId: owner.userId,
      readJobId: job.id, ...this.pendingMediaBinding(event) }, select: { askedQuestionJson: true } });
    // ANSWER_READY stays immutable. Stopping its pending delivery never rewrites the saved answer.
    await this.prisma.client.lineIntakePendingMedia.updateMany({ where: { companyId: owner.companyId, userId: owner.userId,
      readJobId: job.id, ...this.pendingMediaBinding(event) }, data: { status: 'EXPIRED', revision: { increment: 1 } } });
    for (const row of pending) {
      const webhookEventId = (row.askedQuestionJson as { webhookEventId?: string } | null)?.webhookEventId;
      if (!webhookEventId) continue;
      const outcome = await this.prisma.client.lineTurnOutcome.findUnique({ where: { webhookEventId }, include: { deliveryPlan: true } });
      const plan = parseLineDeliveryPlan(outcome?.deliveryPlan?.planJson);
      if (plan?.authorization.kind === 'PRIVATE' && plan.authorization.actor.ownerEpoch === bound.epoch
        && plan.authorization.actor.chatKeyHash === bound.owner.chatKeyHash
        && plan.authorization.proofs.some(proof => proof.kind === 'LINE_DOCUMENT_QA' && proof.jobId === job.id)) {
        await this.deliveryPlans.cancelPlan(outcome!.deliveryPlan!.id, outcome!.deliveryPlan!.planHash);
      }
    }
    await this.deliverReply(event, canceled ? (replyLanguage(event) === 'en' ? "The file-reading task was cancelled; no expense was created." : 'ยกเลิกงานอ่านไฟล์แล้วค่ะ ยังไม่ได้สร้างรายการ')
      : (replyLanguage(event) === 'en' ? "Pending file-reading replies were stopped; existing records were retained." : 'หยุดการส่งคำตอบอ่านไฟล์ที่ค้างแล้วค่ะ ไม่ได้ย้อนข้อมูลหรือรายการใด'));
    const inventory = await this.restoreDocumentQaTask(event, job.id);
    if (inventory.length) await this.settleSemanticTask(event, inventory.map(item => ({ index: item.index,
      status: item.kind === 'file' ? 'unsupported' as const : 'needs_user' as const,
      reasonCode: item.kind === 'file' ? 'QA_CANCELED_BY_USER' : 'QA_SEPARATE_CLAUSE_PENDING', question: item.goal })));
    await this.updateEventLog(event.webhookEventId, 'document_qa_canceled', undefined, owner.companyId); return true;
  }

  private async deliverDocumentQaProgress(event: LineTextEvent | LineReceiptUploadEvent, jobId: string, text: string): Promise<void> {
    this.intermediateDeliveries.add(event);
    // The tap sends the button's own words; `handleDocumentQaControl` finds this chat's running read.
    await this.deliverRequiredMessages(event, [{ type: 'text', text, quickReply: { items: [{ type: 'action',
      action: { type: 'message', label: replyLanguage(event) === 'en' ? 'Cancel file reading' : DOCUMENT_QA_CANCEL_COMMAND, text: replyLanguage(event) === 'en' ? 'Cancel file reading' : DOCUMENT_QA_CANCEL_COMMAND } }] } }]);
  }

  /** Owner 2026-09-29 ("รหัสไฟล์อะไรออกมาไม่รู้ งง"): the customer reads and sends no ids. Files are named by
   *  order and time, and every button sends the words on it; `handlePendingMediaControl` maps those words
   *  back to the pending rows in this same order (createdAt ascending), so the ids stay server-side. */
  private pendingMediaSelectionMessage(rows: Array<{ attachmentId: string; mimeType?: string | null; createdAt?: Date }>, language: 'th' | 'en' = 'th'): LineReplyMessage {
    const choices = rows.slice(0, 6), a = choices[0], b = choices[1];
    if (language === 'en') return { type: 'text', text: 'The files are stored separately; choose one to continue, replace the earlier file, or keep both, and unselected files will not be read or recorded.', quickReply: { items: [...choices.map((row, i) => ({ type: 'action' as const, action: { type: 'message' as const, label: `Select ${pendingMediaOrderLabel(row, i, false, language)}`, text: `Select ${pendingMediaOrderLabel(row, i, false, language)}` } })), ...(a && b ? ['Replace earlier file', 'Keep both files'].map(text => ({ type: 'action' as const, action: { type: 'message' as const, label: text, text } })) : [])] } };
    const button = (text: string) => ({ type: 'action' as const, action: { type: 'message' as const, label: text, text } });
    return { type: 'text', text: `เก็บไฟล์แต่ละไฟล์แยกกันแล้วค่ะ กรุณาเลือกไฟล์ที่จะทำต่อ หรือระบุว่าไฟล์ใหม่แทนหรือเพิ่มเติมไฟล์เดิม ยังไม่ได้อ่านหรือสร้างรายการจากไฟล์ที่ไม่ได้เลือก\n${choices.map((row, i) => pendingMediaOrderLabel(row, i, true, language)).join('\n')}`,
      quickReply: { items: [
        ...choices.map((row, i) => button(`เลือก${pendingMediaOrderLabel(row, i, undefined, language)}`)),
        ...(a && b ? [button(MEDIA_REPLACE_COMMAND), button(MEDIA_SUPPLEMENT_COMMAND)] : []),
      ] } };
  }

  /** Exact server-rendered controls change only pending attachment selection, never financial records. */
  private async handlePendingMediaControl(event: LineTextEvent): Promise<boolean> {
    const text = event.messageText.trim();
    // Legacy `/media …` quick replies may still sit in a chat; the button words are the current form.
    const legacy = /^\/media (select|replace|supplement) ([A-Za-z0-9_-]{1,128})(?: ([A-Za-z0-9_-]{1,128}))?$/u.exec(text);
    const ordinal = MEDIA_SELECT_COMMAND_PATTERN.exec(text) ?? /^Select (?:Photo|File) ([1-6])$/iu.exec(text);
    const pair = text === MEDIA_REPLACE_COMMAND || text === 'Replace earlier file' ? 'replace' : text === MEDIA_SUPPLEMENT_COMMAND || text === 'Keep both files' ? 'supplement' : undefined;
    const bound = this.boundConversations.get(event); if ((!legacy && !ordinal && !pair) || !bound) return false;
    const where = { companyId: bound.owner.companyId, userId: bound.owner.userId, status: 'PENDING' as const,
      expiresAt: { gt: new Date() }, ...this.pendingMediaBinding(event) };
    const rows = await this.prisma.client.lineIntakePendingMedia.findMany({ where, orderBy: { createdAt: 'asc' }, take: 6 });
    // Button words with nothing pending are ordinary chat, never a control.
    if (!legacy && !rows.length) return false;
    const operation = legacy ? legacy[1]! : ordinal ? 'select' : pair!;
    const firstId = legacy ? legacy[2]! : ordinal ? rows[Number(ordinal[1]) - 1]?.attachmentId ?? '' : rows[0]?.attachmentId ?? '';
    const secondId = legacy ? legacy[3] : pair ? rows[1]?.attachmentId ?? '' : undefined;
    if (operation === 'select' ? secondId !== undefined : !secondId || secondId === firstId) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "Please choose a file using the current file buttons." : 'คำสั่งเลือกไฟล์ไม่ครบค่ะ กรุณาเลือกจากปุ่มของไฟล์ปัจจุบัน')); return true;
    }
    const a = rows.find(row => row.attachmentId === firstId), b = secondId ? rows.find(row => row.attachmentId === secondId) : undefined;
    if (!a || secondId && !b || rows.some(row => row.readJobId)) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "The selected file changed or is already being read; resend the file with your question, as the earlier task was not changed." : 'ไฟล์ที่เลือกเปลี่ยนหรือเริ่มอ่านแล้วค่ะ กรุณาส่งคำถามใหม่พร้อมไฟล์ ยังไม่ได้เปลี่ยนไฟล์ของงานเดิม')); return true;
    }
    const selected = operation === 'replace' ? b! : a, ids = operation === 'supplement' ? [a.attachmentId, b!.attachmentId] : [selected.attachmentId];
    try {
      await this.prisma.client.$transaction(async tx => {
        for (const row of rows) {
          const metadata = row.askedQuestionJson && typeof row.askedQuestionJson === 'object' && !Array.isArray(row.askedQuestionJson) ? row.askedQuestionJson : {};
          const updated = await tx.lineIntakePendingMedia.updateMany({ where: { ...where, id: row.id, revision: row.revision },
            data: { ...(operation === 'replace' && row.id === a.id ? { status: 'EXPIRED' } : {}),
              askedQuestionJson: { ...metadata, selectedForContinuation: row.id === selected.id, selectedAttachmentIds: ids }, revision: { increment: 1 } } });
          if (updated.count !== 1) throw new Error('LINE_PENDING_MEDIA_STALE');
        }
      });
    } catch {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "The file list changed while you were selecting; please choose again, as no file selection was changed." : 'รายการไฟล์เปลี่ยนระหว่างเลือกค่ะ กรุณาเลือกใหม่ ยังไม่ได้เปลี่ยนไฟล์ให้')); return true;
    }
    await this.deliverReply(event, operation === 'supplement' ? (replyLanguage(event) === 'en' ? "Both files are now grouped; send your question, and no expense has been created." : 'เก็บทั้งสองไฟล์เป็นชุดเดียวกันแล้วค่ะ บอกคำถามที่ต้องการให้ช่วยอ่านได้เลย ยังไม่ได้สร้างรายการ')
      : operation === 'replace' ? (replyLanguage(event) === 'en' ? "The new file replaced the earlier file for this reading task; no expense was created." : 'เลือกไฟล์ใหม่แทนไฟล์เดิมแล้วค่ะ ไฟล์เดิมจะไม่ถูกนำไปอ่านในงานนี้ ยังไม่ได้สร้างรายการ')
        : (replyLanguage(event) === 'en' ? "This file is selected; send your question or document task, and no expense has been created." : 'เลือกไฟล์นี้ไว้แล้วค่ะ บอกคำถามหรือประเภทเอกสารที่จะทำต่อได้เลย ยังไม่ได้สร้างรายการ'));
    await this.updateEventLog(event.webhookEventId, 'media_selection_saved', undefined, bound.owner.companyId); return true;
  }

  private async handlePreferenceCommand(event: LineTextEvent, requestId: string): Promise<boolean> {
    const command = parseLinePreferenceCommand(event.messageText); if (!command) return false;
    await this.applyPreferenceCommand(event, requestId, command); return true;
  }

  /** NAT11 (2026-09-30): "ต่อไปตอบสั้น ๆ แบบนี้นะ จำไว้ได้มั้ย" / "ตอนนี้จำอะไรเกี่ยวกับวิธีตอบฉันอยู่บ้าง" / "ลืมเรื่องตอบสั้นไปก่อน" reach
   *  the same owner-bound commands as the exact command words once the router names them. A message that also asks
   *  for business work keeps its normal turn, and nothing is stored from it. */
  private async handleRoutedPreference(event: LineTextEvent, requestId: string, routePlan: LineIntakeRoutePlan): Promise<boolean> {
    const preference = routePlan.status === 'ROUTED' && !this.retainedTaskSources?.has(event)
      ? parseLineAiResponsePreferenceCommand(routePlan.responsePreference) : undefined;
    if (!preference || !this.boundConversations.has(event)
      || !(routePlan.semanticSubrequests ?? []).every(item => ['general', 'help'].includes(item.kind))) return false;
    await this.applyPreferenceCommand(event, requestId, preference); return true;
  }

  /** Runs one explicit preference request — the exact command words, or one the router named (NAT11 2026-09-30) —
   *  through the owner-bound commands. The reply states only what storage confirmed. */
  private async applyPreferenceCommand(event: LineTextEvent, requestId: string, command: LinePreferenceCommand): Promise<void> {
    const bound = this.boundConversations.get(event);
    if (!bound || !this.config.lineAiPreferencesEnabled) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "Saved answer preferences are unavailable in this chat; you can still specify a style for this answer." : 'การจำรูปแบบคำตอบยังไม่เปิดใช้ในแชตนี้ค่ะ คุณยังระบุรูปแบบที่ต้องการสำหรับคำตอบครั้งนี้ได้'));
      await this.updateEventLog(event.webhookEventId, 'preference_unavailable'); return;
    }
    let reply: string, status = 'preference_completed';
    try {
      const current = await this.contextV2.listPreferences(bound.owner);
      if (!current || current.epoch !== bound.epoch) throw new Error('STALE_PREFERENCE_OWNER');
      if (command.kind === 'list') reply = formatLinePreferences(current.values, replyLanguage(event)) + '\n' + lineUiLabel(LINE_PREFERENCE_NOTICE, replyLanguage(event));
      else if (linePreferenceForgetsNothing(command, current.values)) reply = lineUiLabel(LINE_PREFERENCE_NOTHING_TO_FORGET, replyLanguage(event));
      else {
        const applied = await this.contextV2.changePreferences(bound.owner, { requestId: event.webhookEventId, expectedVersion: current.version, epoch: bound.epoch,
          ...(command.kind === 'set' ? { set: command.values } : { delete: command.keys }) });
        if (applied !== 'applied') throw new Error('STALE_PREFERENCE_VERSION');
        await this.audit.log({ companyId: bound.owner.companyId, actorUserId: bound.owner.userId, action: 'ai.line.preference.changed', targetType: 'AiConversation', targetId: bound.id,
          requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { operation: command.kind, fields: command.kind === 'set' ? Object.keys(command.values) : command.keys } });
        reply = linePreferenceChangedText(command, current.values, replyLanguage(event));
      }
    } catch { reply = (replyLanguage(event) === 'en' ? "I could not verify or update saved preferences; I cannot confirm that anything was remembered or deleted." : 'ตอนนี้ตรวจสอบหรือบันทึกความจำไม่ได้ค่ะ ยังยืนยันไม่ได้ว่าระบบจำหรือลบให้แล้ว'); status = 'preference_unavailable'; }
    await this.deliverReply(event, reply); await this.updateEventLog(event.webhookEventId, status, undefined, bound.owner.companyId);
  }

  private async textEvidenceV2(event: LineTextEvent) {
    if (!this.boundConversations.has(event)) return undefined;
    if (event.inputEvidence) {
      const verified = await verifyLineAiInputEvidence(event.inputEvidence, event.messageText);
      if (!verified) throw new Error('LINE_INPUT_EVIDENCE_INVALID');
      return verified;
    }
    const log = await this.prisma.client.lineWebhookEventLog.findUnique({ where: { webhookEventId: event.webhookEventId } });
    if (!log) throw new Error('LINE_INPUT_EVIDENCE_MISSING');
    const created = await createLineAiInputEvidence({ turnKey: deliveryHash(event.webhookEventId), parts: [{ partId: 'part-0',
      eventIdHash: deliveryHash(event.webhookEventId), acceptedAtMs: log.createdAt.getTime(), rawText: event.messageText }] });
    if (!created) throw new Error('LINE_INPUT_EVIDENCE_INVALID');
    event.inputEvidence = created.inputEvidence;
    return created.inputEvidence;
  }

  private async textValueCandidates(event: LineTextEvent, legacyText: string): Promise<LineAiTurnRequest['valueCandidates']> {
    const evidence = await this.textEvidenceV2(event);
    if (!evidence) return computeValueCandidates(legacyText);
    const admittedAt = Math.min(...evidence.parts.map(part => part.acceptedAtMs));
    const todayIso = new Date(admittedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const candidates = await extractValueCandidatesV2(evidence, todayIso);
    if (!candidates) throw new Error('LINE_INPUT_EVIDENCE_INVALID');
    return candidates;
  }

  private async prepareTextGrantV2(event: LineTextEvent, requestId: string, hasImageContent = false): Promise<AiBudgetGrantV2 | undefined> {
    const bound = this.boundConversations.get(event);
    if (!bound) return undefined;
    const stored = this.budgetGrantsV2.get(event); if (stored) return stored;
    const log = await this.prisma.client.lineWebhookEventLog.findUnique({ where: { webhookEventId: event.webhookEventId } });
    if (!log) throw new HttpException({ code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' }, 429);
    const evidence = await this.textEvidenceV2(event);
    if (!evidence) throw new HttpException({ code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' }, 429);
    const claimed = await this.prisma.client.lineWebhookEventLog.updateMany({ where: { id: log.id, OR: [{ companyId: null }, { companyId: bound.owner.companyId }] }, data: { companyId: bound.owner.companyId } });
    if (claimed.count !== 1) throw new HttpException({ code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' }, 429);
    event.inputEvidence = evidence;
    const accepted = evidence.parts.map(part => part.acceptedAtMs), first = Math.min(...accepted), last = Math.max(...accepted);
    const grant = await this.aiGateway.issueLineReliabilityGrant(requestId, { authorityKind: 'webhook_event', authorityId: log.id,
      owner: { kind: 'PRIVATE', owner: bound.owner, epoch: bound.epoch }, turnKey: evidence.turnKey, attemptKey: deliveryHash(['line-turn-v2', event.webhookEventId]),
      inputDigest: evidence.joinedSha256, requestKind: hasImageContent ? 'IMAGE' : 'TEXT', admittedAtMs: first, coalescingExtraMs: Math.min(6000, Math.max(0, last - first)),
      lane: 'public', allowedProfileIds: [hasImageContent ? 'line-intake-image/2' : 'line-intake-text/2'],
      ...(event.admitOverCap ? { admitOverCap: true } : {}) });
    if (!grant) throw new HttpException({ code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' }, 429);
    this.budgetGrantsV2.set(event, grant); return grant;
  }

  private async deliverStructuralCapacityLimit(event: LineTextEvent, route: GovernedLineIntakeRoutePlan, ctx: RequestContext,
    access: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>): Promise<boolean> {
    if (route.status !== 'ROUTED' || route.semanticSubrequests?.length !== 1 || !['help', 'write'].includes(route.semanticSubrequests[0]!.kind)) return false;
    const namedAction = route.howToActionId === 'branch' ? 'BRANCH_CREATE' : route.howToActionId === 'team_member' ? 'EMPLOYEE_CREATE' : undefined;
    // The noun right after the verb names the action: "เพิ่มพนักงาน … สาขาสำนักงานใหญ่" adds an employee, not a branch.
    const verbNoun = /(?:เพิ่ม|สร้าง|\badd\b|\bcreate\b)\s*(?:(?:a|an|new|another|one more)\s+)*(สาขา|branch|พนักงาน|employee|staff member)/iu.exec(event.messageText)?.[1];
    const action = namedAction ?? (!verbNoun ? undefined : /^(?:สาขา|branch)$/iu.test(verbNoun) ? 'BRANCH_CREATE' : 'EMPLOYEE_CREATE');
    if (!action || !access.permissions.includes(action === 'BRANCH_CREATE' ? 'company.branch.manage' : 'access.employee.create')) return false;
    const limit = await this.expenseActions?.teamCapacityReply?.(ctx, action, replyLanguage(event));
    if (!limit) return false;
    const card = buildLineAssistantTextCardMessage(limit, this.config.webBaseUrl, ctx.companyId, undefined, undefined, replyLanguage(event));
    card.quickReply = lineChoiceQuickReply([{ label: replyLanguage(event) === 'en' ? 'Compare packages' : 'เปรียบเทียบแพ็กเกจ', text: replyLanguage(event) === 'en' ? 'Compare packages' : 'ดูแพ็กเกจ' }]);
    await this.deliverCompletedReply(event, limit, ctx.companyId, access, undefined, card);
    await this.updateEventLog(event.webhookEventId, 'package_capacity_limit', undefined, ctx.companyId);
    return true;
  }

  /** Already classified from full input, without reading expense/context repositories. */
  private async deliverPureGeneralV2(event: LineTextEvent, requestId: string, route: GovernedLineIntakeRoutePlan,
    access: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>, features: ReadonlySet<string> | readonly string[] | null,
    candidates: LineAiTurnRequest['valueCandidates'], conversationContext?: LineAiConversationContext): Promise<void> {
    const bound = this.boundConversations.get(event), initial = this.budgetGrantsV2.get(event);
    if (!bound || !initial || !event.inputEvidence || !route.semanticSubrequests?.length) throw new Error('AI_CONTRACT_UNSUPPORTED');
    let grant;
    try { grant = await this.aiGateway.narrowLineReliabilityGrant(initial, 'general', ['line-answer/2']); }
    catch (error) {
      if (!(error instanceof LineAiBudgetDeadlineExceededError)) throw error;
      await this.deliverReply(event, formatRefusal('ai_timeout', undefined, replyLanguage(event)));
      await this.updateEventLog(event.webhookEventId, 'ai_timeout', error.code, bound.owner.companyId);
      return;
    }
    if (!grant) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "I could not finish this answer; please try again." : 'ยังตอบคำถามนี้ไม่สำเร็จในรอบนี้ค่ะ กรุณาลองใหม่อีกครั้ง'));
      await this.updateEventLog(event.webhookEventId, 'provider_unavailable', 'AI_GENERAL_ADMISSION_UNAVAILABLE', bound.owner.companyId);
      return;
    }
    this.budgetGrantsV2.set(event, grant);
    const resumes = route.semanticSubrequests.some(item => item.taskRef);
    if (resumes && !await this.preserveSemanticTask(event, route.semanticSubrequests)) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "The pending task changed; please tell me which current task to continue." : 'งานที่ต้องการทำต่อเปลี่ยนแล้วค่ะ กรุณาระบุงานปัจจุบันอีกครั้ง'));
      await this.updateEventLog(event.webhookEventId, 'clarification_required', 'STALE_TASK_SELECTION', bound.owner.companyId);
      return;
    }
    const request: LineAiTurnRequest = { requestId, webhookEventId: event.webhookEventId,
      userContext: { lineUserId: '[REDACTED]', internalUserId: bound.owner.userId, companyId: bound.owner.companyId,
        membershipId: bound.owner.membershipId, permissions: access.permissions, roles: access.roles, branchIds: access.scopes.branchIds,
        entitledFeatureKeys: features ? [...features] : undefined, locale: replyLanguage(event) === 'en' ? 'en-GB' : 'th-TH', chatKeyHash: bound.owner.chatKeyHash },
      messageText: event.messageText, messagePreviewHash: hashMessagePreview(event.messageText),
      inputEvidence: event.inputEvidence, budgetGrantV2: grant, contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'],
      semanticSubrequests: route.semanticSubrequests, ...await this.reliabilityContext(event),
      ...(candidates ? { valueCandidates: candidates } : {}), intakeIntent: route.intent,
      ...(conversationContext ? { conversationContext } : {}),
      ...(features ? { entitledFeatureKeys: [...features] } : {}),
      ...(route.howToActionId ? { howToActionId: route.howToActionId } : {}),
      ...(this.config.lineAiApprovedKnowledgeEnabled ? { approvedKnowledge: true, selectedKnowledgeCardIds: route.selectedKnowledgeCardIds } : {}) };
    const ledgerId = await this.ledger?.appendTurn({ messagingChannelId: event.messagingChannelId, companyId: bound.owner.companyId,
      chatKey: mediaChatKey(event), turnId: requestId, webhookEventId: event.webhookEventId, userId: bound.owner.userId, text: event.messageText,
      acceptedRequest: { request, ownerEpoch: bound.epoch, conversationId: bound.id, accessFingerprint: this.deliveryAccess.get(event)!.fingerprint } });
    let response: LineAiTurnResponse;
    try { response = await this.aiGateway.requestLineTurn(request);
      const bodyRefusal = knownAiBudgetResponse(response);
      if (bodyRefusal) throw new HttpException(bodyRefusal, 429);
    }
    catch (error) {
      const budget = knownAiBudgetRefusal(error);
      if (budget && await this.answerAiCreditRefusal(event, bound.owner.companyId,
        { budgetErrorCode: budget.code, ...(budget.budgetScope ? { budgetScope: budget.budgetScope } : {}) },
        access.permissions.includes(PLAN_MANAGE_PERMISSION_KEY))) {
        if (ledgerId && this.ledger) await this.ledger.ack({ key: ledgerKey(bound.owner.companyId, mediaChatKey(event)), id: ledgerId, companyId: bound.owner.companyId, turnId: requestId, kind: 'turn' }, 'refused', { reason: budget.code });
        return;
      }
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "I could not finish this answer; please try again." : 'ยังตอบคำถามนี้ไม่สำเร็จค่ะ กรุณาลองใหม่')); await this.updateEventLog(event.webhookEventId, 'provider_unavailable', 'AI_GENERAL_UNAVAILABLE', bound.owner.companyId); return;
    }
    if (response.toolsInvoked.length || !response.semanticCoverage || response.semanticCoverage.length !== route.semanticSubrequests.length) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "I could not verify every part of the answer; please try again." : 'ยังตรวจสอบคำตอบครบทุกส่วนไม่ได้ค่ะ กรุณาลองใหม่'));
      await this.updateEventLog(event.webhookEventId, 'provider_unavailable', 'AI_CONTRACT_UNSUPPORTED', bound.owner.companyId);
      return;
    }
    this.semanticDelivery.set(event, response.semanticCoverage);
    this.deliverySources.set(event, { requestId, ids: [] });
    const turnId = await this.persistTurn(bound.owner.userId, bound.owner.companyId, event.webhookEventId, request.messagePreviewHash,
      event.messageText.slice(0, PREVIEW_MAX_CHARS), response, event);
    await this.updateEventLog(event.webhookEventId, 'response_ready', undefined, bound.owner.companyId);
    // The answer on the locked design, under the reader's own question; its text where the design cannot be drawn.
    const answerText = formatLineReply(response, this.config.webBaseUrl, replyLanguage(event));
    const message = buildDesignedLineAnswerMessage(response, answerText, this.config.webBaseUrl, bound.owner.companyId, event.messageText, replyLanguage(event))
      ?? { type: 'text' as const, text: answerText };
    const quickReply = productHelpQuickReply(response, access.permissions, features === null ? null : new Set(features));
    if (quickReply) message.quickReply = quickReply;
    const delivered = await this.deliverMessages(event, [message]);
    // Same terminal row states as the business-answer path; only COMPLETED/REFUSED rows feed the next turn's context.
    await this.prisma.client.aiTurn.update({ where: { id: turnId }, data: delivered === 'ok'
      ? { status: response.refused ? 'REFUSED' : 'COMPLETED', errorCode: response.errorCode }
      : { status: 'ERROR', errorCode: `LINE_DELIVERY_${delivered.toUpperCase()}` } });
    if (delivered !== 'ok') return;
    if (resumes) await this.settleSemanticTask(event, response.semanticCoverage);
    if (ledgerId) await this.ledger?.ack({ key: ledgerKey(bound.owner.companyId, mediaChatKey(event)), id: ledgerId,
      companyId: bound.owner.companyId, turnId: requestId, kind: 'turn' }, 'acked');
    await this.updateEventLog(event.webhookEventId, 'completed', undefined, bound.owner.companyId);
  }

  /** Independent questions use the same admitted turn; existing API write paths keep all domain guards. */
  private orderedExpenseWrites(inventory: NonNullable<LineAiTurnRequest['semanticSubrequests']>) {
    const writes = inventory.filter(item => item.kind === 'write');
    // The admitted model can name the capture correctly while omitting its optional route enum.
    if (!writes[0]?.writeIntent && /^บันทึก(?:ค่าใช้จ่าย|รายจ่าย|ค่าจ้าง)/u.test(writes[0]?.goal ?? ''))
      writes[0] = { ...writes[0]!, writeIntent: 'EXPENSE_DOCUMENT_CAPTURE' };
    const first = writes[0];
    if (writes.length < 2 || first?.writeIntent !== 'EXPENSE_DOCUMENT_CAPTURE') return undefined;
    // A capture and its following actions share one source object, even when intake omits dependsOn.
    const related = writes.slice(1).every(item => item.dependsOn.some(index => writes.some(parent => parent.index === index && index < item.index))
      || item.evidenceRefs?.length && item.evidenceRefs.every(ref => first.evidenceRefs?.some(source => source.partId === ref.partId
        && source.startUtf16 <= ref.startUtf16 && source.endUtf16 >= ref.endUtf16)));
    if (!related) return undefined;
    const counterparty = writes.find(item => /(?:บันทึก|อัปเดต|เพิ่ม).*(?:ข้อมูลคู่ค้า|ผู้รับเงิน)/u.test(item.goal));
    return counterparty && writes.some(item => /50\s*ทวิ/u.test(item.goal))
      ? [counterparty, ...writes.filter(item => item !== counterparty)] : writes;
  }

  private async prepareMixedBusinessQuestions(event: LineTextEvent, requestId: string, route: GovernedLineIntakeRoutePlan,
    access: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>, features: ReadonlySet<string> | null,
    candidates: LineAiTurnRequest['valueCandidates']): Promise<boolean> {
    const inventory = route.semanticSubrequests, bound = this.boundConversations.get(event), grant = this.budgetGrantsV2.get(event);
    if (!bound || !grant || !event.inputEvidence || !inventory || inventory.length < 2 && !this.retainedTaskSources?.has(event)) return false;
    const writes = inventory.filter(item => item.kind === 'write'), others = inventory.filter(item => item.kind !== 'write');
    if (!writes.length || writes.length === 1 && writes.some(item => !item.writeIntent || !['EXPENSE_DOCUMENT_CAPTURE', 'EXPENSE_DRAFT_CONTINUATION', 'EXPENSE_CAPTURE_CORRECTION', 'SUBSTITUTE_RECEIPT_CONTINUATION'].includes(item.writeIntent))
      || others.some(item => !['general', 'help', 'read', 'public'].includes(item.kind))) return false;
    const blocked = new Set(writes.map(item => item.index));
    for (let changed = true; changed;) {
      changed = false;
      for (const item of others) if (!blocked.has(item.index) && item.dependsOn.some(index => blocked.has(index))) {
        blocked.add(item.index); changed = true;
      }
    }
    const independent = others.filter(item => !blocked.has(item.index));
    const dependent = others.filter(item => blocked.has(item.index));
    const indices = new Map(independent.map((item, index) => [item.index, index]));
    const request: LineAiTurnRequest = { requestId, webhookEventId: event.webhookEventId, userContext: { lineUserId: '[REDACTED]', internalUserId: bound.owner.userId,
      companyId: bound.owner.companyId, membershipId: bound.owner.membershipId, permissions: access.permissions, roles: access.roles,
      branchIds: access.scopes.branchIds, locationIds: access.scopes.locationIds, entitledFeatureKeys: features ? [...features] : undefined,
      locale: replyLanguage(event) === 'en' ? 'en-GB' : 'th-TH', chatKeyHash: bound.owner.chatKeyHash }, messageText: event.messageText, messagePreviewHash: hashMessagePreview(event.messageText),
      inputEvidence: event.inputEvidence, budgetGrantV2: grant, contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'],
      semanticSubrequests: independent.map((item, index) => ({ ...item, index, dependsOn: item.dependsOn.map(dep => indices.get(dep)!).filter(dep => dep !== undefined) })),
      ...await this.reliabilityContext(event), ...(candidates ? { valueCandidates: candidates } : {}),
      intakeIntent: 'BUSINESS_READ_QUESTION', ...(features ? { entitledFeatureKeys: [...features] } : {}),
      ...(route.howToActionId ? { howToActionId: route.howToActionId } : {}),
      ...(this.config.lineAiApprovedKnowledgeEnabled ? { approvedKnowledge: true, selectedKnowledgeCardIds: route.selectedKnowledgeCardIds } : {}) };
    const ledgerId = await this.ledger?.appendTurn({ messagingChannelId: event.messagingChannelId, companyId: bound.owner.companyId,
      chatKey: mediaChatKey(event), turnId: requestId, webhookEventId: event.webhookEventId, userId: bound.owner.userId, text: event.messageText,
      acceptedRequest: { request: { ...request, semanticSubrequests: inventory, intakeIntent: route.intent }, ownerEpoch: bound.epoch,
        conversationId: bound.id, accessFingerprint: this.deliveryAccess.get(event)!.fingerprint } });
    if (writes.length > 1) await this.bindMixedTaskSource(event, requestId);
    let response: LineAiTurnResponse = { replyText: '', requestId, intent: 'unknown', agent: 'general', durationMs: 0,
      toolsInvoked: [], sourceLabels: [], sourceRefs: [], webLinks: [], refused: false, semanticCoverage: [] };
    if (independent.length) try {
      response = await this.aiGateway.requestLineTurn(request);
      if (!parseLineAiSemanticCoverage(response.semanticCoverage, request.semanticSubrequests!) || response.semanticCoverage!.length !== independent.length
        || response.toolsInvoked.some(name => name.startsWith('reimbursement.draft.') || (LINE_DRAFT_UPDATE_TOOLS as readonly string[]).includes(name))) throw new Error('MIXED_COVERAGE_INVALID');
      const evidenceIds = await this.readEvidence.forTurn(request, response);
      if (!evidenceIds) throw new Error('MIXED_READ_EVIDENCE_UNAVAILABLE');
      this.deliverySources.set(event, { requestId, ids: evidenceIds });
    } catch {
      response = { replyText: independent.map(item => (replyLanguage(event) === 'en' ? `${item.goal}: this part could not be answered; please ask it again.` : `${item.goal}: ยังตอบส่วนนี้ไม่สำเร็จค่ะ กรุณาถามส่วนนี้อีกครั้ง`)).join('\n'),
        requestId, intent: 'unknown', agent: 'general', durationMs: 0, toolsInvoked: [], sourceLabels: [], sourceRefs: [], webLinks: [], refused: false,
        semanticCoverage: independent.map((_item, index) => ({ index, status: 'needs_user', reasonCode: 'INDEPENDENT_ANSWER_UNAVAILABLE', question: (replyLanguage(event) === 'en' ? "Please ask this part again." : 'กรุณาถามส่วนนี้อีกครั้ง') })) };
      this.deliverySources.set(event, { requestId, ids: [] });
    } else this.deliverySources.set(event, { requestId, ids: [] });
    const orderedWrites = this.orderedExpenseWrites(inventory);
    const readChoices = (await this.readEvidence.whtReadChoicesForTurn?.(request, response).catch(() => undefined))?.map(choice => ({ ...choice,
      ...(choice.webPath ? { uri: absoluteWebLink(this.config.webBaseUrl, choice.webPath) } : {}) }));
    this.mixedBusinessQuestions.set(event, { requestId, ledgerId, businessIndexes: (orderedWrites ? orderedWrites.slice(0, 1) : writes).map(item => item.index),
      ...(readChoices?.length ? { readChoices } : {}),
      businessStatus: 'needs_user', selectionRequired: writes.length > 1 && !orderedWrites, ...(orderedWrites ? { orderedWrites } : {}),
      dependentQuestions: dependent.map(item => ({ index: item.index, goal: item.goal, dependsOn: item.dependsOn.filter(index => blocked.has(index)) })), response,
      coverage: [...response.semanticCoverage!.map(item => ({ ...item, index: independent[item.index]!.index })),
        ...(orderedWrites?.slice(1).map(item => ({ index: item.index, status: 'needs_user' as const,
          reasonCode: 'DEPENDENCY_SOURCE_PENDING', question: (replyLanguage(event) === 'en' ? "Continue to the next step when the first record is ready." : 'กดทำขั้นตอนถัดไปเมื่อรายการแรกพร้อมค่ะ') })) ?? [])] });
    return true;
  }

  /** References stay in bounded task state; the immutable original input stays in its existing ledger parent. */
  private async bindMixedTaskSource(event: LineTextEvent, requestId: string): Promise<void> {
    const bound = this.boundConversations.get(event), mappings = this.semanticTaskMappings.get(event);
    if (!bound || !mappings?.length) throw new Error('LINE_TASK_SOURCE_MISSING');
    const id = deliveryHash(['line-ledger-v2', bound.owner.companyId, bound.owner.userId, bound.owner.messagingChannelId,
      bound.owner.chatKeyHash, event.webhookEventId, requestId]);
    const row = await this.prisma.client.lineLedgerDelivery.findUnique({ where: { id } });
    const accepted = row && parseAcceptedLedgerRequest(row.acceptedRequestJson, { companyId: bound.owner.companyId,
      userId: bound.owner.userId, webhookEventId: event.webhookEventId, turnId: requestId, chatKey: mediaChatKey(event), messagingChannelId: bound.owner.messagingChannelId });
    if (!accepted || accepted.ownerEpoch !== bound.epoch || accepted.conversationId !== bound.id) throw new Error('LINE_TASK_SOURCE_MISSING');
    for (let attempt = 0; attempt < 2; attempt++) {
      const projection = await this.contextV2.projection(bound.owner);
      if (!projection || projection.lifecycleEpoch !== bound.epoch) throw new Error('LINE_CONTEXT_STALE_EPOCH');
      const tasks = structuredClone(projection.tasks);
      for (const taskId of new Set(mappings.map(mapping => mapping.taskId))) {
        const task = tasks.find(item => item.taskId === taskId);
        if (!task || task.state !== 'active') throw new Error('LINE_CONTEXT_STALE_STATE');
        const selected = mappings.filter(mapping => mapping.taskId === taskId);
        // Resumed actions retain their first original clause, not the selection command in a later turn.
        const locators = task.sourceRevisionLocators ?? [];
        task.sourceRevisionLocators = [...locators, ...selected.filter(mapping => !locators.some(locator => locator.sourceType.startsWith(`LINE_ACCEPTED_TASK_${mapping.subrequestIndex}_`)))
          .map(mapping => ({ sourceType: `LINE_ACCEPTED_TASK_${mapping.subrequestIndex}_${mapping.index}`, sourceId: id, revision: accepted.digest }))];
        if (task.sourceRevisionLocators.length > 8) throw new Error('LINE_TASK_SOURCE_LIMIT');
        const ordered = this.orderedExpenseWrites(accepted.request.semanticSubrequests ?? []);
        if (ordered) task.slots = { ...task.slots, writeOrder: ordered.map(item => item.index).join(',') };
        task.revision++;
      }
      if (await this.contextV2.save(bound.owner, projection.stateVersion, bound.epoch, { version: 2, tasks })) return;
    }
    throw new Error('LINE_CONTEXT_STALE_STATE');
  }

  /** Exact selection controls choose a stored clause; they never import a different owner's text or restart its old budget.
   *  The buttons send their own words ("ทำข้อ 2 ก่อน", "ทำรายการ 1 ต่อ") — never a task id — and the
   *  words map back here to the same waiting clause the button was built from; `/task choose` stays
   *  accepted for a button delivered before that change. */
  private async prepareRetainedTaskSelection(event: LineTextEvent): Promise<boolean> {
    const words = /^ทำ(ข้อ|รายการ) ([1-8]) (?:ก่อน|ต่อ)$/u.exec(event.messageText.trim());
    const more = event.messageText.trim() === (replyLanguage(event) === 'en' ? "Show remaining tasks" : 'ขอดูงานค้างที่เหลือ');
    if (!event.messageText.startsWith('/task choose ') && !words && !more) return false;
    const bound = this.boundConversations.get(event);
    if (!bound) return false;
    this.retainedTaskSources.delete(event);
    let choice: { taskId: string; revision: number; index: number } | undefined;
    const legacy = /^\/task choose ([A-Za-z0-9_-]{1,128}) ([0-9]{1,10}) ([0-7])$/u.exec(event.messageText);
    if (legacy) choice = { taskId: legacy[1]!, revision: Number(legacy[2]), index: Number(legacy[3]) };
    const projection = await this.contextV2.projection(bound.owner).catch(() => null);
    if (words || more) {
      // The same list the buttons were built from, in the same order (remainingTaskChoiceMessages).
      const waiting = (projection?.tasks ?? []).flatMap(task => task.subrequests.flatMap(sub => {
        const locator = sub.kind === 'write' && ['needs_user', 'pending'].includes(sub.status)
          && task.sourceRevisionLocators?.find(item => item.sourceType.startsWith(`LINE_ACCEPTED_TASK_${sub.index}_`));
        return locator ? [{ task, sub, originalIndex: Number(locator.sourceType.split('_').at(-1)) }] : [];
      }));
      // Nothing is waiting to be chosen, so these are ordinary words for the normal route.
      if (!waiting.length) return false;
      if (more) {
        const choices = waiting.slice(4, 8);
        await this.deliverMessages(event, [{ type: 'text', text: (replyLanguage(event) === 'en' ? "Choose a task to continue; I will use the existing details to prepare it for your review." : 'เลือกงานที่จะทำต่อ แล้วน้องใช้รายละเอียดเดิมเตรียมให้ตรวจค่ะ'),
          quickReply: lineChoiceQuickReply((choices.length ? choices : waiting.slice(0, 4)).map(({ sub, originalIndex }) => ({
            label: sub.goal, text: (replyLanguage(event) === 'en' ? `Do part ${originalIndex + 1} first` : `ทำข้อ ${originalIndex + 1} ก่อน`),
          }))) }]);
        return true;
      }
      const number = Number(words?.[2]);
      const picked = words?.[1] === 'ข้อ'
        ? waiting.filter(item => item.originalIndex === number - 1).at(-1)
        : waiting[number - 1];
      if (picked) choice = { taskId: picked.task.taskId, revision: picked.task.revision, index: picked.sub.index };
    }
    try {
      const task = choice && projection?.tasks.find(item => item.taskId === choice!.taskId);
      let localIndex = Number(choice?.index);
      const sub = task?.subrequests.find(item => item.index === localIndex);
      if (!choice || !projection || projection.lifecycleEpoch !== bound.epoch || !task || task.revision !== choice.revision
        || !['waiting_user', 'paused'].includes(task.state) || sub?.kind !== 'write' || !['needs_user', 'pending'].includes(sub.status)) throw new Error('LINE_TASK_STALE_SELECTION');
      let locator = task.sourceRevisionLocators?.find(item => item.sourceType.startsWith(`LINE_ACCEPTED_TASK_${localIndex}_`));
      const originalIndex = Number(locator?.sourceType.split('_').at(-1));
      const row = locator && await this.prisma.client.lineLedgerDelivery.findUnique({ where: { id: locator.sourceId } });
      if (!row || row.companyId !== bound.owner.companyId || row.userId !== bound.owner.userId || row.expiresAt.getTime() <= Date.now()) throw new Error('LINE_TASK_SOURCE_EXPIRED');
      const raw = row.acceptedRequestJson as { request?: { requestId?: string } } | null;
      const accepted = parseAcceptedLedgerRequest(row.acceptedRequestJson, { companyId: bound.owner.companyId, userId: bound.owner.userId,
        webhookEventId: row.webhookEventId, turnId: raw?.request?.requestId ?? '', chatKey: mediaChatKey(event), messagingChannelId: bound.owner.messagingChannelId });
      if (!accepted || accepted.ownerEpoch !== bound.epoch || accepted.conversationId !== bound.id || accepted.digest !== locator!.revision
        || accepted.accessFingerprint !== this.deliveryAccess.get(event)?.fingerprint) throw new Error('LINE_TASK_SOURCE_CHANGED');
      const evidence = accepted.request.inputEvidence!;
      const inventory = parseLineAiSemanticSubrequests(accepted.request.semanticSubrequests, accepted.request.messageText, evidence,
        lineAiReplyClarifications(accepted.request.openClarifications, accepted.request.resolvedClarificationIds));
      let original = inventory?.find(item => item.index === originalIndex);
      if (!original || original.kind !== 'write' || !original.evidenceRefs?.length) throw new Error('LINE_TASK_SOURCE_MISSING');
      const capture = inventory && this.orderedExpenseWrites(inventory)?.find(candidate => task.sourceRevisionLocators?.some(source =>
        source.sourceId === locator!.sourceId && Number(source.sourceType.split('_').at(-1)) === candidate.index
        && task.subrequests.some(sub => sub.index === Number(source.sourceType.split('_').at(-2)) && ['pending', 'needs_user'].includes(sub.status))));
      const captureLocator = capture && task.sourceRevisionLocators?.find(item => item.sourceId === locator!.sourceId
        && Number(item.sourceType.split('_').at(-1)) === capture.index);
      const captureIndex = Number(captureLocator?.sourceType.split('_').at(-2));
      if (capture && captureLocator && task.subrequests.some(item => item.index === captureIndex && ['pending', 'needs_user'].includes(item.status))) {
        original = capture; localIndex = captureIndex; locator = captureLocator;
      }
      if (original.dependsOn.some(dependency => !projection.tasks.some(parent => parent.sourceRevisionLocators?.some(source => {
        const match = /^LINE_ACCEPTED_TASK_([0-7])_([0-7])$/u.exec(source.sourceType);
        return source.sourceId === locator!.sourceId && source.revision === locator!.revision && Number(match?.[2]) === dependency
          && parent.subrequests.find(item => item.index === Number(match?.[1]))?.status === 'handled';
      })))) throw new Error('LINE_TASK_DEPENDENCY_PENDING');
      const refs = original.evidenceRefs!;
      if (inventory!.some(item => item.index !== originalIndex && item.kind === 'write' && item.evidenceRefs?.some(other => refs.some(ref =>
        ref.partId === other.partId && ref.startUtf16 < other.endUtf16 && other.startUtf16 < ref.endUtf16
        // One message may supply shared payee/amount facts for several operations (C05).
        // Containment also covers a confirmation suffix inside its expense capture (E02).
        // Crossing spans remain ambiguous; containment is scoped by the selected goal/intent.
        && !(ref.startUtf16 <= other.startUtf16 && ref.endUtf16 >= other.endUtf16)
        && !(other.startUtf16 <= ref.startUtf16 && other.endUtf16 >= ref.endUtf16))))) throw new Error('LINE_TASK_SOURCE_AMBIGUOUS');
      const sourceText = refs.map(ref => validateLineAiSourceRefV2(ref, evidence)).filter((text): text is string => text !== undefined).join('\n');
      if (!sourceText.trim()) throw new Error('LINE_TASK_SOURCE_MISSING');
      this.retainedTaskSources.set(event, { source: { taskRef: { taskId: task.taskId, taskRevision: task.revision, subrequestIndex: localIndex },
        inputEvidence: evidence, semanticSubrequest: original }, sourceText, operationId: deliveryHash(['line-task-action', bound.id, task.taskId, localIndex]) });
      return false;
    } catch {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "The selected task changed or expired; nothing was applied, so choose a current pending task." : 'งานที่เลือกเปลี่ยนหรือหมดอายุแล้วค่ะ ยังไม่ได้ทำรายการ กรุณาเลือกงานค้างปัจจุบันอีกครั้ง'));
      return true;
    }
  }

  private async expenseSequenceTask(event: LineTextEvent, expenseIds: string[], action?: string): Promise<void> {
    const bound = this.boundConversations.get(event); if (!bound) return;
    const mapping = this.semanticTaskMappings.get(event)?.[0];
    for (let attempt = 0; attempt < 2; attempt++) {
      const projection = await this.contextV2.projection(bound.owner);
      if (!projection || projection.lifecycleEpoch !== bound.epoch) return;
      const tasks = structuredClone(projection.tasks); let changed = false;
      for (const task of tasks) {
        if (!task.slots?.writeOrder) continue;
        let touched = false;
        if (!action && task.taskId === mapping?.taskId && expenseIds.length === 1) {
          task.slots.sequenceExpenseId = expenseIds[0]!; touched = true;
        } else if (typeof task.slots.sequenceExpenseId === 'string' && expenseIds.includes(task.slots.sequenceExpenseId)) {
          for (const sub of task.subrequests) if (sub.kind === 'write'
            && (action === 'CONFIRM' && /^บันทึก(?:ค่าใช้จ่าย|รายจ่าย|ค่าจ้าง)/u.test(sub.goal)
              || action === 'WHT_CERTIFICATE_ISSUE' && /50\s*ทวิ/u.test(sub.goal))) { sub.status = 'handled'; touched = true; }
          task.state = task.subrequests.some(sub => ['pending', 'needs_user'].includes(sub.status)) ? 'waiting_user' : 'completed';
        }
        if (touched) { task.revision++; changed = true; }
      }
      if (!changed || await this.contextV2.save(bound.owner, projection.stateVersion, bound.epoch, { version: 2, tasks })) return;
    }
    throw new Error('LINE_CONTEXT_STALE_STATE');
  }

  private async counterpartyTask(event: LineTextEvent, token: string, completed = false, source?: { id: string; revision: string }): Promise<void> {
    const bound = this.boundConversations.get(event); if (!bound) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      const projection = await this.contextV2.projection(bound.owner);
      if (!projection || projection.lifecycleEpoch !== bound.epoch) return;
      const mappings = completed ? projection.tasks.flatMap(task => task.subrequests.filter(sub =>
        task.slots?.[`counterpartyToken${sub.index}`] === token).map(sub => ({ index: 0, taskId: task.taskId, subrequestIndex: sub.index })))
        : this.semanticTaskMappings.get(event)?.filter(mapping =>
          (this.mixedBusinessQuestions.get(event)?.businessIndexes ?? [mapping.index]).includes(mapping.index));
      if (mappings?.length !== 1) return;
      const tasks = structuredClone(projection.tasks), mapping = mappings[0]!, task = tasks.find(item => item.taskId === mapping.taskId);
      const sub = task?.subrequests.find(item => item.index === mapping.subrequestIndex);
      if (!task || !sub || sub.kind !== 'write') return;
      if (completed) {
        sub.status = 'handled';
        if (source) task.slots = { ...task.slots, counterpartyId: source.id, counterpartyRevision: source.revision };
        task.state = task.subrequests.some(item => ['pending', 'needs_user'].includes(item.status)) ? 'waiting_user' : 'completed';
      } else task.slots = { ...task.slots, [`counterpartyToken${sub.index}`]: token };
      task.revision++;
      if (await this.contextV2.save(bound.owner, projection.stateVersion, bound.epoch, { version: 2, tasks })) {
        if (completed) this.semanticTaskMappings.set(event, mappings);
        return;
      }
    }
    throw new Error('LINE_CONTEXT_STALE_STATE');
  }

  private async remainingTaskChoiceMessages(event: object): Promise<LineReplyMessage[]> {
    const bound = this.boundConversations.get(event), mappings = this.semanticTaskMappings.get(event);
    const projection = bound && await this.contextV2.projection(bound.owner);
    if (!projection || projection.lifecycleEpoch !== bound!.epoch || !mappings) throw new Error('LINE_TASK_SOURCE_MISSING');
    const remaining = projection.tasks.filter(task => !task.slots?.sequenceExpenseId).flatMap(task => task.subrequests.filter(sub => sub.kind === 'write' && ['needs_user', 'pending'].includes(sub.status)
      && !mappings.some(mapping => mapping.taskId === task.taskId && mapping.subrequestIndex === sub.index)
      && task.sourceRevisionLocators?.some(locator => locator.sourceType.startsWith(`LINE_ACCEPTED_TASK_${sub.index}_`)))
      .map(sub => ({ task, sub, revision: task.revision + (mappings.some(mapping => mapping.taskId === task.taskId) ? 1 : 0) })));
    if (!remaining.length) return [];
    const orderedTask = remaining.find(item => typeof item.task.slots?.writeOrder === 'string')?.task;
    const order = String(orderedTask?.slots?.writeOrder ?? '').split(',').map(Number);
    const choices = orderedTask ? [...remaining.filter(item => item.task.taskId === orderedTask.taskId)].sort((a, b) => {
      const original = (item: typeof a) => Number(item.task.sourceRevisionLocators?.find(ref => ref.sourceType.startsWith(`LINE_ACCEPTED_TASK_${item.sub.index}_`))?.sourceType.split('_').at(-1));
      return order.indexOf(original(a)) - order.indexOf(original(b));
    }).slice(0, 1) : remaining.slice(0, 4);
    return [{ type: 'text', text: orderedTask
      ? (replyLanguage(event) === 'en' ? 'Continue to the next step to prepare the document.' : 'กดทำขั้นตอนถัดไปเพื่อเตรียมเอกสารต่อค่ะ')
      : (replyLanguage(event) === 'en' ? "The existing details are retained; choose a task to continue." : 'รายละเอียดเดิมยังอยู่ค่ะ เลือกงานที่จะทำต่อได้เลย'), quickReply: lineChoiceQuickReply([
      ...choices.map(({ task, sub }, index) => ({ label: orderedTask ? (replyLanguage(event) === 'en' ? 'Next step' : 'ทำขั้นตอนถัดไป') : sub.goal, text: orderedTask
        ? (replyLanguage(event) === 'en' ? `Do part ${Number(task.sourceRevisionLocators?.find(ref => ref.sourceType.startsWith(`LINE_ACCEPTED_TASK_${sub.index}_`))?.sourceType.split('_').at(-1)) + 1} first` : `ทำข้อ ${Number(task.sourceRevisionLocators?.find(ref => ref.sourceType.startsWith(`LINE_ACCEPTED_TASK_${sub.index}_`))?.sourceType.split('_').at(-1)) + 1} ก่อน`)
        : (replyLanguage(event) === 'en' ? `Continue record ${index + 1} to continue.` : `ทำรายการ ${index + 1} ต่อ`) })),
      ...(remaining.length > 4 ? [{ label: (replyLanguage(event) === 'en' ? "More options" : 'อื่นๆ'), text: (replyLanguage(event) === 'en' ? "Show remaining tasks" : 'ขอดูงานค้างที่เหลือ') }] : []),
    ]) }];
  }

  private async deliverMixedBusinessWriteSelection(event: LineTextEvent,
    writes: NonNullable<LineAiTurnRequest['semanticSubrequests']>): Promise<LineDeliveryResult> {
    const bound = this.boundConversations.get(event), mappings = this.semanticTaskMappings.get(event);
    const projection = bound && await this.contextV2.projection(bound.owner);
    if (!projection || projection.lifecycleEpoch !== bound!.epoch || !mappings) throw new Error('LINE_TASK_SOURCE_MISSING');
    const items = writes.slice(0, 4).map(item => {
      const mapping = mappings.find(value => value.index === item.index), task = projection.tasks.find(value => value.taskId === mapping?.taskId);
      if (!task || !mapping) throw new Error('LINE_TASK_SOURCE_MISSING');
      // The words name the clause; prepareRetainedTaskSelection maps them back to this waiting task.
      return { type: 'action' as const, action: { type: 'message' as const, label: Array.from(item.goal).slice(0, 20).join(''),
        text: (replyLanguage(event) === 'en' ? `Do part ${item.index + 1} first` : `ทำข้อ ${item.index + 1} ก่อน`) } };
    });
    if (writes.length > 4) items.push({ type: 'action', action: { type: 'message', label: (replyLanguage(event) === 'en' ? "More options" : 'อื่นๆ'), text: (replyLanguage(event) === 'en' ? "Show remaining tasks" : 'ขอดูงานค้างที่เหลือ') } });
    const text = (replyLanguage(event) === 'en' ? "Choose the first task; I will use the existing details to prepare each record for review." : 'เลือกงานที่จะทำก่อน แล้วน้องใช้รายละเอียดเดิมเตรียมให้ตรวจทีละรายการค่ะ');
    const messages: LineReplyMessage[] = splitLineExpenseDraftReply(text).map(part => ({ type: 'text', text: part }));
    const last = messages.at(-1); if (last?.type === 'text') last.quickReply = { items };
    return this.deliverMessages(event, messages);
  }

  private async preserveSemanticTask(event: LineTextEvent, subrequests: NonNullable<LineAiTurnRequest['semanticSubrequests']>): Promise<boolean> {
    const bound = this.boundConversations.get(event); if (!bound) return true;
    const newTaskId = deliveryHash(['line-task', bound.id, event.webhookEventId]);
    for (let attempt = 0; attempt < 2; attempt++) {
      const projection = await this.contextV2.projection(bound.owner);
      if (!projection || projection.lifecycleEpoch !== bound.epoch) return false;
      const tasks = structuredClone(projection.tasks.filter(task => !['completed', 'canceled', 'invalidated'].includes(task.state)));
      const mappings: Array<{ index: number; taskId: string; subrequestIndex: number }> = [];
      const touched = new Set<string>();
      const fresh = subrequests.filter(item => !item.taskRef);
      for (const item of subrequests) {
        if (!item.taskRef) { mappings.push({ index: item.index, taskId: newTaskId, subrequestIndex: fresh.indexOf(item) }); continue; }
        const ref = item.taskRef, task = tasks.find(task => task.taskId === ref.taskId);
        const previous = task?.subrequests.find(sub => sub.index === ref.subrequestIndex);
        if (!task || task.revision !== ref.taskRevision || !['waiting_user', 'paused'].includes(task.state)
          || !previous || previous.kind !== item.kind || !['needs_user', 'pending'].includes(previous.status)
          || mappings.some(mapping => mapping.taskId === ref.taskId && mapping.subrequestIndex === ref.subrequestIndex)) return false;
        mappings.push({ index: item.index, taskId: ref.taskId, subrequestIndex: ref.subrequestIndex });
        touched.add(task.taskId);
      }
      for (const task of tasks) if (touched.has(task.taskId)) {
        task.revision++; task.state = 'active';
        for (const mapping of mappings.filter(item => item.taskId === task.taskId)) task.subrequests.find(sub => sub.index === mapping.subrequestIndex)!.status = 'pending';
      }
      if (fresh.length && !tasks.some(task => task.taskId === newTaskId)) {
        if (tasks.length >= 4) return false;
        tasks.push({ taskId: newTaskId, revision: 0, kind: fresh[0]!.kind, state: 'active', userGoal: fresh[0]!.goal,
          subrequests: fresh.map((item, index) => ({ index, kind: item.kind, goal: item.goal, status: 'pending' })) });
      }
      if (await this.contextV2.save(bound.owner, projection.stateVersion, bound.epoch, { version: 2, tasks })) {
        this.semanticTaskMappings.set(event, mappings); return true;
      }
    }
    return false;
  }

  /** Save the bounded completion before transport so ACCEPTED replay can finish task CAS after a crash. */
  private async persistSemanticTaskCompletion(event: LineTextEvent | LineReceiptUploadEvent): Promise<void> {
    const bound = this.boundConversations.get(event), mappings = this.semanticTaskMappings.get(event), coverage = this.semanticDelivery.get(event);
    if (!bound || !mappings?.length || !coverage?.length || this.intermediateDeliveries.has(event)) return;
    const row = await this.prisma.client.lineLedgerDelivery.findFirst({ where: { companyId: bound.owner.companyId, userId: bound.owner.userId,
      webhookEventId: event.webhookEventId, expiresAt: { gt: new Date() }, acceptedRequestJson: { not: Prisma.AnyNull } } });
    if (!row) return; // QA uses its durable job/task proof instead of a ledger parent.
    const projection = await this.contextV2.projection(bound.owner);
    if (!projection || projection.lifecycleEpoch !== bound.epoch || mappings.length !== coverage.length) throw new Error('LINE_CONTEXT_STALE_STATE');
    const revisions = Object.fromEntries(mappings.map(mapping => {
      const task = projection.tasks.find(item => item.taskId === mapping.taskId);
      if (!task || !['active', 'waiting_job'].includes(task.state)) throw new Error('LINE_CONTEXT_STALE_STATE');
      return [task.taskId, task.revision];
    }));
    const result = this.deliveryReimbursements?.get(event)?.result;
    // A draft still collecting is remembered too, so the next message that continues this task reaches the
    // same draft instead of being refused as a second financial action (NAT04 2026-09-29).
    const actionIds = result?.status === 'preview' ? [result.preview.actionId] : result?.status === 'applied' ? [String(result.receipt.actionId)]
      : result?.status === 'needs_fields' || result?.status === 'needs_target' ? [result.actionId] : [];
    const completion = { version: 1 as const, actionIds, ownerEpoch: bound.epoch, conversationId: bound.id,
      accessFingerprint: this.deliveryAccess.get(event)!.fingerprint, mappings, coverage, revisions };
    const previous = (row.completionJson ?? {}) as Record<string, Prisma.InputJsonValue>;
    const digest = deliveryHash(completion);
    if (previous.semanticTaskCompletion) {
      if (previous.semanticTaskCompletionDigest !== digest) throw new Error('LINE_TASK_COMPLETION_CHANGED');
      return;
    }
    const updated = await this.prisma.client.lineLedgerDelivery.updateMany({ where: { id: row.id, companyId: bound.owner.companyId,
      completionJson: row.completionJson === null ? { equals: Prisma.DbNull } : { equals: row.completionJson as Prisma.InputJsonValue } },
      data: { completionJson: { ...previous, semanticTaskCompletion: completion as unknown as Prisma.InputJsonValue,
        semanticTaskCompletionDigest: digest, semanticTaskCompletionApplied: false } } });
    if (updated.count !== 1) throw new Error('LINE_TASK_COMPLETION_CHANGED');
  }

  private async reconcileDeliveredSemanticTasks(event: LineTextEvent): Promise<void> {
    const bound = this.boundConversations.get(event); if (!bound) return;
    const rows = await this.prisma.client.lineLedgerDelivery.findMany({ where: { companyId: bound.owner.companyId, userId: bound.owner.userId,
      expiresAt: { gt: new Date() }, completionJson: { path: ['semanticTaskCompletionApplied'], equals: false } },
      orderBy: { createdAt: 'asc' }, take: 32, include: { deliveryPlan: true } });
    for (const row of rows) {
      const saved = row.completionJson as Record<string, unknown>, completion = saved?.semanticTaskCompletion as {
        version: number; ownerEpoch: number; conversationId: string; accessFingerprint: string;
        mappings: Array<{ index: number; taskId: string; subrequestIndex: number }>;
        coverage: NonNullable<LineAiTurnResponse['semanticCoverage']>; revisions: Record<string, number>; actionIds: string[];
      } | undefined;
      if (!completion || completion.version !== 1 || deliveryHash(completion) !== saved.semanticTaskCompletionDigest
        || completion.ownerEpoch !== bound.epoch || completion.conversationId !== bound.id || completion.accessFingerprint !== this.deliveryAccess.get(event)?.fingerprint) continue;
      const requestId = (row.acceptedRequestJson as { request?: { requestId?: string } } | null)?.request?.requestId;
      const accepted = parseAcceptedLedgerRequest(row.acceptedRequestJson, { companyId: bound.owner.companyId, userId: bound.owner.userId,
        webhookEventId: row.webhookEventId, turnId: requestId ?? '', chatKey: mediaChatKey(event), messagingChannelId: bound.owner.messagingChannelId });
      if (!accepted || accepted.conversationId !== bound.id || accepted.ownerEpoch !== bound.epoch
        || !accepted.request.semanticSubrequests || !parseLineAiSemanticCoverage(completion.coverage, accepted.request.semanticSubrequests)
        || completion.mappings.length !== completion.coverage.length) continue;
      const outcome = row.deliveryPlan ? null : await this.prisma.client.lineTurnOutcome.findUnique({ where: { webhookEventId: row.webhookEventId }, include: { deliveryPlan: true } });
      const delivered = row.deliveryPlan ?? outcome?.deliveryPlan, plan = parseLineDeliveryPlan(delivered?.planJson);
      if (delivered?.status !== 'ACCEPTED' || !plan || delivered.planHash !== deliveryHash(plan)
        || !parseDeliveryBatchStates(delivered.batchStateJson, plan)?.every(batch => batch.status === 'ACCEPTED') || plan.authorization.kind !== 'PRIVATE'
        || plan.authorization.actor.ownerEpoch !== bound.epoch || plan.authorization.actor.conversationId !== bound.id
        || plan.authorization.actor.userId !== bound.owner.userId || plan.authorization.actor.companyId !== bound.owner.companyId
        || plan.authorization.actor.membershipId !== bound.owner.membershipId || plan.authorization.actor.channelId !== bound.owner.messagingChannelId
        || plan.authorization.actor.chatKeyHash !== bound.owner.chatKeyHash
        || plan.authorization.actor.accessFingerprint !== completion.accessFingerprint) continue;
      const previousMappings = this.semanticTaskMappings.get(event);
      this.semanticTaskMappings.set(event, completion.mappings);
      try { await this.settleSemanticTask(event, completion.coverage, completion.actionIds, completion.revisions); }
      finally { if (previousMappings) this.semanticTaskMappings.set(event, previousMappings); else this.semanticTaskMappings.delete(event); }
      const projection = await this.contextV2.projection(bound.owner);
      if (!projection || projection.lifecycleEpoch !== bound.epoch) continue;
      if (Object.entries(completion.revisions).every(([id, revision]) => !projection.tasks.some(task => task.taskId === id && task.revision === revision))) {
        await this.prisma.client.lineLedgerDelivery.updateMany({ where: { id: row.id, completionJson: { equals: row.completionJson as Prisma.InputJsonValue } },
          data: { completionJson: { ...saved, semanticTaskCompletionApplied: true } as Prisma.InputJsonValue } });
      }
    }
  }

  private async settleSemanticTask(event: LineTextEvent, coverage: NonNullable<LineAiTurnResponse['semanticCoverage']>, actionIds: string[] = [], expectedRevisions?: Record<string, number>): Promise<void> {
    const bound = this.boundConversations.get(event), mappings = this.semanticTaskMappings.get(event);
    if (!bound || !mappings || mappings.length !== coverage.length) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      const projection = await this.contextV2.projection(bound.owner);
      if (!projection || projection.lifecycleEpoch !== bound.epoch) return;
      const tasks = structuredClone(projection.tasks), touched = new Set<string>();
      for (const result of coverage) {
        const mapping = mappings.find(item => item.index === result.index);
        const task = mapping && tasks.find(task => task.taskId === mapping.taskId);
        const sub = task?.subrequests.find(sub => sub.index === mapping!.subrequestIndex);
        if (!task || !sub || !['active', 'waiting_job'].includes(task.state) || expectedRevisions && task.revision !== expectedRevisions[task.taskId]) return;
        sub.status = result.status; touched.add(task.taskId);
        if (result.status === 'needs_user') task.deliveredQuestionRefs = [...new Set([...(task.deliveredQuestionRefs ?? []), deliveryHash([task.taskId, sub.index, result.question])])].slice(-8);
        if (sub.kind === 'write' && actionIds.length === 1) task.slots = { ...task.slots, [`reimbursementActionId${sub.index}`]: actionIds[0]! };
      }
      for (const task of tasks) if (touched.has(task.taskId)) {
        task.revision++;
        task.state = task.subrequests.some(sub => ['needs_user', 'pending'].includes(sub.status)) ? 'waiting_user' : 'completed';
      }
      if (await this.contextV2.save(bound.owner, projection.stateVersion, bound.epoch, { version: 2, tasks })) return;
    }
  }

  /** A legacy write lane's outcome for its bound task (NAT12 2026-09-29): a created draft stayed "pending" in the
   *  task projection, so the next answer told the customer nothing had been recorded. */
  /** A correction of this chat's one open text-note draft, applied through the draft's own answer path. */
  private async correctOpenExpenseDraft(event: LineTextEvent, ctx: RequestContext, hints: LineIntakeRoutePlan['correctionHints'],
    messageText: string, candidates: LineIntakeCorrectionCandidate[]) {
    if (!hints || !this.expenseDraftConversation || !(hints.amount || hints.expenseDate || hints.vendorName)) return null;
    const chatKeyHash = chatKeyHashOf(event);
    const open = (await this.expenseDraftConversation.routeContexts(ctx, chatKeyHash, replyLanguage(event))).filter(draft => draft.status === 'OPEN');
    const draft = open.length === 1 && candidates.some(candidate => candidate.id === open[0]!.expenseId) ? open[0]! : undefined;
    if (!draft || (hints.targetExpenseId && hints.targetExpenseId !== draft.expenseId)) return null;
    const itemRef = hints.amount ? await this.expenseDraftConversation.soleItemRef(ctx, chatKeyHash, draft.expenseId) : undefined;
    if (hints.amount && !itemRef) return null;
    const result = await this.expenseDraftConversation.execute(ctx, { language: replyLanguage(event), messageText, chatKeyHash, webhookEventId: event.webhookEventId,
      captureHints: { targetExpenseId: draft.expenseId,
        ...(hints.expenseDate ? { expenseDate: hints.expenseDate.to } : {}),
        ...(hints.vendorName ? { vendorName: hints.vendorName.to } : {}),
        ...(hints.amount ? { items: [{ itemRef, totalAmount: hints.amount.to, sourceText: messageText }] } : {}) } });
    return result.handled && result.acceptedFields.length > 0 ? result : null;
  }

  private async settleWriteLane(event: LineTextEvent, status: 'handled' | 'needs_user', question?: string): Promise<void> {
    const mappings = this.semanticTaskMappings.get(event);
    if (!mappings?.length || this.mixedBusinessQuestions?.get(event)) return;
    await this.settleSemanticTask(event, mappings.map(item => status === 'handled' ? { index: item.index, status }
      : { index: item.index, status, reasonCode: 'BUSINESS_INPUT_REQUIRED', question: (question ?? '').slice(0, 500) }));
  }

  private documentQaQuestions(event: LineTextEvent, inventory: NonNullable<LineAiTurnRequest['semanticSubrequests']>) {
    const evidence = event.inputEvidence;
    if (!evidence || evidence.parts.map(part => part.rawText).join('\n') !== event.messageText) throw new Error('QA_QUESTION_EVIDENCE_MISSING');
    const offsets = new Map<string, number>(); let offset = 0;
    for (const part of evidence.parts) { offsets.set(part.partId, offset); offset += part.rawText.length + 1; }
    return inventory.filter(item => item.kind === 'file').map(item => {
      if (!item.evidenceRefs?.length) throw new Error('QA_QUESTION_EVIDENCE_MISSING');
      const ranges = item.evidenceRefs.map(ref => {
        if (validateLineAiSourceRefV2(ref, evidence) === undefined) throw new Error('QA_QUESTION_EVIDENCE_MISSING');
        return { start: offsets.get(ref.partId)! + ref.startUtf16, end: offsets.get(ref.partId)! + ref.endUtf16 };
      });
      return { subrequestIndex: item.index, question: event.messageText.slice(Math.min(...ranges.map(item => item.start)), Math.max(...ranges.map(item => item.end))) };
    });
  }

  /** Persist the accepted inventory against its job so recovery does not rely on WeakMaps. */
  private async bindDocumentQaTask(event: LineTextEvent | LineReceiptUploadEvent, jobId: string): Promise<void> {
    const bound = this.boundConversations.get(event), mappings = this.semanticTaskMappings.get(event);
    if (!bound || !mappings?.length) throw new Error('QA_TASK_BINDING_MISSING');
    const job = await this.documentQa.getById(jobId);
    if (!job || job.companyId !== bound.owner.companyId || job.userId !== bound.owner.userId
      || job.ownerMembershipId !== bound.owner.membershipId || job.ownerEpoch !== bound.epoch
      || job.messagingChannelId !== bound.owner.messagingChannelId || job.chatKeyHash !== bound.owner.chatKeyHash
      || !Array.isArray(job.attachmentsJson)) throw new Error('QA_TASK_OWNER_MISMATCH');
    const refs = (job.attachmentsJson as Array<{ attachmentId: string; contentHash: string; requestedPages: number[] }>)
      .map(item => ({ attachmentId: item.attachmentId, contentHash: item.contentHash, pages: item.requestedPages }));
    for (let attempt = 0; attempt < 2; attempt++) {
      const projection = await this.contextV2.projection(bound.owner);
      if (!projection || projection.lifecycleEpoch !== bound.epoch) throw new Error('LINE_CONTEXT_STALE_EPOCH');
      const tasks = structuredClone(projection.tasks);
      for (const taskId of new Set(mappings.map(item => item.taskId))) {
        const task = tasks.find(item => item.taskId === taskId);
        if (!task || task.state !== 'active') throw new Error('LINE_CONTEXT_STALE_STATE');
        const selected = mappings.filter(item => item.taskId === taskId);
        const retained = (task.sourceRevisionLocators ?? []).filter(loc => !selected.some(item => loc.sourceType.startsWith(`LINE_DOCUMENT_QA_${item.subrequestIndex}_`)));
        task.sourceRevisionLocators = [...retained, ...selected.map(item => ({ sourceType: `LINE_DOCUMENT_QA_${item.subrequestIndex}_${item.index}`, sourceId: jobId, revision: String(job.revision) }))];
        if (task.sourceRevisionLocators.length > 8) throw new Error('QA_TASK_SOURCE_LIMIT');
        if (selected.some(item => task.subrequests[item.subrequestIndex]?.kind === 'file')) {
          task.attachmentPageRefs = refs;
        }
        task.state = 'waiting_job'; task.revision++;
      }
      if (await this.contextV2.save(bound.owner, projection.stateVersion, bound.epoch, { version: 2, tasks })) return;
    }
    throw new Error('LINE_CONTEXT_STALE_STATE');
  }

  private async restoreDocumentQaTask(event: LineTextEvent | LineReceiptUploadEvent, jobId: string) {
    const bound = this.boundConversations.get(event); if (!bound) return [];
    const projection = await this.contextV2.projection(bound.owner);
    if (!projection || projection.lifecycleEpoch !== bound.epoch) return [];
    const selected: Array<{ index: number; taskId: string; subrequestIndex: number; kind: string; goal: string }> = [];
    for (const task of projection.tasks) {
      if (task.state !== 'waiting_job') continue;
      for (const locator of task.sourceRevisionLocators ?? []) {
        const match = /^LINE_DOCUMENT_QA_([0-7])_([0-7])$/u.exec(locator.sourceType);
        if (!match || locator.sourceId !== jobId) continue;
        const sub = task.subrequests[Number(match[1])]; if (!sub) continue;
        selected.push({ index: Number(match[2]), taskId: task.taskId, subrequestIndex: sub.index, kind: sub.kind, goal: sub.goal });
      }
    }
    selected.sort((a, b) => a.index - b.index);
    if (selected.length) this.semanticTaskMappings.set(event, selected);
    return selected;
  }

  private async reliabilityContext(event: LineTextEvent) {
    const bound = this.boundConversations.get(event); if (!bound) return { language: replyLanguage(event) };
    const taskProjection = await this.contextV2.projection(bound.owner);
    if (!taskProjection || taskProjection.lifecycleEpoch !== bound.epoch) throw new Error('LINE_CONTEXT_STALE_EPOCH');
    const preferences = this.config.lineAiPreferencesEnabled ? await this.contextV2.listPreferences(bound.owner) : null;
    if (preferences && preferences.epoch !== bound.epoch) throw new Error('LINE_CONTEXT_STALE_EPOCH');
    return { taskProjection, language: event.language ?? lineReplyLanguage(event.messageText), ...(preferences ? { responsePreferences: { detail: 'normal' as const, presentation: 'prose' as const, ...preferences.values, language: event.language ?? lineReplyLanguage(event.messageText) } } : {}) };
  }

  private async bindConversation(event: LineTextEvent | LineReceiptUploadEvent): Promise<void> {
    const access = this.deliveryAccess.get(event);
    if (!access) return;
    const owner = this.conversationOwner(access.companyId, access.userId, event);
    if (!owner) return;
    const row = await this.contextV2.admit(owner);
    this.boundConversations.set(event, { owner, id: row.id, epoch: row.lifecycleEpoch });
  }

  private quoteOwner(event: { lineUserId: string; pushTargetId?: string; messagingChannelId?: string; channelKind?: string }): LineQuoteOwner | null {
    const access = this.deliveryAccess.get(event), bound = this.boundConversations.get(event);
    if (!access || event.channelKind === 'GROUP' || event.channelKind === 'ROOM' || event.pushTargetId && event.pushTargetId !== event.lineUserId) return null;
    return { companyId: access.companyId, userId: access.userId, membershipId: access.membershipId, chatKeyHash: chatKeyHashOf(event),
      channelId: event.messagingChannelId ?? '', recipientHash: lineDeliveryRecipientHash(event.lineUserId, event.pushTargetId ?? event.lineUserId, event.messagingChannelId ?? ''),
      accessFingerprint: access.fingerprint, ...(bound ? { conversationId: bound.id, ownerEpoch: bound.epoch } : {}) };
  }
  private async quotedRecordsForEvent(event: LineTextEvent | LineReceiptUploadEvent): Promise<LineQuotedRecord[]> {
    const previous = this.quotedRecords.get(event);
    if (previous) return previous;
    const owner = this.quoteOwner(event);
    const records = owner && 'quotedMessageId' in event && this.quotedMessages
      ? await this.quotedMessages.resolve(owner, event.quotedMessageId).catch(() => []) : [];
    this.quotedRecords.set(event, records);
    return records;
  }
  private async deliveryQuoteRecords(event: object): Promise<LineQuotedRecord[]> {
    const records = quoteRecordsFromReads(this.deliverySources.get(event)?.recentReads ?? []);
    const receipt = this.deliveryReceiptSources.get(event);
    if (receipt) for (const id of receipt.records.keys()) records.push({ tool: 'expense.get_detail', id });
    const draft = this.deliveryDraftPreviews.get(event);
    if (draft) {
      const preview = await this.draftUpdate?.pendingPreview(draft.context, draft.chatKeyHash, draft.requestId);
      if (preview) records.push({ tool: 'expense.get_detail', id: preview.expenseId });
    }
    const substitute = this.deliverySubstituteActions.get(event);
    if (substitute) records.push(...await this.substituteActions!.quoteRecords(substitute.context, chatKeyHashOf(event as LineTextEvent), substitute.preview.token, substitute.applied));
    const action = this.deliveryExpenseActions.get(event);
    if (action) records.push(...await this.expenseActions.quoteRecords(action.context, action.chat, action.preview.token));
    const reimbursement = this.deliveryReimbursements.get(event)?.result;
    if (reimbursement?.status === 'applied') records.push({ tool: 'reimbursement.get_detail', id: String(reimbursement.receipt.requestId) });
    return validQuoteRecords(records);
  }
  private async quoteRecordsForMessage(event: object, message: LineReplyMessage): Promise<LineQuotedRecord[]> {
    const wire = message.type === 'flex' ? JSON.stringify(message.contents) : JSON.stringify(message.quickReply ?? {});
    const action = this.deliveryExpenseActions.get(event);
    if (action && /expense_action_(?:confirm|cancel|wht|payment)/u.test(wire)) return this.expenseActions.quoteRecords(action.context, action.chat, action.preview.token);
    const draft = this.deliveryDraftPreviews.get(event);
    if (draft && /draft-update-(?:confirm|cancel)/u.test(wire)) {
      const preview = await this.draftUpdate?.pendingPreview(draft.context, draft.chatKeyHash, draft.requestId);
      return preview ? [{ tool: 'expense.get_detail', id: preview.expenseId }] : [];
    }
    return this.deliveryQuoteRecords(event);
  }
  private async rememberSentQuote(event: object, messageIds: string[], messages: LineReplyMessage[]): Promise<void> {
    if (!messageIds.length || !this.quotedMessages || !('webhookEventId' in event) || !('lineUserId' in event)) return;
    const typed = event as LineTextEvent;
    const owner = this.quoteOwner(typed);
    if (owner) await this.quotedMessages.rememberLegacy(typed.webhookEventId, owner, messageIds, await this.deliveryQuoteRecords(event), await Promise.all(messages.map(message => this.quoteRecordsForMessage(event, message))));
  }

  private async webhookPlanAuthorization(event: LineTextEvent | LineReceiptUploadEvent, expiresAt: string): Promise<DeliveryAuthorizationV2 | null> {
    const access = this.deliveryAccess.get(event), bound = this.boundConversations.get(event);
    if (!access || !bound) return null;
    const proofs: Extract<DeliveryAuthorizationV2, { kind: 'PRIVATE' }>['proofs'] = [];
    const waiting = this.deliveryWaitingSources.get(event);
    if (waiting) {
      for (const item of waiting.items) if (!await this.clarificationSourceCurrent(event as LineTextEvent, waiting.context, item)) return null;
      proofs.push({ id: 'waiting', kind: 'CLARIFICATION', items: waiting.items.map(({ entry, ...item }) => ({ ...item, entry: { sourceContext: entry.sourceContext } })) });
    }
    const qaJob = this.documentQaDelivery.get(event);
    if (qaJob) proofs.push({ id: 'document-qa', ...this.documentQa.buildDeliveryProof(qaJob), kind: 'LINE_DOCUMENT_QA' });
    const read = this.deliverySources.get(event);
    if (read?.ids === null) return null;
    if (read?.ids?.length) proofs.push({ id: 'read', kind: 'READ', evidenceIds: read.ids });
    const receipt = this.deliveryReceiptSources.get(event);
    if (receipt) {
      if ([...receipt.records.values(), ...receipt.categories.values()].some(v => v === null)) return null;
      proofs.push({ id: 'receipt', kind: 'EXPENSE_REVISION', records: [...receipt.records].map(([id, revision]) => ({ id, revision })), categories: [...receipt.categories].map(([id, name]) => ({ id, name })), choices: receipt.draftChoices ?? null });
    }
    const draft = this.deliveryDraftPreviews.get(event);
    if (draft) {
      const applied = draft.phase === 'APPLIED' && draft.previewId ? await this.draftUpdate?.appliedResult(draft.context, draft.chatKeyHash, draft.previewId) : null;
      const preview = draft.phase === 'APPLIED' ? applied?.status === 'applied' ? applied.preview : null : await this.draftUpdate?.pendingPreview(draft.context, draft.chatKeyHash, draft.requestId);
      if (!preview || preview.previewId !== draft.previewId) return null;
      proofs.push({ id: 'draft', kind: 'EXPENSE_EDIT_PREVIEW', previewId: preview.previewId, requestId: draft.requestId, phase: draft.phase, previewRevision: deliveryHash(preview) });
    }
    for (const [i, substitute] of (this.deliverySubstituteSources.get(event) ?? []).entries()) {
      if (!substitute.source) return null;
      proofs.push({ id: `substitute-${i}`, kind: 'SUBSTITUTE', source: substitute.source });
    }
    const purchase = this.deliveryPackagePurchases.get(event);
    if (purchase) {
      const view = await this.packagePurchases.current(purchase.context, chatKeyHashOf(event), purchase.view.token);
      if (!view || deliveryHash(view) !== deliveryHash(purchase.view)) return null;
      proofs.push({ id: 'package-purchase', kind: 'PACKAGE_PURCHASE', token: view.token, viewHash: deliveryHash(view) });
    }
    const counterparty = this.deliveryCounterparties.get(event);
    if (counterparty) {
      const preview = await this.counterparties.pending(counterparty.context, chatKeyHashOf(event));
      if (!preview || deliveryHash(preview) !== deliveryHash(counterparty.preview)) return null;
      proofs.push({ id: 'counterparty', kind: 'COUNTERPARTY_PREVIEW', token: preview.token, previewHash: deliveryHash(preview) });
    }
    const substituteAction = this.deliverySubstituteActions.get(event);
    if (substituteAction) {
      const preview = await this.substituteActions?.pending(substituteAction.context, chatKeyHashOf(event), substituteAction.preview.token, substituteAction.applied);
      if (!preview || deliveryHash(preview) !== deliveryHash(substituteAction.preview)) return null;
      proofs.push({ id: 'substitute-action', kind: 'EXPENSE_ACTION_PREVIEW', requestId: substituteAction.context.requestId,
        previewHash: deliveryHash(preview), applied: substituteAction.applied === true, token: preview.token });
    }
    const action = this.deliveryExpenseActions.get(event);
    if (action) {
      const preview = action.applied ? await this.expenseActions.appliedPreview(action.context, action.chat, action.preview.token)
        : await this.expenseActions.pending(action.context, action.chat, action.requestId);
      if (!preview || deliveryHash(preview) !== deliveryHash(action.preview)) return null;
      proofs.push({ id: 'expense-action', kind: 'EXPENSE_ACTION_PREVIEW', requestId: action.requestId, previewHash: deliveryHash(preview), applied: action.applied === true, token: preview.token });
    }
    const reimbursement = this.deliveryReimbursements.get(event)?.result;
    if (reimbursement && (reimbursement.status === 'preview' || reimbursement.status === 'applied')) {
      const actionId = reimbursement.status === 'preview' ? reimbursement.preview.actionId : String(reimbursement.receipt.actionId);
      proofs.push({ id: 'reimbursement', kind: 'REIMBURSEMENT_DRAFT', actionId, status: reimbursement.status, resultHash: deliveryHash(reimbursement),
        ...(reimbursement.status === 'applied' && typeof reimbursement.receipt.requestId === 'string' && this.config.aiGatewayInternalSecret
          ? { submitToken: reimbursementApprovalOpenToken(this.config.aiGatewayInternalSecret, bound.owner.companyId, bound.owner.userId, reimbursement.receipt.requestId, 'expense_action_submit') } : {}) });
    }
    const reimbursementOptions = this.reimbursementOptionsDelivery.get(event);
    if (reimbursementOptions) proofs.push({ id: 'reimbursement-options', kind: 'REIMBURSEMENT_OPTIONS', actionId: reimbursementOptions.actionId,
      controlRevision: reimbursementOptions.options.control.revision, optionsHash: deliveryHash(reimbursementOptions.options) });
    const candidates = this.deliveryCandidates.get(event);
    if (candidates) {
      const rows = JSON.parse(candidates.snapshot) as LineIntakeCorrectionCandidate[];
      proofs.push({ id: 'candidates', kind: 'CANDIDATES', ids: rows.map(r => r.id), snapshotHash: deliveryHash(rows), originalChoices: candidates.originalChoices === true });
    }
    const quoteRecords = await this.deliveryQuoteRecords(event);
    if (quoteRecords.length) proofs.push({ id: 'quote-references', kind: 'QUOTE_REFERENCES', records: quoteRecords });
    return { v: 2, kind: 'PRIVATE', actor: { userId: access.userId, companyId: access.companyId, membershipId: access.membershipId,
      requestId: read?.requestId ?? draft?.requestId ?? event.webhookEventId, accessFingerprint: access.fingerprint, channelId: event.messagingChannelId,
      channel: 'line', channelKind: 'USER', recipientHash: lineDeliveryRecipientHash(event.lineUserId, event.pushTargetId ?? event.lineUserId, event.messagingChannelId), chatKeyHash: chatKeyHashOf(event), conversationId: bound.id, ownerEpoch: bound.epoch },
      issuedAt: new Date().toISOString(), expiresAt, proofs };
  }

  /** Rebuild current permission context before checking frozen source locators. No stored permissions. */
  private async verifyWebhookPlan(plan: DeliveryPlanV2, event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string }): Promise<boolean> {
    if (plan.authorization.kind === 'PUBLIC_GENERAL') return this.verifyPublicPlan(plan, event);
    const auth = plan.authorization, a = auth.actor;
    if (a.channelId !== event.messagingChannelId || (event.pushTargetId && event.pushTargetId !== event.lineUserId)
      || a.recipientHash !== lineDeliveryRecipientHash(event.lineUserId, event.pushTargetId ?? event.lineUserId, event.messagingChannelId ?? '')
      || a.chatKeyHash !== chatKeyHashOf(event) || Date.parse(auth.expiresAt) <= Date.now()) return false;
    const owner: LineConversationOwner = { companyId: a.companyId, userId: a.userId, membershipId: a.membershipId, channel: 'line', channelKind: 'USER', messagingChannelId: a.channelId, chatKeyHash: a.chatKeyHash };
    const bound = await this.contextV2.load(owner);
    if (!bound || bound.row.id !== a.conversationId || bound.row.lifecycleEpoch !== a.ownerEpoch) return false;
    const resolved = await this.permissionResolver.resolveAccess(a.userId, a.companyId);
    if (resolved.membershipId !== a.membershipId) return false;
    const ctx: RequestContext = { authSubject: a.userId, authProvider: 'line', requestId: a.requestId, companyId: a.companyId, userId: a.userId, membershipId: a.membershipId, permissions: resolved.permissions, entitlementDeniedPermissions: resolved.entitlementDeniedPermissions, roles: resolved.roles, scopes: resolved.scopes };
    this.deliveryAccess.set(event, { userId: a.userId, companyId: a.companyId, membershipId: a.membershipId, fingerprint: a.accessFingerprint });
    this.deliverySources.delete(event); this.deliveryReceiptSources.delete(event); this.deliveryDraftPreviews.delete(event);
    this.deliverySubstituteActions.delete(event); this.deliverySubstituteSources.delete(event); this.deliveryCandidates.delete(event); this.deliveryWaitingSources.delete(event);
    for (const proof of auth.proofs) {
      if (proof.kind === 'CLARIFICATION') {
        if (!Array.isArray(proof.items) || !proof.items.length) return false;
        const items = proof.items as Array<LineAiOpenClarification & { entry: Pick<LedgerEntry, 'sourceContext'> }>;
        for (const item of items) if (!await this.clarificationSourceCurrent(event as LineTextEvent, ctx, item)) return false;
        this.deliveryWaitingSources.set(event, { context: ctx, items });
      } else if (proof.kind === 'LINE_DOCUMENT_QA') {
        const { id: _id, ...qaProof } = proof;
        if (!await this.documentQa.verifyDeliveryProof(qaProof, { companyId: a.companyId, userId: a.userId, membershipId: a.membershipId, ownerEpoch: a.ownerEpoch, channelKind: 'USER', messagingChannelId: a.channelId, chatKeyHash: a.chatKeyHash })) return false;
      } else if (proof.kind === 'READ') {
        if (!Array.isArray(proof.evidenceIds) || !proof.evidenceIds.every(id => typeof id === 'string')) return false;
        this.deliverySources.set(event, { requestId: a.requestId, ids: proof.evidenceIds as string[] });
      } else if (proof.kind === 'EXPENSE_REVISION') {
        if (!Array.isArray(proof.records) || !Array.isArray(proof.categories)) return false;
        this.deliveryReceiptSources.set(event, { context: ctx, chatKeyHash: a.chatKeyHash,
          records: new Map((proof.records as Array<{ id: string; revision: string }>).map(r => [r.id, r.revision])),
          categories: new Map((proof.categories as Array<{ id: string; name: string }>).map(r => [r.id, r.name])),
          ...(proof.choices ? { draftChoices: proof.choices as LineExpenseDraftRouteContext[] } : {}) });
      } else if (proof.kind === 'EXPENSE_EDIT_PREVIEW') {
        if (typeof proof.previewId !== 'string' || typeof proof.requestId !== 'string' || !['PENDING', 'APPLIED'].includes(String(proof.phase))) return false;
        const applied = proof.phase === 'APPLIED' ? await this.draftUpdate?.appliedResult(ctx, a.chatKeyHash, proof.previewId) : null;
        const preview = proof.phase === 'APPLIED' ? applied?.status === 'applied' ? applied.preview : null : await this.draftUpdate?.pendingPreview(ctx, a.chatKeyHash, proof.requestId);
        if (!preview || deliveryHash(preview) !== proof.previewRevision) return false;
        this.deliveryDraftPreviews.set(event, { context: ctx, chatKeyHash: a.chatKeyHash, requestId: proof.requestId, previewId: proof.previewId, phase: proof.phase as 'PENDING' | 'APPLIED' });
      } else if (proof.kind === 'SUBSTITUTE') {
        const list = this.deliverySubstituteSources.get(event) ?? [];
        list.push({ context: ctx, source: proof.source as LineSubstituteReceiptContinuationResult['source'] }); this.deliverySubstituteSources.set(event, list);
      } else if (proof.kind === 'PACKAGE_PURCHASE') {
        if (typeof proof.token !== 'string') return false;
        const view = await this.packagePurchases.current(ctx, a.chatKeyHash, proof.token);
        if (!view || deliveryHash(view) !== proof.viewHash) return false;
        this.deliveryPackagePurchases.set(event, { context: ctx, view });
      } else if (proof.kind === 'QUOTE_REFERENCES') {
        if (!validQuoteRecords(proof.records).length) return false;
      } else if (proof.kind === 'COUNTERPARTY_PREVIEW') {
        const preview = await this.counterparties.pending(ctx, a.chatKeyHash);
        if (!preview || preview.token !== proof.token || deliveryHash(preview) !== proof.previewHash) return false;
        this.deliveryCounterparties.set(event, { context: ctx, preview });
      } else if (proof.kind === 'EXPENSE_ACTION_PREVIEW') {
        if (typeof proof.requestId !== 'string') return false;
        if (typeof proof.token !== 'string') return false;
        if (proof.token.startsWith('sub_')) {
          const preview = await this.substituteActions?.pending(ctx, a.chatKeyHash, proof.token, proof.applied === true);
          if (!preview || deliveryHash(preview) !== proof.previewHash) return false;
          this.deliverySubstituteActions.set(event, { context: ctx, preview, applied: proof.applied === true });
          continue;
        }
        const preview = proof.applied === true ? await this.expenseActions.appliedPreview(ctx, a.chatKeyHash, proof.token)
          : await this.expenseActions.pending(ctx, a.chatKeyHash, proof.requestId);
        if (!preview || deliveryHash(preview) !== proof.previewHash) return false;
        this.deliveryExpenseActions.set(event, { context: ctx, chat: a.chatKeyHash, requestId: proof.requestId, preview, applied: proof.applied === true });
      } else if (proof.kind === 'REIMBURSEMENT_DRAFT') {
        if (typeof proof.actionId !== 'string' || !['preview', 'applied'].includes(String(proof.status))) return false;
        const result = await this.reimbursementDrafts.get({ ctx, owner, ownerEpoch: a.ownerEpoch, actionId: proof.actionId });
        if (result.status !== proof.status || deliveryHash(result) !== proof.resultHash) return false;
      } else if (proof.kind === 'REIMBURSEMENT_OPTIONS') {
        if (typeof proof.actionId !== 'string') return false;
        const options = await this.reimbursementAdapter.readDisplayOptions({ ctx, owner, ownerEpoch: a.ownerEpoch, actionId: proof.actionId });
        if (!options || deliveryHash(options) !== proof.optionsHash || options.control.revision !== proof.controlRevision) return false;
      } else if (proof.kind === 'CANDIDATES') {
        if (!Array.isArray(proof.ids) || !proof.ids.every(id => typeof id === 'string')) return false;
        const current = await this.loadCorrectionCandidates(a.companyId, a.userId, a.chatKeyHash, resolved.scopes, proof.originalChoices ? proof.ids as string[] : undefined);
        if (deliveryHash(current) !== proof.snapshotHash) return false;
        this.deliveryCandidates.set(event, { context: ctx, chatKeyHash: a.chatKeyHash, snapshot: JSON.stringify(current), originalChoices: proof.originalChoices === true });
      } else return false;
    }
    if (!await this.mayDeliverBusinessReply(event)) return false;
    const after = await this.contextV2.load(owner);
    return !!after && after.row.lifecycleEpoch === a.ownerEpoch;
  }

  async replayDeliveryPlan(planId: string, event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string }, automaticBatches = 1): Promise<LineDeliveryResult> {
    let attempts = Math.min(2, automaticBatches);
    for (let n = 0; n < attempts; n++) {
      const row = await this.prisma.client.lineDeliveryPlan.findUnique({ where: { id: planId } });
      const plan = parseLineDeliveryPlan(row?.planJson);
      if (!row || !plan || row.planHash !== deliveryHash(plan) || !row.outcomeId) return 'failed_permanent';
      if (row.status === 'ACCEPTED') return 'ok';
      if (['REFUSED', 'EXPIRED', 'CANCELLED'].includes(row.status)) return 'failed_permanent';
      if (!await this.verifyWebhookPlan(plan, event).catch(() => false)) {
        await this.prisma.client.lineDeliveryPlan.updateMany({ where: { id: row.id, status: { in: ['READY', 'UNKNOWN', 'WAITING_CONTINUATION'] } }, data: { status: 'REFUSED', cancelReason: 'AUTH_OR_SOURCE_CHANGED' } });
        return 'failed_permanent';
      }
      const claim = await this.deliveryPlans.claimPlan(row.id, { kind: 'WEBHOOK', id: row.outcomeId });
      if (!claim) return 'failed_other';
      const pending = claim.states.find(s => s.status !== 'ACCEPTED');
      const transport = n === 0 && claim.states.findIndex(s => s.status !== 'ACCEPTED') === 0 && event.replyToken && !pending?.replyAttempted && !pending?.firstAttemptAt ? 'REPLY' : 'PUSH';
      const dispatch = await this.deliveryPlans.beginPlanBatch(claim, transport);
      if (!dispatch) return 'failed_other';
      const frozen = claim.plan.batches[dispatch.index]![claim.states[dispatch.index]!.variant]!;
      const result = await this.lineReply.sendFrozenV2({ channelId: plan.authorization.kind === 'PRIVATE' ? plan.authorization.actor.channelId : plan.authorization.destination.channelId, transport, target: transport === 'REPLY' ? event.replyToken : event.pushTargetId ?? event.lineUserId, messages: frozen.messages, pushRetryKey: frozen.pushRetryKey, timeoutMs: dispatch.timeoutMs });
      if (result.kind === 'accepted') this.rememberDelivery(event, 'ok');
      if (!await this.deliveryPlans.finishPlanBatch(claim, dispatch.index, result)) return 'failed_other';
      // UAT 2026-10-19 (silent reply): a rare duplicate when an uncertain reply landed beats silence.
      // Push the same frozen batch now; its stable key also dedupes crash/recovery retries.
      if (transport === 'REPLY' && (result.kind === 'unknown' || result.kind === 'rejected' && result.rejection === 'TOKEN')) { attempts += 1; continue; }
      if (result.kind !== 'accepted') return result.rejection === 'PERMANENT' ? 'failed_permanent' : 'failed_other';
      if (claim.states.every(s => s.status === 'ACCEPTED')) {
        await this.prisma.client.lineTurnOutcome.updateMany({ where: { id: row.outcomeId, deliveredAt: null }, data: { deliveredAt: new Date() } });
        return 'ok';
      }
    }
    return 'failed_other';
  }

  private async reimbursementDraftMessages(result: LineReimbursementDraftResult, ctx: RequestContext, event: object): Promise<LineReplyMessage[]> {
    const id = result.status === 'applied' ? result.receipt.requestId : undefined;
    const secret = this.config.aiGatewayInternalSecret;
    const language = replyLanguage(event);
    const readiness = typeof id === 'string' ? await this.expenseActions?.claimSubmitReadiness?.(ctx, id, language) : undefined;
    const token = typeof id === 'string' && secret && readiness?.ready
      ? reimbursementApprovalOpenToken(secret, ctx.companyId, ctx.userId, id, 'expense_action_submit') : undefined;
    const messages = buildReimbursementDraftMessages(result, this.config.webBaseUrl ?? '', ctx.companyId, ctx.permissions, token, language, readiness?.ready === false ? readiness : undefined);
    const bound = this.boundConversations.get(event);
    if (result.status === 'applied' && bound && await this.reimbursementAdapter?.photoTarget?.({ ctx, owner: bound.owner, ownerEpoch: bound.epoch })
      && messages[0]) {
      messages[0] = inheritCompleteLineBusinessAnswerPresentation(messages[0], { ...messages[0],
        quickReply: { items: [{ type: 'action', action: { type: 'cameraRoll', label: language === 'en' ? 'Attach receipt' : 'แนบใบเสร็จ' } }] } });
    }
    return messages;
  }

  /** The current claim question owns a plain answer after metered intake, including a mistaken general route. */
  private async continueReimbursementQuestion(event: LineTextEvent, ctx: RequestContext, routePlan: GovernedLineIntakeRoutePlan,
    candidates: Awaited<ReturnType<ProcessLineWebhookUseCase['textValueCandidates']>>): Promise<boolean> {
    const text = event.messageText.trim();
    const claimOwner = ctx.freeExpenseDrafts ? undefined : this.boundConversations.get(event);
    if (claimOwner && !event.reimbursementChoiceControl && text !== 'ไม่มีใบเสร็จ ขอเบิกรายการใหม่นี้'
      && this.budgetGrantsV2.has(event) && event.inputEvidence && routePlan.status === 'ROUTED'
      && candidates?.amounts.length === 0 && (routePlan.semanticSubrequests?.length ?? 0) <= 1
      && (routePlan.semanticSubrequests ?? []).every(item => ['write', 'general', 'help'].includes(item.kind))) {
      if (/^ให้ทำใบเบิกไม่ใช่(?:หรอ|เหรอ|หรือ)(?:คะ|ค่ะ)?[?？]?$/u.test(text)) {
        const active = await this.reimbursementDrafts?.active({ ctx, owner: claimOwner.owner, ownerEpoch: claimOwner.epoch });
        if (active) {
          const current = await this.reimbursementDrafts.get({ ctx, owner: claimOwner.owner,
            ownerEpoch: claimOwner.epoch, actionId: active.id });
          await this.deliverReimbursementCollection(event, ctx, current);
          await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, ctx.companyId);
          return true;
        }
      }
      const answer = await this.reimbursementAdapter?.answerReason?.({ ctx, owner: claimOwner.owner,
        ownerEpoch: claimOwner.epoch, evidence: event.inputEvidence, text,
        purposeFallback: !routePlan.semanticSubrequests?.some(item => item.taskRef) });
      if (answer) {
        await this.deliverReimbursementCollection(event, ctx, answer);
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, ctx.companyId);
        return true;
      }
    }
    return false;
  }

  /** This handler is reached only after verified identity, current company/member/legal admission. */
  private async deliverReimbursementCollection(event: LineTextEvent | LineReceiptUploadEvent, ctx: RequestContext,
    result: import('../../../reimbursements/application/use-cases/line-reimbursement-draft.use-case').LineReimbursementDraftResult) {
    this.deliveryReimbursements.set(event, { context: ctx, result });
    let messages = await this.reimbursementDraftMessages(result, ctx, event);
    const bound = this.boundConversations.get(event);
    if (bound && (result.status === 'needs_fields' || result.status === 'needs_target')) {
      const options = await this.reimbursementAdapter.readDisplayOptions({ ctx, owner: bound.owner, ownerEpoch: bound.epoch, actionId: result.actionId });
      if (options) {
        this.reimbursementOptionsDelivery.set(event, { actionId: result.actionId, options });
        const choices = buildReimbursementOptionsMessages(options, this.config.webBaseUrl ?? '', replyLanguage(event));
        if (choices.length) messages = choices;
      }
    }
    await this.deliverRequiredMessages(event, messages);
  }

  private async handleReimbursementDraftControl(event: LineTextEvent, ctx: RequestContext): Promise<void> {
    const control = event.reimbursementDraftControl!;
    const owner: LineConversationOwner = { companyId: ctx.companyId, userId: ctx.userId, membershipId: ctx.membershipId!,
      channel: 'line', channelKind: 'USER', messagingChannelId: event.messagingChannelId, chatKeyHash: chatKeyHashOf(event) };
    const current = await this.contextV2.load(owner);
    if (!current || event.pushTargetId && event.pushTargetId !== event.lineUserId) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "This draft expired or your access changed." : 'ร่างนี้หมดอายุหรือสิทธิ์เปลี่ยนแล้วค่ะ'));
      await this.updateEventLog(event.webhookEventId, 'reimbursement_blocked', 'STALE_OWNER', ctx.companyId); return;
    }
    const ownerEpoch = current.row.lifecycleEpoch;
    this.boundConversations.set(event, { owner, epoch: ownerEpoch, id: current.row.id });
    const prior = await this.reimbursementDrafts.get({ ctx, owner, ownerEpoch, actionId: control.actionId });
    let result: LineReimbursementDraftResult = prior;
    if (prior.status !== 'applied' && prior.status !== 'stale') {
      if (control.action === 'reimbursement_draft_cancel') result = await this.reimbursementDrafts.cancel({ ctx, owner, ownerEpoch, control });
      else {
        const plan = await this.prisma.client.lineDeliveryPlan.findFirst({ where: { companyId: ctx.companyId,
          planJson: { path: ['control', 'actionId'], equals: control.actionId } }, orderBy: { createdAt: 'desc' } });
        result = plan ? await this.reimbursementDrafts.confirm({ ctx, owner, ownerEpoch, control, deliveryPlanId: plan.id })
          : { status: 'blocked', errorCode: 'preview_not_fully_delivered' };
      }
    }
    if (result.status === 'applied' || result.status === 'cancelled') {
      const projection = await this.contextV2.projection(owner);
      const mappings = projection?.tasks.flatMap(task => task.subrequests.filter(sub => sub.kind === 'write'
        && task.slots?.[`reimbursementActionId${sub.index}`] === control.actionId)
        .map(sub => ({ index: 0, taskId: task.taskId, subrequestIndex: sub.index, kind: sub.kind, goal: sub.goal }))) ?? [];
      if (mappings.length === 1) this.semanticTaskMappings.set(event, mappings);
    }
    await this.deliverReimbursementDraftResult(event, ctx, result);
    if (result.status === 'applied' || result.status === 'cancelled') await this.finishReimbursementTask(owner, ownerEpoch, control.actionId, result.status === 'applied');
    await this.updateEventLog(event.webhookEventId, result.status === 'applied' ? 'completed' : 'reimbursement_' + result.status, undefined, ctx.companyId);
  }

  private async finishReimbursementTask(owner: LineConversationOwner, epoch: number, actionId: string, applied: boolean): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const projection = await this.contextV2.projection(owner);
      if (!projection || projection.lifecycleEpoch !== epoch) return;
      const tasks = projection.tasks.map(task => {
        const linked = task.subrequests.filter(sub => sub.kind === 'write' && task.slots?.[`reimbursementActionId${sub.index}`] === actionId);
        // Legacy single-write projections can still finish; an unindexed action never completes several clauses.
        const legacy = !linked.length && task.subrequests.filter(sub => sub.kind === 'write').length === 1
          && task.sourceRevisionLocators?.some(ref => ref.sourceType === 'REIMBURSEMENT_ACTION' && ref.sourceId === actionId);
        if (!linked.length && !legacy) return task;
        const subrequests = task.subrequests.map(sub => linked.some(item => item.index === sub.index) || legacy && sub.kind === 'write'
          ? { ...sub, status: applied ? 'handled' as const : 'unsupported' as const } : sub);
        if (subrequests.every((sub, index) => sub.status === task.subrequests[index]!.status)) return task;
        return { ...task, revision: task.revision + 1, subrequests,
          state: subrequests.some(sub => sub.status === 'pending' || sub.status === 'needs_user') ? 'waiting_user' as const : applied ? 'completed' as const : 'canceled' as const };
      });
      if (tasks.every((task, index) => task === projection.tasks[index])) return;
      if (await this.contextV2.save(owner, projection.stateVersion, epoch, { version: 2, tasks })) return;
    }
  }

  /** Used by the permission-checked proposal adapter and exact zero-model controls. */
  async deliverReimbursementDraftResult(event: LineTextEvent, ctx: RequestContext, result: LineReimbursementDraftResult): Promise<void> {
    this.deliveryReimbursements.set(event, { context: ctx, result });
    const remaining = (result.status === 'applied' || result.status === 'cancelled') && this.semanticTaskMappings.has(event)
      ? await this.remainingTaskChoiceMessages(event) : [];
    await this.deliverRequiredMessages(event, [...await this.reimbursementDraftMessages(result, ctx, event), ...remaining]);
  }

  private async handleAnswerDeliveryControl(event: LineTextEvent): Promise<void> {
    const control = event.answerDeliveryControl!;
    const row = await this.prisma.client.lineDeliveryPlan.findUnique({ where: { id: control.planId } });
    const plan = parseLineDeliveryPlan(row?.planJson);
    if (!row || !plan || row.planHash !== deliveryHash(plan) || !(plan.producerKind === 'CAPTURE_OUTBOX'
      ? await this.captureNotifier.verifyCaptureDeliveryPlan(plan, event).catch(() => null)
      : plan.producerKind === 'LEDGER' ? await this.ledgerDrain.verifyLedgerDeliveryPlan(plan, event).catch(() => false)
      : await this.verifyWebhookPlan(plan, event).catch(() => false))) {
      await this.sendTrackedReply(event, [{ type: 'text', text: replyLanguage(event) === 'en' ? 'This answer expired or your access changed; please ask again.' : 'คำตอบชุดนี้หมดอายุหรือสิทธิ์เปลี่ยนแล้วค่ะ กรุณาถามใหม่' }]);
      await this.updateEventLog(event.webhookEventId, 'delivery_failed', 'LINE_PLAN_CONTROL_DENIED'); return;
    }
    if (control.action === 'cancel') {
      const canceled = await this.deliveryPlans.cancelPlan(row.id, row.planHash);
      await this.sendTrackedReply(event, [{ type: 'text', text: replyLanguage(event) === 'en' ? canceled ? 'Remaining answers cancelled; any completed record changes are kept.' : 'This answer has ended.' : canceled ? 'หยุดส่งส่วนที่เหลือแล้วค่ะ การหยุดส่งคำตอบไม่ย้อนรายการที่บันทึกไปแล้ว' : 'คำตอบชุดนี้สิ้นสุดแล้วค่ะ' }]);
      await this.updateEventLog(event.webhookEventId, 'completed'); return;
    }
    const continued = await this.deliveryPlans.continuePlan(row.id, row.planHash, control.next);
    if (plan.producerKind === 'CAPTURE_OUTBOX' || plan.producerKind === 'LEDGER') {
      await this.sendTrackedReply(event, [{ type: 'text', text: replyLanguage(event) === 'en' ? continued ? 'Sending the remaining answers.' : 'This answer is already sending or has ended.' : continued ? 'กำลังส่งคำตอบส่วนที่เหลือค่ะ' : 'คำตอบส่วนนี้กำลังส่งหรือสิ้นสุดแล้วค่ะ' }]);
      await this.updateEventLog(event.webhookEventId, 'completed'); return;
    }
    const result = await this.replayDeliveryPlan(row.id, event);
    await this.updateEventLog(event.webhookEventId, result === 'ok' ? 'completed' : 'delivery_pending', result === 'ok' ? undefined : 'LINE_DELIVERY_V2_PENDING');
  }

  private async sendMessagesV2(event: LineTextEvent | LineReceiptUploadEvent, messages: LineReplyMessage[]): Promise<LineDeliveryResult> {
    const existing = await this.prisma.client.lineTurnOutcome.findUnique({ where: { webhookEventId: event.webhookEventId }, include: { deliveryPlan: true } });
    if (existing) {
      if (existing.presentationKind !== 'delivery_plan_v2' || !existing.deliveryPlan) return 'failed_other';
      return this.rememberDelivery(event, await this.replayDeliveryPlan(existing.deliveryPlan.id, event, 2));
    }
    await this.persistSemanticTaskCompletion(event);
    const log = await this.prisma.client.lineWebhookEventLog.findUnique({ where: { webhookEventId: event.webhookEventId } });
    if (!log) return 'failed_other';
    const reimbursement = this.deliveryReimbursements.get(event)?.result;
    const expenseActionSource = this.deliveryExpenseActions.get(event);
    const substituteAction = this.deliverySubstituteActions.get(event);
    const expenseAction = (substituteAction?.applied || substituteAction?.preview.webOnly ? undefined : substituteAction?.preview) ?? (expenseActionSource?.applied ? undefined : expenseActionSource?.preview);
    const counterpartyView = this.deliveryCounterparties.get(event)?.preview;
    const packageView = this.deliveryPackagePurchases.get(event)?.view;
    const previewExpiry = Math.min(counterpartyView ? Date.parse(counterpartyView.expiresAt) : Infinity, packageView ? Date.parse(packageView.expiresAt) : Infinity, expenseAction ? Date.parse(expenseAction.expiresAt) : Infinity, reimbursement?.status === 'preview' ? Date.parse(reimbursement.preview.expiresAt) : Infinity);
    const now = new Date(), expiresAt = new Date(Math.min(log.createdAt.getTime() + 60 * 60_000, now.getTime() + 60 * 60_000, previewExpiry)).toISOString();
    const authorization = await this.webhookPlanAuthorization(event, expiresAt);
    if (!authorization) return 'failed_other';
    const outcomeId = deliveryHash(['line-outcome-v2', event.webhookEventId]);
    const planId = lineDeliveryPlanId('WEBHOOK', outcomeId);
    const draft = this.deliveryDraftPreviews.get(event);
    const previewProof = authorization.kind === 'PRIVATE' ? authorization.proofs.find(p => p.kind === 'EXPENSE_EDIT_PREVIEW') : undefined;
    const reimbursementControlIndex = reimbursement?.status === 'preview' ? messages.findIndex(m => m.type === 'flex' && JSON.stringify(m.contents).includes('reimbursement_draft_confirm')) : -1;
    const controlIndex = draft?.phase === 'PENDING' ? messages.findIndex(m => m.type === 'flex' && JSON.stringify(m.contents).includes('action=draft-update-confirm')) : -1;
    const items: Array<Omit<DeliveryPlanV2['answer']['items'][number], 'id'>> = messages.map(message => {
      const text = message.type === 'text' ? message.text : message.type === 'flex' ? message.canonicalText : null;
      if (!text) throw new Error('LINE_PLAN_CANONICAL_TEXT_REQUIRED');
      return { kind: 'answer' as const, text, required: true, sourceProofIds: authorization.kind === 'PRIVATE' ? authorization.proofs.map(p => p.id) : [] };
    });
    if (authorization.kind === 'PRIVATE') {
      const quoteProof = authorization.proofs.find(proof => proof.kind === 'QUOTE_REFERENCES');
      if (quoteProof) {
        quoteProof.items = await Promise.all(messages.map(async (message, i) => ({ itemId: `${planId}:item:${i}`, records: await this.quoteRecordsForMessage(event, message) })));
      }
    }
    const pending = (this.semanticDelivery.get(event) ?? []).filter(item => item.status === 'needs_user');
    const qaResult = parseLineDocumentQaResult(this.documentQaDelivery.get(event)?.resultJson);
    const failedPages = qaResult?.coverage.failed ?? [];
    const attachmentIds = [...new Set(qaResult?.coverage.requested.map(page => page.attachmentId) ?? [])];
    const pendingSubrequestIds = [...pending.map(item => String(item.index)),
      ...failedPages.map(page => `file:${page.attachmentId}:page:${page.page}`)];
    const missingLimitations: string[] = [];
    for (const limitation of [
      ...pending.map(item => ({ match: item.question, text: item.question ?? (replyLanguage(event) === 'en' ? "Please provide more information to continue." : 'ขอข้อมูลเพิ่มเติมเพื่อทำรายการต่อค่ะ') })),
      ...failedPages.map(page => {
        const text = (replyLanguage(event) === 'en' ? `Could not read attachment ${attachmentIds.indexOf(page.attachmentId) + 1} page ${page.page}.` : `ยังอ่านเอกสารแนบลำดับที่ ${attachmentIds.indexOf(page.attachmentId) + 1} หน้า ${page.page} ไม่สำเร็จ`);
        return { match: text, text };
      }),
    ]) {
      const existingItem = limitation.match && items.find(item => item.text.includes(limitation.match!));
      if (existingItem) existingItem.kind = 'limitation'; // Preserve the exact wire text and source proof.
      else missingLimitations.push(limitation.text);
    }
    if (missingLimitations.length) items.push({ kind: 'limitation', required: true, sourceProofIds: [],
      text: missingLimitations.join('\n') });
    const expenseActionControlIndex = expenseAction ? messages.findIndex(m => m.type === 'flex' && JSON.stringify(m.contents).includes('expense_action_confirm')) : -1;
    const packageControlIndex = packageView && !packageView.payment ? messages.findIndex(m => m.type === 'flex' && JSON.stringify(m.contents).includes('package_purchase_confirm')) : -1;
    const counterpartyControlIndex = counterpartyView ? messages.findIndex(m => m.type === 'flex' && JSON.stringify(m.contents).includes('counterparty_confirm')) : -1;
    const financialControlIndex = counterpartyControlIndex >= 0 ? counterpartyControlIndex : packageControlIndex >= 0 ? packageControlIndex : expenseActionControlIndex >= 0 ? expenseActionControlIndex : reimbursementControlIndex >= 0 ? reimbursementControlIndex : controlIndex;
    const control = counterpartyView && counterpartyControlIndex >= 0
      ? { kind: 'COUNTERPARTY_CONFIRM' as const, token: counterpartyView.token, expiresAt: counterpartyView.expiresAt, requiredItemIds: items.map((_x, i) => `${planId}:item:${i}`) }
      : packageView && packageControlIndex >= 0
      ? { kind: 'PACKAGE_PURCHASE_CONFIRM' as const, token: packageView.token, expiresAt: packageView.expiresAt, requiredItemIds: items.map((_x, i) => `${planId}:item:${i}`) }
      : expenseAction && expenseActionControlIndex >= 0
      ? { kind: 'EXPENSE_ACTION_CONFIRM' as const, token: expenseAction.token, expiresAt: expenseAction.expiresAt, requiredItemIds: items.map((_x, i) => `${planId}:item:${i}`) }
      : reimbursement?.status === 'preview' && reimbursementControlIndex >= 0
      ? { kind: 'REIMBURSEMENT_DRAFT_CONFIRM' as const, actionId: reimbursement.preview.actionId, previewRevision: reimbursement.preview.previewRevision, confirmationDigest: reimbursement.preview.confirmationDigest, expiresAt: reimbursement.preview.expiresAt, requiredItemIds: items.map((_x, i) => `${planId}:item:${i}`) }
      : controlIndex >= 0 && previewProof && draft?.previewId ? { kind: 'EXPENSE_EDIT_CONFIRM' as const, previewId: draft.previewId, previewRevision: String(previewProof.previewRevision), expiresAt, requiredItemIds: items.map((_x, i) => `${planId}:item:${i}`) } : null;
    if (authorization.kind === 'PRIVATE' && financialControlIndex >= 0) {
      const quoteProof = authorization.proofs.find(proof => proof.kind === 'QUOTE_REFERENCES');
      if (quoteProof) quoteProof.controlRecords = await this.quoteRecordsForMessage(event, messages[financialControlIndex]!);
    }
    // A photo/file turn reports a file the server already stored (and usually the draft it became), so
    // like a QA job its answer is a durable obligation for the plan's lifetime — not a conversational
    // answer that is late after the foreground deadline. A second photo queued behind the first one
    // (UAT 2026-09-29) finished past that deadline, the plan failed validation and the draft was
    // never announced. A QA result keeps its own job deadline.
    // The same holds for any answer already finished when the foreground deadline has passed: a long
    // text turn used to throw PLAN_INVALID_LIFETIME here and end silent. Production delivered it.
    const durableMediaResult = !('messageText' in event);
    const qaDeadline = this.documentQaDelivery.get(event)?.jobDeadlineAt.getTime();
    const foregroundDeadline = qaDeadline ?? (log.budgetAuthorityJson as { grant?: { finalDeadlineAtMs?: number } } | null)?.grant?.finalDeadlineAtMs ?? log.createdAt.getTime() + 40_000;
    const plan = buildLineDeliveryPlan({ ...({ producerKind: 'WEBHOOK', producerId: outcomeId, createdAt: log.createdAt.toISOString(), readyAt: now.toISOString(), expiresAt,
      firstDispatchDeadlineAt: qaDeadline === undefined && (durableMediaResult || foregroundDeadline < now.getTime() + 500) ? expiresAt : new Date(foregroundDeadline).toISOString(), authorization, control, businessResult: reimbursement?.status === 'applied' ? { kind: 'REIMBURSEMENT_DRAFT', operationKey: String(reimbursement.receipt.actionId), committedAt: String(reimbursement.receipt.committedAt), recordIds: [String(reimbursement.receipt.requestId)], resultingRevisions: [String(reimbursement.receipt.appliedRequestUpdatedAt)] } : null,
      answer: { status: pendingSubrequestIds.length ? 'PARTIAL' : 'COMPLETE', pendingSubrequestIds, items },
      preferredMessages: items.map((_item, index) => index < messages.length && index !== financialControlIndex ? messages[index]! : null),
      ...(control ? { controlMessage: messages[financialControlIndex]! } : {}) }), language: replyLanguage(event) });
    // Spec §4 R-M2 / deliveredExpenseSummary regression: graduating to a delivery plan must not
    // silently drop the SAME access-proof recordTurnOutcome persists — see buildTurnAuthorizationJson.
    const authorizationJson = this.buildTurnAuthorizationJson(event, randomUUID());
    const saved = await this.deliveryPlans.savePlan({ kind: 'WEBHOOK', id: outcomeId }, plan, new Date(log.createdAt.getTime() + this.config.aiDataRetentionDays * 86400000), now, event.webhookEventId, authorizationJson);
    if (!saved) return 'failed_other';
    return this.rememberDelivery(event, await this.replayDeliveryPlan(saved.id, event, 2));
  }

  private rememberDelivery(event: object, result: LineDeliveryResult): LineDeliveryResult {
    if (result === 'ok') this.deliveredTextTurns.add(event);
    return result;
  }

  private async sendTrackedReply(event: { replyToken: string }, messages: LineReplyMessage[]): Promise<LineDeliveryResult> {
    return this.rememberDelivery(event, await this.lineReply.sendReply(event.replyToken, messages, ids => this.rememberSentQuote(event, ids, messages)));
  }

  private async sendTrackedPush(event: object, target: string, messages: LineReplyMessage[], operationId: string): Promise<LineDeliveryResult> {
    return this.rememberDelivery(event, await this.lineReply.sendPush(target, messages, operationId, ids => this.rememberSentQuote(event, ids, messages)));
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
    const bound = this.boundConversations.get(event);
    if (this.config.lineAiDeliveryPlanV2Enabled && this.config.lineAiTerminalOutcomeReplayEnabled && !this.intermediateDeliveries.has(event) && bound) {
      const result = await this.sendMessagesV2(event as LineTextEvent, messages);
      if (result !== 'ok') await this.updateEventLog(event.webhookEventId, 'delivery_pending', 'LINE_DELIVERY_V2_PENDING');
      return this.rememberDelivery(event, result);
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
        return this.rememberDelivery(event, 'ok');
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
    return this.rememberDelivery(event, result);
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
      result = await this.sendTrackedReply(event, outgoing);
    } catch (error) {
      this.logger.warn({ msg: 'LINE reply adapter threw unexpectedly', ...safeLineErrorDetails(error) });
      result = 'failed_other';
    }
    if (result === 'failed_token' || (result === 'failed_flex' && !this.config.lineAiFlexTextFallbackEnabled)) {
      if (!await this.mayDeliverBusinessReply(event)) return 'failed_permanent';
      this.logger.warn({ msg: 'line_push_fallback_used' });
      try {
        result = await this.sendTrackedPush(event, event.pushTargetId ?? event.lineUserId, outgoing, event.webhookEventId);
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
        const applied = draft.phase === 'APPLIED' && draft.previewId
          ? await this.draftUpdate?.appliedResult(draft.context, draft.chatKeyHash, draft.previewId) : null;
        const current = draft.phase === 'APPLIED' ? (applied?.status === 'applied' ? applied.preview : null)
          : await this.draftUpdate?.pendingPreview(draft.context, draft.chatKeyHash, draft.requestId);
        sourcesCurrent = sourcesCurrent && Boolean(draft.previewId && current?.previewId === draft.previewId);
        if (sourcesCurrent) denialCode = 'LINE_DELIVERY_ACCESS_CHANGED';
      }
      const purchase = this.deliveryPackagePurchases.get(event);
      if (purchase) {
        const view = await this.packagePurchases.current(purchase.context, chatKeyHashOf(event), purchase.view.token);
        sourcesCurrent = sourcesCurrent && !!view && deliveryHash(view) === deliveryHash(purchase.view);
      }
      const counterparty = this.deliveryCounterparties.get(event);
      if (counterparty) {
        const current = await this.counterparties.pending(counterparty.context, chatKeyHashOf(event));
        sourcesCurrent = sourcesCurrent && !!current && deliveryHash(current) === deliveryHash(counterparty.preview);
      }
      const substituteAction = this.deliverySubstituteActions.get(event);
      if (substituteAction) sourcesCurrent = sourcesCurrent && !!await this.substituteActions?.current(substituteAction.context, chatKeyHashOf(event), substituteAction.preview.token, substituteAction.applied);
      const action = this.deliveryExpenseActions.get(event);
      if (action) {
        const current = action.applied ? await this.expenseActions.appliedPreview(action.context, action.chat, action.preview.token)
          : await this.expenseActions.pending(action.context, action.chat, action.requestId);
        sourcesCurrent = sourcesCurrent && !!current && deliveryHash(current) === deliveryHash(action.preview);
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

  private async rememberSubstituteDeliverySource(event: LineTextEvent, context: RequestContext, result: LineSubstituteReceiptContinuationResult) {
    this.deliverySubstituteContinuations.set(event, result);
    if (!result.source && !result.expenseId && !result.candidateExpenseIds?.length && !result.resumeCapsule) return;
    if (result.status === 'FORBIDDEN' && !result.source) return; // Static permission guidance only.
    const proofs = this.deliverySubstituteSources.get(event) ?? [];
    proofs.push({ context, source: result.source }); this.deliverySubstituteSources.set(event, proofs);
    if (result.expenseId && result.status === 'READY_FOR_WEB' && this.substituteActions) {
      const offered = await this.substituteActions.prepare(context, chatKeyHashOf(event), result.expenseId, replyLanguage(event), result.decisionOffered);
      if (offered.preview) {
        this.deliverySubstituteActions.set(event, { context, preview: offered.preview });
        result.replyText = offered.preview.summary;
        result.pendingQuestion = undefined;
        result.resumeCapsule = undefined;
      }
      else if (offered.reply) result.replyText += `\n${offered.reply}`;
    }
  }

  private rememberCandidateDeliverySources(event: LineTextEvent, context: RequestContext, candidates: LineIntakeCorrectionCandidate[], originalChoices = false) {
    this.deliveryCandidates.set(event, { context, chatKeyHash: chatKeyHashOf(event), snapshot: JSON.stringify(candidates), originalChoices });
  }

  private async correctionCandidatesCurrent(ctx: RequestContext, chatKeyHash: string, snapshot: string, originalChoices = false): Promise<boolean> {
    if (!this.expenseRepo || (!RECEIPT_CAPTURE_PERMISSIONS.some(permission => ctx.permissions.includes(permission))
      && !ctx.permissions.includes('expense.update'))) return false;
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
    await this.ledger?.appendSubRequests({ ...input, ...(this.boundConversations.has(event) ? { reliabilityVersion: 2 as const } : {}), items: input.items.map(item => ({ ...item,
      sourceContext: this.clarificationSourceContext(event, item),
    })) });
  }

  /** Verify the old question itself, never relabel old wording with a newly read revision. */
  private async clarificationSourceCurrent(event: LineTextEvent, ctx: RequestContext, item: LineAiOpenClarification & { entry: Pick<LedgerEntry, 'sourceContext'> }): Promise<boolean> {
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
        const saved = source.draft.phase === 'APPLIED' && source.draft.previewId
          ? await this.draftUpdate?.appliedResult(ctx, source.chatKeyHash, source.draft.previewId) : null;
        const preview = source.draft.phase === 'APPLIED' ? saved?.status === 'applied' ? saved.preview : null
          : await this.draftUpdate?.pendingPreview(ctx, source.chatKeyHash, source.draft.requestId);
        if (!source.draft.previewId || preview?.previewId !== source.draft.previewId) return false;
      }
      if (source.draftRouting !== undefined && (!this.expenseDraftConversation
        || draftRoutingRevisions(await this.expenseDraftConversation.routeContexts(ctx, source.chatKeyHash))
          !== draftRoutingRevisions(JSON.parse(source.draftRouting)))) return false;
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

  /** The open work production passed to its router: waiting questions, correction targets, drafts and
   *  substitute state. `null` means a fail-closed gate has already answered the turn. */
  private async loadOpenWorkContext(event: LineTextEvent, requestId: string, ctx: RequestContext, input: {
    chatKey: string; corrections: boolean; drafts: boolean; substituteMode: string;
  }): Promise<LineOpenWorkContext | null> {
    let openWaiting: LineOpenWorkContext['openWaiting'];
    try {
      openWaiting = this.ledger ? await this.ledger.openWaitingUser(ctx.companyId, input.chatKey, ctx.userId) : [];
    } catch (err) {
      // Consumption-marker state is unreadable. Continuing with "no open clarifications" is NOT
      // fail-closed: a bare "590" answering an earlier question would be routed as a new capture.
      if (!(err instanceof ConsumptionMarkerUnavailableError)) throw err;
      // `reason` separates a missing consumer group, an unreadable Redis and an incomplete scan for
      // operators; the customer reply and the terminal status stay the same for all of them.
      this.logger.warn({ msg: 'line_ai_marker_unavailable', requestId, reason: err.reason });
      await this.deliverReply(event, ERROR_REPLY[replyLanguage(event)]);
      await this.updateEventLog(event.webhookEventId, 'marker_unavailable', 'CONSUMPTION_MARKER_UNAVAILABLE', ctx.companyId);
      return null;
    }
    if (!await this.waitingSourcesCurrent(event, ctx, openWaiting, true)) return null;
    const openClarifications: LineAiOpenClarification[] | undefined = openWaiting.length > 0
      ? openWaiting.map(({ id, question, text, subject, askedAt, reasonCode, clarifyForIntent, candidateExpenseIds, pendingMedia }) => ({
        id, question, text, ...(subject && { subject }), askedAt,
        ...(reasonCode && { reasonCode }),
        ...(clarifyForIntent && { clarifyForIntent }),
        ...(candidateExpenseIds?.length && { candidateExpenseIds }),
        ...(pendingMedia && { pendingMedia }),
      }))
      : undefined;
    // Correction targets: this user's recent captures in THIS chat, inside branch scope.
    const recentCapturedExpenses = input.corrections
      ? await this.loadCorrectionCandidates(ctx.companyId, ctx.userId, chatKeyHashOf(event), ctx.scopes ?? {})
      : [];
    let activeExpenseDrafts = input.drafts && this.expenseDraftConversation
      ? await this.expenseDraftConversation.routeContexts(ctx, chatKeyHashOf(event), replyLanguage(event))
      : [];
    const quotedExpenses = (await this.quotedRecordsForEvent(event)).filter(record => record.tool === 'expense.get_detail');
    if (quotedExpenses.length) activeExpenseDrafts = activeExpenseDrafts.filter(draft => quotedExpenses.some(record => record.id === draft.expenseId));
    // Bounded substitute context for the semantic router (DATA only, never authority). In PRIMARY the
    // AUTHORITATIVE workflowState (none/open/paused/multiple) is read from the continuation rows (execute
    // re-reads them before any action); OFF/SHADOW keep the cheap signal so the legacy path adds NO query.
    // `workflowState` is NEVER rewritten from a ledger clarification — a pending paraphrase-start
    // confirmation (which has no workflow row yet) is encoded ONLY via hasPendingQuestion, so the next
    // affirmative still inherits the substitute route without faking an OPEN workflow.
    const substituteContextBase: LineIntakeSubstituteContext = input.substituteMode === 'primary' && this.substituteReceiptContinuation
      ? await this.substituteReceiptContinuation.substituteContext(ctx, { chatKeyHash: chatKeyHashOf(event), recentCandidateCount: recentCapturedExpenses.length })
      : {
          workflowState: 'none', hasPendingQuestion: false, preparedState: 'none',
          recentCandidateCount: Math.min(recentCapturedExpenses.length, 5),
        };
    return { openWaiting, openClarifications, recentCapturedExpenses, activeExpenseDrafts, substituteContext: {
      ...substituteContextBase,
      hasPendingQuestion: substituteContextBase.hasPendingQuestion
        || openWaiting.some((item) => item.clarifyForIntent === 'SUBSTITUTE_RECEIPT_CONTINUATION'),
    } };
  }

  /** Owner 2026-09-29: production decides a reply to open work with its own matchers BEFORE routing —
   *  RECEIPT-05 (`classifyPendingMediaReply`), the question recorded on the pending file (check bill,
   *  substitute scan), and the draft controls. True only when this text is such an answer AND that work
   *  is open in this chat. Text first, so an ordinary question reads no pending state here. */
  private async answersOpenWork(event: LineTextEvent, ctx: RequestContext, drafts: boolean): Promise<boolean> {
    const text = event.messageText;
    if (isLineCounterpartyCommand(text)) return false;
    if (splitPendingMediaReply(text) || classifyPendingMediaReply(text) !== 'ambiguous' || checkBillPaymentChoice(text)
      || substituteScanConfirmAnswer(text) || numberedSelection(text, 9) !== undefined) {
      const rows = await this.prisma.client.lineIntakePendingMedia.findMany({
        where: { companyId: ctx.companyId, userId: ctx.userId, status: 'PENDING', expiresAt: { gt: new Date() }, ...this.pendingMediaBinding(event) },
        orderBy: { createdAt: 'asc' }, take: 6,
      });
      // Same row the RECEIPT-05 block answers; with several files and none chosen it asks which first.
      const chosen = rows.filter(row => (row.askedQuestionJson as { selectedForContinuation?: boolean } | null)?.selectedForContinuation === true);
      if (rows.length > 1 && chosen.length !== 1) return true;
      const row = chosen[0] ?? rows[0];
      const asked = row && this.substituteReceiptContinuation ? parseSubstituteMediaQuestion(row.askedQuestionJson, chatKeyHashOf(event)) : undefined;
      if (row && (!asked ? !!splitPendingMediaReply(text) || classifyPendingMediaReply(text) !== 'ambiguous'
        : asked.kind === 'CHECK_BILL_ACTION' ? !!checkBillPaymentChoice(text)
          : asked.kind === 'SUBSTITUTE_SCAN_CONFIRM' ? !!substituteScanConfirmAnswer(text)
            : asked.kind === 'SUBSTITUTE_SCAN_PICK' ? numberedSelection(text, asked.evidenceIds.length) !== undefined
              : !!substituteMediaAnswer(text, asked.choices))) return true;
    }
    if (!drafts || !this.expenseDraftConversation) return false;
    const open = await this.expenseDraftConversation.routeContexts(ctx, chatKeyHashOf(event), replyLanguage(event));
    return open.length > 0 && (isDeterministicLineExpenseDraftInput(text)
      || !!await this.expenseDraftConversation.answersOpenDraft?.(ctx, chatKeyHashOf(event), text));
  }

  private async waitingSourcesCurrent(event: LineTextEvent, ctx: RequestContext, open: Array<LineAiOpenClarification & { entry: LedgerEntry }>, dropStale = false): Promise<boolean> {
    const stale: string[] = [];
    for (const item of open) if (!await this.clarificationSourceCurrent(event, ctx, item)) stale.push(item.id);
    if (!stale.length) return true;
    // A durable refusal prevents this unsafe question from trapping every later fresh request.
    await this.consumeClarifications(ctx.companyId, event.pushTargetId ?? event.lineUserId, ctx.userId, open, stale, 'clarification_source_changed');
    // Retire stale work without blocking an independent question. A choice, field answer or
    // requested mutation must never be rebound to today's candidates after losing its proof.
    const text = normalizeLineText(event.messageText);
    const independentQuestion = (isInterveningQuestionText(text) || /ทำไม|\bwhy\b/iu.test(text))
      && !isDeterministicLineExpenseDraftInput(text)
      && !/^(?:[\d๐-๙]|(?:รายการ|ร่าง|บิล|ใบเสร็จ)(?:ที่)?\s*[\d๐-๙])/u.test(text)
      && !/(?:แก้|เปลี่ยน|บันทึก|สร้าง|เก็บ|ยืนยัน|ยกเลิก|ลบ|อนุมัติ|ชำระ|โอน|\b(?:change|edit|save|create|confirm|cancel|delete|approve|pay|transfer)\b)/iu.test(text);
    if (dropStale && independentQuestion) {
      const current = open.filter(item => !stale.includes(item.id));
      open.splice(0, open.length, ...current);
      return true;
    }
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
        ? (replyLanguage(event) === 'en' ? "Please use a private chat; if you already submitted a request, check its status on the web before repeating it." : 'เพื่อความเป็นส่วนตัว กรุณาเปิดแชตส่วนตัวกับมั่งมี หากส่งรายการไว้แล้วให้ตรวจในเว็บก่อนส่งซ้ำค่ะ')
        : denialCode !== 'LINE_DELIVERY_ACCESS_CHANGED'
          ? (replyLanguage(event) === 'en' ? "The source data changed or could not be verified; check the record on the web before asking again or repeating a create request." : 'ข้อมูลต้นทางเปลี่ยนหรือยังตรวจสอบไม่ได้ กรุณาเปิดเว็บเพื่อตรวจรายการหรือถามใหม่ หากส่งรายการไว้แล้วให้ตรวจในเว็บก่อนส่งซ้ำค่ะ')
          : (replyLanguage(event) === 'en' ? "Your access or selected shop changed; select the shop and check any existing request on the web before asking again." : 'สิทธิ์หรือร้านที่เลือกเปลี่ยนระหว่างดำเนินการ กรุณาเลือกร้านแล้วถามใหม่ หากส่งรายการไว้แล้วให้ตรวจในเว็บก่อนส่งซ้ำค่ะ'))];
      try {
        const result = await this.sendTrackedReply(event, messages);
        if (result === 'failed_token') await this.sendTrackedPush(event, event.pushTargetId ?? event.lineUserId, messages, `${event.webhookEventId}:access-denied`);
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
  /** Spec §4 R-M2, and the pre-existing deliveredExpenseSummary/expense-criterion-confirmation
   *  proofs: the SAME access-proof shape every LineTurnOutcome.authorizationJson write persists, so
   *  loadConversationContext reads either writer back the same way — the legacy upsert path
   *  (recordTurnOutcome, below) or the delivery-plan-v2 path (sendMessagesV2, via
   *  LineLedgerDeliveryService.savePlan). A pure function of the event's own WeakMap state, never DB
   *  state, so either caller can build it before its own, very different write happens. */
  private buildTurnAuthorizationJson(
    event: { webhookEventId: string; lineUserId: string; pushTargetId?: string; messagingChannelId?: string },
    producerId: string,
  ): Prisma.InputJsonValue {
    const access = this.deliveryAccess.get(event), sources = this.deliverySources.get(event);
    const topic = this.publicPolicyTopics.get(event);
    const recipientHash = lineDeliveryRecipientHash(event.lineUserId, event.pushTargetId ?? event.lineUserId, event.messagingChannelId ?? '');
    const noOtherSource = !this.deliveryExpenseActions.has(event) && !this.deliveryDraftPreviews.has(event) && !this.deliveryReceiptSources.has(event)
      && !this.deliverySubstituteSources.has(event) && !this.deliveryCandidates.has(event);
    return { v: 1, producerId,
      ...(topic ? { publicPolicy: { topic, recipientHash } } : {}),
      ...(access && sources?.ids?.length === 0 && sources.expenseCriterionConfirmation === true && noOtherSource ? { access: {
        kind: 'expense_criterion_confirmation', userId: access.userId, companyId: access.companyId, membershipId: access.membershipId,
        fingerprint: access.fingerprint, webhookEventId: event.webhookEventId, recipientHash, channelId: event.messagingChannelId ?? '',
        chatKeyHash: chatKeyHashOf(event),
      } } : {}),
      ...(access && sources?.ids?.length && noOtherSource ? { read: {
        userId: access.userId, companyId: access.companyId, fingerprint: access.fingerprint,
        requestId: sources.requestId, ids: sources.ids, webhookEventId: event.webhookEventId,
        recipientHash, channelId: event.messagingChannelId ?? '',
      } } : {}),
      ...(access && sources?.expenseSummary && sources.ids?.length && noOtherSource ? { expenseSummary: {
        userId: access.userId, companyId: access.companyId, membershipId: access.membershipId,
        fingerprint: access.fingerprint, chatKeyHash: chatKeyHashOf(event), recipientHash,
        statusBasis: sources.expenseSummary.statusBasis, continuationOfPrior: sources.expenseSummary.continuationOfPrior === true,
        ranges: sources.expenseSummary.ranges,
      } } : {}),
      // Spec §4 R-M2: same access-proof shape as expenseSummary above, so loadConversationContext's
      // existing identity/chat/recipient re-check (§4 R-M7: none of this survives a scope change)
      // covers this too without a second verification path.
      ...(access && sources?.recentReads?.length && sources.ids?.length && noOtherSource ? { readMemory: {
        userId: access.userId, companyId: access.companyId, membershipId: access.membershipId,
        fingerprint: access.fingerprint, chatKeyHash: chatKeyHashOf(event), recipientHash,
        entries: sources.recentReads,
      } } : {}),
    };
  }

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
      const producerId = randomUUID();
      const authorizationJson = this.buildTurnAuthorizationJson(event, producerId);
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
    event: {
      lineUserId: string;
      messagingChannelId?: string;
      companyIdAtAcceptance?: string;
      snapshotAssistantPause?: boolean;
    },
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
    if (required) return { status: 'required', companyId: resolved.companyId };
    const assistantPaused = event.snapshotAssistantPause
      && await this.assistantPaused(event.lineUserId);
    return {
      status: 'continue', companyId: resolved.companyId,
      ...(assistantPaused ? { assistantPaused: true as const } : {}),
    };
  }

  /** Public admission metadata only: no membership, company profile, private context or ERP read. */
  async preflightPublicGeneral(event: { lineUserId: string; messagingChannelId: string; chatId: string; channelKind?: 'USER'|'GROUP'|'ROOM' }, existingPlan = false) {
    if (!existingPlan && (this.config.lineAiReliabilityV2Mode !== 'on' || !this.config.lineAiDeliveryPlanV2Enabled)
      || event.messagingChannelId !== this.config.lineMessagingChannelId
      || !isLineAiRolloutAllowed(this.config.lineAiDeliveryPlanV2PublicChannelIds, event.messagingChannelId)) return null;
    await this.launchGate.assertLaunchRouteOpen('ai_line_assistant');
    const channels = await this.prisma.client.lineChannelBinding.findMany({ where: { messagingChannelId: event.messagingChannelId, status: 'ACTIVE', company: { status: 'ACTIVE' } }, select: { id: true, companyId: true, updatedAt: true }, take: 2 });
    if (channels.length !== 1) return null;
    const binding = channels[0]!;
    const identity = await this.prisma.client.externalIdentity.findFirst({ where: { provider: 'LINE', providerChannelId: event.messagingChannelId, providerUserId: event.lineUserId, status: 'ACTIVE' }, select: { userId: true, user: { select: { status: true, aiAssistantOptOutAt: true } } } });
    // No anonymous consent exemption is invented: this gate uses only current policy evidence.
    if (!identity || identity.user.status !== 'ACTIVE' || identity.user.aiAssistantOptOutAt
      || await this.legalAcceptance.isPublicAiAcceptanceRequired(identity.userId) || await this.assistantPaused(event.lineUserId)) return null;
    const features = await loadEntitledFeatureKeys(this.prisma, binding.companyId);
    if (lineAssistantDisabledFor(features)) return null;
    return { companyId: binding.companyId, actorUserId: identity.userId,
      policyDigest: deliveryHash({ version: 2, bindingId: binding.id, updatedAt: binding.updatedAt.toISOString(), features: features ? [...features].sort() : null }) };
  }

  private async executePublicGeneral(event: LineTextEvent, requestId: string): Promise<void> {
    const target = event.pushTargetId ?? event.lineUserId;
    const channelKind = event.channelKind === 'GROUP' || event.channelKind === 'ROOM' ? event.channelKind : target !== event.lineUserId ? 'GROUP' : 'USER';
    const admission = await this.preflightPublicGeneral({ lineUserId: event.lineUserId, messagingChannelId: event.messagingChannelId, chatId: target, channelKind }).catch(() => null);
    if (!admission) {
      const messages = [{ type: 'text' as const, text: (replyLanguage(event) === 'en' ? "AI replies are unavailable in this chat; please send document or shop-data requests in a private chat." : 'แชตนี้ยังไม่พร้อมตอบด้วย AI ค่ะ งานเอกสารหรือข้อมูลบริษัทกรุณาส่งในแชตส่วนตัว') }];
      const result = await this.sendTrackedReply(event, messages);
      if (result === 'failed_token') await this.sendTrackedPush(event, target, messages, `public-unavailable:${event.webhookEventId}`);
      await this.updateEventLog(event.webhookEventId, 'public_unavailable'); return;
    }
    const log = await this.prisma.client.lineWebhookEventLog.findUniqueOrThrow({ where: { webhookEventId: event.webhookEventId } });
    // Public admission deliberately has no private conversation binding. Verify its complete input
    // against the accepted webhook timestamp without consulting private context.
    const evidence = event.inputEvidence ? await verifyLineAiInputEvidence(event.inputEvidence, event.messageText)
      : (await createLineAiInputEvidence({ turnKey: deliveryHash(event.webhookEventId), parts: [{ partId: 'part-0',
          eventIdHash: deliveryHash(event.webhookEventId), acceptedAtMs: log.createdAt.getTime(), rawText: event.messageText }] }))?.inputEvidence;
    if (!evidence) { await this.updateEventLog(event.webhookEventId, 'input_rejected', 'LINE_INPUT_EVIDENCE_INVALID'); return; }
    await this.prisma.client.lineWebhookEventLog.update({ where: { id: log.id }, data: { companyId: admission.companyId } });
    const accepted = evidence.parts.map(part => part.acceptedAtMs), first = Math.min(...accepted), last = Math.max(...accepted);
    const grant = await this.aiGateway.issueLineReliabilityGrant(requestId, { authorityKind: 'webhook_event', authorityId: log.id,
      owner: { kind: 'PUBLIC_GENERAL', owner: { companyId: admission.companyId, channel: 'line', channelKind, messagingChannelId: event.messagingChannelId, chatKeyHash: chatKeyHashOf(event) } },
      turnKey: evidence.turnKey, attemptKey: deliveryHash(['public-turn-v2', event.webhookEventId]), inputDigest: evidence.joinedSha256, requestKind: 'TEXT',
      admittedAtMs: first, coalescingExtraMs: Math.min(6000, Math.max(0, last - first)), lane: 'general', allowedProfileIds: ['line-answer/2'] });
    if (!grant) { await this.sendTrackedReply(event, [{ type: 'text', text: AI_BUDGET_UNAVAILABLE_REPLY[replyLanguage(event)] }]); await this.updateEventLog(event.webhookEventId, 'provider_unavailable', 'AI_BUDGET_UNAVAILABLE'); return; }
    const response = await this.aiGateway.requestLinePublicGeneral({ requestId, webhookEventId: event.webhookEventId, kind: 'PUBLIC_GENERAL', messageText: event.messageText,
      inputEvidence: evidence, budgetGrantV2: grant, contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'], publicAdmission: { channelKind, channelKeyHash: chatKeyHashOf(event), payerCompanyId: admission.companyId, admissionId: log.id } });
    if (response.status !== 'answered' || Date.now() >= grant.finalDeadlineAtMs - 500) {
      await this.sendTrackedReply(event, [{ type: 'text', text: (replyLanguage(event) === 'en' ? "I could not finish this answer; no shop data was read or changed." : 'ยังตอบคำขอนี้ไม่สำเร็จค่ะ ระบบไม่ได้อ่านหรือทำรายการในบริษัทให้') }]);
      await this.updateEventLog(event.webhookEventId, 'provider_unavailable', response.errorCode ?? 'DEADLINE_EXCEEDED'); return;
    }
    const now = new Date(), expiresAt = new Date(log.createdAt.getTime() + 60 * 60_000).toISOString(), outcomeId = deliveryHash(['line-outcome-v2', event.webhookEventId]);
    const current = await this.prisma.client.lineWebhookEventLog.findUniqueOrThrow({ where: { id: log.id } });
    const authorization: DeliveryAuthorizationV2 = { v: 2, kind: 'PUBLIC_GENERAL', admissionOwner: { kind: 'WEBHOOK', id: outcomeId, revision: current.budgetAuthorityRevision },
      destination: { channelId: event.messagingChannelId, channel: 'line', channelKind, lineTargetId: target, targetHash: deliveryHash(target), chatKeyHash: chatKeyHashOf(event) }, actorUserId: admission.actorUserId,
      initiatorHash: deliveryHash(event.lineUserId), admissionPolicyDigest: admission.policyDigest, sourceManifestDigest: deliveryHash('public-general:2.4'), approvedPublicSourceIds: [], issuedAt: now.toISOString(), expiresAt };
    const plan = buildLineDeliveryPlan({ ...({ producerKind: 'WEBHOOK', producerId: outcomeId, createdAt: log.createdAt.toISOString(), readyAt: now.toISOString(), expiresAt, firstDispatchDeadlineAt: new Date(grant.finalDeadlineAtMs).toISOString(), authorization,
      control: null, businessResult: null, answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: [{ kind: 'answer', text: response.replyText, required: true, sourceProofIds: [] }] } }), language: replyLanguage(event) });
    // Same access-proof shape recordTurnOutcome persists — see buildTurnAuthorizationJson. A public
    // turn has no deliveryAccess/deliverySources of its own, so this is just {v, producerId}.
    const authorizationJson = this.buildTurnAuthorizationJson(event, randomUUID());
    const saved = await this.deliveryPlans.savePlan({ kind: 'WEBHOOK', id: outcomeId }, plan, new Date(log.createdAt.getTime() + this.config.aiDataRetentionDays * 86400000), now, event.webhookEventId, authorizationJson);
    if (!saved) { await this.updateEventLog(event.webhookEventId, 'delivery_pending', 'LINE_OUTCOME_RECOVERY_REQUIRED'); return; }
    const delivered = await this.replayDeliveryPlan(saved.id, event, 2);
    await this.updateEventLog(event.webhookEventId, delivered === 'ok' ? 'completed' : 'delivery_pending', delivered === 'ok' ? undefined : 'LINE_DELIVERY_V2_PENDING', admission.companyId);
  }

  private async verifyPublicPlan(plan: DeliveryPlanV2, event: { lineUserId: string; pushTargetId?: string; messagingChannelId?: string }): Promise<boolean> {
    if (plan.authorization.kind !== 'PUBLIC_GENERAL' || plan.control || plan.businessResult) return false;
    const auth = plan.authorization, d = auth.destination;
    if (event.messagingChannelId !== d.channelId || deliveryHash(event.lineUserId) !== auth.initiatorHash || (event.pushTargetId ?? event.lineUserId) !== d.lineTargetId
      || deliveryHash(d.lineTargetId) !== d.targetHash || Date.parse(auth.expiresAt) <= Date.now() || auth.approvedPublicSourceIds.length || auth.sourceManifestDigest !== deliveryHash('public-general:2.4')) return false;
    const current = await this.preflightPublicGeneral({ lineUserId: event.lineUserId, messagingChannelId: d.channelId, chatId: d.lineTargetId, channelKind: d.channelKind }, true);
    if (!current || current.actorUserId !== auth.actorUserId || current.policyDigest !== auth.admissionPolicyDigest) return false;
    const outcome = await this.prisma.client.lineTurnOutcome.findUnique({ where: { id: auth.admissionOwner.id }, include: { event: true } });
    const owner = outcome?.event;
    return !!owner && owner.companyId === current.companyId && owner.budgetAuthorityRevision === auth.admissionOwner.revision && owner.deliveryOwnerId === 'webhook'
      && !['cancelled', 'expired', 'revoked'].includes(owner.status);
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
    try { await this.executeText(event); }
    finally {
      // A failed plan build used to leave delivery_pending with neither a reply nor recoverable bytes.
      // This plain failure contains no business facts; never replace an existing durable answer.
      if (this.deliveryAccess.has(event) && !this.deliveredTextTurns.has(event) && !this.deliveryDenialNotified.has(event) && !this.intentionalNoReplyTurns.has(event)) {
        try {
          const saved = await this.prisma.client.lineTurnOutcome.findUnique({ where: { webhookEventId: event.webhookEventId } });
          if (!saved) {
            const owner = await this.prisma.client.lineWebhookEventLog.updateMany({ where: { webhookEventId: event.webhookEventId,
              OR: [{ deliveryOwnerId: null }, { deliveryOwnerId: 'webhook' }] }, data: { deliveryOwnerId: 'webhook' } });
            if (owner.count === 1) {
              const messages = [this.lineReply.buildTextMessage(ERROR_REPLY[replyLanguage(event)])];
              const result = await this.sendTrackedReply(event, messages);
              if (result === 'failed_token') await this.sendTrackedPush(event, event.pushTargetId ?? event.lineUserId, messages, `${event.webhookEventId}:fallback`);
            }
          }
        } catch (error) { this.logger.warn({ msg: 'line_text_fallback_unavailable', webhookEventId: event.webhookEventId, ...safeLineErrorDetails(error) }); }
      }
    }
  }

  private async executeText(event: LineTextEvent): Promise<void> {
    const mediaContinuation = this.mediaTextContinuations.get(event);
    const requestId = mediaContinuation?.requestId ?? randomUUID();

    // 1. Atomically claim the event. The message buffer may have created the
    //    `received` row already; processedAt is the compare-and-set claim marker.
    if (!mediaContinuation && !await this.claimWebhookEvent(event.webhookEventId, event.lineUserId)) {
      this.logger.log({ msg: 'Duplicate webhook event skipped', webhookEventId: event.webhookEventId });
      return;
    }

    if (event.answerDeliveryControl) { await this.handleAnswerDeliveryControl(event); return; }
    if (event.channelKind === 'GROUP' || event.channelKind === 'ROOM' || event.pushTargetId && event.pushTargetId !== event.lineUserId) {
      if (event.counterpartyControl || event.expenseActionControl || event.packagePurchaseControl || isPackagePurchaseIntent(event.messageText)) {
        await this.deliverReply(event, (replyLanguage(event) === 'en' ? "Please continue in a private chat." : 'กรุณาทำรายการในแชตส่วนตัวค่ะ'));
        await this.updateEventLog(event.webhookEventId, 'expense_action_private_required');
      } else await this.executePublicGeneral(event, requestId);
      return;
    }

    // Public deterministic command: the verified controller and event claim already ran, but no
    // identity, company, acceptance, permission, entitlement, or model read is needed.
    const publicCommand = staffMenuCommand(event.messageText);
    // The staff door (§3.1): closes the trap where an employee with no email signs their shop up a
    // second time. Public because nobody arriving here has an account yet by definition.
    if (publicCommand === 'employee') {
      await this.deliverReply(event, EMPLOYEE_DOOR_REPLY[replyLanguage(event)]);
      await this.updateEventLog(event.webhookEventId, 'line_employee_door');
      return;
    }
    if (publicCommand === 'staff_contact') {
      await this.handleStaffContact(event, requestId);
      return;
    }
    // G19: public like its twin above, and likewise above the pause gate; it never sets a pause.
    if (publicCommand === 'package_callback') {
      await this.handlePackageCallback(event, requestId);
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
      await this.deliverRequiredMessages(event, [buildContactCard(replyLanguage(event))]);
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
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.ASSISTANT_TALK_GREETING : ASSISTANT_TALK_GREETING));
      await this.updateEventLog(event.webhookEventId, 'staff_menu_talk');
      return;
    }
    // Rich menu Promotion tile (Owner design 2026-08-27). Still public — a prospect exploring
    // packages may well be unlinked — but since 2026-09-21 the card leads into the app, so it reads
    // who tapped it (identity + owned shops only) to decide its main button. No other gate runs:
    // the card names no company and no plan, and nothing on it changes anything.
    if (publicCommand === 'promotion') {
      this.publicPolicyTopics.set(event, 'trial');
      // Owner 2026-09-30: the package poster first, then the card, for every audience.
      const poster = buildPackagePosterMessage(this.config.webBaseUrl, replyLanguage(event));
      await this.deliverRequiredMessages(event, [...(poster ? [poster] : []), await this.promotionCard(event)]);
      await this.updateEventLog(event.webhookEventId, 'staff_menu_promotion');
      return;
    }
    // Public trial policy contains no account data and needs no AI. Ordinary support text still
    // belongs to the human handling the case; do not resume the assistant or swallow that reply.
    const previousPolicy = isPublicPolicyFollowUp(event.messageText) ? await this.lastDeliveredPublicPolicy(event) : undefined;
    const policyAnswer = resolvePublicPolicyAnswer(event.messageText, previousPolicy);
    if (policyAnswer && !await this.assistantPaused(event.lineUserId)) {
      this.publicPolicyTopics.set(event, policyAnswer.topic);
      await this.deliverRequiredMessages(event, [buildPublicPolicyCardMessage(policyAnswer, replyLanguage(event))]);
      await this.updateEventLog(event.webhookEventId, 'staff_menu_trial_pricing');
      return;
    }
    // 3. Resolve LINE user → internal user via ExternalIdentity, scoped to the webhook's channel.
    const identity = await this.resolveLineIdentity(event);

    if (identity?.user.status === 'ACTIVE' && isOpenShopHelpQuestion(event.messageText) && !await this.assistantPaused(event.lineUserId)) {
      await this.handleCompanyCommand(event, requestId, identity.userId, identity.user.displayName, { kind: 'list' }, OPEN_SHOP_HELP_ANSWER);
      return;
    }

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
        await this.deliverRequiredMessages(event, [buildCapabilityCard(replyLanguage(event))]);
        await this.updateEventLog(event.webhookEventId, 'staff_menu_capability');
        return;
      }
      // A REQUEST_INFO applicant or unlinked person may already be in a managed human-support
      // conversation even though they have no account/company context to pause. Ordinary text is
      // their answer to that case; public menu/signup/resume commands keep their explicit routes.
      if (publicCommand === null) {
        const recorded = await this.recordSupportFollowUp(event.lineUserId, requestId, { text: event.messageText, lineMessageId: event.lineMessageId });
        if (recorded !== 'none') {
          await this.deliverReply(event, SUPPORT_FOLLOW_UP_REPLIES[recorded]);
          await this.updateEventLog(event.webhookEventId, 'support_follow_up');
          return;
        }
      }
      // P10-L §3.1: the plain "link your account first" line was a dead end for the one person who
      // has no account to link. The same card the door sends, so both entrances agree — and a
      // `follow` from a stranger lands here too, which is what makes G-03 an answer. A follow ALSO
      // gets the greeting in front of it (Owner 2026-09-21); a typed message gets the card alone,
      // because the hello belongs to the moment the friend was added.
      const invitedEntry = publicCommand === 'follow';
      await this.deliverRequiredMessages(event, await this.entryDoorMessages(event.lineUserId, invitedEntry, replyLanguage(event)));
      // L-B follow-up (c): adding the OA as a friend is the INVITED first step of this flow, not an
      // attempt to reach anything. Recording it DENIED puts every prospect into a security signal
      // whose whole value is that it is rare — the door card is the correct, successful answer to
      // them. A message or a postback from an unlinked stranger is still a real access attempt and
      // keeps its DENIED row.
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
      // …but "ส่งรูปใบเสร็จ หรือถามยอดขาย" is an invitation the assistant would only refuse while the
      // chat's shop is locked, so that customer hears the lock reply their next message would get.
      if (!await resolveCompanyForLineUser(this.prisma, identity.userId, event.lineUserId)
        && await this.replyIfCompanyLocked(event, identity.userId)) return;
      await this.deliverReply(event, WELCOME_BACK_REPLY[replyLanguage(event)]);
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
    if (publicCommand === 'package_change' && await this.handlePackagePurchase(event, identity.userId, requestId)) return;
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
    const deterministicCommand = !!event.counterpartyControl || !!event.packagePurchaseControl || !!event.expenseActionControl || !!event.reimbursementDraftControl || publicCommand !== null
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
      const recorded = await this.recordSupportFollowUp(event.lineUserId, requestId, { text: event.messageText, lineMessageId: event.lineMessageId });
      await this.deliverReply(event, SUPPORT_FOLLOW_UP_REPLIES[recorded]);
      await this.updateEventLog(event.webhookEventId, 'support_paused');
      return;
    }

    // PDPA opt-out gate (M-05 §3.1). `user` is already loaded by the identity include, so
    // this costs no extra query; the status string is the discriminator in the event log.
    if (identity.user.aiAssistantOptOutAt) {
      await this.deliverReply(event, AI_OPT_OUT_REPLY[replyLanguage(event)]);
      await this.updateEventLog(event.webhookEventId, 'ai_opt_out', LINE_AI_ERROR_CODES.FORBIDDEN);
      return;
    }

    const companyCommand = parseLineCompanyCommand(event.messageText)
      ?? await this.pendingCompanySelectionCommand(event);
    if (companyCommand) {
      await this.handleCompanyCommand(event, requestId, identity.userId, identity.user.displayName, companyCommand);
      return;
    }

    if (await this.handlePackagePurchase(event, identity.userId, requestId)) return;

    // 4. Resolve company from membership + LineCompanyContext (NOT channel binding)
    const resolved = await resolveCompanyForLineUser(this.prisma, identity.userId, event.lineUserId);
    if (!resolved) {
      if (await this.replyIfCompanyLocked(event, identity.userId)) return;
      await this.deliverReply(event, UNLINKED_REPLY[replyLanguage(event)]);
      await this.updateEventLog(event.webhookEventId, 'no_membership', LINE_AI_ERROR_CODES.UNLINKED_USER);
      return;
    }
    if ('needsSelection' in resolved) {
      const memberships = await this.listLineCompanies(identity.userId);
      await this.deliverRequiredMessages(event, [buildCompanyPickerMessage(memberships.map(membership => companyPickerItem(membership, replyLanguage(event))), undefined, undefined, replyLanguage(event))]);
      await this.updateEventLog(event.webhookEventId, 'needs_company_selection', LINE_AI_ERROR_CODES.UNLINKED_USER);
      return;
    }
    const companyId = resolved.companyId;

    // 5. Resolve membership + permissions via existing permission resolver
    let resolvedAccess: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>;
    try {
      resolvedAccess = await this.permissionResolver.resolveAccess(identity.userId, companyId);
    } catch {
      await this.deliverReply(event, UNLINKED_REPLY[replyLanguage(event)]);
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
    this.deliveryAccess.set(event, { userId: identity.userId, companyId, membershipId: resolvedAccess.membershipId,
      fingerprint: resolvedLineDeliveryAccessFingerprint(identity.userId, companyId, resolvedAccess, entitledFeatureKeys),
      allowDuringSupportPause: deterministicCommand });
    await this.bindConversation(event);
    if (!resolvedAccess.freeExpenseDrafts) {
    if (event.counterpartyControl) {
      const ctx: RequestContext = { requestId, authSubject: identity.userId, userId: identity.userId, companyId,
        membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles, permissions: resolvedAccess.permissions,
        scopes: resolvedAccess.scopes, authProvider: 'line' };
      const control = event.counterpartyControl;
      if (control.action === 'counterparty_confirm') {
        const plan = await this.prisma.client.lineDeliveryPlan.findFirst({ where: { companyId, userId: identity.userId,
          planJson: { path: ['control', 'token'], equals: control.token } }, select: { status: true, planJson: true } });
        if (plan && (plan.status !== 'ACCEPTED' || !parseLineDeliveryPlan(plan.planJson))) {
          await this.deliverReply(event, (replyLanguage(event) === 'en' ? "Please read all supplier details before confirming." : 'กรุณาอ่านรายละเอียดคู่ค้าให้ครบก่อนยืนยันค่ะ')); return;
        }
      }
      const result = await this.counterparties.apply(ctx, chatKeyHashOf(event), control, replyLanguage(event));
      if (result.status === 'applied' || result.status === 'replayed') await this.counterpartyTask(event, control.token, true, result.source);
      const remaining = (result.status === 'applied' || result.status === 'replayed') && this.semanticTaskMappings.has(event)
        ? await this.remainingTaskChoiceMessages(event) : [];
      await this.deliverRequiredMessages(event, [{ type: 'text', text: result.reply }, ...remaining]);
      await this.updateEventLog(event.webhookEventId, `counterparty_${result.status}`, undefined, companyId);
      return;
    }
    if (event.expenseActionControl) {
      const ctx: RequestContext = { requestId, authSubject: identity.userId, userId: identity.userId, companyId,
        membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles, permissions: resolvedAccess.permissions, entitlementDeniedPermissions: resolvedAccess.entitlementDeniedPermissions,
        scopes: resolvedAccess.scopes, authProvider: 'line' };
      await this.handleExpenseActionPostback(event, ctx, entitledFeatureKeys);
      return;
    }
    if (event.messageText) {
      const teamCtx: RequestContext = { requestId, authSubject: identity.userId, userId: identity.userId, companyId, membershipId: resolvedAccess.membershipId,
        roles: resolvedAccess.roles, permissions: resolvedAccess.permissions, entitlementDeniedPermissions: resolvedAccess.entitlementDeniedPermissions, scopes: resolvedAccess.scopes, authProvider: 'line' };
      const answer = await this.expenseActions?.answerTeam?.(teamCtx, chatKeyHashOf(event), event.messageText);
      if (answer) {
        if (answer.preview) this.deliveryExpenseActions.set(event, { context: teamCtx, chat: chatKeyHashOf(event), requestId, preview: answer.preview });
        await this.deliverRequiredMessages(event, [answer.preview ? buildExpenseActionCard(answer.preview, undefined, replyLanguage(event), this.config?.webBaseUrl) : { type: 'text', text: answer.reply }]);
        await this.updateEventLog(event.webhookEventId, 'team_action_input', undefined, companyId);
        return;
      }
    }
    if (event.messageText && !event.reimbursementChoiceControl && event.messageText !== 'ไม่มีใบเสร็จ ขอเบิกรายการใหม่นี้' && (entitledFeatureKeys === null || entitledFeatureKeys.has('expenses'))) {
      const reasonCtx: RequestContext = { requestId, authSubject: identity.userId, userId: identity.userId, companyId,
        membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles, permissions: resolvedAccess.permissions,
        scopes: resolvedAccess.scopes, authProvider: 'line' };
      const signing = await this.substituteActions?.resume(reasonCtx, chatKeyHashOf(event), event.messageText, replyLanguage(event));
      if (signing) {
        if (signing.preview) this.deliverySubstituteActions.set(event, { context: reasonCtx, preview: signing.preview });
        await this.deliverCompletedReply(event, signing.reply ?? signing.preview!.summary, companyId, resolvedAccess);
        await this.updateEventLog(event.webhookEventId, 'substitute_signature_preview', undefined, companyId);
        return;
      }
      const evidence = await this.expenseActions?.answerEvidence?.(reasonCtx, chatKeyHashOf(event), event.messageText, replyLanguage(event));
      if (evidence) {
        if ('substituteExpenseId' in evidence && evidence.substituteExpenseId && this.substituteReceiptContinuation) {
          const result = await this.substituteReceiptContinuation.execute(reasonCtx, { language: replyLanguage(event), chatKeyHash: chatKeyHashOf(event),
            messageText: 'ไม่มีใบเสร็จ ขอทำใบรับรองแทนใบเสร็จ', recentCandidates: [{ id: evidence.substituteExpenseId, label: 'รายการนี้' }],
            boundCandidateExpenseIds: [evidence.substituteExpenseId], confirmedStart: true, webBaseUrl: this.config.webBaseUrl });
          await this.rememberSubstituteDeliverySource(event, reasonCtx, result);
          await this.deliverReply(event, result.replyText);
        } else {
          if ('preview' in evidence && evidence.preview) this.deliveryExpenseActions.set(event, { context: reasonCtx, chat: chatKeyHashOf(event), requestId, preview: evidence.preview });
          const choices = await this.expenseActions.repairChoices(reasonCtx, chatKeyHashOf(event), undefined, replyLanguage(event));
          await this.deliverRequiredMessages(event, ['preview' in evidence && evidence.preview ? buildExpenseActionCard(evidence.preview, undefined, replyLanguage(event), this.config?.webBaseUrl)
            : { type: 'text', text: evidence.reply, ...(choices?.length ? { quickReply: lineChoiceQuickReply(choices) } : {}) }]);
        }
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      const category = await this.expenseActions?.answerCategory?.(reasonCtx, chatKeyHashOf(event), event.messageText, replyLanguage(event));
      if (category) {
        if ('preview' in category && category.preview) {
          this.deliveryExpenseActions.set(event, { context: reasonCtx, chat: chatKeyHashOf(event), requestId, preview: category.preview });
          await this.deliverRequiredMessages(event, [buildExpenseActionCard(category.preview, undefined, replyLanguage(event), this.config?.webBaseUrl)]);
        } else if ('reply' in category) {
          const choices = await this.expenseActions.repairChoices(reasonCtx, chatKeyHashOf(event), undefined, replyLanguage(event));
          await this.deliverRequiredMessages(event, [{ type: 'text', text: category.reply!, quickReply: lineChoiceQuickReply(choices ?? []) }]);
        } else {
          const proposed = await this.proposeDraftUpdate(event, reasonCtx, resolvedAccess, category,
            [{ text: event.messageText, todayIso: todayCivilDate() }], category.expenseId);
          if (proposed === 'not_handled') await this.deliverReply(event, (replyLanguage(event) === 'en' ? "The expense category is missing; set it on the expense page before confirming again." : 'ยังขาดหมวดค่าใช้จ่าย แก้หมวดในหน้ารายการแล้วพิมพ์ยืนยันอีกครั้งค่ะ'));
          const preview = await this.draftUpdate?.pendingPreview(reasonCtx, chatKeyHashOf(event), requestId);
          if (preview) await this.expenseActions.linkRepairEdit(reasonCtx, chatKeyHashOf(event), preview.previewId);
        }
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      const answer = await this.expenseActions?.answerReason?.(reasonCtx, chatKeyHashOf(event), event.messageText);
      if (answer) {
        // A bare payee/category value is continuation data; retain its signed proposal’s language.
        if (answer.preview?.language) event.language = answer.preview.language;
        if (answer.preview) this.deliveryExpenseActions.set(event, { context: reasonCtx, chat: chatKeyHashOf(event), requestId, preview: answer.preview });
        const choices = answer.preview ? undefined : await this.expenseActions.repairChoices?.(reasonCtx, chatKeyHashOf(event), undefined, replyLanguage(event));
        await this.deliverRequiredMessages(event, [answer.preview ? buildExpenseActionCard(answer.preview, undefined, replyLanguage(event), this.config?.webBaseUrl) : { type: 'text', text: answer.reply,
          ...(choices?.length ? { quickReply: lineChoiceQuickReply(choices) } : {}) }]);
        await this.updateEventLog(event.webhookEventId, answer.preview ? 'expense_action_prepared' : 'clarification_required', undefined, companyId);
        return;
      }
    }
    if (event.reimbursementDraftControl) {
      await this.handleReimbursementDraftControl(event, { requestId, authSubject: identity.userId, userId: identity.userId, companyId,
        membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles, permissions: resolvedAccess.permissions,
        scopes: resolvedAccess.scopes, authProvider: 'line' });
      return;
    }
    }
    const menuCommand = staffMenuCommand(event.messageText);
    const canCaptureExpense = RECEIPT_CAPTURE_PERMISSIONS
      .some((permission) => resolvedAccess.permissions.includes(permission));
    const expenseEditingFeatureEnabled = entitledFeatureKeys === null || entitledFeatureKeys.has('expenses');

    // These two cards are deterministic product entry points, not AI turns. They keep their own
    // feature/permission gates and remain available when the model provider or AI feature is off.
    if (menuCommand === 'services' && resolvedAccess.freeExpenseDrafts) {
      await this.deliverReply(event, freeExpenseMenuReply(this.config.webBaseUrl, companyId, resolvedAccess.permissions));
      await this.updateEventLog(event.webhookEventId, 'staff_menu_services', undefined, companyId);
      return;
    }
    if (menuCommand === 'services') {
      await this.deliverRequiredMessages(event, [buildServiceEntitlementMessage(entitledFeatureKeys, replyLanguage(event))]);
      await this.updateEventLog(event.webhookEventId, 'staff_menu_services', undefined, companyId);
      return;
    }
    if (menuCommand === 'receipt') {
      const receiptFeatureEnabled = entitledFeatureKeys === null || entitledFeatureKeys.has('expenses.upload');
      if (!receiptFeatureEnabled || !canCaptureExpense) {
        const featureDisabled = !receiptFeatureEnabled;
        await this.deliverReply(event, featureDisabled ? EXPENSE_FEATURE_DISABLED_REPLY[replyLanguage(event)] : RECEIPT_FORBIDDEN_REPLY[replyLanguage(event)]);
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
      await this.deliverRequiredMessages(event, [event.messageText.trim() === WELCOME_RECEIPT_COMMAND
        ? buildWelcomeReceiptCapturePrompt() : buildReceiptCapturePrompt({ ...({
        displayName: identity.user.displayName,
        roleLabel: resolvedAccess.roles.join(' · ') || 'พนักงาน',
        branchScopeLabel: branchScopeFallbackLabel(resolvedAccess.scopes.branchIds),
        permissions: resolvedAccess.permissions,
        entitledFeatureKeys,
        webBaseUrl: this.config.webBaseUrl,
        companyId,
        isOwner: resolvedAccess.roles.includes('OWNER'),
      }), language: replyLanguage(event) })]);
      await this.updateEventLog(event.webhookEventId, 'staff_menu_receipt', undefined, companyId);
      return;
    }
    // Sales-event spec §8.1 (Owner UAT 2026-09-29): "ฉันมีส่วนลดไหม" is about the holder's ส่วนลดจากงาน, even right
    // after a receipt draft, so it is answered here — deterministic, before any AI turn — from the owner-only
    // billing read. A discount placed on a bill ("ส่วนลดในบิลนี้") never matches and stays with the receipt flow.
    if (this.billing && isMangmeeDiscountQuestion(event.messageText)) {
      await this.deliverRequiredMessages(event, [await this.eventDiscountCard(event, {
        requestId, authSubject: identity.userId, userId: identity.userId, companyId,
        membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles,
        permissions: resolvedAccess.permissions, scopes: resolvedAccess.scopes, authProvider: 'line',
      })]);
      await this.updateEventLog(event.webhookEventId, 'event_discount_answer', undefined, companyId);
      return;
    }

    // S-4 (spec §5.4): the two buttons on a draft-edit confirm card. Handled HERE — after company,
    // membership and permissions are resolved, before any AI turn. The validated postback carries
    // its action and opaque previewId; the record, patch, and permission decision remain server-
    // derived. Typed confirm/cancel phrases have no bound previewId and cannot act on a proposal.
    // Gated on the flag, not just on the handler: with S-4 off these two phrases must behave the
    // way any other text did before S-4 — they fall through to the ordinary AI turn. Recognising
    // them as commands while the lane is dark would be a behaviour change a rollback cannot undo.
    if (!resolvedAccess.freeExpenseDrafts && this.draftUpdate?.enabled && (menuCommand === 'draft_update_confirm' || menuCommand === 'draft_update_cancel')) {
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
      ? (lead: string) => capabilityEntitlementReply(lead, entitledFeatureKeys, replyLanguage(event))
      : undefined;
    // This is the one user turn whose contract forbids non-transport persistence. The shadow sweep
    // flushes an operational telemetry row, so skip that observation for this narrow question;
    // the launch gate below still runs and retains its existing refusal/audit behavior.
    const editCapabilityQuestion = isExpenseEditCapabilityQuestion(event.messageText);
    if (!editCapabilityQuestion) await this.recordShadowTurn(companyId);
    if (await this.refuseWhenLaunchRouteClosed(event, identity.userId, companyId, requestId, capabilityHelp)) return;
    if (lineAssistantDisabledFor(entitledFeatureKeys)) {
      if (capabilityHelp) await this.deliverRequiredMessages(event, capabilityHelp(formatRefusal('feature_disabled', undefined, replyLanguage(event))));
      else await this.deliverReply(event, formatRefusal('feature_disabled', undefined, replyLanguage(event)));
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

    if (resolvedAccess.freeExpenseDrafts) {
      const showsMenu = menuCommand === 'main' || isCapabilityQuestion(event.messageText);
      const text = showsMenu
        ? freeExpenseMenuReply(this.config.webBaseUrl, companyId, resolvedAccess.permissions)
        : isExplicitFinalFinancialRequest(event.messageText)
          ? MUTATION_REFUSAL_REPLY.split('\n')[0]!
          : isExplicitSourceEditRequest(event.messageText) ? FREE_EXPENSE_TEXT_EDIT_REPLY : FREE_EXPENSE_CHAT_REPLY;
      await this.deliverReply(event, text, showsMenu ? undefined : lineChoiceQuickReply([{ label: 'เมนูหลัก', text: 'เมนูหลัก' }]));
      await this.updateEventLog(event.webhookEventId, menuCommand === 'main' ? 'staff_menu_main' : 'free_chat_not_included', undefined, companyId);
      return;
    }

    if (this.paymentEvidence && (parseLinePaymentEvidenceControl(event.messageText) || isRecentPaymentEvidenceLinkText(event.messageText))) {
      await this.handlePaymentEvidenceText(event, { requestId, authSubject: identity.userId, userId: identity.userId, companyId,
        membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles, permissions: resolvedAccess.permissions,
        scopes: resolvedAccess.scopes, authProvider: 'line' });
      return;
    }

    await this.reconcileDeliveredSemanticTasks(event);
    if (await this.handlePreferenceCommand(event, requestId)) return;
    if (await this.handlePendingMediaControl(event)) return;
    if (await this.handleDocumentQaControl(event)) return;
    if (await this.handlePendingWorkControl(event, { requestId, authSubject: identity.userId, userId: identity.userId, companyId,
      membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles, permissions: resolvedAccess.permissions,
      scopes: resolvedAccess.scopes, authProvider: 'line' })) return;
    if (await this.prepareRetainedTaskSelection(event)) return;
    const canQuery = resolvedAccess.permissions.includes('line.ai.query');
    const canEditLine = resolvedAccess.permissions.includes('expense.update');
    const canSubmitSignature = maySubmitSignature(resolvedAccess.permissions);
    // Phase 1 is personal-chat only. Group/room capture retains the proven single-turn path.
    const counterpartyCommand = isLineCounterpartyCommand(event.messageText);
    const expenseDraftConversationEnabled = !resolvedAccess.freeExpenseDrafts && !counterpartyCommand && this.config.lineExpenseDraftConversationEnabled === true
      && (!event.pushTargetId || event.pushTargetId === event.lineUserId)
      && Boolean(this.expenseDraftConversation);
    if (!canQuery && !canCaptureExpense && !canSubmitSignature && !editCapabilityQuestion) {
      await this.deliverReply(event, FORBIDDEN_REPLY[replyLanguage(event)]);
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
      const menuContext: StaffMenuContext = { language: replyLanguage(event),
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
        ? buildStaffMainMenu({ ...(menuContext), language: replyLanguage(event) })
        : menuCommand === 'query'
          ? buildStaffQueryMenu({ ...(menuContext), language: replyLanguage(event) })
          // The card shows its whole text, so a delivery plan may send the card itself (text stays the fallback).
          : asCompleteLineCard(buildPendingApprovalCard(menuContext, await this.loadPendingApprovals({
              requestId,
              authSubject: identity.userId,
              userId: identity.userId,
              companyId,
              membershipId: resolvedAccess.membershipId,
              roles: resolvedAccess.roles,
              permissions: resolvedAccess.permissions,
              scopes: resolvedAccess.scopes,
              authProvider: 'line',
            }, availableApprovalSurfaceKeys(menuContext), replyLanguage(event)), THAI_DATE_REPLY_FORMATTER.format(new Date())));
      await this.deliverRequiredMessages(event, [message]);
      await this.updateEventLog(event.webhookEventId, `staff_menu_${menuCommand}`, undefined, companyId);
      return;
    }

    // V2 classifies once from accepted input plus the authorized, bounded chat/task snapshot before
    // pending-media/draft interceptors can consume or write. Owner 2026-09-29 ("ของเดิมดีอยู่แล้ว"):
    // production a2b926c6's order is the rule. A reply that answers work this chat left open — the
    // photo question's "1" or "ใบเสร็จค่ะ", a check bill's "1", a draft control — skips this route and
    // reaches the deterministic handlers below exactly as production reaches them. Everything else is
    // routed here as before, now with the open work production gave its router (captures to correct,
    // drafts to continue, questions waiting for an answer, substitute state).
    const boundSemanticV2 = canQuery && this.boundConversations.has(event);
    let conversationContext: LineAiConversationContext | undefined = boundSemanticV2
      ? await this.loadConversationContext(companyId, identity.userId, event) : undefined;
    let semanticRoutePlan: GovernedLineIntakeRoutePlan | undefined;
    // Item 10F: chatKey = groupId ?? roomId ?? userId (same as the buffer); open waiting_user
    // ledger entries ride the turn as DATA so the model can complete the ORIGINAL request.
    const chatKey = event.pushTargetId ?? event.lineUserId;
    const expenseDraftCtx: RequestContext = {
      requestId, authSubject: identity.userId, userId: identity.userId, companyId,
      membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles,
      permissions: resolvedAccess.permissions, entitlementDeniedPermissions: resolvedAccess.entitlementDeniedPermissions, scopes: resolvedAccess.scopes, authProvider: 'line',
    };
    const draftRoutingEnabled = expenseDraftConversationEnabled && canCaptureExpense && !!this.expenseDraftConversation;
    const substituteMode = this.boundConversations.has(event) ? 'primary' : this.config.lineAiSubstituteSemanticRoutingMode;
    // Read once per turn — by the v2 route when it runs first, otherwise where production read it.
    let openWork: LineOpenWorkContext | null | undefined;
    const loadOpenWork = async () => openWork !== undefined ? openWork
      : openWork = await this.loadOpenWorkContext(event, requestId, expenseDraftCtx, {
        chatKey, corrections: canCaptureExpense || canEditLine, drafts: draftRoutingEnabled, substituteMode,
      });
    if (boundSemanticV2 && !await this.answersOpenWork(event, expenseDraftCtx, draftRoutingEnabled)) {
      const open = await loadOpenWork();
      if (!open) return;
      if (await this.handleExpensePaymentText(event, expenseDraftCtx, entitledFeatureKeys, conversationContext)) return;
      const candidates = await this.textValueCandidates(event, event.messageText);
      semanticRoutePlan = await this.timeStage(event.webhookEventId, 'intake_route', () => this.tryRouteIntake({ event, requestId, webhookEventId: event.webhookEventId,
        companyId, userId: identity.userId, permissions: resolvedAccess.permissions, enabledFeatures: entitledFeatureKeys ? [...entitledFeatureKeys] : null,
        entitledFeatureKeys,
        messageText: event.messageText, conversationContext, ...(candidates ? { valueCandidates: candidates } : {}),
        ...(open.openClarifications ? { openClarifications: open.openClarifications } : {}),
        ...(open.recentCapturedExpenses.length ? { recentCapturedExpenses: open.recentCapturedExpenses } : {}),
        ...(open.activeExpenseDrafts.length ? { activeExpenseDrafts: open.activeExpenseDrafts } : {}),
        substituteContext: open.substituteContext }));
      this.intakePlansV2.set(event, semanticRoutePlan);
      if (semanticRoutePlan.status !== 'ROUTED' || !semanticRoutePlan.semanticSubrequests?.length) {
        if (await this.answerAiCreditRefusal(event, companyId, semanticRoutePlan, resolvedAccess.permissions.includes(PLAN_MANAGE_PERMISSION_KEY))) return;
        await this.deliverReply(event, isTransientLineAiRouteFailure(semanticRoutePlan.errorCode)
          ? (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.LINE_AI_ROUTE_TRANSIENT_REPLY : LINE_AI_ROUTE_TRANSIENT_REPLY) : (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.LINE_AI_ROUTE_UNCLEAR_REPLY : LINE_AI_ROUTE_UNCLEAR_REPLY));
        await this.updateEventLog(event.webhookEventId, 'provider_unavailable', semanticRoutePlan.errorCode ?? 'AI_CONTRACT_UNSUPPORTED', companyId); return;
      }
      if (await this.handleClaimSubmitText(event, expenseDraftCtx, entitledFeatureKeys, conversationContext)) return;
      if (await this.continueReimbursementQuestion(event, expenseDraftCtx, semanticRoutePlan, candidates)) return;
      if (this.paymentEvidence && (semanticRoutePlan.intent === 'EXPENSE_PAYMENT_EVIDENCE_LINK'
        || semanticRoutePlan.semanticSubrequests?.some(item => item.writeIntent === 'EXPENSE_PAYMENT_EVIDENCE_LINK'))) {
        await this.handlePaymentEvidenceText(event, expenseDraftCtx); return;
      }
      if (await this.handleRoutedPreference(event, requestId, semanticRoutePlan)) return;
      if (await this.deliverStructuralCapacityLimit(event, semanticRoutePlan, expenseDraftCtx, resolvedAccess)) return;
      if (await this.resumeDocumentQuestionV2(event, requestId, semanticRoutePlan, resolvedAccess)) return;
      if (await this.draftCurrentDocumentV2(event, requestId, semanticRoutePlan, resolvedAccess)) return;
      if (!open.openClarifications?.length && !/^(?:ช่วย)?แก้(?:ไข)?ข้อมูล(?:ให้)?(?:หน่อย)?(?:ค่ะ|คะ|ครับ)?[?？]?$/u.test(event.messageText.replace(/\s+/gu, ''))
        && semanticRoutePlan.semanticSubrequests.every(item => ['general', 'help'].includes(item.kind))) {
        await this.deliverPureGeneralV2(event, requestId, semanticRoutePlan, resolvedAccess, entitledFeatureKeys, candidates, conversationContext); return;
      }
    }

    let normalizedText = this.boundConversations.has(event) ? event.messageText : normalizeLineText(event.messageText);
    let mediaResumeCapsule: string | undefined;

    // RECEIPT-05 (owner decision 2026-07-12): if this user has an unresolved media-clarify
    // question, their reply decides it deterministically BEFORE any AI routing — receipt →
    // build the draft from the stored attachment; illustration → answer the original caption;
    // multiple → retain for review without collapsing rows; ambiguous → leave it PENDING.
    const pendingWhere = { companyId, userId: identity.userId, status: 'PENDING' as const, expiresAt: { gt: new Date() }, ...this.pendingMediaBinding(event) };
    const pendingRows = counterpartyCommand ? [] : this.boundConversations.has(event)
      ? await this.prisma.client.lineIntakePendingMedia.findMany({ where: pendingWhere, orderBy: { createdAt: 'asc' }, take: 6 })
      : [await this.prisma.client.lineIntakePendingMedia.findFirst({ where: pendingWhere, orderBy: { createdAt: 'desc' } })].filter((row): row is NonNullable<typeof row> => !!row);
    const explicitlySelected = pendingRows.filter(row => (row.askedQuestionJson as { selectedForContinuation?: boolean } | null)?.selectedForContinuation === true);
    if (pendingRows.length > 1 && explicitlySelected.length !== 1) {
      await this.deliverRequiredMessages(event, [this.pendingMediaSelectionMessage(pendingRows, replyLanguage(event))]);
      await this.updateEventLog(event.webhookEventId, 'clarification_required', 'MEDIA_SELECTION_REQUIRED', companyId); return;
    }
    const pendingMedia = explicitlySelected[0] ?? pendingRows[0];
    if (pendingMedia && ((pendingMedia.askedQuestionJson as { selectedAttachmentIds?: string[] } | null)?.selectedAttachmentIds?.length ?? 0) > 1) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "All files are retained; choose the main file before recording an expense, or ask to read the whole group without creating one." : 'ไฟล์ชุดนี้ยังเก็บไว้ครบค่ะ หากจะบันทึกรายการ กรุณาเลือกไฟล์หลักจากปุ่มก่อน หรือถามให้อ่านทั้งชุดได้โดยไม่สร้างรายการ'));
      await this.updateEventLog(event.webhookEventId, 'clarification_required', 'MEDIA_PURPOSE_REQUIRED', companyId); return;
    }
    if (editCapabilityQuestion && pendingMedia) {
      await this.deliverCompletedReply(event,
        (replyLanguage(event) === 'en' ? "An earlier photo is waiting for your answer; finish that question before requesting an edit." : 'มีรูปก่อนหน้าที่รอคำตอบอยู่ค่ะ กรุณาตอบคำถามของรูปนั้นก่อน แล้วค่อยถามเรื่องแก้รายการอีกครั้งนะคะ'),
        companyId, resolvedAccess);
      await this.updateEventLog(event.webhookEventId, 'expense_edit_capability_waiting', undefined, companyId);
      return;
    }
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
        mediaResumeCapsule = (replyLanguage(event) === 'en' ? `The photo awaiting classification is retained.
${substituteAnswer.question}` : `↩️ รูปที่รอจำแนกยังเก็บไว้อยู่ค่ะ\n${substituteAnswer.question}`);
      }
      const splitReply = substituteAnswer ? null : splitPendingMediaReply(normalizedText);
      const answer = substituteAnswer?.outcome === 'new_expense'
        ? 'receipt' as const
        : substituteAnswer
          ? 'ambiguous' as const
          : splitReply?.decision ?? classifyPendingMediaReply(normalizedText);
      // A numbered answer cannot turn two independently classified documents into one expense.
      const detectedMultiDocument = (pendingMedia.askedQuestionJson as { detectedMultiDocument?: unknown } | null)?.detectedMultiDocument === true;
      const decision = detectedMultiDocument && answer === 'receipt' ? 'multiple' : answer;
      if (decision === 'receipt') {
        try {
          await this.resolvePendingMediaAsReceipt(
            event, requestId, identity.userId, companyId, resolvedAccess, pendingMedia, normalizedText,
            splitReply?.remainder,
          );
        } catch (error) {
          // Same rule as the answer above: a data state the sender can fix gets its own sentence and
          // leaves the row PENDING; anything else is still a real fault and belongs to the dispatcher.
          if (!lineCaptureFailureReply(error, BRANCH_RETRY_ANSWER, replyLanguage(event))) throw error;
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
        // Owner 2026-09-30: the photo was accepted before; this answer resumes it, so its turn passes the cap.
        event.admitOverCap = true;
        // Route on the stored caption instead of the yes/no reply — the deferred question is answered now.
        // A bound chat keeps the accepted words: its route may only classify text its input evidence
        // proves, and the caption already rides along as the open question's own text.
        if (!this.boundConversations.has(event)) normalizedText = normalizeLineText(pendingMedia.caption ?? normalizedText);
      }
      if (decision === 'multiple') {
        (event as LineTextEvent & {
          [PENDING_MEDIA_RESOLUTION]?: { id: string; companyId: string; userId: string; status: 'RESOLVED_ILLUSTRATION' | 'RESOLVED_MULTI_ENTRY_REVIEW' };
        })[PENDING_MEDIA_RESOLUTION] = { id: pendingMedia.id, companyId, userId: identity.userId, status: 'RESOLVED_MULTI_ENTRY_REVIEW' };
        const reply = [
          detectedMultiDocument
            ? (replyLanguage(event) === 'en' ? "The image contains several documents; it is retained for review without combining them into one expense." : '📄 รูปเดิมมีเอกสารมากกว่า 1 ฉบับ เก็บไฟล์ไว้ตรวจแล้ว และยังไม่ได้สร้างค่าใช้จ่ายรายการเดียวค่ะ')
            : (replyLanguage(event) === 'en' ? "The multi-record file is retained for review; its combined total was not recorded as one expense." : '📋 เก็บไฟล์สรุปหลายรายการไว้ตรวจแล้ว และยังไม่ได้สร้างค่าใช้จ่ายรายการเดียวจากยอดรวมค่ะ'),
          (replyLanguage(event) === 'en' ? "Send each document separately, or review and record them on the web:" : 'ระบบ LINE ยังไม่รองรับการแยกหลายรายการอัตโนมัติ กรุณาส่งเอกสารแยกรายการ หรือบันทึก/ตรวจในเว็บแอป:'),
          absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses`),
        ].join('\n');
        await this.deliverCompletedReply(event, reply, companyId, resolvedAccess);
        await this.persistIntakeTurn({ event,
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: reply, intent: 'CLARIFY',
        });
        await this.updateEventLog(event.webhookEventId, 'multi_entry_review', undefined, companyId);
        return;
      }
      if (decision === 'ambiguous' && isInterveningQuestionText(normalizedText)) {
        mediaResumeCapsule = (replyLanguage(event) === 'en' ? `The photo awaiting classification is retained.
${MEDIA_CLARIFY_REPLY[replyLanguage(event)]}` : `↩️ รูปที่รอจำแนกยังเก็บไว้อยู่ค่ะ\n${MEDIA_CLARIFY_REPLY[replyLanguage(event)]}`);
      }
      // ambiguous → fall through with the original reply; the row stays PENDING. Unlike before, the
      // ledger now carries this question as an open clarification WITH the stored file, so the turn
      // below reaches the model knowing the picture is already on the server — it can answer or
      // re-ask about THAT file instead of asking the customer to send one.
    }

    if (!boundSemanticV2 && canQuery) {
      conversationContext = await this.loadConversationContext(companyId, identity.userId, event);
    }
    const valueCandidates = await this.textValueCandidates(event, normalizedText);
    const open = await loadOpenWork();
    if (!open) return;
    const { openWaiting, openClarifications, recentCapturedExpenses } = open;
    if (isUtilityBillSaveRequest(normalizedText)) {
      if (!await this.mayDeliverBusinessReply(event)) return;
      if (recentCapturedExpenses.length && !await this.correctionCandidatesCurrent(expenseDraftCtx, chatKeyHashOf(event), JSON.stringify(recentCapturedExpenses))) {
        await this.denyBusinessDelivery(event, 'LINE_DELIVERY_SOURCE_CHANGED', this.deliveryAccess.get(event));
        return;
      }
      const reply = !canCaptureExpense ? receiptDeniedReply(resolvedAccess, replyLanguage(event))
        : entitledFeatureKeys !== null && !entitledFeatureKeys.has('expenses.upload') ? EXPENSE_FEATURE_DISABLED_REPLY[replyLanguage(event)]
        : await this.saveRecentUtilityBill(event, expenseDraftCtx, recentCapturedExpenses, normalizedText);
      await this.deliverCompletedReply(event, reply, companyId, resolvedAccess);
      await this.persistIntakeTurn({ event,
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: reply, intent: 'EVIDENCE_CAPTURE',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }
    let activeExpenseDrafts = open.activeExpenseDrafts;
    if (activeExpenseDrafts.length && conversationContext) conversationContext.activeExpenseDrafts = activeExpenseDrafts.map(draft => ({ expenseId: draft.expenseId }));
    let draftRouteSnapshot = JSON.stringify(activeExpenseDrafts);
    const draftRouteCurrent = async () => {
      if (!expenseDraftConversationEnabled || !canCaptureExpense || !this.expenseDraftConversation) return true;
      try {
        if (JSON.stringify(await this.expenseDraftConversation.routeContexts(expenseDraftCtx, chatKeyHashOf(event), replyLanguage(event))) === draftRouteSnapshot) return true;
      } catch { /* An unavailable source cannot authorize the retained route. */ }
      await this.denyBusinessDelivery(event, 'LINE_DELIVERY_SOURCE_CHANGED', this.deliveryAccess.get(event));
      return false;
    };
    if (editCapabilityQuestion) {
      let waitingForEarlierWork = openWaiting.length > 0 || activeExpenseDrafts.length > 0;
      if (!waitingForEarlierWork && (this.boundConversations.has(event) || this.config.lineAiSubstituteSemanticRoutingMode === 'primary')
        && this.substituteReceiptContinuation) {
        const state = await this.substituteReceiptContinuation.substituteContext(expenseDraftCtx, {
          chatKeyHash: chatKeyHashOf(event), recentCandidateCount: recentCapturedExpenses.length,
        });
        waitingForEarlierWork = state.workflowState !== 'none' || state.hasPendingQuestion;
      }
      if (waitingForEarlierWork) {
        await this.deliverCompletedReply(event,
          (replyLanguage(event) === 'en' ? "An earlier task is waiting for your answer; finish or cancel it before requesting an edit." : 'มีงานก่อนหน้าที่รอคำตอบอยู่ค่ะ กรุณาตอบหรือจบงานนั้นก่อน แล้วค่อยถามเรื่องแก้รายการอีกครั้งนะคะ'),
          companyId, resolvedAccess);
        await this.updateEventLog(event.webhookEventId, 'expense_edit_capability_waiting', undefined, companyId);
        return;
      }
      if (canCaptureExpense || canEditLine) this.rememberCandidateDeliverySources(event, expenseDraftCtx, recentCapturedExpenses);
      if (!await this.mayDeliverBusinessReply(event)) return;
      const servingEnabled = canQuery && canEditLine && expenseEditingFeatureEnabled && this.draftUpdate?.enabled
        ? await this.aiGateway.lineDraftEditCapabilityEnabled(requestId)
        : false;
      const reply = !servingEnabled
        ? (replyLanguage(event) === 'en' ? `This expense cannot be edited in LINE yet.${canEditLine ? ' กรุณาเปิดรายการในเว็บแอปเพื่อตรวจและแก้ไข:' : ' ต้องมีสิทธิ์แก้ไขรายการก่อนค่ะ'}
${absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses`)}` : `ตอนนี้ยังแก้รายการผ่าน LINE ไม่ได้ค่ะ${canEditLine ? ' กรุณาเปิดรายการในเว็บแอปเพื่อตรวจและแก้ไข:' : ' ต้องมีสิทธิ์แก้ไขรายการก่อนค่ะ'}\n${absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses`)}`)
        : recentCapturedExpenses.length === 0
          ? (replyLanguage(event) === 'en' ? `No editable expense saved by you in this chat was found within the last 24 hours; review the expense list on the web:
${absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses`)}` : `ระบบรองรับการแก้รายการเดิมผ่าน LINE แต่ยังไม่พบรายการที่คุณบันทึกไว้ในแชทนี้ภายใน 24 ชั่วโมงซึ่งแก้ได้ค่ะ\n${absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses`)}`)
          : [
            recentCapturedExpenses.length === 1
              ? (replyLanguage(event) === 'en' ? `You can prepare an edit for this expense: ${correctionCandidateLabel(recentCapturedExpenses[0]!, 'en')}` : `ถ้าหมายถึงรายการนี้ แก้ผ่าน LINE ได้ค่ะ: ${recentCapturedExpenses[0]!.label}`)
              : (replyLanguage(event) === 'en' ? "Choose the expense below to prepare an edit:" : 'ถ้าหมายถึงรายการใดรายการหนึ่งในรายการด้านล่าง แก้ผ่าน LINE ได้ค่ะ:'),
            ...(recentCapturedExpenses.length > 1
              ? recentCapturedExpenses.map(candidate => candidate.label)
              : []),
            (replyLanguage(event) === 'en' ? "Send the field and new value; I will show the proposed changes and save them only after you confirm the card." : 'พิมพ์ฟิลด์กับค่าใหม่ เช่น “แก้วันที่เป็น 20 กันยายน 2569” ระบบจะแสดงตัวอย่างให้ตรวจ และจะบันทึกก็ต่อเมื่อคุณกด “ยืนยัน” เท่านั้น'),
            ...(recentCapturedExpenses.length > 1 ? [(replyLanguage(event) === 'en' ? "Please identify the bill or its date before editing." : 'กรุณาระบุบิลหรือวันที่ก่อนแก้ค่ะ')] : []),
          ].join('\n');
      const card = buildLineAssistantTextCardMessage(reply, this.config.webBaseUrl, companyId, undefined, undefined, replyLanguage(event));
      if (servingEnabled && recentCapturedExpenses.length > 1) card.quickReply = lineChoiceQuickReply(recentCapturedExpenses.map(candidate => ({ label: correctionCandidateLabel(candidate, replyLanguage(event)), text: (replyLanguage(event) === 'en' ? `Edit expense ${correctionCandidateLabel(candidate, 'en')}` : `ขอแก้รายการ ${candidate.label}`) })));
      await this.deliverCompletedReply(event, reply, companyId, resolvedAccess, undefined, card);
      await this.updateEventLog(event.webhookEventId, 'expense_edit_capability', undefined, companyId);
      return;
    }
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
      let reply = (replyLanguage(event) === 'en' ? `The receipt status could not be verified; view the latest record: ${listLink}` : `ตอนนี้ยังตรวจสอบสถานะใบเสร็จให้ไม่ได้ค่ะ เปิดดูรายการล่าสุดได้ที่ ${listLink}`);
      if (!canCaptureExpense) reply = receiptDeniedReply(resolvedAccess, replyLanguage(event));
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
            ? (replyLanguage(event) === 'en' ? "Amount not verified" : 'ยังไม่ทราบยอด')
            : `${amountValue.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${expense.currency && expense.currency !== 'THB' ? expense.currency : replyLanguage(event) === 'en' ? 'THB' : 'บาท'}`;
          lines.push((replyLanguage(event) === 'en' ? `• ${number ? `Receipt ${number} · ` : ''}${amount}
${receiptProgressLabel(expense.status, verification, replyLanguage(event))}
View record ${lines.length + 1}: ${absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${expense.id}`)}` : `${lines.length + 1}) ${number ? `บิล ${number} · ` : ''}${amount}\n${receiptProgressLabel(expense.status, verification, replyLanguage(event))}\nเปิดรายการที่ ${lines.length + 1}: ${absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${expense.id}`)}`));
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
          ? (replyLanguage(event) === 'en' ? `Found ${lines.length} recent expenses in this chat:

${lines.join('\n\n')}

Any photo absent from this list has no verified result yet.
View all expenses: ${listLink}` : `ตรวจพบรายการล่าสุดจากแชทนี้ ${lines.length} ใบค่ะ\n\n${lines.join('\n\n')}\n\nถ้ายังมีรูปที่ไม่ปรากฏในรายการนี้ ระบบยังยืนยันผลของรูปนั้นไม่ได้ค่ะ\nดูรายการทั้งหมด: ${listLink}`)
          : openGroups.length
            ? openGroups.map((group) => captureGroupStatusReply(
              absoluteWebLink(this.config.webBaseUrl, group.webPath), group.reading,
            )).join('\n\n')
            : (replyLanguage(event) === 'en' ? `No expense from this chat was found in the last 24 hours, so completion cannot be confirmed.
View expenses: ${listLink}` : `ยังไม่พบรายการจากแชทนี้ในช่วง 24 ชั่วโมงล่าสุด จึงยังยืนยันว่าอ่านเสร็จไม่ได้ค่ะ\nดูรายการในเว็บ: ${listLink}`);
      } catch (error) {
        this.logger.warn({ msg: 'line_receipt_status_unavailable', ...safeLineErrorDetails(error) });
      }
      await this.deliverCompletedReply(event, reply, companyId, resolvedAccess);
      await this.persistIntakeTurn({ event,
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: reply, intent: 'UNKNOWN',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }
    const interruptExpenseDraft = async (excludeExpenseIds: string[] = []) => {
      if (!this.expenseDraftConversation || !activeExpenseDrafts.some(draft => draft.status === 'OPEN' && !excludeExpenseIds.includes(draft.expenseId))) return undefined;
      const reply = await this.expenseDraftConversation.interruptOpen(expenseDraftCtx, chatKeyHashOf(event), excludeExpenseIds);
      activeExpenseDrafts = await this.expenseDraftConversation.routeContexts(expenseDraftCtx, chatKeyHashOf(event), replyLanguage(event));
      draftRouteSnapshot = JSON.stringify(activeExpenseDrafts);
      const routing = this.clarificationRouteSources.get(event);
      if (routing) routing.draftRouting = draftRoutingRevisions(activeExpenseDrafts);
      return reply;
    };
    if (activeExpenseDrafts.length > 0 && this.expenseDraftConversation
      && (isDeterministicLineExpenseDraftInput(normalizedText)
        || !!await this.expenseDraftConversation.answersOpenDraft?.(expenseDraftCtx, chatKeyHashOf(event), normalizedText))) {
      if (!await draftRouteCurrent() || !await this.mayDeliverBusinessReply(event)) return;
      const result = await this.expenseDraftConversation.execute(expenseDraftCtx, { language: replyLanguage(event),
        messageText: normalizedText,
        chatKeyHash: chatKeyHashOf(event),
        webhookEventId: event.webhookEventId,
      });
      if (result.handled) {
        const mixedContinuation = this.mixedBusinessQuestions?.get(event);
        if (mixedContinuation) mixedContinuation.businessStatus = ['ENDED', 'CANCELLED'].includes(result.status) ? 'handled' : 'needs_user';
        this.rememberContinuationDeliverySource(event, expenseDraftCtx, result);
        await this.deliverCompletedReplies(event, this.withDraftWebLink(result.replyTexts, companyId, result.expenseId, replyLanguage(event)), companyId, resolvedAccess);
        await this.persistIntakeTurn({ event,
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
      await this.persistIntakeTurn({ event,
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: reply, intent: 'UNKNOWN',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    if (this.expenseRepo && isGroundedReceiptFollowUp(normalizedText) && !isSubstituteReceiptConversationText(normalizedText)) {
      if (recentCapturedExpenses.length > 1) {
        this.rememberCandidateDeliverySources(event, expenseDraftCtx, recentCapturedExpenses);
        const reply = (replyLanguage(event) === 'en' ? "More than one recent expense matches; choose one to review." : 'พบรายการล่าสุดมากกว่า 1 รายการค่ะ เลือกรายการที่จะตรวจได้เลย');
        const card = buildLineAssistantTextCardMessage(reply, this.config.webBaseUrl, companyId, undefined, undefined, replyLanguage(event));
        card.quickReply = lineChoiceQuickReply(recentCapturedExpenses.map(item => ({ label: correctionCandidateLabel(item, replyLanguage(event)), text: (replyLanguage(event) === 'en' ? `Show expense ${correctionCandidateLabel(item, 'en')}` : `ขอดูรายการ ${item.label}`) })));
        await this.deliverCompletedReply(event, reply, companyId, resolvedAccess, undefined, card);
        await this.persistIntakeTurn({ event,
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
          const reply = `${formatGroundedReceiptFollowUp(this.config.webBaseUrl, companyId, current, category?.name, normalizedText, replyLanguage(event))}${interruption ? `\n\n${interruption}` : ''}`;
          await this.deliverCompletedReply(event, reply, companyId, resolvedAccess);
          await this.persistIntakeTurn({ event,
            userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
            userMessagePreview: normalizedText, replyText: reply, intent: 'READ_SUMMARY',
          });
          await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
          return;
        }
      }
    }

    const hasSubstituteClarification = openWaiting.some((item) => item.clarifyForIntent === 'SUBSTITUTE_RECEIPT_CONTINUATION');
    const continuationCtx: RequestContext = {
      requestId, authSubject: identity.userId, userId: identity.userId, companyId,
      membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles,
      permissions: resolvedAccess.permissions, scopes: resolvedAccess.scopes, authProvider: 'line',
    };
    const substituteContext = open.substituteContext;
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
    const explicitNoMoreEvidence = substituteContext.workflowState === 'open'
      && /^(?:ไม่มี(?:หลักฐาน(?:อื่น)?|สลิป|รูป|ไฟล์)?)(?:แล้ว)?(?:ค่ะ|ครับ|คะ)?$/u.test(normalizedText);
    if (!event.reimbursementChoiceControl && normalizedText !== 'ไม่มีใบเสร็จ ขอเบิกรายการใหม่นี้' && !counterpartyCommand && (substituteMode !== 'primary' || explicitNoMoreEvidence)
      && this.substituteReceiptContinuation
      && (isSubstituteReceiptConversationText(normalizedText) || hasSubstituteClarification || nextStepSubstituteTarget || explicitNoMoreEvidence)) {
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
        activeExpenseDrafts = await this.expenseDraftConversation.routeContexts(expenseDraftCtx, chatKeyHashOf(event), replyLanguage(event));
        draftRouteSnapshot = JSON.stringify(activeExpenseDrafts);
      }
      let captureReply = captured
        ? formatPaypersReply(this.config.webBaseUrl, companyId, captured.expense.id, { ...({
          textOnly: true,
          amount: captured.insertedAmount,
          categoryName: captured.categoryName,
          sourceDocumentType: captured.expense.sourceDocumentType,
          fields: {
            ...(captured.expense.expenseDate ? { expenseDate: new Date(captured.expense.expenseDate).toISOString() } : {}),
            ...(captured.expense.vendorNameSnapshot ? { vendorName: captured.expense.vendorNameSnapshot } : {}),
          ...(Number(captured.expense.whtAmount) > 0 ? { whtAmount: captured.expense.whtAmount } : {}),
          } as ReceiptOcrFieldResult,
        }), language: replyLanguage(event) })
        : undefined;
      let result: LineSubstituteReceiptContinuationResult;
      try {
        result = await this.substituteReceiptContinuation.execute(continuationCtx, { language: replyLanguage(event),
          messageText: normalizedText,
          chatKeyHash: chatKeyHashOf(event),
          ...(originalChoiceIds ? { boundCandidateExpenseIds: originalChoiceIds } : {}),
          recentCandidates: originalChoiceIds
            ? originalChoiceIds.map(id => ({ id, label: id }))
            : captured
            ? [{ id: captured.expense.id, label: (replyLanguage(event) === 'en' ? `Newly saved expense ${captured.expense.expenseNumber ?? captured.expense.id}` : `รายการที่เพิ่งบันทึก ${captured.expense.expenseNumber ?? captured.expense.id}`) }]
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
        await this.persistIntakeTurn({ event,
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: degraded, intent: 'EVIDENCE_CAPTURE',
        });
        await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
        return;
      }
      await this.rememberSubstituteDeliverySource(event, continuationCtx, result);
      if (captured) captureReply = (await this.savedReceiptReply(event, companyId, captured.expense.id)).texts.join('\n');
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
        await this.persistIntakeTurn({ event,
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
      const reply = formatNextStepGuidanceReply(this.config.webBaseUrl, companyId, recentCapturedExpenses[0], replyLanguage(event));
      await this.deliverCompletedReply(event, reply, companyId, resolvedAccess);
      await this.persistIntakeTurn({ event,
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
      await this.persistIntakeTurn({ event,
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.EXACT_GREETING_REPLY : EXACT_GREETING_REPLY), intent: 'UNKNOWN',
      });
      await this.deliverCompletedReply(event, (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.EXACT_GREETING_REPLY : EXACT_GREETING_REPLY), companyId, resolvedAccess);
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    const aiOpenClarifications = counterpartyCommand ? undefined : openClarifications?.filter((item) =>
      !(substituteInterruption && item.clarifyForIntent === 'SUBSTITUTE_RECEIPT_CONTINUATION')
      && !(mediaResumeCapsule && item.pendingMedia));

    const routedWaiting = openWaiting.filter(item => aiOpenClarifications?.some(clarification => clarification.id === item.id));
    if (!await this.waitingSourcesCurrent(event, expenseDraftCtx, routedWaiting)) return;
    this.clarificationRouteSources.set(event, { candidates: JSON.stringify(recentCapturedExpenses),
      ...(expenseDraftConversationEnabled && canCaptureExpense ? { draftRouting: draftRoutingRevisions(activeExpenseDrafts) } : {}),
    });

    // 5.5 LINE Intake Router first: semantic route before any source-module dispatch.
    // Deterministic guards (identity, company, permissions) already ran above.
    // One busy-wait budget for the WHOLE live turn (intake + gateway turn share it), so a turn
    // queued behind an in-flight media turn waits for the lease instead of bouncing the user.
    const busyWaitDeadlineMs = Date.now() + LINE_AI_LIVE_BUSY_WAIT_MS;
    let routePlan = semanticRoutePlan ?? await this.timeStage(event.webhookEventId, 'intake_route', () => this.tryRouteIntake({
      event, enabledFeatures: entitledFeatureKeys ? [...entitledFeatureKeys] : null,
      entitledFeatureKeys,
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
    if (!semanticRoutePlan && routePlan.status === 'ROUTED' && await this.handleClaimSubmitText(event, expenseDraftCtx, entitledFeatureKeys, conversationContext)) return;
    if (!semanticRoutePlan && await this.continueReimbursementQuestion(event, expenseDraftCtx, routePlan, valueCandidates)) return;
    // A history-only continuation must not survive as a semantic write in the gateway either.
    if (routePlan.status === 'ROUTED' && routePlan.intent === 'EXPENSE_DRAFT_CONTINUATION'
      && expenseDraftConversationEnabled && canCaptureExpense && this.expenseDraftConversation?.answersOpenDraft
      && !isDeterministicLineExpenseDraftInput(normalizedText)
      && routePlan.semanticOutcome !== 'REIMBURSEMENT_CLAIM'
      && !this.retainedTaskSources?.has(event)
      && (routePlan.semanticSubrequests ?? []).every(item => item.kind === 'general' || item.kind === 'help'
        || item.kind === 'write' && (!item.writeIntent || ['EXPENSE_DOCUMENT_CAPTURE', 'EXPENSE_DRAFT_CONTINUATION'].includes(item.writeIntent)))
      && !await this.expenseDraftConversation.answersOpenDraft(expenseDraftCtx, chatKeyHashOf(event), normalizedText, routePlan.captureHints)) {
      routePlan = { status: 'ROUTED', intent: 'ADVISOR_CONVERSATION', language: routePlan.language, confidence: routePlan.confidence,
        usage: routePlan.usage, semanticSubrequests: routePlan.semanticSubrequests?.map(item => {
          const { writeIntent: _writeIntent, taskRef: _taskRef, ...source } = item;
          return { ...source, kind: 'general' as const, goal: normalizedText };
        }) };
    }
    // A bound chat ends a refused route just below (a retained selection, then the grant gate), so the
    // credit refusal is answered here. An unbound chat keeps its deterministic fallbacks and is answered
    // after them, further down.
    if (this.boundConversations.has(event)
      && await this.answerAiCreditRefusal(event, companyId, routePlan, resolvedAccess.permissions.includes(PLAN_MANAGE_PERMISSION_KEY))) return;

    const retainedTask = this.retainedTaskSources?.get(event);
    if (retainedTask) {
      const selected = routePlan.semanticSubrequests?.[0], ref = selected?.taskRef;
      if (routePlan.status !== 'ROUTED' || routePlan.semanticSubrequests?.length !== 1 || selected?.kind !== 'write'
        || selected.writeIntent !== retainedTask.source.semanticSubrequest.writeIntent || !ref
        || ref.taskId !== retainedTask.source.taskRef.taskId || ref.taskRevision !== retainedTask.source.taskRef.taskRevision
        || ref.subrequestIndex !== retainedTask.source.taskRef.subrequestIndex) {
        await this.deliverReply(event, (replyLanguage(event) === 'en' ? "The selected record could not be verified; its details are retained and no document was created or changed." : 'ยังตรวจสอบรายการที่เลือกไม่สำเร็จค่ะ รายละเอียดเดิมยังเก็บไว้ ยังไม่ได้สร้างหรือแก้เอกสาร')); return;
      }
      // Domain grounding sees the selected immutable clause. The current intake input/grant stay on the selection event.
      normalizedText = retainedTask.sourceText;
      // Untyped voucher/counterparty clauses use their preview tools, never the capture intent of their original message.
      if (!selected.writeIntent) routePlan = { ...routePlan, intent: 'BUSINESS_READ_QUESTION' };
    }
    if (await this.handleRoutedPreference(event, requestId, routePlan)) return;
    const orderedWrites = routePlan.semanticSubrequests && this.orderedExpenseWrites(routePlan.semanticSubrequests);
    if (orderedWrites) routePlan = { ...routePlan, semanticSubrequests: routePlan.semanticSubrequests!.map(item => orderedWrites.find(write => write.index === item.index) ?? item) };
    const typedWrites = routePlan.semanticSubrequests?.filter(item => item.kind === 'write');
    const multipleExistingBusinessWrites = (typedWrites?.length ?? 0) > 1;
    if (this.boundConversations.has(event) && typedWrites?.[0]?.writeIntent
      && (typedWrites.length === 1 || this.orderedExpenseWrites(routePlan.semanticSubrequests!))) {
      routePlan = { ...routePlan, intent: orderedWrites?.[0]?.writeIntent ?? (orderedWrites ? 'BUSINESS_READ_QUESTION' : typedWrites[0].writeIntent) };
    }
    // The intake identifies a claim correction; expense draft tools cannot edit its collection or saved draft.
    if (this.boundConversations.has(event) && this.config.lineAiReimbursementDraftWriteEnabled
      && routePlan.intent === 'EXPENSE_CAPTURE_CORRECTION' && routePlan.semanticOutcome === 'REIMBURSEMENT_CLAIM'
      && typedWrites?.length === 1) routePlan = { ...routePlan, intent: 'REIMBURSEMENT_REQUEST_START' };
    const initialGrantV2 = this.budgetGrantsV2.get(event);
    // Choice postbacks still pass the metered intake/admission above; only their bound proposal is deterministic.
    if (initialGrantV2 && (event.reimbursementChoiceControl || normalizedText === 'ไม่มีใบเสร็จ ขอเบิกรายการใหม่นี้')) {
      const bound = this.boundConversations.get(event);
      if (bound) {
        let control = event.reimbursementChoiceControl;
        if (!control) {
          const active = await this.reimbursementDrafts.active({ ctx: expenseDraftCtx, owner: bound.owner, ownerEpoch: bound.epoch });
          const options = active && await this.reimbursementAdapter.readDisplayOptions({ ctx: expenseDraftCtx, owner: bound.owner, ownerEpoch: bound.epoch, actionId: active.id });
          if (options?.control) control = { action: 'reimbursement_choice', ...options.control, choice: 'no-receipt' };
        }
        if (control) {
          const result = await this.reimbursementAdapter.choose({ ctx: expenseDraftCtx, owner: bound.owner, ownerEpoch: bound.epoch, control });
          await this.deliverReimbursementCollection(event, expenseDraftCtx, result);
          await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
          return;
        }
      }
    }

    if (this.boundConversations.has(event)) {
      if (!initialGrantV2 || routePlan.status !== 'ROUTED') {
        if (await this.answerAiCreditRefusal(event, companyId, routePlan, resolvedAccess.permissions.includes(PLAN_MANAGE_PERMISSION_KEY))) return;
        // A missing grant is a system/budget-admission gap, not a text the model failed to parse.
        await this.deliverReply(event, !initialGrantV2 || isTransientLineAiRouteFailure(routePlan.errorCode)
          ? (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.LINE_AI_ROUTE_TRANSIENT_REPLY : LINE_AI_ROUTE_TRANSIENT_REPLY) : (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.LINE_AI_ROUTE_UNCLEAR_REPLY : LINE_AI_ROUTE_UNCLEAR_REPLY));
        await this.updateEventLog(event.webhookEventId, 'provider_unavailable', routePlan.errorCode ?? 'AI_CONTRACT_UNSUPPORTED', companyId); return;
      }
      const hasPublic = routePlan.semanticSubrequests?.some(item => item.kind === 'public') === true && this.config.lineAiPublicLookupEnabled;
      const onlyGeneral = routePlan.semanticSubrequests?.every(item => ['general', 'help'].includes(item.kind)) === true;
      // A prepared read keeps the full read budget. Its compiled fast lane still spends no further call,
      // but when that lane cannot serve the message the gateway now plans it with tools instead of
      // answering "ยังดึงข้อมูลส่วนนี้ไม่ได้" after zero calls (UAT 2026-09-29: the two-slot 'simple' lane
      // left no room for that fallback).
      const lane = hasPublic ? 'public' : onlyGeneral ? 'general' : !routePlan.semanticSubrequests && (routePlan.intent === 'ADVISOR_CONVERSATION' || routePlan.intent === 'UNSUPPORTED') ? 'general'
        : 'mixed';
      const profiles: AiBudgetProfileIdV2[] = lane === 'public' ? ['line-control/2', 'line-answer/2', 'public-lookup/2'] : lane === 'general' ? ['line-answer/2'] : ['line-control/2', 'line-answer/2'];
      let narrowed;
      try { narrowed = await this.aiGateway.narrowLineReliabilityGrant(initialGrantV2, lane, profiles); }
      catch (error) {
        if (!(error instanceof LineAiBudgetDeadlineExceededError)) throw error;
        await this.deliverReply(event, formatRefusal('ai_timeout', undefined, replyLanguage(event)));
        await this.updateEventLog(event.webhookEventId, 'ai_timeout', error.code, companyId); return;
      }
      if (!narrowed) { await this.deliverReply(event, AI_BUDGET_UNAVAILABLE_REPLY[replyLanguage(event)]); await this.updateEventLog(event.webhookEventId, 'provider_unavailable', 'AI_BUDGET_UNAVAILABLE', companyId); return; }
      this.budgetGrantsV2.set(event, narrowed);
    }
    if (routePlan.semanticSubrequests && !await this.preserveSemanticTask(event, routePlan.semanticSubrequests)) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "The task context could not be stored; choose a pending task or resend the request, as no new record was created." : 'ยังบันทึกบริบทคำขอชุดนี้ไม่ได้ค่ะ กรุณาเลือกงานค้างที่จะทำต่อหรือส่งคำขออีกครั้ง ยังไม่ได้ทำรายการใหม่ให้'));
      await this.updateEventLog(event.webhookEventId, 'provider_unavailable', 'LINE_CONTEXT_STALE_STATE', companyId); return;
    }
    if (!await this.mayDeliverBusinessReply(event) || !await this.waitingSourcesCurrent(event, expenseDraftCtx, routedWaiting)) return;
    if (!await draftRouteCurrent()) return;
    if (recentCapturedExpenses.length) {
      if (!await this.correctionCandidatesCurrent(expenseDraftCtx, chatKeyHashOf(event), JSON.stringify(recentCapturedExpenses))) {
        await this.denyBusinessDelivery(event, 'LINE_DELIVERY_SOURCE_CHANGED', this.deliveryAccess.get(event));
        return;
      }
    }

    // Navigation follows the metered intake; the buttons carry requests, never mutation authority.
    if (routePlan.status === 'ROUTED' && /^(?:ช่วย)?แก้(?:ไข)?ข้อมูล(?:ให้)?(?:หน่อย)?(?:ค่ะ|คะ|ครับ)?[?？]?$/u.test(normalizedText.replace(/\s+/gu, ''))
      && routePlan.semanticSubrequests?.length === 1 && ['general', 'help', 'write'].includes(routePlan.semanticSubrequests[0]!.kind)) {
      const choices = await this.recentEditableChoices(expenseDraftCtx, recentCapturedExpenses, activeExpenseDrafts, entitledFeatureKeys, replyLanguage(event));
      const reply = (replyLanguage(event) === 'en' ? "Which record would you like to edit?" : 'ต้องการแก้ไขรายการไหนคะ');
      const card = buildLineAssistantTextCardMessage(reply, this.config.webBaseUrl, companyId, undefined, undefined, replyLanguage(event));
      card.quickReply = lineChoiceQuickReply([...choices, { label: (replyLanguage(event) === 'en' ? "More options" : 'อื่นๆ'), text: (replyLanguage(event) === 'en' ? "I want to edit another detail; ask which detail." : 'ต้องการแก้ไขข้อมูลอื่น ช่วยถามว่าข้อมูลส่วนไหน') }]);
      for (const [index, choice] of choices.entries()) if (choice.uri) {
        card.quickReply!.items[index]!.action = { type: 'uri', label: card.quickReply!.items[index]!.action.label, uri: choice.uri };
      }
      if (canEditLine) this.rememberCandidateDeliverySources(event, expenseDraftCtx, recentCapturedExpenses);
      await this.deliverCompletedReply(event, reply, companyId, resolvedAccess, undefined, card);
      await this.persistIntakeTurn({ event, userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: reply, intent: 'CLARIFY' });
      await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
      return;
    }

    if (await this.deliverStructuralCapacityLimit(event, routePlan, expenseDraftCtx, resolvedAccess)) return;
    const mixedBusiness = !!initialGrantV2 && await this.prepareMixedBusinessQuestions(event, requestId, routePlan, resolvedAccess, entitledFeatureKeys, valueCandidates);
    if (mixedBusiness && multipleExistingBusinessWrites && !this.mixedBusinessQuestions.get(event)?.orderedWrites) {
      const delivery = await this.deliverMixedBusinessWriteSelection(event, typedWrites!);
      if (delivery === 'ok') await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
      return;
    }
    const semanticTurnV2 = !mixedBusiness && !!initialGrantV2 && !!routePlan.semanticSubrequests && (
      routePlan.semanticSubrequests.length > 1 || routePlan.semanticSubrequests.every(item => ['general', 'help', 'read', 'public'].includes(item.kind))
      || this.config.lineAiReimbursementDraftWriteEnabled && (routePlan.intent === 'REIMBURSEMENT_REQUEST_START'
        || routePlan.semanticOutcome === 'REIMBURSEMENT_CLAIM' && typedWrites?.some(item => item.taskRef)));
    if (!semanticTurnV2) {
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
      await this.persistIntakeTurn({ event,
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
        const result = await this.substituteReceiptContinuation.execute(continuationCtx, { language: replyLanguage(event),
          messageText: normalizedText,
          chatKeyHash: chatKeyHashOf(event),
          recentCandidates: executeCandidates,
          ...(boundCandidateIds.length ? { boundCandidateExpenseIds: boundCandidateIds } : {}),
          // PRIMARY is the model-only route: a FRESH start that matches no deterministic entry phrase must
          // CONFIRM before it writes (no auto-create on the router's confidence alone).
          requireStartConfirmation: true,
          confirmedStart,
        });
        const mixedSubstitute = this.mixedBusinessQuestions?.get(event);
        if (mixedSubstitute) mixedSubstitute.businessStatus = result.status === 'FORBIDDEN' ? 'denied' : result.status === 'READY_FOR_WEB' || result.status === 'CANCELLED' ? 'handled' : 'needs_user';
        await this.rememberSubstituteDeliverySource(event, continuationCtx, result);
        // PRECEDENCE when BOTH a substitute workflow AND an expense draft are open: the substitute path
        // (semantic route, OR the narrow canonical fallback taken because the provider was UNAVAILABLE)
        // wins THIS turn, and any OPEN expense draft is INTERRUPTED — paused with a note appended to the
        // reply, never silently dropped. So even with the router unreachable, a canonical substitute
        // command deterministically handles the substitute and preserves the draft to resume later.
        const replyText = `${result.replyText}${interruption ? `\n\n${interruption}` : ''}`;
        await this.deliverCompletedReply(event, replyText, companyId, resolvedAccess);
        await this.persistIntakeTurn({ event,
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
        await this.persistIntakeTurn({ event,
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: REIMBURSEMENT_HANDOFF_FORBIDDEN_REPLY[replyLanguage(event)],
          intent: 'MUTATION_REQUEST', refused: true,
        });
        await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting,
          resolvedReimbursementIds, 'reimbursement_forbidden');
        await this.deliverReply(event, REIMBURSEMENT_HANDOFF_FORBIDDEN_REPLY[replyLanguage(event)]);
        await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
        return;
      }
      // Fail-closed: anything short of a strong EMPLOYEE_PAID claim asks who paid before anything else.
      if (routePlan.semanticOutcome !== 'REIMBURSEMENT_CLAIM' || routePlan.fundingSource !== 'EMPLOYEE_PAID') {
        await this.persistIntakeTurn({ event,
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: REIMBURSEMENT_PAYER_CLARIFY_REPLY[replyLanguage(event)], intent: 'CLARIFY',
        });
        // An answer that did not settle the payer closes the question it answered and opens the NEXT one,
        // in that order — otherwise the stale entry outlives the reply and the next message inherits it.
        await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting,
          resolvedReimbursementIds, 'reimbursement_payer_reclarify');
        await this.deliverRequiredMessages(event, [await this.timeStage(event.webhookEventId, 'render',
          () => this.withCompletionMenu(buildReimbursementPayerClarificationMessage(replyLanguage(event)), companyId, resolvedAccess, replyLanguage(event)))]);
        await this.appendSourceBoundClarifications(event, {
          messagingChannelId: event.messagingChannelId,
          companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
          userId: identity.userId,
          items: [{
            text: normalizedText, state: 'waiting_user', clarifyQuestion: REIMBURSEMENT_PAYER_CLARIFY_REPLY[replyLanguage(event)],
            intent: 'CLARIFY', clarifyForIntent: 'REIMBURSEMENT_REQUEST_START',
          }],
        });
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      if (reimbursementMode === 'clarify_only') {
        await this.persistIntakeTurn({ event,
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.REIMBURSEMENT_CLARIFY_ONLY_REPLY : REIMBURSEMENT_CLARIFY_ONLY_REPLY), intent: 'MUTATION_REQUEST',
        });
        await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting,
          resolvedReimbursementIds, 'reimbursement_clarify_only');
        // Server card with no CTA: the text carries no link, so the card renders no button.
        await this.deliverRequiredMessages(event, [await this.timeStage(event.webhookEventId, 'render',
          async () => buildLineAssistantTextCardMessage((replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.REIMBURSEMENT_CLARIFY_ONLY_REPLY : REIMBURSEMENT_CLARIFY_ONLY_REPLY), this.config.webBaseUrl, companyId, undefined, undefined, replyLanguage(event)))]);
        await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
        return;
      }
      // handoff, allowed: the web form is still the only place the record is created.
      await this.persistIntakeTurn({ event,
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.REIMBURSEMENT_HANDOFF_REPLY : REIMBURSEMENT_HANDOFF_REPLY), intent: 'MUTATION_REQUEST',
      });
      await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting,
        resolvedReimbursementIds, 'reimbursement_handoff');
      await this.deliverRequiredMessages(event, [await this.timeStage(event.webhookEventId, 'render',
        () => this.withCompletionMenu(buildReimbursementHandoffMessage(this.config.webBaseUrl, companyId, replyLanguage(event)), companyId, resolvedAccess, replyLanguage(event)))]);
      await this.audit.log({
        companyId, actorUserId: identity.userId, action: 'reimbursement.line_handoff',
        targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'SUCCESS', riskLevel: 'LOW',
        metadataJson: { semanticOutcome: routePlan.semanticOutcome, fundingSource: routePlan.fundingSource, confidence: routePlan.confidence },
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    if (routePlan.status === 'ROUTED' && (routePlan.intent === 'EXPENSE_DRAFT_CONTINUATION'
      || routePlan.intent === 'EXPENSE_DOCUMENT_CAPTURE' && expenseDraftConversationEnabled
        && activeExpenseDrafts.filter(draft => draft.status === 'OPEN').length === 1
        && activeExpenseDrafts.some(draft => draft.status === 'OPEN' && draft.questions?.length)
        && !isLineExpenseDraftStartEligible(normalizedText, routePlan.captureHints,
          routePlan.semanticOutcome === 'BUSINESS_EXPENSE' && routePlan.fundingSource === 'COMPANY_PAID'))) {
      if (!expenseDraftConversationEnabled) {
        await this.deliverReply(event, TEXT_EXPENSE_CLARIFY_REPLY[replyLanguage(event)]);
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      if (!canCaptureExpense || !this.expenseDraftConversation) {
        await this.deliverReply(event, receiptDeniedReply(resolvedAccess, replyLanguage(event)));
        await this.updateEventLog(event.webhookEventId,
          receiptFeatureDisabled(resolvedAccess) ? 'feature_disabled' : 'forbidden',
          receiptFeatureDisabled(resolvedAccess) ? LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE : LINE_AI_ERROR_CODES.FORBIDDEN,
          companyId);
        return;
      }
      let result = await this.expenseDraftConversation.execute(expenseDraftCtx, { language: replyLanguage(event),
        messageText: normalizedText,
        chatKeyHash: chatKeyHashOf(event),
        webhookEventId: event.webhookEventId,
        captureHints: routePlan.intent === 'EXPENSE_DOCUMENT_CAPTURE'
          ? { ...routePlan.captureHints, targetExpenseId: activeExpenseDrafts.find(draft => draft.status === 'OPEN')!.expenseId }
          : routePlan.captureHints,
      });
      if (!result.handled && routePlan.intent === 'EXPENSE_DOCUMENT_CAPTURE') {
        result = await this.expenseDraftConversation.execute(expenseDraftCtx, { language: replyLanguage(event), messageText: 'ต่อ', chatKeyHash: chatKeyHashOf(event),
          webhookEventId: event.webhookEventId, captureHints: { targetExpenseId: activeExpenseDrafts.find(draft => draft.status === 'OPEN')!.expenseId } });
      }
      if (result.handled) {
        const mixedContinuation = this.mixedBusinessQuestions?.get(event);
        if (mixedContinuation) mixedContinuation.businessStatus = ['ENDED', 'CANCELLED'].includes(result.status) ? 'handled' : 'needs_user';
        this.rememberContinuationDeliverySource(event, expenseDraftCtx, result);
        await this.deliverCompletedReplies(event, this.withDraftWebLink(result.replyTexts, companyId, result.expenseId, replyLanguage(event)), companyId, resolvedAccess);
        await this.persistIntakeTurn({ event,
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
        await this.deliverReply(event, receiptDeniedReply(resolvedAccess, replyLanguage(event)));
        await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.reject', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'MEDIUM', metadataJson: { reason: 'missing_expense_receipt_line_upload', route: 'text_note' } });
        await this.updateEventLog(event.webhookEventId,
          receiptFeatureDisabled(resolvedAccess) ? 'feature_disabled' : 'forbidden',
          receiptFeatureDisabled(resolvedAccess) ? LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE : LINE_AI_ERROR_CODES.FORBIDDEN,
          companyId);
        return;
      }
      if (!this.captureExpenseNote) {
        await this.deliverReply(event, ERROR_REPLY[replyLanguage(event)]);
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
          await this.deliverReply(event, TEXT_EXPENSE_CLARIFY_REPLY[replyLanguage(event)]);
          await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
          return;
        }
      }

      const sourceTask = retainedTask && (await this.contextV2.projection(this.boundConversations.get(event)!.owner))?.tasks
        .find(task => task.taskId === retainedTask.source.taskRef.taskId);
      const counterparty = typeof sourceTask?.slots?.counterpartyId === 'string' && typeof sourceTask.slots.counterpartyRevision === 'string'
        ? await this.counterparties.source(ctx, sourceTask.slots.counterpartyId, sourceTask.slots.counterpartyRevision) : undefined;
      const originalCandidates = retainedTask && counterparty
        ? await extractValueCandidatesV2(retainedTask.source.inputEvidence, todayCivilDate('Asia/Bangkok')) : undefined;
      const sourceAmounts = originalCandidates?.amounts.filter(amount => amount.currencyToken === 'บาท') ?? [];
      const retainedHints = sourceAmounts.length === 1 ? {
        amount: sourceAmounts[0]!.value,
        description: normalizedText.split('เลขผู้เสียภาษี')[0]!.trim(), vendorName: counterparty!.name,
        sourceDocumentType: 'EXPENSE_NOTE_TEXT' as const,
      } : {};
      let captured: Awaited<ReturnType<CaptureLineExpenseNoteUseCase['execute']>>;
      // Resolved OUTSIDE `timeStage`: the stage measures the capture, not this lookup.
      const captureBranchId = await this.resolveLineCaptureBranchId(companyId, ctx.membershipId, ctx.scopes ?? {});
      try {
        captured = await this.timeStage(event.webhookEventId, 'capture_execute', () => this.captureExpenseNote!.execute(ctx, {
          messageText: normalizedText,
          ...(counterparty ? { counterparty } : {}),
          captureHints: {
            ...retainedHints,
            ...(routePlan.captureHints ?? {}),
            confidence: routePlan.captureHints?.confidence ?? routePlan.confidence,
          },
          groundingTexts: openWaiting
            .filter((item) => routePlan.resolvedClarificationIds?.includes(item.id)
              && item.clarifyForIntent === 'EXPENSE_DOCUMENT_CAPTURE')
            .map((item) => item.text),
          lineMessageId: retainedTask?.operationId ?? event.lineMessageId ?? event.webhookEventId,
          lineEventId: retainedTask?.operationId ?? event.webhookEventId,
          // Same LINE branch rule the photo lanes use — a text note in a multi-branch company hit
          // the identical TRANSACTION_BRANCH_REQUIRED dead end.
          branchId: captureBranchId,
          draftConversationEnabled: expenseDraftConversationEnabled,
          semanticBusinessExpenseConfirmed: routePlan.semanticOutcome === 'BUSINESS_EXPENSE'
            && routePlan.fundingSource === 'COMPANY_PAID',
          chatKeyHash: chatKeyHashOf(event),
          ...(capturePlan ? { consumption: capturePlan.consumption } : {}),
        }));
      } catch (error) {
        if (!(error instanceof LineTextExpenseCaptureIncompleteError)) throw error;
        // One canonical question for the fields that are actually missing — the same string is delivered,
        // persisted and ledgered, so a later turn resolves exactly what the user was asked.
        const clarifyReply = formatTextExpenseClarifyReply(error, replyLanguage(event));
        await this.deliverReply(event, clarifyReply);
        await this.settleWriteLane(event, 'needs_user', clarifyReply);
        await this.persistIntakeTurn({ event,
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
      const sequenceCapture = !!counterparty && Number(captured.expense.whtAmount) > 0;
      if (sequenceCapture) await this.expenseSequenceTask(event, [captured.expense.id]);
      const mixedCapture = this.mixedBusinessQuestions?.get(event); if (mixedCapture) mixedCapture.businessStatus = sequenceCapture ? 'needs_user' : 'handled';
      this.rememberReceiptDeliverySource(event, ctx, captured.expense,
        captured.categoryNameSourceId && captured.categoryName ? { id: captured.categoryNameSourceId, name: captured.categoryName } : undefined);
      const captureSummary = {
        textOnly: true,
        amount: captured.insertedAmount,
        categoryName: captured.categoryName,
        sourceDocumentType: captured.expense.sourceDocumentType,
        fields: {
          ...(captured.expense.expenseDate ? { expenseDate: new Date(captured.expense.expenseDate).toISOString() } : {}),
          ...(captured.expense.vendorNameSnapshot ? { vendorName: captured.expense.vendorNameSnapshot } : {}),
          ...(Number(captured.expense.whtAmount) > 0 ? { whtAmount: captured.expense.whtAmount } : {}),
        } as ReceiptOcrFieldResult,
      };
      // The review card states what this lane's own summary states, so it is built for that summary
      // only; a reply the draft conversation wrote keeps the card that shows its text.
      const ownSummary = captured.replyTexts.length === 0;
      const replyTexts = ownSummary
        ? [formatPaypersReply(this.config.webBaseUrl, companyId, captured.expense.id, { ...(captureSummary), language: replyLanguage(event) })]
        : captured.replyTexts;
      const expenseDraftInterruption = await interruptExpenseDraft([captured.expense.id]);
      if (expenseDraftInterruption) replyTexts[replyTexts.length - 1] = `${replyTexts.at(-1)}\n\n${expenseDraftInterruption}`;
      const confirmation = await this.requestedCaptureConfirmation(event, ctx, captured.expense.id, normalizedText, Number(captured.expense.whtAmount) > 0);
      if (confirmation) {
        await this.deliverRequiredMessages(event, [...replyTexts.map(text => buildLineAssistantTextCardMessage(text, this.config.webBaseUrl, companyId, undefined, undefined, replyLanguage(event))), confirmation]);
      } else {
        const state = parseLineExpenseDraftContinuation(captured.expense.sourceChannelMetadataJson?.lineExpenseDraftContinuation);
        await this.deliverCompletedReplies(event, replyTexts, companyId, resolvedAccess, ownSummary || state?.unresolvedQuestions.length === 0
          ? expenseDraftCardFacts(captured.expense.id, { ...captureSummary, status: captured.expense.status, item: captured.expense.note,
            ...(expenseDraftInterruption ? { tail: expenseDraftInterruption } : {}), language: replyLanguage(event) })
          : undefined);
      }
      await this.settleWriteLane(event, sequenceCapture ? 'needs_user' : 'handled');
      await this.ackConsumed(capturePlan, 'evidence_capture');
      await this.persistIntakeTurn({ event,
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: replyTexts.join('\n'), intent: 'EVIDENCE_CAPTURE',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    if (routePlan.status === 'ROUTED' && routePlan.intent === 'EXPENSE_CAPTURE_CORRECTION') {
      if ((entitledFeatureKeys === null || entitledFeatureKeys.has('expenses'))
        && await this.explainLockedExpenseEdit(event, expenseDraftCtx, resolvedAccess, routePlan.correctionHints?.targetExpenseId, recentCapturedExpenses, routePlan.correctionHints?.vendorName?.to)) return;
      const vendorReference = routePlan.correctionHints?.amount && routePlan.correctionHints.vendorName?.from === undefined
        && !/(?:แก้|เปลี่ยน)(?:ชื่อ)?(?:ร้าน|ผู้ขาย)|\b(?:vendor|seller|rename)\b/iu.test(normalizedText)
        ? routePlan.correctionHints.vendorName?.to : undefined;
      if (vendorReference) {
        const { vendorName: _reference, ...changes } = routePlan.correctionHints!;
        routePlan = { ...routePlan, correctionHints: changes };
      }
      if (!canCaptureExpense && !canEditLine) {
        await this.deliverReply(event, receiptDeniedReply(resolvedAccess, replyLanguage(event)));
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
      const correctionPlan = this.planConsumption(companyId, chatKey, identity.userId, openWaiting, routePlan.resolvedClarificationIds, 'correction_apply');
      const originalIds = resolvedChoices[0]?.candidateExpenseIds;
      const originalCandidates = originalIds ? await this.loadCorrectionCandidates(companyId, identity.userId,
        chatKeyHashOf(event), resolvedAccess.scopes, originalIds) : recentCapturedExpenses;
      let correctionCandidates = originalIds ? originalIds.flatMap(id => originalCandidates.filter(item => item.id === id)) : originalCandidates;
      if (!originalIds && vendorReference && this.editableExpenses && canEdit) {
        const pages = await Promise.all((['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'] as const)
          .map(status => this.editableExpenses!.execute(expenseDraftCtx, { status, page: 1, pageSize: 200 })));
        // ponytail: bounded discovery; an incomplete page never establishes a unique target.
        if (pages.every(page => page.total <= page.data.length)) {
          const rows = pages.flatMap(page => page.data).filter(row => !routePlan.correctionHints?.amount?.from
            || Number(row.grandTotalAmount) === Number(routePlan.correctionHints.amount.from));
          const match = resolveNameCandidate(normalizeVendorName(vendorReference), rows.filter(row => row.vendorNameSnapshot)
            .map(row => ({ id: row.id, name: normalizeVendorName(row.vendorNameSnapshot!) })), VENDOR_NAME_STRIP_PREFIXES);
          const row = match.kind === 'resolved' ? rows.find(row => row.id === match.id) : undefined;
          if (row) correctionCandidates = [{ id: row.id, label: row.vendorNameSnapshot ?? 'ร่างค่าใช้จ่าย',
            expenseDate: row.expenseDate.toISOString(), amount: row.grandTotalAmount, createdAt: row.createdAt.toISOString() }];
        }
      }
      if (originalIds && correctionCandidates.length !== originalIds.length) {
        await this.denyBusinessDelivery(event, 'LINE_DELIVERY_SOURCE_CHANGED', this.deliveryAccess.get(event));
        return;
      }
      const correctionCtx: RequestContext = {
        requestId, authSubject: identity.userId, userId: identity.userId, companyId,
        membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles,
        permissions: resolvedAccess.permissions, scopes: resolvedAccess.scopes, authProvider: 'line',
      };
      const correctionEvidence = buildCorrectionEvidence(event.inputEvidence ? event.messageText : normalizedText, openWaiting, routePlan.resolvedClarificationIds)
        .map((item, index) => index === 0 && valueCandidates && 'version' in valueCandidates && valueCandidates.version === 2
          ? { ...item, valueCandidatesV2: valueCandidates } : item);
      // S-4 (spec §5.4/§5.5): money, charges, VAT and whole lines are NOT the five-field correction
      // lane's to write — it would have answered "ยังไม่ได้แก้ยอด" and pointed at the web. They now
      // route to the draft tools, which PREVIEW the change and wait for [ยืนยัน].
      //
      // The detector is an allowlist and runs only here, where the intake router has already
      // classified this turn as a correction of a record THIS user captured in THIS chat — the route
      // is the own-record marker, and the detector additionally refuses a message that names
      // somebody else's document. `amount` is handled below because it arrives as a router HINT
      // rather than as words this function can read.
      // NAT-12: a text-note draft still collecting answers keeps its staged amount in that collection,
      // not on a line, so correcting it is an answer to the draft itself.
      const draftAnswer = expenseDraftConversationEnabled
        ? await this.correctOpenExpenseDraft(event, expenseDraftCtx, routePlan.correctionHints, normalizedText, correctionCandidates)
        : null;
      if (draftAnswer) {
        this.rememberContinuationDeliverySource(event, expenseDraftCtx, draftAnswer);
        await this.deliverCompletedReplies(event, this.withDraftWebLink(draftAnswer.replyTexts, companyId, draftAnswer.expenseId, replyLanguage(event)), companyId, resolvedAccess);
        await this.settleWriteLane(event, 'needs_user', draftAnswer.replyTexts.join('\n'));
        await this.ackConsumed(correctionPlan, 'correction_apply');
        await this.persistIntakeTurn({ event, userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: draftAnswer.replyTexts.join('\n'), intent: 'CORRECTION' });
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      const hints = routePlan.correctionHints;
      const hintedFields = (['expenseDate', 'amount', 'vendorName', 'documentNumber', 'note'] as const)
        .filter((field) => hints?.[field] !== undefined);
      if (hints?.targetExpenseId && correctionCandidates.some(candidate => candidate.id === hints.targetExpenseId) && !hintedFields.length && !detectLineDraftEditRequest(normalizedText)) {
        const selected = hints?.targetExpenseId ? correctionCandidates.filter(candidate => candidate.id === hints.targetExpenseId) : correctionCandidates;
        const reply = selected.length === 1 ? (replyLanguage(event) === 'en' ? 'Which field and new value would you like?' : 'ต้องการแก้ไขช่องไหนเป็นค่าอะไรคะ') : (replyLanguage(event) === 'en' ? "Which record would you like to edit?" : 'ต้องการแก้ไขรายการไหนคะ');
        this.rememberCandidateDeliverySources(event, expenseDraftCtx, correctionCandidates, Boolean(originalIds));
        const card = buildLineAssistantTextCardMessage(reply, this.config.webBaseUrl, companyId, undefined, undefined, replyLanguage(event));
        if (selected.length > 1) card.quickReply = lineChoiceQuickReply(selected.slice(0, 4).map(candidate => ({ label: correctionCandidateLabel(candidate, replyLanguage(event)), text: (replyLanguage(event) === 'en' ? `Edit expense ${correctionCandidateLabel(candidate, 'en')}` : `ขอแก้รายการ ${candidate.label}`) })));
        await this.deliverCompletedReply(event, reply, companyId, resolvedAccess, undefined, card);
        await this.appendSourceBoundClarifications(event, { companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId, userId: identity.userId,
          items: [{ text: normalizedText, state: 'waiting_user', clarifyQuestion: reply, intent: 'CLARIFY', clarifyForIntent: 'EXPENSE_CAPTURE_CORRECTION', candidateExpenseIds: selected.map(candidate => candidate.id) }] });
        await this.persistIntakeTurn({ event, userId: identity.userId, companyId, webhookEventId: event.webhookEventId, userMessagePreview: normalizedText, replyText: reply, intent: 'CLARIFY' });
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      const detectedRequest = detectLineDraftEditRequest(normalizedText);
      const headerFields = hintedFields.filter((field) => field !== 'amount');
      const mixedEdit = (detectedRequest && hintedFields.some(field => field !== 'amount'))
        || (headerFields.length > 0 && hintedFields.includes('amount'));
      let draftRequest: { tool: LineDraftUpdateTool; input: Record<string, unknown> } | null = detectedRequest;
      let draftTargetId = hints?.targetExpenseId && correctionCandidates.some(candidate => candidate.id === hints.targetExpenseId) ? hints.targetExpenseId : undefined;
      let draftClarification: string | undefined;
      if (!draftRequest && hintedFields.length > 0) {
        const hintedTarget = hints?.targetExpenseId
          ? correctionCandidates.find((candidate) => candidate.id === hints.targetExpenseId)
          : correctionCandidates.length === 1 ? correctionCandidates[0] : undefined;
        if (!hintedTarget && correctionCandidates.length > 1) {
          draftClarification = [
            (replyLanguage(event) === 'en' ? 'Several records match; identify the bill or date, then send one change at a time.' : 'พบหลายรายการค่ะ กรุณาระบุบิลหรือวันที่ก่อน แล้วส่งการแก้ไขทีละอย่างนะคะ'),
            ...correctionCandidates.map(candidate => candidate.label),
          ].join('\n');
        } else if (hintedTarget && this.expenseRepo && hints) {
          const target = await this.expenseRepo.findByIdWithRelations(companyId, hintedTarget.id, undefined, resolvedAccess.scopes);
          if (target) {
            const checked = evaluateCorrectionHints(hints, {
              expenseDate: target.expenseDate?.toISOString() ?? null,
              grandTotalAmount: target.grandTotalAmount,
              vendorNameSnapshot: target.vendorNameSnapshot,
              vendorDocumentNumber: target.vendorDocumentNumber,
              note: target.note,
            }, correctionEvidence, ['expenseDate', 'amount', 'vendorName', 'documentNumber', 'note']);
            if (checked.status === 'clarify') draftClarification = CORRECTION_DIRECTION_CLARIFY_REPLY[replyLanguage(event)];
            if (checked.status === 'guidance' && checked.reason.startsWith('field_too_long:')) {
              const [, field, limit] = checked.reason.split(':');
              draftClarification = (replyLanguage(event) === 'en' ? `The value for ${field} exceeds ${limit} characters; send a shorter value, and no changes have been applied.` : `ข้อมูลช่อง ${field} ยาวเกิน ${limit} ตัวอักษร กรุณาส่งค่าที่สั้นลงค่ะ ยังไม่ได้แก้ไขรายการ`);
            }
            if (checked.status === 'applicable') {
              const fields = checked.fields;
              const amount = fields.amount?.to;
              const header = {
                ...(fields.expenseDate ? { expenseDate: fields.expenseDate.to } : {}),
                ...(fields.vendorName ? { vendorName: fields.vendorName.to } : {}),
                ...(fields.documentNumber ? { documentNumber: fields.documentNumber.to } : {}),
                ...(fields.note ? { noteAppend: fields.note.to } : {}),
              };
              draftRequest = amount
                ? { tool: 'expense.draft.set_line', input: { amount } }
                : { tool: 'expense.draft.set_header', input: header };
              draftTargetId = hintedTarget.id;
            }
          }
        }
      }
      if (mixedEdit) draftClarification = (replyLanguage(event) === 'en' ? 'Send one change at a time so the proposal can show every change clearly.' : 'ขอแก้ทีละอย่างก่อนนะคะ เพื่อให้ตัวอย่างแสดงการเปลี่ยนแปลงครบและไม่ตกหล่นค่ะ');
      if (draftClarification) {
        this.rememberCandidateDeliverySources(event, expenseDraftCtx, correctionCandidates, Boolean(originalIds));
        const card = buildLineAssistantTextCardMessage(draftClarification, this.config.webBaseUrl, companyId, undefined, undefined, replyLanguage(event));
        if (correctionCandidates.length > 1) card.quickReply = lineChoiceQuickReply(correctionCandidates.map(candidate => ({ label: correctionCandidateLabel(candidate, replyLanguage(event)), text: (replyLanguage(event) === 'en' ? `Edit expense ${correctionCandidateLabel(candidate, 'en')}` : `ขอแก้รายการ ${candidate.label}`) })));
        await this.deliverCompletedReply(event, draftClarification, companyId, resolvedAccess, undefined, card);
        await this.persistIntakeTurn({ event,
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: draftClarification, intent: 'CLARIFY',
        });
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      const effectiveDraftEditEnabled = canQuery && canEditLine && expenseEditingFeatureEnabled && this.draftUpdate?.enabled
        ? await this.aiGateway.lineDraftEditCapabilityEnabled(requestId)
        : false;
      const draftOutcome = draftRequest && effectiveDraftEditEnabled
        ? await this.proposeDraftUpdate(event, correctionCtx, resolvedAccess, draftRequest, correctionEvidence,
          draftTargetId ?? (correctionCandidates.length === 1 ? correctionCandidates[0]!.id : undefined))
        : 'not_handled';
      if (draftOutcome !== 'not_handled') {
        await this.ackConsumed(correctionPlan, draftProposalAckReason(draftOutcome));
        return;
      }
      // The legacy compatibility use case only clarifies or explains the preview requirement.
      const guidanceOutcome = this.correctExpense
        ? await this.correctExpense.execute(correctionCtx, {
          lineMessageIdHash: hashMessagePreview(event.lineMessageId ?? event.webhookEventId),
          chatKeyHash: chatKeyHashOf(event),
          candidates: correctionCandidates,
          ...(routePlan.correctionHints ? { hints: routePlan.correctionHints } : {}),
          evidence: correctionEvidence,
        })
        : { status: 'guidance' as const, reason: 'correction_module_unavailable' };

      let reply = guidanceOutcome.status === 'clarify'
        ? CORRECTION_DIRECTION_CLARIFY_REPLY[replyLanguage(event)]
        : formatCorrectionGuidanceReply(this.config.webBaseUrl, companyId, correctionCandidates, canEdit, guidanceOutcome.reason, replyLanguage(event));
      if (guidanceOutcome.status !== 'clarify') {
        this.rememberCandidateDeliverySources(event, expenseDraftCtx, correctionCandidates, Boolean(originalIds));
        await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting, routePlan.resolvedClarificationIds, 'correction_guidance');
      }
      const expenseDraftInterruption = guidanceOutcome.status === 'clarify' ? undefined : await interruptExpenseDraft();
      if (expenseDraftInterruption) reply = `${reply}\n\n${expenseDraftInterruption}`;
      if (guidanceOutcome.status === 'clarify') await this.deliverReply(event, reply);
      else await this.deliverCompletedReply(event, reply, companyId, resolvedAccess);
      await this.persistIntakeTurn({ event,
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: reply, intent: 'CORRECTION',
      });
      await this.audit.log({
        companyId, actorUserId: identity.userId, action: 'expense.line_correction.guide',
        targetType: correctionCandidates.length === 1 ? 'expense_record' : 'LineWebhookEvent',
        targetId: correctionCandidates.length === 1 ? correctionCandidates[0].id : event.webhookEventId,
        requestId, result: 'SUCCESS', riskLevel: 'LOW',
        metadataJson: { candidateCount: correctionCandidates.length, canEdit, outcome: guidanceOutcome.status },
      });
      await this.updateEventLog(
        event.webhookEventId,
        guidanceOutcome.status === 'clarify' ? 'clarification_required' : 'completed',
        undefined,
        companyId,
      );
      return;
    }

    if (routePlan.status === 'ROUTED' && routePlan.intent === 'SIGNATURE_UPLOAD_TICKET') {
      if (!canSubmitSignature) {
        await this.deliverReply(event, SIGNATURE_FORBIDDEN_REPLY[replyLanguage(event)]);
        await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
        return;
      }
      // Text asked for a signature upload but no image came with it: ask for the image only.
      await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting, routePlan.resolvedClarificationIds, 'signature_request');
      const expenseDraftInterruption = await interruptExpenseDraft();
      const reply = `${SIGNATURE_NEED_IMAGE_REPLY[replyLanguage(event)]}${expenseDraftInterruption ? `\n\n${expenseDraftInterruption}` : ''}`;
      await this.deliverReply(event, reply);
      await this.persistIntakeTurn({ event,
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: normalizedText, replyText: reply, intent: 'SIGNATURE_REQUEST',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    if (routePlan.status === 'ROUTED' && routePlan.intent === 'CLARIFY') {
      // Discovery: prefer the router's own clarifying question (bounded at parse) over the template.
      if (recentCapturedExpenses.length) this.rememberCandidateDeliverySources(event, expenseDraftCtx, recentCapturedExpenses);
      const clarifyReply = routePlan.clarifyQuestion ?? CLARIFY_REPLY[replyLanguage(event)];
      await this.deliverReply(event, clarifyReply);
      await this.persistIntakeTurn({ event,
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

    }
    // BUSINESS_READ_QUESTION, MUTATION_REQUEST_REFUSAL, UNSUPPORTED, or router
    // UNAVAILABLE: continue through the normal permission-checked AI turn path.
    if (!canQuery) {
      await this.deliverReply(event, FORBIDDEN_REPLY[replyLanguage(event)]);
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
      locale: replyLanguage(event) === 'en' ? 'en-GB' : 'th-TH',
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
      messageText: event.inputEvidence ? event.messageText : normalizedText,
      ...await this.reliabilityContext(event),
      ...(routePlan.semanticSubrequests ? { semanticSubrequests: mixedBusiness && orderedWrites?.[0] && !orderedWrites[0].writeIntent
        ? [{ ...orderedWrites[0], index: 0, dependsOn: [] }] : routePlan.semanticSubrequests } : {}),
      ...(routePlan.reimbursementHints ? { reimbursementHints: routePlan.reimbursementHints }
        : routePlan.semanticOutcome === 'REIMBURSEMENT_CLAIM' && routePlan.captureHints?.businessPurpose
          ? { reimbursementHints: { businessPurpose: routePlan.captureHints.businessPurpose } } : {}),
      ...(routePlan.resolvedClarificationIds ? { resolvedClarificationIds: routePlan.resolvedClarificationIds } : {}),
      ...(retainedTask ? { retainedTaskSource: retainedTask.source } : {}),
      ...(this.budgetGrantsV2.get(event) && event.inputEvidence ? { inputEvidence: event.inputEvidence, budgetGrantV2: this.budgetGrantsV2.get(event), contractCapabilities: ['input-evidence-v2' as const, 'budget-envelope-v2' as const] } : {}),
      ...(routePlan.howToActionId ? { howToActionId: routePlan.howToActionId } : {}),
      ...(this.boundConversations.has(event) && this.config.lineAiApprovedKnowledgeEnabled ? { approvedKnowledge: true, ...(routePlan.selectedKnowledgeCardIds ? { selectedKnowledgeCardIds: routePlan.selectedKnowledgeCardIds } : {}) } : {}),
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
      if (await this.answerAiCreditRefusal(event, companyId, routePlan, resolvedAccess.permissions.includes(PLAN_MANAGE_PERMISSION_KEY))) return;
      await this.deliverReply(event, AI_BUDGET_UNAVAILABLE_REPLY[replyLanguage(event)]);
      await this.updateEventLog(event.webhookEventId, 'provider_unavailable', routePlan.budgetErrorCode, companyId,
        routePlan.budgetScope ? { budgetScope: routePlan.budgetScope } : undefined);
      return;
    }

    // 7.5 Item 10F: durable `turn` entry BEFORE the gateway call — a crash mid-turn leaves it
    // unacked and the reclaim worker re-runs it (at-least-once is safe: read-only channel).
    const ledgerTurnId = mixedBusiness ? this.mixedBusinessQuestions.get(event)?.ledgerId ?? null : this.ledger
      ? await this.ledger.appendTurn({
          messagingChannelId: event.messagingChannelId,
          companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
          userId: identity.userId, text: turnRequest.messageText,
          ...(this.boundConversations.has(event) && turnRequest.budgetGrantV2 ? { acceptedRequest: { request: turnRequest, ownerEpoch: this.boundConversations.get(event)!.epoch, conversationId: this.boundConversations.get(event)!.id, accessFingerprint: this.deliveryAccess.get(event)!.fingerprint } } : {}),
          ...(valueCandidates && { valueCandidates }),
          // Carried so a reclaimed turn reaches the gateway with the SAME trusted provenance the
          // live turn had — otherwise a drained E4 turn is told it is out of scope (spec §5.3).
          ...(turnRequest.intakeIntent ? { intakeIntent: turnRequest.intakeIntent } : {}),
        })
      : null;

    // Park before tools prepare revision-bound evidence choices, repairs or action cards.
    const expenseDraftInterruption = await interruptExpenseDraft();
    // 8. Call AI Gateway
    let turnResponse: LineAiTurnResponse;
    try {
      turnResponse = await this.timeStage(event.webhookEventId, 'gateway_turn', () => this.aiGateway.requestLineTurn(turnRequest, { busyWaitDeadlineMs,
        ...(event.admitOverCap ? { admitOverCap: true } : {}) }));
      const bodyRefusal = knownAiBudgetResponse(turnResponse);
      if (bodyRefusal) throw new HttpException(bodyRefusal, 429);
    } catch (err) {
      this.logger.error({ msg: 'AI Gateway error', requestId, ...safeLineErrorDetails(err) });
      const failure = classifyLineAiGatewayFailure(err);
      // G-05: the month's AI budget is spent. Waiting cannot fix it, so this is the one gateway
      // failure that gets a card instead of a "try again" line — and the one that must NOT leave a
      // ledger entry for the reclaim worker to keep retrying against a closed admission.
      if (failure.replyKind === 'budget_exceeded') {
        await this.deliverRequiredMessages(event, [
          buildAiBudgetExceededMessage(await this.isTrialTier(companyId), { budgetErrorCode: failure.budgetCode, budgetScope: failure.budgetScope },
            resolvedAccess.permissions.includes(PLAN_MANAGE_PERMISSION_KEY), replyLanguage(event), this.config.webBaseUrl),
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
          ? formatRefusal('ai_timeout', undefined, replyLanguage(event))
          // The meter could not be read — say that, rather than the generic "something broke".
          : failure.replyKind === 'budget_unavailable' ? AI_BUDGET_UNAVAILABLE_REPLY[replyLanguage(event)]
          // With a ledger entry the reclaim drain WILL answer this turn — say so instead of
          // inviting a resend that would double-answer. No entry ⇒ the legacy resend copy.
          : failure.replyKind === 'rate_limited' ? (ledgerTurnId ? BUSY_FOLLOW_UP_REPLY[replyLanguage(event)] : RATE_LIMIT_REPLY[replyLanguage(event)]) : ERROR_REPLY[replyLanguage(event)],
      );
      await this.updateEventLog(event.webhookEventId, failure.status, failure.errorCode, companyId,
        failure.budgetScope ? { budgetScope: failure.budgetScope } : undefined);
      // The turn entry stays unacked on purpose: the reclaim worker retries it later and
      // pushes the answer, so a gateway outage cannot silently lose the request.
      return;
    }

    // The API's own read rows are authoritative even when gateway telemetry omits them.
    const evidenceIds = await this.readEvidence.forTurn(turnRequest, turnResponse).catch(() => null);
    const expenseSummary = evidenceIds && this.readEvidence.deliveredExpenseSummaryForTurn
      ? await this.readEvidence.deliveredExpenseSummaryForTurn(turnRequest, turnResponse).catch(() => undefined) : undefined;
    const expenseCriterionConfirmation = evidenceIds?.length === 0 && this.readEvidence.isReadFreeExpenseCriterionConfirmation
      ? await this.readEvidence.isReadFreeExpenseCriterionConfirmation(turnRequest, turnResponse).catch(() => false) : false;
    // Spec §4 R-M2: computed here (request-scoped access to this turn's OWN evidence, same as
    // expenseSummary above) but only usable by a FUTURE turn once loadConversationContext reads it
    // back from the delivery-confirmed lineTurnOutcome row (recordTurnOutcome persists it below).
    const recentReads = evidenceIds && this.readEvidence.recentReadsForTurn
      ? await this.readEvidence.recentReadsForTurn(turnRequest, turnResponse).catch(() => undefined) : undefined;
    this.deliverySources.set(event, { requestId, ids: evidenceIds, ...(expenseSummary ? { expenseSummary } : {}),
      ...(expenseCriterionConfirmation ? { expenseCriterionConfirmation: true } : {}),
      ...(recentReads?.length ? { recentReads } : {}) });

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
    const resumeCapsules = [substituteInterruption?.resumeCapsule, mediaResumeCapsule, expenseDraftInterruption].filter((item): item is string => !!item);
    if (resumeCapsules.length > 0) {
      const resumeText = resumeCapsules.length === 1
        ? resumeCapsules[0]
        : (replyLanguage(event) === 'en' ? `There are ${resumeCapsules.length} pending tasks:
${resumeCapsules.map(item => item.replace(/^↩️\s*/, '')).join('\n')}` : `↩️ ยังมีงานค้าง ${resumeCapsules.length} งานค่ะ\n${resumeCapsules.map(item => item.replace(/^↩️\s*/, '')).join('\n')}`);
      const actionCard = turnResponse.presentation?.cards.find(card => card.chatActionId);
      const replyText = `${turnResponse.replyText}\n\n${resumeText}`;
      turnResponse = {
        ...turnResponse,
        replyText,
        presentation: actionCard ? { kind: 'answer_cards', cards: [{ ...actionCard, text: replyText }] } : undefined,
      };
    }
    const turnId = await this.timeStage(event.webhookEventId, 'persistence', () => this.persistTurn(
      identity.userId,
      companyId,
      event.webhookEventId,
      turnRequest.messagePreviewHash,
      turnRequest.messageText.slice(0, PREVIEW_MAX_CHARS),
      turnResponse, event,
    ));
    await this.updateEventLog(event.webhookEventId, 'response_ready', undefined, companyId);

    if (turnResponse.semanticCoverage) this.semanticDelivery.set(event, turnResponse.semanticCoverage);
    // 10. Customer-visible completion requires a confirmed LINE reply/push.
    const completionMessage = await this.timeStage(event.webhookEventId, 'render', () => this.withCompletionMenu(
      buildLineBusinessAnswerMessage(turnResponse, formatLineReply(turnResponse, this.config.webBaseUrl, replyLanguage(event)), this.config.webBaseUrl, companyId, normalizedText, replyLanguage(event)),
      companyId,
      resolvedAccess, replyLanguage(event)));
    const actionHelpQuickReply = productHelpQuickReply(turnResponse, resolvedAccess.permissions, entitledFeatureKeys, replyLanguage(event));
    if (actionHelpQuickReply) completionMessage.quickReply = actionHelpQuickReply;
    if (evidenceIds && turnResponse.toolsInvoked.includes('wht.calculate_withholding') && this.readEvidence.whtReadChoicesForTurn) {
      const choices = await this.readEvidence.whtReadChoicesForTurn(turnRequest, turnResponse).catch(() => undefined);
      if (choices?.length) completionMessage.quickReply = lineChoiceQuickReply(choices.map(({ label, text, webPath }) => ({ label, text,
        ...(webPath ? { uri: absoluteWebLink(this.config.webBaseUrl, webPath) } : {}) })));
    }
    // S-4 (spec §5.4): when the gateway's plan reached one of the five `draft_update` tools, the
    // API has already computed and stored a preview for THIS turn — the tool call is the proposal,
    // the card is the question, and the write is still the confirm postback. The card is built
    // here rather than by the gateway because only the API may print buttons bound to the exact
    // previewId that its confirm/cancel handlers validate, and because every figure on it comes
    // from the server's own rolled-back run, never from model text.
    const hasDraftPreview = turnResponse.toolsInvoked.some((tool) => (LINE_DRAFT_UPDATE_TOOLS as readonly string[]).includes(tool));
    const draftPreview = hasDraftPreview
      ? await this.draftUpdate?.pendingPreview(expenseDraftCtx, chatKeyHashOf(event), requestId)
      : null;
    const draftCalls = turnResponse.toolCalls?.filter(call => (LINE_DRAFT_UPDATE_TOOLS as readonly string[]).includes(call.name));
    const draftFailed = !!draftCalls?.length && draftCalls.every(call => call.status !== 'ok' || !!call.errorCode);
    // An explained tool failure has no preview to authorize. An alleged successful preview still
    // fails closed when missing, and an existing preview retains its final-send revision check.
    if (hasDraftPreview && (draftPreview || !turnResponse.refused && !draftFailed)) this.deliveryDraftPreviews.set(event, {
      context: expenseDraftCtx, chatKeyHash: chatKeyHashOf(event), requestId, previewId: draftPreview?.previewId ?? null, phase: 'PENDING',
    });
    const counterpartyPreview = turnResponse.toolsInvoked.includes('counterparty.action.preview')
      ? await this.counterparties.pending(expenseDraftCtx, chatKeyHashOf(event), requestId) : null;
    if (counterpartyPreview) {
      this.deliveryCounterparties.set(event, { context: expenseDraftCtx, preview: counterpartyPreview });
      await this.counterpartyTask(event, counterpartyPreview.token);
    }
    const actionPreview = turnResponse.toolsInvoked.some(name => ['expense.action.preview', 'company.action.preview'].includes(name))
      ? await this.expenseActions.pending(expenseDraftCtx, chatKeyHashOf(event), requestId) : null;
    const claimHandoff = !actionPreview && turnResponse.toolsInvoked.includes('expense.action.preview')
      ? turnResponse.sourceRefs.find(ref => ref.entityType === 'expense_action_preview'
        && ref.permissionChecked && ref.webPath?.startsWith(`/companies/${companyId}/reimbursements/`)) : undefined;
    if (actionPreview) this.deliveryExpenseActions.set(event, { context: expenseDraftCtx, chat: chatKeyHashOf(event), requestId, preview: actionPreview });
    const repairChoices = turnResponse.toolsInvoked.includes('expense.action.preview')
      ? await this.expenseActions.repairChoices(expenseDraftCtx, chatKeyHashOf(event), requestId, replyLanguage(event)) ?? expenseActionNextStepChoices(turnResponse.replyText) : null;
    const completionWithChoices = repairChoices?.length ? inheritCompleteLineBusinessAnswerPresentation(completionMessage, {
      ...completionMessage, quickReply: lineChoiceQuickReply(repairChoices.map(choice => ({ ...choice,
        cameraRoll: choice.text === 'ส่งสลิปโอนสำหรับใบเบิกนี้' || 'cameraRoll' in choice && choice.cameraRoll === true }))),
    }) : completionMessage;
    const bound = this.boundConversations.get(event);
    const actionIds = [...new Set(turnResponse.sourceRefs.filter(ref => ref.module === 'reimbursements'
      && ref.entityType === 'reimbursement_draft_action' && typeof ref.entityId === 'string').map(ref => ref.entityId!))];
    let reimbursementMessages: LineReplyMessage[] = [];
    if (bound && actionIds.length === 1 && turnResponse.toolsInvoked.some(name => name.startsWith('reimbursement.draft.'))) {
      const result = await this.reimbursementDrafts.get({ ctx: expenseDraftCtx, owner: bound.owner, ownerEpoch: bound.epoch, actionId: actionIds[0]! });
      this.deliveryReimbursements.set(event, { context: expenseDraftCtx, result });
      reimbursementMessages = await this.reimbursementDraftMessages(result, expenseDraftCtx, event);
      if (result.status === 'needs_fields' || result.status === 'needs_target') {
        const options = await this.reimbursementAdapter?.readDisplayOptions({ ctx: expenseDraftCtx, owner: bound.owner, ownerEpoch: bound.epoch, actionId: actionIds[0]! });
        if (options) {
          this.reimbursementOptionsDelivery.set(event, { actionId: actionIds[0]!, options });
          const choices = buildReimbursementOptionsMessages(options, this.config.webBaseUrl ?? '', replyLanguage(event));
          if (choices.length) reimbursementMessages = choices;
        }
      }
    }
    const actionOnly = (actionPreview || counterpartyPreview || reimbursementMessages.length > 0) && (routePlan.semanticSubrequests?.length ?? 1) === 1;
    if (actionOnly) {
      const first = reimbursementMessages[0];
      const question = actionPreview?.summary ?? (first?.type === 'text' ? first.text : first?.type === 'flex' ? first.canonicalText : undefined);
      if (question) this.semanticDelivery.set(event, (turnResponse.semanticCoverage ?? []).map(item => item.status === 'needs_user' ? { ...item, question } : item));
    }

    const delivery = await this.deliverMessages(
      event,
      [...(actionOnly ? [] : draftPreview ? [completionWithChoices, buildDraftUpdatePreviewCard(draftPreview, this.config.webBaseUrl, replyLanguage(event))]
        : claimHandoff ? [buildLineAssistantTextCardMessage((replyLanguage(event) === 'en' ? `${turnResponse.replyText}
View claim: ${absoluteWebLink(this.config.webBaseUrl, claimHandoff.webPath!)}` : `${turnResponse.replyText}\nเปิดใบเบิก: ${absoluteWebLink(this.config.webBaseUrl, claimHandoff.webPath!)}`), this.config.webBaseUrl, companyId, undefined, undefined, replyLanguage(event))]
        : [completionWithChoices]), ...reimbursementMessages, ...(counterpartyPreview ? [buildCounterpartyCard(counterpartyPreview, replyLanguage(event))] : []), ...(actionPreview ? [buildExpenseActionCard(actionPreview, undefined, replyLanguage(event), this.config?.webBaseUrl)] : [])],
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

    if (turnResponse.semanticCoverage) await this.settleSemanticTask(event, turnResponse.semanticCoverage, actionIds);
    // 10.5 Acknowledge work only after delivery. Clarifications and uncovered
    // sub-requests are now safe to advance because the employee saw this turn.
    if (this.ledger) {
      const subRequests = this.ledger.coverageToSubRequests(turnResponse.coverage, turnResponse.semanticCoverage, routePlan.semanticSubrequests);
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
        // R-C8: status + term, so a locked shop is labelled the way LIFF labels it (R-C2).
        company: { select: { name: true, brandName: true, status: true, planTerm: { select: { termStartAt: true, termEndsAt: true, renewCount: true, termDisabledAt: true } } } },
        // R-C11: role status + permissions, so "may manage the package" is the web's predicate.
        roles: { select: { role: { select: { key: true, name: true, status: true, permissions: { select: { permission: { select: { key: true } } } } } } } },
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
    const items: CompanyPickerItem[] = memberships.map(membership => companyPickerItem(membership, replyLanguage(event)));
    if (!this.handoffLinks) return items;
    const visible = new Set(companyPickerPage(items, currentCompanyId, page).visible.map((item) => item.companyId));
    return Promise.all(items.map(async (item, index) => (visible.has(item.companyId)
      ? {
        ...item,
        webUrl: await this.handoffLinks!.linkFor(
          { userId, companyId: item.companyId, lineUserId: event.lineUserId, surface: LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN },
          companyWebPath(memberships[index]!),
        ) ?? undefined,
      }
      : item)));
  }

  private async handleCompanyCommand(event: LineTextEvent, requestId: string, userId: string, displayName: string, command: LineCompanyCommand, signupHelp?: PublicPolicyAnswer): Promise<void> {
    const memberships = await this.listLineCompanies(userId);
    if (memberships.length === 0) {
      await this.deliverReply(event, UNLINKED_REPLY[replyLanguage(event)]);
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
          command.page, replyLanguage(event)
        )]);
        await this.updateEventLog(event.webhookEventId, 'needs_company_selection', LINE_AI_ERROR_CODES.AMBIGUOUS_COMPANY);
        return;
      }
      // UAT 2026-09-06 "สมัครแล้วแต่บริษัทหาย": the shop this owner applied for is not a membership
      // yet, so nothing on this screen mentioned it. Same read the door card does, so the two
      // entrances keep agreeing about "still open" — and while one IS open the card withholds the
      // button, because the LIFF form behind it can only answer `line_signup_already_pending`.
      const pendingSignup = await this.findOpenLineSignup(event.lineUserId);
      const stateLabel = companyStateLabel(currentMembership);
      const messages: LineReplyMessage[] = [
        ...(signupHelp && isCompanyOwner(currentMembership) && this.newShopSignupUrl() && !pendingSignup
          ? [buildPublicPolicyCardMessage(signupHelp, replyLanguage(event))] : []),
        buildCompanyContextMessage({
        companyName: companyLabel(currentMembership, replyLanguage(event)),
        ...(stateLabel ? { stateLabel } : {}),
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
          companyWebPath(currentMembership),
        ) ?? undefined,
      }, replyLanguage(event))];
      if (memberships.length > 1) {
        messages.push(buildCompanyPickerMessage(
          await this.companyPickerItems(event, userId, memberships, currentMembership.companyId, command.page),
          currentMembership.companyId,
          command.page, replyLanguage(event)
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
      await this.deliverRequiredMessages(event, [buildCompanyPickerMessage(memberships.map(membership => companyPickerItem(membership, replyLanguage(event))), current?.companyId, undefined, replyLanguage(event))]);
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
    await this.deliverReply(event, (replyLanguage(event) === 'en' ? `Selected shop: ${companyLabel(selected, replyLanguage(event))}.` : `🏢 เปลี่ยนบริษัทเป็น ${companyLabel(selected, replyLanguage(event))} แล้ว`));
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
  private async persistBoundTurn(event: LineTextEvent | LineReceiptUploadEvent, data: Prisma.AiTurnUncheckedCreateInput) {
    const bound = this.boundConversations.get(event);
    return bound ? this.contextV2.createTurn(bound.owner, bound.epoch, data) : this.prisma.client.aiTurn.create({ data });
  }

  private async persistIntakeTurn(input: {
    event: LineTextEvent | LineReceiptUploadEvent;
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
        const owner = this.conversationOwner(input.companyId, input.userId, input.event);
        const conversationId = owner ? this.boundConversations.get(input.event)?.id : `line-${input.companyId}-${input.userId}`;
        if (!conversationId) throw new Error('LINE_CONTEXT_ADMISSION_REQUIRED');
        if (!owner) await this.prisma.client.aiConversation.upsert({
          where: { id: conversationId },
          create: { id: conversationId, companyId: input.companyId, userId: input.userId, channel: 'line' },
          update: {},
        });
        await this.persistBoundTurn(input.event, {
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
    event: LineTextEvent | LineReceiptUploadEvent,
  ): Promise<string> {
    const owner = this.conversationOwner(companyId, userId, event);
    const bound = this.boundConversations.get(event);
    if (owner && !bound) throw new Error('LINE_CONTEXT_ADMISSION_REQUIRED');
    const conv = owner ? { id: bound!.id } : await this.prisma.client.aiConversation.upsert({
      where: { id: `line-${companyId}-${userId}` },
      create: { id: `line-${companyId}-${userId}`, companyId, userId, channel: 'line' },
      update: {},
    });
    const turn = await this.persistBoundTurn(event, {
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
   * or an explicit `null` — nothing invented. Prepared-plan version is the forwarded request's. Model
   * provider and ids come from the response's `modelLineage` and usage entries; usage token totals
   * appear only when the gateway reported them.
   *
   * `lane` is derived from what the turn response carries (expense-advisor plan P7):
   * - 'prepared': a simple_grounded prepared plan was forwarded and the turn made NO model call —
   *   the gateway answered from its deterministic formatter.
   * - 'semantic': the semantic path ran — a planner/compose call (usage tag line.loop or
   *   line.compose), or semantic coverage without a prepared answer (a comparison, name resolution or
   *   scope reply the gateway rendered without a model call).
   * - 'other': anything else, e.g. the legacy orchestrator. The advisor direct answer never reaches
   *   this summary: it is delivered before any gateway turn.
   *
   * `fallbackReason` is the first non-handled semantic coverage reasonCode, else
   * DETERMINISTIC_FALLBACK_RENDERED when a model-free fallback answered an item, else null. It stays
   * distinct from `refused`/`refusalReason`/`errorCode`. A prepared plan that was forwarded but not
   * used shows as preparedPlanVersion set with lane 'semantic'.
   *
   * `costSatang` stays null. The authoritative cost is priced when each model call settles, against
   * that invocation's pinned tariff (settleAiBudgetStep / recordCompanyAiUsage), and stored per call in
   * AiUsageEvent keyed by requestId. The turn flow never receives that settled amount, and re-pricing
   * here could disagree with the ledger — join AiUsageEvent on requestId for per-turn cost.
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
      const usageTags = new Set((usage ?? []).map((entry) => entry?.tag).filter((tag): tag is string => typeof tag === 'string'));
      const coverage = Array.isArray(response.semanticCoverage) ? response.semanticCoverage : [];
      const semanticModelCall = usageTags.has('line.loop') || usageTags.has('line.compose');
      const preparedForwarded = input.request.preparedPlan?.responseMode === 'simple_grounded';
      const lane = semanticModelCall ? 'semantic'
        : preparedForwarded && usageTags.size === 0 && !response.refused ? 'prepared'
          : coverage.length > 0 && usageTags.size === 0 ? 'semantic'
            : 'other';
      const fallbackReason = coverage.find((item) => item?.status !== 'handled' && item?.reasonCode)?.reasonCode
        ?? (coverage.some((item) => item?.reasonCode === 'DETERMINISTIC_FALLBACK_RENDERED') ? 'DETERMINISTIC_FALLBACK_RENDERED' : null);
      this.logger.log({
        msg: 'line.ai.turn_summary',
        surface: 'employee_oa',
        webhookEventId: input.webhookEventId,
        requestId: input.requestId,
        preparedPlanVersion: input.request.preparedPlan?.version ?? null,
        lane,
        intent: response.intent,
        refused: response.refused,
        refusalReason: response.refusalReason ?? null,
        errorCode: response.errorCode ?? null,
        fallbackReason,
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

  private conversationOwner(companyId: string, userId: string, event: LineTextEvent | LineReceiptUploadEvent): LineConversationOwner | null {
    const access = this.deliveryAccess.get(event);
    if (this.config.lineAiReliabilityV2Mode !== 'on' || !isLineAiRolloutAllowed(this.config.lineAiReliabilityV2CompanyIds, companyId)
      || !this.config.lineAiDeliveryPlanV2Enabled || !isLineAiRolloutAllowed(this.config.lineAiDeliveryPlanV2WriteCompanyIds, companyId)
      || !event.messagingChannelId || (event.pushTargetId && event.pushTargetId !== event.lineUserId) || !access?.membershipId) return null;
    return { companyId, userId, membershipId: access.membershipId, channel: 'line', channelKind: 'USER', messagingChannelId: event.messagingChannelId, chatKeyHash: chatKeyHashOf(event) };
  }

  private async loadConversationContext(companyId: string, userId: string, event: LineTextEvent | LineReceiptUploadEvent): Promise<LineAiConversationContext | undefined> {
    if (event.pushTargetId && event.pushTargetId !== event.lineUserId) return undefined;
    const owner = this.conversationOwner(companyId, userId, event);
    if (owner) await this.contextV2.admit(owner);
    const since = new Date(Date.now() - LINE_AI_CONTEXT_WINDOW_MINUTES * 60 * 1000);
    const rows = await this.prisma.client.aiTurn.findMany({
      where: {
        companyId,
        userId,
        ...(owner ? { conversationId: lineConversationId(owner) } : { conversation: { channelKind: null } }),
        createdAt: { gte: since },
        status: { in: ['COMPLETED', 'REFUSED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: LINE_AI_CONTEXT_MAX_TURNS,
      select: {
        webhookEventId: true,
        createdAt: true,
        userMessagePreview: true,
        replyPreview: true,
        intent: true,
        agent: true,
        refused: true,
      },
    });
    // Only presentation continuity: prior user wording cannot grant data or mutation authority.
    if (!event.language || ('messageText' in event && (!/[A-Za-z\u0E00-\u0E7F]/u.test(event.messageText) || /^\/(?:company|companies)\b/iu.test(event.messageText)))) event.language = lineReplyLanguage('messageText' in event ? event.messageText : '',
      lineReplyLanguage(rows.find(row => row.userMessagePreview && !row.userMessagePreview.startsWith('['))?.userMessagePreview ?? '', event.language));
    const captureAccess = this.expenseRepo?.listRecentLineCaptures
      ? await this.permissionResolver.resolveAccess(userId, companyId) : null;
    const canReadCaptures = captureAccess && (RECEIPT_CAPTURE_PERMISSIONS.some(permission => captureAccess.permissions.includes(permission))
      || captureAccess.permissions.includes('expense.update'));
    const captures = canReadCaptures && this.expenseRepo ? await this.expenseRepo.listRecentLineCaptures({
      companyId, createdByUserId: userId, chatKeyHash: chatKeyHashOf(event),
      since: new Date(Date.now() - 2 * 60 * 60_000), scopes: captureAccess.scopes ?? {}, take: 5,
    }) : [];
    const noticeAccess = this.deliveryAccess.get(event);
    const noticeItems = noticeAccess ? await this.expenseActions?.shownApprovalNotices?.({ requestId: 'line-notice-context', authSubject: userId, userId, companyId, membershipId: noticeAccess.membershipId, roles: [], permissions: [], scopes: {}, authProvider: 'line' }, chatKeyHashOf(event)) ?? [] : [];
    let quotedRecords = await this.quotedRecordsForEvent(event);
    const quoteOwner = this.quoteOwner(event);
    const createdClaims = quoteOwner && this.quotedMessages?.recentReimbursementDraft
      ? await this.quotedMessages.recentReimbursementDraft(quoteOwner) : [];
    if (!quotedRecords.length) quotedRecords = createdClaims;
    // Signed counterparty saves leave a locator in this owner's task. Carry it before
    // preserveSemanticTask drops completed tasks; tools still recheck the sold web permissions.
    const projection = owner ? await this.contextV2.projection(owner) : undefined;
    if (projection && projection.expiresAtMs > Date.now()) quotedRecords = validQuoteRecords([...quotedRecords,
      ...projection.tasks.flatMap(task => task.state === 'completed' && typeof task.slots?.counterpartyId === 'string'
        && typeof task.slots.counterpartyRevision === 'string' ? [{ tool: 'counterparty.get_detail', id: task.slots.counterpartyId }] : [])]);
    if (rows.length === 0 && captures.length === 0 && noticeItems.length === 0 && quotedRecords.length === 0) return undefined;
    // AP21: tool permission/feature checks cannot prove a historical record is still in scope.
    // Even an unchanged actor can lose access when a record moves. The existing sourceRefs carry
    // locators, not current authorization. Keep the user's questions for follow-ups, but never
    // send stored derived replies; current business facts must be read through ERP tools. The
    // bounded stored preview is inspected only to recognize a fixed capability-help routing hint.
    // Its contents never enter model input, and the help examples use current access again.
    const recentTurns = [...rows].reverse().map((row) => {
      const userMessagePreview = row.userMessagePreview ?? undefined;
      return {
        at: row.createdAt.toISOString(),
        ...(userMessagePreview && { userMessagePreview,
          ...(userMessagePreview.length < PREVIEW_MAX_CHARS ? { userMessagePreviewComplete: true as const } : {}) }),
        ...(row.intent && { intent: capabilityHistoryIntent(row.replyPreview) ?? String(row.intent) }),
        ...(row.agent && { agent: row.agent }),
        refused: row.refused,
      };
    });
    let deliveredExpenseSummary: LineAiConversationContext['deliveredExpenseSummary'];
    let recentReads: LineAiReadMemory[] | undefined;
    const current = this.deliveryAccess.get(event);
    const chatKeyHash = chatKeyHashOf(event);
    if (current && typeof this.prisma.client.lineTurnOutcome?.findMany === 'function') {
      const eventIds = rows.flatMap(row => typeof row.webhookEventId === 'string' ? [row.webhookEventId] : []);
      const outcomes = eventIds.length ? await this.prisma.client.lineTurnOutcome.findMany({
        where: { webhookEventId: { in: eventIds }, deliveredAt: { not: null } },
        select: { webhookEventId: true, deliveredAt: true, authorizationJson: true },
      }).catch(() => []) : [];
      const proved = outcomes.flatMap(outcome => {
        const root = outcome.authorizationJson as Record<string, unknown> | null;
        const saved = root?.['expenseSummary'] as Record<string, unknown> | undefined;
        const ranges = Array.isArray(saved?.['ranges']) ? saved['ranges'] : [];
        if (!outcome.deliveredAt || !saved || saved['userId'] !== userId || saved['companyId'] !== companyId
          || saved['membershipId'] !== current.membershipId
          || saved['fingerprint'] !== current.fingerprint || saved['chatKeyHash'] !== chatKeyHash
          || saved['recipientHash'] !== lineDeliveryRecipientHash(event.lineUserId, event.pushTargetId ?? event.lineUserId, event.messagingChannelId ?? '')
          || saved['statusBasis'] !== 'exclude_rejected_voided' || ranges.length === 0 || ranges.length > 24) return [];
        const parsed = ranges.flatMap(range => {
          if (!range || typeof range !== 'object' || Array.isArray(range)) return [];
          const item = range as Record<string, unknown>;
          if (typeof item['fromDate'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item['fromDate'])
            || typeof item['toDate'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item['toDate'])
            || item['fromDate'] > item['toDate'] || !(item['branchId'] === null || typeof item['branchId'] === 'string')) return [];
          return [{ fromDate: item['fromDate'], toDate: item['toDate'], branchId: item['branchId'] as string | null }];
        });
        if (parsed.length !== ranges.length) return [];
        const deliveredAt = outcome.deliveredAt instanceof Date ? outcome.deliveredAt : new Date(String(outcome.deliveredAt));
        if (!Number.isFinite(deliveredAt.getTime())) return [];
        return [{ at: deliveredAt, descriptor: { version: 1 as const, deliveredAt: deliveredAt.toISOString(),
          statusBasis: 'exclude_rejected_voided' as const,
          ...(saved['continuationOfPrior'] === true ? { continuationOfPrior: true as const } : {}), ranges: parsed } }];
      });
      const sorted = proved.sort((a, b) => b.at.getTime() - a.at.getTime());
      const distinctScopes = new Set(sorted.map(item => JSON.stringify(item.descriptor.ranges
        .map(range => [range.fromDate, range.toDate, range.branchId]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))));
      if (sorted.length && (distinctScopes.size === 1 || sorted[0]!.descriptor.continuationOfPrior)) deliveredExpenseSummary = sorted[0]!.descriptor;

      // Spec §4 R-M2: same `outcomes` fetch, same identity/chat/recipient proof as expenseSummary
      // above — but unlike it, every DISTINCT delivered turn's entries count (not just the latest),
      // newest turn first, until the 3-entry cap. R-M7: `current`/chatKeyHash are already gated by
      // conversationOwner()/deliveryAccess above, so a group/room chat never reaches this block.
      const provedReads = outcomes.flatMap(outcome => {
        const root = outcome.authorizationJson as Record<string, unknown> | null;
        const saved = root?.['readMemory'] as Record<string, unknown> | undefined;
        if (!outcome.deliveredAt || !saved || saved['userId'] !== userId || saved['companyId'] !== companyId
          || saved['membershipId'] !== current.membershipId
          || saved['fingerprint'] !== current.fingerprint || saved['chatKeyHash'] !== chatKeyHash
          || saved['recipientHash'] !== lineDeliveryRecipientHash(event.lineUserId, event.pushTargetId ?? event.lineUserId, event.messagingChannelId ?? '')
          || !Array.isArray(saved['entries']) || saved['entries'].length === 0 || saved['entries'].length > LINE_READ_EVIDENCE_MAX) return [];
        const entries = validLineAiReadMemoryEntries(saved['entries']);
        if (!entries) return [];
        const deliveredAt = outcome.deliveredAt instanceof Date ? outcome.deliveredAt : new Date(String(outcome.deliveredAt));
        if (!Number.isFinite(deliveredAt.getTime())) return [];
        return [{ at: deliveredAt, entries }];
      });
      const flattenedReads = provedReads.sort((a, b) => b.at.getTime() - a.at.getTime()).flatMap(item => item.entries).slice(0, 3);
      if (flattenedReads.length) recentReads = flattenedReads;
    }
    if (quotedRecords.length) recentReads = quoteReadMemory(quotedRecords);
    if (noticeItems.length) recentReads = [...(recentReads ?? []), { tool: 'reimbursement.list_pending_approvals', answerShape: 'list' as const, asOf: new Date().toISOString(), shownItems: noticeItems }].slice(0, 3);
    return {
      windowMinutes: LINE_AI_CONTEXT_WINDOW_MINUTES,
      maxTurns: LINE_AI_CONTEXT_MAX_TURNS,
      lastTurnAt: recentTurns.at(-1)?.at,
      ...(recentReads ? { recentReads } : {}),
      ...(quotedRecords.length ? { quotedRecords } : {}),
      ...(captures.length ? { recentCapturedExpenses: captures.map(item => ({ id: item.id })) } : {}),
      recentTurns,
      ...(deliveredExpenseSummary ? { deliveredExpenseSummary } : {}),
    };
  }

  /** `captionText` is the joined text of bubbles buffered together with this
   *  media message (spec §8); it feeds the intake route as the user's words. */
  async executeReceiptUpload(event: LineReceiptUploadEvent, captionText?: string): Promise<LineMediaTurnOutcome> {
    if (captionText?.trim()) event.language = lineReplyLanguage(captionText, event.language);
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
        const summary = await this.savedReceiptReply(event, saved.companyId, saved.expenseId);
        const delivered = await this.deliverRequiredMessages(event, await Promise.all(summary.texts.map(async (text) => await this.receiptReviewCard(event, text, summary.draft, saved!.companyId)
          ?? this.boundReplyCard(event, text) ?? buildLineAssistantTextCardMessage(text, this.config.webBaseUrl, saved!.companyId, undefined, undefined, replyLanguage(event)))))
          .then(() => true, (error: unknown) => {
            this.logger.warn({ msg: 'line_receipt_saved_reply_failed', webhookEventId: event.webhookEventId, expenseId: saved!.expenseId, ...safeLineErrorDetails(error) });
            return false;
          });
        // A draft the customer never heard about is not a delivered turn (UAT 2026-09-29). A parked
        // v2 plan keeps its own `delivery_pending` row for the recovery sweep; this never overwrites it.
        await this.updateEventLog(event.webhookEventId, delivered ? 'completed' : 'delivery_failed',
          delivered ? undefined : 'LINE_RECEIPT_RESULT_UNDELIVERED', saved.companyId);
        return { outcome: 'done' };
      }
      // Branch ambiguity is a data-setup state, not a transient fault: say what to do instead of
      // the "ชั่วคราว ลองใหม่" copy that retries into the identical failure (Owner 2026-08-27).
      const deterministic = lineCaptureFailureReply(err, BRANCH_RETRY_RESEND, replyLanguage(event));
      if (deterministic) {
        this.logger.warn({ msg: 'LINE receipt upload needs branch selection', webhookEventId: event.webhookEventId });
        await this.deliverReply(event, deterministic.reply, undefined, undefined, 'notTaken').catch(() => {});
        await this.updateEventLog(event.webhookEventId, deterministic.status, deterministic.errorCode);
        return { outcome: 'done' };
      }
      this.logger.error({ msg: 'LINE receipt upload error', webhookEventId: event.webhookEventId, ...safeLineErrorDetails(err) });
      // What was kept is not known here (see the reply's own note), so the card does not say "not taken".
      await this.deliverReply(event, mediaProcessingFailedReply(event.messageType, replyLanguage(event))).catch(() => {});
      await this.releaseWebhookEvent(event.webhookEventId, 'RETRYABLE_RECEIPT_UPLOAD_ERROR');
      return { outcome: 'done' };
    } finally {
      if (admissionAttempt.receiptRequested && !admissionAttempt.usablePersisted && admissionAttempt.identity && admissionAttempt.companyId) {
        await releaseCompanyOcrAdmission(this.prisma, {
          companyId: admissionAttempt.companyId, sourceRoute: 'receipt-ocr-line', requestId: event.lineMessageId,
          eventId: admissionAttempt.identity.eventId, reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT',
        });
      } else if (admissionAttempt.identity && admissionAttempt.companyId) {
        // Add-on plan PR B: every other admitted image is settled — used, or not charged when the read found no receipt (D4/Q4).
        await settleCompanyOcrAdmission(this.prisma, { companyId: admissionAttempt.companyId, sourceRoute: 'receipt-ocr-line',
          requestId: event.lineMessageId, eventId: admissionAttempt.identity.eventId, noReceipt: admissionAttempt.noReceipt === true });
      }
    }
  }

  private async executeReceiptUploadInner(event: LineReceiptUploadEvent, captionText: string | undefined, admissionAttempt: LineReceiptAdmissionAttempt): Promise<LineMediaTurnOutcome | undefined> {
    const requestId = randomUUID();
    if (!await this.claimWebhookEvent(event.webhookEventId, event.lineUserId)) return { outcome: 'done' };

    // Stamped before anything can refuse the photo as a receipt: whether it is a valid receipt and
    // whether a person is waiting for it are different questions. v4 gates AI immediately after
    // this write, so a paused turn reaches the operator but never reaches OCR/model/expense work.
    //
    // A MARKER only, and a marker is not a follow-up: it moves no clock, reopens nothing and
    // re-arms no mute (N1). See `stampSupportMedia`.
    const supportMediaRecorded = await this.stampSupportMedia(event);

    // v4: the human handoff owns this turn. Keep/store the media above, then stop before identity,
    // intake, OCR, model or expense-draft work. The reply is deterministic support state, not AI.
    if (event.assistantPaused || await this.assistantPaused(event.lineUserId)) {
      await this.deliverReply(event,
        supportMediaRecorded ? SUPPORT_MEDIA_RECEIVED_REPLIES[event.messageType] : SUPPORT_PAUSED_REPLY[replyLanguage(event)]);
      await this.updateEventLog(event.webhookEventId, 'support_paused');
      return { outcome: captionText?.trim() ? 'defer_text' : 'done' };
    }

    const identity = await this.resolveLineIdentity(event);
    if (!identity || identity.user.status !== 'ACTIVE') {
      await this.deliverRequiredMessages(event, await this.entryDoorMessages(event.lineUserId));
      await this.updateEventLog(event.webhookEventId, 'unlinked', LINE_AI_ERROR_CODES.UNLINKED_USER);
      return;
    }

    // PDPA opt-out gate (M-05 §3.1) — media intake is part of the LINE assistant, so the
    // same refusal applies; web receipt upload (P2, legal-obligation basis) is unaffected.
    if (identity.user.aiAssistantOptOutAt) {
      await this.deliverReply(event, AI_OPT_OUT_REPLY[replyLanguage(event)]);
      await this.updateEventLog(event.webhookEventId, 'ai_opt_out', LINE_AI_ERROR_CODES.FORBIDDEN);
      return;
    }

    const resolved = event.companyIdAtAcceptance
      ? { companyId: event.companyIdAtAcceptance }
      : await resolveCompanyForLineUser(this.prisma, identity.userId, event.lineUserId);
    if (!resolved || 'needsSelection' in resolved) {
      if (!resolved) {
        // A photo sent to a locked shop is still a message from someone inside it, and this branch
        // is the same "no company resolved" dead end the text turn hits. `locked` lets the buffer
        // close the rest of the photo batch on this one card instead of one card per photo.
        if (await this.replyIfCompanyLocked(event, identity.userId)) return { outcome: 'locked' };
        await this.deliverReply(event, RECEIPT_LINK_REPLY[replyLanguage(event)]);
      } else {
        const memberships = await this.listLineCompanies(identity.userId);
        await this.deliverRequiredMessages(event, [buildCompanyPickerMessage(memberships.map(membership => companyPickerItem(membership, replyLanguage(event))), undefined, undefined, replyLanguage(event))]);
      }
      await this.updateEventLog(event.webhookEventId, !resolved ? 'unlinked' : 'needs_company_selection', LINE_AI_ERROR_CODES.UNLINKED_USER);
      return;
    }
    const companyId = resolved.companyId;

    let access: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>;
    try {
      access = await this.permissionResolver.resolveAccess(identity.userId, companyId);
    } catch {
      await this.deliverReply(event, RECEIPT_LINK_REPLY[replyLanguage(event)]);
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
    this.deliveryAccess.set(event, { userId: identity.userId, companyId, membershipId: access.membershipId,
      fingerprint: resolvedLineDeliveryAccessFingerprint(identity.userId, companyId, access, entitledFeatureKeys) });
    await this.bindConversation(event);
    if (lineAssistantDisabledFor(entitledFeatureKeys)) {
      await this.deliverReply(event, formatRefusal('feature_disabled', undefined, replyLanguage(event)), undefined, undefined, 'notTaken');
      await this.audit.log({ companyId, actorUserId: identity.userId, action: 'ai.line.query.denied', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'LOW', metadataJson: { reason: 'feature_disabled' } });
      await this.updateEventLog(event.webhookEventId, 'feature_disabled', LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE, companyId);
      return;
    }

    const canCaptureExpense = access.permissions.includes('expense.receipt.line_upload') || access.permissions.includes('expense.receipt.upload');
    const canSubmitSignature = maySubmitSignature(access.permissions);
    const canReadDocument = !!this.boundConversations.get(event) && this.config.lineAiDocumentQaEnabled
      && access.permissions.includes('line.ai.query') && access.permissions.includes('attachment.create');
    const canStageReimbursement = !!this.boundConversations.get(event) && this.config.lineAiReimbursementDraftWriteEnabled
      && access.permissions.includes('line.ai.query') && access.permissions.includes('attachment.create')
      && access.permissions.some(permission => ['reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.finance_review'].includes(permission));
    const canCaptureClaimPayment = !!this.boundConversations.get(event) && access.permissions.includes('reimbursement.payment.record');
    if (!canCaptureExpense && !canSubmitSignature && !canReadDocument && !canStageReimbursement && !canCaptureClaimPayment) {
      await this.deliverReply(event, receiptDeniedReply(access, replyLanguage(event)), undefined, undefined, 'notTaken');
      await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.reject', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'MEDIUM', metadataJson: { reason: 'missing_expense_receipt_line_upload' } });
      await this.updateEventLog(event.webhookEventId,
        receiptFeatureDisabled(access) ? 'feature_disabled' : 'forbidden',
        receiptFeatureDisabled(access) ? LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE : LINE_AI_ERROR_CODES.FORBIDDEN,
        companyId);
      return;
    }
    if ((!this.initReceiptUpload || !this.completeReceiptUpload) && !canReadDocument && !canStageReimbursement && !canCaptureClaimPayment) {
      await this.deliverReply(event, ERROR_REPLY[replyLanguage(event)], undefined, undefined, 'notTaken');
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
      ...(access.freeExpenseDrafts ? { freeExpenseDrafts: true } : {}),
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

    if (access.freeExpenseDrafts) {
      const allowance = await freeExpenseAllowanceSnapshot(this.prisma, companyId);
      if (allowance.remainingCount === 0) {
        await this.deliverReply(event, allowance.usedCount >= allowance.limit
          ? `${freeExpenseQuotaNoticeTextTh(allowance.resetAt)}\nยังไม่ได้อ่านหรือสร้างร่างจากเอกสารนี้ค่ะ`
          : FREE_EXPENSE_IN_FLIGHT_TEXT_TH);
        await this.updateEventLog(event.webhookEventId, 'free_document_limit', undefined, companyId);
        return;
      }
    }

    // สัญญา v3: a live support case has already fetched these bytes for its thread (`storeSupportMedia`).
    const downloaded = (event as SupportMediaDownloadCarrier)[SUPPORT_MEDIA_DOWNLOAD]
      ?? await this.timeStage(event.webhookEventId, 'receipt_download', () => this.downloadLineMedia(event.lineMessageId, event.messageType, event.fileName, event.fileSize));
    if (!downloaded.ok) {
      // §17.5: the reason is recorded BEFORE the payload scrub, so "ไฟล์เมื่อกี้ทำไมส่งไม่ได้" is
      // answerable after a restart from a row that never held the payload in the first place.
      await this.recordIntakeAttempt(event, {
        companyId, stage: 'DOWNLOAD', reasonCode: downloaded.reason, outcome: 'REJECTED',
        ...(downloaded.declaredFileSize !== undefined ? { declaredFileSize: downloaded.declaredFileSize } : {}),
        ...(downloaded.measuredByteSize !== undefined ? { measuredByteSize: downloaded.measuredByteSize } : {}),
      });
      await this.deliverReply(event, mediaDownloadFailedReply(event.messageType, replyLanguage(event)), undefined, undefined, 'notTaken');
      await this.releaseWebhookEvent(event.webhookEventId, 'RETRYABLE_LINE_MEDIA_DOWNLOAD_FAILED', companyId);
      return;
    }
    const media = downloaded.media;
    const mediaRejectionReason = await this.lineMediaRejectionReason(media, 'RECEIPT');
    if (mediaRejectionReason) {
      const riskLevel = ['CONTENT_REJECTED', 'MALWARE_DETECTED'].includes(mediaRejectionReason) ? 'HIGH' : 'MEDIUM';
      const inspectionReply = fileInspectionRefusalReply(mediaRejectionReason, replyLanguage(event));
      await this.recordIntakeAttempt(event, {
        companyId, stage: 'SECURITY', reasonCode: mediaRejectionReason, outcome: 'REJECTED',
        measuredByteSize: media.byteSize, fileName: media.fileName,
      });
      await this.deliverReply(event, inspectionReply ?? (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.MEDIA_SECURITY_REJECTED_REPLY : MEDIA_SECURITY_REJECTED_REPLY),
        inspectionReply && ctx.permissions.includes('expense.create') ? { items: [{ type: 'action', action: { type: 'uri',
          label: replyLanguage(event) === 'en' ? 'Enter expense' : 'กรอกรายจ่ายเอง',
          uri: absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/manual`) } }] } : undefined, undefined, 'notTaken');
      await this.audit.log({
        companyId,
        actorUserId: identity.userId,
        action: 'attachment.upload.rejected',
        targetType: 'LineWebhookEvent',
        targetId: event.webhookEventId,
        requestId,
        result: 'DENIED',
        riskLevel,
        metadataJson: {
          source: 'LINE_AI',
          reason: mediaRejectionReason,
          mimeType: media.mimeType,
          byteSize: media.byteSize,
        },
      });
      if (riskLevel === 'HIGH') emitSecurityEvent(this.logger, SECURITY_EVENT.attachmentUploadRejected, 'HIGH', {
        companyId,
        source: 'LINE_AI',
        reason: mediaRejectionReason,
        requestId,
      });
      await this.updateEventLog(event.webhookEventId, 'media_security_rejected', 'LINE_MEDIA_SECURITY_REJECTED', companyId);
      return;
    }



    const caption = captionText?.trim() ?? '';
    const captionSuffix = caption ? ` ${caption}` : '';

    const claimOwner = ctx.freeExpenseDrafts ? undefined : this.boundConversations.get(event);
    const payoutPending = claimOwner && await this.expenseActions?.awaitingClaimSlip?.(ctx, chatKeyHashOf(event));
    const claimPhoto = claimOwner && !payoutPending && await this.reimbursementAdapter?.photoTarget?.({ ctx, owner: claimOwner.owner, ownerEpoch: claimOwner.epoch });
    if (claimOwner && (payoutPending || claimPhoto)) {
      const textEvent: LineTextEvent = { ...event, messageText: caption || (payoutPending ? 'ส่งสลิปโอนสำหรับใบเบิกนี้' : 'แนบใบเสร็จกับใบเบิกที่เลือกไว้') };
      this.boundConversations.set(textEvent, claimOwner);
      this.deliveryAccess.set(textEvent, this.deliveryAccess.get(event)!);
      const route = await this.tryRouteIntake({ event: textEvent, requestId, webhookEventId: event.webhookEventId, companyId, userId: ctx.userId,
        permissions: access.permissions, entitledFeatureKeys, messageText: textEvent.messageText,
        attachment: { id: event.lineMessageId, mimeType: media.mimeType, ...(media.contentBase64 ? { contentBase64: media.contentBase64 } : {}) } });
      if (route.status !== 'ROUTED' || !this.budgetGrantsV2.has(textEvent)) {
        await this.deliverReply(event, (replyLanguage(event) === 'en' ? "The evidence could not be attached; please resend the photo." : 'ยังแนบหลักฐานไม่สำเร็จค่ะ กรุณาลองส่งรูปอีกครั้ง')); return;
      }
      if (payoutPending) {
        const slip = await this.expenseActions.captureClaimSlip(ctx, chatKeyHashOf(event), media, intent => this.uploadLineMedia(intent, media), replyLanguage(event));
        if (slip?.preview) this.deliveryExpenseActions.set(event, { context: ctx, chat: chatKeyHashOf(event), requestId, preview: slip.preview });
        await this.deliverRequiredMessages(event, [slip?.preview ? buildExpenseActionCard(slip.preview, undefined, replyLanguage(event), this.config?.webBaseUrl) : slip?.webPath
          ? buildLineSystemTextCardMessage({ ...({ text: `${slip.reply}\n${absoluteWebLink(this.config.webBaseUrl, slip.webPath)}`,
            webBaseUrl: this.config.webBaseUrl, companyId, header: { lines: [(replyLanguage(event) === 'en' ? "Record reimbursement" : 'บันทึกจ่ายคืน'), (replyLanguage(event) === 'en' ? "Review on web" : 'ตรวจข้อมูลในเว็บ')] }, linkLabel: (replyLanguage(event) === 'en' ? "View claim" : 'เปิดใบเบิก') }), language: replyLanguage(event) })
            ?? { type: 'text', text: slip.reply }
          : { type: 'text', text: slip?.reply ?? (replyLanguage(event) === 'en' ? "The payment slip could not be attached; please try again." : 'ยังแนบสลิปไม่สำเร็จค่ะ กรุณาลองใหม่') }]);
      } else if (claimPhoto) {
        const pending = await this.prisma.client.lineIntakePendingMedia.findUnique({ where: { companyId_lineMessageId: { companyId, lineMessageId: event.lineMessageId } } });
        const attachmentId = await this.stageReimbursementMedia(event, ctx, textEvent.messageText, media, claimOwner, pending, claimPhoto.branchId);
        const result = await this.reimbursementAdapter.attachPhoto({ ctx, owner: claimOwner.owner, ownerEpoch: claimOwner.epoch, attachmentId });
        if (result) await this.deliverReimbursementCollection(event, ctx, result);
        else await this.deliverReply(event, (replyLanguage(event) === 'en' ? "The claim changed; open its latest draft before attaching the photo again." : 'รายการใบเบิกเปลี่ยนแล้วค่ะ เปิดร่างล่าสุดก่อนแนบรูปอีกครั้ง'));
      }
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    if (!access.freeExpenseDrafts && this.substituteReceiptContinuation && canCaptureExpense && access.permissions.includes('expense.receipt.upload')
      && event.messageType === 'image' && !isSignatureCaptionText(caption)) {
      const context = await this.substituteReceiptContinuation.loadOpenMediaContext(ctx, chatKeyHashOf(event), replyLanguage(event));
      if (context?.paymentEvidenceRequestedAt && substituteAwaitsCaptionlessPhoto(context)
        && (!caption || /สลิป|หลักฐาน|โอน/u.test(caption))) {
        const outcome = await this.handleSubstituteMediaArrival({ event, ctx, access, companyId, userId: identity.userId,
          requestId, caption: caption || 'สลิป', captionSuffix, media, context });
        if (outcome) return outcome;
      }
    }

    const evidenceTarget = !access.freeExpenseDrafts && event.messageType === 'image' ? await this.expenseActions?.evidencePhotoTarget?.(ctx, chatKeyHashOf(event), replyLanguage(event)) : null;
    if (evidenceTarget && 'reply' in evidenceTarget) {
      await this.deliverReply(event, evidenceTarget.reply!, { items: [{ type: 'action', action: { type: 'message', label: (replyLanguage(event) === 'en' ? "View latest record" : 'ดูรายการล่าสุด'), text: (replyLanguage(event) === 'en' ? "Show this record’s current status" : 'ดูรายการนี้ล่าสุด') } }] });
      return;
    }
    if (evidenceTarget && this.createUploadIntent && this.completeReceiptUpload) {
      const intent = await this.createUploadIntent.execute(ctx, { originalFileName: media.fileName, mimeType: media.mimeType,
        byteSize: media.byteSize, ...(evidenceTarget.branchId ? { branchId: evidenceTarget.branchId } : {}) });
      await this.uploadLineMedia(intent, media);
      await this.completeReceiptUpload.execute(ctx, { expenseId: evidenceTarget.expenseId, attachmentId: intent.attachmentId,
        checksumSha256: media.checksumSha256, byteSize: media.byteSize, intent: 'replace', expectedUpdatedAt: evidenceTarget.revision,
        ...(evidenceTarget.primaryAttachmentId ? { expectedPrimaryAttachmentId: evidenceTarget.primaryAttachmentId } : {}), operationId: event.lineMessageId });
      (event as typeof event & { [SAVED_LINE_RECEIPT]?: SavedLineReceipt })[SAVED_LINE_RECEIPT] = { expenseId: evidenceTarget.expenseId, companyId, uploaded: true };
      const result = await this.expenseActions.afterEvidencePhoto(ctx, chatKeyHashOf(event), evidenceTarget.expenseId, replyLanguage(event));
      if (result.preview) this.deliveryExpenseActions.set(event, { context: ctx, chat: chatKeyHashOf(event), requestId, preview: result.preview });
      const choices = await this.expenseActions.repairChoices(ctx, chatKeyHashOf(event), undefined, replyLanguage(event));
      await this.deliverReply(event, result.reply, choices?.length ? lineChoiceQuickReply(choices) : undefined,
        result.preview ? buildExpenseActionCard(result.preview, undefined, replyLanguage(event), this.config?.webBaseUrl) : undefined);
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    const qaRoute = access.freeExpenseDrafts ? null : await this.routeDocumentQuestionBeforeCapture(event, ctx, access, captionText ?? '', media, entitledFeatureKeys,
      (identity) => { admissionAttempt.identity = identity; admissionAttempt.companyId = companyId; });
    if (qaRoute?.handled) return;
    if (!this.initReceiptUpload || !this.completeReceiptUpload) {
      await this.deliverReply(event, ERROR_REPLY[replyLanguage(event)], undefined, undefined, 'notTaken');
      await this.updateEventLog(event.webhookEventId, 'expense_module_unavailable', 'EXPENSE_MODULE_UNAVAILABLE', companyId); return;
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
      const total = (replyLanguage(event) === 'en' ? `${moneyLabel(exact.grandTotalAmount)} THB` : `${moneyLabel(exact.grandTotalAmount)} บาท`);
      const keptReply = [
        (replyLanguage(event) === 'en' ? "This photo matches an existing bill." : '📷 รูปนี้ตรงกับบิลที่เก็บไว้แล้วค่ะ'),
        ...(exact.vendorNameSnapshot ? [(replyLanguage(event) === 'en' ? `Seller: ${exact.vendorNameSnapshot}` : `ผู้ขาย – ${exact.vendorNameSnapshot}`)] : []),
        (replyLanguage(event) === 'en' ? `Total: ${total}` : `ยอดรวม – ${total}`),
        (replyLanguage(event) === 'en' ? `Status: ${receiptProgressLabel(exact.status, exact.aiVerificationStatus, replyLanguage(event))}` : `สถานะ – ${receiptProgressLabel(exact.status, exact.aiVerificationStatus, replyLanguage(event))}`),
        (replyLanguage(event) === 'en' ? `View existing receipt: ${absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${exact.id}`)}` : `เปิดใบเสร็จเดิม: ${absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${exact.id}`)}`),
      ].join('\n');
      // The same reply as a row card of the locked design, from the same facts. A bill not read yet
      // holds no amount (the record's 0), so its card has no total row; the sentence is as it was.
      await this.deliverCompletedReply(event, keptReply, companyId, access, undefined, buildKeptReceiptCard(keptReply, {
        expenseId: exact.id, vendor: exact.vendorNameSnapshot, ...(Number(toMoney4(exact.grandTotalAmount)) !== 0 ? { total } : {}),
        progress: receiptProgress(exact.status, exact.aiVerificationStatus, replyLanguage(event)),
      }, this.config.webBaseUrl, companyId));
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
    if (!this.boundConversations.has(event) && event.messageType === 'file' && canCaptureExpense && this.captureLine && this.initReceiptUpload) {
      const substituteOpen = this.substituteReceiptContinuation && access.permissions.includes('expense.receipt.upload')
        ? await this.substituteReceiptContinuation.loadOpenMediaContext(ctx, chatKeyHashOf(event), replyLanguage(event)).catch(() => null)
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
      ? await this.loadConversationContext(companyId, identity.userId, event)
      : undefined;

    const expenseDraftConversationEnabled = !access.freeExpenseDrafts && this.config.lineExpenseDraftConversationEnabled === true
      && (!event.pushTargetId || event.pushTargetId === event.lineUserId)
      && Boolean(this.expenseDraftConversation);
    const captionCandidates = computeValueCandidates(normalizeLineText(caption));
    // UAT 2026-09-29 (owner: "ของเดิมถ่ายรูป หรือ ส่งรูป ก็อ่านได้และสร้างให้ทันที"): a PHOTO is read exactly
    // as production a2b926c6 reads it — the router sees the picture, then OCR, the deterministic expense
    // gate and the draft — in a bound (v2) conversation too. Only a `file` (PDF/document) keeps v2.4's
    // no-implicit-capture lane (063b7f2a): no caption, no capture authority, ask what the file is for.
    const v2DocumentFile = this.boundConversations.has(event) && event.messageType === 'file';
    const routerReason = access.freeExpenseDrafts ? null : qaRoute?.route ? 'caption' : await lineIntakeRouterReason({
      messageType: event.messageType, caption, canCaptureExpense,
      // Read only for a sender the substitute branch below acts for (§14 keeps `expense.receipt.upload`
      // its gate). A lookup that fails keeps the router: the reader-only lane is the one that must be safe.
      substituteWorkOpen: async () => {
        if (!this.substituteReceiptContinuation || !access.permissions.includes('expense.receipt.upload')) return false;
        try {
          // Asked only for a caption-less photo: open work claims it only right after asking for exactly it.
          const open = await this.substituteReceiptContinuation.loadOpenMediaContext(ctx, chatKeyHashOf(event), replyLanguage(event));
          return !!open && substituteAwaitsCaptionlessPhoto(open);
        } catch {
          return true;
        }
      },
    });
    if (routerReason === null) this.logger.log({ msg: 'line.intake.router_skipped', webhookEventId: event.webhookEventId });
    const routePlan: GovernedLineIntakeRoutePlan = access.freeExpenseDrafts
      ? { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 1 }
      : v2DocumentFile && !caption
      ? { status: 'ROUTED', intent: 'CLARIFY', language: 'th', confidence: 0 }
      // The reader decides alone: the ROUTED capture plan sends the photo down the same gates a router's
      // EXPENSE_DOCUMENT_CAPTURE takes — the reader's own classification, `decideLineBusinessDocument`.
      : routerReason === null ? { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0 }
      : qaRoute?.route ?? await this.tryRouteIntake({
      requestId,
      webhookEventId: event.webhookEventId,
      retryWebhookEventId: event.webhookEventId,
      ...(event.admitOverCap ? { admitOverCap: true } : {}),
      onAdmitted: (identity) => { admissionAttempt.identity = identity; admissionAttempt.companyId = companyId; },
      companyId,
      userId: identity.userId,
      permissions: access.permissions,
      enabledFeatures: entitledFeatureKeys ? [...entitledFeatureKeys] : null,
      entitledFeatureKeys,
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

    // F8: a signature photo filed on ANY route should steer the sender back to the prepare button exactly when a
    // substitute workflow in this chat is parked at the issue decision — not only on the numbered
    // route. Computed lazily at each signature site so non-signature uploads pay for no extra query.
    const pendingIssueDecisionSteer = () => this.substituteReceiptContinuation
      ? this.substituteReceiptContinuation.hasPendingIssueDecision(ctx, chatKeyHashOf(event))
      : Promise.resolve(false);

    if (routePlan.status === 'ROUTED' && routePlan.intent === 'SIGNATURE_UPLOAD_TICKET') {
      if (!canSubmitSignature) {
        await this.deliverReply(event, SIGNATURE_FORBIDDEN_REPLY[replyLanguage(event)], undefined, undefined, 'notTaken');
        await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.reject', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'MEDIUM', metadataJson: { reason: 'missing_signature_owner_permission', route: 'signature' } });
        await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
        return;
      }
      if (event.messageType !== 'image' || !this.initSignatureUpload || !this.createSignatureAsset) {
        await this.deliverReply(event, SIGNATURE_NEED_IMAGE_REPLY[replyLanguage(event)], undefined, undefined, 'question');
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      const ticketReply = await this.createLineSignatureAsset({ ctx, event, sourceEvent: event, companyId, media, steerToPendingDecision: await pendingIssueDecisionSteer() });
      await this.deliverCompletedReply(event, ticketReply, companyId, access, undefined, undefined, 'stored');
      await this.persistIntakeTurn({ event,
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
    if (!this.boundConversations.has(event) && routePlan.status !== 'ROUTED'
      && canSubmitSignature && event.messageType === 'image' && isSignatureCaptionText(caption)
      && this.initSignatureUpload && this.createSignatureAsset) {
      const ticketReply = await this.createLineSignatureAsset({ ctx, event, sourceEvent: event, companyId, media, steerToPendingDecision: await pendingIssueDecisionSteer() });
      await this.deliverCompletedReply(event, ticketReply, companyId, access, undefined, undefined, 'stored');
      await this.persistIntakeTurn({ event,
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: `[ผู้ใช้ส่งรูปลายเซ็น]${captionSuffix}`, replyText: ticketReply, intent: 'SIGNATURE_REQUEST',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
      return;
    }

    // A v2 FILE is not financial authority: an empty/ambiguous/read-only caption keeps its bytes pending,
    // even when the sender has expense permission. A photo takes production's gates below instead — only
    // an EXPENSE_DOCUMENT_CAPTURE route whose OCR passes the deterministic expense gate becomes a draft.
    const v2CaptureAuthorized = !!caption && routePlan.status === 'ROUTED'
      && routePlan.intent === 'EXPENSE_DOCUMENT_CAPTURE'
      && routePlan.semanticSubrequests?.some(item => item.kind === 'write' && item.writeIntent === 'EXPENSE_DOCUMENT_CAPTURE');
    const v2NeedsCaptureClarification = v2DocumentFile && !v2CaptureAuthorized
      && routePlan.intent !== 'MUTATION_REQUEST_REFUSAL';
    if (v2NeedsCaptureClarification || (routePlan.status === 'ROUTED' && routePlan.intent === 'CLARIFY')) {
      const clarifyReply = routePlan.clarifyQuestion ?? (v2NeedsCaptureClarification
        ? (replyLanguage(event) === 'en' ? "Read this file to answer a question, or use it as expense evidence? No expense has been created yet." : 'ต้องการให้อ่านไฟล์นี้เพื่อตอบคำถาม หรือใช้เป็นหลักฐานบันทึกค่าใช้จ่ายคะ ยังไม่ได้สร้างรายการให้ค่ะ')
        : CLARIFY_REPLY[replyLanguage(event)]);
      // A4: this branch asked a question about a photo and then threw the photo away. Whatever the
      // customer answered — “ใบเสร็จ”, “ลายเซ็น”, “หลักฐานการจ่าย” — there were no bytes left to act
      // on. Park them on the same pending row every other clarify uses; the reply is unchanged, and
      // a failure to park must not swallow the question the customer is waiting for.
      let parked: Awaited<ReturnType<ProcessLineWebhookUseCase['ensurePendingMedia']>> | undefined;
      if (canCaptureExpense || canReadDocument || canStageReimbursement) {
        try {
          parked = await this.ensurePendingMedia(
            ctx, event, companyId, identity.userId, caption, media, receiptClarifyQuestion(event),
          );
        } catch (error) {
          this.logger.warn({ msg: 'line_clarify_pending_media_failed', requestId, ...safeLineErrorDetails(error) });
        }
      }
      await this.deliverReply(event, clarifyReply, v2NeedsCaptureClarification ? { items: [
        { type: 'action', action: { type: 'message', label: (replyLanguage(event) === 'en' ? "Record expense" : 'บันทึกเป็นค่าใช้จ่าย'), text: (replyLanguage(event) === 'en' ? "Use this as expense evidence" : 'ใช้เป็นหลักฐานบันทึกค่าใช้จ่าย') } },
        { type: 'action', action: { type: 'message', label: (replyLanguage(event) === 'en' ? "Ask about file" : 'ถามจากไฟล์'), text: (replyLanguage(event) === 'en' ? "Ask about file" : 'ถามจากไฟล์') } },
      ] } : undefined, undefined, 'question');
      await this.persistIntakeTurn({ event,
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
      await this.deliverCompletedReply(event, (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.MUTATION_REFUSAL_REPLY : MUTATION_REFUSAL_REPLY), companyId, access, undefined, undefined, 'notTaken');
      await this.persistIntakeTurn({ event,
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: `[ผู้ใช้ส่งรูป/ไฟล์]${captionSuffix}`, replyText: (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.MUTATION_REFUSAL_REPLY : MUTATION_REFUSAL_REPLY), intent: 'MUTATION_REQUEST', refused: true,
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
          ctx, event, companyId, identity.userId, caption, media,
          receiptClarifyQuestion(event),
        );
        if (created) {
          await this.deliverReply(event, MEDIA_CLARIFY_REPLY[replyLanguage(event)], undefined, undefined, 'question');
          await this.persistIntakeTurn({ event,
            userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
            userMessagePreview: `${mediaPreviewLabel(pending)}${captionSuffix}`, replyText: MEDIA_CLARIFY_REPLY[replyLanguage(event)], intent: 'CLARIFY',
          });
          if (pending) {
            await this.appendMediaClarification(event, {
              companyId, chatKey: mediaChatKey(event), requestId, webhookEventId: event.webhookEventId,
              userId: identity.userId, caption, question: MEDIA_CLARIFY_REPLY[replyLanguage(event)], pending,
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
      await this.deliverCompletedReply(event, (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.MEDIA_UNSUPPORTED_REPLY : MEDIA_UNSUPPORTED_REPLY), companyId, access, undefined, undefined, 'notTaken');
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
    if (!access.freeExpenseDrafts && this.substituteReceiptContinuation && canCaptureExpense
      && access.permissions.includes('expense.receipt.upload')
      && (routePlan.status !== 'ROUTED' || routePlan.intent === 'EXPENSE_DOCUMENT_CAPTURE')) {
      try {
        const context = await this.substituteReceiptContinuation.loadOpenMediaContext(ctx, chatKeyHashOf(event), replyLanguage(event));
        // UAT round 10: a caption-less photo is a new expense unless this chat was just asked for exactly that
        // picture. A caption keeps its own signals and a file keeps its lane, as before.
        const claims = context && (event.messageType !== 'image' || caption || substituteAwaitsCaptionlessPhoto(context));
        const outcome = context && claims
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

    // The legacy PDF fast path above stays unchanged; v2 reaches capture only after typed
    // expense authority and the existing substitute continuation have both been checked.
    if (this.boundConversations.has(event) && v2CaptureAuthorized && event.messageType === 'file'
      && canCaptureExpense && this.captureLine && this.initReceiptUpload) {
      return await this.captureLineFile({ event, ctx, access, companyId, userId: identity.userId, media, caption });
    }

    // Reference-only routes may receive bounded guidance without expense permission, but must
    // never read an existing expense. Every possible capture/fallback branch is denied here.
    const isReferenceOnlyRoute = routePlan.status === 'ROUTED' && routePlan.intent === 'BUSINESS_DOCUMENT_REFERENCE';
    if (!canCaptureExpense && !isReferenceOnlyRoute) {
      await this.deliverReply(event, receiptDeniedReply(access, replyLanguage(event)), undefined, undefined, 'notTaken');
      await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.reject', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'MEDIUM', metadataJson: { reason: 'missing_expense_receipt_line_upload', route: 'capture' } });
      await this.updateEventLog(event.webhookEventId,
        receiptFeatureDisabled(access) ? 'feature_disabled' : 'forbidden',
        receiptFeatureDisabled(access) ? LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE : LINE_AI_ERROR_CODES.FORBIDDEN,
        companyId);
      return;
    }

    // JPEG/PNG classification runs once, before initReceiptUpload. PDF/unsupported media produces
    // NOT_REQUESTED and therefore fails closed unless a routed expense caption supplies purpose.
    admissionAttempt.receiptRequested = true;
    const readOcr = await this.tryExtractReceiptFields(
      ctx,
      event.lineMessageId,
      media,
      routePlan.ocrAdmission === 'admitted',
      routePlan.ocrErrorCode,
      // The router already read this exact photo; forwarding that read keeps OCR from reading it
      // a second time (UAT 2026-08-28: a 16.6s duplicate read on every receipt).
      routePlan.documentText,
      routePlan.onePassReceipt,
      admissionAttempt,
      event.webhookEventId,
      event.admitOverCap,
    );
    if (readOcr.errorCode === 'OCR_REQUEST_ALREADY_ADMITTED') {
      // A crashed provider attempt may still own its lease — refused at the router's admission or, for a
      // reader-only photo, at the reader's. Keep the same durable input pending; a transient waiting
      // message must not become an immutable terminal result or a new draft.
      await this.prisma.client.lineWebhookEventLog.updateMany({
        where: { webhookEventId: event.webhookEventId, status: 'received' },
        data: { errorCode: LINE_RECEIPT_RETRY_WAIT_CODE, companyId, processedAt: new Date() },
      });
      return;
    }
    const utilityReceipt = !access.freeExpenseDrafts && canCaptureExpense ? priorUtilityReceipt(readOcr) : null;
    const ocr: ReceiptOcrPreflight = utilityReceipt
      ? { ...readOcr, fields: utilityReceipt.fields, classification: utilityReceipt.classification }
      : readOcr;
    // An uncaptioned provider sheet may be routed as a reference because it contains two titled
    // sections. The verified prior receipt is still expense evidence for a user allowed to capture.
    const expenseRoutePlan = utilityReceipt && !caption && routePlan.status === 'ROUTED'
      && routePlan.intent === 'BUSINESS_DOCUMENT_REFERENCE'
      ? { ...routePlan, intent: 'EXPENSE_DOCUMENT_CAPTURE' as const }
      // A reader-only photo has no router to call a check bill a reference, which is the router's rule for
      // a bill; the reader's own classification does, so the bill still gets production's paid/unpaid question.
      : routerReason === null && ocr.classification?.contentKind === 'DOCUMENT'
        && ocr.classification.documentKind === 'ORDER_OR_CHECK_BILL'
        ? { ...routePlan, intent: 'BUSINESS_DOCUMENT_REFERENCE' as const }
        : routePlan;

    // P10-L §15.1 (review G-01): the shop's plan ran out of receipts. `admitCompanyOcr` is the one
    // place that decides this — for a LINE photo it decides at the intake router, whose refusal
    // `tryExtractReceiptFields` forwards here as the same code — so this branch only has to answer,
    // never to count. Answered before `decideLineBusinessDocument` because the generic OCR-governance
    // clarify ("what is this picture?") is the wrong reply to a shop that needs a bigger package.
    if (ocr.errorCode === 'FREE_DOCUMENT_LIMIT_REACHED' || ocr.errorCode === 'FREE_DOCUMENTS_IN_FLIGHT') {
      const allowance = await freeExpenseAllowanceSnapshot(this.prisma, companyId);
      await this.deliverReply(event, ocr.errorCode === 'FREE_DOCUMENTS_IN_FLIGHT'
        ? FREE_EXPENSE_IN_FLIGHT_TEXT_TH
        : `${freeExpenseQuotaNoticeTextTh(allowance.resetAt)}\nยังไม่ได้อ่านหรือสร้างร่างจากเอกสารนี้ค่ะ`);
      await this.updateEventLog(event.webhookEventId, 'free_document_limit', ocr.errorCode, companyId);
      return;
    }
    if (access.freeExpenseDrafts && (ocr.classification?.contentKind === 'MULTI_DOCUMENT'
      || ocr.status !== 'OCR_EXTRACTED_NEEDS_REVIEW'
      || !isExpenseExtractionEligible(ocr.classification ?? undefined, ocr.fields?.grandTotalAmount))) {
      await this.deliverReply(event, ocr.classification?.contentKind === 'MULTI_DOCUMENT'
        ? `${FREE_EXPENSE_MULTI_DOCUMENT_TEXT_TH}\nยังไม่ได้สร้างร่างจากไฟล์นี้ค่ะ`
        : ocr.errorCode === 'OCR_FEATURE_DISABLED'
          ? 'ร้านปิดการอ่านเอกสารด้วย AI ไว้ค่ะ ยังไม่ได้อ่านหรือสร้างร่างจากไฟล์นี้'
          : isAiBudgetRefusalCode(ocr.errorCode)
            ? `${aiBudgetReasonTh(ocr.errorCode)} ยังไม่ได้อ่านหรือสร้างร่างจากไฟล์นี้ค่ะ`
            : 'ยังอ่านเอกสารนี้เป็นร่างรายจ่ายไม่ได้ค่ะ ยังไม่ได้สร้างร่างจากไฟล์นี้');
      await this.updateEventLog(event.webhookEventId, 'free_document_not_saved', ocr.errorCode, companyId);
      return;
    }

    if (ocr.errorCode === RECEIPT_QUOTA_ERROR_CODE) {
      const refusal = await this.deliverReceiptQuotaRefusal(event, companyId, identity.userId,
        access.permissions.includes(PLAN_MANAGE_PERMISSION_KEY));
      await this.persistIntakeTurn({ event,
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
      const reply = formatOcrGovernanceClarifyReply(ocr.errorCode, true, replyLanguage(event));
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
        const denied = formatBudgetMediaNotStoredReply(ocr.errorCode, 'no_permission', replyLanguage(event));
        await this.deliverReply(event, denied, undefined, undefined, 'notTaken');
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
        await this.deliverReply(event, formatBudgetMediaNotStoredReply(ocr.errorCode, 'save_failed', replyLanguage(event)), undefined, undefined, 'notTaken');
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
        ? formatBudgetMediaNotStoredReply(ocr.errorCode, 'open_question', replyLanguage(event))
        : null;
      if (parked.created || notStored) {
        const text = notStored ?? reply;
        await this.deliverReply(event, text, undefined, undefined, notStored ? 'notTaken' : 'unread');
        await this.persistIntakeTurn({ event,
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

    const decision = decideLineBusinessDocument(expenseRoutePlan, ocr, caption.length > 0);
    if (!access.freeExpenseDrafts && ocr.status === 'OCR_EXTRACTED_NEEDS_REVIEW' && isSuccessfulNonReceiptClassification(ocr.classification)) {
      admissionAttempt.receiptRequested = false;
      admissionAttempt.noReceipt = true;
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
        ...(ocr.fallbackReasons?.length ? { fallbackReasons: ocr.fallbackReasons } : {}),
        ...(ocr.processingPath ? { processingPath: ocr.processingPath } : {}),
        documentKind: decision.classification?.documentKind ?? null,
        recognizedFieldCount: ocr.fields ? Object.keys(ocr.fields).length : 0,
        mimeType: media.mimeType,
        byteSize: media.byteSize,
      },
    });
    if (decision.outcome === 'reference' || decision.outcome === 'unsupported') {
      // UAT 2026-09-29: a table bill printed "Total 1,712.54" and the reader copied the separator, so
      // Number() gave NaN and the customer got "send the final receipt" instead of this question.
      // Production asked it; a bill with a printed amount always asks it now, separator or not, and
      // even when the read kept the amount only as a signal.
      const checkBillTotal = Number(String(ocr.fields?.grandTotalAmount ?? '').replace(/,/g, ''));
      const checkBillAwaitingDecision = decision.outcome === 'reference'
        && decision.classification?.contentKind === 'DOCUMENT'
        && decision.classification.documentKind === 'ORDER_OR_CHECK_BILL'
        && ((Number.isFinite(checkBillTotal) && checkBillTotal > 0)
          || (decision.classification.amountSignals.length > 0
            && !decision.classification.missingRequiredSignals.some((signal) =>
              signal === 'MISSING_MONETARY_AMOUNT' || signal === 'MISSING_TRANSACTION_TOTAL')));
      if (checkBillAwaitingDecision && canCaptureExpense && this.substituteReceiptContinuation) {
        const reply = formatCheckBillDecisionReply(replyLanguage(event));
        const { created, pending } = await this.ensurePendingMedia(
          ctx, event, companyId, identity.userId, caption, media,
          {
            kind: 'CHECK_BILL_ACTION', chatKeyHash: chatKeyHashOf(event),
            ...(ocr.fields ? { ocrFields: ocr.fields } : {}),
            ...(decision.classification ? { classification: decision.classification } : {}),
          },
        );
        if (created) {
          await this.deliverReply(event, reply, buildCheckBillDecisionQuickReply(replyLanguage(event)), undefined, 'question');
          await this.persistIntakeTurn({ event,
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
          { ...(captureLink ? { captureLink } : {}) }, replyLanguage(event))
        : MEDIA_UNSUPPORTED_REPLY;
      await this.deliverCompletedReply(event, reply, companyId, access, undefined, undefined,
        decision.outcome === 'reference' ? businessDocumentOutcome(decision.classification, Boolean(captureLink)) : 'notTaken');
      await this.persistIntakeTurn({ event,
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
          await this.deliverCompletedReply(event, failedReply, companyId, access, undefined, undefined, 'unread');
          await this.persistIntakeTurn({ event,
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
        ? ocr.status === 'OCR_EXTRACTED_NEEDS_REVIEW' && decision.classification?.contentKind === 'MULTI_DOCUMENT'
          ? ocr.utilityDocuments?.length ? formatUtilityDocumentsReply(ocr.utilityDocuments, replyLanguage(event)) : MULTI_DOCUMENT_CLARIFY_REPLY[replyLanguage(event)]
          : formatOcrGovernanceClarifyReply(ocr.errorCode, ocr.status === 'OCR_FAILED', replyLanguage(event))
        : formatBusinessDocumentReply(decision.classification, this.config.webBaseUrl, companyId, undefined, replyLanguage(event));
      // What the reply reports, for its card's heading: several documents in one picture is a question;
      // a read that failed or was refused leaves the picture kept and unread; a reply about what the
      // document is follows what the reader found.
      const clarifyOutcome: LineSentDocumentOutcome = !decision.persistMedia ? businessDocumentOutcome(decision.classification)
        : ocr.status === 'OCR_EXTRACTED_NEEDS_REVIEW' && decision.classification?.contentKind === 'MULTI_DOCUMENT' ? 'question'
          : ocrGovernanceClarifyOutcome(ocr.errorCode, ocr.status === 'OCR_FAILED');
      let terminalStatus = 'clarification_required';
      if (decision.persistMedia && canCaptureExpense) {
        const { created, pending } = await this.ensurePendingMedia(
          ctx, event, companyId, identity.userId, caption, media,
          receiptClarifyQuestion(event,
            ocr.status === 'OCR_EXTRACTED_NEEDS_REVIEW' && decision.classification?.contentKind === 'MULTI_DOCUMENT'),
        );
        if (created) {
          await this.deliverReply(event, reply, undefined, undefined, clarifyOutcome);
          await this.persistIntakeTurn({ event,
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
        await this.deliverReply(event, decision.persistMedia ? (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.MEDIA_UNSUPPORTED_REPLY : MEDIA_UNSUPPORTED_REPLY) : reply, undefined, undefined, decision.persistMedia ? 'notTaken' : clarifyOutcome);
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
      note: utilityReceipt ? `LINE utility receipt: ${utilityReceipt.receipt.period}` : 'LINE receipt upload',
      captureSource: 'LINE_UPLOAD',
      lineCapture: this.captureOwnerMetadata(event),
    }, admissionAttempt.identity?.quotaSource === 'FREE_MONTHLY_3' ? {
      freeOcrReservation: { eventId: admissionAttempt.identity.eventId, monthKey: admissionAttempt.identity.monthKey,
        sourceRoute: 'receipt-ocr-line', requestId: event.lineMessageId },
    } : undefined);
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
        ocrDocumentType: toSourceDocumentType(sourceDocumentTypeFromClassification(ocr.classification)),
        ...(hintedDocType === 'TRANSFER_SLIP' ? { sourceDocumentType: hintedDocType } : {}),
        ...((access.freeExpenseDrafts || admissionAttempt.identity?.quotaSource === 'FREE_MONTHLY_3') ? { sourceOnly: true } : {}),
        ...(admissionAttempt.identity?.quotaSource === 'FREE_MONTHLY_3' && ocr.status === 'OCR_EXTRACTED_NEEDS_REVIEW'
          && isExpenseExtractionEligible(ocr.classification ?? undefined, ocrFields.grandTotalAmount, ocr.classification?.documentKind === 'TRANSFER_SLIP')
          ? { onUsablePersisted: async (tx) => {
              await completeCompanyOcrAdmissionWithinTransaction(tx, {
                companyId, sourceRoute: 'receipt-ocr-line', requestId: event.lineMessageId, eventId: admissionAttempt.identity!.eventId,
              });
            } } : {}),
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
        && isExpenseExtractionEligible(ocr.classification ?? undefined, ocrFields.grandTotalAmount, ocr.classification?.documentKind === 'TRANSFER_SLIP');
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

    // The type arrives after OCR: use the normal expense write so its preset and reason
    // follow that final type under the VAT-registration lock and the same revision fence.
    await this.expenseRepo!.updateExpense({
      id: intent.expenseId, companyId, expectedUpdatedAt: sourceUpdatedAt, updatedByUserId: ctx.userId,
        ...(expenseDraftConversationEnabled ? { status: 'DRAFT' } : {}),
        lineMessageId: event.lineMessageId,
        lineEventId: event.webhookEventId,
        aiVerificationStatus: 'NEEDS_REVIEW',
        // Chat provenance: a later correction may only target records captured in this chat.
        sourceChannelMetadataJson: { ...this.captureOwnerMetadata(event), channel: 'LINE', kind: 'media', chatKeyHash: chatKeyHashOf(event) },
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
          ...(utilityReceipt ? { utilityDocuments: readOcr.utilityDocuments } : {}),
          // Field-level evidence for the date: the four-state answer plus what the reader had to
          // infer to produce it (§5.2). `assumed` is NOT a review trigger — it is the label the
          // card, the review page, the list and the export all render.
          dateStatus,
          ...(dateAssumptions ? { expenseDateAssumptions: dateAssumptions } : {}),
          duplicateWarning: hasDuplicate,
          nextAction: 'review_in_web',
        },
    });
    await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.receive', targetType: 'expense_record', targetId: intent.expenseId, requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { lineMessageId: '[REDACTED]', mimeType: media.mimeType, byteSize: media.byteSize, sourceDocumentType: hintedDocType } });
    const purposeHint = routePlan.captureHints?.businessPurpose?.trim();
    const groundedPurpose = purposeHint && normalizeLineText(caption).toLocaleLowerCase('th-TH')
      .includes(normalizeLineText(purposeHint).toLocaleLowerCase('th-TH')) ? purposeHint : undefined;
    const draftSuggestedCategoryId = effectiveCategory?.id ?? categorySuggestion?.expenseCategoryId;
    if (expenseDraftConversationEnabled) await this.expenseDraftConversation!.startFromReceipt(ctx, { language: replyLanguage(event),
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
    if (this.paymentEvidence) {
      const pairing = await this.paymentEvidence.forCapture(ctx, chatKeyHashOf(event), intent.expenseId);
      if (await this.deliverPaymentEvidence(event, ctx, pairing)) return { outcome: 'done' };
    }
    // Source facts remain durable and editable, but sending a photo never starts a questionnaire.
    const saved = await this.savedReceiptReply(event, companyId, intent.expenseId, caption);
    const replyTexts = saved.texts;
    // §18.4 NR04/NR05: the document DID pass eligibility and a record exists, so the expense summary
    // is unchanged — only the one sentence naming what kind of document this is leads it. "ยังไม่ได้
    // สร้างรายการ" is impossible here by construction, which is exactly §18.4's rule.
    const nrOnExpense = expensePathNonReceiptLead(decision.classification, ocrFields?.grandTotalAmount);
    const utilityLead = utilityReceipt ? [
      (replyLanguage(event) === 'en' ? `This image contains ${/(?:ค่าน้ำ|ประปา)/u.test(utilityReceipt.bill.titleEvidence) ? 'water' : 'electricity'} utility documents for two billing periods.` : `📄 รูปนี้มีเอกสาร${/(?:ค่าน้ำ|ประปา)/u.test(utilityReceipt.bill.titleEvidence) ? 'ค่าน้ำ' : 'ค่าไฟ'} 2 งวดค่ะ`),
      (replyLanguage(event) === 'en' ? `• Previous period ${utilityReceipt.receipt.period}: receipt ${utilityReceipt.receipt.amount} THB — an expense draft was created from the receipt for review.` : `• งวดก่อน ${utilityReceipt.receipt.period}: ใบเสร็จ ${utilityReceipt.receipt.amount} บาท — บันทึกร่างค่าใช้จ่ายจากใบเสร็จแล้ว รอตรวจข้อมูล`),
      (replyLanguage(event) === 'en' ? `• Current period ${utilityReceipt.bill.period}: ${utilityReceipt.bill.titleEvidence} ${utilityReceipt.bill.amount} THB — an amount due, without proof of payment; it was not recorded from this image.` : `• งวดปัจจุบัน ${utilityReceipt.bill.period}: ${utilityReceipt.bill.titleEvidence} ${utilityReceipt.bill.amount} บาท — เป็นยอดที่เรียกเก็บ ยังไม่ใช่หลักฐานว่าชำระ และยังไม่ได้บันทึกจากภาพนี้`),
      (replyLanguage(event) === 'en' ? "The two amounts were not combined, and the bill was not used to record a payment." : 'ไม่ได้รวมสองยอดหรือบันทึกการชำระเงินจากใบแจ้งค่ะ'),
      (replyLanguage(event) === 'en' ? "Ask to save the current bill as an unpaid draft if needed." : 'หากต้องการบันทึกใบแจ้งงวดปัจจุบันเป็นร่างบิลค้างชำระด้วย พิมพ์ “บันทึกใบแจ้งหนี้ด้วย” ค่ะ'),
      (replyLanguage(event) === 'en' ? "After paying the current period, send its receipt to record the expense." : 'เมื่อชำระงวดปัจจุบันแล้ว ส่งใบเสร็จของงวดนั้นเข้ามาเพื่อบันทึกค่าใช้จ่ายค่ะ'),
    ].join('\n') : undefined;
    // What leads the summary in the text leads the review card's notes, in the same order.
    const leads = [utilityLead, nrOnExpense].filter((lead): lead is string => !!lead);
    if (leads.length) replyTexts[0] = [...leads, replyTexts[0]!].join('\n\n');
    if (access.freeExpenseDrafts) replyTexts[0] = await this.deliverSavedReceiptReply(event, replyTexts[0]!, companyId, access,
      admissionAttempt.usablePersisted && admissionAttempt.identity?.quotaSource === 'FREE_MONTHLY_3' ? admissionAttempt.identity.monthKey : undefined);
    else await this.deliverCompletedReply(event, replyTexts[0]!, companyId, access, undefined,
      await this.receiptReviewCard(event, replyTexts[0]!, saved.draft, companyId, leads));
    await this.recordDeliveredReceiptContinuation(event, companyId, identity.userId, intent.expenseId, access.scopes);
    await this.persistIntakeTurn({ event,
      userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: `[ผู้ใช้ส่งรูป/ไฟล์เอกสารค่าใช้จ่าย]${captionSuffix}`, replyText: replyTexts.join('\n'), intent: 'EVIDENCE_CAPTURE',
    });
    await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
  }

  /** Delivery retries reuse saved facts and may retry the same unsent quota note, never OCR. */
  private async deliverSavedReceiptReply(event: LineReceiptUploadEvent, text: string, companyId: string,
    access: { permissions: string[]; roles: string[] }, freeMonth?: string): Promise<string> {
    let noticeMonth: string | undefined;
    if (freeMonth) {
      const allowance = await freeExpenseAllowanceSnapshot(this.prisma, companyId, freeMonth);
      if (await claimFreeExpenseQuotaNotice(this.prisma, companyId, freeMonth)) {
        noticeMonth = freeMonth;
        text += `\n\n${freeExpenseQuotaNoticeTextTh(allowance.resetAt)}`;
      }
    }
    try { await this.deliverCompletedReply(event, text, companyId, access); }
    catch (error) {
      if (noticeMonth) {
        const plan = this.boundConversations.has(event) ? await this.prisma.client.lineDeliveryPlan.findUnique({
          where: { id: lineDeliveryPlanId('WEBHOOK', deliveryHash(['line-outcome-v2', event.webhookEventId])) }, select: { id: true },
        }) : null;
        // A durable delivery plan owns the original note and replays it without claiming again.
        if (!plan) await releaseFreeExpenseQuotaNotice(this.prisma, companyId, noticeMonth);
      }
      throw error;
    }
    return text;
  }

  /** The saved receipt's summary as the locked review card. `leads` are what the caller put in front of
   *  the summary; `undefined` when the record is past review or the card cannot be drawn whole. */
  private async receiptReviewCard(event: LineTextEvent | LineReceiptUploadEvent, text: string, draft: LineExpenseDraftCardFacts | undefined, companyId: string, leads: readonly string[] = []): Promise<LineReplyMessage | undefined> {
    if (!draft) return undefined;
    const ctx = this.deliveryReceiptSources.get(event)?.context;
    if (ctx?.freeExpenseDrafts) return undefined;
    const bound = this.boundConversations.get(event);
    const claim = ctx && bound && this.reimbursementDrafts
      ? await this.reimbursementDrafts.active({ ctx, owner: bound.owner, ownerEpoch: bound.epoch }) : null;
    const nextAction = claim?.status === 'COLLECTING' ? { label: (replyLanguage(event) === 'en' ? "Use bill for claim" : 'ใช้บิลนี้ทำใบเบิก'), text: (replyLanguage(event) === 'en' ? "Continue the claim using the bill just uploaded" : 'ใช้บิลที่เพิ่งส่งรูปทำใบเบิกต่อ') } : undefined;
    const confirmation = ctx && bound && !nextAction
      ? await this.expenseActions?.preview(ctx, chatKeyHashOf(event), { action: 'CONFIRM', expenseId: draft.expenseId }, true, undefined, replyLanguage(event)) : undefined;
    const card = buildExpenseDraftReviewCard(text, { ...draft, notes: [...leads, ...draft.notes] }, this.config.webBaseUrl, companyId, confirmation?.preview, nextAction, replyLanguage(event));
    if (card && confirmation?.preview) this.deliveryExpenseActions.set(event, { context: ctx!, chat: chatKeyHashOf(event), requestId: ctx!.requestId, preview: confirmation.preview });
    if (card && nextAction) card.quickReply = lineChoiceQuickReply([nextAction]);
    return card;
  }

  /** Recovery reads the saved record; it never opens a questionnaire or reapplies money. `draft` is the
   *  same reading as the review card's facts, present only while the record still awaits review. */
  private async savedReceiptReply(event: LineReceiptUploadEvent | LineTextEvent, companyId: string, expenseId: string, questionText?: string): Promise<{ texts: string[]; draft?: LineExpenseDraftCardFacts }> {
    const texts = (text: string) => ({ texts: [text] });
    const link = absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`);
    const fallback = (replyLanguage(event) === 'en' ? "The existing receipt could not be verified; check the record on the web before resending it." : 'ยังตรวจสอบใบเสร็จเดิมไม่ได้ กรุณาเปิดเว็บเพื่อตรวจรายการก่อนส่งซ้ำค่ะ');
    try {
      if (!event.handoff || !this.expenseRepo?.findByIdWithRelations) return texts(fallback);
      const access = await this.permissionResolver.resolveAccess(event.handoff.userId, companyId);
      const expense = await this.expenseRepo.findByIdWithRelations(companyId, expenseId, undefined, access.scopes ?? {});
      if (!expense || expense.createdByUserId !== event.handoff.userId || expense.captureSource !== 'LINE_UPLOAD'
        || expense.sourceChannelMetadataJson?.chatKeyHash !== chatKeyHashOf(event)) return texts(fallback);
      const category = expense.expenseCategoryId ? (await this.expenseRepo.listCategories(companyId)).find(item => item.id === expense.expenseCategoryId) : undefined;
      this.rememberReceiptDeliverySource(event, { requestId: event.webhookEventId, authSubject: event.handoff.userId,
        userId: event.handoff.userId, companyId, membershipId: access.membershipId, roles: access.roles,
        permissions: access.permissions, scopes: access.scopes, authProvider: 'line' }, expense, category);
      if (!['DRAFT', 'NEEDS_REVIEW'].includes(expense.status)) return texts((replyLanguage(event) === 'en' ? `This expense is already stored.
View record: ${link}` : `เก็บรายการนี้ไว้แล้วค่ะ\nเปิดดูรายการ: ${link}`));
      const summary = expense.aiVerificationSummaryJson;
      const reconciliation = summary?.chargeReconciliation as { status?: unknown; chargesApplied?: unknown } | undefined;
      const options: PaypersReplyOptions = {
        questionText,
        acceptedAmounts: { grandTotalAmount: expense.grandTotalAmount, vatAmount: expense.vatAmount, whtAmount: expense.whtAmount, netPayableAmount: expense.netPayableAmount, vatMode: expense.vatMode, discountAmount: expense.discountAmount },
        sourceDocumentType: expense.sourceDocumentType,
        categoryName: category?.name,
        // §11.3: the draft conversation owns "already asked" — it retires the marker on the next
        // turn, so a redelivered card repeats the summary without repeating the question.
        askVendorAddress: !access.freeExpenseDrafts && parseLineExpenseDraftContinuation(
          expense.sourceChannelMetadataJson?.[EXPENSE_SOURCE_DRAFT_KEY],
        )?.header.vendorAddressAsk === true && !expense.vendorAddressSnapshot,
        fields: { ...(summary?.recognizedFields as ReceiptOcrFieldResult | undefined),
          vendorName: expense.vendorNameSnapshot ?? undefined, documentNumber: expense.vendorDocumentNumber ?? undefined,
          vendorAddress: expense.vendorAddressSnapshot ?? undefined,
          expenseDate: expense.expenseDate.toISOString().slice(0, 10),
          description: undefined, quantity: undefined, unitPrice: undefined,
          lines: expense.lines.filter(line => !line.chargeKind).map(line => ({ description: line.description, quantity: line.quantity,
            unitPrice: line.unitPrice, amount: line.lineTotalAmount, evidenceSignal: line.sourceLineText ?? line.description })) },
        charges: expense.charges,
        ...(reconciliation && typeof reconciliation.status === 'string' && typeof reconciliation.chargesApplied === 'number'
          ? { chargeReconciliation: { status: reconciliation.status, chargesApplied: reconciliation.chargesApplied } } : {}),
        hasDuplicate: Boolean(expense.duplicateOfExpenseId) || expense.duplicateStatus === 'POSSIBLE_DUPLICATE',
        dateStatus: (summary?.dateStatus as ExpenseDocumentDateStatus | undefined) ?? (expense.reviewedAt ? 'verified' : 'unverified'),
      };
      return { texts: [formatPaypersReply(this.config.webBaseUrl, companyId, expenseId, { ...(options), language: replyLanguage(event) })],
        draft: expenseDraftCardFacts(expenseId, { ...({ ...options, status: expense.status }), language: replyLanguage(event) }) };
    } catch (error) {
      this.logger.warn({ msg: 'line_receipt_summary_unavailable', companyId, expenseId, ...safeLineErrorDetails(error) });
      return texts(fallback);
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
   * Returns false when this deployment has no attempt log at all, or when this chat sent no file
   * and the message names none, in which case the caller keeps today's behaviour rather than
   * inventing an answer. Everything else — including "we could
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
    let choices: LineReplyMessage['quickReply'];
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rows = await this.captureRepo.listLineIntakeAttempts({
        companyId: input.companyId, lineUserIdHash, chatKeyHash, since, take: 5,
      });
      // Bookkeeping rows (the A45 question, an earlier ambiguity list) are not files to report on.
      const attempts = rows.filter((row) => row.stage !== 'ROUTE');
      if (attempts.length === 0) {
        // No file was sent in this chat, so a bare "บันทึกไปยัง" asks about the note just captured and
        // the record lanes answer it (NAT-12). Naming a file still gets the honest "no file" reply.
        if (!namesLineMedia(input.normalizedText)) return false;
        reply = replyLanguage(event) === 'en' ? 'No file is available to read; tap +, choose File, and send it here again.' : FILE_ATTEMPT_NONE_REPLY;
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
          reply = fileAttemptAnswer(target, earlier, replyLanguage(event));
        } else {
          reply = fileAttemptChoiceList(facts, replyLanguage(event));
          choices = lineChoiceQuickReply(facts.map((fact, index) => ({ label: (replyLanguage(event) === 'en' ? `File ${index + 1} ${fact.fileNameSanitized ?? ''}` : `ไฟล์ที่ ${index + 1} ${fact.fileNameSanitized ?? ''}`), text: String(index + 1) })));
          await this.recordFileAttemptChoiceList(event, input.companyId, facts.map((fact) => fact.ref));
        }
      }
    } catch (error) {
      // §17.5: a lookup that failed is NEVER reported as "no file found".
      this.logger.warn({ msg: 'line_file_attempt_lookup_failed', ...safeLineErrorDetails(error) });
      reply = replyLanguage(event) === 'en' ? 'The file status could not be checked; I cannot confirm whether it was stored.' : FILE_ATTEMPT_LOOKUP_FAILED_REPLY; choices = undefined;
    }
    const card = buildLineAssistantTextCardMessage(reply, this.config.webBaseUrl, input.companyId, undefined, undefined, replyLanguage(event));
    if (choices) card.quickReply = choices;
    await this.deliverCompletedReply(event, reply, input.companyId, access, undefined, card);
    await this.persistIntakeTurn({ event,
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
  private async deliverPaymentEvidence(event: LineTextEvent | LineReceiptUploadEvent, ctx: RequestContext,
    result: LinePaymentEvidenceResult, requestedPage = 0): Promise<boolean> {
    const page = result.kind === 'ASK' ? paymentEvidencePage(result, requestedPage) : 0;
    const raw = linePaymentEvidenceReply(result, page, replyLanguage(event));
    if (!raw) return false;
    const message = raw.type === 'flex' ? asCompleteLineCard(raw) : raw;
    const ids = result.kind === 'LINKED' ? [result.slipId, result.receiptId]
      : result.kind === 'ASK' ? [result.slipId, ...result.candidates.slice(page * 4, page * 4 + 4).map(item => item.id)] : [];
    for (const id of ids) {
      const row = await this.expenseRepo?.findById(ctx.companyId, id);
      if (row) this.rememberReceiptDeliverySource(event, ctx, row);
    }
    const messages = [message];
    if (result.kind === 'LINKED' && 'messageText' in event && /(?:แสดง|ขอดู|ให้ดู|ดูรายการ)/u.test(event.messageText) && this.getLinkedExpense) {
      const expense = await this.getLinkedExpense.execute(ctx, result.receiptId).catch(() => null);
      if (expense) {
        const total = `${moneyLabel(expense.grandTotalAmount)} ${expense.currency === 'THB' ? 'บาท' : expense.currency}`;
        const date = formatReplyDate(expense.expenseDate.toISOString(), replyLanguage(event));
        const status = EXPENSE_STATUS_LABELS[expense.status];
        const card = buildExpenseDraftReviewCard(
        `${expense.vendorNameSnapshot ?? 'ค่าใช้จ่าย'} ${total} ${date} ${status}`,
        expenseDraftCardFactsFrom({ expenseId: expense.id, status, subject: expenseDraftCardSubject(expense.sourceDocumentType),
          vendor: expense.vendorNameSnapshot, total, date }), this.config.webBaseUrl, ctx.companyId, undefined, undefined, replyLanguage(event));
        if (card) messages.push(card);
      }
    }
    await this.deliverRequiredMessages(event, messages);
    await this.updateEventLog(event.webhookEventId, result.kind === 'ASK' ? 'clarification_required' : 'completed', undefined, ctx.companyId);
    return true;
  }

  private async handlePaymentEvidenceText(event: LineTextEvent, ctx: RequestContext): Promise<void> {
    const control = parseLinePaymentEvidenceControl(event.messageText), chat = chatKeyHashOf(event);
    const say = (text: string) => control
      ? this.deliverRequiredMessages(event, [{ type: 'text', text }]) : this.deliverReply(event, text);
    try {
      if (control?.operation === 'page') {
        await this.deliverPaymentEvidence(event, ctx, await this.paymentEvidence.choices(ctx, chat, control.slipId), Number(control.page)); return;
      } else if (control?.operation === 'undo') {
        await this.paymentEvidence.undo(ctx, chat, control.slipId, control.operationId!);
        await say((replyLanguage(event) === 'en' ? "The payment slip was separated back into an expense draft." : 'แยกสลิปกลับเป็นรายการร่างแล้วค่ะ'));
      } else if (control?.operation === 'new') {
        await this.paymentEvidence.separate(ctx, chat, control.slipId);
        await say((replyLanguage(event) === 'en' ? "The payment slip was kept as a separate expense draft." : 'เก็บสลิปเป็นรายการร่างแยกแล้วค่ะ'));
      } else {
        const result = control?.operation === 'link'
          ? await this.paymentEvidence.link(ctx, chat, control.slipId, control.receiptId)
          : await this.paymentEvidence.recent(ctx, chat);
        if (await this.deliverPaymentEvidence(event, ctx, result)) return;
        await say((replyLanguage(event) === 'en' ? "No matching receipt and payment slip were found in this chat; please resend the relevant documents." : 'ยังไม่พบสลิปกับใบเสร็จที่จับคู่ได้ในแชตนี้ค่ะ กรุณาส่งเอกสารที่เกี่ยวข้องอีกครั้ง'));
      }
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, ctx.companyId);
    } catch (error) {
      if (!(error instanceof ForbiddenException || error instanceof ConflictException || error instanceof NotFoundException)) throw error;
      await say(error instanceof ForbiddenException
        ? (replyLanguage(event) === 'en' ? "Your current access does not allow attaching evidence to this expense." : 'คุณยังไม่มีสิทธิ์แนบหลักฐานกับรายการนี้ค่ะ')
        : (replyLanguage(event) === 'en' ? "The expense or evidence changed; open the current record to review it." : 'รายการหรือหลักฐานเปลี่ยนไปแล้วค่ะ กรุณาเปิดรายการล่าสุดเพื่อตรวจสอบ'));
      await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, ctx.companyId);
    }
  }

  private captureOwnerMetadata(event: LineReceiptUploadEvent | LineTextEvent, lineMessageId = event.lineMessageId ?? '') {
    const bound = this.boundConversations.get(event);
    return { language: replyLanguage(event), lineMessageId, lineEventId: event.webhookEventId, chatKeyHash: chatKeyHashOf(event),
      pushTargetId: event.pushTargetId ?? event.lineUserId,
      ...(bound ? { ownerBinding: { conversationId: bound.id, membershipId: bound.owner.membershipId,
        channelId: bound.owner.messagingChannelId, ownerEpoch: bound.epoch } } : {}) };
  }

  private async persistLineFileExpense(
    ctx: RequestContext,
    event: LineReceiptUploadEvent,
    input: {
      media: DownloadedLineMedia; caption: string; branchId?: string;
      /**
       * `'none'` for the image lane: its picture was ALREADY read once by the OCR route, and §17.6
       * forbids buying a second read of it — the outcome is known before the persist. The file
       * lane (default) queues the durable read the reply promises.
       */
      read?: 'queue' | 'none';
    },
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
      lineCapture: this.captureOwnerMetadata(event),
    });
    if (intent.uploadRequired !== false) await this.uploadLineMedia(intent, input.media);
    const completed = await this.completeReceiptUpload!.execute(ctx, {
      expenseId: intent.expenseId,
      attachmentId: intent.attachmentId,
      ...(input.media.checksumSha256 ? { checksumSha256: input.media.checksumSha256 } : {}),
      byteSize: input.media.byteSize,
    });
    const readJobId = input.read === 'none' ? null : await this.captureLine!.queueExpenseRead({
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
        event, this.fileStoredReply(this.expenseCaptureLink(companyId, existing.id), replyLanguage(input.event)), companyId, access, undefined, undefined, 'reading',
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
      const deterministic = lineCaptureFailureReply(error, BRANCH_RETRY_RESEND, replyLanguage(input.event));
      if (deterministic) {
        await this.deliverReply(event, deterministic.reply, undefined, undefined, 'notTaken').catch(() => {});
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

    await this.deliverCompletedReply(event, this.fileStoredReply(persisted.link, replyLanguage(input.event)), companyId, access, undefined, undefined, 'reading');
    await this.persistIntakeTurn({ event,
      userId: input.userId, companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: `[ผู้ใช้ส่งไฟล์เอกสาร #${persisted.attachmentId}]${caption ? ` ${caption}` : ''}`,
      replyText: this.fileStoredReply(persisted.link, replyLanguage(input.event)), intent: 'EVIDENCE_CAPTURE',
    });
    await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId, { mediaState: 'retained' });
    return finished();
  }

  /**
   * The image lane's persist (§17.6 and §18.4 NR01–NR03/NR08): the same ORDINARY draft the file
   * lane builds, minus the read. The picture has ALREADY been read once by the OCR route — it
   * failed (`readFailedCode`) or it was classified as something other than a receipt — so no read
   * job is queued for it (§17.6 forbids a second read as error recovery) and the intake attempt
   * records the outcome that first read produced.
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
        media: input.media, caption: input.caption, read: 'none', ...(branchId ? { branchId } : {}),
      });
    } catch (error) {
      await this.recordIntakeAttempt(event, {
        companyId: ctx.companyId, stage: 'PERSIST', reasonCode: 'persist_failed', outcome: 'REJECTED',
        measuredByteSize: input.media.byteSize, fileName: input.media.fileName,
      });
      throw error;
    }
    await this.recordIntakeAttempt(event, {
      companyId: ctx.companyId, stage: 'READ',
      reasonCode: input.readFailedCode ?? 'read_done_non_receipt',
      outcome: input.readFailedCode ? 'STORED_READ_FAILED' : 'STORED_READ_DONE',
      measuredByteSize: input.media.byteSize, fileName: input.media.fileName,
      targetType: 'expense', targetId: persisted.expenseId,
    });
    return persisted.link;
  }

  /** §16.7 UX: persisted, being read, and where to look while it is — nothing about a deadline. */
  private fileStoredReply(link: string, language: 'th' | 'en' = 'th'): string {
  if (language === 'en') { return `The file is stored and being read; I will send the result here.${link ? ` View file: ${link}` : ''}`; }

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
        lineCapture: this.captureOwnerMetadata(event),
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
        const rejection = await this.lineMediaRejectionReason(media, 'RECEIPT');
        if (rejection) {
          await this.recordIntakeAttempt(event, {
            companyId: ctx.companyId, stage: 'SECURITY', reasonCode: rejection, outcome: 'REJECTED',
            measuredByteSize: media.byteSize, fileName: media.fileName, targetType: 'expense', targetId: expense.id,
          });
          throw new HttpException({ code: rejection }, 400);
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
    const canContinue = !ctx.freeExpenseDrafts && Boolean(expense.primaryAttachmentId) && this.config.lineExpenseDraftConversationEnabled === true
      && (!event.pushTargetId || event.pushTargetId === event.lineUserId)
      && (expense.status === 'DRAFT' || expense.status === 'NEEDS_REVIEW');
    if (canContinue) await this.expenseDraftConversation?.startFromReceipt(ctx, { language: replyLanguage(event),
      expenseId: expense.id, chatKeyHash: chatKeyHashOf(event), webhookEventId: event.webhookEventId,
      ocrFields: expense.aiVerificationSummaryJson?.recognizedFields as ReceiptOcrFieldResult | undefined,
    });
    const link = absoluteWebLink(this.config.webBaseUrl, `/companies/${ctx.companyId}/expenses/${expense.id}`);
    if (!['DRAFT', 'NEEDS_REVIEW'].includes(expense.status) || !expense.primaryAttachmentId)
      this.rememberReceiptDeliverySource(event, ctx, expense);
    if (!['DRAFT', 'NEEDS_REVIEW'].includes(expense.status)) await this.deliverCompletedReply(event, (replyLanguage(event) === 'en' ? `This record is stored; check its current status:
${link}` : `เก็บรายการนี้ไว้แล้วค่ะ เปิดตรวจสอบสถานะปัจจุบันได้ที่
${link}`), ctx.companyId, access, undefined, undefined, 'stored');
    else if (!expense.primaryAttachmentId) await this.deliverCompletedReply(event, (replyLanguage(event) === 'en' ? `The draft is stored, but its photo upload is not verified; review the existing draft:
${link}` : `เก็บร่างไว้แล้ว แต่ยังไม่มีรูปแนบที่ยืนยันการอัปโหลดค่ะ เปิดตรวจสอบร่างเดิมได้ที่
${link}`), ctx.companyId, access, undefined, undefined, 'stored');
    else {
      const summary = await this.savedReceiptReply(event, ctx.companyId, expense.id);
      const text = summary.texts.join('\n');
      if (ctx.freeExpenseDrafts) {
        const admitted = await this.prisma.client.companyOcrUsageEvent.findUnique({ where: {
          companyId_sourceRoute_requestId: { companyId: ctx.companyId, sourceRoute: 'receipt-ocr-line', requestId: event.lineMessageId },
        }, select: { quotaSource: true, monthKey: true, succeededAt: true } });
        await this.deliverSavedReceiptReply(event, text, ctx.companyId, access,
          admitted?.quotaSource === 'FREE_MONTHLY_3' && admitted.succeededAt ? admitted.monthKey : undefined);
      } else await this.deliverCompletedReply(event, text, ctx.companyId, access, undefined, await this.receiptReviewCard(event, text, summary.draft, ctx.companyId));
    }
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
  /** Classify the actual caption before an expense-domain side effect. No invented file question. */
  private pendingMediaBinding(event: LineTextEvent | LineReceiptUploadEvent) {
    const bound = this.boundConversations.get(event);
    return bound ? { channelKind: 'USER' as const, messagingChannelId: bound.owner.messagingChannelId,
      chatKeyHash: bound.owner.chatKeyHash, membershipId: bound.owner.membershipId, lifecycleEpoch: bound.epoch }
      : { channelKind: null, messagingChannelId: null, chatKeyHash: null, membershipId: null };
  }

  private async refuseEmbeddedDocumentQa(event: LineTextEvent | LineReceiptUploadEvent, companyId: string, permissions: readonly string[]) {
    await this.deliverReply(event, replyLanguage(event) === 'en'
      ? 'File questions do not support attachments inside PDFs; choose another file.'
      : 'การถามจากไฟล์ยังไม่รองรับไฟล์แนบใน PDF เลือกไฟล์อื่นได้ค่ะ',
    permissions.some(permission => ['expense.receipt.upload', 'expense.receipt.line_upload'].includes(permission))
      ? { items: [{ type: 'action', action: { type: 'uri', label: replyLanguage(event) === 'en' ? 'Upload receipt' : 'ส่งใบเสร็จ',
        uri: absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/upload`) } }] } : undefined);
    await this.updateEventLog(event.webhookEventId, 'input_rejected', 'EMBEDDED_FILE_REJECTED', companyId);
  }

  private async routeDocumentQuestionBeforeCapture(event: LineReceiptUploadEvent, ctx: RequestContext,
    access: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>, caption: string, media: DownloadedLineMedia,
    entitledFeatureKeys: ReadonlySet<string> | null,
    onAdmitted?: (identity: CompanyOcrAdmissionIdentity) => void,
  ): Promise<{ handled?: boolean; route?: GovernedLineIntakeRoutePlan } | null> {
    if (!this.documentQa) return null;
    let bound = this.boundConversations.get(event);
    const pending = await this.prisma.client.lineIntakePendingMedia.findUnique({ where: { companyId_lineMessageId: { companyId: ctx.companyId, lineMessageId: event.lineMessageId } } });
    if (!bound && pending?.readJobId && ctx.membershipId) {
      const owner: LineConversationOwner = { companyId: ctx.companyId, userId: ctx.userId, membershipId: ctx.membershipId, channel: 'line', channelKind: 'USER', messagingChannelId: event.messagingChannelId, chatKeyHash: chatKeyHashOf(event) };
      const loaded = await this.contextV2.load(owner);
      if (loaded) { bound = { owner, id: loaded.row.id, epoch: loaded.row.lifecycleEpoch }; this.boundConversations.set(event, bound); }
    }
    if (bound && pending?.readJobId && pending.messagingChannelId === event.messagingChannelId && pending.chatKeyHash === bound.owner.chatKeyHash
      && pending.membershipId === bound.owner.membershipId && pending.lifecycleEpoch === bound.epoch) {
      await this.deliverDocumentQaResult(event, pending.readJobId, { ...bound.owner, ownerEpoch: bound.epoch });
      return { handled: true };
    }
    if (!bound || !access.permissions.includes('line.ai.query') || !caption.trim()) return null;
    const textEvent: LineTextEvent = { ...event, messageText: caption };
    this.boundConversations.set(textEvent, bound);
    this.deliveryAccess.set(textEvent, this.deliveryAccess.get(event)!);
    const route = await this.tryRouteIntake({ event: textEvent, requestId: ctx.requestId, webhookEventId: event.webhookEventId,
      retryWebhookEventId: event.webhookEventId, onAdmitted,
      companyId: ctx.companyId, userId: ctx.userId, permissions: access.permissions, enabledFeatures: entitledFeatureKeys ? [...entitledFeatureKeys] : null, entitledFeatureKeys, messageText: caption,
      attachment: { id: event.lineMessageId, mimeType: media.mimeType,
        ...((media.mimeType === 'image/png' || media.mimeType === 'image/jpeg') && media.contentBase64 ? { contentBase64: media.contentBase64 } : {}) },
      valueCandidates: await this.textValueCandidates(textEvent, caption) });
    if (route.status === 'ROUTED' && route.intent === 'REIMBURSEMENT_REQUEST_START' && this.config.lineAiReimbursementDraftWriteEnabled
      && route.semanticSubrequests?.some(item => item.kind === 'write') && this.budgetGrantsV2.has(textEvent)) {
      if (!access.permissions.includes('attachment.create') || !access.permissions.some(permission => ['reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.finance_review'].includes(permission))) {
        await this.deliverReply(event, (replyLanguage(event) === 'en' ? "Your current access does not allow storing files for a claim draft; no record was created." : 'สิทธิ์ปัจจุบันยังไม่อนุญาตเก็บไฟล์สำหรับร่างใบเบิกค่ะ ยังไม่ได้สร้างรายการ'), undefined, undefined, 'notTaken'); return { handled: true };
      }
      await this.stageReimbursementMedia(event, ctx, caption, media, bound, pending);
      this.mediaTextContinuations.set(textEvent, { route, requestId: ctx.requestId });
      await this.execute(textEvent);
      return { handled: true };
    }
    if (!route.semanticSubrequests?.some(item => item.kind === 'file')) return { route };
    if (!this.config.lineAiDocumentQaEnabled) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "File question answering is unavailable; no expense was created." : 'การอ่านไฟล์เพื่อตอบคำถามยังไม่เปิดใช้งานค่ะ ยังไม่ได้สร้างรายการ'), undefined, undefined, 'notTaken'); return { handled: true };
    }
    if (route.semanticSubrequests.some(item => !['file', 'general', 'help'].includes(item.kind))) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "Choose whether to read the file for a question or keep it as expense evidence; no expense has been created." : 'คำถามจากไฟล์และคำขอทำรายการต้องแยกงานก่อนค่ะ กรุณาระบุว่าจะอ่านเพื่อตอบคำถาม หรือเก็บเป็นหลักฐานรายการ ยังไม่ได้สร้างรายการให้'), undefined, undefined, 'question');
      await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, ctx.companyId); return { handled: true };
    }
    // Only the embedded-file case gets its receipt-upload exit here; every other refusal keeps the
    // existing completion path (STRICT inspection there) and its recorded reply.
    const inspectionError = inspectAttachmentBytes(media.mimeType, media.bytes);
    if (inspectionError && attachmentInspectionFailureCode(inspectionError) === 'EMBEDDED_FILE_REJECTED') {
      await this.refuseEmbeddedDocumentQa(event, ctx.companyId, ctx.permissions);
      return { handled: true };
    }
    const grant = this.budgetGrantsV2.get(textEvent);
    if (!grant || !textEvent.inputEvidence || !this.createUploadIntent || !this.completeAttachmentUpload) throw new Error('QA_ADMISSION_UNAVAILABLE');
    let pages = 1;
    if (media.mimeType === 'application/pdf') pages = (await PDFDocument.load(media.bytes, { ignoreEncryption: false })).getPageCount();
    if (pages < 1 || pages > 20 || media.byteSize > 10 * 1024 * 1024) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "Please send a file of up to 20 pages and 10 MiB; this file exceeded the reading limits and no expense was created." : 'ไฟล์นี้เกินขอบเขตการอ่าน กรุณาส่งไม่เกิน 20 หน้าและ 10 MiB ต่อไฟล์ ยังไม่ได้สร้างรายการให้'), undefined, undefined, 'notTaken');
      await this.updateEventLog(event.webhookEventId, 'input_rejected', 'QA_INPUT_LIMIT', ctx.companyId); return { handled: true };
    }
    if (pending && (pending.userId !== bound.owner.userId || pending.channelKind !== 'USER'
      || pending.messagingChannelId !== bound.owner.messagingChannelId || pending.chatKeyHash !== bound.owner.chatKeyHash
      || pending.membershipId !== bound.owner.membershipId || pending.lifecycleEpoch !== bound.epoch)) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "The earlier file is unavailable in this chat; resend it, and no expense has been created." : 'ไฟล์เดิมไม่อยู่ในบริบทแชตปัจจุบันค่ะ กรุณาส่งไฟล์ใหม่ ยังไม่ได้สร้างรายการ'), undefined, undefined, 'notTaken');
      return { handled: true };
    }
    if (!await this.preserveSemanticTask(textEvent, route.semanticSubrequests)) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "The pending-task list is full; continue or cancel an existing task before reading this file." : 'มีงานที่รออยู่เต็มแล้วค่ะ กรุณาเลือกทำต่อหรือยกเลิกงานเดิมก่อนเริ่มอ่านไฟล์นี้'), undefined, undefined, 'notTaken'); return { handled: true };
    }
    this.semanticTaskMappings.set(event, this.semanticTaskMappings.get(textEvent)!);
    let attachmentId = pending?.attachmentId;
    if (attachmentId) {
      const resumed = await this.createUploadIntent.resume(ctx, attachmentId);
      if (resumed.uploadRequired) await this.uploadLineMedia(resumed, media);
      await this.completeAttachmentUpload.execute(ctx, { attachmentId, checksumSha256: media.checksumSha256, byteSize: media.byteSize });
    } else {
      const intent = await this.createUploadIntent.execute(ctx, { originalFileName: media.fileName, mimeType: media.mimeType, byteSize: media.byteSize, metadataJson: { lineDocumentQaOnly: true } });
      attachmentId = intent.attachmentId;
      await this.prisma.client.lineIntakePendingMedia.create({ data: { companyId: ctx.companyId, userId: ctx.userId,
        lineMessageId: event.lineMessageId, attachmentId, caption, mimeType: media.mimeType, status: 'PENDING',
        channelKind: 'USER', messagingChannelId: bound.owner.messagingChannelId, chatKeyHash: bound.owner.chatKeyHash,
        membershipId: bound.owner.membershipId, lifecycleEpoch: bound.epoch, expiresAt: new Date(grant.admittedAtMs + 86400000),
        askedQuestionJson: { kind: 'LINE_DOCUMENT_QA', webhookEventId: event.webhookEventId, lineUserId: event.lineUserId } } });
      await this.uploadLineMedia(intent, media);
      await this.completeAttachmentUpload.execute(ctx, { attachmentId, checksumSha256: media.checksumSha256, byteSize: media.byteSize });
    }
    const owner: LineDocumentQaOwner = { ...bound.owner, ownerEpoch: bound.epoch };
    const admitted = await this.documentQa.admit({ ...owner, requestId: ctx.requestId, turnId: grant.turnKey, question: caption,
      originalBudgetGrantV2: grant, originalInputDigest: textEvent.inputEvidence.joinedSha256,
      questions: this.documentQaQuestions(textEvent, route.semanticSubrequests),
      attachments: [{ attachmentId, requestedPages: Array.from({ length: pages }, (_, i) => i + 1) }] });
    await this.prisma.client.lineIntakePendingMedia.updateMany({ where: { companyId: ctx.companyId, lineMessageId: event.lineMessageId,
      messagingChannelId: event.messagingChannelId, lifecycleEpoch: bound.epoch }, data: { readJobId: admitted.jobId, revision: { increment: 1 } } });
    await this.bindDocumentQaTask(event, admitted.jobId);
    const running = this.documentQaWorker.execute(admitted.jobId);
    const waitMs = Math.max(0, Date.parse(admitted.foregroundDeadlineAt) - 3000 - Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([running, new Promise<void>(resolve => { timer = setTimeout(resolve, waitMs); })]);
    if (timer) clearTimeout(timer);
    if (!await this.deliverDocumentQaResult(event, admitted.jobId, owner)) {
      await this.deliverDocumentQaProgress(event, admitted.jobId, (replyLanguage(event) === 'en' ? "The file is being read for your question; I will reply here, and no expense or claim has been created." : 'กำลังอ่านไฟล์เพื่อตอบคำถามค่ะ เมื่ออ่านเสร็จจะตอบในแชตนี้ ยังไม่ได้สร้างรายการค่าใช้จ่ายหรือใบเบิก'));
      await this.updateEventLog(event.webhookEventId, 'document_qa_pending', undefined, ctx.companyId);
    }
    return { handled: true };
  }

  private async stageReimbursementMedia(event: LineReceiptUploadEvent, ctx: RequestContext, caption: string, media: DownloadedLineMedia,
    bound: { owner: LineConversationOwner; id: string; epoch: number }, pending: { attachmentId: string; messagingChannelId: string | null; chatKeyHash: string | null; membershipId: string | null; lifecycleEpoch: number } | null, branchId?: string): Promise<string> {
    if (!this.createUploadIntent || !this.completeAttachmentUpload) throw new Error('LINE_ATTACHMENT_MODULE_UNAVAILABLE');
    const binding = this.pendingMediaBinding(event);
    if (pending && Object.entries(binding).some(([key, value]) => (pending as unknown as Record<string, unknown>)[key] !== value)) throw new Error('LINE_PENDING_MEDIA_OWNER_MISMATCH');
    const intent = pending ? await this.createUploadIntent.resume(ctx, pending.attachmentId)
      : await this.createUploadIntent.execute(ctx, { originalFileName: media.fileName, mimeType: media.mimeType, byteSize: media.byteSize,
          ...(branchId ? { branchId } : {}), metadataJson: { lineReimbursementOwner: bound.owner, lineReimbursementEpoch: bound.epoch } });
    if (!pending) await this.prisma.client.lineIntakePendingMedia.create({ data: { companyId: ctx.companyId, userId: ctx.userId,
      lineMessageId: event.lineMessageId, attachmentId: intent.attachmentId, caption, mimeType: media.mimeType, status: 'PENDING', ...binding,
      expiresAt: new Date(Date.now() + 86400000), askedQuestionJson: { kind: 'LINE_REIMBURSEMENT_DRAFT', webhookEventId: event.webhookEventId } } });
    if (!('uploadRequired' in intent) || intent.uploadRequired) await this.uploadLineMedia(intent, media);
    await this.completeAttachmentUpload.execute(ctx, { attachmentId: intent.attachmentId, checksumSha256: media.checksumSha256, byteSize: media.byteSize }, { inspectionPolicy: 'RECEIPT' });
    // The attachment is retained for the reimbursement picker, never passed through expense capture.
    await this.prisma.client.lineIntakePendingMedia.updateMany({ where: { companyId: ctx.companyId, lineMessageId: event.lineMessageId, ...binding },
      data: { status: 'RESOLVED_RECEIPT', revision: { increment: 1 } } });
    return intent.attachmentId;
  }

  private async resumeDocumentQuestionV2(event: LineTextEvent, requestId: string, route: GovernedLineIntakeRoutePlan,
    access: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>): Promise<boolean> {
    const bound = this.boundConversations.get(event), grant = this.budgetGrantsV2.get(event);
    if (!bound || !grant || !event.inputEvidence || !this.config.lineAiDocumentQaEnabled
      || !route.semanticSubrequests?.some(item => item.kind === 'file')
      || route.semanticSubrequests.some(item => !['file', 'general', 'help'].includes(item.kind))) return false;
    const candidates = await this.prisma.client.lineIntakePendingMedia.findMany({ where: { companyId: bound.owner.companyId,
      userId: bound.owner.userId, ...this.pendingMediaBinding(event),
      status: { in: ['PENDING', 'RESOLVED_RECEIPT'] }, expiresAt: { gt: new Date() }, createdAt: { gt: new Date(Date.now() - 15 * 60_000) },
      OR: [{ readJobId: { not: null } }, { askedQuestionJson: { path: ['selectedForContinuation'], equals: true } }, { status: 'PENDING' }] }, orderBy: { createdAt: 'desc' }, take: 6 });
    if (!candidates.length) return false;
    const requestedIds = new Set(route.semanticSubrequests.filter(item => item.kind === 'file').flatMap(item =>
      typeof item.requestedFilters.attachmentId === 'string' && event.messageText.includes(item.requestedFilters.attachmentId) ? [item.requestedFilters.attachmentId] : []));
    const chosen = candidates.filter(row => (row.askedQuestionJson as { selectedForContinuation?: boolean } | null)?.selectedForContinuation === true);
    const selectedIds = chosen.length === 1 ? (chosen[0]!.askedQuestionJson as { selectedAttachmentIds?: string[] }).selectedAttachmentIds ?? [] : [];
    // Owner 2026-09-29: a file is picked by order or time ("รูปแรก", "ไฟล์ที่ 2", "รูปล่าสุด"), never by a code.
    const ordered = [...candidates].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    const byOrder = pendingMediaByOrderWords(event.messageText, ordered);
    // NAT06 (2026-09-29): the file this chat is about is the newest one the user asked about, with every
    // file read beside it. "ส่งผิด เอาไฟล์นี้แทน" then "หน้าสองเขียนว่าไง" means the new file, and a question
    // naming another file ("เทียบกับไฟล์แรก") reads that one beside it. A newest file never asked about
    // leaves no current file, so several files still ask which one.
    const newest = ordered.at(-1);
    const current = newest?.readJobId ? ordered.filter(row => row.readJobId === newest.readJobId) : [];
    const selected = requestedIds.size ? candidates.filter(row => requestedIds.has(row.attachmentId))
      : byOrder ? [byOrder, ...current.filter(row => row !== byOrder)].slice(0, 5)
      : selectedIds.length ? candidates.filter(row => selectedIds.includes(row.attachmentId))
      : current.length ? current : candidates.length === 1 ? candidates : [];
    if (!selected.length || selected.length > 5 || requestedIds.size && selected.length !== requestedIds.size
      || !requestedIds.size && !byOrder && selectedIds.length > 0 && selected.length !== selectedIds.length) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? `Several earlier files are available; identify the file, for example "${pendingMediaOrderLabel(ordered[0]!, 0, undefined, replyLanguage(event))}"; no file was chosen for you.
${ordered.map((row, i) => pendingMediaOrderLabel(row, i, true, replyLanguage(event))).join('\n')}` : `มีไฟล์ก่อนหน้าหลายไฟล์ค่ะ กรุณาบอกว่าหมายถึงไฟล์ไหน เช่น "${pendingMediaOrderLabel(ordered[0]!, 0, undefined, replyLanguage(event))}" ไม่ได้เลือกไฟล์ล่าสุดแทนให้\n${ordered.map((row, i) => pendingMediaOrderLabel(row, i, true, replyLanguage(event))).join('\n')}`));
      await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, bound.owner.companyId); return true;
    }
    const values = await this.textValueCandidates(event, event.messageText);
    const attachments: Array<{ attachmentId: string; requestedPages: number[] }> = [];
    for (const row of selected) {
      const previous = row.readJobId ? await this.documentQa.getById(row.readJobId) : null;
      if (previous && (previous.companyId !== bound.owner.companyId || previous.userId !== bound.owner.userId
        || previous.ownerMembershipId !== bound.owner.membershipId || previous.ownerEpoch !== bound.epoch
        || previous.messagingChannelId !== bound.owner.messagingChannelId || previous.chatKeyHash !== bound.owner.chatKeyHash
        || !Array.isArray(previous.attachmentsJson))) return false;
      const pageCount = (row.askedQuestionJson as { pageCount?: number } | null)?.pageCount ?? (row.mimeType === 'application/pdf' ? 0 : 1);
      const source = previous ? (previous.attachmentsJson as any[]).find((item: any) => item.attachmentId === row.attachmentId) as { attachmentId: string; requestedPages: number[] } | undefined
        : Number.isSafeInteger(pageCount) && pageCount > 0 && pageCount <= 20 ? { attachmentId: row.attachmentId, requestedPages: Array.from({ length: pageCount }, (_, i) => i + 1) } : undefined;
      if (!source) return false;
      const requestedPage = route.semanticSubrequests.find(item => item.kind === 'file'
        && (!item.requestedFilters.attachmentId || item.requestedFilters.attachmentId === row.attachmentId))?.requestedFilters.page;
      if (requestedPage !== undefined && (!Number.isSafeInteger(requestedPage) || Number(requestedPage) < 1 || Number(requestedPage) > 20
        || !values?.amounts.some(candidate => candidate.value === String(requestedPage)))) {
        await this.deliverReply(event, (replyLanguage(event) === 'en' ? `The requested page in ${pendingMediaOrderLabel(row, ordered.indexOf(row), undefined, replyLanguage(event))} is invalid; choose a page from 1 to 20.` : `เลขหน้าที่ขอสำหรับ${pendingMediaOrderLabel(row, ordered.indexOf(row), undefined, replyLanguage(event))} ไม่ถูกต้อง กรุณาระบุหน้า 1 ถึง 20 ค่ะ`)); return true;
      }
      attachments.push({ attachmentId: row.attachmentId, requestedPages: requestedPage === undefined ? source.requestedPages : [Number(requestedPage)] });
    }
    if (!await this.preserveSemanticTask(event, route.semanticSubrequests)) {
      await this.deliverReply(event, (replyLanguage(event) === 'en' ? "The pending-task list is full; continue or cancel an existing task before starting this question." : 'มีงานที่รออยู่เต็มแล้วค่ะ กรุณาเลือกทำต่อหรือยกเลิกงานเดิมก่อนเริ่มคำถามใหม่นี้')); return true;
    }
    let admitted: Awaited<ReturnType<LineDocumentQaService['admit']>>;
    try {
      admitted = await this.documentQa.admit({ ...bound.owner, ownerEpoch: bound.epoch, requestId, turnId: grant.turnKey,
        question: event.messageText, originalBudgetGrantV2: grant, originalInputDigest: event.inputEvidence.joinedSha256,
        questions: this.documentQaQuestions(event, route.semanticSubrequests), attachments });
    } catch (error) {
      if (error instanceof LineDocumentQaError && error.code === 'EMBEDDED_FILE_REJECTED') {
        await this.refuseEmbeddedDocumentQa(event, bound.owner.companyId, access.permissions);
        return true;
      }
      if (!(error instanceof LineDocumentQaError) || !['QA_PAGE_OUT_OF_RANGE', 'QA_ATTACHMENT_UNAVAILABLE', 'QA_SOURCE_CHANGED'].includes(error.code)) throw error;
      await this.deliverReply(event, error.code === 'QA_PAGE_OUT_OF_RANGE'
        ? (replyLanguage(event) === 'en' ? "The requested page is not in this file; check the page number, and no expense has been created." : 'ไฟล์นี้ไม่มีหน้าที่ขอค่ะ กรุณาตรวจสอบเลขหน้า ยังไม่ได้สร้างรายการ')
        : (replyLanguage(event) === 'en' ? "The earlier file is unavailable for reading; resend it, and no expense has been created." : 'ไฟล์เดิมไม่พร้อมให้อ่านแล้วค่ะ กรุณาส่งไฟล์ใหม่ ยังไม่ได้สร้างรายการ'));
      await this.updateEventLog(event.webhookEventId, 'clarification_required', error.code, bound.owner.companyId); return true;
    }
    for (const row of selected) {
      const changed = await this.prisma.client.lineIntakePendingMedia.updateMany({ where: { id: row.id, revision: row.revision,
        ...this.pendingMediaBinding(event) }, data: { readJobId: admitted.jobId, status: 'PENDING', caption: event.messageText,
        askedQuestionJson: { kind: 'LINE_DOCUMENT_QA', webhookEventId: event.webhookEventId, lineUserId: event.lineUserId }, revision: { increment: 1 } } });
      if (changed.count !== 1) throw new Error('LINE_CONTEXT_STALE_STATE');
    }
    await this.bindDocumentQaTask(event, admitted.jobId);
    const running = this.documentQaWorker.execute(admitted.jobId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([running, new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(0, Date.parse(admitted.foregroundDeadlineAt) - 3000 - Date.now())); })]);
    if (timer) clearTimeout(timer);
    if (!await this.deliverDocumentQaResult(event, admitted.jobId,
      { ...bound.owner, ownerEpoch: bound.epoch })) {
      await this.deliverDocumentQaProgress(event, admitted.jobId, (replyLanguage(event) === 'en' ? "The earlier file is being read for this new question; no expense has been created." : 'กำลังอ่านไฟล์เดิมเพื่อตอบคำถามใหม่นี้ค่ะ ยังไม่ได้สร้างรายการ'));
      await this.updateEventLog(event.webhookEventId, 'document_qa_pending', undefined, bound.owner.companyId);
    }
    return true;
  }

  /** NAT05 (2026-09-29): "ทำร่างค่าอาหารจากใบนี้" right after reading a file names no amount of its own, so its
   *  only source is the file this chat is about. It becomes an ordinary LINE draft of those stored bytes, read by
   *  the durable job the file lane queues and announced by the same result push — not a text note that asks for
   *  an amount, and never the read-only reader. Redelivery finds the draft the file already made. */
  private async draftCurrentDocumentV2(event: LineTextEvent, requestId: string, route: GovernedLineIntakeRoutePlan,
    access: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>): Promise<boolean> {
    const bound = this.boundConversations.get(event), items = route.semanticSubrequests ?? [];
    const writes = items.filter(item => item.kind === 'write');
    if (!bound || !this.expenseRepo || !this.captureLine || writes.length !== 1 || writes[0]!.writeIntent !== 'EXPENSE_DOCUMENT_CAPTURE'
      || items.some(item => !['write', 'general', 'help'].includes(item.kind))
      || !['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.create'].some(permission => access.permissions.includes(permission))
      || (await this.textValueCandidates(event, event.messageText))?.amounts.length) return false;
    const { companyId, userId } = bound.owner;
    const rows = await this.prisma.client.lineIntakePendingMedia.findMany({ where: { companyId, userId, ...this.pendingMediaBinding(event),
      readJobId: { not: null }, status: { in: ['PENDING', 'RESOLVED_RECEIPT'] }, expiresAt: { gt: new Date() },
      createdAt: { gt: new Date(Date.now() - 15 * 60_000) } }, orderBy: { createdAt: 'desc' }, take: 6 });
    const current = rows.filter(row => row.readJobId === rows[0]?.readJobId);
    if (current.length !== 1) return false;
    const file = current[0]!;
    const attachment = await this.prisma.client.attachmentObject.findFirst({ where: { id: file.attachmentId, companyId, uploadedByUserId: userId, status: 'ACTIVE' },
      select: { checksumSha256: true } });
    if (!attachment) return false;
    const chatKeyHash = chatKeyHashOf(event);
    const expenseId = (await this.expenseRepo.findByLineMessageId(companyId, file.lineMessageId))?.id
      ?? (await this.createReceiptDraftFromPendingMedia(requestId, userId, companyId, event.webhookEventId, file, access.scopes, chatKeyHash, access.membershipId,
        // The result push finds its chat from these, exactly as for a draft the file lane made.
        { lineMessageId: file.lineMessageId, lineEventId: event.webhookEventId, pushTargetId: event.pushTargetId ?? event.lineUserId,
          ownerBinding: { conversationId: bound.id, membershipId: bound.owner.membershipId, channelId: bound.owner.messagingChannelId, ownerEpoch: bound.epoch } })).expenseId;
    const saved = await this.expenseRepo.findById(companyId, expenseId);
    await this.captureLine.queueExpenseRead({ companyId, expenseId, attachmentId: file.attachmentId, attachmentChecksum: attachment.checksumSha256 ?? null,
      expectedSourceUpdatedAt: saved?.updatedAt ?? null });
    const reply = (replyLanguage(event) === 'en' ? "The file is being read to prepare an expense draft for your review; no expense confirmation or payment has occurred." : 'กำลังอ่านไฟล์นี้เพื่อทำร่างค่าใช้จ่ายให้ตรวจค่ะ อ่านเสร็จจะส่งร่างในแชตนี้ ยังไม่ได้ยืนยันรายการหรือจ่ายเงิน');
    await this.deliverCompletedReply(event, reply, companyId, access);
    await this.persistIntakeTurn({ event, userId, companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: event.messageText, replyText: reply, intent: 'EVIDENCE_CAPTURE' });
    await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
    return true;
  }

  private async deliverDocumentQaResult(event: LineReceiptUploadEvent | LineTextEvent, jobId: string, owner: LineDocumentQaOwner): Promise<boolean> {
    const inventory = await this.restoreDocumentQaTask(event, jobId);
    const job = await this.documentQa.getForDelivery(jobId, owner);
    if (!job) {
      const terminal = await this.documentQa.getById(jobId);
      if (!terminal || !['FAILED', 'EXPIRED', 'CANCELED'].includes(terminal.status)
        || terminal.companyId !== owner.companyId || terminal.userId !== owner.userId || terminal.ownerMembershipId !== owner.membershipId
        || terminal.ownerEpoch !== owner.ownerEpoch || terminal.messagingChannelId !== owner.messagingChannelId || terminal.chatKeyHash !== owner.chatKeyHash) return false;
      const text = terminal.status === 'CANCELED' ? (replyLanguage(event) === 'en' ? "This file-reading task was cancelled; no expense was created." : 'ยกเลิกงานอ่านไฟล์นี้แล้ว ยังไม่ได้สร้างรายการให้')
        : terminal.status === 'EXPIRED' ? (replyLanguage(event) === 'en' ? "The file-reading task expired, but the file is retained; ask again, and no expense has been created." : 'งานอ่านไฟล์นี้หมดเวลาแล้ว ไฟล์ยังเก็บไว้ พิมพ์ถามอีกครั้งได้เลยค่ะ ยังไม่ได้สร้างรายการให้')
          : (replyLanguage(event) === 'en' ? "The file could not be read for this question, but is retained; ask again, send a clearer file, or choose another page, and no expense has been created." : 'ยังอ่านไฟล์นี้เพื่อตอบคำถามไม่สำเร็จ ไฟล์ยังเก็บไว้ พิมพ์ถามอีกครั้ง ส่งไฟล์ที่ชัดกว่า หรือเลือกหน้าใหม่ได้ค่ะ ยังไม่ได้สร้างรายการให้');
      const said = documentQaAskedWords(terminal);
      const coverage = inventory.map(item => ({ index: item.index, status: 'needs_user' as const, reasonCode: 'QA_NOT_COMPLETED', question: said(item) }));
      if (coverage.length) this.semanticDelivery.set(event, coverage);
      const remaining = inventory.filter(item => item.kind !== 'file');
      const notice = remaining.length ? (replyLanguage(event) === 'en' ? `

Parts still unanswered: ${remaining.map(said).join(' / ')}; choose a part to continue.` : `\n\nส่วนที่ยังไม่ได้ตอบ: ${remaining.map(said).join(' / ')} กรุณาเลือกถามต่อได้ค่ะ`) : '';
      if (await this.deliverMessages(event, [{ type: 'text', text: text + notice }]) !== 'ok') return false;
      if (coverage.length) await this.settleSemanticTask(event as LineTextEvent, coverage);
      // A failed or timed-out read keeps the file, so asking again or a new page reads it again; only a
      // cancel lets it go.
      await this.prisma.client.lineIntakePendingMedia.updateMany({ where: { readJobId: jobId, companyId: owner.companyId, userId: owner.userId,
        messagingChannelId: owner.messagingChannelId, chatKeyHash: owner.chatKeyHash, lifecycleEpoch: owner.ownerEpoch },
        data: { status: terminal.status === 'CANCELED' ? 'EXPIRED' : 'RESOLVED_RECEIPT', revision: { increment: 1 } } });
      await this.updateEventLog(event.webhookEventId, 'document_qa_failed', terminal.errorCode ?? undefined, owner.companyId); return true;
    }
    const result = parseLineDocumentQaResult(job.resultJson); if (!result) return false;
    this.documentQaDelivery.set(event, job);
    // Owner 2026-09-29: files by their order in this read, never an attachment id or a reader code. The
    // failed-page wording is the one sendMessagesV2 matches, so the delivery plan never repeats it.
    const readOrder = [...new Set(result.coverage.requested.map(page => page.attachmentId))];
    const fileOrdinal = (attachmentId: string) => readOrder.includes(attachmentId) ? (replyLanguage(event) === 'en' ? ` ${readOrder.indexOf(attachmentId) + 1}` : ` ลำดับที่ ${readOrder.indexOf(attachmentId) + 1}`) : '';
    const failed = result.coverage.failed.map(page => (replyLanguage(event) === 'en' ? `Could not read attachment ${fileOrdinal(page.attachmentId)} page ${page.page}.` : `ยังอ่านเอกสารแนบ${fileOrdinal(page.attachmentId)} หน้า ${page.page} ไม่สำเร็จ`)).join('\n');
    const said = documentQaAskedWords(job);
    const coverage = inventory.map(item => {
      const answer = result.questionCoverage?.find(answer => answer.subrequestIndex === item.index);
      return item.kind === 'file' && answer?.status === 'answered'
        ? { index: item.index, status: 'handled' as const }
        : { index: item.index, status: 'needs_user' as const, reasonCode: item.kind === 'file' ? 'QA_QUESTION_INCOMPLETE' : 'QA_SEPARATE_CLAUSE_PENDING', question: said(item) };
    });
    if (coverage.length) this.semanticDelivery.set(event, coverage);
    const remaining = inventory.filter(item => coverage.find(entry => entry.index === item.index)?.status === 'needs_user');
    const notice = remaining.length ? (replyLanguage(event) === 'en' ? `

Parts still awaiting answers: ${remaining.map(said).join(' / ')}; choose a part to continue.` : `\n\nยังตอบได้ไม่ครบทุกส่วน ส่วนที่ยังรอ: ${remaining.map(said).join(' / ')} กรุณาเลือกถามต่อได้ค่ะ`) : '';
    // A reader that still names a file by its id is rewritten to the file's order (Owner 2026-09-29: no ids reach the customer).
    const answer = readOrder.reduce((value, attachmentId, index) => value.replaceAll(attachmentId, (replyLanguage(event) === 'en' ? `File ${index + 1}` : `ไฟล์ที่ ${index + 1}`)), result.answer);
    const text = (replyLanguage(event) === 'en' ? `${answer}

Answer sources: ${result.answerPageRefs.map(ref => `เอกสารแนบ${fileOrdinal(ref.attachmentId)} หน้า ${ref.page}`).join(', ')}
Read ${result.coverage.read.length}/${result.coverage.requested.length} pages${failed ? `\nหน้าที่ยังอ่านไม่ได้\n${failed}` : ''}${notice}` : `${answer}\n\nแหล่งคำตอบ: ${result.answerPageRefs.map(ref => `เอกสารแนบ${fileOrdinal(ref.attachmentId)} หน้า ${ref.page}`).join(', ')}\nอ่าน ${result.coverage.read.length}/${result.coverage.requested.length} หน้า${failed ? `\nหน้าที่ยังอ่านไม่ได้\n${failed}` : ''}${notice}`);
    const delivery = await this.deliverMessages(event, [{ type: 'text', text }]);
    if (delivery !== 'ok') return false;
    if (coverage.length) await this.settleSemanticTask(event as LineTextEvent, coverage);
    await this.prisma.client.lineIntakePendingMedia.updateMany({ where: { readJobId: jobId, companyId: owner.companyId, userId: owner.userId,
      messagingChannelId: owner.messagingChannelId, chatKeyHash: owner.chatKeyHash, lifecycleEpoch: owner.ownerEpoch }, data: { status: 'RESOLVED_RECEIPT', revision: { increment: 1 } } });
    await this.updateEventLog(event.webhookEventId, 'completed', undefined, owner.companyId); return true;
  }

  /** The existing worker tick resumes saved QA output even after new-write flags turn off. */
  async recoverDocumentQaResults(): Promise<number> {
    const rows = await this.prisma.client.lineIntakePendingMedia.findMany({ where: { status: 'PENDING', readJobId: { not: null },
      askedQuestionJson: { path: ['kind'], equals: 'LINE_DOCUMENT_QA' }, expiresAt: { gt: new Date() } }, take: 20, orderBy: { createdAt: 'asc' } });
    let delivered = 0;
    for (const row of rows) {
      try {
        const target = row.askedQuestionJson as { webhookEventId?: string; lineUserId?: string };
        if (!target.webhookEventId || !target.lineUserId || !row.messagingChannelId || !row.membershipId || !row.chatKeyHash) continue;
        // The turn that admitted this read answers it until its foreground window closes. Delivering here as
        // well raced that turn for the same event, and the loser parked an answered event as delivery_pending
        // (NAT06 2026-09-29), so recovery waits for the window to pass.
        const job = await this.documentQa.getById(row.readJobId!).catch(() => null);
        if (!job || job.foregroundDeadlineAt.getTime() > Date.now()) continue;
        const owner: LineConversationOwner = { companyId: row.companyId, userId: row.userId, membershipId: row.membershipId,
          channel: 'line', channelKind: 'USER', messagingChannelId: row.messagingChannelId, chatKeyHash: row.chatKeyHash };
        const current = await this.contextV2.load(owner);
        if (!current || current.row.lifecycleEpoch !== row.lifecycleEpoch) continue;
        const access = await this.permissionResolver.resolveAccess(row.userId, row.companyId);
        if (access.membershipId !== row.membershipId) continue;
        const event: LineReceiptUploadEvent = { webhookEventId: target.webhookEventId, lineUserId: target.lineUserId, replyToken: '',
          lineMessageId: row.lineMessageId, messagingChannelId: row.messagingChannelId, channelKind: 'USER', messageType: 'file', handoff: { userId: row.userId, companyId: row.companyId } };
        if (chatKeyHashOf(event) !== row.chatKeyHash) continue;
        this.boundConversations.set(event, { owner, id: current.row.id, epoch: row.lifecycleEpoch });
        this.deliveryAccess.set(event, { userId: row.userId, companyId: row.companyId, membershipId: row.membershipId, fingerprint: resolvedLineDeliveryAccessFingerprint(row.userId, row.companyId, access, await loadEntitledFeatureKeys(this.prisma, row.companyId)) });
        if (await this.deliverDocumentQaResult(event, row.readJobId!, { ...owner, ownerEpoch: row.lifecycleEpoch })) delivered++;
      } catch (error) { this.logger.warn({ msg: 'line_qa_delivery_recovery_failed', id: row.id, ...safeLineErrorDetails(error) }); }
    }
    return delivered;
  }

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
    const binding = this.pendingMediaBinding(event);
    const redelivered = await this.prisma.client.lineIntakePendingMedia.findUnique({ where: key });
    if (redelivered && Object.entries(binding).some(([field, value]) => ((redelivered as unknown as Record<string, unknown>)[field] ?? null) !== value)) throw new Error('LINE_PENDING_MEDIA_OWNER_MISMATCH');
    // Redelivery of the SAME message: stay silent, exactly as before.
    if (redelivered) return { created: false, pending: redelivered };
    // A DIFFERENT picture while one question is still open. Before, this opened a second row and
    // asked again — which is what turned an unrecognised answer into an endless loop, storing one
    // more copy of the image every round. Answer the open question about the newest file instead:
    // repoint the existing row at this upload and stay silent.
    const open = await this.prisma.client.lineIntakePendingMedia.findFirst({
      where: { companyId, userId, status: 'PENDING', expiresAt: { gt: new Date() }, ...binding },
      orderBy: { createdAt: 'desc' },
    });
    if (open && !this.boundConversations.has(event)) return { created: false, pending: open };
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
          caption, mimeType: media.mimeType, status: 'PENDING', askedQuestionJson: { ...askedQuestion,
            ...(this.boundConversations.has(event) ? { pageCount: media.mimeType === 'application/pdf' ? (await PDFDocument.load(media.bytes, { ignoreEncryption: false })).getPageCount() : 1 } : {}) } as any, ...binding,
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
    }, { inspectionPolicy: 'RECEIPT' });
    const pending = await this.prisma.client.lineIntakePendingMedia.findUnique({ where: key });
    // Rendered from the SAME ordered query `handlePendingMediaControl` resolves the tapped words against.
    if (open && pending && this.boundConversations.has(event)) this.pendingMediaNotices.set(event, this.pendingMediaSelectionMessage(
      await this.prisma.client.lineIntakePendingMedia.findMany({ where: { companyId, userId, status: 'PENDING', expiresAt: { gt: new Date() }, ...binding },
        orderBy: { createdAt: 'asc' }, take: 6 }), replyLanguage(event)));
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
    if (input.steerToPendingDecision && this.substituteActions && this.substituteReceiptContinuation) {
      const chat = chatKeyHashOf(input.sourceEvent);
      const expenseId = await this.substituteReceiptContinuation.pendingIssueDecisionExpenseId(input.ctx, chat);
      const offered = expenseId ? await this.substituteActions.prepare(input.ctx, chat, expenseId) : undefined;
      if (offered?.preview) this.deliverySubstituteActions.set(input.sourceEvent, { context: input.ctx, preview: offered.preview });
    }
    return formatSignatureTicketReply(this.config.webBaseUrl, input.companyId, asset.id, input.steerToPendingDecision, replyLanguage(input.sourceEvent));
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
    const text = question.kind === 'SUBSTITUTE_SCAN_CONFIRM' ? substituteScanConfirmQuestion(scan!, replyLanguage(event)) : substituteMediaQuestion(choices, replyLanguage(event));
    await this.deliverReply(event, text, undefined, undefined, 'question');
    await this.persistIntakeTurn({ event,
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
    const attached = await this.substituteReceiptContinuation!.attachMedia(input.ctx, { language: replyLanguage(event),
      expenseId: input.context.expenseId,
      attachmentId: input.pending.attachmentId,
      purpose: input.purpose,
      webBaseUrl: this.config.webBaseUrl,
    });
    const replyText = await this.currentSubstituteAttachmentReply(event, input.ctx, input.context.expenseId, attached.replyText);
    await this.deliverCompletedReply(event, replyText, companyId, input.access, undefined, undefined, 'stored');
    await this.replaceAttachedSubstituteClarification(event, input.ctx, input.context.expenseId);
    await this.resolvePendingRow(input.pending.id, 'RESOLVED_RECEIPT');
    await this.persistIntakeTurn({ event,
      userId: input.userId, companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: `[ผู้ใช้ส่งหลักฐานของงานใบรับรอง]${input.captionSuffix}`, replyText, intent: 'EVIDENCE_CAPTURE',
    });
    await this.updateEventLog(event.webhookEventId, 'completed', undefined, companyId);
    return { outcome: 'done' };
  }

  private async currentSubstituteAttachmentReply(event: LineReceiptUploadEvent | LineTextEvent, ctx: RequestContext, expenseId: string, fallback: string): Promise<string> {
    try {
      const continued = await this.substituteReceiptContinuation!.execute(ctx, { language: replyLanguage(event), messageText: 'ทำใบรับรองต่อ',
        chatKeyHash: chatKeyHashOf(event), recentCandidates: [{ id: expenseId, label: 'รายการนี้' }],
        boundCandidateExpenseIds: [expenseId], webBaseUrl: this.config.webBaseUrl });
      await this.rememberSubstituteDeliverySource(event as LineTextEvent, ctx, continued);
      return (replyLanguage(event) === 'en' ? `The evidence was attached.

${continued.replyText}` : `แนบหลักฐานให้แล้วค่ะ\n\n${continued.replyText}`);
    } catch (error) {
      // The attachment committed. A failed refresh must never recapture it as a new expense.
      this.logger.warn({ msg: 'line_substitute_after_attachment_refresh_failed', ...safeLineErrorDetails(error) });
      return fallback;
    }
  }

  private async replaceAttachedSubstituteClarification(event: LineReceiptUploadEvent | LineTextEvent, ctx: RequestContext, expenseId: string): Promise<void> {
    const chatKey = event.pushTargetId ?? event.lineUserId;
    const waiting = await this.ledger?.openWaitingUser(ctx.companyId, chatKey, ctx.userId) ?? [];
    const ids = waiting.filter(item => {
      if (item.clarifyForIntent !== 'SUBSTITUTE_RECEIPT_CONTINUATION') return false;
      if (item.candidateExpenseIds?.includes(expenseId)) return true;
      try { return (JSON.parse(item.entry.sourceContext ?? '{}') as LineClarificationSource).substitute
        ?.some(proof => proof?.records.some(record => record.id === expenseId)); } catch { return false; }
    }).map(item => item.id);
    await this.consumeClarifications(ctx.companyId, chatKey, ctx.userId, waiting, ids, 'business_answer');
    const current = this.deliverySubstituteContinuations.get(event);
    if (current?.expenseId === expenseId && current.pendingQuestion) await this.appendSourceBoundClarifications(event, {
      messagingChannelId: event.messagingChannelId, companyId: ctx.companyId, chatKey,
      turnId: ctx.requestId, webhookEventId: event.webhookEventId, userId: ctx.userId,
      items: [{ text: 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ', state: 'waiting_user', intent: 'CLARIFY',
        clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION', clarifyQuestion: current.pendingQuestion, candidateExpenseIds: [expenseId] }],
    });
  }

  /** A pending-media answer that could not be honoured. The row is left PENDING either way — the
   *  sender still owns those bytes — but a KNOWN data state gets copy it can act on and the same
   *  terminal status the direct photo path records, instead of a "temporary" claim that the very
   *  next identical attempt disproves (UAT 2026-09-05). */
  private async replyPendingMediaFailure(
    event: LineTextEvent, companyId: string, requestId: string, error: unknown,
  ): Promise<void> {
    const deterministic = lineCaptureFailureReply(error, BRANCH_RETRY_ANSWER, replyLanguage(event));
    this.logger.warn({
      msg: deterministic ? 'line_pending_media_answer_needs_setup' : 'line_substitute_media_answer_failed',
      requestId, ...(deterministic && { errorCode: deterministic.errorCode }), ...safeLineErrorDetails(error),
    });
    await this.deliverReply(event, deterministic?.reply ?? ERROR_REPLY[replyLanguage(event)]);
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
      return this.refuseSubstituteMediaAnswer(event, ctx, access, text, receiptDeniedReply(access, replyLanguage(event)));
    }
    const context = await this.substituteReceiptContinuation.loadOpenMediaContext(ctx, chatKeyHash, replyLanguage(event));
    if (!context) {
      return this.refuseSubstituteMediaAnswer(event, ctx, access, text,
        (replyLanguage(event) === 'en' ? "The substitute-receipt work is no longer open; the file is retained without being attached as expense evidence." : '📄 งานใบรับรองแทนใบเสร็จรับเงินในแชทนี้ไม่ได้เปิดค้างไว้แล้วค่ะ ไฟล์ที่ส่งมายังเก็บไว้ ยังไม่ได้บันทึกเป็นหลักฐานของรายการใด'));
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
          ? this.askSubstituteMediaQuestion(event, ctx, access, pending, text, substituteScanPickQuestion(others, replyLanguage(event)),
            { kind: 'SUBSTITUTE_SCAN_PICK', chatKeyHash, evidenceIds: others.map((item) => item.evidenceId) })
          : this.askSubstituteMediaQuestion(event, ctx, access, pending, text,
            substituteMediaQuestion(withoutScanChoices, replyLanguage(event)),
            { kind: 'SUBSTITUTE_MEDIA_CLASS', chatKeyHash, choices: withoutScanChoices });
      }
      // The form stopped awaiting a scan while the question was open: never link, ask again.
      if (!scan) {
        return this.askSubstituteMediaQuestion(event, ctx, access, pending, text,
          substituteMediaQuestion(withoutScanChoices, replyLanguage(event)),
          { kind: 'SUBSTITUTE_MEDIA_CLASS', chatKeyHash, choices: withoutScanChoices });
      }
      return { outcome: 'not_answered', question: substituteScanConfirmQuestion(scan, replyLanguage(event)) };
    }
    if (asked.kind === 'SUBSTITUTE_SCAN_PICK') {
      const offered = asked.evidenceIds
        .map((id) => context.awaitingScans.find((item) => item.evidenceId === id))
        .filter((item): item is LineSubstituteMediaScan => !!item);
      const index = numberedSelection(text, offered.length);
      if (index === undefined) return { outcome: 'not_answered', question: substituteScanPickQuestion(offered, replyLanguage(event)) };
      return this.linkSubstituteScan(event, ctx, access, pending, text, offered[index]!);
    }
    const answer = substituteMediaAnswer(text, asked.choices);
    if (!answer) return { outcome: 'not_answered', question: substituteMediaQuestion(asked.choices, replyLanguage(event)) };
    if (answer === 'NEW_EXPENSE') return { outcome: 'new_expense' };
    if (answer === 'NO_RECORD') {
      await this.deliverCompletedReply(event, (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.MEDIA_NOT_RECORDED_REPLY : MEDIA_NOT_RECORDED_REPLY), ctx.companyId, access);
      await this.resolvePendingRow(pending.id, 'RESOLVED_ILLUSTRATION');
      await this.persistIntakeTurn({ event,
        userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: text, replyText: (replyLanguage(event) === 'en' ? LEGACY_LINE_COPY_EN.MEDIA_NOT_RECORDED_REPLY : MEDIA_NOT_RECORDED_REPLY), intent: 'CLARIFY',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, ctx.companyId);
      return { outcome: 'handled' };
    }
    if (answer === 'SIGNATURE') {
      // A3: the photo the assistant asked for, finally reaching the library. §14's rule stands —
      // the answer is checked against the permission the action needs, not the one that parked it.
      if (!maySubmitSignature(ctx.permissions) || !this.initSignatureUpload || !this.createSignatureAsset) {
        return this.refuseSubstituteMediaAnswer(event, ctx, access, text, SIGNATURE_FORBIDDEN_REPLY[replyLanguage(event)]);
      }
      // F9: certification resolves signatures through a PNG/JPEG-only lookup, so a PDF answered as
      // "my signature" would become an ACTIVE asset that can never sign anything — a dead end from
      // the first turn now that nothing is held for review. Refuse it while the sender is still here.
      if (pending.mimeType !== 'image/png' && pending.mimeType !== 'image/jpeg') {
        return this.refuseSubstituteMediaAnswer(event, ctx, access, text, SIGNATURE_NEED_IMAGE_REPLY[replyLanguage(event)]);
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
        // F8: offer preparation only when a workflow is actually parked at the issue decision — read
        // from the live continuation, since this route can also be reached with no decision pending.
        steerToPendingDecision: await this.substituteReceiptContinuation.hasPendingIssueDecision(ctx, chatKeyHash),
      });
      await this.deliverCompletedReply(event, replyText, ctx.companyId, access);
      await this.persistIntakeTurn({ event,
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
          substituteMediaQuestion(withoutScanChoices, replyLanguage(event)),
          { kind: 'SUBSTITUTE_MEDIA_CLASS', chatKeyHash, choices: withoutScanChoices });
      }
      return this.linkSubstituteScan(event, ctx, access, pending, text, scan);
    }
    const { replyText } = await this.substituteReceiptContinuation.attachMedia(ctx, { language: replyLanguage(event),
      expenseId: context.expenseId,
      attachmentId: pending.attachmentId,
      purpose: answer === 'PAYMENT_EVIDENCE' ? 'expense.payment.evidence' : 'expense.receipt.supporting',
      webBaseUrl: this.config.webBaseUrl,
    });
    const currentReply = await this.currentSubstituteAttachmentReply(event, ctx, context.expenseId, replyText);
    return this.deliverSubstituteMediaOutcome(event, ctx, access, pending, text, currentReply, undefined, context.expenseId);
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
    if (!choice) return { outcome: 'not_answered', question: formatCheckBillDecisionReply(replyLanguage(event)) };

    if (choice === 'UNPAID' || choice === 'FINAL_RECEIPT') {
      const reply = choice === 'UNPAID'
        ? [
            (replyLanguage(event) === 'en' ? "No expense has been created yet." : '⏸️ ยังไม่สร้างรายการค่าใช้จ่ายค่ะ'),
            (replyLanguage(event) === 'en' ? "The bill shows an amount due without evidence that the seller was paid." : 'เพราะเช็กบิลใบนี้แสดงเพียงยอดที่ต้องจ่าย แต่ยังไม่มีหลักฐานว่าร้านรับเงินแล้ว'),
            (replyLanguage(event) === 'en' ? "After payment, please send the final receipt." : 'หลังจ่ายเงิน ส่งใบเสร็จฉบับสุดท้ายเข้ามาได้เลยค่ะ'),
          ].join('\n')
        : [
            (replyLanguage(event) === 'en' ? "No expense has been created from this bill yet." : '📷 ได้เลยค่ะ ยังไม่สร้างรายการจากเช็กบิลใบนี้'),
            (replyLanguage(event) === 'en' ? "Please send the final receipt photo to prepare the expense from the actual receipt." : 'ส่งรูปใบเสร็จฉบับสุดท้ายเข้ามา ระบบจะอ่านและสร้างรายการจากใบเสร็จจริงค่ะ'),
          ].join('\n');
      await this.deliverReply(
        event,
        reply,
        choice === 'FINAL_RECEIPT' ? buildCheckBillReceiptUploadQuickReply(replyLanguage(event)) : undefined,
      );
      await this.resolvePendingRow(pending.id, 'RESOLVED_ILLUSTRATION');
      await this.persistIntakeTurn({ event,
        userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: text, replyText: reply, intent: 'CLARIFY',
      });
      await this.updateEventLog(event.webhookEventId, 'completed', undefined, ctx.companyId);
      return { outcome: 'handled' };
    }

    const canCaptureExpense = ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.create']
      .some((permission) => access.permissions.includes(permission));
    if (!canCaptureExpense || !this.expenseRepo || !this.substituteReceiptContinuation) {
      return this.refuseSubstituteMediaAnswer(event, ctx, access, text, receiptDeniedReply(access, replyLanguage(event)));
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
      ? await this.receiptOcrApply.apply(ctx, expenseId, asked.ocrFields, { expectedUpdatedAt: captured.updatedAt,
        ocrDocumentType: toSourceDocumentType(sourceDocumentTypeFromClassification(asked.classification ?? null)) }) : undefined;
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
    const started = await this.substituteReceiptContinuation.startFromCheckBill(ctx, { language: replyLanguage(event),
      expenseId,
      chatKeyHash,
      webBaseUrl: this.config.webBaseUrl,
    });
    const continuation = started.status === 'FORBIDDEN'
      ? started
      : await this.substituteReceiptContinuation.execute(ctx, { language: replyLanguage(event),
          messageText: '1',
          chatKeyHash,
          recentCandidates: [{ id: expenseId, label: (replyLanguage(event) === 'en' ? `Bill confirmed as paid ${expenseId}` : `เช็กบิลที่ยืนยันว่าจ่ายแล้ว ${expenseId}`) }],
          webBaseUrl: this.config.webBaseUrl,
          confirmedStart: true,
        });
    await this.rememberSubstituteDeliverySource(event, ctx, continuation);
    const completed = await this.expenseRepo.findByIdWithRelations(ctx.companyId, expenseId, undefined, access.scopes);
    if (!completed) throw new ConflictException('Receipt changed before the reply.');
    this.rememberReceiptDeliverySource(event, ctx, completed);
    const reply = formatCheckBillDraftCreatedReply(continuation, completed.charges ?? [], replyLanguage(event));
    if (continuation.pendingQuestion && !['FORBIDDEN', 'INELIGIBLE', 'STALE'].includes(continuation.status)) {
      await this.deliverReply(event, reply);
    } else {
      await this.deliverCompletedReply(event, reply, ctx.companyId, access, continuation.badge);
    }
    await this.resolvePendingRow(pending.id, 'RESOLVED_RECEIPT');
    await this.recordDeliveredReceiptContinuation(event, ctx.companyId, ctx.userId, expenseId, access.scopes);
    await this.persistIntakeTurn({ event,
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
      const { replyText, badge } = await this.substituteReceiptContinuation!.linkWetSignedScan(ctx, { language: replyLanguage(event),
        expenseId: scan.expenseId,
        evidenceId: scan.evidenceId,
        attachmentId: pending.attachmentId,
        checksumSha256: await this.pendingMediaChecksum(ctx.companyId, pending.attachmentId),
        webBaseUrl: this.config.webBaseUrl,
      });
      const next = await this.substituteActions?.prepare(ctx, chatKeyHashOf(event), scan.expenseId, replyLanguage(event));
      if (next?.preview) this.deliverySubstituteActions.set(event, { context: ctx, preview: next.preview });
      return this.deliverSubstituteMediaOutcome(event, ctx, access, pending, text, replyText, badge);
    } catch (error: unknown) {
      if (!(error instanceof HttpException)) throw error;
      const body = error.getResponse();
      const detail = typeof body === 'object' && body && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : error.message;
      return this.refuseSubstituteMediaAnswer(event, ctx, access, text,
        (replyLanguage(event) === 'en' ? `This photo cannot be accepted as the signed form for ${scan.documentNumber}; send a clearer photo or attach the file on the web.` : `📄 ยังรับรูปนี้เป็นฟอร์มที่เซ็นแล้วของ ${scan.documentNumber} ไม่ได้ค่ะ\n${detail}\nส่งรูปใหม่ที่ชัดเจน หรือแนบไฟล์ในเว็บได้เลย`));
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
    await this.persistIntakeTurn({ event,
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
    await this.persistIntakeTurn({ event,
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
    attachedExpenseId?: string,
  ): Promise<{ outcome: 'handled' }> {
    // W1, same rule as the signature branch: every caller reaches here with the attachment ALREADY
    // linked (payment/supporting evidence, or a wet-signed original). A throw in the delivery below
    // must not leave the row PENDING, or the same bytes can be answered a second time and end up
    // linked to a second, incompatible target.
    await this.resolvePendingRow(pending.id, 'RESOLVED_RECEIPT');
    await this.deliverCompletedReply(event, replyText, ctx.companyId, access, badge);
    if (attachedExpenseId) await this.replaceAttachedSubstituteClarification(event, ctx, attachedExpenseId);
    await this.persistIntakeTurn({ event,
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
      await this.deliverReply(event, receiptDeniedReply(access, replyLanguage(event)));
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
        this.captureOwnerMetadata(event, pending.lineMessageId),
      ));
    }
    const pdfReading = pending.mimeType === 'application/pdf';
    if (pdfReading) {
      const saved = await this.expenseRepo.findByIdWithRelations(companyId, expenseId, undefined, access.scopes);
      if (!saved || saved.createdByUserId !== userId || saved.captureSource !== 'LINE_UPLOAD'
        || saved.primaryAttachmentId !== pending.attachmentId
        || saved.sourceChannelMetadataJson?.chatKeyHash !== chatKeyHashOf(event)) throw new ForbiddenException('Receipt is outside your capture scope.');
      const attachment = await this.prisma.client.attachmentObject.findFirst({
        where: { id: pending.attachmentId, companyId, uploadedByUserId: userId, status: 'ACTIVE' },
        select: { checksumSha256: true },
      });
      if (!attachment || !this.captureLine) throw new ConflictException('The original receipt attachment is unavailable.');
      await this.captureLine.queueExpenseRead({ companyId, expenseId, attachmentId: pending.attachmentId,
        attachmentChecksum: attachment.checksumSha256, expectedSourceUpdatedAt: saved.updatedAt });
    }
    let additionalReply: string | undefined;
    let pendingQuestion: string | undefined;
    if (additionalText && this.substituteReceiptContinuation && isSubstituteReceiptConversationText(additionalText)) {
      try {
        const continuation = await this.substituteReceiptContinuation.execute({
          requestId, authSubject: userId, userId, companyId,
          membershipId: access.membershipId, roles: access.roles, permissions: access.permissions,
          scopes: access.scopes, authProvider: 'line',
        }, { language: replyLanguage(event),
          messageText: additionalText,
          chatKeyHash: chatKeyHashOf(event),
          recentCandidates: [{ id: expenseId, label: (replyLanguage(event) === 'en' ? `Newly saved expense ${expenseId}` : `รายการที่เพิ่งบันทึก ${expenseId}`) }],
          webBaseUrl: this.config.webBaseUrl,
        });
        await this.rememberSubstituteDeliverySource(event, { requestId, authSubject: userId, userId, companyId,
          membershipId: access.membershipId, roles: access.roles, permissions: access.permissions, scopes: access.scopes, authProvider: 'line' }, continuation);
        additionalReply = continuation.replyText;
        pendingQuestion = continuation.pendingQuestion;
      } catch (error) {
        this.logger.warn({ msg: 'line_substitute_continuation_additional_outcome_failed', requestId, ...safeLineErrorDetails(error) });
        additionalReply = SUBSTITUTE_ADDITIONAL_OUTCOME_DEGRADED;
      }
    }
    const summary = pdfReading
      ? { texts: [this.fileStoredReply(this.expenseCaptureLink(companyId, expenseId), replyLanguage(event))], draft: undefined }
      : await this.savedReceiptReply(event, companyId, expenseId);
    const receiptReply = summary.texts.join('\n');
    const reply = additionalReply ? `${receiptReply}\n\n${SUBSTITUTE_ADDITIONAL_OUTCOME_LABEL}\n${additionalReply}` : receiptReply;
    // The review card is the receipt's own summary; a reply that also reports the substitute work keeps the card that shows its text.
    await this.deliverCompletedReply(event, reply, companyId, access, undefined,
      additionalReply || pdfReading ? undefined : await this.receiptReviewCard(event, reply, summary.draft, companyId), pdfReading ? 'reading' : undefined);
    await this.prisma.client.lineIntakePendingMedia.updateMany({
      where: { id: pending.id, status: 'PENDING' },
      data: { status: 'RESOLVED_RECEIPT' },
    });
    await this.recordDeliveredReceiptContinuation(event, companyId, userId, expenseId, access.scopes);
    await this.persistIntakeTurn({ event,
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
  private async requestedCaptureConfirmation(event: LineTextEvent, ctx: RequestContext, expenseId: string, text: string, withholding = false): Promise<LineReplyMessage | null> {
    if (!withholding && !this.retainedTaskSources.get(event)?.source.semanticSubrequest.goal.match(/^บันทึก(?:ค่าใช้จ่าย|รายจ่าย|ค่าจ้าง)/u) && !/(?:ยืนยัน(?:เลย|ด้วย|ให้)|พร้อมยืนยัน|confirm)/iu.test(text) || /(?:ไม่|อย่า|ยังไม่)\s*ยืนยัน/u.test(text) || !this.expenseActions) return null;
    if (withholding && !ctx.permissions.includes('expense.confirm')) return null;
    const paid = /(?:จ่าย|ชำระ)(?:เงินสด|ด้วยเงินสด|เงิน|ด้วยบัตร|บัตร|โอนไป)?แล้ว|โอนแล้ว/u.test(text) && !/(?:ยังไม่|ไม่ได้|ยังไม่ได้)\s*(?:จ่าย|ชำระ|โอน)/u.test(text);
    const paymentMethod = /เงินสด/u.test(text) ? 'CASH' : /โอน/u.test(text) ? 'BANK_TRANSFER' : /บัตร/u.test(text) ? 'CARD' : /เช็ค|เช็ก/u.test(text) ? 'CHEQUE' : undefined;
    const result = await this.expenseActions.preview(ctx, chatKeyHashOf(event), { action: 'CONFIRM', expenseId,
      ...(paid && !withholding ? { recordPaymentAfterConfirm: true, ...(paymentMethod ? { paymentMethod } : {}), paidAt: todayCivilDate('Asia/Bangkok') } : {}) }, true, undefined, replyLanguage(event));
    if (result.preview) {
      this.deliveryExpenseActions.set(event, { context: ctx, chat: chatKeyHashOf(event), requestId: ctx.requestId, preview: result.preview });
      return buildExpenseActionCard(result.preview, undefined, replyLanguage(event), this.config?.webBaseUrl);
    }
    const card = buildLineAssistantTextCardMessage(result.reply, this.config.webBaseUrl, ctx.companyId, undefined, undefined, replyLanguage(event));
    const choices = await this.expenseActions.repairChoices(ctx, chatKeyHashOf(event), undefined, replyLanguage(event));
    if (choices?.length) card.quickReply = lineChoiceQuickReply(choices);
    else if (result.webPath) {
      const uri = absoluteWebLink(this.config.webBaseUrl, result.webPath);
      if (uri.startsWith('https://')) card.quickReply = { items: [{ type: 'action', action: { type: 'uri',
        label: result.webPath === '/system/wht-income-categories' ? (replyLanguage(event) === 'en' ? "Set income category" : 'ตั้งค่าประเภทเงินได้') : (replyLanguage(event) === 'en' ? "Review record" : 'เปิดตรวจรายการ'), uri } }] };
    }
    return card;
  }

  private async recentEditableChoices(ctx: RequestContext, recent: LineIntakeCorrectionCandidate[], drafts: LineExpenseDraftRouteContext[], features: Set<string> | null, language: 'th' | 'en' = 'th'): Promise<Array<{ label: string; text: string; uri?: string }>> {
    const choices: Array<{ label: string; text: string; uri?: string }> = [];
    if ((features === null || features.has('expenses')) && ctx.permissions.includes('expense.update')) {
      const seen = new Set<string>();
      for (const row of [...drafts.map(draft => ({ id: draft.expenseId, label: draft.label, amount: undefined })), ...recent.map(row => ({ ...row, label: correctionCandidateLabel(row, language) }))]) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const label = scrubRecordText(row.label, 120);
        choices.push({ label: row.amount ? `${row.amount} ${language === 'en' ? 'THB' : 'บาท'} · ${label}` : label, text: language === 'en' ? `Edit expense ${label}` : `ขอแก้รายการ ${label}` });
      }
      if (choices.length < 4 && this.editableExpenses) {
        try {
          for (const status of ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'] as const) {
            const page = await this.editableExpenses.execute(ctx, { status, page: 1, pageSize: 4 });
            for (const row of page.data) {
              if (seen.has(row.id) || row.status !== status || (!ctx.permissions.includes('expense.review') && row.createdByUserId !== ctx.userId)) continue;
              seen.add(row.id);
              const label = [scrubRecordText(row.vendorNameSnapshot, 60) || (language === 'en' ? 'Expense' : 'รายจ่าย'), formatReplyDate(row.expenseDate.toISOString(), language), `${row.grandTotalAmount} ${language === 'en' ? 'THB' : 'บาท'}`].join(' · ');
              // Company records keep the web editor's guards; chat-local edits retain their existing signed preview.
              choices.push({ label, text: language === 'en' ? `Edit expense ${label}` : `ขอแก้รายการ ${label}`, uri: absoluteWebLink(this.config.webBaseUrl, `/companies/${ctx.companyId}/expenses/${row.id}`) });
              if (choices.length >= 4) break;
            }
            if (choices.length >= 4) break;
          }
        } catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
      }
    }
    if (choices.length < 4 && (ctx.permissions.includes('reimbursement.update_own_draft') || ctx.permissions.includes('reimbursement.finance_review')) && this.editableClaims) {
      try {
        const page = await this.editableClaims.execute(ctx, { scope: ctx.permissions.includes('reimbursement.finance_review') ? 'all' : 'own', status: 'DRAFT', page: 1, pageSize: 4 });
        for (const row of page.items) if ((row.requesterUserId === ctx.userId || ctx.permissions.includes('reimbursement.finance_review')) && row.status === 'DRAFT') {
          const label = scrubRecordText(row.requestNo || row.title || row.reason, 100);
          choices.push({ label: language === 'en' ? `Claim ${label}` : `ใบเบิก ${label}`, text: language === 'en' ? `Edit claim ${label}` : `ขอแก้ไขใบเบิก ${label}` });
        }
      } catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
    }
    if (choices.length < 4 && (features === null || features.has('expenses') || features.has('sales_documents')) && ctx.permissions.includes('accounting.counterparty.read') && this.editableCounterparties) {
      const page = await this.editableCounterparties.execute(ctx, 1, 4);
      for (const row of page.data) {
        const detail = await this.getEditableCounterparty.execute(ctx, row.id);
        if (!detail.canEdit) continue;
        const label = scrubRecordText(row.displayName, 100);
        choices.push({ label: language === 'en' ? `Supplier ${label}` : `คู่ค้า ${label}`, text: language === 'en' ? `Edit supplier ${label}` : `ขอแก้ไขคู่ค้า ${label}` });
      }
    }
    return choices.slice(0, 4);
  }

  private async explainLockedExpenseEdit(event: LineTextEvent, ctx: RequestContext, access: { permissions: string[]; roles: string[] }, targetId: string | undefined, editable: LineIntakeCorrectionCandidate[], vendorName?: string): Promise<boolean> {
    let reply: string | undefined, label = (replyLanguage(event) === 'en' ? "Review expense" : 'เปิดตรวจสอบรายจ่าย'), id: string | undefined;
    let offerVoid = false;
    const namedVendor = vendorName?.trim() && event.messageText.includes(vendorName.trim()) ? vendorName.trim() : undefined;
    if (!ctx.permissions.includes('expense.update')) {
      reply = (replyLanguage(event) === 'en' ? "Ask the shop owner or an authorized expense editor to edit this record." : 'ให้เจ้าของกิจการหรือผู้มีสิทธิ์แก้ไขรายจ่ายแก้รายการนี้ค่ะ');
    } else if ((!targetId && namedVendor) || (targetId && !editable.some(row => row.id === targetId)) || (!targetId && !editable.length)) {
      // A finalized row is read through the web guard; never mistake an empty EDITABLE list for absence.
      const rows = this.expenseRepo ? await listRecentLineCaptureCandidates(this.expenseRepo, { companyId: ctx.companyId, userId: ctx.userId,
        chatKeyHash: chatKeyHashOf(event), scopes: ctx.scopes ?? {}, take: 5, includeAllStatuses: true,
        ...(targetId ? { expenseIds: [targetId] } : {}) }) : [];
      id = targetId ?? (rows.length === 1 ? rows[0]!.id : undefined);
      if (!this.getLinkedExpense) return false;
      try {
        if (!targetId && namedVendor) {
          const candidates = [];
          for (const row of rows) {
            try {
              const record = await this.getLinkedExpense.execute(ctx, row.id);
              if (record.vendorNameSnapshot) candidates.push({ id: row.id, name: normalizeVendorName(record.vendorNameSnapshot) });
            } catch (error) { if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) throw error; }
          }
          const match = resolveNameCandidate(normalizeVendorName(namedVendor), candidates, VENDOR_NAME_STRIP_PREFIXES);
          id = match.kind === 'resolved' ? match.id : undefined;
        }
        if (!id) return false;
        const record = await this.getLinkedExpense.execute(ctx, id);
        if (record.status !== 'CONFIRMED') return false;
        const capability = await this.getLinkedExpense.correctionCapabilities(ctx, id);
        reply = capability.canReopen
          ? (replyLanguage(event) === 'en' ? "This expense is confirmed; reopen its document on the web to review and confirm changes." : 'รายการนี้ยืนยันแล้ว ให้เปิดแก้ไขเอกสารบนเว็บเพื่อตรวจและยืนยันใหม่ค่ะ')
          : (replyLanguage(event) === 'en' ? 'This record is locked; review the available correction options on the web.' : `${expenseReopenBlockerMessages(capability)[0] ?? 'รายการนี้ล็อกการแก้ไขแล้ว กรุณาเปิดตรวจสอบทางแก้บนเว็บ'}ค่ะ`);
        label = capability.canReopen ? (replyLanguage(event) === 'en' ? "Edit on web" : 'แก้ไขเอกสารบนเว็บ') : (replyLanguage(event) === 'en' ? "Review options on web" : 'ตรวจทางแก้บนเว็บ');
        if (record.paymentStatus === 'PAID') reply = (replyLanguage(event) === 'en' ? "This expense is confirmed and paid; its original amount cannot be edited directly." : 'รายการนี้ยืนยันและจ่ายแล้ว จึงแก้ยอดเดิมโดยตรงไม่ได้ค่ะ');
        if (ctx.permissions.includes('expense.void') && this.previewEditVoid) {
          try {
            await this.previewEditVoid.previewLineAction(ctx, id, (replyLanguage(event) === 'en' ? "Correct recorded details" : 'แก้ไขข้อมูลที่บันทึกผิด'));
            offerVoid = true;
          } catch (error) { if (!(error instanceof HttpException)) throw error; }
        }
      } catch (error) {
        if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) throw error;
        reply = (replyLanguage(event) === 'en' ? "Ask the shop owner or an authorized expense editor to review and correct this record." : 'ให้เจ้าของกิจการหรือผู้มีสิทธิ์แก้ไขรายจ่ายตรวจและแก้รายการนี้ค่ะ');
        id = undefined;
      }
    }
    if (!reply) return false;
    const path = `/companies/${ctx.companyId}/expenses${id ? `/${id}` : ''}`;
    const response: LineAiTurnResponse = { requestId: ctx.requestId, replyText: reply, sourceRefs: [], sourceLabels: [], webLinks: [],
      intent: 'unknown', agent: 'general', refused: false, toolsInvoked: [], toolCalls: [], durationMs: 0,
      presentation: { kind: 'answer_cards', cards: [{ text: reply, webLink: { label, path } }] } };
    const card = buildLineBusinessAnswerMessage(response, reply, this.config.webBaseUrl, ctx.companyId, undefined, replyLanguage(event));
    if (offerVoid) card.quickReply = { items: [{ type: 'action', action: { type: 'uri', label: (replyLanguage(event) === 'en' ? "Void and recreate" : 'ยกเลิกและสร้างใหม่'), uri: absoluteWebLink(this.config.webBaseUrl, path) } }] };
    await this.deliverCompletedReply(event, reply, ctx.companyId, access, undefined, card);
    await this.persistIntakeTurn({ event, userId: ctx.userId, companyId: ctx.companyId, webhookEventId: event.webhookEventId,
      userMessagePreview: event.messageText, replyText: reply, intent: 'CORRECTION' });
    await this.updateEventLog(event.webhookEventId, 'correction_guidance', undefined, ctx.companyId);
    return true;
  }

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
      const docType = row.sourceDocumentType ? SOURCE_DOC_TYPE_REPLY_LABELS[row.sourceDocumentType] ?? 'เอกสารค่าใช้จ่าย' : 'เอกสารค่าใช้จ่าย';
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

  private async saveRecentUtilityBill(
    event: LineTextEvent, ctx: RequestContext, recent: LineIntakeCorrectionCandidate[], command: string,
  ): Promise<string> {
    if (!this.expenseRepo) return (replyLanguage(event) === 'en' ? "The bill could not be saved from the earlier photo; open the expense list on the web." : 'ยังบันทึกใบแจ้งจากรูปเดิมไม่ได้ค่ะ กรุณาเปิดรายการค่าใช้จ่ายในเว็บแอป');
    const requestedPeriod = mapThaiDigits(command).match(/\b\d{1,2}\s*[/.-]\s*(?:\d{2}|\d{4})\b/u)?.[0];
    const candidates: Array<{ source: ExpenseRecordWithRelations; bill: NonNullable<ReceiptOcrResponse['utilityDocuments']>[number] }> = [];
    for (const item of recent) {
      if (item.sourceDocumentType !== 'RECEIPT') continue;
      const source = await this.expenseRepo.findByIdWithRelations(ctx.companyId, item.id, undefined, ctx.scopes ?? {});
      if (!source || source.createdByUserId !== ctx.userId || source.captureSource !== 'LINE_UPLOAD'
        || source.sourceChannelMetadataJson?.chatKeyHash !== chatKeyHashOf(event)
        || !isBranchInScope(ctx.scopes ?? {}, source.branchId)
        || !source.primaryAttachmentId
        || !source.attachments.some(link => link.id === source.primaryAttachmentId && link.purpose === 'expense.receipt.primary')) continue;
      const bill = savedUtilityBill(source);
      if (bill && (!requestedPeriod || utilityMonthIndex(requestedPeriod) === utilityMonthIndex(bill.period))) candidates.push({ source, bill });
    }
    if (candidates.length !== 1) return candidates.length > 1
      ? (replyLanguage(event) === 'en' ? "Several utility bills are in this chat; please identify the billing period to record." : 'พบรูปบิลค่าน้ำ/ค่าไฟหลายรูปในแชทนี้ กรุณาระบุงวด เช่น “บันทึกใบแจ้งค่าน้ำงวด 09/69” ค่ะ')
      : (replyLanguage(event) === 'en' ? "No readable utility bill with a billing period was found in this chat; please resend the photo." : 'ยังไม่พบใบแจ้งค่าน้ำ/ค่าไฟจากรูปที่อ่านแยกงวดได้ในแชทนี้ กรุณาส่งรูปอีกครั้งค่ะ');
    const { source, bill } = candidates[0]!;
    const utilityKind = /(?:ค่าน้ำ|ประปา)/u.test(bill.titleEvidence) ? 'ค่าน้ำ' : 'ค่าไฟ';
    if (!requestedPeriod && recent[0]?.id !== source.id) {
      return (replyLanguage(event) === 'en' ? `Another document followed this ${utilityKind} image; if you mean the bill for period ${bill.period} ask to save the utility bill ${utilityKind} for period ${bill.period}”` : `มีเอกสารอื่นส่งต่อจากรูป${utilityKind}แล้วค่ะ หากหมายถึงใบแจ้งงวด ${bill.period} ให้พิมพ์ “บันทึกใบแจ้ง${utilityKind}งวด ${bill.period}”`);
    }
    const amount = toMoney4(mapThaiDigits(bill.amount).replace(/,/gu, ''));
    await assertExpenseRootOpen(this.launchGate, this.audit, ctx, 'expense.create');
    let inserted = false;
    const saved = await this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT id FROM "ExpenseRecord" WHERE id = ${source.id} AND "companyId" = ${ctx.companyId} FOR SHARE`;
      const current = await this.expenseRepo!.findByIdWithRelations(ctx.companyId, source.id, tx, ctx.scopes ?? {});
      if (!current || current.updatedAt.getTime() !== source.updatedAt.getTime()
        || current.primaryAttachmentId !== source.primaryAttachmentId || !savedUtilityBill(current)
        || !current.attachments.some(link => link.id === source.primaryAttachmentId && link.purpose === 'expense.receipt.primary')
        || current.createdByUserId !== ctx.userId || current.sourceChannelMetadataJson?.chatKeyHash !== chatKeyHashOf(event)) {
        throw new ConflictException('The source bill changed. Please review the original record.');
      }
      await tx.$executeRaw`SELECT id FROM "AttachmentObject" WHERE id = ${source.primaryAttachmentId!} AND "companyId" = ${ctx.companyId} FOR SHARE`;
      const attachment = await tx.attachmentObject.findFirst({ where: {
        id: source.primaryAttachmentId!, companyId: ctx.companyId, status: 'ACTIVE',
      }, select: { id: true } });
      if (!attachment) throw new ConflictException('The source image is unavailable.');
      const created = await this.expenseRepo!.createExpense({
        companyId: ctx.companyId, branchId: source.branchId ?? undefined,
        draftIdempotencyKey: `utility-bill:${source.id}`,
        draftPayloadHash: createHash('sha256').update(JSON.stringify([source.id, bill.period, amount, source.primaryAttachmentId])).digest('hex'),
        draftReplayScopes: ctx.scopes ?? {},
        captureSource: 'LINE_UPLOAD', expenseDate: civilDateToUtcDate(todayCivilDate()), currency: 'THB',
        vatMode: 'NEEDS_REVIEW', inputVatClaimStatus: 'NEEDS_REVIEW',
        note: (replyLanguage(event) === 'en' ? `${bill.titleEvidence} for period ${bill.period}` : `${bill.titleEvidence} งวด ${bill.period}`).slice(0, 240),
        createdByUserId: ctx.userId, lineEventId: event.webhookEventId,
        sourceDocumentType: 'SUPPLIER_BILL', taxEvidenceStatus: 'NEEDS_REVIEW',
        taxEvidenceReasonCode: 'UNREADABLE_OR_LOW_CONFIDENCE', aiVerificationStatus: 'NEEDS_REVIEW',
        sourceChannelMetadataJson: { channel: 'LINE', kind: 'utility_bill_followup', chatKeyHash: chatKeyHashOf(event), sourceReceiptExpenseId: source.id },
        aiVerificationSummaryJson: {
          status: 'OCR_EXTRACTED_NEEDS_REVIEW', recognizedFields: { description: bill.titleEvidence, grandTotalAmount: amount },
          utilityDocuments: [bill], missingFields: ['vendor', 'expenseDate', 'documentNumber', 'vatAmount', 'category'],
          dateStatus: 'unknown', nextAction: 'review_in_web',
        },
        subtotalAmount: amount, discountAmount: '0', taxableAmount: amount, vatAmount: '0', whtAmount: '0',
        grandTotalAmount: amount, netPayableAmount: amount, outstandingAmount: amount,
      }, async (db, record) => {
        inserted = true;
        await this.expenseRepo!.linkAttachment(record.id, source.primaryAttachmentId!, 'expense.receipt.primary', ctx.companyId, ctx.userId, db);
        await db.expenseRecord.update({ where: { id: record.id }, data: { primaryAttachmentId: source.primaryAttachmentId } });
        await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.create',
          targetType: 'expense_record', targetId: record.id, requestId: ctx.requestId, result: 'SUCCESS',
          riskLevel: 'MEDIUM', metadataJson: { captureSource: 'LINE_UPLOAD', sourceReceiptExpenseId: source.id, documentType: 'SUPPLIER_BILL' } }, db);
      }, tx);
      return created;
    });
    const currentSource = await this.expenseRepo.findByIdWithRelations(ctx.companyId, source.id, undefined, ctx.scopes ?? {});
    const currentBill = await this.expenseRepo.findByIdWithRelations(ctx.companyId, saved.id, undefined, ctx.scopes ?? {});
    if (!currentSource || !currentBill) throw new ConflictException('The saved bill is unavailable.');
    this.rememberReceiptDeliverySource(event, ctx, currentSource);
    this.rememberReceiptDeliverySource(event, ctx, currentBill);
    return (replyLanguage(event) === 'en' ? `${inserted ? 'Saved' : 'Existing'} utility bill draft ${utilityKind} for period ${bill.period} ${bill.amount} THB${inserted ? '' : ''}.
No payment was recorded; review the details and VAT on the web, and attach the period’s receipt to this draft before review to avoid duplicates: ${absoluteWebLink(this.config.webBaseUrl, `/companies/${ctx.companyId}/expenses/${saved.id}`)}` : `${inserted ? '✅ บันทึก' : '✅ มี'}ร่างบิล${utilityKind}งวด ${bill.period} ${bill.amount} บาท${inserted ? 'แล้ว' : 'อยู่แล้ว'}ค่ะ\nยังไม่ชำระและยังไม่บันทึกการจ่ายเงิน กรุณาตรวจข้อมูลและ VAT ในเว็บแอป หากจะเก็บใบเสร็จงวดนี้กับรายการเดิม ให้แนบขณะยังเป็นร่างก่อนส่งตรวจ เพื่อไม่ให้เกิดรายการซ้ำ: ${absoluteWebLink(this.config.webBaseUrl, `/companies/${ctx.companyId}/expenses/${saved.id}`)}`);
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
    lineCapture?: Record<string, unknown>,
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
      ...(chatKeyHash ? { sourceChannelMetadataJson: { channel: 'LINE', kind: 'pending_media', chatKeyHash, ...lineCapture } } : {}),
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
    /** Advisor spec §2.2: the reader holds `company.plan.manage`; only they are shown the way to buy. */
    canManagePlan: boolean,
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
      ? receiptQuotaExceededTextTh(limit, tierKey, cadence, 'monthlyAllowance' in snapshot, canManagePlan)
      : receiptQuotaExceededShortTextTh(limit, tierKey, cadence, 'monthlyAllowance' in snapshot, canManagePlan);
    let delivered = true;
    try {
      if (first) await this.deliverRequiredMessages(event, [buildReceiptQuotaExceededMessage(text, canManagePlan, replyLanguage(event))]);
      else await this.deliverReply(event, text, undefined, undefined, 'notTaken');
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
    onePassReceipt?: LineIntakeRoutePlan['onePassReceipt'],
    admissionAttempt?: LineReceiptAdmissionAttempt,
    /** A reader-only photo is admitted by the reader, so a crash replay resumes there, as the router's would. */
    retryWebhookEventId?: string,
    /** A photo accepted before the AI credit ran out (`LineReceiptUploadEvent.admitOverCap`). */
    admitOverCap?: boolean,
  ): Promise<ReceiptOcrPreflight> {
    if (!media.contentBase64 || (media.mimeType !== 'image/jpeg' && media.mimeType !== 'image/png' && media.mimeType !== 'application/pdf')) {
      return { status: 'NOT_REQUESTED', fields: null, classification: null };
    }
    if (routeOcrErrorCode) {
      return { status: 'OCR_FAILED', fields: null, classification: null, errorCode: routeOcrErrorCode };
    }
    // The gateway already ran the receipt parser and evidence/business gates inside the image
    // intake call. Short-circuit BEFORE listing categories and BEFORE requestReceiptOcr, so this
    // path creates no second reservation, provider call or OCR admission.
    if (onePassReceipt?.fields && onePassReceipt.classification) {
      this.logger.log({ msg: 'receipt.ocr.one_pass', requestId: ctx.requestId, attachmentId });
      return {
        status: 'OCR_EXTRACTED_NEEDS_REVIEW',
        fields: onePassReceipt.fields,
        classification: onePassReceipt.classification,
        processingPath: 'one_pass',
      };
    }
    try {
      const activeCategories = this.expenseRepo
        ? aiSelectableExpenseCategories(await this.expenseRepo.listCategories(ctx.companyId)).map((category) => ({ id: category.id, name: category.name }))
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
        ...(retryWebhookEventId ? { retryWebhookEventId } : {}),
        ...(admitOverCap ? { admitOverCap: true } : {}),
        busyWaitDeadlineMs: Date.now() + LINE_AI_LIVE_BUSY_WAIT_MS });
      if (result.fallbackReasons?.length) {
        this.logger.warn({
          msg: 'receipt.ocr.fallback_used', requestId: ctx.requestId, attachmentId,
          reasons: result.fallbackReasons,
        });
      }
      if (result.status === 'not_configured') return { status: 'NOT_CONFIGURED', fields: null, classification: null,
        processingPath: 'receipt_ocr', ...(result.fallbackReasons?.length ? { fallbackReasons: result.fallbackReasons } : {}) };
      if (result.status !== 'ok') {
        // The SCOPE travels with the code (spec §9.1 / B-01). `ReceiptOcrResponse.budgetScope` is
        // set whenever `errorCode` is one of ours — which is how a chain the GATEWAY refused
        // mid-way (E1c `budget-step` said no at ordinal >= 1) reports which ceiling it hit. Only
        // the thrown-429 path below used to carry it, so a gateway-reported money refusal reached
        // the terminal row and `line.ai.terminal` with `budgetScope` absent and CHAT/OCR/TOTAL
        // indistinguishable.
        return { status: 'OCR_FAILED', fields: null, classification: null,
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
          ...(result.budgetScope ? { budgetScope: result.budgetScope } : {}),
          ...(result.fallbackReasons?.length ? { fallbackReasons: result.fallbackReasons } : {}),
          processingPath: 'receipt_ocr' };
      }
      return {
        status: 'OCR_EXTRACTED_NEEDS_REVIEW',
        fields: result.fields ?? null,
        classification: result.classification ?? null,
        ...(result.utilityDocuments ? { utilityDocuments: result.utilityDocuments } : {}),
        ...(result.fallbackReasons?.length ? { fallbackReasons: result.fallbackReasons } : {}),
        processingPath: 'receipt_ocr',
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

  private async lineMediaRejectionReason(media: DownloadedLineMedia, policy: AttachmentInspectionPolicy = 'STRICT'): Promise<string | null> {
    if (validateAttachmentMeta(media.mimeType, media.byteSize, this.config.uploadMaxBytes)) return 'METADATA_REJECTED';
    if (validateAttachmentFileName(media.fileName, media.mimeType)) return 'EXTENSION_MIME_MISMATCH';
    const inspectionError = inspectAttachmentBytes(media.mimeType, media.bytes, policy);
    if (inspectionError) return attachmentInspectionFailureCode(inspectionError);
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

/** Fixed legacy surface copy; customer facts and authority are never translated here. */
const LEGACY_LINE_COPY_EN = {
  "RECEIPT_BRANCH_REQUIRED_REPLY": "The document was read, but no expense was saved because a branch must be selected; choose it on the web or ask an administrator to set your default branch.",
  "PACKAGE_REQUIRED_MEMBER_REPLY": "This shop needs an active package; ask the owner or an authorized package manager to choose one.",
  "LAUNCH_ROUTE_CLOSED_REPLY": "The assistant is temporarily unavailable; you can continue using the web app.",
  "CAPABILITY_ENTITLEMENT_NOTE": "The Services and Contact buttons remain available in this chat.",
  "ASSISTANT_TALK_GREETING": "Hello, I’m Nong Mangmee; how can I help?",
  "MUTATION_REFUSAL_REPLY": "Please complete approval, payment, final accounting entries or tax filing on the web.",
  "MEDIA_UNSUPPORTED_REPLY": "Send expense evidence to prepare a draft, or a signature photo to save a reusable signature; review final actions on the web.",
  "MEDIA_SECURITY_REJECTED_REPLY": "This file could not be accepted; send an undamaged PDF or supported image that passes the security check.",
  "LINE_AI_ROUTE_TRANSIENT_REPLY": "The answer is taking longer than usual; please send the same question again.",
  "LINE_AI_ROUTE_UNCLEAR_REPLY": "Please rephrase what you would like to check, such as monthly expenses or expenses by category.",
  "MEDIA_NOT_RECORDED_REPLY": "The image is kept without being recorded as evidence for an expense.",
  "TEXT_EXPENSE_AMOUNT_ONLY_REPLY": "What was the expense amount?",
  "TEXT_EXPENSE_PURPOSE_ONLY_REPLY": "What was the expense for?",
  "TEXT_EXPENSE_AMOUNT_CONFLICT_REPLY": "There are several amounts in this conversation and no expense has been created; specify the replacement amount if you want to change it.",
  "EXACT_GREETING_REPLY": "Hello, how can I help?",
  "REIMBURSEMENT_CLARIFY_ONLY_REPLY": "You want to claim back an expense paid personally; no claim was created, and the web handoff is currently unavailable.",
  "REIMBURSEMENT_HANDOFF_REPLY": "No claim has been created; open the claim page on the web, review the details, and save it there."
} as const;
