import { createHash } from 'node:crypto';
import { vendorMatchKey } from '../../../accounting-documents/domain/logic/vendor-counterparty-match.logic';
import { coerceCivilDate, type DisbursementVoucherStatus, type DisbursementVoucherOrigin, type DisbursementVoucherPayeeBasis, type ExpensePaymentMethod, type DisbursementVoucherActions, type DisbursementVoucherPrimaryAction, type DisbursementVoucherHeader } from '@watchdog-bms/contracts';
import type { DisbursementVoucher, Prisma } from '../../../../generated/prisma/client';
import Decimal from 'decimal.js';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DISBURSEMENT_VOUCHER_CANCELLATION_WORDS, DISBURSEMENT_VOUCHER_WORDS, disbursementVoucherError, type DisbursementVoucherLifecycleAction } from '@watchdog-bms/contracts';
import { canonicalFingerprint } from '../../../../common/security/canonical-fingerprint';

/** Command rounds must use this same capability function after their tenant/visibility check. */
export function disbursementVoucherActions(voucher: { status: string; documentNumber: string | null; revision?: number; preparedByUserId?: string; submittedByUserId?: string | null }, permissions: string[], actorUserId?: string, canOwnerRecover = false, preparersInactive = false): DisbursementVoucherActions {
  const prepare = permissions.includes('expense.disbursement.prepare'), approve = permissions.includes('expense.disbursement.approve');
  const draft = voucher.status === 'DRAFT', pending = voucher.status === 'PENDING_APPROVAL', approved = voucher.status === 'APPROVED';
  const own = Boolean(actorUserId && (voucher.preparedByUserId === actorUserId || voucher.submittedByUserId === actorUserId));
  // Expense reservation summaries omit the actor; document reads and commands always supply it.
  const mayTakeBack = (actorUserId === undefined || own || canOwnerRecover) && (prepare || approve);
  return { edit: draft && prepare, delete: draft && prepare && voucher.documentNumber === null && (voucher.revision ?? 0) === 0, submit: draft && prepare,
    submitAndApprove: draft && prepare && approve, approve: pending && approve, return: pending && approve && !own && !preparersInactive,
    withdraw: (pending || approved) && mayTakeBack, cancel: (pending || approved || draft && voucher.documentNumber !== null) && mayTakeBack,
    pay: approved && permissions.includes('expense.disbursement.pay'), remind: pending && prepare };
}

export function assertDisbursementVoucherAction(voucher: Parameters<typeof disbursementVoucherActions>[0], action: DisbursementVoucherLifecycleAction | 'edit' | 'delete' | 'submitAndApprove', permissions: string[], actorUserId?: string, canOwnerRecover = false, preparersInactive = false) {
  if (disbursementVoucherActions(voucher, permissions, actorUserId, canOwnerRecover, preparersInactive)[action]) return;
  if (action === 'return' && preparersInactive) throw new ForbiddenException({ ...disbursementVoucherError('disbursement_permission_denied'), message: 'ให้เจ้าของกิจการกลับไปแก้หรือยกเลิกใบนี้' });
  if (actorUserId && !canOwnerRecover && ['return', 'withdraw', 'cancel'].includes(action)) {
    const own = voucher.preparedByUserId === actorUserId || voucher.submittedByUserId === actorUserId;
    const message = preparersInactive && !own && (action === 'withdraw' || action === 'cancel') ? DISBURSEMENT_VOUCHER_WORDS.recoveryOwnerRequired
      : action === 'return' && own ? DISBURSEMENT_VOUCHER_WORDS.returnOwnDenied
      : !own && action === 'withdraw' ? DISBURSEMENT_VOUCHER_WORDS.withdrawOthersDenied
      : !own && action === 'cancel' ? DISBURSEMENT_VOUCHER_WORDS.cancelOthersDenied : null;
    if (message) throw new ForbiddenException({ ...disbursementVoucherError('disbursement_permission_denied'), message });
  }
  const prepare = permissions.includes('expense.disbursement.prepare'), approve = permissions.includes('expense.disbursement.approve');
  const permitted = action === 'pay' ? permissions.includes('expense.disbursement.pay') : action === 'approve' || action === 'return' ? approve : action === 'withdraw' || action === 'cancel' ? prepare || approve : action === 'submitAndApprove' ? prepare && approve : prepare;
  if (!permitted) throw new ForbiddenException(disbursementVoucherError('disbursement_permission_denied'));
  throw new ConflictException(disbursementVoucherError('disbursement_status_changed'));
}

export function disbursementVoucherSourceHash(source: { status: string; branchId: string | null; currency: string; netPayableAmount: unknown; outstandingAmount: unknown; vendorNameSnapshot: string | null; vendorTaxIdSnapshot: string | null }): string {
  return canonicalFingerprint({ status: source.status, branchId: source.branchId, currency: source.currency,
    netPayableAmount: new Decimal(String(source.netPayableAmount)).toFixed(4), outstandingAmount: new Decimal(String(source.outstandingAmount)).toFixed(4),
    vendorName: source.vendorNameSnapshot, vendorTaxId: source.vendorTaxIdSnapshot });
}

