import { isDeepStrictEqual } from 'node:util';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { coerceCivilDate, type ReimbursementSourceSnapshot } from '@watchdog-bms/contracts';
import Decimal from 'decimal.js';
import type { Prisma } from '../../../generated/prisma/client';
import type { ReimbursementAttachmentSnapshot } from '../domain/models/reimbursement.model';
import { lockFundingEvidence } from '../../expenses/infrastructure/substitute-funding.guard';
import { isAllowedAttachmentTarget } from '../../data-model-core/domain/logic/attachment.logic';
import { expenseTotalsIdentityError } from '../../expenses/domain/logic/expense-totals.logic';

export type SourceLine = { id?: string; lineNo: number; incurredDate: string | Date; amount: string; attachmentId?: string | null; attachmentSnapshot?: ReimbursementAttachmentSnapshot; linkedExpenseId?: string | null; sourceExpenseUpdatedAt?: string; sourceExpenseSnapshot?: ReimbursementSourceSnapshot };
export const sourceError = (code: string) => new UnprocessableEntityException({ code });
const moneyKeys = ['subtotalAmount', 'discountAmount', 'taxableAmount', 'vatAmount', 'whtAmount', 'grandTotalAmount', 'netPayableAmount'];
const money = (value: unknown) => new Decimal(String(value ?? 0)).toFixed(4);
const iso = (value: unknown) => value ? new Date(value as string).toISOString() : null;

