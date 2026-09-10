import { ConflictException } from '@nestjs/common';
import { assertFundingMutation } from './substitute-funding.guard';
import { withPurposeNote } from '../domain/logic/line-correction.logic';
import { Prisma } from '../../../generated/prisma/client';

export const EXPENSE_EDIT_RESIGN_REASON = 'แก้ไขข้อมูลค่าใช้จ่าย กรุณาตรวจและลงนามใหม่';

const amounts = ['subtotalAmount', 'discountAmount', 'taxableAmount', 'vatAmount', 'whtAmount', 'grandTotalAmount', 'netPayableAmount', 'currency'];
const printedFields = [...amounts, 'branchId', 'vendorNameSnapshot', 'vendorTaxIdSnapshot', 'expenseDate', 'paidAt', 'paymentMethod', 'bankAccountRef', 'note', 'missingReceiptReason', 'expenseCategoryId', 'accountHintKey'];
const comparable = (value: unknown) => value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
const changed = (before: any, after: any, field: string) => comparable(before[field]) !== comparable(after[field]);
const printedLines = (row: any) => JSON.stringify((row.lines ?? []).map((line: any) => [line.description, comparable(line.quantity), comparable(line.lineTotalAmount)]));

/** Runs inside the review-save transaction under its existing funding/substitute locks. */
export async function syncSubstituteAfterExpenseEdit(tx: any, before: any, after: any, actorUserId: string) {
  const current = await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { companyId: after.companyId, expenseId: after.id, status: { not: 'SUPERSEDED' } }, orderBy: { version: 'desc' } });
  if (!current) return null;
  const materialChange = printedFields.some((field) => changed(before, after, field)) || printedLines(before) !== printedLines(after);
  if (materialChange) {
    assertSubstituteEditAllowed(current, before);
    await assertFundingMutation(tx, after.companyId, after.id, 'supersede');
  }
  const signed = current.status !== 'PREPARED' || Boolean(current.wetSignedScanAttachmentId || current.paperSubmissionJson);
  const data: any = { expenseUpdatedAtAtPreparation: after.updatedAt };
  if (!materialChange && signed) {
    // Review-only metadata does not change the document the signers saw.
    await tx.expenseSubstituteReceiptEvidence.update({ where: { id: current.id }, data });
    return null;
  }
  if (changed(before, after, 'branchId')) data.branchId = after.branchId;
  // A separately entered recipient is not the source vendor. Preserve that identity as a group.
  const samePayee = comparable(current.payeeName).trim() === comparable(before.vendorNameSnapshot).trim()
    && (!current.payeeTaxId || comparable(current.payeeTaxId).replace(/\D/g, '') === comparable(before.vendorTaxIdSnapshot).replace(/\D/g, ''));
  if (samePayee) {
    if (changed(before, after, 'vendorNameSnapshot')) data.payeeName = after.vendorNameSnapshot || null;
    if (changed(before, after, 'vendorTaxIdSnapshot')) data.payeeTaxId = after.vendorTaxIdSnapshot || null;
    if (!after.vendorNameSnapshot) { data.payeeTaxId = null; data.payeeAddress = null; }
  }
  if (current.fundingSource === 'COMPANY') {
    if (changed(before, after, 'paidAt')) data.paymentDate = after.paidAt;
    if (changed(before, after, 'paymentMethod')) data.paymentMethod = after.paymentMethod;
  }
  if (changed(before, after, 'missingReceiptReason')) data.missingReceiptReason = after.missingReceiptReason ?? '';
  if (changed(before, after, 'note')) {
    const purpose = after.note?.split(' · ').find((part: string) => part.trim().startsWith('วัตถุประสงค์:'));
    const hadStructuredPurpose = before.note?.split(' · ').some((part: string) => part.trim().startsWith('วัตถุประสงค์:'));
    data.businessPurpose = purpose !== undefined ? purpose.trim().slice('วัตถุประสงค์:'.length).trim()
      : hadStructuredPurpose ? '' : after.note?.trim() ?? '';
    // Source notes also store purpose; the certificate prints that in its own full-width field.
    data.note = after.note?.trim() === data.businessPurpose ? null : after.note?.split(' · ')
      .filter((part: string) => !part.trim().startsWith('วัตถุประสงค์:')).join(' · ').trim() || null;
  }
  const result = await reviseSubstituteEvidence(tx, current, data, actorUserId,
    `expense-edit:${current.id}:${after.updatedAt.toISOString()}`, EXPENSE_EDIT_RESIGN_REASON);
  if (result.signaturesReset && after.substituteReceiptGeneratedAt) {
    // Keep the source timestamp used by the new prepared revision; these are derived flags only.
    await tx.expenseRecord.update({ where: { id: after.id }, data: { substituteReceiptGeneratedAt: null, substituteReceiptGeneratedByUserId: null, updatedAt: after.updatedAt } });
  }
  return result;
}

