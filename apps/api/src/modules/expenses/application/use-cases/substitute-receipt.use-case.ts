import { EXPENSE_RECEIPT_SOURCE_TYPES, expenseEvidenceAssessment, hasCurrentExpenseEvidenceReview } from '@watchdog-bms/contracts';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  civilDate,
  hasCheckBillSubstituteRoutingResolution,
  isCivilDate,
  EXPENSE_PAYMENT_METHODS,
  isCheckBillClassification,
  substituteReceiptRequiresPaymentEvidence,
  SUBSTITUTE_RECEIPT_LINE_LIMIT_MESSAGE,
  SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS,
} from '@watchdog-bms/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../../../audit/application/audit.service';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import { CompleteAttachmentUploadUseCase } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { CreateUploadIntentUseCase } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { ObjectVersionCleanupService } from '../../../data-model-core/application/services/object-version-cleanup.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { normalizeTaxId } from '../../../data-model-core/domain/logic/company-legal-identity.logic';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import {
  expenseDecimalToString,
  PrismaExpenseRepository,
  expenseReadScopeWhere,
  SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON,
  toSubstituteEvidenceSummary,
} from '../../infrastructure/prisma-expense.repository';
import {
  buildSubstituteCertificationText,
  canonicalSnapshotHash,
  renderSubstituteReceiptAttestationSvg,
  renderSubstituteReceiptSvg,
  withoutSubstituteReceiptPrintMetadata,
  type SubstituteReceiptSnapshot,
} from '../../domain/logic/substitute-receipt.logic';
import { assertSubstitutePaymentDetails, assertSubstituteFactsComplete } from '../../domain/logic/substitute-funding.logic';
import { assembleCaptureFacts } from '../../domain/logic/expense-capture-facts.logic';
import {
  captureCertificateGate,
  captureFundingRouteRefusal,
  type CaptureCertificateRefusal,
} from '../../domain/logic/expense-capture-certificate.logic';
import { hasBlockingNonExpenseClassification } from '../../domain/logic/expense-status.logic';
import { SUBSTITUTE_RECEIPT_PDF_LIMITS, renderSubstitutePaperPreviewPages, renderSubstituteReceiptPaperArtifactPdf, renderSubstituteReceiptPdf } from '../../domain/logic/substitute-receipt-pdf.logic';
import { renderPaymentVoucherSvg } from '../../domain/logic/payment-voucher.logic';
import { SIGNATURE_MAX_BYTES } from '../../domain/logic/signature-image.logic';
import type { ExpenseRecordWithRelations, SubstituteReceiptEvidenceRecord } from '../../domain/models/expense.model';
import { GetExpenseUseCase, UpdateExpenseDraftUseCase } from './expense-draft.use-case';
import { expenseListReadScope } from '../expense-list-read-scope';
import { assertFullSubstitutePayment } from '../../domain/logic/substitute-funding.logic';
import { SELF_APPROVAL_EXEMPT_ROLES } from '../../../procurement/domain/logic/procurement.logic';

// Owner decision 2026-08-10: the OWNER/ADMIN/MANAGER self-approval exemption applies to every
// approval workflow, substitute receipts included. Under the OWNER_SELF policy those roles may
// approve a certificate they paid themselves (audited); DESIGNATED_APPROVERS keeps the
// configured separation of duties untouched.
function selfApprovalPermitted(approvalMode: 'OWNER_SELF' | 'DESIGNATED_APPROVERS', roles: readonly string[]): boolean {
  return approvalMode === 'OWNER_SELF' && roles.some((role) => SELF_APPROVAL_EXEMPT_ROLES.includes(role));
}

import type {
  AcceptSubstituteReceiptPaperInput,
  SubmitSubstituteReceiptPaperInput,
  SubstituteReceiptPaperSigner,
  ApproveSubstituteReceiptInput,
  CertifySubstituteReceiptInput,
  GenerateSubstituteReceiptInput,
  AmendSubstituteReceiptInput,
  RequestContext,
  SubstituteReceiptEvidenceSummary,
  SubstituteReceiptEvidenceStatus,
  SubstituteReceiptListFilter,
  SubstituteReceiptListResult,
  SubstituteReceiptCandidateFilter,
  SubstituteReceiptCandidatePage,
  SupersedeSubstituteReceiptInput,
} from '@watchdog-bms/contracts';

const REASON_CODES = new Set(['PAYEE_CANNOT_ISSUE', 'RECEIPT_UNAVAILABLE', 'RECEIPT_MATERIALLY_INCOMPLETE', 'OTHER']);
const ALWAYS_INELIGIBLE_SOURCE_TYPES = new Set(['SUBSTITUTE_RECEIPT', 'NEEDS_REVIEW']);
const INELIGIBLE_CLASSIFICATION_KINDS = new Set([
  'ORDER_OR_CHECK_BILL', 'QUOTATION', 'PURCHASE_ORDER', 'DELIVERY_NOTE', 'APPOINTMENT_CARD',
  'BOOKING_CONFIRMATION', 'RESERVATION_CONFIRMATION', 'SIGNATURE_IMAGE', 'OTHER_BUSINESS_DOCUMENT',
  'NON_FINANCIAL_IMAGE', 'NEEDS_REVIEW',
]);
const PREVIEW_CERTIFIED_AT = '0000-01-01T00:00:00.000Z';
/** The payer picks their position when they certify, so the printed form leaves a rule for it. */
const UNSIGNED_FORM_POSITION_BLANK = '__________';
const SUBSTITUTE_RECEIPT_STATUSES = new Set<SubstituteReceiptEvidenceStatus>([
  'PREPARED', 'PAYER_CERTIFIED', 'ISSUED', 'SUPERSEDED',
]);

function assertWeb(ctx: RequestContext): void {
  if (ctx.authProvider === 'line') throw new ForbiddenException('Substitute receipt certification is available on the authenticated web only.');
}

/** The creator predicate comes from the expense list; preparation adds no company-wide review right. */
export function substituteReceiptPreparationScope(ctx: RequestContext, branchId?: string) {
  if (!expenseListReadScope(ctx) && !ctx.permissions.includes('expense.confirm')) throw new ForbiddenException('Missing permission: expense.review');
  if (branchId) assertBranch(ctx, branchId);
  return expenseReadScopeWhere({ companyId: ctx.companyId, branchId,
    ...(!ctx.permissions.includes('expense.review') && { createdByUserId: ctx.userId }) }, ctx.scopes ?? {});
}

function assertSubstitutePreparationAccess(ctx: RequestContext, expense: Pick<ExpenseRecordWithRelations, 'createdByUserId' | 'branchId'>): void {
  const scope = substituteReceiptPreparationScope(ctx);
  assertBranch(ctx, expense.branchId);
  if (scope.createdByUserId && expense.createdByUserId !== scope.createdByUserId) throw new ForbiddenException('Missing permission: expense.review');
}

