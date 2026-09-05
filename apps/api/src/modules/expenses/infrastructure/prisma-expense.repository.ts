import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../common/database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { branchScopeWhere, isBranchInScope, type BranchScopes } from '../../data-model-core/domain/logic/branch.logic';
import { canonicalFingerprint } from '../../../common/security/canonical-fingerprint';
import { POSITIVE_ACCOUNTING_MONEY_PATTERN } from '../../accounting-documents/domain/logic/accounting-money-validation.logic';
import { findAttachmentLinkConflict } from '../../data-model-core/domain/logic/attachment.logic';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { buildReversalLines } from '../../ledger/domain/logic/journal-balance.logic';
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
} from '@watchdog-bms/contracts';
import { civilDate, civilDateToUtcDate, civilDayRangeToUtc, civilPeriodKey, coerceCivilDate, exclusiveEndOfDay, expenseLineCharges, isCivilDate, EXPENSE_PAYMENT_METHODS } from '@watchdog-bms/contracts';
import { expenseTaxSourceChecksum } from '../domain/logic/expense-status.logic';
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

type ExpensePaymentResult = { expense: ExpenseRecord; payment: ExpensePaymentRecord; replayed: boolean };
type SubstituteReceiptPolicyWithApprovalMode = SubstituteReceiptPolicyRecord & { approvalMode: SubstituteReceiptApprovalMode };

const AUTO_STALE_DUPLICATE_REASON = 'system:stale_after_rescan';
const SUPERSEDED_DUPLICATE_REASON = 'system:superseded_by_confirmed_duplicate';
const SUBSTITUTE_RECEIPT_DOCUMENT_TYPE = 'expense.substitute_receipt';
const SUBSTITUTE_RECEIPT_OWNER_TYPE = 'expense_substitute_receipt';
export const SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON = 'EXPENSE_VOIDED';
const BANGKOK_UTC_OFFSET_MS = 7 * 60 * 60 * 1_000;

/** Timestamp ranges follow the same Bangkok civil dates shown by the Expenses UI. */
function bangkokCivilDayRangeToUtc(from?: string, to?: string): { gte?: Date; lt?: Date } {
  const range = civilDayRangeToUtc(from, to);
  return {
    ...(range.gte && { gte: new Date(range.gte.getTime() - BANGKOK_UTC_OFFSET_MS) }),
    ...(range.lt && { lt: new Date(range.lt.getTime() - BANGKOK_UTC_OFFSET_MS) }),
  };
}


type ExpenseTaxFinalizer = (input: {
  db: any;
  expense: ExpenseRecordWithRelations;
}) => Promise<ExpenseLineInput[]>;

export function expenseDecimalToString(value: { toString(): string } | null | undefined): string {
  return value?.toString() ?? '0';
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
    journalEntryNumber: r.journalEntryNumber ?? null,
    pendingPostingSourceType: r.pendingPostingSourceType ?? null,
    pendingPostingSourceId: r.pendingPostingSourceId ?? null,
    subtotalAmount: r.subtotalAmount?.toString() ?? '0',
    discountAmount: r.discountAmount?.toString() ?? '0',
    taxableAmount: r.taxableAmount?.toString() ?? '0',
    vatAmount: r.vatAmount?.toString() ?? '0',
    whtAmount: r.whtAmount?.toString() ?? '0',
    grandTotalAmount: expenseDecimalToString(r.grandTotalAmount),
    netPayableAmount: r.netPayableAmount?.toString() ?? '0',
    paidAmount: r.paidAmount?.toString() ?? '0',
    outstandingAmount: r.outstandingAmount?.toString() ?? '0',
    vendorSnapshotJson: r.vendorSnapshotJson ?? null,
    aiVerifiedFieldsJson: r.aiVerifiedFieldsJson ?? null,
    aiVerificationSummaryJson: r.aiVerificationSummaryJson ?? null,
    vatCaptureSnapshotJson: r.vatCaptureSnapshotJson ?? null,
    whtInputJson: r.whtInputJson ?? null,
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
    snapshotJson: row.snapshotJson ?? null,
    paymentEvidenceAttachmentIds: Array.isArray(row.paymentEvidenceAttachmentIds) ? row.paymentEvidenceAttachmentIds : [],
    supportingAttachmentIds: Array.isArray(row.supportingAttachmentIds) ? row.supportingAttachmentIds : [],
  };
}