/** Safe business facts only: never copy storage keys, signed URLs or arbitrary source metadata. */
export async function readReimbursementSource(tx: Prisma.TransactionClient, companyId: string, requesterUserId: string, branchId: string, currency: string, expenseId: string): Promise<ReimbursementSourceSnapshot> {
  const expense = await tx.expenseRecord.findFirst({ where: { id: expenseId, companyId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
  if (!expense) throw sourceError('reimbursement_source_unavailable');
  if (expense.branchId !== branchId) throw sourceError('REIMBURSEMENT_EVIDENCE_BRANCH_MISMATCH');
  if (expense.currency !== currency) throw sourceError('reimbursement_source_currency_mismatch');
  if (expense.sourceReimbursementRequestId || ['CONFIRMED', 'VOIDED', 'REJECTED'].includes(expense.status) || expense.postingStatus === 'posted' || new Decimal(String(expense.paidAmount ?? 0)).gt(0)) {
    throw sourceError('reimbursement_source_already_settled');
  }
  const certificate = await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { companyId, expenseId }, orderBy: { version: 'desc' } });
  if (certificate) {
    if (certificate.fundingSource !== 'PERSONAL_ADVANCE') throw sourceError('reimbursement_source_not_personal');
    if (certificate.status !== 'ISSUED') throw sourceError('reimbursement_source_not_issued');
    // Paper names/uploader accounts do not establish a repayment beneficiary.
    if (!certificate.payerUserId) throw sourceError('reimbursement_source_payer_unlinked');
    if (certificate.payerUserId !== requesterUserId) throw sourceError('reimbursement_source_wrong_payer');
  } else if ((expense.payerUserId ?? expense.createdByUserId) !== requesterUserId) {
    // Appendix §5 payer order: certificate (above) → `expense.payerUserId` → uploader. The middle
    // one is server-set from reviewed evidence, so a colleague who uploaded on the payer's behalf
    // no longer blocks the payer's own claim — and it still never lets a third party claim.
    throw sourceError('reimbursement_source_wrong_payer');
  }
  if (new Decimal(String(expense.whtAmount ?? 0)).gt(0) || expense.lines.some(line => line.whtAmount.gt(0)) || ['CLAIMABLE', 'NEEDS_REVIEW'].includes(expense.inputVatClaimStatus) || expense.vatMode === 'NEEDS_REVIEW' || expense.taxEvidenceStatus === 'NEEDS_REVIEW') {
    throw sourceError('reimbursement_source_tax_review_required');
  }
  const links = await tx.attachmentLink.findMany({ where: { companyId, targetType: 'expense.record', targetId: expenseId }, select: { attachmentId: true, purpose: true } });
  const attachments = await tx.attachmentObject.findMany({ where: { companyId, id: { in: [...links.filter(link => isAllowedAttachmentTarget('expense.record', link.purpose)).map(link => link.attachmentId), ...(certificate?.artifactAttachmentId ? [certificate.artifactAttachmentId] : [])] }, status: 'ACTIVE' }, orderBy: { id: 'asc' } });
  if (attachments.some(attachment => attachment.branchId !== branchId)) throw sourceError('REIMBURSEMENT_EVIDENCE_BRANCH_MISMATCH');
  if (certificate && !attachments.some(attachment => attachment.id === certificate.artifactAttachmentId && attachment.checksumSha256 === certificate.checksumSha256)) throw sourceError('reimbursement_source_not_issued');
  if (!attachments.length && !certificate?.artifactAttachmentId) throw sourceError('missing_receipt');
  if (!expense.expenseDate || !expense.lines.length || !new Decimal(expense.netPayableAmount.toString()).gt(0) || new Decimal(expense.netPayableAmount.toString()).decimalPlaces() > 2
    || !expense.lines.reduce((sum, line) => sum.add(line.lineTotalAmount.toString()), new Decimal(0)).eq(expense.netPayableAmount.toString())) throw sourceError('reimbursement_source_fields_mismatch');
  if (expenseTotalsIdentityError({ vatMode: expense.vatMode, totals: {
    subtotalAmount: money(expense.subtotalAmount), discountAmount: money(expense.discountAmount), taxableAmount: money(expense.taxableAmount), vatAmount: money(expense.vatAmount), grandTotalAmount: money(expense.grandTotalAmount),
  }, lines: expense.lines.map(line => ({ chargeKind: line.chargeKind, lineSubtotalAmount: money(line.lineSubtotalAmount), discountAmount: money(line.discountAmount), taxableAmount: money(line.taxableAmount), vatAmount: money(line.vatAmount), whtAmount: money(line.whtAmount), lineTotalAmount: money(line.lineTotalAmount) })) })) throw sourceError('reimbursement_source_fields_mismatch');
  return {
    schemaVersion: 1, expenseId, expenseUpdatedAt: expense.updatedAt.toISOString(), requesterUserId,
    // Additive on schemaVersion 1, and OMITTED when there is no payer: `assertReimbursementSources`
    // deep-compares a pinned snapshot against a freshly read one, so emitting `payerUserId: null`
    // would make every claim drafted before this deploy read as changed.
    ...(expense.payerUserId ? { payerUserId: expense.payerUserId } : {}),
    expenseDate: expense.expenseDate.toISOString(), paymentDate: iso(certificate?.paymentDate ?? expense.paidAt), paymentMethod: certificate?.paymentMethod ?? expense.paymentMethod ?? null,
    currency: expense.currency,
    seller: { name: expense.vendorNameSnapshot ?? '', taxId: expense.vendorTaxIdSnapshot ?? null, branchCode: expense.vendorBranchCodeSnapshot ?? null, documentNumber: expense.vendorDocumentNumber ?? null },
    sourceDocumentType: expense.sourceDocumentType, vatMode: expense.vatMode, inputVatClaimStatus: expense.inputVatClaimStatus, taxEvidenceStatus: expense.taxEvidenceStatus,
    classification: { expenseCategoryId: expense.expenseCategoryId, accountHintKey: expense.accountHintKey, taxCategory: expense.taxCategory },
    totals: Object.fromEntries(moneyKeys.map(key => [key, money(expense[key as keyof typeof expense])])),
    lines: expense.lines.map((line: any) => Object.fromEntries([
      'lineNumber', 'chargeKind', 'description', 'quantity', 'unitPrice', 'discountAmount', 'taxableAmount',
      'vatRate', 'vatTreatment', 'vatAmount', 'whtRate', 'whtAmount', 'lineSubtotalAmount', 'lineTotalAmount',
      'expenseCategoryId', 'accountHintKey', 'taxCategory', 'reviewStatus', 'taxCodeDefinitionId',
      'externalTaxCodeSnapshot', 'taxProfileKeySnapshot', 'taxProfileVersionSnapshot', 'roundingModeSnapshot',
      'roundingScaleSnapshot', 'taxAmountToleranceSnapshot', 'taxRegimeSnapshot', 'taxDirectionSnapshot',
      'taxTreatmentSnapshot', 'taxContextSnapshot', 'taxRateSnapshot', 'sourceCurrencySnapshot', 'taxCurrencySnapshot',
      'exchangeRateSnapshot', 'exchangeRateSourceSnapshot', 'exchangeRateDateSnapshot', 'taxBaseAmount',
      'transactionTaxAmount', 'claimabilitySnapshot', 'accountRuleVersionSnapshot', 'reportRuleVersionSnapshot',
      'taxEvidenceReviewStatus', 'taxComponentsJson', 'accountAssignmentsJson',
    ].map(key => [key, line[key] == null ? null : key.endsWith('Json') ? line[key] : line[key] instanceof Date ? line[key].toISOString() : String(line[key])]))),
    attachments: attachments.map((attachment: any) => ({ id: attachment.id, fileName: attachment.originalFileName, checksumSha256: attachment.checksumSha256 ?? null })),
    certificate: certificate ? { id: certificate.id, documentNumber: certificate.documentNumber, version: certificate.version, fundingSource: certificate.fundingSource!, payerUserId: certificate.payerUserId, payerName: certificate.payerName, businessPurpose: certificate.businessPurpose, missingReceiptReason: certificate.missingReceiptReason, artifactChecksumSha256: certificate.checksumSha256, wetSignedScanChecksumSha256: certificate.wetSignedScanChecksumSha256 } : null,
  };
}

/** A linked receipt stays on its original expense. Only the exact claim-born payable may
 * use that evidence, and it is rechecked in the payable's confirmation transaction. */
export async function assertProjectionSource(tx: any, companyId: string, projection: any): Promise<void> {
  if (!projection.sourceReimbursementRequestId || !projection.sourceReimbursementLineId) return;
  const request = await tx.reimbursementRequest.findFirst({ where: { companyId, id: projection.sourceReimbursementRequestId }, include: { lines: true } });
  const line = request?.lines.find((row: any) => row.id === projection.sourceReimbursementLineId);
  if (!line || ['DRAFT', 'REJECTED', 'CANCELLED', 'VOIDED'].includes(request.status)
    || request.branchId !== projection.branchId || request.currency !== projection.currency
    || !new Decimal(line.amount).eq(projection.netPayableAmount)) throw sourceError('reimbursement_projection_source_mismatch');
  if (!line.sourceExpenseSnapshotJson) return; // Legacy/manual evidence keeps its original contract.
  if (!isDeepStrictEqual(projection.sourceChannelMetadataJson?.reimbursementSource, line.sourceExpenseSnapshotJson)) throw sourceError('reimbursement_source_changed');
  await assertReimbursementSources(tx, { ...request, lines: request.lines.map((row: any) => ({ ...row, sourceExpenseSnapshot: row.sourceExpenseSnapshotJson, attachmentSnapshot: row.attachmentSnapshotJson })) });
}

export async function resolveReimbursementSourceLines<T extends SourceLine>(tx: any, companyId: string, requesterUserId: string, branchId: string, currency: string, lines: readonly T[]): Promise<Array<T & { sourceExpenseSnapshot?: ReimbursementSourceSnapshot; attachmentSnapshot?: ReimbursementAttachmentSnapshot }>> {
  const used = new Set<string>();
  const result: Array<T & { sourceExpenseSnapshot?: ReimbursementSourceSnapshot; attachmentSnapshot?: ReimbursementAttachmentSnapshot }> = [];
  for (const input of lines) {
    const file = input.attachmentId ? await tx.attachmentObject.findFirst({ where: { companyId, id: input.attachmentId, status: 'ACTIVE' } }) : null;
    if (input.attachmentId && (!file || file.branchId !== branchId)) throw sourceError('invalid_primary_attachment');
    const line = { ...input, attachmentSnapshot: file ? { id: file.id, uploadedByUserId: file.uploadedByUserId, checksumSha256: file.checksumSha256, fileName: file.originalFileName } : undefined };
    let expenseId = line.linkedExpenseId ?? undefined;
    if (line.attachmentId) {
      const links = await tx.attachmentLink.findMany({ where: { companyId, attachmentId: line.attachmentId, targetType: 'expense.record' }, select: { targetId: true } });
      const sources = await tx.expenseRecord.findMany({ where: { companyId, id: { in: links.map((link: any) => link.targetId) }, sourceReimbursementRequestId: null }, select: { id: true, captureGroupId: true } });
      /**
       * A capture group's derived sources cite ONE file on purpose — one receipt, several issuers
       * (appendix §5) — so once the claim names which of them it is claiming, its own siblings are
       * not rival interpretations of that file. Everything else still is: with no
       * `linkedExpenseId` two sources are ambiguous as before, and an expense outside the group
       * that shares the file keeps the claim ambiguous even when one is named (A09/A16).
       */
      const linkedGroupId = expenseId ? sources.find((source: any) => source.id === expenseId)?.captureGroupId ?? null : null;
      const rivals = linkedGroupId
        ? sources.filter((source: any) => source.id === expenseId || source.captureGroupId !== linkedGroupId)
        : sources;
      if (rivals.length > 1 || (expenseId && rivals.some((source: any) => source.id !== expenseId))) throw sourceError('reimbursement_source_ambiguous');
      expenseId ??= rivals[0]?.id;
    }
    if (!expenseId) { result.push({ ...line, sourceExpenseSnapshot: undefined }); continue; }
    if (used.has(expenseId)) throw sourceError('expense_already_claimed');
    used.add(expenseId);
    const snapshot = await readReimbursementSource(tx, companyId, requesterUserId, branchId, currency, expenseId);
    if (line.sourceExpenseUpdatedAt && line.sourceExpenseUpdatedAt !== snapshot.expenseUpdatedAt) throw new ConflictException({ code: 'reimbursement_source_changed' });
    if (!new Decimal(line.amount).eq(snapshot.totals.netPayableAmount) || coerceCivilDate(line.incurredDate) !== coerceCivilDate(snapshot.expenseDate)) throw sourceError('reimbursement_source_fields_mismatch');
    if (line.attachmentId && !snapshot.attachments.some(attachment => attachment.id === line.attachmentId)) throw sourceError('reimbursement_source_attachment_mismatch');
    result.push({ ...line, linkedExpenseId: expenseId, sourceExpenseSnapshot: snapshot });
  }
  return result;
}

/** Final source checks share the exclusion locks used by source edits and payments. */
export async function assertReimbursementSources(tx: any, request: { companyId: string; requesterUserId: string; branchId?: string | null; currency: string; lines?: readonly SourceLine[] }) {
  const lines = request.lines ?? [];
  await lockFundingEvidence(tx, request.companyId, { attachmentIds: lines.flatMap(line => line.attachmentId ? [line.attachmentId] : []), expenseIds: lines.flatMap(line => line.linkedExpenseId ? [line.linkedExpenseId] : []) });
  for (const line of lines) {
    if (line.attachmentSnapshot) {
      const file = await tx.attachmentObject.findFirst({ where: { companyId: request.companyId, id: line.attachmentId, status: 'ACTIVE', branchId: request.branchId } });
      if (!file || !isDeepStrictEqual(line.attachmentSnapshot, { id: file.id, uploadedByUserId: file.uploadedByUserId, checksumSha256: file.checksumSha256, fileName: file.originalFileName })) throw sourceError('reimbursement_source_changed');
    }
    const pinned = line.sourceExpenseSnapshot;
    if (!pinned) {
      // A receipt attached to an expense after the draft was saved must not bypass
      // source eligibility. Existing claim-born projection links are not new evidence.
      if (!line.linkedExpenseId && line.attachmentId) {
        const linked = await tx.attachmentLink.findMany({ where: { companyId: request.companyId, attachmentId: line.attachmentId, targetType: 'expense.record' }, select: { targetId: true } });
        if (linked.length && await tx.expenseRecord.findFirst({ where: { companyId: request.companyId, id: { in: linked.map((row: any) => row.targetId) }, sourceReimbursementRequestId: null }, select: { id: true } })) throw sourceError('reimbursement_source_review_required');
      }
      continue;
    }
    const current = await readReimbursementSource(tx, request.companyId, request.requesterUserId, request.branchId!, request.currency, pinned.expenseId);
    // Background review stamps may advance updatedAt without changing any approved fact.
    // The revision remains the draft picker's CAS token; approval is bound to actual facts.
    const { expenseUpdatedAt: _currentRevision, ...currentFacts } = current;
    const { expenseUpdatedAt: _pinnedRevision, ...pinnedFacts } = pinned;
    if (!isDeepStrictEqual(currentFacts, pinnedFacts)) throw new ConflictException({ code: 'reimbursement_source_changed' });
    if (line.linkedExpenseId !== pinned.expenseId || !new Decimal(line.amount).eq(pinned.totals.netPayableAmount) || coerceCivilDate(line.incurredDate) !== coerceCivilDate(pinned.expenseDate)) throw sourceError('reimbursement_source_fields_mismatch');
  }
}