function assertBranch(ctx: RequestContext, branchId: string | null): void {
  if (!isBranchInScope(ctx.scopes ?? {}, branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${field} is required.`);
  const text = value.trim();
  if (text.length > max) throw new BadRequestException(`${field} must be at most ${max} characters.`);
  return text;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException(`${field} must be text.`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new BadRequestException(`${field} must be at most ${max} characters.`);
  return text;
}

function optionalPayeeTaxId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException('payeeTaxId must be text.');
  if (!value.trim()) return null;
  const digits = normalizeTaxId(value);
  if (digits.length !== 13) throw new BadRequestException('payeeTaxId must contain exactly 13 digits.');
  return digits;
}

function parseExpectedDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} must be a valid ISO date.`);
  return parsed;
}

function renderabilityError(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

function assertSubstituteReceiptLinesRenderable(lines: ReadonlyArray<{ description: string }>): void {
  if (lines.length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxExpenseLines) {
    throw renderabilityError(
      'substitute_receipt_too_many_lines',
      SUBSTITUTE_RECEIPT_LINE_LIMIT_MESSAGE,
    );
  }
  if (lines.some((line) => line.description.trim().length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength)) {
    throw renderabilityError(
      'substitute_receipt_line_description_too_long',
      `Each substitute-receipt expense description must be at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength} characters.`,
    );
  }
}

function assertSubstituteReceiptEvidenceRenderable(
  evidence: ReadonlyArray<{ originalFileName: string }>,
): void {
  if (evidence.length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments) {
    throw renderabilityError(
      'substitute_receipt_too_many_evidence',
      `A substitute receipt supports at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments} linked evidence files.`,
    );
  }
  if (evidence.some((item) => item.originalFileName.trim().length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceFileNameLength)) {
    throw renderabilityError(
      'substitute_receipt_evidence_filename_too_long',
      `Each linked evidence file name must be at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceFileNameLength} characters.`,
    );
  }
}

function assertSubstituteReceiptSnapshotRenderable(snapshot: SubstituteReceiptSnapshot): void {
  assertSubstituteReceiptLinesRenderable(snapshot.expense.lines);
  assertSubstituteReceiptEvidenceRenderable(snapshot.evidence);
}

export type SubstituteReceiptEligibilityIssue = { code: string; message: string };

/** All target-level eligibility failures knowable from one current expense snapshot.
 *
 *  LINE displays the Thai message; web uses the stable code for localized actionable copy. */
export function collectSubstituteReceiptEligibilityIssues(
  expense: ExpenseRecordWithRelations,
  reasonCode?: string,
  options?: { routeCheckBill?: boolean },
): SubstituteReceiptEligibilityIssue[] {
  const issues: SubstituteReceiptEligibilityIssue[] = [];
  const checkBillClassification = isCheckBillClassification(expense.aiVerificationSummaryJson);
  const checkBillRoute = hasCheckBillSubstituteRoutingResolution(expense.aiVerificationSummaryJson)
    || (options?.routeCheckBill === true && checkBillClassification);
  if (options?.routeCheckBill === true && !checkBillClassification) {
    issues.push({ code: 'check_bill_route_ineligible', message: 'เส้นทางนี้ใช้ได้เฉพาะเช็กบิลที่จ่ายแล้วแต่ร้านไม่มีใบเสร็จฉบับสุดท้ายค่ะ' });
  }
  if (checkBillClassification && !checkBillRoute) {
    issues.push({ code: 'check_bill_route_required', message: 'เปิดขั้นตอนจัดทำใบรับรองของรายการเดิม ยืนยันว่าจ่ายแล้วแต่ไม่มีใบเสร็จฉบับสุดท้าย และแนบหลักฐานการชำระเงินแยกจากเช็กบิลค่ะ' });
  }
  if (!['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status)) {
    issues.push({ code: 'expense_status_ineligible', message: `จัดทำใบรับรองแทนใบเสร็จรับเงินได้เฉพาะรายการที่ยังเป็นร่าง อยู่ระหว่างตรวจ หรือพร้อมยืนยัน (สถานะตอนนี้: ${expense.status})` });
  }
  if (ALWAYS_INELIGIBLE_SOURCE_TYPES.has(expense.sourceDocumentType) && !checkBillRoute) {
    issues.push({ code: 'source_type_ineligible', message: 'ประเภทเอกสารต้นทางยังไม่ผ่านการตรวจ หรือไม่รองรับใบรับรองแทนใบเสร็จรับเงิน ตรวจและเลือกประเภทเอกสารในเว็บก่อนค่ะ' });
  }
  if (EXPENSE_RECEIPT_SOURCE_TYPES.some(type => type === expense.sourceDocumentType)
    && !['RECEIPT_UNAVAILABLE', 'RECEIPT_MATERIALLY_INCOMPLETE'].includes(reasonCode ?? '')) {
    issues.push({ code: 'valid_receipt_normal_path', message: 'รายการนี้มีใบเสร็จหรือใบกำกับภาษีที่ใช้ได้อยู่แล้ว ให้ทำตามขั้นตอนปกติ ใบรับรองแทนใบเสร็จรับเงินใช้ได้เมื่อต้นฉบับหายหรือข้อมูลสำคัญไม่ครบเท่านั้น' });
  }
  if (hasBlockingNonExpenseClassification(expense.aiVerificationSummaryJson) && !checkBillRoute) {
    issues.push({ code: 'classification_ineligible', message: 'ใบเสนอราคา ใบสั่งซื้อ ใบนัดหมาย ใบจอง รูปที่ไม่ใช่ค่าใช้จ่าย หรือรูปที่อ่านไม่ออก ใช้จัดทำใบรับรองแทนใบเสร็จรับเงินไม่ได้ค่ะ' });
  }
  const classification = expense.aiVerificationSummaryJson?.['classification'];
  const rawDocumentKind = classification && typeof classification === 'object'
    ? (classification as Record<string, unknown>)['documentKind']
    : null;
  if (typeof rawDocumentKind === 'string' && INELIGIBLE_CLASSIFICATION_KINDS.has(rawDocumentKind)
    && !(rawDocumentKind === 'ORDER_OR_CHECK_BILL' && checkBillRoute)) {
    issues.push({ code: 'document_kind_ineligible', message: 'แม้ฝ่ายบัญชีจะปรับสถานะให้แล้ว ใบเสนอราคา ใบสั่งซื้อ ใบนัดหมาย ใบจอง หรือรูปที่ไม่ใช่ค่าใช้จ่าย ก็ยังใช้จัดทำใบรับรองแทนใบเสร็จรับเงินไม่ได้ค่ะ' });
  }
  if (expense.currency !== 'THB') issues.push({ code: 'currency_not_supported', message: 'ตอนนี้ใบรับรองแทนใบเสร็จรับเงินรองรับเฉพาะรายการสกุลเงินบาท (THB)' });
  if (!(Number(expense.grandTotalAmount) > 0)) issues.push({ code: 'reviewed_total_required', message: 'ยอดรวมที่ตรวจแล้วต้องมากกว่า 0 บาท' });
  if (!expense.lines.length || expense.lines.some((line) => !line.description.trim())) {
    issues.push({ code: 'reviewed_items_required', message: 'ต้องมีรายละเอียดรายการค่าใช้จ่ายที่ตรวจแล้วให้ครบก่อนค่ะ' });
  }
  if (expense.lines.length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxExpenseLines) {
    issues.push({ code: 'substitute_receipt_too_many_lines', message: SUBSTITUTE_RECEIPT_LINE_LIMIT_MESSAGE });
  }
  if (expense.lines.some((line) => line.description.trim().length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength)) {
    issues.push({ code: 'substitute_receipt_line_description_too_long', message: `รายละเอียดค่าใช้จ่ายแต่ละรายการต้องไม่เกิน ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength} ตัวอักษร` });
  }
  if (!expense.expenseCategoryId && !expense.accountHintKey && expense.lines.some((line) => !line.expenseCategoryId && !line.accountHintKey)) {
    issues.push({ code: 'reviewed_category_required', message: 'ระบุหมวดค่าใช้จ่ายของรายการนี้' });
  }
  if (expense.taxEvidenceStatus === 'NEEDS_REVIEW' && !checkBillRoute) {
    issues.push({ code: 'tax_evidence_review_required', message: 'ต้องตรวจสถานะหลักฐานภาษีของรายการนี้ให้เสร็จก่อน (ทำในเว็บ)' });
  }
  if (expense.taxEvidenceStatus === 'USABLE_FOR_TAX' && !checkBillRoute) {
    issues.push({ code: 'tax_evidence_nonclaimable', message: 'ใบรับรองแทนใบเสร็จรับเงินใช้ขอคืนภาษีซื้อไม่ได้ ให้เปลี่ยนสถานะเป็นเอกสารประกอบที่ไม่ขอคืนภาษี หรือขอใบกำกับภาษีฉบับทดแทนจากผู้ขาย' });
  }
  return issues;
}

function validateEligibility(
  expense: ExpenseRecordWithRelations,
  reasonCode?: string,
  options?: { routeCheckBill?: boolean },
): void {
  const issue = collectSubstituteReceiptEligibilityIssues(expense, reasonCode, options)[0];
  if (!issue) return;
  throw new BadRequestException(issue);
}

function captureRefusal(refusal: CaptureCertificateRefusal): HttpException {
  const body = { code: refusal.code, message: refusal.message };
  return refusal.status === 409 ? new ConflictException(body) : new UnprocessableEntityException(body);
}

/**
 * W06 §12.1/§12.2/§14.3 — the capture-only additions to eligibility, on top of the unchanged rules
 * above. Applies to a source the handoff derived from an ACCEPTED allocation; a converted expense
 * (§3.1) or a LINE auto-handoff source (§3.2) has no allocation to reserve and stays on the
 * ordinary path it already had.
 */
async function assertCaptureSourceEligible(
  repo: PrismaExpenseRepository,
  companyId: string,
  expense: ExpenseRecordWithRelations,
  /** Null only for an evidence row written before the column existed: the route check is skipped,
   *  the gate itself still runs. */
  fundingSource: 'COMPANY' | 'PERSONAL_ADVANCE' | null,
): Promise<void> {
  if (!expense.captureGroupId || !expense.captureAllocationId) return;
  const context = await repo.findCaptureCertificateContext(companyId, expense);
  if (!context) throw captureRefusal({
    code: 'substitute_capture_allocation_superseded', status: 409,
    message: 'การจัดส่วนเปลี่ยนไปแล้ว กรุณาสร้างรายการใหม่ก่อนทำใบรับรอง',
  });
  const gate = captureCertificateGate({
    group: context.group,
    source: { captureAllocationId: expense.captureAllocationId, captureScopeKey: expense.captureScopeKey ?? null },
    facts: assembleCaptureFacts(context.observations),
  });
  if (gate.outcome === 'refused') throw captureRefusal(gate);
  // The route that DERIVED this source, not whatever the group is being re-reviewed as right now.
  const routeRefusal = fundingSource
    ? captureFundingRouteRefusal(context.allocation?.fundingRoute ?? context.group.fundingRoute, fundingSource)
    : null;
  if (routeRefusal) throw captureRefusal(routeRefusal);
}

async function buildSnapshot(
  repo: PrismaExpenseRepository,
  companyId: string,
  expense: ExpenseRecordWithRelations,
  evidence: SubstituteReceiptEvidenceRecord,
  payerPosition: string,
  certifiedAt: string,
): Promise<SubstituteReceiptSnapshot> {
  assertSubstituteReceiptLinesRenderable(expense.lines);
  const linkedIds = [...new Set([...evidence.paymentEvidenceAttachmentIds, ...evidence.supportingAttachmentIds])];
  const refs = await repo.findSubstituteEvidenceAttachments(companyId, expense.id, linkedIds);
  if (refs.length !== linkedIds.length) throw new ConflictException('Linked source/payment evidence changed. Finance must prepare a new version.');
  assertSubstituteReceiptEvidenceRenderable(refs);
  const company = await repo.getSubstituteCompanyContext(companyId, expense.branchId);
  if (evidence.correctionOfEvidenceId && evidence.snapshotJson) {
    const original = evidence.snapshotJson as unknown as SubstituteReceiptSnapshot;
    if (company.taxId !== original.company.taxId) throw new ConflictException('substitute_correction_company_identity_changed');
    return { ...original, schemaVersion: 2, documentNumber: evidence.documentNumber, version: evidence.version,
      company: { ...original.company, name: company.name, nameSource: company.nameSource },
      ...(original.paymentStatement && original.fundingSource === 'COMPANY' ? { paymentStatement: `ชำระด้วยเงินของกิจการ ${company.name} เต็มจำนวน` } : {}),
      payer: { ...original.payer, position: payerPosition, certifiedAt },
      certificationText: buildSubstituteCertificationText(original.payer.name, payerPosition, true),
      correction: { evidenceId: evidence.correctionOfEvidenceId, reason: evidence.correctionReason ?? '' } };
  }
  // W06/D04: recorded inside the snapshot, so the certified checksum covers the share this
  // document states. A correction reuses the original snapshot above and keeps its own block.
  const captureAllocation = expense.captureAllocationId
    ? await repo.findSubstituteCaptureAllocation(companyId, expense)
    : null;
  return {
    schemaVersion: 2,
    ...(captureAllocation ? { captureAllocation } : {}),
    fundingSource: evidence.fundingSource ?? null,
    paymentStatement: evidence.fundingSource === 'COMPANY' ? `ชำระด้วยเงินของกิจการ ${company.name} เต็มจำนวน` : 'พนักงานสำรองจ่ายด้วยเงินส่วนตัวเต็มจำนวน',
    documentNumber: evidence.documentNumber,
    version: evidence.version,
    company,
    expense: {
      id: expense.id,
      expenseNumber: expense.expenseNumber,
      expenseDate: expense.expenseDate.toISOString(),
      paymentDate: (evidence.paymentDate ?? expense.paidAt)?.toISOString() ?? null,
      currency: expense.currency,
      grandTotalAmount: expense.grandTotalAmount,
      netPayableAmount: expense.netPayableAmount,
      whtAmount: expense.whtAmount,
      paymentMethod: evidence.paymentMethod ?? expense.paymentMethod,
      paymentReference: expense.bankAccountRef,
      category: expense.expenseCategoryId ?? expense.accountHintKey,
      businessPurpose: evidence.businessPurpose,
      lines: expense.lines.map((line) => ({ description: line.description, quantity: line.quantity, amount: line.lineTotalAmount })),
    },
    originalSourceDocumentType: evidence.originalSourceDocumentType,
    reasonCode: evidence.reasonCode,
    missingReceiptReason: evidence.missingReceiptReason,
    payee: {
      name: evidence.payeeName ?? expense.vendorNameSnapshot ?? '',
      address: evidence.payeeAddress,
      taxId: evidence.payeeTaxId,
    },
    payer: { userId: evidence.payerUserId, name: evidence.payerName, position: payerPosition, certifiedAt, roleLabel: 'ผู้รับรองการจ่าย' },
    certificationText: buildSubstituteCertificationText(evidence.payerName, payerPosition, true),
    evidence: refs,
    note: evidence.note,
  };
}

/**
 * R11: `PAPER` means the signatures exist only on the linked scan, so certification and approval
 * resolve no signature image and embed none. Returns the scan's checksum — the value the attestation
 * page prints and the only thing that makes a paper-route evidence signable at all — or `undefined`
 * for the unchanged digital route. A `PAPER` row without its scan is a broken state, not a route.
 */
function paperRouteScanChecksum(evidence: SubstituteReceiptEvidenceRecord): string | undefined {
  if (evidence.signatureMode !== 'PAPER') return undefined;
  if (!evidence.wetSignedScanAttachmentId || !evidence.wetSignedScanChecksumSha256) {
    throw new ConflictException('The hand-signed scan is missing from this paper-route substitute receipt.');
  }
  return evidence.wetSignedScanChecksumSha256;
}

function assertPreparedExpenseUnchanged(expense: ExpenseRecordWithRelations, evidence: SubstituteReceiptEvidenceRecord): void {
  if (!evidence.correctionOfEvidenceId) {
    assertSubstitutePaymentDetails(evidence.fundingSource, expense, evidence);
    assertSubstituteFactsComplete(evidence);
  }
  if (expense.updatedAt.getTime() !== evidence.expenseUpdatedAtAtPreparation.getTime()) {
    throw new ConflictException('Expense details changed after preparation. Finance must prepare a new version.');
  }
}

function isEligibleSubstituteReceiptApprover(
  userId: string,
  approvalMode: 'OWNER_SELF' | 'DESIGNATED_APPROVERS',
  configuredApproverUserIds: string[] | undefined,
  eligibleApproverIds: ReadonlySet<string>,
): boolean {
  return eligibleApproverIds.has(userId)
    && (approvalMode === 'OWNER_SELF' || Boolean(configuredApproverUserIds?.includes(userId)));
}

// One triggerKey per stage, and that is load-bearing: buildDedupKey is
// (companyId, triggerKey, sourceModule, sourceType, sourceId, periodKey), and every other part is
// identical for both stages of the same certificate. Sharing one key made prepare and certify
// collide on a single alert state, so prepare's 60-minute cooldown swallowed the approver
// notification whenever the payer signed within the hour — the normal case. The approver never got
// a recipient or delivery row at all.
const SIGNATURE_STAGES = {
  PAYER: {
    triggerKey: 'expense.substitute_receipt_signature_pending',
    title: (documentNumber: string) => `ใบรับรองแทนใบเสร็จรอการลงลายมือชื่อ เลขที่ ${documentNumber}`,
    body: 'เปิดระบบเพื่อตรวจสอบเอกสารและลงลายมือชื่อ',
  },
  APPROVER: {
    triggerKey: 'expense.substitute_receipt_approval_pending',
    title: (documentNumber: string) => `ใบรับรองแทนใบเสร็จรออนุมัติ เลขที่ ${documentNumber}`,
    body: 'ผู้จ่ายเงินลงลายมือชื่อแล้ว เปิดระบบเพื่อตรวจสอบและอนุมัติ',
  },
} as const;

async function notifySignaturePending(
  notify: CreateOrUpdateNotificationEventUseCase,
  ctx: RequestContext,
  evidence: Pick<SubstituteReceiptEvidenceRecord, 'id' | 'documentNumber'>,
  candidateUserIds: string[],
  stage: keyof typeof SIGNATURE_STAGES,
): Promise<void> {
  const recipientUserIds = candidateUserIds.filter((userId) => userId !== ctx.userId);
  if (recipientUserIds.length === 0) return;
  const copy = SIGNATURE_STAGES[stage];
  await notify.execute({
    companyId: ctx.companyId,
    triggerKey: copy.triggerKey,
    sourceModule: 'expenses',
    sourceType: 'substitute_receipt_evidence',
    sourceId: evidence.id,
    severity: 'action',
    title: copy.title(evidence.documentNumber),
    body: copy.body,
    deepLinkHref: `/companies/${ctx.companyId}/expenses/substitute-receipts/${evidence.id}`,
    recipientUserIds,
  });
}

@Injectable()
export class SaveOwnSubstituteReceiptReviewUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly update: UpdateExpenseDraftUseCase) {}

  async execute(ctx: RequestContext, expenseId: string, input: import('@watchdog-bms/contracts').UpdateExpenseDraftInput) {
    assertWeb(ctx);
    substituteReceiptPreparationScope(ctx);
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException('Expense not found.');
    assertSubstitutePreparationAccess(ctx, expense);
    const prior = expenseEvidenceAssessment(expense);
    if (prior?.route === 'SOURCE_DOCUMENT' && prior.receiptProblem === 'NONE') throw new BadRequestException('Expense already has a usable receipt.');
    if (expense.substituteReceiptEvidence && expense.substituteReceiptEvidence.status !== 'SUPERSEDED') throw new ForbiddenException('Cannot review an existing certificate.');
    const fields = ['expectedUpdatedAt', 'sourceDocumentType', 'taxEvidenceStatus', 'inputVatClaimStatus', 'documentReviewAcknowledged', 'evidenceAssessment'];
    const assessment = input.evidenceAssessment;
    if (Object.keys(input).some(key => !fields.includes(key)) || !input.expectedUpdatedAt
      || input.sourceDocumentType !== 'EXPENSE_NOTE_TEXT' || input.taxEvidenceStatus !== 'SUPPORTING_ONLY'
      || input.inputVatClaimStatus !== 'NON_CLAIMABLE' || input.documentReviewAcknowledged !== true
      || !assessment || assessment.route !== 'SUBSTITUTE_RECEIPT' || assessment.receiptProblem !== 'NOT_AVAILABLE'
      || assessment.reason !== '' || !Array.isArray(assessment.attachmentIds) || assessment.attachmentIds.length
      || Object.keys(assessment).some(key => !['route', 'receiptProblem', 'reason', 'attachmentIds'].includes(key))) throw new ForbiddenException('Only the no-receipt certificate review may be saved.');
    // This saves the no-receipt answer only; preparation validates the remaining facts later.
    const { inputVatClaimStatus: _systemRight, ...reviewInput } = input;
    return this.update.execute(ctx, expenseId, reviewInput, { requireExpectedUpdatedAt: true, ownSubstituteReceiptReview: true });
  }
}

@Injectable()
export class ListSubstituteReceiptCandidatesUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, filter: SubstituteReceiptCandidateFilter, options: { channel?: 'line' } = {}): Promise<SubstituteReceiptCandidatePage> {
    if (options.channel !== 'line') assertWeb(ctx);
    const scope = substituteReceiptPreparationScope(ctx, filter.branchId);
    const page = Number.isFinite(filter.page) ? Math.max(1, Math.floor(filter.page!)) : 1;
    const pageSize = Number.isFinite(filter.pageSize) ? Math.min(100, Math.max(1, Math.floor(filter.pageSize!))) : 5;
    const search = filter.search?.trim().slice(0, 100) ?? '';
    const sources = await this.repo.listSubstituteReceiptCandidateSources({ ...scope, search }, ctx.scopes ?? {});
    const eligible = sources.filter((expense) => {
      // Missing preparation facts can be filled in the wizard; these refusals cannot.
      if (collectSubstituteReceiptEligibilityIssues(expense, undefined, { routeCheckBill: isCheckBillClassification(expense.aiVerificationSummaryJson) })
        .some(issue => ['expense_status_ineligible', 'currency_not_supported', 'classification_ineligible', 'document_kind_ineligible'].includes(issue.code))) return false;
      if (expense.substituteReceiptEvidence && expense.substituteReceiptEvidence.status !== 'SUPERSEDED') return false;
      if (search && ![expense.expenseNumber, expense.vendorNameSnapshot, ...expense.lines.map((line) => line.description)]
        .some((value) => value?.toLocaleLowerCase().includes(search.toLocaleLowerCase()))) return false;
      const assessment = expenseEvidenceAssessment(expense);
      if (assessment?.route === 'SOURCE_DOCUMENT' && assessment.receiptProblem === 'NONE') return false;
      if (!assessment && expense.attachments.some(file => ['expense.receipt.primary', 'expense.receipt.supporting'].includes(file.purpose) && (!file.status || file.status === 'ACTIVE'))) return false;
      return true;
    }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    return { items: eligible.slice((page - 1) * pageSize, page * pageSize).map((expense) => ({
      id: expense.id, expenseNumber: expense.expenseNumber, expenseDate: expense.expenseDate.toISOString(),
      vendorNameSnapshot: expense.vendorNameSnapshot, grandTotalAmount: expense.grandTotalAmount.toString(), currency: expense.currency,
      lines: expense.lines.map((line) => ({ description: line.description })),
    })), total: eligible.length, page, pageSize };
  }
}

