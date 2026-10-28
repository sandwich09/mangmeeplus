import { hasExpenseCategory } from '@watchdog-bms/contracts';
import { withholdingPayerPrefill } from '../../tax/application/services/withholding-establishments';
import { REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES } from '@watchdog-bms/contracts';
import { REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES } from '../../reimbursements/domain/reimbursement.constants';
import { inputVatRecordedBeforeReview, inputVatConditions, resetInputVatDecisionForType, appendInputVatDecision, inputVatDecisionFacts, inputVatFixedReason, validateInputVatDecision, assertInputVatDecisionPeriodOpen } from './expense-input-vat-decision';
import type { DecideExpenseInputVatInput, ExpenseInputVatRightView, RequestContext } from '@watchdog-bms/contracts';
import { applyExpenseInputVatPreset, assertInputVatRestoreAllowed, registrationOnDocumentDate } from './expense-input-vat';
import { cancelDisbursementVouchersForPayments } from '../domain/logic/disbursement-voucher.logic';
import { normalizeTaxId } from '../../data-model-core/domain/logic/company-legal-identity.logic';
import { normalizeVendorName } from '../../accounting-documents/domain/logic/vendor-counterparty-match.logic';
import { PrismaReimbursementRepository } from '../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { canTransition } from '../../reimbursements/domain/logic/reimbursement.logic';
import type { DisbursementReadScope } from './prisma-disbursement-voucher.repository';
import { normalizeExpensePaymentAmount, expenseVoidCertificatePermissionMessage, EXPENSE_VOID_CERTIFICATE_WORDS, EXPENSE_CORRECTION_WORDS, expenseCorrectionBlockerMessage, expenseReopenBlockerMessages } from '@watchdog-bms/contracts';
import { loadExpenseReimbursementProgress } from './expense-reimbursement-progress';
import { loadExpenseEvidenceSources } from './expense-evidence-sources';
import { serializableTransaction } from '../../../common/database/serializable-transaction';
import { canNumberReviewedDraft, expenseDraftNumberKey, expenseNumberInTransaction } from './expense-number';
import { assertSubstituteEditAllowed, reviseSubstituteEvidence, syncSubstituteAfterExpenseEdit, substitutePurposeSourceNote, substitutePayeeExpenseFields, EXPENSE_EDIT_RESIGN_REASON } from './substitute-expense-edit';
import { WHT_INCOME_CATEGORY_TWINS } from '../domain/logic/wht-income-category-twins';
import { assertProjectionSource } from '../../reimbursements/infrastructure/reimbursement-source';
import { PrismaAuditRepository } from '../../audit/infrastructure/prisma-audit.repository';
import { lockExpenseFunding, assertFundingMutation } from './substitute-funding.guard';
import { findClaimExpenseVoidBlocker, readDisbursementReservations, assertExpenseDisbursementReservation, expenseWhtHandoffWhere, hasExpenseTaxWorkspaceCertificate, readExpensePeriodLocks, retireExpenseTaxEvents, lockExpenseCorrection, readExpenseCorrectionCapabilities, findJournalToReverse, findLiveClaimOf, journalPeriodRefusal, lockedTaxFormTypesOf, expensePaymentClaimWhere, recordExpensePaymentBlocker, type ExpenseClaimOwner } from './expense-void-blocker';
import { assertFullSubstitutePayment, assertSubstitutePaymentDetails, assertSubstituteFactsComplete } from '../domain/logic/substitute-funding.logic';
import { assertExpenseSourceDraftComplete } from '../domain/logic/expense-source-draft.logic';
import { confirmBuyerMismatch, readBuyerAsPrinted } from '../domain/logic/buyer-as-printed.logic';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { expenseWhtHeaderRate, expenseWhtIncomeBase } from '../domain/logic/expense-wht-input.logic';
import { appendWhtCertificateHistory } from '../../tax/application/services/wht-certificate-history';
import { expenseEvidenceConfirmationError, expenseEvidenceAssessment, hasCurrentExpenseEvidenceReview } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { branchScopeWhere, isBranchInScope, type BranchScopes } from '../../data-model-core/domain/logic/branch.logic';
import { canonicalFingerprint } from '../../../common/security/canonical-fingerprint';
import { POSITIVE_ACCOUNTING_MONEY_PATTERN } from '../../accounting-documents/domain/logic/accounting-money-validation.logic';
import { findAttachmentLinkConflict } from '../../data-model-core/domain/logic/attachment.logic';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { buildReversalLines } from '../../ledger/domain/logic/journal-balance.logic';
import { expenseTotalsIdentity } from '../domain/logic/expense-totals.logic';
import { expenseCaptureWebPath } from '../domain/logic/expense-capture.logic';
import { captureGroupRef } from '../domain/logic/expense-export.logic';
import type {
  ExpenseRecord, ExpenseRecordWithRelations, ExpensePaymentRecord, CreateExpenseRecordInput,
  UpdateExpenseRecordInput, ExpenseLineInput, PaginatedExpenses, SignatureAssetRecord, SubstituteReceiptEvidenceRecord,
  SubstituteReceiptPolicyRecord,
} from '../domain/models/expense.model';
import type {
  ListExpensesFilter, ExpenseCategorySummary, DuplicateCandidateSummary,
  CreateExpenseCategoryInput, UpdateExpenseCategoryInput, SharedEvidenceFilter, SignatureSubmitChannel,
  SubstituteReceiptApprovalMode, SubstituteReceiptListFilter,
  ExpenseVatSourceOverrideInput,
  ExpenseLineChargeKind,
} from '@watchdog-bms/contracts';
import { canVoidExpenseFinancialState, utcDateToCivilDate, civilDate, civilDateToUtcDate, civilDayRangeToUtc, civilInstantDayRangeToUtc, civilPeriodKey, coerceCivilDate, exclusiveEndOfDay, expenseDocumentDateStatus, expenseLineCharges, isCivilDate, todayCivilDate, EXPENSE_PAYMENT_METHODS, type ExpensePaymentMethod } from '@watchdog-bms/contracts';
import { expenseTaxSourceChecksum, validateStatusTransition } from '../domain/logic/expense-status.logic';
import { nextExpensePostingSource } from '../domain/logic/expense-auto-post.logic';
import { calcPaymentAmounts, derivePaymentStatus, SETTLE_EPSILON } from '../domain/logic/expense-totals.logic';
import { acceptExpenseVatSource } from '../domain/logic/expense-vat-reconciliation.logic';
import {
  assertActiveTransactionBranch as assertActiveExpenseBranch,
  requireTransactionBranchId as requireExpenseBranchId,
  resolveTransactionBranchId,
} from '../../data-model-core/application/services/transaction-branch';
export {
  assertActiveTransactionBranch as assertActiveExpenseBranch,
  requireTransactionBranchId as requireExpenseBranchId,
} from '../../data-model-core/application/services/transaction-branch';

export type ExpenseDb = Prisma.TransactionClient | PrismaService['client'];

export type AiExpenseReadFilter = {
  companyId: string;
  branchId?: string;
  status?: ListExpensesFilter['status'];
  paymentStatus?: ListExpensesFilter['paymentStatus'];
  vendorCounterpartyId?: string;
  expenseCategoryId?: string;
  fromDate: string;
  toDate: string;
  createdByUserId?: string;
};

export type AiExpenseReadScope = {
  branchIds?: string[];
  relatedUserId?: string;
};

/** The list and disbursement readers share the same tenant, branch and actor predicate. */
export function expenseReadScopeWhere(filter: { companyId: string; branchId?: string; createdByUserId?: string }, scopes?: BranchScopes, relatedUserId?: string): Prisma.ExpenseRecordWhereInput {
  return { companyId: filter.companyId,
    ...(!filter.branchId ? branchScopeWhere(scopes ?? {}) : { branchId: filter.branchId }),
    ...(filter.createdByUserId ? { createdByUserId: filter.createdByUserId } : {}),
    ...(relatedUserId ? { AND: [expenseRelatedToUserWhere(relatedUserId)] } : {}),
  };
}

export type AiExpenseGroupBy = 'category' | 'vendor' | 'day';

export type ExpensePaymentResult = { expense: ExpenseRecord; payment: ExpensePaymentRecord; replayed: boolean };
type SubstituteReceiptPolicyWithApprovalMode = SubstituteReceiptPolicyRecord & { approvalMode: SubstituteReceiptApprovalMode };

const AUTO_STALE_DUPLICATE_REASON = 'system:stale_after_rescan';
const SUPERSEDED_DUPLICATE_REASON = 'system:superseded_by_confirmed_duplicate';
const SUBSTITUTE_RECEIPT_DOCUMENT_TYPE = 'expense.substitute_receipt';
const SUBSTITUTE_RECEIPT_OWNER_TYPE = 'expense_substitute_receipt';
export const SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON = 'EXPENSE_VOIDED';
/** Timestamp ranges follow the same Bangkok civil dates shown by the Expenses UI. */
function bangkokCivilDayRangeToUtc(from?: string, to?: string): { gte?: Date; lt?: Date } {
  return civilInstantDayRangeToUtc(from, to);
}


type ExpenseTaxFinalizer = (input: {
  db: any;
  expense: ExpenseRecordWithRelations;
}) => Promise<ExpenseLineInput[]>;

export function expenseDecimalToString(value: { toString(): string } | null | undefined): string {
  return value?.toString() ?? '0';
}

export type VendorBreakdownRawGroup = {
  vendorCounterpartyId: string | null;
  vendorNameSnapshot: string | null;
  currency: string;
  count: number;
  /** Exact decimal string, already through `expenseDecimalToString` — this function never touches
   *  a raw Prisma Decimal so it stays testable with plain objects. */
  totalAmount: string;
};

export type VendorBreakdownMergedGroup = {
  vendorCounterpartyId: string | null;
  /** The vendor's display text when it is NOT linked to a counterparty: the trimmed
   *  `vendorNameSnapshot` (e.g. a reimbursement projection's "เบิกคืนพนักงาน: <employee>", or an
   *  older expense that only ever captured a snapshot). Null only when the row has neither an id
   *  nor a snapshot — the caller renders that as "ไม่ระบุร้าน". A linked row's real display name
   *  comes from the counterparty catalog, looked up by `vendorCounterpartyId` afterward. */
  snapshotLabel: string | null;
  currency: string;
  count: number;
  totalAmount: string;
};

/**
 * Merges raw (vendorCounterpartyId, vendorNameSnapshot, currency) groups into one row per
 * (effective vendor, currency), then ranks and pages the merged population — never the raw one.
 *
 * A counterparty id is the merge key when present, so every snapshot variant of one linked vendor
 * (its `vendorNameSnapshot` can differ row to row) collapses back into a single row. Otherwise the
 * trimmed snapshot text is the key, which is how a reimbursement projection ("เบิกคืนพนักงาน: …",
 * never auto-linked — CON-4) and an older snapshot-only expense keep their real vendor identity
 * instead of collapsing into "unknown". A row with neither an id nor a snapshot text is the one
 * genuinely unknown population, merged under its own key. Currency is always part of the key —
 * amounts never sum across currencies.
 *
 * `vendorHasMore` is true when EITHER the raw fetch itself hit `rawGroups.length > vendorFetchLimit`
 * (the merge may be missing sub-groups the caller never fetched) OR the merged, deduplicated
 * population is larger than `vendorGroupLimit` (the usual "more than the top N" signal).
 */
export function mergeVendorBreakdownGroups(
  rawGroups: readonly VendorBreakdownRawGroup[],
  vendorFetchLimit: number,
  vendorGroupLimit: number,
): { vendorPage: VendorBreakdownMergedGroup[]; vendorHasMore: boolean } {
  const rawHasMore = rawGroups.length > vendorFetchLimit;
  const merged = new Map<string, { vendorCounterpartyId: string | null; snapshotLabel: string | null; currency: string; count: number; totalAmount: Decimal }>();
  for (const row of rawGroups.slice(0, vendorFetchLimit)) {
    const trimmedSnapshot = row.vendorNameSnapshot?.trim() || null;
    const mergeKey = `${row.currency}::${row.vendorCounterpartyId ?? (trimmedSnapshot ? `snap:${trimmedSnapshot}` : 'unknown')}`;
    const amount = new Decimal(row.totalAmount);
    const existing = merged.get(mergeKey);
    if (existing) {
      existing.count += row.count;
      existing.totalAmount = existing.totalAmount.add(amount);
    } else {
      merged.set(mergeKey, {
        vendorCounterpartyId: row.vendorCounterpartyId,
        snapshotLabel: row.vendorCounterpartyId ? null : trimmedSnapshot,
        currency: row.currency, count: row.count, totalAmount: amount,
      });
    }
  }
  const sorted = [...merged.values()].sort((a, b) => b.totalAmount.comparedTo(a.totalAmount));
  const vendorPage = sorted.slice(0, vendorGroupLimit).map((row) => ({
    vendorCounterpartyId: row.vendorCounterpartyId, snapshotLabel: row.snapshotLabel,
    currency: row.currency, count: row.count,
    // .toFixed(4), not expenseDecimalToString/.toString(): decimal.js normalises away trailing
    // zeros on every add(), so a merged sum would otherwise drift from the "18,4" column scale
    // every other amount in this response keeps (e.g. "150" instead of "150.0000").
    totalAmount: row.totalAmount.toFixed(4),
  }));
  return { vendorPage, vendorHasMore: rawHasMore || sorted.length > vendorGroupLimit };
}

/** View-only ABAC for people persisted as actors on an expense or its source claim. */
export function expenseRelatedToUserWhere(userId: string): Prisma.ExpenseRecordWhereInput {
  return {
    OR: [
      { createdByUserId: userId },
      { updatedByUserId: userId },
      { reviewedByUserId: userId },
      { confirmedByUserId: userId },
      { rejectedByUserId: userId },
      { voidedByUserId: userId },
      { substituteReceiptGeneratedByUserId: userId },
      { payments: { some: { OR: [{ createdByUserId: userId }, { voidedByUserId: userId }] } } },
      {
        substituteReceiptEvidences: {
          some: {
            OR: [
              { preparedByUserId: userId },
              { payerUserId: userId },
              { approverUserId: userId },
              { issuedByUserId: userId },
            ],
          },
        },
      },
      {
        sourceReimbursementRequest: {
          is: {
            OR: [
              { requesterUserId: userId },
              { createdByUserId: userId },
              { submittedByUserId: userId },
              { currentApproverUserId: userId },
              { financeReviewedByUserId: userId },
              { cancellationPendingByUserId: userId },
              { approvalSteps: { some: { OR: [{ approverUserId: userId }, { decisionByUserId: userId }] } } },
              { payments: { some: { OR: [{ paidByUserId: userId }, { voidedByUserId: userId }] } } },
              { claimSignatures: { some: { signedByUserId: userId } } },
            ],
          },
        },
      },
    ],
  };
}

function mapExpense(r: any): ExpenseRecord {
  return {
    ...r,
    ...(r._count?.payments !== undefined && { hasDeletionBlockingHistory: r._count.payments > 0 || r._count.disbursementVoucherLines > 0 }),
    ...(r._count?.substituteReceiptEvidences !== undefined && { hasRetainedSubstituteReceiptEvidence: r._count.substituteReceiptEvidences > 0 }),
    costSourceExpenseId: r.sourceReimbursementRequestId && typeof r.sourceChannelMetadataJson?.reimbursementSource?.expenseId === 'string' ? r.sourceChannelMetadataJson.reimbursementSource.expenseId : undefined,
    journalEntryNumber: r.journalEntryNumber ?? null,
    pendingPostingSourceType: r.pendingPostingSourceType ?? null,
    pendingPostingSourceId: r.pendingPostingSourceId ?? null,
    subtotalAmount: r.subtotalAmount?.toString() ?? '0',
    discountAmount: r.discountAmount?.toString() ?? '0',
    taxableAmount: r.taxableAmount?.toString() ?? '0',
    vatAmount: r.vatAmount?.toString() ?? '0',
    whtAmount: r.whtAmount?.toString() ?? '0',
    whtCategoryCode: r.whtCategoryCode ?? null,
    whtRate: expenseWhtHeaderRate(r.whtInputJson, r.lines, r.whtRate),
    grandTotalAmount: expenseDecimalToString(r.grandTotalAmount),
    netPayableAmount: r.netPayableAmount?.toString() ?? '0',
    paidAmount: r.paidAmount?.toString() ?? '0',
    outstandingAmount: r.outstandingAmount?.toString() ?? '0',
    vendorSnapshotJson: r.vendorSnapshotJson ?? null,
    aiVerifiedFieldsJson: r.aiVerifiedFieldsJson ?? null,
    aiVerificationSummaryJson: r.aiVerificationSummaryJson ?? null,
    // Spec §5.2: derived here, once, so a list row can say whether its date was read off the
    // document or is the upload-day placeholder. Every consumer would otherwise have to re-derive
    // it from the summary JSON, and the list does not even load that.
    dateStatus: expenseDocumentDateStatus(r.aiVerificationSummaryJson),
    vatCaptureSnapshotJson: r.vatCaptureSnapshotJson ?? null,
    whtInputJson: r.whtInputJson ?? null,
  };
}

/**
 * Appendix §5/A39: where a derived source came from. The amounts are the reviewed allocation's,
 * copied into `aiVerificationSummaryJson` at handoff, so the detail page can say "810 บาท จากยอดที่
 * จ่ายจริง 1,290 บาท" without reading the capture aggregate — and null on every other expense.
 */
function captureLineage(expense: ExpenseRecord): import('@watchdog-bms/contracts').ExpenseCaptureLineage | null {
  if (!expense.captureGroupId) return null;
  const summary = (expense.aiVerificationSummaryJson ?? {}) as Record<string, unknown>;
  const money = (key: string): string | null => (typeof summary[key] === 'string' ? summary[key] as string : null);
  return {
    groupId: expense.captureGroupId,
    scopeKey: expense.captureScopeKey ?? null,
    allocationId: expense.captureAllocationId ?? null,
    webPath: expenseCaptureWebPath(expense.companyId, expense.captureGroupId),
    paidTotal: money('paidTotal'),
    companyAmount: money('companyAmount'),
    personalAmount: money('personalAmount'),
  };
}

/** W06/D04: the allocation block the certificate snapshot prints, or null when there is nothing to
 *  state — an ordinary expense, an auto-handoff source (§3.2, no allocation) or a pre-W05 row. */
export function captureAllocationSnapshot(
  expense: ExpenseRecord,
  allocation: { groupRevision: number; policyVersion: string } | null,
): import('../domain/logic/substitute-receipt.logic').SubstituteReceiptCaptureAllocation | null {
  const lineage = captureLineage(expense);
  if (!lineage?.allocationId || !expense.captureScopeKey || !allocation) return null;
  if (lineage.paidTotal === null || lineage.companyAmount === null) return null;
  return {
    groupId: lineage.groupId,
    groupRef: captureGroupRef(lineage.groupId),
    allocationId: lineage.allocationId,
    allocationRevision: allocation.groupRevision,
    scopeKey: expense.captureScopeKey,
    paidTotal: lineage.paidTotal,
    companyAmount: lineage.companyAmount,
    personalAmount: lineage.personalAmount ?? '0.00',
    policyVersion: allocation.policyVersion,
  };
}

function mapPayment(row: any): ExpensePaymentRecord {
  return {
    ...row,
    amount: row.amount.toString(),
    journalEntryId: row.journalEntryId ?? null,
    journalEntryNumber: row.journalEntryNumber ?? null,
    postingError: row.postingError ?? null,
    paymentMethod: row.paymentMethod ?? null,
    bankAccountRef: row.bankAccountRef ?? null,
    voidedByUserId: row.voidedByUserId ?? null,
    voidedAt: row.voidedAt ?? null,
  };
}

function mapLine(l: any) {
  const taxSnapshot = l.taxCodeDefinitionId || l.externalTaxCodeSnapshot ? {
    taxCodeDefinitionId: l.taxCodeDefinitionId ?? null, externalTaxCode: l.externalTaxCodeSnapshot ?? null,
    taxProfileKey: l.taxProfileKeySnapshot ?? null, taxProfileVersion: l.taxProfileVersionSnapshot ?? null,
    roundingMode: l.roundingModeSnapshot ?? undefined, roundingScale: l.roundingScaleSnapshot ?? undefined,
    taxAmountTolerance: l.taxAmountToleranceSnapshot?.toString(),
    taxRegime: l.taxRegimeSnapshot ?? null, taxDirection: l.taxDirectionSnapshot ?? null,
    taxTreatment: l.taxTreatmentSnapshot ?? null, taxContext: l.taxContextSnapshot ?? null,
    taxRate: l.taxRateSnapshot?.toString() ?? '0', sourceCurrency: l.sourceCurrencySnapshot ?? 'THB',
    taxCurrency: l.taxCurrencySnapshot ?? 'THB', exchangeRate: l.exchangeRateSnapshot?.toString() ?? '1',
    exchangeRateSource: l.exchangeRateSourceSnapshot ?? 'FUNCTIONAL_CURRENCY', exchangeRateDate: l.exchangeRateDateSnapshot?.toISOString?.().slice(0, 10) ?? '',
    taxBaseAmount: l.taxBaseAmount?.toString() ?? '0',
    taxAmount: l.transactionTaxAmount?.toString() ?? '0', claimability: l.claimabilitySnapshot ?? 'NOT_APPLICABLE',
    evidenceStatus: l.taxEvidenceReviewStatus ?? 'REVIEW_REQUIRED', accountRuleVersion: l.accountRuleVersionSnapshot ?? null,
    reportRuleVersion: l.reportRuleVersionSnapshot ?? null,
  } : undefined;
  return {
    id: l.id,
    lineNumber: l.lineNumber,
    description: l.description,
    chargeKind: l.chargeKind ?? null,
    quantity: l.quantity?.toString() ?? '0',
    unitPrice: l.unitPrice?.toString() ?? '0',
    discountAmount: l.discountAmount?.toString() ?? '0',
    taxableAmount: l.taxableAmount?.toString() ?? '0',
    vatRate: l.vatRate?.toString() ?? null,
    vatTreatment: l.vatTreatment ?? null,
    vatAmount: l.vatAmount?.toString() ?? '0',
    whtCategoryCode: l.whtCategoryCode ?? null,
    whtRate: l.whtRate?.toString() ?? null,
    whtAmount: l.whtAmount?.toString() ?? '0',
    lineSubtotalAmount: l.lineSubtotalAmount?.toString() ?? '0',
    lineTotalAmount: l.lineTotalAmount?.toString() ?? '0',
    expenseCategoryId: l.expenseCategoryId ?? null,
    accountHintKey: l.accountHintKey ?? null,
    taxCategory: l.taxCategory ?? null,
    sourceLineText: l.sourceLineText ?? null,
    aiLineConfidence: l.aiLineConfidence ?? null,
    reviewStatus: l.reviewStatus ?? 'REVIEWED',
    taxSnapshot,
    taxComponents: Array.isArray(l.taxComponentsJson) ? l.taxComponentsJson : undefined,
  };
}

function isDomesticTaxSnapshot(snapshot: ExpenseLineInput['taxSnapshot']): boolean {
  return snapshot?.taxContext === 'DOMESTIC_PURCHASE' && ['CLAIMABLE', 'PENDING_EVIDENCE'].includes(snapshot.claimability);
}

function expenseLineTaxSnapshotData(line: ExpenseLineInput) {
  const { taxSnapshot, taxComponents } = line;
  return {
    taxCodeDefinitionId: taxSnapshot?.taxCodeDefinitionId ?? null,
    externalTaxCodeSnapshot: taxSnapshot?.externalTaxCode ?? null,
    taxProfileKeySnapshot: taxSnapshot?.taxProfileKey ?? null,
    taxProfileVersionSnapshot: taxSnapshot?.taxProfileVersion ?? null,
    roundingModeSnapshot: taxSnapshot?.roundingMode ?? null,
    roundingScaleSnapshot: taxSnapshot?.roundingScale ?? null,
    taxAmountToleranceSnapshot: taxSnapshot?.taxAmountTolerance ?? null,
    taxRegimeSnapshot: taxSnapshot?.taxRegime ?? null,
    taxDirectionSnapshot: taxSnapshot?.taxDirection ?? null,
    taxTreatmentSnapshot: taxSnapshot?.taxTreatment ?? null,
    taxContextSnapshot: taxSnapshot?.taxContext ?? null,
    taxRateSnapshot: taxSnapshot?.taxRate ?? null,
    sourceCurrencySnapshot: taxSnapshot?.sourceCurrency ?? null,
    taxCurrencySnapshot: taxSnapshot?.taxCurrency ?? null,
    exchangeRateSnapshot: taxSnapshot?.exchangeRate ?? null,
    exchangeRateSourceSnapshot: taxSnapshot?.exchangeRateSource ?? null,
    exchangeRateDateSnapshot: taxSnapshot?.exchangeRateDate ? new Date(taxSnapshot.exchangeRateDate) : null,
    taxBaseAmount: taxSnapshot?.taxBaseAmount ?? null,
    transactionTaxAmount: taxSnapshot?.taxAmount ?? null,
    claimabilitySnapshot: taxSnapshot?.claimability ?? null,
    accountRuleVersionSnapshot: taxSnapshot?.accountRuleVersion ?? null,
    reportRuleVersionSnapshot: taxSnapshot?.reportRuleVersion ?? null,
    taxEvidenceReviewStatus: taxSnapshot?.evidenceStatus ?? null,
    taxComponentsJson: taxComponents ?? null,
    accountAssignmentsJson: taxComponents?.flatMap((component) => component.accountAssignments) ?? null,
  };
}