/** Both source-review and certificate edits use this boundary under the funding lock. */
export function assertSubstituteEditAllowed(current: any, expense: any) {
  if (current.status === 'ISSUED' || Number(expense.paidAmount) > 0 || expense.journalEntryId || expense.postingStatus === 'posted') {
    throw new ConflictException({ code: 'substitute_edit_requires_cancellation',
      message: 'เอกสารออกสมบูรณ์หรือบันทึกการจ่าย/บัญชีแล้ว กรุณายกเลิกใบแทนและจัดการรายการจ่าย บัญชี หรือคำขอเบิกที่เกี่ยวข้องก่อนแก้ไข' });
  }
}

/** Call only inside the locked, permission-checked edit transaction. */
export async function reviseSubstituteEvidence(tx: any, current: any, data: any, actorUserId: string, idempotencyKey: string, reason: string) {
  const signed = current.status !== 'PREPARED' || Boolean(current.wetSignedScanAttachmentId || current.paperSubmissionJson);
  const documentNumber = current.documentNumber;
  if (!signed && documentNumber === current.documentNumber) {
    await tx.expenseSubstituteReceiptEvidence.update({ where: { id: current.id }, data: { ...data, updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)), paperFormSnapshotJson: Prisma.DbNull } });
    return { evidenceId: current.id, documentNumber: current.documentNumber, signaturesReset: false };
  }
  await tx.expenseSubstituteReceiptEvidence.update({ where: { id: current.id }, data: { status: 'SUPERSEDED', supersededAt: new Date(), supersedeReason: reason } });
  const last = await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { companyId: current.companyId, expenseId: current.expenseId }, orderBy: { version: 'desc' }, select: { version: true } });
  const preserved = Object.fromEntries([
    'companyId', 'expenseId', 'branchId', 'fundingSource', 'documentNumber', 'originalSourceDocumentType',
    'reasonCode', 'missingReceiptReason', 'businessPurpose', 'paymentEvidenceAttachmentIds', 'supportingAttachmentIds',
    'expenseUpdatedAtAtPreparation', 'paymentDate', 'paymentMethod', 'note', 'payerUserId', 'payerName', 'payeeName', 'payeeAddress', 'payeeTaxId', 'signatureMode',
  ].map((key) => [key, current[key]]));
  const next = await tx.expenseSubstituteReceiptEvidence.create({ data: {
    ...preserved, ...data, documentNumber, revisionOfEvidenceId: current.id, status: 'PREPARED', version: last.version + 1,
    idempotencyKey,
    preparedByUserId: actorUserId, preparedAt: new Date(), preparedFromChannel: 'WEB',
    correctionOfEvidenceId: current.status === 'ISSUED' ? current.id : current.correctionOfEvidenceId,
    correctionReason: reason,
  } });
  return { evidenceId: next.id, previousEvidenceId: current.id, previousDocumentNumber: current.documentNumber, documentNumber, signaturesReset: signed };
}

/** Keep ordinary notes/provenance; never truncate reviewed certificate facts to the LINE note limit. */
export function substitutePurposeSourceNote(note: string | null, purpose: string, priorPurpose?: string): string {
  const structured = note?.split(' · ').find(part => part.trim().startsWith('วัตถุประสงค์:'));
  if (structured?.trim().slice('วัตถุประสงค์:'.length).trim() === purpose.trim()) return note!;
  // Legacy wizard stored just the purpose. Replace it rather than duplicating the old purpose.
  return withPurposeNote(note?.trim() === (priorPurpose ?? purpose).trim() ? null : note, purpose, Number.POSITIVE_INFINITY);
}