@Injectable()
export class ListCompanySubstituteReceiptsUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, filter: SubstituteReceiptListFilter): Promise<SubstituteReceiptListResult> {
    assertWeb(ctx);
    const canSeeAll = ctx.permissions.includes('expense.review') || ctx.permissions.includes('expense.confirm');
    const canSeeRelated = ctx.permissions.includes('expense.read_related');
    if (!canSeeAll && !canSeeRelated && !ctx.permissions.includes('expense.read_own') && !ctx.permissions.includes('expense.read')) {
      throw new ForbiddenException('Missing permission to read substitute receipts');
    }
    if (filter.status && !SUBSTITUTE_RECEIPT_STATUSES.has(filter.status)) {
      throw new BadRequestException('Invalid substitute receipt status.');
    }
    if (filter.yearMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(filter.yearMonth)) {
      throw new BadRequestException('yearMonth must use YYYY-MM.');
    }
    if (filter.order && !['newest', 'oldest'].includes(filter.order)) throw new BadRequestException('Invalid date order');
    const page = Number.isFinite(filter.page) ? Math.max(1, Math.floor(filter.page!)) : 1;
    const pageSize = Number.isFinite(filter.pageSize)
      ? Math.min(200, Math.max(1, Math.floor(filter.pageSize!)))
      : 50;
    const preparationScope = substituteReceiptPreparationScope(ctx);
    const onlyPayerUserId = null;
    const canApprove = ctx.permissions.includes('expense.confirm');
    const policy = canApprove ? await this.repo.getSubstituteReceiptPolicy(ctx.companyId) : null;
    const { rows, total, counts, sums, attention } = await this.repo.listCompanySubstituteReceipts(
      ctx.companyId,
      { ...filter, page, pageSize },
      { branchIds: ctx.scopes?.branchIds, onlyPayerUserId, createdByUserId: canSeeAll ? undefined : preparationScope.createdByUserId as string | undefined,
        userId: ctx.userId, canApprove, canSelfApprove: selfApprovalPermitted(policy?.approvalMode ?? 'OWNER_SELF', ctx.roles) },
    );
    return {
      items: rows.map((row) => ({
        evidenceId: row.id,
        canCancel: ctx.permissions.includes('expense.review') && row.status !== 'SUPERSEDED'
          && (row.correctionOfEvidenceId ? row.status !== 'ISSUED' : ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(row.expense.status)),
        fundingSource: row.fundingSource ?? null,
        signatureMode: row.signatureMode,
        paperSubmission: row.paperSubmissionJson as import('@watchdog-bms/contracts').SubstituteReceiptPaperSubmission | null,
        paperReviewedByUserId: row.paperReviewedByUserId,
        expenseId: row.expenseId,
        documentNumber: row.documentNumber,
        version: row.version,
        status: row.status as SubstituteReceiptEvidenceStatus,
        expenseNumber: row.expense.expenseNumber,
        expenseDate: row.expense.expenseDate.toISOString(),
        paymentDate: row.paymentDate?.toISOString() ?? null,
        payeeName: row.payeeName ?? row.expense.vendorNameSnapshot,
        payeeAddress: row.payeeAddress,
        payeeTaxId: row.payeeTaxId,
        currency: row.expense.currency,
        grandTotalAmount: expenseDecimalToString(row.expense.grandTotalAmount),
        payerUserId: row.payerUserId,
        payerName: row.payerName,
        approverUserId: row.approverUserId,
        approverName: row.approverName,
        artifactAttachmentId: row.artifactAttachmentId,
        certifiedArtifactAttachmentId: row.certifiedArtifactAttachmentId,
        updatedAt: row.updatedAt.toISOString(),
      })),
      total, counts, sums, attention,
      page,
      pageSize,
    };
  }
}

export type SubstituteReceiptSignatureQueueStep = {
  count: number;
  /** APPROVER: how many of `count` wait at each step, so a reply that groups the items by step states real counts. */
  byStep?: Array<{ stepLabel: string; count: number }>;
  items: Array<{ documentNumber: string; payeeName: string; amount: string; currency: string; expenseDate: string; preparedOn: string; stepLabel: string }>;
};

const APPROVE_STEP_LABEL = 'รอคุณอนุมัติ';
const PAPER_STEP_LABEL = 'ฉบับกระดาษรอคุณตรวจรับ';

function signatureQueueStep(
  page: Awaited<ReturnType<PrismaExpenseRepository['listSubstituteReceiptsAwaitingSignature']>>,
  step: 'PAYER' | 'APPROVER',
): SubstituteReceiptSignatureQueueStep {
  return {
    count: page.count,
    ...(step === 'APPROVER' ? { byStep: [
      { stepLabel: APPROVE_STEP_LABEL, count: page.count - page.paperCount }, { stepLabel: PAPER_STEP_LABEL, count: page.paperCount },
    ].filter((entry) => entry.count > 0) } : {}),
    items: page.rows.map((row) => ({
      documentNumber: row.documentNumber,
      payeeName: row.payeeName ?? row.expense.vendorNameSnapshot ?? '',
      amount: expenseDecimalToString(row.expense.grandTotalAmount),
      currency: row.expense.currency,
      expenseDate: civilDate(row.expense.expenseDate),
      preparedOn: civilDate(row.preparedAt),
      // Plain Thai, the web hub's own wording (never the status enum): a PREPARED row in the approver
      // step is a paper copy waiting to be accepted.
      stepLabel: step === 'PAYER' ? 'รอคุณลงลายมือชื่อในฐานะผู้จ่ายเงิน'
        : row.status === 'PREPARED' ? PAPER_STEP_LABEL : APPROVE_STEP_LABEL,
    })),
  };
}

/**
 * Advisor S1 (spec §5.2): the substitute receipts waiting for THIS caller's own signature — as the named
 * payer (what the web certify route lets them sign) or as an approver passing the same gates as
 * ApproveSubstituteReceiptUseCase and PaperSubstituteReceiptUseCase.accept: policy mode, eligibility,
 * branch, self-approval by real roles, and the original approver for a correction. Read-only, so no
 * assertWeb: signing and approving keep their own web-only guards.
 */
@Injectable()
export class ListMySubstituteReceiptSignaturesUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, input: { role?: 'payer' | 'approver'; limit: number }): Promise<{
    asPayer?: SubstituteReceiptSignatureQueueStep; asApprover?: SubstituteReceiptSignatureQueueStep;
  }> {
    const none: SubstituteReceiptSignatureQueueStep = { count: 0, items: [] };
    const branchIds = ctx.scopes?.branchIds;
    const payerAllowed = ctx.permissions.includes('expense.read_related') || ctx.permissions.includes('expense.read_own');
    return {
      ...(input.role !== 'approver' ? { asPayer: payerAllowed ? signatureQueueStep(await this.repo.listSubstituteReceiptsAwaitingSignature(
        ctx.companyId, { step: 'PAYER', userId: ctx.userId, branchIds }, input.limit), 'PAYER') : none } : {}),
      ...(input.role !== 'payer' ? { asApprover: ctx.permissions.includes('expense.confirm') ? await this.approverStep(ctx, input.limit) : none } : {}),
    };
  }

  private async approverStep(ctx: RequestContext, limit: number): Promise<SubstituteReceiptSignatureQueueStep> {
    const policy = await this.repo.getSubstituteReceiptPolicy(ctx.companyId);
    const approvalMode = policy?.approvalMode ?? 'OWNER_SELF';
    // No branch here on purpose: the caller's own branch scope below is the same membership scope the
    // per-branch eligibility list checks, so only "an active role with expense.confirm" is left to prove.
    const eligible = new Set((await this.repo.listEligibleSubstituteReceiptApprovers(ctx.companyId)).map((approver) => approver.userId));
    if (!isEligibleSubstituteReceiptApprover(ctx.userId, approvalMode, policy?.approverUserIds, eligible)) return { count: 0, items: [] };
    const branchIds = ctx.scopes?.branchIds;
    const corrections = await this.repo.listPendingSubstituteCorrections(ctx.companyId, branchIds);
    return signatureQueueStep(await this.repo.listSubstituteReceiptsAwaitingSignature(ctx.companyId, {
      step: 'APPROVER', userId: ctx.userId, branchIds,
      excludeSelf: !selfApprovalPermitted(approvalMode, ctx.roles),
      excludeEvidenceIds: corrections.filter((row) => row.originalApproverUserId !== ctx.userId).map((row) => row.id),
    }, limit), 'APPROVER');
  }
}

