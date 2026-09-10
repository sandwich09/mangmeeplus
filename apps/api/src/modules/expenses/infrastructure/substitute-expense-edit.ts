import { ConflictException } from '@nestjs/common';
import { assertFundingMutation } from './substitute-funding.guard';
import { Prisma } from '../../../generated/prisma/client';

export const EXPENSE_EDIT_RESIGN_REASON = 'แก้ไขข้อมูลค่าใช้จ่าย กรุณาตรวจและลงนามใหม่';

const amounts = ['subtotalAmount', 'discountAmount', 'taxableAmount', 'vatAmount', 'whtAmount', 'grandTotalAmount', 'netPayableAmount', 'currency'];
const printedFields = [...amounts, 'branchId', 'vendorNameSnapshot', 'vendorTaxIdSnapshot', 'expenseDate', 'paidAt', 'paymentMethod', 'bankAccountRef', 'note', 'missingReceiptReason'];
const comparable = (value: unknown) => value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
const changed = (before: any, after: any, field: string) => comparable(before[field]) !== comparable(after[field]);
const printedLines = (row: any) => JSON.stringify((row.lines ?? []).map((line: any) => [line.description, comparable(line.quantity), comparable(line.lineTotalAmount)]));

/** Runs inside the review-save transaction under its existing funding/substitute locks. */
export async function syncSubstituteAfterExpenseEdit(tx: any, before: any, after: any, actorUserId: string) {
  const current = await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { companyId: after.companyId, expenseId: after.id, status: { not: 'SUPERSEDED' } }, orderBy: { version: 'desc' } });
  if (!current) return null;
  if (Number(before.paidAmount) > 0 && amounts.some((field) => changed(before, after, field))) {
    throw new ConflictException({ code: 'substitute_paid_expense_amount_locked', message: 'Paid expense amounts require the payment correction flow.' });
  }
  const materialChange = printedFields.some((field) => changed(before, after, field)) || printedLines(before) !== printedLines(after);
  if (materialChange) await assertFundingMutation(tx, after.companyId, after.id, 'supersede');
  const signed = current.status !== 'PREPARED' || Boolean(current.wetSignedScanAttachmentId || current.paperSubmissionJson);
  const data: any = { expenseUpdatedAtAtPreparation: after.updatedAt };
  if (!materialChange && signed) {
    // Review-only metadata does not change the document the signers saw.
    await tx.expenseSubstituteReceiptEvidence.update({ where: { id: current.id }, data });
    return null;
  }
  if (changed(before, after, 'branchId')) data.branchId = after.branchId;
  if (changed(before, after, 'vendorNameSnapshot')) data.payeeName = after.vendorNameSnapshot;
  if (changed(before, after, 'vendorTaxIdSnapshot')) data.payeeTaxId = after.vendorTaxIdSnapshot;
  if (changed(before, after, 'paidAt') && after.paidAt) data.paymentDate = after.paidAt;
  if (changed(before, after, 'paymentMethod') && after.paymentMethod) data.paymentMethod = after.paymentMethod;
  if (changed(before, after, 'missingReceiptReason') && after.missingReceiptReason) data.missingReceiptReason = after.missingReceiptReason;
  if (changed(before, after, 'note')) {
    data.note = after.note;
    const purpose = after.note?.split(' · ').find((part: string) => part.startsWith('วัตถุประสงค์: '))?.slice('วัตถุประสงค์: '.length).trim();
    if (purpose) data.businessPurpose = purpose;
  }
  if (!signed) {
    await tx.expenseSubstituteReceiptEvidence.update({ where: { id: current.id }, data: { ...data, paperFormSnapshotJson: Prisma.DbNull } });
    return { evidenceId: current.id, documentNumber: current.documentNumber, signaturesReset: false };
  }
  await tx.expenseSubstituteReceiptEvidence.update({ where: { id: current.id }, data: { status: 'SUPERSEDED', supersededAt: new Date(), supersedeReason: EXPENSE_EDIT_RESIGN_REASON } });
  const last = await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { companyId: after.companyId, expenseId: after.id }, orderBy: { version: 'desc' }, select: { version: true } });
  const preserved = Object.fromEntries([
    'companyId', 'expenseId', 'branchId', 'fundingSource', 'documentNumber', 'originalSourceDocumentType',
    'reasonCode', 'missingReceiptReason', 'businessPurpose', 'paymentEvidenceAttachmentIds', 'supportingAttachmentIds',
    'paymentDate', 'paymentMethod', 'note', 'payerUserId', 'payerName', 'payeeName', 'payeeAddress', 'payeeTaxId', 'signatureMode',
  ].map((key) => [key, current[key]]));
  const next = await tx.expenseSubstituteReceiptEvidence.create({ data: {
    ...preserved, ...data, status: 'PREPARED', version: last.version + 1,
    idempotencyKey: `expense-edit:${current.id}:${after.updatedAt.toISOString()}`,
    preparedByUserId: actorUserId, preparedAt: new Date(), preparedFromChannel: 'WEB',
    correctionOfEvidenceId: current.status === 'ISSUED' ? current.id : current.correctionOfEvidenceId,
    correctionReason: EXPENSE_EDIT_RESIGN_REASON,
  } });
  if (after.substituteReceiptGeneratedAt) {
    // Keep the source timestamp used by the new prepared revision; these are derived flags only.
    await tx.expenseRecord.update({ where: { id: after.id }, data: { substituteReceiptGeneratedAt: null, substituteReceiptGeneratedByUserId: null, updatedAt: after.updatedAt } });
  }
  return { evidenceId: next.id, previousEvidenceId: current.id, documentNumber: current.documentNumber, signaturesReset: true };
}
