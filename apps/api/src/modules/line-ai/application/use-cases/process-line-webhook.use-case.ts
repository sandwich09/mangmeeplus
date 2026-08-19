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
import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditService } from '../../../audit/application/audit.service';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';
import { AiGatewayClient } from '../../infrastructure/ai-gateway.client';
import { LineReplyAdapter, type LineDeliveryResult } from '../../infrastructure/line-reply.adapter';
import {
  InitReceiptUploadUseCase,
  CompleteReceiptUploadUseCase,
} from '../../../expenses/application/use-cases/expense-upload.use-case';
import { reconcileExpenseDuplicateCandidates } from '../../../expenses/application/services/expense-duplicate-detection';
import { CaptureLineExpenseNoteUseCase, LineTextExpenseCaptureIncompleteError } from '../../../expenses/application/use-cases/expense-document.use-case';
import { CorrectLineCapturedExpenseUseCase } from '../../../expenses/application/use-cases/line-correction.use-case';
import { isSubstituteReceiptConversationText, LineSubstituteReceiptContinuationUseCase, type LineSubstituteReceiptContinuationResult } from '../../../expenses/application/use-cases/line-substitute-receipt-continuation.use-case';
import { LineExpenseDraftConversationUseCase } from '../../../expenses/application/use-cases/line-expense-draft-conversation.use-case';
import { isDeterministicLineExpenseDraftInput } from '../../../expenses/domain/logic/line-expense-draft-conversation.logic';
import { InitSignatureUploadUseCase, CreateSignatureAssetUseCase } from '../../../expenses/application/use-cases/signature-asset.use-case';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import type { ExpenseRecordWithRelations } from '../../../expenses/domain/models/expense.model';
import { CreateUploadIntentUseCase } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { CompleteAttachmentUploadUseCase } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { resolveCreateBranchId } from '../../../data-model-core/domain/logic/branch.logic';
import {
  canonicalAttachmentExtension,
  inspectAttachmentBytes,
  normalizeAttachmentMimeType,
  validateAttachmentFileName,
  validateAttachmentMeta,
} from '../../../data-model-core/domain/logic/attachment.logic';
import { AttachmentMalwareScanner } from '../../../data-model-core/infrastructure/attachment-malware-scanner';
import { deriveTaxEvidence, isExpenseExtractionEligible, sourceDocumentTypeFromClassification, toSourceDocumentType } from '../../../expenses/domain/logic/expense-document.logic';
import { isStaleOcrApply, ReceiptOcrApplyService, toMoney4 } from '../../../expenses/application/services/receipt-ocr-apply.service';
import { normalizeLineText, hashMessagePreview, parseBareCompanySelection, parseLineCompanyCommand } from '../../domain/logic/line-ai-classifier.logic';
import type { LineCompanyCommand } from '../../domain/logic/line-ai-classifier.logic';
import { formatRefusal } from '../../domain/logic/line-ai-formatter.logic';
import { loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { ListApprovalQueueUseCase } from '../../../reimbursements/application/use-cases/reimbursement-approval.use-case';
import { ListPurchaseRequestsUseCase } from '../../../procurement/application/use-cases/purchase-request.use-case';
import { ListPurchaseOrdersUseCase } from '../../../procurement/application/use-cases/purchase-order.use-case';
import type { BusinessDocumentClassification, LineExpenseDraftRouteContext, LineUserContext, LineAiTurnRequest, LineAiTurnResponse, LineAiConversationContext, LineAiOpenClarification, LineAiValueCandidates, LineIntakeCorrectionCandidate, LineIntakeRoutePlan, ReceiptOcrFieldResult, RequestContext } from '@watchdog-bms/contracts';
import { LINE_AI_CONTEXT_MAX_TURNS, LINE_AI_CONTEXT_WINDOW_MINUTES, LINE_AI_ERROR_CODES, LINE_CORRECTION_CANDIDATE_LIMIT, LINE_TOOL_REGISTRY, RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE, extractValueCandidates, hasToolPermissions, todayCivilDate } from '@watchdog-bms/contracts';
import { LineAiLedgerService, ledgerKey, type LedgerEntry } from '../line-ai-ledger.service';
import { ConsumptionMarkerUnavailableError, markClarificationsConsumed, type ClarificationConsumption } from '../line-ai-consumption-marker';
import { buildCompanyPickerMessage, buildPendingApprovalCard, buildReceiptCapturePrompt, buildStaffCompletionQuickReply, buildStaffMainMenu, buildStaffQueryMenu, pendingApprovalSurfaceKeys, staffMenuCommand, PENDING_APPROVAL_ITEM_LIMIT, type ApprovalSurfaceKey, type PendingApprovalQueues, type StaffMenuContext } from '../../domain/logic/line-staff-menu.logic';
import { buildLineAssistantTextCardMessage, buildLineBusinessAnswerMessage } from '../../domain/logic/line-business-card.logic';
import { capabilityFollowUpReply, isDeliveredCapabilityFollowUp } from '../../domain/logic/line-ai-capability-follow-up.logic';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { LINE_BUFFER_ORPHAN_REPROCESS_MS } from '../../domain/logic/line-message-buffer.logic';
import { resolveCompanyAiModelPolicy } from '../company-ai-model-policy';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../../common/logger/security-event';
import { LegalAcceptanceService } from '../../../auth/application/legal-acceptance.service';
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
  /** Internal buffer hook: settle any in-flight waiting status before the answer. */
  beforeReply?: () => Promise<void>;
};

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
  /** Internal buffer hook: settle any in-flight waiting status before the answer. */
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
  | { status: 'continue' }
  | { status: 'required'; companyId: string };