@Injectable()
export class PrepareSubstituteReceiptUseCase {
  private readonly logger = new Logger(PrepareSubstituteReceiptUseCase.name);

  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly audit: AuditService,
    private readonly notify: CreateOrUpdateNotificationEventUseCase,
  ) {}

  async executeCorrection(ctx: RequestContext, expenseId: string, evidenceId: string, input: { reason: string; expectedEvidenceUpdatedAt: string }): Promise<SubstituteReceiptEvidenceSummary> {
    assertWeb(ctx);
    if (!ctx.permissions.includes('expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    const reason = requiredText(input.reason, 'reason', 500);
    const original = await this.repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
    if (!original || original.status !== 'ISSUED' || original.updatedAt.getTime() !== parseExpectedDate(input.expectedEvidenceUpdatedAt, 'expectedEvidenceUpdatedAt').getTime()) throw new ConflictException('substitute_correction_source_changed');
    if (!original.snapshotJson || canonicalSnapshotHash(original.snapshotJson as unknown as SubstituteReceiptSnapshot) !== original.snapshotChecksumSha256) throw new ConflictException('substitute_snapshot_integrity_mismatch');
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException('Expense not found');
    assertBranch(ctx, expense.branchId);
    const created = await this.repo.createPreparedSubstituteEvidence({
      companyId: ctx.companyId, expenseId, branchId: original.branchId, expectedExpenseUpdatedAt: expense.updatedAt,
      correctionOfEvidenceId: original.id, correctionReason: reason, fundingSource: original.fundingSource ?? null,
      originalSourceDocumentType: original.originalSourceDocumentType, reasonCode: original.reasonCode,
      missingReceiptReason: original.missingReceiptReason, businessPurpose: original.businessPurpose,
      paymentEvidenceAttachmentIds: original.paymentEvidenceAttachmentIds, supportingAttachmentIds: original.supportingAttachmentIds,
      paymentDate: original.paymentDate, paymentMethod: original.paymentMethod, note: original.note,
      signatureMode: original.signatureMode === 'PAPER' && !original.payerUserId ? 'PAPER' : 'DIGITAL',
      payerUserId: original.payerUserId, payerName: original.payerName, payeeName: original.payeeName ?? '',
      payeeAddress: original.payeeAddress, payeeTaxId: original.payeeTaxId,
      preparedByUserId: ctx.userId, preparedFromChannel: 'WEB', idempotencyKey: `correct:${original.id}:${original.updatedAt.toISOString()}`,
    });
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.substitute_receipt.correct_document',
      targetType: 'expense_substitute_receipt', targetId: created.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { expenseId, correctionOfEvidenceId: original.id, reason } });
    try { if (original.payerUserId) await notifySignaturePending(this.notify, ctx, created, [original.payerUserId], 'PAYER'); }
    catch (error) { this.logger.warn({ msg: 'Substitute correction payer notification failed', evidenceId: created.id, error: error instanceof Error ? error.message : String(error) }); }
    return toSubstituteEvidenceSummary(created);
  }

  async executeAmendment(ctx: RequestContext, expenseId: string, evidenceId: string, input: AmendSubstituteReceiptInput): Promise<SubstituteReceiptEvidenceSummary> {
    assertWeb(ctx);
    if (!ctx.permissions.includes('expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    if (!EXPENSE_PAYMENT_METHODS.includes(input.paymentMethod)) throw new BadRequestException('วิธีจ่ายไม่ถูกต้อง เลือกวิธีจ่ายจากตัวเลือกที่แสดง');
    if (!isCivilDate(input.paymentDate)) throw new BadRequestException('วันที่จ่ายเงินไม่ถูกต้อง เลือกวันที่จ่ายเงินอีกครั้ง');
    const current = await this.repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
    if (!current) throw new NotFoundException('Substitute evidence not found.');
    if (!['PREPARED', 'PAYER_CERTIFIED'].includes(current.status) || current.correctionOfEvidenceId
      || current.updatedAt.getTime() !== parseExpectedDate(input.expectedEvidenceUpdatedAt, 'expectedEvidenceUpdatedAt').getTime()) {
      throw new ConflictException('เอกสารเปลี่ยนแปลงหรือออกสมบูรณ์แล้ว เปิดหน้านี้ใหม่ก่อนแก้ไข');
    }
    return this.prepare(ctx, expenseId, {
      reasonCode: input.reasonCode, missingReceiptReason: input.missingReceiptReason, businessPurpose: input.businessPurpose,
      payeeName: input.payeeName, payeeAddress: input.payeeAddress, payeeTaxId: input.payeeTaxId,
      paymentEvidenceAttachmentIds: input.paymentEvidenceAttachmentIds, supportingAttachmentIds: input.supportingAttachmentIds,
      paymentDate: input.paymentDate, paymentMethod: input.paymentMethod, expectedExpenseUpdatedAt: input.expectedExpenseUpdatedAt,
      fundingSource: current.fundingSource!, paidInFullAcknowledged: true,
      signatureMode: current.signatureMode, ...(current.payerUserId ? { payerUserId: current.payerUserId } : {}),
      ...(current.note ? { note: current.note } : {}),
      idempotencyKey: `certificate-edit:${current.id}:${current.updatedAt.toISOString()}`,
    }, { evidenceId, expectedUpdatedAt: current.updatedAt, keepDocumentNumberConfirmed: input.keepDocumentNumberConfirmed, previousPaymentDate: current.paymentDate?.toISOString() });
  }

  async execute(ctx: RequestContext, expenseId: string, input: GenerateSubstituteReceiptInput, lineConfirmed = false): Promise<SubstituteReceiptEvidenceSummary> {
    if (!lineConfirmed) assertWeb(ctx);
    return this.prepare(ctx, expenseId, input);
  }

  private async prepare(ctx: RequestContext, expenseId: string, input: GenerateSubstituteReceiptInput,
    amendment?: { evidenceId: string; expectedUpdatedAt: Date; keepDocumentNumberConfirmed?: boolean; previousPaymentDate?: string }): Promise<SubstituteReceiptEvidenceSummary> {
    // R7: preparing is the one substitute-receipt step LINE may take. It writes staged facts and
    // reserves a document number; it embeds no signature and grants no approval. The three gates
    // keep their existing review and branch checks on LINE. Web also permits the readable creator
    // to prepare; payer identity and signature authority are unchanged. Preview/certify/approve/download keep `assertWeb` (§16 last bullet).
    const preparedFromChannel = ctx.authProvider === 'line' ? 'LINE' : 'WEB';
    if (ctx.authProvider === 'line' && !ctx.permissions.includes('expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    substituteReceiptPreparationScope(ctx);
    if (!['COMPANY', 'PERSONAL_ADVANCE'].includes(input.fundingSource)) throw new BadRequestException({ code: 'substitute_funding_source_required', message: 'เลือกบริษัทจ่ายเต็มจำนวนหรือพนักงานสำรองจ่ายเต็มจำนวน' });
    if (input.paidInFullAcknowledged !== true) throw new BadRequestException({ code: 'substitute_full_payment_required', message: 'ยืนยันว่าจ่ายเต็มจำนวนจากแหล่งเงินเดียวแล้ว' });
    if (!REASON_CODES.has(input.reasonCode)) throw new BadRequestException('Invalid substitute receipt reasonCode.');
    const reason = requiredText(input.missingReceiptReason, 'missingReceiptReason', 500);
    const purpose = requiredText(input.businessPurpose, 'businessPurpose', 500);
    const signatureMode = input.signatureMode ?? 'DIGITAL';
    if (!['DIGITAL', 'PAPER'].includes(signatureMode)) throw new BadRequestException('Invalid signatureMode.');
    if (signatureMode === 'PAPER' && (preparedFromChannel !== 'WEB' || input.payerUserId)) throw new BadRequestException('Paper signers are entered from the signed form, without an account.');
    const payerUserId = signatureMode === 'PAPER' ? null : requiredText(input.payerUserId, 'payerUserId', 100);
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey', 128);
    const continuationId = input.continuationId === undefined
      ? undefined
      : requiredText(input.continuationId, 'continuationId', 100);
    const note = input.note === undefined ? null : requiredText(input.note, 'note', 500);
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertSubstitutePreparationAccess(ctx, expense);
    validateEligibility(expense, input.reasonCode, { routeCheckBill: input.routeCheckBill === true });
    await assertCaptureSourceEligible(this.repo, ctx.companyId, expense, input.fundingSource);
    if (!amendment && ctx.permissions.includes('expense.review') && (!hasCurrentExpenseEvidenceReview(expense) || expenseEvidenceAssessment(expense)?.route !== 'SUBSTITUTE_RECEIPT')) {
      throw new BadRequestException({ code: 'EXPENSE_EVIDENCE_REVIEW_REQUIRED', message: 'ระบุปัญหาเอกสารและบันทึกการตรวจล่าสุดก่อนจัดทำใบรับรอง' });
    }
    const payeeName = optionalText(input.payeeName, 'payeeName', 200)
      ?? optionalText(expense.vendorNameSnapshot, 'payeeName', 200);
    if (!payeeName) throw new BadRequestException('payeeName is required when the expense has no vendor name.');
    const payeeAddress = optionalText(input.payeeAddress, 'payeeAddress', 300);
    const payeeTaxId = optionalPayeeTaxId(input.payeeTaxId);
    const expectedExpenseUpdatedAt = parseExpectedDate(input.expectedExpenseUpdatedAt, 'expectedExpenseUpdatedAt');
    if (expense.updatedAt.getTime() !== expectedExpenseUpdatedAt.getTime()) throw new ConflictException({
      code: 'substitute_expense_changed', message: 'Expense changed after review. Reload before preparing substitute evidence.',
    });

    const payer = payerUserId ? await this.repo.findActiveMemberIdentity(ctx.companyId, payerUserId, expense.branchId) : null;
    if (payerUserId && !payer) throw new BadRequestException('The selected payer is not an active company member in this branch.');
    const policy = await this.repo.getSubstituteReceiptPolicy(ctx.companyId);
    const approvalMode = policy?.approvalMode ?? 'OWNER_SELF';
    const eligibleApprovers = await this.repo.listEligibleSubstituteReceiptApprovers(ctx.companyId, expense.branchId);
    const eligibleApproverIds = new Set(eligibleApprovers.map((approver) => approver.userId));
    if (approvalMode === 'DESIGNATED_APPROVERS'
      && !eligibleApprovers.some((approver) => approver.userId !== payer?.userId
        && isEligibleSubstituteReceiptApprover(approver.userId, approvalMode, policy?.approverUserIds, eligibleApproverIds))) {
      throw new BadRequestException('No configured approver with expense.confirm is eligible for this branch and distinct from the selected payer.');
    }
    if (approvalMode === 'OWNER_SELF' && eligibleApproverIds.size === 0) {
      throw new BadRequestException('No active member with expense.confirm is eligible to approve for this branch.');
    }
    const paymentIds = uniqueIds(input.paymentEvidenceAttachmentIds);
    const supportingIds = uniqueIds(input.supportingAttachmentIds);
    if (paymentIds.some((id) => supportingIds.includes(id))) {
      throw new BadRequestException({ code: 'substitute_evidence_overlap', message: 'The same file cannot serve as both source/supporting evidence and payment evidence.' });
    }
    const allIds = [...new Set([...paymentIds, ...supportingIds])];
    if (allIds.length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments) {
      throw renderabilityError(
        'substitute_receipt_too_many_evidence',
        `A substitute receipt supports at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments} linked evidence files.`,
      );
    }
    if (allIds.some(id => expense.attachments.some(file => file.id === id && file.isHistorical))) {
      throw new BadRequestException({ code: 'substitute_evidence_unavailable', message: 'เอกสารที่ยกเลิกหรือแทนที่แล้วใช้เป็นหลักฐานฉบับปัจจุบันไม่ได้' });
    }
    const attachments = await this.repo.findSubstituteEvidenceAttachments(ctx.companyId, expenseId, allIds);
    if (attachments.length !== allIds.length) throw new BadRequestException({
      code: 'substitute_evidence_unavailable', message: 'Every evidence attachment must be ACTIVE and linked to this expense.',
    });
    assertSubstituteReceiptEvidenceRenderable(attachments);
    const paymentEvidence = attachments.filter((attachment) => paymentIds.includes(attachment.id));
    if ((isCheckBillClassification(expense.aiVerificationSummaryJson)
      && (paymentIds.includes(expense.primaryAttachmentId ?? '')
        || expense.attachments.some((source) => paymentIds.includes(source.id) && source.purpose !== 'expense.payment.evidence')))
      || paymentEvidence.some((attachment) => attachment.purpose !== 'expense.payment.evidence'
      || (!attachment.mimeType.startsWith('image/') && attachment.mimeType !== 'application/pdf'))) {
      throw new BadRequestException({ code: 'substitute_payment_evidence_invalid', message: 'Payment evidence must be a separate image/PDF linked with purpose expense.payment.evidence.' });
    }
    const paymentMethod = input.paymentMethod ?? expense.paymentMethod;
    if (!paymentMethod) throw new BadRequestException('Payment method is required.');
    if (paymentIds.length === 0 && substituteReceiptRequiresPaymentEvidence(
      expense.aiVerificationSummaryJson, paymentMethod, policy?.cashEvidencePolicy,
    )) {
      throw new BadRequestException({
        code: isCheckBillClassification(expense.aiVerificationSummaryJson) ? 'check_bill_payment_evidence_required' : 'payment_evidence_required',
        message: 'Attach separate proof of actual payment before preparing the substitute receipt.',
      });
    }
    const paymentDate = input.paymentDate ? parseExpectedDate(input.paymentDate, 'paymentDate') : expense.paidAt;
    if (!paymentDate) throw new BadRequestException('Payment date is required because the payer certifies an amount already paid for company business.');
    assertSubstitutePaymentDetails(input.fundingSource, expense, { paymentDate, paymentMethod });

    try {
      const evidence = await this.repo.createPreparedSubstituteEvidence({
        companyId: ctx.companyId,
        expenseId,
        branchId: expense.branchId,
        expectedExpenseUpdatedAt,
        amendment,
        fundingSource: input.fundingSource,
        originalSourceDocumentType: expense.sourceDocumentType,
        reasonCode: input.reasonCode,
        missingReceiptReason: reason,
        businessPurpose: purpose,
        paymentEvidenceAttachmentIds: paymentIds,
        supportingAttachmentIds: supportingIds,
        paymentDate,
        paymentMethod,
        note,
        signatureMode,
        payerUserId: payer?.userId ?? null,
        payerName: payer?.displayName ?? '',
        payeeName,
        payeeAddress,
        payeeTaxId,
        preparedByUserId: ctx.userId,
        preparedFromChannel,
        routeCheckBill: input.routeCheckBill === true,
        idempotencyKey,
        ...(continuationId
          ? { lineContinuation: { workflowId: continuationId, userId: ctx.userId, formRequested: input.formRequested === true } }
          : {}),
      });
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: amendment ? 'expense.substitute_receipt.amend' : 'expense.substitute_receipt.prepare',
        targetType: 'expense_substitute_receipt', targetId: evidence.id, requestId: ctx.requestId,
        // R5: evidenceCount makes every self-certified no-evidence document listable in one query.
        result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: {
          ...(amendment ? { previousEvidenceId: amendment.evidenceId, documentNumber: evidence.documentNumber, previousPaymentDate: amendment.previousPaymentDate, paymentDate: evidence.paymentDate?.toISOString(), keepDocumentNumberConfirmed: amendment.keepDocumentNumberConfirmed === true } : {}),
          expenseId, version: evidence.version, payerUserId, fundingSource: input.fundingSource, paidInFullAcknowledged: true, evidenceCount: allIds.length, preparedFromChannel,
          // Spec §14 names `source: LINE` on the LINE-sourced row; on the web there is no source to state.
          ...(preparedFromChannel === 'LINE' ? { source: 'LINE' } : {}),
          ...(input.routeCheckBill === true ? { route: 'PAID_CHECK_BILL_WITHOUT_FINAL_RECEIPT' } : {}),
        },
      });
      try {
        if (payer && (!amendment || evidence.updatedAt.getTime() !== amendment.expectedUpdatedAt.getTime())) await notifySignaturePending(this.notify, ctx, evidence, [payer.userId], 'PAYER');
      } catch (error) {
        this.logger.warn({
          msg: 'Substitute receipt payer notification failed',
          evidenceId: evidence.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (signatureMode === 'PAPER' && evidence.status === 'PREPARED') {
        const currentExpense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
        if (!currentExpense) throw new NotFoundException('Expense not found');
        return toSubstituteEvidenceSummary(await freezePaperForm(this.repo, ctx.companyId, currentExpense, evidence));
      }
      return toSubstituteEvidenceSummary(evidence);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ConflictException((error as Error).message);
    }
  }
}

@Injectable()
export class PreviewSubstituteReceiptUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, expenseId: string, evidenceId: string, input: { payerPosition?: string }) {
    assertWeb(ctx);
    const payerPosition = optionalText(input.payerPosition, 'payerPosition', 120) ?? '';
    const evidence = await this.repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
    if (!evidence) throw new NotFoundException('Substitute evidence not found.');
    if (evidence.status !== 'PREPARED') throw new ConflictException(`Expected PREPARED evidence, found ${evidence.status}.`);
    if (evidence.payerUserId !== ctx.userId) throw new ForbiddenException('Only the selected actual payer may preview this evidence.');
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertBranch(ctx, expense.branchId);
    assertPreparedExpenseUnchanged(expense, evidence);
    if (!evidence.correctionOfEvidenceId) {
      validateEligibility(expense, evidence.reasonCode);
      // W07-int: the capture gate runs HERE too, not only at prepare. The allocation a certificate
      // states is the one the group accepted, and that is a fact about the group, not about this
      // expense — `assertPreparedExpenseUnchanged` cannot see it move. A correction keeps the
      // ordinary path, for the same reason `validateEligibility` does: it re-issues a document
      // that already exists and must not be stranded by a later decision about the group.
      await assertCaptureSourceEligible(this.repo, ctx.companyId, expense, evidence.fundingSource ?? null);
    }
    const snapshot = await buildSnapshot(this.repo, ctx.companyId, expense, evidence, payerPosition, PREVIEW_CERTIFIED_AT);
    const previewChecksumSha256 = canonicalSnapshotHash(snapshot);
    const svg = renderSubstituteReceiptSvg(snapshot);
    return { svgDataUrl: `data:image/svg+xml;base64,${svg.toString('base64')}`, previewChecksumSha256, expectedEvidenceUpdatedAt: evidence.updatedAt.toISOString() };
  }
}

/**
 * The bytes of the issued certificate, with no caller identity in sight. Extracted from the web
 * download so the §12 delivery link can copy exactly the same document without either duplicating
 * the R11 paper-route composition or borrowing a web `RequestContext` it does not have — the
 * `assertWeb` boundary (§16) stays on the endpoints, where it belongs.
 */
function cancellationPrintReason(evidence: SubstituteReceiptEvidenceRecord): string | null {
  const reason = evidence.supersedeReason?.trim();
  if (!reason) return null;
  const systemReasons: Record<string, string> = {
    EXPENSE_VOIDED: 'ยกเลิกรายการค่าใช้จ่ายต้นทาง',
    CORRECTED_VERSION_PREPARED: 'จัดทำเอกสารฉบับแก้ไขแทนฉบับนี้',
    NEW_VERSION_ISSUED: 'ออกเอกสารฉบับใหม่แทนฉบับนี้แล้ว',
  };
  return systemReasons[reason] ?? reason;
}

export async function composeIssuedSubstituteReceiptPdf(
  repo: PrismaExpenseRepository,
  storage: AttachmentStoragePort,
  companyId: string,
  expenseId: string,
  evidence: SubstituteReceiptEvidenceRecord,
): Promise<{ data: Buffer; fileName: string; stateStamp?: 'VOID' | 'SUPERSEDED'; scanLinked: boolean }> {
  if (!['ISSUED', 'SUPERSEDED'].includes(evidence.status) || !evidence.artifactAttachmentId) {
    throw new ConflictException('The substitute-receipt certificate has not been issued yet.');
  }
  const attachment = await repo.findSubstituteArtifactAttachment(
    companyId,
    expenseId,
    evidence.artifactAttachmentId,
  );
  if (!attachment) throw new NotFoundException('Issued substitute-receipt artifact not found.');
  const svg = await storage.getObject({
    bucket: attachment.bucket,
    objectKey: attachment.objectKey,
    ...(attachment.objectVersionId ? { objectVersionId: attachment.objectVersionId } : {}),
  });
  // The immutable, checksummed SVG remains authoritative; this PDF is a derived printout generated on demand.
  const stateStamp = evidence.status === 'SUPERSEDED'
    ? evidence.supersedeReason === SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON ? 'VOID' : 'SUPERSEDED'
    : undefined;
  // R11: on the paper route the stored artifact is the attestation page, and the signatures live
  // on the scan — so the document handed over is the scan first, then that page.
  const scan = evidence.signatureMode === 'PAPER' && evidence.wetSignedScanAttachmentId
    ? await repo.findSubstituteArtifactAttachment(
      companyId, expenseId, evidence.wetSignedScanAttachmentId, ['image/jpeg', 'image/png', 'application/pdf'],
    )
    : null;
  if (evidence.signatureMode === 'PAPER' && !scan) {
    throw new ConflictException('The hand-signed scan of this substitute receipt is no longer available.');
  }
  let data: Buffer;
  if (scan) {
    const scanObject = await storage.getObject({
      bucket: scan.bucket, objectKey: scan.objectKey, ...(scan.objectVersionId ? { objectVersionId: scan.objectVersionId } : {}),
    });
    // R11: the scan's checksum is recorded on the evidence precisely so the bytes handed over can
    // be proven to be the ones that were certified. Silently printing different bytes would be a
    // forged document, so a mismatch refuses with a code the web can explain.
    if (sha256(scanObject.bytes) !== evidence.wetSignedScanChecksumSha256) {
      throw new ConflictException({
        code: 'substitute_wet_signed_scan_checksum_mismatch',
        message: 'The stored hand-signed scan no longer matches the checksum recorded at certification.',
      });
    }
    try {
      data = await renderSubstituteReceiptPaperArtifactPdf(
        { bytes: scanObject.bytes, mimeType: scan.mimeType },
        svg.bytes,
        evidence.documentNumber,
        { ...(stateStamp ? { stateStamp, cancellationReason: cancellationPrintReason(evidence) } : {}), omitPageFooter: evidence.payerUserId === null },
      );
    } catch (error) {
      // Linking validates composability, so reaching here means the stored object changed under
      // us. It is still a state the reader can act on, never an unexplained 500.
      throw new ConflictException({
        code: 'substitute_wet_signed_scan_not_renderable',
        message: `The hand-signed scan can no longer be composed into the certificate (${(error as Error).message.slice(0, 120)}).`,
      });
    }
  } else {
    data = await renderSubstituteReceiptPdf(withoutSubstituteReceiptPrintMetadata(svg.bytes), evidence.documentNumber, { stateStamp, cancellationReason: cancellationPrintReason(evidence), omitPageFooter: true });
  }
  const stateSuffix = stateStamp ? `-${stateStamp}` : '';
  return {
    data,
    fileName: `${evidence.documentNumber.replace(/["\r\n]/g, '_')}${stateSuffix}.pdf`,
    ...(stateStamp ? { stateStamp } : {}),
    scanLinked: !!scan,
  };
}

@Injectable()
export class DownloadSubstituteReceiptPdfUseCase {
  constructor(
    private readonly getExpense: GetExpenseUseCase,
    private readonly repo: PrismaExpenseRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
  ) {}

  async preview(ctx: RequestContext, expenseId: string, evidenceId: string) {
    const { data } = await this.execute(ctx, expenseId, evidenceId);
    return { pdfDataUrl: `data:application/pdf;base64,${data.toString('base64')}`,
      pageImageDataUrls: await renderSubstitutePaperPreviewPages(data), previewChecksumSha256: sha256(data) };
  }

  async execute(ctx: RequestContext, expenseId: string, evidenceId: string): Promise<{ data: Buffer; fileName: string }> {
    assertWeb(ctx);
    await this.getExpense.execute(ctx, expenseId);
    const evidence = await this.repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
    if (!evidence) throw new NotFoundException('Substitute evidence not found.');
    const composed = await this.composeForState(ctx.companyId, expenseId, evidence);
    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'expense.substitute_receipt.artifact.download',
      targetType: 'expense_substitute_receipt',
      targetId: evidenceId,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: {
        expenseId,
        artifactAttachmentId: evidence.artifactAttachmentId,
        evidenceStatus: evidence.status,
        supersedeReason: evidence.supersedeReason,
        derivedStamp: composed.stateStamp ?? null,
        signatureMode: evidence.signatureMode,
        ...(composed.scanLinked ? { wetSignedScanAttachmentId: evidence.wetSignedScanAttachmentId } : {}),
      },
    });
    return { data: composed.data, fileName: composed.fileName };
  }

  private async composeForState(companyId: string, expenseId: string, evidence: SubstituteReceiptEvidenceRecord) {
    if (evidence.artifactAttachmentId && ['ISSUED', 'SUPERSEDED'].includes(evidence.status)) {
      return composeIssuedSubstituteReceiptPdf(this.repo, this.storage, companyId, expenseId, evidence);
    }
    if (evidence.status === 'ISSUED') throw new ConflictException({ code: 'substitute_print_artifact_unavailable', message: 'ไม่พบไฟล์ฉบับสมบูรณ์ ลองดาวน์โหลดเอกสารอีกครั้ง' });
    const historical = evidence.status === 'SUPERSEDED';
    const stateStamp = historical
      ? evidence.supersedeReason === SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON ? 'VOID' : 'SUPERSEDED'
      : evidence.status === 'PAYER_CERTIFIED' ? 'AWAITING APPROVAL' : 'AWAITING REVIEW';
    const fileName = `${evidence.documentNumber.replace(/["\r\n]/g, '_')}-${stateStamp.replaceAll(' ', '-')}.pdf`;
    const printOptions = { stateStamp, cancellationReason: historical ? cancellationPrintReason(evidence) : null, omitPageFooter: true } as const;
    if (evidence.wetSignedScanAttachmentId) {
      const scan = await this.repo.findSubstituteArtifactAttachment(companyId, expenseId, evidence.wetSignedScanAttachmentId, ['image/jpeg', 'image/png', 'application/pdf']);
      if (!scan) throw new NotFoundException({ code: 'substitute_print_artifact_unavailable', message: 'ไม่พบไฟล์ฉบับที่เซ็นที่เก็บไว้ เปิดหน้านี้ใหม่แล้วลองดาวน์โหลดอีกครั้ง' });
      const object = await this.storage.getObject({ bucket: scan.bucket, objectKey: scan.objectKey, ...(scan.objectVersionId ? { objectVersionId: scan.objectVersionId } : {}) });
      if (sha256(object.bytes) !== evidence.wetSignedScanChecksumSha256) throw new ConflictException({ code: 'substitute_wet_signed_scan_checksum_mismatch', message: 'ไฟล์ฉบับที่เซ็นไม่ตรงกับข้อมูลที่ยื่น แจ้งทีมงานมั่งมีให้ตรวจไฟล์ก่อนใช้เอกสาร' });
      return { data: await renderSubstituteReceiptPaperArtifactPdf({ bytes: object.bytes, mimeType: scan.mimeType }, null, evidence.documentNumber, printOptions), fileName, stateStamp, scanLinked: true };
    }
    if (evidence.certifiedArtifactAttachmentId) {
      const artifact = await this.repo.findSubstituteArtifactAttachment(companyId, expenseId, evidence.certifiedArtifactAttachmentId);
      if (!artifact) throw new NotFoundException({ code: 'substitute_print_artifact_unavailable', message: 'ไม่พบฉบับที่ผู้รับรองเซ็นไว้ เปิดหน้านี้ใหม่แล้วลองดาวน์โหลดอีกครั้ง' });
      const object = await this.storage.getObject({ bucket: artifact.bucket, objectKey: artifact.objectKey, ...(artifact.objectVersionId ? { objectVersionId: artifact.objectVersionId } : {}) });
      if (sha256(object.bytes) !== evidence.certifiedArtifactChecksumSha256) throw new ConflictException({ code: 'substitute_certified_artifact_checksum_mismatch', message: 'ไฟล์ฉบับที่เซ็นไม่ตรงกับข้อมูลที่รับรองไว้ แจ้งทีมงานมั่งมีให้ตรวจไฟล์ก่อนใช้เอกสาร' });
      return { data: await renderSubstituteReceiptPdf(withoutSubstituteReceiptPrintMetadata(object.bytes), evidence.documentNumber, printOptions), fileName, stateStamp, scanLinked: false };
    }
    if (evidence.status === 'PREPARED' && !evidence.paperSubmissionJson) {
      const expense = await this.repo.findByIdWithRelations(companyId, expenseId);
      if (!expense) throw new NotFoundException('ไม่พบรายการค่าใช้จ่าย');
      const form = await composeUnsignedSubstituteReceiptFormPdf(this.repo, companyId, expense, evidence);
      return { ...form, stateStamp: evidence.signatureMode === 'PAPER' && !evidence.payerUserId ? undefined : 'UNSIGNED' as const, scanLinked: false };
    }
    // Historical content must come from retained facts, never today's source expense.
    const snapshot = evidence.paperFormSnapshotJson ?? evidence.snapshotJson;
    if (historical && snapshot) {
      const svg = renderSubstituteReceiptSvg(snapshot as unknown as SubstituteReceiptSnapshot, undefined, undefined, undefined, { paperForm: evidence.signatureMode === 'PAPER', unsignedForm: evidence.signatureMode !== 'PAPER' });
      return { data: await renderSubstituteReceiptPdf(svg, evidence.documentNumber, printOptions), fileName, stateStamp, scanLinked: false };
    }
    throw new ConflictException({ code: 'substitute_print_history_unavailable', message: 'ไม่มีไฟล์หรือข้อมูลฉบับเดิมเพียงพอสำหรับพิมพ์เอกสาร ดูประวัติรายการ' });
  }
}