export function disbursementVoucherPrimaryAction(status: DisbursementVoucherStatus, permissions: string[]): DisbursementVoucherPrimaryAction {
  return status === 'DRAFT' && permissions.includes('expense.disbursement.prepare') ? 'submit'
    : status === 'PENDING_APPROVAL' && permissions.includes('expense.disbursement.approve') ? 'approve'
    : status === 'APPROVED' && permissions.includes('expense.disbursement.pay') ? 'pay' : 'view';
}

/** Explicit public header: account secrets and internal payment snapshots stay out of this API. */
export function disbursementVoucherHeader(v: DisbursementVoucher): DisbursementVoucherHeader {
  return { id: v.id, companyId: v.companyId, branchId: v.branchId, documentNumber: v.documentNumber, revision: v.revision, status: v.status as DisbursementVoucherStatus,
    origin: v.origin as DisbursementVoucherOrigin, replacesVoucherId: v.replacesVoucherId ?? null, payeeName: v.payeeName, payeeTaxId: v.payeeTaxId, payeeBranchCode: v.payeeBranchCode,
    payeeBankName: v.payeeBankName ?? null, payeeAccountName: v.payeeAccountName ?? null, payeeAccountLast4: v.payeeAccountLast4 ?? null, documentFileReady: Boolean(v.pdfAttachmentId),
    payeeBasis: v.payeeBasis as DisbursementVoucherPayeeBasis, payeeConfirmedByUserId: v.payeeConfirmedByUserId, preparedByUserId: v.preparedByUserId,
    plannedPayDate: v.plannedPayDate ? coerceCivilDate(v.plannedPayDate) : null, plannedMethod: v.plannedMethod as ExpensePaymentMethod | null,
    paidDate: v.paidDate ? coerceCivilDate(v.paidDate) : null, note: v.note, totalAmount: new Decimal(String(v.totalAmount)).toFixed(4), currency: v.currency,
    version: v.version, createdAt: v.createdAt.toISOString(), updatedAt: v.updatedAt.toISOString(),
    lastReminderToUserId: v.lastReminderToUserId ?? null, lastReminderAt: v.lastReminderAt?.toISOString() ?? null, reminderCount: v.reminderCount ?? 0,
    submittedByUserId: v.submittedByUserId ?? null, submittedAt: v.submittedAt?.toISOString() ?? null, requestedApproverUserId: v.requestedApproverUserId ?? null,
    approvedByUserId: v.approvedByUserId ?? null, approvedAt: v.approvedAt?.toISOString() ?? null, selfApproved: v.selfApproved ?? false,
    returnedByUserId: v.returnedByUserId ?? null, returnedAt: v.returnedAt?.toISOString() ?? null, returnReason: v.returnReason ?? null,
    cancelledAfterPaid: v.cancelledAfterPaid ?? false, cancelledByUserId: v.cancelledByUserId ?? null, cancelledAt: v.cancelledAt?.toISOString() ?? null, cancelReason: v.cancelReason ?? null, cancelSourceReason: v.cancelSourceReason ?? null,
    paidRecordedAt: v.paidRecordedAt?.toISOString() ?? null, paidByUserId: v.paidByUserId ?? null, paidMethod: v.paidMethod as ExpensePaymentMethod | null ?? null, paidFromRef: v.paidFromRef ?? null };
}

/** Expense locks already fence payment cancellation against pay/issue/reissue. Never take the
 * document lifecycle lock here: pay takes that lock before expense locks, so reversing it deadlocks.
 * A conditional row update lets only the first cancellation change the paid header. */
export async function cancelDisbursementVouchersForPayments(tx: Prisma.TransactionClient, companyId: string, paymentIds: string[], actorUserId: string, at: Date, expenseNumber: string | null, expenseVoided = false, sourceReason?: string | null) {
  if (!paymentIds.length) return [];
  const cancelledIds: string[] = [];
  const lines = await tx.disbursementVoucherLine.findMany({ where: { companyId, coversPaymentId: { in: paymentIds } }, select: { voucherId: true } });
  for (const id of [...new Set(lines.map(l => l.voucherId))].sort()) {
    const changed = await tx.disbursementVoucher.updateMany({ where: { companyId, id, status: 'PAID' }, data: {
      status: 'CANCELLED', cancelSourceReason: sourceReason?.trim() || null, cancelledAfterPaid: true, cancelledByUserId: actorUserId, cancelledAt: at,
      cancelReason: (expenseVoided ? DISBURSEMENT_VOUCHER_CANCELLATION_WORDS.expense : DISBURSEMENT_VOUCHER_CANCELLATION_WORDS.payment).replace('{number}', expenseNumber || 'ที่เลือก'), version: { increment: 1 },
    } });
    if (changed.count) {
      await tx.disbursementVoucherLine.updateMany({ where: { companyId, voucherId: id }, data: { coversPaymentId: null } });
      cancelledIds.push(id);
    }
  }
  return cancelledIds;
}

export function disbursementPayeeIdentity(expense: { id: string; vendorNameSnapshot: string | null; vendorTaxIdSnapshot: string | null }) {
  const key = vendorMatchKey({ name: expense.vendorNameSnapshot, taxId: expense.vendorTaxIdSnapshot });
  const identity = key?.kind === 'TAX_ID' ? `tax:${key.taxId}` : key?.kind === 'NAME' ? `name:${key.name}` : `expense:${expense.id}`;
  return { payeeKey: createHash('sha256').update(identity).digest('base64url'), payeeKeyKind: key?.kind ?? null, taxId: key?.kind === 'TAX_ID' ? key.taxId : null };
}
