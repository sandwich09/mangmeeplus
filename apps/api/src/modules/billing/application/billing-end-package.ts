import type { BillingAccount, BillingInvoice, CompanyPlanTerm, Prisma } from '../../../generated/prisma/client';
import type { PartnerLifecycleTransitionUseCase } from '../../system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';
import { invoiceServiceEnd } from '../domain/billing-package';
import { billingError } from '../domain/billing-policy';
import { termProjectionHash } from '../domain/paid-invoice';
import { promotionForInvoice } from './billing-promotion';
import { unrepairableBinding } from './billing-refund-source';
import { promotionReceiptSourceKey } from './billing-receipt-grants';

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
type Invoice = Pick<BillingInvoice, 'billingAccountId' | 'providerStatus' | 'applyStatus' | 'appliedAt' | 'periodStart' | 'periodEnd' | 'paidSatang' | 'refundedSatang'> &
  Partial<Pick<BillingInvoice, 'benefitEnd'>>;

/**
 * True while the provider would still collect for this account (CARD_AUTO or PROMPTPAY_RENEW): staff cancel the renewal first.
 * Cancel-at-period-end and a canceled subscription are not live.
 */
export const renewalIsLive = (account: Pick<Account, 'renewalMode' | 'baseSubscriptionId' | 'cancelAtPeriodEnd' | 'subscriptionState'>) =>
  !!(account.baseSubscriptionId || account.renewalMode === 'CARD_AUTO' || account.renewalMode === 'PROMPTPAY_RENEW') && !account.cancelAtPeriodEnd &&
  !['canceled', 'incomplete_expired'].includes(account.subscriptionState);

/**
 * Why this paid invoice cannot end the shop's running package, or null. "Current" means the invoice
 * is applied, already serving, and its service end is the one the account and the plan term run on now
 * (plan R2: a promotion purchase serves until `benefitEnd`, past its paid `periodEnd`).
 */
export function endPackageBlock(company: { status: string; planTerm: Term | null }, account: Account, invoice: Invoice,
  requireFullRefund: boolean, now = new Date(), unrepairable = false): EndPackageBlock | null {
  const term = company.planTerm;
  if (!term || term.billingReceiptAccountId !== account.id || company.status !== 'ACTIVE' || term.termDisabledAt || term.termEndsAt <= now ||
    !account.paidThrough || account.paidThrough <= now || invoice.billingAccountId !== account.id || invoice.providerStatus !== 'paid' ||
    invoice.applyStatus !== 'APPLIED' || !invoice.appliedAt || invoice.periodStart > now || invoiceServiceEnd(invoice).getTime() !== account.paidThrough.getTime() ||
    termProjectionHash(term) !== account.termProjectionHash) return 'BILLING_END_PACKAGE_NOT_CURRENT';
  // ponytail: never touches Stripe; staff cancel the renewal first.
  // `unrepairable` (`unrepairableBinding`): this invoice's own purchase holds the slot and its renewal was never made and cannot be —
  // no subscription exists to cancel first, and the purchase being refunded is not a pending one to wait for.
  if (!unrepairable && renewalIsLive(account)) return 'BILLING_END_PACKAGE_AUTO_RENEW';
  if ((account.activeAttemptId && !unrepairable) || account.activeCollectionOperationId || account.pendingPlanChangeId) return 'BILLING_END_PACKAGE_PENDING';
  if (requireFullRefund && invoice.refundedSatang < invoice.paidSatang) return 'BILLING_END_PACKAGE_NOT_REFUNDED';
  return null;
}

/** Only a refund that asked for it and reached SUCCEEDED ends the package; FAILED, pending or unknown never do. */
export const refundEndsPackage = (proposed: { endPackage?: boolean }, terminal: string) => proposed.endPackage === true && terminal === 'SUCCEEDED';

/**
 * Promotion Q6 (plan R14): the entitlement a promotion purchase granted is gone, ended now or with nothing left of it. The
 * redemption stays CONSUMED and the campaign usage is never lowered — only this stamp is written, once, and never moved.
 */
const stampPromotionAdjusted = async (tx: Prisma.TransactionClient, invoiceId: string, now: Date) =>
  (await tx.billingPromotionRedemption.updateMany({ where: { invoiceId, state: 'CONSUMED', entitlementAdjustedAt: null },
    data: { entitlementAdjustedAt: now, version: { increment: 1 } } })).count === 1;