/**
 * R8 — `แบบฟอร์มรอลงนาม`. The same snapshot the payer is about to certify, rendered with both
 * signature boxes blank and an `UNSIGNED` watermark. Visible document-number/version headings
 * and the old footer are omitted across signing modes. It is DERIVED on demand and never stored: no
 * attachment, no artifact id, nothing that could later be mistaken for the issued certificate.
 *
 * Extracted alongside `composeIssuedSubstituteReceiptPdf` so the §12 delivery link renders exactly
 * this sheet — Journey B must reach it without a web session.
 */
export async function composeUnsignedSubstituteReceiptFormPdf(
  repo: PrismaExpenseRepository,
  companyId: string,
  expense: ExpenseRecordWithRelations,
  evidence: SubstituteReceiptEvidenceRecord,
): Promise<{ data: Buffer; fileName: string }> {
  if (evidence.status !== 'PREPARED') throw new ConflictException(`The unsigned form exists only while the evidence is PREPARED, found ${evidence.status}.`);
  // Someone is about to sign this sheet by hand: it must carry the values the certification will,
  // not a stale copy of them.
  assertPreparedExpenseUnchanged(expense, evidence);
  if (evidence.signatureMode === 'PAPER' && !evidence.payerUserId) {
    const frozen = await freezePaperForm(repo, companyId, expense, evidence);
    const snapshot = frozen.paperFormSnapshotJson as unknown as SubstituteReceiptSnapshot;
    const svg = renderSubstituteReceiptSvg(snapshot, undefined, undefined, undefined, { paperForm: true });
    return { data: await renderSubstituteReceiptPdf(svg, evidence.documentNumber, { omitPageFooter: true }), fileName: `${evidence.documentNumber}-PAPER-FORM.pdf` };
  }
  const snapshot = await buildSnapshot(repo, companyId, expense, evidence, UNSIGNED_FORM_POSITION_BLANK, PREVIEW_CERTIFIED_AT);
  const svg = renderSubstituteReceiptSvg(snapshot, undefined, undefined, undefined, { unsignedForm: true });
  return {
    data: await renderSubstituteReceiptPdf(svg, evidence.documentNumber, { stateStamp: 'UNSIGNED', omitPageFooter: evidence.signatureMode !== 'PAPER' }),
    fileName: `${evidence.documentNumber.replace(/["\r\n]/g, '_')}-UNSIGNED.pdf`,
  };
}

@Injectable()
export class DownloadSubstituteReceiptFormPdfUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, expenseId: string, evidenceId: string): Promise<{ data: Buffer; fileName: string }> {
    assertWeb(ctx);
    if (!ctx.permissions.includes('expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    const evidence = await this.repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
    if (!evidence) throw new NotFoundException('Substitute evidence not found.');
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertBranch(ctx, expense.branchId);
    const composed = await composeUnsignedSubstituteReceiptFormPdf(this.repo, ctx.companyId, expense, evidence);
    // The sheet carries payee name and amount, so its egress is audited exactly like the issued
    // artifact's — the only difference is that this one has no stored attachment to name.
    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'expense.substitute_receipt.form.download',
      targetType: 'expense_substitute_receipt',
      targetId: evidenceId,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: { expenseId, evidenceStatus: evidence.status, version: evidence.version, derivedStamp: 'UNSIGNED' },
    });
    return composed;
  }
}

@Injectable()
export class DownloadPaymentVoucherPdfUseCase {
  constructor(
    private readonly getExpense: GetExpenseUseCase,
    private readonly repo: PrismaExpenseRepository,
  ) {}

  async execute(
    ctx: RequestContext,
    expenseId: string,
    input: { paymentDate?: string; payeeName?: string; payeeAddress?: string; payeeTaxId?: string },
  ): Promise<{ data: Buffer; fileName: string }> {
    const expense = await this.getExpense.execute(ctx, expenseId);
    const company = await this.repo.getSubstituteCompanyContext(ctx.companyId, expense.branchId);
    const payeeName = optionalText(input.payeeName, 'payeeName', 200)
      ?? optionalText(expense.vendorNameSnapshot, 'payeeName', 200);
    const svg = renderPaymentVoucherSvg({
      companyName: company.name,
      paymentDate: input.paymentDate
        ? parseExpectedDate(input.paymentDate, 'paymentDate').toISOString()
        : expense.paidAt?.toISOString() ?? null,
      payeeName,
      payeeAddress: optionalText(input.payeeAddress, 'payeeAddress', 300),
      payeeTaxId: optionalPayeeTaxId(input.payeeTaxId),
      expenseDescription: expense.lines.map((line) => line.description.trim()).filter(Boolean).join(', '),
      amount: expense.grandTotalAmount,
    });
    const data = await renderSubstituteReceiptPdf(svg);
    return { data, fileName: `ใบสำคัญรับเงิน-${expense.expenseNumber ?? expense.id}.pdf` };
  }
}

async function assertSubstituteApprovalAuthority(repo: PrismaExpenseRepository, ctx: RequestContext, expense: ExpenseRecordWithRelations, evidence: SubstituteReceiptEvidenceRecord) {
    if (evidence.correctionOfEvidenceId) {
      const original = await repo.findSubstituteEvidence(ctx.companyId, expense.id, evidence.correctionOfEvidenceId);
      if (original?.approverUserId !== ctx.userId) throw new ForbiddenException('การแก้เฉพาะเอกสารต้องให้ผู้อนุมัติเดิมเซ็น ให้ผู้อนุมัติเดิมเปิดใบนี้แล้วเซ็น');
    } else {
      // The last gate before the document becomes real (W07-int): an allocation superseded between
      // prepare and approval refuses here rather than issuing a certificate that states a division
      // the group no longer records.
      await assertCaptureSourceEligible(repo, ctx.companyId, expense, evidence.fundingSource ?? null);
    }
    const policy = await repo.getSubstituteReceiptPolicy(ctx.companyId);
    const approvalMode = policy?.approvalMode ?? 'OWNER_SELF';
    const selfApproved = evidence.payerUserId === ctx.userId;
    if (selfApproved && !selfApprovalPermitted(approvalMode, ctx.roles)) {
      throw new ForbiddenException('Self-approval of a substitute receipt requires the owner-self policy and an owner, admin, or manager role.');
    }
    const eligibleApproverIds = new Set((await repo.listEligibleSubstituteReceiptApprovers(ctx.companyId, expense.branchId))
      .map((candidate) => candidate.userId));
    const eligibleApprover = isEligibleSubstituteReceiptApprover(
      ctx.userId,
      approvalMode,
      policy?.approverUserIds,
      eligibleApproverIds,
    );
    if (approvalMode === 'DESIGNATED_APPROVERS'
      && !eligibleApprover) {
      throw new ForbiddenException('You are not a currently configured substitute-receipt approver for this branch.');
    }
    if (approvalMode === 'OWNER_SELF' && !eligibleApprover) {
      throw new ForbiddenException('You do not have expense.confirm for this branch.');
    }
    if (evidence.paymentMethod === 'CASH'
      && (policy?.cashEvidencePolicy ?? 'ALLOW_SUPPORTING_EVIDENCE_ONLY') === 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE'
      && evidence.paymentEvidenceAttachmentIds.length === 0) {
      throw new ConflictException('Current company policy requires separate payment evidence for cash expenses. Supersede and prepare a new version.');
    }
    const approver = await repo.findActiveMemberIdentity(ctx.companyId, ctx.userId, expense.branchId);
    if (!approver) throw new ForbiddenException('Approver is not an active company member in this branch.');
  return { approvalMode, approver };
}

@Injectable()
export class CertifySubstituteReceiptUseCase {
  private readonly logger = new Logger(CertifySubstituteReceiptUseCase.name);

  constructor(
    private readonly repo: PrismaExpenseRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
    private readonly notify: CreateOrUpdateNotificationEventUseCase,
    private readonly objectVersionCleanup: ObjectVersionCleanupService,
  ) {}

