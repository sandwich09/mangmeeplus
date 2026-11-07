import { LINE_VOUCHER_WORKFLOW_STATUS } from './line-voucher-action.service';
import { isLineWorkflowPutOff } from '@watchdog-bms/contracts';
import { stripLineFieldParticles } from '@watchdog-bms/contracts';
import { lineWorkflowCommand, matchLineClaimTargets, lineClaimTargetSearch } from '../domain/logic/line-ai-classifier.logic';
import { createLineAiInputEvidence, extractValueCandidatesV2, mapThaiDigits, type LineWorkflowId } from '@watchdog-bms/contracts';
import { LINE_CLAIM_PICKER_COPY, LINE_EXPENSE_PICKER_COPY } from '../domain/logic/line-business-card.logic';
import { LineWorkflowTargetService, type LineWorkflowTargets, type LineWorkflowRecordTargets, type LineWorkflowRecordTarget } from './line-workflow-target.service';
import { CLAIM_WORKFLOW_ACTIONS, EXPENSE_WORKFLOW_ACTIONS, type ClaimWorkflowId, type ExpenseWorkflowId } from '../domain/logic/line-reimbursement-approval-control.logic';
import { verifyLineWorkflowOpenSig, lineWorkflowOpenData } from '../domain/logic/line-reimbursement-approval-control.logic';
import type { LineAiInputEvidenceV2, LineWorkflowControl } from '@watchdog-bms/contracts';
import { isPendingFieldAnswer, lineDocumentNumberMatches, lineWorkflowPickerText } from '../domain/logic/line-ai-classifier.logic';
import { REIMBURSEMENT_DRAFT_CHANGED } from '../domain/logic/line-reimbursement-draft-card.logic';
import { DISBURSEMENT_VOUCHER_MAX_LINES, DISBURSEMENT_VOUCHER_ERROR_WORDS, E_WHT_WORDS, eWhtRateKind, eWhtReducedRateOn, LINE_WORKFLOW_OPEN_ACTIONS, lineReplyLanguage } from '@watchdog-bms/contracts';
import { lineUiLabel, lineDisplayDate, lineExpenseEvidenceNotes, type LineReplyLanguage } from '../domain/logic/line-language.logic';
import { ListWhtIncomeCategoriesUseCase } from '../../procurement/application/use-cases/wht-income-category.use-case';
import { RecordReimbursementPaymentUseCase } from '../../reimbursements/application/use-cases/reimbursement-finance.use-case';
import { InitPaymentSlipUploadUseCase, CompletePaymentSlipUploadUseCase } from '../../reimbursements/application/use-cases/reimbursement-payment-slip.use-case';
import type { RecordReimbursementPaymentInput } from '@watchdog-bms/contracts';
import { quoteRecordsFromPlan } from './line-quoted-message.service';
import { parseDeliveryBatchStates, parseLineDeliveryPlan } from '../domain/logic/line-delivery-plan.logic';
import { LineTeamActionService, TEAM_ACTION_LABELS, type TeamAction } from './line-team-action.service';
import { LineVoucherActionService, VOUCHER_ACTIONS, isVoucherPayeeName, requestedVoucherBillCount, type VoucherAction, type VoucherActionPayload } from './line-voucher-action.service';
import Decimal from 'decimal.js';
import { PrismaReimbursementRepository } from '../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { verifyReimbursementApprovalOpenToken } from '../domain/logic/line-reimbursement-approval-control.logic';
import { ListReimbursementsUseCase, GetReimbursementDetailUseCase, SubmitReimbursementUseCase, CancelReimbursementUseCase } from '../../reimbursements/application/use-cases/reimbursement-request.use-case';
import { ApproveReimbursementUseCase, RejectReimbursementUseCase, activeStepApprovers, hasFrozenAssignment } from '../../reimbursements/application/use-cases/reimbursement-approval.use-case';
import type { ReimbursementRequestDetail, RecordExpensePaymentInput } from '@watchdog-bms/contracts';
import { todayCivilDate, expenseDateIsReadable } from '@watchdog-bms/contracts';
import { calcPaymentAmounts, derivePaymentStatus } from '../../expenses/domain/logic/expense-totals.logic';
import type { Prisma } from '../../../generated/prisma/client';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { EXPENSE_STATUS_LABELS, EXPENSE_RECEIPT_SOURCE_TYPES, SOURCE_DOCUMENT_TYPE_LABELS, TAX_EVIDENCE_STATUS_LABELS, EXPENSE_VAT_MODE_LABELS, expenseEvidenceAssessment, expenseEvidenceImageMissing, expenseEvidenceInputError, expenseEvidenceFingerprint, isExpenseEvidenceFile, scrubRecordText, type ExpenseEvidenceAssessment, type RequestContext, type ToolResult } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { isBranchInScope } from '../../data-model-core/domain/logic/branch.logic';
import { LineDraftPreviewStore, LINE_DRAFT_PREVIEW_TTL_SECONDS } from '../../expenses/application/services/line-draft-preview.store';
import { ConfirmExpenseUseCase, GetExpenseUseCase, RecordExpensePaymentUseCase, MarkExpenseReadyUseCase, VoidExpenseUseCase, UpdateExpenseDraftUseCase } from '../../expenses/application/use-cases/expense-draft.use-case';
import { DeleteExpenseUseCase } from '../../expenses/application/use-cases/delete-expense.use-case';
import { LineExpenseDraftConversationUseCase } from '../../expenses/application/use-cases/line-expense-draft-conversation.use-case';
import { PrismaExpenseRepository } from '../../expenses/infrastructure/prisma-expense.repository';
import { expenseTaxSourceChecksum, readAiCategorySuggestion } from '../../expenses/domain/logic/expense-status.logic';
import { canonicalDeliveryJson, deliveryHash } from '../domain/logic/line-delivery-plan.logic';
import type { ErpReadToolPort, ErpToolContext } from '../domain/ports/erp-read-tool.port';
import { formatThaiDate } from '../domain/logic/line-draft-update-card.logic';
import { parseLineExpenseDraftContinuation } from '../../expenses/domain/logic/line-expense-draft-conversation.logic';
import { projectLineDraftPatch } from '../../expenses/domain/logic/line-draft-update.logic';
import type { ExpenseRecordWithRelations } from '../../expenses/domain/models/expense.model';

class CategoryPreviewRollback extends Error {
  constructor(readonly source: ExpenseRecordWithRelations) { super('expense-category-preview-rollback'); }
}

export const EXPENSE_ACTIONS = LINE_WORKFLOW_OPEN_ACTIONS;
export type ExpenseAction = typeof EXPENSE_ACTIONS[number] | TeamAction;
export const EXPENSE_ACTION_LABELS: Record<ExpenseAction, string> = { ...TEAM_ACTION_LABELS, MARK_READY: 'ส่งตรวจ', CONFIRM: 'ยืนยัน', DELETE_DRAFT: 'ลบร่าง', VOID: 'ยกเลิกรายการ', REIMBURSEMENT_SUBMIT: 'ส่งอนุมัติ', REIMBURSEMENT_CANCEL: 'ยกเลิกใบเบิก', REIMBURSEMENT_APPROVE: 'อนุมัติ', REIMBURSEMENT_REJECT: 'ไม่อนุมัติ', REIMBURSEMENT_RECORD_PAYMENT: 'บันทึกจ่ายคืน', RECORD_PAYMENT: 'บันทึกจ่าย', VOUCHER_CREATE: 'สร้างใบเตรียมจ่าย', VOUCHER_SUBMIT: 'ส่งอนุมัติ', VOUCHER_APPROVE: 'อนุมัติใบเตรียมจ่าย', VOUCHER_RETURN: 'ส่งกลับแก้ไข', VOUCHER_PAY: 'บันทึกจ่าย', VOUCHER_CANCEL: 'ยกเลิกใบเตรียมจ่าย', WHT_CERTIFICATE_ISSUE: 'ออก 50 ทวิ' };
export type ExpenseActionControl = { action: 'expense_action_confirm' | 'expense_action_cancel' | 'expense_action_approve' | 'expense_action_reject' | 'expense_action_submit' | 'expense_action_wht' | 'expense_action_payment' | 'expense_action_next' | 'expense_action_transfer' | 'expense_action_cheque'; token: string };
export type ExpenseActionPreview = {
  resultId?: string;
  language?: LineReplyLanguage;
  previewId: string; token: string; action: ExpenseAction; reason?: string; details?: string[]; payment?: RecordExpensePaymentInput; expiresAt: string; summary: string;
  certificates?: { number: string; uri: string }[]; offerWht?: boolean; offerPayment?: boolean; offerNext?: VoucherAction; evidenceReview?: boolean;
  documentImageUrl?: string;
  nextControls?: { next?: string; payment?: string; wht?: string };
  record: { vendorName: string; amount: string; currency: string; date: string; status: string; nextStatus: string };
};
type ActionCategory = { id: string; name: string; kind?: 'wht'; other?: { id: string; name: string; kind?: 'wht' } };
type StoredAction = {
  previewId: string; companyId: string; userId: string; membershipId: string; chatKeyHash: string;
  conversationId: string; ownerEpoch: number; expenseId: string; revision: string; digest: string;
  branchId: string | null; createdByUserId: string; requestId: string; preview: ExpenseActionPreview; claim?: { payoutSubmitToken?: string; hash?: string; payoutVersion?: number; thirdParty?: boolean; payment?: RecordReimbursementPaymentInput }; paymentIntent?: Record<string, unknown>; awaitingReason?: boolean; evidence?: { id: string; revision: string; attachmentId: string; paidAt?: string };
  allowedPaymentMethods?: Array<'BANK_TRANSFER' | 'CHEQUE' | 'OTHER'>; paymentMethodQuestion?: boolean;
  voucher?: VoucherActionPayload; awaitingField?: 'reason' | 'payeeName' | 'payeeAddress' | 'paymentMethod' | 'claimSlip';
  applied?: { nextVoucherId?: string; revision: string | null; digest?: string; preview: ExpenseActionPreview };
  markReady?: boolean;
  category?: ActionCategory;
  review?: { assessment: ExpenseEvidenceAssessment; fingerprint: string; filesHash: string };
};
type StoredClaimPicker = {
  previewId: string; companyId: string; userId: string; membershipId: string; chatKeyHash: string;
  conversationId: string; ownerEpoch: number; requestId: string; workflow: ClaimWorkflowId | ExpenseWorkflowId; result: LineWorkflowTargets | LineWorkflowRecordTargets;
  paymentIntent?: { pa: string; pm?: string; pd?: string };
};
type StoredEvidenceChoice = {
  language?: LineReplyLanguage;
  previewId: string; companyId: string; userId: string; membershipId: string; chatKeyHash: string;
  conversationId: string; ownerEpoch: number; expenseId: string; revision: string; digest: string; requestId: string;
  stage: 'choice' | 'photo' | 'reason' | 'waiting'; paymentIntent?: Record<string, unknown>;
};
type StoredRepair = {
  language?: LineReplyLanguage;
  previewId: string; companyId: string; userId: string; membershipId: string; chatKeyHash: string;
  conversationId: string; ownerEpoch: number; expenseId: string; revision: string; requestId: string;
  action: ExpenseAction; reply: string; categories: Array<ActionCategory>; offset: number;
  editPreviewId?: string;
  priorCategory?: ActionCategory; evidenceAssessment?: ExpenseEvidenceAssessment;
  categoryOnly?: boolean; paymentIntent?: Record<string, unknown>;
};
const MISSING_LABELS: Record<string, string> = {
  category: 'หมวดค่าใช้จ่าย', expenseCategoryId: 'หมวดค่าใช้จ่าย', vendor: 'ผู้ขาย/ผู้รับเงิน', vendorName: 'ผู้ขาย/ผู้รับเงิน', vendorNameSnapshot: 'ผู้ขาย/ผู้รับเงิน',
  date: 'วันที่รายการ', expenseDate: 'วันที่รายการ', amount: 'ยอดเงิน', grandTotalAmount: 'ยอดเงิน', price: 'ราคาต่อหน่วยหรือยอดรวม', unitPrice: 'ราคาต่อหน่วย', totalAmount: 'ยอดรวม',
  items: 'รายการสินค้า/บริการ', lines: 'รายการสินค้า/บริการ', description: 'ชื่อสินค้า/บริการ', quantity: 'จำนวน',
  evidence: 'หลักฐาน', primaryAttachmentId: 'หลักฐาน', receipt: 'ใบเสร็จ', receipt_evidence: 'ใบเสร็จ', evidenceReview: 'การตรวจหลักฐาน', documentReview: 'การตรวจหลักฐาน', review: 'การตรวจรายการ',
  vatRate: 'อัตรา VAT', rate: 'อัตรา VAT', vatMode: 'รูปแบบ VAT', inputVatClaimStatus: 'ใช้ VAT ตอนยื่นภาษี', taxEvidenceStatus: 'หลักฐานรายจ่าย',
  businessPurpose: 'วัตถุประสงค์ค่าใช้จ่าย', purpose: 'วัตถุประสงค์ค่าใช้จ่าย', vendorTaxId: 'เลขผู้เสียภาษีผู้ขาย', vendorAddress: 'ที่อยู่ผู้ขาย', paymentMethod: 'วิธีจ่าย',
  vendorDocumentNumber: 'เลขที่เอกสาร', vatAmount: 'ยอด VAT', currency: 'สกุลเงิน', whtRate: 'อัตราหัก ณ ที่จ่าย', whtCategoryCode: 'จ่ายค่าอะไร', vendorEntityKindSnapshot: 'ประเภทผู้เสียภาษีผู้รับเงิน',
};
const PAYMENT_LABELS = { UNPAID: 'ยังไม่จ่าย', PARTIALLY_PAID: 'จ่ายบางส่วนแล้ว', PAID: 'จ่ายแล้ว' };

export function paidExpenseReply(expense: Pick<ExpenseRecordWithRelations, 'status' | 'netPayableAmount' | 'paidAmount' | 'paidAt' | 'currency'>): string | undefined {
  if (expense.status === 'VOIDED' || derivePaymentStatus(expense.netPayableAmount, expense.paidAmount) !== 'PAID') return undefined;
  const amount = new Decimal(expense.paidAmount).toFixed(2);
  const date = expense.paidAt ? ` วันที่ ${formatThaiDate(new Date(expense.paidAt).toISOString())}` : '';
  return `รายการนี้บันทึกจ่ายครบแล้วค่ะ ${amount} ${expense.currency === 'THB' ? 'บาท' : expense.currency}${date}`;
}
function missingActionFields(error: unknown): string[] {
  if (!(error instanceof HttpException)) return [];
  const response = error.getResponse();
  if (error.message.includes('Withholding tax requires the income category')) return ['whtCategoryCode'];
  const fields = typeof response === 'object' && response ? (response as any).missingFields : undefined;
  return Array.isArray(fields) ? fields.filter((field): field is string => typeof field === 'string') : [];
}
export type ExpenseActionResult = { status: 'applied' | 'replayed' | 'prepared'; reply: string; preview: ExpenseActionPreview; expenseIds?: string[] }
  | { status: 'blocked' | 'cancelled'; reply: string; webPath?: string; webLabel?: string; recovery?: string; question?: boolean; taskSource?: { action: ExpenseAction; id: string } };