/**
 * A fully refunded promotion source that is no longer the running package (spent, replaced, not started, never applied) has
 * nothing this module can end, so staff adjust it — unless nothing is left to end. That holds only when the source was applied
 * and none of its own lots (base or bonus) is still unexpired and unrevoked; it is then stamped like an ended one. A source
 * that has not started, a held one and one whose base units were carried into a later purchase stay unstamped (PENDING).
 * Caller holds the Company lock, like `endPaidPackage`.
 * ponytail: a carried lot with no units left still counts as live, so that source waits for staff; read `receiptLots().remaining`
 * here if staff ever see such rows. A segmented-term engine for future or replaced sources is deferred (plan §2).
 */
export async function stampSpentPromotion(tx: Prisma.TransactionClient, input: { accountId: string; invoiceId: string }, now = new Date()): Promise<boolean> {
  if (!(await promotionForInvoice(tx, input.invoiceId))?.benefitAppliedAt) return false;
  const live = await tx.billingReceiptGrant.findFirst({ where: { billingAccountId: input.accountId, revokedAt: null, expiresAt: { gt: now },
    sourceKey: { in: [input.invoiceId, promotionReceiptSourceKey(input.invoiceId)] } }, select: { id: true } });
  return !live && stampPromotionAdjusted(tx, input.invoiceId, now);
}

/**
 * Ends the running paid term now into the same state the P29 expiry sweep leaves: DISABLED with
 * `termDisabledAt` (locked shell, LINE package-required, data kept, a new purchase restarts it).
 * `paidThrough` moves to now so a new purchase is a restart, never a stack on the refunded term;
 * unexpired paid receipt grants (a promotion's bonus lot included) are revoked so they cannot carry
 * into it. The applied invoice keeps APPLIED, so no reconciler pass re-applies it. A promotion
 * purchase's redemption is stamped adjusted (see `stampPromotionAdjusted`). Caller holds
 * partner-ocr-config, then the Company lock. Returns the block (nothing written) or null once ended.
 */
export async function endPaidPackage(tx: Prisma.TransactionClient, lifecycle: Pick<PartnerLifecycleTransitionUseCase, 'execute'>, input: {
  companyId: string; accountId: string; invoiceId: string; requireFullRefund: boolean; actorUserId: string | null; requestId: string;
  reason: string; refundOperationId?: string;
}, now = new Date()): Promise<EndPackageBlock | null> {
  const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId }, include: { planTerm: true } });
  const account = await tx.billingAccount.findFirstOrThrow({ where: { id: input.accountId, companyId: input.companyId } });
  const invoice = await tx.billingInvoice.findFirstOrThrow({ where: { id: input.invoiceId, billingAccountId: account.id } });
  const block = endPackageBlock(company, account, invoice, input.requireFullRefund, now, !!await unrepairableBinding(tx, account, invoice));
  if (block) return block;
  // Machine actor, like the sweep: a human requester would clear termDisabledAt and turn this into a manual hold.
  await lifecycle.execute({ companyId: company.id, targetStatus: 'DISABLED', reason: 'refund_package_ended', requestingAdminUserId: null, requestId: input.requestId }, tx);
  const term = await tx.companyPlanTerm.update({ where: { companyId: company.id }, data: { termEndsAt: now, termDisabledAt: now,
    ...(input.actorUserId ? { updatedByUserId: input.actorUserId } : {}) } });
  await tx.billingReceiptGrant.updateMany({ where: { billingAccountId: account.id, companyId: company.id,
    kind: { in: ['INITIAL', 'RENEWAL', 'REPEAT', 'UPGRADE', 'PROMOTION'] }, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } });
  await tx.billingAccount.update({ where: { id: account.id }, data: { paidThrough: now, nextChargeAt: null,
    termProjectionHash: termProjectionHash(term), observedAt: now, version: { increment: 1 } } });
  const adjusted = await stampPromotionAdjusted(tx, invoice.id, now);
  await tx.auditLog.create({ data: { companyId: company.id, actorUserId: input.actorUserId,
    ...(input.actorUserId ? {} : { actorType: 'SERVICE', actorRefId: 'billing-refund-worker' }), action: 'billing.package.ended',
    targetType: 'BillingInvoice', targetId: invoice.id, requestId: input.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL',
    metadataJson: { reason: input.reason, refundOperationId: input.refundOperationId ?? null, previousTermEndsAt: company.planTerm!.termEndsAt.toISOString(),
      previousPaidThrough: account.paidThrough!.toISOString(), endedAt: now.toISOString(), paidSatang: invoice.paidSatang, refundedSatang: invoice.refundedSatang,
      ...(adjusted ? { promotionEntitlementAdjusted: true } : {}) } } });
  return null;
}