  async execute(ctx: RequestContext, expenseId: string, evidenceId: string, input: CertifySubstituteReceiptInput & { approvalAcknowledged?: boolean }): Promise<SubstituteReceiptEvidenceSummary> {
    assertWeb(ctx);
    if (input.certificationAcknowledged !== true) throw new BadRequestException('The payer must acknowledge the certification statement.');
    const payerPosition = optionalText(input.payerPosition, 'payerPosition', 120) ?? '';
    const evidence = await this.repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
    if (!evidence) throw new NotFoundException('Substitute evidence not found.');
    if (evidence.status !== 'PREPARED') throw new ConflictException(`Expected PREPARED evidence, found ${evidence.status}.`);
    if (evidence.payerUserId !== ctx.userId) throw new ForbiddenException('Only the selected actual payer may certify this evidence.');
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertBranch(ctx, expense.branchId);
    assertPreparedExpenseUnchanged(expense, evidence);
    if (!evidence.correctionOfEvidenceId) {
      validateEligibility(expense, evidence.reasonCode);
      await assertCaptureSourceEligible(this.repo, ctx.companyId, expense, evidence.fundingSource ?? null);
    }
    const expectedEvidenceUpdatedAt = parseExpectedDate(input.expectedEvidenceUpdatedAt, 'expectedEvidenceUpdatedAt');
    const previewSnapshot = await buildSnapshot(this.repo, ctx.companyId, expense, evidence, payerPosition, PREVIEW_CERTIFIED_AT);
    if (canonicalSnapshotHash(previewSnapshot) !== input.previewChecksumSha256) {
      throw new ConflictException('The reviewed preview no longer matches. Generate and review a new preview before signing.');
    }
    const combined = input.approvalAcknowledged !== undefined;
    let approver: { displayName: string } | undefined;
    if (combined) {
      if (!ctx.permissions.includes('expense.confirm')) throw new ForbiddenException('Missing permission: expense.confirm');
      const policy = await this.repo.getSubstituteReceiptPolicy(ctx.companyId);
      if (input.approvalAcknowledged !== true || (policy?.approvalMode ?? 'OWNER_SELF') !== 'OWNER_SELF'
        || !ctx.roles.includes('OWNER') || evidence.signatureMode !== 'DIGITAL') {
        throw new ForbiddenException('substitute_combined_signing_denied');
      }
      ({ approver } = await assertSubstituteApprovalAuthority(this.repo, ctx, expense, evidence));
    }
    // R10/R11: on the paper route the ink is on the scan, so no signature image is resolved and none
    // is drawn. The acknowledgement below is still the payer's own, and still its own audit row.
    const scanChecksum = paperRouteScanChecksum(evidence);
    const signature = scanChecksum
      ? undefined
      : await loadOwnedSignature(this.repo, this.storage, ctx.companyId, input.signatureAttachmentId, ctx.userId, evidence.id, 'payer');
    const certifiedAt = new Date();
    const snapshot: SubstituteReceiptSnapshot = { ...previewSnapshot, payer: { ...previewSnapshot.payer, certifiedAt: certifiedAt.toISOString() } };
    const snapshotChecksumSha256 = canonicalSnapshotHash(snapshot);
    const bytes = scanChecksum
      ? renderSubstituteReceiptAttestationSvg(snapshot, { snapshotChecksumSha256, wetSignedScanChecksumSha256: scanChecksum })
      : renderSubstituteReceiptSvg(snapshot, signature!.dataUrl);
    const checksumSha256 = sha256(bytes);
    const objectKey = `${ctx.companyId}/generated/expense-substitute/${expenseId}/v${evidence.version}-certified-${checksumSha256}-${randomUUID()}.svg`;
    const stored = await this.storage.putObject({ objectKey, mimeType: 'image/svg+xml', bytes });
    try {
      const certification = {
        companyId: ctx.companyId,
        expenseId,
        evidenceId,
        payerUserId: ctx.userId,
        payerPosition,
        ...(signature ? { payerSignatureAttachmentId: signature.id, payerSignatureChecksumSha256: signature.checksumSha256 } : {}),
        referencedAttachmentIds: [
          ...(signature ? [signature.id] : [evidence.wetSignedScanAttachmentId!]),
          ...evidence.paymentEvidenceAttachmentIds,
          ...evidence.supportingAttachmentIds,
        ],
        snapshotJson: snapshot as unknown as Record<string, unknown>,
        snapshotChecksumSha256,
        certifiedAt,
        expectedVersion: input.expectedVersion,
        expectedEvidenceUpdatedAt,
        artifact: { ...stored, checksumSha256, originalFileName: `${evidence.documentNumber}-certified.svg` },
      };
      const certificationAudit = {
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.substitute_receipt.certify',
        targetType: 'expense_substitute_receipt', targetId: evidenceId, requestId: ctx.requestId,
        result: 'SUCCESS' as const, riskLevel: 'HIGH' as const,
        metadataJson: {
          expenseId, version: evidence.version, snapshotChecksumSha256, source: ctx.authProvider === 'line' ? 'LINE' : 'WEB',
          signatureSource: signature?.source ?? 'wet_signed_scan',
          signatureMode: evidence.signatureMode,
        },
      };
      if (combined) {
        const approverDetails = { userId: ctx.userId, name: approver!.displayName, position: payerPosition, approvedAt: certifiedAt.toISOString() };
        const issuedBytes = renderSubstituteReceiptSvg(snapshot, signature!.dataUrl, approverDetails, signature!.dataUrl, { approverIsOwner: true });
        const issuedChecksum = sha256(issuedBytes);
        const issued = await this.storage.putObject({ objectKey: `${ctx.companyId}/generated/expense-substitute/${expenseId}/v${evidence.version}-issued-${issuedChecksum}-${randomUUID()}.svg`, mimeType: 'image/svg+xml', bytes: issuedBytes });
        try {
          const updated = await this.repo.certifyAndIssueSubstituteEvidence({
            certification,
            issuance: { companyId: ctx.companyId, expenseId, evidenceId, approverUserId: ctx.userId, approverName: approver!.displayName,
              approverPosition: payerPosition, allowSelfApproval: true, approverSignatureAttachmentId: signature!.id, approvedAt: certifiedAt,
              expectedExpenseUpdatedAt: evidence.expenseUpdatedAtAtPreparation, referencedAttachmentIds: certification.referencedAttachmentIds,
              expectedVersion: input.expectedVersion, expectedEvidenceUpdatedAt,
              artifact: { ...issued, checksumSha256: issuedChecksum, originalFileName: `${evidence.documentNumber}.svg` } },
            actorRoles: ctx.roles,
            auditEntries: [certificationAudit, { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.substitute_receipt.approve',
              targetType: 'expense_substitute_receipt', targetId: evidenceId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL',
              metadataJson: { expenseId, version: evidence.version, checksumSha256: issuedChecksum, selfApproved: true,
                signatureSource: signature!.source, signatureMode: evidence.signatureMode, certificationAcknowledged: true, approvalAcknowledged: true,
                previewChecksumSha256: input.previewChecksumSha256 } }],
          });
          return toSubstituteEvidenceSummary(updated);
        } catch (error) {
          await this.objectVersionCleanup.enqueue({ companyId: ctx.companyId, bucket: issued.bucket, objectPath: issued.objectKey,
            expectedVersion: issued.objectVersionId, source: 'SUBSTITUTE_RECEIPT_ISSUED' });
          throw error;
        }
      }
      const updated = await this.repo.markSubstituteEvidenceCertified(certification);
      void this.audit.log(certificationAudit);
      try {
        const policy = await this.repo.getSubstituteReceiptPolicy(ctx.companyId);
        const approvalMode = policy?.approvalMode ?? 'OWNER_SELF';
        const eligibleApprovers = await this.repo.listEligibleSubstituteReceiptApprovers(ctx.companyId, expense.branchId);
        const eligibleApproverIds = new Set(eligibleApprovers.map((approver) => approver.userId));
        const candidateUserIds = eligibleApprovers
          .filter((approver) => isEligibleSubstituteReceiptApprover(
            approver.userId,
            approvalMode,
            policy?.approverUserIds,
            eligibleApproverIds,
          ))
          .map((approver) => approver.userId);
        await notifySignaturePending(this.notify, ctx, evidence, candidateUserIds, 'APPROVER');
      } catch (error) {
        this.logger.warn({
          msg: 'Substitute receipt approver notification failed',
          evidenceId: evidence.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return toSubstituteEvidenceSummary(updated);
    } catch (error) {
      await this.objectVersionCleanup.enqueue({
        companyId: ctx.companyId,
        bucket: stored.bucket,
        objectPath: stored.objectKey,
        expectedVersion: stored.objectVersionId,
        source: 'SUBSTITUTE_RECEIPT_CERTIFIED',
      });
      throw new ConflictException((error as Error).message);
    }
  }

}

@Injectable()
export class ApproveSubstituteReceiptUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
    private readonly objectVersionCleanup: ObjectVersionCleanupService,
  ) {}

  async execute(ctx: RequestContext, expenseId: string, evidenceId: string, input: ApproveSubstituteReceiptInput): Promise<SubstituteReceiptEvidenceSummary> {
    assertWeb(ctx);
    if (!ctx.permissions.includes('expense.confirm')) throw new ForbiddenException('Missing permission: expense.confirm');
    if (input.approvalAcknowledged !== true) throw new BadRequestException('The approver must acknowledge approval.');
    const approverPosition = optionalText(input.approverPosition, 'approverPosition', 120) ?? '';
    const evidence = await this.repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
    if (!evidence) throw new NotFoundException('Substitute evidence not found.');
    const scanChecksum = paperRouteScanChecksum(evidence);
    if (evidence.status !== 'PAYER_CERTIFIED' || !evidence.snapshotJson
      || (!scanChecksum && !evidence.payerSignatureAttachmentId)) {
      throw new ConflictException('The payer must certify an immutable snapshot before approval.');
    }
    if (!scanChecksum && !evidence.payerSignatureChecksumSha256) throw new ConflictException('The certified payer signature checksum is missing.');
    if (input.certifiedArtifactChecksumSha256 !== evidence.certifiedArtifactChecksumSha256) {
      throw new ConflictException('Approval must acknowledge the current payer-certified artifact checksum.');
    }
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertBranch(ctx, expense.branchId);
    assertPreparedExpenseUnchanged(expense, evidence);
    const selfApproved = evidence.payerUserId === ctx.userId;
    const { approvalMode, approver } = await assertSubstituteApprovalAuthority(this.repo, ctx, expense, evidence);
    const expectedEvidenceUpdatedAt = parseExpectedDate(input.expectedEvidenceUpdatedAt, 'expectedEvidenceUpdatedAt');
    const snapshot = evidence.snapshotJson as unknown as SubstituteReceiptSnapshot;
    if (canonicalSnapshotHash(snapshot) !== evidence.snapshotChecksumSha256) throw new ConflictException('Certified snapshot checksum is invalid.');
    assertSubstituteReceiptSnapshotRenderable(snapshot);
    const approverSignature = scanChecksum
      ? undefined
      : await loadOwnedSignature(this.repo, this.storage, ctx.companyId, input.signatureAttachmentId, ctx.userId, evidence.id, 'approver');
    // The approver is not the person who can fix a payer signature that no longer resolves, so the
    // failure is reported as a state conflict with a recovery path, not as their bad request.
    const payerSignature = scanChecksum
      ? undefined
      : await loadOwnedSignature(this.repo, this.storage, ctx.companyId, evidence.payerSignatureAttachmentId!, evidence.payerUserId!, evidence.id, 'payer')
        .catch((error) => {
          if (error instanceof BadRequestException) {
            throw new ConflictException('Payer signature recorded at certification can no longer be resolved. Supersede this evidence and re-certify.');
          }
          throw error;
        });
    if (payerSignature && payerSignature.checksumSha256 !== evidence.payerSignatureChecksumSha256) {
      throw new ConflictException('The payer signature changed after certification.');
    }
    const approvedAt = new Date();
    const approverDetails = { userId: ctx.userId, name: approver.displayName, position: approverPosition, approvedAt: approvedAt.toISOString() };
    const bytes = scanChecksum
      ? renderSubstituteReceiptAttestationSvg(snapshot, {
        snapshotChecksumSha256: evidence.snapshotChecksumSha256!,
        wetSignedScanChecksumSha256: scanChecksum,
        approver: approverDetails,
      })
      : renderSubstituteReceiptSvg(snapshot, payerSignature!.dataUrl, approverDetails, approverSignature!.dataUrl, { approverIsOwner: ctx.roles.includes('OWNER') });
    const checksumSha256 = sha256(bytes);
    const objectKey = `${ctx.companyId}/generated/expense-substitute/${expenseId}/v${evidence.version}-issued-${checksumSha256}-${randomUUID()}.svg`;
    const stored = await this.storage.putObject({ objectKey, mimeType: 'image/svg+xml', bytes });
    try {
      const updated = await this.repo.issueSubstituteEvidence({
        companyId: ctx.companyId,
        expenseId,
        evidenceId,
        approverUserId: ctx.userId,
        approverName: approver.displayName,
        approverPosition,
        // State the policy, not the outcome: a later refactor of the guard above must not silently
        // widen what the in-transaction re-check permits.
        allowSelfApproval: selfApprovalPermitted(approvalMode, ctx.roles),
        ...(approverSignature ? { approverSignatureAttachmentId: approverSignature.id } : {}),
        approvedAt,
        expectedExpenseUpdatedAt: evidence.expenseUpdatedAtAtPreparation,
        referencedAttachmentIds: [
          ...(approverSignature ? [approverSignature.id, evidence.payerSignatureAttachmentId!] : [evidence.wetSignedScanAttachmentId!]),
          ...(evidence.certifiedArtifactAttachmentId ? [evidence.certifiedArtifactAttachmentId] : []),
          ...evidence.paymentEvidenceAttachmentIds,
          ...evidence.supportingAttachmentIds,
        ],
        expectedVersion: input.expectedVersion,
        expectedEvidenceUpdatedAt,
        artifact: { ...stored, checksumSha256, originalFileName: `${evidence.documentNumber}.svg` },
      });
      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.substitute_receipt.approve',
        targetType: 'expense_substitute_receipt', targetId: evidenceId, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'CRITICAL',
        metadataJson: {
          expenseId, version: evidence.version, checksumSha256, selfApproved, source: ctx.authProvider === 'line' ? 'LINE' : 'WEB',
          signatureSource: approverSignature?.source ?? 'wet_signed_scan',
          signatureMode: evidence.signatureMode,
        },
      });
      return toSubstituteEvidenceSummary(updated);
    } catch (error) {
      await this.objectVersionCleanup.enqueue({
        companyId: ctx.companyId,
        bucket: stored.bucket,
        objectPath: stored.objectKey,
        expectedVersion: stored.objectVersionId,
        source: 'SUBSTITUTE_RECEIPT_ISSUED',
      });
      throw new ConflictException((error as Error).message);
    }
  }
}

@Injectable()
export class ListSubstituteReceiptHistoryUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async resolveExpenseId(ctx: RequestContext, evidenceId: string): Promise<string> {
    assertWeb(ctx);
    substituteReceiptPreparationScope(ctx);
    const expenseId = await this.repo.findExpenseIdForSubstituteReceipt(ctx.companyId, evidenceId);
    if (!expenseId) throw new NotFoundException('Substitute evidence not found.');
    await this.execute(ctx, expenseId);
    return expenseId;
  }

  async execute(ctx: RequestContext, expenseId: string): Promise<SubstituteReceiptEvidenceSummary[]> {
    assertWeb(ctx);
    const expense = await this.repo.findById(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertBranch(ctx, expense.branchId);
    // Loaded before the decision because the payer is part of what authorizes the read. Nothing is
    // returned unless one of the three clauses below passes, and the allowed path costs the same
    // two queries it always did.
    const history = await this.repo.listSubstituteEvidenceHistory(ctx.companyId, expenseId);
    const canReadAll = ctx.permissions.includes('expense.review') || ctx.permissions.includes('expense.confirm');
    // `read_own` means "created it OR paid it" here, the same as in GetExpenseUseCase and in the
    // hub list. Reading it as "created it" alone locks out the one person the certificate is
    // waiting on: the payer is deliberately not the reviewer, and is usually not the creator
    // either — that separation is the control this feature exists to produce. Any version counts,
    // matching expenseRelatedToUserWhere, so the read_own and read_related paths agree.
    const preparationScope = substituteReceiptPreparationScope(ctx);
    const canReadOwn = expense.createdByUserId === preparationScope.createdByUserId
      || (ctx.permissions.includes('expense.read_own') && history.some((item) => item.payerUserId === ctx.userId));
    const canReadRelated = ctx.permissions.includes('expense.read_related')
      && await this.repo.isUserRelatedToExpense(ctx.companyId, expenseId, ctx.userId, ctx.scopes ?? {});
    if (!canReadAll && !canReadOwn && !canReadRelated) throw new ForbiddenException('Cannot read this substitute-receipt history.');
    return history;
  }
}