export const EXPENSE_ACTION_CHANGED = 'รายการเปลี่ยนไปแล้วค่ะ ขอเตรียมการ์ดใหม่ก่อนยืนยันอีกครั้ง';
// Confirm/ready/void/payment and their repository guards: customer text never echoes an exception.
export const EXPENSE_ACTION_REFUSALS: Record<string, string> = {
  expense_ewht_payment_method: E_WHT_WORDS['L-1'],
  disbursement_ewht_planned_method: E_WHT_WORDS['L-1'],
  EXPENSE_SOURCE_DRAFT_INCOMPLETE: 'ข้อมูลร่างยังไม่ครบค่ะ พิมพ์ข้อมูลที่ขาดในแชตเพื่อแก้ร่างก่อน',
  EXPENSE_DOCUMENT_DATE_REVIEW_REQUIRED: 'ยังขาดการตรวจวันที่รายการ ตรวจวันที่แล้วบอกวันที่ในแชตได้เลยค่ะ',
  EXPENSE_EVIDENCE_REVIEW_REQUIRED: 'เปิดหน้ารายการเพื่อตรวจประเภทเอกสารและหลักฐานให้ครบก่อนยืนยันค่ะ',
  EXPENSE_DOCUMENT_REVIEW_INCOMPLETE: 'เลือกประเภทเอกสารและตรวจหลักฐานรายจ่ายให้ครบที่หน้ารายการค่ะ',
  EXPENSE_VAT_RECONCILIATION_REQUIRED: 'ให้ผู้ตรวจรายจ่ายเทียบยอด VAT กับเอกสารและบันทึกเหตุผลยอมรับส่วนต่างในหน้ารายการก่อนค่ะ',
  EXPENSE_VAT_OVERRIDE_INVALID: 'ระบุเหตุผลและบรรทัดที่มี VAT ในหน้ารายการก่อนยอมรับยอดตามเอกสารค่ะ',
  EXPENSE_VAT_OVERRIDE_STALE: EXPENSE_ACTION_CHANGED,
  EXPENSE_VAT_TAX_RATE_CONFLICT: 'ให้ผู้ตรวจรายจ่ายแก้อัตราและรูปแบบ VAT ให้ตรงกันที่หน้ารายการค่ะ',
  EXPENSE_VAT_TAX_TOLERANCE_REQUIRED: 'ให้ผู้ตรวจรายจ่ายตรวจส่วนต่าง VAT ที่หน้ารายการค่ะ',
  transaction_tax_needs_review: 'ให้ผู้ตรวจรายจ่ายตรวจรูปแบบ VAT และหลักฐานที่หน้ารายการค่ะ',
  input_vat_not_available_company_not_vat_registered: 'ให้ผู้ตรวจรายจ่ายตรวจคำตอบเรื่อง VAT ที่หน้ารายการค่ะ',
  expense_confirmation_source_status_changed: 'สถานะรายการเปลี่ยนแล้วค่ะ ขอเปิดรายการล่าสุดก่อนยืนยันอีกครั้ง',
  expense_confirmation_source_version_changed: EXPENSE_ACTION_CHANGED,
  expense_confirmation_source_checksum_changed: EXPENSE_ACTION_CHANGED,
  expense_confirmation_tax_line_changed: EXPENSE_ACTION_CHANGED,
  expense_confirmation_tax_evidence_changed: EXPENSE_ACTION_CHANGED,
  expense_confirmation_accepted_vat_changed: EXPENSE_ACTION_CHANGED,
  expense_source_version_changed: EXPENSE_ACTION_CHANGED,
  EXPENSE_UPDATE_CONFLICT: EXPENSE_ACTION_CHANGED,
  EXPENSE_UPDATE_VERSION_REQUIRED: EXPENSE_ACTION_CHANGED,
  EXPENSE_SOURCE_DRAFT_RELOAD_REQUIRED: EXPENSE_ACTION_CHANGED,
  substitute_evidence_locks_expense: 'ให้ผู้ตรวจรายจ่ายจัดทำใบรับรองฉบับแก้ไขก่อนเปลี่ยนข้อมูลที่ลงนามแล้วค่ะ',
  substitute_evidence_nonclaimable: 'ให้ผู้ตรวจรายจ่ายตรวจคำตอบเรื่อง VAT ที่หน้ารายการค่ะ',
  substitute_evidence_doc_type_locked: 'ให้ผู้ตรวจรายจ่ายจัดทำใบรับรองฉบับแก้ไขก่อนเปลี่ยนประเภทเอกสารค่ะ',
  pp36_historical_tax_snapshot_changed: EXPENSE_ACTION_CHANGED,
  TRANSACTION_BRANCH_REQUIRED: 'ยังขาดสาขาค่ะ พิมพ์ชื่อสาขาของรายการนี้ในแชตได้เลย',
  expense_changed_retry: EXPENSE_ACTION_CHANGED,
  posting_state_changed: EXPENSE_ACTION_CHANGED,
  expense_correction_source_changed: EXPENSE_ACTION_CHANGED,
  expense_changed: 'รายการนี้ยังยกเลิกไม่ได้ค่ะ ถ้ายังเป็นร่างให้กดลบร่าง',
  expense_not_voidable: 'รายการนี้ยังยกเลิกไม่ได้ค่ะ ถ้ายังเป็นร่างให้กดลบร่าง',
  expense_void_reason_required: 'ยกเลิกรายการนี้เพราะอะไรคะ',
  expense_disbursement_reserved: 'ให้ผู้จัดทำใบเตรียมจ่ายนำรายการนี้ออกจากใบเตรียมจ่ายหรือยกเลิกใบนั้นก่อนค่ะ',
  expense_certificate_attestation_required: 'เปิดหน้ารายการเพื่อตรวจและรับรองการยกเลิกหนังสือหักภาษีก่อนค่ะ',
  certificate_issued: 'ให้ผู้ดูแลภาษีจัดการหนังสือรับรองที่ออกจากงานภาษีก่อนยกเลิกรายการค่ะ',
  posting_unresolved: 'รายการนี้ยังทำต่อไม่ได้ ให้ผู้ทำบัญชีตรวจจากหน้ารายการค่ะ',
  accounting_period_locked: 'รายการนี้ยังทำต่อไม่ได้ ให้ผู้ทำบัญชีตรวจจากหน้ารายการค่ะ',
  tax_period_locked: 'รายการนี้ยังทำต่อไม่ได้ ให้ผู้ทำบัญชีตรวจจากหน้ารายการค่ะ',
  expense_belongs_to_reimbursement: 'รายการนี้อยู่ในใบเบิกค่ะ เปิดใบเบิกเดิมเพื่อดำเนินการต่อ',
  substitute_source_has_live_claim: 'หลักฐานนี้อยู่ในใบเบิกแล้วค่ะ เปิดใบเบิกเดิมเพื่อดำเนินการต่อ',
  substitute_personal_settles_via_reimbursement: 'รายการนี้ใช้เงินส่วนตัวสำรองจ่ายค่ะ ให้ทำใบเบิกเพื่อคืนเงินพนักงาน',
  claim_expense_settles_via_reimbursement: 'รายการนี้ต้องบันทึกจ่ายผ่านใบเบิกค่ะ เปิดใบเบิกเดิมเพื่อดำเนินการต่อ',
  expense_settled_via_reimbursement: 'รายการนี้ต้องบันทึกจ่ายผ่านใบเบิกค่ะ เปิดใบเบิกเดิมเพื่อดำเนินการต่อ',
  expense_payment_invalid_key: 'ขอเตรียมการ์ดบันทึกจ่ายใหม่แล้วกดยืนยันอีกครั้งค่ะ',
  expense_payment_invalid_date: 'พิมพ์วันที่จ่ายที่มีอยู่จริงในแชตเพื่อเตรียมการ์ดใหม่ค่ะ',
  expense_payment_future_date: 'วันที่จ่ายต้องไม่เกินวันนี้ค่ะ พิมพ์วันที่จ่ายจริงในแชตได้เลย',
  expense_payment_invalid_method: 'พิมพ์วิธีจ่ายเป็นเงินสด โอนเงิน บัตร หรือเช็คในแชตค่ะ',
  expense_reviewer_ineligible: 'คนนี้ยืนยันรายจ่ายของสาขานี้ไม่ได้ค่ะ เปิดรายการบนเว็บเพื่อเลือกผู้ตรวจคนอื่น',
  expense_payment_slip_invalid: 'แนบหลักฐานการจ่ายใหม่จากหน้ารายการบนเว็บค่ะ',
  expense_payment_invalid_reference: 'พิมพ์เลขอ้างอิงธนาคารไม่เกินหนึ่งร้อยยี่สิบแปดตัวอักษรในแชตค่ะ',
  expense_payment_not_confirmed: 'ต้องยืนยันรายการก่อนบันทึกจ่ายค่ะ',
  expense_payment_exceeds_outstanding: 'พิมพ์ยอดจ่ายที่มากกว่าศูนย์และไม่เกินยอดคงเหลือในแชตค่ะ',
  expense_payment_idempotency_conflict: 'เปิดดูยอดจ่ายล่าสุดก่อนขอการ์ดบันทึกจ่ายใหม่ค่ะ',
  expense_payment_cancelled_replay: 'การจ่ายครั้งนี้ถูกยกเลิกแล้วค่ะ ขอการ์ดบันทึกจ่ายใหม่หากต้องการจ่ายอีกครั้ง',
  expense_payment_changed: EXPENSE_ACTION_CHANGED,
  'Payment evidence linking unavailable.': 'ยังแนบสลิปจ่ายไม่ได้ค่ะ กรุณาลองบันทึกจ่ายอีกครั้ง',
};
export function expenseActionNextStepChoices(reply: string): Array<{ label: string; text: string }> {
  if (reply.includes('กำลังจัดทำใบรับรองแทนใบเสร็จ')) return [{ label: 'ทำใบรับรองต่อ', text: 'ทำใบรับรองต่อ' }];
  if (reply.includes(EXPENSE_ACTION_CHANGED) || reply.includes('ขอเปิดรายการล่าสุด')) return [{ label: 'ดูรายการล่าสุด', text: 'ดูรายการนี้ล่าสุด' }];
  if (reply.includes('ต้องส่งตรวจให้พร้อมยืนยันก่อน')) return [{ label: 'ส่งตรวจ', text: 'ส่งตรวจรายการนี้' }];
  if (reply.includes('ต้องยืนยันรายการก่อนบันทึกจ่าย')) return [{ label: 'ยืนยันรายการ', text: 'ยืนยันรายการนี้' }];
  if (reply.includes('ให้กดลบร่าง')) return [{ label: 'ลบร่าง', text: 'ลบร่างรายการนี้' }];
  if (reply.includes('เปิดใบเบิกเดิม')) return [{ label: 'ดูใบเบิก', text: 'ดูใบเบิกของรายการนี้' }];
  if (reply.includes('ทำใบเบิกเพื่อคืนเงิน')) return [{ label: 'ทำใบเบิก', text: 'ขอทำใบเบิกคืนเงินรายการนี้' }];
  if (reply.includes('การ์ดบันทึกจ่ายใหม่')) return [{ label: 'บันทึกจ่าย', text: 'ขอบันทึกจ่ายรายการนี้' }];
  return [];
}
const EXPIRED = 'การ์ดนี้ใช้ไม่ได้แล้วค่ะ ขอเตรียมการ์ดใหม่อีกครั้ง';
const PERMISSION: Record<ExpenseAction, string> = {
  EMPLOYEE_CREATE: 'คุณยังไม่มีสิทธิ์เพิ่มพนักงานค่ะ', EMPLOYEE_UPDATE: 'คุณยังไม่มีสิทธิ์แก้ไขพนักงานค่ะ', EMPLOYEE_DISABLE: 'คุณยังไม่มีสิทธิ์ปิดใช้งานพนักงานค่ะ', EMPLOYEE_ENABLE: 'คุณยังไม่มีสิทธิ์เปิดใช้งานพนักงานค่ะ', BRANCH_CREATE: 'คุณยังไม่มีสิทธิ์เพิ่มสาขาค่ะ', BRANCH_UPDATE: 'คุณยังไม่มีสิทธิ์แก้ไขสาขาค่ะ',
  MARK_READY: 'ให้เจ้าของร่างที่มีสิทธิ์แก้ไขหรือผู้ตรวจรายการส่งตรวจได้ค่ะ',
  CONFIRM: 'ให้เจ้าของกิจการหรือผู้มีสิทธิ์ยืนยันรายการยืนยันได้ค่ะ',
  DELETE_DRAFT: 'ให้ผู้มีสิทธิ์ลบหรือเจ้าของร่างที่มีสิทธิ์แก้ไขลบได้ค่ะ',
  VOID: 'ให้ผู้มีสิทธิ์ยกเลิกรายการดำเนินการได้ค่ะ',
  REIMBURSEMENT_SUBMIT: 'ให้ผู้ขอเบิกหรือผู้ตรวจการเงินที่มีสิทธิ์ส่งใบเบิกดำเนินการค่ะ',
  REIMBURSEMENT_CANCEL: 'ให้ผู้ขอเบิกที่มีสิทธิ์ยกเลิกหรือผู้ตรวจการเงินดำเนินการค่ะ',
  REIMBURSEMENT_APPROVE: 'ให้ผู้อนุมัติที่ใบเบิกนี้รออยู่ดำเนินการค่ะ',
  REIMBURSEMENT_REJECT: 'ให้ผู้อนุมัติที่ใบเบิกนี้รออยู่ดำเนินการค่ะ',
  RECORD_PAYMENT: 'ให้ผู้มีสิทธิ์บันทึกจ่ายดำเนินการค่ะ',
  REIMBURSEMENT_RECORD_PAYMENT: 'ให้ผู้มีสิทธิ์บันทึกจ่ายคืนดำเนินการค่ะ',
  VOUCHER_CREATE: 'ให้ผู้มีสิทธิ์จัดทำใบเตรียมจ่ายดำเนินการค่ะ', VOUCHER_SUBMIT: 'ให้ผู้มีสิทธิ์จัดทำใบเตรียมจ่ายดำเนินการค่ะ',
  VOUCHER_APPROVE: 'ให้ผู้มีสิทธิ์อนุมัติใบเตรียมจ่ายดำเนินการค่ะ', VOUCHER_RETURN: 'ให้ผู้มีสิทธิ์อนุมัติใบเตรียมจ่ายดำเนินการค่ะ',
  VOUCHER_PAY: 'ให้ผู้มีสิทธิ์จ่ายใบเตรียมจ่ายดำเนินการค่ะ', VOUCHER_CANCEL: 'ให้ผู้มีสิทธิ์จัดทำหรืออนุมัติใบเตรียมจ่ายดำเนินการค่ะ',
  WHT_CERTIFICATE_ISSUE: 'ให้ผู้มีสิทธิ์ออกหนังสือรับรองดำเนินการค่ะ',
};
export function parseExpenseActionControl(raw: unknown): ExpenseActionControl | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Object.keys(obj).length !== 2 || typeof obj.action !== 'string' || typeof obj.token !== 'string') return null;
    raw = new URLSearchParams({ action: obj.action, token: obj.token }).toString();
  }
  if (typeof raw !== 'string' || raw.length > 400) return null;
  const p = new URLSearchParams(raw), keys = [...p.keys()];
  const action = p.get('action'), token = p.get('token');
  if (keys.length !== 2 || new Set(keys).size !== 2 || keys.some(k => !['action', 'token'].includes(k))
    || !['expense_action_confirm', 'expense_action_cancel', 'expense_action_approve', 'expense_action_reject', 'expense_action_submit', 'expense_action_wht', 'expense_action_payment', 'expense_action_next', 'expense_action_transfer', 'expense_action_cheque'].includes(action ?? '')
    || !token || !/^[A-Za-z0-9_-]{1,200}\.[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  return { action: action as ExpenseActionControl['action'], token };
}

/** Preview is model-reachable; apply is called only by the signature-verified private webhook. */
@Injectable()
export class LineExpenseActionService {
  @Inject(forwardRef(() => LineWorkflowTargetService)) private readonly workflowTargets!: Pick<LineWorkflowTargetService, 'pick'>;
  // Same shared TTL store, isolated namespace; repair choices never authorize a mutation.
  private get evidenceChoices() { return this.store as unknown as LineDraftPreviewStore<StoredEvidenceChoice>; }
  private get claimPickers() { return this.store as unknown as LineDraftPreviewStore<StoredClaimPicker>; }
  private get repairs() { return this.store as unknown as LineDraftPreviewStore<StoredRepair>; }
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PrismaExpenseRepository,
    private readonly getExpense: GetExpenseUseCase,
    private readonly ready: MarkExpenseReadyUseCase,
    private readonly confirm: ConfirmExpenseUseCase,
    private readonly remove: DeleteExpenseUseCase,
    private readonly voidExpense: VoidExpenseUseCase,
    private readonly drafts: LineExpenseDraftConversationUseCase,
    private readonly store: LineDraftPreviewStore<StoredAction>,
    private readonly config: AppConfigService,
    @Optional() private readonly getClaim?: GetReimbursementDetailUseCase,
    @Optional() private readonly submitClaim?: SubmitReimbursementUseCase,
    @Optional() private readonly cancelClaim?: CancelReimbursementUseCase,
    @Optional() private readonly approveClaim?: ApproveReimbursementUseCase,
    @Optional() private readonly rejectClaim?: RejectReimbursementUseCase,
    @Optional() private readonly payment?: RecordExpensePaymentUseCase,
    @Optional() private readonly claimRepo?: PrismaReimbursementRepository,
    @Optional() private readonly vouchers?: LineVoucherActionService,
    @Optional() private readonly updateDraft?: UpdateExpenseDraftUseCase,
    @Optional() private readonly teams?: LineTeamActionService,
    @Optional() private readonly claimPayment?: RecordReimbursementPaymentUseCase,
    @Optional() private readonly initClaimSlip?: InitPaymentSlipUploadUseCase,
    @Optional() private readonly completeClaimSlip?: CompletePaymentSlipUploadUseCase,
    @Optional() private readonly listClaims?: ListReimbursementsUseCase,
  ) {}

  private key(chat: string) { return `expense-action:${chat}`; }
  private async owner(ctx: RequestContext, chat: string) {
    return this.prisma.client.aiConversation.findFirst({ where: { companyId: ctx.companyId, userId: ctx.userId,
      membershipId: ctx.membershipId, chatKeyHash: chat, channelKind: 'USER', channel: 'line' } });
  }
  private sign(entry: StoredAction): string {
    const secret = this.config.aiGatewayInternalSecret;
    if (!secret) throw new ForbiddenException();
    return createHmac('sha256', secret).update('line-expense-action-v1\0')
      .update(canonicalDeliveryJson({ id: entry.previewId, company: entry.companyId, user: entry.userId, membership: entry.membershipId,
        chat: entry.chatKeyHash, conversation: entry.conversationId, epoch: entry.ownerEpoch, expense: entry.expenseId,
        revision: entry.revision, digest: entry.digest, branch: entry.branchId, creator: entry.createdByUserId, action: entry.preview.action, reason: entry.preview.reason ?? null,
        record: entry.preview.record, details: entry.preview.details, documentImageUrl: entry.preview.documentImageUrl, review: entry.review, markReady: entry.markReady, category: entry.category, evidenceReview: entry.preview.evidenceReview, payment: entry.preview.payment, claim: entry.claim, paymentIntent: entry.paymentIntent, evidence: entry.evidence, voucher: entry.voucher, ...(entry.allowedPaymentMethods ? { allowedPaymentMethods: entry.allowedPaymentMethods, paymentMethodQuestion: entry.paymentMethodQuestion ?? false } : {}), awaitingField: entry.awaitingField, awaitingReason: entry.awaitingReason, expires: entry.preview.expiresAt })).digest('base64url');
  }
  private async bound(ctx: RequestContext, chat: string, entry: StoredAction, token?: string): Promise<boolean> {
    if (entry.companyId !== ctx.companyId || entry.userId !== ctx.userId || entry.membershipId !== ctx.membershipId
      || entry.chatKeyHash !== this.key(chat) || !isBranchInScope(ctx.scopes ?? {}, entry.branchId)
      || Date.parse(entry.preview.expiresAt) <= Date.now()) return false;
    const owner = await this.owner(ctx, chat);
    if (!owner || owner.id !== entry.conversationId || owner.lifecycleEpoch !== entry.ownerEpoch) return false;
    const expected = `${entry.previewId}.${this.sign(entry)}`, supplied = token ?? entry.preview.token;
    return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  }
  async shownApprovalNotices(ctx: RequestContext, chat: string) {
    if (!await this.owner(ctx, chat) || !this.prisma.client.notificationRecipient?.findMany) return [];
    const rows = await this.prisma.client.notificationRecipient.findMany({ where: { companyId: ctx.companyId, userId: ctx.userId,
      event: { triggerKey: 'workflow.reimbursement_pending_approval', sourceType: 'reimbursement_request' },
      deliveries: { some: { channel: 'LINE', status: 'SENT', metadataJson: { path: ['reimbursementApprovalChatKeyHash'], equals: chat }, sentAt: { gte: new Date(Date.now() - 15 * 60_000) } } },
    }, take: 5, orderBy: { createdAt: 'desc' }, select: { event: { select: { sourceId: true } } } });
    return rows.flatMap(row => row.event.sourceId ? [{ id: row.event.sourceId, label: 'ใบเบิกที่แจ้งรออนุมัติ', ordinal: 1 }] : []);
  }
  private async grounded(ctx: RequestContext, chat: string, id: string, claim: boolean | 'voucher' = false): Promise<boolean> {
    // A lookup and its preview share one admitted request. Only the API's own read snapshot
    // can name a new target; the preview and confirm still run the web use-case guards.
    if (claim !== true && ctx.requestId && ctx.membershipId) {
      const reads = await this.prisma.client.lineReadEvidence?.findMany?.({ where: {
        companyId: ctx.companyId, userId: ctx.userId, membershipId: ctx.membershipId, requestId: ctx.requestId,
        toolName: { in: claim === 'voucher' ? ['voucher.list_recent', 'voucher.get_detail'] : ['expense.list_recent', 'expense.get_detail'] },
        createdAt: { gte: new Date(Date.now() - 15 * 60_000) },
      }, take: 8, select: { toolName: true, inputJson: true } }) ?? [];
      if (reads.some(row => {
        const saved = row.inputJson as { chatKeyHash?: string; readMemory?: { tool?: string; shownItems?: Array<{ id: string }> } } | null;
        return saved?.chatKeyHash === chat && saved.readMemory?.tool === row.toolName && saved.readMemory.shownItems?.some(item => item.id === id);
      })) return true;
    }
    if (claim === false) {
    const captures = await this.repo.listRecentLineCaptures({ companyId: ctx.companyId, createdByUserId: ctx.userId,
      chatKeyHash: chat, since: new Date(Date.now() - 2 * 60 * 60_000), scopes: ctx.scopes ?? {}, take: 5, includeAllStatuses: true });
    if (captures.some(row => row.id === id)) return true;
    if ((await this.drafts.routeContexts(ctx, chat)).some(row => row.expenseId === id)) return true;
    }
    if (claim === true && (await this.shownApprovalNotices(ctx, chat)).some(item => item.id === id)) return true;
    // A list read earlier in this metered turn may prepare its card before the list is delivered.
    const claimReadTools = ['reimbursement.get_summary', 'reimbursement.get_detail', 'reimbursement.list_pending_approvals', 'reimbursement.get_approval_backlog'];
    const currentReads = claim === true ? await this.prisma.client.lineReadEvidence?.findMany?.({ where: { companyId: ctx.companyId, userId: ctx.userId,
      membershipId: ctx.membershipId, requestId: ctx.requestId, toolName: { in: claimReadTools }, createdAt: { gte: new Date(Date.now() - 60_000) } }, take: 12 }) ?? [] : [];
    if (currentReads.some(row => {
      const snapshot = row.inputJson as any;
      return snapshot?.chatKeyHash === chat && claimReadTools.includes(row.toolName)
        && snapshot.readMemory?.shownItems?.some((item: any) => item.id === id);
    })) return true;
    const outcomes = await this.prisma.client.lineTurnOutcome.findMany({ where: {
      companyId: ctx.companyId, deliveredAt: { gte: new Date(Date.now() - 15 * 60_000) },
      authorizationJson: { path: ['readMemory', 'chatKeyHash'], equals: chat },
    }, orderBy: { deliveredAt: 'desc' }, take: 15, select: { authorizationJson: true } });
    const entries = outcomes.flatMap(row => {
      const memory = (row.authorizationJson as any)?.readMemory;
      return memory?.companyId === ctx.companyId && memory?.userId === ctx.userId && memory?.membershipId === ctx.membershipId
        && Array.isArray(memory.entries) ? memory.entries : [];
    }).slice(0, 3);
    const plans = await this.prisma.client.lineDeliveryPlan?.findMany?.({ where: { companyId: ctx.companyId, userId: ctx.userId,
      createdAt: { gte: new Date(Date.now() - 15 * 60_000) }, planJson: { path: ['authorization', 'actor', 'chatKeyHash'], equals: chat } },
      orderBy: { createdAt: 'desc' }, take: 50, select: { planJson: true, planHash: true, batchStateJson: true } }) ?? [];
    const quotedTool = claim === 'voucher' ? 'voucher.get_detail' : claim ? 'reimbursement.get_detail' : 'expense.get_detail';
    for (const row of plans) {
      const plan = parseLineDeliveryPlan(row.planJson);
      if (!plan || row.planHash !== deliveryHash(plan) || plan.authorization.kind !== 'PRIVATE') continue;
      const actor = plan.authorization.actor;
      if (actor.companyId === ctx.companyId && actor.userId === ctx.userId && actor.membershipId === ctx.membershipId && actor.chatKeyHash === chat
        && parseDeliveryBatchStates(row.batchStateJson, plan)?.some(state => state.status === 'ACCEPTED' && state.sentMessageIds?.length)
        && quoteRecordsFromPlan(plan).some(record => record.tool === quotedTool && record.id === id)) return true;
    }
    return entries.some(entry => typeof entry.tool === 'string' && (claim === 'voucher' ? entry.tool.startsWith('voucher.') : (claim ? ['reimbursement.get_summary', 'reimbursement.get_detail', 'reimbursement.list_pending_approvals', 'reimbursement.get_approval_backlog'] : ['expense.list_recent', 'expense.get_detail', 'expense.list_substitute_receipts_to_sign']).includes(entry.tool))
      && entry.shownItems?.some((item: any) => item.id === id));
  }
  private isClaim(action: ExpenseAction | string) { return typeof action === 'string' && action.startsWith('REIMBURSEMENT_'); }
  private isVoucher(action: string): action is VoucherAction { return (VOUCHER_ACTIONS as readonly string[]).includes(action); }
  private question(entry: StoredAction, language: LineReplyLanguage = entry.preview.language ?? 'th') {
    if (entry.allowedPaymentMethods) return E_WHT_WORDS['L-10'];
    if (language === 'en') return entry.awaitingField === 'payeeName' ? 'Who is the payee for this voucher?'
      : entry.awaitingField === 'claimSlip' ? 'Please send the transfer slip to prepare reimbursement confirmation.'
        : entry.awaitingField === 'paymentMethod' ? 'Was payment by cash, bank transfer, card or cheque?'
          : entry.awaitingField === 'payeeAddress' ? 'What payee address should appear on the tax certificate?'
            : entry.preview.action === 'REIMBURSEMENT_CANCEL' ? 'Why are you cancelling this claim?'
            : entry.preview.action === 'VOID' ? 'Why are you voiding this expense?'
              : entry.preview.action === 'VOUCHER_RETURN' ? 'Why are you returning this voucher for correction?'
                : entry.preview.action === 'VOUCHER_CANCEL' ? 'Why are you cancelling this voucher?' : 'Why are you rejecting this claim?';
    return entry.awaitingField === 'payeeName' ? 'ขอชื่อผู้รับเงินสำหรับใบเตรียมจ่ายนี้ค่ะ' : entry.awaitingField === 'claimSlip' ? 'ส่งสลิปโอนมาได้เลยค่ะ น้องจะเตรียมการ์ดบันทึกจ่ายคืน' : entry.preview.action === 'REIMBURSEMENT_CANCEL' ? 'ยกเลิกใบเบิกนี้เพราะอะไรคะ' : entry.preview.action === 'VOID' ? 'ยกเลิกรายการนี้เพราะอะไรคะ' : entry.awaitingField === 'paymentMethod' ? 'จ่ายด้วยเงินสด โอนเงิน บัตร หรือเช็คคะ' : entry.awaitingField === 'payeeAddress' ? 'ขอที่อยู่ผู้รับเงินที่จะพิมพ์บน 50 ทวิค่ะ' : entry.preview.action === 'VOUCHER_RETURN' ? 'ส่งใบเตรียมจ่ายนี้กลับแก้ไขเพราะอะไรคะ' : entry.preview.action === 'VOUCHER_CANCEL' ? 'ยกเลิกใบเตรียมจ่ายนี้เพราะอะไรคะ' : 'ไม่อนุมัติใบเบิกนี้เพราะอะไรคะ'; }
  private async read(ctx: RequestContext, id: string, action: ExpenseAction, voucher?: VoucherActionPayload) {
    if (voucher) return this.vouchers!.read(ctx, voucher);
    if (!this.isClaim(action)) {
      const r = await this.getExpense.execute(ctx, id);
      return { ...r, digest: expenseTaxSourceChecksum(r), claim: undefined as ReimbursementRequestDetail | undefined };
    }
    const claim = await this.getClaim!.execute(ctx, id);
    return { id: claim.id, branchId: claim.branchId ?? null, createdByUserId: claim.requesterUserId,
      updatedAt: new Date(claim.updatedAt), expenseDate: new Date(claim.incurredDate), vendorNameSnapshot: claim.requesterDisplayNameSnapshot,
      grandTotalAmount: claim.amount, currency: claim.currency, status: claim.status, claim,
      digest: deliveryHash({ id: claim.id, updatedAt: claim.updatedAt, status: claim.status, amount: claim.amount,
        hash: claim.approvalSnapshotHash, payout: claim.payout, lines: claim.lines }),
    };
  }
  private status(action: ExpenseAction, status: string): string {
    const labels: Record<string, string> = this.isClaim(action) || this.isVoucher(action) ? { DRAFT: 'ร่าง', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิกแล้ว', FINANCE_REVIEW: 'รอตรวจการเงิน', READY_FOR_PAYMENT: 'รอจ่าย', PARTIALLY_PAID: 'จ่ายบางส่วนแล้ว', PAID: 'จ่ายแล้ว', RETURNED: 'ส่งกลับแก้ไข', VOIDED: 'ยกเลิกแล้ว' } : EXPENSE_STATUS_LABELS;
    return labels[status] ?? 'รอตรวจสอบ';
  }
  private async validateClaim(ctx: RequestContext, claim: ReimbursementRequestDetail, action: ExpenseAction, reason?: string, expectedUpdatedAt?: Date, previewOnly = true) {
    const line = { previewOnly, expectedUpdatedAt };
    switch (action) {
      case 'REIMBURSEMENT_SUBMIT': return this.submitClaim!.execute(ctx, claim.id, { payoutSubmitToken: claim.payout?.submitToken }, line);
      case 'REIMBURSEMENT_CANCEL': return this.cancelClaim!.execute(ctx, claim.id, reason, undefined, line);
      case 'REIMBURSEMENT_APPROVE': return this.approveClaim!.execute(ctx, claim.id, undefined, claim.approvalSnapshotHash, claim.payout?.version, claim.payout?.holderType === 'THIRD_PARTY' ? true : undefined, line);
      case 'REIMBURSEMENT_REJECT': return this.rejectClaim!.execute(ctx, claim.id, reason ?? '', undefined, line);
    }
  }
  /** Use the web submit guards (including payout/token) without any mutation. */
  async claimSubmitReadiness(ctx: RequestContext, id: string, language: LineReplyLanguage = 'th') {
    try {
      const claim = await this.getClaim!.execute(ctx, id);
      await this.validateClaim(ctx, claim, 'REIMBURSEMENT_SUBMIT');
      return { ready: true as const };
    } catch (error) {
      return { ready: false as const, ...this.claimSubmitRefusal(error, ctx, id, language, true) };
    }
  }
  async canSubmitClaim(ctx: RequestContext, id: string): Promise<boolean> {
    return (await this.claimSubmitReadiness(ctx, id)).ready;
  }
  private claimSubmitRefusal(error: unknown, ctx: RequestContext, id: string, language: LineReplyLanguage, includeReceiptBlocker = false) {
    if (!(error instanceof HttpException)) throw error;
    const response = error.getResponse();
    const code = typeof response === 'object' && response ? String((response as any).code ?? (response as any).message ?? error.message) : String(response);
    const en = language === 'en';
    if (error.getStatus() === 404) return { reply: REIMBURSEMENT_DRAFT_CHANGED[language],
      webPath: `/companies/${ctx.companyId}/reimbursements`, webLabel: en ? 'Open claims' : 'เปิดรายการใบเบิก' };
    let reply = en ? 'Review the claim details before submitting.' : 'ตรวจข้อมูลใบเบิกให้ครบก่อนส่งอนุมัติค่ะ';
    let webLabel = en ? 'Open claim' : 'เปิดใบเบิก';
    let webPath = `/companies/${ctx.companyId}/reimbursements/${id}`;
    if (/payout_(?:method_required|destination_required|destination_changed)/u.test(code)) {
      reply = en ? 'Ask the requester to set up the reimbursement payout account before submitting.' : 'ให้ผู้เบิกตั้งบัญชีรับเงินคืนก่อนส่งอนุมัติค่ะ';
      webLabel = en ? 'Set payout account' : 'ตั้งบัญชีรับเงินคืน';
      webPath = `/companies/${ctx.companyId}/reimbursements/payout-account`;
    } else if (/Branch is outside|branch.*scope/iu.test(code)) {
      reply = en ? 'Ask a user authorized for this branch to submit the claim.' : 'ให้ผู้มีสิทธิ์ในสาขานี้ส่งอนุมัติใบเบิกค่ะ';
      webLabel = en ? 'Open claims' : 'เปิดรายการใบเบิก';
      webPath = `/companies/${ctx.companyId}/reimbursements`;
    } else if (error.getStatus() === 403) {
      reply = en ? 'Ask the requester or a finance reviewer with submit permission to submit this claim.' : 'ให้ผู้เบิกหรือผู้ตรวจการเงินที่มีสิทธิ์ส่งอนุมัติส่งใบเบิกนี้ค่ะ';
    } else if (/Cannot submit from status/u.test(code)) {
      reply = en ? 'Only a draft claim can be submitted; check its current status.' : 'ส่งอนุมัติได้เฉพาะร่างใบเบิก เปิดตรวจสถานะปัจจุบันค่ะ';
    } else if (/duplicate_unresolved/u.test(code)) {
      reply = en ? 'Review the possible duplicate before submitting.' : 'ตรวจใบเบิกที่อาจซ้ำก่อนส่งอนุมัติค่ะ';
    } else if (/(?:attachment|expense)_already_claimed/u.test(code)) {
      reply = en ? 'This evidence is already used on another claim; review this claim.' : 'หลักฐานนี้ใช้กับใบเบิกอื่นแล้ว เปิดตรวจรายการก่อนค่ะ';
    } else if (/reimbursement_source_review_required/u.test(code)) {
      reply = en ? 'Review the source expense before submitting.' : 'ตรวจบิลต้นทางในใบเบิกก่อนส่งอนุมัติค่ะ';
    } else if (/reimbursement_policy_inactive/u.test(code)) {
      reply = en ? 'Ask the shop owner to activate the claim policy.' : 'ให้เจ้าของกิจการเปิดใช้นโยบายใบเบิกก่อนค่ะ';
    } else if (/missing_receipt_reason_required/u.test(code)) {
      reply = en ? 'Add the missing receipt reason on the claim before submitting.' : 'ระบุเหตุผลที่ไม่มีใบเสร็จในใบเบิกก่อนส่งอนุมัติค่ะ';
      webLabel = en ? 'Attach evidence' : 'แนบหลักฐาน';
    } else if (/missing_receipt|invalid_primary_attachment|invalid_linked_expense|REIMBURSEMENT_EVIDENCE_BRANCH_MISMATCH/u.test(code)) {
      reply = en ? 'Attach valid evidence from the same branch before submitting.' : 'แนบหลักฐานที่ถูกต้องของสาขาเดียวกับใบเบิกก่อนส่งอนุมัติค่ะ';
      webLabel = en ? 'Attach evidence' : 'แนบหลักฐาน';
    } else if (/lines_required|too_many_lines|line_|amount_|incurred_date/u.test(code)) {
      reply = en ? 'Complete the claim item details before submitting.' : 'เติมรายละเอียดรายการเบิกให้ครบก่อนส่งอนุมัติค่ะ';
    }
    return { reply, webPath, webLabel, ...(includeReceiptBlocker && /^(?:missing_receipt|missing_receipt_reason_required)$/u.test(code) ? { receiptMissing: true } : {}) };
  }
  private async recentSlip(ctx: RequestContext, chat: string, expenseId: string) {
    const rows = await this.repo.listRecentLineCaptures({ companyId: ctx.companyId, createdByUserId: ctx.userId,
      chatKeyHash: chat, since: new Date(Date.now() - 15 * 60_000), scopes: ctx.scopes ?? {}, take: 5, includeAllStatuses: true });
    const slips = rows.filter(r => r.sourceDocumentType === 'TRANSFER_SLIP');
    if (slips.length !== 1) return undefined;
    const slip = await this.repo.findById(ctx.companyId, slips[0]!.id);
    if ((slip?.sourceChannelMetadataJson as any)?.linePaymentEvidence?.state === 'LINKED' && (slip?.sourceChannelMetadataJson as any)?.linePaymentEvidence?.receiptId !== expenseId) return undefined;
    if (!slip?.primaryAttachmentId || !['DRAFT', 'NEEDS_REVIEW'].includes(slip.status) && !((slip.sourceChannelMetadataJson as any)?.linePaymentEvidence?.state === 'LINKED' && slip.status === 'VOIDED') || (slip.sourceChannelMetadataJson as any)?.linePaymentEvidenceSeparate) return undefined;
    return { id: slip.id, revision: slip.updatedAt.toISOString(), attachmentId: slip.primaryAttachmentId!,
      ...(expenseDateIsReadable(slip.aiVerificationSummaryJson) ? { paidAt: slip.expenseDate?.toISOString().slice(0, 10) } : {}) };
  }
  private async checkSlip(ctx: RequestContext, chat: string, evidence: NonNullable<StoredAction['evidence']>, tx?: Prisma.TransactionClient) {
    const slip = await (tx ?? this.prisma.client).expenseRecord.findFirst({ where: { companyId: ctx.companyId, id: evidence.id } });
    if (!slip || slip.createdByUserId !== ctx.userId || slip.captureSource !== 'LINE_UPLOAD'
      || (slip.sourceChannelMetadataJson as any)?.chatKeyHash !== chat || slip.sourceDocumentType !== 'TRANSFER_SLIP'
      || slip.updatedAt.toISOString() !== evidence.revision || slip.primaryAttachmentId !== evidence.attachmentId
      || !isBranchInScope(ctx.scopes ?? {}, slip.branchId)) throw new ConflictException('expense_source_version_changed');
  }
  async paymentIntentFromText(text: string, evidence?: LineAiInputEvidenceV2): Promise<Partial<RecordExpensePaymentInput>> {
    const paymentMethod = /เงินสด|^CASH$/iu.test(text) ? 'CASH' : /โอน|^BANK_TRANSFER$/iu.test(text) ? 'BANK_TRANSFER' : /บัตร|^CARD$/iu.test(text) ? 'CARD' : /เช็ค|เช็ก|^CHEQUE$/iu.test(text) ? 'CHEQUE' : /อื่น|^OTHER$/iu.test(text) ? 'OTHER' : undefined;
    const input = evidence?.parts.map(part => part.rawText).join('\n') === text ? evidence : (await createLineAiInputEvidence({ turnKey: deliveryHash(text), parts: [{ partId: 'part-0', eventIdHash: deliveryHash(text), acceptedAtMs: Date.now(), rawText: text }] }))?.inputEvidence;
    const today = input?.parts[0] ? new Date(input.parts[0].acceptedAtMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) : todayCivilDate('Asia/Bangkok');
    const candidates = input ? await extractValueCandidatesV2(input, today) : undefined;
    const amounts = candidates?.amounts.filter(item => item.currencyToken ? /^(?:บาท|บ\.?|฿|THB|baht)$/iu.test(item.currencyToken) : paymentMethod && !lineWorkflowPickerText(text).explicit) ?? [];
    const dates = [...(candidates?.dates.map(item => item.isoDate) ?? []), ...(candidates?.periods.filter(item => item.kind === 'day' && item.fromDate === item.toDate).map(item => item.fromDate) ?? [])];
    return { ...(paymentMethod ? { paymentMethod } : {}), ...(amounts.length === 1 ? { paidAmount: amounts[0]!.value } : {}), ...(dates.length === 1 ? { paidAt: dates[0]! } : {}) };
  }
  async openWorkflow(ctx: RequestContext, chat: string, control: Extract<LineWorkflowControl, { action: 'wf_open' }>, language: LineReplyLanguage = 'th', reason?: string, typedPayment?: Partial<RecordExpensePaymentInput>): Promise<{ preview?: ExpenseActionPreview; reply: string; webPath?: string; webLabel?: string; question?: boolean }> {
    if (ctx.freeExpenseDrafts || !verifyLineWorkflowOpenSig(this.config.aiGatewayInternalSecret ?? '', ctx.companyId, ctx.userId,
      control.act, control.id, control.pm ?? '', control.pd ?? '', control.pa ?? '', control.sig)) return { reply: EXPIRED };
    return this.preview(ctx, chat, { action: control.act, ...(control.act === 'RECORD_PAYMENT' ? { ...typedPayment, requirePaymentMethod: true } : control.act === 'CONFIRM' && (typedPayment || control.pm || control.pd || control.pa) ? { ...typedPayment, offerPaymentAfterConfirm: true } : {}),
      ...(this.isClaim(control.act) ? { reimbursementId: control.id } : this.isVoucher(control.act) && control.act !== 'VOUCHER_CREATE'
        ? { voucherId: control.id } : { expenseId: control.id }),
      ...(control.pm ? { paymentMethod: control.pm } : {}), ...(control.pd ? { paidAt: control.pd } : {}),
      ...(control.pa ? { paidAmount: control.pa } : {}), ...(reason ? { reason } : {}) }, true, undefined, language);
  }

  async resolveNamedTargets(ctx: RequestContext, chat: string, action: ExpenseAction, workflow: LineWorkflowId, evidence: LineAiInputEvidenceV2, input: Record<string, unknown>, pickerAnswer = false): Promise<
    { targets?: Array<LineWorkflowRecordTarget | LineWorkflowTargets['targets'][number]>; requestedVoucherCount?: number; exhaustive?: boolean; hasIdentifier?: boolean; searchedExact?: boolean } | { reply: string; webPath: string }> {
    const webPath = `/companies/${ctx.companyId}/${this.isClaim(action) ? 'reimbursements' : 'expenses'}`;
    const unavailable = { reply: LINE_CLAIM_PICKER_COPY.unavailable, webPath };
    const candidates = await extractValueCandidatesV2(evidence, todayCivilDate('Asia/Bangkok'));
    if (candidates?.completeness !== 'complete') return unavailable;
    const text = mapThaiDigits(evidence.parts.map(part => part.rawText).join('\n'));
    const parsed = lineWorkflowPickerText(text, this.isClaim(action));
    if (pickerAnswer && parsed.question) return { targets: [], hasIdentifier: false };
    let documents = parsed.documents;
    const rounds = parsed.rounds;
    const isTargetAmount = (amount: typeof candidates.amounts[number]) => {
      if (amount.currencyToken) return /^(?:บาท|บ\.?|฿|THB|baht)$/iu.test(amount.currencyToken);
      const raw = mapThaiDigits(evidence.parts.find(part => part.partId === amount.source.partId)!.rawText);
      if (documents.some(document => {
        const start = raw.indexOf(document);
        return start >= 0 && amount.source.startUtf16 >= start && amount.source.endUtf16 <= start + document.length;
      })) return false;
      if (action === 'WHT_CERTIFICATE_ISSUE' && [...raw.matchAll(/50\s*ทวิ/gu)].some(match => amount.source.startUtf16 >= match.index && amount.source.endUtf16 <= match.index + match[0].length)) return false;
      return ![...raw.matchAll(/(?:รอบ|สาขา|ใบที่|รายการที่|อันที่)\s*\d+|(?:บิล|ใบ|เอกสาร)?เลขที่\s*[^\s,]+|[A-Za-zก-๙]+[-/]\d[\d/-]*|\d+\s*(?:ใบ|บิล)/gu)]
        .some(match => amount.source.startUtf16 >= match.index && amount.source.endUtf16 <= match.index + match[0].length);
    };
    let amounts = candidates.amounts.filter(isTargetAmount);
    let named = documents.length > 0 || rounds.length > 0 || amounts.length === 1;
    if (!named && action !== 'VOUCHER_CREATE' && !pickerAnswer) return {};
    if (!named && action === 'VOUCHER_CREATE' && !pickerAnswer) {
      const pending = await this.store.load(ctx.companyId, this.key(chat));
      if (pending?.voucher?.action === action && await this.bound(ctx, chat, pending)) {
        // These source IDs were already accepted in this owner-bound task; a new model call cannot add a bill.
        return { targets: pending.voucher.expenseIds!.map(id => ({ id, label: '', amount: '', currency: '' })), requestedVoucherCount: pending.voucher.requestedBillCount };
      }
    }
    if (!this.workflowTargets) return unavailable;
    if (!pickerAnswer) await this.claimPickers.discard(ctx.companyId, `expense-action-claim-picker:${chat}`);
    const voucherAction = action === 'VOUCHER_SUBMIT' || action === 'VOUCHER_APPROVE' || action === 'VOUCHER_PAY' ? action : undefined;
    let result = await this.workflowTargets.pick(ctx, chat, workflow, { ...(voucherAction ? { voucherAction, ...(parsed.documents.length ? { search: text } : {}) } : {}) }, 1);
    let searchedDocument: string | undefined;
    if (pickerAnswer && !result.exhaustive) {
      searchedDocument = parsed.documents.length === 1 ? parsed.documents[0] : undefined;
      const claimSearch = this.isClaim(action) ? lineClaimTargetSearch(text, amounts) : undefined;
      const search = searchedDocument ?? (claimSearch || undefined);
      if (search) result = await this.workflowTargets.pick(ctx, chat, workflow, { search, ...(voucherAction ? { voucherAction } : {}) }, 1);
    }
    if ((rounds.length || pickerAnswer) && !this.isClaim(action) && action !== 'WHT_CERTIFICATE_ISSUE') {
      for (const target of result.targets as LineWorkflowRecordTarget[]) {
        const record = await this.repo.findByIdWithRelations(ctx.companyId, target.id, undefined, ctx.scopes);
        target.roundText = [target.roundText, ...(record?.lines ?? []).map(line => line.description)].filter(Boolean).join(' ');
        if (pickerAnswer) target.branchId = record?.branchId ?? undefined;
      }
    }
    if (pickerAnswer && action === 'WHT_CERTIFICATE_ISSUE' && /สาขา/u.test(text)) {
      if (!this.vouchers) return unavailable;
      for (const target of result.targets as LineWorkflowRecordTarget[]) {
        target.branchId = (await this.vouchers.read(ctx, { action, id: target.id, handoffs: [] })).branchId ?? undefined;
      }
    }
    const numbers = (target: typeof result.targets[number]): string[] => 'requestNo' in target
      ? target.requestNo ? [target.requestNo] : [] : (target as LineWorkflowRecordTarget).documentNumbers ?? [];
    // Keep the most specific record-number spelling actually present in user text.
    const literalNumbers = result.targets.flatMap(numbers).map(mapThaiDigits)
      .filter(number => /[A-Za-zก-๙]/u.test(number) && text.includes(number));
    documents = [...new Set([...documents.filter(document => !literalNumbers.some(number => number.includes(document) || document.endsWith(number))), ...literalNumbers])].sort((a, b) => text.indexOf(a) - text.indexOf(b));
    amounts = candidates.amounts.filter(isTargetAmount);
    named = documents.length > 0 || rounds.length > 0 || amounts.length === 1;
    if (pickerAnswer && amounts.length > 1) return { targets: [], exhaustive: result.exhaustive, hasIdentifier: true };
    const normalize = (value: string) => mapThaiDigits(value).toLocaleLowerCase().replace(/\s+/gu, '');
    const branches = pickerAnswer ? await this.prisma.client.branch.findMany({ where: { companyId: ctx.companyId,
      id: { in: result.targets.flatMap(target => target.branchId ? [target.branchId] : []) } }, select: { id: true, name: true } }) : [];
    const namedBranches = branches.filter(branch => {
      const at = normalize(text).indexOf(normalize(branch.name));
      return at >= 0 && !/\d/u.test(normalize(text).charAt(at + normalize(branch.name).length));
    });
    let remaining = text;
    if (pickerAnswer) {
      for (const document of documents) remaining = remaining.replaceAll(document, '');
      for (const amount of amounts) remaining = remaining.replace(mapThaiDigits(amount.span), '').replace(amount.currencyToken ?? /$^/u, '');
      for (const branch of namedBranches) remaining = remaining.replaceAll(mapThaiDigits(branch.name), '');
      remaining = remaining.replace(/รอบ\s*\d+|(?:ที่)?สาขา\s*[^\s?？]+/gu, '')
        .replace(/(?:บิล|ใบ|เอกสาร)?เลขที่|เลขเอกสาร|จำนวนเงิน|ยอด|บาท|ร่าง|ใบนี้|รายการนี้|ผู้ขาย|คำอธิบาย|ของฉัน|[?？·,]/gu, '').trim();
    }
    const searchWords = pickerAnswer ? remaining.split(/\s+/u).map(normalize).filter(word => word.length >= 3) : [];
    const strongIdentifier = parsed.explicit || amounts.length === 1;
    const targetWords = (target: typeof result.targets[number]) => normalize(['title' in target ? target.title : (target as LineWorkflowRecordTarget).label, 'reason' in target ? target.reason : '', 'categoryLabelSnapshot' in target ? target.categoryLabelSnapshot : '', 'requesterDisplayNameSnapshot' in target ? target.requesterDisplayNameSnapshot : '', (target as LineWorkflowRecordTarget).roundText].filter(Boolean).join(' '));
    const namedClaims = this.isClaim(action) && pickerAnswer ? matchLineClaimTargets<LineWorkflowRecordTarget | LineWorkflowTargets['targets'][number]>(text, result.targets, candidates.amounts, ctx.userId) : undefined;
    const hasIdentifier = strongIdentifier || !!namedClaims?.length || result.targets.some(target => searchWords.length > 0 && searchWords.every(word => targetWords(target).includes(word)));
    const matches = (target: typeof result.targets[number]) => {
      if (pickerAnswer && parsed.requester && (parsed.requester === 'ฉัน'
        ? (target as LineWorkflowTargets['targets'][number]).requesterUserId !== ctx.userId
        : !normalize((target as LineWorkflowTargets['targets'][number]).requesterDisplayNameSnapshot ?? '').includes(normalize(parsed.requester)))) return false;
      if (pickerAnswer && ((/สาขา\s*/u.test(text) || namedBranches.length) && !namedBranches.some(branch => branch.id === target.branchId)
        || !strongIdentifier && searchWords.some(word => !targetWords(target).includes(word)))) return false;
      if (this.isClaim(action) && text.includes('ของฉัน') && (target as LineWorkflowTargets['targets'][number]).requesterUserId !== ctx.userId) return false;
      if (amounts.length === 1 && (target.currency !== 'THB' || !new Decimal(target.amount).eq(amounts[0]!.value))) return false;
      const label = 'title' in target ? [target.title, target.reason, target.categoryLabelSnapshot].filter(Boolean).join(' ') : (target as LineWorkflowRecordTarget).roundText ?? '';
      return rounds.every(round => [...mapThaiDigits(label).matchAll(/รอบ\s*(\d+)/gu)].some(match => match[1] === round));
    };
    const eligible = namedClaims ? namedClaims.filter(target => !/สาขา/u.test(text) || namedBranches.some(branch => branch.id === target.branchId)) : result.targets.filter(matches);
    const byDocument = documents.map(document => eligible.filter(target => numbers(target).some(number => searchedDocument
      ? normalize(number) === normalize(searchedDocument) : lineDocumentNumberMatches(number, document))));
    const targets = documents.length ? [...new Map(byDocument.flat().map(target => [target.id, target])).values()] : eligible;
    const unique = result.exhaustive && (documents.length ? byDocument.every(rows => rows.length === 1) : targets.length === 1)
      && (action === 'VOUCHER_CREATE' || targets.length === 1);
    if (pickerAnswer) return { targets: byDocument.some(rows => !rows.length) ? [] : targets, exhaustive: result.exhaustive, hasIdentifier,
      searchedExact: !!searchedDocument && targets.length === 1 && byDocument.every(rows => rows.length === 1) };
    if (named && unique) return { targets };
    const previous = await this.store.load(ctx.companyId, this.key(chat));
    if (previous) await this.store.discardIfCurrent(ctx.companyId, this.key(chat), previous.previewId);
    const owner = (await this.owner(ctx, chat))!;
    const filtered = { ...result, targets: (targets.length ? targets : result.targets).slice(0, 4) };
    const paymentIntent = ['RECORD_PAYMENT', 'REIMBURSEMENT_RECORD_PAYMENT'].includes(action) && amounts.length === 1
      && typeof input.paidAmount === 'string'
      ? { pa: amounts[0]!.value, ...(typeof input.paymentMethod === 'string' ? { pm: input.paymentMethod } : {}),
        ...(typeof input.paidAt === 'string' ? { pd: input.paidAt } : {}) } : undefined;
    if (!await this.claimPickers.save({ previewId: randomUUID(), companyId: ctx.companyId, userId: ctx.userId, membershipId: ctx.membershipId!,
      chatKeyHash: `expense-action-claim-picker:${chat}`, conversationId: owner.id, ownerEpoch: owner.lifecycleEpoch,
      requestId: ctx.requestId, workflow: workflow as ClaimWorkflowId | ExpenseWorkflowId, result: filtered as LineWorkflowTargets | LineWorkflowRecordTargets,
      ...(paymentIntent ? { paymentIntent } : {}) })) return unavailable;
    return { reply: this.isClaim(action) ? LINE_CLAIM_PICKER_COPY.choose[workflow as ClaimWorkflowId] : LINE_EXPENSE_PICKER_COPY.choose[workflow as ExpenseWorkflowId], webPath };
  }

  async preview(ctx: RequestContext, chat: string | undefined, input: Record<string, unknown>, opened = false,
    preparedCategory?: { category: ActionCategory; source: ExpenseRecordWithRelations }, language: LineReplyLanguage = 'th', requestedVoucherCount?: number, inputEvidence?: LineAiInputEvidenceV2): Promise<{ preview?: ExpenseActionPreview; reply: string; webPath?: string; webLabel?: string; question?: boolean }> {
    const en = language === 'en';
    if (ctx.freeExpenseDrafts) return { reply: EXPIRED };
    if (chat && inputEvidence && lineWorkflowPickerText(inputEvidence.parts.map(p => p.rawText).join('\n')).question) {
      const pending = await this.collectionQuestion(ctx, chat, language);
      if (pending) return { reply: pending.reply };
    }
    input = { ...input };
    for (const field of ['reason', 'payeeName', 'payeeAddress']) {
      const value = input[field];
      if (typeof value !== 'string') continue;
      if (lineWorkflowPickerText(value).question || isLineWorkflowPutOff(value)) delete input[field];
      else input[field] = stripLineFieldParticles(field === 'reason' ? value.replace(/^เหตุผล(?:คือ)?\s*[:：]?\s*/u, '') : value);
    }
    let action = input.action as ExpenseAction;
    const requestedId = this.isVoucher(action ?? '') && action !== 'VOUCHER_CREATE' ? input.voucherId : this.isClaim(action ?? '') ? input.reimbursementId : action === 'VOUCHER_CREATE' && typeof input.expenseIds === 'string' ? input.expenseIds.split(',')[0]?.trim() : input.expenseId;
    if (!EXPENSE_ACTIONS.some(value => value === action) || typeof requestedId !== 'string' || !requestedId || requestedId.length > 200) return { reply: (en ? 'Which record and action would you like?' : 'ต้องการทำอะไรกับรายการไหนคะ') };
    let id: string = requestedId;
    if (!chat || !ctx.membershipId || !this.config.aiGatewayInternalSecret || !await this.owner(ctx, chat)) return { reply: (en ? 'Please use a private chat.' : 'กรุณาทำรายการในแชตส่วนตัวค่ะ') };
    let ids = action === 'VOUCHER_CREATE' && typeof input.expenseIds === 'string' ? input.expenseIds.split(',').map(id => id.trim()) : [id];
    let approvers: string[] | undefined;
    try {
      let resolvedFromText = false;
      let selected: Array<LineWorkflowRecordTarget | LineWorkflowTargets['targets'][number]> = [];
      if (inputEvidence) {
        const workflow = Object.entries({ ...CLAIM_WORKFLOW_ACTIONS, ...EXPENSE_WORKFLOW_ACTIONS }).find(([, value]) => value === action)?.[0] as LineWorkflowId | undefined;
        if (workflow) {
          const selection = await this.resolveNamedTargets(ctx, chat, action, workflow, inputEvidence, input);
          if ('reply' in selection) return selection;
          if (selection.targets) {
            requestedVoucherCount ??= selection.requestedVoucherCount;
            selected = selection.targets;
            ids = selected.map(target => target.id);
            id = ids[0]!;
            input = { ...input, ...(this.isClaim(action) ? { reimbursementId: id } : { expenseId: id }),
              ...(action === 'VOUCHER_CREATE' ? { expenseIds: ids.join(',') } : {}) };
            resolvedFromText = true;
          }
        }
      }
      if (ids.length > DISBURSEMENT_VOUCHER_MAX_LINES) return { reply: en ? `Select up to ${DISBURSEMENT_VOUCHER_MAX_LINES} expenses and put the remaining expenses on another voucher.` : DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_too_many_lines };
      if (ids.some(id => !id || id.length > 200)) return { reply: en ? 'Select an expense shown in this chat.' : 'ขอเลือกจากรายการที่แสดงในแชตนี้ก่อนค่ะ' };
      if (!opened && !resolvedFromText && !(await Promise.all(ids.map(id => this.grounded(ctx, chat, id, this.isVoucher(action) && action !== 'VOUCHER_CREATE' ? 'voucher' : this.isClaim(action))))).every(Boolean)) return { reply: (en ? 'Please select a record already shown in this chat.' : 'ขอเลือกจากรายการที่แสดงในแชตนี้ก่อนค่ะ') };
      if (opened && (action === 'VOUCHER_SUBMIT' || action === 'VOUCHER_APPROVE' || action === 'VOUCHER_PAY')) {
        await this.vouchers!.authorize(ctx, action);
        const current = await this.vouchers!.read(ctx, { action, id });
        if (current.status !== LINE_VOUCHER_WORKFLOW_STATUS[action]) return {
          reply: en ? `This voucher is ${lineUiLabel(current.status, 'en').toLowerCase()}. Open it to continue.`
            : `ใบเตรียมจ่ายนี้${current.status === 'DRAFT' ? 'ยังเป็นร่าง' : this.status(action, current.status)} เปิดใบในเว็บเพื่อทำต่อค่ะ`,
          webPath: `/companies/${ctx.companyId}/expenses/disbursement-vouchers/${id}`,
        };
      }
      const voucher = this.isVoucher(action) ? await this.vouchers!.prepare(ctx, action, id, input, language, requestedVoucherCount) : undefined;
      if (voucher) action = voucher.payload.action;
      const record = voucher?.record ?? await this.read(ctx, id, action);
      for (const target of selected) {
        const revision = 'updatedAt' in target ? target.updatedAt : target.revision;
        const current = voucher?.payload.sources?.find(source => source.id === target.id)?.revision ?? record.updatedAt.toISOString();
        if (revision && revision !== current) throw new ConflictException('expense_source_version_changed');
      }
      if (action === 'RECORD_PAYMENT') {
        if (!ctx.permissions.includes('expense.payment.record')) return { reply: (en ? 'Ask the owner or an authorized payment recorder to do this.' : PERMISSION.RECORD_PAYMENT) };
        const expense = await this.getExpense.execute(ctx, id);
        const paidReply = paidExpenseReply(expense);
        if (paidReply) return { reply: paidReply };
        const state = expense.sourceChannelMetadataJson?.lineSubstituteReceiptContinuation as { status?: string } | undefined;
        if (state?.status === 'OPEN' || state?.status === 'PAUSED'
          || ['PREPARED', 'PAYER_CERTIFIED'].includes(expense.substituteReceiptEvidence?.status ?? '')) {
          return { reply: (en ? 'A substitute receipt is in progress; select Continue substitute receipt.' : 'กำลังจัดทำใบรับรองแทนใบเสร็จอยู่ค่ะ กดทำใบรับรองต่อเพื่อทำขั้นตอนที่เหลือ') };
        }
      }
      if (action === 'RECORD_PAYMENT' && ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(record.status)) {
        const confirmation = await this.preview(ctx, chat, { ...input, action: 'CONFIRM', expenseId: id, recordPaymentAfterConfirm: true, paidAt: input.paidAt ?? todayCivilDate('Asia/Bangkok') }, opened);
        const reply = `ต้องยืนยันรายการก่อนบันทึกจ่ายค่ะ ${confirmation.reply}`;
        return { ...confirmation, reply };
      }
      const paymentIntent = action === 'CONFIRM' && (input.recordPaymentAfterConfirm === true || input.offerPaymentAfterConfirm === true)
        ? { ...(input.offerPaymentAfterConfirm ? { offerPaymentAfterConfirm: true } : {}), paidAt: input.paidAt ?? todayCivilDate('Asia/Bangkok'), ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}), ...(input.paidAmount ? { paidAmount: input.paidAmount } : {}) } : undefined;
      if (paymentIntent && !ctx.permissions.includes('expense.payment.record')) return { reply: (en ? 'Ask the owner or an authorized payment recorder to do this.' : PERMISSION.RECORD_PAYMENT) };
      approvers = record.claim?.currentDesk?.kind === 'APPROVER' ? record.claim.currentDesk.names : undefined;
      const reason = typeof input.reason === 'string' ? input.reason.trim() : undefined;
      if (reason && reason.length > 1000) return { reply: (en ? 'Please shorten the reason.' : 'ขอเหตุผลสั้นลงอีกหน่อยค่ะ') };
      let nextStatus = action === 'CONFIRM' ? 'CONFIRMED' : action === 'VOID' ? 'VOIDED' : 'DELETED';
      if (action === 'MARK_READY') nextStatus = (await this.ready.previewLineAction(ctx, record.id)).target;
      let review: StoredAction['review'];
      let reviewSource: Awaited<ReturnType<GetExpenseUseCase['execute']>> | undefined;
      const markReady = action === 'CONFIRM' && ['DRAFT', 'NEEDS_REVIEW'].includes(preparedCategory?.source.status ?? record.status);
      if (action === 'CONFIRM') {
        try { await this.confirm.previewLineAction(ctx, record.id, undefined, markReady, preparedCategory?.source); }
        catch (error) {
          const response = error instanceof HttpException ? error.getResponse() : null;
          if (!response || typeof response !== 'object' || (response as any).code !== 'EXPENSE_EVIDENCE_REVIEW_REQUIRED') throw error;
          if (!ctx.permissions.includes('expense.review')) return { reply: (en ? 'Ask the owner or an expense reviewer to review the evidence before confirming.' : 'ให้เจ้าของกิจการหรือผู้มีสิทธิ์ตรวจรายจ่ายตรวจหลักฐานก่อนยืนยันค่ะ') };
          if (!this.updateDraft) throw error;
          const current = await this.getExpense.execute(ctx, id);
          if (current.updatedAt.getTime() !== record.updatedAt.getTime() || expenseTaxSourceChecksum(current) !== record.digest) throw new ConflictException('expense_source_version_changed');
          const expense = preparedCategory?.source ?? current;
          const receipt = EXPENSE_RECEIPT_SOURCE_TYPES.some(type => type === expense.sourceDocumentType) || expense.sourceDocumentType === 'NEEDS_REVIEW';
          const assessment: ExpenseEvidenceAssessment = input.evidenceAssessment as ExpenseEvidenceAssessment ?? expenseEvidenceAssessment(expense) ?? { route: receipt ? 'SOURCE_DOCUMENT' : 'ALTERNATIVE_EVIDENCE', receiptProblem: receipt ? 'NONE' : 'NOT_AVAILABLE',
            attachmentIds: expense.attachments.filter(file => isExpenseEvidenceFile(file) && file.id === expense.primaryAttachmentId).map(file => file.id), reason: '' };
          if (expenseEvidenceInputError(assessment, expense, true)) {
            if (expenseEvidenceImageMissing(expense)) return { reply: en ? 'Review the document details on the web before confirming.' : 'ตรวจข้อมูลเอกสารในเว็บก่อนยืนยันค่ะ', webPath: `/companies/${ctx.companyId}/expenses/${id}` };
            if (preparedCategory) throw error;
            const owner = (await this.owner(ctx, chat))!;
            if (!await this.evidenceChoices.save({ language, previewId: randomUUID(), companyId: ctx.companyId, userId: ctx.userId, membershipId: ctx.membershipId,
              chatKeyHash: `expense-action-evidence:${chat}`, conversationId: owner.id, ownerEpoch: owner.lifecycleEpoch, expenseId: id,
              revision: expense.updatedAt.toISOString(), digest: expenseTaxSourceChecksum(expense), requestId: ctx.requestId, stage: 'choice', paymentIntent })) throw error;
            return { reply: new Decimal(expense.whtAmount).gt(0)
              ? expense.whtRemittance === 'E_WHT' ? E_WHT_WORDS['L-3'] : (en ? 'Review the evidence to confirm this expense before preparing its payment voucher and withholding certificate.' : 'ตรวจหลักฐานเพื่อยืนยันรายจ่ายก่อนสร้างใบเตรียมจ่ายและออกหนังสือรับรอง 50 ทวิค่ะ')
              : (en ? 'Please choose the evidence for this expense.' : 'เลือกหลักฐานที่ใช้กับรายการนี้ได้เลยค่ะ') };
          }
          // All confirmation validators must pass; evidence review must be the only remaining blocker.
          await this.confirm.previewLineAction(ctx, record.id, assessment, markReady, preparedCategory?.source);
          review = { assessment, fingerprint: expenseEvidenceFingerprint(expense, assessment), filesHash: deliveryHash([...expense.attachments].sort((a, b) => a.id.localeCompare(b.id) || a.purpose.localeCompare(b.purpose))) };
          reviewSource = expense;
        }
      }
      if (action === 'DELETE_DRAFT') await this.remove.previewLineAction(ctx, record.id);
      const awaitingReason = (action === 'REIMBURSEMENT_REJECT' || action === 'REIMBURSEMENT_CANCEL' || action === 'VOID') && !reason;
      if (action === 'VOID') await this.voidExpense.previewLineAction(ctx, record.id, awaitingReason ? 'รอเหตุผลจากผู้ใช้' : reason ?? '');
      if (record.claim && action !== 'REIMBURSEMENT_RECORD_PAYMENT') await this.validateClaim(ctx, record.claim, action, awaitingReason ? 'รอเหตุผลจากผู้อนุมัติ' : reason);
      let payment: RecordExpensePaymentInput | undefined, evidence: StoredAction['evidence'];
      let allowedPaymentMethods = voucher?.allowedPaymentMethods;
      const paymentDetails: string[] = [];
      let claimPayment: RecordReimbursementPaymentInput | undefined;
      const awaitingClaimSlip = action === 'REIMBURSEMENT_RECORD_PAYMENT' && typeof input.slipAttachmentId !== 'string';
      if (action === 'REIMBURSEMENT_RECORD_PAYMENT') {
        if (!ctx.permissions.includes('reimbursement.payment.record')) return { reply: (en ? 'Ask an authorized finance user to record reimbursement.' : PERMISSION.REIMBURSEMENT_RECORD_PAYMENT) };
        const claim = record.claim!;
        if (!['APPROVED', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID'].includes(claim.status)) return { reply: (en ? 'This claim is not ready to record reimbursement.' : 'ใบเบิกนี้ยังไม่พร้อมบันทึกจ่ายคืนค่ะ') };
        const destination = claim.payout?.version ? claim.payout : claim.legacyPayoutDefault;
        if (claim.payout?.payoutMethod === 'CASH') return { reply: en ? 'Record this cash reimbursement on the web.' : 'บันทึกจ่ายคืนใบเบิกที่รับเงินสดในเว็บได้ค่ะ', webPath: `/companies/${ctx.companyId}/reimbursements/${id}` };
        if (!destination) return { reply: (en ? 'Open the claim on the web to review the payout account and payment method.' : 'เปิดใบเบิกเพื่อตรวจบัญชีรับเงินและวิธีจ่ายก่อนบันทึกจ่ายคืนค่ะ'),
          webPath: `/companies/${ctx.companyId}/reimbursements/${id}` };
        claimPayment = { paidAmount: typeof input.paidAmount === 'string' ? input.paidAmount : new Decimal(claim.outstandingAmount).toFixed(2),
          paidAt: typeof input.paidAt === 'string' ? input.paidAt : todayCivilDate('Asia/Bangkok'), paymentMethod: 'BANK_TRANSFER', currency: claim.currency,
          ...(claim.payout?.version ? { payoutDestinationVersion: claim.payout.version, payoutConfirmed: true }
            : { payoutDefaultToken: claim.legacyPayoutDefault!.confirmToken, payoutConfirmed: true }),
          ...(typeof input.slipAttachmentId === 'string' ? { slipAttachmentId: input.slipAttachmentId } : {}) };
        if (!awaitingClaimSlip) await this.claimPayment!.execute(ctx, id, claimPayment, { previewOnly: true, expectedUpdatedAt: record.updatedAt });
      }

      let paymentChange: { status: string; nextStatus: string } | undefined;
      if (action === 'RECORD_PAYMENT') {
        if (['paidAmount', 'paidAt', 'paymentMethod'].some(key => input[key] !== undefined && typeof input[key] !== 'string')) return { reply: (en ? 'Please provide the payment amount and date.' : 'ขอจำนวนเงินและวันที่จ่ายให้ชัดเจนค่ะ') };
        const expense = await this.getExpense.execute(ctx, id);
        evidence = await this.recentSlip(ctx, chat, id);
        if (evidence) await this.checkSlip(ctx, chat, evidence);
        const slipDate = evidence?.paidAt;
        payment = { paidAmount: typeof input.paidAmount === 'string' ? input.paidAmount : new Decimal(calcPaymentAmounts(expense.netPayableAmount, expense.paidAmount).outstandingAmount).toFixed(2),
          paidAt: typeof input.paidAt === 'string' ? input.paidAt : slipDate ?? todayCivilDate('Asia/Bangkok'),
          ...(typeof input.paymentMethod === 'string' ? { paymentMethod: input.paymentMethod as RecordExpensePaymentInput['paymentMethod'] } : expense.whtRemittance === 'E_WHT' ? { paymentMethod: 'BANK_TRANSFER' as const } : {}) };
        try { await this.payment!.previewLineAction(ctx, id, payment); }
        catch (error) {
          if (!(error instanceof ConflictException) || (error.getResponse() as { code?: string }).code !== 'expense_ewht_payment_method') throw error;
          allowedPaymentMethods = ['BANK_TRANSFER', 'CHEQUE', 'OTHER'];
        }
        if (expense.whtRemittance === 'E_WHT') {
          paymentDetails.push(E_WHT_WORDS['L-2']);
          if (eWhtRateKind(expense.whtCategoryCode) === 'REDUCED' && Number(expense.whtRate) === 1 && !eWhtReducedRateOn(expense.whtCategoryCode, payment.paidAt ?? '')) paymentDetails.push(E_WHT_WORDS['L-9']);
        }
        paymentChange = { status: PAYMENT_LABELS[derivePaymentStatus(expense.netPayableAmount, expense.paidAmount)],
          nextStatus: PAYMENT_LABELS[derivePaymentStatus(expense.netPayableAmount, new Decimal(expense.paidAmount).plus(payment.paidAmount).toString())] };
        if (evidence) {
          if (!ctx.permissions.includes('attachment.create') && !await this.prisma.client.attachmentLink.findFirst({ where: { companyId: ctx.companyId, targetType: 'expense.record', targetId: id, attachmentId: evidence.attachmentId, purpose: 'expense.payment.evidence' } })) return { reply: (en ? 'You need permission to attach evidence before recording payment with this slip.' : 'ต้องมีสิทธิ์แนบหลักฐานก่อนบันทึกจ่ายพร้อมสลิปค่ะ') };
        }
        nextStatus = 'CONFIRMED';
      }
      if (voucher) nextStatus = voucher.nextStatus;
      if (action === 'VOUCHER_PAY' && voucher?.payload.payment) payment = { paidAmount: record.grandTotalAmount, paidAt: voucher.payload.payment.paidDate, paymentMethod: voucher.payload.payment.paymentMethod };
      if (action === 'VOUCHER_PAY') { evidence = await this.recentSlip(ctx, chat, id); if (evidence) await this.checkSlip(ctx, chat, evidence); }
      if (record.claim) nextStatus = action === 'REIMBURSEMENT_RECORD_PAYMENT' ? 'PAID' : action === 'REIMBURSEMENT_REJECT' ? 'REJECTED' : action === 'REIMBURSEMENT_CANCEL' ? 'CANCELLED' : action === 'REIMBURSEMENT_SUBMIT' ? 'PENDING_APPROVAL' : 'APPROVED';
      // A fresh, explicit preview cannot claim an already completed action is pending.
      if (!voucher && action !== 'RECORD_PAYMENT' && record.status === nextStatus) return { reply: (en ? 'This action has already been completed.' : 'รายการนี้ดำเนินการแล้วค่ะ') };
      const owner = (await this.owner(ctx, chat))!;
      const preview: ExpenseActionPreview = { language, previewId: randomUUID(), token: '', action, ...(reason ? { reason } : {}),
        ...(review && reviewSource ? { evidenceReview: true, details: [
          `VAT: ${reviewSource.vatAmount} ${reviewSource.currency === 'THB' ? en ? 'THB' : 'บาท' : reviewSource.currency} · ${lineUiLabel(EXPENSE_VAT_MODE_LABELS[reviewSource.vatMode], language)}`,
          `${en ? 'Document' : 'เอกสาร'}: ${lineUiLabel(SOURCE_DOCUMENT_TYPE_LABELS[reviewSource.sourceDocumentType], language)} · ${lineUiLabel(TAX_EVIDENCE_STATUS_LABELS[reviewSource.taxEvidenceStatus], language)}`,
          `${en ? 'Attachments' : 'ไฟล์แนบ'} ${new Set(reviewSource.attachments.filter(isExpenseEvidenceFile).map(file => file.id)).size} ${en ? 'files' : 'ไฟล์'}${reviewSource.attachments.some(file => isExpenseEvidenceFile(file) && file.purpose === 'expense.payment.evidence') ? en ? ' including the payment slip' : ' รวมสลิปจ่ายเงิน' : ''}`,
          ...(review.assessment.reason ? [`${en ? 'Evidence reason' : 'เหตุผลใช้หลักฐาน'}: ${scrubRecordText(review.assessment.reason, 200)}`] : []),
          en ? 'Confirm your review of these details and evidence, then confirm the expense.' : 'กดเพื่อตรวจรับรองข้อมูลและหลักฐานที่แสดง แล้วจึงยืนยันรายการค่ะ',
        ] } : {}),
        ...(payment ? { payment } : {}),
        ...(record.claim?.payout ? { details: [record.claim.payout.payoutMethod === 'CASH' ? (en ? 'Cash payout' : 'รับเงินสด') : `${en ? 'Payout account' : 'บัญชีรับเงิน'}: ${scrubRecordText(record.claim.payout.bankName ?? '', 60)} ${scrubRecordText(record.claim.payout.accountName ?? '', 80)} ${en ? 'ending' : 'ลงท้าย'} ${(/^\d{4}$/u.test(record.claim.payout.accountLast4 ?? '') ? record.claim.payout.accountLast4 : 'ไม่ระบุ')}` , ...(action === 'REIMBURSEMENT_APPROVE' && record.claim.payout.payoutMethod === 'BANK_TRANSFER' ? [(en ? 'Approve to attest that you reviewed this account.' : 'กดอนุมัติเพื่อรับรองว่าตรวจบัญชีนี้แล้วค่ะ'), ...(record.claim.payout.holderType === 'THIRD_PARTY' ? [(en ? 'Accept the specified transfer to a third-party account.' : 'ยอมรับการโอนเข้าบัญชีบุคคลอื่นตามที่ระบุค่ะ')] : [])] : [])] } : {}),
        ...(payment ? { details: [`${en ? 'Payment' : 'จ่าย'} ${payment.paidAmount} ${record.currency === 'THB' ? en ? 'THB' : 'บาท' : record.currency} ${en ? 'on' : 'วันที่'} ${lineDisplayDate(payment.paidAt ?? '', language)}`, ...(payment.paymentMethod ? [`${en ? 'Payment method' : 'วิธีจ่าย'}: ${payment.paymentMethod === 'CASH' ? (en ? 'Cash' : 'เงินสด') : payment.paymentMethod === 'BANK_TRANSFER' ? (en ? 'Bank transfer' : 'โอนเงิน') : payment.paymentMethod === 'CARD' ? (en ? 'Card' : 'บัตร') : payment.paymentMethod === 'CHEQUE' ? (en ? 'Cheque' : 'เช็ค') : (en ? 'Other' : 'วิธีอื่น')}`] : []), ...(evidence ? [(en ? 'Attach the slip from this chat as payment evidence.' : 'แนบสลิปที่ส่งในแชตนี้เป็นหลักฐานจ่ายค่ะ')] : [])] } : {}),
        ...(claimPayment ? { details: [`${en ? 'Reimbursement' : 'จ่ายคืน'} ${claimPayment.paidAmount} ${record.currency === 'THB' ? en ? 'THB' : 'บาท' : record.currency} ${en ? 'on' : 'วันที่'} ${lineDisplayDate(claimPayment.paidAt, language)}`,
          `${en ? 'Payout account' : 'บัญชีรับเงิน'}: ${scrubRecordText(record.claim?.payout?.bankName ?? record.claim?.legacyPayoutDefault?.bankName ?? '', 60)} ${scrubRecordText(record.claim?.payout?.accountName ?? record.claim?.legacyPayoutDefault?.accountName ?? '', 80)} ${en ? 'ending' : 'ลงท้าย'} ${scrubRecordText(record.claim?.payout?.accountLast4 ?? record.claim?.legacyPayoutDefault?.accountLast4 ?? '', 4)}`,
          (en ? 'Confirm that the transfer went to this account and the recipient matches the claim.' : 'กดยืนยันเพื่อรับรองว่าโอนเข้าบัญชีนี้และชื่อผู้รับตรงกับใบเบิกค่ะ'), (en ? 'Attach the slip from this chat as reimbursement evidence.' : 'แนบสลิปที่ส่งในแชตนี้เป็นหลักฐานจ่ายคืนค่ะ')] } : {}),
        ...(voucher ? { details: [...voucher.details, ...(evidence ? [(en ? 'Attach the slip from this chat as payment evidence.' : 'แนบสลิปที่ส่งในแชตนี้เป็นหลักฐานจ่ายค่ะ')] : [])] } : {}),
        expiresAt: new Date(Date.now() + LINE_DRAFT_PREVIEW_TTL_SECONDS * 1000).toISOString(),
        summary: en ? `Please review the details, then select ${lineUiLabel(EXPENSE_ACTION_LABELS[action], language)}.` : `กรุณาตรวจรายละเอียดแล้วกด${EXPENSE_ACTION_LABELS[action]}ค่ะ`,
        record: { vendorName: scrubRecordText(record.vendorNameSnapshot, 80) || 'ไม่ระบุผู้ขาย', amount: record.grandTotalAmount,
          currency: record.currency, date: record.expenseDate.toISOString().slice(0, 10), status: lineUiLabel(this.status(action, record.status), language),
          nextStatus: record.claim ? record.claim.payoutCorrection && action === 'REIMBURSEMENT_REJECT' ? (en ? 'Awaiting payout correction' : 'รอผู้เบิกแก้บัญชี') : en ? lineUiLabel(EXPENSE_ACTION_LABELS[action], language) : `${EXPENSE_ACTION_LABELS[action]}แล้ว` : nextStatus === 'DELETED' ? (en ? 'Deleted' : 'ลบแล้ว') : lineUiLabel(this.status(action, nextStatus), language) } };
      if (paymentChange) Object.assign(preview.record, paymentChange);
      if (paymentDetails.length) preview.details = [...(preview.details ?? []), ...paymentDetails];
      const evidenceSource = 'attachments' in record ? { ...record, aiVerificationSummaryJson: review ? { ...record.aiVerificationSummaryJson, documentEvidenceDraft: review.assessment } : record.aiVerificationSummaryJson } : undefined;
      if (action === 'CONFIRM' && evidenceSource && expenseEvidenceImageMissing(evidenceSource)) {
        preview.details = [...(preview.details ?? []), ...lineExpenseEvidenceNotes(evidenceSource, language)];
        if (this.config.webBaseUrl?.startsWith('https://')) preview.documentImageUrl = `${this.config.webBaseUrl.replace(/\/$/u, '')}/companies/${ctx.companyId}/expenses/${id}`;
      }
      if (paymentIntent) preview.details = [...(preview.details ?? []), en ? `After confirming, record payment for ${lineDisplayDate(String(paymentIntent.paidAt), language)}.` : `หลังยืนยัน กดบันทึกจ่ายวันที่ ${formatThaiDate(String(paymentIntent.paidAt))}ค่ะ`];
      const entry: StoredAction = { previewId: preview.previewId, companyId: ctx.companyId, userId: ctx.userId, membershipId: ctx.membershipId,
        chatKeyHash: this.key(chat), conversationId: owner.id, ownerEpoch: owner.lifecycleEpoch, expenseId: record.id,
        branchId: record.branchId, createdByUserId: record.createdByUserId, revision: record.updatedAt.toISOString(), digest: record.digest, requestId: ctx.requestId, preview, review, markReady, paymentIntent: paymentIntent ?? (voucher ? { ...(typeof input.paidAt === 'string' ? { paidAt: input.paidAt } : {}), ...(typeof input.paymentMethod === 'string' ? { paymentMethod: input.paymentMethod } : {}), ...(typeof input.paidAmount === 'string' ? { paidAmount: input.paidAmount } : {}) } : undefined), category: preparedCategory?.category, evidence, awaitingReason, voucher: voucher?.payload, allowedPaymentMethods, awaitingField: allowedPaymentMethods || action === 'RECORD_PAYMENT' && input.requirePaymentMethod && !payment?.paymentMethod ? 'paymentMethod' : awaitingClaimSlip ? 'claimSlip' : voucher?.awaitingField,
        ...(record.claim ? { claim: { ...(claimPayment ? { payment: claimPayment } : {}), payoutSubmitToken: record.claim.payout?.submitToken, hash: record.claim.approvalSnapshotHash, payoutVersion: record.claim.payout?.version, thirdParty: record.claim.payout?.holderType === 'THIRD_PARTY' } } : {}) };
      if (preparedCategory) preview.details = [`${preparedCategory.category.kind === 'wht' ? 'จ่ายค่าอะไร' : 'หมวดค่าใช้จ่าย'}: ${scrubRecordText(preparedCategory.category.name, 100)}`, ...(preview.details ?? [])];
      preview.token = `${entry.previewId}.${this.sign(entry)}`;
      const recovery = { companyId: ctx.companyId, userId: ctx.userId, tokenHash: deliveryHash(preview.token), act: action as typeof LINE_WORKFLOW_OPEN_ACTIONS[number],
        id: voucher?.payload.id ?? record.id,
        ...(typeof input.paymentMethod === 'string' ? { pm: input.paymentMethod } : preview.payment?.paymentMethod ? { pm: preview.payment.paymentMethod } : {}),
        ...(typeof input.paidAt === 'string' ? { pd: input.paidAt } : preview.payment?.paidAt ? { pd: preview.payment.paidAt } : {}),
        ...(typeof input.paidAmount === 'string' ? { pa: input.paidAmount } : preview.payment?.paidAmount ? { pa: preview.payment.paidAmount } : {}) };
      if (!await this.store.save(entry, recovery)) return { reply: (en ? 'A previous request is still in progress; please try again.' : 'กำลังดำเนินการคำขอก่อนหน้าค่ะ กรุณาลองอีกครั้ง') };
      if (awaitingReason || entry.awaitingField) return { question: true, reply: allowedPaymentMethods ? E_WHT_WORDS['L-1'] : this.question(entry) };
      return { preview, reply: preview.summary };
    } catch (error) {
      if (action === 'REIMBURSEMENT_SUBMIT') return this.claimSubmitRefusal(error, ctx, id as string, language);
      const reply = this.refusal(error, action, approvers, language);
      if (action === 'CONFIRM' || action === 'MARK_READY') {
        const fields = missingActionFields(error);
        if (fields.length && (ctx.permissions.includes('expense.update') || ctx.permissions.includes('expense.review'))) {
          const record = await this.getExpense.execute(ctx, id);
          const owner = await this.owner(ctx, chat);
          if (owner) {
            const state = parseLineExpenseDraftContinuation(record.sourceChannelMetadataJson?.lineExpenseDraftContinuation);
            const suggested = new Set(state?.items.map(item => item.suggestedCategoryId));
            suggested.add(readAiCategorySuggestion(record.aiVerificationSummaryJson)?.expenseCategoryId);
            const whtMissing = fields.includes('whtCategoryCode');
            if (whtMissing && !ctx.permissions.includes('expense.create') && !ctx.permissions.includes('procurement.supplier_payment.read'))
              return { reply, webPath: `/companies/${ctx.companyId}/expenses/${id}` };
            const categoryMissing = fields.some(field => field === 'category' || field === 'expenseCategoryId');
            const categories = whtMissing ? (await new ListWhtIncomeCategoriesUseCase(this.prisma).execute(ctx)).map(row => ({ id: row.code, name: row.nameTh, kind: 'wht' as const })) : categoryMissing ? (await this.repo.listCategories(ctx.companyId)).filter(category => category.status === 'ACTIVE')
              .sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id))).map(({ id, name }) => ({ id, name })) : [];
            if (whtMissing && !categories.length) return { reply: en ? 'No choices are available; type ‘ติดต่อเจ้าหน้าที่’ to ask the team for help.' : 'ยังไม่มีรายการให้เลือก พิมพ์ ‘ติดต่อเจ้าหน้าที่’ ให้ทีมงานช่วยค่ะ' };
            if (categoryMissing && !categories.length) return { reply: language === 'en' ? 'Ask the shop administrator to add an active expense category first.' : `${reply.replace(/ค่ะ$/u, '')} ให้ผู้ดูแลเพิ่มหมวดที่ใช้งานก่อนค่ะ` };
            if (await this.repairs.save({ language, previewId: randomUUID(), companyId: ctx.companyId, userId: ctx.userId, membershipId: ctx.membershipId!,
              chatKeyHash: `expense-action-repair:${chat}`, conversationId: owner.id, ownerEpoch: owner.lifecycleEpoch,
              expenseId: id, revision: record.updatedAt.toISOString(), requestId: ctx.requestId, action, reply, categories, offset: 0,
              priorCategory: preparedCategory?.category, evidenceAssessment: input.evidenceAssessment as ExpenseEvidenceAssessment | undefined,
              paymentIntent: action === 'CONFIRM' && input.recordPaymentAfterConfirm ? { paidAt: input.paidAt, paymentMethod: input.paymentMethod, paidAmount: input.paidAmount } : undefined,
              categoryOnly: fields.every(field => ['category', 'expenseCategoryId', 'review', 'whtCategoryCode'].includes(field)) })) {
              return { reply: whtMissing ? (en ? 'Please choose the withholding income category.' : 'เลือกว่ารายการนี้จ่ายค่าอะไรค่ะ') : categoryMissing ? `${reply.replace(/ค่ะ$/u, '')} เลือกหมวดด้านล่างหรือพิมพ์ชื่อหมวดได้เลยค่ะ` : reply };
            }
          }
        }
      }
      return { reply, ...(['REIMBURSEMENT_APPROVE', 'REIMBURSEMENT_SUBMIT'].includes(action) ? { webPath: `/companies/${ctx.companyId}/reimbursements/${id}` } : {}) };
    }
  }
  private async repair(ctx: RequestContext, chat: string, requestId?: string) {
    const repair = await this.repairs.load(ctx.companyId, `expense-action-repair:${chat}`);
    if (!repair || repair.userId !== ctx.userId || repair.membershipId !== ctx.membershipId || requestId && repair.requestId !== requestId
      || !ctx.permissions.includes('expense.update') && !ctx.permissions.includes('expense.review')) return null;
    const owner = await this.owner(ctx, chat);
    if (!owner || owner.id !== repair.conversationId || owner.lifecycleEpoch !== repair.ownerEpoch) return null;
    return repair;
  }
  async repairChoices(ctx: RequestContext, chat: string, requestId?: string, language: LineReplyLanguage = 'th') {
    const pending = await this.store.load(ctx.companyId, this.key(chat));
    if (pending?.awaitingField === 'paymentMethod' && pending.allowedPaymentMethods
      && (!requestId || pending.requestId === requestId) && await this.bound(ctx, chat, pending)) {
      const record = await this.read(ctx, pending.expenseId, pending.preview.action, pending.voucher).catch(() => null);
      if (!record || record.updatedAt.toISOString() !== pending.revision || record.digest !== pending.digest || !await this.permitted(ctx, pending)) return [];
      const methods = pending.paymentMethodQuestion ? ['BANK_TRANSFER', 'CHEQUE'] as const : ['BANK_TRANSFER'] as const;
      const choices: Array<{ label: string; text: string; data?: string; uri?: string }> = methods.map(method => {
        const selected = { ...pending, preview: { ...pending.preview, payment: { ...pending.preview.payment!, paymentMethod: method } } };
        const label = method === 'BANK_TRANSFER' ? 'โอนเงิน' : 'เช็ค';
        return { label, text: label, data: new URLSearchParams({ action: method === 'BANK_TRANSFER' ? 'expense_action_transfer' : 'expense_action_cheque', token: `${pending.previewId}.${this.sign(selected)}` }).toString() };
      });
      if (!pending.paymentMethodQuestion && this.config.webBaseUrl?.startsWith('https://')) {
        const path = pending.voucher ? 'expenses/disbursement-vouchers' : 'expenses';
        choices.push({ label: 'เปิดรายการ', text: 'เปิดรายการ', uri: `${this.config.webBaseUrl.replace(/\/$/u, '')}/companies/${ctx.companyId}/${path}/${pending.expenseId}` });
      }
      return choices;
    }
    if (pending?.awaitingField === 'payeeName' && (!requestId || pending.requestId === requestId) && await this.bound(ctx, chat, pending))
      return this.vouchers!.payeeChoices(ctx, language);
    if (pending?.awaitingField === 'claimSlip' && (!requestId || pending.requestId === requestId) && await this.bound(ctx, chat, pending))
      return [{ label: (language === 'en' ? 'Send transfer slip' : 'ส่งสลิปโอน'), text: (language === 'en' ? 'Send transfer slip for this claim' : 'ส่งสลิปโอนสำหรับใบเบิกนี้') }];
    const evidence = await this.evidenceChoice(ctx, chat, requestId);
    if (evidence) {
      if (expenseEvidenceImageMissing(evidence.expense)) {
        const uri = this.config.webBaseUrl?.startsWith('https://') ? `${this.config.webBaseUrl.replace(/\/$/u, '')}/companies/${ctx.companyId}/expenses/${evidence.expense.id}` : undefined;
        return uri ? [{ label: lineUiLabel('ส่งรูปเอกสาร', language), text: lineUiLabel('ส่งรูปเอกสาร', language), uri }] : [];
      }
      const choices: Array<{ label: string; text: string; uri?: string; cameraRoll?: boolean }> = [{ label: (language === 'en' ? 'Send receipt photo' : 'ส่งรูปใบเสร็จ'), text: (language === 'en' ? 'Send receipt photo' : 'ส่งรูปใบเสร็จ') }, { label: (language === 'en' ? 'Wait for receipt' : 'รอใบเสร็จ'), text: (language === 'en' ? 'Wait for receipt' : 'รอใบเสร็จ') }];
      const reviewUri = this.config.webBaseUrl ? `${this.config.webBaseUrl.replace(/\/$/u, '')}/companies/${ctx.companyId}/expenses/${evidence.expense.id}` : '';
      const next = new Decimal(evidence.expense.whtAmount).gt(0) && ctx.permissions.includes('expense.confirm') && reviewUri.startsWith('https://')
        ? [{ label: language === 'en' ? 'Review and confirm' : 'ตรวจเพื่อยืนยัน', text: language === 'en' ? 'Confirm this expense' : 'ยืนยันรายการนี้', uri: reviewUri }] : [];
      if (evidence.entry.stage === 'photo') return [...next, { ...choices[0]!, cameraRoll: true }];
      if (evidence.entry.stage === 'waiting') return [...next, ...choices.slice(0, 1)];
      const source = evidence.expense;
      if (!expenseEvidenceInputError({ route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: [], reason: '', originalDocumentAvailable: true }, source, true))
        choices.push({ label: language === 'en' ? 'Original in hand' : 'มีตัวจริง', text: language === 'en' ? 'Original in hand, no photo yet' : 'มีตัวจริง ยังไม่ได้แนบรูป' });
      if (!expenseEvidenceInputError({ route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE', attachmentIds: [], reason: '' }, source, true))
        choices.push({ label: (language === 'en' ? 'Substitute receipt' : 'ใบรับรองแทนใบเสร็จ'), text: (language === 'en' ? 'Prepare substitute receipt' : 'จัดทำใบรับรองแทนใบเสร็จ') });
      if (!expenseEvidenceInputError({ route: 'ALTERNATIVE_EVIDENCE', receiptProblem: 'NOT_AVAILABLE', attachmentIds: [...new Set(source.attachments.filter(isExpenseEvidenceFile).map(file => file.id))], reason: 'รอเหตุผลจากผู้ใช้' }, source, true)) choices.push({ label: (language === 'en' ? 'Use other evidence' : 'ใช้หลักฐานอื่นที่มี'), text: (language === 'en' ? 'Use other evidence' : 'ใช้หลักฐานอื่นที่มี') });
      return [...next, ...choices];
    }
    const repair = await this.repair(ctx, chat, requestId);
    if (!repair || repair.editPreviewId || !repair.categories.length) return null;
    const record = await this.getExpense.execute(ctx, repair.expenseId).catch(() => null);
    if (!record || record.updatedAt.toISOString() !== repair.revision) return null;
    const active = repair.categories.some(category => category.kind === 'wht')
      ? (await new ListWhtIncomeCategoriesUseCase(this.prisma).execute(ctx)).map(row => ({ id: row.code, name: row.nameTh, status: 'ACTIVE' }))
      : await this.repo.listCategories(ctx.companyId);
    return repair.categories.filter(category => active.some(current => current.status === 'ACTIVE' && current.id === category.id && current.name === category.name))
      .slice(repair.offset, repair.offset + 4).map(category => ({ label: scrubRecordText(category.name, 20), text: category.name }))
      .concat([{ label: (language === 'en' ? 'More categories' : 'อื่นๆ'), text: (language === 'en' ? 'Choose another category' : 'เลือกหมวดอื่น') }]);
  }
  private async evidenceChoice(ctx: RequestContext, chat: string, requestId?: string) {
    const entry = await this.evidenceChoices.load(ctx.companyId, `expense-action-evidence:${chat}`);
    if (!entry || entry.userId !== ctx.userId || entry.membershipId !== ctx.membershipId
      || requestId && entry.requestId !== requestId || !ctx.permissions.includes('expense.review')) return null;
    const owner = await this.owner(ctx, chat);
    if (!owner || owner.id !== entry.conversationId || owner.lifecycleEpoch !== entry.ownerEpoch) return null;
    const expense = await this.getExpense.execute(ctx, entry.expenseId).catch(() => null);
    if (!expense || expense.updatedAt.toISOString() !== entry.revision || expenseTaxSourceChecksum(expense) !== entry.digest) return null;
    return { entry, expense };
  }
  async answerEvidence(ctx: RequestContext, chat: string, text: string, language: LineReplyLanguage = 'th') {
    if (lineWorkflowPickerText(text).question || isLineWorkflowPutOff(text) || lineWorkflowCommand(text) && lineWorkflowPickerText(text, true).explicit) return null;
    text = ({ 'Send receipt photo': 'ส่งรูปใบเสร็จ', 'Wait for receipt': 'รอใบเสร็จ', 'Prepare substitute receipt': 'จัดทำใบรับรองแทนใบเสร็จ', 'Use other evidence': 'ใช้หลักฐานอื่นที่มี', cancel: 'ยกเลิก' } as Record<string, string>)[text.trim()] ?? text;
    const evidence = await this.evidenceChoice(ctx, chat);
    if (!evidence) return null;
    const { entry, expense } = evidence;
    if (text.trim() === 'มีตัวจริง ยังไม่ได้แนบรูป' || text.trim() === 'Original in hand, no photo yet') {
      const note = expenseEvidenceAssessment(expense)?.note;
      const assessment: ExpenseEvidenceAssessment = { route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: [], reason: '', originalDocumentAvailable: true, ...(note ? { note } : {}) };
      if (expenseEvidenceInputError(assessment, expense, true)) return { reply: language === 'en' ? 'Review the document type on the web before recording the original in hand.' : 'ตรวจประเภทเอกสารในเว็บก่อนระบุว่ามีตัวจริงค่ะ' };
      return this.preview(ctx, chat, { ...entry.paymentIntent, recordPaymentAfterConfirm: !!entry.paymentIntent, action: 'CONFIRM', expenseId: expense.id, evidenceAssessment: assessment }, true, undefined, language);
    }
    if (['ไม่ทำ', 'ยกเลิก'].includes(text.trim())) {
      await this.evidenceChoices.discard(ctx.companyId, entry.chatKeyHash);
      return { reply: (language === 'en' ? 'The existing draft is retained.' : 'เก็บร่างไว้ให้ค่ะ') };
    }
    if (expenseEvidenceImageMissing(expense) && ['ส่งรูปใบเสร็จ', 'รอใบเสร็จ', 'จัดทำใบรับรองแทนใบเสร็จ'].includes(text.trim())) {
      return this.preview(ctx, chat, { ...entry.paymentIntent, recordPaymentAfterConfirm: !!entry.paymentIntent, action: 'CONFIRM', expenseId: expense.id }, true, undefined, language);
    }
    if (text.trim() === 'รอใบเสร็จ') {
      if (!this.updateDraft) return { reply: language === 'en' ? 'This expense changed; review its current state before continuing.' : EXPENSE_ACTION_CHANGED };
      try {
        const assessment = expenseEvidenceAssessment(expense) ?? { route: 'ALTERNATIVE_EVIDENCE' as const,
          receiptProblem: 'NOT_AVAILABLE' as const, attachmentIds: [], reason: '' };
        await this.updateDraft.execute(ctx, expense.id, { expectedUpdatedAt: entry.revision, evidenceAssessment: assessment });
        const saved = await this.getExpense.execute(ctx, expense.id);
        entry.revision = saved.updatedAt.toISOString(); entry.digest = expenseTaxSourceChecksum(saved);
        entry.stage = 'waiting'; await this.evidenceChoices.save(entry);
        return { reply: (language === 'en' ? 'The draft is retained while waiting for the receipt.' : 'เก็บร่างไว้รอใบเสร็จแล้วค่ะ') };
      } catch (error) { return { reply: this.refusal(error, 'CONFIRM', undefined, language) }; }
    }
    if (text.trim() === 'ส่งรูปใบเสร็จ') {
      entry.stage = 'photo'; await this.evidenceChoices.save(entry);
      return { reply: new Decimal(expense.whtAmount).gt(0)
        ? (language === 'en' ? 'Attach the receipt or review and confirm this expense before preparing its payment voucher.' : 'แนบรูปใบเสร็จหรือกดตรวจเพื่อยืนยันรายจ่ายก่อนทำใบเตรียมจ่ายค่ะ')
        : (language === 'en' ? 'Please send the receipt photo to attach it to this draft.' : 'ส่งรูปใบเสร็จมาได้เลยค่ะ น้องจะแนบกับร่างนี้') };
    }
    if (text.trim() === 'จัดทำใบรับรองแทนใบเสร็จ'
      && !expenseEvidenceInputError({ route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE', attachmentIds: [], reason: '' }, expense, true)) {
      await this.evidenceChoices.discard(ctx.companyId, entry.chatKeyHash);
      return { substituteExpenseId: expense.id, reply: (language === 'en' ? 'Open the expense to prepare its substitute receipt.' : 'เปิดหน้ารายการเพื่อจัดทำใบรับรองแทนใบเสร็จค่ะ') };
    }
    if (text.trim() === 'ใช้หลักฐานอื่นที่มี' && expense.attachments.some(isExpenseEvidenceFile)) {
      entry.stage = 'reason'; await this.evidenceChoices.save(entry);
      return { reply: (language === 'en' ? 'Why should this evidence be used instead of a receipt?' : 'ใช้หลักฐานนี้แทนใบเสร็จเพราะอะไรคะ') };
    }
    if (entry.stage !== 'reason') return null;
    text = stripLineFieldParticles(text.replace(/^เหตุผล(?:คือ)?\s*[:：]?\s*/u, ''));
    if (!text) return { reply: language === 'en' ? 'Why should this evidence be used instead of a receipt?' : 'ใช้หลักฐานนี้แทนใบเสร็จเพราะอะไรคะ' };
    const assessment: ExpenseEvidenceAssessment = { route: 'ALTERNATIVE_EVIDENCE', receiptProblem: 'NOT_AVAILABLE',
      attachmentIds: [...new Set(expense.attachments.filter(isExpenseEvidenceFile).map(file => file.id))], reason: text.trim() };
    const error = expenseEvidenceInputError(assessment, expense, true);
    if (error) return { reply: language === 'en' ? 'This evidence needs review on the web before it can replace the receipt.' : `${error}ค่ะ` };
    const result = await this.preview(ctx, chat, { ...entry.paymentIntent, recordPaymentAfterConfirm: !!entry.paymentIntent, action: 'CONFIRM', expenseId: expense.id, evidenceAssessment: assessment }, true, undefined, language);
    if (result.preview) await this.evidenceChoices.discard(ctx.companyId, entry.chatKeyHash);
    return result;
  }
  async evidencePhotoTarget(ctx: RequestContext, chat: string, language: LineReplyLanguage = 'th') {
    const evidence = await this.evidenceChoice(ctx, chat);
    if (evidence?.entry.stage === 'photo') return { expenseId: evidence.expense.id, revision: evidence.entry.revision,
      primaryAttachmentId: evidence.expense.primaryAttachmentId, branchId: evidence.expense.branchId };
    const pending = await this.evidenceChoices.load(ctx.companyId, `expense-action-evidence:${chat}`);
    return pending?.stage === 'photo' && pending.userId === ctx.userId && pending.membershipId === ctx.membershipId
      ? { reply: language === 'en' ? 'This expense changed; review its current state before continuing.' : EXPENSE_ACTION_CHANGED } : null;
  }
  async afterEvidencePhoto(ctx: RequestContext, chat: string, expenseId: string, language: LineReplyLanguage = 'th') {
    const expense = await this.getExpense.execute(ctx, expenseId);
    if (!EXPENSE_RECEIPT_SOURCE_TYPES.some(type => type === expense.sourceDocumentType)) {
      await this.updateDraft!.execute(ctx, expenseId, { expectedUpdatedAt: expense.updatedAt.toISOString(), sourceDocumentType: 'RECEIPT' }, { requireExpectedUpdatedAt: true });
    }
    const pending = await this.evidenceChoices.load(ctx.companyId, `expense-action-evidence:${chat}`);
    await this.evidenceChoices.discard(ctx.companyId, `expense-action-evidence:${chat}`);
    return this.preview(ctx, chat, { ...pending?.paymentIntent, recordPaymentAfterConfirm: !!pending?.paymentIntent, expenseId, action: 'CONFIRM' }, true, undefined, language);
  }
  async answerCategory(ctx: RequestContext, chat: string, text: string, language: LineReplyLanguage = 'th') {
    if (lineWorkflowPickerText(text).question || isLineWorkflowPutOff(text) || lineWorkflowCommand(text) && lineWorkflowPickerText(text, true).explicit) return null;
    const repair = await this.repair(ctx, chat);
    if (!repair || repair.editPreviewId) return null;
    const choices = await this.repairChoices(ctx, chat, undefined, language);
    if (!choices) return null;
    if (text.trim() === 'เลือกหมวดอื่น' || text.trim() === 'Choose another category') {
      repair.offset = repair.offset + 4 < repair.categories.length ? repair.offset + 4 : 0;
      await this.repairs.save(repair);
      return { reply: (language === 'en' ? 'Choose an expense category or send its name.' : 'เลือกหมวดหรือพิมพ์ชื่อหมวดที่ต้องการได้เลยค่ะ') };
    }
    const category = repair.categories.find(category => text.trim() === category.name || text.trim() === `หมวด ${category.name}`);
    if (!category) return null;
    const selectedCategory: ActionCategory = { ...category, ...(repair.priorCategory && category.kind !== repair.priorCategory.kind ? { other: repair.priorCategory } : {}) };
    if (repair.action === 'CONFIRM' && repair.categoryOnly && this.updateDraft && ctx.permissions.includes('expense.update')) {
      const expense = await this.getExpense.execute(ctx, repair.expenseId);
      const revision = expense.updatedAt;
      try {
        const input = await this.categoryInput(ctx, expense, selectedCategory);
        await this.prisma.client.$transaction(async tx => {
          await this.updateDraft!.execute(ctx, expense.id, input, { db: tx, suppressGenericAudit: true, requireExpectedUpdatedAt: true });
          const source = await this.repo.findByIdWithRelations(ctx.companyId, expense.id, tx, ctx.scopes ?? {});
          if (!source) throw new ConflictException('expense_source_version_changed');
          throw new CategoryPreviewRollback({ ...source, updatedAt: revision });
        });
      } catch (error) {
        if (error instanceof CategoryPreviewRollback) {
          const result = await this.preview(ctx, chat, { ...repair.paymentIntent, recordPaymentAfterConfirm: !!repair.paymentIntent, ...(repair.evidenceAssessment ? { evidenceAssessment: repair.evidenceAssessment } : {}), expenseId: expense.id, action: 'CONFIRM' }, true, { category: selectedCategory, source: error.source }, language);
          if (result.preview) { await this.repairs.discard(ctx.companyId, repair.chatKeyHash); return result; }
          // A dependent income-category picker replaces this repair; missing evidence still needs the category edit first.
          if (selectedCategory.kind === 'wht' || selectedCategory.other || (await this.repair(ctx, chat))?.previewId !== repair.previewId) return result;
        } else if (!(error instanceof HttpException)) throw error;
      }
    }
    return { expenseId: repair.expenseId, tool: 'expense.draft.set_header' as const, input: { categoryName: category.name } };
  }
  private async categoryInput(ctx: RequestContext, expense: ExpenseRecordWithRelations, category: ActionCategory): Promise<import('@watchdog-bms/contracts').UpdateExpenseDraftInput> {
    if (!ctx.permissions.includes('expense.update')) throw new ForbiddenException();
    const other = category.other ? await this.categoryInput(ctx, expense, category.other) : {};
    if (category.kind === 'wht') {
      if (!(await new ListWhtIncomeCategoriesUseCase(this.prisma).execute(ctx)).some(row => row.code === category.id && row.nameTh === category.name)) throw new ConflictException('expense_source_version_changed');
      return { ...other, expectedUpdatedAt: expense.updatedAt.toISOString(), whtCategoryCode: category.id,
        ...(expense.whtInputJson?.inputType === 'RATE' ? { whtRate: expense.whtInputJson.value } : {}) };
    }
    if (!(await this.repo.listCategories(ctx.companyId)).some(current => current.status === 'ACTIVE' && current.id === category.id && current.name === category.name)) throw new ConflictException('expense_source_version_changed');
    const projected = projectLineDraftPatch(expense, { tool: 'expense.draft.set_header', categoryName: category.name, expenseCategoryId: category.id });
    if ('error' in projected) throw new BadRequestException(projected.error);
    return { ...other, expectedUpdatedAt: expense.updatedAt.toISOString(), lines: projected.lines };
  }
  async linkRepairEdit(ctx: RequestContext, chat: string, previewId: string) {
    const repair = await this.repair(ctx, chat);
    if (repair) { repair.editPreviewId = previewId; await this.repairs.save(repair); }
  }
  async afterRepairEdit(ctx: RequestContext, chat: string, previewId: string, expenseId: string) {
    const repair = await this.repair(ctx, chat);
    if (!repair || (repair.editPreviewId && repair.editPreviewId !== previewId) || repair.expenseId !== expenseId) return null;
    await this.repairs.discard(ctx.companyId, repair.chatKeyHash);
    return this.preview(ctx, chat, { ...repair.paymentIntent, recordPaymentAfterConfirm: !!repair.paymentIntent, expenseId, action: repair.action });
  }
  async teamCapacityReply(ctx: RequestContext, action: 'BRANCH_CREATE' | 'EMPLOYEE_CREATE', language: 'th' | 'en') { return this.teams?.capacityReply(ctx, action, language) ?? null; }
  async answerTeam(ctx: RequestContext, chat: string, text: string) { return this.teams?.answer(ctx, chat, text) ?? null; }
  async pendingWorkflowPicker(ctx: RequestContext, chat: string, requestId: string) {
    const picker = await this.claimPickers.load(ctx.companyId, `expense-action-claim-picker:${chat}`);
    if (!picker || picker.userId !== ctx.userId || picker.membershipId !== ctx.membershipId || picker.requestId !== requestId || ctx.freeExpenseDrafts) return null;
    const owner = await this.owner(ctx, chat);
    return owner?.id === picker.conversationId && owner.lifecycleEpoch === picker.ownerEpoch ? picker : null;
  }

  async pendingClaimPicker(ctx: RequestContext, chat: string, requestId: string) {
    const picker = await this.pendingWorkflowPicker(ctx, chat, requestId);
    return picker && Object.hasOwn(CLAIM_WORKFLOW_ACTIONS, picker.workflow) ? { ...picker, workflow: picker.workflow as ClaimWorkflowId, result: picker.result as LineWorkflowTargets } : null;
  }

  async collectionQuestion(ctx: RequestContext, chat: string, language: LineReplyLanguage = 'th') {
    const evidence = await this.evidenceChoice(ctx, chat);
    if (evidence?.entry.stage === 'reason') return { reply: language === 'en' ? 'Why should this evidence be used instead of a receipt?' : 'ใช้หลักฐานนี้แทนใบเสร็จเพราะอะไรคะ' };
    const entry = await this.store.load(ctx.companyId, this.key(chat));
    if (!entry || !(entry.awaitingField || entry.awaitingReason) || !await this.bound(ctx, chat, entry) || !await this.permitted(ctx, entry)) return null;
    const record = await this.read(ctx, entry.expenseId, entry.preview.action, entry.voucher).catch(() => null);
    if (!record || record.updatedAt.toISOString() !== entry.revision || record.digest !== entry.digest) return null;
    return { reply: this.question(entry, language), action: entry.preview.action, sourceId: entry.voucher?.id ?? entry.expenseId };
  }
  async pending(ctx: RequestContext, chat: string, requestId?: string): Promise<ExpenseActionPreview | null> {
    const team = await this.teams?.pending(ctx, chat, requestId);
    if (team) return team;
    const entry = await this.store.load(ctx.companyId, this.key(chat));
    if (!entry || entry.awaitingReason || entry.awaitingField || requestId && entry.requestId !== requestId || !await this.bound(ctx, chat, entry)) return null;
    const language = entry.preview.language ?? 'th';
    const record = await this.read(ctx, entry.expenseId, entry.preview.action, entry.voucher).catch(() => null);
    return record?.updatedAt.toISOString() === entry.revision && record.digest === entry.digest ? entry.preview : null;
  }
  async quoteRecords(ctx: RequestContext, chat: string, token: string) {
    const pending = await this.store.load(ctx.companyId, this.key(chat));
    const entry = pending?.preview.token === token ? pending : await this.store.loadApplied(ctx.companyId, this.key(chat));
    if (!entry || !await this.bound(ctx, chat, entry, token)) return [];
    return [{ tool: entry.voucher && entry.preview.action !== 'VOUCHER_CREATE' ? 'voucher.get_detail' as const
      : this.isClaim(entry.preview.action) ? 'reimbursement.get_detail' as const : 'expense.get_detail' as const,
      id: entry.voucher && entry.preview.action !== 'VOUCHER_CREATE' ? entry.voucher.id : entry.expenseId }];
  }
  async appliedPreview(ctx: RequestContext, chat: string, token: string): Promise<ExpenseActionPreview | null> {
    if (token.startsWith('team_')) return this.teams?.appliedPreview(ctx, chat, token) ?? null;
    const entry = await this.store.loadApplied(ctx.companyId, this.key(chat));
    if (!entry?.applied || !await this.bound(ctx, chat, entry, token) || !await this.permitted(ctx, entry)) return null;
    if (entry.applied.revision) {
      const language = entry.preview.language ?? 'th';
    const record = await this.read(ctx, entry.expenseId, entry.preview.action, entry.voucher).catch(() => null);
      if (!record || record.updatedAt.toISOString() !== entry.applied.revision || entry.applied.digest && record.digest !== entry.applied.digest) return null;
    }
    return entry.applied.preview;
  }
  private async expiredRecovery(ctx: RequestContext, previewId: string, token: string, language: LineReplyLanguage): Promise<ExpenseActionResult> {
    if (ctx.freeExpenseDrafts) return { status: 'blocked', reply: language === 'en' ? 'This confirmation expired; please request a new card.' : EXPIRED };
    const recovery = await this.store.loadRecovery(ctx.companyId, previewId);
    const tokenHash = deliveryHash(token);
    if (recovery?.companyId === ctx.companyId && recovery.userId === ctx.userId
      && typeof recovery.tokenHash === 'string' && recovery.tokenHash.length === tokenHash.length
      && timingSafeEqual(Buffer.from(recovery.tokenHash), Buffer.from(tokenHash))
      && LINE_WORKFLOW_OPEN_ACTIONS.includes(recovery.act) && typeof recovery.id === 'string' && recovery.id) {
      return { status: 'blocked', reply: 'การ์ดนี้หมดเวลาแล้วค่ะ',
        recovery: lineWorkflowOpenData(this.config.aiGatewayInternalSecret ?? '', ctx.companyId, ctx.userId,
          recovery.act, recovery.id, { ...(recovery.pm ? { pm: recovery.pm } : {}), ...(recovery.pd ? { pd: recovery.pd } : {}), ...(recovery.pa ? { pa: recovery.pa } : {}) }) };
    }
    return { status: 'blocked', reply: language === 'en' ? 'This confirmation expired; please request a new card.' : EXPIRED };
  }

  async apply(ctx: RequestContext, chat: string, control: ExpenseActionControl, language: LineReplyLanguage = 'th'): Promise<ExpenseActionResult> {
    const result = await this.applyAction(ctx, chat, control, language);
    if (result.status !== 'blocked' || result.taskSource || control.token.startsWith('team_')
      || ['expense_action_submit', 'expense_action_approve', 'expense_action_reject'].includes(control.action)) return result;
    const entry = await this.store.load(ctx.companyId, this.key(chat));
    return entry && await this.bound(ctx, chat, entry, control.token) ? { ...result,
      ...(entry.awaitingReason || entry.awaitingField ? { question: true } : {}),
      taskSource: { action: entry.preview.action, id: entry.voucher?.id ?? entry.expenseId } } : result;
  }

  private async applyAction(ctx: RequestContext, chat: string, control: ExpenseActionControl, language: LineReplyLanguage = 'th'): Promise<ExpenseActionResult> {
    if (control.token.startsWith('team_')) return this.teams?.apply(ctx, chat, control) ?? { status: 'blocked', reply: language === 'en' ? 'This confirmation expired; please request a new card.' : EXPIRED };
    if (control.action === 'expense_action_approve' || control.action === 'expense_action_reject' || control.action === 'expense_action_submit') {
      if (!verifyReimbursementApprovalOpenToken(this.config.aiGatewayInternalSecret ?? '', ctx.companyId, ctx.userId, control.token, control.action)) return { status: 'blocked', reply: language === 'en' ? 'This confirmation expired; please request a new card.' : EXPIRED };
      const result = await this.preview(ctx, chat, { reimbursementId: control.token.split('.')[0], action: control.action === 'expense_action_submit' ? 'REIMBURSEMENT_SUBMIT' : control.action === 'expense_action_approve' ? 'REIMBURSEMENT_APPROVE' : 'REIMBURSEMENT_REJECT' }, true, undefined, language);
      // Demo 2026-11-06: "ยังไม่ได้อนุมัติใบเบิกค่ะ เปิดใบเบิกในเว็บ…" came with no link; the refusal opens that claim.
      return result.preview ? { status: 'prepared', reply: result.reply, preview: result.preview } : { status: 'blocked', ...result,
        webPath: result.webPath ?? `/companies/${ctx.companyId}/reimbursements/${encodeURIComponent(control.token.split('.')[0]!)}`, webLabel: result.webLabel ?? (language === 'en' ? 'Open claim' : 'เปิดใบเบิก') };
    }
    if (control.action === 'expense_action_transfer' || control.action === 'expense_action_cheque') {
      const entry = await this.store.load(ctx.companyId, this.key(chat));
      const paymentMethod = control.action === 'expense_action_transfer' ? 'BANK_TRANSFER' as const : 'CHEQUE' as const;
      const selected = entry && { ...entry, preview: { ...entry.preview, payment: { ...entry.preview.payment!, paymentMethod } } };
      if (!entry || entry.awaitingField !== 'paymentMethod' || !entry.allowedPaymentMethods?.includes(paymentMethod)
        || !selected || !await this.bound(ctx, chat, selected, control.token)) return { status: 'blocked', reply: EXPIRED };
      const result = await this.answerReason(ctx, chat, paymentMethod);
      return result?.preview ? { status: 'prepared', ...result, preview: result.preview } : { status: 'blocked', reply: result?.reply ?? EXPIRED };
    }
    const id = control.token.split('.')[0]!;
    const applied = await this.store.loadApplied(ctx.companyId, this.key(chat));
    if (applied?.previewId === id && applied.applied && await this.bound(ctx, chat, applied, control.token)) {
      if (applied.voucher) { try { await this.vouchers!.authorize(ctx, applied.voucher.action); } catch (error) { return { status: 'blocked', reply: this.refusal(error, applied.preview.action, undefined, language) }; } }
      const permission = await this.permitted(ctx, applied);
      if (!permission) return { status: 'blocked', reply: language === 'en' ? 'Ask the owner or an authorized user to perform this action.' : PERMISSION[applied.preview.action] };
      if (applied.applied.revision) {
        const current = await this.read(ctx, applied.expenseId, applied.preview.action, applied.voucher).catch(() => null);
        if (!current && this.isClaim(applied.preview.action)) return { status: 'blocked', reply: REIMBURSEMENT_DRAFT_CHANGED[language] };
        if (!current || current.updatedAt.toISOString() !== applied.applied.revision || applied.applied.digest && current.digest !== applied.applied.digest) return { status: 'blocked', reply: language === 'en' ? 'The record changed; please request a new card.' : EXPENSE_ACTION_CHANGED };
      }
      if (control.action === 'expense_action_next') {
        const action = applied.applied.preview.offerNext;
        if (!action) return { status: 'blocked', reply: language === 'en' ? 'This confirmation expired; please request a new card.' : EXPIRED };
        const next = await this.preview(ctx, chat, { action,
          ...(action === 'VOUCHER_CREATE' ? { expenseId: applied.expenseId } : { voucherId: applied.applied.nextVoucherId }),
          ...applied.paymentIntent }, true, undefined, language);
        return next.preview ? { status: 'prepared', ...next, preview: next.preview } : { status: 'blocked', reply: next.reply };
      }
      if (control.action === 'expense_action_payment') {
        if (!applied.applied.preview.offerPayment) return { status: 'blocked', reply: language === 'en' ? 'This confirmation expired; please request a new card.' : EXPIRED };
        const next = await this.preview(ctx, chat, { ...applied.paymentIntent, action: 'RECORD_PAYMENT', expenseId: applied.expenseId }, true, undefined, language);
        return next.preview ? { status: 'prepared', ...next, preview: next.preview } : { status: 'blocked', reply: next.reply };
      }
      if (control.action === 'expense_action_wht') {
        if (!applied.applied.preview.offerWht || !applied.voucher) return { status: 'blocked', reply: language === 'en' ? 'This confirmation expired; please request a new card.' : EXPIRED };
        const next = await this.preview(ctx, chat, { action: 'WHT_CERTIFICATE_ISSUE', voucherId: applied.voucher.id }, true, undefined, language);
        return next.preview ? { status: 'prepared', ...next, preview: next.preview } : { status: 'blocked', reply: next.reply };
      }
      return { status: 'replayed', reply: language === 'en' ? 'This action has already been completed.' : 'รายการนี้ดำเนินการแล้วค่ะ', preview: applied.applied.preview, expenseIds: applied.voucher?.expenseIds ?? [applied.expenseId] };
    }
    if (control.action === 'expense_action_wht' || control.action === 'expense_action_payment' || control.action === 'expense_action_next') return { status: 'blocked', reply: language === 'en' ? 'This confirmation expired; please request a new card.' : EXPIRED };
    const claim = await this.store.claimCurrent(ctx.companyId, this.key(chat), id);
    if (!claim) return this.expiredRecovery(ctx, id, control.token, language);
    const entry = claim.entry;
    let reviewSaved = false;
    let step = entry.preview.action;
    try {
      if (!await this.bound(ctx, chat, entry, control.token)) {
        const expected = `${entry.previewId}.${this.sign(entry)}`;
        if (entry.companyId === ctx.companyId && entry.userId === ctx.userId && control.token.length === expected.length
          && timingSafeEqual(Buffer.from(control.token), Buffer.from(expected))
          && Date.parse(entry.preview.expiresAt) <= Date.now()) return this.expiredRecovery(ctx, entry.previewId, control.token, language);
        return { status: 'blocked', reply: language === 'en' ? 'This confirmation expired; please request a new card.' : EXPIRED };
      }
      await this.store.discardRecovery(ctx.companyId, entry.previewId);
      if (control.action === 'expense_action_cancel') {
        await this.store.discard(ctx.companyId, this.key(chat));
        return { status: 'cancelled', reply: language === 'en' ? 'Action cancelled; no change was made.' : 'ไม่ทำรายการนี้ค่ะ',
          taskSource: { action: entry.preview.action, id: entry.voucher?.id ?? entry.expenseId } };
      }
      if (entry.preview.reason && isLineWorkflowPutOff(entry.preview.reason)) {
        await this.store.releaseClaim(ctx.companyId, this.key(chat), claim.token);
        const prepared = await this.preview(ctx, chat, { action: entry.preview.action, expenseId: entry.expenseId,
          reimbursementId: entry.expenseId, voucherId: entry.voucher?.id }, true, undefined, language);
        return prepared.preview ? { status: 'prepared', ...prepared, preview: prepared.preview }
          : { status: 'blocked', ...prepared, taskSource: { action: entry.preview.action, id: entry.voucher?.id ?? entry.expenseId } };
      }
      if (entry.awaitingReason || entry.awaitingField) return { status: 'blocked', reply: this.question(entry, language) };
      const record = await this.read(ctx, entry.expenseId, entry.preview.action, entry.voucher);
      if (record.updatedAt.toISOString() !== entry.revision || record.digest !== entry.digest) return { status: 'blocked', reply: language === 'en' ? 'The record changed; please request a new card.' : EXPENSE_ACTION_CHANGED };
      if (entry.evidence) await this.checkSlip(ctx, chat, entry.evidence);
      const revision = new Date(entry.revision);
      let result;
      let certificates: ExpenseActionPreview['certificates'];
      if (entry.voucher) { const applied = await this.vouchers!.apply(ctx, entry.voucher, entry.previewId, entry.evidence ? { ...entry.evidence, chat } : undefined); result = applied; certificates = applied.certificates; }
      switch (entry.preview.action) {
        case 'MARK_READY': result = await this.ready.execute(ctx, entry.expenseId, undefined, revision); break;
        case 'CONFIRM': {
          if (!await this.permitted(ctx, entry)) return { status: 'blocked', reply: PERMISSION.CONFIRM };
          if (entry.review && !ctx.permissions.includes('expense.review')) return { status: 'blocked', reply: language === 'en' ? 'Ask an authorized expense reviewer to review the evidence before confirming.' : 'ให้เจ้าของกิจการหรือผู้มีสิทธิ์ตรวจรายจ่ายตรวจหลักฐานก่อนยืนยันค่ะ' };
          let confirmRevision = revision;
          if (entry.category) {
            const expense = await this.getExpense.execute(ctx, entry.expenseId);
            const saved = await this.updateDraft!.execute(ctx, entry.expenseId, await this.categoryInput(ctx, expense, entry.category), { requireExpectedUpdatedAt: true });
            confirmRevision = new Date(saved.updatedAt);
          }
          if (entry.markReady) {
            step = 'MARK_READY';
            const ready = await this.ready.execute(ctx, entry.expenseId, undefined, confirmRevision);
            confirmRevision = ready.updatedAt;
          }
          step = 'CONFIRM';
          if (entry.review) {
            const expense = await this.getExpense.execute(ctx, entry.expenseId);
            if (expense.updatedAt.getTime() !== confirmRevision.getTime()
              || expenseEvidenceFingerprint(expense, entry.review.assessment) !== entry.review.fingerprint
              || deliveryHash([...expense.attachments].sort((a, b) => a.id.localeCompare(b.id) || a.purpose.localeCompare(b.purpose))) !== entry.review.filesHash) return { status: 'blocked', reply: language === 'en' ? 'The record changed; please request a new card.' : EXPENSE_ACTION_CHANGED };
            const saved = await this.updateDraft!.execute(ctx, entry.expenseId, { expectedUpdatedAt: confirmRevision.toISOString(),
              sourceDocumentType: expense.sourceDocumentType, taxEvidenceStatus: expense.taxEvidenceStatus,
              evidenceAssessment: entry.review.assessment, documentReviewAcknowledged: true }, { requireExpectedUpdatedAt: true });
            reviewSaved = true;
            confirmRevision = new Date(saved.updatedAt);
          }
          result = await this.confirm.executeLineConfirmed(ctx, entry.expenseId, confirmRevision); break;
        }
        case 'DELETE_DRAFT': await this.remove.execute(ctx, entry.expenseId, revision); break;
        case 'REIMBURSEMENT_SUBMIT': case 'REIMBURSEMENT_CANCEL': case 'REIMBURSEMENT_APPROVE': case 'REIMBURSEMENT_REJECT':
          result = await this.validateClaim(ctx, { ...record.claim!, payout: { ...record.claim!.payout, submitToken: entry.claim?.payoutSubmitToken, version: entry.claim?.payoutVersion }, approvalSnapshotHash: entry.claim?.hash }, entry.preview.action, entry.preview.reason, revision, false); break;
        case 'REIMBURSEMENT_RECORD_PAYMENT': result = await this.claimPayment!.execute(ctx, entry.expenseId, { ...entry.claim!.payment!, idempotencyKey: entry.previewId }, { expectedUpdatedAt: revision }); break;
        case 'RECORD_PAYMENT': result = await this.payment!.execute(ctx, entry.expenseId, { ...entry.preview.payment!, idempotencyKey: entry.previewId }, { expectedUpdatedAt: revision,
          evidenceAttachmentId: entry.evidence?.attachmentId, beforeEvidence: async tx => { if (entry.evidence) await this.checkSlip(ctx, chat, entry.evidence, tx); } }); break;
        case 'VOID': result = await this.voidExpense.execute(ctx, entry.expenseId, entry.preview.reason!, undefined, revision); break;
      }
      const offerWht = (entry.preview.action === 'VOUCHER_PAY' || entry.preview.action === 'WHT_CERTIFICATE_ISSUE') && await this.vouchers!.canOfferCertificate(ctx, entry.voucher!.id);
      const confirmedPaid = entry.preview.action === 'CONFIRM' && result?.status === 'CONFIRMED'
        && 'paidAmount' in result && derivePaymentStatus(result.netPayableAmount, result.paidAmount) === 'PAID';
      const nextVoucherId = entry.voucher ? result?.id ?? entry.voucher.id : undefined;
      const offerNext = entry.voucher && ['VOUCHER_CREATE', 'VOUCHER_SUBMIT', 'VOUCHER_APPROVE'].includes(entry.preview.action)
        ? await this.vouchers!.nextAction(ctx, nextVoucherId!) : entry.preview.action === 'CONFIRM' && result?.status === 'CONFIRMED'
          && 'whtAmount' in result && new Decimal(String(result.whtAmount)).gt(0) && ctx.permissions.includes('expense.disbursement.prepare') ? 'VOUCHER_CREATE' as const : undefined;
      const offerPayment = !offerNext && entry.preview.action === 'CONFIRM' && result?.status === 'CONFIRMED' && 'paymentStatus' in result && !confirmedPaid && result.paymentStatus !== 'PAID' && ctx.permissions.includes('expense.payment.record');
      const intent = entry.paymentIntent;
      const paymentFields = { ...(typeof intent?.paymentMethod === 'string' ? { pm: intent.paymentMethod } : {}),
        ...(typeof intent?.paidAt === 'string' ? { pd: intent.paidAt } : {}), ...(typeof intent?.paidAmount === 'string' ? { pa: intent.paidAmount } : {}) };
      const nextControls = {
        ...(offerNext ? { next: lineWorkflowOpenData(this.config.aiGatewayInternalSecret!, ctx.companyId, ctx.userId, offerNext,
          offerNext === 'VOUCHER_CREATE' ? entry.expenseId : nextVoucherId ?? entry.voucher!.id, paymentFields) } : {}),
        ...(offerPayment ? { payment: lineWorkflowOpenData(this.config.aiGatewayInternalSecret!, ctx.companyId, ctx.userId, 'RECORD_PAYMENT', entry.expenseId, paymentFields) } : {}),
        ...(offerWht ? { wht: lineWorkflowOpenData(this.config.aiGatewayInternalSecret!, ctx.companyId, ctx.userId, 'WHT_CERTIFICATE_ISSUE', entry.voucher!.id, paymentFields) } : {}),
      };
      const preview = { ...entry.preview, resultId: nextVoucherId ?? entry.expenseId, nextControls, ...(entry.preview.evidenceReview ? { evidenceReview: false, details: entry.preview.details?.filter(line => !line.startsWith('กดเพื่อตรวจรับรอง')) } : {}), ...(offerPayment ? { offerPayment: true } : {}), ...(offerNext ? { offerNext } : {}), ...(certificates ? { certificates } : {}), ...(offerWht ? { offerWht: true } : {}), record: { ...entry.preview.record, status: entry.preview.action === 'RECORD_PAYMENT' ? entry.preview.record.nextStatus : result ? this.status(entry.preview.action, result.status) : 'ลบแล้ว' } };
      const current = entry.voucher ? await this.read(ctx, entry.expenseId, entry.preview.action, entry.voucher) : undefined;
      entry.applied = { nextVoucherId, revision: current?.updatedAt.toISOString() ?? (result ? new Date(result.updatedAt).toISOString() : null), digest: current?.digest, preview };
      await this.store.remember(ctx.companyId, this.key(chat), entry);
      await this.store.discard(ctx.companyId, this.key(chat));
      if (offerPayment && entry.paymentIntent && !entry.paymentIntent.offerPaymentAfterConfirm) {
        await this.store.releaseClaim(ctx.companyId, this.key(chat), claim.token);
        const next = await this.preview(ctx, chat, { ...entry.paymentIntent, action: 'RECORD_PAYMENT', expenseId: entry.expenseId }, true, undefined, language);
        if (next.preview) return { status: 'prepared', preview: next.preview, reply: next.reply };
      }
      return { status: 'applied', expenseIds: entry.voucher?.expenseIds ?? [entry.expenseId], reply: language === 'en' ? confirmedPaid ? 'Expense confirmed and payment recorded.' : certificates?.length ? `Tax certificate issued: ${certificates.map(cert => cert.number).join(', ')}.` : `Completed: ${lineUiLabel(EXPENSE_ACTION_LABELS[entry.preview.action], language)}.` : confirmedPaid ? 'ยืนยันและบันทึกจ่ายแล้วค่ะ' : certificates?.length ? `ออก 50 ทวิ เลขที่ ${certificates.map(cert => cert.number).join(' และ ')} แล้วค่ะ` : `${EXPENSE_ACTION_LABELS[entry.preview.action]}แล้วค่ะ`, preview };
    } catch (error) { return { status: 'blocked', reply: `${reviewSaved ? language === 'en' ? 'Evidence review was saved, but confirmation failed. ' : 'บันทึกการตรวจหลักฐานแล้ว แต่ยังยืนยันไม่สำเร็จค่ะ ' : ''}${this.refusal(error, step, undefined, language)}` }; }
    finally { await this.store.releaseClaim(ctx.companyId, this.key(chat), claim.token); }
  }
  async awaitingClaimSlip(ctx: RequestContext, chat: string): Promise<boolean> {
    const entry = await this.store.load(ctx.companyId, this.key(chat));
    return entry?.awaitingField === 'claimSlip' && entry.userId === ctx.userId && entry.membershipId === ctx.membershipId;
  }
  async captureClaimSlip(ctx: RequestContext, chat: string, media: { fileName: string; mimeType: string; byteSize: number; checksumSha256?: string },
    upload: (intent: Awaited<ReturnType<InitPaymentSlipUploadUseCase['execute']>>) => Promise<void>, language: LineReplyLanguage = 'th') {
    const entry = await this.store.load(ctx.companyId, this.key(chat));
    if (entry?.awaitingField !== 'claimSlip') return null;
    if (!await this.bound(ctx, chat, entry) || !await this.permitted(ctx, entry)) return { reply: language === 'en' ? 'This expense changed; please review its current state.' : EXPENSE_ACTION_CHANGED };
    const record = await this.read(ctx, entry.expenseId, entry.preview.action);
    if (record.updatedAt.toISOString() !== entry.revision || record.digest !== entry.digest) return { reply: language === 'en' ? 'This expense changed; please review its current state.' : EXPENSE_ACTION_CHANGED };
    try {
      const intent = await this.initClaimSlip!.execute(ctx, entry.expenseId, { originalFileName: media.fileName, mimeType: media.mimeType, byteSize: media.byteSize });
      await upload(intent);
      await this.completeClaimSlip!.execute(ctx, entry.expenseId, intent.attachmentId, { checksumSha256: media.checksumSha256, byteSize: media.byteSize });
      return this.preview(ctx, chat, { action: 'REIMBURSEMENT_RECORD_PAYMENT', reimbursementId: entry.expenseId,
        paidAmount: entry.claim!.payment!.paidAmount, paidAt: entry.claim!.payment!.paidAt, slipAttachmentId: intent.attachmentId }, true, undefined, language);
    } catch (error) { return { reply: this.refusal(error, 'REIMBURSEMENT_RECORD_PAYMENT', undefined, language), webPath: `/companies/${ctx.companyId}/reimbursements/${entry.expenseId}` }; }
  }
  async answerReason(ctx: RequestContext, chat: string, reason: string, evidence?: LineAiInputEvidenceV2): Promise<{ preview?: ExpenseActionPreview; reply: string; cancelled?: true; taskSource?: { action: ExpenseAction; id: string } } | null> {
    const entry = await this.store.load(ctx.companyId, this.key(chat));
    if (!(entry?.awaitingReason || entry?.awaitingField) || !await this.bound(ctx, chat, entry)) return null;
    if (lineWorkflowPickerText(reason).question || isLineWorkflowPutOff(reason) || lineWorkflowCommand(reason) && lineWorkflowPickerText(reason, true).explicit) return null;
    reason = stripLineFieldParticles(entry.awaitingReason || entry.awaitingField === 'reason' ? reason.replace(/^เหตุผล(?:คือ)?\s*[:：]?\s*/u, '') : reason);
    if (!reason) return { reply: this.question(entry) };
    const language: LineReplyLanguage = /[\u0E00-\u0E7F]/u.test(reason) ? 'th' : entry.awaitingField && entry.awaitingField !== 'reason' ? entry.preview.language ?? 'th' : lineReplyLanguage(reason, entry.preview.language ?? 'th');
    if (!/^(ไม่ทำ|ยกเลิก|cancel)$/iu.test(reason.trim()) && !(entry.awaitingField === 'paymentMethod' && entry.preview.action === 'RECORD_PAYMENT') && !isPendingFieldAnswer(reason, entry.awaitingField === 'payeeName' || entry.awaitingField === 'payeeAddress' ? 'payee' : 'reason')) return null;
    const record = await this.read(ctx, entry.expenseId, entry.preview.action, entry.voucher).catch(() => null);
    if (!record || record.updatedAt.toISOString() !== entry.revision || record.digest !== entry.digest) {
      await this.store.discard(ctx.companyId, this.key(chat)); return { reply: language === 'en' ? 'This expense changed; please review its current state.' : EXPENSE_ACTION_CHANGED };
    }
    if (/^(ไม่ทำ|ยกเลิก|cancel)$/iu.test(reason.trim())) { await this.store.discardRecovery(ctx.companyId, entry.previewId); await this.store.discard(ctx.companyId, this.key(chat)); return { reply: language === 'en' ? 'Action cancelled.' : 'ไม่ทำรายการนี้ค่ะ', cancelled: true,
      taskSource: { action: entry.preview.action, id: entry.voucher?.id ?? entry.expenseId } }; }
    if (entry.awaitingField === 'payeeName') {
      if (reason.trim() === 'พิมพ์ชื่อเอง' || reason.trim() === 'Type payee name') return { reply: this.question(entry) };
      if (!isVoucherPayeeName(reason)) return null;
    }
    if (entry.awaitingField === 'claimSlip') return { reply: this.question(entry) };
    const paymentAnswer = entry.awaitingField === 'paymentMethod' ? await this.paymentIntentFromText(reason, evidence) : {};
    const paymentMethod = paymentAnswer.paymentMethod;
    if (entry.allowedPaymentMethods && (!paymentMethod || !entry.allowedPaymentMethods.includes(paymentMethod as 'BANK_TRANSFER' | 'CHEQUE' | 'OTHER'))) {
      entry.paymentMethodQuestion = !paymentMethod;
      entry.preview.token = `${entry.previewId}.${this.sign(entry)}`;
      await this.store.save(entry);
      return { reply: paymentMethod ? E_WHT_WORDS['L-1'] : E_WHT_WORDS['L-10'] };
    }
    if (entry.awaitingField === 'paymentMethod' && !paymentMethod) return { reply: this.question(entry) };
    return this.preview(ctx, chat, { action: entry.preview.action, expenseId: entry.expenseId, reimbursementId: entry.expenseId, voucherId: entry.voucher?.id, handoffId: entry.voucher?.handoffs?.[0]?.id,
      ...(entry.voucher?.expenseIds ? { expenseIds: entry.voucher.expenseIds.join(',') } : {}),
      ...(entry.awaitingField === 'payeeName' ? { payeeName: reason } : entry.awaitingField === 'payeeAddress' ? { payeeAddress: reason } : paymentMethod ? { paymentMethod, paidAmount: entry.preview.payment?.paidAmount, paidAt: entry.preview.payment?.paidAt ?? entry.voucher?.payment?.paidDate, ...(entry.preview.action === 'RECORD_PAYMENT' ? paymentAnswer : {}) } : { reason }) }, true, undefined, entry.preview.language ?? 'th', entry.voucher?.requestedBillCount);
  }
  async permitted(ctx: RequestContext, entry: Pick<StoredAction, 'voucher' | 'createdByUserId' | 'expenseId'> & { preview: Pick<ExpenseActionPreview, 'action'> }): Promise<boolean> {
    if (entry.voucher) { try { await this.vouchers!.authorize(ctx, entry.voucher.action); return true; } catch (error) { if (error instanceof HttpException) return false; throw error; } }
    if (this.isClaim(entry.preview.action)) {
      if (entry.preview.action === 'REIMBURSEMENT_RECORD_PAYMENT') return ctx.permissions.includes('reimbursement.payment.record');
      if (entry.preview.action === 'REIMBURSEMENT_SUBMIT') return ctx.permissions.includes('reimbursement.submit') && (entry.createdByUserId === ctx.userId || ctx.permissions.includes('reimbursement.finance_review'));
      if (entry.preview.action === 'REIMBURSEMENT_CANCEL') return entry.createdByUserId === ctx.userId && ctx.permissions.includes('reimbursement.cancel_own') || ctx.permissions.includes('reimbursement.finance_review');
      if (ctx.permissions.includes(entry.preview.action === 'REIMBURSEMENT_APPROVE' ? 'reimbursement.approve' : 'reimbursement.reject')) return true;
      const claim = await this.claimRepo?.findRequestById(ctx.companyId, entry.expenseId, true);
      const step = claim?.approvalSteps?.find(s => s.decisionByUserId === ctx.userId);
      return Boolean(claim && step && hasFrozenAssignment(step, ctx.userId, await activeStepApprovers(this.claimRepo!, ctx.companyId, step, claim.branchId)));
    }
    if (entry.preview.action === 'REIMBURSEMENT_RECORD_PAYMENT') return ctx.permissions.includes('reimbursement.payment.record');
    if (entry.preview.action === 'RECORD_PAYMENT') return ctx.permissions.includes('expense.payment.record');
    return entry.preview.action === 'DELETE_DRAFT' ? ctx.permissions.includes('expense.delete') || entry.createdByUserId === ctx.userId && ctx.permissions.includes('expense.update')
      : entry.preview.action === 'MARK_READY' ? ctx.permissions.includes('expense.review') || entry.createdByUserId === ctx.userId && ctx.permissions.includes('expense.update')
      : ctx.permissions.includes(entry.preview.action === 'CONFIRM' ? 'expense.confirm' : 'expense.void');
  }
  private refusal(error: unknown, action: ExpenseAction, approvers?: string[], language: LineReplyLanguage = 'th'): string {
    if (!(error instanceof HttpException)) throw error;
    if (this.isClaim(action) && error.getStatus() === 404) return REIMBURSEMENT_DRAFT_CHANGED[language];
    const response = error.getResponse(), code = typeof response === 'object' ? String((response as any).code ?? error.message) : response;
    if (code === 'expense_ewht_payment_method' || code === 'disbursement_ewht_planned_method') return E_WHT_WORDS['L-1'];
    if (language === 'en') {
      if (code === 'feature_not_enabled') return 'Your package does not include this feature.';
      if (error instanceof ForbiddenException) return approvers?.length ? `This claim awaits approval by ${approvers.map(name => scrubRecordText(name, 60)).join(' or ')}.` : 'Ask the shop owner or an authorized user to perform this action.';
      const missing = missingActionFields(error);
      if (missing.length) return `Please add ${missing.map(field => ({ category: 'expense category', expenseCategoryId: 'expense category', expenseDate: 'expense date', branchId: 'branch', evidenceReview: 'evidence review', documentReview: 'document review', amount: 'amount' } as Record<string, string>)[field] ?? 'the missing record details').join(', ')} before continuing.`;
      if (/changed|stale|CONFLICT|VERSION|RELOAD/u.test(code)) return 'The record has changed; please review a new confirmation card.';
      if (/period.*locked|PERIOD.*LOCKED/iu.test(code)) return 'This period is locked; ask an authorized accountant to review it on the web.';
      if (/receipt attachment|missing receipt|Evidence review|evidence.*review/iu.test(error.message) && action === 'REIMBURSEMENT_APPROVE') return 'The claim has not been approved. Open it on the web to attach and review the required evidence.';
      if (/receipt|evidence|review|VAT|tax/iu.test(code)) return 'Please review the required evidence and tax details on the web before confirming.';
      if (/reason/iu.test(code)) return 'Please provide the reason for this action.';
      return 'Please review the record details and evidence on the web before continuing.';
    }
    if (code === 'feature_not_enabled') return 'แพ็กเกจที่ใช้อยู่ยังไม่มีเรื่องนี้ค่ะ';
    if (error instanceof ForbiddenException) return this.isClaim(action) && /APPROVE|REJECT/u.test(action) && approvers?.length ? `ใบเบิกนี้รอ${approvers.map(name => scrubRecordText(name, 60)).join(' หรือ ')}อนุมัติค่ะ` : PERMISSION[action];
    const missing = missingActionFields(error);
    if (missing.length) {
      const labels = [...new Set(missing.map(field => MISSING_LABELS[field] ?? 'ข้อมูลรายการที่ต้องตรวจ'))].join(' และ ');
      if (missing.some(field => ['category', 'expenseCategoryId'].includes(field))) return `ยังขาด${labels}ค่ะ`;
      const review = missing.some(field => ['evidenceReview', 'documentReview', 'review'].includes(field));
      return `ยังขาด${labels} ${review ? 'เปิดหน้ารายการเพื่อตรวจให้ครบก่อน' : 'พิมพ์ข้อมูลที่ขาดในแชตได้เลย'}ค่ะ`;
    }
    if (EXPENSE_ACTION_REFUSALS[code]) return EXPENSE_ACTION_REFUSALS[code]!;
    if (code.startsWith('expense_confirmation_accounting_period_locked:')) return EXPENSE_ACTION_REFUSALS.accounting_period_locked!;
    if (code.startsWith('expense_confirmation_tax_period_locked:')) return EXPENSE_ACTION_REFUSALS.tax_period_locked!;
    if (action === 'REIMBURSEMENT_RECORD_PAYMENT') return 'เปิดใบเบิกเพื่อตรวจข้อมูลการจ่ายคืนให้ครบก่อนค่ะ';
    if (this.isClaim(action)) {
      if (code === 'missing_receipt') return 'ขอหลักฐานใบเบิกให้ครบตามนโยบายบริษัทก่อนส่งอนุมัติค่ะ';
      if (code === 'missing_receipt_reason_required') return 'ขอเหตุผลที่ไม่มีใบเสร็จสั้นๆ ก่อนส่งอนุมัติค่ะ';
      if (/rejection_reason_required/u.test(error.message)) return 'ไม่อนุมัติใบเบิกนี้เพราะอะไรคะ';
      if (/not_awaiting_approval|Cannot.*(submit|cancel)|invalid_status_transition/u.test(error.message)) return 'สถานะใบเบิกนี้ยังทำรายการที่ขอไม่ได้ เปิดใบเบิกดูขั้นตอนต่อได้ค่ะ';
      if (/payout.*(required|attestation)/u.test(error.message)) return 'ขอข้อมูลบัญชีรับเงินและการตรวจบัญชีให้ครบก่อนค่ะ';
    }
    if (code === 'disbursement_payment_method_required') return 'จ่ายด้วยเงินสด โอนเงิน บัตร หรือเช็คคะ';
    if (/^disbursement_(source_changed|payment_source_changed|version_conflict)$/u.test(code)) return EXPENSE_ACTION_CHANGED;
    if (code === 'disbursement_status_changed') return 'สถานะใบเตรียมจ่ายนี้ยังทำรายการที่ขอไม่ได้ค่ะ';
    if (code === 'wht_handoff_not_issuable') return 'รายการนี้ยังไม่มี 50 ทวิที่รอออกค่ะ';
    const message = error.message;
    if (/classified as non-expense/iu.test(message)) return 'ให้ผู้ตรวจรายจ่ายตรวจประเภทเอกสารและรับรองว่าเป็นค่าใช้จ่ายในหน้ารายการก่อนค่ะ';
    if (/marked as a duplicate/iu.test(message)) return 'ให้ผู้ตรวจรายจ่ายตรวจและล้างเครื่องหมายรายการซ้ำในหน้ารายการก่อนยืนยันค่ะ';
    if (/payee taxpayer class/iu.test(message)) return 'ให้ผู้ตรวจรายจ่ายเลือกผู้รับเงินเป็นบุคคลธรรมดาหรือนิติบุคคลในหน้ารายการก่อนค่ะ';
    if (/income category/iu.test(message)) return 'เลือกว่ารายการนี้จ่ายค่าอะไรค่ะ';
    if (/differs from the receipt OCR total/iu.test(message)) return 'ให้ผู้ตรวจรายจ่ายเทียบยอดรวมกับใบเสร็จและบันทึกเหตุผลยอมรับส่วนต่างในหน้ารายการก่อนค่ะ';
    if (/cannot retain a Tax Code|must remain supporting-only/iu.test(message)) return 'ให้ผู้ตรวจรายจ่ายตรวจคำตอบเรื่อง VAT ที่หน้ารายการค่ะ';
    if (/requires a reviewed TAX_INVOICE/iu.test(message)) return 'ให้ผู้ตรวจรายจ่ายเลือกใบกำกับภาษีเต็มรูปและตรวจหลักฐานที่หน้ารายการค่ะ';
    if (/attached tax invoice, supplier tax ID/iu.test(message)) return 'แนบใบกำกับภาษีและเติมเลขผู้เสียภาษีผู้ขายกับเลขที่เอกสารในหน้ารายการให้ครบก่อนค่ะ';
    if (/server-resolved Tax Code|VAT treatment.*(?:Tax Code|ZERO_RATED|explicit zero)/iu.test(message)) return 'ให้ผู้ตรวจรายจ่ายแก้อัตราและรูปแบบ VAT ของรายการให้ตรงกันค่ะ';
    if (/Verified evidence has conflicting .* amounts/iu.test(message)) return 'ให้ผู้ตรวจรายจ่ายเทียบยอดหลักฐานที่ขัดกันที่หน้ารายการค่ะ';
    if (/Attachment must be ACTIVE/iu.test(message)) return 'สลิปนี้ใช้ไม่ได้แล้วค่ะ ส่งสลิปใหม่ในแชตแล้วขอบันทึกจ่ายอีกครั้ง';
    if (/Attachment and expense must belong to the same branch/iu.test(message)) return 'ส่งสลิปของสาขาเดียวกับรายจ่ายในแชตแล้วขอบันทึกจ่ายอีกครั้งค่ะ';
    if (/Unsupported attachment target or purpose/iu.test(message)) return 'ขอเตรียมการ์ดบันทึกจ่ายพร้อมสลิปใหม่แล้วลองอีกครั้งค่ะ';
    if (/document sequence parameters|Only (?:RESERVED|COMMITTED) document numbers/iu.test(message)) return 'ขอเตรียมการ์ดใหม่เพื่อใช้เลขเอกสารล่าสุดแล้วลองอีกครั้งค่ะ';
    if (/branch.*required|transaction_branch_required/iu.test(`${code} ${message}`)) return 'ยังขาดสาขาค่ะ พิมพ์ชื่อสาขาของรายการนี้ในแชตได้เลย';
    if (code === 'EXPENSE_DOCUMENT_DATE_REVIEW_REQUIRED') return 'ยังขาดการตรวจวันที่รายการ ตรวจวันที่แล้วบอกวันที่ในแชตได้เลยค่ะ';
    if (/VAT.*rate|vat.*rate/iu.test(message)) return 'ยังขาดอัตรา VAT พิมพ์อัตรา VAT ในแชตได้เลยค่ะ';
    if (/Expense date is required/iu.test(message)) return 'ยังขาดวันที่รายการ พิมพ์วันที่ในแชตได้เลยค่ะ';
    if (/Grand total amount (?:must be greater than zero|is invalid)/iu.test(message)) return 'ยังขาดยอดเงินที่ถูกต้อง พิมพ์ยอดจากใบเสร็จในแชตได้เลยค่ะ';
    if (action === 'RECORD_PAYMENT' && /reimbursement/u.test(code)) return 'รายการนี้ต้องบันทึกจ่ายผ่านใบเบิกค่ะ';
    if (/version_changed|changed|stale/iu.test(`${code} ${message}`)) return EXPENSE_ACTION_CHANGED;
    if (code === 'EXPENSE_NOT_DELETABLE') return 'ลบได้เฉพาะร่าง รายการที่ถูกปฏิเสธ หรือรายการรอยืนยันยอดศูนย์ที่ยังไม่จ่ายค่ะ';
    if (/RETENTION|LINKED_DATA/iu.test(code)) return 'รายการนี้มีหลักฐานหรือข้อมูลผูกอยู่ค่ะ ต้องจัดการข้อมูลที่ผูกอยู่ก่อน';
    if (message.includes('VOIDED')) return 'รายการนี้ยกเลิกแล้วค่ะ ทำรายการต่อไม่ได้';
    if (/Cannot.*(transition|confirm)/iu.test(message)) return action === 'CONFIRM' ? 'รายการนี้ยังยืนยันไม่ได้ค่ะ ต้องส่งตรวจให้พร้อมยืนยันก่อน' : 'สถานะนี้ยังส่งตรวจไม่ได้ค่ะ';
    if (/receipt attachment|missing receipt|Evidence review|evidence.*review/iu.test(message)) return action === 'REIMBURSEMENT_APPROVE'
      ? 'ยังไม่ได้อนุมัติใบเบิกค่ะ เปิดใบเบิกในเว็บเพื่อแนบและตรวจหลักฐานให้ครบก่อน'
      : 'ต้องแนบและตรวจหลักฐานให้ครบก่อนยืนยันค่ะ';
    if (error instanceof ConflictException || error instanceof BadRequestException) return 'ต้องตรวจข้อมูลและหลักฐานของรายการให้ครบก่อนค่ะ';
    return 'ไม่พบรายการที่คุณเข้าถึงได้ค่ะ';
  }
}

@Injectable()
export class ExpenseActionPreviewTool implements ErpReadToolPort {
  readonly toolName = 'expense.action.preview';
  constructor(private readonly actions: LineExpenseActionService) {}
  async execute(ctx: ErpToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    const text = ctx.groundingText;
    const inputEvidence = ctx.inputEvidence ?? (text ? (await createLineAiInputEvidence({
      turnKey: deliveryHash(['expense-action-input', ctx.requestId, ctx.chatKeyHash, text]),
      parts: [{ partId: 'part-0', eventIdHash: deliveryHash([ctx.requestId, text]), acceptedAtMs: Date.now(), rawText: text }],
    }))?.inputEvidence : undefined);
    const result: Awaited<ReturnType<LineExpenseActionService['preview']>> = text && !inputEvidence
      ? { reply: LINE_CLAIM_PICKER_COPY.unavailable, webPath: `/companies/${ctx.companyId}/expenses` }
      : await this.actions.preview({ requestId: ctx.requestId ?? '', authSubject: ctx.userId, userId: ctx.userId,
      companyId: ctx.companyId, membershipId: ctx.membershipId ?? '', roles: ctx.roles ?? [], permissions: ctx.permissions,
      scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds }, authProvider: 'line' }, ctx.chatKeyHash, input, false, undefined, ctx.locale.startsWith('en') ? 'en' : 'th', requestedVoucherBillCount(ctx.inputEvidence?.parts.map(part => part.rawText).join('\n') ?? ctx.groundingText), inputEvidence);
    return { toolName: this.toolName, status: 'ok', data: result, sourceRefs: [{ module: 'expenses', entityType: 'expense_action_preview', label: result.webLabel ?? 'คำขอทำรายการค่าใช้จ่าย', permissionChecked: true, ...(result.webPath ? { webPath: result.webPath } : {}) }], asOf: new Date().toISOString() };
  }
}