const UNLINKED_REPLY = '🔗 กรุณาเชื่อมต่อบัญชี มั่งมีพลัส กับ LINE ก่อนใช้งานนะคะ\nเปิดเว็บแอปเพื่อเชื่อมต่อได้เลยค่ะ';
// PDPA objection route (M-05 register §3.1): the user opted out of AI processing, so the
// turn stops here — before any model, tool, or gateway involvement. Deterministic text.
const AI_OPT_OUT_REPLY = '🤖 คุณปิดการใช้งานผู้ช่วย AI ไว้ ข้อความนี้จึงไม่ถูกประมวลผลด้วย AI ค่ะ\nเปิดใช้งานอีกครั้งได้ที่ เว็บแอป → ตั้งค่า → ความปลอดภัย นะคะ';
export const LEGAL_ACCEPTANCE_REQUIRED_REPLY = '📄 กรุณาเข้าสู่เว็บแอป MangmeePlus เพื่อยอมรับข้อกำหนดการใช้งานและรับทราบนโยบายความเป็นส่วนตัวก่อนใช้งานบริการนี้นะคะ';
const FORBIDDEN_REPLY = '🔒 คุณไม่มีสิทธิ์ใช้งาน LINE AI สำหรับบริษัทนี้ค่ะ';
const ERROR_REPLY = '⏳ ขออภัยค่ะ เกิดข้อผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ';
const RATE_LIMIT_REPLY = '⏳ ระบบกำลังประมวลผลข้อความก่อนหน้า กรุณารอสักครู่แล้วลองใหม่อีกครั้งนะคะ';
const RECEIPT_LINK_REPLY = '🔗 กรุณาเชื่อมต่อบัญชี มั่งมีพลัส กับ LINE ก่อนส่งบิลหรือใบเสร็จนะคะ';
const RECEIPT_FORBIDDEN_REPLY = '🔒 คุณไม่มีสิทธิ์อัปโหลดบิลหรือใบเสร็จผ่าน LINE ค่ะ';
const COMPANY_CONTEXT_FORBIDDEN_REPLY = '🔒 ผู้ใช้หลายบริษัทต้องเป็น OWNER ของทุกบริษัทก่อนเลือกบริบทใน LINE ค่ะ';
const SIGNATURE_FORBIDDEN_REPLY = '🔒 คุณไม่มีสิทธิ์ส่งลายเซ็นบริษัทผ่าน LINE ค่ะ';
const SIGNATURE_NEED_IMAGE_REPLY = '✍️ ต้องการอัปโหลดลายเซ็นใช่ไหมคะ กรุณาส่ง "รูปลายเซ็น" เข้ามาในแชทนี้ได้เลยนะคะ\nระบบจะสร้างคำขอให้เจ้าของกิจการอนุมัติในเว็บก่อนใช้งานค่ะ';
const CLARIFY_REPLY = '🤔 น้องมั่งมียังไม่แน่ใจว่าต้องการทำอะไรกับข้อความ/รูปนี้ค่ะ\n• ถ้าเป็นหลักฐานค่าใช้จ่าย (ใบเสร็จ/สลิป/บิล/สกรีนช็อต) ส่งรูปอีกครั้งพร้อมข้อความ เช่น "บันทึกค่าใช้จ่าย"\n• ถ้าต้องการอัปโหลดลายเซ็นบริษัท ส่งรูปอีกครั้งพร้อมข้อความ เช่น "อัปโหลดลายเซ็น"';
const MUTATION_REFUSAL_REPLY = '🔒 น้องมั่งมีไม่สามารถทำรายการอนุมัติ/จ่ายเงิน/ลงบัญชี/ยื่นภาษี หรือเปิดใช้ลายเซ็นได้ค่ะ\nกรุณาทำรายการในเว็บแอป MangmeePlus นะคะ';
const MEDIA_UNSUPPORTED_REPLY = 'ℹ️ ระบบรองรับ: ส่งรูป/ไฟล์หลักฐานค่าใช้จ่ายเพื่อบันทึกร่าง หรือส่งรูปลายเซ็นเพื่อขออนุมัติใช้งานค่ะ\nการยืนยัน/จ่ายเงิน/ลงบัญชีต้องทำในเว็บแอปนะคะ';
const MEDIA_SECURITY_REJECTED_REPLY = '⚠️ ไม่สามารถรับไฟล์นี้ได้ค่ะ กรุณาส่งไฟล์ PDF, PNG, JPG หรือ JPEG ที่ไฟล์ไม่เสียหายและผ่านการตรวจสอบความปลอดภัยนะคะ';
/** RECEIPT-05 (owner decision 2026-07-12): the ONE clarify question asked when media arrives
 *  with a business-question caption, instead of silently discarding the image. */
const MEDIA_CLARIFY_REPLY = [
  '🤔 รูปนี้เป็นอะไรคะ ตอบเลขข้อได้เลยนะคะ',
  '1) ใบเสร็จ/เอกสารค่าใช้จ่ายรายการเดียวที่ต้องการบันทึก',
  '2) ภาพประกอบคำถาม ไม่ต้องบันทึก',
  '3) สรุปหลายรายการ (เก็บไฟล์ไว้ตรวจ แต่ยังไม่สร้างค่าใช้จ่าย)',
].join('\n');
const TEXT_EXPENSE_CLARIFY_REPLY = '🧾 ยังไม่สร้างรายการนะคะ กรุณาระบุยอดเงินและวัตถุประสงค์หรือหมวดค่าใช้จ่ายให้ครบ เช่น “ค่าเดินทาง 200 บาท”';
/** RECEIPT-05: how long a pending media-clarify row waits for the customer's answer. */
const PENDING_MEDIA_TTL_MINUTES = 30;
/** Stands in for the request when a picture arrives with no caption — the file IS the ask. */
const MEDIA_PENDING_REQUEST_TEXT = 'ไฟล์ที่ผู้ใช้ส่งมาโดยยังไม่ได้ระบุคำถาม';
const PENDING_MEDIA_RESOLUTION = Symbol('pendingMediaResolution');