@Injectable()
export class SupersedeSubstituteReceiptUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, expenseId: string, evidenceId: string, input: SupersedeSubstituteReceiptInput) {
    assertWeb(ctx);
    if (!ctx.permissions.includes('expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    const reason = requiredText(input.reason, 'reason', 500);
    const expectedEvidenceUpdatedAt = parseExpectedDate(input.expectedEvidenceUpdatedAt, 'expectedEvidenceUpdatedAt');
    const expense = await this.repo.findById(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertBranch(ctx, expense.branchId);
    try {
      const evidence = await this.repo.supersedeSubstituteEvidence({
        companyId: ctx.companyId, expenseId, evidenceId, actorUserId: ctx.userId, reason, expectedEvidenceUpdatedAt,
      });
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.substitute_receipt.supersede',
        targetType: 'expense_substitute_receipt', targetId: evidenceId, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { expenseId, version: evidence.version, reason },
      });
      return evidence;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ConflictException((error as Error).message);
    }
  }
}

@Injectable()
export class ListSubstituteReceiptPayersUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, expenseId: string): Promise<Array<{ userId: string; displayName: string; isOwner: boolean }>> {
    assertWeb(ctx);
    substituteReceiptPreparationScope(ctx);
    const expense = await this.repo.findById(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertSubstitutePreparationAccess(ctx, expense);
    return this.repo.listActiveMemberIdentities(ctx.companyId, expense.branchId);
  }
}

type PreparationUploadInput = { originalFileName: string; mimeType: string; byteSize: number; purpose: 'expense.receipt.supporting' | 'expense.payment.evidence' };

@Injectable()
export class SubstituteReceiptEvidenceUploadUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly createUpload: CreateUploadIntentUseCase, private readonly completeUpload: CompleteAttachmentUploadUseCase) {}

  private async load(ctx: RequestContext, expenseId: string, purpose: string) {
    assertWeb(ctx);
    substituteReceiptPreparationScope(ctx);
    if (!['expense.receipt.supporting', 'expense.payment.evidence'].includes(purpose)) throw new BadRequestException('Invalid certificate evidence purpose.');
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException('Expense not found.');
    assertSubstitutePreparationAccess(ctx, expense);
    if (!['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status) || (expense.substituteReceiptEvidence && expense.substituteReceiptEvidence.status !== 'SUPERSEDED')) throw new ConflictException('Expense already has a certificate or cannot be prepared.');
    return expense;
  }

  async init(ctx: RequestContext, expenseId: string, input: PreparationUploadInput) {
    const expense = await this.load(ctx, expenseId, input.purpose);
    if (ctx.permissions.includes('expense.review') && !ctx.permissions.includes('attachment.create')) throw new ForbiddenException('Missing permission: attachment.create');
    return this.createUpload.execute(withAttachmentCreate(ctx), { originalFileName: input.originalFileName, mimeType: input.mimeType, byteSize: input.byteSize,
      visibility: 'INTERNAL', ...(expense.branchId ? { branchId: expense.branchId } : {}),
      metadataJson: { generatedFor: 'substitute_receipt_preparation', expenseId, purpose: input.purpose } });
  }

  async complete(ctx: RequestContext, expenseId: string, attachmentId: string, input: { byteSize?: number; checksumSha256?: string; purpose: PreparationUploadInput['purpose'] }) {
    const expense = await this.load(ctx, expenseId, input.purpose);
    if (ctx.permissions.includes('expense.review') && !ctx.permissions.includes('attachment.create')) throw new ForbiddenException('Missing permission: attachment.create');
    const attachment = await this.repo.findSubstitutePreparationUpload(ctx.companyId, expenseId, attachmentId, ctx.userId, input.purpose);
    if (!attachment || !['PENDING_UPLOAD', 'ACTIVE'].includes(attachment.status)) throw new BadRequestException('Certificate evidence upload not found.');
    if (attachment.status === 'PENDING_UPLOAD') await this.completeUpload.execute(withAttachmentCreate(ctx), { attachmentId, byteSize: input.byteSize, checksumSha256: input.checksumSha256 });
    await this.repo.updateExpense({ id: expenseId, companyId: ctx.companyId, updatedByUserId: ctx.userId, expectedUpdatedAt: expense.updatedAt }, async (tx) => {
      if (await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { companyId: ctx.companyId, expenseId, status: { not: 'SUPERSEDED' } }, select: { id: true } })) throw new ConflictException('Expense already has a certificate.');
      await this.repo.linkAttachment(expenseId, attachmentId, input.purpose, ctx.companyId, ctx.userId, tx);
    });
    return { attachmentId };
  }
}

@Injectable()
export class InitSubstituteSignatureUploadUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly createUpload: CreateUploadIntentUseCase) {}

  async execute(
    ctx: RequestContext,
    expenseId: string,
    evidenceId: string,
    input: { originalFileName: string; mimeType: string; byteSize: number },
  ) {
    const { evidence, role } = await assertSignatureActor(this.repo, ctx, expenseId, evidenceId);
    if (!['image/png', 'image/jpeg'].includes(input.mimeType) || !Number.isInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > 2_000_000) {
      throw new BadRequestException('Per-certificate signature must be a PNG/JPEG file up to 2 MB.');
    }
    return this.createUpload.execute(withAttachmentCreate(ctx), {
      originalFileName: requiredText(input.originalFileName, 'originalFileName', 255),
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      visibility: 'INTERNAL',
      ...(evidence.branchId ? { branchId: evidence.branchId } : {}),
      metadataJson: { generatedFor: 'substitute_receipt_signature', evidenceId: evidence.id, role },
    });
  }
}

@Injectable()
export class CompleteSubstituteSignatureUploadUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly completeUpload: CompleteAttachmentUploadUseCase) {}

  async execute(
    ctx: RequestContext,
    expenseId: string,
    evidenceId: string,
    attachmentId: string,
    input: { checksumSha256?: string; byteSize?: number },
  ) {
    const { role } = await assertSignatureActor(this.repo, ctx, expenseId, evidenceId);
    const attachment = await this.repo.findPersonalSignatureUploadAttachment(ctx.companyId, attachmentId, ctx.userId, evidenceId, role);
    if (!attachment || attachment.status !== 'PENDING_UPLOAD') throw new BadRequestException('Pending signature upload not found for this signer.');
    return this.completeUpload.execute(withAttachmentCreate(ctx), { attachmentId, ...input });
  }
}

function uniqueIds(values: string[] | undefined): string[] {
  if (!values) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new BadRequestException('Evidence attachment ids must be non-empty strings.');
  }
  return [...new Set(values.map((value) => value.trim()))];
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertImageBytes(bytes: Buffer, mimeType: string): void {
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if ((mimeType === 'image/png' && !png) || (mimeType === 'image/jpeg' && !jpeg)) {
    throw new BadRequestException('Signature bytes do not match the declared PNG/JPEG MIME type.');
  }
}

/**
 * R9: the per-evidence upload still wins wherever one exists, and the signer's personal signature
 * library is the fallback, so a second substitute receipt needs no upload. Both routes record the
 * resolved attachment id and its checksum on the evidence row, so the artifact chain is unchanged.
 */
async function loadOwnedSignature(
  repo: PrismaExpenseRepository,
  storage: AttachmentStoragePort,
  companyId: string,
  attachmentId: string | undefined,
  userId: string,
  evidenceId: string,
  role: 'payer' | 'approver',
): Promise<{ id: string; dataUrl: string; checksumSha256: string; source: 'evidence_upload' | 'signature_library' }> {
  // Only an omitted id means "use my saved signature": a supplied-but-blank id is a caller bug and
  // must fail exactly as it did before the library fallback existed.
  if (attachmentId !== undefined && !attachmentId.trim()) {
    throw new BadRequestException(`Signature must be an ACTIVE PNG/JPEG uploaded by the ${role}.`);
  }
  const uploaded = attachmentId
    ? await repo.findPersonalSignatureAttachment(companyId, attachmentId, userId, evidenceId, role)
    : null;
  // With an attachmentId the fallback stays pinned to that exact attachment: an already-certified
  // signature must still resolve after the signer adds a newer one.
  const attachment = uploaded ?? await repo.findReusableSignatureAsset(companyId, userId, attachmentId);
  if (!attachment) throw new BadRequestException(`Signature must be an ACTIVE PNG/JPEG uploaded by the ${role}.`);
  // One number, shared with the creation-path downscale that exists to stay under it.
  if (attachment.byteSize > SIGNATURE_MAX_BYTES) throw new BadRequestException('Signature image must be at most 2 MB.');
  const object = await storage.getObject({
    bucket: attachment.bucket,
    objectKey: attachment.objectKey,
    ...(attachment.objectVersionId ? { objectVersionId: attachment.objectVersionId } : {}),
  });
  assertImageBytes(object.bytes, attachment.mimeType);
  const checksum = sha256(object.bytes);
  if (attachment.checksumSha256 && attachment.checksumSha256 !== checksum) throw new ConflictException('Signature checksum does not match storage.');
  return {
    id: attachment.id,
    dataUrl: `data:${attachment.mimeType};base64,${object.bytes.toString('base64')}`,
    checksumSha256: checksum,
    source: uploaded ? 'evidence_upload' : 'signature_library',
  };
}

async function assertSignatureActor(
  repo: PrismaExpenseRepository,
  ctx: RequestContext,
  expenseId: string,
  evidenceId: string,
): Promise<{ evidence: SubstituteReceiptEvidenceRecord; role: 'payer' | 'approver' }> {
  assertWeb(ctx);
  const evidence = await repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
  if (!evidence) throw new NotFoundException('Substitute evidence not found.');
  const expense = await repo.findById(ctx.companyId, expenseId);
  if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
  assertBranch(ctx, expense.branchId);
  const isPayer = evidence.status === 'PREPARED' && evidence.payerUserId === ctx.userId;
  const isApprover = evidence.status === 'PAYER_CERTIFIED'
    && ctx.permissions.includes('expense.confirm');
  if (!isPayer && !isApprover) throw new ForbiddenException('Only the current payer or authorized approver may upload this per-certificate signature.');
  if (isApprover) {
    const policy = await repo.getSubstituteReceiptPolicy(ctx.companyId);
    const approvalMode = policy?.approvalMode ?? 'OWNER_SELF';
    const selfApproved = evidence.payerUserId === ctx.userId;
    if (selfApproved && !selfApprovalPermitted(approvalMode, ctx.roles)) {
      throw new ForbiddenException('Self-approval of a substitute receipt requires the owner-self policy and an owner, admin, or manager role.');
    }
    const eligibleApproverIds = new Set((await repo.listEligibleSubstituteReceiptApprovers(ctx.companyId, expense.branchId))
      .map((candidate) => candidate.userId));
    const eligibleApprover = isEligibleSubstituteReceiptApprover(
      ctx.userId,
      approvalMode,
      policy?.approverUserIds,
      eligibleApproverIds,
    );
    if (approvalMode === 'DESIGNATED_APPROVERS'
      && !eligibleApprover) {
      throw new ForbiddenException('You are not a currently configured substitute-receipt approver for this branch.');
    }
    if (approvalMode === 'OWNER_SELF' && !eligibleApprover) {
      throw new ForbiddenException('You do not have expense.confirm for this branch.');
    }
  }
  return { evidence, role: isPayer ? 'payer' : 'approver' };
}

function withAttachmentCreate(ctx: RequestContext): RequestContext {
  return ctx.permissions.includes('attachment.create') ? ctx : { ...ctx, permissions: [...ctx.permissions, 'attachment.create'] };
}

async function freezePaperForm(repo: PrismaExpenseRepository, companyId: string, expense: ExpenseRecordWithRelations, evidence: SubstituteReceiptEvidenceRecord) {
  assertPreparedExpenseUnchanged(expense, evidence);
  if (evidence.paperFormSnapshotJson) return evidence;
  const snapshot = await buildSnapshot(repo, companyId, expense, evidence, '____________________________', PREVIEW_CERTIFIED_AT);
  snapshot.payer = { userId: null, name: '________________________________', position: '____________________________', certifiedAt: PREVIEW_CERTIFIED_AT, roleLabel: 'ผู้รับรองการจ่าย' };
  delete snapshot.paperReview;
  snapshot.certificationText = buildSubstituteCertificationText(snapshot.payer.name, snapshot.payer.position, true);
  return repo.freezeSubstitutePaperForm(companyId, expense.id, evidence.id, snapshot, evidence.updatedAt, expense.updatedAt);
}

function paperSigner(value: SubmitSubstituteReceiptPaperInput['payer'] | undefined, field: string): SubstituteReceiptPaperSigner {
  const name = requiredText(value?.name, `${field}.name`, 200);
  const position = optionalText(value?.position, `${field}.position`, 120) ?? '';
  const signedOn = requiredText(value?.signedOn, `${field}.signedOn`, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signedOn) || !Number.isFinite(Date.parse(signedOn))
    || new Date(signedOn).toISOString().slice(0, 10) !== signedOn
    || signedOn > new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    || signedOn < '1900-01-01') throw new BadRequestException('วันที่เซ็นไม่ถูกต้อง เลือกวันที่จริงที่ไม่อยู่ในอนาคต');
  return { name, position, signedOn };
}