function mapSignatureAsset(s: any): SignatureAssetRecord {
  return {
    id: s.id,
    companyId: s.companyId,
    label: s.label ?? null,
    status: s.status,
    originalAttachmentId: s.originalAttachmentId,
    derivedAttachmentId: s.derivedAttachmentId ?? null,
    submittedByUserId: s.submittedByUserId,
    submittedFromChannel: s.submittedFromChannel,
    lineMessageId: s.lineMessageId ?? null,
    approvedByUserId: s.approvedByUserId ?? null,
    approvedAt: s.approvedAt ?? null,
    rejectedByUserId: s.rejectedByUserId ?? null,
    rejectedAt: s.rejectedAt ?? null,
    rejectReason: s.rejectReason ?? null,
    archivedAt: s.archivedAt ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function mapSubstituteEvidence(row: any): SubstituteReceiptEvidenceRecord {
  return {
    ...row,
    fundingSource: row.fundingSource ?? null,
    snapshotJson: row.snapshotJson ?? null,
    paymentEvidenceAttachmentIds: Array.isArray(row.paymentEvidenceAttachmentIds) ? row.paymentEvidenceAttachmentIds : [],
    supportingAttachmentIds: Array.isArray(row.supportingAttachmentIds) ? row.supportingAttachmentIds : [],
  };
}

export function toSubstituteEvidenceSummary(row: SubstituteReceiptEvidenceRecord): import('@watchdog-bms/contracts').SubstituteReceiptEvidenceSummary {
  return {
    id: row.id,
    expenseId: row.expenseId,
    fundingSource: row.fundingSource ?? null,
    revisionOfEvidenceId: row.revisionOfEvidenceId ?? null,
    correctionOfEvidenceId: row.correctionOfEvidenceId ?? null, correctionReason: row.correctionReason ?? null,
    version: row.version,
    status: row.status,
    documentNumber: row.documentNumber,
    originalSourceDocumentType: row.originalSourceDocumentType,
    reasonCode: row.reasonCode,
    missingReceiptReason: row.missingReceiptReason,
    payeeName: row.payeeName,
    payeeAddress: row.payeeAddress,
    payeeTaxId: row.payeeTaxId,
    payerUserId: row.payerUserId,
    payerName: row.payerName,
    businessPurpose: row.businessPurpose,
    paymentEvidenceAttachmentIds: row.paymentEvidenceAttachmentIds,
    supportingAttachmentIds: row.supportingAttachmentIds,
    paymentDate: row.paymentDate?.toISOString() ?? null,
    paymentMethod: row.paymentMethod,
    note: row.note,
    preparedByUserId: row.preparedByUserId,
    preparedAt: row.preparedAt.toISOString(),
    expenseUpdatedAtAtPreparation: row.expenseUpdatedAtAtPreparation.toISOString(),
    payerPosition: row.payerPosition,
    certifiedArtifactAttachmentId: row.certifiedArtifactAttachmentId,
    certifiedArtifactChecksumSha256: row.certifiedArtifactChecksumSha256,
    certifiedAt: row.certifiedAt?.toISOString() ?? null,
    approverUserId: row.approverUserId,
    approverName: row.approverName,
    approverPosition: row.approverPosition,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    artifactAttachmentId: row.artifactAttachmentId,
    checksumSha256: row.checksumSha256,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    supersedeReason: row.supersedeReason,
    signatureMode: row.signatureMode,
    paperFormPrepared: Boolean(row.paperFormSnapshotJson),
    paperSubmission: row.paperSubmissionJson ?? null,
    paperReviewedByUserId: row.paperReviewedByUserId ?? null,
    wetSignedScanAttachmentId: row.wetSignedScanAttachmentId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function selectExpenseCategoryScope<T extends {
  companyId: string | null;
  name: string;
  accountHintKey: string;
  ledgerAccountReviewedByUserId: string | null;
}>(categories: T[], companyId: string): T[] {
  const companyCategories = categories.filter((category) => category.companyId === companyId);
  if (companyCategories.some((category) => category.ledgerAccountReviewedByUserId === 'system:expense-category-bootstrap')) {
    return companyCategories;
  }

  const companyNames = new Set(companyCategories.map((category) => category.name.trim().toLocaleLowerCase('th-TH')));
  const companyHints = new Set(companyCategories.map((category) => category.accountHintKey));
  return categories.filter((category) => category.companyId === companyId || (
    category.companyId === null
    && !companyNames.has(category.name.trim().toLocaleLowerCase('th-TH'))
    && !companyHints.has(category.accountHintKey)
  ));
}

export type ExpenseCertificateCancellation = {
  issuerUserId: string | null;
  certificateNumber: string | null;
  isExternal: boolean;
  certificateRound: number;
};

export type RecordExpensePaymentAtomicInput = {
  slipAttachmentId?: string;
  companyId: string;
  expenseId: string;
  actorUserId: string;
  scopes: BranchScopes;
  idempotencyKey: string;
  amount: string;
  expectedUpdatedAt?: Date;
  paymentMethod?: string;
  paidAt?: string;
  /** Internal writers must distinguish a generated date from a supplied date. */
  paidAtConfirmed?: boolean;
  bankAccountRef?: string;
  /** Internal settlement authority; the direct-payment use-case never forwards this. */
  payingThroughDisbursementVoucherId?: string;
  permissions?: string[];
  viewerReadScope?: DisbursementReadScope;
};

/** Shared preflight and locked-source rules. The repository's historic claim code stays intact. */
export function assertExpensePaymentSource(expense: { branchId?: string | null; sourceReimbursementRequestId?: string | null }, paidAt?: string, repositoryClaimCode = false) {
  if (expense.sourceReimbursementRequestId != null) {
    if (repositoryClaimCode) throw new BadRequestException({ code: 'claim_expense_settles_via_reimbursement', message: 'A claim-born expense settles through reimbursement payment.' });
    throw new UnprocessableEntityException({ code: 'expense_settled_via_reimbursement', message: 'Claim-projected expenses are settled by their reimbursement payout, not a manual expense payment.' });
  }
  requireExpenseBranchId(expense.branchId);
  if (paidAt && isCivilDate(paidAt) && paidAt > todayCivilDate('Asia/Bangkok')) throw new BadRequestException({ code: 'expense_payment_future_date', message: EXPENSE_CORRECTION_WORDS.futurePaymentDate });
}

function documentDateWhere(fromDate?: string, toDate?: string): Record<string, unknown> {
  const status = (value: unknown) => ({ aiVerificationSummaryJson: { path: ['dateStatus'], equals: value } });
  const legacyStatus = { OR: [status(Prisma.AnyNull), { NOT: { OR: ['verified', 'assumed', 'unverified', 'implausible'].map(status) } }] };
  const missing = { aiVerificationSummaryJson: { path: ['missingFields'], array_contains: ['expenseDate'] } };
  // An unusual reading still belongs to its document month; only an unread placeholder uses intake.
  const readable = { OR: [status('verified'), status('assumed'), status('implausible'), { AND: [legacyStatus, { OR: [
    { aiVerificationSummaryJson: { path: ['missingFields'], equals: Prisma.AnyNull } }, { NOT: missing },
  ] }] }] };
  const unreadable = { OR: [status('unverified'), { AND: [legacyStatus, missing] }] };
  return { OR: [
    { AND: [readable], expenseDate: civilDayRangeToUtc(fromDate, toDate) },
    { AND: [unreadable], uploadedAt: bangkokCivilDayRangeToUtc(fromDate, toDate) },
  ] };
}

export function validateExpensePaymentInput(input: { amount: string; paidAt?: string; paymentMethod?: string; bankAccountRef?: string }) {
    if (typeof input.amount !== 'string' || !POSITIVE_ACCOUNTING_MONEY_PATTERN.test(normalizeExpensePaymentAmount(input.amount))) {
      throw new BadRequestException({
        code: 'expense_payment_exceeds_outstanding',
        message: 'Payment amount must be positive and cannot exceed the outstanding amount.',
      });
    }
    const amount = new Decimal(input.amount);
    if (input.paidAt != null && !isCivilDate(input.paidAt)) {
      throw new BadRequestException({ code: 'expense_payment_invalid_date', message: 'Payment date must be a real YYYY-MM-DD calendar day.' });
    }
    if (input.paymentMethod != null && !EXPENSE_PAYMENT_METHODS.includes(input.paymentMethod as any)) {
      throw new BadRequestException({ code: 'expense_payment_invalid_method', message: 'Unknown expense payment method.' });
    }
    const paymentMethod = input.paymentMethod as ExpensePaymentMethod | undefined;
    if (input.bankAccountRef != null && (typeof input.bankAccountRef !== 'string' || input.bankAccountRef.length > 128)) {
      throw new BadRequestException({ code: 'expense_payment_invalid_reference', message: 'Bank reference must be at most 128 characters.' });
    }
    const bankAccountRef = input.bankAccountRef?.trim() || null;
    return { amount, paymentMethod, bankAccountRef };
}

export function assertExpensePaymentOutstanding(current: { status: string; paidAmount: { toString(): string }; netPayableAmount: { toString(): string } }, amount: Decimal) {
    if (current.status !== 'CONFIRMED') {
      throw new BadRequestException({ code: 'expense_payment_not_confirmed', message: EXPENSE_CORRECTION_WORDS.paymentOnUnconfirmed });
    }
    const paidAfter = new Decimal(current.paidAmount.toString()).plus(amount), payable = new Decimal(current.netPayableAmount.toString());
    if (!amount.isFinite() || amount.lte(0) || paidAfter.minus(payable).gt(SETTLE_EPSILON)) {
      throw new BadRequestException({
        code: 'expense_payment_exceeds_outstanding',
        message: 'Payment amount must be positive and cannot exceed the outstanding amount.',
      });
    }
}

@Injectable()
export class PrismaExpenseRepository {
  private readonly reviewRefreshTransactions = new WeakSet<object>();
  // `documentNumbers` is annotated, not merely defaulted: Nest reads design:paramtypes to inject
  // the provider DataModelCoreModule exports, and an unannotated parameter emits nothing there,
  // so the API fails to boot. The default only keeps the class directly constructible from the
  // repository specs; under Nest the injected instance always wins.
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentNumbers: PrismaDocumentSequenceRepository = new PrismaDocumentSequenceRepository(prisma),
  ) {}

  get commercialAccessDb() { return this.prisma.client; }

  async inputVatRight(companyId: string, expenseId: string, db: any = this.prisma.client): Promise<ExpenseInputVatRightView> {
    const expense = await db.expenseRecord.findFirstOrThrow({ where: { id: expenseId, companyId } });
    const facts = await inputVatDecisionFacts(db, expense);
    const fixedReason = inputVatFixedReason(expense, facts.vatStatus);
    const latest = facts.latestDecision;
    const actor = latest ? await db.user.findUnique({ where: { id: latest.decidedByUserId }, select: { displayName: true } }) : null;
    const legacy = inputVatRecordedBeforeReview(expense, Boolean(latest));
    const [features, posted, filed] = await Promise.all([
      db.companyFeatureEntitlement.findMany({ where: { companyId, enabled: true }, select: { featureKey: true } }),
      db.journalEntry.findFirst({ where: { companyId, sourceType: 'expense.record', sourceId: expenseId, status: 'POSTED' } }),
      db.taxPeriod.findFirst({ where: { companyId, formType: 'PP30', periodKey: expense.expenseDate.toISOString().slice(0, 7), status: { in: ['FILED', 'PAID', 'CLOSED'] } } }),
    ]);
    return { vatStatus: facts.vatStatus, buyerMatchStatus: facts.buyer.matchStatus,
      conditions: inputVatConditions(expense, facts, { toStatus: 'NON_CLAIMABLE' }, ''),
      postsToLedger: ['expenses', 'double_entry_ledger', 'expense_auto_post'].every(key => features.some((row: any) => row.featureKey === key)),
      decisionBlocker: posted ? 'input_vat_posted_journal_immutable' : filed ? 'tax_period_locked' : null,
      status: expense.inputVatClaimStatus, fixed: Boolean(fixedReason), reasonCode: legacy ? 'RECORDED_BEFORE_INPUT_VAT_DECISION' : fixedReason,
      latestDecision: latest ? { id: latest.id, fromStatus: latest.fromStatus, toStatus: latest.toStatus, reason: latest.reason,
        conditions: latest.conditionsJson, evidenceAttachmentIds: latest.evidenceAttachmentIds, decidedByUserId: latest.decidedByUserId,
        decidedByName: actor?.displayName ?? 'ผู้ตรวจ', decidedAt: latest.decidedAt.toISOString() } : null };
  }

  async decideInputVat(ctx: RequestContext, expenseId: string, input: DecideExpenseInputVatInput): Promise<ExpenseInputVatRightView> {
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`${ctx.companyId}:vat-registration`}))`;
      await lockExpenseFunding(tx, ctx.companyId, expenseId);
      await lockExpenseCorrection(tx, ctx.companyId, expenseId);
      const expense = await tx.expenseRecord.findFirst({ where: { id: expenseId, companyId: ctx.companyId, ...branchScopeWhere(ctx.scopes ?? {}) }, include: { lines: true } });
      if (!expense) throw new NotFoundException('Expense not found');
      if (['VOIDED', 'REJECTED'].includes(expense.status)) throw new ConflictException({ code: 'input_vat_expense_closed', message: 'รายจ่ายนี้ปิดแล้ว เปิดรายจ่ายที่ยังใช้งานเพื่อเลือกสิทธิภาษีซื้อ' });
      const facts = await inputVatDecisionFacts(tx, expense);
      const conditions = validateInputVatDecision(expense, facts, input, ctx.userId);
      await assertInputVatDecisionPeriodOpen(tx, expense);
      const decision = await appendInputVatDecision(tx, expense, { toStatus: input.toStatus, reason: input.reason?.trim() || null,
        conditions, attachmentIds: facts.attachmentIds, userId: ctx.userId, requestId: ctx.requestId });
      await tx.expenseRecord.update({ where: { id: expenseId }, data: { inputVatClaimStatus: input.toStatus,
        sourceChannelMetadataJson: { ...expense.sourceChannelMetadataJson, inputVatDecisionId: decision.id } } });
      if (expense.status === 'CONFIRMED' && expense.inputVatClaimStatus !== input.toStatus) {
        const draft = await tx.journalEntry.findFirst({ where: { companyId: ctx.companyId, sourceType: 'expense.record', sourceId: expenseId, entryType: 'GENERATED', status: 'DRAFT' } });
        if (draft) {
          // Defer the import: the ordinary journal generator also reads this repository.
          const { rebuildExpenseDraftJournal } = await import('../../ledger/application/use-cases/journal.use-case');
          await rebuildExpenseDraftJournal(tx, ctx, { ...mapExpense(expense), inputVatClaimStatus: input.toStatus, lines: (expense.lines ?? []).map(mapLine) }, draft);
        }
      }
      return this.inputVatRight(ctx.companyId, expenseId, tx);
    });
  }

  async recordPaymentAtomic(input: RecordExpensePaymentAtomicInput, withinTx?: (tx: Prisma.TransactionClient, result: ExpensePaymentResult) => Promise<void>): Promise<ExpensePaymentResult> {
    return this.prisma.client.$transaction(async tx => {
      // Keys share this namespace with disbursement vouchers; all source locks follow it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.idempotencyKey}:expense-payment-command`}))`;
      await lockExpenseFunding(tx, input.companyId, input.expenseId);
      await assertFundingMutation(tx, input.companyId, input.expenseId, 'payment');
      await lockExpenseCorrection(tx, input.companyId, input.expenseId);
      return this.recordPaymentInTransaction(tx, input, withinTx);
    }, { isolationLevel: 'ReadCommitted' });
  }

  /** Caller holds the payment-key, funding and expense lifecycle locks in that order. */
  async recordPaymentInTransaction(tx: Prisma.TransactionClient, input: RecordExpensePaymentAtomicInput,
    withinTx?: (tx: Prisma.TransactionClient, result: ExpensePaymentResult) => Promise<void>): Promise<ExpensePaymentResult> {
    const current = await tx.expenseRecord.findFirst({ where: { id: input.expenseId, companyId: input.companyId } });
    if (!current) throw new NotFoundException(`Expense ${input.expenseId} not found`);
    if (!isBranchInScope(input.scopes, current.branchId)) {
      throw new ForbiddenException('Branch is outside your assigned branch scope.');
    }
    await assertExpenseDisbursementReservation(tx, current, 'recordPayment', input.payingThroughDisbursementVoucherId, input.viewerReadScope ? { ...input.viewerReadScope, permissions: input.permissions ?? [] } : undefined);
    assertExpensePaymentSource(current, input.paidAt, true);
    const { amount, paymentMethod, bankAccountRef } = validateExpensePaymentInput(input);
    const payloadFingerprint = canonicalFingerprint({
      version: 1, expenseId: input.expenseId, branchId: current.branchId ?? null,
      currency: current.currency, amount: amount.toFixed(4), paymentMethod: input.paymentMethod ?? null,
      paidAt: input.paidAt ?? null, bankAccountRef,
      ...(input.slipAttachmentId ? { slipAttachmentId: input.slipAttachmentId } : {}),
    });
    const previous = await tx.expensePayment.findFirst({
      where: { companyId: input.companyId, idempotencyKey: input.idempotencyKey },
    });
    if (previous) {
      if (previous.expenseId !== input.expenseId || previous.payloadFingerprint !== payloadFingerprint) {
        throw new ConflictException({ code: 'expense_payment_idempotency_conflict', message: 'This payment key was already used for a different payment.' });
      }
      // Current source is returned even after void. Never restore totals or emit another event.
      return { expense: mapExpense(current), payment: mapPayment(previous), replayed: true };
    }
    if (input.expectedUpdatedAt && current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new ConflictException('expense_source_version_changed');
    assertExpensePaymentOutstanding(current, amount);
    const paymentCompany = input.paidAt ? await tx.company?.findUnique?.({ where: { id: input.companyId }, select: { timezone: true } }) : null;
    const paidAt = input.paidAt ? civilInstantDayRangeToUtc(input.paidAt, undefined, paymentCompany?.timezone ?? 'Asia/Bangkok').gte! : new Date();
    const paidBefore = new Decimal(current.paidAmount.toString());
    const payable = new Decimal(current.netPayableAmount.toString());
    const paidAfter = paidBefore.plus(amount);
    // FIN-01: a pre-§19d row stores a 4dp payable (580.0042) whose printed and displayed
    // outstanding is the satang rounding (580.00, or 580.01 when it rounds up). Settling that
    // figure must be accepted and must settle the row, so both the overshoot guard and the
    // resulting totals use the one satang policy in expense-totals.logic. A real overpayment
    // (a satang or more past the payable) is still refused.
    const payableText = payable.toFixed(4);
    const paidAfterText = paidAfter.toFixed(4);
    const { outstandingAmount } = calcPaymentAmounts(payableText, paidAfterText);
    const paymentStatus = derivePaymentStatus(payableText, paidAfterText);
    if (input.slipAttachmentId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.slipAttachmentId}:attachment-retention`}))`;
      const file = await tx.attachmentObject.findFirst({ where: { id: input.slipAttachmentId, companyId: input.companyId,
        branchId: current.branchId, uploadedByUserId: input.actorUserId, status: 'ACTIVE' } });
      const metadata = file?.metadataJson as { generatedFor?: string; expenseId?: string } | null;
      const linked = await tx.attachmentLink.findFirst({ where: { companyId: input.companyId, attachmentId: input.slipAttachmentId } });
      if (!file || !REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES.includes(file.mimeType) || Number(file.byteSize) <= 0 || Number(file.byteSize) > REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES
        || metadata?.generatedFor !== 'expense.payment.slip' || metadata.expenseId !== current.id || linked) {
        throw new BadRequestException({ code: 'expense_payment_slip_invalid', message: 'ใช้ไฟล์นี้เป็นหลักฐานการจ่ายไม่ได้ แนบไฟล์ใหม่แล้วบันทึกจ่ายอีกครั้ง' });
      }
    }
    const payment = await tx.expensePayment.create({
      data: {
        companyId: input.companyId,
        expenseId: input.expenseId,
        idempotencyKey: input.idempotencyKey,
        payloadFingerprint,
        amount: amount.toFixed(4),
        currency: current.currency,
        paymentMethod: paymentMethod ?? null,
        paidAt,
        paidAtConfirmed: Boolean(input.paidAt) && input.paidAtConfirmed !== false,
        bankAccountRef,
        status: 'RECORDED',
        postingStatus: 'pending',
        createdByUserId: input.actorUserId,
      },
    });
    if (input.slipAttachmentId) {
      for (const [targetType, targetId] of [['expense.payment', payment.id], ['expense.record', input.expenseId]]) {
        await tx.attachmentLink.create({ data: { companyId: input.companyId, attachmentId: input.slipAttachmentId,
          targetType, targetId, purpose: 'expense.payment.evidence', linkedByUserId: input.actorUserId } });
      }
    }
    const changed = await tx.expenseRecord.updateMany({
      where: { id: input.expenseId, companyId: input.companyId, status: 'CONFIRMED', updatedAt: current.updatedAt },
      data: {
        paidAmount: paidAfterText,
        outstandingAmount,
        paymentStatus,
        paymentMethod: paymentMethod ?? null,
        paidAt,
        bankAccountRef,
        updatedByUserId: input.actorUserId,
      },
    });
    if (changed.count !== 1) {
      throw new ConflictException({ code: 'expense_payment_changed', message: 'Expense changed while recording payment.' });
    }
    const result = {
      expense: mapExpense(await tx.expenseRecord.findFirstOrThrow({ where: { id: input.expenseId, companyId: input.companyId } })),
      payment: mapPayment({ ...payment, ...(input.slipAttachmentId ? { slipAttachmentId: input.slipAttachmentId } : {}) }),
      replayed: false,
    };
    if (withinTx) await withinTx(tx, result);
    return result;
  }

  async lineVoidBlocker(companyId: string, expenseId: string) {
    return findClaimExpenseVoidBlocker(this.prisma.client, companyId, expenseId);
  }

  async expenseCorrectionCapabilities(companyId: string, expenseId: string, permissions: string[], caller?: DisbursementReadScope) {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      const expense = await tx.expenseRecord.findFirst({ where: { companyId, id: expenseId }, include: { payments: true, lines: true } });
      if (!expense) throw new NotFoundException();
      return readExpenseCorrectionCapabilities(tx, expense, permissions, false, caller, Boolean(caller));
    }, { isolationLevel: 'RepeatableRead' });
  }

  async reopenExpenseAtomic(input: {
    companyId: string; expenseId: string; actorUserId: string; scopes: BranchScopes; reason: string;
    permissions?: string[]; taxFilingAttested?: boolean; requestId?: string; viewerReadScope?: DisbursementReadScope;
  }, withinTx?: (tx: any) => Promise<void>): Promise<{ expense: ExpenseRecord; cancelledCertificate: ExpenseCertificateCancellation | null }> {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      await lockExpenseFunding(tx, input.companyId, input.expenseId);
      await lockExpenseCorrection(tx, input.companyId, input.expenseId);
      // Take turns with filing and handoff mutations, including writers which read before us.
      await tx.$executeRaw`SELECT id FROM "WhtCertificateHandoff" WHERE "companyId" = ${input.companyId} AND (("sourcePaymentType" = 'expense.record' AND "sourcePaymentId" = ${input.expenseId}) OR EXISTS (SELECT 1 FROM "TaxEvent" e WHERE e."companyId" = ${input.companyId} AND e."sourceType" = 'expense.record' AND e."sourceId" = ${input.expenseId} AND "taxEventIdsJson" @> jsonb_build_array(e.id))) FOR UPDATE`;
      const current = await tx.expenseRecord.findFirst({ where: { companyId: input.companyId, id: input.expenseId }, include: { payments: true, lines: true } });
      if (!current) throw new NotFoundException({ code: 'expense_correction_not_found', message: EXPENSE_CORRECTION_WORDS.notFound });
      if (!isBranchInScope(input.scopes, current.branchId)) throw new ForbiddenException({ code: 'expense_correction_branch_forbidden', message: EXPENSE_CORRECTION_WORDS.branchForbidden });
      const capability = await readExpenseCorrectionCapabilities(tx, current, input.permissions ?? ['expense.confirm'], true, input.viewerReadScope);
      if (!capability.canReopen) throw new ConflictException({ code: 'expense_correction_blocked', blockers: capability.reopenBlockers,
        lockedAccountingPeriodKey: capability.lockedAccountingPeriodKey, lockedTaxPeriods: capability.lockedTaxPeriods, certificateOnExpense: capability.certificateOnExpense, disbursementReservation: capability.disbursementReservation,
        message: capability.reopenBlockers.includes('not_confirmed') ? EXPENSE_CORRECTION_WORDS.statusChanged : expenseReopenBlockerMessages(capability).join('\n') });
      if (capability.certificateOnExpense && input.taxFilingAttested !== true) throw new BadRequestException({
        code: 'expense_certificate_attestation_required', message: EXPENSE_CORRECTION_WORDS.certificateAttestationRequired,
      });
      const changed = await tx.expenseRecord.updateMany({ where: { companyId: input.companyId, id: input.expenseId, status: 'CONFIRMED', updatedAt: current.updatedAt },
        data: { status: 'NEEDS_REVIEW', postingStatus: 'not_required', postingError: null,
          confirmedAt: null, confirmedByUserId: null, reviewedAt: null, reviewedByUserId: null, updatedByUserId: input.actorUserId } });
      if (changed.count !== 1) throw new ConflictException({ code: 'expense_correction_source_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
      let cancelledCertificate: ExpenseCertificateCancellation | null = null;
      if (capability.certificateOnExpense) {
        const handoff = await tx.whtCertificateHandoff.findFirst({ where: {
          companyId: input.companyId, sourcePaymentType: 'expense.record', sourcePaymentId: input.expenseId,
          status: { in: ['SYSTEM_ISSUED', 'EXTERNAL_LINKED'] },
        } });
        if (!handoff) throw new ConflictException({ code: 'expense_correction_source_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
        cancelledCertificate = await this.cancelExpenseCertificateInTx(tx, handoff, input, 'expense_reopen');
      }
      await retireExpenseTaxEvents(tx, input.companyId, input.expenseId);
      if (withinTx) await withinTx(tx);
      return { expense: mapExpense(await tx.expenseRecord.findFirstOrThrow({ where: { companyId: input.companyId, id: input.expenseId } })), cancelledCertificate };
    }, { isolationLevel: 'ReadCommitted' });
  }

  async confirmPaymentDateAtomic(input: { companyId: string; expenseId: string; paymentId: string; paidAt: string; actorUserId: string; scopes: BranchScopes }, audit: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    return this.prisma.client.$transaction(async tx => {
      await lockExpenseFunding(tx, input.companyId, input.expenseId);
      await lockExpenseCorrection(tx, input.companyId, input.expenseId);
      const expense = await tx.expenseRecord.findFirst({ where: { companyId: input.companyId, id: input.expenseId } });
      if (!expense) throw new NotFoundException();
      if (!isBranchInScope(input.scopes, expense.branchId)) throw new ForbiddenException();
      assertExpensePaymentSource(expense, input.paidAt, true);
      if (!isCivilDate(input.paidAt)) throw new BadRequestException({ code: 'expense_payment_invalid_date', message: 'ระบุวันที่จ่ายเงินจริงจากหลักฐาน' });
      const company = await tx.company.findUnique({ where: { id: input.companyId }, select: { timezone: true } });
      const paidAt = civilInstantDayRangeToUtc(input.paidAt, undefined, company?.timezone ?? 'Asia/Bangkok').gte!;
      const changed = await tx.expensePayment.updateMany({ where: { companyId: input.companyId, expenseId: input.expenseId, id: input.paymentId, status: 'RECORDED', paidAtConfirmed: false }, data: { paidAt, paidAtConfirmed: true } });
      if (changed.count !== 1) throw new ConflictException({ code: 'expense_payment_date_already_confirmed', message: 'รายการจ่ายเปลี่ยนแล้ว เปิดรายการจ่ายใหม่เพื่อตรวจวันที่' });
      await tx.expenseRecord.update({ where: { id: expense.id }, data: { updatedByUserId: input.actorUserId, updatedAt: new Date() } });
      await audit(tx);
      return { paymentId: input.paymentId, paidAt: input.paidAt, paidAtConfirmed: true };
    });
  }

  async cancelPaymentAtomic(input: {
    companyId: string; expenseId: string; paymentId: string; actorUserId: string; scopes: BranchScopes; reason: string;
  }, withinTx?: (tx: any, cancelledDisbursementVoucherIds: string[]) => Promise<void>): Promise<ExpenseRecord> {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      await lockExpenseFunding(tx, input.companyId, input.expenseId);
      await lockExpenseCorrection(tx, input.companyId, input.expenseId);
      const current = await tx.expenseRecord.findFirst({ where: { companyId: input.companyId, id: input.expenseId }, include: { payments: true } });
      if (!current) throw new NotFoundException();
      if (!isBranchInScope(input.scopes, current.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
      const payment = await tx.expensePayment.findFirst({ where: { companyId: input.companyId, expenseId: input.expenseId, id: input.paymentId } });
      if (!payment) throw new NotFoundException();
      if (payment.status === 'VOIDED') throw new ConflictException({ code: 'expense_payment_already_cancelled', message: EXPENSE_CORRECTION_WORDS.paymentAlreadyCancelled });
      const capability = (await readExpenseCorrectionCapabilities(tx, current, ['expense.payment.record'])).payments.find((p) => p.id === input.paymentId);
      if (!capability?.canCancel) throw new ConflictException({ code: 'expense_payment_correction_blocked', blocker: capability?.cancelBlocker,
        message: capability?.cancelBlocker ? expenseCorrectionBlockerMessage(capability.cancelBlocker, 'cancelPayment') : EXPENSE_CORRECTION_WORDS.unavailable });
      const changedPayment = await tx.expensePayment.updateMany({ where: { companyId: input.companyId, expenseId: input.expenseId, id: input.paymentId, status: 'RECORDED' },
        data: { status: 'VOIDED', postingStatus: 'not_required', postingError: null, voidedAt: new Date(), voidedByUserId: input.actorUserId } });
      if (changedPayment.count !== 1) throw new ConflictException('expense_payment_changed');
      const cancelledDisbursementVoucherIds = await cancelDisbursementVouchersForPayments(tx, input.companyId, [input.paymentId], input.actorUserId, new Date(), current.expenseNumber, false, input.reason);
      // Subtract only this history row: old expenses can include a legacy paid balance with no row.
      const paidAmount = Decimal.max(new Decimal(current.paidAmount.toString()).minus(payment.amount.toString()), 0).toFixed(4);
      const latest = (await tx.expensePayment.findMany({ where: { companyId: input.companyId, expenseId: input.expenseId, status: 'RECORDED' }, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }] }))[0];
      const changed = await tx.expenseRecord.updateMany({ where: { companyId: input.companyId, id: input.expenseId, status: current.status, updatedAt: current.updatedAt },
        data: { paidAmount, ...calcPaymentAmounts(current.netPayableAmount.toString(), paidAmount), paymentStatus: derivePaymentStatus(current.netPayableAmount.toString(), paidAmount),
          paidAt: latest?.paidAt ?? null, paymentMethod: latest?.paymentMethod ?? null, bankAccountRef: latest?.bankAccountRef ?? null, updatedByUserId: input.actorUserId } });
      if (changed.count !== 1) throw new ConflictException('expense_payment_changed');
      if (withinTx) await withinTx(tx, cancelledDisbursementVoucherIds);
      return mapExpense(await tx.expenseRecord.findFirstOrThrow({ where: { companyId: input.companyId, id: input.expenseId } }));
    }, { isolationLevel: 'ReadCommitted' });
  }

  async findPaymentById(companyId: string, paymentId: string): Promise<(ExpensePaymentRecord & { expense: ExpenseRecord }) | null> {
    const row = await this.prisma.client.expensePayment.findFirst({
      where: { id: paymentId, companyId },
      include: { expense: true },
    });
    return row ? { ...mapPayment(row), expense: mapExpense(row.expense) } : null;
  }

  async assertActiveBranch(companyId: string, branchId: string | null | undefined): Promise<void> {
    await assertActiveExpenseBranch(this.prisma.client, companyId, branchId);
  }

  async resolveCreateBranchId(companyId: string, scopes: BranchScopes, selectedBranchId?: string | null): Promise<string> {
    return resolveTransactionBranchId(this.prisma.client, companyId, scopes, selectedBranchId);
  }

  /**
   * `db` lets a caller that already holds a transaction — and the locks that go with it — create
   * the record inside it. The capture handoff needs that: its derived sources, their receipt links
   * and the group's own state are one atomic batch under the §2.4 lock order, and a nested
   * `$transaction` here would put the INSERT outside it.
   */
  async createExpense(input: CreateExpenseRecordInput, withinTx?: (tx: Prisma.TransactionClient, expense: ExpenseRecord) => Promise<void>, db?: Prisma.TransactionClient): Promise<ExpenseRecord> {
    const create = async (tx: Prisma.TransactionClient): Promise<ExpenseRecord> => {
      if (input.draftIdempotencyKey) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.draftIdempotencyKey}:expense-create`}))`;
        const existing = await tx.expenseRecord.findFirst({ where: { companyId: input.companyId, draftIdempotencyKey: input.draftIdempotencyKey } });
        if (existing) {
          if (existing.createdByUserId !== input.createdByUserId || !isBranchInScope(input.draftReplayScopes ?? {}, existing.branchId)) {
            throw new ForbiddenException('Access denied');
          }
          if (existing.draftPayloadHash !== input.draftPayloadHash) {
            throw new ConflictException({ code: 'EXPENSE_DRAFT_KEY_CONFLICT', message: 'รายการที่บันทึกด้วยคำสั่งนี้เปลี่ยนไป เปิดรายการเดิมเพื่อตรวจสอบ' });
          }
          return mapExpense(existing);
        }
        const retired = await tx.documentNumber.findFirst({ where: { companyId: input.companyId, documentType: 'expense.record', idempotencyKey: expenseDraftNumberKey(input.draftIdempotencyKey) } });
        if (retired) throw new ConflictException({ code: 'EXPENSE_DRAFT_DELETED', message: 'รายการที่บันทึกไว้ถูกลบแล้ว กลับไปหน้ารายการค่าใช้จ่าย' });
      }
      await assertActiveExpenseBranch(tx, input.companyId, input.branchId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`${input.companyId}:vat-registration`}))`;
      const inputVatPreset = await applyExpenseInputVatPreset(tx, input);
      const r = await tx.expenseRecord.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId,
          draftIdempotencyKey: input.draftIdempotencyKey,
          draftPayloadHash: input.draftPayloadHash,
          captureSource: input.captureSource as any,
          // Capture handoff (§5): every one of these is derived by the server from a reviewed
          // allocation, and each is left to its column default on every other create path.
          ...(input.status ? { status: input.status as any } : {}),
          ...(input.aiVerificationStatus ? { aiVerificationStatus: input.aiVerificationStatus as any } : {}),
          ...(input.vendorTaxIdSnapshot ? { vendorTaxIdSnapshot: input.vendorTaxIdSnapshot } : {}),
          ...(input.vendorBranchCodeSnapshot ? { vendorBranchCodeSnapshot: input.vendorBranchCodeSnapshot } : {}),
          ...(input.vendorAddressSnapshot ? { vendorAddressSnapshot: input.vendorAddressSnapshot } : {}),
          ...(input.vendorDocumentNumber ? { vendorDocumentNumber: input.vendorDocumentNumber } : {}),
          ...(input.captureGroupId ? { captureGroupId: input.captureGroupId } : {}),
          ...(input.captureAllocationId ? { captureAllocationId: input.captureAllocationId } : {}),
          ...(input.captureScopeKey ? { captureScopeKey: input.captureScopeKey } : {}),
          ...(input.payerUserId ? { payerUserId: input.payerUserId } : {}),
          expenseDate: new Date(input.expenseDate),
          currency: input.currency ?? 'THB',
          vatMode: input.vatMode as any,
          inputVatClaimStatus: inputVatPreset.inputVatClaimStatus ?? input.inputVatClaimStatus,
          expenseCategoryId: input.expenseCategoryId,
          accountHintKey: input.accountHintKey,
          note: input.note,
          missingReceiptReason: input.missingReceiptReason,
          createdByUserId: input.createdByUserId,
          lineMessageId: input.lineMessageId,
          lineEventId: input.lineEventId,
          vendorCounterpartyId: input.vendorCounterpartyId,
          sourceDocumentType: (input.sourceDocumentType ?? 'NEEDS_REVIEW') as any,
          sourceDocumentLanguage: input.sourceDocumentLanguage,
          taxEvidenceStatus: (input.taxEvidenceStatus ?? 'NEEDS_REVIEW') as any,
          taxEvidenceReasonCode: input.taxEvidenceReasonCode,
          sourceChannelMetadataJson: inputVatPreset.sourceChannelMetadataJson as any,
          aiVerificationSummaryJson: input.aiVerificationSummaryJson as any,
          vendorNameSnapshot: input.vendorNameSnapshot,
          vatCaptureSnapshotJson: input.vatCaptureSnapshotJson as any,
          whtInputJson: input.whtInputJson as any,
          subtotalAmount: input.subtotalAmount,
          discountAmount: input.discountAmount,
          taxableAmount: input.taxableAmount,
          vatAmount: input.vatAmount,
          whtAmount: input.whtAmount,
          grandTotalAmount: input.grandTotalAmount,
          netPayableAmount: input.netPayableAmount,
          outstandingAmount: input.outstandingAmount,
        },
      });
      await withinTx?.(tx, mapExpense(r));
      if (input.assignExpenseNumber) {
        const expenseNumber = await expenseNumberInTransaction(tx, this.documentNumbers, r, input.createdByUserId);
        return mapExpense(await tx.expenseRecord.update({ where: { id: r.id }, data: { expenseNumber } }));
      }
      return mapExpense(r);
    };
    if (db) return create(db);
    return input.draftIdempotencyKey || withinTx || input.assignExpenseNumber ? this.prisma.client.$transaction(create) : create(this.prisma.client);
  }

  async findById(companyId: string, id: string, db: ExpenseDb = this.prisma.client): Promise<ExpenseRecord | null> {
    const r = await db.expenseRecord.findFirst({ where: { id, companyId } });
    return r ? mapExpense(r) : null;
  }

  async findAttachmentChecksum(companyId: string, attachmentId: string): Promise<string | null> {
    const attachment = await this.prisma.client.attachmentObject.findFirst({
      where: { id: attachmentId, companyId, status: 'ACTIVE' as any },
      select: { checksumSha256: true },
    });
    return attachment?.checksumSha256 ?? null;
  }

  async findPrimaryReceiptUploader(companyId: string, expenseId: string, attachmentId: string): Promise<string | null> {
    const link = await this.prisma.client.attachmentLink.findFirst({
      where: {
        companyId, targetType: 'expense.record', targetId: expenseId,
        attachmentId, purpose: 'expense.receipt.primary',
        attachment: { companyId, status: 'ACTIVE' as any },
      },
      select: { attachment: { select: { uploadedByUserId: true } } },
    });
    return link?.attachment.uploadedByUserId ?? null;
  }

  async findExpenseIdsByAttachmentChecksum(
    companyId: string,
    excludeId: string,
    checksumSha256: string,
    db: ExpenseDb = this.prisma.client,
    scopes: { branchIds?: string[] } = {},
    /** Derived sources of THIS capture group share the file by design (§5) — never a duplicate. */
    excludeCaptureGroupId?: string | null,
  ): Promise<string[]> {
    const attachments = await db.attachmentObject.findMany({
      where: { companyId, checksumSha256, status: 'ACTIVE' as any },
      select: { id: true },
    });
    if (attachments.length === 0) return [];
    const links = await db.attachmentLink.findMany({
      where: {
        companyId,
        targetType: 'expense.record',
        targetId: { not: excludeId },
        purpose: 'expense.receipt.primary',
        attachmentId: { in: attachments.map((attachment) => attachment.id) },
      },
      select: { targetId: true },
    });
    if (links.length === 0) return [];
    const expenses = await db.expenseRecord.findMany({
      where: {
        companyId,
        id: { in: links.map((link) => link.targetId) },
        status: { not: 'VOIDED' as any },
        ...(excludeCaptureGroupId ? { NOT: { captureGroupId: excludeCaptureGroupId } } : {}),
        ...branchScopeWhere(scopes),
      },
      select: { id: true },
    });
    return expenses.map((expense) => expense.id);
  }

  async findReceiptExtractionAttachment(
    companyId: string,
    expenseId: string,
    primaryAttachmentId: string | null,
  ): Promise<{ id: string; bucket: string; objectKey: string; objectVersionId?: string; mimeType: string; byteSize: number; checksumSha256?: string } | null> {
    const links = await this.prisma.client.attachmentLink.findMany({
      where: {
        companyId,
        targetType: 'expense.record',
        targetId: expenseId,
        ...(primaryAttachmentId ? { attachmentId: primaryAttachmentId } : { purpose: 'expense.receipt.primary' }),
        attachment: { companyId, status: 'ACTIVE' },
      },
      include: { attachment: true },
      take: 2,
    });
    if (links.length !== 1) return null;
    const attachment = links[0]!.attachment;
    return {
      id: attachment.id,
      bucket: attachment.bucket,
      objectKey: attachment.objectKey,
      objectVersionId: attachment.objectVersionId ?? undefined,
      mimeType: attachment.mimeType,
      byteSize: Number(attachment.byteSize),
      // The capture read job fences on the ORIGINAL bytes; without the checksum a replaced file
      // would be read under the old job's identity.
      ...(attachment.checksumSha256 ? { checksumSha256: attachment.checksumSha256 } : {}),
    };
  }

  async findCorrectionHistory(companyId: string, expenseId: string, cancelledPaymentIds: string[]) {
    const audits = await this.prisma.client.auditLog.findMany({
      where: { companyId, result: 'SUCCESS', OR: [
        { action: 'expense.reopen', targetType: 'expense_record', targetId: expenseId },
        { action: 'expense.payment.cancel', targetType: 'expense_payment', targetId: { in: cancelledPaymentIds } },
      ] },
      orderBy: { createdAt: 'desc' }, select: { action: true, targetId: true, createdAt: true, metadataJson: true },
    });
    const cancellationReasons = new Map<string, string>();
    for (const audit of audits) {
      const reason = (audit.metadataJson as { reason?: unknown } | null)?.reason;
      if (audit.action === 'expense.payment.cancel' && typeof audit.targetId === 'string' && typeof reason === 'string' && !cancellationReasons.has(audit.targetId)) cancellationReasons.set(audit.targetId, reason);
    }
    return { reopenedAt: audits.find(a => a.action === 'expense.reopen')?.createdAt ?? null, cancellationReasons };
  }

  async paymentDisbursements(expense: ExpenseRecordWithRelations, scope: DisbursementReadScope, permissions: string[]) {
    const ids = expense.payments.map(p => p.id);
    const coverage = ids.length ? await this.prisma.client.disbursementVoucherLine.findMany({ where: { companyId: expense.companyId, OR: [
      { coversPaymentId: { in: ids }, voucher: { is: { status: { not: 'CANCELLED' } } } },
      { expensePaymentId: { in: ids }, voucher: { is: { status: 'CANCELLED' } } },
    ] }, orderBy: [{ voucher: { cancelledAt: 'desc' } }, { voucherId: 'desc' }],
      select: { coversPaymentId: true, expensePaymentId: true, voucher: { select: { id: true, documentNumber: true, branchId: true, status: true,
        lines: { where: { expense: { is: { NOT: expenseReadScopeWhere(scope, scope.scopes, scope.relatedUserId) } } }, take: 1, select: { id: true } },
      } } } }) : [];
    return new Map(expense.payments.map(payment => {
      const voucher = coverage.find(l => l.coversPaymentId === payment.id && l.voucher.status !== 'CANCELLED')?.voucher;
      const cancelled = !voucher ? coverage.find(l => l.expensePaymentId === payment.id && l.voucher.status === 'CANCELLED')?.voucher : undefined;
      const pointer = (document: typeof voucher) => document?.documentNumber ? {
        id: permissions.includes('expense.disbursement.read') && isBranchInScope(scope.scopes, document.branchId) && document.lines.length === 0 ? document.id : null,
        documentNumber: document.documentNumber,
      } : null;
      return [payment.id, { disbursementVoucher: pointer(voucher), cancelledDisbursementVoucher: pointer(cancelled),
        canIssueDisbursementVoucher: permissions.includes('expense.disbursement.issue') && expense.companyId === scope.companyId && isBranchInScope(scope.scopes, expense.branchId) && (!scope.createdByUserId || scope.createdByUserId === expense.createdByUserId) && expense.status === 'CONFIRMED' && Boolean(expense.branchId) && !expense.sourceReimbursementRequestId && payment.status === 'RECORDED' && !voucher }];
    }));
  }

  async findByIdWithRelations(
    companyId: string,
    id: string,
    db: ExpenseDb = this.prisma.client,
    scopes: { branchIds?: string[] } = {},
  ): Promise<ExpenseRecordWithRelations | null> {
    const r = await db.expenseRecord.findFirst({
      where: { id, companyId, ...branchScopeWhere(scopes) },
      include: {
        _count: { select: { substituteReceiptEvidences: true, payments: true, disbursementVoucherLines: true } },
        lines: { orderBy: { lineNumber: 'asc' } },
        payments: { orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }] },
        // The category's suggested Tax Code rides on the row already being joined — the line
        // picker needs it, and a second query for one string would be waste.
        expenseCategory: { select: { defaultInputTaxCode: true, name: true } },
        duplicateCandidates: {
          where: {
            status: { not: 'DISMISSED' as any },
            candidateExpense: { companyId, ...branchScopeWhere(scopes) },
          },
          // The reviewer decides "same document or not" from the warning card, so the card
          // needs the other side's identity. The relation is already joined by the filter above.
          include: {
            candidateExpense: {
              select: { expenseNumber: true, vendorNameSnapshot: true, expenseDate: true, grandTotalAmount: true },
            },
          },
        },
      },
    });
    if (!r) return null;
    const base = mapExpense(r);
    const paymentRows = (r as any).payments ?? [];
    const paymentIds = paymentRows.map((payment: any) => payment.id);
    const categoryDefaultInputTaxCode = r.expenseCategory?.defaultInputTaxCode ?? null;
    const journals = await db.journalEntry.findMany({
      where: {
        companyId,
        OR: [
          ...(base.journalEntryId ? [{ id: base.journalEntryId }] : []),
          { sourceId: id, sourceType: 'expense.record', entryType: 'GENERATED' as any },
          ...(paymentIds.length ? [{ sourceId: { in: paymentIds }, sourceType: 'expense.payment', entryType: 'GENERATED' as any }] : []),
        ],
      },
      select: { id: true, sourceId: true, sourceType: true, entryNumber: true },
    });
    const journal = (base.journalEntryId ? journals.find((entry) => entry.id === base.journalEntryId && entry.sourceType === 'expense.record') : null)
      ?? journals.find((entry) => entry.sourceType === 'expense.record' && entry.sourceId === id)
      ?? null;
    const pendingPayment = paymentRows.find((payment: any) => payment.status === 'RECORDED'
      && (payment.postingStatus === 'pending' || payment.postingStatus === 'posting_error'));
    const pendingSource = nextExpensePostingSource({
      expenseId: id,
      sourceReimbursementRequestId: base.sourceReimbursementRequestId,
      accrualPosted: Boolean(journal),
      pendingPaymentId: pendingPayment?.id,
    });
    const paymentSlips = paymentRows.length ? await db.attachmentLink.findMany({ where: { companyId, targetType: 'expense.payment',
      targetId: { in: paymentRows.map((payment: any) => payment.id) }, purpose: 'expense.payment.evidence',
      attachment: { companyId, status: 'ACTIVE', ...branchScopeWhere(scopes) } }, select: { targetId: true, attachmentId: true } }) : [];
    const evidence = (await loadExpenseEvidenceSources(db, companyId, [r], scopes)).get(id)!;
    const payments = paymentRows.map((payment: any) => {
      const paymentJournal = journals.find((entry) => entry.sourceType === 'expense.payment' && entry.sourceId === payment.id);
      const certificateProofIds = evidence.certificates.find(certificate => payment.idempotencyKey === `substitute-receipt:${certificate.id}`)?.paymentEvidenceAttachmentIds;
      return mapPayment({
        ...payment,
        slipAttachmentId: paymentSlips.find(link => link.targetId === payment.id)?.attachmentId
          ?? (Array.isArray(certificateProofIds) ? certificateProofIds.find(attachmentId => typeof attachmentId === 'string' && evidence.attachments.some(file => file.id === attachmentId)) : null) ?? null,
        journalEntryId: paymentJournal?.id ?? payment.journalEntryId,
        journalEntryNumber: paymentJournal?.entryNumber ?? null,
      });
    });
    const attachments = evidence.attachments;
    const reimbursementProgress = (await loadExpenseReimbursementProgress(db, companyId, [r], scopes)).get(id);
    const duplicateCandidates: DuplicateCandidateSummary[] = (r as any).duplicateCandidates.map((d: any) => ({
      id: d.id,
      candidateExpenseId: d.candidateExpenseId,
      candidateExpenseNumber: d.candidateExpense?.expenseNumber ?? null,
      candidateVendorName: d.candidateExpense?.vendorNameSnapshot || null,
      candidateExpenseDate: d.candidateExpense?.expenseDate?.toISOString() ?? null,
      candidateGrandTotalAmount: d.candidateExpense ? String(d.candidateExpense.grandTotalAmount) : null,
      reasonCodesJson: (d.reasonCodesJson as string[]) ?? [],
      score: d.score,
      status: d.status,
      resolvedAt: d.resolvedAt?.toISOString() ?? null,
      resolutionReason: d.resolutionReason ?? null,
    }));
    const visibleDuplicateOfExpenseId = duplicateCandidates.some(
      (candidate) => candidate.status === 'CONFIRMED_DUPLICATE'
        && candidate.candidateExpenseId === base.duplicateOfExpenseId,
    )
      ? base.duplicateOfExpenseId
      : null;
    const substituteRow = await db.expenseSubstituteReceiptEvidence.findFirst({
      where: { companyId, expenseId: id, status: { not: 'SUPERSEDED' } },
      orderBy: { version: 'desc' },
    });
    const mappedLines = (r as any).lines.map(mapLine);
    return {
      ...base,
      categoryDefaultInputTaxCode,
      reimbursementProgress,
      duplicateOfExpenseId: visibleDuplicateOfExpenseId,
      journalEntryId: journal?.id ?? null,
      journalEntryNumber: journal?.entryNumber ?? null,
      pendingPostingSourceType: pendingSource?.sourceType ?? null,
      pendingPostingSourceId: pendingSource?.sourceId ?? null,
      lines: mappedLines,
      charges: expenseLineCharges(mappedLines),
      totalsIdentity: expenseTotalsIdentity({ vatMode: base.vatMode, totals: base, lines: mappedLines }),
      attachments,
      sourceEvidenceUnavailable: evidence.sourceEvidenceUnavailable,
      categoryName: r.expenseCategory?.name ?? null,
      duplicateCandidates,
      substituteReceiptEvidence: substituteRow ? toSubstituteEvidenceSummary(mapSubstituteEvidence(substituteRow)) : null,
      payments,
      captureGroup: captureLineage(base),
      buyerAsPrinted: readBuyerAsPrinted(base.buyerAsPrintedJson),
    };
  }

  async isUserRelatedToExpense(
    companyId: string,
    expenseId: string,
    userId: string,
    scopes: { branchIds?: string[] } = {},
  ): Promise<boolean> {
    const row = await this.prisma.client.expenseRecord.findFirst({
      where: {
        companyId,
        id: expenseId,
        ...branchScopeWhere(scopes),
        AND: [expenseRelatedToUserWhere(userId)],
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  async findByLineMessageId(companyId: string, lineMessageId: string): Promise<ExpenseRecord | null> {
    const r = await this.prisma.client.expenseRecord.findFirst({ where: { companyId, lineMessageId } });
    return r ? mapExpense(r) : null;
  }

  private async inputVatDecisionNames(records: Array<{ id: string; inputVatDecisions?: Array<{ reason: string | null; decidedByUserId: string; decidedAt: Date }> }>) {
    const ids = [...new Set(records.flatMap(row => row.inputVatDecisions?.map(d => d.decidedByUserId) ?? []))];
    const users = ids.length ? await this.prisma.client.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }) : [];
    const names = new Map(users.map(user => [user.id, user.displayName]));
    return new Map(records.flatMap(row => {
      const latest = row.inputVatDecisions?.[0];
      return latest ? [[row.id, { reason: latest.reason, decidedByName: names.get(latest.decidedByUserId) ?? 'ผู้ตรวจ', decidedAt: latest.decidedAt.toISOString() }] as const] : [];
    }));
  }

  async listExpenses(
    filter: ListExpensesFilter,
    scopes?: { branchIds?: string[] },
    relatedUserId?: string,
    sourceDraftsOnly = false,
  ): Promise<PaginatedExpenses> {
    const { companyId, page = 1, pageSize = 20, ...rest } = filter;
    const skip = (page - 1) * pageSize;
    // 10D branch ABAC: restricted scope sees its branches plus company-central (null) rows.
    // Explicit branchId filter (already scope-asserted by the use-case) is narrower and wins.
    const scopeWhere = expenseReadScopeWhere({ companyId, ...rest }, scopes, relatedUserId);
    // GAP-11 `vendorAddressMissing` is one named filter, not two: it is spread after
    // `sourceDocumentType` so it pins TAX_INVOICE itself — only a full tax invoice has to carry a
    // seller address, so combining it with another document type would answer an empty question.
    const where: any = { ...scopeWhere, ...(rest.status && { status: rest.status }), ...(rest.paymentStatus && { paymentStatus: rest.paymentStatus }), ...(rest.duplicateStatus && { duplicateStatus: rest.duplicateStatus }), ...(rest.postingStatus && { postingStatus: rest.postingStatus }), ...(rest.vendorCounterpartyId && { vendorCounterpartyId: rest.vendorCounterpartyId }), ...(rest.captureSource && { captureSource: rest.captureSource }), ...(rest.sourceDocumentType && { sourceDocumentType: rest.sourceDocumentType }), ...(rest.vendorAddressMissing && { vendorAddressSnapshot: null, sourceDocumentType: 'TAX_INVOICE' }), ...(rest.taxEvidenceStatus && { taxEvidenceStatus: rest.taxEvidenceStatus }), ...(rest.expenseCategoryId && { expenseCategoryId: rest.expenseCategoryId }), ...(rest.fromDate || rest.toDate ? { AND: [scopeWhere, documentDateWhere(rest.fromDate, rest.toDate)] } : {}), ...(rest.uploadedFromDate || rest.uploadedToDate ? { uploadedAt: bangkokCivilDayRangeToUtc(rest.uploadedFromDate, rest.uploadedToDate) } : {}) };
    if (sourceDraftsOnly) {
      where.AND = [...(where.AND ?? []), { status: { in: ['DRAFT', 'NEEDS_REVIEW'] }, captureSource: { in: ['WEB_UPLOAD', 'LINE_UPLOAD'] } }];
    }
    const uploadDateLens = (rest.uploadedFromDate || rest.uploadedToDate) && !(rest.fromDate || rest.toDate);
    const orderBy = [uploadDateLens ? { uploadedAt: 'desc' as const } : { expenseDate: 'desc' as const }, { id: 'desc' as const }];
    const [data, total] = await Promise.all([
      this.prisma.client.expenseRecord.findMany({ where, skip, take: pageSize, orderBy, include: { _count: { select: { substituteReceiptEvidences: true, payments: true, disbursementVoucherLines: true } }, inputVatDecisions: { take: 1, orderBy: { decidedAt: 'desc' }, select: { reason: true, decidedByUserId: true, decidedAt: true } } } }),
      this.prisma.client.expenseRecord.count({ where }),
    ]);
    const decisionNames = await this.inputVatDecisionNames(data);
    const progress = await loadExpenseReimbursementProgress(this.prisma.client, companyId, data, scopes);
    const vatFacts = data.some(row => Number(row.vatAmount) > 0)
      ? (await this.prisma.client.companyVatRegistrationFact.findMany({ where: { companyId }, orderBy: [{ effectiveFrom: 'asc' }, { answeredAt: 'asc' }] }))
        .map(row => ({ ...row, effectiveFrom: utcDateToCivilDate(row.effectiveFrom), effectiveTo: row.effectiveTo ? utcDateToCivilDate(row.effectiveTo) : null }))
      : [];
    const visibleRights = new Map(await Promise.all(data.map(async row => [row.id,
      Number(row.vatAmount) > 0 && await registrationOnDocumentDate(this.prisma.client, row, vatFacts) !== 'NOT_REGISTERED',
    ] as const)));
    return { data: data.map(row => ({ ...mapExpense(row), inputVatRightVisible: visibleRights.get(row.id), latestInputVatDecision: decisionNames.get(row.id) ?? null, inputVatRecordedBeforeReview: inputVatRecordedBeforeReview(row, Boolean(row.inputVatDecisions?.length)), reimbursementProgress: progress.get(row.id) })), total, page, pageSize };
  }

  /** No list-page cap: group every readable unpaid expense, loading only the facts these readers need. */
  async readDisbursementPayableExpenses(filter: { companyId: string; branchId?: string; createdByUserId?: string }, scopes?: BranchScopes, relatedUserId?: string, permissions: string[] = []) {
    return this.readDisbursementExpenseSources({ ...filter, payableOnly: true }, scopes, relatedUserId, this.prisma.client, permissions);
  }

  async readDisbursementExpenseSources(filter: { companyId: string; branchId?: string; createdByUserId?: string; expenseIds?: string[]; payableOnly?: boolean }, scopes?: BranchScopes, relatedUserId?: string, db: ExpenseDb = this.prisma.client, permissions: string[] = []) {
    const expenses = await db.expenseRecord.findMany({
      where: { ...expenseReadScopeWhere(filter, scopes, relatedUserId), ...(filter.expenseIds ? { id: { in: filter.expenseIds } } : {}), ...(filter.payableOnly ? { status: 'CONFIRMED', outstandingAmount: { gt: 0 } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, branchId: true, expenseNumber: true, expenseDate: true, createdAt: true, status: true, currency: true,
        vendorNameSnapshot: true, vendorTaxIdSnapshot: true, vendorBranchCodeSnapshot: true, vendorAddressSnapshot: true, grandTotalAmount: true, whtAmount: true, netPayableAmount: true,
        outstandingAmount: true, sourceReimbursementRequestId: true, reservedByDisbursementVoucherId: true,
        vendorDocumentNumber: true, lines: { orderBy: { lineNumber: 'asc' }, take: 1, select: { description: true } },
        substituteReceiptEvidences: { orderBy: { version: 'desc' }, take: 1, select: { fundingSource: true } },
      },
    });
    if (!expenses.length) return [];
    const ids = expenses.map(e => e.id);
    const links = await db.attachmentLink.findMany({ where: { companyId: filter.companyId, targetType: 'expense.record', targetId: { in: ids } }, select: { targetId: true, attachmentId: true } });
    const [claims, reservations, branches] = await Promise.all([
      db.reimbursementLine.findMany({ where: expensePaymentClaimWhere(filter.companyId, ids, links.map(l => l.attachmentId)), select: { linkedExpenseId: true, attachmentId: true } }),
      readDisbursementReservations(db, filter.companyId, ids, { companyId: filter.companyId, createdByUserId: filter.createdByUserId, scopes: scopes ?? {}, relatedUserId, permissions }, expenses),
      db.branch.findMany({ where: { companyId: filter.companyId, id: { in: [...new Set(expenses.flatMap(e => e.branchId ? [e.branchId] : []))] } }, select: { id: true, name: true } }),
    ]);
    const claimedFiles = new Set(claims.flatMap(c => c.attachmentId ? [c.attachmentId] : []));
    const claimedExpenses = new Set([...claims.flatMap(c => c.linkedExpenseId ? [c.linkedExpenseId] : []), ...links.filter(l => claimedFiles.has(l.attachmentId)).map(l => l.targetId)]);
    return expenses.map(expense => ({ ...expense, branchName: branches.find(b => b.id === expense.branchId)?.name ?? null,
      recordPaymentBlocker: recordExpensePaymentBlocker(expense, claimedExpenses.has(expense.id), expense.substituteReceiptEvidences[0]?.fundingSource),
      reservation: reservations.has(expense.id) ? { voucherId: reservations.get(expense.id)!.canOpen ? reservations.get(expense.id)!.voucherId : null, documentNumber: reservations.get(expense.id)!.documentNumber, preparerName: reservations.get(expense.id)!.preparerName } : null,
    }));
  }

  /** The existing web/export report includes every status; one SQL aggregate keeps that population exact. */
  async readReportSummary(
    filter: { companyId: string; fromDate?: string; toDate?: string; branchId?: string; createdByUserId?: string },
    scope: AiExpenseReadScope,
  ) {
    const where: Prisma.ExpenseRecordWhereInput = {
      companyId: filter.companyId,
      ...(!filter.branchId ? branchScopeWhere({ branchIds: scope.branchIds }) : { branchId: filter.branchId }),
      ...(filter.createdByUserId ? { createdByUserId: filter.createdByUserId } : {}),
      ...(filter.fromDate || filter.toDate ? { expenseDate: civilDayRangeToUtc(filter.fromDate, filter.toDate) } : {}),
      ...(scope.relatedUserId ? { AND: [expenseRelatedToUserWhere(scope.relatedUserId)] } : {}),
    };
    const groups = await this.prisma.client.expenseRecord.groupBy({
      by: ['status', 'currency'], where, _count: { _all: true },
      _sum: { grandTotalAmount: true, paidAmount: true, outstandingAmount: true },
      orderBy: [{ status: 'asc' }, { currency: 'asc' }],
    });
    return groups.map(group => ({
      status: String(group.status), currency: group.currency, count: group._count._all,
      grandTotalAmount: new Decimal(String(group._sum.grandTotalAmount ?? 0)).toFixed(4),
      paidAmount: new Decimal(String(group._sum.paidAmount ?? 0)).toFixed(4),
      outstandingAmount: new Decimal(String(group._sum.outstandingAmount ?? 0)).toFixed(4),
    }));
  }

  private aiExpenseWhere(filter: AiExpenseReadFilter, scope: AiExpenseReadScope): Prisma.ExpenseRecordWhereInput {
    const explicitStatus = filter.status;
    return {
      companyId: filter.companyId,
      ...(!filter.branchId ? branchScopeWhere({ branchIds: scope.branchIds }) : {}),
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(explicitStatus ? { status: explicitStatus } : { status: { notIn: ['REJECTED', 'VOIDED'] } }),
      ...(filter.paymentStatus ? { paymentStatus: filter.paymentStatus } : {}),
      ...(filter.vendorCounterpartyId ? { vendorCounterpartyId: filter.vendorCounterpartyId } : {}),
      ...(filter.expenseCategoryId ? { expenseCategoryId: filter.expenseCategoryId } : {}),
      ...(filter.createdByUserId ? { createdByUserId: filter.createdByUserId } : {}),
      expenseDate: civilDayRangeToUtc(filter.fromDate, filter.toDate),
      ...(scope.relatedUserId ? { AND: [expenseRelatedToUserWhere(scope.relatedUserId)] } : {}),
    };
  }

  /** One repeatable-read snapshot for list rows, counts, and every exact Decimal aggregate. */
  async readAiExpenseSummary(
    filter: AiExpenseReadFilter,
    scope: AiExpenseReadScope,
    limit: number,
    cursor?: { expenseDate: Date; id: string },
  ): Promise<{
    asOf: Date;
    total: number;
    byCurrency: Array<{ currency: string; count: number; totalAmount: string; paidAmount: string; outstandingAmount: string }>;
    byStatus: Array<{ status: string; currency: string; count: number; totalAmount: string }>;
    items: Array<{
      id: string; expenseNumber: string | null; expenseDate: Date; vendorNameSnapshot: string | null;
      vendorDocumentNumber: string | null; status: string; paymentStatus: string;
      currency: string; grandTotalAmount: string; paidAmount: string; outstandingAmount: string;
    }>;
    hasMore: boolean;
    nextCursorSource: { expenseDate: Date; id: string } | null;
  }> {
    const where = this.aiExpenseWhere(filter, scope);
    const rowWhere: Prisma.ExpenseRecordWhereInput = cursor ? {
      AND: [where, { OR: [
        { expenseDate: { lt: cursor.expenseDate } },
        { expenseDate: cursor.expenseDate, id: { lt: cursor.id } },
      ] }],
    } : where;
    return this.prisma.client.$transaction(async (tx) => {
      const stamp = await tx.$queryRaw<Array<{ asOf: Date }>>`SELECT transaction_timestamp() AS "asOf"`;
      const [currencyGroups, statusGroups, rows, company] = await Promise.all([
        tx.expenseRecord.groupBy({
          by: ['currency'], where, _count: { _all: true },
          _sum: { grandTotalAmount: true, paidAmount: true, outstandingAmount: true },
        }),
        tx.expenseRecord.groupBy({
          by: ['status', 'currency'], where, _count: { _all: true }, _sum: { grandTotalAmount: true },
        }),
        tx.expenseRecord.findMany({
          where: rowWhere, take: limit + 1, orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }],
          select: {
            id: true, expenseNumber: true, expenseDate: true, vendorNameSnapshot: true,
            vendorDocumentNumber: true, status: true, paymentStatus: true, currency: true,
            grandTotalAmount: true, paidAmount: true, outstandingAmount: true,
          },
        }),
        tx.company.findUnique({ where: { id: filter.companyId }, select: { baseCurrency: true } }),
      ]);
      const byCurrency = currencyGroups.length > 0 ? currencyGroups.map((group) => ({
        currency: group.currency,
        count: group._count._all,
        totalAmount: expenseDecimalToString(group._sum.grandTotalAmount),
        paidAmount: expenseDecimalToString(group._sum.paidAmount),
        outstandingAmount: expenseDecimalToString(group._sum.outstandingAmount),
      })) : [{
        currency: company?.baseCurrency ?? 'THB', count: 0,
        totalAmount: '0', paidAmount: '0', outstandingAmount: '0',
      }];
      return {
        asOf: stamp[0]?.asOf ?? new Date(),
        total: currencyGroups.reduce((sum, group) => sum + group._count._all, 0),
        byCurrency,
        byStatus: statusGroups.map((group) => ({
          status: group.status,
          currency: group.currency,
          count: group._count._all,
          totalAmount: expenseDecimalToString(group._sum.grandTotalAmount),
        })),
        items: rows.slice(0, limit).map((row) => ({
          ...row,
          status: String(row.status), paymentStatus: String(row.paymentStatus),
          grandTotalAmount: expenseDecimalToString(row.grandTotalAmount),
          paidAmount: expenseDecimalToString(row.paidAmount),
          outstandingAmount: expenseDecimalToString(row.outstandingAmount),
        })),
        hasMore: rows.length > limit,
        nextCursorSource: rows.length > limit && rows[limit - 1]
          ? { expenseDate: rows[limit - 1]!.expenseDate, id: rows[limit - 1]!.id }
          : null,
      };
    }, { isolationLevel: 'RepeatableRead', maxWait: 1_000, timeout: 5_000 });
  }

  /** Exact aggregate population is independent from the bounded category/branch/vendor display
   *  groups. Vendor is capped at 10, not `groupLimit` (spec §3 row 5): it feeds a ranked "top
   *  vendor" answer, not the fuller category/branch breakdown.
   *
   *  Vendor grouping merges TWO different "no linked counterparty" populations that a plain
   *  `vendorCounterpartyId`-only group can't tell apart: a reimbursement projection (vendor
   *  `เบิกคืนพนักงาน: <employee>`, never auto-linked — CON-4) and an older expense that only ever
   *  captured `vendorNameSnapshot`. Both HAVE a real vendor name; only a row with neither an id nor
   *  a snapshot is genuinely "ไม่ระบุร้าน". The raw groupBy therefore also splits on
   *  `vendorNameSnapshot`, over-fetches (`vendorFetchLimit`) because that column is far less
   *  bounded than a real counterparty catalog, and `mergeVendorBreakdownGroups` — id wins as the
   *  key when present, so every snapshot variant of one linked vendor collapses back into its
   *  canonical name — runs in code before the top-10 ranking, which is computed AFTER merging. */
  async readAiExpenseBreakdown(
    filter: AiExpenseReadFilter,
    scope: AiExpenseReadScope,
    groupLimit = 25,
  ): Promise<{
    asOf: Date;
    byCurrency: Array<{ currency: string; count: number; totalAmount: string }>;
    byCategory: Array<{ expenseCategoryId: string | null; currency: string; count: number; totalAmount: string; label: string | null }>;
    byBranch: Array<{ branchId: string | null; currency: string; count: number; totalAmount: string; label: string | null }>;
    byVendor: Array<{ vendorCounterpartyId: string | null; currency: string; count: number; totalAmount: string; label: string | null; linked: boolean }>;
    categoryHasMore: boolean;
    branchHasMore: boolean;
    vendorHasMore: boolean;
  }> {
    const where = this.aiExpenseWhere(filter, scope);
    const vendorGroupLimit = 10;
    const vendorFetchLimit = 500;
    return this.prisma.client.$transaction(async (tx) => {
      const stamp = await tx.$queryRaw<Array<{ asOf: Date }>>`SELECT transaction_timestamp() AS "asOf"`;
      const [totals, categoryGroups, branchGroups, vendorRawGroups, company] = await Promise.all([
        tx.expenseRecord.groupBy({ by: ['currency'], where, _count: { _all: true }, _sum: { grandTotalAmount: true } }),
        tx.expenseRecord.groupBy({
          by: ['expenseCategoryId', 'currency'], where, _count: { _all: true }, _sum: { grandTotalAmount: true },
          orderBy: [{ _sum: { grandTotalAmount: 'desc' } }, { expenseCategoryId: 'asc' }, { currency: 'asc' }], take: groupLimit + 1,
        }),
        tx.expenseRecord.groupBy({
          by: ['branchId', 'currency'], where, _count: { _all: true }, _sum: { grandTotalAmount: true },
          orderBy: [{ _sum: { grandTotalAmount: 'desc' } }, { branchId: 'asc' }, { currency: 'asc' }], take: groupLimit + 1,
        }),
        tx.expenseRecord.groupBy({
          by: ['vendorCounterpartyId', 'vendorNameSnapshot', 'currency'], where, _count: { _all: true }, _sum: { grandTotalAmount: true },
          orderBy: [{ _sum: { grandTotalAmount: 'desc' } }, { vendorCounterpartyId: 'asc' }, { vendorNameSnapshot: 'asc' }, { currency: 'asc' }],
          take: vendorFetchLimit + 1,
        }),
        tx.company.findUnique({ where: { id: filter.companyId }, select: { baseCurrency: true } }),
      ]);
      const categoryPage = categoryGroups.slice(0, groupLimit);
      const branchPage = branchGroups.slice(0, groupLimit);
      const { vendorPage, vendorHasMore } = mergeVendorBreakdownGroups(
        vendorRawGroups.map((row) => ({
          vendorCounterpartyId: row.vendorCounterpartyId, vendorNameSnapshot: row.vendorNameSnapshot,
          currency: row.currency, count: row._count._all, totalAmount: expenseDecimalToString(row._sum.grandTotalAmount),
        })),
        vendorFetchLimit, vendorGroupLimit,
      );

      const [categories, branches, vendors] = await Promise.all([
        tx.expenseCategory.findMany({
          where: { companyId: filter.companyId, id: { in: categoryPage.map((group) => group.expenseCategoryId).filter((id): id is string => Boolean(id)) } },
          select: { id: true, name: true },
        }),
        tx.branch.findMany({
          where: { companyId: filter.companyId, id: { in: branchPage.map((group) => group.branchId).filter((id): id is string => Boolean(id)) } },
          select: { id: true, name: true },
        }),
        tx.accountingCounterparty.findMany({
          where: { companyId: filter.companyId, id: { in: vendorPage.map((group) => group.vendorCounterpartyId).filter((id): id is string => Boolean(id)) } },
          select: { id: true, displayName: true },
        }),
      ]);
      const categoryNames = new Map(categories.map((row) => [row.id, row.name]));
      const branchNames = new Map(branches.map((row) => [row.id, row.name]));
      const vendorNames = new Map(vendors.map((row) => [row.id, row.displayName]));
      return {
        asOf: stamp[0]?.asOf ?? new Date(),
        byCurrency: totals.length > 0 ? totals.map((group) => ({
          currency: group.currency, count: group._count._all,
          totalAmount: expenseDecimalToString(group._sum.grandTotalAmount),
        })) : [{ currency: company?.baseCurrency ?? 'THB', count: 0, totalAmount: '0' }],
        byCategory: categoryPage.map((group) => ({
          expenseCategoryId: group.expenseCategoryId, currency: group.currency, count: group._count._all,
          totalAmount: expenseDecimalToString(group._sum.grandTotalAmount),
          label: group.expenseCategoryId ? categoryNames.get(group.expenseCategoryId) ?? null : null,
        })),
        byBranch: branchPage.map((group) => ({
          branchId: group.branchId, currency: group.currency, count: group._count._all,
          totalAmount: expenseDecimalToString(group._sum.grandTotalAmount),
          label: group.branchId ? branchNames.get(group.branchId) ?? null : null,
        })),
        byVendor: vendorPage.map((group) => ({
          vendorCounterpartyId: group.vendorCounterpartyId, currency: group.currency, count: group.count,
          totalAmount: group.totalAmount,
          label: group.vendorCounterpartyId ? vendorNames.get(group.vendorCounterpartyId) ?? null : group.snapshotLabel,
          linked: group.vendorCounterpartyId !== null,
        })),
        categoryHasMore: categoryGroups.length > groupLimit,
        branchHasMore: branchGroups.length > groupLimit,
        vendorHasMore,
      };
    }, { isolationLevel: 'RepeatableRead', maxWait: 1_000, timeout: 5_000 });
  }

  /** Vendor name/id candidates for `vendorName` resolution (spec §3 row 6) — vendors that appear on
   *  expenses THIS caller can read, never the company's full vendor list: a `read_own` caller must
   *  not learn a vendor name from someone else's expense. Deliberately not `aiExpenseWhere`:
   *  candidates ignore the requested date range and value filters, so a vendor asked about outside
   *  the current period still resolves instead of reading as "not found". */
  async readAiVendorCandidates(
    filter: { companyId: string; branchId?: string; createdByUserId?: string },
    scope: AiExpenseReadScope,
  ): Promise<Array<{ id: string; name: string }>> {
    const where: Prisma.ExpenseRecordWhereInput = {
      companyId: filter.companyId,
      ...(!filter.branchId ? branchScopeWhere({ branchIds: scope.branchIds }) : { branchId: filter.branchId }),
      status: { notIn: ['REJECTED', 'VOIDED'] },
      ...(filter.createdByUserId ? { createdByUserId: filter.createdByUserId } : {}),
      ...(scope.relatedUserId ? { AND: [expenseRelatedToUserWhere(scope.relatedUserId)] } : {}),
    };
    const rows = await this.prisma.client.expenseRecord.groupBy({ by: ['vendorCounterpartyId'], where });
    const ids = rows.map((row) => row.vendorCounterpartyId).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return [];
    const vendors = await this.prisma.client.accountingCounterparty.findMany({
      where: { companyId: filter.companyId, id: { in: ids } },
      select: { id: true, displayName: true },
    });
    return vendors.map((row) => ({ id: row.id, name: row.displayName }));
  }

  /** One selected, cursor-pageable grouping; its aggregate population is never limited by the group page. */
  async readAiExpenseGroups(
    filter: AiExpenseReadFilter,
    scope: AiExpenseReadScope,
    groupBy: AiExpenseGroupBy,
    limit: number,
    offset: number,
  ): Promise<{
    asOf: Date;
    byCurrency: Array<{ currency: string; count: number; totalAmount: string }>;
    groups: Array<{ key: string | null; label: string | null; currency: string; count: number; totalAmount: string }>;
    hasMore: boolean;
  }> {
    const where = this.aiExpenseWhere(filter, scope);
    return this.prisma.client.$transaction(async (tx) => {
      const stamp = await tx.$queryRaw<Array<{ asOf: Date }>>`SELECT transaction_timestamp() AS "asOf"`;
      const groupQuery = groupBy === 'category'
        ? tx.expenseRecord.groupBy({
          by: ['expenseCategoryId', 'currency'], where, _count: { _all: true }, _sum: { grandTotalAmount: true },
          orderBy: [{ _sum: { grandTotalAmount: 'desc' } }, { expenseCategoryId: 'asc' }, { currency: 'asc' }],
          skip: offset, take: limit + 1,
        })
        : groupBy === 'vendor'
          ? tx.expenseRecord.groupBy({
            by: ['vendorCounterpartyId', 'currency'], where, _count: { _all: true }, _sum: { grandTotalAmount: true },
            orderBy: [{ _sum: { grandTotalAmount: 'desc' } }, { vendorCounterpartyId: 'asc' }, { currency: 'asc' }],
            skip: offset, take: limit + 1,
          })
          : tx.expenseRecord.groupBy({
            by: ['expenseDate', 'currency'], where, _count: { _all: true }, _sum: { grandTotalAmount: true },
            orderBy: [{ _sum: { grandTotalAmount: 'desc' } }, { expenseDate: 'asc' }, { currency: 'asc' }],
            skip: offset, take: limit + 1,
          });
      const [totals, rawGroups] = await Promise.all([
        tx.expenseRecord.groupBy({ by: ['currency'], where, _count: { _all: true }, _sum: { grandTotalAmount: true } }),
        groupQuery,
      ]);
      const page = (rawGroups as any[]).slice(0, limit);
      let labels = new Map<string, string>();
      if (groupBy === 'category') {
        const rows = await tx.expenseCategory.findMany({
          where: { companyId: filter.companyId, id: { in: page.map((row) => row.expenseCategoryId).filter(Boolean) } },
          select: { id: true, name: true },
        });
        labels = new Map(rows.map((row) => [row.id, row.name]));
      } else if (groupBy === 'vendor') {
        const rows = await tx.accountingCounterparty.findMany({
          where: { companyId: filter.companyId, id: { in: page.map((row) => row.vendorCounterpartyId).filter(Boolean) } },
          select: { id: true, displayName: true },
        });
        labels = new Map(rows.map((row) => [row.id, row.displayName]));
      }
      const company = totals.length === 0
        ? await tx.company.findUnique({ where: { id: filter.companyId }, select: { baseCurrency: true } })
        : null;
      return {
        asOf: stamp[0]?.asOf ?? new Date(),
        byCurrency: totals.length > 0 ? totals.map((row) => ({
          currency: row.currency, count: row._count._all,
          totalAmount: expenseDecimalToString(row._sum.grandTotalAmount),
        })) : [{ currency: company?.baseCurrency ?? 'THB', count: 0, totalAmount: '0' }],
        groups: page.map((row) => {
          const rawKey = groupBy === 'category' ? row.expenseCategoryId
            : groupBy === 'vendor' ? row.vendorCounterpartyId
              : row.expenseDate?.toISOString().slice(0, 10);
          const key = typeof rawKey === 'string' ? rawKey : null;
          return {
            key,
            label: groupBy === 'day' ? key : key ? labels.get(key) ?? null : null,
            currency: row.currency, count: row._count._all,
            totalAmount: expenseDecimalToString(row._sum.grandTotalAmount),
          };
        }),
        hasMore: (rawGroups as any[]).length > limit,
      };
    }, { isolationLevel: 'RepeatableRead', maxWait: 1_000, timeout: 5_000 });
  }

  async listSubstituteReceiptCandidateSources(scope: Prisma.ExpenseRecordWhereInput & { search?: string }, branches: BranchScopes) {
    const { search, ...where } = scope;
    const rows = await this.prisma.client.expenseRecord.findMany({
      where: { status: { notIn: ['REJECTED', 'VOIDED'] }, AND: [where,
        ...(search ? [{ OR: [{ expenseNumber: { contains: search, mode: 'insensitive' as const } },
          { vendorNameSnapshot: { contains: search, mode: 'insensitive' as const } }, { lines: { some: { description: { contains: search, mode: 'insensitive' as const } } } }] }] : [])] },
      include: { lines: { orderBy: { lineNumber: 'asc' } }, substituteReceiptEvidences: { where: { status: { not: 'SUPERSEDED' } }, orderBy: { version: 'desc' }, take: 1 } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const evidence = await loadExpenseEvidenceSources(this.prisma.client, where.companyId as string, rows, branches);
    return rows.map((row): ExpenseRecordWithRelations => {
      const base = mapExpense(row);
      const lines = row.lines.map(mapLine);
      return { ...base, lines, charges: expenseLineCharges(lines), totalsIdentity: expenseTotalsIdentity({ vatMode: base.vatMode, totals: base, lines }),
        attachments: evidence.get(row.id)?.attachments ?? [], payments: [], duplicateCandidates: [],
        substituteReceiptEvidence: row.substituteReceiptEvidences[0] ? toSubstituteEvidenceSummary(mapSubstituteEvidence(row.substituteReceiptEvidences[0])) : null };
    });
  }

  async listCompanySubstituteReceipts(
    companyId: string,
    filter: SubstituteReceiptListFilter,
    scope: { branchIds?: string[]; onlyPayerUserId: string | null; relatedUserId?: string | null; createdByUserId?: string; userId?: string; canApprove?: boolean; canSelfApprove?: boolean },
  ) {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 50;
    let monthRange: { gte: Date; lt: Date } | null = null;
    // Same shape and same guard as listSharedEvidence: an unvalidated yearMonth reaches Date.UTC as
    // NaN and Prisma rejects the Invalid Date with a 500 instead of ignoring an unusable filter.
    if (filter.yearMonth && /^\d{4}-\d{2}$/.test(filter.yearMonth)) {
      const [year, month] = filter.yearMonth.split('-').map(Number);
      monthRange = {
        gte: new Date(Date.UTC(year!, month! - 1, 1)),
        lt: new Date(Date.UTC(year!, month!, 1)),
      };
    }
    const predicates: Prisma.ExpenseSubstituteReceiptEvidenceWhereInput[] = [];
    const branchWhere = branchScopeWhere({ branchIds: scope.branchIds });
    if (Object.keys(branchWhere).length > 0) predicates.push(branchWhere);
    if (scope.createdByUserId) predicates.push({ expense: { is: expenseReadScopeWhere({ companyId, createdByUserId: scope.createdByUserId }, { branchIds: scope.branchIds }) } });
    if (scope.relatedUserId) {
      predicates.push({
        OR: [
          { preparedByUserId: scope.relatedUserId },
          { payerUserId: scope.relatedUserId },
          { approverUserId: scope.relatedUserId },
          { issuedByUserId: scope.relatedUserId },
          { expense: { is: expenseRelatedToUserWhere(scope.relatedUserId) } },
        ],
      });
    }
    if (monthRange) {
      predicates.push({
        OR: [
          { paymentDate: monthRange },
          { paymentDate: null, expense: { expenseDate: monthRange } },
        ],
      });
    }
    const where: Prisma.ExpenseSubstituteReceiptEvidenceWhereInput = {
      companyId,
      ...(scope.onlyPayerUserId
        ? { payerUserId: scope.onlyPayerUserId }
        : filter.payerUserId ? { payerUserId: filter.payerUserId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(predicates.length > 0 ? { AND: predicates } : {}),
    };
    // One scoped population drives tab counts, exact money, attention and date paging.
    const sqlPredicates = [Prisma.sql`r."companyId" = ${companyId}`, Prisma.sql`e."companyId" = ${companyId}`];
    const branchSql = (column: Prisma.Sql) => scope.branchIds?.length
      ? Prisma.sql`(${column} IS NULL OR ${column} IN (${Prisma.join(scope.branchIds)}))`
      : Prisma.sql`${column} IS NULL`;
    if (scope.branchIds) sqlPredicates.push(branchSql(Prisma.sql`r."branchId"`));
    if (scope.createdByUserId) {
      sqlPredicates.push(Prisma.sql`e."createdByUserId" = ${scope.createdByUserId}`);
      if (scope.branchIds) sqlPredicates.push(branchSql(Prisma.sql`e."branchId"`));
    }
    const payerId = scope.onlyPayerUserId || filter.payerUserId;
    if (payerId) sqlPredicates.push(Prisma.sql`r."payerUserId" = ${payerId}`);
    if (monthRange) sqlPredicates.push(Prisma.sql`COALESCE(r."paymentDate", e."expenseDate") >= ${monthRange.gte}
      AND COALESCE(r."paymentDate", e."expenseDate") < ${monthRange.lt}`);
    const direction = filter.order === 'oldest' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    return this.prisma.client.$transaction(async tx => {
      // Preserve the legacy optional related-reader predicate through its existing Prisma helper.
      // The preparation hub normally supplies creator scope instead.
      if (scope.relatedUserId) {
        const related = await tx.expenseSubstituteReceiptEvidence.findMany({ where: { ...where, status: undefined }, select: { id: true } });
        sqlPredicates.push(related.length ? Prisma.sql`r.id IN (${Prisma.join(related.map(row => row.id))})` : Prisma.sql`FALSE`);
      }
      const population = Prisma.sql`FROM "ExpenseSubstituteReceiptEvidence" r JOIN "ExpenseRecord" e ON e.id = r."expenseId"
        WHERE ${Prisma.join(sqlPredicates, ' AND ')}`;
      const signature = Prisma.sql`r.status = 'PREPARED' AND r."payerUserId" = ${scope.userId ?? null}`;
      const approval = Prisma.sql`${scope.canApprove === true} AND (r.status = 'PAYER_CERTIFIED' OR (r.status = 'PREPARED'
        AND r."paperSubmissionJson" IS NOT NULL AND r."paperSubmissionJson" <> 'null'::jsonb))
        AND (${scope.canSelfApprove === true} OR r."payerUserId" IS DISTINCT FROM ${scope.userId ?? null})`;
      const groups = await tx.$queryRaw<Array<{ status: 'PREPARED' | 'PAYER_CERTIFIED' | 'ISSUED' | 'SUPERSEDED'; count: number; total: string;
        signatureCount: number; signatureId: string | null; approvalCount: number; approvalId: string | null }>>(Prisma.sql`
        SELECT r.status, COUNT(*)::int AS count, SUM(e."grandTotalAmount")::text AS total,
          COUNT(*) FILTER (WHERE ${signature})::int AS "signatureCount", MIN(r.id) FILTER (WHERE ${signature}) AS "signatureId",
          COUNT(*) FILTER (WHERE ${approval})::int AS "approvalCount", MIN(r.id) FILTER (WHERE ${approval}) AS "approvalId"
        ${population} GROUP BY r.status`);
      const selected = groups.filter(group => !filter.status || group.status === filter.status);
      const counts = { PREPARED: 0, PAYER_CERTIFIED: 0, ISSUED: 0, SUPERSEDED: 0 };
      for (const group of groups) counts[group.status] = group.count;
      const total = selected.reduce((sum, group) => sum + group.count, 0);
      const sums = { total: selected.reduce((sum, group) => sum.plus(group.total), new Decimal(0)).toFixed(2) };
      const attention = {
        signature: { count: selected.reduce((sum, group) => sum + group.signatureCount, 0), evidenceId: selected.find(group => group.signatureId)?.signatureId ?? null },
        approval: { count: selected.reduce((sum, group) => sum + group.approvalCount, 0), evidenceId: selected.find(group => group.approvalId)?.approvalId ?? null },
      };
      const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT r.id ${population}
        ${filter.status ? Prisma.sql`AND r.status = ${filter.status}::"SubstituteReceiptEvidenceStatus"` : Prisma.empty}
        ORDER BY COALESCE(r."paymentDate", e."expenseDate") ${direction}, r."createdAt" ${direction}, r.id ${direction}
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
      const rows = await tx.expenseSubstituteReceiptEvidence.findMany({
        where: { ...where, id: { in: ids.map(row => row.id) } },
        select: {
          id: true,
          expenseId: true,
          documentNumber: true,
          version: true, fundingSource: true, signatureMode: true, paperSubmissionJson: true, paperReviewedByUserId: true, correctionOfEvidenceId: true,
          status: true,
          paymentDate: true,
          payeeName: true,
          payeeAddress: true,
          payeeTaxId: true,
          payerUserId: true,
          payerName: true,
          approverUserId: true,
          approverName: true,
          artifactAttachmentId: true,
          certifiedArtifactAttachmentId: true,
          updatedAt: true,
          expense: {
            select: {
              status: true,
              expenseNumber: true,
              expenseDate: true,
              vendorNameSnapshot: true,
              currency: true,
              grandTotalAmount: true,
            },
          },
        },
      });
      const byId = new Map(rows.map(row => [row.id, row]));
      return { rows: ids.flatMap(({ id }) => { const row = byId.get(id); return row ? [row] : []; }), total, counts, sums, attention };
    });
  }

  /** Advisor S1 (spec §5.2): one step of the caller's OWN signature queue, counted in the database. PAYER is
   *  a digital receipt that names the caller as its payer; APPROVER is a payer-certified receipt, or a paper
   *  copy already submitted and waiting to be accepted. Reads only the listed fields — never the payee's tax
   *  id or address, a signature or a file. `branchIds` is the caller's own branch scope. */
  async listSubstituteReceiptsAwaitingSignature(companyId: string, filter: {
    step: 'PAYER' | 'APPROVER';
    userId: string;
    branchIds?: string[];
    /** APPROVER: leave out what the caller paid themselves, and paper copies one person signed twice. */
    excludeSelf?: boolean;
    /** APPROVER: corrections that only the approver of the corrected receipt may sign. */
    excludeEvidenceIds?: readonly string[];
  }, take: number) {
    const step: Prisma.ExpenseSubstituteReceiptEvidenceWhereInput = filter.step === 'PAYER'
      ? { status: 'PREPARED', payerUserId: filter.userId }
      : { OR: [
        // Every payer-certified row names its payer (payer_certified_check), so `not` drops no row.
        { status: 'PAYER_CERTIFIED', ...(filter.excludeSelf ? { payerUserId: { not: filter.userId } } : {}) },
        // Paper submission writes the scan id and the signer names together (submitSubstitutePaper).
        { status: 'PREPARED', signatureMode: 'PAPER', payerUserId: null, wetSignedScanAttachmentId: { not: null },
          ...(filter.excludeSelf ? { NOT: { paperSubmissionJson: { path: ['samePerson'], equals: true } } } : {}) },
      ] };
    const where: Prisma.ExpenseSubstituteReceiptEvidenceWhereInput = { companyId, AND: [
      branchScopeWhere({ branchIds: filter.branchIds }), step,
      ...(filter.excludeEvidenceIds?.length ? [{ id: { notIn: [...filter.excludeEvidenceIds] } }] : []),
    ] };
    const [rows, count, paperCount] = await this.prisma.client.$transaction([
      this.prisma.client.expenseSubstituteReceiptEvidence.findMany({
        where,
        select: {
          documentNumber: true, payeeName: true, status: true, preparedAt: true,
          expense: { select: { expenseDate: true, vendorNameSnapshot: true, currency: true, grandTotalAmount: true } },
        },
        orderBy: [{ preparedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
      this.prisma.client.expenseSubstituteReceiptEvidence.count({ where }),
      // APPROVER: the paper copies waiting to be accepted are the step's only PREPARED rows.
      this.prisma.client.expenseSubstituteReceiptEvidence.count({ where: { ...where, status: 'PREPARED' } }),
    ]);
    return { rows, count, paperCount: filter.step === 'APPROVER' ? paperCount : 0 };
  }

  /** Payer-certified corrections waiting for approval, each with the approver of the receipt it corrects —
   *  the only person ApproveSubstituteReceiptUseCase lets sign it. */
  async listPendingSubstituteCorrections(companyId: string, branchIds?: string[]): Promise<Array<{ id: string; originalApproverUserId: string | null }>> {
    const corrections = await this.prisma.client.expenseSubstituteReceiptEvidence.findMany({
      where: { companyId, status: 'PAYER_CERTIFIED', correctionOfEvidenceId: { not: null }, AND: [branchScopeWhere({ branchIds })] },
      select: { id: true, correctionOfEvidenceId: true },
    });
    if (corrections.length === 0) return [];
    const originals = await this.prisma.client.expenseSubstituteReceiptEvidence.findMany({
      where: { companyId, id: { in: corrections.map((row) => row.correctionOfEvidenceId!) } },
      select: { id: true, approverUserId: true },
    });
    const approverOf = new Map(originals.map((row) => [row.id, row.approverUserId]));
    return corrections.map((row) => ({ id: row.id, originalApproverUserId: approverOf.get(row.correctionOfEvidenceId!) ?? null }));
  }

  /** Run `work` on an injected transaction client when the caller owns one, otherwise open the
   *  method's own transaction. Nesting a `$transaction` inside a caller's transaction would open a
   *  SECOND connection that cannot roll back with it — and would block on this method's own
   *  advisory lock. Re-taking `pg_advisory_xact_lock` inside the caller's transaction is safe
   *  (same transaction, idempotent), so the lock discipline is unchanged either way. */
  private async runInTx<T>(db: any | undefined, work: (tx: any) => Promise<T>): Promise<T> {
    return db ? work(db) : (this.prisma.client as any).$transaction(work);
  }

  /**
   * `withinTx` runs inside this method's existing transaction, after the row is written. It is
   * the seam LINE intake uses to commit its consumption markers atomically with the mutation —
   * an after-commit append would leave the exact window the markers exist to close. Throwing
   * from it rolls the update back.
   */
  async updateExpense(input: UpdateExpenseRecordInput, withinTx?: (tx: any) => Promise<void>, db?: any): Promise<ExpenseRecord> {
    const { id, companyId, expectedUpdatedAt, refreshSubstituteEvidence, assignExpenseNumber, ...rest } = input;
    if (rest.branchId !== undefined) await assertActiveExpenseBranch(db ?? this.prisma.client, companyId, rest.branchId);
    // H-04: VOIDED is intentionally rejected here — voids must go through
    // voidExpenseTrueReversal so the GL reversal and status change stay atomic.
    if (rest.status === 'VOIDED') {
      throw new UnprocessableEntityException('Use voidExpenseTrueReversal for voids');
    }
    const data: any = {};
    const fields: Array<keyof typeof rest> = ['branchId', 'status', 'vendorCounterpartyId', 'vendorSnapshotJson', 'vendorNameSnapshot', 'vendorTaxIdSnapshot', 'vendorBranchCodeSnapshot', 'vendorAddressSnapshot', 'buyerAsPrintedJson', 'vendorEntityKindSnapshot', 'whtCategoryCode', 'whtRate', 'vendorDocumentNumber', 'expenseDate', 'receivedAt', 'dueDate', 'currency', 'vatMode', 'inputVatClaimStatus', 'expenseCategoryId', 'accountHintKey', 'taxCategory', 'duplicateStatus', 'duplicateOfExpenseId', 'duplicateOverrideReason', 'primaryAttachmentId', 'extractionId', 'aiVerificationStatus', 'aiVerifiedFieldsJson', 'aiVerificationSummaryJson', 'vatCaptureSnapshotJson', 'aiVerificationConfidence', 'aiVerifiedAt', 'lineMessageId', 'lineEventId', 'missingReceiptReason', 'postingStatus', 'postingError', 'note', 'internalMemo', 'updatedByUserId', 'updatedAt', 'reviewedByUserId', 'reviewedAt', 'confirmedByUserId', 'confirmedAt', 'rejectedByUserId', 'rejectedAt', 'rejectReason', 'voidedByUserId', 'voidedAt', 'voidReason', 'subtotalAmount', 'discountAmount', 'taxableAmount', 'vatAmount', 'whtAmount', 'grandTotalAmount', 'netPayableAmount', 'paidAmount', 'outstandingAmount', 'paymentStatus', 'paymentMethod', 'paidAt', 'bankAccountRef', 'expenseNumber', 'sourceDocumentType', 'sourceDocumentLanguage', 'taxEvidenceStatus', 'taxEvidenceReasonCode', 'substituteReceiptGeneratedAt', 'substituteReceiptGeneratedByUserId', 'sourceChannelMetadataJson'];
    fields.push('whtInputJson', 'requestedReviewerUserId', 'submittedByUserId', 'submittedAt');
    for (const f of fields) {
      if (rest[f] !== undefined) data[f] = rest[f];
    }
    return this.runInTx(db, async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`${companyId}:vat-registration`}))`;
      await lockExpenseFunding(tx, companyId, id);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${id}:substitute-receipt`}))`;
      if (rest.status === 'REJECTED') {
        await lockExpenseCorrection(tx, companyId, id);
        const current = await tx.expenseRecord.findFirst({ where: { id, companyId }, include: { payments: true } });
        if (current && (Number(current.paidAmount) > 0 || current.payments.some((p: any) => p.status === 'RECORDED'))) {
          const recorded = current.payments.some((p: any) => p.status === 'RECORDED');
          throw new ConflictException({ code: recorded ? 'expense_rejection_payments_recorded' : 'expense_rejection_paid_balance', message: expenseCorrectionBlockerMessage(recorded ? 'recorded_payments' : 'legacy_paid_balance') });
        }
        if (!current || validateStatusTransition(current.status, 'REJECTED')) throw new ConflictException('expense_correction_source_changed');
      }
      const beforeReview = refreshSubstituteEvidence ? await tx.expenseRecord.findFirst({ where: { id, companyId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } }) : null;
      const evidenceRouteChanged = data.aiVerificationSummaryJson !== undefined && beforeReview
        && expenseEvidenceAssessment(beforeReview)?.route !== expenseEvidenceAssessment({ ...beforeReview, ...data })?.route;
      if (evidenceRouteChanged || ['sourceDocumentType', 'vatMode', 'vatAmount', 'expenseDate', 'inputVatClaimStatus'].some(field => data[field] !== undefined)) {
        const vatSource = beforeReview ?? await tx.expenseRecord.findFirst({ where: { id, companyId } });
        if (vatSource) {
          const next = { ...vatSource, ...data, status: vatSource.status,
            sourceChannelMetadataJson: { ...vatSource.sourceChannelMetadataJson, ...data.sourceChannelMetadataJson } };
          const typeReset = await resetInputVatDecisionForType(tx, vatSource, next, { userId: rest.updatedByUserId ?? vatSource.createdByUserId, requestId: refreshSubstituteEvidence?.requestId });
          const restoringClaim = data.inputVatClaimStatus === 'CLAIMABLE' && vatSource.buyerAsPrintedJson?.claimStatusBeforeMark === 'CLAIMABLE';
          if (restoringClaim) await assertInputVatRestoreAllowed(tx, next);
          const preset = await applyExpenseInputVatPreset(tx, next);
          if (restoringClaim && preset.inputVatClaimStatus === 'NEEDS_REVIEW') preset.inputVatClaimStatus = 'CLAIMABLE';
          Object.assign(data, typeReset ?? preset);
          const buyerDecision = rest.inputVatClaimStatus !== undefined && rest.updatedByUserId
            && (vatSource.buyerAsPrintedJson?.matchStatus === 'MISMATCH' || vatSource.buyerAsPrintedJson?.claimStatusBeforeMark);
          if (buyerDecision && !typeReset) {
            await assertInputVatDecisionPeriodOpen(tx, vatSource);
            const toStatus = data.inputVatClaimStatus ?? next.inputVatClaimStatus;
            const facts = await inputVatDecisionFacts(tx, next);
            const previousClaim = buyerDecision && toStatus === 'CLAIMABLE'
              ? await tx.expenseInputVatDecision.findFirst({ where: { companyId, expenseId: id, toStatus: 'CLAIMABLE' }, orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }] }) : null;
            const restoredConditions = Array.isArray(previousClaim?.conditionsJson) ? previousClaim.conditionsJson : [];
            const conditions = toStatus === 'NEEDS_REVIEW' ? [{ code: 'BUYER_MARK_UNDONE', source: 'REVIEWER', answer: true, answeredByUserId: rest.updatedByUserId,
                fact: { buyerAsPrinted: next.buyerAsPrintedJson } }]
              : validateInputVatDecision(next, facts, { toStatus, reason: 'ชื่อหรือเลขผู้เสียภาษีของร้านบนใบไม่ตรง',
                reviewerConditions: restoredConditions.filter((c: any) => c.source === 'REVIEWER' && c.answer).map((c: any) => c.code),
                buyerConfirmed: restoredConditions.some((c: any) => c.code === 'BUYER_MATCH' && c.answer && c.source === 'REVIEWER') }, rest.updatedByUserId!);
            if (buyerDecision && toStatus === 'NEEDS_REVIEW' && inputVatFixedReason(next, facts.vatStatus))
              validateInputVatDecision(next, facts, { toStatus: 'NON_CLAIMABLE', reason: 'ชื่อหรือเลขผู้เสียภาษีของร้านบนใบไม่ตรง' }, rest.updatedByUserId!);
            const decision = await appendInputVatDecision(tx, vatSource, { toStatus,
              reason: 'ชื่อหรือเลขผู้เสียภาษีของร้านบนใบไม่ตรง', conditions,
              attachmentIds: facts.attachmentIds, userId: rest.updatedByUserId!, requestId: refreshSubstituteEvidence?.requestId });
            data.sourceChannelMetadataJson = { ...next.sourceChannelMetadataJson, ...data.sourceChannelMetadataJson, inputVatDecisionId: decision.id };
            if (toStatus === 'NEEDS_REVIEW') delete data.sourceChannelMetadataJson.inputVatDecisionId;
          }

        }
      }
      const whtSource = beforeReview ?? (['whtCategoryCode', 'whtRate', 'vendorEntityKindSnapshot'].some(field => data[field] !== undefined)
        ? await tx.expenseRecord.findFirst({ where: { id, companyId } }) : null);
      if (whtSource) {
        const whtCategoryCode = await matchingExpenseWhtCategory(tx, { ...whtSource, ...data });
        if (whtCategoryCode !== (data.whtCategoryCode ?? whtSource.whtCategoryCode)) data.whtCategoryCode = whtCategoryCode;
      }
      const nameSource = beforeReview ?? whtSource ?? (data.vendorNameSnapshot !== undefined ? await tx.expenseRecord.findFirst({ where: { id, companyId } }) : null);
      if (nameSource?.sourceChannelMetadataJson?.substituteReceiptPayeeName && data.vendorNameSnapshot !== undefined
        && data.vendorNameSnapshot !== nameSource.vendorNameSnapshot) {
        data.sourceChannelMetadataJson = { ...nameSource.sourceChannelMetadataJson, ...data.sourceChannelMetadataJson };
        delete data.sourceChannelMetadataJson.substituteReceiptPayeeName;
      }
      // `vendorEntityKindSnapshot` is deliberately NOT material. The payee taxpayer class is never
      // printed on the ใบรับรองแทนใบเสร็จ artifact (`substitute-receipt.logic.ts`), so locking it buys
      // no document integrity — and it deadlocks: confirming a substitute-reliant expense requires the
      // evidence already ISSUED (`expense-draft.use-case.ts:380`), while `validateConfirm` REQUIRES the
      // class whenever `whtAmount > 0` (`expense-status.logic.ts:199`). It must stay writable after
      // PAYER_CERTIFIED/ISSUED or such an expense can never be confirmed at all.
      const materialFields = new Set([
        'branchId', 'vendorCounterpartyId', 'vendorSnapshotJson', 'vendorNameSnapshot', 'vendorTaxIdSnapshot',
        // CON-11: the printed seller address is vendor identity like the three above it — same
        // funding/evidence lock, no exception of its own.
        'vendorBranchCodeSnapshot', 'vendorAddressSnapshot', 'vendorDocumentNumber', 'expenseDate', 'currency', 'vatMode',
        'inputVatClaimStatus', 'expenseCategoryId', 'accountHintKey', 'taxCategory', 'primaryAttachmentId',
        'vatCaptureSnapshotJson', 'whtInputJson',
        'missingReceiptReason', 'note', 'subtotalAmount', 'discountAmount', 'taxableAmount', 'vatAmount',
        'whtAmount', 'grandTotalAmount', 'netPayableAmount', 'paidAmount', 'outstandingAmount',
        'paymentStatus', 'paymentMethod', 'paidAt', 'bankAccountRef', 'sourceDocumentType',
        'sourceDocumentLanguage', 'taxEvidenceStatus', 'taxEvidenceReasonCode',
      ]);
      if (Object.keys(data).some((field) => materialFields.has(field))) {
        await assertFundingMutation(tx, companyId, id, 'supersede');
        const signedEvidence = await tx.expenseSubstituteReceiptEvidence.findFirst({
          where: { companyId, expenseId: id, status: { in: ['PAYER_CERTIFIED', 'ISSUED'] } },
          select: { id: true },
        });
        if (signedEvidence && !refreshSubstituteEvidence) throw new ConflictException({ code: 'substitute_evidence_locks_expense', message: 'Signed substitute evidence locks material expense data. Prepare a corrected version before changing it.' });
      }
      if (rest.inputVatClaimStatus === 'CLAIMABLE' || rest.taxEvidenceStatus === 'USABLE_FOR_TAX' || rest.sourceDocumentType !== undefined) {
        const internalEvidence = await tx.expenseSubstituteReceiptEvidence.findFirst({
          where: { companyId, expenseId: id, status: { in: ['PREPARED', 'PAYER_CERTIFIED', 'ISSUED'] } },
          select: { id: true, originalSourceDocumentType: true },
        });
        if (internalEvidence && (rest.inputVatClaimStatus === 'CLAIMABLE' || rest.taxEvidenceStatus === 'USABLE_FOR_TAX')) {
          throw new ConflictException({ code: 'substitute_evidence_nonclaimable', message: 'Internal substitute evidence cannot be made VAT-claimable or usable for tax.' });
        }
        if (internalEvidence && rest.sourceDocumentType !== undefined && rest.sourceDocumentType !== internalEvidence.originalSourceDocumentType) {
          throw new ConflictException({ code: 'substitute_evidence_doc_type_locked', message: 'The original source document type is locked while substitute evidence is active.' });
        }
      }
      if (rest.status === 'READY_FOR_CONFIRMATION' || rest.status === 'CONFIRMED') {
        const source = await tx.expenseRecord.findFirst({ where: { id, companyId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
        assertExpenseSourceDraftComplete(source?.sourceChannelMetadataJson as Record<string, unknown> | null,
          source ? { ...mapExpense(source), lines: (source.lines ?? []).map(mapLine) } : undefined);
      }
      // A receipt may be removed while OCR is running. Its late summary cannot restore evidence.
      const extractedAttachmentId = (rest.aiVerificationSummaryJson as Record<string, unknown> | undefined)?.extractionAttachmentId;
      if (typeof extractedAttachmentId === 'string') {
        const activeSource = await tx.attachmentLink.findFirst({ where: {
          companyId, targetType: 'expense.record', targetId: id, attachmentId: extractedAttachmentId,
          purpose: 'expense.receipt.primary', attachment: { companyId, status: 'ACTIVE' },
        }, select: { id: true } });
        if (!activeSource) throw new ConflictException({ code: 'EXPENSE_UPDATE_CONFLICT', message: 'Receipt changed while OCR was running.' });
      }
      const updated = await tx.expenseRecord.updateMany({
        where: { id, companyId, ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }) },
        data,
      });
      if (updated.count !== 1) {
        if (expectedUpdatedAt) {
          throw new ConflictException({
            code: 'EXPENSE_UPDATE_CONFLICT',
            message: 'Expense was changed by another user. Reload and review before saving again.',
          });
        }
        throw new Error(`Expense ${id} not found in company ${companyId}`);
      }
      if (rest.status === 'REJECTED') await retireExpenseTaxEvents(tx, companyId, id);
      const record = mapExpense(await tx.expenseRecord.findFirstOrThrow({ where: { id, companyId } }));
      if (refreshSubstituteEvidence) this.reviewRefreshTransactions.add(tx);
      try { await withinTx?.(tx); }
      finally { if (refreshSubstituteEvidence) this.reviewRefreshTransactions.delete(tx); }
      if (refreshSubstituteEvidence && beforeReview) {
        const afterReview = await tx.expenseRecord.findFirstOrThrow({ where: { id, companyId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
        const refreshed = await syncSubstituteAfterExpenseEdit(tx, beforeReview, afterReview, rest.updatedByUserId);
        if (refreshed) await new PrismaAuditRepository(this.prisma).log({ companyId, actorUserId: rest.updatedByUserId,
          action: 'expense.substitute_receipt.source_refreshed', targetType: 'expense_substitute_receipt', targetId: refreshed.evidenceId,
          requestId: refreshSubstituteEvidence.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { expenseId: id, ...refreshed } }, tx);
      }
      if (assignExpenseNumber) {
        const current = await tx.expenseRecord.findFirstOrThrow({ where: { id, companyId } });
        if (await canNumberReviewedDraft(tx, current)) {
          const expenseNumber = await expenseNumberInTransaction(tx, this.documentNumbers, current, rest.updatedByUserId);
          // Keep the save revision used by LINE continuation/CAS; numbering is part of this save.
          return mapExpense(await tx.expenseRecord.update({ where: { id }, data: { expenseNumber, updatedAt: current.updatedAt } }));
        }
      }
      return record;
    });
  }

  async findExpenseIdForSubstituteReceipt(companyId: string, evidenceId: string): Promise<string | null> {
    const evidence = await this.prisma.client.expenseSubstituteReceiptEvidence.findFirst({ where: { companyId, id: evidenceId }, select: { expenseId: true } });
    return evidence?.expenseId ?? null;
  }

  async findSubstituteEvidence(companyId: string, expenseId: string, evidenceId?: string): Promise<SubstituteReceiptEvidenceRecord | null> {
    const row = await (this.prisma.client as any).expenseSubstituteReceiptEvidence.findFirst({
      where: { companyId, expenseId, ...(evidenceId ? { id: evidenceId } : { status: { not: 'SUPERSEDED' } }) },
      orderBy: { version: 'desc' },
    });
    return row ? mapSubstituteEvidence(row) : null;
  }

  /** Just enough of an evidence row to authorise an action that only knows its id — the delivery
   *  link carries `evidenceId` and no expense, and every evidence mutation is branch-scoped. */
  async findSubstituteEvidenceScope(
    companyId: string,
    evidenceId: string,
  ): Promise<{ expenseId: string; branchId: string | null } | null> {
    const row = await (this.prisma.client as any).expenseSubstituteReceiptEvidence.findFirst({
      where: { id: evidenceId, companyId },
      select: { expenseId: true, branchId: true },
    });
    return row ?? null;
  }

  async listSubstituteEvidenceHistory(companyId: string, expenseId: string): Promise<import('@watchdog-bms/contracts').SubstituteReceiptEvidenceSummary[]> {
    const rows = await (this.prisma.client as any).expenseSubstituteReceiptEvidence.findMany({
      where: { companyId, expenseId }, orderBy: { version: 'desc' },
    });
    return rows.map((row: any) => toSubstituteEvidenceSummary(mapSubstituteEvidence(row)));
  }

  async supersedeSubstituteEvidence(input: {
    companyId: string;
    expenseId: string;
    evidenceId: string;
    actorUserId: string;
    reason: string;
    expectedEvidenceUpdatedAt: Date;
  }): Promise<import('@watchdog-bms/contracts').SubstituteReceiptEvidenceSummary> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await lockExpenseFunding(tx, input.companyId, input.expenseId);

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.expenseId}:substitute-receipt`}))`;
      const evidence = await tx.expenseSubstituteReceiptEvidence.findFirst({
        where: {
          id: input.evidenceId, companyId: input.companyId, expenseId: input.expenseId,
          status: { in: ['PREPARED', 'PAYER_CERTIFIED', 'ISSUED'] }, updatedAt: input.expectedEvidenceUpdatedAt,
        },
      });
      if (!evidence) throw new ConflictException({ code: 'substitute_evidence_stale', message: 'Substitute evidence changed. Reload before cancelling or correcting it.' });
      if (!evidence.correctionOfEvidenceId) await assertFundingMutation(tx, input.companyId, input.expenseId, 'supersede');
      if (evidence.correctionOfEvidenceId && evidence.status === 'ISSUED') throw new ConflictException('Create a new document correction instead of cancelling the issued correction.');
      const expense = await tx.expenseRecord.findFirst({ where: { id: input.expenseId, companyId: input.companyId } });
      if (!expense || (!evidence.correctionOfEvidenceId && !['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status))) {
        throw new ConflictException({ code: 'substitute_evidence_expense_confirmed', message: 'Only an unconfirmed expense can cancel or replace substitute evidence.' });
      }
      const changed = await tx.expenseSubstituteReceiptEvidence.updateMany({
        where: { id: evidence.id, status: evidence.status, updatedAt: input.expectedEvidenceUpdatedAt },
        data: { status: 'SUPERSEDED', supersededAt: new Date(), supersedeReason: input.reason },
      });
      if (changed.count !== 1) throw new ConflictException({ code: 'substitute_evidence_stale', message: 'Substitute evidence changed while superseding.' });
      if (evidence.status === 'ISSUED') {
        await tx.expenseRecord.updateMany({ where: { id: input.expenseId, companyId: input.companyId }, data: {
          substituteReceiptGeneratedAt: null, substituteReceiptGeneratedByUserId: null, updatedByUserId: input.actorUserId,
        } });
      }
      return toSubstituteEvidenceSummary(mapSubstituteEvidence(
        await tx.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } }),
      ));
    });
  }

  async findMemberDisplayName(companyId: string, userId: string): Promise<string | null> {
    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { companyId, userId },
      select: { user: { select: { displayName: true } } },
    });
    return membership?.user.displayName ?? null;
  }

  async findActiveMemberIdentity(companyId: string, userId: string, branchId: string | null): Promise<{ userId: string; displayName: string } | null> {
    const membership = await (this.prisma.client as any).companyMembership.findFirst({
      where: { companyId, userId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
      include: { user: { select: { displayName: true } }, branchScopes: { select: { branchId: true } } },
    });
    if (!membership) return null;
    if (branchId && membership.branchScopeMode !== 'ALL_BRANCHES') {
      const allowed = membership.branchScopeMode === 'DEFAULT_BRANCH_ONLY'
        ? membership.defaultBranchId === branchId
        : membership.branchScopes.some((scope: { branchId: string }) => scope.branchId === branchId);
      if (!allowed) return null;
    }
    return { userId, displayName: membership.user.displayName };
  }

  async listActiveMemberIdentities(companyId: string, branchId: string | null): Promise<Array<{ userId: string; displayName: string; isOwner: boolean }>> {
    const memberships = await (this.prisma.client as any).companyMembership.findMany({
      where: { companyId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
      include: { roles: { include: { role: { select: { key: true, status: true } } } }, user: { select: { displayName: true } }, branchScopes: { select: { branchId: true } } },
      orderBy: { user: { displayName: 'asc' } },
    });
    return memberships
      .filter((membership: any) => !branchId
        || membership.branchScopeMode === 'ALL_BRANCHES'
        || (membership.branchScopeMode === 'DEFAULT_BRANCH_ONLY'
          ? membership.defaultBranchId === branchId
          : membership.branchScopes.some((scope: { branchId: string }) => scope.branchId === branchId)))
      .map((membership: any) => ({ userId: membership.userId, displayName: membership.user.displayName, isOwner: membership.roles.some((entry: any) => entry.role.key === 'OWNER' && entry.role.status === 'ACTIVE') }));
  }

  async getSubstituteReceiptPolicy(companyId: string): Promise<SubstituteReceiptPolicyWithApprovalMode | null> {
    const row = await this.prisma.client.expenseSubstituteReceiptPolicy.findUnique({ where: { companyId } });
    if (!row) return null;
    return {
      ...row,
      approverUserIds: Array.isArray(row.approverUserIds)
        ? row.approverUserIds.filter((userId): userId is string => typeof userId === 'string')
        : [],
      cashEvidenceInstructions: row.cashEvidenceInstructions ?? null,
    };
  }

  async listEligibleSubstituteReceiptApprovers(
    companyId: string,
    branchId: string | null = null,
  ): Promise<Array<{ userId: string; displayName: string }>> {
    const memberships = await this.prisma.client.companyMembership.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        roles: { some: { role: { status: 'ACTIVE', permissions: { some: { permission: { key: 'expense.confirm' } } } } } },
      },
      include: { user: { select: { displayName: true } }, branchScopes: { select: { branchId: true } } },
      orderBy: { user: { displayName: 'asc' } },
    });
    return memberships
      .filter((membership) => !branchId
        || membership.branchScopeMode === 'ALL_BRANCHES'
        || (membership.branchScopeMode === 'DEFAULT_BRANCH_ONLY'
          ? membership.defaultBranchId === branchId
          : membership.branchScopes.some((scope: { branchId: string }) => scope.branchId === branchId)))
      .map((membership) => ({ userId: membership.userId, displayName: membership.user.displayName }));
  }

  async upsertSubstituteReceiptPolicy(input: {
    companyId: string;
    approvalMode: SubstituteReceiptApprovalMode;
    approverUserIds: string[];
    cashEvidencePolicy: SubstituteReceiptPolicyRecord['cashEvidencePolicy'];
    cashEvidenceInstructions: string | null;
    actorUserId: string;
  }): Promise<SubstituteReceiptPolicyWithApprovalMode> {
    const row = await this.prisma.client.expenseSubstituteReceiptPolicy.upsert({
      where: { companyId: input.companyId },
      create: {
        companyId: input.companyId,
        approverUserIds: input.approverUserIds,
        approvalMode: input.approvalMode,
        cashEvidencePolicy: input.cashEvidencePolicy,
        cashEvidenceInstructions: input.cashEvidenceInstructions,
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
      },
      update: {
        approverUserIds: input.approverUserIds,
        approvalMode: input.approvalMode,
        cashEvidencePolicy: input.cashEvidencePolicy,
        cashEvidenceInstructions: input.cashEvidenceInstructions,
        updatedByUserId: input.actorUserId,
      },
    });
    return {
      ...row,
      approverUserIds: Array.isArray(row.approverUserIds)
        ? row.approverUserIds.filter((userId): userId is string => typeof userId === 'string')
        : [],
      cashEvidenceInstructions: row.cashEvidenceInstructions ?? null,
    };
  }

  async getSignerJobTitle(companyId: string, userId: string): Promise<string | null> {
    const profile = await this.prisma.client.employeeAccessProfile.findFirst({ where: { companyId, userId }, select: { jobTitle: true } });
    return profile?.jobTitle?.trim() || null;
  }

  /** Also the registry the Slice 2 buyer check compares a printed buyer block with (vendor-address §5
   *  row 2): the raw names, the legal address and the expense branch's tax code and address come along. */
  async getSubstituteCompanyContext(companyId: string, branchId: string | null): Promise<{
    name: string; nameSource: 'REGISTERED' | 'DISPLAY_NAME'; taxId: string | null; branchName: string | null;
    registeredName: string | null; displayName: string; brandName: string | null; addressJson: unknown;
    branchTaxCode: string | null; branchAddressJson: unknown;
  }> {
    const company = await this.prisma.client.company.findFirst({ where: { id: companyId }, select: { registeredName: true, name: true, brandName: true, taxId: true, addressJson: true } });
    if (!company) throw new Error(`Company ${companyId} not found`);
    const branch = branchId
      ? await this.prisma.client.branch.findFirst({ where: { id: branchId, companyId }, select: { name: true, taxBranchCode: true, addressJson: true } })
      : null;
    return { name: company.registeredName?.trim() || company.name, nameSource: company.registeredName?.trim() ? 'REGISTERED' : 'DISPLAY_NAME', taxId: company.taxId, branchName: branch?.name ?? null,
      registeredName: company.registeredName, displayName: company.name, brandName: company.brandName, addressJson: company.addressJson,
      branchTaxCode: branch?.taxBranchCode ?? null, branchAddressJson: branch?.addressJson ?? null };
  }

  /**
   * W06 §12/§14.3: the two capture reads a certificate needs, and nothing else. `allocation` is
   * what the printed share statement is revision-stamped with; `group`/`observations` are what the
   * gate judges (reserved allocation, paid document, no mismatch). Both are null-safe for the
   * ordinary expenses that make up almost every certificate.
   */
  async findCaptureCertificateContext(companyId: string, expense: ExpenseRecord): Promise<{
    group: { handoffState: string; acceptedAllocationId: string | null; fundingRoute: string };
    allocation: { groupRevision: number; policyVersion: string; fundingRoute: string } | null;
    observations: import('../domain/logic/expense-capture-facts.logic').CaptureObservationRow[];
  } | null> {
    if (!expense.captureGroupId) return null;
    const [group, allocation, observations] = await Promise.all([
      this.prisma.client.expenseCaptureGroup.findFirst({
        where: { companyId, id: expense.captureGroupId },
        select: { handoffState: true, acceptedAllocationId: true, fundingRoute: true },
      }),
      expense.captureAllocationId
        ? this.prisma.client.expenseCaptureAllocation.findFirst({
          where: { companyId, id: expense.captureAllocationId },
          select: { groupRevision: true, policyVersion: true, fundingRoute: true },
        })
        : Promise.resolve(null),
      this.prisma.client.expenseCaptureObservation.findMany({
        where: { companyId, groupId: expense.captureGroupId, stale: false },
        orderBy: [{ createdAt: 'asc' }],
        select: { id: true, fileId: true, expenseId: true, version: true, source: true, payloadJson: true },
      }),
    ]);
    return group ? { group, allocation, observations } : null;
  }

  /** The snapshot block alone: preview, certify and approve rebuild the same document (§12.2). */
  async findSubstituteCaptureAllocation(companyId: string, expense: ExpenseRecord) {
    if (!expense.captureAllocationId) return null;
    const allocation = await this.prisma.client.expenseCaptureAllocation.findFirst({
      where: { companyId, id: expense.captureAllocationId },
      select: { groupRevision: true, policyVersion: true },
    });
    return captureAllocationSnapshot(expense, allocation);
  }

  async findSubstituteEvidenceAttachments(
    companyId: string,
    expenseId: string,
    attachmentIds: string[],
  ): Promise<Array<{ id: string; purpose: string; originalFileName: string; mimeType: string; checksumSha256: string | null }>> {
    if (attachmentIds.length === 0) return [];
    const links = await this.prisma.client.attachmentLink.findMany({
      where: {
        companyId,
        targetType: 'expense.record',
        targetId: expenseId,
        attachmentId: { in: attachmentIds },
        attachment: { companyId, status: 'ACTIVE' },
      },
      include: { attachment: true },
    });
    return links.map((link) => ({
      id: link.attachmentId,
      purpose: link.purpose,
      originalFileName: link.attachment.originalFileName,
      mimeType: link.attachment.mimeType,
      checksumSha256: link.attachment.checksumSha256,
    }));
  }

  /** `mimeTypes` defaults to the rendered SVG artifact. R11's wet-signed scan rides the same
   *  `expense.review.evidence` link — it is part of the certification chain, not supporting
   *  evidence — so it is read through this method with its own image/PDF types. */
  async findSubstituteArtifactAttachment(
    companyId: string,
    expenseId: string,
    attachmentId: string,
    mimeTypes: string[] = ['image/svg+xml'],
  ): Promise<{ bucket: string; objectKey: string; objectVersionId?: string; mimeType: string } | null> {
    const link = await this.prisma.client.attachmentLink.findFirst({
      where: {
        companyId,
        targetType: 'expense.record',
        targetId: expenseId,
        attachmentId,
        purpose: 'expense.review.evidence',
        attachment: { companyId, status: 'ACTIVE', mimeType: { in: mimeTypes } },
      },
      include: { attachment: true },
    });
    return link ? {
      bucket: link.attachment.bucket,
      objectKey: link.attachment.objectKey,
      objectVersionId: link.attachment.objectVersionId ?? undefined,
      mimeType: link.attachment.mimeType,
    } : null;
  }

  /** The stored bytes of an attachment that is not linked to anything yet — R10 has to read a
   *  candidate scan before deciding whether it may become part of a legal document. */
  async findActiveAttachmentObject(companyId: string, attachmentId: string): Promise<{
    bucket: string; objectKey: string; objectVersionId?: string; mimeType: string; checksumSha256: string | null;
    byteSize: number; originalFileName: string;
  } | null> {
    const row = await this.prisma.client.attachmentObject.findFirst({
      where: { id: attachmentId, companyId, status: 'ACTIVE' },
      select: {
        bucket: true, objectKey: true, objectVersionId: true, mimeType: true, checksumSha256: true,
        byteSize: true, originalFileName: true,
      },
    });
    return row ? {
      bucket: row.bucket,
      objectKey: row.objectKey,
      ...(row.objectVersionId ? { objectVersionId: row.objectVersionId } : {}),
      mimeType: row.mimeType,
      checksumSha256: row.checksumSha256,
      byteSize: row.byteSize,
      originalFileName: row.originalFileName,
    } : null;
  }

  /**
   * R10: link the photographed, hand-signed form to a PREPARED evidence and switch it to the paper
   * route. Idempotent on redelivery (the same attachment returns `linked: false`), and it never
   * touches the expense row — a metadata write there would invalidate
   * `expenseUpdatedAtAtPreparation` and block the very certification this scan exists for.
   */
  async linkSubstituteWetSignedScan(input: {
    companyId: string;
    expenseId: string;
    evidenceId: string;
    attachmentId: string;
    checksumSha256: string;
    actorUserId: string;
  }): Promise<{ documentNumber: string; linked: boolean }> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await lockExpenseFunding(tx, input.companyId, input.expenseId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.expenseId}:substitute-receipt`}))`;
      const evidence = await tx.expenseSubstituteReceiptEvidence.findFirst({
        where: { id: input.evidenceId, companyId: input.companyId, expenseId: input.expenseId },
      });
      if (!evidence) throw new NotFoundException('Substitute evidence not found.');
      if (evidence.wetSignedScanAttachmentId === input.attachmentId) {
        return { documentNumber: evidence.documentNumber, linked: false };
      }
      if (evidence.status !== 'PREPARED' || evidence.wetSignedScanAttachmentId) {
        throw new ConflictException({
          code: 'substitute_wet_signed_scan_not_linkable',
          message: `A wet-signed scan can only be linked to a PREPARED evidence with no scan yet, found ${evidence.status}.`,
        });
      }
      const expense = await tx.expenseRecord.findFirst({
        where: { id: input.expenseId, companyId: input.companyId, updatedAt: evidence.expenseUpdatedAtAtPreparation },
      });
      if (!expense) throw new ConflictException('Expense details changed after preparation. Finance must prepare a new version.');
      const active = await tx.attachmentObject.count({
        where: { id: input.attachmentId, companyId: input.companyId, status: 'ACTIVE' },
      });
      if (active !== 1) throw new ConflictException('The scanned form attachment is not ACTIVE.');
      const conflict = await findAttachmentLinkConflict(tx, {
        companyId: input.companyId, attachmentId: input.attachmentId, targetType: 'expense.record',
      });
      if (conflict) throw new BadRequestException(conflict);
      try {
        await tx.attachmentLink.create({ data: {
          companyId: input.companyId, attachmentId: input.attachmentId, targetType: 'expense.record',
          targetId: input.expenseId, purpose: 'expense.review.evidence', linkedByUserId: input.actorUserId,
        } });
      } catch (error) {
        // A partially applied first attempt already linked it; the evidence update below is the gate.
        if ((error as { code?: string }).code !== 'P2002') throw error;
      }
      const changed = await tx.expenseSubstituteReceiptEvidence.updateMany({
        where: { id: evidence.id, companyId: input.companyId, status: 'PREPARED', wetSignedScanAttachmentId: null },
        data: {
          signatureMode: 'PAPER',
          wetSignedScanAttachmentId: input.attachmentId,
          wetSignedScanChecksumSha256: input.checksumSha256,
        },
      });
      if (changed.count !== 1) throw new ConflictException('Substitute evidence changed while linking the signed form.');
      return { documentNumber: evidence.documentNumber, linked: true };
    });
  }

  async findPersonalSignatureAttachment(
    companyId: string,
    attachmentId: string,
    actorUserId: string,
    evidenceId: string,
    role: 'payer' | 'approver',
  ): Promise<{ id: string; bucket: string; objectKey: string; objectVersionId?: string; mimeType: string; byteSize: number; checksumSha256: string | null } | null> {
    const row = await this.prisma.client.attachmentObject.findFirst({
      where: {
        id: attachmentId,
        companyId,
        uploadedByUserId: actorUserId,
        status: 'ACTIVE',
        mimeType: { in: ['image/png', 'image/jpeg'] },
        metadataJson: { equals: { generatedFor: 'substitute_receipt_signature', evidenceId, role } },
      },
    });
    return row ? { id: row.id, bucket: row.bucket, objectKey: row.objectKey, objectVersionId: row.objectVersionId ?? undefined, mimeType: row.mimeType, byteSize: row.byteSize, checksumSha256: row.checksumSha256 } : null;
  }

  async findSubstitutePreparationUpload(companyId: string, expenseId: string, attachmentId: string, actorUserId: string, purpose: string) {
    return this.prisma.client.attachmentObject.findFirst({ where: { id: attachmentId, companyId, uploadedByUserId: actorUserId,
      metadataJson: { equals: { generatedFor: 'substitute_receipt_preparation', expenseId, purpose } } }, select: { status: true } });
  }

  async findPersonalSignatureUploadAttachment(
    companyId: string,
    attachmentId: string,
    actorUserId: string,
    evidenceId: string,
    role: 'payer' | 'approver',
  ): Promise<{ id: string; status: string; mimeType: string } | null> {
    const row = await this.prisma.client.attachmentObject.findFirst({
      where: {
        id: attachmentId,
        companyId,
        uploadedByUserId: actorUserId,
        mimeType: { in: ['image/png', 'image/jpeg'] },
        metadataJson: { equals: { generatedFor: 'substitute_receipt_signature', evidenceId, role } },
      },
      select: { id: true, status: true, mimeType: true },
    });
    return row;
  }

  /**
   * R9: an ACTIVE signature asset submitted by this user signs any evidence in the
   * company, so a second substitute receipt needs no upload.
   *
   * Pass `attachmentId` to resolve what an evidence row already recorded. That branch deliberately
   * drops the ACTIVE gate on the asset: ACTIVE answers "may this sign something new", while a
   * certified document must stay approvable after its signature is archived or sent back for
   * re-approval. Ownership, the attachment-id match, the attachment's own ACTIVE status and the
   * caller's recorded-checksum comparison remain the integrity gates.
   */
  async findReusableSignatureAsset(
    companyId: string,
    userId: string,
    attachmentId?: string,
  ): Promise<{ id: string; bucket: string; objectKey: string; objectVersionId?: string; mimeType: string; byteSize: number; checksumSha256: string | null; originalFileName: string } | null> {
    const assets = await this.prisma.client.companySignatureAsset.findMany({
      where: {
        companyId,
        submittedByUserId: userId,
        ...(attachmentId
          ? { OR: [{ derivedAttachmentId: attachmentId }, { originalAttachmentId: attachmentId }] }
          : { status: 'ACTIVE' }),
      },
      orderBy: { createdAt: 'desc' },
      select: { originalAttachmentId: true, derivedAttachmentId: true },
    });
    if (assets.length === 0) return null;
    // Pinned, only the recorded attachment may answer. Otherwise each asset offers its
    // background-removed derivative first and its own original second, and only when neither is a
    // live image does an older asset get a turn.
    const preferences = attachmentId
      ? [[attachmentId]]
      : assets.map((asset) => [asset.derivedAttachmentId, asset.originalAttachmentId]
        .filter((id): id is string => Boolean(id)));
    const rows = await this.prisma.client.attachmentObject.findMany({
      where: {
        id: { in: [...new Set(preferences.flat())] },
        companyId,
        status: 'ACTIVE',
        mimeType: { in: ['image/png', 'image/jpeg'] },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const candidates of preferences) {
      const row = candidates.map((id) => byId.get(id)).find((candidate) => Boolean(candidate));
      if (row) {
        return {
          id: row.id, bucket: row.bucket, objectKey: row.objectKey,
          objectVersionId: row.objectVersionId ?? undefined,
          mimeType: row.mimeType, byteSize: row.byteSize, checksumSha256: row.checksumSha256,
          originalFileName: row.originalFileName,
        };
      }
    }
    return null;
  }

  async freezeSubstitutePaperForm(companyId: string, expenseId: string, evidenceId: string, snapshot: Record<string, unknown>, expectedEvidenceUpdatedAt: Date, expectedExpenseUpdatedAt: Date) {
    return this.prisma.client.$transaction(async (tx) => {
      await lockExpenseFunding(tx, companyId, expenseId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${expenseId}:substitute-receipt`}))`;
      const evidence = await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { id: evidenceId, companyId, expenseId } });
      const expense = await tx.expenseRecord.findFirst({ where: { id: expenseId, companyId } });
      if (!evidence || !expense || expense.updatedAt.getTime() !== expectedExpenseUpdatedAt.getTime()
        || evidence.status !== 'PREPARED' || evidence.signatureMode !== 'PAPER' || evidence.payerUserId !== null
        || expense.updatedAt.getTime() !== evidence.expenseUpdatedAtAtPreparation.getTime()) throw new ConflictException('substitute_paper_form_changed');
      if (evidence.paperFormSnapshotJson) return mapSubstituteEvidence(evidence);
      if (evidence.updatedAt.getTime() !== expectedEvidenceUpdatedAt.getTime()) throw new ConflictException('substitute_paper_form_changed');
      return mapSubstituteEvidence(await tx.expenseSubstituteReceiptEvidence.update({ where: { id: evidenceId }, data: { paperFormSnapshotJson: snapshot as Prisma.InputJsonValue } }));
    });
  }

  async findSubstitutePaperUpload(companyId: string, evidenceId: string, attachmentId: string, userId: string) {
    const row = await this.prisma.client.attachmentObject.findFirst({ where: { id: attachmentId, companyId, uploadedByUserId: userId } });
    const metadata = row?.metadataJson as Record<string, unknown> | null;
    return row && metadata?.generatedFor === 'substitute_receipt_paper' && metadata.evidenceId === evidenceId ? row : null;
  }

  async submitSubstitutePaper(input: {
    companyId: string; expenseId: string; evidenceId: string; expectedUpdatedAt: Date;
    attachmentId: string; checksumSha256: string;
    submission: import('@watchdog-bms/contracts').SubstituteReceiptPaperSubmission;
  }): Promise<SubstituteReceiptEvidenceRecord> {
    return this.prisma.client.$transaction(async (tx) => {
      await lockExpenseFunding(tx, input.companyId, input.expenseId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.expenseId}:substitute-receipt`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.attachmentId}:attachment-retention`}))`;
      const evidence = await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { id: input.evidenceId, companyId: input.companyId, expenseId: input.expenseId } });
      const expense = await tx.expenseRecord.findFirst({ where: { id: input.expenseId, companyId: input.companyId } });
      if (!evidence || !expense || evidence.status !== 'PREPARED' || evidence.signatureMode !== 'PAPER' || evidence.payerUserId !== null
        || !evidence.paperFormSnapshotJson || evidence.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
        || evidence.wetSignedScanAttachmentId || expense.updatedAt.getTime() !== evidence.expenseUpdatedAtAtPreparation.getTime()) throw new ConflictException('substitute_paper_submission_changed');
      const attachment = await tx.attachmentObject.findFirst({ where: { id: input.attachmentId, companyId: input.companyId, branchId: evidence.branchId,
        status: 'ACTIVE', uploadedByUserId: input.submission.uploadedByUserId, checksumSha256: input.checksumSha256 } });
      const metadata = attachment?.metadataJson as Record<string, unknown> | null;
      if (!attachment || metadata?.generatedFor !== 'substitute_receipt_paper' || metadata.evidenceId !== evidence.id) throw new ConflictException('substitute_paper_upload_unavailable');
      if (await tx.attachmentLink.count({ where: { attachmentId: attachment.id } })) throw new ConflictException('substitute_paper_upload_already_linked');
      await tx.attachmentLink.create({ data: { companyId: input.companyId, attachmentId: attachment.id, targetType: 'expense.record', targetId: input.expenseId,
        purpose: 'expense.review.evidence', linkedByUserId: input.submission.uploadedByUserId } });
      return mapSubstituteEvidence(await tx.expenseSubstituteReceiptEvidence.update({ where: { id: evidence.id }, data: {
        wetSignedScanAttachmentId: attachment.id, wetSignedScanChecksumSha256: input.checksumSha256,
        paperSubmissionJson: input.submission, payerName: input.submission.payer.name, payerPosition: input.submission.payer.position,
      } }));
    });
  }

  async createPreparedSubstituteEvidence(input: {
    companyId: string;
    expenseId: string;
    branchId: string | null;
    expectedExpenseUpdatedAt: Date;
    amendment?: { evidenceId: string; expectedUpdatedAt: Date; keepDocumentNumberConfirmed?: boolean };
    fundingSource: 'COMPANY' | 'PERSONAL_ADVANCE' | null;
    correctionOfEvidenceId?: string;
    correctionReason?: string;
    originalSourceDocumentType: string;
    reasonCode: string;
    missingReceiptReason: string;
    businessPurpose: string;
    paymentEvidenceAttachmentIds: string[];
    supportingAttachmentIds: string[];
    paymentDate: Date | null;
    paymentMethod: string | null;
    note: string | null;
    payerUserId: string | null;
    signatureMode?: 'DIGITAL' | 'PAPER';
    payerName: string;
    payeeName: string;
    payeeAddress: string | null;
    payeeTaxId: string | null;
    preparedByUserId: string;
    /** R7 audit trail: which surface reserved the document number. */
    preparedFromChannel: 'WEB' | 'LINE';
    /** Human-confirmed paid check bill; resolved atomically with prepared evidence. */
    routeCheckBill?: boolean;
    idempotencyKey: string;
    lineContinuation?: { workflowId: string; userId: string; formRequested?: boolean };
  }): Promise<SubstituteReceiptEvidenceRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await lockExpenseFunding(tx, input.companyId, input.expenseId);
      if (!input.correctionOfEvidenceId) await assertFundingMutation(tx, input.companyId, input.expenseId, 'prepare');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.expenseId}:substitute-receipt`}))`;
      if (input.amendment) {
        const current = await tx.expenseSubstituteReceiptEvidence.findFirst({
          where: { companyId: input.companyId, expenseId: input.expenseId, status: { not: 'SUPERSEDED' } }, orderBy: { version: 'desc' },
        });
        const expense = await tx.expenseRecord.findFirst({ where: { companyId: input.companyId, id: input.expenseId } });
        if (!current || current.id !== input.amendment.evidenceId || current.updatedAt.getTime() !== input.amendment.expectedUpdatedAt.getTime()
          || !['PREPARED', 'PAYER_CERTIFIED'].includes(current.status) || current.correctionOfEvidenceId
          || !expense || expense.updatedAt.getTime() !== input.expectedExpenseUpdatedAt.getTime()
          || !['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status)) {
          throw new ConflictException('เอกสารเปลี่ยนแปลงหรือออกสมบูรณ์แล้ว เปิดหน้านี้ใหม่ก่อนแก้ไข');
        }
        if (current.signatureMode !== input.signatureMode || current.payerUserId !== input.payerUserId || current.fundingSource !== input.fundingSource) {
          throw new ConflictException('การแก้ข้อมูลต้องใช้วิธีเซ็น ผู้รับรอง และแหล่งเงินเดิม คงข้อมูลเหล่านี้ไว้หรือยกเลิกใบรับรองก่อนสร้างใหม่');
        }
        if (!input.paymentDate || !Number.isFinite(input.paymentDate.getTime())) throw new BadRequestException('วันที่จ่ายเงินไม่ถูกต้อง เลือกวันที่จ่ายเงินอีกครั้ง');
        assertFullSubstitutePayment(input.fundingSource, expense.paidAmount.toString(), expense.netPayableAmount.toString());
        assertSubstitutePaymentDetails(input.fundingSource, expense, input);
        const ids = [...new Set([...input.paymentEvidenceAttachmentIds, ...input.supportingAttachmentIds])].sort();
        for (const id of ids) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${id}:attachment-retention`}))`;
        if (await tx.attachmentObject.count({ where: { companyId: input.companyId, id: { in: ids }, status: 'ACTIVE', links: { some: { companyId: input.companyId, targetType: 'expense.record', targetId: input.expenseId } } } }) !== ids.length) {
          throw new ConflictException('หลักฐานเปลี่ยนแปลง เปิดหน้านี้ใหม่ก่อนแก้ไข');
        }
        const facts = Object.fromEntries(['reasonCode', 'missingReceiptReason', 'businessPurpose', 'payeeName', 'payeeAddress', 'payeeTaxId', 'paymentDate', 'paymentMethod', 'paymentEvidenceAttachmentIds', 'supportingAttachmentIds']
          .map(key => [key, (input as any)[key]]));
        const sellerFields = substitutePayeeExpenseFields(expense, input.payeeName, current);
        if (!sellerFields.vendorNameSnapshot && Object.entries(facts).every(([key, value]) => key === 'paymentDate'
          ? current.paymentDate && input.paymentDate && civilDate(current.paymentDate) === civilDate(input.paymentDate)
          : JSON.stringify(current[key]) === JSON.stringify(value))) return mapSubstituteEvidence(current);
        assertSubstituteEditAllowed(current, expense);
        if (current.paymentDate && input.paymentDate && civilDate(current.paymentDate).slice(0, 7) !== civilDate(input.paymentDate).slice(0, 7)
          && input.amendment.keepDocumentNumberConfirmed !== true) {
          throw new ConflictException({ code: 'substitute_payment_month_confirmation_required', message: 'ยังไม่ได้ยืนยันเปลี่ยนเดือนที่จ่ายเงิน ติ๊กยืนยันว่าจะเปลี่ยนเดือนโดยคงเลขเอกสารเดิม' });
        }
        const sourceNote = substitutePurposeSourceNote(expense.note, input.businessPurpose, current.businessPurpose);
        const sourceChanged = Boolean(sellerFields.vendorNameSnapshot) || expense.missingReceiptReason !== input.missingReceiptReason || sourceNote !== expense.note;
        const sourceUpdatedAt = sourceChanged ? new Date(Math.max(Date.now(), expense.updatedAt.getTime() + 1)) : expense.updatedAt;
        const data = {
          reasonCode: input.reasonCode, missingReceiptReason: input.missingReceiptReason, businessPurpose: input.businessPurpose,
          payeeName: input.payeeName, payeeAddress: input.payeeAddress, payeeTaxId: input.payeeTaxId,
          paymentDate: input.paymentDate, paymentMethod: input.paymentMethod,
          paymentEvidenceAttachmentIds: input.paymentEvidenceAttachmentIds, supportingAttachmentIds: input.supportingAttachmentIds,
          ...(sourceChanged && current.note && current.note === expense.note ? { note: sourceNote } : {}),
          expenseUpdatedAtAtPreparation: sourceUpdatedAt,
        };
        if (Object.entries(data).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value))) return mapSubstituteEvidence(current);
        if (sourceChanged) await tx.expenseRecord.update({ where: { id: expense.id }, data: {
          ...sellerFields,
          missingReceiptReason: input.missingReceiptReason, note: sourceNote,
          updatedAt: sourceUpdatedAt, updatedByUserId: input.preparedByUserId,
        } });
        const revised = await reviseSubstituteEvidence(tx, current, data, input.preparedByUserId, input.idempotencyKey, 'แก้ไขข้อมูลใบแทน กรุณาตรวจและลงนามใหม่');
        return mapSubstituteEvidence(await tx.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: revised.evidenceId } }));
      }
      // A cancelled correction may be restarted; network retries of a pending correction reuse it.
      const latestCorrection = input.correctionOfEvidenceId ? await tx.expenseSubstituteReceiptEvidence.findFirst({
        where: { companyId: input.companyId, expenseId: input.expenseId, correctionOfEvidenceId: input.correctionOfEvidenceId }, orderBy: { version: 'desc' },
      }) : null;
      const idempotencyKey = latestCorrection && ['PREPARED', 'PAYER_CERTIFIED'].includes(latestCorrection.status)
        ? latestCorrection.idempotencyKey
        : latestCorrection ? `${input.idempotencyKey}:${latestCorrection.id}` : input.idempotencyKey;
      const existing = await tx.expenseSubstituteReceiptEvidence.findFirst({
        where: { companyId: input.companyId, expenseId: input.expenseId, idempotencyKey },
      });
      if (existing) {
        const same = (existing.correctionOfEvidenceId ?? undefined) === input.correctionOfEvidenceId
          && (existing.correctionReason ?? undefined) === input.correctionReason
          && existing.fundingSource === input.fundingSource
          && existing.reasonCode === input.reasonCode
          && existing.missingReceiptReason === input.missingReceiptReason
          && existing.businessPurpose === input.businessPurpose
          && existing.payerUserId === input.payerUserId
          && existing.payeeName === input.payeeName
          && existing.payeeAddress === input.payeeAddress
          && existing.payeeTaxId === input.payeeTaxId
          && existing.branchId === input.branchId
          && existing.originalSourceDocumentType === input.originalSourceDocumentType
          && (existing.paymentDate?.getTime() ?? null) === (input.paymentDate?.getTime() ?? null)
          && existing.paymentMethod === input.paymentMethod
          && existing.note === input.note
          && JSON.stringify(existing.paymentEvidenceAttachmentIds) === JSON.stringify(input.paymentEvidenceAttachmentIds)
          && JSON.stringify(existing.supportingAttachmentIds) === JSON.stringify(input.supportingAttachmentIds);
        if (!same) throw new ConflictException({ code: 'substitute_evidence_idempotency_conflict', message: 'Idempotency key was already used with different substitute-receipt data.' });
        return mapSubstituteEvidence(existing);
      }
      if (!input.paymentDate || !Number.isFinite(input.paymentDate.getTime())) {
        throw new BadRequestException('วันที่จ่ายเงินไม่ถูกต้อง เลือกวันที่จ่ายเงินอีกครั้งก่อนจัดทำใบรับรองแทนใบเสร็จ');
      }
      const expense = await tx.expenseRecord.findFirst({ where: { id: input.expenseId, companyId: input.companyId } });
      if (!expense || expense.updatedAt.getTime() !== input.expectedExpenseUpdatedAt.getTime()) {
        throw new ConflictException({ code: 'expense_stale_reload', message: 'Expense changed after review. Reload before preparing substitute evidence.' });
      }
      const correction = input.correctionOfEvidenceId ? await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { id: input.correctionOfEvidenceId, companyId: input.companyId, expenseId: input.expenseId, status: 'ISSUED' } }) : null;
      if (input.correctionOfEvidenceId) {
        if (!correction?.snapshotJson || expense.status === 'VOIDED') throw new ConflictException('substitute_correction_source_changed');
        for (const key of ['fundingSource', 'payerUserId', 'payerName', 'payeeName', 'payeeAddress', 'payeeTaxId', 'paymentMethod', 'businessPurpose', 'missingReceiptReason', 'reasonCode', 'note'] as const) {
          if ((correction[key] ?? null) !== (input[key] ?? null)) throw new ConflictException('substitute_correction_financial_fields_locked');
        }
        if (correction.paymentDate?.getTime() !== input.paymentDate?.getTime()
          || JSON.stringify(correction.paymentEvidenceAttachmentIds) !== JSON.stringify(input.paymentEvidenceAttachmentIds)
          || JSON.stringify(correction.supportingAttachmentIds) !== JSON.stringify(input.supportingAttachmentIds)) throw new ConflictException('substitute_correction_financial_fields_locked');
        const company = await tx.company.findFirst({ where: { id: input.companyId }, select: { taxId: true } });
        if (company?.taxId !== correction.snapshotJson.company.taxId) throw new ConflictException('substitute_correction_company_identity_changed');
      } else {
        assertFullSubstitutePayment(input.fundingSource, expense.paidAmount.toString(), expense.netPayableAmount.toString());
        assertSubstitutePaymentDetails(input.fundingSource, expense, input);
      }
      const preparedAt = new Date();
      const currentSummary = expense.aiVerificationSummaryJson && typeof expense.aiVerificationSummaryJson === 'object'
        && !Array.isArray(expense.aiVerificationSummaryJson)
        ? { ...expense.aiVerificationSummaryJson }
        : {};
      const aiVerificationSummaryJson = input.routeCheckBill
        ? {
            ...currentSummary,
            classificationResolution: {
              outcome: 'ROUTED_TO_SUBSTITUTE_RECEIPT',
              acknowledgedPaidWithoutFinalReceipt: true,
              sourceDocumentKind: 'ORDER_OR_CHECK_BILL',
              resolvedAt: preparedAt.toISOString(),
              resolvedByUserId: input.preparedByUserId,
            },
          }
        : undefined;
      let sourceChannelMetadataJson: Record<string, unknown> | undefined;
      if (input.lineContinuation) {
        const metadata = expense.sourceChannelMetadataJson && typeof expense.sourceChannelMetadataJson === 'object'
          ? { ...expense.sourceChannelMetadataJson }
          : {};
        const state = (metadata as any).lineSubstituteReceiptContinuation;
        if (!state || state.kind !== 'SUBSTITUTE_RECEIPT'
          || state.workflowId !== input.lineContinuation.workflowId
          || state.companyId !== input.companyId || state.expenseId !== input.expenseId
          || state.userId !== input.lineContinuation.userId
          || !['OPEN', 'PAUSED'].includes(state.status)
          || state.targetRevision !== input.expectedExpenseUpdatedAt.toISOString()) {
          throw new ConflictException({
            code: 'LINE_SUBSTITUTE_CONTINUATION_STALE',
            message: 'LINE substitute-receipt continuation is stale, closed, or outside the current user scope.',
          });
        }
        (metadata as any).lineSubstituteReceiptContinuation = {
          ...state,
          status: 'CONSUMED',
          // R10: the consumed state is the only durable record that this chat is waiting for a photo
          // of the signed sheet — the expense row itself must not be touched again after prepare, or
          // `assertPreparedExpenseUnchanged` would reject the certification this prepare exists for.
          ...(input.lineContinuation.formRequested ? { formRequested: true } : {}),
          targetRevision: preparedAt.toISOString(),
          lastActivityAt: preparedAt.toISOString(),
        };
        sourceChannelMetadataJson = metadata as Record<string, unknown>;
      }
      if (!correction) {
        const reviewedSource = await this.findByIdWithRelations(input.companyId, input.expenseId, tx);
        if (!reviewedSource || !hasCurrentExpenseEvidenceReview(reviewedSource) || expenseEvidenceAssessment(reviewedSource)?.route !== 'SUBSTITUTE_RECEIPT') {
          throw new ConflictException({ code: 'EXPENSE_EVIDENCE_REVIEW_REQUIRED', message: 'หลักฐานเปลี่ยนแล้ว บันทึกการตรวจล่าสุดก่อนจัดทำใบรับรอง' });
        }
      }
      const sellerFields = correction ? {} : substitutePayeeExpenseFields(expense, input.payeeName);
      if (sellerFields.sourceChannelMetadataJson) sourceChannelMetadataJson = { ...sellerFields.sourceChannelMetadataJson, ...sourceChannelMetadataJson, substituteReceiptPayeeName: sellerFields.vendorNameSnapshot };
      const safeUpdate = correction ? { count: 1 } : await tx.expenseRecord.updateMany({
        where: {
          id: input.expenseId,
          companyId: input.companyId,
          updatedAt: input.expectedExpenseUpdatedAt,
          status: { in: ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'] },
        },
        data: {
          ...sellerFields,
          missingReceiptReason: input.missingReceiptReason,
          note: substitutePurposeSourceNote(expense.note, input.businessPurpose),
          taxEvidenceStatus: 'SUPPORTING_ONLY',
          inputVatClaimStatus: 'NON_CLAIMABLE',
          taxEvidenceReasonCode: 'HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE',
          ...(aiVerificationSummaryJson ? { aiVerificationSummaryJson } : {}),
          updatedByUserId: input.preparedByUserId,
          updatedAt: preparedAt,
          ...(sourceChannelMetadataJson ? { sourceChannelMetadataJson } : {}),
        },
      });
      if (safeUpdate.count !== 1) throw new Error('Expense changed after review. Reload before preparing substitute evidence.');
      const safeExpense = await tx.expenseRecord.findFirstOrThrow({ where: { id: input.expenseId, companyId: input.companyId } });
      const pendingCertified = await tx.expenseSubstituteReceiptEvidence.findFirst({
        where: { companyId: input.companyId, expenseId: input.expenseId, OR: [
          { status: 'PAYER_CERTIFIED' }, { status: 'PREPARED', signatureMode: 'PAPER', payerUserId: null },
        ] },
      });
      if (pendingCertified) throw new ConflictException('มีเวอร์ชันที่รอเซ็นบนกระดาษหรือรออนุมัติอยู่ ยกเลิกเวอร์ชันนั้นก่อนจัดทำใหม่');
      await tx.expenseSubstituteReceiptEvidence.updateMany({
        where: { companyId: input.companyId, expenseId: input.expenseId, status: 'PREPARED' },
        data: { status: 'SUPERSEDED', supersededAt: new Date(), supersedeReason: 'CORRECTED_VERSION_PREPARED' },
      });
      const latest = await tx.expenseSubstituteReceiptEvidence.findFirst({
        where: { companyId: input.companyId, expenseId: input.expenseId }, orderBy: { version: 'desc' }, select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;
      const reserved = await this.documentNumbers.reserveNumberInTransaction(tx, {
        companyId: input.companyId,
        branchId: input.branchId ?? undefined,
        documentType: SUBSTITUTE_RECEIPT_DOCUMENT_TYPE,
        periodKey: civilPeriodKey(civilDate(input.paymentDate)),
        idempotencyKey: `${input.expenseId}:${idempotencyKey}`,
        reservedByUserId: input.preparedByUserId,
      });
      const evidence = await tx.expenseSubstituteReceiptEvidence.create({
        data: {
          companyId: input.companyId,
          expenseId: input.expenseId,
          branchId: input.branchId,
          version,
          documentNumber: reserved.documentNumber,
          idempotencyKey,
          originalSourceDocumentType: input.originalSourceDocumentType,
          fundingSource: input.fundingSource,
          correctionOfEvidenceId: input.correctionOfEvidenceId ?? null, correctionReason: input.correctionReason ?? null,
          ...(correction ? { snapshotJson: correction.snapshotJson } : {}),
          reasonCode: input.reasonCode,
          missingReceiptReason: input.missingReceiptReason,
          businessPurpose: input.businessPurpose,
          paymentEvidenceAttachmentIds: input.paymentEvidenceAttachmentIds,
          supportingAttachmentIds: input.supportingAttachmentIds,
          paymentDate: input.paymentDate,
          paymentMethod: input.paymentMethod,
          note: input.note,
          preparedByUserId: input.preparedByUserId,
          preparedFromChannel: input.preparedFromChannel,
          preparedAt,
          expenseUpdatedAtAtPreparation: safeExpense.updatedAt,
          signatureMode: input.signatureMode ?? 'DIGITAL',
          payerUserId: input.payerUserId,
          payerName: input.payerName,
          payeeName: input.payeeName,
          payeeAddress: input.payeeAddress,
          payeeTaxId: input.payeeTaxId,
        },
      });
      await this.documentNumbers.commitNumberInTransaction(tx, {
        id: reserved.id,
        companyId: input.companyId,
        ownerType: SUBSTITUTE_RECEIPT_OWNER_TYPE,
        ownerId: evidence.id,
      });
      return mapSubstituteEvidence(evidence);
    });
  }

  async markSubstituteEvidenceCertified(input: {
    companyId: string;
    expenseId: string;
    evidenceId: string;
    payerUserId: string;
    payerPosition: string;
    /** R11: absent on the paper route — the payer's ink is on `wetSignedScanAttachmentId`. */
    payerSignatureAttachmentId?: string;
    payerSignatureChecksumSha256?: string;
    referencedAttachmentIds: string[];
    snapshotJson: Record<string, unknown>;
    snapshotChecksumSha256: string;
    certifiedAt: Date;
    expectedVersion: number;
    expectedEvidenceUpdatedAt: Date;
    artifact: { storageProvider: string; bucket: string; objectKey: string; objectVersionId: string; byteSize: number; checksumSha256: string; originalFileName: string };
  }, transaction?: any): Promise<SubstituteReceiptEvidenceRecord> {
    const client = this.prisma.client as any;
    const execute = async (tx: any) => {
      await lockExpenseFunding(tx, input.companyId, input.expenseId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.expenseId}:substitute-receipt`}))`;
      for (const attachmentId of [...new Set(input.referencedAttachmentIds)].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${attachmentId}:attachment-retention`}))`;
      }
      const evidence = await tx.expenseSubstituteReceiptEvidence.findFirst({
        where: { id: input.evidenceId, companyId: input.companyId, expenseId: input.expenseId },
      });
      if (!evidence || evidence.status !== 'PREPARED' || evidence.version !== input.expectedVersion
        || evidence.payerUserId !== input.payerUserId || evidence.updatedAt.getTime() !== input.expectedEvidenceUpdatedAt.getTime()) {
        throw new Error('Substitute evidence changed or the payer does not match. Reload before certifying.');
      }
      const expense = await tx.expenseRecord.findFirst({ where: { id: input.expenseId, companyId: input.companyId } });
      if (!expense || expense.updatedAt.getTime() !== evidence.expenseUpdatedAtAtPreparation.getTime()
        || (!evidence.correctionOfEvidenceId && !['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status)) || expense.status === 'VOIDED') {
        throw new ConflictException('Expense changed after the reviewed preview. Reload before certifying.');
      }
      if (!evidence.correctionOfEvidenceId) {
        assertFullSubstitutePayment(evidence.fundingSource, expense.paidAmount.toString(), expense.netPayableAmount.toString());
        assertSubstitutePaymentDetails(evidence.fundingSource, expense, evidence);
        assertSubstituteFactsComplete(evidence);
      }
      const activeAttachments = await tx.attachmentObject.count({
        where: { id: { in: input.referencedAttachmentIds }, companyId: input.companyId, status: 'ACTIVE' },
      });
      if (activeAttachments !== new Set(input.referencedAttachmentIds).size) {
        throw new Error('A linked source, payment, or signature attachment changed while certifying.');
      }
      const attachment = await tx.attachmentObject.create({
        data: {
          companyId: input.companyId,
          branchId: evidence.branchId,
          storageProvider: input.artifact.storageProvider,
          bucket: input.artifact.bucket,
          objectKey: input.artifact.objectKey,
          objectVersionId: input.artifact.objectVersionId,
          originalFileName: input.artifact.originalFileName,
          mimeType: 'image/svg+xml',
          byteSize: input.artifact.byteSize,
          checksumSha256: input.artifact.checksumSha256,
          visibility: 'INTERNAL',
          status: 'ACTIVE',
          uploadedByUserId: input.payerUserId,
          uploadedAt: new Date(),
          metadataJson: { generatedBy: 'substitute_receipt', stage: 'payer_certified', evidenceId: evidence.id, version: evidence.version },
        },
      });
      await tx.attachmentLink.create({ data: {
        companyId: input.companyId, attachmentId: attachment.id, targetType: 'expense.record', targetId: input.expenseId,
        purpose: 'expense.review.evidence', linkedByUserId: input.payerUserId,
      } });
      const changed = await tx.expenseSubstituteReceiptEvidence.updateMany({
        where: { id: evidence.id, companyId: input.companyId, status: 'PREPARED', updatedAt: input.expectedEvidenceUpdatedAt },
        data: {
          status: 'PAYER_CERTIFIED', payerPosition: input.payerPosition,
          ...(input.payerSignatureAttachmentId ? {
            payerSignatureAttachmentId: input.payerSignatureAttachmentId,
            payerSignatureChecksumSha256: input.payerSignatureChecksumSha256,
          } : {}),
          snapshotJson: input.snapshotJson, snapshotChecksumSha256: input.snapshotChecksumSha256,
          certifiedArtifactAttachmentId: attachment.id, certifiedArtifactChecksumSha256: input.artifact.checksumSha256,
          certifiedAt: input.certifiedAt,
        },
      });
      if (changed.count !== 1) throw new Error('Substitute evidence changed while certifying.');
      return mapSubstituteEvidence(await tx.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } }));
    };
    return transaction ? execute(transaction) : client.$transaction(execute);
  }

  async issueSubstituteEvidence(input: {
    paperAcceptance?: {
      snapshot: import('../domain/logic/substitute-receipt.logic').SubstituteReceiptSnapshot;
      snapshotChecksumSha256: string;
      scanChecksumSha256: string;
    };
    companyId: string;
    expenseId: string;
    evidenceId: string;
    approverUserId: string;
    approverName: string;
    approverPosition: string;
    /** Decided by the use-case from the company's approvalMode and the actor's OWNER role. The
     *  separation-of-duties re-check below stays — it must run inside the lock to be race-safe —
     *  but it cannot decide the policy itself, or a solo owner is blocked here after passing
     *  every check above. */
    allowSelfApproval: boolean;
    /** R11: absent on the paper route — the approver's ink is on the linked scan. */
    approverSignatureAttachmentId?: string;
    approvedAt: Date;
    expectedExpenseUpdatedAt: Date;
    referencedAttachmentIds: string[];
    expectedVersion: number;
    expectedEvidenceUpdatedAt: Date;
    artifact: { storageProvider: string; bucket: string; objectKey: string; objectVersionId: string; byteSize: number; checksumSha256: string; originalFileName: string };
  }, transaction?: any): Promise<SubstituteReceiptEvidenceRecord> {
    const client = this.prisma.client as any;
    const execute = async (tx: any) => {
      await lockExpenseFunding(tx, input.companyId, input.expenseId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.expenseId}:substitute-receipt`}))`;
      for (const attachmentId of [...new Set(input.referencedAttachmentIds)].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${attachmentId}:attachment-retention`}))`;
      }
      const evidence = await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { id: input.evidenceId, companyId: input.companyId, expenseId: input.expenseId } });
      if (!evidence || evidence.status !== (input.paperAcceptance ? 'PREPARED' : 'PAYER_CERTIFIED') || evidence.version !== input.expectedVersion
        || evidence.updatedAt.getTime() !== input.expectedEvidenceUpdatedAt.getTime()) {
        throw new Error('Substitute evidence changed. Reload before approval.');
      }
      if (input.paperAcceptance && (evidence.signatureMode !== 'PAPER' || evidence.payerUserId !== null
        || !evidence.paperFormSnapshotJson || !evidence.paperSubmissionJson
        || evidence.wetSignedScanChecksumSha256 !== input.paperAcceptance.scanChecksumSha256
        || !input.referencedAttachmentIds.includes(evidence.wetSignedScanAttachmentId)
        || (evidence.paperSubmissionJson.samePerson && !input.allowSelfApproval))) {
        throw new ConflictException('substitute_paper_submission_changed');
      }
      if (!input.allowSelfApproval && evidence.payerUserId === input.approverUserId) {
        throw new Error('The payer cannot approve their own substitute receipt.');
      }
      const expense = await tx.expenseRecord.findFirst({
        where: { id: input.expenseId, companyId: input.companyId, updatedAt: input.expectedExpenseUpdatedAt },
      });
      if (!expense) throw new Error('Expense details changed after payer certification. Finance must prepare a new version.');
      if (!evidence.correctionOfEvidenceId && evidence.fundingSource === 'COMPANY') await assertExpenseDisbursementReservation(tx, expense, 'approveSubstitute');
      if (evidence.correctionOfEvidenceId) {
        const original = await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { id: evidence.correctionOfEvidenceId, companyId: input.companyId, expenseId: input.expenseId, OR: [{ status: 'ISSUED' }, ...(evidence.correctionReason === EXPENSE_EDIT_RESIGN_REASON ? [{ status: 'SUPERSEDED', supersedeReason: EXPENSE_EDIT_RESIGN_REASON }] : [])] } });
        const company = await tx.company.findFirst({ where: { id: input.companyId }, select: { taxId: true } });
        if (!original || (input.paperAcceptance ? original.paperReviewedByUserId : original.approverUserId) !== input.approverUserId || expense.status === 'VOIDED'
          || company?.taxId !== original.snapshotJson?.company?.taxId
          || (input.paperAcceptance?.snapshot ?? evidence.snapshotJson)?.company?.taxId !== original.snapshotJson?.company?.taxId) {
          throw new ConflictException('substitute_correction_source_changed');
        }
      } else await assertFundingMutation(tx, input.companyId, input.expenseId, 'prepare');
      if (!evidence.correctionOfEvidenceId) {
        assertFullSubstitutePayment(evidence.fundingSource, expense.paidAmount.toString(), expense.netPayableAmount.toString());
        assertSubstitutePaymentDetails(evidence.fundingSource, expense, evidence);
        assertSubstituteFactsComplete(evidence);
      }
      const activeAttachments = await tx.attachmentObject.count({
        where: { id: { in: input.referencedAttachmentIds }, companyId: input.companyId, status: 'ACTIVE' },
      });
      if (activeAttachments !== new Set(input.referencedAttachmentIds).size) {
        throw new Error('A certified source, artifact, or signature attachment changed while approving.');
      }
      const attachment = await tx.attachmentObject.create({ data: {
        companyId: input.companyId, branchId: evidence.branchId, storageProvider: input.artifact.storageProvider,
        bucket: input.artifact.bucket, objectKey: input.artifact.objectKey, objectVersionId: input.artifact.objectVersionId,
        originalFileName: input.artifact.originalFileName,
        mimeType: 'image/svg+xml', byteSize: input.artifact.byteSize, checksumSha256: input.artifact.checksumSha256,
        visibility: 'INTERNAL', status: 'ACTIVE', uploadedByUserId: input.approverUserId, uploadedAt: new Date(),
        metadataJson: { generatedBy: 'substitute_receipt', stage: 'issued', evidenceId: evidence.id, version: evidence.version },
      } });
      await tx.attachmentLink.create({ data: {
        companyId: input.companyId, attachmentId: attachment.id, targetType: 'expense.record', targetId: input.expenseId,
        purpose: 'expense.review.evidence', linkedByUserId: input.approverUserId,
      } });
      const now = input.approvedAt;
      await tx.expenseSubstituteReceiptEvidence.updateMany({
        where: { companyId: input.companyId, expenseId: input.expenseId, status: 'ISSUED' },
        data: { status: 'SUPERSEDED', supersededAt: now, supersedeReason: 'NEW_VERSION_ISSUED' },
      });
      const changed = await tx.expenseSubstituteReceiptEvidence.updateMany({
        where: { id: evidence.id, companyId: input.companyId, status: input.paperAcceptance ? 'PREPARED' : 'PAYER_CERTIFIED', updatedAt: input.expectedEvidenceUpdatedAt },
        data: {
          status: 'ISSUED', approverUserId: input.paperAcceptance ? null : input.approverUserId, approverName: input.approverName,
          approverPosition: input.approverPosition,
          ...(input.approverSignatureAttachmentId ? { approverSignatureAttachmentId: input.approverSignatureAttachmentId } : {}),
          ...(input.paperAcceptance ? {
            paperReviewedByUserId: input.approverUserId,
            snapshotJson: input.paperAcceptance.snapshot,
            snapshotChecksumSha256: input.paperAcceptance.snapshotChecksumSha256,
            payerName: input.paperAcceptance.snapshot.payer.name,
            payerPosition: input.paperAcceptance.snapshot.payer.position,
            certifiedAt: new Date(input.paperAcceptance.snapshot.payer.certifiedAt),
          } : {}),
          approvedAt: input.paperAcceptance ? new Date(evidence.paperSubmissionJson.approver.signedOn) : now, artifactAttachmentId: attachment.id, checksumSha256: input.artifact.checksumSha256,
          issuedByUserId: input.approverUserId, issuedAt: now,
        },
      });
      if (changed.count !== 1) throw new Error('Substitute evidence changed while approving.');
      if (evidence.correctionOfEvidenceId) {
        if (evidence.correctionReason === EXPENSE_EDIT_RESIGN_REASON) await tx.expenseRecord.updateMany({ where: { companyId: input.companyId, id: input.expenseId }, data: {
          substituteReceiptGeneratedAt: now, substituteReceiptGeneratedByUserId: input.approverUserId,
          updatedAt: expense.updatedAt,
        } });
        return mapSubstituteEvidence(await tx.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } }));
      }
      if (!evidence.paymentDate || !evidence.paymentMethod) {
        throw new Error('Certified substitute evidence is missing payment date or method.');
      }
      const paidBefore = new Decimal(expense.paidAmount.toString());
      const payable = new Decimal(expense.netPayableAmount.toString());
      if (paidBefore.lt(0) || paidBefore.minus(payable).gt(SETTLE_EPSILON)) {
        throw new Error('Expense payment totals are inconsistent. Reload before approval.');
      }
      const isCompanyPayment = evidence.fundingSource === 'COMPANY';
      const paymentAmount = isCompanyPayment && paidBefore.isZero() ? payable : new Decimal(0);
      if (paymentAmount.gt(0)) {
        const paymentCompany = await tx.company?.findUnique?.({ where: { id: input.companyId }, select: { timezone: true } });
        await tx.expensePayment.create({ data: {
          companyId: input.companyId,
          expenseId: input.expenseId,
          amount: paymentAmount.toFixed(4),
          idempotencyKey: `substitute-receipt:${evidence.id}`,
          payloadFingerprint: canonicalFingerprint({ expenseId: expense.id, amount: paymentAmount.toFixed(4), paymentMethod: evidence.paymentMethod, paidAt: evidence.paymentDate.toISOString() }),
          currency: expense.currency,
          paymentMethod: evidence.paymentMethod,
          paidAt: civilInstantDayRangeToUtc(utcDateToCivilDate(evidence.paymentDate), undefined, paymentCompany?.timezone ?? 'Asia/Bangkok').gte!,
          paidAtConfirmed: true,
          status: 'RECORDED',
          postingStatus: 'pending',
          createdByUserId: input.approverUserId,
        } });
      }
      const expenseChanged = await tx.expenseRecord.updateMany({ where: {
        id: input.expenseId,
        companyId: input.companyId,
        updatedAt: input.expectedExpenseUpdatedAt,
      }, data: {
        missingReceiptReason: evidence.missingReceiptReason,
        taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE',
        taxEvidenceReasonCode: 'HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE',
        // Never write the recorded paid amount back down: the guard above forgives a sub-satang
        // overshoot, so paidBefore can sit a fraction past the payable and still settle here.
        ...(isCompanyPayment ? {
          paidAmount: Decimal.max(paidBefore, payable).toFixed(4), outstandingAmount: '0.0000', paymentStatus: 'PAID',
          ...(paidBefore.isZero() ? { paymentMethod: evidence.paymentMethod, paidAt: evidence.paymentDate } : {}),
        } : {}),
        substituteReceiptGeneratedAt: now, substituteReceiptGeneratedByUserId: input.approverUserId,
        reviewedByUserId: input.approverUserId, reviewedAt: now, updatedByUserId: input.approverUserId,
      } });
      if (expenseChanged.count !== 1) throw new Error('Expense details changed while approving substitute evidence.');
      return mapSubstituteEvidence(await tx.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } }));
    };
    return transaction ? execute(transaction) : client.$transaction(execute);
  }

  async certifyAndIssueSubstituteEvidence(input: {
    certification: Parameters<PrismaExpenseRepository['markSubstituteEvidenceCertified']>[0];
    issuance: Parameters<PrismaExpenseRepository['issueSubstituteEvidence']>[0];
    actorRoles: readonly string[];
    auditEntries: import('../../audit/domain/models/audit-log.model').AuditLogEntry[];
  }): Promise<SubstituteReceiptEvidenceRecord> {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      const { certification, issuance } = input;
      await lockExpenseFunding(tx, certification.companyId, certification.expenseId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${certification.companyId}:${certification.expenseId}:substitute-receipt`}))`;
      const policy = await tx.expenseSubstituteReceiptPolicy.findUnique({ where: { companyId: certification.companyId } });
      if ((policy?.approvalMode ?? 'OWNER_SELF') !== 'OWNER_SELF' || !input.actorRoles.includes('OWNER')
        || certification.payerUserId !== issuance.approverUserId || !issuance.allowSelfApproval
        || certification.payerSignatureAttachmentId !== issuance.approverSignatureAttachmentId
        || certification.certifiedAt.getTime() !== issuance.approvedAt.getTime()) {
        throw new ForbiddenException('substitute_combined_signing_denied');
      }
      const evidence = await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { id: certification.evidenceId, companyId: certification.companyId, expenseId: certification.expenseId } });
      if (evidence?.signatureMode !== 'DIGITAL') throw new ForbiddenException('substitute_combined_signing_denied');
      const certified = await this.markSubstituteEvidenceCertified(certification, tx);
      const issued = await this.issueSubstituteEvidence({ ...issuance, expectedEvidenceUpdatedAt: certified.updatedAt,
        referencedAttachmentIds: [...new Set([...issuance.referencedAttachmentIds, certified.certifiedArtifactAttachmentId!])] }, tx);
      for (const entry of input.auditEntries) await new PrismaAuditRepository(this.prisma).log(entry, tx);
      return issued;
    });
  }


  async updatePostingStatus(
    companyId: string,
    id: string,
    data: { postingStatus: 'pending' | 'posted' | 'posting_error' | 'reversed'; journalEntryId?: string | null; postingError?: string | null },
  ): Promise<void> {
    await this.prisma.client.expenseRecord.updateMany({
      where: { id, companyId },
      data: {
        postingStatus: data.postingStatus as any,
        journalEntryId: data.journalEntryId,
        postingError: data.postingError,
      },
    });
  }

  async updatePaymentPostingStatus(
    companyId: string,
    paymentId: string,
    data: { postingStatus: 'pending' | 'posted' | 'posting_error' | 'reversed'; journalEntryId?: string | null; postingError?: string | null },
  ): Promise<void> {
    await this.prisma.client.expensePayment.updateMany({
      where: { id: paymentId, companyId, status: 'RECORDED' },
      data: {
        postingStatus: data.postingStatus,
        journalEntryId: data.journalEntryId,
        postingError: data.postingError,
      },
    });
  }

  /** The claim this expense record belongs to, while that claim still stands (`findLiveClaimOf`). */
  findLiveClaimOf(companyId: string, expense: { sourceReimbursementRequestId?: string | null }): Promise<ExpenseClaimOwner | null> {
    return findLiveClaimOf(this.prisma.client, companyId, expense);
  }

  /**
   * H-04: the ledger journal table is the source of truth for whether a void
   * needs a reversing entry — the postingStatus/journalEntryId pointers on the
   * expense row can lag or be corrupted and must not gate the reversal.
   */
  async findPostedGeneratedJournalId(
    companyId: string,
    expenseId: string,
    sourceType: 'expense.record' | 'expense.payment' = 'expense.record',
  ): Promise<string | null> {
    const row = await this.prisma.client.journalEntry.findFirst({
      where: { companyId, sourceType, sourceId: expenseId, entryType: 'GENERATED' as any, status: 'POSTED' as any },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async findPostedExpensePaymentJournals(
    companyId: string,
    expenseId: string,
  ): Promise<Array<{ paymentId: string; journalId: string }>> {
    const payments = await this.prisma.client.expensePayment.findMany({
      where: { companyId, expenseId, status: 'RECORDED' },
      select: { id: true },
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
    });
    if (!payments.length) return [];
    const journals = await this.prisma.client.journalEntry.findMany({
      where: {
        companyId,
        sourceType: 'expense.payment',
        sourceId: { in: payments.map((payment) => payment.id) },
        entryType: 'GENERATED',
        status: 'POSTED',
      },
      select: { id: true, sourceId: true },
    });
    const byPayment = new Map(journals.map((journal) => [journal.sourceId, journal.id]));
    return payments.flatMap((payment) => {
      const journalId = byPayment.get(payment.id);
      return journalId ? [{ paymentId: payment.id, journalId }] : [];
    });
  }

  // H-04: reverse the GENERATED journal of a voided expense inside the same
  // transaction. Fail closed: an unresolved posting state, a closed accounting
  // period, or a locked filed-form tax period blocks the whole void.
  private async reverseExpenseJournalInTx(tx: any, opts: {
    companyId: string;
    expenseId: string;
    sourceId?: string;
    // GAP-07: 'expense.record' reverses the accrual leg, 'expense.payment' the
    // settlement leg; each has its own GENERATED journal keyed on the expense id.
    sourceType?: 'expense.record' | 'expense.payment';
    reversalEntryNumber?: string;
    actorUserId: string;
    memo: string;
    lockedTaxFormTypes: string[];
  }): Promise<{ reversalEntryId: string | null; reversed: boolean }> {
    const sourceType = opts.sourceType ?? 'expense.record';
    const sourceId = opts.sourceId ?? opts.expenseId;
    // Read through the same two readers a claim cancellation asks before it starts
    // (./expense-void-blocker), so what this void refuses and what that check reports cannot drift.
    const journal = await findJournalToReverse(tx, { companyId: opts.companyId, sourceType, sourceId });
    if (journal.reversed) return { reversalEntryId: null, reversed: true };
    const original = journal.original;
    if (!original) return { reversalEntryId: null, reversed: false };
    if (journal.refusal) throw journal.refusal.error;
    if (!opts.reversalEntryNumber) {
      throw new ConflictException({ code: 'posting_state_changed', message: EXPENSE_VOID_CERTIFICATE_WORDS.changedRetry });
    }
    const { refusal } = await journalPeriodRefusal(tx, { companyId: opts.companyId, lockedTaxFormTypes: opts.lockedTaxFormTypes }, original);
    if (refusal) throw refusal.error;
    const reversalLines = buildReversalLines((original.lines ?? []).map((l: any) => ({
      accountId: l.accountId, branchId: l.branchId, description: l.description,
      debitAmount: l.debitAmount.toString(), creditAmount: l.creditAmount.toString(),
      currency: l.currency, taxCode: l.taxCode,
    })));
    const now = new Date();
    // @@unique([companyId, sourceType, sourceId, entryType]) makes a second
    // REVERSAL for this source abort the transaction — DB-level idempotency.
    const reversal = await tx.journalEntry.create({
      data: {
        companyId: opts.companyId, periodId: original.periodId, entryNumber: opts.reversalEntryNumber,
        entryType: 'REVERSAL', sourceType, sourceId,
        reversalOfJournalEntryId: original.id, status: 'POSTED', entryDate: now, postedAt: now,
        postedByUserId: opts.actorUserId, memo: opts.memo, createdByUserId: opts.actorUserId,
        lines: {
          // companyId is inherited through the compound journalEntry relation —
          // Prisma 7 rejects it as an explicit scalar in this nested create.
          create: reversalLines.map((l, idx) => ({
            accountId: l.accountId, branchId: l.branchId ?? null,
            lineNumber: idx + 1, description: l.description,
            debitAmount: parseFloat(l.debitAmount ?? '0') || 0,
            creditAmount: parseFloat(l.creditAmount ?? '0') || 0,
            currency: l.currency ?? 'THB', taxCode: l.taxCode ?? null,
          })),
        },
      },
    });
    // The original stays POSTED: GL/report queries count POSTED entries only,
    // so original + reversal net to zero. Flipping it to REVERSED would drop
    // it from reports and make the reversal double-subtract.
    return { reversalEntryId: reversal.id, reversed: true };
  }

  private async cancelExpenseCertificateInTx(tx: any, handoff: any, input: {
    companyId: string; expenseId: string; actorUserId: string; reason: string; requestId?: string;
  }, source: 'expense_reopen' | 'expense_void'): Promise<ExpenseCertificateCancellation> {
    const isExternal = handoff.status === 'EXTERNAL_LINKED';
    const certificate = !isExternal && handoff.certificateId ? await tx.whtCertificate.findFirst({
      where: { companyId: input.companyId, id: handoff.certificateId },
    }) : null;
    if (!isExternal) {
      if (!certificate) throw new ConflictException({ code: 'expense_correction_source_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
      const voided = await tx.whtCertificate.updateMany({
        where: { companyId: input.companyId, id: certificate.id, status: 'ISSUED' },
        data: { status: 'VOIDED', voidedAt: new Date(), voidedByUserId: input.actorUserId, voidReason: source === 'expense_reopen' ? 'SOURCE_REOPENED' : 'SOURCE_VOIDED' },
      });
      if (voided.count !== 1) throw new ConflictException({ code: 'expense_correction_source_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
    }
    const certificateNumber = isExternal ? handoff.externalCertificateNumber : certificate.certificateNumber;
    // Capture these before clearing the pointers; a later round must not change this notice.
    const cancelledCertificate: ExpenseCertificateCancellation = {
      issuerUserId: (isExternal ? handoff.linkedByUserId : certificate.issuedByUserId) ?? null,
      certificateNumber: certificateNumber ?? null, isExternal, certificateRound: handoff.certificateRound + 1,
    };
    await appendWhtCertificateHistory(tx, handoff, {
      eventType: isExternal ? 'EXTERNAL_RECORD_REMOVED' : source === 'expense_reopen' ? 'CANCELLED_SOURCE_REOPENED' : 'CANCELLED_SOURCE_VOIDED',
      actorUserId: input.actorUserId, isExternal, certificateId: certificate?.id ?? null,
      certificateNumber, certificateDate: isExternal ? handoff.externalIssuedDate : certificate.issuedAt,
      reason: input.reason, taxFilingAttested: true,
      ...(isExternal ? { detailsJson: { externalEvidenceRef: handoff.externalEvidenceRef ?? null, linkNote: handoff.linkNote ?? null,
        linkedAt: handoff.linkedAt?.toISOString() ?? null, linkedByUserId: handoff.linkedByUserId ?? null } } : {}),
    });
    const cancelled = await tx.whtCertificateHandoff.updateMany({
      where: { id: handoff.id, companyId: input.companyId, status: handoff.status },
      data: { status: 'CANCELLED', certificateId: null, certificateRound: { increment: 1 },
        externalCertificateNumber: null, externalEvidenceRef: null, externalIssuedDate: null,
        linkNote: null, linkCommandId: null, linkPayloadFingerprint: null, linkedAt: null, linkedByUserId: null },
    });
    if (cancelled.count !== 1) throw new ConflictException({ code: 'expense_correction_source_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
    await new PrismaAuditRepository(this.prisma).log({
      companyId: input.companyId, actorUserId: input.actorUserId, requestId: input.requestId ?? `${source}:${input.expenseId}`,
      action: 'tax.wht_certificate.cancel', targetType: isExternal ? 'wht_certificate_handoff' : 'wht_certificate',
      targetId: certificate?.id ?? handoff.id, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { source, handoffId: handoff.id, certificateNumber, isExternal, reason: input.reason, taxFilingAttested: true },
    }, tx);
    return cancelledCertificate;
  }

  // H-04: status claim, payable zeroing, certificate cancellation and GL reversal commit together.
  async voidExpenseTrueReversal(
    companyId: string,
    expenseId: string,
    actorUserId: string,
    reason: string,
    reversalEntryNumber?: string,
    paymentReversals: Array<{ paymentId: string; reversalEntryNumber: string }> | string = [],
    /** Runs first inside the void transaction; a claim cancellation fences its void with it. */
    beforeVoid?: (tx: any) => Promise<void>,
    certificateOptions: { permissions?: string[]; taxFilingAttested?: boolean; requestId?: string; authorisedByClaimCancellation?: boolean; viewerReadScope?: DisbursementReadScope; expectedUpdatedAt?: Date; scopes?: BranchScopes } = {},
  ): Promise<{ expense: ExpenseRecord; reversalEntryId: string | null; paymentReversalEntryId: string | null; paymentReversalEntryIds: Array<{ paymentId: string; reversalEntryId: string }>; cancelledCertificate: ExpenseCertificateCancellation | null; cancelledDisbursementVoucherIds: string[] }> {
    return await (this.prisma.client as any).$transaction(async (tx: any) => {
      await beforeVoid?.(tx);
      await lockExpenseFunding(tx, companyId, expenseId);
      await assertFundingMutation(tx, companyId, expenseId, 'prepare');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${expenseId}:expense-record-lifecycle`}))`;
      const current = await tx.expenseRecord.findFirst({ where: { id: expenseId, companyId } });
      if (!current || !canVoidExpenseFinancialState(current)) throw new ConflictException({ code: 'expense_changed', message: EXPENSE_VOID_CERTIFICATE_WORDS.statusChanged });
      if (certificateOptions.expectedUpdatedAt && (current.updatedAt.getTime() !== certificateOptions.expectedUpdatedAt.getTime() || !isBranchInScope(certificateOptions.scopes ?? {}, current.branchId))) throw new ConflictException('expense_source_version_changed');
      await assertExpenseDisbursementReservation(tx, current, 'void', undefined, certificateOptions.viewerReadScope ? { ...certificateOptions.viewerReadScope, permissions: certificateOptions.permissions ?? [] } : undefined);
      const events = await tx.taxEvent.findMany({ where: {
        companyId, sourceType: 'expense.record', sourceId: expenseId,
      }, select: { id: true, taxPeriodId: true, status: true } });
      const eventIds = events.map((event: any) => event.id);
      const handoffs = await tx.whtCertificateHandoff.findMany({ where: expenseWhtHandoffWhere(companyId, expenseId, eventIds) });
      if (await hasExpenseTaxWorkspaceCertificate(tx, companyId, expenseId, eventIds, handoffs)) throw new ConflictException({
        code: 'certificate_issued', message: EXPENSE_VOID_CERTIFICATE_WORDS.taxWorkspaceCertificate,
      });
      const handoff = handoffs.find((row: any) => row.sourcePaymentType === 'expense.record' && row.sourcePaymentId === expenseId
        && ['REQUIRED', 'SYSTEM_ISSUED', 'EXTERNAL_LINKED'].includes(row.status));
      const hasCertificate = handoff && ['SYSTEM_ISSUED', 'EXTERNAL_LINKED'].includes(handoff.status);
      if (hasCertificate) {
        const permission = handoff.status === 'SYSTEM_ISSUED' ? 'wht.certificate.correct' : 'wht.external_certificate.link';
        if (!certificateOptions.authorisedByClaimCancellation && !certificateOptions.permissions?.includes(permission)) throw new ForbiddenException({
          code: 'certificate_permission_missing', message: expenseVoidCertificatePermissionMessage(
            handoff.status === 'EXTERNAL_LINKED' ? 'EXTERNAL' : 'SYSTEM', handoff.status === 'EXTERNAL_LINKED'
              ? handoff.externalCertificateNumber : handoff.certificateId
                ? (await tx.whtCertificate.findFirst({ where: { companyId, id: handoff.certificateId }, select: { certificateNumber: true } }))?.certificateNumber : null),
        });
        if (certificateOptions.taxFilingAttested !== true) throw new BadRequestException({
          code: 'expense_certificate_attestation_required', message: EXPENSE_VOID_CERTIFICATE_WORDS.attestationRequired,
        });
        // Cancellation preserves filed WHT lines; VAT/accounting checks below still apply.
        await readExpensePeriodLocks(tx, current, [], true, false);
      }
      // Read before the status claim below: a document voided while open for correction has its tax records retired
      // here; a confirmed one keeps the existing path (the tax sync retires or flags them, period locks included).
      const voidedFromConfirmed = current.status === 'CONFIRMED';
      const voidedAt = new Date();
      const claimed = await tx.expenseRecord.updateMany({
        where: { id: expenseId, companyId, status: current.status, updatedAt: current.updatedAt },
        data: {
          status: 'VOIDED', voidedByUserId: actorUserId, voidedAt, voidReason: reason,
          updatedByUserId: actorUserId, paidAmount: '0.00', outstandingAmount: '0.00', paymentStatus: 'VOIDED',
        },
      });
      if (claimed.count !== 1) throw new ConflictException({ code: 'expense_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
      let cancelledCertificate: ExpenseCertificateCancellation | null = null;
      if (hasCertificate) cancelledCertificate = await this.cancelExpenseCertificateInTx(tx, handoff, {
        companyId, expenseId, actorUserId, reason, requestId: certificateOptions.requestId,
      }, 'expense_void');
      else if (handoff?.status === 'REQUIRED') {
        const cancelled = await tx.whtCertificateHandoff.updateMany({ where: {
          companyId, id: handoff.id, status: 'REQUIRED',
        }, data: { status: 'CANCELLED' } });
        if (cancelled.count !== 1) throw new ConflictException({ code: 'expense_correction_source_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
      }
      const expense = await tx.expenseRecord.findFirstOrThrow({ where: { id: expenseId, companyId }, include: { lines: true } });

      // Keep the immutable issued artifact for audit, but retire both its evidence state and
      // running number in the same transaction as the expense reversal. Downloads derive a
      // visibly VOID-stamped PDF from the original SVG; the checksummed source is never rewritten.
      const issuedEvidence = await tx.expenseSubstituteReceiptEvidence.findMany({
        where: { companyId, expenseId, status: { in: ['PREPARED', 'PAYER_CERTIFIED', 'ISSUED'] } },
        select: { id: true, documentNumber: true },
      });
      if (issuedEvidence.length > 0) {
        const evidenceIds = issuedEvidence.map((item: { id: string }) => item.id);
        await tx.expenseSubstituteReceiptEvidence.updateMany({
          where: { companyId, expenseId, id: { in: evidenceIds }, status: { in: ['PREPARED', 'PAYER_CERTIFIED', 'ISSUED'] } },
          data: {
            status: 'SUPERSEDED',
            supersededAt: voidedAt,
            supersedeReason: SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON,
          },
        });
        await tx.documentNumber.updateMany({
          where: {
            companyId,
            ownerType: SUBSTITUTE_RECEIPT_OWNER_TYPE,
            documentNumber: { in: issuedEvidence.map((item: { documentNumber: string }) => item.documentNumber) },
            status: 'COMMITTED',
          },
          data: { status: 'VOIDED', voidedAt },
        });
      }

      // Filed-form contributions on the tax-line snapshots decide the tax-period lock.
      const reversal = await this.reverseExpenseJournalInTx(tx, {
        companyId, expenseId, sourceType: 'expense.record', reversalEntryNumber, actorUserId,
        memo: `[VOID] ${expense.expenseNumber ?? expenseId}`,
        lockedTaxFormTypes: lockedTaxFormTypesOf(expense),
      });
      const requestedPaymentReversals = typeof paymentReversals === 'string'
        ? [{ paymentId: expenseId, reversalEntryNumber: paymentReversals }]
        : paymentReversals;
      const payments = typeof paymentReversals === 'string'
        ? [{ id: expenseId }]
        : tx.expensePayment
          ? await tx.expensePayment.findMany({ where: { companyId, expenseId, status: 'RECORDED' }, orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }] })
          : [];
      const cancelledDisbursementVoucherIds: string[] = [];
      const paymentReversalEntryIds: Array<{ paymentId: string; reversalEntryId: string }> = [];
      for (const payment of payments) {
        const reservedNumber = requestedPaymentReversals.find((candidate) => candidate.paymentId === payment.id)?.reversalEntryNumber;
        const paymentReversal = await this.reverseExpenseJournalInTx(tx, {
          companyId, expenseId, sourceId: payment.id, sourceType: 'expense.payment', reversalEntryNumber: reservedNumber, actorUserId,
          memo: `[VOID] ${expense.expenseNumber ?? expenseId} payment ${payment.id}`,
          lockedTaxFormTypes: [],
        });
        if (paymentReversal.reversalEntryId) {
          paymentReversalEntryIds.push({ paymentId: payment.id, reversalEntryId: paymentReversal.reversalEntryId });
        }
        if (typeof paymentReversals !== 'string') {
          await tx.expensePayment.update({
            where: { id: payment.id },
            data: {
              status: 'VOIDED', voidedByUserId: actorUserId, voidedAt: new Date(),
              postingStatus: paymentReversal.reversed ? 'reversed' : 'not_required', postingError: null,
            },
          });
          cancelledDisbursementVoucherIds.push(...await cancelDisbursementVouchersForPayments(tx, companyId, [payment.id], actorUserId, voidedAt, current.expenseNumber, true, reason));
        }
      }
      await tx.expenseRecord.update({
        where: { id: expenseId },
        data: { postingStatus: reversal.reversed ? 'reversed' : 'not_required', postingError: null },
      });
      if (!voidedFromConfirmed) await retireExpenseTaxEvents(tx, companyId, expenseId);
      const row = await tx.expenseRecord.findFirstOrThrow({ where: { id: expenseId, companyId } });
      return {
        expense: mapExpense(row),
        cancelledCertificate,
        cancelledDisbursementVoucherIds,
        reversalEntryId: reversal.reversalEntryId,
        paymentReversalEntryId: paymentReversalEntryIds[0]?.reversalEntryId ?? null,
        paymentReversalEntryIds,
      };
    }, { isolationLevel: 'Serializable' });
  }

  async confirmExpenseCas(input: {
    companyId: string;
    id: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
    expenseNumber: string;
    postingStatus: import('@watchdog-bms/contracts').ExpensePostingStatus;
    vendorSnapshotJson: Record<string, unknown> | null;
    outboxEvent: { eventKey: string; payloadJson: Record<string, unknown> };
  }): Promise<ExpenseRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await lockExpenseFunding(tx, input.companyId, input.id);
      await assertFundingMutation(tx, input.companyId, input.id, 'confirm');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.id}:substitute-receipt`}))`;
      const current = await tx.expenseRecord.findFirst({ where: { id: input.id, companyId: input.companyId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
      if (current?.status === 'CONFIRMED') return mapExpense(current);
      if (!current || current.status !== 'READY_FOR_CONFIRMATION') throw new ConflictException('expense_confirmation_source_status_changed');
      assertExpensePaidWithinPayable(current);
      await assertProjectionSource(tx, input.companyId, current);
      assertExpenseSourceDraftComplete(current.sourceChannelMetadataJson as Record<string, unknown> | null,
        { ...mapExpense(current), lines: (current.lines ?? []).map(mapLine) });
      const expenseNumber = await expenseNumberInTransaction(tx, this.documentNumbers, current, input.actorUserId);
      const changed = await tx.expenseRecord.updateMany({
        where: { id: input.id, companyId: input.companyId, status: 'READY_FOR_CONFIRMATION', updatedAt: input.expectedUpdatedAt },
        data: {
          status: 'CONFIRMED', confirmedByUserId: input.actorUserId, confirmedAt: new Date(),
          updatedByUserId: input.actorUserId, expenseNumber, postingStatus: input.postingStatus,
          ...(input.vendorSnapshotJson ? { vendorSnapshotJson: input.vendorSnapshotJson } : {}),
        },
      });
      if (changed.count !== 1) throw new Error('Expense changed while confirming. Reload and review it again.');
      // WHT certificate system issuance, Phase 1.2 (S3): a confirmed expense that withheld tax owes
      // the payee a 50 ทวิ, recorded as a durable handoff in the SAME transaction as confirmation.
      if (new Decimal(current.whtAmount ?? '0').gt(0)) {
        await createWhtHandoffForExpense(tx, { companyId: input.companyId, actorUserId: input.actorUserId, expense: current });
      }
      await tx.outboxEvent.create({
        data: {
          companyId: input.companyId,
          eventType: 'expense.confirmed',
          aggregateType: 'expense_record',
          aggregateId: input.id,
          eventKey: input.outboxEvent.eventKey,
          payloadJson: { ...input.outboxEvent.payloadJson, data: { ...(input.outboxEvent.payloadJson.data as Record<string, unknown>), expenseNumber } },
          priority: 'NORMAL',
          status: 'PENDING',
        },
      });
      return mapExpense(await tx.expenseRecord.findFirstOrThrow({ where: { id: input.id, companyId: input.companyId } }));
    });
  }

  async finalizeAndConfirmExpenseCas(input: {
    companyId: string;
    id: string;
    expectedUpdatedAt: Date;
    expectedSourceChecksum: string;
    actorUserId: string;
    expenseNumber?: string; // Legacy test/caller shape; the persisted owner decides the number.
    postingStatus: import('@watchdog-bms/contracts').ExpensePostingStatus;
    vendorSnapshotJson: Record<string, unknown> | null;
    /** Claim-born confirm under reimbursement authority: the signed ใบเบิก covers the missing
     *  receipt, so no expense-side substitute artifact is demanded (mirrors the use-case gate). */
    substituteCoveredByClaimForm?: boolean;
    /** Internal claim-review authority, rechecked against the exact persisted projection. */
    reimbursementReview?: { requestId: string; lineId: string };
    vatSourceOverride?: ExpenseVatSourceOverrideInput;
    confirmationAudit?: { requestId: string; authority?: Record<string, unknown> };
    outboxEvent: { eventKey: string; payloadJson: Record<string, unknown> };
  }, finalizeTax: ExpenseTaxFinalizer, db?: ExpenseDb): Promise<{ expense: ExpenseRecord; finalized: ExpenseLineInput[] }> {
    const confirm = async (tx: any) => {
      await lockExpenseFunding(tx, input.companyId, input.id);
      await assertFundingMutation(tx, input.companyId, input.id, 'confirm');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.id}:substitute-receipt`}))`;
      const current = await tx.expenseRecord.findFirst({
        where: { id: input.id, companyId: input.companyId },
        include: { lines: { orderBy: { lineNumber: 'asc' } }, duplicateCandidates: { where: { status: { not: 'DISMISSED' } } } },
      });
      if (current?.status === 'CONFIRMED') return { expense: mapExpense(current), finalized: [] };
      if (!current || current.status !== 'READY_FOR_CONFIRMATION') throw new ConflictException('expense_confirmation_source_status_changed');
      assertExpensePaidWithinPayable(current);
      await assertProjectionSource(tx, input.companyId, current);
      requireExpenseBranchId(current.branchId);
      assertExpenseSourceDraftComplete(current.sourceChannelMetadataJson as Record<string, unknown> | null,
        { ...mapExpense(current), lines: current.lines.map(mapLine) });
      if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new ConflictException('expense_confirmation_source_version_changed');
      const substitute = await tx.expenseSubstituteReceiptEvidence.findFirst({
        where: { companyId: input.companyId, expenseId: input.id, status: { not: 'SUPERSEDED' } }, orderBy: { version: 'desc' },
      });
      // The source checksum covers attachments, so the CAS re-read must load
      // them the same way findByIdWithRelations does — an empty list here
      // makes every attachment-bearing expense fail the checksum guard.
      const evidenceSources = (await loadExpenseEvidenceSources(tx, input.companyId, [current])).get(current.id)!;
      const currentLines = current.lines.map(mapLine);
      const mappedCurrent = mapExpense(current);
      const currentRecord: ExpenseRecordWithRelations = {
        ...mappedCurrent,
        lines: currentLines,
        charges: expenseLineCharges(currentLines),
        totalsIdentity: expenseTotalsIdentity({ vatMode: mappedCurrent.vatMode, totals: mappedCurrent, lines: currentLines }),
        attachments: evidenceSources.attachments,
        // Candidate identity stays null here on purpose: this record only feeds the confirm
        // checksum guard (which ignores duplicateCandidates) and never reaches a screen, so
        // joining the other expense would buy nothing on the hot confirm path.
        duplicateCandidates: current.duplicateCandidates.map((row: any) => ({
          id: row.id, candidateExpenseId: row.candidateExpenseId, reasonCodesJson: row.reasonCodesJson ?? [], score: row.score,
          candidateExpenseNumber: null, candidateVendorName: null, candidateExpenseDate: null, candidateGrandTotalAmount: null,
          status: row.status, resolvedAt: row.resolvedAt?.toISOString() ?? null, resolutionReason: row.resolutionReason ?? null,
        })),
        substituteReceiptEvidence: substitute ? toSubstituteEvidenceSummary(mapSubstituteEvidence(substitute)) : null,
        payments: [],
      };
      if (expenseTaxSourceChecksum(currentRecord) !== input.expectedSourceChecksum) throw new ConflictException('expense_confirmation_source_checksum_changed');
      const whtCategoryCode = await matchingExpenseWhtCategory(tx, current);

      const coveredByClaimForm = Boolean(input.substituteCoveredByClaimForm)
        && !current.substituteReceiptGeneratedAt && current.sourceDocumentType !== 'SUBSTITUTE_RECEIPT';
      if (input.reimbursementReview && (input.reimbursementReview.requestId !== current.sourceReimbursementRequestId
        || input.reimbursementReview.lineId !== current.sourceReimbursementLineId)) {
        throw new ForbiddenException('reimbursement_projection_authority_mismatch');
      }
      const reviewedByClaim = Boolean(input.reimbursementReview)
        && !current.substituteReceiptGeneratedAt && current.sourceDocumentType !== 'SUBSTITUTE_RECEIPT';
      const evidenceError = expenseEvidenceConfirmationError(currentRecord, coveredByClaimForm || reviewedByClaim);
      if (evidenceError) throw new ConflictException({ code: 'EXPENSE_EVIDENCE_REVIEW_REQUIRED', message: evidenceError });
      let acceptedVat: ReturnType<typeof acceptExpenseVatSource> | undefined;
      if (input.vatSourceOverride) {
        if (typeof input.vatSourceOverride.expectedUpdatedAt !== 'string'
          || new Date(input.vatSourceOverride.expectedUpdatedAt).getTime() !== current.updatedAt.getTime()) {
          throw new ConflictException({ code: 'EXPENSE_VAT_OVERRIDE_STALE', message: 'Reload and review the current VAT amounts before accepting them.' });
        }
        try { acceptedVat = acceptExpenseVatSource(currentRecord, input.vatSourceOverride); }
        catch (error) {
          throw new BadRequestException({ code: 'EXPENSE_VAT_OVERRIDE_INVALID', message: (error as Error).message });
        }
      }
      const acceptedRecord = acceptedVat ? {
        ...currentRecord, ...acceptedVat.totals, vatCaptureSnapshotJson: acceptedVat.snapshot,
        lines: currentRecord.lines.map((line) => ({
          ...line, ...acceptedVat!.lines.find((item) => item.lineNumber === line.lineNumber)!.totals,
        })),
      } : currentRecord;
      assertExpensePaidWithinPayable(acceptedRecord);
      const finalized = await finalizeTax({ db: tx, expense: acceptedRecord });
      const expectedLineIds = currentRecord.lines.filter((line) => line.taxSnapshot?.taxCodeDefinitionId || line.taxSnapshot?.externalTaxCode).map((line) => line.id);
      if (finalized.length !== expectedLineIds.length || new Set(finalized.map((line) => line.sourceLineId)).size !== finalized.length
        || finalized.some((line) => !line.sourceLineId || !expectedLineIds.includes(line.sourceLineId)
          || !line.taxSnapshot || !line.taxComponents?.length || line.taxSnapshot.evidenceStatus === 'REVIEW_REQUIRED')) {
        throw new ConflictException('expense_confirmation_tax_line_changed');
      }
      if (finalized.some((line) => isDomesticTaxSnapshot(line.taxSnapshot) && line.taxSnapshot?.evidenceStatus !== 'VERIFIED')) {
        throw new ConflictException('expense_confirmation_tax_evidence_changed');
      }
      if (acceptedRecord.vatCaptureSnapshotJson?.reconciliation.acceptedSource === 'SOURCE_AMOUNT'
        && finalized.some((line) => line.taxSnapshot?.taxContext === 'DOMESTIC_PURCHASE' && line.taxSnapshot.taxRegime === 'VAT'
          && (!new Decimal(line.taxSnapshot!.taxAmount).eq(line.vatAmount)
            || !new Decimal(line.taxSnapshot!.taxBaseAmount).eq(line.taxableAmount)))) {
        throw new ConflictException('expense_confirmation_accepted_vat_changed');
      }
      const evidenceIds = [...new Set(finalized.flatMap((line) => line.taxSnapshot?.evidenceRefs ?? []))];
      if (evidenceIds.length) {
        const evidence = await tx.tradeTaxEvidence.findMany({ where: {
          companyId: input.companyId, id: { in: evidenceIds }, status: 'VERIFIED', reviewedByUserId: { not: null }, reviewedAt: { not: null },
        } });
        const attachmentIds = [...new Set(evidence.flatMap((row: any) => Array.isArray(row.attachmentIdsJson) ? row.attachmentIdsJson : []))];
        const activeAttachmentCount = attachmentIds.length ? await tx.attachmentObject.count({
          where: { companyId: input.companyId, id: { in: attachmentIds }, status: 'ACTIVE' },
        }) : 0;
        if (evidence.length !== evidenceIds.length || activeAttachmentCount !== attachmentIds.length) {
          throw new ConflictException('expense_confirmation_tax_evidence_changed');
        }
      }

      const periodLocks = await readExpensePeriodLocks(tx, { ...acceptedRecord, lines: finalized.map(line => ({ taxComponentsJson: line.taxComponents })) }, [], true, false);
      if (periodLocks.lockedAccountingPeriodKey) throw new ConflictException(`expense_confirmation_accounting_period_locked:${periodLocks.lockedAccountingPeriodKey}`);
      const lockedTaxPeriod = periodLocks.lockedTaxPeriods[0];
      if (lockedTaxPeriod) throw new ConflictException(`expense_confirmation_tax_period_locked:${lockedTaxPeriod.formType}:${lockedTaxPeriod.periodKey}`);

      for (const line of finalized) {
        const changed = await tx.expenseLine.updateMany({
          where: { id: line.sourceLineId, companyId: input.companyId, expenseId: input.id },
          data: expenseLineTaxSnapshotData(line),
        });
        if (changed.count !== 1) throw new ConflictException('expense_confirmation_tax_line_changed');
      }
      if (acceptedVat) {
        for (const line of acceptedRecord.lines) {
          const changed = await tx.expenseLine.updateMany({
            where: { id: line.id, companyId: input.companyId, expenseId: input.id },
            data: acceptedVat.lines.find((item) => item.lineNumber === line.lineNumber)!.totals,
          });
          if (changed.count !== 1) throw new ConflictException('expense_confirmation_tax_line_changed');
        }
      }
      const expenseNumber = await expenseNumberInTransaction(tx, this.documentNumbers, current, input.actorUserId);
      const changed = await tx.expenseRecord.updateMany({
        where: { id: input.id, companyId: input.companyId, status: 'READY_FOR_CONFIRMATION', updatedAt: input.expectedUpdatedAt },
        data: {
          status: 'CONFIRMED', confirmedByUserId: input.actorUserId, confirmedAt: new Date(), updatedByUserId: input.actorUserId,
          expenseNumber, postingStatus: input.postingStatus,
          ...(whtCategoryCode !== current.whtCategoryCode ? { whtCategoryCode } : {}),
          ...(acceptedVat && {
            ...acceptedVat.totals, vatCaptureSnapshotJson: acceptedVat.snapshot,
            ...calcPaymentAmounts(acceptedVat.totals.netPayableAmount, currentRecord.paidAmount),
            paymentStatus: derivePaymentStatus(acceptedVat.totals.netPayableAmount, currentRecord.paidAmount),
          }),
          ...(input.vendorSnapshotJson ? { vendorSnapshotJson: input.vendorSnapshotJson } : {}),
        },
      });
      if (changed.count !== 1) throw new ConflictException('expense_confirmation_source_version_changed');
      // WHT certificate system issuance, Phase 1.2 (S3): a confirmed expense that withheld tax owes
      // the payee a 50 ทวิ, recorded as a durable handoff in the SAME transaction as confirmation.
      // The withheld amount reads from `acceptedRecord` (not `current`) because a VAT source override
      // can recompute whtAmount from `whtInputJson`; the category/rate classification is untouched by
      // that recompute, so it still reads from the raw row.
      if (new Decimal(acceptedRecord.whtAmount ?? '0').gt(0)) {
        await createWhtHandoffForExpense(tx, {
          companyId: input.companyId, actorUserId: input.actorUserId,
          expense: {
            id: current.id, branchId: current.branchId, whtAmount: acceptedRecord.whtAmount,
            whtCategoryCode: whtCategoryCode ?? null, whtRate: current.whtRate,
            vendorCounterpartyId: current.vendorCounterpartyId, vendorNameSnapshot: current.vendorNameSnapshot,
            vendorTaxIdSnapshot: current.vendorTaxIdSnapshot, vendorAddressSnapshot: current.vendorAddressSnapshot,
            vendorBranchCodeSnapshot: current.vendorBranchCodeSnapshot, vendorEntityKindSnapshot: current.vendorEntityKindSnapshot,
            expenseDate: current.expenseDate, grandTotalAmount: acceptedRecord.grandTotalAmount,
            whtInputJson: current.whtInputJson, lines: acceptedRecord.lines,
          },
        });
      }
      await tx.outboxEvent.create({ data: {
        companyId: input.companyId, eventType: 'expense.confirmed', aggregateType: 'expense_record', aggregateId: input.id,
        eventKey: input.outboxEvent.eventKey, payloadJson: { ...input.outboxEvent.payloadJson, data: { ...(input.outboxEvent.payloadJson.data as Record<string, unknown>), expenseNumber } }, priority: 'NORMAL', status: 'PENDING',
      } });
      const expense = mapExpense(await tx.expenseRecord.findFirstOrThrow({ where: { id: input.id, companyId: input.companyId } }));
      if (input.confirmationAudit) await new PrismaAuditRepository(this.prisma).log({
        companyId: input.companyId, actorUserId: input.actorUserId, action: 'expense.confirm', targetType: 'expense_record',
        targetId: input.id, requestId: input.confirmationAudit.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { expenseNumber, grandTotalAmount: expense.grandTotalAmount, ...input.confirmationAudit.authority },
      }, tx);
      return { expense, finalized };
    };
    return db ? confirm(db) : serializableTransaction(this.prisma.client, confirm);
  }

  async terminalizeUnconfirmedClaimProjection(input: {
    companyId: string;
    expenseId: string;
    reimbursementRequestId: string;
    reimbursementLineId: string;
    actorUserId: string;
    reason: string;
    eventKey: string;
    payloadJson: Record<string, unknown>;
    /** Runs first inside the transaction; a claim cancellation fences its void with it. */
    beforeVoid?: (tx: any) => Promise<void>;
  }): Promise<ExpenseRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await input.beforeVoid?.(tx);
      const current = await tx.expenseRecord.findFirst({
        where: {
          id: input.expenseId,
          companyId: input.companyId,
          sourceReimbursementRequestId: input.reimbursementRequestId,
          sourceReimbursementLineId: input.reimbursementLineId,
        },
      });
      if (!current) throw new NotFoundException('Reimbursement expense projection not found');
      if (current.status === 'VOIDED') return mapExpense(current);
      if (current.status !== 'READY_FOR_CONFIRMATION') {
        throw new ConflictException('reimbursement_projection_requires_true_reversal');
      }
      const changed = await tx.expenseRecord.updateMany({
        where: {
          id: input.expenseId,
          companyId: input.companyId,
          sourceReimbursementRequestId: input.reimbursementRequestId,
          sourceReimbursementLineId: input.reimbursementLineId,
          status: 'READY_FOR_CONFIRMATION',
          updatedAt: current.updatedAt,
        },
        data: {
          status: 'VOIDED',
          voidedByUserId: input.actorUserId,
          voidedAt: new Date(),
          voidReason: input.reason,
          postingStatus: 'not_required',
          updatedByUserId: input.actorUserId,
        },
      });
      if (changed.count !== 1) throw new ConflictException('reimbursement_projection_state_changed');
      await tx.outboxEvent.createMany({
        data: [{
          companyId: input.companyId,
          eventType: 'expense.voided',
          aggregateType: 'expense_record',
          aggregateId: input.expenseId,
          eventKey: input.eventKey,
          payloadJson: input.payloadJson,
          priority: 'NORMAL',
          status: 'PENDING',
        }],
        skipDuplicates: true,
      });
      return mapExpense(await tx.expenseRecord.findFirstOrThrow({
        where: { id: input.expenseId, companyId: input.companyId },
      }));
    });
  }

  async countPostingBlockers(companyId: string, fromDate: Date, toDate: Date): Promise<{ pending: number; errors: number }> {
    const where = {
      companyId,
      expenseDate: { gte: fromDate, lt: exclusiveEndOfDay(toDate) },
      status: 'CONFIRMED' as any,
    };
    const [pending, errors, pendingPayments, paymentErrors] = await Promise.all([
      this.prisma.client.expenseRecord.count({ where: { ...where, postingStatus: 'pending' as any } }),
      this.prisma.client.expenseRecord.count({ where: { ...where, postingStatus: 'posting_error' as any } }),
      this.prisma.client.expensePayment.count({
        where: {
          companyId, status: 'RECORDED', postingStatus: 'pending', paidAt: { gte: fromDate, lt: exclusiveEndOfDay(toDate) },
          expense: { is: { status: 'CONFIRMED', sourceReimbursementRequestId: null } },
        },
      }),
      this.prisma.client.expensePayment.count({
        where: {
          companyId, status: 'RECORDED', postingStatus: 'posting_error', paidAt: { gte: fromDate, lt: exclusiveEndOfDay(toDate) },
          expense: { is: { status: 'CONFIRMED', sourceReimbursementRequestId: null } },
        },
      }),
    ]);
    return { pending: pending + pendingPayments, errors: errors + paymentErrors };
  }

  /**
   * Spec §5.1: `updateExpenseDraft` replaces the whole line array, and a client that echoes a line
   * back without `chargeKind` means "leave it alone", not "clear it". The description rides along
   * because `lineNumber` alone is NOT a stable identity — inserting a goods row renumbers everything
   * below it — so the caller can check it is looking at the same row before keeping a kind.
   *
   * Runs on the caller's transaction when there is one: the update path reads this before writing in
   * the same transaction, and a read outside it would see a stale row under concurrent edits.
   */
  async listLineChargeKinds(
    companyId: string,
    expenseId: string,
    db: ExpenseDb = this.prisma.client,
  ): Promise<Map<number, { chargeKind: ExpenseLineChargeKind | null; description: string }>> {
    const rows = await db.expenseLine.findMany({
      where: { companyId, expenseId }, select: { lineNumber: true, chargeKind: true, description: true },
    });
    return new Map(rows.map((row) => [row.lineNumber, { chargeKind: row.chargeKind ?? null, description: row.description }]));
  }

  async upsertLines(companyId: string, expenseId: string, lines: ExpenseLineInput[], db?: any, preserveLineIdentity = false): Promise<void> {
    await this.runInTx(db, async (tx: any) => {
      await lockExpenseFunding(tx, companyId, expenseId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${expenseId}:substitute-receipt`}))`;
      const signedEvidence = await tx.expenseSubstituteReceiptEvidence.findFirst({
        where: { companyId, expenseId, status: { in: ['PAYER_CERTIFIED', 'ISSUED'] } }, select: { id: true },
      });
      if (signedEvidence && !this.reviewRefreshTransactions.has(tx)) throw new ConflictException({ code: 'substitute_evidence_locks_lines', message: 'Signed substitute evidence locks expense lines. Prepare a corrected version before changing them.' });
      const preservedIds = lines.flatMap((line) => line.preserveLineId ? [line.preserveLineId] : []);
      if (preserveLineIdentity || preservedIds.length) {
        const existing = await tx.expenseLine.findMany({ where: { expenseId, companyId }, select: { id: true } });
        if (new Set(preservedIds).size !== preservedIds.length || preservedIds.some((id) => !existing.some((row: { id: string }) => row.id === id))) {
          throw new ConflictException('expense_source_line_identity_changed');
        }
        // Vacate positions inside the transaction before inserting a new product ahead of charges.
        // The existing ids (and tax/evidence references to them) survive reordering.
        for (const [index, id] of preservedIds.entries()) await tx.expenseLine.update({ where: { id }, data: { lineNumber: -(index + 1) } });
        await tx.expenseLine.deleteMany({ where: { expenseId, companyId, id: { notIn: preservedIds } } });
      } else await tx.expenseLine.deleteMany({ where: { expenseId, companyId, lineNumber: { notIn: lines.map((line) => line.lineNumber) } } });
      if (lines.length > 0) {
        for (const l of lines) {
          const { taxSnapshot, taxComponents } = l;
          const data = {
          expenseId, companyId, lineNumber: l.lineNumber, description: l.description,
          chargeKind: l.chargeKind ?? null,
          quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: l.discountAmount,
          taxableAmount: l.taxableAmount, vatRate: l.vatRate, vatTreatment: l.vatTreatment ?? null, vatAmount: l.vatAmount,
          whtCategoryCode: l.whtCategoryCode ?? null, whtRate: l.whtRate, whtAmount: l.whtAmount, lineSubtotalAmount: l.lineSubtotalAmount,
          lineTotalAmount: l.lineTotalAmount, expenseCategoryId: l.expenseCategoryId,
          accountHintKey: l.accountHintKey, taxCategory: l.taxCategory, sourceLineText: l.sourceLineText,
          aiLineConfidence: l.aiLineConfidence, reviewStatus: l.reviewStatus,
          taxCodeDefinitionId: taxSnapshot?.taxCodeDefinitionId ?? null,
          externalTaxCodeSnapshot: taxSnapshot?.externalTaxCode ?? null,
          taxProfileKeySnapshot: taxSnapshot?.taxProfileKey ?? null,
          taxProfileVersionSnapshot: taxSnapshot?.taxProfileVersion ?? null,
          roundingModeSnapshot: taxSnapshot?.roundingMode ?? null,
          roundingScaleSnapshot: taxSnapshot?.roundingScale ?? null,
          taxAmountToleranceSnapshot: taxSnapshot?.taxAmountTolerance ?? null,
          taxRegimeSnapshot: taxSnapshot?.taxRegime ?? null,
          taxDirectionSnapshot: taxSnapshot?.taxDirection ?? null,
          taxTreatmentSnapshot: taxSnapshot?.taxTreatment ?? null,
          taxContextSnapshot: taxSnapshot?.taxContext ?? null,
          taxRateSnapshot: taxSnapshot?.taxRate ?? null,
          sourceCurrencySnapshot: taxSnapshot?.sourceCurrency ?? null,
          taxCurrencySnapshot: taxSnapshot?.taxCurrency ?? null,
          exchangeRateSnapshot: taxSnapshot?.exchangeRate ?? null,
          exchangeRateSourceSnapshot: taxSnapshot?.exchangeRateSource ?? null,
          exchangeRateDateSnapshot: taxSnapshot?.exchangeRateDate ? new Date(taxSnapshot.exchangeRateDate) : null,
          taxBaseAmount: taxSnapshot?.taxBaseAmount ?? null,
          transactionTaxAmount: taxSnapshot?.taxAmount ?? null,
          claimabilitySnapshot: taxSnapshot?.claimability ?? null,
          accountRuleVersionSnapshot: taxSnapshot?.accountRuleVersion ?? null,
          reportRuleVersionSnapshot: taxSnapshot?.reportRuleVersion ?? null,
          taxEvidenceReviewStatus: taxSnapshot?.evidenceStatus ?? null,
          taxComponentsJson: taxComponents ?? null,
          accountAssignmentsJson: taxComponents?.flatMap((component) => component.accountAssignments) ?? null,
          };
          if (l.preserveLineId) {
            await tx.expenseLine.update({ where: { id: l.preserveLineId }, data });
            continue;
          }
          await tx.expenseLine.upsert({
            where: { expenseId_lineNumber: { expenseId, lineNumber: l.lineNumber } },
            create: data,
            update: data,
          });
        }
      }
    });
  }

  async deleteDraftExpense(companyId: string, id: string, expectedUpdatedAt?: Date): Promise<void> {
    await this.prisma.client.expenseRecord.deleteMany({
      where: { id, companyId, status: 'DRAFT' as any, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
    });
  }

  /** Names of these categories whatever their status: an archived category still names the expenses filed under it. */
  async listCategoryNames(companyId: string, ids: string[]): Promise<Array<{ id: string; name: string }>> {
    if (ids.length === 0) return [];
    return this.prisma.client.expenseCategory.findMany({
      where: { id: { in: ids }, OR: [{ companyId }, { companyId: null }] },
      select: { id: true, name: true },
    });
  }

  async listCategories(companyId: string): Promise<ExpenseCategorySummary[]> {
    const cats = await this.prisma.client.expenseCategory.findMany({
      where: { OR: [{ companyId }, { companyId: null }] },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const selected = selectExpenseCategoryScope(cats, companyId);
    return selected.filter((c) => c.status === 'ACTIVE').map((c): ExpenseCategorySummary => ({ id: c.id, companyId: c.companyId, name: c.name, accountHintKey: c.accountHintKey, defaultInputTaxCode: c.defaultInputTaxCode, status: c.status as any, sortOrder: c.sortOrder }));
  }

  async createCategory(companyId: string, input: CreateExpenseCategoryInput): Promise<ExpenseCategorySummary> {
    const c = await this.prisma.client.expenseCategory.create({ data: { companyId, name: input.name, accountHintKey: input.accountHintKey, defaultInputTaxCode: input.defaultInputTaxCode ?? null, sortOrder: input.sortOrder ?? 0 } });
    return { id: c.id, companyId: c.companyId, name: c.name, accountHintKey: c.accountHintKey, defaultInputTaxCode: c.defaultInputTaxCode, status: c.status as any, sortOrder: c.sortOrder };
  }

  /** Company-owned category only; global defaults (companyId null) are read-only. */
  async findCategoryById(companyId: string, categoryId: string): Promise<ExpenseCategorySummary | null> {
    const c = await this.prisma.client.expenseCategory.findFirst({ where: { id: categoryId, companyId } });
    return c ? { id: c.id, companyId: c.companyId, name: c.name, accountHintKey: c.accountHintKey, defaultInputTaxCode: c.defaultInputTaxCode, status: c.status as any, sortOrder: c.sortOrder } : null;
  }

  async updateCategory(companyId: string, categoryId: string, input: UpdateExpenseCategoryInput): Promise<ExpenseCategorySummary> {
    const c = await this.prisma.client.expenseCategory.update({
      where: { id: categoryId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.accountHintKey !== undefined && { accountHintKey: input.accountHintKey }),
        ...(input.defaultInputTaxCode !== undefined && { defaultInputTaxCode: input.defaultInputTaxCode }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        ...(input.status !== undefined && { status: input.status as any }),
      },
    });
    return { id: c.id, companyId: c.companyId, name: c.name, accountHintKey: c.accountHintKey, defaultInputTaxCode: c.defaultInputTaxCode, status: c.status as any, sortOrder: c.sortOrder };
  }

  /** Management view: bootstrapped company set, or de-duplicated legacy global fallback. */
  async listAllCategories(companyId: string): Promise<ExpenseCategorySummary[]> {
    const cats = await this.prisma.client.expenseCategory.findMany({
      where: { OR: [{ companyId }, { companyId: null }] },
      orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    const selected = selectExpenseCategoryScope(cats, companyId);
    return selected.map((c): ExpenseCategorySummary => ({ id: c.id, companyId: c.companyId, name: c.name, accountHintKey: c.accountHintKey, defaultInputTaxCode: c.defaultInputTaxCode, status: c.status as any, sortOrder: c.sortOrder }));
  }

  async findNearDuplicates(
    companyId: string,
    excludeId: string,
    since: Date,
    db: ExpenseDb = this.prisma.client,
    scopes: { branchIds?: string[] } = {},
  ): Promise<Array<{ id: string; checksumSha256: string | null; perceptualHash: string | null; vendorDocumentNumber: string | null; vendorTaxId: string | null; expenseDate: string | null; grandTotalAmount: string; vendorCounterpartyId: string | null; vendorName: string | null; captureGroupId: string | null }>> {
    const rows = await db.expenseRecord.findMany({
      where: {
        companyId,
        id: { not: excludeId },
        status: { not: 'VOIDED' as any },
        createdAt: { gte: since },
        ...branchScopeWhere(scopes),
      },
      // `captureGroupId` travels with the fingerprint so the caller can drop a SIBLING of the same
      // capture group: those expenses share one file on purpose (appendix §5) and are not copies.
      select: { id: true, primaryAttachmentId: true, vendorDocumentNumber: true, vendorTaxIdSnapshot: true, vendorNameSnapshot: true, expenseDate: true, grandTotalAmount: true, vendorCounterpartyId: true, captureGroupId: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const attachmentIds = rows.flatMap((row) => row.primaryAttachmentId ? [row.primaryAttachmentId] : []);
    const attachments = attachmentIds.length > 0
      ? await db.attachmentObject.findMany({
          where: { companyId, id: { in: attachmentIds }, status: 'ACTIVE' as any },
          select: { id: true, checksumSha256: true, perceptualHash: true },
        })
      : [];
    const fingerprints = new Map(attachments.map((attachment) => [attachment.id, attachment]));
    return rows.map((r) => ({
      id: r.id,
      checksumSha256: r.primaryAttachmentId ? fingerprints.get(r.primaryAttachmentId)?.checksumSha256 ?? null : null,
      perceptualHash: r.primaryAttachmentId ? fingerprints.get(r.primaryAttachmentId)?.perceptualHash ?? null : null,
      vendorDocumentNumber: r.vendorDocumentNumber,
      vendorTaxId: r.vendorTaxIdSnapshot,
      expenseDate: r.expenseDate?.toISOString() ?? null,
      grandTotalAmount: r.grandTotalAmount?.toString() ?? '0',
      vendorCounterpartyId: r.vendorCounterpartyId,
      vendorName: r.vendorNameSnapshot,
      captureGroupId: r.captureGroupId ?? null,
    }));
  }

  async createDuplicateCandidate(companyId: string, expenseId: string, candidateExpenseId: string, reasonCodesJson: string[], score: number, db: ExpenseDb = this.prisma.client): Promise<void> {
    await db.expenseDuplicateCandidate.upsert({
      where: { companyId_expenseId_candidateExpenseId: { companyId, expenseId, candidateExpenseId } },
      create: { companyId, expenseId, candidateExpenseId, reasonCodesJson, score },
      update: {},
    });
    await db.expenseDuplicateCandidate.updateMany({
      where: {
        companyId,
        expenseId,
        candidateExpenseId,
        OR: [
          { status: 'OPEN' },
          { status: 'DISMISSED', resolvedByUserId: null, resolutionReason: AUTO_STALE_DUPLICATE_REASON },
        ],
      },
      data: {
        reasonCodesJson,
        score,
        status: 'OPEN',
        resolvedByUserId: null,
        resolvedAt: null,
        resolutionReason: null,
      },
    });
  }

  private async assertDuplicateWriteAllowed(
    tx: Prisma.TransactionClient,
    input: { companyId: string; expenseId: string; scopes: { branchIds?: string[] }; reimbursementRequestId?: string; reimbursementBranchId?: string },
  ): Promise<void> {
    // ponytail: duplicate writes are low-frequency; one company lock avoids cross-writer lock cycles.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:duplicate-reconciliation`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.expenseId}:substitute-receipt`}))`;
    const expense = await tx.expenseRecord.findFirst({
      where: { id: input.expenseId, companyId: input.companyId },
      select: { branchId: true, status: true, postingStatus: true, sourceReimbursementRequestId: true },
    });
    if (!expense) throw new NotFoundException(`Expense ${input.expenseId} not found`);
    if (input.reimbursementRequestId && (expense.sourceReimbursementRequestId !== input.reimbursementRequestId || (expense.branchId ?? undefined) !== input.reimbursementBranchId)) throw new ConflictException('reimbursement_projection_source_mismatch');
    if (!isBranchInScope(input.scopes, expense.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    if (!['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status)) {
      throw new BadRequestException(`Cannot change duplicate state for expense in status ${expense.status}`);
    }
    if (expense.postingStatus === 'posted' || expense.postingStatus === 'reversed') {
      throw new BadRequestException(`Cannot change duplicate state for expense in posting status ${expense.postingStatus}`);
    }
  }

  /** `db` joins a caller's transaction. Required when the caller already holds the
   *  `duplicate-reconciliation` advisory lock this method takes: a nested `$transaction` would
   *  wait on a lock its own caller holds and never return — and would compute the reconciliation
   *  from rows the caller has not committed yet. */
  async runDuplicateCheck(
    input: { companyId: string; expenseId: string; actorUserId: string; scopes: { branchIds?: string[] } },
    detectWithinTx: (tx: Prisma.TransactionClient) => Promise<string[]>,
    db?: any,
  ): Promise<{ openCandidates: number; duplicateStatus: 'NO_MATCH' | 'POSSIBLE_DUPLICATE' | 'CONFIRMED_DUPLICATE' | 'OVERRIDDEN' }> {
    return this.runInTx(db, async (tx: Prisma.TransactionClient) => {
      await this.assertDuplicateWriteAllowed(tx, input);
      const matchedExpenseIds = await detectWithinTx(tx);
      await tx.expenseDuplicateCandidate.updateMany({
        where: {
          companyId: input.companyId,
          expenseId: input.expenseId,
          status: 'OPEN',
          candidateExpense: { companyId: input.companyId, ...branchScopeWhere(input.scopes) },
          ...(matchedExpenseIds.length > 0 && { candidateExpenseId: { notIn: matchedExpenseIds } }),
        },
        data: {
          status: 'DISMISSED',
          resolvedByUserId: null,
          resolvedAt: new Date(),
          resolutionReason: AUTO_STALE_DUPLICATE_REASON,
        },
      });
      let candidates = await tx.expenseDuplicateCandidate.findMany({
        where: { companyId: input.companyId, expenseId: input.expenseId },
        select: { id: true, candidateExpenseId: true, status: true, resolvedByUserId: true },
      });
      const confirmed = candidates.find((row) => row.status === 'CONFIRMED_DUPLICATE');
      if (confirmed && candidates.some((row) => row.status === 'OPEN')) {
        await tx.expenseDuplicateCandidate.updateMany({
          where: {
            companyId: input.companyId,
            expenseId: input.expenseId,
            status: 'OPEN',
          },
          data: {
            status: 'DISMISSED',
            resolvedByUserId: input.actorUserId,
            resolvedAt: new Date(),
            resolutionReason: SUPERSEDED_DUPLICATE_REASON,
          },
        });
        candidates = candidates.map((row) => row.status === 'OPEN' ? { ...row, status: 'DISMISSED' } : row);
      }
      const openCandidates = candidates.filter((row) => row.status === 'OPEN').length;
      const hasOpen = openCandidates > 0;
      const hasHumanDismissal = candidates.some((row) => row.status === 'DISMISSED' && row.resolvedByUserId);
      const duplicateStatus = confirmed ? 'CONFIRMED_DUPLICATE' : hasOpen ? 'POSSIBLE_DUPLICATE' : hasHumanDismissal ? 'OVERRIDDEN' : 'NO_MATCH';
      const expense = await tx.expenseRecord.updateMany({
        where: { id: input.expenseId, companyId: input.companyId },
        data: {
          duplicateStatus,
          duplicateOfExpenseId: confirmed?.candidateExpenseId ?? null,
          ...(duplicateStatus !== 'OVERRIDDEN' && { duplicateOverrideReason: null }),
          ...(confirmed && { postingStatus: 'not_required' }),
          updatedByUserId: input.actorUserId,
        },
      });
      if (expense.count !== 1) throw new NotFoundException(`Expense ${input.expenseId} not found`);
      return { openCandidates, duplicateStatus };
    });
  }

  /**
   * Records a LINE correction may target: captured by THIS user, in THIS chat, inside the
   * caller's branch scope, still editable, and recent. Branch scope is applied here rather than
   * only at the mutation gate — a user whose scope was revoked must not even see the summary.
   * `EXTRACTING` is excluded to match the web edit-block while OCR is in flight.
   */
  async listRecentLineCaptures(input: {
    companyId: string;
    createdByUserId: string;
    chatKeyHash: string;
    since: Date;
    scopes: { branchIds?: string[] };
    take: number;
    includeAllStatuses?: boolean;
    expenseIds?: string[];
  }): Promise<Array<{ id: string; expenseDate: Date | null; grandTotalAmount: string | null; vendorDocumentNumber: string | null; sourceDocumentType: string | null; createdAt: Date }>> {
    if (input.expenseIds && (!input.expenseIds.length || input.expenseIds.length > 5)) return [];
    const rows = await this.prisma.client.expenseRecord.findMany({
      where: {
        companyId: input.companyId,
        createdByUserId: input.createdByUserId,
        captureSource: 'LINE_UPLOAD',
        ...(input.expenseIds ? { id: { in: input.expenseIds } } : {}),
        ...(input.includeAllStatuses ? {} : { status: { in: ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'] as any } }),
        createdAt: { gte: input.since },
        // Rows captured before chatKeyHash existed simply never match — accepted transitional gap.
        sourceChannelMetadataJson: { path: ['chatKeyHash'], equals: input.chatKeyHash },
        ...branchScopeWhere(input.scopes),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.take,
      // ponytail: served by the existing (companyId, captureSource) index plus a filter+sort;
      // fine at SME LINE-capture volumes. Add (companyId, captureSource, createdAt) if a company's
      // LINE upload history ever makes this scan show up.
      // `vendorDocumentNumber` rides along so `expense.explain_record` can resolve a
      // documentNumber reference inside the SAME provenance-bounded set, with no second query.
      select: { id: true, expenseDate: true, grandTotalAmount: true, vendorDocumentNumber: true, sourceDocumentType: true, createdAt: true },
    });
    return rows.map((row: any) => ({
      id: row.id,
      expenseDate: row.expenseDate ?? null,
      grandTotalAmount: row.grandTotalAmount?.toString() ?? null,
      vendorDocumentNumber: row.vendorDocumentNumber ?? null,
      sourceDocumentType: row.sourceDocumentType ?? null,
      createdAt: row.createdAt,
    }));
  }

  /** Bounded discovery for the expense-specific LINE substitute-receipt continuation. */
  async listLineSubstituteContinuationRows(input: {
    companyId: string;
    userId: string;
    chatKeyHash: string;
    scopes: { branchIds?: string[] };
    take?: number;
  }): Promise<Array<{ id: string; updatedAt: Date; sourceChannelMetadataJson: Record<string, unknown> | null }>> {
    const rows = await this.prisma.client.expenseRecord.findMany({
      where: {
        companyId: input.companyId,
        status: { in: ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'] as any },
        // Both JSON path filters run in SQL so `take` bounds the RIGHT set. Filtering the chat in JS
        // afterwards silently dropped older chats out of the window for anyone holding more than
        // `take` substitute drafts company-wide — and the caller reads "no workflow here" as "start a
        // fresh one", minting an empty state over the collected answers.
        AND: [
          { sourceChannelMetadataJson: { path: ['lineSubstituteReceiptContinuation', 'userId'], equals: input.userId } },
          { sourceChannelMetadataJson: { path: ['lineSubstituteReceiptContinuation', 'chatKeyHash'], equals: input.chatKeyHash } },
        ],
        ...branchScopeWhere(input.scopes),
      },
      select: { id: true, updatedAt: true, sourceChannelMetadataJson: true },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(10, Math.max(1, input.take ?? 5)),
    });
    return rows.map((row: any) => ({
      id: row.id,
      updatedAt: row.updatedAt,
      sourceChannelMetadataJson: row.sourceChannelMetadataJson as Record<string, unknown> | null,
    }));
  }

  /** Durable expense-draft conversations are independent of the bounded AI turn window. */
  async listLineExpenseDraftContinuationRows(input: {
    companyId: string;
    userId: string;
    chatKeyHash: string;
    scopes: { branchIds?: string[] };
    take?: number;
  }): Promise<Array<{
    id: string;
    expenseNumber: string | null;
    expenseDate: Date | null;
    vendorNameSnapshot: string | null;
    note: string | null;
    grandTotalAmount: string;
    updatedAt: Date;
    sourceChannelMetadataJson: Record<string, unknown> | null;
  }>> {
    const rows = await this.prisma.client.expenseRecord.findMany({
      where: {
        companyId: input.companyId,
        captureSource: 'LINE_UPLOAD',
        status: { in: ['DRAFT', 'NEEDS_REVIEW'] },
        createdByUserId: input.userId,
        AND: [
          { sourceChannelMetadataJson: { path: ['lineExpenseDraftContinuation', 'userId'], equals: input.userId } },
          { sourceChannelMetadataJson: { path: ['lineExpenseDraftContinuation', 'chatKeyHash'], equals: input.chatKeyHash } },
          {
            OR: ['OPEN', 'PAUSED', 'PAUSED_INTERRUPTED', 'INPUT_ENDED_COMPLETE', 'INPUT_ENDED_INCOMPLETE']
              .map((status) => ({ sourceChannelMetadataJson: { path: ['lineExpenseDraftContinuation', 'status'], equals: status } })),
          },
        ],
        ...branchScopeWhere(input.scopes),
      },
      select: {
        id: true, expenseNumber: true, expenseDate: true, vendorNameSnapshot: true,
        note: true, grandTotalAmount: true,
        updatedAt: true, sourceChannelMetadataJson: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: Math.min(10, Math.max(1, input.take ?? 5)),
    });
    return rows.filter((row: any) =>
      row.sourceChannelMetadataJson?.lineExpenseDraftContinuation?.chatKeyHash === input.chatKeyHash)
      .map((row: any) => ({
        id: row.id,
        expenseNumber: row.expenseNumber ?? null,
        expenseDate: row.expenseDate ?? null,
        vendorNameSnapshot: row.vendorNameSnapshot ?? null,
        note: row.note ?? null,
        grandTotalAmount: row.grandTotalAmount?.toString() ?? '0',
        updatedAt: row.updatedAt,
        sourceChannelMetadataJson: row.sourceChannelMetadataJson as Record<string, unknown> | null,
      }));
  }

  /**
   * Compare-and-set a typed continuation together with the expense revision it represents.
   * This intentionally updates metadata only; certificate preparation/issuance remains web-only.
   */
  async saveLineSubstituteContinuation(input: {
    companyId: string;
    expenseId: string;
    actorUserId: string;
    expectedUpdatedAt: Date;
    scopes: { branchIds?: string[] };
    continuation: Record<string, unknown>;
    /** The one expense field the LINE conversation collects. It lives on the row (the preflight, the
     *  web wizard and substitute eligibility all read it there), so it rides the same CAS write as
     *  the state instead of advancing the revision a second time. Callers pass only an id they have
     *  already resolved against this company's ACTIVE categories. */
    expenseCategoryId?: string;
  }): Promise<{ updatedAt: Date; continuation: Record<string, unknown> }> {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.expenseId}:line-substitute-continuation`}))`;
      const current = await tx.expenseRecord.findFirst({
        where: {
          id: input.expenseId,
          companyId: input.companyId,
          updatedAt: input.expectedUpdatedAt,
          ...branchScopeWhere(input.scopes),
        },
        select: { sourceChannelMetadataJson: true },
      });
      if (!current) throw new ConflictException({
        code: 'LINE_SUBSTITUTE_CONTINUATION_STALE',
        message: 'Expense changed. Reload current data before continuing the substitute receipt.',
      });
      const now = new Date();
      const continuation = { ...input.continuation, targetRevision: now.toISOString(), lastActivityAt: now.toISOString() };
      const metadata = current.sourceChannelMetadataJson && typeof current.sourceChannelMetadataJson === 'object'
        ? { ...current.sourceChannelMetadataJson }
        : {};
      metadata.lineSubstituteReceiptContinuation = continuation;
      const changed = await tx.expenseRecord.updateMany({
        where: { id: input.expenseId, companyId: input.companyId, updatedAt: input.expectedUpdatedAt },
        data: {
          sourceChannelMetadataJson: metadata,
          ...(input.expenseCategoryId ? { expenseCategoryId: input.expenseCategoryId } : {}),
          updatedByUserId: input.actorUserId,
          updatedAt: now,
        },
      });
      if (changed.count !== 1) throw new ConflictException({
        code: 'LINE_SUBSTITUTE_CONTINUATION_STALE',
        message: 'Expense changed while saving the substitute-receipt continuation.',
      });
      return { updatedAt: now, continuation };
    });
  }

  /** Record only opaque/source-owned handles after the customer actually received a capture outcome. */
  async recordDeliveredLineReceiptContinuation(input: {
    companyId: string;
    expenseId: string;
    userId: string;
    chatKeyHash: string;
    deliveredOutcomeId: string;
    scopes: { branchIds?: string[] };
  }): Promise<void> {
    await (this.prisma.client as any).$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.expenseId}:line-receipt-continuation`}))`;
      const current = await tx.expenseRecord.findFirst({
        where: {
          id: input.expenseId, companyId: input.companyId, createdByUserId: input.userId,
          captureSource: 'LINE_UPLOAD', ...branchScopeWhere(input.scopes),
        },
        select: {
          status: true, updatedAt: true, sourceChannelMetadataJson: true, aiVerificationSummaryJson: true,
          substituteReceiptEvidences: { where: { status: { not: 'SUPERSEDED' } }, select: { id: true }, take: 1 },
        },
      });
      if (!current) return;
      // Any later metadata touch would invalidate expenseUpdatedAtAtPreparation and make an already
      // prepared/certified document fail its own unchanged-source guard. Redelivery is read-only then.
      if (!['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(current.status)
        || current.substituteReceiptEvidences.length > 0) return;
      const existing = current.sourceChannelMetadataJson && typeof current.sourceChannelMetadataJson === 'object'
        ? current.sourceChannelMetadataJson as Record<string, unknown>
        : {};
      if (existing['chatKeyHash'] !== input.chatKeyHash) return;
      const now = new Date();
      const metadata: Record<string, unknown> = {
        ...existing,
        lineReceiptContinuation: {
          kind: 'CAPTURED_EXPENSE', expenseId: input.expenseId, userId: input.userId,
          chatKeyHash: input.chatKeyHash, deliveredOutcomeId: input.deliveredOutcomeId,
          sourceRevision: current.updatedAt.toISOString(), lastActivityAt: now.toISOString(),
          verificationSummaryPresent: Boolean(current.aiVerificationSummaryJson),
        },
      };
      const changed = await tx.expenseRecord.updateMany({
        where: { id: input.expenseId, companyId: input.companyId, updatedAt: current.updatedAt },
        // Delivery bookkeeping changes no content. Preserve the revision queued OCR and signed
        // actions watch; the CAS still refuses a genuine edit concurrent with this write.
        data: { sourceChannelMetadataJson: metadata, updatedAt: current.updatedAt },
      });
      if (changed.count !== 1) throw new ConflictException({
        code: 'LINE_RECEIPT_CONTINUATION_STALE', message: 'Expense changed while recording the delivered receipt outcome.',
      });
    });
  }

  async listClaimDuplicates(companyId: string, requestId: string, branchId: string | undefined, scopes: { branchIds?: string[] }, db: any) {
    return db.expenseRecord.findMany({
      where: { companyId, sourceReimbursementRequestId: requestId, branchId: branchId ?? null, ...branchScopeWhere(scopes), OR: [
        { duplicateStatus: 'POSSIBLE_DUPLICATE', status: { not: 'VOIDED' } },
        { duplicateStatus: 'OVERRIDDEN', status: 'READY_FOR_CONFIRMATION' },
      ] },
      select: { id: true, duplicateCandidates: { where: { status: 'OPEN' }, select: { id: true } } },
    });
  }


  /**
   * A candidate row is reachable only through the expense that owns it: the write is
   * scoped by `companyId` AND `expenseId`, and a zero-row result is a NotFound rather
   * than a silent no-op — a bare `where: { id }` let a caller in one company resolve
   * another company's candidate. Resolution, the expense status flip, and the caller's
   * audit row share one transaction, so a failed audit rolls the mutation back.
   */

  async resolveDuplicateCandidate(
    input: { companyId: string; expenseId: string; candidateId: string; actorUserId: string; action: 'dismiss' | 'confirm'; reason?: string; scopes: { branchIds?: string[] }; reimbursementRequestId?: string; reimbursementBranchId?: string },
    auditWithinTx: (tx: Prisma.TransactionClient) => Promise<void>,
    db?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = this.prisma.client as any;
    const work = async (tx: Prisma.TransactionClient) => {
      await this.assertDuplicateWriteAllowed(tx, input);
      const existingConfirmed = await tx.expenseDuplicateCandidate.findFirst({
        where: { companyId: input.companyId, expenseId: input.expenseId, status: 'CONFIRMED_DUPLICATE' },
        select: { id: true },
      });
      if (existingConfirmed) {
        if (input.action === 'confirm' && existingConfirmed.id === input.candidateId) {
          const source = await tx.expenseRecord.findFirst({ where: { companyId: input.companyId, id: input.expenseId }, select: { sourceReimbursementRequestId: true } });
          if (source?.sourceReimbursementRequestId) return;
        }
        throw new ConflictException('Expense already has a confirmed duplicate candidate');
      }
      const ownedCandidate = await tx.expenseDuplicateCandidate.findFirst({
        where: { id: input.candidateId, companyId: input.companyId, expenseId: input.expenseId, status: 'OPEN' },
        select: { candidateExpenseId: true },
      });
      if (!ownedCandidate) throw new NotFoundException(`Open duplicate candidate ${input.candidateId} not found on expense ${input.expenseId}`);
      const candidateExpense = await tx.expenseRecord.findFirst({
        where: {
          id: ownedCandidate.candidateExpenseId,
          companyId: input.companyId,
          // Claim-bound dismissal changes only its own source; it reveals no target facts.
          ...(input.reimbursementRequestId && input.action === 'dismiss' ? {} : branchScopeWhere(input.scopes)),
        },
        select: { id: true },
      });
      if (!candidateExpense) throw new NotFoundException(input.reimbursementRequestId ? 'reimbursement_duplicate_source_unavailable' : `Duplicate target ${ownedCandidate.candidateExpenseId} not found in company ${input.companyId}`);
      const candidate = await tx.expenseDuplicateCandidate.updateMany({
        where: { id: input.candidateId, companyId: input.companyId, expenseId: input.expenseId, status: 'OPEN' },
        data: {
          status: (input.action === 'confirm' ? 'CONFIRMED_DUPLICATE' : 'DISMISSED') as any,
          resolvedByUserId: input.actorUserId, resolvedAt: new Date(), resolutionReason: input.reason,
        },
      });
      if (candidate.count !== 1) throw new NotFoundException(`Duplicate candidate ${input.candidateId} not found on expense ${input.expenseId}`);
      if (input.action === 'confirm') {
        await tx.expenseDuplicateCandidate.updateMany({
          where: { companyId: input.companyId, expenseId: input.expenseId, status: 'OPEN', id: { not: input.candidateId } },
          data: {
            status: 'DISMISSED',
            resolvedByUserId: input.actorUserId,
            resolvedAt: new Date(),
            resolutionReason: SUPERSEDED_DUPLICATE_REASON,
          },
        });
      }
      const remaining = await tx.expenseDuplicateCandidate.findMany({
        where: { companyId: input.companyId, expenseId: input.expenseId },
        select: { candidateExpenseId: true, status: true },
      });
      const confirmed = remaining.find((row) => row.status === 'CONFIRMED_DUPLICATE');
      const hasOpen = remaining.some((row) => row.status === 'OPEN');
      const duplicateStatus = confirmed ? 'CONFIRMED_DUPLICATE' : hasOpen ? 'POSSIBLE_DUPLICATE' : 'OVERRIDDEN';
      const expense = await tx.expenseRecord.updateMany({
        where: { id: input.expenseId, companyId: input.companyId },
        data: {
          duplicateStatus: duplicateStatus as any,
          duplicateOfExpenseId: confirmed?.candidateExpenseId ?? null,
          duplicateOverrideReason: duplicateStatus === 'OVERRIDDEN' ? input.reason : null,
          ...(confirmed && { postingStatus: 'not_required' as any }),
          updatedByUserId: input.actorUserId,
        },
      });
      if (expense.count !== 1) throw new NotFoundException(`Expense ${input.expenseId} not found`);
      await auditWithinTx(tx);
      if (input.action === 'confirm') {
        const source = await tx.expenseRecord.findFirst({ where: { companyId: input.companyId, id: input.expenseId }, select: { sourceReimbursementRequestId: true } });
        if (source?.sourceReimbursementRequestId) {
          const claim = await tx.reimbursementRequest.findFirst({ where: { companyId: input.companyId, id: source.sourceReimbursementRequestId } });
          // A claim that was not approved is back with its requester and is not waiting to be paid: it is not
          // announced (it became cancellable on 2026-10-13, so "may still be cancelled" no longer excludes it).
          if (claim && !claim.cancellationPendingAt && claim.status !== 'REJECTED' && canTransition(claim.status, 'CANCELLED')) {
            const facts = await new PrismaReimbursementRepository(this.prisma, this.documentNumbers).paymentNoticeFacts(tx, input.companyId, claim.id);
            if (facts.paymentDuplicateBlock === 'CONFIRMED') await tx.outboxEvent.createMany({ skipDuplicates: true, data: [{
              companyId: input.companyId, eventType: 'reimbursement.duplicate_confirmed', aggregateType: 'reimbursement_request', aggregateId: claim.id,
              eventKey: `reimbursement.duplicate_confirmed:${claim.id}`,
              payloadJson: { companyId: input.companyId, actorUserId: input.actorUserId, aggregateType: 'reimbursement_request', aggregateId: claim.id,
                occurredAt: new Date().toISOString(), data: { requestId: claim.id, requestNo: claim.requestNo, requesterUserId: claim.requesterUserId, status: claim.status, ...(claim.financeReviewedByUserId && { financeReviewerUserId: claim.financeReviewedByUserId }) } },
              status: 'PENDING', priority: 'NORMAL',
            }] });
          }
        }
      }
    };
    if (db) await work(db);
    else await client.$transaction(work);
  }

  /**
   * Slice 2 "ยืนยันว่าใช้ได้ พร้อมเหตุผล" (§8). An annotation, not a material field, so it is allowed in
   * every status a person can still act on — only a voided or reversed expense refuses it. The write
   * is a CAS on `updatedAt`: a review save or a re-read that re-checked the buyer block in between
   * turns into a reload, never into an override attached to a comparison nobody saw.
   */
  async confirmBuyerMatch(
    input: { companyId: string; expenseId: string; actorUserId: string; reason: string; scopes: { branchIds?: string[] } },
    auditWithinTx: (tx: Prisma.TransactionClient, confirmed: import('@watchdog-bms/contracts').ExpenseBuyerAsPrinted) => Promise<void>,
  ): Promise<void> {
    const client = this.prisma.client as any;
    await client.$transaction(async (tx: Prisma.TransactionClient) => {
      const expense = await tx.expenseRecord.findFirst({
        where: { id: input.expenseId, companyId: input.companyId },
        select: { branchId: true, status: true, postingStatus: true, buyerAsPrintedJson: true, updatedAt: true },
      });
      if (!expense) throw new NotFoundException(`Expense ${input.expenseId} not found`);
      if (!isBranchInScope(input.scopes, expense.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
      if (expense.status === 'VOIDED' || expense.postingStatus === 'reversed') {
        throw new BadRequestException(`Cannot confirm the buyer match on an expense in status ${expense.status}/${expense.postingStatus}`);
      }
      const confirmed = confirmBuyerMismatch(expense.buyerAsPrintedJson, { reason: input.reason, userId: input.actorUserId, at: new Date().toISOString() });
      if (!confirmed) throw new BadRequestException({ code: 'expense_buyer_match_not_mismatch', message: 'Only a buyer block that does not match the company registry can be confirmed.' });
      const written = await tx.expenseRecord.updateMany({
        where: { id: input.expenseId, companyId: input.companyId, updatedAt: expense.updatedAt },
        data: { buyerAsPrintedJson: confirmed, updatedByUserId: input.actorUserId },
      });
      if (written.count !== 1) throw new ConflictException({ code: 'EXPENSE_UPDATE_CONFLICT', message: 'Expense changed while the buyer match was being confirmed. Reload and try again.' });
      await auditWithinTx(tx, confirmed);
    });
  }

  async linkAttachment(expenseId: string, attachmentId: string, purpose: string, companyId: string, actorUserId: string, db?: ExpenseDb): Promise<void> {
    await this.linkAttachmentToTarget(attachmentId, 'expense.record', expenseId, purpose, companyId, actorUserId, db);
  }

  async linkAttachmentToTarget(attachmentId: string, targetType: string, targetId: string, purpose: string, companyId: string, actorUserId: string, db?: ExpenseDb): Promise<void> {
    const conflict = await findAttachmentLinkConflict(db ?? this.prisma.client, { companyId, attachmentId, targetType });
    if (conflict) throw new BadRequestException(conflict);
    // A partial LINE repair may already have this link. Catching P2002 inside PostgreSQL's
    // transaction aborts the remaining repair, so retain the original link with an empty upsert.
    if (db) {
      await db.attachmentLink.upsert({ where: { attachmentId_targetType_targetId_purpose: { attachmentId, targetType, targetId, purpose } },
        create: { attachmentId, targetType, targetId, purpose, companyId, linkedByUserId: actorUserId }, update: {} });
      return;
    }
    await this.prisma.client.attachmentLink.create({ data: { attachmentId, targetType, targetId, purpose, companyId, linkedByUserId: actorUserId } });
  }

  // ─── Company signature assets ───────────────────────────────────────────────

  async createSignatureAsset(input: {
    companyId: string;
    label?: string;
    originalAttachmentId: string;
    submittedByUserId: string;
    submittedFromChannel: SignatureSubmitChannel;
    lineMessageId?: string;
    /** Always ACTIVE since the personal-signature decision (2026-08-20); the column keeps the enum
     *  so archived/rejected history stays readable. */
    status?: string;
    approvedByUserId?: string;
    approvedAt?: Date;
  }): Promise<SignatureAssetRecord> {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      // D14: ONE current signature per person. Saving a new one retires the previous one here, in the
      // same transaction, under the per-owner advisory lock — so two uploads racing serialise instead
      // of landing two ACTIVE rows, and a rollback (the LINE redelivery that loses at the
      // lineMessageId unique index) takes the retirement back with it. Migration
      // 20260821000000 adds the partial unique index that is the referee if a future write path
      // forgets this. Without the rule, the panel's "current" signature was whichever ACTIVE row came
      // first, so deleting it silently promoted the next one and delete looked like a no-op.
      //
      // Only `status`/`archivedAt` move: the retired row keeps its attachment ids, so the pinned
      // re-resolution at approve still resolves what certify recorded, and the substitute-evidence
      // retention hold still protects those bytes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.submittedByUserId}:signature-asset`}))`;
      if ((input.status ?? 'ACTIVE') === 'ACTIVE') {
        await tx.companySignatureAsset.updateMany({
          where: { companyId: input.companyId, submittedByUserId: input.submittedByUserId, status: 'ACTIVE' },
          data: { status: 'ARCHIVED', archivedAt: new Date() },
        });
      }
      const s = await tx.companySignatureAsset.create({
        data: {
          companyId: input.companyId,
          label: input.label,
          originalAttachmentId: input.originalAttachmentId,
          submittedByUserId: input.submittedByUserId,
          submittedFromChannel: input.submittedFromChannel as any,
          lineMessageId: input.lineMessageId,
          ...(input.status !== undefined && { status: input.status as any }),
          ...(input.approvedByUserId !== undefined && { approvedByUserId: input.approvedByUserId }),
          ...(input.approvedAt !== undefined && { approvedAt: input.approvedAt }),
        },
      });
      return mapSignatureAsset(s);
    });
  }

  /**
   * Registers server-generated signature bytes (the downscaled / background-removed render) as an
   * ACTIVE attachment. Same shape the certified-artifact writes use: the object is already in
   * storage, so there is no upload intent to complete and no second copy to verify.
   */
  async createGeneratedSignatureAttachment(input: {
    companyId: string;
    uploadedByUserId: string;
    originalFileName: string;
    mimeType: string;
    byteSize: number;
    checksumSha256: string;
    storageProvider: string;
    bucket: string;
    objectKey: string;
    objectVersionId: string;
    metadataJson: Record<string, unknown>;
  }): Promise<string> {
    const attachment = await this.prisma.client.attachmentObject.create({
      data: {
        companyId: input.companyId,
        // Company-central, exactly like the upload-intent path leaves a signature: a signature
        // belongs to a person, not a branch, and branch scoping must never hide it from its owner.
        branchId: null,
        storageProvider: input.storageProvider,
        bucket: input.bucket,
        objectKey: input.objectKey,
        objectVersionId: input.objectVersionId,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        checksumSha256: input.checksumSha256,
        visibility: 'INTERNAL',
        status: 'ACTIVE',
        uploadedByUserId: input.uploadedByUserId,
        uploadedAt: new Date(),
        metadataJson: input.metadataJson as any,
      },
      select: { id: true },
    });
    return attachment.id;
  }

  async findSignatureAssetById(companyId: string, id: string): Promise<SignatureAssetRecord | null> {
    const s = await this.prisma.client.companySignatureAsset.findFirst({ where: { id, companyId } });
    return s ? mapSignatureAsset(s) : null;
  }

  async findSignatureAssetByLineMessageId(companyId: string, lineMessageId: string): Promise<SignatureAssetRecord | null> {
    const s = await this.prisma.client.companySignatureAsset.findFirst({ where: { companyId, lineMessageId } });
    return s ? mapSignatureAsset(s) : null;
  }

  /** `submittedByUserId` is mandatory for the owner-only "ลายเซ็นของฉัน" use case. */
  async listSignatureAssets(companyId: string, submittedByUserId: string, status?: string): Promise<SignatureAssetRecord[]> {
    const rows = await this.prisma.client.companySignatureAsset.findMany({
      where: {
        companyId,
        ...(status ? { status: status as any } : {}),
        submittedByUserId,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(mapSignatureAsset);
  }

  async updateSignatureAsset(companyId: string, id: string, data: {
    status?: string;
    derivedAttachmentId?: string;
    approvedByUserId?: string;
    approvedAt?: Date;
    rejectedByUserId?: string;
    rejectedAt?: Date;
    rejectReason?: string;
    archivedAt?: Date;
    label?: string;
  }): Promise<SignatureAssetRecord> {
    const s = await this.prisma.client.companySignatureAsset.update({
      where: { id },
      data: {
        ...(data.status !== undefined && { status: data.status as any }),
        ...(data.derivedAttachmentId !== undefined && { derivedAttachmentId: data.derivedAttachmentId }),
        ...(data.approvedByUserId !== undefined && { approvedByUserId: data.approvedByUserId }),
        ...(data.approvedAt !== undefined && { approvedAt: data.approvedAt }),
        ...(data.rejectedByUserId !== undefined && { rejectedByUserId: data.rejectedByUserId }),
        ...(data.rejectedAt !== undefined && { rejectedAt: data.rejectedAt }),
        ...(data.rejectReason !== undefined && { rejectReason: data.rejectReason }),
        ...(data.archivedAt !== undefined && { archivedAt: data.archivedAt }),
        ...(data.label !== undefined && { label: data.label }),
      },
    });
    return mapSignatureAsset(s);
  }

  async createSignatureFill(input: {
    companyId: string;
    expenseId: string;
    signatureAssetId: string;
    appliedByUserId: string;
    renderedAttachmentId?: string;
    placeholder?: string;
  }): Promise<{ id: string; appliedAt: Date }> {
    const f = await this.prisma.client.signatureFillRecord.create({
      data: {
        companyId: input.companyId,
        expenseId: input.expenseId,
        signatureAssetId: input.signatureAssetId,
        appliedByUserId: input.appliedByUserId,
        renderedAttachmentId: input.renderedAttachmentId,
        placeholder: input.placeholder,
      },
    });
    return { id: f.id, appliedAt: f.appliedAt };
  }

  async listSignatureFills(companyId: string, expenseId: string): Promise<Array<{ id: string; expenseId: string; signatureAssetId: string; appliedByUserId: string; appliedAt: Date; renderedAttachmentId: string | null; placeholder: string | null }>> {
    return this.prisma.client.signatureFillRecord.findMany({
      where: { companyId, expenseId },
      orderBy: { appliedAt: 'desc' },
      select: { id: true, expenseId: true, signatureAssetId: true, appliedByUserId: true, appliedAt: true, renderedAttachmentId: true, placeholder: true },
    });
  }

  // ─── Accountant shared evidence ─────────────────────────────────────────────

  buildSharedEvidenceWhere(companyId: string, filter: SharedEvidenceFilter, scopes?: { branchIds?: string[] }): Record<string, unknown> {
    if (filter.expenseIds !== undefined && (!Array.isArray(filter.expenseIds)
      || filter.expenseIds.length > 10000
      || filter.expenseIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200))) {
      throw new BadRequestException('รายการที่เลือกสำหรับส่งออกไม่ถูกต้อง เปิดหน้านี้ใหม่');
    }
    const dateField = filter.dateField === 'uploadedAt' ? 'uploadedAt' : 'expenseDate';
    let fromDate = filter.fromDate;
    let toDate = filter.toDate;
    if (filter.yearMonth && /^\d{4}-\d{2}$/.test(filter.yearMonth)) {
      const [y, m] = filter.yearMonth.split('-').map(Number);
      fromDate = `${filter.yearMonth}-01`;
      toDate = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
    }
    const dateRange = dateField === 'uploadedAt'
      ? bangkokCivilDayRangeToUtc(fromDate, toDate)
      : civilDayRangeToUtc(fromDate, toDate);
    const postingWhere = filter.postingStatus === 'pending' || filter.postingStatus === 'posting_error'
      ? {
        OR: [
          { postingStatus: filter.postingStatus },
          { payments: { some: { status: 'RECORDED', postingStatus: filter.postingStatus } } },
        ],
      }
      : filter.postingStatus === 'posted'
        ? {
          postingStatus: 'posted',
          payments: { none: { status: 'RECORDED', postingStatus: { in: ['pending', 'posting_error'] } } },
        }
        : filter.postingStatus ? { postingStatus: filter.postingStatus } : null;
    const constrained = [scopes ? branchScopeWhere(scopes) : null, postingWhere].filter(Boolean);
    return {
      companyId,
      ...(constrained.length ? { AND: constrained } : {}),
      ...(filter.expenseIds !== undefined ? { id: { in: filter.expenseIds } } : {}),
      ...(filter.branchId && { branchId: filter.branchId }),
      ...(filter.status && { status: filter.status }),
      ...(filter.sourceDocumentType && { sourceDocumentType: filter.sourceDocumentType }),
      ...(filter.taxEvidenceStatus && { taxEvidenceStatus: filter.taxEvidenceStatus }),
      ...(filter.expenseCategoryId && { expenseCategoryId: filter.expenseCategoryId }),
      ...(filter.paymentStatus && { paymentStatus: filter.paymentStatus }),
      ...(filter.createdByUserId && { createdByUserId: filter.createdByUserId }),
      ...(fromDate || toDate ? dateField === 'expenseDate' ? documentDateWhere(fromDate, toDate) : { uploadedAt: dateRange } : {}),
    };
  }

  async listSharedEvidence(companyId: string, filter: SharedEvidenceFilter, scopes?: { branchIds?: string[] }, includeUnavailableAttachments = false): Promise<{
    rows: Array<ExpenseRecord & { latestInputVatDecision?: import('@watchdog-bms/contracts').ExpenseSummary['latestInputVatDecision']; inputVatRecordedBeforeReview?: boolean; categoryName: string | null; journalEntryNumber: string | null; additionalChargesAmount: string; attachments: import('@watchdog-bms/contracts').ExpenseAttachmentRef[]; evidenceSources: Awaited<ReturnType<typeof loadExpenseEvidenceSources>> extends Map<string, infer T> ? T : never }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 && filter.pageSize <= 500 ? filter.pageSize : 50;
    const where = this.buildSharedEvidenceWhere(companyId, filter, scopes);
    const dateField = filter.dateField === 'uploadedAt' ? 'uploadedAt' : 'expenseDate';

    const [records, total] = await Promise.all([
      this.prisma.client.expenseRecord.findMany({
        where: where as any,
        include: { expenseCategory: { select: { name: true } }, lines: { select: { expenseCategoryId: true, chargeKind: true } }, inputVatDecisions: { take: 1, orderBy: { decidedAt: 'desc' }, select: { reason: true, decidedByUserId: true, decidedAt: true } } },
        orderBy: [{ [dateField]: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.expenseRecord.count({ where: where as any }),
    ]);

    const decisionNames = await this.inputVatDecisionNames(records);
    const ids = records.map((r) => r.id);
    const journalIds = records.map((r) => r.journalEntryId).filter((id): id is string => !!id);
    const evidenceByExpense = await loadExpenseEvidenceSources(this.prisma.client, companyId, records, scopes, includeUnavailableAttachments);
    const payments = ids.length > 0 ? await this.prisma.client.expensePayment.findMany({
      where: { companyId, expenseId: { in: ids }, status: 'RECORDED' },
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, expenseId: true, postingStatus: true, postingError: true },
    }) : [];
    // §5.1: `subtotalAmount` is goods only, so the accountant index needs the charge total to stay
    // additive. One grouped aggregate rather than every line of every row — the export pages 50 to
    // 500 records at a time and none of the other line fields are used here.
    const chargeSums = ids.length > 0 ? await this.prisma.client.expenseLine.groupBy({
      by: ['expenseId'],
      where: { companyId, expenseId: { in: ids }, chargeKind: { not: null } },
      _sum: { lineSubtotalAmount: true },
    }) : [];
    const chargeTotalByExpense = new Map(chargeSums.map((row) => [row.expenseId, row._sum.lineSubtotalAmount?.toString() ?? '0']));
    const paymentIds = payments.map((payment) => payment.id);
    const journals = ids.length > 0 ? await this.prisma.client.journalEntry.findMany({
      where: {
        companyId,
        OR: [
          ...(journalIds.length > 0 ? [{ id: { in: journalIds } }] : []),
          { sourceId: { in: ids }, sourceType: 'expense.record', entryType: 'GENERATED' as any },
          ...(paymentIds.length > 0 ? [{ sourceId: { in: paymentIds }, sourceType: 'expense.payment', entryType: 'GENERATED' as any }] : []),
        ],
      },
      select: { id: true, sourceId: true, sourceType: true, entryNumber: true },
    }) : [];
    const journalNumberById = new Map(journals.map((journal) => [journal.id, journal.entryNumber]));
    const generatedJournalByExpense = new Map<string, typeof journals[number]>();
    for (const journal of journals) {
      if (!journal.sourceId || !journal.sourceType) continue;
      if (journal.sourceType === 'expense.record') {
        generatedJournalByExpense.set(journal.sourceId, journal);
      }
    }
    const pendingPaymentByExpense = new Map<string, { id: string; postingStatus: 'pending' | 'posting_error'; postingError: string | null }>();
    for (const payment of payments) {
      if (!pendingPaymentByExpense.has(payment.expenseId)
        && (payment.postingStatus === 'pending' || payment.postingStatus === 'posting_error')) {
        pendingPaymentByExpense.set(payment.expenseId, {
          id: payment.id,
          postingStatus: payment.postingStatus,
          postingError: payment.postingError,
        });
      }
    }
    return {
      rows: records.map((r) => {
        const fallbackJournal = generatedJournalByExpense.get(r.id);
        const journalEntryId = r.journalEntryId && journalNumberById.has(r.journalEntryId)
          ? r.journalEntryId
          : fallbackJournal?.id ?? null;
        const pendingPayment = pendingPaymentByExpense.get(r.id);
        const pendingSource = nextExpensePostingSource({
          expenseId: r.id,
          sourceReimbursementRequestId: r.sourceReimbursementRequestId,
          accrualPosted: Boolean(fallbackJournal),
          pendingPaymentId: pendingPayment?.id,
        });
        const effectivePostingStatus = pendingSource?.sourceType === 'expense.payment'
          ? pendingPayment!.postingStatus
          : pendingSource?.sourceType === 'expense.record'
            ? r.postingStatus
            : fallbackJournal ? 'posted' : r.postingStatus;
        const effectivePostingError = pendingSource?.sourceType === 'expense.payment'
          ? pendingPayment!.postingError
          : pendingSource?.sourceType === 'expense.record' ? r.postingError : null;
        return {
          ...mapExpense(r),
          latestInputVatDecision: decisionNames.get(r.id) ?? null,
          inputVatRecordedBeforeReview: inputVatRecordedBeforeReview(r, Boolean(r.inputVatDecisions?.length)),
          categoryName: (r as any).expenseCategory?.name ?? (hasExpenseCategory(r) ? 'ตามรายการ' : null),
          journalEntryId,
          journalEntryNumber: journalEntryId ? journalNumberById.get(journalEntryId) ?? null : null,
          pendingPostingSourceType: pendingSource?.sourceType ?? null,
          pendingPostingSourceId: pendingSource?.sourceId ?? null,
          postingStatus: effectivePostingStatus,
          postingError: effectivePostingError,
          additionalChargesAmount: chargeTotalByExpense.get(r.id) ?? '0',
          attachments: evidenceByExpense.get(r.id)!.attachments,
          evidenceSources: evidenceByExpense.get(r.id)!,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** Virtual year/month folders from the chosen date field (bounded raw aggregate). */
  async summarizeSharedEvidenceFolders(companyId: string, filter: SharedEvidenceFilter, scopes?: { branchIds?: string[] }): Promise<Array<{ yearMonth: string; expenseCount: number; evidenceCount: number; totalAmount: string }>> {
    const dateField = filter.dateField === 'uploadedAt' ? 'uploadedAt' : 'expenseDate';
    const where = this.buildSharedEvidenceWhere(companyId, { ...filter, yearMonth: undefined }, scopes);
    const rows = await this.prisma.client.expenseRecord.findMany({
      where: where as any,
      select: { id: true, branchId: true, sourceReimbursementRequestId: true, sourceReimbursementLineId: true, expenseDate: true, uploadedAt: true, aiVerificationSummaryJson: true, grandTotalAmount: true } as any,
      take: 5000,
    });
    const evidence = await loadExpenseEvidenceSources(this.prisma.client, companyId, rows as any, scopes);
    const evidencedIds = new Set([...evidence].filter(([, value]) => value.attachments.some(file => !file.isHistorical)).map(([id]) => id));
    const buckets = new Map<string, { count: number; evidenceCount: number; total: number }>();
    for (const row of rows as Array<Record<string, any>>) {
      const hasDocumentDate = dateField === 'expenseDate' && expenseDocumentDateStatus(row.aiVerificationSummaryJson) !== 'unverified';
      const date = row[hasDocumentDate ? 'expenseDate' : 'uploadedAt'] as Date | null;
      if (!date) continue;
      const key = civilPeriodKey(hasDocumentDate ? coerceCivilDate(date) : civilDate(date));
      const bucket = buckets.get(key) ?? { count: 0, evidenceCount: 0, total: 0 };
      bucket.count += 1;
      if (evidencedIds.has(row['id'] as string)) bucket.evidenceCount += 1;
      bucket.total += Number(row['grandTotalAmount'] ?? 0);
      buckets.set(key, bucket);
    }
    return [...buckets.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([yearMonth, b]) => ({ yearMonth, expenseCount: b.count, evidenceCount: b.evidenceCount, totalAmount: b.total.toFixed(4) }));
  }
}

// WHT certificate system issuance, Phase 1.2 (docs/plans/wht-certificate-system-issuance-plan.md §1.2).
// Mirrors `createWhtHandoffForPayment` in prisma-procurement.repository.ts field-for-field, adapted to
// ExpenseRecord's own snapshot columns. Unlike the AP side (which only records a handoff while the
// SYSTEM route is closed), Expenses records the handoff unconditionally whenever whtAmount > 0 (S3):
// this closes the gap H4 deliberately scoped out (wht-durable-prefilled-handoff.md OQ-2) rather than
// reproducing AP's older closed-route-only condition.
async function createWhtHandoffForExpense(tx: any, input: {
  companyId: string; actorUserId: string;
  expense: {
    id: string; branchId: string | null; whtAmount: unknown; whtCategoryCode: string | null; whtRate: unknown;
    vendorCounterpartyId: string | null; vendorNameSnapshot: string | null; vendorTaxIdSnapshot: string | null;
    vendorAddressSnapshot: string | null; vendorBranchCodeSnapshot: string | null;
    vendorEntityKindSnapshot: string | null; expenseDate: Date; grandTotalAmount: unknown;
    whtInputJson?: import('@watchdog-bms/contracts').ExpenseWhtInput | null; lines?: { taxableAmount: unknown; whtAmount: unknown; whtRate?: unknown }[];
  };
}): Promise<void> {
  const { companyId, expense } = input;
  const withheldAmount = String(expense.whtAmount ?? '0');
  const whtRate = expenseWhtHeaderRate(expense.whtInputJson, expense.lines, expense.whtRate);
  const grossAmount = expenseWhtIncomeBase(expense);
  const [company, category] = await Promise.all([
    tx.company.findUnique({ where: { id: companyId }, select: { name: true, registeredName: true, taxId: true, addressJson: true } }),
    expense.whtCategoryCode ? tx.whtIncomeCategory.findUnique({ where: { code: expense.whtCategoryCode }, select: { nameTh: true } }) : Promise.resolve(null),
  ]);
  const payerBranch = await withholdingPayerPrefill(tx, companyId, expense.expenseDate.toISOString().slice(0, 7), expense.branchId, company?.addressJson);
  const prefill = {
    payerSnapshot: {
      companyName: company?.registeredName ?? company?.name ?? 'Unknown company',
      taxId: company?.taxId ?? null,
      branchCode: payerBranch.branchCode,
      address: payerBranch.address ? JSON.stringify(payerBranch.address) : null,
    },
    payeeSnapshot: {
      name: expense.vendorNameSnapshot ?? 'Unknown payee',
      taxId: expense.vendorTaxIdSnapshot ?? null,
      address: expense.vendorAddressSnapshot ?? null,
      branchCode: expense.vendorBranchCodeSnapshot ?? null,
    },
    // Same RD-form mapping rule as the AP side (spec §6) — BuyerEntityKind uses 'JURISTIC', not
    // supplierType's 'JURISTIC_PERSON', but the certificate meaning is identical.
    formType: expense.vendorEntityKindSnapshot === 'JURISTIC' ? 'PND53'
      : expense.vendorEntityKindSnapshot === 'INDIVIDUAL' ? 'PND3' : null,
    incomeCategoryCode: expense.whtCategoryCode ?? null,
    incomeCategoryName: category?.nameTh ?? null,
    whtRate,
    grossAmount,
    withheldAmount,
    paymentDate: expense.expenseDate.toISOString(),
  };
  const retired = await tx.whtCertificateHandoff.findFirst({ where: { companyId, creationCommandId: `wht-cert:${companyId}:expense.record:${expense.id}`, status: 'CANCELLED' }, select: { id: true, prefillSnapshotJson: true, payeeAddress: true } });
  const oldPayee = retired?.prefillSnapshotJson?.payeeSnapshot;
  const oldTaxId = normalizeTaxId(String(oldPayee?.taxId ?? ''));
  const newTaxId = normalizeTaxId(String(prefill.payeeSnapshot.taxId ?? ''));
  const oldName = normalizeVendorName(oldPayee?.name);
  const samePayee = oldTaxId || newTaxId ? oldTaxId === newTaxId : !!oldName && oldName === normalizeVendorName(prefill.payeeSnapshot.name);
  // An address the person just corrected on the expense itself must win over an older one typed on the card.
  const oldAddress = String(oldPayee?.address ?? '').trim();
  const newAddress = String(prefill.payeeSnapshot.address ?? '').trim();
  const keepTypedAddress = samePayee && (!newAddress || newAddress === oldAddress);
  const clearedForTaxIdChange = Boolean(retired?.payeeAddress?.trim()) && !keepTypedAddress && oldTaxId !== newTaxId;
  const writeHandoff = retired
    ? (input: any) => tx.whtCertificateHandoff.update({ where: { id: retired.id }, data: { ...input.data, ...(keepTypedAddress ? {} : { payeeAddress: null, payeeAddressByUserId: null, payeeAddressAt: null }) } })
    : (input: any) => tx.whtCertificateHandoff.create(input);
  const handoff = await writeHandoff({
    data: {
      companyId,
      status: 'REQUIRED',
      sourcePaymentType: 'expense.record',
      sourcePaymentId: expense.id,
      payeeId: expense.vendorCounterpartyId ?? null,
      branchCode: expense.vendorBranchCodeSnapshot ?? null,
      sourceBranchId: expense.branchId ?? null,
      sourceFeatureKey: 'expenses',
      taxPeriodId: null,
      taxEventIdsJson: [],
      prefillSnapshotJson: prefill,
      prefillSnapshotHash: createHash('sha256').update(JSON.stringify(prefill)).digest('hex'),
      availabilityVectorJson: { gateKey: 'cap.wht50bis', routeKey: 'SYSTEM_INITIAL_ISSUE', state: 'CLOSED' },
      creationCommandId: `wht-cert:${companyId}:expense.record:${expense.id}`,
      payloadFingerprint: createHash('sha256').update(JSON.stringify(prefill)).digest('hex'),
    },
  });
  if (clearedForTaxIdChange) {
    await appendWhtCertificateHistory(tx, handoff, {
      eventType: 'PAYEE_ADDRESS_CLEARED', actorUserId: input.actorUserId, isExternal: false,
      detailsJson: { reason: 'PAYEE_TAX_ID_CHANGED' },
    });
  }
}


function assertExpensePaidWithinPayable(expense: any): void {
  if (new Decimal(String(expense.paidAmount ?? 0)).minus(String(expense.netPayableAmount)).gt(SETTLE_EPSILON)) {
    throw new BadRequestException({ code: 'expense_paid_exceeds_payable', message: EXPENSE_CORRECTION_WORDS.paidExceedsPayable });
  }
}

/** Review saves and confirmation both call this inside their existing locked transaction. */
async function matchingExpenseWhtCategory(tx: any, expense: any): Promise<string | null | undefined> {
  const code = expense.whtCategoryCode;
  const form = expense.vendorEntityKindSnapshot === 'INDIVIDUAL' ? 'PND3' : expense.vendorEntityKindSnapshot === 'JURISTIC' ? 'PND53' : null;
  if (!code || !form) return code;
  const category = await tx.whtIncomeCategory.findUnique({ where: { code } });
  if (!category || (category.formType === form || form === 'PND3' && category.formType === 'PND2')) return code;
  const twinCode = WHT_INCOME_CATEGORY_TWINS.find(pair => pair.includes(code))?.find(twin => twin !== code);
  const twin = twinCode ? await tx.whtIncomeCategory.findUnique({ where: { code: twinCode } }) : null;
  if ((twin?.formType === form || form === 'PND3' && twin?.formType === 'PND2') && twin.status === 'ACTIVE' && expense.whtRate != null && new Decimal(expense.whtRate).eq(twin.defaultRate)) return twinCode;
  throw new BadRequestException({ code: 'expense_wht_category_payee_mismatch',
    message: 'จ่ายค่าอะไรไม่ตรงกับผู้รับเงิน เลือกประเภทเงินได้ให้ตรง หรือแก้ช่องผู้รับเงินเป็นใครให้ถูกต้อง' });
}