/** Same chatKey the text path and the message buffer use: the group, else the person. */
function mediaChatKey(event: LineReceiptUploadEvent): string {
  return event.pushTargetId ?? event.lineUserId;
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

function formatSignatureTicketReply(webBaseUrl: string | undefined, companyId: string, signatureId: string): string {
  const link = absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses?tab=signatures&signatureId=${signatureId}`);
  return [
    '✍️ รับรูปลายเซ็นแล้ว และสร้างคำขออนุมัติในเว็บให้แล้ว',
    'สถานะ: รอเจ้าของกิจการอนุมัติ (ยังใช้งานลายเซ็นไม่ได้)',
    '',
    `เปิดดูคำขออนุมัติ:\n${link}`,
  ].join('\n');
}

type LineCompanyMembership = {
  companyId: string;
  company?: { name: string; brandName?: string | null } | null;
  roles?: Array<{ role?: { key: string } | null }>;
};

function absoluteWebLink(baseUrl: string | undefined, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = (baseUrl ?? '').replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${suffix}` : suffix;
}

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
export function chatKeyHashOf(event: { lineUserId: string; pushTargetId?: string }): string {
  return hashMessagePreview(event.pushTargetId ?? event.lineUserId);
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

function isOwnerMembership(membership: LineCompanyMembership): boolean {
  return (membership.roles ?? []).some((mr) => mr.role?.key === 'OWNER');
}

function companyLabel(membership: LineCompanyMembership): string {
  return membership.company?.brandName ?? membership.company?.name ?? membership.companyId;
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
  options: { hasDuplicate?: boolean; textOnly?: boolean; amount?: string | null; fields?: ReceiptOcrFieldResult | null; categoryName?: string | null; sourceDocumentType?: string | null } = {},
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
  if (options.textOnly) {
    parts.push('', '📎 ยังไม่มีไฟล์แนบ – กรุณาแนบรูป/PDF ในเว็บก่อนยืนยันถ้าต้องใช้หลักฐาน');
  }
  if (options.hasDuplicate) {
    parts.push('', '⚠️ พบไฟล์ที่อาจซ้ำกับรายการที่มีอยู่ – กรุณาตรวจสอบก่อนยืนยัน');
  }
  parts.push('', `✅ ตรวจสอบและยืนยันในเว็บแอป:\n${link}`);
  return parts.join('\n');
}

export function isGroundedReceiptFollowUp(text: string): boolean {
  const normalized = normalizeLineText(text).toLocaleLowerCase('th-TH');
  const currentReference = /(ใบนี้|ใบเสร็จนี้|เอกสารนี้|รายการนี้|อันนี้|เมื่อกี้)/u.test(normalized);
  const receiptQuestion = /(คืออะไร|ประเภท(?:ไหน|อะไร)|เป็นค่าใช้จ่าย|ลงค่าใช้จ่าย|ใช้กับบริษัท|บันทึก.*บริษัท|vat|ภาษี|เคลม)/iu.test(normalized);
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
): string {
  const fields = receiptSummaryFields(expense);
  const missing = expense.aiVerificationSummaryJson?.['missingFields'];
  const missingFields = Array.isArray(missing) ? missing.filter((item): item is string => typeof item === 'string').slice(0, 10) : [];
  const sourceType = SOURCE_DOC_TYPE_REPLY_LABELS[expense.sourceDocumentType] ?? expense.sourceDocumentType;
  const amount = Number(expense.grandTotalAmount) > 0
    ? Number(expense.grandTotalAmount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : 'ยังไม่ระบุ';
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
 *  Returns companyId or null if the user has no active membership or needs to select company. */
async function resolveCompanyForLineUser(
  prisma: PrismaService,
  userId: string,
  lineUserId: string,
): Promise<{ companyId: string } | { needsSelection: true } | { policyViolation: true } | null> {
  const memberships = await prisma.client.companyMembership.findMany({
    where: { userId, status: 'ACTIVE', company: { status: 'ACTIVE' } },
    select: { companyId: true, roles: { select: { role: { select: { key: true } } } } },
    orderBy: { createdAt: 'asc' },
  });

  if (memberships.length === 0) return null;
  if (memberships.length === 1) return { companyId: memberships[0].companyId };
  if (!memberships.every(isOwnerMembership)) return { policyViolation: true };

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
  const entitled = await loadEntitledFeatureKeys(prisma, companyId);
  return entitled !== null && !entitled.has('ai_line_assistant');
}

export const branchScopeFallbackLabel = (branchIds?: string[]) =>
  branchIds?.length ? `${branchIds.length} สาขา` : 'ทุกสาขา';

/** Money on the approval card. Thai baht is the overwhelming case and reads best with the symbol;
 *  anything else keeps its code, so a foreign-currency claim is never mistaken for baht. */
const formatApprovalAmount = (amount: string, currency: string) => {
  const value = Number(amount);
  const formatted = Number.isFinite(value)
    ? value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : amount;
  return currency === 'THB' ? `฿${formatted}` : `${formatted} ${currency}`;
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
    // Approval-card counts. The SAME use cases the web queue pages call, so the card can only ever
    // state rows this member could open there. Absent → the card links out without a number.
    @Optional() private readonly reimbursementApprovalQueue?: ListApprovalQueueUseCase,
    @Optional() private readonly listPurchaseRequests?: ListPurchaseRequestsUseCase,
    @Optional() private readonly listPurchaseOrders?: ListPurchaseOrdersUseCase,
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
   * Reads the queues behind the "รายการรออนุมัติ" button so the card can answer the question
   * instead of only linking to it. Every read goes through the permission-checked use case the web
   * queue page uses — never a repository — so branch scope, approver eligibility, and self-approval
   * filtering stay identical to what the same person sees on the web.
   *
   * A queue that cannot be read (the lister needs a `read` permission this member lacks, or the
   * query failed) is LEFT OUT rather than reported as zero: "no pending items" and "nobody asked"
   * must not look the same on the card.
   */
  private async loadPendingApprovalQueues(ctx: RequestContext, keys: ApprovalSurfaceKey[]): Promise<PendingApprovalQueues> {
    const queues: PendingApprovalQueues = {};

    if (keys.includes('reimbursement') && this.reimbursementApprovalQueue) {
      try {
        const rows = await this.reimbursementApprovalQueue.execute(ctx);
        queues.reimbursement = {
          total: rows.length,
          items: rows.slice(0, PENDING_APPROVAL_ITEM_LIMIT).map((row) => [
            row.requestNo ?? 'ยังไม่มีเลขที่',
            row.requesterDisplayNameSnapshot,
            formatApprovalAmount(row.amount, row.currency),
          ].join(' · ')),
        };
      } catch (error) {
        this.logger.warn({ msg: 'LINE reimbursement approval queue unavailable', companyId: ctx.companyId, error: (error as Error).message });
      }
    }

    if (keys.includes('procurement') && this.listPurchaseRequests && this.listPurchaseOrders) {
      // Procurement approval is permission + branch scope (no per-step routing), so the pending
      // rows this member can list ARE the rows this member can approve.
      const filter = { status: 'PENDING_APPROVAL', page: 1, pageSize: PENDING_APPROVAL_ITEM_LIMIT };
      const empty = { data: [], total: 0 };
      try {
        const requests = ctx.permissions.includes('procurement.purchase_request.approve')
          ? await this.listPurchaseRequests.execute(ctx, filter)
          : empty;
        const orders = ctx.permissions.includes('procurement.purchase_order.approve')
          ? await this.listPurchaseOrders.execute(ctx, filter)
          : empty;
        queues.procurement = {
          total: requests.total + orders.total,
          items: [
            ...requests.data.map((row) => `ใบขอซื้อ ${row.requestNumber ?? 'ยังไม่มีเลขที่'} · ${formatApprovalAmount(row.grandTotalAmount, row.currency)}`),
            ...orders.data.map((row) => `ใบสั่งซื้อ ${row.purchaseOrderNumber ?? 'ยังไม่มีเลขที่'} · ${formatApprovalAmount(row.grandTotalAmount, row.currency)}`),
          ],
        };
      } catch (error) {
        this.logger.warn({ msg: 'LINE procurement approval queue unavailable', companyId: ctx.companyId, error: (error as Error).message });
      }
    }

    return queues;
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

  private async refusePendingLegalAcceptance(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string },
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
  }): Promise<LineIntakeRoutePlan> {
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
      });
    } catch (err) {
      this.logger.warn({ msg: 'LINE intake route unavailable', requestId: input.requestId, error: (err as Error).message });
      return { status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0, errorCode: 'ROUTER_UNREACHABLE' };
    }
  }

  /** Deliver via reply token; on an expired/used token fall back to push so a
   *  queued batch never ends in silence (spec §10). Push consumes OA quota —
   *  the fallback is counted via the `line_push_fallback_used` log line. */
  private async deliverReply(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string },
    text: string,
  ): Promise<void> {
    const result = await this.deliverMessages(event, [this.lineReply.buildTextMessage(text)]);
    if (result !== 'ok') throw new Error(`LINE_DELIVERY_${result.toUpperCase()}`);
  }

  private async deliverRequiredMessages(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string },
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
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string },
    text: string,
    companyId: string,
    access: { permissions: string[]; roles: string[] },
  ): Promise<void> {
    await this.deliverRequiredMessages(event, [await this.withCompletionMenu(
      buildLineAssistantTextCardMessage(text, this.config.webBaseUrl, companyId),
      companyId,
      access,
    )]);
  }

  private async deliverCompletedReplies(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string },
    texts: string[],
    companyId: string,
    access: { permissions: string[]; roles: string[] },
  ): Promise<void> {
    if (texts.length === 0 || texts.length > 5) throw new Error('LINE_EXPENSE_DRAFT_REPLY_PARTS_INVALID');
    const messages = texts.map((text) => this.lineReply.buildTextMessage(text));
    messages[messages.length - 1] = await this.withCompletionMenu(messages[messages.length - 1]!, companyId, access);
    await this.deliverRequiredMessages(event, messages);
  }

  private async deliverMessages(
    event: { webhookEventId: string; replyToken: string; lineUserId: string; pushTargetId?: string; beforeReply?: () => Promise<void> },
    messages: LineReplyMessage[],
  ): Promise<LineDeliveryResult> {
    try {
      await event.beforeReply?.();
    } catch (error) {
      // Waiting feedback is cosmetic; it must never block the actual answer.
      this.logger.warn({ msg: 'LINE waiting feedback settlement failed', error: (error as Error).message });
    }
    let result: LineDeliveryResult;
    try {
      result = await this.lineReply.sendReply(event.replyToken, messages);
    } catch (error) {
      this.logger.warn({ msg: 'LINE reply adapter threw unexpectedly', error: (error as Error).message });
      result = 'failed_other';
    }
    if (result === 'failed_token') {
      this.logger.warn({ msg: 'line_push_fallback_used' });
      try {
        result = await this.lineReply.sendPush(event.pushTargetId ?? event.lineUserId, messages);
      } catch (error) {
        this.logger.warn({ msg: 'LINE push adapter threw unexpectedly', error: (error as Error).message });
        result = 'failed_other';
      }
    }
    if (result !== 'ok') {
      await this.updateEventLog(event.webhookEventId, 'delivery_pending', `LINE_DELIVERY_${result.toUpperCase()}`);
    } else {
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
    event: { lineUserId: string; messagingChannelId?: string },
  ): Promise<LineLegalAcceptancePreflight> {
    const identity = await this.resolveLineIdentity(event);
    if (!identity || identity.user.status !== 'ACTIVE') return { status: 'continue' };

    const resolved = await resolveCompanyForLineUser(this.prisma, identity.userId, event.lineUserId);
    if (!resolved || 'needsSelection' in resolved || 'policyViolation' in resolved) {
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
      : { status: 'continue' };
  }

  async execute(event: LineTextEvent): Promise<void> {
    const requestId = randomUUID();

    // 1. Atomically claim the event. The message buffer may have created the
    //    `received` row already; processedAt is the compare-and-set claim marker.
    if (!await this.claimWebhookEvent(event.webhookEventId, event.lineUserId)) {
      this.logger.log({ msg: 'Duplicate webhook event skipped', webhookEventId: event.webhookEventId });
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
      await this.handleCompanyCommand(event, requestId, identity.userId, companyCommand);
      return;
    }

    // 4. Resolve company from membership + LineCompanyContext (NOT channel binding)
    const resolved = await resolveCompanyForLineUser(this.prisma, identity.userId, event.lineUserId);
    if (!resolved) {
      await this.deliverReply(event, UNLINKED_REPLY);
      await this.updateEventLog(event.webhookEventId, 'no_membership', LINE_AI_ERROR_CODES.UNLINKED_USER);
      return;
    }
    if ('policyViolation' in resolved) {
      await this.deliverReply(event, COMPANY_CONTEXT_FORBIDDEN_REPLY);
      await this.updateEventLog(event.webhookEventId, 'company_context_forbidden', LINE_AI_ERROR_CODES.FORBIDDEN);
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
    let resolvedAccess: { membershipId: string; roles: string[]; permissions: string[]; scopes: { branchIds?: string[] } };
    try {
      resolvedAccess = await this.permissionResolver.resolveAccess(identity.userId, companyId);
    } catch {
      await this.deliverReply(event, UNLINKED_REPLY);
      await this.updateEventLog(event.webhookEventId, 'no_membership', LINE_AI_ERROR_CODES.FORBIDDEN);
      return;
    }

    // This check is after server-side company/membership resolution and before feature probes,
    // model routing, ERP tools, conversation persistence, or attachment storage.
    if (await this.refusePendingLegalAcceptance(
      event, identity.userId, companyId, resolvedAccess.membershipId,
    )) return;

    await this.recordShadowTurn(companyId);
    if (await lineAssistantDisabled(this.prisma, companyId)) {
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
    const canCaptureExpense = ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.create']
      .some((perm) => resolvedAccess.permissions.includes(perm));
    const canSubmitSignature = resolvedAccess.permissions.includes('expense.signature.manage');
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

    const menuCommand = staffMenuCommand(event.messageText);
    if (menuCommand) {
      const menuContext: StaffMenuContext = {
        displayName: identity.user.displayName,
        roleLabel: resolvedAccess.roles.join(' · ') || 'พนักงาน',
        branchScopeLabel: menuCommand === 'main'
          ? await this.resolveBranchScopeLabel(companyId, resolvedAccess.scopes.branchIds)
          : branchScopeFallbackLabel(resolvedAccess.scopes.branchIds),
        permissions: resolvedAccess.permissions,
        entitledFeatureKeys: await loadEntitledFeatureKeys(this.prisma, companyId),
        webBaseUrl: this.config.webBaseUrl,
        companyId,
        isOwner: resolvedAccess.roles.includes('OWNER'),
      };
      const message = menuCommand === 'main'
        ? buildStaffMainMenu(menuContext)
        : menuCommand === 'query'
          ? buildStaffQueryMenu(menuContext)
          : menuCommand === 'approval'
            ? buildPendingApprovalCard(menuContext, await this.loadPendingApprovalQueues({
              requestId,
              authSubject: identity.userId,
              userId: identity.userId,
              companyId,
              membershipId: resolvedAccess.membershipId,
              roles: resolvedAccess.roles,
              permissions: resolvedAccess.permissions,
              scopes: resolvedAccess.scopes,
              authProvider: 'line',
            }, pendingApprovalSurfaceKeys(menuContext)))
            : buildReceiptCapturePrompt(menuContext);
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
      const splitReply = splitPendingMediaReply(normalizedText);
      const decision = splitReply?.decision ?? classifyPendingMediaReply(normalizedText);
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
      const reply = `${capabilityFollowUpReply(normalizedText)}${interruption ? `\n\n${interruption}` : ''}`;
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
          const reply = `${formatGroundedReceiptFollowUp(this.config.webBaseUrl, companyId, expense, category?.name)}${interruption ? `\n\n${interruption}` : ''}`;
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
    let substituteInterruption: LineSubstituteReceiptContinuationResult | undefined;
    if (this.substituteReceiptContinuation
      && (isSubstituteReceiptConversationText(normalizedText) || hasSubstituteClarification)) {
      const continuationCtx: RequestContext = {
        requestId, authSubject: identity.userId, userId: identity.userId, companyId,
        membershipId: resolvedAccess.membershipId, roles: resolvedAccess.roles,
        permissions: resolvedAccess.permissions, scopes: resolvedAccess.scopes, authProvider: 'line',
      };
      const result = await this.substituteReceiptContinuation.execute(continuationCtx, {
        messageText: normalizedText,
        chatKeyHash: chatKeyHashOf(event),
        recentCandidates: recentCapturedExpenses.map((candidate) => ({ id: candidate.id, label: candidate.label })),
      });
      const routeSideQuestion = hasSubstituteClarification
        && !isSubstituteReceiptConversationText(normalizedText)
        && isInterveningQuestionText(normalizedText)
        && !result.sideQuestionAnswered;
      if (routeSideQuestion) {
        substituteInterruption = result;
      } else {
        const interruption = await interruptExpenseDraft();
        const replyText = `${result.replyText}${interruption ? `\n\n${interruption}` : ''}`;
        await this.deliverCompletedReply(event, replyText, companyId, resolvedAccess);
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText, intent: 'CLARIFY',
        });
        await this.consumeClarifications(companyId, chatKey, identity.userId, openWaiting,
          openWaiting
            .filter((item) => item.clarifyForIntent === 'SUBSTITUTE_RECEIPT_CONTINUATION')
            .map((item) => item.id),
          'business_answer');
        if (result.pendingQuestion) {
          await this.ledger?.appendSubRequests({
            companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
            userId: identity.userId,
            items: [{
              text: 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ', state: 'waiting_user',
              clarifyQuestion: result.pendingQuestion, intent: 'CLARIFY',
              clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION',
            }],
          });
        }
        await this.updateEventLog(
          event.webhookEventId,
          result.pendingQuestion ? 'clarification_required' : 'completed',
          undefined,
          companyId,
        );
        return;
      }
    }

    const aiOpenClarifications = openClarifications?.filter((item) =>
      !(substituteInterruption && item.clarifyForIntent === 'SUBSTITUTE_RECEIPT_CONTINUATION')
      && !(mediaResumeCapsule && item.pendingMedia));

    // 5.5 LINE Intake Router first: semantic route before any source-module dispatch.
    // Deterministic guards (identity, company, permissions) already ran above.
    const routePlan = await this.tryRouteIntake({
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
    });

    if (routePlan.status === 'ROUTED' && routePlan.intent === 'EXPENSE_DRAFT_CONTINUATION') {
      if (!expenseDraftConversationEnabled) {
        await this.deliverReply(event, TEXT_EXPENSE_CLARIFY_REPLY);
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      if (!canCaptureExpense || !this.expenseDraftConversation) {
        await this.deliverReply(event, RECEIPT_FORBIDDEN_REPLY);
        await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
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
        await this.deliverReply(event, RECEIPT_FORBIDDEN_REPLY);
        await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.reject', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'MEDIUM', metadataJson: { reason: 'missing_expense_receipt_line_upload', route: 'text_note' } });
        await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
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
      let captured: Awaited<ReturnType<CaptureLineExpenseNoteUseCase['execute']>>;
      try {
        captured = await this.captureExpenseNote.execute(ctx, {
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
          chatKeyHash: chatKeyHashOf(event),
          ...(capturePlan ? { consumption: capturePlan.consumption } : {}),
        });
      } catch (error) {
        if (!(error instanceof LineTextExpenseCaptureIncompleteError)) throw error;
        await this.deliverReply(event, TEXT_EXPENSE_CLARIFY_REPLY);
        await this.persistIntakeTurn({
          userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
          userMessagePreview: normalizedText, replyText: TEXT_EXPENSE_CLARIFY_REPLY, intent: 'CLARIFY',
        });
        await this.ledger?.appendSubRequests({
          companyId, chatKey, turnId: requestId, webhookEventId: event.webhookEventId,
          userId: identity.userId,
          items: [{
            text: normalizedText,
            state: 'waiting_user',
            clarifyQuestion: TEXT_EXPENSE_CLARIFY_REPLY,
            intent: 'CLARIFY',
            clarifyForIntent: 'EXPENSE_DOCUMENT_CAPTURE',
          }],
        });
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
      await this.deliverCompletedReplies(event, replyTexts, companyId, resolvedAccess);
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
        await this.deliverReply(event, RECEIPT_FORBIDDEN_REPLY);
        await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
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
      turnResponse = await this.aiGateway.requestLineTurn(turnRequest);
    } catch (err) {
      this.logger.error({ msg: 'AI Gateway error', requestId, error: (err as Error).message });
      const failure = classifyLineAiGatewayFailure(err);
      await this.deliverReply(
        event,
        failure.replyKind === 'timeout'
          ? formatRefusal('ai_timeout')
          : failure.replyKind === 'rate_limited' ? RATE_LIMIT_REPLY : ERROR_REPLY,
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
    const turnId = await this.persistTurn(
      identity.userId,
      companyId,
      event.webhookEventId,
      turnRequest.messagePreviewHash,
      turnRequest.messageText.slice(0, PREVIEW_MAX_CHARS),
      turnResponse,
    );
    await this.updateEventLog(event.webhookEventId, 'response_ready', undefined, companyId);

    // 10. Customer-visible completion requires a confirmed LINE reply/push.
    const fallbackText = formatLineReply(turnResponse, this.config.webBaseUrl);
    const delivery = await this.deliverMessages(event, [await this.withCompletionMenu(
      buildLineBusinessAnswerMessage(turnResponse, fallbackText, this.config.webBaseUrl, companyId),
      companyId,
      resolvedAccess,
    )]);
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
        roles: { select: { role: { select: { key: true } } } },
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

  private async handleCompanyCommand(event: LineTextEvent, requestId: string, userId: string, command: LineCompanyCommand): Promise<void> {
    const memberships = await this.listLineCompanies(userId);
    if (memberships.length === 0) {
      await this.deliverReply(event, UNLINKED_REPLY);
      await this.updateEventLog(event.webhookEventId, 'no_membership', LINE_AI_ERROR_CODES.UNLINKED_USER);
      return;
    }
    if (memberships.length > 1 && !memberships.every(isOwnerMembership)) {
      await this.deliverReply(event, COMPANY_CONTEXT_FORBIDDEN_REPLY);
      await this.updateEventLog(event.webhookEventId, 'company_context_forbidden', LINE_AI_ERROR_CODES.FORBIDDEN);
      return;
    }

    const current = await this.prisma.client.lineCompanyContext.findUnique({
      where: { lineUserId: event.lineUserId },
      select: { companyId: true },
    });

    if (command.kind === 'list') {
      await this.deliverRequiredMessages(event, [buildCompanyPickerMessage(
        memberships.map((membership) => ({ companyId: membership.companyId, companyName: companyLabel(membership) })),
        current?.companyId,
      )]);
      await this.updateEventLog(event.webhookEventId, 'company_context_listed', undefined, current?.companyId);
      return;
    }

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
   *  Best-effort: memory persistence must never break an already-sent intake reply. */
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
      this.logger.error({ msg: 'LINE receipt upload error', webhookEventId: event.webhookEventId, error: (err as Error).message });
      await this.deliverReply(event, ERROR_REPLY).catch(() => {});
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

    const resolved = await resolveCompanyForLineUser(this.prisma, identity.userId, event.lineUserId);
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
    if ('policyViolation' in resolved) {
      await this.deliverReply(event, COMPANY_CONTEXT_FORBIDDEN_REPLY);
      await this.updateEventLog(event.webhookEventId, 'company_context_forbidden', LINE_AI_ERROR_CODES.FORBIDDEN);
      return;
    }
    const companyId = resolved.companyId;

    let access: { membershipId: string; roles: string[]; permissions: string[]; scopes: { branchIds?: string[] } };
    try {
      access = await this.permissionResolver.resolveAccess(identity.userId, companyId);
    } catch {
      await this.deliverReply(event, RECEIPT_LINK_REPLY);
      await this.updateEventLog(event.webhookEventId, 'no_membership', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
      return;
    }

    // Refuse before downloading bytes, invoking intake/OCR, or creating any attachment/expense.
    if (await this.refusePendingLegalAcceptance(
      event, identity.userId, companyId, access.membershipId,
    )) return;

    await this.recordShadowTurn(companyId);
    if (await lineAssistantDisabled(this.prisma, companyId)) {
      await this.deliverReply(event, formatRefusal('feature_disabled'));
      await this.audit.log({ companyId, actorUserId: identity.userId, action: 'ai.line.query.denied', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'LOW', metadataJson: { reason: 'feature_disabled' } });
      await this.updateEventLog(event.webhookEventId, 'feature_disabled', LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE, companyId);
      return;
    }

    const canCaptureExpense = access.permissions.includes('expense.receipt.line_upload') || access.permissions.includes('expense.receipt.upload');
    const canSubmitSignature = access.permissions.includes('expense.signature.manage');
    if (!canCaptureExpense && !canSubmitSignature) {
      await this.deliverReply(event, RECEIPT_FORBIDDEN_REPLY);
      await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.reject', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'MEDIUM', metadataJson: { reason: 'missing_expense_receipt_line_upload' } });
      await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
      return;
    }
    if (!this.initReceiptUpload || !this.completeReceiptUpload) {
      await this.deliverReply(event, ERROR_REPLY);
      await this.updateEventLog(event.webhookEventId, 'expense_module_unavailable', 'EXPENSE_MODULE_UNAVAILABLE', companyId);
      return;
    }

    const media = await this.downloadLineMedia(event.lineMessageId, event.messageType, event.fileName, event.fileSize);
    if (!media) {
      await this.deliverReply(event, ERROR_REPLY);
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
    });

    if (routePlan.status === 'ROUTED' && routePlan.intent === 'SIGNATURE_UPLOAD_TICKET') {
      if (!canSubmitSignature) {
        await this.deliverReply(event, SIGNATURE_FORBIDDEN_REPLY);
        await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.reject', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'MEDIUM', metadataJson: { reason: 'missing_expense_signature_manage', route: 'signature' } });
        await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
        return;
      }
      if (event.messageType !== 'image' || !this.initSignatureUpload || !this.createSignatureAsset) {
        await this.deliverReply(event, SIGNATURE_NEED_IMAGE_REPLY);
        await this.updateEventLog(event.webhookEventId, 'clarification_required', undefined, companyId);
        return;
      }
      const uploadIntent = await this.initSignatureUpload.execute(ctx, {
        originalFileName: media.fileName,
        mimeType: media.mimeType,
        byteSize: media.byteSize,
      });
      await this.uploadLineMedia(uploadIntent, media);
      const asset = await this.createSignatureAsset.execute(ctx, {
        attachmentId: uploadIntent.attachmentId,
        checksumSha256: media.checksumSha256,
        byteSize: media.byteSize,
        submittedFromChannel: 'LINE',
        lineMessageId: event.lineMessageId,
      });
      const ticketReply = formatSignatureTicketReply(this.config.webBaseUrl, companyId, asset.id);
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
      await this.deliverReply(event, clarifyReply);
      await this.persistIntakeTurn({
        userId: identity.userId, companyId, webhookEventId: event.webhookEventId,
        userMessagePreview: `[ผู้ใช้ส่งรูป/ไฟล์]${captionSuffix}`, replyText: clarifyReply, intent: 'CLARIFY',
      });
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
        const { created, pending } = await this.ensurePendingMedia(ctx, event, companyId, identity.userId, caption, media);
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

    // Reference-only routes may receive bounded guidance without expense permission, but must
    // never read an existing expense. Every possible capture/fallback branch is denied here.
    const isReferenceOnlyRoute = routePlan.status === 'ROUTED' && routePlan.intent === 'BUSINESS_DOCUMENT_REFERENCE';
    if (!canCaptureExpense && !isReferenceOnlyRoute) {
      await this.deliverReply(event, RECEIPT_FORBIDDEN_REPLY);
      await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.reject', targetType: 'LineWebhookEvent', targetId: event.webhookEventId, requestId, result: 'DENIED', riskLevel: 'MEDIUM', metadataJson: { reason: 'missing_expense_receipt_line_upload', route: 'capture' } });
      await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
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
    const ocr = await this.tryExtractReceiptFields(ctx, event.lineMessageId, media);
    const decision = decideLineBusinessDocument(routePlan, ocr, caption.length > 0);
    if (decision.outcome === 'reference' || decision.outcome === 'unsupported') {
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
        ? MEDIA_CLARIFY_REPLY
        : formatBusinessDocumentReply(decision.classification, this.config.webBaseUrl, companyId);
      let terminalStatus = 'clarification_required';
      if (decision.persistMedia && canCaptureExpense) {
        const { created, pending } = await this.ensurePendingMedia(ctx, event, companyId, identity.userId, caption, media);
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

    const intent = await this.initReceiptUpload.execute(ctx, {
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
          missingFields: [...missingFields].slice(0, 20),
          duplicateWarning: hasDuplicate,
          nextAction: 'review_in_web',
        },
      },
    });
    if (ocr.status === 'OCR_EXTRACTED_NEEDS_REVIEW') {
      await this.audit.log({
        companyId, actorUserId: identity.userId, action: 'expense.ocr.request', targetType: 'expense_record',
        targetId: intent.expenseId, requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: {
          recognizedFieldCount: ocrFields ? Object.keys(ocrFields).length : 0,
          documentKind: decision.classification?.documentKind,
        },
      });
    }
    await this.audit.log({ companyId, actorUserId: identity.userId, action: 'expense.line_upload.receive', targetType: 'expense_record', targetId: intent.expenseId, requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { lineMessageId: '[REDACTED]', mimeType: media.mimeType, byteSize: media.byteSize, sourceDocumentType: hintedDocType } });
    const purposeHint = routePlan.captureHints?.businessPurpose?.trim();
    const groundedPurpose = purposeHint && normalizeLineText(caption).toLocaleLowerCase('th-TH')
      .includes(normalizeLineText(purposeHint).toLocaleLowerCase('th-TH')) ? purposeHint : undefined;
    const receiptDraft = expenseDraftConversationEnabled
      ? await this.expenseDraftConversation!.startFromReceipt(ctx, {
        expenseId: intent.expenseId,
        chatKeyHash: chatKeyHashOf(event),
        webhookEventId: event.webhookEventId,
        ocrFields,
        ...(groundedPurpose ? { businessPurpose: groundedPurpose } : {}),
        ...(effectiveCategory?.id ? { suggestedCategoryId: effectiveCategory.id } : {}),
      })
      : undefined;
    const replyTexts = receiptDraft?.replyTexts.length ? receiptDraft.replyTexts : [formatPaypersReply(this.config.webBaseUrl, companyId, intent.expenseId, {
      hasDuplicate,
      fields: ocrFields,
      sourceDocumentType: hintedDocType !== 'NEEDS_REVIEW' ? hintedDocType : undefined,
      categoryName: effectiveCategory?.name || null,
    })];
    if (receiptDraft?.replyTexts.length) await this.deliverCompletedReplies(event, replyTexts, companyId, access);
    else await this.deliverCompletedReply(event, replyTexts[0]!, companyId, access);
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
  ): Promise<{ created: boolean; pending?: { id: string; attachmentId: string; mimeType: string } }> {
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
          caption, mimeType: media.mimeType, status: 'PENDING',
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

  /** RECEIPT-05: the customer confirmed the pending media is an expense document. Build the
   *  reviewable draft from the ALREADY-persisted attachment and mark the row resolved. */
  private async resolvePendingMediaAsReceipt(
    event: LineTextEvent,
    requestId: string,
    userId: string,
    companyId: string,
    access: { membershipId: string; roles: string[]; permissions: string[]; scopes: { branchIds?: string[] } },
    pending: { id: string; attachmentId: string; lineMessageId: string; mimeType: string },
    userMessagePreview: string,
    additionalText?: string,
  ): Promise<void> {
    const canCaptureExpense = ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.create'].some((p) => access.permissions.includes(p));
    if (!canCaptureExpense || !this.expenseRepo) {
      await this.deliverReply(event, RECEIPT_FORBIDDEN_REPLY);
      await this.updateEventLog(event.webhookEventId, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN, companyId);
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
        });
        reply = `${reply}\n\nผลคำขอเพิ่มเติม:\n${continuation.replyText}`;
        pendingQuestion = continuation.pendingQuestion;
      } catch (error) {
        this.logger.warn({ msg: 'line_substitute_continuation_additional_outcome_failed', requestId, error: (error as Error).message });
        reply = `${reply}\n\nผลคำขอเพิ่มเติม:\n⏳ ส่วนใบรับรองแทนใบเสร็จรับเงินยังตรวจสอบไม่ได้ชั่วคราว รายการค่าใช้จ่ายด้านบนยังบันทึกสำเร็จและตรวจสอบได้ในเว็บ`;
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
      companyId, branchId: resolveCreateBranchId(scopes, undefined) ?? undefined,
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
  ): Promise<ReceiptOcrPreflight> {
    if (!media.contentBase64 || (media.mimeType !== 'image/jpeg' && media.mimeType !== 'image/png' && media.mimeType !== 'application/pdf')) {
      return { status: 'NOT_REQUESTED', fields: null, classification: null };
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
      });
      if (result.status === 'not_configured') return { status: 'NOT_CONFIGURED', fields: null, classification: null };
      if (result.status !== 'ok') return { status: 'OCR_FAILED', fields: null, classification: null };
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