/** Paper identities are transcribed facts, never account identities or delegated signatures. */
@Injectable()
export class PaperSubstituteReceiptUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly audit: AuditService,
    private readonly createUpload: CreateUploadIntentUseCase,
    private readonly completeUpload: CompleteAttachmentUploadUseCase,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly objectVersionCleanup: ObjectVersionCleanupService,
  ) {}

  private async load(ctx: RequestContext, expenseId: string, evidenceId: string, permission: 'expense.review' | 'expense.confirm' | 'read') {
    assertWeb(ctx);
    if (permission === 'read' ? !ctx.permissions.some((item) => ['expense.review', 'expense.confirm'].includes(item)) : !ctx.permissions.includes(permission)) throw new ForbiddenException('คุณไม่มีสิทธิ์ทำรายการกับฉบับกระดาษ ให้ผู้ที่มีสิทธิ์ตรวจหรือยืนยันเอกสารทำให้');
    const evidence = await this.repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!evidence || !expense) throw new NotFoundException('ไม่พบเอกสาร เปิดหน้านี้ใหม่แล้วเลือกใบรับรองอีกครั้ง');
    assertBranch(ctx, expense.branchId);
    if (evidence.signatureMode !== 'PAPER' || evidence.payerUserId !== null || evidence.status !== 'PREPARED') throw new ConflictException('เอกสารไม่อยู่ในขั้นตอนรับฉบับกระดาษ เปิดหน้านี้ใหม่');
    assertPreparedExpenseUnchanged(expense, evidence);
    const refs = await this.repo.findSubstituteEvidenceAttachments(ctx.companyId, expenseId, [...new Set([...evidence.paymentEvidenceAttachmentIds, ...evidence.supportingAttachmentIds])]);
    if (refs.length !== new Set([...evidence.paymentEvidenceAttachmentIds, ...evidence.supportingAttachmentIds]).size) throw new ConflictException('หลักฐานประกอบเปลี่ยนไป จัดทำเวอร์ชันใหม่');
    if (evidence.paperFormSnapshotJson) {
      const form = evidence.paperFormSnapshotJson as unknown as SubstituteReceiptSnapshot;
      if (form.evidence.some((item) => !refs.some((ref) => ref.id === item.id && ref.checksumSha256 === item.checksumSha256))) throw new ConflictException('หลักฐานไม่ตรงกับแบบฟอร์มที่พิมพ์ จัดทำใบรับรองใหม่ให้ตรงกับหลักฐาน');
    }
    return { evidence, expense };
  }

  async initUpload(ctx: RequestContext, expenseId: string, evidenceId: string, input: { originalFileName: string; mimeType: string; byteSize: number }) {
    const { evidence } = await this.load(ctx, expenseId, evidenceId, 'expense.review');
    if (!evidence.paperFormSnapshotJson || evidence.paperSubmissionJson) throw new ConflictException('ดาวน์โหลดแบบฟอร์มก่อนอัปโหลด หรือจัดทำเวอร์ชันใหม่หากยื่นแล้ว');
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(input.mimeType) || !Number.isInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > 10_000_000) throw new BadRequestException('ไฟล์นี้ใช้ไม่ได้ เลือก PDF, PNG หรือ JPEG ขนาดไม่เกิน 10 เมกะไบต์');
    return this.createUpload.execute(withAttachmentCreate(ctx), { ...input, originalFileName: requiredText(input.originalFileName, 'originalFileName', 255), visibility: 'INTERNAL',
      ...(evidence.branchId ? { branchId: evidence.branchId } : {}), metadataJson: { generatedFor: 'substitute_receipt_paper', evidenceId, formChecksumSha256: canonicalSnapshotHash(evidence.paperFormSnapshotJson as unknown as SubstituteReceiptSnapshot) } });
  }

  async submit(ctx: RequestContext, expenseId: string, evidenceId: string, input: SubmitSubstituteReceiptPaperInput) {
    const { evidence } = await this.load(ctx, expenseId, evidenceId, 'expense.review');
    if (input.formMatchesAcknowledged !== true || typeof input.samePerson !== 'boolean') throw new BadRequestException('ยังยืนยันฉบับที่เซ็นไม่ครบ ติ๊กยืนยันฉบับนี้และเลือกว่าคนเดียวกันเซ็นทั้งสองช่องหรือคนละคน');
    const payer = paperSigner(input.payer, 'payer');
    const approver = paperSigner(input.approver, 'approver');
    if (payer.name.replace(/\s/g, '') === approver.name.replace(/\s/g, '') && !input.samePerson) throw new BadRequestException('ชื่อผู้เซ็นตรงกัน เลือก “คนเดียวกันเซ็นทั้งสองช่อง”');
    if (evidence.correctionOfEvidenceId) {
      const original = await this.repo.findSubstituteEvidence(ctx.companyId, expenseId, evidence.correctionOfEvidenceId);
      if (!original?.paperSubmissionJson || original.paperSubmissionJson.payer.name !== payer.name || original.paperSubmissionJson.approver.name !== approver.name) throw new ConflictException('การแก้เอกสารต้องใช้ผู้เซ็นเดิม ระบุชื่อผู้เซ็นให้ตรงกับใบเดิม');
    }
    // An exact retry after successful submission returns the existing immutable submission.
    if (evidence.paperSubmissionJson) {
      const prior = evidence.paperSubmissionJson;
      if (evidence.wetSignedScanAttachmentId === input.attachmentId && evidence.wetSignedScanChecksumSha256 === input.checksumSha256
        && prior.uploadedByUserId === ctx.userId && JSON.stringify(prior.payer) === JSON.stringify(payer) && JSON.stringify(prior.approver) === JSON.stringify(approver) && prior.samePerson === input.samePerson) return toSubstituteEvidenceSummary(evidence);
      throw new ConflictException('ยื่นฉบับนี้แล้ว หากต้องแก้ไขให้ยกเลิกและจัดทำเวอร์ชันใหม่');
    }
    if (evidence.updatedAt.getTime() !== parseExpectedDate(input.expectedEvidenceUpdatedAt, 'expectedEvidenceUpdatedAt').getTime()) throw new ConflictException('ข้อมูลเปลี่ยนแล้ว เปิดหน้านี้ใหม่');
    let attachment = await this.repo.findSubstitutePaperUpload(ctx.companyId, evidenceId, input.attachmentId, ctx.userId);
    if (!attachment || attachment.branchId !== evidence.branchId) throw new BadRequestException('ไม่พบไฟล์ที่อัปโหลดสำหรับเอกสารนี้ เลือกไฟล์ที่อัปโหลดให้ใบนี้หรืออัปโหลดอีกครั้ง');
    if (!evidence.paperFormSnapshotJson || (attachment.metadataJson as Record<string, unknown> | null)?.formChecksumSha256 !== canonicalSnapshotHash(evidence.paperFormSnapshotJson as unknown as SubstituteReceiptSnapshot)) throw new ConflictException('ข้อมูลค่าใช้จ่ายเปลี่ยนแล้ว ดาวน์โหลดแบบฟอร์มล่าสุดไปเซ็นและอัปโหลดใหม่');
    if (attachment.status === 'PENDING_UPLOAD') {
      await this.completeUpload.execute(withAttachmentCreate(ctx), { attachmentId: attachment.id, checksumSha256: input.checksumSha256, byteSize: input.byteSize });
      attachment = await this.repo.findSubstitutePaperUpload(ctx.companyId, evidenceId, input.attachmentId, ctx.userId);
    }
    if (!attachment || attachment.status !== 'ACTIVE' || attachment.checksumSha256 !== input.checksumSha256 || Number(attachment.byteSize) !== input.byteSize) throw new BadRequestException('ไฟล์หรือข้อมูลตรวจสอบไฟล์ไม่ตรงกัน เปิดหน้านี้ใหม่แล้วอัปโหลดไฟล์อีกครั้ง');
    const scan = await this.storage.getObject({ bucket: attachment.bucket, objectKey: attachment.objectKey, ...(attachment.objectVersionId ? { objectVersionId: attachment.objectVersionId } : {}) });
    if (sha256(scan.bytes) !== input.checksumSha256) throw new ConflictException('ไฟล์ในที่เก็บเปลี่ยนไป แจ้งทีมงานมั่งมีให้ตรวจไฟล์ก่อนส่งฉบับที่เซ็น');
    // Parsing the real bytes also enforces page/pixel limits before this becomes linked evidence.
    const form = evidence.paperFormSnapshotJson as unknown as SubstituteReceiptSnapshot;
    if (!form) throw new ConflictException('ยังไม่ได้เตรียมแบบฟอร์ม ดาวน์โหลดแบบฟอร์มก่อนอัปโหลดฉบับที่เซ็น');
    try { await renderSubstituteReceiptPaperArtifactPdf({ bytes: scan.bytes, mimeType: attachment.mimeType }, renderSubstituteReceiptAttestationSvg(form, { snapshotChecksumSha256: canonicalSnapshotHash(form), wetSignedScanChecksumSha256: input.checksumSha256 }), evidence.documentNumber); }
    catch { throw new BadRequestException(`เปิดอ่านไฟล์ไม่ได้หรือเกินจำนวนหน้าที่รองรับ เลือกรูปหรือ PDF ที่เปิดอ่านได้ โดย PDF ไม่เกิน ${SUBSTITUTE_RECEIPT_PDF_LIMITS.maxScanPages} หน้า`); }
    const uploadedByName = await this.repo.findMemberDisplayName(ctx.companyId, ctx.userId) ?? '-';
    const updated = await this.repo.submitSubstitutePaper({ companyId: ctx.companyId, expenseId, evidenceId, expectedUpdatedAt: evidence.updatedAt,
      attachmentId: attachment.id, checksumSha256: input.checksumSha256,
      submission: { payer, approver, samePerson: input.samePerson, uploadedByUserId: ctx.userId, uploadedByName, uploadedAt: new Date().toISOString() } });
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.substitute_receipt.paper.submit', targetType: 'expense_substitute_receipt', targetId: evidenceId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { expenseId, attachmentId: attachment.id, checksumSha256: input.checksumSha256 } });
    return toSubstituteEvidenceSummary(updated);
  }

  private async review(ctx: RequestContext, expenseId: string, evidenceId: string, permission: 'read' | 'expense.confirm') {
    const { evidence, expense } = await this.load(ctx, expenseId, evidenceId, permission);
    const submission = evidence.paperSubmissionJson;
    if (!submission || !evidence.paperFormSnapshotJson || !evidence.wetSignedScanAttachmentId) throw new ConflictException('ยังไม่ได้รับฉบับที่เซ็นบนกระดาษ ให้ผู้จัดทำส่งฉบับที่เซ็นแล้วก่อนตรวจรับ');
    const reviewer = await this.repo.findActiveMemberIdentity(ctx.companyId, ctx.userId, expense.branchId);
    if (!reviewer) throw new ForbiddenException('ผู้ตรวจต้องเป็นสมาชิกที่ใช้งานอยู่ ให้ผู้ที่มีสิทธิ์ตรวจสาขาและสถานะสมาชิกก่อนตรวจรับ');
    const scan = await this.repo.findSubstituteArtifactAttachment(ctx.companyId, expenseId, evidence.wetSignedScanAttachmentId, ['image/png', 'image/jpeg', 'application/pdf']);
    if (!scan) throw new ConflictException('ไม่พบฉบับที่เซ็น เปิดหน้านี้ใหม่แล้วตรวจไฟล์ที่แนบ');
    const object = await this.storage.getObject({ bucket: scan.bucket, objectKey: scan.objectKey, ...(scan.objectVersionId ? { objectVersionId: scan.objectVersionId } : {}) });
    if (sha256(object.bytes) !== evidence.wetSignedScanChecksumSha256) throw new ConflictException('ไฟล์ฉบับที่เซ็นไม่ตรงกับข้อมูลที่ยื่น แจ้งทีมงานมั่งมีให้ตรวจไฟล์ก่อนตรวจรับ');
    const snapshot: SubstituteReceiptSnapshot = { ...evidence.paperFormSnapshotJson as unknown as SubstituteReceiptSnapshot,
      payer: { userId: null, name: submission.payer.name, position: submission.payer.position, certifiedAt: submission.payer.signedOn, roleLabel: 'ผู้รับรองการจ่าย' },
      certificationText: buildSubstituteCertificationText(submission.payer.name, submission.payer.position, true),
      paperReview: { uploadedAt: submission.uploadedAt, uploadedByUserId: submission.uploadedByUserId,
        uploadedByName: submission.uploadedByName ?? await this.repo.findMemberDisplayName(ctx.companyId, submission.uploadedByUserId) ?? '-', reviewerUserId: ctx.userId, reviewerName: reviewer.displayName, samePerson: submission.samePerson } };
    const snapshotChecksumSha256 = canonicalSnapshotHash(snapshot);
    const approver = { userId: null, name: submission.approver.name, position: submission.approver.position, approvedAt: submission.approver.signedOn };
    const svg = renderSubstituteReceiptAttestationSvg(snapshot, { snapshotChecksumSha256, wetSignedScanChecksumSha256: evidence.wetSignedScanChecksumSha256!, approver });
    return { evidence, expense, snapshot, snapshotChecksumSha256, svg, scan: { bytes: object.bytes, mimeType: scan.mimeType },
      previewChecksumSha256: sha256(Buffer.concat([svg, Buffer.from(evidence.wetSignedScanChecksumSha256!)])) };
  }

  async preview(ctx: RequestContext, expenseId: string, evidenceId: string) {
    const result = await this.review(ctx, expenseId, evidenceId, 'read');
    const pdf = await renderSubstituteReceiptPaperArtifactPdf(result.scan, result.svg, result.evidence.documentNumber, { omitPageFooter: true });
    return { pdfDataUrl: `data:application/pdf;base64,${pdf.toString('base64')}`, pageImageDataUrls: await renderSubstitutePaperPreviewPages(pdf), previewChecksumSha256: result.previewChecksumSha256 };
  }

  async accept(ctx: RequestContext, expenseId: string, evidenceId: string, input: AcceptSubstituteReceiptPaperInput) {
    if (input.factsAndSignaturesAcknowledged !== true || input.approverAuthorityAcknowledged !== true || input.originalRetainedAcknowledged !== true) throw new BadRequestException('ตรวจฉบับเซ็นและยืนยันครบทุกข้อก่อนรับเอกสาร');
    const result = await this.review(ctx, expenseId, evidenceId, 'expense.confirm');
    const { evidence, expense } = result;
    const company = await this.repo.getSubstituteCompanyContext(ctx.companyId, expense.branchId);
    if (company.taxId !== result.snapshot.company.taxId) throw new ConflictException('เลขผู้เสียภาษีร้านเปลี่ยนไป จัดทำเวอร์ชันใหม่');
    if (result.previewChecksumSha256 !== input.previewChecksumSha256 || evidence.updatedAt.getTime() !== parseExpectedDate(input.expectedEvidenceUpdatedAt, 'expectedEvidenceUpdatedAt').getTime()) throw new ConflictException('เอกสารเปลี่ยนไป เปิดตรวจฉบับเต็มอีกครั้ง');
    const policy = await this.repo.getSubstituteReceiptPolicy(ctx.companyId);
    const mode = policy?.approvalMode ?? 'OWNER_SELF';
    const eligible = await this.repo.listEligibleSubstituteReceiptApprovers(ctx.companyId, expense.branchId);
    if (!isEligibleSubstituteReceiptApprover(ctx.userId, mode, policy?.approverUserIds, new Set(eligible.map((item) => item.userId)))) throw new ForbiddenException('คุณไม่มีสิทธิ์ตรวจรับตามนโยบายผู้อนุมัติของร้าน ให้ผู้อนุมัติที่มีสิทธิ์ตรวจรับใบนี้');
    if (evidence.paperSubmissionJson!.samePerson && !selfApprovalPermitted(mode, ctx.roles)) throw new ForbiddenException('นโยบายร้านไม่อนุญาตให้คนเดียวเซ็นทั้งสองฐานะ ให้ผู้ที่มีสิทธิ์ตรวจนโยบายก่อนตรวจรับ');
    if (evidence.paymentEvidenceAttachmentIds.length === 0 && substituteReceiptRequiresPaymentEvidence(expense.aiVerificationSummaryJson, evidence.paymentMethod, policy?.cashEvidencePolicy)) throw new ConflictException('ต้องมีหลักฐานการจ่ายตามนโยบายปัจจุบัน');
    const stored = await this.storage.putObject({ objectKey: `${ctx.companyId}/substitute-receipts/${evidenceId}/issued-${randomUUID()}.svg`, mimeType: 'image/svg+xml', bytes: result.svg });
    let updated: SubstituteReceiptEvidenceRecord;
    try {
      updated = await this.repo.issueSubstituteEvidence({ companyId: ctx.companyId, expenseId, evidenceId, approverUserId: ctx.userId,
        approverName: evidence.paperSubmissionJson!.approver.name, approverPosition: evidence.paperSubmissionJson!.approver.position,
        allowSelfApproval: selfApprovalPermitted(mode, ctx.roles), approvedAt: new Date(), expectedExpenseUpdatedAt: evidence.expenseUpdatedAtAtPreparation,
        referencedAttachmentIds: [...new Set([evidence.wetSignedScanAttachmentId!, ...evidence.paymentEvidenceAttachmentIds, ...evidence.supportingAttachmentIds])],
        expectedVersion: evidence.version, expectedEvidenceUpdatedAt: evidence.updatedAt,
        paperAcceptance: { snapshot: result.snapshot, snapshotChecksumSha256: result.snapshotChecksumSha256, scanChecksumSha256: evidence.wetSignedScanChecksumSha256! },
        artifact: { ...stored, checksumSha256: sha256(result.svg), originalFileName: `${evidence.documentNumber}-paper-review.svg` } });
    } catch (error) {
      await this.objectVersionCleanup.enqueue({ companyId: ctx.companyId, bucket: stored.bucket, objectPath: stored.objectKey, expectedVersion: stored.objectVersionId, source: 'SUBSTITUTE_RECEIPT_ISSUED' });
      if (error instanceof HttpException) throw error;
      throw new ConflictException((error as Error).message);
    }
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.substitute_receipt.paper.accept', targetType: 'expense_substitute_receipt', targetId: evidenceId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { expenseId, snapshotChecksumSha256: result.snapshotChecksumSha256, scanChecksumSha256: evidence.wetSignedScanChecksumSha256, samePerson: evidence.paperSubmissionJson!.samePerson, factsAndSignaturesAcknowledged: true, approverAuthorityAcknowledged: true, originalRetainedAcknowledged: true } });
    return toSubstituteEvidenceSummary(updated);
  }
}