export function toSubstituteEvidenceSummary(row: SubstituteReceiptEvidenceRecord): import('@watchdog-bms/contracts').SubstituteReceiptEvidenceSummary {
  return {
    id: row.id,
    expenseId: row.expenseId,
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

@Injectable()
export class PrismaExpenseRepository {
  // `documentNumbers` is annotated, not merely defaulted: Nest reads design:paramtypes to inject
  // the provider DataModelCoreModule exports, and an unannotated parameter emits nothing there,
  // so the API fails to boot. The default only keeps the class directly constructible from the
  // repository specs; under Nest the injected instance always wins.
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentNumbers: PrismaDocumentSequenceRepository = new PrismaDocumentSequenceRepository(prisma),
  ) {}

  async recordPaymentAtomic(input: {
    companyId: string;
    expenseId: string;
    actorUserId: string;
    scopes: BranchScopes;
    idempotencyKey: string;
    amount: string;
    paymentMethod?: string;
    paidAt?: string;
    bankAccountRef?: string;
  }, withinTx?: (tx: Prisma.TransactionClient, result: ExpensePaymentResult) => Promise<void>): Promise<ExpensePaymentResult> {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      // Key first: conflicting uses on different expenses must serialize too. ReadCommitted
      // sees the first writer's committed row after waiting; Serializable can keep a stale snapshot.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.idempotencyKey}:expense-payment-command`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.expenseId}:expense-record-lifecycle`}))`;
      const current = await tx.expenseRecord.findFirst({ where: { id: input.expenseId, companyId: input.companyId } });
      if (!current) throw new NotFoundException(`Expense ${input.expenseId} not found`);
      if (!isBranchInScope(input.scopes, current.branchId)) {
        throw new ForbiddenException('Branch is outside your assigned branch scope.');
      }
      if (current.sourceReimbursementRequestId != null) {
        throw new BadRequestException({
          code: 'claim_expense_settles_via_reimbursement',
          message: 'A claim-born expense settles through reimbursement payment.',
        });
      }
      if (typeof input.amount !== 'string' || !POSITIVE_ACCOUNTING_MONEY_PATTERN.test(input.amount)) {
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
      if (input.bankAccountRef != null && (typeof input.bankAccountRef !== 'string' || input.bankAccountRef.length > 128)) {
        throw new BadRequestException({ code: 'expense_payment_invalid_reference', message: 'Bank reference must be at most 128 characters.' });
      }
      const bankAccountRef = input.bankAccountRef?.trim() || null;
      const payloadFingerprint = canonicalFingerprint({
        version: 1, expenseId: input.expenseId, branchId: current.branchId ?? null,
        currency: current.currency, amount: amount.toFixed(4), paymentMethod: input.paymentMethod ?? null,
        paidAt: input.paidAt ?? null, bankAccountRef,
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
      if (current.status !== 'CONFIRMED') {
        throw new BadRequestException(`Can only record payment for CONFIRMED expenses (current: ${current.status})`);
      }
      const paidAt = input.paidAt ? civilDateToUtcDate(coerceCivilDate(input.paidAt)) : new Date();
      const paidBefore = new Decimal(current.paidAmount.toString());
      const payable = new Decimal(current.netPayableAmount.toString());
      const paidAfter = paidBefore.plus(amount);
      // FIN-01: a pre-§19d row stores a 4dp payable (580.0042) whose printed and displayed
      // outstanding is the satang rounding (580.00, or 580.01 when it rounds up). Settling that
      // figure must be accepted and must settle the row, so both the overshoot guard and the
      // resulting totals use the one satang policy in expense-totals.logic. A real overpayment
      // (a satang or more past the payable) is still refused.
      if (!amount.isFinite() || amount.lte(0) || paidAfter.minus(payable).gt(SETTLE_EPSILON)) {
        throw new BadRequestException({
          code: 'expense_payment_exceeds_outstanding',
          message: 'Payment amount must be positive and cannot exceed the outstanding amount.',
        });
      }
      const payableText = payable.toFixed(4);
      const paidAfterText = paidAfter.toFixed(4);
      const { outstandingAmount } = calcPaymentAmounts(payableText, paidAfterText);
      const paymentStatus = derivePaymentStatus(payableText, paidAfterText);
      const payment = await tx.expensePayment.create({
        data: {
          companyId: input.companyId,
          expenseId: input.expenseId,
          idempotencyKey: input.idempotencyKey,
          payloadFingerprint,
          amount: amount.toFixed(4),
          currency: current.currency,
          paymentMethod: input.paymentMethod ?? null,
          paidAt,
          bankAccountRef,
          status: 'RECORDED',
          postingStatus: 'pending',
          createdByUserId: input.actorUserId,
        },
      });
      const changed = await tx.expenseRecord.updateMany({
        where: { id: input.expenseId, companyId: input.companyId, status: 'CONFIRMED', updatedAt: current.updatedAt },
        data: {
          paidAmount: paidAfterText,
          outstandingAmount,
          paymentStatus,
          paymentMethod: input.paymentMethod ?? null,
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
        payment: mapPayment(payment),
        replayed: false,
      };
      if (withinTx) await withinTx(tx, result);
      return result;
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

  async createExpense(input: CreateExpenseRecordInput): Promise<ExpenseRecord> {
    await this.assertActiveBranch(input.companyId, input.branchId);
    const r = await this.prisma.client.expenseRecord.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId,
        captureSource: input.captureSource as any,
        expenseDate: new Date(input.expenseDate),
        currency: input.currency ?? 'THB',
        vatMode: input.vatMode as any,
        inputVatClaimStatus: input.inputVatClaimStatus as any,
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
        sourceChannelMetadataJson: input.sourceChannelMetadataJson as any,
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
    return mapExpense(r);
  }

  async findById(companyId: string, id: string): Promise<ExpenseRecord | null> {
    const r = await this.prisma.client.expenseRecord.findFirst({ where: { id, companyId } });
    return r ? mapExpense(r) : null;
  }

  async findAttachmentChecksum(companyId: string, attachmentId: string): Promise<string | null> {
    const attachment = await this.prisma.client.attachmentObject.findFirst({
      where: { id: attachmentId, companyId, status: 'ACTIVE' as any },
      select: { checksumSha256: true },
    });
    return attachment?.checksumSha256 ?? null;
  }

  async findExpenseIdsByAttachmentChecksum(
    companyId: string,
    excludeId: string,
    checksumSha256: string,
    db: ExpenseDb = this.prisma.client,
    scopes: { branchIds?: string[] } = {},
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
  ): Promise<{ id: string; bucket: string; objectKey: string; objectVersionId?: string; mimeType: string; byteSize: number } | null> {
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
    };
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
        lines: { orderBy: { lineNumber: 'asc' } },
        payments: { orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }] },
        // The category's suggested Tax Code rides on the row already being joined — the line
        // picker needs it, and a second query for one string would be waste.
        expenseCategory: { select: { defaultInputTaxCode: true } },
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
    const payments = paymentRows.map((payment: any) => {
      const paymentJournal = journals.find((entry) => entry.sourceType === 'expense.payment' && entry.sourceId === payment.id);
      return mapPayment({
        ...payment,
        journalEntryId: paymentJournal?.id ?? payment.journalEntryId,
        journalEntryNumber: paymentJournal?.entryNumber ?? null,
      });
    });
    // fetch attachment links for this expense
    const links: Array<{ attachmentId: string; purpose: string; attachment: { originalFileName: string; mimeType: string; byteSize: bigint | number; checksumSha256: string | null; perceptualHash: string | null; status: string; createdAt: Date } }> = await db.attachmentLink.findMany({
      where: { companyId, targetType: 'expense.record', targetId: id, attachment: { companyId } },
      include: { attachment: true },
    }) as any;
    const attachments = links.map((l) => ({
      id: l.attachmentId,
      purpose: l.purpose as any,
      originalFileName: l.attachment.originalFileName,
      mimeType: l.attachment.mimeType,
      byteSize: Number(l.attachment.byteSize),
      checksumSha256: l.attachment.checksumSha256 ?? null,
      perceptualHash: l.attachment.perceptualHash ?? null,
      status: l.attachment.status,
      createdAt: l.attachment.createdAt.toISOString(),
    }));
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
      duplicateOfExpenseId: visibleDuplicateOfExpenseId,
      journalEntryId: journal?.id ?? null,
      journalEntryNumber: journal?.entryNumber ?? null,
      pendingPostingSourceType: pendingSource?.sourceType ?? null,
      pendingPostingSourceId: pendingSource?.sourceId ?? null,
      lines: mappedLines,
      charges: expenseLineCharges(mappedLines),
      attachments,
      duplicateCandidates,
      substituteReceiptEvidence: substituteRow ? toSubstituteEvidenceSummary(mapSubstituteEvidence(substituteRow)) : null,
      payments,
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

  async listExpenses(
    filter: ListExpensesFilter,
    scopes?: { branchIds?: string[] },
    relatedUserId?: string,
  ): Promise<PaginatedExpenses> {
    const { companyId, page = 1, pageSize = 20, ...rest } = filter;
    const skip = (page - 1) * pageSize;
    // 10D branch ABAC: restricted scope sees its branches plus company-central (null) rows.
    // Explicit branchId filter (already scope-asserted by the use-case) is narrower and wins.
    const scopeWhere = scopes && !rest.branchId ? branchScopeWhere(scopes) : {};
    const where: any = { companyId, ...scopeWhere, ...(rest.status && { status: rest.status }), ...(rest.paymentStatus && { paymentStatus: rest.paymentStatus }), ...(rest.duplicateStatus && { duplicateStatus: rest.duplicateStatus }), ...(rest.postingStatus && { postingStatus: rest.postingStatus }), ...(rest.vendorCounterpartyId && { vendorCounterpartyId: rest.vendorCounterpartyId }), ...(rest.captureSource && { captureSource: rest.captureSource }), ...(rest.sourceDocumentType && { sourceDocumentType: rest.sourceDocumentType }), ...(rest.taxEvidenceStatus && { taxEvidenceStatus: rest.taxEvidenceStatus }), ...(rest.expenseCategoryId && { expenseCategoryId: rest.expenseCategoryId }), ...(rest.createdByUserId && { createdByUserId: rest.createdByUserId }), ...(rest.branchId && { branchId: rest.branchId }), ...(rest.fromDate || rest.toDate ? { expenseDate: civilDayRangeToUtc(rest.fromDate, rest.toDate) } : {}), ...(rest.uploadedFromDate || rest.uploadedToDate ? { uploadedAt: bangkokCivilDayRangeToUtc(rest.uploadedFromDate, rest.uploadedToDate) } : {}), ...(relatedUserId ? { AND: [expenseRelatedToUserWhere(relatedUserId)] } : {}) };
    const uploadDateLens = (rest.uploadedFromDate || rest.uploadedToDate) && !(rest.fromDate || rest.toDate);
    const orderBy = [uploadDateLens ? { uploadedAt: 'desc' as const } : { expenseDate: 'desc' as const }, { id: 'desc' as const }];
    const [data, total] = await Promise.all([
      this.prisma.client.expenseRecord.findMany({ where, skip, take: pageSize, orderBy }),
      this.prisma.client.expenseRecord.count({ where }),
    ]);
    return { data: data.map(mapExpense), total, page, pageSize };
  }

  async listCompanySubstituteReceipts(
    companyId: string,
    filter: SubstituteReceiptListFilter,
    scope: { branchIds?: string[]; onlyPayerUserId: string | null; relatedUserId?: string | null },
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
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.expenseSubstituteReceiptEvidence.findMany({
        where,
        select: {
          id: true,
          expenseId: true,
          documentNumber: true,
          version: true,
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
              expenseNumber: true,
              expenseDate: true,
              vendorNameSnapshot: true,
              currency: true,
              grandTotalAmount: true,
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { version: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.expenseSubstituteReceiptEvidence.count({ where }),
    ]);
    return { rows, total };
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
    const { id, companyId, expectedUpdatedAt, ...rest } = input;
    if (rest.branchId !== undefined) await assertActiveExpenseBranch(db ?? this.prisma.client, companyId, rest.branchId);
    // H-04: VOIDED is intentionally rejected here — voids must go through
    // voidExpenseTrueReversal so the GL reversal and status change stay atomic.
    if (rest.status === 'VOIDED') {
      throw new UnprocessableEntityException('Use voidExpenseTrueReversal for voids');
    }
    const data: any = {};
    const fields: Array<keyof typeof rest> = ['branchId', 'status', 'vendorCounterpartyId', 'vendorSnapshotJson', 'vendorNameSnapshot', 'vendorTaxIdSnapshot', 'vendorBranchCodeSnapshot', 'vendorEntityKindSnapshot', 'vendorDocumentNumber', 'expenseDate', 'receivedAt', 'dueDate', 'currency', 'vatMode', 'inputVatClaimStatus', 'expenseCategoryId', 'accountHintKey', 'taxCategory', 'duplicateStatus', 'duplicateOfExpenseId', 'duplicateOverrideReason', 'primaryAttachmentId', 'extractionId', 'aiVerificationStatus', 'aiVerifiedFieldsJson', 'aiVerificationSummaryJson', 'vatCaptureSnapshotJson', 'aiVerificationConfidence', 'aiVerifiedAt', 'lineMessageId', 'lineEventId', 'missingReceiptReason', 'postingStatus', 'postingError', 'note', 'internalMemo', 'updatedByUserId', 'updatedAt', 'reviewedByUserId', 'reviewedAt', 'confirmedByUserId', 'confirmedAt', 'rejectedByUserId', 'rejectedAt', 'rejectReason', 'voidedByUserId', 'voidedAt', 'voidReason', 'subtotalAmount', 'discountAmount', 'taxableAmount', 'vatAmount', 'whtAmount', 'grandTotalAmount', 'netPayableAmount', 'paidAmount', 'outstandingAmount', 'paymentStatus', 'paymentMethod', 'paidAt', 'bankAccountRef', 'expenseNumber', 'sourceDocumentType', 'sourceDocumentLanguage', 'taxEvidenceStatus', 'taxEvidenceReasonCode', 'substituteReceiptGeneratedAt', 'substituteReceiptGeneratedByUserId', 'sourceChannelMetadataJson'];
    fields.push('whtInputJson');
    for (const f of fields) {
      if (rest[f] !== undefined) data[f] = rest[f];
    }
    return this.runInTx(db, async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${id}:substitute-receipt`}))`;
      // `vendorEntityKindSnapshot` is deliberately NOT material. The payee taxpayer class is never
      // printed on the ใบรับรองแทนใบเสร็จ artifact (`substitute-receipt.logic.ts`), so locking it buys
      // no document integrity — and it deadlocks: confirming a substitute-reliant expense requires the
      // evidence already ISSUED (`expense-draft.use-case.ts:380`), while `validateConfirm` REQUIRES the
      // class whenever `whtAmount > 0` (`expense-status.logic.ts:199`). It must stay writable after
      // PAYER_CERTIFIED/ISSUED or such an expense can never be confirmed at all.
      const materialFields = new Set([
        'branchId', 'vendorCounterpartyId', 'vendorSnapshotJson', 'vendorNameSnapshot', 'vendorTaxIdSnapshot',
        'vendorBranchCodeSnapshot', 'vendorDocumentNumber', 'expenseDate', 'currency', 'vatMode',
        'inputVatClaimStatus', 'expenseCategoryId', 'accountHintKey', 'taxCategory', 'primaryAttachmentId',
        'vatCaptureSnapshotJson', 'whtInputJson',
        'missingReceiptReason', 'note', 'subtotalAmount', 'discountAmount', 'taxableAmount', 'vatAmount',
        'whtAmount', 'grandTotalAmount', 'netPayableAmount', 'paidAmount', 'outstandingAmount',
        'paymentStatus', 'paymentMethod', 'paidAt', 'bankAccountRef', 'sourceDocumentType',
        'sourceDocumentLanguage', 'taxEvidenceStatus', 'taxEvidenceReasonCode',
      ]);
      if (Object.keys(data).some((field) => materialFields.has(field))) {
        const signedEvidence = await tx.expenseSubstituteReceiptEvidence.findFirst({
          where: { companyId, expenseId: id, status: { in: ['PAYER_CERTIFIED', 'ISSUED'] } },
          select: { id: true },
        });
        if (signedEvidence) throw new ConflictException({ code: 'substitute_evidence_locks_expense', message: 'Signed substitute evidence locks material expense data. Prepare a corrected version before changing it.' });
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
      const record = mapExpense(await tx.expenseRecord.findFirstOrThrow({ where: { id, companyId } }));
      await withinTx?.(tx);
      return record;
    });
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.expenseId}:substitute-receipt`}))`;
      const evidence = await tx.expenseSubstituteReceiptEvidence.findFirst({
        where: {
          id: input.evidenceId, companyId: input.companyId, expenseId: input.expenseId,
          status: { in: ['PREPARED', 'PAYER_CERTIFIED', 'ISSUED'] }, updatedAt: input.expectedEvidenceUpdatedAt,
        },
      });
      if (!evidence) throw new ConflictException({ code: 'substitute_evidence_stale', message: 'Substitute evidence changed. Reload before cancelling or correcting it.' });
      const expense = await tx.expenseRecord.findFirst({ where: { id: input.expenseId, companyId: input.companyId } });
      if (!expense || !['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status)) {
        throw new ConflictException({ code: 'substitute_evidence_expense_confirmed', message: 'Only an unconfirmed expense can cancel or replace substitute evidence.' });
      }
      const changed = await tx.expenseSubstituteReceiptEvidence.updateMany({
        where: { id: evidence.id, status: evidence.status, updatedAt: input.expectedEvidenceUpdatedAt },
        data: { status: 'SUPERSEDED', supersededAt: new Date(), supersedeReason: input.reason },
      });
      if (changed.count !== 1) throw new ConflictException({ code: 'substitute_evidence_stale', message: 'Substitute evidence changed while superseding.' });
      if (evidence.status === 'ISSUED') {
        // Issuing marked the expense PAID and recorded a payment (issueSubstituteEvidence);
        // superseding the certificate must take both back. The expense is still unconfirmed
        // here, so its payments can only have come from issuance and are never posted —
        // voiding them needs no GL reversal.
        await tx.expensePayment.updateMany({
          where: { companyId: input.companyId, expenseId: input.expenseId, status: 'RECORDED', postingStatus: 'pending' },
          data: {
            status: 'VOIDED', voidedByUserId: input.actorUserId, voidedAt: new Date(),
            postingStatus: 'not_required', postingError: null,
          },
        });
        await tx.expenseRecord.updateMany({ where: { id: input.expenseId, companyId: input.companyId }, data: {
          missingReceiptReason: null,
          substituteReceiptGeneratedAt: null,
          substituteReceiptGeneratedByUserId: null,
          paidAmount: '0.0000',
          outstandingAmount: calcPaymentAmounts(expense.netPayableAmount.toString(), '0').outstandingAmount,
          paymentStatus: 'UNPAID',
          paymentMethod: null,
          paidAt: null,
          updatedByUserId: input.actorUserId,
        } });
      }
      return toSubstituteEvidenceSummary(mapSubstituteEvidence(
        await tx.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } }),
      ));
    });
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

  async listActiveMemberIdentities(companyId: string, branchId: string | null): Promise<Array<{ userId: string; displayName: string }>> {
    const memberships = await (this.prisma.client as any).companyMembership.findMany({
      where: { companyId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
      include: { user: { select: { displayName: true } }, branchScopes: { select: { branchId: true } } },
      orderBy: { user: { displayName: 'asc' } },
    });
    return memberships
      .filter((membership: any) => !branchId
        || membership.branchScopeMode === 'ALL_BRANCHES'
        || (membership.branchScopeMode === 'DEFAULT_BRANCH_ONLY'
          ? membership.defaultBranchId === branchId
          : membership.branchScopes.some((scope: { branchId: string }) => scope.branchId === branchId)))
      .map((membership: any) => ({ userId: membership.userId, displayName: membership.user.displayName }));
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

  async getSubstituteCompanyContext(companyId: string, branchId: string | null): Promise<{ name: string; taxId: string | null; branchName: string | null }> {
    const company = await this.prisma.client.company.findFirst({ where: { id: companyId }, select: { registeredName: true, name: true, taxId: true } });
    if (!company) throw new Error(`Company ${companyId} not found`);
    const branch = branchId
      ? await this.prisma.client.branch.findFirst({ where: { id: branchId, companyId }, select: { name: true } })
      : null;
    return { name: company.registeredName ?? company.name, taxId: company.taxId, branchName: branch?.name ?? null };
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

  async createPreparedSubstituteEvidence(input: {
    companyId: string;
    expenseId: string;
    branchId: string | null;
    expectedExpenseUpdatedAt: Date;
    originalSourceDocumentType: string;
    reasonCode: string;
    missingReceiptReason: string;
    businessPurpose: string;
    paymentEvidenceAttachmentIds: string[];
    supportingAttachmentIds: string[];
    paymentDate: Date | null;
    paymentMethod: string | null;
    note: string | null;
    payerUserId: string;
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.expenseId}:substitute-receipt`}))`;
      const existing = await tx.expenseSubstituteReceiptEvidence.findFirst({
        where: { companyId: input.companyId, expenseId: input.expenseId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        const same = existing.reasonCode === input.reasonCode
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
      const expense = await tx.expenseRecord.findFirst({ where: { id: input.expenseId, companyId: input.companyId } });
      if (!expense || expense.updatedAt.getTime() !== input.expectedExpenseUpdatedAt.getTime()) {
        throw new ConflictException({ code: 'expense_stale_reload', message: 'Expense changed after review. Reload before preparing substitute evidence.' });
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
      const safeUpdate = await tx.expenseRecord.updateMany({
        where: {
          id: input.expenseId,
          companyId: input.companyId,
          updatedAt: input.expectedExpenseUpdatedAt,
          status: { in: ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'] },
        },
        data: {
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
        where: { companyId: input.companyId, expenseId: input.expenseId, status: 'PAYER_CERTIFIED' },
      });
      if (pendingCertified) throw new Error('A payer-certified version is already waiting for approval.');
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
        periodKey: civilPeriodKey(civilDate(preparedAt)),
        idempotencyKey: `${input.expenseId}:${input.idempotencyKey}`,
        reservedByUserId: input.preparedByUserId,
      });
      const evidence = await tx.expenseSubstituteReceiptEvidence.create({
        data: {
          companyId: input.companyId,
          expenseId: input.expenseId,
          branchId: input.branchId,
          version,
          documentNumber: reserved.documentNumber,
          idempotencyKey: input.idempotencyKey,
          originalSourceDocumentType: input.originalSourceDocumentType,
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
  }): Promise<SubstituteReceiptEvidenceRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
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
    });
  }

  async issueSubstituteEvidence(input: {
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
  }): Promise<SubstituteReceiptEvidenceRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.expenseId}:substitute-receipt`}))`;
      for (const attachmentId of [...new Set(input.referencedAttachmentIds)].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${attachmentId}:attachment-retention`}))`;
      }
      const evidence = await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { id: input.evidenceId, companyId: input.companyId, expenseId: input.expenseId } });
      if (!evidence || evidence.status !== 'PAYER_CERTIFIED' || evidence.version !== input.expectedVersion
        || evidence.updatedAt.getTime() !== input.expectedEvidenceUpdatedAt.getTime()) {
        throw new Error('Substitute evidence changed. Reload before approval.');
      }
      if (!input.allowSelfApproval && evidence.payerUserId === input.approverUserId) {
        throw new Error('The payer cannot approve their own substitute receipt.');
      }
      const expense = await tx.expenseRecord.findFirst({
        where: { id: input.expenseId, companyId: input.companyId, updatedAt: input.expectedExpenseUpdatedAt },
      });
      if (!expense) throw new Error('Expense details changed after payer certification. Finance must prepare a new version.');
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
        where: { id: evidence.id, companyId: input.companyId, status: 'PAYER_CERTIFIED', updatedAt: input.expectedEvidenceUpdatedAt },
        data: {
          status: 'ISSUED', approverUserId: input.approverUserId, approverName: input.approverName,
          approverPosition: input.approverPosition,
          ...(input.approverSignatureAttachmentId ? { approverSignatureAttachmentId: input.approverSignatureAttachmentId } : {}),
          approvedAt: now, artifactAttachmentId: attachment.id, checksumSha256: input.artifact.checksumSha256,
          issuedByUserId: input.approverUserId, issuedAt: now,
        },
      });
      if (changed.count !== 1) throw new Error('Substitute evidence changed while approving.');
      if (!evidence.paymentDate || !evidence.paymentMethod) {
        throw new Error('Certified substitute evidence is missing payment date or method.');
      }
      const paidBefore = new Decimal(expense.paidAmount.toString());
      const payable = new Decimal(expense.netPayableAmount.toString());
      if (paidBefore.lt(0) || paidBefore.minus(payable).gt(SETTLE_EPSILON)) {
        throw new Error('Expense payment totals are inconsistent. Reload before approval.');
      }
      const paymentAmount = payable.minus(paidBefore);
      if (paymentAmount.gt(0)) {
        await tx.expensePayment.create({ data: {
          companyId: input.companyId,
          expenseId: input.expenseId,
          amount: paymentAmount.toFixed(4),
          currency: expense.currency,
          paymentMethod: evidence.paymentMethod,
          paidAt: evidence.paymentDate,
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
        paidAmount: Decimal.max(paidBefore, payable).toFixed(4), outstandingAmount: '0.0000', paymentStatus: 'PAID',
        paymentMethod: evidence.paymentMethod, paidAt: evidence.paymentDate,
        substituteReceiptGeneratedAt: now, substituteReceiptGeneratedByUserId: input.approverUserId,
        reviewedByUserId: input.approverUserId, reviewedAt: now, updatedByUserId: input.approverUserId,
      } });
      if (expenseChanged.count !== 1) throw new Error('Expense details changed while approving substitute evidence.');
      return mapSubstituteEvidence(await tx.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } }));
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
    // A REVERSAL row for this source is the authoritative "already reversed"
    // signal (one per source by unique constraint) — original.status is not,
    // because reports count POSTED entries only.
    const sourceWhere = { companyId: opts.companyId, sourceType, sourceId };
    const existingReversal = await tx.journalEntry.findFirst({
      where: { ...sourceWhere, entryType: 'REVERSAL' },
      select: { id: true },
    });
    if (existingReversal) return { reversalEntryId: null, reversed: true };
    const original = await tx.journalEntry.findFirst({
      where: { ...sourceWhere, entryType: 'GENERATED' },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!original) return { reversalEntryId: null, reversed: false };
    if (original.status !== 'POSTED') {
      throw new UnprocessableEntityException(`Generated journal ${original.entryNumber} is ${original.status}; resolve its posting state before voiding`);
    }
    if (!opts.reversalEntryNumber) {
      throw new ConflictException({ code: 'posting_state_changed', message: 'Posting state changed while voiding. Retry the void.' });
    }
    // Fail closed on a missing period row: the FK guarantees it exists, but a
    // dangling id must block the void rather than skip the period/tax locks.
    const period = await tx.accountingPeriod.findFirst({ where: { companyId: opts.companyId, id: original.periodId } });
    if (!period) {
      throw new UnprocessableEntityException(`Accounting period for journal ${original.entryNumber} was not found; cannot void`);
    }
    if (!['OPEN', 'REOPENED'].includes(period.status)) {
      throw new ConflictException({ code: 'accounting_period_locked', message: `Accounting period ${period.periodKey} is not open; reopen it before voiding.` });
    }
    if (opts.lockedTaxFormTypes.length) {
      const lockedTaxPeriod = await tx.taxPeriod.findFirst({
        where: { companyId: opts.companyId, formType: { in: opts.lockedTaxFormTypes }, periodKey: period.periodKey, status: { in: ['FILED', 'PAID', 'CLOSED'] } },
        select: { formType: true },
      });
      if (lockedTaxPeriod) {
        throw new ConflictException({ code: 'tax_period_locked', message: `${lockedTaxPeriod.formType}/${period.periodKey} is locked; use an adjustment or amended filing workflow.` });
      }
    }
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

  // H-04: expense void is a true reversal — status claim, payable zeroing, and
  // GL reversal commit or roll back together.
  async voidExpenseTrueReversal(
    companyId: string,
    expenseId: string,
    actorUserId: string,
    reason: string,
    reversalEntryNumber?: string,
    paymentReversals: Array<{ paymentId: string; reversalEntryNumber: string }> | string = [],
  ): Promise<{ expense: ExpenseRecord; reversalEntryId: string | null; paymentReversalEntryId: string | null; paymentReversalEntryIds: Array<{ paymentId: string; reversalEntryId: string }> }> {
    return await (this.prisma.client as any).$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${expenseId}:expense-record-lifecycle`}))`;
      const voidedAt = new Date();
      const claimed = await tx.expenseRecord.updateMany({
        where: { id: expenseId, companyId, status: 'CONFIRMED' },
        data: {
          status: 'VOIDED', voidedByUserId: actorUserId, voidedAt, voidReason: reason,
          updatedByUserId: actorUserId, paidAmount: '0.00', outstandingAmount: '0.00', paymentStatus: 'VOIDED',
        },
      });
      if (claimed.count !== 1) throw new ConflictException({ code: 'expense_changed', message: 'Expense changed before void. Reload and retry.' });
      const expense = await tx.expenseRecord.findFirstOrThrow({ where: { id: expenseId, companyId }, include: { lines: true } });

      // Keep the immutable issued artifact for audit, but retire both its evidence state and
      // running number in the same transaction as the expense reversal. Downloads derive a
      // visibly VOID-stamped PDF from the original SVG; the checksummed source is never rewritten.
      const issuedEvidence = await tx.expenseSubstituteReceiptEvidence.findMany({
        where: { companyId, expenseId, status: 'ISSUED' },
        select: { id: true },
      });
      if (issuedEvidence.length > 0) {
        const evidenceIds = issuedEvidence.map((item: { id: string }) => item.id);
        await tx.expenseSubstituteReceiptEvidence.updateMany({
          where: { companyId, expenseId, id: { in: evidenceIds }, status: 'ISSUED' },
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
            ownerId: { in: evidenceIds },
            status: 'COMMITTED',
          },
          data: { status: 'VOIDED', voidedAt },
        });
      }

      // Filed-form contributions on the tax-line snapshots decide the
      // tax-period lock — the same seam the confirmation gate uses. The
      // claim-status fallback fails closed for rows without components.
      const formTypes = new Set<string>();
      for (const line of expense.lines ?? []) {
        const components = Array.isArray(line.taxComponentsJson) ? line.taxComponentsJson : [];
        for (const component of components) {
          for (const contribution of component?.reportContributions ?? []) {
            if (['PP30', 'PP36', 'CUSTOMS_SUPPORT'].includes(contribution?.formType)) formTypes.add(contribution.formType);
          }
        }
      }
      if (expense.inputVatClaimStatus === 'CLAIMABLE' && Number(expense.vatAmount) !== 0) formTypes.add('PP30');

      const reversal = await this.reverseExpenseJournalInTx(tx, {
        companyId, expenseId, sourceType: 'expense.record', reversalEntryNumber, actorUserId,
        memo: `[VOID] ${expense.expenseNumber ?? expenseId}`,
        lockedTaxFormTypes: [...formTypes],
      });
      const requestedPaymentReversals = typeof paymentReversals === 'string'
        ? [{ paymentId: expenseId, reversalEntryNumber: paymentReversals }]
        : paymentReversals;
      const payments = typeof paymentReversals === 'string'
        ? [{ id: expenseId }]
        : tx.expensePayment
          ? await tx.expensePayment.findMany({ where: { companyId, expenseId, status: 'RECORDED' }, orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }] })
          : [];
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
        }
      }
      await tx.expenseRecord.update({
        where: { id: expenseId },
        data: { postingStatus: reversal.reversed ? 'reversed' : 'not_required', postingError: null },
      });
      const row = await tx.expenseRecord.findFirstOrThrow({ where: { id: expenseId, companyId } });
      return {
        expense: mapExpense(row),
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
      const changed = await tx.expenseRecord.updateMany({
        where: { id: input.id, companyId: input.companyId, updatedAt: input.expectedUpdatedAt },
        data: {
          status: 'CONFIRMED', confirmedByUserId: input.actorUserId, confirmedAt: new Date(),
          updatedByUserId: input.actorUserId, expenseNumber: input.expenseNumber, postingStatus: input.postingStatus,
          ...(input.vendorSnapshotJson ? { vendorSnapshotJson: input.vendorSnapshotJson } : {}),
        },
      });
      if (changed.count !== 1) throw new Error('Expense changed while confirming. Reload and review it again.');
      await tx.outboxEvent.create({
        data: {
          companyId: input.companyId,
          eventType: 'expense.confirmed',
          aggregateType: 'expense_record',
          aggregateId: input.id,
          eventKey: input.outboxEvent.eventKey,
          payloadJson: input.outboxEvent.payloadJson,
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
    expenseNumber: string;
    postingStatus: import('@watchdog-bms/contracts').ExpensePostingStatus;
    vendorSnapshotJson: Record<string, unknown> | null;
    /** Claim-born confirm under reimbursement authority: the signed ใบเบิก covers the missing
     *  receipt, so no expense-side substitute artifact is demanded (mirrors the use-case gate). */
    substituteCoveredByClaimForm?: boolean;
    vatSourceOverride?: ExpenseVatSourceOverrideInput;
    outboxEvent: { eventKey: string; payloadJson: Record<string, unknown> };
  }, finalizeTax: ExpenseTaxFinalizer): Promise<{ expense: ExpenseRecord; finalized: ExpenseLineInput[] }> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.id}:substitute-receipt`}))`;
      const current = await tx.expenseRecord.findFirst({
        where: { id: input.id, companyId: input.companyId },
        include: { lines: { orderBy: { lineNumber: 'asc' } }, duplicateCandidates: { where: { status: { not: 'DISMISSED' } } } },
      });
      if (!current || current.status !== 'READY_FOR_CONFIRMATION') throw new ConflictException('expense_confirmation_source_status_changed');
      requireExpenseBranchId(current.branchId);
      if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new ConflictException('expense_confirmation_source_version_changed');
      const substitute = await tx.expenseSubstituteReceiptEvidence.findFirst({
        where: { companyId: input.companyId, expenseId: input.id, status: { not: 'SUPERSEDED' } }, orderBy: { version: 'desc' },
      });
      // The source checksum covers attachments, so the CAS re-read must load
      // them the same way findByIdWithRelations does — an empty list here
      // makes every attachment-bearing expense fail the checksum guard.
      const attachmentLinks: Array<{ attachmentId: string; purpose: string; attachment: { originalFileName: string; mimeType: string; byteSize: bigint | number; checksumSha256: string | null; status: string; createdAt: Date } }> = await tx.attachmentLink.findMany({
        where: { companyId: input.companyId, targetType: 'expense.record', targetId: input.id, attachment: { companyId: input.companyId } },
        include: { attachment: true },
      }) as any;
      const currentLines = current.lines.map(mapLine);
      const currentRecord: ExpenseRecordWithRelations = {
        ...mapExpense(current),
        lines: currentLines,
        charges: expenseLineCharges(currentLines),
        attachments: attachmentLinks.map((l) => ({
          id: l.attachmentId,
          purpose: l.purpose as any,
          originalFileName: l.attachment.originalFileName,
          mimeType: l.attachment.mimeType,
          byteSize: Number(l.attachment.byteSize),
          checksumSha256: l.attachment.checksumSha256 ?? null,
          status: l.attachment.status,
          createdAt: l.attachment.createdAt.toISOString(),
        })),
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

      const reliesOnSubstitute = Boolean(current.missingReceiptReason || current.substituteReceiptGeneratedAt || current.sourceDocumentType === 'SUBSTITUTE_RECEIPT');
      const coveredByClaimForm = Boolean(input.substituteCoveredByClaimForm)
        && !current.substituteReceiptGeneratedAt && current.sourceDocumentType !== 'SUBSTITUTE_RECEIPT';
      if (reliesOnSubstitute && !coveredByClaimForm && (!substitute || substitute.status !== 'ISSUED' || !substitute.artifactAttachmentId)) {
        throw new ConflictException('expense_confirmation_substitute_evidence_changed');
      }
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

      const periodKey = civilPeriodKey(coerceCivilDate(current.expenseDate));
      const accountingPeriod = await tx.accountingPeriod.findUnique({
        where: { companyId_periodKey: { companyId: input.companyId, periodKey } }, select: { status: true },
      });
      if (accountingPeriod && !['OPEN', 'REOPENED'].includes(String(accountingPeriod.status))) {
        throw new ConflictException(`expense_confirmation_accounting_period_locked:${periodKey}`);
      }
      const formTypes = [...new Set(finalized.flatMap((line) => line.taxComponents ?? [])
        .flatMap((component) => component.reportContributions.map((contribution) => contribution.formType))
        .filter((formType) => ['PP30', 'PP36', 'CUSTOMS_SUPPORT'].includes(formType)))];
      if (formTypes.length) {
        const periods = await tx.taxPeriod.findMany({
          where: { companyId: input.companyId, periodKey, formType: { in: formTypes } }, select: { formType: true, status: true },
        });
        const locked = periods.find((period: any) => ['FILED', 'PAID', 'CLOSED'].includes(String(period.status)));
        if (locked) throw new ConflictException(`expense_confirmation_tax_period_locked:${locked.formType}:${periodKey}`);
      }

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
      const changed = await tx.expenseRecord.updateMany({
        where: { id: input.id, companyId: input.companyId, status: 'READY_FOR_CONFIRMATION', updatedAt: input.expectedUpdatedAt },
        data: {
          status: 'CONFIRMED', confirmedByUserId: input.actorUserId, confirmedAt: new Date(), updatedByUserId: input.actorUserId,
          expenseNumber: input.expenseNumber, postingStatus: input.postingStatus,
          ...(acceptedVat && {
            ...acceptedVat.totals, vatCaptureSnapshotJson: acceptedVat.snapshot,
            ...calcPaymentAmounts(acceptedVat.totals.netPayableAmount, currentRecord.paidAmount),
            paymentStatus: derivePaymentStatus(acceptedVat.totals.netPayableAmount, currentRecord.paidAmount),
          }),
          ...(input.vendorSnapshotJson ? { vendorSnapshotJson: input.vendorSnapshotJson } : {}),
        },
      });
      if (changed.count !== 1) throw new ConflictException('expense_confirmation_source_version_changed');
      await tx.outboxEvent.create({ data: {
        companyId: input.companyId, eventType: 'expense.confirmed', aggregateType: 'expense_record', aggregateId: input.id,
        eventKey: input.outboxEvent.eventKey, payloadJson: input.outboxEvent.payloadJson, priority: 'NORMAL', status: 'PENDING',
      } });
      return {
        expense: mapExpense(await tx.expenseRecord.findFirstOrThrow({ where: { id: input.id, companyId: input.companyId } })),
        finalized,
      };
    }, { isolationLevel: 'Serializable' });
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
  }): Promise<ExpenseRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
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

  async upsertLines(companyId: string, expenseId: string, lines: ExpenseLineInput[], db?: any): Promise<void> {
    await this.runInTx(db, async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${expenseId}:substitute-receipt`}))`;
      const signedEvidence = await tx.expenseSubstituteReceiptEvidence.findFirst({
        where: { companyId, expenseId, status: { in: ['PAYER_CERTIFIED', 'ISSUED'] } }, select: { id: true },
      });
      if (signedEvidence) throw new ConflictException({ code: 'substitute_evidence_locks_lines', message: 'Signed substitute evidence locks expense lines. Prepare a corrected version before changing them.' });
      await tx.expenseLine.deleteMany({ where: { expenseId, companyId, lineNumber: { notIn: lines.map((line) => line.lineNumber) } } });
      if (lines.length > 0) {
        for (const l of lines) {
          const { taxSnapshot, taxComponents } = l;
          const data = {
          expenseId, companyId, lineNumber: l.lineNumber, description: l.description,
          chargeKind: l.chargeKind ?? null,
          quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: l.discountAmount,
          taxableAmount: l.taxableAmount, vatRate: l.vatRate, vatTreatment: l.vatTreatment ?? null, vatAmount: l.vatAmount,
          whtRate: l.whtRate, whtAmount: l.whtAmount, lineSubtotalAmount: l.lineSubtotalAmount,
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
  ): Promise<Array<{ id: string; checksumSha256: string | null; perceptualHash: string | null; vendorDocumentNumber: string | null; vendorTaxId: string | null; expenseDate: string | null; grandTotalAmount: string; vendorCounterpartyId: string | null; vendorName: string | null }>> {
    const rows = await db.expenseRecord.findMany({
      where: {
        companyId,
        id: { not: excludeId },
        status: { not: 'VOIDED' as any },
        createdAt: { gte: since },
        ...branchScopeWhere(scopes),
      },
      select: { id: true, primaryAttachmentId: true, vendorDocumentNumber: true, vendorTaxIdSnapshot: true, vendorNameSnapshot: true, expenseDate: true, grandTotalAmount: true, vendorCounterpartyId: true },
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
    input: { companyId: string; expenseId: string; scopes: { branchIds?: string[] } },
  ): Promise<void> {
    // ponytail: duplicate writes are low-frequency; one company lock avoids cross-writer lock cycles.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:duplicate-reconciliation`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.expenseId}:substitute-receipt`}))`;
    const expense = await tx.expenseRecord.findFirst({
      where: { id: input.expenseId, companyId: input.companyId },
      select: { branchId: true, status: true, postingStatus: true },
    });
    if (!expense) throw new NotFoundException(`Expense ${input.expenseId} not found`);
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
  }): Promise<Array<{ id: string; expenseDate: Date | null; grandTotalAmount: string | null; sourceDocumentType: string | null; createdAt: Date }>> {
    const rows = await this.prisma.client.expenseRecord.findMany({
      where: {
        companyId: input.companyId,
        createdByUserId: input.createdByUserId,
        captureSource: 'LINE_UPLOAD',
        status: { in: ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'] as any },
        createdAt: { gte: input.since },
        // Rows captured before chatKeyHash existed simply never match — accepted transitional gap.
        sourceChannelMetadataJson: { path: ['chatKeyHash'], equals: input.chatKeyHash },
        ...branchScopeWhere(input.scopes),
      },
      orderBy: { createdAt: 'desc' },
      take: input.take,
      // ponytail: served by the existing (companyId, captureSource) index plus a filter+sort;
      // fine at SME LINE-capture volumes. Add (companyId, captureSource, createdAt) if a company's
      // LINE upload history ever makes this scan show up.
      select: { id: true, expenseDate: true, grandTotalAmount: true, sourceDocumentType: true, createdAt: true },
    });
    return rows.map((row: any) => ({
      id: row.id,
      expenseDate: row.expenseDate ?? null,
      grandTotalAmount: row.grandTotalAmount?.toString() ?? null,
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
        status: 'DRAFT',
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
      orderBy: { updatedAt: 'desc' },
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
      const substitute = metadata['lineSubstituteReceiptContinuation'];
      if (substitute && typeof substitute === 'object'
        && ['OPEN', 'PAUSED'].includes(String((substitute as any).status))
        && (substitute as any).expenseId === input.expenseId
        && (substitute as any).userId === input.userId) {
        metadata['lineSubstituteReceiptContinuation'] = {
          ...(substitute as Record<string, unknown>),
          targetRevision: now.toISOString(),
        };
      }
      const expenseDraft = metadata['lineExpenseDraftContinuation'];
      if (expenseDraft && typeof expenseDraft === 'object'
        && ['OPEN', 'PAUSED', 'PAUSED_INTERRUPTED', 'INPUT_ENDED_COMPLETE', 'INPUT_ENDED_INCOMPLETE'].includes(String((expenseDraft as any).status))
        && (expenseDraft as any).expenseId === input.expenseId
        && (expenseDraft as any).userId === input.userId
        && (expenseDraft as any).chatKeyHash === input.chatKeyHash
        // Only advance a continuation that represented the row before this delivery write. A
        // mismatch means a real intervening edit and must remain stale rather than being rebased.
        && (expenseDraft as any).targetRevision === current.updatedAt.toISOString()) {
        metadata['lineExpenseDraftContinuation'] = {
          ...(expenseDraft as Record<string, unknown>),
          targetRevision: now.toISOString(),
        };
      }
      const changed = await tx.expenseRecord.updateMany({
        where: { id: input.expenseId, companyId: input.companyId, updatedAt: current.updatedAt },
        data: { sourceChannelMetadataJson: metadata, updatedAt: now },
      });
      if (changed.count !== 1) throw new ConflictException({
        code: 'LINE_RECEIPT_CONTINUATION_STALE', message: 'Expense changed while recording the delivered receipt outcome.',
      });
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
    input: { companyId: string; expenseId: string; candidateId: string; actorUserId: string; action: 'dismiss' | 'confirm'; reason?: string; scopes: { branchIds?: string[] } },
    auditWithinTx: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    const client = this.prisma.client as any;
    await client.$transaction(async (tx: Prisma.TransactionClient) => {
      await this.assertDuplicateWriteAllowed(tx, input);
      const existingConfirmed = await tx.expenseDuplicateCandidate.findFirst({
        where: { companyId: input.companyId, expenseId: input.expenseId, status: 'CONFIRMED_DUPLICATE' },
        select: { id: true },
      });
      if (existingConfirmed) throw new ConflictException('Expense already has a confirmed duplicate candidate');
      const ownedCandidate = await tx.expenseDuplicateCandidate.findFirst({
        where: { id: input.candidateId, companyId: input.companyId, expenseId: input.expenseId, status: 'OPEN' },
        select: { candidateExpenseId: true },
      });
      if (!ownedCandidate) throw new NotFoundException(`Open duplicate candidate ${input.candidateId} not found on expense ${input.expenseId}`);
      const candidateExpense = await tx.expenseRecord.findFirst({
        where: {
          id: ownedCandidate.candidateExpenseId,
          companyId: input.companyId,
          ...branchScopeWhere(input.scopes),
        },
        select: { id: true },
      });
      if (!candidateExpense) throw new NotFoundException(`Duplicate target ${ownedCandidate.candidateExpenseId} not found in company ${input.companyId}`);
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
    });
  }

  async linkAttachment(expenseId: string, attachmentId: string, purpose: string, companyId: string, actorUserId: string): Promise<void> {
    await this.linkAttachmentToTarget(attachmentId, 'expense.record', expenseId, purpose, companyId, actorUserId);
  }

  async linkAttachmentToTarget(attachmentId: string, targetType: string, targetId: string, purpose: string, companyId: string, actorUserId: string): Promise<void> {
    const conflict = await findAttachmentLinkConflict(this.prisma.client, { companyId, attachmentId, targetType });
    if (conflict) throw new BadRequestException(conflict);
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
      throw new BadRequestException('รายการที่เลือกสำหรับส่งออกไม่ถูกต้อง กรุณาโหลดข้อมูลใหม่');
    }
    const dateField = filter.dateField === 'expenseDate' ? 'expenseDate' : 'uploadedAt';
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
      ...(fromDate || toDate ? { [dateField]: dateRange } : {}),
    };
  }

  async listSharedEvidence(companyId: string, filter: SharedEvidenceFilter, scopes?: { branchIds?: string[] }): Promise<{
    rows: Array<ExpenseRecord & { categoryName: string | null; journalEntryNumber: string | null; attachments: Array<{ id: string; purpose: string; originalFileName: string; mimeType: string; byteSize: number; checksumSha256: string | null; status: string; createdAt: Date }> }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 && filter.pageSize <= 500 ? filter.pageSize : 50;
    const where = this.buildSharedEvidenceWhere(companyId, filter, scopes);
    const dateField = filter.dateField === 'expenseDate' ? 'expenseDate' : 'uploadedAt';

    const [records, total] = await Promise.all([
      this.prisma.client.expenseRecord.findMany({
        where: where as any,
        include: { expenseCategory: { select: { name: true } } },
        orderBy: [{ [dateField]: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.expenseRecord.count({ where: where as any }),
    ]);

    const ids = records.map((r) => r.id);
    const journalIds = records.map((r) => r.journalEntryId).filter((id): id is string => !!id);
    const links = ids.length > 0 ? await this.prisma.client.attachmentLink.findMany({
      where: { companyId, targetType: 'expense.record', targetId: { in: ids }, attachment: { companyId, status: 'ACTIVE' } },
      include: { attachment: true },
    }) : [];
    const payments = ids.length > 0 ? await this.prisma.client.expensePayment.findMany({
      where: { companyId, expenseId: { in: ids }, status: 'RECORDED' },
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, expenseId: true, postingStatus: true, postingError: true },
    }) : [];
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
    const byExpense = new Map<string, any[]>();
    for (const link of links) {
      const list = byExpense.get(link.targetId) ?? [];
      list.push({
        id: link.attachmentId,
        purpose: link.purpose,
        originalFileName: (link as any).attachment.originalFileName,
        mimeType: (link as any).attachment.mimeType,
        byteSize: Number((link as any).attachment.byteSize),
        checksumSha256: (link as any).attachment.checksumSha256 ?? null,
        status: (link as any).attachment.status,
        createdAt: (link as any).attachment.createdAt,
      });
      byExpense.set(link.targetId, list);
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
          categoryName: (r as any).expenseCategory?.name ?? null,
          journalEntryId,
          journalEntryNumber: journalEntryId ? journalNumberById.get(journalEntryId) ?? null : null,
          pendingPostingSourceType: pendingSource?.sourceType ?? null,
          pendingPostingSourceId: pendingSource?.sourceId ?? null,
          postingStatus: effectivePostingStatus,
          postingError: effectivePostingError,
          attachments: byExpense.get(r.id) ?? [],
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** Virtual year/month folders from the chosen date field (bounded raw aggregate). */
  async summarizeSharedEvidenceFolders(companyId: string, filter: SharedEvidenceFilter, scopes?: { branchIds?: string[] }): Promise<Array<{ yearMonth: string; expenseCount: number; evidenceCount: number; totalAmount: string }>> {
    const dateField = filter.dateField === 'expenseDate' ? 'expenseDate' : 'uploadedAt';
    const where = this.buildSharedEvidenceWhere(companyId, { ...filter, yearMonth: undefined }, scopes);
    const rows = await this.prisma.client.expenseRecord.findMany({
      where: where as any,
      select: { id: true, [dateField]: true, grandTotalAmount: true } as any,
      take: 5000,
    });
    const ids = (rows as Array<Record<string, any>>).map((row) => row['id'] as string);
    const evidenceLinks = ids.length > 0 ? await this.prisma.client.attachmentLink.findMany({
      where: { companyId, targetType: 'expense.record', targetId: { in: ids }, attachment: { status: 'ACTIVE' } },
      select: { targetId: true },
    }) : [];
    const evidencedIds = new Set(evidenceLinks.map((link) => link.targetId));
    const buckets = new Map<string, { count: number; evidenceCount: number; total: number }>();
    for (const row of rows as Array<Record<string, any>>) {
      const date = row[dateField] as Date | null;
      if (!date) continue;
      const key = civilPeriodKey(dateField === 'expenseDate' ? coerceCivilDate(date) : civilDate(date));
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
