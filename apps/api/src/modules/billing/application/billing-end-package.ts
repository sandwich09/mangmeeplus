import type { BillingAccount, BillingInvoice, CompanyPlanTerm, Prisma } from '../../../generated/prisma/client';
import type { PartnerLifecycleTransitionUseCase } from '../../system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';
import { billingError } from '../domain/billing-policy';
import { termProjectionHash } from '../domain/paid-invoice';

const TEXT = {
  BILLING_END_PACKAGE_NOT_CURRENT: 'รายการนี้ไม่ใช่การชำระของแพ็กเกจที่ร้านใช้งานอยู่ตอนนี้ จึงยุติแพ็กเกจจากรายการนี้ไม่ได้',
  BILLING_END_PACKAGE_AUTO_RENEW: 'ร้านนี้ยังเปิดต่ออายุอัตโนมัติอยู่ กรุณายกเลิกการต่ออายุก่อน แล้วจึงยุติแพ็กเกจ',
  BILLING_END_PACKAGE_PENDING: 'ร้านนี้มีรายการชำระเงินหรือแพ็กเกจล่วงหน้าที่ยังดำเนินการอยู่ ตรวจรายการนั้นให้เสร็จก่อน',
  BILLING_END_PACKAGE_NOT_REFUNDED: 'รายการนี้ยังคืนเงินไม่ครบเต็มจำนวน ยุติแพ็กเกจได้หลังคืนเงินครบแล้ว',
} as const;
export type EndPackageBlock = keyof typeof TEXT;
export const endPackageError = (code: EndPackageBlock) => billingError(code, TEXT[code]);

type Term = Pick<CompanyPlanTerm, 'billingReceiptAccountId' | 'termEndsAt' | 'termDisabledAt' | 'tierKey' | 'branchLimit' | 'employeeLimit' | 'monthlySlipLimit'>;
type Account = Pick<BillingAccount, 'id' | 'renewalMode' | 'baseSubscriptionId' | 'cancelAtPeriodEnd' | 'subscriptionState' | 'activeAttemptId' |
  'activeCollectionOperationId' | 'pendingPlanChangeId' | 'paidThrough' | 'termProjectionHash'>;
type Invoice = Pick<BillingInvoice, 'billingAccountId' | 'providerStatus' | 'applyStatus' | 'appliedAt' | 'periodStart' | 'periodEnd' | 'paidSatang' | 'refundedSatang'>;

/**
 * Why this paid invoice cannot end the shop's running package, or null. "Current" means the invoice
 * is applied, already serving, and its period is the one the account and the plan term run on now.
 */
export function endPackageBlock(company: { status: string; planTerm: Term | null }, account: Account, invoice: Invoice,
  requireFullRefund: boolean, now = new Date()): EndPackageBlock | null {
  const term = company.planTerm;
  if (!term || term.billingReceiptAccountId !== account.id || company.status !== 'ACTIVE' || term.termDisabledAt || term.termEndsAt <= now ||
    !account.paidThrough || account.paidThrough <= now || invoice.billingAccountId !== account.id || invoice.providerStatus !== 'paid' ||
    invoice.applyStatus !== 'APPLIED' || !invoice.appliedAt || invoice.periodStart > now || invoice.periodEnd.getTime() !== account.paidThrough.getTime() ||
    termProjectionHash(term) !== account.termProjectionHash) return 'BILLING_END_PACKAGE_NOT_CURRENT';
  // ponytail: never touches Stripe; staff cancel the renewal first (CARD_AUTO or PROMPTPAY_RENEW).
  if ((account.baseSubscriptionId || account.renewalMode === 'CARD_AUTO' || account.renewalMode === 'PROMPTPAY_RENEW') && !account.cancelAtPeriodEnd &&
    !['canceled', 'incomplete_expired'].includes(account.subscriptionState)) return 'BILLING_END_PACKAGE_AUTO_RENEW';
  if (account.activeAttemptId || account.activeCollectionOperationId || account.pendingPlanChangeId) return 'BILLING_END_PACKAGE_PENDING';
  if (requireFullRefund && invoice.refundedSatang < invoice.paidSatang) return 'BILLING_END_PACKAGE_NOT_REFUNDED';
  return null;
}

/** Only a refund that asked for it and reached SUCCEEDED ends the package; FAILED, pending or unknown never do. */
export const refundEndsPackage = (proposed: { endPackage?: boolean }, terminal: string) => proposed.endPackage === true && terminal === 'SUCCEEDED';

/**
 * Ends the running paid term now into the same state the P29 expiry sweep leaves: DISABLED with
 * `termDisabledAt` (locked shell, LINE package-required, data kept, a new purchase restarts it).
 * `paidThrough` moves to now so a new purchase is a restart, never a stack on the refunded term;
 * unexpired paid receipt grants are revoked so they cannot carry into it. The applied invoice keeps
 * APPLIED, so no reconciler pass re-applies it. Caller holds partner-ocr-config, then the Company lock.
 * Returns the block (nothing written) or null once ended.
 */
export async function endPaidPackage(tx: Prisma.TransactionClient, lifecycle: Pick<PartnerLifecycleTransitionUseCase, 'execute'>, input: {
  companyId: string; accountId: string; invoiceId: string; requireFullRefund: boolean; actorUserId: string | null; requestId: string;
  reason: string; refundOperationId?: string;
}, now = new Date()): Promise<EndPackageBlock | null> {
  const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId }, include: { planTerm: true } });
  const account = await tx.billingAccount.findFirstOrThrow({ where: { id: input.accountId, companyId: input.companyId } });
  const invoice = await tx.billingInvoice.findFirstOrThrow({ where: { id: input.invoiceId, billingAccountId: account.id } });
  const block = endPackageBlock(company, account, invoice, input.requireFullRefund, now);
  if (block) return block;
  // Machine actor, like the sweep: a human requester would clear termDisabledAt and turn this into a manual hold.
  await lifecycle.execute({ companyId: company.id, targetStatus: 'DISABLED', reason: 'refund_package_ended', requestingAdminUserId: null, requestId: input.requestId }, tx);
  const term = await tx.companyPlanTerm.update({ where: { companyId: company.id }, data: { termEndsAt: now, termDisabledAt: now,
    ...(input.actorUserId ? { updatedByUserId: input.actorUserId } : {}) } });
  await tx.billingReceiptGrant.updateMany({ where: { billingAccountId: account.id, companyId: company.id,
    kind: { in: ['INITIAL', 'RENEWAL', 'REPEAT', 'UPGRADE'] }, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } });
  await tx.billingAccount.update({ where: { id: account.id }, data: { paidThrough: now, nextChargeAt: null,
    termProjectionHash: termProjectionHash(term), observedAt: now, version: { increment: 1 } } });
  await tx.auditLog.create({ data: { companyId: company.id, actorUserId: input.actorUserId,
    ...(input.actorUserId ? {} : { actorType: 'SERVICE', actorRefId: 'billing-refund-worker' }), action: 'billing.package.ended',
    targetType: 'BillingInvoice', targetId: invoice.id, requestId: input.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL',
    metadataJson: { reason: input.reason, refundOperationId: input.refundOperationId ?? null, previousTermEndsAt: company.planTerm!.termEndsAt.toISOString(),
      previousPaidThrough: account.paidThrough!.toISOString(), endedAt: now.toISOString(), paidSatang: invoice.paidSatang, refundedSatang: invoice.refundedSatang } } });
  return null;
}
